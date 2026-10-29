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
    confirm(message: string): Promise<boolean>
}

export interface SectionsEditor {
    /** The cartridge as it stands; a draft survives a commit from elsewhere and yields to a load or a reset. */
    setSettings(settings: SettingsBag, from: 'commit' | 'reset' | 'load'): void
}

export const SECTIONS_KEYS: Record<SectionsKind, { sections: string; presets: string; defaults: ReadonlyArray<CoreSection>; title: string; lead: string }> = {
    npc: {
        sections: 'npcCoreSections',
        presets: 'npcSectionPresets',
        defaults: DEFAULT_NPC_SECTIONS,
        title: '🧩 NPC sections',
        lead: 'The [CORE] identity sections for all NPCs: the names, colours, emojis and the prompt instructions that tell the agent what to track, in this order. Save rebuilds the agent’s NPC, LOC and FAC instructions where they still read as stock; one you have edited is kept.',
    },
    pc: {
        sections: 'pcCoreSections',
        presets: 'pcSectionPresets',
        defaults: DEFAULT_PC_SECTIONS,
        title: '👤 PC sections',
        lead: 'The persona sections for Player Characters, used when a character is generated or a card is imported.',
    },
}

export const SECTIONS_EDITOR_CSS = `
.lh-sections { display: flex; flex-direction: column; gap: 6px; font-size: 0.85em; }
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
.lh-sec-hidden { font-size: 0.75em; opacity: 0.6; font-style: italic; }
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
    const lead = el('div', { class: 'lh-section-help' })
    lead.textContent = keys.lead

    // The preset bar: the legacy's select, Save, Save As…, Reset and Delete.
    const bar = el('div', { class: 'lh-sections-presets' })
    const presetLabel = el('strong')
    presetLabel.textContent = 'Preset'
    const select = el('select', { class: 'lh-input', 'data-lh-field': 'sections-preset', 'aria-label': 'A saved preset' }) as HTMLSelectElement
    const overwrite = el('button', { type: 'button', class: 'lh-button', 'aria-label': 'Save over the preset' }) as HTMLButtonElement
    overwrite.textContent = 'Save'
    const nameInput = el('input', { type: 'text', class: 'lh-input', placeholder: 'A name for this preset', 'data-lh-field': 'sections-preset-name', 'aria-label': 'A name for the preset to save' }) as HTMLInputElement
    const saveAs = el('button', { type: 'button', class: 'lh-button', 'aria-label': 'Save as a preset' }) as HTMLButtonElement
    saveAs.textContent = 'Save as…'
    saveAs.title = 'Keeps the sections as they stand in the list under this name, in the cartridge.'
    const reset = el('button', { type: 'button', class: 'lh-button', 'aria-label': 'Reset the sections to stock' }) as HTMLButtonElement
    reset.textContent = 'Reset'
    reset.title = 'Puts Multihog’s stock sections in the list; Save the sections applies them.'
    const remove = el('button', { type: 'button', class: 'lh-button lh-sec-remove', 'aria-label': 'Delete the preset' }) as HTMLButtonElement
    remove.textContent = 'Delete'
    bar.append(presetLabel, select, overwrite, nameInput, saveAs, reset, remove)

    const list = el('div', { 'data-lh-field': 'sections-list' })
    const add = el('button', { type: 'button', class: 'lh-button lh-sections-add', 'aria-label': 'Add a custom section' }) as HTMLButtonElement
    add.textContent = '+ Add custom section'
    const foot = el('div', { class: 'lh-sections-foot' })
    const save = el('button', { type: 'button', class: 'lh-button', 'aria-label': 'Save the sections' }) as HTMLButtonElement
    save.textContent = 'Save the sections'
    const revert = el('button', { type: 'button', class: 'lh-button', 'aria-label': 'Revert the sections' }) as HTMLButtonElement
    revert.textContent = 'Revert'
    revert.title = 'Puts the list back to what the cartridge holds.'
    const dirtyBadge = el('span', { class: 'lh-sections-dirty', 'data-lh-field': 'sections-dirty' })
    foot.append(save, revert, dirtyBadge)
    const note = el('div', { class: 'lh-sections-note', 'data-lh-field': 'sections-note' })
    root.append(lead, bar, list, add, foot, note)
    mount.replaceChildren(root)

    const same = (a: CoreSection[], b: CoreSection[]) => JSON.stringify(a) === JSON.stringify(b)
    const isDirty = () => !same(working, stored)
    const matchingPreset = () => Object.keys(presets).find((name) => same(presets[name]!, working)) ?? ''

    function say(text: string, error = false): void {
        note.textContent = text
        note.classList.toggle('lh-sections-note--error', error)
    }

    /** The bar and the foot follow the draft; the list is redrawn only when its rows change (lesson 30: a redraw loses the cursor). */
    function drawState(): void {
        const active = matchingPreset()
        select.replaceChildren()
        const placeholder = el('option', { value: '' }) as HTMLOptionElement
        placeholder.textContent = '— a saved preset —'
        placeholder.disabled = true
        placeholder.selected = !active
        select.append(placeholder)
        for (const name of Object.keys(presets)) {
            const option = el('option', { value: name }) as HTMLOptionElement
            option.textContent = name
            option.selected = name === active
            select.append(option)
        }
        overwrite.disabled = !active
        overwrite.title = active ? `Writes the list as it stands over the preset “${active}”.` : 'Pick a preset first, or Save as… to make one.'
        remove.disabled = !active
        const dirty = isDirty()
        save.disabled = !dirty
        revert.disabled = !dirty
        dirtyBadge.textContent = dirty ? 'edited, not saved' : ''
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
            const del = el('button', { type: 'button', class: 'lh-button lh-sec-remove', title: 'Remove', 'aria-label': `Remove ${section.name || 'the section'}` }) as HTMLButtonElement
            del.textContent = '✕'
            del.addEventListener('click', () => {
                host.confirm('Remove this section?').then((yes) => {
                    if (!yes) return
                    working.splice(index, 1)
                    drawList()
                    drawState()
                }).catch(() => undefined)
            })
            head.append(arrows, icon, color, name)
            if (section.hiddenUntilSet) {
                const hidden = el('span', { class: 'lh-sec-hidden', title: 'Written only once a value exists for it; the Combat Profile is this.' })
                hidden.textContent = 'hidden until set'
                head.append(hidden)
            }
            head.append(del)
            const desc = el('input', { type: 'text', class: 'lh-input lh-sec-desc', placeholder: 'Prompt instruction for this section…', 'aria-label': 'Prompt instruction' }) as HTMLInputElement
            desc.value = section.description
            desc.addEventListener('input', () => { section.description = desc.value; drawState() })
            row.append(head, desc)
            list.append(row)
        })
    }

    add.addEventListener('click', () => {
        working.push({ id: `custom_${Date.now()}`, name: 'New Section', description: 'Description of what goes here.', icon: '📌', color: '#aaaaaa' })
        drawList()
        drawState()
    })

    revert.addEventListener('click', () => {
        working = clone(stored)
        drawList()
        drawState()
        say('')
    })

    reset.addEventListener('click', () => {
        host.confirm('Reset the sections in the list to Multihog’s stock? Your edits in the list are replaced; Save the sections applies them, or Save as… keeps them as a preset.').then((yes) => {
            if (!yes) return
            working = clone(keys.defaults as CoreSection[])
            drawList()
            drawState()
            say('The stock sections are in the list; Save the sections applies them.')
        }).catch(() => undefined)
    })

    save.addEventListener('click', () => {
        for (const section of working) {
            if (!section.name.trim()) { say('All sections must have a name.', true); return }
            if (!section.id) section.id = slug(section.name)
        }
        save.disabled = true
        say('Saving…')
        host.save(kind, clone(working)).then((result) => {
            stored = clone(working)
            drawState()
            const count = `${working.length} section${working.length === 1 ? '' : 's'} saved.`
            if (kind !== 'npc') { say(count); return }
            const parts: string[] = []
            if (result.rebuilt.length) parts.push(`the agent’s ${result.rebuilt.join(', ')} instruction${result.rebuilt.length > 1 ? 's' : ''} rebuilt around them`)
            if (result.kept.length) parts.push(`the ${result.kept.join(', ')} instruction${result.kept.length > 1 ? 's are' : ' is'} edited and kept as ${result.kept.length > 1 ? 'they are' : 'it is'}`)
            say(parts.length ? `${count} ${parts.join('; ')}.` : `${count} The agent’s instructions already read them.`)
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
            drawList()
            drawState()
            say(`Loaded the preset “${chosen}”; Save the sections applies it.`)
        }
        if (!isDirty()) { load(); return }
        host.confirm(`Load the preset “${chosen}”? Unsaved changes to the current sections will be lost.`).then((yes) => {
            if (yes) load()
            else drawState()
        }).catch(() => undefined)
    })

    function writePresets(next: Record<string, CoreSection[]>, done: string): void {
        host.savePresets(kind, next).then(() => {
            presets = next
            drawState()
            say(done)
        }).catch((error: unknown) => {
            say(`The presets could not be saved: ${error instanceof Error ? error.message : String(error)}`, true)
        })
    }

    overwrite.addEventListener('click', () => {
        const active = matchingPreset()
        if (!active) { say('Pick a preset first, or Save as… to make one.'); return }
        writePresets({ ...presets, [active]: clone(working) }, `Preset saved: ${active}.`)
    })

    saveAs.addEventListener('click', () => {
        const name = nameInput.value.trim()
        if (!name) { say('Type a name for the preset.', true); return }
        for (const section of working) {
            if (!section.name.trim()) { say('All sections must have a name.', true); return }
            if (!section.id) section.id = slug(section.name)
        }
        const write = () => { writePresets({ ...presets, [name]: clone(working) }, `Saved the preset: ${name}.`); nameInput.value = '' }
        if (!presets[name]) { write(); return }
        host.confirm(`A preset named “${name}” exists. Replace it?`).then((yes) => { if (yes) write() }).catch(() => undefined)
    })

    remove.addEventListener('click', () => {
        const active = matchingPreset()
        if (!active) return
        host.confirm(`Delete the preset “${active}”?`).then((yes) => {
            if (!yes) return
            const next = { ...presets }
            delete next[active]
            writePresets(next, `Deleted the preset: ${active}.`)
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
                drawList()
            }
            drawState()
        },
    }
}
