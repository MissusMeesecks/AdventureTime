/**
 * A game system as Multihog's shareable text (the maintainer's ask of
 * 2026-11-24, departure 174): Multihog's **Export** shows a system as a
 * `<meta …/>` line and its two blocks in a box to copy, and its **Import** is a
 * box to paste that text into, read by the wizard's own parser and shown on
 * the wizard's preview before anything is saved. AdventureTime's file export
 * and import (72b) carry its own JSON and cannot read that text; these two
 * boxes are the bridge, both ways.
 *
 * Shown in the host's modal, as the prompt dialog and Map Details are; on a
 * host without one the box stands inline under the editor's tools and closes
 * itself the same way.
 */

import { openDetailsModal, type DetailsModalUi } from './details-modal.js'

type El = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, string>) => HTMLElementTagNameMap[K]

export interface SystemTextDialogDeps {
    el: El
    ui: DetailsModalUi | undefined
    /** Where the box stands when the host has no modal. */
    inline: HTMLElement
}

export interface SystemTextDialog {
    close(): void
}

function open(deps: SystemTextDialogDeps, title: string, box: HTMLElement): SystemTextDialog {
    const modal = openDetailsModal(deps.ui, { title, nodes: [box], width: 720 })
    if (modal) return { close: () => { modal.close(); box.remove() } }
    deps.inline.replaceChildren(box)
    return { close: () => { box.remove() } }
}

/**
 * The paste box. **Preview** hands the text to `onPreview`, which throws in
 * the user's words when the text is not a system; the reason stands under
 * the box in red and the box stays open with the text. On success it closes.
 */
export function openSystemPasteDialog(deps: SystemTextDialogDeps, onPreview: (text: string) => void): SystemTextDialog {
    const { el } = deps
    const box = el('div', { class: 'lh-system-text', 'data-lh-field': 'gs-paste-box' })
    const intro = el('div', { class: 'lh-system-text-intro' })
    intro.textContent = 'Paste the text of a game system exported from Multihog or AdventureTime. It opens in the wizard’s preview, where you can read and change it before saving.'
    const text = el('textarea', { class: 'lh-system-text-box', rows: '14', 'data-lh-field': 'gs-paste-text' })
    text.placeholder = '<meta name="…" icon="…" …/>\n<gm_section tag="…">…</gm_section>\n<tracker_module tag="…">…</tracker_module>'
    const problem = el('div', { class: 'lh-system-text-problem' })
    problem.hidden = true
    const buttons = el('div', { class: 'lh-system-text-buttons' })
    const preview = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'gs-paste-preview' })
    preview.textContent = 'Preview'
    const cancel = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'gs-paste-cancel' })
    cancel.textContent = 'Cancel'
    buttons.append(preview, cancel)
    box.append(intro, text, problem, buttons)
    const dialog = open(deps, 'Paste system text', box)
    preview.addEventListener('click', () => {
        const value = text.value.trim()
        if (!value) {
            problem.textContent = 'Paste a system’s text first.'
            problem.hidden = false
            return
        }
        try {
            onPreview(value)
        } catch (error) {
            problem.textContent = error instanceof Error ? error.message : String(error)
            problem.hidden = false
            return
        }
        dialog.close()
    })
    cancel.addEventListener('click', () => { dialog.close() })
    return dialog
}

/** The copy box: the text read-only, **Copy text** saying *Copied.* and leaving it open, **Close**. */
export function openSystemCopyDialog(
    deps: SystemTextDialogDeps & { copy?: (text: string) => Promise<void> },
    name: string,
    value: string,
): SystemTextDialog {
    const { el } = deps
    const box = el('div', { class: 'lh-system-text', 'data-lh-field': 'gs-copy-box' })
    const intro = el('div', { class: 'lh-system-text-intro' })
    intro.textContent = 'This is the system as text, in Multihog’s format. Paste it into Paste system text in AdventureTime, or into Import in Multihog’s Game Systems.'
    const text = el('textarea', { class: 'lh-system-text-box', rows: '14', readonly: '', 'data-lh-field': 'gs-copy-text' })
    text.value = value
    const note = el('div', { class: 'lh-system-text-note' })
    const buttons = el('div', { class: 'lh-system-text-buttons' })
    const copy = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'gs-copy-copy' })
    copy.textContent = 'Copy text'
    const close = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'gs-copy-close' })
    close.textContent = 'Close'
    buttons.append(copy, close)
    box.append(intro, text, note, buttons)
    const dialog = open(deps, `“${name}” as text`, box)
    copy.addEventListener('click', () => {
        const write = deps.copy ?? ((v: string) => navigator.clipboard.writeText(v))
        write(value)
            .then(() => { note.textContent = 'Copied.' })
            .catch(() => {
                text.select()
                note.textContent = 'The browser refused the copy. The text is selected; copy it by hand.'
            })
    })
    close.addEventListener('click', () => { dialog.close() })
    return dialog
}
