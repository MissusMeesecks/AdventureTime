/**
 * The art styles (Phase 63b, roadmap row 63): Multihog's Portrait Prompt
 * Library on the *Portraits & location images* section — the seven
 * built-in styles, each loading its three prompts into the templates below
 * and its word target, and the user's own setups saved under a name with
 * **Save setup**, loaded back, or deleted. The row loaded last
 * is marked; an edit to any of the three prompts unmarks it (the backend's
 * rule, with the legacy's). Mounted on the cartridge's
 * `savedPortraitPromptPresets` row; the backend's three preset ops do the
 * writing and answer with the settings whole, which re-seeds every editor.
 *
 * The words are the copy deck's (96): a style is shown under its display
 * name and description (`portraitPresetDisplay`; the generated file keeps
 * Multihog's, and the ids and reserved names stay the generated ones), each
 * row's description is behind its [?], and a confirm names its action.
 */

import type { SettingsBag } from '../settings/schema.js'
import { FACTORY_PORTRAIT_PRESETS, portraitPresetDisplay, savedPresetId, type SavedPortraitPreset } from '../tracker/portrait-presets.js'
import { createHelpTip } from './help-tip.js'

export interface PortraitStylesDeps {
    createElement(tag: string, attrs?: Record<string, string>): HTMLElement
}

export interface PortraitStylesHost {
    /** Load a factory style by id, or a saved setup by `user:Name`. */
    load(id: string): Promise<void>
    /** Save the three prompts, the word target and the NPCs choice under a name. */
    save(name: string, overwrite: boolean): Promise<void>
    remove(name: string): Promise<void>
    /** Asks first: the title names the editor, the label is the verb (96, the audit's finding 25). */
    confirm(title: string, message: string, label: string): Promise<boolean>
}

export interface PortraitStyles {
    setSettings(settings: SettingsBag): void
}

export const PORTRAIT_STYLES_CSS = `
.lh-styles { display: flex; flex-direction: column; gap: 4px; font-size: 0.8em; }
.lh-styles-label { opacity: 0.75; margin-top: 4px; }
.lh-style { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; padding: 3px 6px; border-radius: 4px; background: rgba(255,255,255,0.05); }
.lh-style--active { outline: 1px solid rgba(120,180,255,0.35); background: rgba(120,180,255,0.12); }
.lh-style-name { flex: 0 1 auto; min-width: 0; }
.lh-style-end { display: flex; gap: 6px; align-items: center; margin-left: auto; }
.lh-style-badge { font-size: 0.8em; opacity: 0.8; }
.lh-styles-save { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 4px; }
.lh-styles-save input { flex: 1; min-width: 8em; }
.lh-styles-note { opacity: 0.85; }
.lh-styles-note--error { color: #e57373; }
`

