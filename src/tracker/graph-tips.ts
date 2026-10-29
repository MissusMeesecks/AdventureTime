/**
 * The hover cards of the map on screen (Phase 34d), for the frontend.
 *
 * The legacy renders a glyph's card from the data attributes the glyph
 * carries, in the same module as the glyphs. The panel needs only the cards,
 * so they are drawn from the generated module here without the map library
 * behind the rest of it: the factory never calls its map dependencies until
 * a graph is built, and the panel builds none.
 */
import { createGraphLegacy } from './graph-legacy.js'

const unused = (): never => { throw new Error('the panel draws no graph') }
const plain = createGraphLegacy({ normalizeDungeonMapDocument: unused, resolveAssetEffectiveArea: unused, resolveCurrentMapPlacement: unused })

export interface GlyphCard {
    name?: string | null
    kind?: string | null
    state?: string | null
    knowledge?: string | null
    detail?: string | null
    count?: string | number | null
}

/** The card for one glyph: its name and count, its tags, its detail. */
export function glyphCardHtml(card: GlyphCard): string {
    return plain.renderDungeonGraphAssetTipHtml(card as never)
}

/** The stacked cards behind a `+N` badge; `''` for none. */
export function overflowCardsHtml(cards: readonly GlyphCard[]): string {
    return plain.renderDungeonGraphOverflowTipHtml(cards as never)
}

/** The cards a badge carries, from its `data-overflow-assets`; `[]` when unreadable. */
export function parseOverflowCards(raw: string | null | undefined): GlyphCard[] {
    if (!raw) return []
    try {
        const parsed: unknown = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.filter((c): c is GlyphCard => !!c && typeof c === 'object') : []
    } catch {
        return []
    }
}
