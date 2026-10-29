/**
 * The view model, drawn as HTML.
 *
 * Spindle's `ctx.messages.renderWidget()` takes an HTML string, which is what
 * made the legacy `renderer.js` the most portable file in the codebase — it
 * builds strings and never touches the DOM. This module keeps that property,
 * and keeps the legacy `rt-*` class names, so the stylesheet port lands on top
 * of it without a rename pass.
 *
 * Two things the legacy renderer did are deliberately absent, because the state
 * they read has not been ported yet:
 *
 *   - **Per-bar user state** — a colour the user picked for one bar, whether a
 *     bar reads as a percentage, whether it animates. Every bar here carries
 *     its `data-rt-bar-id`, so that layer attaches later without re-rendering
 *     being reworked.
 *   - **Collapse and detach state**, which lives in browser storage.
 *
 * Every value drawn here came out of a memo written by a language model, so it
 * goes through `escapeHtml`/`escapeHtmlWithColor` on the way in. Colours reach
 * a `style` attribute, so they are validated at the point they are parsed (see
 * `isValidMarkerColor`) rather than trusted here.
 */

import { escapeHtml, escapeHtmlWithColor, highlightNumbers, highlightParens, makeBarrelValueStyle, makeColorTintStyle, splitSmart } from './html.js'
import { inventoryTotal, readInventoryItem, type InventoryItem } from './inventory-worth.js'
import { parseFraction, type ParsedSegment, type TrackerLine } from './lines.js'
import { barBackground, barPrefFor, barShowsPercentage, type BarPref, type BarPrefs } from './bars.js'
import { planDisplayGroups, type DisplayGroup, type DisplayGroupPlanEntry } from './display-groups.js'
import { renderPartyVitalsStrip, TAB_MODE_PINNED_TAGS } from './tab-mode.js'
import { formatTimeDiff, isRestTimeUnset, parseInWorldTime } from './time.js'
import { getTimeOfDayInfo } from '../frontend/themes-legacy.js'
import { SPELL_WIKI, spellSlug, type SpellGroup } from './spells.js'
import type { EntityBlockView, EntityCardView } from './entity-view.js'
import type { EntityField } from './entities.js'
import type { QuestCardView, QuestLogView } from './quest-view.js'
import type { TrackerBlock, TrackerView } from './view.js'

/** Default fills, from the legacy renderer. */
const DEFAULT_COLORS = {
    hpBar: 'linear-gradient(90deg,#e74c3c,#c0392b)',
    xpBar: 'linear-gradient(90deg, #00c88c, #00d4ff)',
    progress: 'linear-gradient(90deg, #00c88c, #00d4ff)',
    barrelPositive: 'linear-gradient(90deg, #4ade8088, #4ade80)',
    barrelNegative: 'linear-gradient(270deg, #ef444488, #ef4444)',
    clock: 'var(--rt-accent, #00ffaa)',
    stars: '#ffd700',
    orbs: '#3498db',
    slots: '#aaaaaa',
    phase: 'var(--rt-accent, #00ffaa)',
    gauge: 'linear-gradient(90deg, #2ecc71, #f1c40f, #e74c3c)',
} as const

const DIFFICULTY_COLORS: Record<string, string> = {
    'very easy': '#2ecc71',
    easy: '#27ae60',
    medium: '#f1c40f',
    normal: '#f1c40f',
    hard: '#e67e22',
    'very hard': '#e74c3c',
}

/** Render types whose fill colour is the bar itself, so the label must not take it. */
const FILL_COLOR_TYPES = new Set(['badge', 'badge_colored', 'pills', 'pill_colored', 'hp_bar', 'xp_bar', 'progress'])

function labelHtml(segment: ParsedSegment): string {
    if (!segment.label) return ''
    const colorLabel = segment.color && !FILL_COLOR_TYPES.has(segment.renderType)
    const style = colorLabel ? ` style="color:${segment.color}"` : ''
    return `<span class="rt-entity-sub-label"${style}>${escapeHtmlWithColor(segment.label)}</span>`
}

/**
 * The identity attribute the per-bar state layer keys off, and (74h) the
 * value beside it as the legacy's `makeBarAnimationData` writes it — the
 * current, the maximum, the kind and whether to animate — so the panel can
 * compare a redraw to the one before. The value goes only with a readable
 * fraction, as there: the animation needs both numbers.
 */
function barAttr(segment: ParsedSegment, value?: { current: number; max: number; kind?: 'linear' | 'barrel' }, recolor?: { fill: string; explicit?: boolean; percent?: boolean }): string {
    if (!segment.barId) return ''
    return ` data-rt-bar-id="${escapeHtml(segment.barId)}"${barValueAttrs(value, segment.animate === true)}${recolor ? recolorAttrs(segment.barId, recolor.fill, recolor.explicit, undefined, recolor.percent) : ''}`
}

/**
 * The recolour handle (74i), as the legacy's renderer writes it on the element
 * a click opens the popup over: the bar's id, the fill it draws with now (the
 * picker's starting colour, and what the barrel's animation reads back), and
 * on an HP bar whether the line itself coloured it.
 */
function recolorAttrs(barId: string, fill: string, explicit?: boolean, title = 'Click to recolor', percent = false): string {
    const explicitAttr = explicit === undefined ? '' : ` data-recolor-explicit-color="${explicit ? 'true' : 'false'}"`
    // Whether this bar's readout honours *Show as Percentage* (74i-bis): the
    // legacy's popup offers the tick on every bar and its renderer reads it on
    // a few, so the panel takes the tick off the box where nothing reads it.
    const percentAttr = percent ? ' data-recolor-percent="true"' : ''
    return ` data-recolor-id="${escapeHtml(barId)}" data-recolor-current="${escapeHtml(fill)}"${explicitAttr} title="${escapeHtml(title)}"${percentAttr}`
}

/** A fraction's readout: `current/max`, or the percentage when the bar's config asks for it (74i-bis: on every bar that has a readout, not only the legacy's two). */
function fractionReadout(segment: ParsedSegment, fraction: { percent: number; currentText: string; maxText: string }): string {
    return segment.percentLabel ? `${Math.round(fraction.percent)}%` : `${escapeHtml(fraction.currentText)}/${escapeHtml(fraction.maxText)}`
}

/** The fill a marker's bar draws with: the user's config through the legacy's resolver, over the author's colour or the type's default. */
function segmentFill(segment: ParsedSegment, fallback: string, pct: number | null): string {
    const fill = segment.color || fallback
    return segment.barId ? barBackground(segment.barPref, segment.barId, fill, pct) : fill
}

/** The legacy's machine-readable state on a bar, or nothing when the numbers are not both known (an entity's `??/??`, a zero maximum). */
function barValueAttrs(value: { current?: number; max?: number; kind?: 'linear' | 'barrel' } | undefined, animate: boolean): string {
    if (!value || !Number.isFinite(value.current) || !Number.isFinite(value.max) || value.max! <= 0) return ''
    return ` data-rt-bar-current="${value.current}" data-rt-bar-max="${value.max}" data-rt-bar-kind="${value.kind ?? 'linear'}" data-rt-bar-animate="${animate}"`
}

/** Every progression type falls back to a plain line when its value has no fraction. */
function plainLine(segment: ParsedSegment, prefix = ''): string {
    return `<div class="rt-entity-sub-line">${labelHtml(segment)} ${prefix}${escapeHtmlWithColor(segment.value)}</div>`
}

function suffix(rest: string): string {
    return rest ? ` ${escapeHtml(rest)}` : ''
}

function renderPills(value: string, color?: string): string {
    const colorStyle = color ? ` style="${makeColorTintStyle(color)}"` : ''
    return splitSmart(value)
        .map((raw) => {
            let pillClass = 'rt-unit-pill'
            let text = raw
            if (text.startsWith('(+)')) {
                pillClass += ' rt-pill-buff'
                text = text.replace(/^\(\+\)\s*/, '')
            } else if (text.startsWith('(-)')) {
                pillClass += ' rt-pill-debuff'
                text = text.replace(/^\(-\)\s*/, '')
            }

            const m = text.match(/^(.+?)\s*\((.+)\)$/)
            const name = m ? m[1].trim() : text
            const desc = m ? m[2].trim() : ''
            const descHtml = desc ? `<div class="rt-unit-descr">${escapeHtml(desc)}</div>` : ''
            const titleAttr = desc ? ` title="${escapeHtml(desc)}"` : ''
            const noDesc = desc ? '' : ' no-desc'

            return `<span class="${pillClass}${noDesc}"${colorStyle}${titleAttr}><span class="rt-unit-name">${escapeHtml(name)}</span>${descHtml}</span>`
        })
        .join(' ')
}

