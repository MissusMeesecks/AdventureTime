/**
 * The tracker's Change Log (78d): Multihog's `computeDelta` of
 * `memo-processor.js`, transcribed, and the token estimate its footer prints.
 *
 * The legacy diffs two memos as *sets of trimmed lines*: a line of the old memo
 * that the new one lacks is removed, a line of the new memo the old one lacks
 * is added, the removed first, each set in first-appearance order, duplicates
 * folded. A reordering therefore registers as nothing, and a line that moved
 * between blocks as nothing either. The four empty-state texts are the
 * legacy's words. `change-log.pin.test.ts` runs the checkout's own function
 * beside this over a corpus.
 *
 * The estimate is the legacy's `~N tokens` of its footer: the memo's length
 * over 2.62, rounded (`panel-markup.js`, `panel-builder.js`).
 */
import { escapeHtml } from './html.js'

export const CHANGE_LOG_TEXT = {
    /** Neither memo has anything. */
    none: 'No memo yet.',
    /** The old memo was empty: everything is new. */
    initial: '+ (initial memo created)',
    /** Both memos hold the same lines. */
    unchanged: 'No changes detected.',
    /** Nothing has been diffed for this chat since the panel was drawn. */
    noneYet: 'No changes yet.',
    /** The ✕ on the toolbar, or CLEAR, emptied it. */
    cleared: 'Log cleared.',
} as const

export interface ChangeLogLine {
    kind: 'removed' | 'added'
    /** The memo line, trimmed, without the `- ` or `+ ` the renderer puts before it. */
    text: string
}

export type ChangeLog =
    | { kind: 'empty'; text: string; /** The initial-memo case draws as an added line, not a muted note. */ added?: boolean }
    | { kind: 'lines'; lines: ChangeLogLine[] }

/** Multihog's `computeDelta(oldMemo, newMemo)`, as data rather than HTML. */
export function memoChangeLog(oldMemo: string, newMemo: string): ChangeLog {
    if (!oldMemo && !newMemo) return { kind: 'empty', text: CHANGE_LOG_TEXT.none }
    if (!oldMemo) return { kind: 'empty', text: CHANGE_LOG_TEXT.initial, added: true }

    const oldLines = new Set(oldMemo.split('\n').map((l) => l.trim()).filter(Boolean))
    const newLines = new Set(newMemo.split('\n').map((l) => l.trim()).filter(Boolean))

    const added = [...newLines].filter((l) => !oldLines.has(l))
    const removed = [...oldLines].filter((l) => !newLines.has(l))

    if (added.length === 0 && removed.length === 0) return { kind: 'empty', text: CHANGE_LOG_TEXT.unchanged }

    return {
        kind: 'lines',
        lines: [
            ...removed.map((text): ChangeLogLine => ({ kind: 'removed', text })),
            ...added.map((text): ChangeLogLine => ({ kind: 'added', text })),
        ],
    }
}

/**
 * The log as the legacy draws it, with its three class names under the
 * `lh-delta-` prefix: `- ` before a removed line, `+ ` before an added one.
 */
export function renderChangeLogHtml(log: ChangeLog): string {
    if (log.kind === 'empty') {
        return `<span class="${log.added ? 'lh-delta-added' : 'lh-delta-empty'}">${escapeHtml(log.text)}</span>`
    }
    return log.lines
        .map((line) => line.kind === 'removed'
            ? `<div class="lh-delta-removed">- ${escapeHtml(line.text)}</div>`
            : `<div class="lh-delta-added">+ ${escapeHtml(line.text)}</div>`)
        .join('')
}

/** The legacy footer's `~N tokens`: characters over 2.62, rounded. */
export const MEMO_TOKEN_DIVISOR = 2.62

export function memoTokenEstimate(memo: string): number {
    return Math.round((memo || '').length / MEMO_TOKEN_DIVISOR)
}
