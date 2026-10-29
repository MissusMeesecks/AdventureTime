import { describe, expect, it, vi } from 'vitest'

import {
    MAX_PORTRAITS,
    PortraitStore,
    portraitPath,
    readPortraits,
    type PortraitStorage,
} from './portrait-store.js'

/** Keyed by user as well as path, because `spindle.userStorage` is. */
function fakeStorage(seed: Record<string, unknown> = {}) {
    const files = new Map<string, unknown>(Object.entries(seed))
    const at = (path: string, userId?: string): string => `${userId ?? '@self'}:${path}`

    const storage: PortraitStorage = {
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

describe('where portraits live', () => {
    it('sits with the chat, not with the install', () => {
        // Two campaigns can both have an innkeeper called Alice, and they are
        // not the same Alice. The legacy scoped these per chat too.
        expect(portraitPath('c1')).toBe('chats/c1/portraits.json')
    })

    it('refuses a chat id that could climb out of it', () => {
        expect(() => portraitPath('../../settings')).toThrow(/unsafe chat id/)
    })
})

describe('a whole set put in a chat’s place (56)', () => {
    it('replaces every portrait at once and is read back', async () => {
        const { storage } = fakeStorage()
        const store = new PortraitStore(storage)
        await store.set('c1', 'Old', 'https://host/old.png')
        const record = await store.replace('c1', { Lissa: 'https://host/lissa.png', '📍 Monastery': 'https://host/m.png' })
        expect(record.portraits).toEqual({ Lissa: 'https://host/lissa.png', '📍 Monastery': 'https://host/m.png' })
        expect((await new PortraitStore(storage).load('c1')).portraits).toEqual({ Lissa: 'https://host/lissa.png', '📍 Monastery': 'https://host/m.png' })
    })
})

describe('reading a stored map back', () => {
    it('keeps what it can use', () => {
        expect(readPortraits({ portraits: { Alice: '/a.png' } })).toEqual({ Alice: '/a.png' })
    })

    it('re-normalizes the keys rather than trusting them', () => {
        // A file written by an older build — or edited by hand — must not hold a
        // key the lookup could never match.
        expect(readPortraits({ portraits: { '  Alice (innkeeper) ': '/a.png' } })).toEqual({ Alice: '/a.png' })
    })

    it.each([
        ['a value that is not a string', { portraits: { Alice: { url: '/a.png' } } }],
        ['an empty value', { portraits: { Alice: '   ' } }],
        ['a key that normalizes to nothing', { portraits: { '(just a note)': '/a.png' } }],
        ['no portraits at all', { portraits: null }],
        ['not an object', 'nope'],
    ])('drops %s', (_name, stored) => {
        expect(readPortraits(stored)).toEqual({})
    })
})

describe('the portrait store', () => {
    it('starts empty', async () => {
        const { storage } = fakeStorage()
        expect((await new PortraitStore(storage).load('c1')).portraits).toEqual({})
    })

    it('sets a portrait and reads it back', async () => {
        const { storage } = fakeStorage()
        const store = new PortraitStore(storage)

        await store.set('c1', 'Alice', '/user/images/alice.png', 'u1')
        expect((await store.load('c1', 'u1')).portraits).toEqual({ Alice: '/user/images/alice.png' })
    })

    it('normalizes the name, so the panel can pass what the memo said', async () => {
        // The panel hands over the entity exactly as the narrator spelled it.
        const { storage } = fakeStorage()
        const store = new PortraitStore(storage)

        const record = await store.set('c1', 'Moth Wraith (a construct of the dream)', '/rat.png')
        expect(record.portraits).toEqual({ 'Moth Wraith': '/rat.png' })
    })

    it('removes a portrait when the reference is empty', async () => {
        const { storage } = fakeStorage()
        const store = new PortraitStore(storage)
        await store.set('c1', 'Alice', '/a.png')

        expect((await store.set('c1', 'Alice', '')).portraits).toEqual({})
    })

    it('refuses a nameless portrait', async () => {
        const { storage } = fakeStorage()
        await expect(new PortraitStore(storage).set('c1', '   ', '/a.png')).rejects.toThrow(/entity name/)
    })

    it('keeps chats and users apart', async () => {
        const { storage } = fakeStorage()
        const store = new PortraitStore(storage)
        await store.set('c1', 'Alice', '/a.png', 'u1')

        expect((await store.load('c2', 'u1')).portraits).toEqual({})
        expect((await store.load('c1', 'u2')).portraits).toEqual({})
    })

    it('survives to disk', async () => {
        const { storage } = fakeStorage()
        await new PortraitStore(storage).set('c1', 'Alice', '/a.png')

        expect((await new PortraitStore(storage).load('c1')).portraits).toEqual({ Alice: '/a.png' })
    })

    it('caps the map, dropping the ones set longest ago', async () => {
        const { storage } = fakeStorage()
        const store = new PortraitStore(storage)

        for (let i = 0; i < MAX_PORTRAITS + 3; i++) await store.set('c1', `NPC ${i}`, `/npc${i}.png`)

        const record = await store.load('c1')
        expect(Object.keys(record.portraits)).toHaveLength(MAX_PORTRAITS)
        expect(record.portraits['NPC 0']).toBeUndefined()
        expect(record.portraits[`NPC ${MAX_PORTRAITS + 2}`]).toBe(`/npc${MAX_PORTRAITS + 2}.png`)
    })

    it('clears', async () => {
        const { storage } = fakeStorage()
        const store = new PortraitStore(storage)
        await store.set('c1', 'Alice', '/a.png')

        expect((await store.clear('c1')).portraits).toEqual({})
        expect((await store.load('c1')).portraits).toEqual({})
    })

    it('reads an unreadable file as no portraits', async () => {
        const storage: PortraitStorage = {
            async getJson(): Promise<never> { throw new Error('disk gone') },
            async setJson(): Promise<void> {},
        }
        expect((await new PortraitStore(storage).load('c1')).portraits).toEqual({})
    })

    it('rejects an unsafe chat id rather than answering with nothing', async () => {
        const { storage } = fakeStorage()
        await expect(new PortraitStore(storage).load('../../settings')).rejects.toThrow(/unsafe chat id/)
    })

    it('shares one load between concurrent readers', async () => {
        const { storage } = fakeStorage()
        const getJson = vi.spyOn(storage, 'getJson')
        const store = new PortraitStore(storage)

        await Promise.all([store.load('c1'), store.load('c1')])
        expect(getJson).toHaveBeenCalledTimes(1)
    })
})

describe('announcing a change (43-bis)', () => {
    it('tells its listener after every write lands, with the chat, the record and the user, and never on a read', async () => {
        const { storage } = fakeStorage()
        const told: unknown[] = []
        const store = new PortraitStore(storage, { onChange: (chatId, record, userId) => { told.push([chatId, Object.keys(record.portraits), userId]) } })
        await store.load('chat-1', 'u1')
        expect(told).toEqual([])
        await store.set('chat-1', 'Alice', 'https://host/a.png', 'u1')
        await store.clear('chat-1', 'u1')
        expect(told).toEqual([['chat-1', ['Alice'], 'u1'], ['chat-1', [], 'u1']])
        // A store without a listener is the store it was.
        await expect(new PortraitStore(storage).set('chat-1', 'Bob', 'x')).resolves.toBeTruthy()
    })
})
