import { describe, expect, it } from 'vitest'

import { DEFAULT_NPC_SECTIONS } from './creator.js'

import {
    adaptPrompt,
    archetypePrompt,
    campaignContext,
    CONTEXT_JOIN,
    DEFAULT_NPC_SECTION_NAMES,
    ensureCore,
    entryFrom,
    entryLabel,
    freeformPrompt,
    hasEntryNamed,
    normalizeAddAsIsMode,
    NPC_ARCHETYPES,
    NPC_CREATOR_TEXT,
    npcSectionNames,
    parseNpcTag,
    reviewPrompt,
    type NpcPromptContext,
} from './npc-creator.js'

const CTX: NpcPromptContext = {
    template: 'TEMPLATE',
    npcInstruction: 'NPC INSTRUCTION',
    sections: [{ name: 'Species' }, { name: 'Body' }],
    memo: '[TIME]\nCurrent: 09:40 AM, Day 5\n[/TIME]\n[QUESTS]\n- Find the bell\n[/QUESTS]',
    recent: [{ user: true, name: 'Player', text: 'I knock.' }, { user: false, name: '', text: 'The door opens.' }, { user: false, name: 'Narrator', text: '   ' }],
    narrator: 'A drowned coast.',
    lore: [{ comment: 'Mother Sedge', content: 'Keeper of the reeds.' }, { comment: '', content: 'A note.' }],
    forbidden: ['Mother Sedge', 'Loose Bill'],
}

describe('the tag', () => {
    it('reads the first [[NPC: …]] anywhere in the text, trimmed, with the keywords split', () => {
        expect(parseNpcTag('Sure! [[NPC: Kestrel Vane | [CORE]\nSpecies: Human\n[/CORE] | Kestrel Vane, Kestrel, the scout ]] done')).toEqual({ name: 'Kestrel Vane', description: '[CORE]\nSpecies: Human\n[/CORE]', keywords: ['Kestrel Vane', 'Kestrel', 'the scout'] })
        expect(parseNpcTag('[[npc: A | B | ]]')).toEqual({ name: 'A', description: 'B', keywords: [] })
        expect(parseNpcTag('no tag here')).toBeNull()
        expect(parseNpcTag('')).toBeNull()
        expect(parseNpcTag(null)).toBeNull()
    })
})

describe('the entry', () => {
    it('takes a card verbatim into [CORE], the personality after it unless the description already carries it', () => {
        expect(entryFrom({ name: 'Kestrel Vane', description: 'A scout.', personality: 'Wary.' })).toEqual({ name: 'Kestrel Vane', content: '[CORE]\nA scout.\nWary.\n[/CORE]', keys: ['Kestrel Vane', 'Kestrel'] })
        expect(entryFrom({ name: 'Orrin', description: 'A smith. Tired, owes the wrong people.', personality: 'Tired, owes the wrong people.' }).content).toBe('[CORE]\nA smith. Tired, owes the wrong people.\n[/CORE]')
        expect(entryFrom({ name: 'Orrin' }).content).toBe('[CORE]\n[/CORE]')
        expect(entryFrom({ name: '' }).name).toBe('Unnamed NPC')
        expect(entryFrom({ name: 'Orrin', description: 'x'.repeat(3500), personality: 'y'.repeat(1200) }).content).toBe(`[CORE]\n${'x'.repeat(3000)}\n${'y'.repeat(1000)}\n[/CORE]`)
    })

    it('takes the tag\'s name, content and keywords when the model has spoken, and mends stray separators', () => {
        const entry = entryFrom({ name: 'Card Name', description: 'ignored' }, '[[NPC: Kestrel Vane | [CORE]\nSpecies: Human | Personality: Wary\n[/CORE] | Kestrel Vane, Kes]]')
        expect(entry).toEqual({ name: 'Kestrel Vane', content: '[CORE]\nSpecies: Human\nPersonality: Wary\n[/CORE]', keys: ['Kestrel Vane', 'Kes'] })
        // A tag with no keywords keeps the derived keys; a reply with no tag is the content itself.
        expect(entryFrom({ name: 'Card Name' }, '[[NPC: Kestrel | text | ]]').keys).toEqual(['Card Name', 'Card'])
        expect(entryFrom({ name: 'Rec' }, 'Species: Human\nBody: Lean')).toEqual({ name: 'Rec', content: '[CORE]\nSpecies: Human\nBody: Lean\n[/CORE]', keys: ['Rec'] })
    })

    it('lets a record\'s own keys outrank the derived and the tag\'s', () => {
        expect(entryFrom({ name: 'Kestrel Vane', keys: [' Kes ', ''] }, '[[NPC: Kestrel Vane | [CORE]\nx\n[/CORE] | a, b]]').keys).toEqual(['Kes'])
        expect(entryFrom({ name: 'Kestrel Vane', keys: ['', '  '] }).keys).toEqual(['Kestrel Vane', 'Kestrel'])
    })

    it('wraps content without [CORE] in one, dropping the legacy relationship lines and the blanks around them', () => {
        expect(ensureCore('\n\nSpecies: Human\nFriendship/Rapport: 3\nBody: Lean\nAffection/Interest: 0\n\n')).toBe('[CORE]\nSpecies: Human\nBody: Lean\n[/CORE]')
        expect(ensureCore('[core]\nkept as is\n[/core]')).toBe('[core]\nkept as is\n[/core]')
    })

    it('matches an entry by its title with a leading [tag] dropped, case-blind', () => {
        expect(entryLabel('[NPC] Mother Sedge ')).toBe('mother sedge')
        expect(entryLabel(null)).toBe('')
        expect(hasEntryNamed([{ comment: '[Major] Mother Sedge' }], 'mother sedge')).toBe(true)
        expect(hasEntryNamed([{ comment: 'Mother Sedge' }], 'Sedge')).toBe(false)
        expect(hasEntryNamed([{ comment: '' }], '')).toBe(false)
    })
})

