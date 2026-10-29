/**
 * Applying a checked plan to real lorebooks.
 *
 * The first code in this project that changes a user's campaign, and the last
 * layer of three: 9a read the tool call, 9f checked what it asked for, 9b
 * decided which books may be touched at all. This does the writing, and it
 * refuses anything those layers did not clear.
 *
 * **Ownership is enforced here, not trusted from above.** Every write resolves
 * its target and asks `isWritableBook` before touching it. A caller that forgot
 * to check gets a refusal, not a rewritten world bible. The check is cheap and
 * the failure it prevents is unrecoverable, so it goes at the point of the
 * write rather than at the point of the decision.
 *
 * Everything it does is reported: what changed, what was refused and why, and
 * which books it created. The last of those is what an undo needs (9b) — a book
 * this pass made may be deleted on a swipe, and one it merely wrote into must
 * not be.
 */

import { bookStanding, campaignBookName, rememberCampaignBook } from './campaign.js'
import { coreFieldKind } from './modules.js'
import { isWorldProgressionBookName } from '../tracker/world.js'
import { protectCoreBlock, type Commit } from './commit.js'
import { isCardTarget, patchCoreSection } from '../tracker/creator.js'
import { carryStamp, resolveTurn, stampContent, stampLabel, stripStamp } from './provenance.js'
import { holdsMap } from './undo.js'

/** One entry as the host stores it, in the fields this module touches. */
export interface LoreEntry {
    /** The host's identity for the entry. */
    id: string
    /** The entry's number within its book, which is what the model addresses. */
    uid: string
    key: string[]
    content: string
    /** The entry's title. */
    comment: string
}

/** A book, and the entries in it. */
export interface LoreBook {
    id: string
    name: string
}

/** The slice of `spindle.world_books` the writer needs. */
export interface LoreStore {
    listBooks(): Promise<LoreBook[]>
    createBook(name: string): Promise<LoreBook>
    listEntries(bookId: string): Promise<LoreEntry[]>
    createEntry(bookId: string, entry: { key: string[]; content: string; comment: string }): Promise<LoreEntry>
    updateEntry(entryId: string, patch: { key?: string[]; content?: string; comment?: string }): Promise<unknown>
    deleteEntry(entryId: string): Promise<unknown>
    /**
     * Optional, and used only by an undo deleting a book that pass created.
     * The writer itself has no path that deletes a book.
     */
    deleteBook?(bookId: string): Promise<unknown>
}

export interface WriteDeps {
    store: LoreStore
    /** The campaign prefix this pass belongs to. */
    prefix: string
    /** Books this campaign already owns. Not mutated; the report carries additions. */
    ownedBooks: readonly string[]
    /** Prefixed to content the agent adds, as the legacy does. */
    timePrefix?: string
    /**
     * The messages this pass read, as the host numbers them.
     *
     * Not "the newest message": each item carries its own claim about which
     * turn it came from, and this is what that claim is checked against. A pass
     * that read 40 to 45 must be able to stamp a betrayal at 43 as 43.
     */
    readRange?: readonly number[]
    log?: { warn(message: string): void }
    /**
     * The chat's Player Card (35b), when there is one. A core edit addressed
     * to `{{user}}`, `player`, `pc`, `user` or the card's name goes to the
     * card's Body or Worn Equipment instead of a book; any other field of
     * the card is the player's own and is refused, as the legacy refuses it.
     */
    playerCard?: {
        name: string
        apply(field: string, content: string): Promise<{ ok: true } | { ok: false; reason: string }>
    }
    /**
     * The campaign's NPC section names (45b-bis), so a core edit's value
     * stops at a custom section's header as it does at a stock one. Absent,
     * only the legacy's standard headers bound a value.
     */
    coreHeaders?: readonly string[]
    /**
     * Whether this is a pressed or an instructed pass (72c), the legacy's
     * `isManual`. On the automatic pass after a reply a core edit may touch
     * the Combat Profile and nothing else — Body and Worn Equipment arrive
     * as appearance and equipment, always allowed — and any other field is
     * refused with the legacy's own line. Absent, the pass is taken as
     * manual, as every caller before 72c was.
     */
    manual?: boolean
}

