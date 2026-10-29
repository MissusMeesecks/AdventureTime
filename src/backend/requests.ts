/**
 * The backend's request handlers — one function per protocol op.
 *
 * Kept separate from src/backend.ts so the interesting half can be tested
 * without a Spindle host: everything here takes its dependencies as
 * arguments and touches no globals.
 */

import { getFactoryCartridgePayload } from '../state/factory.js'
import {
    applyCartridgePayload,
    buildCartridgeExportObject,
    buildCartridgePayload,
    parseImportedCartridge,
} from '../cartridges.js'
import { CARTRIDGE_PAYLOAD_GROUPS } from '../state/payload-groups.js'
import { extractChoices } from '../tracker/cyoa.js'
import { findByMessage } from '../tracker/history-view.js'
import { isFactoryPortraitPresetId, isFactoryPortraitPresetName, locationPromptForToggle, resolvePortraitPresetBundle, savedPresetId, type SavedPortraitPreset } from '../tracker/portrait-presets.js'
import type { SettingsBag } from '../settings/schema.js'
import { readBackdrop } from '../protocol.js'
import { readMapTheme } from '../tracker/map-themes.js'
import type {
    CancelResult,
    ConnectionsResult,
    CartridgeExportResult,
    ActivatedLoreResult,
    AgentRunResult,
    CyoaChoicesResult,
    CyoaChooseResult,
    WizardDraftResult,
    WizardReviseResult,
    AgentUndoResult,
    AgentRedoResult,
    AgentAuditResult,
    CampaignCloneResult,
    PortraitsResult,
    PrefsResult,
    RequestMessage,
    SettingsResult,
    StatusResult,
    TrackerHistoryResult,
    ReportsHistoryResult,
    TrackerResult,
    MapEvolutionResult,
    MapViewResult,
    MapCreateResult,
    TerminalResult,
    MapRawResult,
    MapRawSaveResult,
    CampaignRecordsResult,
    WorldConsolidateResult,
    NarratorCardResult,
    RecordEntryResult,
    RecordRemoveMapResult,
    CreatorResult,
    InstantResult,
    CardResult,
    PersonaResult,
    PlayerCardView,
    WaysResult,
    CardChoice,
    ImportResult,
    LibraryActionResult,
    LibraryPhotoResult, LibraryPhotoPromptResult,
    NpcAddResult,
    NpcDraftResult,
    NpcSource,
    CampaignBooksResult,
    SceneConnectionsResult,
    PortraitAutoStatus,
    PortraitDrawResult, PortraitPromptResult,
    SceneDrawResult, ScenePromptResult,
    SceneResult,
    LibraryRecordView,
    LibrarySources,
    MapEvolutionStatus,
    MapEvolutionIntervalResult,
    MapSandboxOutcome,
    MapSandboxResult,
    MapStatusResult,
    MapUpdaterResult,
    WorldBooksResult,
    WorldPurgeResult,
    WorldRunResult,
    WorldSourceResult,
    WorldSkeletonResult,
    WorldStatusResult,
    RelationshipsView,
    BooksListResult,
    ThemeGenerateResult,
    CardAiEditResult,
} from '../protocol.js'
import type { SettingsStore } from './settings-store.js'
import type { MemoStore, MemoRecord } from './memo-store.js'
import type { MemoHistoryStore } from './memo-history.js'
import type { ReportHistoryStore } from './report-history.js'
import type { PortraitStore } from './portrait-store.js'
import type { NpcLibrary } from './npc-library.js'
import type { NpcCreator } from './npc-creator.js'
import type { Scene } from './scene.js'
import type { SceneArt } from './scene-art.js'
import type { PortraitAuto } from './portrait-auto.js'
import type { CampaignBooks } from './campaign-books.js'
import type { CampaignRecords } from './campaign-records.js'
import { isTerminalSource, parseMapArchitectDirective, type Terminal } from './terminal.js'
import type { MapCreateRequest } from './map-create.js'
import { applyNpcWordTargets, rebuildModuleInstructions, stockModuleInstructions, type NpcWordTargets, type StoredAgentModule } from '../agent/modules.js'
import { DEFAULT_NPC_MAJOR_WORDS, DEFAULT_NPC_MINOR_WORDS, MAX_NPC_WORDS } from './prefs-store.js'
import type { Relationships } from './relationships.js'
import { DEFAULT_TRACKER_DIRECT_LOOKBACK, DEFAULT_WIZARD_LOOKBACK, type PrefsStore } from './prefs-store.js'
import type { CampaignNamer } from './campaign-name.js'
import type { Wizard } from './wizard.js'
import type { WorldProgression } from './world-pass.js'
import type { MapSync } from './map-sync.js'
import type { MapStore } from './map-store.js'
import type { MapSandbox } from './map-sandbox.js'
import type { WizardDraft } from '../tracker/wizard.js'
import type { QuestArchiveStore } from './quest-archive.js'
import type { TrackerPass } from './tracker-pass.js'
import type { Maintenance } from './maintenance.js'
import type { StockUpgrade } from './stock-upgrade.js'

export interface RequestDeps {
    store: SettingsStore
    memos: MemoStore
    /**
     * The chat's finished quests. Absent in tests that do not exercise them, and
     * absent leaves every tracker result without an archive — which draws
     * exactly as it did before the archive existed.
     */
    questArchive?: QuestArchiveStore
    /**
     * The memo as it stood at each turn, for the per-message cards. Absent
     * leaves every message without one, which is how the tracker behaved before
     * the history existed.
     */
    memoHistory?: MemoHistoryStore
    /** The last reports of the tracker and the agent (47e). Absent leaves the panel's history empty. */
    reports?: ReportHistoryStore
    /**
     * Display preferences, which are not cartridge settings. Absent leaves every
     * preference at its default, which is what a build without the store did.
     */
    prefs?: PrefsStore
    /** Self-named campaigns (51). */
    campaign?: CampaignNamer
    /** Which picture belongs to which entity, per chat. */
    portraits?: PortraitStore
    /**
     * One manual run of the Lorebook Agent. Absent leaves the button saying so
     * rather than failing with something opaque.
     */
    agentPass?: (chatId: string, userId: string | undefined) => Promise<AgentRunResult>
    /**
     * A pass of the Lorebook Agent carrying the user's own instruction, from
     * the send bar (Phase 30). Absent leaves the bar saying so.
     */
    agentInstruct?: (chatId: string, userId: string | undefined, instruction: string) => Promise<AgentRunResult>
    /** The game system wizard's model calls (Phase 32). Absent leaves the wizard saying so. */
    wizard?: Wizard
    /** World Progression (roadmap row 8). Absent leaves the panel saying so. */
    world?: WorldProgression
    /** The hidden map (row 9): the sync that reads the books and the record it leaves. */
    map?: {
        sync: MapSync
        state: MapStore
        enabled(userId: string | undefined): Promise<boolean>
        /** The architect's switch and settings (34a). */
        architect(userId: string | undefined): Promise<{ toolRegistered: boolean; opener: 'tool' | 'text'; lookback: number; systemPrompt: string }>
        /** The updater (34b): a pass now, its settings, and whether one is running. */
        updater: {
            run(request: { chatId: string; userId: string | undefined; instruction?: string; lookback?: number; siteRoot?: string }): Promise<MapUpdaterResult>
            options(userId: string | undefined): Promise<{ enabled: boolean; runEvery: number; lookback: number; systemPrompt: string }>
            running(chatId: string): boolean
        }
        /** The map on screen (34d): the party's site, or a named one, drawn. */
        view(chatId: string, userId: string | undefined, siteRoot?: string): Promise<MapViewResult>
        /** A map made from the panel (71a): Add Mapped Location and + MAP, Auto or Manual. Absent leaves the records saying so. */
        create?(request: MapCreateRequest): Promise<MapCreateResult>
        /** Evolution (34c): a pass now, and its standing for this chat; a site's own hours (71d). */
        evolution: {
            run(request: { chatId: string; userId: string | undefined; instruction?: string; siteRoots?: string[]; lookback?: number }): Promise<MapEvolutionResult>
            status(chatId: string, userId: string | undefined): Promise<MapEvolutionStatus>
            setSiteInterval?(chatId: string, userId: string | undefined, siteRoot: string, hours: number | null): Promise<MapEvolutionIntervalResult>
            /** Reset timeline (78a): every site's last-evolved clock forgotten. */
            resetTimeline?(chatId: string, userId: string | undefined): Promise<void>
        }
        /** The Testing Ground (71d); absent in a build without one. */
        sandbox?: MapSandbox
    }
    /** Campaign Records (71a): the campaign's books and their entries, read and written from the panel; the raw map editor with them. */
    records?: CampaignRecords
    /** The terminal (71b): every pass's kept steps, per chat and per feed; absent in a build without one. */
    terminal?: Terminal
    /** The host's lorebooks (73h), every one by name, for the tracker's lorebook filter; absent in a build without the store. */
    books?: { list(userId: string | undefined): Promise<Array<{ id: string; name: string }>> }
    /** The AI Theme Wizard (74b): one model call on the tracker's connection; absent when the build cannot generate. */
    theme?: { generate(userId: string | undefined, description: string, iterate: boolean): Promise<ThemeGenerateResult> }
    /** Edit with AI (78c): one call on the agent's connection with Multihog's editor prompt. */
    cardEdit?: { edit(userId: string | undefined, kind: 'npc' | 'pc', content: string, instructions: string): Promise<CardAiEditResult> }
    /** The host's character cards (72b): listed by name and made, for *Create narrator card*; absent when the grant is missing. */
    characters?: {
        list(userId: string | undefined): Promise<Array<{ id: string; name: string }>>
        create(name: string, userId: string | undefined): Promise<{ id: string; name: string }>
    }
    /** The chat's messages, for the choices under each reply (Phase 31). */
    chat?: { getMessages(chatId: string): Promise<Array<{ id: string; role: string; content: string }>> }
    /**
     * Send a chosen choice as the user's message and start the reply. What a
     * click on a choice button does; absent leaves the buttons saying so.
     */
    chatAppend?: (chatId: string, content: string, userId: string | undefined) => Promise<{ id: string }>
    /** Put the books back as the last pass found them. */
    agentUndo?: (chatId: string, userId: string | undefined) => Promise<AgentUndoResult>
    /** The agent's tools (71c): an undone pass written back; the cleanup pass on one entry or every bloated one; the full audit and its stop; the campaign's books cloned under a new prefix. */
    agentRedo?: (chatId: string, userId: string | undefined) => Promise<AgentRedoResult>
    agentCleanup?: (chatId: string, userId: string | undefined, options: { target?: string; instructions?: string }) => Promise<AgentRunResult>
    agentAudit?: (chatId: string, userId: string | undefined) => Promise<AgentAuditResult>
    agentAuditStop?: (chatId: string) => boolean
    campaignClone?: (chatId: string, userId: string | undefined, newPrefix: string) => Promise<CampaignCloneResult>
    /**
     * Stop whatever is running for this chat.
     *
     * Returns whether there was anything to stop. Both kinds go through one
     * dependency because the two registries are one registry — a Stop button
     * that could stop the tracker but silently not the agent would be worse
     * than no button.
     */
    cancelPass?: (kind: 'tracker' | 'agent', chatId: string) => boolean
    /** The user's connection profiles, for the two model-choice dropdowns. */
    connections?: (userId: string | undefined) => Promise<ConnectionsResult>
    /**
     * The host's world-book reads, for the activation diagnostic only.
     *
     * Gated by `world_books`. `userId` is required rather than optional, for
     * the reason rule 3f exists: an operator-scoped install refuses a gated
     * call that does not name its user, at the call site, silently.
     */
    worldBooks?: {
        getActivated(
            chatId: string,
            userId: string | undefined,
        ): Promise<ActivatedLoreResult['entries']>
        /**
         * The entries of one book, for the eligibility count only.
         *
         * Optional: without it the diagnostic still lists what loaded, it just
         * cannot say whether matching by meaning was ever switched on.
         */
        listEntries?(
            bookId: string,
            userId: string | undefined,
        ): Promise<Array<{ id: string; constant?: boolean; vectorized?: boolean }>>
    }
    /**
     * The host's image store, for a portrait picked from disk.
     *
     * Gated by the `images` permission. Absent — or denied — leaves pasting a
     * URL working, which is why the upload op reports rather than throws
     * something opaque.
     *
     * `userId` is **required**, not optional, and that is the whole point of
     * declaring it here rather than letting the entry point curry it away. On an
     * operator-scoped install every gated host call must say which user it is
     * for, and one that does not fails with `userId is required for
     * operator-scoped extensions` — at the call site, where nothing was looking.
     * Spelling it into this type makes the compiler ask for it.
     */
    images?: {
        uploadFromDataUrl(
            dataUrl: string,
            filename: string | undefined,
            userId: string | undefined,
        ): Promise<{ url: string }>
    }
    /**
     * Absent in tests that do not exercise it, and absent if the backend ever
     * runs without generation permission — `tracker.run` then reports that
     * rather than throwing something opaque.
     */
    trackerPass?: TrackerPass
    /** The character creator (Phase 35): the sheet written from a draft. */
    /** The NPC library (41). */
    library?: NpcLibrary
    /** The NPC creator (41a). */
    npcCreator?: NpcCreator
    /** The scene view (42). */
    scene?: Scene
    /** The scene picture drawn by the host (49). */
    sceneArt?: SceneArt
    /** The portraits drawn as they appear (61). */
    portraitAuto?: PortraitAuto
    /** The campaign's lorebooks and their attachment (55). */
    campaignBooks?: CampaignBooks
    /** The relationship system (44). */
    relationships?: Relationships
    creator?: {
        generate(request: { chatId: string; userId: string | undefined; draft: unknown; playerCard?: boolean; persona?: boolean; cardWords?: number }): Promise<CreatorResult>
        /** Instant Action (35a): the sheet from rolled choices, then the opening message. */
        instant(request: { chatId: string; userId: string | undefined; genre: string; name?: string; setup?: string; sendStarter?: boolean; cardWords?: number }): Promise<InstantResult>
        /** The other ways to begin (35c). */
        ways(request: { chatId: string; userId: string | undefined; way: 'persona' | 'custom'; name?: string; instructions?: string; level?: number | 'none'; genre?: string; gearTier?: string; combatScalingGuide?: boolean; playerCard?: boolean; persona?: boolean; cardWords?: number }): Promise<WaysResult>
        /** Import Card (39): the host's cards, and one imported as the player. */
        cards(userId: string | undefined): Promise<CardChoice[]>
        importCard(request: { chatId: string; userId: string | undefined; characterId: string; mode: 'minimal' | 'full'; cardWords?: number | 'same'; playerCard?: boolean; persona?: boolean; narratorCharacterId?: string }): Promise<ImportResult>
        /** The Player Card and the persona (35b). */
        card: {
            view(chatId: string, userId: string | undefined): Promise<PlayerCardView>
            write(request: { chatId: string; userId: string | undefined; name?: string; words?: number }): Promise<CardResult>
            save(request: { chatId: string; userId: string | undefined; name: string; bio: string }): Promise<CardResult>
            remove(chatId: string, userId: string | undefined): Promise<void>
            persona(request: { chatId: string; userId: string | undefined; name?: string }): Promise<PersonaResult>
        }
    }
    /**
     * What build is running and what the host has granted it.
     *
     * A function rather than a value, and called per request rather than
     * cached, because a permission can be granted while the extension is
     * running. A snapshot taken at startup would keep telling a user who has
     * just fixed the problem that it is still there.
     *
     * Absent in tests that do not exercise it, and absent if the host exposes
     * neither a manifest nor a permissions API.
     */
    status?: (userId?: string) => StatusResult | Promise<StatusResult>
    /** Multihog's Debug & Factory Reset buttons (72a). Absent leaves the card saying so. */
    maintenance?: Maintenance
    /** The stock texts refreshed after an update (72a); its last report rides on the status. */
    stockUpgrade?: StockUpgrade
}

