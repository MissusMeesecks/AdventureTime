import { describe, it, expect } from 'vitest'

import {
    SETTINGS_CATEGORIES,
    SETTINGS_SCHEMA,
    coerce,
    fieldForKey,
    schemaKeys,
    unknownSchemaKeys,
    type FieldDef,
} from './schema.js'

describe('settings schema', () => {
    it('only names keys that are part of the cartridge surface', () => {
        // A typo here would create a setting no cartridge carries and nothing
        // ever restores — the exact failure CLAUDE.md rule 3 is about.
        expect(unknownSchemaKeys()).toEqual([])
    })

    it('gives every key exactly one owning field', () => {
        const keys = schemaKeys()
        expect(new Set(keys).size).toBe(keys.length)
    })

    it('uses section ids that match the cartridge groups', async () => {
        const { CARTRIDGE_PAYLOAD_GROUPS } = await import('../state/payload-groups.js')
        const groupIds = CARTRIDGE_PAYLOAD_GROUPS.map((g) => g.id)
        for (const section of SETTINGS_SCHEMA) expect(groupIds).toContain(section.group ?? section.id)
    })

    it('puts every section in one of the seven categories, in Multihog’s order (63)', () => {
        expect(SETTINGS_CATEGORIES.map((c) => c.id)).toEqual(['general', 'connections', 'systems', 'tracker', 'agent', 'maps', 'world'])
        const ids = new Set(SETTINGS_CATEGORIES.map((c) => c.id))
        for (const section of SETTINGS_SCHEMA) expect(ids.has(section.category)).toBe(true)
        // The map the plan drew: the choices and the portraits under General, the sheets with the agent, the world alone.
        const by = Object.fromEntries(SETTINGS_SCHEMA.map((s) => [s.id, s.category]))
        expect(by).toEqual({ stateTracker: 'tracker', narrator: 'systems', cyoa: 'general', gameSystems: 'systems', rulebook: 'systems', characterSheets: 'agent', portraits: 'general', lorebookAgent: 'agent', mapArchitect: 'maps', worldProgression: 'world' })
    })

    it('splits the narrator’s configuration and the rulebook off the State Tracker group, under Game systems (70)', () => {
        const narrator = SETTINGS_SCHEMA.find((s) => s.id === 'narrator')!
        const rulebook = SETTINGS_SCHEMA.find((s) => s.id === 'rulebook')!
        expect(narrator.group).toBe('stateTracker')
        expect(narrator.editor).toBe('narrator')
        expect(schemaKeys([narrator])).toEqual(['narrativePacing', 'rngEnabled', 'diceFunctionTool', 'diceD100Mode', 'rngToolD20', 'rngToolD100', 'rngQueueD20', 'rngQueueD100'])
        expect(rulebook.group).toBe('stateTracker')
        expect(schemaKeys([rulebook])).toEqual(['syspromptModules', 'syspromptSectionOrder', 'customSyspromptLibrary'])
        // The saved order keeps its key and has no row (96): no control in the pane changes it.
        expect(rulebook.fields.filter((f) => f.hidden).map((f) => f.key)).toEqual(['syspromptSectionOrder'])
        expect(rulebook.title).toBe('Narrator rulebook')
        expect(rulebook.fields.filter((f) => !f.hidden).map((f) => f.label)).toEqual(['Stock sections', 'World rules'])
        // The State Tracker card keeps the tracker's own, and nothing of the narrator's.
        const tracker = SETTINGS_SCHEMA.find((s) => s.id === 'stateTracker')!
        expect(schemaKeys([tracker])).toEqual(['systemPromptTemplate', 'use24hTime', 'useDdMmYyFormat', 'modules', 'blockOrder', 'stockPrompts'])
        expect(tracker.group).toBeUndefined()
        // 96: the order and the stock texts keep their keys and have no row; the modules list draws both.
        expect(tracker.fields.filter((f) => f.hidden).map((f) => f.key)).toEqual(['blockOrder', 'stockPrompts'])
        expect(fieldForKey('stockPrompts')!.validate).toBeTypeOf('function')
        expect(tracker.fields.filter((f) => !f.hidden).map((f) => f.label)).toEqual(['Tracker system prompt', 'Use 24-hour time', 'Use DD/MM/YYYY dates', 'Tracker modules'])
        for (const field of tracker.fields.filter((f) => !f.hidden)) expect(field.help, field.key).toBeTruthy()
        expect(tracker.warning).toBe('Reset to factory also resets the Narrator card and the Narrator rulebook.')
        expect(tracker.description).not.toContain('Reset to factory')
    })

    it('lists the seven agent texts the pass reads and none of Basic Mode’s four (72c)', () => {
        const agent = SETTINGS_SCHEMA.find((s) => s.id === 'lorebookAgent')!
        expect(schemaKeys([agent])).toEqual(['routerSystemPromptTemplate', 'routerAgentSharedContextTemplate', 'routerCombatProfileGuidanceAgentTemplate', 'routerAutoPassRestrictionTemplate', 'routerManualPassRestrictionTemplate', 'routerExistingNpcNudgeTemplate', 'routerRelSectionAgentTemplate', 'routerModules', 'routerCustomTags'])
        for (const key of ['routerBasicSystemPromptTemplate', 'routerModularPromptTemplate', 'routerCombatProfileGuidanceBasicTemplate', 'routerRelSectionBasicTemplate']) expect(fieldForKey(key), key).toBeUndefined()
        for (const field of agent.fields.filter((f) => f.type === 'textarea')) expect(field.help, field.key).toBeTruthy()
    })

    it('gives every category and every section an icon (63d)', () => {
        for (const c of SETTINGS_CATEGORIES) expect(c.icon.length, c.id).toBeGreaterThan(0)
        for (const s of SETTINGS_SCHEMA) expect(s.icon.length, s.id).toBeGreaterThan(0)
    })

    it('finds the field owning a derived key', () => {
        expect(fieldForKey('diceFunctionTool')?.key).toBe('rngMode')
        expect(fieldForKey('rngEnabled')?.key).toBe('rngMode')
    })

    it('returns nothing for a key no field owns', () => {
        expect(fieldForKey('somethingElse')).toBeUndefined()
    })
})

