// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { bookNameFor, mountCustomTagsEditor, validateCustomTag, type CustomTag, type CustomTagsHost } from './custom-tags.js'

const host: CustomTagsHost = {
    createElement: ((tag: string, attrs?: Record<string, string>) => {
        const node = document.createElement(tag)
        for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, value)
        return node
    }) as CustomTagsHost['createElement'],
}

const STOCK = ['NPC', 'LOC', 'FAC', 'QUEST', 'EVENT', 'WORLD']

let root: HTMLElement
beforeEach(() => {
    document.body.replaceChildren()
    root = document.createElement('div')
    document.body.append(root)
})

const field = (name: string) => root.querySelector(`[data-lh-field="${name}"]`) as HTMLInputElement & HTMLTextAreaElement & HTMLButtonElement
const change = (node: HTMLElement, value: string) => { (node as HTMLInputElement).value = value; node.dispatchEvent(new Event('input')); node.dispatchEvent(new Event('change')) }

function mount(tags: unknown = [{ tag: 'SHIP', instruction: 'Named vessels.', format: 'Name | Description | Keywords' }]) {
    const onChange = vi.fn()
    const editor = mountCustomTagsEditor(root, host, { tags, stockTags: STOCK }, onChange)
    return { editor, onChange, sent: () => onChange.mock.calls.at(-1)![0].routerCustomTags as CustomTag[] }
}

describe('the Custom tags editor (47e)', () => {
    it('draws a row per tag with the book it writes to, and says so when there are none', () => {
        const { editor } = mount()
        expect(field('custom-tag-name-0').value).toBe('SHIP')
        expect(root.querySelector('.lh-ct-book')!.textContent).toBe('\u2192 \u2026_Ship')
        expect(field('custom-tag-text-0').value).toBe('Named vessels.')
        editor.setTags([], STOCK)
        expect(root.textContent).toContain('No custom tags yet')
    })

    it('adds an empty row, keeps the tag upper-cased, and writes the list whole on every change', () => {
        const { onChange, sent } = mount()
        field('custom-tag-add').click()
        expect(sent().length).toBe(2)
        expect(sent()[1]).toEqual({ tag: '', instruction: '', format: 'Name | Description | Keywords' })
        change(field('custom-tag-name-1'), 'rumour')
        expect(sent()[1]!.tag).toBe('RUMOUR')
        expect(field('custom-tag-name-1').value).toBe('RUMOUR')
        change(field('custom-tag-text-1'), 'What people say.')
        expect(sent()[1]).toEqual({ tag: 'RUMOUR', instruction: 'What people say.', format: 'Name | Description | Keywords' })
        expect(sent()[0]!.tag).toBe('SHIP')
        expect(onChange).toHaveBeenCalledTimes(3)
    })

    it('refuses a tag that repeats a stock module or another row, or is not a name, and says why without writing', () => {
        const { onChange } = mount([{ tag: 'SHIP', instruction: 'a' }, { tag: 'RUMOUR', instruction: 'b' }])
        change(field('custom-tag-name-1'), 'npc')
        expect(root.querySelector('.lh-ct-error')!.textContent).toContain('shipped categories')
        change(field('custom-tag-name-1'), 'ship')
        expect(root.querySelector('.lh-ct-error')!.textContent).toContain('already uses SHIP')
        change(field('custom-tag-name-1'), 'two words')
        expect(root.querySelector('.lh-ct-error')!.textContent).toContain('letters, digits and underscores')
        expect(onChange).not.toHaveBeenCalled()
        // The stored tag stands under the refused one.
        expect(field('custom-tag-name-1').value).toBe('RUMOUR')
    })

    it('removes a row and writes the rest', () => {
        const { sent } = mount([{ tag: 'SHIP', instruction: 'a' }, { tag: 'RUMOUR', instruction: 'b' }])
        field('custom-tag-remove-0').click()
        expect(sent().map((t) => t.tag)).toEqual(['RUMOUR'])
        expect(field('custom-tag-name-0').value).toBe('RUMOUR')
    })

    it('carries a stored row\'s other fields through a save', () => {
        const { sent } = mount([{ tag: 'SHIP', instruction: 'a', format: 'Name | Hull | Keywords', extra: 1 } as unknown as CustomTag])
        change(field('custom-tag-text-0'), 'b')
        expect(sent()[0]).toEqual({ tag: 'SHIP', instruction: 'b', format: 'Name | Hull | Keywords', extra: 1 })
    })

    it('names the book as upstream does, and validates as the rows do', () => {
        expect(bookNameFor('RUMOUR')).toBe('Rumour')
        expect(bookNameFor(' ')).toBe('')
        expect(validateCustomTag('ship', [], STOCK)).toBeNull()
        expect(validateCustomTag('', [], STOCK)).toContain('needs a name')
        expect(validateCustomTag('loc', [], STOCK)).toContain('shipped')
        expect(validateCustomTag('Ship', ['SHIP'], STOCK)).toContain('already uses')
    })
})
