import { describe, expect, it } from 'vitest'

import type { AgentRunResult } from '../protocol.js'
import type { TrackerPassReport } from './memo-store.js'
import { foldReport, MAX_REPORTS, ReportHistoryStore, reportHistoryPath } from './report-history.js'

function fakeStorage(seed: Record<string, unknown> = {}) {
    const files = new Map<string, unknown>(Object.entries(seed))
    const writes: string[] = []
    return {
        files,
        writes,
        storage: {
            async getJson<T>(path: string, options?: { fallback?: T }): Promise<T> {
                return (files.has(path) ? files.get(path) : options?.fallback) as T
            },
            async setJson(path: string, value: unknown): Promise<void> {
                files.set(path, JSON.parse(JSON.stringify(value)))
                writes.push(path)
            },
        },
    }
}

const pass = (at: string, status: TrackerPassReport['status'] = 'updated'): TrackerPassReport => ({ status, at, replaced: ['PARTY'] })
const run = (at: string, outcome: AgentRunResult['outcome'] = 'committed'): AgentRunResult => ({ at, outcome, summary: `ran at ${at}`, steps: [], turnsUsed: 1, problems: [] })

describe('the report history (47e)', () => {
    it('is empty for a chat with none, and for an unreadable file', async () => {
        const { storage } = fakeStorage({ [reportHistoryPath('bad')]: 'nonsense' })
        const store = new ReportHistoryStore(storage)
        expect(await store.load('fresh')).toMatchObject({ tracker: [], agent: [] })
        expect(await store.load('bad')).toMatchObject({ tracker: [], agent: [] })
    })

    it('keeps tracker and agent reports newest first, each in its own list', async () => {
        const { storage, files } = fakeStorage()
        const store = new ReportHistoryStore(storage)
        await store.recordTracker('c1', pass('2026-10-10T20:00:00Z'))
        await store.recordTracker('c1', pass('2026-10-10T20:05:00Z', 'no-change'))
        await store.recordAgent('c1', run('2026-10-10T20:03:00Z'))
        const record = await store.load('c1')
        expect(record.tracker.map((r) => r.at)).toEqual(['2026-10-10T20:05:00Z', '2026-10-10T20:00:00Z'])
        expect(record.agent.map((r) => r.at)).toEqual(['2026-10-10T20:03:00Z'])
        // Written, not only cached: a fresh store over the same storage reads it back.
        expect((await new ReportHistoryStore(storage).load('c1')).tracker.length).toBe(2)
        expect(files.has(reportHistoryPath('c1'))).toBe(true)
    })

    it('does not write the same report twice', async () => {
        const { storage, writes } = fakeStorage()
        const store = new ReportHistoryStore(storage)
        await store.recordAgent('c1', run('2026-10-10T20:03:00Z'))
        await store.recordAgent('c1', run('2026-10-10T20:03:00Z'))
        expect(writes.length).toBe(1)
        expect((await store.load('c1')).agent.length).toBe(1)
    })

    it('keeps two different reports that share a millisecond, and only the identical one once', () => {
        // Two passes finished in one millisecond on CI (2026-10-10) and the second was dropped as a repeat.
        const same = '2026-10-10T20:00:00.000Z'
        let list = foldReport([], pass(same, 'updated'))
        list = foldReport(list, pass(same, 'no-change'))
        list = foldReport(list, pass(same, 'no-change'))
        expect(list.map((r) => r.status)).toEqual(['no-change', 'updated'])
    })

    it('caps each list at the window and drops the oldest', () => {
        let list: TrackerPassReport[] = []
        for (let i = 0; i < MAX_REPORTS + 5; i += 1) list = foldReport(list, pass(`2026-10-10T20:${String(i).padStart(2, '0')}:00Z`))
        expect(list.length).toBe(MAX_REPORTS)
        expect(list[0].at).toBe(`2026-10-10T20:${MAX_REPORTS + 4}:00Z`)
        expect(list[list.length - 1].at).toBe('2026-10-10T20:05:00Z')
    })

    it('drops a stored entry that is not a report, and keeps the rest', async () => {
        const { storage } = fakeStorage({ [reportHistoryPath('c1')]: { version: 1, tracker: [pass('2026-10-10T20:00:00Z'), 7, { status: 'updated' }], agent: 'none', updatedAt: 't' } })
        const record = await new ReportHistoryStore(storage).load('c1')
        expect(record.tracker.length).toBe(1)
        expect(record.agent).toEqual([])
    })

    it('clears a chat, and forgets its cache so the next read is the file', async () => {
        const { storage, files } = fakeStorage()
        const store = new ReportHistoryStore(storage)
        await store.recordTracker('c1', pass('2026-10-10T20:00:00Z'))
        await store.clear('c1')
        expect((await store.load('c1')).tracker).toEqual([])
        files.set(reportHistoryPath('c1'), { version: 1, tracker: [pass('2026-10-10T21:00:00Z')], agent: [], updatedAt: 't' })
        store.forget('c1')
        expect((await store.load('c1')).tracker.length).toBe(1)
    })

    it('rejects an unsafe chat id rather than reading the wrong file', async () => {
        const store = new ReportHistoryStore(fakeStorage().storage)
        await expect(store.load('../x')).rejects.toThrow()
    })
})
