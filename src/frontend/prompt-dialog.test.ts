// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { PROMPT_DIALOG_INTRO, askForPrompt } from './prompt-dialog.js'

function fakeUi() {
    const opened: Array<{ title: string; width?: number; maxHeight?: number }> = []
    let dismissed = 0
    let root: HTMLElement | null = null
    const ui = {
        showModal(options: { title: string; width?: number; maxHeight?: number }) {
            opened.push(options)
            root = document.createElement('div')
            root.className = 'host-modal'
            document.body.append(root)
            return { root, dismiss: () => { dismissed += 1; root?.remove() } }
        },
    }
    return { ui, opened, dismissed: () => dismissed, root: () => root! }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const button = (root: HTMLElement, text: string) => Array.from(root.querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement
const text = (root: HTMLElement) => root.querySelector('[data-lh-field="prompt-dialog-text"]') as HTMLTextAreaElement

describe('the prompt editor before a draw (73f)', () => {
    it('with no modal on the host, answers the prompt as written at once, nothing to edit it in', async () => {
        expect(await askForPrompt(undefined, { title: 't', prompt: 'A yard.' })).toEqual({ prompt: 'A yard.', skip: false })
        expect(await askForPrompt({}, { title: 't', prompt: 'A yard.' })).toEqual({ prompt: 'A yard.', skip: false })
    })

    it('shows the prompt in the host’s modal, in Multihog’s words, and Draw hands back the edited text with the tick', async () => {
        const h = fakeUi()
        const answer = askForPrompt(h.ui, { title: 'The picture of Courtyard', prompt: 'A yard at dawn.' })
        expect(h.opened).toEqual([{ title: 'The picture of Courtyard', width: 560, maxHeight: 640 }])
        const root = h.root()
        expect(root.querySelector('.lh-prompt-dialog-intro')!.textContent).toBe(PROMPT_DIALOG_INTRO)
        expect(text(root).value).toBe('A yard at dawn.')
        expect(root.querySelector('.lh-prompt-dialog-skip')!.textContent).toContain('Don’t show this dialog again')
        // The box carries the panel's root class (73g-bis): the modal is the host's, and the stylesheet is scoped
        // to the class, so without it the buttons drew as bare text; all three are plain buttons, as the scene's are.
        const box = root.querySelector('.lh-prompt-dialog') as HTMLElement
        expect(box.classList.contains('adventuretime-panel')).toBe(true)
        for (const label of ['🎨 Draw', '📋 Copy the prompt', 'Cancel']) {
            expect(button(root, label).className).toBe('lh-button')
            expect(box.contains(button(root, label))).toBe(true)
        }
        text(root).value = '  A yard at dusk, lanterns lit.  '
        ;(root.querySelector('[data-lh-field="prompt-dialog-skip"]') as HTMLInputElement).checked = true
        button(root, '🎨 Draw').click()
        expect(await answer).toEqual({ prompt: 'A yard at dusk, lanterns lit.', skip: true })
        expect(h.dismissed()).toBe(1)
    })

    it('an emptied box draws the prompt as written, and the tick is off unless ticked', async () => {
        const h = fakeUi()
        const answer = askForPrompt(h.ui, { title: 't', prompt: 'A yard.' })
        text(h.root()).value = '   '
        button(h.root(), '🎨 Draw').click()
        expect(await answer).toEqual({ prompt: 'A yard.', skip: false })
    })

    it('Cancel answers null and closes the modal; the host’s own close is a Cancel too', async () => {
        const h = fakeUi()
        const answer = askForPrompt(h.ui, { title: 't', prompt: 'A yard.' })
        button(h.root(), 'Cancel').click()
        expect(await answer).toBeNull()
        expect(h.dismissed()).toBe(1)
        const closed = fakeUi()
        const waiting = askForPrompt(closed.ui, { title: 't', prompt: 'A yard.' })
        closed.root().remove()
        await settle()
        expect(await waiting).toBeNull()
    })

    it('Copy puts the text on the clipboard and says so, the dialog still open; a failed copy says that', async () => {
        const h = fakeUi()
        const copied: string[] = []
        const answer = askForPrompt(h.ui, { title: 't', prompt: 'A yard.', copy: async (value) => { copied.push(value) } })
        text(h.root()).value = 'A barn.'
        button(h.root(), '📋 Copy the prompt').click()
        await settle()
        expect(copied).toEqual(['A barn.'])
        expect(h.root().querySelector('[data-lh-field="prompt-dialog-note"]')!.textContent).toBe('Copied.')
        expect(h.dismissed()).toBe(0)
        button(h.root(), 'Cancel').click()
        expect(await answer).toBeNull()
        const failing = fakeUi()
        const waiting = askForPrompt(failing.ui, { title: 't', prompt: 'A yard.', copy: async () => { throw new Error('no clipboard') } })
        button(failing.root(), '📋 Copy the prompt').click()
        await settle()
        expect(failing.root().querySelector('[data-lh-field="prompt-dialog-note"]')!.textContent).toBe('Could not copy to the clipboard.')
        button(failing.root(), '🎨 Draw').click()
        expect(await waiting).toEqual({ prompt: 'A yard.', skip: false })
    })
})
