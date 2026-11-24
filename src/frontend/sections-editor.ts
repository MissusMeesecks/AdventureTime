/**
 * The NPC and PC sections editor (Phase 77, roadmap row 77): Multihog's
 * **Edit NPC Sections** and **Edit PC Sections** popup (`ui-editors.js`,
 * `openSectionEditor` at the pin) as an editor on the Character Sheets card
 * (63's rule: on the panel, not a modal), one mount per kind.
 *
 * The `[CORE]` identity sections every NPC is recorded under, or the Player
 * Card's sections: each a name, an icon, a colour and the instruction that
 * tells the agent or the creator what the section holds, in an order, with
 * named presets saved, loaded and deleted. The legacy's rows are dragged;
 * these have arrows, as the section order editor's do. The legacy's *Save &
 * Rebuild* is **Save the sections**: the backend rebuilds the agent's NPC,
 * LOC and FAC instructions where they still read as stock, and the note
 * says which. The legacy stashes the preset loaded last under a side key
 * the cartridge applier strips (CLAUDE.md rule 4); here the select marks
 * the preset whose sections the list equals (departure 135).
 */
import type { SettingsBag } from '../settings/schema.js'
import { DEFAULT_NPC_SECTIONS, DEFAULT_PC_SECTIONS, type CoreSection } from '../tracker/creator.js'

export type SectionsKind = 'npc' | 'pc'

export interface SectionsEditorDeps {
    createElement(tag: string, attrs?: Record<string, string>): HTMLElement
}

export interface SectionsEditorHost {
    /** `settings.sections`: the list saved under its key; the answer names the agent's instructions rebuilt and kept. */
    save(kind: SectionsKind, sections: CoreSection[]): Promise<{ rebuilt: string[]; kept: string[] }>
    /** A `settings.patch` of the kind's presets key. */
    savePresets(kind: SectionsKind, presets: Record<string, CoreSection[]>): Promise<void>
    /** The dialog titled with its action, its button the verb (96, audit finding 25). */
    confirm(title: string, message: string, confirmLabel: string): Promise<boolean>
}

export interface SectionsEditor {
    /** The cartridge as it stands; a draft survives a commit from elsewhere and yields to a load or a reset. */
    setSettings(settings: SettingsBag, from: 'commit' | 'reset' | 'load'): void
}

export const SECTIONS_KEYS: Record<SectionsKind, { sections: string; presets: string; defaults: ReadonlyArray<CoreSection>; title: string }> = {
    npc: {
        sections: 'npcCoreSections',
        presets: 'npcSectionPresets',
        defaults: DEFAULT_NPC_SECTIONS,
        title: '🧩 NPC sections',
    },
    pc: {
        sections: 'pcCoreSections',
        presets: 'pcSectionPresets',
        defaults: DEFAULT_PC_SECTIONS,
        title: '👤 PC sections',
    },
}

export const SECTIONS_EDITOR_CSS = `
.lh-sections { display: flex; flex-direction: column; gap: 6px; font-size: 0.8em; }
.lh-sections-presets { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.08); }
.lh-sections-presets select { flex: 1 1 8em; min-width: 8em; }
.lh-sections-presets input { flex: 1 1 8em; min-width: 7em; }
.lh-sec-row { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px; border-radius: 6px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05); }
.lh-sec-head { display: flex; gap: 6px; align-items: center; }
.lh-sec-arrows { display: flex; flex-direction: column; gap: 1px; }
.lh-sec-arrows .lh-button { padding: 0 5px; line-height: 1.1; font-size: 0.8em; }
.lh-sec-icon { width: 2.6em; text-align: center; }
.lh-sec-color { width: 28px; height: 28px; padding: 0; border: none; border-radius: 4px; cursor: pointer; background: none; }
.lh-sec-name { flex: 1; font-weight: 600; min-width: 6em; }
.lh-sec-desc { width: 100%; box-sizing: border-box; font-size: 0.92em; }
.lh-sec-hidden { font-size: 0.72em; opacity: 0.6; }
.lh-sec-remove { color: #e57373; }
.lh-sections-add { border: 1px dashed rgba(255,255,255,0.25) !important; background: transparent !important; }
.lh-sections-foot { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.lh-sections-dirty { font-size: 0.8em; opacity: 0.8; font-style: italic; }
.lh-sections-note { opacity: 0.85; }
.lh-sections-note--error { color: #e57373; }
`

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

