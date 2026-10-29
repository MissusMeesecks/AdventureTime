/**
 * What the agent can see: the three read-only tools.
 *
 * `grep_lore`, `inspect_book` and `read_entry`, backed by the campaign's actual
 * books. Everything here reads; nothing writes. The loop (9g) calls these, and
 * until now they were fakes in a test.
 *
 * Two things shape the formatting, and both are about the model rather than the
 * user. Entries carry their **address** (`Book::uid`) in the text, because that
 * is what a commit has to name — an agent that can read an entry but cannot say
 * which one it read is useless. And results are **capped**, because the reply is
 * pasted into the next prompt: an unbounded `grep_lore("the")` would spend the
 * whole context on one tool call.
 */

import { bookStanding } from './campaign.js'
import { stripMapSection } from '../tracker/map.js'
import type { AgentTools } from './loop.js'
import type { LoreBook, LoreEntry, LoreStore } from './writer.js'

/** Entries one search may return. */
export const MAX_SEARCH_HITS = 8
/** Characters of an entry's content a search result shows. */
export const SEARCH_SNIPPET = 300
/** Entries `inspect_book` will list. */
export const MAX_BOOK_LISTING = 60

export interface LoreToolDeps {
    store: LoreStore
    /** The campaign prefix, for deciding which books the agent may see. */
    prefix: string
    /** Books this campaign owns. */
    ownedBooks: readonly string[]
    /**
     * Whether the agent may read books outside its campaign.
     *
     * On by default, and the asymmetry with writing is deliberate: reading a
     * user's world bible is how the agent avoids contradicting it, while
     * writing to one is the thing 9b exists to prevent. Reading a hand-written
     * world bible is safe; writing to it is not.
     */
    readForeignBooks?: boolean
    /**
     * Books belonging to the user's *other* campaigns, hidden outright.
     *
     * "Foreign" turned out to cover two quite different things. A hand-written
     * world bible is background the agent should read so it does not contradict
     * it. **Another campaign's AdventureTime books are a different story's lore**, and
     * putting them in front of the model is how one campaign's events end up
     * informing another's.
     *
     * Live, an agent running in one campaign searched, found an entry in
     * another campaign's `_Events` book, and tried to update it. The write would
     * have been refused — ownership is checked at the write — but it should
     * never have been offered the entry at all. Hidden here rather than refused
     * later, because the cost is not just the failed write: it is a scene from
     * somebody else's story sitting in this model's context.
     */
    hiddenBooks?: readonly string[]
}

/** `Book::uid`, the address a commit uses. */
function addressOf(book: LoreBook, entry: LoreEntry): string {
    return `${book.name}::${entry.uid}`
}

/** One line of a listing: address, title, keys. */
function summarize(book: LoreBook, entry: LoreEntry): string {
    const title = entry.comment?.trim() || '(untitled)'
    const keys = entry.key?.filter(Boolean).join(', ')
    return `[${addressOf(book, entry)}] ${title}${keys ? ` — keys: ${keys}` : ''}`
}

/**
 * An entry's prose without its `[MAP]` section (row 9): the hidden map is
 * World Progression's and the map agents' to read, never the lorebook
 * agent's -- the legacy strips it from every agent read -- and the writer
 * already carries the section across an update unseen (`protectCoreBlock`).
 */
function prose(entry: LoreEntry): string {
    return stripMapSection(entry.content ?? '')
}

/** A search hit: the line, plus enough content to judge it by. */
function snippet(book: LoreBook, entry: LoreEntry): string {
    const body = prose(entry).trim().replace(/\s+/g, ' ')
    const cut = body.length > SEARCH_SNIPPET ? `${body.slice(0, SEARCH_SNIPPET)}…` : body
    return `${summarize(book, entry)}\n${cut || '(no content)'}`
}

/** An entry in full, for `read_entry`. */
export function formatEntry(book: LoreBook, entry: LoreEntry): string {
    return [
        `Entry ${addressOf(book, entry)}`,
        `Title: ${entry.comment?.trim() || '(untitled)'}`,
        `Keys: ${entry.key?.filter(Boolean).join(', ') || '(none)'}`,
        '',
        prose(entry).trim() || '(no content)',
    ].join('\n')
}

