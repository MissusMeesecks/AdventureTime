/**
 * The backdrops (Phase 74d, departure 81): Multihog's optional art behind
 * its two panels, with a tint over it and a night image swapped in from
 * the clock.
 *
 * Multihog keeps a day image, a night image and a tint strength per panel —
 * the State Tracker's and the detached Lorebook Agent's — as data URLs in
 * its settings, and `panel-appearance.js` puts a class and three custom
 * properties on each panel: the art is the panel's `::before`, the tint its
 * `::after`, the tint's colour the day/night phase's when the cycle is on,
 * and the night image shows during the night phases whether the cycle is
 * on or not. The three functions it does that with are sliced into the
 * nineteenth generated file and used here as they are: `getPanelBgConfig`
 * (each image falling to the other, the strength 0–100 to 0–1, 55 by
 * default), `cssUrlFromImageSrc`, and `scalePanelBackgroundImage` (the
 * longer side to 1280 px, as a JPEG, before storing).
 *
 * AdventureTime's two boxes are the tracker's (the tracker widget, the play tab,
 * the one classic tab) and the second (the map, scene and relationships
 * widget; the settings tab), the font sizes' two (74e). The images go
 * through the host's image store, as the portraits do, and the preference
 * holds the host's address, not the bytes (the plan's decision: a
 * preferences file that carries four JPEGs is read on every request). The
 * art and the tint are pseudo-elements of the box's root at negative
 * z-index inside an isolated stacking context, so no child needs a z-index
 * of its own, and a themed panel inside a widget goes transparent so the
 * widget's art shows through it.
 */
import { LEGACY_DAY_NIGHT, cssUrlFromImageSrc, getPanelBgConfig, scalePanelBackgroundImage } from './themes-legacy.js'
import { DEFAULT_BACKDROP_STRENGTH, readBackdrop, type Backdrop } from '../protocol.js'
import { resolvePortraitSrc } from '../tracker/portraits.js'
import { DAY_NIGHT_CLASS, MOON_PHASES, phaseClass } from './day-night.js'

export { DEFAULT_BACKDROP_STRENGTH, readBackdrop, type Backdrop }

export type BackdropBox = 'tracker' | 'settings'

/** The preference each box reads. */
export const BACKDROP_PREF: Record<BackdropBox, 'trackerBackdrop' | 'settingsBackdrop'> = { tracker: 'trackerBackdrop', settings: 'settingsBackdrop' }

/** The legacy's key names, over AdventureTime's preference shape. */
export const BACKDROP_KEYS = { dayKey: 'day', nightKey: 'night', strengthKey: 'strength' }

/** The class a box with an image wears — Multihog's `rt-has-bg-image`. */
export const BACKDROP_CLASS = 'lh-backdrop'

/** The attribute that marks a box's root with its box. */
export const BACKDROP_ATTR = 'data-lh-backdrop'

/** What a box draws: the legacy's rule, each address checked as a portrait's is. */
export interface BackdropConfig {
    day: string
    night: string
    /** 0 to 1. */
    strength: number
    hasImage: boolean
}

/** The legacy's `getPanelBgConfig` over a preference, with each address resolved as the portraits' are (a scheme the renderer refuses draws nothing). */
export function backdropConfig(backdrop: Backdrop | null | undefined): BackdropConfig {
    const config = getPanelBgConfig(readBackdrop(backdrop) as unknown as Record<string, unknown>, BACKDROP_KEYS)
    const day = resolvePortraitSrc(config.daySrc)
    const night = resolvePortraitSrc(config.nightSrc)
    return { day, night, strength: config.strength, hasImage: config.hasImage && !!(day || night) }
}

/** The element a box's backdrop goes on: the widget around a widget's body, else the root itself — the font sizes' rule (74e). */
export function backdropRoot(root: Element, box: BackdropBox): Element {
    const target = root.closest('.lh-widget') ?? root
    target.setAttribute(BACKDROP_ATTR, box)
    return target
}

/** Puts a backdrop on an element, or takes it off — Multihog's `applyPanelBackgroundToElement`. */
export function applyBackdrop(element: HTMLElement, backdrop: Backdrop | null | undefined): BackdropConfig {
    const config = backdropConfig(backdrop)
    element.classList.toggle(BACKDROP_CLASS, config.hasImage)
    if (config.hasImage) {
        element.style.setProperty('--lh-backdrop', cssUrlFromImageSrc(config.day))
        element.style.setProperty('--lh-backdrop-night', cssUrlFromImageSrc(config.night))
        element.style.setProperty('--lh-backdrop-strength', String(config.strength))
    } else {
        element.style.removeProperty('--lh-backdrop')
        element.style.removeProperty('--lh-backdrop-night')
        element.style.removeProperty('--lh-backdrop-strength')
    }
    return config
}

