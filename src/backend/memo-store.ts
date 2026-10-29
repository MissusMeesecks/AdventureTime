/**
 * Where the tracker's memo lives.
 *
 * A memo is per chat, not per user: two chats are two campaigns, and the state
 * of one has no business appearing in the other. The legacy build kept it in
 * `settings.currentMemo` — one live memo plus a `chatStates` map it copied in
 * and out of on every chat switch, which is where a good share of its
 * chat-persistence complexity came from. Here each chat simply owns a file.
 *
 * The `snapshot` accessor exists for one caller: the prompt interceptor, which
 * is synchronous and runs inside the generation's latency budget (R4). It reads
 * whatever has already been loaded and never waits. Everything else awaits
 * `load`.
 */

/** The slice of `spindle.userStorage` this module needs. */
export interface MemoStorage {
    getJson<T>(path: string, options?: { fallback?: T; userId?: string }): Promise<T>
    setJson(path: string, value: unknown, options?: { indent?: number; userId?: string }): Promise<void>
}

/** What a chat's memo file holds. Versioned so a later shape can migrate. */
export interface MemoRecord {
    version: 2
    memo: string
    /** When it was last written, ISO 8601. Diagnostic only. */
    updatedAt: string
    /**
     * The memo as it stood before the last tracked turn.
     *
     * One step of history, and it exists for one reason: a swipe or a
     * regenerate replaces a message the tracker has already folded in. Merging
     * the new version on top of the current memo would count that turn twice —
     * time advancing an hour instead of half an hour, a payment deducted twice.
     * Re-tracking merges onto this instead.
     */
    previous?: string
    /** The message the memo was last computed from. Identifies a re-track. */
    lastMessageId?: string
    /**
     * What the last tracker pass did, kept so the panel can say so.
     *
     * A tracker that quietly does nothing is indistinguishable from a broken
     * one, which is exactly the position a user is in when state stops moving.
     * This is what turns "nothing happened" into a specific answer.
     */
    lastPass?: TrackerPassReport
}

/** The outcome of one tracker pass, in a form the panel can render. */
export interface TrackerPassReport {
    status: 'updated' | 'no-change' | 'skipped' | 'failed' | 'cancelled'
    /** When it finished, ISO 8601. */
    at: string
    /** Why, when the pass was skipped or failed, or returned nothing usable. */
    reason?: string
    replaced?: string[]
    added?: string[]
    removed?: string[]
    /** Members moved onto the benched roster this pass, and off it, by name. */
    benched?: string[]
    unbenched?: string[]
    /** Bench or unbench commands that named nobody on either roster. */
    unmatched?: string[]
    /** Set on a pass the user instructed from the send bar. Absent otherwise. */
    trigger?: 'direct'
    /** Quests dropped from the memo because they finished. Titles, for the panel. */
    archived?: string[]
    /** Relationship awards the pass placed (44), in words. */
    relations?: string[]
    /** Names in the pass's `[RELATIONS]` block that no entry matched. */
    relationsUnmatched?: string[]
    /**
     * The opening of the model's reply, when it could not be parsed.
     *
     * The single most useful thing to see when a pass runs but changes nothing:
     * it distinguishes a refusal, a wrong output format, and a model that
     * correctly found nothing to report.
     */
    sample?: string
}

/**
 * Bumped from 1 when `previous` and `lastMessageId` were added. A version 1
 * file simply has neither, which is the same state as a chat whose first turn
 * has not been tracked yet — so it loads without migration.
 */
export const MEMO_VERSION = 2

/**
 * Where one of a chat's files sits inside the extension's per-user storage.
 *
 * Chat ids come from the host, but they are interpolated into a path, so
 * anything that could climb out of the directory is rejected rather than
 * sanitized — a silently rewritten id would read and write the wrong chat.
 *
 * Shared with the quest archive, which is a second file in the same directory:
 * one guard, so a new per-chat file cannot be added without it.
 */
export function chatFilePath(chatId: string, name: string): string {
    if (!chatId || !/^[A-Za-z0-9_.-]+$/.test(chatId) || chatId === '.' || chatId === '..') {
        throw new Error(`Refusing to use an unsafe chat id: ${JSON.stringify(chatId)}`)
    }
    return `chats/${chatId}/${name}`
}

export function memoPath(chatId: string): string {
    return chatFilePath(chatId, 'memo.json')
}

export function emptyMemoRecord(): MemoRecord {
    return { version: MEMO_VERSION, memo: '', updatedAt: new Date(0).toISOString() }
}

