import { describe, expect, it, vi } from 'vitest'

import { RelationshipStore, type RelationshipStorage } from './relationship-store.js'
import { createRelationships, relationshipLabel, type RelationshipPrefs, type RelationshipsDeps } from './relationships.js'
import { createRelationsInjection, RELATIONS_INJECTION_LABEL } from './relations-injection.js'
import { composeInjectionProviders } from './interceptor.js'
import { stateInjectionProviders } from './sysprompt-injection.js'

function fakeStorage() {
    const files = new Map<string, unknown>()
    const storage: RelationshipStorage = {
        async getJson<T>(path: string, options?: { fallback?: T; userId?: string }): Promise<T> {
            const key = `${options?.userId ?? '@self'}:${path}`
            return (files.has(key) ? files.get(key) : options?.fallback) as T
        },
        async setJson(path: string, value: unknown, options?: { userId?: string }): Promise<void> {
            files.set(`${options?.userId ?? '@self'}:${path}`, JSON.parse(JSON.stringify(value)))
        },
    }
    return storage
}

const BOOKS = [
    { id: 'b1', name: 'Vell_NPC' },
    { id: 'b2', name: 'Vell_LOC' },
    { id: 'b3', name: 'Other_NPC' },
]
const ENTRIES: Record<string, Array<{ uid: string; comment: string; key?: string[] }>> = {
    b1: [
        { uid: '1', comment: '[NPC] Marcus Vane', key: ['Marcus', 'the captain'] },
        { uid: '2', comment: 'Elena', key: ['Elena'] },
    ],
    b2: [{ uid: '7', comment: 'The Drowned Bell', key: ['bell'] }],
    // Another campaign's book: its Marcus is not this one's, and Grimble is nobody here.
    b3: [{ uid: '1', comment: 'Marcus Vane', key: [] }, { uid: '2', comment: 'Grimble', key: ['Grimble'] }],
}

function harness(over: { settings?: Record<string, unknown>; prefs?: RelationshipPrefs; messages?: Array<{ id?: string; role: string; content: string }>; deps?: Partial<RelationshipsDeps> } = {}) {
    let settings: Record<string, unknown> = { npcRelationshipBars: true, ...(over.settings ?? {}) }
    let prefs: RelationshipPrefs = { campaignNames: { c1: 'Vell' }, campaignBooks: { c1: ['Vell_NPC', 'Vell_LOC'] }, ...(over.prefs ?? {}) }
    const events: string[] = []
    const store = new RelationshipStore(fakeStorage(), { onChange: (chatId) => { events.push(chatId) } })
    const log = { info: vi.fn(), warn: vi.fn() }
    const listEntries = vi.fn(async (bookId: string) => ENTRIES[bookId] ?? [])
    const deps: RelationshipsDeps = {
        store,
        settings: { load: async () => settings, snapshot: () => settings },
        prefs: { load: async () => prefs, snapshot: () => prefs },
        books: () => ({ listBooks: async () => BOOKS, listEntries }),
        messages: async () => over.messages ?? [],
        log,
        now: () => new Date('2026-10-05T12:00:00Z'),
        ...(over.deps ?? {}),
    }
    const service = createRelationships(deps)
    return {
        service, store, log, events, listEntries,
        setSettings: (s: Record<string, unknown>) => { settings = { ...settings, ...s } },
        setPrefs: (p: RelationshipPrefs) => { prefs = { ...prefs, ...p } },
    }
}

describe('the switch and the scale', () => {
    it('is on when the cartridge says so, at the preferred scale, in the preferred mode', async () => {
        const { service, setSettings, setPrefs } = harness()
        expect(await service.enabled('u1')).toBe(true)
        expect(await service.scale('u1')).toBe(150)
        expect(await service.mode('u1')).toBe('state_tracker')
        setPrefs({ relationshipMax: 300, relationshipMode: 'regex' })
        expect(await service.scale('u1')).toBe(300)
        expect(await service.mode('u1')).toBe('regex')
        setSettings({ npcRelationshipBars: false })
        expect(await service.enabled('u1')).toBe(false)
    })

    it('drops a leading [tag] from a title', () => {
        expect(relationshipLabel('[NPC] Marcus Vane')).toBe('Marcus Vane')
        expect(relationshipLabel('  Elena ')).toBe('Elena')
    })
})

