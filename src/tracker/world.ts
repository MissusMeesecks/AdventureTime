/**
 * World Progression: the world moving while the party is not looking.
 *
 * Multihog's fourth core component (roadmap row 8). Every in-world day -- or
 * every N hours -- a model is handed a few of the campaign's *locations*,
 * their lore and the reports before it, and writes a short prose report on
 * how each place has moved: trade, sentiment, weather, conflict, scarcity.
 * The newest reports are shown to the narrator, so the world outside the
 * scene has somewhere to have been. Named people are never its subjects;
 * the legacy spent a redesign getting that boundary right, and its runtime
 * contract says so in every call.
 *
 * What is the legacy's is the legacy's: `world-legacy.js` is *generated* from
 * the pinned source (`scripts/extract-world.mjs`, rule 3a-bis) and holds the
 * dossier builder, the rotation, the report sectioner, the clock formatter
 * and every prompt text. This file is the typed face over it plus the parts
 * the legacy did inside its I/O function, made pure: when a pass is due, what
 * the period is called, the two prompts assembled, the consolidation plan and
 * the rolling window.
 *
 * Pure throughout. The pass is `backend/world-pass.ts`; the panel block is in
 * `frontend/tracker-panel.ts`.
 */

import { extractCurrentTimeStr, currentTimeFromMemo, parseInWorldTime } from './time.js'
import { createWorldLegacy } from './world-legacy.js'

/** The two cartridge switches the clock formatter reads. */
export interface WorldClockSettings {
    use24hTime?: boolean
    useDdMmYyFormat?: boolean
}

function legacyFor(settings: WorldClockSettings = {}) {
    return createWorldLegacy({ parseInWorldTime: (s: string) => parseInWorldTime(s), getSettings: () => settings })
}
const plain = legacyFor()

/** `Day 2, 01:00 AM` from minutes since the epoch, in the cartridge's clock style. */
export function formatInWorldTime(totalMinutes: number, settings: WorldClockSettings = {}): string {
    return legacyFor(settings).formatInWorldTime(totalMinutes)
}

/** Where a report's routing metadata lives on its entry. */
export const WORLD_REPORT_METADATA_KEY: string = plain.WORLD_REPORT_METADATA_KEY

/** One entry as the dossier builder reads it: the host's fields it cares about. */
export interface WorldLoreEntry {
    comment?: string
    key?: string[]
    keysecondary?: string[]
    content?: string
    extensions?: Record<string, unknown>
}
/** Books by name, entries by uid. The legacy's archive shape. */
export type WorldBooks = Record<string, { entries: Record<string, WorldLoreEntry> }>

export interface LocationDossier {
    name: string
    aliases: string[]
    text: string
    hasNarrativeLore: boolean
}

/** The campaign's locations, each with its lore and the entity facts that mention it. Maps stripped. */
export function buildLocationDossiers(
    books: WorldBooks,
    options: { prefix?: string; exclusionList?: string } = {},
): { dossiers: LocationDossier[]; globalContext: string } {
    return plain.buildWorldProgressionLocationDossiers(books, options)
}

/** Oldest-unadvanced first; randomness only within a cohort of equal age. */
export function selectLocations(
    dossiers: readonly LocationDossier[],
    options: { count?: number; lastAdvanced?: Record<string, string>; randomize?: boolean; random?: () => number } = {},
): LocationDossier[] {
    return plain.selectWorldProgressionLocations(dossiers, options)
}

export function stampLocationAdvancement(
    lastAdvanced: Record<string, string> | undefined,
    locations: readonly string[],
    periodLabel: string,
): Record<string, string> {
    return plain.stampLocationAdvancement(lastAdvanced, locations, periodLabel)
}

export interface WorldReportMetadata {
    reportId: string
    periodLabel: string
    selectedLocations: string[]
}

export function normalizeWorldReportMetadata(entry: WorldLoreEntry, bookName = '', uid = ''): WorldReportMetadata {
    return plain.normalizeWorldReportMetadata(entry, bookName, uid)
}

