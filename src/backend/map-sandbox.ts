/**
 * Map Evolution's Testing Ground (Phase 71d, roadmap row 71): Multihog's
 * flask — time, entities and Evolution ticks on one mapped site without
 * playing through the campaign.
 *
 * The legacy's `map-evolution-debug.js`, ported by hand: the clock is the
 * memo's `[TIME]` block, set or advanced; an entity is added or changed
 * through one `DEBUG_SANDBOX` transaction judged by the document's rules
 * and committed as a pass's is, its threads and its backlog line recorded
 * so the next pass has a trajectory; **Evolve this map now** is the
 * ordinary manual pass on that site; **Simulate ticks** advances the clock
 * by N hours and evolves, N times; **Undo** puts the map, `[TIME]`, Last
 * Evolved and the evolution memory back to just before the last Evolve or
 * Simulate, and **Redo** restores that snapshot and runs the same action
 * again; **Clear evolution history** forgets the site's backlog, threads
 * and felt reports and leaves the map and the clocks alone. The last pass
 * is remembered in memory, per chat, until the backend restarts.
 */

import {
    clearEvolutionHistoryForSite,
    collectArcSubjects,
    describeAssetArc,
    describeMemoryUsage,
    describeThreads,
    describeTimeWindow,
    MAX_MAP_EVOLUTION_THREADS,
    parseInWorldMinutes,
    replaceMemoCurrentTime,
    siteKey,
    appendBacklogEntry,
    summarizeDigest,
    type ArcSubject,
    type AssetArc,
    type BacklogBySite,
    type BacklogEntry,
    type MemoryUsage,
    type ThreadsDescription,
} from '../tracker/evolution.js'
import { parseMapDocument, type MapDocument, type MapSites } from '../tracker/map.js'
import { createMapLegacy } from '../tracker/map-legacy.js'
import { currentTimeFromMemo, extractCurrentTimeStr } from '../tracker/time.js'
import { appendThreads, threadsFromTransaction, type ThreadsBySite } from '../tracker/updater.js'
import { formatInWorldTime } from '../tracker/world.js'
import { commitMapTransaction, type RestoredEntry } from './map-commit.js'
import type { MapEvolution } from './map-evolution.js'
import type { MapEvolutionBookkeeping, MapEvolutionReport, MapStore } from './map-store.js'
import { readMapSites, type MapBookReader } from './map-sync.js'
import type { MemoRecord } from './memo-store.js'
import type { WorldBookStore, WorldEntry } from './world-pass.js'

const legacyMap = createMapLegacy()
/** The asset kinds the Create entity form offers: the document library's, in its order. */
export const SANDBOX_ASSET_KINDS: readonly string[] = legacyMap.MAP_ASSET_KINDS as string[]
/** The states the Kill / change form offers, in the legacy's order. */
export const SANDBOX_ASSET_STATES: readonly string[] = ['DESTROYED', 'DEAD', 'DEACTIVATED', 'DAMAGED', 'FLEEING', 'LEFT', 'ACTIVE', 'ALERT']
export const MAX_SANDBOX_TICKS = 20

export interface MapSandboxDeps {
    store: (userId: string | undefined) => WorldBookStore & MapBookReader
    campaign: (chatId: string, userId: string | undefined) => Promise<{ prefix: string; owned: string[] }>
    memos: {
        load(chatId: string, userId: string | undefined): Promise<MemoRecord>
        save(chatId: string, memo: string, userId: string | undefined, meta: { previous?: string; lastMessageId?: string; lastPass?: MemoRecord['lastPass'] }): Promise<unknown>
    }
    /** After the memo's clock moved: the panel's cards redraw from this. */
    memoChanged: (chatId: string, userId: string | undefined, memo: string) => void
    state: MapStore
    evolution: Pick<MapEvolution, 'run' | 'running'>
    /** Whether another agent — the lorebook agent, the updater — is on the chat now; the legacy refuses to run beside one. */
    othersRunning: (chatId: string) => boolean
    options: (userId: string | undefined) => Promise<{ intervalHours: number; compressEnabled: boolean; compressThreshold: number }>
    refresh: (chatId: string, userId: string | undefined) => Promise<unknown>
    /** A simulate's tick, as it goes. */
    progress?: (chatId: string, userId: string | undefined, tick: SandboxTick) => void
    log: { info(m: string): void; warn(m: string): void }
}

