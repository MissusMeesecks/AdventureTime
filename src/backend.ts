/**
 * Backend entry point — runs in an isolated Bun runtime, no DOM.
 *
 * This file is deliberately thin. It is the only place that touches the
 * `spindle` global, which is what lets everything under src/backend/ be unit
 * tested against fakes instead of a live host.
 *
 * What it wires up:
 *   - settings persistence, on this extension's own per-user storage
 *   - tracker memo storage, one file per chat
 *   - the request bridge the panel talks to
 *   - macro-resolving generation wrappers (see backend/generation.ts)
 *   - the prompt interceptor seam (see backend/interceptor.ts)
 *
 *   - the tracker pass, on GENERATION_ENDED
 *   - the memo injection the interceptor serves from
 *
 * The loop those last two close is the point of the extension: after each turn
 * the pass writes what changed into the chat's memo, and the next generation's
 * prompt carries that memo back in.
 */

import type { SpindleAPI } from 'lumiverse-spindle-types'

import { CHANNEL, isRequest, type ResponseMessage } from './protocol.js'
import { SettingsStore } from './backend/settings-store.js'
import { MemoStore } from './backend/memo-store.js'
import { handleRequest, writesPrefs, writesSettings } from './backend/requests.js'
import { createMaintenance } from './backend/maintenance.js'
import { createStockUpgrade } from './backend/stock-upgrade.js'
import { getFactoryCartridgePayload } from './state/factory.js'
import { createGeneration } from './backend/generation.js'
import { createNarratorConnection } from './backend/narrator-connection.js'
import { composeInjectionProviders, registerStateInterceptor } from './backend/interceptor.js'
import { createMemoInjection } from './backend/injection.js'
import { createDiceInjection } from './backend/dice-injection.js'
import { createCyoaInjection } from './backend/cyoa-injection.js'
import { createChoicesDisplay } from './backend/choices-display.js'
import { createWizard } from './backend/wizard.js'
import { createThemeWizard } from './backend/theme-wizard.js'
import { createCardAiEdit } from './backend/card-ai-edit.js'
import { createWizardContext } from './tracker/wizard-context.js'
import { createWorldLoreReader } from './backend/world-lore.js'
import { FACTORY_CARTRIDGE_DEFAULTS } from './state/factory-defaults.js'
import { resolveTimePromptKey } from './tracker/prompt.js'
import { WorldStore } from './backend/world-store.js'
import { createWorldProgression, type WorldBookStore } from './backend/world-pass.js'
import { createWorldInjection } from './backend/world-injection.js'
import { MapStore, type MapArchitectReport } from './backend/map-store.js'
import { createMapSync } from './backend/map-sync.js'
import { createMapView } from './backend/map-view.js'
import { createCreator } from './backend/creator.js'
import { createNpcLibrary } from './backend/npc-library.js'
import { createNpcCreator } from './backend/npc-creator.js'
import { createScene } from './backend/scene.js'
import { createCampaignNamer } from './backend/campaign-name.js'
import { createSceneArt } from './backend/scene-art.js'
import { createPortraitAuto } from './backend/portrait-auto.js'
import { createBookMaker } from './backend/book-maker.js'
import { createCampaignBooks } from './backend/campaign-books.js'
import { createCampaignFork } from './backend/campaign-fork.js'
import { RelationshipStore } from './backend/relationship-store.js'
import { createRelationships } from './backend/relationships.js'
import { createRelationsInjection } from './backend/relations-injection.js'
import { NpcLibraryStore } from './backend/npc-library-store.js'
import { createMapInjection } from './backend/map-injection.js'
import { PlayerCardStore } from './backend/player-card-store.js'
import { createPlayerCardInjection } from './backend/player-card-injection.js'
import { createPlayerCard } from './backend/player-card.js'
import { createMapToolSync } from './backend/map-tool.js'
import { createMapArchitect } from './backend/map-architect.js'
import { createCampaignRecords } from './backend/campaign-records.js'
import { createMapCreation } from './backend/map-create.js'
import { createMapOpener } from './backend/map-opener.js'
import { createMapUpdater } from './backend/map-updater.js'
import { createTerminal } from './backend/terminal.js'
import { createMapEvolution } from './backend/map-evolution.js'
import { createMapSandbox } from './backend/map-sandbox.js'
import { formatRecentStory } from './tracker/evolution.js'
import { narratorSiteActivity } from './tracker/evolution.js'
import { CREATE_AREA_MAP_TOOL_NAME } from './tracker/architect.js'
import { isBaseSectionEnabled, MAPPING_SECTION_TAG } from './tracker/rulebook.js'
import { campaignBookName, rememberCampaignBook, resolveCampaignPrefix } from './agent/campaign.js'
import { isCyoaActive } from './tracker/rulebook.js'
import { stripSupersededChoices } from './tracker/cyoa.js'
import { createDiceLog } from './backend/dice-log.js'
import {
    createDiceToolCoordinator,
    createDiceToolSync,
    explainDiceTools,
    handleDiceToolInvocation,
} from './backend/dice-tool.js'
import {
    createSyspromptInjection,
    stateInjectionProviders,
} from './backend/sysprompt-injection.js'
import { MemoHistoryStore } from './backend/memo-history.js'
import { ReportHistoryStore } from './backend/report-history.js'
import { PortraitStore } from './backend/portrait-store.js'
import { PrefsStore } from './backend/prefs-store.js'
import { QuestArchiveStore } from './backend/quest-archive.js'
import {
    createTrackerPass,
    formatNarrative,
    numberedNarrative,
    readGenerationText,
    narrativeText,
    trackerPassResolvers,
    renderNarrative,
} from './backend/tracker-pass.js'
import {
    agentPassOptions,
    connectionField,
    runAgentPass,
    redoAgentPass,
    undoAgentPass,
    undoAgentPassForMessage,
    type AgentPassDeps,
    type AgentPassReport,
    type AgentUndoReport,
} from './backend/agent-pass.js'
import { createAutoCleanup, runCleanupPass } from './backend/agent-cleanup.js'
import { createFullAudit } from './backend/agent-audit.js'
import { cloneCampaignStack } from './backend/campaign-clone.js'
import { createRedoStack } from './agent/redo.js'
import { AUDIT_INSTRUCTION } from './agent/cleanup.js'
import { dropLatestLorePass, latestLorePass, recordLorePass } from './backend/lore-history.js'
import { autoPassLookback, decideAutoPass, watermarkAfterRollback } from './backend/auto-pass.js'
import { InFlightPasses } from './backend/in-flight.js'
import type { LoreStore } from './agent/writer.js'
import type { AgentRunResult } from './protocol.js'
import { maybeRunTrackerPass, type TrackerCadenceDeps } from './backend/tracker-cadence.js'
import { auditPermissions, checkPermissions, reportDeniedPermissions } from './backend/permissions.js'
import type { StatusResult } from './protocol.js'

declare const spindle: SpindleAPI

/**
 * Check what the host has actually granted, before anything tries to use it.
 *
 * A gated call fails at its own call site, which is invisible until something
 * reports it. `chat_mutation` went undeclared and every tracker pass failed
 * with no symptom but state that would not move — so the permissions are
 * checked and logged up front now, and any call the host blocks says so.
 */
const permissionAudit = auditPermissions(spindle.permissions, spindle.log)
const disposeDeniedLog = reportDeniedPermissions(spindle.permissions, spindle.log)

/**
 * The same facts, on demand, for the panel to show.
 *
 * Re-checked per call rather than serving the startup audit above: a permission
 * can be granted while the extension is running, and a cached answer would go
 * on telling a user who has just fixed the problem that it is still broken.
 *
 * The manifest version is the other half. Lumiverse clones and builds an
 * extension at install time, so merging a fix to `main` does not update an
 * install — someone has to press Update. A version on screen is how "the fix
 * did not work" is told apart from "the fix is not installed yet", which has
 * now cost two sessions.
 *
 * Every part of it is optional and guarded. This is the diagnostic; it does not
 * get to be the thing that breaks.
 */
async function readStatus(userId?: string): Promise<StatusResult> {
    const audit = checkPermissions(spindle.permissions)

    let host: string | undefined
    try {
        host = await spindle.version?.getBackend()
    } catch {
        host = undefined
    }

    const registered = diceTools.registered()
    const { userId: diceUser, chatId: diceChat } = diceCoordinator.current()
    const diceSettings = store.snapshot(diceUser)
    const diceMemo = diceChat ? memos.snapshot(diceChat, diceUser)?.memo : null
    const last = diceLog.last()
    // The connection a blank row runs on (89), for the open chat as the dice know it, and the output length.
    const resolved = await narratorConnection.resolve(diceChat || undefined, userId).catch(() => null)
    const maxTokens = (await prefs.load(userId).catch(() => null))?.passMaxTokens ?? 0
    const passes: StatusResult['passes'] = resolved
        ? { id: resolved.id ?? null, name: resolved.name, provider: resolved.provider, model: resolved.model, why: resolved.why, listed: resolved.listed, maxTokens }
        : undefined

    return {
        version: spindle.manifest?.version ?? '',
        ...(passes ? { passes } : {}),
        ...(host ? { host } : {}),
        granted: audit.granted,
        missing: audit.missing.map(({ name, needs }) => ({ name, needs })),
        checked: audit.checked,
        dice: {
            registered,
            absent: explainDiceTools(diceSettings as Parameters<typeof explainDiceTools>[0], diceMemo, registered),
            calls: diceLog.count(),
            ...(last ? { last } : {}),
            turn: diceLog.turn(),
        },
    }
}

const store = new SettingsStore(spindle.userStorage)

/**
 * Tracker memos, one file per chat.
 *
 * Nothing writes to this except the panel's raw memo editor yet — the
 * extraction pass that will normally fill it is the write path. What exists
 * today is the read path: a memo in, blocks and cards out.
 */
const memos = new MemoStore(spindle.userStorage)

/**
 * Finished quests, one file per chat, beside the memo.
 *
 * The tracker pass strips a quest out of the memo the turn it is completed or
 * failed — otherwise it costs context on every turn thereafter. This is where
 * they go instead, so the log can still show what the campaign has done.
 */
const questArchive = new QuestArchiveStore(spindle.userStorage)

/**
 * The memo as it stood after each turn.
 *
 * What the card under an old message is drawn from. The live memo is what is
 * true now; a card hanging off a reply from an hour ago is asking what was true
 * then, and nothing could answer that until this existed.
 */
const memoHistory = new MemoHistoryStore(spindle.userStorage)

/** The last thirty reports of the tracker and the agent, per chat (47e), for the panel's history. */
const reportHistory = new ReportHistoryStore(spindle.userStorage)

/** Keep an agent's result in the history; a failure here is logged and costs nothing else. */
function keepAgentResult(chatId: string, result: AgentRunResult, forUser: string | undefined): void {
    reportHistory.recordAgent(chatId, result, forUser).catch((error: unknown) => {
        spindle.log.warn(`could not keep the agent report in the history: ${describeError(error)}`)
    })
}

/**
 * World Progression's per-chat record (roadmap row 8): the clock it last
 * fired at, the location watermarks, and the reports the narrator is shown.
 * The reports themselves are in the campaign's `_World` lorebook.
 */
const worldState = new WorldStore(spindle.userStorage)
/** The Player Card per chat (row 10, Phase 35b). */
const playerCards = new PlayerCardStore(spindle.userStorage)
/** The hidden map's window per chat (row 9, Phase 34): rebuilt after every reply, read by the interceptor. */
const mapState = new MapStore(spindle.userStorage)

/**
 * Display preferences — what this install wants to see, as against what the
 * game is. Kept out of the cartridge deliberately; see `prefs-store.ts`.
 */
const prefs = new PrefsStore(spindle.userStorage)

/**
 * Which picture belongs to which entity, per chat.
 *
 * Only the reference lives here; the bytes go to the host's image store, which
 * is what the legacy eventually had to migrate to after embedding a generation
 * of data URLs in its settings file.
 */
// Every portrait write is announced from the store, whoever wrote it (43-bis):
// the panel and the cards under every message keep their own copy of the map.
const portraits = new PortraitStore(spindle.userStorage, {
    onChange: (chatId, record, userId) => {
        spindle.sendToFrontend(
            { channel: CHANNEL, kind: 'event', name: 'portraits.changed', data: { chatId, portraits: record.portraits } },
            userId,
        )
    },
})

/**
 * The relationship system (Phase 44, roadmap row 86): each NPC's friendship
 * and affection, per chat, and every way they move. Announced from the store
 * (lesson 47), so the fold redraws whoever moved a value.
 */
const relationshipStore = new RelationshipStore(spindle.userStorage, {
    onChange: (chatId, _record, userId) => {
        spindle.sendToFrontend({ channel: CHANNEL, kind: 'event', name: 'relationships.changed', data: { chatId } }, userId)
    },
})
const relationships = createRelationships({
    store: relationshipStore,
    settings: store,
    prefs,
    books: (userId) => loreStore(userId),
    messages: async (chatId) => (await spindle.chat.getMessages(chatId)).map((m) => ({ id: String(m.id ?? ''), role: m.role, content: String(m.content ?? '') })),
    log: spindle.log,
    // The float feedback (78c): the tracker's and the narrator's awards, as they are placed, for the panel to float.
    onAwards: (chatId, awards, userId) => {
        spindle.sendToFrontend({ channel: CHANNEL, kind: 'event', name: 'relationships.awarded', data: { chatId, awards } }, userId)
    },
})

/**
 * The world-book slice the Lorebook Agent reads and writes through.
 *
 * Built per request so it can carry the caller's `userId` — every one of these
 * is gated by `world_books`, and a gated call without a user fails silently on
 * an operator-scoped install (rule 3f).
 */
