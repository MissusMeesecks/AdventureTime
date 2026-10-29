/**
 * The prompt editor before a pressed draw (Phase 73f, departure B3's *Skip
 * prompt edit dialog*): Multihog's `showPortraitPromptPopup`.
 *
 * A pressed draw -- the scene's picture, a library card's photo, a portrait
 * in play -- makes two calls: one writes the image prompt, the other draws
 * it. Multihog shows the written prompt in between, editable, with Generate,
 * Copy and Cancel, and a tick that stops the dialog coming back
 * (`portraitSkipPromptDialog`). This is that dialog over the host's modal:
 * the text as the model wrote it, edited or not, goes to the draw; Cancel
 * draws nothing; Copy puts the text on the clipboard and leaves the dialog
 * open. A host without a modal has nothing to show the prompt in, so the
 * draw goes ahead unedited, as it did before this phase. Draws on their own
 * -- after a reply, as they appear -- never ask, as Multihog's do not.
 */

/** The slice of the host's `ui` the dialog needs; the modal is absent on an older host. */
export interface PromptDialogUi {
    showModal?(options: { title: string; width?: number; maxHeight?: number }): { root: HTMLElement; dismiss(): void }
}

export interface PromptDialogOptions {
    /** The modal's title: what is being drawn. */
    title: string
    /** The prompt as the model wrote it. */
    prompt: string
    /** Copy to the clipboard; the browser's when absent. */
    copy?: (text: string) => Promise<void>
}

export interface PromptDialogAnswer {
    /** The text to draw: edited, or as written when the box was left alone or emptied. */
    prompt: string
    /** The tick: do not show the dialog again. */
    skip: boolean
}

/** Multihog's words on the dialog, kept. */
export const PROMPT_DIALOG_INTRO = 'Edit the prompt below, then copy it or draw with it. Cancel draws nothing.'
export const PROMPT_DIALOG_SKIP = 'Don’t show this dialog again (draw at once, as Skip the prompt editor says)'

/**
 * Show the prompt and wait: the answer, or `null` for Cancel -- or for the
 * modal closed by the host's own ×, which the dialog cannot hear and so
 * watches for, since a draw left waiting would hold the fold busy for good.
 */
export function askForPrompt(ui: PromptDialogUi | undefined, options: PromptDialogOptions): Promise<PromptDialogAnswer | null> {
    const showModal = ui?.showModal
    if (!showModal) return Promise.resolve({ prompt: options.prompt, skip: false })
    return new Promise((resolve) => {
        const modal = showModal.call(ui, { title: options.title, width: 560, maxHeight: 640 })
        const doc = modal.root.ownerDocument
        const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] => {
            const node = doc.createElement(tag)
            for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value)
            return node
        }
        // The panel's root class as well (lesson 56): the modal is the host's, outside the panel, and every
        // rule in PANEL_CSS is scoped to the class -- without it the three buttons drew as bare text (73g-bis).
        const box = el('div', { class: 'adventuretime-panel lh-prompt-dialog' })
        const intro = el('div', { class: 'lh-prompt-dialog-intro' })
        intro.textContent = PROMPT_DIALOG_INTRO
        const text = el('textarea', { class: 'lh-prompt-dialog-text', rows: '10', spellcheck: 'false', 'data-lh-field': 'prompt-dialog-text' })
        text.value = options.prompt
        const skipRow = el('label', { class: 'lh-prompt-dialog-skip' })
        const skipBox = el('input', { type: 'checkbox', 'data-lh-field': 'prompt-dialog-skip' })
        const skipText = el('span')
        skipText.textContent = PROMPT_DIALOG_SKIP
        skipRow.append(skipBox, skipText)
        const note = el('div', { class: 'lh-prompt-dialog-note', 'data-lh-field': 'prompt-dialog-note' })
        const row = el('div', { class: 'lh-prompt-dialog-row' })
        const draw = el('button', { type: 'button', class: 'lh-button' })
        draw.textContent = '🎨 Draw'
        const copy = el('button', { type: 'button', class: 'lh-button' })
        copy.textContent = '📋 Copy the prompt'
        const cancel = el('button', { type: 'button', class: 'lh-button' })
        cancel.textContent = 'Cancel'
        row.append(draw, copy, cancel)
        box.append(intro, text, skipRow, note, row)
        modal.root.append(box)

        let settled = false
        let watcher: MutationObserver | null = null
        const finish = (answer: PromptDialogAnswer | null): void => {
            if (settled) return
            settled = true
            watcher?.disconnect()
            try { modal.dismiss() } catch { /* already gone */ }
            resolve(answer)
        }
        draw.addEventListener('click', () => {
            const edited = text.value.trim()
            finish({ prompt: edited || options.prompt, skip: skipBox.checked })
        })
        cancel.addEventListener('click', () => finish(null))
        copy.addEventListener('click', () => {
            const write = options.copy ?? ((value: string) => navigator.clipboard.writeText(value))
            write(text.value)
                .then(() => { note.textContent = 'Copied.' })
                .catch(() => { note.textContent = 'Could not copy to the clipboard.' })
        })
        // The host's own × takes the modal out of the document without a word; a box gone is a Cancel.
        if (typeof MutationObserver !== 'undefined' && doc.body) {
            watcher = new MutationObserver(() => { if (!modal.root.isConnected) finish(null) })
            watcher.observe(doc.body, { childList: true, subtree: true })
        }
        text.focus()
        try { text.setSelectionRange(text.value.length, text.value.length) } catch { /* not every host */ }
    })
}
