/**
 * The generic settings binder.
 *
 * This is the piece that replaces the legacy build's binding layer: 171
 * hand-written bindings across ~1,700 lines, each one repeating "read the
 * control, coerce, assign, save", plus a family of `sync*Ui()` helpers that
 * walked the DOM by hand to hide and show dependent controls.
 *
 * Here there is one renderer and one listener per row, and dependent
 * visibility is a predicate on the row (`visibleWhen`) rather than a helper
 * somebody has to remember to call. That removes a whole bug class — controls
 * left visible in a state that no longer applies — instead of merely removing
 * lines.
 *
 * Two deliberate differences from the spike prototype:
 *
 *   1. Controls are built as DOM nodes, not HTML strings. Half the settings in
 *      this extension are multi-kilobyte prompt templates full of angle
 *      brackets and braces; round-tripping those through innerHTML means
 *      escaping every one correctly, forever. Building nodes means never
 *      having to.
 *   2. A `derived` row can front several settings keys at once (the RNG mode
 *      control is one). The spike assumed one control, one key.
 */

import { coerce, type FieldDef, type SectionDef, type SettingsBag } from '../settings/schema.js'

export interface BinderDeps {
    /** Host-scoped element factory (`ctx.dom.createElement`). */
    createElement: <K extends keyof HTMLElementTagNameMap>(
        tag: K,
        attrs?: Record<string, string>,
    ) => HTMLElementTagNameMap[K]
    /** Persist a patch. Rejections go to `onSaveFailed`, not `onError`. */
    commit: (patch: SettingsBag) => Promise<void>
    /** Surface a failed save to the user. */
    /**
     * A control's value was rejected before it was sent — bad input, out of
     * range. Instant feedback on something the user is still typing, so the
     * ambient status line is the right home for it.
     */
    onError?: (message: string) => void
    /**
     * A patch reached the backend and was refused.
     *
     * Kept apart from `onError` because the two need opposite lifetimes. A
     * validation message is about a keystroke and is stale a second later; this
     * one means a change the user believes they made **is not there**, and the
     * value on screen is a lie until they retry — the binder writes the patch
     * into its own copy before sending it, so the control keeps showing what
     * was refused.
     */
    onSaveFailed?: (patch: SettingsBag, message: string) => void
    /**
     * Restore one section to its factory values. Optional: when it is absent
     * no reset control is rendered, which is what a read-only panel wants.
     */
    resetSection?: (sectionId: string) => void
    /**
     * Dedicated editors for structured keys, by settings key.
     *
     * The seventeen structured cartridge keys — module tables, game systems,
     * saved presets — cannot be a text box. A key with an entry here renders
     * its own editor in place of the "not built yet" note; the rest keep the
     * note, which stays honest about what exists.
     */
    editors?: Record<string, (mount: HTMLElement, value: unknown, settings: SettingsBag) => void>
    /**
     * Dedicated editors for whole sections, by the schema's `editor` name (70):
     * the narrator's configuration is Multihog's block, not rows. A section
     * naming an editor the panel does not supply is drawn row by row.
     */
    sectionEditors?: Record<string, (mount: HTMLElement, settings: SettingsBag) => void>
    /** Where a section's fold goes (63): its category's body. Absent, every section goes into `root`. */
    sectionHost?: (section: SectionDef) => HTMLElement
    /** What goes at the foot of a section's fold, after its rows (63b): Purge all portraits under the portraits' (83). */
    sectionFooter?: (section: SectionDef) => HTMLElement | null | undefined
    /** What goes at the head of a section's fold, before its rows (83): the portraits' switches in Multihog's order. */
    sectionHeader?: (section: SectionDef) => HTMLElement | null | undefined
}

export interface BoundSettings {
    /** Re-evaluate every `visibleWhen` predicate. */
    refresh: () => void
    /** Adopt authoritative settings from the backend. */
    setSettings: (next: SettingsBag) => void
    /** Remove listeners and empty the container. */
    destroy: () => void
}

/** Free-text fields save on a trailing edge; discrete controls save at once. */
const TEXT_DEBOUNCE_MS = 400

interface Row {
    field: FieldDef
    container: HTMLElement
    control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null
}