// A book made once by name (66): every maker lists, finds none and creates,
// and a list read before a long run is stale — the agent made `_LOC` while
// the architect was drawing, and the architect made a twin. One make per
// name and user, listed afresh before the host is asked.
const makeBook = createBookMaker({
    list: async (userId) => (await spindle.world_books.list({ limit: 200, userId })).data.map((book) => ({ id: book.id, name: book.name })),
    create: async (name, userId) => {
        const made = await spindle.world_books.create({ name }, userId)
        return { id: made.id, name: made.name }
    },
    log: spindle.log,
})

function loreStore(userId: string | undefined): LoreStore {
    const books = spindle.world_books
    return {
        listBooks: async () => {
            const page = await books.list({ limit: 200, userId })
            return page.data.map((book) => ({ id: book.id, name: book.name }))
        },
        createBook: (name) => makeBook(name, userId),
        listEntries: async (bookId) => {
            const page = await books.entries.list(bookId, { limit: 500, userId })
            return page.data.map((entry) => ({
                id: entry.id,
                uid: String(entry.uid),
                key: entry.key ?? [],
                content: entry.content ?? '',
                comment: entry.comment ?? '',
            }))
        },
        createEntry: async (bookId, entry) => {
            const made = await books.entries.create(bookId, entry, userId)
            return {
                id: made.id,
                uid: String(made.uid),
                key: made.key ?? [],
                content: made.content ?? '',
                comment: made.comment ?? '',
            }
        },
        updateEntry: (entryId, patch) => books.entries.update(entryId, patch, userId),
        deleteEntry: (entryId) => books.entries.delete(entryId, userId),
        // Only an undo uses this, and only on a book the pass itself created
        // (9b). The writer has no path that deletes a book.
        deleteBook: (bookId: string) => books.delete(bookId, userId),
    }
}


/** The pass report, in the shape the panel's protocol expects. */
function toAgentRunResult(report: AgentPassReport): AgentRunResult {
    return {
        at: report.at,
        outcome: report.outcome,
        summary: report.summary,
        steps: report.steps.map((step) => ({ ...step })),
        turnsUsed: report.turnsUsed,
        write: report.write
            ? {
                  changed: report.write.changed,
                  deleted: report.write.deleted,
                  createdBooks: report.write.createdBooks,
                  refused: report.write.refused,
              }
            : undefined,
        problems: report.problems,
    }
}

/**
 * Macro-resolving generation wrappers.
 *
 * The tracker pass below is the first caller. Nothing anywhere reaches
 * `spindle.generate.*` directly — those do not resolve macros, so `{{char}}`
 * would arrive at the model literally with no error (R1).
 */
/**
 * The narrator's connection (89): what a blank connection row runs on — the
 * chat's own, the one seen writing the last reply, Lumiverse's default-ticked
 * one, the first listed — remembered per user in the preferences.
 */
const narratorConnection = createNarratorConnection({
    listConnections: async (userId) => (await spindle.connections.list(userId)).map((profile) => ({
        id: profile.id, name: profile.name, provider: profile.provider, model: profile.model, isDefault: profile.is_default,
    })),
    chatConnection: async (chatId, userId) => {
        const chat = await spindle.chats.get(chatId, userId)
        const pinned = chat?.metadata?.connection_profile_id
        return typeof pinned === 'string' && pinned.trim() ? pinned.trim() : null
    },
    seen: {
        load: (userId) => prefs.load(userId).then((p) => p.narratorConnectionSeen),
        save: (userId, id) => prefs.patch({ narratorConnectionSeen: id }, userId).then(() => undefined),
    },
    log: spindle.log,
})

export const generation = createGeneration({
    generate: spindle.generate,
    macros: spindle.macros,
    log: spindle.log,
    // Multihog's Debug Mode (72a): the full prompt and reply of every call in the Server Logs while the preference is on.
    debug: (userId) => prefs.load(userId).then((p) => p.debugLogging === true),
    // A blank connection is the narrator's (89), and the output length is the preference's.
    connection: (chatId, userId) => narratorConnection.resolve(chatId, userId),
    maxTokens: (userId) => prefs.load(userId).then((p) => p.passMaxTokens),
})

/**
 * The interceptor, serving the rulebook, this turn's dice and the memo into
 * each generation's prompt.
 *
 * All three providers are synchronous by contract: they read what is already in
 * memory or inject nothing. Every millisecond spent here is silence the user
 * watches before the first token (R4). Macro substitution is the one awaited
 * step, so `{{user}}` in an authored section reaches the model as a name.
 */

/** A settings bag with the Map Architect's opener on it (46): a preference, read from memory, that the rulebook and the choices both read. */
function withOpener<T extends Record<string, unknown>>(settings: T | null, userId: string | undefined): (T & { mapArchitectOpener: 'tool' | 'text' }) | null {
    if (!settings) return null
    return { ...settings, mapArchitectOpener: prefs.snapshot(userId)?.mapArchitectOpener ?? 'tool' }
}

const stateInjection = composeInjectionProviders(
        stateInjectionProviders({
            memo: createMemoInjection({ memos, log: spindle.log }),
            // The Player Card (row 10, 35b), after the rulebook and before everything else: who the player is.
            player: createPlayerCardInjection({
                state: (chatId, userId) => playerCards.snapshot(chatId, userId),
                warm: (chatId, userId) => playerCards.load(chatId, userId),
            }),
            // The standings (44), after the player as the legacy's [NPC_RELATIONS] sits.
            relations: createRelationsInjection({ block: (chatId, userId) => relationships.block(chatId, userId) }),
            sysprompt: createSyspromptInjection({
                // With the preferred scale on it, so the narrator's tier text names the right range (44),
                // and the architect's opener (46), so the mapping section carries the text rules when asked.
                settings: (userId) => withOpener(relationships.rulebookSettings(store.snapshot(userId), userId), userId),
                memo: (chatId, userId) => memos.snapshot(chatId, userId)?.memo,
            }),
            dice: createDiceInjection({
                settings: (userId) => store.snapshot(userId) ?? null,
                memo: (chatId, userId) => memos.snapshot(chatId, userId)?.memo,
            }),
            // The choice instruction, above the dice (roadmap row 6). Its
            // history trim is `rewriteHistory` on the interceptor below.
            cyoa: createCyoaInjection({
                settings: (userId) => withOpener(store.snapshot(userId) ?? null, userId),
            }),
            // The world's newest reports, after the memo (roadmap row 8).
            // Both reads are from memory: the record the last pass left and
            // the preferences the last request loaded.
            world: createWorldInjection({
                state: (chatId, userId) => worldState.snapshot(chatId, userId),
                enabled: (userId) => prefs.snapshot(userId)?.worldProgressionEnabled ?? false,
            }),
            // The mapped sites and the active site's map, last (row 9). The
            // sync leaves the blocks rendered; an off switch leaves them empty.
            map: createMapInjection({ state: (chatId, userId) => mapState.snapshot(chatId, userId) }),
        }),
    spindle.log,
)

/**
 * The dice tool the narrator calls by name (roadmap row 3).
 *
 * Registration is extension-wide and the invocation names no user, so the
 * operator's settings decide: whichever user the panel or the last generation
 * spoke for. It is brought into step at startup, before every generation (in
 * the interceptor, so the first reply of a session has it), after every panel
 * request (a mode change registers or removes it at once) and after every
 * tracker pass (in hybrid mode the tool leaves during combat and returns
 * after it, as in Multihog).
 */
const diceTools = createDiceToolSync(spindle, spindle.log)
const diceLog = createDiceLog()
const diceCoordinator = createDiceToolCoordinator({
    settings: (userId) => ({ ...(store.snapshot(userId) ?? {}), legacyDiceNaming: prefs.snapshot(userId)?.legacyDiceNaming === true }) as Parameters<typeof diceTools.sync>[0],
    memo: (chatId, userId) => memos.snapshot(chatId, userId)?.memo,
    tools: diceTools,
})

function syncDiceTools(userId: string | undefined, chatId?: string, opts?: { reassert?: boolean }): void {
    diceCoordinator.sync(userId, chatId, opts)
}

void store.load(undefined).then(() => syncDiceTools(undefined)).catch(() => undefined)

const disposeToolInvocation = spindle.on('TOOL_INVOCATION', (payload) => {
    const diceUser = diceCoordinator.current().userId
    // The map tool (row 9): the chat and user are the last generation's, as
    // the dice tool's are; the invocation names neither.
    if (payload.toolName === CREATE_AREA_MAP_TOOL_NAME) {
        const chatId = diceCoordinator.current().chatId
        if (!chatId) {
            spindle.log.warn('map: CreateAreaMap called before any generation named a chat; refused')
            return '[MAP_ARCHITECT_ERROR — PRIVATE]\nNo chat is known for this call. Nothing was generated or saved.\n[/MAP_ARCHITECT_ERROR]'
        }
        // Answered at once: the host times the invocation out long before two
        // model calls return (lesson 41). The drawing goes on behind the reply.
        return mapArchitect.answer({ chatId, userId: diceUser, args: payload.args ?? {} })
    }
    const settings = store.snapshot(diceUser) ?? {}
    const result = handleDiceToolInvocation(payload, {
        d100Mode: !!settings.diceD100Mode,
        // A preference since 72b (the legacy's *Legacy Dice Logic*), not a cartridge key.
        legacyDiceNaming: prefs.snapshot(diceUser)?.legacyDiceNaming === true,
    })
    if (result === undefined) return undefined

    // The one place a tool call is visible: the log, and the status line.
    const record = diceLog.record(payload, result)
    spindle.log.info(`dice: ${payload.toolName} ${JSON.stringify(payload.args ?? {})} -> ${result}`)
    if (diceUser !== undefined) {
        spindle.sendToFrontend({ channel: CHANNEL, kind: 'event', name: 'dice.rolled', data: record }, diceUser)
    }
    return result
})

const disposeInterceptor = registerStateInterceptor({
    host: spindle,
    log: spindle.log,
    // CYOA mode: the narrator's older choice blocks come out of the history,
    // keeping the newest four as format examples, as the legacy does whenever
    // the mode is on and `stripOldChoicesFromPrompt` is not off.
    rewriteHistory: (messages, context) => {
        const settings = store.snapshot(context.userId)
        if (!settings || !isCyoaActive(settings)) return messages
        const config = settings.cyoaConfig as { stripOldChoicesFromPrompt?: boolean } | undefined
        if (config?.stripOldChoicesFromPrompt === false) return messages
        return stripSupersededChoices(messages)
    },
    getInjection: (context) => {
        // The reply's connection (89), remembered for the passes whose row is blank.
        narratorConnection.seen(context as Parameters<typeof narratorConnection.seen>[0])
        // The master power (72b, the legacy's ⏻): off, nothing is injected and
        // the map tool is taken back; the dice tool stays registered, harmless.
        if (prefs.snapshot(context.userId)?.frameworkEnabled === false) {
            if (!context.isDryRun) spindle.log.info('framework: off; nothing injected into this reply')
            mapTool.sync(false)
            return null
        }
        // Asserted afresh, not merely checked: the host's registrations and
        // ours can drift and the drift is invisible (Phase 28c).
        syncDiceTools(context.userId, context.chatId, { reassert: !context.isDryRun })
        void syncMapTool(context.userId, { reassert: !context.isDryRun })
        // A real generation is a new reply; a dry run is a token count.
        if (!context.isDryRun) diceLog.beginTurn()
        return stateInjection(context)
    },
    resolveMacros: async (text, context) => {
        const { text: resolved } = await spindle.macros.resolve(text, {
            userId: context.userId,
            chatId: context.chatId,
        })
        return resolved
    },
})

/**
 * The tracker pass, run after each reply.
 *
 * `GENERATION_ENDED` and not the interceptor, deliberately: this is a whole
 * extra model call, and it belongs in the window where the user is reading the
 * reply that just arrived rather than in the one where they are waiting for it.
 * `generate.quiet` does not re-enter the interceptor chain, so the pass cannot
 * trigger itself.
 */
/**
 * The passes running right now, so the panel's Stop button has something to
 * stop. Both kinds are sequences of model calls and neither could be
 * interrupted before this.
 */
const inFlight = new InFlightPasses()
/** The undone passes a redo can write back (71c), per chat, in memory as the legacy keeps them; a pass starting empties the chat's. */
const redoStack = createRedoStack()

/**
 * The terminal (71b): every pass's steps, kept per chat and crossed to the
 * frontend as they happen, one feed per agent.
 */
const terminal = createTerminal({
    send: (chatId, userId, step) => {
        spindle.sendToFrontend({ channel: CHANNEL, kind: 'event', name: 'terminal.step', data: { chatId, step } }, userId)
    },
})

