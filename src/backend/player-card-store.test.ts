import { describe, expect, it } from 'vitest'

import { emptyPlayerCardRecord, PlayerCardStore, playerCardPath } from './player-card-store.js'

function storage(seed: Record<string, unknown> = {}) {
    const files = new Map<string, unknown>(Object.entries(seed))
    const writes: Array<[string, unknown]> = []
    return {
        files,
        writes,
        getJson: async <T,>(path: string, options?: { fallback?: T }) => (files.has(path) ? (files.get(path) as T) : (options?.fallback as T)),
        setJson: async (path: string, value: unknown) => { files.set(path, value); writes.push([path, value]) },
    }
}

describe('the Player Card store', () => {
    it('keeps a card per chat beside the memo, and refuses an unsafe chat id', async () => {
        expect(playerCardPath('chat-1')).toBe('chats/chat-1/player-card.json')
        expect(() => playerCardPath('../x')).toThrow(/unsafe chat id/)
        const s = storage()
        const store = new PlayerCardStore(s)
        expect(await store.load('chat-1')).toEqual(emptyPlayerCardRecord())
        expect(store.snapshot('chat-1')).toEqual(emptyPlayerCardRecord())
        expect(store.snapshot('chat-2')).toBeUndefined()
        const saved = await store.save('chat-1', { card: { name: 'Robin', bio: 'Body: tall.', wordCount: 150, at: 't1' } }, 'u1')
        expect(saved.card).toEqual({ name: 'Robin', bio: 'Body: tall.', wordCount: 150, at: 't1' })
        expect(saved.persona).toBeNull()
        expect(s.writes[0]![0]).toBe('chats/chat-1/player-card.json')
        // The persona is kept beside the card, and either may change alone.
        const withPersona = await store.save('chat-1', { persona: { id: 'p1', name: 'Robin', at: 't2' } }, 'u1')
        expect(withPersona.card?.name).toBe('Robin')
        expect(withPersona.persona).toEqual({ id: 'p1', name: 'Robin', at: 't2' })
        const removed = await store.save('chat-1', { card: null }, 'u1')
        expect(removed.card).toBeNull()
        expect(removed.persona?.id).toBe('p1')
        await expect(store.load('../x')).rejects.toThrow(/unsafe/)
    })

    it('reads a stored record back safely, and treats an unreadable one as empty', async () => {
        const s = storage({
            'chats/ok/player-card.json': { version: 1, card: { name: 'Robin', bio: 'Body: tall.', wordCount: '300', at: 7 }, persona: { id: 'p1', name: 'Robin' }, updatedAt: 't' },
            'chats/junk/player-card.json': { card: { name: 7 }, persona: 'x' },
            'chats/nobio/player-card.json': { card: { name: 'Robin' }, persona: { id: 'p1' } },
            'chats/text/player-card.json': 'nope',
        })
        const store = new PlayerCardStore(s)
        const ok = await store.load('ok')
        expect(ok.card).toEqual({ name: 'Robin', bio: 'Body: tall.', wordCount: 150, at: 't' })
        expect(ok.persona).toEqual({ id: 'p1', name: 'Robin', at: 't' })
        expect((await store.load('junk')).card).toBeNull()
        expect((await store.load('junk')).persona).toBeNull()
        expect((await store.load('nobio')).card).toBeNull()
        expect((await store.load('nobio')).persona).toBeNull()
        expect(await store.load('text')).toEqual(emptyPlayerCardRecord())
        const failing = new PlayerCardStore({ getJson: async () => { throw new Error('disk') }, setJson: async () => undefined })
        expect(await failing.load('chat-1')).toEqual(emptyPlayerCardRecord())
    })

    it('loads once per chat and user, and shares an in-flight load', async () => {
        let reads = 0
        const store = new PlayerCardStore({ getJson: async <T,>(_p: string, o?: { fallback?: T }) => { reads++; return o?.fallback as T }, setJson: async () => undefined })
        await Promise.all([store.load('chat-1', 'u1'), store.load('chat-1', 'u1')])
        await store.load('chat-1', 'u1')
        expect(reads).toBe(1)
        await store.load('chat-1', 'u2')
        expect(reads).toBe(2)
    })
})
