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
import { CATEGORY_COPY, createQuickStart } from './category-copy.js'
import { attachCardHelp, revealHelp } from './help-tip.js'
import { lineIcon, setCardIcon } from './icons.js'

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
        setCardIcon(icon, category.title, category.icon)
        const title = el('span', { class: 'lh-category-title' })
        title.textContent = category.title
        summary.append(icon, title, el('span', { class: 'lh-chevron', 'aria-hidden': 'true' }))
        // The Quick Start Guide (63d), as Multihog's World Progression tab opens; the intro is behind
        // the header's [?] (96), where it was an always-visible box.
        const copy = CATEGORY_COPY[category.id]
        const guide = createQuickStart(el, copy.guide)
        const body = el('div', { class: 'lh-category-body' })
        fold.append(summary, guide, body)
        attachCardHelp(el, fold, summary, title, copy.intro)
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
    // Lumiverse's SearchField look (96, finding 7): a leading icon, the box, a clear button.
    const root = el('div', { class: 'lh-search' })
    const field = el('div', { class: 'lh-search-field' })
    const input = el('input', { type: 'text', class: 'lh-search-input', placeholder: 'Search settings', 'aria-label': 'Search settings', 'data-lh-field': 'settings-search', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement
    const clear = el('button', { type: 'button', class: 'lh-search-clear', 'aria-label': 'Clear the search', 'data-lh-field': 'settings-search-clear' }) as HTMLButtonElement
    clear.append(lineIcon(el, 'x'))
    clear.hidden = true
    field.append(lineIcon(el, 'search'), input, clear)
    const note = el('span', { class: 'lh-search-note', role: 'status' })
    root.append(field, note)

    function apply(): void {
        const query = input.value.trim().toLowerCase()
        clear.hidden = !input.value
        /** Whether the help behind a card's own [?] holds the query: the card then shows whole. */
        const headHelp = (card: Element): boolean => {
            const help = Array.from(card.children).find((child) => child.classList.contains('lh-help-note'))
            return !!query && !!help && matches(help, query)
        }
        let shown = 0
        for (const category of Array.from(categories.querySelectorAll<HTMLDetailsElement>('.lh-category'))) {
            // A category's own help is general and names half its cards, so it filters nothing.
            let any = false
            for (const item of Array.from(category.querySelectorAll<HTMLElement>('.lh-search-item'))) {
                const hit = !query || matches(item, query)
                item.hidden = !hit
                if (hit && query) any = true
            }
            // A card of mirrored dials (63c, 63d) shows and opens while any of its rows does; a box of
            // cards shows while any card does; with the box empty everything shows and nothing closes.
            for (const card of Array.from(category.querySelectorAll<HTMLDetailsElement>('.lh-dial-card'))) {
                const whole = headHelp(card)
                if (whole) for (const item of Array.from(card.querySelectorAll<HTMLElement>('.lh-search-item'))) item.hidden = false
                const some = whole || Array.from(card.querySelectorAll<HTMLElement>('.lh-search-item')).some((item) => !item.hidden)
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
                const whole = (!!title && matches(title, query)) || headHelp(section)
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
        note.textContent = query ? (shown ? '' : 'No settings match.') : ''
        // Help that holds the query is opened, so the row says why it matched; an empty box closes it again.
        revealHelp(categories, query)
    }

    input.addEventListener('input', apply)
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && input.value) { input.value = ''; apply() }
    })
    clear.addEventListener('click', () => { input.value = ''; apply(); input.focus() })
    return { root, input, apply }
}

