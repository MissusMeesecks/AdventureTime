import { describe, expect, it } from 'vitest'

import { FACTORY_CARTRIDGE_DEFAULTS } from '../state/factory-defaults.js'
import { npcSectionNames } from '../tracker/npc-creator.js'
import { ACTIVATION_SECTIONS, adjustPromptTimestamps, agentModuleLines, applyNpcWordTargets, rebuildModuleInstructions, stockModuleInstructions, currentLocationSection, eligibleCoreFields, enabledCategoryTags, existingNpcNudge, expandTemplate, formatMechanicalSections, isWorldModuleTag, LORE_EXISTENCE_RULE, mappedSiteNote, MECHANICAL_TEXT, mechanicalState, passRestriction, recordCategoryGuidance, stripStaticMapGuidance, upgradeNpcInstruction, withoutActivationSections, type AgentModuleSettings } from './modules.js'

const FACTORY = FACTORY_CARTRIDGE_DEFAULTS as unknown as AgentModuleSettings

const OLD_PARAGRAPH = 'CRITICAL — [CORE] is permanent identity, still true after this arc ends. Extrapolate enduring traits from behavior; never recap this turn, voyage, or crisis.\nBANNED in [CORE]: momentary actions/states; plot progress ("increasingly…", "first to notice…", "this voyage"); roles defined by ongoing events ("crewman on X who became unhinged by Y"). Scene facts go in timestamped lines after [/CORE] only.'

describe('the module lines', () => {
    it('lists every enabled module as the legacy does, the NPC instruction first and whole', () => {
        const lines = agentModuleLines(FACTORY)
        expect(lines.map((l) => l.slice(0, l.indexOf(':')))).toEqual(['- NPC', '- LOC', '- FAC', '- QUEST', '- EVENT'])
        expect(lines[0]).toContain('When FIRST recording an NPC, build a usable, enduring character profile')
        expect(lines[0]).toContain('[CORE]')
        // The world module ships disabled and is not listed.
        expect(lines.some((l) => l.startsWith('- WORLD'))).toBe(false)
        // Switched on, it is still not listed (55-quater): World Progression writes that book here, and the writer refuses the agent.
        const on = agentModuleLines({ routerModules: { ...FACTORY.routerModules, world: { ...FACTORY.routerModules!.world!, enabled: true } } })
        expect(on.some((l) => l.startsWith('- WORLD'))).toBe(false)
        expect(on).toHaveLength(5)
        expect(isWorldModuleTag(' world ')).toBe(true)
        expect(isWorldModuleTag('WORLDS')).toBe(false)
    })

    it('skips a switched-off, untagged or empty module, and adds the custom tags under their heading', () => {
        const lines = agentModuleLines({
            routerModules: {
                npc: { enabled: false, tag: 'NPC', instruction: 'x' },
                loc: { enabled: true, tag: ' LOC ', instruction: ' Places. ' },
                fac: { enabled: true, tag: '', instruction: 'y' },
                event: { enabled: true, tag: 'EVENT', instruction: '  ' },
                extra: { enabled: true, instruction: 'keyed by its name' },
            },
            routerCustomTags: [{ tag: 'ship', instruction: 'Vessels.' }, { tag: '', instruction: 'nameless' }, { tag: 'x', instruction: '' }],
        })
        expect(lines).toEqual(['- LOC: Places.', '- extra: keyed by its name', '', '### CUSTOM CATEGORIES', '- SHIP: Vessels.'])
        expect(agentModuleLines({})).toEqual([])
    })

    // Upstream 2026.9.25 refreshes the shipped paragraph inside a stored instruction and nothing else.
    it('refreshes the old shipped NPC paragraph in a stored instruction, leaving every other edit alone', () => {
        const stored = `Mine before.\n${OLD_PARAGRAPH}\nMine after.`
        const upgraded = upgradeNpcInstruction(stored)
        expect(upgraded.startsWith('Mine before.\n')).toBe(true)
        expect(upgraded.endsWith('\nMine after.')).toBe(true)
        expect(upgraded).toContain('build a usable, enduring character profile')
        expect(upgraded).not.toContain('never recap this turn, voyage, or crisis')
        expect(upgradeNpcInstruction('untouched custom text')).toBe('untouched custom text')
        const lines = agentModuleLines({ routerModules: { npc: { enabled: true, tag: 'NPC', instruction: stored }, loc: { enabled: true, tag: 'LOC', instruction: OLD_PARAGRAPH } } })
        expect(lines[0]).toContain('build a usable, enduring character profile')
        // Only the NPC module is refreshed: the paragraph is the NPC one.
        expect(lines[1]).toContain('never recap this turn, voyage, or crisis')
    })
})

