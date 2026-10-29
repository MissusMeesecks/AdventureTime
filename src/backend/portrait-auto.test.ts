import { describe, expect, it } from 'vitest'

import type { ProviderParameter } from '../tracker/library-photo.js'
import { createPortraitAuto, type PortraitAutoDeps, type PortraitAutoPrefs, type PortraitNpcEntry } from './portrait-auto.js'

const MEMO = [
    '[CHARACTER]',
    'Thessaly Brook (Rogue 3): 21/24 HP',
    '[/CHARACTER]',
    '[PARTY]',
    '- Perrin O\'Dwyer (Ranger): 12/12 HP',
    'Mother Sedge: 8/8 HP',
    '[/PARTY]',
    '[COMBAT]',
    'Combat Round 1',
    'ENEMIES:',
    'Moth Wraith (a construct): 4/10 HP',
    '[/COMBAT]',
].join('\n')

const PROVIDERS: Array<{ id: string; capabilities?: { parameters?: Record<string, ProviderParameter> } }> = [
    { id: 'swarmui', capabilities: { parameters: { width: { type: 'number' }, height: { type: 'number' } } } },
    { id: 'other', capabilities: { parameters: { size: { type: 'select', options: [{ id: '1024x1024', label: 'Square' }, { id: '832x1216', label: 'Tall' }] } } } },
]

const NPCS: PortraitNpcEntry[] = [{ name: 'Orrin', content: '[CORE]\nA smith.\n[/CORE]', keys: ['Orrin', 'smith'] }, { name: 'Mother Sedge', content: 'Keeper.', keys: ['Sedge'] }]

function harness(over: Partial<PortraitAutoDeps> & { initial?: PortraitAutoPrefs; memo?: string; portraitMap?: Record<string, string>; book?: PortraitNpcEntry[]; drawFails?: boolean } = {}) {
    const { initial = {}, memo: initialMemo = MEMO, portraitMap, book: npcList = NPCS, drawFails = false, ...rest } = over
    let prefs: PortraitAutoPrefs = { ...initial }
    let memo = initialMemo
    let portraits: Record<string, string> = { ...(portraitMap ?? {}) }
    const calls: unknown[][] = []
    const log: string[] = []
    const events: unknown[][] = []
    let tick = 0
    const deps: PortraitAutoDeps = {
        memos: { load: async () => ({ memo }) },
        settings: { load: async () => ({ portraitCharacterSystemPrompt: 'Char {{name}} in {{wordtarget}}.', portraitNpcSystemPrompt: 'NPC {{name}} in {{wordtarget}}.', portraitPromptWordTarget: 120 }) },
        prefs: { load: async () => ({ ...prefs }) },
        portraits: {
            load: async () => ({ portraits }),
            set: async (chatId, name, src) => { calls.push(['portraits.set', chatId, name, src]); portraits = { ...portraits, [name]: src } },
        },
        generate: async (system, user, chatId, userId) => { calls.push(['generate', system, user, chatId, userId]); return '  A lean ranger.  ' },
        imageGen: {
            generate: async (input) => {
                calls.push(['imageGen', input])
                if (drawFails) throw new Error('the provider is down')
                return { imageDataUrl: 'data:image/png;base64,AAAA', imageUrl: `https://host/${++tick}.png`, model: 'anima', provider: 'swarmui' }
            },
            listConnections: async () => [{ id: 'img-1', name: 'Fast', provider: 'swarmui', is_default: true, default_parameters: { width: 1024, height: 1024 } }, { id: 'img-2', name: 'Slow', provider: 'other', is_default: false, default_parameters: {} }],
            getProviders: async () => PROVIDERS,
        },
        images: { uploadFromDataUrl: async (dataUrl, options) => { calls.push(['upload', dataUrl, options]); return { url: 'https://host/stored.png' } } },
        npcs: async () => npcList,
        lore: async () => [{ label: 'Perrin', content: 'A ranger of the marches.', keys: ['Perrin', 'ranger'] }, { label: 'The Mill', content: 'Old.', keys: ['mill'] }],
        messages: async () => [{ name: 'Wrenna', text: 'Hello?' }, { name: 'Narrator', text: 'The ranger nods.' }],
        persona: async () => ({ description: 'A tired knight.' }),
        narrator: async () => ({ description: 'A grim narrator.' }),
        benchedParty: async () => true,
        events: {
            started: (chatId, userId, start) => events.push(['started', chatId, start]),
            finished: (chatId, userId, report) => events.push(['finished', report]),
        },
        log: { info: (m) => log.push(m), warn: (m) => log.push(`warn: ${m}`) },
        now: () => new Date('2026-10-15T14:32:00.000Z'),
        ...rest,
    }
    return { auto: createPortraitAuto(deps), calls, log, events, portraits: () => portraits, setMemo: (m: string) => { memo = m }, setPrefs: (p: PortraitAutoPrefs) => { prefs = p } }
}

