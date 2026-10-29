/**
 * The Map Updater (roadmap row 9, Phase 34b): keeping a map current with
 * play.
 *
 * After a reply inside a mapped site, the updater asks a model for one
 * *transaction* against that site's map -- who moved, what died, what was
 * taken, which route opened, which building the party stepped into -- and
 * applies it only if the document's rules accept every operation. The map
 * library's `applyDungeonMapTransaction` is the judge; this file adds the
 * legacy's checks around it (a companion is never a map asset; a building the
 * party just entered must be populated and marked entered; `{"noop":true}`
 * is the honest answer when nothing durable changed) and the prompts that
 * frame the question.
 *
 * What is the legacy's is the legacy's: `updater-legacy.js` is *generated*
 * from the pin (CLAUDE.md 3a-bis) and holds the two system prompts, the
 * helper library, the prompt builders and the thread bookkeeping. This file
 * is the typed face; the model calls, the story and the commit are in
 * `backend/map-updater.ts`.
 */

import { parseArchitectResponse, type ArchitectIssue } from './architect.js'
import { createMapLegacy } from './map-legacy.js'
import type { MapDocument } from './map.js'
import { extractCurrentTimeStr } from './time.js'
import { createUpdaterLegacy } from './updater-legacy.js'

const map = createMapLegacy()
const plain = createUpdaterLegacy({ ...map, extractCurrentTimeStr })

export const DEFAULT_MAP_UPDATER_SYSTEM_PROMPT: string = plain.DEFAULT_MAP_UPDATER_SYSTEM_PROMPT
export const DEFAULT_MAP_UPDATER_DIRECT_SYSTEM_PROMPT: string = plain.DEFAULT_MAP_UPDATER_DIRECT_SYSTEM_PROMPT
export const MAX_UPDATER_CORRECTION_ATTEMPTS = 2
/** A building the party has just entered needs this much story to furnish. The legacy's 10. */
export const BUILDING_POPULATION_MIN_LOOKBACK_TURNS: number = plain.BUILDING_POPULATION_MIN_LOOKBACK_TURNS
/** The root entry's extension holding the operation ids already applied, so a retried transaction is applied once. */
export const MAP_OPERATION_IDS_KEY = 'multihogDungeonMapOperationIds'
/** The legacy's ceiling on applied operation ids kept per site. */
export const MAX_APPLIED_OPERATIONS = 100

// ── the story ────────────────────────────────────────────────────────────

/** A chat message as the updater reads it. */
export interface StoryMessage {
    role: 'user' | 'assistant' | 'system'
    text: string
}

/**
 * Which messages the pass reads: since the last pass when there was one
 * (the watermark is the chat's length then), the last `lookback` user turns
 * otherwise or on a manual run, and never fewer than `minTurns` user turns
 * when a building needs furnishing.
 */
export function resolveStoryWindow(messages: readonly StoryMessage[], options: { watermark: number; lookback: number; manual?: boolean; minTurns?: number | null }): { startIdx: number; sinceLastRun: boolean } {
    const chat = messages.map((m) => ({ is_user: m.role === 'user' }))
    const window = { isManual: !!options.manual, lookback: options.manual ? options.lookback : null, minLookbackTurns: options.minTurns ?? null }
    return plain.resolveMapUpdaterStoryWindow(chat, { mapUpdaterLastRunChatLength: options.watermark, routerLookback: options.lookback }, window as unknown as Parameters<typeof plain.resolveMapUpdaterStoryWindow>[2])
}

/** The story from `startIdx` on, as the legacy formats it: `Player:` and `Narrator:` lines, system messages left out. */
export function formatStory(messages: readonly StoryMessage[], startIdx: number): string {
    return messages
        .slice(Math.max(0, startIdx))
        .filter((m) => m.role !== 'system')
        .map((m) => { const text = m.text.trim(); return text ? `${m.role === 'user' ? 'Player' : 'Narrator'}: ${text}` : '' })
        .filter(Boolean)
        .join('\n\n')
}

