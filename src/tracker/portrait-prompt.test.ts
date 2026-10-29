import { describe, expect, it } from 'vitest'

import {
    blockNames,
    buildCharacterPortraitPrompt,
    buildNpcPortraitPrompt,
    characterBlockNames,
    enemyEntities,
    keyMeetsName,
    lookbackCount,
    partyMembers,
    portraitRoster,
    storyContext,
} from './portrait-prompt.js'

const MEMO = [
    '[CHARACTER]',
    'Thessaly Brook (Rogue 3): 21/24 HP',
    'Gear: dagger',
    '[/CHARACTER]',
    '[PARTY]',
    '- Perrin O\'Dwyer (Ranger): 12/12 HP',
    '• Mother Sedge: 8/8 HP',
    'Notes: tired',
    '[/PARTY]',
    '[COMBAT]',
    'Combat Round 2',
    'ALLIES:',
    'Thessaly Brook (Rogue 3): 21/24 HP',
    'perrin o\'dwyer (ranger): 12/12 HP',
    'ENEMIES:',
    '- Moth Wraith (a construct): 4/10 HP',
    'Kestrel ((BAR)) 4/10',
    '[/COMBAT]',
    '[QUESTS]',
    'QUEST: Find the rat',
    '[/QUESTS]',
].join('\n')

describe('the roster the portraits are drawn for (61)', () => {
    it('reads the party from its HP lines, a bullet before a name dropped', () => {
        expect(partyMembers(MEMO)).toEqual(['Perrin O\'Dwyer (Ranger)', 'Mother Sedge'])
        expect(partyMembers('')).toEqual([])
        expect(partyMembers('[PARTY]\nnobody here\n[/PARTY]')).toEqual([])
    })

    it('reads the character from the HP line, else the first line as the legacy does', () => {
        expect(characterBlockNames(MEMO)).toEqual(['Thessaly Brook (Rogue 3)'])
        expect(characterBlockNames('[CHARACTER]\nName: Robin Vale\nLevel: 2\n[/CHARACTER]')).toEqual(['Robin Vale'])
        expect(characterBlockNames('[CHARACTER]\nRobin Vale: a halfling\nLevel: 2\n[/CHARACTER]')).toEqual(['Robin Vale'])
        expect(characterBlockNames('[CHARACTER]\nRobin Vale\nLevel: 2\n[/CHARACTER]')).toEqual(['Robin Vale'])
        expect(characterBlockNames('[CHARACTER]\n\n[/CHARACTER]')).toEqual([])
        expect(characterBlockNames('nothing')).toEqual([])
    })

    it('reads the enemies as the combat lines that are neither the party nor the character, compared in upper case, the round header skipped', () => {
        expect(enemyEntities(MEMO)).toEqual(['Moth Wraith (a construct)'])
        // The legacy compares the names as written, case aside: a class dropped from the combat line makes an enemy of an ally.
        expect(enemyEntities('[PARTY]\nPerrin (Ranger): 12/12 HP\n[/PARTY]\n[COMBAT]\nPerrin: 12/12 HP\n[/COMBAT]')).toEqual(['Perrin'])
        expect(enemyEntities('[COMBAT]\nCombat Round 1\n[/COMBAT]')).toEqual([])
    })

    it('gathers the three', () => {
        expect(portraitRoster(MEMO)).toEqual({ character: 'Thessaly Brook (Rogue 3)', party: ['Perrin O\'Dwyer (Ranger)', 'Mother Sedge'], enemies: ['Moth Wraith (a construct)'] })
        expect(portraitRoster('')).toEqual({ character: null, party: [], enemies: [] })
    })
})

describe('the recent story (61)', () => {
    const lines = [{ name: 'Wrenna', text: 'I open the door.' }, { name: 'Narrator', text: '' }, { name: 'Narrator', text: 'It creaks.' }, { name: 'Wrenna', text: 'Hello?' }]

    it('takes the last N non-empty lines as Name: text under the label, counting what it took', () => {
        expect(storyContext(lines, 2)).toBe('Recent Chat Context (Last 2 Messages):\nIt creaks.\n\nWrenna: Hello?'.replace('It creaks.', 'Narrator: It creaks.'))
        expect(storyContext(lines, 1, { label: 'Recent Scene Context' })).toBe('Recent Scene Context (Last 1 Message):\nWrenna: Hello?')
        expect(storyContext(lines, 10)).toContain('(Last 3 Messages)')
    })

    it('cuts at maxChars, and is empty for no lines or a lookback of 0', () => {
        expect(storyContext(lines, 3, { maxChars: 20 })).toBe('Recent Chat Context (Last 3 Messages):\nWrenna: I open the d')
        expect(storyContext([], 3)).toBe('')
        expect(storyContext(lines, 0)).toBe('')
        expect(storyContext([{ name: 'A', text: '  ' }], 3)).toBe('')
    })

    it('reads the count as the legacy does: 5 unreadable, 0 to 100, whole', () => {
        expect(lookbackCount(undefined)).toBe(5)
        expect(lookbackCount('x')).toBe(5)
        expect(lookbackCount(7.9)).toBe(7)
        expect(lookbackCount(-2)).toBe(0)
        expect(lookbackCount(500)).toBe(100)
    })
})