export const CATEGORIES_CSS = `
.adventuretime-panel .lh-categories { display: flex; flex-direction: column; gap: 8px; }
.adventuretime-panel .lh-category {
    border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.35)));
    border-radius: var(--lumiverse-radius, 6px);
    padding: 6px 10px;
}
.adventuretime-panel .lh-category > summary { cursor: pointer; font-weight: 600; font-size: 1em; display: flex; align-items: center; gap: 8px; list-style: none; }
.adventuretime-panel .lh-category > summary .lh-chevron { margin-left: auto; }
.adventuretime-panel .lh-category > summary::-webkit-details-marker { display: none; }
.adventuretime-panel .lh-category-title { flex: 0 1 auto; min-width: 0; }
.adventuretime-panel .lh-category[open] > summary .lh-chevron { transform: rotate(45deg); }
.adventuretime-panel .lh-category > .lh-quickstart { margin: 6px 0 8px; }
.adventuretime-panel .lh-category-body { display: flex; flex-direction: column; gap: 8px; }
.adventuretime-panel .lh-category[hidden], .adventuretime-panel .lh-section[hidden], .adventuretime-panel .lh-search-item[hidden] { display: none; }
.adventuretime-panel .lh-search { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.adventuretime-panel .lh-search-field {
    display: flex; align-items: center; gap: 6px; padding: 0 8px;
    background: var(--lh-accent-bg, var(--lumiverse-fill-subtle, rgba(127,127,127,0.08)));
    border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.3)));
    border-radius: 10px;
}
.adventuretime-panel .lh-search-field:focus-within { border-color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
.adventuretime-panel .lh-search-field > .lh-icon { opacity: 0.6; }
.adventuretime-panel .lh-search-field input.lh-search-input { flex: 1; min-width: 0; background: none; border: 0; outline: none; padding: 7px 0; font: inherit; color: inherit; }
.adventuretime-panel .lh-search-clear { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 28px; height: 28px; min-width: 28px; padding: 0; background: none; border: 0; border-radius: 50%; color: inherit; opacity: 0.6; cursor: pointer; }
.adventuretime-panel .lh-search-clear:hover, .adventuretime-panel .lh-search-clear:focus-visible { opacity: 1; }
.adventuretime-panel .lh-search-clear[hidden] { display: none; }
.adventuretime-panel .lh-search-note:empty { display: none; }
.adventuretime-panel .lh-search-note { font-size: 0.8em; opacity: 0.7; }
/* The look (96, stage 2g). Two levels of chrome (finding 27): a category is a header over a divider, a card is a border, and a card inside a card is a divider, never a box in a box. */
.adventuretime-panel .lh-categories { gap: 0; }
.adventuretime-panel .lh-categories .lh-category { border: 0; border-bottom: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.35))); border-radius: 0; padding: 8px 2px; }
.adventuretime-panel .lh-categories .lh-category[open] > summary { margin-bottom: 6px; }
.adventuretime-panel .lh-categories .lh-quickstart > summary { background: var(--lh-card-header, rgba(127,127,127,0.08)); border-color: transparent; }
.adventuretime-panel .lh-categories .lh-card .lh-card { border: 0; border-top: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.3))); border-radius: 0; background: none; }
.adventuretime-panel .lh-categories .lh-card .lh-card > summary { background: none; padding-left: 0; padding-right: 0; border-radius: 0; }
.adventuretime-panel .lh-categories .lh-card .lh-card > :not(summary) { margin-left: 0; margin-right: 0; }
/* One caption for every group label inside a card (finding 16). */
.adventuretime-panel .lh-categories :is(.lh-quickstart-misc-label, .lh-core-caption, .lh-developer-caption, .lh-developer-subhead, .lh-map-theme-group, .lh-nc-subtitle, .lh-caption) { font-size: 0.72em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.7; }
/* Three buttons (finding 14): the default, the small one for rows inside lists and for secondary actions, and danger; an icon-only button is a 28 px square. */
.adventuretime-panel .lh-categories :is(.lh-button--quiet, .lh-reset, .lh-tm-edit, .lh-tm-move, .lh-sec-arrows .lh-button) { font-size: 0.8em; padding: 2px 8px; }
.adventuretime-panel .lh-categories :is(.lh-tm-move, .lh-sec-arrows .lh-button, .lh-sec-head .lh-sec-remove) { min-width: 28px; min-height: 28px; padding: 0 6px; }
.adventuretime-panel .lh-categories .lh-sec-remove { color: var(--lumiverse-danger, #d9534f); }
.adventuretime-panel .lh-card-foot-warning { flex: 1 1 auto; min-width: 0; font-size: 0.8em; line-height: 1.4; }
`