/** The footer the party had inside a site before the last one, for the exit pass; the site itself when none. */
export function previousFooterForSite(messages: readonly StoryMessage[], siteRoot: string): string {
    return plain.previousFooterForSite(messages.map((m) => ({ role: m.role, mes: m.text })), siteRoot)
}

/** The in-world time the pass is told: the story's own stamp first, the memo's `[TIME]` otherwise. */
export function currentTimeFor(memo: string, story: string): string {
    return plain.currentTimeFrom({ currentMemo: memo }, story)
}

/** The names in the memo's `[PARTY]` block. */
export function partyNames(memo: string): string[] {
    return plain.extractPartyMemberNames(memo)
}

// ── the prompts ──────────────────────────────────────────────────────────

/** A BUILDING the party has entered and the map has not furnished, or a named one the map lacks. */
export interface PopulationTarget {
    building: { id: string; name: string; detail?: string; owner?: string; notEntered?: boolean } | null
    area: { id: string; name: string; geometry?: string[] }
    children: unknown[]
    untrackedName: string
    phase?: string
    playerText?: string
}

export function resolvePopulationTarget(document: MapDocument, currentLocation: string): PopulationTarget | null {
    return map.resolveBuildingPopulationTarget(document, currentLocation) as PopulationTarget | null
}

/** The compact direct-command prompt when the user gave an instruction; the user's own or the stock one otherwise. */
export function selectSystemPrompt(instruction: string, userPrompt: string): string {
    return plain.selectMapUpdaterSystemPrompt(instruction, userPrompt.trim() || DEFAULT_MAP_UPDATER_SYSTEM_PROMPT)
}

export interface UpdaterPromptContext {
    siteRoot: string
    document: MapDocument
    currentLocation: string
    story: string
    memo: string
    currentTime: string
    populationTarget: PopulationTarget | null
    /** The user's direct instruction; `''` for a routine pass. */
    instruction: string
    /** The party has left this site: review who left with them. */
    exitPass?: boolean
    /** A manual pass on a site the party is not in. */
    inspectorPass?: boolean
    previousLocation?: string
}

function loaded(ctx: UpdaterPromptContext): { context: { siteRoot: string; document: MapDocument }; currentLocation: string } {
    return { context: { siteRoot: ctx.siteRoot, document: ctx.document }, currentLocation: ctx.currentLocation }
}

function promptOptions(ctx: UpdaterPromptContext): { inspectorPass: boolean; exitPass: boolean; previousLocation: string } {
    return { inspectorPass: !!ctx.inspectorPass, exitPass: !!ctx.exitPass, previousLocation: ctx.previousLocation ?? '' }
}

export function buildUpdaterPrompt(ctx: UpdaterPromptContext): string {
    return plain.initialUserPrompt(loaded(ctx), ctx.story, ctx.memo, ctx.currentTime, ctx.populationTarget as null, ctx.instruction, promptOptions(ctx))
}

export function buildUpdaterCorrectionPrompt(ctx: UpdaterPromptContext, priorOutput: string, issues: ArchitectIssue[], attempt: number): string {
    return plain.correctionPrompt(loaded(ctx), ctx.story, priorOutput, issues, attempt, ctx.memo, ctx.currentTime, ctx.populationTarget as null, ctx.instruction, promptOptions(ctx))
}

// ── the verdict ──────────────────────────────────────────────────────────

export interface AppliedTransaction {
    operationId: string
    document: MapDocument
    createdAssets: Array<{ id: string; name: string }>
    createdAreas: Array<{ id: string; name: string }>
    chronicles: Array<{ areaId: string; areaName: string; text: string }>
}

export type UpdaterVerdict =
    | { kind: 'noop' }
    | { kind: 'applied'; transaction: Record<string, unknown>; applied: AppliedTransaction }
    | { kind: 'rejected'; issues: ArchitectIssue[]; parseError: string | null }

/**
 * The map library's judgement on a transaction: the new document, or what is
 * wrong. The document given is never changed. `frozenAreaIds` is Map
 * Evolution's player bubble: an EVOLVED operation touching one is refused.
 */
