/**
 * The Map Updater's pass (roadmap row 9, Phase 34b): the map changes with
 * play.
 *
 * After a reply inside a mapped site -- every reply by default, every N by
 * preference, and at once when the party has stepped into a building the map
 * has not furnished -- this reads the story since the last pass, shows a
 * model the site's map and asks for one transaction, checks it the legacy's
 * way (`tracker/updater.ts`), corrects it up to twice, and commits it to the
 * site's root Location entry. A chronicle the model writes for an area is
 * filed in that area's own child entry (`Site :: Area`), made when absent.
 * When the party leaves a site, one more pass reviews who left with them.
 * The panel can run it now, with an instruction, for the site the party is
 * in or any other.
 *
 * A swipe or a regenerate replaces the reply a pass read, so the commit that
 * followed it is put back (the agent's rule, from 9r): every entry the commit
 * touched is restored and every entry it made is deleted.
 *
 * What the legacy's version does that this one does not yet: the pass that
 * furnishes a building the *user's message* aims at, before the narrator
 * replies (SillyTavern waits for a message hook; Spindle's interceptor does
 * not), and the Testing Ground.
 */

import type { ArchitectIssue } from '../tracker/architect.js'
import { extractFooterLocation, normalizeMapLabel, parseMapDocument, resolveActiveMapSite, type MapDocument, type MapSite, type MapSites } from '../tracker/map.js'
import {
    appendThreads,
    buildUpdaterCorrectionPrompt,
    buildUpdaterPrompt,
    BUILDING_POPULATION_MIN_LOOKBACK_TURNS,
    checkUpdaterReply,
    currentTimeFor,
    describeUpdaterIssues,
    formatStory,
    MAX_UPDATER_CORRECTION_ATTEMPTS,
    previousFooterForSite,
    resolvePopulationTarget,
    resolveStoryWindow,
    selectSystemPrompt,
    summarizeOperations,
    threadsFromTransaction,
    type StoryMessage,
    type ThreadsBySite,
    type UpdaterPromptContext,
} from '../tracker/updater.js'
import { commitMapTransaction } from './map-commit.js'
import { readMapSites, type MapBookReader } from './map-sync.js'
import { secondsSince, type StepFn } from './terminal.js'
import type { MapStore, MapUpdaterBookkeeping, MapUpdaterReport, MapUpdaterUndo } from './map-store.js'
import type { WorldBookStore } from './world-pass.js'

export interface MapUpdaterOptions {
    /** The user's switch. The rulebook's mapping section is the other one. */
    enabled: boolean
    /** Run after every Nth reply. The legacy's 1. */
    runEvery: number
    /** User turns read when there is no last pass to read from, and on a manual run. */
    lookback: number
    /** The user's own occupancy prompt; `''` for the stock one. */
    systemPrompt: string
}

/** A chat message as the updater reads it, with the host's id for the undo. */
export interface UpdaterMessage extends StoryMessage {
    id: string
}

export interface MapUpdaterDeps {
    store: (userId: string | undefined) => WorldBookStore & MapBookReader
    /** One model call. */
    generate(messages: Array<{ role: 'system' | 'user'; content: string }>, chatId: string, userId: string | undefined): Promise<string>
    campaign: (chatId: string, userId: string | undefined) => Promise<{ prefix: string; owned: string[] }>
    /** The whole chat, oldest first. */
    messages: (chatId: string, userId: string | undefined) => Promise<UpdaterMessage[]>
    memo: (chatId: string, userId: string | undefined) => Promise<string>
    options: (userId: string | undefined) => Promise<MapUpdaterOptions>
    /** Whether the rulebook's mapping section is on for this user. */
    enabled: (userId: string | undefined) => Promise<boolean>
    state: MapStore
    /** After a commit or an undo: re-read the maps so the next turn's injection carries the change. */
    refresh: (chatId: string, userId: string | undefined) => Promise<unknown>
    events?: {
        started(chatId: string, userId: string | undefined, site: string, at: string, trigger: MapUpdaterReport['trigger']): void
        finished(chatId: string, userId: string | undefined, report: MapUpdaterReport): void
    }
    log: { info(m: string): void; warn(m: string): void }
    now?: () => Date
    /** The terminal (71b): a step function for a pass on this chat. */
    steps?: (chatId: string, userId: string | undefined) => StepFn
}