export interface WriteReport {
    /** `book::uid` of everything created, updated or renamed. */
    changed: string[]
    /** `book::uid` of everything deleted. */
    deleted: string[]
    /** Books this pass created. An undo may delete exactly these. */
    createdBooks: string[]
    /** `book::uid` of the entries this pass created. An undo may remove exactly these (45c-quinquies). */
    createdEntries: string[]
    /** The campaign's ownership list, with any new books added. */
    ownedBooks: string[]
    /** What was refused, and why, in words. */
    refused: string[]
}

/** `book::uid`, the address the model uses. */
function addressOf(bookName: string, uid: string): string {
    return `${bookName}::${uid}`
}

function splitAddress(address: string): { bookName: string; uid: string } | null {
    const at = address.indexOf('::')
    if (at <= 0) return null
    const bookName = address.slice(0, at)
    const uid = address.slice(at + 2)
    return bookName && uid ? { bookName, uid } : null
}

/**
 * Apply a commit.
 *
 * Order matters and follows the legacy: content edits, then renames, then
 * merges, then new entries, then deletions. Deletions last so a merge can read
 * what it is merging before its targets go, and new entries before deletions so
 * a pass that records and deletes in one commit cannot lose the record if the
 * delete fails.
 */
export async function applyCommit(commit: Commit, deps: WriteDeps): Promise<WriteReport> {
    const report: WriteReport = {
        changed: [],
        deleted: [],
        createdBooks: [],
        createdEntries: [],
        ownedBooks: [...deps.ownedBooks],
        refused: [],
    }

    const books = new Map<string, LoreBook>()
    for (const book of await deps.store.listBooks()) books.set(book.name.toLowerCase(), book)

    /** Entries per book id, read once and kept in step as we write. */
    const entriesByBook = new Map<string, LoreEntry[]>()
    const entriesOf = async (book: LoreBook): Promise<LoreEntry[]> => {
        const cached = entriesByBook.get(book.id)
        if (cached) return cached
        const entries = await deps.store.listEntries(book.id)
        entriesByBook.set(book.id, entries)
        return entries
    }

    /**
     * Find what an address points at — and refuse it unless this campaign owns
     * the book. The ownership check lives here, at the write, deliberately.
     */
    const resolve = async (
        address: string,
        what: string,
    ): Promise<{ book: LoreBook; entry: LoreEntry } | null> => {
        const parts = splitAddress(address)
        if (!parts) {
            report.refused.push(`${what}: "${address}" is not an entry address`)
            return null
        }
        const book = books.get(parts.bookName.toLowerCase())
        if (!book) {
            report.refused.push(`${what}: there is no book called "${parts.bookName}"`)
            return null
        }
        if (bookStanding(book.name, deps.prefix, report.ownedBooks) !== 'owned') {
            report.refused.push(
                `${what}: "${book.name}" does not belong to this campaign, so it was left alone`,
            )
            return null
        }
        const entry = (await entriesOf(book)).find((candidate) => candidate.uid === parts.uid)
        if (!entry) {
            report.refused.push(`${what}: "${address}" is not there any more`)
            return null
        }
        return { book, entry }
    }

    /** Find or create the campaign's book for a category, recording a creation. */
    /**
     * A book this campaign already owns whose name differs only trivially.
     *
     * The model chooses a category free-hand, and the writer turns it into a
     * book name. Live, one commit produced `VellmoorTest_Event` beside the
     * `VellmoorTest_Events` it had been shown in the same prompt, splitting
     * a campaign's events across two books over one letter.
     *
     * Only a plural `s` and letter case are folded here — the mechanical half.
     * `NPC` against an established `Characters` is a synonym, not a near miss,
     * and guessing at those would eventually file something in the wrong book,
     * which is worse than a spare one. The prompt handles that half by naming
     * the categories already in use.
     *
     * Owned books only: matching onto a book we may not write to would turn a
     * refusal into a surprise.
     */
    const nearMissBook = (name: string): LoreBook | undefined => {
        const wanted = foldBookName(name)
        for (const book of books.values()) {
            if (foldBookName(book.name) !== wanted) continue
            if (bookStanding(book.name, deps.prefix, report.ownedBooks) === 'owned') return book
        }
        return undefined
    }

    const bookForCategory = async (category: string): Promise<LoreBook | null> => {
        const name = campaignBookName(deps.prefix, category)
        if (!name) {
            report.refused.push(`record: this campaign has no name, so there is nowhere to file "${category}"`)
            return null
        }
        // The legacy: "WORLD is an internal World Progression target, not an
        // implicit Agent category." Reports are written by that pass alone,
        // and the skeleton's seeds by its generator (33b).
        if (isWorldProgressionBookName(name)) {
            report.refused.push(`record: "${category}" is World Progression's book, which its own pass writes here; the agent does not write reports or seeds — switch the WORLD module off under Agent modules`)
            return null
        }

        const existing = books.get(name.toLowerCase()) ?? nearMissBook(name)
        if (existing) {
            // A book that merely matches the name is not ours until the user
            // says so. Writing into it is exactly what 9b exists to prevent.
            if (bookStanding(existing.name, deps.prefix, report.ownedBooks) !== 'owned') {
                report.refused.push(
                    `record: "${existing.name}" already exists and is not this campaign's, `
                    + 'so nothing was written to it',
                )
                return null
            }
            return existing
        }

        const made = await deps.store.createBook(name)
        books.set(made.name.toLowerCase(), made)
        entriesByBook.set(made.id, [])
        report.createdBooks.push(made.name)
        report.ownedBooks = rememberCampaignBook(report.ownedBooks, made.name)
        return made
    }

    const stamp = deps.timePrefix ? `${deps.timePrefix} ` : ''

    // Each item says which turn it came from; this decides whether to believe
    // it. The model is the only thing that read the story and knows.
    const turnOf = (cited: number | null) => resolveTurn(cited, deps.readRange ?? [])

    /** A title stamped before 73a loses the stamp as the entry is touched (departure 11); nothing for a plain title. */
    const retitled = (entry: { comment: string }): { comment?: string } =>
        stripStamp(entry.comment) !== entry.comment.trim() ? { comment: stripStamp(entry.comment) } : {}

    // 1. Append.
    for (const item of commit.update) {
        const found = await resolve(item.id, 'update')
        if (!found) continue
        // Which turn added *this* paragraph. The title says which turn created
        // the entry and can only say it once; an entry revised across ten turns
        // needs the mark where the new prose is.
        const addition = `${stamp}${stampContent(item.content, turnOf(item.msg ?? null))}`
        const content = found.entry.content ? `${found.entry.content}\n${addition}` : addition
        await deps.store.updateEntry(found.entry.id, { content, ...retitled(found.entry) })
        found.entry.content = content
        report.changed.push(item.id)
    }

    // 2. Replace, keeping [CORE] and [MAP].
    for (const item of commit.rewrite) {
        const found = await resolve(item.id, 'rewrite')
        if (!found) continue
        const content = protectCoreBlock(found.entry.content, item.content)
        // The cleanup pass rewrites (71c), so an old title stamp comes off here too (73a-bis).
        await deps.store.updateEntry(found.entry.id, { content, ...retitled(found.entry) })
        found.entry.content = content
        report.changed.push(item.id)
    }

    // 3. Retitle and re-key.
    for (const item of commit.rename) {
        const found = await resolve(item.id, 'rename')
        if (!found) continue
        const patch: { comment?: string; key?: string[] } = {}
        // The plain new name (73a): a stamp the entry carried from before comes off.
        if (item.label !== undefined) patch.comment = carryStamp(item.label, found.entry.comment)
        if (item.keys !== undefined) patch.key = item.keys
        await deps.store.updateEntry(found.entry.id, patch)
        if (patch.comment !== undefined) found.entry.comment = patch.comment
        if (patch.key !== undefined) found.entry.key = patch.key
        report.changed.push(item.id)
    }

    // 4. Edit named fields inside [CORE] — or the Player Card's two fields.
    for (const item of commit.core) {
        if (deps.playerCard && isCardTarget(item.id, deps.playerCard.name)) {
            const applied = await deps.playerCard.apply(item.field, item.content)
            if (applied.ok) report.changed.push(item.id)
            else report.refused.push(`PC core update failed for "${item.id}": ${applied.reason}`)
            continue
        }
        // The legacy's automatic-pass rule (72c), in its words.
        if (deps.manual === false && !coreFieldKind.appearance(item.field) && !coreFieldKind.equipment(item.field) && !coreFieldKind.combat(item.field)) {
            report.refused.push(`Automatic pass rejected core update of "${item.field}" on "${item.id}" — only Combat Profile (and Body/Equipment via their dedicated tools) are allowed without a Direct Prompt.`)
            continue
        }
        const found = await resolve(item.id, 'core')
        if (!found) continue
        const content = replaceCoreField(found.entry.content, item.field, item.content, deps.coreHeaders ?? [])
        await deps.store.updateEntry(found.entry.id, { content })
        found.entry.content = content
        report.changed.push(item.id)
    }

    // 5. Merge several entries into one, then remove the rest.
    for (const item of commit.consolidate) {
        const survivor = await resolve(item.survivor, 'consolidate')
        if (!survivor) continue

        const merged: LoreEntry[] = []
        for (const target of item.targets) {
            const found = await resolve(target, 'consolidate')
            if (!found) continue
            // A mapped place is never merged away: the map would go with it (45c-quinquies).
            if (holdsMap(found.entry.content)) {
                report.refused.push(`consolidate: "${target}" holds a map and was kept; the agent does not merge away a mapped place`)
                continue
            }
            merged.push(found.entry)
        }
        if (!merged.length) {
            report.refused.push(`consolidate: nothing could be merged into "${item.survivor}"`)
            continue
        }

        const body = item.content || merged.map((entry) => entry.content).filter(Boolean).join('\n')
        const content = protectCoreBlock(survivor.entry.content, body)
        await deps.store.updateEntry(survivor.entry.id, { content })
        survivor.entry.content = content
        report.changed.push(item.survivor)

        for (const entry of merged) {
            await deps.store.deleteEntry(entry.id)
            report.deleted.push(addressOf(survivor.book.name, entry.uid))
        }
    }

    // 6. New entries.
    for (const item of commit.record) {
        const book = await bookForCategory(item.category)
        if (!book) continue
        const created = await deps.store.createEntry(book.id, {
            key: item.keys,
            comment: stampLabel(item.label, turnOf(item.msg ?? null)),
            // Marked like any other addition. The title records the creating
            // turn too, and that is not a duplicate worth avoiding: the title
            // is what you scan in a list, and the body is what you read down —
            // an opening paragraph with no mark, above marked ones, reads as
            // prose nobody attributed.
            content: item.content ? `${stamp}${stampContent(item.content, turnOf(item.msg ?? null))}` : '',
        })
        ;(await entriesOf(book)).push(created)
        report.changed.push(addressOf(book.name, created.uid))
        report.createdEntries.push(addressOf(book.name, created.uid))
    }

    // 7. Deletions, last, so everything above could still read them.
    for (const address of commit.deleteIds) {
        const found = await resolve(address, 'delete')
        if (!found) continue
        if (holdsMap(found.entry.content)) {
            report.refused.push(`delete: "${address}" holds a map and was kept; the agent does not delete a mapped place`)
            continue
        }
        await deps.store.deleteEntry(found.entry.id)
        report.deleted.push(address)
    }

    return report
}

