import { describe, expect, it } from 'vitest'

import { createCampaignFork, type CampaignForkDeps, type CampaignForkPrefs } from './campaign-fork.js'

function harness(over: Partial<CampaignForkDeps> & { initial?: CampaignForkPrefs; forkMemo?: string; forkPortraits?: Record<string, string>; forkCard?: unknown; forkNpcs?: Record<string, unknown>; snapshots?: Array<{ messageId: string; memo: string }> } = {}) {
    const { initial, forkMemo, forkPortraits, forkCard, forkNpcs, snapshots, ...rest } = over
    let prefs: CampaignForkPrefs = initial ?? { campaignNames: { src: 'Vell' }, campaignBooks: { src: ['Vell_NPC', 'Vell_LOC'] }, trackerWatermarks: { src: 40 }, agentWatermarks: { src: 36 } }
    const memos: Record<string, string> = { src: '[CHARACTER]\nname: Z\n[/CHARACTER]', ...(forkMemo === undefined ? {} : { fork: forkMemo }) }
    const portraits: Record<string, Record<string, string>> = { src: { Lissa: 'https://host/l.png', '📍 Monastery': 'https://host/m.png' }, ...(forkPortraits ? { fork: forkPortraits } : {}) }
    const cards: Record<string, { card: unknown | null; persona: unknown | null }> = { src: { card: { name: 'Quill', bio: 'x' }, persona: { id: 'p1' } }, ...(forkCard !== undefined ? { fork: { card: forkCard, persona: null } } : {}) }
    const npcs: Record<string, Record<string, unknown>> = { src: { 'B::1': { label: 'Marcus', friendship: 5, affection: 0, log: [] } }, ...(forkNpcs ? { fork: forkNpcs } : {}) }
    const calls: unknown[][] = []
    const log: string[] = []
    const deps: CampaignForkDeps = {
        prefs: {
            load: async () => prefs,
            patch: async (patch) => { calls.push(['prefs', patch]); prefs = { ...prefs, ...patch } },
        },
        memos: {
            load: async (chatId) => ({ memo: memos[chatId] ?? '' }),
            save: async (chatId, memo) => { calls.push(['memo', chatId, memo]); memos[chatId] = memo },
        },
        memoHistory: { load: async () => ({ snapshots: snapshots ?? [{ messageId: 'm-9', memo: 'at nine' }, { messageId: 'm-5', memo: 'at five' }] }) },
        portraits: {
            load: async (chatId) => ({ portraits: portraits[chatId] ?? {} }),
            replace: async (chatId, map) => { calls.push(['portraits', chatId, map]); portraits[chatId] = map },
        },
        playerCards: {
            load: async (chatId) => cards[chatId] ?? { card: null, persona: null },
            save: async (chatId, patch) => { calls.push(['card', chatId, patch]) },
        },
        relationships: {
            load: async (chatId) => ({ npcs: npcs[chatId] ?? {} }),
            replace: async (chatId, map) => { calls.push(['relationships', chatId, map]) },
        },
        log: { info: (m) => log.push(m), warn: (m) => log.push(`warn: ${m}`) },
        ...rest,
    }
    return { fork: createCampaignFork(deps), calls, log, prefs: () => prefs }
}

