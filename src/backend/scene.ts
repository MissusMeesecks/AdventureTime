/**
 * The scene view's service (Phase 42): the legacy's `buildImmersionSceneState`.
 *
 * Where the party is comes from the last `(Location: …)` footer in the chat,
 * else the memo, resolved against the campaign's place books' entry titles;
 * who is present comes from a name scan of the newest narrator replies — as
 * many as the scene's window preference says (52; the legacy reads one) —
 * over the campaign's NPC books, the Player Character first and then by how
 * recently each was named. A place's picture is kept
 * in the chat's portraits under a pin (`📍 Monastery :: Courtyard`), set from
 * the fold or drawn by the host's image generation (49, `scene-art.ts`),
 * which is the legacy's Real-Time Mode.
 */

import { bookStanding, resolveCampaignPrefix } from '../agent/campaign.js'
import { extractCharacterName } from '../tracker/creator.js'
import { stripMapSection } from '../tracker/map.js'
import { lookupPortrait } from '../tracker/portraits.js'
import {
    currentLocationText,
    isNpcBookName,
    locationImageKey,
    normalizeLocationPath,
    presentNpcsOver,
    recentNarrations,
    resolveSceneLocation,
    sceneCharacterKey,
    type SceneMessage,
} from '../tracker/scene.js'
import type { SceneResult } from '../protocol.js'
import { isLocationBookName } from './map-sync.js'

export interface SceneDeps {
    messages: (chatId: string, userId: string | undefined) => Promise<SceneMessage[]>
    memos: { load(chatId: string, userId: string | undefined): Promise<{ memo: string }> }
    prefs: { load(userId: string | undefined): Promise<{ campaignNames?: Record<string, string>; campaignBooks?: Record<string, string[]>; sceneLookback?: number }> }
    books: (userId: string | undefined) => {
        listBooks(): Promise<Array<{ id: string; name: string }>>
        listEntries(bookId: string): Promise<Array<{ id: string; uid: string; content: string; comment: string }>>
    }
    portraits: {
        load(chatId: string, userId: string | undefined): Promise<{ portraits: Record<string, string> }>
        set(chatId: string, name: string, src: string, userId: string | undefined): Promise<unknown>
    }
    /** The chat's Player Card: always present in the scene when there is one. */
    playerCard?: { view(chatId: string, userId: string | undefined): Promise<{ card: { name: string; bio: string } | null }> }
    /** The Maps fold's state, for the site the party is inside. */
    mapState?: { load(chatId: string, userId: string | undefined): Promise<{ activeSiteRoot: string }> }
    log: { info(m: string): void; warn(m: string): void }
    now?: () => Date
}

export interface ScenePlace {
    path: string
    content: string
}

