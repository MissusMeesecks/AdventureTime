/**
 * Map Evolution (roadmap row 9, Phase 34c): a site's map changes while the
 * party is away.
 *
 * On an in-world interval per site -- and once when the party leaves one --
 * a model is shown the site's map, how long it has been since the site last
 * evolved, the site's backlog of prior passes, its open causal threads, the
 * World Progression reports it has not yet felt, and a frozen player bubble,
 * and asked for one transaction of EVOLVED operations: patrols move,
 * scavengers arrive, a rival band takes a vacated room, a project leaves a
 * trace. The document library's rules judge it as they judge the updater's
 * (`tracker/updater.ts`), with the bubble frozen and the dead left dead.
 * Each pass leaves a backlog entry and threads behind, so the next pass has
 * a trajectory rather than a blank; when the closed history grows long it
 * is compressed into digests by one more model call. The narrator is given
 * a short briefing of the site's recent off-screen life with its canon.
 *
 * What is the legacy's is the legacy's: `evolution-legacy.js` is *generated*
 * from the pin (CLAUDE.md 3a-bis) and holds the three system prompts, the
 * helper library whole, the prompt builders and the contracts. This file is
 * the typed face; the model calls, the books and the commit are in
 * `backend/map-evolution.ts`.
 */

import { parseArchitectResponse, type ArchitectIssue } from './architect.js'
import { createEvolutionLegacy } from './evolution-legacy.js'
import { createMapLegacy } from './map-legacy.js'
import type { MapDocument } from './map.js'
import { parseInWorldTime } from './time.js'
import { applyTransaction, type AppliedTransaction, type EvolutionThread, type ThreadsBySite } from './updater.js'
import { stripChoiceBlocks } from './cyoa.js'
import { normalizeWorldReportMetadata, selectPendingWorldReportsForLocation, sortReports, type WorldReportForSite } from './world.js'

const map = createMapLegacy()
// The story lookback's chat-log formatter (2026.8.68) reads SillyTavern's
// message shape; the window it would format is chosen by the legacy's own
// `findNthUserMessageStartIdx` (sliced) and formatted by `formatRecentStory`
// below (Phase 45c), so the formatter is closed over a stub here.
const plain = createEvolutionLegacy({
    ...map,
    parseInWorldTime,
    parseMapArchitectResponse: parseArchitectResponse,
    formatAgentChatLogFromIndex: () => '',
})

export const DEFAULT_MAP_EVOLUTION_SYSTEM_PROMPT: string = plain.DEFAULT_MAP_EVOLUTION_SYSTEM_PROMPT
export const DEFAULT_MAP_EVOLUTION_DIRECT_SYSTEM_PROMPT: string = plain.DEFAULT_MAP_EVOLUTION_DIRECT_SYSTEM_PROMPT
export const DEFAULT_MAP_EVOLUTION_COMPRESS_SYSTEM_PROMPT: string = plain.DEFAULT_MAP_EVOLUTION_COMPRESS_SYSTEM_PROMPT
export const MAX_EVOLUTION_CORRECTION_ATTEMPTS = 2
/** The legacy's ceilings and defaults: a week between passes at most, 10k tokens of closed history before compression, 2k for the narrator's briefing. */
export const MAP_EVOLUTION_INTERVAL_MAX_HOURS: number = plain.MAP_EVOLUTION_INTERVAL_MAX_HOURS
export const DEFAULT_MAP_EVOLUTION_COMPRESS_THRESHOLD: number = plain.DEFAULT_MAP_EVOLUTION_COMPRESS_THRESHOLD
export const DEFAULT_MAP_EVOLUTION_NARRATOR_COMMIT_TOKENS: number = plain.DEFAULT_MAP_EVOLUTION_NARRATOR_COMMIT_TOKENS
export const MAP_EVOLUTION_TICK_SCOPES: readonly EvolutionScope[] = plain.MAP_EVOLUTION_TICK_SCOPES as EvolutionScope[]
/** The legacy's story lookback: 20 user turns, 0 to 100. */
export const DEFAULT_MAP_EVOLUTION_LOOKBACK: number = plain.DEFAULT_MAP_EVOLUTION_LOOKBACK
export const MAX_MAP_EVOLUTION_LOOKBACK = 100

/** The legacy's clamp: 0 to 100 user turns, the default for anything unreadable. */
export function normalizeStoryLookback(value: unknown): number {
    return plain.normalizeMapEvolutionLookback(value) as number
}

