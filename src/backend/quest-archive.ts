/**
 * Where finished quests go.
 *
 * `applyQuestSync` drops completed and failed quests out of the memo on every
 * turn — which is right, because a finished quest costs context on every
 * subsequent turn and tells the model nothing it can act on. Until now that was
 * the end of them: the list was computed, reported in the pass line, and thrown
 * away. A campaign's whole history of finished work was unrecoverable a turn
 * after it finished.
 *
 * So this is the other half: the memo holds what is live, and this holds what is
 * over. Per chat, like the memo, because two chats are two campaigns.
 *
 * Deliberately a separate file rather than a field on `MemoRecord`. The memo
 * record is written on every pass and carries the swipe roll-back (`previous`),
 * and a writer that forgot to carry a field forward would silently erase the
 * archive; the raw-memo editor already saves without carrying that metadata.
 * A separate store cannot be clobbered by a memo write at all.
 */

import { questIdentity, type Quest } from '../tracker/quests.js'
import { chatFilePath } from './memo-store.js'

/** The slice of `spindle.userStorage` this module needs. */
export interface QuestArchiveStorage {
    getJson<T>(path: string, options?: { fallback?: T; userId?: string }): Promise<T>
    setJson(path: string, value: unknown, options?: { indent?: number; userId?: string }): Promise<void>
}

/** One finished quest, kept with the circumstances of its finishing. */
export interface ArchivedQuest {
    quest: Quest
    /** When the pass dropped it from the memo, ISO 8601. */
    at: string
    /**
     * The message whose pass archived it.
     *
     * The roll-back key for a swipe: re-tracking a message replaces everything
     * that message's previous pass concluded, in the archive exactly as in the
     * memo. Absent for a pass the user started by hand, which replaces nothing.
     */
    messageId?: string
}

export interface QuestArchiveRecord {
    version: 1
    quests: ArchivedQuest[]
    /** When it was last written, ISO 8601. Diagnostic only. */
    updatedAt: string
}

export const QUEST_ARCHIVE_VERSION = 1

/**
 * How many finished quests one chat keeps.
 *
 * A cap rather than unbounded growth: this is read in full on every panel draw
 * and travels in every `tracker.changed` event. A hundred finished quests is
 * far more campaign than anyone has run, and the oldest are the ones nobody
 * scrolls to.
 */
export const MAX_ARCHIVED_QUESTS = 100

export function questArchivePath(chatId: string): string {
    return chatFilePath(chatId, 'quest-archive.json')
}

export function emptyQuestArchive(): QuestArchiveRecord {
    return { version: QUEST_ARCHIVE_VERSION, quests: [], updatedAt: new Date(0).toISOString() }
}

/** Read one entry back defensively — this is a file a user could have edited. */
function readEntry(value: unknown): ArchivedQuest | null {
    if (!value || typeof value !== 'object') return null
    const entry = value as Partial<ArchivedQuest>
    const quest = entry.quest as Quest | undefined
    if (!quest || typeof quest !== 'object' || typeof quest.title !== 'string' || !quest.title.trim()) return null

    const read: ArchivedQuest = {
        quest: { ...quest, objectives: Array.isArray(quest.objectives) ? quest.objectives : [], rewards: Array.isArray(quest.rewards) ? quest.rewards : [] },
        at: typeof entry.at === 'string' ? entry.at : new Date(0).toISOString(),
    }
    if (typeof entry.messageId === 'string') read.messageId = entry.messageId
    return read
}

export interface RecordArchivedOptions {
    /** The message this pass was for. Its earlier entries are replaced. */
    messageId?: string
    /** When they were archived. Injected so a test can pin it. */
    at?: string
}

/**
 * Fold a turn's finished quests into the ones already kept.
 *
 * Pure, so the ordering rules can be tested without a store:
 *
 *  - **A re-track replaces.** A swipe or a regenerate re-runs the pass for a
 *    message whose previous pass may already have archived something. The memo
 *    handles this by merging onto `previous`; the archive handles it by
 *    dropping that message's earlier entries. Without it a quest completed on a
 *    swipe you rejected would stay in the archive for good, while the memo went
 *    back to showing it active — the same quest in two places, disagreeing.
 *  - **The newest wins.** A quest archived twice keeps its later record.
 *  - **Newest first**, so the cap drops the oldest and the panel reads
 *    most-recent-first without sorting.
 */
