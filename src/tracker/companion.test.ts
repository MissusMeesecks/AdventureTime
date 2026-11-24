import { describe, expect, it } from 'vitest'

import {
    COMPANION_DOC_CLOSE, COMPANION_DOC_OPEN, COMPANION_FRAMES, COMPANION_HISTORY_LIMIT, COMPANION_LEGACY_ACTIONS, COMPANION_LEGACY_ACTION_RULES, COMPANION_LEGACY_BLOCKS, COMPANION_LEGACY_LINES, COMPANION_MAP_HEAD, COMPANION_MAP_OUTSIDE, COMPANION_MAX_ACTIONS, COMPANION_MAX_TURNS, COMPANION_PERSONA, buildCompanionActContext, buildCompanionLore, buildCompanionMap, buildCompanionMemo, buildCompanionMessages, buildCompanionNarrative, buildCompanionObservation, buildCompanionSystemPrompt, estimateGuideTokens, formatCompanionActionReceipt, formatPlayerTurnCommentary, parseCompanionActions, pushCompanionMessage, readCompanionHistory, readCompanionPending, type CompanionMessage,
} from './companion.js'

const msg = (role: 'user' | 'assistant', content: string): CompanionMessage => ({ role, content, at: '2031-01-01T00:00:00.000Z' })

describe('the Companion’s persona', () => {
    it('carries every one of Multihog’s kept lines, and names AdventureTime and Lumiverse', () => {
        for (const line of COMPANION_LEGACY_LINES) expect(COMPANION_PERSONA).toContain(line)
        expect(COMPANION_PERSONA).toContain('an AdventureTime campaign in Lumiverse')
    })

    it('lists Multihog’s four actions, its rules and its five blocks, and tells the model not to ask for the confirmation itself (100c)', () => {
        for (const line of [...COMPANION_LEGACY_ACTIONS, ...COMPANION_LEGACY_ACTION_RULES, ...COMPANION_LEGACY_BLOCKS]) expect(COMPANION_PERSONA).toContain(line)
        expect(COMPANION_PERSONA).not.toContain('You have no actions')
        expect(COMPANION_PERSONA).toContain('Never say that something was changed unless an action result says so.')
        expect(COMPANION_PERSONA).toContain('Do not ask for that confirmation yourself')
        expect(COMPANION_PERSONA).toContain('You see only the blocks the player chose to share.')
        expect(COMPANION_PERSONA).not.toMatch(/Multihog UI|native tools/)
    })

    it('is the persona alone without the guide, and the persona then the framed guide with it', () => {
        expect(buildCompanionSystemPrompt()).toBe(COMPANION_PERSONA)
        expect(buildCompanionSystemPrompt({ doc: '   ' })).toBe(COMPANION_PERSONA)
        expect(buildCompanionSystemPrompt({ doc: '# The guide\n\nPress the lantern.\n' }))
            .toBe(`${COMPANION_PERSONA}\n\n${COMPANION_DOC_OPEN}\n# The guide\n\nPress the lantern.\n${COMPANION_DOC_CLOSE}`)
    })

    it('sends the system prompt first, then the conversation in order with nothing but role and content', () => {
        const messages = buildCompanionMessages({ doc: 'G', history: [msg('user', 'How do I rest?'), msg('assistant', 'Ask the narrator.'), msg('user', 'And camp?')] })
        expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
        expect(messages[0]!.content).toContain(`${COMPANION_DOC_OPEN}\nG\n${COMPANION_DOC_CLOSE}`)
        expect(messages[3]).toEqual({ role: 'user', content: 'And camp?' })
    })

    it('sends no more than the newest messages the limit allows', () => {
        const long = Array.from({ length: COMPANION_HISTORY_LIMIT + 6 }, (_, i) => msg(i % 2 ? 'assistant' : 'user', `m${i}`))
        const messages = buildCompanionMessages({ history: long })
        expect(messages).toHaveLength(COMPANION_HISTORY_LIMIT + 1)
        expect(messages[1]!.content).toBe('m6')
        expect(messages.at(-1)!.content).toBe(`m${COMPANION_HISTORY_LIMIT + 5}`)
    })
})