/** A message as the story window reads it: the host's role and text. */
export interface StoryMessage {
    role: string
    content: string
}

/**
 * The recent story every due site is shown (45c, upstream 2026.8.68 → .71):
 * the chat from the Nth user message back, as the legacy's window chooses
 * it, each message on its own line as `Player:` or `Narrator:` with the
 * narrator's choices stripped, blank lines between. `''` at a lookback of
 * 0 or with nothing to show, which the prompt names as such.
 */
export function formatRecentStory(messages: ReadonlyArray<StoryMessage>, turns: number): string {
    const lookback = normalizeStoryLookback(turns)
    if (!lookback || !messages.length) return ''
    const start = plain.findNthUserMessageStartIdx(messages.map((m) => ({ is_user: m.role === 'user' })), lookback) as number
    const lines: string[] = []
    for (let i = start; i < messages.length; i++) {
        const message = messages[i]!
        if (message.role === 'system') continue
        const content = (message.role === 'assistant' ? stripChoiceBlocks(message.content) : String(message.content ?? '')).trim()
        if (!content) continue
        lines.push(`${message.role === 'user' ? 'Player' : 'Narrator'}: ${content}`)
    }
    return lines.join('\n\n')
}

export type EvolutionTrigger = 'interval' | 'site_exit' | 'manual'
export type EvolutionScope = 'active' | 'count' | 'all' | 'selected'
export type OnSitePreset = 'dynamic' | 'standard'

/** A site's loose key, as every per-site map is keyed. */
export function siteKey(siteRoot: string): string {
    return map.normalizeDungeonLabel(siteRoot)
}

/** The site's ledger, threads and felt reports forgotten, when its map is removed (71a): the legacy's clearer, copies. */
export function clearEvolutionHistoryForSite(state: { backlogBySite: Record<string, unknown[]>; threadsBySite: Record<string, unknown[]>; reportApplicationsBySite: Record<string, Record<string, unknown>> }, siteRoot: string): { backlogBySite: Record<string, unknown[]>; threadsBySite: Record<string, unknown[]>; reportApplicationsBySite: Record<string, Record<string, unknown>>; siteKey: string; cleared: boolean } {
    return plain.clearEvolutionHistoryForSite(state, siteRoot) as ReturnType<typeof clearEvolutionHistoryForSite>
}

// ── time ─────────────────────────────────────────────────────────────────

/** An in-world label as minutes, or -1 when it carries no date or time at all. The legacy's `parseInWorldMinutes`. */
export function parseInWorldMinutes(label: string | null | undefined): number {
    const text = String(label ?? '')
    if (!text) return -1
    if (!/\b(\d{1,2})\/(\d{1,2})\/(\d+)\b/.test(text) && !/(?:Day|D)\s*(\d+)/i.test(text) && !/(\d{1,2}):(\d{2})\s*(AM|PM)?/i.test(text)) return -1
    const minutes = parseInWorldTime(text)
    return minutes != null && Number.isFinite(minutes) ? minutes : -1
}

export interface TimeWindow {
    lastEvolved: string
    currentTime: string
    /** -1 when unknown. */
    elapsedMinutes: number
    elapsed: string
}

/** What the pass is told about this site's clock: when it last evolved, the time now, and the gap in words. */
export function describeTimeWindow(lastEvolvedLabel: string, currentTimeLabel: string): TimeWindow {
    return plain.describeEvolutionTimeWindow(lastEvolvedLabel, currentTimeLabel)
}

export function formatElapsedMinutes(totalMinutes: number): string {
    return plain.formatEvolutionElapsedMinutes(totalMinutes)
}

/** A first visit stamps a baseline and does not fire; later, the interval decides; 0 hours never fires. */
export function siteDue(lastMinutes: number, currentMinutes: number, intervalHours: number): { due: boolean; baseline: boolean } {
    return plain.siteEvolutionDue(lastMinutes, currentMinutes, intervalHours)
}

export interface IntervalSettings {
    /** Hours between passes for a site the party is not in. The legacy's 12. */
    intervalHours: number
    /** For the site they are in: hours and minutes; both 0 means never. The legacy's 1 hour. */
    onSiteIntervalHours: number
    onSiteIntervalMinutes: number
    /** A site's own hours, by its loose key (71d, the legacy's `mapEvolutionIntervalHoursBySite`): wins over both, 0 included. */
    intervalHoursBySite?: Record<string, number>
}