export interface Scene {
    get(chatId: string, userId: string | undefined): Promise<SceneResult>
    /** The campaign's place entries, for the picture's parent chain (49). */
    places(chatId: string, userId: string | undefined): Promise<ScenePlace[]>
    /** Keep a picture for a place, or forget it with `''`. */
    setImage(chatId: string, userId: string | undefined, storagePath: string, src: string): Promise<SceneResult>
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

/** The window when the preference is missing: the store's default, repeated here so the service needs no store. */
const DEFAULT_SCENE_WINDOW = 3

export function createScene(deps: SceneDeps): Scene {
    const now = deps.now ?? (() => new Date())

    /** The campaign's place and NPC books, read once. */
    async function readBooks(chatId: string, userId: string | undefined, prefs: { campaignNames?: Record<string, string>; campaignBooks?: Record<string, string[]> }) {
        const prefix = resolveCampaignPrefix({ chatId, override: prefs.campaignNames?.[chatId], anchorChatId: chatId })
        const owned = prefs.campaignBooks?.[chatId] ?? []
        const books = deps.books(userId)
        const read: string[] = []
        let problem: string | undefined
        const places: Array<{ id: string; book: string; uid: string; path: string; content: string }> = []
        const npcEntries: Array<{ id: string; comment: string; content: string }> = []
        try {
            for (const book of await books.listBooks()) {
                if (bookStanding(book.name, prefix, owned) !== 'owned') continue
                const place = isLocationBookName(book.name, prefix)
                const npc = isNpcBookName(book.name)
                if (!place && !npc) continue
                read.push(book.name)
                const entries = await books.listEntries(book.id)
                for (const entry of entries) {
                    const id = `${book.name}::${entry.uid}`
                    if (place) {
                        const path = normalizeLocationPath(entry.comment.trim())
                        if (path) places.push({ id, book: book.name, uid: entry.uid, path, content: entry.content })
                    }
                    if (npc) npcEntries.push({ id, comment: entry.comment, content: entry.content })
                }
            }
        } catch (error) {
            problem = describe(error)
            deps.log.warn(`scene: the campaign's books could not be read: ${problem}`)
        }
        return { read, problem, places, npcEntries }
    }

    async function get(chatId: string, userId: string | undefined): Promise<SceneResult> {
        const at = now().toISOString()
        const prefs = await deps.prefs.load(userId)
        const messages = await deps.messages(chatId, userId).catch(() => [] as SceneMessage[])
        const memo = (await deps.memos.load(chatId, userId).catch(() => ({ memo: '' }))).memo
        const raw = currentLocationText(messages, memo)
        const { read, problem, places, npcEntries } = await readBooks(chatId, userId, prefs)

        const location = resolveSceneLocation(raw, places.map((p) => p.path))
        const entry = location.path ? places.find((p) => p.path === location.path) : undefined
        const portraits = (await deps.portraits.load(chatId, userId).catch(() => ({ portraits: {} }))).portraits
        const image = location.storagePath ? lookupPortrait(portraits, locationImageKey(location.storagePath)) : ''

        const present: SceneResult['present'] = []
        const card = deps.playerCard ? (await deps.playerCard.view(chatId, userId).catch(() => ({ card: null }))).card : null
        if (card?.name.trim()) {
            const name = card.name.trim()
            // The legacy tries the card's name, then the sheet's.
            const sheetName = extractCharacterName(memo)
            const portrait = lookupPortrait(portraits, name) || (sheetName ? lookupPortrait(portraits, sheetName) : '')
            present.push({ id: 'player-character', label: name, portrait, isPlayerCharacter: true, content: card.bio })
        }
        const pcKey = card ? sceneCharacterKey(card.name) : ''
        // The window (52): the newest replies, as many as the preference says.
        const narrations = recentNarrations(messages, prefs.sceneLookback ?? DEFAULT_SCENE_WINDOW)
        for (const npc of presentNpcsOver(narrations, npcEntries)) {
            if (pcKey && sceneCharacterKey(npc.label) === pcKey) continue
            present.push({ id: npc.id, label: npc.label, portrait: lookupPortrait(portraits, npc.label), isPlayerCharacter: false, content: npc.content, ago: npc.ago })
        }

        const mapSite = deps.mapState ? (await deps.mapState.load(chatId, userId).catch(() => ({ activeSiteRoot: '' }))).activeSiteRoot : ''
        deps.log.info(`scene: party at "${location.raw || '(nowhere named)'}"${location.path ? ` = ${location.path}` : ''}; present over ${narrations.length} ${narrations.length === 1 ? 'reply' : 'replies'}: ${present.map((p) => p.label).join(', ') || 'nobody'}`)
        return {
            at,
            location: { ...location, image, entryId: entry?.id ?? '', content: entry ? stripMapSection(entry.content) : '' },
            present,
            window: narrations.length,
            mapSite,
            books: read,
            ...(problem ? { problem } : {}),
        }
    }

    return {
        get,
        async places(chatId, userId) {
            const { places } = await readBooks(chatId, userId, await deps.prefs.load(userId))
            return places.map((p) => ({ path: p.path, content: stripMapSection(p.content) }))
        },
        async setImage(chatId, userId, storagePath, src) {
            const path = normalizeLocationPath(storagePath)
            if (!path) throw new Error('A place needs a name before it can have a picture.')
            await deps.portraits.set(chatId, locationImageKey(path), src, userId)
            deps.log.info(`scene: the picture of "${path}" ${src ? 'set' : 'forgotten'}`)
            return get(chatId, userId)
        },
    }
}
