import { describe, expect, it } from 'vitest'

import { createPlayerCard, type PlayerCardDeps } from './player-card.js'
import { PlayerCardStore } from './player-card-store.js'

const SHEET = '[CHARACTER]\nRobin Vale (Rogue 3): 22/24 HP\n[/CHARACTER]'

function harness(over: Partial<PlayerCardDeps> = {}, reply = 'Species: Halfling\nBody: Short, scarred.\nWorn Equipment: A duster.\nPersonality: Wry.') {
    const files = new Map<string, unknown>()
    const store = new PlayerCardStore({ getJson: async <T,>(p: string, o?: { fallback?: T }) => (files.has(p) ? (files.get(p) as T) : (o?.fallback as T)), setJson: async (p, v) => { files.set(p, v) } })
    const calls: Array<{ system: string; user: string; chatId: string; connectionId: string | undefined }> = []
    const log: string[] = []
    const personas = { list: [] as Array<{ id: string; name: string }>, created: [] as string[], active: '' as string, described: '' }
    const deps: PlayerCardDeps = {
        store,
        memos: { load: async () => ({ memo: SHEET }) },
        settings: { load: async () => ({ pcCoreSections: [], directPromptContext: 3 }) },
        prefs: { load: async () => ({ creatorConnectionId: 'creator-conn', creatorCardWords: 200 }) },
        generate: async (messages, chatId, _userId, connectionId) => { calls.push({ system: messages[0]!.content, user: messages[1]!.content, chatId, connectionId }); return reply },
        story: async (_chatId, _userId, lookback) => Array.from({ length: lookback }, (_, i) => ({ user: i % 2 === 1, name: i % 2 === 1 ? 'Player' : 'Narrator', text: `line ${i}` })),
        personas: {
            list: async () => personas.list,
            create: async (name) => { personas.created.push(name); const p = { id: `p${personas.created.length}`, name }; personas.list.push(p); return p },
            switchActive: async (id) => { personas.active = id },
            getActive: async () => { const p = personas.list.find((p) => p.id === personas.active); return p ? { ...p, description: personas.described } : null },
        },
        log: { info: (m) => log.push(m), warn: (m) => log.push(`warn: ${m}`) },
        now: () => new Date('2026-10-04T10:00:00Z'),
        ...over,
    }
    return { service: createPlayerCard(deps), store, calls, log, personas, files }
}

