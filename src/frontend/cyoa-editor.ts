/**
 * The CYOA configuration, edited.
 *
 * What the legacy's ⚙️ popup holds, less the colours: the slot list (how many
 * choices, of which kinds), the presets that save and recall a slot list,
 * the four switches (emoji, the `<choices>` block, the `<button>` wrapper,
 * trimming older blocks out of the prompt), and the custom prompt that
 * replaces the builder's text. The colours are not drawn -- Lumiverse themes
 * the buttons -- and travel in the cartridge untouched.
 *
 * Writes the whole `cyoaConfig` bag on every change, through `onChange`; the
 * panel commits it and re-seeds this editor from the settings that come back,
 * like the other structured editors (lesson 30: the text inputs keep their
 * cursor, because a re-seed redraws only when the value differs).
 */

import { buildCyoaPrompt, CYOA_SLOT_TYPES, DEFAULT_CYOA_SLOTS, effectiveCyoaSlots, type CyoaConfig, type CyoaSlot } from '../tracker/cyoa.js'

export interface CyoaEditorHost {
    createElement: <K extends keyof HTMLElementTagNameMap>(
        tag: K,
        attrs?: Record<string, string>,
    ) => HTMLElementTagNameMap[K]
}

export interface CyoaEditor {
    setSettings(settings: { cyoaConfig?: CyoaConfig; syspromptModules?: Record<string, boolean> }): void
    destroy(): void
}

const SLOT_LABELS: Record<string, string> = {
    narrative: 'Narrative-decided',
    normal: 'Plain action',
    trait: 'Trait or ability',
    prefix: 'Prefixed',
    custom: 'Your own text',
}

/** The most choices a turn is asked for. The legacy's popup allows ten. */
export const MAX_CYOA_SLOTS = 10

