import { describe, expect, it } from 'vitest'

import { createCampaignNamer, type CampaignNamerDeps } from './campaign-name.js'

function harness(over: Partial<CampaignNamerDeps> & { names?: Record<string, string>; card?: string | null; chatCard?: string | null | Error } = {}) {
    const { names = {}, card = 'Vellmoor Keeper', chatCard, ...rest } = over
    let stored: Record<string, string> = { ...names }
    const patches: unknown[] = []
    const log: string[] = []
    let cardReads = 0
    const deps: CampaignNamerDeps = {
        prefs: {
            load: async () => ({ campaignNames: { ...stored } }),
            patch: async (patch) => { patches.push(patch); stored = { ...patch.campaignNames }; return stored },
        },
        characters: { get: async (id) => { cardReads++; return card === null ? null : { name: id === 'c1' ? card : 'Other Card' } } },
        log: { info: (m) => log.push(m), warn: (m) => log.push(`warn: ${m}`) },
        now: () => new Date(2026, 9, 11, 14, 32),
        // The chat's record (51-bis), only when the harness is given one.
        ...(chatCard !== undefined
            ? { chats: { get: async () => { if (chatCard instanceof Error) throw chatCard; return chatCard === null ? null : { characterId: chatCard } } } }
            : {}),
        ...rest,
    }
    return { namer: createCampaignNamer(deps), patches, log, stored: () => stored, cardReads: () => cardReads }
}

describe('naming a campaign after the card (51)', () => {
    it('mints from the card and the clock, stores it as the chat’s campaign name, and says so', async () => {
        const { namer, patches, log, stored } = harness({ names: { 'chat-9': 'Elsewhere' } })
        expect(await namer.name({ chatId: 'chat-1', userId: 'u1', characterId: 'c1' })).toEqual({ name: 'Vell_261011_1432', minted: true, prefix: 'Vell_261011_1432' })
        expect(patches).toEqual([{ campaignNames: { 'chat-9': 'Elsewhere', 'chat-1': 'Vell_261011_1432' } }])
        expect(stored()['chat-1']).toBe('Vell_261011_1432')
        expect(log).toEqual(['campaign: named chat chat-1 "Vell_261011_1432" after "Vellmoor Keeper"'])
        // Asked again, the stored name comes back and nothing is written.
        expect(await namer.name({ chatId: 'chat-1', userId: 'u1', characterId: 'c1' })).toEqual({ name: 'Vell_261011_1432', minted: false, prefix: 'Vell_261011_1432' })
        expect(patches).toHaveLength(1)
    })

    it('never replaces a typed name, and gives its prefix', async () => {
        const { namer, patches, cardReads } = harness({ names: { 'chat-1': 'Vellmoor: Book II' } })
        expect(await namer.name({ chatId: 'chat-1', userId: 'u1', characterId: 'c1' })).toEqual({ name: 'Vellmoor: Book II', minted: false, prefix: 'Vellmoor_Book_II' })
        expect(patches).toEqual([])
        // A named chat costs no card read: the answer is in the preferences.
        expect(cardReads()).toBe(0)
    })

    it('names a chat whose card cannot be read Chat, and says why in the log', async () => {
        const gone = harness({ card: null })
        expect((await gone.namer.name({ chatId: 'chat-1', userId: 'u1', characterId: 'c1' })).name).toBe('Chat_261011_1432')
        // A card the host does not have is not a failure: no warning, only the naming line.
        expect(gone.log).toEqual(['campaign: named chat chat-1 "Chat_261011_1432" (no card to name it after)'])
        const broken = harness({ characters: { get: async () => { throw new Error('PERMISSION_DENIED') } } })
        expect((await broken.namer.name({ chatId: 'chat-1', userId: 'u1', characterId: 'c1' })).name).toBe('Chat_261011_1432')
        expect(broken.log[0]).toBe('warn: campaign: the card c1 could not be read for the name: PERMISSION_DENIED')
        const ungranted = harness({ characters: undefined })
        expect((await ungranted.namer.name({ chatId: 'chat-1', userId: 'u1', characterId: 'c1' })).name).toBe('Chat_261011_1432')
    })

    it('reads the card from the chat’s own record (51-bis), over the panel’s id, and names nothing with no card known', async () => {
        // The first live try: a chat just made, the panel's view of it with
        // no card, and `Chat_…` minted on that. The chat's record knows.
        const fromRecord = harness({ chatCard: 'c1' })
        expect(await fromRecord.namer.name({ chatId: 'chat-1', userId: 'u1' })).toEqual({ name: 'Vell_261011_1432', minted: true, prefix: 'Vell_261011_1432' })
        expect(fromRecord.log).toEqual(['campaign: named chat chat-1 "Vell_261011_1432" after "Vellmoor Keeper"'])
        // The record outranks the panel's id when the two differ.
        const differ = harness({ chatCard: 'c1' })
        expect((await differ.namer.name({ chatId: 'chat-1', userId: 'u1', characterId: 'c2' })).name).toBe('Vell_261011_1432')
        // A record that cannot be read falls back to the panel's id, with a warning.
        const broken = harness({ chatCard: new Error('PERMISSION_DENIED') })
        expect((await broken.namer.name({ chatId: 'chat-1', userId: 'u1', characterId: 'c2' })).name).toBe('Othe_261011_1432')
        expect(broken.log).toEqual([
            'warn: campaign: the chat chat-1 could not be read for its card: PERMISSION_DENIED',
            'campaign: named chat chat-1 "Othe_261011_1432" after "Other Card"',
        ])
        // No card known at all — no record, no id — names nothing and writes nothing.
        for (const none of [harness(), harness({ chatCard: null }), harness({ chatCard: new Error('PERMISSION_DENIED') })]) {
            expect(await none.namer.name({ chatId: 'chat-1', userId: 'u1' })).toEqual({ name: '', minted: false, prefix: 'chat_1', reason: 'the chat’s card is not known yet' })
            expect(none.patches).toEqual([])
            expect(none.cardReads()).toBe(0)
            expect(none.log.at(-1)).toBe('campaign: chat chat-1 has no card known yet; not named')
        }
    })

    it('keeps clear of a name another chat carries, and of one stored between the read and the write', async () => {
        const clash = harness({ names: { 'chat-2': 'Vell_261011_1432' } })
        expect((await clash.namer.name({ chatId: 'chat-1', userId: 'u1', characterId: 'c1' })).name).toBe('Vell_261011_1432b')
        let reads = 0
        let stored: Record<string, string> = {}
        const raced = harness({
            prefs: {
                load: async () => { reads++; if (reads === 2) stored = { 'chat-1': 'Typed Meanwhile' }; return { campaignNames: { ...stored } } },
                patch: async (patch) => { stored = { ...patch.campaignNames }; return stored },
            },
        })
        expect(await raced.namer.name({ chatId: 'chat-1', userId: 'u1', characterId: 'c1' })).toEqual({ name: 'Typed Meanwhile', minted: false, prefix: 'Typed_Meanwhile' })
        expect(stored).toEqual({ 'chat-1': 'Typed Meanwhile' })
    })
})
