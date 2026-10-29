/**
 * The map on screen (roadmap row 9, Phase 34d): what the panel draws.
 *
 * The legacy draws the party's site in its Visuals panel and opens any site
 * from its Location entry in Map Details; both are the same picture, the
 * knowledge-filtered graph with Reveal all lifting the filter. Here one
 * request answers both: the site the party is in by default, or a named
 * one, with the graph as SVG, the readable entries and the site's evolution
 * history already rendered, so the panel only places them. Reveal all is a
 * preference the panel toggles; the picture is drawn under it here, so the
 * filter is applied in one place.
 */

import { renderEvolutionHistoryHtml, buildMapGraph, graphHasRooms, renderMapEntriesHtml, renderMapGraphSvg, siteDocument } from '../tracker/graph.js'
import { normalizeMapLabel, type MapSite } from '../tracker/map.js'
import type { MapViewResult } from '../protocol.js'
import type { MapStore } from './map-store.js'
import { readMapSites, type MapBookReader } from './map-sync.js'

export interface MapViewDeps {
    store: (userId: string | undefined) => MapBookReader
    campaign: (chatId: string, userId: string | undefined) => Promise<{ prefix: string; owned: string[] }>
    /** Whether the user has Reveal all on. */
    revealAll: (userId: string | undefined) => Promise<boolean>
    state: MapStore
    log: { info(m: string): void; warn(m: string): void }
}

export interface MapView {
    /** The party's site, or the named one. Never throws; a problem is reported in the result. */
    view(chatId: string, userId: string | undefined, siteRoot?: string): Promise<MapViewResult>
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

const EMPTY: Omit<MapViewResult, 'revealAll' | 'currentLocation' | 'sites'> = { siteRoot: '', kind: '', partyInside: false, rooms: 0, svg: '', entries: '', history: '' }

export function createMapView(deps: MapViewDeps): MapView {
    return {
        async view(chatId, userId, siteRoot = '') {
            const revealAll = await deps.revealAll(userId).catch(() => false)
            const record = await deps.state.load(chatId, userId)
            const base = { revealAll, currentLocation: record.currentLocation, sites: [] as MapViewResult['sites'] }
            try {
                const { prefix, owned } = await deps.campaign(chatId, userId)
                const { sites } = await readMapSites(deps.store(userId), prefix, owned)
                const list = Object.values(sites)
                base.sites = list.map((s) => ({ siteRoot: s.siteRoot, kind: String(siteDocument(s)?.kind ?? '') }))
                const wanted = normalizeMapLabel(siteRoot)
                const active = normalizeMapLabel(record.activeSiteRoot)
                const pick = (key: string): MapSite | undefined => (key ? list.find((s) => normalizeMapLabel(s.siteRoot) === key) : undefined)
                const site = wanted ? pick(wanted) : pick(active)
                if (!site) {
                    if (wanted) return { ...EMPTY, ...base, problem: `${siteRoot} is not a mapped site.` }
                    return { ...EMPTY, ...base }
                }
                const document = siteDocument(site)
                if (!document) return { ...EMPTY, ...base, siteRoot: site.siteRoot, problem: `${site.siteRoot} has no readable map.` }
                const partyInside = normalizeMapLabel(site.siteRoot) === active
                const graph = buildMapGraph(document, { playerFacing: !revealAll, currentLocation: partyInside ? record.currentLocation : '' })
                return {
                    ...base,
                    siteRoot: site.siteRoot,
                    kind: String(document.kind ?? ''),
                    partyInside,
                    rooms: graph.nodes.length,
                    svg: graphHasRooms(graph) ? renderMapGraphSvg(graph, { compact: true, siteRoot: site.siteRoot }) : '',
                    entries: renderMapEntriesHtml(document, { revealAll }),
                    history: renderEvolutionHistoryHtml(record.evolution.backlogBySite as never, site.siteRoot, { revealAll }),
                }
            } catch (error) {
                deps.log.warn(`map: could not draw the map: ${describe(error)}`)
                return { ...EMPTY, ...base, problem: describe(error) }
            }
        },
    }
}
