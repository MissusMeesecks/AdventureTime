/**
 * The custom tracker fields editor.
 *
 * A custom field is a tracker block you define yourself: a tag, a name, an
 * icon, and the paragraph that tells the extractor model how to maintain it.
 * That paragraph *is* the module — it is what makes `[WAYSTONE]` behave the way
 * it does, and it travels in the cartridge.
 *
 * This is the first of the seventeen structured cartridge keys to get a real
 * editor, and it went first for a concrete reason: until a field can be
 * switched **on**, the tracker pass is never told the block exists, so a custom
 * block can be rendered from a hand-written memo and then never update. A
 * cartridge can carry a field switched off — the golden export carries sixteen
 * with only four enabled — and before this there was no way to see that, let
 * alone change it.
 */

import { attachCardHelp, createHelpTip } from './help-tip.js'

export interface CustomField {
    tag: string
    label?: string
    icon?: string
    prompt?: string
    enabled?: boolean
    [key: string]: unknown
}

export interface CustomFieldsHost {
    createElement: <K extends keyof HTMLElementTagNameMap>(
        tag: K,
        attrs?: Record<string, string>,
    ) => HTMLElementTagNameMap[K]
    /** Export, import and clear all (72b, Multihog's three buttons under Modules & Order). Absent, the buttons are not drawn. */
    download?(filename: string, text: string): void
    /** A JSON file picked by the user, as text; `null` when none was picked. */
    pickJson?(): Promise<string | null>
    /**
     * Ask before a field is deleted or all are removed; true to go ahead. The
     * title names the action and the button is its verb (96). Absent, nothing asks.
     */
    confirm?(title: string, message: string, confirmLabel: string): Promise<boolean>
}

/** Ids for the row editor's labels; one counter for every editor on the page. */
let inputSequence = 0

/** The modules file (72b): the custom fields alone, under a name that says what they are. */
export interface CustomFieldsFile {
    adventuretimeCustomFields: CustomField[]
}

/** Read an imported modules file: AdventureTime's own shape, or Multihog's `{ customFields: [...] }` / a bare list. Throws with a reason when neither. */
export function readCustomFieldsFile(text: string): CustomField[] {
    let raw: unknown
    try {
        raw = JSON.parse(text)
    } catch {
        throw new Error('The file is not JSON.')
    }
    const list = Array.isArray(raw) ? raw
        : raw && typeof raw === 'object' && Array.isArray((raw as CustomFieldsFile).adventuretimeCustomFields) ? (raw as CustomFieldsFile).adventuretimeCustomFields
        // The key written before the rename (0.156.0) is still read.
        : raw && typeof raw === 'object' && Array.isArray((raw as { lumihogCustomFields?: unknown }).lumihogCustomFields) ? (raw as { lumihogCustomFields: CustomField[] }).lumihogCustomFields
        : raw && typeof raw === 'object' && Array.isArray((raw as { customFields?: unknown }).customFields) ? (raw as { customFields: unknown[] }).customFields
        : null
    if (!list) throw new Error('The file holds no custom fields.')
    const fields: CustomField[] = []
    for (const item of list) {
        if (!item || typeof item !== 'object') continue
        const f = item as Record<string, unknown>
        const tag = String(f.tag ?? '').trim().toUpperCase()
        if (!tag) continue
        fields.push({ tag, label: String(f.label ?? tag), icon: String(f.icon ?? '📋'), prompt: String(f.prompt ?? ''), enabled: f.enabled !== false })
    }
    if (!fields.length) throw new Error('The file holds no custom fields.')
    return fields
}

/** Imported fields merged over the current ones: a tag already there is replaced, the rest appended. */
export function mergeCustomFields(current: readonly CustomField[], imported: readonly CustomField[]): CustomField[] {
    const out = current.map((f) => ({ ...f }))
    for (const field of imported) {
        const at = out.findIndex((f) => f.tag === field.tag)
        if (at >= 0) out[at] = { ...field }
        else out.push({ ...field })
    }
    return out
}

export interface CustomFieldsEditor {
    setFields(fields: CustomField[]): void
    destroy(): void
}

/**
 * A tag the memo grammar handles without surprises.
 *
 * Upper-case letters, digits and underscores. Deliberately narrower than what
 * `parseMemoBlocks` accepts: a tag containing a space parses fine but is
 * skipped by the duplicate-block scan, which is a quirk the legacy build has
 * and there is no reason to let a new field walk into it.
 */
const TAG_PATTERN = /^[A-Z][A-Z0-9_]*$/