/**
 * A signed, centre-zero bar: `-38/150`, or `38/-150..+150`.
 *
 * Deliberately generic about what it is measuring — trust, reputation,
 * alignment, morale — because a sub-module author picks the axis.
 */
function renderBarrel(segment: ParsedSegment): string {
    const signedRange = segment.value.match(/([+-]?\d[\d,]*)\s*\/\s*([+-]?\d[\d,]*)\s*(?:\.\.|to)\s*([+-]?\d[\d,]*)/i)
    const valueAndMax = segment.value.match(/([+-]?\d[\d,]*)\s*\/\s*([+-]?\d[\d,]*)/)
    const m = signedRange || valueAndMax
    if (!m) return plainLine(segment)

    const current = parseInt(m[1].replace(/,/g, ''), 10)
    const rangeMax = signedRange
        ? Math.max(Math.abs(parseInt(m[2].replace(/,/g, ''), 10)), Math.abs(parseInt(m[3].replace(/,/g, ''), 10)))
        : Math.abs(parseInt(m[2].replace(/,/g, ''), 10))
    if (!Number.isFinite(current) || !Number.isFinite(rangeMax) || rangeMax <= 0) return plainLine(segment)

    const clamped = Math.max(-rangeMax, Math.min(rangeMax, current))
    const pct = (Math.abs(clamped) / rangeMax) * 50
    const isPositive = clamped >= 0
    const rest = segment.value.replace(m[0], '').trim()

    const positiveDefault = segment.positiveColor || segment.color || DEFAULT_COLORS.barrelPositive
    const negativeDefault = segment.negativeColor || segment.color || DEFAULT_COLORS.barrelNegative
    // Each half has its own id and config, as the legacy's two recolour controls do (74i).
    const positive = segment.barId ? barBackground(segment.barrelPrefs?.positive, `${segment.barId}:positive`, positiveDefault, pct) : positiveDefault
    const negative = segment.barId ? barBackground(segment.barrelPrefs?.negative, `${segment.barId}:negative`, negativeDefault, pct) : negativeDefault
    const fill = isPositive ? positive : negative
    const controls = segment.barId
        ? `<div class="rt-barrel-color-control rt-barrel-negative-control"${recolorAttrs(`${segment.barId}:negative`, negative, undefined, 'Click to recolor the negative side', true)} data-barrel-direction="negative"></div>
            <div class="rt-barrel-color-control rt-barrel-positive-control"${recolorAttrs(`${segment.barId}:positive`, positive, undefined, 'Click to recolor the positive side', true)} data-barrel-direction="positive"></div>`
        : ''

    const direction = clamped > 0 ? 'positive' : clamped < 0 ? 'negative' : 'zero'
    const valueStyle = direction === 'zero' ? '' : ` style="${makeBarrelValueStyle(fill)}"`
    // The readout: `+38/150`, or a signed percentage of the range when either
    // half's config asks for it (74i-bis; the legacy offers the tick on the
    // halves and reads it nowhere).
    const display = segment.percentLabel
        ? `${clamped > 0 ? '+' : ''}${Math.round((clamped / rangeMax) * 100)}%`
        : `${clamped > 0 ? '+' : ''}${clamped}/${rangeMax}`

    return `<div class="rt-entity-sub-line rt-barrel-row">${labelHtml(segment)}
        <div class="rt-barrel-track"${barAttr(segment, { current: clamped, max: rangeMax, kind: 'barrel' })} aria-label="${escapeHtml(`${segment.label || 'Value'} ${display}`)}">
            ${controls}
            <div class="rt-barrel-center-marker"></div>
            <div class="rt-barrel-fill ${isPositive ? 'rt-barrel-positive' : 'rt-barrel-negative'}" data-barrel-direction="${isPositive ? 'positive' : 'negative'}" style="width:${pct.toFixed(1)}%;background:${fill};"></div>
        </div>
        <span class="rt-barrel-value rt-barrel-value-${direction}" data-barrel-direction="${direction}"${valueStyle}>${escapeHtml(display)}${suffix(rest)}</span>
    </div>`
}

/**
 * The two plain left-to-right bars, HP and PROGRESS.
 *
 * Class names are given explicitly rather than derived from a prefix, because
 * the legacy ones are not systematic — `rt-progress-bar` sits inside
 * `rt-progress-bar-wrap` but is labelled by `rt-progress-label`. Deriving them
 * would produce names the stylesheet port does not have rules for.
 */
interface BarClasses {
    row: string
    wrap: string
    bar: string
    /** Legacy has no class on the HP readout; `rt-hp-label` is ours. */
    label: string
}

function renderFilledBar(segment: ParsedSegment, classes: BarClasses, defaultColor: string): string {
    const fraction = parseFraction(segment.value)
    if (!fraction) return plainLine(segment)
    const fill = segmentFill(segment, defaultColor, fraction.percent)
    // The legacy's HP rule alone says whether the line coloured the bar; its PROGRESS does not.
    const recolor = classes.wrap === 'rt-hp-bar-wrap' ? { fill, explicit: !!segment.color, percent: true } : { fill, percent: true }

    return `<div class="rt-entity-sub-line ${classes.row}">${labelHtml(segment)}
        <div class="${classes.wrap}"${barAttr(segment, fraction, recolor)}>
            <div class="${classes.bar}" style="width:${fraction.percent.toFixed(1)}%;background:${fill};"></div>
        </div>
        <span class="${classes.label}">${fractionReadout(segment, fraction)}${suffix(fraction.rest)}</span>
    </div>`
}

const HP_BAR_CLASSES: BarClasses = {
    row: 'rt-hp-row',
    wrap: 'rt-hp-bar-wrap',
    bar: 'rt-hp-bar',
    label: 'rt-hp-label',
}

const PROGRESS_BAR_CLASSES: BarClasses = {
    row: 'rt-progress-row',
    wrap: 'rt-progress-bar-wrap',
    bar: 'rt-progress-bar',
    label: 'rt-progress-label',
}

function renderXpBar(segment: ParsedSegment): string {
    const fraction = parseFraction(segment.value)
    if (!fraction) return plainLine(segment)
    const level = segment.value.match(/level\s*(\d+)/i)?.[1] || ''
    const levelHtml = level ? `<span class="rt-xp-level">Lv ${escapeHtml(level)}</span> ` : ''
    const fill = segmentFill(segment, DEFAULT_COLORS.xpBar, fraction.percent)
    // The percentage readout, as the legacy's xp_bar rule draws it (74i).
    const showAsPct = segment.percentLabel === true
    const current = showAsPct ? String(Math.round(fraction.percent)) : fraction.currentText
    const max = showAsPct ? '100' : fraction.maxText

    return `<div class="rt-entity-sub-line rt-xp-row" data-xp-current="${fraction.current}" data-xp-max="${fraction.max}" data-xp-level="${escapeHtml(level)}" data-xp-show-percentage="${showAsPct}">${labelHtml(segment)}
        <div class="rt-xp-bar-wrap"${barAttr(segment, undefined, { fill, percent: true })}>
            <div class="rt-xp-bar" style="width:${fraction.percent.toFixed(1)}%;background:${fill};"></div>
        </div>
        <span class="rt-xp-readout">${levelHtml}<span class="rt-xp-current">${escapeHtml(current)}</span>/<span class="rt-xp-max">${escapeHtml(max)}</span></span>
    </div>`
}

function renderWeight(segment: ParsedSegment): string {
    const fraction = parseFraction(segment.value)
    if (!fraction) return plainLine(segment, '⚖️ ')
    // Green under three-quarters, amber approaching the cap, red at it.
    const fill = segmentFill(segment, fraction.percent >= 100 ? '#e74c3c' : fraction.percent >= 75 ? '#f1c40f' : '#2ecc71', fraction.percent)

    return `<div class="rt-entity-sub-line rt-weight-row">${labelHtml(segment)}
        <span class="rt-weight-icon">⚖️</span>
        <div class="rt-weight-bar-wrap"${barAttr(segment, fraction, { fill, percent: true })}>
            <div class="rt-weight-bar" style="width:${fraction.percent.toFixed(1)}%;background:${fill};"></div>
        </div>
        <span class="rt-weight-label">${fractionReadout(segment, fraction)}${suffix(fraction.rest)}</span>
    </div>`
}

function renderClock(segment: ParsedSegment): string {
    const fraction = parseFraction(segment.value)
    if (!fraction) return plainLine(segment)
    const fill = segmentFill(segment, DEFAULT_COLORS.clock, fraction.percent)

    return `<div class="rt-entity-sub-line rt-clock-row">${labelHtml(segment)}
        <div class="rt-clock-icon"${barAttr(segment, undefined, { fill })} style="background:conic-gradient(${fill} ${fraction.percent}%, transparent 0);"></div>
        <span class="rt-clock-label">${escapeHtml(fraction.currentText)}/${escapeHtml(fraction.maxText)}${suffix(fraction.rest)}</span>
    </div>`
}

