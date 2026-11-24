// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { HELP_TIP_CSS, attachCardHelp, createHelpTip, revealHelp } from './help-tip.js'

const el = (tag: string, attrs?: Record<string, string>) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n }
const press = (node: HTMLElement) => { const event = new Event('click', { bubbles: true, cancelable: true }); node.dispatchEvent(event); return event }
const key = (node: HTMLElement, k: string) => node.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))

describe('the [?] (96)', () => {
    it('is a real button named for its label, wired to help that is in the DOM and hidden from the first paint', () => {
        const { button, note } = createHelpTip(el, 'Lantern oil', 'How much oil a lantern burns.\n1. First.\n2. Second.')
        expect(button.tagName).toBe('BUTTON')
        expect(button.getAttribute('type')).toBe('button')
        expect(button.getAttribute('aria-label')).toBe('Help: Lantern oil')
        expect(button.getAttribute('aria-expanded')).toBe('false')
        expect(button.getAttribute('aria-controls')).toBe(note.id)
        expect(note.id).toMatch(/^lh-help-\d+$/)
        expect(note.getAttribute('role')).toBe('note')
        expect(note.hidden).toBe(true)
        expect(note.textContent).toBe('How much oil a lantern burns.\n1. First.\n2. Second.')
        // The icon is a drawing, not a word a screen reader should read.
        expect(button.querySelector('svg')).not.toBeNull()
        expect(button.textContent).toBe('')
        // Two tips never share an id.
        expect(createHelpTip(el, 'a', 'b').note.id).not.toBe(note.id)
    })

    it('opens and closes on a press, closes on Escape, and leaves other help alone', () => {
        const one = createHelpTip(el, 'One', 'First help.')
        const two = createHelpTip(el, 'Two', 'Second help.')
        press(one.button)
        expect([one.note.hidden, one.button.getAttribute('aria-expanded')]).toEqual([false, 'true'])
        press(two.button)
        expect([one.note.hidden, two.note.hidden]).toEqual([false, false])
        press(one.button)
        expect([one.note.hidden, one.button.getAttribute('aria-expanded')]).toEqual([true, 'false'])
        key(two.button, 'Escape')
        expect([two.note.hidden, two.button.getAttribute('aria-expanded')]).toEqual([true, 'false'])
    })

    it('never ticks the box of a label it sits in, nor folds the card whose header it sits in', () => {
        const tip = createHelpTip(el, 'Rations', 'Help.')
        const label = el('label')
        const box = el('input', { type: 'checkbox' }) as HTMLInputElement
        label.append(box, tip.button)
        let reached = 0
        label.addEventListener('click', () => { reached++ })
        const event = press(tip.button)
        expect(event.defaultPrevented).toBe(true)
        expect(reached).toBe(0)
        expect(box.checked).toBe(false)
    })

    it('on a card: sits after the title, puts the help first in the body, and a press opens a closed card and never folds an open one', () => {
        const card = el('details') as HTMLDetailsElement
        const summary = el('summary')
        const title = el('span')
        title.textContent = 'Waystones'
        const chevron = el('span', { class: 'lh-chevron' })
        summary.append(title, chevron)
        const body = el('div')
        card.append(summary, body)
        const tip = attachCardHelp(el, card, summary, title, 'What waystones do.')
        expect(Array.from(summary.children)).toEqual([title, tip.button, chevron])
        expect(Array.from(card.children)).toEqual([summary, tip.note, body])
        expect(tip.button.getAttribute('aria-label')).toBe('Help: Waystones')
        press(tip.button)
        expect([card.open, tip.note.hidden]).toEqual([true, false])
        press(tip.button)
        expect([card.open, tip.note.hidden]).toEqual([true, true])
    })

    it('is opened by a search that matches its text, closed again by an empty box, and what a press opened stays', () => {
        const root = el('div')
        const oil = createHelpTip(el, 'Oil', 'Burns for six hours.')
        const rope = createHelpTip(el, 'Rope', 'Fifty feet of hemp.')
        const hand = createHelpTip(el, 'Chalk', 'Marks a wall for six turns.')
        root.append(oil.note, rope.note, hand.note)
        press(hand.button)
        revealHelp(root, 'six')
        expect([oil.note.hidden, rope.note.hidden, hand.note.hidden]).toEqual([false, true, false])
        expect(oil.button.getAttribute('aria-expanded')).toBe('true')
        revealHelp(root, 'hemp')
        expect([oil.note.hidden, rope.note.hidden, hand.note.hidden]).toEqual([true, false, false])
        revealHelp(root, '')
        expect([oil.note.hidden, rope.note.hidden, hand.note.hidden]).toEqual([true, true, false])
        // Help the search opened and the user then pressed shut stays shut, and is the user's from there.
        revealHelp(root, 'six')
        press(oil.button)
        expect(oil.note.hidden).toBe(true)
        press(oil.button)
        revealHelp(root, '')
        expect(oil.note.hidden).toBe(false)
    })

    it('hides the help by a rule of its own, and depends on no hover', () => {
        expect(HELP_TIP_CSS).toContain('.adventuretime-panel .lh-help-note[hidden] { display: none; }')
        // Hover may only brighten the button; nothing is shown or hidden by it.
        expect(HELP_TIP_CSS).not.toMatch(/:hover[^{]*\.lh-help-note/)
        expect(HELP_TIP_CSS).toMatch(/\.lh-help-tip \{[^}]*width: 28px; height: 28px/)
    })
})