describe('the tracker half', () => {
    it('gives the tracker the command instruction in tracker mode and nothing in regex mode or off', async () => {
        const { service, setPrefs, setSettings } = harness()
        const text = await service.trackerInstruction('u1')
        expect(text).toContain('[RELATIONS]')
        expect(text).toContain('150')
        setPrefs({ relationshipMax: 200, relationshipTrackerPrompt: 'My own rule for {{max}}.' })
        expect(await service.trackerInstruction('u1')).toContain('My own rule for 200.')
        setPrefs({ relationshipMode: 'regex' })
        expect(await service.trackerInstruction('u1')).toBe('')
        setPrefs({ relationshipMode: 'state_tracker' })
        setSettings({ npcRelationshipBars: false })
        expect(await service.trackerInstruction('u1')).toBe('')
    })

    it('reads the block out of the reply in tracker mode only', async () => {
        const { service, setPrefs } = harness()
        const reply = '<memo>[TIME]\nDay 1\n[/TIME]</memo>\n[RELATIONS]\nFriendship +5 Marcus Vane\n[/RELATIONS]'
        const read = await service.extract(reply, 'u1')
        expect(read.commands).toEqual([{ npc: 'Marcus Vane', field: 'friendship', delta: 5 }])
        expect(read.memo).not.toContain('[RELATIONS]')
        setPrefs({ relationshipMode: 'regex' })
        expect(await service.extract(reply, 'u1')).toEqual({ memo: reply, commands: [] })
    })

    it('resolves names against the campaign\'s own entries, NPC books first, and names what it could not place', async () => {
        const { service, log } = harness()
        const result = await service.apply('c1', 'u1', [
            { npc: 'marcus vane', field: 'friendship', delta: 5 },
            { npc: 'the captain', field: 'affection', delta: -3 },
            { npc: 'Vell_NPC::2', field: 'friendship', delta: 2 },
            { npc: 'Nobody Here', field: 'friendship', delta: 9 },
            { npc: 'Grimble', field: 'friendship', delta: 9 },
        ], { source: 'tracker', messageId: 'm1' })
        expect(result.placed.map((p) => [p.id, p.label, p.field, p.newValue])).toEqual([
            ['Vell_NPC::1', 'Marcus Vane', 'friendship', 5],
            ['Vell_NPC::1', 'Marcus Vane', 'affection', -3],
            ['Vell_NPC::2', 'Elena', 'friendship', 2],
        ])
        // A name only another campaign's book has is nobody here: the mutation
        // check found the first version of this test asking nothing of that.
        expect(result.unmatched).toEqual(['Nobody Here', 'Grimble'])
        expect(log.warn.mock.calls[0]![0]).toContain('"Nobody Here"')
        expect(result.placed.some((p) => p.id.startsWith('Other_'))).toBe(false)
    })

    it('announces the awards it placed for the float feedback (78c): the tracker’s and the narrator’s, with the delta asked for; not the agent’s, nor a put-back', async () => {
        const floats: Array<[string, unknown, string | undefined]> = []
        const { service } = harness({ deps: { onAwards: (chatId, awards, userId) => { floats.push([chatId, awards, userId]) } } })
        await service.apply('c1', 'u1', [
            { npc: 'Marcus Vane', field: 'friendship', delta: 500 },
            { npc: 'Nobody Here', field: 'friendship', delta: 9 },
        ], { source: 'tracker', messageId: 'm1' })
        // The delta asked for, as Multihog floats `command.delta`; the clamp is the store's.
        expect(floats).toEqual([['c1', [{ npc: 'Marcus Vane', field: 'friendship', delta: 500 }], 'u1']])
        await service.apply('c1', 'u1', [], { source: 'tracker', messageId: 'm1', retrack: true })
        expect(floats).toHaveLength(1)
        await service.applyAgent('c1', 'u1', [{ id: 'Vell_NPC::2', field: 'friendship', delta: 30 }], 'm2')
        expect(floats).toHaveLength(1)
        await service.apply('c1', 'u1', [{ npc: 'Elena', field: 'affection', delta: -2 }], { source: 'narrative', messageId: 'm3' })
        expect(floats).toHaveLength(2)
        expect(floats[1]![1]).toEqual([{ npc: 'Elena', field: 'affection', delta: -2 }])
        // A listener that throws costs the pass nothing.
        const { service: loud, log } = harness({ deps: { onAwards: () => { throw new Error('boom') } } })
        const result = await loud.apply('c1', 'u1', [{ npc: 'Elena', field: 'friendship', delta: 1 }], { source: 'tracker' })
        expect(result.placed).toHaveLength(1)
        expect(log.warn.mock.calls.some((c) => String(c[0]).includes('float feedback could not be sent: boom'))).toBe(true)
    })

    it('does nothing when the system is off', async () => {
        const { service, events } = harness({ settings: { npcRelationshipBars: false } })
        expect(await service.apply('c1', 'u1', [{ npc: 'Marcus Vane', field: 'friendship', delta: 5 }], { source: 'tracker' })).toEqual({ placed: [], unmatched: [], reverted: 0 })
        expect(events).toEqual([])
    })

    it('puts back a replaced reply\'s awards on a retrack, even with nothing new to place', async () => {
        const { service, store } = harness()
        await service.apply('c1', 'u1', [{ npc: 'Marcus Vane', field: 'friendship', delta: 5 }], { source: 'tracker', messageId: 'm1' })
        const result = await service.apply('c1', 'u1', [], { source: 'tracker', messageId: 'm1', retrack: true })
        expect(result.reverted).toBe(1)
        expect((await store.load('c1', 'u1')).npcs['Vell_NPC::1']!.friendship).toBe(0)
    })
})