export interface SandboxTick {
    index: number
    count: number
    timeLabel: string
    phase: 'time' | 'evolved'
}

export interface SandboxSite {
    siteRoot: string
    current: boolean
}

export interface SandboxLastPass {
    type: 'evolve' | 'simulate'
    siteRoot: string
    ticks?: number
    hoursPerTick?: number
    undone: boolean
}

/** The sandbox's reading of one site: what the legacy's popup paints. */
export interface SandboxView {
    timeLabel: string
    minutes: number
    sites: SandboxSite[]
    siteRoot: string
    kind: string
    areas: Array<{ id: string; name: string }>
    assets: Array<{ id: string; name: string; kind: string; state: string; location: string; count?: number; actor?: string; cause?: string; changedAt?: string }>
    kinds: string[]
    states: string[]
    lastEvolved: string
    elapsed: string
    memory: MemoryUsage
    threads: ThreadsDescription
    arcSubjects: ArcSubject[]
    /** The arc of the subject asked for, when one was. */
    arc?: AssetArc
    lastPass: SandboxLastPass | null
    /** The default hours for Advance and Simulate: the off-site dial. */
    intervalHours: number
    problem?: string
}

export type SandboxOutcome =
    | { ok: true; timeLabel?: string; minutes?: number; applied?: number; evolved?: MapEvolutionReport; ticks?: number; hoursPerTick?: number; redone?: boolean; action?: SandboxLastPass; createdAssets?: Array<{ id: string; name: string }> }
    | { ok: false; error: string; skipped?: 'busy' | 'chat_changed' | 'stopped' }

export interface MapSandbox {
    describe(chatId: string, userId: string | undefined, siteRoot?: string, arcSubject?: string): Promise<SandboxView>
    setTime(chatId: string, userId: string | undefined, label: string): Promise<SandboxOutcome>
    advance(chatId: string, userId: string | undefined, minutes: number): Promise<SandboxOutcome>
    addAsset(chatId: string, userId: string | undefined, request: SandboxAddRequest): Promise<SandboxOutcome>
    setAsset(chatId: string, userId: string | undefined, request: SandboxSetRequest): Promise<SandboxOutcome>
    evolve(chatId: string, userId: string | undefined, siteRoot: string): Promise<SandboxOutcome>
    simulate(chatId: string, userId: string | undefined, request: { siteRoot: string; ticks: number; hoursPerTick: number }): Promise<SandboxOutcome>
    undo(chatId: string, userId: string | undefined): Promise<SandboxOutcome>
    redo(chatId: string, userId: string | undefined): Promise<SandboxOutcome>
    clearHistory(chatId: string, userId: string | undefined, siteRoot: string): Promise<SandboxOutcome>
    /** Forget the chat's last pass: a chat switch in the legacy. */
    forget(chatId: string): void
}

export interface SandboxAddRequest {
    siteRoot: string
    name: string
    kind?: string
    location: string
    state?: string
    knowledge?: string
    faction?: string
    detail?: string
    count?: number | string
    cause: string
    actor?: string
}

export interface SandboxSetRequest {
    siteRoot: string
    assetId: string
    state?: string
    detail?: string
    count?: number | string
    cause: string
    actor?: string
    threadStatus?: string
}

interface Snapshot {
    chatId: string
    memo: MemoRecord
    evolution: MapEvolutionBookkeeping
    threadsBySite: Record<string, unknown[]>
    lastEvolution: MapEvolutionReport | undefined
    /** Every entry of every place book, as it stood: put back on undo; entries made since are removed. */
    books: Array<{ bookId: string; entries: RestoredEntry[] }>
}

