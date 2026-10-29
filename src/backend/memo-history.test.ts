import { describe, expect, it, vi } from 'vitest'

import {
    foldMemoSnapshot,
    MAX_MEMO_SNAPSHOTS,
    MemoHistoryStore,
    memoHistoryPath,
    type MemoHistoryStorage,
    type MemoSnapshot,
} from './memo-history.js'

const snap = (messageId: string, memo = `state after ${messageId}`, at = '2026-08-30T00:00:00.000Z'): MemoSnapshot => ({
    messageId,
    memo,
    at,
})

/** Keyed by user as well as path, because `spindle.userStorage` is. */
function fakeStorage(seed: Record<string, unknown> = {}) {
    const files = new Map<string, unknown>(Object.entries(seed))
    const at = (path: string, userId?: string): string => `${userId ?? '@self'}:${path}`

    const storage: MemoHistoryStorage = {
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

describe('where the history lives', () => {
    it('sits beside the memo, in the chat directory', () => {
        expect(memoHistoryPath('c1')).toBe('chats/c1/memo-history.json')
    })

    it('refuses a chat id that could climb out of it', () => {
        expect(() => memoHistoryPath('../../settings')).toThrow(/unsafe chat id/)
    })
})

describe('folding a turn into the history', () => {
    it('puts the newest first', () => {
        const folded = foldMemoSnapshot([snap('m1')], snap('m2'))
        expect(folded.map((s) => s.messageId)).toEqual(['m2', 'm1'])
    })

    it('keeps one snapshot per message', () => {
        // A swipe re-tracks a message that already has one. Keeping both would
        // leave the card showing a version of the story the user rejected.
        const first = foldMemoSnapshot([], snap('m7', 'the rejected ending'))
        const second = foldMemoSnapshot(first, snap('m7', 'the kept ending'))

        expect(second).toHaveLength(1)
        expect(second[0]!.memo).toBe('the kept ending')
    })

    it('leaves the other messages alone when one is re-tracked', () => {
        const history = [snap('m3'), snap('m2'), snap('m1')]
        const folded = foldMemoSnapshot(history, snap('m2', 'redone'))

        expect(folded.map((s) => s.messageId)).toEqual(['m2', 'm3', 'm1'])
        expect(folded[0]!.memo).toBe('redone')
    })

    it('ignores a snapshot with no message to hang under', () => {
        const history = [snap('m1')]
        expect(foldMemoSnapshot(history, snap('', 'orphan'))).toBe(history)
    })

    it('slides the window, dropping the oldest', () => {
        let history: MemoSnapshot[] = []
        for (let i = 0; i < MAX_MEMO_SNAPSHOTS + 5; i++) history = foldMemoSnapshot(history, snap(`m${i}`))

        expect(history).toHaveLength(MAX_MEMO_SNAPSHOTS)
        expect(history[0]!.messageId).toBe(`m${MAX_MEMO_SNAPSHOTS + 4}`)
        expect(history.at(-1)!.messageId).toBe('m5')
    })
})

describe('the history store', () => {
    it('starts empty for a chat with no tracked turn', async () => {
        const { storage } = fakeStorage()
        expect((await new MemoHistoryStore(storage).load('c1')).snapshots).toEqual([])
    })

    it('records a turn and reads it back', async () => {
        const { storage } = fakeStorage()
        const store = new MemoHistoryStore(storage)

        await store.record('c1', snap('m2', '[TIME]\nDay 4\n[/TIME]'), 'u1')
        expect((await store.load('c1', 'u1')).snapshots[0]).toMatchObject({
            messageId: 'm2',
            memo: '[TIME]\nDay 4\n[/TIME]',
        })
    })

    it('keeps chats and users apart', async () => {
        const { storage } = fakeStorage()
        const store = new MemoHistoryStore(storage)
        await store.record('c1', snap('m2'), 'u1')

        expect((await store.load('c2', 'u1')).snapshots).toEqual([])
        expect((await store.load('c1', 'u2')).snapshots).toEqual([])
    })

    it('survives to disk', async () => {
        const { storage } = fakeStorage()
        await new MemoHistoryStore(storage).record('c1', snap('m2', 'kept'))

        expect((await new MemoHistoryStore(storage).load('c1')).snapshots[0]!.memo).toBe('kept')
    })

    it('does not write when nothing changed', async () => {
        const { storage } = fakeStorage()
        const setJson = vi.spyOn(storage, 'setJson')
        const store = new MemoHistoryStore(storage)

        await store.record('c1', snap('m1'))
        await store.record('c1', snap('', 'no message'))
        expect(setJson).toHaveBeenCalledTimes(1)
    })

    it('clears', async () => {
        const { storage } = fakeStorage()
        const store = new MemoHistoryStore(storage)
        await store.record('c1', snap('m1'))

        expect((await store.clear('c1')).snapshots).toEqual([])
        expect((await store.load('c1')).snapshots).toEqual([])
    })

    it('reads an unreadable file as no history', async () => {
        const storage: MemoHistoryStorage = {
            async getJson(): Promise<never> { throw new Error('disk gone') },
            async setJson(): Promise<void> {},
        }
        expect((await new MemoHistoryStore(storage).load('c1')).snapshots).toEqual([])
    })

    it('drops entries a hand-edited file mangled, keeping the rest', async () => {
        const { storage } = fakeStorage({
            '@self:chats/c1/memo-history.json': {
                version: 1,
                updatedAt: '2026-08-30T00:00:00.000Z',
                snapshots: [snap('m2'), { messageId: '', memo: 'x' }, { messageId: 'm1' }, null, 'nope'],
            },
        })

        const record = await new MemoHistoryStore(storage).load('c1')
        expect(record.snapshots.map((s) => s.messageId)).toEqual(['m2'])
    })

    it('rejects an unsafe chat id rather than answering with no history', async () => {
        const { storage } = fakeStorage()
        await expect(new MemoHistoryStore(storage).load('../../settings')).rejects.toThrow(/unsafe chat id/)
    })

    it('shares one load between concurrent readers', async () => {
        const { storage } = fakeStorage()
        const getJson = vi.spyOn(storage, 'getJson')
        const store = new MemoHistoryStore(storage)

        await Promise.all([store.load('c1'), store.load('c1')])
        expect(getJson).toHaveBeenCalledTimes(1)
    })
})


describe('the message a stored state belongs to', () => {
    /** Read a file straight back through the store, as the panel does. */
    const readBack = async (snapshots: unknown[]) => {
        const { storage } = fakeStorage({
            '@self:chats/c1/memo-history.json': { version: 1, snapshots },
        })
        return (await new MemoHistoryStore(storage).load('c1')).snapshots
    }

    it('keeps the message number the pass recorded', async () => {
        const kept = await readBack([{ messageId: 'm15', memo: 'x', at: '', messageNumber: 15 }])
        expect(kept[0]!.messageNumber).toBe(15)
    })

    it('keeps a number of zero, which is a real message', async () => {
        // The host numbers from zero, so `#0` is the first message and not a
        // missing value.
        const kept = await readBack([{ messageId: 'm1', memo: 'x', at: '', messageNumber: 0 }])
        expect(kept[0]!.messageNumber).toBe(0)
    })

    it('drops a number that names no message', async () => {
        for (const messageNumber of [-3, 'fifteen', null]) {
            const kept = await readBack([{ messageId: 'm1', memo: 'x', at: '', messageNumber }])
            expect(kept[0]!.messageNumber).toBeUndefined()
        }
    })

    it('keeps a state recorded before numbers existed', async () => {
        const kept = await readBack([{ messageId: 'm1', memo: 'x', at: '' }])
        expect(kept[0]).toEqual({ messageId: 'm1', memo: 'x', at: '' })
    })
})
