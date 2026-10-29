/**
 * The map on screen (roadmap row 9, Phase 34d): the typed face over the
 * legacy's graph module.
 *
 * A map document becomes a picture in three steps the legacy keeps apart,
 * and so do we: `buildMapGraph` filters it by knowledge -- player-facing,
 * only the rooms the party has visited or discovered are drawn, with each
 * unrevealed room next to one of them as an unlabeled fog stub, and only the
 * known or suspected things in them -- `layoutMapGraph` ranks the rooms
 * left to right from the entrance, and `renderMapGraphSvg` draws them. The
 * readable inspector (`renderMapEntriesHtml`) lists the same rooms, routes
 * and things in words, under the same filter. All of it is the generated
 * `graph-legacy.js`, held to the pin by `graph.pin.test.ts`; this file
 * names the shapes and adds the evolution history the legacy's panel draws
 * from the site's backlog.
 */
import { describeBacklog, formatElapsedMinutes, stripDigestSitePrefix, type BacklogBySite, type BacklogEntry } from './evolution.js'
import { createGraphLegacy } from './graph-legacy.js'
import { createMapLegacy } from './map-legacy.js'
import { parseMapDocument, type MapAssetKnowledge, type MapDocument, type MapSite } from './map.js'

const map = createMapLegacy()
const plain = createGraphLegacy({ normalizeDungeonMapDocument: map.normalizeDungeonMapDocument, resolveAssetEffectiveArea: map.resolveAssetEffectiveArea, resolveCurrentMapPlacement: map.resolveCurrentMapPlacement })

export type MapIconMood = 'LIVE' | 'STRESSED' | 'ARMED' | 'TRIGGERED' | 'DEACTIVATED' | 'SPENT' | 'DESTROYED' | 'DEAD'

/** One occupancy glyph on a room: the kind's art in the mood's dress. */
export interface MapGraphIcon {
    token: string
    kind: string
    mood: MapIconMood
    knowledge: MapAssetKnowledge
    state: string
    name: string
    detail: string
    count: number | null
}

export interface MapGraphNode {
    id: string
    name: string
    knowledge: string
    /** An unrevealed room drawn as an unlabeled stub beside a known one. */
    fog: boolean
    revealed: boolean
    current: boolean
    entrance: boolean
    icons: MapGraphIcon[]
}

export interface MapGraphEdge {
    from: string
    to: string
    state: string
    detail: string
}

export interface MapGraph {
    site: string
    currentAreaId: string
    /** The building or room-within-a-room the party is in, when the footer names one; `''` otherwise. */
    currentInteriorName: string
    nodes: MapGraphNode[]
    edges: MapGraphEdge[]
}

export interface MapGraphOptions {
    /** `true` (the default) hides what the party has not learned; `false` is Reveal all. */
    playerFacing?: boolean
    currentLocation?: string
}

/** The drawable graph of a document under the knowledge filter, with the party's room marked. */
export function buildMapGraph(document: MapDocument, options: MapGraphOptions = {}): MapGraph {
    return plain.buildDungeonMapGraph(document, options) as MapGraph
}

export interface MapGraphPlacedNode extends MapGraphNode {
    x: number
    y: number
    width: number
    height: number
    cx: number
    cy: number
    labelY: number
    iconY: number
}

export interface MapGraphLayout {
    nodes: MapGraphPlacedNode[]
    edges: Array<MapGraphEdge & { x1: number; y1: number; x2: number; y2: number }>
    width: number
    height: number
    compact: boolean
}

/** Layered left to right from the entrance (or the party's room, or the first revealed one). */
export function layoutMapGraph(graph: MapGraph, options: { compact?: boolean } = {}): MapGraphLayout {
    return plain.layoutDungeonMapGraph(graph, options) as MapGraphLayout
}

/** The graph as inline SVG in the legacy's class vocabulary, or a `No revealed rooms yet.` div when nothing is drawable. */
export function renderMapGraphSvg(graph: MapGraph, options: { compact?: boolean; siteRoot?: string } = {}): string {
    return plain.renderDungeonMapGraphSvg(graph, options)
}

