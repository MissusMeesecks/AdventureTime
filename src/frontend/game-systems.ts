/**
 * What your game systems are, and what this build does with each one.
 *
 * A game system is a *bundle*: a GM prompt section paired with a tracker
 * module. `src/settings/game-systems.ts` has the reasoning; the short version
 * is that **only the tracker half does anything in this build**, because
 * AdventureTime has no narrator prompt and `customSyspromptLibrary` has zero runtime
 * references.
 *
 * **This is a reading, not an editor, and that is a correction.** Phase 23
 * shipped it with a switch on every row this build could act on — and the
 * tracker half of a system *is* a custom field, so that switch already existed
 * one section down. Two controls for one flag is worse than one in the wrong
 * place: they disagreed on sight, and the custom fields editor wrote only its
 * own half, so two clicks in two lists manufactured exactly the drift this
 * section reports. The switch lives in **Custom fields**, where the instruction
 * it governs lives; this says what each system amounts to and nothing else.
 *
 * The four rows that are *not* duplicated are why it stays: a system with no
 * tracker module is a GM prompt section, does nothing here, and appears in no
 * other list in the panel. Nor does a broken link — which the custom fields
 * editor can create, since deleting a field orphans the system that named it.
 *
 * Creating a system is **not** here and should not be bolted on: the legacy
 * makes one with a three-thousand-line wizard that generates both halves with
 * a model. Deleting one is not here either, for a better reason — it removes
 * three cartridge keys' worth of data at once and cannot be undone, so it
 * wants its own phase and its own confirmations.
 */

import {
    buildGameSystemsView,
    GAME_SYSTEM_BADGES,
    type GameSystem,
    type GameSystemRow,
    type LinkedField,
} from '../settings/game-systems.js'
import { helpAfter } from './help-tip.js'

export interface GameSystemsHost {
    createElement: <K extends keyof HTMLElementTagNameMap>(
        tag: K,
        attrs?: Record<string, string>,
    ) => HTMLElementTagNameMap[K]
}

export interface GameSystemsEditor {
    setData(systems: GameSystem[], fields: LinkedField[]): void
    destroy(): void
}

export interface GameSystemsEditorOptions {
    /** Open a system in the wizard to edit it (Phase 32). No button without it. */
    onEdit?: (systemId: string) => void
    /** Export one system as a file (72b, departure 41). No button without it. */
    onExport?: (systemId: string) => void
    /** Import a system from a file (72b). No button without it. */
    onImport?: () => void
    /**
     * Paste a system as Multihog's text (departure 174). `inline` is where the
     * paste box stands on a host without a modal. No button without it.
     */
    onPaste?: (inline: HTMLElement) => void
    /** Show one system as Multihog's text, to copy (departure 174). No button without it. */
    onCopyText?: (systemId: string, inline: HTMLElement) => void
}

