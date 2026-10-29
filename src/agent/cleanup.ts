/**
 * The cleanup pass and the full audit (Phase 71c, roadmap row 71):
 * Multihog's 🧹 Cleanup menu and 📕 Full Audit, the pieces of them that are
 * text and rules.
 *
 * **Cleanup** is the legacy's `__CLEANUP__` path: every entry of the
 * campaign's books over a token threshold (or the one entry named) is put in
 * front of the *Lorebook Archivist* — a system prompt of its own, not the
 * agent's — with its full content, and the archivist answers with one
 * `commit` of `rewrite` and `consolidate` items, which the writer applies
 * with `[CORE]` and `[MAP]` kept whole (`protectCoreBlock`). The selection
 * rule, the context format and the no-op lines are transcribed from
 * `router.js`'s cleanup block and pinned to it; the prompt, its two appended
 * texts, the token estimate and the redundancy counter are the legacy's own,
 * sliced into `router-legacy.js`.
 *
 * **The full audit** is the legacy's chunking of the whole chat into pieces
 * of about the context size, each run through the ordinary agent pass with
 * the audit instruction and the chunk in place of the story.
 */

import { stripMapSection } from '../tracker/map.js'
import { createRouterLegacy } from '../tracker/router-legacy.js'
import { isWorldProgressionBookName } from '../tracker/world.js'

const legacy = createRouterLegacy() as unknown as {
    LOREBOOK_FULL_AUDIT_INSTRUCTION: string
    estimateTokens(text: string): number
    countRedundantPairs(content: string, threshold?: number): number
    agentInstructionPrompt: string
    overrideText(customInstructions: string): string
    cleanupTextActionsSuffix: string
}

/** The legacy's instruction to every audit chunk's pass. */
export const AUDIT_INSTRUCTION: string = legacy.LOREBOOK_FULL_AUDIT_INSTRUCTION

/** The legacy's defaults: flag an entry from 300 tokens; auto-cleanup off; the audit's fallback context, 32000. */
export const DEFAULT_CLEANUP_THRESHOLD = 300
export const MIN_CLEANUP_THRESHOLD = 50
export const MAX_CLEANUP_THRESHOLD = 5000
export const DEFAULT_CLEANUP_EVERY = 0
export const MAX_CLEANUP_EVERY = 100
export const DEFAULT_AUDIT_TOKENS = 32000
export const MIN_AUDIT_TOKENS = 4000
export const MAX_AUDIT_TOKENS = 1000000

/** The legacy's ~4 characters a token. */
export function estimateTokens(text: string): number {
    return legacy.estimateTokens(text)
}

/** Near-duplicate line pairs in one entry, by the legacy's bigram Jaccard at 0.6. */
export function countRedundantPairs(content: string): number {
    return legacy.countRedundantPairs(content)
}

/**
 * The archivist's system prompt, as a text-format connection gets it: the
 * agent-mode prompt, the custom requirements when given, then the ACTIONS
 * text. AdventureTime's own calls never carry tools (lesson 51), so the native-tool
 * variant is never sent.
 */
export function cleanupSystemPrompt(customInstructions = ''): string {
    const custom = customInstructions.trim()
    return legacy.agentInstructionPrompt + (custom ? legacy.overrideText(custom) : '') + legacy.cleanupTextActionsSuffix
}

export interface CleanupBook {
    name: string
    entries: ReadonlyArray<{ uid: string; key?: readonly string[]; content?: string; comment?: string }>
}

export interface FlaggedEntry {
    /** `Book::uid`. */
    id: string
    label: string
    tokens: number
    lines: number
    pairs: number
    content: string
}

export interface CleanupSelection {
    /** Flag an entry from this many tokens. */
    threshold: number
    /** Off, every entry is flagged (the legacy's *Use Token Threshold* unticked). */
    useThreshold: boolean
    /** One entry named, `Book::uid`: it alone, whatever its size. */
    target?: string
}

/** A World Progression book: skipped by the scan, as the legacy skips `_world`. */
function skipped(bookName: string): boolean {
    const lower = bookName.toLowerCase()
    return lower.endsWith('_world') || lower === 'world' || isWorldProgressionBookName(bookName)
}

/**
 * Which entries the archivist is shown, biggest first: the legacy's scan.
 *
 * Tokens are counted without a `[MAP]` section, so a mapped root is flagged
 * for its prose alone; the content shown keeps the map, and the writer
 * carries it across whatever the model writes.
 */
export function flagEntries(books: readonly CleanupBook[], selection: CleanupSelection): FlaggedEntry[] {
    const target = selection.target?.trim() || ''
    const flagged: FlaggedEntry[] = []
    for (const book of books) {
        if (skipped(book.name)) continue
        for (const entry of book.entries) {
            const id = `${book.name}::${entry.uid}`
            const content = String(entry.content ?? '')
            const tokens = estimateTokens(stripMapSection(content))
            const isTarget = target !== '' && id === target
            const overThreshold = !selection.useThreshold || tokens >= selection.threshold
            if (isTarget || (!target && overThreshold)) {
                flagged.push({
                    id,
                    label: String(entry.comment ?? '') || entry.key?.[0] || entry.uid,
                    tokens,
                    lines: content.split('\n').filter(Boolean).length,
                    pairs: countRedundantPairs(content),
                    content,
                })
            }
        }
    }
    return flagged.sort((a, b) => b.tokens - a.tokens)
}