describe('the character portrait prompt (61)', () => {
    const base = { name: 'Perrin O\'Dwyer', memo: MEMO, narratorDescription: 'A grim narrator.', systemPrompt: 'Describe {{name}} in {{wordtarget}} words.', wordTarget: 150 }

    it('names the entity, quotes every block that names them, and the card, with the placeholders filled', () => {
        const { system, user } = buildCharacterPortraitPrompt(base)
        expect(system).toBe('Describe Perrin O\'Dwyer in 150 words.')
        expect(user.split('\n\n---\n\n')).toEqual([
            'Character Name: Perrin O\'Dwyer',
            `[PARTY] block (from State Memo):\n- Perrin O'Dwyer (Ranger): 12/12 HP\n• Mother Sedge: 8/8 HP\nNotes: tired`,
            `[COMBAT] block (from State Memo):\nCombat Round 2\nALLIES:\nThessaly Brook (Rogue 3): 21/24 HP\nperrin o'dwyer (ranger): 12/12 HP\nENEMIES:\n- Moth Wraith (a construct): 4/10 HP\nKestrel ((BAR)) 4/10`,
            'Character Card Description:\nA grim narrator.',
        ])
    })

    it('leaves out an absent card, a block that does not name them, and the lookback when off; the word target falls to 200', () => {
        const { system, user } = buildCharacterPortraitPrompt({ ...base, name: 'Kestrel', narratorDescription: '', wordTarget: 0 })
        expect(system).toBe('Describe Kestrel in 200 words.')
        expect(user.split('\n\n---\n\n').map((p) => p.split('\n')[0])).toEqual(['Character Name: Kestrel', '[COMBAT] block (from State Memo):'])
        expect(user).not.toContain('User Persona')
    })

    it('cuts the card at 2000 characters', () => {
        const { user } = buildCharacterPortraitPrompt({ ...base, narratorDescription: 'x'.repeat(2500) })
        expect(user).toContain(`Character Card Description:\n${'x'.repeat(2000)}`)
        expect(user).not.toContain('x'.repeat(2001))
    })

    it('with the lookback on, adds the persona, the matching lore at 800 characters each, the game state without markers or quests, and the story', () => {
        const { user } = buildCharacterPortraitPrompt({
            ...base,
            lookback: {
                persona: ' A tired knight. ',
                lore: [{ label: 'Perrin', content: 'y'.repeat(900) }, { label: '', content: 'Short.' }],
                story: [{ name: 'Wrenna', text: 'Hello?' }, { name: 'Narrator', text: 'The ranger nods.' }],
                count: 1,
            },
        })
        const parts = user.split('\n\n---\n\n')
        expect(parts[4]).toBe('User Persona:\nA tired knight.')
        expect(parts[5]).toBe(`Matching Lorebook Entries:\n[Lorebook: Perrin]\n${'y'.repeat(800)}\n\n[Lorebook: Entry]\nShort.`)
        expect(parts[6]!.startsWith('Current Game State:\n[CHARACTER]')).toBe(true)
        expect(parts[6]).not.toContain('[QUESTS]')
        expect(parts[6]).not.toContain('((BAR))')
        expect(parts[7]).toBe('Recent Chat Context (Last 1 Message):\nNarrator: The ranger nods.')
    })

    it('with the lookback on but nothing to add, adds only the game state', () => {
        const { user } = buildCharacterPortraitPrompt({ ...base, lookback: { persona: '', lore: [], story: [], count: 5 } })
        const parts = user.split('\n\n---\n\n')
        expect(parts).toHaveLength(5)
        expect(parts[4]!.startsWith('Current Game State:\n')).toBe(true)
    })

    it('matches a block and a keyword case-blind, as the legacy does', () => {
        expect(blockNames('PERRIN O\'DWYER: 12/12 HP', 'perrin o\'dwyer')).toBe(true)
        expect(blockNames('Mother Sedge', 'Perrin')).toBe(false)
        expect(keyMeetsName('perrin', 'Perrin O\'Dwyer')).toBe(true)
        expect(keyMeetsName('Perrin O\'Dwyer the Ranger', 'perrin o\'dwyer')).toBe(true)
        expect(keyMeetsName('Sedge', 'Perrin')).toBe(false)
        expect(keyMeetsName('', 'Perrin')).toBe(false)
    })
})

describe('the NPC portrait prompt (61)', () => {
    const base = { name: 'Orrin', content: '[CORE]\nA smith.\n[/CORE]', systemPrompt: 'NPC {{name}}, {{wordtarget}} words.', wordTarget: 120 }

    it('is the library photo prompt when the lookback is off', () => {
        const { system, user } = buildNpcPortraitPrompt(base)
        expect(system).toBe('NPC Orrin, 120 words.')
        expect(user).toBe('NPC Name: Orrin\n\n---\n\nNPC Lorebook Entry:\n[CORE]\nA smith.\n[/CORE]')
    })

    it('with the lookback on, adds the persona for art style, the narrator’s card for the world at 1500 characters, and the recent scene at 4000', () => {
        const { user } = buildNpcPortraitPrompt({
            ...base,
            lookback: { persona: 'A tired knight.', narratorDescription: 'n'.repeat(1600), story: [{ name: 'Narrator', text: 's'.repeat(5000) }], count: 5 },
        })
        const parts = user.split('\n\n---\n\n')
        expect(parts[2]).toBe('User Persona (for art style context):\nA tired knight.')
        expect(parts[3]).toBe(`Narrator Card Description (for world context):\n${'n'.repeat(1500)}`)
        expect(parts[4]).toBe(`Recent Scene Context (Last 1 Message):\n${('Narrator: ' + 's'.repeat(5000)).substring(0, 4000)}`)
        expect(parts).toHaveLength(5)
    })

    it('with the lookback on but nothing to add, is the photo prompt again', () => {
        const { user } = buildNpcPortraitPrompt({ ...base, lookback: { persona: ' ', narratorDescription: '', story: [], count: 5 } })
        expect(user.split('\n\n---\n\n')).toHaveLength(2)
    })
})