describe('the Agent prompts card (96)', () => {
    it('says the deck’s text: the card and three boxes renamed, the help in the deck’s words, Multihog named in the two differences alone', () => {
        const card = SETTINGS_SCHEMA.find((s) => s.id === 'lorebookAgent')!
        expect(card.title).toBe('Agent prompts')
        expect(card.description).toBe('The prompt texts the Lorebook Agent is sent on each pass.')
        const prompts = card.fields.filter((f) => f.key.startsWith('router') && f.key.endsWith('Template'))
        expect(Object.fromEntries(prompts.map((f) => [f.key, f.label]))).toEqual({
            routerSystemPromptTemplate: 'Agent system prompt',
            routerAgentSharedContextTemplate: 'Shared context template',
            routerCombatProfileGuidanceAgentTemplate: 'Combat profile guidance',
            routerAutoPassRestrictionTemplate: 'Automatic-pass restriction',
            routerManualPassRestrictionTemplate: 'Manual-pass restriction',
            routerExistingNpcNudgeTemplate: 'Existing-NPC nudge',
            routerRelSectionAgentTemplate: 'Relationship section',
        })
        for (const f of prompts) {
            expect(f.help, f.key).toBeTruthy()
            expect(f.help, f.key).not.toContain('the host')
            expect(f.help!.replace(/\n\nDifferent from Multihog: [^\n]*$/, ''), f.key).not.toContain('Multihog')
        }
        expect(prompts.filter((f) => f.help!.includes('Multihog')).map((f) => f.key)).toEqual(['routerSystemPromptTemplate', 'routerAgentSharedContextTemplate'])
        expect(fieldForKey('routerSystemPromptTemplate')!.help).toContain('\n\nDifferent from Multihog: the three activation sections (basic_instructions, context_maximization, bravery) are not sent.')
        expect(fieldForKey('routerAgentSharedContextTemplate')!.help).toMatch(/\n\nDifferent from Multihog: the MEMORY LIMIT section is not sent\.$/)
        expect(fieldForKey('routerAutoPassRestrictionTemplate')!.help).toBe('Sent on an automatic pass after a reply. On that pass the agent may edit an NPC’s Combat Profile and no other [CORE] field. Edits to other fields are refused.')
    })
})

describe('coercion', () => {
    const number: FieldDef = { key: 'n', type: 'number', label: 'n', min: 10, max: 100 }

    it('clamps numbers into range rather than discarding them', () => {
        expect(coerce(number, '5')).toBe(10)
        expect(coerce(number, '500')).toBe(100)
        expect(coerce(number, '42')).toBe(42)
    })

    it('falls back to 0 for text that is not a number', () => {
        expect(coerce(number, 'not a number')).toBe(0)
    })

    it('makes booleans out of whatever it is given', () => {
        const field: FieldDef = { key: 'b', type: 'boolean', label: 'b' }
        expect(coerce(field, 'yes')).toBe(true)
        expect(coerce(field, '')).toBe(false)
    })

    it('rejects a select value outside its options', () => {
        const field: FieldDef = {
            key: 's',
            type: 'select',
            label: 's',
            options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
        }
        expect(coerce(field, 'b')).toBe('b')
        expect(coerce(field, 'z')).toBe('a')
    })
})

describe('RNG mode, the derived control', () => {
    const field = SETTINGS_SCHEMA
        .flatMap((section) => section.fields)
        .find((candidate) => candidate.key === 'rngMode')!

    it('round-trips all three modes the legacy UI offered', () => {
        for (const mode of ['hybrid', 'legacy', 'none']) {
            const written = field.write!(mode)
            expect(field.read!(written)).toBe(mode)
        }
    })

    it('maps the two underlying flags the way the legacy radio did', () => {
        expect(field.write!('hybrid')).toEqual({ rngEnabled: true, diceFunctionTool: true })
        expect(field.write!('legacy')).toEqual({ rngEnabled: true, diceFunctionTool: false })
        expect(field.write!('none')).toEqual({ rngEnabled: false, diceFunctionTool: false })
    })

    it('reads the fourth, unreachable flag combination as "none"', () => {
        // rngEnabled false + diceFunctionTool true was never reachable in the
        // legacy UI. Reading it as "none" keeps the control honest instead of
        // showing a mode the prompt stack has never been run in.
        expect(field.read!({ rngEnabled: false, diceFunctionTool: true })).toBe('none')
    })
})