describe('the sections and the archetypes', () => {
    it('reads the names from the cartridge\'s sections, or falls back to the legacy defaults', () => {
        expect(npcSectionNames([{ name: 'Species' }, { name: ' Body ' }, { name: '' }, 'junk'])).toEqual(['Species', 'Body'])
        expect(npcSectionNames([])).toEqual([...DEFAULT_NPC_SECTION_NAMES])
        expect(npcSectionNames([{ id: 'x' }])).toEqual([...DEFAULT_NPC_SECTION_NAMES])
        expect(npcSectionNames(undefined)).toHaveLength(9)
        expect([...DEFAULT_NPC_SECTION_NAMES]).toEqual(DEFAULT_NPC_SECTIONS.map((section) => section.name))
        expect(NPC_ARCHETYPES.map((a) => a.id)).toEqual(['Enemy', 'Arch Nemesis', 'Lover', 'Family Relative', 'Companion / Ally', 'Merchant', 'Mysterious Stranger', 'Rival', 'Custom'])
    })

    it('reads the Add as is mode with the legacy default', () => {
        expect(normalizeAddAsIsMode('literal')).toBe('literal')
        expect(normalizeAddAsIsMode('ai_review')).toBe('ai_review')
        expect(normalizeAddAsIsMode(undefined)).toBe('ai_review')
        expect(normalizeAddAsIsMode('nope')).toBe('ai_review')
    })
})

