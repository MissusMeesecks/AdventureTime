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
        // The State Tracker card keeps the tracker's own, and nothing of the narrator's.
        const tracker = SETTINGS_SCHEMA.find((s) => s.id === 'stateTracker')!
        expect(schemaKeys([tracker])).toEqual(['systemPromptTemplate', 'use24hTime', 'useDdMmYyFormat', 'modules', 'blockOrder', 'stockPrompts'])
        expect(tracker.group).toBeUndefined()
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
