import { describe, expect, it, vi } from 'vitest'

import {
    DEFAULT_PREFS,
    PREFS_PATH,
    PrefsStore,
    readPrefs,
    readPrefsPatch,
    readConnectionId,
    readLookbackCount,
    readLookbackMode,
    readLayout,
    readWidgetPositions,
    readWidgetSizes,
    readWidgetMinimized,
    readMaxTurns,
    readRunEvery,
    readWatermarks,
    readAttachBooksTarget,
    type PrefsStorage,
} from './prefs-store.js'
import { DEFAULT_MAX_TURNS, HARD_CALL_CEILING } from '../agent/loop.js'
import { DEFAULT_MAP_THEME } from '../tracker/map-themes.js'
import { DEFAULT_LOOKBACK_COUNT, DEFAULT_LOOKBACK_MODE } from './tracker-pass.js'
import { DEFAULT_RUN_EVERY, MAX_RUN_EVERY } from './auto-pass.js'
import { DEFAULT_TRACKER_RUN_EVERY } from './tracker-cadence.js'
import * as prefsModule from './prefs-store.js'

/** Keyed by user as well as path, because `spindle.userStorage` is. */
function fakeStorage(seed: Record<string, unknown> = {}) {
    const files = new Map<string, unknown>(Object.entries(seed))
    const at = (path: string, userId?: string): string => `${userId ?? '@self'}:${path}`

    const storage: PrefsStorage = {
        async getJson<T>(path: string, options?: { fallback?: T; userId?: string }): Promise<T> {
            const key = at(path, options?.userId)
            return (files.has(key) ? files.get(key) : options?.fallback) as T
        },
        async setJson(path: string, value: unknown, options?: { userId?: string }): Promise<void> {
            files.set(at(path, options?.userId), JSON.parse(JSON.stringify(value)))
        },
    }
    return { storage, files }
}

describe('reading preferences back', () => {
    it('defaults the cards to on', () => {
        // The cards are the reason the per-turn history is kept. A feature
        // nobody can see is one nobody asks for twice.
        // Off as it ships since 82 (the maintainer's ask of 2026-10-28).
        expect(DEFAULT_PREFS.messageCards).toBe(false)
        expect(readPrefs(null).messageCards).toBe(false)
    })

    it('reads a stored preference', () => {
        expect(readPrefs({ version: 1, messageCards: false }).messageCards).toBe(false)
    })

    it.each([
        ['a string', { messageCards: 'false' }],
        ['a number', { messageCards: 0 }],
        ['null', { messageCards: null }],
        ['nothing at all', {}],
        ['not an object', 'nope'],
    ])('ignores %s and keeps the default', (_name, stored) => {
        // This is a small file a user may well open, and `"false"` switching the
        // cards off for good with no error would be a miserable thing to debug.
        expect(readPrefs(stored).messageCards).toBe(false)
    })

    it('keeps only real preferences out of a patch', () => {
        expect(readPrefsPatch({ messageCards: false, somethingElse: 1 })).toEqual({ messageCards: false })
        expect(readPrefsPatch({ messageCards: 'yes' })).toEqual({})
        expect(readPrefsPatch(null)).toEqual({})
    })
})

describe('the preference store', () => {
    it('starts at the defaults for a fresh install', async () => {
        const { storage } = fakeStorage()
        expect(await new PrefsStore(storage).load()).toEqual(DEFAULT_PREFS)
    })

    it('keeps one bar preference without dropping another', async () => {
        // Per bar rather than whole-map: two bars are two decisions, and the
        // second must not erase the first.
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)

        await store.patch({ bars: { 'XP::Bar': { color: '#ff8800' } } })
        const prefs = await store.patch({ bars: { 'HP::Bar': { showAsPercentage: true } } })

        expect(prefs.bars).toEqual({ 'XP::Bar': { color: '#ff8800' }, 'HP::Bar': { showAsPercentage: true } })
    })

    it('removes a bar preference that says nothing', async () => {
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)

        await store.patch({ bars: { 'XP::Bar': { color: '#ff8800' } } })
        expect((await store.patch({ bars: { 'XP::Bar': {} } })).bars).toEqual({})
    })

    it('refuses a colour that is not a plain hex value', async () => {
        // It goes straight into an inline style attribute, and this file is one
        // a user can edit.
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)

        const prefs = await store.patch({ bars: { 'XP::Bar': { color: 'url(javascript:alert(1))' } } })
        expect(prefs.bars).toEqual({})
    })

    it('hands back a copy of the bars, not the cache', async () => {
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)
        await store.patch({ bars: { 'XP::Bar': { color: '#ff8800' } } })

        const prefs = await store.load()
        delete prefs.bars['XP::Bar']
        expect((await store.load()).bars).toEqual({ 'XP::Bar': { color: '#ff8800' } })
    })

    it('writes a preference and reads it back', async () => {
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)

        expect((await store.patch({ messageCards: false })).messageCards).toBe(false)
        expect((await store.load()).messageCards).toBe(false)
    })

    it('survives to disk, outside the cartridge', async () => {
        // Its own file. A cartridge export must not carry it and an import must
        // not overwrite it: this is a property of the install, not the game.
        const { storage, files } = fakeStorage()
        await new PrefsStore(storage).patch({ messageCards: false }, 'u1')

        expect(files.has(`u1:${PREFS_PATH}`)).toBe(true)
        expect((await new PrefsStore(storage).load('u1')).messageCards).toBe(false)
    })

    it('keeps users apart', async () => {
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)

        await store.patch({ messageCards: true }, 'u1')
        expect((await store.load('u2')).messageCards).toBe(false)
    })

    it('keeps the rest of the preferences when one changes', async () => {
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)

        await store.patch({ messageCards: false })
        // The whole shape, deliberately: a new preference key has to be added
        // here on purpose, which is the same lock `EXPECTED_PAYLOAD_KEYS` puts
        // on the cartridge surface and for the same reason.
        expect(await store.patch({})).toEqual({
            messageCards: false, debugLogging: false, autoUpdatePrompts: true, bars: {}, campaignBooks: {}, campaignNames: {}, agentLookback: 0,
            frameworkEnabled: true, agentEnabled: true, trackerSwipeRollback: true, trackerFullReviewMode: false, trackerInjectLorebooks: false, trackerLorebookFilter: [], agentSwipeRollback: true, agentLookbackMode: 'since_last_run', trackerHistoryStates: 1, npcMajorWords: 225, npcMinorWords: 135, legacyDiceNaming: false, portraitsEnabled: true, npcRelationshipToast: true, locationImages: false, inventoryShowTotal: false, inventoryWorthMode: 'hover', mapArchitectConnectionId: '', mapUpdaterConnectionId: '', narratorCardName: 'Game Master',
            terminalDrafts: { state_tracker: '', lorebook_agent: '', map_updater: '', map_evolution: '', map_architect: '' }, mapUpdaterDirectLookback: 10, mapEvolutionDirectLookback: 10, mapArchitectDirectLookback: 10, agentTerminalTab: 'lorebook_agent', trackerUserPromptSuffix: '', agentPaused: false, agentCleanupUseThreshold: true, agentCleanupThreshold: 300, agentCleanupEvery: 0, agentAuditTokens: 32000,
            agentMaxTurns: DEFAULT_MAX_TURNS, agentRunEvery: DEFAULT_RUN_EVERY,
            agentWatermarks: {},
            trackerConnectionId: '', agentConnectionId: '',
            trackerLookbackMode: DEFAULT_LOOKBACK_MODE, trackerLookbackCount: DEFAULT_LOOKBACK_COUNT, layout: 'widgets', trackerTheme: 'native', trackerFontSize: 0, agentFontSize: 0, settingsFontSize: 0, customTheme: null, savedThemes: {}, dayNightCycle: false, xpBarAtBottom: true, animateAllCustomBarChanges: true, panelLayoutMode: 'stack', trackerActiveTab: '', displayGroupsEnabled: false, displayGroupsShowGaps: false, displayGroups: [], mapTheme: { ...DEFAULT_MAP_THEME }, savedMapThemePresets: {}, activeMapThemePresetId: 'factory:ember', trackerBackdrop: { day: '', night: '', strength: 55 }, settingsBackdrop: { day: '', night: '', strength: 55 }, widgetPositions: {}, widgetSizes: {}, widgetMinimized: {}, partyCompact: false, choicesDisplayRegex: true,
            trackerRunEvery: DEFAULT_TRACKER_RUN_EVERY, trackerWatermarks: {},
            trackerDirectLookback: 5, sceneLookback: 3, agentDirectLookback: 10,
            scenePictureAuto: false, scenePictureTrigger: 'location_change', scenePictureEveryN: 1, scenePicturePresentNpcs: true, scenePictureConnectionId: '', portraitSkipPromptDialog: false, portraitLocationBackground: false, attachBooksToCard: true, attachBooksTarget: 'chat',
            portraitAutoPlayer: false, portraitAutoParty: false, portraitAutoEnemies: false, portraitAutoNpcs: false, portraitStoryLookback: false, portraitStoryLookbackCount: 5, portraitConnectionId: '', portraitPromptConnectionId: '',
            wizardLookback: 10, wizardLookbackAll: false, wizardInjectMemo: false, wizardInjectLore: false, wizardInjectModulePrompts: false, wizardModuleExampleKeys: [], wizardSystemPrompt: '',
            worldProgressionEnabled: false, worldProgressionIntervalHours: 24, worldProgressionKeepActive: 1,
            worldProgressionLookback: 20, worldProgressionHistoryLookback: 0, worldProgressionLocationsPerReport: 3,
            worldProgressionLocationRandomize: true, worldProgressionExclusionList: '',
            worldProgressionConsolidateEnabled: false, worldProgressionConsolidateInterval: 7,
            worldSkeletonFactions: 4, worldSkeletonLocations: 4, worldSkeletonConflicts: 3, worldSkeletonSystemPrompt: '',
            worldSkeletonUseLorebooks: false, worldSkeletonLorebookOnly: false, worldSkeletonLorebookFilter: '', worldSkeletonUseExisting: true,
            worldSkeletonSourceLookback: 30,
            mapArchitectLookback: 12, mapArchitectSystemPrompt: '', mapArchitectOpener: 'tool',
            mapUpdaterEnabled: true, mapUpdaterRunEvery: 1, mapUpdaterLookback: 4, mapUpdaterSystemPrompt: '', mapRevealAll: false,
            mapEvolutionEnabled: true, mapEvolutionIntervalHours: 8, mapEvolutionOnSiteIntervalHours: 1, mapEvolutionOnSiteIntervalMinutes: 0, mapEvolutionOnSitePreset: 'dynamic', mapEvolutionScope: 'all', mapEvolutionCount: 2, mapEvolutionRandomize: true, mapEvolutionSelectedRoots: '', mapEvolutionWorldReportLookback: 5, mapEvolutionSystemPrompt: '', mapEvolutionCompressEnabled: true, mapEvolutionCompressThreshold: 10000, mapEvolutionNarratorCommitTokens: 2000, mapEvolutionLookback: 20, mapEvolutionConnectionId: '',
        creatorDraft: null, creatorPresets: [], creatorLevel: 1, creatorGearTier: 'auto', creatorCombatScalingGuide: true, creatorInitialDate: 'Day 1', creatorInitialTime: '08:00 AM', creatorConnectionId: '', narratorConnectionSeen: '', passMaxTokens: 0,
            creatorGenre: 'fantasy', creatorSendStarter: true, creatorInstantRandomLevel: false, creatorPlayerCard: false, creatorPersona: true, creatorCardWords: 150, creatorWaysDraft: null,
            npcAddAsIsMode: 'ai_review',
            relationshipMax: 150, relationshipMode: 'state_tracker', relationshipTrackerPrompt: '',
        })
    })

    it('does not let two patches in one tick lose each other', async () => {
        // The same race the settings store chains against: both would read the
        // same starting state and the second would drop the first.
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)

        const [first, second] = await Promise.all([
            store.patch({ messageCards: false }),
            store.patch({}),
        ])

        expect(first.messageCards).toBe(false)
        expect(second.messageCards).toBe(false)
    })

    it('reads an unreadable file as the defaults', async () => {
        const storage: PrefsStorage = {
            async getJson(): Promise<never> { throw new Error('disk gone') },
            async setJson(): Promise<void> {},
        }
        expect(await new PrefsStore(storage).load()).toEqual(DEFAULT_PREFS)
    })

    it('caches, so the panel asking twice costs one read', async () => {
        const { storage } = fakeStorage()
        const getJson = vi.spyOn(storage, 'getJson')
        const store = new PrefsStore(storage)

        await store.load()
        await store.load()
        expect(getJson).toHaveBeenCalledTimes(1)
    })

    it('hands back a copy, so a caller cannot edit the cache', async () => {
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)

        const prefs = await store.load()
        prefs.messageCards = true
        expect((await store.load()).messageCards).toBe(false)
    })
})

