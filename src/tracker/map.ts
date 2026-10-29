/**
 * The hidden map: Multihog's "Dungeon Reality" (roadmap row 9, Phase 34).
 *
 * A site -- a dungeon, a settlement, a significant interior -- can carry a
 * private objective map: a v3 document of areas, the connections between
 * them, and the assets (creatures, groups, traps, loot, objects) that occupy
 * them, each with what the party knows of it. It lives inside the site's own
 * Location entry as a `[MAP] … [/MAP]` section, so the lorebook stays the one
 * place a campaign's facts are kept, and it reaches the narrator two ways:
 * an always-on index of every mapped site, and, while the party is inside one
 * (the Location footer under every reply says where they are), that site's
 * map as GM canon. The player sees only what the party has found.
 *
 * What is the legacy's is the legacy's: `map-legacy.js` is *generated* from
 * the pin's `dungeon-reality.js`, sliced whole (CLAUDE.md 3a-bis), and this
 * file is the typed face over the part of it Phase 34 uses -- reading maps
 * and telling the narrator about them. The agents that *write* maps (the
 * architect, the updater, evolution) are the later stages of row 9.
 */

import { createMapLegacy } from './map-legacy.js'

const plain = createMapLegacy()

// ── the document ─────────────────────────────────────────────────────────

export type MapSiteKind = 'DUNGEON' | 'SETTLEMENT' | 'INTERIOR'
export type MapSiteThreat = 'NONE' | 'LOW' | 'MODERATE' | 'HIGH' | 'DEADLY'
export type MapAreaKnowledge = 'UNREVEALED' | 'DISCOVERED' | 'VISITED'
export type MapAssetKnowledge = 'UNREVEALED' | 'SUSPECTED' | 'KNOWN'

export const MAP_SITE_KINDS: readonly MapSiteKind[] = plain.MAP_SITE_KINDS as MapSiteKind[]
export const MAP_SITE_THREATS: readonly MapSiteThreat[] = plain.MAP_SITE_THREATS as MapSiteThreat[]
export const MAP_FORMAT_VERSION: number = plain.DUNGEON_MAP_FORMAT_VERSION

export interface MapConnection {
    to: string
    state: string
    detail: string
}

export interface MapArea {
    id: string
    name: string
    knowledge: MapAreaKnowledge
    geometry: string[]
    connections: MapConnection[]
}

export interface MapAsset {
    id: string
    kind: string
    name: string
    location: string
    state: string
    knowledge: MapAssetKnowledge
    detail: string
    origin?: string
    count?: number
    [extra: string]: unknown
}

/** A map as the legacy normalises it: version 3, named, with areas and assets. Extra fields (host, threat) ride along. */
export interface MapDocument {
    version: number
    site: string
    kind?: string
    threat?: string
    hostSite?: string
    hostBrief?: string
    areas: MapArea[]
    assets: MapAsset[]
    [extra: string]: unknown
}

/** A `[MAP]` body -- JSON, or the legacy's prose -- as a document. Never throws; prose becomes geometry, and says so. */
export function parseMapDocument(body: string, siteFallback = ''): { document: MapDocument; migrated: boolean } {
    const parsed = plain.parseDungeonMapDocument(String(body ?? ''), siteFallback)
    return { document: parsed.document, migrated: parsed.migrated === true }
}

export function normalizeMapDocument(raw: unknown, siteFallback = ''): MapDocument {
    return plain.normalizeDungeonMapDocument(raw, siteFallback)
}

/** The document as it is stored: the legacy's JSON shape, two-space indented. */
export function serializeMapDocument(document: MapDocument): string {
    return plain.serializeDungeonMapDocument(document)
}

export function normalizeMapSiteKind(value: unknown): MapSiteKind {
    return plain.normalizeMapSiteKind(value)
}

/** The threat a kind starts at: a settlement MODERATE, a dungeon HIGH, an interior LOW. */
export function defaultMapSiteThreat(kind: unknown): MapSiteThreat {
    return plain.defaultMapSiteThreat(kind) as MapSiteThreat
}

export function normalizeMapSiteThreat(value: unknown, fallback = ''): MapSiteThreat | '' {
    return plain.normalizeMapSiteThreat(value, fallback) as MapSiteThreat | ''
}

// ── the section in a Location entry ──────────────────────────────────────

/** The `[MAP]` body of an entry, trimmed; `''` when there is none. */
export function extractMapSection(content: string | null | undefined): string {
    return plain.extractDungeonMapSection(content)
}

/** The entry's prose without its map. What the agent and the dossiers read. */
export function stripMapSection(content: string | null | undefined): string {
    return plain.stripDungeonMapSection(content)
}

