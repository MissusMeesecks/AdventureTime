// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Bridge, RequestTimeoutError } from './bridge.js'
import { MAX_PORTRAIT_BYTES, describeStep, mountTrackerPanel as mountPanel, type TrackerPanelHost } from './tracker-panel.js'

// Every panel a test mounts is destroyed after it (lesson 50): 258 mounts
// that each kept their bridge subscription and timers alive held every
// panel's DOM for the whole file, and the file outgrew the CI runner's heap.
const mounted: Array<ReturnType<typeof mountPanel>> = []
function mountTrackerPanel(...args: Parameters<typeof mountPanel>): ReturnType<typeof mountPanel> {
    const panel = mountPanel(...args)
    mounted.push(panel)
    return panel
}
afterEach(() => {
    for (const panel of mounted.splice(0)) {
        try { panel.destroy() } catch { /* a test that destroyed its own panel already */ }
    }
})
import { normalizeEntityName } from '../tracker/portraits.js'
import type { Quest } from '../tracker/quests.js'
import {
    CHANNEL,
    isRequest,
    type EventMessage,
    type RequestMessage,
    type AgentRunResult, TrackerPassReportDTO,
} from '../protocol.js'

const MEMO = ['[TIME]', '06:15 AM, Day 4', '[/TIME]', '[WAYSTONE]', 'Attunement: ((BARCYAN)) 640/1000', '[/WAYSTONE]'].join('\n')

/** A bridge wired to a fake backend that keeps one memo per chat, in memory. */
function makeBridge(seed: Record<string, string> = {}) {
    const memos = new Map(Object.entries(seed))
    const requests: RequestMessage[] = []
    let deliver: ((payload: unknown) => void) | null = null
    let lastPass: TrackerPassReportDTO | undefined
    let ranMemo = '[XP]\n((XPBAR)) 450/1000\n[/XP]'
    /** World Progression (Phase 33): what `world.get` answers, and what a run returns. */
    let worldStatus: Record<string, unknown> | undefined
    let worldRun: Record<string, unknown> = { status: 'written', at: new Date().toISOString(), trigger: 'manual', periodLabel: 'Day 3, 09:00 AM', selectedLocations: ['Glassmere'] }
    let worldSkeleton: Record<string, unknown> = { status: 'written', at: new Date().toISOString(), mode: 'replace', count: 11, factions: 4, locations: 4, conflicts: 3 }
    let worldSource: Record<string, unknown> = { status: 'written', at: new Date().toISOString(), source: 'A coast written from the chat.' }
    const worldBooksList = [{ name: 'Vell_LOC', own: true }, { name: 'Canon', own: false }, { name: 'Gods', own: false }]
    /** The hidden map (Phase 34): what `map.get` answers. */
    let mapStatus: Record<string, unknown> | undefined = { enabled: true, currentLocation: '', sites: [], activeSiteRoot: '', mentionedSiteRoots: [], canonChars: 0, syncedAt: '', architect: { toolRegistered: true, opener: 'tool', lookback: 12, systemPrompt: '' } }
    let mapUpdate: Record<string, unknown> = { status: 'applied', at: 't', site: 'Abbey Undercroft', trigger: 'manual', summary: 'SET_ASSET pack', operations: 1, entryId: 'Vell_LOC::1' }
    let mapUpdateError: string | undefined
    let mapEvolve: Record<string, unknown> = { status: 'applied', at: 't', trigger: 'manual', currentTime: '09:00 AM, Day 5', sites: [{ siteRoot: 'Abbey Undercroft', status: 'applied', summary: 'pack moved to landing by pack: Drawn by the lantern light.', operations: 1 }] }
    const views: string[] = []
    let creatorPrefs: Record<string, unknown> = {}
    let creatorAnswer: Record<string, unknown> = { status: 'written', at: 't', name: 'Robin Vale', added: ['CHARACTER'], replaced: [] }
    let instantAnswer: Record<string, unknown> = { status: 'ready', at: 't', genre: 'fantasy', className: 'Ranger', level: 4, name: 'Robin Vale', started: true, messageId: 'm1', added: ['CHARACTER'] }
    const begun: unknown[] = []
    const generated: unknown[] = []
    /** The Player Card (35b): what `creator.card.get` answers, and every card op asked. */
    let cardView: Record<string, unknown> = { card: null, persona: null, personasAvailable: true, activePersona: '', activeDescribed: false }
    let cardAnswer: Record<string, unknown> = { status: 'written', at: 't', name: 'Robin Vale', words: 160 }
    let personaAnswer: Record<string, unknown> = { status: 'active', at: 't', name: 'Robin Vale', created: true }
    const cardOps: Array<[string, unknown]> = []
    /** The other ways (35c). */
    let waysAnswer: Record<string, unknown> = { status: 'written', at: 't', way: 'persona', name: 'Robin Vale', source: 'Z', added: ['CHARACTER'], replaced: [] }
    const waysOps: unknown[] = []
    /** Import Card (39). */
    let cardsAnswer: Record<string, unknown> = { cards: [{ id: 'k1', name: 'Kestrel', snippet: 'A hawk-eyed scout.' }, { id: 'o2', name: 'Orrin', snippet: 'A tired smith.' }] }
    let importAnswer: Record<string, unknown> = { status: 'written', at: 't', name: 'Kestrel', source: 'Kestrel', mode: 'full', added: ['CHARACTER'], replaced: [] }
    const importOps: unknown[] = []
    /** The NPC library (41). */
    const libraryOps: unknown[] = []
    const npcOps: unknown[] = []
    const sceneOps: unknown[] = []
    /** The relationships (44). */
    const relationsOps: unknown[] = []
    /** The narrator's configuration (70). */
    const settingsPatches: Array<Record<string, unknown>> = []
    let relationsAnswer: Record<string, unknown> = { at: 't', enabled: true, mode: 'state_tracker', max: 150, updatedAt: 't', npcs: [{ id: 'Vell_NPC::1', label: 'Mother Sedge', friendship: 40, affection: -5, friendshipTier: { label: 'Friendly', hint: 'warm' }, affectionTier: { label: 'Neutral', hint: 'even' }, log: [{ at: 't', field: 'friendship', delta: 40, applied: 40, newValue: 40, source: 'tracker' }] }] }
    const sceneAnswer: Record<string, unknown> = { at: 't', location: { raw: 'Monastery Courtyard', path: 'Monastery :: Courtyard', leaf: 'Courtyard', breadcrumb: 'Monastery › Courtyard', storagePath: 'Monastery :: Courtyard', image: '', entryId: 'Vell_LOC::1', content: 'A yard.' }, present: [{ id: 'Vell_NPC::1', label: 'Mother Sedge', portrait: '', isPlayerCharacter: false, content: 'Keeper.' }], mapSite: '', books: [] }
    let npcAnswer: Record<string, unknown> = { status: 'added', at: 't', name: 'Kestrel', book: 'Vell_NPC', entryId: 'Vell_NPC::3', how: 'literal', portrait: false }
    let libraryRecords: Record<string, unknown>[] = [{ id: 'k1', name: 'Kestrel', keys: ['Kestrel'], content: '[CORE]\nSpecies: Human\n[/CORE]', portraitPath: '', notes: '', createdAt: 1, updatedAt: 2, blurb: 'Human' }]
    let libraryAction: Record<string, unknown> = { status: 'done', at: 't', action: 'party', name: 'Kestrel', added: ['PARTY'], replaced: [], portrait: false }
    let mapView: Record<string, unknown> = { siteRoot: '', kind: '', partyInside: false, rooms: 0, svg: '', entries: '', history: '', revealAll: false, currentLocation: '', sites: [] }
    let worldPatches: Array<Record<string, unknown>> = []
    const sandboxOps: Array<Record<string, unknown>> = []
    const sandboxView = { timeLabel: '09:00 AM, Day 5', minutes: 6300, sites: [{ siteRoot: 'Abbey Undercroft', current: true }, { siteRoot: 'Morrowfen', current: false }], siteRoot: 'Abbey Undercroft', kind: 'DUNGEON', areas: [{ id: 'landing', name: 'Cellar Landing' }], assets: [{ id: 'pack', name: 'Crawling Dead Pack', kind: 'GROUP', state: 'ACTIVE', location: 'crypt', count: 6 }], kinds: ['CREATURE', 'GROUP'], states: ['DESTROYED', 'ACTIVE'], lastEvolved: 'Never', elapsed: 'Unknown', memory: { storedThreads: [], storedBacklog: [], threadText: '', backlogText: '', closedTokens: 0, openTokens: 0, backlogTokens: 0, totalTokens: 0, threshold: 10000, compressEnabled: true, overThreshold: false, openCount: 0, digestCount: 0, entryCount: 0, backlogCount: 0 }, threads: { entries: [], open: [], truncated: false }, arcSubjects: [{ id: 'pack', name: 'Crawling Dead Pack', kind: 'GROUP', state: 'ACTIVE', location: 'crypt', onMap: true, eventCount: 0, open: false }], lastPass: null, intervalHours: 8 }
    /** The terminal's ops (71b), kept apart from the world's so their locks stay exact. */
    const terminalOps: Array<Record<string, unknown>> = []
    let archivedQuests: Quest[] = []
    let messageCards = true
    let partyCompact = false
    let portraits: Record<string, string> = {}
    /** The portraits drawn as they appear (61): what `portraits.auto.status` answers, and the ops asked. */
    let portraitAuto: Record<string, unknown> = { drawing: [], queued: [], last: {} }
    let portraitDrawError: string | undefined
    const portraitOps: unknown[] = []
    let bars: Record<string, Record<string, unknown>> = {}
    let campaignNames: Record<string, string> = {}
    let agentLookback = 0
    let agentRunEvery = 4
    let agentMaxTurns = 5
    let connections: Array<{ id: string; name: string; model: string; isDefault: boolean }> = []
    let trackerConnectionId = ''
    let trackerLookbackMode = 'since-last-user'
    let trackerLookbackCount = 2
    let trackerRunEvery = 1
    let agentConnectionId = ''
    let trackerDirectLookback = 5
    let agentDirectLookback = 10
    let snapshots: Array<{ messageId: string; memo: string; at: string; messageNumber?: number }> = []
    let restoreError: string | undefined
    /** Self-named campaigns (51): what `campaign.name` does, or the error it throws. */
    let campaignNameError: string | undefined
    const campaignNameCalls: unknown[] = []
    /** The campaign's lorebooks (55): what `lore.books` answers, and the attaches asked. */
    // Campaign Records (71a): one NPC book with one entry, unless a test sets more.
    let activatedAnswer: Record<string, unknown> = { entries: [{ id: 'k1', comment: 'Elara', keys: ['Elara', 'innkeeper'], source: 'keyword' }, { id: 'k2', comment: 'The Gilded Hare', source: 'vector', score: 0.82 }, { id: 'k3', comment: 'The world', source: 'keyword', constant: true }], eligibility: { vectorized: 2, total: 3 } }
    let recordsAnswer: Record<string, unknown> = { prefix: 'Vell', books: [{ id: 'b-npc', name: 'Vell_NPC', category: 'NPC', kind: 'npc', entries: [{ id: 'e1', uid: '1', title: 'Elara', keys: ['Elara'], content: '[CORE]\nRole: Innkeeper\n[/CORE]', tokens: 6, pinned: false, disabled: false, hasMap: false, root: true }], tokens: 6 }], mapping: false, mapped: [], allBooks: ['Vell_NPC'] }
    let booksAnswer: Record<string, unknown> = { prefix: 'Vell', card: { id: 'card-1', name: 'Vell Keeper' }, target: 'chat', chatScope: true, books: [
        { kind: 'NPC', name: 'Vell_NPC', id: 'b-npc', state: 'attached', sources: ['character'] },
        { kind: 'LOC', name: 'Vell_LOC', id: 'b-loc', state: 'detached', sources: [] },
        { kind: 'QUEST', name: 'Vell_QUEST', id: null, state: 'missing', sources: [] },
    ] }
    /** Preferences a test seeds into `prefs.get`'s answer, over the fake's own. */
    let seededPrefs: Record<string, unknown> = {}
    const bookOps: unknown[][] = []
    let uploadError: string | undefined
    let agentResult: unknown = null
    let undoResult: unknown = null
    /** The report history (47e). */
    let reports: { tracker: unknown[]; agent: unknown[] } = { tracker: [], agent: [] }
    let heldReports: (() => void) | null = null
    let holdNextReports = false
    /** A read held (56-bis): the next request of the op named is answered only when the test says so, so a chat can go while it loads. */
    const holdNext = new Set<string>()
    const held = new Map<string, () => void>()
    let agentTimesOut = false
    let heldAgent: (() => void) | null = null
    let holdNextAgent = false

    const bridge = new Bridge({
        sendToBackend(payload: unknown): void {
            if (!isRequest(payload)) return
            requests.push(payload)
            const chatId = String(payload.params?.chatId ?? '')

            let data: unknown
            let error: string | undefined
            if (payload.op === 'tracker.get') {
                data = { memo: memos.get(chatId) ?? '', updatedAt: new Date(0).toISOString(), lastPass, archivedQuests }
            } else if (payload.op === 'tracker.setMemo') {
                memos.set(chatId, String(payload.params?.memo ?? ''))
                data = { memo: memos.get(chatId), updatedAt: new Date().toISOString(), lastPass, archivedQuests }
            } else if (payload.op === 'tracker.run' || payload.op === 'tracker.instruct') {
                memos.set(chatId, ranMemo)
                data = { memo: ranMemo, updatedAt: new Date().toISOString(), lastPass, archivedQuests }
            } else if (payload.op === 'portraits.get') {
                data = { portraits }
            } else if (payload.op === 'portraits.auto.status') {
                portraitOps.push(['status', payload.params])
                data = portraitAuto
            } else if (payload.op === 'portraits.auto.check') {
                portraitOps.push(['check', payload.params])
                data = portraitAuto
            } else if (payload.op === 'portraits.prompt') {
                portraitOps.push(['prompt', payload.params])
                data = { name: String((payload.params as { name?: string } | undefined)?.name ?? ''), prompt: 'A lean ranger.' }
            } else if (payload.op === 'portraits.draw') {
                portraitOps.push(['draw', payload.params])
                if (portraitDrawError) error = portraitDrawError
                else data = { name: String((payload.params as { name?: string } | undefined)?.name ?? ''), at: 't', prompt: 'A lean ranger.', provider: 'swarmui', model: 'anima', size: '896×1344' }
            } else if (payload.op === 'portraits.set') {
                // Normalized on the way in, exactly as `PortraitStore.set` does:
                // the panel sends the entity as the memo spells it.
                const name = normalizeEntityName(String(payload.params?.name ?? ''))
                const src = String(payload.params?.src ?? '')
                if (src) portraits[name] = src
                else delete portraits[name]
                data = { portraits }
            } else if (payload.op === 'portraits.upload') {
                if (uploadError) {
                    error = uploadError
                } else {
                    const name = normalizeEntityName(String(payload.params?.name ?? ''))
                    portraits[name] = `/stored/${String(payload.params?.filename ?? 'p.png')}`
                    data = { portraits }
                }
            } else if (payload.op === 'records.list') {
                bookOps.push(['records', payload.params])
                data = recordsAnswer
            } else if (payload.op === 'lore.activated') {
                bookOps.push(['activated', payload.params])
                data = activatedAnswer
            } else if (payload.op === 'lore.books') {
                bookOps.push(['books', payload.params])
                data = booksAnswer
            } else if (payload.op === 'lore.adopt') {
                bookOps.push(['adopt', payload.params])
                data = booksAnswer
            } else if (payload.op === 'lore.attach') {
                bookOps.push(['attach', payload.params])
                const id = payload.params?.bookId
                booksAnswer = { ...booksAnswer, books: (booksAnswer.books as Array<Record<string, unknown>>).map((b) => (b.state === 'detached' && (!id || b.id === id) ? { ...b, state: 'attached', sources: [booksAnswer.target === 'card' ? 'character' : 'chat'] } : b)) }
                data = booksAnswer
            } else if (payload.op === 'agent.undo') {
                data = undoResult
            } else if (payload.op === 'agent.run' || payload.op === 'agent.instruct') {
                if (agentTimesOut) return   // never answers, as a slow pass does not
                if (heldAgent === null && holdNextAgent) {
                    // Answer only when the test says so, so a response can be
                    // made to land *after* the user has moved on.
                    const id = payload.id
                    holdNextAgent = false
                    heldAgent = () => deliver?.({
                        channel: CHANNEL, kind: 'response', id, ok: true, data: agentResult,
                    })
                    return
                }
                data = agentResult
            } else if (payload.op === 'tracker.history') {
                data = { snapshots }
            } else if (payload.op === 'reports.history') {
                if (holdNextReports) {
                    // Answered only when the test says so, with the list as it
                    // stands now, so a read can land after the chat has moved on.
                    const id = payload.id
                    const answer = reports
                    holdNextReports = false
                    heldReports = () => deliver?.({ channel: CHANNEL, kind: 'response', id, ok: true, data: answer })
                    return
                }
                data = reports
            } else if (payload.op === 'tracker.restore') {
                const wanted = String(payload.params?.messageId ?? '')
                const found = snapshots.find((entry) => entry.messageId === wanted)
                if (restoreError) error = restoreError
                else if (!found) error = 'That state is no longer in this chat\u2019s history.'
                else {
                    memos.set(chatId, found.memo)
                    data = { memo: found.memo, updatedAt: new Date().toISOString(), lastPass, archivedQuests }
                }
            } else if (payload.op === 'prefs.get') {
                data = { prefs: { messageCards, partyCompact, bars, campaignNames, agentLookback, agentMaxTurns, agentRunEvery, trackerConnectionId, agentConnectionId, trackerLookbackMode, trackerLookbackCount, trackerRunEvery, trackerDirectLookback, agentDirectLookback, ...creatorPrefs, ...seededPrefs } }
            } else if (payload.op === 'prefs.patch') {
                const patch = (payload.params?.patch ?? {}) as {
                    messageCards?: boolean
                    bars?: Record<string, Record<string, unknown>>
                    campaignNames?: Record<string, string>
                    agentLookback?: number
                    agentMaxTurns?: number
                    trackerConnectionId?: string
                    trackerLookbackMode?: string
                    trackerLookbackCount?: number
                    trackerRunEvery?: number
                    agentConnectionId?: string
                    agentRunEvery?: number
                    trackerDirectLookback?: number
                    agentDirectLookback?: number
                }
                if (typeof patch.messageCards === 'boolean') messageCards = patch.messageCards
                if (typeof (patch as { partyCompact?: unknown }).partyCompact === 'boolean') partyCompact = (patch as { partyCompact: boolean }).partyCompact
                // The backend clamps; mirror it.
                if (typeof patch.trackerDirectLookback === 'number') {
                    trackerDirectLookback = Math.min(Math.max(Math.floor(patch.trackerDirectLookback), 0), 50)
                }
                if (typeof patch.agentDirectLookback === 'number') {
                    agentDirectLookback = Math.min(Math.max(Math.floor(patch.agentDirectLookback), 0), 100)
                }
                // Merged per bar and pruned, exactly as `PrefsStore.patch` does.
                for (const [barId, pref] of Object.entries(patch.bars ?? {})) {
                    if (pref && Object.values(pref).some(Boolean)) bars[barId] = pref
                    else delete bars[barId]
                }
                if (typeof patch.agentLookback === 'number') agentLookback = patch.agentLookback
                if (typeof patch.agentMaxTurns === 'number') {
                    // The backend clamps; mirror it so the panel is tested against
                    // what it will really be handed back.
                    agentMaxTurns = Math.min(Math.max(Math.floor(patch.agentMaxTurns), 1), 20)
                }
                if (typeof patch.trackerConnectionId === 'string') trackerConnectionId = patch.trackerConnectionId
                if (typeof patch.trackerLookbackMode === 'string') {
                    trackerLookbackMode = patch.trackerLookbackMode === 'fixed' ? 'fixed' : 'since-last-user'
                }
                if (typeof patch.trackerRunEvery === 'number') {
                    trackerRunEvery = Math.min(Math.max(Math.floor(patch.trackerRunEvery), 1), 20)
                }
                if (typeof patch.trackerLookbackCount === 'number') {
                    // The backend clamps; mirror it.
                    trackerLookbackCount = Math.min(Math.max(Math.floor(patch.trackerLookbackCount), 1), 50)
                }
                if (typeof patch.agentConnectionId === 'string') agentConnectionId = patch.agentConnectionId
                if (typeof patch.agentRunEvery === 'number') agentRunEvery = patch.agentRunEvery
                for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
                    if (!key.startsWith('worldProgression') && !key.startsWith('worldSkeleton') && !key.startsWith('mapArchitect') && !key.startsWith('mapUpdater') && !key.startsWith('mapEvolution') && key !== 'mapRevealAll' && !key.startsWith('creator') && !key.startsWith('relationship')) continue
                    worldPatches.push({ [key]: value })
                    if (key.startsWith('mapArchitect') && mapStatus) {
                        const architect = { ...(mapStatus.architect as Record<string, unknown>), [key === 'mapArchitectLookback' ? 'lookback' : 'systemPrompt']: value }
                        mapStatus = { ...mapStatus, architect }
                    }
                    const updaterField = { mapUpdaterEnabled: 'enabled', mapUpdaterRunEvery: 'runEvery', mapUpdaterLookback: 'lookback', mapUpdaterSystemPrompt: 'systemPrompt' }[key]
                    if (updaterField && mapStatus) mapStatus = { ...mapStatus, updater: { ...(mapStatus.updater as Record<string, unknown>), [updaterField]: value } }
                    if (key.startsWith('mapEvolution') && mapStatus) {
                        const field = key.slice('mapEvolution'.length).replace(/^[A-Z]/, (c) => c.toLowerCase())
                        mapStatus = { ...mapStatus, evolution: { ...(mapStatus.evolution as Record<string, unknown>), [field]: value } }
                    }
                    const field = { worldProgressionEnabled: 'enabled', worldProgressionIntervalHours: 'intervalHours', worldProgressionLocationsPerReport: 'locationsPerReport', worldProgressionKeepActive: 'keepActive', worldProgressionLookback: 'lookback' }[key]
                    if (worldStatus && field) worldStatus = { ...worldStatus, [field]: value }
                    const skeletonField = { worldSkeletonFactions: 'factions', worldSkeletonLocations: 'locations', worldSkeletonConflicts: 'conflicts', worldSkeletonSystemPrompt: 'systemPrompt', worldSkeletonUseLorebooks: 'useLorebooks', worldSkeletonLorebookOnly: 'lorebookOnly', worldSkeletonLorebookFilter: 'lorebookFilter', worldSkeletonUseExisting: 'useExisting' }[key]
                    if (worldStatus && skeletonField) worldStatus = { ...worldStatus, skeleton: { ...(worldStatus.skeleton as Record<string, unknown>), [skeletonField]: value } }
                }
                if (patch.campaignNames) {
                    campaignNames = Object.fromEntries(
                        Object.entries(patch.campaignNames).filter(([id, name]) => id && name.trim()),
                    )
                }
                data = { prefs: { messageCards, partyCompact, bars, campaignNames, agentLookback, agentMaxTurns, agentRunEvery, trackerConnectionId, agentConnectionId, trackerLookbackMode, trackerLookbackCount, trackerRunEvery, trackerDirectLookback, agentDirectLookback, ...creatorPrefs, ...seededPrefs } }
            } else if (payload.op === 'campaign.name') {
                campaignNameCalls.push(payload.params)
                const id = String(payload.params?.chatId ?? '')
                if (campaignNameError) error = campaignNameError
                else if (campaignNames[id]) data = { name: campaignNames[id], minted: false, prefix: campaignNames[id] }
                // No card known (51-bis): nothing named, the panel asks again on the next chat event.
                else if (!payload.params?.characterId) data = { name: '', minted: false, prefix: id.replace(/-/g, '_'), reason: 'the chat’s card is not known yet' }
                else {
                    const minted = `${String(payload.params?.characterId ?? 'chat').slice(0, 4)}_261011_1432`
                    campaignNames = { ...campaignNames, [id]: minted }
                    data = { name: minted, minted: true, prefix: minted }
                }
            } else if (payload.op === 'connections.list') {
                data = { connections }
            } else if (payload.op === 'tracker.cancel' || payload.op === 'agent.cancel') {
                data = { stopped: true }
            } else if (payload.op === 'tracker.clearArchive') {
                archivedQuests = []
                data = { memo: memos.get(chatId) ?? '', updatedAt: new Date().toISOString(), lastPass, archivedQuests }
            } else if (payload.op === 'world.get') {
                if (!worldStatus) error = 'no world here'
                else data = worldStatus
            } else if (payload.op === 'world.run') {
                worldPatches.push({ op: 'run', ...(payload.params ?? {}) })
                if (worldStatus) worldStatus = { ...worldStatus, lastRun: worldRun, lastFiredPeriodLabel: String(worldRun.periodLabel ?? '') }
                data = worldRun
            } else if (payload.op === 'world.consolidate') {
                worldPatches.push({ op: 'consolidate', ...(payload.params ?? {}) })
                data = { label: 'Day 1 – Day 3', consolidated: Number((payload.params as Record<string, unknown> | undefined)?.count ?? 0) }
            } else if (payload.op === 'world.overrideNext') {
                worldPatches.push({ op: 'override', ...(payload.params ?? {}) })
                if (worldStatus) worldStatus = { ...worldStatus, nextDueLabel: String((payload.params as Record<string, unknown> | undefined)?.next ?? ''), lastFiredPeriodLabel: 'Day 5, 08:00 AM' }
                data = worldStatus
            } else if (payload.op === 'world.reset') {
                worldPatches.push({ op: 'reset' })
                if (worldStatus) worldStatus = { ...worldStatus, lastFiredPeriodLabel: '' }
                data = worldStatus
            } else if (payload.op === 'world.skeleton') {
                worldPatches.push({ op: 'skeleton', ...(payload.params ?? {}) })
                if (worldStatus) {
                    const counts = worldSkeleton.status === 'written' ? { factions: Number(worldSkeleton.factions ?? 0), locations: Number(worldSkeleton.locations ?? 0), conflicts: Number(worldSkeleton.conflicts ?? 0) } : worldStatus.skeletonCounts
                    worldStatus = { ...worldStatus, lastSkeleton: worldSkeleton, skeletonCounts: counts, skeletonSource: String((payload.params as Record<string, unknown> | undefined)?.source ?? '').trim() }
                }
                data = worldSkeleton
            } else if (payload.op === 'world.skeletonSource') {
                worldPatches.push({ op: 'source', ...(payload.params ?? {}) })
                if (worldStatus && worldSource.status === 'written') worldStatus = { ...worldStatus, skeletonSource: worldSource.source }
                data = worldSource
            } else if (payload.op === 'world.books') {
                data = { books: worldBooksList }
            } else if (payload.op === 'map.get') {
                if (mapStatus?.pending) return
                if (!mapStatus) error = 'no maps here'
                else data = mapStatus
            } else if (payload.op === 'map.update') {
                worldPatches.push({ op: 'update', ...(payload.params ?? {}) })
                if (mapUpdateError) error = mapUpdateError
                else { data = mapUpdate; if (mapStatus) mapStatus = { ...mapStatus, lastUpdater: mapUpdate } }
            } else if (payload.op === 'creator.generate') {
                generated.push(payload.params)
                data = creatorAnswer
            } else if (payload.op === 'creator.instant') {
                begun.push(payload.params)
                data = instantAnswer
            } else if (payload.op === 'creator.ways') {
                waysOps.push(payload.params)
                data = waysAnswer
            } else if (payload.op === 'creator.cards') {
                importOps.push(['cards', payload.params])
                data = cardsAnswer
            } else if (payload.op === 'creator.import') {
                importOps.push(['import', payload.params])
                data = importAnswer
            } else if (payload.op === 'library.list') {
                libraryOps.push(['list', payload.params])
                data = { records: libraryRecords }
            } else if (payload.op === 'library.sources') {
                libraryOps.push(['sources', payload.params])
                data = { book: 'Vell_NPC', entries: [], playerCard: null }
            } else if (payload.op === 'scene.get' || payload.op === 'scene.setImage') {
                sceneOps.push([payload.op.slice('scene.'.length), payload.params])
                data = sceneAnswer
            } else if (payload.op === 'scene.prompt') {
                sceneOps.push(['prompt', payload.params])
                data = { path: 'Monastery :: Courtyard', leaf: 'Courtyard', prompt: 'A yard at dawn.' }
            } else if (payload.op === 'scene.draw') {
                sceneOps.push(['draw', payload.params])
                data = { scene: sceneAnswer, path: 'Monastery :: Courtyard', leaf: 'Courtyard', at: 't', prompt: 'A yard at dawn.', provider: 'pollinations', model: 'flux' }
            } else if (payload.op === 'scene.connections') {
                sceneOps.push(['connections', payload.params])
                data = { connections: [{ id: 'img-1', name: 'Fast', provider: 'pollinations', model: 'flux', isDefault: true }] }
            } else if (payload.op === 'relations.get' || payload.op === 'relations.set' || payload.op === 'relations.remove') {
                relationsOps.push([payload.op.slice('relations.'.length), payload.params])
                data = relationsAnswer
            } else if (payload.op === 'npc.draft' || payload.op === 'npc.add' || payload.op === 'npc.commit') {
                npcOps.push([payload.op.slice('npc.'.length), payload.params])
                data = npcAnswer
            } else if (payload.op === 'library.party' || payload.op === 'library.playAsPc') {
                libraryOps.push([payload.op.slice('library.'.length), payload.params])
                data = libraryAction
            } else if (payload.op === 'library.photo.prompt') {
                libraryOps.push(['photo.prompt', payload.params])
                data = { name: 'Orrin', prompt: 'A dour smith.' }
            } else if (payload.op === 'library.photo.set' || payload.op === 'library.photo.draw' || payload.op === 'library.photo.remove') {
                libraryOps.push([payload.op.slice('library.'.length), payload.params])
                data = { record: libraryRecords[0], placed: !!(payload.params as { chatId?: string } | undefined)?.chatId }
            } else if (payload.op === 'creator.card.get') {
                cardOps.push(['get', payload.params])
                data = cardView
            } else if (payload.op === 'creator.card.write' || payload.op === 'creator.card.save') {
                cardOps.push([payload.op.slice('creator.card.'.length), payload.params])
                data = cardAnswer
            } else if (payload.op === 'creator.card.remove') {
                cardOps.push(['remove', payload.params])
                cardView = { ...cardView, card: null }
                data = { ok: true }
            } else if (payload.op === 'creator.card.persona') {
                cardOps.push(['persona', payload.params])
                data = personaAnswer
            } else if (payload.op === 'map.view') {
                views.push(String((payload.params as Record<string, unknown> | undefined)?.siteRoot ?? ''))
                if (mapView.fail) error = String(mapView.fail)
                else data = { ...mapView, ...(typeof (payload.params as Record<string, unknown> | undefined)?.siteRoot === 'string' && mapView.named ? (mapView.named as Record<string, Record<string, unknown>>)[String((payload.params as Record<string, unknown>).siteRoot)] ?? { siteRoot: '', svg: '', entries: '', history: '', problem: `${String((payload.params as Record<string, unknown>).siteRoot)} is not a mapped site.` } : {}) }
            } else if (payload.op === 'map.evolve') {
                worldPatches.push({ op: 'evolve', ...(payload.params ?? {}) })
                data = mapEvolve
                if (mapStatus) mapStatus = { ...mapStatus, lastEvolution: mapEvolve }
            } else if (payload.op === 'map.evolution.reset') {
                // Reset timeline (78a): recorded, nothing else.
                worldPatches.push({ op: 'evolution-reset', ...(payload.params ?? {}) })
                data = { reset: true }
            } else if (payload.op === 'map.evolution.interval') {
                // A site's own hours (71d): echoed back as the fold would read them.
                worldPatches.push({ op: 'interval', ...(payload.params ?? {}) })
                const p = payload.params as { siteRoot: string; hours: number | null }
                data = { siteRoot: p.siteRoot, current: false, automaticHours: 12, overrideHours: p.hours }
            } else if (payload.op.startsWith('map.sandbox.')) {
                // The Testing Ground (71d): the view, or an outcome in the legacy's shape.
                sandboxOps.push({ op: payload.op.slice('map.sandbox.'.length), ...(payload.params ?? {}) })
                data = payload.op === 'map.sandbox.get' ? sandboxView : { ok: true, timeLabel: 'Day 6, 09:00 AM', applied: 1, ticks: 2, hoursPerTick: 8 }
            } else if (payload.op === 'terminal.get' || payload.op === 'terminal.clear') {
                // The terminal (71b): nothing kept, as a fresh backend has.
                terminalOps.push({ op: payload.op, ...(payload.params ?? {}) })
                data = { steps: { state_tracker: [], lorebook_agent: [], map_updater: [], map_evolution: [], map_architect: [] } }
            } else if (payload.op === 'map.direct') {
                terminalOps.push({ op: 'direct', ...(payload.params ?? {}) })
                data = { status: 'written', at: 't', site: 'The Hollow', kind: 'DUNGEON', areas: 3, assets: 2, entryId: 'Vell_LOC::9' }
            } else if (payload.op === 'world.purge') {
                worldPatches.push({ op: 'purge', ...(payload.params ?? {}) })
                if (worldStatus) worldStatus = { ...worldStatus, skeletonCounts: { factions: 0, locations: 0, conflicts: 0 }, activeReports: [], lastFiredPeriodLabel: '', lastRun: undefined, lastSkeleton: undefined }
                data = { worldBookName: 'Vell_World', skeletonBookName: 'Vell_Skeleton', worldCleared: 2, skeletonCleared: 3 }
            } else if (payload.op === 'narrator.create') {
                // The narrator card's row in the Setup Guide (83): 72b's op.
                data = { id: 'c9', name: String((payload.params as { name?: string } | undefined)?.name ?? 'Game Master'), created: true }
            } else if (payload.op === 'settings.patch') {
                // The narrator's configuration (70) writes the cartridge from the starting area.
                const patch = (payload.params?.patch ?? {}) as Record<string, unknown>
                settingsPatches.push(patch)
                data = { settings: { narrativePacing: 'normal', ...patch } }
            } else {
                error = `no canned answer for ${payload.op}`
            }

            if (holdNext.delete(payload.op)) {
                const id = payload.id
                const answer = data
                held.set(payload.op, () => deliver?.({ channel: CHANNEL, kind: 'response', id, ok: !error, data: answer, error }))
                return
            }
            queueMicrotask(() => {
                deliver?.({ channel: CHANNEL, kind: 'response', id: payload.id, ok: !error, data, error })
            })
        },
        onBackendMessage(handler: (payload: unknown) => void): () => void {
            deliver = handler
            return () => {}
        },
    })

    /** Push an unsolicited backend event, as the tracker pass does. */
    const emit = (event: Omit<EventMessage, 'channel' | 'kind'>): void => {
        deliver?.({ channel: CHANNEL, kind: 'event', ...event })
    }

    return {
        bridge,
        requests,
        memos,
        emit,
        setLastPass: (p: TrackerPassReportDTO | undefined) => { lastPass = p },
        setArchive: (quests: Quest[]) => { archivedQuests = quests },
        setMessageCards: (on: boolean) => { messageCards = on },
        setPortraits: (map: Record<string, string>) => { portraits = map },
        setPortraitAuto: (status: Record<string, unknown>) => { portraitAuto = status },
        failPortraitDraw: (message: string | undefined) => { portraitDrawError = message },
        portraitOps: () => portraitOps,
        failUpload: (message: string | undefined) => { uploadError = message },
        setAgentResult: (result: unknown) => { agentResult = result },
        setReports: (next: { tracker: unknown[]; agent: unknown[] }) => { reports = next },
        holdReports: () => { holdNextReports = true },
        hold: (op: string) => { holdNext.add(op) },
        release: (op: string) => { held.get(op)?.(); held.delete(op) },
        releaseReports: () => { heldReports?.(); heldReports = null },
        setUndoResult: (result: unknown) => { undoResult = result },
        campaignNames: () => campaignNames,
        setCampaignNames: (names: Record<string, string>) => { campaignNames = names },
        stallAgent: () => { agentTimesOut = true },
        holdAgent: () => { holdNextAgent = true },
        setRunEvery: (n: number) => { agentRunEvery = n },
        setMaxTurns: (n: number) => { agentMaxTurns = n },
        setConnections: (list: Array<{ id: string; name: string; model: string; isDefault: boolean }>) => { connections = list },
        setTrackerConnection: (id: string) => { trackerConnectionId = id },
        maxTurns: () => agentMaxTurns,
        settingsPatches: () => settingsPatches,
        setSnapshots: (list: Array<{ messageId: string; memo: string; at: string; messageNumber?: number }>) =>
            { snapshots = list },
        setRestoreError: (message: string | undefined) => { restoreError = message },
        setCampaignNameError: (message: string | undefined) => { campaignNameError = message },
        setBooks: (answer: Record<string, unknown>) => { booksAnswer = answer },
        setRecords: (answer: Record<string, unknown>) => { recordsAnswer = answer },
        setActivated: (answer: Record<string, unknown>) => { activatedAnswer = answer },
        setPrefs: (prefs: Record<string, unknown>) => { seededPrefs = prefs },
        bookOps,
        campaignNameCalls,
        releaseAgent: () => { heldAgent?.(); heldAgent = null },
        portraits: () => portraits,
        bars: () => bars,
        messageCards: () => messageCards,
        archive: () => archivedQuests,
        setRanMemo: (m: string) => { ranMemo = m },
        setWorldStatus: (s: Record<string, unknown> | undefined) => { worldStatus = s },
        setWorldRun: (r: Record<string, unknown>) => { worldRun = r },
        setWorldSkeleton: (r: Record<string, unknown>) => { worldSkeleton = r },
        setWorldSource: (r: Record<string, unknown>) => { worldSource = r },
        setMapStatus: (s: Record<string, unknown> | undefined) => { mapStatus = s },
        sandboxOps,
        setMapUpdate: (r: Record<string, unknown>) => { mapUpdate = r },
        setMapEvolve: (r: Record<string, unknown>) => { mapEvolve = r },
        setMapView: (r: Record<string, unknown>) => { mapView = r },
        setCreatorPrefs: (r: Record<string, unknown>) => { creatorPrefs = r },
        setCreatorAnswer: (r: Record<string, unknown>) => { creatorAnswer = r },
        setInstantAnswer: (r: Record<string, unknown>) => { instantAnswer = r },
        setCardView: (r: Record<string, unknown>) => { cardView = r },
        setCardAnswer: (r: Record<string, unknown>) => { cardAnswer = r },
        setPersonaAnswer: (r: Record<string, unknown>) => { personaAnswer = r },
        cardOps: () => cardOps,
        setWaysAnswer: (r: Record<string, unknown>) => { waysAnswer = r },
        waysOps: () => waysOps,
        setCardsAnswer: (r: Record<string, unknown>) => { cardsAnswer = r },
        setImportAnswer: (r: Record<string, unknown>) => { importAnswer = r },
        importOps: () => importOps,
        setLibraryRecords: (r: Record<string, unknown>[]) => { libraryRecords = r },
        setLibraryAction: (r: Record<string, unknown>) => { libraryAction = r },
        libraryOps: () => libraryOps,
        npcOps: () => npcOps,
        sceneOps: () => sceneOps,
        relationsOps: () => relationsOps,
        setRelationsAnswer: (r: Record<string, unknown>) => { relationsAnswer = r },
        setNpcAnswer: (r: Record<string, unknown>) => { npcAnswer = r },
        begun: () => begun,
        generated: () => generated,
        views: () => views,
        failMapUpdate: (message: string | undefined) => { mapUpdateError = message },
        worldPatches: () => worldPatches,
        terminalOps: () => terminalOps,
    }
}

function makeHost(chatId: string | null = 'chat-1'): TrackerPanelHost {
    return {
        dom: {
            createElement: ((tag: string, attrs?: Record<string, string>) => {
                const node = document.createElement(tag)
                for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, value)
                return node
            }) as TrackerPanelHost['dom']['createElement'],
        },
        getActiveChat: () => ({ chatId, characterId: null }),
    }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** The NPC/PC Manager (78b): the library and the creator open from the Campaign Records' NPCs folder, in the host's modal. */
async function openManager(root: HTMLElement): Promise<void> {
    const pane = root.querySelector('.lh-campaign-records') as HTMLDetailsElement
    pane.open = true
    pane.dispatchEvent(new Event('toggle'))
    await settle()
    await settle()
    ;(root.querySelector('[data-lh-field="records-manager"]') as HTMLElement).click()
    await settle()
}

/**
 * Freeze `Date` at local noon, leaving the timers real.
 *
 * Anything asserting on a formatted timestamp needs this: the panel prints a
 * date alongside the time once the stamp is no longer today, so a test built
 * around "three minutes ago" changes its answer when it is run three minutes
 * after midnight. Only `Date` is faked — `settle()` still needs a real
 * `setTimeout`.
 */
function pinTheClockToNoon(): void {
    vi.useFakeTimers({ toFake: ['Date'] })
    const noon = new Date()
    noon.setHours(12, 0, 0, 0)
    vi.setSystemTime(noon)
}

function button(root: HTMLElement, text: string): HTMLButtonElement {
    return Array.from(root.querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement
}

let root: HTMLElement

beforeEach(() => {
    document.body.replaceChildren()
    root = document.createElement('div')
    document.body.append(root)
})

describe('mounting', () => {
    it('asks the backend for the active chat memo and draws its cards', async () => {
        const { bridge, requests } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(requests[0]).toMatchObject({ op: 'tracker.get', params: { chatId: 'chat-1' } })
        expect(root.querySelectorAll('.rt-section')).toHaveLength(2)
        expect(root.querySelector('.rt-section-title')?.textContent).toBe('TIME')
    })

    it('puts the memo’s phase on the body and the sky badge in the head, and takes both off with the clock (74c)', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        // 06:15 AM is dawn: the sun, no stars.
        expect(document.body.classList.contains('lh-phase-dawn')).toBe(true)
        const head = root.querySelector('.lh-tracker-head')!
        expect(head.firstElementChild!.classList.contains('lh-head-starfield')).toBe(true)
        const slot = head.querySelector('.lh-sky-slot')!
        expect(slot.previousElementSibling!.classList.contains('lh-lights')).toBe(true)
        expect(slot.innerHTML).toBe('<span class="lh-sky-badge lh-sky-dawn" title="In-world time of day: dawn"><span class="lh-sky-disc"></span></span>')

        emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: '[TIME]\nDay 5, 11:30 PM\n[/TIME]' } })
        await settle()
        expect(Array.from(document.body.classList).filter((c) => c.startsWith('lh-phase-'))).toEqual(['lh-phase-night'])
        expect(slot.querySelector('.lh-sky-badge.lh-sky-night .lh-sky-stars')).not.toBeNull()

        emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: '[XP]\n1/2\n[/XP]' } })
        await settle()
        expect(Array.from(document.body.classList).filter((c) => c.startsWith('lh-phase-'))).toEqual([])
        expect(slot.innerHTML).toBe('')
    })

    it('draws the bar the memo asked for', async () => {
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        const bar = root.querySelector('.rt-hp-bar') as HTMLElement
        expect(bar).toBeTruthy()
        expect(bar.getAttribute('style')).toContain('width:64.0%')
    })

    it('says so when the chat has no tracker state yet', async () => {
        const { bridge } = makeBridge()
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(root.querySelector('.lh-tracker-status')?.textContent).toMatch(/No tracker state/)
        expect(root.querySelector('.rt-empty')).toBeTruthy()
    })

    it('asks for nothing at all when no chat is open', async () => {
        const { bridge, requests } = makeBridge()
        mountTrackerPanel(root, bridge, makeHost(null))
        await settle()

        // The preference read is not chat-scoped, so it happens regardless.
        expect(requests.filter((r) => r.op.startsWith('tracker.'))).toHaveLength(0)
        expect(root.querySelector('.lh-tracker-status')?.textContent).toBe('No chat open.')
    })

    it('shows the failure instead of an empty panel when the read fails', async () => {
        const { bridge } = makeBridge()
        vi.spyOn(bridge, 'request').mockRejectedValueOnce(new Error('backend unreachable'))
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        // The failure lives on the problem line now, which no pass can clear.
        expect(root.querySelector('.lh-problem-text')?.textContent).toBe('backend unreachable')
        expect((root.querySelector('.lh-problem') as HTMLElement).hidden).toBe(false)
    })
})

describe('settings', () => {
    it('orders the cards by the cartridge block order', async () => {
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost(), { blockOrder: ['WAYSTONE', 'TIME'] })
        await settle()

        const titles = Array.from(root.querySelectorAll('.rt-section-title')).map((n) => n.textContent)
        expect(titles).toEqual(['WAYSTONE', 'TIME'])
    })

    it('redraws when settings change, without re-reading the memo', async () => {
        const { bridge, requests } = makeBridge({ 'chat-1': MEMO })
        const panel = mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const before = requests.length

        panel.setSettings({ customFields: [{ tag: 'WAYSTONE', label: 'Runestone', icon: '💠' }] })

        expect(Array.from(root.querySelectorAll('.rt-section-title')).map((n) => n.textContent)).toContain('Runestone')
        expect(requests).toHaveLength(before)
    })
})

describe('the raw memo editor', () => {
    it('shows the memo as written', async () => {
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect((root.querySelector('.lh-tracker-raw textarea') as HTMLTextAreaElement).value).toBe(MEMO)
        // The raw memo is the starting area's drawer since 84: ✦, the title over its small line, the chevron, the body wrapped.
        const raw = root.querySelector('.lh-tracker-raw') as HTMLDetailsElement
        expect(raw.classList.contains('lh-start-drawer')).toBe(true)
        expect(raw.querySelector('summary .lh-start-drawer-title')!.textContent).toBe('Raw tracker memo')
        expect(raw.querySelector('summary .lh-start-drawer-sub')!.textContent).toContain('The live memo as text')
        expect(raw.querySelector('summary .lh-start-drawer-chevron')!.textContent).toBe('▸')
        expect(raw.querySelector('textarea')!.parentElement!.classList.contains('lh-start-drawer-body')).toBe(true)
        expect(raw.open).toBe(false)
    })

    it('saves an edit and redraws from it', async () => {
        const { bridge, memos } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        const textarea = root.querySelector('.lh-tracker-raw textarea') as HTMLTextAreaElement
        textarea.value = '[XP]\n((XPBAR)) 450/1000\n[/XP]'
        button(root, 'Save memo').click()
        await settle()

        expect(memos.get('chat-1')).toBe('[XP]\n((XPBAR)) 450/1000\n[/XP]')
        expect(Array.from(root.querySelectorAll('.rt-section-title')).map((n) => n.textContent)).toEqual(['XP'])
    })

    it('reverts an unsaved edit back to the stored memo', async () => {
        const { bridge, memos } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        const textarea = root.querySelector('.lh-tracker-raw textarea') as HTMLTextAreaElement
        textarea.value = 'scribbled over'
        button(root, 'Revert').click()

        expect(textarea.value).toBe(MEMO)
        expect(memos.get('chat-1')).toBe(MEMO)
    })

    it('refuses to save with no chat open', async () => {
        const { bridge, requests } = makeBridge()
        mountTrackerPanel(root, bridge, makeHost(null))
        await settle()

        button(root, 'Save memo').click()
        await settle()

        // The preference read is not chat-scoped, so it happens regardless.
        expect(requests.filter((r) => r.op.startsWith('tracker.'))).toHaveLength(0)
        expect(root.querySelector('.lh-tracker-status')?.textContent).toBe('No chat open.')
    })
})

describe('the starting area (69)', () => {
    const group = () => root.querySelector('.lh-start') as HTMLDetailsElement

    it('heads the four ways in, in Multihog\'s order, open for a chat with no memo', async () => {
        const { bridge } = makeBridge({ 'chat-1': '' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        expect(group().querySelector('summary')!.textContent).toBe('Starting the Adventure')
        // Multihog's onboarding since 83: the hero, the box, the drawer of the other ways, the narrator's drawer, then the three texts and the connection.
        expect(Array.from(group().querySelector('.lh-start-body')!.children).map((n) => n.className.split(' ')[0])).toEqual(['lh-creator', 'lh-instant', 'lh-start-drawer', 'lh-narrator', 'lh-start-divider', 'lh-start-note', 'lh-start-how', 'lh-start-divider', 'lh-start-tip', 'lh-start-divider', 'lh-start-guide', 'lh-start-conn'])
        expect(Array.from(group().querySelector('[data-lh-field="start-other"] > .lh-start-drawer-body')!.children).map((n) => n.className.split(' ')[0])).toEqual(['lh-ways', 'lh-import'])
        expect(group().open).toBe(true)
    })

    it('is Multihog’s onboarding since 83: the hero, the box, the drawers, the three texts, and the narrator card’s row through the bridge', async () => {
        const { bridge, requests, emit } = makeBridge({ 'chat-1': '' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const q = (field: string) => group().querySelector(`[data-lh-field="${field}"]`) as HTMLElement
        expect(group().querySelector('.lh-creator > summary .lh-start-hero-btn')!.textContent).toBe('🎲 Character Creator▸')
        expect(group().querySelector('.lh-creator > summary .lh-start-hero-sub')!.textContent).toContain('Build your character step by step')
        expect(group().querySelector('.lh-instant > summary')!.textContent).toBe('⚡ Instant Action▸')
        expect(group().querySelectorAll('.lh-instant .lh-instant-genres button')).toHaveLength(4)
        expect(q('start-other').querySelector('.lh-start-drawer-title')!.textContent).toBe('Other Ways to Begin')
        expect(q('start-other').querySelector('.lh-start-drawer-sub')!.textContent).toBe('Fine-tune your start, create a Player Card, or import a character')
        expect((q('start-other') as HTMLDetailsElement).open).toBe(false)
        expect(group().querySelector('.lh-ways > summary')!.textContent).toBe('From the persona or the instructions')
        expect(group().querySelector('.lh-narrator > summary .lh-start-drawer-title')!.textContent).toBe('Narrator configuration')
        expect(Array.from(group().querySelectorAll('.lh-start-divider > span')).map((n) => n.textContent)).toEqual(['How It Works', 'Need Help', 'Setup Guide'])
        expect(q('start-note').textContent).toContain('sends its rulebook with every reply')
        expect(Array.from(q('start-how').querySelectorAll('b')).map((n) => n.textContent)).toEqual(['Auto-Tracking:', 'Prompt Injection:', 'Lorebook Agent 🤖:', 'World Progression 🌍:', 'Map Evolution 🗺️:'])
        expect((q('start-help').querySelector('a') as HTMLAnchorElement).href).toBe('https://www.youtube.com/watch?v=82Lt9pRYFS0')
        expect((q('start-companion') as HTMLButtonElement).disabled).toBe(true)
        expect(q('start-guide').querySelectorAll('ol > li')).toHaveLength(4)
        expect(q('start-guide').textContent).toContain('Combat API Override')
        expect(q('start-connection').textContent).toContain('Character Creation Connection')
        // The narrator card's row: the name saved as a preference, the card made through 72b's op.
        const name = q('start-narrator-name') as HTMLInputElement
        expect(name.value).toBe('Game Master')
        name.value = 'Aurelius'
        name.dispatchEvent(new Event('change'))
        await settle()
        expect(requests.filter((r) => r.op === 'prefs.patch').map((r) => r.params)).toContainEqual({ patch: { narratorCardName: 'Aurelius' } })
        ;(q('start-narrator-create') as HTMLButtonElement).click()
        await settle()
        expect(requests.find((r) => r.op === 'narrator.create')?.params).toEqual({ name: 'Aurelius' })
        expect(q('start-narrator-note').textContent).toContain('Made the card “Aurelius”')
        // The name follows the event every save sends, as the Core & Branching row's does (one preference, two rows).
        emit({ name: 'prefs.changed', data: { prefs: { narratorCardName: 'Chronicler' } } })
        await settle()
        expect(name.value).toBe('Chronicler')
    })

    it('is folded for a chat with an adventure under way, and the hand\'s toggle stands while the chat does', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        expect(group().open).toBe(false)
        group().open = true
        emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: MEMO } })
        await settle()
        expect(group().open).toBe(true)
    })

    it('carries the time & date segment in the other ways (72b): the two cartridge keys written, and a cartridge load re-seeding them', async () => {
        const { bridge, settingsPatches } = makeBridge({ 'chat-1': '' })
        const panel = mountTrackerPanel(root, bridge, makeHost(), { useDdMmYyFormat: true, use24hTime: false } as never)
        await settle()
        const q = (name: string) => root.querySelector(`[data-lh-field="${name}"]`) as HTMLSelectElement
        // Seeded from the settings the panel was mounted with.
        expect(q('ways-calendar-input').value).toBe('date')
        expect(q('ways-clock-input').value).toBe('12')
        q('ways-calendar-input').value = 'day'
        q('ways-calendar-input').dispatchEvent(new Event('change'))
        await settle()
        expect(settingsPatches()).toEqual([{ useDdMmYyFormat: false }])
        // A cartridge load (43) re-seeds the segment through setSettings.
        panel.setSettings({ useDdMmYyFormat: true, use24hTime: true } as never)
        expect(q('ways-calendar-input').value).toBe('date')
        expect(q('ways-clock-input').value).toBe('24')
    })

    it('ends with the narrator’s configuration (70): Multihog’s block, writing the cartridge and the opener preference', async () => {
        const { bridge, settingsPatches, requests } = makeBridge({ 'chat-1': '' })
        const panel = mountTrackerPanel(root, bridge, makeHost(), { narrativePacing: 'downtime', syspromptModules: { loot: false } } as never)
        await settle()
        const fold = group().querySelector('.lh-narrator') as HTMLDetailsElement
        // The narrator's drawer follows the drawer of the other ways (83); the texts come after it.
        expect(fold.previousElementSibling!.classList.contains('lh-start-drawer')).toBe(true)
        expect(fold.querySelector('summary')!.textContent).toContain('Narrator configuration')
        expect(fold.querySelector('summary')!.textContent).toContain('Set pacing, RNG, quests, and optional systems')
        expect(fold.open).toBe(false)
        const input = (field: string) => fold.querySelector(`[data-lh-field="${field}"] input`) as HTMLInputElement
        expect(input('nc-pacing-downtime').checked).toBe(true)
        expect(input('nc-loot').checked).toBe(false)
        // A pick writes the cartridge, and the answer re-seeds the block.
        input('nc-pacing-normal').checked = true
        input('nc-pacing-normal').dispatchEvent(new Event('change'))
        await settle()
        expect(settingsPatches()).toEqual([{ narrativePacing: 'normal' }])
        // The opener is a preference (46), and a preference saved elsewhere reaches the block.
        input('nc-opener-text').checked = true
        input('nc-opener-text').dispatchEvent(new Event('change'))
        await settle()
        expect(requests.filter((r) => r.op === 'prefs.patch').map((r) => r.params?.patch)).toContainEqual({ mapArchitectOpener: 'text' })
        // The settings the panel is given later reach it too (the settings tab's commits, 70).
        panel.setSettings({ narrativePacing: 'high_agency' } as never)
        expect(input('nc-pacing-high_agency').checked).toBe(true)
    })

    it('decides again when the chat changes', async () => {
        const { bridge } = makeBridge({ 'chat-1': MEMO, 'chat-2': '' })
        let chatId = 'chat-1'
        const host: TrackerPanelHost = { ...makeHost(), getActiveChat: () => ({ chatId, characterId: null }) }
        const panel = mountTrackerPanel(root, bridge, host)
        await settle()
        expect(group().open).toBe(false)
        chatId = 'chat-2'
        await panel.refresh()
        expect(group().open).toBe(true)
        chatId = 'chat-1'
        await panel.refresh()
        expect(group().open).toBe(false)
    })
})

describe('following the user between chats', () => {
    it('re-reads on refresh and draws the new chat state', async () => {
        const { bridge } = makeBridge({ 'chat-1': MEMO, 'chat-2': '[XP]\n1/2\n[/XP]' })
        let chatId = 'chat-1'
        const host: TrackerPanelHost = { ...makeHost(), getActiveChat: () => ({ chatId, characterId: null }) }

        const panel = mountTrackerPanel(root, bridge, host)
        await settle()
        expect(root.querySelectorAll('.rt-section')).toHaveLength(2)

        chatId = 'chat-2'
        await panel.refresh()
        expect(Array.from(root.querySelectorAll('.rt-section-title')).map((n) => n.textContent)).toEqual(['XP'])
    })

    it('does not paint a late reply after it has been destroyed', async () => {
        // A chat switch and a teardown can race; the reply must not land in a
        // panel that is already gone.
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        const panel = mountTrackerPanel(root, bridge, makeHost())
        panel.destroy()
        await settle()

        expect(root.querySelector('.rt-section')).toBeNull()
    })
})

describe('escaping', () => {
    it('does not execute markup a model wrote into the memo', async () => {
        const { bridge } = makeBridge({ 'chat-1': '[TIME]\n<img src=x onerror="window.pwned=1">\n[/TIME]' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(root.querySelector('img')).toBeNull()
        expect(root.querySelector('.rt-section-body')?.textContent).toContain('<img')
    })
})

describe('following the tracker pass', () => {
    it('redraws when the pass updates this chat memo', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: '[XP]\n((XPBAR)) 450/1000\n[/XP]' } })

        expect(Array.from(root.querySelectorAll('.rt-section-title')).map((n) => n.textContent)).toEqual(['XP'])
    })

    it('redraws without a round trip — the event carries the memo', async () => {
        const { bridge, emit, requests } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const before = requests.length

        emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: '[XP]\n1/2\n[/XP]' } })
        await settle()

        expect(requests).toHaveLength(before)
    })

    it('ignores an update for a different chat', async () => {
        // A background pass can finish for a chat the user has left; painting
        // it here would show them another campaign's state.
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        emit({ name: 'tracker.changed', data: { chatId: 'chat-2', memo: '[XP]\n1/2\n[/XP]' } })

        expect(Array.from(root.querySelectorAll('.rt-section-title')).map((n) => n.textContent)).toEqual([
            'TIME',
            'WAYSTONE',
        ])
    })

    it('ignores an unrelated backend event', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        emit({ name: 'settings.changed', data: { chatId: 'chat-1', memo: 'nope' } })

        expect(root.querySelectorAll('.rt-section')).toHaveLength(2)
    })

    it('does not clobber an edit in progress', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        const textarea = root.querySelector('.lh-tracker-raw textarea') as HTMLTextAreaElement
        textarea.value = 'half-typed correction'
        emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: '[XP]\n1/2\n[/XP]' } })

        expect(textarea.value).toBe('half-typed correction')
        expect(root.querySelector('.lh-tracker-status')?.textContent).toMatch(/unsaved edit/)
    })

    it('stops listening once destroyed', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        const panel = mountTrackerPanel(root, bridge, makeHost())
        await settle()
        panel.destroy()

        expect(() => emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: '[XP]\n1/2\n[/XP]' } })).not.toThrow()
        expect(root.querySelector('.rt-section')).toBeNull()
    })
})

const REPORT = (over: Partial<TrackerPassReportDTO> = {}): TrackerPassReportDTO => ({
    status: 'updated',
    at: new Date().toISOString(),
    replaced: ['TIME'],
    ...over,
})

describe('saying what the tracker pass did', () => {
    const text = () => root.querySelector('.lh-tracker-report')?.textContent ?? ''

    it('says so when the tracker has never run for this chat', async () => {
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        expect(text()).toMatch(/has not run for this chat yet/)
    })

    it('names the blocks a successful pass moved', async () => {
        const { bridge, setLastPass } = makeBridge({ 'chat-1': MEMO })
        setLastPass(REPORT({ replaced: ['TIME'], added: ['XP'], removed: ['SECRETS'] }))
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(text()).toContain('updated TIME')
        expect(text()).toContain('added XP')
        expect(text()).toContain('removed SECRETS')
    })

    // The first live bench read "updated TIME, PARTY", which is also what
    // losing a member reads as. The people who moved are named.
    it('names who was benched and who came back', async () => {
        const { bridge, setLastPass } = makeBridge({ 'chat-1': MEMO })
        setLastPass(REPORT({ replaced: ['PARTY'], benched: ['Oswin (Guard 1)'], unbenched: ['Benedek (Noble 2)'] }))
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(text()).toContain('updated PARTY; benched Oswin (Guard 1); unbenched Benedek (Noble 2)')
    })

    it('names a bench command that moved nobody', async () => {
        // A command for a name nobody has: said, not skipped. Skipped, it reads
        // as a bench that worked and scrolled off the card.
        const { bridge, setLastPass } = makeBridge({ 'chat-1': MEMO })
        setLastPass(REPORT({ replaced: ['TIME'], unmatched: ['Oswin'] }))
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(text()).toContain('updated TIME; could not bench or unbench Oswin: nobody on the roster has that name')
    })

    it('names the relationship awards a pass placed, and the names it could not place (44)', async () => {
        // An award for a name no entry has is dropped; dropped silently it
        // reads as a narrator that never awarded anything.
        const { bridge, setLastPass } = makeBridge({ 'chat-1': MEMO })
        setLastPass(REPORT({ replaced: ['TIME'], relations: ['Marcus Vane friendship +5 (now +45)'], relationsUnmatched: ['The Stranger'] }))
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(text()).toContain('updated TIME; relations: Marcus Vane friendship +5 (now +45); could not place a relationship change for The Stranger: no NPC entry has that name')
    })

    it('distinguishes a pass that ran and found nothing from one that never ran', async () => {
        // The whole point: state that stops moving looks identical either way.
        const { bridge, setLastPass } = makeBridge({ 'chat-1': MEMO })
        setLastPass(REPORT({ status: 'no-change', reason: 'the reply carried no [TAG] blocks', replaced: [] }))
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(text()).toContain('changed nothing')
        expect(text()).toContain('no [TAG] blocks')
    })

    it('shows why a pass failed', async () => {
        const { bridge, setLastPass } = makeBridge({ 'chat-1': MEMO })
        setLastPass(REPORT({ status: 'failed', reason: 'the tracker model call failed: no connection' }))
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(text()).toContain('failed')
        expect(text()).toContain('no connection')
    })

    it('offers the model own words when the reply could not be used', async () => {
        const { bridge, setLastPass } = makeBridge({ 'chat-1': MEMO })
        setLastPass(REPORT({ status: 'no-change', sample: 'I cannot help with that request.' }))
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(root.querySelector('.lh-tracker-sample pre')?.textContent).toBe('I cannot help with that request.')
    })

    it('updates the report when a pass finishes while the panel is open', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        emit({
            name: 'tracker.changed',
            data: { chatId: 'chat-1', memo: MEMO, report: REPORT({ status: 'no-change', replaced: [] }) },
        })

        expect(text()).toContain('changed nothing')
    })
})

// Multihog's 💬, roadmap row 5: a send bar per pass.
describe('talking to the tracker directly', () => {
    const bar = () => root.querySelector('[data-lh-field="tracker-direct"]') as HTMLElement
    const box = () => bar().querySelector('textarea') as HTMLTextAreaElement
    const lookback = () => bar().querySelector('input') as HTMLInputElement
    const key = (init: KeyboardEventInit) => box().dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))

    it('sends what was typed as an instruction, clears the box, and draws the result', async () => {
        const { bridge, requests } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        box().value = 'Bench Oswin.'
        button(bar(), '▶').click()
        await settle()

        const sent = requests.find((r) => r.op === 'tracker.instruct')
        expect(sent?.params).toMatchObject({ chatId: 'chat-1', instruction: 'Bench Oswin.' })
        expect(requests.some((r) => r.op === 'tracker.run')).toBe(false)
        expect(box().value).toBe('')
        // The result lands where a pressed pass's does.
        expect(Array.from(root.querySelectorAll('.rt-section-title')).map((n) => n.textContent)).toEqual(['XP'])
    })

    // The wizard's seed pass (Phase 32a) comes through here so the dot, the
    // busy line and the report are the tracker section's.
    it('runs an instructed pass from elsewhere in the panel, exactly as the bar does', async () => {
        const { bridge, requests } = makeBridge({ 'chat-1': MEMO })
        const panel = mountTrackerPanel(root, bridge, makeHost())
        await settle()

        const done = panel.instruct('Create the [RADS] block now.')
        expect(root.querySelector('.lh-tracker-report-running')).not.toBeNull()
        await done

        const sent = requests.find((r) => r.op === 'tracker.instruct')
        expect(sent?.params).toMatchObject({ chatId: 'chat-1', instruction: 'Create the [RADS] block now.' })
        expect(Array.from(root.querySelectorAll('.rt-section-title')).map((n) => n.textContent)).toEqual(['XP'])
    })

    it('sends on Enter, keeps Shift+Enter for a new line, and sends nothing for a blank box', async () => {
        const { bridge, requests } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        key({ key: 'Enter' })
        await settle()
        expect(requests.some((r) => r.op === 'tracker.instruct')).toBe(false)

        box().value = 'Bench Oswin.'
        key({ key: 'Enter', shiftKey: true })
        await settle()
        expect(requests.some((r) => r.op === 'tracker.instruct')).toBe(false)
        expect(box().value).toBe('Bench Oswin.')

        key({ key: 'Enter' })
        await settle()
        expect(requests.filter((r) => r.op === 'tracker.instruct')).toHaveLength(1)
    })

    it('holds the bar and the button while the pass runs, and says whose pass it is', async () => {
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        box().value = 'Bench Oswin.'
        button(bar(), '▶').click()
        expect(button(bar(), '▶').disabled).toBe(true)
        expect(box().disabled).toBe(true)
        expect(button(root, 'Run tracker now').disabled).toBe(true)
        expect(root.querySelector('.lh-tracker-status')?.textContent).toMatch(/with your instruction/)
        await settle()
        expect(button(bar(), '▶').disabled).toBe(false)
        expect(box().disabled).toBe(false)
        expect(button(root, 'Run tracker now').disabled).toBe(false)
    })

    it('reports an instructed pass as one, running and finished', async () => {
        const { bridge, emit, setLastPass } = makeBridge({ 'chat-1': MEMO })
        setLastPass(REPORT({ replaced: ['PARTY'], trigger: 'direct' }))
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const report = () => root.querySelector('.lh-tracker-report')?.textContent ?? ''
        expect(report()).toMatch(/Tracker ran .* on your instruction and updated PARTY\./)

        emit({ name: 'tracker.started', data: { chatId: 'chat-1', at: new Date().toISOString(), trigger: 'direct' } })
        await settle()
        expect(report()).toMatch(/A pass is running now on your instruction/)
    })

    it('remembers how many messages the bar reads, as the backend settled it', async () => {
        const { bridge, requests } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        expect(lookback().value).toBe('5')

        lookback().value = '99'
        lookback().dispatchEvent(new Event('change'))
        await settle()
        const patch = requests.filter((r) => r.op === 'prefs.patch').at(-1)
        expect(patch?.params).toMatchObject({ patch: { trackerDirectLookback: 99 } })
        expect(lookback().value).toBe('50')
    })
})

describe('talking to the agent directly', () => {
    const bar = () => root.querySelector('[data-lh-field="agent-direct"]') as HTMLElement
    const box = () => bar().querySelector('textarea') as HTMLTextAreaElement

    it('sends what was typed to the agent and draws its report', async () => {
        const { bridge, requests, setAgentResult } = makeBridge({ 'chat-1': MEMO })
        setAgentResult({ at: new Date().toISOString(), outcome: 'committed', summary: 'The innkeeper is recorded.', steps: [], turnsUsed: 1, problems: [], write: { changed: ['Vell_NPC::1'], deleted: [], createdBooks: [], refused: [] } })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        box().value = 'Add an entry for the innkeeper.'
        button(bar(), 'Send').click()
        await settle()

        const sent = requests.find((r) => r.op === 'agent.instruct')
        expect(sent?.params).toMatchObject({ chatId: 'chat-1', instruction: 'Add an entry for the innkeeper.' })
        expect(requests.some((r) => r.op === 'agent.run')).toBe(false)
        expect(box().value).toBe('')
        expect(root.querySelector('.lh-agent-note')?.textContent).toContain('The innkeeper is recorded.')
    })

    it('keeps its own window, ten by default', async () => {
        const { bridge, requests } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const lookback = bar().querySelector('input') as HTMLInputElement
        expect(lookback.value).toBe('10')
        lookback.value = '0'
        lookback.dispatchEvent(new Event('change'))
        await settle()
        expect(requests.filter((r) => r.op === 'prefs.patch').at(-1)?.params).toMatchObject({ patch: { agentDirectLookback: 0 } })
        expect(lookback.value).toBe('0')
    })
})

describe('running the tracker on demand', () => {
    it('asks the backend to run a pass and redraws from the result', async () => {
        const { bridge, requests } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        button(root, 'Run tracker now').click()
        await settle()

        expect(requests.some((r) => r.op === 'tracker.run')).toBe(true)
        expect(Array.from(root.querySelectorAll('.rt-section-title')).map((n) => n.textContent)).toEqual(['XP'])
    })

    it('disables the button while a pass is in flight', async () => {
        // A tracker call is a full model round trip; a second press would queue
        // another behind it.
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        const run = button(root, 'Run tracker now')
        run.click()
        expect(run.disabled).toBe(true)
        await settle()
        expect(run.disabled).toBe(false)
    })

    it('re-enables the button and reports the error when the run fails', async () => {
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        vi.spyOn(bridge, 'request').mockRejectedValueOnce(new Error('no connection configured'))

        const run = button(root, 'Run tracker now')
        run.click()
        await settle()

        expect(run.disabled).toBe(false)
        expect(root.querySelector('.lh-problem-text')?.textContent).toBe('no connection configured')
    })

    it('refuses to run with no chat open', async () => {
        const { bridge, requests } = makeBridge()
        mountTrackerPanel(root, bridge, makeHost(null))
        await settle()

        button(root, 'Run tracker now').click()
        await settle()

        // The preference read is not chat-scoped, so it happens regardless.
        expect(requests.filter((r) => r.op.startsWith('tracker.'))).toHaveLength(0)
        expect(root.querySelector('.lh-tracker-status')?.textContent).toBe('No chat open.')
    })

    it('marks the report as the previous pass while a new one is in flight', async () => {
        // A stale failure sitting under a running pass reads as the result of
        // the run just started. That misread cost a live debugging session.
        const { bridge, setLastPass } = makeBridge({ 'chat-1': MEMO })
        setLastPass(REPORT({ status: 'failed', reason: 'PERMISSION_DENIED: chat_mutation' }))
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        const report = root.querySelector('.lh-tracker-report') as HTMLElement
        expect(report.querySelector('.lh-tracker-report-running')).toBeNull()

        button(root, 'Run tracker now').click()

        expect(report.querySelector('.lh-tracker-report-running')?.textContent).toMatch(/running now/)
        expect(report.textContent).toMatch(/Below is the previous one/)
        expect(report.classList.contains('lh-tracker-report--stale')).toBe(true)
    })

    it('says a pass that outlasts the deadline is still running, not failed', async () => {
        // The tracker pass is a generation. It can take longer than the panel
        // is willing to hold a button for, and the backend keeps going — so a
        // timeout here is a slow pass, not a broken one. Calling it an error is
        // what made a working tracker look dead.
        const { bridge, setLastPass } = makeBridge({ 'chat-1': MEMO })
        setLastPass(REPORT({ status: 'failed', reason: 'an error from hours ago' }))
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        vi.spyOn(bridge, 'request').mockRejectedValueOnce(new RequestTimeoutError('tracker.run', 180_000))

        const run = button(root, 'Run tracker now')
        run.click()
        await settle()

        const status = root.querySelector('.lh-tracker-status') as HTMLElement
        expect(status.textContent).toMatch(/still running/i)
        expect(status.classList.contains('lh-tracker-status-error')).toBe(false)
        expect(run.disabled).toBe(false)
        // And the old report stays flagged as the previous pass, because the
        // one being waited on has not reported yet.
        expect(root.querySelector('.lh-tracker-report-running')).toBeTruthy()
    })

    it('fills in from the event when a timed-out pass finally lands', async () => {
        // The subscription is the safety net: the pass reports itself whether
        // or not this side was still waiting on the reply.
        const { bridge, emit, setLastPass } = makeBridge({ 'chat-1': MEMO })
        setLastPass(REPORT({ status: 'failed', reason: 'an error from hours ago' }))
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        vi.spyOn(bridge, 'request').mockRejectedValueOnce(new RequestTimeoutError('tracker.run', 180_000))

        button(root, 'Run tracker now').click()
        await settle()

        emit({
            name: 'tracker.changed',
            data: {
                chatId: 'chat-1',
                memo: '[XP]\n((XPBAR)) 450/1000\n[/XP]',
                report: REPORT({ replaced: ['XP'] }),
            },
        })

        const report = root.querySelector('.lh-tracker-report') as HTMLElement
        expect(report.querySelector('.lh-tracker-report-running')).toBeNull()
        expect(report.classList.contains('lh-tracker-report--stale')).toBe(false)
        expect(report.textContent).toContain('updated XP')
        expect(Array.from(root.querySelectorAll('.rt-section-title')).map((n) => n.textContent)).toEqual(['XP'])
    })

    it('clears the in-flight marking when a real failure comes back', async () => {
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        vi.spyOn(bridge, 'request').mockRejectedValueOnce(new Error('no connection configured'))

        button(root, 'Run tracker now').click()
        await settle()

        expect(root.querySelector('.lh-tracker-report-running')).toBeNull()
        expect(root.querySelector('.lh-problem-text')?.textContent).toBe('no connection configured')
    })
})

describe('saying that a pass is running now', () => {
    // Local noon, whatever the timezone. Without it these read the real clock,
    // and a pass "4 minutes ago" run just after midnight is on yesterday's date
    // — so the suite would fail for anyone testing at the wrong time of night.
    beforeEach(() => { pinTheClockToNoon() })
    afterEach(() => { vi.useRealTimers() })

    const note = () => root.querySelector('.lh-tracker-report-running')?.textContent ?? ''
    const status = () => root.querySelector('.lh-tracker-status') as HTMLElement

    /** The backend's start event, as the tracker pass sends it. */
    const started = (over: Record<string, unknown> = {}) => ({
        name: 'tracker.started' as const,
        data: { chatId: 'chat-1', at: new Date().toISOString(), trigger: 'reply', ...over },
    })

    it('announces the automatic pass after a reply', async () => {
        // The one nobody could see. Until this event there was nothing on
        // screen between the reply landing and the memo changing minutes later,
        // so a working tracker and a dead one looked the same.
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        emit(started())

        expect(note()).toMatch(/running now/)
        expect(note()).toMatch(/after the last reply/)
        expect(status().textContent).toMatch(/updating after the last reply/i)
        expect(status().classList.contains('lh-tracker-status-busy')).toBe(true)
        expect(status().classList.contains('lh-tracker-status-error')).toBe(false)
    })

    it('marks the report behind it as the previous pass', async () => {
        const { bridge, emit, setLastPass } = makeBridge({ 'chat-1': MEMO })
        setLastPass(REPORT({ status: 'failed', reason: 'an error from hours ago' }))
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        emit(started())

        const report = root.querySelector('.lh-tracker-report') as HTMLElement
        expect(report.classList.contains('lh-tracker-report--stale')).toBe(true)
        expect(report.textContent).toContain('Below is the previous one')
        expect(report.textContent).toContain('an error from hours ago')
    })

    it('dates the pass in flight as well as the one in the box', async () => {
        // A running indicator that never ages cannot be told from one that
        // started a second ago — the same misreading the report line already
        // learned from.
        const at = new Date(Date.now() - 4 * 60_000).toISOString()
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        emit(started({ at }))

        const clock = new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        expect(note()).toContain(`started ${clock}`)
    })

    it('words a pass the user asked for differently', async () => {
        // The panel already knows about the button it disabled; what it does
        // not need is to be told the reply caused this one.
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        emit(started({ trigger: 'manual' }))

        expect(note()).toMatch(/running now/)
        expect(note()).not.toMatch(/after the last reply/)
    })

    it('ignores a pass running for another chat', async () => {
        // A background pass can be running for a campaign the user has
        // navigated away from. Announcing it here would be a lie about this one.
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        emit(started({ chatId: 'chat-2' }))

        expect(root.querySelector('.lh-tracker-report-running')).toBeNull()
        expect(status().classList.contains('lh-tracker-status-busy')).toBe(false)
    })

    it('clears when the pass reports back', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        emit(started())
        emit({
            name: 'tracker.changed',
            data: { chatId: 'chat-1', memo: MEMO, report: REPORT({ replaced: ['TIME'] }) },
        })

        expect(root.querySelector('.lh-tracker-report-running')).toBeNull()
        expect(status().classList.contains('lh-tracker-status-busy')).toBe(false)
    })

    it('survives a refresh while the pass is still going', async () => {
        // Pressing Refresh mid-pass must not report the memo as settled.
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        const panel = mountTrackerPanel(root, bridge, makeHost())
        await settle()

        emit(started())
        await panel.refresh()

        expect(note()).toMatch(/running now/)
        expect(status().classList.contains('lh-tracker-status-busy')).toBe(true)
    })

    it('drops it when the user switches chats', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO, 'chat-2': MEMO })
        let chatId = 'chat-1'
        const host: TrackerPanelHost = { ...makeHost(), getActiveChat: () => ({ chatId, characterId: null }) }
        const panel = mountTrackerPanel(root, bridge, host)
        await settle()

        emit(started())
        chatId = 'chat-2'
        await panel.refresh()

        expect(root.querySelector('.lh-tracker-report-running')).toBeNull()
    })
})

describe('a load the chat leaves behind (56-bis)', () => {
    // The load awaits the memo, the history and the portraits in turn; the chat can go during any of them.
    for (const op of ['tracker.get', 'tracker.history', 'portraits.get']) {
        it(`asks nothing more for a chat that went while ${op} loaded, and paints none of it`, async () => {
            const made = makeBridge({ 'chat-1': MEMO })
            let chatId: string | null = 'chat-1'
            const host: TrackerPanelHost = { ...makeHost(), getActiveChat: () => ({ chatId, characterId: null }) }
            const panel = mountTrackerPanel(root, made.bridge, host)
            await settle()
            expect(root.querySelectorAll('.rt-section')).toHaveLength(2)

            // The reload's burst: a chat event with no chat lands while the read is still out.
            made.hold(op)
            const loading = panel.refresh()
            await settle()
            chatId = null
            await panel.refresh()
            expect(root.querySelector('.lh-tracker-status')?.textContent).toBe('No chat open.')
            const before = made.requests.length

            made.release(op)
            await loading
            await settle()

            // Nothing asked for with no chat — the backend refuses `portraits.get requires a chatId` in red — and the cards stay empty.
            expect(made.requests.slice(before)).toEqual([])
            expect(made.requests.some((r) => r.params?.chatId === null)).toBe(false)
            expect(root.querySelectorAll('.rt-section')).toHaveLength(0)
            expect(root.querySelector('.lh-tracker-status')?.textContent).toBe('No chat open.')
        })
    }

    it('keeps the chat it moved to when the left-behind load lands, even on the next redraw', async () => {
        const made = makeBridge({ 'chat-1': MEMO, 'chat-2': '[XP]\n((XPBAR)) 450/1000\n[/XP]' })
        let chatId: string | null = 'chat-1'
        const host: TrackerPanelHost = { ...makeHost(), getActiveChat: () => ({ chatId, characterId: null }) }
        const panel = mountTrackerPanel(root, made.bridge, host)
        await settle()

        made.hold('tracker.get')
        const loading = panel.refresh()
        await settle()
        chatId = 'chat-2'
        await panel.refresh()
        expect(root.querySelectorAll('.rt-section')).toHaveLength(1)

        made.release('tracker.get')
        await loading
        await settle()
        expect(root.querySelectorAll('.rt-section')).toHaveLength(1)

        // A fold toggled redraws from the memo the panel holds: it must be chat-2's, not the one that landed late.
        root.querySelector<HTMLElement>('.rt-section-header')!.click()
        expect(root.querySelectorAll('.rt-section')).toHaveLength(1)
        expect(root.querySelector('.rt-section-title')?.textContent).toBe('XP')
    })
})

describe('when the pass ran, in local time', () => {
    beforeEach(() => { pinTheClockToNoon() })
    afterEach(() => { vi.useRealTimers() })

    const text = () => root.querySelector('.lh-tracker-report')?.textContent ?? ''

    it('stamps the report with the wall-clock time it ran', async () => {
        // "3 minutes ago" answers whether it is current; the clock time answers
        // which pass it was, which is the question you ask with the chat log
        // open beside the panel.
        const at = new Date(Date.now() - 3 * 60_000).toISOString()
        const { bridge, setLastPass } = makeBridge({ 'chat-1': MEMO })
        setLastPass(REPORT({ at, replaced: ['COMBAT'] }))
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        const clock = new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        expect(text()).toContain(`3 minutes ago (${clock})`)
        expect(text()).toContain('updated COMBAT')
    })

    it('stamps a failure and a skip too', async () => {
        const at = new Date(Date.now() - 90 * 60_000).toISOString()
        const { bridge, setLastPass } = makeBridge({ 'chat-1': MEMO })
        setLastPass(REPORT({ status: 'failed', at, reason: 'no connection' }))
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        const clock = new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        expect(text()).toContain(`Tracker failed 2 hours ago (${clock})`)
    })

    it('carries the date once the stamp is no longer today', async () => {
        // `10:15 AM` on its own reads as this morning.
        const at = new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString()
        const { bridge, setLastPass } = makeBridge({ 'chat-1': MEMO })
        setLastPass(REPORT({ at }))
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        const date = new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
        expect(text()).toContain(date)
    })

    it('hangs the full local timestamp off the line', async () => {
        const at = new Date(Date.now() - 60_000).toISOString()
        const { bridge, setLastPass } = makeBridge({ 'chat-1': MEMO })
        setLastPass(REPORT({ at }))
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        const line = root.querySelector('.lh-tracker-report > div') as HTMLElement
        expect(line.title).toBe(new Date(at).toLocaleString())
    })

    it('says nothing about a clock it cannot read', async () => {
        const { bridge, setLastPass } = makeBridge({ 'chat-1': MEMO })
        setLastPass(REPORT({ at: 'not a date' }))
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(text()).toContain('at an unknown time')
        expect(text()).not.toContain('(')
    })
})

describe('the quest archive in the panel', () => {
    const QUEST_MEMO = [
        '[TIME]',
        '08:00 AM, Day 2',
        '[/TIME]',
        '[QUESTS]',
        'QUEST: The Missing Sheep',
        '  ID: sheep',
        '  STATUS: active',
        '  GIVER: Farmer Hemwick @ Crestwood Mill',
        '[/QUESTS]',
    ].join('\n')

    const finished = (over: Partial<Quest> = {}): Quest => ({
        id: 'cellar',
        title: 'The Rat Cellar',
        status: 'completed',
        giver_name: 'Innkeeper',
        giver_location: 'The Bell',
        accepted_time: null,
        deadline_time: null,
        objectives: [],
        rewards: [],
        ...over,
    })

    /** The Completed / Failed sections the renderer draws under the active quests. */
    const archiveSections = () =>
        Array.from(root.querySelectorAll('.rt-quest-archive')).map((n) => n.getAttribute('data-tag'))

    it('draws the finished quests that came with the memo', async () => {
        const { bridge, setArchive } = makeBridge({ 'chat-1': QUEST_MEMO })
        setArchive([finished()])
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(archiveSections()).toContain('QUESTS_COMPLETED')
        expect(root.textContent).toContain('The Rat Cellar')
    })

    it('draws them when a pass reports one, without a second round trip', async () => {
        // The archive is not in the memo, so an event carrying only the memo
        // would leave the log a turn behind.
        const { bridge, emit } = makeBridge({ 'chat-1': QUEST_MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        expect(archiveSections()).toEqual([])

        emit({
            name: 'tracker.changed',
            data: { chatId: 'chat-1', memo: QUEST_MEMO, archivedQuests: [finished()] },
        })

        expect(archiveSections()).toContain('QUESTS_COMPLETED')
    })

    it('keeps what it has when an event carries no archive', async () => {
        // An older backend, or a build without the archive store. Blanking the
        // sections because a field was absent would look like data loss.
        const { bridge, setArchive, emit } = makeBridge({ 'chat-1': QUEST_MEMO })
        setArchive([finished()])
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: QUEST_MEMO } })
        expect(archiveSections()).toContain('QUESTS_COMPLETED')
    })

    it('drops the archive when the user switches to a chat that has none', async () => {
        const { bridge, setArchive } = makeBridge({ 'chat-1': QUEST_MEMO, 'chat-2': QUEST_MEMO })
        setArchive([finished()])
        let chatId = 'chat-1'
        const host: TrackerPanelHost = { ...makeHost(), getActiveChat: () => ({ chatId, characterId: null }) }
        const panel = mountTrackerPanel(root, bridge, host)
        await settle()

        setArchive([])
        chatId = 'chat-2'
        await panel.refresh()
        expect(archiveSections()).toEqual([])
    })
})

describe('clearing the quest archive', () => {
    const finished = (title: string): Quest => ({
        id: title,
        title,
        status: 'completed',
        giver_name: 'Innkeeper',
        giver_location: 'The Bell',
        accepted_time: null,
        deadline_time: null,
        objectives: [],
        rewards: [],
    })

    const clearButton = () =>
        Array.from(root.querySelectorAll('button')).find((b) =>
            /clear/i.test(b.textContent ?? ''),
        ) as HTMLButtonElement

    it('offers no button when there is nothing to clear', async () => {
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(clearButton().hidden).toBe(true)
    })

    it('counts what it would clear', async () => {
        const { bridge, setArchive } = makeBridge({ 'chat-1': MEMO })
        setArchive([finished('One'), finished('Two')])
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(clearButton().hidden).toBe(false)
        expect(clearButton().textContent).toBe('Clear finished quests (2)')
    })

    it('asks again before doing something irreversible', async () => {
        // The quests are already out of the memo, so there is nothing to
        // restore them from. One stray click must not be enough.
        const { bridge, requests, setArchive } = makeBridge({ 'chat-1': MEMO })
        setArchive([finished('One')])
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        clearButton().click()
        await settle()

        expect(requests.some((r) => r.op === 'tracker.clearArchive')).toBe(false)
        expect(clearButton().textContent).toMatch(/Really clear 1 finished quest\?/)
        expect(root.querySelector('.lh-tracker-status')?.textContent).toMatch(/cannot be undone/i)
    })

    it('clears on the second press and redraws without it', async () => {
        const { bridge, setArchive } = makeBridge({ 'chat-1': MEMO })
        setArchive([finished('One')])
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        clearButton().click()
        await settle()
        clearButton().click()
        await settle()

        expect(root.querySelectorAll('.rt-quest-archive')).toHaveLength(0)
        expect(clearButton().hidden).toBe(true)
        expect(root.querySelector('.lh-tracker-status')?.textContent).toMatch(/cleared/i)
    })

    it('disarms when the user does something else first', async () => {
        // An armed button left sitting there is a trap: the user comes back,
        // presses what they think is a first click, and loses the log.
        const { bridge, setArchive } = makeBridge({ 'chat-1': MEMO })
        setArchive([finished('One')])
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        clearButton().click()
        await settle()
        button(root, 'Revert').click()

        expect(clearButton().textContent).toBe('Clear finished quests (1)')
    })

    it('disarms on a refresh', async () => {
        const { bridge, setArchive } = makeBridge({ 'chat-1': MEMO })
        setArchive([finished('One')])
        const panel = mountTrackerPanel(root, bridge, makeHost())
        await settle()

        clearButton().click()
        await settle()
        await panel.refresh()

        expect(clearButton().textContent).toBe('Clear finished quests (1)')
    })
})

describe('folding cards away', () => {
    const QUEST_MEMO = [
        '[TIME]',
        '08:00 AM, Day 2',
        '[/TIME]',
        '[QUESTS]',
        'QUEST: The Missing Sheep',
        '  ID: quest_1',
        '  STATUS: active',
        '  GIVER: Farmer Hemwick @ Crestwood Mill',
        '  OBJ_ACTIVE: Find the sheep',
        'QUEST: The Rat Cellar',
        '  ID: quest_2',
        '  STATUS: completed',
        '[/QUESTS]',
    ].join('\n')

    const header = (tag: string) => root.querySelector(`[data-tag="${tag}"] > .rt-section-header`) as HTMLElement
    const body = (tag: string) => root.querySelector(`[data-tag="${tag}"] > .rt-section-body`) as HTMLElement

    it('folds a card when its header is clicked, and opens it again', async () => {
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(body('TIME').hidden).toBe(false)
        header('TIME').click()
        expect(body('TIME').hidden).toBe(true)
        expect(header('TIME').getAttribute('aria-expanded')).toBe('false')

        header('TIME').click()
        expect(body('TIME').hidden).toBe(false)
    })

    it('answers the keyboard, since the headers claim to be buttons', async () => {
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        header('TIME').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        expect(body('TIME').hidden).toBe(true)
    })

    it('keeps a fold across a redraw, since a redraw is not a click', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        header('TIME').click()
        emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: MEMO } })
        await settle()

        expect(body('TIME').hidden).toBe(true)
    })

    it('starts the quest archive folded — it is history, not a workload', async () => {
        const { bridge } = makeBridge({ 'chat-1': QUEST_MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(body('QUESTS').hidden).toBe(false)
        expect(body('QUESTS_COMPLETED').hidden).toBe(true)
    })

    it('opens the archive on a click without folding the quest log around it', async () => {
        const { bridge } = makeBridge({ 'chat-1': QUEST_MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        header('QUESTS_COMPLETED').click()

        expect(body('QUESTS_COMPLETED').hidden).toBe(false)
        // The archive header sits inside the QUESTS body, so a click that
        // bubbled past it would fold the whole log away.
        expect(body('QUESTS').hidden).toBe(false)
    })

    it('ignores a click on a card body', async () => {
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        body('TIME').click()
        expect(body('TIME').hidden).toBe(false)
    })
})

describe('the portrait editor', () => {
    const COMBAT_MEMO = [
        '[COMBAT]',
        'COMBAT ROUND 1',
        'ENEMIES:',
        'Moth Wraith (a construct) ((BAR)) 10/10',
        'ALLIES:',
        'Dream Sprite ((BAR)) 9/9',
        '[/COMBAT]',
    ].join('\n')

    const rows = () => Array.from(root.querySelectorAll('.lh-portrait-row'))
    const rowFor = (name: string) =>
        rows().find((row) => row.querySelector('.lh-portrait-name')?.textContent === name)
    const buttonIn = (row: Element, text: string) =>
        Array.from(row.querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement

    /** A host whose file picker returns one tiny PNG. */
    function hostWithPicker(): TrackerPanelHost {
        return {
            ...makeHost(),
            uploads: {
                pickFile: async () => [
                    { name: 'rat.png', mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) },
                ],
            },
        }
    }

    it('offers a row per entity the memo names', async () => {
        // Driven from the memo rather than a list the user keeps: the cast
        // changes every turn, and typing "Moth Wraith" exactly is asking to lose.
        const { bridge } = makeBridge({ 'chat-1': COMBAT_MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(rows().map((r) => r.querySelector('.lh-portrait-name')?.textContent))
            .toEqual(['Moth Wraith (a construct)', 'Dream Sprite'])
    })

    it('stays when the memo names nobody (61), counting none, with the drawing’s settings inside', async () => {
        // Hidden until 61: the switches that draw a portrait as it appears live here now, and an NPC
        // of the book may be drawn with nobody in play.
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        const fold = root.querySelector('.lh-portraits') as HTMLElement
        expect(fold.hidden).toBe(false)
        expect(fold.querySelector('summary')!.textContent).toBe('Portraits in play (0)')
        expect(rows()).toHaveLength(0)
        expect(fold.querySelector('.lh-portrait-settings')).not.toBeNull()
    })

    it('names the reference when it is one this build will not draw', async () => {
        // The bug this exists for: a portrait a user set, stored, and never saw.
        // The row used to draw the same empty square it draws for an entity
        // nobody has set a picture for, so there was nothing on screen — and
        // nothing in a log — to tell the two apart.
        const { bridge, setPortraits } = makeBridge({ 'chat-1': COMBAT_MEMO })
        setPortraits({ 'Moth Wraith': 'spindle-asset://abc123' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        const row = rowFor('Moth Wraith (a construct)')!
        expect(row.querySelector('img')).toBeNull()
        expect(row.classList.contains('lh-portrait-row--problem')).toBe(true)
        // The stored reference itself, verbatim: it is the answer, and nothing
        // else in the panel shows it.
        expect(row.querySelector('.lh-portrait-note')?.textContent).toContain('spindle-asset://abc123')
    })

    it('says so when the picture is one the host would not serve', async () => {
        // An address we are willing to draw is not an address that loads. A
        // broken image with no explanation reads exactly like a portrait that
        // was never set.
        const { bridge, setPortraits } = makeBridge({ 'chat-1': COMBAT_MEMO })
        setPortraits({ 'Moth Wraith': '/api/v1/images/abc' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        const row = rowFor('Moth Wraith (a construct)')!
        expect(row.classList.contains('lh-portrait-row--problem')).toBe(false)

        row.querySelector('img')!.dispatchEvent(new Event('error'))
        expect(row.classList.contains('lh-portrait-row--problem')).toBe(true)
        expect(row.querySelector('.lh-portrait-note')?.textContent).toContain('/api/v1/images/abc')
        // The browser's broken-image glyph is the least informative thing that
        // could sit beside a row explaining itself, so it goes.
        expect(row.querySelector('img')).toBeNull()
        expect(row.querySelector('.lh-portrait-thumb--empty')).not.toBeNull()
    })

    it('leaves the failure on the row when the host will not store the picture', async () => {
        // The live bug: the host's own explanation landed in the status line
        // beside the Tracker heading, which the next tracker event overwrites.
        // The one message that named the cause had to be screenshotted before
        // it vanished. It belongs on the row it is about.
        const { bridge, failUpload, emit } = makeBridge({ 'chat-1': COMBAT_MEMO })
        failUpload('userId is required for operator-scoped extensions')
        mountTrackerPanel(root, bridge, hostWithPicker())
        await settle()

        buttonIn(rowFor('Moth Wraith (a construct)')!, 'Set image').click()
        await settle()

        const note = () => rowFor('Moth Wraith (a construct)')!.querySelector('.lh-portrait-note')?.textContent
        expect(note()).toContain('userId is required for operator-scoped extensions')

        // And it is still there after the panel redraws for something else.
        emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: COMBAT_MEMO } })
        await settle()
        expect(note()).toContain('userId is required for operator-scoped extensions')
    })

    it('clears the failure once the picture stores', async () => {
        const { bridge, failUpload } = makeBridge({ 'chat-1': COMBAT_MEMO })
        failUpload('userId is required for operator-scoped extensions')
        mountTrackerPanel(root, bridge, hostWithPicker())
        await settle()

        const row = () => rowFor('Moth Wraith (a construct)')!
        buttonIn(row(), 'Set image').click()
        await settle()
        expect(row().classList.contains('lh-portrait-row--problem')).toBe(true)

        failUpload(undefined)
        buttonIn(row(), 'Set image').click()
        await settle()

        expect(row().classList.contains('lh-portrait-row--problem')).toBe(false)
        expect(row().querySelector('img')).not.toBeNull()
    })

    it('still offers Remove for a reference it refuses to draw', async () => {
        // The one a user most needs to be able to clear is the one that is not
        // working, and Remove used to appear only beside a picture that drew.
        const { bridge, setPortraits, portraits } = makeBridge({ 'chat-1': COMBAT_MEMO })
        setPortraits({ 'Moth Wraith': 'spindle-asset://abc123' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        const row = rowFor('Moth Wraith (a construct)')!
        expect(buttonIn(row, 'Change')).toBeDefined()
        buttonIn(row, 'Remove').click()
        await settle()

        expect(portraits()).toEqual({})
    })

    it('draws a host path that arrived without its leading slash', async () => {
        const { bridge, setPortraits } = makeBridge({ 'chat-1': COMBAT_MEMO })
        setPortraits({ 'Moth Wraith': 'api/v1/images/abc' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(root.querySelector('.rt-entity-portrait')?.getAttribute('src')).toBe('/api/v1/images/abc')
    })

    it('shows the picture already set, matched past the parenthetical', async () => {
        const { bridge, setPortraits } = makeBridge({ 'chat-1': COMBAT_MEMO })
        setPortraits({ 'Moth Wraith': '/rat.png' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        const thumb = rowFor('Moth Wraith (a construct)')!.querySelector('img') as HTMLImageElement
        expect(thumb.getAttribute('src')).toBe('/rat.png')
        expect(root.querySelector('.rt-entity-portrait')?.getAttribute('src')).toBe('/rat.png')
    })

    it('stores a picked file and draws it on the card', async () => {
        const { bridge, portraits } = makeBridge({ 'chat-1': COMBAT_MEMO })
        mountTrackerPanel(root, bridge, hostWithPicker())
        await settle()

        buttonIn(rowFor('Moth Wraith (a construct)')!, 'Set image').click()
        await settle()

        // Stored under the name the lookup will ask for, not the one the
        // narrator happened to write this turn.
        expect(portraits()).toEqual({ 'Moth Wraith': '/stored/rat.png' })
        expect(root.querySelector('.rt-entity-portrait')).not.toBeNull()
    })

    it('removes one', async () => {
        const { bridge, setPortraits, portraits } = makeBridge({ 'chat-1': COMBAT_MEMO })
        setPortraits({ 'Moth Wraith': '/rat.png' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        buttonIn(rowFor('Moth Wraith (a construct)')!, 'Remove').click()
        await settle()

        expect(portraits()).toEqual({})
        expect(root.querySelector('.rt-entity-portrait')).toBeNull()
    })

    it('offers no Remove for an entity with no picture', async () => {
        const { bridge } = makeBridge({ 'chat-1': COMBAT_MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(buttonIn(rowFor('Dream Sprite')!, 'Remove')).toBeUndefined()
    })

    it('disables the picker on a host that has none', async () => {
        // Pasting a URL still works, so the row says so by being disabled rather
        // than failing when pressed.
        const { bridge } = makeBridge({ 'chat-1': COMBAT_MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(buttonIn(rowFor('Dream Sprite')!, 'Set image').disabled).toBe(true)
    })

    it('does nothing when the picker is dismissed', async () => {
        const { bridge, portraits } = makeBridge({ 'chat-1': COMBAT_MEMO })
        const host: TrackerPanelHost = { ...makeHost(), uploads: { pickFile: async () => [] } }
        mountTrackerPanel(root, bridge, host)
        await settle()

        buttonIn(rowFor('Dream Sprite')!, 'Set image').click()
        await settle()

        expect(portraits()).toEqual({})
    })

    it('follows the cast as the story moves', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': COMBAT_MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        expect(rows()).toHaveLength(2)

        emit({
            name: 'tracker.changed',
            data: { chatId: 'chat-1', memo: '[COMBAT]\nENEMIES:\nMoth Wraith ((BAR)) 10/10\n[/COMBAT]' },
        })

        expect(rows()).toHaveLength(1)
    })
})

describe('the recolour popup (74i)', () => {
    const BAR_MEMO = ['[WAYSTONE]', 'Attunement: ((BAR)) 640/1000', 'Trust: ((BARREL)) -20/100', '[/WAYSTONE]', '[COMBAT]', 'Brenna: 12/20 HP', '[/COMBAT]', '[XP]', 'Total: 1,200 / 2,700 XP (Level 3)', '[/XP]'].join('\n')
    const BAR_ID = 'WAYSTONE::Attunement[L0]'

    const cards = () => root.querySelector('.lh-tracker-cards') as HTMLElement
    const handle = (id: string) => cards().querySelector(`[data-recolor-id="${id}"]`) as HTMLElement
    const popup = () => document.getElementById('rt-recolor-popup')
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    afterEach(() => { popup()?.remove() })

    it('puts a recolour handle on every bar, the barrel’s two halves and the XP row, and none on the bar at the bottom', async () => {
        const { bridge, setPrefs } = makeBridge({ 'chat-1': BAR_MEMO })
        setPrefs({ xpBarAtBottom: true })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        await settle()
        expect(handle(BAR_ID).classList.contains('rt-hp-bar-wrap')).toBe(true)
        expect(handle(BAR_ID).dataset.recolorCurrent).toBe('linear-gradient(90deg,#e74c3c,#c0392b)')
        expect(handle(BAR_ID).dataset.recolorExplicitColor).toBe('false')
        expect(handle(BAR_ID).title).toBe('Click to recolor')
        expect(handle('WAYSTONE::Trust[L1]:positive').classList.contains('rt-barrel-positive-control')).toBe(true)
        expect(handle('WAYSTONE::Trust[L1]:negative').dataset.barrelDirection).toBe('negative')
        expect(handle('COMBAT:Brenna:HP').title).toBe('Click to recolor HP')
        expect(handle('COMBAT:Brenna:HP').dataset.recolorCurrent).toBe('#ffaa00')
        expect(root.querySelector('.lh-bottom-xp [data-recolor-id="XP::XP"]')).not.toBeNull()
        expect(handle('XP::XP')).toBeNull()
        expect(root.querySelector('.lh-bars')).toBeNull()
    })

    it('opens Multihog’s Bar Settings over a clicked bar, saves each change as it is made, and draws the stored config', async () => {
        const { bridge, bars } = makeBridge({ 'chat-1': BAR_MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        await settle()
        handle(BAR_ID).click()
        const box = popup() as HTMLElement
        expect(box).not.toBeNull()
        expect(box.textContent).toContain('Bar Settings')
        expect(box.textContent).toContain('Show as Percentage')
        expect(box.textContent).toContain('Animate Changes')
        ;(box.querySelector('.mode-btn[data-mode="gradient"]') as HTMLButtonElement).click()
        await settle()
        expect(bars()[BAR_ID]).toMatchObject({ mode: 'gradient', color: expect.stringMatching(/^#[0-9a-f]{6}$/), color2: expect.stringMatching(/^#[0-9a-f]{6}$/) })
        expect(handle(BAR_ID).dataset.recolorCurrent).toMatch(/^linear-gradient\(90deg, #[0-9a-f]{6}, #[0-9a-f]{6}\)$/)
        expect(handle(BAR_ID).querySelector('.rt-hp-bar')?.getAttribute('style')).toContain('linear-gradient(90deg, #')
        const pct = popup()!.querySelector('#show-as-percentage') as HTMLInputElement
        pct.checked = true
        pct.dispatchEvent(new Event('change'))
        await settle()
        expect(bars()[BAR_ID]).toMatchObject({ mode: 'gradient', showAsPercentage: true })
        expect(cards().textContent).toContain('64%')
        const anim = popup()!.querySelector('#animate-bar-changes') as HTMLInputElement
        anim.checked = true
        anim.dispatchEvent(new Event('change'))
        await settle()
        expect(bars()[BAR_ID]).toMatchObject({ animateChanges: true })
        expect(handle(BAR_ID).dataset.rtBarAnimate).toBe('true')
        ;(popup()!.querySelector('#recolor-ok') as HTMLButtonElement).click()
        expect(popup()).toBeNull()
        // Reset clears the bar's config whole; the redraw shows the author's bar again.
        handle(BAR_ID).click()
        ;(popup()!.querySelector('#recolor-reset') as HTMLButtonElement).click()
        await settle()
        expect(bars()).toEqual({})
        expect(cards().textContent).toContain('640/1000')
        expect(popup()).toBeNull()
    })

    it('puts the config back on Cancel, offers Dynamic as the HP bar’s start, and closes on a click outside', async () => {
        const { bridge, bars } = makeBridge({ 'chat-1': BAR_MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        await settle()
        handle('COMBAT:Brenna:HP').click()
        expect(popup()!.textContent).toContain('HP-based coloring active')
        ;(popup()!.querySelector('.mode-btn[data-mode="solid"]') as HTMLButtonElement).click()
        await settle()
        expect(bars()['COMBAT:Brenna:HP']).toMatchObject({ mode: 'solid' })
        ;(popup()!.querySelector('#recolor-cancel') as HTMLButtonElement).click()
        await settle()
        expect(bars()).toEqual({})
        expect(popup()).toBeNull()
        // The XP row's handle in the cards (the bar at the bottom is off here) opens it under the legacy's id.
        handle('XP::XP').click()
        expect(popup()).not.toBeNull()
        ;(popup()!.querySelector('.mode-btn[data-mode="dynamic"]') as HTMLButtonElement).click()
        await settle()
        expect(bars()['XP::XP']).toMatchObject({ mode: 'dynamic' })
        await wait(60)
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        expect(popup()).toBeNull()
        expect(bars()['XP::XP']).toMatchObject({ mode: 'dynamic' })
    })

    it('offers Show as Percentage only where the bar reads it, and reads it on a barrel as a signed percentage (74i-bis)', async () => {
        const memo = BAR_MEMO.replace('[/WAYSTONE]', 'Mana: ((ORBS)) 2/4\n[/WAYSTONE]')
        const { bridge, bars } = makeBridge({ 'chat-1': memo })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        await settle()
        // An orbs row has no readout a percentage could change: the tick is off its box, through every redraw of it.
        const orbs = cards().querySelector('.rt-orbs-container[data-recolor-id]') as HTMLElement
        expect(orbs.dataset.recolorPercent).toBeUndefined()
        orbs.click()
        expect(popup()).not.toBeNull()
        expect(popup()!.textContent).toContain('Bar Settings')
        expect(popup()!.querySelector('#show-as-percentage')).toBeNull()
        expect(popup()!.textContent).not.toContain('Show as Percentage')
        ;(popup()!.querySelector('.mode-btn[data-mode="gradient"]') as HTMLButtonElement).click()
        await settle()
        expect(popup()!.querySelector('#color2')).not.toBeNull()
        expect(popup()!.querySelector('#show-as-percentage')).toBeNull()
        ;(popup()!.querySelector('#recolor-cancel') as HTMLButtonElement).click()
        await settle()
        // A barrel's half reads it: the readout becomes a signed percentage of the range.
        const half = handle('WAYSTONE::Trust[L1]:negative')
        expect(half.dataset.recolorPercent).toBe('true')
        half.click()
        const tick = popup()!.querySelector('#show-as-percentage') as HTMLInputElement
        expect(tick).not.toBeNull()
        tick.checked = true
        tick.dispatchEvent(new Event('change'))
        await settle()
        expect(bars()['WAYSTONE::Trust[L1]:negative']).toMatchObject({ showAsPercentage: true })
        expect(cards().querySelector('.rt-barrel-value')?.textContent).toBe('-20%')
        ;(popup()!.querySelector('#recolor-ok') as HTMLButtonElement).click()
        expect(popup()).toBeNull()
    })

    it('redraws when a bar is recoloured under a message (74i-ter): the same event the other preferences arrive on', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': BAR_MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        await settle()
        expect(cards().textContent).toContain('640/1000')
        emit({ name: 'prefs.changed', data: { prefs: { bars: { [BAR_ID]: { showAsPercentage: true } } } } })
        await settle()
        expect(cards().textContent).toContain('64%')
        // Opening the box then starts from the store's config, not a stale map.
        handle(BAR_ID).click()
        expect((popup()!.querySelector('#show-as-percentage') as HTMLInputElement).checked).toBe(true)
    })
})

describe('Tab Mode (76)', () => {
    const MEMO = ['[CHARACTER]', 'Robin: 30/40 HP', '[/CHARACTER]', '[TIME]', '06:15 AM, Day 4', '[/TIME]', '[PARTY]', 'Elara: 26/45 HP', '[/PARTY]', '[VEHICLE_FUEL]', 'Vehicle Fuel: ((BARRED)) 1000/1000', '[/VEHICLE_FUEL]'].join('\n')
    const cards = () => root.querySelector('.lh-tracker-cards') as HTMLElement
    const pane = () => cards().querySelector('.rt-tabmode-content') as HTMLElement | null
    const touch = (name: string, x: number, y: number, target: Element) => {
        const event = new Event(name, { bubbles: true }) as Event & { touches: unknown[]; changedTouches: unknown[] }
        event.touches = name === 'touchstart' ? [{ clientX: x, clientY: y }] : []
        event.changedTouches = [{ clientX: x, clientY: y }]
        target.dispatchEvent(event)
    }

    it('draws the strip from the preference, shows the clock in the foot, changes tab on a click, a jump and a swipe, and keeps the tab', async () => {
        const { bridge, setPrefs, emit, requests } = makeBridge({ 'chat-1': MEMO })
        setPrefs({ panelLayoutMode: 'tabs', trackerActiveTab: 'VEHICLE_FUEL' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        await settle()
        expect(cards().classList.contains('lh-tracker-cards--tabs')).toBe(true)
        expect(cards().querySelector('.rt-tabmode-pinned [data-tag="CHARACTER"]')).not.toBeNull()
        expect(pane()!.getAttribute('data-active-tag')).toBe('VEHICLE_FUEL')
        expect(cards().querySelector('.rt-tab-btn.active')!.getAttribute('data-tag')).toBe('VEHICLE_FUEL')
        const clock = root.querySelector('.lh-foot-clock') as HTMLElement
        expect(clock.hidden).toBe(false)
        expect(clock.textContent).toContain('06:15 AM, Day 4')
        // A tab button shows its pane and keeps the choice as a preference.
        ;(cards().querySelector('.rt-tab-btn[data-tag="TIME"]') as HTMLElement).click()
        expect(pane()!.getAttribute('data-active-tag')).toBe('TIME')
        expect(pane()!.querySelector('[data-tag="TIME"]')).not.toBeNull()
        await settle()
        expect(requests.filter((r) => r.op === 'prefs.patch').map((r) => r.params?.patch)).toContainEqual({ trackerActiveTab: 'TIME' })
        // A member of the vitals strip jumps to PARTY and lands on that member's card, outlined (76-bis) — the card unfolded if it was folded.
        ;(cards().querySelector('.rt-tab-btn[data-tag="PARTY"]') as HTMLElement).click()
        ;(pane()!.querySelector('.rt-section-header') as HTMLElement).click()
        expect(pane()!.querySelector('[data-tag="PARTY"]')!.classList.contains('rt-section--collapsed')).toBe(true)
        ;(cards().querySelector('.rt-tab-btn[data-tag="TIME"]') as HTMLElement).click()
        expect(cards().querySelector('.rt-vitals-member')!.getAttribute('data-jump-entity')).toBe('Elara')
        // The strip is sticky over the top of the box, so the landing asks for its height as the card's scroll margin (76-ter);
        // happy-dom lays nothing out, so the strip is given a height and the scroll is watched.
        const heightWas = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get(this: HTMLElement) { return this.classList.contains('rt-tab-strip') ? 52 : 0 } })
        const scrolled = vi.fn()
        const scrollWas = HTMLElement.prototype.scrollIntoView
        HTMLElement.prototype.scrollIntoView = scrolled
        try {
            ;(cards().querySelector('.rt-vitals-member') as HTMLElement).click()
        } finally {
            if (heightWas) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', heightWas)
            else delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight
            HTMLElement.prototype.scrollIntoView = scrollWas
        }
        expect(pane()!.getAttribute('data-active-tag')).toBe('PARTY')
        expect(pane()!.querySelector('[data-tag="PARTY"]')!.classList.contains('rt-section--collapsed')).toBe(false)
        const landed = pane()!.querySelector<HTMLElement>('[data-entity="Elara"]')!
        expect(landed.classList.contains('rt-entity-card--landed')).toBe(true)
        expect(landed.style.scrollMarginTop).toBe('52px')
        expect(scrolled).toHaveBeenCalledTimes(1)
        expect(scrolled.mock.calls[0]![0]).toMatchObject({ block: 'start' })
        // A swipe left over the pane moves to the next tab (the stock order puts PARTY before TIME); a mostly vertical one does not; a swipe right comes back.
        expect(cards().querySelector('.rt-tabmode-wrap')!.getAttribute('data-tab-order')).toBe('PARTY,TIME,VEHICLE_FUEL')
        touch('touchstart', 200, 100, pane()!)
        touch('touchend', 120, 110, pane()!)
        expect(pane()!.getAttribute('data-active-tag')).toBe('TIME')
        touch('touchstart', 200, 100, pane()!)
        touch('touchend', 140, 300, pane()!)
        expect(pane()!.getAttribute('data-active-tag')).toBe('TIME')
        touch('touchstart', 100, 100, pane()!)
        touch('touchend', 200, 100, pane()!)
        expect(pane()!.getAttribute('data-active-tag')).toBe('PARTY')
        touch('touchstart', 100, 100, pane()!)
        touch('touchend', 200, 100, pane()!)
        expect(pane()!.getAttribute('data-active-tag')).toBe('PARTY')
        // The layout arrives on the event every preference arrives on: stacked again, the clock gone.
        emit({ name: 'prefs.changed', data: { prefs: { panelLayoutMode: 'stack' } } })
        expect(pane()).toBeNull()
        expect(cards().classList.contains('lh-tracker-cards--tabs')).toBe(false)
        expect(cards().querySelector('[data-tag="VEHICLE_FUEL"]')).not.toBeNull()
        // The clock stays in the footer whatever the layout since 78b.
        expect(clock.hidden).toBe(false)
        emit({ name: 'prefs.changed', data: { prefs: { panelLayoutMode: 'tabs', trackerActiveTab: 'TIME' } } })
        expect(pane()!.getAttribute('data-active-tag')).toBe('TIME')
    })
})

describe('the Display Groups (75)', () => {
    const MEMO = ['[ALPHA_STANDING]', 'Alpha Standing: ((BARRED)) 50/100', '[/ALPHA_STANDING]', '[TIME]', '06:15 AM, Day 4', '[/TIME]', '[VEHICLE_FUEL]', 'Vehicle Fuel: ((BARRED)) 1000/1000', '[/VEHICLE_FUEL]'].join('\n')
    const group = { id: 'vehicle_systems', name: 'Vehicle Systems', icon: '🚙', enabled: true, members: ['ALPHA_STANDING', 'VEHICLE_FUEL'] }
    const cards = () => root.querySelector('.lh-tracker-cards') as HTMLElement
    const host = () => cards().querySelector('[data-tag="DISPLAY_GROUP_vehicle_systems"]') as HTMLElement | null

    it('draws the group from the preferences, folds it under the virtual key, and follows the switch on prefs.changed', async () => {
        const { bridge, setPrefs, emit } = makeBridge({ 'chat-1': MEMO })
        setPrefs({ displayGroupsEnabled: true, displayGroupsShowGaps: true, displayGroups: [group] })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        await settle()
        expect(host()).not.toBeNull()
        expect(host()!.querySelector('.rt-section-title')!.textContent).toBe('Vehicle Systems')
        expect(host()!.querySelectorAll('.rt-display-group-member')).toHaveLength(2)
        expect(host()!.querySelector('.rt-display-group-body--seamless')).toBeNull()
        expect(cards().querySelector('[data-tag="ALPHA_STANDING"]')).toBeNull()
        // The header folds the whole group, under its own key.
        ;(host()!.querySelector('.rt-section-header') as HTMLElement).click()
        expect(host()!.classList.contains('rt-section--collapsed')).toBe(true)
        expect(host()!.querySelector('.rt-display-group-body')!.hasAttribute('hidden')).toBe(true)
        ;(host()!.querySelector('.rt-section-header') as HTMLElement).click()
        expect(host()!.classList.contains('rt-section--collapsed')).toBe(false)
        // The gaps and the switch arrive on the event every preference arrives on.
        emit({ name: 'prefs.changed', data: { prefs: { displayGroupsShowGaps: false } } })
        expect(host()!.querySelector('.rt-display-group-body--seamless')).not.toBeNull()
        emit({ name: 'prefs.changed', data: { prefs: { displayGroupsEnabled: false } } })
        expect(host()).toBeNull()
        expect(cards().querySelector('[data-tag="ALPHA_STANDING"]')).not.toBeNull()
        emit({ name: 'prefs.changed', data: { prefs: { displayGroupsEnabled: true, displayGroups: [{ ...group, members: ['VEHICLE_FUEL'] }] } } })
        expect(host()!.querySelectorAll('.rt-display-group-member')).toHaveLength(1)
        expect(cards().querySelector('[data-tag="ALPHA_STANDING"]')).not.toBeNull()
    })
})

describe('a failure the user has not read yet', () => {
    const problem = () => root.querySelector('.lh-problem') as HTMLElement | null
    const problemText = () => root.querySelector('.lh-problem-text')?.textContent ?? ''
    const status = () => root.querySelector('.lh-tracker-status')?.textContent ?? ''

    /** Get the panel into a state where a failure is on screen. */
    async function withFailure() {
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        vi.spyOn(bridge, 'request').mockRejectedValueOnce(new Error('the host said no'))
        const panel = mountTrackerPanel(root, bridge, makeHost())
        await settle()
        expect(problemText()).toBe('the host said no')
        return { bridge, emit, panel }
    }

    it('starts hidden, so an untroubled panel shows nothing', async () => {
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(problem()!.hidden).toBe(true)
    })

    // The rule this whole phase exists for. A pass runs after every reply and
    // clears the status line twice — once busy, once empty — so anything
    // written there had a useful life of less than one turn.
    it('survives a tracker pass, which clears the status line', async () => {
        const { emit } = await withFailure()

        emit({ name: 'tracker.started', data: { chatId: 'chat-1', at: new Date().toISOString(), trigger: 'reply' } })
        await settle()
        emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: MEMO } })
        await settle()

        expect(problemText()).toBe('the host said no')
        expect(problem()!.hidden).toBe(false)
        // And the pass still had its own say, on its own line.
        expect(status()).toBe('')
    })

    it('survives several passes, not just the first', async () => {
        const { emit } = await withFailure()

        for (let turn = 0; turn < 3; turn++) {
            emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: MEMO } })
            await settle()
        }

        expect(problemText()).toBe('the host said no')
    })

    it('goes when the user dismisses it', async () => {
        await withFailure()

        const dismiss = root.querySelector('.lh-problem-dismiss') as HTMLButtonElement
        dismiss.click()

        expect(problem()!.hidden).toBe(true)
        expect(problemText()).toBe('')
    })

    // A failure belongs to the chat it happened in. Left up, it would sit under
    // a different chat's heading describing something that never happened
    // there — the rule every other section in this panel follows.
    it('goes when the chat changes', async () => {
        const { bridge } = makeBridge({ 'chat-1': MEMO, 'chat-2': MEMO })
        vi.spyOn(bridge, 'request').mockRejectedValueOnce(new Error('the host said no'))
        let chatId = 'chat-1'
        const host: TrackerPanelHost = { ...makeHost(), getActiveChat: () => ({ chatId, characterId: null }) }
        const panel = mountTrackerPanel(root, bridge, host)
        await settle()
        expect(problem()!.hidden).toBe(false)

        chatId = 'chat-2'
        await panel.refresh()
        await settle()

        expect(problem()!.hidden).toBe(true)
    })

    // Introduced by the fix and caught by an existing test: the error used to
    // land on top of the busy notice and take it down. Now that it lands
    // elsewhere, the notice has to be taken down deliberately, or the panel
    // claims to be running a pass that already failed.
    it('does not leave the panel claiming a pass is still running', async () => {
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        vi.spyOn(bridge, 'request').mockRejectedValueOnce(new Error('no connection configured'))
        const run = Array.from(root.querySelectorAll('button'))
            .find((b) => b.textContent === 'Run tracker now') as HTMLButtonElement
        run.click()
        await settle()

        expect(problemText()).toBe('no connection configured')
        expect(status()).not.toMatch(/Running the tracker/)
    })
})

describe('the world progression section', () => {
    const fold = () => root.querySelector('.lh-world') as HTMLElement
    const statusLine = () => fold().querySelector('.lh-world-status')!.textContent ?? ''
    const reportsLine = () => fold().querySelector('.lh-world-reports')!.textContent ?? ''
    const note = () => fold().querySelector('.lh-world-note')?.textContent ?? ''
    const live = () => fold().querySelector('.lh-world-running') as HTMLElement
    const field = (name: string) => fold().querySelector(`[data-lh-field="${name}"] input, [data-lh-field="${name}"]`) as HTMLInputElement
    const worldButton = (text: string) => Array.from(fold().querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement
    const STATUS = {
        enabled: false, intervalHours: 24, locationsPerReport: 3, keepActive: 1, lookback: 20, prefix: 'Vell', worldBookName: 'Vell_World', lastFiredPeriodLabel: '', nextDueLabel: 'Day 3, 09:00 AM', currentTimeLabel: 'Day 2, 09:00 AM', activeReports: [],
        skeletonBookName: 'Vell_Skeleton', skeletonCounts: { factions: 0, locations: 0, conflicts: 0 }, skeletonSource: '',
        skeleton: { factions: 4, locations: 4, conflicts: 3, systemPrompt: '', useLorebooks: false, lorebookOnly: false, lorebookFilter: '', useExisting: true },
    }

    it('draws the switch off, the numbers, the clock and where reports go', async () => {
        const { bridge, setWorldStatus } = makeBridge({ 'chat-1': MEMO })
        setWorldStatus(STATUS)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        expect(fold().querySelector('.lh-agent-drawer-title')!.textContent).toBe('🌍 World Progression')
        expect(fold().querySelector('[data-lh-field="world-badge"]')!.textContent).toBe('OFF')
        expect(field('world-enabled').checked).toBe(false)
        expect(field('world-interval').value).toBe('24')
        expect(field('world-locations').value).toBe('3')
        // Reports shown and replies read are the settings category's alone since 78b.
        expect(root.querySelector('[data-lh-field="world-keep"]')).toBeNull()
        expect(root.querySelector('[data-lh-field="world-lookback"]')).toBeNull()
        expect(statusLine()).toContain('The clock reads Day 2, 09:00 AM.')
        expect(statusLine()).toContain('No report yet.')
        expect(statusLine()).not.toContain('Next due')
        expect(statusLine()).toContain('filed in Vell_World')
        expect(reportsLine()).toContain('Nothing is shown to the narrator yet')
        expect(live().hidden).toBe(true)
    })

    it('says when the next report is due once switched on, and names what the narrator is shown', async () => {
        const { bridge, setWorldStatus } = makeBridge({ 'chat-1': MEMO })
        setWorldStatus({ ...STATUS, enabled: true, lastFiredPeriodLabel: 'Day 2, 09:00 AM', activeReports: [{ label: 'Day 2, 09:00 AM', reportId: 'Vell_World::1' }] })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        expect(fold().querySelector('[data-lh-field="world-badge"]')!.textContent).toBe('ON')
        expect(statusLine()).toContain('Last report: Day 2, 09:00 AM.')
        expect(statusLine()).toContain('Next due at Day 3, 09:00 AM.')
        expect(reportsLine()).toBe('Shown to the narrator: Day 2, 09:00 AM.')
    })

    it('stores each preference under its own key and redraws from the backend\'s answer', async () => {
        const { bridge, setWorldStatus, worldPatches } = makeBridge({ 'chat-1': MEMO })
        setWorldStatus(STATUS)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        field('world-enabled').checked = true
        field('world-enabled').dispatchEvent(new Event('change'))
        await settle()
        field('world-interval').value = '6'
        field('world-interval').dispatchEvent(new Event('change'))
        field('world-locations').value = '5'
        field('world-locations').dispatchEvent(new Event('change'))
        await settle()
        expect(worldPatches()).toEqual([
            { worldProgressionEnabled: true },
            { worldProgressionIntervalHours: 6 },
            { worldProgressionLocationsPerReport: 5 },
        ])
        expect(fold().querySelector('summary')!.textContent).toContain('on')
        expect(statusLine()).toContain('the clock starts on the next tracker pass')
    })

    it('writes a report now, with the instructions when given, and clears them on success', async () => {
        const { bridge, setWorldStatus, worldPatches } = makeBridge({ 'chat-1': MEMO })
        setWorldStatus({ ...STATUS, enabled: true })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        worldButton('Write a report now').click()
        expect(live().hidden).toBe(false)
        expect(live().textContent).toContain('A report is being written now')
        expect(worldButton('Write a report now').disabled).toBe(true)
        await settle()
        expect(live().hidden).toBe(true)
        expect(note()).toContain('Wrote the report for Day 3, 09:00 AM: Glassmere.')
        expect(note()).toContain('when you asked')
        expect(statusLine()).toContain('Last report: Day 3, 09:00 AM.')

        const extra = field('world-extra') as unknown as HTMLTextAreaElement
        extra.value = ' a storm is coming '
        worldButton('Write with these instructions').click()
        await settle()
        expect(worldPatches().filter((p) => p.op === 'run')).toEqual([
            { op: 'run', chatId: 'chat-1' },
            { op: 'run', chatId: 'chat-1', extraInstructions: 'a storm is coming' },
        ])
        expect(extra.value).toBe('')
    })

    it('says why a report failed, in red, and keeps the instructions', async () => {
        const { bridge, setWorldStatus, setWorldRun } = makeBridge({ 'chat-1': MEMO })
        setWorldStatus({ ...STATUS, enabled: true })
        setWorldRun({ status: 'failed', at: new Date().toISOString(), trigger: 'manual', reason: 'The tracker has no readable [TIME] block yet.' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const extra = field('world-extra') as unknown as HTMLTextAreaElement
        extra.value = 'storms'
        worldButton('Write with these instructions').click()
        await settle()
        expect(note()).toContain('The report failed: The tracker has no readable [TIME] block yet.')
        expect(fold().querySelector('.lh-world-note--error')).not.toBeNull()
        expect(extra.value).toBe('storms')
    })

    it('shows a pass that started on its own, and its report when it lands, for this chat only', async () => {
        const { bridge, setWorldStatus, emit } = makeBridge({ 'chat-1': MEMO })
        setWorldStatus({ ...STATUS, enabled: true })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        emit({ name: 'world.started', data: { chatId: 'chat-2', at: new Date().toISOString(), trigger: 'automatic' } })
        await settle()
        expect(live().hidden).toBe(true)
        emit({ name: 'world.started', data: { chatId: 'chat-1', at: new Date().toISOString(), trigger: 'automatic' } })
        await settle()
        expect(live().hidden).toBe(false)
        expect(live().textContent).toContain('on its own')
        // The backend saves the run before it announces it, so the reload after
        // the event finds it; the fake is told the same.
        const duplicate = { status: 'duplicate', at: new Date().toISOString(), trigger: 'automatic', periodLabel: 'Day 3, 09:00 AM' }
        setWorldStatus({ ...STATUS, enabled: true, lastRun: duplicate })
        emit({ name: 'world.finished', data: { chatId: 'chat-1', ...duplicate } })
        await settle()
        expect(live().hidden).toBe(true)
        expect(note()).toContain('A report for Day 3, 09:00 AM was already filed')
        expect(note()).toContain('on its own')
    })

    it('consolidates the oldest N reports now after a confirm, and sets the next report’s time (72b)', async () => {
        const { bridge, setWorldStatus, requests } = makeBridge({ 'chat-1': MEMO })
        setWorldStatus({ ...STATUS, enabled: true, lastFiredPeriodLabel: 'Day 2, 09:00 AM' })
        const asked: unknown[] = []
        mountTrackerPanel(root, bridge, { ...makeHost(), ui: { showConfirm: async (options: Record<string, unknown>) => { asked.push(options); return { confirmed: true } } } })
        await settle()
        const tools = fold().querySelector('[data-lh-field="world-tools"]') as HTMLElement
        expect(tools).not.toBeNull()
        const toolsNote = () => tools.querySelector('[data-lh-field="world-tools-note"]')!.textContent
        // Fewer than two is refused before anything is asked.
        field('world-consolidate-count').value = '1'
        field('world-consolidate').click()
        await settle()
        expect(asked).toHaveLength(0)
        expect(toolsNote()).toContain('at least 2')
        field('world-consolidate-count').value = '3'
        field('world-consolidate').click()
        await settle()
        await settle()
        expect(asked).toHaveLength(1)
        const consolidate = requests.find((r) => r.op === 'world.consolidate')
        expect(consolidate?.params).toEqual({ chatId: 'chat-1', count: 3 })
        expect(toolsNote()).toContain('Consolidated 3 reports into “Day 1 – Day 3”')
        // The next report's time: the status that comes back redraws the fold.
        field('world-override-next').value = 'Day 6, 08:00 AM'
        field('world-override').click()
        await settle()
        const override = requests.find((r) => r.op === 'world.overrideNext')
        expect(override?.params).toEqual({ chatId: 'chat-1', next: 'Day 6, 08:00 AM' })
        expect(toolsNote()).toContain('due at Day 6, 08:00 AM')
        expect(statusLine()).toContain('Day 6, 08:00 AM')
        expect(field('world-override-next').value).toBe('')
        // An empty box is refused with no request.
        field('world-override').click()
        await settle()
        expect(requests.filter((r) => r.op === 'world.overrideNext')).toHaveLength(1)
        expect(toolsNote()).toContain('Enter the in-world time')
    })

    it('resets the timeline and says so', async () => {
        const { bridge, setWorldStatus, worldPatches } = makeBridge({ 'chat-1': MEMO })
        setWorldStatus({ ...STATUS, enabled: true, lastFiredPeriodLabel: 'Day 2, 09:00 AM' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        worldButton('Reset the timeline').click()
        await settle()
        expect(worldPatches()).toEqual([{ op: 'reset' }])
        expect(statusLine()).not.toContain('Last report')
        expect(root.querySelector('.lh-tracker-status')!.textContent).toContain('timeline is reset')
    })

    it('says so and disables the controls when the build cannot run it, and clears on a chat change', async () => {
        const { bridge, setWorldStatus } = makeBridge({ 'chat-1': MEMO })
        setWorldStatus({ ...STATUS, unavailable: 'This build cannot run World Progression.' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        expect(statusLine()).toBe('This build cannot run World Progression.')
        expect(worldButton('Write a report now').disabled).toBe(true)
        expect(field('world-enabled').disabled).toBe(true)
    })

    it('leaves the fold readable when the status cannot be loaded at all', async () => {
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        expect(statusLine()).toContain('no world here')
        expect(worldButton('Write a report now').disabled).toBe(true)
    })
})

describe('the world skeleton (33b)', () => {
    const fold = () => root.querySelector('.lh-skeleton') as HTMLElement
    const statusLine = () => fold().querySelector('.lh-skeleton-status')!.textContent ?? ''
    const note = () => fold().querySelector('.lh-skeleton-note')?.textContent ?? ''
    const live = () => fold().querySelector('.lh-skeleton-running') as HTMLElement
    const field = (name: string) => root.querySelector(`[data-lh-field="${name}"] input, [data-lh-field="${name}"]`) as HTMLInputElement
    const button = (text: string) => Array.from(root.querySelectorAll('.lh-skeleton button, .lh-world button')).find((b) => b.textContent === text) as HTMLButtonElement
    const toast = () => root.querySelector('.lh-tracker-status')!.textContent ?? ''
    const filterRow = () => root.querySelector('.lh-skeleton-filter') as HTMLElement
    const STATUS = {
        enabled: false, intervalHours: 24, locationsPerReport: 3, keepActive: 1, lookback: 20, prefix: 'Vell', worldBookName: 'Vell_World', lastFiredPeriodLabel: '', nextDueLabel: 'Day 3, 09:00 AM', currentTimeLabel: 'Day 2, 09:00 AM', activeReports: [],
        skeletonBookName: 'Vell_Skeleton', skeletonCounts: { factions: 0, locations: 0, conflicts: 0 }, skeletonSource: '',
        skeleton: { factions: 4, locations: 4, conflicts: 3, systemPrompt: '', useLorebooks: false, lorebookOnly: false, lorebookFilter: '', useExisting: true, sourceLookback: 30 },
    }
    const bookBox = (name: string) => root.querySelector(`[data-lh-book="${name}"] input`) as HTMLInputElement
    const hostWithConfirm = (answer: boolean, asked: Array<Record<string, unknown>> = []) => ({
        ...makeHost(),
        ui: { showConfirm: async (options: Record<string, unknown>) => { asked.push(options); return { confirmed: answer } } },
    })

    it('sits inside the world fold, drawn from the status: the counts, the options, the source and where the book is', async () => {
        const { bridge, setWorldStatus } = makeBridge({ 'chat-1': MEMO })
        setWorldStatus({ ...STATUS, skeletonSource: 'A drowned coast.', skeleton: { ...STATUS.skeleton, useLorebooks: true, lorebookFilter: 'Canon, Gods', systemPrompt: 'Draw.' } })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        // A fold of its own since 78a; without a World progression category to go in (78b) it follows the panes.
        expect(fold().closest('.lh-world')).toBeNull()
        expect(fold().previousElementSibling!.classList.contains('lh-maps')).toBe(true)
        expect(fold().nextElementSibling!.classList.contains('lh-tracker-raw')).toBe(true)
        // Multihog's card since 82: the icon, the title and the chevron of the dials cards around it.
        expect(fold().getAttribute('data-lh-card')).toBe('skeleton')
        expect(fold().querySelector('summary .lh-card-title')!.textContent).toBe('World Skeleton & Atmosphere')
        expect(fold().querySelector('summary .lh-card-icon')!.textContent).toBe('💀')
        expect(fold().querySelector('summary .lh-chevron')).not.toBeNull()
        expect(fold().querySelector('.lh-skeleton-body')!.classList.contains('lh-search-item')).toBe(true)
        expect(statusLine()).toBe('No skeleton yet. It will be filed in Vell_Skeleton.')
        expect((field('world-skeleton-source') as unknown as HTMLTextAreaElement).value).toBe('A drowned coast.')
        expect(field('world-skeleton-factions').value).toBe('4')
        expect(field('world-skeleton-locations').value).toBe('4')
        expect(field('world-skeleton-conflicts').value).toBe('3')
        expect(field('world-skeleton-lorebooks').checked).toBe(true)
        expect(filterRow().hidden).toBe(false)
        // The shelf (33c): every book but World Progression's own, the named ones ticked.
        expect(Array.from(root.querySelectorAll('.lh-skeleton-book')).map((b) => b.textContent)).toEqual(['Vell_LOC · this campaign’s', 'Canon', 'Gods'])
        expect(bookBox('Vell_LOC').checked).toBe(false)
        expect(bookBox('Canon').checked).toBe(true)
        expect(bookBox('Gods').checked).toBe(true)
        expect(filterRow().textContent).toContain('2 ticked.')
        expect(field('world-skeleton-source-lookback').value).toBe('30')
        expect(field('world-skeleton-only').checked).toBe(false)
        expect(field('world-skeleton-existing').checked).toBe(true)
        expect((field('world-skeleton-prompt') as unknown as HTMLTextAreaElement).value).toBe('Draw.')
        expect(note()).toBe('')
        expect(live().hidden).toBe(true)
    })

    it('hides the lorebook rows until lorebooks are read, and stores each option under its own key', async () => {
        const { bridge, setWorldStatus, worldPatches } = makeBridge({ 'chat-1': MEMO })
        setWorldStatus(STATUS)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        expect(filterRow().hidden).toBe(true)
        expect(field('world-skeleton-only').closest('label')!.hidden).toBe(true)
        field('world-skeleton-lorebooks').checked = true
        field('world-skeleton-lorebooks').dispatchEvent(new Event('change'))
        await settle()
        expect(filterRow().hidden).toBe(false)
        expect(field('world-skeleton-only').closest('label')!.hidden).toBe(false)
        field('world-skeleton-factions').value = '6'
        field('world-skeleton-factions').dispatchEvent(new Event('change'))
        field('world-skeleton-locations').value = '2'
        field('world-skeleton-locations').dispatchEvent(new Event('change'))
        field('world-skeleton-conflicts').value = '0'
        field('world-skeleton-conflicts').dispatchEvent(new Event('change'))
        expect(filterRow().textContent).toContain('None ticked: this campaign’s own books are read.')
        bookBox('Canon').checked = true
        bookBox('Canon').dispatchEvent(new Event('change'))
        await settle()
        bookBox('Gods').checked = true
        bookBox('Gods').dispatchEvent(new Event('change'))
        await settle()
        bookBox('Canon').checked = false
        bookBox('Canon').dispatchEvent(new Event('change'))
        await settle()
        field('world-skeleton-source-lookback').value = '12'
        field('world-skeleton-source-lookback').dispatchEvent(new Event('change'))
        field('world-skeleton-only').checked = true
        field('world-skeleton-only').dispatchEvent(new Event('change'))
        field('world-skeleton-existing').checked = false
        field('world-skeleton-existing').dispatchEvent(new Event('change'))
        const prompt = field('world-skeleton-prompt') as unknown as HTMLTextAreaElement
        prompt.value = 'Draw {locationCount}.'
        prompt.dispatchEvent(new Event('change'))
        await settle()
        expect(worldPatches()).toEqual([
            { worldSkeletonUseLorebooks: true },
            { worldSkeletonFactions: 6 },
            { worldSkeletonLocations: 2 },
            { worldSkeletonConflicts: 0 },
            { worldSkeletonLorebookFilter: 'Canon' },
            { worldSkeletonLorebookFilter: 'Canon, Gods' },
            { worldSkeletonLorebookFilter: 'Gods' },
            { worldSkeletonSourceLookback: 12 },
            { worldSkeletonLorebookOnly: true },
            { worldSkeletonUseExisting: false },
            { worldSkeletonSystemPrompt: 'Draw {locationCount}.' },
        ])
        expect(field('world-skeleton-factions').value).toBe('6')
    })

    it('generates from the source, shows the run, and then what the book holds', async () => {
        const { bridge, setWorldStatus, worldPatches } = makeBridge({ 'chat-1': MEMO })
        setWorldStatus(STATUS)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const source = field('world-skeleton-source') as unknown as HTMLTextAreaElement
        source.value = 'A drowned coast.'
        button('Generate the skeleton').click()
        expect(live().hidden).toBe(false)
        expect(live().textContent).toContain('The skeleton is being written now')
        expect(button('Generate the skeleton').disabled).toBe(true)
        expect(button('Write a report now').disabled).toBe(true)
        await settle()
        expect(live().hidden).toBe(true)
        expect(worldPatches()).toEqual([{ op: 'skeleton', chatId: 'chat-1', source: 'A drowned coast.', mode: 'replace' }])
        expect(note()).toContain('Wrote 11 premises: 4 factions, 4 locations, 3 conflicts.')
        expect(statusLine()).toBe('Vell_Skeleton holds 4 factions, 4 locations and 3 conflicts.')
        expect(fold().querySelector('[data-lh-field="world-skeleton-count"]')!.textContent).toBe('· 11')
        expect(source.value).toBe('A drowned coast.')
        expect(button('Generate the skeleton').disabled).toBe(false)
    })

    it('adds to the skeleton without asking, and says why a generation failed, in red', async () => {
        const { bridge, setWorldStatus, setWorldSkeleton, worldPatches } = makeBridge({ 'chat-1': MEMO })
        setWorldStatus({ ...STATUS, skeletonCounts: { factions: 1, locations: 1, conflicts: 1 } })
        setWorldSkeleton({ status: 'written', at: new Date().toISOString(), mode: 'append', count: 2, factions: 0, locations: 2, conflicts: 0 })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        button('Add to the skeleton').click()
        expect(live().textContent).toContain('being extended now')
        await settle()
        expect(worldPatches()).toEqual([{ op: 'skeleton', chatId: 'chat-1', source: '', mode: 'append' }])
        expect(note()).toContain('Added 2 premises: 0 factions, 2 locations, 0 conflicts.')
        setWorldSkeleton({ status: 'failed', at: new Date().toISOString(), mode: 'append', reason: 'The model returned nothing.' })
        button('Add to the skeleton').click()
        await settle()
        expect(note()).toContain('The skeleton failed: The model returned nothing.')
        expect(fold().querySelector('.lh-world-note--error')).not.toBeNull()
    })

    it('asks before replacing a skeleton that is there, through the host\'s dialog when it has one', async () => {
        const { bridge, setWorldStatus, worldPatches } = makeBridge({ 'chat-1': MEMO })
        setWorldStatus({ ...STATUS, skeletonCounts: { factions: 2, locations: 2, conflicts: 1 } })
        const asked: Array<Record<string, unknown>> = []
        mountTrackerPanel(root, bridge, hostWithConfirm(false, asked))
        await settle()
        button('Generate the skeleton').click()
        await settle()
        expect(asked).toHaveLength(1)
        expect(asked[0]).toMatchObject({ variant: 'danger', confirmLabel: 'Replace', message: expect.stringContaining('5 premises in Vell_Skeleton will be deleted') })
        expect(worldPatches()).toEqual([])
        expect(live().hidden).toBe(true)
    })

    it('asks by a second press when the host has no dialog, and forgets an unrepeated press', async () => {
        const { bridge, setWorldStatus, worldPatches } = makeBridge({ 'chat-1': MEMO })
        setWorldStatus({ ...STATUS, skeletonCounts: { factions: 2, locations: 2, conflicts: 1 } })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        // Only the arm timer is faked; the bridge answers on microtasks.
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        try {
            const tick = () => vi.advanceTimersByTimeAsync(1)
            const generate = button('Generate the skeleton')
            generate.click()
            await tick()
            expect(generate.textContent).toBe('Press again to replace')
            expect(toast()).toContain('Press the button again')
            expect(worldPatches()).toEqual([])
            await vi.advanceTimersByTimeAsync(9000)
            expect(generate.textContent).toBe('Generate the skeleton')
            generate.click()
            await tick()
            expect(worldPatches()).toEqual([])
            generate.click()
            await tick()
            expect(generate.textContent).toBe('Generate the skeleton')
            expect(worldPatches()).toEqual([{ op: 'skeleton', chatId: 'chat-1', source: '', mode: 'replace' }])
        } finally {
            vi.useRealTimers()
        }
    })

    it('purges the history after a confirmation, says what went, and reloads', async () => {
        const { bridge, setWorldStatus, worldPatches } = makeBridge({ 'chat-1': MEMO })
        setWorldStatus({ ...STATUS, enabled: true, lastFiredPeriodLabel: 'Day 2, 09:00 AM', skeletonCounts: { factions: 1, locations: 1, conflicts: 1 }, activeReports: [{ label: 'Day 2, 09:00 AM', reportId: 'Vell_World::1' }] })
        const asked: Array<Record<string, unknown>> = []
        mountTrackerPanel(root, bridge, hostWithConfirm(true, asked))
        await settle()
        button('Purge history').click()
        await settle()
        expect(asked[0]).toMatchObject({ variant: 'danger', confirmLabel: 'Purge', message: expect.stringContaining('Every report in Vell_World and every premise in Vell_Skeleton will be deleted') })
        expect(worldPatches()).toEqual([{ op: 'purge', chatId: 'chat-1', includeSkeleton: true }])
        expect(root.querySelector('.lh-world-purge-note')!.textContent).toBe('Purged: 2 reports from Vell_World and 3 premises from Vell_Skeleton. The clock starts again on the next tracker pass.')
        expect(toast()).toContain('history is purged')
        expect(statusLine()).toContain('No skeleton yet')
        expect(root.querySelector('.lh-world-reports')!.textContent).toContain('Nothing is shown to the narrator yet')
        expect(root.querySelector('.lh-world-status')!.textContent).not.toContain('Last report')
    })

    it('writes the source from this chat into the box, asking first only when there is text to lose', async () => {
        const { bridge, setWorldStatus, setWorldSource, worldPatches } = makeBridge({ 'chat-1': MEMO })
        setWorldStatus(STATUS)
        const asked: Array<Record<string, unknown>> = []
        mountTrackerPanel(root, bridge, hostWithConfirm(false, asked))
        await settle()
        const source = field('world-skeleton-source') as unknown as HTMLTextAreaElement
        button('Write it from this chat').click()
        expect(live().hidden).toBe(false)
        expect(live().textContent).toContain('The source is being written from this chat now')
        expect(button('Generate the skeleton').disabled).toBe(true)
        await settle()
        expect(asked).toEqual([])
        expect(worldPatches()).toEqual([{ op: 'source', chatId: 'chat-1' }])
        expect(source.value).toBe('A coast written from the chat.')
        expect(toast()).toContain('written from this chat')
        expect(live().hidden).toBe(true)
        // With text in the box it asks, and declined, nothing is sent.
        button('Write it from this chat').click()
        await settle()
        expect(asked).toHaveLength(1)
        expect(asked[0]).toMatchObject({ confirmLabel: 'Replace', message: expect.stringContaining('replaced by what the model writes') })
        expect(worldPatches()).toHaveLength(1)
        expect(source.value).toBe('A coast written from the chat.')
        // Agreed to, the text is replaced even though the box was not empty.
        const agreeing = makeBridge({ 'chat-1': MEMO })
        agreeing.setWorldStatus({ ...STATUS, skeletonSource: 'Typed by hand.' })
        root.replaceChildren()
        mountTrackerPanel(root, agreeing.bridge, hostWithConfirm(true))
        await settle()
        const box = field('world-skeleton-source') as unknown as HTMLTextAreaElement
        expect(box.value).toBe('Typed by hand.')
        button('Write it from this chat').click()
        await settle()
        expect(box.value).toBe('A coast written from the chat.')
        // A failure says why and keeps the text.
        box.value = ''
        agreeing.setWorldSource({ status: 'failed', at: new Date().toISOString(), reason: 'The model returned nothing.' })
        button('Write it from this chat').click()
        await settle()
        expect(toast()).toContain('The source could not be written: The model returned nothing.')
        expect(live().hidden).toBe(true)
    })

    it('does nothing when the purge is declined, and clears its note on a chat change', async () => {
        const { bridge, setWorldStatus, worldPatches, requests } = makeBridge({ 'chat-1': MEMO, 'chat-2': MEMO })
        setWorldStatus(STATUS)
        const host = hostWithConfirm(false)
        const panel = mountTrackerPanel(root, bridge, host)
        await settle()
        button('Purge history').click()
        await settle()
        expect(worldPatches()).toEqual([])
        const source = field('world-skeleton-source') as unknown as HTMLTextAreaElement
        source.value = 'Typed for chat one.'
        const shelfReads = () => requests.filter((r) => r.op === 'world.books').length
        expect(shelfReads()).toBe(1)
        host.getActiveChat = () => ({ chatId: 'chat-2', characterId: null })
        await panel.refresh()
        await settle()
        expect(source.value).toBe('')
        // The shelf is read again for the new chat: its own books are different ones.
        expect(shelfReads()).toBe(2)
    })
})

describe('the lorebook agent section', () => {
    const runButton = () =>
        Array.from(root.querySelectorAll('.lh-agent button'))
            .find((b) => /Run the agent/.test(b.textContent ?? '')) as HTMLButtonElement
    const note = () => root.querySelector('.lh-agent-note')?.textContent ?? ''
    const lines = () => Array.from(root.querySelectorAll('.lh-agent-line')).map((n) => n.textContent ?? '')

    const RESULT = {
        at: new Date().toISOString(),
        outcome: 'committed',
        summary: 'The agent asked for 1 new entry. 1 entry written.',
        turnsUsed: 2,
        problems: [],
        write: {
            changed: ['Vell_NPC::4'],
            deleted: [],
            createdBooks: ['Vell_NPC'],
            refused: ['rewrite: "My World Bible" does not belong to this campaign, so it was left alone'],
        },
        steps: [
            { kind: 'tool', name: 'grep_lore', argument: 'Lissa' },
            { kind: 'observation', text: 'No lore entry mentions "Lissa".' },
        ],
    }

    it('runs nothing until it is asked to', async () => {
        // It writes to the campaign. It does not run because a panel opened.
        const { bridge, requests } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(requests.some((r) => r.op === 'agent.run')).toBe(false)
    })

    it('says what it wrote, and what it refused to touch', async () => {
        const { bridge, setAgentResult } = makeBridge({ 'chat-1': MEMO })
        setAgentResult(RESULT)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        runButton().click()
        await settle()

        expect(note()).toContain('1 entry written')
        expect(lines().some((line) => line.startsWith('Written: Vell_NPC::4'))).toBe(true)
        expect(lines().some((line) => line.startsWith('Books created: Vell_NPC'))).toBe(true)
        // The refusal is the interesting half: it is where the ownership rules
        // bit, and a silent one reads as the agent misbehaving.
        expect(lines().some((line) => line.includes('does not belong to this campaign'))).toBe(true)
    })

    it('points a created book at the Lorebooks list, where its attachment shows (55)', async () => {
        // The most expensive silent failure available: a book full of lore the
        // narrator never sees. The sweep attaches it as it is made; the list
        // under the Campaign name box says whether it did.
        const { bridge, setAgentResult } = makeBridge({ 'chat-1': MEMO })
        setAgentResult(RESULT)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        runButton().click()
        await settle()

        const attach = root.querySelector('.lh-agent-line--attach')?.textContent ?? ''
        expect(attach).toContain('seen by the narrator only once it is attached')
        expect(attach).toContain('Lorebooks list under the Campaign name box')
        expect(attach).not.toContain('Lumiverse')
    })

    it('says nothing about attaching when no book was created', async () => {
        const { bridge, setAgentResult } = makeBridge({ 'chat-1': MEMO })
        setAgentResult({ ...RESULT, write: { ...RESULT.write, createdBooks: [] } })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        runButton().click()
        await settle()

        expect(root.querySelector('.lh-agent-line--attach')).toBeNull()
    })

    it('shows the steps it took, folded away', async () => {
        const { bridge, setAgentResult } = makeBridge({ 'chat-1': MEMO })
        setAgentResult(RESULT)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        runButton().click()
        await settle()

        const steps = Array.from(root.querySelectorAll('.lh-agent-step')).map((n) => n.textContent)
        expect(steps).toEqual(['grep_lore(Lissa)', '\u2192 No lore entry mentions "Lissa".'])
    })

    it('repeats the reason when the build cannot run a pass', async () => {
        const { bridge, setAgentResult } = makeBridge({ 'chat-1': MEMO })
        setAgentResult({ ...RESULT, unavailable: 'This build cannot run the lorebook agent.' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        runButton().click()
        await settle()

        expect(note()).toContain('cannot run the lorebook agent')
        expect(root.querySelector('.lh-agent-note--error')).not.toBeNull()
    })

    it('says a slow pass is still running rather than showing it as failed', async () => {
        // Phase 1d's bug, in a new place: an agent pass is a conversation and
        // can outlast any deadline a button is held for. Reporting that as a
        // failure is how a working tracker looked broken.
        vi.useFakeTimers()
        try {
            const { bridge, stallAgent } = makeBridge({ 'chat-1': MEMO })
            stallAgent()
            mountTrackerPanel(root, bridge, makeHost())
            await vi.advanceTimersByTimeAsync(0)

            runButton().click()
            await vi.advanceTimersByTimeAsync(bridge.timeoutFor('agent.run') + 10)

            expect(note()).toContain('still running')
            expect(root.querySelector('.lh-agent-note--error')).toBeNull()
            expect(runButton().disabled).toBe(false)
        } finally {
            vi.useRealTimers()
        }
    })

    it('takes the result from the finish event, even after giving up waiting', async () => {
        // The other half: a pass that outlasted the deadline still wrote to the
        // campaign, and must not go unreported because this side stopped
        // listening to the request.
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        emit({ name: 'agent.finished', data: { chatId: 'chat-1', ...RESULT } })
        await settle()

        expect(note()).toContain('1 entry written')
        expect(lines().some((line) => line.startsWith('Written: Vell_NPC::4'))).toBe(true)
    })

    it('ignores a pass that finished for another chat', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        emit({ name: 'agent.finished', data: { chatId: 'chat-2', ...RESULT } })
        await settle()

        expect(lines()).toEqual([])
    })

    it('does not paint a pass under the wrong chat when it lands late', async () => {
        // Started for chat-1, answered after the user moved to chat-2. Showing
        // it here would put one campaign's writes under another's heading.
        const { bridge, setAgentResult, holdAgent, releaseAgent } = makeBridge({ 'chat-1': MEMO, 'chat-2': MEMO })
        setAgentResult(RESULT)
        let chatId = 'chat-1'
        const host: TrackerPanelHost = { ...makeHost(), getActiveChat: () => ({ chatId, characterId: null }) }
        const panel = mountTrackerPanel(root, bridge, host)
        await settle()

        holdAgent()
        runButton().click()
        await settle()

        // The user moves on, and only then does the pass answer.
        chatId = 'chat-2'
        await panel.refresh()
        await settle()
        releaseAgent()
        await settle()

        expect(lines()).toEqual([])
    })

    it('forgets the last pass when the chat changes', async () => {
        const { bridge, setAgentResult } = makeBridge({ 'chat-1': MEMO, 'chat-2': MEMO })
        setAgentResult(RESULT)
        let chatId = 'chat-1'
        const host: TrackerPanelHost = { ...makeHost(), getActiveChat: () => ({ chatId, characterId: null }) }
        const panel = mountTrackerPanel(root, bridge, host)
        await settle()

        runButton().click()
        await settle()
        expect(lines().length).toBeGreaterThan(0)

        chatId = 'chat-2'
        await panel.refresh()
        await settle()

        expect(lines()).toEqual([])
    })

    describe('undoing a pass', () => {
        const undoButton = () =>
            Array.from(root.querySelectorAll('.lh-agent button'))
                .find((b) => /Undo the last pass/.test(b.textContent ?? '')) as HTMLButtonElement
        const undoNote = () => root.querySelector('[data-lh-field="agent-undo-note"]')
        const undoText = () => undoNote()?.textContent ?? ''

        const UNDONE = { at: new Date().toISOString(), summary: 'Undone: 3 entries restored, 1 book deleted.', undone: true, problems: [] }

        it('offers an undo without being asked, and runs nothing until pressed', async () => {
            // A live pass has written 28 entries in one go. The way back has to
            // be visible before it is needed, not discovered afterwards.
            const { bridge, requests } = makeBridge({ 'chat-1': MEMO })
            mountTrackerPanel(root, bridge, makeHost())
            await settle()

            expect(undoButton()).toBeTruthy()
            expect(requests.some((r) => r.op === 'agent.undo')).toBe(false)
        })

        it('cannot be pressed while a pass is still running', async () => {
            // The pass has already taken its snapshot. An undo now would read
            // the snapshot from the pass *before* it, restore that, and then be
            // overwritten by the pass still in flight — leaving the books in a
            // state neither pass produced.
            const { bridge, holdAgent } = makeBridge({ 'chat-1': MEMO })
            holdAgent()
            mountTrackerPanel(root, bridge, makeHost())
            await settle()

            runButton().click()
            await settle()

            expect(undoButton().disabled).toBe(true)
        })

        it('stops a pass being started while it is undoing', async () => {
            const { bridge, setUndoResult } = makeBridge({ 'chat-1': MEMO })
            setUndoResult(UNDONE)
            mountTrackerPanel(root, bridge, makeHost())
            await settle()

            undoButton().click()
            expect(runButton().disabled).toBe(true)

            await settle()
            expect(runButton().disabled).toBe(false)
        })

        it('says so when a swipe rolled a pass back on its own', async () => {
            // Nobody pressed anything. The report on screen describes writes
            // that no longer exist, so the panel has to say so itself.
            const { bridge, setAgentResult, emit } = makeBridge({ 'chat-1': MEMO })
            setAgentResult(RESULT)
            mountTrackerPanel(root, bridge, makeHost())
            await settle()

            runButton().click()
            await settle()
            expect(lines().join(' ')).toContain('Vell_NPC::4')

            emit({
                name: 'agent.undone',
                data: { chatId: 'chat-1', summary: 'Undone: 3 entries restored.', undone: true, problems: [] },
            })
            await settle()

            expect(undoText()).toContain('Rolled back after a swipe')
            expect(undoText()).toContain('3 entries restored')
            expect(lines()).toEqual([])
        })

        it('ignores a rollback that happened in another chat', async () => {
            const { bridge, setAgentResult, emit } = makeBridge({ 'chat-1': MEMO })
            setAgentResult(RESULT)
            mountTrackerPanel(root, bridge, makeHost())
            await settle()

            runButton().click()
            await settle()

            emit({
                name: 'agent.undone',
                data: { chatId: 'chat-2', summary: 'Undone: 3 entries restored.', undone: true, problems: [] },
            })
            await settle()

            expect(lines().join(' ')).toContain('Vell_NPC::4')
            expect(undoText()).not.toContain('Rolled back')
        })

        it('says what it put back', async () => {
            const { bridge, setUndoResult } = makeBridge({ 'chat-1': MEMO })
            setUndoResult(UNDONE)
            mountTrackerPanel(root, bridge, makeHost())
            await settle()

            undoButton().click()
            await settle()

            expect(undoText()).toContain('3 entries restored, 1 book deleted')
        })

        it('shows anything it could not undo, in red', async () => {
            // A partial undo is where silence is worst: the books are between
            // two states and this line is the only thing that says so.
            const { bridge, setUndoResult } = makeBridge({ 'chat-1': MEMO })
            setUndoResult({
                at: new Date().toISOString(),
                summary: 'Undone: 1 entry restored.',
                undone: true,
                problems: ['"Vell_Events" no longer exists, so its entries were not restored'],
            })
            mountTrackerPanel(root, bridge, makeHost())
            await settle()

            undoButton().click()
            await settle()

            expect(undoText()).toContain('no longer exists')
            expect(undoNote()?.className).toContain('lh-agent-tools-note--error')
        })

        it('clears the pass report, which describes a pass that no longer stands', async () => {
            const { bridge, setAgentResult, setUndoResult } = makeBridge({ 'chat-1': MEMO })
            setAgentResult(RESULT)
            setUndoResult(UNDONE)
            mountTrackerPanel(root, bridge, makeHost())
            await settle()

            runButton().click()
            await settle()
            expect(lines().join(' ')).toContain('Vell_NPC::4')

            undoButton().click()
            await settle()

            expect(lines()).toEqual([])
        })

        it('leaves the report alone when there was nothing to undo', async () => {
            const { bridge, setAgentResult, setUndoResult } = makeBridge({ 'chat-1': MEMO })
            setAgentResult(RESULT)
            setUndoResult({
                at: new Date().toISOString(),
                summary: 'No agent pass has been recorded for this chat, so there is nothing to undo.',
                undone: false,
                problems: [],
            })
            mountTrackerPanel(root, bridge, makeHost())
            await settle()

            runButton().click()
            await settle()

            undoButton().click()
            await settle()

            expect(lines().join(' ')).toContain('Vell_NPC::4')
            expect(undoText()).toContain('nothing to undo')
        })
    })
})


describe('naming a campaign', () => {
    const field = () => root.querySelector('[data-lh-field="campaign"] input') as HTMLInputElement
    const hint = () => root.querySelector('[data-lh-field="campaign"] .lh-agent-campaign-hint')?.textContent ?? ''

    it('names an unnamed campaign after the card and the clock (51), once, and says so', async () => {
        // The first live pass made a book called
        // `854ec108_1090_4ea2_abbd_034a852835ee_Journey`. Correct, unique, and
        // unreadable — 9k put a name box on screen, and 51 fills it.
        const { bridge, campaignNames, campaignNameCalls } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, { ...makeHost(), getActiveChat: () => ({ chatId: 'chat-1', characterId: 'narrator-7' }) })
        await settle()

        expect(campaignNameCalls).toEqual([{ chatId: 'chat-1', characterId: 'narrator-7' }])
        expect(campaignNames()).toEqual({ 'chat-1': 'narr_261011_1432' })
        expect(field().value).toBe('narr_261011_1432')
        expect(hint()).toBe('Named after the card and the clock. New books will be named narr_261011_1432_NPC, narr_261011_1432_LOC and so on; type another name to change that.')
        // A name typed over it is the user's, with the plain hint.
        field().value = 'Vellmoor'
        field().dispatchEvent(new Event('change'))
        await settle()
        expect(hint()).toBe('New books will be named Vellmoor_NPC, Vellmoor_LOC and so on.')
        expect(campaignNameCalls).toHaveLength(1)
    })

    it('leaves the chat-named hint, and asks once, when the backend cannot name; a cleared name stays cleared', async () => {
        const { bridge, campaignNameCalls, setCampaignNameError } = makeBridge({ 'chat-1': MEMO })
        setCampaignNameError('This build cannot name campaigns.')
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(field().value).toBe('')
        expect(hint()).toContain('named after the chat: chat_1_NPC')
        expect(hint()).toContain('Give it a name')
        expect(campaignNameCalls).toEqual([{ chatId: 'chat-1' }])
        expect(warn).toHaveBeenCalled()
        warn.mockRestore()
        // A named chat is not asked at all; a name cleared by hand is not minted over.
        const named = makeBridge({ 'chat-1': MEMO })
        named.setCampaignNames({ 'chat-1': 'Vellmoor' })
        root.replaceChildren()
        mountTrackerPanel(root, named.bridge, makeHost())
        await settle()
        expect(named.campaignNameCalls).toEqual([])
        field().value = ''
        field().dispatchEvent(new Event('change'))
        await settle()
        expect(named.campaignNameCalls).toEqual([])
        expect(hint()).toContain('named after the chat')
    })

    it('asks again on the next chat event, not on a redraw, when no card was known (51-bis)', async () => {
        // The first live try: every new chat came out `Chat_…`, because the
        // host's view of the active chat has no card for a chat just made.
        let narrator: string | null = null
        const { bridge, campaignNames, campaignNameCalls } = makeBridge({ 'chat-1': MEMO })
        const panel = mountTrackerPanel(root, bridge, { ...makeHost(), getActiveChat: () => ({ chatId: 'chat-1', characterId: narrator }) })
        await settle()

        expect(campaignNameCalls).toEqual([{ chatId: 'chat-1' }])
        expect(campaignNames()).toEqual({})
        expect(field().value).toBe('')
        expect(hint()).toContain('named after the chat: chat_1_NPC')
        // The answer's own redraw did not ask again: one call, not a loop.
        await settle()
        expect(campaignNameCalls).toHaveLength(1)
        // A chat event asks again, and the card is still unknown.
        await panel.refresh()
        await settle()
        expect(campaignNameCalls).toEqual([{ chatId: 'chat-1' }, { chatId: 'chat-1' }])
        expect(hint()).toContain('named after the chat')
        // Once the host knows the card, the next event names the campaign.
        narrator = 'narrator-7'
        await panel.refresh()
        await settle()
        expect(campaignNameCalls).toHaveLength(3)
        expect(campaignNames()).toEqual({ 'chat-1': 'narr_261011_1432' })
        expect(field().value).toBe('narr_261011_1432')
        expect(hint()).toContain('Named after the card and the clock')
        // Named, a further event asks nothing more.
        await panel.refresh()
        await settle()
        expect(campaignNameCalls).toHaveLength(3)
    })

    it('saves a name and says what the books will be called', async () => {
        const { bridge, campaignNames } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        field().value = 'Vellmoor'
        field().dispatchEvent(new Event('change'))
        await settle()

        expect(campaignNames()).toEqual({ 'chat-1': 'Vellmoor' })
        expect(hint()).toContain('Vellmoor_NPC')
    })

    it('shows the name the books are really using, sanitized', async () => {
        // What is typed and what a lorebook can be called are not the same, and
        // the hint shows the second so there is no surprise later.
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        field().value = 'Vellmoor: Book II'
        field().dispatchEvent(new Event('change'))
        await settle()

        expect(hint()).toContain('Vellmoor_Book_II_NPC')
    })

    it('goes back to the chat-derived name when the field is cleared', async () => {
        const { bridge, setCampaignNames } = makeBridge({ 'chat-1': MEMO })
        setCampaignNames({ 'chat-1': 'Vellmoor' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        expect(field().value).toBe('Vellmoor')

        field().value = ''
        field().dispatchEvent(new Event('change'))
        await settle()

        expect(hint()).toContain('named after the chat')
    })

    it('shows the name belonging to the chat on screen', async () => {
        const { bridge, setCampaignNames } = makeBridge({ 'chat-1': MEMO, 'chat-2': MEMO })
        setCampaignNames({ 'chat-1': 'Vellmoor', 'chat-2': 'Ashfell' })
        let chatId = 'chat-2'
        const host: TrackerPanelHost = { ...makeHost(), getActiveChat: () => ({ chatId, characterId: null }) }
        mountTrackerPanel(root, bridge, host)
        await settle()

        expect(field().value).toBe('Ashfell')
    })
})


describe('describing one step of a pass', () => {
    it('shows enough of an unreadable reply to diagnose it', () => {
        // The only step whose content is the diagnosis. Two went past live
        // showing eighty characters, which could not distinguish a truncated
        // reply from malformed JSON.
        const reply = `Action: commit({ record: [ { label: "${'x'.repeat(300)}"`
        expect(describeStep({ kind: 'unreadable', reply }).length).toBeGreaterThan(200)
    })

    it('says how much of a listing it is not showing', () => {
        // inspect_book's first line is a header, so the log used to read
        // `"Vell_Characters" has 4 entries:` and then nothing at all — the
        // one place the log could not show what the agent had been given.
        const text = '"Vell_Characters" has 4 entries:\nWrenna\nLissa\nMaren\nBran'
        expect(describeStep({ kind: 'observation', text }))
            .toBe('\u2192 "Vell_Characters" has 4 entries: (+4 more lines)')
    })

    it.each([
        [{ kind: 'tool', name: 'grep_lore', argument: 'Wrenna' }, 'grep_lore(Wrenna)'],
        [{ kind: 'thought', text: 'Looking for Wrenna.' }, 'Looking for Wrenna.'],
        [{ kind: 'observation', text: '2 entries\nand more' }, '\u2192 2 entries (+1 more line)'],
        [{ kind: 'observation', text: 'one line only' }, '\u2192 one line only'],
        [{ kind: 'error', text: 'no such book' }, 'error: no such book'],
    ])('renders %j', (step, expected) => {
        expect(describeStep(step)).toBe(expected)
    })
})


describe('how far back the agent reads', () => {
    const field = () => root.querySelector('[data-lh-field="lookback"] input') as HTMLInputElement
    const hint = () => root.querySelector('[data-lh-field="lookback"] .lh-agent-campaign-hint')?.textContent ?? ''

    it('says the whole chat is read by default', async () => {
        // The maintainer found the agent had missed the first couple of days
        // of a campaign, because it only ever saw the last dozen messages.
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(field().value).toBe('0')
        expect(hint()).toContain('reads the whole chat')
    })

    it('takes a window and says what it means', async () => {
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        field().value = '40'
        field().dispatchEvent(new Event('change'))
        await settle()

        expect(hint()).toContain('last 40 messages')
    })

    it('floors a fraction to a whole number of messages', async () => {
        // Not "the whole chat": 2.5 messages is 2, which is what the store
        // does too. Rounding down is the answer that cannot surprise anyone.
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        field().value = '2.5'
        field().dispatchEvent(new Event('change'))
        await settle()

        expect(hint()).toContain('last 2 messages')
    })

    it.each([['a negative number', '-5'], ['nonsense', 'lots']])(
        'reads %s as the whole chat rather than something surprising',
        async (_label, typed) => {
            const { bridge } = makeBridge({ 'chat-1': MEMO })
            mountTrackerPanel(root, bridge, makeHost())
            await settle()

            field().value = typed
            field().dispatchEvent(new Event('change'))
            await settle()

            expect(hint()).toContain('reads the whole chat')
        },
    )
})


describe('how often the agent runs on its own', () => {
    const field = () => root.querySelector('[data-lh-field="cadence"] input') as HTMLInputElement
    const hint = () => root.querySelector('[data-lh-field="cadence"] .lh-agent-campaign-hint')?.textContent ?? ''

    it('says a pass runs every four replies by default', async () => {
        // The legacy's cadence, and the number the maintainer asked for.
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(field().value).toBe('4')
        expect(hint()).toContain('after every 4 replies')
        expect(hint()).toContain('since the last one')
    })

    it('says plainly what zero means, because zero is the off switch', async () => {
        // A separate checkbox would be a second place to look when the question
        // is "why is this writing to my campaign".
        const { bridge, setRunEvery } = makeBridge({ 'chat-1': MEMO })
        setRunEvery(0)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(hint()).toContain('only runs when you press the button')
    })

    it('stores a new cadence', async () => {
        const { bridge, requests } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        field().value = '8'
        field().dispatchEvent(new Event('change'))
        await settle()

        const patch = requests.filter((r) => r.op === 'prefs.patch').at(-1)
        expect((patch?.params?.patch as Record<string, unknown>)?.agentRunEvery).toBe(8)
        expect(hint()).toContain('after every 8 replies')
    })

    it('reads a negative or nonsense cadence as off, never as every reply', async () => {
        // The failure that costs nothing beats the one that writes every turn.
        const { bridge, requests } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        for (const typed of ['-2', 'soon', '']) {
            field().value = typed
            field().dispatchEvent(new Event('change'))
            await settle()
            const patch = requests.filter((r) => r.op === 'prefs.patch').at(-1)
            expect((patch?.params?.patch as Record<string, unknown>)?.agentRunEvery).toBe(0)
        }
    })

    it('caps a cadence nobody meant', async () => {
        const { bridge, requests } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        field().value = '9999'
        field().dispatchEvent(new Event('change'))
        await settle()

        const patch = requests.filter((r) => r.op === 'prefs.patch').at(-1)
        expect((patch?.params?.patch as Record<string, unknown>)?.agentRunEvery).toBe(50)
    })

    it('says one reply in the singular', async () => {
        const { bridge, setRunEvery } = makeBridge({ 'chat-1': MEMO })
        setRunEvery(1)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(hint()).toContain('after every 1 reply,')
    })
})


describe('saying when the agent ran, and that it is running now', () => {
    const runButton = () =>
        Array.from(root.querySelectorAll('.lh-agent button'))
            .find((b) => /Run the agent/.test(b.textContent ?? '')) as HTMLButtonElement
    const note = () => root.querySelector('.lh-agent-note')?.textContent ?? ''
    /** What the user can actually see: a hidden line says nothing. */
    const live = () => {
        const node = root.querySelector('.lh-agent-running') as HTMLElement | null
        return !node || node.hidden ? '' : node.textContent ?? ''
    }

    const REPORT = (at: string) => ({
        at,
        outcome: 'committed',
        summary: 'The agent asked for 1 new entry. 1 entry written.',
        turnsUsed: 2,
        problems: [],
        steps: [],
    })

    it('dates the report with a wall-clock time', async () => {
        // "It did run, but I went 8 turns before I saw that it had." Without a
        // stamp there is no way to tell which reply a report belongs to.
        pinTheClockToNoon()
        const { bridge, setAgentResult } = makeBridge({ 'chat-1': MEMO })
        setAgentResult(REPORT(new Date(Date.now() - 3 * 60_000).toISOString()))
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        runButton().click()
        await settle()

        expect(note()).toContain('3 minutes ago')
        expect(note()).toMatch(/11:57|Ran 3 minutes ago \(/)
        vi.useRealTimers()
    })

    it('says a pass is running now, before it has finished', async () => {
        // Nobody pressed anything. The only other sign is a report appearing
        // minutes later.
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        emit({ name: 'agent.started', data: { chatId: 'chat-1', at: new Date().toISOString() } })
        await settle()

        expect(live()).toContain('running now')
    })

    it('says not to swipe while it runs', async () => {
        // A swipe mid-pass rolls back a pass that has not finished writing.
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        emit({ name: 'agent.started', data: { chatId: 'chat-1', at: new Date().toISOString() } })
        await settle()

        expect(live()).toContain('not to swipe')
    })

    it('clears the running line when the pass lands', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        emit({ name: 'agent.started', data: { chatId: 'chat-1', at: new Date().toISOString() } })
        await settle()
        emit({ name: 'agent.finished', data: { chatId: 'chat-1', ...REPORT(new Date().toISOString()) } })
        await settle()

        expect(live()).toBe('')
        expect(note()).toContain('1 entry written')
    })

    it('says which of the two the report below is', async () => {
        // Two ages on screen at once. Phase 4a's lesson, in the place that
        // needed it more: this one writes to the campaign.
        const { bridge, setAgentResult, emit } = makeBridge({ 'chat-1': MEMO })
        setAgentResult(REPORT(new Date().toISOString()))
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        runButton().click()
        await settle()
        emit({ name: 'agent.started', data: { chatId: 'chat-1', at: new Date().toISOString() } })
        await settle()

        expect(live()).toContain('Below is the previous one')
    })

    it('does not promise a previous pass when there is none', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        emit({ name: 'agent.started', data: { chatId: 'chat-1', at: new Date().toISOString() } })
        await settle()

        expect(live()).not.toContain('previous')
    })

    it('ignores a pass that started in another chat', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        emit({ name: 'agent.started', data: { chatId: 'chat-2', at: new Date().toISOString() } })
        await settle()

        expect(live()).toBe('')
    })
})


describe('the tracker head (47a)', () => {
    const light = (key: string) => root.querySelector(`.lh-light--${key}`) as HTMLElement
    const state = (key: string) => (['idle', 'running', 'done', 'failed'] as const).find((s) => light(key).classList.contains(`lh-light--${s}`))
    const time = () => root.querySelector('.lh-tracker-head-time')?.textContent ?? ''
    const AGENT = { at: new Date().toISOString(), outcome: 'committed', summary: 'One entry written.', steps: [], turnsUsed: 1, problems: [] }

    it('draws five lights, idle, and says no pass has run yet', async () => {
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(root.querySelectorAll('.lh-tracker-head .lh-light').length).toBe(5)
        for (const key of ['tracker', 'agent', 'world', 'map', 'picture']) expect(state(key)).toBe('idle')
        expect(light('tracker').textContent).toBe('Tracker')
        expect(light('picture').textContent).toBe('Picture')
        expect(light('agent').title).toMatch(/nothing has run in this chat yet/)
        expect(light('picture').title).toBe('The scene picture: nothing has been drawn in this chat yet')
        expect(time()).toBe('no pass yet')
        // The buttons stay on the line.
        expect(root.querySelector('.lh-tracker-head')!.contains(button(root, 'Run tracker now'))).toBe(true)
        expect(root.querySelector('.lh-tracker-head')!.contains(button(root, 'Refresh'))).toBe(true)
    })

    it('turns the tracker light amber while a pass runs, with when it started', async () => {
        pinTheClockToNoon()
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        emit({ name: 'tracker.started', data: { chatId: 'chat-1', at: new Date().toISOString(), trigger: 'reply' } })

        expect(state('tracker')).toBe('running')
        expect(light('tracker').title).toMatch(/running now, since 12:00/)
        expect(time()).toMatch(/^running since 12:00/)
        vi.useRealTimers()
    })

    it('turns it green when the last pass is done, with its time and age', async () => {
        const { bridge, setLastPass } = makeBridge({ 'chat-1': MEMO })
        setLastPass(REPORT())
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(state('tracker')).toBe('done')
        expect(light('tracker').title).toMatch(/the last pass is done/)
        expect(time()).toMatch(/, just now$/)
    })

    it('turns it red when the last pass failed, and says to open the fold', async () => {
        const { bridge, setLastPass } = makeBridge({ 'chat-1': MEMO })
        setLastPass(REPORT({ status: 'failed', reason: 'no connection' }))
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(state('tracker')).toBe('failed')
        expect(light('tracker').title).toMatch(/failed — open the fold/)
    })

    it('lights the picture from the draw events (49-bis): amber with the place while drawing, green done, red failed, another chat ignored, and reset on a chat change', async () => {
        pinTheClockToNoon()
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO, 'chat-2': MEMO })
        let active = 'chat-1'
        const panel = mountTrackerPanel(root, bridge, { ...makeHost(), getActiveChat: () => ({ chatId: active, characterId: null }) })
        await settle()

        emit({ name: 'scene.picture.started', data: { chatId: 'chat-2', path: 'Elsewhere', at: new Date().toISOString() } })
        expect(state('picture')).toBe('idle')
        emit({ name: 'scene.picture.started', data: { chatId: 'chat-1', path: 'Monastery :: Courtyard', at: new Date().toISOString() } })
        expect(state('picture')).toBe('running')
        expect(light('picture').title).toBe('The scene picture: drawing Courtyard now, since 12:00 PM')
        emit({ name: 'scene.picture.finished', data: { chatId: 'chat-1', path: 'Monastery :: Courtyard', leaf: 'Courtyard', at: new Date().toISOString(), trigger: 'change', outcome: 'drawn', provider: 'swarm' } })
        expect(state('picture')).toBe('done')
        expect(light('picture').title).toBe('The scene picture: the last draw is done')
        emit({ name: 'scene.picture.finished', data: { chatId: 'chat-1', path: 'Monastery :: Courtyard', leaf: 'Courtyard', at: new Date().toISOString(), trigger: 'arrival', outcome: 'failed', reason: 'boom', disabled: true } })
        expect(state('picture')).toBe('failed')
        expect(light('picture').title).toBe('The scene picture: the last draw failed — open the Scene fold for why')
        // The light belongs to the chat it was drawn in.
        active = 'chat-2'
        await panel.refresh()
        await settle()
        expect(state('picture')).toBe('idle')
        vi.useRealTimers()
    })

    it('lights the picture from a library photo\'s draw too (60-bis): amber with the card\'s name, green done, red naming the library, a chatless draw shown, and reset on a chat change', async () => {
        pinTheClockToNoon()
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO, 'chat-2': MEMO })
        let active = 'chat-1'
        const panel = mountTrackerPanel(root, bridge, { ...makeHost(), getActiveChat: () => ({ chatId: active, characterId: null }) })
        await settle()

        emit({ name: 'library.photo.started', data: { chatId: 'chat-2', name: 'Elsewhere', at: new Date().toISOString() } })
        expect(state('picture')).toBe('idle')
        // No chat named: the library is the install's, so the light shows wherever the panel is.
        emit({ name: 'library.photo.started', data: { name: 'Kestrel', at: new Date().toISOString() } })
        expect(state('picture')).toBe('running')
        expect(light('picture').title).toBe('The scene picture: drawing the photo of Kestrel now, since 12:00 PM')
        emit({ name: 'library.photo.finished', data: { name: 'Kestrel', at: new Date().toISOString(), outcome: 'drawn' } })
        expect(state('picture')).toBe('done')
        expect(light('picture').title).toBe('The scene picture: the last draw is done')
        emit({ name: 'library.photo.finished', data: { chatId: 'chat-1', name: 'Kestrel', at: new Date(Date.now() + 1000).toISOString(), outcome: 'failed', reason: 'boom' } })
        expect(state('picture')).toBe('failed')
        expect(light('picture').title).toBe('The scene picture: the last draw failed — open the NPC library for why')
        // A scene draw after it is the newer: its words.
        emit({ name: 'scene.picture.finished', data: { chatId: 'chat-1', path: 'Monastery :: Courtyard', leaf: 'Courtyard', at: new Date(Date.now() + 2000).toISOString(), trigger: 'arrival', outcome: 'failed', reason: 'boom' } })
        expect(light('picture').title).toBe('The scene picture: the last draw failed — open the Scene fold for why')
        active = 'chat-2'
        await panel.refresh()
        await settle()
        expect(state('picture')).toBe('idle')
        vi.useRealTimers()
    })

    it('lights the agent from its own events', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        emit({ name: 'agent.started', data: { chatId: 'chat-1', at: new Date().toISOString() } })
        expect(state('agent')).toBe('running')
        emit({ name: 'agent.finished', data: { chatId: 'chat-1', ...AGENT } })
        expect(state('agent')).toBe('done')
        emit({ name: 'agent.finished', data: { chatId: 'chat-1', ...AGENT, outcome: 'failed', summary: 'no connection' } })
        expect(state('agent')).toBe('failed')
        // The tracker's light is its own.
        expect(state('tracker')).toBe('idle')
    })

    it('lights the world from its events', async () => {
        const { bridge, emit, setWorldStatus } = makeBridge({ 'chat-1': MEMO })
        setWorldStatus({
            enabled: true, intervalHours: 24, locationsPerReport: 3, keepActive: 1, lookback: 20, prefix: 'Vell', worldBookName: 'Vell_World', lastFiredPeriodLabel: '', nextDueLabel: 'Day 3, 09:00 AM', currentTimeLabel: 'Day 2, 09:00 AM', activeReports: [],
            skeletonBookName: 'Vell_Skeleton', skeletonCounts: { factions: 0, locations: 0, conflicts: 0 }, skeletonSource: '',
            skeleton: { factions: 4, locations: 4, conflicts: 3, systemPrompt: '', useLorebooks: false, lorebookOnly: false, lorebookFilter: '', useExisting: true },
        })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        emit({ name: 'world.started', data: { chatId: 'chat-1', at: new Date().toISOString(), trigger: 'automatic' } })
        expect(state('world')).toBe('running')
        emit({ name: 'world.finished', data: { chatId: 'chat-1', status: 'written', at: new Date().toISOString(), trigger: 'automatic', periodLabel: 'Day 2' } })
        expect(state('world')).toBe('done')
    })

    it('lights the map for any of its three passes', async () => {
        const { bridge, emit, setMapStatus } = makeBridge({ 'chat-1': MEMO })
        setMapStatus({ enabled: true, currentLocation: '', sites: [], activeSiteRoot: '', mentionedSiteRoots: [], canonChars: 0, syncedAt: 't', architect: { toolRegistered: true, opener: 'tool', lookback: 12, systemPrompt: '' }, updater: { enabled: true, runEvery: 1, lookback: 4, systemPrompt: '', running: false }, evolution: { enabled: true, intervalHours: 12, onSiteIntervalHours: 1, onSiteIntervalMinutes: 0, onSitePreset: 'dynamic', scope: 'all', count: 1, randomize: true, selectedRoots: '', worldReportLookback: 5, storyLookback: 20, connectionId: '', systemPrompt: '', compressEnabled: true, compressThreshold: 10000, narratorCommitTokens: 2000, running: false, currentTime: '09:00 AM, Day 5', lastFired: '09:00 AM, Day 4', nextDue: '09:00 PM, Day 4', sites: [] } })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        emit({ name: 'map.updater.started', data: { chatId: 'chat-1', site: 'Abbey Undercroft', at: new Date().toISOString() } })
        expect(state('map')).toBe('running')
        emit({ name: 'map.updater.finished', data: { chatId: 'chat-1', status: 'failed', at: new Date().toISOString(), site: 'Abbey Undercroft', trigger: 'reply', reason: 'no connection' } })
        expect(state('map')).toBe('failed')
        emit({ name: 'map.evolution.started', data: { chatId: 'chat-1', sites: ['Abbey Undercroft'], at: new Date().toISOString() } })
        expect(state('map')).toBe('running')
        emit({ name: 'map.evolution.finished', data: { chatId: 'chat-1', status: 'applied', at: new Date(Date.now() + 1000).toISOString(), trigger: 'manual', sites: [] } })
        // The newest of the three passes decides.
        expect(state('map')).toBe('done')
    })

    // The fold of 47a is gone since 78d (the maintainer's ask): the foot is Multihog's.
    it('has no fold under the head: the report is under the terminal\'s State Tracker tab, the bar behind the footer\'s 💬, the mirrored rows gone', async () => {
        const { bridge, setLastPass } = makeBridge({ 'chat-1': MEMO })
        setLastPass(REPORT())
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(root.querySelector('details.lh-tracker-fold')).toBeNull()
        expect(root.querySelector('[data-lh-field="terminal-history-state_tracker"] .lh-tracker-report')).not.toBeNull()
        expect(root.querySelector('[data-lh-field="terminal-history-state_tracker"] [data-lh-field="tracker-report-history"]')).not.toBeNull()
        for (const field of ['tracker-model', 'tracker-window', 'tracker-cadence']) expect(root.querySelector(`[data-lh-field="${field}"]`), field).toBeNull()
        const bar = root.querySelector('[data-lh-field="tracker-direct"]') as HTMLElement
        expect(bar.hidden).toBe(true)
        expect(bar.classList.contains('lh-direct--compact')).toBe(true)
        expect(bar.querySelector('.lh-direct-hint')).toBeNull()
        expect(button(bar, '▶').title).toBe('Send instruction')
        expect(bar.querySelector('.lh-direct-lookback')!.textContent).toBe('Lookback:')
        // The bar, the Change Log and the footer in that order at the foot.
        const order = Array.from(root.children).map((node) => node.className.split(' ')[0])
        expect(order.slice(-3)).toEqual(['lh-change-log', 'lh-direct', 'lh-tracker-footer'])
    })
})

describe('the foot after Multihog\'s (78d)', () => {
    const footer = () => root.querySelector('[data-lh-field="tracker-footer"]') as HTMLElement
    const field = (name: string) => root.querySelector(`[data-lh-field="${name}"]`) as HTMLElement
    const log = () => field('tracker-change-log-content').innerHTML

    it('prints the tokens of the memo on screen, and the 💬 opens the bar, which closes as the instruction goes', async () => {
        const { bridge, requests, setSnapshots } = makeBridge({ 'chat-1': MEMO })
        setSnapshots([{ messageId: 'm2', memo: MEMO, at: new Date().toISOString(), messageNumber: 2 }, { messageId: 'm1', memo: 'x'.repeat(262), at: new Date().toISOString(), messageNumber: 1 }])
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(Array.from(footer().children).map((n) => n.className.split(' ')[0]))
            .toEqual(['lh-tracker-history', 'lh-foot-clock', 'lh-tracker-footer-place', 'lh-tracker-footer-utility', 'lh-footer-icon-btn'])
        expect(field('tracker-footer-tokens').textContent).toBe(`~${Math.round(MEMO.length / 2.62)} tokens`)
        expect(field('tracker-change-log-toggle').textContent).toBe('δ')
        expect(field('tracker-memo-clear').textContent).toBe('CLEAR')
        expect(field('tracker-prompt-toggle').textContent).toBe('💬')
        expect(field('tracker-prompt-toggle').title).toBe('Toggle direct prompt')

        // The stepped state's size.
        ;(footer().querySelector('button[aria-label="Older state"]') as HTMLElement).click()
        await settle()
        expect(field('tracker-footer-tokens').textContent).toBe('~100 tokens')
        ;(footer().querySelector('button[aria-label="Newer state"]') as HTMLElement).click()
        await settle()

        const bar = field('tracker-direct')
        expect(bar.hidden).toBe(true)
        field('tracker-prompt-toggle').click()
        expect(bar.hidden).toBe(false)
        expect(field('tracker-prompt-toggle').classList.contains('lh-footer-icon-btn--active')).toBe(true)
        expect(document.activeElement).toBe(bar.querySelector('textarea'))
        ;(bar.querySelector('textarea') as HTMLTextAreaElement).value = 'Bench Oswin.'
        button(bar, '▶').click()
        await settle()
        expect(requests.find((r) => r.op === 'tracker.instruct')?.params).toMatchObject({ instruction: 'Bench Oswin.' })
        expect(bar.hidden).toBe(true)
        expect(field('tracker-prompt-toggle').classList.contains('lh-footer-icon-btn--active')).toBe(false)
        field('tracker-prompt-toggle').click()
        expect(bar.hidden).toBe(false)
        field('tracker-prompt-toggle').click()
        expect(bar.hidden).toBe(true)
    })

    it('δ opens the Change Log: the last pass\'s diff live, the diff between states when stepped, the history\'s after a reload, ✕ clearing it', async () => {
        const made = makeBridge({ 'chat-1': MEMO })
        const OLDER = '[TIME]\n08:41 AM, Day 1\n[/TIME]'
        made.setSnapshots([
            { messageId: 'm2', memo: MEMO, at: new Date().toISOString(), messageNumber: 2 },
            { messageId: 'm1', memo: OLDER, at: new Date().toISOString(), messageNumber: 1 },
        ])
        mountTrackerPanel(root, made.bridge, makeHost())
        await settle()

        const box = field('tracker-change-log')
        expect(box.hidden).toBe(true)
        expect(box.querySelector('.lh-change-log-title')!.textContent).toBe('Change Log')
        field('tracker-change-log-toggle').click()
        expect(box.hidden).toBe(false)
        expect(field('tracker-change-log-toggle').classList.contains('lh-footer-btn--active')).toBe(true)
        await settle()
        // After a reload: read off the history, the state before the live one against the live one.
        expect(log()).toContain('<div class="lh-delta-removed">- 08:41 AM, Day 1</div>')
        expect(log()).toContain('<div class="lh-delta-added">+ ')

        // Stepped to the oldest state: nothing before it, so the initial memo.
        ;(footer().querySelector('button[aria-label="Older state"]') as HTMLElement).click()
        await settle()
        expect(log()).toBe('<span class="lh-delta-added">+ (initial memo created)</span>')
        ;(footer().querySelector('button[aria-label="Newer state"]') as HTMLElement).click()
        await settle()

        // A pass lands: the diff it made, live.
        made.emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: `${MEMO}\n[NOTES]\nA new line.\n[/NOTES]`, report: REPORT() } })
        expect(log()).toBe('<div class="lh-delta-added">+ [NOTES]</div><div class="lh-delta-added">+ A new line.</div><div class="lh-delta-added">+ [/NOTES]</div>')

        // ✕ empties it until the next pass.
        field('tracker-change-log-clear').click()
        expect(log()).toBe('<span class="lh-delta-empty">Log cleared.</span>')
        made.emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: MEMO, report: REPORT() } })
        expect(log()).toBe('<div class="lh-delta-removed">- [NOTES]</div><div class="lh-delta-removed">- A new line.</div><div class="lh-delta-removed">- [/NOTES]</div>')

        field('tracker-change-log-toggle').click()
        expect(box.hidden).toBe(true)
        expect(field('tracker-change-log-toggle').classList.contains('lh-footer-btn--active')).toBe(false)
    })

    it('CLEAR wipes the memo after the host\'s confirm and keeps the history, so ← can bring a state back', async () => {
        const made = makeBridge({ 'chat-1': MEMO })
        made.setSnapshots([{ messageId: 'm1', memo: MEMO, at: new Date().toISOString(), messageNumber: 1 }])
        const asked: Array<Record<string, unknown>> = []
        let answer = false
        const host = { ...makeHost(), ui: { showConfirm: async (options: Record<string, unknown>) => { asked.push(options); return { confirmed: answer } } } } as unknown as TrackerPanelHost
        mountTrackerPanel(root, made.bridge, host)
        await settle()

        field('tracker-memo-clear').click()
        await settle()
        expect(asked.length).toBe(1)
        expect(asked[0]!.title).toBe('Clear the tracker?')
        expect(asked[0]!.confirmLabel).toBe('Clear')
        expect(made.requests.some((r) => r.op === 'tracker.setMemo')).toBe(false)

        answer = true
        field('tracker-change-log-toggle').click()
        field('tracker-memo-clear').click()
        await settle()
        const set = made.requests.find((r) => r.op === 'tracker.setMemo')
        expect(set?.params).toMatchObject({ chatId: 'chat-1', memo: '' })
        expect(made.requests.filter((r) => r.op === 'tracker.setMemo')).toHaveLength(1)
        expect(field('tracker-footer-tokens').textContent).toBe('~0 tokens')
        expect(log()).toBe('<span class="lh-delta-empty">Log cleared.</span>')
        expect(root.querySelector('.lh-tracker-status')!.textContent).toBe('The memo is cleared.')
        // The history stands: the wiped state can be stepped back to.
        ;(footer().querySelector('button[aria-label="Older state"]') as HTMLElement).click()
        await settle()
        expect(root.querySelector('.lh-tracker-history-label')!.textContent).not.toBe('[ LIVE ]')
    })
})

describe('the two roots (47b)', () => {
    it('keeps the classic order in one root when no second root is given', async () => {
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        const order = Array.from(root.children).map((node) => node.className.split(' ')[0])
        // The folds after the cards, the world before the map, the raw box last but for the foot.
        expect(order.indexOf('lh-tracker-cards')).toBeLessThan(order.indexOf('lh-agent'))
        expect(order.indexOf('lh-world')).toBeLessThan(order.indexOf('lh-maps'))
        expect(order[order.length - 5]).toBe('lh-tracker-raw')
        // The XP bar's foot (74f), the Change Log and the instruction bar (78d), then the tracker's footer (78b) with the stepper, the clock and the place.
        expect(order.slice(-4)).toEqual(['lh-bottom-xp', 'lh-change-log', 'lh-direct', 'lh-tracker-footer'])
        expect(root.querySelector('.lh-tracker-footer .lh-tracker-history')).not.toBeNull()
        expect(root.querySelector('.lh-tracker-footer .lh-foot-clock')).not.toBeNull()
    })

    it('puts the head in the widget\'s strip when one is given (57), and the status line under it in the body', async () => {
        const rest = document.createElement('div')
        const scene = document.createElement('div')
        const head = document.createElement('div')
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost(), {}, { rest, scene, head })
        await settle()

        expect(head.querySelector('.lh-tracker-head')).not.toBeNull()
        expect(head.classList.contains('lh-tracker')).toBe(true)
        expect(root.querySelector('.lh-tracker-head')).toBeNull()
        expect(head.querySelectorAll('.lh-light').length).toBe(5)
        expect(head.contains(button(head, 'Run tracker now'))).toBe(true)
        expect(root.querySelector('.lh-tracker-status')).not.toBeNull()
        expect(root.querySelector('[data-lh-field="tracker-direct"]')).not.toBeNull()
        expect(head.querySelector('.lh-tracker-status')).toBeNull()
    })

    it('puts the play parts in the first root and the rest in the second', async () => {
        const rest = document.createElement('div')
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost(), {}, { rest })
        await settle()

        // Play: the head, the fold, the stepper, the cards, then the three panes (78a) — the Lorebook Agent
        // with the world drawer in it, the Campaign Records with the relationships, Visuals/Map with the scene.
        for (const cls of ['.lh-tracker-head', '[data-lh-field="tracker-direct"]', '.lh-change-log', '.lh-tracker-history', '.lh-tracker-cards', '.lh-agent', '.lh-world', '[data-lh-field="agent-campaign"]', '.lh-campaign-records', '.lh-maps', '.lh-scene']) {
            expect(root.querySelector(cls), cls).not.toBeNull()
            expect(rest.querySelector(cls), cls).toBeNull()
        }
        // The rest: the creator folds (the Player Card, the library and the creator stay here on a host without a modal, 78b),
        // the skeleton when no World progression category is given, the raw box.
        for (const cls of ['.lh-start', '.lh-instant', '.lh-creator', '.lh-player-card', '.lh-library', '.lh-skeleton', '.lh-tracker-raw']) {
            expect(rest.querySelector(cls), cls).not.toBeNull()
            expect(root.querySelector(cls), cls).toBeNull()
        }
        expect(rest.classList.contains('lh-tracker')).toBe(true)
        // The three panes in Multihog's order, after the cards.
        const order = Array.from(root.children).map((node) => node.className.split(' ')[0])
        expect(order.indexOf('lh-tracker-cards')).toBeLessThan(order.indexOf('lh-agent'))
        expect(order.indexOf('lh-agent')).toBeLessThan(order.indexOf('lh-campaign-records'))
        expect(order.indexOf('lh-campaign-records')).toBeLessThan(order.indexOf('lh-maps'))
    })

    it('still works as one panel across the two roots: a pass lights the head and redraws the cards', async () => {
        const rest = document.createElement('div')
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        const panel = mountTrackerPanel(root, bridge, makeHost(), {}, { rest })
        await settle()

        emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: '[XP]\n1/2\n[/XP]', report: REPORT() } })
        expect(root.querySelector('.lh-light--tracker')!.classList.contains('lh-light--done')).toBe(true)
        expect(root.querySelector('.lh-tracker-cards')!.textContent).toContain('1/2')

        panel.destroy()
        expect(root.children.length).toBe(0)
        expect(rest.children.length).toBe(0)
    })
})

describe('the scene widget (47c)', () => {
    it('puts the Lorebook Agent, the Campaign Records and Visuals/Map in the third root as three tabs (78a), Visuals/Map shown first', async () => {
        const rest = document.createElement('div')
        const scene = document.createElement('div')
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost(), {}, { rest, scene })
        await settle()

        expect(root.querySelector('.lh-maps')).toBeNull()
        expect(root.querySelector('.lh-tracker-cards')).not.toBeNull()
        const strip = scene.querySelector('.lh-widget-tabs') as HTMLElement
        expect(Array.from(strip.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Lorebook Agent', 'Campaign Records', 'Visuals/Map'])
        const agent = scene.querySelector('.lh-agent') as HTMLDetailsElement
        const records = scene.querySelector('.lh-campaign-records') as HTMLDetailsElement
        const visuals = scene.querySelector('.lh-maps') as HTMLDetailsElement
        expect(visuals.hidden).toBe(false)
        expect(visuals.open).toBe(true)
        // The scene fold is the tab's body, opened with it; the relationships sit under the records browser.
        expect((visuals.querySelector('.lh-scene') as HTMLDetailsElement).open).toBe(true)
        expect(records.querySelector('.lh-records')).not.toBeNull()
        expect(agent.hidden).toBe(true)
        expect(records.hidden).toBe(true)
        expect(strip.querySelector('[data-lh-tab="visuals"]')!.classList.contains('lh-widget-tab--active')).toBe(true)
        // The Lorebook Agent tab holds Multihog's drawers in its order, the world's among them.
        expect(Array.from(agent.querySelectorAll('.lh-agent-body > details')).map((d) => d.getAttribute('data-lh-field'))).toEqual(['agent-quick', 'agent-campaign', 'agent-repertoire', 'terminal', 'agent-evolution', 'agent-world', 'agent-active-keys'])
        // The campaign's name and its books are the Campaign drawer's, after Quick Settings (78b).
        expect(rest.querySelector('.lh-agent')).toBeNull()
        expect(agent.querySelector('[data-lh-field="agent-campaign"] [data-lh-field="campaign"]')).not.toBeNull()
        expect(agent.querySelector('[data-lh-field="agent-campaign"] [data-lh-field="books"]')).not.toBeNull()
    })

    it('switches the box to the tab pressed, holding that pane open and opening the browser in it', async () => {
        const rest = document.createElement('div')
        const scene = document.createElement('div')
        const { bridge, bookOps } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost(), {}, { rest, scene })
        await settle()

        expect(bookOps.filter((o) => o[0] === 'records')).toEqual([])
        ;(scene.querySelector('[data-lh-tab="records"]') as HTMLButtonElement).click()
        await settle()
        const visuals = scene.querySelector('.lh-maps') as HTMLDetailsElement
        const records = scene.querySelector('.lh-campaign-records') as HTMLDetailsElement
        expect(visuals.hidden).toBe(true)
        expect(records.hidden).toBe(false)
        expect(records.open).toBe(true)
        expect((records.querySelector('.lh-records') as HTMLDetailsElement).open).toBe(true)
        expect(bookOps.filter((o) => o[0] === 'records')).toEqual([['records', { chatId: 'chat-1' }]])
        expect(scene.querySelector('[data-lh-tab="records"]')!.getAttribute('aria-selected')).toBe('true')
        expect(scene.querySelector('[data-lh-tab="visuals"]')!.getAttribute('aria-selected')).toBe('false')
    })

    it('clears the third root on destroy too', async () => {
        const rest = document.createElement('div')
        const scene = document.createElement('div')
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        const panel = mountTrackerPanel(root, bridge, makeHost(), {}, { rest, scene })
        await settle()
        panel.destroy()
        expect(scene.children.length).toBe(0)
    })
})

describe('the clock (Phase 47)', () => {
    it('has no clock offset row: the panel runs in the browser, whose clock is the user\'s', async () => {
        // Phase 9v's nudge answered a staging build whose panel ran on UTC.
        // That build is gone, and the maintainer asked for the row to go with
        // it (2026-10-09). A stored offset is ignored, not applied.
        const { bridge, requests } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(root.querySelector('.lh-tracker-clock')).toBeNull()
        expect(root.textContent).not.toContain('Clock offset')
        expect(requests.some((r) => 'clockOffsetMinutes' in ((r.params?.patch as Record<string, unknown>) ?? {}))).toBe(false)
    })
})

describe('stepping back through the tracker\'s past', () => {
    const row = () => root.querySelector('.lh-tracker-history') as HTMLElement
    const label = () => root.querySelector('.lh-tracker-history-label')?.textContent ?? ''
    const button = (text: RegExp) =>
        Array.from(root.querySelectorAll('.lh-tracker-history button'))
            .find((b) => text.test(b.textContent ?? '')) as HTMLButtonElement
    const older = () => root.querySelector('button[aria-label="Older state"]') as HTMLButtonElement
    const newer = () => root.querySelector('button[aria-label="Newer state"]') as HTMLButtonElement
    const restore = () => button(/Restore|Replace/)
    const titles = () =>
        Array.from(root.querySelectorAll('.rt-section-title')).map((n) => n.textContent)
    const button2 = (text: RegExp) =>
        Array.from(root.querySelectorAll('.lh-tracker-raw button'))
            .find((b) => text.test(b.textContent ?? '')) as HTMLButtonElement

    /**
     * Newest first, as the store keeps them.
     *
     * `m83` is the state after the newest tracked turn, which is the live memo
     * — so the walk starts at `m82`, and the maintainer's example of stepping
     * back three views lands on `m80`.
     */
    const PAST = [
        // The newest snapshot holds the live memo, which is the normal case:
        // the pass that wrote it is the pass that set the memo. It is therefore
        // skipped, and the walk starts at m82.
        { messageId: 'm83', memo: MEMO, at: new Date().toISOString(), messageNumber: 83 },
        { messageId: 'm82', memo: '[TIME]\n06:15 AM, Day 4\n[/TIME]', at: new Date().toISOString(), messageNumber: 82 },
        { messageId: 'm81', memo: '[PARTY]\nBrenna: 9/12 HP\n[/PARTY]', at: new Date().toISOString(), messageNumber: 81 },
        { messageId: 'm80', memo: '[XP]\n((XPBAR)) 100/1000\n[/XP]', at: new Date().toISOString(), messageNumber: 80 },
    ]

    it('hides itself when the chat has no history', async () => {
        // A chat before its first tracked turn. An empty stepper is a control
        // that cannot do anything.
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        // The row stays, as Multihog's footer does (78b); the arrows go.
        expect(row().hidden).toBe(false)
        expect(older().hidden).toBe(true)
        expect(newer().hidden).toBe(true)
    })

    it('starts on the live state', async () => {
        const { bridge, setSnapshots } = makeBridge({ 'chat-1': MEMO })
        setSnapshots(PAST)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(row().hidden).toBe(false)
        expect(label()).toBe('[ LIVE ]')
        expect(newer().disabled).toBe(true)
        expect(restore().hidden).toBe(true)
    })

    it('changes something on the very first press', async () => {
        // "Hitting the back button once seems the same as leaving it as-is."
        // The newest snapshot is the state already on screen, so the walk has
        // to start one further back or the first press does nothing.
        const { bridge, setSnapshots } = makeBridge({ 'chat-1': MEMO })
        setSnapshots(PAST)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        expect(titles()).toEqual(['TIME', 'WAYSTONE'])

        older().click()
        await settle()

        expect(label()).toContain('1 turn back')
        expect(titles()).not.toEqual(['TIME', 'WAYSTONE'])
    })

    it('steps back through the stored states and draws each one', async () => {
        // The maintainer's example: step back three views to before the
        // messages that were deleted.
        const { bridge, setSnapshots } = makeBridge({ 'chat-1': MEMO })
        setSnapshots(PAST)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        older().click()
        await settle()
        expect(label()).toContain('1 turn back')
        expect(titles()).toEqual(['TIME'])

        older().click()
        await settle()
        expect(titles()).toEqual(['PARTY'])

        older().click()
        await settle()
        expect(label()).toContain('3 turns back')
        expect(titles()).toEqual(['XP'])
    })

    it('names the message, because the clock times cannot be matched by eye', async () => {
        // A pass runs after the reply it reads and takes a while, so its stamp
        // is routinely a minute past the message's own.
        const { bridge, setSnapshots } = makeBridge({ 'chat-1': MEMO })
        setSnapshots(PAST)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        older().click()
        await settle()

        expect(label()).toContain('#82')
    })

    it('does not skip a state when the newest snapshot is not what is live', async () => {
        // The bug: the skip assumed the newest snapshot is always the live
        // memo. When it is not — a pass for the newest turn not yet recorded,
        // a hand edit, a restore — the skip ate a real state, and the walk
        // jumped from 31 straight past 29 to 27.
        const { bridge, setSnapshots } = makeBridge({ 'chat-1': MEMO })
        setSnapshots([
            { messageId: 'm29', memo: '[XP]\n((XPBAR)) 900/1000\n[/XP]', at: new Date().toISOString(), messageNumber: 29 },
            { messageId: 'm27', memo: '[PARTY]\nBrenna: 9/12 HP\n[/PARTY]', at: new Date().toISOString(), messageNumber: 27 },
        ])
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        older().click()
        await settle()

        expect(label()).toContain('#29')
        expect(label()).toContain('1 turn back')
        expect(titles()).toEqual(['XP'])
    })

    it('stops at the oldest state it kept', async () => {
        const { bridge, setSnapshots } = makeBridge({ 'chat-1': MEMO })
        setSnapshots(PAST)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        for (let i = 0; i < 8; i++) { older().click(); await settle() }

        expect(label()).toContain('3 turns back')
        expect(older().disabled).toBe(true)
    })

    it('comes back to live, and shows the live memo again', async () => {
        const { bridge, setSnapshots } = makeBridge({ 'chat-1': MEMO })
        setSnapshots(PAST)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        older().click()
        await settle()
        newer().click()
        await settle()

        expect(label()).toBe('[ LIVE ]')
        expect(titles()).toEqual(['TIME', 'WAYSTONE'])
    })

    it('writes nothing while it is only being looked at', async () => {
        // Stepping is a cursor. Nothing is written until a restore.
        const { bridge, setSnapshots, requests } = makeBridge({ 'chat-1': MEMO })
        setSnapshots(PAST)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        older().click()
        await settle()
        older().click()
        await settle()

        expect(requests.some((r) => r.op === 'tracker.restore' || r.op === 'tracker.setMemo')).toBe(false)
    })

    it('shuts the raw editor while a past state is on screen', async () => {
        // The raw box always holds the live memo. Editing one while reading the
        // other is how a memo gets lost.
        const { bridge, setSnapshots } = makeBridge({ 'chat-1': MEMO })
        setSnapshots(PAST)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        const box = root.querySelector('.lh-tracker-raw textarea') as HTMLTextAreaElement
        const save = button2(/Save memo/)
        expect(box.readOnly).toBe(false)

        older().click()
        await settle()

        expect(box.readOnly).toBe(true)
        expect(save.disabled).toBe(true)
        expect((root.querySelector('.lh-tracker-raw-note') as HTMLElement).hidden).toBe(false)

        newer().click()
        await settle()

        expect(box.readOnly).toBe(false)
        expect(save.disabled).toBe(false)
        expect((root.querySelector('.lh-tracker-raw-note') as HTMLElement).hidden).toBe(true)
    })

    it('says what it will replace before replacing it', async () => {
        // A restore is a write over live state, so it takes two presses and
        // names the state it is about to overwrite — the same shape as
        // clearing the quest archive.
        const { bridge, setSnapshots, requests } = makeBridge({ 'chat-1': MEMO })
        setSnapshots(PAST)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        older().click()
        await settle()
        restore().click()
        await settle()

        expect(requests.some((r) => r.op === 'tracker.restore')).toBe(false)
        expect(root.querySelector('.lh-tracker-status')?.textContent).toContain('replaces the live tracker')
        expect(root.querySelector('.lh-tracker-status')?.textContent).toContain('1 turn back')
    })

    it('restores on the second press, and returns to live', async () => {
        const { bridge, setSnapshots, requests } = makeBridge({ 'chat-1': MEMO })
        setSnapshots(PAST)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        older().click()
        await settle()
        restore().click()
        await settle()
        restore().click()
        await settle()

        const sent = requests.find((r) => r.op === 'tracker.restore')
        expect(sent?.params?.messageId).toBe('m82')
        expect(label()).toBe('[ LIVE ]')
        expect(titles()).toEqual(['TIME'])
    })

    it('names the message, never the position', async () => {
        // The history is capped and every tracked turn pushes an entry in, so
        // an index read a minute ago can point somewhere else by the time the
        // button is pressed.
        const { bridge, setSnapshots, requests } = makeBridge({ 'chat-1': MEMO })
        setSnapshots(PAST)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        older().click(); await settle()
        older().click(); await settle()
        restore().click(); await settle()
        restore().click(); await settle()

        const sent = requests.find((r) => r.op === 'tracker.restore')
        expect(sent?.params?.messageId).toBe('m81')
        expect(sent?.params).not.toHaveProperty('index')
    })

    it('says so when the state has aged out of the history', async () => {
        const { bridge, setSnapshots, setRestoreError } = makeBridge({ 'chat-1': MEMO })
        setSnapshots(PAST)
        setRestoreError('That state is no longer in this chat\u2019s history, so nothing was changed.')
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        older().click(); await settle()
        restore().click(); await settle()
        restore().click(); await settle()

        // A restore that was refused is a failed action, not an ambient note.
        expect(root.querySelector('.lh-problem-text')?.textContent).toContain('no longer in this chat')
    })

    it('returns to live when a pass lands while stepping', async () => {
        // A pass shifts every position by one. Leaving the cursor where it was
        // would renumber the turn on screen without saying so.
        const { bridge, setSnapshots, emit } = makeBridge({ 'chat-1': MEMO })
        setSnapshots(PAST)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        older().click()
        await settle()

        emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: '[XP]\n1/2\n[/XP]' } })
        await settle()

        expect(label()).toBe('[ LIVE ]')
        expect(root.querySelector('.lh-tracker-status')?.textContent).toContain('back on the live state')
    })

    it('re-reads the stored states before the first step away from live', async () => {
        // Passes land while the panel is open, and stepping into a stale list
        // shows the wrong turn.
        const { bridge, setSnapshots, requests } = makeBridge({ 'chat-1': MEMO })
        setSnapshots(PAST)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const before = requests.filter((r) => r.op === 'tracker.history').length

        older().click()
        await settle()

        expect(requests.filter((r) => r.op === 'tracker.history').length).toBeGreaterThan(before)
    })
})

describe('how long the agent may spend', () => {
    const field = () => root.querySelector('[data-lh-field="turns"] input') as HTMLInputElement
    const hint = () => root.querySelector('[data-lh-field="turns"] .lh-agent-campaign-hint')?.textContent ?? ''

    it('shows the budget in the unit that costs the user time', async () => {
        // Turns are sequential model calls, and that is the whole reason this
        // control exists — a pass on a tiny campaign was still ten round trips.
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(field().value).toBe('5')
        expect(hint()).toContain('Up to 5 model calls')
        expect(hint()).toContain('one after another')
    })

    it('stores a smaller budget', async () => {
        const { bridge, maxTurns } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        field().value = '3'
        field().dispatchEvent(new Event('change'))
        await settle()

        expect(maxTurns()).toBe(3)
        expect(hint()).toContain('Up to 3 model calls')
    })

    it('shows what the backend settled on, not what was typed', async () => {
        // Zero is not "off" here — it would make every pass report that it ran
        // out without committing, which reads as a broken agent.
        const { bridge, maxTurns } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        field().value = '0'
        field().dispatchEvent(new Event('change'))
        await settle()

        expect(maxTurns()).toBe(1)
        expect(field().value).toBe('1')
        expect(hint()).toContain('Up to 1 model call per pass')
    })
})

describe('stopping a pass from the panel', () => {
    const trackerStop = () =>
        root.querySelector('.lh-tracker-report-running .lh-button--stop') as HTMLButtonElement | null
    const agentStop = () => {
        const notice = root.querySelector('.lh-agent-running') as HTMLElement | null
        if (!notice || notice.hidden) return null
        return notice.querySelector('.lh-button--stop') as HTMLButtonElement | null
    }

    it('offers no Stop button while nothing is running', async () => {
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(trackerStop()).toBeNull()
        expect(agentStop()).toBeNull()
    })

    it('shows a Stop button once the agent announces a pass', async () => {
        // The bug the maintainer found: the button existed, and the notice that
        // carries it was only ever raised by the automatic pass — so pressing
        // "Run the agent now" gave you no way to stop it.
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        emit({ name: 'agent.started', data: { chatId: 'chat-1', at: new Date().toISOString() } })
        await settle()

        expect(agentStop()).not.toBeNull()
    })

    it('shows a Stop button once the tracker announces a pass', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        emit({ name: 'tracker.started', data: { chatId: 'chat-1', at: new Date().toISOString(), trigger: 'manual' } })
        await settle()

        expect(trackerStop()).not.toBeNull()
    })

    it('asks the backend to stop the right one', async () => {
        const { bridge, emit, requests } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        emit({ name: 'agent.started', data: { chatId: 'chat-1', at: new Date().toISOString() } })
        await settle()

        agentStop()!.click()
        await settle()

        const ops = requests.map((r) => r.op)
        expect(ops).toContain('agent.cancel')
        expect(ops).not.toContain('tracker.cancel')
    })

    it('leaves the notice up until the pass reports its own end', async () => {
        // Clearing optimistically would show an idle panel while a pass that
        // had already passed the point of interruption carried on writing.
        const { bridge, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        emit({ name: 'agent.started', data: { chatId: 'chat-1', at: new Date().toISOString() } })
        await settle()
        agentStop()!.click()
        await settle()

        expect(agentStop()).not.toBeNull()

        emit({
            name: 'agent.finished',
            data: { chatId: 'chat-1', at: new Date().toISOString(), outcome: 'cancelled', summary: 'Stopped.', steps: [], turnsUsed: 1, problems: [] },
        })
        await settle()

        expect(agentStop()).toBeNull()
    })
})

describe('choosing which model runs each job', () => {
    const CONNECTIONS = [
        { id: 'fast', name: 'Fast little one', model: 'haiku', isDefault: false },
        { id: 'big', name: 'The storyteller', model: 'opus', isDefault: true },
    ]
    const picker = (field: string) =>
        root.querySelector(`[data-lh-field="${field}"] select`) as HTMLSelectElement
    const hint = (field: string) =>
        root.querySelector(`[data-lh-field="${field}"] .lh-conn-hint`)?.textContent ?? ''

    it('offers both jobs their own picker', async () => {
        // Two settings because they are two jobs: one extraction call against a
        // rigid format, versus several turns of tool-calling.
        const { bridge, setConnections } = makeBridge({ 'chat-1': MEMO })
        setConnections(CONNECTIONS)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        // The tracker's picker is the Connections & models category's alone since 78d.
        expect(picker('tracker-model')).toBeNull()
        expect(picker('agent-model')).not.toBeNull()
    })

    it('lists every connection, with the model beside the name', async () => {
        // "Fast" tells you nothing on its own six months later.
        const { bridge, setConnections } = makeBridge({ 'chat-1': MEMO })
        setConnections(CONNECTIONS)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        const labels = Array.from(picker('agent-model').options).map((o) => o.textContent)
        expect(labels[0]).toContain('The narrator’s connection')
        expect(labels).toContain('Fast little one — haiku')
        expect(labels).toContain('The storyteller — opus')
    })

    it('defaults to the host\'s choice, so an install that never picks is unchanged', async () => {
        const { bridge, setConnections } = makeBridge({ 'chat-1': MEMO })
        setConnections(CONNECTIONS)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(picker('agent-model').value).toBe('')
    })

    it('says a connection is gone rather than quietly falling back to the default', async () => {
        // The user picked it. Silently resetting would make a deleted
        // connection look like a working one.
        const { bridge, setConnections, setPrefs } = makeBridge({ 'chat-1': MEMO })
        setConnections(CONNECTIONS)
        setPrefs({ agentConnectionId: 'deleted-yesterday' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(picker('agent-model').value).toBe('deleted-yesterday')
        expect(Array.from(picker('agent-model').options).map((o) => o.textContent).join(' '))
            .toContain('no longer listed')
    })

    it('says so when the host has no connections to offer', async () => {
        const { bridge, setConnections } = makeBridge({ 'chat-1': MEMO })
        setConnections([])
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        expect(hint('agent-model')).toContain('No connection profiles found')
    })
})

describe('the agent picker saves to its own setting', () => {
    it('stores the agent choice under agentConnectionId, not the tracker one', async () => {
        // Two jobs, two settings. A picker that wrote to the wrong key would
        // silently move the tracker onto the model chosen for the agent.
        const { bridge, setConnections, requests } = makeBridge({ 'chat-1': MEMO })
        setConnections([{ id: 'fast', name: 'Fast little one', model: 'haiku', isDefault: false }])
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        const select = root.querySelector('[data-lh-field="agent-model"] select') as HTMLSelectElement
        select.value = 'fast'
        select.dispatchEvent(new Event('change'))
        await settle()

        const patch = (requests.filter((r) => r.op === 'prefs.patch').at(-1)?.params?.patch ?? {}) as Record<string, unknown>
        expect(patch.agentConnectionId).toBe('fast')
        expect('trackerConnectionId' in patch).toBe(false)
    })
})

describe('the character creator fold (Phase 35)', () => {
    const fold = () => root.querySelector('.lh-creator') as HTMLDetailsElement
    const control = (name: string) => fold().querySelector(`[data-lh-field="creator-${name}-input"]`) as HTMLInputElement & HTMLSelectElement
    const button = (text: string) => Array.from(fold().querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement

    it('sits under the cards, folded on a chat with no memo (84), fills from the preferences, and writes the sheet with the draft', async () => {
        const { bridge, setCreatorPrefs, generated, worldPatches } = makeBridge({ 'chat-1': '' })
        setCreatorPrefs({ creatorDraft: { name: 'Odran', genre: 'scifi', class: 'Netrunner' }, creatorLevel: 5, creatorGearTier: 'standard', creatorCombatScalingGuide: true, creatorInitialDate: 'Day 1', creatorInitialTime: '08:00 AM', creatorConnectionId: '', creatorPresets: [{ id: 'p1', name: 'Hacker', data: { name: 'Vex' } }] })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        expect(fold()).not.toBeNull()
        // The creator heads the starting area (69), Instant Action after it, the area after the archive actions.
        expect(fold().parentElement!.classList.contains('lh-start-body')).toBe(true)
        expect(fold().closest('.lh-start')).not.toBeNull()
        expect(fold().nextElementSibling!.classList.contains('lh-instant')).toBe(true)
        expect(fold().closest('.lh-start')!.previousElementSibling!.classList.contains('lh-tracker-archive-actions')).toBe(true)
        // Folded as it ships since 84; the starting area around it is open (69).
        expect(fold().open).toBe(false)
        expect((fold().closest('.lh-start') as HTMLDetailsElement).open).toBe(true)
        expect(control('name').value).toBe('Odran')
        expect(control('class').value).toBe('Netrunner')
        expect(Array.from((fold().querySelector('[data-lh-field="creator-preset"]') as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(['\u2014 Select a preset \u2014', 'Hacker'])
        // The connection list reaches the fold.
        const connection = fold().querySelector('[data-lh-field="creator-connection"] select') as HTMLSelectElement
        expect(connection.options[0]!.textContent).toBe('The tracker\u2019s connection')
        // Generate sends the draft for this chat, and the note says what came back.
        button('Generate the character').click()
        await settle()
        expect(generated()).toEqual([{ chatId: 'chat-1', draft: expect.objectContaining({ name: 'Odran', genre: 'scifi', class: 'Netrunner', level: 5 }), playerCard: false, persona: true, cardWords: 150 }])
        expect(fold().querySelector('.lh-creator-note')!.textContent).toContain('Wrote the sheet for Robin Vale: CHARACTER.')
        // A change is kept as the draft through the preferences.
        control('name').value = 'Mara'
        control('name').dispatchEvent(new Event('change'))
        await settle()
        expect(worldPatches().at(-1)).toEqual({ creatorDraft: expect.objectContaining({ name: 'Mara' }) })
    })

    it('stays closed on a chat that has a memo, and says so when the backend refuses', async () => {
        const { bridge, setCreatorAnswer } = makeBridge({ 'chat-1': MEMO })
        setCreatorAnswer({ status: 'failed', at: 't', name: '', reason: 'Character generation failed \u2014 State Model returned no character sheet' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        expect(fold().open).toBe(false)
        button('Generate the character').click()
        await settle()
        const note = fold().querySelector('.lh-creator-note')!
        expect(note.textContent).toContain('The sheet was not written: Character generation failed')
        expect(note.classList.contains('lh-world-note--error')).toBe(true)
    })
})

describe('the Instant Action fold (Phase 35a)', () => {
    const fold = () => root.querySelector('.lh-instant') as HTMLDetailsElement
    const button = (text: string) => Array.from(fold().querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement
    const statusLine = () => fold().querySelector('.lh-instant-status')!.textContent ?? ''

    it('sits just under the creator, folded on a chat with no memo (84), reads the starter switch from the preferences, and begins with the genre, name, setup and switch for this chat', async () => {
        const { bridge, setCreatorPrefs, begun, worldPatches } = makeBridge({ 'chat-1': '' })
        setCreatorPrefs({ creatorSendStarter: false })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        expect(fold()).not.toBeNull()
        // Inside the starting area since 69, after the creator.
        expect(fold().previousElementSibling!.classList.contains('lh-creator')).toBe(true)
        expect(fold().open).toBe(false)
        expect(statusLine()).toBe('Select a genre to begin')
        const send = fold().querySelector('[data-lh-field="instant-send-starter-input"]') as HTMLInputElement
        expect(send.checked).toBe(false)
        expect(button('\u26a1 Begin Instant Action').disabled).toBe(true)
        button('\ud83d\ude80 Sci-Fi').click()
        expect(statusLine()).toBe('Sci-Fi selected \u2014 name optional')
        const name = fold().querySelector('[data-lh-field="instant-name-input"]') as HTMLInputElement
        name.value = 'Vex'
        name.dispatchEvent(new Event('input'))
        const setup = fold().querySelector('[data-lh-field="instant-setup-input"]') as HTMLTextAreaElement
        setup.value = 'A salvage crew.'
        button('\u26a1 Begin Instant Action').click()
        expect(statusLine()).toBe('Creating the character (Sci-Fi \u00b7 custom setup \u00b7 Vex)\u2026')
        await settle()
        expect(begun()).toEqual([{ chatId: 'chat-1', genre: 'scifi', name: 'Vex', setup: 'A salvage crew.', sendStarter: false, cardWords: 150 }])
        expect(worldPatches()).toContainEqual({ creatorGenre: 'scifi' })
        expect(statusLine()).toContain('Ready \u2014 Robin Vale (Ranger, level 4). The sheet is in the tracker’s cards. The adventure has begun.')
    })

    it('stays closed on a chat that has a memo, and says so in red when the run fails', async () => {
        const { bridge, setInstantAnswer } = makeBridge({ 'chat-1': MEMO })
        setInstantAnswer({ status: 'failed', at: 't', genre: 'horror', className: 'Occultist', level: 2, name: '', started: false, reason: 'Character generation failed \u2014 State Model returned no character sheet' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        expect(fold().open).toBe(false)
        button('\ud83d\udc7b Horror').click()
        button('\u26a1 Begin Instant Action').click()
        await settle()
        expect(statusLine()).toContain('Instant Action failed: Character generation failed \u2014 State Model returned no character sheet. Rolled Occultist, level 2.')
        expect(fold().querySelector('.lh-instant-status')!.classList.contains('lh-world-note--error')).toBe(true)
    })
})

describe('the other ways to begin (Phase 35c)', () => {
    const fold = () => root.querySelector('.lh-ways') as HTMLDetailsElement
    const button = (text: string) => Array.from(fold().querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement

    it('sits between the creator and the Player Card, reads the shared preferences, begins for the chat, and reads the card again after', async () => {
        const { bridge, setCreatorPrefs, waysOps, cardOps, worldPatches } = makeBridge({ 'chat-1': '' })
        setCreatorPrefs({ creatorLevel: 'none', creatorGenre: 'horror', creatorGearTier: 'low', creatorCombatScalingGuide: false, creatorPlayerCard: true, creatorPersona: false, creatorCardWords: 300, creatorWaysDraft: { name: 'Mara', instructions: 'A nun' } })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        expect(fold()).not.toBeNull()
        // First in the Other Ways to Begin drawer (83), the card import after it.
        expect(fold().parentElement!.classList.contains('lh-start-drawer-body')).toBe(true)
        expect(fold().previousElementSibling).toBeNull()
        expect(fold().nextElementSibling!.classList.contains('lh-import')).toBe(true)
        expect(fold().open).toBe(false)
        expect((fold().querySelector('[data-lh-field="ways-genre-input"]') as HTMLSelectElement).value).toBe('horror')
        expect((fold().querySelector('[data-lh-field="ways-name-input"]') as HTMLInputElement).value).toBe('Mara')
        const gets = cardOps().filter(([op]) => op === 'get').length
        button('\ud83c\udfad From the active persona').click()
        await settle()
        expect(waysOps()).toEqual([{ chatId: 'chat-1', way: 'persona', name: 'Mara', instructions: 'A nun', level: 'none', genre: 'horror', gearTier: 'low', combatScalingGuide: false, playerCard: true, persona: false, cardWords: 300 }])
        expect(fold().querySelector('.lh-ways-note')!.textContent).toContain('Wrote the sheet for Robin Vale from the persona \u201cZ\u201d: CHARACTER.')
        expect(cardOps().filter(([op]) => op === 'get').length).toBe(gets + 1)
        // A change to the genre here is the creator's genre preference, as the legacy's drawer sets onboardingGenre.
        const genre = fold().querySelector('[data-lh-field="ways-genre-input"]') as HTMLSelectElement
        genre.value = 'scifi'
        genre.dispatchEvent(new Event('change'))
        await settle()
        expect(worldPatches().at(-1)).toEqual({ creatorGenre: 'scifi' })
    })
})

describe('the Player Card fold (Phase 35b)', () => {
    const fold = () => root.querySelector('.lh-player-card') as HTMLDetailsElement
    const button = (text: string) => Array.from(fold().querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement
    const statusLine = () => fold().querySelector('.lh-card-status')!.textContent ?? ''
    const CARD = { name: 'Robin Vale', bio: 'Body: Short.\nPersonality: Wry.', wordCount: 150, at: 't' }

    it('sits under the creator, reads the card for the chat, and sends the write, persona and remove ops for it', async () => {
        const { bridge, setCardView, cardOps, worldPatches } = makeBridge({ 'chat-1': MEMO })
        setCardView({ card: CARD, persona: null, personasAvailable: true, activePersona: 'Z' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        expect(fold()).not.toBeNull()
        // The other ways (35c) sit between the creator and the card.
        // Under the starting area (69), which ends with the narrator's configuration (70) after the import.
        expect(fold().previousElementSibling!.classList.contains('lh-start')).toBe(true)
        const startBody = fold().previousElementSibling!.querySelector('.lh-start-body')!
        expect(startBody.lastElementChild!.classList.contains('lh-start-conn')).toBe(true)
        expect(startBody.querySelector('.lh-narrator')!.previousElementSibling!.classList.contains('lh-start-drawer')).toBe(true)
        expect(startBody.querySelector('.lh-start-drawer-body')!.lastElementChild!.classList.contains('lh-import')).toBe(true)
        expect(fold().open).toBe(false)
        expect(cardOps()).toEqual([['get', { chatId: 'chat-1' }]])
        expect(statusLine()).toContain('Robin Vale’s card: 2 sections')
        expect(fold().querySelector('.lh-card-persona')!.textContent).toContain('The active persona is “Z”')
        button('Use as persona').click()
        await settle()
        expect(cardOps().some(([op, params]) => op === 'persona' && (params as Record<string, unknown>).chatId === 'chat-1')).toBe(true)
        button('Remove').click()
        await settle()
        expect(cardOps().some(([op]) => op === 'remove')).toBe(true)
        expect(statusLine()).toContain('No Player Card')
        button('Write the card').click()
        await settle()
        const write = cardOps().find(([op]) => op === 'write')!
        expect(write[1]).toEqual({ chatId: 'chat-1', name: '', words: 150 })
        expect(fold().querySelector('.lh-card-note')!.textContent).toContain('Wrote the Player Card for Robin Vale')
        // The words are a preference shared with the creator and Instant Action.
        const words = fold().querySelector('[data-lh-field="card-words-input"]') as HTMLSelectElement
        words.value = '300'
        words.dispatchEvent(new Event('change'))
        await settle()
        expect(worldPatches().at(-1)).toEqual({ creatorCardWords: 300 })
    })

    it('reads the card again after the creator or Instant Action wrote one', async () => {
        const { bridge, cardOps } = makeBridge({ 'chat-1': '' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const gets = () => cardOps().filter(([op]) => op === 'get').length
        const before = gets()
        expect(before).toBe(1)
        const creator = root.querySelector('.lh-creator') as HTMLElement
        ;(Array.from(creator.querySelectorAll('button')).find((b) => b.textContent === 'Generate the character') as HTMLButtonElement).click()
        await settle()
        expect(gets()).toBe(before + 1)
        const instant = root.querySelector('.lh-instant') as HTMLElement
        ;(Array.from(instant.querySelectorAll('button')).find((b) => b.textContent === '\u2694\ufe0f Fantasy') as HTMLButtonElement).click()
        ;(Array.from(instant.querySelectorAll('button')).find((b) => b.textContent === '\u26a1 Begin Instant Action') as HTMLButtonElement).click()
        await settle()
        expect(gets()).toBe(before + 2)
    })
})

describe('the maps fold (Phase 34)', () => {
    const fold = () => root.querySelector('.lh-maps') as HTMLElement
    const statusLine = () => fold().querySelector('.lh-maps-status')!.textContent ?? ''
    const sitesLine = () => fold().querySelector('.lh-maps-sites')!.textContent ?? ''
    const note = () => fold().querySelector('.lh-maps-note')!.textContent ?? ''
    const refresh = () => Array.from(fold().querySelectorAll('button')).find((b) => b.textContent === 'Re-read the maps') as HTMLButtonElement
    // The evolution's rows are the Lorebook Agent tab's since 78a, so the fields are found from the root.
    const field = (name: string) => root.querySelector(`[data-lh-field="${name}"] input, [data-lh-field="${name}"]`) as HTMLInputElement
    const EVOLUTION = { enabled: true, intervalHours: 12, onSiteIntervalHours: 1, onSiteIntervalMinutes: 0, onSitePreset: 'dynamic', scope: 'all', count: 1, randomize: true, selectedRoots: '', worldReportLookback: 5, storyLookback: 20, connectionId: '', systemPrompt: '', compressEnabled: true, compressThreshold: 10000, narratorCommitTokens: 2000, running: false, currentTime: '09:00 AM, Day 5', lastFired: '09:00 AM, Day 4', nextDue: '09:00 PM, Day 4', sites: [] }
    const BASE = { enabled: true, currentLocation: '', sites: [], activeSiteRoot: '', mentionedSiteRoots: [], canonChars: 0, syncedAt: 't', architect: { toolRegistered: true, opener: 'tool', lookback: 12, systemPrompt: '' }, updater: { enabled: true, runEvery: 1, lookback: 4, systemPrompt: '', running: false }, evolution: EVOLUTION }

    it('sits under the world fold and says when nothing is mapped and the party\'s place is unknown', async () => {
        const { bridge, requests } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        // The third pane since 78a, after the Campaign Records; the world drawer is the Lorebook Agent's.
        expect(fold().previousElementSibling).toBe(root.querySelector('.lh-campaign-records'))
        expect(fold().querySelector('summary')!.textContent).toBe('Visuals/Map')
        expect(statusLine()).toBe('The last reply had no Location footer, so the party’s place is unknown.')
        expect(sitesLine()).toBe('No site has a map yet.')
        expect(note()).toBe('')
        expect(requests.filter((r) => r.op === 'map.get')).toHaveLength(1)
    })

    it('draws the party\'s site under the fold (34d): the picture arrives after the status, Reveal all is a preference, the picker asks for a site, and every reload redraws it', async () => {
        const { bridge, emit, setMapStatus, setMapView, worldPatches, views, requests } = makeBridge({ 'chat-1': MEMO })
        setMapStatus({ ...BASE, currentLocation: 'Abbey Undercroft, Cellar Landing', sites: [{ siteRoot: 'Abbey Undercroft', kind: 'DUNGEON', entryId: 'Vell_LOC::1' }, { siteRoot: 'Morrowfen', kind: 'SETTLEMENT', entryId: 'Vell_LOC::3' }], activeSiteRoot: 'Abbey Undercroft' })
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" class="rt-dungeon-graph-svg"><g class="rt-dungeon-graph-node rt-dungeon-graph-node-visited rt-dungeon-graph-node-current rt-dungeon-graph-node-revealed" data-area-id="landing" data-area-path="Abbey Undercroft :: Cellar Landing"><rect></rect><text>Cellar Landing</text></g></svg>'
        setMapView({ siteRoot: 'Abbey Undercroft', kind: 'DUNGEON', partyInside: true, rooms: 3, svg, entries: '<section class="rt-dungeon-map-area"><div class="rt-dungeon-map-area-head"><strong>Cellar Landing</strong></div></section>', history: '<div class="lh-map-history-empty">No Map Evolution pass has been recorded for this site.</div>', revealAll: false, currentLocation: 'Abbey Undercroft, Cellar Landing', sites: [{ siteRoot: 'Abbey Undercroft', kind: 'DUNGEON' }, { siteRoot: 'Morrowfen', kind: 'SETTLEMENT' }],
            named: { Morrowfen: { siteRoot: 'Morrowfen', kind: 'SETTLEMENT', partyInside: false, rooms: 1, svg: svg.replace('Cellar Landing', 'The Docks'), entries: '<section class="rt-dungeon-map-area"><div class="rt-dungeon-map-area-head"><strong>The Docks</strong></div></section>', history: '' } } })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const picture = () => fold().querySelector('.lh-map-picture') as HTMLElement
        const line = () => picture().querySelector('.lh-map-line')!.textContent ?? ''
        // The picture sits in the scene's site-map slot, under its header and the updater's folded direct box (78a), and is asked for after the status.
        expect(picture().previousElementSibling!.getAttribute('data-lh-field')).toBe('site-map-direct')
        expect(picture().parentElement!.getAttribute('data-lh-field')).toBe('scene-site-map')
        expect(requests.map((r) => r.op).filter((op) => op.startsWith('map.'))).toEqual(['map.get', 'map.view'])
        expect(views()).toEqual([''])
        expect(line()).toBe('Abbey Undercroft (DUNGEON): the party is in it. 3 rooms drawn, as the party knows it.')
        expect(picture().querySelector('.lh-map-scroll svg .rt-dungeon-graph-node-current text')!.textContent).toBe('Cellar Landing')
        expect(picture().querySelector('.lh-map-entries-body strong')!.textContent).toBe('Cellar Landing')
        expect(picture().querySelector('.lh-map-history-body')!.textContent).toContain('No Map Evolution pass')
        // Reveal all is a preference: the switch patches it and the fold reloads, picture included.
        const reveal = field('map-reveal-all')
        expect(reveal.checked).toBe(false)
        reveal.checked = true
        reveal.dispatchEvent(new Event('change'))
        await settle()
        expect(worldPatches().at(-1)).toEqual({ mapRevealAll: true })
        expect(requests.map((r) => r.op).filter((op) => op.startsWith('map.'))).toEqual(['map.get', 'map.view', 'map.get', 'map.view'])
        // The picker asks for the site by name, and the party's room is not marked in a site they are not in.
        const select = picture().querySelector('.lh-map-site') as HTMLSelectElement
        expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'Abbey Undercroft', 'Morrowfen'])
        select.value = 'Morrowfen'
        select.dispatchEvent(new Event('change'))
        await settle()
        expect(views().at(-1)).toBe('Morrowfen')
        expect(line()).toBe('Morrowfen (SETTLEMENT): the party is elsewhere. 1 room drawn, as the party knows it.')
        expect(picture().querySelector('.lh-map-entries-body strong')!.textContent).toBe('The Docks')
        expect((picture().querySelector('.lh-map-history') as HTMLElement).hidden).toBe(true)
        // Re-read the maps keeps the pick; a finished pass reloads the picture too.
        refresh().click()
        await settle()
        expect(views().at(-1)).toBe('Morrowfen')
        const before = views().length
        emit({ name: 'map.evolution.finished', data: { chatId: 'chat-1', status: 'noop', at: 't', trigger: 'interval', sites: [] } })
        await settle()
        expect(views().length).toBe(before + 1)
    })

    it('says when the party is outside every map, when a site cannot be drawn, and draws nothing without a chat (34d)', async () => {
        const { bridge, setMapStatus, setMapView } = makeBridge({ 'chat-1': MEMO })
        setMapStatus({ ...BASE, currentLocation: 'Glassmere', sites: [{ siteRoot: 'Morrowfen', kind: 'SETTLEMENT', entryId: 'x' }] })
        setMapView({ siteRoot: '', kind: '', partyInside: false, rooms: 0, svg: '', entries: '', history: '', revealAll: true, currentLocation: 'Glassmere', sites: [{ siteRoot: 'Morrowfen', kind: 'SETTLEMENT' }] })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const picture = () => fold().querySelector('.lh-map-picture') as HTMLElement
        expect(picture().querySelector('.lh-map-line')!.textContent).toBe('The party is outside every mapped site. Pick one above to look at it.')
        expect((picture().querySelector('.lh-map-scroll') as HTMLElement).hidden).toBe(true)
        expect(field('map-reveal-all').checked).toBe(true)
        setMapView({ fail: 'PERMISSION_DENIED: world_books' })
        refresh().click()
        await settle()
        expect(picture().querySelector('.lh-map-line')!.textContent).toBe('The map could not be drawn: PERMISSION_DENIED: world_books')
        expect(picture().querySelector('.lh-map-line')!.classList.contains('lh-world-note--error')).toBe(true)
        // Without a chat the picture is empty and the picker hidden.
        const { bridge: idle } = makeBridge({})
        root.replaceChildren()
        mountTrackerPanel(root, idle, makeHost(null))
        await settle()
        expect(fold().querySelector('.lh-map-line')!.textContent).toBe('')
        expect(((fold().querySelector('.lh-map-site') as HTMLElement).parentElement as HTMLElement).hidden).toBe(true)
    })

    it('names the mapped sites, the party\'s place, the site they are inside and the ones they named', async () => {
        const { bridge, setMapStatus } = makeBridge({ 'chat-1': MEMO })
        setMapStatus({ ...BASE, currentLocation: 'Abbey Undercroft, Cellar Landing', sites: [{ siteRoot: 'Abbey Undercroft', kind: 'DUNGEON', entryId: 'Vell_LOC::1' }, { siteRoot: 'Morrowfen', kind: 'SETTLEMENT', entryId: 'Vell_LOC::3' }], activeSiteRoot: 'Abbey Undercroft', mentionedSiteRoots: ['Morrowfen'], canonChars: 2400 })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        expect(fold().querySelector('summary')!.textContent).toBe('Visuals/Map · 2 mapped · inside')
        expect(statusLine()).toBe('The party is at Abbey Undercroft, Cellar Landing. They are inside Abbey Undercroft; its map is in the prompt as GM canon. Named this turn: Morrowfen.')
        expect(sitesLine()).toBe('Mapped: Abbey Undercroft (DUNGEON), Morrowfen (SETTLEMENT).')
    })

    it('says when the party is outside every map, when the section is off, and when the books could not be read', async () => {
        const { bridge, setMapStatus, requests } = makeBridge({ 'chat-1': MEMO })
        setMapStatus({ ...BASE, enabled: false, currentLocation: 'Glassmere', sites: [{ siteRoot: 'Morrowfen', kind: 'SETTLEMENT', entryId: 'x' }], problem: 'PERMISSION_DENIED: world_books' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        expect(statusLine()).toContain('mapping section is off')
        expect(statusLine()).toContain('They are not inside a mapped site.')
        expect(note()).toBe('The maps could not be read: PERMISSION_DENIED: world_books')
        expect(fold().querySelector('.lh-world-note--error')).not.toBeNull()
        // The button asks again, and the answer redraws.
        setMapStatus({ ...BASE, currentLocation: 'Morrowfen, The Docks', sites: [{ siteRoot: 'Morrowfen', kind: 'SETTLEMENT', entryId: 'x' }], activeSiteRoot: 'Morrowfen' })
        refresh().click()
        await settle()
        expect(requests.filter((r) => r.op === 'map.get')).toHaveLength(2)
        expect(statusLine()).toContain('inside Morrowfen')
        expect(note()).toBe('')
    })

    it('says the architect\'s tool is registered, shows its two settings, and stores each under its own key (34a)', async () => {
        const { bridge, setMapStatus, worldPatches } = makeBridge({ 'chat-1': MEMO })
        setMapStatus({ ...BASE, architect: { toolRegistered: true, opener: 'tool', lookback: 12, systemPrompt: 'Place sparsely.' } })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const line = () => fold().querySelector('.lh-maps-architect')!.textContent ?? ''
        expect(line()).toContain('the CreateAreaMap tool is registered')
        // The opener's, the lookback's and the prompt's rows are the Persistent maps category's alone since 78b (63c mirrors them).
        expect(root.querySelector('[data-lh-field="map-architect-opener"]')).toBeNull()
        expect(root.querySelector('[data-lh-field="map-architect-lookback"]')).toBeNull()
        expect(root.querySelector('[data-lh-field="map-architect-prompt"]')).toBeNull()
        expect(worldPatches()).toEqual([])
        // Text mode says so on the line, whatever the tool's standing.
        setMapStatus({ ...BASE, architect: { toolRegistered: false, opener: 'text', lookback: 12, systemPrompt: 'Place sparsely.' } })
        refresh().click()
        await settle()
        expect(line()).toContain('Map Architect: the text opener.')
        expect(line()).not.toContain('not registered')
        // Not registered, and off with the section, each say so.
        setMapStatus({ ...BASE, architect: { toolRegistered: false, opener: 'tool', lookback: 12, systemPrompt: '' } })
        refresh().click()
        await settle()
        expect(line()).toContain('is not registered')
        setMapStatus({ ...BASE, enabled: false })
        refresh().click()
        await settle()
        expect(line()).toBe('The Map Architect is off with the mapping section.')
    })

    it('says the Map Updater\'s standing, shows its settings, and stores each under its own key (34b)', async () => {
        const { bridge, setMapStatus, worldPatches } = makeBridge({ 'chat-1': MEMO })
        setMapStatus({ ...BASE, updater: { enabled: true, runEvery: 3, lookback: 6, systemPrompt: 'Keep it lean.', running: false } })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const line = () => fold().querySelector('.lh-maps-updater')!.textContent ?? ''
        const button = () => Array.from(fold().querySelectorAll('button')).find((b) => b.textContent === 'Update the map now') as HTMLButtonElement
        expect(line()).toContain('Map Updater: on. It runs after every 3 replies inside a mapped site')
        // Its switch, cadence, lookback and prompt are the Persistent maps category's alone since 78b (63c mirrors them).
        for (const name of ['map-updater-enabled', 'map-updater-run-every', 'map-updater-lookback', 'map-updater-prompt']) expect(root.querySelector(`[data-lh-field="${name}"]`), name).toBeNull()
        expect(button().disabled).toBe(false)
        expect(worldPatches()).toEqual([])
        setMapStatus({ ...BASE, updater: { enabled: true, runEvery: 1, lookback: 6, systemPrompt: '', running: false } })
        refresh().click()
        await settle()
        expect(line()).toContain('after every reply inside a mapped site')
        setMapStatus({ ...BASE, updater: { enabled: false, runEvery: 1, lookback: 6, systemPrompt: '', running: false } })
        refresh().click()
        await settle()
        expect(line()).toContain('Map Updater: off. The map does not change with play')
        setMapStatus({ ...BASE, enabled: false })
        refresh().click()
        await settle()
        expect(line()).toBe('The Map Updater is off with the mapping section.')
        expect(button().disabled).toBe(true)
    })

    it('runs the updater now with the instruction in the box, shows it running, then what it did (34b)', async () => {
        const { bridge, setMapStatus, worldPatches, setMapUpdate, failMapUpdate } = makeBridge({ 'chat-1': MEMO })
        setMapStatus({ ...BASE, currentLocation: 'Abbey Undercroft, Cellar Landing', activeSiteRoot: 'Abbey Undercroft', sites: [{ siteRoot: 'Abbey Undercroft', kind: 'DUNGEON', entryId: 'Vell_LOC::1' }] })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const button = () => Array.from(fold().querySelectorAll('button')).find((b) => b.textContent === 'Update the map now') as HTMLButtonElement
        const live = () => fold().querySelector('.lh-maps-updater-running') as HTMLElement
        const note = () => fold().querySelector('.lh-maps-updater-note')!.textContent ?? ''
        const instruction = field('map-updater-instruction') as unknown as HTMLTextAreaElement
        instruction.value = ' Open the vault door. '
        button().click()
        expect(button().disabled).toBe(true)
        expect(live().hidden).toBe(false)
        expect(live().textContent).toContain('The Map Updater is updating Abbey Undercroft now')
        await settle()
        expect(worldPatches()).toEqual([{ op: 'update', chatId: 'chat-1', instruction: 'Open the vault door.' }])
        expect(live().hidden).toBe(true)
        expect(button().disabled).toBe(false)
        expect(note()).toContain('Updated Abbey Undercroft on your instruction: SET_ASSET pack (1 operation).')
        // Without an instruction, the routine pass; nothing changed, a skip and a failure each say so.
        instruction.value = ''
        setMapUpdate({ status: 'noop', at: new Date().toISOString(), site: 'Abbey Undercroft', trigger: 'manual' })
        button().click()
        await settle()
        expect(worldPatches().at(-1)).toEqual({ op: 'update', chatId: 'chat-1' })
        expect(note()).toContain('Nothing durable changed at Abbey Undercroft on your instruction.')
        setMapUpdate({ status: 'skipped', at: new Date().toISOString(), site: '', trigger: 'manual', reason: 'the party is not inside a mapped site' })
        button().click()
        await settle()
        expect(note()).toContain('The update was skipped: the party is not inside a mapped site.')
        expect(fold().querySelector('.lh-maps-updater-note.lh-world-note--error')).toBeNull()
        failMapUpdate('the request timed out')
        button().click()
        await settle()
        expect(note()).toContain('The update of Abbey Undercroft on your instruction failed: the request timed out.')
        expect(fold().querySelector('.lh-maps-updater-note.lh-world-note--error')).not.toBeNull()
        expect(button().disabled).toBe(false)
    })

    it('shows an update in flight after a reply, then what it did, for this chat only (34b)', async () => {
        const { bridge, setMapStatus, emit } = makeBridge({ 'chat-1': MEMO })
        setMapStatus(BASE)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const live = () => fold().querySelector('.lh-maps-updater-running') as HTMLElement
        const note = () => fold().querySelector('.lh-maps-updater-note')!.textContent ?? ''
        emit({ name: 'map.updater.started', data: { chatId: 'chat-2', site: 'Elsewhere', at: new Date().toISOString(), trigger: 'reply' } })
        await settle()
        expect(live().hidden).toBe(true)
        emit({ name: 'map.updater.started', data: { chatId: 'chat-1', site: 'Abbey Undercroft', at: new Date().toISOString(), trigger: 'reply' } })
        await settle()
        expect(live().hidden).toBe(false)
        expect(live().textContent).toContain('updating Abbey Undercroft now')
        const applied = { status: 'applied', at: new Date().toISOString(), site: 'Abbey Undercroft', trigger: 'reply', summary: 'SET_ASSET pack; ADD_ASSET Odran (CREATURE)', operations: 2, entryId: 'Vell_LOC::1' }
        setMapStatus({ ...BASE, lastUpdater: applied })
        emit({ name: 'map.updater.finished', data: { chatId: 'chat-1', ...applied } })
        await settle()
        expect(live().hidden).toBe(true)
        expect(note()).toContain('Updated Abbey Undercroft: SET_ASSET pack; ADD_ASSET Odran (CREATURE) (2 operations).')
        const exit = { status: 'noop', at: new Date().toISOString(), site: 'Abbey Undercroft', trigger: 'exit' }
        setMapStatus({ ...BASE, lastUpdater: exit })
        emit({ name: 'map.updater.finished', data: { chatId: 'chat-1', ...exit } })
        await settle()
        expect(note()).toContain('Nothing durable changed at Abbey Undercroft on leaving it.')
        const failed = { status: 'failed', at: new Date().toISOString(), site: 'Abbey Undercroft', trigger: 'reply', reason: 'could not apply a valid transaction: ASSET_NOT_FOUND at map.operations[0].asset_id: Use an exact asset ID.' }
        setMapStatus({ ...BASE, lastUpdater: failed })
        emit({ name: 'map.updater.finished', data: { chatId: 'chat-1', ...failed } })
        await settle()
        expect(note()).toContain('The update of Abbey Undercroft failed: could not apply a valid transaction: ASSET_NOT_FOUND')
        expect(fold().querySelector('.lh-maps-updater-note.lh-world-note--error')).not.toBeNull()
        const undone = { status: 'undone', at: new Date().toISOString(), site: 'Abbey Undercroft', trigger: 'reply', reason: 'the reply it followed was replaced' }
        setMapStatus({ ...BASE, lastUpdater: undone })
        refresh().click()
        await settle()
        expect(note()).toContain('The update to Abbey Undercroft was put back: the reply it followed was replaced. The new reply is read with the next update.')
        expect(fold().querySelector('.lh-maps-updater-note.lh-world-note--error')).toBeNull()
        // A pass already running when the fold loads is shown too.
        setMapStatus({ ...BASE, activeSiteRoot: 'Morrowfen', updater: { ...BASE.updater, running: true } })
        refresh().click()
        await settle()
        expect(live().hidden).toBe(false)
        expect(live().textContent).toContain('updating Morrowfen now')
    })

    it('says Map Evolution\'s standing and clocks, shows its settings by scope, and stores each under its own key (34c)', async () => {
        const { bridge, setMapStatus, worldPatches } = makeBridge({ 'chat-1': MEMO })
        setMapStatus({ ...BASE, evolution: { ...EVOLUTION, intervalHours: 6, onSiteIntervalHours: 1, onSiteIntervalMinutes: 30, scope: 'count', count: 2, compressEnabled: false } })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const sub = () => root.querySelector('.lh-evolution') as HTMLDetailsElement
        const line = () => sub().querySelector('.lh-maps-evolution')!.textContent ?? ''
        const button = () => Array.from(sub().querySelectorAll('button')).find((b) => b.textContent === 'Evolve now') as HTMLButtonElement
        expect(sub().querySelector('.lh-agent-drawer-title')!.textContent).toBe('🗺️ Map Evolution')
        expect(sub().querySelector('[data-lh-field="evolution-badge"]')!.textContent).toBe('ON')
        expect(line()).toBe('Map Evolution: on, every 6 in-world hours for a site the party is away from, every 1 hour 30 minutes for the site the party is in. The clock reads 09:00 AM, Day 5; a site last evolved at 09:00 AM, Day 4; the next pass is due at 09:00 PM, Day 4.')
        expect(field('map-evolution-enabled').checked).toBe(true)
        expect(field('map-evolution-interval').value).toBe('6')
        expect(field('map-evolution-on-site-minutes').value).toBe('30')
        expect((sub().querySelector('[data-lh-field="map-evolution-scope"] select') as HTMLSelectElement).value).toBe('count')
        expect(sub().querySelector('[data-lh-field="map-evolution-count"]')!.hasAttribute('hidden')).toBe(false)
        // The sites' row stays whatever the scope since 71d: it carries each site's own hours.
        expect(sub().querySelector('[data-lh-field="map-evolution-selected"]')!.hasAttribute('hidden')).toBe(false)
        // The compression's and the rest of the dials are the Persistent maps category's alone since 78b.
        expect(sub().querySelector('[data-lh-field="map-evolution-compress-threshold"]')).toBeNull()
        expect(button().disabled).toBe(false)
        field('map-evolution-interval').value = '24'
        field('map-evolution-interval').dispatchEvent(new Event('change'))
        await settle()
        expect(line()).toContain('every 24 in-world hours')
        // The story lookback and the connection (45c) are the settings categories' alone since 78b (63 and 63c mirror them).
        expect(root.querySelector('[data-lh-field="map-evolution-story-lookback"]')).toBeNull()
        expect(root.querySelector('[data-lh-field="map-evolution-connection"]')).toBeNull()
        const scope = sub().querySelector('[data-lh-field="map-evolution-scope"] select') as HTMLSelectElement
        scope.value = 'selected'
        scope.dispatchEvent(new Event('change'))
        await settle()
        expect(sub().querySelector('[data-lh-field="map-evolution-count"]')!.hasAttribute('hidden')).toBe(true)
        expect(sub().querySelector('[data-lh-field="map-evolution-selected"]')!.hasAttribute('hidden')).toBe(false)
        // The named sites are the mapped ones, ticked (45c-ter); a chosen site no longer mapped stays listed.
        setMapStatus({ ...BASE, sites: [{ siteRoot: 'Abbey Undercroft', kind: 'DUNGEON', entryId: 'Vell_LOC::1' }, { siteRoot: 'Elmridge', kind: 'SETTLEMENT', entryId: 'Vell_LOC::2' }], evolution: { ...EVOLUTION, scope: 'selected', selectedRoots: 'Old Mill' } })
        refresh().click()
        await settle()
        const boxes = () => Array.from(sub().querySelectorAll('[data-lh-field="map-evolution-selected"] input[type="checkbox"]')) as HTMLInputElement[]
        expect(boxes().map((b) => `${b.value}${b.checked ? '*' : ''}`)).toEqual(['Abbey Undercroft', 'Elmridge', 'Old Mill*'])
        boxes()[0]!.checked = true
        boxes()[0]!.dispatchEvent(new Event('change'))
        await settle()
        expect(worldPatches().at(-1)).toEqual({ mapEvolutionSelectedRoots: 'Abbey Undercroft, Old Mill' })
        boxes()[2]!.checked = false
        boxes()[2]!.dispatchEvent(new Event('change'))
        await settle()
        expect(worldPatches().at(-1)).toEqual({ mapEvolutionSelectedRoots: 'Abbey Undercroft' })
        // The compression and the on-site preset are the Persistent maps category's alone since 78b.
        expect(root.querySelector('[data-lh-field="map-evolution-compress"]')).toBeNull()
        expect(root.querySelector('[data-lh-field="map-evolution-preset"]')).toBeNull()
        field('map-evolution-enabled').checked = false
        field('map-evolution-enabled').dispatchEvent(new Event('change'))
        await settle()
        expect(worldPatches()).toEqual([{ mapEvolutionIntervalHours: 24 }, { mapEvolutionScope: 'selected' }, { mapEvolutionSelectedRoots: 'Abbey Undercroft, Old Mill' }, { mapEvolutionSelectedRoots: 'Abbey Undercroft' }, { mapEvolutionEnabled: false }])
        expect(line()).toBe('Map Evolution: off. Sites stand as play last left them.')
        setMapStatus({ ...BASE, evolution: { ...EVOLUTION, onSiteIntervalHours: 0, onSiteIntervalMinutes: 0, currentTime: '', lastFired: '', nextDue: '' } })
        refresh().click()
        await settle()
        expect(line()).toBe('Map Evolution: on, every 12 in-world hours for a site the party is away from, never while the party is there. The clock has no [TIME] yet; no site has evolved yet; the next pass starts a clock on the next reply.')
        setMapStatus({ ...BASE, enabled: false })
        refresh().click()
        await settle()
        expect(line()).toBe('Map Evolution is off with the mapping section.')
        expect(button().disabled).toBe(true)
    })

    it('gives each named site an hours box of its own (71d): blank inherits the dials, a number is written and the maps read again', async () => {
        const { bridge, setMapStatus, worldPatches } = makeBridge({ 'chat-1': MEMO })
        setMapStatus({ ...BASE, sites: [{ siteRoot: 'Abbey Undercroft', kind: 'DUNGEON', entryId: 'Vell_LOC::1' }, { siteRoot: 'Elmridge', kind: 'SETTLEMENT', entryId: 'Vell_LOC::2' }], activeSiteRoot: 'Elmridge', evolution: { ...EVOLUTION, sites: [{ siteRoot: 'Abbey Undercroft', current: false, automaticHours: 12, overrideHours: null }, { siteRoot: 'Elmridge', current: true, automaticHours: 1.5, overrideHours: 0 }] } })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const sub = () => root.querySelector('.lh-evolution') as HTMLDetailsElement
        expect(sub().querySelector('[data-lh-field="map-evolution-selected"]')!.hasAttribute('hidden')).toBe(false)
        const rows = () => Array.from(sub().querySelectorAll('.lh-maps-evolution-site'))
        expect(rows().map((r) => r.querySelector('label')!.textContent)).toEqual(['Abbey Undercroft', 'Elmridge (current)'])
        const hours = (name: string) => sub().querySelector(`[data-lh-field="map-evolution-hours:${name}"]`) as HTMLInputElement
        expect(hours('Abbey Undercroft').value).toBe('')
        expect(hours('Elmridge').value).toBe('0')
        expect(rows().map((r) => r.querySelector('.lh-maps-evolution-inherit')!.textContent)).toEqual(['Automatic: 12h (other maps)', 'Override \u00b7 was 1h 30m'])
        hours('Abbey Undercroft').value = '6'
        hours('Abbey Undercroft').dispatchEvent(new Event('change'))
        await settle()
        expect(worldPatches().filter((p) => p.op === 'interval')).toEqual([{ op: 'interval', chatId: 'chat-1', siteRoot: 'Abbey Undercroft', hours: 6 }])
        hours('Elmridge').value = ''
        hours('Elmridge').dispatchEvent(new Event('change'))
        await settle()
        expect(worldPatches().filter((p) => p.op === 'interval').at(-1)).toEqual({ op: 'interval', chatId: 'chat-1', siteRoot: 'Elmridge', hours: null })
        // The × beside an overridden box puts the site back to automatic (71d-bis); an inheriting row has none.
        const auto = (name: string) => sub().querySelector(`[data-lh-field="map-evolution-auto:${name}"]`) as HTMLButtonElement | null
        expect(auto('Abbey Undercroft')).toBeNull()
        expect(auto('Elmridge')).toBeTruthy()
        expect(auto('Elmridge')!.title).toContain('Back to automatic')
        auto('Elmridge')!.click()
        await settle()
        expect(worldPatches().filter((p) => p.op === 'interval').at(-1)).toEqual({ op: 'interval', chatId: 'chat-1', siteRoot: 'Elmridge', hours: null })
        expect(worldPatches().filter((p) => p.op === 'interval')).toHaveLength(3)
    })

    it('carries the Testing ground as the last sub-fold of Evolution (71d): reads on open, runs its actions on the chat, and follows a simulate\'s ticks', async () => {
        const { bridge, setMapStatus, sandboxOps, emit } = makeBridge({ 'chat-1': MEMO })
        setMapStatus({ ...BASE })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const sub = () => root.querySelector('.lh-evolution') as HTMLDetailsElement
        const sandbox = () => sub().querySelector('[data-lh-field="sandbox"]') as HTMLDetailsElement
        expect(sandbox()).toBeTruthy()
        expect(sandbox().querySelector('summary')!.textContent).toBe('🧪 Testing ground')
        expect(sandboxOps).toEqual([])
        sandbox().open = true
        sandbox().dispatchEvent(new Event('toggle'))
        await settle()
        // happy-dom fires toggle on the open itself as well; every read is the chat's.
        expect(sandboxOps.length).toBeGreaterThanOrEqual(1)
        expect(sandboxOps.every((op) => op.op === 'get' && op.chatId === 'chat-1')).toBe(true)
        expect((sandbox().querySelector('[data-lh-field="sandbox-time"] strong') as HTMLElement).textContent).toBe('09:00 AM, Day 5')
        expect(Array.from((sandbox().querySelector('[data-lh-field="sandbox-site"]') as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(['Abbey Undercroft (current)', 'Morrowfen'])
        const button = (field: string) => sandbox().querySelector(`[data-lh-field="${field}"]`) as HTMLButtonElement
        button('sandbox-evolve').click()
        await settle()
        expect(sandboxOps.at(-2)).toEqual({ op: 'evolve', chatId: 'chat-1', siteRoot: 'Abbey Undercroft' })
        expect((sandbox().querySelector('[data-lh-field="sandbox-status"]') as HTMLElement).textContent).toBe('Evolution applied 1 material update(s). Undo to rewind that pass.')
        // A tick's progress reaches the status line only while a sandbox action is in flight.
        emit({ name: 'map.sandbox.progress', data: { chatId: 'chat-1', index: 0, count: 2, timeLabel: 'Day 5, 05:00 PM', phase: 'time' } })
        expect((sandbox().querySelector('[data-lh-field="sandbox-status"]') as HTMLElement).textContent).toBe('Evolution applied 1 material update(s). Undo to rewind that pass.')
    })

    it('evolves now with the instruction in the box, shows the pass running, then what it did (34c)', async () => {
        const { bridge, setMapStatus, worldPatches, setMapEvolve } = makeBridge({ 'chat-1': MEMO })
        setMapStatus({ ...BASE, currentLocation: 'Abbey Undercroft, Cellar Landing', activeSiteRoot: 'Abbey Undercroft', sites: [{ siteRoot: 'Abbey Undercroft', kind: 'DUNGEON', entryId: 'Vell_LOC::1' }] })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const sub = () => root.querySelector('.lh-evolution') as HTMLDetailsElement
        const button = () => Array.from(sub().querySelectorAll('button')).find((b) => b.textContent === 'Evolve now') as HTMLButtonElement
        const live = () => sub().querySelector('.lh-maps-evolution-running') as HTMLElement
        const note = () => sub().querySelector('.lh-maps-evolution-note')!.textContent ?? ''
        // The instruction box left the drawer with 78b: the terminal's Map Evolution bar is the way to instruct a pass.
        expect(root.querySelector('[data-lh-field="map-evolution-instruction"]')).toBeNull()
        button().click()
        expect(button().disabled).toBe(true)
        expect(field('map-evolution-interval').disabled).toBe(true)
        expect(live().hidden).toBe(false)
        expect(live().textContent).toContain('Map Evolution is moving Abbey Undercroft now')
        await settle()
        expect(worldPatches()).toEqual([{ op: 'evolve', chatId: 'chat-1' }])
        expect(live().hidden).toBe(true)
        expect(button().disabled).toBe(false)
        expect(note()).toContain('pack moved to landing by pack: Drawn by the lantern light. (1 operation).')
        setMapEvolve({ status: 'skipped', at: new Date().toISOString(), trigger: 'manual', sites: [], reason: 'the party is not inside a mapped site' })
        button().click()
        await settle()
        expect(worldPatches().at(-1)).toEqual({ op: 'evolve', chatId: 'chat-1' })
        expect(note()).toContain('Evolution was skipped: the party is not inside a mapped site.')
        // The in-flight line names the sites the scope names (45c-quater): the ticked ones under Named, every mapped site under All.
        setMapStatus({ ...BASE, sites: [{ siteRoot: 'Abbey Undercroft', kind: 'DUNGEON', entryId: 'Vell_LOC::1' }, { siteRoot: 'Morrowfen', kind: 'SETTLEMENT', entryId: 'Vell_LOC::2' }], evolution: { ...EVOLUTION, scope: 'selected', selectedRoots: 'Morrowfen' } })
        refresh().click()
        await settle()
        button().click()
        expect(live().textContent).toContain('Map Evolution is moving Morrowfen now')
        await settle()
        setMapStatus({ ...BASE, sites: [{ siteRoot: 'Abbey Undercroft', kind: 'DUNGEON', entryId: 'Vell_LOC::1' }, { siteRoot: 'Morrowfen', kind: 'SETTLEMENT', entryId: 'Vell_LOC::2' }], evolution: { ...EVOLUTION, scope: 'all' } })
        refresh().click()
        await settle()
        button().click()
        expect(live().textContent).toContain('Map Evolution is moving Abbey Undercroft, Morrowfen now')
        await settle()
        expect(button().title).toContain('on the sites the scope above names')
    })

    it('shows evolution in flight after a reply, then what it did at each site, for this chat only (34c)', async () => {
        const { bridge, setMapStatus, emit } = makeBridge({ 'chat-1': MEMO })
        setMapStatus(BASE)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const sub = () => root.querySelector('.lh-evolution') as HTMLDetailsElement
        const live = () => sub().querySelector('.lh-maps-evolution-running') as HTMLElement
        const note = () => sub().querySelector('.lh-maps-evolution-note')!.textContent ?? ''
        emit({ name: 'map.evolution.started', data: { chatId: 'chat-2', sites: ['Elsewhere'], at: new Date().toISOString(), trigger: 'interval' } })
        await settle()
        expect(live().hidden).toBe(true)
        emit({ name: 'map.evolution.started', data: { chatId: 'chat-1', sites: ['Abbey Undercroft', 'Morrowfen'], at: new Date().toISOString(), trigger: 'interval' } })
        await settle()
        expect(live().hidden).toBe(false)
        expect(live().textContent).toContain('moving Abbey Undercroft, Morrowfen now')
        expect(field('map-evolution-enabled').disabled).toBe(true)
        const applied = { status: 'applied', at: new Date().toISOString(), trigger: 'interval', currentTime: '09:00 AM, Day 6', sites: [{ siteRoot: 'Abbey Undercroft', status: 'applied', summary: 'pack moved to landing by pack: Drawn by the lantern light.', operations: 1, compressed: 2 }, { siteRoot: 'Morrowfen', status: 'noop' }] }
        setMapStatus({ ...BASE, lastEvolution: applied })
        emit({ name: 'map.evolution.finished', data: { chatId: 'chat-1', ...applied } })
        await settle()
        expect(live().hidden).toBe(true)
        expect(field('map-evolution-enabled').disabled).toBe(false)
        expect(note()).toContain('Evolved Abbey Undercroft: pack moved to landing by pack: Drawn by the lantern light. (1 operation); its history compressed into 2 digests. Nothing stirred at Morrowfen.')
        const baseline = { status: 'baseline', at: new Date().toISOString(), trigger: 'interval', currentTime: '09:00 AM, Day 5', sites: [{ siteRoot: 'Abbey Undercroft', status: 'baseline' }, { siteRoot: 'Morrowfen', status: 'baseline' }] }
        setMapStatus({ ...BASE, lastEvolution: baseline })
        emit({ name: 'map.evolution.finished', data: { chatId: 'chat-1', ...baseline } })
        await settle()
        expect(note()).toContain('Started the clock for Abbey Undercroft, Morrowfen at 09:00 AM, Day 5; the first pass comes one interval later.')
        const exit = { status: 'noop', at: new Date().toISOString(), trigger: 'site_exit', sites: [{ siteRoot: 'Abbey Undercroft', status: 'noop' }] }
        setMapStatus({ ...BASE, lastEvolution: exit })
        emit({ name: 'map.evolution.finished', data: { chatId: 'chat-1', ...exit } })
        await settle()
        expect(note()).toContain('Nothing stirred at Abbey Undercroft on leaving.')
        const failed = { status: 'failed', at: new Date().toISOString(), trigger: 'interval', sites: [{ siteRoot: 'Abbey Undercroft', status: 'failed', reason: 'could not apply a valid transaction: PLAYER_BUBBLE_FROZEN at map.operations[0]: Leave it.' }] }
        setMapStatus({ ...BASE, lastEvolution: failed })
        emit({ name: 'map.evolution.finished', data: { chatId: 'chat-1', ...failed } })
        await settle()
        expect(note()).toContain('Abbey Undercroft failed: could not apply a valid transaction: PLAYER_BUBBLE_FROZEN')
        expect(sub().querySelector('.lh-maps-evolution-note.lh-world-note--error')).not.toBeNull()
        const undone = { status: 'undone', at: new Date().toISOString(), trigger: 'interval', sites: [{ siteRoot: 'Abbey Undercroft', status: 'applied' }], reason: 'the reply it followed was replaced' }
        setMapStatus({ ...BASE, lastEvolution: undone })
        refresh().click()
        await settle()
        expect(note()).toContain('The evolution of Abbey Undercroft was put back: the reply it followed was replaced.')
        expect(sub().querySelector('.lh-maps-evolution-note.lh-world-note--error')).toBeNull()
        // A pass already running when the fold loads is shown too.
        setMapStatus({ ...BASE, evolution: { ...EVOLUTION, running: true } })
        refresh().click()
        await settle()
        expect(live().hidden).toBe(false)
        expect(live().textContent).toContain('moving the sites now')
    })

    it('shows a map being drawn, then what the architect did, for this chat only (34a)', async () => {
        const { bridge, setMapStatus, emit } = makeBridge({ 'chat-1': MEMO })
        setMapStatus(BASE)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const live = () => fold().querySelector('.lh-maps-architect-running') as HTMLElement
        const note = () => fold().querySelector('.lh-maps-architect-note')!.textContent ?? ''
        emit({ name: 'map.architect.started', data: { chatId: 'chat-2', site: 'Elsewhere', at: new Date().toISOString() } })
        await settle()
        expect(live().hidden).toBe(true)
        emit({ name: 'map.architect.started', data: { chatId: 'chat-1', site: 'Varnholde Crypts', at: new Date().toISOString() } })
        await settle()
        expect(live().hidden).toBe(false)
        expect(live().textContent).toContain('drawing Varnholde Crypts now')
        expect(live().textContent).toContain('the reply goes on without it')
        const written = { status: 'written', at: new Date().toISOString(), site: 'Varnholde Crypts', kind: 'DUNGEON', areas: 5, assets: 4, entryId: 'Vell_LOC::5' }
        setMapStatus({ ...BASE, lastArchitect: written })
        emit({ name: 'map.architect.finished', data: { chatId: 'chat-1', ...written } })
        await settle()
        expect(live().hidden).toBe(true)
        expect(note()).toContain('Drew Varnholde Crypts (DUNGEON): 5 areas, 4 things in them, saved to Vell_LOC::5.')
        const failed = { status: 'failed', at: new Date().toISOString(), site: 'Old Barrow', reason: 'The architect could not produce a valid connected topology after 3 attempts.' }
        setMapStatus({ ...BASE, lastArchitect: failed })
        emit({ name: 'map.architect.finished', data: { chatId: 'chat-1', ...failed } })
        await settle()
        expect(note()).toContain('The architect failed for Old Barrow: The architect could not produce')
        expect(fold().querySelector('.lh-maps-architect-note.lh-world-note--error')).not.toBeNull()
        const reused = { status: 'reused', at: new Date().toISOString(), site: 'Abbey Undercroft' }
        setMapStatus({ ...BASE, lastArchitect: reused })
        emit({ name: 'map.architect.finished', data: { chatId: 'chat-1', ...reused } })
        await settle()
        expect(note()).toContain('Abbey Undercroft was already mapped')
    })

    it('leaves the fold readable when the status cannot be loaded, and clears on a chat change', async () => {
        const { bridge, setMapStatus } = makeBridge({ 'chat-1': MEMO, 'chat-2': MEMO, 'chat-3': MEMO })
        setMapStatus(undefined)
        const host = makeHost()
        const panel = mountTrackerPanel(root, bridge, host)
        await settle()
        expect(statusLine()).toBe('no maps here')
        expect(refresh().disabled).toBe(true)
        setMapStatus({ ...BASE, currentLocation: 'Elsewhere' })
        host.getActiveChat = () => ({ chatId: 'chat-2', characterId: null })
        await panel.refresh()
        await settle()
        expect(statusLine()).toBe('The party is at Elsewhere.')
        // A third chat whose answer never comes: the fold must not keep the second chat's maps on screen meanwhile.
        setMapStatus({ pending: true })
        host.getActiveChat = () => ({ chatId: 'chat-3', characterId: null })
        await panel.refresh()
        await settle()
        expect(statusLine()).toBe('Loading…')
        expect(sitesLine()).toBe('')
    })
})

describe('import a character card (Phase 39)', () => {
    const fold = () => root.querySelector('.lh-import') as HTMLDetailsElement

    it('sits between the other ways and the Player Card, lists the cards when opened, imports for the chat with the narrator named, and reads the card again after', async () => {
        const { bridge, setCreatorPrefs, importOps, cardOps } = makeBridge({ 'chat-1': '' })
        setCreatorPrefs({ creatorPlayerCard: true, creatorPersona: false })
        mountTrackerPanel(root, bridge, { ...makeHost(), getActiveChat: () => ({ chatId: 'chat-1', characterId: 'char-1' }) })
        await settle()
        expect(fold()).not.toBeNull()
        expect(fold().previousElementSibling!.classList.contains('lh-ways')).toBe(true)
        // In the starting area (69), before the narrator's configuration (70); the Player Card and the library follow the area.
        expect(fold().nextElementSibling).toBeNull()
        expect(fold().closest('.lh-start-drawer')!.nextElementSibling!.classList.contains('lh-narrator')).toBe(true)
        expect(fold().closest('.lh-start')!.nextElementSibling!.classList.contains('lh-player-card')).toBe(true)
        expect(fold().closest('.lh-start')!.nextElementSibling!.nextElementSibling!.classList.contains('lh-library')).toBe(true)
        expect(fold().open).toBe(false)
        expect((fold().querySelector('[data-lh-field="import-player-card-input"]') as HTMLInputElement).checked).toBe(true)
        expect((fold().querySelector('[data-lh-field="import-persona-input"]') as HTMLInputElement).checked).toBe(false)
        // Nothing is fetched until the fold is opened.
        expect(importOps()).toEqual([])
        fold().open = true
        fold().dispatchEvent(new Event('toggle'))
        await settle()
        expect(importOps()).toEqual([['cards', undefined]])
        expect(Array.from(fold().querySelectorAll('.lh-import-name')).map((n) => n.textContent)).toEqual(['Kestrel', 'Orrin'])
        const gets = cardOps().filter(([op]) => op === 'get').length
        ;(fold().querySelector('button[aria-label="Fit \u201cKestrel\u201d into the story"]') as HTMLButtonElement).click()
        await settle()
        expect(importOps()[1]).toEqual(['import', { chatId: 'chat-1', characterId: 'k1', mode: 'full', cardWords: 'same', playerCard: true, persona: false, narratorCharacterId: 'char-1' }])
        expect(fold().querySelector('.lh-import-note')!.textContent).toContain('Imported \u201cKestrel\u201d, fitted into the story: CHARACTER. The sheet is in the tracker’s cards.')
        expect(cardOps().filter(([op]) => op === 'get').length).toBe(gets + 1)
    })
})

describe('the NPC library (Phase 41)', () => {
    const fold = () => root.querySelector('.lh-library') as HTMLDetailsElement

    it('sits under the Player Card, lists the library when opened, seats a card for the chat, and reads the card fold after Play as PC', async () => {
        const { bridge, libraryOps, cardOps, setLibraryAction } = makeBridge({ 'chat-1': '' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        expect(fold()).not.toBeNull()
        expect(fold().previousElementSibling!.classList.contains('lh-player-card')).toBe(true)
        expect(libraryOps()).toEqual([])
        fold().open = true
        fold().dispatchEvent(new Event('toggle'))
        await settle()
        expect(libraryOps()).toEqual([['list', undefined]])
        expect(Array.from(fold().querySelectorAll('.lh-library-card .lh-library-name')).map((n) => n.textContent)).toEqual(['Kestrel'])
        ;(fold().querySelector('button[aria-label="Add \u201cKestrel\u201d to the party"]') as HTMLButtonElement).click()
        await settle()
        expect(libraryOps()[1]).toEqual(['party', { chatId: 'chat-1', id: 'k1' }])
        expect(fold().querySelector('.lh-library-note')!.textContent).toContain('Kestrel joined the party: PARTY.')
        const gets = cardOps().filter(([op]) => op === 'get').length
        setLibraryAction({ status: 'done', at: 't', action: 'pc', name: 'Kestrel', added: ['CHARACTER'], replaced: [] })
        ;(fold().querySelector('button[aria-label="Play as \u201cKestrel\u201d"]') as HTMLButtonElement).click()
        await settle()
        expect(libraryOps()[2]).toEqual(['playAsPc', { chatId: 'chat-1', id: 'k1' }])
        expect(cardOps().filter(([op]) => op === 'get').length).toBe(gets + 1)
    })
})

describe('the NPC creator (41a)', () => {
    const fold = () => root.querySelector('.lh-npc-creator') as HTMLDetailsElement

    it('sits under the library, lists both when opened, adds a card for the chat with the narrator named, and drafts then commits', async () => {
        const { bridge, npcOps, importOps, libraryOps, setNpcAnswer } = makeBridge({ 'chat-1': '' })
        mountTrackerPanel(root, bridge, { ...makeHost(), getActiveChat: () => ({ chatId: 'chat-1', characterId: 'narrator-9' }) })
        await settle()
        expect(fold()).not.toBeNull()
        expect(fold().previousElementSibling!.classList.contains('lh-library')).toBe(true)
        expect(npcOps()).toEqual([])
        const cardsBefore = (importOps() as unknown[][]).filter(([op]) => op === 'cards').length
        const listsBefore = (libraryOps() as unknown[][]).filter(([op]) => op === 'list').length
        fold().open = true
        fold().dispatchEvent(new Event('toggle'))
        await settle()
        expect((importOps() as unknown[][]).filter(([op]) => op === 'cards').length).toBe(cardsBefore + 1)
        expect((libraryOps() as unknown[][]).filter(([op]) => op === 'list').length).toBe(listsBefore + 1)
        ;(fold().querySelector('[data-lh-tab="card"]') as HTMLButtonElement).click()
        ;(fold().querySelector('[data-lh-panel="card"] button[aria-label="Add \u201cKestrel\u201d as an NPC"]') as HTMLButtonElement).click()
        await settle()
        expect(npcOps()[0]).toEqual(['add', { chatId: 'chat-1', source: { kind: 'card', characterId: 'k1' }, narratorCharacterId: 'narrator-9' }])
        expect(fold().querySelector('.lh-npc-note')!.textContent).toContain('Added “Kestrel” to Vell_NPC as is.')
        setNpcAnswer({ status: 'drafted', at: 't', how: 'fit', source: 'Kestrel', name: 'Kes', tag: '[[NPC: Kes | x | k]]', duplicate: false })
        ;(fold().querySelector('[data-lh-panel="card"] button[aria-label="Fit \u201cKestrel\u201d into the story as an NPC"]') as HTMLButtonElement).click()
        await settle()
        expect(npcOps()[1]).toEqual(['draft', { chatId: 'chat-1', source: { kind: 'card', characterId: 'k1' }, narratorCharacterId: 'narrator-9' }])
        setNpcAnswer({ status: 'added', at: 't', name: 'Kes', book: 'Vell_NPC', entryId: 'Vell_NPC::4', how: 'fit', portrait: true })
        ;(fold().querySelector('button[aria-label="Add the drafted NPC"]') as HTMLButtonElement).click()
        await settle()
        expect(npcOps()[2]).toEqual(['commit', { chatId: 'chat-1', tag: '[[NPC: Kes | x | k]]', name: 'Kes', how: 'fit', portrait: { kind: 'card', characterId: 'k1' } }])
        expect(fold().querySelector('.lh-npc-note')!.textContent).toContain('Added “Kes” to Vell_NPC fitted into the story. Their portrait is placed.')
    })
})

describe('the scene (42)', () => {
    const fold = () => root.querySelector('.lh-scene') as HTMLDetailsElement

    it('sits between the NPC creator and the relationships, reads the scene when opened for the chat, again after the maps are re-read, and sets a picked picture', async () => {
        const { bridge, sceneOps } = makeBridge({ 'chat-1': '' })
        const picks: unknown[] = []
        mountTrackerPanel(root, bridge, { ...makeHost(), uploads: { pickFile: async (options: unknown) => { picks.push(options); return [{ name: 'yard.png', bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }] } } } as never)
        await settle()
        expect(fold()).not.toBeNull()
        // The Visuals/Map pane's body since 78a, with the site map's slot between the hero and Present now.
        expect(fold().closest('.lh-maps')).not.toBeNull()
        expect(fold().querySelector('[data-lh-field="scene-site-map"] .lh-map-picture')).not.toBeNull()
        expect(sceneOps()).toEqual([])
        fold().open = true
        fold().dispatchEvent(new Event('toggle'))
        await settle()
        expect(sceneOps()).toEqual([['get', { chatId: 'chat-1' }]])
        expect(fold().querySelector('.lh-scene-status')!.textContent).toBe('The party is at Courtyard — Monastery › Courtyard.')
        expect(Array.from(fold().querySelectorAll('.lh-scene-tile .lh-scene-name')).map((n) => n.textContent)).toEqual(['Mother Sedge'])
        // The scene follows the maps: re-reading them re-reads it.
        Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Re-read the maps')!.click()
        await settle()
        expect((sceneOps() as unknown[][]).filter(([op]) => op === 'get')).toHaveLength(2)
        ;(fold().querySelector('button[aria-label="Set a picture for the place"]') as HTMLButtonElement).click()
        await settle()
        await settle()
        // The same ask as the portraits' picker (66), not `image/*`.
        expect(picks).toEqual([{ accept: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], maxSizeBytes: MAX_PORTRAIT_BYTES }])
        const set = (sceneOps() as unknown[][]).find(([op]) => op === 'setImage')
        expect(set).toEqual(['setImage', { chatId: 'chat-1', path: 'Monastery :: Courtyard', src: 'data:image/png;base64,AQID', filename: 'yard.png' }])
    })
})

describe('the standings on the Campaign Records cards (44, 78b)', () => {
    const pane = () => root.querySelector('.lh-campaign-records') as HTMLDetailsElement
    const card = (id: string) => root.querySelector(`.lh-npc-card[data-lh-entry="${id}"]`) as HTMLElement

    it('reads the standings with the books, again when the backend says a value moved or the maps are re-read, and draws the bars and the tiers on the NPC cards', async () => {
        const { bridge, relationsOps, emit } = makeBridge({ 'chat-1': '' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        // No Relationships fold since 78b: the cards carry the standings.
        expect(root.querySelector('.lh-relations')).toBeNull()
        expect(relationsOps()).toEqual([])
        pane().open = true
        pane().dispatchEvent(new Event('toggle'))
        await settle()
        await settle()
        expect(relationsOps()).toEqual([['get', { chatId: 'chat-1' }]])
        // The NPC's card: the bars from the centre, the values signed, the tiers as pills with the hints.
        ;(root.querySelector('.lh-records-folder-head') as HTMLElement).click()
        const elara = card('e1')
        expect(elara).not.toBeNull()
        const fills = Array.from(elara.querySelectorAll('.lh-npc-bar-fill')) as HTMLElement[]
        expect(fills[0]!.classList.contains('lh-npc-bar-fill--up')).toBe(true)
        expect(parseFloat(fills[0]!.style.width)).toBeCloseTo((40 / 150) * 50, 3)
        expect(fills[1]!.classList.contains('lh-npc-bar-fill--down')).toBe(true)
        expect(Array.from(elara.querySelectorAll('.lh-npc-bar-value')).map((v) => v.textContent)).toEqual(['+40', '-5'])
        // The tiers are the legacy's, computed from the value as Multihog's cards compute them, not the view's words.
        expect(Array.from(elara.querySelectorAll('.lh-npc-tier')).map((p) => p.textContent)).toEqual(['FRIENDLY', 'INDIFFERENT/UNINTERESTED'])
        expect((elara.querySelector('.lh-npc-tier') as HTMLElement).title).toBe('genuine warmth, light humor, willing to help when asked')
        // A value moved by another hand: the standings re-read, for this chat only.
        emit({ name: 'relationships.changed', data: { chatId: 'chat-9' } })
        await settle()
        expect((relationsOps() as unknown[][]).filter(([op]) => op === 'get')).toHaveLength(1)
        emit({ name: 'relationships.changed', data: { chatId: 'chat-1' } })
        await settle()
        expect((relationsOps() as unknown[][]).filter(([op]) => op === 'get')).toHaveLength(2)
        // And after every reply, with the maps and the scene (44-bis): the switch may have been flipped since.
        Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Re-read the maps')!.click()
        await settle()
        expect((relationsOps() as unknown[][]).filter(([op]) => op === 'get')).toHaveLength(3)
    })

    it('opens the Full NPC Card in the host’s modal: the sections, the sliders that set a value, the history; the Player Card behind Full PC Card; the gears', async () => {
        const shown: Array<{ title: string; root: HTMLElement }> = []
        const host: TrackerPanelHost = {
            ...makeHost(),
            ui: {
                showConfirm: async () => ({ confirmed: true }),
                showModal: (options: { title: string }) => { const modalRoot = document.createElement('div'); document.body.append(modalRoot); shown.push({ title: options.title, root: modalRoot }); return { root: modalRoot, dismiss: () => { modalRoot.remove() } } },
            } as unknown as TrackerPanelHost['ui'],
        }
        const { bridge, relationsOps, setCardView, worldPatches } = makeBridge({ 'chat-1': '' })
        setCardView({ card: { name: 'Robin Vale', bio: 'Species: Human\nBody: Lean and quick.\nPersonality: Wry.', wordCount: 8, at: 't' }, persona: null, personasAvailable: true, activePersona: '', activeDescribed: false })
        mountTrackerPanel(root, bridge, host)
        await settle()
        // The Player Card, the library and the creator leave the settings tab for the modal's doors.
        expect(root.querySelector('.lh-player-card')).toBeNull()
        expect(root.querySelector('.lh-library')).toBeNull()
        pane().open = true
        pane().dispatchEvent(new Event('toggle'))
        await settle()
        await settle()
        // The Player Character's card at the top: the synopsis from the bio, the badge, Full PC Card opening the fold.
        const pc = root.querySelector('[data-lh-field="records-pc"]') as HTMLElement
        expect(pc.querySelector('.lh-npc-name')!.textContent).toBe('Robin Vale')
        expect(pc.querySelector('.lh-npc-desc')!.textContent).toContain('Human')
        expect(pc.querySelector('.lh-npc-badge')!.textContent).toBe('👤 Player Character')
        ;(pc.querySelector('[data-lh-field="records-pc-view"]') as HTMLElement).click()
        expect(shown.map((m) => m.title)).toEqual(['Robin Vale — Player Card'])
        expect(shown[0]!.root.querySelector('.lh-player-card')).not.toBeNull()
        expect((shown[0]!.root.querySelector('.lh-player-card') as HTMLDetailsElement).open).toBe(true)
        // The NPCs folder: the manager and the gear; the Locations folder would carry the Maps Guide and its gear.
        ;(root.querySelector('.lh-records-folder-head') as HTMLElement).click()
        ;(root.querySelector('[data-lh-field="records-npc-settings"]') as HTMLElement).click()
        expect(shown.at(-1)!.title).toBe('NPC and PC Card Settings')
        expect(shown.at(-1)!.root.querySelector('[data-lh-field="npc-card-settings"]')).not.toBeNull()
        expect((shown.at(-1)!.root.querySelector('[data-lh-field="npc-card-relationships"]') as HTMLInputElement).checked).toBe(true)
        // The Full NPC Card: the portrait's place, the sections, the two sliders, the history.
        ;(card('e1').querySelector('[data-lh-field="records-view"]') as HTMLElement).click()
        expect(shown.at(-1)!.title).toBe('Elara — Full NPC Card')
        const full = shown.at(-1)!.root
        expect(full.querySelector('.lh-npc-full-name')!.textContent).toBe('Elara')
        expect(full.querySelector('.lh-records-core dd')!.textContent).toBe('Innkeeper')
        expect(full.querySelectorAll('.lh-npc-full-axis')).toHaveLength(2)
        expect(full.querySelector('.lh-npc-full-tier b')!.textContent).toBe('Friendship tier: FRIENDLY')
        expect(full.querySelectorAll('.lh-npc-full-log tr')).toHaveLength(1)
        const slider = full.querySelector('input[aria-label="Elara’s affection slider"]') as HTMLInputElement
        slider.value = '12'
        slider.dispatchEvent(new Event('input'))
        expect((full.querySelector('input[aria-label="Elara’s affection"]') as HTMLInputElement).value).toBe('12')
        slider.dispatchEvent(new Event('change'))
        await settle()
        expect((relationsOps() as unknown[][]).find(([op]) => op === 'set')).toEqual(['set', { chatId: 'chat-1', id: 'Vell_NPC::1', field: 'affection', value: 12 }])
        // Forget the standing asks, then removes it.
        ;(full.querySelector('[data-lh-field="records-full-forget"]') as HTMLElement).click()
        await settle()
        expect((relationsOps() as unknown[][]).find(([op]) => op === 'remove')).toEqual(['remove', { chatId: 'chat-1', id: 'Vell_NPC::1' }])
        expect(worldPatches()).toEqual([])
    })
})

describe('the portraits in play, at the foot of the library (60)', () => {
    const library = () => root.querySelector('.lh-library') as HTMLDetailsElement
    const picker: TrackerPanelHost = { ...makeHost(), uploads: { pickFile: async () => [{ name: 'kes.png', mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) }] } }

    it('names the chat on a photo set for a card the cards name, and not for one they do not', async () => {
        // The photo lands on the open chat's entity of the card's name only when the memo names one: the
        // panel reads its own cards, so a card for someone not in play is the library's alone.
        const { bridge, libraryOps } = makeBridge({ 'chat-1': '[COMBAT]\nENEMIES:\nKESTREL (wounded) ((BAR)) 4/10\n[/COMBAT]' })
        mountTrackerPanel(root, bridge, picker)
        await settle()
        library().open = true
        library().dispatchEvent(new Event('toggle'))
        await settle()
        ;(library().querySelector('button[aria-label="Open the card \u201cKestrel\u201d"]') as HTMLButtonElement).click()
        ;(library().querySelector('button[aria-label="Set the photo of \u201cKestrel\u201d"]') as HTMLButtonElement).click()
        await settle()
        expect(libraryOps().filter((entry) => (entry as unknown[])[0] === 'photo.set')).toEqual([['photo.set', { id: 'k1', dataUrl: 'data:image/png;base64,AQID', filename: 'kes.png', chatId: 'chat-1' }]])
        expect(library().querySelector('.lh-library-note')!.textContent).toBe('The photo of \u201cKestrel\u201d is set. It is placed in this chat too.')

        document.body.replaceChildren()
        root = document.createElement('div')
        document.body.append(root)
        const other = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, other.bridge, picker)
        await settle()
        library().open = true
        library().dispatchEvent(new Event('toggle'))
        await settle()
        ;(library().querySelector('button[aria-label="Open the card \u201cKestrel\u201d"]') as HTMLButtonElement).click()
        ;(library().querySelector('button[aria-label="Draw the photo of \u201cKestrel\u201d"]') as HTMLButtonElement).click()
        await settle()
        expect(other.libraryOps().filter((entry) => (entry as unknown[])[0] === 'photo.draw')).toEqual([['photo.draw', { id: 'k1' }]])
    })

    it('puts the list inside the NPC library fold, named for what it is, and draws no lore or Cortex fold', async () => {
        const { bridge } = makeBridge({ 'chat-1': '[COMBAT]\nENEMIES:\nMoth Wraith ((BAR)) 10/10\n[/COMBAT]' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const list = root.querySelector('.lh-library .lh-library-tail > .lh-portraits') as HTMLElement
        expect(list).not.toBeNull()
        expect(list.hidden).toBe(false)
        expect(list.querySelector('summary')!.textContent).toBe('Portraits in play (1)')
        expect(root.querySelector('.lh-lore')).toBeNull()
        expect(root.querySelector('.lh-cortex')).toBeNull()
        expect(Array.from(root.querySelectorAll('summary')).map((n) => n.textContent)).not.toContain('Active lore')
    })
})

describe('a picture large (Phase 64)', () => {
    const COMBAT_MEMO = ['[COMBAT]', 'ENEMIES:', 'Moth Wraith ((BAR)) 10/10', '[/COMBAT]'].join('\n')
    const modalHost = () => {
        const shown: Array<{ title: string; root: HTMLElement }> = []
        const host = {
            ...makeHost(),
            ui: {
                showConfirm: async () => ({ confirmed: true }),
                showModal: (options: { title: string }) => { const root = document.createElement('div'); document.body.append(root); shown.push({ title: options.title, root }); return { root, dismiss: () => { root.remove() } } },
            },
        }
        return { host, shown }
    }

    it('opens an entity card\'s portrait and a portraits-in-play thumb in the host\'s modal, titled with the name', async () => {
        const { bridge, setPortraits } = makeBridge({ 'chat-1': COMBAT_MEMO })
        setPortraits({ 'Moth Wraith': '/rat.png' })
        const { host, shown } = modalHost()
        mountTrackerPanel(root, bridge, host)
        await settle()

        const onCard = root.querySelector('.rt-entity-portrait') as HTMLImageElement
        expect(onCard.getAttribute('data-lh-large')).toBe('Moth Wraith')
        onCard.click()
        expect(shown.map((s) => s.title)).toEqual(['Moth Wraith'])
        expect(shown[0]!.root.querySelector('img.lh-large')?.getAttribute('src')).toBe('/rat.png')
        // The card's sections are as they were: the click was the picture's.
        expect(root.querySelector('.rt-entity-portrait')).not.toBeNull()

        // The portraits in play are the library's foot, behind the NPC/PC Manager since 78b.
        await openManager(root)
        const inPlay = document.querySelector('.lh-portrait-row img.lh-portrait-thumb') as HTMLImageElement
        expect(inPlay.getAttribute('data-lh-large')).toBe('Moth Wraith')
        inPlay.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
        expect(shown.map((s) => s.title)).toEqual(['Moth Wraith', '📚 NPC/PC Manager', 'Moth Wraith'])
    })

    it('puts the portrait’s own buttons under the large view (80): Remove through portraits.set, the file greyed without a picker, and an empty row’s box opening the same view', async () => {
        const { bridge, setPortraits } = makeBridge({ 'chat-1': COMBAT_MEMO })
        setPortraits({ 'Moth Wraith': '/rat.png' })
        const { host, shown } = modalHost()
        mountTrackerPanel(root, bridge, host)
        await settle()
        ;(root.querySelector('.rt-entity-portrait') as HTMLImageElement).click()
        const buttons = Array.from(shown[0]!.root.querySelectorAll('.lh-large-actions button')) as HTMLButtonElement[]
        expect(buttons.map((b) => [b.getAttribute('data-lh-field'), b.disabled])).toEqual([['large-set', true], ['large-draw', false], ['large-remove', false]])
        expect(shown[0]!.root.querySelector('.lh-large-note')!.textContent).toBe('This build has no file picker.')
        buttons[2]!.click()
        await settle()
        await settle()
        // The modal closed with the press, the portrait is gone from the card, and the row says so.
        expect(document.body.contains(shown[0]!.root)).toBe(false)
        expect(root.querySelector('.rt-entity-portrait')).toBeNull()
        expect(root.querySelector('.lh-tracker-status')!.textContent).toBe('Portrait removed for Moth Wraith.')
        // The row's box, now empty, opens the view with the ways to get a portrait: no Remove any more.
        await openManager(root)
        const empty = document.querySelector('.lh-portrait-row .lh-portrait-thumb--empty') as HTMLElement
        expect(empty.getAttribute('data-lh-large')).toBe('Moth Wraith')
        empty.click()
        const again = shown.at(-1)!
        expect(again.title).toBe('Moth Wraith')
        expect(again.root.querySelector('.lh-large-empty')!.textContent).toBe('No portrait yet.')
        expect(Array.from(again.root.querySelectorAll('.lh-large-actions button')).map((b) => b.getAttribute('data-lh-field'))).toEqual(['large-set', 'large-draw'])
    })

    it('offers the file button with a picker (80), and a location’s thumbnail in the Campaign Records draws that place through the scene’s ops', async () => {
        const { bridge, setPortraits, setRecords, setPrefs, sceneOps, portraitOps } = makeBridge({ 'chat-1': COMBAT_MEMO })
        setPortraits({ 'Moth Wraith': '/rat.png', '📍 Abbey Undercroft': '/abbey.png' })
        setRecords({ prefix: 'Vell', books: [{ id: 'b-loc', name: 'Vell_LOC', category: 'LOC', kind: 'location', entries: [
            { id: 'l1', uid: '1', title: 'Abbey Undercroft', keys: ['Abbey Undercroft'], content: 'A crypt.', tokens: 2, pinned: false, disabled: false, hasMap: false, root: true },
            { id: 'l2', uid: '2', title: 'Glassmere', keys: ['Glassmere'], content: 'A lake.', tokens: 2, pinned: false, disabled: false, hasMap: false, root: true },
        ], tokens: 4 }], mapping: false, mapped: [], allBooks: ['Vell_LOC'] })
        // Show Location Images on; the prompt editor skipped, so a Draw is the two ops and no dialog.
        setPrefs({ locationImages: true, portraitSkipPromptDialog: true })
        const { host, shown } = modalHost()
        mountTrackerPanel(root, bridge, { ...host, uploads: { pickFile: async () => [{ name: 'rat.png', bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }] } })
        await settle()
        ;(root.querySelector('.rt-entity-portrait') as HTMLImageElement).click()
        const set = shown[0]!.root.querySelector('[data-lh-field="large-set"]') as HTMLButtonElement
        expect(set.disabled).toBe(false)
        set.click()
        await settle()
        await settle()
        expect(root.querySelector('.rt-entity-portrait')!.getAttribute('src')).toBe('/stored/rat.png')
        // The Locations folder: the thumbnail for the place with a picture, the empty box for the other.
        const pane = root.querySelector('.lh-campaign-records') as HTMLDetailsElement
        pane.open = true
        pane.dispatchEvent(new Event('toggle'))
        await settle()
        await settle()
        ;(root.querySelector('.lh-records-folder-head') as HTMLElement).click()
        const abbey = root.querySelector('[data-lh-entry="l1"] [data-lh-field="records-loc-thumb"]') as HTMLImageElement
        expect(abbey.getAttribute('src')).toBe('/abbey.png')
        const glassmere = root.querySelector('[data-lh-entry="l2"] [data-lh-field="records-loc-thumb"]') as HTMLElement
        expect(glassmere.textContent).toBe('🗺️')
        glassmere.click()
        const view = shown.at(-1)!
        expect(view.title).toBe('Glassmere')
        expect(Array.from(view.root.querySelectorAll('.lh-large-actions button')).map((b) => b.getAttribute('data-lh-field'))).toEqual(['large-set', 'large-draw'])
        ;(view.root.querySelector('[data-lh-field="large-draw"]') as HTMLButtonElement).click()
        await settle()
        await settle()
        await settle()
        // The editor skipped, the backend writes the prompt itself: one op, with the place.
        const ops = sceneOps() as unknown[][]
        expect(ops.find(([op]) => op === 'prompt')).toBeUndefined()
        expect(ops.find(([op]) => op === 'draw')).toEqual(['draw', { chatId: 'chat-1', path: 'Glassmere' }])
        expect(root.querySelector('.lh-tracker-status')!.textContent).toBe('The picture of Glassmere is drawn by pollinations (flux).')
        // Remove on the place with a picture forgets it under its pin.
        abbey.click()
        ;(shown.at(-1)!.root.querySelector('[data-lh-field="large-remove"]') as HTMLButtonElement).click()
        await settle()
        await settle()
        expect((sceneOps() as unknown[][]).find(([op]) => op === 'setImage')).toEqual(['setImage', { chatId: 'chat-1', path: 'Abbey Undercroft', src: '' }])
        expect((portraitOps() as unknown[][]).some(([op]) => op === 'draw')).toBe(false)
    })

    it('leaves the thumbs plain and a card click idle without the host\'s modal', async () => {
        const { bridge, setPortraits } = makeBridge({ 'chat-1': COMBAT_MEMO })
        setPortraits({ 'Moth Wraith': '/rat.png' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const inPlay = root.querySelector('.lh-portrait-row img.lh-portrait-thumb') as HTMLImageElement
        expect(inPlay.hasAttribute('data-lh-large')).toBe(false)
        ;(root.querySelector('.rt-entity-portrait') as HTMLImageElement).click()
        expect(root.querySelector('.rt-entity-portrait')).not.toBeNull()
    })
})

describe('a portrait set by another hand (43-bis)', () => {
    it('redraws the cards when the backend announces a change for this chat, and ignores another chat\'s', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': '[COMBAT]\nENEMIES:\nKestrel ((BAR)) 10/10\n[/COMBAT]' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const thumb = () => root.querySelector('.lh-portrait-row img.lh-portrait-thumb') as HTMLImageElement | null
        expect(thumb()).toBeNull()
        emit({ name: 'portraits.changed', data: { chatId: 'chat-9', portraits: { Kestrel: 'https://host/other.png' } } })
        expect(thumb()).toBeNull()
        emit({ name: 'portraits.changed', data: { chatId: 'chat-1', portraits: { Kestrel: 'https://host/k.png' } } })
        expect(thumb()?.getAttribute('src')).toBe('https://host/k.png')
    })
})

describe('the report history (47e)', () => {
    const PASS = (at: string, status: 'updated' | 'no-change' | 'failed' = 'updated'): TrackerPassReportDTO =>
        ({ status, at, ...(status === 'updated' ? { replaced: ['PARTY'] } : status === 'failed' ? { reason: 'no connection' } : {}) })
    const RUN = (at: string, summary: string): AgentRunResult =>
        ({ at, outcome: 'committed', summary, steps: [], turnsUsed: 1, problems: [], write: { changed: ['Vell_NPC::1'], deleted: [], createdBooks: [], refused: [] } })
    const select = (field: string) => root.querySelector(`select[data-lh-field="${field}"]`) as HTMLSelectElement
    const pick = (field: string, value: string) => { const s = select(field); s.value = value; s.dispatchEvent(new Event('change')) }

    it('hides both rows when there is no history', async () => {
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        expect((select('tracker-report-history').closest('.lh-report-history') as HTMLElement).hidden).toBe(true)
        expect((select('agent-report-history').closest('.lh-report-history') as HTMLElement).hidden).toBe(true)
    })

    it('lists the earlier tracker passes newest first after the last pass, and paints the one picked as history', async () => {
        pinTheClockToNoon()
        const { bridge, setReports, setLastPass } = makeBridge({ 'chat-1': MEMO })
        const now = new Date()
        const earlier = new Date(now.getTime() - 60_000).toISOString()
        const earliest = new Date(now.getTime() - 120_000).toISOString()
        setLastPass(PASS(now.toISOString()))
        setReports({ tracker: [PASS(now.toISOString()), PASS(earlier, 'no-change'), PASS(earliest, 'failed')], agent: [] })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        const list = select('tracker-report-history')
        expect((list.closest('.lh-report-history') as HTMLElement).hidden).toBe(false)
        const options = Array.from(list.options).map((o) => o.textContent)
        expect(options[0]).toBe('The last pass')
        expect(options[1]).toContain('updated PARTY')
        expect(options[2]).toContain('no change')
        expect(options[3]).toContain('failed: no connection')

        pick('tracker-report-history', '2')
        await settle()
        const box = root.querySelector('.lh-tracker-report') as HTMLElement
        expect(box.className).toContain('lh-tracker-report--earlier')
        expect(box.className).toContain('lh-tracker-report--failed')
        expect(box.textContent).toContain('An earlier pass, from the history')
        expect(box.textContent).toContain('Tracker failed')

        pick('tracker-report-history', '')
        await settle()
        expect(box.className).not.toContain('lh-tracker-report--earlier')
        expect(box.textContent).toContain('updated PARTY')
        vi.useRealTimers()
    })

    it('puts a finished pass at the front of the list without a round trip, and the select back on the last pass', async () => {
        const { bridge, emit, requests, setReports } = makeBridge({ 'chat-1': MEMO })
        setReports({ tracker: [PASS('2026-10-10T19:00:00Z', 'no-change')], agent: [] })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        pick('tracker-report-history', '0')
        const before = requests.length

        emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: MEMO, report: PASS('2026-10-10T20:00:00Z') } })
        const list = select('tracker-report-history')
        expect(list.value).toBe('')
        expect(Array.from(list.options).map((o) => o.textContent)[1]).toContain('updated PARTY')
        expect(list.options.length).toBe(3)
        expect(requests.length).toBe(before)
        // The same pass announced twice is listed once; a different pass in the same millisecond is not the same pass.
        emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: MEMO, report: PASS('2026-10-10T20:00:00Z') } })
        expect(list.options.length).toBe(3)
        emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: MEMO, report: PASS('2026-10-10T20:00:00Z', 'no-change') } })
        expect(list.options.length).toBe(4)
    })

    it('lists the agent\'s earlier passes and paints the one picked, and a finished pass joins the list', async () => {
        const { bridge, emit, setReports } = makeBridge({ 'chat-1': MEMO })
        setReports({ tracker: [], agent: [RUN('2026-10-10T19:00:00Z', 'wrote Mother Sedge')] })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()

        const list = select('agent-report-history')
        expect((list.closest('.lh-report-history') as HTMLElement).hidden).toBe(false)
        expect(Array.from(list.options).map((o) => o.textContent)[1]).toContain('1 entry written or deleted')

        pick('agent-report-history', '0')
        const note = root.querySelector('.lh-agent-note') as HTMLElement
        expect(note.textContent).toContain('wrote Mother Sedge')
        expect((root.querySelector('.lh-agent-detail') as HTMLElement).textContent).toContain('An earlier pass, from the history')
        expect((root.querySelector('.lh-agent-detail') as HTMLElement).textContent).toContain('Written: Vell_NPC::1')

        emit({ name: 'agent.finished', data: { chatId: 'chat-1', ...RUN('2026-10-10T20:00:00Z', 'wrote the ranch') } })
        expect(list.value).toBe('')
        expect(list.options.length).toBe(3)
        expect(note.textContent).toContain('wrote the ranch')
        expect((root.querySelector('.lh-agent-detail') as HTMLElement).textContent).not.toContain('An earlier pass')
    })

    it('steps the cards to the memo as it stood after the pass picked, and back to live for the last pass', async () => {
        const T = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString()
        const older = '[PARTY]\nBrenna: 9/12 HP\n[/PARTY]'
        const middle = '[TIME]\n06:15 AM, Day 4\n[/TIME]'
        const { bridge, setReports, setSnapshots, setLastPass } = makeBridge({ 'chat-1': MEMO })
        setLastPass(PASS(T(1)))
        setSnapshots([
            { messageId: 'm83', memo: MEMO, at: T(1), messageNumber: 83 },
            { messageId: 'm82', memo: middle, at: T(10), messageNumber: 82 },
            { messageId: 'm81', memo: older, at: T(20), messageNumber: 81 },
        ])
        setReports({ tracker: [PASS(T(1)), PASS(T(5), 'no-change'), PASS(T(10)), PASS(T(20)), PASS(T(40))], agent: [] })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const titles = () => Array.from(root.querySelectorAll('.rt-section-title')).map((n) => n.textContent)
        const label = () => root.querySelector('.lh-tracker-history-label')?.textContent ?? ''
        const live = titles()
        expect(live.length).toBeGreaterThan(1)

        // The pass that wrote the middle state: the cards show it.
        pick('tracker-report-history', '2')
        await settle()
        expect(titles()).toEqual(['TIME'])
        expect(label()).toContain('#82')

        // A no-change pass five minutes ago: the state then was the middle one too.
        pick('tracker-report-history', '1')
        await settle()
        expect(titles()).toEqual(['TIME'])

        // The oldest kept state.
        pick('tracker-report-history', '3')
        await settle()
        expect(titles()).toEqual(['PARTY'])
        expect(label()).toContain('#81')

        // A pass older than the memo history keeps: the report alone, and a note.
        pick('tracker-report-history', '4')
        await settle()
        expect(titles()).toEqual(['PARTY'])
        expect((root.querySelector('.lh-tracker-report') as HTMLElement).textContent).toContain('older than the memo history keeps')

        // The last pass: live again, and the box no longer dashed.
        pick('tracker-report-history', '')
        await settle()
        expect(titles()).toEqual(live)
        expect(label()).toBe('[ LIVE ]')
        expect((root.querySelector('.lh-tracker-report') as HTMLElement).className).not.toContain('earlier')

        // The newest pass's own state is the live memo: picking it shows live, not the turn before.
        pick('tracker-report-history', '0')
        await settle()
        expect(titles()).toEqual(live)
        expect(label()).toBe('[ LIVE ]')
    })

    it('reads the history again on a chat switch, and ignores a read that lands for the chat left', async () => {
        const { bridge, requests, setReports, holdReports, releaseReports } = makeBridge({ 'chat-1': MEMO, 'chat-2': MEMO })
        setReports({ tracker: [PASS('2026-10-10T19:00:00Z')], agent: [] })
        let chatId = 'chat-1'
        const host: TrackerPanelHost = { ...makeHost(), getActiveChat: () => ({ chatId, characterId: null }) }
        // The first chat's read is held back until after the switch.
        holdReports()
        const panel = mountTrackerPanel(root, bridge, host)
        await settle()
        expect(requests.filter((r) => r.op === 'reports.history').map((r) => r.params?.chatId)).toEqual(['chat-1'])
        setReports({ tracker: [], agent: [] })
        chatId = 'chat-2'
        await panel.refresh()
        await settle()
        expect(requests.filter((r) => r.op === 'reports.history').map((r) => r.params?.chatId)).toEqual(['chat-1', 'chat-2'])
        const row = select('tracker-report-history').closest('.lh-report-history') as HTMLElement
        expect(row.hidden).toBe(true)
        // The first chat's answer lands now, with a pass in it: it is not this chat's.
        releaseReports()
        await settle()
        expect(row.hidden).toBe(true)
        expect(select('tracker-report-history').options.length).toBe(1)
    })
})

describe('the PARTY compact mode (47e-ter)', () => {
    const PARTY_MEMO = '[PARTY]\nElara (Ranger): 26/45 HP\nSkills: Athletics +3\n[/PARTY]'

    it('flips the mode with the card\'s button, writes the preference, and does not fold the card', async () => {
        const { bridge, requests } = makeBridge({ 'chat-1': PARTY_MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const section = () => root.querySelector('.rt-section[data-tag="PARTY"]') as HTMLElement
        expect(section().classList.contains('rt-party-compact')).toBe(false)

        ;(root.querySelector('.rt-party-compact-btn') as HTMLButtonElement).click()
        expect(section().classList.contains('rt-party-compact')).toBe(true)
        expect(section().classList.contains('rt-section--collapsed')).toBe(false)
        expect((root.querySelector('.rt-party-compact-btn') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
        await settle()
        expect(requests.filter((r) => r.op === 'prefs.patch').at(-1)?.params).toEqual({ patch: { partyCompact: true } })

        ;(root.querySelector('.rt-party-compact-btn') as HTMLButtonElement).click()
        expect(section().classList.contains('rt-party-compact')).toBe(false)
        await settle()
        expect(requests.filter((r) => r.op === 'prefs.patch').at(-1)?.params).toEqual({ patch: { partyCompact: false } })
    })

    it('starts in the mode the preference holds', async () => {
        const { bridge } = makeBridge({ 'chat-1': PARTY_MEMO })
        const first = mountTrackerPanel(root, bridge, makeHost())
        await settle()
        ;(root.querySelector('.rt-party-compact-btn') as HTMLButtonElement).click()
        await settle()
        first.destroy()

        root.replaceChildren()
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        expect((root.querySelector('.rt-section[data-tag="PARTY"]') as HTMLElement).classList.contains('rt-party-compact')).toBe(true)
    })
})

describe('Campaign records in the agent fold (71a)', () => {
    const fold = () => root.querySelector('[data-lh-field="records"]') as HTMLDetailsElement
    const open = async () => { fold().open = true; fold().dispatchEvent(new Event('toggle')); await settle() }

    it('sits after the Lorebooks list, reads the records for the chat when opened, and reads again when a pass finishes', async () => {
        const { bridge, bookOps, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        // The Campaign Records pane's first part since 78a; the Lorebooks list is the Campaign fold's.
        const pane = root.querySelector('.lh-campaign-records')!
        expect(pane.querySelector('.lh-agent-drawer-body')!.firstElementChild).toBe(fold())
        expect(root.querySelector('[data-lh-field="agent-campaign"] [data-lh-field="books"]')).not.toBeNull()
        expect(bookOps.filter((o) => o[0] === 'records')).toEqual([])
        await open()
        expect(bookOps.filter((o) => o[0] === 'records')).toEqual([['records', { chatId: 'chat-1' }]])
        expect(fold().querySelector('summary')!.textContent).toBe('Campaign records — 1 book')
        ;(fold().querySelector('.lh-records-folder-head') as HTMLElement).click()
        // The NPCs are Multihog's cards since 78b (the portraits switch on), the name in its own span beside the tokens.
        expect(fold().querySelector('.lh-npc-card[data-lh-entry="e1"] .lh-npc-name-text')!.textContent).toBe('Elara')
        emit({ name: 'agent.finished', data: { chatId: 'chat-1', at: 't', outcome: 'changed', summary: 'x', steps: [], turnsUsed: 1, problems: [] } })
        await settle()
        expect(bookOps.filter((o) => o[0] === 'records')).toHaveLength(2)
        emit({ name: 'map.architect.finished', data: { chatId: 'chat-1', status: 'written', at: 't', site: 'Abbey' } })
        await settle()
        expect(bookOps.filter((o) => o[0] === 'records')).toHaveLength(3)
    })

    it('runs the clean as the cleanup pass on that entry (71c), so the report lands in the agent’s box', async () => {
        const { bridge, requests } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        await open()
        ;(fold().querySelector('.lh-records-folder-head') as HTMLElement).click()
        ;(fold().querySelector('[data-lh-field="records-clean"]') as HTMLButtonElement).click()
        ;(fold().querySelector('[data-lh-field="records-clean-go"]') as HTMLButtonElement).click()
        await settle()
        const sent = requests.find((r) => r.op === 'agent.cleanup')
        expect(sent).toBeDefined()
        expect(String((sent!.params as { target?: string }).target)).toMatch(/^Vell_NPC::/)
        expect(requests.some((r) => r.op === 'agent.instruct')).toBe(false)
    })
})

describe('the campaign’s lorebooks (55)', () => {
    const fold = () => root.querySelector('[data-lh-field="books"]') as HTMLDetailsElement
    const summary = () => fold().querySelector('summary')!.textContent ?? ''
    const rows = () => Array.from(fold().querySelectorAll('.lh-book-row[data-lh-book]')).map((r) => [r.getAttribute('data-lh-book'), (['missing', 'attached', 'detached', 'adoptable'] as const).find((s) => r.classList.contains(`lh-book-row--${s}`)), r.querySelector('.lh-book-words')?.textContent])
    const note = () => fold().querySelector('.lh-books-note')!.textContent ?? ''
    const open = async () => { fold().open = true; fold().dispatchEvent(new Event('toggle')); await settle() }

    it('offers Adopt on a book named as the campaign’s that another chat made (56), and says what it did', async () => {
        const { bridge, setBooks, requests } = makeBridge({ 'chat-1': MEMO })
        setBooks({ prefix: 'Vell', card: { id: 'card-1', name: 'Vell Keeper' }, target: 'chat', chatScope: true, books: [
            { kind: 'NPC', name: 'Vell_NPC', id: 'b-npc', state: 'adoptable', sources: ['chat'] },
        ] })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        await open()
        expect(rows()).toEqual([['Vell_NPC', 'adoptable', 'made under this name, but not this campaign’s: adopt it to write into it here']])
        expect(summary()).toBe('Lorebooks — 0 of 1 attached')
        setBooks({ prefix: 'Vell', card: { id: 'card-1', name: 'Vell Keeper' }, target: 'chat', chatScope: true, books: [
            { kind: 'NPC', name: 'Vell_NPC', id: 'b-npc', state: 'attached', sources: ['chat'] },
        ] })
        ;(root.querySelector('button[aria-label="Adopt Vell_NPC as this campaign’s"]') as HTMLButtonElement).click()
        await settle()
        expect(requests.some((r) => r.op === 'lore.adopt' && (r.params as { bookId?: string })?.bookId === 'b-npc')).toBe(true)
        expect(note()).toBe('Vell_NPC is this campaign’s now, attached to this chat; the agent writes into it from the next pass.')
        expect(rows()[0]).toEqual(['Vell_NPC', 'attached', 'attached to this chat'])
    })

    it('reads the books again on every open (55-quater): a book made while the fold was closed is not read by the event, and was grey until Check again', async () => {
        const { bridge, bookOps, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        await open()
        expect(bookOps).toHaveLength(1)
        fold().open = false
        fold().dispatchEvent(new Event('toggle'))
        emit({ name: 'agent.finished', data: { chatId: 'chat-1', at: new Date().toISOString(), outcome: 'committed', summary: 'x', steps: [], turnsUsed: 1, problems: [] } })
        await settle()
        expect(bookOps).toHaveLength(1)
        await open()
        expect(bookOps).toHaveLength(2)
    })

    it('follows the target (55-ter): the chat by default, with its words on the buttons and the note; the card when the select says, saved as a preference and the list read again', async () => {
        const { bridge, bookOps, setBooks, requests } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        await open()
        const target = fold().querySelector('[data-lh-field="books-target"]') as HTMLSelectElement
        expect(target.value).toBe('chat')
        expect((fold().querySelector('[data-lh-field="books-attach-all"]') as HTMLButtonElement).textContent).toBe('Attach all to this chat')
        expect(root.querySelector('button[aria-label="Attach Vell_LOC to this chat"]')).not.toBeNull()
        // The card, chosen: the words change at once, the preference is saved, and the list is read again.
        setBooks({ prefix: 'Vell', card: { id: 'card-1', name: 'Vell Keeper' }, target: 'card', chatScope: true, books: [{ kind: 'LOC', name: 'Vell_LOC', id: 'b-loc', state: 'detached', sources: [] }] })
        const reads = bookOps.length
        target.value = 'card'
        target.dispatchEvent(new Event('change'))
        expect((fold().querySelector('[data-lh-field="books-attach-all"]') as HTMLButtonElement).textContent).toBe('Attach all to the card')
        await settle()
        expect(requests.some((r) => r.op === 'prefs.patch' && (r.params as { patch?: Record<string, unknown> })?.patch?.attachBooksTarget === 'card')).toBe(true)
        expect(bookOps.length).toBe(reads + 1)
        ;(root.querySelector('button[aria-label="Attach Vell_LOC to the card"]') as HTMLButtonElement).click()
        await settle()
        expect(note()).toBe('Vell_LOC is attached to “Vell Keeper”; the narrator sees it from the next reply.')
        expect(rows()[0]).toEqual(['Vell_LOC', 'attached', 'attached to the card'])
        // The chat's record not writable with the chat the target: no Attach, and the note says where to go.
        root.replaceChildren()
        const stuck = makeBridge({ 'chat-1': MEMO })
        stuck.setBooks({ prefix: 'Vell', card: { id: 'card-1', name: 'Vell Keeper' }, target: 'chat', chatScope: false, books: [{ kind: 'LOC', name: 'Vell_LOC', id: 'b-loc', state: 'detached', sources: [] }] })
        mountTrackerPanel(root, stuck.bridge, makeHost())
        await settle()
        await open()
        expect(root.querySelector('button[aria-label="Attach Vell_LOC to this chat"]')).toBeNull()
        expect(note()).toBe('The chat’s record cannot be written, so nothing can be attached from here; attach the books in Lumiverse’s own lorebook settings for this chat.')
        // The preference loaded as the card sets the select.
        root.replaceChildren()
        const loaded = makeBridge({ 'chat-1': MEMO })
        loaded.setPrefs({ attachBooksTarget: 'card' })
        mountTrackerPanel(root, loaded.bridge, makeHost())
        await settle()
        expect((fold().querySelector('[data-lh-field="books-target"]') as HTMLSelectElement).value).toBe('card')
    })

    it('reads nothing until opened, then lists each book grey, green or red with words, counts the unattached in the summary, and attaches one or all', async () => {
        const { bridge, bookOps, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        expect(bookOps).toEqual([])
        expect(summary()).toBe('Lorebooks')
        await open()
        expect(bookOps).toEqual([['books', { chatId: 'chat-1' }]])
        expect(rows()).toEqual([
            ['Vell_NPC', 'attached', 'attached to the card'],
            ['Vell_LOC', 'detached', 'made, but not attached: the narrator does not see it'],
            ['Vell_QUEST', 'missing', 'not made yet'],
        ])
        expect(summary()).toBe('Lorebooks — 1 not attached')
        expect(fold().querySelector('summary')!.classList.contains('lh-books-summary--warn')).toBe(true)
        expect((fold().querySelector('[data-lh-field="books-attach-all"]') as HTMLButtonElement).hidden).toBe(false)
        ;(root.querySelector('button[aria-label="Attach Vell_LOC to this chat"]') as HTMLButtonElement).click()
        await settle()
        expect(bookOps.at(-1)).toEqual(['attach', { chatId: 'chat-1', bookId: 'b-loc' }])
        expect(note()).toBe('Vell_LOC is attached to this chat; the narrator sees it from the next reply.')
        expect(summary()).toBe('Lorebooks — 2 of 3 attached')
        expect(rows()[1]).toEqual(['Vell_LOC', 'attached', 'attached to this chat'])
        expect((fold().querySelector('[data-lh-field="books-attach-all"]') as HTMLButtonElement).hidden).toBe(true)
        // A pass finishing reads again while the fold is open.
        const before = bookOps.length
        emit({ name: 'agent.finished', data: { chatId: 'chat-1', at: new Date().toISOString(), outcome: 'committed', summary: 'x', steps: [], turnsUsed: 1, problems: [] } })
        await settle()
        expect(bookOps.length).toBe(before + 1)
    })

    it('attaches all, says when the card is not known with the card the target, names a read that failed, and saves the switch', async () => {
        const { bridge, bookOps, setBooks } = makeBridge({ 'chat-1': MEMO })
        setBooks({ prefix: 'Vell', card: { id: 'card-1', name: 'Vell Keeper' }, target: 'chat', chatScope: true, books: [
            { kind: 'NPC', name: 'Vell_NPC', id: 'b-npc', state: 'detached', sources: [] },
            { kind: 'LOC', name: 'Vell_LOC', id: 'b-loc', state: 'detached', sources: ['persona'] },
        ], problem: 'the global lorebooks could not be read: PERMISSION_DENIED' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        await open()
        expect(note()).toBe('Something could not be read: the global lorebooks could not be read: PERMISSION_DENIED.')
        ;(fold().querySelector('[data-lh-field="books-attach-all"]') as HTMLButtonElement).click()
        await settle()
        expect(bookOps.at(-1)).toEqual(['attach', { chatId: 'chat-1' }])
        expect(note()).toBe('The books are attached to this chat; the narrator sees them from the next reply.')
        // No card known, the card the target: no Attach buttons, and the note says where to go.
        root.replaceChildren()
        const blind = makeBridge({ 'chat-1': MEMO })
        blind.setBooks({ prefix: 'Vell', card: null, target: 'card', chatScope: true, books: [{ kind: 'NPC', name: 'Vell_NPC', id: 'b-npc', state: 'detached', sources: [] }] })
        mountTrackerPanel(root, blind.bridge, makeHost())
        await settle()
        await open()
        expect(root.querySelector('button[aria-label="Attach Vell_NPC to the card"]')).toBeNull()
        expect(note()).toBe('The chat’s card is not known, so nothing can be attached from here; attach the books in Lumiverse’s character editor.')
        // The switch saves the preference.
        const auto = fold().querySelector('[data-lh-field="books-auto"]') as HTMLInputElement
        expect(auto.checked).toBe(true)
        auto.checked = false
        auto.dispatchEvent(new Event('change'))
        await settle()
        expect(blind.requests.some((r) => r.op === 'prefs.patch' && (r.params as { patch?: Record<string, unknown> })?.patch?.attachBooksToCard === false)).toBe(true)
    })
})

describe('the portraits drawn as they appear (61)', () => {
    const COMBAT_MEMO = ['[COMBAT]', 'COMBAT ROUND 1', 'ENEMIES:', 'Moth Wraith (a construct) ((BAR)) 10/10', 'ALLIES:', 'Dream Sprite ((BAR)) 9/9', '[/COMBAT]'].join('\n')
    // In the document rather than the root: on a host with a modal the rows are behind the NPC/PC Manager (78b).
    const fold = () => document.querySelector('.lh-portraits') as HTMLElement
    const rows = () => Array.from(fold().querySelectorAll('.lh-portrait-row'))
    const rowFor = (name: string) => rows().find((row) => row.querySelector('.lh-portrait-name')?.textContent === name)!
    const noteOf = (name: string) => rowFor(name).querySelector('.lh-portrait-note')!.textContent
    const drawButton = (name: string) => fold().querySelector(`button[aria-label="Draw the portrait of “${name}”"]`) as HTMLButtonElement
    const light = (key: string) => root.querySelector(`.lh-light--${key}`) as HTMLElement
    const state = (key: string) => (['idle', 'running', 'done', 'failed'] as const).find((s) => light(key).classList.contains(`lh-light--${s}`))

    it('asks what is being drawn when the chat loads, and the rows say so: drawing, queued, drawn, or why not', async () => {
        const made = makeBridge({ 'chat-1': COMBAT_MEMO })
        made.setPortraitAuto({
            drawing: [{ name: 'Moth Wraith (a construct)', at: '2026-10-15T12:00:00.000Z' }],
            queued: ['Dream Sprite'],
            last: { 'Dream Sprite': { chatId: 'chat-1', name: 'Dream Sprite', at: 't', source: 'enemy', outcome: 'failed', reason: 'the provider is down' } },
        })
        mountTrackerPanel(root, made.bridge, makeHost())
        await settle()
        expect(made.portraitOps()).toEqual([['status', { chatId: 'chat-1' }]])
        expect(noteOf('Moth Wraith (a construct)')).toMatch(/^drawing now, since /)
        expect(drawButton('Moth Wraith (a construct)').disabled).toBe(true)
        // Queued outranks the last outcome, which was before.
        expect(noteOf('Dream Sprite')).toBe('queued to be drawn')
        expect(drawButton('Dream Sprite').disabled).toBe(true)
        expect(state('picture')).toBe('running')

        document.body.replaceChildren()
        root = document.createElement('div')
        document.body.append(root)
        const other = makeBridge({ 'chat-1': COMBAT_MEMO })
        other.setPortraitAuto({ drawing: [], queued: [], last: {
            'Moth Wraith': { chatId: 'chat-1', name: 'Moth Wraith (a construct)', at: 't', source: 'pressed', outcome: 'drawn', provider: 'swarmui', model: 'anima', size: '896×1344' },
            'Dream Sprite': { chatId: 'chat-1', name: 'Dream Sprite', at: 't', source: 'enemy', outcome: 'failed', reason: 'the provider is down' },
        } })
        mountTrackerPanel(root, other.bridge, makeHost())
        await settle()
        expect(noteOf('Moth Wraith (a construct)')).toBe('drawn by swarmui (anima), 896×1344')
        expect(noteOf('Dream Sprite')).toBe('could not be drawn — the provider is down')
        expect(rowFor('Dream Sprite').classList.contains('lh-portrait-row--problem')).toBe(true)
        expect(drawButton('Dream Sprite').disabled).toBe(false)
        expect(state('picture')).toBe('idle')
    })

    it('the prompt editor before a pressed draw (73f): the prompt is written and shown in the host’s modal, Draw sends the edited text and the tick writes the preference, Cancel draws nothing, and the preference on draws at once', async () => {
        const made = makeBridge({ 'chat-1': COMBAT_MEMO })
        const shown: Array<{ title: string; root: HTMLElement }> = []
        const host = {
            ...makeHost(),
            ui: {
                showConfirm: async () => ({ confirmed: true }),
                showModal: (options: { title: string }) => { const modalRoot = document.createElement('div'); document.body.append(modalRoot); shown.push({ title: options.title, root: modalRoot }); return { root: modalRoot, dismiss: () => modalRoot.remove() } },
            },
        }
        mountTrackerPanel(root, made.bridge, host)
        await settle()
        // The rows are the library's foot, behind the NPC/PC Manager on a host with a modal (78b).
        await openManager(root)
        drawButton('Moth Wraith (a construct)').click()
        await settle()
        expect(made.portraitOps().slice(1)).toEqual([['prompt', { chatId: 'chat-1', name: 'Moth Wraith (a construct)' }]])
        expect(shown.map((m) => m.title)).toEqual(['📚 NPC/PC Manager', 'The portrait of Moth Wraith (a construct)'])
        expect(root.querySelector('.lh-tracker-status')!.textContent).toBe('Writing the prompt for Moth Wraith (a construct)…')
        const text = shown[1]!.root.querySelector('[data-lh-field="prompt-dialog-text"]') as HTMLTextAreaElement
        expect(text.value).toBe('A lean ranger.')
        text.value = 'A rat in a paper crown.'
        ;(shown[1]!.root.querySelector('[data-lh-field="prompt-dialog-skip"]') as HTMLInputElement).checked = true
        ;(Array.from(shown[1]!.root.querySelectorAll('button')).find((b) => b.textContent === '🎨 Draw') as HTMLButtonElement).click()
        await settle()
        expect(made.portraitOps().slice(2)).toEqual([['draw', { chatId: 'chat-1', name: 'Moth Wraith (a construct)', prompt: 'A rat in a paper crown.' }]])
        expect(root.querySelector('.lh-tracker-status')!.textContent).toBe('The portrait of Moth Wraith (a construct) is drawn by swarmui (anima), 896×1344.')
        expect(made.requests.filter((r) => r.op === 'prefs.patch').map((r) => r.params?.patch)).toContainEqual({ portraitSkipPromptDialog: true })
        // Cancel: nothing drawn, and the row says so.
        drawButton('Moth Wraith (a construct)').click()
        await settle()
        ;(Array.from(shown[2]!.root.querySelectorAll('button')).find((b) => b.textContent === 'Cancel') as HTMLButtonElement).click()
        await settle()
        expect(made.portraitOps().filter((op) => (op as unknown[])[0] === 'draw')).toHaveLength(1)
        expect(root.querySelector('.lh-tracker-status')!.textContent).toBe('Nothing was drawn.')
        // The preference on: no prompt call, no modal, the draw at once.
        made.setPrefs({ portraitSkipPromptDialog: true })
        drawButton('Moth Wraith (a construct)').click()
        await settle()
        expect(made.portraitOps().at(-1)).toEqual(['draw', { chatId: 'chat-1', name: 'Moth Wraith (a construct)' }])
        expect(shown).toHaveLength(3)
    })

    it('Draw on a row sends the chat and the name, says what landed, and a failure is reported on the row', async () => {
        const made = makeBridge({ 'chat-1': COMBAT_MEMO })
        mountTrackerPanel(root, made.bridge, makeHost())
        await settle()
        drawButton('Moth Wraith (a construct)').click()
        await settle()
        expect(made.portraitOps().slice(1)).toEqual([['draw', { chatId: 'chat-1', name: 'Moth Wraith (a construct)' }]])
        expect(root.querySelector('.lh-tracker-status')!.textContent).toBe('The portrait of Moth Wraith (a construct) is drawn by swarmui (anima), 896×1344.')
        made.failPortraitDraw('This build cannot draw portraits.')
        drawButton('Dream Sprite').click()
        await settle()
        expect(root.querySelector('.lh-problem')!.textContent).toContain('This build cannot draw portraits.')
    })

    it('reads the draw’s events: amber with the name while it runs, the row and the prompt box after, red naming Portraits in play, reset on a chat change', async () => {
        pinTheClockToNoon()
        const made = makeBridge({ 'chat-1': COMBAT_MEMO, 'chat-2': MEMO })
        let active = 'chat-1'
        const panel = mountTrackerPanel(root, made.bridge, { ...makeHost(), getActiveChat: () => ({ chatId: active, characterId: null }) })
        await settle()
        // Another chat's draw is not this panel's.
        made.emit({ name: 'portrait.draw.started', data: { chatId: 'chat-2', name: 'Elsewhere', at: new Date().toISOString(), source: 'party', queued: 0 } })
        expect(state('picture')).toBe('idle')
        made.emit({ name: 'portrait.draw.started', data: { chatId: 'chat-1', name: 'Moth Wraith (a construct)', at: new Date().toISOString(), source: 'enemy', queued: 0 } })
        expect(state('picture')).toBe('running')
        expect(light('picture').title).toBe('The scene picture: drawing the portrait of Moth Wraith (a construct) now, since 12:00 PM')
        expect(noteOf('Moth Wraith (a construct)')).toBe('drawing now, since 12:00 PM…')
        expect(drawButton('Moth Wraith (a construct)').disabled).toBe(true)
        made.emit({ name: 'portrait.draw.finished', data: { chatId: 'chat-1', name: 'Moth Wraith (a construct)', at: new Date().toISOString(), source: 'enemy', outcome: 'drawn', prompt: 'A rat of dreams.', provider: 'swarmui', model: 'anima', size: '896×1344' } })
        expect(state('picture')).toBe('done')
        expect(noteOf('Moth Wraith (a construct)')).toBe('drawn by swarmui (anima), 896×1344')
        expect(drawButton('Moth Wraith (a construct)').disabled).toBe(false)
        const prompt = fold().querySelector('[data-lh-field="portrait-prompt"]') as HTMLElement
        expect(prompt.hidden).toBe(false)
        expect(prompt.textContent).toBe('Moth Wraith (a construct): A rat of dreams.')
        made.emit({ name: 'portrait.draw.finished', data: { chatId: 'chat-1', name: 'Dream Sprite', at: new Date(Date.now() + 1000).toISOString(), source: 'enemy', outcome: 'failed', reason: 'boom' } })
        expect(state('picture')).toBe('failed')
        expect(light('picture').title).toBe('The scene picture: the last draw failed — open the Portraits in play for why')
        expect(noteOf('Dream Sprite')).toBe('could not be drawn — boom')
        // A library draw after it is the newer: its words.
        made.emit({ name: 'library.photo.finished', data: { chatId: 'chat-1', name: 'Kestrel', at: new Date(Date.now() + 2000).toISOString(), outcome: 'failed', reason: 'boom' } })
        expect(light('picture').title).toBe('The scene picture: the last draw failed — open the NPC library for why')
        active = 'chat-2'
        await panel.refresh()
        await settle()
        expect(state('picture')).toBe('idle')
        vi.useRealTimers()
    })

    it('carries the settings inside the fold: the four switches read from the preferences, a tick saves and asks for the check, and the prompt’s select lists the text connections', async () => {
        const made = makeBridge({ 'chat-1': COMBAT_MEMO })
        made.setPrefs({ portraitAutoParty: true, portraitStoryLookback: true, portraitStoryLookbackCount: 8, portraitPromptConnectionId: 'conn-2' })
        made.setConnections([{ id: 'conn-1', name: 'Fast', model: 'flux', isDefault: true }, { id: 'conn-2', name: 'Slow', model: '', isDefault: false }])
        mountTrackerPanel(root, made.bridge, makeHost())
        await settle()
        const settings = fold().querySelector('.lh-portrait-settings') as HTMLDetailsElement
        expect(settings).not.toBeNull()
        expect(settings.querySelector('summary')!.textContent).toBe('Drawing the portraits')
        const field = <T extends HTMLElement>(name: string) => settings.querySelector(`[data-lh-field="${name}"]`) as T
        expect(field<HTMLInputElement>('portrait-auto-party').checked).toBe(true)
        expect(field<HTMLInputElement>('portrait-auto-npcs').checked).toBe(false)
        expect(field<HTMLInputElement>('portrait-lookback').checked).toBe(true)
        expect(field<HTMLInputElement>('portrait-lookback-count').value).toBe('8')
        const promptSelect = field<HTMLSelectElement>('portrait-prompt-connection')
        expect(Array.from(promptSelect.options).map((o) => o.textContent)).toEqual(['The agent’s connection', 'Fast — flux', 'Slow'])
        expect(promptSelect.value).toBe('conn-2')
        const npcs = field<HTMLInputElement>('portrait-auto-npcs')
        npcs.checked = true
        npcs.dispatchEvent(new Event('change'))
        await settle()
        const patches = made.requests.filter((r) => r.op === 'prefs.patch').map((r) => (r.params as { patch: unknown }).patch)
        expect(patches).toContainEqual({ portraitAutoNpcs: true })
        expect(made.portraitOps().slice(1)).toEqual([['check', { chatId: 'chat-1' }]])
    })
})

describe('the connections mirrored (63)', () => {
    it('a prefs.changed event moves the tracker’s, the agent’s, evolution’s, the creator’s, the scene’s and the portraits’ selects', async () => {
        const made = makeBridge({ 'chat-1': MEMO })
        made.setConnections([{ id: 'conn-1', name: 'Main', model: 'deepseek', isDefault: true }, { id: 'conn-2', name: 'Fast', model: '', isDefault: false }])
        mountTrackerPanel(root, made.bridge, makeHost())
        await settle()
        made.emit({ name: 'prefs.changed', data: { prefs: { trackerConnectionId: 'conn-2', agentConnectionId: 'conn-1', mapEvolutionConnectionId: 'conn-2', creatorConnectionId: 'conn-1', scenePictureConnectionId: 'img-7', portraitConnectionId: 'img-8', portraitPromptConnectionId: 'conn-2' } } })
        expect((root.querySelector('[data-lh-field="agent-model"] select') as HTMLSelectElement).value).toBe('conn-1')
        expect((root.querySelector('[data-lh-field="creator-connection"] select') as HTMLSelectElement).value).toBe('conn-1')
        expect((root.querySelector('[data-lh-field="scene-picture-connection"]') as HTMLSelectElement).value).toBe('img-7')
        expect((root.querySelector('[data-lh-field="portrait-connection"]') as HTMLSelectElement).value).toBe('img-8')
        expect((root.querySelector('[data-lh-field="portrait-prompt-connection"]') as HTMLSelectElement).value).toBe('conn-2')
        // An event without a preference leaves every select as it was.
        made.emit({ name: 'prefs.changed', data: { prefs: { messageCards: true } } })
        expect((root.querySelector('[data-lh-field="agent-model"] select') as HTMLSelectElement).value).toBe('conn-1')
    })

    it('moves the tracker’s and the agent’s dials and the creator’s starting choices, and re-reads the world and the maps only when one of their keys moved (63c)', async () => {
        const made = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, made.bridge, makeHost())
        await settle()
        const count = (op: string) => made.requests.filter((r) => r.op === op).length
        const worldBefore = count('world.get')
        const mapBefore = count('map.get')
        const prefs = { trackerRunEvery: 4, agentLookback: 12, agentMaxTurns: 9, trackerLookbackMode: 'fixed', trackerLookbackCount: 7, attachBooksTarget: 'card', creatorLevel: 5 }
        made.emit({ name: 'prefs.changed', data: { prefs } })
        expect(root.textContent).toContain('The agent reads the last 12 messages of this chat.')
        expect(root.textContent).toContain('Up to 9 model calls per pass')
        expect((root.querySelector('[data-lh-field="books-target"]') as HTMLSelectElement).value).toBe('card')
        expect((root.querySelector('[data-lh-field="creator-level-input"]') as HTMLSelectElement).value).toBe('5')
        await settle()
        expect(count('world.get')).toBe(worldBefore)
        expect(count('map.get')).toBe(mapBefore)
        made.emit({ name: 'prefs.changed', data: { prefs: { ...prefs, worldProgressionIntervalHours: 48 } } })
        await settle()
        expect(count('world.get')).toBe(worldBefore + 1)
        expect(count('map.get')).toBe(mapBefore)
        made.emit({ name: 'prefs.changed', data: { prefs: { ...prefs, worldProgressionIntervalHours: 48, mapUpdaterRunEvery: 3 } } })
        await settle()
        expect(count('world.get')).toBe(worldBefore + 1)
        expect(count('map.get')).toBe(mapBefore + 1)
    })

    it('moves the scene’s drawing dials and the portraits’ switches too (63b)', async () => {
        const made = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, made.bridge, makeHost())
        await settle()
        made.emit({ name: 'prefs.changed', data: { prefs: { scenePictureAuto: true, scenePictureTrigger: 'every_n_outputs', scenePictureEveryN: 7, portraitAutoParty: true, portraitStoryLookback: true } } })
        expect((root.querySelector('[data-lh-field="scene-picture-auto"]') as HTMLInputElement).checked).toBe(true)
        expect((root.querySelector('[data-lh-field="scene-picture-trigger"]') as HTMLSelectElement).value).toBe('every_n_outputs')
        expect((root.querySelector('[data-lh-field="scene-picture-every"]') as HTMLInputElement).value).toBe('7')
        expect((root.querySelector('[data-lh-field="scene-picture-every"]')!.closest('label') as HTMLElement).hidden).toBe(false)
        expect((root.querySelector('[data-lh-field="portrait-auto-party"]') as HTMLInputElement).checked).toBe(true)
        expect((root.querySelector('[data-lh-field="portrait-lookback-count"]')!.closest('label') as HTMLElement).hidden).toBe(false)
    })
})

describe('the cards’ display preferences (72b)', () => {
    const INVENTORY = ['[TIME]', '06:15 AM, Day 4', '[/TIME]', '[INVENTORY]', '- Volcanic Mace (~120 GP) [E]', '- 45 GP', '[/INVENTORY]', '[PARTY]', 'Kael: 12/12 HP', '[/PARTY]'].join('\n')
    it('draws the portraits unless the switch is off, and the inventory’s worth as the preferences say, following prefs.changed', async () => {
        const { bridge, emit, setPrefs, setPortraits } = makeBridge({ 'chat-1': INVENTORY })
        setPortraits({ Kael: 'data:image/png;base64,AAA' })
        setPrefs({ portraitsEnabled: false, inventoryShowTotal: true, inventoryWorthMode: 'display' })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        await settle()
        const cards = () => root.querySelector('.lh-tracker-cards') as HTMLElement
        expect(cards().querySelector('.rt-entity-portrait')).toBeNull()
        expect(cards().querySelector('.rt-total-value-badge')!.textContent).toBe('165 GP')
        emit({ name: 'prefs.changed', data: { prefs: { portraitsEnabled: true, inventoryShowTotal: false, inventoryWorthMode: 'hover' } } })
        await settle()
        expect(cards().querySelector('.rt-entity-portrait')).not.toBeNull()
        expect(cards().querySelector('.rt-total-value-badge')).toBeNull()
        expect(cards().innerHTML).toContain('title="Worth: 120 GP"')
    })
})

describe('the XP bar at the bottom (74f)', () => {
    const XP = ['[XP]', 'Total: 1,200 / 2,700 XP (Level 3)', '[/XP]', '[TIME]', '06:15 AM, Day 4', '[/TIME]'].join('\n')
    it('draws the XP row at the foot of the play parts and leaves the XP card out while the preference is on, and follows it', async () => {
        const { bridge, emit, setPrefs } = makeBridge({ 'chat-1': XP })
        setPrefs({ xpBarAtBottom: true })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        await settle()
        const cards = () => root.querySelector('.lh-tracker-cards') as HTMLElement
        const bar = root.querySelector('.lh-bottom-xp') as HTMLElement
        expect(bar).not.toBeNull()
        // The Change Log, the instruction bar (78d) and the tracker's footer (78b) follow the bar at the foot.
        expect(bar.nextElementSibling!.classList.contains('lh-change-log')).toBe(true)
        expect(root.lastElementChild!.classList.contains('lh-tracker-footer')).toBe(true)
        expect(bar.hidden).toBe(false)
        expect(bar.innerHTML).toContain('<div class="rt-bottom-xp-content"><div class="rt-xp-row" data-xp-current="1200"')
        expect(cards().querySelector('[data-tag="XP"]')).toBeNull()
        expect(cards().querySelector('[data-tag="TIME"]')).not.toBeNull()
        // Off: the card comes back and the bar goes.
        emit({ name: 'prefs.changed', data: { prefs: { xpBarAtBottom: false } } })
        await settle()
        expect(bar.hidden).toBe(true)
        expect(bar.innerHTML).toBe('')
        expect(cards().querySelector('[data-tag="XP"]')).not.toBeNull()
        // On again, with a memo that has no XP block: nothing to draw, so the bar stays hidden.
        emit({ name: 'prefs.changed', data: { prefs: { xpBarAtBottom: true } } })
        await settle()
        expect(bar.hidden).toBe(false)
        emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: '[TIME]\n06:15 AM, Day 4\n[/TIME]' } })
        await settle()
        expect(bar.hidden).toBe(true)
    })

    it('reads the preference on mount and puts the bar in the widget’s foot when one is given', async () => {
        const { bridge, setPrefs } = makeBridge({ 'chat-1': XP })
        setPrefs({ xpBarAtBottom: false })
        const rest = document.createElement('div')
        const scene = document.createElement('div')
        const head = document.createElement('div')
        const foot = document.createElement('div')
        mountTrackerPanel(root, bridge, makeHost(), {}, { rest, scene, head, foot })
        await settle()
        await settle()
        const bar = foot.querySelector('.lh-bottom-xp') as HTMLElement
        expect(bar).not.toBeNull()
        expect(foot.classList.contains('lh-tracker')).toBe(true)
        expect(root.querySelector('.lh-bottom-xp')).toBeNull()
        expect(bar.hidden).toBe(true)
        expect(root.querySelector('.lh-tracker-cards [data-tag="XP"]')).not.toBeNull()
    })
})

describe('the animated bars (74h)', () => {
    const memoAt = (morale: number, xp = 1200) => ['[WAYSTONE]', `Morale: ((BAR)) ${morale}/100`, '[/WAYSTONE]', '[COMBAT]', 'Brenna: 12/20 HP', '[/COMBAT]', '[XP]', `Total: ${xp.toLocaleString('en-US')} / 2,700 XP (Level 3)`, '[/XP]'].join('\n')
    const cards = () => root.querySelector('.lh-tracker-cards') as HTMLElement

    it('marks the custom bar to animate while the switch is on, and plays a change as a pass lands: the segment lit, the delta floated, the XP gain under the bar at the bottom', async () => {
        const { bridge, emit, setPrefs } = makeBridge({ 'chat-1': memoAt(20) })
        setPrefs({ xpBarAtBottom: true, animateAllCustomBarChanges: true })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        await settle()
        expect(cards().innerHTML).toContain('data-rt-bar-id="WAYSTONE::Morale[L0]" data-rt-bar-current="20" data-rt-bar-max="100" data-rt-bar-kind="linear" data-rt-bar-animate="true"')
        expect(cards().innerHTML).toContain('data-rt-bar-id="COMBAT:Brenna:HP" data-rt-bar-current="12" data-rt-bar-max="20" data-rt-bar-kind="linear" data-rt-bar-animate="false"')
        expect(cards().dataset.rtBarAnimationContext).toBe('chat-1::live')
        expect(cards().querySelector('.rt-bar-delta-segment')).toBeNull()
        emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: memoAt(35, 1500) } })
        await settle()
        const segment = cards().querySelector('.rt-bar-delta-segment') as HTMLElement
        expect(segment.classList.contains('rt-bar-delta-gain')).toBe(true)
        expect(cards().querySelector('.rt-bar-change-floater')?.textContent).toBe('+15')
        expect((cards().querySelector('[data-rt-bar-id="WAYSTONE::Morale[L0]"]') as HTMLElement).dataset.rtBarVisibleCurrent).toBe('20')
        // The entity's native bar is not ticked, so it draws as it is.
        expect(cards().querySelectorAll('.rt-bar-delta-segment')).toHaveLength(1)
        const bar = root.querySelector('.lh-bottom-xp') as HTMLElement
        expect(bar.querySelector('.rt-xp-gain-floater')?.textContent).toBe('+300 XP')
        expect(bar.querySelector('.rt-xp-current')?.textContent).toBe('1,200')
        expect(cards().querySelector('.rt-xp-gain-floater')).toBeNull()
    })

    it('plays nothing with the switch off, across a chat change, or on a step through the history; the XP gain floats in the cards when the bar at the bottom is off', async () => {
        const { bridge, emit, setPrefs } = makeBridge({ 'chat-1': memoAt(20), 'chat-2': memoAt(50) })
        setPrefs({ xpBarAtBottom: false, animateAllCustomBarChanges: false })
        const host = makeHost()
        const panel = mountTrackerPanel(root, bridge, host)
        await settle()
        await settle()
        expect(cards().innerHTML).toContain('data-rt-bar-id="WAYSTONE::Morale[L0]" data-rt-bar-current="20" data-rt-bar-max="100" data-rt-bar-kind="linear" data-rt-bar-animate="false"')
        emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: memoAt(35, 1500) } })
        await settle()
        expect(cards().querySelector('.rt-bar-delta-segment')).toBeNull()
        // The XP row's gain plays without a switch, in the cards since the bar at the bottom is off.
        expect(cards().querySelector('.rt-xp-gain-floater')?.textContent).toBe('+300 XP')
        // On: a change plays; a change on another chat does not, since the context moved.
        emit({ name: 'prefs.changed', data: { prefs: { animateAllCustomBarChanges: true } } })
        await settle()
        expect(cards().querySelector('.rt-bar-delta-segment')).toBeNull()
        emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: memoAt(30, 1500) } })
        await settle()
        expect(cards().querySelector('.rt-bar-change-floater')?.textContent).toBe('−5')
        host.getActiveChat = () => ({ chatId: 'chat-2', characterId: null })
        await panel.refresh()
        await settle()
        expect(cards().dataset.rtBarAnimationContext).toBe('chat-2::live')
        expect(cards().querySelector('.rt-bar-delta-segment')).toBeNull()
    })
})

describe('the terminal (71b)', () => {
    const fold = () => root.querySelector('.lh-terminal') as HTMLDetailsElement
    const field = (name: string) => root.querySelector(`[data-lh-field="${name}"]`) as HTMLInputElement
    const lines = (source: string) => Array.from(root.querySelectorAll(`[data-lh-field="terminal-feed-${source}"] .lh-terminal-step`)).map((n) => n.textContent ?? '')

    it('ends the agent fold, reads the kept steps for the chat, and draws each step a pass announces', async () => {
        const { bridge, emit, terminalOps } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        await settle()
        expect(fold()).not.toBeNull()
        expect(root.querySelector('.lh-agent')!.querySelector('.lh-terminal')).toBe(fold())
        expect(terminalOps().some((p) => p.op === 'terminal.get' && p.chatId === 'chat-1')).toBe(true)
        emit({ name: 'terminal.step', data: { chatId: 'chat-1', step: { source: 'lorebook_agent', type: 'start', content: 'Initializing Lorebook Agent…', at: new Date().toISOString() } } })
        emit({ name: 'terminal.step', data: { chatId: 'chat-1', step: { source: 'lorebook_agent', type: 'tool', content: 'grep_lore(Lissa)', at: new Date().toISOString() } } })
        emit({ name: 'terminal.step', data: { chatId: 'chat-2', step: { source: 'lorebook_agent', type: 'error', content: 'elsewhere', at: new Date().toISOString() } } })
        expect(lines('lorebook_agent')).toHaveLength(2)
        expect(lines('lorebook_agent')[1]).toContain('grep_lore(Lissa)')
        // Clear forgets the shown tab's feed through the backend.
        field('terminal-clear').click()
        await settle()
        expect(terminalOps().some((p) => p.op === 'terminal.clear' && p.source === 'lorebook_agent')).toBe(true)
        expect(lines('lorebook_agent')).toEqual([])
    })

    it('runs each tab’s own pass: the architect’s command, the updater and evolution with their lookbacks, the tracker and the agent through their bars', async () => {
        const { bridge, requests, worldPatches, terminalOps, setAgentResult } = makeBridge({ 'chat-1': MEMO })
        setAgentResult({ at: new Date().toISOString(), outcome: 'committed', summary: 'The innkeeper is recorded.', steps: [], turnsUsed: 1, problems: [], write: { changed: [], deleted: [], createdBooks: [], refused: [] } })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const send = async (source: string, text: string, lookback?: string) => {
            ;(root.querySelector(`[data-lh-terminal-tab="${source}"]`) as HTMLButtonElement).click()
            const input = field(`terminal-input-${source}`) as unknown as HTMLTextAreaElement
            input.value = text
            if (lookback !== undefined) { field(`terminal-lookback-${source}`).value = lookback; field(`terminal-lookback-${source}`).dispatchEvent(new Event('change')) }
            field(`terminal-run-${source}`).click()
            await settle()
            await settle()
        }
        await send('map_architect', 'Create a DUNGEON map for "The Hollow"', '6')
        const direct = terminalOps().find((p) => p.op === 'direct')
        expect(direct).toMatchObject({ chatId: 'chat-1', text: 'Create a DUNGEON map for "The Hollow"', lookback: 6 })
        await send('map_updater', 'mark the ghoul pack dead', '3')
        expect(worldPatches().find((p) => p.op === 'update')).toMatchObject({ chatId: 'chat-1', instruction: 'mark the ghoul pack dead', lookback: 3 })
        await send('map_evolution', 'the cult moves into the chapel', '12')
        expect(worldPatches().find((p) => p.op === 'evolve')).toMatchObject({ chatId: 'chat-1', instruction: 'the cult moves into the chapel', lookback: 12 })
        await send('lorebook_agent', 'Add an entry for the innkeeper.')
        expect(requests.find((r) => r.op === 'agent.instruct')?.params).toMatchObject({ chatId: 'chat-1', instruction: 'Add an entry for the innkeeper.' })
        await send('state_tracker', 'Set the clock to noon.', '2')
        expect(requests.find((r) => r.op === 'tracker.instruct')?.params).toMatchObject({ chatId: 'chat-1', instruction: 'Set the clock to noon.' })
        // The tracker's bar and the terminal's tab share the preference: the bar follows the terminal's lookback.
        expect((root.querySelector('[data-lh-field="tracker-direct"] input') as HTMLInputElement).value).toBe('2')
        const saved = requests.filter((r) => r.op === 'prefs.patch').map((r) => (r.params as { patch: Record<string, unknown> }).patch)
        expect(saved.some((p) => p.mapArchitectDirectLookback === 6)).toBe(true)
        expect(saved.some((p) => p.trackerDirectLookback === 2)).toBe(true)
        expect(saved.some((p) => p.agentTerminalTab === 'state_tracker')).toBe(true)
    })
})

describe('the second widget after Multihog\'s Lorebook Agent tab (78a)', () => {
    const EVOLUTION = { enabled: true, intervalHours: 12, onSiteIntervalHours: 1, onSiteIntervalMinutes: 0, onSitePreset: 'dynamic', scope: 'all', count: 1, randomize: true, selectedRoots: '', worldReportLookback: 5, storyLookback: 20, connectionId: '', systemPrompt: '', compressEnabled: true, compressThreshold: 10000, narratorCommitTokens: 2000, running: false, currentTime: '09:00 AM, Day 5', lastFired: '09:00 AM, Day 4', nextDue: '09:00 PM, Day 4', sites: [] }
    const BASE = { enabled: true, currentLocation: 'Abbey Undercroft, Cellar Landing', sites: [{ siteRoot: 'Abbey Undercroft', kind: 'DUNGEON', entryId: 'Vell_LOC::1' }], activeSiteRoot: 'Abbey Undercroft', mentionedSiteRoots: [], canonChars: 0, syncedAt: 't', architect: { toolRegistered: true, opener: 'tool', lookback: 12, systemPrompt: '' }, updater: { enabled: true, runEvery: 1, lookback: 4, systemPrompt: '', running: false }, evolution: EVOLUTION }
    const modalHost = () => {
        const shown: Array<{ title: string; root: HTMLElement }> = []
        const host = {
            ...makeHost(),
            ui: {
                showConfirm: async () => ({ confirmed: true }),
                showModal: (options: { title: string }) => { const modalRoot = document.createElement('div'); document.body.append(modalRoot); shown.push({ title: options.title, root: modalRoot }); return { root: modalRoot, dismiss: () => { modalRoot.remove() } } },
            },
        }
        return { host, shown }
    }

    it('puts the tab strip in the box\'s strip and the agent\'s footer in its foot when the layout gives them, and clears both on destroy', async () => {
        const rest = document.createElement('div')
        const scene = document.createElement('div')
        const sceneHead = document.createElement('div')
        const sceneFoot = document.createElement('div')
        const { bridge, setMapStatus, emit } = makeBridge({ 'chat-1': MEMO })
        setMapStatus(BASE)
        const panel = mountTrackerPanel(root, bridge, makeHost(), {}, { rest, scene, sceneHead, sceneFoot })
        await settle()
        expect(sceneHead.querySelector('.lh-widget-tabs')).not.toBeNull()
        expect(scene.querySelector('.lh-widget-tabs')).toBeNull()
        const footer = sceneFoot.querySelector('[data-lh-field="agent-footer"]') as HTMLElement
        expect(footer).not.toBeNull()
        // ← Undo [LIVE] Redo → (71c) and Last run; the party's place is the tracker's footer's since 78b.
        expect(footer.querySelector('.lh-agent-tools-footer')).not.toBeNull()
        expect(footer.querySelector('[data-lh-field="agent-footer-place"]')).toBeNull()
        expect(root.querySelector('[data-lh-field="tracker-footer-place"]')!.textContent).toBe('Abbey Undercroft, Cellar Landing')
        expect(footer.querySelector('[data-lh-field="agent-footer-run"]')!.textContent).toBe('Last run: never')
        // A pass held for the count says when the next comes, in Multihog's words.
        emit({ name: 'agent.finished', data: { chatId: 'chat-1', at: new Date().toISOString(), outcome: 'no-commit', summary: '2 more replies before the next pass', steps: [], turnsUsed: 0, problems: [] } })
        await settle()
        const run = footer.querySelector('[data-lh-field="agent-footer-run"]')!.textContent ?? ''
        expect(run.startsWith('Last run: ')).toBe(true)
        expect(run).not.toContain('never')
        expect(run.endsWith('\u00b7 Next in: 2 replies')).toBe(true)
        panel.destroy()
        expect(sceneHead.children.length).toBe(0)
        expect(sceneFoot.children.length).toBe(0)
    })

    it('keeps the footer at the foot of the Lorebook Agent pane when the box has no foot', async () => {
        const rest = document.createElement('div')
        const scene = document.createElement('div')
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost(), {}, { rest, scene })
        await settle()
        const body = scene.querySelector('.lh-agent .lh-agent-body') as HTMLElement
        expect(body.lastElementChild!.getAttribute('data-lh-field')).toBe('agent-footer')
        expect(scene.querySelector('.lh-widget-tabs')).not.toBeNull()
    })

    it('opens the Map Details in the host\'s modal, the picture\'s folds moved into it and back, hidden in the tab meanwhile', async () => {
        const { bridge, setMapStatus } = makeBridge({ 'chat-1': MEMO })
        setMapStatus(BASE)
        const { host, shown } = modalHost()
        mountTrackerPanel(root, bridge, host)
        await settle()
        const picture = root.querySelector('.lh-map-picture') as HTMLElement
        const details = picture.querySelector('.lh-map-details') as HTMLElement
        expect(details.hidden).toBe(true)
        expect(details.querySelector('.lh-map-entries')).not.toBeNull()
        const button = root.querySelector('[data-lh-field="site-map-details"]') as HTMLButtonElement
        expect(button.hidden).toBe(false)
        button.click()
        expect(shown.map((s) => s.title)).toEqual(['Map Details \u2014 Abbey Undercroft'])
        expect(shown[0]!.root.querySelector('.lh-details-modal .lh-map-details')).toBe(details)
        expect(details.hidden).toBe(false)
        expect((details.querySelector('.lh-map-entries') as HTMLDetailsElement).open).toBe(true)
        expect(picture.querySelector('.lh-map-details')).toBeNull()
        // A second press closes it: the folds come back, hidden again.
        button.click()
        expect(shown[0]!.root.isConnected).toBe(false)
        expect(picture.querySelector('.lh-map-details')).toBe(details)
        expect(details.hidden).toBe(true)
    })

    it('leaves the picture\'s folds in the tab and hides the button on a host without a modal', async () => {
        const { bridge, setMapStatus } = makeBridge({ 'chat-1': MEMO })
        setMapStatus(BASE)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        expect((root.querySelector('.lh-map-picture .lh-map-details') as HTMLElement).hidden).toBe(false)
        expect((root.querySelector('[data-lh-field="site-map-details"]') as HTMLElement).hidden).toBe(true)
    })

    it('folds the updater\'s direct box under the site map\'s 💬, as Multihog does', async () => {
        const { bridge, setMapStatus } = makeBridge({ 'chat-1': MEMO })
        setMapStatus(BASE)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const toggle = root.querySelector('[data-lh-field="site-map-direct-toggle"]') as HTMLButtonElement
        const direct = root.querySelector('[data-lh-field="site-map-direct"]') as HTMLElement
        expect(direct.hidden).toBe(true)
        expect(direct.querySelector('[data-lh-field="map-updater-instruction"]')).not.toBeNull()
        expect(Array.from(direct.querySelectorAll('button')).map((b) => b.textContent)).toContain('Update the map now')
        toggle.click()
        expect(direct.hidden).toBe(false)
        expect(toggle.getAttribute('aria-expanded')).toBe('true')
        toggle.click()
        expect(direct.hidden).toBe(true)
    })

    it('resets the evolution timeline on the backend, reads the maps again and says so until the next pass lands', async () => {
        const { bridge, setMapStatus, worldPatches, requests, emit } = makeBridge({ 'chat-1': MEMO })
        setMapStatus(BASE)
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const evo = root.querySelector('.lh-evolution') as HTMLElement
        const reads = () => requests.filter((r) => r.op === 'map.get').length
        const before = reads()
        ;(evo.querySelector('[data-lh-field="map-evolution-reset"]') as HTMLButtonElement).click()
        await settle()
        expect(worldPatches().at(-1)).toEqual({ op: 'evolution-reset', chatId: 'chat-1' })
        expect(reads()).toBe(before + 1)
        expect(evo.querySelector('.lh-maps-evolution-note')!.textContent).toContain('The timeline is reset')
        emit({ name: 'map.evolution.finished', data: { chatId: 'chat-1', status: 'applied', at: new Date(Date.now() + 1000).toISOString(), trigger: 'interval', sites: [{ siteRoot: 'Abbey Undercroft', status: 'applied', operations: 1, digest: 'Rats.' }] } })
        await settle()
        expect(evo.querySelector('.lh-maps-evolution-note')!.textContent).not.toContain('The timeline is reset')
    })

    it('draws Quick Settings from the dials table — the lookback mode, the updater\'s cadence, the rollback — beside the fold\'s rows, one preference with the settings', async () => {
        const { bridge, worldPatches, emit } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const quick = root.querySelector('[data-lh-field="agent-quick"]') as HTMLDetailsElement
        expect(quick.querySelector('.lh-agent-drawer-title')!.textContent).toBe('Quick Settings')
        expect(Array.from(quick.querySelectorAll('.lh-agent-drawer-body > *')).map((n) => n.getAttribute('data-lh-dials') ?? n.getAttribute('data-lh-field'))).toEqual(['quick-mode', 'lookback', 'cadence', 'quick-more', 'turns', 'agent-model'])
        expect(quick.querySelector('[data-lh-field="dial-agentLookbackMode"] select')).not.toBeNull()
        const every = quick.querySelector('[data-lh-field="dial-mapUpdaterRunEvery"] input') as HTMLInputElement
        every.value = '3'
        every.dispatchEvent(new Event('change'))
        await settle()
        expect(worldPatches().at(-1)).toEqual({ mapUpdaterRunEvery: 3 })
        const rollback = quick.querySelector('[data-lh-field="dial-agentSwipeRollback"] input') as HTMLInputElement
        emit({ name: 'prefs.changed', data: { prefs: { agentSwipeRollback: false } } })
        await settle()
        expect(rollback.checked).toBe(false)
        emit({ name: 'prefs.changed', data: { prefs: { agentSwipeRollback: true } } })
        await settle()
        expect(rollback.checked).toBe(true)
    })

    it('takes the Modular Repertoire from the panel and says where the editors are without it; the report lives under the terminal\'s Lorebook Agent tab', async () => {
        const repertoire = document.createElement('div')
        repertoire.className = 'lh-repertoire'
        const { bridge } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost(), {}, { repertoire })
        await settle()
        const drawer = root.querySelector('[data-lh-field="agent-repertoire"]') as HTMLElement
        expect(drawer.querySelector('.lh-agent-drawer-title')!.textContent).toBe('Modular Repertoire (Prompt Rules)')
        expect(drawer.querySelector('.lh-agent-drawer-body')!.firstElementChild).toBe(repertoire)
        expect(root.querySelector('[data-lh-field="terminal-history-lorebook_agent"] .lh-agent-note')).not.toBeNull()
        expect(root.querySelector('[data-lh-field="terminal-history-lorebook_agent"] [data-lh-field="agent-report-history"]')).not.toBeNull()

        root.replaceChildren()
        const { bridge: bare } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bare, makeHost())
        await settle()
        expect(root.querySelector('[data-lh-field="agent-repertoire"] .lh-agent-drawer-body')!.textContent).toContain('are in the settings in this layout')
    })

    it('flips the world and the evolution switches from the badges on the drawers\' headers', async () => {
        const { bridge, setMapStatus, setWorldStatus, worldPatches } = makeBridge({ 'chat-1': MEMO })
        setMapStatus(BASE)
        setWorldStatus({ enabled: false, intervalHours: 24, locationsPerReport: 3, keepActive: 1, lookback: 20, prefix: 'Vell', worldBookName: 'Vell_World', lastFiredPeriodLabel: '', nextDueLabel: '', currentTime: 'Day 2, 09:00 AM', activeReports: [], historyCount: 0, running: false, skeletonBookName: 'Vell_Skeleton', skeletonCounts: { factions: 0, locations: 0, conflicts: 0 }, skeletonSource: '', skeleton: { factions: 4, locations: 4, conflicts: 3, systemPrompt: '', useLorebooks: false, lorebookOnly: false, lorebookFilter: '', useExisting: true, sourceLookback: 30 } })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const worldBadge = root.querySelector('[data-lh-field="world-badge"]') as HTMLElement
        expect(worldBadge.textContent).toBe('OFF')
        worldBadge.click()
        await settle()
        expect(worldPatches().some((p) => p.worldProgressionEnabled === true)).toBe(true)
        const evoBadge = root.querySelector('[data-lh-field="evolution-badge"]') as HTMLElement
        expect(evoBadge.textContent).toBe('ON')
        expect(evoBadge.classList.contains('lh-agent-badge--on')).toBe(true)
        evoBadge.click()
        await settle()
        expect(worldPatches().some((p) => p.mapEvolutionEnabled === false)).toBe(true)
    })
})

describe('the relationship floater and Edit with AI (78c)', () => {
    const layer = () => document.getElementById('lh-rel-float-layer')
    afterEach(() => { vi.useRealTimers(); layer()?.remove() })

    it('floats an award over the tracker when the backend announces one for this chat, while Multihog’s switch is on', async () => {
        const { bridge, emit, setPrefs } = makeBridge({ 'chat-1': MEMO })
        setPrefs({ npcRelationshipToast: true })
        const panel = mountTrackerPanel(root, bridge, makeHost())
        await settle()
        vi.useFakeTimers()
        // Another chat's award floats nothing; this chat's floats each award, staggered.
        emit({ name: 'relationships.awarded', data: { chatId: 'chat-9', awards: [{ npc: 'Kes', field: 'friendship', delta: 5 }] } })
        vi.advanceTimersByTime(400)
        expect(layer()).toBeNull()
        emit({ name: 'relationships.awarded', data: { chatId: 'chat-1', awards: [{ npc: 'Mother Sedge', field: 'friendship', delta: 5 }, { npc: 'Kes', field: 'affection', delta: -2 }, { npc: 'Bad', field: 'luck', delta: 1 }] } })
        vi.advanceTimersByTime(0)
        expect(layer()).not.toBeNull()
        expect(layer()!.parentElement).toBe(document.body)
        vi.advanceTimersByTime(400)
        const floats = Array.from(document.querySelectorAll('.lh-rel-float'))
        expect(floats.map((f) => f.textContent)).toEqual(['🤝+5FriendshipMother Sedge', '💗-2AffectionKes'])
        expect(floats[1]!.className).toBe('lh-rel-float lh-rel-float--affection lh-rel-float--negative')
        // The switch off, through the preference event: the next award floats nothing.
        for (const f of floats) f.dispatchEvent(new Event('animationend'))
        expect(layer()).toBeNull()
        emit({ name: 'prefs.changed', data: { prefs: { npcRelationshipToast: false } } })
        emit({ name: 'relationships.awarded', data: { chatId: 'chat-1', awards: [{ npc: 'Kes', field: 'friendship', delta: 3 }] } })
        vi.advanceTimersByTime(800)
        expect(layer()).toBeNull()
        // Destroying the panel takes a pending float with it.
        emit({ name: 'prefs.changed', data: { prefs: { npcRelationshipToast: true } } })
        emit({ name: 'relationships.awarded', data: { chatId: 'chat-1', awards: [{ npc: 'Kes', field: 'friendship', delta: 3 }] } })
        panel.destroy()
        vi.advanceTimersByTime(800)
        expect(layer()).toBeNull()
    })

    it('reads the switch off at mount, so an install that turned it off floats nothing from the first award', async () => {
        const { bridge, emit, setPrefs } = makeBridge({ 'chat-1': MEMO })
        setPrefs({ npcRelationshipToast: false })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        vi.useFakeTimers()
        emit({ name: 'relationships.awarded', data: { chatId: 'chat-1', awards: [{ npc: 'Kes', field: 'friendship', delta: 3 }] } })
        vi.advanceTimersByTime(800)
        expect(layer()).toBeNull()
    })

    it('asks the backend to rewrite an NPC entry from the Full NPC Card and the Player Card from its fold, each with its kind', async () => {
        const shown: Array<{ title: string; root: HTMLElement }> = []
        const host: TrackerPanelHost = {
            ...makeHost(),
            ui: {
                showConfirm: async () => ({ confirmed: true }),
                showModal: (options: { title: string }) => { const modalRoot = document.createElement('div'); document.body.append(modalRoot); shown.push({ title: options.title, root: modalRoot }); return { root: modalRoot, dismiss: () => { modalRoot.remove() } } },
            } as unknown as TrackerPanelHost['ui'],
        }
        const { bridge, requests, setCardView } = makeBridge({ 'chat-1': MEMO })
        setCardView({ card: { name: 'Robin Vale', bio: 'Species: Human\nBody: Lean and quick.', wordCount: 6, at: 't' }, persona: null, personasAvailable: true, activePersona: '', activeDescribed: false })
        mountTrackerPanel(root, bridge, host)
        await settle()
        const pane = root.querySelector('.lh-campaign-records') as HTMLDetailsElement
        pane.open = true
        pane.dispatchEvent(new Event('toggle'))
        await settle()
        await settle()
        ;(root.querySelector('.lh-records-folder-head') as HTMLElement).click()
        ;(root.querySelector('.lh-npc-card[data-lh-entry="e1"] [data-lh-field="records-view"]') as HTMLElement).click()
        expect(shown.at(-1)!.title).toBe('Elara — Full NPC Card')
        const full = shown.at(-1)!.root
        ;(full.querySelector('[data-lh-field="records-full-ai"]') as HTMLElement).click()
        ;(full.querySelector('[data-lh-field="records-full-ai-instructions"]') as HTMLTextAreaElement).value = 'make her an elf'
        ;(full.querySelector('[data-lh-field="records-full-ai-generate"]') as HTMLElement).click()
        await settle()
        await settle()
        const npcAsk = requests.find((r) => r.op === 'records.aiEdit')
        expect(npcAsk?.params).toMatchObject({ kind: 'npc', instructions: 'make her an elf' })
        expect(String(npcAsk?.params?.content)).toContain('[CORE]')
        // The Player Card fold's button, with the pc kind: the fold behind Full PC Card, in the modal.
        ;(root.querySelector('[data-lh-field="records-pc-view"]') as HTMLElement).click()
        const card = shown.at(-1)!.root.querySelector('.lh-player-card') as HTMLElement
        expect(card).not.toBeNull()
        ;(card.querySelector('[data-lh-field="card-ai-edit"]') as HTMLElement).click()
        ;(card.querySelector('[data-lh-field="card-ai-instructions"]') as HTMLTextAreaElement).value = 'older'
        ;(card.querySelector('[data-lh-field="card-ai-generate"]') as HTMLElement).click()
        await settle()
        await settle()
        expect(requests.filter((r) => r.op === 'records.aiEdit').at(-1)?.params).toMatchObject({ kind: 'pc', instructions: 'older' })
    })
})

describe('the second widget’s second round (78b)', () => {
    const EVOLUTION = { enabled: true, intervalHours: 12, onSiteIntervalHours: 1, onSiteIntervalMinutes: 0, onSitePreset: 'dynamic', scope: 'all', count: 1, randomize: true, selectedRoots: '', worldReportLookback: 5, storyLookback: 20, connectionId: '', systemPrompt: '', compressEnabled: false, compressThreshold: 10000, narratorCommitTokens: 2000, running: false, currentTime: '', lastFired: '', nextDue: '', sites: [] }
    const BASE = { enabled: true, currentLocation: '', sites: [], activeSiteRoot: '', mentionedSiteRoots: [], canonChars: 0, syncedAt: 't', architect: { toolRegistered: true, opener: 'tool', lookback: 12, systemPrompt: '' }, updater: { enabled: true, runEvery: 1, lookback: 4, systemPrompt: '', running: false }, evolution: EVOLUTION }
    it('Active Lore Keys: a drawer after World Progression, reading the host’s active entries when opened and after every reply, each a pill by how it fired', async () => {
        const { bridge, bookOps, setActivated } = makeBridge({ 'chat-1': MEMO })
        mountTrackerPanel(root, bridge, makeHost())
        await settle()
        const drawer = root.querySelector('[data-lh-field="agent-active-keys"]') as HTMLDetailsElement
        expect(drawer).not.toBeNull()
        expect(drawer.previousElementSibling!.getAttribute('data-lh-field')).toBe('agent-world')
        expect(drawer.querySelector('.lh-agent-badge')!.textContent).toBe('–')
        expect(bookOps.filter((o) => o[0] === 'activated')).toEqual([])
        drawer.open = true
        drawer.dispatchEvent(new Event('toggle'))
        await settle()
        expect(bookOps.filter((o) => o[0] === 'activated')).toEqual([['activated', { chatId: 'chat-1' }]])
        const pills = () => Array.from(drawer.querySelectorAll('.lh-lore-pill')) as HTMLElement[]
        // The view's order (Phase 7): what matched by meaning first, then by keyword, the always-in last.
        expect(pills().map((p) => `${p.textContent}:${p.className.replace('lh-lore-pill ', '')}`)).toEqual(['The Gilded Hare:lh-lore-pill--vector', 'Elara:lh-lore-pill--keyword', 'The world:lh-lore-pill--always'])
        expect(pills()[0]!.title).toBe('by meaning (0.82)')
        expect(pills()[1]!.title).toBe('by keyword · keys: Elara, innkeeper')
        expect(drawer.querySelector('.lh-agent-badge')!.textContent).toBe('3')
        // After every reply the maps are re-read, and the keys with them while the drawer is open.
        Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Re-read the maps')!.click()
        await settle()
        expect(bookOps.filter((o) => o[0] === 'activated')).toHaveLength(2)
        // A host that cannot say says so in red.
        setActivated({ entries: [], unavailable: 'This build cannot ask the host what lore it loaded.' })
        ;(drawer.querySelector('[data-lh-field="active-keys-check"]') as HTMLElement).click()
        await settle()
        expect(drawer.querySelector('[data-lh-field="active-keys-note"]')!.textContent).toBe('This build cannot ask the host what lore it loaded.')
        expect(drawer.querySelector('.lh-lore-note--error')).not.toBeNull()
        expect(pills()).toHaveLength(0)
    })

    it('the tracker’s footer: ← [ LIVE ] → with the clock and the party’s place, in the widget’s foot; the agent’s footer keeps Last run from the history', async () => {
        const rest = document.createElement('div')
        const scene = document.createElement('div')
        const foot = document.createElement('div')
        const sceneFoot = document.createElement('div')
        const { bridge, setMapStatus, setSnapshots, setReports } = makeBridge({ 'chat-1': MEMO })
        setMapStatus({ ...BASE, currentLocation: 'Abbey Undercroft, Cellar Landing' })
        setSnapshots([{ messageId: 'm2', memo: MEMO, at: new Date().toISOString(), messageNumber: 2 }, { messageId: 'm1', memo: '[TIME]\n11:00 PM, Day 9\n[/TIME]', at: new Date().toISOString(), messageNumber: 1 }])
        setReports({ tracker: [], agent: [{ at: new Date(Date.now() - 60_000).toISOString(), outcome: 'changed', summary: 'x', steps: [], turnsUsed: 1, problems: [] }] })
        mountTrackerPanel(root, bridge, makeHost(), {}, { rest, scene, foot, sceneFoot })
        await settle()
        await settle()
        const footer = foot.querySelector('[data-lh-field="tracker-footer"]') as HTMLElement
        expect(footer).not.toBeNull()
        expect(root.querySelector('.lh-tracker-history')).toBeNull()
        expect(footer.querySelector('.lh-tracker-history-label')!.textContent).toBe('[ LIVE ]')
        expect((footer.querySelector('button[aria-label="Older state"]') as HTMLElement).textContent).toBe('←')
        expect((footer.querySelector('button[aria-label="Newer state"]') as HTMLElement).textContent).toBe('→')
        expect(footer.querySelector('[data-lh-field="tracker-footer-place"]')!.textContent).toBe('Abbey Undercroft, Cellar Landing')
        // The foot after Multihog's (78d): the bar and the Change Log over the footer in the foot, the tokens and the buttons on it.
        expect(Array.from(foot.children).map((n) => n.className.split(' ')[0])).toEqual(['lh-bottom-xp', 'lh-change-log', 'lh-direct', 'lh-tracker-footer'])
        expect(footer.querySelector('[data-lh-field="tracker-footer-tokens"]')!.textContent).toBe(`~${Math.round(MEMO.length / 2.62)} tokens`)
        expect(footer.querySelector('[data-lh-field="tracker-prompt-toggle"]')).not.toBeNull()
        // The clock from the memo on screen, stacked layout or not (76 drew it in Tab Mode alone): the stepped state's as the stepper moves.
        expect((footer.querySelector('.lh-foot-clock') as HTMLElement).hidden).toBe(false)
        expect(footer.querySelector('.lh-foot-clock')!.textContent).not.toContain('11:00 PM, Day 9')
        ;(footer.querySelector('button[aria-label="Older state"]') as HTMLElement).click()
        await settle()
        expect(footer.querySelector('.lh-tracker-history-label')!.textContent).toContain('#1')
        expect((footer.querySelector('.lh-foot-clock') as HTMLElement).hidden).toBe(false)
        expect(footer.querySelector('.lh-foot-clock')!.textContent).toContain('11:00 PM, Day 9')
        // The agent's footer: no place (it is the tracker's), and Last run from the history of an earlier session.
        const agentFooter = sceneFoot.querySelector('[data-lh-field="agent-footer"]') as HTMLElement
        expect(agentFooter.querySelector('[data-lh-field="agent-footer-place"]')).toBeNull()
        expect(agentFooter.querySelector('[data-lh-field="agent-footer-run"]')!.textContent).toMatch(/^Last run: /)
        expect(agentFooter.querySelector('[data-lh-field="agent-footer-run"]')!.textContent).not.toContain('never')
    })

    it('Map Details carries What the maps are doing at its head; the skeleton goes into the World progression category when the panel gives one', async () => {
        const shown: Array<{ title: string; root: HTMLElement }> = []
        const host: TrackerPanelHost = {
            ...makeHost(),
            ui: {
                showConfirm: async () => ({ confirmed: true }),
                showModal: (options: { title: string }) => { const modalRoot = document.createElement('div'); document.body.append(modalRoot); shown.push({ title: options.title, root: modalRoot }); return { root: modalRoot, dismiss: () => { modalRoot.remove() } } },
            } as unknown as TrackerPanelHost['ui'],
        }
        const world = document.createElement('div')
        const { bridge, setMapStatus } = makeBridge({ 'chat-1': MEMO })
        setMapStatus({ ...BASE, currentLocation: 'Abbey Undercroft, Cellar Landing', activeSiteRoot: 'Abbey Undercroft', sites: [{ siteRoot: 'Abbey Undercroft', kind: 'DUNGEON', entryId: 'Vell_LOC::1' }] })
        const panel = mountTrackerPanel(root, bridge, host, {}, { world })
        await settle()
        expect(world.querySelector('.lh-skeleton')).not.toBeNull()
        expect(root.querySelector('.lh-skeleton')).toBeNull()
        // No More settings folds and no status fold in the tab (78b): the status block is hidden until Map Details opens.
        for (const name of ['maps-more', 'world-more', 'evolution-more', 'scene-more']) expect(root.querySelector(`[data-lh-field="${name}"]`), name).toBeNull()
        const status = root.querySelector('[data-lh-field="maps-status"]') as HTMLElement
        expect(status.hidden).toBe(true)
        ;(root.querySelector('[data-lh-field="site-map-details"]') as HTMLElement).click()
        expect(shown.map((m) => m.title)).toEqual(['Map Details — Abbey Undercroft'])
        const box = shown[0]!.root.querySelector('.lh-details-modal') as HTMLElement
        expect(box.firstElementChild).toBe(status)
        expect(status.hidden).toBe(false)
        expect(status.querySelector('.lh-maps-status')!.textContent).toContain('Abbey Undercroft')
        expect(box.querySelector('.lh-map-details')).not.toBeNull()
        panel.destroy()
        expect(world.querySelector('.lh-skeleton')).toBeNull()
    })
})
