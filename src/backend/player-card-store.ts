/**
 * Where a chat's Player Card lives (roadmap row 10, Phase 35b).
 *
 * The legacy kept it in `settings.chatStates[chatId].playerCharacter`: a name,
 * a bio, the word count it was asked for and when. Here each chat owns a file
 * beside its memo, as the world and the quest archive do. `snapshot` exists
 * for the interceptor, which is synchronous and never waits.
 */

import { chatFilePath, type MemoStorage } from './memo-store.js'

export const PLAYER_CARD_VERSION = 1

export interface PlayerCard {
    name: string
    bio: string
    /** The word count the writer was asked for; the legacy keeps it to ask again. */
    wordCount: number
    /** When it was written or last edited, ISO 8601. */
    at: string
}

/** The host persona AdventureTime created or chose for the character, so the panel can say so. */
export interface PlayerPersona {
    id: string
    name: string
    at: string
}

export interface PlayerCardRecord {
    version: 1
    card: PlayerCard | null
    persona: PlayerPersona | null
    updatedAt: string
}

export function playerCardPath(chatId: string): string {
    return chatFilePath(chatId, 'player-card.json')
}

export function emptyPlayerCardRecord(): PlayerCardRecord {
    return { version: PLAYER_CARD_VERSION, card: null, persona: null, updatedAt: new Date(0).toISOString() }
}

function readRecord(stored: unknown): PlayerCardRecord {
    const record = emptyPlayerCardRecord()
    if (!stored || typeof stored !== 'object') return record
    const source = stored as Partial<PlayerCardRecord>
    if (typeof source.updatedAt === 'string') record.updatedAt = source.updatedAt
    const card = source.card
    if (card && typeof card === 'object' && typeof card.name === 'string' && typeof card.bio === 'string') {
        record.card = { name: card.name, bio: card.bio, wordCount: Number.isFinite(card.wordCount) ? Number(card.wordCount) : 150, at: typeof card.at === 'string' ? card.at : record.updatedAt }
    }
    const persona = source.persona
    if (persona && typeof persona === 'object' && typeof persona.id === 'string' && typeof persona.name === 'string') {
        record.persona = { id: persona.id, name: persona.name, at: typeof persona.at === 'string' ? persona.at : record.updatedAt }
    }
    return record
}

export class PlayerCardStore {
    readonly #storage: MemoStorage
    readonly #cache = new Map<string, PlayerCardRecord>()
    readonly #loads = new Map<string, Promise<PlayerCardRecord>>()
    #writes: Promise<unknown> = Promise.resolve()

    constructor(storage: MemoStorage) {
        this.#storage = storage
    }

    #key(chatId: string, userId?: string): string {
        return `${userId ?? '@self'}::${chatId}`
    }

    /** A chat with no card is every chat before its character: the empty record, never an error. */
    load(chatId: string, userId?: string): Promise<PlayerCardRecord> {
        const key = this.#key(chatId, userId)
        const cached = this.#cache.get(key)
        if (cached) return Promise.resolve(cached)
        const inFlight = this.#loads.get(key)
        if (inFlight) return inFlight

        let path: string
        try {
            path = playerCardPath(chatId)
        } catch (error) {
            return Promise.reject(error)
        }
        const load = (async (): Promise<PlayerCardRecord> => {
            let stored: unknown = null
            try {
                stored = await this.#storage.getJson<unknown>(path, { fallback: null, userId })
            } catch {
                stored = null
            }
            const record = readRecord(stored)
            this.#cache.set(key, record)
            this.#loads.delete(key)
            return record
        })()
        this.#loads.set(key, load)
        return load
    }

    /** What is in memory for a chat, or nothing. For the interceptor only. */
    snapshot(chatId: string, userId?: string): PlayerCardRecord | undefined {
        return this.#cache.get(this.#key(chatId, userId))
    }

    /** Replace the card, the persona, or both, and keep the rest. Writes are chained, as the memo's are. */
    async save(chatId: string, patch: Partial<Pick<PlayerCardRecord, 'card' | 'persona'>>, userId?: string): Promise<PlayerCardRecord> {
        const path = playerCardPath(chatId)
        const current = await this.load(chatId, userId)
        const record: PlayerCardRecord = { ...current, ...patch, version: PLAYER_CARD_VERSION, updatedAt: new Date().toISOString() }
        this.#cache.set(this.#key(chatId, userId), record)
        const write = this.#writes
            .catch(() => undefined)
            .then(() => this.#storage.setJson(path, record, { indent: 2, userId }))
        this.#writes = write
        await write
        return record
    }
}