const trackerPass = createTrackerPass({
    steps: (chatId, userId) => terminal.bind('state_tracker', chatId, userId),
    chat: spindle.chat,
    settings: store,
    memos,
    archive: questArchive,
    history: memoHistory,
    reports: reportHistory,
    generate: generation,
    signal: (chatId) => inFlight.current('tracker', chatId),
    // The history context and the swipe rollback (72b), both preferences.
    historyStates: async (userId) => (await prefs.load(userId)).trackerHistoryStates,
    // The User Prompt Suffix (72c), a preference; blank is the pin's line.
    outputSuffix: async (userId) => (await prefs.load(userId)).trackerUserPromptSuffix,
    // Full Review Mode (73c), a preference: the built-in pair in place of both.
    fullReview: async (userId) => (await prefs.load(userId)).trackerFullReviewMode === true,
    // The lorebooks into the tracker (73h), two preferences: the switch and the filter's names, read per pass.
    worldLore: createWorldLoreReader({
        prefs: async (userId) => { const p = await prefs.load(userId); return { inject: p.trackerInjectLorebooks === true, filter: Array.isArray(p.trackerLorebookFilter) ? p.trackerLorebookFilter : [] } },
        // With no book ticked, the books the host would scan for the chat (73h-bis, departure 121), never the whole library.
        attached: (chatId, userId) => campaignBooks.attached(chatId, userId),
        store: worldBookStore,
        log: spindle.log,
    }),
    swipeRollback: async (userId) => (await prefs.load(userId)).trackerSwipeRollback !== false,
    // The model this pass runs on, if the user picked one. Multihog had this
    // per subsystem and the port lost it, so every utility call ran on the
    // model writing the story.
    // Which model this pass runs on, and how much story it reads. Both built by
    // a tested function rather than written out here: this file has no tests,
    // and a setting that never arrives has been invisible to the suite three
    // times now.
    ...trackerPassResolvers((userId) => prefs.load(userId)),
    // The relationship system (44): the [RELATIONS] instruction and block, in tracker mode.
    relationships: {
        instruction: (userId) => relationships.trackerInstruction(userId),
        extract: (text, userId) => relationships.extract(text, userId),
        apply: (chatId, userId, commands, options) => relationships.apply(chatId, userId, commands, options),
    },
    log: spindle.log,
    // Fires the moment a pass begins, so the panel can say a pass is running
    // rather than leaving the user to guess from a report that has not moved.
    // The automatic pass after a reply had no visible start at all until now.
    onPassStart: ({ chatId, userId, at, trigger }) => {
        // Registered here rather than at the call sites because a pass starts
        // in three places (a reply, the button, a retrack) and all three should
        // be stoppable.
        inFlight.begin('tracker', chatId)
        spindle.sendToFrontend(
            { channel: CHANNEL, kind: 'event', name: 'tracker.started', data: { chatId, at, trigger } },
            userId,
        )
    },
    // Fires on every pass, including the ones that changed nothing. The panel
    // needs to be able to say "it ran and found nothing" as well as "it ran".
    onPassComplete: ({ chatId, userId, memo, report, delta, archivedQuests, messageId }) => {
        const signal = inFlight.current('tracker', chatId)
        if (signal) inFlight.end('tracker', chatId, signal)
        spindle.sendToFrontend(
            {
                channel: CHANNEL,
                kind: 'event',
                name: 'tracker.changed',
                // The archive rides along with the memo: the panel redraws the
                // whole card from this event, and the finished quests are not
                // in the memo to be redrawn from.
                data: { chatId, memo, report, delta, archivedQuests, messageId },
            },
            userId,
        )
        // The portraits drawn as they appear (61): the check after every pass, behind the reply.
        void portraitAuto.check(chatId, userId).catch((error: unknown) => {
            spindle.log.warn(`portraits: the check after the tracker pass threw: ${describeError(error)}`)
        })
    },
})

/**
 * The character creator (Phase 35): the sheet, written through the tracker's
 * direct pass in modules-only mode on the creator's connection.
 */
/**
 * The Player Card and the persona (row 10, Phase 35b): the card written on the
 * creator's connection (or the agent's), kept per chat; the persona through
 * the host's API, which needs the `personas` grant. The grant is checked at
 * each call, so a permission granted after startup takes without a restart.
 */
const playerCard = createPlayerCard({
    store: playerCards,
    memos,
    settings: store,
    prefs,
    generate: async (messages, chatId, userId, connectionId) =>
        readGenerationText(
            await generation.quiet({
                messages,
                chatId,
                userId,
                ...connectionField(connectionId || (await prefs.load(userId)).agentConnectionId || undefined),
            }),
        ),
    story: async (chatId, _userId, lookback) =>
        (await spindle.chat.getMessages(chatId))
            .slice(-Math.max(lookback * 3, lookback))
            .map((m) => ({ user: m.role === 'user', name: m.role === 'user' ? 'Player' : String(m.name || 'Narrator'), text: narrativeText(m).trim() })),
    personas: {
        list: async (userId) => (await spindle.personas.list({ limit: 500, ...(userId ? { userId } : {}) })).data.map((p) => ({ id: p.id, name: p.name })),
        create: async (name, userId) => { const p = await spindle.personas.create({ name, description: '' }, userId); return { id: p.id, name: p.name } },
        switchActive: (id, userId) => spindle.personas.switchActive(id, userId),
        getActive: async (userId) => { const p = await spindle.personas.getActive(userId); return p ? { id: p.id, name: p.name, description: p.description } : null },
    },
    log: spindle.log,
})

const npcLibraryStore = new NpcLibraryStore(spindle.userStorage)
const npcLibrary = createNpcLibrary({
    store: npcLibraryStore,
    trackerPass,
    prefs,
    books: (userId) => loreStore(userId),
    portraits,
    images: { uploadFromDataUrl: (dataUrl, filename, userId) => spindle.images.uploadFromDataUrl(dataUrl, filename, userId) },
    // A card's photo drawn (60): the prompt on the portrait's text connection (61; the agent's when none is
    // chosen) with no chat behind it, then the host's image generation, as the scene picture's (49). The
    // grant is checked at the call (image_gen).
    generate: async (system, user, chatId, userId) => {
        const p = await prefs.load(userId)
        return readGenerationText(
            await generation.quiet({
                messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
                ...(chatId ? { chatId } : {}),
                userId,
                ...connectionField(p.portraitPromptConnectionId || p.agentConnectionId || undefined),
            }),
        )
    },
    imageGen: {
        generate: (input) => spindle.imageGen.generate(input),
        listConnections: (userId) => spindle.imageGen.listConnections(userId),
        getProviders: (userId) => spindle.imageGen.getProviders(userId),
    },
    // A card saved from the character editor (48): the same reader the NPC creator uses, below.
    characters: { get: readCharacterCard },
    // The party module's text, for the cap a refused seat is read against (53-bis).
    settings: store,
    playerCard,
    // A photo's draw announced (60-bis), for the head's Picture light.
    events: {
        started: (chatId, userId, name, at) =>
            spindle.sendToFrontend({ channel: CHANNEL, kind: 'event', name: 'library.photo.started', data: { chatId, name, at } }, userId),
        finished: (chatId, userId, report) =>
            spindle.sendToFrontend({ channel: CHANNEL, kind: 'event', name: 'library.photo.finished', data: { chatId, ...report } }, userId),
    },
    log: spindle.log,
})

/**
 * A host character card with its picture's address (41a, 43): the image the
 * host keeps for it, read by id, so a card's avatar can be a portrait. The
 * grant is checked at the call; a picture that cannot be read is `''`.
 */
async function readCharacterCard(id: string, userId: string | undefined): Promise<{ id: string; name: string; description: string; personality: string; avatar: string; extensions: Record<string, unknown> } | null> {
    const c = await spindle.characters.get(id, userId)
    if (!c) return null
    let avatar = ''
    if (c.image_id) {
        try {
            avatar = (await spindle.images.get(c.image_id, userId))?.url ?? ''
        } catch (error) {
            spindle.log.warn(`cards: the avatar of "${c.name}" could not be read: ${describeError(error)}`)
        }
    }
    return { id: c.id, name: c.name, description: c.description, personality: c.personality, avatar, extensions: c.extensions ?? {} }
}

// The NPC creator (41a): a card, a record, a concept or an archetype into the campaign's NPC book.
const npcCreator = createNpcCreator({
    settings: store,
    memos,
    prefs,
    books: (userId) => loreStore(userId),
    ownership: {
        get: async (chat, who) => (await prefs.load(who)).campaignBooks?.[chat] ?? [],
        set: (chat, books, who) => recordCampaignBooks(chat, books, who),
        made: (chat, names, who) => recordBooksMade(chat, names, who),
    },
    // The card with its picture's address, for the portrait; the grant is checked at the call.
    characters: { get: readCharacterCard },
    library: npcLibraryStore,
    generate: async (messages, chatId, userId) =>
        readGenerationText(
            await generation.quiet({
                messages,
                chatId,
                userId,
                ...connectionField((await prefs.load(userId)).agentConnectionId || undefined),
            }),
        ),
    recent: async (chatId, _userId, count) =>
        (await spindle.chat.getMessages(chatId))
            .slice(-count)
            .map((m) => ({ user: m.role === 'user', name: m.role === 'user' ? 'Player' : String(m.name || 'Narrator'), text: narrativeText(m).trim() })),
    portraits,
    log: spindle.log,
})

// The scene view (42): where the party is and who is present, read from the chat and the campaign's books.
// Self-named campaigns (51): the chat's campaign name minted from the card
// and the clock, through the same card reader the creator uses.
const campaignNamer = createCampaignNamer({
    prefs,
    characters: { get: readCharacterCard },
    // The chat's own record, for its card (51-bis): the panel's view of the
    // active chat has no card for a chat just made. The grant is checked at the call.
    chats: {
        get: async (chatId, userId) => {
            const chat = await spindle.chats.get(chatId, userId)
            return chat ? { characterId: chat.character_id || null } : null
        },
    },
    log: spindle.log,
})

const scene = createScene({
    messages: async (chatId) => (await spindle.chat.getMessages(chatId)).map((m) => ({ role: m.role, content: String(m.content ?? '') })),
    memos,
    prefs,
    books: (userId) => loreStore(userId),
    portraits,
    playerCard,
    mapState,
    log: spindle.log,
})

// The scene picture (49): the legacy's Real-Time Mode through the host's
// image generation, the prompt written on the agent's connection.
const sceneArt = createSceneArt({
    scene,
    settings: store,
    prefs,
    messages: async (chatId) => (await spindle.chat.getMessages(chatId)).map((m) => ({ role: m.role, content: String(m.content ?? '') })),
    portraits,
    generate: async (system, user, chatId, userId) =>
        readGenerationText(
            await generation.quiet({
                messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
                chatId,
                userId,
                ...connectionField(await (async () => { const p = await prefs.load(userId); return p.portraitPromptConnectionId || p.agentConnectionId || undefined })()),
            }),
        ),
    // The grant is checked at the call (image_gen).
    imageGen: {
        generate: (input) => spindle.imageGen.generate(input),
        listConnections: (userId) => spindle.imageGen.listConnections(userId),
    },
    images: {
        uploadFromDataUrl: (dataUrl, options) => spindle.images.uploadFromDataUrl(dataUrl, options),
    },
    persona: async (userId) => {
        const p = await spindle.personas.getActive(userId)
        return p ? { description: p.description } : null
    },
    // The narrator's card through the chat's record (51-bis) and the card reader.
    narrator: async (chatId, userId) => {
        const chat = await spindle.chats.get(chatId, userId)
        const card = chat?.character_id ? await readCharacterCard(chat.character_id, userId) : null
        return card ? { id: card.id, name: card.name, description: card.description } : null
    },
    events: {
        started: (chatId, userId, path, at) =>
            spindle.sendToFrontend({ channel: CHANNEL, kind: 'event', name: 'scene.picture.started', data: { chatId, path, at } }, userId),
        finished: (chatId, userId, report) =>
            spindle.sendToFrontend({ channel: CHANNEL, kind: 'event', name: 'scene.picture.finished', data: report }, userId),
    },
    log: spindle.log,
})

// The portraits drawn as they appear (61): the legacy's auto-generation, checked
// after every tracker pass and every agent pass, one draw at a time; the prompt
// on the portrait's text connection (the agent's when none is chosen), the
// picture on its image connection (the scene's when none). The grant is checked
// at the call (image_gen).
const portraitAuto = createPortraitAuto({
    memos,
    settings: store,
    prefs,
    portraits,
    generate: async (system, user, chatId, userId) => {
        const p = await prefs.load(userId)
        return readGenerationText(
            await generation.quiet({
                messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
                chatId,
                userId,
                ...connectionField(p.portraitPromptConnectionId || p.agentConnectionId || undefined),
            }),
        )
    },
    imageGen: {
        generate: (input) => spindle.imageGen.generate(input),
        listConnections: (userId) => spindle.imageGen.listConnections(userId),
        getProviders: (userId) => spindle.imageGen.getProviders(userId),
    },
    images: { uploadFromDataUrl: (dataUrl, options) => spindle.images.uploadFromDataUrl(dataUrl, options) },
    // The campaign's NPC book, as the library reads it (41): every entry with a title.
    npcs: async (chatId, userId) => {
        const p = await prefs.load(userId)
        const prefix = resolveCampaignPrefix({ chatId, override: p.campaignNames?.[chatId], anchorChatId: chatId })
        const wanted = campaignBookName(prefix, 'NPC').toLowerCase()
        const books = loreStore(userId)
        const book = (await books.listBooks()).find((b) => b.name.toLowerCase() === wanted)
        if (!book) return []
        return (await books.listEntries(book.id)).filter((e) => e.comment.trim()).map((e) => ({ name: e.comment.trim(), content: e.content, keys: e.key }))
    },
    // Every entry of the campaign's books, for the lookback's keyword match; read only when the switch is on.
    lore: async (chatId, userId) => {
        const p = await prefs.load(userId)
        const prefix = resolveCampaignPrefix({ chatId, override: p.campaignNames?.[chatId], anchorChatId: chatId }).toLowerCase()
        const books = loreStore(userId)
        const mine = (await books.listBooks()).filter((b) => b.name.toLowerCase().startsWith(`${prefix}_`))
        const out: Array<{ label: string; content: string; keys: string[] }> = []
        for (const book of mine) {
            for (const e of await books.listEntries(book.id)) out.push({ label: e.comment.trim() || e.key[0] || '', content: e.content, keys: e.key })
        }
        return out
    },
    // The story as the legacy labels a line: the speaker's name, else User or Character.
    messages: async (chatId) => (await spindle.chat.getMessages(chatId)).map((m) => ({ name: m.name || (m.is_user ? 'User' : 'Character'), text: String(m.content ?? '') })),
    persona: async (userId) => {
        const p = await spindle.personas.getActive(userId)
        return p ? { description: p.description } : null
    },
    narrator: async (chatId, userId) => {
        const chat = await spindle.chats.get(chatId, userId)
        const card = chat?.character_id ? await readCharacterCard(chat.character_id, userId) : null
        return card ? { description: card.description } : null
    },
    benchedParty: async (userId) => {
        const modules = ((await store.load(userId)).modules ?? {}) as Record<string, boolean>
        return modules['benched party'] !== false
    },
    events: {
        started: (chatId, userId, start) =>
            spindle.sendToFrontend({ channel: CHANNEL, kind: 'event', name: 'portrait.draw.started', data: { chatId, ...start } }, userId),
        finished: (chatId, userId, report) =>
            spindle.sendToFrontend({ channel: CHANNEL, kind: 'event', name: 'portrait.draw.finished', data: report }, userId),
    },
    log: spindle.log,
})