const settle = async (rounds = 20) => { for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0)) }
const drawn = (calls: unknown[][]) => calls.filter((c) => c[0] === 'imageGen').map((c) => (c[1] as { prompt: string }).prompt && (calls[calls.indexOf(c) - 1] as unknown[])?.[0])
const names = (calls: unknown[][]) => calls.filter((c) => c[0] === 'portraits.set').map((c) => c[2])

describe('the first look and what is new (61)', () => {
    it('seeds the chat on its first check and draws nobody, then draws what appears since, each once, through one queue', async () => {
        const { auto, calls, events, log } = harness({ initial: { portraitAutoParty: true, portraitAutoPlayer: true, portraitAutoEnemies: true } })
        await auto.check('chat-1', 'u1')
        await settle()
        expect(calls).toEqual([])
        expect(log).toEqual(['portraits: chat chat-1 seen with 4 names; nothing drawn on the first look'])
        await auto.check('chat-1', 'u1')
        await settle()
        expect(calls).toEqual([])
        const h = harness({ initial: { portraitAutoParty: true, portraitAutoPlayer: true, portraitAutoEnemies: true }, memo: '[PARTY]\nMother Sedge: 8/8 HP\n[/PARTY]' })
        await h.auto.check('chat-1', 'u1')
        h.setMemo(MEMO)
        await h.auto.check('chat-1', 'u1')
        await settle()
        // The party first, then the character, then the enemies, as the legacy orders its checks; Mother Sedge was known.
        expect(names(h.calls)).toEqual(['Perrin O\'Dwyer', 'Thessaly Brook', 'Moth Wraith'])
        expect(h.events.filter((e) => e[0] === 'started').map((e) => (e[2] as { name: string; source: string; queued: number }))).toEqual([
            { name: 'Perrin O\'Dwyer (Ranger)', at: '2026-10-15T14:32:00.000Z', source: 'party', queued: 0 },
            { name: 'Thessaly Brook (Rogue 3)', at: '2026-10-15T14:32:00.000Z', source: 'player', queued: 1 },
            { name: 'Moth Wraith (a construct)', at: '2026-10-15T14:32:00.000Z', source: 'enemy', queued: 2 },
        ])
        // A second check finds nothing new.
        await h.auto.check('chat-1', 'u1')
        await settle()
        expect(names(h.calls)).toHaveLength(3)
        expect(events.length).toBe(0)
    })

    it('draws only what the switches cover, remembers the rest as seen, and skips a name with a portrait', async () => {
        const h = harness({ initial: { portraitAutoEnemies: true }, memo: '[PARTY]\n[/PARTY]', portraitMap: { 'Moth Wraith': 'https://host/rat.png' } })
        await h.auto.check('chat-1', 'u1')
        h.setMemo(MEMO)
        await h.auto.check('chat-1', 'u1')
        await settle()
        expect(names(h.calls)).toEqual([])
        // The party and the character were seen while their switches were off: ticking one later draws nobody from before.
        h.setPrefs({ portraitAutoEnemies: true, portraitAutoParty: true })
        await h.auto.check('chat-1', 'u1')
        await settle()
        expect(names(h.calls)).toEqual([])
    })

    it('with every switch off, does nothing past remembering who is there', async () => {
        const h = harness({ memo: '[PARTY]\n[/PARTY]' })
        await h.auto.check('chat-1', 'u1')
        h.setMemo(MEMO)
        await h.auto.check('chat-1', 'u1')
        await settle()
        expect(h.calls).toEqual([])
        expect(await h.auto.status('chat-1', 'u1')).toEqual({ drawing: [], queued: [], last: {} })
    })

    it('draws an NPC of the book whenever they have no portrait, from their entry, and not a party member who shares the name twice; an old title stamp is not part of the name (73a)', async () => {
        const h = harness({ initial: { portraitAutoNpcs: true, portraitAutoParty: true }, memo: '[PARTY]\n[/PARTY]', portraitMap: { Orrin: 'https://host/o.png' }, book: [{ name: 'Mother Sedge [msg #0]', content: 'Keeper.', keys: ['sedge'] }, { name: 'Orrin', content: 'x', keys: [] }, { name: '[msg #3]', content: 'nameless', keys: [] }] })
        await h.auto.check('chat-1', 'u1')
        await settle()
        expect(h.calls).toEqual([])
        await h.auto.check('chat-1', 'u1')
        await settle()
        // Mother Sedge has no portrait: drawn from the entry, once, on the NPC prompt.
        expect(names(h.calls)).toEqual(['Mother Sedge'])
        const generate = h.calls.find((c) => c[0] === 'generate')!
        expect(generate[1]).toBe('NPC Mother Sedge in 120.')
        expect(generate[2]).toBe('NPC Name: Mother Sedge\n\n---\n\nNPC Lorebook Entry:\nKeeper.')
        expect(h.events.find((e) => e[0] === 'started')![2]).toMatchObject({ source: 'npc' })
        // Now in the party too, beside Perrin who is new: her portrait is there, so only Perrin is drawn.
        h.setMemo(MEMO)
        await h.auto.check('chat-1', 'u1')
        await settle()
        expect(names(h.calls)).toEqual(['Mother Sedge', 'Perrin O\'Dwyer'])
    })
})

