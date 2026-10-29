/**
 * Map Evolution's pass (roadmap row 9, Phase 34c): sites change while the
 * party is away.
 *
 * After every reply, once the updater and the world have had their turn:
 * when the party has just left a mapped site, one pass over that site; then
 * the interval tick, which stamps a first baseline on sites never evolved
 * and evolves the ones whose interval has passed -- the on-site interval for
 * the site the party is in, the off-site one for the rest, by the scope the
 * user set. Each site is one model call (corrected up to twice) on the
 * agent's connection, judged by the document's rules with the party's area
 * frozen, committed to the site's root entry, and written into the site's
 * backlog, its threads and its clock; the World reports it felt are stamped
 * so they are not felt twice; when its closed history has grown long, one
 * more call compresses it into digests. The panel can run it now, for the
 * site the party is in or named ones, with an instruction.
 *
 * A swipe or a regenerate of the reply a pass followed puts everything the
 * pass did back: the entries, the clocks, the ledgers and the threads.
 *
 * A site's own hours (71d, the legacy's per-site override) are kept on
 * the chat's map record and win over both dials; the Testing Ground is
 * `map-sandbox.ts`, which runs this pass on one site.
 */

import type { ArchitectIssue } from '../tracker/architect.js'
import { secondsSince, type StepFn } from './terminal.js'
import { isCombatActive } from '../tracker/dice.js'
import {
    activeSite,
    appendBacklogEntry,
    applyDigests,
    buildCompressionRequest,
    buildEvolutionCorrectionPrompt,
    buildEvolutionPrompt,
    buildEvolutionSystemPrompt,
    checkEvolutionReply,
    describeBacklog,
    describeEvolutionIssues,
    describeThreads,
    describeTimeWindow,
    filterSitesByRoots,
    getSiteIntervalOverride,
    lastFiredMinutes,
    MAX_EVOLUTION_CORRECTION_ATTEMPTS,
    normalizeScope,
    pickSitesForManualRun,
    parseCompressionDigests,
    parseInWorldMinutes,
    partyIsAt,
    pendingReportsForSite,
    pickSitesForTick,
    resolvePlayerBubble,
    resolveSiteIntervalHours,
    setSiteIntervalOverride,
    siteKey,
    stampLastFired,
    stampReportOutcomes,
    summarizeSchedule,
    worldReportsFromEntries,
    type BacklogBySite,
    type EvolutionScope,
    type EvolutionSite,
    type EvolutionTrigger,
    type OnSitePreset,
    type ReportApplications,
    type WorldReport,
} from '../tracker/evolution.js'
import { extractFooterLocation, parseMapDocument, type MapSite, type MapSites } from '../tracker/map.js'
import { currentTimeFromMemo, extractCurrentTimeStr } from '../tracker/time.js'
import { appendThreads, threadsFromTransaction, type ThreadsBySite } from '../tracker/updater.js'
import { formatInWorldTime } from '../tracker/world.js'
import { campaignBookName } from '../agent/campaign.js'
import { commitMapTransaction, type RestoredEntry } from './map-commit.js'
import type { MapEvolutionBookkeeping, MapEvolutionReport, MapEvolutionSiteResult, MapEvolutionUndo, MapStore } from './map-store.js'
import { readMapSites, type MapBookReader } from './map-sync.js'
import type { WorldBookStore } from './world-pass.js'

export interface MapEvolutionOptions {
    /** The user's switch. The rulebook's mapping section is the other one. */
    enabled: boolean
    /** In-world hours between passes for a site the party is not in. The legacy's 12. */
    intervalHours: number
    /** For the site they are in: hours and minutes; both 0 means never. The legacy's 1 hour. */
    onSiteIntervalHours: number
    onSiteIntervalMinutes: number
    /** How bold the pass is on the site the party is in. */
    onSitePreset: OnSitePreset
    /** Which sites an interval tick considers: the party's, N of them, all, or a named few. */
    scope: EvolutionScope
    count: number
    randomize: boolean
    selectedRoots: string[]
    /** How many recent World reports a site may feel. The legacy's 5. */
    worldReportLookback: number
    /** User turns of recent story every due site is shown (45c). The legacy's 20; 0 for none. */
    storyLookback: number
    /** The user's own evolution prompt; `''` for the stock one. */
    systemPrompt: string
    /** Compress a site's closed history once it passes this many tokens. */
    compressEnabled: boolean
    compressThreshold: number
}

