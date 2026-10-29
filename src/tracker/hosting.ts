/**
 * Nested maps (roadmap row 58, Phase 58): a child map hung inside a
 * parent's area.
 *
 * The narrator's call may name `attachTo` — the exact parent map and the
 * exact area that receives the gateway — or, with a mapped site active and
 * no `attachTo`, the active cell stands as shorthand. Either way the host
 * context resolved here tells the two prompts what the parent cell is like,
 * gives the save the canonical path `Parent :: Cell :: Child`, and names the
 * gateway asset the parent map gains: a `SUBDUNGEON` for a dungeon, a
 * `SUBINTERIOR` for an interior. A hosted document is stamped with its
 * `hostSite` and `hostBrief` (the way back out), the root entry's `[CORE]`
 * mirrors them, and a root that was standalone is reparented with its
 * breadcrumbs. The chain is three maps deep at most, and a settlement is
 * never hosted.
 *
 * What is the legacy's is the legacy's: `hosting-legacy.js` is *generated*
 * from the pin (CLAUDE.md 3a-bis). This file is the typed face; the save is
 * in `backend/map-architect.ts`.
 */

import { createHostingLegacy } from './hosting-legacy.js'
import { createMapLegacy } from './map-legacy.js'
import type { MapAsset, MapDocument, MapSites } from './map.js'

const map = createMapLegacy()
const plain = createHostingLegacy(map)

/** How many maps a host chain may hold. */
export const MAX_HOSTED_MAP_DEPTH: number = plain.MAX_HOSTED_MAP_DEPTH

/** The envelope the legacy's attachment errors open with; the whole message is the narrator's answer. */
export const ATTACHMENT_ERROR_TAG = '[MAP_ARCHITECT_ATTACHMENT_ERROR — PRIVATE]'

export function isAttachmentFailure(error: unknown): error is Error {
    return error instanceof Error && error.message.startsWith(ATTACHMENT_ERROR_TAG)
}

export interface MapAttachment {
    site: string
    cell: string
}

export type GatewayKind = 'SUBDUNGEON' | 'SUBINTERIOR'

/** What a hosted creation knows about its parent: read by the prompts and the save. */
export interface HostContext {
    hostSite: string
    /** `Book::uid` of the parent's root entry. */
    hostEntryId: string
    hostAreaId: string
    assetName: string
    /** `Parent :: Cell :: Child`, the child's canonical root. */
    peerSite: string
    expectedAssetKind: GatewayKind
    briefDescription: string
    topologyPromptContext: string
    promptContext: string
    /** Named by `attachTo`, rather than the active cell as shorthand. */
    explicit: boolean
    hostDepth: number
    peerDepth: number
}

/** `attachTo` as the legacy reads it: both strings, or `null` for none. Throws the attachment envelope for a bad shape. */
export function normalizeMapAttachment(value: unknown): MapAttachment | null {
    return plain.normalizeMapAttachment(value) as MapAttachment | null
}

/**
 * The host context a call resolves to, or `null` for a standalone map: an
 * `attachTo` names the parent and the cell exactly, a DUNGEON or INTERIOR
 * created with a mapped site active takes the active cell, and a
 * SETTLEMENT is never hosted. Throws the attachment envelope when the
 * parent, the cell or the depth refuses it.
 */
export function resolveHostContext(sites: MapSites, currentLocation: string, args: { site: string; kind: string; briefDescription: string; attachTo?: MapAttachment | null }): HostContext | null {
    return plain.resolveHostedCreationContext({ sites }, currentLocation, args) as HostContext | null
}

/** The gateway asset on the parent map, promoted from a matching BUILDING or OBJECT or made anew; the document is changed in place. */
export function promoteGateway(hostDocument: MapDocument, site: string, expectedKind: GatewayKind, areaId: string, briefDescription: string, hidden: boolean): MapAsset {
    return plain.promoteHostedPeerAsset(hostDocument, site, expectedKind, areaId, briefDescription, { hidden }) as MapAsset
}

/** `Parent :: Cell :: Child` for the asset's cell. */
export function peerSitePath(hostDocument: MapDocument, asset: MapAsset): string {
    return plain.buildHostedPeerSitePath(hostDocument, asset) as string
}

/** The child's document stamped with its host and the way back out; a copy. */
export function stampHostedPeer(peerDocument: MapDocument, hostDocument: MapDocument, asset: MapAsset): MapDocument {
    return plain.stampHostedPeerDocument(peerDocument, hostDocument, asset) as MapDocument
}

/** The host lines mirrored into the entry's `[CORE]`, once. */
export function mirrorHostCore(content: string, hostSite: string, hostBrief: string): string {
    return plain.ensureHostCoreMirror(content, hostSite, hostBrief) as string
}

/** An entry as the reparenting reads and changes it. */
export interface HostedEntry {
    comment: string
    content: string
    key?: string[]
}

/** A standalone root renamed to its canonical path, its breadcrumbs and any hosted maps under it rebased; in place, true when anything moved. */
export function reparentHostedEntries(entries: Record<string, HostedEntry>, entry: HostedEntry, canonicalSite: string, requestedSite: string): boolean {
    return !!plain.reparentHostedLocationEntries(entries, entry, canonicalSite, requestedSite)
}

/** The root entry a hosted save writes into: the canonical path's, a compatible standalone root's, or none. */
export function findHostedMapEntry<T extends HostedEntry>(entries: Record<string, T>, canonicalSite: string, requestedSite: string, hostContext: HostContext): T | null {
    return (plain.findArchitectMapEntry(entries, canonicalSite, requestedSite, hostContext) as T | null) ?? null
}