/** The cartridge's list, or the stock when it is empty or unreadable — the legacy's resolution. */
export function readSections(value: unknown, defaults: ReadonlyArray<CoreSection>): CoreSection[] {
    if (Array.isArray(value) && value.length > 0) {
        const out = value
            .filter((raw): raw is Record<string, unknown> => !!raw && typeof raw === 'object' && !Array.isArray(raw))
            .map((raw) => {
                const section: CoreSection = {
                    id: typeof raw.id === 'string' ? raw.id : '',
                    name: typeof raw.name === 'string' ? raw.name : '',
                    description: typeof raw.description === 'string' ? raw.description : '',
                    icon: typeof raw.icon === 'string' ? raw.icon : '',
                    color: typeof raw.color === 'string' && raw.color ? raw.color : '#aaaaaa',
                }
                if (raw.hiddenUntilSet === true) section.hiddenUntilSet = true
                return section
            })
        if (out.length) return out
    }
    return clone(defaults as CoreSection[])
}

/** The cartridge's presets by name; the legacy's older `{ sections }` shape read too. */
export function readSectionPresets(value: unknown, defaults: ReadonlyArray<CoreSection>): Record<string, CoreSection[]> {
    const out: Record<string, CoreSection[]> = {}
    if (!value || typeof value !== 'object' || Array.isArray(value)) return out
    for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
        const list = raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray((raw as { sections?: unknown }).sections) ? (raw as { sections: unknown }).sections : raw
        if (Array.isArray(list)) out[name] = readSections(list, defaults)
    }
    return out
}

/** The legacy's id for a section saved without one: the name slugged. */
function slug(name: string): string {
    return name.trim().toLowerCase().replace(/[^a-z0-9]/g, '_')
}