/** How many entries are over the threshold, for the hint after a pass and the auto-cleanup. */
export function countBloated(books: readonly CleanupBook[], threshold: number): number {
    return flagEntries(books, { threshold, useThreshold: true }).length
}

/** The legacy's context for a text-format connection: the flagged list, then every flagged entry whole. */
export function cleanupContext(flagged: readonly FlaggedEntry[]): string {
    return '## ENTRIES FLAGGED FOR CONSOLIDATION\n'
        + flagged.map((e) => `- ${e.id} | "${e.label}" | ~${e.tokens} tokens | ${e.lines} lines` + (e.pairs > 0 ? ` | ⚠ ${e.pairs} redundant line pairs` : ' | ✓ low redundancy')).join('\n')
        + '\n\n## ENTRY CONTENTS\n'
        + flagged.map((e) => `### ${e.id} — "${e.label}"\n${e.content}`).join('\n\n')
}

/** The legacy's finish line when the scan found nothing. */
export function nothingToClean(selection: CleanupSelection): string {
    if (selection.target?.trim()) return `Cleanup: targeted entry "${selection.target.trim()}" not found.`
    if (selection.useThreshold) return `Cleanup: no entries exceed the token threshold (${selection.threshold}t). Nothing to do.`
    return 'Cleanup: no entries found in the campaign lorebook. Nothing to do.'
}

/** The legacy's step lines, so the terminal reads as Multihog's does. */
export const CLEANUP_STEPS = {
    scanning: 'Cleanup mode: scanning for bloated entries...',
    targeted: (id: string): string => `Cleanup mode: targeted compression for "${id}"...`,
    found: (n: number): string => `Cleanup: ${n} bloated entr${n === 1 ? 'y' : 'ies'} found. Requesting compression...`,
    compressing: (label: string): string => `Cleanup: compressing target entry "${label}"...`,
    done: (seconds: string): string => `Cleanup done in ${seconds}s.`,
    autoScheduled: (n: number): string => `🧹 Auto-cleanup: ${n} bloated entr${n > 1 ? 'ies' : 'y'} found. Scheduling cleanup pass...`,
    hint: (n: number, threshold: number): string => `💡 ${n} entr${n > 1 ? 'ies' : 'y'} may benefit from cleanup (>${threshold} tokens). Use the 🧹 button to compress.`,
} as const

/** The legacy's commit reason, which the report carries. */
export function cleanupReason(target: string | undefined): string {
    return target?.trim() ? `Targeted cleanup: ${target.trim()}.` : 'Cleanup pass (agent mode).'
}

// ── The full audit ────────────────────────────────────────────────────────

/** One message as the audit reads it: who, and the text left after the cleaning. */
export interface AuditLine {
    name: string
    text: string
}

/** The legacy's chunk budget: the context size less 3000, never under 1000. */
export function auditChunkLimit(maxTokens: number): number {
    return Math.max(1000, Math.floor(maxTokens) - 3000)
}

/**
 * The chat cut into chunks of the budget, the legacy's way: a line is
 * `Name: text`, costed at the token estimate; a line that would overflow a
 * non-empty chunk starts the next; one line never splits, however long;
 * an empty message, or one carrying a JSON fence, is left out.
 */
export function chunkForAudit(lines: readonly AuditLine[], limit: number): string[][] {
    const chunks: string[][] = []
    let current: string[] = []
    let tokens = 0
    for (const { name, text } of lines) {
        const cleaned = String(text ?? '').trim()
        if (!cleaned || cleaned.includes('```json\n[') || cleaned.includes('```json\n{')) continue
        const line = `${name}: ${cleaned}`
        const cost = estimateTokens(line)
        if (tokens + cost > limit && current.length) {
            chunks.push(current)
            current = []
            tokens = 0
        }
        current.push(line)
        tokens += cost
    }
    if (current.length) chunks.push(current)
    return chunks
}

/** The legacy's words at each stage of the audit. */
export const AUDIT_TEXT = {
    nothing: 'No chat history to audit.',
    chunk: (i: number, n: number): string => `Agent Full Audit: Chunk ${i} of ${n}...`,
    skipped: (i: number): string => `Chunk ${i} skipped — agent was still busy.`,
    complete: (n: number): string => `Agent Full Audit complete (${n} chunk${n > 1 ? 's' : ''}).`,
    failed: 'Agent Full Audit failed.',
    stopped: (done: number, n: number): string => `Agent Full Audit stopped after chunk ${done} of ${n}.`,
} as const
