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

import { createHelpTip } from './help-tip.js'
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
    narrative: 'Decided by the narrator',
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
    // Help is behind a [?] after the text it explains, its note directly under (96).
    const elAny = el as unknown as (tag: string, attrs?: Record<string, string>) => HTMLElement
    const helped = (line: HTMLElement, label: string, help: string): { text: HTMLElement; note: HTMLElement } => {
        const text = el('span')
        text.textContent = label
        const tip = createHelpTip(elAny, label, help)
        line.append(text, tip.button)
        return { text, note: tip.note }
    }
    const summary = el('div', { class: 'lh-cyoa-summary' })
    const summaryHelp = helped(summary, 'Choices', 'The choices instruction is sent to the narrator as its own message. Each choice becomes a button under the reply. Press a button to send that choice as your message.')
    const summaryText = summaryHelp.text
    const slotsHead = el('div', { class: 'lh-cyoa-head' })
    // The custom kind's rule was a placeholder that vanished as typing began (audit finding 28).
    const slotsHelp = helped(slotsHead, 'Choices, in order', '"Your own text" is sent word for word, and {{user}} stands for your name.')
    const slotList = el('div', { class: 'lh-cyoa-slots' })
    const addSlot = el('button', { type: 'button', class: 'lh-button' })
    addSlot.textContent = 'Add choice'
    addSlot.addEventListener('click', () => {
        const slots = effectiveCyoaSlots(config)
        if (slots.length >= MAX_CYOA_SLOTS) return
        commit({ slots: [...slots, { type: 'narrative' }] })
    })

    // Presets: a saved slot list, by name. The maintainer's cartridge carries
    // eleven, so this is not a nicety.
    const presetsHead = el('div', { class: 'lh-cyoa-head' })
    const presetsHelp = helped(presetsHead, 'Presets', 'Load replaces the choices above with the ones saved in this preset.')
    const presetRow = el('div', { class: 'lh-cyoa-row' })
    const presetSelect = el('select', { class: 'lh-select', 'data-lh-field': 'cyoa-preset' })
    const applyPreset = el('button', { type: 'button', class: 'lh-button' })
    applyPreset.textContent = 'Load'
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
    const presetName = el('input', { type: 'text', class: 'lh-input', placeholder: 'Preset name', 'aria-label': 'Preset name', 'data-lh-field': 'cyoa-preset-name' })
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
        // The [?] and its note stay outside the <label>, or a press would tick the box.
        const row = el('div', { class: 'lh-cyoa-switch-row' })
        const line = el('div', { class: 'lh-cyoa-line' })
        const tick = el('label', { class: 'lh-cyoa-switch' })
        const box = el('input', { type: 'checkbox', 'data-lh-field': `cyoa-${String(key)}` })
        const text = el('span')
        text.textContent = label
        tick.append(box, text)
        const tip = createHelpTip(elAny, label, hint)
        line.append(tick, tip.button)
        row.append(line, tip.note)
        box.addEventListener('change', () => { commit({ [key]: box.checked } as Partial<CyoaConfig>) })
        switches.append(row)
        return box
    }
    const emojiBox = switchRow('useEmojis', 'Emoji on each choice', 'When on, the narrator is asked to start every choice with a fitting emoji. Default: on.')
    const xmlBox = switchRow('useXmlTag', 'Wrap choices in a <choices> block', 'When on, the narrator wraps its choices in a <choices> block. AdventureTime finds the choices by this block, so the buttons under each reply cannot be drawn when it is off. Default: on.')
    const buttonBox = switchRow('useButtonTags', 'Wrap each choice in a <button> tag', 'When on, the narrator wraps each choice in a <button> tag. When off, AdventureTime reads one choice per line inside the block. Default: on.')
    const stripBox = switchRow('stripOldChoicesFromPrompt', 'Trim old choices from the prompt', 'When on, only the four newest choice lists in the chat are sent to the narrator, as examples. Older choice lists are left out of the prompt. Default: on.')

    const customHead = el('div', { class: 'lh-cyoa-head' })
    customHead.textContent = 'Prompt'
    const customRow = el('div', { class: 'lh-cyoa-line' })
    const customTick = el('label', { class: 'lh-cyoa-switch' })
    const customBox = el('input', { type: 'checkbox', 'data-lh-field': 'cyoa-useCustomPrompt' })
    const customLabel = el('span')
    customLabel.textContent = 'Write the instruction myself'
    customTick.append(customBox, customLabel)
    const customTip = createHelpTip(elAny, 'Write the instruction myself', 'When off, the instruction is built from the choices above. When on, your own text replaces the built instruction, including the choice list. Default: off.')
    customRow.append(customTick, customTip.button)
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

    root.append(summary, summaryHelp.note, slotsHead, slotsHelp.note, slotList, addSlot, presetsHead, presetsHelp.note, presetRow, saveRow, switches, customHead, customRow, customTip.note, customText)

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
            detail.placeholder = kind === 'trait' ? 'Trait name (optional)' : 'Prefix (optional)'
            detail.value = slot.label ?? ''
            detail.addEventListener('change', () => {
                commit({ slots: slots.map((s, i) => (i === index ? { type: kind, label: detail.value } : s)) })
            })
        } else if (kind === 'custom') {
            detail.placeholder = '{{user}} looks around'
            detail.value = slot.text ?? [slot.left, slot.right].filter(Boolean).join(' ')
            detail.addEventListener('change', () => {
                commit({ slots: slots.map((s, i) => (i === index ? { type: kind, text: detail.value } : s)) })
            })
        } else {
            detail.hidden = true
        }
        const remove = el('button', { type: 'button', class: 'lh-button lh-button--quiet' })
        remove.textContent = 'Remove'
        remove.disabled = slots.length <= 1
        remove.addEventListener('click', () => {
            commit({ slots: slots.filter((_, i) => i !== index) })
        })
        row.append(number, type, detail, remove)
        return row
    }

    function render(): void {
        const slots = effectiveCyoaSlots(config)
        summaryText.textContent = modeOn
            ? `The narrator offers ${slots.length} choice${slots.length === 1 ? '' : 's'} after every reply.`
            : 'CYOA mode is off. Turn it on with the CYOA mode switch on the Narrator card, under Game systems & rulebook.'
        slotList.replaceChildren(...slots.map((slot, index) => renderSlot(slot, index, slots)))
        addSlot.disabled = slots.length >= MAX_CYOA_SLOTS

        const names = Object.keys(config.presets ?? {})
        const current = presetSelect.value
        presetSelect.replaceChildren()
        const blank = el('option', { value: '' })
        blank.textContent = names.length ? 'Choose a preset' : 'No saved presets'
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