/** The interval for one site: its own hours when it has them (71d), else the on-site one while the party is there, the off-site one otherwise. */
export function resolveSiteIntervalHours(siteRoot: string, settings: IntervalSettings, currentRoot: string): number {
    return plain.resolveSiteEvolutionIntervalHours(siteRoot, { intervalHours: settings.intervalHours, onSiteIntervalHours: settings.onSiteIntervalHours, onSiteIntervalMinutes: settings.onSiteIntervalMinutes, intervalHoursBySite: settings.intervalHoursBySite ?? {}, currentRoot })
}

/** A site's own hours, or `null` when it inherits (71d). */
export function getSiteIntervalOverride(bySite: Record<string, number> | undefined, siteRoot: string): number | null {
    return plain.getSiteEvolutionIntervalOverride(bySite ?? {}, siteRoot) as number | null
}

/** The overrides with one site's hours set (`null` or `''` clears it; capped at the legacy's maximum), as a copy. */
export function setSiteIntervalOverride(bySite: Record<string, number> | undefined, siteRoot: string, hours: number | string | null): Record<string, number> {
    return plain.setSiteEvolutionIntervalOverride(bySite ?? {}, siteRoot, hours as never) as Record<string, number>
}

/** The memo with its `[TIME]` line replaced, or a block added when it has none (71d): the legacy's `replaceMemoCurrentTime`. */
export function replaceMemoCurrentTime(memo: string, timeLabel: string): string {
    return plain.replaceMemoCurrentTime(memo, timeLabel)
}

/** The legacy's cap on a site's stored threads. */
export const MAX_MAP_EVOLUTION_THREADS: number = plain.MAX_MAP_EVOLUTION_THREADS

export type LastFiredBySite = Record<string, string>

export function lastFiredMinutes(lastFiredBySite: LastFiredBySite | undefined, siteRoot: string): number {
    const label = lastFiredBySite?.[siteKey(siteRoot)] ?? ''
    return label ? parseInWorldMinutes(label) : -1
}

export function stampLastFired(lastFiredBySite: LastFiredBySite | undefined, roots: readonly string[], timeLabel: string): LastFiredBySite {
    return plain.stampEvolutionLastFired(lastFiredBySite ?? {}, [...roots], timeLabel)
}

/** The fold's readout: the newest stamp across sites and the soonest next due, as minutes, -1 for none. */
export function summarizeSchedule(lastFiredBySite: LastFiredBySite | undefined, options: { intervalHoursFor: (siteKey: string) => number; currentMinutes: number }): { lastMins: number; nextMins: number } {
    return plain.summarizeMapEvolutionSchedule(lastFiredBySite ?? {}, { intervalHoursFor: options.intervalHoursFor, currentMinutes: options.currentMinutes } as never)
}

// ── the sites ────────────────────────────────────────────────────────────

export interface EvolutionSite {
    siteRoot: string
    document: MapDocument
    /** Picked only to stamp a first baseline, not to evolve. */
    stampBaselineOnly?: boolean
}

export function normalizeScope(value: unknown): EvolutionScope {
    return plain.normalizeEvolutionTickScope(value) as EvolutionScope
}

export function filterSitesByRoots<T extends EvolutionSite>(sites: readonly T[], roots: readonly string[]): T[] {
    return plain.filterSitesByRoots([...sites], [...roots])
}

/** The site the party is in by the footer: by name first, then by any site whose map places the footer. */
export function activeSite<T extends EvolutionSite>(sites: readonly T[], currentLocation: string): T | null {
    if (!sites.length) return null
    const here = sites.find((site) => site.siteRoot && currentLocation && siteKey(currentLocation).includes(siteKey(site.siteRoot)))
    if (here) return here
    return sites.find((site) => !!map.resolveCurrentMapPlacement(site.document, currentLocation).area) ?? null
}

export function partyIsAt(site: EvolutionSite, currentLocation: string): boolean {
    return !!(currentLocation && (siteKey(currentLocation).includes(siteKey(site.siteRoot)) || map.resolveCurrentMapPlacement(site.document, currentLocation).area))
}

export interface PlayerBubble {
    frozenAreaIds: string[]
    combatActive: boolean
    area: { id: string; name: string } | null
}

/** The area the party is in, frozen for the pass. */
export function resolvePlayerBubble(document: MapDocument, currentLocation: string, combatActive: boolean): PlayerBubble {
    return plain.resolvePlayerBubble(document, currentLocation, { combatActive })
}