// The campaign's lorebooks and their attachment to the narrator's card (55).
// The grants are checked at the calls: chats, characters, personas, world_books.
const campaignBooks = createCampaignBooks({
    prefs,
    settings: store,
    books: (userId) => loreStore(userId),
    chats: {
        get: async (chatId, userId) => {
            const chat = await spindle.chats.get(chatId, userId)
            return chat ? { characterId: chat.character_id || null, metadata: chat.metadata ?? {} } : null
        },
        // The record's metadata whole: read, one key changed, written back (55-ter).
        setMetadata: (chatId, metadata, userId) => spindle.chats.update(chatId, { metadata }, userId),
    },
    characters: {
        get: async (id, userId) => {
            const c = await spindle.characters.get(id, userId)
            return c ? { id: c.id, name: c.name, worldBookIds: [...(c.world_book_ids ?? [])] } : null
        },
        setWorldBooks: (id, worldBookIds, userId) => spindle.characters.update(id, { world_book_ids: worldBookIds }, userId),
    },
    persona: async (userId) => {
        const p = await spindle.personas.getActive(userId)
        return p ? { attachedWorldBookId: p.attached_world_book_id ?? null } : null
    },
    global: (userId) => spindle.world_books.getGlobal(userId),
    // Adopt (56): the book recorded as the campaign's, and attached at once.
    ownership: { set: (chat, books, who) => recordCampaignBooks(chat, books, who) },
    log: spindle.log,
})

// A fork keeps its campaign (56): the host copies the messages and the
// chat record; this copies what AdventureTime keeps per chat.
const campaignFork = createCampaignFork({
    prefs,
    memos: {
        load: (chatId, userId) => memos.load(chatId, userId),
        save: (chatId, memo, userId) => memos.save(chatId, memo, userId),
    },
    memoHistory: { load: (chatId, userId) => memoHistory.load(chatId, userId) },
    portraits: {
        load: (chatId, userId) => portraits.load(chatId, userId),
        replace: (chatId, map, userId) => portraits.replace(chatId, map, userId),
    },
    playerCards: {
        load: (chatId, userId) => playerCards.load(chatId, userId),
        save: (chatId, patch, userId) => playerCards.save(chatId, patch as Parameters<typeof playerCards.save>[1], userId),
    },
    relationships: {
        load: (chatId, userId) => relationshipStore.load(chatId, userId),
        replace: (chatId, npcs, userId) => relationshipStore.replace(chatId, npcs as Parameters<typeof relationshipStore.replace>[1], userId),
    },
    log: spindle.log,
})

const disposeForkHook = spindle.on('CHAT_FORKED', (payload, userId) => {
    void campaignFork.fork(
        { sourceChatId: payload.sourceChatId, forkedChatId: payload.forkedChatId, forkedAtMessageId: payload.forkedAtMessageId, forkedAtMessageIndex: payload.forkedAtMessageIndex },
        userId,
    ).catch((error: unknown) => {
        spindle.log.error(`fork: the campaign could not be copied: ${describeError(error)}`)
    })
})

const creator = createCreator({
    trackerPass,
    settings: store,
    memos,
    prefs,
    send: async (chatId, content, _userId, personaId) => {
        // The persona just made active is named on the generation (76-ter): the host's option says it falls to the active
        // persona setting when omitted, which is the setting switchActive wrote — but the host's view had not read it yet.
        const { id } = await spindle.chat.appendMessage(chatId, { role: 'user', content }, { triggerGeneration: true, ...(personaId ? { generation: { persona_id: personaId } } : {}) })
        return { id }
    },
    playerCard,
    // The host's character cards (39), for the import list and the card picked; the grant is checked at the call.
    characters: {
        list: async (userId) => (await spindle.characters.list({ limit: 500, ...(userId ? { userId } : {}) })).data.map((c) => ({ id: c.id, name: c.name, description: c.description, personality: c.personality })),
        get: readCharacterCard,
    },
    // The imported card's avatar as the character's portrait (43).
    portraits,
    generate: async (messages, chatId, userId, connectionId) =>
        readGenerationText(
            await generation.quiet({
                messages,
                chatId,
                userId,
                ...connectionField(connectionId || (await prefs.load(userId)).agentConnectionId || undefined),
            }),
        ),
    recent: async (chatId, _userId, count) =>
        (await spindle.chat.getMessages(chatId))
            .slice(-count)
            .map((m) => ({ user: m.role === 'user', name: m.role === 'user' ? 'Player' : String(m.name || 'Narrator'), text: narrativeText(m).trim() })),
    // The active persona, with its description, for the persona way (35c). The grant is checked at the call.
    activePersona: async (userId) => {
        const p = await spindle.personas.getActive(userId)
        return p ? { name: p.name, description: p.description } : null
    },
    log: spindle.log,
})

/**
 * Generation types that replace the message a pass was built on.
 *
 * The tracker's `RETRACK_GENERATION_TYPES` for the same reason and by the same
 * rule; kept as its own list because the two answer different questions — the
 * tracker rolls its memo back one step, this undoes writes to real lorebooks.
 */
const AGENT_RETRACK_TYPES = new Set(['regenerate', 'swipe', 'continue'])

const describeError = (error: unknown): string =>
    error instanceof Error ? error.message : String(error)

/**
 * What the tracker's cadence needs from the host.
 *
 * Deliberately thin: every decision is in `tracker-cadence.ts`, which is
 * tested, and this file is the one that cannot be. A mutation deleting the
 * cadence from here still fails, because the seam is exercised end to end
 * against these same five methods.
 */
const trackerCadenceDeps: TrackerCadenceDeps = {
    roles: async (chatId) => (await spindle.chat.getMessages(chatId)).map((message) => message.role),
    runEvery: async (forUser) => (await prefs.load(forUser)).trackerRunEvery,
    readWatermark: async (chatId, forUser) => (await prefs.load(forUser)).trackerWatermarks?.[chatId] ?? 0,
    writeWatermark: async (chatId, forUser, watermark) => {
        const stored = await prefs.load(forUser)
        if ((stored.trackerWatermarks?.[chatId] ?? 0) === watermark) return
        await prefs.patch(
            { trackerWatermarks: { ...(stored.trackerWatermarks ?? {}), [chatId]: watermark } },
            forUser,
        )
    },
    run: async (request) => {
        await trackerPass.run(request)
    },
    log: (message) => spindle.log.info(message),
}

const disposeGenerationHook = spindle.on('GENERATION_ENDED', (payload, userId) => {
    // The first reply of a session is the first moment a user is known here.
    void syncChoicesDisplay(userId)
    // Logged before any early return, and with the user id, because the first
    // question when tracker state stops moving is "did the event arrive at
    // all, and for whom?" — and settings and memos are stored per user, so a
    // mismatch between this id and the panel's would leave the pass writing a
    // memo the panel never reads.
    spindle.log.info(
        `GENERATION_ENDED chat=${payload.chatId ?? 'none'} user=${userId ?? '(default)'} ` +
            `type=${payload.generationType ?? 'normal'}${payload.error ? ' error' : ''}`,
    )

    // A failed generation produced no narrative to read.
    if (payload.error || !payload.chatId) return

    const agentChatId = payload.chatId
    const generationType = payload.generationType
    const messageId = payload.messageId

    // Rollback, then tracker, then the automatic pass — in order, and never
    // concurrently. Running the rollback alongside meant both read the
    // watermark and both wrote it, so whichever landed last won: live, a swipe
    // rolled a pass back correctly and then nothing regenerated, because the
    // automatic pass wrote the stale watermark back over the primed one.
    void (async () => {
        // The master power (72b): off, no pass runs on its own; the buttons still do.
        if ((await prefs.load(userId)).frameworkEnabled === false) {
            spindle.log.info('framework: off; no pass runs after this reply')
            return
        }
        // The text opener first (46): a [CREATE_AREA_MAP] block is stripped
        // from the reply before anything else reads it, and drawn behind.
        await mapOpener.afterReply(agentChatId, userId, messageId, generationType, payload.content).catch((error: unknown) => {
            spindle.log.error(`map: text opener threw: ${describeError(error)}`)
        })
        await rollBackAgentPassOnRetrack(agentChatId, messageId, generationType, userId)
            .catch((error: unknown) => {
                spindle.log.error(`agent: rolling back on a swipe threw: ${describeError(error)}`)
            })
        // The map's update and evolution too (34b, 34c): the reply they followed is gone with the swipe.
        if (AGENT_RETRACK_TYPES.has(generationType ?? 'normal')) {
            await mapUpdater.rollBack(agentChatId, userId, messageId).catch((error: unknown) => {
                spindle.log.error(`map: rolling back on a swipe threw: ${describeError(error)}`)
            })
            await mapEvolution.rollBack(agentChatId, userId, messageId).catch((error: unknown) => {
                spindle.log.error(`map: rolling evolution back on a swipe threw: ${describeError(error)}`)
            })
        }

        // Through the cadence rather than straight to the pass. At the default
        // of 1 this runs on every reply exactly as it always has; the whole
        // decision lives in `tracker-cadence.ts` because a cadence wired here
        // would be invisible to the suite (lesson 19, three times over).
        await maybeRunTrackerPass(trackerCadenceDeps, {
            chatId: agentChatId,
            userId,
            messageId,
            generationType,
        })
            // The pass reports its own failures; this guards the handler
            // itself, which must never reject into the host.
            .catch((error: unknown) => {
                spindle.log.error(`tracker pass threw: ${describeError(error)}`)
            })

        // Regex mode (44): the narrator's own inline awards, read off the reply
        // after the tracker as the legacy orders it; a swipe puts the replaced
        // reply's awards back first. Nothing in tracker mode or when off.
        await relationships.afterReply(agentChatId, userId, messageId, generationType).catch((error: unknown) => {
            spindle.log.error(`relationships: reading the reply threw: ${describeError(error)}`)
        })

        // After the tracker, never instead of it. The tracker is the loop the
        // extension exists for and runs every turn; the agent pass is slower,
        // rarer, and must not be able to delay or fail it.
        //
        // Not on a swipe or a regenerate, which is the legacy's denylist and
        // matters more now that a rollback restores the watermark: the restored
        // value is by definition a whole cycle behind, so without this a swipe
        // would fire a pass every time — and swiping is something people do
        // five times in a row looking for a reply they like, each one writing
        // lore for an alternative they are about to discard.
        if (!AGENT_RETRACK_TYPES.has(generationType ?? 'normal')) {
            // The map first (34b), as the legacy orders it: occupancy before
            // the agent and the world, so neither moves what play just killed.
            await mapUpdater.afterReply(agentChatId, userId, messageId).catch((error: unknown) => {
                spindle.log.error(`map: updater threw: ${describeError(error)}`)
            })
            await maybeRunAgentPass(agentChatId, userId).catch((error: unknown) => {
                spindle.log.error(`agent: automatic pass threw: ${describeError(error)}`)
            })
            // After the agent, so the lore it just wrote is in the dossiers:
            // the legacy fires it after every tracker pass and holds it while
            // the agent runs, which comes to the same order.
            await worldProgression.maybeRun(agentChatId, userId).catch((error: unknown) => {
                spindle.log.error(`world: automatic pass threw: ${describeError(error)}`)
            })
            // Then evolution (34c), with the world's new report as pressure,
            // as the legacy orders them.
            await mapEvolution.afterReply(agentChatId, userId, messageId).catch((error: unknown) => {
                spindle.log.error(`map: evolution threw: ${describeError(error)}`)
            })
        }

        // The party may have moved: re-read where the footer puts them and
        // which maps the books hold, on every reply, swipes included (row 9).
        await mapSync.refresh(agentChatId, userId).catch((error: unknown) => {
            spindle.log.error(`map: sync threw: ${describeError(error)}`)
        })
        // The scene picture on its own (49), the legacy's Real-Time check
        // after every reply; the draw itself runs behind, never awaited here.
        await sceneArt.afterReply(agentChatId, userId).catch((error: unknown) => {
            spindle.log.error(`scene: the picture check threw: ${describeError(error)}`)
        })
        // A book made this turn attached to the narrator's card (55), when the preference says.
        await campaignBooks.sweep(agentChatId, userId)

        // The pass may have started or ended combat; and asserted afresh, so
        // the next generation's request holds the tool whatever the host did.
        syncDiceTools(userId, agentChatId, { reassert: true })
        void syncMapTool(userId, { reassert: true })
    })()
})

/**
 * Undo the last agent pass if this generation replaced the reply it read.
 *
 * Awaited before anything else touches the watermark. The first version ran
 * this alongside the tracker and the automatic pass, and all three read and
 * wrote the same watermark: the rollback primed it so the next reply would
 * regenerate, and the automatic pass — holding, and working from the value it
 * had read a moment earlier — wrote the stale one back on top. The rollback
 * worked and nothing regenerated, which is exactly what the maintainer saw.
 */