export function mountSectionsEditor(mount: HTMLElement, deps: SectionsEditorDeps, initial: SettingsBag, kind: SectionsKind, host: SectionsEditorHost): SectionsEditor {
    const el = deps.createElement
    const keys = SECTIONS_KEYS[kind]
    let stored = readSections(initial[keys.sections], keys.defaults)
    let working = clone(stored)
    let presets = readSectionPresets(initial[keys.presets], keys.defaults)

    const root = el('div', { class: 'lh-sections', 'data-lh-field': `sections-editor-${kind}` })
    // No lead here (96): the editor's help, its buttons' lines with it, is the `[?]` on the row's heading, from the schema.

    // The preset bar: the legacy's select, Save, Save As…, Reset and Delete.
    const bar = el('div', { class: 'lh-sections-presets' })
    const presetLabel = el('strong')
    presetLabel.textContent = 'Preset'
    const select = el('select', { class: 'lh-input', 'data-lh-field': 'sections-preset', 'aria-label': 'Saved preset' }) as HTMLSelectElement
    const overwrite = el('button', { type: 'button', class: 'lh-button', 'aria-label': 'Overwrite preset' }) as HTMLButtonElement
    overwrite.textContent = 'Overwrite preset'
    const nameInput = el('input', { type: 'text', class: 'lh-input', placeholder: 'Preset name', 'data-lh-field': 'sections-preset-name', 'aria-label': 'Preset name' }) as HTMLInputElement
    const saveAs = el('button', { type: 'button', class: 'lh-button', 'aria-label': 'Save as new preset' }) as HTMLButtonElement
    saveAs.textContent = 'Save as new preset'
    const reset = el('button', { type: 'button', class: 'lh-button', 'aria-label': 'Reset to stock sections' }) as HTMLButtonElement
    reset.textContent = 'Reset to stock'
    const remove = el('button', { type: 'button', class: 'lh-button lh-sec-remove', 'aria-label': 'Delete preset' }) as HTMLButtonElement
    remove.textContent = 'Delete preset'
    bar.append(presetLabel, select, overwrite, nameInput, saveAs, reset, remove)

    const list = el('div', { 'data-lh-field': 'sections-list' })
    const add = el('button', { type: 'button', class: 'lh-button lh-sections-add', 'aria-label': 'Add custom section' }) as HTMLButtonElement
    add.textContent = 'Add custom section'
    const foot = el('div', { class: 'lh-sections-foot' })
    const save = el('button', { type: 'button', class: 'lh-button', 'aria-label': 'Save sections' }) as HTMLButtonElement
    save.textContent = 'Save sections'
    const revert = el('button', { type: 'button', class: 'lh-button', 'aria-label': 'Revert changes' }) as HTMLButtonElement
    revert.textContent = 'Revert changes'
    const dirtyBadge = el('span', { class: 'lh-sections-dirty', 'data-lh-field': 'sections-dirty' })
    foot.append(save, revert, dirtyBadge)
    const note = el('div', { class: 'lh-sections-note', 'data-lh-field': 'sections-note' })
    root.append(bar, list, add, foot, note)
    mount.replaceChildren(root)

    const same = (a: CoreSection[], b: CoreSection[]) => JSON.stringify(a) === JSON.stringify(b)
    const isDirty = () => !same(working, stored)
    const matchingPreset = () => Object.keys(presets).find((name) => same(presets[name]!, working)) ?? ''
    // The preset loaded last is remembered by name (96, the try of 2e): told by equality alone, the first
    // edit took the name off the select, so Overwrite went grey and picking the preset again reloaded it.
    const memoryKey = `adventuretime.sectionsPreset.${kind}`
    const recall = (): string => { try { return globalThis.localStorage?.getItem(memoryKey) ?? '' } catch { return '' } }
    const remember = (name: string): void => { try { if (name) globalThis.localStorage?.setItem(memoryKey, name); else globalThis.localStorage?.removeItem(memoryKey) } catch { /* a browser without storage forgets on reload */ } }
    const initialLoaded = (): string => { const kept = recall(); return kept && presets[kept] ? kept : matchingPreset() }
    let loaded = initialLoaded()
    /** The preset the stored list came from, which Revert changes goes back to. */
    let storedLoaded = loaded
    const setLoaded = (name: string): void => { loaded = name; remember(name) }

    function say(text: string, error = false): void {
        note.textContent = text
        note.classList.toggle('lh-sections-note--error', error)
    }

    /** The bar and the foot follow the draft; the list is redrawn only when its rows change (lesson 30: a redraw loses the cursor). */
    function drawState(): void {
        if (loaded && !presets[loaded]) setLoaded('')
        const active = loaded
        const edited = !!active && !same(presets[active]!, working)
        select.replaceChildren()
        const placeholder = el('option', { value: '' }) as HTMLOptionElement
        placeholder.textContent = 'Choose a preset'
        placeholder.disabled = true
        placeholder.selected = !active
        select.append(placeholder)
        for (const name of Object.keys(presets)) {
            const option = el('option', { value: name }) as HTMLOptionElement
            option.textContent = name === active && edited ? `${name} (edited)` : name
            option.selected = name === active
            select.append(option)
        }
        // Set on the select once every option is in it: an option marked before it is appended is not always honoured.
        select.value = active
        overwrite.disabled = !active
        remove.disabled = !active
        const dirty = isDirty()
        save.disabled = !dirty
        revert.disabled = !dirty
        dirtyBadge.textContent = dirty ? 'Unsaved changes' : ''
    }

    function drawList(): void {
        list.replaceChildren()
        working.forEach((section, index) => {
            const row = el('div', { class: 'lh-sec-row', 'data-lh-section': String(index) })
            const head = el('div', { class: 'lh-sec-head' })
            const arrows = el('div', { class: 'lh-sec-arrows' })
            const up = el('button', { type: 'button', class: 'lh-button', 'aria-label': `Move ${section.name || 'the section'} up` }) as HTMLButtonElement
            up.textContent = '▲'
            up.disabled = index === 0
            const down = el('button', { type: 'button', class: 'lh-button', 'aria-label': `Move ${section.name || 'the section'} down` }) as HTMLButtonElement
            down.textContent = '▼'
            down.disabled = index === working.length - 1
            up.addEventListener('click', () => { const [moved] = working.splice(index, 1); working.splice(index - 1, 0, moved!); drawList(); drawState() })
            down.addEventListener('click', () => { const [moved] = working.splice(index, 1); working.splice(index + 1, 0, moved!); drawList(); drawState() })
            arrows.append(up, down)
            const icon = el('input', { type: 'text', class: 'lh-input lh-sec-icon', title: 'Icon (emoji)', 'aria-label': 'Icon' }) as HTMLInputElement
            icon.value = section.icon
            icon.addEventListener('input', () => { section.icon = icon.value; drawState() })
            const color = el('input', { type: 'color', class: 'lh-sec-color', title: 'Colour', 'aria-label': 'Colour' }) as HTMLInputElement
            color.value = /^#[0-9a-f]{6}$/i.test(section.color) ? section.color : '#aaaaaa'
            color.addEventListener('input', () => { section.color = color.value; drawState() })
            const name = el('input', { type: 'text', class: 'lh-input lh-sec-name', placeholder: 'Section name', 'aria-label': 'Section name' }) as HTMLInputElement
            name.value = section.name
            name.addEventListener('input', () => { section.name = name.value; drawState() })
            const del = el('button', { type: 'button', class: 'lh-button lh-sec-remove', title: 'Remove section', 'aria-label': `Remove ${section.name || 'the section'}` }) as HTMLButtonElement
            del.textContent = '✕'
            del.addEventListener('click', () => {
                host.confirm('Remove section', 'Remove this section? It is gone from the cartridge once you save.', 'Remove').then((yes) => {
                    if (!yes) return
                    working.splice(index, 1)
                    drawList()
                    drawState()
                }).catch(() => undefined)
            })
            head.append(arrows, icon, color, name)
            if (section.hiddenUntilSet) {
                const hidden = el('span', { class: 'lh-sec-hidden' })
                hidden.textContent = 'Hidden until set'
                head.append(hidden)
            }
            head.append(del)
            const desc = el('input', { type: 'text', class: 'lh-input lh-sec-desc', placeholder: 'What this section holds', 'aria-label': 'Section instruction' }) as HTMLInputElement
            desc.value = section.description
            desc.addEventListener('input', () => { section.description = desc.value; drawState() })
            row.append(head, desc)
            list.append(row)
        })
    }

    add.addEventListener('click', () => {
        working.push({ id: `custom_${Date.now()}`, name: 'New section', description: 'Describe what this section holds.', icon: '📌', color: '#aaaaaa' })
        drawList()
        drawState()
    })

    revert.addEventListener('click', () => {
        working = clone(stored)
        setLoaded(storedLoaded && presets[storedLoaded] ? storedLoaded : matchingPreset())
        drawList()
        drawState()
        say('')
    })

    reset.addEventListener('click', () => {
        host.confirm('Reset to stock sections', 'Reset the list to the stock sections? Your edits in the list are replaced.', 'Reset').then((yes) => {
            if (!yes) return
            working = clone(keys.defaults as CoreSection[])
            // Stock is no preset's edit: the select goes back to no preset, even when a saved one happens to
            // equal stock (the try of 2f: a preset saved from the stock list kept its name here).
            setLoaded('')
            drawList()
            drawState()
            say('The stock sections are in the list. Press Save sections to apply them.')
        }).catch(() => undefined)
    })

    save.addEventListener('click', () => {
        for (const section of working) {
            if (!section.name.trim()) { say('Every section needs a name.', true); return }
            if (!section.id) section.id = slug(section.name)
        }
        save.disabled = true
        say('Saving…')
        host.save(kind, clone(working)).then((result) => {
            stored = clone(working)
            storedLoaded = loaded
            drawState()
            const count = `${working.length} section${working.length === 1 ? '' : 's'} saved.`
            if (kind !== 'npc') { say(count); return }
            const parts: string[] = []
            if (result.rebuilt.length) parts.push(`The agent’s ${result.rebuilt.join(', ')} ${result.rebuilt.length > 1 ? 'instructions were' : 'instruction was'} rebuilt.`)
            if (result.kept.length) parts.push(`The ${result.kept.join(', ')} ${result.kept.length > 1 ? 'instructions are edited and were' : 'instruction is edited and was'} kept.`)
            say(parts.length ? `${count} ${parts.join(' ')}` : `${count} The agent’s instructions already match.`)
        }).catch((error: unknown) => {
            drawState()
            say(`The sections could not be saved: ${error instanceof Error ? error.message : String(error)}`, true)
        })
    })

    select.addEventListener('change', () => {
        const chosen = select.value
        const preset = presets[chosen]
        if (!chosen || !preset) return
        const load = () => {
            working = clone(preset)
            setLoaded(chosen)
            drawList()
            drawState()
            say(`Preset “${chosen}” is in the list. Press Save sections to apply it.`)
        }
        if (!isDirty()) { load(); return }
        host.confirm('Load preset', `Load the preset “${chosen}”? Unsaved changes in the list are lost.`, 'Load').then((yes) => {
            if (yes) load()
            else drawState()
        }).catch(() => undefined)
    })

    function writePresets(next: Record<string, CoreSection[]>, done: string, nowLoaded: string): void {
        host.savePresets(kind, next).then(() => {
            presets = next
            setLoaded(nowLoaded)
            drawState()
            say(done)
        }).catch((error: unknown) => {
            say(`The presets could not be saved: ${error instanceof Error ? error.message : String(error)}`, true)
        })
    }

    overwrite.addEventListener('click', () => {
        const active = loaded
        if (!active || !presets[active]) return
        for (const section of working) {
            if (!section.name.trim()) { say('Every section needs a name.', true); return }
            if (!section.id) section.id = slug(section.name)
        }
        writePresets({ ...presets, [active]: clone(working) }, `Preset saved: ${active}.`, active)
    })

    saveAs.addEventListener('click', () => {
        const name = nameInput.value.trim()
        if (!name) { say('Type a name for the preset.', true); return }
        for (const section of working) {
            if (!section.name.trim()) { say('Every section needs a name.', true); return }
            if (!section.id) section.id = slug(section.name)
        }
        const write = () => { writePresets({ ...presets, [name]: clone(working) }, `Preset saved: ${name}.`, name); nameInput.value = '' }
        if (!presets[name]) { write(); return }
        host.confirm('Replace preset', `A preset named “${name}” exists. Replace it?`, 'Replace').then((yes) => { if (yes) write() }).catch(() => undefined)
    })

    remove.addEventListener('click', () => {
        const active = loaded
        if (!active || !presets[active]) return
        host.confirm('Delete preset', `Delete the preset “${active}”?`, 'Delete').then((yes) => {
            if (!yes) return
            const next = { ...presets }
            delete next[active]
            writePresets(next, `Preset deleted: ${active}.`, '')
        }).catch(() => undefined)
    })

    drawList()
    drawState()

    return {
        setSettings(settings, from) {
            const next = readSections(settings[keys.sections], keys.defaults)
            presets = readSectionPresets(settings[keys.presets], keys.defaults)
            const draft = isDirty()
            stored = next
            // A load or a reset is the user's own act and replaces the draft; a commit from elsewhere leaves a draft standing.
            if (from !== 'commit' || !draft) {
                working = clone(stored)
                if (from !== 'commit') setLoaded(from === 'reset' ? '' : matchingPreset())
                storedLoaded = loaded
                drawList()
            }
            drawState()
        },
    }
}
