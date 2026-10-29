/**
 * The animated bars (74h): Multihog's value-change feedback, typed.
 *
 * The memo is already final when the cards are redrawn; the legacy keeps the
 * change readable by capturing every bar's visible state *before* the redraw
 * and, after it, holding the old fill a moment, lighting the changed segment
 * and floating the delta (`+15`, `−3`) over the row while the fill trickles
 * to the new value and the delta counts down to zero. The experience row has
 * its own: a `+N XP` floater that counts down as the bar fills. Both are
 * sliced whole from the pin into `bars-legacy.js` (the twenty-first
 * generated file); this file is the face the tracker panel calls.
 *
 * Which bars animate is the renderer's say, in `data-rt-bar-animate`: a
 * custom `((BAR))` or `((BARREL))` marker while *Animate changes on every
 * custom bar* is on, and any bar whose own tick in the bar editor is set, as
 * the legacy's per-bar `animateChanges` is. The XP row animates its gains
 * without a switch, as the legacy's does.
 *
 * The context key is the legacy's: the chat and the stepper's position. A
 * redraw in another context (a chat change, a step through the history)
 * captures nothing to compare, so only a change within one view — a pass
 * landing, a refresh — plays.
 */

import { LEGACY_BAR_ANIMATION_CSS, LEGACY_RECOLOR_CSS, createBarChangeLegacy, createXpGainLegacy } from './bars-legacy.js'

const barChange = createBarChangeLegacy()
const xpGain = createXpGainLegacy()

/** What the two captures hold between a redraw's before and after; opaque to callers. */
export interface BarAnimationCapture {
    xp: unknown
    bars: unknown
}

/** The legacy's context key: the chat and the stepper's position, so a change of either compares nothing. */
export function barAnimationContext(chatId: string | null | undefined, historyIndex: number): string {
    return `${chatId || 'global'}::${historyIndex < 0 ? 'live' : `history-${historyIndex}`}`
}

/**
 * Capture before a redraw: the bars in `cards`, and the XP row in `xpHost`
 * (the bar at the bottom while it stands, the cards otherwise).
 */
export function captureBarAnimations(cards: HTMLElement, xpHost: HTMLElement, context: string): BarAnimationCapture {
    return {
        xp: xpGain.captureXpGainAnimationState(xpHost, context),
        bars: barChange.captureBarChangeAnimationState(cards, context),
    }
}

/** Play after the redraw: the rebuilt bars against their captured predecessors. */
export function playBarAnimations(cards: HTMLElement, xpHost: HTMLElement, captured: BarAnimationCapture, context: string): void {
    xpGain.playXpGainAnimation(xpHost, captured.xp as never, context)
    barChange.playBarChangeAnimations(cards, captured.bars, context)
}

/** The legacy's rules for the lit segment, the floaters and the XP row's gain state. */
export const BAR_ANIMATION_CSS = LEGACY_BAR_ANIMATION_CSS

/** The legacy's recolour rules (74i): the pointer and hover on a recolourable bar, the barrel's two half-controls. */
export const RECOLOR_CSS = LEGACY_RECOLOR_CSS
