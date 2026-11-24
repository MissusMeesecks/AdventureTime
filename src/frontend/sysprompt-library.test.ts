// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SyspromptSection } from '../settings/sysprompt-library.js'
import { mountSyspromptEditor, type SyspromptHost } from './sysprompt-library.js'

const host: SyspromptHost = {
    createElement: ((tag: string, attrs?: Record<string, string>) => {
        const node = document.createElement(tag)
        for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, value)
        return node
    }) as SyspromptHost['createElement'],
}

const SECTIONS: SyspromptSection[] = [
    { id: 'a', tag: 'ashfall', content: 'Ash falls on the ninth day.', enabled: true },
    { id: 'b', tag: 'tides', content: '', enabled: true },
    { id: 'c', tag: 'lanterns', content: 'Lanterns burn green near a ward.', enabled: false },
]
const ORDER = ['base:role', 'lib:a', 'lib:b', 'lib:c']

let root: HTMLElement

beforeEach(() => {
    document.body.replaceChildren()
    root = document.createElement('div')
    document.body.append(root)
})

function mount(sections = SECTIONS, order = ORDER) {
    const onChange = vi.fn()
    mountSyspromptEditor(root, host, sections, order, onChange)
    return { onChange }
}

const rows = () => Array.from(root.querySelectorAll<HTMLElement>('.lh-wr-row'))
const open = (index: number) => { rows()[index]!.querySelector<HTMLElement>('.lh-wr-name')!.click() }
const del = (index: number) => rows()[index]!.querySelector<HTMLButtonElement>('.lh-wr-actions button')!

describe('the world rules editor (96)', () => {
    it('draws the count and the cost, with no paragraph of help above the list', () => {
        mount()

        expect(root.querySelector('.lh-wr-lead')).toBeNull()
        expect(root.querySelector('.lh-wr-counts')!.textContent).toBe('3 sections · 2 on · about 7 tokens sent with every reply')
        expect(Array.from(root.querySelectorAll('.lh-wr-note')).map((n) => n.textContent)).toEqual(['1 section is on but empty, so it is skipped.'])
        expect(root.textContent).not.toContain('storyteller')
    })

    it('says so when there are no sections, and when none is on', () => {
        mount([], [])
        expect(root.querySelector('.lh-wr-lead')!.textContent).toBe('No custom sections yet.')

        mount([{ id: 'c', tag: 'lanterns', content: 'Lanterns.', enabled: false }], ['lib:c'])
        expect(root.querySelector('.lh-wr-counts')!.textContent).toBe('1 section · 0 on · No custom section is sent to the narrator.')
    })

    it('names every switch the same way and marks an empty section', () => {
        mount()

        expect(rows().map((r) => r.querySelector<HTMLInputElement>('input[type=checkbox]')!.title)).toEqual(Array(3).fill('Send this section to the narrator'))
        expect(rows()[1]!.querySelector('.lh-wr-chip')!.textContent).toBe('Empty')
        expect(rows()[0]!.querySelector('.lh-wr-chip')).toBeNull()
    })

    it('deletes on the second press, saying what goes, and takes the section out of the order', () => {
        const { onChange } = mount()

        open(0)
        expect(del(0).textContent).toBe('Delete section')
        expect(root.querySelector('.lh-wr-warning')).toBeNull()

        del(0).click()
        expect(onChange).not.toHaveBeenCalled()
        expect(del(0).textContent).toBe('Delete ashfall permanently')
        expect(root.querySelector('.lh-wr-warning')!.textContent).toBe('This deletes 27 characters of your writing and cannot be undone.')

        del(0).click()
        expect(onChange).toHaveBeenCalledTimes(1)
        const change = onChange.mock.calls[0]![0]
        expect(change.customSyspromptLibrary.map((s: SyspromptSection) => s.id)).toEqual(['b', 'c'])
        expect(change.syspromptSectionOrder).toEqual(['base:role', 'lib:b', 'lib:c'])
        expect(rows()).toHaveLength(2)
    })
})
