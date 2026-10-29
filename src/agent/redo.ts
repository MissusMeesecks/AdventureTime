/**
 * Redo (Phase 71c, roadmap row 71): Multihog's → beside its ← undo.
 *
 * An undo puts the books back as the pass found them; a redo puts them back
 * as the pass left them. The legacy keeps, per undone pass, the pre-pass
 * snapshot it restored and a capture of the live state taken just before
 * the restore, and a redo writes the capture back and re-files the pre-pass
 * snapshot so the pass can be undone again. The same shape here, on the
 * same whole-book snapshots `undo.ts` uses: the capture is a
 * `LorePassSnapshot` of every book the campaign owned at undo time, and
 * `planUndo` against it is the redo — restore, recreate, remove — with the
 * one addition that a book the undo deleted (one the pass had made) is made
 * again first, since the plan can only speak about books that exist.
 *
 * The stack is memory, as the legacy's is: a pass starting in the chat
 * empties it, since the books have moved on and a redo over them would be
 * a write nobody asked for; a backend restart forgets it.
 */

import { applyUndo, captureSnapshot, planUndo, type LorePassSnapshot, type UndoPlan, type UndoStore } from './undo.js'

/** One undone pass, as a redo needs it. */
export interface RedoEntry {
    /** The pass's pre-pass snapshot, re-filed to the history on a redo. */
    pre: LorePassSnapshot
    /** The books as the undo found them: what a redo writes back. */
    post: LorePassSnapshot
    /** The automatic-pass watermark as it stood before the undo moved it back. */
    watermark?: number
}

/** How many undone passes a chat keeps, the legacy's rollback limit. */
export const MAX_REDO = 5

export interface RedoStack {
    push(chatId: string, entry: RedoEntry): void
    pop(chatId: string): RedoEntry | null
    clear(chatId: string): void
    /** How many undone passes wait: the legacy's `[ -N ]`. */
    waiting(chatId: string): number
}

export function createRedoStack(): RedoStack {
    const stacks = new Map<string, RedoEntry[]>()
    return {
        push(chatId, entry) {
            const stack = stacks.get(chatId) ?? []
            stack.push(entry)
            while (stack.length > MAX_REDO) stack.shift()
            stacks.set(chatId, stack)
        },
        pop(chatId) {
            const stack = stacks.get(chatId)
            const entry = stack?.pop() ?? null
            if (stack && !stack.length) stacks.delete(chatId)
            return entry
        },
        clear(chatId) { stacks.delete(chatId) },
        waiting(chatId) { return stacks.get(chatId)?.length ?? 0 },
    }
}

/** The store a redo needs: the undo's, with a way to make a book again. */
export interface RedoStore extends UndoStore {
    createBook(name: string): Promise<{ id: string; name: string }>
}

/**
 * Capture the live state of the books an undo is about to restore over.
 *
 * Every book the campaign owns now — the pass's own books included, which
 * is the point: the undo will delete them, and the capture is how they come
 * back.
 */
export function captureForRedo(store: UndoStore, chatId: string, prefix: string, ownedNow: readonly string[]): Promise<LorePassSnapshot> {
    const owned = new Set(ownedNow.map((name) => name.toLowerCase()))
    return captureSnapshot(store, { chatId, prefix, ownedBooks: ownedNow, isOwn: (name) => owned.has(name.toLowerCase()) })
}

/**
 * Write an undone pass's result back.
 *
 * Books the capture holds that no longer exist are made first; the plan
 * then restores and recreates against the fresh list. An entry no book in
 * the capture knows is one the undo put back (the pass had deleted it), or
 * one written since; both go, a map excepted, as the legacy's whole-state
 * restore takes them. Never throws: a store that fails part-way leaves the
 * plan saying what it could not do.
 */
export async function applyRedo(entry: RedoEntry, store: RedoStore): Promise<UndoPlan & { madeBooks: string[] }> {
    const madeBooks: string[] = []
    const problems: string[] = []
    const liveNames = new Set((await store.listBooks()).map((book) => book.name.toLowerCase()))
    for (const book of entry.post.books) {
        if (liveNames.has(book.name.toLowerCase())) continue
        try {
            await store.createBook(book.name)
            madeBooks.push(book.name)
        } catch (error) {
            problems.push(`"${book.name}" could not be made again: ${String(error)}`)
        }
    }
    const live = []
    for (const book of await store.listBooks()) {
        live.push({ id: book.id, name: book.name, entries: await store.listEntries(book.id) })
    }
    // The capture is restored as a snapshot is: nothing in it was "created"
    // by it, and every entry it does not know goes.
    const plan = planUndo({ ...entry.post, createdBooks: [] }, live)
    const done = await applyUndo(plan, store)
    return { ...done, problems: [...problems, ...done.problems], madeBooks }
}

/** One line saying what a redo did, for the panel. */
export function describeRedo(plan: UndoPlan & { madeBooks: string[] }): string {
    const parts: string[] = []
    const add = (n: number, one: string, many = `${one}s`): void => { if (n) parts.push(`${n} ${n === 1 ? one : many}`) }
    add(plan.madeBooks.length, 'book made again', 'books made again')
    add(plan.recreate.length, 'entry written again', 'entries written again')
    add(plan.restore.length, 'entry restored', 'entries restored')
    add(plan.remove.length, 'entry removed', 'entries removed')
    let out = parts.length ? `Redone: ${parts.join(', ')}.` : 'Nothing to redo — the books already match.'
    if (plan.problems.length) out += ` ${plan.problems.length} could not be redone.`
    return out
}

export const redoDidSomething = (plan: UndoPlan & { madeBooks: string[] }): boolean =>
    plan.madeBooks.length + plan.restore.length + plan.recreate.length + plan.remove.length > 0