describe('what the Companion is shown of the campaign (100b)', () => {
    const story = [
        { role: 'user', content: 'I knock on the mill door.' },
        { role: 'assistant', content: 'A shutter opens.\n\n<choices>1. Wave</choices>' },
        { role: 'user', content: '   ' },
        { role: 'assistant', content: 'The miller squints at you.' },
    ]

    it('writes the last messages under Player and Narrator, as sent, and counts what it wrote against what was asked', () => {
        expect(buildCompanionNarrative(story, { all: false, count: 3 }))
            .toBe('## NARRATIVE HISTORY (Last 2 of 3 requested messages)\nNarrator: A shutter opens.\n\n<choices>1. Wave</choices>\n\nNarrator: The miller squints at you.')
        expect(buildCompanionNarrative(story, { all: true, count: 0 }))
            .toBe('## NARRATIVE HISTORY (All 3 messages)\nPlayer: I knock on the mill door.\n\nNarrator: A shutter opens.\n\n<choices>1. Wave</choices>\n\nNarrator: The miller squints at you.')
    })

    it('shares no story for a count of zero, an empty chat or messages with no text', () => {
        expect(buildCompanionNarrative(story, { all: false, count: 0 })).toBe('')
        expect(buildCompanionNarrative([], { all: true, count: 5 })).toBe('')
        expect(buildCompanionNarrative([{ role: 'user', content: '  ' }], { all: true, count: 5 })).toBe('')
    })

    it('writes the sheet without its display markers, the quests kept and the bench as names', () => {
        const memo = '[CHARACTER]\nRobin Vale\nHP: ((BAR)) 12/20\n[/CHARACTER]\n[QUESTS]\nFind the ledger\n[/QUESTS]'
        expect(buildCompanionMemo(memo)).toBe('## STATE MEMO (State Tracker)\n[CHARACTER]\nRobin Vale\nHP: 12/20\n[/CHARACTER]\n[QUESTS]\nFind the ledger\n[/QUESTS]')
        expect(buildCompanionMemo('   ')).toBe('')
        const benched = '[PARTY]\nIvo: 9/9 HP\n[/PARTY]\n[BENCHED PARTY]\nSella: 4/11 HP\nGear: a long list of things\n[/BENCHED PARTY]'
        const shown = buildCompanionMemo(benched)
        expect(shown).toContain('Sella')
        expect(shown).not.toContain('a long list of things')
    })

    it('writes each active entry under its title, a bracketed prefix off, and leaves out an entry with nothing to show', () => {
        expect(buildCompanionLore([{ title: '[NPC] Old Pell', content: 'Keeps the toll gate.\n' }, { title: 'Empty', content: '   ' }, { title: '', content: 'A nameless note.' }]))
            .toBe('## ACTIVE LORE (Lorebook Agent)\n### Old Pell\nKeeps the toll gate.\n\n### Untitled\nA nameless note.')
        expect(buildCompanionLore([])).toBe('')
        expect(buildCompanionLore([{ title: 'Empty', content: '' }])).toBe('')
    })

    it('heads the map with the warning against inventing what is unexplored, and says so when the party is outside every map', () => {
        expect(buildCompanionMap('Gatehouse (visited)')).toBe(`${COMPANION_MAP_HEAD}\n\nGatehouse (visited)`)
        expect(COMPANION_MAP_HEAD).toContain('do not invent hidden rooms, traps, or occupants')
        expect(buildCompanionMap('  ')).toBe(COMPANION_MAP_OUTSIDE)
        expect(buildCompanionMap(null)).toBe(COMPANION_MAP_OUTSIDE)
    })

    it('frames every shared block after the persona in Multihog’s order, and leaves an unshared one out whole', () => {
        const all = buildCompanionSystemPrompt({ playerAction: 'P', map: 'M', lore: 'L', memo: 'S', narrative: 'N', doc: 'G' })
        const order = COMPANION_FRAMES.map((frame) => all.indexOf(frame.open))
        expect(order.every((at) => at > 0)).toBe(true)
        expect([...order].sort((a, b) => a - b)).toEqual(order)
        expect(all).toContain('--- CURRENT STORY CONTEXT ---\nN\n--- END STORY CONTEXT ---')
        expect(all).toContain('--- STATE TRACKER ---\nS\n--- END STATE TRACKER ---')
        expect(all).toContain('--- LOREBOOK ---\nL\n--- END LOREBOOK ---')
        expect(all).toContain('--- ACTIVE SITE MAP ---\nM\n--- END ACTIVE SITE MAP ---')
        const some = buildCompanionSystemPrompt({ memo: 'S', lore: '  ' })
        expect(some).toBe(`${COMPANION_PERSONA}\n\n--- STATE TRACKER ---\nS\n--- END STATE TRACKER ---`)
        expect(buildCompanionMessages({ narrative: 'N', history: [] })[0]!.content).toContain('--- CURRENT STORY CONTEXT ---\nN')
    })
})