describe('which lorebooks a campaign owns', () => {
    it('remembers a chat\'s books', async () => {
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)

        const prefs = await store.patch({ campaignBooks: { 'chat-1': ['Vell_NPC'] } })
        expect(prefs.campaignBooks).toEqual({ 'chat-1': ['Vell_NPC'] })
    })

    it.each([
        ['a chat with no books', { 'chat-1': [] }],
        ['something that is not a list', { 'chat-1': 'Vell_NPC' }],
        ['a blank name among the books', { 'chat-1': ['', '  '] }],
        ['an empty chat id', { '': ['Vell_NPC'] }],
    ])('drops %s rather than trusting it', async (_label, campaignBooks) => {
        // This file is a user's to edit, and a malformed entry here decides
        // which books an undo may delete.
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)
        expect((await store.patch({ campaignBooks })).campaignBooks).toEqual({})
    })
})


describe('what the user called a campaign', () => {
    it('remembers a name per chat', async () => {
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)
        const prefs = await store.patch({ campaignNames: { 'chat-1': 'Vellmoor' } })
        expect(prefs.campaignNames).toEqual({ 'chat-1': 'Vellmoor' })
    })

    it('trims what the user typed', async () => {
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)
        expect((await store.patch({ campaignNames: { 'chat-1': '  Vellmoor  ' } })).campaignNames)
            .toEqual({ 'chat-1': 'Vellmoor' })
    })

    it.each([
        ['a blank name', { 'chat-1': '   ' }],
        ['a name that is not a string', { 'chat-1': 42 }],
        ['an empty chat id', { '': 'Vellmoor' }],
    ])('drops %s', async (_label, campaignNames) => {
        // Clearing the field must leave the chat unnamed rather than storing an
        // empty string that reads as "named, to nothing".
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)
        expect((await store.patch({ campaignNames })).campaignNames).toEqual({})
    })
})

