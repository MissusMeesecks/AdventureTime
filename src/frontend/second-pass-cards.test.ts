// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import { getMarkerLibraryKeys } from '../tracker/markers.js'
import { createMarkersCard, createNarratorRows, createNpcWordsCard, renderingTagsLibrary } from './second-pass-cards.js'

const el = (tag: string, attrs?: Record<string, string>) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n }
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the narrator card’s rows (72b; in Core & Branching since 81)', () => {
    it('keeps the name as a preference, makes or finds the card on the press, and says which', async () => {
        const prefs: Array<Record<string, unknown>> = []
        const asked: string[] = []
        let created = true
        const card = createNarratorRows({ el, create: async (name) => { asked.push(name); return { id: 'k1', name, created } }, savePrefs: async (p) => { prefs.push(p) }, fail: () => undefined })
        const name = card.node.querySelector('[data-lh-field="narrator-name"]') as HTMLInputElement
        const note = () => card.node.querySelector('[data-lh-field="narrator-note"]')!.textContent
        expect(name.value).toBe('Game Master')
        name.value = ' The Chronicler '
        name.dispatchEvent(new Event('change'))
        expect(prefs).toEqual([{ narratorCardName: 'The Chronicler' }])
        ;(card.node.querySelector('[data-lh-field="narrator-create"]') as HTMLButtonElement).click()
        await settle()
        expect(asked).toEqual(['The Chronicler'])
        expect(note()).toContain('Made the card “The Chronicler”')
        created = false
        ;(card.node.querySelector('[data-lh-field="narrator-create"]') as HTMLButtonElement).click()
        await settle()
        expect(note()).toContain('already exists; nothing was made')
        card.applyPrefs({ narratorCardName: 'Keeper' })
        expect(name.value).toBe('Keeper')
        const refused = createNarratorRows({ el, create: async () => { throw new Error('PERMISSION_DENIED') }, savePrefs: async () => undefined, fail: () => undefined })
        ;(refused.node.querySelector('[data-lh-field="narrator-create"]') as HTMLButtonElement).click()
        await settle()
        expect(refused.node.querySelector('[data-lh-field="narrator-note"]')!.textContent).toBe('The card could not be made: PERMISSION_DENIED')
    })
})

describe('the NPC word targets (72b)', () => {
    it('saves both numbers on a change, clamped, and says when the instruction no longer carries the sentences', async () => {
        const saved: Array<[number, number]> = []
        let applied = true
        const card = createNpcWordsCard({ el, save: async (a, b) => { saved.push([a, b]); return { applied } }, fail: () => undefined })
        const major = card.root.querySelector('[data-lh-field="npc-major-words"]') as HTMLInputElement
        const minor = card.root.querySelector('[data-lh-field="npc-minor-words"]') as HTMLInputElement
        const note = () => card.root.querySelector('[data-lh-field="npc-words-note"]')!.textContent
        expect([major.value, minor.value]).toEqual(['225', '135'])
        major.value = '9000'
        major.dispatchEvent(new Event('change'))
        await settle()
        expect(saved).toEqual([[5000, 135]])
        expect(major.value).toBe('5000')
        expect(note()).toContain('written into the NPC instruction')
        applied = false
        minor.value = '90'
        minor.dispatchEvent(new Event('change'))
        await settle()
        expect(saved[1]).toEqual([5000, 90])
        expect(note()).toContain('no longer carries the two length sentences')
        card.applyPrefs({ npcMajorWords: 300, npcMinorWords: 100 })
        expect([major.value, minor.value]).toEqual(['300', '100'])
    })
})

describe('the rendering tags library (72b)', () => {
    it('lists every library marker with Multihog’s example line and draws each through the cards’ renderer', () => {
        const library = renderingTagsLibrary()
        expect(library.map((e) => e.key)).toEqual(getMarkerLibraryKeys())
        expect(library.find((e) => e.key === 'BAR')!.line).toBe('((BAR)) 50/100 (Colored resource bar)')
        const card = createMarkersCard(el)
        expect(card.open).toBe(false)
        expect(card.querySelector('.lh-card-title')!.textContent).toBe('Rendering tags library')
        const entries = Array.from(card.querySelectorAll('.lh-tags-entry'))
        expect(entries).toHaveLength(library.length)
        const bar = card.querySelector('[data-lh-tag="BAR"]')!
        expect(bar.querySelector('.lh-tags-token')!.textContent).toBe('((BAR)) 50/100 (Colored resource bar)')
        expect(bar.querySelector('.lh-tags-preview')!.innerHTML).toContain('rt-')
        expect(card.querySelectorAll('.lh-tags-preview').length).toBe(library.length)
        expect(Array.from(card.querySelectorAll('.lh-tags-preview')).every((p) => p.innerHTML.length > 0)).toBe(true)
    })

    it('draws its examples with no recolour handle, title or half-control: they are reference, not bars to configure (74i-ter)', () => {
        const card = createMarkersCard(el)
        expect(card.querySelector('.lh-tags-preview .rt-hp-bar')).not.toBeNull()
        expect(card.querySelector('.lh-tags-preview .rt-barrel-fill')).not.toBeNull()
        expect(card.querySelector('[data-recolor-id]')).toBeNull()
        expect(card.querySelector('[title^="Click to recolor"]')).toBeNull()
        expect(card.querySelector('.rt-barrel-color-control')).toBeNull()
        expect(card.querySelector('[data-recolor-percent]')).toBeNull()
    })
})
