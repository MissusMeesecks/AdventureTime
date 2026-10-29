import { describe, expect, it } from 'vitest'

import {
    activeBlocks,
    alreadyHadSheet,
    archetypesForGenre,
    buildCardPrompt,
    buildSheetPrompt,
    buildWaysPrompt,
    CARD_WORD_OPTIONS,
    cardBlock,
    cardFieldOf,
    cardName,
    checkSheet,
    classOptions,
    CLASS_OTHER,
    CLASS_STORY,
    CREATOR_GENRES,
    DEFAULT_PC_SECTIONS,
    emptyDraft,
    extractCharacterName,
    findPreset,
    GEAR_TIERS,
    INSTANT_GENRES,
    INSTANT_SETUP_MAX,
    instantOpeningMessage,
    instantSetupLevel,
    isCardTarget,
    normalizeDraft,
    normalizeGearTier,
    normalizeGenre,
    normalizeCardWords,
    normalizeInstantGenre,
    normalizeInstantSetup,
    normalizeLevel,
    parseCardSections,
    patchCard,
    randomArchetype,
    resolveInstantLevel,
    rollInstantLevel,
    rollCreatorName,
    upsertPreset,
    XP_LEVEL_THRESHOLDS,
    type CreatorDraft,
 buildImportPrompt, buildImportBio, normalizeImportMode, normalizeImportWords, IMPORT_WORD_OPTIONS } from './creator.js'

const DEFAULTS = { level: 1 as const, gearTier: 'auto' as const, combatScalingGuide: true }
const SETTINGS = { modules: { character: true, inventory: true, abilities: true, spells: true, xp: true, time: true, party: true, quests: true, combat: true }, customFields: [{ tag: 'HUNGER', enabled: true }, { tag: 'OFF', enabled: false }], useDdMmYyFormat: false }
const CONTEXT = { settings: SETTINGS, initialDate: 'Day 1', initialTime: '08:00 AM' }

describe('the lists and the draft', () => {
    it('offers the legacy\'s genres, gear tiers and levels, and reads a stored value back to one of them', () => {
        expect(CREATOR_GENRES.map((g) => g.value)).toEqual(['', 'fantasy', 'realistic', 'scifi', 'horror'])
        expect(GEAR_TIERS.map((t) => t.value)).toEqual(['auto', 'mundane', 'low', 'standard', 'well_equipped', 'heroic', 'none'])
        expect(normalizeGenre('scifi')).toBe('scifi')
        expect(normalizeGenre('western')).toBe('')
        expect(normalizeGearTier('heroic')).toBe('heroic')
        expect(normalizeGearTier('golden')).toBe('auto')
        expect(normalizeLevel('none')).toBe('none')
        expect(normalizeLevel(null)).toBe('none')
        expect(normalizeLevel('7')).toBe(7)
        expect(normalizeLevel(45)).toBe(20)
        expect(normalizeLevel('x')).toBe(1)
        expect(XP_LEVEL_THRESHOLDS[1]).toBe(300)
    })

    it('lists a genre\'s classes with the two constants after them, and only the constants without a genre', () => {
        const fantasy = classOptions('fantasy')
        expect(fantasy).toHaveLength(22)
        expect(fantasy[0]).toEqual({ value: 'Fighter', label: '⚔️ Fighter' })
        expect(fantasy.slice(-2).map((o) => o.value)).toEqual([CLASS_OTHER, CLASS_STORY])
        expect(classOptions('').map((o) => o.value)).toEqual([CLASS_OTHER, CLASS_STORY])
        expect(classOptions('horror').some((o) => o.value === 'Occultist')).toBe(true)
        expect(archetypesForGenre('scifi')).toHaveLength(20)
        expect(archetypesForGenre('scifi')).toContain('Netrunner')
        expect(archetypesForGenre('nonsense')).toEqual(archetypesForGenre('fantasy'))
    })

    it('starts a draft empty on the defaults, and reads a stored draft back safely', () => {
        const empty = emptyDraft(DEFAULTS)
        expect(empty).toMatchObject({ name: '', genre: '', level: 1, gearTier: 'auto', combatScalingGuide: true, class: CLASS_STORY })
        const stored = normalizeDraft({ name: 'Robin', genre: 'fantasy', level: '5', gearTier: 'heroic', combatScalingGuide: false, class: 'Rogue', traits: 'wry', extra: 'ignored', age: 7 }, DEFAULTS)
        expect(stored).toMatchObject({ name: 'Robin', genre: 'fantasy', level: 5, gearTier: 'heroic', combatScalingGuide: false, class: 'Rogue', traits: 'wry', age: '' })
        expect('extra' in stored).toBe(false)
        // A class the genre does not offer is the model's choice again; a missing level is the default.
        expect(normalizeDraft({ genre: 'scifi', class: 'Rogue' }, DEFAULTS).class).toBe(CLASS_STORY)
        expect(normalizeDraft({ genre: '', class: CLASS_OTHER, classOther: 'Beekeeper' }, DEFAULTS)).toMatchObject({ class: CLASS_OTHER, classOther: 'Beekeeper' })
        expect(normalizeDraft(null, { ...DEFAULTS, level: 'none' }).level).toBe('none')
        expect(normalizeDraft('nope', DEFAULTS)).toEqual(emptyDraft(DEFAULTS))
    })
})