describe('how far back the agent reads', () => {
    it('defaults to the whole chat', async () => {
        // A first pass over an established campaign wants everything: the
        // agent had been shown the last dozen messages and missed the days
        // before them.
        const { storage } = fakeStorage()
        expect((await new PrefsStore(storage).load()).agentLookback).toBe(0)
    })

    // The send bars' own windows, the legacy's `directPromptContext` and
    // `routerDirectLookback`.
    it('gives each send bar the legacy\'s window by default', async () => {
        const { storage } = fakeStorage()
        const prefs = await new PrefsStore(storage).load()
        expect(prefs.trackerDirectLookback).toBe(5)
        expect(prefs.agentDirectLookback).toBe(10)
    })

    it.each([
        ['zero, which reads nothing', 0, 0],
        ['a fraction', 7.9, 7],
        ['a negative number', -3, 0],
        ['past the ceiling', 999, 50],
        ['not a number', 'lots', 5],
    ])('settles %s for the tracker\'s send bar', async (_label, value, expected) => {
        const { storage } = fakeStorage()
        expect((await new PrefsStore(storage).patch({ trackerDirectLookback: value as number })).trackerDirectLookback).toBe(expected)
    })

    // The scene's window (52): one to twenty, three by default.
    it.each([
        ['the default', undefined, 3],
        ['a whole number', 7, 7],
        ['a fraction', 4.9, 4],
        ['zero', 0, 1],
        ['past the ceiling', 99, 20],
        ['not a number', 'lots', 3],
    ])('settles %s for the scene\'s window', async (_label, value, expected) => {
        const { storage } = fakeStorage()
        expect((await new PrefsStore(storage).patch({ sceneLookback: value as number })).sceneLookback).toBe(expected)
        expect((await new PrefsStore(storage).load()).sceneLookback).toBe(expected)
    })

    it.each([
        ['the default', undefined, 1],
        ['a whole number', 7, 7],
        ['a fraction', 4.9, 4],
        ['zero', 0, 1],
        ['past the ceiling', 99, 50],
        ['not a number', 'lots', 1],
    ])('settles %s for the scene picture\'s every-N (49)', async (_label, value, expected) => {
        const { storage } = fakeStorage()
        expect((await new PrefsStore(storage).patch({ scenePictureEveryN: value as number })).scenePictureEveryN).toBe(expected)
        expect((await new PrefsStore(storage).load()).scenePictureEveryN).toBe(expected)
    })

    it('reads the scene picture\'s switch, trigger, NPCs and connection (49), the legacy\'s default for a trigger it does not know', async () => {
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)
        expect(await store.patch({ scenePictureAuto: true, scenePictureTrigger: 'every_n_outputs', scenePicturePresentNpcs: false, scenePictureConnectionId: ' img-1 ' })).toMatchObject({ scenePictureAuto: true, scenePictureTrigger: 'every_n_outputs', scenePicturePresentNpcs: false, scenePictureConnectionId: 'img-1' })
        expect(await new PrefsStore(storage).load()).toMatchObject({ scenePictureAuto: true, scenePictureTrigger: 'every_n_outputs', scenePicturePresentNpcs: false, scenePictureConnectionId: 'img-1' })
        expect(await store.patch({ scenePictureTrigger: 'sometimes' as never, scenePictureAuto: 'yes' as never, scenePicturePresentNpcs: 'no' as never, scenePictureConnectionId: 7 as never })).toMatchObject({ scenePictureTrigger: 'location_change', scenePictureAuto: false, scenePicturePresentNpcs: true, scenePictureConnectionId: '' })
        // The attach switch (55): a boolean, on for anything else.
        expect(await store.patch({ attachBooksToCard: false })).toMatchObject({ attachBooksToCard: false })
        expect(await new PrefsStore(storage).load()).toMatchObject({ attachBooksToCard: false })
        expect(await store.patch({ attachBooksToCard: 'no' as never })).toMatchObject({ attachBooksToCard: true })
        // The wizard's context switches (73g): the keys list trimmed and deduplicated, anything else none.
        expect(await store.patch({ wizardLookbackAll: true, wizardInjectLore: true, wizardInjectModulePrompts: true, wizardModuleExampleKeys: [' stock:XP', 'stock:XP', 'field:HEAT', '', 7 as never] })).toMatchObject({ wizardLookbackAll: true, wizardInjectLore: true, wizardInjectModulePrompts: true, wizardModuleExampleKeys: ['stock:XP', 'field:HEAT', '7'] })
        expect(await store.patch({ wizardModuleExampleKeys: 'stock:XP' as never, wizardLookbackAll: 'yes' as never })).toMatchObject({ wizardModuleExampleKeys: [], wizardLookbackAll: true })
        // The display regex switch (65): off only when false, on for anything else, kept across a reload.
        expect(await store.patch({ choicesDisplayRegex: false })).toMatchObject({ choicesDisplayRegex: false })
        expect(await new PrefsStore(storage).load()).toMatchObject({ choicesDisplayRegex: false })
        expect(await store.patch({ choicesDisplayRegex: 'no' as never })).toMatchObject({ choicesDisplayRegex: true })
        expect(await store.patch({ choicesDisplayRegex: false })).toMatchObject({ choicesDisplayRegex: false })
        expect(await store.patch({ choicesDisplayRegex: true })).toMatchObject({ choicesDisplayRegex: true })
        // Where the books attach (55-ter): the chat unless the card is named.
        expect(await store.patch({ attachBooksTarget: 'card' })).toMatchObject({ attachBooksTarget: 'card' })
        expect(await new PrefsStore(storage).load()).toMatchObject({ attachBooksTarget: 'card' })
    })

    it('reads the portrait preferences (61): the four switches and the lookback as booleans, the count 0 to 100 and 5 otherwise, the two connections trimmed', async () => {
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)
        expect(await store.patch({ portraitAutoPlayer: true, portraitAutoParty: true, portraitAutoEnemies: true, portraitAutoNpcs: true, portraitStoryLookback: true, portraitStoryLookbackCount: 12, portraitConnectionId: ' img-2 ', portraitPromptConnectionId: ' conn-9 ' }))
            .toMatchObject({ portraitAutoPlayer: true, portraitAutoParty: true, portraitAutoEnemies: true, portraitAutoNpcs: true, portraitStoryLookback: true, portraitStoryLookbackCount: 12, portraitConnectionId: 'img-2', portraitPromptConnectionId: 'conn-9' })
        expect(await new PrefsStore(storage).load()).toMatchObject({ portraitAutoNpcs: true, portraitStoryLookbackCount: 12, portraitConnectionId: 'img-2', portraitPromptConnectionId: 'conn-9' })
        expect(await store.patch({ portraitAutoPlayer: 'yes' as never, portraitStoryLookback: 1 as never, portraitStoryLookbackCount: 500, portraitConnectionId: 7 as never, portraitPromptConnectionId: null as never }))
            .toMatchObject({ portraitAutoPlayer: false, portraitStoryLookback: false, portraitStoryLookbackCount: 100, portraitConnectionId: '', portraitPromptConnectionId: '' })
        expect(await store.patch({ portraitStoryLookbackCount: -3 })).toMatchObject({ portraitStoryLookbackCount: 0 })
        expect(await store.patch({ portraitStoryLookbackCount: 'x' as never })).toMatchObject({ portraitStoryLookbackCount: 5 })
        expect(await store.patch({ attachBooksTarget: 'persona' as never })).toMatchObject({ attachBooksTarget: 'chat' })
        expect(readAttachBooksTarget('card')).toBe('card')
        expect(readAttachBooksTarget('chat')).toBe('chat')
        expect(readAttachBooksTarget(undefined)).toBe('chat')
    })

    it('caps the agent\'s send bar at a hundred and keeps it across a reload', async () => {
        const { storage } = fakeStorage()
        expect((await new PrefsStore(storage).patch({ agentDirectLookback: 500 })).agentDirectLookback).toBe(100)
        expect((await new PrefsStore(storage).load()).agentDirectLookback).toBe(100)
        expect((await new PrefsStore(storage).load()).trackerDirectLookback).toBe(5)
    })

    // The game system wizard's context (Phase 32).
    it('keeps the wizard\'s window, memo switch and own prompt, clamped and typed', async () => {
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)
        expect(await store.patch({ wizardLookback: 500, wizardInjectMemo: true, wizardSystemPrompt: ' Mine. ' }))
            .toMatchObject({ wizardLookback: 200, wizardInjectMemo: true, wizardSystemPrompt: ' Mine. ' })
        expect(await new PrefsStore(storage).load()).toMatchObject({ wizardLookback: 200, wizardInjectMemo: true, wizardSystemPrompt: ' Mine. ' })
        expect((await store.patch({ wizardLookback: -1, wizardInjectMemo: 'yes' as never, wizardSystemPrompt: 3 as never })))
            .toMatchObject({ wizardLookback: 0, wizardInjectMemo: true, wizardSystemPrompt: ' Mine. ' })
    })

    it('takes a window when one is asked for', async () => {
        const { storage } = fakeStorage()
        expect((await new PrefsStore(storage).patch({ agentLookback: 40 })).agentLookback).toBe(40)
    })

    it.each([
        ['a negative number', -5, 0],
        ['a fraction', 12.7, 12],
        ['something that is not a number', 'lots', 0],
    ])('reads %s as %i', async (_label, value, expected) => {
        // This decides how much history a model is shown. A negative slice
        // would read as "all" by accident, and a fractional one would throw
        // somewhere a long way from here.
        const { storage } = fakeStorage()
        expect((await new PrefsStore(storage).patch({ agentLookback: value })).agentLookback).toBe(expected)
    })
})