export interface MapUpdaterRunRequest {
    chatId: string
    userId: string | undefined
    /** The user's direct instruction for this pass; `''` or absent for a routine one. */
    instruction?: string
    /** User turns to read, in place of the preference. */
    lookback?: number
    /** A site other than the one the party is in. */
    siteRoot?: string
}

export interface MapUpdater {
    /** After a reply: the cadence, the exit pass for a site just left, then the pass itself. Never throws. */
    afterReply(chatId: string, userId: string | undefined, messageId: string | undefined): Promise<MapUpdaterReport | null>
    /** On a swipe or regenerate of the reply the last commit followed: put the entries back. True when something was. */
    rollBack(chatId: string, userId: string | undefined, messageId: string | undefined): Promise<boolean>
    /** From the panel: now, for the party's site or a named one, with an instruction if given. Never throws. */
    run(request: MapUpdaterRunRequest): Promise<MapUpdaterReport>
    running(chatId: string): boolean
}

/** A mapped site as the pass works on it: its root entry's address and its map. */
interface Target {
    siteRoot: string
    bookName: string
    uid: string
    document: MapDocument
}

interface Loaded {
    prefix: string
    books: Array<{ id: string; name: string }>
    sites: MapSites
    messages: UpdaterMessage[]
    /** The last reply's footer. */
    currentLocation: string
}

type Commit =
    | { ok: true; entryId: string; alreadyApplied: boolean; createdAssets: Array<{ id: string; name: string }> }
    | { ok: false; retryable: boolean; issues: ArchitectIssue[] }

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function targetOf(site: MapSite): Target | null {
    const sep = site.entryId.indexOf('::')
    if (sep < 0 || !site.mapChunks?.length) return null
    return { siteRoot: site.siteRoot, bookName: site.entryId.slice(0, sep), uid: site.entryId.slice(sep + 2), document: parseMapDocument(site.mapChunks[0]!, site.siteRoot).document }
}

function siteNamed(sites: MapSites, siteRoot: string): MapSite | null {
    const wanted = normalizeMapLabel(siteRoot)
    if (!wanted) return null
    return Object.values(sites).find((site) => normalizeMapLabel(site.siteRoot) === wanted) ?? null
}

