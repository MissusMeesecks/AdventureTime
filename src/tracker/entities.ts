/**
 * The entity grammar — the second layer on `[COMBAT]`, `[PARTY]` and
 * `[CHARACTER]`.
 *
 * These blocks are not flat lists of lines. A line can *anchor* an entity, and
 * every line after it belongs to that entity until the next anchor:
 *
 *     ENEMIES:
 *     Goblin Archer: 7/12 HP | AC: 13 | Status: (-) Prone
 *       Notes: perched on the mill roof
 *     Bandit Chief: 0/30 HP | Status: Defeated
 *
 * Three things anchor an entity: the classic `Name: cur/max HP` line, the same
 * thing written with a leading `((HP))` marker, and the inline bar form
 * `Name ((BARGREEN)) 12/20`. In a `[CHARACTER]` or `[PARTY]` block the *first*
 * line will also anchor on its own name, with no HP at all, because a player
 * character sheet does not have to open with a hit-point total.
 *
 * Everything here is text in, plain objects out. What a card says about an
 * entity is `entity-view.ts`; what it looks like is `render.ts`.
 *
 * Ported from the entity branch of `renderBlockLines` in `renderer.js` at the
 * pinned commit. The legacy carries a second, independent parser for the same
 * grammar in `src/state/combat-persistence.js` — `entities.pin.test.ts` runs
 * this port against *both*, which is a stronger check than either alone.
 *
 * Two things the legacy did are deliberately absent, because the state they
 * read has not been ported: **portraits** (a per-entity image looked up in
 * storage) and **per-bar user state** (a colour the user picked, whether the
 * bar reads as a percentage). Every bar carries its `barId` so that layer
 * attaches later.
 */

import { tokenizeMarkers } from './markers.js'

/** Which side of a fight a combatant is on. */
export type EntitySide = 'allies' | 'enemies'

/** The tags that carry this grammar. Everything else draws as plain lines. */
export const ENTITY_TAGS: ReadonlySet<string> = new Set(['COMBAT', 'PARTY', 'BENCHED PARTY', 'CHARACTER'])

/** The tags whose first line may anchor on a bare name, with no hit points. */
const PLAIN_NAME_ANCHOR_TAGS: ReadonlySet<string> = new Set(['CHARACTER', 'PARTY'])

/** Marker names that mean "this line is a hit-point anchor", from the legacy list. */
const HP_ANCHOR_MARKERS: ReadonlySet<string> = new Set(['HP', 'HPB', 'HPBAR'])

/** `ENEMIES:` / `ALLIES:` / `NON-PARTY ALLIES:`, on a line of their own. */
const COMBAT_SIDE_HEADER_RE = /^(ENEMIES|(?:NON[-\s]+PARTY\s+)?ALLIES)\s*:?\s*$/i

/** `Combat Round 3`. */
const COMBAT_ROUND_RE = /Combat Round\s*\d+/i

/**
 * A status that means this combatant is out of the fight.
 *
 * Zero hit points deliberately does not qualify. A dying character, or one
 * making death saves, is still in the fight and still needs to be on screen —
 * only the model saying `Defeated` or `Dead` settles it.
 */
const RESOLVED_STATUS_RE = /(?:^|\|)\s*Status\s*:\s*(?:(?:\(\([^)]*\)\)|\([^)]*\))\s*)*(?:defeated|dead)\b/i

/** The classic anchor: `Brenna: 12/20 HP | AC: 15`. */
const HP_ANCHOR_RE = /^(.+?):\s*([+-]?[\d,]+|\?+)(?:\/([\d,]+|\?+))?\s*HP\s*[:|,]?\s*(.*)$/i

/**
 * A list marker before a name (60-bis): `- Perrin (Ranger): 12/12 HP`. The
 * stock formats ask for no bullet, but a model adds one, and the legacy's
 * parsers keep it as the name's first character — so the portrait set for
 * `Perrin` never matched `- Perrin`, on screen or in the store. A dash, a bullet
 * or an asterisk followed by a space is never part of a name.
 */
const LIST_MARKER_RE = /^[-\u2013\u2014\u2022*+]\s+/

/** A name without the list marker a model may have put before it. */
export function stripListMarker(name: string): string {
    return name.replace(LIST_MARKER_RE, '').trim()
}

/** The same, with the `HP` suffix optional — only for a line that said `((HP))`. */
const HP_MARKED_ANCHOR_RE = /^(.+?):\s*([+-]?[\d,]+|\?+)(?:\/([\d,]+|\?+))?(?:\s*HP)?\s*[:|,]?\s*(.*)$/i

/** The tail of an inline bar line, where the name came from before the marker. */
const HP_INLINE_ANCHOR_RE = /^(?:(.+?):\s*)?([+-]?\d[\d,]*|\?+)(?:\/(\d[\d,]*|\?+))?(?:\s*HP)?\s*[:|,]?\s*(.*)$/i

