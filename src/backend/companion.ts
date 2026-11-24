/**
 * The Adventure Companion's backend (Phase 100a, roadmap row 100): a second
 * conversation beside the story, kept per chat with the chat's other files,
 * answered by one quiet generation on the Companion's connection (the
 * narrator's when its row is blank) with the guide attached while the
 * install's `companionGuide` preference is on.
 *
 * Multihog keeps the conversation in the browser; here it is the server's,
 * so it follows the player between devices as the character sheet does
 * (departure 163). A failed call takes the player's message back out, so
 * a retry does not send it twice.
 */
import type { CompanionState } from '../protocol.js'
import { connectionField } from './agent-pass.js'
import { chatFilePath } from './memo-store.js'
import { readGenerationText } from './tracker-pass.js'
import {
    COMPANION_ACTION_LABELS, COMPANION_INCOMPLETE_MESSAGE, COMPANION_LIMIT_MESSAGE, COMPANION_MAP_FAILED, COMPANION_MAX_ACTIONS, COMPANION_MAX_TURNS,
    COMPANION_MESSAGE_MAX, COMPANION_NO_SUMMARY_MESSAGE, buildCompanionActContext, buildCompanionLore, buildCompanionMap, buildCompanionMemo,
    buildCompanionMessages, buildCompanionNarrative, buildCompanionObservation, estimateGuideTokens, formatPlayerTurnCommentary, parseCompanionActions,
    pushCompanionMessage, readCompanionHistory, readCompanionPending,
    type CompanionAction, type CompanionActionResult, type CompanionContext, type CompanionMessage, type CompanionPendingTurn, type CompanionReceipt,
} from '../tracker/companion.js'

/** What the Companion is shown, as the install's preferences say (100b). */
export interface CompanionPrefs {
    companionConnectionId?: string
    companionGuide?: boolean
    companionLookback?: number
    companionLookbackAll?: boolean
    companionSheet?: boolean
    companionLore?: boolean
    companionMap?: boolean
    /** Ask the player before a turn is sent for them (100c). On unless switched off. */
    companionConfirmAct?: boolean
}

/**
 * What the Companion may do (100c): Multihog's four actions, each the
 * operation the panel's own control runs. The three bookkeeping actions
 * answer with what the pass reported; none throws.
 */
export interface CompanionActions {
    tracker(chatId: string, userId: string | undefined, instruction: string): Promise<CompanionActionResult>
    agent(chatId: string, userId: string | undefined, instruction: string): Promise<CompanionActionResult>
    map(chatId: string, userId: string | undefined, instruction: string): Promise<CompanionActionResult>
    /** Whether CYOA mode is on, and the choices under the last reply. */
    turn(chatId: string, userId: string | undefined): Promise<{ cyoa: boolean; choices: string[] }>
    /** Send a message as the player and start the narrator's reply. */
    act(chatId: string, userId: string | undefined, text: string): Promise<void>
}

/**
 * Where the campaign is read from (100b). Each reader may fail on its own:
 * the Companion then answers without that block and the log says why.
 */
export interface CompanionSources {
    messages(chatId: string): Promise<Array<{ role: string; content: string }>>
    memo(chatId: string, userId: string | undefined): Promise<{ memo: string; benchedParty?: boolean }>
    /** The lore the host has active for the chat, map sections already taken out. */
    lore(chatId: string, userId: string | undefined): Promise<Array<{ title: string; content: string }>>
    /** The party's site as the player knows it, never the hidden map; blank when they are outside every mapped site. */
    map(chatId: string, userId: string | undefined): Promise<string>
}