export function foldArchivedQuests(
    existing: ArchivedQuest[],
    quests: Quest[],
    options: RecordArchivedOptions = {},
): ArchivedQuest[] {
    const at = options.at ?? new Date().toISOString()
    const messageId = options.messageId

    // Only a pass that names a message replaces anything. A manual run names
    // none, and must not sweep away every entry that also named none.
    const kept = messageId ? existing.filter((entry) => entry.messageId !== messageId) : [...existing]

    const added = quests
        .filter((quest) => quest && String(quest.title ?? '').trim())
        .map((quest): ArchivedQuest => ({ quest, at, ...(messageId ? { messageId } : {}) }))

    const seen = new Set<string>()
    const merged: ArchivedQuest[] = []
    for (const entry of [...added, ...kept]) {
        const key = questIdentity(entry.quest)
        if (seen.has(key)) continue
        seen.add(key)
        merged.push(entry)
    }

    return merged.slice(0, MAX_ARCHIVED_QUESTS)
}

/**
 * The per-chat store of finished quests.
 *
 * Shaped after `MemoStore` on purpose — same path guard, same shared in-flight
 * load, same single write chain — because the failure modes are the same ones.
 */
export class QuestArchiveStore {
    readonly #storage: QuestArchiveStorage
    readonly #cache = new Map<string, QuestArchiveRecord>()
    readonly #loads = new Map<string, Promise<QuestArchiveRecord>>()
    #writes: Promise<unknown> = Promise.resolve()

    constructor(storage: QuestArchiveStorage) {
        this.#storage = storage
    }

    #key(chatId: string, userId?: string): string {
        return `${userId ?? '@self'}::${chatId}`
    }

    /**
     * Read a chat's archive.
     *
     * A chat with no archive is every chat that has not finished a quest yet,
     * so a missing or unreadable file gives back an empty record rather than
     * throwing. An unsafe chat id still rejects: that is a caller error, and
     * answering it with an empty archive would hide it.
     */
    load(chatId: string, userId?: string): Promise<QuestArchiveRecord> {
        const key = this.#key(chatId, userId)

        const cached = this.#cache.get(key)
        if (cached) return Promise.resolve(cached)

        const inFlight = this.#loads.get(key)
        if (inFlight) return inFlight

        let path: string
        try {
            path = questArchivePath(chatId)
        } catch (error) {
            return Promise.reject(error)
        }

        const load = (async (): Promise<QuestArchiveRecord> => {
            let stored: QuestArchiveRecord | null = null
            try {
                stored = await this.#storage.getJson<QuestArchiveRecord | null>(path, { fallback: null, userId })
            } catch {
                stored = null
            }

            const quests = Array.isArray(stored?.quests)
                ? stored!.quests.map(readEntry).filter((entry): entry is ArchivedQuest => entry !== null)
                : []

            const record: QuestArchiveRecord = {
                version: QUEST_ARCHIVE_VERSION,
                quests: quests.slice(0, MAX_ARCHIVED_QUESTS),
                updatedAt: stored?.updatedAt ?? new Date(0).toISOString(),
            }

            this.#cache.set(key, record)
            this.#loads.delete(key)
            return record
        })()

        this.#loads.set(key, load)
        return load
    }

    /** Add a turn's finished quests. Returns the archive as it now stands. */
    async record(
        chatId: string,
        quests: Quest[],
        userId?: string,
        options: RecordArchivedOptions = {},
    ): Promise<QuestArchiveRecord> {
        const current = await this.load(chatId, userId)
        const folded = foldArchivedQuests(current.quests, quests, options)

        // A pass that archived nothing new and replaced nothing does not
        // deserve a write. Most turns are this one.
        if (folded.length === current.quests.length && folded.every((entry, i) => entry === current.quests[i])) {
            return current
        }

        return this.#write(chatId, folded, userId)
    }

    /** Empty a chat's archive. For the panel's clear button. */
    clear(chatId: string, userId?: string): Promise<QuestArchiveRecord> {
        return this.#write(chatId, [], userId)
    }

    #write(chatId: string, quests: ArchivedQuest[], userId?: string): Promise<QuestArchiveRecord> {
        let path: string
        try {
            path = questArchivePath(chatId)
        } catch (error) {
            return Promise.reject(error)
        }

        const record: QuestArchiveRecord = {
            version: QUEST_ARCHIVE_VERSION,
            quests,
            updatedAt: new Date().toISOString(),
        }

        this.#cache.set(this.#key(chatId, userId), record)
        const write = this.#writes
            .catch(() => undefined)
            .then(() => this.#storage.setJson(path, record, { indent: 2, userId }))
        this.#writes = write
        return write.then(() => record)
    }

    /** Drop a chat's cached archive, so the next read comes from storage. */
    forget(chatId: string, userId?: string): void {
        this.#cache.delete(this.#key(chatId, userId))
    }
}