describe('the prompt', () => {
    const draft: CreatorDraft = { ...emptyDraft(DEFAULTS), name: 'Robin Vale', gender: 'she', species: 'halfling', genre: 'fantasy', level: 3, gearTier: 'standard', class: 'Rogue', traits: 'wry, light-fingered', background: 'ran with the Vell cutpurses', appearance: 'scar on one cheek' }

    it('asks for the sheet at the level, in the genre, with the class, the hints, the active blocks and the legacy\'s rules', () => {
        const { prompt, extraHints, cardSnippet } = buildSheetPrompt(draft, CONTEXT)
        expect(prompt.startsWith('STARTING LEVEL: 3 (mandatory — the character MUST be exactly Level 3).')).toBe(true)
        expect(prompt).toContain('Name:         Robin Vale')
        expect(prompt).toContain('Gender:       she')
        expect(prompt).toContain('Species:      halfling')
        expect(prompt).toContain('Class: Rogue')
        expect(prompt).toContain('Traits:       wry, light-fingered')
        expect(prompt).toContain('Level:        3')
        expect(prompt).toContain('• Use the provided name "Robin Vale" exactly; do not alter or replace it.')
        expect(prompt).toContain('• Use the chosen class "Rogue" exactly as given — do not rename or substitute it.')
        expect(prompt).toContain('Output every currently active state-memo field (enabled stock modules and custom fields): CHARACTER, INVENTORY, ABILITIES, SPELLS, XP, TIME, HUNGER.')
        expect(prompt).toContain('[/CHARACTER], [/INVENTORY], [/ABILITIES], [/SPELLS], [/XP], [/TIME], [/HUNGER]')
        expect(prompt).toContain('MANDATORY [XP] BLOCK')
        expect(prompt).toContain('Level: 3 | XP: 0/2,700')
        expect(prompt).toContain('Current Time: 08:00 AM, Day 1')
        expect(prompt).toContain('• STARTING GEAR: Standard kit for Level 3')
        expect(prompt).toContain('--- COMBAT & SKILL SCALING GUIDE ---')
        expect(prompt).not.toContain('CRITICAL REALISM RULE')
        expect(prompt).not.toContain('CHARACTER CARD CONTEXT')
        expect(extraHints).toContain('Name: Robin Vale\n')
        expect(extraHints).toContain('Background Hints: ran with the Vell cutpurses')
        expect(cardSnippet).toBe('')
        expect(activeBlocks(SETTINGS)).toEqual(['CHARACTER', 'INVENTORY', 'ABILITIES', 'SPELLS', 'XP', 'TIME', 'HUNGER'])
    })

    it('leaves the model to invent what is blank, and says so when there is no genre, no level and no class', () => {
        const blank = buildSheetPrompt(emptyDraft({ ...DEFAULTS, level: 'none' }), CONTEXT)
        expect(blank.prompt.startsWith('LEVEL SYSTEM: This character creation system does not use numeric character levels.')).toBe(true)
        expect(blank.prompt).toContain('Name:         (invent a creative, setting-appropriate name')
        expect(blank.prompt).toContain('Class: (choose a class that fits the current story, setting, and card naturally — be creative)')
        expect(blank.prompt).toContain('Level:        N/A — this system has no numeric levels')
        expect(blank.prompt).toContain('• Invent the most fitting class for the setting and context.')
        expect(blank.prompt).not.toContain('MANDATORY [XP] BLOCK')
        expect(blank.extraHints).toBe('')
        const other = buildSheetPrompt({ ...emptyDraft(DEFAULTS), class: CLASS_OTHER, classOther: 'Beekeeper' }, CONTEXT)
        expect(other.prompt).toContain('Class: Beekeeper')
    })

    it('carries the genre\'s rules, the calendar, the narrator\'s card, and leaves out what is switched off', () => {
        const modern = buildSheetPrompt({ ...draft, genre: 'realistic', class: 'Detective', gearTier: 'none', combatScalingGuide: false }, { settings: { modules: { character: true, time: true }, customFields: [], useDdMmYyFormat: true }, initialDate: '14/02/2026', initialTime: '21:30', card: { name: 'Gorm', description: 'A grim narrator.' } })
        expect(modern.prompt).toContain('CRITICAL REALISM RULE: This is a realistic/non-fantasy setting.')
        expect(modern.prompt).toContain('Current Time: 21:30, 14/02/2026')
        expect(modern.prompt).toContain('--- CHARACTER CARD CONTEXT ---\nActive Card: Gorm — A grim narrator.')
        expect(modern.cardSnippet).toBe('\nActive Card: Gorm — A grim narrator.')
        expect(modern.prompt).toContain('(enabled stock modules and custom fields): CHARACTER, TIME.')
        expect(modern.prompt).not.toContain('MANDATORY [XP] BLOCK')
        expect(modern.prompt).not.toContain('STARTING GEAR')
        expect(modern.prompt).not.toContain('COMBAT & SKILL SCALING GUIDE')
        expect(modern.prompt).toContain('scale/adjust HP, stats, saves, capabilities, and gear (everything a character of that level might have) to Level 3 accordingly, but do NOT output an [XP] block as it is disabled')
        // The host's settings are read only for the call: a second prompt with no card has none.
        expect(buildSheetPrompt(draft, CONTEXT).cardSnippet).toBe('')
    })

    it('lets Instant Action\'s setup outrank the rolled class and level (35a)', () => {
        const quick = buildSheetPrompt({ ...draft, class: 'Fighter' }, { ...CONTEXT, instantActionInstructions: 'A 28-year-old ranger with a crossbow, 5th-level, in a storm-battered frontier town' })
        expect(quick.prompt).toContain('--- INITIAL SETUP: ---\nA 28-year-old ranger')
        expect(quick.prompt).toContain('Class: Fighter (fallback — if the Initial Setup specifies or clearly implies a different class, follow the Initial Setup instead)')
        expect(quick.prompt.startsWith('STARTING LEVEL: 5 (mandatory')).toBe(true)
        expect(quick.prompt).toContain('Level: 5 | XP: 0/14,000')
    })
})