interface LastPass {
    action: SandboxLastPass
    snapshot: Snapshot
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function operationId(suffix: string): string {
    const slug = String(suffix || 'op').replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'op'
    return `debug-${Date.now()}-${slug}`.slice(0, 120)
}

function timeLabelOf(memo: string): string {
    return extractCurrentTimeStr(currentTimeFromMemo(memo))
}

function minutesOf(memo: string): number {
    return parseInWorldMinutes(timeLabelOf(memo))
}

export function createMapSandbox(deps: MapSandboxDeps): MapSandbox {
    const lastPasses = new Map<string, LastPass>()

    async function loadSites(chatId: string, userId: string | undefined) {
        const { prefix, owned } = await deps.campaign(chatId, userId)
        const { sites, books } = prefix ? await readMapSites(deps.store(userId), prefix, owned) : { sites: {} as MapSites, books: [] }
        const record = await deps.state.load(chatId, userId)
        const list = Object.values(sites).map((site) => {
            const sep = site.entryId.indexOf('::')
            return { siteRoot: site.siteRoot, bookName: sep < 0 ? '' : site.entryId.slice(0, sep), uid: sep < 0 ? '' : site.entryId.slice(sep + 2), document: site.mapChunks?.length ? parseMapDocument(site.mapChunks[0]!, site.siteRoot).document : null }
        })
        return { prefix, books, sites: list, record }
    }

    function busy(chatId: string): boolean {
        return deps.evolution.running(chatId) || deps.othersRunning(chatId)
    }

    function lastPassOf(chatId: string): SandboxLastPass | null {
        const last = lastPasses.get(chatId)
        return last ? { ...last.action } : null
    }

    async function writeTime(chatId: string, userId: string | undefined, minutes: number): Promise<SandboxOutcome> {
        const formatted = formatInWorldTime(minutes)
        const current = await deps.memos.load(chatId, userId)
        const next = replaceMemoCurrentTime(current.memo, formatted)
        await deps.memos.save(chatId, next, userId, { ...(current.previous !== undefined ? { previous: current.previous } : {}), ...(current.lastMessageId !== undefined ? { lastMessageId: current.lastMessageId } : {}), ...(current.lastPass !== undefined ? { lastPass: current.lastPass } : {}) })
        deps.memoChanged(chatId, userId, next)
        deps.log.info(`map: sandbox set the clock of chat ${chatId} to "${formatted}"`)
        return { ok: true, timeLabel: formatted, minutes }
    }

    async function setTime(chatId: string, userId: string | undefined, label: string): Promise<SandboxOutcome> {
        const text = String(label ?? '').trim()
        if (!text) return { ok: false, error: 'Supply an in-world time label.' }
        const minutes = parseInWorldMinutes(text)
        if (minutes < 0) return { ok: false, error: `Could not parse in-world time: ${text}` }
        return writeTime(chatId, userId, minutes)
    }

    async function advance(chatId: string, userId: string | undefined, deltaMinutes: number): Promise<SandboxOutcome> {
        const delta = Math.floor(Number(deltaMinutes) || 0)
        if (!Number.isFinite(delta) || delta === 0) return { ok: false, error: 'Advance time by a non-zero number of in-world minutes.' }
        const current = minutesOf((await deps.memos.load(chatId, userId)).memo)
        if (current < 0) return { ok: false, error: 'No parseable [TIME] block in the current memo.' }
        return writeTime(chatId, userId, Math.max(0, current + delta))
    }

    /** The legacy's snapshot: the memo, the evolution ledgers and every place book's entries. */
    async function snapshot(chatId: string, userId: string | undefined): Promise<Snapshot> {
        const { books, record } = await loadSites(chatId, userId)
        const store = deps.store(userId)
        const kept: Snapshot['books'] = []
        for (const book of books) {
            const entries: WorldEntry[] = await store.listEntries(book.id)
            kept.push({ bookId: book.id, entries: entries.map((e) => ({ id: e.id, content: e.content, ...(e.extensions ? { extensions: clone(e.extensions) } : {}) })) })
        }
        return { chatId, memo: clone(await deps.memos.load(chatId, userId)), evolution: clone(record.evolution), threadsBySite: clone(record.threadsBySite), lastEvolution: record.lastEvolution ? clone(record.lastEvolution) : undefined, books: kept }
    }

    async function restore(chatId: string, userId: string | undefined, snap: Snapshot): Promise<SandboxOutcome> {
        if (snap.chatId !== chatId) return { ok: false, error: 'The snapshot belongs to another chat.', skipped: 'chat_changed' }
        const store = deps.store(userId)
        let put = 0
        let removed = 0
        for (const book of snap.books) {
            let live: WorldEntry[]
            try { live = await store.listEntries(book.bookId) } catch (error) { return { ok: false, error: `Could not restore the Locations book: ${describeError(error)}` } }
            const keep = new Set(book.entries.map((e) => e.id))
            for (const entry of book.entries) {
                const now = live.find((e) => e.id === entry.id)
                if (!now) continue
                if (now.content !== entry.content || JSON.stringify(now.extensions ?? {}) !== JSON.stringify(entry.extensions ?? {})) {
                    await store.updateEntry(entry.id, { content: entry.content, extensions: entry.extensions ?? {} })
                    put += 1
                }
            }
            for (const entry of live) if (!keep.has(entry.id)) { await store.deleteEntry(entry.id); removed += 1 }
        }
        await deps.state.save(chatId, { evolution: clone(snap.evolution), threadsBySite: clone(snap.threadsBySite), lastEvolution: snap.lastEvolution ? clone(snap.lastEvolution) : undefined, evolutionUndo: undefined }, userId)
        await deps.memos.save(chatId, snap.memo.memo, userId, { ...(snap.memo.previous !== undefined ? { previous: snap.memo.previous } : {}), ...(snap.memo.lastMessageId !== undefined ? { lastMessageId: snap.memo.lastMessageId } : {}), ...(snap.memo.lastPass !== undefined ? { lastPass: snap.memo.lastPass } : {}) })
        deps.memoChanged(chatId, userId, snap.memo.memo)
        await deps.refresh(chatId, userId).catch((error: unknown) => deps.log.warn(`map: sandbox could not re-read the maps after the restore: ${describeError(error)}`))
        deps.log.info(`map: sandbox restored chat ${chatId} to before its last pass (${put} entries put back, ${removed} removed)`)
        return { ok: true }
    }

    async function checkpoint(chatId: string, userId: string | undefined, action: SandboxLastPass): Promise<void> {
        lastPasses.set(chatId, { action: { ...action, undone: false }, snapshot: await snapshot(chatId, userId) })
    }

    async function commit(chatId: string, userId: string | undefined, siteRoot: string, transaction: Record<string, unknown>): Promise<SandboxOutcome> {
        const { books, sites, record } = await loadSites(chatId, userId)
        const site = sites.find((s) => siteKey(s.siteRoot) === siteKey(siteRoot))
        if (!site || !site.document) return { ok: false, error: `No mapped site named ${siteRoot}.` }
        const timeLabel = timeLabelOf((await deps.memos.load(chatId, userId)).memo)
        const committed = await commitMapTransaction(deps.store(userId), books, site, transaction, timeLabel)
        if (!committed.ok) return { ok: false, error: committed.issues.map((issue) => `${issue.code}: ${issue.hint}`).join('; ') || 'Invalid map transaction.' }
        const threads = appendThreads(record.threadsBySite as ThreadsBySite, site.siteRoot, threadsFromTransaction(transaction, { at: timeLabel, createdAssets: committed.createdAssets }))
        const bk: MapEvolutionBookkeeping = clone(record.evolution)
        const digest = summarizeDigest(site.siteRoot, transaction)
        if (digest) bk.backlogBySite = appendBacklogEntry(bk.backlogBySite as BacklogBySite, site.siteRoot, { kind: 'commit', at: timeLabel, elapsedMinutes: -1, operationId: String(transaction.operation_id ?? ''), summary: digest })
        await deps.state.save(chatId, { evolution: bk, threadsBySite: threads }, userId)
        await deps.refresh(chatId, userId).catch((error: unknown) => deps.log.warn(`map: sandbox could not re-read the maps after its commit: ${describeError(error)}`))
        deps.log.info(`map: sandbox committed ${String(transaction.operation_id ?? '')} to "${site.siteRoot}"${digest ? `: ${digest}` : ''}`)
        return { ok: true, createdAssets: committed.createdAssets }
    }

    async function runTicks(chatId: string, userId: string | undefined, siteRoot: string, count: number, hours: number): Promise<SandboxOutcome> {
        for (let index = 0; index < count; index++) {
            if (busy(chatId)) return { ok: false, skipped: 'busy', error: 'An agent is already running.' }
            const advanced = await advance(chatId, userId, hours * 60)
            if (!advanced.ok) return advanced
            deps.progress?.(chatId, userId, { index, count, timeLabel: advanced.timeLabel ?? '', phase: 'time' })
            const evolved = await deps.evolution.run({ chatId, userId, siteRoots: [siteRoot] })
            deps.progress?.(chatId, userId, { index, count, timeLabel: advanced.timeLabel ?? '', phase: 'evolved' })
            if (evolved.status === 'skipped') return { ok: false, skipped: 'stopped', error: evolved.reason ?? 'The pass was skipped.' }
        }
        return { ok: true, ticks: count, hoursPerTick: hours }
    }

    function evolveOutcome(report: MapEvolutionReport): SandboxOutcome {
        if (report.status === 'skipped' || report.status === 'failed') return { ok: false, error: report.reason ?? 'Evolution failed.' }
        const applied = report.sites.filter((s) => s.status === 'applied').reduce((sum, s) => sum + (s.operations ?? 0), 0)
        return { ok: true, applied, evolved: report }
    }

    return {
        async describe(chatId, userId, wantedRoot = '', arcSubject = '') {
            const empty = (problem?: string): SandboxView => ({ timeLabel: '', minutes: -1, sites: [], siteRoot: '', kind: '', areas: [], assets: [], kinds: [...SANDBOX_ASSET_KINDS], states: [...SANDBOX_ASSET_STATES], lastEvolved: 'Never', elapsed: 'Unknown', memory: describeMemoryUsage({}, {}, '', { threshold: 10000, compressEnabled: true }), threads: { entries: [], open: [], truncated: false }, arcSubjects: [], lastPass: lastPassOf(chatId), intervalHours: 8, ...(problem ? { problem } : {}) })
            try {
                const [{ sites, record }, memoRecord, options] = await Promise.all([loadSites(chatId, userId), deps.memos.load(chatId, userId), deps.options(userId)])
                const timeLabel = timeLabelOf(memoRecord.memo)
                const wanted = siteKey(wantedRoot) || siteKey(record.activeSiteRoot) || siteKey(sites[0]?.siteRoot ?? '')
                const site = sites.find((s) => siteKey(s.siteRoot) === wanted) ?? null
                const root = site?.siteRoot ?? wantedRoot
                const key = siteKey(root)
                const lastEvolved = record.evolution.lastFiredBySite[key] ?? ''
                const window = describeTimeWindow(lastEvolved, timeLabel)
                const memory = describeMemoryUsage(record.threadsBySite as ThreadsBySite, record.evolution.backlogBySite as BacklogBySite, root, { threshold: options.compressThreshold, compressEnabled: options.compressEnabled })
                const document: MapDocument | null = site?.document ?? null
                const subjects = collectArcSubjects(memory.storedThreads, document)
                const chosen = String(arcSubject ?? '').trim()
                return {
                    timeLabel,
                    minutes: parseInWorldMinutes(timeLabel),
                    sites: sites.map((s) => ({ siteRoot: s.siteRoot, current: siteKey(s.siteRoot) === siteKey(record.activeSiteRoot) && !!record.activeSiteRoot })),
                    siteRoot: root,
                    kind: document ? String(document.kind ?? '') : '',
                    areas: (document?.areas ?? []).map((a) => ({ id: String(a.id), name: String(a.name ?? a.id) })),
                    assets: (document?.assets ?? []).map((a) => ({ id: String(a.id), name: String(a.name ?? a.id), kind: String(a.kind ?? ''), state: String(a.state ?? ''), location: String(a.location ?? ''), ...(Number.isInteger(a.count) ? { count: Number(a.count) } : {}), ...(a.actor ? { actor: String(a.actor) } : {}), ...(a.cause ? { cause: String(a.cause) } : {}), ...(a.changed_at ? { changedAt: String(a.changed_at) } : {}) })),
                    kinds: [...SANDBOX_ASSET_KINDS],
                    states: [...SANDBOX_ASSET_STATES],
                    lastEvolved: lastEvolved || 'Never',
                    elapsed: window.elapsed || 'Unknown',
                    memory,
                    threads: describeThreads(record.threadsBySite as ThreadsBySite, root, { lookback: MAX_MAP_EVOLUTION_THREADS }),
                    arcSubjects: subjects,
                    ...(chosen && subjects.some((s) => s.id === chosen) ? { arc: describeAssetArc(memory.storedThreads, chosen, { storedBacklog: memory.storedBacklog as BacklogEntry[], document }) } : {}),
                    lastPass: lastPassOf(chatId),
                    intervalHours: options.intervalHours,
                }
            } catch (error) {
                const reason = describeError(error)
                deps.log.warn(`map: the sandbox could not read chat ${chatId}: ${reason}`)
                return empty(reason)
            }
        },

        setTime: (chatId, userId, label) => setTime(chatId, userId, label).catch((error: unknown) => ({ ok: false, error: describeError(error) })),
        advance: (chatId, userId, minutes) => advance(chatId, userId, minutes).catch((error: unknown) => ({ ok: false, error: describeError(error) })),

        async addAsset(chatId, userId, request) {
            const cause = String(request.cause ?? '').trim()
            if (!String(request.name ?? '').trim()) return { ok: false, error: 'Name is required.' }
            if (!String(request.location ?? '').trim()) return { ok: false, error: 'Location (area id) is required.' }
            if (!cause) return { ok: false, error: 'Cause is required.' }
            const state = String(request.state || 'ACTIVE')
            const operation: Record<string, unknown> = { op: 'ADD_ASSET', evidence: 'CONFIRMED', name: String(request.name).trim(), kind: request.kind || 'CREATURE', location: String(request.location).trim(), state, knowledge: request.knowledge || 'UNREVEALED', detail: String(request.detail ?? '').trim(), origin: 'DEBUG_SANDBOX', cause }
            const count = Math.floor(Number(request.count))
            if (Number.isFinite(count) && count >= 1) operation.count = count
            if (request.faction) operation.faction = String(request.faction).trim()
            if (request.actor) operation.actor = String(request.actor).trim()
            if (['DEAD', 'DESTROYED'].includes(state.toUpperCase()) && !operation.actor) return { ok: false, error: 'DEAD/DESTROYED requires an actor (party, asset id, or off-map name).' }
            return commit(chatId, userId, request.siteRoot, { operation_id: operationId(String(request.name)), operations: [operation], chronicles: [] }).catch((error: unknown) => ({ ok: false, error: describeError(error) }))
        },

        async setAsset(chatId, userId, request) {
            const cause = String(request.cause ?? '').trim()
            if (!String(request.assetId ?? '').trim()) return { ok: false, error: 'Asset id is required.' }
            if (!cause) return { ok: false, error: 'Cause is required.' }
            const operation: Record<string, unknown> = { op: 'SET_ASSET', evidence: 'CONFIRMED', asset_id: String(request.assetId).trim(), cause }
            if (request.state) operation.state = request.state
            if (request.detail != null && request.detail !== '') operation.detail = String(request.detail)
            const count = Math.floor(Number(request.count))
            if (Number.isFinite(count) && count >= 1) operation.count = count
            if (request.actor) operation.actor = String(request.actor).trim()
            if (request.threadStatus) operation.thread_status = request.threadStatus
            if (['DEAD', 'DESTROYED'].includes(String(request.state ?? '').toUpperCase()) && !operation.actor) return { ok: false, error: 'DEAD/DESTROYED requires an actor (party, asset id, or off-map name).' }
            return commit(chatId, userId, request.siteRoot, { operation_id: operationId(String(request.assetId)), operations: [operation], chronicles: [] }).catch((error: unknown) => ({ ok: false, error: describeError(error) }))
        },

        async evolve(chatId, userId, siteRoot) {
            const root = String(siteRoot ?? '').trim()
            if (!root) return { ok: false, error: 'Pick a mapped site.' }
            if (busy(chatId)) return { ok: false, skipped: 'busy', error: 'An agent is already running.' }
            try {
                await checkpoint(chatId, userId, { type: 'evolve', siteRoot: root, undone: false })
                deps.log.info(`map: sandbox evolving "${root}" now`)
                return evolveOutcome(await deps.evolution.run({ chatId, userId, siteRoots: [root] }))
            } catch (error) { return { ok: false, error: describeError(error) } }
        },

        async simulate(chatId, userId, request) {
            const root = String(request.siteRoot ?? '').trim()
            if (!root) return { ok: false, error: 'Pick a mapped site.' }
            if (busy(chatId)) return { ok: false, skipped: 'busy', error: 'An agent is already running.' }
            const count = Math.max(1, Math.min(MAX_SANDBOX_TICKS, Math.floor(Number(request.ticks) || 1)))
            const hours = Math.max(1, Math.floor(Number(request.hoursPerTick) || (await deps.options(userId)).intervalHours || 8))
            try {
                await checkpoint(chatId, userId, { type: 'simulate', siteRoot: root, ticks: count, hoursPerTick: hours, undone: false })
                deps.log.info(`map: sandbox simulating ${count} tick${count === 1 ? '' : 's'} of ${hours}h on "${root}"`)
                return await runTicks(chatId, userId, root, count, hours)
            } catch (error) { return { ok: false, error: describeError(error) } }
        },

        async undo(chatId, userId) {
            const last = lastPasses.get(chatId)
            if (!last) return { ok: false, error: 'No Evolution pass to undo. Run one first.' }
            if (last.action.undone) return { ok: false, error: 'Last pass is already undone. Redo it or run a new one.' }
            if (busy(chatId)) return { ok: false, skipped: 'busy', error: 'An agent is already running.' }
            try {
                const restored = await restore(chatId, userId, last.snapshot)
                if (!restored.ok) return restored
                last.action.undone = true
                return { ok: true, action: { ...last.action } }
            } catch (error) { return { ok: false, error: describeError(error) } }
        },

        async redo(chatId, userId) {
            const last = lastPasses.get(chatId)
            if (!last) return { ok: false, error: 'No Evolution pass to redo. Run one first.' }
            if (busy(chatId)) return { ok: false, skipped: 'busy', error: 'An agent is already running.' }
            try {
                const restored = await restore(chatId, userId, last.snapshot)
                if (!restored.ok) return restored
                const action = last.action
                const result = action.type === 'simulate'
                    ? await runTicks(chatId, userId, action.siteRoot, action.ticks ?? 1, action.hoursPerTick ?? 8)
                    : evolveOutcome(await deps.evolution.run({ chatId, userId, siteRoots: [action.siteRoot] }))
                last.action.undone = false
                return result.ok ? { ...result, redone: true, action: { ...last.action } } : result
            } catch (error) { return { ok: false, error: describeError(error) } }
        },

        async clearHistory(chatId, userId, siteRoot) {
            const root = String(siteRoot ?? '').trim()
            if (!root) return { ok: false, error: 'Pick a mapped site.' }
            try {
                const record = await deps.state.load(chatId, userId)
                const cleared = clearEvolutionHistoryForSite({ backlogBySite: record.evolution.backlogBySite, threadsBySite: record.threadsBySite, reportApplicationsBySite: record.evolution.reportApplications }, root)
                if (!cleared.cleared) return { ok: false, error: 'Could not resolve that site.' }
                const bk: MapEvolutionBookkeeping = { ...clone(record.evolution), backlogBySite: cleared.backlogBySite, reportApplications: cleared.reportApplicationsBySite }
                await deps.state.save(chatId, { evolution: bk, threadsBySite: cleared.threadsBySite }, userId)
                deps.log.info(`map: sandbox cleared the evolution history of "${root}"`)
                return { ok: true }
            } catch (error) { return { ok: false, error: describeError(error) } }
        },

        forget: (chatId) => { lastPasses.delete(chatId) },
    }
}
