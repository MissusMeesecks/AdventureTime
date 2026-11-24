import { describe, expect, it } from 'vitest'

import { COMPANION_ACTIONS_UNAVAILABLE, COMPANION_BUSY, COMPANION_NO_PENDING, companionPath, createCompanion, declinedTurnMessage, type CompanionActions, type CompanionPrefs, type CompanionSources } from './companion.js'
import { COMPANION_INCOMPLETE_MESSAGE, COMPANION_LIMIT_MESSAGE, COMPANION_NO_SUMMARY_MESSAGE, type CompanionActionResult } from '../tracker/companion.js'
import { COMPANION_DOC_OPEN, COMPANION_HISTORY_LIMIT, COMPANION_MAP_FAILED, COMPANION_MAP_OUTSIDE, COMPANION_MESSAGE_MAX } from '../tracker/companion.js'

const GUIDE = '# The lantern guide\n\nPress the brass lantern to rest.\n'

const STORY = [
    { role: 'user', content: 'I knock on the mill door.' },
    { role: 'assistant', content: 'A shutter opens.' },
    { role: 'user', content: 'I ask for the miller.' },
    { role: 'assistant', content: 'The miller squints at you.' },
]
const SOURCES: CompanionSources = {
    messages: async () => STORY,
    memo: async () => ({ memo: '[CHARACTER]\nRobin Vale\nHP: ((BAR)) 12/20\n[/CHARACTER]' }),
    lore: async () => [{ title: 'Old Pell', content: 'Keeps the toll gate.' }],
    map: async () => 'Mill Yard (you are here)\nUnexplored: the loft',
}
const system = (call: Record<string, unknown>): string => (call.messages as Array<{ content: string }>)[0]!.content

function harness(options: { prefs?: CompanionPrefs; sources?: Partial<CompanionSources>; reply?: (call: Record<string, unknown>) => unknown | Promise<unknown>; files?: Record<string, unknown> } = {}) {
    const files = new Map<string, unknown>(Object.entries(options.files ?? {}))
    const calls: Array<Record<string, unknown>> = []
    const logs: string[] = []
    const prefs = { ...(options.prefs ?? {}) }
    let tick = 0
    const companion = createCompanion({
        generate: {
            quiet: async (input) => {
                calls.push(input)
                return options.reply ? options.reply(input) : { content: 'Press the brass lantern.' }
            },
        },
        storage: {
            getJson: async <T,>(path: string, o?: { fallback?: T; userId?: string }) => (files.has(`${o?.userId ?? '@self'}:${path}`) ? files.get(`${o?.userId ?? '@self'}:${path}`) as T : o?.fallback as T),
            setJson: async (path, value, o) => { files.set(`${o?.userId ?? '@self'}:${path}`, JSON.parse(JSON.stringify(value))) },
        },
        prefs: { load: async () => prefs },
        guide: GUIDE,
        ...(options.sources ? { sources: { ...SOURCES, ...options.sources } } : {}),
        log: { info: (m) => logs.push(m), warn: (m) => logs.push(`warn: ${m}`) },
        now: () => `2031-01-01T00:00:0${tick++}.000Z`,
    })
    return { companion, calls, logs, files, prefs }
}