export function bindSettings(
    schema: SectionDef[],
    initial: SettingsBag,
    root: HTMLElement,
    deps: BinderDeps,
): BoundSettings {
    let settings: SettingsBag = { ...initial }
    const rows: Row[] = []
    const timers = new Map<string, ReturnType<typeof setTimeout>>()

    const el = deps.createElement

    function save(patch: SettingsBag): void {
        Object.assign(settings, patch)
        refresh()
        deps.commit(patch).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error)
            if (deps.onSaveFailed) deps.onSaveFailed(patch, message)
            else deps.onError?.(`Could not save: ${message}`)
        })
    }

    function saveDebounced(key: string, patch: SettingsBag): void {
        Object.assign(settings, patch)
        const existing = timers.get(key)
        if (existing) clearTimeout(existing)
        timers.set(key, setTimeout(() => {
            timers.delete(key)
            save(patch)
        }, TEXT_DEBOUNCE_MS))
    }

    /** A label + optional help text, shared by every row shape. */
    function labelBlock(field: FieldDef): HTMLElement {
        const block = el('div', { class: 'lh-label' })
        const label = el('span', { class: 'lh-label-text' })
        label.textContent = field.label
        block.append(label)
        if (field.help) {
            const help = el('small', { class: 'lh-help' })
            help.textContent = field.help
            block.append(help)
        }
        return block
    }

    function renderRow(field: FieldDef): Row {
        const container = el('div', { class: `lh-row lh-row-${field.type}` })

        if (field.type === 'managed') {
            // A structured key with a real editor renders that instead of the
            // placeholder. The rest still say honestly that they have none.
            const editor = deps.editors?.[field.key]
            if (editor) {
                container.classList.add('lh-row-stacked', 'lh-row-editor')
                container.append(labelBlock(field))
                const mount = el('div')
                container.append(mount)
                // The whole bag, not just this key: a structured editor
                // frequently needs a second one to make sense of the first.
                // Game systems are a join record and say nothing on their own.
                editor(mount, settings[field.key], settings)
                return { field, container, control: null }
            }

            container.append(labelBlock(field))
            const note = el('span', { class: 'lh-managed' })
            // A managed key with a validator and no editor of its own is written by another editor (the
            // section presets by the sections editor, 77; the art style's id by the styles editor, 63b).
            note.textContent = field.validate ? 'Carried in cartridges; written by the editor that owns it' : 'Carried in cartridges; dedicated editor not built yet'
            container.append(note)
            return { field, container, control: null }
        }

        if (field.type === 'boolean') {
            const input = el('input', { type: 'checkbox' })
            input.checked = !!settings[field.key]
            input.addEventListener('change', () => save({ [field.key]: input.checked }))
            const label = el('label', { class: 'lh-check' })
            label.append(input, labelBlock(field))
            container.append(label)
            return { field, container, control: input }
        }

        if (field.type === 'select' || field.type === 'derived') {
            const select = el('select')
            for (const option of field.options ?? []) {
                const node = el('option', { value: option.value })
                node.textContent = option.label
                select.append(node)
            }
            select.value = field.type === 'derived'
                ? (field.read?.(settings) ?? '')
                : String(settings[field.key] ?? '')
            select.addEventListener('change', () => {
                const patch = field.type === 'derived'
                    ? (field.write?.(select.value) ?? {})
                    : { [field.key]: coerce(field, select.value) }
                save(patch)
            })
            container.append(labelBlock(field), select)
            return { field, container, control: select }
        }

        if (field.type === 'textarea') {
            const textarea = el('textarea', { rows: '8', spellcheck: 'false' })
            textarea.value = String(settings[field.key] ?? '')
            textarea.addEventListener('input', () => {
                saveDebounced(field.key, { [field.key]: coerce(field, textarea.value) })
            })
            container.classList.add('lh-row-stacked')
            container.append(labelBlock(field), textarea)
            return { field, container, control: textarea }
        }

        const input = el('input', { type: field.type === 'number' ? 'number' : 'text' })
        if (field.min !== undefined) input.min = String(field.min)
        if (field.max !== undefined) input.max = String(field.max)
        if (field.step !== undefined) input.step = String(field.step)
        input.value = String(settings[field.key] ?? '')
        const event = field.type === 'number' ? 'change' : 'input'
        input.addEventListener(event, () => {
            const patch = { [field.key]: coerce(field, input.value) }
            if (event === 'input') saveDebounced(field.key, patch)
            else save(patch)
        })
        container.append(labelBlock(field), input)
        return { field, container, control: input }
    }

    for (const section of schema) {
        // A card (63d): an icon, the title centred, the reset, a chevron.
        const details = el('details', { class: 'lh-section lh-card' })
        const summary = el('summary')
        const icon = el('span', { class: 'lh-card-icon', 'aria-hidden': 'true' })
        icon.textContent = section.icon
        const heading = el('span', { class: 'lh-section-title lh-card-title' })
        heading.textContent = section.title
        summary.append(icon, heading)

        // A split-off section (70) has no reset of its own: its group's card resets it.
        if (deps.resetSection && !section.group) {
            const reset = el('button', { type: 'button', class: 'lh-reset' })
            reset.textContent = 'Reset to factory'
            // Inside <summary>, a click would otherwise toggle the section
            // open or shut as a side effect of pressing the button.
            reset.addEventListener('click', (event) => {
                event.preventDefault()
                event.stopPropagation()
                deps.resetSection?.(section.id)
            })
            summary.append(reset)
        }

        summary.append(el('span', { class: 'lh-chevron', 'aria-hidden': 'true' }))
        details.append(summary)

        if (section.description) {
            const description = el('p', { class: 'lh-section-help' })
            description.textContent = section.description
            details.append(description)
        }

        const header = deps.sectionHeader?.(section)
        if (header) details.append(header)

        const sectionEditor = section.editor ? deps.sectionEditors?.[section.editor] : undefined
        if (sectionEditor) {
            // The whole section as one editor (70): its fields stay the
            // store's allowlist; the editor re-seeds through the panel.
            const mount = el('div', { class: 'lh-section-editor' })
            details.append(mount)
            sectionEditor(mount, settings)
        } else {
            // The folded sub-cards (83): one per title, at the first of its rows' place.
            const folds = new Map<string, HTMLElement>()
            for (const field of section.fields) {
                // A key another editor draws (82): the store's allowlist keeps it; the section does not.
                if (field.hidden) continue
                const row = renderRow(field)
                rows.push(row)
                if (!field.fold) { details.append(row.container); continue }
                let body = folds.get(field.fold)
                if (!body) {
                    const card = el('details', { class: 'lh-card lh-second-card lh-field-fold', 'data-lh-fold': field.fold })
                    const foldSummary = el('summary')
                    const foldIcon = el('span', { class: 'lh-card-icon', 'aria-hidden': 'true' })
                    foldIcon.textContent = '📝'
                    const foldTitle = el('span', { class: 'lh-card-title' })
                    foldTitle.textContent = field.fold
                    foldSummary.append(foldIcon, foldTitle, el('span', { class: 'lh-chevron', 'aria-hidden': 'true' }))
                    body = el('div', { class: 'lh-second-body' })
                    card.append(foldSummary, body)
                    details.append(card)
                    folds.set(field.fold, body)
                }
                body.append(row.container)
            }
        }

        const footer = deps.sectionFooter?.(section)
        if (footer) details.append(footer)
        ;(deps.sectionHost?.(section) ?? root).append(details)
    }

    function refresh(): void {
        for (const row of rows) {
            if (row.field.visibleWhen) row.container.hidden = !row.field.visibleWhen(settings)
        }
    }

    /**
     * Adopt the backend's copy of settings.
     *
     * The control the user is currently typing in is left alone — writing to
     * its value would jump the caret to the end mid-sentence.
     */
    function setSettings(next: SettingsBag): void {
        settings = { ...next }
        for (const row of rows) {
            const { field, control } = row
            if (!control || control === document.activeElement) continue

            if (field.type === 'boolean') {
                (control as HTMLInputElement).checked = !!settings[field.key]
            } else if (field.type === 'derived') {
                control.value = field.read?.(settings) ?? ''
            } else {
                control.value = String(settings[field.key] ?? '')
            }
        }
        refresh()
    }

    function destroy(): void {
        for (const timer of timers.values()) clearTimeout(timer)
        timers.clear()
        rows.length = 0
        root.replaceChildren()
    }

    refresh()
    return { refresh, setSettings, destroy }
}
