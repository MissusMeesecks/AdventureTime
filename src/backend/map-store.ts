/**
 * What the hidden map remembers per chat (roadmap row 9, Phase 34).
 *
 * The maps themselves live in the campaign's Location entries; this is the
 * window onto them the interceptor reads without a host round trip (the
 * memo's rule, for the memo's reason): where the party was at the last reply,
 * which sites are mapped, which one they are in, and the two prompt blocks
 * already rendered. Rebuilt after every reply by the sync; kept on disk so a
 * restart does not blank the narrator's canon until the next reply.
 */

import { chatFilePath, type MemoStorage } from './memo-store.js'

export interface MapSiteRecord {
    siteRoot: string
    kind: string
    entryId: string
}

/** What the Map Architect last did for this chat (Phase 34a). */
export interface MapArchitectReport {
    status: 'written' | 'reused' | 'failed'
    /** When it finished, ISO 8601. */
    at: string
    site: string
    kind?: string
    areas?: number
    assets?: number
    /** `Book::uid` of the entry the map was saved in. */
    entryId?: string
    /** Why, when nothing was saved. */
    reason?: string
}

/** What the Map Updater last did for this chat (Phase 34b). */
export interface MapUpdaterReport {
    status: 'applied' | 'noop' | 'skipped' | 'failed' | 'undone'
    /** When it finished, ISO 8601. */
    at: string
    site: string
    /** After a reply, on leaving a site, or from the panel. */
    trigger: 'reply' | 'exit' | 'manual'
    /** The operations on one line, and how many, when applied. */
    summary?: string
    operations?: number
    /** `Book::uid` of the root entry written. */
    entryId?: string
    /** Why, when skipped or failed. */
    reason?: string
}

/** The updater's cadence and memory between replies (Phase 34b). */
export interface MapUpdaterBookkeeping {
    /** Replies since the updater last ran; it runs at `runEvery`. */
    tick: number
    /** The chat's length when the updater last read it; the next pass reads from here. */
    watermark: number
    /** The site the party was in at the last reply, so leaving one is noticed. */
    lastSiteRoot: string
    /** A site left but not yet reviewed, when the exit pass could not run. */
    pendingExitRoot: string
}

/** What the last commit changed, so a swipe or regenerate of the reply it followed can put it back. */
export interface MapUpdaterUndo {
    messageId: string
    bookId: string
    bookName: string
    restore: Array<{ id: string; content: string; extensions?: Record<string, unknown> }>
    /** Entries the commit created, to delete. */
    created: string[]
    /** The watermark before the commit, so the swiped reply is read again. */
    watermark: number
}

/** What one Map Evolution pass did to one site (Phase 34c). */
export interface MapEvolutionSiteResult {
    siteRoot: string
    status: 'applied' | 'noop' | 'failed' | 'baseline'
    /** The digest, when applied. */
    summary?: string
    operations?: number
    reason?: string
    /** Digests the site's closed history was compressed into, when it was. */
    compressed?: number
}

/** What the last Map Evolution pass did for this chat (Phase 34c). */
export interface MapEvolutionReport {
    status: 'applied' | 'noop' | 'baseline' | 'skipped' | 'failed' | 'undone'
    at: string
    trigger: 'interval' | 'site_exit' | 'manual'
    /** The in-world time the pass ran at. */
    currentTime?: string
    sites: MapEvolutionSiteResult[]
    reason?: string
}

/** Map Evolution's memory between replies (Phase 34c): the clocks, the ledgers and the site last seen. */
export interface MapEvolutionBookkeeping {
    /** When each site last evolved, as an in-world label, by the site's loose key. */
    lastFiredBySite: Record<string, string>
    /** Each site's bounded ledger of passes. */
    backlogBySite: Record<string, unknown[]>
    /** Which World reports each site has felt. */
    reportApplications: Record<string, Record<string, unknown>>
    lastSiteRoot: string
    pendingExitRoot: string
    /** A site's own hours between passes, by its loose key (71d): wins over the on-site and off-site dials, 0 for never. */
    intervalHoursBySite: Record<string, number>
}

/** What the last Evolution pass changed, so a swipe of the reply it followed can put it back. */
export interface MapEvolutionUndo {
    messageId: string
    restore: Array<{ id: string; content: string; extensions?: Record<string, unknown> }>
    created: string[]
    bookkeeping: MapEvolutionBookkeeping
    threadsBySite: Record<string, unknown[]>
}

