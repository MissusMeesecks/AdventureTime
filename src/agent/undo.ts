/**
 * Putting the lorebooks back the way a pass found them.
 *
 * 9b worked out *which* books an undo may touch and how history is scoped per
 * chat. It never had anything to undo, because nothing wrote. Now a single
 * live pass has written 28 entries, rewritten 3 and deleted 1 across six books,
 * and the maintainer's first request about this agent — made before a line of
 * it existed — was that a pass be reversible.
 *
 * The shape here is deliberately dumb: **capture the whole of every book the
 * pass could touch, then put it back**. Not a diff, not a journal of
 * operations. A pass rewrites content, renames, merges entries into one and
 * deletes the rest; inverting that sequence step by step means being right
 * about every operation, and being wrong once means a campaign left in a state
 * neither the model nor the user asked for. A snapshot is bigger and cannot be
 * subtly wrong.
 *
 * Three rules, the first two from 9b:
 *
 * **A book is deleted only if this pass created it.** Never "because it matches
 * the prefix" — that would delete a book the user made and named to match.
 * Deleting a book is the one action here nothing can walk back.
 *
 * **Undo is scoped per chat**, because two campaigns interleave in one history.
 *
 * **An entry the snapshot does not know about is left alone.** The plan only
 * ever speaks about books that were captured. Something that appeared in a
 * captured book since the snapshot is this pass's doing and is removed; a book
 * nobody snapshotted is not this undo's business at all.
 */

/** One entry, as much of it as a restore needs to rebuild it. */
export interface SnapshotEntry {
    uid: string
    key: string[]
    content: string
    comment: string
}

/** One book's contents at snapshot time. */
export interface SnapshotBook {
    name: string
    entries: SnapshotEntry[]
}

/** Everything a pass needs to be undoable. */
export interface LorePassSnapshot {
    /** The chat this pass belonged to. The key for scoping an undo. */
    chatId: string
    /** When the pass ran, ISO 8601. */
    at: string
    /** The campaign prefix in force. */
    prefix: string
    /**
     * The newest message in the chat when the pass ran.
     *
     * What ties a pass to a reply. A swipe or a regenerate *replaces* that
     * message, so the story the pass read no longer exists and the lore it
     * wrote is about a turn that did not happen. Absent on a pass run against
     * an empty chat, and on snapshots written before 9r.
     */
    messageId?: string
    /** Every book the pass could write to, captured whole. */
    books: SnapshotBook[]
    /** The ownership list as it stood *before* the pass. */
    ownedBooks: string[]
    /** Books the pass went on to create. Only these may be deleted. */
    createdBooks: string[]
    /**
     * Entries the pass went on to create, as `book::uid`. Only these may be
     * removed. Absent on snapshots written before 45c-quinquies, where every
     * entry the snapshot does not know is taken as the pass's — which deleted
     * the Map Architect's root entry and the Map Updater's chronicles when
     * they landed in a captured book after the snapshot.
     */
    createdEntries?: string[]
    /**
     * Where the automatic-pass watermark stood *before* this pass ran.
     *
     * Undoing a pass has to undo the watermark it advanced, or the story it
     * covered is never read again. A pass that read replies 17–20 and was then
     * rolled back leaves no lore for any of them; without this the next pass
     * started partway through that span and reply 17 was lost for good.
     *
     * Absent on snapshots written before 9u, where the caller falls back to
     * walking the watermark back a cycle.
     */
    watermark?: number
}

/** One book as it stands now, for comparison. */
export interface LiveBook {
    id: string
    name: string
    entries: Array<{ id: string; uid: string; key: string[]; content: string; comment: string }>
}

/** What an undo would do. Nothing here has happened yet. */
export interface UndoPlan {
    /** Entries to put back as they were, by host id. */
    restore: Array<{ entryId: string; key: string[]; content: string; comment: string }>
    /** Entries the pass added to a book that already existed. */
    remove: Array<{ entryId: string; address: string }>
    /** Entries the pass deleted, to be made again in the named book. */
    recreate: Array<{ bookId: string; bookName: string; entry: SnapshotEntry }>
    /** Books to delete outright — only ones the pass created. */
    deleteBooks: Array<{ id: string; name: string }>
    /** The ownership list to restore. */
    ownedBooks: string[]
    /** Anything the plan could not account for, in words. */
    problems: string[]
}

const MAP_BLOCK = /\[MAP\]([\s\S]*?)\[\/MAP\]/i

/** Whether an entry holds a hidden map (row 9). The agent never writes one, so a map is always someone else's work. */
export function holdsMap(content: unknown): boolean {
    return MAP_BLOCK.test(String(content ?? ''))
}

