/**
 * The art styles (Phase 63b, roadmap row 63): Multihog's Portrait Prompt
 * Library on the *Portraits and location images* section — the seven
 * factory styles, each loading its three prompts into the templates above
 * and its word target, and the user's own setups saved under a name with
 * **Save setup to library**, loaded back, or deleted. The row loaded last
 * is marked; an edit to any of the three prompts unmarks it (the backend's
 * rule, with the legacy's). Mounted on the cartridge's
 * `savedPortraitPromptPresets` row; the backend's three preset ops do the
 * writing and answer with the settings whole, which re-seeds every editor.
 */

import type { SettingsBag } from '../settings/schema.js'
import { FACTORY_PORTRAIT_PRESETS, savedPresetId, type SavedPortraitPreset } from '../tracker/portrait-presets.js'

export interface PortraitStylesDeps {
    createElement(tag: string, attrs?: Record<string, string>): HTMLElement
}

export interface PortraitStylesHost {
    /** Load a factory style by id, or a saved setup by `user:Name`. */
    load(id: string): Promise<void>
    /** Save the three prompts, the word target and the NPCs choice under a name. */
    save(name: string, overwrite: boolean): Promise<void>
    remove(name: string): Promise<void>
    confirm(message: string): Promise<boolean>
}

export interface PortraitStyles {
    setSettings(settings: SettingsBag): void
}

export const PORTRAIT_STYLES_CSS = `
.lh-styles { display: flex; flex-direction: column; gap: 4px; font-size: 0.85em; }
.lh-styles-label { opacity: 0.75; margin-top: 4px; }
.lh-style { display: flex; gap: 6px; align-items: center; padding: 3px 6px; border-radius: 4px; background: rgba(255,255,255,0.05); }
.lh-style--active { outline: 1px solid rgba(120,180,255,0.35); background: rgba(120,180,255,0.12); }
.lh-style-name { flex: 1; }
.lh-style-badge { font-size: 0.8em; opacity: 0.8; }
.lh-styles-save { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 4px; }
.lh-styles-save input { flex: 1; min-width: 8em; }
.lh-styles-note { opacity: 0.85; }
.lh-styles-note--error { color: #e57373; }
`

export function mountPortraitStyles(mount: HTMLElement, deps: PortraitStylesDeps, initial: SettingsBag, host: PortraitStylesHost): PortraitStyles {
    const el = deps.createElement
    const root = el('div', { class: 'lh-styles', 'data-lh-field': 'portrait-styles' })
    const lead = el('div', { class: 'lh-section-help' })
    lead.textContent = 'A style loads its three prompts above and the word target; your own edits can be kept as a setup. The style loaded last is marked, until a prompt is edited.'
    const factoryLabel = el('div', { class: 'lh-styles-label' })
    factoryLabel.textContent = 'Factory art styles'
    const factoryList = el('div', { 'data-lh-field': 'portrait-styles-factory' })
    const savedLabel = el('div', { class: 'lh-styles-label', 'data-lh-field': 'portrait-styles-saved-label' })
    const savedList = el('div', { 'data-lh-field': 'portrait-styles-saved' })
    const saveRow = el('div', { class: 'lh-styles-save' })
    const nameInput = el('input', { type: 'text', class: 'lh-input', placeholder: 'A name for this setup', 'data-lh-field': 'style-name', 'aria-label': 'A name for the setup to save' }) as HTMLInputElement
    const saveButton = el('button', { type: 'button', class: 'lh-button' }) as HTMLButtonElement
    saveButton.textContent = 'Save setup to library'
    saveButton.title = 'Keeps the three prompts, the word target and the NPCs-in-the-picture choice under this name, in the cartridge.'
    saveRow.append(nameInput, saveButton)
    const note = el('div', { class: 'lh-styles-note', 'data-lh-field': 'portrait-styles-note' })
    root.append(lead, factoryLabel, factoryList, savedLabel, savedList, saveRow, note)
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

    function row(name: string, title: string, active: boolean, onLoad: () => void, onDelete?: () => void): HTMLElement {
        const line = el('div', { class: `lh-style${active ? ' lh-style--active' : ''}` })
        const label = el('span', { class: 'lh-style-name' })
        label.textContent = name
        label.title = title
        line.append(label)
        if (active) {
            const badge = el('span', { class: 'lh-style-badge' })
            badge.textContent = 'loaded'
            line.append(badge)
        }
        const load = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'aria-label': `Load ${name}` }) as HTMLButtonElement
        load.textContent = 'Load'
        load.title = title
        load.disabled = busy
        load.addEventListener('click', onLoad)
        line.append(load)
        if (onDelete) {
            const del = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'aria-label': `Delete the setup ${name}` }) as HTMLButtonElement
            del.textContent = '✖'
            del.title = 'Delete this setup'
            del.disabled = busy
            del.addEventListener('click', onDelete)
            line.append(del)
        }
        return line
    }

    function draw(): void {
        const active = typeof settings.activePortraitPromptPresetId === 'string' ? settings.activePortraitPromptPresetId : ''
        factoryList.replaceChildren(...FACTORY_PORTRAIT_PRESETS.map((preset) => row(
            preset.name,
            preset.description,
            active === preset.id,
            () => run(() => host.load(preset.id), `Loaded the ${preset.name} style: its three prompts and word target are above.`),
        )))
        const saved = (settings.savedPortraitPromptPresets && typeof settings.savedPortraitPromptPresets === 'object' ? settings.savedPortraitPromptPresets : {}) as Record<string, SavedPortraitPreset>
        const names = Object.keys(saved)
        savedLabel.textContent = names.length ? 'Your saved setups' : 'Your saved setups (none yet)'
        savedList.replaceChildren(...names.map((name) => row(
            name,
            'Your own three prompts, word target and NPCs choice, as saved.',
            active === savedPresetId(name),
            () => run(() => host.load(savedPresetId(name)), `Loaded the setup ${name}.`),
            () => {
                host.confirm(`Delete the portrait prompt setup "${name}"? This cannot be undone.`)
                    .then((yes) => { if (yes) run(() => host.remove(name), `Deleted the setup ${name}.`) })
                    .catch((error: unknown) => say(error instanceof Error ? error.message : String(error), true))
            },
        )))
        saveButton.disabled = busy
    }

    saveButton.addEventListener('click', () => {
        const name = nameInput.value.trim()
        if (!name) { say('Give the setup a name first.', true); return }
        const saved = (settings.savedPortraitPromptPresets && typeof settings.savedPortraitPromptPresets === 'object' ? settings.savedPortraitPromptPresets : {}) as Record<string, unknown>
        const exists = Object.prototype.hasOwnProperty.call(saved, name)
        const go = exists ? host.confirm(`A setup named "${name}" already exists. Replace it?`) : Promise.resolve(true)
        go.then((yes) => { if (yes) run(() => host.save(name, exists), `Saved "${name}" to the library.`) })
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