/** One location's section plus Wider Currents out of a report. */
/** A report as Map Evolution reads it: its metadata, its text, and -- once selected for a site -- the excerpt that site should feel. */
export interface WorldReportForSite extends WorldReportMetadata {
    content: string
    excerpt?: string
}

/**
 * The reports a site has not yet realized: the last `lookback` globally plus
 * the latest ones targeted at this location, each with the excerpt for it,
 * minus those already applied there. The legacy's selection, as it is.
 */
export function selectPendingWorldReportsForLocation(reports: readonly WorldReportForSite[], siteRoot: string, options: { lookback: number; applied: Record<string, unknown> }): Array<WorldReportForSite & { excerpt: string }> {
    return plain.selectPendingWorldReportsForLocation(reports, siteRoot, options)
}

export function extractWorldReportForLocation(report: string, siteRoot: string, coverage: readonly string[] = []): string {
    return plain.extractWorldReportForLocation(report, siteRoot, [...coverage])
}

/** `World` or `*_World`: the book the reports live in, by the legacy's naming. */
export function isWorldBookName(name: string | null | undefined): boolean {
    const lower = String(name ?? '').toLowerCase()
    return lower === 'world' || lower.endsWith('_world')
}

// ── when ─────────────────────────────────────────────────────────────────

export type WorldPassDecision =
    /** The memo has no readable `[TIME]`; nothing can be decided. */
    | { kind: 'no-time' }
    /** Never fired: the clock starts now, and the first report is one interval away. */
    | { kind: 'start'; label: string; currentMinutes: number }
    /** Not yet. */
    | { kind: 'wait'; currentMinutes: number; dueAtMinutes: number }
    /** The interval has elapsed. */
    | { kind: 'due'; currentMinutes: number; timeStr: string; periodLabel: string }

/**
 * Whether a pass is due, the legacy's `maybeRunWorldProgression` made pure.
 *
 * Fires at most once per interval and never twice for one period. The first
 * sighting of a clock records it as the start of the first interval rather
 * than firing: a report on a world that has had no time to move would be a
 * report on nothing.
 */
export function decideWorldPass(input: {
    memo: string | null | undefined
    lastFiredPeriodLabel: string | null | undefined
    intervalHours: number
    settings?: WorldClockSettings
}): WorldPassDecision {
    const timeStr = extractCurrentTimeStr(currentTimeFromMemo(input.memo))
    const currentMinutes = parseInWorldTime(timeStr)
    if (currentMinutes === null || currentMinutes < 0) return { kind: 'no-time' }

    const intervalMinutes = Math.max(1, Number(input.intervalHours) || 24) * 60
    const lastLabel = String(input.lastFiredPeriodLabel ?? '').trim()
    const lastFired = lastLabel ? parseInWorldTime(lastLabel) : null
    if (lastFired === null) {
        return { kind: 'start', label: formatInWorldTime(currentMinutes, input.settings), currentMinutes }
    }
    if (currentMinutes - lastFired < intervalMinutes) {
        return { kind: 'wait', currentMinutes, dueAtMinutes: lastFired + intervalMinutes }
    }
    return {
        kind: 'due',
        currentMinutes,
        timeStr,
        periodLabel: periodLabelFor({
            lastFiredPeriodLabel: lastLabel,
            currentMinutes,
            intervalHours: input.intervalHours,
            settings: input.settings,
        }),
    }
}

/**
 * What the next report is called: the end of the period it covers.
 *
 * The legacy's `computePeriodLabel`: the period starts where the last one
 * ended (or one interval ago, for a first forced run) and the label is its
 * end, formatted in the cartridge's clock style. So daily reports read
 * `Day 2, 08:00 AM`, `Day 3, 08:00 AM`, … whatever hour the clock is read at.
 */
export function periodLabelFor(input: {
    lastFiredPeriodLabel: string | null | undefined
    currentMinutes: number
    intervalHours: number
    settings?: WorldClockSettings
}): string {
    const intervalMinutes = Math.max(1, Number(input.intervalHours) || 24) * 60
    const lastLabel = String(input.lastFiredPeriodLabel ?? '').trim()
    const lastFired = lastLabel ? parseInWorldTime(lastLabel) : null
    const periodStart = lastFired !== null ? lastFired : input.currentMinutes - intervalMinutes
    return formatInWorldTime(periodStart + intervalMinutes, input.settings)
}

