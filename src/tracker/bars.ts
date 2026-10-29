/**
 * What the user has decided about one bar.
 *
 * Every bar the renderer draws already carries a `data-rt-bar-id` — a stable
 * identity built from its block, its entity and its label — put there in Phase
 * 1a precisely so this layer could attach later without reworking a renderer.
 * This is that layer, in Multihog's own shape since 74i: the config its
 * recolour popup writes under `barColors[barId]` — a mode (solid, gradient,
 * dynamic), the colour and the gradient's second colour, the percentage
 * readout and the change animation — read back by the legacy's own resolver,
 * sliced from the pin into `bars-legacy.js`.
 *
 * None of it changes what the tracker stores or what the model is told, which
 * is why it lives in `ui-prefs.json` beside the message-card switch rather
 * than in the cartridge — a property of this install, not of the campaign.
 */

import { createBarColorsLegacy } from '../frontend/bars-legacy.js'
import type { TrackerLine } from './lines.js'
import type { TrackerView } from './view.js'

export type BarMode = 'solid' | 'gradient' | 'dynamic'

/** The legacy's per-bar config, as `handleRecolor` writes it. */
export interface BarPref {
    /** Solid (the default), a two-colour gradient, or the HP thresholds whatever the colours say. */
    mode?: BarMode
    /** A hex colour to fill with, `#rgb` or `#rrggbb`. */
    color?: string
    /** The gradient's second colour. */
    color2?: string
    /** Read the value as a percentage rather than as its own numbers. */
    showAsPercentage?: boolean
    /** Show gains and losses on this bar as they land (74h). */
    animateChanges?: boolean
}

export type BarPrefs = Record<string, BarPref>

const MODES: ReadonlySet<string> = new Set(['solid', 'gradient', 'dynamic'])

/**
 * Whether a colour is safe to put in an inline `style`.
 *
 * Hex only. The value reaches the renderer from a file a user can edit and is
 * interpolated straight into a `style` attribute, so the alternative is
 * deciding which of CSS's several hundred colour syntaxes are harmless — and
 * `url(...)`, `expression(...)` and a stray `;` are all colour syntax as far as
 * a lenient check is concerned. A colour picker produces `#rrggbb` anyway.
 */
export function isBarColor(value: unknown): value is string {
    return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())
}

/**
 * Read one bar's preference back defensively, dropping what cannot be used.
 *
 * Takes the legacy's shape (`mode`, `color`, `color2`, `showAsPercentage`,
 * `animateChanges`), its older bare colour string, and the names AdventureTime
 * stored before 74i (`percent`, `animate`), so no install loses a choice on
 * the way across. A mode needs a colour to mean anything but `dynamic`.
 */
export function readBarPref(value: unknown): BarPref | null {
    if (isBarColor(value)) return { mode: 'solid', color: value.trim().toLowerCase() }
    if (!value || typeof value !== 'object') return null

    const source = value as Record<string, unknown>
    const pref: BarPref = {}
    if (isBarColor(source.color)) pref.color = source.color.trim().toLowerCase()
    if (isBarColor(source.color2)) pref.color2 = source.color2.trim().toLowerCase()
    if (typeof source.mode === 'string' && MODES.has(source.mode) && (source.mode === 'dynamic' || pref.color)) pref.mode = source.mode as BarMode
    if (source.showAsPercentage === true || source.percent === true) pref.showAsPercentage = true
    if (source.animateChanges === true || source.animate === true) pref.animateChanges = true

    // A preference that says nothing is the same as not having one, and keeping
    // it would grow the file with entries that change no pixel.
    return pref.mode || pref.color || pref.showAsPercentage || pref.animateChanges ? pref : null
}

/** Read a whole stored map, dropping the entries that say nothing. */
export function readBarPrefs(value: unknown): BarPrefs {
    const prefs: BarPrefs = {}
    if (!value || typeof value !== 'object') return prefs

    for (const [barId, pref] of Object.entries(value as Record<string, unknown>)) {
        if (!barId) continue
        const read = readBarPref(pref)
        if (read) prefs[barId] = read
    }
    return prefs
}