function renderStars(segment: ParsedSegment): string {
    // A bare number is allowed and means "out of five".
    const m = segment.value.match(/(\d+)\s*\/\s*(\d+)/) || segment.value.match(/(\d+)/)
    if (!m) return plainLine(segment)
    const max = m[2] ? parseInt(m[2], 10) : 5
    const filled = Math.min(parseInt(m[1], 10), max)
    const rest = segment.value.replace(m[0], '').trim()
    const color = segmentFill(segment, DEFAULT_COLORS.stars, max > 0 ? (filled / max) * 100 : 0)

    const stars = '★'.repeat(Math.max(0, filled)) + '☆'.repeat(Math.max(0, max - filled))
    return `<div class="rt-entity-sub-line rt-stars-row">${labelHtml(segment)} <span class="rt-stars-icon"${barAttr(segment, undefined, { fill: color })} style="color:${color};">${stars}</span> <span class="rt-stars-label">${rest ? escapeHtml(rest) : ''}</span></div>`
}

function renderOrbs(segment: ParsedSegment): string {
    const fraction = parseFraction(segment.value)
    if (!fraction) return plainLine(segment)
    const color = segmentFill(segment, DEFAULT_COLORS.orbs, fraction.percent)

    let orbs = ''
    for (let i = 0; i < fraction.max; i++) {
        const filled = i < fraction.current
        const style = filled ? ` style="background:${color};box-shadow:0 0 5px ${color};"` : ''
        orbs += `<div class="rt-orb ${filled ? 'filled' : 'empty'}"${style}></div>`
    }

    return `<div class="rt-entity-sub-line rt-orbs-row">${labelHtml(segment)}
        <div class="rt-orbs-container"${barAttr(segment, undefined, { fill: color })}>${orbs}</div>
        <span class="rt-orbs-label">${fraction.rest ? escapeHtml(fraction.rest) : ''}</span>
    </div>`
}

function renderSlots(segment: ParsedSegment): string {
    // Slots alone accept fractional values, so half a slot can be drawn.
    const m = segment.value.match(/(\d+(?:\.\d+)?|\.\d+)\s*\/\s*(\d+(?:\.\d+)?|\.\d+)/)
    if (!m) return plainLine(segment)
    const max = Number(m[2])
    const current = Math.max(0, Math.min(Number(m[1]), max))
    const rest = segment.value.replace(m[0], '').trim()
    const color = segmentFill(segment, DEFAULT_COLORS.slots, max > 0 ? (current / max) * 100 : 0)

    let slots = ''
    for (let i = 0; i < Math.ceil(max); i++) {
        const fill = Math.max(0, Math.min(1, current - i))
        const state = fill >= 1 ? 'filled' : fill > 0 ? 'partial' : 'empty'
        const inner = fill > 0 ? `<span class="rt-slot-fill" style="width:${fill * 100}%;background:${color};"></span>` : ''
        slots += `<div class="rt-slot ${state}">${inner}</div>`
    }

    const tooltip = `${segment.label || 'Value'} ${m[1]}/${m[2]}${rest ? ` ${rest}` : ''}`
    return `<div class="rt-entity-sub-line rt-slots-row">${labelHtml(segment)}
        <div class="rt-slots-container"${barAttr(segment, undefined, { fill: color })} title="${escapeHtml(tooltip)}" aria-label="${escapeHtml(tooltip)}">${slots}</div>
        <span class="rt-slots-label">${rest ? escapeHtml(rest) : ''}</span>
    </div>`
}

function renderPhase(segment: ParsedSegment): string {
    const fraction = parseFraction(segment.value)
    if (!fraction) return plainLine(segment)
    const color = segmentFill(segment, DEFAULT_COLORS.phase, fraction.percent)

    let nodes = ''
    for (let i = 0; i < fraction.max; i++) {
        const isPast = i < fraction.current - 1
        const isCurrent = i === fraction.current - 1
        const state = isPast ? 'past' : isCurrent ? 'current' : 'future'
        const style =
            (isPast || isCurrent ? `background:${color};border-color:${color};` : '') +
            (isCurrent ? `box-shadow:0 0 8px ${color};` : '')
        nodes += `<div class="rt-phase-node ${state}" style="${style}"></div>`
        if (i < fraction.max - 1) {
            nodes += `<div class="rt-phase-line ${isPast ? 'filled' : 'empty'}" style="${isPast ? `background:${color};` : ''}"></div>`
        }
    }

    return `<div class="rt-entity-sub-line rt-phase-row">${labelHtml(segment)}
        <div class="rt-phase-container"${barAttr(segment, undefined, { fill: color })}>${nodes}</div>
        <span class="rt-phase-label">${escapeHtml(fraction.currentText)}/${escapeHtml(fraction.maxText)}${suffix(fraction.rest)}</span>
    </div>`
}

function renderGauge(segment: ParsedSegment): string {
    const fraction = parseFraction(segment.value)
    if (!fraction) return plainLine(segment)
    const fill = segmentFill(segment, DEFAULT_COLORS.gauge, fraction.percent)
    const degrees = -90 + 180 * (fraction.percent / 100)

    return `<div class="rt-entity-sub-line rt-gauge-row">${labelHtml(segment)}
        <div class="rt-gauge-wrap"${barAttr(segment, undefined, { fill, percent: true })}>
            <div class="rt-gauge-bg" style="background:${fill};"></div>
            <div class="rt-gauge-needle" style="transform:rotate(${degrees.toFixed(1)}deg);"></div>
        </div>
        <span class="rt-gauge-label">${fractionReadout(segment, fraction)}${suffix(fraction.rest)}</span>
    </div>`
}

function renderCharge(segment: ParsedSegment): string {
    const fraction = parseFraction(segment.value)
    if (!fraction) return plainLine(segment)
    const isLow = fraction.current <= 1 && fraction.max > 1
    const color = segmentFill(segment, isLow ? '#e74c3c' : '#2ecc71', fraction.percent)

    return `<div class="rt-entity-sub-line rt-charge-row">${labelHtml(segment)}
        <div class="rt-battery-wrap${isLow && fraction.current === 0 ? ' empty-flash' : ''}"${barAttr(segment, fraction, { fill: color, percent: true })} style="border-color:${color};">
            <div class="rt-battery-fill" style="width:${fraction.percent.toFixed(1)}%;background:${color};"></div>
            <div class="rt-battery-nub" style="background:${color};"></div>
        </div>
        <span class="rt-charge-label">${fractionReadout(segment, fraction)}${suffix(fraction.rest)}</span>
    </div>`
}

function weatherIcon(value: string): string {
    const lower = value.toLowerCase()
    if (/rain|storm|wet/.test(lower)) return '🌧️'
    if (/snow|cold|ice|blizzard/.test(lower)) return '❄️'
    if (/sun|hot|clear/.test(lower)) return '☀️'
    if (/cloud|overcast/.test(lower)) return '☁️'
    if (/wind/.test(lower)) return '🌬️'
    if (/fog/.test(lower)) return '🌫️'
    if (/night|dark/.test(lower)) return '🌙'
    return '🌤️'
}

/**
 * The TIME card's lines as Multihog's renderer draws them (74c, the same
 * function the day/night cycle reads): a line with a clock in it takes the
 * hour's emoji and colour (`getTimeOfDayInfo`, the legacy's own, from the
 * nineteenth generated file), and *Last Rest* says how long ago it was
 * against the first line that reads as a clock — the legacy's `case 'TIME'`,
 * over the block's raw lines as it works. A marker line is drawn as a
 * marker, as its `tryRenderMarker` does first.
 */
function renderTimeLines(raw: string, lines: TrackerLine[]): string {
    const rawLines = raw.split('\n').map((line) => line.trim()).filter(Boolean)
    let current: number | null = null
    for (const line of rawLines) {
        if (line.toLowerCase().startsWith('last rest:')) continue
        if (current === null) current = parseInWorldTime(line)
    }
    return rawLines.map((line, index) => {
        if (line.toLowerCase().startsWith('last rest:')) {
            const restVal = line.substring(line.indexOf(':') + 1).trim()
            let append = ''
            if (current !== null && !isRestTimeUnset(restVal)) {
                const restMins = parseInWorldTime(restVal)
                if (restMins !== null && current - restMins >= 0) append = `&nbsp;<span style="opacity: 0.7; font-size: 1em;">(${formatTimeDiff(current - restMins, false)})</span>`
            }
            return `<div class="rt-card-item rt-card-item--plain rt-card-line"><b>Last Rest:</b>&nbsp;${escapeHtmlWithColor(restVal)}${append}</div>`
        }
        const parsed = lines[index]
        if (parsed && parsed.kind === 'markers') return renderLine(parsed)
        const { emoji, color } = getTimeOfDayInfo(line)
        const prefix = emoji ? `<span class="rt-tod-emoji" style="margin-right:4px;">${emoji}</span>` : ''
        const content = color !== 'inherit' ? `<span style="color: ${color};">${escapeHtmlWithColor(line)}</span>` : escapeHtmlWithColor(line)
        return `<div class="rt-card-item rt-card-item--plain rt-card-line">${prefix}${content}</div>`
    }).join('')
}