/**
 * Replace one named field inside an entry's `[CORE]` block.
 *
 * Surgical, as the legacy is: `Species: fae` becomes `Species: half-elf` and
 * every other line of the block is left exactly as it was. A field that is not
 * there yet is appended inside the block rather than replacing it, and an entry
 * with no `[CORE]` block gets one — a core edit on an entry that has never had
 * an identity block is still a core edit.
 */
/** A book name reduced to what a trailing plural and letter case cannot change. */
function foldBookName(name: string): string {
    return name.toLowerCase().replace(/s$/, '')
}

export function replaceCoreField(content: string, field: string, value: string, extraHeaders: readonly string[] = []): string {
    const text = String(content ?? '')
    const line = `${field}: ${value}`
    const coreRegex = /\[CORE\]([\s\S]*?)\[\/CORE\]/i

    const match = text.match(coreRegex)
    if (!match) return text ? `[CORE]\n${line}\n[/CORE]\n${text}` : `[CORE]\n${line}\n[/CORE]`

    // The legacy's section patcher (45b-bis): a field's value runs to the
    // next known header, so a multi-line Combat Profile is replaced whole.
    // The first version replaced the field's first line only and left the
    // rest of the old block under the new one — two stat blocks, live.
    const inner = match[1] ?? ''
    const patched = patchCoreSection(inner, field, value, extraHeaders)
    const nextInner = patched.ok ? patched.body : `${inner.replace(/\s+$/, '')}\n${line}\n`
    return text.replace(coreRegex, `[CORE]${nextInner}[/CORE]`)
}