describe('Instant Action\'s rolls (35a)', () => {
    it('offers the four genres, falls back to fantasy, and rolls an archetype from the genre\'s list', () => {
        expect(INSTANT_GENRES.map((g) => g.value)).toEqual(['fantasy', 'realistic', 'scifi', 'horror'])
        expect(normalizeInstantGenre('horror')).toBe('horror')
        expect(normalizeInstantGenre('western')).toBe('fantasy')
        expect(normalizeInstantGenre(undefined)).toBe('fantasy')
        expect(randomArchetype('fantasy', () => 0)).toBe(archetypesForGenre('fantasy')[0])
        expect(randomArchetype('scifi', () => 0.999)).toBe(archetypesForGenre('scifi').at(-1))
        expect(randomArchetype('fantasy', () => 0.5)).toBe('Barbarian')
        expect(randomArchetype('scifi', () => 0.5)).toBe('Bounty Hunter')
        // An unknown genre rolls from the fantasy list, as the legacy's list lookup falls back.
        expect(randomArchetype('western', () => 0.5)).toBe('Barbarian')
    })

    it('rolls a level of 1 to 10, trims and cuts the setup, reads a level out of it, and opens with the legacy\'s message', () => {
        expect(rollInstantLevel(() => 0)).toBe(1)
        expect(rollInstantLevel(() => 0.999)).toBe(10)
        expect(rollInstantLevel(() => 0.5)).toBe(6)
        // 45d: level 1 unless Random level, none for a system without levels.
        expect(resolveInstantLevel({ random: () => 0.5 })).toBe(1)
        expect(resolveInstantLevel({ randomLevel: true, random: () => 0.5 })).toBe(6)
        expect(resolveInstantLevel({ randomLevel: true, random: () => 0.999 })).toBe(10)
        expect(resolveInstantLevel({ noLevel: true, randomLevel: true })).toBeNull()
        expect(resolveInstantLevel()).toBe(1)
        expect(INSTANT_SETUP_MAX).toBe(1000)
        expect(normalizeInstantSetup('  A heist.  ')).toBe('A heist.')
        expect(normalizeInstantSetup('x'.repeat(1200))).toHaveLength(1000)
        expect(normalizeInstantSetup(null)).toBe('')
        expect(instantSetupLevel('A level 7 rogue')).toBe(7)
        expect(instantSetupLevel('Lvl 25 god')).toBeNull()
        expect(instantSetupLevel('A rogue')).toBeNull()
        expect(instantOpeningMessage('')).toBe('Begin the adventure')
        expect(instantOpeningMessage('A heist.')).toBe('Begin the adventure.\n\nInitial Setup:\nA heist.')
    })
})