describe('World Progression\'s preferences', () => {
    it('ships off, with the legacy\'s numbers', async () => {
        const store = new PrefsStore(fakeStorage().storage)
        const prefs = await store.load()
        expect(prefs).toMatchObject({
            worldProgressionEnabled: false,
            worldProgressionIntervalHours: 24,
            worldProgressionKeepActive: 1,
            worldProgressionLookback: 20,
            worldProgressionHistoryLookback: 0,
            worldProgressionLocationsPerReport: 3,
            worldProgressionLocationRandomize: true,
            worldProgressionExclusionList: '',
            worldProgressionConsolidateEnabled: false,
            worldProgressionConsolidateInterval: 7,
        })
    })

    it('clamps every number the legacy clamps, and keeps the rest typed', async () => {
        const store = new PrefsStore(fakeStorage().storage)
        const prefs = await store.patch({
            worldProgressionEnabled: true,
            worldProgressionIntervalHours: 0,
            worldProgressionKeepActive: 99,
            worldProgressionLookback: -3,
            worldProgressionHistoryLookback: 500,
            worldProgressionLocationsPerReport: 40,
            worldProgressionLocationRandomize: false,
            worldProgressionExclusionList: 'Morrowfen, docks',
            worldProgressionConsolidateEnabled: true,
            worldProgressionConsolidateInterval: 1,
        })
        expect(prefs).toMatchObject({
            worldProgressionEnabled: true,
            worldProgressionIntervalHours: 1,
            worldProgressionKeepActive: 20,
            worldProgressionLookback: 0,
            worldProgressionHistoryLookback: 100,
            worldProgressionLocationsPerReport: 12,
            worldProgressionLocationRandomize: false,
            worldProgressionExclusionList: 'Morrowfen, docks',
            worldProgressionConsolidateEnabled: true,
            worldProgressionConsolidateInterval: 2,
        })
        expect((await store.patch({ worldProgressionIntervalHours: 'nonsense', worldProgressionEnabled: 'yes' })).worldProgressionIntervalHours).toBe(24)
        expect((await store.load()).worldProgressionEnabled).toBe(true)
    })

    it('ships the skeleton (33b) with the legacy\'s counts, clamps them, and keeps the rest typed', async () => {
        const store = new PrefsStore(fakeStorage().storage)
        expect(await store.load()).toMatchObject({
            worldSkeletonFactions: 4, worldSkeletonLocations: 4, worldSkeletonConflicts: 3, worldSkeletonSystemPrompt: '',
            worldSkeletonUseLorebooks: false, worldSkeletonLorebookOnly: false, worldSkeletonLorebookFilter: '', worldSkeletonUseExisting: true,
            worldSkeletonSourceLookback: 30,
        })
        expect((await store.patch({ worldSkeletonSourceLookback: 0 })).worldSkeletonSourceLookback).toBe(1)
        expect((await store.patch({ worldSkeletonSourceLookback: 999 })).worldSkeletonSourceLookback).toBe(200)
        expect((await store.patch({ worldSkeletonSourceLookback: 'lots' })).worldSkeletonSourceLookback).toBe(30)
    })

    it('ships the Map Architect (34a) with the legacy\'s lookback, clamps it, and keeps the prompt typed', async () => {
        const store = new PrefsStore(fakeStorage().storage)
        expect(await store.load()).toMatchObject({ mapArchitectLookback: 12, mapArchitectSystemPrompt: '' })
        expect((await store.patch({ mapArchitectLookback: 500, mapArchitectSystemPrompt: 'Place things.' })).mapArchitectLookback).toBe(100)
        expect((await store.patch({ mapArchitectLookback: -4 })).mapArchitectLookback).toBe(0)
        expect((await store.patch({ mapArchitectLookback: 'many', mapArchitectSystemPrompt: 9 })).mapArchitectLookback).toBe(12)
        // The updater's four (34b): the switch, the cadence clamped to 1–50, the lookback to 1–100, the prompt a string.
        expect(await store.load()).toMatchObject({ mapUpdaterEnabled: true, mapUpdaterRunEvery: 1, mapUpdaterLookback: 4, mapUpdaterSystemPrompt: '' })
        expect(await store.patch({ mapUpdaterEnabled: false, mapUpdaterRunEvery: 99, mapUpdaterLookback: 0, mapUpdaterSystemPrompt: 'Mine.' })).toMatchObject({ mapUpdaterEnabled: false, mapUpdaterRunEvery: 50, mapUpdaterLookback: 1, mapUpdaterSystemPrompt: 'Mine.' })
        expect(await store.patch({ mapUpdaterEnabled: 'no', mapUpdaterRunEvery: 'x', mapUpdaterLookback: 500, mapUpdaterSystemPrompt: 3 })).toMatchObject({ mapUpdaterEnabled: false, mapUpdaterRunEvery: 1, mapUpdaterLookback: 100, mapUpdaterSystemPrompt: 'Mine.' })
        // The character creator (Phase 35): the draft and presets are read safely, the level and tier bounded, the dates kept.
        expect(await store.patch({ creatorDraft: { name: 'Robin', genre: 'fantasy' }, creatorPresets: [{ id: 'p1', name: 'Rogue', data: { class: 'Rogue' } }, { id: '', name: 'x', data: {} }, { id: 'p2', name: 'Bad', data: 'nope' }, { id: 'p3', name: '  ', data: {} }, 'junk'], creatorLevel: '7', creatorGearTier: 'heroic', creatorCombatScalingGuide: false, creatorInitialDate: ' 14/02/2026 ', creatorInitialTime: '21:30', creatorConnectionId: 'conn-9', creatorGenre: 'horror', creatorSendStarter: false, creatorInstantRandomLevel: true, creatorPlayerCard: true, creatorPersona: false, creatorCardWords: '300', creatorWaysDraft: { name: 'Quill', instructions: 7 } }))
            .toMatchObject({ creatorGenre: 'horror', creatorSendStarter: false, creatorInstantRandomLevel: true, creatorPlayerCard: true, creatorPersona: false, creatorCardWords: 300, creatorWaysDraft: { name: 'Quill', instructions: '' }, creatorDraft: { name: 'Robin', genre: 'fantasy' }, creatorPresets: [{ id: 'p1', name: 'Rogue', data: { class: 'Rogue' } }], creatorLevel: 7, creatorGearTier: 'heroic', creatorCombatScalingGuide: false, creatorInitialDate: '14/02/2026', creatorInitialTime: '21:30', creatorConnectionId: 'conn-9' })
        // The NPC creator's mode (41a): the two legacy values, anything else the default.
        expect((await store.patch({ npcAddAsIsMode: 'literal' })).npcAddAsIsMode).toBe('literal')
        expect((await store.patch({ npcAddAsIsMode: 'verbatim' })).npcAddAsIsMode).toBe('ai_review')
        // 89: the connection seen is an id trimmed; the output length is whole, zero for blank, held at the ceiling.
        expect(await store.patch({ narratorConnectionSeen: ' c-main ', passMaxTokens: '4096.7' })).toMatchObject({ narratorConnectionSeen: 'c-main', passMaxTokens: 4096 })
        expect(await store.patch({ narratorConnectionSeen: 7, passMaxTokens: '' })).toMatchObject({ narratorConnectionSeen: '', passMaxTokens: 0 })
        expect(await store.patch({ passMaxTokens: -5 })).toMatchObject({ passMaxTokens: 0 })
        expect(await store.patch({ passMaxTokens: 'lots' })).toMatchObject({ passMaxTokens: 0 })
        expect(await store.patch({ passMaxTokens: 1e9 })).toMatchObject({ passMaxTokens: 2_000_000 })
        expect(await store.patch({ creatorDraft: 'nope', creatorPresets: 'nope', creatorLevel: 'none', creatorGearTier: 'golden', creatorCombatScalingGuide: 'no', creatorInitialDate: '  ', creatorInitialTime: '', creatorConnectionId: 7, creatorGenre: 'western', creatorSendStarter: 'no', creatorInstantRandomLevel: 'yes', creatorPlayerCard: 'yes', creatorPersona: 0, creatorCardWords: 9000, creatorWaysDraft: 'nope' }))
            .toMatchObject({ creatorGenre: 'fantasy', creatorSendStarter: false, creatorInstantRandomLevel: true, creatorPlayerCard: true, creatorPersona: false, creatorCardWords: 5000, creatorWaysDraft: null, creatorDraft: null, creatorPresets: [], creatorLevel: 'none', creatorGearTier: 'auto', creatorCombatScalingGuide: false, creatorInitialDate: 'Day 1', creatorInitialTime: '08:00 AM', creatorConnectionId: '' })
        expect((await store.patch({ creatorLevel: 99 })).creatorLevel).toBe(20)
        expect((await store.patch({ creatorLevel: 0 })).creatorLevel).toBe(1)
        // Reveal all (34d) is off until switched on, and only a boolean moves it.
        expect((await store.load()).mapRevealAll).toBe(false)
        expect((await store.patch({ mapRevealAll: true })).mapRevealAll).toBe(true)
        expect((await store.patch({ mapRevealAll: 'off' })).mapRevealAll).toBe(true)
        expect((await store.patch({ mapRevealAll: false })).mapRevealAll).toBe(false)
        // The architect's opener (46): the tool unless 'text' is asked for, and only those two.
        expect((await store.load()).mapArchitectOpener).toBe('tool')
        expect((await store.patch({ mapArchitectOpener: 'text' })).mapArchitectOpener).toBe('text')
        expect((await store.patch({ mapArchitectOpener: 'block' })).mapArchitectOpener).toBe('text')
        expect((await store.patch({ mapArchitectOpener: 'tool' })).mapArchitectOpener).toBe('tool')
        // Evolution's fourteen (34c): each clamped to the legacy's range, the enums held to their values.
        expect(await store.patch({ mapEvolutionEnabled: false, mapEvolutionIntervalHours: 999, mapEvolutionOnSiteIntervalHours: 0, mapEvolutionOnSiteIntervalMinutes: 75, mapEvolutionOnSitePreset: 'standard', mapEvolutionScope: 'count', mapEvolutionCount: 99, mapEvolutionRandomize: false, mapEvolutionSelectedRoots: 'Abbey, Morrowfen', mapEvolutionWorldReportLookback: 0, mapEvolutionSystemPrompt: 'Evolve.', mapEvolutionCompressEnabled: false, mapEvolutionCompressThreshold: 1, mapEvolutionNarratorCommitTokens: 1, mapEvolutionLookback: 250, mapEvolutionConnectionId: 'conn-fast' }))
            .toMatchObject({ mapEvolutionEnabled: false, mapEvolutionIntervalHours: 168, mapEvolutionOnSiteIntervalHours: 0, mapEvolutionOnSiteIntervalMinutes: 59, mapEvolutionOnSitePreset: 'standard', mapEvolutionScope: 'count', mapEvolutionCount: 50, mapEvolutionRandomize: false, mapEvolutionSelectedRoots: 'Abbey, Morrowfen', mapEvolutionWorldReportLookback: 1, mapEvolutionSystemPrompt: 'Evolve.', mapEvolutionCompressEnabled: false, mapEvolutionCompressThreshold: 500, mapEvolutionNarratorCommitTokens: 200, mapEvolutionLookback: 100, mapEvolutionConnectionId: 'conn-fast' })
        expect(await store.patch({ mapEvolutionLookback: 0 })).toMatchObject({ mapEvolutionLookback: 0 })
        expect(await store.patch({ mapEvolutionOnSitePreset: 'wild', mapEvolutionScope: 'everything', mapEvolutionIntervalHours: 'x', mapEvolutionCompressThreshold: 1e9 })).toMatchObject({ mapEvolutionOnSitePreset: 'standard', mapEvolutionScope: 'count', mapEvolutionIntervalHours: 8, mapEvolutionCompressThreshold: 100000 })
        expect((await store.load()).mapArchitectSystemPrompt).toBe('Place things.')
        const prefs = await store.patch({
            worldSkeletonFactions: 99, worldSkeletonLocations: -1, worldSkeletonConflicts: 2.9, worldSkeletonSystemPrompt: 'Draw {locationCount}.',
            worldSkeletonUseLorebooks: true, worldSkeletonLorebookOnly: true, worldSkeletonLorebookFilter: 'Canon, Gods', worldSkeletonUseExisting: false,
        })
        expect(prefs).toMatchObject({
            worldSkeletonFactions: 20, worldSkeletonLocations: 0, worldSkeletonConflicts: 2, worldSkeletonSystemPrompt: 'Draw {locationCount}.',
            worldSkeletonUseLorebooks: true, worldSkeletonLorebookOnly: true, worldSkeletonLorebookFilter: 'Canon, Gods', worldSkeletonUseExisting: false,
        })
        const wrong = await store.patch({ worldSkeletonFactions: 'many', worldSkeletonUseLorebooks: 'yes', worldSkeletonLorebookFilter: ['Canon'], worldSkeletonSystemPrompt: 7 })
        expect(wrong).toMatchObject({ worldSkeletonFactions: 4, worldSkeletonUseLorebooks: true, worldSkeletonLorebookFilter: 'Canon, Gods', worldSkeletonSystemPrompt: 'Draw {locationCount}.' })
        // And they survive a round trip through storage.
        expect(await new PrefsStore(fakeStorage({ [await Promise.resolve('')]: undefined }).storage).load()).toMatchObject({ worldSkeletonUseExisting: true })
    })

    // The relationship system (44): the scale is clamped to the legacy's 10–10000, the mode one of two, the prompt a string.
    it('keeps the relationship scale on the legacy\'s rule, the mode to the two it knows, and the tracker prompt as text', async () => {
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)
        expect(await store.load()).toMatchObject({ relationshipMax: 150, relationshipMode: 'state_tracker', relationshipTrackerPrompt: '' })
        expect((await store.patch({ relationshipMax: 300, relationshipMode: 'regex', relationshipTrackerPrompt: 'mine' })).relationshipMax).toBe(300)
        expect(await store.load()).toMatchObject({ relationshipMode: 'regex', relationshipTrackerPrompt: 'mine' })
        expect((await store.patch({ relationshipMax: 5 })).relationshipMax).toBe(10)
        expect((await store.patch({ relationshipMax: 20000 })).relationshipMax).toBe(10000)
        expect((await store.patch({ relationshipMax: '240' })).relationshipMax).toBe(240)
        expect((await store.patch({ relationshipMode: 'magic' })).relationshipMode).toBe('state_tracker')
        expect((await store.patch({ relationshipTrackerPrompt: 7 })).relationshipTrackerPrompt).toBe('mine')
    })

    it('snapshots from memory only once loaded, for the interceptor', async () => {
        const store = new PrefsStore(fakeStorage().storage)
        expect(store.snapshot('u1')).toBeUndefined()
        await store.patch({ worldProgressionEnabled: true }, 'u1')
        expect(store.snapshot('u1')?.worldProgressionEnabled).toBe(true)
        expect(store.snapshot('u2')).toBeUndefined()
    })
})

