/**
 * The character creator (roadmap row 10, Phase 35): the sheet written, and
 * Instant Action (35a): the sheet written and the adventure begun.
 *
 * The legacy's Character Creator sends its prompt through `sendDirectPrompt`
 * in `modules_only` mode: the State Model is handed the module formats alone
 * as its system prompt, the prompt as the user's instruction, the prior memo
 * (empty, as a rule) and a few recent messages, and its reply is merged into
 * the memo like any pass. Then it checks that a `[CHARACTER]` block actually
 * arrived, since a truncated reply leaves the memo as it was. The same here:
 * the tracker pass runs with the instruction, in modules-only mode, on the
 * creator's connection when one is set, and the memo before and after is
 * compared by the legacy's own check.
 *
 * Instant Action is the same sheet with the choices rolled: a genre, one of
 * its archetypes at random, level 1 (or a roll of 1 to 10, 45d), the name given or left to
 * the model, and a line of setup that outranks the rolled defaults; then the
 * opening message that starts the adventure. The legacy writes the Player
 * Card and the host persona between the two; that is 35b.
 *
 * The other ways to begin (35c) are the legacy's *Other Ways* drawer: a
 * character that embodies the host's active persona, or one from custom
 * instructions alone, on the creator's level, genre, gear tier and guide,
 * through the same pass, then the card and the persona as the switches say.
 */

import { alreadyHadSheet, buildSheetPrompt, buildWaysPrompt, checkSheet, emptyDraft, instantOpeningMessage, instantPromptSection, normalizeDraft, normalizeGearTier, normalizeInstantGenre, normalizeInstantSetup, normalizeLevel, randomArchetype, resolveInstantLevel, buildImportPrompt, buildImportBio, extractCharacterName, normalizeImportMode, normalizeImportWords, type BeginWay, type CreatorCard, type CreatorDefaults, type CreatorDraft, type ImportMode } from '../tracker/creator.js'
import type { CardChoice, CardResult, CreatorResult, ImportResult, InstantResult, PersonaResult, WaysResult } from '../protocol.js'
import type { PlayerCardService } from './player-card.js'
import type { TrackerPass, TrackerPassOutcome } from './tracker-pass.js'

export interface CreatorPrefs {
    creatorLevel: number | 'none'
    creatorGearTier: string
    creatorCombatScalingGuide: boolean
    creatorInitialDate: string
    creatorInitialTime: string
    creatorConnectionId: string
    /** How many recent messages the sheet's pass reads: the send bar's own window. */
    trackerDirectLookback: number
    /** The Player Card and the persona (35b): the creator's two switches and the card's word count. */
    creatorPlayerCard: boolean
    creatorPersona: boolean
    creatorCardWords: number
    /** The other ways' genre (35c): the legacy's `onboardingGenre`, saved by Instant Action and the drawer alike. */
    creatorGenre: string
    /** Roll Instant Action's level 1 to 10 instead of starting at 1 (45d). Absent on an older prefs bag: off. */
    creatorInstantRandomLevel?: boolean
}

export interface CreatorDeps {
    trackerPass: TrackerPass
    /** The cartridge settings: the modules, the custom fields, the calendar format. */
    settings: { load(userId: string | undefined): Promise<Record<string, unknown>> }
    memos: { load(chatId: string, userId: string | undefined): Promise<{ memo: string }> }
    prefs: { load(userId: string | undefined): Promise<CreatorPrefs> }
    /** The narrator's card, when the host lets it be read; absent or `null` leaves the prompt without it. */
    card?: (chatId: string, userId: string | undefined) => Promise<CreatorCard | null>
    /** Send a user message and start the reply: the opening of an Instant Action. Absent: nothing is sent. */
    /** Sends the opening message; `personaId` names the persona just made active, so the message goes out as it (76-ter). */
    send?: (chatId: string, content: string, userId: string | undefined, personaId?: string) => Promise<{ id: string }>
    /** The Player Card and the persona (35b); absent, neither is written. */
    playerCard?: PlayerCardService
    /** The host's character cards (39); absent when the grant is missing. */
    characters?: {
        list(userId: string | undefined): Promise<Array<{ id: string; name: string; description: string; personality: string }>>
        /** `avatar` is the card's picture address, `''` or absent without one (43). */
        get(id: string, userId: string | undefined): Promise<{ id: string; name: string; description: string; personality: string; avatar?: string } | null>
    }
    /** The chat's portraits, for the imported card's avatar (43); absent, the avatar is left alone. */
    portraits?: { set(chatId: string, name: string, src: string, userId: string | undefined): Promise<unknown> }
    /** One model call for the imported card's Player Card (39), on the creator's connection or the agent's. */
    generate?: (messages: Array<{ role: 'system' | 'user'; content: string }>, chatId: string, userId: string | undefined, connectionId: string | undefined) => Promise<string>
    /** The recent story for the import's world context (39): the last `count` messages, oldest first. */
    recent?: (chatId: string, userId: string | undefined, count: number) => Promise<Array<{ user: boolean; name: string; text: string }>>
    /** The host's active persona (35c), for the persona way; absent or `null` when there is none or the grant is missing. */
    activePersona?: (userId: string | undefined) => Promise<{ name: string; description: string } | null>
    log: { info(m: string): void; warn(m: string): void }
    now?: () => Date
    random?: () => number
}