/** Whether the picture has anything to draw: a node, which `renderMapGraphSvg` otherwise answers with its empty div. */
export function graphHasRooms(graph: MapGraph): boolean {
    return graph.nodes.length > 0
}

/** The readable inspector: areas with their geometry, routes and things; under the filter, unrevealed ones are left out and routes into them read `Unexplored`. */
export function renderMapEntriesHtml(document: MapDocument, options: { revealAll?: boolean } = {}): string {
    return plain.renderDungeonMapReadableHtml(document, options)
}

/** The hover card for one glyph, from the data attributes the glyph carries. */
export function renderAssetTipHtml(asset: { name?: string | null; kind?: string | null; state?: string | null; knowledge?: string | null; detail?: string | null; count?: string | number | null }): string {
    return plain.renderDungeonGraphAssetTipHtml(asset as never)
}

/** The stacked cards behind a `+N` badge. */
export function renderOverflowTipHtml(assets: ReadonlyArray<{ name?: string; kind?: string; state?: string; knowledge?: string; detail?: string; count?: number | null }>): string {
    return plain.renderDungeonGraphOverflowTipHtml([...assets])
}

/** The mood a kind and state are drawn in: a dead creature is crossed out, a sprung trap slashed, an alert pack stressed. */
export function assetIconMood(kind: string, state: string): MapIconMood {
    return plain.mapAssetIconMood(kind, state) as MapIconMood
}

/** The glyphs one room carries, in the legacy's kind order. */
export function collectAreaIcons(assets: MapDocument['assets'], areaId: string, options: { playerFacing?: boolean } = {}): MapGraphIcon[] {
    return plain.collectAreaAssetIcons(assets, areaId, options) as MapGraphIcon[]
}

/** The site's document, parsed from the `[MAP]` section its root entry carries; `null` for a site with none. */
export function siteDocument(site: MapSite): MapDocument | null {
    const body = site.mapChunks?.[0]
    if (!body) return null
    return parseMapDocument(body, site.siteRoot).document
}

// ── the evolution history ────────────────────────────────────────────────

function escapeHtml(value: unknown): string {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}

/** How many passes the history shows, as the legacy's Map Details shows them. */
export const EVOLUTION_HISTORY_ENTRIES = 20

/**
 * The site's Map Evolution passes, newest last, as the legacy's Map Details
 * lists them: a material commit or a quiet checkpoint, when, how long a gap
 * it covered, and what it did -- a commit's digest only under Reveal all,
 * since it names what the party has not seen; a quiet pass never reveals
 * anything. `''`-free: an empty history says so.
 */
export function renderEvolutionHistoryHtml(backlogBySite: BacklogBySite | undefined, siteRoot: string, options: { revealAll?: boolean } = {}): string {
    const revealAll = !!options.revealAll
    const history = describeBacklog(backlogBySite, siteRoot, -1, { lookback: EVOLUTION_HISTORY_ENTRIES })
    if (!history.entries.length) return '<div class="lh-map-history-empty">No Map Evolution pass has been recorded for this site.</div>'
    return history.entries.map((entry: BacklogEntry) => {
        const material = entry.kind === 'commit'
        const label = material ? 'Material commit' : 'Quiet checkpoint'
        const passes = !material && (entry.passes ?? 1) > 1 ? ` · ${entry.passes} passes` : ''
        const elapsed = entry.elapsedMinutes >= 0 ? formatElapsedMinutes(entry.elapsedMinutes) : 'Unknown elapsed time'
        const details = material && !revealAll ? 'Material details hidden. Turn on Reveal all to inspect this commit.' : stripDigestSitePrefix(entry.summary, siteRoot)
        const operation = material && revealAll && entry.operationId ? `<code>${escapeHtml(entry.operationId)}</code>` : ''
        return `<div class="lh-map-history-entry lh-map-history-${entry.kind}"><div class="lh-map-history-head"><span>${label}${passes}</span><time>${escapeHtml(entry.at)}</time></div><div class="lh-map-history-elapsed">${escapeHtml(elapsed)}</div><div class="lh-map-history-summary">${escapeHtml(details)}</div>${operation}</div>`
    }).join('')
}
