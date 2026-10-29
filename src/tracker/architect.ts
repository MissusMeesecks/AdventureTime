/**
 * The Map Architect (roadmap row 9, Phase 34a): the narrator's map tool, and
 * the two prompts that answer it.
 *
 * The narrator's rulebook tells it to call `CreateAreaMap` once, as the party
 * reaches an unmapped site, with the site's name, its entrance, its kind,
 * scale and threat, and a private design brief. The architect then makes two
 * model calls: the *topology* -- the areas and how they connect, validated
 * against the document's rules and corrected on failure -- and then, with the
 * topology locked, the *contents*. The result is saved into the site's
 * Location entry as its `[MAP]`, and the narrator is handed the map as canon
 * with a line on how to go on.
 *
 * What is the legacy's is the legacy's: `architect-legacy.js` is *generated*
 * from the pin (CLAUDE.md 3a-bis) and holds the three system prompts, the
 * JSON recovery, the response schemas, the prompt builders and the tool's own
 * schema. This file is the typed face; the model calls and the save are in
 * `backend/map-architect.ts`.
 */

import type { ToolRegistrationDTO } from 'lumiverse-spindle-types'

import { createArchitectLegacy } from './architect-legacy.js'
import { type GatewayKind, isAttachmentFailure, normalizeMapAttachment, type HostContext, type MapAttachment } from './hosting.js'
import { createMapLegacy } from './map-legacy.js'
import { createOpenerLegacy } from './opener-legacy.js'
import {
    normalizeMapSiteKind,
    normalizeMapSiteThreat,
    type MapDocument,
    type MapSite,
    type MapSiteKind,
    type MapSites,
    type MapSiteThreat,
} from './map.js'

const map = createMapLegacy()
const plain = createArchitectLegacy(map)

/** The legacy's builders that take a host context (58), typed: the generated file infers `null` from their defaults. */
interface HostedBuilders {
    findExistingArchitectSite(sites: MapSites, site: string, host: HostContext | null): MapSite | undefined
    topologyUserPrompt(args: ArchitectArgs, story: string, reference: string, currentLocation: string, host: HostContext | null, knowledge: EntranceKnowledge): string
    topologyCorrectionPrompt(args: ArchitectArgs, story: string, reference: string, priorOutput: string, parseError: string | null, issues: ArchitectIssue[], attempt: number, host: HostContext | null, knowledge: EntranceKnowledge): string
    assetsUserPrompt(args: ArchitectArgs, topology: MapDocument, story: string, reference: string, currentTime: string, include: IncludeManifestItem[], host: HostContext | null): string
    assetsCorrectionPrompt(args: ArchitectArgs, topology: MapDocument, story: string, reference: string, priorOutput: string, parseError: string | null, issues: ArchitectIssue[], attempt: number, currentTime: string, include: IncludeManifestItem[], host: HostContext | null): string
    resolveIncludeManifest(include: string[], sites: MapSites, hostSite: string): IncludeManifestItem[]
    inclusionValidationErrors(document: MapDocument, include: IncludeManifestItem[]): ArchitectIssue[]
}
const hosted = plain as unknown as HostedBuilders

export const CREATE_AREA_MAP_TOOL_NAME = 'CreateAreaMap'
export const MAX_CORRECTION_ATTEMPTS = 2

export const DEFAULT_MAP_ARCHITECT_TOPOLOGY_SYSTEM_PROMPT: string = plain.DEFAULT_MAP_ARCHITECT_TOPOLOGY_SYSTEM_PROMPT
export const DEFAULT_MAP_ARCHITECT_SYSTEM_PROMPT: string = plain.DEFAULT_MAP_ARCHITECT_SYSTEM_PROMPT
/** The Auto brief's system prompt (71a): the architect filling only the CreateAreaMap handshake, the site locked. */
export const DEFAULT_MAP_ARCHITECT_BRIEF_SYSTEM_PROMPT: string = plain.DEFAULT_MAP_ARCHITECT_BRIEF_SYSTEM_PROMPT

/** The tool as Spindle registers it: the legacy's schema, word for word, under Spindle's field names. */
export function createAreaMapToolRegistration(): ToolRegistrationDTO {
    const tool = plain.CREATE_AREA_MAP_TOOL as { name: string; displayName: string; description: string; parameters: Record<string, unknown> }
    return {
        name: tool.name,
        display_name: tool.displayName,
        description: tool.description,
        parameters: tool.parameters,
        inline_available: true,
    }
}