/**
 * The snapshot's text with the live `[MAP]` carried over (45c-quinquies).
 * A map is the architect's, the updater's or evolution's, never the agent's,
 * so an undo of the agent's pass puts the prose back and leaves the map as
 * it stands now — in place of the snapshot's, or appended when it had none.
 */
export function carryLiveMap(before: string, live: string): string {
    const now = live.match(MAP_BLOCK)
    if (!now) return before
    const block = now[0]
    return MAP_BLOCK.test(before) ? before.replace(MAP_BLOCK, block) : `${before.trimEnd()}${before.trim() ? '\n\n' : ''}${block}`
}

const sameEntry = (a: SnapshotEntry, b: { key: string[]; content: string; comment: string }): boolean =>
    a.content === b.content
    && a.comment === b.comment
    && a.key.length === b.key.length
    && a.key.every((value, i) => value === b.key[i])

/**
 * Work out how to put the books back.
 *
 * Pure: it reads a snapshot and the live books and returns a plan. Nothing is
 * written until something applies it, which is what makes the plan reviewable
 * and the decisions testable.
 */
export function planUndo(snapshot: LorePassSnapshot, live: readonly LiveBook[]): UndoPlan {
    const plan: UndoPlan = {
        restore: [],
        remove: [],
        recreate: [],
        deleteBooks: [],
        ownedBooks: [...snapshot.ownedBooks],
        problems: [],
    }

    const liveByName = new Map(live.map((book) => [book.name.toLowerCase(), book]))
    const created = new Set(snapshot.createdBooks.map((name) => name.toLowerCase()))

    // A book the pass made goes entirely, entries and all. Nothing inside it
    // existed before the pass, so there is nothing in it to preserve.
    for (const name of snapshot.createdBooks) {
        const book = liveByName.get(name.toLowerCase())
        if (!book) {
            // Already gone — deleted by hand, most likely. Not a failure: the
            // end state an undo wants is the state it is already in.
            continue
        }
        plan.deleteBooks.push({ id: book.id, name: book.name })
    }

    for (const snapshotBook of snapshot.books) {
        if (created.has(snapshotBook.name.toLowerCase())) {
            // Captured *and* created is a contradiction — the capture happens
            // before the pass runs, so a created book has nothing to capture.
            // Say so rather than letting the two halves fight.
            plan.problems.push(
                `"${snapshotBook.name}" is recorded as both captured and created; it was left alone`,
            )
            plan.deleteBooks = plan.deleteBooks.filter((book) => book.name !== snapshotBook.name)
            continue
        }

        const book = liveByName.get(snapshotBook.name.toLowerCase())
        if (!book) {
            plan.problems.push(`"${snapshotBook.name}" no longer exists, so its entries were not restored`)
            continue
        }

        const liveByUid = new Map(book.entries.map((entry) => [entry.uid, entry]))
        const knownUids = new Set(snapshotBook.entries.map((entry) => entry.uid))

        for (const before of snapshotBook.entries) {
            const now = liveByUid.get(before.uid)
            if (!now) {
                plan.recreate.push({ bookId: book.id, bookName: book.name, entry: before })
                continue
            }
            if (sameEntry(before, now)) continue
            // A map drawn or changed since the pass is kept through the restore.
            const content = carryLiveMap(before.content, now.content)
            if (sameEntry({ ...before, content }, now)) continue
            plan.restore.push({
                entryId: now.id,
                key: [...before.key],
                content,
                comment: before.comment,
            })
        }

        const madeHere = snapshot.createdEntries ? new Set(snapshot.createdEntries.map((a) => a.toLowerCase())) : null
        for (const entry of book.entries) {
            if (knownUids.has(entry.uid)) continue
            const address = `${book.name}::${entry.uid}`
            // Only what the pass itself created goes; an entry another writer
            // added since (the architect's root, the updater's chronicle) stays.
            if (madeHere && !madeHere.has(address.toLowerCase())) continue
            if (holdsMap(entry.content)) {
                plan.problems.push(`"${address}" was kept: it holds a map drawn since the pass`)
                continue
            }
            plan.remove.push({ entryId: entry.id, address })
        }
    }

    return plan
}

