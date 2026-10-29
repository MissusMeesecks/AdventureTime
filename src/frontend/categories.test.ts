// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import { SETTINGS_CATEGORIES } from '../settings/schema.js'
import { createSettingsCategories, createSettingsSearch } from './categories.js'

const el = (tag: string, attrs?: Record<string, string>) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n }

function section(title: string, rows: string[]): HTMLDetailsElement {
    const details = el('details', { class: 'lh-section' }) as HTMLDetailsElement
    const summary = el('summary')
    const heading = el('span', { class: 'lh-section-title' })
    heading.textContent = title
    summary.append(heading)
    details.append(summary)
    for (const text of rows) {
        const row = el('div', { class: 'lh-row' })
        row.textContent = text
        details.append(row)
    }
    return details
}

describe('the categories (63)', () => {
    it('draws Multihog’s seven in its order, each a fold with a body', () => {
        const categories = createSettingsCategories(el)
        const folds = Array.from(categories.root.querySelectorAll('.lh-category'))
        expect(folds.map((f) => f.getAttribute('data-lh-category'))).toEqual(['general', 'connections', 'systems', 'tracker', 'agent', 'maps', 'world'])
        expect(folds.map((f) => f.querySelector('.lh-category-title')!.textContent)).toEqual(SETTINGS_CATEGORIES.map((c) => c.title))
        expect(folds.map((f) => f.querySelector('.lh-card-icon')!.textContent)).toEqual(SETTINGS_CATEGORIES.map((c) => c.icon))
        expect(categories.bodies.maps.closest('.lh-category')).toBe(categories.folds.maps)
        expect(folds.every((f) => !(f as HTMLDetailsElement).open)).toBe(true)
    })
})

describe('the categories’ copy (63d)', () => {
    it('opens each fold with an intro box and a closed Quick Start Guide, in Multihog’s shape, before the body', () => {
        const categories = createSettingsCategories(el)
        for (const fold of Array.from(categories.root.querySelectorAll<HTMLDetailsElement>('.lh-category'))) {
            const children = Array.from(fold.children).map((c) => c.className)
            // Persistent maps carries the Maps Guide too (71a), between the Quick Start Guide and the body.
            expect(children).toEqual(fold.getAttribute('data-lh-category') === 'maps'
                ? ['', 'lh-category-intro lh-search-item', 'lh-card lh-quickstart lh-search-item', 'lh-card lh-quickstart lh-maps-guide lh-search-item', 'lh-category-body']
                : ['', 'lh-category-intro lh-search-item', 'lh-card lh-quickstart lh-search-item', 'lh-category-body'])
            const guide = fold.querySelector('.lh-quickstart') as HTMLDetailsElement
            expect(guide.open).toBe(false)
            expect(guide.querySelector('.lh-card-title')!.textContent).toBe('Quick Start Guide')
            expect(guide.querySelectorAll('.lh-quickstart-steps > li').length).toBeGreaterThanOrEqual(3)
            expect(guide.querySelector('.lh-quickstart-misc-label')!.textContent).toBe('Miscellaneous')
            expect((fold.querySelector('.lh-category-intro') as HTMLElement).textContent!.length).toBeGreaterThan(40)
        }
        const world = categories.folds.world
        expect(world.querySelector('.lh-category-intro')!.textContent).toContain('World Progression automatically generates off-screen world simulation reports')
        expect(Array.from(world.querySelectorAll('.lh-quickstart-steps b')).map((b) => b.textContent)).toEqual(['Create the skeleton source', 'Generate the skeleton', 'Set up the location rotation', 'Write the first report'])
    })

    it('gives Persistent maps the Maps Guide (71a): a closed card of Multihog’s help, with AdventureTime’s button names, and only there', () => {
        const categories = createSettingsCategories(el)
        const guide = categories.folds.maps.querySelector('.lh-maps-guide') as HTMLDetailsElement
        expect(guide).not.toBeNull()
        expect(guide.open).toBe(false)
        expect(guide.querySelector('.lh-card-title')!.textContent).toBe('Maps Guide')
        expect(Array.from(guide.querySelectorAll('.lh-quickstart-misc-label')).map((h) => h.textContent)).toEqual(['What are maps?', 'Why do they matter?', 'How are they made and sent?', 'Editing a map', 'World Progression and Map Evolution together'])
        expect(guide.textContent).toContain('The trap or the enemy is spawned by the roll.')
        expect(guide.textContent).toContain('+ Add Mapped Location on the Locations folder of Campaign records')
        expect(guide.textContent).toContain('open Raw JSON under the picture')
        expect(categories.root.querySelectorAll('.lh-maps-guide')).toHaveLength(1)
    })

    it('a search finds a guide and hides the others', () => {
        const categories = createSettingsCategories(el)
        const search = createSettingsSearch(el, categories.root)
        document.body.replaceChildren(search.root, categories.root)
        search.input.value = 'skeleton source'
        search.input.dispatchEvent(new Event('input'))
        expect(categories.folds.world.hidden).toBe(false)
        expect((categories.folds.world.querySelector('.lh-quickstart') as HTMLElement).hidden).toBe(false)
        expect((categories.folds.tracker.querySelector('.lh-quickstart') as HTMLElement).hidden).toBe(true)
    })
})

