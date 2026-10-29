/**
 * The Player Card and the host persona (roadmap row 10, Phase 35b).
 *
 * The legacy's `generatePersonaBio` asks a model for the character's
 * biography in the Player Card's sections — species, body, worn equipment,
 * personality, background, habits, strengths, flaws — from the sheet in the
 * memo and the recent story, at a word count; the card is kept per chat,
 * injected for the narrator as `[PLAYER_CHARACTER]`, and patched by the
 * agent in its Body and Worn Equipment only. `activateSillyTavernPersona`
 * then makes a persona with the character's name and no description, so
 * the player's messages carry the name while the card stays the one
 * biography. Here the persona is the host's (`spindle.personas`, the
 * `personas` permission): found by name or created, then made active.
 */

import { buildCardPrompt, cardName, extractCharacterName, normalizeCardWords, patchCard, type CardStoryLine } from '../tracker/creator.js'
import type { CardResult, PersonaResult, PlayerCardView } from '../protocol.js'
import type { PlayerCard, PlayerCardStore } from './player-card-store.js'

export interface PlayerCardDeps {
    store: PlayerCardStore
    memos: { load(chatId: string, userId: string | undefined): Promise<{ memo: string }> }
    /** The cartridge settings: `pcCoreSections`, `directPromptContext`. */
    settings: { load(userId: string | undefined): Promise<Record<string, unknown>> }
    prefs: { load(userId: string | undefined): Promise<{ creatorConnectionId: string; creatorCardWords: number }> }
    /** One model call, on the connection named or the agent's. */
    generate: (messages: Array<{ role: 'system' | 'user'; content: string }>, chatId: string, userId: string | undefined, connectionId: string | undefined) => Promise<string>
    /** The recent story, oldest first. */
    story: (chatId: string, userId: string | undefined, lookback: number) => Promise<CardStoryLine[]>
    /** The host's personas. Absent when the permission is not declared or granted; the result says so. */
    personas?: {
        list(userId: string | undefined): Promise<Array<{ id: string; name: string }>>
        create(name: string, userId: string | undefined): Promise<{ id: string; name: string }>
        switchActive(id: string, userId: string | undefined): Promise<void>
        getActive(userId: string | undefined): Promise<{ id: string; name: string; description?: string } | null>
    }
    log: { info(m: string): void; warn(m: string): void }
    now?: () => Date
}

export interface CardWriteRequest {
    chatId: string
    userId: string | undefined
    /** The character's name; absent, the sheet's, else `My Character`. */
    name?: string
    words?: number
    extraHints?: string
    preferCharacterBlock?: boolean
}

