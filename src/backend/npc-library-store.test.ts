import { describe, expect, it } from 'vitest'

import { createRecord } from '../tracker/npc-library.js'
import { NPC_LIBRARY_PATH, NpcLibraryStore, readLibraryFile, type NpcLibraryStorage } from './npc-library-store.js'

class FakeStorage implements NpcLibraryStorage {
    files = new Map<string, unknown>()
    writes = 0
    failRead = false
    async getJson<T>(path: string, options?: { fallback?: T; userId?: string }): Promise<T> {
        if (this.failRead) throw new Error('disk gone')
        const key = `${options?.userId ?? ''}:${path}`
        return (this.files.has(key) ? this.files.get(key) : options?.fallback) as T
    }
    async setJson(path: string, value: unknown, options?: { indent?: number; userId?: string }): Promise<void> {
        this.writes += 1
        this.files.set(`${options?.userId ?? ''}:${path}`, JSON.parse(JSON.stringify(value)))
    }
}

const kestrel = () => createRecord({ id: 'k1', name: 'Kestrel', content: '[CORE]\nSpecies: Human\nFriendship/Rapport: 1/10\n[/CORE]\nChronicle', keys: ['Kes'] })

describe('readLibraryFile', () => {
    it('reads records, dropping ones without an id or a name, and reduces each to its identity', () => {
        const records = readLibraryFile({ version: 1, records: [kestrel(), { id: '', name: 'x' }, { id: 'y', name: '' }, 'junk', { id: 'o', name: 'Orrin', content: '[CORE]\nSmith\nAffection/Interest: 1\n[/CORE]\nLater', keys: 'no', createdAt: 'x' }] })
        expect(records.map((r) => r.id)).toEqual(['k1', 'o'])
        expect(records[1]).toEqual({ id: 'o', name: 'Orrin', keys: ['Orrin'], content: '[CORE]\nSmith\n\n[/CORE]', portraitPath: '', notes: '', createdAt: 0, updatedAt: 0 })
    })

    it('is empty for nothing, or for a file of another shape', () => {
        expect(readLibraryFile(null)).toEqual([])
        expect(readLibraryFile({ records: 'x' })).toEqual([])
        expect(readLibraryFile([])).toEqual([])
    })
})

describe('NpcLibraryStore', () => {
    it('is empty on a first run and writes nothing until asked', async () => {
        const storage = new FakeStorage()
        const store = new NpcLibraryStore(storage)
        expect(await store.load('u1')).toEqual([])
        expect(storage.writes).toBe(0)
    })

    it('saves and reloads per user, as copies', async () => {
        const storage = new FakeStorage()
        const store = new NpcLibraryStore(storage)
        const saved = await store.save([kestrel()], 'u1')
        saved[0]!.keys.push('mutated')
        expect((await store.load('u1'))[0]!.keys).toEqual(['Kestrel', 'Kes'])
        expect(await store.load('u2')).toEqual([])
        const fresh = new NpcLibraryStore(storage)
        expect((await fresh.load('u1')).map((r) => r.name)).toEqual(['Kestrel'])
        expect((storage.files.get(`u1:${NPC_LIBRARY_PATH}`) as { version: number }).version).toBe(1)
    })

    it('hands out copies from its cache too', async () => {
        const store = new NpcLibraryStore(new FakeStorage())
        await store.save([kestrel()], 'u1')
        const loaded = await store.load('u1')
        loaded[0]!.keys.push('mutated')
        loaded.pop()
        expect((await store.load('u1'))[0]!.keys).toEqual(['Kestrel', 'Kes'])
        expect(await store.load('u1')).toHaveLength(1)
    })

    it('reads an unreadable file as an empty library', async () => {
        const storage = new FakeStorage()
        storage.failRead = true
        expect(await new NpcLibraryStore(storage).load('u1')).toEqual([])
    })

    it('queues writes so the last one wins', async () => {
        const storage = new FakeStorage()
        const store = new NpcLibraryStore(storage)
        await Promise.all([store.save([kestrel()], 'u1'), store.save([], 'u1'), store.save([kestrel(), { ...kestrel(), id: 'k2', name: 'Kestrel (2)' }], 'u1')])
        expect((await store.load('u1')).map((r) => r.id)).toEqual(['k1', 'k2'])
        expect(storage.writes).toBe(3)
    })
})