describe('the prompts', () => {
    it('gathers the campaign context as the legacy does: the state without the quests, the last eight messages named, the narrator, twelve entries', () => {
        const parts = campaignContext(CTX)
        expect(parts).toEqual([
            'CURRENT GAME STATE:\n[TIME]\nCurrent: 09:40 AM, Day 5\n[/TIME]',
            'RECENT CHAT (for setting/tone context):\nPlayer: I knock.\n\nCharacter: The door opens.',
            'NARRATOR/WORLD CARD:\nA drowned coast.',
            'ACTIVE LOREBOOK ENTRIES (world context):\n[Mother Sedge]: Keeper of the reeds.\n[Entry]: A note.',
        ])
        expect(campaignContext({ ...CTX, memo: '', recent: [], narrator: '', lore: [] })).toEqual([])
        const many = Array.from({ length: 14 }, (_, i) => ({ comment: `E${i}`, content: 'c' }))
        expect(campaignContext({ ...CTX, lore: many })[3]!.split('\n')).toHaveLength(13)
        const long = Array.from({ length: 12 }, (_, i) => ({ user: i % 2 === 0, name: `N${i}`, text: 't' }))
        expect(campaignContext({ ...CTX, recent: long })[1]).not.toContain('N3:')
        expect(campaignContext({ ...CTX, recent: long })[1]).toContain('N4:')
    })

    it('builds the review prompt: the template first, the rules whole, the card and the capped context', () => {
        const prompt = reviewPrompt({ name: 'Kestrel', description: 'd'.repeat(3100), personality: 'p'.repeat(1100) }, { ...CTX, memo: 'm'.repeat(2100), narrator: 'n'.repeat(1600) })
        expect(prompt.system.startsWith('TEMPLATE\n\n---\n\nYou are an NPC Minimal Review Agent.')).toBe(true)
        expect(prompt.system.endsWith(NPC_CREATOR_TEXT.reviewSeparator)).toBe(true)
        const parts = prompt.user.split(CONTEXT_JOIN)
        expect(parts[0]).toBe(`CHARACTER CARD:\nName: Kestrel\nDescription: ${'d'.repeat(3000)}\nPersonality: ${'p'.repeat(1000)}`)
        expect(parts[1]).toBe(`CURRENT GAME STATE:\n${'m'.repeat(2000)}`)
        expect(parts[2]).toBe('RECENT CHAT (for setting context):\nPlayer: I knock.\n\nCharacter: The door opens.')
        expect(parts[3]).toBe(`NARRATOR/WORLD CARD:\n${'n'.repeat(1500)}`)
        expect(parts).toHaveLength(4)
        expect(reviewPrompt({ name: '' }, CTX).user.startsWith('CHARACTER CARD:\nName: Unnamed\nDescription: \nPersonality: ')).toBe(true)
    })

    it('builds the adaptation prompt: the instruction inside its tags, the section names twice, the lore last, and the length rule only when asked', () => {
        const prompt = adaptPrompt({ name: 'Kestrel', description: 'A scout.', personality: 'Wary.' }, CTX)
        expect(prompt.system).toContain('<npc_instructions>\nNPC INSTRUCTION\n</npc_instructions>')
        expect(prompt.system.match(/\(Species, Body\)/g)).toHaveLength(2)
        expect(prompt.system).not.toContain('MATCH LENGTH')
        expect(prompt.system.endsWith('No preamble, no explanation, no other tags.')).toBe(true)
        expect(adaptPrompt({ name: 'K' }, { ...CTX, matchLength: true }).system).toContain('distinguishing traits.\n- MATCH LENGTH:')
        const parts = prompt.user.split(CONTEXT_JOIN)
        expect(parts[0]).toBe('CHARACTER CARD:\nName: Kestrel\nDescription: A scout.\nPersonality: Wary.')
        expect(parts[2]).toBe('RECENT CHAT (for setting context):\nPlayer: I knock.\n\nCharacter: The door opens.')
        expect(parts[4]).toBe('ACTIVE LOREBOOK ENTRIES (world context):\n[Mother Sedge]: Keeper of the reeds.\n[Entry]: A note.')
        // The adaptation reads ten messages and fifteen entries; the state is not capped.
        const long = Array.from({ length: 12 }, (_, i) => ({ user: false, name: `N${i}`, text: 't' }))
        expect(adaptPrompt({ name: 'K' }, { ...CTX, recent: long }).user).toContain('N2:')
        expect(adaptPrompt({ name: 'K' }, { ...CTX, recent: long }).user).not.toContain('N1:')
        const many = Array.from({ length: 20 }, (_, i) => ({ comment: `E${i}`, content: 'c' }))
        expect(adaptPrompt({ name: 'K' }, { ...CTX, lore: many }).user).toContain('[E14]')
        expect(adaptPrompt({ name: 'K' }, { ...CTX, lore: many }).user).not.toContain('[E15]')
        expect(adaptPrompt({ name: 'K' }, { ...CTX, memo: 'm'.repeat(2500), recent: [], lore: [] }).user).toContain('m'.repeat(2500))
    })

    it('builds the freeform prompt: the concept first, the forbidden names, the naming rule last', () => {
        const prompt = freeformPrompt({ name: 'Igor', description: 'A hunchback.' }, CTX)
        expect(prompt.system.startsWith('TEMPLATE\n\n---\n\nYou are an NPC Creation Agent. The user has provided')).toBe(true)
        expect(prompt.system).toContain('\nForbidden Names (Do NOT use these existing NPC/character names under any circumstances):\n- Mother Sedge\n- Loose Bill\n\n<npc_instructions>\nNPC INSTRUCTION\n</npc_instructions>')
        expect(prompt.system.endsWith(NPC_CREATOR_TEXT.namingRule)).toBe(true)
        expect(prompt.system.match(/\(Species, Body\)/g)).toHaveLength(2)
        expect(prompt.user.split(CONTEXT_JOIN)[0]).toBe('USER\'S NPC CONCEPT:\nName: Igor\nDescription: A hunchback.')
        expect(prompt.user.split(CONTEXT_JOIN)[1]).toBe('CURRENT GAME STATE:\n[TIME]\nCurrent: 09:40 AM, Day 5\n[/TIME]')
        const bare = freeformPrompt({ name: '', description: 'x' }, { ...CTX, forbidden: [] })
        expect(bare.user.split(CONTEXT_JOIN)[0]).toBe('USER\'S NPC CONCEPT:\nDescription: x')
        expect(bare.system).not.toContain('Forbidden Names (Do NOT')
        expect(bare.system).toContain('campaign.\n\n<npc_instructions>')
    })

    it('builds the archetype prompt: the request first, the desired name and the concept only when given', () => {
        const prompt = archetypePrompt({ archetype: 'Rival', name: 'Mira', concept: 'A duellist.' }, CTX)
        expect(prompt.system.startsWith('TEMPLATE\n\n---\n\nYou are an NPC Creation Agent. Create a new NPC')).toBe(true)
        expect(prompt.system).toContain('- The NPC MUST embody the requested archetype')
        expect(prompt.system.endsWith(NPC_CREATOR_TEXT.namingRule)).toBe(true)
        expect(prompt.user.split(CONTEXT_JOIN)[0]).toBe('ARCHETYPE REQUEST:\nArchetype: Rival\nDesired Name: Mira\nAdditional concept: A duellist.\n')
        expect(archetypePrompt({ archetype: 'Enemy', name: '', concept: '' }, CTX).user.split(CONTEXT_JOIN)[0]).toBe('ARCHETYPE REQUEST:\nArchetype: Enemy\n')
    })
})
