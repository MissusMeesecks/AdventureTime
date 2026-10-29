// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest'

import { mountNarratorConfig, NARRATOR_COMPONENTS } from './narrator-config.js'
import type { SettingsBag } from '../settings/schema.js'

const createElement = (<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, string>): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag)
    for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, value)
    return node
}) as <K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, string>) => HTMLElementTagNameMap[K]

function mount(initial: SettingsBag = {}) {
    const root = document.createElement('div')
    const commits: SettingsBag[] = []
    const prefs: Array<Record<string, unknown>> = []
    const block = mountNarratorConfig(root, { createElement }, initial, {
        commit: (patch) => { commits.push(patch) },
        savePref: (patch) => { prefs.push(patch) },
    })
    const input = (field: string) => root.querySelector(`[data-lh-field="${field}"] input`) as HTMLInputElement
    const pick = (field: string) => { const node = input(field); node.checked = true; node.dispatchEvent(new Event('change')) }
    const flip = (field: string, on: boolean) => { const node = input(field); node.checked = on; node.dispatchEvent(new Event('change')) }
    const hidden = (field: string) => (root.querySelector(`[data-lh-field="${field}"]`) as HTMLElement).hidden
    return { root, block, commits, prefs, input, pick, flip, hidden }
}

describe('the narrator’s configuration (70)', () => {
    it('draws Multihog’s four groups in its order: pacing, RNG, quests, the optional components', () => {
        const { root } = mount()
        expect(Array.from(root.querySelectorAll('.lh-nc-title')).map((n) => n.textContent)).toEqual(['Pacing / output length', 'RNG', 'Quests', 'Optional components'])
        expect(root.querySelectorAll('[data-lh-field^="nc-pacing-"]')).toHaveLength(4)
        expect(root.querySelectorAll('[data-lh-field^="nc-rng-"]:not([data-lh-field="nc-rng-advanced"])')).toHaveLength(3)
        // The six components in the legacy's order, then the relationship system, which is a setting of its own.
        expect(NARRATOR_COMPONENTS.map((c) => c.flag)).toEqual(['loot', 'random_events', 'resting', 'party_bench', 'dungeon_reality_and_hidden_mapping', 'CYOA_mode'])
        expect(root.querySelector('[data-lh-field="nc-npcRelationshipBars"]')).not.toBeNull()
        // Nothing to apply: the rulebook reads the keys on every reply.
        expect(root.textContent).not.toContain('Apply')
    })

    it('reads the settings as the legacy does: a flag counts as on unless false, CYOA only when true', () => {
        const { input } = mount({ narrativePacing: 'downtime', rngEnabled: true, diceFunctionTool: false, syspromptModules: { loot: false, CYOA_mode: undefined }, npcRelationshipBars: true })
        expect(input('nc-pacing-downtime').checked).toBe(true)
        expect(input('nc-rng-legacy').checked).toBe(true)
        expect(input('nc-loot').checked).toBe(false)
        expect(input('nc-random_events').checked).toBe(true)
        expect(input('nc-quests').checked).toBe(true)
        expect(input('nc-CYOA_mode').checked).toBe(false)
        expect(input('nc-npcRelationshipBars').checked).toBe(true)
        const none = mount({ rngEnabled: false })
        expect(none.input('nc-rng-none').checked).toBe(true)
    })

    it('writes the pacing and the RNG mode as the schema’s own controls do', () => {
        const { pick, commits } = mount()
        pick('nc-pacing-high_agency')
        pick('nc-rng-hybrid')
        pick('nc-rng-none')
        expect(commits).toEqual([{ narrativePacing: 'high_agency' }, { rngEnabled: true, diceFunctionTool: true }, { rngEnabled: false, diceFunctionTool: false }])
    })

    it('keeps the dice switches under an advanced fold, and keeps the fold open across a redraw', () => {
        const { root, flip, commits } = mount()
        const fold = root.querySelector('[data-lh-field="nc-rng-advanced"]') as HTMLDetailsElement
        expect(fold.open).toBe(false)
        fold.open = true
        flip('nc-rngToolD100', true)
        expect(commits).toEqual([{ rngToolD100: true }])
        expect((root.querySelector('[data-lh-field="nc-rng-advanced"]') as HTMLDetailsElement).open).toBe(true)
    })

    it('writes a module flag into the whole table, as the rulebook editor does', () => {
        const { flip, commits } = mount({ syspromptModules: { loot: true, resting: false } })
        flip('nc-loot', false)
        expect(commits).toEqual([{ syspromptModules: { loot: false, resting: false } }])
    })

    it('shows the quest options only while quests are on, and turns frustration off with the deadlines', () => {
        const { flip, hidden, commits } = mount()
        expect(hidden('nc-quest-options')).toBe(false)
        expect(hidden('nc-frustration-wrap')).toBe(false)
        flip('nc-questsDeadlines', false)
        expect(commits.at(-1)).toEqual({ syspromptModules: { questsDeadlines: false, questsFrustration: false } })
        expect(hidden('nc-frustration-wrap')).toBe(true)
        flip('nc-quests', false)
        expect(hidden('nc-quest-options')).toBe(true)
    })

    it('moves the tracker’s benched-party module with the switch, and keeps the party module on with it', () => {
        const { flip, commits } = mount({ modules: { party: false, 'benched party': true } })
        flip('nc-party_bench', false)
        expect(commits[0]).toEqual({ syspromptModules: { party_bench: false }, modules: { party: false, 'benched party': false } })
        flip('nc-party_bench', true)
        expect(commits[1]).toEqual({ syspromptModules: { party_bench: true }, modules: { party: true, 'benched party': true } })
    })

    it('shows the Map Architect opener only under a Persistent maps switch that is on, and writes it as a preference', () => {
        const { pick, hidden, prefs, commits, flip, block, input } = mount()
        expect(hidden('nc-opener-wrap')).toBe(false)
        expect(input('nc-opener-tool').checked).toBe(true)
        pick('nc-opener-text')
        expect(prefs).toEqual([{ mapArchitectOpener: 'text' }])
        expect(commits).toEqual([])
        block.applyPrefs({ mapArchitectOpener: 'tool' })
        expect(input('nc-opener-tool').checked).toBe(true)
        flip('nc-dungeon_reality_and_hidden_mapping', false)
        expect(hidden('nc-opener-wrap')).toBe(true)
    })

    it('writes the relationship system as its own key', () => {
        const { flip, commits } = mount()
        flip('nc-npcRelationshipBars', true)
        expect(commits).toEqual([{ npcRelationshipBars: true }])
    })

    it('follows settings given to it, and gives every mount radio names of its own', () => {
        const a = mount({ narrativePacing: 'normal' })
        const b = mount({ narrativePacing: 'normal' })
        expect(a.input('nc-pacing-normal').name).not.toBe(b.input('nc-pacing-normal').name)
        a.block.setSettings({ narrativePacing: 'shorter_outputs', syspromptModules: { CYOA_mode: true } })
        expect(a.input('nc-pacing-shorter_outputs').checked).toBe(true)
        expect(a.input('nc-CYOA_mode').checked).toBe(true)
        expect(b.input('nc-pacing-normal').checked).toBe(true)
        a.block.destroy()
        expect(a.root.children).toHaveLength(0)
    })
})

describe('legacy dice logic (72b)', () => {
    it('is a preference under the advanced RNG settings, saved on its own and followed from the preferences', () => {
        const { prefs, flip, input, block } = mount()
        expect(input('nc-legacyDiceNaming').checked).toBe(false)
        flip('nc-legacyDiceNaming', true)
        expect(prefs).toEqual([{ legacyDiceNaming: true }])
        block.applyPrefs({ legacyDiceNaming: false })
        expect(input('nc-legacyDiceNaming').checked).toBe(false)
        block.applyPrefs({ legacyDiceNaming: true, mapArchitectOpener: 'tool' })
        expect(input('nc-legacyDiceNaming').checked).toBe(true)
    })
})
