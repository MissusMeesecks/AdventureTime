/**
 * The font sizes (Phase 74e, departure 81): Multihog's *Tracker Font Size*
 * and *Agent Font Size*, 8 to 32 px, as two tokens on the body and a class
 * on each root.
 *
 * Multihog sets `--rt-base-size` on its panel and on its agent panel, and
 * the panel's rule reads it as its font size. AdventureTime's roots are the
 * tracker's (the tracker widget, the play tab, the one classic tab, and
 * the cards under the messages) and the second box's (the map, scene and
 * relationships widget, and the settings tab — Multihog's *agent* size
 * names its detached agent panel, which AdventureTime does not have, and the
 * second box is the nearest thing). Each root carries one of two classes;
 * the two sizes are custom properties on the body, as the theme's class
 * is (74a), so one write reaches every root; a root whose size is unset
 * keeps the host's, which is the look before the pass.
 */
import { FONT_SIZE_MAX, FONT_SIZE_MIN, readFontSize } from '../protocol.js'

export { FONT_SIZE_MAX, FONT_SIZE_MIN, readFontSize }

export type FontSizeBox = 'tracker' | 'settings'

/** The class a root carries for its box. */
export function fontSizeClass(box: FontSizeBox): string {
    return `lh-size-${box}`
}

/** The token a box's size is written to on the body. */
export function fontSizeToken(box: FontSizeBox): string {
    return `--lh-size-${box}`
}

/**
 * Marks a root as a box's: the widget around it when it is a widget's body
 * (the head and the strip must scale with the cards), else the root itself.
 */
export function sizeRoot(root: Element, box: FontSizeBox): void {
    const target = root.closest('.lh-widget') ?? root
    for (const other of ['tracker', 'settings'] as const) if (other !== box) target.classList.remove(fontSizeClass(other))
    target.classList.add(fontSizeClass(box))
}

/** Writes the two sizes on the body: a number in px, 0 or unset taking the token off (the host's size). */
export function applyFontSizes(body: HTMLElement, sizes: { tracker?: unknown; settings?: unknown }): void {
    for (const box of ['tracker', 'settings'] as const) {
        if (sizes[box] === undefined) continue
        const size = readFontSize(sizes[box])
        if (size > 0) body.style.setProperty(fontSizeToken(box), `${size}px`)
        else body.style.removeProperty(fontSizeToken(box))
    }
}

/** What a size reads as beside its slider. */
export function fontSizeLabel(size: number): string {
    return size > 0 ? `${size}px` : 'the host’s'
}

/** The two rules: a root's font size is its box's token, the host's when unset. */
export const FONT_SIZE_CSS = `
/* The font sizes (74e): a box's root takes its token; unset, it keeps the host's size. */
.lh-size-tracker { font-size: var(--lh-size-tracker, inherit); }
.lh-size-settings { font-size: var(--lh-size-settings, inherit); }
.adventuretime-panel .lh-font-size-row { display: flex; align-items: center; gap: 8px; }
.adventuretime-panel .lh-font-size-row > span:first-child { flex: 0 0 auto; }
.adventuretime-panel .lh-font-size-row input[type="range"] { flex: 1 1 6em; min-width: 4em; cursor: pointer; }
.adventuretime-panel .lh-font-size-value { flex: 0 0 5.5em; font-weight: 600; opacity: 0.8; text-align: right; font-variant-numeric: tabular-nums; }
`