export type MapScale = 'SMALL' | 'MEDIUM' | 'LARGE'

/** The call, cleaned: what the two prompts and the save are built from. */
export interface ArchitectArgs {
    site: string
    entrance: string
    prompt: string
    briefDescription: string
    kind: MapSiteKind
    scale: MapScale
    threat: MapSiteThreat
    /** The parent map and the cell the child hangs in (58); absent for a standalone map. */
    attachTo?: MapAttachment
    /** Existing mapped DUNGEON or INTERIOR sites a new SETTLEMENT absorbs as peers (62); absent when none. */
    include?: string[]
    /** The user-selected reference context (71a): lorebooks and cards sent to the architect from the panel; absent for the narrator's call. */
    reference?: string
    /** Extra keywords for a root made from the panel (71a); absent for the narrator's call. */
    locationKeys?: string[]
}

/** One included peer, resolved before the draw (62): the site as the books title it, its map's kind, the gateway asset it must get, and its root entry's id, locked. */
export interface IncludeManifestItem {
    site: string
    kind: 'DUNGEON' | 'INTERIOR'
    assetKind: GatewayKind
    entryId: string
}

/** The knowledge the entrance starts with: visited, or unrevealed for an offsite structural creation (58). */
export type EntranceKnowledge = 'VISITED' | 'UNREVEALED'

/** A failure the narrator is told about, in the legacy's private envelope. The text is the whole result. A message already in an envelope (an attachment error, 58) stands as it is. */
export class ArchitectFailure extends Error {
    constructor(message: string) {
        super(message.startsWith('[MAP_ARCHITECT_') ? message : plain.mapArchitectFailure(message).message)
        this.name = 'ArchitectFailure'
    }
}

/**
 * The raw call as the legacy reads it: the three required strings, the kind,
 * scale and threat normalised, a brief made from the prompt when none was
 * given, `attachTo` as the hosting reads it (58), and `include` as the
 * legacy reads it (62): names deduplicated, and allowed only on a SETTLEMENT.
 */
export function normalizeArchitectArgs(raw: Record<string, unknown> | null | undefined): ArchitectArgs {
    const input = raw ?? {}
    const text = (v: unknown) => String(v ?? '').trim()
    const args: ArchitectArgs = {
        site: text(input.site),
        entrance: text(input.entrance),
        prompt: text(input.prompt || input.premise),
        briefDescription: text(input.brief_description || input.briefDescription),
        kind: normalizeMapSiteKind(input.kind),
        scale: text(input.scale).toUpperCase() as MapScale,
        threat: (normalizeMapSiteThreat(input.threat, map.defaultMapSiteThreat(input.kind)) || 'LOW') as MapSiteThreat,
    }
    if (!args.site || !args.entrance || !args.prompt) {
        throw new ArchitectFailure('site, entrance, and prompt are required. Establish those facts before a later attempt.')
    }
    try {
        const attachTo = normalizeMapAttachment(input.attachTo)
        if (attachTo) args.attachTo = attachTo
    } catch (error) {
        if (isAttachmentFailure(error)) throw new ArchitectFailure(error.message)
        throw error
    }
    const include = plain.normalizeInclude(input.include) as string[]
    if (include.length) {
        if (args.kind !== 'SETTLEMENT') throw new ArchitectFailure('include[] is valid only while first creating a SETTLEMENT map.')
        args.include = include
    }
    if (!args.briefDescription) args.briefDescription = plain.legacyBriefDescription(args.prompt, args.site)
    if (!['SMALL', 'MEDIUM', 'LARGE'].includes(args.scale)) args.scale = 'MEDIUM'
    // The panel's own two (71a): carried as given, never read off a tool call's shape.
    if (typeof input.reference === 'string' && input.reference.trim()) args.reference = input.reference.trim()
    const locationKeys = cleanKeys(Array.isArray(input.locationKeys) ? input.locationKeys : [])
    if (locationKeys.length) args.locationKeys = locationKeys
    return args
}

/** The legacy's `cleanKeys`: trimmed, unique, at most six — its hard cap against keyword bloat. */
export function cleanKeys(keys: readonly unknown[]): string[] {
    return [...new Set(keys.map((k) => String(k ?? '').trim()).filter(Boolean))].slice(0, 6)
}

