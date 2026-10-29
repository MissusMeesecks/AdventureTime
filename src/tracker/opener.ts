/**
 * The Map Architect's text opener, the light half (Phase 46).
 *
 * What the rulebook and the choices need of the opener -- its rules, its CYOA
 * caveat, and the reading of the setting -- without the map library: this
 * module makes the legacy's closure with stubs for the three map functions,
 * which only the block's *parser* calls, and does not expose the parser.
 * `architect.ts` makes the same closure over the real map library and exposes
 * the parser and the brief. The rulebook is in the frontend bundle; the map
 * library must not follow it there for a string (lesson 46's cousin).
 */

import { createOpenerLegacy } from './opener-legacy.js'

const light = createOpenerLegacy({
    normalizeMapSiteKind: (value: unknown) => value,
    normalizeMapSiteThreat: (value: unknown) => value,
    defaultMapSiteThreat: () => '',
})

export type MapArchitectOpener = 'tool' | 'text'

/** The mapping section's rules in text mode, in place of the tool-call ones. */
export const MAP_ARCHITECT_TEXT_OPENER_RULES: string = light.MAP_ARCHITECT_TEXT_OPENER_RULES
/** The sentence that suspends CYOA on the turn the block is written. */
export const MAP_ARCHITECT_TEXT_OPENER_CYOA_CAVEAT: string = light.MAP_ARCHITECT_TEXT_OPENER_CYOA_CAVEAT

/** `'text'` for the block, anything else the tool: the legacy's reading of its setting. */
export function normalizeMapArchitectOpener(value: unknown): MapArchitectOpener {
    return light.normalizeMapArchitectOpener(value) as MapArchitectOpener
}

/** Whether a settings bag asks for the text opener, as the legacy reads `mapArchitectOpener`. */
export function isTextOpener(settings: { mapArchitectOpener?: unknown } | null | undefined): boolean {
    return !!light.isMapArchitectTextOpener(settings ?? {})
}

/** The CYOA block with the opener's exception in front, so "always end with choices" cannot win on the block's turn. */
export function applyTextOpenerCyoaCaveat(cyoaBlock: string): string {
    return light.applyMapArchitectTextOpenerCyoaCaveat(cyoaBlock) as string
}