describe('writing the Player Card', () => {
    it('names the character from the sheet, builds the legacy\'s prompt over the memo and the story, runs it on the creator\'s connection, and keeps the card', async () => {
        const { service, calls, log, store } = harness()
        const result = await service.write({ chatId: 'c1', userId: 'u1' })
        expect(result).toEqual({ status: 'written', at: '2026-10-04T10:00:00.000Z', name: 'Robin Vale', words: 11 })
        expect(calls).toHaveLength(1)
        expect(calls[0]!.connectionId).toBe('creator-conn')
        expect(calls[0]!.system).toContain('write a persona description for Robin Vale in third person.')
        expect(calls[0]!.system).toContain('approximately 200 words')
        expect(calls[0]!.user).toContain('CHARACTER CARD:\n[CHARACTER]\nRobin Vale (Rogue 3): 22/24 HP\n[/CHARACTER]')
        expect(calls[0]!.user).toContain('## RECENT STORY (Last 3 messages)\nNarrator: line 0\n\nPlayer: line 1\n\nNarrator: line 2')
        const record = await store.load('c1', 'u1')
        expect(record.card).toEqual({ name: 'Robin Vale', bio: 'Species: Halfling\nBody: Short, scarred.\nWorn Equipment: A duster.\nPersonality: Wry.', wordCount: 200, at: '2026-10-04T10:00:00.000Z' })
        expect(log).toEqual(['creator: writing the Player Card for "Robin Vale" (200 words, 3 story lines)', 'creator: Player Card written for "Robin Vale" (11 words)'])
        // The view says what is kept, and whether personas can be made.
        expect(await service.view('c1', 'u1')).toEqual({ card: record.card, persona: null, personasAvailable: true, activePersona: '', activeDescribed: false })
    })

    it('takes the name and words given, cleans the name, carries the hints, and falls back to the agent\'s connection and fifteen lines', async () => {
        const { service, calls } = harness({ prefs: { load: async () => ({ creatorConnectionId: '', creatorCardWords: 150 }) }, settings: { load: async () => ({}) } })
        const result = await service.write({ chatId: 'c1', userId: 'u1', name: 'Mara "the Knife"', words: 300, extraHints: '\n\n--- HINTS ---\nwry', preferCharacterBlock: true })
        expect(result).toMatchObject({ status: 'written', name: 'Mara the Knife' })
        expect(calls[0]!.connectionId).toBeUndefined()
        expect(calls[0]!.system).toContain('for Mara the Knife in third person.\n\n--- HINTS ---\nwry')
        expect(calls[0]!.system).toContain('approximately 300 words')
        expect(calls[0]!.user).toContain('(Last 15 messages)')
        // A window of zero is no window: the legacy's fifteen.
        const zero = harness({ settings: { load: async () => ({ directPromptContext: 0 }) } })
        await zero.service.write({ chatId: 'c1', userId: 'u1' })
        expect(zero.calls[0]!.user).toContain('(Last 15 messages)')
        // No name anywhere: the legacy's "My Character".
        const nameless = harness({ memos: { load: async () => ({ memo: '' }) } })
        expect((await nameless.service.write({ chatId: 'c1', userId: 'u1' })).name).toBe('My Character')
    })

    it('fails without keeping anything when the model answers nothing or the call throws', async () => {
        const empty = harness({}, '   ')
        expect(await empty.service.write({ chatId: 'c1', userId: 'u1' })).toEqual({ status: 'failed', at: '2026-10-04T10:00:00.000Z', name: 'Robin Vale', reason: 'Persona generation returned empty.' })
        expect((await empty.store.load('c1', 'u1')).card).toBeNull()
        expect(empty.log.at(-1)).toBe('warn: creator: the Player Card for "Robin Vale" came back empty')
        const threw = harness({ generate: async () => { throw new Error('500') } })
        expect(await threw.service.write({ chatId: 'c1', userId: 'u1' })).toMatchObject({ status: 'failed', reason: '500' })
        expect(threw.log.at(-1)).toBe('warn: creator: the Player Card could not be written: 500')
    })

    it('saves an edited card as given, removes it when saved empty or asked, and keeps the word count it was written at', async () => {
        const { service, store, log } = harness()
        await service.write({ chatId: 'c1', userId: 'u1' })
        expect(await service.save({ chatId: 'c1', userId: 'u1', name: ' Robin "Vale" ', bio: '  Body: tall.  ' })).toEqual({ status: 'written', at: '2026-10-04T10:00:00.000Z', name: 'Robin Vale', words: 2 })
        expect((await store.load('c1', 'u1')).card).toEqual({ name: 'Robin Vale', bio: 'Body: tall.', wordCount: 200, at: '2026-10-04T10:00:00.000Z' })
        expect(await service.save({ chatId: 'c1', userId: 'u1', name: '', bio: '  ' })).toEqual({ status: 'removed', at: '2026-10-04T10:00:00.000Z', name: 'My Character' })
        expect((await store.load('c1', 'u1')).card).toBeNull()
        expect(await service.save({ chatId: 'c1', userId: 'u1', name: '', bio: 'Pasted.' })).toMatchObject({ status: 'written', name: 'My Character' })
        expect((await store.load('c1', 'u1')).card?.wordCount).toBe(150)
        await service.remove('c1', 'u1')
        expect((await store.load('c1', 'u1')).card).toBeNull()
        expect(log.at(-1)).toBe('creator: Player Card removed for chat c1')
    })
})

