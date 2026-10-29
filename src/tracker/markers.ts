/**
 * The ((MARKER)) grammar — the tracker's display vocabulary.
 *
 * This is a data contract, not an implementation detail. A sub-module author
 * writes `((BARCYAN)) 640/1000` into a module's output format, the model echoes
 * it back inside the memo, and the tracker turns it into a bar. Drop a marker
 * name and every module that used it renders as plain text instead; change how
 * a colour suffix parses and authored colours move. So the table below and the
 * tokenizer are ported from the legacy `renderer.js` at the pinned commit
 * rather than redesigned, quirks included.
 *
 * The one deliberate departure is structural: legacy tokenizing and legacy
 * rendering were one pass that emitted HTML. Here tokenizing stops at a typed
 * segment (see lines.ts) and rendering is a separate module, so the grammar can
 * be tested without asserting on markup.
 */

/** Every way a marked value can be drawn. */
export type MarkerRenderType =
    | 'pills'
    | 'pill_colored'
    | 'hp_bar'
    | 'barrel'
    | 'npc'
    | 'xp_bar'
    | 'text'
    | 'badge'
    | 'badge_colored'
    | 'highlight'
    | 'objective'
    | 'reward'
    | 'difficulty'
    | 'progress'
    | 'coin'
    | 'dice_roll'
    | 'clock'
    | 'stars'
    | 'weight'
    | 'weather'
    | 'orbs'
    | 'slots'
    | 'phase'
    | 'gauge'
    | 'charge'

export interface MarkerRule {
    renderType: MarkerRenderType
    /** Default fill/text colour, or a colour parsed off the marker token. */
    color?: string
    /** BARREL draws two signed halves and so carries two colours. */
    positiveColor?: string
    negativeColor?: string
    icon?: string
    /** Shown in the marker library in the UI; also the AI-facing hint text. */
    example: string
    /** Set on shorthand spellings. Aliases are excluded from the library list. */
    aliasOf?: string
}

/**
 * The marker table, verbatim from the pin.
 *
 * Order matters in one place only: MARKER_BASE_PATTERN below sorts the keys by
 * length so that longer names win, which is what stops `PILLS` swallowing the
 * `PILL` in `((PILLS))`.
 */
export const MARKER_TYPE_MAP: Record<string, MarkerRule> = {
    PILLS: { renderType: 'pills', example: 'Status (Hover for details), Condition (Another detail)' },
    PLS: { renderType: 'pills', example: 'Status (Hover for details)', aliasOf: 'PILLS' },
    PILL: { renderType: 'pill_colored', example: 'Status (Single colored pill)' },
    BAR: { renderType: 'hp_bar', example: '50/100 (Colored resource bar)' },
    B: { renderType: 'hp_bar', example: '50/100 (Colored resource bar)', aliasOf: 'BAR' },
    HPBAR: { renderType: 'hp_bar', example: '50/100 (Red HP/Standing)', aliasOf: 'BAR' },
    HPB: { renderType: 'hp_bar', example: '50/100 (Red HP/Standing)', aliasOf: 'BAR' },
    HP: { renderType: 'hp_bar', example: '50/100 (Red HP/Standing)', aliasOf: 'BAR' },
    BARREL: { renderType: 'barrel', example: 'Trust: -38/150 (signed centre-zero bar; click each side to recolor)' },
    NPC: { renderType: 'npc', example: 'Gandolf: (freeform NPC card; uses a matching Lorebook Agent portrait)' },
    XPBAR: { renderType: 'xp_bar', example: '450/1000 Level 3 (XP/Progress)' },
    XB: { renderType: 'xp_bar', example: '450/1000 Level 3 (XP/Progress)', aliasOf: 'XPBAR' },
    TEXT: { renderType: 'text', example: 'Some text (Plain)' },
    BADGE: { renderType: 'badge', example: 'Neutral (Reputation badge)' },
    BDG: { renderType: 'badge', example: 'Neutral (Reputation badge)', aliasOf: 'BADGE' },
    HIGHLIGHT: { renderType: 'highlight', example: 'Emphasis (Bright highlight text)' },
    HGT: { renderType: 'highlight', example: 'Emphasis (Bright highlight text)', aliasOf: 'HIGHLIGHT' },
    OBJ: { renderType: 'objective', example: '✓ Done (Checked quest bullet)' },
    REWARD: { renderType: 'reward', example: '500 XP (Loot reward badge)' },
    DIFFICULTY: { renderType: 'difficulty', example: 'Hard (Difficulty star badge)' },
    PROGRESS: { renderType: 'progress', example: '3/5 (Fraction progress)' },
    WARNING: { renderType: 'badge_colored', color: '#f1c40f', example: 'Caution (Amber badge)' },
    DANGER: { renderType: 'badge_colored', color: '#e74c3c', example: 'Hostile (Red badge)' },
    SUCCESS: { renderType: 'badge_colored', color: '#2ecc71', example: 'Active (Green badge)' },
    INFO: { renderType: 'badge_colored', color: '#3498db', example: 'Role (Blue badge)' },
    GOLD: { renderType: 'coin', color: '#ffd700', icon: '💰', example: '150 (Gold coins)' },
    SILVER: { renderType: 'coin', color: '#c0c0c0', icon: '🪙', example: '45 (Silver coins)' },
    BRONZE: { renderType: 'coin', color: '#cd7f32', icon: '🪙', example: '12 (Bronze coins)' },
    DOLLAR: { renderType: 'coin', color: '#85bb65', icon: '💵', example: '500 (Paper cash)' },
    HEART: { renderType: 'coin', color: '#ff4466', icon: '❤️', example: '3 (Lives/Hearts)' },
    SKULL: { renderType: 'coin', color: '#aaaaaa', icon: '💀', example: '12 (Kills/Deaths)' },
    SOUL: { renderType: 'coin', color: '#aa88ff', icon: '👻', example: '42 (Souls)' },
    ROLL: { renderType: 'dice_roll', example: '1d20+5 = 18 (Dice roll badge)' },
    CLOCK: { renderType: 'clock', example: '4/8 (Guard Alertness)' },
    STARS: { renderType: 'stars', example: '3/5 (Merchant Favor)' },
    WEIGHT: { renderType: 'weight', example: '45/50 lbs (Encumbered)' },
    CAPACITY: { renderType: 'weight', example: '45/50 lbs (Encumbered)', aliasOf: 'WEIGHT' },
    WEATHER: { renderType: 'weather', example: 'Heavy Rain (Poor Visibility)' },
    ORBS: { renderType: 'orbs', example: '3/5 (Ki Points)' },
    AP: { renderType: 'orbs', example: '3/5 (Ki Points)', aliasOf: 'ORBS' },
    SLOTS: { renderType: 'slots', example: '4/10 (Backpack)' },
    PHASE: { renderType: 'phase', example: '2/4 (Ritual Summoning)' },
    STEP: { renderType: 'phase', example: '2/4 (Ritual Summoning)', aliasOf: 'PHASE' },
    GAUGE: { renderType: 'gauge', example: '75/100 (Party Morale)' },
    METER: { renderType: 'gauge', example: '75/100 (Party Morale)', aliasOf: 'GAUGE' },
    CHARGE: { renderType: 'charge', example: '2/5 (Wand of Fireballs)' },
    BATTERY: { renderType: 'charge', example: '2/5 (Wand of Fireballs)', aliasOf: 'CHARGE' },
}