/**
 * The XP card as Multihog draws it (74f): the legacy's `case 'XP'` over the
 * block's raw lines — a marker line as a marker first, then the stock
 * `Total: 1,200 / 2,700 XP (Level 3)` or the older `Level: 3 | XP: 1,200/2,700`
 * as the experience row (the level, the count, the bar), anything else as it
 * was. The row's shape is the legacy's, since the bottom bar's rules dress it.
 */
function renderXpLines(raw: string, lines: TrackerLine[], bars?: BarPrefs): string {
    const rawLines = raw.split('\n').map((line) => line.trim()).filter(Boolean)
    return rawLines.map((line, index) => {
        const parsed = lines[index]
        if (parsed && parsed.kind === 'markers') return renderLine(parsed)
        const row = renderXpRow(line, barPrefFor(bars, XP_BAR_ID))
        if (row) return row
        return parsed ? renderLine(parsed) : `<div class="rt-card-item rt-card-item--plain">${escapeHtmlWithColor(line)}</div>`
    }).join('')
}

/** The XP card's row carries the legacy's own bar id, so a recolour of it is kept under the same key. */
const XP_BAR_ID = 'XP::XP'

/** The legacy's two XP formats as its experience row, or null for a line that is neither. */
function renderXpRow(line: string, pref: BarPref = {}): string | null {
    let level = ''
    let curRaw = ''
    let maxRaw = ''
    const stock = line.match(/Total:\s*([\d,]+)\s*\/\s*([\d,]+)\s*XP\s*\(Level\s*(\d+)\)/i)
    if (stock) {
        ;[, curRaw, maxRaw, level] = stock as unknown as [string, string, string, string]
    } else {
        const older = line.match(/(?:Level:\s*(\d+)\s*\|?\s*)?XP:\s*([\d,]+)\/([\d,]+)/i)
        if (!older) return null
        level = older[1] ?? ''
        curRaw = older[2]!
        maxRaw = older[3]!
    }
    const cur = Number(curRaw.replace(/,/g, ''))
    const max = Number(maxRaw.replace(/,/g, ''))
    const pct = Math.max(0, Math.min(100, (cur / max) * 100))
    const levelHtml = level ? `<span>Level ${escapeHtml(level)}</span>` : ''
    // The fill and the readout through the legacy's resolver under its id (74i).
    const fill = barBackground(pref, XP_BAR_ID, DEFAULT_COLORS.xpBar, pct)
    const showAsPct = barShowsPercentage(pref, XP_BAR_ID)
    const current = showAsPct ? String(Math.round(pct)) : curRaw
    const maximum = showAsPct ? '100' : maxRaw
    return `<div class="rt-xp-row" data-xp-current="${cur}" data-xp-max="${max}" data-xp-level="${escapeHtml(level)}" data-xp-show-percentage="${showAsPct}">
        <div class="rt-xp-label">${levelHtml}<span>XP: <span class="rt-xp-current">${escapeHtml(current)}</span> / <span class="rt-xp-max">${escapeHtml(maximum)}</span></span></div>
        <div class="rt-xp-bar-wrap"${recolorAttrs(XP_BAR_ID, fill, undefined, 'Click to recolor XP', true)}>
            <div class="rt-xp-bar" style="width:${pct.toFixed(1)}%;background:${fill};"></div>
        </div>
    </div>`
}

/**
 * The XP bar at the bottom (74f, Multihog's `renderBottomXpBar`): the XP
 * block's experience row alone, wrapped for the foot of the box, or nothing
 * when the memo holds no XP block or its block holds no row. Drawn by the
 * same lines as the card, so the two never disagree.
 */
export function renderBottomXpBar(view: TrackerView, bars?: BarPrefs): string {
    const block = view.blocks.find((candidate) => candidate.tag === 'XP')
    if (!block) return ''
    const rawLines = block.raw.split('\n').map((line) => line.trim()).filter(Boolean)
    const items = rawLines.map((line, index) => {
        const parsed = block.lines[index]
        if (parsed && parsed.kind === 'markers') return renderLine(parsed)
        return renderXpRow(line, barPrefFor(bars, XP_BAR_ID)) ?? ''
    })
    const row = items.find((item) => /class="[^"]*\brt-xp-row\b/.test(item))
    return row ? `<div class="rt-bottom-xp-content">${row}</div>` : ''
}

/** Draw one marked value. */
export function renderSegment(segment: ParsedSegment): string {
    const label = labelHtml(segment)
    const value = segment.value

    switch (segment.renderType) {
        case 'pills':
            return `<div class="rt-entity-sub-line rt-units-container">${label} ${renderPills(value, segment.color)}</div>`

        case 'pill_colored': {
            const style = segment.color ? ` style="${makeColorTintStyle(segment.color)}"` : ''
            const pills = splitSmart(value)
                .map((raw) => {
                    const m = raw.trim().match(/^(.*?)\s*\((.*?)\)$/)
                    const name = m ? m[1].trim() : raw.trim()
                    const desc = m ? m[2].trim() : ''
                    const descHtml = desc ? `<div class="rt-unit-descr">${escapeHtml(desc)}</div>` : ''
                    const titleAttr = desc ? ` title="${escapeHtml(desc)}"` : ''
                    return `<span class="rt-unit-pill${desc ? '' : ' no-desc'}"${style}${titleAttr}><span class="rt-unit-name">${escapeHtml(name)}</span>${descHtml}</span>`
                })
                .join(' ')
            return `<div class="rt-entity-sub-line rt-units-container">${label} ${pills}</div>`
        }

        case 'badge': {
            const style = segment.color ? ` style="${makeColorTintStyle(segment.color)}"` : ''
            return `<div class="rt-entity-sub-line rt-units-container">${label} <span class="rt-unit-pill no-desc"${style}><span class="rt-unit-name">${escapeHtmlWithColor(value)}</span></span></div>`
        }

        case 'badge_colored':
            return `<div class="rt-entity-sub-line">${label}<span class="rt-difficulty-badge" style="${makeColorTintStyle(segment.color || '#fff')}">${escapeHtmlWithColor(value)}</span></div>`

        case 'highlight': {
            const highlighted = highlightParens(escapeHtmlWithColor(value))
            const wrapped = segment.color ? `<span style="color:${segment.color};">${highlighted}</span>` : highlighted
            return `<div class="rt-entity-sub-line">${label} ${wrapped}</div>`
        }

        case 'objective': {
            const done = /^[✓✔☑]/.test(value)
            const failed = /^[✗✘☒]/.test(value)
            const text = value.replace(/^[✓✔☑✗✘☒○◯◦]\s*/, '').trim()
            const statusClass = done ? 'rt-obj-done' : failed ? 'rt-obj-failed' : 'rt-obj-pending'
            const icon = done ? '✓' : failed ? '✗' : '○'
            return `<div class="rt-objective ${statusClass}">${label}<span class="rt-obj-icon">${icon}</span> <span class="rt-obj-text">${escapeHtmlWithColor(text)}</span></div>`
        }

        case 'reward': {
            const style = segment.color ? ` style="${makeColorTintStyle(segment.color, 0, 40)}"` : ''
            return `<div class="rt-entity-sub-line"><span class="rt-reward-chip"${style}>${label ? `${label} ` : ''}🎁 ${escapeHtmlWithColor(value)}</span></div>`
        }

        case 'difficulty': {
            const color = segment.color || DIFFICULTY_COLORS[value.toLowerCase()] || '#aaa'
            return `<div class="rt-entity-sub-line">${label}<span class="rt-difficulty-badge" style="background:${color}22;color:${color};border:1px solid ${color}55;">${escapeHtmlWithColor(value)}</span></div>`
        }

        case 'coin':
            return `<div class="rt-entity-sub-line">${label}<span class="rt-coin-badge" style="${makeColorTintStyle(segment.color || '#fff', 0, 27)}">${segment.icon || '🪙'} ${escapeHtmlWithColor(value)}</span></div>`

        case 'dice_roll': {
            const style = segment.color
                ? makeColorTintStyle(segment.color)
                : 'background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);'
            return `<div class="rt-entity-sub-line">${label}<span class="rt-dice-roll" style="${style}"><i class="fa-solid fa-dice-d20"></i> ${escapeHtmlWithColor(value)}</span></div>`
        }

        case 'weather':
            return `<div class="rt-entity-sub-line">${label} <span class="rt-weather-badge">${weatherIcon(value)} ${escapeHtmlWithColor(value)}</span></div>`

        case 'hp_bar':
            return renderFilledBar(segment, HP_BAR_CLASSES, DEFAULT_COLORS.hpBar)
        case 'progress':
            return renderFilledBar(segment, PROGRESS_BAR_CLASSES, DEFAULT_COLORS.progress)
        case 'xp_bar':
            return renderXpBar(segment)
        case 'barrel':
            return renderBarrel(segment)
        case 'weight':
            return renderWeight(segment)
        case 'clock':
            return renderClock(segment)
        case 'stars':
            return renderStars(segment)
        case 'orbs':
            return renderOrbs(segment)
        case 'slots':
            return renderSlots(segment)
        case 'phase':
            return renderPhase(segment)
        case 'gauge':
            return renderGauge(segment)
        case 'charge':
            return renderCharge(segment)

        case 'npc':
            // A freeform NPC card, which needs the portrait and lorebook lookup
            // that Phase 1 has not ported yet. Drawn as a named row for now so
            // the state is visible rather than dropped.
            return `<div class="rt-entity-row rt-entity-row--npc"><div class="rt-entity-name">${escapeHtmlWithColor(segment.label || value)}</div></div>`

        case 'text':
        default: {
            const text = escapeHtmlWithColor(value)
            const wrapped = segment.color ? `<span style="color:${segment.color};">${text}</span>` : text
            return `<div class="rt-entity-sub-line">${label} ${wrapped}</div>`
        }
    }
}