/**
 * Whether a search term appears in an entry.
 *
 * Title, keys and content, case-insensitively. Deliberately a plain substring
 * match and not a ranking: this is the agent's *own* lookup, not the host's
 * retrieval, and it is used to answer "is there already an entry about X?"
 * before writing a duplicate. A fuzzy answer to that question is worse than a
 * literal one.
 */
function matches(entry: LoreEntry, needle: string): boolean {
    const hay = [entry.comment ?? '', (entry.key ?? []).join(' '), prose(entry)]
        .join('\n')
        .toLowerCase()
    return hay.includes(needle)
}

/** Build the three tools against a real store. */
export function createLoreTools(deps: LoreToolDeps): AgentTools {
    const hidden = new Set((deps.hiddenBooks ?? []).map((name) => String(name).toLowerCase()))

    const visible = (book: LoreBook): boolean => {
        // Another campaign's books are hidden whatever else is true: they are
        // never background, always somebody else's plot.
        if (hidden.has(book.name.toLowerCase())) return false
        if (deps.readForeignBooks === false) {
            return bookStanding(book.name, deps.prefix, deps.ownedBooks) === 'owned'
        }
        return true
    }

    const books = async (): Promise<LoreBook[]> => (await deps.store.listBooks()).filter(visible)

    return {
        async grepLore(query: string): Promise<string> {
            const needle = String(query ?? '').trim().toLowerCase()
            if (!needle) return 'grep_lore needs something to search for.'

            const hits: string[] = []
            for (const book of await books()) {
                for (const entry of await deps.store.listEntries(book.id)) {
                    if (!matches(entry, needle)) continue
                    hits.push(snippet(book, entry))
                    // Stop reading once the cap is met: the rest of the corpus
                    // cannot change what the model is about to be shown.
                    if (hits.length >= MAX_SEARCH_HITS) break
                }
                if (hits.length >= MAX_SEARCH_HITS) break
            }

            if (!hits.length) return `No lore entry mentions "${query}".`
            const header = hits.length >= MAX_SEARCH_HITS
                ? `First ${MAX_SEARCH_HITS} entries mentioning "${query}" (there may be more):`
                : `${hits.length} entr${hits.length === 1 ? 'y' : 'ies'} mentioning "${query}":`
            return [header, ...hits].join('\n\n')
        },

        async inspectBook(bookName: string): Promise<string> {
            const wanted = String(bookName ?? '').trim().toLowerCase()
            if (!wanted) {
                const names = (await books()).map((book) => book.name)
                return names.length
                    ? `inspect_book needs a book name. Available: ${names.join(', ')}`
                    : 'There are no lorebooks to inspect.'
            }

            const book = (await books()).find((candidate) => candidate.name.toLowerCase() === wanted)
            if (!book) {
                const names = (await books()).map((candidate) => candidate.name)
                return `There is no book called "${bookName}".`
                    + (names.length ? ` Available: ${names.join(', ')}` : '')
            }

            const entries = await deps.store.listEntries(book.id)
            if (!entries.length) return `"${book.name}" is empty.`

            const shown = entries.slice(0, MAX_BOOK_LISTING)
            const header = entries.length > shown.length
                ? `"${book.name}" has ${entries.length} entries; the first ${shown.length}:`
                : `"${book.name}" has ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}:`
            return [header, ...shown.map((entry) => summarize(book, entry))].join('\n')
        },

        async readEntry(address: string): Promise<string> {
            const wanted = String(address ?? '').trim()
            const at = wanted.indexOf('::')
            if (at <= 0) return `"${address}" is not an entry address. They look like BookName::4.`

            const bookName = wanted.slice(0, at).toLowerCase()
            const uid = wanted.slice(at + 2)
            const book = (await books()).find((candidate) => candidate.name.toLowerCase() === bookName)
            if (!book) return `There is no book called "${wanted.slice(0, at)}".`

            const entry = (await deps.store.listEntries(book.id)).find((candidate) => candidate.uid === uid)
            if (!entry) return `"${wanted}" is not an entry in "${book.name}".`
            return formatEntry(book, entry)
        },
    }
}