describe('the mechanical state', () => {
    const MEMO = '[TIME]\nDay 2\n[/TIME]\n[PARTY]\nKes (Rogue 3): 10/12\n[/PARTY]\n[COMBAT]\nENEMIES:\nWolf 4/8\n[/COMBAT]'

    it('reads the combat and party blocks whole, with the cartridge\'s guidance when either is there', () => {
        const state = mechanicalState(MEMO, FACTORY)
        expect(state.combat).toBe('[COMBAT]ENEMIES:\nWolf 4/8[/COMBAT]')
        expect(state.party).toBe('[PARTY]Kes (Rogue 3): 10/12[/PARTY]')
        expect(state.guidance.startsWith('## COMBAT PROFILE (mechanical stats provided this turn)')).toBe(true)
        expect(state.guidance).toContain('## PARTY MECHANICAL STATE')
        expect(formatMechanicalSections(state)).toBe(`${MECHANICAL_TEXT.combat}\n${state.combat}\n\n${MECHANICAL_TEXT.party}\n${state.party}\n\n`)
    })

    it('is empty without either block, takes the user\'s own guidance, and falls back to the stock text', () => {
        expect(mechanicalState('[TIME]\nDay 2\n[/TIME]', FACTORY)).toEqual({ combat: null, party: null, guidance: '' })
        expect(formatMechanicalSections(mechanicalState('', FACTORY))).toBe('')
        expect(mechanicalState(null, FACTORY).guidance).toBe('')
        const party = mechanicalState('[PARTY]\nKes\n[/PARTY]', { routerCombatProfileGuidanceAgentTemplate: 'my rule' })
        expect(party).toEqual({ combat: null, party: '[PARTY]Kes[/PARTY]', guidance: 'my rule' })
        expect(formatMechanicalSections(party)).toBe(`${MECHANICAL_TEXT.party}\n[PARTY]Kes[/PARTY]\n\n`)
        expect(mechanicalState('[COMBAT]\nx\n[/COMBAT]', {}).guidance).toContain('## COMBAT PROFILE')
    })
})

describe('the NPC word targets (72b)', () => {
    const stock = (FACTORY_CARTRIDGE_DEFAULTS.routerModules as Record<string, { instruction: string }>).npc.instruction
    it('rewrites the two length sentences of the shipped instruction and nothing else, and leaves an instruction without them alone', () => {
        expect(stock).toContain('total exactly 225 words')
        expect(stock).toContain('total exactly 135 words')
        const { instruction, applied } = applyNpcWordTargets(stock, 300, 90)
        expect(applied).toBe(true)
        expect(instruction).toContain('Major NPCs (recurring, plot-important): the [CORE] block\'s sections must together total exactly 300 words')
        expect(instruction).toContain('Minor NPCs (shopkeepers, guards, one-off encounters): the [CORE] block\'s sections must together total exactly 90 words')
        expect(instruction.replace('300 words', '225 words').replace('90 words', '135 words')).toBe(stock)
        expect(applyNpcWordTargets(instruction, 225, 135).instruction).toBe(stock)
        expect(applyNpcWordTargets(stock, 0.4, -3).instruction).toContain('total exactly 1 words')
        expect(applyNpcWordTargets('Record every NPC.', 300, 90)).toEqual({ instruction: 'Record every NPC.', applied: false })
    })
})