/** Render types that stretch to fill a multi-marker row; everything else sits at its own width. */
const STRETCH_TYPES = new Set(['barrel', 'hp_bar', 'xp_bar', 'progress'])

/** Draw one line of a block. */
// ── Pips (38) ──────────────────────────────────────────────────────────────

/** A row of pips, `count` of them with the first `lit` filled. The legacy lights `i < lit`, so more lit than slots lights them all. */
function pips(count: number, lit: number, pipClass: string, litClass: string, usedClass: string): string {
    return Array.from({ length: Math.max(0, count) }, (_, i) => `<span class="${pipClass}${i < lit ? ` ${litClass}` : usedClass ? ` ${usedClass}` : ''}"></span>`).join('')
}

/** One spell group as the legacy's row: the level, its slots as blue pips, the spells as chips linking to the wiki. */
function renderSpellGroup(group: SpellGroup): string {
    const slots = group.slots
        ? `<span class="rt-slot-pips">${pips(group.slots.max, group.slots.available, 'rt-slot-pip', 'rt-slot-available', 'rt-slot-used')}</span>`
        : ''
    const names = group.spells
        .map((name) => `<a href="${SPELL_WIKI}${spellSlug(name)}" target="_blank" rel="noopener" class="rt-spell-name" title="View spell on Wikidot">${escapeHtmlWithColor(name)}</a>`)
        .join('')
    return `<div class="rt-spell-row"><span class="rt-spell-level">${escapeHtmlWithColor(group.label)}</span><div class="rt-spell-inline-group"><div class="rt-spell-list">${slots}${names}</div></div></div>`
}

function renderSpells(line: Extract<TrackerLine, { kind: 'spells' }>): string {
    if (line.groups.length) return line.groups.map(renderSpellGroup).join('')
    // A `Spells:` sub-line with no level on it: a flat list, as pills.
    return `<div class="rt-entity-sub-line rt-units-container"><span class="rt-entity-sub-label">Spells:</span>${renderPills(line.flat ?? '')}</div>`
}

function renderHitDice(line: Extract<TrackerLine, { kind: 'hd' }>): string {
    return `<div class="rt-entity-sub-line"><span class="rt-entity-sub-label">HD:</span><span class="rt-entity-sub-value"><span class="rt-hd-label">[ ${escapeHtmlWithColor(line.die)} ]</span> <span class="rt-hd-pips">${pips(line.max, line.current, 'rt-hd-pip', 'rt-hd-available', '')}</span></span></div>`
}

export function renderLine(line: TrackerLine): string {
    if (line.kind === 'spells') return renderSpells(line)
    if (line.kind === 'hd') return renderHitDice(line)
    // A pair with a rule is an entity's line by construction (40): drawn as the entity draws it.
    if (line.kind === 'kv' && line.rule) return renderEntityLine(line)

    if (line.kind === 'kv') {
        return `<div class="rt-card-kv"><span class="rt-card-key">${escapeHtmlWithColor(`${line.label}:`)}</span><span class="rt-card-val">${escapeHtmlWithColor(line.value)}</span></div>`
    }

    if (line.kind === 'text') {
        return `<div class="rt-card-item rt-card-item--plain">${escapeHtmlWithColor(line.text)}</div>`
    }

    if (line.layout === 'single') return renderSegment(line.segments[0])

    const cells = line.segments
        .map((segment) => {
            const cellClass =
                line.layout === 'tab-stops'
                    ? 'rt-mmc-cell rt-mmc-cell--tab-stop'
                    : line.layout === 'columns'
                      ? 'rt-mmc-cell rt-mmc-cell--column'
                      : STRETCH_TYPES.has(segment.renderType)
                        ? 'rt-mmc-cell rt-mmc-cell--stretch'
                        : 'rt-mmc-cell'
            // Tab stops are percentages; the grid is 1000 columns wide so a
            // tenth of a percent still lands on its own track.
            const style = segment.span
                ? ` style="grid-column:${Math.round(segment.span.start * 10) + 1} / ${Math.round(segment.span.end * 10) + 1};grid-row:1;"`
                : ''
            return `<div class="${cellClass}"${style}>${renderSegment(segment)}</div>`
        })
        .join('')

    const rowClass = [
        'rt-multi-marker-row',
        line.layout === 'tab-stops' ? 'rt-multi-marker-row--tab-stops' : '',
        line.layout === 'columns' ? 'rt-multi-marker-row--columns' : '',
        line.compactPills ? 'rt-multi-marker-row--compact-pills' : '',
    ]
        .filter(Boolean)
        .join(' ')

    return `<div class="${rowClass}">${cells}</div>`
}

// ── Entity cards ───────────────────────────────────────────────────────────

/** One of the labelled fields off an anchor line: AC, Saves, Status, Res, Other, Info. */
function renderEntityField(field: EntityField): string {
    const label = field.label ? `<span class="rt-entity-sub-label">${escapeHtml(field.label)}:</span>` : ''

    if (field.kind === 'pills') {
        return `<div class="rt-entity-sub-line rt-units-container">${label}${renderPills(field.value)}</div>`
    }
    // The value is wrapped in one element on purpose. The row is a flex
    // container with a gap, so a value that renders as several nodes — which is
    // exactly what highlighting the parentheses does — would have that gap
    // opened up inside it, printing `Str (+5) , Dex (+2)`.
    const value =
        field.kind === 'highlight'
            ? highlightParens(escapeHtmlWithColor(field.value))
            : escapeHtmlWithColor(field.value)
    return `<div class="rt-entity-sub-line">${label}<span class="rt-entity-sub-value">${value}</span></div>`
}

/**
 * Draw one line that hangs off an entity.
 *
 * A `Key: value` line inside a card is a sub-line, not the block-level row the
 * generic renderer would give it — it sits under a name, alongside the `AC:`
 * and `Status:` fields off the anchor, and should read like them. Marker lines
 * are handed straight to the ordinary renderer, which is the whole point of the
 * layering: the entity grammar says who a line belongs to, the marker grammar
 * says what it looks like. Matches `renderLineInEntityContext` at the pin.
 */
function renderEntityLine(line: TrackerLine): string {
    if (line.kind === 'spells') return renderSpells(line)
    if (line.kind === 'hd') return renderHitDice(line)
    if (line.kind === 'kv') {
        const label = `<span class="rt-entity-sub-label">${escapeHtmlWithColor(`${line.label}:`)}</span>`
        // The stock labels' rules (40): skills and status as pills, combat and
        // saves with their numbers lit, AC as written; the rest highlighted.
        if (line.rule === 'pills') return `<div class="rt-entity-sub-line rt-units-container">${label}${renderPills(line.value)}</div>`
        const value =
            line.rule === 'numbers'
                ? highlightNumbers(escapeHtmlWithColor(line.value))
                : line.rule === 'text'
                  ? escapeHtmlWithColor(line.value)
                  : highlightParens(escapeHtmlWithColor(line.value))
        return `<div class="rt-entity-sub-line">${label}<span class="rt-entity-sub-value">${value}</span></div>`
    }
    if (line.kind === 'text') {
        return `<div class="rt-entity-sub-line"><span class="rt-entity-sub-value">${escapeHtmlWithColor(line.text)}</span></div>`
    }
    return renderLine(line)
}