/** Puts each box's backdrop on every root marked for it — Multihog's `applyPanelBackgroundToDom` over the roots the panel marked, attached to the page or not yet. */
export function applyBackdrops(roots: Iterable<Element>, prefs: { trackerBackdrop?: unknown; settingsBackdrop?: unknown }): void {
    for (const element of roots) {
        const box = element.getAttribute(BACKDROP_ATTR)
        if ((box !== 'tracker' && box !== 'settings') || !(element instanceof HTMLElement)) continue
        applyBackdrop(element, readBackdrop(prefs[BACKDROP_PREF[box]] ?? null))
    }
}

/**
 * An uploaded image scaled as Multihog scales it before it is stored, the
 * longer side to 1280 px as a JPEG — or the image as it came, where the
 * page has no canvas to draw on (a test's document), or when the drawing
 * fails (an image the browser cannot decode; the host's store then says
 * what it will not take).
 */
export async function scaleBackdropImage(dataUrl: string): Promise<string> {
    try {
        if (typeof document === 'undefined' || !document.createElement('canvas').getContext('2d')) return dataUrl
        return await scalePanelBackgroundImage(dataUrl)
    } catch {
        return dataUrl
    }
}

/** The stylesheet: the art and the tint behind each box's root, the night swap, the phase's tint colours, and the settings rows. */
export function buildBackdropCss(): string {
    const overlays = (LEGACY_DAY_NIGHT as { overlays: Record<string, string> }).overlays
    const night = MOON_PHASES.map((phase) => `.${phaseClass(phase)} .${BACKDROP_CLASS}::before`).join(',\n')
    const scrims = Object.entries(overlays).map(([phase, colour]) => `.${DAY_NIGHT_CLASS}.${phaseClass(phase)} .${BACKDROP_CLASS} { --lh-backdrop-scrim: ${colour}; }`).join('\n')
    return `/* The backdrops (74d): Multihog's art behind a panel, its ::before; the tint its ::after; both behind the content. */
.${BACKDROP_CLASS} { --lh-backdrop-scrim: rgba(18, 18, 24, 0.72); --lh-backdrop-strength: 0.55; position: relative; isolation: isolate; background-color: transparent !important; background-image: none !important; }
.${BACKDROP_CLASS}::before { content: ''; position: absolute; inset: 0; z-index: -2; pointer-events: none; border-radius: inherit; background-image: var(--lh-backdrop, none); background-size: cover; background-position: center; background-repeat: no-repeat; transition: opacity 2s ease, filter 2s ease; }
${night} { background-image: var(--lh-backdrop-night, none); }
.${BACKDROP_CLASS}::after { content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none; border-radius: inherit; background: var(--lh-backdrop-scrim); opacity: var(--lh-backdrop-strength); transition: background 2s ease, opacity 2s ease; }
/* A themed panel inside a widget with art goes clear, and its blur would blur the art. */
.lh-widget.${BACKDROP_CLASS} .adventuretime-panel { background: transparent !important; backdrop-filter: none !important; }
${scrims}
/* The settings rows: a preview, Upload and Clear, the address, the night's row, the strength. */
.adventuretime-panel .lh-backdrops { display: flex; flex-direction: column; gap: 8px; }
.adventuretime-panel .lh-backdrop-box { border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25))); border-radius: var(--lumiverse-radius, 6px); padding: 8px; background: var(--lh-card-bg, rgba(127,127,127,0.04)); display: flex; flex-direction: column; gap: 6px; }
.adventuretime-panel .lh-backdrop-title { font-weight: 600; font-size: 0.9em; }
.adventuretime-panel .lh-backdrop-row { display: flex; gap: 10px; align-items: flex-start; flex-wrap: wrap; }
.adventuretime-panel .lh-backdrop-preview { width: 72px; height: 48px; border-radius: 6px; border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(255,255,255,0.15))); background: rgba(0,0,0,0.35) center/cover no-repeat; flex-shrink: 0; }
.adventuretime-panel .lh-backdrop-preview--night { border-style: dashed; border-color: rgba(136,153,255,0.35); background-color: rgba(8,10,28,0.5); }
.adventuretime-panel .lh-backdrop-fields { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 140px; }
.adventuretime-panel .lh-backdrop-buttons { display: flex; gap: 4px; flex-wrap: wrap; }
.adventuretime-panel .lh-backdrop-url { width: 100%; box-sizing: border-box; font-size: 0.85em; }
.adventuretime-panel .lh-backdrop-slot { font-size: 0.78em; opacity: 0.7; }
.adventuretime-panel .lh-backdrop-strength { display: flex; align-items: center; gap: 8px; font-size: 0.85em; }
.adventuretime-panel .lh-backdrop-strength input[type="range"] { flex: 1; cursor: pointer; }
.adventuretime-panel .lh-backdrop-strength-value { font-weight: bold; opacity: 0.8; min-width: 3em; text-align: right; }
.adventuretime-panel .lh-backdrop-note { font-size: 0.85em; opacity: 0.85; min-height: 1.2em; }
.adventuretime-panel .lh-backdrop-note--error { color: var(--lumiverse-danger, #d9534f); opacity: 1; }
`
}

/** The stylesheet, built once. */
export const BACKDROP_CSS = buildBackdropCss()
