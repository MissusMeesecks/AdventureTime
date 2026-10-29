/**
 * The memo as it stood at each turn.
 *
 * The tracker keeps one live memo per chat plus a single step of history
 * (`previous`, for the swipe roll-back). That is everything the *prompt* needs:
 * the model is told the current state, not last Tuesday's.
 *
 * A card under an old message is a different question — "what did the party
 * look like *then*" — and nothing could answer it, because the state at that
 * point in the story was overwritten by the next turn. So this keeps one
 * snapshot per tracked message: the memo as the pass left it after that reply.
 *
 * Separate from the memo record for the same reason the quest archive is: the
 * memo record is rewritten on every pass, and a writer that forgot to carry a
 * field forward would erase the history silently.
 */

import { chatFilePath } from './memo-store.js'

/** The slice of `spindle.userStorage` this module needs. */
export interface MemoHistoryStorage {
    getJson<T>(path: string, options?: { fallback?: T; userId?: string }): Promise<T>
    setJson(path: string, value: unknown, options?: { indent?: number; userId?: string }): Promise<void>
}

/** The memo as it stood after one message was tracked. */
export interface MemoSnapshot {
    /** The message this is the state *after*. */
    messageId: string
    memo: string
    /** When the pass wrote it, ISO 8601. */
    at: string
    /**
     * Which message in the chat, 1-based — the `#15` the host prints on it.
     *
     * Recorded so the history stepper can name the message a state belongs to.
     * The clock time cannot: a pass runs *after* the reply it reads and takes a
     * while to answer, so its stamp is routinely a minute past the message's.
     *
     * Optional, because snapshots recorded before this existed do not have one
     * and a card without a number is still a card.
     */
    messageNumber?: number
}

export interface MemoHistoryRecord {
    version: 1
    /** Newest first, so the cap drops the oldest. */
    snapshots: MemoSnapshot[]
    updatedAt: string
}

export const MEMO_HISTORY_VERSION = 1

/**
 * How many turns of history one chat keeps.
 *
 * A memo is a few kilobytes and this is read in full whenever the chat opens,
 * so it is a window rather than an archive: enough that scrolling back through
 * a session finds cards, not so much that a long campaign carries a megabyte of
 * superseded state. Messages older than the window simply get no card, which is
 * the honest answer — the state then is genuinely not recorded.
 */
export const MAX_MEMO_SNAPSHOTS = 50

export function memoHistoryPath(chatId: string): string {
    return chatFilePath(chatId, 'memo-history.json')
}

export function emptyMemoHistory(): MemoHistoryRecord {
    return { version: MEMO_HISTORY_VERSION, snapshots: [], updatedAt: new Date(0).toISOString() }
}

/** Read one entry back defensively — this is a file a user could have edited. */
function readSnapshot(value: unknown): MemoSnapshot | null {
    if (!value || typeof value !== 'object') return null
    const entry = value as Partial<MemoSnapshot>
    if (typeof entry.messageId !== 'string' || !entry.messageId) return null
    if (typeof entry.memo !== 'string') return null

    // A *number*, not anything a number can be made from: `Number(null)` is
    // zero, and zero is a real message here, so coercing would turn "no number
    // recorded" into "the first message in the chat".
    const number = entry.messageNumber
    const numbered = typeof number === 'number' && Number.isFinite(number) && number >= 0

    return {
        messageId: entry.messageId,
        memo: entry.memo,
        at: typeof entry.at === 'string' ? entry.at : '',
        // Zero is kept; only a negative or unreadable value is dropped. A
        // number here is worth keeping solely because it can be matched
        // against the chat exactly.
        ...(numbered ? { messageNumber: Math.floor(number) } : {}),
    }
}

/**
 * Fold one turn's snapshot into the ones already kept.
 *
 * Pure, so the two rules that matter are testable as rules:
 *
 *  - **One snapshot per message, the newest.** A swipe re-tracks a message that
 *    already has one; keeping both would leave the card showing a version of
 *    the story the user rejected.
 *  - **Newest first, capped**, so the window slides without a sort.
 */