/** `ENEMIES:` and friends, or `null` for any other line. */
export function parseCombatSideHeader(line: string | null | undefined): EntitySide | null {
    const match = String(line ?? '').trim().match(COMBAT_SIDE_HEADER_RE)
    if (!match) return null
    return /\bALLIES\b/i.test(match[1]!) ? 'allies' : 'enemies'
}

/** Whether a line says a combatant is out of the fight. */
export function isResolvedCombatantStatusLine(line: string | null | undefined): boolean {
    return RESOLVED_STATUS_RE.test(String(line ?? '').trim())
}

export interface EntityHp {
    /** As written, so `??` and `1,200` survive to the screen. */
    currentText: string
    maxText: string | null
    current?: number
    max?: number
    /**
     * How full the bar is, 0–100.
     *
     * Unknown hit points read as 100, not 0. A `?/?` enemy is one the party
     * cannot see clearly, and drawing that as an empty bar would state
     * something false — that it is nearly dead.
     */
    percent: number
    unknown: boolean
    /** A colour from an inline `((BARGREEN))`, which beats the damage colouring. */
    color?: string
    /** Stable identity for the per-bar state layer, as `TAG:Name:HP`. */
    barId: string
}

/** One of the labelled fields hanging off an anchor line, after the `|`s. */
export interface EntityField {
    /** `AC`, `Saves`, `Status`, `Res`, `Other` or `Info`. */
    label: string
    value: string
    /** How to draw it: a list of things, prose with highlighted parentheses, or plain. */
    kind: 'pills' | 'highlight' | 'text'
}

export interface TrackerEntity {
    name: string
    /** Absent on a bare-name anchor — a character sheet need not open with hit points. */
    hp: EntityHp | null
    fields: EntityField[]
    /** The lines that hung off this entity, raw. The ordinary line parser draws them. */
    lines: string[]
    /** `[COMBAT]` only, and only once a header has said which side is which. */
    side: EntitySide | null
    /** `[COMBAT]` only: the model said `Status: Defeated` or `Dead`. */
    defeated: boolean
}

export type EntityToken =
    | { kind: 'round'; label: string }
    | { kind: 'side'; side: EntitySide }
    | { kind: 'entity'; entity: TrackerEntity }
    /** A line before any anchor. Kept so nothing the model wrote is dropped. */
    | { kind: 'line'; line: string }

/** Split an anchor line's tail into its labelled fields. */
function parseAnchorFields(rest: string): EntityField[] {
    const status = rest.trim().replace(/^\|\s*/, '')
    if (!status) return []

    const fields: EntityField[] = []
    const generic: string[] = []

    for (const part of status.split('|').map((p) => p.trim()).filter(Boolean)) {
        const lower = part.toLowerCase()
        if (lower.startsWith('ac:')) {
            fields.push({ label: 'AC', value: part.slice(3).trim(), kind: 'text' })
        } else if (lower.startsWith('saves:')) {
            fields.push({ label: 'Saves', value: part.slice(6).trim(), kind: 'highlight' })
        } else if (lower.startsWith('status:')) {
            fields.push({ label: 'Status', value: part.slice(7).trim(), kind: 'pills' })
        } else if (lower.startsWith('res:')) {
            fields.push({ label: 'Res', value: part.slice(4).trim(), kind: 'pills' })
        } else if (lower.startsWith('other:')) {
            fields.push({ label: 'Other', value: part.slice(6).trim(), kind: 'pills' })
        } else if (lower.startsWith('info:')) {
            // The legacy has no case for this, so a part the model already
            // labelled `Info:` fell through to the generic bucket below and got
            // the same label put on it again — `Info: Info: three of them`.
            generic.push(part.slice(5).trim())
        } else {
            generic.push(part)
        }
    }

    // Anything unlabelled is joined back up under one heading rather than
    // guessed at. The separator that split them goes back in, so the line the
    // model wrote is still readable.
    if (generic.length) fields.push({ label: 'Info', value: generic.join(' | '), kind: 'highlight' })

    return fields
}

/** A number as written into one that can be compared, or `undefined` for `??`. */
function readHpNumber(text: string | undefined): { text: string | null; value?: number; unknown: boolean } {
    if (text === undefined) return { text: null, unknown: false }
    if (/^\?+$/.test(text)) return { text, unknown: true }
    const value = Number(text.replace(/,/g, ''))
    return { text, value: Number.isFinite(value) ? value : undefined, unknown: false }
}

function buildHp(tag: string, name: string, currentRaw: string, maxRaw: string | undefined, color?: string): EntityHp {
    const current = readHpNumber(currentRaw)
    const max = readHpNumber(maxRaw)
    const unknown = current.unknown || max.unknown
    const known = current.value !== undefined && max.value !== undefined && max.value > 0
    const percent = known ? Math.max(0, Math.min(100, (current.value! / max.value!) * 100)) : 100

    return {
        currentText: current.text!,
        maxText: max.text,
        ...(current.value === undefined ? {} : { current: current.value }),
        ...(max.value === undefined ? {} : { max: max.value }),
        percent,
        unknown,
        ...(color ? { color } : {}),
        barId: `${tag}:${name}:HP`,
    }
}