async function rollBackAgentPassOnRetrack(
    chatId: string,
    messageId: string | undefined,
    generationType: string | undefined,
    userId: string | undefined,
): Promise<void> {
    if (!AGENT_RETRACK_TYPES.has(generationType ?? 'normal')) return
    // The legacy's *Auto-rollback lorebook pass on swipe* (72b): off, the pass stands.
    if ((await prefs.load(userId)).agentSwipeRollback === false) {
        spindle.log.info(`agent: a ${generationType}, but the rollback switch is off; the pass stands`)
        return
    }

    const report = await undoAgentPassForMessage(chatId, messageId, userId, await agentDeps(chatId, userId))
    if (!report) return
    spindle.log.info(`agent: rolled back a pass on ${generationType}: ${report.summary}`)
    keepForRedo(chatId, report, (await prefs.load(userId)).agentWatermarks?.[chatId])

    // Undoing a pass undoes the watermark it advanced. The rolled-back pass
    // read a span of story and wrote lore for all of it; the rollback deleted
    // that lore, so the next pass has to read the *same* span again. Walking
    // back a cycle instead — which is what this did first — starts partway
    // through it, and the replies before that point are covered by no pass at
    // all, ever. The fallback is for snapshots written before this was stored.
    const settings = await prefs.load(userId)
    const messages = await spindle.chat.getMessages(chatId)
    const restored = report.watermark
        ?? watermarkAfterRollback(messages.map((m) => m.role), settings.agentRunEvery)
    await prefs.patch(
        { agentWatermarks: { ...(settings.agentWatermarks ?? {}), [chatId]: restored } },
        userId,
    )
    spindle.sendToFrontend(
        { channel: CHANNEL, kind: 'event', name: 'agent.undone', data: { ...report, chatId } },
        userId,
    )
}

/**
 * Run an agent pass because the story moved on, if it is time.
 *
 * The cadence is the legacy's: every N replies, counted from a watermark rather
 * than a tick, so a swipe cannot advance it (`backend/auto-pass.ts`). Held to
 * the same reporting as a manual pass — `agent.finished` — because a pass that
 * writes to the campaign must never be silent, and this one nobody pressed.
 */
async function maybeRunAgentPass(chatId: string, forUser: string | undefined): Promise<void> {
    const settings = await prefs.load(forUser)
    // The legacy's *Enable Lorebook Agent* (72b): off, the automatic pass is held; the button and the send bar still run one.
    if (settings.agentEnabled === false) {
        spindle.log.info('agent: automatic pass held — the agent is switched off')
        return
    }
    // The legacy's ⏸ Pause Agent (71c): the same hold, kept apart as the legacy keeps it; everything pressed still runs.
    if (settings.agentPaused === true) {
        spindle.log.info('agent: automatic pass held — the agent is paused')
        return
    }
    const messages = await spindle.chat.getMessages(chatId)
    const decision = decideAutoPass({
        roles: messages.map((message) => message.role),
        watermark: settings.agentWatermarks?.[chatId] ?? 0,
        runEvery: settings.agentRunEvery,
    })

    // Written back even when holding: the value corrects itself for a chat that
    // lost messages, and discarding that correction stops passes for good.
    const stored = settings.agentWatermarks?.[chatId] ?? 0
    if (decision.watermark !== stored) {
        await prefs.patch(
            { agentWatermarks: { ...(settings.agentWatermarks ?? {}), [chatId]: decision.watermark } },
            forUser,
        )
    }
    if (!decision.run) return

    spindle.log.info(`agent: automatic pass — ${decision.reason}`)

    const signal = inFlight.begin('agent', chatId)
    const deps = await agentDeps(chatId, forUser, signal)
    const report = await runAgentPass(chatId, forUser, {
        ...deps,
        trigger: 'automatic',
        // Only the part of the story that is new. The whole chat on a first
        // pass, where the watermark is zero and there is no "new" to speak of.
        // Or, by the window mode (72b), the current exchange or a fixed count.
        lookback: autoPassLookback(messages.map((m) => m.role), settings.agentLookbackMode, decision.lookback, settings.agentLookback),
        // The value from *before* the write above. `agentDeps` reads prefs, and
        // by now prefs holds the advanced watermark — recording that would make
        // an undo restore the position this pass moved to rather than the one
        // it moved from, which is no undo at all.
        watermark: stored,
    }).finally(() => inFlight.end('agent', chatId, signal))

    const result = toAgentRunResult(report)
    keepAgentResult(chatId, result, forUser)
    spindle.sendToFrontend(
        { channel: CHANNEL, kind: 'event', name: 'agent.finished', data: { ...result, chatId } },
        forUser,
    )
    // An NPC the pass recorded may want a portrait (61).
    void portraitAuto.check(chatId, forUser).catch((error: unknown) => {
        spindle.log.warn(`portraits: the check after the agent pass threw: ${describeError(error)}`)
    })
    // The legacy's bloat hint and auto-cleanup after a normal pass (71c).
    if (report.outcome === 'committed') void autoCleanup.after(chatId, forUser)
}

/**
 * Everything a pass needs from the host, for one chat and one user.
 *
 * Shared by `agent.run` and `agent.undo` on purpose: an undo reads the same
 * store and the same ownership list a pass wrote through, and two copies of
 * this wiring would eventually disagree about which books a campaign owns.
 */
async function agentDeps(
    chatId: string,
    forUser: string | undefined,
    /**
     * The signal this pass runs under, when there is one.
     *
     * Threaded through `generate` rather than added to the deps shape: only the
     * model calls are interruptible, and closing over it here leaves every
     * other caller — `agent.undo`, which generates nothing — unchanged.
     */
    signal?: AbortSignal,
): Promise<AgentPassDeps> {
    const settings = await prefs.load(forUser)
    return {
        store: loreStore(forUser),
        step: terminal.bind('lorebook_agent', chatId, forUser),
        generate: (messages, who) =>
            generation
                .quiet({
                    messages,
                    chatId,
                    userId: who,
                    signal,
                    ...connectionField(agentPassOptions(settings, chatId).connectionId),
                })
                .then(readGenerationText),
        narrative: async (chat, _who, lookback) =>
            formatNarrative(
                await spindle.chat.getMessages(chat),
                // 0 means the whole chat; `formatNarrative` takes a slice
                // depth, so it gets a number larger than any chat rather than
                // a special case of its own.
                lookback > 0 ? lookback : Number.MAX_SAFE_INTEGER,
            ).join('\n\n'),
        // Said before the pass starts, not only after it lands, and supplied
        // *here* so both callers get it: a pass nobody pressed took eight
        // replies to be noticed (Phase 4a's finding in a new place), and a pass
        // the user *did* press had no Stop button at all, because Phase 14 hung
        // it on a notice only the automatic path raised.
        onPassStart: ({ chatId: chat, userId: who, at, trigger }) => {
            // The books are moving on: an undone pass can no longer be written back over them (71c).
            if (trigger !== 'cleanup' || redoStack.waiting(chat)) redoStack.clear(chat)
            spindle.sendToFrontend(
                { channel: CHANNEL, kind: 'event', name: 'agent.started', data: { chatId: chat, at, trigger } },
                who,
            )
        },
        // Lookback, turn budget and watermark together, from one tested place.
        // `maxTurns` is one model call per turn made in sequence, so it is the
        // dial that decides how long a pass takes; the legacy had it as
        // `routerMaxTurns` and the port lost it.
        ...agentPassOptions(settings, chatId),
        // What ties a pass to the reply it read, so a swipe can roll it back.
        latestMessageId: async (chat, _who) => {
            const messages = await spindle.chat.getMessages(chat)
            return messages.at(-1)?.id
        },
        // The chat's Player Card (35b): the agent may patch its Body and Worn Equipment.
        playerCard: await (async () => {
            const name = await playerCard.name(chatId, forUser)
            return name ? { name, apply: (field: string, content: string) => playerCard.patch(chatId, forUser, field, content) } : null
        })(),
        // The relationship system (44): the section when on, and where `rel` goes after the write.
        relationships: {
            section: (who) => relationships.agentSection(who),
            apply: (chat, who, items, messageId) => relationships.applyAgent(chat, who, items, messageId),
        },
        // The cartridge's module instructions and the memo's mechanical blocks (45b).
        settings: (who) => store.load(who),
        memo: async (chat, who) => (await memos.load(chat, who)).memo,
        // Where the party stands (72c): the footer as the map state keeps it,
        // and the mapped site it puts them inside.
        location: async (chat, who) => {
            const record = await mapState.load(chat, who)
            return { hierarchy: String(record.currentLocation ?? ''), mappedSite: String(record.activeSiteRoot ?? '') }
        },
        // The same window, with the host's number on each line, so the model
        // can say *when* a thing happened rather than the pass assuming it
        // happened on the newest message.
        numberedNarrative: async (chat, _who, lookback) => {
            const { lines, readRange } = numberedNarrative(
                await spindle.chat.getMessages(chat),
                lookback > 0 ? lookback : Number.MAX_SAFE_INTEGER,
            )
            return { narrative: lines.join('\n\n'), readRange }
        },
        // The name the user gave this campaign, if any. Without one the prefix
        // falls back to the chat id, which is a GUID and produced a book called
        // `854ec108_1090_..._Journey` on the first live pass.
        campaign: {
            override: settings.campaignNames?.[chatId],
            anchorChatId: chatId,
        },
        ownership: {
            get: async (chat, who) => (await prefs.load(who)).campaignBooks?.[chat] ?? [],
            set: (chat, books, who) => recordCampaignBooks(chat, books, who),
            made: (chat, names, who) => recordBooksMade(chat, names, who),
            // Every book owned by some *other* chat. Hidden from this pass's
            // reads: another campaign's books are a different story's lore, not
            // background.
            others: async (chat, who) => {
                const owned = (await prefs.load(who)).campaignBooks ?? {}
                return Object.entries(owned)
                    .filter(([id]) => id !== chat)
                    .flatMap(([, books]) => books)
            },
        },
        // What makes a pass reversible. Without this a pass still runs and
        // still writes — it simply cannot be taken back, which is the state
        // this build was in until now.
        history: {
            record: (chat, snapshot, who) => recordLorePass(spindle.userStorage, chat, snapshot, who),
            latest: (chat, who) => latestLorePass(spindle.userStorage, chat, who),
            drop: (chat, who) => dropLatestLorePass(spindle.userStorage, chat, who),
        },
        log: spindle.log,
    }
}

/**
 * Close an on-demand agent pass: release the Stop, and announce the result.
 *
 * Reported as an event as well as returned, because a pass is a conversation
 * and can outlast any deadline the panel is willing to hold a button for.
 * Without this a slow pass writes to the campaign and the user is told only
 * that it timed out — which is exactly how a working tracker looked broken in
 * Phase 1d. Shared by the pressed pass and the instructed one.
 */
/**
 * The world-book slice World Progression reads and writes through: the same
 * host namespace as the agent's, with the two fields the agent never needs --
 * `disabled`, because a report must stay out of the host's keyword scan, and
 * `extensions`, where its routing metadata lives.
 */
function worldBookStore(userId: string | undefined): WorldBookStore {
    const books = spindle.world_books
    const read = (entry: { id: string; uid: string | number; key?: string[]; content?: string; comment?: string; extensions?: Record<string, unknown>; created_at?: number; disabled?: boolean; constant?: boolean }) => ({
        id: entry.id,
        uid: String(entry.uid),
        key: entry.key ?? [],
        content: entry.content ?? '',
        comment: entry.comment ?? '',
        extensions: entry.extensions ?? {},
        // The host's uids are slugs, not numbers; this is the filing order (lesson 40).
        ...(Number.isFinite(entry.created_at) ? { createdAt: Number(entry.created_at) } : {}),
        // Campaign Records (71a) show and set these two.
        disabled: entry.disabled === true,
        constant: entry.constant === true,
    })
    return {
        listBooks: async () => (await books.list({ limit: 200, userId })).data.map((book) => ({ id: book.id, name: book.name })),
        createBook: (name) => makeBook(name, userId),
        listEntries: async (bookId) => (await books.entries.list(bookId, { limit: 500, userId })).data.map(read),
        createEntry: async (bookId, entry) => read(await books.entries.create(bookId, entry, userId)),
        updateEntry: (entryId, patch) => books.entries.update(entryId, patch, userId),
        deleteEntry: (entryId) => books.entries.delete(entryId, userId),
    }
}

/** The rulebook's mapping section, the legacy's kill switch for every map feature (row 9). */
async function mappingEnabled(userId: string | undefined): Promise<boolean> {
    const cartridge = await store.load(userId)
    return isBaseSectionEnabled(MAPPING_SECTION_TAG, cartridge as Parameters<typeof isBaseSectionEnabled>[1])
}

/**
 * The map tool the narrator calls (row 9, Phase 34a), registered while the
 * mapping section is on and asserted afresh where the dice tools are.
 */
const mapTool = createMapToolSync(spindle, spindle.log)
async function syncMapTool(userId: string | undefined, opts?: { reassert?: boolean }): Promise<void> {
    try {
        // Not in text mode (46): the narrator writes the block instead, and a tool on offer would invite the call anyway.
        mapTool.sync((await mappingEnabled(userId)) && (await prefs.load(userId)).mapArchitectOpener !== 'text', opts)
    } catch (error) {
        spindle.log.warn(`map: tool sync failed: ${describeError(error)}`)
    }
}
void syncMapTool(undefined)

