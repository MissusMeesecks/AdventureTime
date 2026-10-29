/**
 * Multihog's Narrator Configuration block (Phase 70, roadmap row 70).
 *
 * The legacy draws it twice: in the State Tracker tab's onboarding screen,
 * after *Other Ways to Begin* (`renderer.js`, the `rt-onboarding-narrator-*`
 * fold), and in the settings modal's Game Systems tab
 * (`rpg_narrator_config_block`). Both write the same keys. So does this one:
 * pacing (`narrativePacing`), the RNG mode (`rngEnabled` and
 * `diceFunctionTool`, with the store setting the four dice flags to match,
 * `rng-flags.ts`), the advanced dice switches, the quest switches and the
 * optional components (`syspromptModules`), the relationship system
 * (`npcRelationshipBars`), and the Map Architect's opener, which is a
 * preference here (`mapArchitectOpener`, 46) and shows only while the
 * Persistent maps component is on, as the legacy's sub-drawer does.
 *
 * The block is mounted in two places — the settings' *Game systems &
 * customisation* card and the tracker's *Starting the Adventure* area — so
 * every radio group carries a name of its own per mount, and a change made
 * in either place reaches the other through the backend's `settings.changed`
 * event, which the panel turns into `setSettings` here. Nothing is applied by
 * a button: the rulebook is assembled from these keys on every reply, where
 * Multihog's *Apply System Prompt* wrote SillyTavern's Main box.
 *
 * Read rules are the legacy's: a module flag counts as on unless it is
 * `false`, except `CYOA_mode`, which counts as on only when `true`; turning
 * Deadlines off turns Frustration off with it; the Benched party switch sets
 * the tracker's `benched party` module too, and turning it on makes sure
 * the `party` module is on (`card-events.js`).
 */

import { NARRATIVE_PACING_OPTIONS, RNG_MODE_OPTIONS, readRngMode, writeRngMode, type SettingsBag } from '../settings/schema.js'

export interface NarratorConfigHost {
    createElement: <K extends keyof HTMLElementTagNameMap>(
        tag: K,
        attrs?: Record<string, string>,
    ) => HTMLElementTagNameMap[K]
}

export interface NarratorConfigDeps {
    /** Write cartridge keys. The answer comes back through `setSettings`. */
    commit: (patch: SettingsBag) => void
    /** Write the Map Architect opener preference. The answer comes back through `applyPrefs`. */
    savePref: (patch: Record<string, unknown>) => void
}

export interface NarratorConfig {
    setSettings(settings: SettingsBag): void
    applyPrefs(prefs: Record<string, unknown>): void
    destroy(): void
}

/** The optional components, in Multihog's order, each a rulebook flag. */
export const NARRATOR_COMPONENTS: ReadonlyArray<{ flag: string; label: string; hint: string }> = [
    { flag: 'loot', label: '🎲 Loot rolls', hint: 'The narrator rolls for what a defeated foe or a searched room yields.' },
    { flag: 'random_events', label: '🌍 Random event rolls', hint: 'A roll now and then for something the party did not go looking for.' },
    { flag: 'resting', label: '💤 Resting restrictions', hint: 'At least nine in-world hours between rests.' },
    { flag: 'party_bench', label: '⛺ Benched party', hint: 'Companions temporarily separated from the party are kept, not forgotten, and come back on their own.' },
    { flag: 'dungeon_reality_and_hidden_mapping', label: '🗺️ Persistent maps', hint: 'A hidden map is drawn before a dungeon, ruin, town or city is explored, and kept as GM canon. New maps need the CreateAreaMap tool, or the text opener below.' },
    { flag: 'CYOA_mode', label: '🧭 CYOA mode (action choices every turn)', hint: 'Every reply ends with choices drawn as buttons. The slots and presets are under General & visuals, CYOA Mode.' },
]

