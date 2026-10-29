/**
 * The settings' categories (Phase 63, roadmap row 63): Multihog's seven on
 * AdventureTime's side panel, by the maintainer's ask of 2026-10-15 — *take their
 * general settings layout and implement it on our side panel, rather than
 * convert to a modal*. One fold per category on the settings tab, in
 * Multihog's order, each holding the sections and editors that belong to
 * it; and a search box over the lot, which opens what matches and hides
 * the rest, as Multihog's *Search settings…* filters its window.
 */

import { SETTINGS_CATEGORIES, type SettingsCategoryId } from '../settings/schema.js'
import { CATEGORY_COPY, createCategoryIntro, createQuickStart, createMapsGuide } from './category-copy.js'

type El = (tag: string, attrs?: Record<string, string>) => HTMLElement

export interface SettingsCategories {
    root: HTMLElement
    /** Where a category's content goes. */
    bodies: Record<SettingsCategoryId, HTMLElement>
    /** The folds themselves, for a listener on their opening. */
    folds: Record<SettingsCategoryId, HTMLDetailsElement>
}

export function createSettingsCategories(el: El): SettingsCategories {
    const root = el('div', { class: 'lh-categories' })
    const bodies = {} as Record<SettingsCategoryId, HTMLElement>
    const folds = {} as Record<SettingsCategoryId, HTMLDetailsElement>
    for (const category of SETTINGS_CATEGORIES) {
        const fold = el('details', { class: 'lh-category', 'data-lh-category': category.id }) as HTMLDetailsElement
        const summary = el('summary')
        const icon = el('span', { class: 'lh-card-icon', 'aria-hidden': 'true' })
        icon.textContent = category.icon
        const title = el('span', { class: 'lh-category-title' })
        title.textContent = category.title
        summary.append(icon, title, el('span', { class: 'lh-chevron', 'aria-hidden': 'true' }))
        // The intro box and the Quick Start Guide (63d), as Multihog's World Progression tab opens.
        const copy = CATEGORY_COPY[category.id]
        const intro = createCategoryIntro(el, copy.intro)
        const guide = createQuickStart(el, copy.guide)
        const body = el('div', { class: 'lh-category-body' })
        fold.append(summary, intro, guide, body)
        // The Maps Guide (71a): Multihog's help page, as a second closed card under Persistent maps.
        if (category.id === 'maps') fold.insertBefore(createMapsGuide(el), body)
        root.append(fold)
        bodies[category.id] = body
        folds[category.id] = fold
    }
    return { root, bodies, folds }
}

export interface SettingsSearch {
    root: HTMLElement
    input: HTMLInputElement
    /** Filter now, with the box's text. Called on every keystroke, and by the panel after it redraws the settings. */
    apply(): void
}

/** Whether an element's words contain the query, case-blind. */
function matches(node: Element, query: string): boolean {
    return (node.textContent ?? '').toLowerCase().includes(query)
}

/**
 * The search over the categories: a row is an `.lh-row` (the binder's) or
 * anything marked `.lh-search-item` (the layout box, the cartridges, a
 * connection's row); a section whose title matches shows whole; a section
 * or a category with nothing matching inside is hidden; what matches is
 * opened. An empty box shows everything again and closes nothing.
 */
export function createSettingsSearch(el: El, categories: HTMLElement): SettingsSearch {
    const root = el('div', { class: 'lh-search' })
    const input = el('input', { type: 'search', class: 'lh-input lh-search-input', placeholder: 'Search the settings…', 'aria-label': 'Search the settings', 'data-lh-field': 'settings-search' }) as HTMLInputElement
    const note = el('span', { class: 'lh-search-note' })
    root.append(input, note)

    function apply(): void {
        const query = input.value.trim().toLowerCase()
        let shown = 0
        for (const category of Array.from(categories.querySelectorAll<HTMLDetailsElement>('.lh-category'))) {
            let any = false
            for (const item of Array.from(category.querySelectorAll<HTMLElement>('.lh-search-item'))) {
                const hit = !query || matches(item, query)
                item.hidden = !hit
                if (hit && query) any = true
            }
            // A card of mirrored dials (63c, 63d) shows and opens while any of its rows does; a box of
            // cards shows while any card does; with the box empty everything shows and nothing closes.
            for (const card of Array.from(category.querySelectorAll<HTMLDetailsElement>('.lh-dial-card'))) {
                const some = Array.from(card.querySelectorAll<HTMLElement>('.lh-search-item')).some((item) => !item.hidden)
                card.hidden = !!query && !some
                if (query && some) { card.open = true; any = true }
            }
            for (const box of Array.from(category.querySelectorAll<HTMLElement>('.lh-dials'))) {
                box.hidden = !!query && !Array.from(box.querySelectorAll<HTMLElement>('.lh-dial-card')).some((card) => !card.hidden)
            }
            for (const section of Array.from(category.querySelectorAll<HTMLDetailsElement>('.lh-section'))) {
                // The binder's rows, and the rows of a section drawn whole by an editor (70), which mark themselves.
                const rows = Array.from(section.querySelectorAll<HTMLElement>('.lh-row, .lh-search-item'))
                if (!query) {
                    section.hidden = false
                    for (const row of rows) row.hidden = false
                    continue
                }
                const title = section.querySelector('.lh-section-title')
                const whole = !!title && matches(title, query)
                let some = whole
                for (const row of rows) {
                    const hit = whole || matches(row, query)
                    row.hidden = !hit
                    if (hit) {
                        some = true
                        // A match inside a fold of the section (the advanced dice, 70) is shown, not just unhidden.
                        for (let fold = row.parentElement?.closest('details'); fold && fold !== section; fold = fold.parentElement?.closest('details') ?? null) fold.open = true
                    }
                }
                section.hidden = !some
                if (some) { section.open = true; any = true }
            }
            if (query) {
                category.hidden = !any
                if (any) { category.open = true; shown++ }
            } else {
                category.hidden = false
            }
        }
        // A row hidden by the search is restored by the binder's own visibility rule on its next refresh; the
        // search runs after it, so the search's word is the last. The binder hides a row its `visibleWhen` says
        // to; with the box empty that is honoured by leaving such rows to it.
        note.textContent = query ? (shown ? '' : 'Nothing matches.') : ''
    }

    input.addEventListener('input', apply)
    return { root, input, apply }
}

export const CATEGORIES_CSS = `
.adventuretime-panel .lh-categories { display: flex; flex-direction: column; gap: 8px; }
.adventuretime-panel .lh-category {
    border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.35)));
    border-radius: var(--lumiverse-radius, 6px);
    padding: 6px 10px;
}
.adventuretime-panel .lh-category > summary { cursor: pointer; font-weight: 600; font-size: 1.02em; display: flex; align-items: center; gap: 8px; list-style: none; }
.adventuretime-panel .lh-category > summary::-webkit-details-marker { display: none; }
.adventuretime-panel .lh-category-title { flex: 1; }
.adventuretime-panel .lh-category[open] > summary .lh-chevron { transform: rotate(-135deg); }
.adventuretime-panel .lh-category > .lh-category-intro, .adventuretime-panel .lh-category > .lh-quickstart { margin: 6px 0 8px; }
.adventuretime-panel .lh-category-body { display: flex; flex-direction: column; gap: 8px; }
.adventuretime-panel .lh-category[hidden], .adventuretime-panel .lh-section[hidden], .adventuretime-panel .lh-search-item[hidden] { display: none; }
.adventuretime-panel .lh-search { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.adventuretime-panel .lh-search-input { flex: 1; }
.adventuretime-panel .lh-search-note { font-size: 0.8em; opacity: 0.7; }
`
