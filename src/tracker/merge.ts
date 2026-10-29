/**
 * Folding a tracker pass's output back into the memo.
 *
 * This is the most consequential function in the extension. The tracker pass
 * asks a model what changed this turn, and `mergeMemo` decides what that answer
 * does to state the user has been accumulating for a hundred turns. Get it
 * wrong in the cautious direction and an update is lost; get it wrong in the
 * other direction and a campaign's worth of authored state is deleted by a
 * model having a bad turn.
 *
 * So it is ported from `memo-processor.js` at the pin rather than reasoned out,
 * and the safety properties are the ones the legacy build arrived at:
 *
 *   - **Output with no closed `[TAG]…[/TAG]` block changes nothing.** A model
 *     that answers "no changes", refuses, or returns prose cannot clear the
 *     memo. This is the single most important line in the file.
 *   - **Only the blocks the model emitted are touched.** Everything else is
 *     carried forward untouched, which is what lets a pass output one changed
 *     section instead of restating the whole memo.
 *   - **Erasure has to be spelled.** A block is removed only for an explicit
 *     `REMOVED`/`EXPIRED`/`CLEARED`/`NONE`/`END_COMBAT`, or for an empty pair —
 *     which carries no information and would otherwise be written into the
 *     memo as literal clutter.
 */

import {
    applyBenchCommands,
    benchedNames,
    extractBenchCommands,
    hydratePartyRelocationStats,
    unmatchedBenchCommands,
    isBenchCommandOnlyContent,
} from './bench.js'
import { parseMemoBlocks } from './memo.js'

/** Escape a string for literal use inside a regular expression. */
export function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The words a tracker pass uses to mean "delete this block". */
const REMOVAL_RE = /^(?:REMOVED|EXPIRED|CLEARED|NONE|END_COMBAT)$/i

/**
 * Collapse repeated blocks, keeping the last of each.
 *
 * A model that emits `[XP]` twice has usually corrected itself, so the later
 * one wins — the same rule `parseMemoBlocks` follows when reading.
 *
 * Two ported quirks, both load-bearing:
 *
 *   - The scan for duplicate tags matches `[A-Z_]+` only, so a tag containing a
 *     space (`[BENCHED PARTY]`) is never deduplicated here. Widening it would
 *     change which memos get rewritten, so it stays as it is.
 *   - A deduplicated block is **moved to the end** of the memo, because the
 *     duplicates are cut out and the survivor appended. Block order is set by
 *     `blockOrder` at render time, so this is invisible in the cards, but it
 *     does mean the stored text is reordered.
 */
export function deduplicateMemo(memo: string): string {
    if (!memo) return ''

    const tags = new Set<string>()
    for (const match of memo.matchAll(/\[([A-Z_]+)\]/gi)) {
        tags.add(match[1].toUpperCase())
    }

    let cleaned = memo
    for (const tag of tags) {
        const pattern = new RegExp(`\\[${escapeRegex(tag)}\\][\\s\\S]*?\\[\\/${escapeRegex(tag)}\\]`, 'gi')
        const blocks = [...memo.matchAll(pattern)]
        if (blocks.length <= 1) continue

        const lastBlock = blocks[blocks.length - 1][0]
        cleaned = cleaned.replace(pattern, '---DEDUP_MARKER---')
        cleaned = `${cleaned.split('---DEDUP_MARKER---').join('').trim()}\n\n${lastBlock}`
    }

    return cleaned.replace(/\n{3,}/g, '\n\n').trim()
}

export interface MergeResult {
    memo: string
    /** Tags the pass rewrote. */
    replaced: string[]
    /** Tags the pass introduced. */
    added: string[]
    /** Tags the pass explicitly erased. */
    removed: string[]
    /**
     * Members who joined the benched roster this merge, and members who left
     * it, by name. Read off the memo before and after rather than off the
     * commands, so a tracker that moved someone by hand is reported too. A
     * bench reads as "updated PARTY" otherwise, which is also what losing a
     * member looks like -- the first live bench could not be told from that.
     */
    benched: string[]
    unbenched: string[]
    /**
     * Bench and unbench commands that named nobody on either roster, by the
     * name the command used. The legacy skips them silently; the first live
     * bench was `[BENCH] Oswin` against a header of `Advisor`, and the
     * report read *updated PARTY* with nobody moved. Empty with benching off.
     */
    unmatched: string[]
    /**
     * The pass produced no usable block, so the memo is untouched.
     *
     * Not an error — "nothing changed this turn" is a normal and frequent
     * answer. Worth surfacing because it is also what a refusal or a truncated
     * response looks like, and the two are indistinguishable from here.
     */
    noChange: boolean
}

export interface MergeOptions {
    /**
     * Read `[BENCH]`/`[UNBENCH]` commands and move the member's full sheet
     * between `[PARTY]` and `[BENCHED PARTY]` (Phase 29). Off, the commands
     * are ignored and a command-only block is stored as text -- exactly the
     * legacy with the benched-party module switched off, which is what every
     * build before this one did.
     */
    bench?: boolean
}

/**
 * Merge a tracker pass's output into the memo, reporting what it did.
 *
 * One legacy behaviour is deliberately absent: the archiving of defeated
 * combatants out of `[COMBAT]` into a separate list. A defeated combatant
 * stays in the block instead of moving to an archive.
 *
 * Benching is the legacy's exactly, and runs in the legacy's order: a
 * command-only `[BENCHED PARTY]` block is skipped by the block loop and
 * applied after the dedupe; an output with commands and no closed block at
 * all is the one exception to "no block, no change", because the commands
 * are the change. And every merge, benching on or off, ends by hydrating a
 * member listed by a bare header back to their full sheet from the prior
 * memo -- the tracker only ever sees the compact roster.
 */
