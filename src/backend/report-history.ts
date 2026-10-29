/**
 * The last thirty reports of the tracker and of the Lorebook Agent, per
 * chat (47e).
 *
 * The memo record keeps one tracker report, the last, and the agent's
 * result lived only in the panel's memory until this existed: a report
 * from three turns ago could not be read back, and the maintainer asked
 * for it on 2026-10-06 while reading what the agent had done to a profile.
 * This keeps a short ring of each, newest first, in its own file beside
 * the memo history, written as each pass finishes and read when the panel
 * asks. The tracker's is the same `TrackerPassReport` the memo record
 * carries; the agent's is the `AgentRunResult` the panel is sent.
 *
 * A window, not an archive, for the memo history's reason: it is read
 * whole when the chat opens. Thirty of each is a session's worth.
 */

import type { AgentRunResult } from '../protocol.js'
import { chatFilePath, type TrackerPassReport } from './memo-store.js'

export interface ReportHistoryStorage {
    getJson<T>(path: string, options?: { fallback?: T; userId?: string }): Promise<T>
    setJson(path: string, value: unknown, options?: { indent?: number; userId?: string }): Promise<void>
}

export interface ReportHistoryRecord {
    version: 1
    /** Newest first, so the cap drops the oldest. */
    tracker: TrackerPassReport[]
    agent: AgentRunResult[]
    updatedAt: string
}

export const REPORT_HISTORY_VERSION = 1
export const MAX_REPORTS = 30

export function reportHistoryPath(chatId: string): string {
    return chatFilePath(chatId, 'report-history.json')
}

export function emptyReportHistory(): ReportHistoryRecord {
    return { version: REPORT_HISTORY_VERSION, tracker: [], agent: [], updatedAt: new Date(0).toISOString() }
}

/** A stored report is kept when it is an object with a string `at`; anything else is dropped on read. */
function readReports<T extends { at: string }>(value: unknown): T[] {
    if (!Array.isArray(value)) return []
    return value.filter((entry): entry is T => !!entry && typeof entry === 'object' && typeof (entry as { at?: unknown }).at === 'string')
}

/** The same report: the same moment and the same content. A moment alone is not an identity (lesson 57). */
export function sameReport(a: { at: string }, b: { at: string }): boolean {
    return a.at === b.at && JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Put a report at the front, unless the front already holds it, and keep
 * the cap. The same list back when nothing changed, so a caller can skip
 * the write. Two passes can finish in one millisecond on a fast machine
 * (CI did, 2026-10-10), so the test of sameness is the whole report, not
 * its stamp.
 */
export function foldReport<T extends { at: string }>(existing: T[], report: T): T[] {
    if (existing[0] && sameReport(existing[0], report)) return existing
    return [report, ...existing.filter((entry) => !sameReport(entry, report))].slice(0, MAX_REPORTS)
}

export class ReportHistoryStore {
    readonly #storage: ReportHistoryStorage
    readonly #cache = new Map<string, ReportHistoryRecord>()
    readonly #loads = new Map<string, Promise<ReportHistoryRecord>>()
    #writes: Promise<unknown> = Promise.resolve()

    constructor(storage: ReportHistoryStorage) {
        this.#storage = storage
    }

    #key(chatId: string, userId?: string): string {
        return `${userId ?? '@self'}::${chatId}`
    }

    /** Read a chat's reports; a chat with none, or an unreadable file, is an empty record. */
    load(chatId: string, userId?: string): Promise<ReportHistoryRecord> {
        const key = this.#key(chatId, userId)
        const cached = this.#cache.get(key)
        if (cached) return Promise.resolve(cached)
        const inFlight = this.#loads.get(key)
        if (inFlight) return inFlight

        let path: string
        try {
            path = reportHistoryPath(chatId)
        } catch (error) {
            return Promise.reject(error)
        }

        const load = (async (): Promise<ReportHistoryRecord> => {
            let stored: Partial<ReportHistoryRecord> | null = null
            try {
                stored = await this.#storage.getJson<ReportHistoryRecord | null>(path, { fallback: null, userId })
            } catch {
                stored = null
            }
            const record: ReportHistoryRecord = {
                version: REPORT_HISTORY_VERSION,
                tracker: readReports<TrackerPassReport>(stored?.tracker).slice(0, MAX_REPORTS),
                agent: readReports<AgentRunResult>(stored?.agent).slice(0, MAX_REPORTS),
                updatedAt: typeof stored?.updatedAt === 'string' ? stored.updatedAt : new Date(0).toISOString(),
            }
            this.#cache.set(key, record)
            this.#loads.delete(key)
            return record
        })()
        this.#loads.set(key, load)
        return load
    }

    /** Keep what a tracker pass did. */
    async recordTracker(chatId: string, report: TrackerPassReport, userId?: string): Promise<ReportHistoryRecord> {
        const current = await this.load(chatId, userId)
        const tracker = foldReport(current.tracker, report)
        if (tracker === current.tracker) return current
        return this.#write(chatId, { ...current, tracker }, userId)
    }

    /** Keep what an agent pass did. */
    async recordAgent(chatId: string, result: AgentRunResult, userId?: string): Promise<ReportHistoryRecord> {
        const current = await this.load(chatId, userId)
        const agent = foldReport(current.agent, result)
        if (agent === current.agent) return current
        return this.#write(chatId, { ...current, agent }, userId)
    }

    /** Forget a chat's reports entirely. */
    clear(chatId: string, userId?: string): Promise<ReportHistoryRecord> {
        return this.#write(chatId, emptyReportHistory(), userId)
    }

    #write(chatId: string, next: ReportHistoryRecord, userId?: string): Promise<ReportHistoryRecord> {
        let path: string
        try {
            path = reportHistoryPath(chatId)
        } catch (error) {
            return Promise.reject(error)
        }
        const record: ReportHistoryRecord = { ...next, version: REPORT_HISTORY_VERSION, updatedAt: new Date().toISOString() }
        this.#cache.set(this.#key(chatId, userId), record)
        const write = this.#writes
            .catch(() => undefined)
            .then(() => this.#storage.setJson(path, record, { indent: 2, userId }))
        this.#writes = write
        return write.then(() => record)
    }

    /** Drop a chat's cached reports, so the next read comes from storage. */
    forget(chatId: string, userId?: string): void {
        this.#cache.delete(this.#key(chatId, userId))
    }
}