export function foldMemoSnapshot(existing: MemoSnapshot[], snapshot: MemoSnapshot): MemoSnapshot[] {
    if (!snapshot.messageId) return existing

    const kept = existing.filter((entry) => entry.messageId !== snapshot.messageId)
    return [snapshot, ...kept].slice(0, MAX_MEMO_SNAPSHOTS)
}

/**
 * The per-chat store of past memos.
 *
 * Shaped after `MemoStore` and `QuestArchiveStore`: same path guard, same
 * shared in-flight load, same single write chain.
 */
export class MemoHistoryStore {
    readonly #storage: MemoHistoryStorage
    readonly #cache = new Map<string, MemoHistoryRecord>()
    readonly #loads = new Map<string, Promise<MemoHistoryRecord>>()
    #writes: Promise<unknown> = Promise.resolve()

    constructor(storage: MemoHistoryStorage) {
        this.#storage = storage
    }

    #key(chatId: string, userId?: string): string {
        return `${userId ?? '@self'}::${chatId}`
    }

    /**
     * Read a chat's history.
     *
     * A chat with none is every chat before its first tracked turn, so a
     * missing or unreadable file gives back an empty record. An unsafe chat id
     * still rejects — that is a caller error, and hiding it would mean reading
     * the wrong chat.
     */
    load(chatId: string, userId?: string): Promise<MemoHistoryRecord> {
        const key = this.#key(chatId, userId)

        const cached = this.#cache.get(key)
        if (cached) return Promise.resolve(cached)

        const inFlight = this.#loads.get(key)
        if (inFlight) return inFlight

        let path: string
        try {
            path = memoHistoryPath(chatId)
        } catch (error) {
            return Promise.reject(error)
        }

        const load = (async (): Promise<MemoHistoryRecord> => {
            let stored: MemoHistoryRecord | null = null
            try {
                stored = await this.#storage.getJson<MemoHistoryRecord | null>(path, { fallback: null, userId })
            } catch {
                stored = null
            }

            const snapshots = Array.isArray(stored?.snapshots)
                ? stored!.snapshots.map(readSnapshot).filter((s): s is MemoSnapshot => s !== null)
                : []

            const record: MemoHistoryRecord = {
                version: MEMO_HISTORY_VERSION,
                snapshots: snapshots.slice(0, MAX_MEMO_SNAPSHOTS),
                updatedAt: stored?.updatedAt ?? new Date(0).toISOString(),
            }

            this.#cache.set(key, record)
            this.#loads.delete(key)
            return record
        })()

        this.#loads.set(key, load)
        return load
    }

    /** Keep the memo as it stands after one message's pass. */
    async record(chatId: string, snapshot: MemoSnapshot, userId?: string): Promise<MemoHistoryRecord> {
        const current = await this.load(chatId, userId)
        const folded = foldMemoSnapshot(current.snapshots, snapshot)
        if (folded === current.snapshots) return current

        return this.#write(chatId, folded, userId)
    }

    /** Forget a chat's history entirely. */
    clear(chatId: string, userId?: string): Promise<MemoHistoryRecord> {
        return this.#write(chatId, [], userId)
    }

    #write(chatId: string, snapshots: MemoSnapshot[], userId?: string): Promise<MemoHistoryRecord> {
        let path: string
        try {
            path = memoHistoryPath(chatId)
        } catch (error) {
            return Promise.reject(error)
        }

        const record: MemoHistoryRecord = {
            version: MEMO_HISTORY_VERSION,
            snapshots,
            updatedAt: new Date().toISOString(),
        }

        this.#cache.set(this.#key(chatId, userId), record)
        const write = this.#writes
            .catch(() => undefined)
            .then(() => this.#storage.setJson(path, record, { indent: 2, userId }))
        this.#writes = write
        return write.then(() => record)
    }

    /** Drop a chat's cached history, so the next read comes from storage. */
    forget(chatId: string, userId?: string): void {
        this.#cache.delete(this.#key(chatId, userId))
    }
}
