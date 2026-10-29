/**
 * What the campaign's books already hold, in one paragraph the model can read
 * before it does anything.
 *
 * The first pass that wrote successfully used **two of its ten turns**: one
 * `grep_lore`, then a commit updating five entries it had just been shown. It
 * added nothing, and the campaign's Events book still held a single entry for
 * day three while the story it had just read covered days one and two as well.
 *
 * Nothing about that was unreasonable from where the model sat. It was handed
 * three book *names* and no contents, so the eight entries a search returned
 * were, as far as it could tell, the lore. You cannot notice a gap in a list
 * you have never seen.
 *
 * This is the same finding as 9j's, for the third time: the legacy pasted the
 * active set and an archive index into its prompt, so its model started already
 * looking at the lore and searched only to fill gaps. Port the context a
 * behaviour assumes, or do not expect the behaviour.
 *
 * **Addresses, not just titles** (9p). The titles-only version worked — seven
 * new entries where the pass before added none — but the model then spent three
 * turns calling `inspect_book` on the three books it had just been shown, to
 * turn those titles into ids it could address, and burned a fourth inventing
 * `VellmoorTest_World::the-oath-mark`, which does not exist. Half the
 * pass went on a lookup the index could have answered. It now carries the full
 * address beside each title, so there is nothing left to look up and nothing to
 * invent.
 *
 * Bodies are still not in here. The question is coverage — which subjects
 * exist — and a body the model wants is one `read_entry` away.
 */

import { stripStamp } from './provenance.js'
/** The slice of an entry an index needs. */
export interface IndexEntry {
    uid: string
    comment: string
}

/** One book and what is in it. */
export interface IndexBook {
    name: string
    entries: readonly IndexEntry[]
}

/**
 * Entries listed per book before the rest are summarised as a count.
 *
 * A campaign with hundreds of entries must not push the narrative out of the
 * prompt. Thirty is enough to see the shape of a book; past that, the count is
 * the useful part. Lower than 9o's forty because each line now carries a whole
 * address, and a host id is a 36-character GUID.
 */
export const MAX_INDEX_ENTRIES = 30

/** An entry whose title is blank, so the line never reads as a gap. */
const UNTITLED = '(untitled)'

/**
 * The campaign's own books, their entries and the address of each.
 *
 * Returns `''` when the campaign has no books — the prompt says something
 * different in that case, and an empty heading would read as "your books hold
 * nothing", which is not the same claim.
 */
export function buildCampaignIndex(books: readonly IndexBook[]): string {
    if (!books.length) return ''

    return books
        .map((book) => {
            const entries = book.entries
            const count = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`
            if (!entries.length) return `${book.name}: (empty)`

            const shown = entries.slice(0, MAX_INDEX_ENTRIES)
            const rest = entries.length - shown.length
            const lines = shown.map((entry) => {
                // Without the provenance stamp. It is for a person reading
                // the book, not for the model: showing it here would put a turn
                // number in front of the model on every pass, which it would
                // eventually copy into a label of its own.
                const title = stripStamp(entry.comment || '') || UNTITLED
                // Quoted, and an arrow rather than a dash: a real title read
                // `Day Three — Road to Hallen`, and a dash separator made the
                // line `Day Three — Road to Hallen — Book::id`, which does not
                // say where the title stops.
                return `  "${title}" → ${book.name}::${entry.uid}`
            })
            if (rest > 0) lines.push(`  …and ${rest} more, not listed`)
            return [`${book.name} (${count}):`, ...lines].join('\n')
        })
        .join('\n')
}

/**
 * The categories this campaign files things under, from its book names.
 *
 * `record` takes a category and the writer turns it into `Prefix_Category`, so
 * a model that says `NPC` where the campaign has always said `Characters` gets
 * a second book rather than the right one. Live, one pass produced
 * `VellmoorTest_NPC` beside `VellmoorTest_Characters` and
 * `VellmoorTest_Event` beside `VellmoorTest_Events` in a single commit.
 *
 * Nothing had told it which categories existed. The book names knew all along.
 */
export function categoriesInUse(bookNames: readonly string[], prefix: string): string[] {
    const head = `${prefix}_`
    const seen = new Set<string>()
    const out: string[] = []

    for (const name of bookNames) {
        if (!name.startsWith(head)) continue
        const category = name.slice(head.length)
        if (!category || seen.has(category.toLowerCase())) continue
        seen.add(category.toLowerCase())
        out.push(category)
    }
    return out
}