/** The entry with its `[MAP]` body replaced, or one appended when it has none. */
export function replaceMapSection(content: string | null | undefined, mapBody: string): string {
    return plain.replaceDungeonMapSection(content, mapBody)
}

// ── where the party is ───────────────────────────────────────────────────

/** The last `(Location: …)` in a reply's footer, or `''`. */
export function extractFooterLocation(text: string | null | undefined): string {
    return plain.extractFooterLocation(text)
}

/** The first segment of a footer location: the site the rest sits inside. */
export function siteRootOfLocation(location: string | null | undefined): string {
    return plain.getSiteRootFromLocation(location)
}

/** A loose site-name key: lower case, articles and punctuation off. */
export function normalizeMapLabel(label: string | null | undefined): string {
    return plain.normalizeDungeonLabel(label)
}

/** Whether a footer location lies inside a site, by the legacy's path matching. */
export function locationContainsSiteRoot(location: string, siteRoot: string): boolean {
    return plain.locationContainsSiteRoot(location, siteRoot)
}

/** The legacy's heuristic for a place that sounds like it should have a map. */
export function looksLikeDungeonSite(location: string): boolean {
    return plain.looksLikeDungeonSite(location)
}

// ── the sites a campaign has mapped ──────────────────────────────────────

/** An entry as the site builder reads it, keyed by uid as a Location book is. */
export interface MapLoreEntry {
    comment?: string
    content?: string
    extensions?: Record<string, unknown>
}

/** A mapped site as the legacy holds it: its root entry, its map, and the Location entries under it. */
export interface MapSite {
    siteRoot: string
    /** `Book::uid` of the root entry. */
    entryId: string
    mapChunks: string[]
    locationEntries: Array<{ id: string; label: string; content: string }>
    statusLog: unknown[]
}

export type MapSites = Record<string, MapSite>

/** Every site a Location book maps: the entries with a `[MAP]` section, each with the entries filed under it. */
export function buildMapSites(entries: Record<string, MapLoreEntry>, bookName = ''): MapSites {
    return plain.buildDungeonSitesFromLocationEntries(entries, bookName) as MapSites
}

/** Sites from several books, merged; a later book's site of the same name wins. */
export function mergeMapSites(...sets: readonly MapSites[]): MapSites {
    return Object.assign({} as MapSites, ...sets)
}

export interface MapSiteSummary {
    siteRoot: string
    kind: MapSiteKind
    hostSite?: string
    cells?: string[]
}

/** Name, kind, host and areas of each site, sorted by name. */
export function listMapSiteSummaries(sites: MapSites): MapSiteSummary[] {
    return plain.listMappedSiteSummaries(sites)
}

/** The site the party is in, by the deepest footer match; `null` outside every mapped site. */
export function resolveActiveMapSite(sites: MapSites, currentLocation: string): MapSite | null {
    return plain.resolveActiveDungeonSite({ version: MAP_FORMAT_VERSION, sites }, currentLocation)
}

/** Sites named exactly in a text (the user's message): referenced, not necessarily entered. */
export function resolveMentionedMapSites(sites: MapSites, text: string): MapSite[] {
    return plain.resolveMentionedDungeonSites({ version: MAP_FORMAT_VERSION, sites }, text)
}

// ── what the narrator and the player are shown ───────────────────────────

/** The always-on index: every mapped site, so the narrator never maps one twice. */
export function buildMappedSitesInjection(sites: MapSites): string {
    return plain.buildMappedSitesInjection(sites)
}

/** The site's map as GM canon, with the footer rules the legacy attaches. */
export function buildMapCanonInjection(
    site: MapSite,
    currentLocation: string,
    options: { activityText?: string; referencedByName?: boolean } = {},
): string {
    return plain.buildDungeonRealityInjection(site, currentLocation, options)
}

/** The map as compact prose for the narrator: routes, areas with their facts, assets. */
export function formatMapForNarrator(documentOrBody: MapDocument | string, siteFallback = ''): string {
    return plain.formatDungeonMapForNarrator(documentOrBody, siteFallback)
}

/** The map as the player may see it: visited areas in full, discovered by name, nothing unrevealed. */
export function formatMapForPlayer(documentOrBody: MapDocument | string, currentLocation = ''): string {
    return plain.formatDungeonMapForPlayer(documentOrBody, currentLocation)
}

/** The heading of the two blocks, as the Prompt Breakdown shows them. */
export const MAPPED_SITES_HEADING = '[MAPPED_SITES — INTERNAL]'
export const MAP_CANON_HEADING = '[DUNGEON_REALITY — INTERNAL GM CANON]'
