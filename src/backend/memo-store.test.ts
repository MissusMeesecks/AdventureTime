import { describe, expect, it, vi } from 'vitest'

import { MEMO_VERSION, MemoStore, emptyMemoRecord, memoPath, type MemoStorage } from './memo-store.js'

/** An in-memory stand-in for `spindle.userStorage`, with hooks for failure. */
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
            files.set(path, value)
        },
    }
    return storage
}

describe('memoPath', () => {
    it('gives each chat its own file', () => {
        expect(memoPath('abc123')).toBe('chats/abc123/memo.json')
    })

    it.each(['../../etc/passwd', 'a/b', '', '.', '..', 'a b'])('refuses the unsafe chat id %j', (id) => {
        // A silently rewritten id would read and write the wrong chat, which is
        // worse than failing.
        expect(() => memoPath(id)).toThrow()
    })
})

describe('MemoStore', () => {
    it('gives an empty record for a chat with no memo yet', async () => {
        const store = new MemoStore(fakeStorage())
        expect(await store.load('chat1')).toEqual(emptyMemoRecord())
    })

    it('reads back what it wrote', async () => {
        const store = new MemoStore(fakeStorage())
        await store.save('chat1', '[TIME]\nDay 4\n[/TIME]')
        expect((await store.load('chat1')).memo).toBe('[TIME]\nDay 4\n[/TIME]')
    })

    it('gives each chat its own file on disk', async () => {
        const storage = fakeStorage()
        await new MemoStore(storage).save('chat1', 'x')
        expect(storage.files.get('chats/chat1/memo.json')).toMatchObject({ version: MEMO_VERSION, memo: 'x' })
    })

    it('keeps two chats apart', async () => {
        const store = new MemoStore(fakeStorage())
        await store.save('chat1', 'one')
        await store.save('chat2', 'two')
        expect((await store.load('chat1')).memo).toBe('one')
        expect((await store.load('chat2')).memo).toBe('two')
    })

    it('keeps two users apart', async () => {
        const store = new MemoStore(fakeStorage())
        await store.save('chat1', 'hers', 'u1')
        await store.save('chat1', 'his', 'u2')
        expect((await store.load('chat1', 'u1')).memo).toBe('hers')
        expect((await store.load('chat1', 'u2')).memo).toBe('his')
    })

    it('rejects an unsafe chat id instead of quietly returning an empty memo', async () => {
        // The guard must not sit inside load()'s try/catch, or a read failure
        // and a rejected id become indistinguishable.
        const store = new MemoStore(fakeStorage())
        await expect(store.load('../../settings')).rejects.toThrow(/unsafe chat id/)
        await expect(store.save('../../settings', 'x')).rejects.toThrow(/unsafe chat id/)
    })

    it('survives an unreadable file rather than taking the panel down', async () => {
        const storage = fakeStorage()
        storage.failReads = true
        expect((await new MemoStore(storage).load('chat1')).memo).toBe('')
    })

    it('ignores a stored record whose memo is not a string', async () => {
        const storage = fakeStorage({ 'chats/chat1/memo.json': { version: 1, memo: { nope: true } } })
        expect((await new MemoStore(storage).load('chat1')).memo).toBe('')
    })

    it('loads a version 1 file, which simply predates the re-track fields', async () => {
        const storage = fakeStorage({ 'chats/chat1/memo.json': { version: 1, memo: 'old', updatedAt: 'then' } })
        const record = await new MemoStore(storage).load('chat1')
        expect(record).toMatchObject({ version: MEMO_VERSION, memo: 'old', updatedAt: 'then' })
        expect(record.previous).toBeUndefined()
        expect(record.lastMessageId).toBeUndefined()
    })

    it('round-trips the re-track fields', async () => {
        const storage = fakeStorage()
        const store = new MemoStore(storage)
        await store.save('chat1', 'now', undefined, { previous: 'before', lastMessageId: 'm7' })

        const reread = await new MemoStore(storage).load('chat1')
        expect(reread).toMatchObject({ memo: 'now', previous: 'before', lastMessageId: 'm7' })
    })

    it('leaves the re-track fields off when a writer does not set them', async () => {
        const storage = fakeStorage()
        await new MemoStore(storage).save('chat1', 'x')
        expect(storage.files.get('chats/chat1/memo.json')).not.toHaveProperty('previous')
    })

    it('shares one in-flight read between concurrent callers', async () => {
        const storage = fakeStorage({ 'chats/chat1/memo.json': { version: 1, memo: 'x', updatedAt: 'now' } })
        const spy = vi.spyOn(storage, 'getJson')
        const store = new MemoStore(storage)

        const [a, b] = await Promise.all([store.load('chat1'), store.load('chat1')])
        expect(a).toBe(b)
        expect(spy).toHaveBeenCalledTimes(1)
    })

    it('does not read storage again once a chat is cached', async () => {
        const storage = fakeStorage()
        const store = new MemoStore(storage)
        await store.load('chat1')
        const spy = vi.spyOn(storage, 'getJson')
        await store.load('chat1')
        expect(spy).not.toHaveBeenCalled()
    })

    it('lands concurrent writes in order, so the last one wins', async () => {
        const storage = fakeStorage()
        const store = new MemoStore(storage)

        await Promise.all([store.save('chat1', 'first'), store.save('chat1', 'second')])

        expect((storage.files.get('chats/chat1/memo.json') as { memo: string }).memo).toBe('second')
    })

    it('keeps writing after one write fails', async () => {
        const storage = fakeStorage()
        const store = new MemoStore(storage)
        vi.spyOn(storage, 'setJson').mockRejectedValueOnce(new Error('disk full'))

        await expect(store.save('chat1', 'lost')).rejects.toThrow('disk full')
        await expect(store.save('chat1', 'kept')).resolves.toMatchObject({ memo: 'kept' })
    })

    it('offers a snapshot only once something is loaded', async () => {
        // The interceptor is synchronous and must never block on a read.
        const store = new MemoStore(fakeStorage())
        expect(store.snapshot('chat1')).toBeUndefined()
        await store.load('chat1')
        expect(store.snapshot('chat1')).toBeDefined()
    })

    it('re-reads storage after a chat is forgotten', async () => {
        const storage = fakeStorage()
        const store = new MemoStore(storage)
        await store.save('chat1', 'cached')
        storage.files.set('chats/chat1/memo.json', { version: 1, memo: 'changed underneath' })

        store.forget('chat1')
        expect((await store.load('chat1')).memo).toBe('changed underneath')
    })
})