export const NARRATOR_CONFIG_CSS = `
.lh-nc { display: flex; flex-direction: column; gap: 10px; font-size: 0.85em; }
.lh-nc-lead { opacity: 0.85; line-height: 1.45; }
.lh-nc-group { display: flex; flex-direction: column; gap: 4px; }
.lh-nc-title { font-weight: 600; font-size: 0.95em; letter-spacing: 0.02em; }
.lh-nc-hint { font-size: 0.9em; opacity: 0.7; line-height: 1.4; }
.lh-nc-choice, .lh-nc-switch { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; }
.lh-nc-choice input, .lh-nc-switch input { flex: 0 0 auto; margin: 2px 0 0; }
.lh-nc-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.lh-nc-sub { display: flex; flex-direction: column; gap: 4px; margin-left: 22px; padding-left: 8px; border-left: 2px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25))); }
.lh-nc-sub[hidden] { display: none; }
.lh-nc-subtitle { font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.7; }
.lh-nc-advanced > summary { cursor: pointer; font-size: 0.9em; opacity: 0.8; }
.lh-nc-advanced .lh-nc-sub { margin-top: 4px; }
`

let mounts = 0

export function mountNarratorConfig(
    root: HTMLElement,
    host: NarratorConfigHost,
    initial: SettingsBag,
    deps: NarratorConfigDeps,
): NarratorConfig {
    const el = host.createElement
    const uid = `lh-nc-${++mounts}`
    let settings: SettingsBag = { ...initial }
    let opener = 'tool'
    let legacyDice = false

    const mods = (): Record<string, unknown> => {
        const raw = settings.syspromptModules
        return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {}
    }
    const flagOn = (flag: string): boolean => (flag === 'CYOA_mode' ? mods().CYOA_mode === true : mods()[flag] !== false)

    function setFlags(changes: Record<string, boolean>): void {
        const next = { ...mods(), ...changes }
        const patch: SettingsBag = { syspromptModules: next }
        if ('party_bench' in changes) {
            // The legacy's rule: the tracker's benched-party module follows the
            // switch, and benching needs the party module on.
            const rawModules = settings.modules
            const modules = rawModules && typeof rawModules === 'object' && !Array.isArray(rawModules) ? { ...(rawModules as Record<string, unknown>) } : {}
            modules['benched party'] = changes.party_bench
            if (changes.party_bench) modules.party = true
            patch.modules = modules
            settings = { ...settings, modules }
        }
        settings = { ...settings, syspromptModules: next }
        deps.commit(patch)
        render()
    }

    function group(title: string, hint?: string): { box: HTMLElement; body: HTMLElement } {
        const box = el('div', { class: 'lh-nc-group' })
        const head = el('div', { class: 'lh-nc-title' })
        head.textContent = title
        box.append(head)
        if (hint) {
            const note = el('div', { class: 'lh-nc-hint' })
            note.textContent = hint
            box.append(note)
        }
        return { box, body: box }
    }

    function radio(name: string, value: string, label: string, checked: boolean, onPick: () => void, field: string): HTMLElement {
        const row = el('label', { class: 'lh-nc-choice lh-search-item', 'data-lh-field': field })
        const input = el('input', { type: 'radio', name: `${uid}-${name}`, value })
        input.checked = checked
        input.addEventListener('change', () => { if (input.checked) onPick() })
        const text = el('span', { class: 'lh-nc-text' })
        text.textContent = label
        row.append(input, text)
        return row
    }

    function toggle(label: string, hint: string | undefined, checked: boolean, onChange: (value: boolean) => void, field: string): HTMLElement {
        const row = el('label', { class: 'lh-nc-switch lh-search-item', 'data-lh-field': field })
        const input = el('input', { type: 'checkbox' })
        input.checked = checked
        input.addEventListener('change', () => { onChange(input.checked) })
        const text = el('span', { class: 'lh-nc-text' })
        const name = el('span')
        name.textContent = label
        text.append(name)
        if (hint) {
            const note = el('span', { class: 'lh-nc-hint' })
            note.textContent = hint
            text.append(note)
        }
        row.append(input, text)
        return row
    }

    function render(): void {
        // A redraw keeps the advanced fold as the hand left it: a switch inside it commits and redraws.
        const advancedOpen = (root.querySelector('[data-lh-field="nc-rng-advanced"]') as HTMLDetailsElement | null)?.open ?? false
        const lead = el('div', { class: 'lh-nc-lead' })
        lead.textContent = 'Select your preferred modes and components. They reach the narrator’s rulebook on the next reply; nothing has to be applied.'

        // Pacing, the legacy's four radios.
        const pacing = group('Pacing / output length', 'How much the narrator writes per reply, and how much it drives the story itself.')
        const current = String(settings.narrativePacing ?? 'normal')
        for (const option of NARRATIVE_PACING_OPTIONS) {
            pacing.body.append(radio('pacing', option.value, option.label, current === option.value, () => {
                settings = { ...settings, narrativePacing: option.value }
                deps.commit({ narrativePacing: option.value })
            }, `nc-pacing-${option.value}`))
        }

        // The RNG mode, with the dice switches under an advanced fold.
        const rng = group('RNG', 'Where the narrator’s dice come from. Pre-seeded: a queue of rolls goes with every reply. Tool calls: the narrator calls RollTheDice, which needs function calling on its connection.')
        const mode = readRngMode(settings)
        for (const option of RNG_MODE_OPTIONS) {
            rng.body.append(radio('rng', option.value, option.label, mode === option.value, () => {
                const patch = writeRngMode(option.value)
                settings = { ...settings, ...patch }
                deps.commit(patch)
            }, `nc-rng-${option.value}`))
        }
        const advanced = el('details', { class: 'lh-nc-advanced', 'data-lh-field': 'nc-rng-advanced' }) as HTMLDetailsElement
        advanced.open = advancedOpen
        const advancedHead = el('summary')
        advancedHead.textContent = '⚙️ Advanced RNG settings'
        const advancedBody = el('div', { class: 'lh-nc-sub' })
        const dice: Array<[string, string, string]> = [
            ['diceD100Mode', '🎲 d100 mode', 'Percentage rulesets: the rulebook’s dice wording says d100, and the queue and the tool switch to their d100 forms.'],
            ['rngToolD20', 'RollTheDice (unified tool)', 'The narrator’s dice tool, the DC declared first.'],
            ['rngToolD100', 'RollTheDiceD100 (d100 tool)', 'The same tool for percentage rulesets. Ticking it turns d100 mode on.'],
            ['rngQueueD20', '[RNG_QUEUE] (d20 queue)', 'Twelve lines of d20, d4, d6, d8, d10 and d12, fresh for every reply.'],
            ['rngQueueD100', '[RNG_QUEUE_d100] (d100 queue)', 'Thirty d100 lines, fresh for every reply.'],
        ]
        for (const [key, label, hint] of dice) {
            advancedBody.append(toggle(label, hint, settings[key] === true, (value) => {
                settings = { ...settings, [key]: value }
                deps.commit({ [key]: value })
            }, `nc-${key}`))
        }
        // Legacy Dice Logic (72b): a preference, not a cartridge key — the legacy's vanilla RollTheDice, no DC committed first.
        advancedBody.append(toggle('Legacy dice logic (vanilla)', 'The vanilla RollTheDice tool, with no DC committed before the roll; the queue’s default die becomes a d6. For a connection that balks at the DC-first tool.', legacyDice, (value) => {
            legacyDice = value
            deps.savePref({ legacyDiceNaming: value })
        }, 'nc-legacyDiceNaming'))
        advanced.append(advancedHead, advancedBody)
        rng.body.append(advanced)

        // The quests and their hardcore options.
        const quests = group('Quests', 'The narrator keeps a quest log in the state memo, drawn as cards.')
        const questsOn = flagOn('quests')
        quests.body.append(toggle('Enable quests', undefined, questsOn, (value) => { setFlags({ quests: value }) }, 'nc-quests'))
        const questOptions = el('div', { class: 'lh-nc-sub', 'data-lh-field': 'nc-quest-options' })
        questOptions.hidden = !questsOn
        const hardcore = el('div', { class: 'lh-nc-subtitle' })
        hardcore.textContent = 'Hardcore / optional'
        questOptions.append(hardcore)
        const deadlinesOn = flagOn('questsDeadlines')
        questOptions.append(toggle('Deadlines', 'A quest can run out of time, and the clock on it is in the memo.', deadlinesOn, (value) => {
            // Turning deadlines off turns frustration off with it, as the legacy does.
            setFlags(value ? { questsDeadlines: true } : { questsDeadlines: false, questsFrustration: false })
        }, 'nc-questsDeadlines'))
        const frustration = el('div', { class: 'lh-nc-sub', 'data-lh-field': 'nc-frustration-wrap' })
        frustration.hidden = !deadlinesOn
        frustration.append(toggle('↳ Frustration (experimental)', 'The questgiver’s mood follows the time pressure, for quests an NPC gave.', flagOn('questsFrustration'), (value) => { setFlags({ questsFrustration: value }) }, 'nc-questsFrustration'))
        questOptions.append(frustration)
        questOptions.append(toggle('Show completed and failed quests', 'Keep them in the quest cards after they close.', flagOn('questsShowArchive'), (value) => { setFlags({ questsShowArchive: value }) }, 'nc-questsShowArchive'))
        quests.body.append(questOptions)

        // The optional components, each a rulebook section.
        const components = group('Optional components', 'Each is a section of the narrator’s rulebook; the rulebook card lists them all with their cost.')
        for (const component of NARRATOR_COMPONENTS) {
            components.body.append(toggle(component.label, component.hint, flagOn(component.flag), (value) => { setFlags({ [component.flag]: value }) }, `nc-${component.flag}`))
            if (component.flag === 'dungeon_reality_and_hidden_mapping') {
                // The Map Architect opener (46), a preference, under the maps switch as the legacy's sub-drawer.
                const wrap = el('div', { class: 'lh-nc-sub', 'data-lh-field': 'nc-opener-wrap' })
                wrap.hidden = !flagOn('dungeon_reality_and_hidden_mapping')
                const title = el('div', { class: 'lh-nc-subtitle' })
                title.textContent = 'Map Architect opener'
                wrap.append(title)
                for (const [value, label] of [['tool', 'Tool call (CreateAreaMap) — needs function calling'], ['text', 'Text command — no function calling; the narrator writes a [CREATE_AREA_MAP] block and stops']] as const) {
                    wrap.append(radio('opener', value, label, opener === value, () => {
                        opener = value
                        deps.savePref({ mapArchitectOpener: value })
                    }, `nc-opener-${value}`))
                }
                components.body.append(wrap)
            }
        }
        components.body.append(toggle('💞 Relationship system (friendship and affection)', 'Every NPC’s standing toward you, two bars each, in the Relationships fold.', settings.npcRelationshipBars === true, (value) => {
            settings = { ...settings, npcRelationshipBars: value }
            deps.commit({ npcRelationshipBars: value })
        }, 'nc-npcRelationshipBars'))

        root.replaceChildren(lead, pacing.box, rng.box, quests.box, components.box)
        root.classList.add('lh-nc')
    }

    render()

    return {
        setSettings(next: SettingsBag): void {
            settings = { ...next }
            render()
        },
        applyPrefs(prefs: Record<string, unknown>): void {
            if (prefs.legacyDiceNaming !== undefined && (prefs.legacyDiceNaming === true) !== legacyDice) {
                legacyDice = prefs.legacyDiceNaming === true
                const box = root.querySelector('[data-lh-field="nc-legacyDiceNaming"] input') as HTMLInputElement | null
                if (box) box.checked = legacyDice
            }
            if (prefs.mapArchitectOpener === undefined) return
            const next = prefs.mapArchitectOpener === 'text' ? 'text' : 'tool'
            if (next === opener) return
            opener = next
            render()
        },
        destroy(): void {
            root.replaceChildren()
            root.classList.remove('lh-nc')
        },
    }
}