describe('the Companion’s conversation', () => {
    it('reads a stored list defensively: only messages with a role and text, the newest kept', () => {
        expect(readCompanionHistory('nope')).toEqual([])
        expect(readCompanionHistory([msg('user', 'a'), null, { role: 'system', content: 'x' }, { role: 'assistant', content: '  ' }, { role: 'assistant', content: 'b' }, 7]))
            .toEqual([msg('user', 'a'), { role: 'assistant', content: 'b', at: '' }])
        const many = Array.from({ length: COMPANION_HISTORY_LIMIT + 3 }, (_, i) => msg('user', `m${i}`))
        const read = readCompanionHistory(many)
        expect(read).toHaveLength(COMPANION_HISTORY_LIMIT)
        expect(read[0]!.content).toBe('m3')
    })

    it('adds a message at the end and drops the oldest past the limit, leaving the list it was given alone', () => {
        const full = Array.from({ length: COMPANION_HISTORY_LIMIT }, (_, i) => msg('user', `m${i}`))
        const next = pushCompanionMessage(full, msg('assistant', 'new'))
        expect(next).toHaveLength(COMPANION_HISTORY_LIMIT)
        expect(next[0]!.content).toBe('m1')
        expect(next.at(-1)!.content).toBe('new')
        expect(full).toHaveLength(COMPANION_HISTORY_LIMIT)
        expect(full[0]!.content).toBe('m0')
    })

    it('estimates the guide’s tokens at four characters each, to the nearest 500', () => {
        expect(estimateGuideTokens('x'.repeat(76_000))).toBe(19_000)
        expect(estimateGuideTokens('x'.repeat(7_000))).toBe(2_000)
        expect(estimateGuideTokens('')).toBe(0)
    })
})