/** The Map Architect (row 9, Phase 34a): two model calls on the agent's connection, then a save into the campaign's place book. */
/** The architect's announcements, shared with the panel's map creation (73a) so the Maps light turns at the brief. */
const architectEvents = {
    started: (chatId: string, userId: string | undefined, site: string, at: string) =>
        spindle.sendToFrontend({ channel: CHANNEL, kind: 'event', name: 'map.architect.started', data: { chatId, site, at } }, userId),
    finished: (chatId: string, userId: string | undefined, report: MapArchitectReport) =>
        spindle.sendToFrontend({ channel: CHANNEL, kind: 'event', name: 'map.architect.finished', data: { chatId, ...report } }, userId),
}
const mapArchitect = createMapArchitect({
    store: worldBookStore,
    steps: (chatId, userId) => terminal.bind('map_architect', chatId, userId),
    generate: async (messages, chatId, userId) =>
        readGenerationText(
            await generation.quiet({
                messages,
                chatId,
                userId,
                ...connectionField(await (async () => { const p = await prefs.load(userId); return p.mapArchitectConnectionId || p.agentConnectionId || undefined })()),
            }),
        ),
    campaign: async (chatId, userId) => {
        const settings = await prefs.load(userId)
        return {
            prefix: resolveCampaignPrefix({ chatId, override: settings.campaignNames?.[chatId], anchorChatId: chatId }),
            owned: settings.campaignBooks?.[chatId] ?? [],
        }
    },
    ownership: {
        made: (chat, names, who) => recordBooksMade(chat, names, who),
    },
    // The legacy's roles, PLAYER and NARRATOR, over the last N messages; and
    // the last reply alone, for its Location footer.
    story: async (chatId, _userId, lookback) => {
        const messages = await spindle.chat.getMessages(chatId)
        const recent = lookback > 0 ? messages.slice(-lookback) : []
        const lines = recent
            .map((m) => { const text = narrativeText(m).trim(); return text ? `${m.role === 'user' ? 'PLAYER' : 'NARRATOR'}: ${text}` : '' })
            .filter(Boolean)
        const last = [...messages].reverse().find((m) => m.role === 'assistant')
        return { lines, lastReply: last ? narrativeText(last) : '' }
    },
    memo: async (chatId, userId) => (await memos.load(chatId, userId)).memo,
    options: async (userId) => {
        const settings = await prefs.load(userId)
        return { lookback: settings.mapArchitectLookback, systemPrompt: settings.mapArchitectSystemPrompt }
    },
    enabled: mappingEnabled,
    state: mapState,
    refresh: (chatId, userId) => mapSync.refresh(chatId, userId),
    events: architectEvents,
    log: spindle.log,
})

/** The text opener (46): the block in the prose, stripped and drawn after the reply. */
const mapOpener = createMapOpener({
    enabled: mappingEnabled,
    architect: mapArchitect,
    state: mapState,
    updateMessage: (chatId, messageId, content) => spindle.chat.updateMessage(chatId, messageId, { content }),
    log: spindle.log,
})

/**
 * The hidden map (roadmap row 9, Phase 34): after every reply, find which of
 * the campaign's Location entries carry a `[MAP]`, where the footer puts the
 * party, and render the two blocks the narrator is sent.
 */
const mapSync = createMapSync({
    store: worldBookStore,
    campaign: async (chatId, userId) => {
        const settings = await prefs.load(userId)
        return {
            prefix: resolveCampaignPrefix({ chatId, override: settings.campaignNames?.[chatId], anchorChatId: chatId }),
            owned: settings.campaignBooks?.[chatId] ?? [],
        }
    },
    lastTurn: async (chatId) => {
        const messages = await spindle.chat.getMessages(chatId)
        const reply = [...messages].reverse().find((m) => m.role === 'assistant')
        const user = [...messages].reverse().find((m) => m.role === 'user')
        return { reply: reply ? narrativeText(reply) : '', userText: user ? String(user.content ?? '') : '' }
    },
    enabled: mappingEnabled,
    // The site's recent off-screen life, from the ledgers evolution and the
    // updater keep (34c), within the briefing budget the user set.
    activity: async (chatId, userId, siteRoot) => {
        const record = await mapState.load(chatId, userId)
        const settings = await prefs.load(userId)
        return narratorSiteActivity(record.threadsBySite as never, record.evolution.backlogBySite as never, siteRoot, settings.mapEvolutionNarratorCommitTokens, record.evolution.lastFiredBySite)
    },
    state: mapState,
    log: spindle.log,
})

/** Campaign Records (71a): the campaign's books and their entries, read and written from the panel; the raw map editor with them. */
const campaignRecords = createCampaignRecords({
    store: worldBookStore,
    campaign: async (chatId, userId) => {
        const settings = await prefs.load(userId)
        return {
            prefix: resolveCampaignPrefix({ chatId, override: settings.campaignNames?.[chatId], anchorChatId: chatId }),
            owned: settings.campaignBooks?.[chatId] ?? [],
        }
    },
    mapping: { enabled: mappingEnabled, state: mapState, refresh: (chatId, userId) => mapSync.refresh(chatId, userId) },
    log: spindle.log,
})

/** A map made from the panel (71a): Auto's brief on the agent's connection, then the architect. */
const mapCreation = createMapCreation({
    architect: mapArchitect,
    events: architectEvents,
    steps: (chatId, userId) => terminal.bind('map_architect', chatId, userId),
    generate: async (messages, chatId, userId) =>
        readGenerationText(
            await generation.quiet({
                messages,
                chatId,
                userId,
                ...connectionField(await (async () => { const p = await prefs.load(userId); return p.mapArchitectConnectionId || p.agentConnectionId || undefined })()),
            }),
        ),
    store: worldBookStore,
    campaign: async (chatId, userId) => {
        const settings = await prefs.load(userId)
        return {
            prefix: resolveCampaignPrefix({ chatId, override: settings.campaignNames?.[chatId], anchorChatId: chatId }),
            owned: settings.campaignBooks?.[chatId] ?? [],
        }
    },
    story: async (chatId, _userId, lookback) => {
        const messages = await spindle.chat.getMessages(chatId)
        const recent = lookback > 0 ? messages.slice(-lookback) : []
        const lines = recent
            .map((m) => { const text = narrativeText(m).trim(); return text ? `${m.role === 'user' ? 'PLAYER' : 'NARRATOR'}: ${text}` : '' })
            .filter(Boolean)
        const last = [...messages].reverse().find((m) => m.role === 'assistant')
        return { lines, lastReply: last ? narrativeText(last) : '' }
    },
    options: async (userId) => {
        const settings = await prefs.load(userId)
        return { lookback: settings.mapArchitectLookback, systemPrompt: settings.mapArchitectSystemPrompt }
    },
    enabled: mappingEnabled,
    state: mapState,
    // The reference cards (71a): the six fields the legacy sends, read by id through the `characters` grant.
    cards: async (userId, ids) => {
        const out: Array<{ name: string; description?: string; personality?: string; scenario?: string; mesExample?: string; firstMessage?: string; creatorNotes?: string }> = []
        for (const id of ids) {
            const c = await spindle.characters.get(id, userId)
            if (c) out.push({ name: c.name, description: c.description, personality: c.personality, scenario: c.scenario, mesExample: c.mes_example, firstMessage: c.first_mes, creatorNotes: c.creator_notes })
        }
        return out
    },
    log: spindle.log,
})

/**
 * The map on screen (34d): the party's site, or a named one, drawn as the
 * player may see it, under the user's Reveal all.
 */
const mapView = createMapView({
    store: worldBookStore,
    campaign: async (chatId, userId) => {
        const settings = await prefs.load(userId)
        return {
            prefix: resolveCampaignPrefix({ chatId, override: settings.campaignNames?.[chatId], anchorChatId: chatId }),
            owned: settings.campaignBooks?.[chatId] ?? [],
        }
    },
    revealAll: async (userId) => (await prefs.load(userId)).mapRevealAll,
    state: mapState,
    log: spindle.log,
})

/**
 * Map Evolution (row 9, Phase 34c): after the world has had its turn, the
 * sites the party is not in move on their own clocks, on the agent's
 * connection.
 */
const mapEvolution = createMapEvolution({
    store: worldBookStore,
    steps: (chatId, userId) => terminal.bind('map_evolution', chatId, userId),
    // Its own connection since 45c (upstream 2026.8.68), the agent's when none is chosen.
    generate: async (messages, chatId, userId) => {
        const settings = await prefs.load(userId)
        return readGenerationText(
            await generation.quiet({
                messages,
                chatId,
                userId,
                ...connectionField(settings.mapEvolutionConnectionId || settings.agentConnectionId || undefined),
            }),
        )
    },
    campaign: async (chatId, userId) => {
        const settings = await prefs.load(userId)
        return {
            prefix: resolveCampaignPrefix({ chatId, override: settings.campaignNames?.[chatId], anchorChatId: chatId }),
            owned: settings.campaignBooks?.[chatId] ?? [],
        }
    },
    lastReply: async (chatId) => {
        const reply = [...(await spindle.chat.getMessages(chatId))].reverse().find((m) => m.role === 'assistant')
        return reply ? narrativeText(reply) : ''
    },
    memo: async (chatId, userId) => (await memos.load(chatId, userId)).memo,
    // The recent story (45c): the chat from the Nth user message back, as the legacy's window chooses it.
    recentStory: async (chatId, _userId, turns) => formatRecentStory(await spindle.chat.getMessages(chatId), turns),
    options: async (userId) => evolutionOptions(await prefs.load(userId)),
    enabled: mappingEnabled,
    state: mapState,
    refresh: (chatId, userId) => mapSync.refresh(chatId, userId),
    events: {
        started: (chatId, userId, sites, at, trigger) =>
            spindle.sendToFrontend({ channel: CHANNEL, kind: 'event', name: 'map.evolution.started', data: { chatId, sites, at, trigger } }, userId),
        finished: (chatId, userId, report) =>
            spindle.sendToFrontend({ channel: CHANNEL, kind: 'event', name: 'map.evolution.finished', data: { chatId, ...report } }, userId),
    },
    log: spindle.log,
})

/** The Testing Ground (71d): Map Evolution's sandbox on one site, the memo's clock its clock. */
const mapSandbox = createMapSandbox({
    store: worldBookStore,
    campaign: async (chatId, userId) => {
        const settings = await prefs.load(userId)
        return {
            prefix: resolveCampaignPrefix({ chatId, override: settings.campaignNames?.[chatId], anchorChatId: chatId }),
            owned: settings.campaignBooks?.[chatId] ?? [],
        }
    },
    memos: {
        load: (chatId, userId) => memos.load(chatId, userId),
        save: (chatId, memo, userId, meta) => memos.save(chatId, memo, userId, meta),
    },
    // The clock moved by hand: the cards redraw from the same event a pass sends, with no report and no delta.
    memoChanged: (chatId, userId, memo) =>
        spindle.sendToFrontend({ channel: CHANNEL, kind: 'event', name: 'tracker.changed', data: { chatId, memo, report: null, delta: null, archivedQuests: [], messageId: '' } }, userId),
    state: mapState,
    evolution: mapEvolution,
    othersRunning: (chatId) => inFlight.isRunning('agent', chatId) || inFlight.isRunning('tracker', chatId) || mapUpdater.running(chatId),
    options: async (userId) => {
        const settings = await prefs.load(userId)
        return { intervalHours: settings.mapEvolutionIntervalHours, compressEnabled: settings.mapEvolutionCompressEnabled, compressThreshold: settings.mapEvolutionCompressThreshold }
    },
    refresh: (chatId, userId) => mapSync.refresh(chatId, userId),
    progress: (chatId, userId, tick) => spindle.sendToFrontend({ channel: CHANNEL, kind: 'event', name: 'map.sandbox.progress', data: { chatId, ...tick } }, userId),
    log: spindle.log,
})

/** Evolution's fourteen preferences as the pass reads them; the named sites split on commas. */
function evolutionOptions(settings: Awaited<ReturnType<typeof prefs.load>>) {
    return {
        enabled: settings.mapEvolutionEnabled,
        intervalHours: settings.mapEvolutionIntervalHours,
        onSiteIntervalHours: settings.mapEvolutionOnSiteIntervalHours,
        onSiteIntervalMinutes: settings.mapEvolutionOnSiteIntervalMinutes,
        onSitePreset: settings.mapEvolutionOnSitePreset,
        scope: settings.mapEvolutionScope,
        count: settings.mapEvolutionCount,
        randomize: settings.mapEvolutionRandomize,
        selectedRoots: settings.mapEvolutionSelectedRoots.split(',').map((r) => r.trim()).filter(Boolean),
        worldReportLookback: settings.mapEvolutionWorldReportLookback,
        storyLookback: settings.mapEvolutionLookback,
        systemPrompt: settings.mapEvolutionSystemPrompt,
        compressEnabled: settings.mapEvolutionCompressEnabled,
        compressThreshold: settings.mapEvolutionCompressThreshold,
    }
}

/**
 * The Map Updater (row 9, Phase 34b): after a reply inside a mapped site,
 * one transaction against its map, on the agent's connection.
 */