/** The preference for one bar, or an empty one. */
export function barPrefFor(prefs: BarPrefs | null | undefined, barId: string | null | undefined): BarPref {
    if (!prefs || !barId) return {}
    return prefs[barId] ?? {}
}

/**
 * The legacy's resolver, run over one bar's preference at a time: its
 * `getSettings()` reads a holder this face points at the preference before
 * each call, so the sliced code runs unchanged.
 */
const holder: { barColors: Record<string, BarPref> } = { barColors: {} }
const legacy = createBarColorsLegacy({ getSettings: () => holder })

function point(pref: BarPref | null | undefined, barId: string): void {
    holder.barColors = pref && Object.keys(pref).length > 0 ? { [barId]: pref } : {}
}

/**
 * The fill a bar draws with, Multihog's `getBarBackground`: the stored
 * config's solid colour, its gradient, or the HP thresholds for `dynamic`;
 * with no config, the default handed in — except an HP bar's `#00ffaa`, which
 * the thresholds colour by `pct` (an explicit marker colour passes through).
 */
export function barBackground(pref: BarPref | null | undefined, barId: string, defaultBackground: string, pct: number | null = null): string {
    // A config holding only the ticks has no colour for the legacy to return
    // (its popup never writes one; a config read across from before 74i can
    // be one), so it takes the no-config path: the default, or the HP thresholds (74i-bis).
    const coloured = !!pref && (pref.mode === 'dynamic' || !!pref.color)
    point(coloured ? pref : null, barId)
    return String(legacy.getBarBackground(barId, defaultBackground, pct))
}

/** Whether the bar reads as a percentage, the legacy's `getBarShowAsPercentage`. */
export function barShowsPercentage(pref: BarPref | null | undefined, barId: string): boolean {
    point(pref, barId)
    return legacy.getBarShowAsPercentage(barId) === true
}

/** Whether the bar animates its changes, the legacy's `getBarAnimateChanges`. */
export function barAnimates(pref: BarPref | null | undefined, barId: string): boolean {
    point(pref, barId)
    return legacy.getBarAnimateChanges(barId) === true
}

/** One bar the user could have an opinion about. */
export interface BarHandle {
    barId: string
    /** What to call it in an editor: its own label, or its entity's name. */
    label: string
    /** The block it lives in, so two `Charges` bars can be told apart. */
    tag: string
}

/** A marker label as an editor should show it: no trailing colon, never blank. */
function barLabel(label: string): string {
    return label.replace(/:\s*$/, '').trim() || 'Bar'
}

/**
 * Every bar in a view, in the order they are drawn.
 *
 * Here rather than in the panel because it is a fact about the view model:
 * anything that wants to enumerate bars — a legend or an export — should
 * agree on what counts as one. The import is type-only, so `view.ts`
 * importing this module back is not a cycle at runtime.
 */
export function collectBars(view: TrackerView): BarHandle[] {
    const handles: BarHandle[] = []
    const seen = new Set<string>()

    const add = (barId: string | undefined, label: string, tag: string): void => {
        if (!barId || seen.has(barId)) return
        seen.add(barId)
        handles.push({ barId, label, tag })
    }

    const addLines = (lines: TrackerLine[], tag: string, prefix: string): void => {
        for (const line of lines) {
            if (line.kind !== 'markers') continue
            for (const segment of line.segments) add(segment.barId, `${prefix}${barLabel(segment.label)}`, tag)
        }
    }

    for (const block of [...view.blocks, ...(view.benchedParty ? [view.benchedParty] : [])]) {
        // Follow the renderer's own precedence — quests, then entities, then
        // plain lines — because a block's `lines` are always parsed but only
        // drawn when neither second grammar read it.
        if (!block.entities && !block.quests) addLines(block.lines, block.tag, '')

        for (const token of block.entities?.tokens ?? []) {
            if (token.kind !== 'entity') continue
            add(token.entity.hp?.barId, `${token.entity.name} · HP`, block.tag)
            addLines(token.entity.lines, block.tag, `${token.entity.name} · `)
        }
    }

    return handles
}