/** One line saying what an undo did, for the panel. */
export function describeUndo(plan: UndoPlan): string {
    const parts: string[] = []
    const add = (n: number, one: string, many = `${one}s`): void => {
        if (n) parts.push(`${n} ${n === 1 ? one : many}`)
    }

    add(plan.restore.length, 'entry restored', 'entries restored')
    add(plan.recreate.length, 'entry put back', 'entries put back')
    add(plan.remove.length, 'entry removed', 'entries removed')
    add(plan.deleteBooks.length, 'book deleted', 'books deleted')

    let out = parts.length ? `Undone: ${parts.join(', ')}.` : 'Nothing to undo — the books already match.'
    if (plan.problems.length) out += ` ${plan.problems.length} could not be undone.`
    return out
}

/** The slice of the store an undo needs. Narrower than the writer's. */
export interface UndoStore {
    listBooks(): Promise<Array<{ id: string; name: string }>>
    listEntries(bookId: string): Promise<Array<{ id: string; uid: string; key: string[]; content: string; comment: string }>>
    createEntry(bookId: string, entry: { key: string[]; content: string; comment: string }): Promise<unknown>
    updateEntry(entryId: string, patch: { key?: string[]; content?: string; comment?: string }): Promise<unknown>
    deleteEntry(entryId: string): Promise<unknown>
    deleteBook?(bookId: string): Promise<unknown>
}

/** Read every book the pass may write to, whole, before it runs. */
export async function captureSnapshot(
    store: UndoStore,
    options: { chatId: string; prefix: string; ownedBooks: readonly string[]; isOwn(bookName: string): boolean },
): Promise<LorePassSnapshot> {
    const own = (await store.listBooks()).filter((book) => options.isOwn(book.name))

    // Read the books at once rather than one after another. These are
    // independent host round trips and nothing here depends on the previous
    // book, so waiting for each in turn spent a campaign's worth of latency for
    // no ordering that matters. `Promise.all` keeps the array in book order, so
    // a snapshot is still deterministic.
    const captured = await Promise.all(
        own.map(async (book): Promise<SnapshotBook | null> => {
            try {
                const entries = await store.listEntries(book.id)
                return {
                    name: book.name,
                    entries: entries.map((entry) => ({
                        uid: entry.uid,
                        key: [...(entry.key ?? [])],
                        content: entry.content ?? '',
                        comment: entry.comment ?? '',
                    })),
                }
            } catch {
                // A book that will not read is a book we cannot promise to
                // restore. Leaving it out of the snapshot is honest: `planUndo`
                // then says nothing about it rather than removing entries it
                // never saw. Per book, so one unreadable book does not cost the
                // snapshot every other book — which is what a rejected
                // `Promise.all` would do.
                return null
            }
        }),
    )
    const books = captured.filter((book): book is SnapshotBook => book !== null)

    return {
        chatId: options.chatId,
        at: new Date().toISOString(),
        prefix: options.prefix,
        books,
        ownedBooks: [...options.ownedBooks],
        createdBooks: [],
    }
}

/**
 * Carry out a plan.
 *
 * Order matters. Entries are put back and removed *before* books are deleted,
 * so a failure part-way through leaves entries correct in books that still
 * exist rather than books gone and entries stranded. Deleting a book is last
 * because it is the step nothing can walk back.
 */
export async function applyUndo(plan: UndoPlan, store: UndoStore): Promise<UndoPlan> {
    const done: UndoPlan = { ...plan, restore: [], remove: [], recreate: [], deleteBooks: [], problems: [...plan.problems] }

    for (const item of plan.restore) {
        try {
            await store.updateEntry(item.entryId, { key: item.key, content: item.content, comment: item.comment })
            done.restore.push(item)
        } catch (error) {
            done.problems.push(`could not restore an entry: ${String(error)}`)
        }
    }

    for (const item of plan.recreate) {
        try {
            await store.createEntry(item.bookId, {
                key: [...item.entry.key],
                content: item.entry.content,
                comment: item.entry.comment,
            })
            done.recreate.push(item)
        } catch (error) {
            done.problems.push(`could not put "${item.bookName}::${item.entry.uid}" back: ${String(error)}`)
        }
    }

    for (const item of plan.remove) {
        try {
            await store.deleteEntry(item.entryId)
            done.remove.push(item)
        } catch (error) {
            done.problems.push(`could not remove "${item.address}": ${String(error)}`)
        }
    }

    for (const book of plan.deleteBooks) {
        if (!store.deleteBook) {
            // The host may not expose book deletion. An emptied book left
            // behind is untidy; pretending it is gone is a lie the next pass
            // would trip over.
            done.problems.push(`"${book.name}" was created by that pass but this build cannot delete a book`)
            continue
        }
        try {
            await store.deleteBook(book.id)
            done.deleteBooks.push(book)
        } catch (error) {
            done.problems.push(`could not delete "${book.name}": ${String(error)}`)
        }
    }

    return done
}