describe('the Companion’s actions (100c)', () => {
    it('reads each kind of block, takes every block out of what the player sees, and keeps the order', () => {
        const text = 'On it.\n<companion_action type="state_tracker">Add a brass lantern to the inventory.</companion_action>\n<companion_action type=\'LOREBOOK_AGENT\'>\n  Record Old Pell as an ally.\n</companion_action>\n<companion_action type="map_updater">Remove the cart from the yard.</companion_action>\nDone soon.'
        expect(parseCompanionActions(text)).toEqual({
            actions: [
                { kind: 'state_tracker', instruction: 'Add a brass lantern to the inventory.' },
                { kind: 'lorebook_agent', instruction: 'Record Old Pell as an ally.' },
                { kind: 'map_updater', instruction: 'Remove the cart from the yard.' },
            ],
            visibleText: 'On it.\n\n\n\nDone soon.',
        })
    })

    it('reads a player turn as a choice by number, as free text, or as a body that is not JSON', () => {
        const turn = (body: string) => parseCompanionActions(`<companion_action type="act_for_user">${body}</companion_action>`).actions
        expect(turn('{"choice_index":2,"commentary":"Bold."}')).toEqual([{ kind: 'act_for_user', choiceIndex: 2, actionText: '', commentary: 'Bold.' }])
        expect(turn('{"action_text":" I open the gate. "}')).toEqual([{ kind: 'act_for_user', actionText: 'I open the gate.' }])
        expect(turn('{"choice_index":1,"action_text":"I wait."}')).toEqual([{ kind: 'act_for_user', choiceIndex: 1, actionText: 'I wait.' }])
        expect(turn('I open the gate.')).toEqual([{ kind: 'act_for_user', actionText: 'I open the gate.' }])
    })

    it('runs nothing for an empty block, an unknown type or a turn that names neither a choice nor a text, and still hides the block', () => {
        const text = 'a<companion_action type="state_tracker">  </companion_action>b<companion_action type="settings">Turn off dice.</companion_action>c<companion_action type="act_for_user">{"choice_index":0}</companion_action><companion_action type="act_for_user">{"choice_index":1.5,"commentary":"x"}</companion_action>'
        expect(parseCompanionActions(text)).toEqual({ actions: [], visibleText: 'abc' })
        expect(parseCompanionActions(null)).toEqual({ actions: [], visibleText: '' })
        expect(parseCompanionActions('No blocks here.')).toEqual({ actions: [], visibleText: 'No blocks here.' })
    })

    it('writes one receipt line per action with a tick or a cross', () => {
        expect(formatCompanionActionReceipt([
            { action: 'State Tracker', success: true, message: 'Added the lantern.' },
            { action: 'Map Updater', success: false, message: 'No active map.' },
        ])).toBe('✓ State Tracker: Added the lantern.\n✗ Map Updater: No active map.')
    })

    it('tells the model what ran as an authoritative observation, the results as JSON', () => {
        const results = [{ action: 'State Tracker', success: true, status: 'completed', message: 'Added the lantern.' }]
        const text = buildCompanionObservation(results)
        expect(text.startsWith('[EXTENSION ACTION RESULTS — authoritative; already executed; do not repeat]\n')).toBe(true)
        expect(text).toContain(JSON.stringify(results, null, 2))
        expect(text.endsWith('without emitting more action tags.')).toBe(true)
    })

    it('reacts to a turn with the action’s commentary, else the model’s text, else a stock line by the action’s words; a dry receipt is passed over', () => {
        expect(formatPlayerTurnCommentary({ actionText: 'I wait.', commentary: 'Patience. Bold choice.' }, 'Model text.')).toBe('Patience. Bold choice.')
        expect(formatPlayerTurnCommentary({ actionText: 'I wait.' }, 'Model text.')).toBe('Model text.')
        expect(formatPlayerTurnCommentary({ actionText: 'I wait.', commentary: '✓ Player Turn: sent' }, 'Submitted player action: I wait.')).toBe('The move is made. Now let’s see how the world decides to complicate it.')
        expect(formatPlayerTurnCommentary({ actionText: 'I kick the door in.' })).toMatch(/^Subtlety has officially left the building/)
        expect(formatPlayerTurnCommentary({ actionText: 'I sneak past the gate.' })).toMatch(/^Quiet feet/)
        expect(formatPlayerTurnCommentary({ choiceIndex: 2 })).toMatch(/^I’ve cast our lot/)
    })

    it('says how a turn may be taken: free text with CYOA off or no choices on offer, the numbered choices otherwise', () => {
        expect(buildCompanionActContext({ cyoa: false, choices: ['x'] })).toMatch(/^## ACT FOR USER MODE\nCYOA is inactive\./)
        expect(buildCompanionActContext({ cyoa: true, choices: [] })).toMatch(/^## ACT FOR USER MODE\nCYOA is active, but there are no current actionable CYOA buttons\./)
        const offered = buildCompanionActContext({ cyoa: true, choices: ['Open the gate', 'Wait for dusk'] })
        expect(offered).toMatch(/^## ACT FOR USER MODE\nCYOA is active\. /)
        expect(offered.endsWith('### CURRENT AVAILABLE CYOA CHOICES\n1. Open the gate\n2. Wait for dusk')).toBe(true)
    })

    it('frames the player action capability last, and sends a reply’s receipts back with it', () => {
        const prompt = buildCompanionSystemPrompt({ map: 'm', playerAction: 'how' })
        expect(prompt.endsWith('--- END ACTIVE SITE MAP ---\n\n--- PLAYER ACTION CAPABILITY ---\nhow\n--- END PLAYER ACTION CAPABILITY ---')).toBe(true)
        const messages = buildCompanionMessages({ history: [
            { role: 'user', content: 'Add a lantern.', at: '' },
            { role: 'assistant', content: 'Done.', at: '', actions: [{ action: 'State Tracker', success: true, message: 'Added INVENTORY.' }] },
        ] })
        expect(messages.slice(1)).toEqual([{ role: 'user', content: 'Add a lantern.' }, { role: 'assistant', content: 'Done.\n\n✓ State Tracker: Added INVENTORY.' }])
    })

    it('keeps a stored reply’s receipts and a stored proposed turn, each read defensively', () => {
        expect(readCompanionHistory([
            { role: 'assistant', content: 'Done.', at: 't', actions: [{ action: 'State Tracker', success: true, message: 'ok' }, { action: 7, message: 'x' }, 'junk'] },
            { role: 'user', content: 'Hi', at: 't', actions: [{ action: 'State Tracker', success: true, message: 'ok' }] },
            { role: 'assistant', content: 'Plain.', at: 't', actions: 'none' },
        ])).toEqual([
            { role: 'assistant', content: 'Done.', at: 't', actions: [{ action: 'State Tracker', success: true, message: 'ok' }] },
            { role: 'user', content: 'Hi', at: 't' },
            { role: 'assistant', content: 'Plain.', at: 't' },
        ])
        expect(readCompanionPending({ text: 'I wait.', commentary: 'Hm.', prior: [{ action: 'Map Updater', success: false, message: 'no' }] })).toEqual({ text: 'I wait.', commentary: 'Hm.', prior: [{ action: 'Map Updater', success: false, message: 'no' }] })
        expect(readCompanionPending({ text: 'I wait.' })).toEqual({ text: 'I wait.', commentary: '', prior: [] })
        for (const junk of [null, 'x', {}, { text: '  ' }, { text: 7 }]) expect(readCompanionPending(junk)).toBeNull()
    })

    it('keeps Multihog’s limits', () => {
        expect([COMPANION_MAX_ACTIONS, COMPANION_MAX_TURNS]).toEqual([4, 6])
    })
})
