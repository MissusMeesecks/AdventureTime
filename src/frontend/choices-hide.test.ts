// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { HIDDEN_MARK, hideChoicesInBubble, normalizeChoiceText, ownButtonsVisible } from './choices-hide.js'

const CHOICES = ['1. 🚪 Open it — [Strength (+2) DC 12]', '2. 👂 Listen first', '3. Walk away.']
/**
 * Our own buttons as the real host leaves them (the maintainer's HTML, 33a-ter):
 * the root we inject is replaced by the host's wrapper, and only the list
 * survives inside it. Their text is a choice's text, so they are exactly what
 * a text match would hide.
 */
const OWN = '<div data-spindle-ext="x"><div class="lh-choices-list"><button type="button" class="lh-choice" data-lh-choice="0">1. 🚪 Open it — [Strength (+2) DC 12]</button></div></div>'
const bubble = (html: string, own = OWN): HTMLElement => {
    const node = document.createElement('div')
    node.innerHTML = html + own
    return node
}
const hiddenTexts = (root: Element) => Array.from(root.querySelectorAll(`[${HIDDEN_MARK}]`)).map((n) => n.textContent?.trim())
const visible = (root: Element) => Array.from(root.querySelectorAll('p, li, ol, choices')).filter((n) => !(n as HTMLElement).style.display).map((n) => n.tagName.toLowerCase())

describe('what counts as the same line', () => {
    it('drops the numbering, the emoji and the punctuation, and lowers the case', () => {
        expect(normalizeChoiceText('1. 🚪 Open it — [Strength (+2) DC 12]')).toBe('open it strength 2 dc 12')
        expect(normalizeChoiceText('  3) Walk away.')).toBe('walk away')
        expect(normalizeChoiceText('Walk Away')).toBe('walk away')
        expect(normalizeChoiceText('')).toBe('')
    })
})