// ── the prompts ──────────────────────────────────────────────────────────

/** The legacy's word target, substituted into a prompt that asks for one. */
export const WORLD_WORD_TARGET = 600

/**
 * The system prompt: the cartridge's own text with the period substituted,
 * the date rule when the calendar is DD/MM, the runtime contract always --
 * an authority boundary, not a style, so it goes on even under a customised
 * prompt -- and the user's extra instructions for this run.
 */
export function buildWorldSystemPrompt(input: {
    template: string | null | undefined
    periodLabel: string
    useDdMmYyFormat?: boolean
    extraInstructions?: string | null
    wordTarget?: number
}): string {
    let system = String(input.template ?? '')
        .replace(/\{periodLabel\}/g, input.periodLabel)
        .replace(/\{wordTarget\}/g, String(input.wordTarget ?? WORLD_WORD_TARGET))
    if (input.useDdMmYyFormat) system += plain.WORLD_DATE_FORMAT_RULE
    system += plain.WORLD_RUNTIME_CONTRACT
    const extra = String(input.extraInstructions ?? '').trim()
    if (extra) system += `\n\n## EXTRA INSTRUCTIONS FOR THIS RUN\n${extra}`
    return system
}

/** `### label\ncontent` for each prior report, newest last; the last N when a lookback is set. */
export function historicalReportLines(
    reports: ReadonlyArray<{ comment?: string; key?: string[]; content?: string }>,
    historyLookback = 0,
): string[] {
    const window = historyLookback > 0 ? reports.slice(-historyLookback) : reports
    const lines: string[] = []
    for (const entry of window) {
        const content = String(entry.content ?? '').trim()
        if (!content) continue
        const label = String(entry.comment || entry.key?.[0] || 'Prior report').trim()
        lines.push(`### ${label}\n${content}`)
    }
    return lines
}

/** The user prompt, assembled as the legacy's pass assembles it. */
export function buildWorldUserPrompt(input: {
    selected: readonly LocationDossier[]
    globalContext: string
    history: readonly string[]
    recentNarrative?: string
    periodLabel: string
}): string {
    const names = input.selected.map((d) => d.name)
    const designated = names.length
        ? names.map((name) => `- ${name}`).join('\n')
        : '(No recorded locations are available; write only Wider Currents.)'
    const dossierDump = input.selected.length
        ? input.selected.map((d) => `# ${d.name}\n${d.text}`).join('\n\n')
        : '(No location dossiers available.)'
    const historicalDump = input.history.length ? input.history.join('\n\n') : 'No prior World Progression reports.'
    let user = plain.buildWorldUserPromptBody(designated, dossierDump, { globalContext: input.globalContext }, historicalDump)
    if (input.recentNarrative?.trim()) user += plain.worldRecentNarrativeSection(input.recentNarrative)
    user += plain.worldClosingLine(input.periodLabel)
    return user
}

/** The keys a report entry is filed under, as the legacy files them. */
export function reportKeys(periodLabel: string): string[] {
    return plain.worldReportKeys(periodLabel)
}

// ── the archive ──────────────────────────────────────────────────────────

/** A report entry as the pass reads it back: the host's id, the book's uid, the fields. */
export interface WorldReportEntry {
    id: string
    uid: string
    comment: string
    content: string
    extensions?: Record<string, unknown>
}

/** Oldest first, by uid: insertion order is the archive's chronology. */
/**
 * Oldest first. The legacy sorts by uid as a number, which is the filing
 * order on SillyTavern; Spindle's uids are slugs, and `Number('the-oath-mark')`
 * is `NaN`, so that comparator sorted nothing and the window showed whichever
 * report the host happened to list last (lesson 40). So: the host's creation
 * stamp when both have one, then the numeric uid when both are numbers, then
 * the period the label names, then the order given.
 */
