/**
 * Parsed entities, arranged for drawing.
 *
 * The same shape as `quest-view.ts`, and for the same reason: everything
 * decided here — what colour a hit-point bar is, which side a combatant is on,
 * whether a card is greyed out because its occupant is down — is a rule, and a
 * rule is worth testing without a string of HTML in the way.
 *
 * The lines that hang off an entity are run through the ordinary block-line
 * parser, so a sub-module's own markers keep working inside an entity card
 * exactly as they do outside one. That is the whole point of the layering: the
 * entity grammar says who a line belongs to, and the marker grammar says what
 * it looks like.
 */

import { parseBlockLine, type TrackerLine } from './lines.js'
import { barAnimates, barBackground, barPrefFor, barShowsPercentage, type BarPrefs } from './bars.js'
import { portraitFor } from './portraits.js'
import {
    parseEntityBlock,
    type EntityField,
    type EntityHp,
    type EntitySide,
    type EntityToken,
    type TrackerEntity,
} from './entities.js'

/** The default fill, from the legacy renderer. */
const DEFAULT_HP_COLOR = '#00ffaa'

/** Unknown hit points: a neutral bar, so it does not read as nearly dead. */
const UNKNOWN_HP_COLOR = '#6b7280'

/**
 * The bar's colour, from how hurt the entity is.
 *
 * An explicit colour on the line always wins — a sub-module author writing
 * `((BARPURPLE))` means it. Failing that: healthy above 60%, hurt above 30%,
 * and in trouble below. An entity with a current value but no maximum has no
 * ratio to colour by, so it stays the default rather than reading as full.
 */
export function hpColor(hp: EntityHp): string {
    if (hp.color) return hp.color
    if (hp.unknown) return UNKNOWN_HP_COLOR
    if (hp.maxText == null) return DEFAULT_HP_COLOR
    if (hp.percent > 60) return DEFAULT_HP_COLOR
    if (hp.percent > 30) return '#ffaa00'
    return '#ff5555'
}

export interface EntityHpView extends EntityHp {
    color: string
    /** `12/20`, or just `12` when the line gave no maximum. */
    label: string
    /** Show gains and losses as they land (74h): the bar's own tick alone, as the legacy's native HP bars. */
    animate: boolean
    /** Whether the line itself coloured the bar (an inline `((BARGREEN))`), which the recolour popup reads (74i). */
    explicitColor: boolean
}

export interface EntityCardView {
    name: string
    /**
     * The picture set for this entity, or `''`.
     *
     * Resolved here rather than in the renderer so the rule that decides it —
     * the legacy's forgiving name matching, and the check that the reference is
     * safe to put in an `src` — lives with the other view decisions and can be
     * tested without markup.
     */
    portrait: string
    hp: EntityHpView | null
    fields: EntityField[]
    /** The hanging lines, parsed — drawn by the same renderer as any other line. */
    lines: TrackerLine[]
    side: EntitySide | null
    defeated: boolean
}

export type EntityViewToken =
    | { kind: 'round'; label: string }
    | { kind: 'side'; side: EntitySide; label: string }
    | { kind: 'entity'; entity: EntityCardView }
    | { kind: 'line'; line: TrackerLine }

export interface EntityBlockView {
    tokens: EntityViewToken[]
    /** How many entities the block anchored, for the card header to count. */
    count: number
}

/** What a side header says on screen. */
function sideLabel(side: EntitySide): string {
    return side === 'allies' ? 'Allies' : 'Enemies'
}

/** What the caller can hand the entity view beyond the block itself. */
export interface EntityViewOptions {
    /** Entity name -> image reference. See `portraits.ts` for the matching. */
    portraits?: Record<string, string>
    /** What the user decided about individual bars, keyed by `data-rt-bar-id`. */
    bars?: BarPrefs
    /** Animate changes on every custom `((BAR))` and `((BARREL))` (74h), Multihog's `animateAllCustomBarChanges`. */
    animateCustomBars?: boolean
}

/**
 * The hit-point bar, with the reader's two choices applied.
 *
 * The colour a user picked wins over the health gradient — the gradient is
 * information the *renderer* invented, and someone who has recoloured a bar has
 * said what they want to see. A bar with no maximum keeps its own text: there is
 * no percentage to show when nothing says what full means.
 */
function buildHpView(hp: EntityHp, options: EntityViewOptions): EntityHpView {
    const pref = barPrefFor(options.bars, hp.barId)
    const fraction = hp.maxText == null ? hp.currentText : `${hp.currentText}/${hp.maxText}`

    return {
        ...hp,
        // The legacy's resolver over the line's own colouring (74i): a stored
        // config's solid, gradient or dynamic fill, else the damage colouring.
        color: barBackground(pref, hp.barId, hpColor(hp), hp.percent),
        label: barShowsPercentage(pref, hp.barId) && hp.maxText != null ? `${Math.round(hp.percent)}%` : fraction,
        animate: barAnimates(pref, hp.barId),
        explicitColor: !!hp.color,
    }
}

function buildEntityCardView(entity: TrackerEntity, tag: string, options: EntityViewOptions): EntityCardView {
    return {
        name: entity.name,
        portrait: portraitFor(options.portraits, entity.name),
        hp: entity.hp ? buildHpView(entity.hp, options) : null,
        fields: entity.fields,
        // The line index restarts per entity and is namespaced by the entity's
        // name, so two combatants who both have a `Charges` bar do not end up
        // sharing one bar identity.
        lines: entity.lines.map((line, index) =>
            parseBlockLine(line, { tag: `${tag}:${entity.name}`, lineIndex: index, bars: options.bars, animateCustomBars: options.animateCustomBars, inEntity: true }),
        ),
        side: entity.side,
        defeated: entity.defeated,
    }
}

/**
 * Build the view for one entity block, or `null` if it has no entities in it.
 *
 * `null` is the caller's signal to fall back to the ordinary line rendering.
 */
export function buildEntityBlockView(
    content: string | null | undefined,
    tag: string,
    options: EntityViewOptions = {},
): EntityBlockView | null {
    const parsed = parseEntityBlock(content, tag)
    if (!parsed) return null

    let count = 0
    const tokens: EntityViewToken[] = parsed.map((token: EntityToken): EntityViewToken => {
        switch (token.kind) {
            case 'round':
                return token
            case 'side':
                return { kind: 'side', side: token.side, label: sideLabel(token.side) }
            case 'entity':
                count += 1
                return { kind: 'entity', entity: buildEntityCardView(token.entity, tag, options) }
            case 'line':
                return { kind: 'line', line: parseBlockLine(token.line, { tag, lineIndex: 0, bars: options.bars, animateCustomBars: options.animateCustomBars }) }
        }
    })

    return { tokens, count }
}