describe('hiding the rendered block', () => {
    it('hides the buttons the host makes of the block\'s <button> tags, and never our own', () => {
        // The real shape: the host renders the tags as buttons inside its prose.
        const root = bubble('<div class="_prose"><p>The door is shut.</p><button style="">1. 🚪 Open it — [Strength (+2) DC 12]</button>\n<button style="">2. 👂 Listen first</button></div>')
        expect(hideChoicesInBubble(root, CHOICES)).toBe(2)
        expect(Array.from(root.querySelectorAll('._prose button')).every((b) => b.hasAttribute(HIDDEN_MARK))).toBe(true)
        expect(root.querySelector('.lh-choice')!.hasAttribute(HIDDEN_MARK)).toBe(false)
        expect(ownButtonsVisible(root)).toBe(true)
    })

    it('knows our buttons by the list alone, under a wrapper that carries no host attribute', () => {
        const plain = '<div class="host-wrapper"><div class="lh-choices-list"><button class="lh-choice">2. 👂 Listen first</button></div></div>'
        const root = bubble('<button style="">2. 👂 Listen first</button>', plain)
        expect(hideChoicesInBubble(root, CHOICES)).toBe(1)
        expect(root.querySelector('.lh-choice')!.hasAttribute(HIDDEN_MARK)).toBe(false)
        expect(root.querySelector('button[style]')!.hasAttribute(HIDDEN_MARK)).toBe(true)
    })

    it('hides a <choices> element the host left in the DOM, and nothing else', () => {
        const root = bubble('<p>Prose stays.</p><choices>1. 🚪 Open it\n2. 👂 Listen first</choices>')
        expect(hideChoicesInBubble(root, CHOICES)).toBe(1)
        expect(hiddenTexts(root)).toEqual(['1. 🚪 Open it\n2. 👂 Listen first'])
        expect(visible(root)).toEqual(['p'])
    })

    it('hides the list the host makes of the numbered lines, item by item and then the list', () => {
        const root = bubble('<p>The door is shut.</p><ol><li>🚪 Open it — [Strength (+2) DC 12]</li><li>👂 Listen first</li><li>Walk away.</li></ol><p>What do you do?</p>')
        expect(hideChoicesInBubble(root, CHOICES)).toBe(4)
        expect(visible(root)).toEqual(['p', 'p'])
        expect(root.querySelector('ol')!.hasAttribute(HIDDEN_MARK)).toBe(true)
    })

    it('hides paragraph lines, one per choice or all in one, and leaves prose that merely mentions one', () => {
        const root = bubble('<p>You could open it, or listen first.</p><p>1. 🚪 Open it — [Strength (+2) DC 12]</p><p>2. 👂 Listen first<br>3. Walk away.</p>')
        expect(hideChoicesInBubble(root, CHOICES)).toBe(1)
        expect(hiddenTexts(root)).toEqual(['1. 🚪 Open it — [Strength (+2) DC 12]'])
        const all = bubble('<p>Prose.</p><p>1. 🚪 Open it — [Strength (+2) DC 12]<br>2. 👂 Listen first<br>3. Walk away.</p>')
        expect(hideChoicesInBubble(all, CHOICES)).toBe(1)
        expect(visible(all)).toEqual(['p'])
    })

    it('leaves prose that happens to contain every choice, in words', () => {
        const root = bubble('<p>You could open it — [Strength (+2) DC 12] — or listen first, or walk away, she said.</p>')
        expect(hideChoicesInBubble(root, CHOICES)).toBe(0)
    })

    it('leaves a list that is not the choices alone', () => {
        const root = bubble('<ol><li>🚪 Open it — [Strength (+2) DC 12]</li><li>A loot entry</li></ol>')
        expect(hideChoicesInBubble(root, CHOICES)).toBe(1)
        expect(root.querySelector('ol')!.hasAttribute(HIDDEN_MARK)).toBe(false)
    })

    it('never touches its own buttons, and does nothing twice', () => {
        const root = bubble('<ol><li>👂 Listen first</li></ol>', '<div data-spindle-ext="x"><div class="lh-choices-list"><button>2. 👂 Listen first</button></div></div>')
        expect(hideChoicesInBubble(root, CHOICES)).toBe(2)
        expect(root.querySelector('button')!.hasAttribute(HIDDEN_MARK)).toBe(false)
        expect(hideChoicesInBubble(root, CHOICES)).toBe(0)
        expect(hideChoicesInBubble(root, [])).toBe(0)
    })

    // The first live run hid the options outright (33a-bis): the lines went and
    // the buttons with them. Two guards, each tested on its own.
    it('never hides an element the host put our buttons inside, whatever its text, and still hides the rest', () => {
        // The container keeps its text and our buttons; the other line still goes.
        const root = bubble(`<p>Walk away.</p><li>👂 Listen first${OWN}</li>`, '')
        expect(hideChoicesInBubble(root, CHOICES)).toBe(1)
        expect(root.querySelector('li')!.hasAttribute(HIDDEN_MARK)).toBe(false)
        expect(root.querySelector('p')!.hasAttribute(HIDDEN_MARK)).toBe(true)
        // A <choices> element is hidden on its name alone -- unless the host
        // put our block inside it, when it stays and the other line still goes.
        const tag = bubble(`<p>Walk away.</p><choices>1. 🚪 Open it\n2. 👂 Listen first${OWN}</choices>`, '')
        expect(hideChoicesInBubble(tag, CHOICES)).toBe(1)
        expect(tag.querySelector('choices')!.hasAttribute(HIDDEN_MARK)).toBe(false)
        expect(tag.querySelector('p')!.hasAttribute(HIDDEN_MARK)).toBe(true)
        expect(ownButtonsVisible(tag)).toBe(true)
    })

    it('puts everything back when our buttons are not standing visible afterwards', () => {
        const none = bubble('<ol><li>👂 Listen first</li></ol>', '')
        expect(hideChoicesInBubble(none, CHOICES)).toBe(0)
        expect((none.querySelector('li') as HTMLElement).style.display).toBe('')
        expect(none.querySelector(`[${HIDDEN_MARK}]`)).toBeNull()
        const covered = bubble('<ol><li>👂 Listen first</li></ol>', '<div style="display:none"><div data-spindle-ext="x"><div class="lh-choices-list"><button>x</button></div></div></div>')
        expect(ownButtonsVisible(covered)).toBe(false)
        expect(hideChoicesInBubble(covered, CHOICES)).toBe(0)
        expect((covered.querySelector('li') as HTMLElement).style.display).toBe('')
    })
})