export interface MapEvolutionDeps {
    store: (userId: string | undefined) => WorldBookStore & MapBookReader
    /** One model call. */
    generate(messages: Array<{ role: 'system' | 'user'; content: string }>, chatId: string, userId: string | undefined): Promise<string>
    campaign: (chatId: string, userId: string | undefined) => Promise<{ prefix: string; owned: string[] }>
    /** The narrator's last reply, for its footer. */
    lastReply: (chatId: string, userId: string | undefined) => Promise<string>
    memo: (chatId: string, userId: string | undefined) => Promise<string>
    /** The recent story, `turns` user messages back (45c). Absent, the pass sends none. Read defended. */
    recentStory?: (chatId: string, userId: string | undefined, turns: number) => Promise<string>
    options: (userId: string | undefined) => Promise<MapEvolutionOptions>
    /** Whether the rulebook's mapping section is on for this user. */
    enabled: (userId: string | undefined) => Promise<boolean>
    state: MapStore
    /** After a commit or an undo: re-read the maps so the next turn's injection carries the change. */
    refresh: (chatId: string, userId: string | undefined) => Promise<unknown>
    events?: {
        started(chatId: string, userId: string | undefined, sites: string[], at: string, trigger: EvolutionTrigger): void
        finished(chatId: string, userId: string | undefined, report: MapEvolutionReport): void
    }
    log: { info(m: string): void; warn(m: string): void }
    now?: () => Date
    random?: () => number
    /** The terminal (71b): a step function for a pass on this chat. */
    steps?: (chatId: string, userId: string | undefined) => StepFn
}

export interface MapEvolutionRunRequest {
    chatId: string
    userId: string | undefined
    /** The user's direct instruction for this pass; `''` or absent for a routine one. */
    instruction?: string
    /** Sites to evolve, in place of the ones the scope names (45c-quater). */
    siteRoots?: string[]
    /** User turns of recent story to read, in place of the preference (71b, the terminal's bar). */
    lookback?: number
}

/** One mapped site's interval as the fold shows it (71d): the hours it inherits, and its own when it has them. */
export interface SiteInterval {
    siteRoot: string
    current: boolean
    /** The hours the dials give it: the on-site ones while the party is there, the off-site ones otherwise. 0 is never. */
    automaticHours: number
    /** The site's own hours, or `null` when it inherits. */
    overrideHours: number | null
}

/** The clocks in words, for the fold. */
export interface EvolutionSchedule {
    currentTime: string
    lastFired: string
    nextDue: string
    /** Every mapped site the record knows, with its interval (71d). */
    sites: SiteInterval[]
}

export interface MapEvolution {
    /** The memo's clock, the newest site stamp, and the soonest next pass, as labels. Never throws. */
    schedule(chatId: string, userId: string | undefined): Promise<EvolutionSchedule>
    /** After a reply: the exit pass for a site just left, then the interval tick. Never throws. */
    afterReply(chatId: string, userId: string | undefined, messageId: string | undefined): Promise<MapEvolutionReport | null>
    /** On a swipe or regenerate of the reply the last pass followed: put everything back. True when something was. */
    rollBack(chatId: string, userId: string | undefined, messageId: string | undefined): Promise<boolean>
    /** From the panel: now, for the named sites or the ones the scope names, with an instruction if given. Never throws. */
    run(request: MapEvolutionRunRequest): Promise<MapEvolutionReport>
    running(chatId: string): boolean
    /** A site's own hours between passes (71d): a number sets them, 0 for never, `null` clears them. Returns the site's interval as the fold shows it. */
    setSiteInterval(chatId: string, userId: string | undefined, siteRoot: string, hours: number | null): Promise<SiteInterval>
    /** Multihog's Reset Timeline (78a): every site's last-evolved clock forgotten, so the next interval starts from the current time. */
    resetTimeline(chatId: string, userId: string | undefined): Promise<void>
}

/** A mapped site as the pass works on it: its map and its root entry's address. */
interface Site extends EvolutionSite {
    bookName: string
    uid: string
}