export function mountCyoaEditor(
    root: HTMLElement,
    host: CyoaEditorHost,
    initial: { cyoaConfig?: CyoaConfig; syspromptModules?: Record<string, boolean> },
    onChange: (change: { cyoaConfig: CyoaConfig }) => void,
): CyoaEditor {
    const el = host.createElement
    let config: CyoaConfig = { ...(initial.cyoaConfig ?? {}) }
    let modeOn = initial.syspromptModules?.CYOA_mode === true

    root.classList.add('lh-cyoa')
    const summary = el('div', { class: 'lh-cyoa-summary' })
    const slotsHead = el('div', { class: 'lh-cyoa-head' })
    slotsHead.textContent = 'The choices, in order'
    const slotList = el('div', { class: 'lh-cyoa-slots' })
    const addSlot = el('button', { type: 'button', class: 'lh-button' })
    addSlot.textContent = 'Add a choice'
    addSlot.addEventListener('click', () => {
        const slots = effectiveCyoaSlots(config)
        if (slots.length >= MAX_CYOA_SLOTS) return
        commit({ slots: [...slots, { type: 'narrative' }] })
    })

    // Presets: a saved slot list, by name. The maintainer's cartridge carries
    // eleven, so this is not a nicety.
    const presetsHead = el('div', { class: 'lh-cyoa-head' })
    presetsHead.textContent = 'Presets'
    const presetRow = el('div', { class: 'lh-cyoa-row' })
    const presetSelect = el('select', { class: 'lh-select', 'data-lh-field': 'cyoa-preset' })
    const applyPreset = el('button', { type: 'button', class: 'lh-button' })
    applyPreset.textContent = 'Use'
    applyPreset.title = 'Replace the choices above with this preset’s'
    applyPreset.addEventListener('click', () => {
        const slots = config.presets?.[presetSelect.value]
        if (slots) commit({ slots: slots.map((s) => ({ ...s })) })
    })
    const deletePreset = el('button', { type: 'button', class: 'lh-button lh-button--quiet' })
    deletePreset.textContent = 'Delete'
    deletePreset.addEventListener('click', () => {
        const name = presetSelect.value
        if (!name || !config.presets?.[name]) return
        const presets = { ...config.presets }
        delete presets[name]
        commit({ presets })
    })
    presetRow.append(presetSelect, applyPreset, deletePreset)
    const saveRow = el('div', { class: 'lh-cyoa-row' })
    const presetName = el('input', { type: 'text', class: 'lh-input', placeholder: 'Name for the choices above', 'data-lh-field': 'cyoa-preset-name' })
    const savePreset = el('button', { type: 'button', class: 'lh-button' })
    savePreset.textContent = 'Save as preset'
    savePreset.addEventListener('click', () => {
        const name = presetName.value.trim()
        if (!name) return
        commit({ presets: { ...(config.presets ?? {}), [name]: effectiveCyoaSlots(config).map((s) => ({ ...s })) } })
        presetName.value = ''
    })
    saveRow.append(presetName, savePreset)

    const switches = el('div', { class: 'lh-cyoa-switches' })
    const switchRow = (key: keyof CyoaConfig, label: string, hint: string): HTMLInputElement => {
        const row = el('label', { class: 'lh-cyoa-switch' })
        const box = el('input', { type: 'checkbox', 'data-lh-field': `cyoa-${String(key)}` })
        const text = el('span')
        text.textContent = label
        row.title = hint
        row.append(box, text)
        box.addEventListener('change', () => { commit({ [key]: box.checked } as Partial<CyoaConfig>) })
        switches.append(row)
        return box
    }
    const emojiBox = switchRow('useEmojis', 'An emoji on each choice', 'The narrator is asked to prefix every choice with a fitting emoji.')
    const xmlBox = switchRow('useXmlTag', 'Wrap the choices in a <choices> block', 'Off, the buttons under each reply cannot be drawn: the block is how they are found.')
    const buttonBox = switchRow('useButtonTags', 'Wrap each choice in a <button> tag', 'Off, the choices are read one per line inside the block.')
    const stripBox = switchRow('stripOldChoicesFromPrompt', 'Trim older choice lists out of the prompt', 'Keeps the newest four replies’ choices as examples and drops the rest from what the narrator sees, as Multihog does.')

    const customHead = el('div', { class: 'lh-cyoa-head' })
    customHead.textContent = 'The prompt'
    const customRow = el('label', { class: 'lh-cyoa-switch' })
    const customBox = el('input', { type: 'checkbox', 'data-lh-field': 'cyoa-useCustomPrompt' })
    const customLabel = el('span')
    customLabel.textContent = 'Write the CYOA instruction myself'
    customRow.append(customBox, customLabel)
    const customText = el('textarea', { class: 'lh-cyoa-prompt', rows: '8', spellcheck: 'false', 'data-lh-field': 'cyoa-customPromptText' })
    customBox.addEventListener('change', () => {
        // Switching to a custom prompt starts from the builder's text, so
        // there is something to edit rather than a blank box.
        commit({
            useCustomPrompt: customBox.checked,
            ...(customBox.checked && !config.customPromptText?.trim() ? { customPromptText: buildCyoaPrompt(config) } : {}),
        })
    })
    customText.addEventListener('change', () => { commit({ customPromptText: customText.value }) })
    const customHint = el('div', { class: 'lh-cyoa-hint' })

    root.append(summary, slotsHead, slotList, addSlot, presetsHead, presetRow, saveRow, switches, customHead, customRow, customText, customHint)

    function commit(patch: Partial<CyoaConfig>): void {
        config = { ...config, ...patch }
        onChange({ cyoaConfig: { ...config } })
        render()
    }

    function renderSlot(slot: CyoaSlot, index: number, slots: CyoaSlot[]): HTMLElement {
        const row = el('div', { class: 'lh-cyoa-slot', 'data-lh-slot': String(index) })
        const number = el('span', { class: 'lh-cyoa-slot-number' })
        number.textContent = `${index + 1}.`
        const type = el('select', { class: 'lh-select' })
        for (const kind of CYOA_SLOT_TYPES) {
            const option = el('option', { value: kind })
            option.textContent = SLOT_LABELS[kind] ?? kind
            type.append(option)
        }
        type.value = CYOA_SLOT_TYPES.includes(slot.type as never) ? slot.type : 'narrative'
        type.addEventListener('change', () => {
            const next = slots.map((s, i) => (i === index ? { type: type.value } : s))
            commit({ slots: next })
        })
        const detail = el('input', { type: 'text', class: 'lh-input' })
        const kind = type.value
        if (kind === 'trait' || kind === 'prefix') {
            detail.placeholder = kind === 'trait' ? 'Trait name, or blank for any' : 'The prefix, or blank for any'
            detail.value = slot.label ?? ''
            detail.addEventListener('change', () => {
                commit({ slots: slots.map((s, i) => (i === index ? { type: kind, label: detail.value } : s)) })
            })
        } else if (kind === 'custom') {
            detail.placeholder = 'The choice, word for word ({{user}} is your name)'
            detail.value = slot.text ?? [slot.left, slot.right].filter(Boolean).join(' ')
            detail.addEventListener('change', () => {
                commit({ slots: slots.map((s, i) => (i === index ? { type: kind, text: detail.value } : s)) })
            })
        } else {
            detail.hidden = true
        }
        const remove = el('button', { type: 'button', class: 'lh-button lh-button--quiet' })
        remove.textContent = 'Remove'
        remove.title = 'Ask for one choice fewer'
        remove.disabled = slots.length <= 1
        remove.addEventListener('click', () => {
            commit({ slots: slots.filter((_, i) => i !== index) })
        })
        row.append(number, type, detail, remove)
        return row
    }

    function render(): void {
        const slots = effectiveCyoaSlots(config)
        summary.textContent = modeOn
            ? `The narrator is asked for ${slots.length} choice${slots.length === 1 ? '' : 's'} at the end of every reply, sent as its own message before the dice. Each becomes a button under the reply; press one to take it.`
            : 'CYOA mode is off. Switch it on under The rulebook above (the CYOA mode row) and the narrator ends every reply with choices you can press.'
        slotList.replaceChildren(...slots.map((slot, index) => renderSlot(slot, index, slots)))
        addSlot.disabled = slots.length >= MAX_CYOA_SLOTS

        const names = Object.keys(config.presets ?? {})
        const current = presetSelect.value
        presetSelect.replaceChildren()
        const blank = el('option', { value: '' })
        blank.textContent = names.length ? 'Choose a preset' : 'No presets saved'
        presetSelect.append(blank)
        for (const name of names) {
            const option = el('option', { value: name })
            option.textContent = name
            presetSelect.append(option)
        }
        presetSelect.value = names.includes(current) ? current : ''
        presetSelect.disabled = names.length === 0
        applyPreset.disabled = names.length === 0
        deletePreset.disabled = names.length === 0

        emojiBox.checked = config.useEmojis !== false
        xmlBox.checked = config.useXmlTag !== false
        buttonBox.checked = config.useButtonTags !== false
        stripBox.checked = config.stripOldChoicesFromPrompt !== false

        customBox.checked = config.useCustomPrompt === true
        customText.hidden = !customBox.checked
        const text = config.useCustomPrompt ? (config.customPromptText ?? '') : buildCyoaPrompt(config)
        if (customText.value !== text) customText.value = text
        customHint.textContent = customBox.checked
            ? 'Your text replaces the built instruction entirely, slots included. Untick to go back to the builder.'
            : 'The instruction is built from the choices above. Tick to write your own instead.'
    }

    render()

    return {
        setSettings(settings): void {
            config = { ...(settings.cyoaConfig ?? {}) }
            modeOn = settings.syspromptModules?.CYOA_mode === true
            render()
        },
        destroy(): void {
            root.replaceChildren()
        },
    }
}

export { DEFAULT_CYOA_SLOTS }
