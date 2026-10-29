import { describe, expect, it } from 'vitest'

import type { MemoStorage } from './memo-store.js'
import { emptyWorldRecord, WorldStore, worldPath } from './world-store.js'

function fakeStorage(seed: Record<string, unknown> = {}) {
    const files = new Map<string, unknown>(Object.entries(seed))
    const storage: MemoStorage & { files: Map<string, unknown>; failReads: boolean } = {
        files,
        failReads: false,
        async getJson<T>(path: string, options?: { fallback?: T }): Promise<T> {
            if (storage.failReads) throw new Error('disk on fire')
            return (files.has(path) ? files.get(path) : options?.fallback) as T
        },
        async setJson(path: string, value: unknown): Promise<void> {
            files.set(path, JSON.parse(JSON.stringify(value)))
        },
    }
    return storage
}

describe('the world store', () => {
    it('starts empty for a chat with no record, and keeps the file beside the memo', async () => {
        const store = new WorldStore(fakeStorage())
        expect(await store.load('chat-1')).toEqual(emptyWorldRecord())
        expect(worldPath('chat-1')).toBe('chats/chat-1/world.json')
        expect(() => worldPath('../x')).toThrow()
    })

    it('saves a patch over the rest, writes it to disk, and snapshots from memory', async () => {
        const storage = fakeStorage()
        const store = new WorldStore(storage)
        expect(store.snapshot('chat-1')).toBeUndefined()
        await store.save('chat-1', { lastFiredPeriodLabel: 'Day 2, 08:00 AM' })
        await store.save('chat-1', { activeReports: [{ id: 'e1', reportId: 'W::1', label: 'Day 2', content: 'calm' }] })
        const record = store.snapshot('chat-1')!
        expect(record.lastFiredPeriodLabel).toBe('Day 2, 08:00 AM')
        expect(record.activeReports).toHaveLength(1)
        expect(storage.files.get('chats/chat-1/world.json')).toMatchObject({ version: 1, lastFiredPeriodLabel: 'Day 2, 08:00 AM' })
    })

    it('reads a stored record back, dropping what it does not understand', async () => {
        const store = new WorldStore(fakeStorage({
            'chats/chat-1/world.json': {
                version: 1,
                lastFiredPeriodLabel: 'Day 3',
                locationLastAdvanced: { morrowfen: 'Day 3', bad: 7 },
                activeReports: [{ id: 'e', reportId: 'r', label: 'L', content: 'c' }, 'junk', { label: 'no content' }],
                lastRun: { status: 'written', at: 't', trigger: 'manual' },
                skeletonSource: 'A drowned coast.',
                lastSkeleton: { status: 'written', at: 't', mode: 'append', count: 2 },
            },
        }))
        const record = await store.load('chat-1')
        expect(record.lastFiredPeriodLabel).toBe('Day 3')
        expect(record.locationLastAdvanced).toEqual({ morrowfen: 'Day 3' })
        expect(record.activeReports).toEqual([{ id: 'e', reportId: 'r', label: 'L', content: 'c' }])
        expect(record.lastRun?.status).toBe('written')
        expect(record.skeletonSource).toBe('A drowned coast.')
        expect(record.lastSkeleton).toEqual({ status: 'written', at: 't', mode: 'append', count: 2 })
        // A record from before the skeleton (33b) reads back with an empty source and no last generation.
        const older = new WorldStore(fakeStorage({ 'chats/chat-2/world.json': { version: 1, lastFiredPeriodLabel: 'Day 1', skeletonSource: 7, lastSkeleton: 'junk' } }))
        expect(await older.load('chat-2')).toMatchObject({ lastFiredPeriodLabel: 'Day 1', skeletonSource: '' })
        expect((await older.load('chat-2')).lastSkeleton).toBeUndefined()
    })

    it('treats an unreadable file as empty and keeps users apart', async () => {
        const storage = fakeStorage()
        storage.failReads = true
        const store = new WorldStore(storage)
        expect((await store.load('chat-1', 'u1')).activeReports).toEqual([])
        storage.failReads = false
        await store.save('chat-1', { lastFiredPeriodLabel: 'Day 1' }, 'u1')
        expect(store.snapshot('chat-1', 'u2')).toBeUndefined()
        expect(store.snapshot('chat-1', 'u1')?.lastFiredPeriodLabel).toBe('Day 1')
    })
})
