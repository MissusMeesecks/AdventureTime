import { describe, expect, it } from 'vitest'

import { createLoreLoad, estimateLoreTokens, loreWarningLine, readActivationEvent, type LoreLoadResult } from './lore-load.js'

/** Invented books: a campaign's own NPC book and a book of somebody else's. */
function harness(options: { threshold?: number; failBook?: string } = {}) {
    const logged: string[] = []
    const told: Array<{ chatId: string; result: LoreLoadResult; userId: string | undefined }> = []
    const books = [{ id: 'b-npc', name: 'Brine_NPC' }, { id: 'b-other', name: 'Old Atlas' }]
    const entries: Record<string, Array<{ id: string; uid: string; content: string; comment: string; constant?: boolean }>> = {
        'b-npc': [
            { id: 'e-1', uid: 'harbourmaster', content: 'x'.repeat(4001), comment: 'Harbourmaster Quill' },
            { id: 'e-2', uid: 'ferryman', content: 'y'.repeat(800), comment: 'The Ferryman' },
        ],
        'b-other': [{ id: 'e-3', uid: 'tides', content: 'z'.repeat(2000), comment: 'Tide tables', constant: true }],
    }
    const load = createLoreLoad({
        books: () => ({
            listBooks: async () => books,
            listEntries: async (bookId) => {
                if (bookId === options.failBook) throw new Error('unreadable')
                return entries[bookId] ?? []
            },
        }),
        cleanable: async () => (name) => name === 'Brine_NPC',
        threshold: async () => options.threshold ?? 1000,
        notify: (chatId, result, userId) => { told.push({ chatId, result, userId }) },
        log: { info: (m) => { logged.push(m) }, warn: (m) => { logged.push(`warn: ${m}`) } },
        now: () => new Date('2030-01-02T03:04:05Z'),
    })
    return { load, logged, told }
}

const event = (extra: Record<string, unknown> = {}) => ({
    chatId: 'chat-1',
    entries: [
        { id: 'e-2', comment: 'The Ferryman', keys: [], source: 'keyword', bookId: 'b-npc', bookName: 'Brine_NPC', estimatedTokens: 210 },
        { id: 'e-1', comment: 'Harbourmaster Quill', keys: [], source: 'keyword', bookId: 'b-npc', bookName: 'Brine_NPC', estimatedTokens: 1001 },
        { id: 'e-3', comment: 'Tide tables', keys: [], source: 'vector', bookId: 'b-other', estimatedTokens: 500 },
    ],
    // The host's numbers, not a recount: its size for the ferryman differs from the stored text's, its total from the sum.
    stats: { estimatedTokens: 1715, evictedByBudget: 0, evictedByMinPriority: 0 },
    ...extra,
})

describe('the lore size warning', () => {
    it('counts as Lumiverse’s budget does: the length over four, rounded up', () => {
        expect(estimateLoreTokens('')).toBe(0)
        expect(estimateLoreTokens('abcd')).toBe(1)
        expect(estimateLoreTokens('abcde')).toBe(2)
    })

    it('reads the host’s event without trusting its shape', () => {
        expect(readActivationEvent(null)).toBeNull()
        expect(readActivationEvent({ entries: [] })).toBeNull()
        expect(readActivationEvent({ chatId: 'c', entries: [null, { comment: 'no id' }, { id: 'a', estimatedTokens: -1 }] }))
            .toEqual({ chatId: 'c', entries: [{ id: 'a', title: '', bookId: '', bookName: '', tokens: null }], hostTotal: null, leftOut: null })
        expect(readActivationEvent({ chatId: 'c', entries: [], stats: { estimatedTokens: 12, evictedByBudget: 2, evictedByMinPriority: 1 } }))
            .toMatchObject({ hostTotal: 12, leftOut: 3 })
    })

    it('keeps the host’s own sizes, largest first, with the campaign’s own entries addressed for a clean', async () => {
        const { load, told, logged } = harness()
        await load.onActivated(event(), 'u1')
        const result = await load.get('chat-1', 'u1')
        expect(result).toEqual(told[0]!.result)
        expect(told[0]).toMatchObject({ chatId: 'chat-1', userId: 'u1' })
        expect(result.over).toBe(true)
        expect(result.threshold).toBe(1000)
        expect(result.load).toEqual({
            chatId: 'chat-1',
            at: '2030-01-02T03:04:05.000Z',
            total: 1715,
            leftOut: 0,
            entries: [
                { id: 'e-1', title: 'Harbourmaster Quill', book: 'Brine_NPC', tokens: 1001, constant: false, cleanTarget: 'Brine_NPC::harbourmaster' },
                { id: 'e-3', title: 'Tide tables', book: 'Old Atlas', tokens: 500, constant: true },
                { id: 'e-2', title: 'The Ferryman', book: 'Brine_NPC', tokens: 210, constant: false, cleanTarget: 'Brine_NPC::ferryman' },
            ],
        })
        expect(logged).toEqual(['lore: Lumiverse sent about 1,715 tokens of lore with the reply in chat chat-1 (3 entries), over the warning of 1,000; the largest: "Harbourmaster Quill" 1,001, "Tide tables" 500, "The Ferryman" 210'])
    })

    it('sizes an entry itself, by the same rule, when the host sent no size', async () => {
        const { load } = harness()
        const bare = event({ stats: undefined })
        for (const entry of bare.entries) delete (entry as Record<string, unknown>).estimatedTokens
        await load.onActivated(bare, undefined)
        const result = await load.get('chat-1', undefined)
        expect(result.load!.entries.map((e) => e.tokens)).toEqual([1001, 500, 200])
        expect(result.load!.total).toBe(1701)
        expect(result.load!.leftOut).toBeNull()
    })

    it('says nothing in the log at or under the warning, and never warns at 0', async () => {
        const exact = harness({ threshold: 1715 })
        await exact.load.onActivated(event(), 'u1')
        expect(exact.logged).toEqual([])
        expect(exact.told[0]!.result.over).toBe(false)
        const off = harness({ threshold: 0 })
        await off.load.onActivated(event(), 'u1')
        expect(off.logged).toEqual([])
        expect(off.told[0]!.result).toMatchObject({ over: false, threshold: 0 })
        expect(off.told[0]!.result.load!.total).toBe(1715)
    })

    it('keeps a chat’s load per user, and answers null for a chat it has not seen', async () => {
        const { load } = harness()
        await load.onActivated(event(), 'u1')
        expect((await load.get('chat-1', 'u2')).load).toBeNull()
        expect(await load.get('chat-9', 'u1')).toEqual({ load: null, threshold: 1000, over: false })
    })

    it('still sizes the reply when a book cannot be read, and offers no clean on its entries', async () => {
        const { load, logged } = harness({ failBook: 'b-npc' })
        await load.onActivated(event(), 'u1')
        const result = await load.get('chat-1', 'u1')
        expect(result.load!.total).toBe(1715)
        expect(result.load!.entries.every((e) => e.cleanTarget === undefined)).toBe(true)
        expect(logged[0]).toBe('warn: lore: the book "Brine_NPC" could not be read for the size of its entries: Error: unreadable')
    })

    it('names what Lumiverse left out in the log line', () => {
        expect(loreWarningLine('c', { chatId: 'c', at: '', total: 20000, leftOut: 2, entries: [{ id: 'a', title: '', book: '', tokens: 20000, constant: false }] }, 10000))
            .toBe('lore: Lumiverse sent about 20,000 tokens of lore with the reply in chat c (1 entry), over the warning of 10,000; the largest: "a" 20,000; Lumiverse left 2 more out by its own limits')
    })
})