interface Loaded {
    prefix: string
    books: Array<{ id: string; name: string }>
    sites: Site[]
    currentLocation: string
    memo: string
    currentTime: string
    currentMinutes: number
    combatActive: boolean
}

interface PassShape {
    trigger: EvolutionTrigger
    instruction: string
    messageId: string | undefined
    /** The recent story's window for this pass, in place of the preference. */
    lookback?: number
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

function siteOf(site: MapSite): Site | null {
    const sep = site.entryId.indexOf('::')
    if (sep < 0 || !site.mapChunks?.length) return null
    return { siteRoot: site.siteRoot, bookName: site.entryId.slice(0, sep), uid: site.entryId.slice(sep + 2), document: parseMapDocument(site.mapChunks[0]!, site.siteRoot).document }
}

function sitesOf(sites: MapSites): Site[] {
    return Object.values(sites).map(siteOf).filter((s): s is Site => !!s)
}

function overall(sites: readonly MapEvolutionSiteResult[]): MapEvolutionReport['status'] {
    if (sites.some((s) => s.status === 'applied')) return 'applied'
    if (sites.some((s) => s.status === 'noop')) return 'noop'
    if (sites.some((s) => s.status === 'failed')) return 'failed'
    return 'baseline'
}

/** A site's interval as the fold shows it (71d): what the dials give it, and its own hours if any. */
function siteInterval(siteRoot: string, options: MapEvolutionOptions, bySite: Record<string, number>, currentRoot: string): SiteInterval {
    return {
        siteRoot,
        current: siteKey(siteRoot) === siteKey(currentRoot) && !!currentRoot,
        automaticHours: resolveSiteIntervalHours(siteRoot, { ...options, intervalHoursBySite: {} }, currentRoot),
        overrideHours: getSiteIntervalOverride(bySite, siteRoot),
    }
}

export function createMapEvolution(deps: MapEvolutionDeps): MapEvolution {
    const now = deps.now ?? (() => new Date())
    const inFlight = new Set<string>()

    async function load(chatId: string, userId: string | undefined): Promise<Loaded> {
        const { prefix, owned } = await deps.campaign(chatId, userId)
        const { sites, books } = prefix ? await readMapSites(deps.store(userId), prefix, owned) : { sites: {} as MapSites, books: [] }
        const memo = await deps.memo(chatId, userId)
        const currentTime = extractCurrentTimeStr(currentTimeFromMemo(memo))
        return { prefix, books, sites: sitesOf(sites), currentLocation: extractFooterLocation(await deps.lastReply(chatId, userId)), memo, currentTime, currentMinutes: parseInWorldMinutes(currentTime), combatActive: isCombatActive(memo) }
    }

    async function finish(chatId: string, userId: string | undefined, report: MapEvolutionReport): Promise<MapEvolutionReport> {
        await deps.state.save(chatId, { lastEvolution: report }, userId).catch(() => undefined)
        deps.events?.finished(chatId, userId, report)
        return report
    }

    /** The World book's reports, in filing order; none when the campaign has no such book. */
    async function worldReports(userId: string | undefined, loaded: Loaded): Promise<WorldReport[]> {
        const name = campaignBookName(loaded.prefix, 'World')
        const store = deps.store(userId)
        const book = (await store.listBooks()).find((b) => b.name.toLowerCase() === name.toLowerCase())
        if (!book) return []
        return worldReportsFromEntries(await store.listEntries(book.id), book.name)
    }

    /** One site: the prompt, up to three replies, the commit, and the site's ledgers moved on. Mutates `bk` and returns the threads. */
    async function evolveSite(chatId: string, userId: string | undefined, loaded: Loaded, site: Site, shape: PassShape, options: MapEvolutionOptions, reports: readonly WorldReport[], digestLines: string[], bk: MapEvolutionBookkeeping, threads: ThreadsBySite, undo: MapEvolutionUndo, recentStory: string, step?: StepFn): Promise<{ result: MapEvolutionSiteResult; threads: ThreadsBySite }> {
        const partyIsHere = partyIsAt(site, loaded.currentLocation)
        const bubble = partyIsHere ? resolvePlayerBubble(site.document, loaded.currentLocation, loaded.combatActive) : { frozenAreaIds: [], combatActive: false, area: null }
        const key = siteKey(site.siteRoot)
        const timeWindow = describeTimeWindow(bk.lastFiredBySite[key] ?? '', loaded.currentTime)
        const backlog = describeBacklog(bk.backlogBySite as BacklogBySite, site.siteRoot, timeWindow.elapsedMinutes)
        const described = describeThreads(threads, site.siteRoot)
        const pending = shape.instruction ? [] : pendingReportsForSite(reports, site.siteRoot, { lookback: options.worldReportLookback, applications: bk.reportApplications as ReportApplications })
        const system = buildEvolutionSystemPrompt(options.systemPrompt, shape.instruction)
        const ctx = { site, trigger: shape.trigger, worldReports: pending, digest: digestLines.join('\n'), bubble, currentLocation: loaded.currentLocation, partyIsHere, onSitePreset: options.onSitePreset, timeWindow, backlog, threads: described, instruction: shape.instruction, recentStory }
        deps.log.info(`map: evolution ${shape.trigger} pass for "${site.siteRoot}" (${timeWindow.elapsed}; ${pending.length} report${pending.length === 1 ? '' : 's'} pending${partyIsHere ? '; party here' : ''}${shape.instruction ? '; direct instruction' : ''}${recentStory ? `; ${options.storyLookback} turns of story` : ''})`)
        let prompt = buildEvolutionPrompt(ctx)
        let issues: ArchitectIssue[] = []
        let next = threads
        for (let attempt = 0; attempt <= MAX_EVOLUTION_CORRECTION_ATTEMPTS; attempt++) {
            if (attempt) deps.log.info(`map: evolution correction ${attempt} for "${site.siteRoot}"`)
            step?.('thought', attempt ? `${site.siteRoot}: correction pass ${attempt}…` : `${site.siteRoot}: requesting evolution (${shape.trigger}; ${timeWindow.elapsed}; ${pending.length} report${pending.length === 1 ? '' : 's'} pending)…`)
            const reply = await deps.generate([{ role: 'system', content: system }, { role: 'user', content: prompt }], chatId, userId)
            const verdict = checkEvolutionReply(reply, { document: site.document, frozenAreaIds: bubble.frozenAreaIds, currentTime: loaded.currentTime, worldReports: pending })
            if (verdict.kind === 'rejected') {
                issues = verdict.issues
            } else if (verdict.kind === 'noop') {
                bk.backlogBySite = appendBacklogEntry(bk.backlogBySite as BacklogBySite, site.siteRoot, { kind: 'quiet', at: loaded.currentTime, elapsedMinutes: timeWindow.elapsedMinutes, summary: 'Map Evolution considered the site and committed no material change.' })
                bk.lastFiredBySite = stampLastFired(bk.lastFiredBySite, [site.siteRoot], loaded.currentTime)
                bk.reportApplications = stampReportOutcomes(bk.reportApplications as ReportApplications, site.siteRoot, verdict.reportOutcomes, loaded.currentTime)
                deps.log.info(`map: evolution found nothing would stir at "${site.siteRoot}"`)
                return { result: { siteRoot: site.siteRoot, status: 'noop' }, threads: next }
            } else {
                const committed = await commitMapTransaction(deps.store(userId), loaded.books, site, verdict.transaction, loaded.currentTime, bubble.frozenAreaIds)
                if (committed.ok) {
                    const count = Array.isArray(verdict.transaction.operations) ? verdict.transaction.operations.length : 0
                    if (!committed.alreadyApplied) {
                        undo.restore.push(...committed.restore.filter((r) => !undo.restore.some((u) => u.id === r.id)))
                        undo.created.push(...committed.created)
                        digestLines.push(verdict.digest)
                        next = appendThreads(next, site.siteRoot, threadsFromTransaction(verdict.transaction, { at: loaded.currentTime, createdAssets: committed.createdAssets }))
                    }
                    bk.backlogBySite = appendBacklogEntry(bk.backlogBySite as BacklogBySite, site.siteRoot, { kind: 'commit', at: loaded.currentTime, elapsedMinutes: timeWindow.elapsedMinutes, operationId: String(verdict.transaction.operation_id ?? ''), summary: verdict.digest })
                    bk.lastFiredBySite = stampLastFired(bk.lastFiredBySite, [site.siteRoot], loaded.currentTime)
                    bk.reportApplications = stampReportOutcomes(bk.reportApplications as ReportApplications, site.siteRoot, verdict.reportOutcomes, loaded.currentTime)
                    deps.log.info(`map: evolution ${committed.alreadyApplied ? 'had already applied' : 'applied'} ${count} operation${count === 1 ? '' : 's'} to "${site.siteRoot}" (${committed.entryId}): ${verdict.digest}`)
                    return { result: { siteRoot: site.siteRoot, status: 'applied', summary: verdict.digest, operations: count }, threads: next }
                }
                issues = committed.issues
                if (!committed.retryable) break
            }
            if (attempt < MAX_EVOLUTION_CORRECTION_ATTEMPTS) prompt = buildEvolutionCorrectionPrompt(ctx, reply, issues, attempt + 1)
        }
        const reason = `could not apply a valid transaction: ${describeEvolutionIssues(issues) || 'unknown error'}`
        deps.log.warn(`map: evolution for "${site.siteRoot}" ${reason}`)
        return { result: { siteRoot: site.siteRoot, status: 'failed', reason }, threads: next }
    }

    /** The site's closed history compressed into digests when it has grown long: one more model call, two tries. */
    async function compress(chatId: string, userId: string | undefined, site: Site, options: MapEvolutionOptions, threads: ThreadsBySite): Promise<{ threads: ThreadsBySite; digests: number }> {
        if (!options.compressEnabled) return { threads, digests: 0 }
        const request = buildCompressionRequest(threads, site.siteRoot, options.compressThreshold)
        if (!request) return { threads, digests: 0 }
        deps.log.info(`map: evolution compressing "${site.siteRoot}" history (${request.tokens} tokens ≥ ${request.threshold}, ${request.closed} closed threads)`)
        let lastError = ''
        for (let attempt = 0; attempt < 2; attempt++) {
            const reply = await deps.generate([{ role: 'system', content: attempt ? `${request.system}\n\nPrevious output was not valid digest JSON. ${lastError}` : request.system }, { role: 'user', content: request.user }], chatId, userId)
            const parsed = parseCompressionDigests(reply)
            if (parsed.ok) {
                deps.log.info(`map: evolution compressed "${site.siteRoot}" history into ${parsed.digests.length} digest${parsed.digests.length === 1 ? '' : 's'}`)
                return { threads: applyDigests(threads, site.siteRoot, parsed.digests), digests: parsed.digests.length }
            }
            lastError = parsed.error
        }
        deps.log.warn(`map: evolution could not compress "${site.siteRoot}" history: ${lastError}`)
        return { threads, digests: 0 }
    }

    /** One pass over the given sites, in order, each seeing what the pass did before it. */
    async function pass(chatId: string, userId: string | undefined, loaded: Loaded, sites: readonly Site[], shape: PassShape, bk: MapEvolutionBookkeeping): Promise<MapEvolutionReport> {
        const at = () => now().toISOString()
        const roots = sites.map((s) => s.siteRoot)
        if (inFlight.has(chatId)) return { status: 'skipped', at: at(), trigger: shape.trigger, sites: [], reason: 'another evolution pass is still running' }
        inFlight.add(chatId)
        deps.events?.started(chatId, userId, roots, at(), shape.trigger)
        const step = deps.steps?.(chatId, userId)
        const startedAt = Date.now()
        step?.('start', `Initializing Map Evolution (${shape.trigger}${shape.instruction ? ', direct instruction' : ''}) for ${roots.join(', ')}…`)
        const record = await deps.state.load(chatId, userId)
        const undo: MapEvolutionUndo = { messageId: shape.messageId ?? '', restore: [], created: [], bookkeeping: clone(bk), threadsBySite: clone(record.threadsBySite) }
        let threads = record.threadsBySite as ThreadsBySite
        const results: MapEvolutionSiteResult[] = []
        const digestLines: string[] = []
        try {
            const options = await deps.options(userId)
            const reports = shape.instruction ? [] : await worldReports(userId, loaded)
            // The recent story, once for the pass and the same for every site
            // (upstream 2026.8.71): the prompt tells the model to apply only
            // what touches its own map. Read defended: a chat that will not
            // read costs the story, never the pass.
            const storyLookback = shape.lookback ?? options.storyLookback
            const recentStory = storyLookback > 0 && deps.recentStory
                ? await deps.recentStory(chatId, userId, storyLookback).catch((error: unknown) => { deps.log.warn(`map: evolution could not read the recent story: ${describe(error)}`); return '' })
                : ''
            for (const site of sites) {
                try {
                    const outcome = await evolveSite(chatId, userId, loaded, site, shape, options, reports, digestLines, bk, threads, undo, recentStory, step)
                    threads = outcome.threads
                    if (outcome.result.status === 'applied') {
                        step?.('result', `${site.siteRoot}: ${outcome.result.summary ?? ''}`.trim())
                        step?.('finish', `${site.siteRoot}: applied ${outcome.result.operations ?? 0} operation${outcome.result.operations === 1 ? '' : 's'}.`)
                    } else if (outcome.result.status === 'noop') step?.('finish', `${site.siteRoot}: nothing stirred.`)
                    else if (outcome.result.status === 'failed') step?.('error', `${site.siteRoot}: ${outcome.result.reason ?? 'failed'}`)
                    if (outcome.result.status !== 'failed') {
                        const compressed = await compress(chatId, userId, site, options, threads)
                        threads = compressed.threads
                        if (compressed.digests) outcome.result.compressed = compressed.digests
                    }
                    results.push(outcome.result)
                } catch (error) {
                    const reason = describe(error)
                    deps.log.warn(`map: evolution for "${site.siteRoot}" failed: ${reason}`)
                    step?.('error', `${site.siteRoot}: ${reason}`)
                    results.push({ siteRoot: site.siteRoot, status: 'failed', reason })
                }
            }
        } finally {
            inFlight.delete(chatId)
        }
        if (step) {
            const applied = results.filter((r) => r.status === 'applied').length
            const noops = results.filter((r) => r.status === 'noop').length
            const failed = results.filter((r) => r.status === 'failed').length
            step(failed && !applied && !noops ? 'error' : 'finish', `Map Evolution: ${applied} applied, ${noops} noop, ${failed} failed.`, { seconds: secondsSince(startedAt) })
        }
        const changed = undo.restore.length > 0 || undo.created.length > 0
        await deps.state.save(chatId, { evolution: bk, threadsBySite: threads, ...(changed && shape.messageId ? { evolutionUndo: undo } : {}) }, userId)
        if (changed) await deps.refresh(chatId, userId).catch((error: unknown) => deps.log.warn(`map: could not re-read the maps after evolution: ${describe(error)}`))
        return finish(chatId, userId, { status: overall(results), at: at(), trigger: shape.trigger, currentTime: loaded.currentTime, sites: results })
    }

    return {
        running: (chatId) => inFlight.has(chatId),

        async schedule(chatId, userId) {
            try {
                const [record, options, memo] = await Promise.all([deps.state.load(chatId, userId), deps.options(userId), deps.memo(chatId, userId)])
                const currentTime = extractCurrentTimeStr(currentTimeFromMemo(memo))
                const currentRoot = record.activeSiteRoot
                const settings = { ...options, intervalHoursBySite: record.evolution.intervalHoursBySite }
                const { lastMins, nextMins } = summarizeSchedule(record.evolution.lastFiredBySite, { intervalHoursFor: (key) => resolveSiteIntervalHours(key, settings, currentRoot), currentMinutes: parseInWorldMinutes(currentTime) })
                return { currentTime, lastFired: lastMins >= 0 ? formatInWorldTime(lastMins) : '', nextDue: nextMins >= 0 ? formatInWorldTime(nextMins) : '', sites: record.sites.map((s) => siteInterval(s.siteRoot, options, record.evolution.intervalHoursBySite, currentRoot)) }
            } catch (error) {
                deps.log.warn(`map: evolution schedule could not be read: ${describe(error)}`)
                return { currentTime: '', lastFired: '', nextDue: '', sites: [] }
            }
        },

        async setSiteInterval(chatId, userId, siteRoot, hours) {
            const record = await deps.state.load(chatId, userId)
            const bk: MapEvolutionBookkeeping = clone(record.evolution)
            bk.intervalHoursBySite = setSiteIntervalOverride(bk.intervalHoursBySite, siteRoot, hours)
            await deps.state.save(chatId, { evolution: bk }, userId)
            const options = await deps.options(userId)
            const own = getSiteIntervalOverride(bk.intervalHoursBySite, siteRoot)
            deps.log.info(own === null ? `map: evolution interval for "${siteRoot}" inherits the dials again` : `map: evolution interval for "${siteRoot}" set to ${own} hour${own === 1 ? '' : 's'}${own === 0 ? ' (never)' : ''}`)
            return siteInterval(siteRoot, options, bk.intervalHoursBySite, record.activeSiteRoot)
        },

        async resetTimeline(chatId, userId) {
            const record = await deps.state.load(chatId, userId)
            const bk: MapEvolutionBookkeeping = clone(record.evolution)
            const clocks = Object.keys(bk.lastFiredBySite).length
            bk.lastFiredBySite = {}
            await deps.state.save(chatId, { evolution: bk }, userId)
            deps.log.info(`map: evolution timeline reset for chat ${chatId} (${clocks} site clock${clocks === 1 ? '' : 's'} forgotten); the next interval starts from the current time`)
        },

        async afterReply(chatId, userId, messageId) {
            try {
                if (!(await deps.enabled(userId))) return null
                const options = await deps.options(userId)
                if (!options.enabled) return null
                const record = await deps.state.load(chatId, userId)
                const bk: MapEvolutionBookkeeping = clone(record.evolution)
                const loaded = await load(chatId, userId)
                const active = activeSite(loaded.sites, loaded.currentLocation)
                const currentRoot = active?.siteRoot ?? ''
                let report: MapEvolutionReport | null = null

                // Leaving a site: one pass over it, unless it evolved at this very time already.
                const previousRoot = bk.lastSiteRoot
                let pendingExit = bk.pendingExitRoot
                if (!pendingExit && previousRoot && siteKey(previousRoot) !== siteKey(currentRoot)) {
                    const already = lastFiredMinutes(bk.lastFiredBySite, previousRoot)
                    if (!(already >= 0 && already === loaded.currentMinutes)) pendingExit = previousRoot
                }
                if (pendingExit) {
                    const left = loaded.sites.find((s) => siteKey(s.siteRoot) === siteKey(pendingExit))
                    if (left) report = await pass(chatId, userId, loaded, [left], { trigger: 'site_exit', instruction: '', messageId }, bk)
                    bk.pendingExitRoot = report?.status === 'skipped' ? pendingExit : ''
                }
                bk.lastSiteRoot = currentRoot

                // The tick: baselines stamped, due sites evolved, by scope.
                const scope = normalizeScope(options.scope)
                if (loaded.sites.length && (currentRoot || scope !== 'active')) {
                    const intervalFor = (root: string) => resolveSiteIntervalHours(root, { ...options, intervalHoursBySite: bk.intervalHoursBySite }, currentRoot)
                    const picked = pickSitesForTick(loaded.sites, { scope, count: options.count, randomize: options.randomize, selectedRoots: options.selectedRoots, currentRoot, lastFiredMinutesFor: (root) => lastFiredMinutes(bk.lastFiredBySite, root), currentMinutes: loaded.currentMinutes, intervalHoursFor: intervalFor, random: deps.random })
                    if (picked.baseline.length) {
                        bk.lastFiredBySite = stampLastFired(bk.lastFiredBySite, picked.baseline.map((s) => s.siteRoot), loaded.currentTime)
                        deps.log.info(`map: evolution baseline stamped at "${loaded.currentTime}" for ${picked.baseline.map((s) => s.siteRoot).join(', ')}`)
                    }
                    if (picked.due.length) {
                        report = await pass(chatId, userId, loaded, picked.due, { trigger: 'interval', instruction: '', messageId }, bk)
                    } else if (picked.baseline.length && !report) {
                        report = await finish(chatId, userId, { status: 'baseline', at: now().toISOString(), trigger: 'interval', currentTime: loaded.currentTime, sites: picked.baseline.map((s) => ({ siteRoot: s.siteRoot, status: 'baseline' as const })) })
                    }
                }
                await deps.state.save(chatId, { evolution: bk }, userId)
                return report
            } catch (error) {
                deps.log.warn(`map: evolution could not run after the reply: ${describe(error)}`)
                return null
            }
        },

        async rollBack(chatId, userId, messageId) {
            if (!messageId) return false
            const record = await deps.state.load(chatId, userId)
            const undo = record.evolutionUndo
            if (!undo || undo.messageId !== messageId) return false
            const store = deps.store(userId)
            for (const entry of undo.restore as RestoredEntry[]) await store.updateEntry(entry.id, { content: entry.content, extensions: entry.extensions ?? {}, disabled: true })
            for (const id of undo.created) await store.deleteEntry(id)
            const sites = record.lastEvolution?.sites.map((s) => s.siteRoot) ?? []
            const report: MapEvolutionReport = { status: 'undone', at: now().toISOString(), trigger: record.lastEvolution?.trigger ?? 'interval', sites: sites.map((siteRoot) => ({ siteRoot, status: 'applied' as const })), reason: 'the reply it followed was replaced' }
            await deps.state.save(chatId, { evolutionUndo: undefined, evolution: undo.bookkeeping, threadsBySite: undo.threadsBySite, lastEvolution: report }, userId)
            await deps.refresh(chatId, userId).catch((error: unknown) => deps.log.warn(`map: could not re-read the maps after the evolution undo: ${describe(error)}`))
            deps.log.info(`map: evolution rolled back its last pass (${undo.restore.length} restored, ${undo.created.length} removed)`)
            deps.events?.finished(chatId, userId, report)
            return true
        },

        async run(request) {
            const { chatId, userId } = request
            const at = () => now().toISOString()
            const wanted = (request.siteRoots ?? []).map((r) => String(r ?? '').trim()).filter(Boolean)
            try {
                if (!(await deps.enabled(userId))) return await finish(chatId, userId, { status: 'skipped', at: at(), trigger: 'manual', sites: [], reason: 'the rulebook’s mapping section is off' })
                const record = await deps.state.load(chatId, userId)
                const loaded = await load(chatId, userId)
                const bk: MapEvolutionBookkeeping = clone(record.evolution)
                const active = activeSite(loaded.sites, loaded.currentLocation)
                // Named sites from the caller, else the sites the scope names, their clocks ignored (45c-quater).
                const options = await deps.options(userId)
                const scope = normalizeScope(options.scope)
                const sites = wanted.length
                    ? filterSitesByRoots(loaded.sites, wanted)
                    : pickSitesForManualRun(loaded.sites, { scope, count: options.count, randomize: options.randomize, selectedRoots: options.selectedRoots, currentRoot: active?.siteRoot ?? '', lastFiredMinutesFor: (root) => lastFiredMinutes(bk.lastFiredBySite, root), random: deps.random })
                if (!sites.length) {
                    const named = (roots: readonly string[]) => roots.map((w) => `"${w}"`).join(', ')
                    const reason = wanted.length ? `no map is attached to ${named(wanted)}`
                        : !loaded.sites.length ? 'no site is mapped yet'
                        : scope === 'active' ? 'the party is not inside a mapped site'
                        : scope === 'selected' ? (options.selectedRoots.length ? `no map is attached to ${named(options.selectedRoots)}` : 'no site is ticked under Named sites')
                        : 'no site was picked'
                    return await finish(chatId, userId, { status: 'skipped', at: at(), trigger: 'manual', sites: [], reason })
                }
                const report = await pass(chatId, userId, loaded, sites, { trigger: 'manual', instruction: String(request.instruction ?? '').trim(), messageId: undefined, ...(typeof request.lookback === 'number' && Number.isFinite(request.lookback) ? { lookback: Math.max(0, Math.floor(request.lookback)) } : {}) }, bk)
                return report
            } catch (error) {
                const reason = describe(error)
                deps.log.warn(`map: evolution could not run: ${reason}`)
                return await finish(chatId, userId, { status: 'failed', at: at(), trigger: 'manual', sites: [], reason })
            }
        },
    }
}