describe('the draw itself (61)', () => {
    it('writes the character prompt over the memo and the card, asks the portrait connection for 2:3 nearest its size, keeps the address under the normalized name, logs and reports', async () => {
        const h = harness({ initial: { portraitAutoParty: true, portraitConnectionId: 'img-1' }, memo: '[PARTY]\n[/PARTY]' })
        await h.auto.check('chat-1', 'u1')
        h.setMemo(MEMO)
        await h.auto.check('chat-1', 'u1')
        await settle()
        const generate = h.calls.find((c) => c[0] === 'generate')!
        expect(generate[1]).toBe('Char Perrin O\'Dwyer (Ranger) in 120.')
        expect(generate[2]).toBe([
            'Character Name: Perrin O\'Dwyer (Ranger)',
            '[PARTY] block (from State Memo):\n- Perrin O\'Dwyer (Ranger): 12/12 HP\nMother Sedge: 8/8 HP',
            'Character Card Description:\nA grim narrator.',
        ].join('\n\n---\n\n'))
        expect(generate[3]).toBe('chat-1')
        const draw = h.calls.find((c) => c[0] === 'imageGen')!
        expect(draw[1]).toEqual({ prompt: 'A lean ranger.', connection_id: 'img-1', parameters: { width: 896, height: 1344 }, owner_chat_id: 'chat-1', userId: 'u1' })
        expect(h.calls.find((c) => c[0] === 'portraits.set')).toEqual(['portraits.set', 'chat-1', 'Perrin O\'Dwyer', 'https://host/1.png'])
        expect(h.log).toContain('portraits: queued "Perrin O\'Dwyer (Ranger)" for chat chat-1 (party)')
        expect(h.log).toContain('portraits: queued "Mother Sedge" for chat chat-1 (party, 1 ahead)')
        expect(h.log).toContain('portraits: drawing "Perrin O\'Dwyer (Ranger)" for chat chat-1 (party) on "Fast" at 896×1344')
        expect(h.log).toContain('portraits: "Perrin O\'Dwyer (Ranger)" drawn by swarmui (anima), 896×1344 for chat chat-1')
        expect(h.events.find((e) => e[0] === 'finished')![1]).toEqual({ chatId: 'chat-1', name: 'Perrin O\'Dwyer (Ranger)', at: '2026-10-15T14:32:00.000Z', source: 'party', outcome: 'drawn', prompt: 'A lean ranger.', provider: 'swarmui', model: 'anima', size: '896×1344' })
    })

    it('falls back to the scene picture’s connection, then the host’s default; a listed size nearest 2:3 on a provider without sides; stores data it was handed', async () => {
        const h = harness({
            initial: { portraitAutoEnemies: true, scenePictureConnectionId: 'img-2' },
            memo: '[COMBAT]\n[/COMBAT]',
            imageGen: {
                generate: async (input) => { h.calls.push(['imageGen', input]); return { imageDataUrl: 'data:image/png;base64,AAAA', model: 'm', provider: 'other' } },
                listConnections: async () => [{ id: 'img-1', name: 'Fast', provider: 'swarmui', is_default: true, default_parameters: { width: 1024, height: 1024 } }, { id: 'img-2', name: 'Slow', provider: 'other', is_default: false, default_parameters: {} }],
                getProviders: async () => PROVIDERS.slice(1),
            },
        })
        await h.auto.check('chat-1', 'u1')
        h.setMemo(MEMO)
        await h.auto.check('chat-1', 'u1')
        await settle()
        expect(h.calls.find((c) => c[0] === 'imageGen')![1]).toEqual({ prompt: 'A lean ranger.', connection_id: 'img-2', parameters: { size: '832x1216' }, owner_chat_id: 'chat-1', userId: 'u1' })
        expect(h.calls.find((c) => c[0] === 'upload')).toEqual(['upload', 'data:image/png;base64,AAAA', { originalFilename: 'portrait-Moth_Wraith.png', owner_chat_id: 'chat-1', userId: 'u1' }])
        expect(h.portraits()).toEqual({ 'Moth Wraith': 'https://host/stored.png' })

        const none = harness({ initial: { portraitAutoEnemies: true }, memo: '[COMBAT]\n[/COMBAT]' })
        await none.auto.check('chat-1', 'u1')
        none.setMemo(MEMO)
        await none.auto.check('chat-1', 'u1')
        await settle()
        expect(none.calls.find((c) => c[0] === 'imageGen')![1]).toEqual({ prompt: 'A lean ranger.', parameters: { width: 896, height: 1344 }, owner_chat_id: 'chat-1', userId: 'u1' })
    })

    it('with the story lookback on, adds the persona, the lore whose keywords meet the name, the game state and the last N messages; an NPC gets its own three', async () => {
        const h = harness({ initial: { portraitAutoParty: true, portraitAutoNpcs: true, portraitStoryLookback: true, portraitStoryLookbackCount: 1 }, memo: '[PARTY]\n[/PARTY]', book: [NPCS[0]!] })
        await h.auto.check('chat-1', 'u1')
        h.setMemo(MEMO)
        await h.auto.check('chat-1', 'u1')
        await settle()
        const generates = h.calls.filter((c) => c[0] === 'generate')
        expect((generates[0]![2] as string).split('\n\n---\n\n').slice(3)).toEqual([
            'User Persona:\nA tired knight.',
            'Matching Lorebook Entries:\n[Lorebook: Perrin]\nA ranger of the marches.',
            `Current Game State:\n${MEMO}`,
            'Recent Chat Context (Last 1 Message):\nNarrator: The ranger nods.',
        ])
        // Orrin: the NPC prompt's lookback — the persona for art style, the card for the world, the recent scene.
        expect((generates[2]![2] as string).split('\n\n---\n\n').slice(2)).toEqual([
            'User Persona (for art style context):\nA tired knight.',
            'Narrator Card Description (for world context):\nA grim narrator.',
            'Recent Scene Context (Last 1 Message):\nNarrator: The ranger nods.',
        ])
    })

    it('reports a failure, keeps the name from being tried again on its own until a switch is ticked, and goes on with the queue', async () => {
        const h = harness({ initial: { portraitAutoParty: true, portraitAutoEnemies: true }, memo: '[PARTY]\n[/PARTY]', drawFails: true })
        await h.auto.check('chat-1', 'u1')
        h.setMemo(MEMO)
        await h.auto.check('chat-1', 'u1')
        await settle()
        const finished = h.events.filter((e) => e[0] === 'finished').map((e) => e[1] as { name: string; outcome: string; reason?: string })
        expect(finished).toEqual([
            { chatId: 'chat-1', name: 'Perrin O\'Dwyer (Ranger)', at: '2026-10-15T14:32:00.000Z', source: 'party', outcome: 'failed', reason: 'the provider is down' },
            { chatId: 'chat-1', name: 'Mother Sedge', at: '2026-10-15T14:32:00.000Z', source: 'party', outcome: 'failed', reason: 'the provider is down' },
            { chatId: 'chat-1', name: 'Moth Wraith (a construct)', at: '2026-10-15T14:32:00.000Z', source: 'enemy', outcome: 'failed', reason: 'the provider is down' },
        ])
        expect(h.log).toContain('warn: portraits: "Perrin O\'Dwyer (Ranger)" could not be drawn (party): the provider is down')
        expect(h.portraits()).toEqual({})
        const before = h.calls.filter((c) => c[0] === 'imageGen').length
        // The next check leaves them be; the status says what happened.
        await h.auto.check('chat-1', 'u1')
        await settle()
        expect(h.calls.filter((c) => c[0] === 'imageGen')).toHaveLength(before)
        const status = await h.auto.status('chat-1', 'u1')
        expect(status.last['Perrin O\'Dwyer']).toMatchObject({ outcome: 'failed', reason: 'the provider is down' })
        expect(status.last['Moth Wraith']).toMatchObject({ outcome: 'failed' })
        // A tick (force) tries everyone it covers again.
        await h.auto.force('chat-1', 'u1')
        await settle()
        expect(h.calls.filter((c) => c[0] === 'imageGen')).toHaveLength(before + 3)
    })

    it('an NPC whose draw failed on its own is left alone by the next checks, and tried again by a tick', async () => {
        // The departure from the legacy, which retries every check: an NPC is never gated by the known list, so a
        // provider down would be called once per reply for every NPC of the book.
        const h = harness({ initial: { portraitAutoNpcs: true }, memo: '[PARTY]\n[/PARTY]', book: [NPCS[0]!], drawFails: true })
        await h.auto.check('chat-1', 'u1')
        await h.auto.check('chat-1', 'u1')
        await settle()
        expect(h.calls.filter((c) => c[0] === 'imageGen')).toHaveLength(1)
        await h.auto.check('chat-1', 'u1')
        await h.auto.check('chat-1', 'u1')
        await settle()
        expect(h.calls.filter((c) => c[0] === 'imageGen')).toHaveLength(1)
        await h.auto.force('chat-1', 'u1')
        await settle()
        expect(h.calls.filter((c) => c[0] === 'imageGen')).toHaveLength(2)
    })

    it('says so when the grant is missing, and when the cartridge has no prompt', async () => {
        const h = harness({ initial: { portraitAutoParty: true }, memo: '[PARTY]\n[/PARTY]', imageGen: undefined })
        await h.auto.check('chat-1', 'u1')
        h.setMemo(MEMO)
        await h.auto.check('chat-1', 'u1')
        await settle()
        expect(h.events.find((e) => e[0] === 'finished')![1]).toMatchObject({ outcome: 'failed', reason: 'This build cannot draw portraits: the host has not granted the image_gen permission.' })
        const bare = harness({ initial: { portraitAutoParty: true }, memo: '[PARTY]\n[/PARTY]', settings: { load: async () => ({}) } })
        await bare.auto.check('chat-1', 'u1')
        bare.setMemo(MEMO)
        await bare.auto.check('chat-1', 'u1')
        await settle()
        expect(bare.events.find((e) => e[0] === 'finished')![1]).toMatchObject({ outcome: 'failed', reason: 'The cartridge has no character portrait prompt (portraitCharacterSystemPrompt).' })
    })
})

