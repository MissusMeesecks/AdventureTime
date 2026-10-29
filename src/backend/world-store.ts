/**
 * What World Progression remembers per chat.
 *
 * The clock it last fired at, which locations it has advanced and when, the
 * reports the narrator is currently shown, and what the last pass did. The
 * reports themselves live in the campaign's `_World` lorebook, the archive;
 * this is the window onto it, kept in memory so the interceptor can inject
 * without a host round trip (the memo's rule, for the memo's reason).
 *
 * The legacy keeps the same four things in its settings and mirrors them into
 * chat state; here they are one record per chat from the start.
 */

import { chatFilePath, type MemoStorage } from './memo-store.js'

/** One report as the narrator sees it: where it is, what it is called, what it says. */
export interface WorldReportRef {
    /** The host's entry id. */
    id: string
    /** `book::uid`, the legacy's report id. */
    reportId: string
    label: string
    content: string
}

export interface WorldRunReport {
    status: 'written' | 'duplicate' | 'skipped' | 'failed' | 'cancelled'
    /** When it finished, ISO 8601. */
    at: string
    trigger: 'automatic' | 'manual'
    periodLabel?: string
    selectedLocations?: string[]
    /** The range entry a consolidation wrote before this report, when one did. */
    consolidated?: string
    /** Why, when nothing was written. */
    reason?: string
}

/** What one World Skeleton generation did (33b). */
export interface WorldSkeletonReport {
    status: 'written' | 'failed' | 'cancelled' | 'skipped'
    /** When it finished, ISO 8601. */
    at: string
    /** `replace` wrote a fresh skeleton; `append` added to the one there. */
    mode: 'replace' | 'append'
    /** Entries written this run. */
    count?: number
    factions?: number
    locations?: number
    conflicts?: number
    /** Why, when nothing was written. */
    reason?: string
}

export interface WorldRecord {
    version: 1
    /** The label of the last period reported on; `''` before the clock has started. */
    lastFiredPeriodLabel: string
    /** Per-location watermark: the period each was last advanced in, by normalised name. */
    locationLastAdvanced: Record<string, string>
    /** The rolling window: the newest reports, as shown to the narrator. */
    activeReports: WorldReportRef[]
    lastRun?: WorldRunReport
    /** The user's written description of the world, the skeleton's source (33b). Kept per chat, as the legacy keeps it. */
    skeletonSource: string
    lastSkeleton?: WorldSkeletonReport
    updatedAt: string
}

export const WORLD_VERSION = 1

export function worldPath(chatId: string): string {
    return chatFilePath(chatId, 'world.json')
}

export function emptyWorldRecord(): WorldRecord {
    return { version: WORLD_VERSION, lastFiredPeriodLabel: '', locationLastAdvanced: {}, activeReports: [], skeletonSource: '', updatedAt: new Date(0).toISOString() }
}

function readRecord(stored: unknown): WorldRecord {
    const record = emptyWorldRecord()
    if (!stored || typeof stored !== 'object') return record
    const source = stored as Partial<WorldRecord>
    if (typeof source.lastFiredPeriodLabel === 'string') record.lastFiredPeriodLabel = source.lastFiredPeriodLabel
    if (source.locationLastAdvanced && typeof source.locationLastAdvanced === 'object') {
        for (const [key, value] of Object.entries(source.locationLastAdvanced)) {
            if (typeof value === 'string') record.locationLastAdvanced[key] = value
        }
    }
    if (Array.isArray(source.activeReports)) {
        record.activeReports = source.activeReports
            .filter((r): r is WorldReportRef => !!r && typeof r === 'object' && typeof (r as WorldReportRef).content === 'string')
            .map((r) => ({ id: String(r.id ?? ''), reportId: String(r.reportId ?? ''), label: String(r.label ?? ''), content: r.content }))
    }
    if (source.lastRun && typeof source.lastRun === 'object') record.lastRun = source.lastRun
    if (typeof source.skeletonSource === 'string') record.skeletonSource = source.skeletonSource
    if (source.lastSkeleton && typeof source.lastSkeleton === 'object') record.lastSkeleton = source.lastSkeleton
    if (typeof source.updatedAt === 'string') record.updatedAt = source.updatedAt
    return record
}

export class WorldStore {
    readonly #storage: MemoStorage
    readonly #cache = new Map<string, WorldRecord>()
    readonly #loads = new Map<string, Promise<WorldRecord>>()
    #writes: Promise<unknown> = Promise.resolve()

    constructor(storage: MemoStorage) {
        this.#storage = storage
    }

    #key(chatId: string, userId?: string): string {
        return `${userId ?? '@self'}::${chatId}`
    }

    /** A chat with no record yet is every chat before its first report: the empty record, never an error. */
    load(chatId: string, userId?: string): Promise<WorldRecord> {
        const key = this.#key(chatId, userId)
        const cached = this.#cache.get(key)
        if (cached) return Promise.resolve(cached)
        const inFlight = this.#loads.get(key)
        if (inFlight) return inFlight

        let path: string
        try {
            path = worldPath(chatId)
        } catch (error) {
            return Promise.reject(error)
        }
        const load = (async (): Promise<WorldRecord> => {
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
    snapshot(chatId: string, userId?: string): WorldRecord | undefined {
        return this.#cache.get(this.#key(chatId, userId))
    }

    /** Replace some of a chat's record and keep the rest. Writes are chained across chats, as the memo's are. */
    async save(chatId: string, patch: Partial<Omit<WorldRecord, 'version' | 'updatedAt'>>, userId?: string): Promise<WorldRecord> {
        const path = worldPath(chatId)
        const current = await this.load(chatId, userId)
        const record: WorldRecord = { ...current, ...patch, version: WORLD_VERSION, updatedAt: new Date().toISOString() }
        this.#cache.set(this.#key(chatId, userId), record)
        const write = this.#writes
            .catch(() => undefined)
            .then(() => this.#storage.setJson(path, record, { indent: 2, userId }))
        this.#writes = write
        await write
        return record
    }
}
