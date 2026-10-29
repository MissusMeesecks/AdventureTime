/**
 * The day/night cycle (Phase 74c, departure 81): Multihog's seven phases of
 * the in-world clock as a tint on every root, the sky badge in the head,
 * and the crossfade between them.
 *
 * Multihog reads the memo's `[TIME]` block on every redraw, turns its clock
 * into one of seven phases (`getTimeOfDayInfo`, sliced into the nineteenth
 * generated file and run as the legacy runs it), puts `rt-phase-<phase>` and
 * `rt-daynight-active` on every panel while its *Day/Night Cycle* switch is
 * on, and a palette per phase then overrides the theme's variables — with
 * the nine colours registered through `@property` so the browser crossfades
 * them over two seconds. The badge is pure CSS: a radial-gradient disc with a
 * glow, and a starfield of box-shadow dots behind the moon.
 *
 * Here the two classes go on the document's body, where the theme's class
 * goes (74a): `lh-phase-<phase>` from the memo whatever the switch says —
 * the backdrops (74d) read the night phase from it too, as Multihog's
 * `rt-bg-night-phase` does — and `lh-daynight` while the preference is on.
 * The palette rule needs both, so a phase with the switch off paints nothing.
 *
 * The crossfade is the one place AdventureTime's token layer and Multihog's part
 * ways: Multihog registers `--rt-bg` itself, which is fine when every panel
 * always sets it; registering `--lh-bg` would give it an initial value, and
 * a registered property with an initial value is never guaranteed-invalid,
 * so `var(--lh-bg, <the host's>)` would never fall back and *Match
 * Lumiverse* would lose the host's colours. So the nine colours are
 * registered under a second name, `--lh-dn-<name>`, set and transitioned
 * on the body, and the phase rule points each token at its `--lh-dn-`
 * twin: a token reading an animating property takes the interpolated
 * value every frame, and with no phase the tokens stay unset.
 */
import { LEGACY_DAY_NIGHT, LEGACY_MOON_PHASES, getTimeOfDayInfo as legacyTimeOfDay } from './themes-legacy.js'
import { currentTimeFromMemo, extractCurrentTimeStr } from '../tracker/time.js'
import { escapeHtml } from '../tracker/html.js'
import { accentContrast } from './themes.js'

/** What the legacy's reader returns: the hour (-1 for no clock), the card's emoji and colour, and the phase ('' for no clock). */
export interface TimeOfDayInfo {
    hour: number
    emoji: string
    color: string
    phase: string
}

/** Multihog's own reader, from the generated file: any string holding `HH:MM[ AM/PM]`. */
export function getTimeOfDayInfo(str: string | null | undefined): TimeOfDayInfo {
    return legacyTimeOfDay(str ?? '')
}

/** The seven phases, in the legacy's order of the day. */
export const DAY_PHASES: readonly string[] = Object.keys(LEGACY_DAY_NIGHT.phases)

/** The phases that show the moon, as the legacy's set. */
export const MOON_PHASES: readonly string[] = LEGACY_MOON_PHASES

/** The class a phase puts on the body. */
export function phaseClass(phase: string): string {
    return `lh-phase-${phase}`
}

/** The class the switch puts on the body while the cycle is on. */
export const DAY_NIGHT_CLASS = 'lh-daynight'

/** The current time's line out of a memo, as the legacy reads it for the cycle: the `[TIME]` block's first line that is not the rest. */
export function currentClockFromMemo(memo: string | null | undefined): string {
    return extractCurrentTimeStr(currentTimeFromMemo(memo))
}

/** The phase a memo's clock is in, or '' when it holds no clock. */
export function phaseFromMemo(memo: string | null | undefined): string {
    const clock = currentClockFromMemo(memo)
    return clock ? getTimeOfDayInfo(clock).phase : ''
}

/**
 * Puts the memo's phase on the body as its class, taking any other phase's
 * off — Multihog's `applyDayNightCycleUI`, less the switch, which is a
 * class of its own here. Returns the phase, '' for none.
 */
export function applyDayNightPhase(body: Element, memo: string | null | undefined): string {
    const phase = phaseFromMemo(memo)
    for (const name of Array.from(body.classList)) if (name.startsWith('lh-phase-')) body.classList.remove(name)
    if (phase) body.classList.add(phaseClass(phase))
    return phase
}

/** Puts the switch's class on the body, or takes it off. */
export function applyDayNightCycle(body: Element, enabled: boolean): void {
    body.classList.toggle(DAY_NIGHT_CLASS, enabled)
}

/** The badge's hover text: the phase's name in words, as the legacy spells it. */
export function phaseLabel(phase: string): string {
    return phase.replace(/([A-Z])/g, ' $1').toLowerCase()
}