const mapUpdater = createMapUpdater({
    store: worldBookStore,
    steps: (chatId, userId) => terminal.bind('map_updater', chatId, userId),
    generate: async (messages, chatId, userId) =>
        readGenerationText(
            await generation.quiet({
                messages,
                chatId,
                userId,
                ...connectionField(await (async () => { const p = await prefs.load(userId); return p.mapUpdaterConnectionId || p.agentConnectionId || undefined })()),
            }),
        ),
    campaign: async (chatId, userId) => {
        const settings = await prefs.load(userId)
        return {
            prefix: resolveCampaignPrefix({ chatId, override: settings.campaignNames?.[chatId], anchorChatId: chatId }),
            owned: settings.campaignBooks?.[chatId] ?? [],
        }
    },
    messages: async (chatId) =>
        (await spindle.chat.getMessages(chatId)).map((m) => ({ id: m.id, role: (m.role === 'user' || m.role === 'system' ? m.role : 'assistant') as 'user' | 'assistant' | 'system', text: narrativeText(m) })),
    memo: async (chatId, userId) => (await memos.load(chatId, userId)).memo,
    options: async (userId) => {
        const settings = await prefs.load(userId)
        return { enabled: settings.mapUpdaterEnabled, runEvery: settings.mapUpdaterRunEvery, lookback: settings.mapUpdaterLookback, systemPrompt: settings.mapUpdaterSystemPrompt }
    },
    enabled: mappingEnabled,
    state: mapState,
    refresh: (chatId, userId) => mapSync.refresh(chatId, userId),
    events: {
        started: (chatId, userId, site, at, trigger) =>
            spindle.sendToFrontend({ channel: CHANNEL, kind: 'event', name: 'map.updater.started', data: { chatId, site, at, trigger } }, userId),
        finished: (chatId, userId, report) =>
            spindle.sendToFrontend({ channel: CHANNEL, kind: 'event', name: 'map.updater.finished', data: { chatId, ...report } }, userId),
    },
    log: spindle.log,
})

/**
 * World Progression (roadmap row 8): a report on the world's off-screen day,
 * every in-world day, on the agent's connection -- it is the same kind of job.
 */
const worldProgression = createWorldProgression({
    store: worldBookStore,
    generate: async (messages, chatId, userId, signal) =>
        readGenerationText(
            await generation.quiet({
                messages,
                chatId,
                userId,
                signal,
                ...connectionField((await prefs.load(userId)).agentConnectionId || undefined),
            }),
        ),
    memo: async (chatId, userId) => (await memos.load(chatId, userId)).memo,
    // The narrator's own replies, the legacy's choice: the user's turns are
    // causal history the report must not retell.
    narrative: async (chatId, _userId, lookback) =>
        (await spindle.chat.getMessages(chatId))
            .filter((message) => message.role === 'assistant')
            .map((message) => narrativeText(message).trim())
            .filter(Boolean)
            .slice(-lookback),
    // Both sides, for the source written from the chat (33c): the legacy
    // reads the user's turns too, since the setting is what both describe.
    history: async (chatId, _userId, lookback) =>
        renderNarrative((await spindle.chat.getMessages(chatId)).slice(-lookback)).filter((line) => line.replace(/^(User|GM):\s*/, '').trim()),
    options: async (chatId, userId) => {
        const settings = await prefs.load(userId)
        const cartridge = await store.load(userId)
        return {
            enabled: settings.worldProgressionEnabled,
            prefix: resolveCampaignPrefix({ chatId, override: settings.campaignNames?.[chatId], anchorChatId: chatId }),
            intervalHours: settings.worldProgressionIntervalHours,
            keepActive: settings.worldProgressionKeepActive,
            lookback: settings.worldProgressionLookback,
            historyLookback: settings.worldProgressionHistoryLookback,
            locationsPerReport: settings.worldProgressionLocationsPerReport,
            locationRandomize: settings.worldProgressionLocationRandomize,
            exclusionList: settings.worldProgressionExclusionList,
            consolidateEnabled: settings.worldProgressionConsolidateEnabled,
            consolidateInterval: settings.worldProgressionConsolidateInterval,
            systemPrompt: String(cartridge.worldProgressionSystemPrompt ?? ''),
            clock: { use24hTime: cartridge.use24hTime === true, useDdMmYyFormat: cartridge.useDdMmYyFormat === true },
            skeleton: {
                factions: settings.worldSkeletonFactions,
                locations: settings.worldSkeletonLocations,
                conflicts: settings.worldSkeletonConflicts,
                systemPrompt: settings.worldSkeletonSystemPrompt,
                useLorebooks: settings.worldSkeletonUseLorebooks,
                lorebookOnly: settings.worldSkeletonLorebookOnly,
                lorebookFilter: settings.worldSkeletonLorebookFilter.split(',').map((n) => n.trim()).filter(Boolean),
                useExisting: settings.worldSkeletonUseExisting,
                sourceLookback: settings.worldSkeletonSourceLookback,
            },
        }
    },
    ownership: {
        get: async (chat, who) => (await prefs.load(who)).campaignBooks?.[chat] ?? [],
        made: (chat, names, who) => recordBooksMade(chat, names, who),
    },
    state: worldState,
    events: {
        started: (chatId, userId, at, trigger) =>
            spindle.sendToFrontend({ channel: CHANNEL, kind: 'event', name: 'world.started', data: { chatId, at, trigger } }, userId),
        finished: (chatId, userId, report) =>
            spindle.sendToFrontend({ channel: CHANNEL, kind: 'event', name: 'world.finished', data: { chatId, ...report } }, userId),
    },
    log: spindle.log,
})

/**
 * Record which books a chat's campaign owns, and attach any new one to the
 * narrator's card at once (55-bis). Every maker of a book — the agent, the
 * architect, the NPC creator, World Progression — records it here, so this
 * is the one place a new book is seen the moment it exists; the sweep after
 * the reply came too late for the agent's own books, which are made after
 * the reply, with the fold already drawn. The sweep runs only when the list
 * grew: a pass that made nothing costs no host reads.
 */
async function recordCampaignBooks(chat: string, books: string[], who: string | undefined): Promise<void> {
    const current = (await prefs.load(who)).campaignBooks ?? {}
    const before = current[chat] ?? []
    await prefs.patch({ campaignBooks: { ...current, [chat]: books } }, who)
    if (books.some((name) => !before.includes(name))) await campaignBooks.sweep(chat, who)
}

/**
 * Books a maker just made (66): recorded as the campaign's, and attached at
 * once whatever the names' standing in the list. The sweep above runs on a
 * name new to the list, and a book remade under a name the campaign already
 * owns — a skeleton made, renamed, removed and made again — was never swept:
 * the fold showed it red with Attach working, and nothing attached it on
 * its own.
 */
async function recordBooksMade(chat: string, names: string[], who: string | undefined): Promise<void> {
    const current = (await prefs.load(who)).campaignBooks ?? {}
    const before = current[chat] ?? []
    const after = names.reduce((list, name) => rememberCampaignBook(list, name), before)
    if (after.length !== before.length) await prefs.patch({ campaignBooks: { ...current, [chat]: after } }, who)
    await campaignBooks.sweep(chat, who)
}

function settleAgentRun(
    chatId: string,
    forUser: string | undefined,
    signal: AbortSignal,
    run: Promise<AgentPassReport>,
    trigger: 'manual' | 'direct' | 'cleanup' = 'manual',
): Promise<AgentRunResult> {
    return run
        .finally(() => inFlight.end('agent', chatId, signal))
        .then((report) => {
            const result = toAgentRunResult(report)
            keepAgentResult(chatId, result, forUser)
            spindle.sendToFrontend(
                { channel: CHANNEL, kind: 'event', name: 'agent.finished', data: { chatId, ...result } },
                forUser,
            )
            void portraitAuto.check(chatId, forUser).catch((error: unknown) => {
                spindle.log.warn(`portraits: the check after the agent pass threw: ${describeError(error)}`)
            })
            // The legacy's bloat hint and auto-cleanup after a normal pass (71c); never after a cleanup's own.
            if (report.outcome === 'committed' && trigger !== 'cleanup') void autoCleanup.after(chatId, forUser)
            return result
        })
}

/**
 * The undone pass kept for a redo (71c), with the watermark as it stood
 * before the undo moved it back, and the watermark moved back — the pressed
 * undo never did that until now; only the swipe's rollback did.
 */
function keepForRedo(chatId: string, report: AgentUndoReport, watermarkBefore: number | undefined): void {
    if (!report.undone && !report.redo) return
    if (report.redo) redoStack.push(chatId, { ...report.redo, ...(watermarkBefore !== undefined ? { watermark: watermarkBefore } : {}) })
}

/** The campaign's own books with their entries, for the cleanup count (71c). */
async function cleanupBooks(chatId: string, forUser: string | undefined): Promise<Array<{ name: string; entries: Array<{ uid: string; key: string[]; content: string; comment: string }> }>> {
    const settings = await prefs.load(forUser)
    const owned = new Set((settings.campaignBooks?.[chatId] ?? []).map((name) => name.toLowerCase()))
    const store = loreStore(forUser)
    const out = []
    for (const book of (await store.listBooks()).filter((book) => owned.has(book.name.toLowerCase()))) {
        try { out.push({ name: book.name, entries: await store.listEntries(book.id) }) } catch { /* a book that will not read is not counted */ }
    }
    return out
}

/** One cleanup pass on demand (71c): the menu's, the records' targeted one, or the auto-cleanup's. */
async function runCleanup(chatId: string, forUser: string | undefined, options: { target?: string; instructions?: string }): Promise<AgentRunResult> {
    const settings = await prefs.load(forUser)
    const signal = inFlight.begin('agent', chatId)
    const deps = await agentDeps(chatId, forUser, signal)
    return settleAgentRun(
        chatId,
        forUser,
        signal,
        runCleanupPass(chatId, forUser, { ...deps, trigger: 'cleanup' }, {
            threshold: settings.agentCleanupThreshold,
            useThreshold: settings.agentCleanupUseThreshold !== false,
            ...options,
        }),
        'cleanup',
    )
}

const autoCleanup = createAutoCleanup({
    settings: (who) => prefs.load(who),
    books: cleanupBooks,
    step: (chatId, who) => terminal.bind('lorebook_agent', chatId, who),
    run: (chatId, who) => runCleanup(chatId, who, {}),
    log: spindle.log,
})

/** The full audit (71c): every chunk the ordinary pass with the audit instruction and the chunk as its story. */
const fullAudit = createFullAudit({
    lines: async (chatId) => (await spindle.chat.getMessages(chatId))
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => ({ name: message.role === 'user' ? 'Player' : 'Narrator', text: narrativeText(message) })),
    tokens: async (who) => (await prefs.load(who)).agentAuditTokens,
    pass: async (chatId, who, chunk) => {
        const signal = inFlight.begin('agent', chatId)
        // The chunk in place of the story, and the plain narrative in place of
        // the numbered one: a chunk's lines carry no host numbers to cite.
        const { numberedNarrative: _numbered, ...deps } = await agentDeps(chatId, who, signal)
        const report = await runAgentPass(chatId, who, { ...deps, trigger: 'audit', instruction: AUDIT_INSTRUCTION, lookback: 0, narrative: async () => chunk })
            .finally(() => inFlight.end('agent', chatId, signal))
        const result = toAgentRunResult(report)
        keepAgentResult(chatId, result, who)
        spindle.sendToFrontend({ channel: CHANNEL, kind: 'event', name: 'agent.finished', data: { chatId, ...result } }, who)
        return report
    },
    running: (chatId) => inFlight.isRunning('agent', chatId),
    cancel: (chatId) => inFlight.cancel('agent', chatId),
    step: (chatId, who) => terminal.bind('lorebook_agent', chatId, who),
    progress: (who, progress) => spindle.sendToFrontend({ channel: CHANNEL, kind: 'event', name: 'agent.audit.progress', data: progress }, who),
    log: spindle.log,
})

/**
 * The display-only regex script of Phase 31a, taken back (33a) and back
 * again behind a preference (65): installed by name while
 * `choicesDisplayRegex` is on, removed by name while it is off. Reconciled
 * on the first request or reply of a session and whenever the preference
 * is saved; answered from memory in between.
 */
const choicesDisplay = createChoicesDisplay({ regex: spindle.regex_scripts, log: spindle.log })
const choicesDisplaySeen = new Set<string>()
function syncChoicesDisplay(userId: string | undefined, force = false): Promise<void> {
    const key = userId ?? '@self'
    if (!force && choicesDisplaySeen.has(key)) return Promise.resolve()
    choicesDisplaySeen.add(key)
    return prefs.load(userId)
        .then((p) => choicesDisplay.ensure(userId, p.choicesDisplayRegex !== false))
        .then(() => undefined, (error) => { spindle.log.warn(`choices: the display regex preference could not be read: ${error instanceof Error ? error.message : String(error)}`) })
}

/**
 * Multihog's Debug & Factory Reset (72a): the four resets, and the stock
 * texts refreshed after an update. The check runs once per user per
 * session, on the first request, and on demand from the card.
 */
const maintenance = createMaintenance({
    storage: spindle.userStorage,
    store,
    prefs,
    portraits,
    chats: { list: (options) => spindle.chats.list(options) },
    forget: (chatId, userId) => {
        memos.forget(chatId, userId)
        portraits.forget(chatId, userId)
        memoHistory.forget(chatId, userId)
        reportHistory.forget(chatId, userId)
        questArchive.forget(chatId, userId)
        relationshipStore.forget(chatId, userId)
    },
    log: spindle.log,
})
const stockUpgrade = createStockUpgrade({
    storage: spindle.userStorage,
    store,
    prefs,
    factory: () => getFactoryCartridgePayload() as Record<string, unknown>,
    log: spindle.log,
})
const stockUpgradeSeen = new Set<string>()
function ensureStockUpgrade(userId: string | undefined): Promise<void> {
    const key = userId ?? '@self'
    if (stockUpgradeSeen.has(key)) return Promise.resolve()
    stockUpgradeSeen.add(key)
    return stockUpgrade.check(userId).then(
        (report) => {
            if (report.refreshed.length) spindle.sendToFrontend({ channel: CHANNEL, kind: 'event', name: 'settings.changed', data: { settings: report.settings } }, userId)
        },
        (error) => { spindle.log.warn(`settings: the stock texts could not be checked: ${error instanceof Error ? error.message : String(error)}`) },
    )
}

/** Reply to one request from the panel. */
function reply(id: string, ok: boolean, data: unknown, error: string | undefined, userId: string): void {
    const message: ResponseMessage = { channel: CHANNEL, kind: 'response', id, ok, data, error }
    spindle.sendToFrontend(message, userId)
}