describe('a fork keeps its campaign (56)', () => {
    it('copies the name, the books owned, the watermarks clipped to the fork point, the memo at the fork point, the portraits, the Player Card and the relationships, and says so', async () => {
        const h = harness()
        const result = await h.fork.fork({ sourceChatId: 'src', forkedChatId: 'fork', forkedAtMessageId: 'm-5', forkedAtMessageIndex: 37 }, 'u1')
        expect(result.failed).toEqual([])
        expect(result.kept).toEqual([])
        expect(result.copied).toEqual(['the campaign name "Vell"', '2 books owned', 'the watermarks', 'the memo as it stood at the fork point', '2 portraits', 'the Player Card', '1 relationship'])
        expect(h.calls[0]).toEqual(['prefs', {
            campaignNames: { src: 'Vell', fork: 'Vell' },
            campaignBooks: { src: ['Vell_NPC', 'Vell_LOC'], fork: ['Vell_NPC', 'Vell_LOC'] },
            // 38 messages were copied: the tracker's 40 is clipped, the agent's 36 kept.
            trackerWatermarks: { src: 40, fork: 38 },
            agentWatermarks: { src: 36, fork: 36 },
        }])
        expect(h.calls[1]).toEqual(['memo', 'fork', 'at five'])
        expect(h.calls[2]).toEqual(['portraits', 'fork', { Lissa: 'https://host/l.png', '📍 Monastery': 'https://host/m.png' }])
        expect(h.calls[3]).toEqual(['card', 'fork', { card: { name: 'Quill', bio: 'x' }, persona: { id: 'p1' } }])
        expect(h.calls[4]).toEqual(['relationships', 'fork', { 'B::1': { label: 'Marcus', friendship: 5, affection: 0, log: [] } }])
        expect(h.log).toEqual(['fork: chat fork forked from src at message 38: copied the campaign name "Vell", 2 books owned, the watermarks, the memo as it stood at the fork point, 2 portraits, the Player Card, 1 relationship'])
    })

    it('takes the current memo when the history has no snapshot for the fork point, and copies without a point at all', async () => {
        const noSnapshot = harness({ snapshots: [] })
        const result = await noSnapshot.fork.fork({ sourceChatId: 'src', forkedChatId: 'fork', forkedAtMessageId: 'm-5', forkedAtMessageIndex: 37 }, 'u1')
        expect(result.copied).toContain('the chat’s current memo')
        expect(noSnapshot.calls.find((c) => c[0] === 'memo')).toEqual(['memo', 'fork', '[CHARACTER]\nname: Z\n[/CHARACTER]'])
        const noPoint = harness()
        await noPoint.fork.fork({ sourceChatId: 'src', forkedChatId: 'fork' }, 'u1')
        expect((noPoint.calls[0] as [string, CampaignForkPrefs])[1].trackerWatermarks).toEqual({ src: 40, fork: 40 })
        expect(noPoint.log[0]).toMatch(/^fork: chat fork forked from src: copied/)
    })

    it('writes the fork only where it is empty: a named, played, pictured, carded or related fork keeps its own', async () => {
        const h = harness({
            initial: { campaignNames: { src: 'Vell', fork: 'Mine' }, campaignBooks: { src: ['Vell_NPC'], fork: ['vell_npc', 'Mine_LOC'] }, trackerWatermarks: { src: 40, fork: 3 } },
            forkMemo: 'played already', forkPortraits: { X: 'y' }, forkCard: { name: 'Q' }, forkNpcs: { 'B::2': {} },
        })
        const result = await h.fork.fork({ sourceChatId: 'src', forkedChatId: 'fork', forkedAtMessageIndex: 10 }, 'u1')
        expect(result.copied).toEqual([])
        expect(result.kept).toEqual(['the campaign name "Mine"', 'the books owned', 'the memo', 'the portraits', 'the Player Card', 'the relationships'])
        expect(h.calls).toEqual([])
        expect(h.log[0]).toBe('fork: chat fork forked from src at message 11: nothing to copy; kept the fork’s own the campaign name "Mine", the books owned, the memo, the portraits, the Player Card, the relationships')
    })

    it('copies nothing from a source with nothing, refuses a fork of itself, and goes on past a store that fails, saying so', async () => {
        const empty = harness({ initial: {}, memos: { load: async () => ({ memo: '' }), save: async () => undefined }, portraits: undefined, playerCards: undefined, relationships: undefined, memoHistory: undefined })
        const nothing = await empty.fork.fork({ sourceChatId: 'src', forkedChatId: 'fork' }, 'u1')
        expect(nothing).toEqual({ copied: [], kept: [], failed: [] })
        expect(empty.calls).toEqual([])
        const same = await harness().fork.fork({ sourceChatId: 'src', forkedChatId: 'src' }, 'u1')
        expect(same.failed).toEqual(['the fork names no source and fork, or the same chat twice'])
        const broken = harness({ portraits: { load: async () => { throw new Error('disk') }, replace: async () => undefined } })
        const result = await broken.fork.fork({ sourceChatId: 'src', forkedChatId: 'fork', forkedAtMessageId: 'm-9' }, 'u1')
        expect(result.failed).toEqual(['the portraits: disk'])
        expect(result.copied).toContain('the Player Card')
        expect(result.copied).toContain('the memo as it stood at the fork point')
        expect(broken.log[0]).toMatch(/^warn: fork: chat fork forked from src: copied .*; could not copy the portraits: disk$/)
    })
})
