/**
 * The `[?]` (Phase 96, the settings pane cleanup; `docs/settings-audit.md`,
 * part C): one component for every piece of help in the settings pane. A
 * small button after a label, and the help as a block under the row, in the
 * row's own DOM from the first paint and hidden until the button is pressed.
 *
 * Inline, not a popover, by the maintainer's answer of 2026-11-15: a block in
 * the flow cannot clip at the pane's edge, needs no placing against the
 * host's drawer, widgets or modal, is read in place by a screen reader, and
 * is found by the settings search as it stands, since the search reads each
 * row's text.
 *
 * Nothing depends on hover. Click, tap, Enter and Space toggle it; Escape
 * closes it while the button has focus. Opening one closes no other, and the
 * open state is not kept.
 */

import { lineIcon } from './icons.js'

type El = (tag: string, attrs?: Record<string, string>) => HTMLElement

export interface HelpTip {
    /** The `[?]`: goes directly after the label's text. */
    button: HTMLButtonElement
    /** The help: goes under the row, or as the first line of a card's body. */
    note: HTMLElement
}

let sequence = 0
const buttons = new WeakMap<HTMLElement, HTMLButtonElement>()

function setOpen(note: HTMLElement, open: boolean): void {
    note.hidden = !open
    buttons.get(note)?.setAttribute('aria-expanded', open ? 'true' : 'false')
}

/**
 * @param label the control's or the card's visible name, for the button's screen-reader name
 * @param text the help; a line break in it is kept, so a short numbered list reads as one
 * @param onOpen called before the help is shown by a press: a card's header opens its card with it
 */
export function createHelpTip(el: El, label: string, text: string, onOpen?: () => void): HelpTip {
    const id = `lh-help-${++sequence}`
    const button = el('button', { type: 'button', class: 'lh-help-tip', 'aria-label': `Help: ${label}`, 'aria-expanded': 'false', 'aria-controls': id }) as HTMLButtonElement
    button.append(lineIcon(el, 'circle-help'))
    const note = el('div', { class: 'lh-help-note', role: 'note', id })
    note.textContent = text
    note.hidden = true
    buttons.set(note, button)

    button.addEventListener('click', (event) => {
        // Inside a <summary> a click would fold the card, and inside a <label> tick its box.
        event.preventDefault()
        event.stopPropagation()
        const open = note.hidden
        // A press is the user's word: what the search opened is theirs to keep or close from here.
        delete note.dataset.lhBySearch
        if (open) onOpen?.()
        setOpen(note, open)
    })
    button.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !note.hidden) {
            event.stopPropagation()
            delete note.dataset.lhBySearch
            setOpen(note, false)
        }
        // Space on a button inside a <summary> would otherwise toggle the fold on keyup in some browsers.
        if (event.key === ' ' || event.key === 'Enter') event.stopPropagation()
    })
    button.addEventListener('keyup', (event) => {
        if (event.key === ' ') event.stopPropagation()
    })
    return { button, note }
}

/**
 * A card's `[?]`: after the title in its header, the help as the first line
 * of its body. A press opens the card if it is closed and never folds it.
 */
export function attachCardHelp(el: El, card: HTMLDetailsElement, summary: HTMLElement, title: HTMLElement, text: string): HelpTip {
    const tip = createHelpTip(el, title.textContent ?? '', text, () => { card.open = true })
    title.after(tip.button)
    summary.after(tip.note)
    return tip
}

/**
 * A row that is a `<label>` around a tick, with help: the button may not go
 * inside the label (a press would be the label's), so the row and its `[?]`
 * share a line and the help stands under them.
 */
export function withHelp(el: El, row: HTMLElement, label: string, text: string): HTMLElement {
    const tip = createHelpTip(el, label, text)
    const line = el('div', { class: 'lh-helped-line' })
    line.append(row, tip.button)
    const wrap = el('div', { class: 'lh-helped' })
    wrap.append(line, tip.note)
    return wrap
}

/** A row whose label is one of its children: the `[?]` directly after that child, the help under the row. */
export function helpAfter(el: El, row: HTMLElement, anchor: HTMLElement, label: string, text: string): HTMLElement {
    const tip = createHelpTip(el, label, text)
    anchor.after(tip.button)
    const wrap = el('div', { class: 'lh-helped' })
    wrap.append(row, tip.note)
    return wrap
}

/**
 * The search's one addition: help that holds the query is opened, so the user
 * sees why its row matched; an empty box closes what the search opened and
 * nothing the user opened by hand.
 */
export function revealHelp(root: ParentNode, query: string): void {
    for (const note of Array.from(root.querySelectorAll<HTMLElement>('.lh-help-note'))) {
        if (query && (note.textContent ?? '').toLowerCase().includes(query)) {
            if (note.hidden) {
                note.dataset.lhBySearch = '1'
                setOpen(note, true)
            }
        } else if (note.dataset.lhBySearch) {
            delete note.dataset.lhBySearch
            setOpen(note, false)
        }
    }
}

/**
 * The button is a 14 px icon in a 28 px hit area, pulled back by its margin so
 * a label's line keeps its height. The note is hidden by a rule of its own:
 * a display set elsewhere beats the browser's `[hidden]` (lesson 60).
 */
export const HELP_TIP_CSS = `
.adventuretime-panel .lh-help-tip {
    display: inline-flex; align-items: center; justify-content: center; flex: none;
    width: 28px; height: 28px; min-width: 28px; margin: -7px 0 -7px -2px; padding: 0;
    background: none; border: 0; border-radius: 50%;
    color: inherit; opacity: 0.5; cursor: pointer; vertical-align: middle;
}
.adventuretime-panel .lh-help-tip:hover, .adventuretime-panel .lh-help-tip:focus-visible, .adventuretime-panel .lh-help-tip[aria-expanded="true"] { opacity: 1; color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
.adventuretime-panel .lh-help-tip:focus-visible { outline: 2px solid var(--lh-accent, var(--lumiverse-primary, #d4a940)); outline-offset: -4px; }
.adventuretime-panel .lh-help-note {
    flex: 1 1 100%; box-sizing: border-box; min-width: 0;
    font-size: 0.8em; font-weight: normal; line-height: 1.45; text-align: left; white-space: pre-line; overflow-wrap: anywhere;
    color: var(--lh-text-muted, inherit); opacity: 0.85;
    margin: 4px 0 6px; padding: 2px 0 2px 8px;
    border-left: 2px solid var(--lh-accent, var(--lumiverse-primary, #d4a940));
    cursor: default;
}
.adventuretime-panel .lh-help-note[hidden] { display: none; }
.adventuretime-panel .lh-helped { display: flex; flex-direction: column; min-width: 0; }
.adventuretime-panel .lh-helped[hidden] { display: none; }
.adventuretime-panel .lh-helped-line { display: flex; align-items: center; gap: 4px; min-width: 0; }
.adventuretime-panel .lh-helped-line > :first-child { flex: 0 1 auto; min-width: 0; }
`