/** Canonical marker names for the UI library and AI hints — shorthand aliases excluded. */
export function getMarkerLibraryKeys(): string[] {
    return Object.keys(MARKER_TYPE_MAP).filter((key) => !MARKER_TYPE_MAP[key].aliasOf)
}

const HEX_COLOR_PATTERN = '#[0-9a-fA-F]{6}'
const NAMED_COLOR_PATTERN = '[a-zA-Z]+'
const MARKER_COLOR_PATTERN = `(?:${HEX_COLOR_PATTERN}|${NAMED_COLOR_PATTERN})`
const MARKER_BASE_PATTERN = Object.keys(MARKER_TYPE_MAP)
    .sort((a, b) => b.length - a.length)
    .join('|')

/**
 * Matches the next ((MARKER)) token in a string.
 *
 * Any base marker may carry a colour, in either of two spellings: glued to the
 * name (`((PILLPINK))`, `((BARRED))`) or delimited (`((PILL - rebeccapurple))`,
 * `((BAR - #ff6699 - ...))`). Groups are: 1 base name, 2 glued colour,
 * 3 and 4 delimited colours.
 *
 * Deliberately not a global regex: the tokenizer re-execs it against a
 * shrinking remainder, and a sticky `lastIndex` would skip tokens.
 */
export const MARKER_TOKEN_RE = new RegExp(
    `\\(\\((${MARKER_BASE_PATTERN})(?:(${NAMED_COLOR_PATTERN}))?(?:\\s*-\\s*(${MARKER_COLOR_PATTERN})(?:\\s+(${MARKER_COLOR_PATTERN}))?)?\\)\\)`,
    'i',
)

/** Render types whose default fill is a bar, and so can take a two-colour gradient. */
const GRADIENT_CAPABLE_RENDER_TYPES = new Set<MarkerRenderType>(['hp_bar', 'xp_bar', 'progress'])

/**
 * Whether a parsed colour token is safe to interpolate into a style attribute.
 *
 * Strict by design: a marker colour reaches CSS, and the memo it came from was
 * written by a language model. Six-digit hex or bare letters, nothing else.
 */
export function isValidMarkerColor(str: string | null | undefined): boolean {
    return /^#[0-9a-fA-F]{6}$/.test(str || '') || /^[a-zA-Z]+$/.test(str || '')
}

