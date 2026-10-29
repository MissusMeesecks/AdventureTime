/**
 * One memo line, parsed into a value.
 *
 * This module is the departure from the legacy build. There, a line went
 * straight to HTML: `tryRenderMarker` tokenized, normalised, split label from
 * value, chose a layout and emitted markup in one pass, so nothing about a
 * line could be asserted without asserting on a `<div>`. Here that pass stops
 * at a typed line, and `render.ts` turns typed lines into markup.
 *
 * The *behaviour* is still the legacy behaviour, quirks included — the awkward
 * "where was the marker on the line?" reconstruction below is ported, not
 * invented, because authored modules put markers in all three positions and
 * each position already means something.
 */

import { barAnimates, barPrefFor, barShowsPercentage, type BarPref, type BarPrefs } from './bars.js'
import { parseHitDice, parseSpellBlockLine, parseSpellGroups, type SpellGroup } from './spells.js'
import {
    resolveMarkerTabStops,
    tokenizeMarkers,
    type MarkerRenderType,
    type MarkerSegment,
} from './markers.js'

/** Render types that draw a filled bar, and so split their value into a fraction. */
export const PROGRESSION_RENDER_TYPES = new Set<MarkerRenderType>([
    'barrel',
    'hp_bar',
    'xp_bar',
    'progress',
    'clock',
    'stars',
    'weight',
    'orbs',
    'slots',
    'phase',
    'gauge',
    'charge',
])

/** Render types that sit at their natural width rather than filling the row. */
const COMPACT_RENDER_TYPES = new Set<MarkerRenderType>(['pills', 'pill_colored', 'badge', 'badge_colored'])

export interface ParsedSegment {
    renderType: MarkerRenderType
    /** The marker name as written, upper-cased — `BAR` for `((BARRED))`. */
    markerType: string
    color?: string
    positiveColor?: string
    negativeColor?: string
    icon?: string
    /** The label, with its trailing colon, or `''` when the line has none. */
    label: string
    /** Everything after the label. */
    value: string
    /** Column span in percent of the row, when the row uses `|N` tab stops. */
    span?: { start: number; end: number }
    /**
     * A stable identity for a bar within its block.
     *
     * The panel keys per-bar state off this — a user-chosen colour, whether the
     * bar reads as a percentage. Two bars labelled "Charges" on different rows
     * must not share one, which is what the row context below is for.
     */
    barId?: string
    /**
     * Draw the readout as a percentage rather than as its own numbers.
     *
     * Set from the user's per-bar preference. The renderer already has the
     * percentage — it draws the bar's width with it — so this is a choice about
     * wording rather than a second calculation.
     */
    percentLabel?: boolean
    /**
     * The user's choices for this bar (74i), for the renderer to resolve the
     * fill through the legacy's resolver; a barrel keeps its two halves'.
     */
    barPref?: BarPref
    barrelPrefs?: { positive: BarPref; negative: BarPref }
    /**
     * Show gains and losses on this bar as they land (74h): the bar's own
     * choice, or the switch for every custom `((BAR))` and `((BARREL))`, as
     * the legacy's renderer decides it. The renderer writes it beside the
     * value so the panel can compare a redraw to the one before.
     */
    animate?: boolean
}

/** How a multi-marker row is laid out. */
export type MarkerRowLayout = 'single' | 'row' | 'columns' | 'tab-stops'

export type TrackerLine =
    | { kind: 'markers'; segments: ParsedSegment[]; layout: MarkerRowLayout; compactPills: boolean }
    /**
     * A `Key: value` pair. `rule` is set only on a line hanging off an entity
     * (40): how the legacy's entity-context renderer draws that label's value.
     * Absent, the entity renderer highlights the parentheses, as it always did.
     */
    | { kind: 'kv'; label: string; value: string; rule?: EntityFieldRule }
    | { kind: 'text'; text: string }
    /**
     * Spell slots as pips (38): one group per `[SPELLS]` line, several off an
     * entity's `Spells:` sub-line. `flat` is the sub-line's value when no group
     * was on it, drawn as pills.
     */
    | { kind: 'spells'; groups: SpellGroup[]; flat: string | null }
    /** Hit dice as pips (38): an entity's `HD: d10 (3/5)`. */
    | { kind: 'hd'; die: string; current: number; max: number }