describe('the agent turn budget', () => {
    it('defaults to the loop\'s own budget rather than a second copy of the number', async () => {
        const { storage } = fakeStorage()
        expect((await new PrefsStore(storage).load()).agentMaxTurns).toBe(DEFAULT_MAX_TURNS)
    })

    it('takes a smaller budget when one is asked for', async () => {
        const { storage } = fakeStorage()
        expect((await new PrefsStore(storage).patch({ agentMaxTurns: 3 })).agentMaxTurns).toBe(3)
    })

    it.each([
        ['zero', 0, 1],
        ['a negative number', -4, 1],
        ['a fraction', 6.8, 6],
        ['more turns than the loop can ever spend', 500, HARD_CALL_CEILING],
        ['something that is not a number', 'lots', DEFAULT_MAX_TURNS],
    ])('reads %s as %i', async (_label, value, expected) => {
        // Zero is deliberately *not* "off" here, unlike the cadence. A pass with
        // no turns would report that it used its budget without committing,
        // which reads as a broken agent rather than a switched-off one.
        const { storage } = fakeStorage()
        expect((await new PrefsStore(storage).patch({ agentMaxTurns: value })).agentMaxTurns).toBe(expected)
    })

    it('never offers a budget the loop could not spend', () => {
        // The loop stops at HARD_CALL_CEILING whatever the accounting says, so a
        // stored budget above it would be a number that quietly does nothing.
        expect(readMaxTurns(HARD_CALL_CEILING + 50)).toBe(HARD_CALL_CEILING)
    })
})


describe('the automatic pass cadence', () => {
    it('defaults to a pass every four replies', async () => {
        const { storage } = fakeStorage()
        expect((await new PrefsStore(storage).load()).agentRunEvery).toBe(DEFAULT_RUN_EVERY)
    })

    it('takes zero as off rather than as missing', async () => {
        // The number is the switch. `0` has to survive a round trip or there is
        // no way to stop the agent writing.
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)
        await store.patch({ agentRunEvery: 0 })
        expect((await store.load()).agentRunEvery).toBe(0)
    })

    it('reads a nonsense cadence as off, never as every reply', () => {
        // The failure that costs nothing is the one to prefer when the
        // alternative writes to a campaign every turn.
        for (const value of [-3, 'soon', Number.NaN, {}]) {
            expect(readRunEvery(value)).toBe(0)
        }
    })

    it('falls back to the default when the key is absent', () => {
        expect(readRunEvery(undefined)).toBe(DEFAULT_RUN_EVERY)
    })

    it('caps a cadence nobody meant', () => {
        expect(readRunEvery(9999)).toBe(MAX_RUN_EVERY)
    })

    it('keeps a watermark per chat and drops anything malformed', () => {
        expect(readWatermarks({ 'chat-1': 40, 'chat-2': 'soon', '': 3, 'chat-3': -1, 'chat-4': 12.7 }))
            .toEqual({ 'chat-1': 40, 'chat-4': 12 })
    })

    it('reads a missing watermark map as empty rather than throwing', () => {
        expect(readWatermarks(undefined)).toEqual({})
        expect(readWatermarks('nope')).toEqual({})
    })
})


describe('which model runs each job', () => {
    it('defaults to the host\'s choice, so an install that never picks is unchanged', async () => {
        const { storage } = fakeStorage()
        const prefs = await new PrefsStore(storage).load()
        expect(prefs.trackerConnectionId).toBe('')
        expect(prefs.agentConnectionId).toBe('')
    })

    it('keeps the two jobs on separate connections', async () => {
        // Multihog had two settings, and the jobs are different shapes: one
        // extraction call against a rigid format, versus turns of tool-calling.
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)
        await store.patch({ trackerConnectionId: 'fast-small' })
        const prefs = await store.patch({ agentConnectionId: 'big-smart' })

        expect(prefs.trackerConnectionId).toBe('fast-small')
        expect(prefs.agentConnectionId).toBe('big-smart')
    })

    it('reads a cleared choice as the default again', async () => {
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)
        await store.patch({ trackerConnectionId: 'fast-small' })
        expect((await store.patch({ trackerConnectionId: '' })).trackerConnectionId).toBe('')
    })

    it.each([
        ['a number', 42],
        ['an object', { id: 'x' }],
        ['null', null],
    ])('reads %s as the default rather than passing it to the host', async (_label, value) => {
        const { storage } = fakeStorage()
        expect((await new PrefsStore(storage).patch({ trackerConnectionId: value as never })).trackerConnectionId)
            .toBe('')
    })

    it('trims a pasted id rather than sending whitespace to the host', async () => {
        expect(readConnectionId('  abc  ')).toBe('abc')
    })

    it('keeps an id the host no longer lists, rather than silently resetting it', async () => {
        // Only the host knows which ids are real. Rewriting the user's choice
        // because we could not verify it would hide a deleted connection behind
        // a working-looking default.
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)
        expect((await store.patch({ agentConnectionId: 'deleted-yesterday' })).agentConnectionId)
            .toBe('deleted-yesterday')
    })
})


describe('how much story the tracker reads', () => {
    it('defaults to the current exchange, as the legacy does', async () => {
        // Not the six messages this build sent until 0.20.0. The legacy's own
        // UI marks this mode "(recommended)".
        const { storage } = fakeStorage()
        const prefs = await new PrefsStore(storage).load()
        expect(prefs.trackerLookbackMode).toBe('since-last-user')
        expect(prefs.trackerLookbackCount).toBe(2)
    })

    it('takes a fixed window when one is asked for', async () => {
        const { storage } = fakeStorage()
        const prefs = await new PrefsStore(storage).patch({ trackerLookbackMode: 'fixed', trackerLookbackCount: 8 })
        expect(prefs.trackerLookbackMode).toBe('fixed')
        expect(prefs.trackerLookbackCount).toBe(8)
    })

    it.each([
        ['an unknown mode', 'everything'],
        ['a number', 4],
        ['null', null],
    ])('reads %s as the recommended window', (_label, value) => {
        expect(readLookbackMode(value)).toBe('since-last-user')
    })

    it.each([
        ['zero', 0, 1],
        ['a negative number', -3, 1],
        ['a fraction', 5.7, 5],
        ['something absurd', 5000, 50],
        ['nonsense', 'lots', DEFAULT_LOOKBACK_COUNT],
    ])('reads a window of %s as %i', (_label, value, expected) => {
        // Zero would send the extractor no narrative at all, which reads as a
        // broken tracker rather than a fast one.
        expect(readLookbackCount(value)).toBe(expected)
    })
})