describe('the Adventure Companion', () => {
    it('starts with an empty conversation, the guide attached and its cost named', async () => {
        const h = harness()
        expect(await h.companion.get('chat-1', 'u1')).toEqual({ chatId: 'chat-1', messages: [], busy: false, guideAttached: true, guideTokens: 0, pending: null })
        expect(h.calls).toHaveLength(0)
    })

    it('answers on its own connection with the guide in the system prompt, and keeps both messages with the chat', async () => {
        const h = harness({ prefs: { companionConnectionId: 'conn-small' } })
        const state = await h.companion.send('chat-1', 'u1', '  How do I rest?  ')
        expect(state.messages.map((m) => [m.role, m.content])).toEqual([['user', 'How do I rest?'], ['assistant', 'Press the brass lantern.']])
        expect(state.busy).toBe(false)
        expect(h.calls[0]).toMatchObject({ userId: 'u1', chatId: 'chat-1', connection_id: 'conn-small' })
        const messages = h.calls[0]!.messages as Array<{ role: string; content: string }>
        expect(messages[0]!.role).toBe('system')
        expect(messages[0]!.content).toContain(`${COMPANION_DOC_OPEN}\n${GUIDE.trim()}`)
        expect(messages.slice(1)).toEqual([{ role: 'user', content: 'How do I rest?' }])
        expect(h.files.get(`u1:${companionPath('chat-1')}`)).toMatchObject({ version: 1, messages: [{ role: 'user', content: 'How do I rest?' }, { role: 'assistant', content: 'Press the brass lantern.' }] })
        // Another chat has its own conversation, and so has another user.
        expect((await h.companion.get('chat-2', 'u1')).messages).toEqual([])
        expect((await h.companion.get('chat-1', 'u2')).messages).toEqual([])
        expect((await h.companion.get('chat-1', 'u1')).messages).toHaveLength(2)
    })

    it('names no connection when its row is blank, so the narrator’s is used', async () => {
        const h = harness()
        await h.companion.send('chat-1', 'u1', 'Hello')
        expect(h.calls[0]).not.toHaveProperty('connection_id')
    })

    it('sends no guide while the install’s preference is off, in any chat, and says so', async () => {
        const h = harness({ prefs: { companionGuide: false } })
        const a = await h.companion.send('chat-1', 'u1', 'Hello')
        const b = await h.companion.send('chat-2', 'u1', 'Hello again')
        expect(a.guideAttached).toBe(false)
        expect(b.guideAttached).toBe(false)
        for (const call of h.calls) expect((call.messages as Array<{ content: string }>)[0]!.content).not.toContain(COMPANION_DOC_OPEN)
        expect(h.logs.some((line) => line.includes('without the guide'))).toBe(true)
        h.prefs.companionGuide = true
        await h.companion.send('chat-1', 'u1', 'And now?')
        expect((h.calls[2]!.messages as Array<{ content: string }>)[0]!.content).toContain(COMPANION_DOC_OPEN)
    })

    it('sends the conversation so far with each new message', async () => {
        const h = harness()
        await h.companion.send('chat-1', 'u1', 'First')
        await h.companion.send('chat-1', 'u1', 'Second')
        expect((h.calls[1]!.messages as Array<{ role: string; content: string }>).slice(1).map((m) => m.content)).toEqual(['First', 'Press the brass lantern.', 'Second'])
    })

    it('keeps no more than the limit, the oldest dropped', async () => {
        const stored = Array.from({ length: COMPANION_HISTORY_LIMIT }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}`, at: '' }))
        const h = harness({ files: { [`u1:${companionPath('chat-1')}`]: { version: 1, messages: stored } } })
        const state = await h.companion.send('chat-1', 'u1', 'One more')
        expect(state.messages).toHaveLength(COMPANION_HISTORY_LIMIT)
        expect(state.messages[0]!.content).toBe('m2')
        expect(state.messages.at(-1)!.content).toBe('Press the brass lantern.')
    })

    it('refuses an empty message and one too long, calling no model', async () => {
        const h = harness()
        await expect(h.companion.send('chat-1', 'u1', '   ')).rejects.toThrow('Type a message for the Companion first.')
        await expect(h.companion.send('chat-1', 'u1', 'x'.repeat(COMPANION_MESSAGE_MAX + 1))).rejects.toThrow('too long')
        expect(h.calls).toHaveLength(0)
    })

    it('takes the player’s message back when the call fails, so a retry does not send it twice', async () => {
        let fail = true
        const h = harness({ reply: () => { if (fail) throw new Error('no connection'); return 'Fine now.' } })
        await expect(h.companion.send('chat-1', 'u1', 'Hello')).rejects.toThrow('The Companion could not answer: no connection')
        expect((await h.companion.get('chat-1', 'u1')).messages).toEqual([])
        expect((await h.companion.get('chat-1', 'u1')).busy).toBe(false)
        fail = false
        const state = await h.companion.send('chat-1', 'u1', 'Hello')
        expect(state.messages.map((m) => m.content)).toEqual(['Hello', 'Fine now.'])
    })

    it('treats an empty reply as a failure and keeps nothing of the exchange', async () => {
        const h = harness({ reply: () => ({ content: '   ' }) })
        await expect(h.companion.send('chat-1', 'u1', 'Hello')).rejects.toThrow('reply was empty')
        expect((await h.companion.get('chat-1', 'u1')).messages).toEqual([])
    })

    it('answers one message at a time per chat, reports busy meanwhile, and lets another chat through', async () => {
        let release: (value: unknown) => void = () => {}
        let held = true
        const h = harness({ reply: () => (held ? new Promise((resolve) => { release = resolve }) : 'Quick.') })
        const first = h.companion.send('chat-1', 'u1', 'Slow one')
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect((await h.companion.get('chat-1', 'u1')).busy).toBe(true)
        await expect(h.companion.send('chat-1', 'u1', 'Second')).rejects.toThrow(COMPANION_BUSY)
        await expect(h.companion.clear('chat-1', 'u1')).rejects.toThrow(COMPANION_BUSY)
        held = false
        expect((await h.companion.send('chat-2', 'u1', 'Other chat')).messages).toHaveLength(2)
        release('Done at last.')
        expect((await first).messages.map((m) => m.content)).toEqual(['Slow one', 'Done at last.'])
        expect((await h.companion.get('chat-1', 'u1')).busy).toBe(false)
    })

    it('clears a chat’s conversation and leaves another chat’s alone', async () => {
        const h = harness()
        await h.companion.send('chat-1', 'u1', 'Hello')
        await h.companion.send('chat-2', 'u1', 'Hello')
        expect((await h.companion.clear('chat-1', 'u1')).messages).toEqual([])
        expect((await h.companion.get('chat-1', 'u1')).messages).toEqual([])
        expect((await h.companion.get('chat-2', 'u1')).messages).toHaveLength(2)
    })

    it('shows the last five messages of the story and nothing else as it ships (100b)', async () => {
        const h = harness({ sources: {} })
        await h.companion.send('chat-1', 'u1', 'What now?')
        const prompt = system(h.calls[0]!)
        expect(prompt).toContain('--- CURRENT STORY CONTEXT ---\n## NARRATIVE HISTORY (Last 4 of 4 requested messages)\nPlayer: I knock on the mill door.')
        expect(prompt).not.toContain('--- STATE TRACKER ---')
        expect(prompt).not.toContain('--- LOREBOOK ---')
        expect(prompt).not.toContain('--- ACTIVE SITE MAP ---')
        expect(h.logs.some((line) => line.includes('shown the last 4 messages of the story'))).toBe(true)
    })

    it('shows each block its preference turns on, and no story for a count of zero', async () => {
        const h = harness({ sources: {}, prefs: { companionLookback: 0, companionSheet: true, companionLore: true, companionMap: true } })
        await h.companion.send('chat-1', 'u1', 'What now?')
        const prompt = system(h.calls[0]!)
        expect(prompt).not.toContain('--- CURRENT STORY CONTEXT ---')
        expect(prompt).toContain('--- STATE TRACKER ---\n## STATE MEMO (State Tracker)\n[CHARACTER]\nRobin Vale\nHP: 12/20')
        expect(prompt).toContain('--- LOREBOOK ---\n## ACTIVE LORE (Lorebook Agent)\n### Old Pell\nKeeps the toll gate.')
        expect(prompt).toContain('Mill Yard (you are here)\nUnexplored: the loft\n--- END ACTIVE SITE MAP ---')
        expect(h.logs.some((line) => line.includes('shown the character sheet, 1 active lore entries, the site map as the player knows it'))).toBe(true)
    })

    it('sends the whole story when asked for all of it, and two messages for a count of two', async () => {
        const all = harness({ sources: {}, prefs: { companionLookbackAll: true, companionLookback: 1 } })
        await all.companion.send('chat-1', 'u1', 'Recap?')
        expect(system(all.calls[0]!)).toContain('## NARRATIVE HISTORY (All 4 messages)')
        const two = harness({ sources: {}, prefs: { companionLookback: 2 } })
        await two.companion.send('chat-1', 'u1', 'Recap?')
        expect(system(two.calls[0]!)).toContain('## NARRATIVE HISTORY (Last 2 of 2 requested messages)\nPlayer: I ask for the miller.')
        expect(system(two.calls[0]!)).not.toContain('I knock on the mill door.')
    })

    it('tells the Companion when the party is outside every map, and when the map could not be read', async () => {
        const outside = harness({ sources: { map: async () => '' }, prefs: { companionMap: true, companionLookback: 0 } })
        await outside.companion.send('chat-1', 'u1', 'Where am I?')
        expect(system(outside.calls[0]!)).toContain(`--- ACTIVE SITE MAP ---\n${COMPANION_MAP_OUTSIDE}\n--- END ACTIVE SITE MAP ---`)
        const failed = harness({ sources: { map: async () => { throw new Error('books unreadable') } }, prefs: { companionMap: true, companionLookback: 0 } })
        await failed.companion.send('chat-1', 'u1', 'Where am I?')
        expect(system(failed.calls[0]!)).toContain(`--- ACTIVE SITE MAP ---\n${COMPANION_MAP_FAILED}\n--- END ACTIVE SITE MAP ---`)
        expect(failed.logs.some((line) => line.startsWith('warn: companion: could not read the site map') && line.includes('books unreadable'))).toBe(true)
    })

    it('answers without a block it could not read, says so in the log, and still sends the others', async () => {
        const h = harness({
            sources: { messages: async () => { throw new Error('chat gone') }, lore: async () => { throw new Error('no grant') } },
            prefs: { companionSheet: true, companionLore: true },
        })
        const state = await h.companion.send('chat-1', 'u1', 'What now?')
        expect(state.messages).toHaveLength(2)
        const prompt = system(h.calls[0]!)
        expect(prompt).not.toContain('--- CURRENT STORY CONTEXT ---')
        expect(prompt).not.toContain('--- LOREBOOK ---')
        expect(prompt).toContain('--- STATE TRACKER ---')
        expect(h.logs.filter((line) => line.startsWith('warn: companion: could not read')).map((line) => line.includes('chat gone') || line.includes('no grant'))).toEqual([true, true])
    })

    it('reads nothing it was not asked to share', async () => {
        const read: string[] = []
        const h = harness({
            sources: {
                messages: async () => { read.push('messages'); return STORY },
                memo: async () => { read.push('memo'); return { memo: 'x' } },
                lore: async () => { read.push('lore'); return [] },
                map: async () => { read.push('map'); return '' },
            },
            prefs: { companionLookback: 0 },
        })
        await h.companion.send('chat-1', 'u1', 'Hello')
        expect(read).toEqual([])
        expect(h.logs.some((line) => line.includes('shown nothing of the campaign'))).toBe(true)
    })

    it('reads an unreadable file as an empty conversation', async () => {
        const h = harness({ files: { [`u1:${companionPath('chat-1')}`]: { messages: 'nope' } } })
        expect((await h.companion.get('chat-1', 'u1')).messages).toEqual([])
    })
})

describe('the Adventure Companion’s actions (100c)', () => {
    const block = (type: string, body: string) => `<companion_action type="${type}">${body}</companion_action>`
    /** Replies in order, one per model call; the last repeats. */
    const script = (...replies: Array<string | Error>) => {
        let at = 0
        return () => {
            const reply = replies[Math.min(at++, replies.length - 1)]!
            if (reply instanceof Error) throw reply
            return { content: reply }
        }
    }
    function actionsHarness(options: { cyoa?: boolean; choices?: string[]; results?: Partial<Record<'tracker' | 'agent' | 'map', CompanionActionResult | Error>>; actError?: Error } = {}) {
        const ran: Array<[string, string, string | undefined, string]> = []
        const ok = (action: string): CompanionActionResult => ({ action, success: true, status: 'completed', message: `${action} did it.` })
        const run = (kind: 'tracker' | 'agent' | 'map', label: string) => async (chatId: string, userId: string | undefined, instruction: string) => {
            ran.push([kind, chatId, userId, instruction])
            const result = options.results?.[kind]
            if (result instanceof Error) throw result
            return result ?? ok(label)
        }
        const actions: CompanionActions = {
            tracker: run('tracker', 'State Tracker'),
            agent: run('agent', 'Lorebook Agent'),
            map: run('map', 'Map Updater'),
            turn: async () => ({ cyoa: options.cyoa === true, choices: options.choices ?? [] }),
            act: async (chatId, userId, text) => {
                if (options.actError) throw options.actError
                ran.push(['act', chatId, userId, text])
            },
        }
        return { actions, ran }
    }
    const stored = (h: ReturnType<typeof harness>) => h.files.get(`u1:${companionPath('c1')}`) as { messages: Array<Record<string, unknown>>; pending?: Record<string, unknown> }
    const convo = (call: Record<string, unknown>) => (call.messages as Array<{ role: string; content: string }>).slice(1)

    it('runs a bookkeeping action at once, tells the model what it reported, and keeps the model’s summary with the receipt', async () => {
        const h = harness({ reply: script(`On it.\n${block('state_tracker', 'Add a brass lantern.')}`, 'The lantern is on your sheet.') })
        const a = actionsHarness()
        const state = await h.companion.send('c1', 'u1', 'Give me a lantern', a.actions)
        expect(a.ran).toEqual([['tracker', 'c1', 'u1', 'Add a brass lantern.']])
        expect(h.calls).toHaveLength(2)
        // The second call carries the model's own reply with its block, then the result as the user.
        const second = convo(h.calls[1]!)
        expect(second[1]).toEqual({ role: 'assistant', content: `On it.\n${block('state_tracker', 'Add a brass lantern.')}` })
        expect(second[2]!.role).toBe('user')
        expect(second[2]!.content).toContain('[EXTENSION ACTION RESULTS — authoritative; already executed; do not repeat]')
        expect(second[2]!.content).toContain('"message": "State Tracker did it."')
        expect(state.messages[1]).toMatchObject({ role: 'assistant', content: 'The lantern is on your sheet.', actions: [{ action: 'State Tracker', success: true, message: 'State Tracker did it.' }] })
        expect(state.pending).toBeNull()
        expect(stored(h).messages[1]).toMatchObject({ actions: [{ action: 'State Tracker', success: true, message: 'State Tracker did it.' }] })
        expect(h.logs.join('\n')).toMatch(/companion: State Tracker asked in chat c1: Add a brass lantern\./)
        expect(h.logs.join('\n')).toMatch(/companion: answered in chat c1 \(\d+ characters, 1 actions\)/)
    })

    it('routes each kind to its own operation, in the order written, and never shows the player a block', async () => {
        const h = harness({ reply: script(`${block('lorebook_agent', 'Record Old Pell.')}${block('map_updater', 'Clear the yard.')}${block('state_tracker', 'Heal 2 HP.')}`, 'All three are done.') })
        const a = actionsHarness()
        const state = await h.companion.send('c1', 'u1', 'Tidy up', a.actions)
        expect(a.ran.map((r) => [r[0], r[3]])).toEqual([['agent', 'Record Old Pell.'], ['map', 'Clear the yard.'], ['tracker', 'Heal 2 HP.']])
        expect(state.messages[1]!.actions!.map((r) => r.action)).toEqual(['Lorebook Agent', 'Map Updater', 'State Tracker'])
        expect(state.messages[1]!.content).not.toContain('companion_action')
    })

    it('reports a failed or thrown action as a result, goes on, and never says it worked', async () => {
        const h = harness({ reply: script(`${block('map_updater', 'Clear the yard.')}${block('state_tracker', 'Heal 2 HP.')}`, 'The map could not be changed.') })
        const a = actionsHarness({ results: { map: { action: 'Map Updater', success: false, status: 'unavailable', message: 'No active map.' }, tracker: new Error('the pass blew up') } })
        const state = await h.companion.send('c1', 'u1', 'Tidy up', a.actions)
        expect(state.messages[1]!.actions).toEqual([
            { action: 'Map Updater', success: false, message: 'No active map.' },
            { action: 'State Tracker', success: false, message: 'the pass blew up' },
        ])
        expect(convo(h.calls[1]!)[2]!.content).toContain('"status": "failed"')
    })

    it('stops before running anything past four actions in one message, in Multihog’s words', async () => {
        const five = Array.from({ length: 5 }, (_, i) => block('state_tracker', `Step ${i}.`)).join('')
        const h = harness({ reply: script(five) })
        const a = actionsHarness()
        const state = await h.companion.send('c1', 'u1', 'Do five things', a.actions)
        expect(a.ran).toEqual([])
        expect(state.messages[1]!.content).toBe(COMPANION_LIMIT_MESSAGE)
        // Three, then two more in the next turn: the first three stand and are receipted.
        const h2 = harness({ reply: script(block('state_tracker', 'a') + block('state_tracker', 'b') + block('state_tracker', 'c'), block('state_tracker', 'd') + block('state_tracker', 'e')) })
        const a2 = actionsHarness()
        const state2 = await h2.companion.send('c1', 'u1', 'Do five things', a2.actions)
        expect(a2.ran).toHaveLength(3)
        expect(state2.messages[1]).toMatchObject({ content: COMPANION_LIMIT_MESSAGE })
        expect(state2.messages[1]!.actions).toHaveLength(3)
    })

    it('makes no more than six model calls for one message, and keeps the receipts when the summary never comes', async () => {
        const h = harness({ reply: script(block('state_tracker', 'Again.')) })
        const a = actionsHarness({ results: { tracker: { action: 'State Tracker', success: false, status: 'failed', message: 'no' } } })
        // One action a turn would pass the action limit at the fifth: the limit message, after four calls and a fifth.
        const state = await h.companion.send('c1', 'u1', 'Loop', a.actions)
        expect(h.calls.length).toBeLessThanOrEqual(6)
        expect(a.ran).toHaveLength(4)
        expect(state.messages[1]!.content).toBe(COMPANION_LIMIT_MESSAGE)
        // A model that only ever writes an empty block never ends on its own: six calls, then Multihog's line.
        const h2 = harness({ reply: script('<companion_action type="act_for_user">{"choice_index":9}</companion_action>') })
        const state2 = await h2.companion.send('c1', 'u1', 'Loop', actionsHarness({ cyoa: true, choices: ['One'] }).actions)
        expect(h2.calls.length).toBeLessThanOrEqual(6)
        expect(state2.messages[1]!.actions!.every((r) => r.action === 'Player Turn' && !r.success)).toBe(true)
    })

    it('keeps what ran when the follow-up call fails, and throws nothing', async () => {
        const h = harness({ reply: script(block('state_tracker', 'Add a lantern.'), new Error('the provider hung up')) })
        const a = actionsHarness()
        const state = await h.companion.send('c1', 'u1', 'Give me a lantern', a.actions)
        expect(state.messages[1]).toMatchObject({ content: COMPANION_NO_SUMMARY_MESSAGE, actions: [{ action: 'State Tracker', success: true }] })
        // With nothing run, a failed call is still the whole message's failure, and nothing is kept.
        const h2 = harness({ reply: script(new Error('the provider hung up')) })
        await expect(h2.companion.send('c1', 'u1', 'Hello', actionsHarness().actions)).rejects.toThrow('The Companion could not answer: the provider hung up')
        expect(h2.files.size).toBe(0)
    })

    it('uses the summary line when the model answers a result with nothing but blocks removed', async () => {
        const h = harness({ reply: script(block('state_tracker', 'Add a lantern.'), '   ') })
        const state = await h.companion.send('c1', 'u1', 'Give me a lantern', actionsHarness().actions)
        expect(state.messages[1]!.content).toBe(COMPANION_NO_SUMMARY_MESSAGE)
    })

    it('says an action is unavailable in a build that cannot run one, and tells the Companion nothing of taking turns', async () => {
        const h = harness({ reply: script(block('state_tracker', 'Add a lantern.'), 'I could not do that here.') })
        const state = await h.companion.send('c1', 'u1', 'Give me a lantern')
        expect(state.messages[1]!.actions).toEqual([{ action: 'State Tracker', success: false, message: COMPANION_ACTIONS_UNAVAILABLE }])
        expect(system(h.calls[0]!)).not.toContain('PLAYER ACTION CAPABILITY')
    })

    it('tells the Companion how a turn may be taken, with the choices under the last reply by number', async () => {
        const h = harness()
        await h.companion.send('c1', 'u1', 'Hello', actionsHarness({ cyoa: true, choices: ['Open the gate', 'Wait for dusk'] }).actions)
        expect(system(h.calls[0]!)).toContain('--- PLAYER ACTION CAPABILITY ---\n## ACT FOR USER MODE\nCYOA is active. ')
        expect(system(h.calls[0]!)).toContain('1. Open the gate\n2. Wait for dusk\n--- END PLAYER ACTION CAPABILITY ---')
        const off = harness()
        await off.companion.send('c1', 'u1', 'Hello', actionsHarness().actions)
        expect(system(off.calls[0]!)).toContain('CYOA is inactive.')
    })

    it('proposes a player turn and sends nothing until the player answers, as it ships', async () => {
        const h = harness({ reply: script(`Here goes.\n${block('act_for_user', '{"action_text":"I open the gate.","commentary":"Bold as brass."}')}`) })
        const a = actionsHarness()
        const state = await h.companion.send('c1', 'u1', 'Take my turn', a.actions)
        expect(a.ran).toEqual([])
        expect(h.calls).toHaveLength(1)
        expect(state.pending).toEqual({ text: 'I open the gate.' })
        expect(state.messages.map((m) => m.role)).toEqual(['user'])
        expect(stored(h).pending).toEqual({ text: 'I open the gate.', commentary: 'Bold as brass.', prior: [] })
        expect((await h.companion.get('c1', 'u1')).pending).toEqual({ text: 'I open the gate.' })
        expect(h.logs.join('\n')).toContain('proposed a turn for the player in chat c1')
    })

    it('sends the proposed turn on a yes, as the player, and keeps the Companion’s reaction with the receipts', async () => {
        const h = harness({ reply: script(`${block('state_tracker', 'Note the gate is open.')}`, block('act_for_user', '{"action_text":"I open the gate.","commentary":"Bold as brass."}')) })
        const a = actionsHarness()
        await h.companion.send('c1', 'u1', 'Note it, then take my turn', a.actions)
        expect(stored(h).pending).toMatchObject({ prior: [{ action: 'State Tracker', success: true }] })
        const state = await h.companion.confirm('c1', 'u1', true, a.actions)
        expect(a.ran).toEqual([['tracker', 'c1', 'u1', 'Note the gate is open.'], ['act', 'c1', 'u1', 'I open the gate.']])
        expect(state.pending).toBeNull()
        expect(state.messages[1]).toMatchObject({
            role: 'assistant', content: 'Bold as brass.',
            actions: [{ action: 'State Tracker', success: true, message: 'State Tracker did it.' }, { action: 'Player Turn', success: true, message: 'Submitted player action: I open the gate.' }],
        })
        expect(stored(h).pending).toBeUndefined()
        expect(h.calls).toHaveLength(2)
        await expect(h.companion.confirm('c1', 'u1', true, a.actions)).rejects.toThrow(COMPANION_NO_PENDING)
    })

    it('drops the proposed turn on a no, sends nothing, and records that it never went out', async () => {
        const h = harness({ reply: script(block('act_for_user', '{"action_text":"I open the gate."}')) })
        const a = actionsHarness()
        await h.companion.send('c1', 'u1', 'Take my turn', a.actions)
        const state = await h.companion.confirm('c1', 'u1', false, a.actions)
        expect(a.ran).toEqual([])
        expect(state.pending).toBeNull()
        expect(state.messages[1]).toEqual({ role: 'assistant', content: declinedTurnMessage('I open the gate.'), at: expect.any(String) })
        expect(h.logs.join('\n')).toContain('the player declined the proposed turn in chat c1')
    })

    it('keeps the turn proposed when it could not be sent, so the player can try again', async () => {
        const h = harness({ reply: script(block('act_for_user', '{"action_text":"I open the gate."}')) })
        const a = actionsHarness({ actError: new Error('the host is generating') })
        await h.companion.send('c1', 'u1', 'Take my turn', a.actions)
        await expect(h.companion.confirm('c1', 'u1', true, a.actions)).rejects.toThrow('The turn could not be sent: the host is generating')
        expect((await h.companion.get('c1', 'u1')).pending).toEqual({ text: 'I open the gate.' })
        await expect(h.companion.confirm('c1', 'u1', true)).rejects.toThrow(COMPANION_ACTIONS_UNAVAILABLE)
        // The lock is let go either way.
        expect((await h.companion.get('c1', 'u1')).busy).toBe(false)
    })

    it('closes an unanswered turn as declined when the player writes something else', async () => {
        const h = harness({ reply: script(block('act_for_user', '{"action_text":"I open the gate."}'), 'Fair enough.') })
        const a = actionsHarness()
        await h.companion.send('c1', 'u1', 'Take my turn', a.actions)
        const state = await h.companion.send('c1', 'u1', 'Actually, wait', a.actions)
        expect(a.ran).toEqual([])
        expect(state.pending).toBeNull()
        expect(state.messages.map((m) => [m.role, m.content])).toEqual([
            ['user', 'Take my turn'], ['assistant', declinedTurnMessage('I open the gate.')], ['user', 'Actually, wait'], ['assistant', 'Fair enough.'],
        ])
        expect(convo(h.calls[1]!)[1]).toEqual({ role: 'assistant', content: declinedTurnMessage('I open the gate.') })
    })

    it('sends the turn at once with the confirmation switched off, and ends there with the reaction', async () => {
        const h = harness({ prefs: { companionConfirmAct: false }, reply: script(`Here goes.\n${block('act_for_user', '{"action_text":"I open the gate."}')}${block('state_tracker', 'Never reached.')}`) })
        const a = actionsHarness()
        const state = await h.companion.send('c1', 'u1', 'Take my turn', a.actions)
        expect(a.ran).toEqual([['act', 'c1', 'u1', 'I open the gate.']])
        expect(h.calls).toHaveLength(1)
        expect(state.pending).toBeNull()
        expect(state.messages[1]).toMatchObject({ content: 'Here goes.', actions: [{ action: 'Player Turn', success: true, message: 'Submitted player action: I open the gate.' }] })
    })

    it('tells the model when a turn sent at once failed, and lets it answer', async () => {
        const h = harness({ prefs: { companionConfirmAct: false }, reply: script(block('act_for_user', '{"action_text":"I open the gate."}'), 'I could not send it.') })
        const state = await h.companion.send('c1', 'u1', 'Take my turn', actionsHarness({ actError: new Error('the host is generating') }).actions)
        expect(state.messages[1]).toMatchObject({ content: 'I could not send it.', actions: [{ action: 'Player Turn', success: false, message: 'the host is generating' }] })
        expect(convo(h.calls[1]!)[2]!.content).toContain('the host is generating')
    })

    it('resolves a choice by its number to the choice’s own text, free text first, and refuses a number that is not on offer', async () => {
        const choices = ['1. Open the gate', '2. Wait for dusk']
        const pick = async (body: string, options: { cyoa?: boolean; choices?: string[] } = { cyoa: true, choices }) => {
            const h = harness({ reply: script(block('act_for_user', body), 'Hm.') })
            const state = await h.companion.send('c1', 'u1', 'Choose for me', actionsHarness(options).actions)
            return state.pending?.text ?? state.messages[1]!.actions![0]!.message
        }
        expect(await pick('{"choice_index":2}')).toBe('2. Wait for dusk')
        expect(await pick('{"choice_index":2,"action_text":"I climb the wall."}')).toBe('I climb the wall.')
        expect(await pick('{"choice_index":3}')).toBe('Choose a CYOA choice_index from 1 to 2.')
        expect(await pick('{"choice_index":1}', { cyoa: true, choices: [] })).toBe('CYOA is active, but no current choice buttons are available.')
        expect(await pick('{"choice_index":1}', { cyoa: false })).toBe('Provide action_text for the player turn.')
    })

    it('runs the bookkeeping written before a turn, and nothing written after it', async () => {
        const h = harness({ reply: script(`${block('state_tracker', 'Before.')}${block('act_for_user', '{"action_text":"I open the gate."}')}${block('lorebook_agent', 'After.')}`) })
        const a = actionsHarness()
        const state = await h.companion.send('c1', 'u1', 'Note it and go', a.actions)
        expect(a.ran.map((r) => r[0])).toEqual(['tracker'])
        expect(state.pending).toEqual({ text: 'I open the gate.' })
        expect(stored(h).pending).toMatchObject({ prior: [{ action: 'State Tracker' }] })
    })

    it('says so when six calls end with nothing run and nothing said', async () => {
        // An unknown block type runs nothing and is no action: the reply is the text beside it, here none.
        const h = harness({ reply: script(block('settings', 'Turn off dice.')) })
        await expect(h.companion.send('c1', 'u1', 'Turn off dice', actionsHarness().actions)).rejects.toThrow(/reply was empty/)
        expect(COMPANION_INCOMPLETE_MESSAGE).toBe('I could not complete that request.')
    })
})
