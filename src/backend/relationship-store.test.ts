import { describe, expect, it, vi } from 'vitest'

import {
    RELATIONSHIP_LOG_CAP,
    RelationshipStore,
    readRelationshipRecord,
    relationshipPath,
    type RelationshipStorage,
} from './relationship-store.js'

/** Keyed by user as well as path, because `spindle.userStorage` is. */
function fakeStorage(seed: Record<string, unknown> = {}) {
    const files = new Map<string, unknown>(Object.entries(seed))
    const at = (path: string, userId?: string): string => `${userId ?? '@self'}:${path}`
    const storage: RelationshipStorage = {
        async getJson<T>(path: string, options?: { fallback?: T; userId?: string }): Promise<T> {
            const key = at(path, options?.userId)
            return (files.has(key) ? files.get(key) : options?.fallback) as T
        },
        async setJson(path: string, value: unknown, options?: { userId?: string }): Promise<void> {
            files.set(at(path, options?.userId), JSON.parse(JSON.stringify(value)))
        },
    }
    return { storage, files }
}

const MAX = 150

describe('where the values live', () => {
    it('sits with the chat, beside the memo and the portraits', () => {
        expect(relationshipPath('c1')).toBe('chats/c1/relationships.json')
        expect(() => relationshipPath('../x')).toThrow(/unsafe chat id/)
    })

    it('reads a stored file defensively', () => {
        expect(readRelationshipRecord(null).npcs).toEqual({})
        expect(readRelationshipRecord({ npcs: { 'B::1': { label: ' Marcus ', friendship: '12.4', affection: null, log: [{ field: 'friendship' }, { field: 'nonsense' }, 'x'] } } }).npcs).toEqual({
            'B::1': { label: 'Marcus', friendship: 12, affection: 0, log: [{ field: 'friendship' }] },
        })
        // A label missing falls back to the address, never to an empty string.
        expect(readRelationshipRecord({ npcs: { 'B::2': {} } }).npcs['B::2']!.label).toBe('B::2')
    })
})