describe('the agent half', () => {
    it('gives the agent its section when on, expanded for the scale', async () => {
        const { service, setPrefs, setSettings } = harness()
        const section = await service.agentSection('u1')
        expect(section).toContain('rel')
        expect(section).toContain('150')
        setPrefs({ relationshipMax: 400 })
        expect(await service.agentSection('u1')).toContain('400')
        setSettings({ npcRelationshipBars: false })
        expect(await service.agentSection('u1')).toBe('')
    })

    it('reads the section from the cartridge\'s template (72c), the pin\'s when blank', async () => {
        const { service, setSettings } = harness({ settings: { routerRelSectionAgentTemplate: 'Mine: -{{max}} to +{{max}}, friends +{{p30}}.' } })
        expect(await service.agentSection('u1')).toBe('Mine: -150 to +150, friends +45.')
        setSettings({ routerRelSectionAgentTemplate: '   ' })
        expect(await service.agentSection('u1')).toContain('## NPC RELATIONSHIPS')
    })

    it('takes an address or an exact title, NPC book first, refuses a wrong axis, and names the rest', async () => {
        const { service } = harness()
        const result = await service.applyAgent('c1', 'u1', [
            { id: 'Vell_NPC::2', field: 'Friendship', delta: 30 },
            { id: 'marcus vane', field: 'affection', delta: -10 },
            { id: 'Marcus', field: 'affection', delta: 1 },
            { id: 'Elena', field: 'trust', delta: 4 },
            { id: 'Grimble', field: 'friendship', delta: 4 },
        ], 'm3')
        expect(result.placed.map((p) => [p.id, p.field, p.newValue])).toEqual([['Vell_NPC::2', 'friendship', 30], ['Vell_NPC::1', 'affection', -10]])
        expect(result.unmatched).toEqual(['Marcus', 'Elena (trust)', 'Grimble'])
        const view = await service.view('c1', 'u1')
        expect(view.npcs.map((n) => [n.label, n.friendship, n.affection, n.log[0]!.source])).toEqual([['Elena', 30, 0, 'agent'], ['Marcus Vane', 0, -10, 'agent']])
    })
})