export interface MapRecord {
    version: 1
    /** The last reply's Location footer, `''` when it had none. */
    currentLocation: string
    sites: MapSiteRecord[]
    /** The site the party is in, or `''`. */
    activeSiteRoot: string
    /** Sites the user's last message named exactly; the narrator sees their maps for one turn. */
    mentionedSiteRoots: string[]
    /** `[MAPPED_SITES — INTERNAL] …`, rendered. `''` means no books could be read. */
    mappedSitesBlock: string
    /** `[DUNGEON_REALITY — INTERNAL GM CANON] …` for the active and mentioned sites, or `''`. */
    canonBlock: string
    /** When the sync last ran, ISO 8601, and what went wrong if anything. */
    syncedAt: string
    problem?: string
    lastArchitect?: MapArchitectReport
    /** The text opener's private brief for the narrator (46), shown for two replies after the drawing; absent when none is owed. */
    openerBrief?: string
    /** Replies that have ended since the brief was written. */
    openerBriefReplies?: number
    updater: MapUpdaterBookkeeping
    lastUpdater?: MapUpdaterReport
    updaterUndo?: MapUpdaterUndo
    /** What play and evolution changed at each site, keyed by the site's loose label; shared by the updater and evolution as the legacy shares it. */
    threadsBySite: Record<string, unknown[]>
    evolution: MapEvolutionBookkeeping
    lastEvolution?: MapEvolutionReport
    evolutionUndo?: MapEvolutionUndo
    updatedAt: string
}

export function emptyEvolutionBookkeeping(): MapEvolutionBookkeeping {
    return { lastFiredBySite: {}, backlogBySite: {}, reportApplications: {}, lastSiteRoot: '', pendingExitRoot: '', intervalHoursBySite: {} }
}

function readEvolutionBookkeeping(source: unknown): MapEvolutionBookkeeping {
    const record = emptyEvolutionBookkeeping()
    if (!source || typeof source !== 'object') return record
    const e = source as Partial<MapEvolutionBookkeeping>
    const stringMap = (v: unknown): Record<string, string> => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string')) as Record<string, string> : {})
    const listMap = (v: unknown): Record<string, unknown[]> => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => Array.isArray(x))) as Record<string, unknown[]> : {})
    const objectMap = (v: unknown): Record<string, Record<string, unknown>> => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => x && typeof x === 'object' && !Array.isArray(x))) as Record<string, Record<string, unknown>> : {})
    record.lastFiredBySite = stringMap(e.lastFiredBySite)
    record.backlogBySite = listMap(e.backlogBySite)
    record.reportApplications = objectMap(e.reportApplications)
    record.lastSiteRoot = typeof e.lastSiteRoot === 'string' ? e.lastSiteRoot : ''
    record.pendingExitRoot = typeof e.pendingExitRoot === 'string' ? e.pendingExitRoot : ''
    const hoursMap = (v: unknown): Record<string, number> => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'number' && Number.isFinite(x) && x >= 0)) as Record<string, number> : {})
    record.intervalHoursBySite = hoursMap(e.intervalHoursBySite)
    return record
}

export function emptyUpdaterBookkeeping(): MapUpdaterBookkeeping {
    return { tick: 0, watermark: 0, lastSiteRoot: '', pendingExitRoot: '' }
}

export const MAP_VERSION = 1

export function mapPath(chatId: string): string {
    return chatFilePath(chatId, 'map.json')
}

export function emptyMapRecord(): MapRecord {
    return { version: MAP_VERSION, currentLocation: '', sites: [], activeSiteRoot: '', mentionedSiteRoots: [], mappedSitesBlock: '', canonBlock: '', syncedAt: '', updater: emptyUpdaterBookkeeping(), threadsBySite: {}, evolution: emptyEvolutionBookkeeping(), updatedAt: new Date(0).toISOString() }
}