export interface PlayerCardService {
    /** Write the card from the sheet and keep it. */
    write(request: CardWriteRequest): Promise<CardResult>
    /** Keep a card as given: the panel's edit, or a paste. */
    save(request: { chatId: string; userId: string | undefined; name: string; bio: string }): Promise<CardResult>
    remove(chatId: string, userId: string | undefined): Promise<void>
    /** A persona with the character's name, found or created, made active. */
    persona(request: { chatId: string; userId: string | undefined; name?: string }): Promise<PersonaResult>
    view(chatId: string, userId: string | undefined): Promise<PlayerCardView>
    /** The agent's patch: Body or Worn Equipment of the card, nothing else. */
    patch(chatId: string, userId: string | undefined, field: string, content: string): Promise<{ ok: true } | { ok: false; reason: string }>
    /** The card's name, for the agent's target test; '' without a card. */
    name(chatId: string, userId: string | undefined): Promise<string>
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

const STORY_FALLBACK = 15

export function createPlayerCard(deps: PlayerCardDeps): PlayerCardService {
    const now = deps.now ?? (() => new Date())

    async function nameFor(chatId: string, userId: string | undefined, given: string | undefined): Promise<string> {
        const typed = String(given ?? '').trim()
        if (typed) return cardName(typed)
        const memo = (await deps.memos.load(chatId, userId)).memo
        return cardName(extractCharacterName(memo))
    }

    return {
        async write(request) {
            const at = now().toISOString()
            let name = ''
            try {
                name = await nameFor(request.chatId, request.userId, request.name)
                const prefs = await deps.prefs.load(request.userId)
                const words = normalizeCardWords(request.words ?? prefs.creatorCardWords)
                const settings = await deps.settings.load(request.userId)
                const memo = (await deps.memos.load(request.chatId, request.userId)).memo
                const windowSize = typeof settings.directPromptContext === 'number' && settings.directPromptContext > 0 ? settings.directPromptContext : STORY_FALLBACK
                const story = await deps.story(request.chatId, request.userId, windowSize)
                const prompt = buildCardPrompt(name, words, { memo, settings, story, ...(request.extraHints ? { extraHints: request.extraHints } : {}), ...(request.preferCharacterBlock ? { preferCharacterBlock: true } : {}) })
                deps.log.info(`creator: writing the Player Card for "${name}" (${words} words, ${story.length} story lines)`)
                const bio = (await deps.generate([{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }], request.chatId, request.userId, prefs.creatorConnectionId || undefined)).trim()
                if (!bio) {
                    deps.log.warn(`creator: the Player Card for "${name}" came back empty`)
                    return { status: 'failed', at, name, reason: 'Persona generation returned empty.' }
                }
                const card: PlayerCard = { name, bio, wordCount: words, at }
                await deps.store.save(request.chatId, { card }, request.userId)
                deps.log.info(`creator: Player Card written for "${name}" (${bio.split(/\s+/).length} words)`)
                return { status: 'written', at, name, words: bio.split(/\s+/).filter(Boolean).length }
            } catch (error) {
                deps.log.warn(`creator: the Player Card could not be written: ${describe(error)}`)
                return { status: 'failed', at, name, reason: describe(error) }
            }
        },
        async save({ chatId, userId, name: given, bio: text }) {
            const at = now().toISOString()
            const name = cardName(given)
            const bio = String(text ?? '').trim()
            if (!bio) {
                await deps.store.save(chatId, { card: null }, userId)
                deps.log.info(`creator: Player Card removed (saved empty) for chat ${chatId}`)
                return { status: 'removed', at, name }
            }
            const existing = (await deps.store.load(chatId, userId)).card
            await deps.store.save(chatId, { card: { name, bio, wordCount: existing?.wordCount ?? 150, at } }, userId)
            deps.log.info(`creator: Player Card saved for "${name}" (${bio.split(/\s+/).length} words)`)
            return { status: 'written', at, name, words: bio.split(/\s+/).filter(Boolean).length }
        },
        async remove(chatId, userId) {
            await deps.store.save(chatId, { card: null }, userId)
            deps.log.info(`creator: Player Card removed for chat ${chatId}`)
        },
        async persona(request) {
            const at = now().toISOString()
            let name = ''
            try {
                name = await nameFor(request.chatId, request.userId, request.name)
                if (!deps.personas) return { status: 'failed', at, name, reason: 'the host has not granted the personas permission, so no persona can be made' }
                const wanted = name.toLowerCase()
                const found = (await deps.personas.list(request.userId)).find((p) => p.name.trim().toLowerCase() === wanted)
                const persona = found ?? (await deps.personas.create(name, request.userId))
                await deps.personas.switchActive(persona.id, request.userId)
                await deps.store.save(request.chatId, { persona: { id: persona.id, name: persona.name, at } }, request.userId)
                deps.log.info(`creator: persona "${persona.name}" ${found ? 'found' : 'created'} and made active (${persona.id})`)
                return { status: 'active', at, name: persona.name, id: persona.id, created: !found }
            } catch (error) {
                deps.log.warn(`creator: the persona for "${name}" could not be made active: ${describe(error)}`)
                return { status: 'failed', at, name, reason: describe(error) }
            }
        },
        async view(chatId, userId) {
            const record = await deps.store.load(chatId, userId)
            let active: { id: string; name: string; description?: string } | null = null
            if (deps.personas) {
                try { active = await deps.personas.getActive(userId) } catch { active = null }
            }
            return {
                card: record.card,
                persona: record.persona,
                personasAvailable: !!deps.personas,
                activePersona: active ? active.name : '',
                // A described persona is a second biography Lumiverse sends beside the card (35c-bis).
                activeDescribed: !!active?.description?.trim(),
            }
        },
        async patch(chatId, userId, field, content) {
            const record = await deps.store.load(chatId, userId)
            if (!record.card) return { ok: false, reason: 'No Player Character card linked' }
            const result = patchCard(record.card.bio, field, content)
            if (!result.ok) return result
            await deps.store.save(chatId, { card: { ...record.card, bio: result.bio, at: now().toISOString() } }, userId)
            deps.log.info(`creator: the agent updated the Player Card's ${field} for "${record.card.name}"`)
            return { ok: true }
        },
        async name(chatId, userId) {
            return (await deps.store.load(chatId, userId)).card?.name ?? ''
        },
    }
}
