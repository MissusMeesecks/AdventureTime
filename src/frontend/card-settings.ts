/**
 * The two gears on the Campaign Records folders (78b): Multihog's ⚙ *NPC and
 * PC Card Settings* on the NPCs folder and ⚙ *Location Settings* on the
 * Locations folder, each a small box the records browser opens in the host's
 * modal.
 *
 * The NPC box holds what Multihog's does, each row the same preference or
 * cartridge key its other place on screen writes: *Show NPC portraits* is the
 * portraits switch of *General & visuals* (off, the NPCs draw as the compact
 * list, as the legacy's do); the two word targets are the NPC word targets
 * card's; *Relationship system* is the cartridge's `npcRelationshipBars`, the
 * switch under Character Sheets; *Values move by* and *Scale* are the
 * relationship preferences the Relationships fold held until 78b; *Add as is*
 * is the NPC creator's mode. Multihog's *Show Relationship Float Feedback*
 * has no counterpart here (the floater is not built) and is left out.
 *
 * The Location box holds the scene's *Drawing the picture* settings (49, 63b),
 * handed in by the panel: AdventureTime's location images are the pictures drawn
 * for a place, and their switch and triggers are what Multihog's *Show
 * Location Images* governs.
 */

import { RELATIONSHIP_MODE_LABELS } from './relations-text.js'

export interface CardSettingsHost {
    el(tag: string, attrs?: Record<string, string>): HTMLElement
    savePrefs(patch: Record<string, unknown>): Promise<void>
    /** A cartridge key written through the store, as the settings panel writes one. */
    saveSettings(patch: Record<string, unknown>): Promise<void>
    saveWordTargets(major: number, minor: number): Promise<{ applied: boolean }>
    fail(error: unknown): void
}

export interface CardSettingsPrefs {
    portraitsEnabled?: boolean
    npcMajorWords?: number
    npcMinorWords?: number
    relationshipMode?: string
    relationshipMax?: number
    npcAddAsIsMode?: string
    /** The float feedback (78c), Multihog's `npcRelationshipToast`. */
    npcRelationshipToast?: boolean
    /** Multihog's Show Location Images (80). */
    locationImages?: boolean
}

export interface CardSettings {
    /** ⚙ NPC and PC Card Settings. */
    npc: HTMLElement
    /** ⚙ Location Settings. */
    location: HTMLElement
    applyPrefs(prefs: CardSettingsPrefs): void
    /** The cartridge's relationship switch, as the backend last reported it. */
    applyRelationships(enabled: boolean): void
}

export const CARD_SETTINGS_CSS = `
.adventuretime-panel .lh-card-settings { display: flex; flex-direction: column; gap: 10px; font-size: 0.85em; }
.adventuretime-panel .lh-card-settings-title { font-weight: 700; font-size: 1.1em; color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
.adventuretime-panel .lh-card-settings-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.adventuretime-panel .lh-card-settings-row > span:first-child { flex: 1; min-width: 10em; }
.adventuretime-panel .lh-card-settings-row input[type="number"] { width: 6em; }
.adventuretime-panel .lh-card-settings-hint { font-size: 0.85em; opacity: 0.6; margin-top: -6px; }
.adventuretime-panel .lh-card-settings-radios { display: flex; flex-direction: column; gap: 4px; }
.adventuretime-panel .lh-card-settings-radios label { display: flex; gap: 6px; align-items: flex-start; cursor: pointer; }
.adventuretime-panel .lh-card-settings-note { font-size: 0.85em; opacity: 0.85; min-height: 1em; }
.adventuretime-panel .lh-card-settings-note--error { color: var(--lumiverse-danger, #ff6b6b); opacity: 1; }
.adventuretime-panel .lh-card-settings .lh-scene-picture-settings > summary { display: none; }
`