/**
 * Tags the stock modules already own.
 *
 * `buildModulesInstructionText` emits one `- [TAG]: …` line per enabled module,
 * uppercasing the cartridge's own `modules` keys, and then the custom fields are
 * appended under their own heading. So a custom field tagged `INVENTORY` puts
 * **two contradictory instructions for one block** in the same prompt, and the
 * merge then applies whatever came back to the single `[INVENTORY]` block. The
 * user's own stock module loses, silently.
 *
 * Kept as a constant here rather than read from the settings so the editor does
 * not have to be handed the whole cartridge — and locked to the generated
 * factory by a test, so it cannot drift from the modules that actually exist.
 *
 * `benched party` is in the factory and deliberately absent here: it contains a
 * space, so `TAG_PATTERN` refuses it before this list is ever consulted.
 */
export const STOCK_MODULE_TAGS = [
    'ABILITIES',
    'CHARACTER',
    'COMBAT',
    'INVENTORY',
    'PARTY',
    'QUESTS',
    'SPELLS',
    'TIME',
    'XP',
]

export function validateTag(tag: string, others: string[]): string | null {
    const value = tag.trim().toUpperCase()
    if (!value) return 'A tag is required.'
    if (!TAG_PATTERN.test(value)) {
        return 'Use capital letters, digits and underscores, starting with a letter. Example: MORALE_INDEX.'
    }
    if (STOCK_MODULE_TAGS.includes(value)) {
        return `${value} is a built-in module. Pick a different tag, or turn that module off.`
    }
    if (others.includes(value)) return `A field tagged ${value} already exists.`
    return null
}

/**
 * Whether this field will actually be maintained.
 *
 * The instruction **is** the module. A field with none is dropped from the
 * extractor prompt outright (`prompt.ts`: `if (instruction)`), which is the
 * right thing to send — an empty `- [TAG]:` line is worse than no line — but it
 * means a field can be switched on, counted as on, and never update.
 *
 * That is CLAUDE.md's lesson 2 wearing different clothes. The editor was built
 * so a switched-*off* field could not fail invisibly; this is the same failure
 * with the switch in the other position, and it is what pressing **Add a
 * field** produces every single time.
 */
export function isMaintained(field: CustomField): boolean {
    return Boolean(field.enabled) && String(field.prompt ?? '').trim().length > 0
}

