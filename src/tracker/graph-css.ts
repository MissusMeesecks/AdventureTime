/**
 * The occupancy glyphs' art as one stylesheet (Phase 34d).
 *
 * The legacy draws each kind's glyph as a rect filled with the icon's colour
 * and masked by the kind's SVG file, one CSS rule per kind injected once; the
 * same rules here, with the file inlined as a data URL, since a bundle has no
 * files beside it. Kept apart from `graph.ts` so the frontend bundles the
 * thirteen glyphs without the map library behind the renderer.
 */
import { MAP_KIND_ART } from './graph-art.js'

/** One mask rule per kind, in the legacy's class vocabulary (`.rt-dungeon-graph-icon-trap .rt-dungeon-graph-icon-art`). */
export function mapKindArtCss(): string {
    return Object.entries(MAP_KIND_ART as Record<string, string>).map(([kind, svg]) => {
        const cls = kind.toLowerCase()
        const url = JSON.stringify(`data:image/svg+xml,${encodeURIComponent(svg)}`)
        return `.rt-dungeon-graph-icon-${cls} .rt-dungeon-graph-icon-art{-webkit-mask-image:url(${url});mask-image:url(${url});}`
    }).join('\n')
}

export const MAP_KIND_NAMES: readonly string[] = Object.keys(MAP_KIND_ART)
