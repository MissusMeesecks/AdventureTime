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
        expect(Array.from(root.querySelectorAll('.lh-nc-title')).map((n) => n.textContent)).toEqual(['Pacing & reply length', 'Dice (RNG)', 'Quests', 'Optional components'])
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

describe('the narrator card’s text (96)', () => {
    const note = (root: HTMLElement, key: string) => root.querySelector(`[data-lh-nc-help="${key}"]`) as HTMLElement
    const label = (root: HTMLElement, field: string) => root.querySelector(`[data-lh-field="${field}"] .lh-nc-text`)!.textContent

    it('says the decided labels, with no lead paragraph and no help standing in the open', () => {
        const { root } = mount()
        expect(root.querySelector('.lh-nc-lead')).toBeNull()
        expect(root.querySelector('.lh-nc-hint')).toBeNull()
        expect(root.textContent).not.toContain('nothing has to be applied')
        expect(['normal', 'shorter_outputs', 'high_agency', 'downtime'].map((v) => label(root, `nc-pacing-${v}`))).toEqual(['Normal', 'Shorter replies', 'High agency', 'Downtime / slice of life'])
        expect(['hybrid', 'legacy', 'none'].map((v) => label(root, `nc-rng-${v}`))).toEqual(['Pre-seeded queue + tool calls', 'Pre-seeded queue only', 'No dice rolls'])
        expect(root.querySelector('[data-lh-field="nc-rng-advanced"] > summary')!.textContent).toBe('Advanced dice')
        expect(root.querySelector('[data-lh-field="nc-rng-advanced"]')!.classList.contains('lh-nc-advanced')).toBe(true)
        expect(['diceD100Mode', 'rngToolD20', 'rngToolD100', 'rngQueueD20', 'rngQueueD100', 'legacyDiceNaming'].map((k) => label(root, `nc-${k}`)))
            .toEqual(['d100 mode', 'RollTheDice tool', 'RollTheDiceD100 tool (d100)', 'd20 queue [RNG_QUEUE]', 'd100 queue [RNG_QUEUE_d100]', 'Plain dice tool (no DC first)'])
        expect(['quests', 'questsDeadlines', 'questsFrustration', 'questsShowArchive'].map((k) => label(root, `nc-${k}`)))
            .toEqual(['Track quests', 'Deadlines', 'Questgiver frustration (experimental)', 'Show closed quests'])
        expect(Array.from(root.querySelectorAll('.lh-nc-subtitle')).map((n) => n.textContent)).toEqual(['Optional rules', 'How the narrator asks for a map'])
        expect(NARRATOR_COMPONENTS.map((c) => c.label)).toEqual(['🎲 Loot rolls', '🌍 Random events', '💤 Rest limits', '⛺ Benched party', '🗺️ Persistent maps', '🧭 CYOA mode'])
        expect(['tool', 'text'].map((v) => label(root, `nc-opener-${v}`))).toEqual(['Tool call (CreateAreaMap)', 'Text block'])
        expect(label(root, 'nc-npcRelationshipBars')).toBe('💞 Relationship system')
    })

    it('keeps every piece of help behind a [?], in the block from the first paint and hidden', () => {
        const { root } = mount()
        const notes = Array.from(root.querySelectorAll<HTMLElement>('.lh-help-note'))
        // Four group headings but Quests' sub-heading, the opener's heading, and every tick row but Track quests.
        expect(notes.map((n) => n.getAttribute('data-lh-nc-help'))).toEqual([
            'pacing', 'rng', 'nc-diceD100Mode', 'nc-rngToolD20', 'nc-rngToolD100', 'nc-rngQueueD20', 'nc-rngQueueD100', 'nc-legacyDiceNaming',
            'quests', 'nc-questsDeadlines', 'nc-questsFrustration', 'nc-questsShowArchive',
            'components', 'nc-loot', 'nc-random_events', 'nc-resting', 'nc-party_bench', 'nc-dungeon_reality_and_hidden_mapping', 'opener', 'nc-CYOA_mode', 'nc-npcRelationshipBars',
        ])
        expect(notes.every((n) => n.hidden)).toBe(true)
        expect(root.querySelectorAll('.lh-help-tip')).toHaveLength(notes.length)
        // Neither the button nor the note sits inside a label: a press would be the tick's.
        expect(root.querySelector('label .lh-help-tip, label .lh-help-note')).toBeNull()
        expect(note(root, 'pacing').textContent).toBe('Sets how much the narrator writes in each reply and how much it drives the story itself. Normal adds no length instructions.')
        // An option cannot carry a [?]: its help is a line of the group's, opening with the option's name.
        expect(note(root, 'rng').textContent!.split('\n')).toEqual([
            'Sets where the narrator’s dice come from. Pre-seeded: a queue of fresh rolls is sent with every reply. Tool calls: the narrator calls the RollTheDice tool, which needs function calling on the narrator’s connection.',
            'Pre-seeded queue + tool calls: recommended when CYOA mode is off.',
            'Pre-seeded queue only: recommended when CYOA mode is on.',
            'No dice rolls: the narrator makes the numbers up. Not recommended.',
        ])
        expect(note(root, 'opener').textContent).toContain('Text block: works without function calling.')
        expect(note(root, 'nc-questsDeadlines').textContent).toBe('A quest can run out of time. The memo shows the time left. Turning this off also turns Frustration off.')
        expect(note(root, 'nc-npcRelationshipBars').textContent).toContain('Campaign Records tab')
        expect(root.textContent).not.toContain('Relationships fold')
        expect(note(root, 'nc-loot').textContent).toBe(NARRATOR_COMPONENTS[0]!.hint)
    })

    it('opens a row’s help on a press without ticking the row, and keeps it open across the redraw a switch makes', () => {
        const { root, flip, input, commits } = mount()
        const tip = note(root, 'nc-loot').parentElement!.querySelector('.lh-help-tip') as HTMLButtonElement
        tip.click()
        expect(note(root, 'nc-loot').hidden).toBe(false)
        expect(commits).toEqual([])
        expect(input('nc-loot').checked).toBe(true)
        flip('nc-resting', false)
        expect(note(root, 'nc-loot').hidden).toBe(false)
        expect(note(root, 'nc-loot').parentElement!.querySelector('.lh-help-tip')!.getAttribute('aria-expanded')).toBe('true')
        expect(note(root, 'nc-resting').hidden).toBe(true)
    })

    it('marks a helped row’s whole wrap for the settings search, so the help is searched and hidden with its row', () => {
        const { root } = mount()
        const wrap = root.querySelector('[data-lh-field="nc-loot"]')!.closest('.lh-search-item')!
        expect(wrap.classList.contains('lh-helped')).toBe(true)
        expect(wrap.contains(note(root, 'nc-loot'))).toBe(true)
        expect(root.querySelector('[data-lh-field="nc-quests"]')!.classList.contains('lh-search-item')).toBe(true)
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