export function applyTransaction(document: MapDocument, transaction: unknown, currentTime: string, frozenAreaIds: readonly string[] = []): { ok: true; applied: AppliedTransaction } | { ok: false; issues: ArchitectIssue[] } {
    const result = map.applyDungeonMapTransaction(document, transaction as object, { currentTime, frozenAreaIds: [...frozenAreaIds] } as { frozenAreaIds?: string[] }) as { ok: boolean; errors?: ArchitectIssue[]; operationId?: string; document?: MapDocument; createdAssets?: AppliedTransaction['createdAssets']; createdAreas?: AppliedTransaction['createdAreas']; chronicles?: AppliedTransaction['chronicles'] }
    if (!result.ok) return { ok: false, issues: result.errors ?? [] }
    return { ok: true, applied: { operationId: String(result.operationId ?? ''), document: result.document as MapDocument, createdAssets: result.createdAssets ?? [], createdAreas: result.createdAreas ?? [], chronicles: result.chronicles ?? [] } }
}

/**
 * The legacy's chain of checks on a reply, in its order: JSON, no party member
 * added, every party member already on the map removed (routine passes only),
 * a noop honoured unless a building had to be furnished, the furnishing
 * done, and then the document's own rules.
 */
export function checkUpdaterReply(reply: string, ctx: { document: MapDocument; memo: string; populationTarget: PopulationTarget | null; directPass: boolean; currentTime: string }): UpdaterVerdict {
    const parsed = parseArchitectResponse(reply)
    if (!parsed.value) return { kind: 'rejected', issues: [{ code: 'INVALID_JSON', path: '$', hint: parsed.error || 'No JSON object was found.' }], parseError: parsed.error }
    const value = parsed.value
    const party: ArchitectIssue[] = plain.rejectPartyMemberAssets(value, ctx.memo)
    if (party.length) return { kind: 'rejected', issues: party, parseError: null }
    const removal: ArchitectIssue[] = ctx.directPass ? [] : plain.validatePartyMemberRemovalTransaction(value, ctx.document, ctx.memo)
    if (removal.length) return { kind: 'rejected', issues: removal, parseError: null }
    const population: ArchitectIssue[] = plain.validateBuildingPopulationTransaction(value, ctx.populationTarget as null)
    if (population.length) return { kind: 'rejected', issues: population, parseError: null }
    if (plain.isMapUpdaterNoop(value)) return { kind: 'noop' }
    const applied = applyTransaction(ctx.document, value, ctx.currentTime)
    if (!applied.ok) return { kind: 'rejected', issues: applied.issues, parseError: null }
    return { kind: 'applied', transaction: value, applied: applied.applied }
}

/** `SET_ASSET crypt-ghoul; ADD_ASSET Odran (CREATURE)`: the operations on one line, for the fold and the log. */
export function summarizeOperations(transaction: unknown): string {
    return plain.summarizeMapUpdaterOperations(transaction)
}

/** The first eight issues on one line, as the legacy logs them. */
export function describeUpdaterIssues(issues: readonly ArchitectIssue[]): string {
    return issues.slice(0, 8).map((issue) => `${issue.code} at ${issue.path}: ${issue.hint}`).join('; ')
}