/** The legacy's `locationKeysForNewRoot`: the site first, then the user's keywords, capped at six. */
export function locationKeysForNewRoot(site: string, keys: readonly unknown[]): string[] {
    return cleanKeys([site, ...keys])
}

/**
 * The included peers resolved against the campaign's maps (62): each name
 * must match exactly one mapped site, a DUNGEON or an INTERIOR, not hosted
 * elsewhere already; the legacy's refusals come back in the envelope.
 */
export function resolveIncludeManifest(include: string[], sites: MapSites, hostSite: string): IncludeManifestItem[] {
    try {
        return hosted.resolveIncludeManifest(include, sites, hostSite)
    } catch (error) {
        throw new ArchitectFailure(error instanceof Error ? error.message : String(error))
    }
}

/** The site a call names, when the campaign already maps it; under a host (58), the canonical path's record first, else a standalone one not hosted elsewhere. */
export function findExistingSite(sites: MapSites, site: string, hostContext: HostContext | null = null): MapSite | undefined {
    return hosted.findExistingArchitectSite(sites, site, hostContext)
}

/** The legacy's answer when an existing map is hung inside a host (58): the map, and how to go on. */
export function existingPeerLinkedResult(hostSite: string, document: MapDocument, explicit: boolean): string {
    const continuation = explicit
        ? 'This was an offsite structural edit. Keep the current player location and narration unchanged.'
        : 'Keep unseen facts private and continue narration from the player-observable entrance.'
    return `[MAP_ARCHITECT_RESULT — PRIVATE]\nThe existing peer map was preserved and linked inside ${hostSite}.\n\n${map.formatDungeonMapForNarrator(document)}\n\n${continuation}\n[/MAP_ARCHITECT_RESULT]`
}

/** The legacy's answer when the map is already there: the map, and "reuse it". */
export function existingMapResult(site: MapSite): string {
    return plain.existingResult(site)
}

export interface ArchitectIssue {
    code: string
    path: string
    hint: string
}

/** A model reply as JSON, or why not: a fence or a preface is tolerated, an unbalanced object is not. */
export function parseArchitectResponse(text: string): { value: Record<string, unknown> | null; error: string | null } {
    return plain.parseMapArchitectResponse(text)
}

// ── the topology ─────────────────────────────────────────────────────────

export function buildTopologyPrompt(args: ArchitectArgs, story: string, currentLocation: string, host: HostContext | null = null, entranceKnowledge: EntranceKnowledge = 'VISITED'): string {
    return hosted.topologyUserPrompt(args, story, args.reference ?? '', currentLocation, host, entranceKnowledge)
}

export function buildTopologyCorrectionPrompt(args: ArchitectArgs, story: string, priorOutput: string, parseError: string | null, issues: ArchitectIssue[], attempt: number, host: HostContext | null = null, entranceKnowledge: EntranceKnowledge = 'VISITED'): string {
    return hosted.topologyCorrectionPrompt(args, story, args.reference ?? '', priorOutput, parseError, issues, attempt, host, entranceKnowledge)
}

/** The reply as a locked topology, or the issues to correct. */
export function validateTopology(reply: string, args: ArchitectArgs, entranceKnowledge: EntranceKnowledge = 'VISITED'): { topology: MapDocument | null; issues: ArchitectIssue[]; parseError: string | null } {
    const parsed = parseArchitectResponse(reply)
    if (parsed.value?.areas) map.canonicalizeReciprocalConnectionDetails(parsed.value.areas)
    const envelope: ArchitectIssue[] = plain.envelopeErrors(parsed.value, ['version', 'site', 'kind', 'threat', 'areas'], 'areas', 'Topology')
    const candidate = parsed.value && !envelope.length
        ? { version: parsed.value.version, site: parsed.value.site, kind: parsed.value.kind, threat: parsed.value.threat, areas: parsed.value.areas, assets: [] }
        : null
    const validation = candidate
        ? map.validateDungeonMapArchitecture(candidate, { site: args.site, entrance: args.entrance, entranceKnowledge, scale: args.scale, kind: args.kind, threat: args.threat })
        : { valid: false, errors: [] as ArchitectIssue[], document: null }
    if (validation.valid) return { topology: validation.document as MapDocument, issues: [], parseError: null }
    const issues: ArchitectIssue[] = parsed.error
        ? [{ code: 'INVALID_JSON', path: '$', hint: parsed.error }]
        : [...envelope, ...(validation.errors as ArchitectIssue[])]
    return { topology: null, issues, parseError: parsed.error }
}

