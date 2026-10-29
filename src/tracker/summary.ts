/**
 * One line that says what a memo holds.
 *
 * The card under a message is folded away by default — a full tracker card
 * under every reply would bury the story it is annotating — so the fold's own
 * header has to be worth reading on its own. This is that header: the in-world
 * time, and the blocks that turn touched.
 *
 * Pure and host-free, like everything else under `tracker/`: it takes a view
 * and returns text, so what it says can be asserted without a DOM.
 */

import type { TrackerView } from './view.js'

/** Blocks whose name in a summary line would be noise rather than information. */
const NOT_WORTH_NAMING = new Set(['TIME'])

export interface TrackerSummary {
    /** The in-world clock, when the memo carries one. `''` otherwise. */
    time: string
    /** The blocks worth naming, in view order. */
    tags: string[]
    /** The whole line, ready to draw. */
    text: string
}

/**
 * The in-world time, from the `[TIME]` block's first line.
 *
 * Read from the view rather than re-parsed out of the memo, so a block the
 * model wrote unusually still contributes whatever it says instead of nothing.
 */
function readTime(view: TrackerView): string {
    const block = view.blocks.find((b) => b.tag === 'TIME')
    if (!block || block.erased) return ''

    const first = block.raw
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.length > 0)

    return first ?? ''
}

/**
 * Summarise a memo for a fold header.
 *
 * An erased block is left out: the model saying `[INVENTORY] NONE` means the
 * inventory is empty, and naming it in a one-line summary would suggest there
 * is something to open the card for.
 */
export function summariseTrackerView(view: TrackerView): TrackerSummary {
    const time = readTime(view)
    const tags = view.blocks
        .filter((block) => !block.erased && !NOT_WORTH_NAMING.has(block.tag))
        .map((block) => block.label)

    const parts: string[] = []
    if (time) parts.push(time)
    if (tags.length) parts.push(tags.join(', '))

    return { time, tags, text: parts.join(' · ') || 'Tracker state' }
}
