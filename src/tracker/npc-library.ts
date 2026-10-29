/**
 * The NPC library (Phase 41): identity cards kept outside any chat.
 *
 * Multihog's library is a list of records — a name, keywords, the `[CORE]`
 * identity text of a campaign NPC or a Player Card, a portrait, notes — that
 * belongs to the install rather than to a campaign, so a character made in
 * one story can be put into another. `npc-library-legacy.js` is the legacy's
 * pure half, sliced whole and pinned; this is the typed face over it. The
 * legacy keeps the records on its settings object as `npcLibrary`; here they
 * are a list handed in and handed back, and the backend's store keeps them.
 *
 * What the legacy decides and this keeps: a record's text is identity only —
 * the first `[CORE]` block, the campaign's relationship lines dropped — so a
 * library card never carries one story's chronicle into another; a name is
 * unique in the library, a second gets ` (2)`; a package is one JSON file
 * with the portrait inside it as base64; and the two prompts that put a card
 * into play are the tracker's direct prompts, verbatim.
 */

import { createNpcLibraryLegacy } from './npc-library-legacy.js'

// The legacy's JSDoc types are narrower than its behaviour (`excludeId = null`, `keys` as a string); the face types the calls itself.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const plain = createNpcLibraryLegacy() as unknown as Record<string, any>

export interface LibraryRecord {
    id: string
    name: string
    keys: string[]
    /** The identity text: the `[CORE]` block, or the whole text when there is none. */
    content: string
    /** The portrait's reference (a host image address or a data URL), or `''`. */
    portraitPath: string
    notes: string
    createdAt: number
    updatedAt: number
}

export interface LibraryPackage {
    format: string
    version: number
    name: string
    keys: string[]
    content: string
    notes: string
    portrait: { mime: string; data: string } | null
    exportedAt: number
}

/** A package as read in: validated, the portrait a payload or `null`. */
export interface ParsedPackage {
    name: string
    keys: string[]
    content: string
    notes: string
    portrait: { mime: string; data: string } | null
}

export const LIBRARY_FORMAT: string = plain.NPC_LIBRARY_FORMAT as string
export const LIBRARY_PACK_FORMAT: string = plain.NPC_LIBRARY_PACK_FORMAT as string

/** The legacy's functions read and write `settings.npcLibrary`; a bag around the list is what they get. */
function bag(records: readonly LibraryRecord[]): { npcLibrary: LibraryRecord[] } {
    return { npcLibrary: [...records] }
}

/** The identity text of a card: its first `[CORE]` block with the campaign's relationship lines dropped, or the whole text so cleaned. */
export function identityOf(content: string): string {
    return String(plain.extractLibraryIdentityContent(content))
}

/** A name no other record has, as the legacy gives it: ` (2)`, ` (3)`, … */
export function uniqueName(base: string, records: readonly LibraryRecord[], excludeId: string | null = null): string {
    return String(plain.uniqueLibraryNpcName(base, bag(records), excludeId))
}

export function findByName(records: readonly LibraryRecord[], name: string): LibraryRecord | null {
    return (plain.findLibraryNpcByName(bag(records), name) as LibraryRecord | null) ?? null
}

export function findById(records: readonly LibraryRecord[], id: string): LibraryRecord | null {
    return (plain.findLibraryNpcById(bag(records), id) as LibraryRecord | null) ?? null
}

/** A record from its parts: the keys with the name first, the content reduced to its identity, the times set. */
export function createRecord(input: { name: string; content?: string; keys?: string[] | string; portraitPath?: string; notes?: string; id?: string; createdAt?: number }): LibraryRecord {
    return plain.createLibraryRecord(input) as LibraryRecord
}

/** The list with a record inserted or replaced (by `overwriteId`, or its own id). */
export function upsertRecord(records: readonly LibraryRecord[], record: LibraryRecord, overwriteId?: string): { records: LibraryRecord[]; stored: LibraryRecord } {
    const settings = bag(records)
    const stored = plain.upsertLibraryNpc(settings, record, overwriteId ? { overwriteId } : {}) as LibraryRecord
    return { records: settings.npcLibrary, stored }
}

/** The list without a record, and the record removed, or `null` when it was not there. */
export function removeRecord(records: readonly LibraryRecord[], id: string): { records: LibraryRecord[]; removed: LibraryRecord | null } {
    const settings = bag(records)
    const removed = plain.removeLibraryNpcRecord(settings, id) as LibraryRecord | null
    return { records: settings.npcLibrary, removed }
}

/** The list with every record's content reduced to its identity; `changed` when any was. */
export function sanitizeRecords(records: readonly LibraryRecord[]): { records: LibraryRecord[]; changed: boolean } {
    const settings = bag(records)
    const changed = Boolean(plain.sanitizeNpcLibraryRecords(settings))
    return { records: settings.npcLibrary, changed }
}

/** The list's line under a name: species and body, then the personality, as the legacy's row shows. */
export function blurb(content: string): string {
    return String(plain.getCardLibraryBlurb(content))
}

/** The appearance alone, cut at 260 characters: the legacy's card synopsis. */
export function synopsis(content: string): string {
    return String(plain.getCardAppearanceSynopsis(content))
}

export function slug(name: string): string {
    return String(plain.slugifyNpcName(name))
}

/** The legacy's file name for an exported record. */
export function packageFilename(record: { name: string }): string {
    return `multihog_npc_${slug(record.name)}.mnpc.json`
}

/** A record as one `.mnpc.json` package, the portrait inside it when a data URL is given. */
export function serializePackage(record: LibraryRecord, portraitDataUrl = ''): LibraryPackage {
    return plain.serializeNpcPackage(record, portraitDataUrl) as LibraryPackage
}

/** One package, a pack, or a list of packages, validated; throws the legacy's message for anything else. */
export function parsePackages(text: string): ParsedPackage[] {
    return plain.parseNpcPackages(text) as ParsedPackage[]
}

export function portraitPayload(dataUrl: string): { mime: string; data: string } | null {
    return (plain.portraitPayloadFromDataUrl(dataUrl) as { mime: string; data: string } | null) ?? null
}

export function dataUrlFromPayload(payload: { mime?: string; data?: string } | null | undefined): string {
    return String(plain.dataUrlFromPortraitPayload(payload))
}

/** The tracker's direct prompt that seats a library card in `[PARTY]`. */
export function partyPrompt(record: LibraryRecord): string {
    return String(plain.buildAddLibraryNpcToPartyPrompt(record))
}

/** The tracker's direct prompt that makes a library card the player's `[CHARACTER]`. */
export function playAsPcPrompt(record: LibraryRecord): string {
    return String(plain.buildApplyLibraryCardAsPcPrompt(record))
}

/** A card's identity as a Player Card's bio: the `[CORE]` tags off, the lines kept. */
export function bioOf(content: string): string {
    return identityOf(content).replace(/\[\/?CORE\]/gi, '').trim()
}