describe('the Player Card (35b)', () => {
    it('reads a word count back into the legacy\'s bounds', () => {
        expect(CARD_WORD_OPTIONS).toEqual([100, 150, 200, 300, 400, 500, 750, 1000])
        expect(normalizeCardWords(300)).toBe(300)
        expect(normalizeCardWords('750')).toBe(750)
        expect(normalizeCardWords(10)).toBe(50)
        expect(normalizeCardWords(9000)).toBe(5000)
        expect(normalizeCardWords(149.6)).toBe(150)
        expect(normalizeCardWords('x')).toBe(150)
        expect(normalizeCardWords(undefined)).toBe(150)
    })

    it('builds the writer\'s prompt from the sections, the cleaned memo, the recent story and the word count', () => {
        const story = [
            { user: false, name: 'Narrator', text: 'The gate creaks.' },
            { user: true, name: 'Quill', text: 'I step through.' },
            { user: false, name: 'Narrator', text: '' },
            { user: false, name: 'Narrator', text: 'Inside, dust.' },
        ]
        const { system, user } = buildCardPrompt('Robin Vale', 200, { memo: '<memo>[CHARACTER]\nRobin Vale (Rogue 3)\n[/CHARACTER]</memo>', settings: { pcCoreSections: [], directPromptContext: 2 }, story, extraHints: '\n\n--- HINTS ---\nwry' })
        expect(system).toContain('write a persona description for Robin Vale in third person.\n\n--- HINTS ---\nwry')
        for (const section of DEFAULT_PC_SECTIONS) expect(system).toContain(`${section.name}:\n${section.description}`)
        expect(system).toContain('Total word count across all sections: approximately 200 words.')
        expect(system).toContain(`Output ONLY the ${DEFAULT_PC_SECTIONS.length} sections listed above.`)
        expect(user).toContain('CHARACTER CARD:\n[CHARACTER]\nRobin Vale (Rogue 3)\n[/CHARACTER]')
        expect(user).not.toContain('<memo>')
        // Two of the three non-empty lines, as the window says; the empty one is skipped, not counted.
        expect(user).toContain('## RECENT STORY (Last 2 messages)\nPlayer: I step through.\n\nNarrator: Inside, dust.')
        expect(user).toContain('Write the persona description for Robin Vale.\nIMPORTANT REMINDER: The total word count across all sections MUST be approximately 200 words!')
        // The settings' own sections replace the stock eight; no window falls back to fifteen; a nameless card is "this character".
        const custom = buildCardPrompt('', 100, { memo: '', settings: { pcCoreSections: [{ name: 'Look', description: 'How they look.' }] }, story: Array.from({ length: 20 }, (_, i) => ({ user: false, name: 'N', text: `line ${i}` })) })
        expect(custom.system).toContain('persona description for this character in third person.')
        expect(custom.system).toContain('Look:\nHow they look.')
        expect(custom.system).not.toContain('Personality:')
        expect(custom.system).toContain('Output ONLY the 1 sections listed above.')
        expect(custom.user).toContain('## RECENT STORY (Last 15 messages)\nN: line 5\n')
        expect(custom.user).toContain('Write the persona description for this character.')
        // With the block preferred, the [CHARACTER] block leads the card; no story means no story section.
        const led = buildCardPrompt('X', 150, { memo: '[TIME]\nDay 1\n[/TIME]\n[CHARACTER]\nX\n[/CHARACTER]', settings: {}, story: [], preferCharacterBlock: true })
        expect(led.user).toContain('CHARACTER CARD:\n[CHARACTER]\nX\n[/CHARACTER]\n\n[TIME]')
        expect(led.user).not.toContain('RECENT STORY')
    })

    it('names the card as the legacy does, wraps it for the narrator, and reads it back as sections', () => {
        expect(cardName('Robin "Vale"')).toBe('Robin Vale')
        expect(cardName("  O'Neil  ")).toBe('ONeil')
        expect(cardName('')).toBe('My Character')
        expect(cardName(null)).toBe('My Character')
        expect(cardBlock('Robin', 'Body: Short.')).toBe('[PLAYER_CHARACTER]\nName: Robin\nBody: Short.\n[/PLAYER_CHARACTER]')
        expect(parseCardSections('Species: Halfling\nBody: Short, scarred.\nA second line.\n\n**Worn Equipment:** A duster.\nPersonality:\nWry.')).toEqual([
            { label: 'Species', text: 'Halfling' },
            { label: 'Body', text: 'Short, scarred.\nA second line.' },
            { label: 'Worn Equipment', text: 'A duster.' },
            { label: 'Personality', text: 'Wry.' },
        ])
        expect(parseCardSections('Just prose.\nMore prose.')).toEqual([{ label: '', text: 'Just prose.\nMore prose.' }])
        expect(parseCardSections('')).toEqual([])
        // A colon mid-sentence is not a header; a header is a capitalised short label.
        expect(parseCardSections('Body: He says: hello.\nshe said: no')).toEqual([{ label: 'Body', text: 'He says: hello.\nshe said: no' }])
    })

    it('knows the agent\'s targets for the card, and patches Body and Worn Equipment only', () => {
        expect(isCardTarget('{{user}}', 'Robin')).toBe(true)
        expect(isCardTarget('player', '')).toBe(true)
        expect(isCardTarget('robin', 'Robin')).toBe(true)
        expect(isCardTarget('Oswin', 'Robin')).toBe(false)
        expect(isCardTarget('', 'Robin')).toBe(false)
        expect(isCardTarget(7, '')).toBe(false)
        expect(cardFieldOf('Body')).toBe('Body')
        expect(cardFieldOf('appearance')).toBe('Body')
        expect(cardFieldOf('Worn Equipment')).toBe('Worn Equipment')
        expect(cardFieldOf('gear')).toBe('Worn Equipment')
        expect(cardFieldOf('Personality')).toBeNull()
        expect(cardFieldOf('')).toBeNull()
        const bio = 'Species: Halfling\nBody: Short, scarred.\nWorn Equipment: A duster.\nPersonality: Wry.'
        expect(patchCard(bio, 'Body', 'Tall now.')).toEqual({ ok: true, bio: 'Species: Halfling\nBody: Tall now.\nWorn Equipment: A duster.\nPersonality: Wry.' })
        expect(patchCard(bio, 'equipment', 'A cloak.')).toEqual({ ok: true, bio: 'Species: Halfling\nBody: Short, scarred.\nWorn Equipment: A cloak.\nPersonality: Wry.' })
        expect(patchCard(bio, 'Personality', 'Grim.')).toEqual({ ok: false, reason: 'PC updates are limited to Body and Worn Equipment' })
        expect(patchCard(bio, 'Body', '')).toEqual({ ok: false, reason: 'Missing field or content' })
        // A card without the section gets it appended.
        expect(patchCard('Personality: Wry.', 'Body', 'Tall.').ok).toBe(true)
        expect((patchCard('Personality: Wry.', 'Body', 'Tall.') as { bio: string }).bio).toContain('Body: Tall.')
    })
})