spindle.onFrontendMessage(async (payload: unknown, userId: string) => {
    if (!isRequest(payload)) return
    void syncChoicesDisplay(userId)
    // The stock texts checked against the factory once a session (72a), before the settings are read.
    await ensureStockUpgrade(userId)

    try {
        const data = await handleRequest(
            {
                store,
                memos,
                questArchive,
                memoHistory,
                reports: reportHistory,
                prefs,
                campaign: campaignNamer,
                portraits,
                // The choices under each reply (roadmap row 6): read from the
                // chat, and a click becomes the user's message with the reply
                // started by the host. `chat_mutation`, as `getMessages` is.
                // The game system wizard's model calls (roadmap row 7): the
                // story and the memo as context, {{user}} shielded from
                // macro resolution and mapped back from the persona's name.
                wizard: createWizard({
                    generate: generation,
                    chat: spindle.chat,
                    memo: async (chatId, forUser) => (await memos.load(chatId, forUser)).memo,
                    // The context switches (73g): the cartridge for the module examples, the host's active lore for the lore switch.
                    settings: (forUser) => store.load(forUser),
                    activeLore: async (chatId, forUser) => {
                        const found = await spindle.world_books.getActivated(chatId, forUser)
                        const byBook = new Map<string, Set<string>>()
                        for (const entry of found) {
                            if (!entry.bookId) continue
                            if (!byBook.has(entry.bookId)) byBook.set(entry.bookId, new Set())
                            byBook.get(entry.bookId)!.add(entry.id)
                        }
                        const books = worldBookStore(forUser)
                        const out: Array<{ title: string; content: string }> = []
                        for (const [bookId, ids] of byBook) {
                            const entries = await books.listEntries(bookId).catch(() => [])
                            for (const entry of entries) if (ids.has(entry.id) || ids.has(entry.uid)) out.push({ title: entry.comment, content: entry.content })
                        }
                        return out
                    },
                    context: createWizardContext((FACTORY_CARTRIDGE_DEFAULTS as { stockPrompts: Record<string, string> }).stockPrompts, resolveTimePromptKey),
                    userName: async (chatId, forUser) =>
                        (await spindle.macros.resolve('{{user}}', { chatId, userId: forUser })).text,
                    log: spindle.log,
                }),
                world: worldProgression,
                records: campaignRecords,
                // The host's books by name (73h), for the tracker's lorebook filter.
                books: { list: (forUser) => worldBookStore(forUser).listBooks() },
                // The AI Theme Wizard (74b): one call on the tracker's connection, the theme kept as a preference.
                theme: createThemeWizard({ generate: generation, prefs: { load: (forUser) => prefs.load(forUser), patch: (patch, forUser) => prefs.patch(patch, forUser) }, log: spindle.log }),
                // Edit with AI (78c): one call on the agent's connection, the revised text shown before it is applied.
                cardEdit: createCardAiEdit({ generate: generation, prefs: { load: (forUser) => prefs.load(forUser) }, log: spindle.log }),
                // The narrator card (72b): the host's cards by name, and one made empty under the chosen name.
                characters: {
                    list: async (userId) => (await spindle.characters.list({ limit: 500, ...(userId ? { userId } : {}) })).data.map((c) => ({ id: c.id, name: c.name })),
                    create: async (name, userId) => { const made = await spindle.characters.create({ name }, userId); return { id: made.id, name: made.name } },
                },
                map: {
                    sync: mapSync,
                    state: mapState,
                    enabled: mappingEnabled,
                    architect: async (userId) => {
                        const settings = await prefs.load(userId)
                        return { toolRegistered: mapTool.registered(), opener: settings.mapArchitectOpener, lookback: settings.mapArchitectLookback, systemPrompt: settings.mapArchitectSystemPrompt }
                    },
                    updater: {
                        run: (request) => mapUpdater.run(request),
                        options: async (userId) => {
                            const settings = await prefs.load(userId)
                            return { enabled: settings.mapUpdaterEnabled, runEvery: settings.mapUpdaterRunEvery, lookback: settings.mapUpdaterLookback, systemPrompt: settings.mapUpdaterSystemPrompt }
                        },
                        running: (chatId) => mapUpdater.running(chatId),
                    },
                    view: (chatId, userId, siteRoot) => mapView.view(chatId, userId, siteRoot),
                    create: (request) => mapCreation.create(request),
                    evolution: {
                        run: (request) => mapEvolution.run(request),
                        status: async (chatId, userId) => {
                            const settings = await prefs.load(userId)
                            const options = evolutionOptions(settings)
                            return { ...options, selectedRoots: settings.mapEvolutionSelectedRoots, narratorCommitTokens: settings.mapEvolutionNarratorCommitTokens, connectionId: settings.mapEvolutionConnectionId, running: mapEvolution.running(chatId), ...(await mapEvolution.schedule(chatId, userId)) }
                        },
                        setSiteInterval: (chatId, userId, siteRoot, hours) => mapEvolution.setSiteInterval(chatId, userId, siteRoot, hours),
                        resetTimeline: (chatId, userId) => mapEvolution.resetTimeline(chatId, userId),
                    },
                    sandbox: mapSandbox,
                },
                // The terminal (71b): the passes' kept steps, and a feed cleared.
                terminal,
                chat: spindle.chat,
                chatAppend: async (chatId: string, content: string) => {
                    const { id } = await spindle.chat.appendMessage(chatId, { role: 'user', content }, { triggerGeneration: true })
                    return { id }
                },
                // The Lorebook Agent, run on demand only. Nothing calls this
                // after a reply: the first thing that writes to a campaign
                // should be something the maintainer presses and watches.
                agentPass: async (chatId: string, forUser: string | undefined) => {
                    const signal = inFlight.begin('agent', chatId)
                    return settleAgentRun(
                        chatId,
                        forUser,
                        signal,
                        runAgentPass(chatId, forUser, await agentDeps(chatId, forUser, signal)),
                    )
                },
                // The same pass with the user's own instruction (Phase 30,
                // Multihog's 💬), reading the send bar's own window of story
                // rather than the pass's.
                agentInstruct: async (chatId: string, forUser: string | undefined, instruction: string) => {
                    const signal = inFlight.begin('agent', chatId)
                    const deps = await agentDeps(chatId, forUser, signal)
                    const lookback = (await prefs.load(forUser)).agentDirectLookback
                    return settleAgentRun(
                        chatId,
                        forUser,
                        signal,
                        runAgentPass(chatId, forUser, { ...deps, trigger: 'direct', instruction, lookback }),
                        'direct',
                    )
                },
                // One registry, both kinds: a Stop that worked for the
                // tracker and silently not the agent would be worse than none.
                cancelPass: (kind, chatId) => inFlight.cancel(kind, chatId),
                // Free tier, so no permission to declare — but still wrapped,
                // because a host that will not list them must leave the panel
                // drawable rather than failing it.
                connections: async (userId) => {
                    try {
                        const profiles = await spindle.connections.list(userId)
                        return {
                            connections: profiles.map((profile) => ({
                                id: profile.id,
                                name: profile.name,
                                model: profile.model,
                                isDefault: profile.is_default,
                            })),
                        }
                    } catch (error) {
                        spindle.log.warn(`connections.list failed: ${String(error)}`)
                        return { connections: [], unavailable: 'Lumiverse would not list your connections.' }
                    }
                },
                // Undo is its own op and its own button. A run adds and can be
                // taken back; an undo removes and cannot.
                agentUndo: async (chatId: string, forUser: string | undefined) => {
                    const before = (await prefs.load(forUser)).agentWatermarks ?? {}
                    const report = await undoAgentPass(chatId, forUser, await agentDeps(chatId, forUser))
                    keepForRedo(chatId, report, before[chatId])
                    // The watermark the pass advanced goes back with it (71c; the swipe's rollback always did this, the button never had).
                    if (report.undone && report.watermark !== undefined) {
                        await prefs.patch({ agentWatermarks: { ...before, [chatId]: report.watermark } }, forUser)
                    }
                    return {
                        at: report.at,
                        summary: report.summary,
                        undone: report.undone,
                        problems: report.problems,
                        waiting: redoStack.waiting(chatId),
                    }
                },
                // The agent's tools (71c).
                agentRedo: async (chatId: string, forUser: string | undefined) => {
                    const entry = redoStack.pop(chatId)
                    if (!entry) return { at: new Date().toISOString(), summary: 'Nothing has been undone in this chat, so there is nothing to redo.', redone: false, problems: [], waiting: 0 }
                    const report = await redoAgentPass(chatId, forUser, await agentDeps(chatId, forUser), entry)
                    if (report.watermark !== undefined) {
                        const settings = await prefs.load(forUser)
                        await prefs.patch({ agentWatermarks: { ...(settings.agentWatermarks ?? {}), [chatId]: report.watermark } }, forUser)
                    }
                    spindle.log.info(`agent: redid an undone pass: ${report.summary}`)
                    const result = { at: report.at, summary: report.summary, redone: report.redone, problems: report.problems, waiting: redoStack.waiting(chatId) }
                    spindle.sendToFrontend({ channel: CHANNEL, kind: 'event', name: 'agent.redone', data: { ...result, chatId } }, forUser)
                    return result
                },
                agentCleanup: (chatId: string, forUser: string | undefined, options: { target?: string; instructions?: string }) => runCleanup(chatId, forUser, options),
                agentAudit: (chatId: string, forUser: string | undefined) => fullAudit.run(chatId, forUser),
                agentAuditStop: (chatId: string) => fullAudit.stop(chatId),
                campaignClone: async (chatId: string, forUser: string | undefined, newPrefix: string) => {
                    const settings = await prefs.load(forUser)
                    const prefix = resolveCampaignPrefix({ chatId, override: settings.campaignNames?.[chatId], anchorChatId: chatId })
                    const result = await cloneCampaignStack({ store: worldBookStore(forUser), prefix, owned: settings.campaignBooks?.[chatId] ?? [], newPrefix, log: spindle.log })
                    if (result.refused) spindle.log.warn(`campaign: clone of "${prefix}" refused: ${result.refused.split('\n')[0]}`)
                    else spindle.log.info(`campaign: cloned ${result.cloned.length} book${result.cloned.length === 1 ? '' : 's'} of "${prefix}" under "${result.newPrefix}"`)
                    return result
                },
                // Gated by `world_books`, and read-only: the activation
                // diagnostic asks the host what it already loaded. `userId`
                // is forwarded for the reason rule 3f exists.
                worldBooks: {
                    getActivated: (chatId: string, forUser: string | undefined) =>
                        spindle.world_books.getActivated(chatId, forUser),
                    // For the eligibility count only. The host paginates; a
                    // lorebook big enough to need a second page is bigger than
                    // any diagnostic needs to be exact about.
                    listEntries: async (bookId: string, forUser: string | undefined) => {
                        const page = await spindle.world_books.entries.list(bookId, {
                            limit: 200,
                            userId: forUser,
                        })
                        return page.data.map((entry) => ({
                            id: entry.id,
                            constant: entry.constant,
                            vectorized: entry.vectorized,
                        }))
                    },
                },
                // Gated by `images`. Wrapped rather than passed straight through
                // so the handler depends on one method rather than the host.
                //
                // `userId` is forwarded, and it is not optional: on an
                // operator-scoped install a gated call without it fails with
                // `userId is required for operator-scoped extensions`. This
                // wrapper dropped it, which is why a portrait could be picked
                // and never stored — the picker is free-tier and worked, the
                // upload behind it did not.
                images: {
                    uploadFromDataUrl: (
                        dataUrl: string,
                        filename: string | undefined,
                        forUser: string | undefined,
                    ) => spindle.images.uploadFromDataUrl(dataUrl, filename, forUser),
                },
                trackerPass,
                library: npcLibrary,
                npcCreator,
                relationships,
                scene,
                sceneArt,
                portraitAuto,
                campaignBooks,
                creator: { generate: creator.generate, instant: creator.instant, ways: creator.ways, cards: creator.cards, importCard: creator.importCard, card: { view: playerCard.view, write: playerCard.write, save: playerCard.save, remove: playerCard.remove, persona: playerCard.persona } },
                status: readStatus,
                maintenance,
                stockUpgrade,
            },
            payload,
            userId,
        )
        // A settings change may have asked for the tool, or taken it away.
        syncDiceTools(userId)
        void syncMapTool(userId)
        reply(payload.id, true, data, undefined, userId)

        // A preference change moves things outside the panel — the cards under
        // the messages are drawn by a different module entirely — so the whole
        // frontend is told, not just the caller.
        if (writesPrefs(payload.op)) {
            spindle.sendToFrontend(
                { channel: CHANNEL, kind: 'event', name: 'prefs.changed', data },
                userId,
            )
            // The display regex follows its preference the moment it is saved (65).
            void syncChoicesDisplay(userId, true)
        }

        // A settings write is announced the same way (70): the narrator's
        // configuration is drawn in two places, and a cartridge load in one.
        if (writesSettings(payload.op)) {
            spindle.sendToFrontend({ channel: CHANNEL, kind: 'event', name: 'settings.changed', data }, userId)
        }

        // A portrait change is announced by the store itself, whoever wrote it
        // (43-bis), so the editor's two ops no longer announce their own.
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        spindle.log.warn(`${payload.op} failed: ${message}`)
        reply(payload.id, false, undefined, message, userId)
    }
})

spindle.log.info(
    `AdventureTime backend ready (${permissionAudit.granted.length}/${
        permissionAudit.granted.length + permissionAudit.missing.length
    } permissions granted)`,
)

export { store, memos, questArchive, memoHistory, prefs, portraits, trackerPass, permissionAudit, diceTools, disposeInterceptor, disposeGenerationHook, disposeForkHook, disposeDeniedLog, disposeToolInvocation }