/** How an entity's labelled sub-line is drawn: the legacy's `renderSubFieldByRule` kinds that apply to a stock label. */
export type EntityFieldRule = 'pills' | 'numbers' | 'highlight' | 'text'

/**
 * The legacy's `STOCK_FIELD_RULES` (`renderer.js`), in its order: the label a
 * line under an entity may carry, and how its value is drawn. `hd` and
 * `spells` are in the legacy table too and are read for pips (38) before this
 * table is consulted. A label not here is highlighted, as the legacy's
 * fallback for an unknown `Key: value` under an entity is.
 */
export const ENTITY_FIELD_RULES: ReadonlyArray<[label: string, rule: EntityFieldRule]> = [
    ['combat', 'numbers'],
    ['gear', 'highlight'],
    ['attr', 'highlight'],
    ['attributes', 'highlight'],
    ['skills', 'pills'],
    ['key skills', 'pills'],
    ['saves', 'numbers'],
    ['status', 'pills'],
    ['traits', 'pills'],
    ['abilities', 'pills'],
    ['other', 'pills'],
    ['resistances', 'pills'],
    ['res', 'pills'],
    ['weapon', 'highlight'],
    ['att/def', 'numbers'],
    ['primary weapon', 'highlight'],
    ['ac', 'text'],
]

/** The rule for a label under an entity, or `undefined` for the fallback. The legacy matches `label:` at the line's start, case-insensitively. */
export function entityFieldRule(label: string): EntityFieldRule | undefined {
    const wanted = label.trim().toLowerCase()
    return ENTITY_FIELD_RULES.find(([key]) => key === wanted)?.[1]
}

export interface LineContext {
    /** The block this line belongs to, e.g. `WAYSTONE`. Part of every barId. */
    tag: string
    /** The entity a line hangs off in COMBAT/PARTY blocks. Empty elsewhere. */
    entityName?: string
    /** Position in the block. Disambiguates bars where there is no entity. */
    lineIndex?: number | null
    /** What the user decided about the bars in this block, keyed by bar id. */
    bars?: BarPrefs
    /** Animate changes on every custom `((BAR))` and `((BARREL))` (74h), Multihog's `animateAllCustomBarChanges`. */
    animateCustomBars?: boolean
    /**
     * The line hangs off an entity in a card (38): the `Spells:` and `HD:`
     * sub-lines are read for pips there and nowhere else, as the legacy's
     * entity-context renderer reads them.
     */
    inEntity?: boolean
}

/**
 * Rebuild `label: value` from a segment, wherever its marker sat on the line.
 *
 * Four placements, all of them in real authored modules:
 *
 *   `((GAUGE)) 75/100`                     → no label, value is everything
 *   `Durability: ((GAUGE)) 75/100`         → label already has its colon
 *   `[Epic] Sword - ((GAUGE)) 75/100`      → no colon, so one is synthesized
 *   `Durability 75/100 ((GAUGE))`          → label and value are both behind it
 *
 * The last case is the fiddly one: with the marker trailing, a progression type
 * splits "Label 75/100" on the fraction so the label survives. A non-progression
 * type keeps the whole thing as the value, because there is no reliable split.
 */
function reconstruct(segment: MarkerSegment): string {
    const cleanPre = (segment.preText || '').replace(/^[-*+•–—]\s*/, '').trim()
    const content = segment.content

    if (!cleanPre) return content.trim()

    if (content.trim()) {
        if (cleanPre.includes(':') || content.includes(':')) return `${cleanPre} ${content}`.trim()
        return `${cleanPre}: ${content}`.trim()
    }

    if (cleanPre.includes(':')) return cleanPre.trim()

    const numMatch = PROGRESSION_RENDER_TYPES.has(segment.rule.renderType)
        ? cleanPre.match(/^(.*?)\s+(\d[\d,]*\s*\/\s*\d[\d,]*.*)$/)
        : null
    if (numMatch && numMatch[1].trim()) return `${numMatch[1].trim()}: ${numMatch[2].trim()}`
    return cleanPre.trim()
}