/** Which sites an interval tick stamps and which it evolves, by scope, count and due-ness. */
export function pickSitesForTick<T extends EvolutionSite>(sites: readonly T[], options: {
    scope: EvolutionScope
    count: number
    randomize: boolean
    selectedRoots: readonly string[]
    currentRoot: string
    lastFiredMinutesFor: (siteRoot: string) => number
    currentMinutes: number
    intervalHoursFor: (siteRoot: string) => number
    random?: () => number
}): { baseline: T[]; due: T[]; pool: T[] } {
    return plain.pickSitesForEvolutionTick([...sites], { ...options, selectedRoots: [...options.selectedRoots], intervalHours: 4, random: options.random ?? Math.random } as never)
}

/**
 * Which sites **Evolve now** runs on (45c-quater): the ones the scope names,
 * their clocks ignored — the party's site, the ticked ones, every mapped
 * site, or `count` of them (the party's first, then the stalest or a
 * shuffle, as the tick orders them). Before 45c-quater the button took the
 * party's site whatever the scope said; upstream's own button takes the
 * ticked list whatever the scope says, and its Named list is always on
 * screen, where ours shows only under *Named* — following the scope is the
 * same choice in AdventureTime's shape.
 */
export function pickSitesForManualRun<T extends EvolutionSite>(sites: readonly T[], options: {
    scope: EvolutionScope
    count: number
    randomize: boolean
    selectedRoots: readonly string[]
    currentRoot: string
    lastFiredMinutesFor: (siteRoot: string) => number
    random?: () => number
}): T[] {
    const pool = [...sites]
    switch (options.scope) {
        case 'active': {
            const key = siteKey(options.currentRoot)
            return key ? pool.filter((site) => siteKey(site.siteRoot) === key) : []
        }
        case 'selected':
            return filterSitesByRoots(pool, options.selectedRoots)
        case 'count':
            return plain.takeDueSitesThisTurn(pool, { count: options.count, randomize: options.randomize, currentRoot: options.currentRoot, lastFiredMinutesFor: options.lastFiredMinutesFor, random: options.random ?? Math.random } as never) as T[]
        default:
            return pool
    }
}

// ── the backlog and the threads ──────────────────────────────────────────

export interface BacklogEntry {
    kind: 'commit' | 'quiet'
    at: string
    /** -1 when unknown. */
    elapsedMinutes: number
    passes?: number
    operationId?: string
    summary: string
}

export type BacklogBySite = Record<string, BacklogEntry[]>

/** One pass's outcome on the site's bounded ledger: quiet checkpoints merge, a commit's id is kept once. */
export function appendBacklogEntry(backlogBySite: BacklogBySite | undefined, siteRoot: string, entry: BacklogEntry): BacklogBySite {
    return plain.appendEvolutionBacklogEntry(backlogBySite ?? {}, siteRoot, entry)
}

export interface BacklogDescription {
    entries: BacklogEntry[]
    representedMinutes: number
    representedElapsed: string
    quietMinutes: number
    quietElapsed: string
    truncated: boolean
}

export function describeBacklog(backlogBySite: BacklogBySite | undefined, siteRoot: string, currentElapsedMinutes: number, options: { lookback?: number } = {}): BacklogDescription {
    return plain.describeEvolutionBacklog(backlogBySite ?? {}, siteRoot, currentElapsedMinutes, options) as BacklogDescription
}

/** `Abbey Undercroft: pack moved …` without its site prefix, as the fold and the history show a digest. */
export function stripDigestSitePrefix(summary: string, siteRoot: string): string {
    return plain.stripEvolutionDigestSitePrefix(summary, siteRoot)
}

export interface ThreadsDescription {
    entries: EvolutionThread[]
    open: EvolutionThread[]
    truncated: boolean
}

export function describeThreads(threadsBySite: ThreadsBySite | undefined, siteRoot: string, options: { lookback?: number } = {}): ThreadsDescription {
    return plain.describeEvolutionThreads(threadsBySite ?? {}, siteRoot, options as never) as ThreadsDescription
}

// ── the Testing Ground's readings (71d) ──────────────────────────────────