describe('the visual theme (74a)', () => {
    it('is the host’s own colours by default, keeps a chosen theme, and reads anything unknown as the host’s', async () => {
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)
        expect((await store.load()).trackerTheme).toBe('native')
        await store.patch({ trackerTheme: 'hacker' })
        expect((await store.load()).trackerTheme).toBe('hacker')
        await store.patch({ trackerTheme: 'rt-theme-cherry' as never })
        expect((await store.load()).trackerTheme).toBe('native')
        await store.patch({ trackerTheme: 'cherry' })
        expect((await store.load()).trackerTheme).toBe('cherry')
    })

    it('reads a stored record’s unknown theme as the host’s colours, not only a patched one', async () => {
        // The patch cleans what it writes; a record written by a later build, or by hand, is read on load alone.
        const { storage } = fakeStorage({ [`@self:${PREFS_PATH}`]: { trackerTheme: 'rt-theme-hacker' } })
        expect((await new PrefsStore(storage).load()).trackerTheme).toBe('native')
        const kept = fakeStorage({ [`@self:${PREFS_PATH}`]: { trackerTheme: 'hologram' } })
        expect((await new PrefsStore(kept.storage).load()).trackerTheme).toBe('hologram')
    })
})

describe('the AI Theme Wizard’s theme and library (74b)', () => {
    it('keeps a theme of the wizard’s keys and a library by name, reads nothing for anything else, and clears on null', async () => {
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)
        expect((await store.load())).toMatchObject({ customTheme: null, savedThemes: {} })
        await store.patch({ customTheme: { '--rt-custom-accent': '#00ffaa', '--lh-accent': '#fff', '--rt-custom-bg': 3 as never } })
        expect((await store.load()).customTheme).toEqual({ '--rt-custom-accent': '#00ffaa' })
        await store.patch({ savedThemes: { Night: { '--rt-custom-accent': '#123' }, Bad: 'x' as never } })
        expect((await store.load()).savedThemes).toEqual({ Night: { '--rt-custom-accent': '#123' } })
        await store.patch({ customTheme: null })
        expect((await store.load()).customTheme).toBeNull()
        const seeded = fakeStorage({ [`@self:${PREFS_PATH}`]: { customTheme: 'noir', savedThemes: [1] } })
        expect((await new PrefsStore(seeded.storage).load())).toMatchObject({ customTheme: null, savedThemes: {} })
    })
})

describe('the font sizes (74e)', () => {
    it('is the host’s size by default, keeps a size within the slider, clamps a number outside it, and reads nonsense as the host’s', async () => {
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)
        expect((await store.load()).trackerFontSize).toBe(0)
        expect((await store.load()).settingsFontSize).toBe(0)
        await store.patch({ trackerFontSize: 16, settingsFontSize: 11 })
        expect((await store.load())).toMatchObject({ trackerFontSize: 16, agentFontSize: 0, settingsFontSize: 11 })
        await store.patch({ agentFontSize: 9 })
        expect((await store.load())).toMatchObject({ agentFontSize: 9, settingsFontSize: 11 })
        // The second widget sized with the settings tab before 90: a file written before it has no agent size, and reads the settings' (the look kept).
        const before90 = new PrefsStore(fakeStorage({ [`@self:${PREFS_PATH}`]: { trackerFontSize: 16, settingsFontSize: 11 } }).storage)
        expect((await before90.load())).toMatchObject({ agentFontSize: 11, settingsFontSize: 11 })
        const hostAgent = new PrefsStore(fakeStorage({ [`@self:${PREFS_PATH}`]: { agentFontSize: 0, settingsFontSize: 11 } }).storage)
        expect((await hostAgent.load())).toMatchObject({ agentFontSize: 0, settingsFontSize: 11 })
        await store.patch({ trackerFontSize: 90 })
        expect((await store.load()).trackerFontSize).toBe(32)
        await store.patch({ settingsFontSize: 0 })
        expect((await store.load()).settingsFontSize).toBe(0)
        const seeded = fakeStorage({ [`@self:${PREFS_PATH}`]: { trackerFontSize: 'large', settingsFontSize: 2 } })
        expect((await new PrefsStore(seeded.storage).load())).toMatchObject({ trackerFontSize: 0, settingsFontSize: 8 })
    })
})

describe('the backdrops (74d)', () => {
    it('are empty with Multihog’s 55% tint by default, keep a stored backdrop, and read anything odd back into shape', async () => {
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)
        expect((await store.load()).trackerBackdrop).toEqual({ day: '', night: '', strength: 55 })
        expect((await store.load()).settingsBackdrop).toEqual({ day: '', night: '', strength: 55 })
        await store.patch({ trackerBackdrop: { day: '/images/d.jpg', night: 'https://host/n.jpg', strength: 40 } })
        expect((await store.load()).trackerBackdrop).toEqual({ day: '/images/d.jpg', night: 'https://host/n.jpg', strength: 40 })
        await store.patch({ settingsBackdrop: { day: ' x ', strength: 400 } as never })
        expect((await store.load()).settingsBackdrop).toEqual({ day: 'x', night: '', strength: 100 })
        const seeded = fakeStorage({ [`@self:${PREFS_PATH}`]: { trackerBackdrop: 'nonsense', settingsBackdrop: { day: 3, strength: 'x' } } })
        expect((await new PrefsStore(seeded.storage).load())).toMatchObject({ trackerBackdrop: { day: '', night: '', strength: 55 }, settingsBackdrop: { day: '', night: '', strength: 55 } })
        // A record written by a later build, or by hand, is read on load alone: the patch cleans only what it writes.
        const kept = fakeStorage({ [`@self:${PREFS_PATH}`]: { trackerBackdrop: { day: '/images/k.jpg', night: '', strength: 20 }, settingsBackdrop: { day: '', night: 'https://host/s.jpg', strength: 80 } } })
        expect((await new PrefsStore(kept.storage).load())).toMatchObject({ trackerBackdrop: { day: '/images/k.jpg', night: '', strength: 20 }, settingsBackdrop: { day: '', night: 'https://host/s.jpg', strength: 80 } })
    })
})