export function mergeMemoDetailed(currentMemo: string, aiOutput: string, opts: MergeOptions = {}): MergeResult {
    const benchCommands = opts.bench ? extractBenchCommands(aiOutput) : { benches: [], unbenches: [] }
    const hasBenchWork = benchCommands.benches.length > 0 || benchCommands.unbenches.length > 0

    const tagPattern = /\[([^\]\/][^\]]*)\]([\s\S]*?)\[\/\1\]/gi
    const matches = [...(aiOutput || '').matchAll(tagPattern)]

    // The load-bearing line. Prose, a refusal, an empty string or a truncated
    // response all land here, and none of them may touch the memo -- unless
    // the output is bench commands, which the legacy applies on their own.
    if (matches.length === 0) {
        if (hasBenchWork) {
            const memo = hydratePartyRelocationStats(currentMemo, applyBenchCommands(currentMemo, currentMemo, benchCommands))
            return {
                memo,
                replaced: memo === currentMemo ? [] : ['PARTY'],
                added: [],
                removed: [],
                ...rosterMoves(currentMemo, memo),
                unmatched: unmatchedBenchCommands(memo, benchCommands),
                noChange: memo === currentMemo,
            }
        }
        return { memo: currentMemo, replaced: [], added: [], removed: [], benched: [], unbenched: [], unmatched: [], noChange: true }
    }

    let memo = currentMemo
    const replaced: string[] = []
    const added: string[] = []
    const removed: string[] = []

    for (const match of matches) {
        const tag = match[1].trim()
        const newContent = match[2].trim()
        const escapedTag = escapeRegex(tag)

        // Commands are applied below, never stored as the block's text -- and
        // the legacy skips them here whether or not the module is on, so with
        // benching off a command-only block is dropped rather than kept.
        if (tag.toUpperCase() === 'BENCHED PARTY' && isBenchCommandOnlyContent(newContent)) continue

        // The leading \s* takes the blank line above the block with it, so
        // removing a block does not leave a gap behind.
        const existingPattern = new RegExp(`\\s*\\[${escapedTag}\\][\\s\\S]*?\\[\\/${escapedTag}\\]`, 'i')

        if (newContent === '' || REMOVAL_RE.test(newContent)) {
            const before = memo
            memo = memo.replace(existingPattern, '').trim()
            if (memo !== before) removed.push(tag.toUpperCase())
            continue
        }

        const fullBlock = `[${tag}]\n${newContent}\n[/${tag}]`
        const before = memo

        // Replaced via a function so that a `$&` or `$1` in the model's output
        // is written literally instead of being read as a substitution.
        memo = memo.replace(existingPattern, () => `\n\n${fullBlock}`)

        if (memo !== before) {
            replaced.push(tag.toUpperCase())
        } else {
            memo = `${memo.trimEnd()}\n\n${fullBlock}`
            added.push(tag.toUpperCase())
        }
    }

    const cleaned = memo.replace(/\n{3,}/g, '\n\n').trim()
    let result = deduplicateMemo(cleaned)
    if (hasBenchWork) {
        const before = result
        result = applyBenchCommands(currentMemo, result, benchCommands)
        // Only when a command moved someone. A command for a name nobody has
        // changes nothing, and reporting "updated PARTY" for it is exactly the
        // report the first live bench produced (Phase 29b).
        if (result !== before && !replaced.includes('PARTY') && !added.includes('PARTY')) replaced.push('PARTY')
    }
    const memoOut = hydratePartyRelocationStats(currentMemo, result)
    return {
        memo: memoOut,
        replaced,
        added,
        removed,
        ...rosterMoves(currentMemo, memoOut),
        unmatched: hasBenchWork ? unmatchedBenchCommands(memoOut, benchCommands) : [],
        // Every block was a command-only one and no command moved anyone.
        noChange: !replaced.length && !added.length && !removed.length && memoOut === currentMemo,
    }
}

/** Who moved onto the benched roster and who came off it, between two memos. */
function rosterMoves(before: string, after: string): { benched: string[]; unbenched: string[] } {
    const was = new Set(benchedNames(before).map((n) => n.toLowerCase()))
    const now = benchedNames(after)
    const nowKeys = new Set(now.map((n) => n.toLowerCase()))
    return {
        benched: now.filter((n) => !was.has(n.toLowerCase())),
        unbenched: benchedNames(before).filter((n) => !nowKeys.has(n.toLowerCase())),
    }
}

/** `mergeMemoDetailed`, when only the resulting memo is wanted. */
export function mergeMemo(currentMemo: string, aiOutput: string, opts: MergeOptions = {}): string {
    return mergeMemoDetailed(currentMemo, aiOutput, opts).memo
}

export interface MemoDelta {
    added: string[]
    removed: string[]
    changed: string[]
}

/**
 * What changed between two memos, by block.
 *
 * Compares parsed blocks rather than text, so the reordering `deduplicateMemo`
 * can cause does not register as a change.
 */
export function computeDelta(oldMemo: string, newMemo: string): MemoDelta {
    const before = parseMemoBlocks(oldMemo || '')
    const after = parseMemoBlocks(newMemo || '')

    const added = Object.keys(after).filter((tag) => before[tag] === undefined)
    const removed = Object.keys(before).filter((tag) => after[tag] === undefined)
    const changed = Object.keys(after).filter((tag) => before[tag] !== undefined && before[tag] !== after[tag])

    return { added, removed, changed }
}