/**
 * Split reconstructed text on its first colon.
 *
 * The label keeps its colon — that is how the legacy build drew it, and how the
 * CSS expects it. No colon means the whole line is the value.
 */
function splitLabel(text: string): { label: string; value: string } {
    const colonIdx = text.indexOf(':')
    if (colonIdx === -1) return { label: '', value: text.trim() }
    return { label: text.substring(0, colonIdx + 1).trim(), value: text.substring(colonIdx + 1).trim() }
}

function toParsedSegment(segment: MarkerSegment, rowContext: string, ctx: LineContext): ParsedSegment {
    const text = reconstruct(segment)
    const { label, value } = splitLabel(text)
    const { rule } = segment

    const parsed: ParsedSegment = {
        renderType: rule.renderType,
        markerType: segment.markerType,
        label,
        value,
    }
    if (rule.color) parsed.color = rule.color
    if (rule.positiveColor) parsed.positiveColor = rule.positiveColor
    if (rule.negativeColor) parsed.negativeColor = rule.negativeColor
    if (rule.icon) parsed.icon = rule.icon

    if (PROGRESSION_RENDER_TYPES.has(rule.renderType)) {
        // Anchored on the label rather than the value, so a bar keeps its
        // identity as its number moves.
        const labelText = text.includes(':') ? text.substring(0, text.indexOf(':')).trim() : 'Bar'
        parsed.barId = `${ctx.tag}:${ctx.entityName ?? ''}:${labelText}${rowContext ? `[${rowContext}]` : ''}`

        // The user's choices ride beside the marker's own colour: the marker
        // says what the *author* meant, and the renderer resolves what the
        // reader wants to see through the legacy's resolver (74i). A barrel's
        // halves carry their own ids, as the legacy's recolour controls do.
        const pref = barPrefFor(ctx.bars, parsed.barId)
        parsed.barPref = pref
        if (barShowsPercentage(pref, parsed.barId)) parsed.percentLabel = true
        // The legacy's rule: a bar's own tick, or the switch for the two custom markers it names.
        const customMarker = rule.renderType === 'hp_bar' || rule.renderType === 'barrel'
        if (rule.renderType === 'barrel') {
            const positive = barPrefFor(ctx.bars, `${parsed.barId}:positive`)
            const negative = barPrefFor(ctx.bars, `${parsed.barId}:negative`)
            parsed.barrelPrefs = { positive, negative }
            // The popup writes under the halves' ids, so the readout's tick is read there (74i-bis).
            if (barShowsPercentage(positive, `${parsed.barId}:positive`) || barShowsPercentage(negative, `${parsed.barId}:negative`)) parsed.percentLabel = true
            parsed.animate = barAnimates(positive, `${parsed.barId}:positive`) || barAnimates(negative, `${parsed.barId}:negative`) || ctx.animateCustomBars === true
        } else {
            parsed.animate = barAnimates(pref, parsed.barId) || (customMarker && ctx.animateCustomBars === true)
        }
    }

    return parsed
}

/**
 * Parse one line of a block.
 *
 * A line with markers becomes a marker row; a `Key: value` line becomes a kv
 * pair; anything else is plain text. Markers are tried first, so a marker in a
 * line that also looks like kv wins — which is what an author writing
 * `Attunement: ((BAR)) 640/1000` means.
 */