describe('the day/night cycle (74c)', () => {
    it('is off by default, keeps a tick, and reads anything but true as off', async () => {
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)
        expect((await store.load()).dayNightCycle).toBe(false)
        await store.patch({ dayNightCycle: true })
        expect((await store.load()).dayNightCycle).toBe(true)
        await store.patch({ dayNightCycle: 'yes' as never })
        expect((await store.load()).dayNightCycle).toBe(false)
        const seeded = fakeStorage({ [`@self:${PREFS_PATH}`]: { dayNightCycle: 1 } })
        expect((await new PrefsStore(seeded.storage).load()).dayNightCycle).toBe(false)
        const kept = fakeStorage({ [`@self:${PREFS_PATH}`]: { dayNightCycle: true } })
        expect((await new PrefsStore(kept.storage).load()).dayNightCycle).toBe(true)
    })

    it('keeps the Map Themes as the legacy reads them, with a canvas image stored with the host (74g)', async () => {
        const store = new PrefsStore(fakeStorage().storage)
        expect((await store.load()).mapTheme).toEqual(DEFAULT_MAP_THEME)
        expect((await store.load()).activeMapThemePresetId).toBe('factory:ember')
        await store.patch({ mapTheme: { accent: '#AABBCC', route: 'red', backgroundImage: '/images/stored/map.jpg', backgroundImageStrength: 150 } as never, activeMapThemePresetId: '' })
        const loaded = await store.load()
        expect(loaded.mapTheme.accent).toBe('#aabbcc')
        expect(loaded.mapTheme.route).toBe(DEFAULT_MAP_THEME.route)
        expect(loaded.mapTheme.backgroundImage).toBe('/images/stored/map.jpg')
        expect(loaded.mapTheme.backgroundImageStrength).toBe(100)
        expect(loaded.activeMapThemePresetId).toBe('')
        await store.patch({ savedMapThemePresets: { Night: { background: '#010203' }, __proto__: { background: '#ffffff' } } as never, activeMapThemePresetId: 7 as never })
        const saved = await store.load()
        expect(Object.keys(saved.savedMapThemePresets)).toEqual(['Night'])
        expect(saved.savedMapThemePresets.Night!.background).toBe('#010203')
        expect(saved.activeMapThemePresetId).toBe('')
        // A stored record is read on load alone: a bad colour falls to Ember's, a scheme in the image is dropped, a kept address is kept.
        const seeded = fakeStorage({ [`@self:${PREFS_PATH}`]: { mapTheme: { accent: 'red', backgroundImage: 'javascript:alert(1)' }, savedMapThemePresets: { Dawn: { backgroundImage: '/images/stored/d.jpg' } }, activeMapThemePresetId: 'user:Dawn' } })
        const read = await new PrefsStore(seeded.storage).load()
        expect(read.mapTheme.accent).toBe(DEFAULT_MAP_THEME.accent)
        expect(read.mapTheme.backgroundImage).toBe('')
        expect(read.savedMapThemePresets.Dawn!.backgroundImage).toBe('/images/stored/d.jpg')
        expect(read.activeMapThemePresetId).toBe('user:Dawn')
    })

    it('keeps a bar’s config in Multihog’s shape (74i): the mode, the two colours, the readout and the animation, cleaned', async () => {
        const store = new PrefsStore(fakeStorage().storage)
        await store.patch({ bars: { 'XP::XP': { mode: 'gradient', color: '#F39C12', color2: '#e67e22', showAsPercentage: true, animateChanges: true } } })
        expect((await store.load()).bars).toEqual({ 'XP::XP': { mode: 'gradient', color: '#f39c12', color2: '#e67e22', showAsPercentage: true, animateChanges: true } })
        await store.patch({ bars: { 'XP::XP': { mode: 'dynamic', color: 'url(x)', color2: 'red' } } })
        expect((await store.load()).bars).toEqual({ 'XP::XP': { mode: 'dynamic' } })
        await store.patch({ bars: { 'XP::XP': { mode: 'gradient' } } })
        expect((await store.load()).bars).toEqual({})
    })

    it('keeps Tab Mode’s layout and the tab shown, refusing a layout it does not know (76)', async () => {
        const store = new PrefsStore(fakeStorage().storage)
        const first = await store.load()
        expect([first.panelLayoutMode, first.trackerActiveTab]).toEqual(['stack', ''])
        await store.patch({ panelLayoutMode: 'tabs', trackerActiveTab: 'DISPLAY_GROUP_crew' })
        const next = await store.load()
        expect([next.panelLayoutMode, next.trackerActiveTab]).toEqual(['tabs', 'DISPLAY_GROUP_crew'])
        await store.patch({ panelLayoutMode: 'grid' as never, trackerActiveTab: 7 as never })
        const after = await store.load()
        expect([after.panelLayoutMode, after.trackerActiveTab]).toEqual(['tabs', 'DISPLAY_GROUP_crew'])
    })

    it('keeps the Display Groups as the legacy normalises them, the two switches off as Multihog ships them (75)', async () => {
        const store = new PrefsStore(fakeStorage().storage)
        const first = await store.load()
        expect([first.displayGroupsEnabled, first.displayGroupsShowGaps, first.displayGroups]).toEqual([false, false, []])
        await store.patch({ displayGroupsEnabled: true, displayGroupsShowGaps: 'yes' as never, displayGroups: [{ id: 'g', name: 'G', members: ['FUEL', 'COMBAT', 'fuel'] }, { id: '', name: 'x', members: ['A'] }] as never })
        const next = await store.load()
        expect(next.displayGroupsEnabled).toBe(true)
        expect(next.displayGroupsShowGaps).toBe(false)
        expect(next.displayGroups).toEqual([{ id: 'g', name: 'G', icon: '🗂️', enabled: true, members: ['FUEL'] }])
        const seeded = fakeStorage({ [`@self:${PREFS_PATH}`]: { displayGroups: 'junk', displayGroupsEnabled: 1 } })
        const loaded = await new PrefsStore(seeded.storage).load()
        expect([loaded.displayGroupsEnabled, loaded.displayGroups]).toEqual([false, []])
    })

    it('keeps the animated bars’ switch as a boolean, on by default as Multihog ships it, and a bar’s own animate tick (74h)', async () => {
        const store = new PrefsStore(fakeStorage().storage)
        expect((await store.load()).animateAllCustomBarChanges).toBe(true)
        await store.patch({ animateAllCustomBarChanges: false })
        expect((await store.load()).animateAllCustomBarChanges).toBe(false)
        await store.patch({ animateAllCustomBarChanges: 'no' as never })
        expect((await store.load()).animateAllCustomBarChanges).toBe(false)
        await store.patch({ animateAllCustomBarChanges: true })
        expect((await store.load()).animateAllCustomBarChanges).toBe(true)
        const seeded = fakeStorage({ [`@self:${PREFS_PATH}`]: { animateAllCustomBarChanges: 1, bars: { a: { animate: true }, b: { animate: 1 } } } })
        const loaded = await new PrefsStore(seeded.storage).load()
        expect(loaded.animateAllCustomBarChanges).toBe(false)
        expect(loaded.bars).toEqual({ a: { animateChanges: true } })
        await store.patch({ bars: { c: { color: '#ff8800', animateChanges: true } } })
        expect((await store.load()).bars).toEqual({ c: { color: '#ff8800', animateChanges: true } })
        await store.patch({ bars: { c: { animateChanges: false } } })
        expect((await store.load()).bars).toEqual({})
    })

    it('keeps the XP bar at the bottom as a boolean, on by default as Multihog ships it (74f)', async () => {
        const store = new PrefsStore(fakeStorage().storage)
        expect((await store.load()).xpBarAtBottom).toBe(true)
        await store.patch({ xpBarAtBottom: false })
        expect((await store.load()).xpBarAtBottom).toBe(false)
        await store.patch({ xpBarAtBottom: 'no' as never })
        expect((await store.load()).xpBarAtBottom).toBe(false)
        await store.patch({ xpBarAtBottom: true })
        expect((await store.load()).xpBarAtBottom).toBe(true)
        // A stored value is read on load alone, bad ones as off, a kept false as false (the default would cover a reader that dropped it).
        const seeded = fakeStorage({ [`@self:${PREFS_PATH}`]: { xpBarAtBottom: 1 } })
        expect((await new PrefsStore(seeded.storage).load()).xpBarAtBottom).toBe(false)
        const kept = fakeStorage({ [`@self:${PREFS_PATH}`]: { xpBarAtBottom: false } })
        expect((await new PrefsStore(kept.storage).load()).xpBarAtBottom).toBe(false)
    })
})

describe('the panel layout (47b)', () => {
    it('is classic by default: the one tab everything has always been in', async () => {
        const { storage } = fakeStorage()
        expect((await new PrefsStore(storage).load()).layout).toBe('widgets')
    })

    it('keeps the tabs layout once chosen', async () => {
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)
        await store.patch({ layout: 'tabs' })
        expect((await store.load()).layout).toBe('tabs')
        await store.patch({ layout: 'classic' })
        expect((await store.load()).layout).toBe('classic')
    })

    it('reads anything but one of the three as the default, the widgets (47f), and keeps classic as a choice', () => {
        expect(readLayout('classic')).toBe('classic')
        for (const value of ['panels', '', 7, null, {}]) expect(readLayout(value)).toBe('widgets')
        expect(readLayout('tabs')).toBe('tabs')
        expect(readLayout('widgets')).toBe('widgets')
    })

    it('keeps the widgets layout once chosen', async () => {
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)
        await store.patch({ layout: 'widgets' })
        expect((await store.load()).layout).toBe('widgets')
    })
})

describe('the widget positions (47c)', () => {
    it('are empty by default, which means the widgets\' own places', async () => {
        const { storage } = fakeStorage()
        expect((await new PrefsStore(storage).load()).widgetPositions).toEqual({})
    })

    it('keep where each widget was left, rounded to pixels', async () => {
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)
        await store.patch({ widgetPositions: { tracker: { x: 24.6, y: 80 }, scene: { x: 420, y: 81.2 } } })
        expect((await store.load()).widgetPositions).toEqual({ tracker: { x: 25, y: 80 }, scene: { x: 420, y: 81 } })
    })

    it('drop a position that is not two finite numbers, so a widget can never be lost off screen', () => {
        expect(readWidgetPositions({ tracker: { x: 'left', y: 10 }, scene: { x: 1, y: Number.NaN }, good: { x: 3, y: 4 }, bare: 7, '': { x: 1, y: 1 } })).toEqual({ good: { x: 3, y: 4 } })
        expect(readWidgetPositions('nonsense')).toEqual({})
    })

    it('keeps the widgets\' sizes once dragged, rounded and floored at the minimum', async () => {
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)
        expect((await store.load()).widgetSizes).toEqual({})
        await store.patch({ widgetSizes: { tracker: { width: 640.4, height: 700 }, scene: { width: 10, height: 480.6 } } })
        // A fresh store over the same storage: what was written, not what was cached.
        expect((await new PrefsStore(storage).load()).widgetSizes).toEqual({ tracker: { width: 640, height: 700 }, scene: { width: 280, height: 481 } })
    })

    it('drops a size that is not two finite numbers', () => {
        expect(readWidgetSizes({ tracker: { width: 'wide', height: 10 }, scene: { width: 1, height: Number.POSITIVE_INFINITY }, good: { width: 300, height: 300 }, bare: 7, '': { width: 300, height: 300 } })).toEqual({ good: { width: 300, height: 300 } })
        expect(readWidgetSizes(null)).toEqual({})
    })

    it('keeps which widgets are folded (57), booleans only', async () => {
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)
        expect((await store.load()).widgetMinimized).toEqual({})
        await store.patch({ widgetMinimized: { tracker: true, scene: false } })
        expect((await new PrefsStore(storage).load()).widgetMinimized).toEqual({ tracker: true, scene: false })
        expect(readWidgetMinimized({ tracker: 'yes', scene: true, '': true, other: 1 })).toEqual({ scene: true })
        expect(readWidgetMinimized(null)).toEqual({})
        expect(readWidgetMinimized([true])).toEqual({})
    })
})

describe('the PARTY compact mode (47e-ter)', () => {
    it('is off by default and kept once switched, and ignores a value that is not a boolean', async () => {
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)
        expect((await store.load()).partyCompact).toBe(false)
        await store.patch({ partyCompact: true })
        expect((await new PrefsStore(storage).load()).partyCompact).toBe(true)
        await store.patch({ partyCompact: 'yes' as unknown as boolean })
        expect((await store.load()).partyCompact).toBe(true)
    })
})