function readRecord(stored: unknown): MapRecord {
    const record = emptyMapRecord()
    if (!stored || typeof stored !== 'object') return record
    const source = stored as Partial<MapRecord>
    for (const key of ['currentLocation', 'activeSiteRoot', 'mappedSitesBlock', 'canonBlock', 'syncedAt', 'problem', 'updatedAt'] as const) {
        if (typeof source[key] === 'string') (record as unknown as Record<string, unknown>)[key] = source[key]
    }
    if (Array.isArray(source.sites)) {
        record.sites = source.sites
            .filter((s): s is MapSiteRecord => !!s && typeof s === 'object' && typeof (s as MapSiteRecord).siteRoot === 'string')
            .map((s) => ({ siteRoot: s.siteRoot, kind: String(s.kind ?? ''), entryId: String(s.entryId ?? '') }))
    }
    if (Array.isArray(source.mentionedSiteRoots)) record.mentionedSiteRoots = source.mentionedSiteRoots.filter((r): r is string => typeof r === 'string')
    if (source.lastArchitect && typeof source.lastArchitect === 'object' && typeof source.lastArchitect.site === 'string') record.lastArchitect = source.lastArchitect
    if (source.updater && typeof source.updater === 'object') {
        const u = source.updater as Partial<MapUpdaterBookkeeping>
        record.updater = {
            tick: Number.isFinite(Number(u.tick)) ? Math.max(0, Math.floor(Number(u.tick))) : 0,
            watermark: Number.isFinite(Number(u.watermark)) ? Math.max(0, Math.floor(Number(u.watermark))) : 0,
            lastSiteRoot: typeof u.lastSiteRoot === 'string' ? u.lastSiteRoot : '',
            pendingExitRoot: typeof u.pendingExitRoot === 'string' ? u.pendingExitRoot : '',
        }
    }
    if (source.lastUpdater && typeof source.lastUpdater === 'object' && typeof source.lastUpdater.site === 'string') record.lastUpdater = source.lastUpdater
    if (source.updaterUndo && typeof source.updaterUndo === 'object' && typeof source.updaterUndo.messageId === 'string' && Array.isArray(source.updaterUndo.restore)) record.updaterUndo = source.updaterUndo
    if (source.threadsBySite && typeof source.threadsBySite === 'object' && !Array.isArray(source.threadsBySite)) {
        record.threadsBySite = Object.fromEntries(Object.entries(source.threadsBySite).filter(([, v]) => Array.isArray(v)))
    }
    record.evolution = readEvolutionBookkeeping(source.evolution)
    if (source.lastEvolution && typeof source.lastEvolution === 'object' && Array.isArray(source.lastEvolution.sites)) record.lastEvolution = source.lastEvolution
    if (source.evolutionUndo && typeof source.evolutionUndo === 'object' && typeof source.evolutionUndo.messageId === 'string' && Array.isArray(source.evolutionUndo.restore)) {
        record.evolutionUndo = { ...source.evolutionUndo, bookkeeping: readEvolutionBookkeeping(source.evolutionUndo.bookkeeping) }
    }
    return record
}

export class MapStore {
    readonly #storage: MemoStorage
    readonly #cache = new Map<string, MapRecord>()
    readonly #loads = new Map<string, Promise<MapRecord>>()
    #writes: Promise<unknown> = Promise.resolve()

    constructor(storage: MemoStorage) {
        this.#storage = storage
    }

    #key(chatId: string, userId?: string): string {
        return `${userId ?? '@self'}::${chatId}`
    }

    /** A chat with no record yet is every chat before its first sync: the empty record, never an error. */
    load(chatId: string, userId?: string): Promise<MapRecord> {
        const key = this.#key(chatId, userId)
        const cached = this.#cache.get(key)
        if (cached) return Promise.resolve(cached)
        const inFlight = this.#loads.get(key)
        if (inFlight) return inFlight
        let path: string
        try {
            path = mapPath(chatId)
        } catch (error) {
            return Promise.reject(error)
        }
        const load = (async (): Promise<MapRecord> => {
            let stored: unknown = null
            try {
                stored = await this.#storage.getJson<unknown>(path, { fallback: null, userId })
            } catch {
                stored = null
            }
            const record = readRecord(stored)
            this.#cache.set(key, record)
            this.#loads.delete(key)
            return record
        })()
        this.#loads.set(key, load)
        return load
    }

    /** What is in memory for a chat, or nothing. For the interceptor only. */
    snapshot(chatId: string, userId?: string): MapRecord | undefined {
        return this.#cache.get(this.#key(chatId, userId))
    }

    async save(chatId: string, patch: Partial<Omit<MapRecord, 'version' | 'updatedAt'>>, userId?: string): Promise<MapRecord> {
        const path = mapPath(chatId)
        const current = await this.load(chatId, userId)
        // `problem: undefined` in a patch clears it: the spread carries the key, and JSON drops it.
        const record: MapRecord = { ...current, ...patch, version: MAP_VERSION, updatedAt: new Date().toISOString() }
        this.#cache.set(this.#key(chatId, userId), record)
        const write = this.#writes
            .catch(() => undefined)
            .then(() => this.#storage.setJson(path, record, { indent: 2, userId }))
        this.#writes = write
        await write
        return record
    }
}