/**
 * Draw one entity as a card.
 *
 * The hit-point bar is the header rather than a row inside the card, because it
 * is the one number a reader is scanning for in a fight. An entity with no hit
 * points at all — a character sheet, usually — just gets its name.
 */
export function renderEntityCard(entity: EntityCardView): string {
    const hp = entity.hp
        ? `<div class="rt-hp-bar-wrap${entity.hp.unknown ? ' rt-hp-unknown' : ''}" data-rt-bar-id="${escapeHtml(entity.hp.barId)}"${barValueAttrs(entity.hp, entity.hp.animate)}${recolorAttrs(entity.hp.barId, entity.hp.color, entity.hp.explicitColor, 'Click to recolor HP', true)} aria-label="${escapeHtml(`${entity.name} HP ${entity.hp.label}`)}">
            <div class="rt-hp-bar" style="width:${entity.hp.percent.toFixed(1)}%;background:${entity.hp.color};"></div>
        </div>
        <span class="rt-hp-label">${escapeHtml(entity.hp.label)}</span>`
        : ''

    const body = entity.fields.map(renderEntityField).join('') + entity.lines.map(renderEntityLine).join('')

    const cardClass = [
        'rt-entity-card',
        entity.defeated ? 'rt-entity-card--defeated' : '',
        entity.side ? `rt-entity-card--${entity.side}` : '',
    ]
        .filter(Boolean)
        .join(' ')

    /**
     * The portrait, when one is set.
     *
     * `loading="lazy"` because a combat round can carry a dozen of these and
     * the same cards now hang under every message; `alt=""` because the name is
     * already beside it in text, and a screen reader repeating it would be
     * noise. The view decided whether the reference is safe to use at all.
     *
     * `data-lh-large` names it as a picture a click opens large (Phase 64):
     * the cards' delegated handlers read the attribute, since a listener on
     * the image would go with the next redraw. The name is the modal's
     * title, escaped as `data-entity` is.
     */
    const portrait = entity.portrait
        ? `<img class="rt-entity-portrait" src="${escapeHtml(entity.portrait)}" alt="" loading="lazy" data-lh-large="${escapeHtml(entity.name)}" role="button" tabindex="0" title="Open the picture large">`
        : ''

    // A row with no HP bar lets the name take the full width (47e-ter,
    // upstream 2026.9.x): nothing is reserved for a bar that is not there.
    return `<div class="${cardClass}" data-entity="${escapeHtml(entity.name)}">
        <div class="rt-entity-row${entity.hp ? '' : ' rt-entity-row--bare'}">
            ${portrait}
            <div class="rt-entity-name">${escapeHtmlWithColor(entity.name)}</div>
            ${hp}
        </div>
        ${body ? `<div class="rt-entity-body">${body}</div>` : ''}
    </div>`
}

/** Draw a whole entity block: round and side headers, cards, and any loose lines. */
export function renderEntityBlock(view: EntityBlockView): string {
    return view.tokens
        .map((token) => {
            switch (token.kind) {
                case 'round':
                    return `<div class="rt-combat-round">${escapeHtmlWithColor(token.label)}</div>`
                case 'side':
                    return `<div class="rt-combat-side rt-combat-side--${token.side}">${escapeHtml(token.label)}</div>`
                case 'entity':
                    return renderEntityCard(token.entity)
                case 'line':
                    // A line before any entity anchored. Drawn as an ordinary
                    // line rather than dropped — it is still state.
                    return renderLine(token.line)
            }
        })
        .join('')
}

// ── The quest log ──────────────────────────────────────────────────────────

/**
 * Draw one quest as a card.
 *
 * The layout is the legacy one — title and status badge, giver, ticked
 * objectives, reward chips, then the two time rows — because it is the layout
 * the maintainer already reads. Everything it draws was decided in
 * `quest-view.ts`; nothing here does arithmetic.
 */
export function renderQuestCard(quest: QuestCardView): string {
    const objectives = quest.objectives
        .map((objective) => {
            const state = objective.done ? ' rt-quest-obj--done' : objective.failed ? ' rt-quest-obj--failed' : ''
            const progress = objective.progress
                ? ` <span class="rt-quest-progress">${escapeHtml(objective.progress)}</span>`
                : ''
            const optional = objective.required ? '' : ' <span class="rt-quest-optional">(optional)</span>'
            return `<div class="rt-quest-obj${state}">
                <span class="rt-quest-check">${objective.icon}</span>
                <span class="rt-quest-obj-text">${escapeHtmlWithColor(objective.text)}${progress}${optional}</span>
            </div>`
        })
        .join('')

    const rewards = quest.rewards
        .map((reward) => `<span class="rt-quest-reward">🎁 ${escapeHtmlWithColor(reward)}</span>`)
        .join('')

    const accepted = quest.accepted
        ? `<div class="rt-quest-time">
            <span class="rt-entity-sub-label">Accepted:</span>
            <span>${escapeHtml(quest.accepted.time)}</span>
            ${quest.accepted.elapsed ? `<i class="rt-quest-ago">(${escapeHtml(quest.accepted.elapsed)})</i>` : ''}
        </div>`
        : ''

    // The mood bar lives inside the deadline row, so switching deadlines off
    // takes it with them. That is the legacy arrangement and it is the right
    // one: the bar measures a position between accepting and the deadline, and
    // means nothing next to a deadline that is not on screen.
    const mood = quest.mood
    // The legacy showed this word only with frustration switched on, leaving the
    // clock vocabulary — `Near Deadline`, `Overdue` — computed but never drawn.
    // It is shown either way here: an unlabelled bar is the thing a reader has
    // to ask about, and the clock words exist precisely to be readable.
    const moodLabel = mood?.label
        ? `<span class="rt-quest-mood-label" style="color:${mood.color};">${escapeHtml(mood.label)}</span>`
        : ''
    const moodBar = mood
        ? `<div class="rt-quest-mood-bar-wrap" title="${escapeHtml(mood.title)}">
            <div class="rt-quest-mood-bar" style="width:${mood.fillPercent}%;background:${mood.color};"></div>
            <div class="rt-quest-mood-tick rt-quest-mood-tick--neutral"></div>
            <div class="rt-quest-mood-tick rt-quest-mood-tick--deadline"></div>
        </div>`
        : ''

    const deadline = quest.deadline
        ? `<div class="rt-quest-time${quest.deadline.overdue ? ' rt-quest-time--overdue' : ''}">
            <span class="rt-entity-sub-label">Deadline:</span>
            <span>${escapeHtml(quest.deadline.time)}</span>
            ${quest.deadline.remaining ? `<i class="rt-quest-ago">(${escapeHtml(quest.deadline.remaining)})</i>` : ''}
            ${moodLabel}
        </div>${moodBar}`
        : ''

    const cardClass = ['rt-quest-card', quest.tone === 'active' ? '' : 'rt-quest-card--inactive', `rt-quest-card--${quest.tone}`]
        .filter(Boolean)
        .join(' ')

    return `<div class="${cardClass}" data-quest-id="${escapeHtml(quest.id)}">
        <div class="rt-quest-header">
            <span class="rt-quest-title">${escapeHtmlWithColor(quest.title)}</span>
            <span class="rt-quest-badge rt-quest-badge--${quest.tone}">${escapeHtml(quest.statusLabel)}</span>
        </div>
        <div class="rt-quest-giver">${escapeHtmlWithColor(quest.giverName)}${quest.emergent ? '' : ` · <em>${escapeHtmlWithColor(quest.giverLocation)}</em>`}</div>
        ${objectives ? `<div class="rt-quest-objectives">${objectives}</div>` : ''}
        ${rewards ? `<div class="rt-quest-rewards">${rewards}</div>` : ''}
        ${accepted}
        ${deadline}
    </div>`
}

