/**
 * Where each NPC's friendship and affection live (Phase 44).
 *
 * One file per chat, beside the memo and the portraits, keyed by the NPC
 * entry's address (`Book::uid`) as the legacy's `npcRelationshipValues` is,
 * with the label the award resolved to. Every change is logged, newest
 * first and fifty deep per NPC (the legacy's cap), with the message it came
 * from, so a swipe of that message can put its awards back: the legacy's
 * per-swipe rollback data, kept here on the record rather than on the
 * message. A listener is told after every write, whoever wrote (lesson 47).
 */

import { clampRelationshipValue, type RelationshipField } from '../tracker/relationships.js'
import { chatFilePath } from './memo-store.js'

export interface RelationshipStorage {
    getJson<T>(path: string, options?: { fallback?: T; userId?: string }): Promise<T>
    setJson(path: string, value: unknown, options?: { indent?: number; userId?: string }): Promise<void>
}

export type RelationshipSource = 'tracker' | 'narrative' | 'agent' | 'manual'

export interface RelationshipLogEntry {
    at: string
    field: RelationshipField
    /** What was asked. */
    delta: number
    /** What the clamp let through. */
    applied: number
    newValue: number
    source: RelationshipSource
    /** The reply the award came from, when one did; a swipe of it reverts the entry. */
    messageId?: string
}

export interface RelationshipNpc {
    label: string
    friendship: number
    affection: number
    log: RelationshipLogEntry[]
}

export interface RelationshipRecord {
    version: 1
    npcs: Record<string, RelationshipNpc>
    updatedAt: string
}

export const RELATIONSHIP_VERSION = 1
export const RELATIONSHIP_LOG_CAP = 50

export function relationshipPath(chatId: string): string {
    return chatFilePath(chatId, 'relationships.json')
}

export function emptyRelationshipRecord(): RelationshipRecord {
    return { version: RELATIONSHIP_VERSION, npcs: {}, updatedAt: new Date(0).toISOString() }
}

function readNumber(value: unknown): number {
    const n = Number(value)
    return Number.isFinite(n) ? Math.round(n) : 0
}

/** Read a stored record defensively: a file from a future version or a hand edit must not take the chat down. */
export function readRelationshipRecord(stored: unknown): RelationshipRecord {
    const record = emptyRelationshipRecord()
    if (!stored || typeof stored !== 'object') return record
    const raw = stored as { npcs?: unknown; updatedAt?: unknown }
    if (typeof raw.updatedAt === 'string') record.updatedAt = raw.updatedAt
    if (raw.npcs && typeof raw.npcs === 'object') {
        for (const [id, value] of Object.entries(raw.npcs as Record<string, unknown>)) {
            if (!id || !value || typeof value !== 'object') continue
            const npc = value as { label?: unknown; friendship?: unknown; affection?: unknown; log?: unknown }
            const log: RelationshipLogEntry[] = Array.isArray(npc.log)
                ? (npc.log as unknown[]).filter((entry): entry is RelationshipLogEntry => !!entry && typeof entry === 'object' && ((entry as RelationshipLogEntry).field === 'friendship' || (entry as RelationshipLogEntry).field === 'affection')).slice(0, RELATIONSHIP_LOG_CAP)
                : []
            record.npcs[id] = { label: typeof npc.label === 'string' && npc.label.trim() ? npc.label.trim() : id, friendship: readNumber(npc.friendship), affection: readNumber(npc.affection), log }
        }
    }
    return record
}

/** One change to make: the NPC's address and label, the axis, the signed delta, and where it came from. */
export interface RelationshipChange {
    id: string
    label: string
    field: RelationshipField
    delta: number
    source: RelationshipSource
    messageId?: string
}

export interface RelationshipApplied extends RelationshipChange {
    applied: number
    newValue: number
}

export type RelationshipChangeListener = (chatId: string, record: RelationshipRecord, userId?: string) => void

export class RelationshipStore {
    readonly #storage: RelationshipStorage
    readonly #cache = new Map<string, RelationshipRecord>()
    readonly #loads = new Map<string, Promise<RelationshipRecord>>()
    readonly #onChange: RelationshipChangeListener | undefined
    #writes: Promise<unknown> = Promise.resolve()

    constructor(storage: RelationshipStorage, options: { onChange?: RelationshipChangeListener } = {}) {
        this.#storage = storage
        this.#onChange = options.onChange
    }