export function mountPortraitStyles(mount: HTMLElement, deps: PortraitStylesDeps, initial: SettingsBag, host: PortraitStylesHost): PortraitStyles {
    const el = deps.createElement
    const root = el('div', { class: 'lh-styles', 'data-lh-field': 'portrait-styles' })
    const factoryLabel = el('div', { class: 'lh-styles-label' })
    factoryLabel.textContent = 'Built-in styles'
    const factoryList = el('div', { 'data-lh-field': 'portrait-styles-factory' })
    const savedLabel = el('div', { class: 'lh-styles-label', 'data-lh-field': 'portrait-styles-saved-label' })
    const savedList = el('div', { 'data-lh-field': 'portrait-styles-saved' })
    const saveRow = el('div', { class: 'lh-styles-save' })
    const nameInput = el('input', { type: 'text', class: 'lh-input', placeholder: 'Setup name', 'data-lh-field': 'style-name', 'aria-label': 'Setup name' }) as HTMLInputElement
    const saveButton = el('button', { type: 'button', class: 'lh-button' }) as HTMLButtonElement
    saveButton.textContent = 'Save setup'
    const saveTip = createHelpTip(el, 'Save setup', 'Saves the three prompts, the word target and the "Include present NPCs in the picture" choice under this name. Saved setups are part of the cartridge.')
    saveRow.append(nameInput, saveButton, saveTip.button, saveTip.note)
    const note = el('div', { class: 'lh-styles-note', 'data-lh-field': 'portrait-styles-note' })
    root.append(factoryLabel, factoryList, savedLabel, savedList, saveRow, note)
    mount.append(root)

    let settings = initial
    let busy = false

    function say(text: string, error = false): void {
        note.textContent = text
        note.classList.toggle('lh-styles-note--error', error)
    }

    function run(what: () => Promise<void>, done: string): void {
        if (busy) return
        busy = true
        draw()
        what()
            .then(() => say(done))
            .catch((error: unknown) => say(error instanceof Error ? error.message : String(error), true))
            .finally(() => { busy = false; draw() })
    }

    /**
     * @param name the row's visible name
     * @param help the description, behind the row's [?]
     * @param loadLabel the Load button's screen-reader name
     */
    function row(name: string, help: string, loadLabel: string, active: boolean, onLoad: () => void, onDelete?: () => void): HTMLElement {
        const line = el('div', { class: `lh-style${active ? ' lh-style--active' : ''}` })
        const label = el('span', { class: 'lh-style-name' })
        label.textContent = name
        const tip = createHelpTip(el, name, help)
        const end = el('span', { class: 'lh-style-end' })
        if (active) {
            const badge = el('span', { class: 'lh-style-badge' })
            badge.textContent = 'loaded'
            end.append(badge)
        }
        const load = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'aria-label': loadLabel }) as HTMLButtonElement
        load.textContent = 'Load'
        load.disabled = busy
        load.addEventListener('click', onLoad)
        end.append(load)
        if (onDelete) {
            const del = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'aria-label': `Delete setup ${name}` }) as HTMLButtonElement
            del.textContent = '✖'
            del.title = 'Delete setup'
            del.disabled = busy
            del.addEventListener('click', onDelete)
            end.append(del)
        }
        line.append(label, tip.button, end, tip.note)
        return line
    }

    function draw(): void {
        const active = typeof settings.activePortraitPromptPresetId === 'string' ? settings.activePortraitPromptPresetId : ''
        factoryList.replaceChildren(...FACTORY_PORTRAIT_PRESETS.map((preset) => {
            // The display words (96); the id is the generated one, and so is the name a saved setup may not take.
            const shown = portraitPresetDisplay(preset)
            return row(
                shown.name,
                shown.description,
                `Load ${shown.name.charAt(0).toLowerCase()}${shown.name.slice(1)}`,
                active === preset.id,
                () => run(() => host.load(preset.id), `Loaded the ${shown.name} style.`),
            )
        }))
        const saved = (settings.savedPortraitPromptPresets && typeof settings.savedPortraitPromptPresets === 'object' ? settings.savedPortraitPromptPresets : {}) as Record<string, SavedPortraitPreset>
        const names = Object.keys(saved)
        savedLabel.textContent = names.length ? 'Saved setups' : 'Saved setups (none yet)'
        savedList.replaceChildren(...names.map((name) => row(
            name,
            'Your saved prompts, word target and NPC choice.',
            `Load ${name}`,
            active === savedPresetId(name),
            () => run(() => host.load(savedPresetId(name)), `Loaded the setup ${name}.`),
            () => {
                host.confirm('Art styles', `Delete the setup "${name}"? This cannot be undone.`, 'Delete')
                    .then((yes) => { if (yes) run(() => host.remove(name), `Deleted the setup ${name}.`) })
                    .catch((error: unknown) => say(error instanceof Error ? error.message : String(error), true))
            },
        )))
        saveButton.disabled = busy
    }

    saveButton.addEventListener('click', () => {
        const name = nameInput.value.trim()
        if (!name) { say('Enter a setup name first.', true); return }
        const saved = (settings.savedPortraitPromptPresets && typeof settings.savedPortraitPromptPresets === 'object' ? settings.savedPortraitPromptPresets : {}) as Record<string, unknown>
        const exists = Object.prototype.hasOwnProperty.call(saved, name)
        const go = exists ? host.confirm('Art styles', `A setup named "${name}" already exists. Replace it?`, 'Replace') : Promise.resolve(true)
        go.then((yes) => { if (yes) run(() => host.save(name, exists), `Saved the setup "${name}".`) })
            .catch((error: unknown) => say(error instanceof Error ? error.message : String(error), true))
    })

    draw()
    return {
        setSettings(next) {
            settings = next
            draw()
        },
    }
}
