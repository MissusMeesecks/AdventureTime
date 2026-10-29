// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'

import { createCardWordsControl } from './card-words.js'

afterEach(() => { document.body.replaceChildren() })

const el = (tag: string, attrs?: Record<string, string>) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n }

describe('the word count control', () => {
    it('offers the legacy\'s eight counts and a custom box, starts at 150, and reports a change', () => {
        const changes: number[] = []
        const control = createCardWordsControl(el, 'x', (n) => changes.push(n))
        document.body.append(control.root)
        const select = control.root.querySelector('[data-lh-field="x-input"]') as HTMLSelectElement
        const custom = control.root.querySelector('[data-lh-field="x-custom-input"]') as HTMLInputElement
        expect(Array.from(select.options).map((o) => o.value)).toEqual(['100', '150', '200', '300', '400', '500', '750', '1000', 'other'])
        expect(select.value).toBe('150')
        expect(custom.hidden).toBe(true)
        expect(control.value()).toBe(150)
        select.value = '300'
        select.dispatchEvent(new Event('change'))
        expect(changes).toEqual([300])
        expect(control.value()).toBe(300)
        // Custom shows the box and waits for a number; the number reports.
        select.value = 'other'
        select.dispatchEvent(new Event('change'))
        expect(custom.hidden).toBe(false)
        expect(changes).toEqual([300])
        custom.value = '800'
        custom.dispatchEvent(new Event('change'))
        expect(changes).toEqual([300, 800])
        expect(control.value()).toBe(800)
        // Out of bounds is clamped; nonsense is the default.
        custom.value = '9000'
        expect(control.value()).toBe(5000)
        custom.value = 'x'
        expect(control.value()).toBe(150)
    })

    it('sets a stock count on the select and any other in the box, and can be disabled', () => {
        const control = createCardWordsControl(el, 'x', () => undefined)
        const select = control.root.querySelector('select') as HTMLSelectElement
        const custom = control.root.querySelector('input') as HTMLInputElement
        control.set(750)
        expect(select.value).toBe('750')
        expect(custom.hidden).toBe(true)
        control.set(640)
        expect(select.value).toBe('other')
        expect(custom.value).toBe('640')
        expect(custom.hidden).toBe(false)
        expect(control.value()).toBe(640)
        control.set(10)
        expect(custom.value).toBe('50')
        control.setDisabled(true)
        expect(select.disabled).toBe(true)
        expect(custom.disabled).toBe(true)
        control.setDisabled(false)
        expect(select.disabled).toBe(false)
    })
})