/** What the sandbox shows of a site's stored memory: the ledger as stored, as the pass reads it, and the compression's measure. */
export interface MemoryUsage {
    storedThreads: EvolutionThread[]
    storedBacklog: BacklogEntry[]
    closedText: string
    openText: string
    threadText: string
    backlogText: string
    closedTokens: number
    openTokens: number
    threadTokens: number
    backlogTokens: number
    totalTokens: number
    threshold: number
    compressEnabled: boolean
    overThreshold: boolean
    openCount: number
    closedCount: number
    digestCount: number
    entryCount: number
    backlogCount: number
}

export function describeMemoryUsage(threadsBySite: ThreadsBySite | undefined, backlogBySite: BacklogBySite | undefined, siteRoot: string, options: { threshold: number; compressEnabled: boolean }): MemoryUsage {
    return plain.describeEvolutionMemoryUsage(threadsBySite ?? {}, backlogBySite ?? {}, siteRoot, options) as MemoryUsage
}

/** A subject the sandbox can follow: a map asset, or a thread's subject or actor; connections left out. */
export interface ArcSubject {
    id: string
    name: string
    kind: string
    state: string
    location: string
    onMap: boolean
    eventCount: number
    open: boolean
}

export function collectArcSubjects(storedThreads: readonly EvolutionThread[], document: MapDocument | null): ArcSubject[] {
    return plain.collectEvolutionArcSubjects([...storedThreads], document as never) as ArcSubject[]
}

/** One asset's arc: the events it was the subject or the actor of, the digests that name it, the backlog lines that do. */
export interface AssetArc {
    subjectId: string
    name: string
    asset: MapDocument['assets'][number] | null
    onMap: boolean
    open: boolean
    events: Array<EvolutionThread & { role: 'subject' | 'actor' | 'digest' }>
    backlogHits: BacklogEntry[]
}

export function describeAssetArc(storedThreads: readonly EvolutionThread[], subjectId: string, options: { storedBacklog: readonly BacklogEntry[]; document: MapDocument | null }): AssetArc {
    return plain.describeEvolutionAssetArc([...storedThreads], subjectId, { storedBacklog: [...options.storedBacklog] as never[], document: options.document as never }) as AssetArc
}

// ── the world's pressure ─────────────────────────────────────────────────

export type WorldReport = WorldReportForSite
export type PendingWorldReport = WorldReportForSite & { excerpt: string }

export interface ReportApplication {
    status: string
    localDigest: string
    consideredAt: string
}

/** Per site, which reports it has already felt. Keyed by site key, then report id. */
export type ReportApplications = Record<string, Record<string, ReportApplication>>

/**
 * The reports in the campaign's World book as Evolution reads them: those
 * with the writer's metadata, or recognisable legacy ones, in filing order,
 * with the consolidated ones left out.
 */
export function worldReportsFromEntries(entries: ReadonlyArray<{ uid: string; comment?: string; key?: string[]; content?: string; extensions?: Record<string, unknown>; createdAt?: number }>, bookName: string): WorldReport[] {
    return sortReports(entries).map((entry) => {
        const label = String(entry.comment ?? '').trim()
        const keys = (entry.key ?? []).map((k) => String(k ?? '').toLowerCase())
        const hasMetadata = !!entry.extensions?.rpgWorldProgression
        const recognizable = keys.includes('world progression') || keys.includes('world report') || /^day\s+\d+\b/i.test(label)
        if (!hasMetadata && !recognizable) return null
        if (/condensed|compressed|merged|summary/i.test(label) || /^days?\s+\d+\s*[-–—]\s*\d+/i.test(label)) return null
        const metadata = normalizeWorldReportMetadata({ comment: entry.comment, key: entry.key, content: entry.content, extensions: entry.extensions }, bookName, entry.uid)
        return metadata.reportId ? { ...metadata, content: String(entry.content ?? '') } : null
    }).filter((r): r is WorldReport => !!r)
}

/** The reports this site has not yet felt, each with the excerpt for it. */
export function pendingReportsForSite(reports: readonly WorldReport[], siteRoot: string, options: { lookback: number; applications: ReportApplications | undefined }): PendingWorldReport[] {
    return selectPendingWorldReportsForLocation(reports, siteRoot, { lookback: options.lookback, applied: options.applications?.[siteKey(siteRoot)] ?? {} })
}

export interface ReportOutcome {
    reportId: string
    status: string
    localDigest: string
}

/** The model's bookkeeping on each report, defaulted to `considered`; a bare noop consumes nothing. */
export function buildReportOutcomes(raw: unknown, reports: readonly WorldReport[], options: { noop?: boolean; digest?: string }): ReportOutcome[] {
    return plain.buildReportOutcomeStamps(raw, [...reports], options)
}