describe('the persona', () => {
    it('finds a persona of the character\'s name or creates one, makes it active, and remembers it', async () => {
        const { service, personas, store, log } = harness()
        expect(await service.persona({ chatId: 'c1', userId: 'u1' })).toEqual({ status: 'active', at: '2026-10-04T10:00:00.000Z', name: 'Robin Vale', id: 'p1', created: true })
        expect(personas.created).toEqual(['Robin Vale'])
        expect(personas.active).toBe('p1')
        expect((await store.load('c1', 'u1')).persona).toEqual({ id: 'p1', name: 'Robin Vale', at: '2026-10-04T10:00:00.000Z' })
        expect(log.at(-1)).toBe('creator: persona "Robin Vale" created and made active (p1)')
        // The same name, whatever the case and spacing, is found rather than made again.
        personas.active = ''
        expect(await service.persona({ chatId: 'c1', userId: 'u1', name: '  robin vale ' })).toMatchObject({ status: 'active', created: false, name: 'Robin Vale' })
        expect(personas.created).toEqual(['Robin Vale'])
        expect(personas.active).toBe('p1')
        expect((await service.view('c1', 'u1')).activePersona).toBe('Robin Vale')
        expect((await service.view('c1', 'u1')).activeDescribed).toBe(false)
        personas.described = '  A prince.  '
        expect((await service.view('c1', 'u1')).activeDescribed).toBe(true)
    })

    it('says so when the host has not granted the permission, or the call fails', async () => {
        const none = harness({ personas: undefined })
        expect(await none.service.persona({ chatId: 'c1', userId: 'u1' })).toEqual({ status: 'failed', at: '2026-10-04T10:00:00.000Z', name: 'Robin Vale', reason: 'the host has not granted the personas permission, so no persona can be made' })
        expect((await none.service.view('c1', 'u1')).personasAvailable).toBe(false)
        const failing = harness({ personas: { list: async () => { throw new Error('PERMISSION_DENIED') }, create: async () => { throw new Error('x') }, switchActive: async () => undefined, getActive: async () => { throw new Error('x') } } })
        expect(await failing.service.persona({ chatId: 'c1', userId: 'u1' })).toMatchObject({ status: 'failed', reason: 'PERMISSION_DENIED' })
        expect(failing.log.at(-1)).toBe('warn: creator: the persona for "Robin Vale" could not be made active: PERMISSION_DENIED')
        expect((await failing.service.view('c1', 'u1')).activePersona).toBe('')
    })
})

describe('the agent\'s patch', () => {
    it('changes Body or Worn Equipment of the card and nothing else, and knows the card\'s name', async () => {
        const { service, store, log } = harness()
        expect(await service.name('c1', 'u1')).toBe('')
        expect(await service.patch('c1', 'u1', 'Body', 'Tall now.')).toEqual({ ok: false, reason: 'No Player Character card linked' })
        await service.write({ chatId: 'c1', userId: 'u1' })
        expect(await service.name('c1', 'u1')).toBe('Robin Vale')
        expect(await service.patch('c1', 'u1', 'Body', 'Tall now.')).toEqual({ ok: true })
        expect((await store.load('c1', 'u1')).card?.bio).toBe('Species: Halfling\nBody: Tall now.\nWorn Equipment: A duster.\nPersonality: Wry.')
        expect(await service.patch('c1', 'u1', 'equipment', 'A cloak.')).toEqual({ ok: true })
        expect((await store.load('c1', 'u1')).card?.bio).toContain('Worn Equipment: A cloak.')
        expect(await service.patch('c1', 'u1', 'Personality', 'Grim.')).toEqual({ ok: false, reason: 'PC updates are limited to Body and Worn Equipment' })
        expect((await store.load('c1', 'u1')).card?.bio).toContain('Personality: Wry.')
        expect(log.at(-1)).toBe('creator: the agent updated the Player Card\'s equipment for "Robin Vale"')
    })
})
