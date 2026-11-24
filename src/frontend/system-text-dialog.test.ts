// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { openSystemCopyDialog, openSystemPasteDialog } from './system-text-dialog.js'

const el = ((tag: string, attrs?: Record<string, string>) => {
    const node = document.createElement(tag)
    for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, value)
    return node
}) as never

let inline: HTMLElement
beforeEach(() => {
    document.body.replaceChildren()
    inline = document.createElement('div')
    document.body.append(inline)
})

const q = (name: string) => document.querySelector(`[data-lh-field="${name}"]`) as HTMLElement
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A host modal: a root in the body, dismissed by taking it out. */
function fakeUi() {
    const opened: Array<{ title: string }> = []
    return {
        opened,
        ui: {
            showModal(options: { title: string }) {
                opened.push(options)
                const root = document.createElement('div')
                root.className = 'host-modal'
                document.body.append(root)
                return { root, dismiss: () => { root.remove() } }
            },
        },
    }
}

describe('Paste system text (departure 174)', () => {
    it('stands in the host’s modal, and hands the trimmed text to Preview, closing on success', () => {
        const { ui, opened } = fakeUi()
        const seen: string[] = []
        openSystemPasteDialog({ el, ui, inline }, (text) => { seen.push(text) })
        expect(opened).toEqual([expect.objectContaining({ title: 'Paste system text' })])
        expect(document.querySelector('.host-modal [data-lh-field="gs-paste-box"]')).not.toBeNull()
        expect(inline.children).toHaveLength(0)
        ;(q('gs-paste-text') as HTMLTextAreaElement).value = '  <meta name="X"/>  '
        q('gs-paste-preview').click()
        expect(seen).toEqual(['<meta name="X"/>'])
        expect(document.querySelector('.host-modal')).toBeNull()
        expect(q('gs-paste-box')).toBeNull()
    })

    it('stands inline without a modal; an empty box or a refused text says why in red and stays open with the text', () => {
        const onPreview = vi.fn(() => { throw new Error('The text holds no <gm_section> or <tracker_module> block.') })
        openSystemPasteDialog({ el, ui: undefined, inline }, onPreview)
        expect(inline.querySelector('[data-lh-field="gs-paste-box"]')).not.toBeNull()
        const problem = inline.querySelector('.lh-system-text-problem') as HTMLElement
        expect(problem.hidden).toBe(true)
        q('gs-paste-preview').click()
        expect(onPreview).not.toHaveBeenCalled()
        expect(problem.textContent).toBe('Paste a system’s text first.')
        expect(problem.hidden).toBe(false)
        ;(q('gs-paste-text') as HTMLTextAreaElement).value = 'hello'
        q('gs-paste-preview').click()
        expect(problem.textContent).toBe('The text holds no <gm_section> or <tracker_module> block.')
        expect((q('gs-paste-text') as HTMLTextAreaElement).value).toBe('hello')
        q('gs-paste-cancel').click()
        expect(inline.children).toHaveLength(0)
    })
})

describe('Copy as text (departure 174)', () => {
    it('shows the text read-only under the system’s name; Copy text says Copied. and stays open; Close closes', async () => {
        const { ui, opened } = fakeUi()
        const copy = vi.fn(async () => undefined)
        openSystemCopyDialog({ el, ui, inline, copy }, 'Lantern Oil', '<meta name="Lantern Oil"/>')
        expect(opened[0]!.title).toBe('“Lantern Oil” as text')
        const text = q('gs-copy-text') as HTMLTextAreaElement
        expect(text.value).toBe('<meta name="Lantern Oil"/>')
        expect(text.hasAttribute('readonly')).toBe(true)
        q('gs-copy-copy').click()
        await settle()
        expect(copy).toHaveBeenCalledWith('<meta name="Lantern Oil"/>')
        expect(document.querySelector('.lh-system-text-note')!.textContent).toBe('Copied.')
        expect(q('gs-copy-box')).not.toBeNull()
        q('gs-copy-close').click()
        expect(q('gs-copy-box')).toBeNull()
        expect(document.querySelector('.host-modal')).toBeNull()
    })

    it('says so and selects the text when the browser refuses the copy', async () => {
        openSystemCopyDialog({ el, ui: undefined, inline, copy: async () => { throw new Error('denied') } }, 'X', 'text')
        const select = vi.spyOn(q('gs-copy-text') as HTMLTextAreaElement, 'select')
        q('gs-copy-copy').click()
        await settle()
        expect(select).toHaveBeenCalled()
        expect(inline.querySelector('.lh-system-text-note')!.textContent).toBe('The browser refused the copy. The text is selected; copy it by hand.')
    })
})