/** Extra fields a writer may set alongside the memo text. */
export interface MemoMeta {
    previous?: string
    lastMessageId?: string
    lastPass?: TrackerPassReport
}

export class MemoStore {
    readonly #storage: MemoStorage
    readonly #cache = new Map<string, MemoRecord>()
    readonly #loads = new Map<string, Promise<MemoRecord>>()
    #writes: Promise<unknown> = Promise.resolve()

    constructor(storage: MemoStorage) {
        this.#storage = storage
    }

    #key(chatId: string, userId?: string): string {
        return `${userId ?? '@self'}::${chatId}`
    }

    /**
     * Read a chat's memo.
     *
     * A chat with no memo yet is not an error — it is every chat before its
     * first tracked turn — so a missing or unreadable file gives back an empty
     * record rather than throwing. Concurrent first reads share one promise, so
     * two callers cannot end up holding two different records for one chat.
     */
    load(chatId: string, userId?: string): Promise<MemoRecord> {
        const key = this.#key(chatId, userId)

        const cached = this.#cache.get(key)
        if (cached) return Promise.resolve(cached)

        const inFlight = this.#loads.get(key)
        if (inFlight) return inFlight

        // Resolved before the try below, deliberately: a rejected chat id is a
        // caller error and must surface, while a failed *read* is a first run
        // and must not. Inside the try, the guard would be swallowed and the
        // caller would be handed an empty memo for a path it should never have
        // asked for. Rejected rather than thrown, so this function fails one
        // way and `await` is enough to catch it.
        let path: string
        try {
            path = memoPath(chatId)
        } catch (error) {
            return Promise.reject(error)
        }

        const load = (async (): Promise<MemoRecord> => {
            let stored: MemoRecord | null = null
            try {
                stored = await this.#storage.getJson<MemoRecord | null>(path, { fallback: null, userId })
            } catch {
                stored = null
            }

            let record: MemoRecord = emptyMemoRecord()
            if (stored && typeof stored.memo === 'string') {
                record = {
                    version: MEMO_VERSION,
                    memo: stored.memo,
                    updatedAt: stored.updatedAt ?? new Date(0).toISOString(),
                }
                if (typeof stored.previous === 'string') record.previous = stored.previous
                if (typeof stored.lastMessageId === 'string') record.lastMessageId = stored.lastMessageId
                if (stored.lastPass && typeof stored.lastPass === 'object') record.lastPass = stored.lastPass
            }

            this.#cache.set(key, record)
            this.#loads.delete(key)
            return record
        })()

        this.#loads.set(key, load)
        return load
    }

    /**
     * The memo already in memory for a chat, or undefined.
     *
     * For the interceptor only. Anything that can await should call `load`.
     */
    snapshot(chatId: string, userId?: string): MemoRecord | undefined {
        return this.#cache.get(this.#key(chatId, userId))
    }

    /**
     * Replace a chat's memo.
     *
     * Writes are chained across every chat rather than per chat. A memo is
     * written once per turn at most, so there is no throughput to win by
     * parallelising, and one chain means a slow disk cannot interleave two
     * writes.
     */
    save(chatId: string, memo: string, userId?: string, meta: MemoMeta = {}): Promise<MemoRecord> {
        let path: string
        try {
            path = memoPath(chatId)
        } catch (error) {
            return Promise.reject(error)
        }

        const key = this.#key(chatId, userId)
        const record: MemoRecord = { version: MEMO_VERSION, memo, updatedAt: new Date().toISOString() }
        if (meta.previous !== undefined) record.previous = meta.previous
        if (meta.lastMessageId !== undefined) record.lastMessageId = meta.lastMessageId
        if (meta.lastPass !== undefined) record.lastPass = meta.lastPass

        this.#cache.set(key, record)
        const write = this.#writes
            .catch(() => undefined)
            .then(() => this.#storage.setJson(path, record, { indent: 2, userId }))
        this.#writes = write
        return write.then(() => record)
    }

    /**
     * Record what a pass did, without touching the memo.
     *
     * A pass that changed nothing still has something to report, and reporting
     * it must not rewrite the memo — that would move `previous` and break the
     * swipe roll-back.
     */
    async notePass(chatId: string, report: TrackerPassReport, userId?: string): Promise<MemoRecord> {
        const current = await this.load(chatId, userId)
        return this.save(chatId, current.memo, userId, {
            previous: current.previous,
            lastMessageId: current.lastMessageId,
            lastPass: report,
        })
    }

    /** Drop a chat's cached memo, so the next read comes from storage. */
    forget(chatId: string, userId?: string): void {
        this.#cache.delete(this.#key(chatId, userId))
    }
}
