import { describe, expect, it } from 'vitest'

import { createWizardContext, listWizardModuleExampleOptions, type WizardContextSettings } from './wizard-context.js'

const SETTINGS: WizardContextSettings = {
    modules: { character: true, party: true, combat: false, inventory: true, abilities: true, spells: true, xp: true, time: true, quests: true },
    syspromptModules: { quests: false },
    stockPrompts: { character: 'CHAR text', party: 'PARTY text', inventory: 'INV text', abilities: 'ABL', spells: 'SPL', xp: 'XP text', time: 'TIME 12h', time_24h: 'TIME 24h', quests: 'Q' },
    customFields: [
        { tag: 'heat', label: 'Heat', enabled: true, prompt: 'Track HEAT.', template: 'Heat: 0/10' },
        { tag: 'OFF', label: 'Off', enabled: false, prompt: 'x', template: 'y' },
    ],
    customSyspromptLibrary: [
        { id: '71', tag: 'radiation', description: 'Game System: Radiation', enabled: true, content: '<radiation>\nRADS accumulate.\n</radiation>' },
        { id: '72', tag: 'blank', enabled: true, content: '<blank>\n</blank>' },
        { id: '73', tag: 'off', enabled: false, content: '<off>\nx\n</off>' },
    ],
}

describe('the wizard’s context pieces (73g, departure 117)', () => {
    it('lists the options in the legacy’s groups: every stock module (the legacy reads the switches by the uppercase tag, which the cartridge never carries; quests by its own switch), the enabled fields, the non-blank enabled sections', () => {
        expect(listWizardModuleExampleOptions(SETTINGS)).toEqual([
            { key: 'stock:CHARACTER', label: '[CHARACTER]', group: 'Stock tracker modules' },
            { key: 'stock:PARTY', label: '[PARTY]', group: 'Stock tracker modules' },
            { key: 'stock:COMBAT', label: '[COMBAT]', group: 'Stock tracker modules' },
            { key: 'stock:INVENTORY', label: '[INVENTORY]', group: 'Stock tracker modules' },
            { key: 'stock:ABILITIES', label: '[ABILITIES]', group: 'Stock tracker modules' },
            { key: 'stock:SPELLS', label: '[SPELLS]', group: 'Stock tracker modules' },
            { key: 'stock:XP', label: '[XP]', group: 'Stock tracker modules' },
            { key: 'stock:TIME', label: '[TIME]', group: 'Stock tracker modules' },
            { key: 'field:HEAT', label: 'Heat [HEAT]', group: 'Custom tracker modules' },
            { key: 'sysprompt:71', label: '<radiation> — Game System: Radiation', group: 'Custom GM / narrator sections' },
        ])
        // No module switches at all is every stock module on, as the legacy reads it; an uppercase false is the one spelling it honours.
        expect(listWizardModuleExampleOptions({}).map((o) => o.key)).toEqual(['stock:CHARACTER', 'stock:PARTY', 'stock:COMBAT', 'stock:INVENTORY', 'stock:ABILITIES', 'stock:SPELLS', 'stock:XP', 'stock:TIME', 'stock:QUESTS'])
        expect(listWizardModuleExampleOptions({ modules: { COMBAT: false } }).map((o) => o.key)).not.toContain('stock:COMBAT')
    })

    it('keeps only the keys among the options, once each', () => {
        const pieces = createWizardContext({}, () => 'time')
        expect(pieces.normalizeModuleExampleKeys({ ...SETTINGS, gameSystemWizardModuleExampleKeys: ['stock:XP', ' stock:XP', 'field:HEAT', 'stock:QUESTS', 'nope'] })).toEqual(['stock:XP', 'field:HEAT'])
        expect(pieces.normalizeModuleExampleKeys({ ...SETTINGS, gameSystemWizardModuleExampleKeys: ['field:HEAT'] }, ['stock:XP'])).toEqual([])
    })

    it('builds the examples block in the legacy’s words: the cartridge’s stock text, the time module by the resolver, a field with its template, a section with its instructions; nothing with the switch off or nothing picked', () => {
        const pieces = createWizardContext({ xp: 'FALLBACK XP' }, (s) => (s.use24hTime ? 'time_24h' : 'time'))
        const text = pieces.moduleExamplesContext({ ...SETTINGS, use24hTime: true, gameSystemWizardInjectModulePrompts: true, gameSystemWizardModuleExampleKeys: ['stock:XP', 'stock:TIME', 'stock:QUESTS', 'field:HEAT', 'sysprompt:71', 'sysprompt:72'] })
        expect(text.startsWith('=== EXISTING MODULE PROMPTS (FORMATTING EXAMPLES ONLY) ===\nThe blocks below are instruction prompts for other tracker/GM systems.')).toBe(true)
        expect(text).toContain('[XP] (Stock Module)\nPrompt:\nXP text')
        expect(text).toContain('[TIME] (Stock Module)\nPrompt:\nTIME 24h')
        expect(text).not.toContain('[QUESTS]')
        expect(text).toContain('[HEAT] (Custom Tracker Module: Heat)\nPrompt:\nTrack HEAT.\nTemplate:\nHeat: 0/10')
        expect(text).toContain('<radiation> (Custom GM/Narrator Section)\nInstructions:\n<radiation>\nRADS accumulate.\n</radiation>')
        expect(text).not.toContain('<blank>')
        // The fallback text when the cartridge has none.
        const bare = pieces.moduleExamplesContext({ ...SETTINGS, stockPrompts: {}, gameSystemWizardInjectModulePrompts: true, gameSystemWizardModuleExampleKeys: ['stock:XP'] })
        expect(bare).toContain('[XP] (Stock Module)\nPrompt:\nFALLBACK XP')
        expect(pieces.moduleExamplesContext({ ...SETTINGS, gameSystemWizardInjectModulePrompts: false, gameSystemWizardModuleExampleKeys: ['stock:XP'] })).toBe('')
        expect(pieces.moduleExamplesContext({ ...SETTINGS, gameSystemWizardInjectModulePrompts: true, gameSystemWizardModuleExampleKeys: [] })).toBe('')
    })
})
