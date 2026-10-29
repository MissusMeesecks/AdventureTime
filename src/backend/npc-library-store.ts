/**
 * Where the NPC library lives (Phase 41): one file per user, outside any chat.
 *
 * The legacy keeps the records on its settings object, as `npcLibrary`, which
 * is global there — not a cartridge key, not chat state. Here they are a file
 * of their own in the extension's per-user storage, beside the preferences,
 * because they are the install's and not a campaign's: a card saved in one
 * story is there to be used in the next.
 */

import { sanitizeRecords, type LibraryRecord } from '../tracker/npc-library.js'

export interface NpcLibraryStorage {
    getJson<T>(path: string, options?: { fallback?: T; userId?: string }): Promise<T>
    setJson(path: string, value: unknown, options?: { indent?: number; userId?: string }): Promise<void>
}

export const NPC_LIBRARY_PATH = 'npc-library.json'
export const NPC_LIBRARY_VERSION = 1

export interface NpcLibraryRecordFile {
    version: 1
    records: LibraryRecord[]
    updatedAt: string
}

const DEFAULT_USER = '__default__'

/** Read a stored file into records, dropping anything that is not one. A stored record is reduced to its identity, as the legacy does on load. */
export function readLibraryFile(stored: unknown): LibraryRecord[] {
    if (!stored || typeof stored !== 'object') return []
    const raw = (stored as { records?: unknown }).records
    if (!Array.isArray(raw)) return []
    const records: LibraryRecord[] = []
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue
        const r = item as Record<string, unknown>
        const id = String(r.id ?? '').trim()
        const name = String(r.name ?? '').trim()
        if (!id || !name) continue
        records.push({
            id,
            name,
            keys: Array.isArray(r.keys) ? r.keys.map((k) => String(k ?? '').trim()).filter(Boolean) : [name],
            content: String(r.content ?? ''),
            portraitPath: String(r.portraitPath ?? ''),
            notes: String(r.notes ?? ''),
            createdAt: Number.isFinite(r.createdAt) ? Number(r.createdAt) : 0,
            updatedAt: Number.isFinite(r.updatedAt) ? Number(r.updatedAt) : 0,
        })
    }
    return sanitizeRecords(records).records
}

export class NpcLibraryStore {
    readonly #storage: NpcLibraryStorage
    readonly #cache = new Map<string, LibraryRecord[]>()
    readonly #writes = new Map<string, Promise<unknown>>()

    constructor(storage: NpcLibraryStorage) {
        this.#storage = storage
    }

    #key(userId?: string): string {
        return userId ?? DEFAULT_USER
    }

    /** The user's records. A missing or unreadable file is an empty library, not an error. */
    async load(userId?: string): Promise<LibraryRecord[]> {
        const key = this.#key(userId)
        const cached = this.#cache.get(key)
        if (cached) return cached.map((r) => ({ ...r, keys: [...r.keys] }))
        let stored: unknown = null
        try {
            stored = await this.#storage.getJson<unknown>(NPC_LIBRARY_PATH, { fallback: null, userId })
        } catch {
            stored = null
        }
        const records = readLibraryFile(stored)
        this.#cache.set(key, records)
        return records.map((r) => ({ ...r, keys: [...r.keys] }))
    }

    /** Replace the user's records. Writes are queued per user so two saves cannot cross. */
    async save(records: LibraryRecord[], userId?: string): Promise<LibraryRecord[]> {
        const key = this.#key(userId)
        const clean = records.map((r) => ({ ...r, keys: [...r.keys] }))
        const chained = (this.#writes.get(key) ?? Promise.resolve())
            .catch(() => undefined)
            .then(async () => {
                const file: NpcLibraryRecordFile = { version: NPC_LIBRARY_VERSION, records: clean, updatedAt: new Date().toISOString() }
                this.#cache.set(key, clean)
                await this.#storage.setJson(NPC_LIBRARY_PATH, file, { indent: 2, userId })
                return clean
            })
        this.#writes.set(key, chained)
        return chained.then((saved) => saved.map((r) => ({ ...r, keys: [...r.keys] })))
    }
}