// ── the contents ─────────────────────────────────────────────────────────

export function buildAssetsPrompt(args: ArchitectArgs, topology: MapDocument, story: string, currentTime: string, host: HostContext | null = null, include: IncludeManifestItem[] = []): string {
    return hosted.assetsUserPrompt(args, topology, story, args.reference ?? '', currentTime, include, host)
}

export function buildAssetsCorrectionPrompt(args: ArchitectArgs, topology: MapDocument, story: string, priorOutput: string, parseError: string | null, issues: ArchitectIssue[], attempt: number, currentTime: string, host: HostContext | null = null, include: IncludeManifestItem[] = []): string {
    return hosted.assetsCorrectionPrompt(args, topology, story, args.reference ?? '', priorOutput, parseError, issues, attempt, currentTime, include, host)
}

/** The reply's assets placed on the locked topology, as a whole validated map, or the issues to correct; with included peers (62), each must be exactly one asset of its gateway kind. */
export function validateAssets(reply: string, topology: MapDocument, args: ArchitectArgs, entranceKnowledge: EntranceKnowledge = 'VISITED', include: IncludeManifestItem[] = []): { document: MapDocument | null; issues: ArchitectIssue[]; parseError: string | null } {
    const parsed = parseArchitectResponse(reply)
    const envelope: ArchitectIssue[] = plain.envelopeErrors(parsed.value, ['assets'], 'assets', 'Content placement')
    const candidate = parsed.value && !envelope.length
        ? { ...plain.lockedTopologyForPrompt(topology), assets: parsed.value.assets }
        : null
    const validation = candidate
        ? map.validateDungeonMapArchitecture(candidate, { site: args.site, entrance: args.entrance, entranceKnowledge, scale: args.scale, kind: args.kind, threat: args.threat })
        : { valid: false, errors: [] as ArchitectIssue[], document: null }
    const included = validation.valid ? hosted.inclusionValidationErrors(validation.document as MapDocument, include) : []
    if (validation.valid && !included.length) return { document: validation.document as MapDocument, issues: [], parseError: null }
    const issues: ArchitectIssue[] = parsed.error
        ? [{ code: 'INVALID_JSON', path: '$', hint: parsed.error }]
        : [...envelope, ...(validation.errors as ArchitectIssue[]), ...included]
    return { document: null, issues, parseError: parsed.error }
}

/** The first dozen issues on one line, for a failure the narrator is told about. */
export function describeIssues(issues: ArchitectIssue[]): string {
    return plain.conciseIssues(issues)
}

// ── the result ───────────────────────────────────────────────────────────

/** What a new root Location entry says above its map: the brief, in the legacy's CORE block. */
export function rootEntryCore(site: string, brief: string): string {
    const body = String(brief ?? '').trim()
    return `[CORE]\n${body || (map.mappedSiteBoilerplateCore(site) as string)}\n[/CORE]`
}

/**
 * The architect's brief description written into an existing root entry's
 * `[CORE]` (45c, upstream 2026.8.80: the Location's General field): only
 * when the entry has no `[CORE]`, an empty one, or the shipped mapped-site
 * boilerplate. A description the agent or the user wrote stands.
 */
export function applyMappedSiteCore(content: string, site: string, brief: string): string {
    return map.applyMappedSiteLocationCore(content, site, brief) as string
}

/** The legacy's result envelope: the status, the map as the narrator reads it, and how to go on — or, for an offsite structural edit (58), that nothing moves. */
export function architectResult(status: string, document: MapDocument, args: ArchitectArgs, explicit = false): string {
    const continuation = explicit
        ? 'This was an offsite structural edit. Do not move the player, change the Location footer, or narrate entry into the new map.'
        : `Continue narration from ${args.entrance}; reveal only what the player can perceive. Once they enter, copy this exact site name into the Location footer: "${args.site}".`
    return `[MAP_ARCHITECT_RESULT — PRIVATE]\n${status}\nTreat this as objective current canon. Do not expose unseen facts.\n\n${map.formatDungeonMapForNarrator(document)}\n\n${continuation}\n[/MAP_ARCHITECT_RESULT]`
}