/** The legacy's FNV-1a over the canonical JSON: the same transaction under any key order signs the same. */
export function transactionSignature(value: unknown): string {
    const canonicalize = (item: unknown): unknown => {
        if (Array.isArray(item)) return item.map(canonicalize)
        if (item && typeof item === 'object') {
            return Object.fromEntries(Object.keys(item).sort().map((key) => [key, canonicalize((item as Record<string, unknown>)[key])]))
        }
        return item
    }
    const source = JSON.stringify(canonicalize(value))
    let hash = 0x811c9dc5
    for (let index = 0; index < source.length; index++) {
        hash ^= source.charCodeAt(index)
        hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(16).padStart(8, '0')
}

/** What the root entry remembers of applied transactions. */
export interface AppliedOperation {
    id: string
    signature: string
}

export function readAppliedOperations(extensions: Record<string, unknown> | undefined): AppliedOperation[] {
    const raw = extensions?.[MAP_OPERATION_IDS_KEY]
    if (!Array.isArray(raw)) return []
    return raw
        .map((item) => (typeof item === 'string' ? { id: item, signature: '' } : item && typeof item === 'object' && typeof (item as AppliedOperation).id === 'string' ? { id: (item as AppliedOperation).id, signature: String((item as AppliedOperation).signature ?? '') } : null))
        .filter((item): item is AppliedOperation => !!item)
}

/** Whether a transaction was applied before: the same id with the same signature (or one recorded without), or a clash. */
export function priorApplication(applied: readonly AppliedOperation[], operationId: string, signature: string): 'applied' | 'conflict' | null {
    const prior = applied.find((item) => item.id === operationId)
    if (!prior) return null
    return !prior.signature || prior.signature === signature ? 'applied' : 'conflict'
}

// ── the chronicles ───────────────────────────────────────────────────────

/** A chronicle line stamped with the in-world time, unless it carries a day already. */
export function stampChronicle(text: string, currentTime: string): string {
    const clean = text.trim()
    if (!clean || !currentTime) return clean
    return /(?:\[Day\s+\d+|\[\d{1,2}\/\d{1,2}\/\d+)\b/i.test(clean) ? clean : `[${currentTime}] ${clean}`
}

/** The child Location entry an area's chronicle is filed in: `Site :: Area`, keyed by both. */
export function chronicleChild(siteRoot: string, areaName: string, text: string): { key: string[]; comment: string; content: string } {
    return {
        key: [areaName, siteRoot].map((k) => k.trim()).filter(Boolean),
        comment: `${siteRoot} :: ${areaName}`,
        content: `[CORE]\n${areaName} is a location within ${siteRoot}; its permanent details are established through play.\n[/CORE]\n${text}`,
    }
}

/** The entry already filed for an area under a site, by the legacy's loose match on `Site :: Area` or on title plus key. */
export function findChronicleChild<T extends { comment?: string; key?: string[] }>(entries: readonly T[], siteRoot: string, areaName: string): T | null {
    return entries.find((entry) => {
        const label = String(entry.comment ?? '').trim()
        const segments = label.split(/\s*::\s*/).filter(Boolean)
        if (segments.length > 1) return map.locationContainsSiteRoot(label, siteRoot) && map.dungeonLabelsMatch(segments.at(-1), areaName)
        const keys = Array.isArray(entry.key) ? entry.key : []
        return map.dungeonLabelsMatch(label, areaName) && keys.some((key) => map.dungeonSiteRootsMatch(key, siteRoot))
    }) ?? null
}

/** An entry's content with a chronicle line added, unless it already carries that line. */
export function appendChronicle(existing: string, text: string): string {
    const current = String(existing ?? '').trimEnd()
    const line = text.trim()
    if (!line) return current
    if (current.split(/\r?\n/).some((l) => l.trim() === line)) return current
    return current ? `${current}\n${line}` : line
}

// ── the threads Map Evolution reads ──────────────────────────────────────

export interface EvolutionThread {
    id: string
    at: string
    status: 'open' | 'resolved' | 'transformed'
    op: string
    subjectId: string
    actor: string
    cause: string
    summary: string
    compressed: boolean
}

export type ThreadsBySite = Record<string, EvolutionThread[]>

/** One thread per operation with a cause: what changed, who did it, why. */
export function threadsFromTransaction(transaction: unknown, options: { at: string; createdAssets: readonly { id: string; name: string }[] }): EvolutionThread[] {
    return plain.threadsFromMapTransaction(transaction, { at: options.at, createdAssets: [...options.createdAssets] as never[] })
}

/** The site's threads with these added, capped at the legacy's 400; a resolved thread closes the open ones on its subject. */
export function appendThreads(threadsBySite: ThreadsBySite | undefined, siteRoot: string, threads: readonly EvolutionThread[]): ThreadsBySite {
    return plain.appendEvolutionThreads(threadsBySite ?? {}, siteRoot, threads)
}
