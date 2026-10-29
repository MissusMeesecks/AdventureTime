import { describe, expect, it } from 'vitest'

import {
    MAX_LORE_HISTORY,
    dropLatestLorePass,
    latestLorePass,
    loreHistoryPath,
    readLoreHistory,
    recordLorePass,
} from './lore-history.js'
import type { LorePassSnapshot } from '../agent/undo.js'

function makeStorage(seed: Record<string, unknown> = {}) {
    const files = new Map(Object.entries(seed))
    return {
        files,
        storage: {
            getJson: async <T>(path: string, options?: { fallback?: T }) =>
                (files.has(path) ? files.get(path) : options?.fallback) as T,
            setJson: async (path: string, value: unknown) => { files.set(path, value) },
        },
    }
}

const snapshot = (over: Partial<LorePassSnapshot> = {}): LorePassSnapshot => ({
    chatId: 'chat-1',
    at: '2026-09-01T00:00:00.000Z',
    prefix: 'Vell',
    books: [],
    ownedBooks: [],
    createdBooks: [],
    ...over,
})

describe('the lore history file', () => {
    it('lives beside the chat\'s other state', () => {
        expect(loreHistoryPath('chat-1')).toBe('chats/chat-1/lore-history.json')
    })

    it('refuses an unsafe chat id', () => {
        expect(() => loreHistoryPath('../escape')).toThrow(/unsafe chat id/)
    })

    it('keeps the newest pass first', async () => {
        const { storage } = makeStorage()
        await recordLorePass(storage, 'chat-1', snapshot({ at: 'first' }), 'u1')
        await recordLorePass(storage, 'chat-1', snapshot({ at: 'second' }), 'u1')

        expect((await latestLorePass(storage, 'chat-1', 'u1'))?.at).toBe('second')
    })

    it('caps how many passes it keeps, in the file', async () => {
        // Each snapshot is a whole copy of the campaign's lore, so the cap has
        // to bite on the way *in*. Asserting through `readLoreHistory` would
        // not show that: it trims on the way out too, and would report a
        // capped list over an unbounded file.
        const { storage, files } = makeStorage()
        for (let i = 0; i < MAX_LORE_HISTORY + 3; i++) {
            await recordLorePass(storage, 'chat-1', snapshot({ at: `pass-${i}` }), 'u1')
        }
        const stored = files.get('chats/chat-1/lore-history.json') as { passes: unknown[] }
        expect(stored.passes).toHaveLength(MAX_LORE_HISTORY)

        const history = await readLoreHistory(storage, 'chat-1', 'u1')
        expect(history.passes[0]!.at).toBe(`pass-${MAX_LORE_HISTORY + 2}`)
    })

    it('drops only the newest when one is undone', async () => {
        const { storage } = makeStorage()
        await recordLorePass(storage, 'chat-1', snapshot({ at: 'older' }), 'u1')
        await recordLorePass(storage, 'chat-1', snapshot({ at: 'newer' }), 'u1')

        await dropLatestLorePass(storage, 'chat-1', 'u1')

        expect((await latestLorePass(storage, 'chat-1', 'u1'))?.at).toBe('older')
    })

    it('says there is nothing to undo when nothing was recorded', async () => {
        const { storage } = makeStorage()
        expect(await latestLorePass(storage, 'chat-1', 'u1')).toBeNull()
    })

    it('keeps two chats apart', async () => {
        // Two campaigns interleave. An undo in one must not reach the other.
        const { storage } = makeStorage()
        await recordLorePass(storage, 'chat-1', snapshot({ at: 'ours' }), 'u1')
        await recordLorePass(storage, 'chat-2', snapshot({ chatId: 'chat-2', at: 'theirs' }), 'u1')

        await dropLatestLorePass(storage, 'chat-1', 'u1')

        expect(await latestLorePass(storage, 'chat-1', 'u1')).toBeNull()
        expect((await latestLorePass(storage, 'chat-2', 'u1'))?.at).toBe('theirs')
    })

    it('survives a file holding nonsense', async () => {
        // A truncated or hand-edited file must cost an undo, not a pass. The
        // worst case of reading defensively is no undo; the worst case of
        // trusting it is a pass that throws before it starts.
        const { storage } = makeStorage({ 'chats/chat-1/lore-history.json': { passes: 'not a list' } })
        expect(await readLoreHistory(storage, 'chat-1', 'u1')).toMatchObject({ passes: [] })
    })

    it('drops an entry that is not a snapshot', async () => {
        const { storage } = makeStorage({
            'chats/chat-1/lore-history.json': { passes: [{ chatId: 'chat-1' }, snapshot({ at: 'real' })] },
        })
        const history = await readLoreHistory(storage, 'chat-1', 'u1')
        expect(history.passes).toHaveLength(1)
        expect(history.passes[0]!.at).toBe('real')
    })
})