/** One folded-away group of finished quests, under the active ones. */
function renderQuestArchive(tag: string, icon: string, title: string, quests: QuestCardView[], collapsed: boolean): string {
    if (!quests.length) return ''
    const count = `${quests.length} ${quests.length === 1 ? 'entry' : 'entries'}`

    return `<div class="rt-quest-archive${collapsed ? ' rt-section--collapsed' : ''}" data-tag="${escapeHtml(tag)}">
        <div class="rt-section-header" role="button" tabindex="0" aria-expanded="${!collapsed}">
            <span class="rt-section-icon">${icon}</span>
            <span class="rt-section-title">${escapeHtml(title)}</span>
            <span class="rt-section-count">${count}</span>
        </div>
        <div class="rt-section-body"${collapsed ? ' hidden' : ''}>${quests.map(renderQuestCard).join('')}</div>
    </div>`
}

/** Draw the quest log: the active quests, then the archive. */
export function renderQuestLog(log: QuestLogView, options: CardOptions = {}): string {
    const collapsed = options.collapsed
    const active = log.active.length
        ? log.active.map(renderQuestCard).join('')
        : '<div class="rt-quest-none">No active quests.</div>'

    return (
        active +
        renderQuestArchive('QUESTS_COMPLETED', '✅', 'Completed', log.completed, collapsed?.has('QUESTS_COMPLETED') ?? true) +
        renderQuestArchive('QUESTS_FAILED', '❌', 'Failed', log.failed, collapsed?.has('QUESTS_FAILED') ?? true)
    )
}

export interface CardOptions {
    /** Tags whose cards are drawn with their bodies folded away. */
    collapsed?: ReadonlySet<string>
    /** The PARTY card compact (47e-ter): each member as portrait, name and HP, the sheet hidden. */
    partyCompact?: boolean
    /** Draw the Compact button in the PARTY card's header; the panel does, the cards under messages do not. */
    partyCompactButton?: boolean
    /** The inventory's worth (72b): the total in the header, and the worth as a tooltip or an inline badge. Absent: the lines as they are. */
    inventory?: { showTotal: boolean; worthMode: 'hover' | 'display' }
    /** The XP bar at the bottom (74f): the XP card is left out of the cards, the bar standing for it at the foot of the box. */
    xpBarAtBottom?: boolean
    /** The per-bar choices (74i), for the XP card's row, whose bar is no marker's and so carries no preference of its own. */
    bars?: BarPrefs
    /** The Display Groups (75): with the switch on, the members of each enabled group present in the memo draw under one shared header, their own headers hidden. */
    displayGroups?: { groups: readonly DisplayGroup[]; enabled: boolean; showGaps: boolean }
    /** Tab Mode (76): the tab to show (the first when it names none), and the chat's portraits for the vitals strip. */
    tabMode?: { activeTab: string; portraits?: Record<string, string> }
}

/** One inventory line (72b): the item with its worth as the mode says, or the sum of money as a badge. */
function renderInventoryItem(item: InventoryItem, worthMode: 'hover' | 'display'): string {
    const equipped = item.equipped ? ' rt-inventory-item--equipped' : ''
    if (item.isCurrency) {
        const badge = item.color ? `<span class="rt-coin-badge" style="color:${item.color}">${escapeHtmlWithColor(item.text)}</span>` : escapeHtmlWithColor(item.text)
        return `<div class="rt-card-item rt-inventory-item">${badge}</div>`
    }
    const title = item.tooltip ? ` title="${escapeHtml(item.tooltip)}"` : ''
    const badge = item.worth && worthMode === 'display' && item.color ? ` <span class="rt-coin-badge" style="color:${item.color}">${escapeHtml(item.worth)}</span>` : ''
    return `<div class="rt-card-item rt-inventory-item${equipped}"${title}>${escapeHtmlWithColor(item.text)}${badge}</div>`
}

/** The PARTY card's Compact button, upstream's (2026.8.80): pressed when the mode is on. */
function renderPartyCompactButton(on: boolean): string {
    const title = on ? 'Show the whole sheet of each member' : 'Compact: portrait, name and HP only'
    return `<button type="button" class="rt-party-compact-btn${on ? ' active' : ''}" data-rt-party-compact="1" aria-pressed="${on ? 'true' : 'false'}" title="${title}">Compact</button>`
}

/**
 * The benched roster, drawn inside the PARTY card as a camp: the members who
 * are away, each with the status that says where and since when. Full sheets
 * are in the memo; the card shows them the same way it shows the active
 * roster, because they are the same kind of entry.
 */
function renderBenchedRoster(benched: TrackerBlock): string {
    const body = benched.entities ? renderEntityBlock(benched.entities) : benched.lines.map(renderLine).join('')
    const count = benched.entities ? benched.entities.count : benched.lines.length
    return `<div class="rt-benched" data-tag="${escapeHtml(benched.tag)}">
        <div class="rt-benched-head">
            <span class="rt-section-icon">${escapeHtml(benched.icon)}</span>
            <span class="rt-benched-title">Benched</span>
            <span class="rt-section-count">${count} away</span>
        </div>
        ${body}
    </div>`
}

/** What a block's card is made of, so a group can draw the body alone (75). */
interface BlockParts {
    body: string
    count: string
    bodyClass: string
    compact: boolean
    compactButton: string
}

function blockParts(block: TrackerBlock, options: CardOptions, benched: TrackerBlock | null): BlockParts {
    // Three ways to draw a block, in this order. A block that has neither a
    // quest log nor entities on it — including one whose own grammar failed to
    // read it — falls through to its plain lines, which is what keeps an
    // unrecognised block visible rather than empty.
    // The inventory's worth (72b): text lines read for their annotations, the rest drawn as they are.
    const inventory = block.tag === 'INVENTORY' && options.inventory && !block.quests && !block.entities
        ? block.lines.map((line) => (line.kind === 'text' ? readInventoryItem(line.text) : null))
        : null
    const body =
        (block.quests
            ? renderQuestLog(block.quests, options)
            : block.entities
              ? renderEntityBlock(block.entities)
              : inventory
                ? block.lines.map((line, i) => { const item = inventory[i]; return item ? renderInventoryItem(item, options.inventory!.worthMode) : renderLine(line) }).join('')
                : block.tag === 'TIME'
                  ? renderTimeLines(block.raw, block.lines)
                  : block.tag === 'XP'
                    ? renderXpLines(block.raw, block.lines, options.bars)
                    : block.lines.map(renderLine).join('')) + (benched ? renderBenchedRoster(benched) : '')

    const total = inventory && options.inventory?.showTotal ? inventoryTotal(inventory.filter((i): i is InventoryItem => i !== null)) : null
    const count = block.quests
        ? `<span class="rt-section-count">${block.quests.activeCount} active</span>`
        : block.entities
          ? `<span class="rt-section-count">${block.entities.count} ${block.entities.count === 1 ? 'entry' : 'entries'}</span>`
          : total
            ? `<span class="rt-section-count rt-total-value-badge" title="Total value of the inventory">${escapeHtml(total.total)}</span>`
            : ''

    const bodyClass = block.quests
        ? 'rt-section-body rt-section-body--quests'
        : block.entities
          ? 'rt-section-body rt-section-body--entities'
          : 'rt-section-body'

    // The PARTY card alone has a compact mode (47e-ter): the class hides the
    // sheets, the button in the header flips it.
    const isParty = block.tag === 'PARTY'
    const compact = isParty && options.partyCompact === true
    const compactButton = isParty && options.partyCompactButton ? renderPartyCompactButton(compact) : ''
    return { body, count, bodyClass, compact, compactButton }
}

/** Draw one block as a card. `benched` rides inside a PARTY card as its camp roster. */
export function renderBlockCard(block: TrackerBlock, options: CardOptions = {}, benched: TrackerBlock | null = null): string {
    const isCollapsed = options.collapsed?.has(block.tag) ?? false
    const { body, count, bodyClass, compact, compactButton } = blockParts(block, options, benched)

    return `<div class="rt-section${isCollapsed ? ' rt-section--collapsed' : ''}${compact ? ' rt-party-compact' : ''}" data-tag="${escapeHtml(block.tag)}">
        <div class="rt-section-header" role="button" tabindex="0" aria-expanded="${!isCollapsed}">
            <span class="rt-section-icon">${escapeHtml(block.icon)}</span>
            <span class="rt-section-title">${escapeHtml(block.label)}</span>
            ${count}${compactButton}
        </div>
        <div class="${bodyClass}"${isCollapsed ? ' hidden' : ''}>${body}</div>
    </div>`
}

/**
 * One Display Group as a card (75), as the legacy's `renderDisplayGroupCard`
 * draws it: the group's icon and name in the header with *N modules*, one
 * collapse state under the virtual key, and the present members' bodies
 * only — no member header, every member open — parted by a rule, or
 * seamless. A PARTY member brings the Compact button up to the group's
 * header, and its compact mode to its own body.
 */