export function sortReports<T extends { uid: string; comment?: string; createdAt?: number }>(entries: readonly T[]): T[] {
    // One rule for the whole list, decided once, so the order is total: a
    // comparator that picks a tier per pair is not transitive.
    if (entries.length && entries.every((e) => Number.isFinite(e.createdAt))) {
        return [...entries].sort((a, b) => (a.createdAt as number) - (b.createdAt as number))
    }
    if (entries.length && entries.every((e) => e.uid.trim() !== '' && Number.isFinite(Number(e.uid)))) {
        return [...entries].sort((a, b) => Number(a.uid) - Number(b.uid))
    }
    // By the period the label names; a label that names none (a consolidated
    // range) is older than any raw report, and the sort is stable.
    const when = (e: T): number => {
        const minutes = parseInWorldTime(String(e.comment ?? ''))
        return minutes !== null && minutes >= 0 ? minutes : Number.NEGATIVE_INFINITY
    }
    return [...entries].sort((a, b) => when(a) - when(b))
}

/** The report already filed for a period, if any -- the duplicate the pass must not write twice. */
export function findReportForPeriod<T extends { comment: string }>(entries: readonly T[], periodLabel: string): T | undefined {
    const clean = periodLabel.toLowerCase().trim()
    return entries.find((entry) => String(entry.comment ?? '').toLowerCase().trim() === clean)
}

/** A raw daily report, as against a consolidated range -- the legacy's test, verbatim. */
export function isRawReport(label: string): boolean {
    return plain.isRawReport(label)
}

export interface ConsolidationPlan<T> {
    toConsolidate: T[]
    label: string
    system: string
    user: string
}

/**
 * Whether the archive is due a compression, and the call that does it.
 *
 * The legacy's pre-step: once `interval` raw reports have piled up, the oldest
 * `interval` of them are merged by a second model call into one range entry,
 * so the history dump a new report reads stays bounded. The label is `Day
 * N–M`, or `Day N (Condensed)` when they share a day.
 */
export function consolidationPlan<T extends { uid: string; comment: string; content: string }>(
    entries: readonly T[],
    interval: number,
): ConsolidationPlan<T> | null {
    const step = Math.max(2, Number(interval) || 7)
    const raw = sortReports(entries).filter((e) => isRawReport(String(e.comment ?? '').trim()))
    if (raw.length < step) return null
    const toConsolidate = raw.slice(0, step)
    const rawDump = toConsolidate.map((e) => `### ${e.comment.trim()}\n${e.content.trim()}`).join('\n\n')
    const dayNums = toConsolidate
        .map((e) => e.comment.match(/Day\s+(\d+)/i))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map((m) => parseInt(m[1]!, 10))
    const minDay = dayNums.length ? Math.min(...dayNums) : 1
    const maxDay = dayNums.length ? Math.max(...dayNums) : minDay
    const label = minDay === maxDay ? `Day ${minDay} (Condensed)` : `Days ${minDay}–${maxDay}`
    return {
        toConsolidate,
        label,
        system: plain.buildConsolidationSystemPrompt(label),
        user: plain.buildConsolidationUserPrompt(toConsolidate, label, rawDump),
    }
}

/**
 * The rolling window: the newest `keepActive` reports are shown to the
 * narrator, the rest are archive. Both lists, from the archive in order.
 */
export function rollingWindow<T>(sorted: readonly T[], keepActive: number): { active: T[]; archived: T[] } {
    const keep = Math.max(1, Math.floor(Number(keepActive) || 1))
    return {
        active: sorted.slice(-keep),
        archived: sorted.slice(0, Math.max(0, sorted.length - keep)),
    }
}

/** The block the narrator sees, the legacy's heading and entry shape. */
export const WORLD_INJECTION_HEADING = '## WORLD PROGRESSION REPORTS'

export function renderWorldReports(reports: ReadonlyArray<{ label: string; content: string }>): string {
    const block = reports
        .filter((r) => r.content.trim())
        .map((r) => `### [${r.label || 'World Report'}]\n${r.content.trim()}`)
        .join('\n\n')
    return block ? `${WORLD_INJECTION_HEADING}\n${block}` : ''
}