export function createCardSettings(host: CardSettingsHost, locationNodes: HTMLElement[]): CardSettings {
    const { el } = host

    const npc = el('div', { class: 'lh-card-settings lh-card-settings--npc', 'data-lh-field': 'npc-card-settings' })
    const npcTitle = el('div', { class: 'lh-card-settings-title' })
    npcTitle.textContent = '⚙️ NPC and PC Card Settings'
    const note = el('div', { class: 'lh-card-settings-note', 'data-lh-field': 'npc-card-settings-note' })
    let saving = false

    function say(text: string, error = false): void {
        note.textContent = text
        note.classList.toggle('lh-card-settings-note--error', error)
    }
    function save(work: () => Promise<unknown>, said: string): void {
        if (saving) return
        saving = true
        say('Saving…')
        work()
            .then(() => say(said))
            .catch((error: unknown) => { say(`Could not save: ${error instanceof Error ? error.message : String(error)}`, true); host.fail(error) })
            .finally(() => { saving = false })
    }

    const tickRow = (field: string, label: string, hint: string, onChange: (on: boolean) => void): { row: HTMLElement; input: HTMLInputElement; hintEl: HTMLElement } => {
        const row = el('label', { class: 'lh-card-settings-row' })
        const text = el('span')
        text.textContent = label
        const input = el('input', { type: 'checkbox', 'data-lh-field': field }) as HTMLInputElement
        const state = el('span', { class: 'lh-card-settings-state' })
        state.textContent = 'Disabled'
        input.addEventListener('change', () => { state.textContent = input.checked ? 'Enabled' : 'Disabled'; onChange(input.checked) })
        row.append(text, input, state)
        const hintEl = el('div', { class: 'lh-card-settings-hint' })
        hintEl.textContent = hint
        return { row, input, hintEl }
    }
    const setTick = (tick: { input: HTMLInputElement; row: HTMLElement }, on: boolean): void => {
        tick.input.checked = on
        const state = tick.row.querySelector('.lh-card-settings-state')
        if (state) state.textContent = on ? 'Enabled' : 'Disabled'
    }

    // Show NPC portraits: the portraits switch (72b), one preference in two places.
    const portraits = tickRow('npc-card-portraits', 'Show NPC portraits', 'Off, the NPCs draw as the compact list, like the Locations, and the cards show no portraits anywhere; it is the Show portraits switch of General & visuals.', (on) => {
        save(() => host.savePrefs({ portraitsEnabled: on }), on ? 'The NPCs draw as cards with their portraits.' : 'The NPCs draw as the compact list.')
    })

    // The two word targets (72b): the NPC word targets card's own op, which writes the sentences into the NPC instruction.
    const numberRow = (field: string, label: string, hint: string, fallback: number): { row: HTMLElement; input: HTMLInputElement; hintEl: HTMLElement } => {
        const row = el('label', { class: 'lh-card-settings-row' })
        const text = el('span')
        text.textContent = label
        const input = el('input', { type: 'number', min: '1', max: '5000', step: '5', class: 'lh-input', 'data-lh-field': field }) as HTMLInputElement
        input.value = String(fallback)
        row.append(text, input)
        const hintEl = el('div', { class: 'lh-card-settings-hint' })
        hintEl.textContent = hint
        return { row, input, hintEl }
    }
    const major = numberRow('npc-card-major-words', 'Major NPC total word target', 'Recurring, plot-important NPCs. Multihog’s default: 225 words across all sections.', 225)
    const minor = numberRow('npc-card-minor-words', 'Minor NPC total word target', 'Shopkeepers, guards, one-off encounters. Multihog’s default: 135 words across all sections.', 135)
    const saveWords = (): void => {
        const a = Math.max(1, Math.min(5000, Math.floor(Number(major.input.value) || 225)))
        const b = Math.max(1, Math.min(5000, Math.floor(Number(minor.input.value) || 135)))
        major.input.value = String(a)
        minor.input.value = String(b)
        if (saving) return
        saving = true
        say('Saving…')
        host.saveWordTargets(a, b)
            .then((result) => say(result.applied
                ? `Saved: ${a} words for a major NPC, ${b} for a minor one, written into the NPC instruction.`
                : `Saved as ${a} and ${b}, but the NPC instruction no longer carries the two length sentences, so nothing was written into it. Reset the instruction to stock under Agent modules to have them back.`, !result.applied))
            .catch((error: unknown) => { say(`Could not save: ${error instanceof Error ? error.message : String(error)}`, true); host.fail(error) })
            .finally(() => { saving = false })
    }
    major.input.addEventListener('change', saveWords)
    minor.input.addEventListener('change', saveWords)

    // Relationship system: the cartridge's switch under Character Sheets.
    const relations = tickRow('npc-card-relationships', 'Relationship system', 'Shows the friendship and affection bars on the NPC cards and the Full NPC Card, and asks the narrator for the awards; it is the Relationship system switch under Character Sheets.', (on) => {
        save(() => host.saveSettings({ npcRelationshipBars: on }), on ? 'The relationship system is on.' : 'The relationship system is off.')
    })

    // Show Relationship Float Feedback (78c): Multihog's switch, in its words, a preference.
    const floatRow = tickRow('npc-card-relationship-float', 'Show Relationship Float Feedback', 'Shows a floating Friendship/Affection graphic that rises and fades when those values change.', (on) => {
        save(() => host.savePrefs({ npcRelationshipToast: on }), on ? 'An award floats over the tracker as it lands.' : 'An award floats nothing; the cards and the history still move.')
    })

    // Values move by, and the scale: the two preferences the Relationships fold held (44).
    const modeRow = el('label', { class: 'lh-card-settings-row' })
    const modeText = el('span')
    modeText.textContent = 'Values move by'
    const modeSelect = el('select', { class: 'lh-input', 'aria-label': 'How relationship values move', 'data-lh-field': 'npc-card-relationship-mode' }) as HTMLSelectElement
    for (const [value, text] of Object.entries(RELATIONSHIP_MODE_LABELS)) {
        const option = el('option', { value }) as HTMLOptionElement
        option.textContent = text
        modeSelect.append(option)
    }
    modeSelect.addEventListener('change', () => {
        const mode = modeSelect.value === 'regex' ? 'regex' : 'state_tracker'
        save(() => host.savePrefs({ relationshipMode: mode }), `Values now move by ${RELATIONSHIP_MODE_LABELS[mode].toLowerCase()}.`)
    })
    modeRow.append(modeText, modeSelect)
    const maxRow = el('label', { class: 'lh-card-settings-row' })
    const maxText = el('span')
    maxText.textContent = 'Scale ±'
    const maxInput = el('input', { type: 'number', min: '10', max: '10000', step: '10', class: 'lh-input', 'aria-label': 'The relationship scale', 'data-lh-field': 'npc-card-relationship-max' }) as HTMLInputElement
    maxInput.value = '150'
    maxInput.addEventListener('change', () => {
        const max = Math.round(Number(maxInput.value))
        if (!Number.isFinite(max)) return
        const clamped = Math.min(Math.max(max, 10), 10000)
        maxInput.value = String(clamped)
        save(() => host.savePrefs({ relationshipMax: clamped }), `The scale is now ±${clamped}.`)
    })
    maxRow.append(maxText, maxInput)
    const scaleHint = el('div', { class: 'lh-card-settings-hint' })
    scaleHint.textContent = 'Both axes run from −scale to +scale; the tracker’s [RELATIONS] block or the narrator’s inline awards move them, and the agent sets a starting value when it records an NPC.'

    // "Add as is" import mode: the NPC creator's (41a).
    const addAsIs = el('div', { class: 'lh-card-settings-radios', 'data-lh-field': 'npc-card-add-as-is' })
    const addAsIsTitle = el('span')
    addAsIsTitle.textContent = '“Add as is” import mode'
    const radio = (value: 'literal' | 'ai_review', text: string, title: string): HTMLInputElement => {
        const label = el('label', { title })
        const input = el('input', { type: 'radio', name: 'lh-npc-card-add-as-is', value }) as HTMLInputElement
        const span = el('span')
        span.textContent = text
        label.append(input, span)
        addAsIs.append(label)
        input.addEventListener('change', () => {
            if (!input.checked) return
            save(() => host.savePrefs({ npcAddAsIsMode: value }), value === 'literal' ? 'Add as is wraps the card verbatim.' : 'Add as is sends the card for a minimal review first.')
        })
        return input
    }
    const literal = radio('literal', 'Literal — wraps the card verbatim in [CORE][/CORE]. No AI.', 'Wraps the card’s raw content in [CORE][/CORE] tags exactly as written. No AI involvement.')
    const review = radio('ai_review', 'AI Review — a minimal logical review; only world or era conflicts are corrected.', 'Sends the card to the model for a minimal logical review. Only corrects world or era conflicts; the original writing is kept as completely as possible.')
    addAsIs.prepend(addAsIsTitle)

    npc.append(npcTitle, portraits.row, portraits.hintEl, major.row, major.hintEl, minor.row, minor.hintEl, relations.row, relations.hintEl, floatRow.row, floatRow.hintEl, modeRow, maxRow, scaleHint, addAsIs, note)

    const location = el('div', { class: 'lh-card-settings lh-card-settings--location', 'data-lh-field': 'location-card-settings' })
    const locationTitle = el('div', { class: 'lh-card-settings-title' })
    locationTitle.textContent = '⚙️ Location Settings'
    // Show Location Images (80): Multihog's switch, in its words; off, the auto draw goes off too, as its applier does.
    const locationImages = tickRow('location-card-images', 'Show Location Images', 'When disabled, locations use the plain list without thumbnails, and drawing the picture on its own is turned off. Enabled, every location in the Campaign Records carries its picture; a click sets, draws or removes it.', (on) => {
        save(() => host.savePrefs(on ? { locationImages: true } : { locationImages: false, scenePictureAuto: false }), on ? 'The locations carry their pictures.' : 'The locations are the plain list; drawing the picture on its own is off.')
    })
    const locationHint = el('div', { class: 'lh-card-settings-hint' })
    locationHint.textContent = 'The pictures drawn for the places the party reaches: the switch, the trigger, the NPCs in the picture, the background. The same rows as Drawing the picture under the portraits in the settings.'
    location.append(locationTitle, locationImages.row, locationImages.hintEl, locationHint, ...locationNodes)

    return {
        npc,
        location,
        applyPrefs(prefs) {
            if (typeof prefs.portraitsEnabled === 'boolean') setTick(portraits, prefs.portraitsEnabled)
            if (typeof prefs.npcRelationshipToast === 'boolean') setTick(floatRow, prefs.npcRelationshipToast)
            if (typeof prefs.locationImages === 'boolean') setTick(locationImages, prefs.locationImages)
            if (typeof prefs.npcMajorWords === 'number' && document.activeElement !== major.input) major.input.value = String(prefs.npcMajorWords)
            if (typeof prefs.npcMinorWords === 'number' && document.activeElement !== minor.input) minor.input.value = String(prefs.npcMinorWords)
            if (prefs.relationshipMode && document.activeElement !== modeSelect) modeSelect.value = prefs.relationshipMode === 'regex' ? 'regex' : 'state_tracker'
            if (typeof prefs.relationshipMax === 'number' && document.activeElement !== maxInput) maxInput.value = String(prefs.relationshipMax)
            if (prefs.npcAddAsIsMode === 'literal') literal.checked = true
            else if (prefs.npcAddAsIsMode === 'ai_review') review.checked = true
        },
        applyRelationships(enabled) { setTick(relations, enabled) },
    }
}