export interface InstantRequest {
    chatId: string
    userId: string | undefined
    genre: string
    name?: string
    setup?: string
    /** Send the opening message once the sheet is written. Default true, as the legacy's. */
    sendStarter?: boolean
    /** The Player Card's word count; absent, the preference. */
    cardWords?: number
}

export interface WaysRequest {
    chatId: string
    userId: string | undefined
    way: BeginWay
    /** Custom: the name the sheet must carry (required). Persona: ignored; the persona's name is the name. */
    name?: string
    /** Custom: the instructions (required). Persona: an addendum. */
    instructions?: string
    level?: number | 'none'
    genre?: string
    gearTier?: string
    combatScalingGuide?: boolean
    playerCard?: boolean
    persona?: boolean
    cardWords?: number
}

export interface ImportRequest {
    chatId: string
    userId: string | undefined
    characterId: string
    mode: ImportMode
    /** The Player Card's length: the card's own, or a word count. Default `same`, as the legacy's select opens on. */
    cardWords?: number | 'same'
    playerCard?: boolean
    persona?: boolean
    /** The chat's own character, whose description is the import's world reference. */
    narratorCharacterId?: string
}

export interface Creator {
    /** Import Card (39): the host's cards to pick from, and one imported as the player. */
    cards(userId: string | undefined): Promise<CardChoice[]>
    importCard(request: ImportRequest): Promise<ImportResult>
    ways(request: WaysRequest): Promise<WaysResult>
    generate(request: { chatId: string; userId: string | undefined; draft: unknown; playerCard?: boolean; persona?: boolean; cardWords?: number }): Promise<CreatorResult>
    instant(request: InstantRequest): Promise<InstantResult>
    /** The form's defaults for this user: the level, gear tier and combat guide the prefs hold. */
    defaults(userId: string | undefined): Promise<CreatorDefaults>
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

export function createCreator(deps: CreatorDeps): Creator {
    const now = deps.now ?? (() => new Date())
    const random = deps.random ?? Math.random

    async function defaults(userId: string | undefined): Promise<CreatorDefaults> {
        const prefs = await deps.prefs.load(userId)
        return { level: prefs.creatorLevel, gearTier: prefs.creatorGearTier as CreatorDefaults['gearTier'], combatScalingGuide: prefs.creatorCombatScalingGuide, instantRandomLevel: prefs.creatorInstantRandomLevel }
    }

    /** The sheet written from a draft: the prompt, the pass, the check. Throws only when a dependency does. */
    async function writeSheet(chatId: string, userId: string | undefined, draft: CreatorDraft, setup = ''): Promise<{ ok: true; name: string; added: string[]; replaced: string[]; extraHints: string } | { ok: false; reason: string }> {
        const prefs = await deps.prefs.load(userId)
        const settings = await deps.settings.load(userId)
        const card = deps.card ? await deps.card(chatId, userId).catch(() => null) : null
        const { prompt, extraHints, cardSnippet } = buildSheetPrompt(draft, {
            settings: settings as { modules?: Record<string, boolean>; customFields?: unknown[]; useDdMmYyFormat?: boolean },
            initialDate: prefs.creatorInitialDate,
            initialTime: prefs.creatorInitialTime,
            card,
            ...(setup ? { instantActionInstructions: setup } : {}),
        })
        const before = (await deps.memos.load(chatId, userId)).memo
        deps.log.info(`creator: writing the sheet for chat ${chatId} (${draft.name || 'a name of the model\u2019s choosing'}, ${draft.genre || 'no genre'}, ${draft.level === 'none' ? 'no levels' : `level ${draft.level}`}, ${draft.class}${setup ? ', with a setup' : ''})`)
        const outcome: TrackerPassOutcome = await deps.trackerPass.run({
            chatId,
            userId,
            trigger: 'direct',
            instruction: prompt,
            window: prefs.trackerDirectLookback,
            systemPromptMode: 'modules_only',
            playerName: draft.name,
            ...(prefs.creatorConnectionId ? { connectionId: prefs.creatorConnectionId } : {}),
        })
        const after = (await deps.memos.load(chatId, userId)).memo
        const check = checkSheet(before, after, { changed: outcome.status === 'updated', ...(outcome.reason ? { message: outcome.reason } : {}) })
        if (!check.ok) {
            deps.log.warn(`creator: ${check.reason}`)
            return { ok: false, reason: check.reason + alreadyHadSheet(before) }
        }
        const added = outcome.delta?.added ?? []
        const replaced = outcome.delta?.replaced ?? []
        deps.log.info(`creator: wrote the sheet for "${check.name || 'an unnamed character'}": ${[...added, ...replaced].join(', ') || 'the memo'}`)
        // The card's writer gets the sheet's hints and the narrator's card, as the legacy hands them on.
        return { ok: true, name: check.name, added, replaced, extraHints: extraHints + (cardSnippet ? `\n\n--- CHARACTER CARD CONTEXT ---${cardSnippet}` : '') }
    }

    /**
     * After the sheet: the persona, then the card, as the creator orders them
     * (Instant Action writes the card first and the persona after; the order
     * does not matter to either). Each is attempted on its own and reported
     * in words; a failure here never undoes the sheet.
     */
    async function follow(chatId: string, userId: string | undefined, name: string, wants: { card: boolean; persona: boolean; words: number; extraHints?: string }): Promise<{ card?: CardResult; persona?: PersonaResult }> {
        const out: { card?: CardResult; persona?: PersonaResult } = {}
        if (!deps.playerCard) return out
        if (wants.persona) out.persona = await deps.playerCard.persona({ chatId, userId, name })
        if (wants.card) out.card = await deps.playerCard.write({ chatId, userId, name, words: wants.words, ...(wants.extraHints ? { extraHints: wants.extraHints } : {}) })
        return out
    }

    /** A card as the import list shows it: the opening of its description, or its personality, as the legacy's row does. */
    function choice(card: { id: string; name: string; description: string; personality: string }): CardChoice {
        return { id: card.id, name: card.name, snippet: (card.description || card.personality || 'No description').substring(0, 80) }
    }

    async function cards(userId: string | undefined): Promise<CardChoice[]> {
        if (!deps.characters) throw new Error('the host has not granted the characters permission, so the cards cannot be listed')
        return (await deps.characters.list(userId)).filter((card) => card.name).map(choice)
    }

    /**
     * Import a character card as the player (39), as the legacy's
     * `importPcFromCard` does: the tracker's direct pass with the card and the
     * world as its instruction, then the persona, then the Player Card written
     * from the card's own text rather than from the sheet. Each step after the
     * sheet is reported in words; a failure there never undoes the sheet.
     */
    async function importCard(request: ImportRequest): Promise<ImportResult> {
        const at = now().toISOString()
        const mode = normalizeImportMode(request.mode)
        const failed = (name: string, reason: string): ImportResult => ({ status: 'failed', at, name, source: name, mode, reason })
        try {
            if (!deps.characters) return failed('', 'the host has not granted the characters permission, so no card can be read')
            const card = await deps.characters.get(request.characterId, request.userId)
            if (!card) return failed('', `No character card was found for "${request.characterId}".`)
            const name = card.name.trim() || 'Unnamed'
            const prefs = await deps.prefs.load(request.userId)
            const settings = await deps.settings.load(request.userId)
            const narrator = request.narratorCharacterId && request.narratorCharacterId !== card.id
                ? await deps.characters.get(request.narratorCharacterId, request.userId).catch(() => null)
                : null
            const narratorText = narrator?.description?.trim() ?? ''
            const before = (await deps.memos.load(request.chatId, request.userId)).memo
            const recent = deps.recent ? await deps.recent(request.chatId, request.userId, 8).catch(() => []) : []
            const level = prefs.creatorLevel === 'none' ? 1 : Number(prefs.creatorLevel) || 1
            const prompt = buildImportPrompt(mode, {
                settings,
                level,
                genre: prefs.creatorGenre || 'fantasy',
                gearTier: normalizeGearTier(prefs.creatorGearTier),
                card: { name, description: card.description ?? '', personality: card.personality ?? '' },
                memo: before,
                recent,
                narrator: narratorText,
            })
            deps.log.info(`creator: importing the card "${name}" for chat ${request.chatId} (${mode === 'minimal' ? 'as is' : 'fitted into the story'}${narratorText ? ', with the narrator\u2019s card' : ''})`)
            const outcome: TrackerPassOutcome = await deps.trackerPass.run({
                chatId: request.chatId,
                userId: request.userId,
                trigger: 'direct',
                instruction: prompt,
                window: prefs.trackerDirectLookback,
                systemPromptMode: 'modules_only',
                playerName: name,
                ...(prefs.creatorConnectionId ? { connectionId: prefs.creatorConnectionId } : {}),
            })
            if (outcome.status !== 'updated') {
                const reason = `the tracker pass ${outcome.status === 'failed' ? 'failed' : 'changed nothing'}${outcome.reason ? `: ${outcome.reason}` : ''}`
                deps.log.warn(`creator: the card "${name}" was not imported: ${reason}`)
                return failed(name, reason + alreadyHadSheet(before))
            }
            const after = (await deps.memos.load(request.chatId, request.userId)).memo
            const added = outcome.delta?.added ?? []
            const replaced = outcome.delta?.replaced ?? []
            const sheetName = extractCharacterName(after) || name
            deps.log.info(`creator: imported the card "${name}" as "${sheetName}": ${[...added, ...replaced].join(', ') || 'the memo'}`)
            const out: ImportResult = { status: 'written', at, name: sheetName, source: name, mode, added, replaced }
            // The card's picture becomes the character's portrait, under the sheet's name (43): never a failure of the import.
            if (card.avatar && deps.portraits) {
                try {
                    await deps.portraits.set(request.chatId, sheetName, card.avatar, request.userId)
                    out.portrait = true
                    deps.log.info(`creator: the avatar of "${name}" is the portrait of "${sheetName}"`)
                } catch (error) {
                    out.portrait = false
                    deps.log.warn(`creator: the avatar of "${name}" could not be placed as the portrait: ${describe(error)}`)
                }
            }
            if (deps.playerCard && (request.persona ?? prefs.creatorPersona)) {
                out.persona = await deps.playerCard.persona({ chatId: request.chatId, userId: request.userId, name })
            }
            if (deps.playerCard && (request.playerCard ?? prefs.creatorPlayerCard)) {
                out.card = await importBio(request, card, mode, name, settings, narratorText, prefs.creatorConnectionId)
            }
            return out
        } catch (error) {
            deps.log.warn(`creator: the import failed: ${describe(error)}`)
            return failed('', describe(error))
        }
    }

    /** The Player Card from the card's own text (39): one call, saved as the card. Reported, never thrown. */
    async function importBio(request: ImportRequest, card: { name: string; description: string; personality: string }, mode: ImportMode, name: string, settings: Record<string, unknown>, narrator: string, connectionId: string): Promise<CardResult> {
        const at = now().toISOString()
        if (!deps.generate || !deps.playerCard) return { status: 'failed', at, name, reason: 'this build cannot write the Player Card from a card' }
        try {
            const words = normalizeImportWords(request.cardWords)
            const { system, user } = buildImportBio({ name, description: card.description ?? '', personality: card.personality ?? '' }, mode, words, { settings, narrator })
            deps.log.info(`creator: writing the Player Card from the card "${name}" (${words === 'same' ? 'the card\u2019s length' : `${words} words`})`)
            const bio = (await deps.generate([{ role: 'system', content: system }, { role: 'user', content: user }], request.chatId, request.userId, connectionId || undefined)).trim()
            if (!bio) return { status: 'failed', at, name, reason: 'the model returned no Player Card' }
            return await deps.playerCard.save({ chatId: request.chatId, userId: request.userId, name, bio })
        } catch (error) {
            deps.log.warn(`creator: the Player Card from the card "${name}" failed: ${describe(error)}`)
            return { status: 'failed', at, name, reason: describe(error) }
        }
    }

    return {
        defaults,
        cards,
        importCard,
        async ways(request) {
            const at = now().toISOString()
            const way: BeginWay = request.way === 'persona' ? 'persona' : 'custom'
            const typedName = String(request.name ?? '').trim()
            const instructions = String(request.instructions ?? '').trim()
            try {
                const prefs = await deps.prefs.load(request.userId)
                let persona: { name: string; description: string } | null = null
                if (way === 'persona') {
                    persona = deps.activePersona ? await deps.activePersona(request.userId) : null
                    if (!persona || (!persona.name.trim() && !persona.description.trim())) {
                        return { status: 'failed', at, way, name: '', reason: deps.activePersona ? 'No persona is set. Pick a persona in Lumiverse and try again.' : 'the host has not granted the personas permission, so the active persona cannot be read' }
                    }
                    persona = { name: persona.name.trim(), description: persona.description.trim() }
                } else {
                    if (!instructions) return { status: 'failed', at, way, name: typedName, reason: 'Please enter custom setting/character instructions first.' }
                    if (!typedName) return { status: 'failed', at, way, name: '', reason: 'Roll a character name before generating.' }
                }
                const settings = await deps.settings.load(request.userId)
                const level = request.level !== undefined ? normalizeLevel(request.level) : prefs.creatorLevel
                const genre = request.genre ?? prefs.creatorGenre
                const name = way === 'persona' ? persona!.name : typedName
                const { prompt, cardHints } = buildWaysPrompt(way, {
                    level,
                    genre,
                    gearTier: normalizeGearTier(request.gearTier ?? prefs.creatorGearTier),
                    combatScalingGuide: request.combatScalingGuide ?? prefs.creatorCombatScalingGuide,
                    settings,
                    initialDate: prefs.creatorInitialDate,
                    initialTime: prefs.creatorInitialTime,
                    name,
                    instructions,
                    ...(persona ? { persona } : {}),
                })
                const before = (await deps.memos.load(request.chatId, request.userId)).memo
                deps.log.info(`creator: ${way === 'persona' ? `a character from the persona "${persona!.name}"` : `a character from instructions for "${name}"`} for chat ${request.chatId} (${genre}, ${level === 'none' ? 'no levels' : `level ${level}`}${instructions ? ', with instructions' : ''})`)
                const outcome: TrackerPassOutcome = await deps.trackerPass.run({
                    chatId: request.chatId,
                    userId: request.userId,
                    trigger: 'direct',
                    instruction: prompt,
                    window: prefs.trackerDirectLookback,
                    systemPromptMode: 'modules_only',
                    playerName: name,
                    ...(prefs.creatorConnectionId ? { connectionId: prefs.creatorConnectionId } : {}),
                })
                const after = (await deps.memos.load(request.chatId, request.userId)).memo
                const check = checkSheet(before, after, { changed: outcome.status === 'updated', ...(outcome.reason ? { message: outcome.reason } : {}) })
                if (!check.ok) {
                    deps.log.warn(`creator: ${check.reason}`)
                    return { status: 'failed', at, way, name, ...(persona ? { source: persona.name } : {}), reason: check.reason + alreadyHadSheet(before) }
                }
                const added = outcome.delta?.added ?? []
                const replaced = outcome.delta?.replaced ?? []
                deps.log.info(`creator: wrote the sheet for "${check.name || name || 'an unnamed character'}": ${[...added, ...replaced].join(', ') || 'the memo'}`)
                // The persona way keeps the persona's name whatever the sheet says, as the legacy's preferredName does.
                const charName = way === 'persona' ? persona!.name || check.name || 'My Character' : check.name || name || 'My Character'
                const extra = await follow(request.chatId, request.userId, charName, { card: request.playerCard ?? prefs.creatorPlayerCard, persona: request.persona ?? prefs.creatorPersona, words: request.cardWords ?? prefs.creatorCardWords, extraHints: cardHints })
                return { status: 'written', at, way, name: check.name || charName, ...(persona ? { source: persona.name } : {}), added, replaced, ...extra }
            } catch (error) {
                deps.log.warn(`creator: the ${way} way failed: ${describe(error)}`)
                return { status: 'failed', at, way, name: typedName, reason: describe(error) }
            }
        },
        async generate({ chatId, userId, draft: raw, playerCard, persona, cardWords }) {
            const at = now().toISOString()
            try {
                const prefs = await deps.prefs.load(userId)
                const draft = normalizeDraft(raw, await defaults(userId))
                const written = await writeSheet(chatId, userId, draft)
                if (!written.ok) return { status: 'failed', at, name: '', reason: written.reason }
                const name = written.name || draft.name || 'My Character'
                const extra = await follow(chatId, userId, name, { card: playerCard ?? prefs.creatorPlayerCard, persona: persona ?? prefs.creatorPersona, words: cardWords ?? prefs.creatorCardWords, ...(written.extraHints ? { extraHints: written.extraHints } : {}) })
                return { status: 'written', at, name: written.name, added: written.added, replaced: written.replaced, ...extra }
            } catch (error) {
                deps.log.warn(`creator: the sheet could not be written: ${describe(error)}`)
                return { status: 'failed', at, name: '', reason: describe(error) }
            }
        },
        async instant(request) {
            const at = now().toISOString()
            const genre = normalizeInstantGenre(request.genre)
            const className = randomArchetype(genre, random)
            const setup = normalizeInstantSetup(request.setup)
            const name = String(request.name ?? '').trim()
            try {
                const base = await defaults(request.userId)
                // Level 1, or a roll of 1 to 10 with Random level on (45d); a system without levels keeps none. The setup may override either, in the prompt.
                const rolled = resolveInstantLevel({ noLevel: base.level === 'none', randomLevel: !!base.instantRandomLevel, random })
                const level = rolled === null ? ('none' as const) : rolled
                const draft: CreatorDraft = { ...emptyDraft(base), name, genre, level, class: className }
                deps.log.info(`creator: instant action for chat ${request.chatId} (${genre}, ${className}, ${level === 'none' ? 'no levels' : `level ${level}`}, ${name || 'a name of the model\u2019s choosing'}${setup ? ', with a setup' : ''})`)
                const written = await writeSheet(request.chatId, request.userId, draft, setup)
                if (!written.ok) return { status: 'failed', at, genre, className, level: level === 'none' ? null : level, name: '', started: false, reason: written.reason }
                const charName = written.name || name || 'My Character'
                // The legacy's Instant Action always writes the card and the persona; the setup's section guides the card too.
                const extra = await follow(request.chatId, request.userId, charName, { card: true, persona: true, words: request.cardWords ?? (await deps.prefs.load(request.userId)).creatorCardWords, ...(setup ? { extraHints: instantPromptSection(setup) } : {}) })
                let started = false
                let messageId: string | undefined
                if (request.sendStarter !== false) {
                    if (!deps.send) return { status: 'failed', at, genre, className, level: level === 'none' ? null : level, name: charName, started: false, reason: `the sheet for ${charName} was written, but this build cannot send the opening message` }
                    // The persona was made active a moment ago, and the host's own view may not have refreshed yet (the try of 2026-10-24: the
                    // message came from the blank user until the persona library was reloaded): the message names the persona itself.
                    const personaId = extra.persona?.status === 'active' ? extra.persona.id : undefined
                    const sent = await deps.send(request.chatId, instantOpeningMessage(setup), request.userId, personaId)
                    started = true
                    messageId = sent.id
                    deps.log.info(`creator: instant action began the adventure for "${charName}" (message ${sent.id}${personaId ? `, as the persona ${personaId}` : ''})`)
                }
                return { status: 'ready', at, genre, className, level: level === 'none' ? null : level, name: charName, started, ...(messageId ? { messageId } : {}), added: written.added, ...extra }
            } catch (error) {
                deps.log.warn(`creator: instant action failed: ${describe(error)}`)
                return { status: 'failed', at, genre, className, level: null, name: '', started: false, reason: describe(error) }
            }
        },
    }
}