/** What a line turned out to be, once the markers on it have been read. */
interface MarkedLine {
    /** The line with any leading marker stripped. */
    text: string
    /** Set when the marker was one of the hit-point ones, which relaxes the anchor. */
    hpMarked: boolean
    /** Set by the inline form `Name ((BARGREEN)) 12/20`. */
    inlineName?: string
    inlineColor?: string
}

function readMarkers(raw: string): MarkedLine {
    const segments = tokenizeMarkers(raw)
    const first = segments[0]
    if (!first) return { text: raw.trim(), hpMarked: false }

    // `Name ((BARGREEN)) 12/20` — the name is what sits before the marker, and
    // the marker's own colour wins over the damage colouring below.
    //
    // The trailing colon is what separates this from `Morale: ((BAR)) 3/10`,
    // which is a labelled bar *about* an entity, not a new one. The legacy
    // renderer misses that and anchors an entity literally named `Morale:`,
    // which the legacy's own second parser in `combat-persistence.js` does not
    // do; this follows the second one. It is the one departure this port makes
    // from the renderer's anchoring, and it is display-only.
    if (first.preText && !first.preText.endsWith(':') && first.rule.renderType === 'hp_bar') {
        return {
            text: first.content.trim(),
            hpMarked: true,
            inlineName: first.preText.trim(),
            ...(first.rule.color ? { inlineColor: first.rule.color } : {}),
        }
    }

    // A marker at the start of the line, with nothing before it.
    if (!first.preText) {
        return { text: first.content.trim(), hpMarked: HP_ANCHOR_MARKERS.has(first.markerType) }
    }

    return { text: raw.trim(), hpMarked: false }
}

/**
 * Read one entity block into anchors and the lines that hang off them.
 *
 * Returns `null` when nothing anchored, which is the signal to draw the block
 * as ordinary lines instead. That fallback matters more than the grammar does:
 * a model writing something this does not recognise has to see its own words on
 * screen, not an empty card.
 */
export function parseEntityBlock(content: string | null | undefined, tag: string): EntityToken[] | null {
    const upperTag = String(tag ?? '').toUpperCase()
    const isCombat = upperTag === 'COMBAT'

    const tokens: EntityToken[] = []
    let current: TrackerEntity | null = null
    let side: EntitySide | null = null
    let anchored = false

    for (const rawLine of String(content ?? '').split(/\r?\n/)) {
        const raw = rawLine.trim()
        if (!raw) continue

        const marked = readMarkers(raw)
        const line = marked.text

        if (isCombat && COMBAT_ROUND_RE.test(line)) {
            tokens.push({ kind: 'round', label: line })
            current = null
            continue
        }

        const header = isCombat ? parseCombatSideHeader(line) : null
        if (header) {
            tokens.push({ kind: 'side', side: header })
            side = header
            current = null
            continue
        }

        // The three anchor spellings, in the legacy's order of precedence.
        let match = line.match(HP_ANCHOR_RE)
        if (!match && marked.hpMarked && !marked.inlineName) match = line.match(HP_MARKED_ANCHOR_RE)
        if (!match && marked.inlineName) match = line.match(HP_INLINE_ANCHOR_RE)

        if (match) {
            const name = stripListMarker((marked.inlineName || match[1] || '').trim())
            const entity: TrackerEntity = {
                name,
                hp: buildHp(upperTag, name, match[2]!, match[3], marked.inlineColor),
                fields: parseAnchorFields(match[4] ?? ''),
                lines: [],
                side,
                defeated: isCombat && isResolvedCombatantStatusLine(raw),
            }
            tokens.push({ kind: 'entity', entity })
            current = entity
            anchored = true
            continue
        }

        // A character sheet does not have to open with hit points, so the first
        // line of one anchors on its own name. Only the first: after that a
        // plain line is a detail *about* the character, not a second character.
        if (PLAIN_NAME_ANCHOR_TAGS.has(upperTag) && !anchored) {
            const colon = stripListMarker(line).match(/^(.+?):\s*(.*)/)
            let name = stripListMarker(line)
            let rest = ''
            if (colon) {
                if (colon[1]!.trim().toLowerCase() === 'name') {
                    name = colon[2]!.trim()
                } else {
                    name = colon[1]!.trim()
                    rest = colon[2]!.trim()
                }
            }

            const entity: TrackerEntity = {
                name,
                hp: null,
                fields: rest ? [{ label: '', value: rest, kind: 'text' }] : [],
                lines: [],
                side,
                defeated: false,
            }
            tokens.push({ kind: 'entity', entity })
            current = entity
            anchored = true
            continue
        }

        if (current) {
            if (isCombat && isResolvedCombatantStatusLine(line)) current.defeated = true
            current.lines.push(rawLine)
            continue
        }

        tokens.push({ kind: 'line', line: rawLine })
    }

    return anchored ? tokens : null
}