/**
 * Clone `baseRule` with colours from a marker token applied.
 *
 * Two valid colours mean a gradient on a bar, and the two signed halves on a
 * BARREL. Anywhere else the second colour is ignored. An invalid first colour
 * drops the override entirely rather than half-applying it.
 */
export function applyMarkerColorOverride(
    baseRule: MarkerRule,
    color1: string | null,
    color2: string | null = null,
): MarkerRule {
    if (!isValidMarkerColor(color1)) return baseRule
    const rule: MarkerRule = { ...baseRule }
    if (rule.renderType === 'barrel') {
        rule.positiveColor = color1 as string
        rule.negativeColor = color2 && isValidMarkerColor(color2) ? color2 : (color1 as string)
    } else if (color2 && isValidMarkerColor(color2) && GRADIENT_CAPABLE_RENDER_TYPES.has(rule.renderType)) {
        rule.color = `linear-gradient(90deg, ${color1}, ${color2})`
    } else {
        rule.color = color1 as string
    }
    return rule
}

export interface MarkerSegment {
    /** Text between the previous marker and this one — usually the label. */
    preText: string
    /** The base marker name, upper-cased (`BAR` for `((BARRED))`). */
    markerType: string
    rule: MarkerRule
    /** Text between this marker and the next, or the tail after the last one. */
    content: string
    /** A `|50` prefix: this marker starts 50% across the row. */
    tabStop?: number
}

/**
 * Split a line into ordered marker segments, or `[]` if it carries no marker.
 *
 * Each segment owns the text *after* its own token, so a line reads as a
 * sequence of `label ((MARKER)) value` groups. `||` between two markers is an
 * explicit column break and belongs to neither side.
 */
export function tokenizeMarkers(line: string): MarkerSegment[] {
    const segments: MarkerSegment[] = []
    let remaining = line

    for (;;) {
        const m = MARKER_TOKEN_RE.exec(remaining)
        if (!m) break

        let preText = remaining.slice(0, m.index).trim()
        preText = preText.replace(/^[-*+•–—]\s*/, '').trim()
        const markerType = m[1].toUpperCase()
        const colorSuffix = m[2] || null
        const colorArg1 = m[3] || null
        const colorArg2 = m[4] || null
        remaining = remaining.slice(m.index + m[0].length).trimStart()

        const baseRule = MARKER_TYPE_MAP[markerType] || { renderType: 'text' as const, example: '' }
        const rule = colorArg1
            ? applyMarkerColorOverride(baseRule, colorArg1, colorArg2)
            : colorSuffix
              ? applyMarkerColorOverride(baseRule, colorSuffix)
              : baseRule

        segments.push({ preText, markerType, rule, content: '' })
    }

    // A numeric tab stop can precede any marker, the first included:
    // `|50 ((PILLS)) Affection tier`. It is a percentage of the row width and
    // is removed from the displayed text.
    for (const segment of segments) {
        const tabMatch = segment.preText.match(/^(.*?)\s*\|(\d+(?:\.\d+)?)\s*$/)
        if (tabMatch) {
            segment.preText = tabMatch[1].trim()
            segment.tabStop = Math.max(0, Math.min(100, Number(tabMatch[2])))
        }
    }

    // Hand each segment the text that follows it. Once a preText has been
    // consumed as the previous segment's content it is cleared, so it cannot
    // also be drawn as this segment's label.
    for (let i = 0; i < segments.length; i++) {
        if (i < segments.length - 1) {
            segments[i].content = segments[i + 1].preText.replace(/\s*\|\|\s*$/, '').trim()
            segments[i + 1].preText = ''
        } else {
            segments[i].content = remaining.trim()
        }
    }

    return segments
}

/**
 * Turn tab stops into grid spans, in percent of the row.
 *
 * Segments without an explicit stop are spread evenly between the nearest
 * explicit ones, so `|0 ((BAR)) x |75 ((PILL)) y` with a marker between them
 * puts that middle marker halfway.
 */
export function resolveMarkerTabStops(segments: MarkerSegment[]): Array<{ start: number; end: number }> {
    const count = segments.length
    const starts: number[] = Array(count)
    starts[0] = segments[0].tabStop ?? 0
    let previous = 0

    for (let i = 1; i < count; i++) {
        if (segments[i].tabStop === undefined) continue
        const next = segments[i].tabStop as number
        const previousStart = starts[previous]
        for (let j = previous + 1; j < i; j++) {
            starts[j] = previousStart + ((next - previousStart) * (j - previous)) / (i - previous)
        }
        starts[i] = next
        previous = i
    }

    const previousStart = starts[previous]
    for (let i = previous + 1; i < count; i++) {
        starts[i] = previousStart + ((100 - previousStart) * (i - previous)) / (count - previous)
    }

    return starts.map((rawStart, i) => {
        const start = Math.max(0, Math.min(99.9, rawStart))
        const nextStart = i < count - 1 ? starts[i + 1] : 100
        const end = Math.max(start + 0.1, Math.min(100, nextStart))
        return { start, end }
    })
}