/**
 * What the narrator is told while the map is still being drawn (34a-bis).
 * The host times a tool invocation out long before two model calls return,
 * so the tool answers at once with this, and the map reaches the narrator
 * through the injection from the next turn: the index always, the canon
 * once the footer puts the party inside. The narrator is held to the
 * entrance meanwhile, so the map decides the inside.
 */
export function architectAcknowledgement(args: ArchitectArgs, host: HostContext | null = null): string {
    if (host?.explicit) {
        return `[MAP_ARCHITECT_RESULT — PRIVATE]\nThe Map Architect is drawing "${args.site}" (${args.kind}) inside "${host.hostSite}", in the cell named, now. It takes two model calls and finishes after this reply: the site will be listed in [MAPPED_SITES — INTERNAL] from the next turn, and its map sent as GM canon once the Location footer places the party inside it.\nThis is an offsite structural edit. Do not move the player, change the Location footer, or narrate entry into the new map.\nDo not call CreateAreaMap again for this site.\n[/MAP_ARCHITECT_RESULT]`
    }
    const absorbing = args.include?.length ? ` The existing maps of ${args.include.map((name) => `"${name}"`).join(', ')} will be absorbed into it as peers, each reachable from the district it is placed in.` : ''
    return `[MAP_ARCHITECT_RESULT — PRIVATE]\nThe Map Architect is drawing "${args.site}" (${args.kind})${host ? ` inside "${host.hostSite}"` : ''} now. It takes two model calls and finishes after this reply: the site will be listed in [MAPPED_SITES — INTERNAL] from the next turn, and its map sent as GM canon once the Location footer places the party inside it.${absorbing}\nNarrate only up to and including the entrance, ${args.entrance}; reveal only what the player can perceive there. Do not invent the layout, occupants or contents beyond the entrance — the map will decide them, and you will have it next turn. Once they enter, copy this exact site name into the Location footer: "${args.site}".\nDo not call CreateAreaMap again for this site.\n[/MAP_ARCHITECT_RESULT]`
}

/** Whether a Location entry's title is this site, by the legacy's loose match. */
export function siteRootsMatch(left: string, right: string): boolean {
    return map.dungeonSiteRootsMatch(left, right)
}

// ── the text opener (Phase 46), the parser half ─────────────────────────
//
// The legacy's alternative handshake for a connection that cannot call
// tools: the narrator writes a `[CREATE_AREA_MAP] … [/CREATE_AREA_MAP]`
// block in its reply and stops, the block is stripped from the reply and
// drawn by the architect, and the narrator is briefed. The rules and the
// setting's reader are in `opener.ts`, which the rulebook can afford; the
// parser needs the map library, so its face is here.

const opener = createOpenerLegacy(map)

/** The block's arguments as the legacy normalises them: the tool's field names, so `normalizeArchitectArgs` reads them unchanged. */
export interface CreateAreaMapCommandArgs {
    site: string
    entrance: string
    prompt: string
    brief_description: string
    kind: string
    scale: string
    threat: string
    include?: string[]
    attachTo?: { site: string; cell: string }
}

export interface CreateAreaMapCommand {
    args: CreateAreaMapCommandArgs
    /** The prose before the block. */
    preamble: string
    /** The block as written. */
    raw: string
}

/** The block in a reply, decoded and parsed, or `null` when there is none. */
export function parseCreateAreaMapCommand(text: string): CreateAreaMapCommand | null {
    return opener.parseCreateAreaMapCommand(text) as CreateAreaMapCommand | null
}

/** Whether the block named everything the legacy requires: site, entrance, kind, prompt and brief_description. */
export function createAreaMapCommandIsComplete(args: CreateAreaMapCommandArgs | null | undefined): boolean {
    return !!opener.createAreaMapCommandIsComplete(args)
}

/** The reply without the block and everything after it; a zero-width space when nothing was before it. */
export function stripCreateAreaMapCommand(text: string): { text: string; command: CreateAreaMapCommand | null } {
    return opener.stripCreateAreaMapCommand(text) as { text: string; command: CreateAreaMapCommand | null }
}

/** The private brief the narrator is handed once the map is drawn: narrate from the entrance, copy the site name into the footer. */
export function textOpenerBrief(args: { entrance?: string }): string {
    return opener.buildMapArchitectContinueBrief(args) as string
}