export function createMapUpdater(deps: MapUpdaterDeps): MapUpdater {
    const now = deps.now ?? (() => new Date())
    const inFlight = new Set<string>()

    async function load(chatId: string, userId: string | undefined): Promise<Loaded> {
        const { prefix, owned } = await deps.campaign(chatId, userId)
        const { sites, books } = prefix ? await readMapSites(deps.store(userId), prefix, owned) : { sites: {} as MapSites, books: [] }
        const messages = await deps.messages(chatId, userId)
        const lastReply = [...messages].reverse().find((m) => m.role === 'assistant')
        return { prefix, books, sites, messages, currentLocation: extractFooterLocation(lastReply?.text ?? '') }
    }

    async function finish(chatId: string, userId: string | undefined, report: MapUpdaterReport): Promise<MapUpdaterReport> {
        await deps.state.save(chatId, { lastUpdater: report }, userId).catch(() => undefined)
        deps.events?.finished(chatId, userId, report)
        return report
    }

    /** The transaction committed, the threads recorded, and the undo kept when a reply is to blame. */
    async function commit(chatId: string, userId: string | undefined, loaded: Loaded, target: Target, transaction: Record<string, unknown>, currentTime: string, messageId: string | undefined, bookkeeping: MapUpdaterBookkeeping): Promise<Commit> {
        const committed = await commitMapTransaction(deps.store(userId), loaded.books, target, transaction, currentTime)
        if (!committed.ok) return committed
        if (committed.alreadyApplied) return { ok: true, entryId: committed.entryId, alreadyApplied: true, createdAssets: [] }
        const undo: MapUpdaterUndo = { messageId: messageId ?? '', bookId: committed.bookId, bookName: committed.bookName, restore: committed.restore, created: committed.created, watermark: bookkeeping.watermark }
        const record = await deps.state.load(chatId, userId)
        const threads: ThreadsBySite = appendThreads(record.threadsBySite as ThreadsBySite, target.siteRoot, threadsFromTransaction(transaction, { at: currentTime, createdAssets: committed.createdAssets }))
        await deps.state.save(chatId, { threadsBySite: threads, ...(messageId ? { updaterUndo: undo } : {}) }, userId)
        return { ok: true, entryId: committed.entryId, alreadyApplied: false, createdAssets: committed.createdAssets }
    }

    interface PassShape {
        trigger: MapUpdaterReport['trigger']
        instruction: string
        lookback: number | null
        exitPass: boolean
        inspectorPass: boolean
        previousLocation: string
        messageId: string | undefined
    }

    /** One pass on one site: the prompt, up to three replies, the commit. */
    async function pass(chatId: string, userId: string | undefined, loaded: Loaded, target: Target, shape: PassShape, bookkeeping: MapUpdaterBookkeeping): Promise<MapUpdaterReport> {
        const at = () => now().toISOString()
        if (inFlight.has(chatId)) return { status: 'skipped', at: at(), site: target.siteRoot, trigger: shape.trigger, reason: 'another map update is still running' }
        inFlight.add(chatId)
        deps.events?.started(chatId, userId, target.siteRoot, at(), shape.trigger)
        const step = deps.steps?.(chatId, userId)
        const startedAt = Date.now()
        step?.('start', shape.instruction ? 'Processing direct Map Updater instruction…' : 'Initializing Map Updater…')
        /** The outcome on the feed, by the report's status (71b). */
        const told = async (report: MapUpdaterReport): Promise<MapUpdaterReport> => {
            const out = await finish(chatId, userId, report)
            if (step) {
                const seconds = secondsSince(startedAt)
                if (out.status === 'applied') {
                    step('result', out.summary || 'Transaction accepted.')
                    step('finish', `Applied ${out.operations ?? 0} operation${out.operations === 1 ? '' : 's'} to ${out.site}.`, { seconds })
                } else if (out.status === 'noop') step('finish', `Noop — no durable map fact changed at ${out.site}.`, { seconds })
                else if (out.status === 'skipped') step('finish', `Skipped: ${out.reason ?? 'nothing to do'}.`, { seconds })
                else step('error', out.reason ?? 'The update failed.', { seconds })
            }
            return out
        }
        try {
            const options = await deps.options(userId)
            const memo = await deps.memo(chatId, userId)
            const directPass = !!shape.instruction
            const routine = !directPass && !shape.exitPass && !shape.inspectorPass
            const populationTarget = routine ? resolvePopulationTarget(target.document, loaded.currentLocation) : null
            const manual = shape.trigger === 'manual'
            const window = resolveStoryWindow(loaded.messages, { watermark: bookkeeping.watermark, lookback: shape.lookback ?? options.lookback, manual, minTurns: populationTarget ? BUILDING_POPULATION_MIN_LOOKBACK_TURNS : null })
            const story = formatStory(loaded.messages, window.startIdx)
            const currentTime = currentTimeFor(memo, story)
            const system = selectSystemPrompt(shape.instruction, options.systemPrompt)
            const ctx: UpdaterPromptContext = { siteRoot: target.siteRoot, document: target.document, currentLocation: loaded.currentLocation, story, memo, currentTime, populationTarget, instruction: shape.instruction, exitPass: shape.exitPass, inspectorPass: shape.inspectorPass, previousLocation: shape.previousLocation }
            deps.log.info(`map: updater ${shape.trigger} pass for "${target.siteRoot}" (${loaded.messages.length - window.startIdx} messages${populationTarget ? `, furnishing ${populationTarget.building?.name ?? populationTarget.untrackedName}` : ''}${directPass ? ', direct instruction' : ''})`)
            step?.('thought', `Site: ${target.siteRoot} (${String(target.document.kind ?? '')})\nCurrent location: ${loaded.currentLocation || 'Unknown'}`)
            let prompt = buildUpdaterPrompt(ctx)
            let issues: ArchitectIssue[] = []
            for (let attempt = 0; attempt <= MAX_UPDATER_CORRECTION_ATTEMPTS; attempt++) {
                if (attempt) deps.log.info(`map: updater correction ${attempt} for "${target.siteRoot}"`)
                step?.('thought', attempt ? `Correction pass ${attempt}…` : 'Requesting occupancy update…')
                const reply = await deps.generate([{ role: 'system', content: system }, { role: 'user', content: prompt }], chatId, userId)
                const verdict = checkUpdaterReply(reply, { document: target.document, memo, populationTarget, directPass, currentTime })
                if (verdict.kind === 'noop') {
                    deps.log.info(`map: updater found nothing durable changed at "${target.siteRoot}"`)
                    return await told({ status: 'noop', at: at(), site: target.siteRoot, trigger: shape.trigger })
                }
                if (verdict.kind === 'rejected') {
                    issues = verdict.issues
                } else {
                    const committed = await commit(chatId, userId, loaded, target, verdict.transaction, currentTime, shape.messageId, bookkeeping)
                    if (committed.ok) {
                        const count = Array.isArray(verdict.transaction.operations) ? verdict.transaction.operations.length : 0
                        const summary = summarizeOperations(verdict.transaction)
                        await deps.refresh(chatId, userId).catch((error: unknown) => deps.log.warn(`map: could not re-read the maps after the update: ${describe(error)}`))
                        deps.log.info(`map: updater ${committed.alreadyApplied ? 'had already applied' : 'applied'} ${count} operation${count === 1 ? '' : 's'} to "${target.siteRoot}" (${committed.entryId}): ${summary}`)
                        return await told({ status: 'applied', at: at(), site: target.siteRoot, trigger: shape.trigger, summary, operations: count, entryId: committed.entryId })
                    }
                    issues = committed.issues
                    if (!committed.retryable) break
                }
                if (attempt < MAX_UPDATER_CORRECTION_ATTEMPTS) prompt = buildUpdaterCorrectionPrompt(ctx, reply, issues, attempt + 1)
            }
            const reason = `could not apply a valid transaction: ${describeUpdaterIssues(issues) || 'unknown error'}`
            deps.log.warn(`map: updater for "${target.siteRoot}" ${reason}`)
            return await told({ status: 'failed', at: at(), site: target.siteRoot, trigger: shape.trigger, reason })
        } catch (error) {
            const reason = describe(error)
            deps.log.warn(`map: updater for "${target.siteRoot}" failed: ${reason}`)
            return await told({ status: 'failed', at: at(), site: target.siteRoot, trigger: shape.trigger, reason })
        } finally {
            inFlight.delete(chatId)
        }
    }

    return {
        running: (chatId) => inFlight.has(chatId),

        async afterReply(chatId, userId, messageId) {
            try {
                if (!(await deps.enabled(userId))) return null
                const options = await deps.options(userId)
                if (!options.enabled) return null
                const record = await deps.state.load(chatId, userId)
                const bookkeeping: MapUpdaterBookkeeping = { ...record.updater, tick: record.updater.tick + 1 }
                const loaded = await load(chatId, userId)
                const active = resolveActiveMapSite(loaded.sites, loaded.currentLocation)
                const currentRoot = active?.siteRoot ?? ''
                let report: MapUpdaterReport | null = null

                // Leaving a site: one pass over the site left, for who left with the party.
                const previousRoot = bookkeeping.lastSiteRoot
                let pendingExit = bookkeeping.pendingExitRoot
                if (!pendingExit && previousRoot && normalizeMapLabel(previousRoot) !== normalizeMapLabel(currentRoot)) pendingExit = previousRoot
                if (pendingExit) {
                    const left = siteNamed(loaded.sites, pendingExit)
                    const target = left ? targetOf(left) : null
                    if (target) {
                        report = await pass(chatId, userId, loaded, target, { trigger: 'exit', instruction: '', lookback: null, exitPass: true, inspectorPass: false, previousLocation: previousFooterForSite(loaded.messages, pendingExit), messageId }, bookkeeping)
                        if (report.status !== 'skipped') bookkeeping.watermark = loaded.messages.length
                    }
                    bookkeeping.pendingExitRoot = report?.status === 'skipped' ? pendingExit : ''
                }
                bookkeeping.lastSiteRoot = currentRoot

                // The pass itself: on the cadence, or at once for a building just entered.
                const target = active ? targetOf(active) : null
                const runEvery = Math.max(1, Math.floor(options.runEvery) || 1)
                const force = !!target && !!resolvePopulationTarget(target.document, loaded.currentLocation)
                if (target && (bookkeeping.tick >= runEvery || force)) {
                    const result = await pass(chatId, userId, loaded, target, { trigger: 'reply', instruction: '', lookback: null, exitPass: false, inspectorPass: false, previousLocation: '', messageId }, bookkeeping)
                    if (result.status !== 'skipped') {
                        bookkeeping.tick = 0
                        bookkeeping.watermark = loaded.messages.length
                    }
                    report = result
                }
                await deps.state.save(chatId, { updater: bookkeeping }, userId)
                return report
            } catch (error) {
                deps.log.warn(`map: updater could not run after the reply: ${describe(error)}`)
                return null
            }
        },

        async rollBack(chatId, userId, messageId) {
            if (!messageId) return false
            const record = await deps.state.load(chatId, userId)
            const undo = record.updaterUndo
            if (!undo || undo.messageId !== messageId) return false
            const store = deps.store(userId)
            for (const entry of undo.restore) {
                await store.updateEntry(entry.id, { content: entry.content, extensions: entry.extensions ?? {}, disabled: entry.id === undo.restore[0]!.id ? true : undefined })
            }
            for (const id of undo.created) await store.deleteEntry(id)
            const site = record.lastUpdater?.site ?? ''
            const report: MapUpdaterReport = { status: 'undone', at: now().toISOString(), site, trigger: record.lastUpdater?.trigger ?? 'reply', reason: 'the reply it followed was replaced' }
            await deps.state.save(chatId, {
                updaterUndo: undefined,
                updater: { ...record.updater, watermark: Math.min(record.updater.watermark, undo.watermark) },
                lastUpdater: report,
            }, userId)
            await deps.refresh(chatId, userId).catch((error: unknown) => deps.log.warn(`map: could not re-read the maps after the undo: ${describe(error)}`))
            deps.log.info(`map: updater rolled back its last update to "${site}" (${undo.restore.length} restored, ${undo.created.length} removed)`)
            // Announced like a pass, so the fold says so at once rather than
            // when something else makes it reload (34b-bis).
            deps.events?.finished(chatId, userId, report)
            return true
        },

        async run(request) {
            const { chatId, userId } = request
            const at = () => now().toISOString()
            const wanted = String(request.siteRoot ?? '').trim()
            try {
                if (!(await deps.enabled(userId))) return await finish(chatId, userId, { status: 'skipped', at: at(), site: wanted, trigger: 'manual', reason: 'the rulebook’s mapping section is off' })
                const record = await deps.state.load(chatId, userId)
                const loaded = await load(chatId, userId)
                const active = resolveActiveMapSite(loaded.sites, loaded.currentLocation)
                const site = wanted ? siteNamed(loaded.sites, wanted) : active
                const target = site ? targetOf(site) : null
                if (!target) {
                    return await finish(chatId, userId, { status: 'skipped', at: at(), site: wanted || active?.siteRoot || '', trigger: 'manual', reason: wanted ? `no map is attached to "${wanted}"` : 'the party is not inside a mapped site' })
                }
                const inspectorPass = !!wanted && site !== active
                const bookkeeping = { ...record.updater }
                const report = await pass(chatId, userId, loaded, target, { trigger: 'manual', instruction: String(request.instruction ?? '').trim(), lookback: request.lookback ?? null, exitPass: false, inspectorPass, previousLocation: '', messageId: undefined }, bookkeeping)
                if (report.status !== 'skipped') await deps.state.save(chatId, { updater: { ...bookkeeping, watermark: loaded.messages.length } }, userId)
                return report
            } catch (error) {
                const reason = describe(error)
                deps.log.warn(`map: updater could not run: ${reason}`)
                return await finish(chatId, userId, { status: 'failed', at: at(), site: wanted, trigger: 'manual', reason })
            }
        },
    }
}