export function mountGameSystemsEditor(
    root: HTMLElement,
    host: GameSystemsHost,
    initialSystems: GameSystem[],
    initialFields: LinkedField[],
    options: GameSystemsEditorOptions = {},
): GameSystemsEditor {
    const el = host.createElement

    let systems = initialSystems.map((system) => ({ ...system }))
    let fields = initialFields.map((field) => ({ ...field }))

    const summary = el('div', { class: 'lh-gs-summary' })
    const list = el('div', { class: 'lh-gs-list' })
    root.replaceChildren(summary, list)
    // Where a text box stands on a host without a modal (departure 174).
    const inline = el('div', { class: 'lh-gs-inline' })
    if (options.onImport || options.onPaste) {
        const tools = el('div', { class: 'lh-gs-tools' })
        if (options.onImport) {
            const importButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'gs-import' })
            importButton.textContent = 'Import system'
            importButton.addEventListener('click', () => { options.onImport?.() })
            tools.append(importButton)
        }
        if (options.onPaste) {
            const pasteButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'gs-paste' })
            pasteButton.textContent = 'Paste system text'
            pasteButton.addEventListener('click', () => { options.onPaste?.(inline) })
            tools.append(pasteButton)
        }
        // Drawn once, outside the list, so its help survives every redraw (96).
        const last = tools.lastElementChild as HTMLElement
        root.append(helpAfter(el as never, tools, last, last.textContent ?? '', [
            options.onImport ? 'Import system loads a game system file exported from AdventureTime. Its system, tracker field and narrator rule are added as new items. Nothing existing is replaced.' : '',
            options.onPaste ? 'Paste system text reads a system shared as text, from Multihog’s Export or from Copy as text here, and opens it in the wizard’s preview. Nothing is saved until you press Save there.' : '',
        ].filter(Boolean).join('\n')))
    }
    root.append(inline)

    function renderRow(row: GameSystemRow): HTMLElement {
        const item = el('div', { class: `lh-gs-row lh-gs-row--${row.verdict}` })

        const head = el('div', { class: 'lh-gs-head' })

        const name = el('span', { class: 'lh-gs-name' })
        name.textContent = row.icon ? `${row.icon} ${row.name}` : row.name
        head.append(name)

        const badge = el('span', { class: `lh-gs-badge lh-gs-badge--${row.verdict}` })
        badge.textContent = GAME_SYSTEM_BADGES[row.verdict]
        head.append(badge)

        // Always present, empty on a GM-only row. It is a fixed-width column,
        // so leaving it out would let that row's badge slide to the panel edge
        // while every other row's stopped short of it -- and the badge is the
        // column the eye runs down. Found by rendering twenty real rows.
        const tag = el('code', { class: 'lh-gs-tag' })
        tag.textContent = row.tag ? `[${row.tag}]` : ''
        head.append(tag)

        // The one control on a row: into the wizard, to read and change both
        // halves. The switch stays in Custom fields, as the module note says.
        if (options.onEdit && row.id) {
            const edit = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-gs-edit' })
            edit.textContent = 'Edit in wizard'
            edit.addEventListener('click', () => { options.onEdit?.(row.id) })
            head.append(edit)
        }
        if (options.onExport && row.id) {
            const exportButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-gs-export' })
            exportButton.textContent = 'Export system'
            exportButton.addEventListener('click', () => { options.onExport?.(row.id) })
            head.append(exportButton)
        }
        if (options.onCopyText && row.id) {
            const copyButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-gs-copy-text' })
            copyButton.textContent = 'Copy as text'
            copyButton.addEventListener('click', () => { options.onCopyText?.(row.id, inline) })
            head.append(copyButton)
        }

        item.append(head)

        // The user's mental model is the system's switch; the tracker only ever
        // reads the module's. Where the two have drifted, say which one wins.
        //
        // Since the panel can no longer create this state, a row that says it
        // came in that way -- from a cartridge exported by the legacy build,
        // where the two halves were switched separately.
        if (row.disagrees) {
            const drift = el('div', { class: 'lh-gs-drift' })
            drift.textContent = row.systemEnabled
                ? 'This system is marked on, but its tracker module is off. The tracker does not update it. Turn the module on in Custom fields.'
                : 'This system is marked off, but its tracker module is on. The tracker updates it. Turn the module off in Custom fields.'
            item.append(drift)
        }

        if (row.description) {
            const description = el('div', { class: 'lh-gs-description' })
            description.textContent = row.description
            item.append(description)
        }

        return item
    }

    function render(): void {
        const view = buildGameSystemsView(systems, fields)

        summary.replaceChildren()

        // Only the empty list has a line of its own; what a system is, and what
        // each badge means, stand behind the heading's `[?]` (96).
        if (view.summary) {
            const lead = el('div', { class: 'lh-gs-lead' })
            lead.textContent = view.summary
            summary.append(lead)
        }

        if (view.counts) {
            const counts = el('div', { class: 'lh-gs-counts' })
            counts.textContent = view.counts
            summary.append(counts)
        }

        if (view.warning) {
            const warning = el('div', { class: 'lh-gs-warning' })
            warning.textContent = view.warning
            summary.append(warning)
        }

        list.replaceChildren(...view.rows.map(renderRow))
    }

    render()

    return {
        setData(nextSystems: GameSystem[], nextFields: LinkedField[]): void {
            systems = nextSystems.map((system) => ({ ...system }))
            fields = nextFields.map((field) => ({ ...field }))
            render()
        },
        destroy(): void {
            root.replaceChildren()
        },
    }
}