describe('the search (63)', () => {
    function build() {
        const categories = createSettingsCategories(el)
        const layout = el('div', { class: 'lh-layout lh-search-item' })
        layout.textContent = 'Layout: two floating widgets'
        categories.bodies.general.append(layout, section('CYOA Mode', ['CYOA configuration']))
        categories.bodies.tracker.append(section('State Tracker', ['Extractor system prompt', 'RNG mode', 'Use 24-hour time']))
        categories.bodies.world.append(section('World Progression', ['World progression prompt']))
        const search = createSettingsSearch(el, categories.root)
        document.body.replaceChildren(search.root, categories.root)
        const type = (text: string) => { search.input.value = text; search.input.dispatchEvent(new Event('input')) }
        const hidden = (selector: string) => Array.from(categories.root.querySelectorAll<HTMLElement>(selector)).filter((n) => n.hidden).length
        return { categories, search, type, hidden }
    }

    it('hides what does not match, opens what does, down to the row', () => {
        const { categories, type, hidden } = build()
        type('rng')
        expect(categories.folds.tracker.hidden).toBe(false)
        expect(categories.folds.tracker.open).toBe(true)
        expect(categories.folds.general.hidden).toBe(true)
        expect(categories.folds.world.hidden).toBe(true)
        const rows = Array.from(categories.bodies.tracker.querySelectorAll<HTMLElement>('.lh-row'))
        expect(rows.map((r) => r.hidden)).toEqual([true, false, true])
        expect((categories.bodies.tracker.querySelector('.lh-section') as HTMLDetailsElement).open).toBe(true)
        expect(hidden('.lh-section')).toBe(2)
    })

    it('shows a whole section when its title matches, and a search item outside any section', () => {
        const { categories, type } = build()
        type('state tracker')
        expect(Array.from(categories.bodies.tracker.querySelectorAll<HTMLElement>('.lh-row')).every((r) => !r.hidden)).toBe(true)
        type('widgets')
        expect(categories.folds.general.hidden).toBe(false)
        expect((categories.bodies.general.querySelector('.lh-layout') as HTMLElement).hidden).toBe(false)
        expect((categories.bodies.general.querySelector('.lh-section') as HTMLElement).hidden).toBe(true)
    })

    it('reads a section drawn whole by an editor through its search items, and opens the fold a match sits in (70)', () => {
        const { categories, type } = build()
        const card = el('details', { class: 'lh-section' }) as HTMLDetailsElement
        const summary = el('summary')
        const heading = el('span', { class: 'lh-section-title' })
        heading.textContent = 'Narrator configuration'
        summary.append(heading)
        card.append(summary)
        const plain = el('label', { class: 'lh-search-item' })
        plain.textContent = 'Loot rolls'
        const advanced = el('details') as HTMLDetailsElement
        const inner = el('label', { class: 'lh-search-item' })
        inner.textContent = 'd100 mode'
        advanced.append(el('summary'), inner)
        card.append(plain, advanced)
        categories.bodies.systems.append(card)
        type('d100')
        expect(card.hidden).toBe(false)
        expect(card.open).toBe(true)
        expect(advanced.open).toBe(true)
        expect(plain.hidden).toBe(true)
        expect(inner.hidden).toBe(false)
        type('nothing of the sort')
        expect(card.hidden).toBe(true)
    })

    it('shows a box of mirrored dials while any of its rows matches, and hides it whole otherwise (63c)', () => {
        const { categories, type } = build()
        const box = el('div', { class: 'lh-dials' })
        const card = el('details', { class: 'lh-card lh-dial-card' }) as HTMLDetailsElement
        const title = el('summary')
        title.textContent = 'The agent’s cadence'
        const one = el('div', { class: 'lh-dial lh-search-item' })
        one.textContent = 'Replies between automatic passes'
        const two = el('div', { class: 'lh-dial lh-search-item' })
        two.textContent = 'Research turns'
        card.append(title, one, two)
        const other = el('details', { class: 'lh-card lh-dial-card' }) as HTMLDetailsElement
        const three = el('div', { class: 'lh-dial lh-search-item' })
        three.textContent = 'Attach to'
        other.append(el('summary'), three)
        box.append(card, other)
        categories.bodies.agent.append(box)
        type('turns')
        expect(box.hidden).toBe(false)
        expect(card.hidden).toBe(false)
        expect(card.open).toBe(true)
        expect(other.hidden).toBe(true)
        expect(one.hidden).toBe(true)
        expect(two.hidden).toBe(false)
        expect(categories.folds.agent.open).toBe(true)
        type('zzzq')
        expect(box.hidden).toBe(true)
        expect(categories.folds.agent.hidden).toBe(true)
        type('')
        expect(box.hidden).toBe(false)
        expect(card.hidden).toBe(false)
        expect(other.hidden).toBe(false)
        expect(one.hidden).toBe(false)
    })

    it('an empty box shows everything again and closes nothing; nothing matching says so', () => {
        const { categories, search, type, hidden } = build()
        type('zzz')
        expect(hidden('.lh-category')).toBe(7)
        expect(search.root.querySelector('.lh-search-note')!.textContent).toBe('Nothing matches.')
        type('rng')
        type('')
        expect(hidden('.lh-category')).toBe(0)
        expect(hidden('.lh-section')).toBe(0)
        expect(hidden('.lh-row')).toBe(0)
        expect(categories.folds.tracker.open).toBe(true)
        expect(search.root.querySelector('.lh-search-note')!.textContent).toBe('')
    })
})
