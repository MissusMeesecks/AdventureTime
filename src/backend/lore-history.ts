/**
 * The lorebooks as they stood before each agent pass.
 *
 * One snapshot per pass, per chat, so a pass can be undone (`agent/undo.ts`).
 * Kept beside the memo history and for the same reason: a record that is
 * rewritten on every pass is a record a forgetful writer can erase.
 *
 * **Shallow on purpose.** Only the last few passes are kept. A snapshot holds
 * the full text of every book the campaign owns, so a campaign with a few
 * hundred entries makes a snapshot of real size, and this file is read whenever
 * an undo is offered. Undo is for "that pass was wrong, take it back", which is
 * a thing people want within a turn or two — not an archive of the campaign's
 * whole history. Anything older is better served by the lorebooks themselves.
 */

import { chatFilePath } from './memo-store.js'
import type { LorePassSnapshot } from '../agent/undo.js'

/** The slice of `spindle.userStorage` this module needs. */
export interface LoreHistoryStorage {
    getJson<T>(path: string, options?: { fallback?: T; userId?: string }): Promise<T>
    setJson(path: string, value: unknown, options?: { indent?: number; userId?: string }): Promise<void>
}

export interface LoreHistoryRecord {
    version: 1
    /** Newest first, so the cap drops the oldest. */
    passes: LorePassSnapshot[]
    updatedAt: string
}

export const LORE_HISTORY_VERSION = 1

/**
 * How many passes one chat can undo.
 *
 * Three rather than one because a pass that looked fine can turn out wrong once
 * the next reply lands, and rather than fifty because each of these is a whole
 * copy of the campaign's lore.
 */
export const MAX_LORE_HISTORY = 3

export function loreHistoryPath(chatId: string): string {
    return chatFilePath(chatId, 'lore-history.json')
}

export function emptyLoreHistory(): LoreHistoryRecord {
    return { version: LORE_HISTORY_VERSION, passes: [], updatedAt: new Date(0).toISOString() }
}

/**
 * Read a chat's snapshots, tolerating anything the file might hold.
 *
 * A hand-edited or truncated file must not stop a pass running. The worst case
 * of reading it defensively is that an undo is unavailable; the worst case of
 * trusting it is a pass that throws before it starts.
 */
export async function readLoreHistory(
    storage: LoreHistoryStorage,
    chatId: string,
    userId: string | undefined,
): Promise<LoreHistoryRecord> {
    const raw = await storage.getJson<unknown>(loreHistoryPath(chatId), {
        fallback: emptyLoreHistory(),
        userId,
    })
    const record = raw && typeof raw === 'object' ? (raw as Partial<LoreHistoryRecord>) : {}
    const passes = Array.isArray(record.passes) ? record.passes.filter(isSnapshot) : []
    return {
        version: LORE_HISTORY_VERSION,
        passes: passes.slice(0, MAX_LORE_HISTORY),
        updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date(0).toISOString(),
    }
}

function isSnapshot(value: unknown): value is LorePassSnapshot {
    if (!value || typeof value !== 'object') return false
    const candidate = value as Partial<LorePassSnapshot>
    return typeof candidate.chatId === 'string'
        && Array.isArray(candidate.books)
        && Array.isArray(candidate.ownedBooks)
        && Array.isArray(candidate.createdBooks)
}

/** Push a snapshot onto a chat's history, newest first, capped. */
export async function recordLorePass(
    storage: LoreHistoryStorage,
    chatId: string,
    snapshot: LorePassSnapshot,
    userId: string | undefined,
): Promise<void> {
    const history = await readLoreHistory(storage, chatId, userId)
    const record: LoreHistoryRecord = {
        version: LORE_HISTORY_VERSION,
        passes: [snapshot, ...history.passes].slice(0, MAX_LORE_HISTORY),
        updatedAt: new Date().toISOString(),
    }
    await storage.setJson(loreHistoryPath(chatId), record, { indent: 2, userId })
}

/** The newest snapshot for a chat, or `null` when there is nothing to undo. */
export async function latestLorePass(
    storage: LoreHistoryStorage,
    chatId: string,
    userId: string | undefined,
): Promise<LorePassSnapshot | null> {
    const history = await readLoreHistory(storage, chatId, userId)
    return history.passes[0] ?? null
}

/** Drop the newest snapshot, once it has been undone. */
export async function dropLatestLorePass(
    storage: LoreHistoryStorage,
    chatId: string,
    userId: string | undefined,
): Promise<void> {
    const history = await readLoreHistory(storage, chatId, userId)
    const record: LoreHistoryRecord = {
        version: LORE_HISTORY_VERSION,
        passes: history.passes.slice(1),
        updatedAt: new Date().toISOString(),
    }
    await storage.setJson(loreHistoryPath(chatId), record, { indent: 2, userId })
}