describe('applying awards', () => {
    it('clamps to the scale, logs what was asked and what got through, newest first, and announces the write', async () => {
        const { storage, files } = fakeStorage()
        const changes: string[] = []
        const store = new RelationshipStore(storage, { onChange: (chatId, record, userId) => { changes.push(`${chatId}/${userId}/${Object.keys(record.npcs).join(',')}`) } })
        const first = await store.apply('c1', [{ id: 'B::1', label: 'Marcus', field: 'friendship', delta: 140, source: 'tracker', messageId: 'm1' }], MAX, {}, 'u1')
        expect(first.applied[0]).toMatchObject({ applied: 140, newValue: 140 })
        const second = await store.apply('c1', [{ id: 'B::1', label: 'Marcus', field: 'friendship', delta: 25, source: 'narrative', messageId: 'm2' }], MAX, {}, 'u1')
        expect(second.applied[0]).toMatchObject({ applied: 10, newValue: 150, delta: 25 })
        const record = (await store.load('c1', 'u1')).npcs['B::1']!
        expect(record.friendship).toBe(150)
        expect(record.log.map((e) => [e.delta, e.applied, e.newValue, e.source, e.messageId])).toEqual([[25, 10, 150, 'narrative', 'm2'], [140, 140, 140, 'tracker', 'm1']])
        expect(changes).toEqual(['c1/u1/B::1', 'c1/u1/B::1'])
        expect(files.has('u1:chats/c1/relationships.json')).toBe(true)
        // Nothing to do, nothing written.
        const none = await store.apply('c1', [], MAX, {}, 'u1')
        expect(none).toEqual({ applied: [], reverted: 0 })
        expect(changes).toHaveLength(2)
    })

    it('puts a whole set of standings in a chat’s place (56), read back as written', async () => {
        const { storage } = fakeStorage()
        const store = new RelationshipStore(storage)
        await store.apply('c2', [{ id: 'B::1', label: 'Marcus', field: 'friendship', delta: 5, source: 'agent' }], MAX)
        const npcs = (await store.load('c2')).npcs
        const record = await store.replace('c3', npcs)
        expect(record.npcs).toEqual(npcs)
        expect((await new RelationshipStore(storage).load('c3')).npcs).toEqual(npcs)
    })

    it('keeps the log fifty deep per NPC', async () => {
        const store = new RelationshipStore(fakeStorage().storage)
        for (let i = 0; i < RELATIONSHIP_LOG_CAP + 5; i++) {
            await store.apply('c1', [{ id: 'B::1', label: 'Marcus', field: 'affection', delta: i % 2 ? 1 : -1, source: 'agent' }], MAX)
        }
        expect((await store.load('c1')).npcs['B::1']!.log).toHaveLength(RELATIONSHIP_LOG_CAP)
    })

    it('puts back what the replaced message awarded on a retrack, unless the value was moved by hand since', async () => {
        const store = new RelationshipStore(fakeStorage().storage)
        await store.apply('c1', [
            { id: 'B::1', label: 'Marcus', field: 'friendship', delta: 10, source: 'tracker', messageId: 'm1' },
            { id: 'B::2', label: 'Elena', field: 'affection', delta: -5, source: 'tracker', messageId: 'm1' },
        ], MAX)
        // Elena's value was moved by hand after the pass: the legacy's guard leaves it.
        await store.set('c1', 'B::2', 'Elena', 'affection', 20, MAX)
        const result = await store.apply('c1', [{ id: 'B::1', label: 'Marcus', field: 'friendship', delta: 3, source: 'tracker', messageId: 'm1' }], MAX, { retrackMessageId: 'm1' })
        expect(result.reverted).toBe(1)
        const npcs = (await store.load('c1')).npcs
        expect(npcs['B::1']!.friendship).toBe(3)
        expect(npcs['B::2']!.affection).toBe(20)
        // The replaced entries are gone from the log; the new award and the manual set remain.
        expect(npcs['B::1']!.log.map((e) => e.messageId)).toEqual(['m1'])
        expect(npcs['B::1']!.log[0]!.delta).toBe(3)
        expect(npcs['B::2']!.log.map((e) => e.source)).toEqual(['manual'])
        // A retrack with nothing new still writes the revert.
        const again = await store.apply('c1', [], MAX, { retrackMessageId: 'm1' })
        expect(again.reverted).toBe(1)
        expect((await store.load('c1')).npcs['B::1']!.friendship).toBe(0)
    })

    it('sets by hand, removes, and keeps the snapshot current for the injection', async () => {
        const { storage } = fakeStorage()
        const store = new RelationshipStore(storage)
        expect(store.snapshot('c1')).toBeUndefined()
        await store.set('c1', 'B::1', 'Marcus', 'friendship', 999, MAX)
        expect(store.snapshot('c1')!.npcs['B::1']).toMatchObject({ friendship: 150, label: 'Marcus' })
        expect(store.snapshot('c1')!.npcs['B::1']!.log[0]).toMatchObject({ source: 'manual', delta: 150, newValue: 150 })
        // Clear Log (80): the history goes, the values stand; nothing is written for an NPC with no history.
        await store.set('c1', 'B::1', 'Marcus', 'affection', -20, MAX)
        expect(store.snapshot('c1')!.npcs['B::1']!.log).toHaveLength(2)
        const cleared = await store.clearLog('c1', 'B::1')
        expect(cleared.npcs['B::1']).toEqual({ label: 'Marcus', friendship: 150, affection: -20, log: [] })
        expect(store.snapshot('c1')!.npcs['B::1']!.log).toEqual([])
        const before = store.snapshot('c1')
        expect(await store.clearLog('c1', 'B::1')).toBe(before)
        expect(await store.clearLog('c1', 'B::9')).toBe(before)
        await store.remove('c1', 'B::1')
        expect(store.snapshot('c1')!.npcs).toEqual({})
        // A second store over the same storage reads what the first wrote.
        const other = new RelationshipStore(storage)
        expect((await other.load('c1')).npcs).toEqual({})
    })

    it('loads once for concurrent readers and keeps users apart', async () => {
        const { storage } = fakeStorage({ 'u2:chats/c1/relationships.json': { npcs: { 'B::9': { label: 'Theirs', friendship: 7, affection: 0, log: [] } } } })
        const getJson = vi.spyOn(storage, 'getJson')
        const store = new RelationshipStore(storage)
        const [a, b] = await Promise.all([store.load('c1', 'u1'), store.load('c1', 'u1')])
        expect(a).toBe(b)
        expect(getJson).toHaveBeenCalledTimes(1)
        expect((await store.load('c1', 'u2')).npcs['B::9']!.friendship).toBe(7)
        expect((await store.load('c1', 'u1')).npcs).toEqual({})
    })
})