describe('the other ways to begin (35c)', () => {
    const SETTINGS = { modules: { character: true, inventory: true, abilities: true, spells: true, xp: true, time: true }, useDdMmYyFormat: false }
    const base = { level: 3 as const, genre: 'fantasy', gearTier: 'standard', combatScalingGuide: true, settings: SETTINGS, initialDate: 'Day 1', initialTime: '08:00 AM', name: 'Robin Vale', instructions: '' }

    it('asks for a character from custom instructions, with the name, the level, the blocks, the hints and the guide', () => {
        const { prompt, cardHints } = buildWaysPrompt('custom', { ...base, instructions: '  A cyberpunk decker  ' })
        expect(prompt.startsWith('STARTING LEVEL: 3 (mandatory — the character MUST be exactly Level 3). Generate a random Level 3 character based entirely on these custom instructions: "A cyberpunk decker". The character\'s name MUST be "Robin Vale" exactly. Output CHARACTER, INVENTORY, ABILITIES, SPELLS, XP, TIME blocks (and [SPELLS] if appropriate for the class, using \'Cantrips:\' for level 0 spells). Adapt all attributes, skills, saves, descriptions, and gear to match the setting and instructions perfectly.')).toBe(true)
        expect(prompt).toContain('You must output the closing tag for every block ([/CHARACTER], [/INVENTORY], [/ABILITIES], [/SPELLS], [/XP], [/TIME]).')
        expect(prompt).toContain('Follow the exact [CHARACTER]/[INVENTORY]/[ABILITIES] field format')
        expect(prompt).toContain('XP: 0/2,700')
        expect(prompt).toContain('Current Time: 08:00 AM, Day 1')
        expect(prompt).toContain('STARTING GEAR: Standard kit for Level 3')
        expect(prompt).toContain('COMBAT & SKILL SCALING GUIDE')
        expect(prompt).not.toContain('CRITICAL REALISM RULE')
        expect(cardHints).toBe('\n\n--- PLAYER PREFERENCES & HINTS ---\nAdditional: A cyberpunk decker\n')
        // No levels, no XP module, no spells, a calendar: the other variants.
        const none = buildWaysPrompt('custom', { ...base, level: 'none', combatScalingGuide: false, settings: { modules: { character: true, time: true }, useDdMmYyFormat: true }, initialDate: '14/02/2026', initialTime: '21:30', instructions: 'A detective' })
        expect(none.prompt.startsWith('LEVEL SYSTEM: This character creation system does not use numeric character levels.')).toBe(true)
        expect(none.prompt).toContain(' Generate a character based entirely on these custom instructions: "A detective". The character\'s name MUST be "Robin Vale" exactly. Output CHARACTER, TIME blocks. Adapt all attributes, skills, saves, descriptions, and gear to match the setting and instructions perfectly — do not invent a numeric level.')
        expect(none.prompt).toContain('Current Time: 21:30, 14/02/2026')
        expect(none.prompt).toContain('CRITICAL REALISM RULE: This is a realistic/non-fantasy setting.')
        expect(none.prompt).not.toContain('COMBAT & SKILL SCALING GUIDE')
        expect(none.prompt).not.toContain('Cantrips')
        expect(none.prompt).not.toContain('XP: ')
        // A level without the XP module: the longer prefix and no XP hint; a calendar with Day 1 falls back to the first of the year.
        const noXp = buildWaysPrompt('custom', { ...base, settings: { modules: { character: true, time: true }, useDdMmYyFormat: true }, instructions: 'x' })
        expect(noXp.prompt.startsWith('STARTING LEVEL: 3 (mandatory — the character MUST be exactly Level 3; scale/adjust HP, stats, saves, capabilities, and gear (everything a character of that level might have) to Level 3 accordingly, but do NOT output an [XP] block as it is disabled).')).toBe(true)
        expect(noXp.prompt).toContain('Current Time: 08:00 AM, 01/01/2026')
        expect(noXp.prompt).not.toContain('XP: 0/')
    })

    it('asks for a character that embodies the active persona, named for it, with the instructions as constraints', () => {
        const { prompt, cardHints } = buildWaysPrompt('persona', { ...base, persona: { name: 'Quill', description: 'A wandering cartographer with a stubborn mule.' }, instructions: 'a western' })
        expect(prompt.startsWith('STARTING LEVEL: 3 (mandatory — the character MUST be exactly Level 3). Using the following persona description as the basis for the player character, create a Level 3 character that faithfully embodies this persona. The character\'s name MUST be "Quill" (the active persona name). Translate the personality, background, and traits into appropriate stats, class, race, and equipment. Output CHARACTER, INVENTORY, ABILITIES, SPELLS, XP, TIME blocks (and [SPELLS] if the class is a spellcaster, using \'Cantrips:\' for level 0 spells). All attributes and gear should be consistent with Level 3.')).toBe(true)
        expect(prompt).toContain('\n\nPersona — Quill:\nA wandering cartographer with a stubborn mule.\n\nAdditional setting/instruction constraints: a western. Adapt the name, attributes, description, gear, and spells (if any) to match this setting/instruction perfectly.')
        expect(prompt).toContain('COMBAT & SKILL SCALING GUIDE')
        expect(cardHints).toBe('\n\n--- PLAYER PREFERENCES & HINTS ---\nSource: the previously active SillyTavern persona.\nAdditional: a western\n')
        // No levels, no name, no instructions.
        const none = buildWaysPrompt('persona', { ...base, level: 'none', name: '', persona: { name: '', description: 'Someone.' } })
        expect(none.prompt).toContain(' Using the following persona description as the basis for the player character, create a character that faithfully embodies this persona. Translate the personality')
        expect(none.prompt).toContain('. Do not invent a numeric level — balance using the setting\'s own logic.')
        expect(none.prompt).toContain('\n\nPersona:\nSomeone.')
        expect(none.prompt).not.toContain('Additional setting/instruction constraints')
        expect(none.cardHints).toBe('\n\n--- PLAYER PREFERENCES & HINTS ---\nSource: the previously active SillyTavern persona.\n')
    })
})