describe('the sections and the three built instructions (77)', () => {
    const factory = FACTORY_CARTRIDGE_DEFAULTS as unknown as Record<string, unknown>
    const modules = () => JSON.parse(JSON.stringify(factory.routerModules)) as Record<string, { instruction: string } & Record<string, unknown>>
    const words = { major: 225, minor: 135 }
    const voice = { npcCoreSections: [{ id: 'sec_voice', name: 'Voice', description: 'How they speak.', icon: '🗣️', color: '#fff' }] }

    it('builds the factory\'s own NPC, LOC and FAC texts from a factory cartridge, and the sections into all three when they change', () => {
        const stock = stockModuleInstructions(factory, words)
        expect(stock.npc).toBe(modules().npc.instruction)
        expect(stock.loc).toBe(modules().loc.instruction)
        expect(stock.fac).toBe(modules().fac.instruction)
        const changed = stockModuleInstructions({ ...factory, ...voice }, words)
        expect(changed.npc).toContain('[CORE]\nVoice: How they speak.\n[/CORE]')
        expect(changed.npc).toContain('Wrap the identity sections (Voice) inside')
        expect(changed.loc).toContain('Do NOT use NPC field headers (Voice)')
        expect(changed.fac).toContain('Voice: A consulting group...')
        // The relationship bars are read as off: the section goes once, through the shared context.
        expect(stockModuleInstructions({ ...factory, npcRelationshipBars: true }, words).npc).toBe(stock.npc)
        // The word targets are written in, and the date examples follow the cartridge's format.
        expect(stockModuleInstructions(factory, { major: 300, minor: 90 }).npc).toContain('total exactly 300 words')
        expect(stockModuleInstructions({ ...factory, useDdMmYyFormat: true }, words).loc).toContain('01/01/2026, 08:00] [CORE]')
    })

    it('rebuilds an instruction still reading as stock, keeps an edited one by name, and leaves one already right alone', () => {
        const stock = modules()
        const edited = modules()
        edited.npc.instruction = 'my own npc text'
        const after = { ...factory, ...voice }
        const rebuilt = rebuildModuleInstructions(stock, factory, after, words)
        expect(rebuilt.rebuilt).toEqual(['npc', 'loc', 'fac'])
        expect(rebuilt.kept).toEqual([])
        expect(rebuilt.routerModules.npc.instruction).toBe(stockModuleInstructions(after, words).npc)
        expect(rebuilt.routerModules.quest).toEqual(stock.quest)
        const partly = rebuildModuleInstructions(edited, factory, after, words)
        expect(partly.rebuilt).toEqual(['loc', 'fac'])
        expect(partly.kept).toEqual(['npc'])
        expect(partly.routerModules.npc.instruction).toBe('my own npc text')
        // Already right: named in neither list, nothing changed.
        const right = rebuildModuleInstructions(rebuilt.routerModules, after, after, words)
        expect(right).toMatchObject({ rebuilt: [], kept: [] })
        // The word targets written by 72b's rewrite still read as stock.
        const targeted = modules()
        targeted.npc.instruction = applyNpcWordTargets(targeted.npc.instruction, 300, 90).instruction
        expect(rebuildModuleInstructions(targeted, factory, after, { major: 300, minor: 90 }).rebuilt).toContain('npc')
        // A cartridge whose date format was switched without a rebuild (the switch never rebuilt here) still reads as stock.
        const dated = { ...factory, useDdMmYyFormat: true }
        expect(rebuildModuleInstructions(modules(), dated, { ...dated, ...voice }, words).rebuilt).toEqual(['npc', 'loc', 'fac'])
        // A module without an instruction string is skipped.
        expect(rebuildModuleInstructions({ npc: { enabled: true } }, factory, after, words)).toMatchObject({ rebuilt: [], kept: [] })
    })
})