function renderGroupCard(entry: Extract<DisplayGroupPlanEntry, { kind: 'group' }>, byTag: ReadonlyMap<string, TrackerBlock>, options: CardOptions, benchedParty: TrackerBlock | null): string {
    const isCollapsed = options.collapsed?.has(entry.key) ?? false
    // The plan names only members the memo holds, so every tag is a block here (a mutation found an empty-guard dead).
    const members = entry.tags.map((tag) => byTag.get(tag)).filter((block): block is TrackerBlock => !!block)
    const bodies = members.map((block) => {
        const parts = blockParts(block, options, block.tag === 'PARTY' ? benchedParty : null)
        return `<div class="rt-display-group-member${parts.compact ? ' rt-party-compact' : ''}" data-member-tag="${escapeHtml(block.tag)}"><div class="${parts.bodyClass}">${parts.body}</div></div>`
    }).join('')
    const party = members.find((block) => block.tag === 'PARTY')
    const compactButton = party && options.partyCompactButton ? renderPartyCompactButton(options.partyCompact === true) : ''
    const seamless = options.displayGroups?.showGaps === true ? '' : ' rt-display-group-body--seamless'
    return `<div class="rt-section rt-display-group-card${isCollapsed ? ' rt-section--collapsed' : ''}" data-tag="${escapeHtml(entry.key)}" data-display-group-id="${escapeHtml(entry.group.id)}">
        <div class="rt-section-header" role="button" tabindex="0" aria-expanded="${!isCollapsed}">
            <span class="rt-section-icon">${escapeHtml(entry.group.icon)}</span>
            <span class="rt-section-title">${escapeHtml(entry.group.name)}</span>
            <span class="rt-section-count">${members.length} ${members.length === 1 ? 'module' : 'modules'}</span>${compactButton}
        </div>
        <div class="rt-section-body rt-display-group-body${seamless}"${isCollapsed ? ' hidden' : ''}>${bodies}</div>
    </div>`
}

/** Draw the whole tracker. Returns an empty-state card when there is nothing to show. */
export function renderTrackerHtml(view: TrackerView, options: CardOptions = {}): string {
    if (view.empty) {
        return `<div class="rt-empty">No tracker state yet.<br><small>It appears once a turn has been tracked.</small></div>`
    }
    // [BENCHED PARTY] never gets a card of its own: it rides inside PARTY as
    // the camp roster. With no PARTY card to ride in (everyone is away), it is
    // drawn as a card so the roster is never invisible -- which it was, from
    // Phase 6 until Phase 29 gave it something to show.
    const hasParty = view.blocks.some((block) => block.tag === 'PARTY')
    // The XP card leaves the cards while the bar at the bottom stands for it (74f), as the legacy's `renderMemoAsCards` leaves it out.
    const blocks = options.xpBarAtBottom ? view.blocks.filter((block) => block.tag !== 'XP') : view.blocks
    // The Display Groups (75): the legacy's plan over the ordered tags, each enabled group's present
    // members drawn as one host at the first member's place; the flat list as it was otherwise.
    const groups = options.displayGroups
    const plan: DisplayGroupPlanEntry[] = groups?.enabled && groups.groups.length > 0
        ? planDisplayGroups(blocks.map((block) => block.tag), groups.groups, true)
        : blocks.map((block) => ({ kind: 'module' as const, tag: block.tag }))
    const byTag = new Map(blocks.map((block) => [block.tag, block]))
    const cards = plan.map((entry) => {
        if (entry.kind === 'group') return renderGroupCard(entry, byTag, options, view.benchedParty)
        const block = byTag.get(entry.tag)
        return block ? renderBlockCard(block, options, block.tag === 'PARTY' ? view.benchedParty : null) : ''
    })
    if (view.benchedParty && !hasParty) cards.push(renderBlockCard(view.benchedParty, options))
    return cards.join('')
}

/** How many things a block's tab badge counts (76): the legacy counts its rendered items — the quests active, the entities, else the lines. */
function tabBadgeCount(block: TrackerBlock): number {
    return block.quests ? block.quests.activeCount : block.entities ? block.entities.count : block.lines.length
}

/**
 * Tab Mode (76), as the legacy's `renderTabModeView` draws it: the CHARACTER
 * and COMBAT cards pinned at the top as cards, the party-vitals strip, then
 * one tab per remaining module — or per Display Group, with the switch on —
 * in a wrapping strip, each tab its icon with a count badge (PARTY's with a
 * second, ⛺N, for its camp), and one pane holding the active tab's card.
 * The wrap carries the tab order and the pane the active key, for the
 * panel's click, jump and swipe. A memo with nothing behind the strip says
 * so; an empty memo draws the empty state the stacked view draws.
 */
export function renderTabModeHtml(view: TrackerView, options: CardOptions = {}): string {
    if (view.empty) return renderTrackerHtml(view, options)
    const blocks = options.xpBarAtBottom ? view.blocks.filter((block) => block.tag !== 'XP') : view.blocks
    const byTag = new Map(blocks.map((block) => [block.tag, block]))
    const pinned = blocks.filter((block) => TAB_MODE_PINNED_TAGS.includes(block.tag))
    const pinnedHtml = pinned.map((block) => renderBlockCard(block, options)).join('')
    const party = byTag.get('PARTY')
    const vitalsHtml = renderPartyVitalsStrip(party?.raw ?? '', { bars: options.bars, portraits: options.tabMode?.portraits })

    // Everyone away: the legacy synthesises an empty PARTY shell to host the camp; here the benched
    // block takes a tab of its own, as it takes a card of its own in the stacked view.
    const tabBlocks = blocks.filter((block) => !TAB_MODE_PINNED_TAGS.includes(block.tag))
    if (view.benchedParty && !party) { tabBlocks.push(view.benchedParty); byTag.set(view.benchedParty.tag, view.benchedParty) }
    const groups = options.displayGroups
    const plan: DisplayGroupPlanEntry[] = groups?.enabled && groups.groups.length > 0
        ? planDisplayGroups(tabBlocks.map((block) => block.tag), groups.groups, true)
        : tabBlocks.map((block) => ({ kind: 'module' as const, tag: block.tag }))
    if (plan.length === 0) {
        return `<div class="rt-tabmode-wrap"><div class="rt-tabmode-pinned">${pinnedHtml}</div>${vitalsHtml}<div class="rt-empty">No additional modules to display.</div></div>`
    }
    const keyOf = (entry: DisplayGroupPlanEntry): string => (entry.kind === 'group' ? entry.key : entry.tag)
    const keys = plan.map(keyOf)
    const wanted = options.tabMode?.activeTab ?? ''
    const activeTab = keys.includes(wanted) ? wanted : keys[0]!

    const badge = (entry: DisplayGroupPlanEntry): string => {
        if (entry.kind === 'group') return `<span class="rt-tab-badge" title="${entry.tags.length} grouped modules">${entry.tags.length}</span>`
        const block = byTag.get(entry.tag)
        if (!block) return ''
        const count = tabBadgeCount(block)
        let badges = count > 0 ? `<span class="rt-tab-badge">${count}</span>` : ''
        if (block.tag === 'PARTY' && view.benchedParty) {
            const benched = tabBadgeCount(view.benchedParty)
            if (benched > 0) badges += `<span class="rt-tab-badge rt-tab-badge-secondary" title="Benched">⛺${benched}</span>`
        }
        return badges
    }
    const button = (entry: DisplayGroupPlanEntry): string => {
        const key = keyOf(entry)
        const icon = entry.kind === 'group' ? entry.group.icon : byTag.get(entry.tag)?.icon ?? ''
        const label = entry.kind === 'group' ? entry.group.name : byTag.get(entry.tag)?.label ?? entry.tag
        return `<button type="button" class="rt-tab-btn${key === activeTab ? ' active' : ''}" data-tag="${escapeHtml(key)}" title="${escapeHtml(label)}" aria-pressed="${key === activeTab ? 'true' : 'false'}"><span class="rt-tab-icon">${escapeHtml(icon)}</span>${badge(entry)}</button>`
    }
    const active = plan.find((entry) => keyOf(entry) === activeTab)!
    const content = active.kind === 'group'
        ? renderGroupCard(active, byTag, options, view.benchedParty)
        : renderBlockCard(byTag.get(active.tag)!, options, active.tag === 'PARTY' ? view.benchedParty : null)
    return `<div class="rt-tabmode-wrap" data-tab-order="${escapeHtml(keys.join(','))}"><div class="rt-tabmode-pinned">${pinnedHtml}</div>${vitalsHtml}<div class="rt-tab-strip" role="tablist">${plan.map(button).join('')}</div><div class="rt-tabmode-content" data-active-tag="${escapeHtml(activeTab)}">${content}</div></div>`
}