describe('Debug & factory reset (72a)', () => {
    it('defaults debug logging off and the stock-text refresh on, and reads both', () => {
        const { readPrefs, readPrefsPatch } = prefsModule
        expect(readPrefs(null).debugLogging).toBe(false)
        expect(readPrefs(null).autoUpdatePrompts).toBe(true)
        expect(readPrefs({ debugLogging: true, autoUpdatePrompts: false }).debugLogging).toBe(true)
        expect(readPrefs({ debugLogging: true, autoUpdatePrompts: false }).autoUpdatePrompts).toBe(false)
        // As the regex switch reads: on is `true` alone for the log, and anything but `false` for the refresh.
        expect(readPrefsPatch({ debugLogging: 'yes', autoUpdatePrompts: 0 })).toEqual({ debugLogging: false, autoUpdatePrompts: true })
        expect(readPrefsPatch({ autoUpdatePrompts: false })).toEqual({ autoUpdatePrompts: false })
    })

    it('resets the install to its defaults and keeps what belongs to a chat', async () => {
        const { storage } = fakeStorage()
        const store = new PrefsStore(storage)
        await store.patch({ messageCards: true, agentMaxTurns: 9, debugLogging: true, campaignNames: { 'chat-1': 'Vell' }, campaignBooks: { 'chat-1': ['Vell_NPC'] }, trackerWatermarks: { 'chat-1': 4 }, agentWatermarks: { 'chat-1': 7 }, widgetPositions: { tracker: { x: 1, y: 2 } } }, 'u1')
        const prefs = await store.resetInstall('u1')
        expect(prefs.messageCards).toBe(false)
        expect(prefs.agentMaxTurns).toBe(prefsModule.DEFAULT_PREFS.agentMaxTurns)
        expect(prefs.debugLogging).toBe(false)
        expect(prefs.widgetPositions).toEqual(prefsModule.DEFAULT_PREFS.widgetPositions)
        expect(prefs.campaignNames).toEqual({ 'chat-1': 'Vell' })
        expect(prefs.campaignBooks).toEqual({ 'chat-1': ['Vell_NPC'] })
        expect(prefs.trackerWatermarks).toEqual({ 'chat-1': 4 })
        expect(prefs.agentWatermarks).toEqual({ 'chat-1': 7 })
        // Persisted: a fresh store reads the same.
        const again = await new PrefsStore(storage).load('u1')
        expect(again.messageCards).toBe(false)
        expect(again.campaignNames).toEqual({ 'chat-1': 'Vell' })
    })
})

describe('the second pass’s preferences (72b)', () => {
    it('reads each as its kind, defaults the switches on but the legacy dice and the inventory total off, and bounds the numbers', () => {
        expect(readPrefs(null)).toMatchObject({ frameworkEnabled: true, agentEnabled: true, trackerSwipeRollback: true, agentSwipeRollback: true, legacyDiceNaming: false, portraitsEnabled: true, inventoryShowTotal: false, inventoryWorthMode: 'hover', agentLookbackMode: 'since_last_run', trackerHistoryStates: 1, npcMajorWords: 225, npcMinorWords: 135, narratorCardName: 'Game Master' })
        expect(readPrefsPatch({ frameworkEnabled: false, agentEnabled: 0, trackerSwipeRollback: 'no', agentSwipeRollback: false, legacyDiceNaming: 'yes', portraitsEnabled: false, npcRelationshipToast: false })).toEqual({ frameworkEnabled: false, agentEnabled: true, trackerSwipeRollback: true, agentSwipeRollback: false, legacyDiceNaming: false, portraitsEnabled: false, npcRelationshipToast: false })
        // Full Review Mode (73c) is on only when true, off by default.
        expect(readPrefsPatch({ trackerFullReviewMode: 'yes' })).toEqual({ trackerFullReviewMode: false })
        expect(readPrefsPatch({ trackerFullReviewMode: true })).toEqual({ trackerFullReviewMode: true })
        // Show Location Images (80) is on only when true, off by default, as Multihog ships it.
        expect(readPrefsPatch({ locationImages: 'yes' })).toEqual({ locationImages: false })
        expect(readPrefsPatch({ locationImages: true })).toEqual({ locationImages: true })
        expect(readPrefs(null).locationImages).toBe(false)
        // The lorebooks into the tracker (73h): the switch off unless true; the filter trimmed, deduplicated, and an empty list when it is not a list.
        expect(readPrefsPatch({ trackerInjectLorebooks: 'yes', trackerLorebookFilter: [' Vell_NPC', 'Vell_NPC', '', 'Shared canon', 4 as never] })).toEqual({ trackerInjectLorebooks: false, trackerLorebookFilter: ['Vell_NPC', 'Shared canon', '4'] })
        expect(readPrefsPatch({ trackerInjectLorebooks: true, trackerLorebookFilter: 'Vell_NPC' })).toEqual({ trackerInjectLorebooks: true, trackerLorebookFilter: [] })
        expect(readPrefs(null).trackerFullReviewMode).toBe(false)
        expect(readPrefsPatch({ inventoryShowTotal: true, inventoryWorthMode: 'display' })).toEqual({ inventoryShowTotal: true, inventoryWorthMode: 'display' })
        expect(readPrefsPatch({ inventoryWorthMode: 'badge' })).toEqual({ inventoryWorthMode: 'hover' })
        expect(readPrefsPatch({ agentLookbackMode: 'since_last_user' })).toEqual({ agentLookbackMode: 'since_last_user' })
        expect(readPrefsPatch({ agentLookbackMode: 'whenever' })).toEqual({ agentLookbackMode: 'since_last_run' })
        expect(readPrefsPatch({ trackerHistoryStates: 40, npcMajorWords: '300', npcMinorWords: -2 })).toEqual({ trackerHistoryStates: 10, npcMajorWords: 300, npcMinorWords: 1 })
        expect(readPrefsPatch({ mapArchitectConnectionId: ' c1 ', mapUpdaterConnectionId: 7 })).toEqual({ mapArchitectConnectionId: 'c1', mapUpdaterConnectionId: '' })
        expect(readPrefsPatch({ narratorCardName: '  ' })).toEqual({ narratorCardName: 'Game Master' })
        expect(readPrefsPatch({ narratorCardName: 'x'.repeat(200) }).narratorCardName).toHaveLength(120)
        expect(readPrefs({ version: 1, agentLookbackMode: 'fixed', trackerHistoryStates: 3 })).toMatchObject({ agentLookbackMode: 'fixed', trackerHistoryStates: 3 })
    })
})

describe('the terminal’s preferences (71b)', () => {
    it('keeps a draft per feed, bounds the three map bars’ lookbacks, and keeps the tab shown last', () => {
        expect(readPrefs(null)).toMatchObject({ terminalDrafts: { state_tracker: '', lorebook_agent: '', map_updater: '', map_evolution: '', map_architect: '' }, mapUpdaterDirectLookback: 10, mapEvolutionDirectLookback: 10, mapArchitectDirectLookback: 10, agentTerminalTab: 'lorebook_agent' })
        expect(readPrefsPatch({ terminalDrafts: { map_architect: 'Create a DUNGEON map for "X"', world: 'no', state_tracker: 7 } })).toEqual({ terminalDrafts: { state_tracker: '', lorebook_agent: '', map_updater: '', map_evolution: '', map_architect: 'Create a DUNGEON map for "X"' } })
        expect(readPrefsPatch({ terminalDrafts: 'x' })).toEqual({ terminalDrafts: { state_tracker: '', lorebook_agent: '', map_updater: '', map_evolution: '', map_architect: '' } })
        expect(readPrefsPatch({ mapUpdaterDirectLookback: 500, mapEvolutionDirectLookback: -3, mapArchitectDirectLookback: '12' })).toEqual({ mapUpdaterDirectLookback: 100, mapEvolutionDirectLookback: 0, mapArchitectDirectLookback: 12 })
        expect(readPrefsPatch({ agentTerminalTab: 'map_architect' })).toEqual({ agentTerminalTab: 'map_architect' })
        expect(readPrefsPatch({ agentTerminalTab: 'elsewhere' })).toEqual({ agentTerminalTab: 'lorebook_agent' })
        // The User Prompt Suffix (72c): a string kept as typed; anything else ignored.
        expect(readPrefsPatch({ trackerUserPromptSuffix: '## MINE:' })).toEqual({ trackerUserPromptSuffix: '## MINE:' })
        // The agent's tools (71c): the pause reads true only when true; the dials are bounded as the legacy bounds them.
        expect(readPrefsPatch({ agentPaused: 'yes', agentCleanupUseThreshold: 0, agentCleanupThreshold: 7, agentCleanupEvery: 500, agentAuditTokens: 'x' }))
            .toEqual({ agentPaused: false, agentCleanupUseThreshold: true, agentCleanupThreshold: 50, agentCleanupEvery: 100, agentAuditTokens: 32000 })
        expect(readPrefsPatch({ agentPaused: true, agentCleanupUseThreshold: false, agentCleanupThreshold: 9000, agentCleanupEvery: 3, agentAuditTokens: 8000 }))
            .toEqual({ agentPaused: true, agentCleanupUseThreshold: false, agentCleanupThreshold: 5000, agentCleanupEvery: 3, agentAuditTokens: 8000 })
        expect(readPrefsPatch({ trackerUserPromptSuffix: 7 })).toEqual({})
        expect(readPrefs({ version: 1, terminalDrafts: { lorebook_agent: 'd' }, agentTerminalTab: 'state_tracker' })).toMatchObject({ terminalDrafts: { lorebook_agent: 'd', map_updater: '' }, agentTerminalTab: 'state_tracker' })
    })
})