describe('a tick, a press and the status (61)', () => {
    it('force draws everyone the switches cover now, the known list notwithstanding, and seeds the chat', async () => {
        const h = harness({ initial: { portraitAutoParty: true, portraitAutoPlayer: true } })
        await h.auto.force('chat-1', 'u1')
        await settle()
        expect(names(h.calls)).toEqual(['Perrin O\'Dwyer', 'Mother Sedge', 'Thessaly Brook'])
        // Seeded by the force: a later check draws nothing again.
        await h.auto.check('chat-1', 'u1')
        await settle()
        expect(names(h.calls)).toHaveLength(3)
    })

    it('draws one name on a press whatever the switches say, a portrait there or not, an NPC of the book from the entry, and returns the draw', async () => {
        const h = harness({ portraitMap: { 'Mother Sedge': 'https://host/old.png' } })
        const result = await h.auto.draw('chat-1', 'u1', ' Mother Sedge ')
        expect(result).toEqual({ name: 'Mother Sedge', at: '2026-10-15T14:32:00.000Z', prompt: 'A lean ranger.', provider: 'swarmui', model: 'anima', size: '896×1344' })
        expect(h.calls.find((c) => c[0] === 'generate')![1]).toBe('NPC Mother Sedge in 120.')
        expect(h.portraits()).toEqual({ 'Mother Sedge': 'https://host/1.png' })
        expect(h.events.find((e) => e[0] === 'started')![2]).toMatchObject({ source: 'pressed', queued: 0 })
        const other = await h.auto.draw('chat-1', 'u1', 'Moth Wraith (a construct)')
        expect(other.name).toBe('Moth Wraith')
        expect(h.calls.filter((c) => c[0] === 'generate')[1]![1]).toBe('Char Moth Wraith in 120.')
        await expect(h.auto.draw('chat-1', 'u1', '  ')).rejects.toThrow(/needs a name/)
    })

    it('writes the prompt on its own (73f), queuing and announcing nothing, and a press with an edited prompt draws it without writing one', async () => {
        const h = harness({ portraitMap: {} })
        expect(await h.auto.prompt('chat-1', 'u1', ' Mother Sedge ')).toEqual({ name: 'Mother Sedge', prompt: 'A lean ranger.' })
        expect(h.calls.filter((c) => c[0] === 'generate')).toHaveLength(1)
        expect(h.calls.find((c) => c[0] === 'generate')![1]).toBe('NPC Mother Sedge in 120.')
        expect(h.calls.some((c) => c[0] === 'imageGen')).toBe(false)
        expect(h.events).toEqual([])
        expect(h.portraits()).toEqual({})
        const result = await h.auto.draw('chat-1', 'u1', 'Mother Sedge', '  A grey witch of the marsh.  ')
        expect(h.calls.filter((c) => c[0] === 'generate')).toHaveLength(1)
        expect((h.calls.find((c) => c[0] === 'imageGen')![1] as { prompt: string }).prompt).toBe('A grey witch of the marsh.')
        expect(result.prompt).toBe('A grey witch of the marsh.')
        expect(h.portraits()).toEqual({ 'Mother Sedge': 'https://host/1.png' })
        await expect(h.auto.prompt('chat-1', 'u1', '  ')).rejects.toThrow(/needs a name/)
    })

    it('a press that fails rejects with the reason, and the name may be pressed again', async () => {
        const h = harness({ drawFails: true })
        await expect(h.auto.draw('chat-1', 'u1', 'Orrin')).rejects.toThrow('the provider is down')
        await expect(h.auto.draw('chat-1', 'u1', 'Orrin')).rejects.toThrow('the provider is down')
        expect(h.calls.filter((c) => c[0] === 'imageGen')).toHaveLength(2)
    })

    it('refuses a press for a name already in flight, and the status names what is drawing and queued for the chat alone', async () => {
        let release: () => void = () => undefined
        const h = harness({
            generate: async () => { await new Promise<void>((resolve) => { release = resolve }); return 'A face.' },
        })
        const first = h.auto.draw('chat-1', 'u1', 'Orrin')
        const second = h.auto.draw('chat-1', 'u1', 'Kestrel')
        const elsewhere = h.auto.draw('chat-2', 'u1', 'Yorick')
        await settle(2)
        await expect(h.auto.draw('chat-1', 'u1', 'orrin')).rejects.toThrow(/already being drawn/)
        expect(await h.auto.status('chat-1', 'u1')).toEqual({ drawing: [{ name: 'Orrin', at: '2026-10-15T14:32:00.000Z' }], queued: ['Kestrel'], last: {} })
        expect(await h.auto.status('chat-2', 'u1')).toMatchObject({ drawing: [], queued: ['Yorick'] })
        release()
        await settle(2)
        release()
        await settle(2)
        release()
        await Promise.all([first, second, elsewhere])
        expect(names(h.calls)).toEqual(['Orrin', 'Kestrel', 'Yorick'])
        const status = await h.auto.status('chat-1', 'u1')
        expect(status.drawing).toEqual([])
        expect(status.queued).toEqual([])
        expect(Object.keys(status.last).sort()).toEqual(['Kestrel', 'Orrin'])
    })

    it('the status is the panel’s first look: it seeds the chat, so the next check draws nothing from before', async () => {
        const h = harness({ initial: { portraitAutoParty: true } })
        expect(await h.auto.status('chat-1', 'u1')).toEqual({ drawing: [], queued: [], last: {} })
        await h.auto.check('chat-1', 'u1')
        await settle()
        expect(h.calls).toEqual([])
    })
})