/** The outcomes stamped on the site, the oldest dropped past fifty. */
export function stampReportOutcomes(applications: ReportApplications | undefined, siteRoot: string, outcomes: readonly ReportOutcome[], consideredAt: string): ReportApplications {
    const next: ReportApplications = { ...(applications ?? {}) }
    const key = siteKey(siteRoot)
    const applied: Record<string, ReportApplication> = { ...(next[key] ?? {}) }
    for (const outcome of outcomes) {
        if (!outcome?.reportId) continue
        applied[outcome.reportId] = { status: outcome.status || 'considered', localDigest: outcome.localDigest || '', consideredAt: String(consideredAt ?? '').trim() }
    }
    const ids = Object.keys(applied)
    for (const id of ids.slice(0, Math.max(0, ids.length - 50))) delete applied[id]
    next[key] = applied
    return next
}

// ── the prompts ──────────────────────────────────────────────────────────

export interface EvolutionPromptContext {
    site: EvolutionSite
    trigger: EvolutionTrigger
    worldReports: readonly PendingWorldReport[]
    /** What this pass already did to other sites, one line each. */
    digest: string
    bubble: PlayerBubble
    currentLocation: string
    partyIsHere: boolean
    onSitePreset: OnSitePreset
    timeWindow: TimeWindow
    backlog: BacklogDescription
    threads: ThreadsDescription
    /** The user's direct instruction; `''` for a routine pass. */
    instruction: string
    /** The recent story, global to the pass (45c); `''` or absent for none, which the prompt says. */
    recentStory?: string
}

/** The compact direct prompt for an instruction; otherwise the user's own or the stock prompt with the legacy's three contracts appended. */
export function buildEvolutionSystemPrompt(userPrompt: string, instruction: string): string {
    const base = userPrompt.trim() || DEFAULT_MAP_EVOLUTION_SYSTEM_PROMPT
    if (instruction.trim()) return plain.selectMapEvolutionSystemPrompt(instruction, base)
    return `${base}\n\n${plain.EVOLUTION_CONTRACT}`
}

function promptArgs(ctx: EvolutionPromptContext) {
    return { site: ctx.site, trigger: ctx.trigger, worldReports: [...ctx.worldReports], digest: ctx.digest, bubble: ctx.bubble, currentLocation: ctx.currentLocation, partyIsHere: ctx.partyIsHere, onSitePreset: ctx.onSitePreset, timeWindow: ctx.timeWindow, backlog: ctx.backlog, threads: ctx.threads, directInstruction: ctx.instruction, recentStory: ctx.recentStory ?? '' }
}

export function buildEvolutionPrompt(ctx: EvolutionPromptContext): string {
    return plain.initialUserPrompt(promptArgs(ctx) as never)
}

export function buildEvolutionCorrectionPrompt(ctx: EvolutionPromptContext, priorOutput: string, issues: ArchitectIssue[], attempt: number): string {
    return plain.correctionPrompt({ ...promptArgs(ctx), priorOutput, errors: issues, attempt } as never)
}

// ── the verdict ──────────────────────────────────────────────────────────

export type EvolutionVerdict =
    | { kind: 'noop'; reportOutcomes: ReportOutcome[] }
    | { kind: 'applied'; transaction: Record<string, unknown>; applied: AppliedTransaction; reportOutcomes: ReportOutcome[]; digest: string }
    | { kind: 'rejected'; issues: ArchitectIssue[]; parseError: string | null }

/** A reply as the legacy reads it: JSON; a noop honoured with its bookkeeping; else the document's rules with the bubble frozen. */
export function checkEvolutionReply(reply: string, ctx: { document: MapDocument; frozenAreaIds: readonly string[]; currentTime: string; worldReports: readonly WorldReport[] }): EvolutionVerdict {
    const parsed = parseArchitectResponse(reply)
    if (!parsed.value) return { kind: 'rejected', issues: [{ code: 'INVALID_JSON', path: '$', hint: parsed.error || 'No JSON object was found.' }], parseError: parsed.error }
    const value = parsed.value
    if (plain.isEvolutionNoop(value)) return { kind: 'noop', reportOutcomes: buildReportOutcomes(value.report_outcomes, ctx.worldReports, { noop: true }) }
    const transaction: Record<string, unknown> = { ...value }
    delete transaction.report_outcomes
    const applied = applyTransaction(ctx.document, transaction, ctx.currentTime, ctx.frozenAreaIds)
    if (!applied.ok) return { kind: 'rejected', issues: applied.issues, parseError: null }
    const digest = summarizeDigest(ctx.document.site, transaction)
    return { kind: 'applied', transaction, applied: applied.applied, reportOutcomes: buildReportOutcomes(value.report_outcomes, ctx.worldReports, { digest }), digest }
}

