import { describe, expect, it } from 'vitest'

import type { MemoStorage } from './memo-store.js'
import { emptyMapRecord, mapPath, MapStore } from './map-store.js'

function fakeStorage(seed: Record<string, unknown> = {}) {
    const files = new Map<string, unknown>(Object.entries(seed))
    const storage: MemoStorage & { files: Map<string, unknown> } = {
        files,
        async getJson<T>(path: string, options?: { fallback?: T }): Promise<T> {
            return (files.has(path) ? files.get(path) : options?.fallback) as T
        },
        async setJson(path: string, value: unknown): Promise<void> {
            files.set(path, JSON.parse(JSON.stringify(value)))
        },
    }
    return storage
}

describe('the map store', () => {
    it('starts empty, keeps the file beside the memo, saves a patch over the rest and snapshots from memory', async () => {
        const storage = fakeStorage()
        const store = new MapStore(storage)
        expect(await store.load('chat-1', 'u1')).toEqual(emptyMapRecord())
        expect(mapPath('chat-1')).toBe('chats/chat-1/map.json')
        expect(store.snapshot('chat-1', 'u1')).toEqual(emptyMapRecord())
        expect(store.snapshot('chat-2', 'u1')).toBeUndefined()
        await store.save('chat-1', { currentLocation: 'Morrowfen', mappedSitesBlock: '[MAPPED_SITES — INTERNAL]\n- None.', problem: 'x' }, 'u1')
        const saved = await store.save('chat-1', { activeSiteRoot: 'Morrowfen', problem: undefined }, 'u1')
        expect(saved).toMatchObject({ currentLocation: 'Morrowfen', activeSiteRoot: 'Morrowfen', mappedSitesBlock: '[MAPPED_SITES — INTERNAL]\n- None.' })
        expect(saved.problem).toBeUndefined()
        expect(storage.files.get('chats/chat-1/map.json')).toMatchObject({ version: 1, activeSiteRoot: 'Morrowfen' })
        expect(store.snapshot('chat-1', 'u1')?.activeSiteRoot).toBe('Morrowfen')
    })

    it('reads a stored record back, dropping what it does not understand, and treats an unreadable file as empty', async () => {
        const store = new MapStore(fakeStorage({
            'chats/chat-1/map.json': { version: 1, currentLocation: 'A, B', sites: [{ siteRoot: 'A', kind: 'DUNGEON', entryId: 'B::1' }, 'junk', { kind: 7 }], activeSiteRoot: 'A', mentionedSiteRoots: ['C', 4], mappedSitesBlock: 'm', canonBlock: 'c', syncedAt: 't', problem: 'p', bogus: 1 },
        }))
        const record = await store.load('chat-1')
        expect(record).toMatchObject({ currentLocation: 'A, B', sites: [{ siteRoot: 'A', kind: 'DUNGEON', entryId: 'B::1' }], activeSiteRoot: 'A', mentionedSiteRoots: ['C'], mappedSitesBlock: 'm', canonBlock: 'c', syncedAt: 't', problem: 'p' })
        expect('bogus' in record).toBe(false)
        const withRun = new MapStore(fakeStorage({ 'chats/c/map.json': { version: 1, lastArchitect: { status: 'written', at: 't', site: 'Abbey', areas: 4 } } }))
        expect((await withRun.load('c')).lastArchitect).toEqual({ status: 'written', at: 't', site: 'Abbey', areas: 4 })
        expect((await new MapStore(fakeStorage({ 'chats/c/map.json': { version: 1, lastArchitect: 'junk' } })).load('c')).lastArchitect).toBeUndefined()
        const broken = fakeStorage()
        broken.getJson = async () => { throw new Error('disk on fire') }
        expect(await new MapStore(broken).load('chat-9')).toEqual(emptyMapRecord())
    })

    it('reads the updater\'s bookkeeping, last pass, undo and threads back, and defaults what is missing or malformed (34b)', async () => {
        const undo = { messageId: 'm4', bookId: 'b1', bookName: 'Vell_LOC', restore: [{ id: 'e1', content: 'x' }], created: ['e9'], watermark: 2 }
        const store = new MapStore(fakeStorage({
            'chats/chat-1/map.json': { version: 1, updater: { tick: 3.7, watermark: -1, lastSiteRoot: 'Abbey', pendingExitRoot: 9 }, lastUpdater: { status: 'applied', at: 't', site: 'Abbey', trigger: 'reply', operations: 2 }, updaterUndo: undo, threadsBySite: { abbey: [{ id: 'a' }], junk: 'no' } },
            'chats/chat-2/map.json': { version: 1, updater: 'nonsense', lastUpdater: { status: 'noop' }, updaterUndo: { messageId: 'm' }, threadsBySite: [] },
        }))
        const record = await store.load('chat-1')
        expect(record.updater).toEqual({ tick: 3, watermark: 0, lastSiteRoot: 'Abbey', pendingExitRoot: '' })
        expect(record.lastUpdater).toEqual({ status: 'applied', at: 't', site: 'Abbey', trigger: 'reply', operations: 2 })
        expect(record.updaterUndo).toEqual(undo)
        expect(record.threadsBySite).toEqual({ abbey: [{ id: 'a' }] })
        const other = await store.load('chat-2')
        expect(other.updater).toEqual({ tick: 0, watermark: 0, lastSiteRoot: '', pendingExitRoot: '' })
        expect(other.lastUpdater).toBeUndefined()
        expect(other.updaterUndo).toBeUndefined()
        expect(other.threadsBySite).toEqual({})
        expect(emptyMapRecord().updater).toEqual({ tick: 0, watermark: 0, lastSiteRoot: '', pendingExitRoot: '' })
    })

    it('reads evolution\'s clocks, ledgers, last pass and undo back, and defaults what is missing or malformed (34c)', async () => {
        const bookkeeping = { lastFiredBySite: { abbey: 'Day 4', bad: 7 }, backlogBySite: { abbey: [{ kind: 'quiet' }], bad: 'x' }, reportApplications: { abbey: { 'W::1': { status: 'considered' } }, bad: [] }, lastSiteRoot: 'Abbey', pendingExitRoot: 9, intervalHoursBySite: { abbey: 6, never: 0, bad: 'x', neg: -2 } }
        const store = new MapStore(fakeStorage({
            'chats/chat-1/map.json': { version: 1, evolution: bookkeeping, lastEvolution: { status: 'applied', at: 't', trigger: 'interval', sites: [{ siteRoot: 'Abbey', status: 'applied' }] }, evolutionUndo: { messageId: 'm4', restore: [{ id: 'e1', content: 'x' }], created: [], bookkeeping: { lastFiredBySite: { abbey: 'Day 3' } }, threadsBySite: {} } },
            'chats/chat-2/map.json': { version: 1, evolution: 'nonsense', lastEvolution: { status: 'noop' }, evolutionUndo: { messageId: 'm' } },
        }))
        const record = await store.load('chat-1')
        // The per-site hours (71d) read back as numbers of 0 or more; anything else is dropped.
        expect(record.evolution).toEqual({ lastFiredBySite: { abbey: 'Day 4' }, backlogBySite: { abbey: [{ kind: 'quiet' }] }, reportApplications: { abbey: { 'W::1': { status: 'considered' } } }, lastSiteRoot: 'Abbey', pendingExitRoot: '', intervalHoursBySite: { abbey: 6, never: 0 } })
        expect(record.lastEvolution?.sites).toEqual([{ siteRoot: 'Abbey', status: 'applied' }])
        expect(record.evolutionUndo).toEqual({ messageId: 'm4', restore: [{ id: 'e1', content: 'x' }], created: [], bookkeeping: { lastFiredBySite: { abbey: 'Day 3' }, backlogBySite: {}, reportApplications: {}, lastSiteRoot: '', pendingExitRoot: '', intervalHoursBySite: {} }, threadsBySite: {} })
        const other = await store.load('chat-2')
        expect(other.evolution).toEqual({ lastFiredBySite: {}, backlogBySite: {}, reportApplications: {}, lastSiteRoot: '', pendingExitRoot: '', intervalHoursBySite: {} })
        expect(other.lastEvolution).toBeUndefined()
        expect(other.evolutionUndo).toBeUndefined()
        expect(emptyMapRecord().evolution).toEqual({ lastFiredBySite: {}, backlogBySite: {}, reportApplications: {}, lastSiteRoot: '', pendingExitRoot: '', intervalHoursBySite: {} })
    })
})
