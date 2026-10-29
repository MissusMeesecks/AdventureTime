/**
 * Which picture belongs to which entity, per chat.
 *
 * The legacy kept these in a `customPortraits` map that it copied in and out of
 * per-chat state on every switch (`snapshotPortraitMapsForChat` /
 * `loadPortraitMapsForChat`), which is the same shape every other bit of its
 * chat persistence took and the same complexity the memo store already dropped.
 * Here a chat simply owns a file.
 *
 * Per chat rather than global, following the legacy: two campaigns can have an
 * innkeeper called Alice, and they are not the same Alice.
 *
 * What is stored is a *reference*, not an image: a URL from the host's image
 * store, or any absolute URL. The bytes live where the host puts them, which is
 * the same division the legacy settled on after it had to migrate a generation
 * of embedded data URLs out of its settings file.
 */

import { normalizeEntityName } from '../tracker/portraits.js'
import { chatFilePath } from './memo-store.js'

/** The slice of `spindle.userStorage` this module needs. */
export interface PortraitStorage {
    getJson<T>(path: string, options?: { fallback?: T; userId?: string }): Promise<T>
    setJson(path: string, value: unknown, options?: { indent?: number; userId?: string }): Promise<void>
}

export interface PortraitRecord {
    version: 1
    /** Normalized entity name -> image reference. */
    portraits: Record<string, string>
    updatedAt: string
}

export const PORTRAIT_VERSION = 1

/**
 * How many portraits one chat keeps.
 *
 * Generous — a long campaign has a lot of named NPCs — but not unbounded: the
 * whole map is read on every panel draw and travels to the frontend with it.
 */
export const MAX_PORTRAITS = 200

export function portraitPath(chatId: string): string {
    return chatFilePath(chatId, 'portraits.json')
}

export function emptyPortraitRecord(): PortraitRecord {
    return { version: PORTRAIT_VERSION, portraits: {}, updatedAt: new Date(0).toISOString() }
}

/**
 * Read a stored map back defensively.
 *
 * Keys are re-normalized on the way in rather than trusted, so a file written by
 * an older build — or edited by hand — cannot hold a key the lookup could never
 * match. A value that is not a string is dropped rather than becoming `"[object
 * Object]"` in an `<img src>`.
 */
export function readPortraits(stored: unknown): Record<string, string> {
    const map: Record<string, string> = {}
    if (!stored || typeof stored !== 'object') return map

    const source = (stored as Partial<PortraitRecord>).portraits
    if (!source || typeof source !== 'object') return map

    for (const [name, src] of Object.entries(source)) {
        if (typeof src !== 'string' || !src.trim()) continue
        const key = normalizeEntityName(name)
        if (!key) continue
        map[key] = src.trim()
    }
    return map
}

/**
 * Told after every write lands, whoever wrote: the panel's editor, the
 * library seating a card, the NPC creator, the scene's picture, the imported
 * card's avatar. The cards on screen keep their own copy of the map, and a
 * write they are not told of is a portrait that shows after a reload and not
 * before (43-bis, lesson 47).
 */
export type PortraitChangeListener = (chatId: string, record: PortraitRecord, userId?: string) => void

export class PortraitStore {
    readonly #storage: PortraitStorage
    readonly #cache = new Map<string, PortraitRecord>()
    readonly #loads = new Map<string, Promise<PortraitRecord>>()
    readonly #onChange: PortraitChangeListener | undefined
    #writes: Promise<unknown> = Promise.resolve()

    constructor(storage: PortraitStorage, options: { onChange?: PortraitChangeListener } = {}) {
        this.#storage = storage
        this.#onChange = options.onChange
    }

    #key(chatId: string, userId?: string): string {
        return `${userId ?? '@self'}::${chatId}`
    }

    /** Read a chat's portraits. A chat with none is not an error. */
    load(chatId: string, userId?: string): Promise<PortraitRecord> {
        const key = this.#key(chatId, userId)

        const cached = this.#cache.get(key)
        if (cached) return Promise.resolve(cached)

        const inFlight = this.#loads.get(key)
        if (inFlight) return inFlight

        let path: string
        try {
            path = portraitPath(chatId)
        } catch (error) {
            return Promise.reject(error)
        }

        const load = (async (): Promise<PortraitRecord> => {
            let stored: PortraitRecord | null = null
            try {
                stored = await this.#storage.getJson<PortraitRecord | null>(path, { fallback: null, userId })
            } catch {
                stored = null
            }

            const record: PortraitRecord = {
                version: PORTRAIT_VERSION,
                portraits: readPortraits(stored),
                updatedAt: stored?.updatedAt ?? new Date(0).toISOString(),
            }

            this.#cache.set(key, record)
            this.#loads.delete(key)
            return record
        })()

        this.#loads.set(key, load)
        return load
    }

    /**
     * Set one entity's portrait, or remove it when `src` is empty.
     *
     * The name is normalized here rather than at the call site, so the panel can
     * pass the entity exactly as the memo spells it — parenthetical and all —
     * and the key still matches what the lookup will ask for.
     */
    async set(chatId: string, name: string, src: string, userId?: string): Promise<PortraitRecord> {
        const key = normalizeEntityName(name)
        if (!key) throw new Error('A portrait needs an entity name.')

        const current = await this.load(chatId, userId)
        const portraits = { ...current.portraits }

        const value = String(src ?? '').trim()
        if (!value) delete portraits[key]
        else portraits[key] = value

        // Oldest-first is the insertion order of the object, so trimming from the
        // front drops the portraits set longest ago.
        const names = Object.keys(portraits)
        if (names.length > MAX_PORTRAITS) {
            for (const stale of names.slice(0, names.length - MAX_PORTRAITS)) delete portraits[stale]
        }

        return this.#write(chatId, portraits, userId)
    }

    /** Forget every portrait in a chat. */
    clear(chatId: string, userId?: string): Promise<PortraitRecord> {
        return this.#write(chatId, {}, userId)
    }

    /** Put a whole set of portraits in a chat's place — a fork's copy (56). */
    replace(chatId: string, portraits: Record<string, string>, userId?: string): Promise<PortraitRecord> {
        return this.#write(chatId, { ...portraits }, userId)
    }

    #write(chatId: string, portraits: Record<string, string>, userId?: string): Promise<PortraitRecord> {
        let path: string
        try {
            path = portraitPath(chatId)
        } catch (error) {
            return Promise.reject(error)
        }

        const record: PortraitRecord = {
            version: PORTRAIT_VERSION,
            portraits,
            updatedAt: new Date().toISOString(),
        }

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

    /** Drop a chat's cached portraits, so the next read comes from storage. */
    forget(chatId: string, userId?: string): void {
        this.#cache.delete(this.#key(chatId, userId))
    }
}
