/**
 * The memo grammar — `[TAG] … [/TAG]`.
 *
 * A memo is the tracker's whole state: one plain-text document the model
 * rewrites each turn, made of named blocks. Everything downstream — the cards,
 * the quest log, the prompt injection — starts by parsing it here.
 *
 * This module is the *read* half. It turns memo text into blocks and blocks
 * into lines, and does nothing else: no merging a model's output into a prior
 * memo, no stripping archived quests, no bench commands. Those all mutate a
 * memo and belong to the write path.
 */

/**
 * Split a memo into its named blocks.
 *
 * Ported from `parseMemoBlocks` in the legacy `renderer.js` at the pin,
 * including two behaviours worth naming because they look like oversights:
 *
 *   - Tags are upper-cased, so `[time]` and `[TIME]` are the same block.
 *   - A repeated tag wins on its *last* occurrence, because each match
 *     overwrites the previous. A model that emits `[TIME]` twice gets the
 *     second one, which is the one it corrected.
 *
 * The pattern requires a matching close tag, so an unterminated block is
 * skipped rather than swallowing the rest of the memo.
 */
export function parseMemoBlocks(memo: string): Record<string, string> {
    const blocks: Record<string, string> = {}
    const pattern = /\[([^\]\/][^\]]*)\]([\s\S]*?)\[\/\1\]/gi
    for (const [, tag, content] of memo.matchAll(pattern)) {
        blocks[tag.trim().toUpperCase()] = content.trim()
    }
    return blocks
}

/**
 * The words a model uses to mean "this block is now empty".
 *
 * Several of the maintainer's authored modules instruct the model never to emit
 * these, precisely because they erase a block rather than leave it alone. On
 * the read side they mean the block has no rows to draw.
 */
export const ERASURE_SENTINEL_RE = /^(?:REMOVED|EXPIRED|CLEARED|NONE)$/i

/** Whether a block's content is one of the erasure sentinels, or simply blank. */
export function isErasedBlockContent(content: string | null | undefined): boolean {
    const trimmed = String(content ?? '').trim()
    return trimmed === '' || ERASURE_SENTINEL_RE.test(trimmed)
}

/** Matches a leading bullet, but not a negative number: `- Sword` yes, `-5 HP` no. */
const BULLET_RE = /^\s*[-*+•–—](?:\s+|(?=[A-Za-z]))/

export interface BlockLines {
    /** Lines as written, trimmed and de-blanked but with bullets intact. */
    raw: string[]
    /** The same lines with a leading bullet removed. */
    lines: string[]
}

/**
 * Split a block's content into lines, the way every block renderer starts.
 *
 * Both forms are returned because the legacy build needs both: bullets are
 * stripped for display, but whether a line *had* a bullet is meaningful in
 * INVENTORY, where a bulleted line is one item and an unbulleted one is a
 * comma-separated list.
 */
export function splitBlockLines(content: string): BlockLines {
    const raw = content
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    return { raw, lines: raw.map((line) => line.replace(BULLET_RE, '')) }
}

/** Whether a line was written as a bullet. */
export function hasBullet(rawLine: string): boolean {
    return BULLET_RE.test(rawLine)
}

/**
 * Strip HTML from memo text, keeping the words.
 *
 * Used before a memo is sent back to a model: colour markup is display-only and
 * costs tokens. `((MARKER))` tokens are deliberately left alone — the model is
 * meant to echo them back, and stripping them would lose every authored
 * module's formatting on the next turn.
 */
export function stripMemoHtml(text: string): string {
    if (!text) return text
    return text.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
}
