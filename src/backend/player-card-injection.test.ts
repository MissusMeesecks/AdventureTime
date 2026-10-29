import { describe, expect, it } from 'vitest'

import { createPlayerCardInjection, PLAYER_CARD_INJECTION_LABEL } from './player-card-injection.js'
import { emptyPlayerCardRecord, type PlayerCardRecord } from './player-card-store.js'

const context = (over: Record<string, unknown> = {}) => ({ userId: 'u1', chatId: 'c1', generationId: 'g1', isDryRun: false, ...over }) as never

describe('the Player Card in the prompt', () => {
    it('sends the card as the legacy\'s block, labelled, and nothing without a card', () => {
        const record: PlayerCardRecord = { ...emptyPlayerCardRecord(), card: { name: 'Robin', bio: '  Body: tall.\nPersonality: wry.  ', wordCount: 150, at: 't' } }
        const inject = createPlayerCardInjection({ state: () => record })
        expect(inject(context())).toEqual({ messages: [{ role: 'system', content: '[PLAYER_CHARACTER]\nName: Robin\nBody: tall.\nPersonality: wry.\n[/PLAYER_CHARACTER]' }], label: PLAYER_CARD_INJECTION_LABEL })
        expect(createPlayerCardInjection({ state: () => emptyPlayerCardRecord() })(context())).toBeNull()
        expect(createPlayerCardInjection({ state: () => ({ ...record, card: { ...record.card!, bio: '   ' } }) })(context())).toBeNull()
        expect(createPlayerCardInjection({ state: () => record })(context({ chatId: '' }))).toBeNull()
    })

    it('injects nothing and warms the cache when the chat is not loaded, and nothing when the read throws', async () => {
        const warmed: string[] = []
        const inject = createPlayerCardInjection({ state: () => undefined, warm: async (chatId) => { warmed.push(chatId) } })
        expect(inject(context())).toBeNull()
        expect(warmed).toEqual(['c1'])
        // A warm that fails is swallowed: the next turn tries again.
        const failing = createPlayerCardInjection({ state: () => undefined, warm: async () => { throw new Error('disk') } })
        expect(failing(context())).toBeNull()
        await new Promise((r) => setTimeout(r, 0))
        expect(createPlayerCardInjection({ state: () => { throw new Error('boom') } })(context())).toBeNull()
    })
})