describe('the name, the check and the presets', () => {
    it('rolls a name from the genre\'s pool, or from every pool without one', () => {
        expect(rollCreatorName('scifi', () => 0.5)).toBe("Q'ron Triton")
        expect(rollCreatorName('horror', () => 0)).toBe('Abigail Blackwood')
        expect(rollCreatorName('', () => 0)).toBe('Aurelia Blackwood')
        expect(rollCreatorName('', () => 0.999)).toBe('Dennis Coffin')
        expect(rollCreatorName('fantasy').split(' ')).toHaveLength(2)
    })

    it('says when a chat already had a sheet, beside the legacy\'s check and not inside it', () => {
        const sheet = '[CHARACTER]\nRobin Vale (Rogue 3)\n[/CHARACTER]'
        expect(alreadyHadSheet(sheet)).toBe(' The chat already had a sheet before this run, and the pass changed nothing: the cards above still hold the earlier one.')
        expect(alreadyHadSheet('[TIME]\nDay 1\n[/TIME]')).toBe('')
        expect(alreadyHadSheet('')).toBe('')
        // The check itself stays the legacy's, word for word.
        expect((checkSheet(sheet, sheet, { changed: false }) as { reason: string }).reason).not.toContain('already had a sheet')
    })

    it('reads the name out of a memo, and checks that a sheet arrived', () => {
        expect(extractCharacterName('[CHARACTER]\nRobin Vale (Rogue 3): 22/24 HP\n[/CHARACTER]')).toBe('Robin Vale')
        expect(extractCharacterName('[CHARACTER]\nName: Odran | Class: Sexton\n[/CHARACTER]')).toBe('Odran')
        expect(extractCharacterName('[TIME]\nDay 1\n[/TIME]')).toBe('')
        expect(extractCharacterName('[CHARACTER]\nUser (Rogue 3)\n[/CHARACTER]')).toBe('')
        const after = '[CHARACTER]\nRobin Vale (Rogue 3): 22/24 HP\n[/CHARACTER]'
        expect(checkSheet('', after, { changed: true })).toEqual({ ok: true, name: 'Robin Vale' })
        expect(checkSheet('', '', { changed: false, message: 'the model returned nothing' })).toEqual({ ok: false, reason: 'Character generation failed — State Model returned no character sheet (the model returned nothing). Check your API connection.' })
        expect(checkSheet('', '[TIME]\nDay 1\n[/TIME]', { changed: true })).toMatchObject({ ok: false })
        // A pass that reports no change is no sheet even when the memo handed
        // back differs and carries a [CHARACTER] block: the mutation check found
        // the first version of this test asking nothing of that flag.
        expect(checkSheet('', after, { changed: false })).toMatchObject({ ok: false })
        expect(checkSheet('', '', { changed: true })).toMatchObject({ ok: false })
    })

    it('saves a preset by name, replaces a same-named one under its own id, and finds it whatever the case', () => {
        const draft = emptyDraft(DEFAULTS)
        let ids = 0
        const first = upsertPreset([], 'Rogue', { ...draft, class: 'Rogue' }, () => `p${++ids}`)
        expect(first).toMatchObject({ overwritten: false, preset: { id: 'p1', name: 'Rogue' } })
        const second = upsertPreset(first.presets, ' rogue ', { ...draft, class: 'Fighter' }, () => `p${++ids}`)
        expect(second).toMatchObject({ overwritten: true, preset: { id: 'p1', name: 'rogue' } })
        expect(second.presets).toHaveLength(1)
        expect(second.presets[0]!.data.class).toBe('Fighter')
        expect(findPreset(second.presets, 'ROGUE')?.id).toBe('p1')
        expect(findPreset(second.presets, 'Wizard')).toBeNull()
        expect(findPreset(second.presets, '  ')).toBeNull()
        expect(DEFAULT_PC_SECTIONS.map((s) => s.name)).toEqual(['Species', 'Body', 'Worn Equipment', 'Personality', 'Background', 'Habits & Behaviors', 'Strengths', 'Flaws'])
    })
})