    #key(chatId: string, userId?: string): string {
        return `${userId ?? '@self'}::${chatId}`
    }

    load(chatId: string, userId?: string): Promise<RelationshipRecord> {
        const key = this.#key(chatId, userId)
        const cached = this.#cache.get(key)
        if (cached) return Promise.resolve(cached)
        const pending = this.#loads.get(key)
        if (pending) return pending
        let path: string
        try {
            path = relationshipPath(chatId)
        } catch (error) {
            return Promise.reject(error)
        }
        const load = this.#storage
            .getJson<unknown>(path, { fallback: null, userId })
            .then((stored) => readRelationshipRecord(stored))
            .then((record) => {
                this.#cache.set(key, record)
                return record
            })
            .finally(() => { this.#loads.delete(key) })
        this.#loads.set(key, load)
        return load
    }

    /** The record as last loaded, synchronously, for the narrator's injection. */
    snapshot(chatId: string, userId?: string): RelationshipRecord | undefined {
        return this.#cache.get(this.#key(chatId, userId))
    }

    /**
     * Apply changes, clamped to the scale, each logged. With `retrackMessageId`,
     * first put back every logged change that came from that message — the
     * swipe's rollback — unless the value was edited by hand since (the
     * legacy's guard: a slider the user moved is not the pass's to move back).
     */
    async apply(chatId: string, changes: readonly RelationshipChange[], max: number, options: { retrackMessageId?: string } = {}, userId?: string): Promise<{ applied: RelationshipApplied[]; reverted: number }> {
        const current = await this.load(chatId, userId)
        const npcs: Record<string, RelationshipNpc> = {}
        for (const [id, npc] of Object.entries(current.npcs)) npcs[id] = { ...npc, log: [...npc.log] }
        let reverted = 0
        if (options.retrackMessageId) {
            for (const npc of Object.values(npcs)) {
                for (const entry of npc.log.filter((e) => e.messageId === options.retrackMessageId)) {
                    if (npc[entry.field] === entry.newValue) {
                        npc[entry.field] = clampRelationshipValue(npc[entry.field] - entry.applied, max)
                        reverted += 1
                    }
                    npc.log = npc.log.filter((e) => e !== entry)
                }
            }
        }
        const applied: RelationshipApplied[] = []
        const at = new Date().toISOString()
        for (const change of changes) {
            const npc = npcs[change.id] ?? (npcs[change.id] = { label: change.label, friendship: 0, affection: 0, log: [] })
            if (change.label.trim()) npc.label = change.label.trim()
            const before = npc[change.field]
            const newValue = clampRelationshipValue(before + change.delta, max)
            npc[change.field] = newValue
            const entry: RelationshipLogEntry = { at, field: change.field, delta: change.delta, applied: newValue - before, newValue, source: change.source, ...(change.messageId ? { messageId: change.messageId } : {}) }
            npc.log = [entry, ...npc.log].slice(0, RELATIONSHIP_LOG_CAP)
            applied.push({ ...change, applied: entry.applied, newValue })
        }
        if (!applied.length && !reverted) return { applied, reverted }
        await this.#write(chatId, npcs, userId)
        return { applied, reverted }
    }

    /** Set a value by hand, logged as manual. */
    async set(chatId: string, id: string, label: string, field: RelationshipField, value: number, max: number, userId?: string): Promise<RelationshipRecord> {
        const current = await this.load(chatId, userId)
        const npcs: Record<string, RelationshipNpc> = {}
        for (const [key, npc] of Object.entries(current.npcs)) npcs[key] = { ...npc, log: [...npc.log] }
        const npc = npcs[id] ?? (npcs[id] = { label, friendship: 0, affection: 0, log: [] })
        if (label.trim()) npc.label = label.trim()
        const before = npc[field]
        const newValue = clampRelationshipValue(value, max)
        npc[field] = newValue
        const entry: RelationshipLogEntry = { at: new Date().toISOString(), field, delta: newValue - before, applied: newValue - before, newValue, source: 'manual' }
        npc.log = [entry, ...npc.log].slice(0, RELATIONSHIP_LOG_CAP)
        return this.#write(chatId, npcs, userId)
    }

    /** Forget one NPC's standing. */
    async remove(chatId: string, id: string, userId?: string): Promise<RelationshipRecord> {
        const current = await this.load(chatId, userId)
        if (!current.npcs[id]) return current
        const { [id]: _gone, ...rest } = current.npcs
        return this.#write(chatId, rest, userId)
    }

    /** Clear one NPC's history and keep the values (80, Multihog's Clear Log). */
    async clearLog(chatId: string, id: string, userId?: string): Promise<RelationshipRecord> {
        const current = await this.load(chatId, userId)
        const npc = current.npcs[id]
        if (!npc || !npc.log.length) return current
        const npcs: Record<string, RelationshipNpc> = {}
        for (const [key, other] of Object.entries(current.npcs)) npcs[key] = { ...other, log: [...other.log] }
        npcs[id] = { ...npc, log: [] }
        return this.#write(chatId, npcs, userId)
    }

    /** Put a whole set of standings in a chat's place — a fork's copy (56). */
    replace(chatId: string, npcs: Record<string, RelationshipNpc>, userId?: string): Promise<RelationshipRecord> {
        return this.#write(chatId, npcs, userId)
    }

    clear(chatId: string, userId?: string): Promise<RelationshipRecord> {
        return this.#write(chatId, {}, userId)
    }

    #write(chatId: string, npcs: Record<string, RelationshipNpc>, userId?: string): Promise<RelationshipRecord> {
        let path: string
        try {
            path = relationshipPath(chatId)
        } catch (error) {
            return Promise.reject(error)
        }
        const record: RelationshipRecord = { version: RELATIONSHIP_VERSION, npcs, updatedAt: new Date().toISOString() }
        this.#cache.set(this.#key(chatId, userId), record)
        const write = this.#writes
            .catch(() => undefined)
            .then(() => this.#storage.setJson(path, record, { indent: 2, userId }))
        this.#writes = write
        return write.then(() => {
            this.#onChange?.(chatId, record, userId)
            return record
        })
    }

    forget(chatId: string, userId?: string): void {
        this.#cache.delete(this.#key(chatId, userId))
    }
}