export interface CompanionDeps {
    generate: { quiet(input: Record<string, unknown>): Promise<unknown> }
    storage: {
        getJson<T>(path: string, options?: { fallback?: T; userId?: string }): Promise<T>
        setJson(path: string, value: unknown, options?: { indent?: number; userId?: string }): Promise<void>
    }
    prefs: { load(userId: string | undefined): Promise<CompanionPrefs> }
    /** Absent, the Companion answers from the guide alone, as in 100a. */
    sources?: CompanionSources
    /** The guide's whole text, from the generated module. */
    guide: string
    log: { info(message: string): void; warn(message: string): void }
    now?: () => string
}

export interface Companion {
    get(chatId: string, userId: string | undefined): Promise<CompanionState>
    send(chatId: string, userId: string | undefined, text: string, actions?: CompanionActions): Promise<CompanionState>
    /** Answer a proposed player turn (100c): send it, or drop it. */
    confirm(chatId: string, userId: string | undefined, send: boolean, actions?: CompanionActions): Promise<CompanionState>
    clear(chatId: string, userId: string | undefined): Promise<CompanionState>
}

export function companionPath(chatId: string): string {
    return chatFilePath(chatId, 'companion.json')
}

export const COMPANION_BUSY = 'The Companion is still answering the last message.'
export const COMPANION_NO_PENDING = 'There is no turn waiting to be sent.'
export const COMPANION_ACTIONS_UNAVAILABLE = 'This build cannot run that action.'

/** What the conversation keeps of a turn the player declined, so the model knows it never went out. */
export function declinedTurnMessage(text: string): string {
    return `Not sent. I had proposed this as your turn: “${text}”`
}

const receiptOf = (result: CompanionActionResult): CompanionReceipt => ({ action: result.action, success: result.success, message: result.message })