describe('Import Card (39)', () => {
    const CARD = { name: 'Kestrel', description: 'A hawk-eyed scout of {{char}}\u2019s own making.', personality: 'Wary, dry.' }
    const SETTINGS = { modules: { character: true, inventory: true, xp: true, time: true, spells: false }, customFields: [] }
    const base = { settings: SETTINGS, level: 3, genre: 'fantasy', gearTier: 'standard', card: CARD, memo: '', recent: [], narrator: '' }

    it('builds the minimal prompt: the rules, the active blocks, the card, nothing else', () => {
        const prompt = buildImportPrompt('minimal', base)
        expect(prompt.startsWith('You are a state tracker assistant. Translate this character card into state tracker format for the player character.')).toBe(true)
        expect(prompt).toContain('(enabled stock modules and custom fields): CHARACTER, INVENTORY, XP, TIME.')
        expect(prompt).toContain('- Do NOT invent stats or equipment not present on the card.')
        expect(prompt.endsWith("CHARACTER CARD:\nName: Kestrel\nDescription: A hawk-eyed scout of {{char}}\u2019s own making.\nPersonality: Wary, dry.")).toBe(true)
        expect(prompt).not.toContain('STARTING GEAR')
        expect(prompt).not.toContain('CURRENT GAME STATE')
    })

    it('builds the full prompt: the adaptation rules, the gear hint, the scaling guide whatever the switch, then the world', () => {
        const prompt = buildImportPrompt('full', { ...base, memo: '[TIME]\n09:00 AM, Day 2\n[/TIME]', narrator: 'A grim narrator.' })
        expect(prompt.startsWith('You are a state tracker assistant. Adapt this character card to the current campaign setting')).toBe(true)
        expect(prompt).toContain('- CRITICAL: Never output template macro strings such as {{char}}, {{user}}, or any other {{...}} placeholders.')
        expect(prompt).toContain('\u2022 STARTING GEAR: Standard kit for Level 3')
        expect(prompt).toContain('COMBAT & SKILL SCALING GUIDE')
        expect(prompt).toContain('\n\n---\n\nCURRENT GAME STATE:\n[TIME]\n09:00 AM, Day 2\n[/TIME]\n\n---\n\nNARRATOR/WORLD CARD:\nA grim narrator.')
        expect(prompt.indexOf('CHARACTER CARD:')).toBeLessThan(prompt.indexOf('CURRENT GAME STATE:'))
    })

    it('sends the last eight non-empty story lines, the names as the legacy writes them, cut at 3,000 characters', () => {
        const recent = Array.from({ length: 10 }, (_, i) => ({ user: i % 2 === 0, name: i % 2 === 0 ? '' : 'Narrator', text: `line ${i}` }))
        recent.push({ user: true, name: 'Player', text: '   ' })
        const prompt = buildImportPrompt('minimal', { ...base, recent })
        expect(prompt).toContain('RECENT CHAT:\nUser: line 2\n\nNarrator: line 3\n\n')
        expect(prompt).not.toContain('line 1\n')
        expect(prompt).toContain('Narrator: line 9')
        const long = buildImportPrompt('minimal', { ...base, recent: [{ user: false, name: 'N', text: 'x'.repeat(5000) }] })
        expect(long.split('RECENT CHAT:\n')[1]!.length).toBe(3000)
    })

    it('scales the gear hint to level 1 for a system without levels, and keeps the inventory switch', () => {
        expect(buildImportPrompt('full', { ...base, level: 1, settings: { ...SETTINGS, modules: { ...SETTINGS.modules, inventory: false } } })).toContain('for Level 1')
    })

    it('builds the Player Card prompt in the minimal mode: a transcription, {{char}} resolved, the narrator as a reference not to copy', () => {
        const { system, user } = buildImportBio(CARD, 'minimal', 'same', { settings: {}, narrator: 'A grim narrator.' })
        expect(system.startsWith('You are a persona transcription assistant.')).toBe(true)
        expect(system).toContain('with the character\'s actual name: Kestrel.')
        expect(user).toContain('CARD TO TRANSCRIBE:\nName: Kestrel\n\nDescription:\nA hawk-eyed scout of Kestrel\u2019s own making.\n\nPersonality:\nWary, dry.')
        expect(user).toContain('--- WORLD REFERENCE (do NOT copy \u2014 for conflict-checking only) ---\nA grim narrator.')
        expect(user.endsWith('Output the transcribed persona text now.')).toBe(true)
    })

    it('builds the Player Card prompt in the full mode: the stock sections, the length as the card\u2019s or a count', () => {
        const same = buildImportBio(CARD, 'full', 'same', { settings: {}, narrator: '' })
        expect(same.system).toContain('write a persona description for Kestrel in third person.')
        expect(same.system).toContain('Species:\n')
        expect(same.system).toContain('- MATCH LENGTH: Aim to make your output approximately the same length/word count as the original character card.')
        expect(same.user).not.toContain('WORLD/CAMPAIGN REFERENCE')
        const counted = buildImportBio(CARD, 'full', 300, { settings: {}, narrator: 'A grim narrator.' })
        expect(counted.system).toContain('- Total word count across all sections: approximately 300 words.')
        expect(counted.user).toContain('--- WORLD/CAMPAIGN REFERENCE (context only \u2014 do NOT copy) ---\nA grim narrator.')
    })

    it('uses the cartridge\u2019s own sections for the full card when it has them', () => {
        const { system } = buildImportBio(CARD, 'full', 150, { settings: { pcCoreSections: [{ name: 'Look', description: 'How they look.' }] }, narrator: '' })
        expect(system).toContain('Look:\nHow they look.')
        expect(system).toContain('Output ONLY the 1 sections listed above.')
    })

    it('reads a mode and a length', () => {
        expect(normalizeImportMode('minimal')).toBe('minimal')
        expect(normalizeImportMode('anything')).toBe('full')
        expect(normalizeImportWords('same')).toBe('same')
        expect(normalizeImportWords(undefined)).toBe('same')
        expect(normalizeImportWords(300)).toBe(300)
        expect(normalizeImportWords(7)).toBe(50)
        expect(IMPORT_WORD_OPTIONS.map((o) => o.value)).toEqual(['same', 150, 300, 500])
    })
})