export function mountCustomFieldsEditor(
    root: HTMLElement,
    host: CustomFieldsHost,
    initial: CustomField[],
    onChange: (fields: CustomField[]) => void,
): CustomFieldsEditor {
    const el = host.createElement
    let fields: CustomField[] = initial.map((field) => ({ ...field }))

    root.classList.add('lh-fields')
    const summary = el('div', { class: 'lh-fields-summary' })
    const list = el('div', { class: 'lh-fields-list' })
    const addButton = el('button', { type: 'button', class: 'lh-button' })
    addButton.textContent = 'Add field'
    // Export, Import and Clear all (72b): Multihog's three buttons, drawn when the host can file and pick.
    const tools = el('div', { class: 'lh-fields-tools' })
    const toolsNote = el('div', { class: 'lh-fields-tools-note', 'data-lh-field': 'fields-tools-note' })
    // The buttons' help (96): each `[?]` after its button, the notes under the row. Drawn once, so a redraw of the list keeps them.
    const toolsHelp = el('div', { class: 'lh-fields-tools-help' })
    const helped = (button: HTMLElement, label: string, text: string): void => {
        const tip = createHelpTip(el as never, label, text)
        tools.append(button, tip.button)
        toolsHelp.append(tip.note)
    }
    if (host.download) {
        const exportButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'fields-export' })
        exportButton.textContent = 'Export fields'
        exportButton.addEventListener('click', () => {
            if (!fields.length) { toolsNote.textContent = 'No custom fields to export.'; return }
            host.download!(`adventuretime-modules-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ adventuretimeCustomFields: fields } satisfies CustomFieldsFile, null, 2))
            toolsNote.textContent = `Exported ${fields.length} ${fields.length === 1 ? 'field' : 'fields'}.`
        })
        helped(exportButton, 'Export fields', 'Saves every custom field as one JSON file. Use it as a backup, or import it into another install.')
    }
    if (host.pickJson) {
        const importButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'fields-import' })
        importButton.textContent = 'Import fields'
        importButton.addEventListener('click', () => {
            host.pickJson!().then((text) => {
                if (text === null) { toolsNote.textContent = 'No file was picked.'; return }
                const imported = readCustomFieldsFile(text)
                fields = mergeCustomFields(fields, imported)
                commit()
                toolsNote.textContent = `Imported ${imported.length} ${imported.length === 1 ? 'field' : 'fields'}: ${imported.map((f) => f.tag).join(', ')}.`
            }).catch((error: unknown) => { toolsNote.textContent = `Could not import: ${error instanceof Error ? error.message : String(error)}` })
        })
        helped(importButton, 'Import fields', 'Adds the fields from a custom fields file. A field whose tag already exists here is replaced.')
    }
    const clearButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-button--danger', 'data-lh-field': 'fields-clear' })
    clearButton.textContent = 'Remove all fields'
    clearButton.addEventListener('click', () => {
        if (!fields.length) { toolsNote.textContent = 'No custom fields to clear.'; return }
        const ask = host.confirm ? host.confirm('Remove all fields', `Remove all ${fields.length} custom ${fields.length === 1 ? 'field' : 'fields'}? This cannot be undone. A cartridge you exported earlier still holds them.`, 'Remove all') : Promise.resolve(true)
        ask.then((ok) => {
            if (!ok) return
            const count = fields.length
            fields = []
            commit()
            toolsNote.textContent = `Removed ${count} ${count === 1 ? 'field' : 'fields'}.`
        }).catch(() => undefined)
    })
    // The warning stays in the open beside its button; the rest is behind the `[?]`.
    const clearWarning = el('span', { class: 'lh-fields-tools-warning' })
    clearWarning.textContent = 'Removes every custom field.'
    {
        const tip = createHelpTip(el as never, 'Remove all fields', 'The memo blocks the fields made stay until a tracker pass drops them. A game system linked to a removed field loses its tracker module.')
        tools.append(clearButton, clearWarning, tip.button)
        toolsHelp.append(tip.note)
    }
    root.replaceChildren(summary, list, addButton, tools, toolsHelp, toolsNote)

    function commit(): void {
        onChange(fields.map((field) => ({ ...field })))
        render()
    }

    /**
     * Say how many fields are switched on.
     *
     * A field that is off still round-trips through the cartridge and still
     * renders from an existing memo — it just never gets maintained. That is a
     * confusing state to be in silently, so it is stated.
     */
    function renderSummary(): void {
        const on = fields.filter((f) => f.enabled).length
        summary.replaceChildren()

        if (fields.length === 0) {
            summary.textContent = 'No custom fields yet. Add one to track something the stock modules do not cover.'
            return
        }

        const line = el('div')
        line.textContent = `${on} of ${fields.length} on`
        summary.append(line)

        // Switched on and still not maintained. Reported separately because it
        // is a *different* problem with an identical symptom, and the switch
        // says the opposite — the count above would otherwise be reassuring
        // about a field that does nothing.
        const silent = fields.filter((f) => f.enabled && !isMaintained(f)).length
        if (silent > 0) {
            const warning = el('div', { class: 'lh-field-warning' })
            warning.textContent =
                silent === 1
                    ? '1 field that is on has no instruction, so it does not update.'
                    : `${silent} fields that are on have no instruction, so they do not update.`
            summary.append(warning)
        }
    }

    function renderField(field: CustomField, index: number): HTMLElement {
        const row = el('details', { class: 'lh-field' })
        if (field.enabled) row.classList.add('lh-field--on')

        const head = el('summary', { class: 'lh-field-head' })

        const toggle = el('input', { type: 'checkbox' })
        toggle.checked = !!field.enabled
        toggle.title = 'Update this block on every pass'
        toggle.setAttribute('aria-label', 'Update this block on every pass')
        // Inside a <summary>, a click would otherwise fold the row instead.
        toggle.addEventListener('click', (event) => event.stopPropagation())
        toggle.addEventListener('change', () => {
            fields[index] = { ...field, enabled: toggle.checked }
            commit()
        })

        const name = el('span', { class: 'lh-field-name' })
        name.textContent = `${field.icon || '📄'} ${field.label || field.tag}`

        const tagChip = el('code', { class: 'lh-field-tag' })
        tagChip.textContent = `[${field.tag}]`

        head.append(toggle, name, tagChip)
        row.append(head)

        // On the row it is about, not only in the count above. Lesson 7: a
        // message about one thing must go on that thing. Its help opens the
        // row, as a card's does, since a closed row shows only its head (96).
        if (field.enabled && !isMaintained(field)) {
            row.classList.add('lh-field--silent')
            const chip = el('span', { class: 'lh-field-silent' })
            chip.textContent = 'No instruction'
            head.append(chip)
            attachCardHelp(el as never, row, head, chip, 'This field is on, but it has no instruction. The tracker is not told about it, so it does not update.')
        }

        const body = el('div', { class: 'lh-field-body' })

        const text = (
            labelText: string,
            value: string,
            help: string,
            apply: (next: string) => string | null,
        ): HTMLElement => {
            // Not a <label> around the lot: the `[?]` and its note may not sit inside one (96).
            const id = `lh-field-${++inputSequence}`
            const wrap = el('div', { class: 'lh-field-input' })
            const captionLine = el('div', { class: 'lh-field-caption' })
            const caption = el('label', { for: id })
            caption.textContent = labelText
            const input = el('input', { type: 'text', id })
            input.value = value
            const error = el('small', { class: 'lh-field-error' })

            // On change, not input: this writes to storage, and a request per
            // keystroke would be a request per keystroke.
            input.addEventListener('change', () => {
                const message = apply(input.value)
                error.textContent = message ?? ''
                if (message) input.value = value
                else commit()
            })

            const tip = createHelpTip(el as never, labelText, help)
            captionLine.append(caption, tip.button)
            wrap.append(captionLine, tip.note, input, error)
            return wrap
        }

        body.append(
            text('Tag', field.tag, 'The block name the model writes, without brackets.', (next) => {
                const others = fields.filter((_, i) => i !== index).map((f) => String(f.tag).toUpperCase())
                const message = validateTag(next, others)
                if (message) return message
                fields[index] = { ...field, tag: next.trim().toUpperCase() }
                return null
            }),
            text('Name', field.label ?? '', 'Shown on the card. Leave blank to use the tag.', (next) => {
                fields[index] = { ...field, label: next.trim() }
                return null
            }),
            text('Icon', field.icon ?? '', 'An emoji for the card header.', (next) => {
                fields[index] = { ...field, icon: next.trim() }
                return null
            }),
        )

        const promptId = `lh-field-${++inputSequence}`
        const promptWrap = el('div', { class: 'lh-field-input' })
        const promptLine = el('div', { class: 'lh-field-caption' })
        const promptCaption = el('label', { for: promptId })
        promptCaption.textContent = 'Instruction'
        const prompt = el('textarea', { rows: '10', spellcheck: 'false', id: promptId })
        prompt.value = field.prompt ?? ''
        prompt.addEventListener('change', () => {
            fields[index] = { ...field, prompt: prompt.value }
            commit()
        })
        const promptTip = createHelpTip(el as never, 'Instruction',
            'What the tracker is told about this block on every pass. Describe the values and how they change, ' +
            'and end with the exact block format you want back. If it is empty, the tracker is not told about the block.')

        // A blank box with prose guidance above it is what produces the empty
        // instruction this row now warns about. Showing the shape is cheaper
        // than describing it — lesson 9, applied to a person rather than a model.
        const promptExample = el('pre', { class: 'lh-field-example' })
        promptExample.textContent = [
            'Track the arrows in the quiver. Decrease by one per shot fired,',
            'and reset to the full count when the party restocks. Output:',
            '[QUIVER]',
            'Arrows: 12/20',
            '[/QUIVER]',
        ].join('\n')
        // The example goes with the help it illustrates, behind the same `[?]`.
        promptTip.note.append(promptExample)
        promptLine.append(promptCaption, promptTip.button)
        promptWrap.append(promptLine, promptTip.note, prompt)
        body.append(promptWrap)

        const remove = el('button', { type: 'button', class: 'lh-button lh-field-delete' })
        remove.textContent = 'Delete field'
        remove.addEventListener('click', () => {
            // Asks first, as every other delete does (96). By the field itself, not its index: the list may be redrawn while the question stands.
            const drop = (): void => {
                const at = fields.indexOf(field)
                if (at < 0) return
                fields = fields.filter((_, i) => i !== at)
                commit()
            }
            if (!host.confirm) { drop(); return }
            host.confirm('Delete field', `Delete the field "${field.label || field.tag}"? This cannot be undone.`, 'Delete')
                .then((ok) => { if (ok) drop() })
                .catch(() => undefined)
        })
        body.append(remove)

        row.append(body)
        return row
    }

    function render(): void {
        renderSummary()
        list.replaceChildren(...fields.map(renderField))
    }

    addButton.addEventListener('click', () => {
        const taken = fields.map((f) => String(f.tag).toUpperCase())
        let n = 1
        while (taken.includes(`NEW_FIELD_${n}`)) n++

        // New fields start switched on. A field you just created and cannot see
        // updating is the exact confusion this editor exists to remove.
        fields = [...fields, { tag: `NEW_FIELD_${n}`, label: '', icon: '', prompt: '', enabled: true }]
        commit()
    })

    render()

    return {
        setFields(next: CustomField[]): void {
            fields = next.map((field) => ({ ...field }))
            render()
        },
        destroy(): void {
            root.replaceChildren()
        },
    }
}