/** `ember-scavengers moved to forge by …: …; ash-wight DESTROYED by …`: the transaction as one line, for the backlog, the fold and the narrator. */
export function summarizeDigest(siteRoot: string, transaction: unknown): string {
    return plain.summarizeEvolutionDigest(siteRoot, transaction)
}

/** The first eight issues on one line, as the legacy logs them. */
export function describeEvolutionIssues(issues: readonly ArchitectIssue[]): string {
    return issues.slice(0, 8).map((issue) => `${issue.code} at ${issue.path}: ${issue.hint}`).join('; ')
}

// ── what the narrator is told ────────────────────────────────────────────

/**
 * The site's recent off-screen life for the narrator's canon: open threads,
 * recent commits, digests; `''` when there is nothing. When the site's clock
 * has a stamp, the briefing opens with it — `Last evolution pass: <time>.` —
 * so the Prompt Breakdown dates it as it dates the world's reports (34c-bis).
 */
export function narratorSiteActivity(threadsBySite: ThreadsBySite | undefined, backlogBySite: BacklogBySite | undefined, siteRoot: string, maxTokens: number, lastFiredBySite?: LastFiredBySite): string {
    const body: string = plain.formatNarratorSiteActivity(threadsBySite ?? {}, backlogBySite ?? {}, siteRoot, { maxTokens })
    if (!body) return ''
    const stamp = String(lastFiredBySite?.[siteKey(siteRoot)] ?? '').trim()
    return stamp ? `Last evolution pass: ${stamp}.\n${body}` : body
}

// ── compression ──────────────────────────────────────────────────────────

export function normalizeCompressThreshold(value: unknown): number {
    return plain.normalizeMapEvolutionCompressThreshold(value)
}

export function normalizeNarratorCommitTokens(value: unknown): number {
    return plain.normalizeMapEvolutionNarratorCommitTokens(value)
}

export interface CompressionRequest {
    system: string
    user: string
    tokens: number
    threshold: number
    open: number
    closed: number
}

/** The request that compresses a site's closed history, or null while there is too little or it is under the threshold. */
export function buildCompressionRequest(threadsBySite: ThreadsBySite | undefined, siteRoot: string, threshold: number, systemPrompt = ''): CompressionRequest | null {
    const stored = plain.storedEvolutionThreads(threadsBySite ?? {}, siteRoot) as EvolutionThread[]
    const { open, closed } = plain.partitionCompressibleThreads(stored) as { open: EvolutionThread[]; closed: EvolutionThread[] }
    if (closed.length < 2) return null
    const limit = normalizeCompressThreshold(threshold)
    const closedText: string = plain.formatClosedThreadsForCompression(closed)
    const tokens: number = plain.estimateMapHistoryTokens(closedText)
    if (tokens < limit) return null
    const openText = open.length ? open.map((entry) => plain.formatEvolutionThreadLine({ ...entry, status: 'open', compressed: false })).join('\n') : '(No currently open threads.)'
    return { system: systemPrompt.trim() || DEFAULT_MAP_EVOLUTION_COMPRESS_SYSTEM_PROMPT, user: plain.compressionUserPrompt(siteRoot, openText, closedText, tokens, limit), tokens, threshold: limit, open: open.length, closed: closed.length }
}

export interface CompressionDigest {
    at: string
    summary: string
}

export function parseCompressionDigests(raw: string): { ok: true; digests: CompressionDigest[] } | { ok: false; error: string } {
    return plain.parseCompressionDigests(raw) as { ok: true; digests: CompressionDigest[] } | { ok: false; error: string }
}

/** The closed history replaced by the digests; the open threads kept as they are. */
export function applyDigests(threadsBySite: ThreadsBySite | undefined, siteRoot: string, digests: readonly CompressionDigest[]): ThreadsBySite {
    return plain.applyCompressedThreadDigests(threadsBySite ?? {}, siteRoot, [...digests])
}