// ── the skeleton (33b) ───────────────────────────────────────────────────
//
// A hidden set of Day 0 macro premises -- factions, locations and conflicts
// -- written once by a model from the user's own description of the world,
// filed in the campaign's `_Skeleton` book, disabled, and read by nobody but
// the pass above: its location entries are subjects for a report until real
// lore for the same place supersedes them, and its factions and conflicts are
// the wider-world context. Named people are never skeleton entries; that is
// the legacy's contract, and the parser drops any section that carries them.

/** `*_Skeleton`: the seed book, by the legacy's naming. */
export function isSkeletonBookName(name: string | null | undefined): boolean {
    return String(name ?? '').toLowerCase().endsWith('_skeleton')
}

/** A book World Progression owns outright: reports or seeds, never the agent's. */
export function isWorldProgressionBookName(name: string | null | undefined): boolean {
    return isWorldBookName(name) || isSkeletonBookName(name)
}

/** The legacy's stock architect prompt, with `{factionCount}` and friends in it. */
export const DEFAULT_WORLD_SKELETON_SYSTEM_PROMPT: string = plain.DEFAULT_WORLD_SKELETON_SYSTEM_PROMPT

export type SkeletonCategory = 'FAC' | 'LOC' | 'EVENT'

/** One premise as the parser reads it from the model's reply. */
export interface SkeletonRecord {
    label: string
    content: string
    category: SkeletonCategory
}

/** What the `comment` of a skeleton entry starts with, by category. */
export const SKELETON_COMMENT_PREFIX: Record<SkeletonCategory, string> = { FAC: 'FACTION', LOC: 'LOCATION', EVENT: 'CONFLICT' }

/** The content stamp every skeleton entry carries; stripped when the entries are shown back to the model. */
export const SKELETON_BASELINE = '[Day 0 Baseline]'

/**
 * The system prompt: the user's own architect prompt or the stock one, with
 * the counts substituted, the macro-only contract always, and the
 * lorebook-only override when the source is to be read literally.
 */
export function buildSkeletonSystemPrompt(input: {
    template?: string | null
    factions: number
    locations: number
    conflicts: number
    lorebookOnly?: boolean
}): string {
    const template = String(input.template ?? '').trim() ? String(input.template) : DEFAULT_WORLD_SKELETON_SYSTEM_PROMPT
    let system = template
        .replace(/\{factionCount\}/g, String(input.factions))
        .replace(/\{locationCount\}/g, String(input.locations))
        .replace(/\{conflictCount\}/g, String(input.conflicts))
    system += plain.WORLD_SKELETON_CONTRACT
    if (input.lorebookOnly) system += plain.WORLD_SKELETON_LOREBOOK_ONLY
    return system
}

/**
 * The selected lorebooks as established canon, for the user prompt. Skeleton
 * books are left out so a seed can never become its own source; `''` when
 * nothing selected has any content.
 */
export function buildSkeletonLorebookContext(
    books: Readonly<Record<string, { entries: Record<string, { comment?: string; key?: string[]; content?: string }> }>>,
    options: { lorebookOnly?: boolean } = {},
): Promise<string> {
    return plain.buildSkeletonLorebookSourceContext(Object.keys(books), async (name: string) => books[name], options)
}

/** The premises already in the book, as the model is shown them when adding; `''` when there are none. */
export function existingSkeletonPremises(entries: ReadonlyArray<{ comment?: string; content?: string; extensions?: Record<string, unknown> }>): string {
    const kept = entries.filter((e) => e.comment && e.content && ['FAC', 'LOC', 'EVENT'].includes(String(e.extensions?.rpgCategory)))
    if (!kept.length) return ''
    const formatted = kept
        .map((e) => `### ${e.comment}\n${String(e.content).replace(/^\[Day 0 Baseline\]\n?/i, '').trim()}`)
        .join('\n\n')
    return plain.skeletonExistingPremises(formatted)
}