/**
 * The sky badge for a clock string — Multihog's `renderDayNightBadge`: the
 * disc, and the stars behind it during a moon phase; '' for no clock.
 */
export function renderDayNightBadge(clock: string | null | undefined): string {
    const { hour, phase } = getTimeOfDayInfo(clock)
    if (hour === -1) return ''
    const stars = MOON_PHASES.includes(phase) ? '<span class="lh-sky-stars"></span>' : ''
    return `<span class="lh-sky-badge lh-sky-${phase}" title="In-world time of day: ${escapeHtml(phaseLabel(phase))}">${stars}<span class="lh-sky-disc"></span></span>`
}

/** `--rt-bg` → `--lh-bg`. */
function token(name: string): string {
    return name.replace(/^--rt-/, '--lh-')
}

/** `--rt-bg` → `--lh-dn-bg`: the registered twin the crossfade animates. */
function registered(name: string): string {
    return name.replace(/^--rt-/, '--lh-dn-')
}

/** The legacy's selectors under AdventureTime's names: the switch's class for the active panel, the body's phase for the panel's. */
function renameRules(css: string): string {
    return css
        .replace(/\.rpg-tracker-panel\.rt-daynight-active /g, `.${DAY_NIGHT_CLASS} `)
        .replace(/\.rpg-tracker-panel\.rt-phase-(\w+) /g, (_m, phase: string) => `.${DAY_NIGHT_CLASS}.${phaseClass(phase)} `)
        .replace(/#rt-daynight-badge-slot/g, '.lh-sky-slot')
        .replace(/\.rt-daynight-badge/g, '.lh-sky-badge')
        .replace(/\.rt-sky-/g, '.lh-sky-')
        .replace(/rt-sky-twinkle/g, 'lh-sky-twinkle')
        .replace(/\.rt-header-starfield/g, '.lh-head-starfield')
        .replace(/rt-header-star-twinkle/g, 'lh-head-star-twinkle')
}

/** The stylesheet: the registrations, the crossfade, the seven palettes, the badge, the slot and the starfield. */
export function buildDayNightCss(): string {
    const { phases, properties, transitions, rules } = LEGACY_DAY_NIGHT as {
        phases: Record<string, Record<string, string>>
        properties: Record<string, string>
        transitions: string[]
        rules: Record<string, string>
    }
    const blocks: string[] = ['/* The day/night cycle (74c): Multihog\'s seven phases as --lh-* tokens, crossfaded through registered twins. */']
    for (const [name, initial] of Object.entries(properties)) {
        blocks.push(`@property ${registered(name)} {\n    syntax: '<color>';\n    inherits: true;\n    initial-value: ${initial};\n}`)
    }
    // The legacy's list less the four plain properties, which it transitions on
    // its panel and the body here does not change.
    const animated = transitions.filter((entry) => entry.startsWith('--rt-')).map((entry) => entry.replace(/^--rt-[\w-]+/, (name) => registered(name)))
    blocks.push(`.${DAY_NIGHT_CLASS} {\n    transition:\n        ${animated.join(',\n        ')};\n}`)
    const selectors = Object.keys(phases).map((phase) => `.${DAY_NIGHT_CLASS}.${phaseClass(phase)}`)
    const mapped = Object.keys(properties).map((name) => `    ${token(name)}: var(${registered(name)});`)
    blocks.push(`${selectors.join(',\n')} {\n${mapped.join('\n')}\n}`)
    for (const [phase, vars] of Object.entries(phases)) {
        const lines = Object.entries(vars).map(([name, value]) => `    ${name in properties ? registered(name) : token(name)}: ${value};`)
        lines.push(`    --lh-accent-contrast: ${accentContrast(vars['--rt-accent'] ?? '')};`)
        blocks.push(`.${DAY_NIGHT_CLASS}.${phaseClass(phase)} {\n${lines.join('\n')}\n}`)
    }
    // The slot is drawn whatever the switch says and shown by it; the head is
    // the starfield's frame, its own children above the stars.
    blocks.push('.lh-sky-slot { display: none; }')
    blocks.push('.lh-tracker-head { position: relative; overflow: visible; }\n.lh-tracker-head > :not(.lh-head-starfield) { position: relative; z-index: 1; }')
    blocks.push(renameRules(rules.badge ?? ''), renameRules(rules.head ?? ''), renameRules(rules.starfield ?? ''))
    blocks.push('@media (prefers-reduced-motion: reduce) { .lh-sky-stars, .lh-head-starfield::before, .lh-head-starfield::after { animation: none; } }')
    return `${blocks.join('\n')}\n`
}

/** The stylesheet, built once. */
export const DAY_NIGHT_CSS = buildDayNightCss()