/** Turn a cartridge name into something safe to save to disk. */
export function cartridgeFilename(name: string): string {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)
    return `${slug || 'game-cartridge'}.json`
}

async function getSettings(deps: RequestDeps, userId?: string): Promise<SettingsResult> {
    return { settings: await deps.store.load(userId) }
}

async function patchSettings(
    deps: RequestDeps,
    userId: string | undefined,
    params: Record<string, unknown> | undefined,
): Promise<SettingsResult> {
    const patch = params?.patch
    if (!patch || typeof patch !== 'object') throw new Error('settings.patch requires a patch object')
    return { settings: await deps.store.patch(userId, withActiveStyleCleared(await deps.store.load(userId), patch as SettingsBag)) }
}

/** The three prompt keys an art style loads (63b). */
const PORTRAIT_PROMPT_KEYS = ['portraitNpcSystemPrompt', 'portraitCharacterSystemPrompt', 'portraitLocationSystemPrompt'] as const

/**
 * An edit to one of the three portrait prompts clears which style is active
 * (63b, the legacy's `input` handlers): the texts are no longer the style's.
 * A patch that sets the id itself, or changes no prompt, is left as it is.
 */
export function withActiveStyleCleared(current: SettingsBag, patch: SettingsBag): SettingsBag {
    if ('activePortraitPromptPresetId' in patch || !current.activePortraitPromptPresetId) return patch
    const edited = PORTRAIT_PROMPT_KEYS.some((key) => key in patch && patch[key] !== current[key])
    return edited ? { ...patch, activePortraitPromptPresetId: '' } : patch
}

/**
 * The art styles (63b): a factory style or a saved setup loaded into the
 * cartridge's three prompts and word target, the saved setup's present-NPCs
 * choice into the scene's preference; a setup saved under a name that is
 * not a style's; a setup deleted. Each answers with the settings whole, as
 * `settings.patch` does, so the panel re-seeds every editor from it.
 */