export function parseBlockLine(line: string, ctx: LineContext): TrackerLine {
    const segments = tokenizeMarkers(line)

    if (segments.length === 0) {
        // The pips (38), where the legacy draws them: a `[SPELLS]` line is a
        // spell row when it names a level and a list; an entity's `Spells:` is
        // rows for its groups or pills for a flat list; an entity's `HD:` with
        // a fraction is hit-dice pips. Anything else reads as it always did.
        if (ctx.tag === 'SPELLS' && !ctx.inEntity) {
            const group = parseSpellBlockLine(line)
            if (group) return { kind: 'spells', groups: [group], flat: null }
        }
        if (ctx.inEntity) {
            const sub = line.match(/^(spells|hd)\s*:\s*(.*)$/i)
            if (sub && sub[1]!.toLowerCase() === 'spells') {
                const groups = parseSpellGroups(sub[2]!.trim())
                return groups.length ? { kind: 'spells', groups, flat: null } : { kind: 'spells', groups: [], flat: sub[2]!.trim() }
            }
            if (sub) {
                const hd = parseHitDice(sub[2]!)
                if (hd) return { kind: 'hd', ...hd }
            }
        }
        const kv = line.match(/^([^:]+):\s*(.+)$/)
        // Under an entity, a stock label says how its value is drawn (40).
        if (ctx.inEntity && kv && !/^\d+$/.test(kv[1].trim())) {
            const rule = entityFieldRule(kv[1])
            return rule ? { kind: 'kv', label: kv[1].trim(), value: kv[2].trim(), rule } : { kind: 'kv', label: kv[1].trim(), value: kv[2].trim() }
        }
        // A bare number is not a key. `09:30 PM, Day 2` is the [TIME] block's
        // whole content, and reading the clock's own colon as a separator drew
        // it as `09: 30 PM, Day 2` — an hour promoted to a label, on screen
        // every single turn.
        if (kv && !/^\d+$/.test(kv[1].trim())) return { kind: 'kv', label: kv[1].trim(), value: kv[2].trim() }
        return { kind: 'text', text: line.trim() }
    }

    const usesExplicitColumns = line.includes('||')
    const usesTabStops = segments.some((segment) => segment.tabStop !== undefined)
    const compactPills = segments.length > 1 && segments.every((s) => COMPACT_RENDER_TYPES.has(s.rule.renderType))

    // With no entity to anchor to, the line's own position keeps bars on
    // different lines from collapsing onto one identity.
    const lineAnchor = !ctx.entityName && ctx.lineIndex !== null && ctx.lineIndex !== undefined ? `L${ctx.lineIndex}` : ''

    if (segments.length === 1 && !usesTabStops) {
        return {
            kind: 'markers',
            segments: [toParsedSegment(segments[0], lineAnchor, ctx)],
            layout: 'single',
            compactPills: false,
        }
    }

    // A segment's row context is its sibling's text plus its own index: the
    // sibling separates bars on different rows, the index separates two
    // identical bars on the same row.
    const segmentTexts = segments.map((s) => (s.preText ? `${s.preText} ${s.content}` : s.content).trim())
    const spans = usesTabStops ? resolveMarkerTabStops(segments) : null

    const parsed = segments.map((segment, i) => {
        const rowContext = `${segmentTexts[i === 0 ? 1 : 0] ?? ''}:${i}${lineAnchor ? `:${lineAnchor}` : ''}`
        const result = toParsedSegment(segment, rowContext, ctx)
        if (spans) result.span = spans[i]
        return result
    })

    return {
        kind: 'markers',
        segments: parsed,
        layout: usesTabStops ? 'tab-stops' : usesExplicitColumns ? 'columns' : 'row',
        compactPills,
    }
}

export interface Fraction {
    current: number
    max: number
    /** `current/max` clamped to 0–100. Zero when `max` is zero or missing. */
    percent: number
    /** The numbers as written, so "1,000" is not redrawn as "1000". */
    currentText: string
    maxText: string
    /** Whatever else was on the line, e.g. "(Harmonious)". */
    rest: string
}

/**
 * Pull an `X/Y` out of a marked value.
 *
 * Deliberately loose about what surrounds it: authored modules write
 * `640/1000 (Harmonious)`, `45/50 lbs`, and `450/1000 Level 3`, and all three
 * should draw a bar.
 */
export function parseFraction(value: string): Fraction | null {
    const m = value.match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/)
    if (!m) return null
    const current = parseInt(m[1].replace(/,/g, ''), 10)
    const max = parseInt(m[2].replace(/,/g, ''), 10)
    return {
        current,
        max,
        percent: max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0,
        currentText: m[1],
        maxText: m[2],
        rest: value.replace(m[0], '').trim(),
    }
}