/** The user prompt, assembled as the legacy's pass assembles it. */
export function buildSkeletonUserPrompt(input: {
    source: string
    lorebookContext?: string
    existingPremises?: string
    append: boolean
}): string {
    let user = plain.skeletonUserPromptHead(input.source.trim())
    if (input.lorebookContext) user += `${input.lorebookContext}\n\n`
    if (input.existingPremises) user += `## EXISTING SKELETON PREMISES\n${input.existingPremises}\n\n`
    user += plain.skeletonClosingLine(input.append)
    return user
}

/** The model's reply as premises: `## FACTIONS` / `### Name` / prose, by the legacy's reading. Unknown sections are dropped. */
export function parseSkeletonOutput(raw: string): SkeletonRecord[] {
    return plain.parseSkeletonOutput(String(raw ?? ''))
}

/** The entry a premise is filed as: no keys, disabled, stamped, and marked for the pass. */
export function skeletonEntry(record: SkeletonRecord): { key: string[]; comment: string; content: string; disabled: boolean; extensions: Record<string, unknown> } {
    return {
        key: [],
        comment: `${SKELETON_COMMENT_PREFIX[record.category] ?? 'ENTITY'}: ${record.label}`,
        content: `${SKELETON_BASELINE}\n${record.content}`,
        disabled: true,
        extensions: { rpgCategory: record.category, rpgSkeleton: true },
    }
}

/**
 * A seed's name without its category: `LOCATION: Harrowgate` is Harrowgate.
 *
 * The legacy's generator files seeds under prefixed comments and its library
 * reads the comment as the name verbatim, so a report there designates
 * "LOCATION: Harrowgate" and real lore for Harrowgate never supersedes the
 * seed. The library's own tests use plain names for skeleton entries, which
 * is what it was written against; the pass hands it those (lesson 39).
 */
export function skeletonLabel(comment: string | null | undefined): string {
    return String(comment ?? '').replace(/^(?:FACTION|LOCATION|CONFLICT|ENTITY):\s*/i, '').trim()
}

export interface SkeletonCounts {
    factions: number
    locations: number
    conflicts: number
}

/** How many of each the book holds, by the category the entries carry. */
export function countSkeleton(entries: ReadonlyArray<{ extensions?: Record<string, unknown> }>): SkeletonCounts {
    const counts: SkeletonCounts = { factions: 0, locations: 0, conflicts: 0 }
    for (const entry of entries) {
        const category = String(entry.extensions?.rpgCategory ?? '').toUpperCase()
        if (category === 'FAC') counts.factions += 1
        else if (category === 'LOC') counts.locations += 1
        else if (category === 'EVENT') counts.conflicts += 1
    }
    return counts
}

/** The counts in words: `4 factions, 4 locations, 3 conflicts`. */
export function describeSkeletonCounts(counts: SkeletonCounts): string {
    const word = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
    return `${word(counts.factions, 'faction', 'factions')}, ${word(counts.locations, 'location', 'locations')}, ${word(counts.conflicts, 'conflict', 'conflicts')}`
}

// ── the source, from the chat (33c) ──────────────────────────────────────

/** The legacy's summarising prompt: one generalised paragraph, no names, no plot. */
export const WORLD_SOURCE_SYSTEM_PROMPT: string = plain.WORLD_SOURCE_SYSTEM_PROMPT

/** The user prompt around the recent chat, one `Who: text` line each, as the legacy frames it. */
export function buildWorldSourceUserPrompt(lines: readonly string[]): string {
    return plain.worldSourceUserPrompt(lines.join('\n\n'))
}

/** The model's paragraph, trimmed, with a pair of surrounding quotes taken off as the legacy takes them. */
export function cleanWorldSource(raw: string): string {
    let summary = String(raw ?? '').trim()
    if (summary.startsWith('"') && summary.endsWith('"')) summary = summary.slice(1, -1).trim()
    if (summary.startsWith("'") && summary.endsWith("'")) summary = summary.slice(1, -1).trim()
    return summary
}