describe('an entry the agent titled with its stamp (65-ter)', () => {
    // The writer titles a new entry `Name [msg #N]`; the agent's own starting
    // value for it names the NPC plain, in the same commit.
    const stamped = () => ({
        listBooks: async () => BOOKS,
        listEntries: async (id: string) => id === 'b1' ? [...ENTRIES.b1!, { uid: '3', comment: 'Ivo [msg #0]', key: ['Ivo'] }, { uid: '4', comment: '[NPC] Scooter [msg #0]', key: [] }] : (ENTRIES[id] ?? []),
    })

    it('is found by the agent\'s exact title, and labelled without the stamp', async () => {
        const { service } = harness({ deps: { books: () => stamped() } })
        const result = await service.applyAgent('c1', 'u1', [{ id: 'Ivo', field: 'friendship', delta: -15 }, { id: 'scooter', field: 'friendship', delta: -10 }], 'm1')
        expect(result.unmatched).toEqual([])
        expect(result.placed.map((p) => [p.id, p.label, p.newValue])).toEqual([['Vell_NPC::3', 'Ivo', -15], ['Vell_NPC::4', 'Scooter', -10]])
    })

    it('is found by the tracker\'s block too, labelled the same', async () => {
        const { service } = harness({ deps: { books: () => stamped() } })
        const result = await service.apply('c1', 'u1', [{ npc: 'Ivo', field: 'friendship', delta: 5 }], { source: 'tracker' })
        expect(result.placed.map((p) => [p.id, p.label])).toEqual([['Vell_NPC::3', 'Ivo']])
    })
})

describe('the regex half', () => {
    const MESSAGES = [
        { id: 'm1', role: 'user', content: 'I help Marcus up.' },
        { id: 'm2', role: 'assistant', content: 'He nods. *(Friendship: Marcus +10 — you helped him)* Elena scowls. (Affection: Elena -4) *(Friendship: Marcus +10 — you helped him)*' },
    ]

    it('reads the latest narrator reply in regex mode, once per tag, and ties the awards to the message', async () => {
        const { service, store } = harness({ prefs: { relationshipMode: 'regex' }, messages: MESSAGES })
        const result = await service.afterReply('c1', 'u1', 'm2', 'normal')
        expect(result!.placed.map((p) => [p.label, p.field, p.newValue])).toEqual([['Marcus Vane', 'friendship', 10], ['Elena', 'affection', -4]])
        expect((await store.load('c1', 'u1')).npcs['Vell_NPC::1']!.log[0]).toMatchObject({ source: 'narrative', messageId: 'm2' })
        // A swipe of that reply puts the awards back before reading the new text.
        const swiped = await service.afterReply('c1', 'u1', 'm2', 'swipe')
        expect(swiped!.reverted).toBe(2)
        expect((await store.load('c1', 'u1')).npcs['Vell_NPC::1']!.friendship).toBe(10)
    })

    it('stays out of the way in tracker mode, when off, and when the chat will not read', async () => {
        const { service: tracker } = harness({ messages: MESSAGES })
        expect(await tracker.afterReply('c1', 'u1', 'm2', 'normal')).toBeNull()
        const { service: off } = harness({ settings: { npcRelationshipBars: false }, prefs: { relationshipMode: 'regex' }, messages: MESSAGES })
        expect(await off.afterReply('c1', 'u1', 'm2', 'normal')).toBeNull()
        const { service: broken, log } = harness({ prefs: { relationshipMode: 'regex' }, deps: { messages: async () => { throw new Error('no chat') } } })
        expect(await broken.afterReply('c1', 'u1', 'm2', 'normal')).toBeNull()
        expect(log.warn.mock.calls[0]![0]).toContain('no chat')
    })
})

describe('the view and the hand', () => {
    it('lists every NPC with tiers, sorted by name, and sets or forgets one', async () => {
        const { service, events } = harness()
        await service.apply('c1', 'u1', [{ npc: 'Elena', field: 'friendship', delta: 120 }, { npc: 'Marcus Vane', field: 'affection', delta: -60 }], { source: 'tracker' })
        const view = await service.view('c1', 'u1')
        expect(view).toMatchObject({ enabled: true, mode: 'state_tracker', max: 150, at: '2026-10-05T12:00:00.000Z' })
        expect(view.npcs.map((n) => n.label)).toEqual(['Elena', 'Marcus Vane'])
        expect(view.npcs[0]!.friendshipTier.label).toBeTruthy()
        expect(view.npcs[0]!.friendshipTier.hint).toBeTruthy()
        expect(view.npcs[1]!.affectionTier).not.toEqual(view.npcs[0]!.affectionTier)
        const set = await service.set('c1', 'u1', 'Vell_NPC::2', 'affection', 77)
        expect(set.npcs[0]).toMatchObject({ label: 'Elena', affection: 77 })
        expect(set.npcs[0]!.log[0]).toMatchObject({ source: 'manual', newValue: 77 })
        // A hand-set for an entry with no standing yet takes the title from the book.
        const fresh = await service.set('c1', 'u1', 'Vell_LOC::7', 'friendship', 5)
        expect(fresh.npcs.find((n) => n.id === 'Vell_LOC::7')!.label).toBe('The Drowned Bell')
        // Clear Log (80): Multihog's, the history alone.
        const cleared = await service.clearLog('c1', 'u1', 'Vell_NPC::2')
        expect(cleared.npcs[0]).toMatchObject({ label: 'Elena', friendship: 120, affection: 77, log: [] })
        expect(cleared.npcs[1]!.log.length).toBeGreaterThan(0)
        const gone = await service.remove('c1', 'u1', 'Vell_NPC::2')
        expect(gone.npcs.map((n) => n.label)).toEqual(['Marcus Vane', 'The Drowned Bell'])
        expect(events.length).toBeGreaterThanOrEqual(4)
        await expect(service.set('c1', 'u1', '', 'friendship', 1)).rejects.toThrow(/entry address/)
        await expect(service.set('c1', 'u1', 'Vell_NPC::1', 'trust' as never, 1)).rejects.toThrow(/not a relationship axis/)
        await expect(service.set('c1', 'u1', 'Vell_NPC::1', 'friendship', Number.NaN)).rejects.toThrow(/needs a number/)
    })
})