async function portraitsPresetsLoad(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<SettingsResult> {
    const id = typeof params?.id === 'string' ? params.id.trim() : ''
    if (!id) throw new Error('portraits.presets.load requires an id')
    const settings = await deps.store.load(userId)
    const prefs = deps.prefs ? await deps.prefs.load(userId) : null
    const includeNpcs = prefs ? prefs.scenePicturePresentNpcs !== false : false
    if (isFactoryPortraitPresetId(id)) {
        const bundle = resolvePortraitPresetBundle(id, includeNpcs)
        return { settings: await deps.store.patch(userId, { portraitNpcSystemPrompt: bundle.npcSystemPrompt, portraitCharacterSystemPrompt: bundle.characterSystemPrompt, portraitLocationSystemPrompt: bundle.locationSystemPrompt, portraitPromptWordTarget: bundle.wordTarget, activePortraitPromptPresetId: id }) }
    }
    const name = id.startsWith('user:') ? id.slice('user:'.length) : ''
    const saved = (settings.savedPortraitPromptPresets ?? {}) as Record<string, SavedPortraitPreset>
    const preset = name ? saved[name] : undefined
    if (!preset) throw new Error(`No art style or saved setup is called "${id}"`)
    const patch: SettingsBag = { activePortraitPromptPresetId: savedPresetId(name) }
    if (preset.npcSystemPrompt !== undefined) patch.portraitNpcSystemPrompt = preset.npcSystemPrompt || ''
    if (preset.characterSystemPrompt !== undefined) patch.portraitCharacterSystemPrompt = preset.characterSystemPrompt || ''
    if (preset.locationSystemPrompt !== undefined) patch.portraitLocationSystemPrompt = preset.locationSystemPrompt || ''
    if (preset.wordTarget !== undefined) patch.portraitPromptWordTarget = preset.wordTarget
    // The legacy's bundle carries the toggle; here it is the scene's preference (49), written when the setup names it.
    if (preset.includePresentNpcs !== undefined && deps.prefs) await deps.prefs.patch({ scenePicturePresentNpcs: !!preset.includePresentNpcs }, userId)
    return { settings: await deps.store.patch(userId, patch) }
}

async function portraitsPresetsSave(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<SettingsResult> {
    const name = typeof params?.name === 'string' ? params.name.trim() : ''
    if (!name) throw new Error('portraits.presets.save requires a name')
    if (isFactoryPortraitPresetName(name)) throw new Error(`"${name}" is a factory art style’s name. Choose a different name for your saved setup.`)
    const settings = await deps.store.load(userId)
    const saved = { ...((settings.savedPortraitPromptPresets ?? {}) as Record<string, SavedPortraitPreset>) }
    if (saved[name] && params?.overwrite !== true) throw new Error(`A setup named "${name}" already exists`)
    const prefs = deps.prefs ? await deps.prefs.load(userId) : null
    saved[name] = {
        npcSystemPrompt: typeof settings.portraitNpcSystemPrompt === 'string' ? settings.portraitNpcSystemPrompt : '',
        characterSystemPrompt: typeof settings.portraitCharacterSystemPrompt === 'string' ? settings.portraitCharacterSystemPrompt : '',
        locationSystemPrompt: typeof settings.portraitLocationSystemPrompt === 'string' ? settings.portraitLocationSystemPrompt : '',
        includePresentNpcs: prefs ? prefs.scenePicturePresentNpcs !== false : false,
        wordTarget: Number(settings.portraitPromptWordTarget) || 200,
    }
    return { settings: await deps.store.patch(userId, { savedPortraitPromptPresets: saved, activePortraitPromptPresetId: savedPresetId(name) }) }
}

async function portraitsPresetsDelete(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<SettingsResult> {
    const name = typeof params?.name === 'string' ? params.name.trim() : ''
    if (!name) throw new Error('portraits.presets.delete requires a name')
    const settings = await deps.store.load(userId)
    const saved = { ...((settings.savedPortraitPromptPresets ?? {}) as Record<string, SavedPortraitPreset>) }
    if (!saved[name]) throw new Error(`No saved setup is called "${name}"`)
    delete saved[name]
    const patch: SettingsBag = { savedPortraitPromptPresets: saved }
    if (settings.activePortraitPromptPresetId === savedPresetId(name)) patch.activePortraitPromptPresetId = ''
    return { settings: await deps.store.patch(userId, patch) }
}

async function resetSettings(
    deps: RequestDeps,
    userId: string | undefined,
    params: Record<string, unknown> | undefined,
): Promise<SettingsResult> {
    const groupIds = params?.groupIds
    if (!Array.isArray(groupIds) || groupIds.length === 0) {
        throw new Error('settings.reset requires groupIds')
    }

    const keys: string[] = []
    for (const id of groupIds) {
        const group = CARTRIDGE_PAYLOAD_GROUPS.find((candidate) => candidate.id === id)
        if (!group) throw new Error(`Unknown settings group: ${String(id)}`)
        keys.push(...group.keys)
    }

    return { settings: await deps.store.resetKeys(userId, keys) }
}

/**
 * Export the live cartridge surface as a shareable file.
 *
 * The payload comes from `buildCartridgePayload`, so the file is byte-
 * compatible with one the legacy build would have written — which is the
 * property the whole test suite exists to hold.
 */
async function exportCartridge(
    deps: RequestDeps,
    userId: string | undefined,
    params: Record<string, unknown> | undefined,
): Promise<CartridgeExportResult> {
    const settings = await deps.store.load(userId)
    const name = typeof params?.name === 'string' && params.name.trim() ? params.name.trim() : 'Game Cartridge'

    const exportObject = buildCartridgeExportObject({
        name,
        description: typeof params?.description === 'string' ? params.description : '',
        icon: typeof params?.icon === 'string' ? params.icon : 'fa-gamepad',
        payload: buildCartridgePayload(settings),
    })

    return {
        file: JSON.stringify(exportObject, null, 2),
        filename: cartridgeFilename(name),
    }
}

/**
 * Load a cartridge file over the live settings.
 *
 * `parseImportedCartridge` rejects anything that is not a cartridge, and
 * `applyCartridgePayload` writes only cartridge-surface keys — so an import
 * cannot reach anything else the user has configured.
 */
async function importCartridge(
    deps: RequestDeps,
    userId: string | undefined,
    params: Record<string, unknown> | undefined,
): Promise<SettingsResult & { name: unknown }> {
    const text = params?.text
    if (typeof text !== 'string') throw new Error('cartridge.import requires the file text')

    const cartridge = parseImportedCartridge(text)
    const settings = await deps.store.replaceCartridgeSurface(userId, (live) => {
        applyCartridgePayload(live, cartridge.payload)
    })

    return { settings, name: cartridge.name }
}

/**
 * The chat a tracker request is about.
 *
 * The frontend supplies it from `ctx.getActiveChat()`, so it is untrusted input
 * as far as the backend is concerned and gets checked here rather than at the
 * storage layer alone.
 */
function requireChatId(params: Record<string, unknown> | undefined, op: string): string {
    const chatId = params?.chatId
    if (typeof chatId !== 'string' || !chatId.trim()) throw new Error(`${op} requires a chatId`)
    return chatId
}

/**
 * One tracker result, memo and archive together.
 *
 * Every tracker op answers with both, because the panel redraws the whole card
 * from whatever it is handed: a reply that carried the memo but not the archive
 * would blank the Completed and Failed sections until the next full read.
 *
 * A failed archive read is logged nowhere and reported as no archive. It is a
 * second file, and being unable to read it must not turn reading the memo —
 * the thing the user asked for — into an error.
 */
async function trackerResult(
    deps: RequestDeps,
    chatId: string,
    userId: string | undefined,
    record: MemoRecord,
): Promise<TrackerResult> {
    const result: TrackerResult = { memo: record.memo, updatedAt: record.updatedAt, lastPass: record.lastPass }

    if (deps.questArchive) {
        try {
            result.archivedQuests = (await deps.questArchive.load(chatId, userId)).quests.map((e) => e.quest)
        } catch {
            result.archivedQuests = []
        }
    }

    return result
}

/** Read a chat's tracker memo. The whole read path hangs off this one call. */
async function getTracker(
    deps: RequestDeps,
    userId: string | undefined,
    params: Record<string, unknown> | undefined,
): Promise<TrackerResult> {
    const chatId = requireChatId(params, 'tracker.get')
    return trackerResult(deps, chatId, userId, await deps.memos.load(chatId, userId))
}

function requirePortraits(deps: RequestDeps): PortraitStore {
    if (!deps.portraits) throw new Error('Portraits are not available in this build.')
    return deps.portraits
}

/** Read a chat's portraits. */
async function getPortraits(
    deps: RequestDeps,
    userId: string | undefined,
    params: Record<string, unknown> | undefined,
): Promise<PortraitsResult> {
    const chatId = requireChatId(params, 'portraits.get')
    if (!deps.portraits) return { portraits: {} }

    try {
        return { portraits: (await deps.portraits.load(chatId, userId)).portraits }
    } catch {
        // A portrait that cannot be read is a missing picture, not an error.
        return { portraits: {} }
    }
}

/** Point an entity at a picture, or clear it with an empty `src`. */
async function setPortrait(
    deps: RequestDeps,
    userId: string | undefined,
    params: Record<string, unknown> | undefined,
): Promise<PortraitsResult> {
    const chatId = requireChatId(params, 'portraits.set')
    const name = params?.name
    if (typeof name !== 'string' || !name.trim()) throw new Error('portraits.set requires an entity name')

    const src = typeof params?.src === 'string' ? params.src : ''
    return { portraits: (await requirePortraits(deps).set(chatId, name, src, userId)).portraits }
}

/**
 * Store a picked image with the host, then point an entity at it.
 *
 * The bytes arrive as a data URL because that is what survives the frontend
 * bridge intact. They are handed straight to the host's image store rather than
 * kept in our own file: the legacy learned that lesson the hard way and had to
 * migrate a generation of embedded data URLs out of its settings.
 */
async function uploadPortrait(
    deps: RequestDeps,
    userId: string | undefined,
    params: Record<string, unknown> | undefined,
): Promise<PortraitsResult> {
    const chatId = requireChatId(params, 'portraits.upload')
    const name = params?.name
    const dataUrl = params?.dataUrl
    if (typeof name !== 'string' || !name.trim()) throw new Error('portraits.upload requires an entity name')
    if (typeof dataUrl !== 'string' || !/^data:image\//i.test(dataUrl)) {
        throw new Error('portraits.upload requires an image')
    }
    if (!deps.images) {
        throw new Error('This build cannot store images. Paste an image URL instead.')
    }

    const filename = typeof params?.filename === 'string' ? params.filename : 'portrait.png'
    const stored = await deps.images.uploadFromDataUrl(dataUrl, filename, userId)
    if (!stored?.url) throw new Error('The image was stored but the host returned no address for it.')

    return { portraits: (await requirePortraits(deps).set(chatId, name, stored.url, userId)).portraits }
}

/**
 * Store a picked backdrop with the host, then write its address into the
 * box's preference (74d). The bytes come as a data URL, scaled by the
 * frontend as the legacy scales them; they go to the host's image store as
 * the portraits do, never into the preferences file.
 */
async function uploadBackdrop(
    deps: RequestDeps,
    userId: string | undefined,
    params: Record<string, unknown> | undefined,
): Promise<PrefsResult> {
    if (!deps.prefs) throw new Error('Display preferences are not available in this build.')
    const box = params?.box
    const slot = params?.slot
    const dataUrl = params?.dataUrl
    if (box !== 'tracker' && box !== 'settings' && box !== 'map') throw new Error('backdrop.upload requires a box: tracker, settings or map')
    if (slot !== 'day' && slot !== 'night') throw new Error('backdrop.upload requires a slot: day or night')
    if (box === 'map' && slot !== 'day') throw new Error('the map’s canvas has one image; its slot is day')
    if (typeof dataUrl !== 'string' || !/^data:image\//i.test(dataUrl)) throw new Error('backdrop.upload requires an image')
    if (!deps.images) throw new Error('This build cannot store images. Paste an image URL instead.')

    const filename = typeof params?.filename === 'string' && params.filename.trim() ? params.filename.trim() : `backdrop-${box}-${slot}.jpg`
    const stored = await deps.images.uploadFromDataUrl(dataUrl, filename, userId)
    if (!stored?.url) throw new Error('The image was stored but the host returned no address for it.')

    // The map's canvas image (74g): the Map Theme's one image, through the same store; the theme is Custom from then on, as the legacy marks it.
    if (box === 'map') {
        const theme = readMapTheme((await deps.prefs.load(userId)).mapTheme)
        return { prefs: await deps.prefs.patch({ mapTheme: { ...theme, backgroundImage: stored.url }, activeMapThemePresetId: '' }, userId) }
    }
    const key = box === 'tracker' ? 'trackerBackdrop' : 'settingsBackdrop'
    const current = readBackdrop((await deps.prefs.load(userId))[key])
    return { prefs: await deps.prefs.patch({ [key]: { ...current, [slot]: stored.url } }, userId) }
}

/**
 * Read the flags the activated list does not carry.
 *
 * `ActivatedWorldInfoEntryDTO` says *that* an entry loaded and by which
 * mechanism, but not whether it was eligible for the other mechanism, nor
 * whether it is a `constant` entry that is always in and matched nothing at
 * all. Both are needed to read the result honestly, and both live on the entry.
 *
 * Read a book at a time rather than an entry at a time: a scene loads a dozen
 * entries from two or three books, and one call per entry would be a dozen
 * round trips for a diagnostic.
 */
async function readBookEntries(
    deps: RequestDeps,
    entries: ActivatedLoreResult['entries'],
    userId: string | undefined,
): Promise<Map<string, { constant?: boolean; vectorized?: boolean }> | null> {
    const list = deps.worldBooks?.listEntries
    if (!list) return null

    const bookIds = [...new Set(entries.map((entry) => entry.bookId).filter(Boolean))] as string[]
    if (!bookIds.length) return null

    const flags = new Map<string, { constant?: boolean; vectorized?: boolean }>()
    for (const bookId of bookIds) {
        try {
            for (const entry of await list(bookId, userId)) {
                flags.set(entry.id, { constant: entry.constant, vectorized: entry.vectorized })
            }
        } catch {
            // A book we cannot read costs its entries' flags and nothing else.
            // The diagnostic is worth more incomplete than absent.
        }
    }
    return flags
}

/**
 * Hang the flags off each entry, and count how much lore could match by
 * meaning at all.
 *
 * Both answers come out of one read of the books, because they are the same
 * read: doing it twice would double a diagnostic's round trips for nothing.
 *
 * The count is the part that matters. `0 of 9`, `0 of 0` and a genuine miss
 * otherwise all arrive as the same empty list, and the first is a switch nobody
 * turned on — which cost a round trip of live testing to notice.
 */
async function describeActivation(
    deps: RequestDeps,
    entries: ActivatedLoreResult['entries'],
    userId: string | undefined,
): Promise<ActivatedLoreResult> {
    const flags = await readBookEntries(deps, entries, userId)
    if (!flags || flags.size === 0) return { entries }

    let vectorized = 0
    for (const entry of flags.values()) if (entry.vectorized) vectorized++

    return {
        entries: entries.map((entry) => ({ ...entry, ...(flags.get(entry.id) ?? {}) })),
        eligibility: { vectorized, total: flags.size },
    }
}

/**
 * Run one pass of the Lorebook Agent, on demand.
 *
 * The first op in this project that writes to a user's campaign. It is manual,
 * and stays manual until the maintainer has watched it work: wiring it to run
 * after every reply before anyone has seen it would find a bug in fifty entries
 * rather than one.
 */
async function runAgent(
    deps: RequestDeps,
    userId: string | undefined,
    params: Record<string, unknown> | undefined,
): Promise<AgentRunResult> {
    const chatId = requireChatId(params, 'agent.run')
    if (!deps.agentPass) {
        return {
            at: new Date().toISOString(),
            outcome: 'failed',
            summary: '',
            steps: [],
            turnsUsed: 0,
            problems: [],
            unavailable: 'This build cannot run the lorebook agent.',
        }
    }
    return deps.agentPass(chatId, userId)
}

/**
 * List the connections a pass can be pointed at.
 *
 * Never throws. A build or a host that cannot list them returns an empty list
 * with a reason, and the panel says so beside an unusable dropdown rather than
 * failing to draw.
 */
async function listConnections(deps: RequestDeps, userId: string | undefined): Promise<ConnectionsResult> {
    if (!deps.connections) return { connections: [], unavailable: 'This build cannot list connections.' }
    return deps.connections(userId)
}

/**
 * Stop a running pass.
 *
 * Never an error when nothing is running. The user pressed a button; the
 * truthful answer is "there was nothing to stop", not a failure.
 */
function cancelPass(
    deps: RequestDeps,
    kind: 'tracker' | 'agent',
    params: Record<string, unknown> | undefined,
): CancelResult {
    const chatId = requireChatId(params, `${kind}.cancel`)
    return { stopped: deps.cancelPass?.(kind, chatId) ?? false }
}

/**
 * Undo the last pass for this chat.
 *
 * Separate op rather than a flag on `agent.run`, because the two have opposite
 * risk: a run adds and can be undone, an undo removes and cannot. They should
 * not share a code path or a button.
 */
async function undoAgent(
    deps: RequestDeps,
    userId: string | undefined,
    params: Record<string, unknown> | undefined,
): Promise<AgentUndoResult> {
    const chatId = requireChatId(params, 'agent.undo')
    if (!deps.agentUndo) {
        return {
            at: new Date().toISOString(),
            summary: '',
            undone: false,
            problems: [],
            unavailable: 'This build cannot undo a lorebook pass.',
        }
    }
    return deps.agentUndo(chatId, userId)
}

/** An undone pass written back (71c). */
async function redoAgent(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<AgentRedoResult> {
    const chatId = requireChatId(params, 'agent.redo')
    if (!deps.agentRedo) return { at: new Date().toISOString(), summary: '', redone: false, problems: [], unavailable: 'This build cannot redo a lorebook pass.' }
    return deps.agentRedo(chatId, userId)
}

/** The cleanup pass (71c): one entry named, or every entry over the threshold, with the user's requirements. */
async function cleanupAgent(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<AgentRunResult> {
    const chatId = requireChatId(params, 'agent.cleanup')
    if (!deps.agentCleanup) {
        return { at: new Date().toISOString(), outcome: 'failed', summary: '', steps: [], turnsUsed: 0, problems: [], unavailable: 'This build cannot run a cleanup pass.' }
    }
    const target = typeof params?.target === 'string' ? params.target.trim() : ''
    const instructions = typeof params?.instructions === 'string' ? params.instructions.trim() : ''
    return deps.agentCleanup(chatId, userId, { ...(target ? { target } : {}), ...(instructions ? { instructions } : {}) })
}

/** The full audit (71c): the whole chat through the agent, in chunks. */
async function auditAgent(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<AgentAuditResult> {
    const chatId = requireChatId(params, 'agent.audit')
    if (!deps.agentAudit) return { at: new Date().toISOString(), status: 'failed', chunks: 0, done: 0, skipped: 0, summaries: [], unavailable: 'This build cannot run a full audit.' }
    return deps.agentAudit(chatId, userId)
}

function stopAudit(deps: RequestDeps, params: Record<string, unknown> | undefined): CancelResult {
    const chatId = requireChatId(params, 'agent.audit.stop')
    return { stopped: deps.agentAuditStop?.(chatId) ?? false }
}

/** The campaign's books cloned under a new prefix (71c). */
async function cloneCampaign(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<CampaignCloneResult> {
    const chatId = requireChatId(params, 'campaign.clone')
    if (!deps.campaignClone) return { newPrefix: '', cloned: [], errors: [], unavailable: 'This build cannot clone a campaign\u2019s books.' }
    return deps.campaignClone(chatId, userId, typeof params?.newPrefix === 'string' ? params.newPrefix : '')
}

/**
 * Ask the host what lore it loaded for this chat, and how.
 *
 * Purely diagnostic, and deliberately so: it activates nothing and writes
 * nothing. It exists because the open question about the Lorebook Agent —
 * whether Lumiverse's own activation finds the entries that matter, or only the
 * ones whose keywords are spelled out in the scene — is *observable*, and
 * arguing about it when the host will simply say is the wrong way round.
 *
 * A host that cannot answer reports why rather than throwing. `world_books` may
 * be ungranted, and an older Lumiverse may not have `getActivated` at all;
 * neither is an error worth interrupting the panel for.
 */
async function getActivatedLore(
    deps: RequestDeps,
    userId: string | undefined,
    params: Record<string, unknown> | undefined,
): Promise<ActivatedLoreResult> {
    const chatId = requireChatId(params, 'lore.activated')
    if (!deps.worldBooks?.getActivated) {
        return { entries: [], unavailable: 'This build cannot ask the host what lore it loaded.' }
    }

    try {
        const found = await deps.worldBooks.getActivated(chatId, userId)
        const entries = Array.isArray(found) ? found : []
        return describeActivation(deps, entries, userId)
    } catch (error) {
        // The host's own words, as everywhere else — a permission error here
        // reads as `world_books` being ungranted, and saying so beats a blank
        // list that looks like "nothing matched".
        return { entries: [], unavailable: error instanceof Error ? error.message : String(error) }
    }
}

/** Read this install's display preferences. */
async function getPrefs(deps: RequestDeps, userId: string | undefined): Promise<PrefsResult> {
    if (!deps.prefs) return { prefs: { messageCards: true, bars: {} } }
    return { prefs: await deps.prefs.load(userId) }
}

/** The chat's campaign name (51), minted from the card and the clock when it has none. */
async function campaignName(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined) {
    if (!deps.campaign) throw new Error('This build cannot name campaigns.')
    const chatId = requireChatId(params, 'campaign.name')
    const characterId = typeof params?.characterId === 'string' && params.characterId.trim() ? { characterId: params.characterId.trim() } : {}
    return deps.campaign.name({ chatId, userId, ...characterId })
}

/** Change a display preference. Returns the whole set, as `prefs.get` does. */
async function patchPrefs(
    deps: RequestDeps,
    userId: string | undefined,
    params: Record<string, unknown> | undefined,
): Promise<PrefsResult> {
    if (!deps.prefs) throw new Error('Display preferences are not available in this build.')

    const patch = params?.patch
    if (!patch || typeof patch !== 'object') throw new Error('prefs.patch requires a patch object')

    const before = 'scenePicturePresentNpcs' in patch ? await deps.prefs.load(userId) : null
    const prefs = await deps.prefs.patch(patch, userId)
    // The present-NPCs toggle (63b, the legacy's `syncPortraitLocationPromptForNpcToggle`):
    // a location prompt that is still a shipped text follows the toggle to its
    // matching variant, in its own style; an edited one is never touched.
    if (before && before.scenePicturePresentNpcs !== prefs.scenePicturePresentNpcs) {
        const settings = await deps.store.load(userId)
        const next = locationPromptForToggle(typeof settings.portraitLocationSystemPrompt === 'string' ? settings.portraitLocationSystemPrompt : '', prefs.scenePicturePresentNpcs, typeof settings.activePortraitPromptPresetId === 'string' ? settings.activePortraitPromptPresetId : '')
        if (next !== null) return { prefs, settings: await deps.store.patch(userId, { portraitLocationSystemPrompt: next }) }
    }
    return { prefs }
}

/**
 * Every snapshot this chat has kept.
 *
 * Sent whole rather than one message at a time: the chat list is virtualized,
 * so the cards are needed in bursts as the user scrolls, and a request per
 * bubble would be a request storm for a few kilobytes of text.
 */
/** The last reports of each kind (47e). Never throws: an empty history draws as no history. */
async function getReportsHistory(
    deps: RequestDeps,
    userId: string | undefined,
    params: Record<string, unknown> | undefined,
): Promise<ReportsHistoryResult> {
    const chatId = requireChatId(params, 'reports.history')
    if (!deps.reports) return { tracker: [], agent: [] }
    try {
        const record = await deps.reports.load(chatId, userId)
        return { tracker: record.tracker, agent: record.agent }
    } catch {
        return { tracker: [], agent: [] }
    }
}

async function getTrackerHistory(
    deps: RequestDeps,
    userId: string | undefined,
    params: Record<string, unknown> | undefined,
): Promise<TrackerHistoryResult> {
    const chatId = requireChatId(params, 'tracker.history')
    if (!deps.memoHistory) return { snapshots: [] }

    try {
        return { snapshots: (await deps.memoHistory.load(chatId, userId)).snapshots }
    } catch {
        // A card that cannot be drawn is not worth an error in the panel.
        return { snapshots: [] }
    }
}

/**
 * Empty a chat's quest archive.
 *
 * The archive's only escape hatch. Everything else in the tracker a user can
 * correct by hand through the raw memo; a finished quest is not in the memo, so
 * without this a quest the model wrongly declared complete would sit in the log
 * for the life of the campaign.
 */
async function clearQuestArchive(
    deps: RequestDeps,
    userId: string | undefined,
    params: Record<string, unknown> | undefined,
): Promise<TrackerResult> {
    const chatId = requireChatId(params, 'tracker.clearArchive')
    if (!deps.questArchive) throw new Error('The quest archive is not available in this build.')

    await deps.questArchive.clear(chatId, userId)
    return trackerResult(deps, chatId, userId, await deps.memos.load(chatId, userId))
}

/**
 * The choices every narrator reply in the chat offers.
 *
 * Read from the messages rather than from the rendered bubble: what Lumiverse
 * makes of a `<button>` inside a reply is its business, and the buttons here
 * are made from the text the model actually wrote.
 */
async function listChoices(
    deps: RequestDeps,
    params: Record<string, unknown> | undefined,
): Promise<CyoaChoicesResult> {
    const chatId = requireChatId(params, 'cyoa.choices')
    if (!deps.chat) return { messages: [] }
    const messages = await deps.chat.getMessages(chatId)
    return {
        messages: messages
            .filter((message) => message.role === 'assistant')
            .map((message) => ({ messageId: message.id, choices: extractChoices(message.content) }))
            .filter((entry) => entry.choices.length > 0),
    }
}

/**
 * Send a choice as the user's own message, and start the narrator's reply.
 *
 * The legacy fills SillyTavern's send box with the button's text and presses
 * its send button; the host here appends the message and triggers the
 * generation in one call. The text is sent as the model wrote it, number and
 * mechanics included, exactly as the legacy sends it.
 */
async function choose(
    deps: RequestDeps,
    userId: string | undefined,
    params: Record<string, unknown> | undefined,
): Promise<CyoaChooseResult> {
    const chatId = requireChatId(params, 'cyoa.choose')
    const text = typeof params?.text === 'string' ? params.text.trim() : ''
    if (!text) throw new Error('cyoa.choose requires the choice text')
    if (!deps.chatAppend) throw new Error('This build cannot send a choice.')
    const { id } = await deps.chatAppend(chatId, text, userId)
    return { messageId: id }
}

/**
 * The game system wizard: a draft from a description, or a revision of one.
 *
 * The context it reads (window, memo, the user's own architect prompt) and
 * the connection (the agent's) come from preferences, so the panel sends only
 * what the user typed. Nothing is written: the draft comes back for the
 * panel to edit and save through `settings.patch`.
 */
async function wizardContext(deps: RequestDeps, userId: string | undefined, chatId: string) {
    const prefs = deps.prefs ? await deps.prefs.load(userId) : undefined
    return {
        chatId,
        userId,
        lookback: prefs?.wizardLookback ?? DEFAULT_WIZARD_LOOKBACK,
        lookbackAll: prefs?.wizardLookbackAll === true,
        injectMemo: prefs?.wizardInjectMemo ?? false,
        injectLore: prefs?.wizardInjectLore === true,
        injectModulePrompts: prefs?.wizardInjectModulePrompts === true,
        moduleExampleKeys: Array.isArray(prefs?.wizardModuleExampleKeys) ? prefs.wizardModuleExampleKeys : [],
        systemPrompt: prefs?.wizardSystemPrompt ?? '',
        connectionId: prefs?.agentConnectionId || undefined,
    }
}

async function wizardDraft(
    deps: RequestDeps,
    userId: string | undefined,
    params: Record<string, unknown> | undefined,
): Promise<WizardDraftResult> {
    const chatId = requireChatId(params, 'wizard.draft')
    const description = typeof params?.description === 'string' ? params.description.trim() : ''
    if (!description) throw new Error('wizard.draft requires a description')
    if (!deps.wizard) throw new Error('This build cannot run the game system wizard.')
    const effectOwner = params?.effectOwner === 'gm' ? 'gm' : 'tracker'
    const draft = await deps.wizard.draft({ ...(await wizardContext(deps, userId, chatId)), description, effectOwner })
    return { draft }
}

async function wizardRevise(
    deps: RequestDeps,
    userId: string | undefined,
    params: Record<string, unknown> | undefined,
): Promise<WizardReviseResult> {
    const chatId = requireChatId(params, 'wizard.revise')
    const draft = params?.draft
    if (!draft || typeof draft !== 'object') throw new Error('wizard.revise requires the draft')
    const mode = params?.mode
    if (mode !== 'revise' && mode !== 'gm' && mode !== 'tracker' && mode !== 'both') throw new Error('wizard.revise requires a mode')
    if (!deps.wizard) throw new Error('This build cannot run the game system wizard.')
    const halves = await deps.wizard.revise({
        ...(await wizardContext(deps, userId, chatId)),
        description: typeof params?.description === 'string' ? params.description : '',
        draft: draft as WizardDraft,
        mode,
        ...(typeof params?.feedback === 'string' ? { feedback: params.feedback } : {}),
    })
    return { halves }
}

/** The text of a send bar, or nothing: blank is the same as absent. */
function readInstruction(params: Record<string, unknown> | undefined, op: string): string {
    const instruction = typeof params?.instruction === 'string' ? params.instruction.trim() : ''
    if (!instruction) throw new Error(`${op} requires an instruction`)
    return instruction
}

/**
 * Run the Lorebook Agent with an instruction from the user.
 *
 * Multihog's 💬: the same pass as the button, with what the user typed as
 * its own section after the narrative and the send bar's own window of
 * messages instead of the pass's.
 */
async function instructAgent(
    deps: RequestDeps,
    userId: string | undefined,
    params: Record<string, unknown> | undefined,
): Promise<AgentRunResult> {
    const chatId = requireChatId(params, 'agent.instruct')
    const instruction = readInstruction(params, 'agent.instruct')
    if (!deps.agentInstruct) {
        return {
            at: new Date().toISOString(),
            outcome: 'failed',
            summary: '',
            steps: [],
            turnsUsed: 0,
            problems: [],
            unavailable: 'This build cannot run the lorebook agent.',
        }
    }
    return deps.agentInstruct(chatId, userId, instruction)
}

/**
 * Run a tracker pass with an instruction from the user.
 *
 * Multihog's 💬 for the State Tracker, its `sendDirectPrompt`: the memo is
 * corrected or set up by asking, rather than by hand-editing the raw text.
 * The window comes from the send bar's own preference, not the pass's
 * lookback, because an instruction rarely wants the same slice of story a
 * turn does.
 */
async function instructTracker(
    deps: RequestDeps,
    userId: string | undefined,
    params: Record<string, unknown> | undefined,
): Promise<TrackerResult> {
    const chatId = requireChatId(params, 'tracker.instruct')
    const instruction = readInstruction(params, 'tracker.instruct')
    if (!deps.trackerPass) throw new Error('The tracker pass is not available in this build.')

    const window = deps.prefs ? (await deps.prefs.load(userId)).trackerDirectLookback : DEFAULT_TRACKER_DIRECT_LOOKBACK
    await deps.trackerPass.run({ chatId, userId, trigger: 'direct', instruction, window })
    return trackerResult(deps, chatId, userId, await deps.memos.load(chatId, userId))
}

/**
 * Run a tracker pass now, rather than waiting for the next reply.
 *
 * This exists because a pass that changes nothing is indistinguishable from one
 * that never ran. Being able to press it and read the outcome is the difference
 * between "the tracker is broken" and "the model was asked and declined".
 */
async function runTracker(
    deps: RequestDeps,
    userId: string | undefined,
    params: Record<string, unknown> | undefined,
): Promise<TrackerResult> {
    const chatId = requireChatId(params, 'tracker.run')
    if (!deps.trackerPass) throw new Error('The tracker pass is not available in this build.')

    await deps.trackerPass.run({ chatId, userId, trigger: 'manual' })
    return trackerResult(deps, chatId, userId, await deps.memos.load(chatId, userId))
}

/**
 * Replace a chat's tracker memo.
 *
 * This is the raw-memo editor's write, and for now the only writer there is:
 * the extractor pass that will normally produce a memo is the write path, and
 * has not landed. Hand-editing the memo is a real feature of the legacy build,
 * not a test hook — it is how a user corrects a value the model got wrong.
 */
async function setTrackerMemo(
    deps: RequestDeps,
    userId: string | undefined,
    params: Record<string, unknown> | undefined,
): Promise<TrackerResult> {
    const chatId = requireChatId(params, 'tracker.setMemo')
    const memo = params?.memo
    if (typeof memo !== 'string') throw new Error('tracker.setMemo requires the memo text')

    const current = await deps.memos.load(chatId, userId)
    const record = await deps.memos.save(chatId, memo, userId, {
        // A hand edit is a new baseline, so it becomes the roll-back point too.
        previous: current.memo,
        lastMessageId: current.lastMessageId,
        lastPass: current.lastPass,
    })
    return trackerResult(deps, chatId, userId, record)
}

/**
 * Write a stored snapshot back as the live memo.
 *
 * The maintainer's example: a chat is 83 messages long, someone deletes 81, 82
 * and 83, and the tracker should go back to what it said before them.
 *
 * **Named by message, never by index.** The history is capped and every tracked
 * turn pushes an entry in, so a position the panel read a minute ago can point
 * somewhere else by the time the button is pressed — and the state it would
 * then overwrite the live memo with would be nobody's choice. A message id that
 * is no longer in the history is refused rather than approximated.
 *
 * **The history itself is untouched.** Multihog kept its snapshots only for
 * this stepping; here the same store draws the card under every message, so a
 * restore that rewrote it would silently change what those cards say about
 * turns it was not asked about. The live memo is the only thing that moves.
 */
async function restoreTrackerMemo(
    deps: RequestDeps,
    userId: string | undefined,
    params: Record<string, unknown> | undefined,
): Promise<TrackerResult> {
    const chatId = requireChatId(params, 'tracker.restore')
    const messageId = params?.messageId
    if (typeof messageId !== 'string' || !messageId) {
        throw new Error('tracker.restore requires the message whose state to restore')
    }
    if (!deps.memoHistory) throw new Error('This build does not keep tracker history.')

    const { snapshots } = await deps.memoHistory.load(chatId, userId)
    const snapshot = findByMessage(snapshots, messageId)
    if (!snapshot) {
        throw new Error('That state is no longer in this chat\'s history, so nothing was changed.')
    }

    const current = await deps.memos.load(chatId, userId)
    const record = await deps.memos.save(chatId, snapshot.memo, userId, {
        // The memo it replaced becomes the roll-back point, exactly as a hand
        // edit does: a restore is a deliberate new baseline, and a swipe
        // immediately afterwards should undo the reply, not the restore.
        previous: current.memo,
        lastMessageId: current.lastMessageId,
        lastPass: current.lastPass,
    })
    return trackerResult(deps, chatId, userId, record)
}

/**
 * What is running, and what it is allowed to do.
 *
 * Two questions came up in every live debugging session so far — *did my update
 * take?* and *is the permission actually there?* — and neither could be
 * answered from the panel. Both answers existed only in the backend log, which
 * is not somewhere a user goes.
 *
 * A host that offers no way to tell reports `checked: false` rather than an
 * empty grant list, because "nothing is granted" and "cannot tell" need
 * different words on screen.
 */
async function getStatus(deps: RequestDeps, userId: string | undefined): Promise<StatusResult> {
    const base: StatusResult = deps.status ? await deps.status(userId) : { version: '', granted: [], missing: [], checked: false }
    const stockUpgrade = deps.stockUpgrade?.last(userId)
    return stockUpgrade ? { ...base, stockUpgrade } : base
}

// ── Debug & factory reset (72a) ───────────────────────────────────────────

const MAINTENANCE_UNAVAILABLE = 'This build cannot run the resets.'

function maintenanceOf(deps: RequestDeps): Maintenance {
    if (!deps.maintenance) throw new Error(MAINTENANCE_UNAVAILABLE)
    return deps.maintenance
}

/** Dispatch one request. Throws on a bad op or bad params; the caller replies with the error. */
// ── World Progression (roadmap row 8) ─────────────────────────────────────

const WORLD_UNAVAILABLE = 'This build cannot run World Progression.'

async function worldStatus(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<WorldStatusResult> {
    const chatId = requireChatId(params, 'world.get')
    if (!deps.world) {
        return {
            enabled: false, intervalHours: 24, locationsPerReport: 3, keepActive: 1, lookback: 20, prefix: '', worldBookName: '', lastFiredPeriodLabel: '', nextDueLabel: '', currentTimeLabel: '', activeReports: [],
            skeletonBookName: '', skeletonCounts: { factions: 0, locations: 0, conflicts: 0 }, skeletonSource: '',
            skeleton: { factions: 4, locations: 4, conflicts: 3, systemPrompt: '', useLorebooks: false, lorebookOnly: false, lorebookFilter: '', useExisting: true, sourceLookback: 30 },
            unavailable: WORLD_UNAVAILABLE,
        }
    }
    return deps.world.status(chatId, userId)
}

/** Write a report now, whatever the clock says, with the user's instructions for this run. */
async function worldRun(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<WorldRunResult> {
    const chatId = requireChatId(params, 'world.run')
    if (!deps.world) throw new Error(WORLD_UNAVAILABLE)
    const extra = typeof params?.extraInstructions === 'string' ? params.extraInstructions : undefined
    return deps.world.run({ chatId, userId, trigger: 'manual', ...(extra?.trim() ? { extraInstructions: extra } : {}) })
}

async function worldReset(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<WorldStatusResult> {
    const chatId = requireChatId(params, 'world.reset')
    if (!deps.world) throw new Error(WORLD_UNAVAILABLE)
    await deps.world.resetTimeline(chatId, userId)
    return deps.world.status(chatId, userId)
}

/** The oldest N raw reports consolidated now (72b). */
async function worldConsolidate(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<WorldConsolidateResult> {
    const chatId = requireChatId(params, 'world.consolidate')
    if (!deps.world) throw new Error(WORLD_UNAVAILABLE)
    const count = Math.floor(Number(params?.count))
    if (!Number.isFinite(count) || count < 2) throw new Error('world.consolidate requires a count of at least 2')
    return deps.world.consolidateNow(chatId, userId, count)
}

/** The next report's time set by hand (72b). */
async function worldOverrideNext(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<WorldStatusResult> {
    const chatId = requireChatId(params, 'world.overrideNext')
    if (!deps.world) throw new Error(WORLD_UNAVAILABLE)
    const next = typeof params?.next === 'string' ? params.next.trim() : ''
    if (!next) throw new Error('world.overrideNext requires the next time')
    await deps.world.overrideNext(chatId, userId, next)
    return deps.world.status(chatId, userId)
}

/** Every book the host has (73h), sorted by name, for the tracker's lorebook filter. */
/** The AI Theme Wizard's call (74b): New with a description, Iterate with the change asked for. */
async function themeGenerate(deps: RequestDeps, userId: string | undefined, params: unknown): Promise<ThemeGenerateResult> {
    if (!deps.theme) throw new Error('This build cannot run the AI Theme Wizard.')
    const p = (params ?? {}) as { description?: unknown; iterate?: unknown }
    return deps.theme.generate(userId, typeof p.description === 'string' ? p.description : '', p.iterate === true)
}

/** Edit with AI (78c): the kind, the text as it stands and the instructions; the revised text back, nothing written. */
async function recordsAiEdit(deps: RequestDeps, userId: string | undefined, params: unknown): Promise<CardAiEditResult> {
    if (!deps.cardEdit) throw new Error('This build cannot edit a card with AI.')
    const p = (params ?? {}) as { kind?: unknown; content?: unknown; instructions?: unknown }
    const kind = p.kind === 'pc' ? 'pc' : 'npc'
    return deps.cardEdit.edit(userId, kind, typeof p.content === 'string' ? p.content : '', typeof p.instructions === 'string' ? p.instructions : '')
}

async function booksList(deps: RequestDeps, userId: string | undefined): Promise<BooksListResult> {
    if (!deps.books) throw new Error('This build cannot list the host’s lorebooks.')
    const books = (await deps.books.list(userId)).map((book) => ({ id: book.id, name: book.name }))
    books.sort((a, b) => a.name.localeCompare(b.name))
    return { books }
}

/** An empty narrator card under the chosen name (72b), or the one that already carries it. */
async function narratorCreate(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<NarratorCardResult> {
    if (!deps.characters) throw new Error('This build cannot make character cards: the host has not granted the characters permission.')
    const name = (typeof params?.name === 'string' ? params.name.trim() : '').slice(0, 120) || 'Game Master'
    const existing = (await deps.characters.list(userId)).find((c) => c.name.trim().toLowerCase() === name.toLowerCase())
    if (existing) return { id: existing.id, name: existing.name, created: false }
    const made = await deps.characters.create(name, userId)
    return { id: made.id, name: made.name, created: true }
}

/** The NPC word targets the builders read (72b): the preferences, or the shipped numbers on a build without them. */
async function npcWordTargets(deps: RequestDeps, userId: string | undefined): Promise<NpcWordTargets> {
    const prefs = deps.prefs ? await deps.prefs.load(userId) : null
    const bound = (value: unknown, fallback: number) => { const n = Math.floor(Number(value)); return Number.isFinite(n) && n >= 1 ? Math.min(MAX_NPC_WORDS, n) : fallback }
    return { major: bound(prefs?.npcMajorWords, DEFAULT_NPC_MAJOR_WORDS), minor: bound(prefs?.npcMinorWords, DEFAULT_NPC_MINOR_WORDS) }
}

/**
 * The factory's stock prompts (36) and agent modules (47e) alone: the two
 * editors' Reset to stock and edited badges. Since 77 the NPC, LOC and FAC
 * instructions are the legacy's live stock — built from the cartridge's
 * sections, its date format and the word targets, as the legacy's factory
 * builds its own on every read — so a sections change leaves the three rows
 * without an *edited* badge, and Reset to stock puts the sections' text back.
 */
async function factorySettings(deps: RequestDeps, userId: string | undefined): Promise<{ stockPrompts: Record<string, string>; routerModules: Record<string, unknown> }> {
    const factory = getFactoryCartridgePayload() as { stockPrompts?: Record<string, string>; routerModules?: Record<string, StoredAgentModule> }
    const routerModules: Record<string, StoredAgentModule> = { ...(factory.routerModules ?? {}) }
    const settings = await deps.store.load(userId)
    const stock = stockModuleInstructions(settings, await npcWordTargets(deps, userId))
    for (const key of ['npc', 'loc', 'fac'] as const) {
        if (routerModules[key]) routerModules[key] = { ...routerModules[key], instruction: stock[key] }
    }
    return { stockPrompts: factory.stockPrompts ?? {}, routerModules }
}

/**
 * The NPC or PC sections saved from the editor (77): the cartridge key
 * written through its validator and, for the NPC sections, the agent's NPC,
 * LOC and FAC instructions rebuilt as the legacy's Save rebuilds them —
 * where they still read as the stock built from the settings before; an
 * edited one is kept and named. The answer carries the settings whole, so
 * every editor re-seeds, the Agent modules editor among them.
 */
async function settingsSections(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<SettingsResult & { rebuilt: string[]; kept: string[] }> {
    const kind = params?.kind === 'npc' || params?.kind === 'pc' ? params.kind : null
    if (!kind) throw new Error('settings.sections requires kind "npc" or "pc"')
    const key = kind === 'npc' ? 'npcCoreSections' : 'pcCoreSections'
    // A copy: the store hands back the object it will go on to mutate, and the rebuild rule reads the settings as they stood.
    const before = JSON.parse(JSON.stringify(await deps.store.load(userId))) as Record<string, unknown>
    let settings = await deps.store.patch(userId, { [key]: params?.sections })
    if (kind === 'pc') return { settings, rebuilt: [], kept: [] }
    const modules = (settings.routerModules ?? {}) as Record<string, StoredAgentModule>
    const result = rebuildModuleInstructions(modules, before, settings, await npcWordTargets(deps, userId))
    // The request layer has no logger of its own: the editor's note names what was rebuilt and what was kept.
    if (result.rebuilt.length) settings = await deps.store.patch(userId, { routerModules: result.routerModules })
    return { settings, rebuilt: result.rebuilt, kept: result.kept }
}

/** The NPC word targets (72b): kept as preferences, and written into the NPC module's instruction as the legacy writes them. */
async function settingsNpcWords(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<SettingsResult & PrefsResult & { applied: boolean }> {
    const bound = (value: unknown, fallback: number) => { const n = Math.floor(Number(value)); return Number.isFinite(n) ? Math.min(MAX_NPC_WORDS, Math.max(1, n)) : fallback }
    const major = bound(params?.major, DEFAULT_NPC_MAJOR_WORDS)
    const minor = bound(params?.minor, DEFAULT_NPC_MINOR_WORDS)
    if (!deps.prefs) throw new Error('Display preferences are not available in this build.')
    await deps.prefs.patch({ npcMajorWords: major, npcMinorWords: minor }, userId)
    const settings = await deps.store.load(userId)
    const modules = (settings.routerModules ?? {}) as Record<string, { instruction?: string } & Record<string, unknown>>
    const npc = modules.npc
    const rewritten = npc ? applyNpcWordTargets(String(npc.instruction ?? ''), major, minor) : { instruction: '', applied: false }
    const prefs = await deps.prefs.load(userId)
    if (!npc || !rewritten.applied) return { settings, prefs, applied: false }
    const next = await deps.store.patch(userId, { routerModules: { ...modules, npc: { ...npc, instruction: rewritten.instruction } } })
    return { settings: next, prefs, applied: true }
}

/** Generate the World Skeleton (33b) from the user's source text: a fresh one, or more premises added to the one there. */
async function worldSkeleton(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<WorldSkeletonResult> {
    const chatId = requireChatId(params, 'world.skeleton')
    if (!deps.world) throw new Error(WORLD_UNAVAILABLE)
    const source = typeof params?.source === 'string' ? params.source : ''
    const mode = params?.mode === 'append' ? 'append' : 'replace'
    return deps.world.skeleton({ chatId, userId, source, mode })
}

/** Write the skeleton's source from the recent chat (33c): one generalised paragraph, no names. */
async function worldSkeletonSource(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<WorldSourceResult> {
    const chatId = requireChatId(params, 'world.skeletonSource')
    if (!deps.world) throw new Error(WORLD_UNAVAILABLE)
    return deps.world.writeSource({ chatId, userId })
}

/** The lorebooks the skeleton may read as canon (33c). */
async function worldBooks(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<WorldBooksResult> {
    const chatId = requireChatId(params, 'world.books')
    if (!deps.world) throw new Error(WORLD_UNAVAILABLE)
    return { books: await deps.world.books(chatId, userId) }
}

/** Empty the campaign's _World book, and its _Skeleton unless told to keep it, and forget the clock. Irreversible. */
async function worldPurge(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<WorldPurgeResult> {
    const chatId = requireChatId(params, 'world.purge')
    if (!deps.world) throw new Error(WORLD_UNAVAILABLE)
    return deps.world.purge({ chatId, userId, includeSkeleton: params?.includeSkeleton !== false })
}

// ── The hidden map (roadmap row 9) ───────────────────────────────────────

/** Re-read the maps now and report them: the panel's view, and the one refresh that does not wait for a reply. */
async function mapStatus(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<MapStatusResult> {
    const chatId = requireChatId(params, 'map.get')
    if (!deps.map) {
        return { enabled: false, currentLocation: '', sites: [], activeSiteRoot: '', mentionedSiteRoots: [], canonChars: 0, syncedAt: '', architect: { toolRegistered: false, opener: 'tool', lookback: 12, systemPrompt: '' }, updater: { enabled: false, runEvery: 1, lookback: 4, systemPrompt: '', running: false }, evolution: { ...EVOLUTION_UNAVAILABLE }, unavailable: 'This build cannot read maps.' }
    }
    const record = await deps.map.sync.refresh(chatId, userId)
    return {
        enabled: await deps.map.enabled(userId),
        currentLocation: record.currentLocation,
        sites: record.sites,
        activeSiteRoot: record.activeSiteRoot,
        mentionedSiteRoots: record.mentionedSiteRoots,
        canonChars: record.canonBlock.length,
        syncedAt: record.syncedAt,
        ...(record.problem ? { problem: record.problem } : {}),
        architect: await deps.map.architect(userId),
        ...(record.lastArchitect ? { lastArchitect: record.lastArchitect } : {}),
        updater: { ...(await deps.map.updater.options(userId)), running: deps.map.updater.running(chatId) },
        ...(record.lastUpdater ? { lastUpdater: record.lastUpdater } : {}),
        evolution: await deps.map.evolution.status(chatId, userId),
        ...(record.lastEvolution ? { lastEvolution: record.lastEvolution } : {}),
    }
}

const EVOLUTION_UNAVAILABLE: MapEvolutionStatus = { enabled: false, intervalHours: 12, onSiteIntervalHours: 1, onSiteIntervalMinutes: 0, onSitePreset: 'dynamic', scope: 'all', count: 1, randomize: true, selectedRoots: '', worldReportLookback: 5, storyLookback: 20, connectionId: '', systemPrompt: '', compressEnabled: true, compressThreshold: 10000, narratorCommitTokens: 2000, running: false, currentTime: '', lastFired: '', nextDue: '', sites: [] }

/** A site's own hours between Evolution passes (71d): a number sets them, 0 for never, null or '' clears them. */
async function mapEvolutionInterval(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<MapEvolutionIntervalResult> {
    const chatId = requireChatId(params, 'map.evolution.interval')
    const siteRoot = requireSiteRoot(params, 'map.evolution.interval')
    if (!deps.map?.evolution.setSiteInterval) throw new Error('This build cannot set a site’s interval.')
    const raw = params?.hours
    const hours = raw === null || raw === undefined || raw === '' ? null : Math.floor(Number(raw))
    if (hours !== null && (!Number.isFinite(hours) || hours < 0)) throw new Error('map.evolution.interval takes hours of 0 or more, or null to inherit')
    return deps.map.evolution.setSiteInterval(chatId, userId, siteRoot, hours)
}

/** Multihog's Reset Timeline on the Map Evolution drawer (78a): the clocks forgotten, nothing else touched. */
async function mapEvolutionReset(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<{ reset: true }> {
    const chatId = requireChatId(params, 'map.evolution.reset')
    if (!deps.map?.evolution.resetTimeline) throw new Error('This build cannot reset the evolution timeline.')
    await deps.map.evolution.resetTimeline(chatId, userId)
    return { reset: true }
}

function requireSandbox(deps: RequestDeps): MapSandbox {
    if (!deps.map?.sandbox) throw new Error('This build has no Testing Ground.')
    return deps.map.sandbox
}

const text = (params: Record<string, unknown> | undefined, key: string): string => (typeof params?.[key] === 'string' ? (params[key] as string) : '')

/** The Testing Ground's three model-calling ops (71d), each its own handler so the deadline lock finds them: one pass on the site, N ticks of time and passes, and the last of either run again. */
async function mapSandboxEvolve(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<MapSandboxOutcome> {
    const chatId = requireChatId(params, 'map.sandbox.evolve')
    requireSandbox(deps)
    return deps.map!.sandbox!.evolve(chatId, userId, requireSiteRoot(params, 'map.sandbox.evolve'))
}

async function mapSandboxSimulate(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<MapSandboxOutcome> {
    const chatId = requireChatId(params, 'map.sandbox.simulate')
    requireSandbox(deps)
    return deps.map!.sandbox!.simulate(chatId, userId, { siteRoot: requireSiteRoot(params, 'map.sandbox.simulate'), ticks: Number(params?.ticks) || 1, hoursPerTick: Number(params?.hoursPerTick) || 0 })
}

async function mapSandboxRedo(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<MapSandboxOutcome> {
    const chatId = requireChatId(params, 'map.sandbox.redo')
    requireSandbox(deps)
    return deps.map!.sandbox!.redo(chatId, userId)
}

/** The Testing Ground's six lookup ops (71d), each on the chat named. */
async function mapSandbox(deps: RequestDeps, userId: string | undefined, op: string, params: Record<string, unknown> | undefined): Promise<MapSandboxResult | MapSandboxOutcome> {
    const chatId = requireChatId(params, op)
    const sandbox = requireSandbox(deps)
    switch (op) {
        case 'map.sandbox.get':
            return sandbox.describe(chatId, userId, text(params, 'siteRoot'), text(params, 'arcSubject'))
        case 'map.sandbox.time': {
            if (typeof params?.minutes === 'number') return sandbox.advance(chatId, userId, params.minutes)
            return sandbox.setTime(chatId, userId, text(params, 'label'))
        }
        case 'map.sandbox.asset.add':
            return sandbox.addAsset(chatId, userId, { siteRoot: requireSiteRoot(params, op), name: text(params, 'name'), kind: text(params, 'kind'), location: text(params, 'location'), state: text(params, 'state'), faction: text(params, 'faction'), detail: text(params, 'detail'), count: text(params, 'count'), cause: text(params, 'cause'), actor: text(params, 'actor') })
        case 'map.sandbox.asset.set':
            return sandbox.setAsset(chatId, userId, { siteRoot: requireSiteRoot(params, op), assetId: text(params, 'assetId'), state: text(params, 'state'), detail: text(params, 'detail'), count: text(params, 'count'), cause: text(params, 'cause'), actor: text(params, 'actor'), threadStatus: text(params, 'threadStatus') })
        case 'map.sandbox.undo':
            return sandbox.undo(chatId, userId)
        case 'map.sandbox.clear':
            return sandbox.clearHistory(chatId, userId, requireSiteRoot(params, op))
        default:
            throw new Error(`Unknown sandbox op: ${op}`)
    }
}

/** A Map Evolution pass now (34c): on the party's site or named ones, with an instruction if given. */
async function mapEvolve(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<MapEvolutionResult> {
    const chatId = requireChatId(params, 'map.evolve')
    if (!deps.map) throw new Error('This build cannot evolve maps.')
    const instruction = typeof params?.instruction === 'string' ? params.instruction : ''
    const siteRoots = Array.isArray(params?.siteRoots) ? params.siteRoots.filter((r): r is string => typeof r === 'string' && !!r.trim()) : []
    const lookback = Number.isFinite(Number(params?.lookback)) && typeof params?.lookback !== 'undefined' ? { lookback: Math.max(0, Math.min(100, Math.floor(Number(params.lookback)))) } : {}
    return deps.map.evolution.run({ chatId, userId, instruction, ...(siteRoots.length ? { siteRoots } : {}), ...lookback })
}

/** The character creator (Phase 35): the sheet, from the form's draft. */
async function creatorGenerate(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<CreatorResult> {
    const chatId = requireChatId(params, 'creator.generate')
    if (!deps.creator) throw new Error('This build cannot create characters.')
    return deps.creator.generate({
        chatId,
        userId,
        draft: params?.draft,
        ...(typeof params?.playerCard === 'boolean' ? { playerCard: params.playerCard } : {}),
        ...(typeof params?.persona === 'boolean' ? { persona: params.persona } : {}),
        ...(typeof params?.cardWords === 'number' ? { cardWords: params.cardWords } : {}),
    })
}

/** Instant Action (35a): a genre, a name or none, a line of setup, and whether to begin. */
async function creatorInstant(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<InstantResult> {
    const chatId = requireChatId(params, 'creator.instant')
    if (!deps.creator) throw new Error('This build cannot create characters.')
    const genre = typeof params?.genre === 'string' ? params.genre : ''
    if (!genre) throw new Error('creator.instant requires a genre')
    return deps.creator.instant({
        chatId,
        userId,
        genre,
        ...(typeof params?.name === 'string' ? { name: params.name } : {}),
        ...(typeof params?.setup === 'string' ? { setup: params.setup } : {}),
        ...(typeof params?.sendStarter === 'boolean' ? { sendStarter: params.sendStarter } : {}),
        ...(typeof params?.cardWords === 'number' ? { cardWords: params.cardWords } : {}),
    })
}

/** The other ways to begin (35c): from the active persona, or from custom instructions. */
async function creatorWays(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<WaysResult> {
    const chatId = requireChatId(params, 'creator.ways')
    if (!deps.creator) throw new Error('This build cannot create characters.')
    const way = params?.way
    if (way !== 'persona' && way !== 'custom') throw new Error('creator.ways requires a way: persona or custom')
    const str = (key: string) => (typeof params?.[key] === 'string' ? { [key]: params[key] as string } : {})
    const bool = (key: string) => (typeof params?.[key] === 'boolean' ? { [key]: params[key] as boolean } : {})
    const level = params?.level
    return deps.creator.ways({
        chatId,
        userId,
        way,
        ...str('name'),
        ...str('instructions'),
        ...(typeof level === 'number' || level === 'none' ? { level } : {}),
        ...str('genre'),
        ...str('gearTier'),
        ...bool('combatScalingGuide'),
        ...bool('playerCard'),
        ...bool('persona'),
        ...(typeof params?.cardWords === 'number' ? { cardWords: params.cardWords } : {}),
    })
}

/** The Player Card (35b): one handler per op, so the deadline lock can tell the one that calls a model from the rest. */
function cardName(params: Record<string, unknown> | undefined): { name?: string } {
    return typeof params?.name === 'string' ? { name: params.name } : {}
}

function requireLibrary(deps: RequestDeps): NpcLibrary {
    if (!deps.library) throw new Error('This build has no NPC library.')
    return deps.library
}

async function libraryList(deps: RequestDeps, userId: string | undefined): Promise<{ records: LibraryRecordView[] }> {
    return { records: await requireLibrary(deps).list(userId) }
}

async function librarySources(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<LibrarySources> {
    return requireLibrary(deps).sources(requireChatId(params, 'library.sources'), userId)
}

function requireId(params: Record<string, unknown> | undefined, op: string): string {
    const id = typeof params?.id === 'string' ? params.id.trim() : ''
    if (!id) throw new Error(`${op} requires an id`)
    return id
}

async function librarySaveEntry(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined) {
    const chatId = requireChatId(params, 'library.saveEntry')
    const entryId = typeof params?.entryId === 'string' ? params.entryId.trim() : ''
    if (!entryId) throw new Error('library.saveEntry requires an entryId')
    return requireLibrary(deps).saveEntry({ chatId, userId, entryId, overwrite: params?.overwrite === true })
}

async function librarySavePlayerCard(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined) {
    return requireLibrary(deps).savePlayerCard({ chatId: requireChatId(params, 'library.savePlayerCard'), userId, overwrite: params?.overwrite === true })
}

/** The character editor's tab (48): the card being edited, kept in the library as is. */
async function librarySaveCard(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined) {
    const characterId = typeof params?.characterId === 'string' ? params.characterId.trim() : ''
    if (!characterId) throw new Error('library.saveCard requires a characterId')
    return requireLibrary(deps).saveCard({ characterId, userId, overwrite: params?.overwrite === true })
}

async function libraryUpdate(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<LibraryRecordView> {
    const id = requireId(params, 'library.update')
    const str = (key: string) => (typeof params?.[key] === 'string' ? { [key]: params[key] as string } : {})
    const keys = Array.isArray(params?.keys) ? { keys: (params.keys as unknown[]).map((k) => String(k ?? '').trim()).filter(Boolean) } : {}
    return requireLibrary(deps).update({ userId, id, ...str('name'), ...str('content'), ...str('notes'), ...keys })
}

/** A card's photo from a file (60): the chat named only when the panel says the card's name is in play, so the photo lands on that entity too. */
async function libraryPhotoSet(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<LibraryPhotoResult> {
    const id = requireId(params, 'library.photo.set')
    const dataUrl = typeof params?.dataUrl === 'string' ? params.dataUrl : ''
    if (!/^data:image\//i.test(dataUrl)) throw new Error('library.photo.set requires an image')
    const filename = typeof params?.filename === 'string' && params.filename.trim() ? { filename: params.filename.trim() } : {}
    return requireLibrary(deps).setPhoto({ userId, id, dataUrl, ...filename, ...optionalChatId(params) })
}

async function libraryPhotoDraw(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<LibraryPhotoResult> {
    // Named directly, as the party's is: the slow-ops lock reads the dependency off this body.
    if (!deps.library) throw new Error('This build has no NPC library.')
    return deps.library.drawPhoto({ userId, id: requireId(params, 'library.photo.draw'), ...optionalChatId(params), ...optionalPrompt(params) })
}
/** The photo's prompt for editing (73f): one model call on the library, nothing drawn. */
async function libraryPhotoPrompt(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<LibraryPhotoPromptResult> {
    // Named directly, as the draw is: the slow-ops lock reads the dependency off this body.
    if (!deps.library) throw new Error('This build has no NPC library.')
    return deps.library.photoPrompt({ userId, id: requireId(params, 'library.photo.prompt'), ...optionalChatId(params) })
}
/** The prompt the user edited (73f), when a draw carries one. */
function optionalPrompt(params: Record<string, unknown> | undefined): { prompt?: string } {
    const prompt = typeof params?.prompt === 'string' ? params.prompt.trim() : ''
    return prompt ? { prompt } : {}
}

async function libraryPhotoRemove(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<LibraryPhotoResult> {
    return requireLibrary(deps).removePhoto({ userId, id: requireId(params, 'library.photo.remove') })
}

function requirePortraitAuto(deps: RequestDeps): PortraitAuto {
    if (!deps.portraitAuto) throw new Error('This build cannot draw portraits.')
    return deps.portraitAuto
}

/** One portrait drawn on a press (61): the row's name, whatever the switches say. */
async function portraitsDraw(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<PortraitDrawResult> {
    const chatId = requireChatId(params, 'portraits.draw')
    const name = typeof params?.name === 'string' ? params.name.trim() : ''
    if (!name) throw new Error('portraits.draw requires a name')
    // Named directly, as the library's draw is: the slow-ops lock reads the dependency off this body.
    if (!deps.portraitAuto) throw new Error('This build cannot draw portraits.')
    return deps.portraitAuto.draw(chatId, userId, name, optionalPrompt(params).prompt)
}
/** A portrait's prompt for editing (73f): one model call, nothing drawn. */
async function portraitsPrompt(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<PortraitPromptResult> {
    const chatId = requireChatId(params, 'portraits.prompt')
    const name = typeof params?.name === 'string' ? params.name.trim() : ''
    if (!name) throw new Error('portraits.prompt requires a name')
    // Named directly, as the draw is: the slow-ops lock reads the dependency off this body.
    if (!deps.portraitAuto) throw new Error('This build cannot draw portraits.')
    return deps.portraitAuto.prompt(chatId, userId, name)
}

/** What is drawing and queued for the chat (61); the panel's first ask seeds the chat, as the legacy's first check does. */
async function portraitsAutoStatus(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<PortraitAutoStatus> {
    const chatId = requireChatId(params, 'portraits.auto.status')
    if (!deps.portraitAuto) return { drawing: [], queued: [], last: {} }
    return deps.portraitAuto.status(chatId, userId)
}

/** The check a ticked switch asks for (61): everyone it covers, queued now; the status after. */
async function portraitsAutoCheck(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<PortraitAutoStatus> {
    const chatId = requireChatId(params, 'portraits.auto.check')
    const auto = requirePortraitAuto(deps)
    await auto.force(chatId, userId)
    return auto.status(chatId, userId)
}

/** A chat id when one is given and not blank. */
function optionalChatId(params: Record<string, unknown> | undefined): { chatId?: string } {
    return typeof params?.chatId === 'string' && params.chatId.trim() ? { chatId: params.chatId.trim() } : {}
}

async function libraryRemove(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<{ removed: boolean }> {
    return { removed: await requireLibrary(deps).remove(userId, requireId(params, 'library.remove')) }
}

async function libraryImport(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<{ records: LibraryRecordView[] }> {
    const text = typeof params?.text === 'string' ? params.text : ''
    if (!text.trim()) throw new Error('library.import requires the package text')
    return { records: await requireLibrary(deps).importPackages({ userId, text }) }
}

async function libraryExport(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined) {
    const portraitDataUrl = typeof params?.portraitDataUrl === 'string' && /^data:image\//i.test(params.portraitDataUrl) ? params.portraitDataUrl : ''
    return requireLibrary(deps).exportPackage({ userId, id: requireId(params, 'library.export'), portraitDataUrl })
}

async function libraryParty(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<LibraryActionResult> {
    if (!deps.library) throw new Error('This build has no NPC library.')
    return deps.library.party({ chatId: requireChatId(params, 'library.party'), userId, id: requireId(params, 'library.party') })
}

async function libraryPlayAsPc(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<LibraryActionResult> {
    if (!deps.library) throw new Error('This build has no NPC library.')
    return deps.library.playAsPc({ chatId: requireChatId(params, 'library.playAsPc'), userId, id: requireId(params, 'library.playAsPc') })
}

function requireNpcCreator(deps: RequestDeps): NpcCreator {
    if (!deps.npcCreator) throw new Error('This build has no NPC creator.')
    return deps.npcCreator
}

/** An NPC's source (41a), read strictly: the kind decides which fields are required. */
function readNpcSource(params: Record<string, unknown> | undefined, op: string): NpcSource {
    const source = params?.source
    if (!source || typeof source !== 'object') throw new Error(`${op} requires a source`)
    const s = source as Record<string, unknown>
    const text = (key: string) => (typeof s[key] === 'string' ? (s[key] as string) : '')
    // Not a switch: `slow-ops.test.ts` reads every `case '…':` in this file as a dispatched op.
    const kind = s.kind
    if (kind === 'card') {
        if (!text('characterId').trim()) throw new Error(`${op} requires a characterId for a card`)
        return { kind: 'card', characterId: text('characterId').trim() }
    }
    if (kind === 'library') {
        if (!text('id').trim()) throw new Error(`${op} requires an id for a library card`)
        return { kind: 'library', id: text('id').trim() }
    }
    if (kind === 'freeform') {
        if (!text('description').trim()) throw new Error(`${op} requires a description for a freeform NPC`)
        return { kind: 'freeform', name: text('name'), description: text('description') }
    }
    if (kind === 'archetype') {
        if (!text('archetype').trim()) throw new Error(`${op} requires an archetype`)
        return { kind: 'archetype', archetype: text('archetype'), name: text('name'), concept: text('concept') }
    }
    throw new Error(`${op} does not know the source kind "${String(kind)}"`)
}

function narratorOf(params: Record<string, unknown> | undefined): { narratorCharacterId?: string } {
    return typeof params?.narratorCharacterId === 'string' && params.narratorCharacterId.trim() ? { narratorCharacterId: params.narratorCharacterId.trim() } : {}
}

async function npcDraft(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<NpcDraftResult> {
    if (!deps.npcCreator) throw new Error('This build has no NPC creator.')
    return deps.npcCreator.draft({ chatId: requireChatId(params, 'npc.draft'), userId, source: readNpcSource(params, 'npc.draft'), ...narratorOf(params) })
}

async function npcAdd(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<NpcAddResult> {
    if (!deps.npcCreator) throw new Error('This build has no NPC creator.')
    return deps.npcCreator.add({ chatId: requireChatId(params, 'npc.add'), userId, source: readNpcSource(params, 'npc.add'), ...narratorOf(params) })
}

async function npcCommit(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<NpcAddResult> {
    const chatId = requireChatId(params, 'npc.commit')
    const tag = typeof params?.tag === 'string' ? params.tag : ''
    if (!tag.trim()) throw new Error('npc.commit requires the tag text')
    const how = params?.how === 'freeform' || params?.how === 'archetype' ? params.how : 'fit'
    const portrait = params?.portrait && typeof params.portrait === 'object' ? { portrait: readNpcSource({ source: params.portrait }, 'npc.commit') } : {}
    return requireNpcCreator(deps).commit({ chatId, userId, tag, name: typeof params?.name === 'string' ? params.name : '', how, ...portrait })
}

function requireScene(deps: RequestDeps): Scene {
    if (!deps.scene) throw new Error('This build has no scene view.')
    return deps.scene
}

function requireRelationships(deps: RequestDeps): Relationships {
    if (!deps.relationships) throw new Error('This build has no relationship system.')
    return deps.relationships
}

async function relationsGet(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<RelationshipsView> {
    return requireRelationships(deps).view(requireChatId(params, 'relations.get'), userId)
}

async function relationsSet(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<RelationshipsView> {
    const chatId = requireChatId(params, 'relations.set')
    const id = typeof params?.id === 'string' ? params.id.trim() : ''
    const field = params?.field === 'affection' ? 'affection' : params?.field === 'friendship' ? 'friendship' : null
    if (!field) throw new Error('relations.set needs a field: friendship or affection')
    return requireRelationships(deps).set(chatId, userId, id, field, Number(params?.value))
}

async function relationsRemove(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<RelationshipsView> {
    const chatId = requireChatId(params, 'relations.remove')
    const id = typeof params?.id === 'string' ? params.id.trim() : ''
    if (!id) throw new Error('relations.remove needs the NPC\'s entry address')
    return requireRelationships(deps).remove(chatId, userId, id)
}

/** Multihog's Clear Log (80): the NPC's history alone, the values kept. */
async function relationsClearLog(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<RelationshipsView> {
    const chatId = requireChatId(params, 'relations.clearLog')
    const id = typeof params?.id === 'string' ? params.id.trim() : ''
    if (!id) throw new Error('relations.clearLog needs the NPC\'s entry address')
    return requireRelationships(deps).clearLog(chatId, userId, id)
}

/** A named place for the scene's picture ops (80): the Campaign Records' location images; absent, the party's place. */
function optionalPath(params: Record<string, unknown> | undefined): string | undefined {
    return typeof params?.path === 'string' && params.path.trim() ? params.path.trim() : undefined
}

async function sceneGet(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<SceneResult> {
    const chatId = requireChatId(params, 'scene.get')
    const scene = await requireScene(deps).get(chatId, userId)
    // A draw in flight (49), so a fold opened mid-draw says so.
    const drawing = deps.sceneArt?.drawing(chatId)
    return drawing ? { ...scene, drawing } : scene
}

function requireSceneArt(deps: RequestDeps): SceneArt {
    if (!deps.sceneArt) throw new Error('This build cannot draw pictures.')
    return deps.sceneArt
}

async function sceneDraw(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<SceneDrawResult> {
    // One model call for the prompt, then the image (49): a model-calling op, for the deadline lock.
    const chatId = requireChatId(params, 'scene.draw')
    if (!deps.sceneArt) throw new Error('This build cannot draw pictures.')
    return deps.sceneArt.draw(chatId, userId, optionalPrompt(params).prompt, optionalPath(params))
}
/** The picture's prompt for editing (73f): one model call, nothing drawn. */
async function scenePrompt(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<ScenePromptResult> {
    const chatId = requireChatId(params, 'scene.prompt')
    if (!deps.sceneArt) throw new Error('This build cannot draw pictures.')
    return deps.sceneArt.prompt(chatId, userId, optionalPath(params))
}

async function sceneConnections(deps: RequestDeps, userId: string | undefined): Promise<SceneConnectionsResult> {
    return requireSceneArt(deps).connections(userId)
}

function requireCampaignBooks(deps: RequestDeps): CampaignBooks {
    if (!deps.campaignBooks) throw new Error('This build cannot list the campaign’s lorebooks.')
    return deps.campaignBooks
}

async function loreBooks(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<CampaignBooksResult> {
    return requireCampaignBooks(deps).status(requireChatId(params, 'lore.books'), userId, { report: true })
}

async function loreAdopt(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<CampaignBooksResult> {
    const chatId = requireChatId(params, 'lore.adopt')
    const bookId = typeof params?.bookId === 'string' ? params.bookId.trim() : ''
    if (!bookId) throw new Error('lore.adopt needs a bookId.')
    return requireCampaignBooks(deps).adopt(chatId, userId, bookId)
}

async function loreAttach(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<CampaignBooksResult> {
    const chatId = requireChatId(params, 'lore.attach')
    const bookId = typeof params?.bookId === 'string' && params.bookId.trim() ? params.bookId.trim() : undefined
    return requireCampaignBooks(deps).attach(chatId, userId, bookId)
}

async function sceneSetImage(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<SceneResult> {
    const chatId = requireChatId(params, 'scene.setImage')
    const path = typeof params?.path === 'string' ? params.path.trim() : ''
    if (!path) throw new Error('scene.setImage requires the place\'s path')
    let src = typeof params?.src === 'string' ? params.src.trim() : ''
    // A picture given as data goes to the host's image store first, as a portrait does.
    if (/^data:image\//i.test(src)) {
        if (!deps.images) throw new Error('This build cannot store images. Paste an image URL instead.')
        const filename = typeof params?.filename === 'string' ? params.filename : 'scene.png'
        const stored = await deps.images.uploadFromDataUrl(src, filename, userId)
        if (!stored?.url) throw new Error('The image was stored but the host returned no address for it.')
        src = stored.url
    }
    return requireScene(deps).setImage(chatId, userId, path, src)
}

async function creatorCards(deps: RequestDeps, userId: string | undefined): Promise<{ cards: CardChoice[] }> {
    if (!deps.creator) throw new Error('This build cannot create characters.')
    return { cards: await deps.creator.cards(userId) }
}

async function creatorImport(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<ImportResult> {
    const chatId = requireChatId(params, 'creator.import')
    if (!deps.creator) throw new Error('This build cannot create characters.')
    const characterId = typeof params?.characterId === 'string' ? params.characterId.trim() : ''
    if (!characterId) throw new Error('creator.import requires a characterId')
    const mode = params?.mode === 'minimal' ? 'minimal' : 'full'
    const bool = (key: string) => (typeof params?.[key] === 'boolean' ? { [key]: params[key] as boolean } : {})
    const words = params?.cardWords
    return deps.creator.importCard({
        chatId,
        userId,
        characterId,
        mode,
        ...(typeof words === 'number' || words === 'same' ? { cardWords: words } : {}),
        ...bool('playerCard'),
        ...bool('persona'),
        ...(typeof params?.narratorCharacterId === 'string' && params.narratorCharacterId ? { narratorCharacterId: params.narratorCharacterId } : {}),
    })
}

async function creatorCardGet(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<PlayerCardView> {
    const chatId = requireChatId(params, 'creator.card.get')
    if (!deps.creator) throw new Error('This build cannot create characters.')
    return deps.creator.card.view(chatId, userId)
}

async function creatorCardWrite(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<CardResult> {
    const chatId = requireChatId(params, 'creator.card.write')
    if (!deps.creator) throw new Error('This build cannot create characters.')
    return deps.creator.card.write({ chatId, userId, ...cardName(params), ...(typeof params?.words === 'number' ? { words: params.words } : {}) })
}

async function creatorCardSave(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<CardResult> {
    const chatId = requireChatId(params, 'creator.card.save')
    if (!deps.creator) throw new Error('This build cannot create characters.')
    return deps.creator.card.save({ chatId, userId, name: cardName(params).name ?? '', bio: typeof params?.bio === 'string' ? params.bio : '' })
}

async function creatorCardRemove(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<{ ok: true }> {
    const chatId = requireChatId(params, 'creator.card.remove')
    if (!deps.creator) throw new Error('This build cannot create characters.')
    await deps.creator.card.remove(chatId, userId)
    return { ok: true }
}

async function creatorCardPersona(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<PersonaResult> {
    const chatId = requireChatId(params, 'creator.card.persona')
    if (!deps.creator) throw new Error('This build cannot create characters.')
    return deps.creator.card.persona({ chatId, userId, ...cardName(params) })
}

/** The map on screen (34d): the party's site unless one is named. */
async function mapView(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<MapViewResult> {
    const chatId = requireChatId(params, 'map.view')
    if (!deps.map) throw new Error('This build cannot draw maps.')
    const siteRoot = typeof params?.siteRoot === 'string' ? params.siteRoot : ''
    return deps.map.view(chatId, userId, siteRoot)
}

// ── Campaign Records (roadmap row 71, Phase 71a) ─────────────────────────

function requireRecords(deps: RequestDeps): CampaignRecords {
    if (!deps.records) throw new Error('This build cannot read the campaign’s records.')
    return deps.records
}

function requireEntryId(params: Record<string, unknown> | undefined, op: string): string {
    const entryId = typeof params?.entryId === 'string' ? params.entryId.trim() : ''
    if (!entryId) throw new Error(`${op} requires an entryId`)
    return entryId
}

function stringList(value: unknown): string[] {
    return Array.isArray(value) ? value.map((v) => String(v ?? '').trim()).filter(Boolean) : []
}

async function recordsList(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<CampaignRecordsResult> {
    return requireRecords(deps).list(requireChatId(params, 'records.list'), userId)
}

async function recordsUpdate(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<RecordEntryResult> {
    const chatId = requireChatId(params, 'records.update')
    const entryId = requireEntryId(params, 'records.update')
    const title = typeof params?.title === 'string' ? params.title : ''
    const content = typeof params?.content === 'string' ? params.content : ''
    return requireRecords(deps).update(chatId, userId, { entryId, title, keys: stringList(params?.keys), content })
}

async function recordsRemove(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<{ removed: true; title: string }> {
    return requireRecords(deps).remove(requireChatId(params, 'records.remove'), userId, requireEntryId(params, 'records.remove'))
}

async function recordsPin(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<RecordEntryResult> {
    return requireRecords(deps).pin(requireChatId(params, 'records.pin'), userId, requireEntryId(params, 'records.pin'), params?.pinned !== false)
}

async function recordsRemoveMap(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<RecordRemoveMapResult> {
    return requireRecords(deps).removeMap(requireChatId(params, 'records.removeMap'), userId, requireEntryId(params, 'records.removeMap'))
}

function requireSiteRoot(params: Record<string, unknown> | undefined, op: string): string {
    const siteRoot = typeof params?.siteRoot === 'string' ? params.siteRoot.trim() : ''
    if (!siteRoot) throw new Error(`${op} requires a siteRoot`)
    return siteRoot
}

async function mapRawGet(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<MapRawResult> {
    return requireRecords(deps).rawGet(requireChatId(params, 'map.raw.get'), userId, requireSiteRoot(params, 'map.raw.get'))
}

/** The terminal's kept steps (71b), every feed of the chat. */
async function terminalGet(deps: RequestDeps, _userId: string | undefined, params: Record<string, unknown> | undefined): Promise<TerminalResult> {
    const chatId = requireChatId(params, 'terminal.get')
    if (!deps.terminal) throw new Error('This build has no terminal.')
    return { steps: deps.terminal.steps(chatId) }
}

/** One feed cleared (71b), or every feed of the chat when no source is named; the feeds as they stand after. */
async function terminalClear(deps: RequestDeps, _userId: string | undefined, params: Record<string, unknown> | undefined): Promise<TerminalResult> {
    const chatId = requireChatId(params, 'terminal.clear')
    if (!deps.terminal) throw new Error('This build has no terminal.')
    const source = params?.source
    if (source !== undefined && !isTerminalSource(source)) throw new Error(`terminal.clear: "${String(source)}" is not a feed`)
    deps.terminal.clear(chatId, isTerminalSource(source) ? source : undefined)
    return { steps: deps.terminal.steps(chatId) }
}

/**
 * The Map Architect's direct command (71b), the legacy's terminal bar: a
 * `Create SETTLEMENT|DUNGEON|INTERIOR map for "Site"` names the site and the
 * kind; anything else is a brief for the site the party stands in, and
 * nothing without one. Runs 71a's Auto path with the text as the brief.
 */
async function mapDirect(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<MapCreateResult> {
    const chatId = requireChatId(params, 'map.direct')
    if (!deps.map?.create) throw new Error('This build cannot make maps from the panel.')
    const text = typeof params?.text === 'string' ? params.text.trim() : ''
    if (!text) throw new Error('map.direct requires text')
    const lookback = Number.isFinite(Number(params?.lookback)) && typeof params?.lookback !== 'undefined' ? { lookback: Math.max(0, Math.floor(Number(params.lookback))) } : {}
    const directive = parseMapArchitectDirective(text)
    // The command's site over the party's: a map asked for by name is drawn by name wherever the party stands.
    const active = String((await deps.map.state.load(chatId, userId)).activeSiteRoot ?? '').trim()
    const site = directive?.site || active
    if (!site) throw new Error('Name a site with “Create INTERIOR/DUNGEON/SETTLEMENT map for "Site Name"”, or stand inside a mapped location first.')
    return deps.map.create({
        chatId,
        userId,
        site,
        mode: 'auto',
        requireNew: false,
        brief: text,
        ...lookback,
        ...(directive ? { kind: directive.kind } : {}),
    })
}

async function mapRawSet(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<MapRawSaveResult> {
    const chatId = requireChatId(params, 'map.raw.set')
    const siteRoot = requireSiteRoot(params, 'map.raw.set')
    const json = typeof params?.json === 'string' ? params.json : ''
    if (!json.trim()) throw new Error('map.raw.set requires the json text')
    return requireRecords(deps).rawSet(chatId, userId, siteRoot, json)
}

/** A map made from the panel (71a): the form's fields through, each of the right type, the rest dropped. */
async function mapCreate(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<MapCreateResult> {
    const chatId = requireChatId(params, 'map.create')
    if (!deps.map?.create) throw new Error('This build cannot make maps from the panel.')
    const site = typeof params?.site === 'string' ? params.site : ''
    const text = (key: string): Record<string, string> => (typeof params?.[key] === 'string' ? { [key]: params[key] as string } : {})
    const lookback = Number.isFinite(Number(params?.lookback)) && typeof params?.lookback !== 'undefined' ? { lookback: Math.floor(Number(params.lookback)) } : {}
    return deps.map.create({
        chatId,
        userId,
        site,
        mode: params?.mode === 'manual' ? 'manual' : 'auto',
        requireNew: params?.requireNew === true,
        ...text('brief'), ...text('kind'), ...text('entrance'), ...text('scale'), ...text('threat'), ...text('prompt'), ...text('briefDescription'),
        ...lookback,
        keywords: stringList(params?.keywords),
        include: stringList(params?.include),
        lorebooks: stringList(params?.lorebooks),
        cards: stringList(params?.cards),
    })
}

/** A Map Updater pass now (34b): on the party's site or a named one, with an instruction if given. */
async function mapUpdate(deps: RequestDeps, userId: string | undefined, params: Record<string, unknown> | undefined): Promise<MapUpdaterResult> {
    const chatId = requireChatId(params, 'map.update')
    if (!deps.map) throw new Error('This build cannot update maps.')
    const instruction = typeof params?.instruction === 'string' ? params.instruction : ''
    const lookback = Number.isFinite(Number(params?.lookback)) && Number(params?.lookback) > 0 ? Math.min(100, Math.floor(Number(params?.lookback))) : undefined
    const siteRoot = typeof params?.siteRoot === 'string' ? params.siteRoot : ''
    return deps.map.updater.run({ chatId, userId, instruction, ...(lookback !== undefined ? { lookback } : {}), ...(siteRoot ? { siteRoot } : {}) })
}

/**
 * The ops that write the cartridge (70), whose answer the whole frontend is
 * told about as `settings.changed`: the narrator's block is drawn in the
 * settings and in the tracker's starting area, and a change in one place
 * has to reach the other. Each of these answers with the settings whole.
 */
export function writesSettings(op: string): boolean {
    return op === 'settings.patch' || op === 'settings.reset' || op === 'cartridge.import' || op.startsWith('portraits.presets.')
        || op === 'maintenance.resetPrompts' || op === 'maintenance.factoryReset' || op === 'settings.upgradeStock' || op === 'settings.npcWords' || op === 'settings.sections'
}

/** The ops that write the preferences (72a), announced as `prefs.changed`; each answers with the preferences whole. */
export function writesPrefs(op: string): boolean {
    return op === 'prefs.patch' || op === 'backdrop.upload' || op === 'maintenance.factoryReset' || op === 'maintenance.cleanOrphans' || op === 'maintenance.removeAllChats' || op === 'settings.npcWords'
}

export async function handleRequest(
    deps: RequestDeps,
    request: RequestMessage,
    userId?: string,
): Promise<unknown> {
    switch (request.op) {
        case 'settings.get':
            return getSettings(deps, userId)
        case 'settings.patch':
            return patchSettings(deps, userId, request.params)
        case 'settings.factory':
            return factorySettings(deps, userId)
        case 'settings.reset':
            return resetSettings(deps, userId, request.params)
        case 'cartridge.export':
            return exportCartridge(deps, userId, request.params)
        case 'cartridge.import':
            return importCartridge(deps, userId, request.params)
        case 'tracker.get':
            return getTracker(deps, userId, request.params)
        case 'tracker.setMemo':
            return setTrackerMemo(deps, userId, request.params)
        case 'agent.run':
            return runAgent(deps, userId, request.params)
        case 'agent.instruct':
            return instructAgent(deps, userId, request.params)
        case 'agent.undo':
            return undoAgent(deps, userId, request.params)
        case 'agent.redo':
            return redoAgent(deps, userId, request.params)
        case 'agent.cleanup':
            return cleanupAgent(deps, userId, request.params)
        case 'agent.audit':
            return auditAgent(deps, userId, request.params)
        case 'agent.audit.stop':
            return stopAudit(deps, request.params)
        case 'campaign.clone':
            return cloneCampaign(deps, userId, request.params)
        case 'connections.list':
            return listConnections(deps, userId)
        case 'tracker.cancel':
            return cancelPass(deps, 'tracker', request.params)
        case 'agent.cancel':
            return cancelPass(deps, 'agent', request.params)
        case 'lore.activated':
            return getActivatedLore(deps, userId, request.params)
        case 'portraits.get':
            return getPortraits(deps, userId, request.params)
        case 'portraits.set':
            return setPortrait(deps, userId, request.params)
        case 'backdrop.upload':
            return uploadBackdrop(deps, userId, request.params)
        case 'portraits.upload':
            return uploadPortrait(deps, userId, request.params)
        case 'portraits.draw':
            return portraitsDraw(deps, userId, request.params)
        case 'portraits.prompt':
            return portraitsPrompt(deps, userId, request.params)
        case 'portraits.auto.status':
            return portraitsAutoStatus(deps, userId, request.params)
        case 'portraits.auto.check':
            return portraitsAutoCheck(deps, userId, request.params)
        case 'portraits.presets.load':
            return portraitsPresetsLoad(deps, userId, request.params)
        case 'portraits.presets.save':
            return portraitsPresetsSave(deps, userId, request.params)
        case 'portraits.presets.delete':
            return portraitsPresetsDelete(deps, userId, request.params)
        case 'prefs.get':
            return getPrefs(deps, userId)
        case 'prefs.patch':
            return patchPrefs(deps, userId, request.params)
        case 'campaign.name':
            return campaignName(deps, userId, request.params)
        case 'tracker.history':
            return getTrackerHistory(deps, userId, request.params)
        case 'reports.history':
            return getReportsHistory(deps, userId, request.params)
        case 'tracker.restore':
            return restoreTrackerMemo(deps, userId, request.params)
        case 'tracker.clearArchive':
            return clearQuestArchive(deps, userId, request.params)
        case 'tracker.run':
            return runTracker(deps, userId, request.params)
        case 'tracker.instruct':
            return instructTracker(deps, userId, request.params)
        case 'cyoa.choices':
            return listChoices(deps, request.params)
        case 'cyoa.choose':
            return choose(deps, userId, request.params)
        case 'wizard.draft':
            return wizardDraft(deps, userId, request.params)
        case 'wizard.revise':
            return wizardRevise(deps, userId, request.params)
        case 'world.get':
            return worldStatus(deps, userId, request.params)
        case 'world.run':
            return worldRun(deps, userId, request.params)
        case 'world.reset':
            return worldReset(deps, userId, request.params)
        case 'world.skeleton':
            return worldSkeleton(deps, userId, request.params)
        case 'world.purge':
            return worldPurge(deps, userId, request.params)
        case 'world.skeletonSource':
            return worldSkeletonSource(deps, userId, request.params)
        case 'world.books':
            return worldBooks(deps, userId, request.params)
        case 'world.consolidate':
            return worldConsolidate(deps, userId, request.params)
        case 'world.overrideNext':
            return worldOverrideNext(deps, userId, request.params)
        case 'narrator.create':
            return narratorCreate(deps, userId, request.params)
        case 'settings.npcWords':
            return settingsNpcWords(deps, userId, request.params)
        case 'settings.sections':
            return settingsSections(deps, userId, request.params)
        case 'map.get':
            return mapStatus(deps, userId, request.params)
        case 'map.update':
            return mapUpdate(deps, userId, request.params)
        case 'map.view':
            return mapView(deps, userId, request.params)
        case 'records.list':
            return recordsList(deps, userId, request.params)
        case 'records.update':
            return recordsUpdate(deps, userId, request.params)
        case 'records.remove':
            return recordsRemove(deps, userId, request.params)
        case 'records.pin':
            return recordsPin(deps, userId, request.params)
        case 'records.removeMap':
            return recordsRemoveMap(deps, userId, request.params)
        case 'map.create':
            return mapCreate(deps, userId, request.params)
        case 'map.direct':
            return mapDirect(deps, userId, request.params)
        case 'terminal.get':
            return terminalGet(deps, userId, request.params)
        case 'terminal.clear':
            return terminalClear(deps, userId, request.params)
        case 'map.raw.get':
            return mapRawGet(deps, userId, request.params)
        case 'map.raw.set':
            return mapRawSet(deps, userId, request.params)
        case 'map.evolution.interval':
            return mapEvolutionInterval(deps, userId, request.params)
        case 'map.evolution.reset':
            return mapEvolutionReset(deps, userId, request.params)
        case 'map.sandbox.evolve':
            return mapSandboxEvolve(deps, userId, request.params)
        case 'map.sandbox.simulate':
            return mapSandboxSimulate(deps, userId, request.params)
        case 'map.sandbox.redo':
            return mapSandboxRedo(deps, userId, request.params)
        case 'map.sandbox.get':
        case 'map.sandbox.time':
        case 'map.sandbox.asset.add':
        case 'map.sandbox.asset.set':
        case 'map.sandbox.undo':
        case 'map.sandbox.clear':
            return mapSandbox(deps, userId, request.op, request.params)
        case 'creator.generate':
            return creatorGenerate(deps, userId, request.params)
        case 'creator.instant':
            return creatorInstant(deps, userId, request.params)
        case 'creator.card.get':
            return creatorCardGet(deps, userId, request.params)
        case 'creator.card.write':
            return creatorCardWrite(deps, userId, request.params)
        case 'creator.card.save':
            return creatorCardSave(deps, userId, request.params)
        case 'creator.card.remove':
            return creatorCardRemove(deps, userId, request.params)
        case 'creator.card.persona':
            return creatorCardPersona(deps, userId, request.params)
        case 'creator.ways':
            return creatorWays(deps, userId, request.params)
        case 'creator.cards':
            return creatorCards(deps, userId)
        case 'creator.import':
            return creatorImport(deps, userId, request.params)
        case 'library.list':
            return libraryList(deps, userId)
        case 'library.sources':
            return librarySources(deps, userId, request.params)
        case 'library.saveEntry':
            return librarySaveEntry(deps, userId, request.params)
        case 'library.savePlayerCard':
            return librarySavePlayerCard(deps, userId, request.params)
        case 'library.saveCard':
            return librarySaveCard(deps, userId, request.params)
        case 'library.update':
            return libraryUpdate(deps, userId, request.params)
        case 'library.remove':
            return libraryRemove(deps, userId, request.params)
        case 'library.import':
            return libraryImport(deps, userId, request.params)
        case 'library.export':
            return libraryExport(deps, userId, request.params)
        case 'library.party':
            return libraryParty(deps, userId, request.params)
        case 'library.playAsPc':
            return libraryPlayAsPc(deps, userId, request.params)
        case 'library.photo.set':
            return libraryPhotoSet(deps, userId, request.params)
        case 'library.photo.draw':
            return libraryPhotoDraw(deps, userId, request.params)
        case 'library.photo.prompt':
            return libraryPhotoPrompt(deps, userId, request.params)
        case 'library.photo.remove':
            return libraryPhotoRemove(deps, userId, request.params)
        case 'npc.draft':
            return npcDraft(deps, userId, request.params)
        case 'npc.add':
            return npcAdd(deps, userId, request.params)
        case 'npc.commit':
            return npcCommit(deps, userId, request.params)
        case 'scene.get':
            return sceneGet(deps, userId, request.params)
        case 'scene.setImage':
            return sceneSetImage(deps, userId, request.params)
        case 'scene.draw':
            return sceneDraw(deps, userId, request.params)
        case 'scene.prompt':
            return scenePrompt(deps, userId, request.params)
        case 'scene.connections':
            return sceneConnections(deps, userId)
        case 'lore.books':
            return loreBooks(deps, userId, request.params)
        case 'books.list':
            return booksList(deps, userId)
        case 'theme.generate':
            return themeGenerate(deps, userId, request.params)
        case 'records.aiEdit':
            return recordsAiEdit(deps, userId, request.params)
        case 'lore.attach':
            return loreAttach(deps, userId, request.params)
        case 'lore.adopt':
            return loreAdopt(deps, userId, request.params)
        case 'relations.get':
            return relationsGet(deps, userId, request.params)
        case 'relations.set':
            return relationsSet(deps, userId, request.params)
        case 'relations.remove':
            return relationsRemove(deps, userId, request.params)
        case 'relations.clearLog':
            return relationsClearLog(deps, userId, request.params)
        case 'map.evolve':
            return mapEvolve(deps, userId, request.params)
        case 'status.get':
            return getStatus(deps, userId)
        case 'maintenance.resetPrompts':
            return { settings: await maintenanceOf(deps).resetPrompts(userId) }
        case 'maintenance.factoryReset':
            return maintenanceOf(deps).factoryReset(userId)
        case 'maintenance.purgePortraits':
            return maintenanceOf(deps).purgePortraits(userId)
        case 'maintenance.orphans':
            return maintenanceOf(deps).orphans(userId)
        case 'maintenance.cleanOrphans':
            return maintenanceOf(deps).cleanOrphans(userId)
        case 'maintenance.chatData':
            return maintenanceOf(deps).chatData(userId)
        case 'maintenance.removeAllChats':
            return maintenanceOf(deps).removeAllChats(userId)
        case 'settings.upgradeStock': {
            if (!deps.stockUpgrade) throw new Error(MAINTENANCE_UNAVAILABLE)
            return deps.stockUpgrade.check(userId, true)
        }
        default:
            throw new Error(`Unknown op: ${String(request.op)}`)
    }
}