export function createCompanion(deps: CompanionDeps): Companion {
    const now = deps.now ?? (() => new Date().toISOString())
    const busy = new Set<string>()
    const key = (chatId: string, userId: string | undefined): string => `${userId ?? '@self'}::${chatId}`
    const guideTokens = estimateGuideTokens(deps.guide)

    interface Stored { messages: CompanionMessage[]; pending: CompanionPendingTurn | null }

    async function read(chatId: string, userId: string | undefined): Promise<Stored> {
        const path = companionPath(chatId)
        try {
            const stored = await deps.storage.getJson<{ messages?: unknown; pending?: unknown } | null>(path, { fallback: null, ...(userId ? { userId } : {}) })
            return { messages: readCompanionHistory(stored?.messages), pending: readCompanionPending(stored?.pending) }
        } catch {
            return { messages: [], pending: null }
        }
    }

    async function write(chatId: string, userId: string | undefined, messages: CompanionMessage[], pending: CompanionPendingTurn | null = null): Promise<void> {
        await deps.storage.setJson(companionPath(chatId), { version: 1, messages, ...(pending ? { pending } : {}), updatedAt: now() }, userId ? { userId } : {})
    }

    /** A proposed turn the player never answered is closed as declined, so the conversation says it never went out. */
    function closePending(stored: Stored): CompanionMessage[] {
        if (!stored.pending) return stored.messages
        return pushCompanionMessage(stored.messages, {
            role: 'assistant',
            content: declinedTurnMessage(stored.pending.text),
            at: now(),
            ...(stored.pending.prior.length ? { actions: stored.pending.prior } : {}),
        })
    }

    /** One bookkeeping action, never thrown: a failure is a result the model and the player are told. */
    async function runAction(chatId: string, userId: string | undefined, action: Exclude<CompanionAction, { kind: 'act_for_user' }>, actions: CompanionActions | undefined): Promise<CompanionActionResult> {
        const label = COMPANION_ACTION_LABELS[action.kind]
        if (!actions) return { action: label, success: false, status: 'unavailable', message: COMPANION_ACTIONS_UNAVAILABLE }
        deps.log.info(`companion: ${label} asked in chat ${chatId}: ${action.instruction.replace(/\s+/g, ' ').slice(0, 300)}`)
        let result: CompanionActionResult
        try {
            result = action.kind === 'state_tracker' ? await actions.tracker(chatId, userId, action.instruction)
                : action.kind === 'lorebook_agent' ? await actions.agent(chatId, userId, action.instruction)
                    : await actions.map(chatId, userId, action.instruction)
        } catch (error) {
            result = { action: label, success: false, status: 'failed', message: error instanceof Error ? error.message : String(error) }
        }
        deps.log.info(`companion: ${label} ${result.success ? 'answered' : 'did not complete'} in chat ${chatId} (${result.status}): ${result.message}`)
        return result
    }

    /** The text a player turn would send, as Multihog resolves it: free text first, else the numbered choice. */
    async function resolveTurn(chatId: string, userId: string | undefined, action: Extract<CompanionAction, { kind: 'act_for_user' }>, actions: CompanionActions | undefined): Promise<{ text: string } | CompanionActionResult> {
        const label = COMPANION_ACTION_LABELS.act_for_user
        if (!actions) return { action: label, success: false, status: 'unavailable', message: COMPANION_ACTIONS_UNAVAILABLE }
        if (action.actionText) return { text: action.actionText }
        let turn: { cyoa: boolean; choices: string[] }
        try { turn = await actions.turn(chatId, userId) } catch (error) {
            return { action: label, success: false, status: 'failed', message: error instanceof Error ? error.message : String(error) }
        }
        if (!turn.cyoa) return { action: label, success: false, status: 'missing_action', message: 'Provide action_text for the player turn.' }
        if (!turn.choices.length) return { action: label, success: false, status: 'unavailable', message: 'CYOA is active, but no current choice buttons are available.' }
        const index = Number(action.choiceIndex)
        if (!Number.isInteger(index) || index < 1 || index > turn.choices.length) {
            return { action: label, success: false, status: 'invalid_choice', message: `Choose a CYOA choice_index from 1 to ${turn.choices.length}.` }
        }
        return { text: turn.choices[index - 1]! }
    }

    /** Send the turn as the player. The message is Multihog's, so the model reads the same result. */
    async function submitTurn(chatId: string, userId: string | undefined, text: string, actions: CompanionActions): Promise<CompanionActionResult> {
        const label = COMPANION_ACTION_LABELS.act_for_user
        try {
            await actions.act(chatId, userId, text)
            deps.log.info(`companion: sent a turn for the player in chat ${chatId}: ${text.replace(/\s+/g, ' ').slice(0, 300)}`)
            return { action: label, success: true, status: 'submitted', message: `Submitted player action: ${text}`, terminal: true }
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error)
            deps.log.warn(`companion: the player's turn could not be sent in chat ${chatId}: ${reason}`)
            return { action: label, success: false, status: 'failed', message: reason }
        }
    }

    /** The blocks the preferences share, each read on its own; what was shared is named for the log. */
    async function gather(chatId: string, userId: string | undefined, prefs: CompanionPrefs): Promise<{ context: CompanionContext; shared: string[] }> {
        const context: CompanionContext = {}
        const shared: string[] = []
        const sources = deps.sources
        if (!sources) return { context, shared }
        const attempt = async (what: string, read: () => Promise<void>): Promise<void> => {
            try { await read() } catch (error) {
                deps.log.warn(`companion: could not read ${what} for chat ${chatId}, answering without it: ${error instanceof Error ? error.message : String(error)}`)
            }
        }
        const all = prefs.companionLookbackAll === true
        const count = prefs.companionLookback ?? 5
        if (all || count > 0) {
            await attempt('the story', async () => {
                const messages = await sources.messages(chatId)
                context.narrative = buildCompanionNarrative(messages, { all, count })
                if (context.narrative) shared.push(all ? `all ${messages.length} messages of the story` : `the last ${Math.min(count, messages.length)} messages of the story`)
            })
        }
        if (prefs.companionSheet === true) {
            await attempt('the character sheet', async () => {
                const { memo, benchedParty } = await sources.memo(chatId, userId)
                context.memo = buildCompanionMemo(memo, { benchedParty })
                if (context.memo) shared.push('the character sheet')
            })
        }
        if (prefs.companionLore === true) {
            await attempt('the active lore', async () => {
                const entries = await sources.lore(chatId, userId)
                context.lore = buildCompanionLore(entries)
                if (context.lore) shared.push(`${entries.length} active lore entries`)
            })
        }
        if (prefs.companionMap === true) {
            try {
                const body = await sources.map(chatId, userId)
                context.map = buildCompanionMap(body)
                shared.push(body.trim() ? 'the site map as the player knows it' : 'no site map (the party is outside every mapped site)')
            } catch (error) {
                // Multihog tells the Companion the map could not be loaded, so it does not guess at one.
                context.map = COMPANION_MAP_FAILED
                deps.log.warn(`companion: could not read the site map for chat ${chatId}: ${error instanceof Error ? error.message : String(error)}`)
            }
        }
        return { context, shared }
    }

    async function state(chatId: string, userId: string | undefined, messages: CompanionMessage[], pending: CompanionPendingTurn | null = null): Promise<CompanionState> {
        const prefs = await deps.prefs.load(userId)
        return {
            chatId, messages, busy: busy.has(key(chatId, userId)), guideAttached: prefs.companionGuide !== false, guideTokens,
            pending: pending ? { text: pending.text } : null,
        }
    }

    return {
        async get(chatId, userId) {
            const stored = await read(chatId, userId)
            return state(chatId, userId, stored.messages, stored.pending)
        },

        async send(chatId, userId, text, actions) {
            const content = text.trim()
            if (!content) throw new Error('Type a message for the Companion first.')
            if (content.length > COMPANION_MESSAGE_MAX) throw new Error(`That message is too long for the Companion (${content.length} characters; the limit is ${COMPANION_MESSAGE_MAX}).`)
            const lock = key(chatId, userId)
            if (busy.has(lock)) throw new Error(COMPANION_BUSY)
            busy.add(lock)
            try {
                const before = closePending(await read(chatId, userId))
                const asked = pushCompanionMessage(before, { role: 'user', content, at: now() })
                const prefs = await deps.prefs.load(userId)
                const attached = prefs.companionGuide !== false
                const { context, shared } = await gather(chatId, userId, prefs)
                if (actions) {
                    // How a turn may be taken right now; unreadable, the Companion is told free text only.
                    const turn = await actions.turn(chatId, userId).catch(() => ({ cyoa: false, choices: [] as string[] }))
                    context.playerAction = buildCompanionActContext(turn)
                }
                deps.log.info(`companion: answering in chat ${chatId} (${asked.length} messages, ${attached ? `with the guide, about ${guideTokens} tokens` : 'without the guide'}; shown ${shared.length ? shared.join(', ') : 'nothing of the campaign'})`)
                const convo: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = buildCompanionMessages({ ...context, doc: attached ? deps.guide : '', history: asked })
                const completed: CompanionActionResult[] = []
                let reply: string | null = null
                let pending: CompanionPendingTurn | null = null
                turns: for (let turn = 0; turn < COMPANION_MAX_TURNS; turn++) {
                    let raw: string
                    try {
                        raw = readGenerationText(await deps.generate.quiet({ userId, chatId, ...connectionField(prefs.companionConnectionId || undefined), messages: convo })).trim()
                    } catch (error) {
                        const reason = error instanceof Error ? error.message : String(error)
                        deps.log.warn(`companion: the call failed for chat ${chatId}: ${reason}`)
                        // An action that already ran is never thrown away with the summary that did not arrive.
                        if (completed.length) { reply = COMPANION_NO_SUMMARY_MESSAGE; break }
                        throw new Error(`The Companion could not answer: ${reason}`)
                    }
                    const parsed = parseCompanionActions(raw)
                    if (!parsed.actions.length) {
                        reply = parsed.visibleText || (completed.length ? COMPANION_NO_SUMMARY_MESSAGE : '')
                        break
                    }
                    if (completed.length + parsed.actions.length > COMPANION_MAX_ACTIONS) { reply = COMPANION_LIMIT_MESSAGE; break }
                    convo.push({ role: 'assistant', content: raw })
                    const batch: CompanionActionResult[] = []
                    for (const action of parsed.actions) {
                        let result: CompanionActionResult
                        if (action.kind === 'act_for_user') {
                            const resolved = await resolveTurn(chatId, userId, action, actions)
                            if ('text' in resolved) {
                                const commentary = formatPlayerTurnCommentary(action, parsed.visibleText)
                                if (prefs.companionConfirmAct !== false) {
                                    // The player answers before anything is sent for them (departure 172); the Companion's turn ends here.
                                    pending = { text: resolved.text, commentary, prior: completed.map(receiptOf) }
                                    deps.log.info(`companion: proposed a turn for the player in chat ${chatId}, waiting for their answer`)
                                    break turns
                                }
                                result = await submitTurn(chatId, userId, resolved.text, actions!)
                                if (result.success) { completed.push(result); reply = commentary; break turns }
                            } else result = resolved
                        } else result = await runAction(chatId, userId, action, actions)
                        completed.push(result)
                        batch.push(result)
                    }
                    convo.push({ role: 'user', content: buildCompanionObservation(batch) })
                }
                if (pending) {
                    await write(chatId, userId, asked, pending)
                    busy.delete(lock)
                    return await state(chatId, userId, asked, pending)
                }
                if (reply === null) reply = completed.length ? COMPANION_NO_SUMMARY_MESSAGE : COMPANION_INCOMPLETE_MESSAGE
                if (!reply) {
                    deps.log.warn(`companion: the reply was empty for chat ${chatId}`)
                    throw new Error('The Companion’s reply was empty. Try again, or choose another connection for it.')
                }
                const answered = pushCompanionMessage(asked, { role: 'assistant', content: reply, at: now(), ...(completed.length ? { actions: completed.map(receiptOf) } : {}) })
                await write(chatId, userId, answered)
                deps.log.info(`companion: answered in chat ${chatId} (${reply.length} characters${completed.length ? `, ${completed.length} actions` : ''})`)
                busy.delete(lock)
                return await state(chatId, userId, answered)
            } finally {
                busy.delete(lock)
            }
        },

        async confirm(chatId, userId, send, actions) {
            const lock = key(chatId, userId)
            if (busy.has(lock)) throw new Error(COMPANION_BUSY)
            busy.add(lock)
            try {
                const stored = await read(chatId, userId)
                const pending = stored.pending
                if (!pending) throw new Error(COMPANION_NO_PENDING)
                let messages: CompanionMessage[]
                if (!send) {
                    messages = closePending(stored)
                    deps.log.info(`companion: the player declined the proposed turn in chat ${chatId}`)
                } else {
                    if (!actions) throw new Error(COMPANION_ACTIONS_UNAVAILABLE)
                    const result = await submitTurn(chatId, userId, pending.text, actions)
                    // A turn that could not be sent stays proposed, so the player can try again or drop it.
                    if (!result.success) throw new Error(`The turn could not be sent: ${result.message}`)
                    messages = pushCompanionMessage(stored.messages, { role: 'assistant', content: pending.commentary, at: now(), actions: [...pending.prior, receiptOf(result)] })
                }
                await write(chatId, userId, messages)
                busy.delete(lock)
                return await state(chatId, userId, messages)
            } finally {
                busy.delete(lock)
            }
        },

        async clear(chatId, userId) {
            if (busy.has(key(chatId, userId))) throw new Error(COMPANION_BUSY)
            await write(chatId, userId, [])
            deps.log.info(`companion: the conversation of chat ${chatId} cleared`)
            return state(chatId, userId, [])
        },
    }
}