describe('the narrator\'s block', () => {
    const context = (over: Record<string, unknown> = {}) => ({ userId: 'u1', chatId: 'c1', generationId: 'g1', isDryRun: false, ...over }) as never

    it('is built from memory, says the system is on when nobody is tracked, warms when unloaded, and is silent when off', async () => {
        const { service, store, setSettings } = harness()
        // Not loaded yet: nothing this turn, loaded for the next.
        expect(service.block('c1', 'u1')).toBeNull()
        await new Promise((r) => setTimeout(r, 0))
        expect(store.snapshot('c1', 'u1')).toBeDefined()
        expect(service.block('c1', 'u1')).toBe('[NPC_RELATIONS]\nNo established relationships yet.\n[/NPC_RELATIONS]')
        await service.apply('c1', 'u1', [{ npc: 'Marcus Vane', field: 'friendship', delta: 40 }], { source: 'tracker' })
        const block = service.block('c1', 'u1')!
        expect(block).toContain('Marcus Vane: Friendship +40, Affection +0')
        expect(block).toContain('Friendship tier:')
        expect(block).toContain('-150 to +150')
        expect(block).toContain('{{user}}')
        setSettings({ npcRelationshipBars: false })
        expect(service.block('c1', 'u1')).toBeNull()
    })

    it('reaches the prompt right after the player, labelled', async () => {
        const { service } = harness()
        await service.apply('c1', 'u1', [{ npc: 'Elena', field: 'affection', delta: 3 }], { source: 'tracker' })
        const relations = createRelationsInjection({ block: (chatId, userId) => service.block(chatId, userId) })
        const out = relations(context())!
        expect(out.label).toBe(RELATIONS_INJECTION_LABEL)
        expect(String(out.messages[0]!.content)).toContain('Elena: Friendship +0, Affection +3')
        expect(relations(context({ chatId: '' }))).toBeNull()
        expect(createRelationsInjection({ block: () => { throw new Error('x') } })(context())).toBeNull()
        const say = (content: string) => () => ({ messages: [{ role: 'system' as const, content }] })
        const order = composeInjectionProviders(stateInjectionProviders({ memo: say('MEMO'), sysprompt: say('RULES'), dice: say('DICE'), player: say('PLAYER'), cyoa: say('CHOICES'), relations: say('RELATIONS') }))(context())!
        expect(order.messages.map((m) => m.content)).toEqual(['RULES', 'PLAYER', 'RELATIONS', 'CHOICES', 'DICE', 'MEMO'])
    })

    it('puts the preferred scale on the rulebook\'s settings', () => {
        const { service, setPrefs } = harness()
        expect(service.rulebookSettings({ a: 1 }, 'u1')).toEqual({ a: 1, npcRelationshipMax: 150 })
        setPrefs({ relationshipMax: 500 })
        expect(service.rulebookSettings({ a: 1 }, 'u1')).toEqual({ a: 1, npcRelationshipMax: 500 })
        expect(service.rulebookSettings(null, 'u1')).toBeNull()
    })
})