describe('the prompt\'s legacy pieces (72c)', () => {
    it('takes the activation sections out of the factory\'s two templates and nothing else', () => {
        const system = withoutActivationSections(FACTORY.routerSystemPromptTemplate!)
        for (const tag of ACTIVATION_SECTIONS.tags) expect(system).not.toContain(`<${tag}>`)
        expect(system).not.toContain('Active Context saturated')
        expect(system).not.toContain('Priority Tiering')
        expect(system).not.toContain('swapping at MAX')
        for (const kept of ['<player_character_safeguard>', '<formatting>', '<quests>', '<updating_entities>', '<timestamps>', '</timestamps>']) expect(system).toContain(kept)
        expect(system.startsWith('<player_character_safeguard>')).toBe(true)
        const shared = withoutActivationSections(FACTORY.routerAgentSharedContextTemplate!)
        expect(shared).not.toContain('## MEMORY LIMIT')
        expect(shared).not.toContain('BUDGET VIOLATION')
        // The placeholder the section ran into stands, and so does every other section.
        expect(shared.startsWith('{{relSection}}\n## PLAYER CHARACTER SAFEGUARD')).toBe(true)
        for (const kept of ['## NPC CORE UPDATES', '{{autoPassRestriction}}', '{{existingNpcNudge}}', '## DO NOT RE-RECORD EXISTING ENTITIES', '{{combatProfileGuidance}}', '## DUNGEON LOCATION OWNERSHIP', '## WORLD SKELETON (OFF-LIMITS)', '## CAMPAIGN CONTEXT', '## CONTENT FORMAT', '## FIELD INSTRUCTIONS\n{{fieldInstructions}}']) expect(shared).toContain(kept)
        // A template without the tags is returned as it stands; a blank one is blank.
        expect(withoutActivationSections('Mine, whole.\n\n## MY SECTION\n- a line')).toBe('Mine, whole.\n\n## MY SECTION\n- a line')
        expect(withoutActivationSections('')).toBe('')
        // A heading section at the end runs to the end.
        expect(withoutActivationSections('## KEEP\nx\n## memory limit\n- gone\n- gone too')).toBe('## KEEP\nx')
    })

    it('names the eligible fields by the pass: the Combat Profile alone after a reply, every identity field when pressed or instructed', () => {
        // The factory's `npcCoreSections` is empty, so the names are the legacy's defaults, as `npcSectionNames` falls back.
        const sections = npcSectionNames(FACTORY.npcCoreSections)
        expect(eligibleCoreFields(sections, false)).toEqual(['Combat Profile'])
        expect(eligibleCoreFields(sections, true)).toEqual(['Species', 'Personality', 'Brief Background', 'Habits/Behaviors', 'Strengths', 'Flaws', 'Combat Profile'])
        expect(eligibleCoreFields([], false)).toEqual(['Combat Profile'])
        expect(eligibleCoreFields(['Body', 'Gear'], true)).toEqual([])
    })

    it('resolves the pass restriction and the nudge from the cartridge, the pin\'s when blank', () => {
        expect(passRestriction(FACTORY, false, ['Combat Profile'])).toContain('AUTOMATIC PASS RESTRICTION: Combat Profile is the only [CORE] field')
        expect(passRestriction(FACTORY, true, ['Species', 'Flaws'])).toContain('DIRECT PROMPT PASS: you may update any eligible [CORE] identity field (Species, Flaws)')
        expect(passRestriction({ routerManualPassRestrictionTemplate: 'mine: {{eligibleCoreFields}}' }, true, ['Flaws'])).toBe('mine: Flaws')
        expect(passRestriction({ routerAutoPassRestrictionTemplate: '' }, false, [])).toContain('AUTOMATIC PASS RESTRICTION')
        expect(existingNpcNudge(FACTORY)).toContain('timestamped chronicle/EVENT line')
        expect(existingNpcNudge({ routerExistingNpcNudgeTemplate: 'nudge' })).toBe('nudge')
        expect(expandTemplate('a {{x}} b {{y}} {{z}}', { x: 1, y: 'two' })).toBe('a 1 b two {{z}}')
    })

    it('lists the enabled categories without the WORLD module, routed to the campaign\'s books', () => {
        expect(enabledCategoryTags(FACTORY)).toEqual(['NPC', 'LOC', 'FAC', 'QUEST', 'EVENT'])
        const on = enabledCategoryTags({ routerModules: { ...FACTORY.routerModules, world: { ...FACTORY.routerModules!.world!, enabled: true } }, routerCustomTags: [{ tag: 'lore', instruction: 'x' }] })
        expect(on).toEqual(['NPC', 'LOC', 'FAC', 'QUEST', 'EVENT', 'LORE'])
        const guidance = recordCategoryGuidance('Vell', ['NPC', 'LORE'])
        expect(guidance).toContain('## AVAILABLE RECORD CATEGORIES (AUTHORITATIVE FOR THIS PASS)')
        expect(guidance).toContain('values are: "NPC" | "LORE".')
        expect(guidance).toContain('Routes: "NPC" -> "Vell_NPC", "LORE" -> "Vell_LORE".')
        expect(recordCategoryGuidance('Vell', [])).toContain('No record categories are enabled. Do not create new records this pass.')
    })

    it('adjusts a template\'s timestamp examples to the cartridge\'s clock and calendar', () => {
        const text = 'Example: "[Day 1, 11:52] Character signed." [Day 3, 02:00 PM] The forge. Use [Day N, HH:MM AM/PM].'
        // The legacy's 24-hour rewrite changes the placeholders and the clock times it knows; a `02:00 PM` example stands.
        expect(adjustPromptTimestamps(text, { use24hTime: true })).toBe('Example: "[Day 1, 11:52] Character signed." [Day 3, 02:00 PM] The forge. Use [Day N, HH:MM].')
        expect(adjustPromptTimestamps(text, { useDdMmYyFormat: true })).toContain('[01/01/2026, 11:52]')
        expect(adjustPromptTimestamps(text, { useDdMmYyFormat: true })).toContain('[DD/MM/YYYY, HH:MM AM/PM]')
        expect(adjustPromptTimestamps(text, {})).toBe(text)
    })

    it('strips the static map guidance as the legacy does, and writes the mapped-site note and the location section', () => {
        const shared = stripStaticMapGuidance(FACTORY.routerAgentSharedContextTemplate!)
        expect(shared).not.toContain('## DUNGEON LOCATION OWNERSHIP')
        expect(shared).toContain('## WORLD SKELETON (OFF-LIMITS)')
        expect(mappedSiteNote('The Hollow')).toContain('## MAPPED SITE\nThe party is inside mapped site "The Hollow".')
        expect(mappedSiteNote('')).toBe('')
        expect(mappedSiteNote(undefined)).toBe('')
        expect(currentLocationSection('Khelt :: Rust-Lantern District')).toBe('## CURRENT LOCATION\nKhelt :: Rust-Lantern District\nParsed from the narrator status footer and may lag. If the latest narration clearly entered a named interior (chapel, inn, shop, house, alley) that this line omitted, treat the narration as authoritative — do not wait for the footer.')
        expect(currentLocationSection('')).toContain('## CURRENT LOCATION\nUnknown\n')
        expect(LORE_EXISTENCE_RULE).toContain('ARCHIVE INDEX')
    })
})
