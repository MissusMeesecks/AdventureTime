/**
 * The tracker, in the panel.
 *
 * This is the read path's other end: it asks the backend for the active chat's
 * memo, runs it through the same host-free parser and renderer the message
 * widget will use, and puts the cards on screen. Two views, as in the legacy
 * build — the cards, and the raw memo behind them.
 *
 * The raw view is not a debugging affordance. It is how a user corrects a value
 * the model got wrong, and in the legacy build editing it is what feeds the
 * next turn's state. So it writes back.
 *
 * It also listens for the backend's `tracker.changed` event, which the tracker
 * pass emits after each turn, so the cards move on their own as the story goes.
 * That event is also the safety net under `Run tracker now`: the pass reports
 * itself when it finishes, whether or not the panel was still waiting on the
 * reply, so a pass that outlasts the request deadline still lands here.
 *
 * `tracker.started` is the other half of that pair, and the one that says
 * something is happening *now*. The pass after a reply belongs to nobody on this
 * side — no button was pressed, no request is pending — so without it the panel
 * had nothing to show between the reply landing and the memo changing minutes
 * later, which is exactly what a dead tracker looks like.
 */

import { NARRATOR_BLANK } from './connections-category.js'
import { createCreatorFold } from './creator-fold.js'
import { createInstantFold } from './instant-fold.js'
import { createStartArea } from './start-area.js'
import { createPlayerCardFold, reasonText } from './player-card-fold.js'
import { createWaysFold } from './ways-fold.js'
import { createImportFold } from './import-fold.js'
import { createLibraryFold } from './library-fold.js'
import { createNpcCreatorFold } from './npc-creator-fold.js'
import { createSceneFold } from './scene-fold.js'
import { createEnlarge, zoomTarget, zoomable, type PictureActions } from './enlarge.js'
import { MAX_PORTRAIT_BYTES, PORTRAIT_FILE_TYPES, toDataUrl } from './portrait-actions.js'
import { askForPrompt } from './prompt-dialog.js'
import { createLocationBackground } from './location-background.js'
import { createCardSettings } from './card-settings.js'
import { createRelationshipFloat } from './relationship-float.js'
import { createMapsGuide } from './category-copy.js'
import { buildActivationView } from '../agent/activation.js'
import { createPortraitDrawSettings } from './portrait-draw.js'
import { downloadText } from './download.js'
import { createMapPicture } from './map-picture.js'
import { createRecordsFold } from './campaign-records.js'
import { createSandboxFold } from './sandbox-fold.js'
import { createAgentTools } from './agent-tools.js'
import { createTerminalFold } from './terminal-fold.js'
import { createPrefDials, dialRows } from './pref-dials.js'
import type { DialGroup } from './pref-dials.js'
import { openDetailsModal } from './details-modal.js'
import type { DetailsModal } from './details-modal.js'
import { lookupPortrait, normalizeEntityName, portraitFor, portraitProblem } from '../tracker/portraits.js'
import { locationImageKey } from '../tracker/scene.js'
import { renderBottomXpBar, renderTabModeHtml, renderTrackerHtml } from '../tracker/render.js'
import { applyDayNightPhase, currentClockFromMemo, getTimeOfDayInfo, renderDayNightBadge } from './day-night.js'
import {
    LIVE,
    describePosition,
    indexAt,
    readPosition,
    stepHistory,
    type HistoryEntry,
    firstPastIndex,
} from '../tracker/history-view.js'
import { CHANGE_LOG_TEXT, memoChangeLog, memoTokenEstimate, renderChangeLogHtml, type ChangeLog } from '../tracker/change-log.js'
import { buildTrackerView, type TrackerSettings } from '../tracker/view.js'
import { RequestTimeoutError, type Bridge } from './bridge.js'
import { mountNarratorConfig, type NarratorConfig } from './narrator-config.js'
import type { SettingsBag } from '../settings/schema.js'
import type { Quest } from '../tracker/quests.js'
import type { BarPrefs } from '../tracker/bars.js'
import { barAnimationContext, captureBarAnimations, playBarAnimations } from './bar-animation.js'
import { createRecolorBinding } from './recolor.js'
import { readDisplayGroups, type DisplayGroup } from '../tracker/display-groups.js'
import { ENTITY_TAGS } from '../tracker/entities.js'
import { resolveCampaignPrefix } from '../agent/campaign.js'
import type { ActivatedLoreResult, AgentAuditResult, AgentRedoResult, AgentRunResult, AgentUndoResult, CampaignBooksResult, CampaignCloneResult, CampaignNameResult, CampaignRecordsResult, CardAiEditResult, CardChoice, CardResult, ConnectionChoice, ConnectionsResult, CreatorResult, ImportResult, InstantResult, LibraryActionResult, LibraryPhotoPromptResult, LibraryPhotoResult, LibraryRecordView, LibrarySources, MapArchitectResult, MapCreateResult, MapEvolutionIntervalResult, MapEvolutionResult, MapEvolutionStatus, MapRawResult, MapRawSaveResult, MapSandboxOutcome, MapSandboxResult, MapStatusResult, MapUpdaterResult, MapViewResult, NarratorCardResult, NpcAddResult, NpcDraftResult, PersonaResult, PlayerCardView, PortraitAutoStatus, PortraitDrawReport, PortraitDrawResult, PortraitPromptResult, PortraitsResult, PrefsResult, RecordEntryResult, RecordRemoveMapResult, RelationshipAward, RelationshipsView, ReportsHistoryResult, SceneConnectionsResult, SceneDrawResult, ScenePictureReport, ScenePromptResult, SceneResult, TerminalResult, TerminalStep, TrackerHistoryResult, TrackerPassReportDTO, TrackerPassStartedDTO, TrackerResult, WaysResult, WorldBooksResult, WorldConsolidateResult, WorldPurgeResult, WorldRunResult, WorldSkeletonResult, WorldSourceResult, WorldStatusResult } from '../protocol.js'

export interface TrackerPanelHost {
    dom: {
        createElement: <K extends keyof HTMLElementTagNameMap>(
            tag: K,
            attrs?: Record<string, string>,
        ) => HTMLElementTagNameMap[K]
    }
    /** The chat whose memo to show. Returns nulls on the home screen. */
    getActiveChat(): { chatId: string | null; characterId: string | null }
    /**
     * The host's file picker.
     *
     * Optional: without it a portrait can still be pasted as a URL, so the row
     * says so rather than offering a button that cannot work.
     */
    uploads?: {
        pickFile(options?: { accept?: string[]; multiple?: boolean; maxSizeBytes?: number }): Promise<
            Array<{ name: string; bytes: Uint8Array; mimeType?: string }>
        >
    }
    /**
     * The host's confirmation dialog, for the two irreversible buttons (33b).
     *
     * Optional: without it a button asks to be pressed twice instead, so a
     * purge is never one click on any host.
     */
    ui?: {
        showConfirm(options: { title?: string; message?: string; variant?: 'info' | 'warning' | 'danger' | 'success'; confirmLabel?: string }): Promise<{ confirmed: boolean }>
        /** The host's modal (55), for the scene's picture large; absent on an older host. */
        showModal?(options: { title: string; width?: number; maxHeight?: number }): { root: HTMLElement; dismiss(): void }
    }
}

export interface TrackerPanel {
    /** Re-read the memo and redraw. Safe to call on a chat switch. */
    refresh(): Promise<void>
    /** Redraw from the memo already in hand — for when settings change. */
    setSettings(settings: TrackerSettings): void
    /**
     * Run an instructed pass, as the send bar does, from elsewhere in the panel
     * (the wizard, after a save). The dot, the busy line and the report are
     * this section's, so the outcome lands where every pass's does.
     */
    instruct(instruction: string): Promise<void>
    destroy(): void
}

/**
 * The largest picture the picker will take.
 *
 * It travels to the backend as a base64 data URL — a third larger than the file
 * — over a message channel, so this is a limit on what the *bridge* can carry
 * comfortably rather than on what the host can store. Portraits are thumbnails
 * on a card; eight megabytes is already far more than one needs.
 */
export { MAX_PORTRAIT_BYTES, toDataUrl } from './portrait-actions.js'

/** The head's five lights (47a; the picture's since 49-bis): one per process that runs on its own. */
type HeadLightKey = 'tracker' | 'agent' | 'world' | 'map' | 'picture'
/** Multihog's three states, with a failure added. */
type HeadLightState = 'idle' | 'running' | 'done' | 'failed'

export function mountTrackerPanel(
    root: HTMLElement,
    bridge: Bridge,
    host: TrackerPanelHost,
    settings: TrackerSettings = {},
    /**
     * Where the parts not read during play go (47b): the creator folds, the
     * agent, the world, the lore and the raw memo. Left out, everything is in
     * `root` in the order it has always been — the classic layout. Given, the
     * play parts (the head, the cards, the map, the scene, the relationships)
     * stay in `root` and the rest goes there, in the same relative order.
     */
    slots: { rest?: HTMLElement; scene?: HTMLElement; head?: HTMLElement; foot?: HTMLElement; sceneHead?: HTMLElement; sceneFoot?: HTMLElement; repertoire?: HTMLElement; world?: HTMLElement } = {},
): TrackerPanel {
    const el = host.dom.createElement
    /** A picture large (55, then every picture in Phase 64), in the host's modal where it has one. */
    const enlarge = createEnlarge(host.ui)
    // The chat background (73f): the place's picture laid on the host's background layer, found on the page.
    const locationBackground = createLocationBackground(document, window, (line) => console.info(line))

    /**
     * The prompt editor before a pressed draw (73f, Multihog's prompt dialog): with *Skip the prompt editor*
     * off and a host modal to show it in, `write` makes the prompt and the dialog hands back the text to draw,
     * or `null` for Cancel. The tick writes the preference. Otherwise the draw goes ahead as before.
     */
    async function editedPrompt(write: () => Promise<{ title: string; prompt: string }>): Promise<{ prompt?: string } | null> {
        if (!host.ui?.showModal) return {}
        const skip = await bridge.request<PrefsResult>('prefs.get', {}).then((r) => r.prefs?.portraitSkipPromptDialog === true).catch(() => false)
        if (skip) return {}
        const written = await write()
        const answer = await askForPrompt(host.ui, { title: written.title, prompt: written.prompt })
        if (!answer) return null
        if (answer.skip) await bridge.request<PrefsResult>('prefs.patch', { patch: { portraitSkipPromptDialog: true } }).catch(() => undefined)
        return { prompt: answer.prompt }
    }
    const rest = slots.rest ?? root
    /**
     * Where the map, the scene and the relationships go (47c): the second
     * floating widget, where they are three tabs of one box rather than
     * three folds. Left out, they follow the play parts.
     */
    const scene = slots.scene ?? null
    let current: TrackerSettings = settings
    let memo = ''
    /** Every state this chat has kept, newest first. Read on demand. */
    let history: HistoryEntry[] = []
    /** Where the stepper is: `LIVE`, or an index into `history`. */
    let historyIndex = LIVE
    /** Whether the restore button is armed — the second press does it. */
    let restoreArmed = false
    /**
     * The chat's finished quests, from the archive store.
     *
     * Held beside the memo rather than in it because that is where they live:
     * the tracker pass strips a quest out of the memo the turn it ends. Every
     * tracker reply and every pass event carries this list, and `draw()` folds
     * it back in.
     */
    let archivedQuests: Quest[] = []
    /** Entity name -> image reference, for the portraits on the entity cards. */
    let portraits: Record<string, string> = {}
    /**
     * What went wrong the last time a portrait was set, per entity.
     *
     * Kept here rather than left in the status line beside the Tracker heading,
     * because that line is shared: the next tracker event overwrites it, and the
     * one message that finally explained a portrait failing to store — the host's
     * own `userId is required for operator-scoped extensions` — had to be caught
     * in a screenshot before it went. A failure belongs on the row it is about.
     */
    const portraitErrors = new Map<string, string>()
    /** What the user decided about individual bars, keyed by bar id. */
    let bars: BarPrefs = {}
    /**
     * What Lumiverse loaded for this chat, when it has been asked.
     *
     * `null` until asked, because "not asked yet" and "asked, and nothing
     * matched" are different answers and the section has to say which.
     */
    /** The cards' view as last drawn (60): the library asks it whether a card's name is in play. */
    let lastView: ReturnType<typeof buildTrackerView> | null = null
    /** The portraits drawn as they appear (61): what is drawing and queued for this chat, and the last outcome per name. */
    let portraitAuto: PortraitAutoStatus = { drawing: [], queued: [], last: {} }
    const emptyPortraitAuto = (): PortraitAutoStatus => ({ drawing: [], queued: [], last: {} })
    /** The last agent pass, or null before one has been run here. */
    let agentReport: AgentRunResult | null = null
    /** The earlier passes of both (47e), newest first, read from the backend when the chat loads and after each pass. */
    let reportHistory: ReportsHistoryResult = { tracker: [], agent: [] }
    /** What the user called each chat's campaign. Keyed by chat id. */
    let campaignNames: Record<string, string> = {}
    /** Messages of history the agent reads. `0` for the whole chat. */
    let agentLookback = 0
    // The send bars' own windows -- the legacy's `directPromptContext` and
    // `routerDirectLookback`, and their defaults.
    let trackerDirectLookback = 5
    let agentDirectLookback = 10
    let agentMaxTurns = 5
    let trackerConnectionId = ''
    let agentConnectionId = ''
    let connectionChoices: ConnectionChoice[] = []
    let connectionsUnavailable: string | undefined
    let agentRunEvery = 3
    /** An automatic pass in flight, if the backend has said one started. */
    let agentRunning: { at: string } | null = null
    /** World Progression (roadmap row 8): what the backend last said, and whether a pass is in flight. */
    let worldStatus: WorldStatusResult | null = null
    let worldRunning: { at: string; trigger: string } | null = null
    let skeletonRunning: { at: string; mode: 'replace' | 'append' | 'source' } | null = null
    /** The lorebooks the skeleton may read (33c); `null` until asked for. */
    let worldBooks: Array<{ name: string; own: boolean }> | null = null
    let chatId: string | null = null
    let destroyed = false
    /**
     * Tags the user has folded away, seeded with the quest archive.
     *
     * The two archive sections start folded because they are history rather
     * than a workload. The renderer defaults them folded too, for a caller that
     * passes no options at all — but this panel always passes this set, so it
     * has to say so itself or they would open every time.
     */
    const collapsed = new Set<string>(['QUESTS_COMPLETED', 'QUESTS_FAILED'])
    /** The PARTY card compact (47e-ter): a preference, read with the others and flipped by the card's button. */
    let partyCompact = false
    /** Tab Mode (76): Multihog's `panelLayoutMode`, stacked or tabs, and the tab shown last, both preferences read with the others. */
    let panelLayoutMode: 'stack' | 'tabs' = 'stack'
    let activeTab = ''
    /** The Display Groups (75): the switch, the gaps and the groups, preferences read with the others. */
    let displayGroups: { groups: DisplayGroup[]; enabled: boolean; showGaps: boolean } = { groups: [], enabled: false, showGaps: false }
    // The cards' display preferences (72b): the portraits on them, and the inventory's worth.
    let portraitsEnabled = true
    /** Multihog's Show Location Images (80): the Locations folder's thumbnails, off as it ships. */
    let locationImages = false
    /** The relationship float feedback (78c): Multihog's `npcRelationshipToast`, on as it ships; the floater over the tracker's root. */
    let relationshipFloatOn = true
    const relationshipFloat = createRelationshipFloat({ host: () => (destroyed ? null : root) })
    let inventoryDisplay: { showTotal: boolean; worthMode: 'hover' | 'display' } = { showTotal: false, worthMode: 'hover' }
    /** The XP bar at the bottom (74f): nothing until the preference is read (the store's default is Multihog's, on). */
    let xpBarAtBottom = false
    /** The animated bars (74h): the switch for every custom BAR and BARREL, on as Multihog ships it; a first draw compares nothing, so no wait for the preference. */
    let animateCustomBars = true

    /**
     * The report currently on screen, and whether a pass is running behind it.
     *
     * Both exist for the same reason. The report is the *last* pass, which can
     * be hours old, and while a new pass is in flight the two are easy to
     * confuse: a stale failure sat under a running pass reads as the state of
     * the run you just started. It cost a live debugging session — a
     * `PERMISSION_DENIED` from before an update was read as current, while the
     * real fault was this panel timing out on a pass that was working. So a
     * report that is not about the pass in flight says so.
     */
    let lastReport: TrackerPassReportDTO | undefined
    /**
     * The pass in flight, if there is one, and when it started.
     *
     * An object rather than a flag because both halves are shown. A pass that
     * runs after a reply has no button to grey out and no request pending here
     * — the backend's `tracker.started` event is the only sign of it — so the
     * indicator has to carry its own start time, or a pass that dies without
     * reporting leaves a "running now" that never ages and cannot be told from
     * one that started a second ago.
     */
    let running: { at: string; trigger: 'reply' | 'manual' | 'direct' } | null = null

    root.classList.add('lh-tracker')

    /**
     * The head (47a, by the maintainer's list of 2026-10-09): one line that
     * says what is running — five lights, one per process that runs on its
     * own — when the tracker last ran, and the two buttons. Everything else
     * the tracker owns folds under it.
     *
     * The colours are Multihog's `.rpg-tracker-status-indicator`: grey idle,
     * amber pulsing while running, green when done. Multihog has no red; a
     * failed pass is red here, which the report under the fold explains.
     */
    const header = el('div', { class: 'lh-tracker-header lh-tracker-head' })
    const lights = el('span', { class: 'lh-lights', role: 'status' })
    const light = (key: HeadLightKey, label: string) => {
        const wrap = el('span', { class: `lh-light lh-light--${key} lh-light--idle`, 'data-lh-light': key })
        const dot = el('span', { class: 'lh-light-dot', 'aria-hidden': 'true' })
        const name = el('span', { class: 'lh-light-label' })
        name.textContent = label
        wrap.append(dot, name)
        return wrap
    }
    const lightEls: Record<HeadLightKey, HTMLElement> = {
        tracker: light('tracker', 'Tracker'),
        agent: light('agent', 'Agent'),
        world: light('world', 'World'),
        map: light('map', 'Map'),
        // The scene picture (49-bis): a draw on its own runs behind the reply,
        // and its live line is inside the Scene fold, which may be a tab not
        // shown; the first live try drew a picture nobody saw drawing.
        picture: light('picture', 'Picture'),
    }
    lights.append(lightEls.tracker, lightEls.agent, lightEls.world, lightEls.map, lightEls.picture)
    // The day/night cycle (74c): Multihog's sky badge after its title, here
    // after the lights; its starfield across the head at night. Both drawn
    // from the memo's clock on every redraw and shown by the switch's class
    // on the body, so the slot is empty for a chat with no clock and hidden
    // while the cycle is off.
    const starfield = el('span', { class: 'lh-head-starfield', 'aria-hidden': 'true' })
    const skySlot = el('span', { class: 'lh-sky-slot' })
    const headTime = el('span', { class: 'lh-tracker-head-time' })
    const status = el('span', { class: 'lh-tracker-status', role: 'status' })
    const runButton = el('button', { type: 'button', class: 'lh-button' })
    runButton.textContent = 'Run tracker now'
    runButton.title = 'Ask the tracker model what changed, without waiting for the next reply'
    const refreshButton = el('button', { type: 'button', class: 'lh-button' })
    refreshButton.textContent = 'Refresh'
    // The status sits under the header rather than in it. Inside, a message
    // long enough to be useful — "the tracker is updating after the last
    // reply" — competes with the buttons for a panel about 340px wide and wins,
    // wrapping "Run tracker now" into a three-line block.
    header.append(starfield, lights, skySlot, headTime, runButton, refreshButton)

    // The fold of 47a — the tracker's settings, instruction and report under the head — is gone since 78d
    // (the maintainer's ask): the instruction bar is behind the footer's 💬, the report is under the
    // terminal's State Tracker tab, and the connection, window and cadence rows, which the settings
    // categories mirror, were taken off the widget.

    /**
     * Something the user did that did not work.
     *
     * Separate from the status line above, and this is the panel where the
     * separation is provably necessary: **every tracker pass clears the status
     * line twice** — once with the busy notice when it starts, once with
     * `say('')` when it lands. A pass runs after every reply. So the useful
     * life of anything written there is "until the next reply", and a failure
     * the user needs to act on routinely had less than that.
     *
     * That is lesson 8's complaint — *"three separate real causes have been
     * visible for a few seconds in the tracker status line before the next
     * event wiped them; the last one had to be caught in a screenshot"* — and
     * Phase 7b's, which fixed it for portraits alone by moving that one message
     * onto its row. This is the general form of the same fix.
     *
     * Nothing ambient writes here. It goes when the user dismisses it, or when
     * they change chat.
     */
    const problem = el('div', { class: 'lh-problem', role: 'alert' })
    problem.hidden = true
    const problemText = el('span', { class: 'lh-problem-text' })
    const problemDismiss = el('button', { type: 'button', class: 'lh-problem-dismiss' })
    problemDismiss.textContent = 'Dismiss'
    problemDismiss.title = 'Hide this. It does not undo or retry anything.'
    problemDismiss.addEventListener('click', () => { clearProblem() })
    problem.append(problemText, problemDismiss)

    /**
     * Talk to the model directly — Multihog's 💬, the "vital" bar the original
     * plan called ~400 lines (roadmap row 5).
     *
     * One bar per pass. What is typed here goes to the tracker model (or the
     * agent) as its own instruction, with the last few messages as context,
     * and the result lands exactly where a pressed pass's does: the same
     * merge, the same report, the same history. It is how a character is set
     * up before the first turn, how a wrong number is fixed by asking rather
     * than by editing the raw memo, and how a companion is benched when the
     * narration did not say so. Enter sends; Shift+Enter is a new line, as the
     * legacy's bar had it.
     */
    function directBar(options: {
        field: string
        placeholder: string
        hint: string
        max: number
        /** Multihog's prompt bar (78d): the hint on the box's hover, ▶ for Send, `Lookback:` before the count. */
        compact?: boolean
        onSend: (instruction: string) => Promise<void>
        onLookback: (count: number) => Promise<void>
    }) {
        const row = el('div', { class: 'lh-direct', 'data-lh-field': options.field })
        const input = el('textarea', {
            class: 'lh-direct-input',
            // Two rows: at the panel's width the placeholder wraps, and a
            // one-row box cut its second line off in the Phase 30 screenshot.
            rows: '2',
            placeholder: options.placeholder,
            spellcheck: 'false',
        })
        const actions = el('div', { class: 'lh-direct-actions' })
        const send = el('button', { type: 'button', class: 'lh-button' })
        send.textContent = options.compact ? '\u25b6' : 'Send'
        if (options.compact) send.title = 'Send instruction'
        const lookbackLabel = el('label', { class: 'lh-direct-lookback' })
        const lookbackText = el('span')
        lookbackText.textContent = options.compact ? 'Lookback:' : 'reading the last'
        const lookback = el('input', { type: 'number', min: '0', max: String(options.max), step: '1', class: 'lh-input' })
        lookbackLabel.append(lookbackText, lookback)
        if (!options.compact) {
            const lookbackTail = el('span')
            lookbackTail.textContent = 'messages'
            lookbackLabel.append(lookbackTail)
        }
        if (options.compact) {
            row.classList.add('lh-direct--compact')
            lookbackLabel.title = 'Lookback: how many recent messages go with the instruction'
            input.title = options.hint
            actions.append(lookbackLabel, send)
            row.append(input, actions)
        } else {
            actions.append(send, lookbackLabel)
            const hint = el('div', { class: 'lh-direct-hint' })
            hint.textContent = options.hint
            row.append(input, actions, hint)
        }

        const submit = (): void => {
            const text = input.value.trim()
            if (!text) return
            // Cleared before the call, as the legacy clears its draft: the
            // instruction is on its way, and a second Enter must not send it
            // twice.
            input.value = ''
            options.onSend(text).catch(fail)
        }
        send.addEventListener('click', submit)
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit()
            }
        })
        lookback.addEventListener('change', () => {
            options.onLookback(Math.floor(Number(lookback.value))).catch(fail)
        })

        return {
            row,
            input,
            lookback,
            setBusy(busy: boolean): void {
                send.disabled = busy
                input.disabled = busy
            },
        }
    }

    const trackerBar = directBar({
        field: 'tracker-direct',
        placeholder: 'Instruct the tracker model… (Enter to send, Shift+Enter for a new line)',
        hint:
            'Tell the tracker what to change and it edits the state for you: "set up my character from the sheet above", '
            + '"Oswin has gone back to the village", "the healing potion was used". It reads the messages named here for context.',
        max: 50,
        compact: true,
        // The bar closes as the instruction goes, as the legacy's does.
        onSend: (instruction) => { showPromptBar(false); return runNow(instruction) },
        onLookback: (count) => saveDirectLookback('trackerDirectLookback', count),
    })


    /**
     * A "which model runs this" row.
     *
     * Two of these, one per job, because Multihog had two and they are genuinely
     * different jobs: the tracker makes one extraction call against a rigid
     * format, the agent makes several turns of tool-calling. The right model for
     * each is not obviously the same one, and neither is obviously the model
     * writing the story — which is what every AdventureTime build until now used.
     */
    function connectionRow(label: string, hint: string, onChange: (id: string) => void) {
        // Its own class, not the agent fold's. One of these rows lives in the
        // Tracker section and one in the agent's, and borrowing
        // `lh-agent-campaign-hint` across sections is a mistake this panel has
        // already made once — there is a test guarding against it.
        const row = el('div', { class: 'lh-conn', 'data-lh-field': label.toLowerCase().replace(/\W+/g, '-') })
        const name = el('label', { class: 'lh-conn-label' })
        name.textContent = label
        const select = el('select', { class: 'lh-input' }) as HTMLSelectElement
        const note = el('div', { class: 'lh-conn-hint' })
        note.textContent = hint
        row.append(name, select, note)
        select.addEventListener('change', () => { onChange(select.value) })
        return { row, select, note }
    }

    // The tracker's window, cadence and connection rows are the settings categories' alone since 78d.

    /**
     * What the last pass did.
     *
     * The whole reason this exists: a tracker that quietly changes nothing
     * looks exactly like a broken one. This is where "it ran and the model
     * declined" is distinguishable from "it never ran".
     */
    const report = el('div', { class: 'lh-tracker-report' })
    /**
     * The earlier passes (47e): the last thirty the backend kept, newest
     * first, in a select under the report box. Picking one paints it in
     * the box with a line saying it is history; the first choice, and a
     * finished pass, put the last report back.
     */
    const reportHistoryRow = el('div', { class: 'lh-report-history', hidden: 'hidden' })
    const reportHistoryCaption = el('span', { class: 'lh-report-history-label' })
    reportHistoryCaption.textContent = 'Earlier passes'
    const reportHistorySelect = el('select', { class: 'lh-input', 'data-lh-field': 'tracker-report-history' })
    reportHistorySelect.title = 'The tracker\u2019s earlier passes for this chat, newest first. Pick one to read its report.'
    reportHistoryRow.append(reportHistoryCaption, reportHistorySelect)
    reportHistorySelect.addEventListener('change', () => {
        const index = Number(reportHistorySelect.value)
        const chosen = reportHistorySelect.value === '' || !Number.isFinite(index) ? undefined : reportHistory.tracker[index]
        showEarlierPass(chosen).catch(() => undefined)
    })

    const cards = el('div', { class: 'lh-tracker-cards' })
    /**
     * The XP bar at the bottom (74f, Multihog's `#rt-bottom-xp-bar`): the XP
     * card's row pinned at the foot of the box while the switch is on, the
     * card left out of the cards. In the widgets layout it goes in the
     * widget's foot, which never scrolls; elsewhere it follows the play parts
     * and sticks to the foot of the view as they scroll.
     */
    const bottomXp = el('div', { class: 'lh-bottom-xp rt-bottom-xp-bar', 'aria-label': 'Experience progress' })
    bottomXp.hidden = true
    /**
     * The footer's clock (76, the legacy's `rt-footer-time`): Tab Mode's alone until 78b, when the tracker's footer
     * became Multihog's whole — the stepper, the clock and the party's place under the box, in every layout.
     */
    const footClock = el('span', { class: 'lh-foot-clock', title: 'Current in-world time' })
    footClock.hidden = true
    function drawFootClock(showing: string): void {
        const clock = currentClockFromMemo(showing)
        footClock.hidden = !clock
        if (!clock) { footClock.textContent = ''; return }
        const { emoji, color } = getTimeOfDayInfo(clock)
        footClock.style.color = color !== 'inherit' ? color : ''
        footClock.textContent = emoji ? `${emoji} ${clock}` : clock
        footClock.title = `Current Time: ${clock}`
    }
    /**
     * The vitals jump lands on the member (76-bis, the maintainer's ask; the legacy's jump only switches
     * tabs): the PARTY card unfolded if it was folded, the member's own card scrolled into view and
     * outlined a moment, as an anchor would.
     */
    let landedTimer: ReturnType<typeof setTimeout> | null = null
    function landOnEntity(name: string | null): void {
        if (!name) return
        if (collapsed.has('PARTY')) { collapsed.delete('PARTY'); draw() }
        const card = Array.from(cards.querySelectorAll<HTMLElement>('.rt-tabmode-content [data-entity]')).find((el) => el.getAttribute('data-entity') === name)
        if (!card) return
        cards.querySelectorAll('.rt-entity-card--landed').forEach((lit) => lit.classList.remove('rt-entity-card--landed'))
        card.classList.add('rt-entity-card--landed')
        // The tab strip is sticky at the top of the scrolling box, so a card scrolled to the top would sit under it (76-ter):
        // the card asks for the strip's height as its scroll margin, whatever number of rows the strip wrapped to.
        const strip = cards.querySelector<HTMLElement>('.rt-tab-strip')
        if (strip) card.style.scrollMarginTop = `${strip.offsetHeight}px`
        if (typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'start', behavior: 'smooth' })
        if (landedTimer) clearTimeout(landedTimer)
        landedTimer = setTimeout(() => { card.classList.remove('rt-entity-card--landed'); landedTimer = null }, 1800)
    }
    /** A tab chosen (76): drawn at once, kept as a preference so the next session opens on it, as the legacy's localStorage does. */
    function chooseTab(tag: string): void {
        activeTab = tag
        draw()
        bridge.request<PrefsResult>('prefs.patch', { patch: { trackerActiveTab: tag } }).catch(() => undefined)
    }

    // The raw memo in the starting area's drawer clothes since 84 (the maintainer's ask): ✦, the title over its small line, the chevron.
    const rawView = el('details', { class: 'lh-tracker-raw lh-start-drawer', 'data-lh-field': 'raw-memo' })
    const rawSummary = el('summary')
    const rawIcon = el('span', { class: 'lh-start-drawer-icon', 'aria-hidden': 'true' })
    rawIcon.textContent = '✦'
    const rawLabel = el('span', { class: 'lh-start-drawer-label' })
    const rawTitle = el('span', { class: 'lh-start-drawer-title' })
    rawTitle.textContent = 'Raw tracker memo'
    const rawSub = el('small', { class: 'lh-start-drawer-sub' })
    rawSub.textContent = 'The live memo as text: edit it by hand, save, or revert'
    rawLabel.append(rawTitle, rawSub)
    const rawChevron = el('span', { class: 'lh-start-drawer-chevron', 'aria-hidden': 'true' })
    rawChevron.textContent = '▸'
    rawSummary.append(rawIcon, rawLabel, rawChevron)
    const rawBody = el('div', { class: 'lh-start-drawer-body lh-tracker-raw-body' })
    const rawText = el('textarea', { rows: '12', spellcheck: 'false' })
    const rawActions = el('div', { class: 'lh-tracker-raw-actions' })
    const saveButton = el('button', { type: 'button', class: 'lh-button' })
    saveButton.textContent = 'Save memo'
    const revertButton = el('button', { type: 'button', class: 'lh-button' })
    revertButton.textContent = 'Revert'
    rawActions.append(saveButton, revertButton)
    // The raw box always holds the *live* memo. While the stepper is showing a
    // past state the cards above it do not, and editing one while reading the
    // other is the kind of confusion that ends in a lost memo — so it is shut
    // and says why rather than quietly disagreeing with the cards.
    const rawHistoryNote = el('div', { class: 'lh-tracker-raw-note', hidden: 'hidden' })
    rawHistoryNote.textContent =
        'You are looking at a past state. This box still holds the live memo, so it is '
        + 'read-only until you step back to Live or restore.'
    rawBody.append(rawHistoryNote, rawText, rawActions)
    rawView.append(rawSummary, rawBody)

    /**
     * The archive's only escape hatch.
     *
     * Everything else the tracker holds can be corrected by hand in the raw
     * memo, which is why that editor exists. A finished quest is not in the
     * memo, so without this a quest the model wrongly called complete would sit
     * in the log for the life of the campaign.
     *
     * Under the cards, not inside the raw-memo editor: that section is folded
     * away by default, and a button nobody can find is not an escape hatch. Not
     * above them either — it is rare and irreversible, and the cards are what
     * the panel is for. Hidden entirely while the archive is empty.
     */
    /**
     * Nudge the clock times until they match the wall.
     *
     * Set in *hours* rather than minutes, because that is what a timezone
     * looks like to someone reading it, and the half-hour zones round-trip
     * through a decimal fine. The hint is the whole interface: it prints the
     * time the panel currently believes it is, so the setting is adjusted by
     * looking at a clock rather than by knowing a zone name.
     */
    /**
     * Stepping back through the tracker's own past.
     *
     * The maintainer's example is the specification: a chat is 83 messages
     * long, someone deletes 81, 82 and 83, and you step back three views and
     * press restore. Phase 6 already stores the memo after every tracked turn,
     * fifty deep, because the cards under each message needed it; this is the
     * reading of it.
     */
    // Multihog's nav (78b): ← [ LIVE ] → in the footer, the words on the hover; Restore stays AdventureTime's, shown off live.
    const historyRow = el('div', { class: 'lh-tracker-history', 'data-lh-field': 'tracker-nav' })
    const historyBack = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-tracker-nav-button', 'aria-label': 'Older state', title: 'View the previous snapshot' })
    historyBack.textContent = '\u2190'
    const historyLabel = el('span', { class: 'lh-tracker-history-label' })
    const historyForward = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-tracker-nav-button', 'aria-label': 'Newer state', title: 'View the next snapshot' })
    historyForward.textContent = '\u2192'
    const historyRestore = el('button', { type: 'button', class: 'lh-button' })
    historyRestore.textContent = 'Restore this state'
    historyRow.append(historyBack, historyLabel, historyForward, historyRestore)
    historyBack.addEventListener('click', () => { stepTo('back').catch(fail) })
    historyForward.addEventListener('click', () => { stepTo('forward').catch(fail) })
    historyRestore.addEventListener('click', () => { restoreState().catch(fail) })
    /**
     * The tracker's footer (78b, Multihog's `rt-main-footer`, the maintainer's ask): the stepper, the in-world clock
     * and the party's place, under the box — the widget's foot, which never scrolls, or the foot of the view.
     */
    const trackerFooter = el('div', { class: 'lh-tracker-footer', 'data-lh-field': 'tracker-footer' })
    const footPlace = el('span', { class: 'lh-tracker-footer-place', 'data-lh-field': 'tracker-footer-place', title: 'Where the party is, as the last reply\u2019s Location footer names it' })
    /**
     * The foot after Multihog's (78d, the maintainer's ask): on the footer's right `~N tokens` of the memo on
     * screen, **δ** opening the Change Log over the footer, **CLEAR** wiping the memo, and **💬** opening the
     * instruction bar over the footer, which closes as the instruction goes.
     */
    const footTokens = el('span', { class: 'lh-tracker-footer-tokens', 'data-lh-field': 'tracker-footer-tokens', title: 'How big the memo on screen is, as the narrator reads it: an estimate of its tokens' })
    const changeLogButton = el('button', { type: 'button', class: 'lh-footer-btn', 'data-lh-field': 'tracker-change-log-toggle', title: 'Toggle change log' })
    changeLogButton.textContent = '\u03b4'
    const memoClearButton = el('button', { type: 'button', class: 'lh-footer-btn', 'data-lh-field': 'tracker-memo-clear', title: 'Clear the memo. The states under the messages are kept, so \u2190 can still bring one back' })
    memoClearButton.textContent = 'CLEAR'
    const footUtility = el('span', { class: 'lh-tracker-footer-utility' })
    footUtility.append(footTokens, changeLogButton, memoClearButton)
    const promptButton = el('button', { type: 'button', class: 'lh-footer-icon-btn', 'data-lh-field': 'tracker-prompt-toggle', title: 'Toggle direct prompt' })
    promptButton.textContent = '\ud83d\udcac'
    trackerFooter.append(historyRow, footClock, footPlace, footUtility, promptButton)

    /**
     * Multihog's Change Log (78d): the lines the pass that made the state on screen took out and put in,
     * over the footer behind **δ**. Live, it is the last pass's, a save's or a restore's, kept as the legacy
     * keeps `lastDelta`; after a reload it is read off the history once; stepped, it is the diff between
     * the state shown and the one before it, as the legacy draws it under the stepper.
     */
    const changeLog = el('div', { class: 'lh-change-log', 'data-lh-field': 'tracker-change-log' })
    changeLog.hidden = true
    const changeLogBar = el('div', { class: 'lh-change-log-bar' })
    const changeLogTitle = el('span', { class: 'lh-change-log-title' })
    changeLogTitle.textContent = 'Change Log'
    const changeLogClear = el('button', { type: 'button', class: 'lh-footer-icon-btn', 'data-lh-field': 'tracker-change-log-clear', title: 'Clear log' })
    changeLogClear.textContent = '\u2715'
    changeLogBar.append(changeLogTitle, changeLogClear)
    const changeLogContent = el('div', { class: 'lh-change-log-content', 'data-lh-field': 'tracker-change-log-content' })
    changeLog.append(changeLogBar, changeLogContent)
    /** The diff that made the live state; null until a pass, a save or a restore in this chat, when the history answers once. */
    let liveChangeLog: ChangeLog | null = null
    /** ✕ or CLEAR emptied the log, until the next pass. */
    let changeLogCleared = false
    /** The chat whose history the log read for its live diff after a reload. */
    let changeLogRead: string | null = null
    let changeLogLoading = false
    trackerBar.row.hidden = true
    function showPromptBar(show: boolean): void {
        trackerBar.row.hidden = !show
        promptButton.classList.toggle('lh-footer-icon-btn--active', show)
        if (show) trackerBar.input.focus()
    }
    promptButton.addEventListener('click', () => { showPromptBar(trackerBar.row.hidden) })
    changeLogButton.addEventListener('click', () => {
        changeLog.hidden = !changeLog.hidden
        changeLogButton.classList.toggle('lh-footer-btn--active', !changeLog.hidden)
        drawChangeLog()
    })
    changeLogClear.addEventListener('click', () => {
        liveChangeLog = null
        changeLogCleared = true
        drawChangeLog()
    })
    memoClearButton.addEventListener('click', () => { clearMemo().catch(fail) })

    function drawChangeLog(): void {
        if (changeLog.hidden) return
        const position = readPosition(history, historyIndex, memo)
        let log: ChangeLog
        if (position.entry) {
            log = memoChangeLog(history[position.index + 1]?.memo ?? '', position.entry.memo)
        } else if (changeLogCleared) {
            log = { kind: 'empty', text: CHANGE_LOG_TEXT.cleared }
        } else if (liveChangeLog) {
            log = liveChangeLog
        } else if (chatId && changeLogRead === chatId) {
            log = memoChangeLog(history[firstPastIndex(history, memo)]?.memo ?? '', memo)
        } else {
            log = { kind: 'empty', text: CHANGE_LOG_TEXT.noneYet }
            if (chatId && !changeLogLoading) {
                const forChat = chatId
                changeLogLoading = true
                loadHistory()
                    .then(() => { changeLogRead = forChat })
                    .catch(() => undefined)
                    .then(() => {
                        changeLogLoading = false
                        if (!destroyed && chatId === forChat) drawChangeLog()
                    })
            }
        }
        changeLogContent.innerHTML = renderChangeLogHtml(log)
    }

    /**
     * Multihog's CLEAR (78d): the memo wiped, after a confirm. The legacy wipes its stepper's history with it;
     * here the same store draws the cards under the messages, so the history is kept and ← can bring a state
     * back (departure 138).
     */
    async function clearMemo(): Promise<void> {
        if (!chatId) {
            say('No chat open.', 'error')
            return
        }
        if (host.ui) {
            const { confirmed } = await host.ui.showConfirm({
                title: 'Clear the tracker?',
                message: 'This wipes the memo for this chat: every card goes blank until the next pass writes it again. The states under the messages are kept, so \u2190 can bring one back.',
                variant: 'danger',
                confirmLabel: 'Clear',
            })
            if (!confirmed || destroyed) return
        }
        disarmClear()
        const result = await bridge.request<TrackerResult>('tracker.setMemo', { chatId, memo: '' })
        memo = result.memo
        if (result.archivedQuests) archivedQuests = result.archivedQuests
        rawText.value = memo
        liveChangeLog = null
        changeLogCleared = true
        historyIndex = LIVE
        restoreArmed = false
        draw()
        say('The memo is cleared.')
    }


    /**
     * The Lorebook Agent, run on demand.
     *
     * The only control in this panel that writes to a user's campaign, so it
     * says what it did every time — what changed, what it refused, and the
     * steps it took to get there. A pass that did nothing and a pass that never
     * ran must not look the same.
     */
    const agentView = el('details', { class: 'lh-agent' })
    const agentSummary = el('summary')
    agentSummary.textContent = 'Lorebook Agent'
    const agentBody = el('div', { class: 'lh-agent-body' })
    /**
     * What this campaign is called, and therefore what its books are named.
     *
     * Without a name the prefix comes from the chat id, which is a GUID: the
     * first live pass made a book called
     * `854ec108_1090_4ea2_abbd_034a852835ee_Journey`. Correct, unique, and
     * unreadable — and the maintainer asked for named campaign books by name.
     */
    const campaignRow = el('div', { class: 'lh-agent-campaign', 'data-lh-field': 'campaign' })
    const campaignLabel = el('label', { class: 'lh-agent-campaign-label' })
    campaignLabel.textContent = 'Campaign name'
    const campaignInput = el('input', { type: 'text', class: 'lh-input', placeholder: 'Vellmoor' })
    const campaignHint = el('div', { class: 'lh-agent-campaign-hint' })
    campaignRow.append(campaignLabel, campaignInput, campaignHint)
    // On `change` rather than on every keystroke: this renames where future
    // books go, and saving halfway through a word would be a different campaign.
    campaignInput.addEventListener('change', () => { saveCampaignName().catch(fail) })

    /**
     * The campaign's lorebooks and whether the narrator sees them (55).
     *
     * A book the agent makes is scanned by Lumiverse only once it is attached
     * to the chat — the narrator's card, the persona or the global list — and
     * until now nothing said whether it was: a campaign could run for an hour
     * with its lore filed where the narrator never looked. One row per book
     * the campaign expects, grey not made, green attached, red made and not;
     * an Attach button on the red; and the switch that attaches new books on
     * its own after a reply.
     */
    const booksView = el('details', { class: 'lh-books', 'data-lh-field': 'books' }) as HTMLDetailsElement
    const booksSummary = el('summary')
    booksSummary.textContent = 'Lorebooks'
    const booksBody = el('div', { class: 'lh-books-body' })
    const booksLead = el('div', { class: 'lh-books-lead' })
    booksLead.textContent = 'The campaign’s books, and whether the narrator can see them: a book is scanned only once it is attached to this chat, the narrator’s card, the persona or the global list.'
    const booksList = el('div', { class: 'lh-books-list' })
    const booksBar = el('div', { class: 'lh-books-bar' })
    const booksAttachAll = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'books-attach-all' }) as HTMLButtonElement
    booksAttachAll.textContent = 'Attach all to this chat'
    const booksCheck = el('button', { type: 'button', class: 'lh-button lh-button--quiet' }) as HTMLButtonElement
    booksCheck.textContent = 'Check again'
    booksBar.append(booksAttachAll, booksCheck)
    const booksAuto = el('label', { class: 'lh-books-auto' })
    const booksAutoInput = el('input', { type: 'checkbox', 'data-lh-field': 'books-auto' }) as HTMLInputElement
    booksAutoInput.checked = true
    const booksAutoLabel = el('span')
    booksAutoLabel.textContent = 'Attach new books as they are made'
    booksAuto.title = 'The moment one of the campaign’s books is made, it is attached where the row below says — nothing of yours is removed from any list.'
    booksAuto.append(booksAutoInput, booksAutoLabel)
    // Where a book is attached (55-ter): this chat's own record by default,
    // so a narrator card reused across campaigns carries none of them; or
    // the narrator's card, which follows the card wherever it is used.
    const booksTarget = el('label', { class: 'lh-books-auto' })
    const booksTargetLabel = el('span')
    booksTargetLabel.textContent = 'Attach to'
    const booksTargetSelect = el('select', { class: 'lh-input', 'data-lh-field': 'books-target' }) as HTMLSelectElement
    for (const [value, text] of [['chat', 'this chat only (recommended)'], ['card', 'the narrator’s card, for every chat it is used in']] as const) {
        const option = el('option', { value }) as HTMLOptionElement
        option.textContent = text
        booksTargetSelect.append(option)
    }
    booksTarget.title = 'The chat: the books are scanned in this chat and nowhere else, and a card used in another campaign does not carry them along. The card: the books go wherever the card goes.'
    booksTarget.append(booksTargetLabel, booksTargetSelect)
    const booksNote = el('div', { class: 'lh-books-note' })
    booksBody.append(booksLead, booksList, booksBar, booksAuto, booksTarget, booksNote)
    booksView.append(booksSummary, booksBody)
    let books: CampaignBooksResult | null = null
    let booksLoading = false
    let booksBusy = false
    let booksLast: { text: string; error: boolean } | null = null

    /** The words for a book's standing, in the row. */
    function bookWords(book: CampaignBooksResult['books'][number]): string {
        if (book.state === 'missing') return 'not made yet'
        if (book.state === 'adoptable') return 'made under this name, but not this campaign’s: adopt it to write into it here'
        if (book.state === 'detached') return 'made, but not attached: the narrator does not see it'
        const by = book.sources.map((s) => s === 'chat' ? 'this chat' : s === 'character' ? 'the card' : s === 'persona' ? 'the persona' : 'the global list')
        return `attached to ${by.join(' and ')}`
    }

    /** Whether Attach can be offered: the chat's record writable, or the card known, by the target. */
    function booksAttachable(): boolean {
        if (!books) return false
        return books.target === 'card' ? !!books.card : books.chatScope
    }

    /** Where Attach puts a book, in words. */
    function booksWhere(): string {
        return books?.target === 'card' ? (books.card?.name ? `“${books.card.name}”` : 'the card') : 'this chat'
    }

    function drawBooks(): void {
        booksList.replaceChildren()
        const rows = books?.books ?? []
        const detached = rows.filter((b) => b.state === 'detached')
        booksSummary.textContent = detached.length ? `Lorebooks — ${detached.length} not attached` : books ? `Lorebooks — ${rows.filter((b) => b.state === 'attached').length} of ${rows.length} attached` : 'Lorebooks'
        booksSummary.classList.toggle('lh-books-summary--warn', detached.length > 0)
        for (const book of rows) {
            const row = el('div', { class: `lh-book-row lh-book-row--${book.state}`, 'data-lh-book': book.name })
            const dot = el('span', { class: 'lh-book-dot', 'aria-hidden': 'true' })
            const name = el('span', { class: 'lh-book-name' })
            name.textContent = book.name
            const words = el('span', { class: 'lh-book-words' })
            words.textContent = bookWords(book)
            row.append(dot, name, words)
            if (book.state === 'detached' && book.id && booksAttachable()) {
                const attach = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'aria-label': `Attach ${book.name} to ${books?.target === 'card' ? 'the card' : 'this chat'}` }) as HTMLButtonElement
                attach.textContent = 'Attach'
                attach.disabled = booksBusy
                attach.addEventListener('click', () => { attachBooks(book.id!).catch(fail) })
                row.append(attach)
            }
            if (book.state === 'adoptable' && book.id) {
                // A fork's books, or a prefix typed to match another chat's (56): adopted on request, never on their name alone.
                const adopt = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'aria-label': `Adopt ${book.name} as this campaign’s` }) as HTMLButtonElement
                adopt.textContent = 'Adopt'
                adopt.disabled = booksBusy
                adopt.title = 'Record this book as the campaign’s: the agent writes into it from then on, and it is attached where the row below says.'
                adopt.addEventListener('click', () => { adoptBook(book.id!, book.name).catch(fail) })
                row.append(adopt)
            }
            booksList.append(row)
        }
        if (books && !rows.length) {
            const empty = el('div', { class: 'lh-book-row lh-book-row--missing' })
            empty.textContent = 'No book is expected: no agent module is on.'
            booksList.append(empty)
        }
        booksAttachAll.textContent = books?.target === 'card' ? 'Attach all to the card' : 'Attach all to this chat'
        booksAttachAll.hidden = !detached.length || !booksAttachable()
        booksAttachAll.disabled = booksBusy
        booksCheck.disabled = booksLoading || booksBusy
        booksCheck.textContent = booksLoading ? 'Asking…' : books ? 'Check again' : 'Check the books'
        if (books && booksTargetSelect.value !== books.target) booksTargetSelect.value = books.target
        const standing = books && detached.length && !booksAttachable()
            ? books.target === 'card'
                ? 'The chat’s card is not known, so nothing can be attached from here; attach the books in Lumiverse’s character editor.'
                : 'The chat’s record cannot be written, so nothing can be attached from here; attach the books in Lumiverse’s own lorebook settings for this chat.'
            : ''
        booksNote.textContent = booksLast ? booksLast.text : books?.problem ? `Something could not be read: ${reasonText(books.problem)}.` : standing
        booksNote.classList.toggle('lh-books-note--error', !!booksLast?.error || (!booksLast && !!books?.problem))
    }

    async function loadBooks(): Promise<void> {
        if (!chatId || booksLoading) return
        const asked = chatId
        booksLoading = true
        drawBooks()
        try {
            const result = await bridge.request<CampaignBooksResult>('lore.books', { chatId: asked })
            if (destroyed || chatId !== asked) return
            books = result
            booksLast = null
        } catch (error) {
            if (destroyed || chatId !== asked) return
            booksLast = { text: `The books could not be listed: ${reasonText(error instanceof Error ? error.message : String(error))}.`, error: true }
        } finally {
            booksLoading = false
            drawBooks()
        }
    }

    async function attachBooks(bookId?: string): Promise<void> {
        if (!chatId || booksBusy) return
        const asked = chatId
        booksBusy = true
        booksLast = null
        drawBooks()
        try {
            const result = await bridge.request<CampaignBooksResult>('lore.attach', { chatId: asked, ...(bookId ? { bookId } : {}) })
            if (destroyed || chatId !== asked) return
            books = result
            const name = bookId ? result.books.find((b) => b.id === bookId)?.name ?? 'The book' : 'The books'
            booksLast = { text: `${name} ${bookId ? 'is' : 'are'} attached to ${booksWhere()}; the narrator sees ${bookId ? 'it' : 'them'} from the next reply.`, error: false }
        } catch (error) {
            if (destroyed || chatId !== asked) return
            booksLast = { text: `Nothing was attached: ${reasonText(error instanceof Error ? error.message : String(error))}.`, error: true }
        } finally {
            booksBusy = false
            drawBooks()
        }
    }

    async function adoptBook(bookId: string, name: string): Promise<void> {
        if (!chatId || booksBusy) return
        const asked = chatId
        booksBusy = true
        booksLast = null
        drawBooks()
        try {
            const result = await bridge.request<CampaignBooksResult>('lore.adopt', { chatId: asked, bookId })
            if (destroyed || chatId !== asked) return
            books = result
            const row = result.books.find((b) => b.id === bookId)
            booksLast = { text: `${name} is this campaign’s now${row?.state === 'attached' ? `, attached to ${row.sources.map((s) => s === 'chat' ? 'this chat' : s === 'character' ? 'the card' : s === 'persona' ? 'the persona' : 'the global list').join(' and ')}` : ''}; the agent writes into it from the next pass.`, error: false }
        } catch (error) {
            if (destroyed || chatId !== asked) return
            booksLast = { text: `Nothing was adopted: ${reasonText(error instanceof Error ? error.message : String(error))}.`, error: true }
        } finally {
            booksBusy = false
            drawBooks()
        }
    }

    /** Read the books again when the fold is open: a pass may have made one. */
    function refreshBooks(): void {
        if (booksView.open) loadBooks().catch(fail)
    }

    // Read on every open (55-quater): a pass that made a book while the fold
    // was closed is not re-read by the event, and a list read once and kept
    // showed three new books grey until Check again.
    booksView.addEventListener('toggle', () => { if (booksView.open && !booksLoading) loadBooks().catch(fail) })
    booksCheck.addEventListener('click', () => { loadBooks().catch(fail) })
    booksAttachAll.addEventListener('click', () => { attachBooks().catch(fail) })
    booksAutoInput.addEventListener('change', () => {
        bridge.request<PrefsResult>('prefs.patch', { patch: { attachBooksToCard: booksAutoInput.checked } }).catch(fail)
    })
    booksTargetSelect.addEventListener('change', () => {
        const target = booksTargetSelect.value === 'card' ? 'card' : 'chat'
        if (books) books = { ...books, target }
        drawBooks()
        bridge.request<PrefsResult>('prefs.patch', { patch: { attachBooksTarget: target } }).then(() => loadBooks()).catch(fail)
    })
    drawBooks()

    /**
     * How far back the agent reads.
     *
     * `0` — the default — is the whole chat, which is what a first pass over an
     * established campaign needs: the agent was reading the last dozen messages
     * and missing everything before them. A window exists for the case where
     * the whole chat is too much to send.
     */
    const lookbackRow = el('div', { class: 'lh-agent-campaign', 'data-lh-field': 'lookback' })
    const lookbackLabel = el('label', { class: 'lh-agent-campaign-label' })
    lookbackLabel.textContent = 'Messages to read'
    const lookbackInput = el('input', { type: 'number', min: '0', step: '1', class: 'lh-input' })
    const lookbackHint = el('div', { class: 'lh-agent-campaign-hint' })
    lookbackRow.append(lookbackLabel, lookbackInput, lookbackHint)
    lookbackInput.addEventListener('change', () => { saveLookback().catch(fail) })

    /**
     * How many model calls one pass may make.
     *
     * The dial that decides how long a pass takes, and the reason a pass on a
     * tiny campaign could still take a minute: the turns are sequential, and the
     * budget was ten with no way to say otherwise. The legacy had this control
     * and the port lost it.
     */
    const turnsRow = el('div', { class: 'lh-agent-campaign', 'data-lh-field': 'turns' })
    const turnsLabel = el('label', { class: 'lh-agent-campaign-label' })
    turnsLabel.textContent = 'Research turns'
    const turnsInput = el('input', { type: 'number', min: '1', step: '1', class: 'lh-input' })
    const turnsHint = el('div', { class: 'lh-agent-campaign-hint' })
    turnsRow.append(turnsLabel, turnsInput, turnsHint)
    turnsInput.addEventListener('change', () => { saveMaxTurns().catch(fail) })

    /**
     * How often a pass runs on its own.
     *
     * The number is the switch: `0` stops it. A separate checkbox would mean
     * two places to look when the question is "why is this writing to my
     * campaign", and this is the thing that writes without being asked.
     */
    const cadenceRow = el('div', { class: 'lh-agent-campaign', 'data-lh-field': 'cadence' })
    const cadenceLabel = el('label', { class: 'lh-agent-campaign-label' })
    cadenceLabel.textContent = 'Replies between automatic passes'
    const cadenceInput = el('input', { type: 'number', min: '0', max: '50', step: '1', class: 'lh-input' })
    const cadenceHint = el('div', { class: 'lh-agent-campaign-hint' })
    cadenceRow.append(cadenceLabel, cadenceInput, cadenceHint)
    cadenceInput.addEventListener('change', () => { saveCadence().catch(fail) })

    /**
     * Stop a pass that is already running.
     *
     * Lives inside the "a pass is running now" notice rather than beside the
     * Run button, because that notice is the only thing on screen while a pass
     * runs and it is where the user is already looking. Phase 7's lesson: a
     * message about one thing goes on that thing.
     *
     * Only the model call is interruptible. Stopping the tracker leaves the
     * memo exactly as it was; stopping the agent leaves every lorebook
     * untouched, because the write happens after the last model call.
     */
    const stopTrackerButton = el('button', { type: 'button', class: 'lh-button lh-button--stop' })
    stopTrackerButton.textContent = 'Stop'
    stopTrackerButton.title = 'Stop this tracker pass. The memo is left exactly as it is.'
    stopTrackerButton.addEventListener('click', () => { stopPass('tracker').catch(fail) })

    const stopAgentButton = el('button', { type: 'button', class: 'lh-button lh-button--stop' })
    stopAgentButton.textContent = 'Stop'
    stopAgentButton.title = 'Stop this agent pass. No lorebook is written.'
    stopAgentButton.addEventListener('click', () => { stopPass('agent').catch(fail) })

    const agentConnection = connectionRow(
        'Agent model',
        '',
        (id) => { saveConnection('agentConnectionId', id).catch(fail) },
    )

    const agentButton = el('button', { type: 'button', class: 'lh-button' })
    agentButton.textContent = 'Run the agent now'
    agentButton.addEventListener('click', () => { runAgent().catch(fail) })
    const agentBar = directBar({
        field: 'agent-direct',
        placeholder: 'Instruct the Lorebook Agent… (Enter to send, Shift+Enter for a new line)',
        hint:
            'Tell the agent what to write or fix in this campaign\u2019s lorebooks: "add an entry for the innkeeper", '
            + '"Malachar is now the king", "merge the two entries about the pass". It reads the messages named here for context.',
        max: 100,
        onSend: (instruction) => runAgent(instruction),
        onLookback: (count) => saveDirectLookback('agentDirectLookback', count),
    })
    drawDirectLookbacks()
    // Above the report, not inside it. A pass running now and the report of
    // the previous pass are two different passes, and the tracker learned in
    // Phase 4a that a box which can show two ages at once has to date both.
    const agentLive = el('div', { class: 'lh-agent-running', hidden: 'hidden' })
    const agentNote = el('div', { class: 'lh-agent-note' })
    agentNote.textContent = 'Reads the story so far and updates this campaign\u2019s lorebooks.'
    const agentDetail = el('div', { class: 'lh-agent-detail' })
    /** The agent's earlier passes (47e), as the tracker's. */
    const agentHistoryRow = el('div', { class: 'lh-report-history', hidden: 'hidden' })
    const agentHistoryCaption = el('span', { class: 'lh-report-history-label' })
    agentHistoryCaption.textContent = 'Earlier passes'
    const agentHistorySelect = el('select', { class: 'lh-input', 'data-lh-field': 'agent-report-history' })
    agentHistorySelect.title = 'The agent\u2019s earlier passes for this chat, newest first. Pick one to read its report.'
    agentHistoryRow.append(agentHistoryCaption, agentHistorySelect)
    agentHistorySelect.addEventListener('change', () => {
        const index = Number(agentHistorySelect.value)
        const chosen = agentHistorySelect.value === '' || !Number.isFinite(index) ? undefined : reportHistory.agent[index]
        if (chosen) paintAgent(chosen, true)
        else paintAgent(agentReport, false)
    })

    /**
     * The agent's tools (71c): Multihog's title bar and footer — the full
     * audit, the cleanup menu, the pause, the clone, and ← undo [ LIVE ]
     * redo → under the report. Each runs a pass of the agent, so the
     * report box follows it; the undo is deliberately not a confirm dialog
     * (the destructive act was the pass, and this is the way back), and
     * what it says afterwards is the safeguard.
     */
    const agentTools = createAgentTools({
        el,
        campaignName: () => campaignInput.value.trim(),
        audit: () => bridge.request<AgentAuditResult>('agent.audit', { chatId }),
        auditStop: () => bridge.request<{ stopped: boolean }>('agent.audit.stop', { chatId }),
        cleanup: (instructions) => bridge.request<AgentRunResult>('agent.cleanup', { chatId, instructions }),
        undo: () => bridge.request<AgentUndoResult>('agent.undo', { chatId }),
        redo: () => bridge.request<AgentRedoResult>('agent.redo', { chatId }),
        clone: (newPrefix) => bridge.request<CampaignCloneResult>('campaign.clone', { chatId, newPrefix }),
        savePrefs: async (patch) => { await bridge.request<PrefsResult>('prefs.patch', { patch }) },
        ...(host.ui ? { confirm: async (title: string, message: string, confirmLabel: string) => (await host.ui!.showConfirm({ title, message, variant: 'warning', confirmLabel })).confirmed } : {}),
        fail,
        onBusy: (busy) => { agentButton.disabled = busy; agentBar.setBusy(busy) },
        onPass: (result) => { agentReport = result; drawAgent(); noteAgentReport(result); refreshBooks(); if (recordsFold.root.open) recordsFold.load().catch(() => undefined) },
        // The report on screen describes a pass that no longer stands, or stands again.
        onUndone: () => { agentReport = null; drawAgent(); if (recordsFold.root.open) recordsFold.load().catch(() => undefined) },
        onRedone: () => { agentReport = null; drawAgent(); if (recordsFold.root.open) recordsFold.load().catch(() => undefined) },
    })

    /**
     * Campaign Records (71a): the campaign's books with their entries, after
     * the Lorebooks list as Multihog's tab has them. The clean is the agent's
     * instructed pass, so its report lands in the agent's box; a map made
     * here reaches the Maps fold through `onMapsChanged`.
     */
    /** The Campaign Records' doors (78b), filled once the folds they open exist. */
    const recordsPanels: NonNullable<Parameters<typeof createRecordsFold>[0]['panels']> = {}
    const recordsFold = createRecordsFold({
        el,
        list: () => bridge.request<CampaignRecordsResult>('records.list', { chatId }),
        // The standings on the cards (78b, Multihog's bars; 44's fold is gone) and the Player Character at the top.
        relations: () => bridge.request<RelationshipsView>('relations.get', { chatId }),
        setRelation: (id, field, value) => bridge.request<RelationshipsView>('relations.set', { chatId, id, field, value }),
        forgetRelation: (id) => bridge.request<RelationshipsView>('relations.remove', { chatId, id }),
        onRelations: (view) => { cardSettings.applyRelationships(view.enabled) },
        playerCard: () => bridge.request<PlayerCardView>('creator.card.get', { chatId }),
        savePlayerCardToLibrary: (overwrite) => bridge.request<{ name: string } | { status: 'exists'; name: string }>('library.savePlayerCard', { chatId, overwrite }),
        removePlayerCard: async () => { await bridge.request<{ ok: boolean }>('creator.card.remove', { chatId }); playerCardFold.refresh() },
        portrait: (name) => portraitFor(portraits, name),
        npcCards: () => portraitsEnabled,
        // The pictures' buttons on the large view (80), and Multihog's location images under the Locations folder.
        portraitActions: (name) => portraitActions(name),
        locationImages: () => locationImages,
        locationImage: (path) => portraitFor(portraits, locationImageKey(path)),
        locationActions: (path) => locationActions(path),
        clearRelationLog: (id) => bridge.request<RelationshipsView>('relations.clearLog', { chatId, id }),
        modal: (options) => openDetailsModal(host.ui, options),
        panels: recordsPanels,
        ...(enlarge ? { enlarge } : {}),
        when: (iso) => when(iso),
        update: (write) => bridge.request<RecordEntryResult>('records.update', { chatId, ...write }),
        remove: (entryId) => bridge.request<{ removed: true; title: string }>('records.remove', { chatId, entryId }),
        pin: (entryId, pinned) => bridge.request<RecordEntryResult>('records.pin', { chatId, entryId, pinned }),
        removeMap: (entryId) => bridge.request<RecordRemoveMapResult>('records.removeMap', { chatId, entryId }),
        create: (request) => bridge.request<MapCreateResult>('map.create', { chatId, ...request }),
        cards: async () => (await bridge.request<{ cards: CardChoice[] }>('creator.cards')).cards,
        saveToLibrary: (entryId, overwrite) => bridge.request<{ name: string } | { status: 'exists'; name: string }>('library.saveEntry', { chatId, entryId, overwrite }),
        // Edit with AI (78c): one call on the agent's connection, the revised entry back for review.
        aiEdit: (content, instructions) => bridge.request<CardAiEditResult>('records.aiEdit', { kind: 'npc', content, instructions }),
        // The cleanup pass on that one entry (71c), its report in the agent's box.
        clean: async (target, requirements) => {
            const result = await bridge.request<AgentRunResult>('agent.cleanup', { chatId, target, instructions: requirements })
            agentReport = result
            drawAgent()
            noteAgentReport(result)
        },
        confirm: async (title, message, confirmLabel) => host.ui ? (await host.ui.showConfirm({ title, message, variant: 'danger', confirmLabel })).confirmed : true,
        onMapsChanged: () => { loadMaps().catch(() => undefined) },
        onLibraryChanged: () => { libraryFold.refresh().catch(() => undefined) },
        fail,
    })

    // The terminal (71b): Multihog's Terminal/Direct Prompt — every agent's feed and its direct bar, one tab each.
    const terminalFold = createTerminalFold({
        el,
        load: (forChat) => bridge.request<TerminalResult>('terminal.get', { chatId: forChat }),
        clear: (forChat, source) => bridge.request<TerminalResult>('terminal.clear', { chatId: forChat, source }),
        run: async (source, text, lookback) => {
            if (!chatId) throw new Error('No chat open.')
            const asked = chatId
            if (source === 'state_tracker') {
                // The tracker's bar reads its own window, the preference the bar just saved.
                trackerDirectLookback = lookback
                drawDirectLookbacks()
                await runNow(text)
            } else if (source === 'lorebook_agent') {
                agentDirectLookback = lookback
                drawDirectLookbacks()
                await runAgent(text)
            } else if (source === 'map_updater') {
                await updateMapNow(text, lookback)
            } else if (source === 'map_evolution') {
                await evolveNow(text, lookback)
            } else {
                const result = await bridge.request<MapCreateResult>('map.direct', { chatId: asked, text, lookback })
                if (destroyed || chatId !== asked) return
                loadMaps().catch(() => undefined)
                if (recordsFold.root.open) recordsFold.load().catch(() => undefined)
                if (result.status === 'failed') throw new Error(result.reason ?? 'The architect failed.')
            }
        },
        savePrefs: async (patch) => { await bridge.request<PrefsResult>('prefs.patch', { patch }) },
        fail: (error) => fail(error),
    })

    /**
     * The Lorebook Agent tab after Multihog's (78a): the tools strip with Run on it, the send bar, then
     * Multihog's drawers in its order — Quick Settings, Modular Repertoire, Terminal/Direct Prompt, Map
     * Evolution, World Progression — and the footer. The body is filled where the folds are placed, once
     * the evolution and the world folds exist; the campaign's name and its books, neither in Multihog's
     * tab, are a fold of their own in the settings tab.
     */
    agentTools.strip.prepend(agentButton)
    function drawer(field: string, icon: string, title: string): { root: HTMLDetailsElement; body: HTMLElement; badge: HTMLElement } {
        const root = el('details', { class: 'lh-agent-drawer', 'data-lh-field': field }) as HTMLDetailsElement
        const summary = el('summary')
        const iconEl = el('span', { class: 'lh-card-icon', 'aria-hidden': 'true' })
        iconEl.textContent = icon
        const titleEl = el('span', { class: 'lh-agent-drawer-title' })
        titleEl.textContent = title
        const badge = el('span', { class: 'lh-agent-badge', hidden: 'hidden' })
        summary.append(iconEl, titleEl, badge)
        const body = el('div', { class: 'lh-agent-drawer-body' })
        root.append(summary, body)
        return { root, body, badge }
    }
    // Quick Settings: the dials table's own rows (63c) for what Multihog's drawer has and the fold never drew —
    // the lookback mode, the updater's cadence, the rollback on a swipe — so a change here and in the settings
    // category is one preference; the fold's three rows and the connection between them.
    const quickGroup = (id: string, keys: string[]): DialGroup => ({
        id,
        category: 'agent',
        sections: [{ id, icon: '', title: '', lead: '', rows: keys.map((key) => { const row = dialRows().find((r) => r.key === key); if (!row) throw new Error(`no dial row ${key}`); return row }) }],
    })
    const dialsHost = { el, savePrefs: (patch: Record<string, unknown>) => bridge.request<PrefsResult>('prefs.patch', { patch }).then(() => undefined), fail: (error: unknown) => fail(error) }
    const quickMode = createPrefDials(dialsHost, quickGroup('quick-mode', ['agentLookbackMode']))
    const quickMore = createPrefDials(dialsHost, quickGroup('quick-more', ['mapUpdaterRunEvery', 'agentSwipeRollback']))
    for (const box of [quickMode.root, quickMore.root]) for (const card of Array.from(box.querySelectorAll('details'))) card.open = true
    const quick = drawer('agent-quick', '⚙️', 'Quick Settings')
    quick.body.append(quickMode.root, lookbackRow, cadenceRow, quickMore.root, turnsRow, agentConnection.row)
    // Modular Repertoire: the Agent modules and Custom tags editors, handed over by the panel (47e, departure 101).
    const repertoireDrawer = drawer('agent-repertoire', '🧩', 'Modular Repertoire (Prompt Rules)')
    if (slots.repertoire) repertoireDrawer.body.append(slots.repertoire)
    else {
        const none = el('div', { class: 'lh-agent-campaign-hint' })
        none.textContent = 'The Agent modules and Custom tags editors are in the settings in this layout.'
        repertoireDrawer.body.append(none)
    }
    // The report, the live line and Earlier passes under the terminal's Lorebook Agent tab: Multihog's Agent Log History.
    terminalFold.history('lorebook_agent').append(agentLive, agentNote, agentDetail, agentHistoryRow)
    // The footer: ← Undo [LIVE] Redo →, the party's place, Last run.
    const agentFooter = el('div', { class: 'lh-agent-footer', 'data-lh-field': 'agent-footer' })
    const agentFooterRun = el('span', { class: 'lh-agent-footer-run', 'data-lh-field': 'agent-footer-run' })
    agentFooter.append(agentTools.footer, agentFooterRun)
    // The campaign's name and its books: a drawer after Quick Settings (78b, the maintainer's answer).
    const campaignDrawer = drawer('agent-campaign', '📚', 'Campaign')
    campaignDrawer.body.append(campaignRow, booksView)
    /**
     * Active Lore Keys (78b, Multihog's pill row; the maintainer's answer to 78a's issue 5): what the host has
     * active for this chat, each entry a pill — the diagnostic of Phase 7, which left the panel in 60. Multihog's
     * row is the agent's own activation pool; here the host's scan decides, so the pills are what it found.
     */
    const keysDrawer = drawer('agent-active-keys', '🔑', 'Active Lore Keys')
    const keysNote = el('div', { class: 'lh-agent-campaign-hint lh-lore-note', 'data-lh-field': 'active-keys-note' })
    const keysPills = el('div', { class: 'lh-lore-pills', 'data-lh-field': 'active-keys' })
    const keysButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'active-keys-check' })
    keysButton.textContent = 'Check again'
    keysButton.title = 'Ask Lumiverse which lore entries it has active for this chat now'
    keysButton.addEventListener('click', () => { loadActivation().catch(fail) })
    keysDrawer.body.append(keysNote, keysPills, keysButton)
    keysDrawer.badge.hidden = false
    keysDrawer.badge.textContent = '–'
    keysDrawer.root.addEventListener('toggle', () => { if (keysDrawer.root.open && chatId && !activation) loadActivation().catch(fail) })
    let activation: ActivatedLoreResult | null = null
    let activationChat: string | null = null
    let activationLoading = false
    async function loadActivation(): Promise<void> {
        if (!chatId) { activation = null; drawActivation(); return }
        // One read at a time: a browser fires the drawer's own toggle beside a dispatched one (78a's lesson).
        if (activationLoading) return
        activationLoading = true
        const asked = chatId
        keysButton.disabled = true
        try {
            const result = await bridge.request<ActivatedLoreResult>('lore.activated', { chatId: asked })
            if (destroyed || chatId !== asked) return
            activation = result
            activationChat = asked
        } catch (error) {
            if (destroyed || chatId !== asked) return
            activation = { entries: [], unavailable: error instanceof Error ? error.message : String(error) }
            activationChat = asked
        } finally {
            keysButton.disabled = false
            activationLoading = false
        }
        drawActivation()
    }
    function drawActivation(): void {
        keysPills.replaceChildren()
        keysNote.classList.remove('lh-lore-note--error')
        if (!chatId) { keysNote.textContent = 'Open a chat first.'; keysDrawer.badge.textContent = '–'; return }
        if (!activation) { keysNote.textContent = 'Ask Lumiverse which lore entries it has active for this chat.'; keysDrawer.badge.textContent = '–'; return }
        if (activation.unavailable) { keysNote.textContent = activation.unavailable; keysNote.classList.add('lh-lore-note--error'); keysDrawer.badge.textContent = '–'; return }
        const view = buildActivationView(activation.entries, activation.eligibility)
        keysNote.textContent = view.diagnosis ? `${view.summary} ${view.diagnosis}` : view.summary
        keysDrawer.badge.textContent = String(view.total)
        if (!view.rows.length) { const none = el('span', { class: 'lh-lore-pill lh-lore-pill--none' }); none.textContent = 'No active keys'; keysPills.append(none); return }
        for (const row of view.rows) {
            const pill = el('span', { class: `lh-lore-pill lh-lore-pill--${row.source}`, 'data-lh-key': row.id })
            pill.textContent = row.label
            const how = row.source === 'vector' ? `by meaning${row.score ? ` (${row.score})` : ''}` : row.source === 'always' ? 'always in, matched by nothing' : 'by keyword'
            pill.title = row.keys ? `${how} \u00b7 keys: ${row.keys}` : how
            keysPills.append(pill)
        }
    }
    agentView.append(agentSummary, agentBody)

    /**
     * World Progression (roadmap row 8): the world moving while the party is
     * not looking. A fold of its own under the agent, because it is the other
     * thing here that writes to the campaign on its own schedule -- an
     * in-world one. Its numbers are preferences; its clock is per chat.
     */
    const worldView = el('details', { class: 'lh-world lh-agent-drawer', 'data-lh-field': 'agent-world' })
    const worldSummary = el('summary')
    const worldTitle = el('span', { class: 'lh-agent-drawer-title' })
    worldTitle.textContent = '🌍 World Progression'
    // Multihog's ON/OFF badge on the drawer's header (78a): a click flips the switch below.
    const worldBadge = el('span', { class: 'lh-agent-badge', 'data-lh-field': 'world-badge', role: 'button', tabindex: '0', title: 'Click to toggle World Progression' })
    worldBadge.textContent = 'OFF'
    worldSummary.append(worldTitle, worldBadge)
    const worldBody = el('div', { class: 'lh-world-body' })
    const worldLead = el('div', { class: 'lh-world-lead' })
    worldLead.textContent =
        'Every in-world day, a model writes a short report on how a few of this campaign\u2019s locations have moved '
        + '\u2014 trade, sentiment, weather, conflict \u2014 from their lore and the reports before. The newest is shown to the narrator.'
    const worldSwitchRow = el('label', { class: 'lh-world-switch', 'data-lh-field': 'world-enabled' })
    const worldSwitch = el('input', { type: 'checkbox' })
    const worldSwitchText = el('span')
    worldSwitchText.textContent = 'Write reports'
    worldSwitchRow.append(worldSwitch, worldSwitchText)
    worldSwitch.addEventListener('change', () => { saveWorldPref({ worldProgressionEnabled: worldSwitch.checked }).catch(fail) })
    worldBadge.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (worldSwitch.disabled) return
        worldSwitch.checked = !worldSwitch.checked
        worldSwitch.dispatchEvent(new Event('change'))
    })

    const worldNumber = (field: string, label: string, hint: string, min: number, max: number, key: 'worldProgressionIntervalHours' | 'worldProgressionLocationsPerReport' | 'worldProgressionKeepActive' | 'worldProgressionLookback') => {
        const row = el('div', { class: 'lh-agent-campaign', 'data-lh-field': field })
        const name = el('label', { class: 'lh-agent-campaign-label' })
        name.textContent = label
        const input = el('input', { type: 'number', min: String(min), max: String(max), step: '1', class: 'lh-input' })
        const note = el('div', { class: 'lh-agent-campaign-hint' })
        note.textContent = hint
        row.append(name, input, note)
        input.addEventListener('change', () => { saveWorldPref({ [key]: Math.floor(Number(input.value)) }).catch(fail) })
        return { row, input }
    }
    const worldInterval = worldNumber('world-interval', 'In-world hours between reports', 'Multihog\u2019s 24: one report a day. The clock is the tracker\u2019s [TIME] block.', 1, 720, 'worldProgressionIntervalHours')
    const worldLocations = worldNumber('world-locations', 'Locations per report', 'The ones advanced longest ago go first; named people are never subjects.', 1, 12, 'worldProgressionLocationsPerReport')
    const worldKeep = worldNumber('world-keep', 'Reports shown to the narrator', 'The newest N. The rest stay in the campaign\u2019s _World book as history.', 1, 20, 'worldProgressionKeepActive')
    const worldLookback = worldNumber('world-lookback', 'Replies the writer reads', 'For scene context only. 0 reads none.', 0, 200, 'worldProgressionLookback')

    const worldStatusLine = el('div', { class: 'lh-world-status' })
    const worldReportsLine = el('div', { class: 'lh-agent-campaign-hint lh-world-reports' })
    const worldLive = el('div', { class: 'lh-world-running', hidden: 'hidden' })
    const worldNote = el('div', { class: 'lh-world-note' })

    const worldRunButton = el('button', { type: 'button', class: 'lh-button' })
    worldRunButton.textContent = 'Write a report now'
    worldRunButton.title = 'Now, whatever the clock says: the report is dated at the clock, so a second press with the clock unmoved is already filed.'
    worldRunButton.addEventListener('click', () => { runWorld().catch(fail) })
    const worldExtra = el('textarea', { class: 'lh-world-extra', rows: '2', 'data-lh-field': 'world-extra', placeholder: 'Extra instructions for one report: "a storm is coming", "the war reaches the coast"\u2026' })
    const worldExtraButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet' })
    worldExtraButton.textContent = 'Write with these instructions'
    worldExtraButton.addEventListener('click', () => { runWorld(worldExtra.value).catch(fail) })
    const worldResetButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet' })
    worldResetButton.textContent = 'Reset the timeline'
    worldResetButton.title = 'Forget when the last report was. The next one starts from the current in-world time; the reports stay.'
    worldResetButton.addEventListener('click', () => { resetWorld().catch(fail) })
    const worldButtons = el('div', { class: 'lh-world-buttons' })
    worldButtons.append(worldRunButton, worldResetButton)
    // Consolidate now and the next report's time (72b): Multihog's two under the fold's dials.
    const worldTools = el('div', { class: 'lh-world-tools', 'data-lh-field': 'world-tools' })
    const consolidateRow = el('div', { class: 'lh-world-tool-row' })
    const consolidateLabel = el('label', { class: 'lh-agent-campaign-label' })
    consolidateLabel.textContent = 'Consolidate the oldest'
    const consolidateCount = el('input', { type: 'number', min: '2', max: '50', step: '1', class: 'lh-input lh-world-tool-count', 'data-lh-field': 'world-consolidate-count', 'aria-label': 'Reports to consolidate' }) as HTMLInputElement
    consolidateCount.value = '7'
    const consolidateButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'world-consolidate' }) as HTMLButtonElement
    consolidateButton.textContent = 'reports now'
    consolidateButton.title = 'Fold the oldest N raw reports into one digest, by one model call, whatever the consolidation interval says.'
    consolidateButton.addEventListener('click', () => { consolidateWorld().catch(fail) })
    consolidateRow.append(consolidateLabel, consolidateCount, consolidateButton)
    const overrideRow = el('div', { class: 'lh-world-tool-row' })
    const overrideLabel = el('label', { class: 'lh-agent-campaign-label' })
    overrideLabel.textContent = 'Next report at'
    const overrideInput = el('input', { type: 'text', class: 'lh-input', 'data-lh-field': 'world-override-next', placeholder: 'Day 6, 08:00 AM', 'aria-label': 'The next report’s in-world time' }) as HTMLInputElement
    const overrideButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'world-override' }) as HTMLButtonElement
    overrideButton.textContent = 'Set'
    overrideButton.title = 'The in-world time the next report is due: “Day 6, 08:00 AM”, “Day 6, 08:00” or “Day 6”. The last report is taken as one interval before it.'
    overrideButton.addEventListener('click', () => { overrideWorldNext().catch(fail) })
    overrideRow.append(overrideLabel, overrideInput, overrideButton)
    const worldToolsNote = el('div', { class: 'lh-world-note', 'data-lh-field': 'world-tools-note' })
    worldTools.append(consolidateRow, overrideRow, worldToolsNote)

    // The skeleton (33b): Multihog's World Skeleton & Atmosphere card since 82 (the maintainer's ask of
    // 2026-10-28), one card where the mirrored dials of 63c and the fold of 78b were two: the card's icon,
    // title and lead are the dials card's, its body the fold's, and the dials card is gone. It stands
    // first among the World progression category's cards, where the dials card stood.
    const skeletonView = el('details', { class: 'lh-card lh-dial-card lh-skeleton', 'data-lh-card': 'skeleton' })
    const skeletonSummary = el('summary')
    const skeletonIcon = el('span', { class: 'lh-card-icon', 'aria-hidden': 'true' })
    skeletonIcon.textContent = '💀'
    const skeletonTitle = el('span', { class: 'lh-card-title' })
    skeletonTitle.textContent = 'World Skeleton & Atmosphere'
    // The count of premises filed, beside the title where the fold's summary carried it.
    const skeletonCountBadge = el('span', { class: 'lh-skeleton-count-badge', 'data-lh-field': 'world-skeleton-count' })
    skeletonSummary.append(skeletonIcon, skeletonTitle, skeletonCountBadge, el('span', { class: 'lh-chevron', 'aria-hidden': 'true' }))
    // One search item (63): a word anywhere in the body shows and opens the card, as the dial cards' rows do.
    const skeletonBody = el('div', { class: 'lh-world-body lh-skeleton-body lh-search-item' })
    const skeletonLead = el('div', { class: 'lh-world-lead' })
    skeletonLead.textContent =
        'The World Skeleton is a hidden set of Day 0 macro premises. Location seeds become simulation subjects; factions, institutions and conflicts provide regional context. '
        + 'Named individuals belong in ordinary NPC lore once established through play, never in the skeleton. '
        + 'Written once from your description of the world below: its locations are subjects for reports until the agent records real lore for the same place; its factions and conflicts are the wider-world context. Nothing here reaches the narrator directly.'
    const skeletonSource = el('textarea', { class: 'lh-world-extra lh-skeleton-source', rows: '5', 'data-lh-field': 'world-skeleton-source', placeholder: 'The world, in your words: its atmosphere, cultures, history, powers, places, tensions, technology… A sentence or a page. Or have it written from this chat, below.' })
    // Or from the chat (33c): a model generalises the recent messages into a
    // paragraph with no names in it, for pointing at an old chat to seed a new one.
    const skeletonSourceRow = el('div', { class: 'lh-skeleton-source-row' })
    const skeletonSourceButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet' })
    skeletonSourceButton.textContent = 'Write it from this chat'
    skeletonSourceButton.title = 'A model reads the recent messages and writes one paragraph about the world — its texture, powers and tensions — naming nobody and no event. It replaces the text above.'
    skeletonSourceButton.addEventListener('click', () => { writeSourceFromChat().catch(fail) })
    const skeletonSourceLookbackLabel = el('label', { class: 'lh-skeleton-count', 'data-lh-field': 'world-skeleton-source-lookback' })
    const skeletonSourceLookbackText = el('span')
    skeletonSourceLookbackText.textContent = 'reading the last'
    const skeletonSourceLookback = el('input', { type: 'number', min: '1', max: '200', step: '1', class: 'lh-input' })
    skeletonSourceLookback.addEventListener('change', () => { saveWorldPref({ worldSkeletonSourceLookback: Math.floor(Number(skeletonSourceLookback.value)) }).catch(fail) })
    const skeletonSourceLookbackTail = el('span')
    skeletonSourceLookbackTail.textContent = 'messages'
    skeletonSourceLookbackLabel.append(skeletonSourceLookbackText, skeletonSourceLookback, skeletonSourceLookbackTail)
    skeletonSourceRow.append(skeletonSourceButton, skeletonSourceLookbackLabel)
    const skeletonCount = (field: string, label: string, key: 'worldSkeletonFactions' | 'worldSkeletonLocations' | 'worldSkeletonConflicts') => {
        const row = el('label', { class: 'lh-skeleton-count', 'data-lh-field': field })
        const name = el('span')
        name.textContent = label
        const input = el('input', { type: 'number', min: '0', max: '20', step: '1', class: 'lh-input' })
        input.addEventListener('change', () => { saveWorldPref({ [key]: Math.floor(Number(input.value)) }).catch(fail) })
        row.append(name, input)
        return { row, input }
    }
    const skeletonFactions = skeletonCount('world-skeleton-factions', 'Factions', 'worldSkeletonFactions')
    const skeletonLocations = skeletonCount('world-skeleton-locations', 'Locations', 'worldSkeletonLocations')
    const skeletonConflicts = skeletonCount('world-skeleton-conflicts', 'Conflicts', 'worldSkeletonConflicts')
    const skeletonCounts = el('div', { class: 'lh-skeleton-counts' })
    skeletonCounts.append(skeletonFactions.row, skeletonLocations.row, skeletonConflicts.row)
    const skeletonCheck = (field: string, label: string, title: string, key: 'worldSkeletonUseLorebooks' | 'worldSkeletonLorebookOnly' | 'worldSkeletonUseExisting') => {
        const row = el('label', { class: 'lh-world-switch', 'data-lh-field': field, title })
        const input = el('input', { type: 'checkbox' })
        const text = el('span')
        text.textContent = label
        row.append(input, text)
        input.addEventListener('change', () => { saveWorldPref({ [key]: input.checked }).catch(fail) })
        return { row, input }
    }
    const skeletonLorebooks = skeletonCheck('world-skeleton-lorebooks', 'Read existing lorebooks as canon', 'The books are shown to the model as established fact to build on. With none ticked below, this campaign’s own books are read.', 'worldSkeletonUseLorebooks')
    // The picker (33c): every lorebook on the install but World Progression's
    // own, ticked when named in the filter; the filter stays the comma list
    // 33b stored, so nothing already saved changes shape.
    const skeletonFilterRow = el('div', { class: 'lh-agent-campaign lh-skeleton-filter', 'data-lh-field': 'world-skeleton-filter' })
    const skeletonFilterLabel = el('div', { class: 'lh-agent-campaign-label' })
    skeletonFilterLabel.textContent = 'Which books'
    const skeletonFilterHint = el('div', { class: 'lh-agent-campaign-hint' })
    const skeletonBookList = el('div', { class: 'lh-skeleton-books' })
    skeletonFilterRow.append(skeletonFilterLabel, skeletonFilterHint, skeletonBookList)
    /** The names ticked, in the order they were ticked. */
    let skeletonFilterNames: string[] = []
    const filterNamesOf = (text: string) => text.split(',').map((n) => n.trim()).filter(Boolean)
    function drawSkeletonBooks(): void {
        skeletonBookList.replaceChildren()
        const busy = !!worldRunning || !!skeletonRunning || !chatId
        if (worldBooks === null) {
            skeletonFilterHint.textContent = chatId ? 'Reading the shelf…' : ''
            return
        }
        if (!worldBooks.length) {
            skeletonFilterHint.textContent = 'There are no lorebooks on this install yet.'
            return
        }
        const ticked = new Set(skeletonFilterNames.map((n) => n.toLowerCase()))
        skeletonFilterHint.textContent = ticked.size ? `${ticked.size} ticked.` : 'None ticked: this campaign’s own books are read.'
        for (const book of worldBooks) {
            const row = el('label', { class: 'lh-world-switch lh-skeleton-book', 'data-lh-book': book.name })
            const box = el('input', { type: 'checkbox' })
            box.checked = ticked.has(book.name.toLowerCase())
            box.disabled = busy
            const text = el('span')
            text.textContent = book.own ? `${book.name} · this campaign’s` : book.name
            row.append(box, text)
            box.addEventListener('change', () => {
                const next = skeletonFilterNames.filter((n) => n.toLowerCase() !== book.name.toLowerCase())
                if (box.checked) next.push(book.name)
                skeletonFilterNames = next
                saveWorldPref({ worldSkeletonLorebookFilter: next.join(', ') }).catch(fail)
            })
            skeletonBookList.append(row)
        }
    }
    const skeletonOnly = skeletonCheck('world-skeleton-only', 'Only what those books state', 'Nothing invented: the counts above are ignored and the model writes only the factions, locations and conflicts the books name.', 'worldSkeletonLorebookOnly')
    const skeletonExisting = skeletonCheck('world-skeleton-existing', 'When adding, show the model what is already filed', 'So it builds on the premises there instead of repeating them.', 'worldSkeletonUseExisting')
    const skeletonPrompt = el('textarea', { class: 'lh-world-extra lh-skeleton-prompt', rows: '3', 'data-lh-field': 'world-skeleton-prompt', placeholder: 'Your own architect prompt, in place of the stock one. {factionCount}, {locationCount} and {conflictCount} are filled in. Empty: the stock prompt.' })
    skeletonPrompt.addEventListener('change', () => { saveWorldPref({ worldSkeletonSystemPrompt: skeletonPrompt.value }).catch(fail) })
    const skeletonStatusLine = el('div', { class: 'lh-world-status lh-skeleton-status' })
    const skeletonLive = el('div', { class: 'lh-world-running lh-skeleton-running', hidden: 'hidden' })
    const skeletonNote = el('div', { class: 'lh-world-note lh-skeleton-note' })
    const skeletonGenerateButton = el('button', { type: 'button', class: 'lh-button' })
    skeletonGenerateButton.textContent = 'Generate the skeleton'
    skeletonGenerateButton.title = 'Write a fresh skeleton from the source above. One that is there already is replaced.'
    skeletonGenerateButton.addEventListener('click', () => { runSkeleton('replace').catch(fail) })
    const skeletonAddButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet' })
    skeletonAddButton.textContent = 'Add to the skeleton'
    skeletonAddButton.title = 'More premises, added to the ones there.'
    skeletonAddButton.addEventListener('click', () => { runSkeleton('append').catch(fail) })
    const skeletonButtons = el('div', { class: 'lh-world-buttons' })
    skeletonButtons.append(skeletonGenerateButton, skeletonAddButton)
    skeletonBody.append(skeletonLead, skeletonSource, skeletonSourceRow, skeletonCounts, skeletonLorebooks.row, skeletonFilterRow, skeletonOnly.row, skeletonExisting.row, skeletonPrompt, skeletonStatusLine, skeletonLive, skeletonNote, skeletonButtons)
    skeletonView.append(skeletonSummary, skeletonBody)

    const worldPurgeButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-world-purge' })
    worldPurgeButton.textContent = 'Purge history'
    worldPurgeButton.title = 'Delete every report and every skeleton entry for this campaign and forget the clock. The books stay, empty. This cannot be undone.'
    worldPurgeButton.addEventListener('click', () => { purgeWorld().catch(fail) })
    const worldPurgeNote = el('div', { class: 'lh-world-note lh-world-purge-note' })

    // Multihog's drawer (78a): the clocks, the interval, the locations, the buttons; the two mirrored dials under
    // More settings; the skeleton (33b, AdventureTime's) a fold of its own in the settings tab.
    // The two dials Multihog's drawer does not carry are in their settings category alone (78b, the folds gone at the maintainer's answer).
    worldBody.append(worldLead, worldSwitchRow, worldStatusLine, worldReportsLine, worldLive, worldNote, worldInterval.row, worldLocations.row, worldButtons, worldExtra, worldExtraButton, worldTools, worldPurgeButton, worldPurgeNote)
    worldView.append(worldSummary, worldBody)

    // The hidden map (row 9, Phase 34): what is mapped, and where the party is.
    const mapView = el('details', { class: 'lh-maps' })
    const mapSummary = el('summary')
    mapSummary.textContent = 'Visuals/Map'
    const mapBody = el('div', { class: 'lh-world-body' })
    const mapLead = el('div', { class: 'lh-world-lead' })
    mapLead.textContent =
        'A site can carry a private map inside its own Location entry, as a [MAP] section. The narrator is told which sites are mapped, '
        + 'and while the party is inside one \u2014 the Location footer under each reply says where they are \u2014 that map is sent as GM canon. '
        + 'The agent never reads a map. The Map Architect draws a site\u2019s map as the party reaches it, and the Map Updater keeps it current with play: who moved, what died, what was taken, which door opened.'
    const mapStatusLine = el('div', { class: 'lh-world-status lh-maps-status' })
    const mapSitesLine = el('div', { class: 'lh-agent-campaign-hint lh-maps-sites' })
    // The map on screen (34d): the party's site as the player may see it, or any site picked.
    const picture = createMapPicture({
        el,
        load: (siteRoot) => bridge.request<MapViewResult>('map.view', { chatId, ...(siteRoot ? { siteRoot } : {}) }),
        setRevealAll: (on) => saveMapPref({ mapRevealAll: on }),
        // The raw JSON editor (71a).
        raw: {
            get: (siteRoot) => bridge.request<MapRawResult>('map.raw.get', { chatId, siteRoot }),
            set: (siteRoot, json) => bridge.request<MapRawSaveResult>('map.raw.set', { chatId, siteRoot, json }),
        },
        fail: (error) => fail(error),
    })
    const mapNote = el('div', { class: 'lh-world-note lh-maps-note' })
    const mapRefreshButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet' })
    mapRefreshButton.textContent = 'Re-read the maps'
    mapRefreshButton.title = 'Read the Location entries and the last reply again now, instead of after the next reply.'
    mapRefreshButton.addEventListener('click', () => { loadMaps().catch(fail) })
    // The architect (34a): the tool's standing, a run in flight, the last run, and its two settings.
    const architectLine = el('div', { class: 'lh-world-status lh-maps-architect' })
    const architectLive = el('div', { class: 'lh-world-running lh-maps-architect-running', hidden: 'hidden' })
    const architectNote = el('div', { class: 'lh-world-note lh-maps-architect-note' })
    // The opener (46): the tool call, or the block in the prose for a connection that cannot call tools.
    const architectOpenerRow = el('div', { class: 'lh-agent-campaign', 'data-lh-field': 'map-architect-opener' })
    const architectOpenerLabel = el('label', { class: 'lh-agent-campaign-label' })
    architectOpenerLabel.textContent = 'How the narrator asks for a map'
    const architectOpener = el('select', { class: 'lh-input' }) as HTMLSelectElement
    for (const [value, text] of [['tool', 'The CreateAreaMap tool call'], ['text', 'A [CREATE_AREA_MAP] block in its reply']] as const) {
        const option = el('option', { value }) as HTMLOptionElement
        option.textContent = text
        architectOpener.append(option)
    }
    const architectOpenerHint = el('div', { class: 'lh-agent-campaign-hint' })
    architectOpenerHint.textContent = 'Tool call: the narrator calls CreateAreaMap mid-reply, which needs Enable Function Calling on its connection. Block: for a connection that cannot call tools, the narrator writes the block at the end of its reply and stops; the block is taken out of the reply, the map is drawn behind it, and the narrator is briefed from the next turn. Multihog\u2019s tool.'
    architectOpener.addEventListener('change', () => { saveMapPref({ mapArchitectOpener: architectOpener.value }).catch(fail) })
    architectOpenerRow.append(architectOpenerLabel, architectOpener, architectOpenerHint)
    const architectLookbackRow = el('div', { class: 'lh-agent-campaign', 'data-lh-field': 'map-architect-lookback' })
    const architectLookbackLabel = el('label', { class: 'lh-agent-campaign-label' })
    architectLookbackLabel.textContent = 'Messages the architect reads'
    const architectLookback = el('input', { type: 'number', min: '0', max: '100', step: '1', class: 'lh-input' })
    const architectLookbackHint = el('div', { class: 'lh-agent-campaign-hint' })
    architectLookbackHint.textContent = 'For context when it draws a site: who is there, what the story has shown. Multihog\u2019s 12.'
    architectLookback.addEventListener('change', () => { saveMapPref({ mapArchitectLookback: Math.floor(Number(architectLookback.value)) }).catch(fail) })
    architectLookbackRow.append(architectLookbackLabel, architectLookback, architectLookbackHint)
    const architectPrompt = el('textarea', { class: 'lh-world-extra lh-skeleton-prompt', rows: '3', 'data-lh-field': 'map-architect-prompt', placeholder: 'Your own content-placement prompt, in place of the stock one. The topology prompt is fixed. Empty: the stock prompt.' })
    architectPrompt.addEventListener('change', () => { saveMapPref({ mapArchitectSystemPrompt: architectPrompt.value }).catch(fail) })
    // The updater (34b): its switch, a pass in flight, the last pass, its three settings, and a pass now with an instruction.
    const updaterLine = el('div', { class: 'lh-world-status lh-maps-updater' })
    const updaterSwitchRow = el('label', { class: 'lh-world-switch', 'data-lh-field': 'map-updater-enabled' })
    const updaterSwitch = el('input', { type: 'checkbox' })
    const updaterSwitchText = el('span')
    updaterSwitchText.textContent = 'Update the map with play'
    updaterSwitchRow.append(updaterSwitch, updaterSwitchText)
    updaterSwitch.addEventListener('change', () => { saveMapPref({ mapUpdaterEnabled: updaterSwitch.checked }).catch(fail) })
    const updaterLive = el('div', { class: 'lh-world-running lh-maps-updater-running', hidden: 'hidden' })
    const updaterNote = el('div', { class: 'lh-world-note lh-maps-updater-note' })
    const mapNumber = (field: string, label: string, hint: string, min: number, max: number, key: 'mapUpdaterRunEvery' | 'mapUpdaterLookback') => {
        const row = el('div', { class: 'lh-agent-campaign', 'data-lh-field': field })
        const name = el('label', { class: 'lh-agent-campaign-label' })
        name.textContent = label
        const input = el('input', { type: 'number', min: String(min), max: String(max), step: '1', class: 'lh-input' })
        const note = el('div', { class: 'lh-agent-campaign-hint' })
        note.textContent = hint
        input.addEventListener('change', () => { saveMapPref({ [key]: Math.floor(Number(input.value)) }).catch(fail) })
        row.append(name, input, note)
        return { row, input }
    }
    const updaterEvery = mapNumber('map-updater-run-every', 'Replies between updates', 'Multihog\u2019s 1: after every reply inside a mapped site. A building the party has just entered is furnished at once whatever this says.', 1, 50, 'mapUpdaterRunEvery')
    const updaterLookback = mapNumber('map-updater-lookback', 'User turns the updater reads', 'When there is no last update to read from, and for an update pressed here. After one, it reads what came since.', 1, 100, 'mapUpdaterLookback')
    const updaterPrompt = el('textarea', { class: 'lh-world-extra lh-skeleton-prompt', rows: '3', 'data-lh-field': 'map-updater-prompt', placeholder: 'Your own occupancy prompt, in place of the stock one. Empty: the stock prompt.' })
    updaterPrompt.addEventListener('change', () => { saveMapPref({ mapUpdaterSystemPrompt: updaterPrompt.value }).catch(fail) })
    const updaterInstruction = el('textarea', { class: 'lh-world-extra lh-maps-updater-instruction', rows: '3', 'data-lh-field': 'map-updater-instruction', placeholder: 'An instruction for one update, in place of the routine pass: \u201cmark the ghoul pack dead\u201d, \u201copen the vault door\u201d. Empty: the routine pass, on the site the party is in.' })
    const updaterButtons = el('div', { class: 'lh-world-buttons' })
    const updaterRunButton = el('button', { type: 'button', class: 'lh-button' })
    updaterRunButton.textContent = 'Update the map now'
    updaterRunButton.title = 'Run the Map Updater on the site the party is in, without waiting for a reply. With an instruction above, it does what the instruction says and nothing else.'
    updaterRunButton.addEventListener('click', () => { updateMapNow().catch(fail) })
    updaterButtons.append(updaterRunButton)
    // Evolution (34c): sites change while the party is away.
    const evoView = el('details', { class: 'lh-evolution lh-agent-drawer', 'data-lh-field': 'agent-evolution' })
    const evoSummary = el('summary')
    const evoTitle = el('span', { class: 'lh-agent-drawer-title' })
    evoTitle.textContent = '🗺️ Map Evolution'
    const evoBadge = el('span', { class: 'lh-agent-badge', 'data-lh-field': 'evolution-badge', role: 'button', tabindex: '0', title: 'Click to toggle Map Evolution' })
    evoBadge.textContent = 'OFF'
    evoSummary.append(evoTitle, evoBadge)
    const evoBody = el('div', { class: 'lh-world-body' })
    const evoLead = el('div', { class: 'lh-world-lead' })
    evoLead.textContent =
        'On an in-world interval, each mapped site the party is not in moves on its own: patrols shift, scavengers arrive, a rival band takes a vacated room, a project leaves a trace. '
        + 'World Progression\u2019s reports are the pressure; the updater\u2019s record of what play changed is the trajectory. The site the party is in moves too, more often and more carefully, with their own area frozen. '
        + 'Leaving a site runs one pass over it. The narrator is told each site\u2019s recent off-screen life with its map.'
    const evoLine = el('div', { class: 'lh-world-status lh-maps-evolution' })
    const evoSwitchRow = el('label', { class: 'lh-world-switch', 'data-lh-field': 'map-evolution-enabled' })
    const evoSwitch = el('input', { type: 'checkbox' })
    const evoSwitchText = el('span')
    evoSwitchText.textContent = 'Let sites change while the party is away'
    evoSwitchRow.append(evoSwitch, evoSwitchText)
    evoSwitch.addEventListener('change', () => { saveMapPref({ mapEvolutionEnabled: evoSwitch.checked }).catch(fail) })
    const evoLive = el('div', { class: 'lh-world-running lh-maps-evolution-running', hidden: 'hidden' })
    const evoNote = el('div', { class: 'lh-world-note lh-maps-evolution-note' })
    type EvoNumberKey = 'mapEvolutionIntervalHours' | 'mapEvolutionOnSiteIntervalHours' | 'mapEvolutionOnSiteIntervalMinutes' | 'mapEvolutionCount' | 'mapEvolutionWorldReportLookback' | 'mapEvolutionCompressThreshold' | 'mapEvolutionNarratorCommitTokens' | 'mapEvolutionLookback'
    const evoNumber = (field: string, label: string, hint: string, min: number, max: number, key: EvoNumberKey) => {
        const row = el('div', { class: 'lh-agent-campaign', 'data-lh-field': field })
        const name = el('label', { class: 'lh-agent-campaign-label' })
        name.textContent = label
        const input = el('input', { type: 'number', min: String(min), max: String(max), step: '1', class: 'lh-input' })
        const note = el('div', { class: 'lh-agent-campaign-hint' })
        note.textContent = hint
        input.addEventListener('change', () => { saveMapPref({ [key]: Math.floor(Number(input.value)) }).catch(fail) })
        row.append(name, input, note)
        return { row, input }
    }
    const evoSelect = (field: string, label: string, hint: string, choices: Array<[string, string]>, key: 'mapEvolutionOnSitePreset' | 'mapEvolutionScope') => {
        const row = el('div', { class: 'lh-agent-campaign', 'data-lh-field': field })
        const name = el('label', { class: 'lh-agent-campaign-label' })
        name.textContent = label
        const select = el('select', { class: 'lh-input' }) as HTMLSelectElement
        for (const [value, text] of choices) {
            const option = el('option', { value }) as HTMLOptionElement
            option.textContent = text
            select.append(option)
        }
        const note = el('div', { class: 'lh-agent-campaign-hint' })
        note.textContent = hint
        select.addEventListener('change', () => { saveMapPref({ [key]: select.value }).catch(fail) })
        row.append(name, select, note)
        return { row, select }
    }
    const evoCheck = (field: string, label: string, key: 'mapEvolutionRandomize' | 'mapEvolutionCompressEnabled') => {
        const row = el('label', { class: 'lh-world-switch', 'data-lh-field': field })
        const input = el('input', { type: 'checkbox' })
        const text = el('span')
        text.textContent = label
        row.append(input, text)
        input.addEventListener('change', () => { saveMapPref({ [key]: input.checked }).catch(fail) })
        return { row, input }
    }
    const evoInterval = evoNumber('map-evolution-interval', 'In-world hours between passes, away', 'For a site the party is not in. Multihog\u2019s 12. The clock is the tracker\u2019s [TIME] block.', 1, 168, 'mapEvolutionIntervalHours')
    const evoOnSiteHours = evoNumber('map-evolution-on-site-hours', 'Hours between passes, on site', 'For the site the party is in, with the minutes below. Multihog\u2019s 1. Both 0: never while they are there.', 0, 168, 'mapEvolutionOnSiteIntervalHours')
    const evoOnSiteMinutes = evoNumber('map-evolution-on-site-minutes', 'Minutes between passes, on site', 'Added to the hours above.', 0, 59, 'mapEvolutionOnSiteIntervalMinutes')
    const evoPreset = evoSelect('map-evolution-preset', 'On the party\u2019s site', 'Dynamic: bolder, encounter-rich change just beyond their area. Standard: the same restraint as elsewhere.', [['dynamic', 'Dynamic'], ['standard', 'Standard']], 'mapEvolutionOnSitePreset')
    const evoScope = evoSelect('map-evolution-scope', 'Which sites a pass considers', 'All: every mapped site that is due. The party\u2019s: only the one they are in. Some: the number below, picked from the due ones. Named: the list below.', [['all', 'All'], ['active', 'The party\u2019s'], ['count', 'Some'], ['selected', 'Named']], 'mapEvolutionScope')
    const evoCount = evoNumber('map-evolution-count', 'How many, when some', '0 for every due site.', 0, 50, 'mapEvolutionCount')
    const evoRandomize = evoCheck('map-evolution-randomize', 'Pick them at random', 'mapEvolutionRandomize')
    const evoSelectedRow = el('div', { class: 'lh-agent-campaign', 'data-lh-field': 'map-evolution-selected' })
    const evoSelectedLabel = el('label', { class: 'lh-agent-campaign-label' })
    evoSelectedLabel.textContent = 'Named sites and their hours'
    // The mapped sites as a list to tick (45c-ter), not a box to spell them
    // into: a name typed wrong named nothing, silently. The preference is
    // still the comma list, so a cartridge or an older build reads it.
    const evoSelected = el('div', { class: 'lh-maps-evolution-sites' })
    const evoSelectedHint = el('div', { class: 'lh-agent-campaign-hint' })
    let evoSelectedRoots: string[] = []
    let evoSelectedBusy = false
    /** The legacy's cadence words: `8h`, `1h 30m`, `skip`. */
    const cadence = (hours: number): string => {
        const total = Math.max(0, Math.round(Number(hours) * 60))
        if (!total) return 'skip'
        const whole = Math.floor(total / 60)
        const minutes = total % 60
        return [whole ? `${whole}h` : '', minutes ? `${minutes}m` : ''].filter(Boolean).join(' ')
    }
    function drawEvoSelected(sites: ReadonlyArray<{ siteRoot: string }>, intervals: ReadonlyArray<{ siteRoot: string; current: boolean; automaticHours: number; overrideHours: number | null }> = []): void {
        evoSelected.replaceChildren()
        const chosen = new Set(evoSelectedRoots.map((r) => r.toLowerCase()))
        const names = [...sites.map((s) => s.siteRoot)]
        // A chosen site no longer mapped stays listed, so unticking it is possible.
        for (const root of evoSelectedRoots) if (!names.some((n) => n.toLowerCase() === root.toLowerCase())) names.push(root)
        for (const name of names) {
            const row = el('div', { class: 'lh-maps-evolution-site' })
            const label = el('label', { class: 'lh-world-switch' })
            const box = el('input', { type: 'checkbox', value: name }) as HTMLInputElement
            box.checked = chosen.has(name.toLowerCase())
            box.disabled = evoSelectedBusy
            const text = el('span')
            const interval = intervals.find((i) => i.siteRoot.toLowerCase() === name.toLowerCase())
            text.textContent = interval?.current ? `${name} (current)` : name
            box.addEventListener('change', () => {
                const next = Array.from(evoSelected.querySelectorAll('input[type="checkbox"]')).filter((b) => (b as HTMLInputElement).checked).map((b) => (b as HTMLInputElement).value)
                evoSelectedRoots = next
                saveMapPref({ mapEvolutionSelectedRoots: next.join(', ') }).catch(fail)
            })
            label.append(box, text)
            row.append(label)
            // The site's own hours (71d, the legacy's per-site override): blank inherits the dials, 0 never.
            if (interval) {
                const hasOverride = interval.overrideHours !== null
                const hours = el('input', { type: 'number', class: 'lh-input lh-input--short', min: '0', max: '168', placeholder: '\u2014', 'data-lh-field': `map-evolution-hours:${name}` }) as HTMLInputElement
                hours.value = hasOverride ? String(interval.overrideHours) : ''
                hours.disabled = evoSelectedBusy
                hours.title = hasOverride
                    ? 'Custom automatic interval for this map. Clear the box to inherit Other maps / Current map again. 0 skips automatic ticks.'
                    : 'Leave blank to inherit Other maps / Current map. Fill only to override this map\u2019s automatic timer. 0 skips automatic ticks. Independent of the Named tick.'
                const inherit = el('span', { class: 'lh-maps-evolution-inherit' })
                inherit.classList.toggle('lh-maps-evolution-inherit--over', hasOverride)
                const where = interval.current ? 'current map' : 'other maps'
                inherit.textContent = hasOverride ? `Override \u00b7 was ${cadence(interval.automaticHours)}` : interval.automaticHours === 0 ? `Automatic: skip (${where})` : `Automatic: ${cadence(interval.automaticHours)} (${where})`
                hours.addEventListener('change', () => {
                    const raw = hours.value.trim()
                    const value = raw === '' ? null : Math.max(0, Math.min(168, Math.floor(Number(raw))))
                    if (value !== null && !Number.isFinite(value)) { hours.value = ''; return }
                    bridge.request<MapEvolutionIntervalResult>('map.evolution.interval', { chatId, siteRoot: name, hours: value })
                        .then(() => loadMaps())
                        .catch(fail)
                })
                row.append(hours)
                // Back to automatic without emptying the box by hand (71d-bis, the maintainer's ask): the arrows stop at 0.
                if (hasOverride) {
                    const auto = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-maps-evolution-auto', title: 'Back to automatic: this site inherits the dials again.', 'data-lh-field': `map-evolution-auto:${name}` }) as HTMLButtonElement
                    auto.textContent = '\u00d7'
                    auto.disabled = evoSelectedBusy
                    auto.addEventListener('click', () => {
                        bridge.request<MapEvolutionIntervalResult>('map.evolution.interval', { chatId, siteRoot: name, hours: null })
                            .then(() => loadMaps())
                            .catch(fail)
                    })
                    row.append(auto)
                }
                row.append(inherit)
            }
            evoSelected.append(row)
        }
        evoSelectedHint.textContent = names.length ? 'Tick the sites a Named pass considers. The box is a site\u2019s own hours between passes: blank inherits the dials, 0 never; \u00d7 puts a site back to automatic.' : 'No site is mapped yet; the list fills as the architect draws them.'
    }
    evoSelectedRow.append(evoSelectedLabel, evoSelected, evoSelectedHint)
    const evoReports = evoNumber('map-evolution-report-lookback', 'World reports a site may feel', 'The most recent ones, plus any aimed at the site. Multihog\u2019s 5.', 1, 20, 'mapEvolutionWorldReportLookback')
    // The story lookback and the connection (45c, upstream 2026.8.68 to .71).
    const evoStory = evoNumber('map-evolution-story-lookback', 'User turns of recent story a pass reads', 'Every due site is shown the same window and told to apply only what touches its own map: someone who left, joined the party elsewhere, died off-map. 0 sends none. Multihog\u2019s 20.', 0, 100, 'mapEvolutionLookback')
    const evoConnectionRow = el('div', { class: 'lh-agent-campaign', 'data-lh-field': 'map-evolution-connection' })
    const evoConnectionLabel = el('label', { class: 'lh-agent-campaign-label' })
    evoConnectionLabel.textContent = 'Connection'
    const evoConnection = el('select', { class: 'lh-input' }) as HTMLSelectElement
    const evoConnectionHint = el('div', { class: 'lh-agent-campaign-hint' })
    let evoConnectionId = ''
    evoConnection.addEventListener('change', () => { evoConnectionId = evoConnection.value; saveMapPref({ mapEvolutionConnectionId: evoConnection.value }).catch(fail) })
    evoConnectionRow.append(evoConnectionLabel, evoConnection, evoConnectionHint)
    /** The connection picker from whatever the host listed, the chosen one kept and shown as missing when it is not (as the tracker\u2019s and the agent\u2019s). */
    function drawEvoConnection(): void {
        evoConnection.replaceChildren()
        const fallback = el('option', { value: '' }) as HTMLOptionElement
        fallback.textContent = 'The agent\u2019s connection'
        evoConnection.append(fallback)
        for (const choice of connectionChoices) {
            const option = el('option', { value: choice.id }) as HTMLOptionElement
            option.textContent = choice.model ? `${choice.name} \u2014 ${choice.model}` : choice.name
            evoConnection.append(option)
        }
        const known = connectionChoices.some((choice) => choice.id === evoConnectionId)
        if (evoConnectionId && !known) {
            const missing = el('option', { value: evoConnectionId }) as HTMLOptionElement
            missing.textContent = 'The connection you chose is no longer listed'
            evoConnection.append(missing)
        }
        evoConnection.value = evoConnectionId
        evoConnectionHint.textContent = connectionsUnavailable
            ? connectionsUnavailable
            : connectionChoices.length === 0
              ? 'No connection profiles found, so the passes run on the agent\u2019s connection.'
              : 'A fast model suits it: a pass can take several sites in one turn, and a slow model makes that a long wait. Blank runs on the agent\u2019s. Multihog recommends the fastest you have.'
        evoConnection.disabled = !!connectionsUnavailable
    }
    const evoPrompt = el('textarea', { class: 'lh-world-extra lh-skeleton-prompt', rows: '3', 'data-lh-field': 'map-evolution-prompt', placeholder: 'Your own evolution prompt, in place of the stock one. Empty: the stock prompt.' })
    evoPrompt.addEventListener('change', () => { saveMapPref({ mapEvolutionSystemPrompt: evoPrompt.value }).catch(fail) })
    const evoCompress = evoCheck('map-evolution-compress', 'Compress a site\u2019s closed history when it grows long', 'mapEvolutionCompressEnabled')
    const evoThreshold = evoNumber('map-evolution-compress-threshold', 'Compress past this many tokens', 'Of closed threads. One more model call, into a few digests. Multihog\u2019s 10,000.', 500, 100000, 'mapEvolutionCompressThreshold')
    const evoTokens = evoNumber('map-evolution-narrator-tokens', 'Tokens of site activity for the narrator', 'The briefing sent with a site\u2019s map: open threads, recent commits, digests. Multihog\u2019s 2,000.', 200, 20000, 'mapEvolutionNarratorCommitTokens')
    const evoInstruction = el('textarea', { class: 'lh-world-extra lh-maps-evolution-instruction', rows: '3', 'data-lh-field': 'map-evolution-instruction', placeholder: 'An instruction for one pass, in place of the routine restlessness: \u201cthe cult moves into the chapel\u201d. Empty: the routine pass, on the sites the scope above names.' })
    const evoButtons = el('div', { class: 'lh-world-buttons' })
    const evoRunButton = el('button', { type: 'button', class: 'lh-button' })
    evoRunButton.textContent = 'Evolve now'
    evoRunButton.title = 'Run Map Evolution now on the sites the scope above names \u2014 the party\u2019s, the named ones, all, or some \u2014 without waiting for their clocks. With an instruction above, it does what the instruction says and nothing else.'
    evoRunButton.addEventListener('click', () => { evolveNow().catch(fail) })
    // Multihog's Reset Timeline (78a): every site's last-evolved clock forgotten.
    const evoResetButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'map-evolution-reset' })
    evoResetButton.textContent = 'Reset timeline'
    evoResetButton.title = 'Forget every site’s last-evolved clock, so the next interval starts from the current in-world time. The maps and their histories stay.'
    evoResetButton.addEventListener('click', () => { resetEvolutionTimeline().catch(fail) })
    evoButtons.append(evoRunButton, evoResetButton)
    evoBadge.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (evoSwitch.disabled) return
        evoSwitch.checked = !evoSwitch.checked
        evoSwitch.dispatchEvent(new Event('change'))
    })
    // The Testing Ground (71d): Multihog's flask as the last sub-fold of Evolution.
    const sandboxFold = createSandboxFold({
        el,
        get: (siteRoot, arcSubject) => bridge.request<MapSandboxResult>('map.sandbox.get', { chatId, ...(siteRoot ? { siteRoot } : {}), ...(arcSubject ? { arcSubject } : {}) }),
        time: (request) => bridge.request<MapSandboxOutcome>('map.sandbox.time', { chatId, ...request }),
        add: (request) => bridge.request<MapSandboxOutcome>('map.sandbox.asset.add', { chatId, ...request }),
        set: (request) => bridge.request<MapSandboxOutcome>('map.sandbox.asset.set', { chatId, ...request }),
        evolve: (siteRoot) => bridge.request<MapSandboxOutcome>('map.sandbox.evolve', { chatId, siteRoot }),
        simulate: (request) => bridge.request<MapSandboxOutcome>('map.sandbox.simulate', { chatId, ...request }),
        undo: () => bridge.request<MapSandboxOutcome>('map.sandbox.undo', { chatId }),
        redo: () => bridge.request<MapSandboxOutcome>('map.sandbox.redo', { chatId }),
        clear: (siteRoot) => bridge.request<MapSandboxOutcome>('map.sandbox.clear', { chatId, siteRoot }),
        ...(host.ui ? { confirm: async (message: string) => (await host.ui!.showConfirm({ title: 'Clear evolution history?', message, variant: 'warning', confirmLabel: 'Clear' })).confirmed } : {}),
        fail: (error) => fail(error),
        onChanged: () => { loadMaps().catch(() => undefined) },
    })
    // Multihog's drawer (78a): the words, the switch, the two intervals, the scope with its count, randomize and
    // the named sites, Evolve now, Reset timeline, the Testing ground; every other dial under More settings.
    // The rest of Evolution's dials are in their settings category alone (78b); the instruction box is the terminal's Map Evolution bar.
    evoBody.append(evoLead, evoLine, evoLive, evoNote, evoSwitchRow, evoInterval.row, evoOnSiteHours.row, evoOnSiteMinutes.row, evoScope.row, evoCount.row, evoRandomize.row, evoSelectedRow, evoButtons, sandboxFold.root)
    evoView.append(evoSummary, evoBody)
    /**
     * The Visuals/Map tab (78a): the scene's hero, then the site map under its own header — 💬 folds the
     * updater's instruction box and its button under it, Map Details opens the picture's folds in the
     * host's modal — then Present now; the maps' words under *What the maps are doing* and the architect's
     * and the updater's dials under *More settings*, both folded at the foot. Assembled where the folds
     * are placed, once the scene fold exists.
     */
    const siteMapHead = el('div', { class: 'lh-site-map-head' })
    const siteMapTitle = el('span', { class: 'lh-site-map-title' })
    siteMapTitle.textContent = 'Site map'
    const siteMapDirectToggle = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'site-map-direct-toggle', title: 'Show or hide the Map Updater’s direct prompt', 'aria-expanded': 'false' })
    siteMapDirectToggle.textContent = '💬'
    const siteMapDetails = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'site-map-details', title: 'The map’s details in a window: the entries, the evolution history, the raw JSON' })
    siteMapDetails.textContent = 'Map Details'
    siteMapHead.append(siteMapTitle, siteMapDirectToggle, siteMapDetails)
    const siteMapDirect = el('div', { class: 'lh-site-map-direct', 'data-lh-field': 'site-map-direct', hidden: 'hidden' })
    siteMapDirect.append(updaterInstruction, updaterButtons)
    siteMapDirectToggle.addEventListener('click', () => {
        siteMapDirect.hidden = !siteMapDirect.hidden
        siteMapDirectToggle.setAttribute('aria-expanded', siteMapDirect.hidden ? 'false' : 'true')
    })
    // With a host modal the folds live in it and are hidden in the tab; without one they stay in the tab as before.
    const detailsInModal = !!host.ui?.showModal
    picture.details.hidden = detailsInModal
    siteMapDetails.hidden = !detailsInModal
    // What the maps are doing (78b): the words and the notes of the party's place, the sites, the architect and the
    // updater open with Map Details, at its head — the fold under the graph is gone at the maintainer's answer, and
    // the lines kept, since they name why a map did not move. A host without a modal keeps them in the tab.
    const mapsStatusBlock = el('div', { class: 'lh-maps-status-block', 'data-lh-field': 'maps-status' })
    mapsStatusBlock.append(mapLead, mapStatusLine, mapSitesLine, mapNote, mapRefreshButton, architectLine, architectLive, architectNote, updaterLine, updaterLive, updaterNote)
    mapsStatusBlock.hidden = detailsInModal
    siteMapDetails.addEventListener('click', () => {
        if (detailsModal?.open) { detailsModal.close(); return }
        const s = mapStatus && !mapStatus.unavailable ? mapStatus : null
        const site = picture.chosenSite() || s?.activeSiteRoot || ''
        picture.details.hidden = false
        mapsStatusBlock.hidden = false
        const entries = picture.details.querySelector<HTMLDetailsElement>('.lh-map-entries')
        if (entries) entries.open = true
        detailsModal = openDetailsModal(host.ui, {
            title: site ? `Map Details — ${site}` : 'Map Details',
            nodes: [mapsStatusBlock, picture.details],
            onClose: () => { detailsModal = null; picture.details.hidden = true; mapsStatusBlock.hidden = true },
        })
        if (!detailsModal) { picture.details.hidden = true; mapsStatusBlock.hidden = true }
    })
    mapView.append(mapSummary, mapBody)

    /**
     * A picture for each entity the memo currently names.
     *
     * Driven from the view rather than from a list the user maintains: the
     * entities in play change every turn, and asking someone to type
     * "Moth Wraith" exactly as the narrator spelled it is asking them to lose.
     * Since 60 it sits at the foot of the NPC library, the one place for
     * pictures: a library card's photo is set in its editor, and this list
     * is for whoever is in play without a card — an enemy, a stranger.
     */
    const portraitEditor = el('details', { class: 'lh-portraits' })
    const portraitSummary = el('summary')
    portraitSummary.textContent = 'Portraits'
    const portraitList = el('div', { class: 'lh-portrait-list' })
    // The last prompt a draw wrote (61), as the scene fold shows its own.
    const portraitPromptLabel = el('div', { class: 'lh-portrait-prompt-label' })
    portraitPromptLabel.textContent = 'The last prompt'
    const portraitPromptBox = el('div', { class: 'lh-portrait-prompt', 'data-lh-field': 'portrait-prompt' })
    portraitPromptLabel.hidden = true
    portraitPromptBox.hidden = true
    // The auto-generation's settings (61): the legacy's switches, the lookback, the two connections.
    const portraitDraw = createPortraitDrawSettings({
        el,
        savePrefs: async (patch) => { await bridge.request<PrefsResult>('prefs.patch', { patch }) },
        imageConnections: () => bridge.request<SceneConnectionsResult>('scene.connections', {}),
        check: async () => {
            if (!chatId) return
            const asked = chatId
            const status = await bridge.request<PortraitAutoStatus>('portraits.auto.check', { chatId })
            if (destroyed || chatId !== asked) return
            portraitAuto = status
            draw()
        },
        fail: (error) => fail(error),
    })
    portraitEditor.append(portraitSummary, portraitList, portraitPromptLabel, portraitPromptBox, portraitDraw.root)

    /**
     * A colour and a percentage switch for each bar on screen.
     *
     * Same shape as the portrait editor and for the same reason: the bars in
     * play change with the story, so the list is built from the view rather
     * than from something the user maintains.
     */

    const archiveActions = el('div', { class: 'lh-tracker-archive-actions' })
    // The character creator (row 10, Phase 35): the sheet, written from a form, under the cards.
    const creatorFold = createCreatorFold({
        el,
        generate: async (draft, options) => {
            const result = await bridge.request<CreatorResult>('creator.generate', { chatId, draft, ...options })
            playerCardFold.refresh()
            return result
        },
        savePrefs: async (patch) => { await bridge.request<PrefsResult>('prefs.patch', { patch }) },
        fail: (error) => fail(error),
        when: (iso) => when(iso),
        ...(host.ui ? { confirm: async (message: string) => (await host.ui!.showConfirm({ title: 'Replace this preset?', message, variant: 'warning', confirmLabel: 'Replace' })).confirmed } : {}),
    })
    // Instant Action (35a): the same sheet from rolled choices, then the opening message.
    const instantFold = createInstantFold({
        el,
        begin: async (request) => {
            const result = await bridge.request<InstantResult>('creator.instant', { chatId, ...request })
            playerCardFold.refresh()
            return result
        },
        savePrefs: async (patch) => { await bridge.request<PrefsResult>('prefs.patch', { patch }) },
        // Asked before a sheet is written over (73d, departure 57); without the host's dialog, begun as before.
        ...(host.ui ? { confirm: async (title: string, message: string, confirmLabel: string) => (await host.ui!.showConfirm({ title, message, variant: 'warning', confirmLabel })).confirmed } : {}),
        fail: (error) => fail(error),
        when: (iso) => when(iso),
    })
    // The Player Card (35b): the character's biography, kept per chat, under the creator.
    const playerCardFold = createPlayerCardFold({
        el,
        load: () => bridge.request<PlayerCardView>('creator.card.get', { chatId }),
        // The Player Character's card at the top of the Campaign Records (78b) follows every write.
        write: (request) => bridge.request<CardResult>('creator.card.write', { chatId, ...request }).then((r) => { recordsFold.refreshPlayerCard().catch(() => undefined); return r }),
        save: (request) => bridge.request<CardResult>('creator.card.save', { chatId, ...request }).then((r) => { recordsFold.refreshPlayerCard().catch(() => undefined); return r }),
        remove: async () => { await bridge.request<{ ok: boolean }>('creator.card.remove', { chatId }); recordsFold.refreshPlayerCard().catch(() => undefined) },
        persona: (request) => bridge.request<PersonaResult>('creator.card.persona', { chatId, ...request }),
        savePrefs: async (patch) => { await bridge.request<PrefsResult>('prefs.patch', { patch }) },
        // Edit with AI (78c): the persona prompt, the revised card back for review.
        aiEdit: (content, instructions) => bridge.request<CardAiEditResult>('records.aiEdit', { kind: 'pc', content, instructions }),
        fail: (error) => fail(error),
        when: (iso) => when(iso),
        ...(host.ui ? { confirm: async (message: string) => (await host.ui!.showConfirm({ title: 'Player Card', message, variant: 'warning', confirmLabel: 'Go ahead' })).confirmed } : {}),
    })
    // The other ways to begin (35c): from the active persona, or from instructions, under the creator.
    const waysFold = createWaysFold({
        el,
        begin: async (request) => {
            const result = await bridge.request<WaysResult>('creator.ways', { chatId, ...request })
            playerCardFold.refresh()
            return result
        },
        savePrefs: async (patch) => { await bridge.request<PrefsResult>('prefs.patch', { patch }) },
        // The time & date segment's two cartridge keys (72b); the settings.changed event re-seeds every editor after.
        commitSettings: async (patch) => { await bridge.request<{ settings: SettingsBag }>('settings.patch', { patch }) },
        fail: (error) => fail(error),
        when: (iso) => when(iso),
    })
    waysFold.applySettings(settings as Record<string, unknown>)
    // Import a character card (39): the host's cards, one imported as the player, under the other ways.
    const importFold = createImportFold({
        el,
        list: () => bridge.request<{ cards: CardChoice[] }>('creator.cards'),
        importCard: async (request) => {
            const narrator = host.getActiveChat().characterId
            const result = await bridge.request<ImportResult>('creator.import', { chatId, ...request, ...(narrator ? { narratorCharacterId: narrator } : {}) })
            playerCardFold.refresh()
            return result
        },
        savePrefs: async (patch) => { await bridge.request<PrefsResult>('prefs.patch', { patch }) },
        fail: (error) => fail(error),
        when: (iso) => when(iso),
    })
    /**
     * The starting area (69, the maintainer's ask): the four ways in under one
     * fold, in Multihog's order — the creator, Instant Action, the other ways,
     * the card import — headed *Starting the Adventure*, open when the chat
     * has no memo and folded when an adventure is under way. The rule is
     * read when the chat changes; a hand's toggle stands while the chat does.
     */
    /**
     * Narrator configuration (70, the maintainer's ask): Multihog's block of
     * pacing, dice, quests and components, the last fold of the starting
     * area as it is the last of Multihog's. The same block is a card under
     * Game systems & customisation; a change in either place reaches the
     * other through the backend's `settings.changed` event.
     */
    const narratorFold = el('details', { class: 'lh-narrator', 'data-lh-field': 'narrator-config' }) as HTMLDetailsElement
    // Multihog's drawer since 83: the ✦, the label over its small line, the chevron (the start area's clothes).
    const narratorSummary = el('summary')
    const narratorIcon = el('span', { class: 'lh-start-drawer-icon', 'aria-hidden': 'true' })
    narratorIcon.textContent = '✦'
    const narratorLabel = el('span', { class: 'lh-start-drawer-label' })
    const narratorTitle = el('span', { class: 'lh-start-drawer-title' })
    narratorTitle.textContent = 'Narrator configuration'
    const narratorSub = el('small', { class: 'lh-narrator-sub' })
    narratorSub.textContent = 'Set pacing, RNG, quests, and optional systems'
    narratorLabel.append(narratorTitle, narratorSub)
    const narratorChevron = el('span', { class: 'lh-start-drawer-chevron', 'aria-hidden': 'true' })
    narratorChevron.textContent = '▸'
    narratorSummary.append(narratorIcon, narratorLabel, narratorChevron)
    const narratorBody = el('div', { class: 'lh-narrator-body' })
    narratorFold.append(narratorSummary, narratorBody)
    const narrator: NarratorConfig = mountNarratorConfig(narratorBody, { createElement: el as never }, settings as SettingsBag, {
        commit: (patch) => {
            bridge.request<{ settings: SettingsBag }>('settings.patch', { patch })
                .then((result) => { narrator.setSettings(result.settings) })
                .catch(fail)
        },
        savePref: (patch) => { bridge.request<PrefsResult>('prefs.patch', { patch }).catch(fail) },
    })
    // The area after Multihog's onboarding (83): the hero, the box, the two drawers, How It Works, Need Help,
    // the Setup Guide with the narrator card's row, the connection shortcut — around the folds built above.
    const startArea = createStartArea({
        el,
        creator: creatorFold.root, instant: instantFold.root, ways: waysFold.root, importCard: importFold.root, narrator: narratorFold,
        createNarratorCard: (name) => bridge.request<NarratorCardResult>('narrator.create', { name }),
        savePrefs: async (patch) => { await bridge.request<PrefsResult>('prefs.patch', { patch }) },
        fail: (error) => fail(error),
    })
    const startGroup = startArea.root
    let startGroupChat: string | null | undefined
    // The NPC library (41): identity cards kept outside any chat, under the Player Card.
    const libraryFold = createLibraryFold({
        el,
        ...(enlarge ? { enlarge } : {}),
        list: () => bridge.request<{ records: LibraryRecordView[] }>('library.list'),
        sources: () => bridge.request<LibrarySources>('library.sources', { chatId }),
        saveEntry: (request) => bridge.request('library.saveEntry', { chatId, ...request }),
        savePlayerCard: (request) => bridge.request('library.savePlayerCard', { chatId, ...request }),
        update: (request) => bridge.request<LibraryRecordView>('library.update', request),
        remove: async (id) => { await bridge.request<{ removed: boolean }>('library.remove', { id }) },
        importText: (text) => bridge.request<{ records: LibraryRecordView[] }>('library.import', { text }),
        exportCard: (id, portraitDataUrl) => bridge.request('library.export', { id, portraitDataUrl }),
        party: async (id) => {
            const result = await bridge.request<LibraryActionResult>('library.party', { chatId, id })
            return result
        },
        // Add to world (53): the NPC creator's add on a library record, which is always literal.
        world: (id) => {
            const narrator = host.getActiveChat().characterId
            return bridge.request<NpcAddResult>('npc.add', { chatId, source: { kind: 'library', id }, ...(narrator ? { narratorCharacterId: narrator } : {}) })
        },
        playAsPc: async (id) => {
            const result = await bridge.request<LibraryActionResult>('library.playAsPc', { chatId, id })
            playerCardFold.refresh()
            return result
        },
        pickText: async () => {
            if (!host.uploads?.pickFile) throw new Error('This build cannot open a file picker.')
            const [picked] = await host.uploads.pickFile({ accept: ['.json', 'application/json'] })
            return picked ? new TextDecoder().decode(picked.bytes) : null
        },
        // The card's photo (60): a file through the host's picker, or drawn through the host's image generation;
        // placed on the open chat's entity of the card's name when the cards name one.
        ...(host.uploads ? {
            pickImage: async () => {
                const [picked] = await host.uploads!.pickFile({ accept: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], maxSizeBytes: MAX_PORTRAIT_BYTES })
                return picked ? { dataUrl: toDataUrl(picked.bytes, picked.mimeType), filename: picked.name || 'photo.png' } : null
            },
        } : {}),
        setPhoto: ({ id, dataUrl, filename, place }) => bridge.request<LibraryPhotoResult>('library.photo.set', { id, dataUrl, filename, ...(place && chatId ? { chatId } : {}) }),
        drawPhoto: async ({ id, place }) => {
            const where = place && chatId ? { chatId } : {}
            const edited = await editedPrompt(async () => { const r = await bridge.request<LibraryPhotoPromptResult>('library.photo.prompt', { id, ...where }); return { title: `The photo of ${r.name}`, prompt: r.prompt } })
            return edited ? bridge.request<LibraryPhotoResult>('library.photo.draw', { id, ...where, ...edited }) : null
        },
        removePhoto: (id) => bridge.request<LibraryPhotoResult>('library.photo.remove', { id }),
        inPlay: (name) => {
            const wanted = normalizeEntityName(name)
            return !!wanted && !!lastView && entitiesInView(lastView).some((n) => normalizeEntityName(n).localeCompare(wanted, undefined, { sensitivity: 'accent' }) === 0)
        },
        portraitData: async (src) => {
            if (/^data:image\//i.test(src)) return src
            try {
                const blob = await (await fetch(src)).blob()
                return await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : ''); reader.onerror = () => resolve(''); reader.readAsDataURL(blob) })
            } catch {
                return ''
            }
        },
        download: downloadText,
        fail: (error) => fail(error),
        when: (iso) => when(iso),
        ...(host.ui ? { confirm: async (message: string) => (await host.ui!.showConfirm({ title: 'NPC library', message, variant: 'warning', confirmLabel: 'Go ahead' })).confirmed } : {}),
    })
    // The portraits in play at the foot of the library (60): one place for pictures.
    libraryFold.tail.append(portraitEditor)
    // The NPC creator (41a): a card, a library record, a concept or an archetype into the campaign's NPC book.
    const narratorField = (): { narratorCharacterId?: string } => {
        const narrator = host.getActiveChat().characterId
        return narrator ? { narratorCharacterId: narrator } : {}
    }
    const npcFold = createNpcCreatorFold({
        el,
        cards: () => bridge.request<{ cards: CardChoice[] }>('creator.cards'),
        library: () => bridge.request<{ records: LibraryRecordView[] }>('library.list'),
        draft: (request) => bridge.request<NpcDraftResult>('npc.draft', { chatId, ...request, ...narratorField() }),
        add: (request) => bridge.request<NpcAddResult>('npc.add', { chatId, ...request, ...narratorField() }),
        commit: (request) => bridge.request<NpcAddResult>('npc.commit', { chatId, ...request }),
        savePrefs: async (patch) => { await bridge.request<PrefsResult>('prefs.patch', { patch }) },
        fail: (error) => fail(error),
        when: (iso) => when(iso),
    })
    // The scene (42): where the party is and who is present, above the agent as the legacy's Visuals mode sits.
    const sceneFold = createSceneFold({
        el,
        get: () => bridge.request<SceneResult>('scene.get', { chatId }),
        setImage: (path, src, filename) => bridge.request<SceneResult>('scene.setImage', { chatId, path, src, ...(filename ? { filename } : {}) }),
        // The same ask as the portraits' and the library's pickers (66): the types named one by one and the
        // size capped, since those two are confirmed working and this one, asked with `image/*`, stopped.
        pickImage: async () => {
            if (!host.uploads?.pickFile) throw new Error('This build cannot open a file picker.')
            const [picked] = await host.uploads.pickFile({ accept: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], maxSizeBytes: MAX_PORTRAIT_BYTES })
            return picked ? { dataUrl: toDataUrl(picked.bytes, picked.mimeType), filename: picked.name || 'scene.png' } : null
        },
        savePrefs: async (patch) => { await bridge.request<PrefsResult>('prefs.patch', { patch }) },
        // The picture drawn by the host (49), and its connections.
        draw: async () => {
            const asked = chatId
            const edited = await editedPrompt(async () => { const r = await bridge.request<ScenePromptResult>('scene.prompt', { chatId: asked }); return { title: `The picture of ${r.leaf}`, prompt: r.prompt } })
            return edited ? bridge.request<SceneDrawResult>('scene.draw', { chatId: asked, ...edited }) : null
        },
        setBackground: (src) => locationBackground.apply(src),
        connections: () => bridge.request<SceneConnectionsResult>('scene.connections', {}),
        // The picture large (55), in the host's modal, where the host has one; the buttons under it (80).
        ...(enlarge ? { enlarge } : {}),
        portraitActions: (name) => portraitActions(name),
        fail: (error) => fail(error),
        when: (iso) => when(iso),
    })
    /**
     * The two gears of the Campaign Records (78b): the NPC and PC Card Settings and the Location Settings, each
     * the same preferences and keys as their other places on screen. The scene's drawing settings go into the
     * Location box only where a modal can show it; elsewhere they stay at the scene fold's foot.
     */
    const cardSettings = createCardSettings({
        el,
        savePrefs: async (patch) => { await bridge.request<PrefsResult>('prefs.patch', { patch }) },
        saveSettings: async (patch) => { await bridge.request<{ settings: SettingsBag }>('settings.patch', { patch }) },
        saveWordTargets: (major, minor) => bridge.request<{ applied: boolean }>('settings.npcWords', { major, minor }),
        fail: (error) => fail(error),
    }, host.ui?.showModal ? [sceneFold.pictureSettings] : [])
    let playerCardChat: string | null | undefined
    const clearArchiveButton = el('button', { type: 'button', class: 'lh-button' })
    archiveActions.append(clearArchiveButton)
    archiveActions.hidden = true

    // The clock nudge goes directly under the report whose timestamp it fixes.
    // It shipped at the bottom of the panel first, past the portraits, the bars
    // and the cards switch, and the maintainer could not find it — reasonably,
    // since the thing it corrects is up here.
    // The tracker's report and its earlier passes under the terminal's State Tracker tab since 78d, as the
    // agent's are under its own (78a): Multihog's tracker widget has no report box.
    terminalFold.history('state_tracker').append(report, reportHistoryRow)
    /**
     * Three folds as three tabs of one box (47c): a strip of buttons and
     * the folds under it, one shown at a time, the shown one held open so
     * the tab is the fold's switch and its summary has nothing to do.
     */
    function tabbed(panes: Array<[string, string, HTMLDetailsElement]>, initial: string): HTMLElement[] {
        const strip = el('div', { class: 'lh-widget-tabs', role: 'tablist' })
        const buttons = new Map<string, HTMLButtonElement>()
        const show = (key: string) => {
            for (const [name, , pane] of panes) {
                const on = name === key
                pane.hidden = !on
                pane.classList.toggle('lh-widget-pane--active', on)
                if (on && !pane.open) {
                    pane.open = true
                    pane.dispatchEvent(new Event('toggle'))
                }
                const button = buttons.get(name)
                if (button) {
                    button.classList.toggle('lh-widget-tab--active', on)
                    button.setAttribute('aria-selected', on ? 'true' : 'false')
                }
            }
        }
        for (const [name, label, pane] of panes) {
            const button = el('button', { type: 'button', class: 'lh-widget-tab', role: 'tab', 'data-lh-tab': name })
            button.textContent = label
            button.addEventListener('click', () => { show(name) })
            buttons.set(name, button)
            strip.append(button)
            pane.classList.add('lh-widget-pane')
        }
        show(initial)
        return [strip, ...panes.map(([, , pane]) => pane)]
    }

    // ── Where everything goes (47b, 47c, 78a) ─────────────────────────────
    // The Campaign Records tab: the records browser (71a) whole, the Relationships list under it until the
    // cards carry the standings (78b). Opening the pane opens the browser, which reads its books on open.
    const recordsPane = el('details', { class: 'lh-campaign-records', 'data-lh-field': 'campaign-records' }) as HTMLDetailsElement
    const recordsPaneSummary = el('summary')
    recordsPaneSummary.textContent = 'Campaign Records'
    const recordsPaneBody = el('div', { class: 'lh-agent-drawer-body' })
    recordsPaneBody.append(recordsFold.root)
    recordsPane.append(recordsPaneSummary, recordsPaneBody)
    // A fold inside a pane follows the pane's open state (78a): a tab shown opens it, which is how it reads;
    // the sync is idempotent, since a browser fires the pane's own toggle beside the one the tab dispatches.
    const follow = (pane: HTMLDetailsElement, inner: HTMLDetailsElement): void => {
        pane.addEventListener('toggle', () => {
            if (!pane.open || inner.open) return
            inner.open = true
            inner.dispatchEvent(new Event('toggle'))
        })
    }
    follow(recordsPane, recordsFold.root)
    // The Visuals/Map tab's insides: Multihog's order, the scene fold as the tab's body.
    sceneFold.siteMapSlot.append(siteMapHead, siteMapDirect, picture.root)
    follow(mapView, sceneFold.root)
    mapBody.append(sceneFold.root, mapsStatusBlock)
    // The Lorebook Agent tab's body, in Multihog's order; the footer goes in the box's foot when there is one.
    agentBody.append(agentTools.strip, agentTools.panel, agentBar.row, quick.root, campaignDrawer.root, repertoireDrawer.root, terminalFold.root, evoView, worldView, keysDrawer.root)
    // The Campaign Records' doors (78b): the Player Card fold behind Full PC Card, the library and the creator behind
    // NPC/PC Manager, the two gears and the Maps Guide — all in the host's modal, so those folds leave the settings tab
    // where the host has one; without a modal they stay where they were.
    const modalHost = !!host.ui?.showModal
    if (modalHost) {
        recordsPanels.playerCard = { root: playerCardFold.root, edit: () => playerCardFold.edit() }
        recordsPanels.manager = [libraryFold.root, npcFold.root]
        recordsPanels.npcSettings = cardSettings.npc
        recordsPanels.locationSettings = cardSettings.location
        recordsPanels.mapsGuide = createMapsGuide((tag, attrs) => el(tag as keyof HTMLElementTagNameMap, attrs))
    }
    const settingsFolds = modalHost ? [] : [playerCardFold.root, libraryFold.root, npcFold.root]
    // The World skeleton (33b) in the World progression category (78b, the maintainer's answer), where Multihog keeps its own.
    const skeletonHome = slots.world ?? null
    if (skeletonHome) {
        // First among the category's cards (82), where the dials card of 63c stood; after everything when the
        // category holds no card box.
        const dials = skeletonHome.querySelector('.lh-dials')
        if (dials) dials.prepend(skeletonView)
        else skeletonHome.append(skeletonView)
    }
    const panes: Array<[string, string, HTMLDetailsElement]> = [
        ['agent', 'Lorebook Agent', agentView],
        ['records', 'Campaign Records', recordsPane],
        ['visuals', 'Visuals/Map', mapView],
    ]
    if (rest === root) {
        agentBody.append(agentFooter)
        root.append(
            header, status, problem, cards, archiveActions, startGroup, ...settingsFolds,
            agentView, recordsPane, mapView, ...(skeletonHome ? [] : [skeletonView]), rawView, bottomXp, changeLog, trackerBar.row, trackerFooter,
        )
    } else {
        rest.classList.add('lh-tracker')
        if (scene) {
            // The head goes in the widget's strip when one is given (57): the
            // lights, the time and the two buttons stay in view while the
            // body scrolls, and on a box folded to its head.
            if (slots.head) {
                slots.head.classList.add('lh-tracker')
                slots.head.append(header)
                root.append(status, problem, cards, archiveActions)
            } else {
                root.append(header, status, problem, cards, archiveActions)
            }
            // The XP bar (74f), the Change Log and the instruction bar (78d) and the footer (78b) in the
            // widget's foot when one is given; after the play parts otherwise.
            if (slots.foot) {
                slots.foot.classList.add('lh-tracker')
                slots.foot.append(bottomXp, changeLog, trackerBar.row, trackerFooter)
            } else {
                root.append(bottomXp, changeLog, trackerBar.row, trackerFooter)
            }
            // The second box (78a): the tab strip in its strip and the agent's footer in its foot, neither
            // scrolling, when the layout gives them; the three panes in its body, Visuals/Map first.
            scene.classList.add('lh-tracker', 'lh-scene-widget')
            const [strip, ...paneRoots] = tabbed(panes, 'visuals')
            if (slots.sceneHead) {
                slots.sceneHead.classList.add('lh-tracker')
                slots.sceneHead.append(strip!)
            } else {
                scene.append(strip!)
            }
            scene.append(...paneRoots)
            if (slots.sceneFoot) {
                slots.sceneFoot.classList.add('lh-tracker')
                slots.sceneFoot.append(agentFooter)
            } else {
                agentBody.append(agentFooter)
            }
        } else {
            agentBody.append(agentFooter)
            root.append(header, status, problem, cards, archiveActions, agentView, recordsPane, mapView, bottomXp, changeLog, trackerBar.row, trackerFooter)
        }
        rest.append(startGroup, ...settingsFolds, ...(skeletonHome ? [] : [skeletonView]), rawView)
    }

    // ── World Progression ────────────────────────────────────────────────

    // ── The hidden map (row 9) ───────────────────────────────────────────

    let mapStatus: MapStatusResult | null = null
    /** Map Details open in the host's modal (78a), and when Reset timeline was last pressed, for the note. */
    let detailsModal: DetailsModal | null = null
    let evoResetAt: string | null = null
    let architectRunning: { site: string; at: string } | null = null
    /** The scene picture (49-bis): a draw in flight, and the last draw's report, for the head's light. */
    let sceneDrawing: { path: string; at: string } | null = null
    let sceneDrawLast: ScenePictureReport | null = null
    /** A library card's photo being drawn (60-bis), and the last such draw: the Picture light reads them beside the scene's. */
    let libraryDrawing: { name: string; at: string } | null = null
    let libraryDrawLast: { name: string; at: string; outcome: 'drawn' | 'failed'; reason?: string } | null = null
    /** A portrait drawn as it appears (61): the same light, its own words. */
    let autoDrawing: { name: string; at: string } | null = null
    let autoDrawLast: { name: string; at: string; outcome: 'drawn' | 'failed'; reason?: string } | null = null
    let updaterRunning: { site: string; at: string } | null = null
    let updaterPressed = false
    let evolutionRunning: { sites: string[]; at: string } | null = null
    let evolutionPressed = false

    async function saveMapPref(patch: Record<string, unknown>): Promise<void> {
        await bridge.request<PrefsResult>('prefs.patch', { patch })
        await loadMaps()
    }

    function describeArchitectRun(run: MapArchitectResult): string {
        const stamped = run.at ? when(run.at) : ''
        const tail = stamped ? ` Ran ${stamped}.` : ''
        switch (run.status) {
            case 'written':
                return `Drew ${run.site} (${run.kind ?? 'map'}): ${run.areas ?? 0} areas, ${run.assets ?? 0} things in them, saved to ${run.entryId ?? 'its entry'}.${tail}`
            case 'reused':
                return `${run.site} was already mapped; the narrator was handed the map that is there.${tail}`
            default:
                return `The architect failed for ${run.site || 'a site'}: ${run.reason ?? 'no reason given'}.${tail}`
        }
    }

    function drawArchitect(): void {
        drawHead()
        const s = mapStatus
        const a = s && !s.unavailable ? s.architect : null
        architectOpenerRow.hidden = !a
        architectLookbackRow.hidden = !a
        architectPrompt.hidden = !a
        if (a) {
            architectOpener.value = a.opener
            architectLookback.value = String(a.lookback)
            if (document.activeElement !== architectPrompt) architectPrompt.value = a.systemPrompt
        }
        architectOpener.disabled = !a || !!architectRunning
        architectLookback.disabled = !a || !!architectRunning
        architectPrompt.disabled = !a || !!architectRunning
        if (!a) {
            architectLine.textContent = ''
        } else if (!s!.enabled) {
            architectLine.textContent = 'The Map Architect is off with the mapping section.'
        } else if (a.opener === 'text') {
            architectLine.textContent = 'Map Architect: the text opener. The narrator writes a [CREATE_AREA_MAP] block at the end of its reply instead of calling a tool; the block is taken out of the reply, the map is drawn behind it, and the narrator is briefed from the next turn. The CreateAreaMap tool is not offered.'
        } else if (a.toolRegistered) {
            architectLine.textContent = 'Map Architect: the CreateAreaMap tool is registered. The narrator calls it as the party reaches an unmapped site, and the map is drawn and saved.'
        } else {
            architectLine.textContent = 'Map Architect: the CreateAreaMap tool is not registered. The host refused it; the diagnostics line above names a missing permission if that is why.'
        }
        architectLive.hidden = !architectRunning
        if (architectRunning) {
            const started = clock(architectRunning.at)
            architectLive.textContent = `The Map Architect is drawing ${architectRunning.site} now${started ? `, started ${started}` : ''}. Two model calls; the reply goes on without it, and the map is in the prompt from the next turn\u2026`
        }
        const last = s?.lastArchitect
        architectNote.textContent = last ? describeArchitectRun(last) : ''
        architectNote.classList.toggle('lh-world-note--error', last?.status === 'failed')
    }

    function describeUpdaterRun(run: MapUpdaterResult): string {
        const stamped = run.at ? when(run.at) : ''
        const tail = stamped ? ` Ran ${stamped}.` : ''
        const how = run.trigger === 'exit' ? ' on leaving it' : run.trigger === 'manual' ? ' on your instruction' : ''
        switch (run.status) {
            case 'applied':
                return `Updated ${run.site}${how}: ${run.summary || 'the map'} (${run.operations ?? 0} operation${run.operations === 1 ? '' : 's'}).${tail}`
            case 'noop':
                return `Nothing durable changed at ${run.site}${how}.${tail}`
            case 'skipped':
                return `The update${run.site ? ` of ${run.site}` : ''} was skipped: ${run.reason ?? 'no reason given'}.${tail}`
            case 'undone':
                return `The update to ${run.site} was put back: ${run.reason ?? 'the reply was replaced'}. The new reply is read with the next update.${tail}`
            default:
                return `The update of ${run.site || 'the map'}${how} failed: ${run.reason ?? 'no reason given'}.${tail}`
        }
    }

    function drawUpdater(): void {
        drawHead()
        const s = mapStatus
        const u = s && !s.unavailable ? s.updater : null
        const running = updaterRunning ?? (u?.running ? { site: s?.activeSiteRoot || 'the map', at: '' } : null)
        for (const node of [updaterSwitchRow, updaterEvery.row, updaterLookback.row, updaterPrompt, updaterInstruction, updaterButtons]) node.hidden = !u
        if (u) {
            updaterSwitch.checked = u.enabled
            updaterEvery.input.value = String(u.runEvery)
            updaterLookback.input.value = String(u.lookback)
            if (document.activeElement !== updaterPrompt) updaterPrompt.value = u.systemPrompt
        }
        const busy = !u || !!running || updaterPressed
        updaterSwitch.disabled = busy
        updaterEvery.input.disabled = busy
        updaterLookback.input.disabled = busy
        updaterPrompt.disabled = busy
        updaterRunButton.disabled = busy || !chatId || !s!.enabled
        if (!u) {
            updaterLine.textContent = ''
        } else if (!s!.enabled) {
            updaterLine.textContent = 'The Map Updater is off with the mapping section.'
        } else if (!u.enabled) {
            updaterLine.textContent = 'Map Updater: off. The map does not change with play; the architect\u2019s map stands as drawn.'
        } else {
            updaterLine.textContent = `Map Updater: on. It runs after ${u.runEvery === 1 ? 'every reply' : `every ${u.runEvery} replies`} inside a mapped site, reads what the story changed, and writes it into the map; when the party leaves a site it reviews who left with them.`
        }
        updaterLive.hidden = !running
        if (running) {
            const started = running.at ? clock(running.at) : ''
            updaterLive.textContent = `The Map Updater is updating ${running.site} now${started ? `, started ${started}` : ''}. One to three model calls\u2026`
        }
        const last = s?.lastUpdater
        updaterNote.textContent = last ? describeUpdaterRun(last) : ''
        updaterNote.classList.toggle('lh-world-note--error', last?.status === 'failed')
    }

    /** The updater now, on the site the party is in, with the instruction in the box if any — or the terminal's (71b), with its lookback. */
    async function updateMapNow(instructionGiven?: string, lookback?: number): Promise<void> {
        if (!chatId || updaterPressed) return
        const asked = chatId
        updaterPressed = true
        updaterRunning = updaterRunning ?? { site: mapStatus?.activeSiteRoot || 'the map', at: new Date().toISOString() }
        drawUpdater()
        try {
            const instruction = (instructionGiven ?? updaterInstruction.value).trim()
            const result = await bridge.request<MapUpdaterResult>('map.update', { chatId, ...(instruction ? { instruction } : {}), ...(typeof lookback === 'number' ? { lookback } : {}) })
            if (destroyed || chatId !== asked) return
            if (mapStatus) mapStatus = { ...mapStatus, lastUpdater: result }
            loadMaps().catch(() => undefined)
        } catch (error) {
            // The request failed, not necessarily the pass: say so here, and let
            // the pass's own finished event replace it if one arrives.
            if (destroyed || chatId !== asked) return
            if (mapStatus) mapStatus = { ...mapStatus, lastUpdater: { status: 'failed', at: new Date().toISOString(), site: mapStatus.activeSiteRoot, trigger: 'manual', reason: error instanceof Error ? error.message : String(error) } }
        } finally {
            if (!destroyed && chatId === asked) {
                updaterPressed = false
                updaterRunning = null
                drawUpdater()
            }
        }
    }

    function describeEvolutionRun(run: MapEvolutionResult): string {
        const stamped = run.at ? when(run.at) : ''
        const tail = stamped ? ` Ran ${stamped}.` : ''
        const how = run.trigger === 'site_exit' ? ' on leaving' : run.trigger === 'manual' ? ' on your instruction' : ''
        const names = run.sites.map((s) => s.siteRoot).join(', ')
        const parts = run.sites.map((s) => {
            if (s.status === 'applied') return `Evolved ${s.siteRoot}${how}: ${s.summary || 'the map'} (${s.operations ?? 0} operation${s.operations === 1 ? '' : 's'})${s.compressed ? `; its history compressed into ${s.compressed} digest${s.compressed === 1 ? '' : 's'}` : ''}`
            if (s.status === 'noop') return `Nothing stirred at ${s.siteRoot}${how}`
            if (s.status === 'baseline') return ''
            return `${s.siteRoot} failed: ${s.reason ?? 'no reason given'}`
        }).filter(Boolean)
        switch (run.status) {
            case 'baseline':
                return `Started the clock for ${names}${run.currentTime ? ` at ${run.currentTime}` : ''}; the first pass comes one interval later.${tail}`
            case 'skipped':
                return `Evolution was skipped: ${run.reason ?? 'no reason given'}.${tail}`
            case 'undone':
                return `The evolution of ${names || 'the sites'} was put back: ${run.reason ?? 'the reply was replaced'}.${tail}`
            case 'failed':
                return `${parts.join('. ') || `Evolution failed: ${run.reason ?? 'no reason given'}`}.${tail}`
            default:
                return `${parts.join('. ')}.${tail}`
        }
    }

    function drawEvolution(): void {
        drawHead()
        const s = mapStatus
        const e: MapEvolutionStatus | null = s && !s.unavailable ? s.evolution : null
        const running = evolutionRunning ?? (e?.running ? { sites: [], at: '' } : null)
        evoView.hidden = !e
        evoBadge.textContent = e?.enabled ? 'ON' : 'OFF'
        evoBadge.classList.toggle('lh-agent-badge--on', !!e?.enabled)
        if (e) {
            evoSwitch.checked = e.enabled
            evoInterval.input.value = String(e.intervalHours)
            evoOnSiteHours.input.value = String(e.onSiteIntervalHours)
            evoOnSiteMinutes.input.value = String(e.onSiteIntervalMinutes)
            evoPreset.select.value = e.onSitePreset
            evoScope.select.value = e.scope
            evoCount.input.value = String(e.count)
            evoRandomize.input.checked = e.randomize
            evoSelectedRoots = e.selectedRoots.split(',').map((r) => r.trim()).filter(Boolean)
            evoReports.input.value = String(e.worldReportLookback)
            evoStory.input.value = String(e.storyLookback)
            evoConnectionId = e.connectionId ?? ''
            drawEvoConnection()
            if (document.activeElement !== evoPrompt) evoPrompt.value = e.systemPrompt
            evoCompress.input.checked = e.compressEnabled
            evoThreshold.input.value = String(e.compressThreshold)
            evoTokens.input.value = String(e.narratorCommitTokens)
        }
        const busy = !e || !!running || evolutionPressed
        for (const input of [evoSwitch, evoInterval.input, evoOnSiteHours.input, evoOnSiteMinutes.input, evoPreset.select, evoScope.select, evoCount.input, evoRandomize.input, evoReports.input, evoStory.input, evoPrompt, evoCompress.input, evoThreshold.input, evoTokens.input]) input.disabled = busy
        evoSelectedBusy = busy
        drawEvoSelected(s && !s.unavailable ? s.sites : [], e?.sites ?? [])
        if (!busy) evoConnection.disabled = !!connectionsUnavailable
        else evoConnection.disabled = true
        evoCount.row.hidden = !e || e.scope !== 'count'
        evoRandomize.row.hidden = !e || e.scope !== 'count'
        evoSelectedRow.hidden = !e
        evoThreshold.row.hidden = !e || !e.compressEnabled
        evoRunButton.disabled = busy || !chatId || !s!.enabled
        if (!e) {
            evoLine.textContent = ''
        } else if (!s!.enabled) {
            evoLine.textContent = 'Map Evolution is off with the mapping section.'
        } else if (!e.enabled) {
            evoLine.textContent = 'Map Evolution: off. Sites stand as play last left them.'
        } else {
            const onSite = e.onSiteIntervalHours === 0 && e.onSiteIntervalMinutes === 0 ? 'never while the party is there' : `every ${[e.onSiteIntervalHours ? `${e.onSiteIntervalHours} hour${e.onSiteIntervalHours === 1 ? '' : 's'}` : '', e.onSiteIntervalMinutes ? `${e.onSiteIntervalMinutes} minute${e.onSiteIntervalMinutes === 1 ? '' : 's'}` : ''].filter(Boolean).join(' ')} for the site the party is in`
            const clock = e.currentTime ? `The clock reads ${e.currentTime}` : 'The clock has no [TIME] yet'
            const last = e.lastFired ? `a site last evolved at ${e.lastFired}` : 'no site has evolved yet'
            const next = e.nextDue ? `the next pass is due at ${e.nextDue}` : 'the next pass starts a clock on the next reply'
            evoLine.textContent = `Map Evolution: on, every ${e.intervalHours} in-world hour${e.intervalHours === 1 ? '' : 's'} for a site the party is away from, ${onSite}. ${clock}; ${last}; ${next}.`
        }
        evoLive.hidden = !running
        if (running) {
            const started = running.at ? clock(running.at) : ''
            evoLive.textContent = `Map Evolution is moving ${running.sites.length ? running.sites.join(', ') : 'the sites'} now${started ? `, started ${started}` : ''}. One to three model calls per site\u2026`
        }
        const last = s?.lastEvolution
        if (evoResetAt && last?.at && last.at > evoResetAt) evoResetAt = null
        evoNote.textContent = evoResetAt
            ? `The timeline is reset: every site’s clock starts from the current in-world time (${clock(evoResetAt)}).`
            : last ? describeEvolutionRun(last) : ''
        evoNote.classList.toggle('lh-world-note--error', !evoResetAt && last?.status === 'failed')
    }

    /** The sites a press of Evolve now is about to run on, as the scope names them (45c-quater); the backend's started event then says. */
    function sitesTheScopeNames(): string[] {
        const s = mapStatus
        const e = s && !s.unavailable ? s.evolution : null
        if (!s || !e) return []
        switch (e.scope) {
            case 'active': return s.activeSiteRoot ? [s.activeSiteRoot] : []
            case 'selected': return e.selectedRoots.split(',').map((r) => r.trim()).filter(Boolean)
            case 'count': return []
            default: return s.sites.map((site) => site.siteRoot)
        }
    }

    /** Evolution now, on the sites the scope names, with the instruction in the box if any — or the terminal's (71b), with its lookback. */
    /** Multihog's Reset Timeline (78a): the clocks forgotten on the backend; the note says so until the next pass lands. */
    async function resetEvolutionTimeline(): Promise<void> {
        if (!chatId) return
        const asked = chatId
        await bridge.request<{ reset: true }>('map.evolution.reset', { chatId })
        if (destroyed || chatId !== asked) return
        evoResetAt = new Date().toISOString()
        await loadMaps()
    }

    async function evolveNow(instructionGiven?: string, lookback?: number): Promise<void> {
        if (!chatId || evolutionPressed) return
        const asked = chatId
        evolutionPressed = true
        evolutionRunning = evolutionRunning ?? { sites: sitesTheScopeNames(), at: new Date().toISOString() }
        drawEvolution()
        try {
            const instruction = (instructionGiven ?? evoInstruction.value).trim()
            const result = await bridge.request<MapEvolutionResult>('map.evolve', { chatId, ...(instruction ? { instruction } : {}), ...(typeof lookback === 'number' ? { lookback } : {}) })
            if (destroyed || chatId !== asked) return
            if (mapStatus) mapStatus = { ...mapStatus, lastEvolution: result }
            loadMaps().catch(() => undefined)
        } catch (error) {
            if (destroyed || chatId !== asked) return
            if (mapStatus) mapStatus = { ...mapStatus, lastEvolution: { status: 'failed', at: new Date().toISOString(), trigger: 'manual', sites: [], reason: error instanceof Error ? error.message : String(error) } }
        } finally {
            if (!destroyed && chatId === asked) {
                evolutionPressed = false
                evolutionRunning = null
                drawEvolution()
            }
        }
    }

    function drawMaps(): void {
        const s = mapStatus
        mapRefreshButton.disabled = !chatId || !!s?.unavailable
        drawArchitect()
        drawUpdater()
        drawEvolution()
        mapSummary.textContent = `Visuals/Map${s && !s.unavailable && s.sites.length ? ` \u00b7 ${s.sites.length} mapped` : ''}${s?.activeSiteRoot ? ' \u00b7 inside' : ''}`
        drawAgentFooter()
        mapNote.textContent = s?.problem ? `The maps could not be read: ${s.problem}` : ''
        mapNote.classList.toggle('lh-world-note--error', !!s?.problem)
        if (!s) {
            mapStatusLine.textContent = chatId ? 'Loading\u2026' : 'No chat open.'
            mapSitesLine.textContent = ''
            return
        }
        if (s.unavailable) {
            mapStatusLine.textContent = s.unavailable
            mapSitesLine.textContent = ''
            return
        }
        const parts: string[] = []
        if (!s.enabled) parts.push('The rulebook\u2019s mapping section is off, so no map reaches the narrator.')
        parts.push(s.currentLocation ? `The party is at ${s.currentLocation}.` : 'The last reply had no Location footer, so the party\u2019s place is unknown.')
        if (s.activeSiteRoot) parts.push(`They are inside ${s.activeSiteRoot}; its map is in the prompt as GM canon.`)
        else if (s.sites.length && s.currentLocation) parts.push('They are not inside a mapped site.')
        if (s.mentionedSiteRoots.length) parts.push(`Named this turn: ${s.mentionedSiteRoots.join(', ')}.`)
        mapStatusLine.textContent = parts.join(' ')
        mapSitesLine.textContent = s.sites.length
            ? `Mapped: ${s.sites.map((site) => `${site.siteRoot} (${site.kind})`).join(', ')}.`
            : 'No site has a map yet.'
    }

    async function loadMaps(): Promise<void> {
        if (!chatId) return
        const asked = chatId
        try {
            const result = await bridge.request<MapStatusResult>('map.get', { chatId })
            if (destroyed || chatId !== asked) return
            mapStatus = result
        } catch (error) {
            if (destroyed || chatId !== asked) return
            mapStatus = { enabled: false, currentLocation: '', sites: [], activeSiteRoot: '', mentionedSiteRoots: [], canonChars: 0, syncedAt: '', architect: { toolRegistered: false, opener: 'tool', lookback: 12, systemPrompt: '' }, updater: { enabled: false, runEvery: 1, lookback: 4, systemPrompt: '', running: false }, evolution: { enabled: false, intervalHours: 8, onSiteIntervalHours: 1, onSiteIntervalMinutes: 0, onSitePreset: 'dynamic', scope: 'all', count: 1, randomize: true, selectedRoots: '', worldReportLookback: 5, storyLookback: 20, connectionId: '', systemPrompt: '', compressEnabled: true, compressThreshold: 10000, narratorCommitTokens: 2000, running: false, currentTime: '', lastFired: '', nextDue: '', sites: [] }, unavailable: error instanceof Error ? error.message : String(error) }
        }
        drawMaps()
        picture.refresh().catch(() => undefined)
        sceneFold.refresh().catch(() => undefined)
        // The standings on the cards too (44-bis): the switch may have been flipped
        // since the fold last read, and no event says so. And the active keys, when shown.
        recordsFold.refreshRelations().catch(() => undefined)
        if (keysDrawer.root.open) loadActivation().catch(() => undefined)
    }

    /** What the backend knows about this chat's world. Failure leaves the fold saying so. */
    async function loadWorld(): Promise<void> {
        if (!chatId) return
        const asked = chatId
        try {
            const status = await bridge.request<WorldStatusResult>('world.get', { chatId })
            if (destroyed || chatId !== asked) return
            worldStatus = status
            if (worldBooks === null) {
                // Once per chat: the shelf changes rarely, and the fold redraws on every pass.
                bridge.request<WorldBooksResult>('world.books', { chatId })
                    .then((result) => { if (!destroyed && chatId === asked) { worldBooks = result.books; drawSkeletonBooks() } })
                    .catch(() => { if (!destroyed && chatId === asked) { worldBooks = []; drawSkeletonBooks() } })
            }
        } catch (error) {
            if (destroyed || chatId !== asked) return
            worldStatus = {
                enabled: false, intervalHours: 24, locationsPerReport: 3, keepActive: 1, lookback: 20, prefix: '', worldBookName: '', lastFiredPeriodLabel: '', nextDueLabel: '', currentTimeLabel: '', activeReports: [],
                skeletonBookName: '', skeletonCounts: { factions: 0, locations: 0, conflicts: 0 }, skeletonSource: '',
                skeleton: { factions: 4, locations: 4, conflicts: 3, systemPrompt: '', useLorebooks: false, lorebookOnly: false, lorebookFilter: '', useExisting: true, sourceLookback: 30 },
                unavailable: error instanceof Error ? error.message : String(error),
            }
        }
        drawWorld()
    }

    /** Store one preference and redraw from what the backend settled on. */
    async function saveWorldPref(patch: Record<string, unknown>): Promise<void> {
        await bridge.request<PrefsResult>('prefs.patch', { patch })
        await loadWorld()
    }

    function describeWorldRun(run: WorldRunResult): string {
        const who = run.trigger === 'automatic' ? 'on its own' : 'when you asked'
        const stamped = run.at ? when(run.at) : ''
        const tail = stamped ? ` Ran ${stamped}, ${who}.` : ''
        switch (run.status) {
            case 'written': {
                const places = run.selectedLocations?.length ? run.selectedLocations.join(', ') : 'Wider Currents only'
                const merged = run.consolidated ? ` Older reports were first compressed into "${run.consolidated}".` : ''
                return `Wrote the report for ${run.periodLabel ?? 'the period'}: ${places}.${merged}${tail}`
            }
            case 'duplicate':
                return `A report for ${run.periodLabel ?? 'that period'} was already filed, so none was written.${tail}`
            case 'cancelled':
                return `Stopped before a report was written.${tail}`
            case 'skipped':
                return `${run.reason ?? 'Nothing was written.'}${tail}`
            default:
                return `The report failed: ${run.reason ?? 'no reason given'}.${tail}`
        }
    }

    function drawWorld(): void {
        drawHead()
        const status = worldStatus
        const unavailable = status?.unavailable
        worldBadge.textContent = status?.enabled ? 'ON' : 'OFF'
        worldBadge.classList.toggle('lh-agent-badge--on', !!status?.enabled)
        const busy = !!unavailable || !!worldRunning || !!skeletonRunning || !chatId
        const controls = [worldSwitch, worldInterval.input, worldLocations.input, worldKeep.input, worldLookback.input, worldRunButton, worldExtraButton, worldResetButton, worldExtra, worldPurgeButton,
            skeletonSource, skeletonSourceButton, skeletonSourceLookback, skeletonFactions.input, skeletonLocations.input, skeletonConflicts.input, skeletonLorebooks.input, skeletonOnly.input, skeletonExisting.input, skeletonPrompt, skeletonGenerateButton, skeletonAddButton]
        for (const control of controls) (control as HTMLInputElement).disabled = busy

        if (status) {
            worldSwitch.checked = status.enabled
            worldInterval.input.value = String(status.intervalHours)
            worldLocations.input.value = String(status.locationsPerReport)
            worldKeep.input.value = String(status.keepActive)
            worldLookback.input.value = String(status.lookback)
            // Read softly: a backend from before 33b answers without these.
            const sk = status.skeleton ?? { factions: 4, locations: 4, conflicts: 3, systemPrompt: '', useLorebooks: false, lorebookOnly: false, lorebookFilter: '', useExisting: true, sourceLookback: 30 }
            skeletonFactions.input.value = String(sk.factions)
            skeletonLocations.input.value = String(sk.locations)
            skeletonConflicts.input.value = String(sk.conflicts)
            skeletonLorebooks.input.checked = sk.useLorebooks
            skeletonFilterNames = filterNamesOf(sk.lorebookFilter)
            skeletonSourceLookback.value = String(sk.sourceLookback ?? 30)
            skeletonOnly.input.checked = sk.lorebookOnly
            skeletonExisting.input.checked = sk.useExisting
            skeletonPrompt.value = sk.systemPrompt
            // The user's text is theirs: only filled from the backend while it is not being edited.
            if (document.activeElement !== skeletonSource && !skeletonSource.value.trim()) skeletonSource.value = status.skeletonSource ?? ''
        }
        skeletonFilterRow.hidden = !skeletonLorebooks.input.checked
        skeletonOnly.row.hidden = !skeletonLorebooks.input.checked
        drawSkeletonBooks()
        drawSkeleton()

        if (unavailable) {
            worldStatusLine.textContent = unavailable
            worldReportsLine.textContent = ''
        } else if (!status) {
            worldStatusLine.textContent = chatId ? 'Loading\u2026' : 'No chat open.'
            worldReportsLine.textContent = ''
        } else {
            const parts: string[] = []
            parts.push(status.currentTimeLabel ? `The clock reads ${status.currentTimeLabel}.` : 'The tracker has no [TIME] block yet, so there is no clock to go by.')
            if (status.lastFiredPeriodLabel) parts.push(`Last report: ${status.lastFiredPeriodLabel}.`)
            else if (status.currentTimeLabel) parts.push(status.enabled ? 'No report yet; the clock starts on the next tracker pass.' : 'No report yet.')
            if (status.nextDueLabel && status.enabled) parts.push(`Next due at ${status.nextDueLabel}.`)
            parts.push(`Reports are filed in ${status.worldBookName || 'the campaign\u2019s _World book'}.`)
            worldStatusLine.textContent = parts.join(' ')
            worldReportsLine.textContent = status.activeReports.length
                ? `Shown to the narrator: ${status.activeReports.map((r) => r.label).join(', ')}.`
                : 'Nothing is shown to the narrator yet.'
        }

        worldLive.hidden = !worldRunning
        if (worldRunning) {
            const started = clock(worldRunning.at)
            worldLive.textContent = `A report is being written now${started ? `, started ${started}` : ''}${worldRunning.trigger === 'automatic' ? ', on its own' : ''}. Reading the campaign\u2019s lore\u2026`
        }

        const last = status?.lastRun
        if (!last) {
            worldNote.textContent = ''
            worldNote.classList.remove('lh-world-note--error')
        } else {
            worldNote.textContent = describeWorldRun(last)
            worldNote.classList.toggle('lh-world-note--error', last.status === 'failed')
        }
    }

    /** A report now, with the user's instructions for this one when given. */
    async function runWorld(extraInstructions?: string): Promise<void> {
        if (!chatId) { say('No chat open.', 'error'); return }
        const asked = chatId
        const extra = extraInstructions?.trim()
        worldRunning = { at: new Date().toISOString(), trigger: 'manual' }
        drawWorld()
        try {
            const run = await bridge.request<WorldRunResult>('world.run', { chatId, ...(extra ? { extraInstructions: extra } : {}) })
            if (destroyed || chatId !== asked) return
            worldRunning = null
            if (extra && run.status === 'written') worldExtra.value = ''
            if (worldStatus) worldStatus = { ...worldStatus, lastRun: run }
            drawWorld()
            await loadWorld()
        } catch (error) {
            if (destroyed || chatId !== asked) return
            if (error instanceof RequestTimeoutError) {
                // Still running, as far as anyone here knows; `world.finished` will land it.
                say('The report is taking longer than the panel waits. It is still being written and will show here when it lands.', 'busy')
                return
            }
            worldRunning = null
            drawWorld()
            throw error
        }
    }

    /** The oldest N raw reports folded into one digest now (72b). */
    async function consolidateWorld(): Promise<void> {
        if (!chatId) { say('No chat open.', 'error'); return }
        const count = Math.floor(Number(consolidateCount.value))
        if (!Number.isFinite(count) || count < 2) { worldToolsNote.textContent = 'Enter a count of at least 2 reports.'; return }
        if (!(await confirmOn(consolidateButton, { title: 'Consolidate the reports', message: `Fold the oldest ${count} raw reports into one digest now? The digest replaces them in the World book.`, confirmLabel: 'Consolidate' }))) return
        const asked = chatId
        consolidateButton.disabled = true
        worldToolsNote.classList.remove('lh-world-note--error')
        worldToolsNote.textContent = `Consolidating ${count} reports…`
        try {
            const result = await bridge.request<WorldConsolidateResult>('world.consolidate', { chatId, count })
            if (destroyed || chatId !== asked) return
            worldToolsNote.textContent = `Consolidated ${result.consolidated} reports into “${result.label}”.`
            await loadWorld()
        } catch (error) {
            if (destroyed || chatId !== asked) return
            worldToolsNote.textContent = `Could not consolidate: ${error instanceof Error ? error.message : String(error)}`
            worldToolsNote.classList.add('lh-world-note--error')
        } finally {
            consolidateButton.disabled = false
        }
    }

    /** The next report's in-world time set by hand (72b). */
    async function overrideWorldNext(): Promise<void> {
        if (!chatId) { say('No chat open.', 'error'); return }
        const next = overrideInput.value.trim()
        if (!next) { worldToolsNote.textContent = 'Enter the in-world time of the next report.'; return }
        const asked = chatId
        worldToolsNote.classList.remove('lh-world-note--error')
        try {
            const status = await bridge.request<WorldStatusResult>('world.overrideNext', { chatId, next })
            if (destroyed || chatId !== asked) return
            worldStatus = status
            drawWorld()
            worldToolsNote.textContent = `The next report is due at ${status.nextDueLabel || next}.`
            overrideInput.value = ''
        } catch (error) {
            if (destroyed || chatId !== asked) return
            worldToolsNote.textContent = error instanceof Error ? error.message : String(error)
            worldToolsNote.classList.add('lh-world-note--error')
        }
    }

    async function resetWorld(): Promise<void> {
        if (!chatId) return
        const status = await bridge.request<WorldStatusResult>('world.reset', { chatId })
        if (destroyed) return
        worldStatus = status
        drawWorld()
        say('The world\u2019s timeline is reset. The next report starts from the current in-world time.')
    }

    // ── the skeleton (33b) ───────────────────────────────────────────────

    function describeSkeletonRun(run: WorldSkeletonResult): string {
        const stamped = run.at ? when(run.at) : ''
        const tail = stamped ? ` Ran ${stamped}.` : ''
        const verb = run.mode === 'append' ? 'Added' : 'Wrote'
        switch (run.status) {
            case 'written':
                return `${verb} ${run.count ?? 0} ${run.count === 1 ? 'premise' : 'premises'}: ${run.factions ?? 0} factions, ${run.locations ?? 0} locations, ${run.conflicts ?? 0} conflicts.${tail}`
            case 'cancelled':
                return `Stopped before the skeleton was written.${tail}`
            case 'skipped':
                return `${run.reason ?? 'Nothing was written.'}${tail}`
            default:
                return `The skeleton failed: ${run.reason ?? 'no reason given'}.${tail}`
        }
    }

    function drawSkeleton(): void {
        const status = worldStatus
        if (!status || status.unavailable) {
            skeletonCountBadge.textContent = ''
            skeletonStatusLine.textContent = status?.unavailable ?? (chatId ? 'Loading\u2026' : 'No chat open.')
        } else {
            const counts = status.skeletonCounts ?? { factions: 0, locations: 0, conflicts: 0 }
            const total = counts.factions + counts.locations + counts.conflicts
            skeletonCountBadge.textContent = total ? `\u00b7 ${total}` : ''
            skeletonStatusLine.textContent = total
                ? `${status.skeletonBookName} holds ${counts.factions} factions, ${counts.locations} locations and ${counts.conflicts} conflicts.`
                : `No skeleton yet. It will be filed in ${status.skeletonBookName || 'the campaign\u2019s _Skeleton book'}.`
        }
        skeletonLive.hidden = !skeletonRunning
        if (skeletonRunning) {
            const started = clock(skeletonRunning.at)
            skeletonLive.textContent = skeletonRunning.mode === 'source'
                ? `The source is being written from this chat now${started ? `, started ${started}` : ''}. Reading the recent messages\u2026`
                : `The skeleton is being ${skeletonRunning.mode === 'append' ? 'extended' : 'written'} now${started ? `, started ${started}` : ''}. Reading the source\u2026`
        }
        const last = status?.lastSkeleton
        skeletonNote.textContent = last ? describeSkeletonRun(last) : ''
        skeletonNote.classList.toggle('lh-world-note--error', last?.status === 'failed')
    }

    /**
     * Yes or no, for something that cannot be undone: the host's dialog when
     * it has one, otherwise the button asks to be pressed again.
     */
    const armed = new Map<HTMLButtonElement, { label: string; timer: ReturnType<typeof setTimeout> }>()
    async function confirmOn(button: HTMLButtonElement, ask: { title: string; message: string; confirmLabel: string }): Promise<boolean> {
        if (host.ui) {
            const { confirmed } = await host.ui.showConfirm({ ...ask, variant: 'danger' })
            return confirmed
        }
        const pending = armed.get(button)
        if (pending) {
            clearTimeout(pending.timer)
            armed.delete(button)
            button.textContent = pending.label
            return true
        }
        const label = button.textContent ?? ''
        button.textContent = `Press again to ${ask.confirmLabel.toLowerCase()}`
        armed.set(button, {
            label,
            timer: setTimeout(() => {
                armed.delete(button)
                button.textContent = label
            }, 8000),
        })
        say(`${ask.message} Press the button again within a few seconds to go ahead.`, 'busy')
        return false
    }

    async function runSkeleton(mode: 'replace' | 'append'): Promise<void> {
        if (!chatId) { say('No chat open.', 'error'); return }
        const asked = chatId
        const counts = worldStatus?.skeletonCounts
        const filed = counts ? counts.factions + counts.locations + counts.conflicts : 0
        if (mode === 'replace' && filed > 0) {
            const ok = await confirmOn(skeletonGenerateButton, {
                title: 'Replace the skeleton',
                message: `The ${filed} premises in ${worldStatus?.skeletonBookName ?? 'the skeleton'} will be deleted and written afresh. This cannot be undone.`,
                confirmLabel: 'Replace',
            })
            if (!ok) return
        }
        skeletonRunning = { at: new Date().toISOString(), mode }
        drawWorld()
        try {
            const run = await bridge.request<WorldSkeletonResult>('world.skeleton', { chatId, source: skeletonSource.value, mode })
            if (destroyed || chatId !== asked) return
            skeletonRunning = null
            if (worldStatus) worldStatus = { ...worldStatus, lastSkeleton: run }
            drawWorld()
            await loadWorld()
        } catch (error) {
            if (destroyed || chatId !== asked) return
            if (error instanceof RequestTimeoutError) {
                say('The skeleton is taking longer than the panel waits. It is still being written; reopen the fold in a while to see it.', 'busy')
                return
            }
            skeletonRunning = null
            drawWorld()
            throw error
        }
    }

    /** The source from the chat (33c): replaces the text, after asking when there is text to lose. */
    async function writeSourceFromChat(): Promise<void> {
        if (!chatId) { say('No chat open.', 'error'); return }
        const asked = chatId
        if (skeletonSource.value.trim()) {
            const ok = await confirmOn(skeletonSourceButton, {
                title: 'Replace the source',
                message: 'The text in the source box will be replaced by what the model writes from this chat.',
                confirmLabel: 'Replace',
            })
            if (!ok) return
        }
        skeletonRunning = { at: new Date().toISOString(), mode: 'source' }
        drawWorld()
        try {
            const run = await bridge.request<WorldSourceResult>('world.skeletonSource', { chatId })
            if (destroyed || chatId !== asked) return
            skeletonRunning = null
            if (run.status === 'written' && run.source) {
                skeletonSource.value = run.source
                if (worldStatus) worldStatus = { ...worldStatus, skeletonSource: run.source }
                say('The source is written from this chat. Read it over, then generate the skeleton.')
            } else {
                say(run.status === 'cancelled' ? 'Stopped before the source was written.' : `The source could not be written: ${run.reason ?? 'no reason given'}.`, run.status === 'failed' ? 'error' : 'busy')
            }
            drawWorld()
        } catch (error) {
            if (destroyed || chatId !== asked) return
            if (error instanceof RequestTimeoutError) {
                say('Writing the source is taking longer than the panel waits. It is still being written; reopen the fold in a while to see it.', 'busy')
                return
            }
            skeletonRunning = null
            drawWorld()
            throw error
        }
    }

    async function purgeWorld(): Promise<void> {
        if (!chatId) { say('No chat open.', 'error'); return }
        const asked = chatId
        const ok = await confirmOn(worldPurgeButton, {
            title: 'Purge the world\u2019s history',
            message: `Every report in ${worldStatus?.worldBookName || 'the campaign\u2019s _World book'} and every premise in ${worldStatus?.skeletonBookName || 'its _Skeleton book'} will be deleted, and the clock forgotten. The books stay, empty. This cannot be undone.`,
            confirmLabel: 'Purge',
        })
        if (!ok) return
        const result = await bridge.request<WorldPurgeResult>('world.purge', { chatId, includeSkeleton: true })
        if (destroyed || chatId !== asked) return
        worldPurgeNote.textContent = `Purged: ${result.worldCleared} ${result.worldCleared === 1 ? 'report' : 'reports'} from ${result.worldBookName} and ${result.skeletonCleared} ${result.skeletonCleared === 1 ? 'premise' : 'premises'} from ${result.skeletonBookName}. The clock starts again on the next tracker pass.`
        say('The world\u2019s history is purged.')
        await loadWorld()
    }

    /** "3 minutes ago", roughly. Exact times are noise for a background job. */
    function ago(iso: string): string {
        const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
        if (!Number.isFinite(seconds)) return 'at an unknown time'
        if (seconds < 45) return 'just now'
        const minutes = Math.round(seconds / 60)
        if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
        const hours = Math.round(minutes / 60)
        if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
        return `${Math.round(hours / 24)} day(s) ago`
    }

    /**
     * The local wall-clock time of an ISO timestamp — `2:31 PM`.
     *
     * `ago` answers "is this current?", which is the question that has been
     * misread live; this answers "which pass was that?", which is the one you
     * ask with the chat log open beside the panel. They are different questions
     * and the line carries both. The date rides along once the stamp is no
     * longer today's, because `10:15 AM` alone reads as this morning.
     */
    function clock(iso: string): string {
        const exact = new Date(iso)
        if (Number.isNaN(exact.getTime())) return ''

        // The browser's own zone: the panel runs in it, so its clock is the
        // user's. (Phase 9v's offset answered a staging build whose panel
        // ran on UTC; that build is gone, and the offset with it, Phase 47.)
        const when = exact
        const time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        const today = new Date()
        const sameDay =
            when.getFullYear() === today.getFullYear() &&
            when.getMonth() === today.getMonth() &&
            when.getDate() === today.getDate()

        return sameDay ? time : `${time}, ${when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
    }

    /** "3 minutes ago (2:31 PM)" — how fresh it is, and which pass it was. */
    function when(iso: string): string {
        const stamp = clock(iso)
        return stamp ? `${ago(iso)} (${stamp})` : ago(iso)
    }

    function describeBlocks(pass: TrackerPassReportDTO): string {
        const parts: string[] = []
        if (pass.replaced?.length) parts.push(`updated ${pass.replaced.join(', ')}`)
        if (pass.added?.length) parts.push(`added ${pass.added.join(', ')}`)
        if (pass.removed?.length) parts.push(`removed ${pass.removed.join(', ')}`)
        // A bench looks exactly like a lost member from "updated PARTY", so
        // the people who moved are named.
        if (pass.benched?.length) parts.push(`benched ${pass.benched.join(', ')}`)
        if (pass.unbenched?.length) parts.push(`unbenched ${pass.unbenched.join(', ')}`)
        // A command for a name nobody has is skipped, and skipped silently it
        // is indistinguishable from a bench that worked and scrolled off.
        if (pass.unmatched?.length) {
            parts.push(`could not bench or unbench ${pass.unmatched.join(', ')}: nobody on the roster has that name`)
        }
        // Named rather than counted: a quest leaving the log is the one change
        // here a user might disagree with, and they cannot check it afterwards
        // — the whole point is that it is no longer in the memo.
        if (pass.archived?.length) parts.push(`archived ${pass.archived.join(', ')}`)
        // The relationship awards the pass placed (44), and the names it could
        // not place: an award for a name no entry has is dropped, and dropped
        // silently it reads as a narrator that never awarded.
        if (pass.relations?.length) parts.push(`relations: ${pass.relations.join(', ')}`)
        if (pass.relationsUnmatched?.length) parts.push(`could not place a relationship change for ${pass.relationsUnmatched.join(', ')}: no NPC entry has that name`)
        return parts.length ? parts.join('; ') : 'changed nothing'
    }

    /** Render the last pass, in words rather than a status code. */
    /**
     * One light's state, from what the panel already holds about each
     * process. Running wins; then the last pass's outcome; idle when the
     * chat has had none.
     */
    function headStates(): Record<HeadLightKey, HeadLightState> {
        const tracker: HeadLightState = running
            ? 'running'
            : lastReport?.status === 'failed' ? 'failed'
              : lastReport && lastReport.status !== 'cancelled' ? 'done' : 'idle'
        const agent: HeadLightState = agentRunning
            ? 'running'
            : agentReport?.outcome === 'failed' || agentReport?.outcome === 'unreadable' ? 'failed'
              : agentReport && agentReport.outcome !== 'cancelled' ? 'done' : 'idle'
        const worldLast = worldStatus?.lastRun
        const world: HeadLightState = worldRunning || skeletonRunning
            ? 'running'
            : worldLast?.status === 'failed' ? 'failed'
              : worldLast && worldLast.status !== 'cancelled' ? 'done' : 'idle'
        const mapLast = [mapStatus?.lastArchitect, mapStatus?.lastUpdater, mapStatus?.lastEvolution]
            .filter((r): r is NonNullable<typeof r> => !!r)
            .sort((a, b) => String(b.at).localeCompare(String(a.at)))[0]
        const map: HeadLightState = architectRunning || updaterRunning || evolutionRunning
            ? 'running'
            : mapLast?.status === 'failed' ? 'failed'
              : mapLast ? 'done' : 'idle'
        // The newest of the scene's last draw, the library's (60-bis) and a portrait's (61) says done or failed.
        const pictureLast = [sceneDrawLast, libraryDrawLast, autoDrawLast]
            .filter((r): r is NonNullable<typeof r> => !!r)
            .sort((a, b) => String(b.at).localeCompare(String(a.at)))[0]
        const picture: HeadLightState = sceneDrawing || libraryDrawing || autoDrawing
            ? 'running'
            : pictureLast?.outcome === 'failed' ? 'failed'
              : pictureLast ? 'done' : 'idle'
        return { tracker, agent, world, map, picture }
    }

    /** The light's title, in words, so a hover says what the colour means. */
    function headWords(key: HeadLightKey, state: HeadLightState): string {
        const name = { tracker: 'Tracker', agent: 'Lorebook agent', world: 'World Progression', map: 'The map', picture: 'The scene picture' }[key]
        if (key === 'picture') {
            // A draw, not a pass (49-bis): its own words, and the Scene fold named.
            if (state === 'running') {
                if (sceneDrawing) return `${name}: drawing ${sceneDrawing.path.split(' :: ').pop() || 'the place'} now, since ${clock(sceneDrawing.at)}`
                if (libraryDrawing) return `${name}: drawing the photo of ${libraryDrawing.name || 'a card'} now, since ${clock(libraryDrawing.at)}`
                return `${name}: drawing the portrait of ${autoDrawing?.name || 'someone'} now${autoDrawing ? `, since ${clock(autoDrawing.at)}` : ''}`
            }
            if (state === 'failed') {
                // The newest failed draw says where its reason is.
                const newest: Array<{ where: string; at: string }> = []
                if (sceneDrawLast) newest.push({ where: 'Scene fold', at: String(sceneDrawLast.at) })
                if (libraryDrawLast) newest.push({ where: 'NPC library', at: String(libraryDrawLast.at) })
                if (autoDrawLast) newest.push({ where: 'Portraits in play', at: String(autoDrawLast.at) })
                const where = newest.sort((a, b) => b.at.localeCompare(a.at))[0]?.where ?? 'Scene fold'
                return `${name}: the last draw failed — open the ${where} for why`
            }
            if (state === 'done') return `${name}: the last draw is done`
            return `${name}: nothing has been drawn in this chat yet`
        }
        if (state === 'running') {
            const since = key === 'tracker' ? running?.at
                : key === 'agent' ? agentRunning?.at
                  : key === 'world' ? (worldRunning?.at ?? skeletonRunning?.at)
                    : (architectRunning?.at ?? updaterRunning?.at ?? evolutionRunning?.at)
            return `${name}: running now${since ? `, since ${clock(since)}` : ''}`
        }
        if (state === 'failed') return `${name}: the last pass failed — open the fold for why`
        if (state === 'done') return `${name}: the last pass is done`
        return `${name}: nothing has run in this chat yet`
    }

    /** Draw the head: the lights and the tracker's last-run time. */
    function drawHead(): void {
        const states = headStates()
        for (const key of ['tracker', 'agent', 'world', 'map', 'picture'] as const) {
            const node = lightEls[key]
            for (const state of ['idle', 'running', 'done', 'failed'] as const) {
                node.classList.toggle(`lh-light--${state}`, states[key] === state)
            }
            node.title = headWords(key, states[key])
            node.setAttribute('aria-label', node.title)
        }
        headTime.textContent = running
            ? `running since ${clock(running.at)}`
            : lastReport
              ? `${clock(lastReport.at)}, ${ago(lastReport.at)}`
              : 'no pass yet'
        headTime.title = running
            ? 'When the pass now running started'
            : lastReport ? 'When the tracker last ran in this chat' : 'The tracker has not run in this chat'
    }

    function drawReport(pass: TrackerPassReportDTO | undefined): void {
        lastReport = pass
        drawHead()
        // A new report puts the select back on the last pass: the box shows
        // what just happened, whatever was being read before.
        reportHistorySelect.value = ''
        paintReport(pass, false)
    }

    /** The report box: the pass given, which is the last one or an earlier one from the history (47e). */
    function paintReport(pass: TrackerPassReportDTO | undefined, earlier: boolean): void {
        report.replaceChildren()
        if (earlier) {
            const note = el('div', { class: 'lh-report-earlier' })
            note.textContent = 'An earlier pass, from the history. The first choice in the list is the last pass.'
            report.append(note)
        }

        // Says which pass the box below is about, whenever that is not the one
        // the user is waiting on.
        if (running) {
            const note = el('div', { class: 'lh-tracker-report-running' })
            const started = clock(running.at)
            const since = started ? ` (started ${started})` : ''
            const words = el('span')
            words.textContent =
                (running.trigger === 'direct'
                    ? `A pass is running now on your instruction${since}.`
                    : running.trigger === 'manual'
                      ? `A pass is running now${since}.`
                      : `A pass is running now, after the last reply${since}.`) +
                (pass ? ' Below is the previous one.' : '')
            note.append(words, stopTrackerButton)
            report.append(note)
        }

        if (!pass) {
            if (!running) report.textContent = 'The tracker has not run for this chat yet.'
            report.className = `lh-tracker-report lh-tracker-report--idle${running ? ' lh-tracker-report--stale' : ''}`
            return
        }

        const stamped = when(pass.at)
        // A pass the user instructed says so: a change the story did not
        // contain would otherwise read as the tracker's own idea.
        const ran = pass.trigger === 'direct' ? `Tracker ran ${stamped} on your instruction` : `Tracker ran ${stamped}`
        const headline =
            pass.status === 'updated'
                ? `${ran} and ${describeBlocks(pass)}.`
                : pass.status === 'no-change'
                  ? `${ran} and changed nothing.`
                  : pass.status === 'skipped'
                    ? `Tracker skipped ${stamped}.`
                    : pass.status === 'cancelled'
                      // Not "failed". The user pressed Stop; a red line for a
                      // button they chose is Phase 1d's confusion in a new
                      // place.
                      ? `Tracker stopped ${stamped}.`
                      : `Tracker failed ${stamped}.`

        const line = el('div')
        line.textContent = headline
        // The full local date and time, for the one case the line cannot cover:
        // reconciling a pass with a chat log days later.
        const exact = new Date(pass.at)
        if (!Number.isNaN(exact.getTime())) line.title = exact.toLocaleString()
        report.append(line)

        if (pass.reason && pass.status !== 'updated') {
            const why = el('div', { class: 'lh-tracker-report-why' })
            why.textContent = pass.reason
            report.append(why)
        }

        // The model's own words, when it produced something we could not use.
        // This is what tells a refusal apart from a wrong output format.
        if (pass.sample) {
            const details = el('details', { class: 'lh-tracker-sample' })
            const summary = el('summary')
            summary.textContent = 'What the tracker model replied'
            const pre = el('pre')
            pre.textContent = pass.sample
            details.append(summary, pre)
            report.append(details)
        }

        report.className =
            `lh-tracker-report lh-tracker-report--${pass.status}` + (running ? ' lh-tracker-report--stale' : '') + (earlier ? ' lh-tracker-report--earlier' : '')
    }

    /** One line naming a tracker pass for the history's list. */
    function trackerHistoryLabel(pass: TrackerPassReportDTO): string {
        const what = pass.status === 'updated' ? describeBlocks(pass)
            : pass.status === 'no-change' ? 'no change'
              : pass.status === 'skipped' ? `skipped${pass.reason ? `: ${pass.reason}` : ''}`
                : pass.status === 'cancelled' ? 'stopped'
                  : `failed${pass.reason ? `: ${pass.reason}` : ''}`
        return `${clock(pass.at) || pass.at} \u2014 ${what}${pass.trigger === 'direct' ? ' (on your instruction)' : ''}`
    }

    /** One line naming an agent pass for the history's list. */
    function agentHistoryLabel(result: AgentRunResult): string {
        const written = result.write ? result.write.changed.length + result.write.deleted.length : 0
        const what = result.outcome === 'committed' ? `${written} ${written === 1 ? 'entry' : 'entries'} written or deleted`
            : result.outcome === 'no-commit' ? 'nothing to write'
              : result.outcome === 'cancelled' ? 'stopped'
                : result.outcome === 'unreadable' ? 'an unreadable reply'
                  : 'failed'
        return `${clock(result.at) || result.at} \u2014 ${what}`
    }

    /** Fill a history select from a list, keeping the first choice for the last pass. */
    function fillHistory(select: HTMLSelectElement, row: HTMLElement, labels: string[]): void {
        const keep = select.value
        select.replaceChildren()
        const last = el('option', { value: '' })
        last.textContent = 'The last pass'
        select.append(last)
        labels.forEach((label, index) => {
            const option = el('option', { value: String(index) })
            option.textContent = label
            select.append(option)
        })
        select.value = keep !== '' && Number(keep) < labels.length ? keep : ''
        row.hidden = labels.length === 0
    }

    /** The newest first, the same report once, thirty kept: what the backend's history does, done here so an event needs no round trip. */
    function foldReport<T extends { at: string }>(list: T[], item: T): T[] {
        const same = (a: T, b: T): boolean => a.at === b.at && JSON.stringify(a) === JSON.stringify(b)
        if (list[0] && same(list[0], item)) return list
        return [item, ...list.filter((entry) => !same(entry, item))].slice(0, 30)
    }

    /** A pass just finished: put its report at the front of the list without asking the backend (47e). */
    function noteTrackerReport(pass: TrackerPassReportDTO | undefined): void {
        if (!pass) return
        reportHistory = { ...reportHistory, tracker: foldReport(reportHistory.tracker, pass) }
        fillHistory(reportHistorySelect, reportHistoryRow, reportHistory.tracker.map(trackerHistoryLabel))
    }

    function noteAgentReport(result: AgentRunResult | null): void {
        if (!result || result.unavailable) return
        reportHistory = { ...reportHistory, agent: foldReport(reportHistory.agent, result) }
        fillHistory(agentHistorySelect, agentHistoryRow, reportHistory.agent.map(agentHistoryLabel))
    }

    /** Read the earlier passes of both from the backend (47e). Best effort: a failed read leaves the lists as they are. */
    async function loadReports(): Promise<void> {
        const forChat = chatId
        if (!forChat) return
        const result = await bridge.request<ReportsHistoryResult>('reports.history', { chatId: forChat })
        if (destroyed || chatId !== forChat) return
        reportHistory = { tracker: result.tracker ?? [], agent: result.agent ?? [] }
        fillHistory(reportHistorySelect, reportHistoryRow, reportHistory.tracker.map(trackerHistoryLabel))
        fillHistory(agentHistorySelect, agentHistoryRow, reportHistory.agent.map(agentHistoryLabel))
        // The agent's footer reads Last run from the history too (78b).
        drawAgentFooter()
    }

    /**
     * An earlier pass picked from the history (47e-bis): the box paints
     * its report, and the cards step to the memo as it stood after it, so
     * what the pass did and what it left read together. The last pass puts
     * both back to live. A pass older than the memo history keeps paints
     * its report alone and says so, leaving the stepper where it was.
     */
    async function showEarlierPass(chosen: TrackerPassReportDTO | undefined): Promise<void> {
        if (!chosen) {
            paintReport(lastReport, false)
            historyIndex = LIVE
            restoreArmed = false
            draw()
            return
        }
        // Re-read before stepping, as Older does: passes land while the panel is open.
        if (historyIndex === LIVE) await loadHistory()
        if (destroyed) return
        const index = indexAt(history, chosen.at)
        paintReport(chosen, true)
        if (index === null) {
            const note = el('div', { class: 'lh-report-earlier lh-report-earlier--unmatched' })
            note.textContent = 'The cards cannot show the memo after this pass: it is older than the memo history keeps.'
            report.append(note)
            return
        }
        // The state after that pass; the live memo when it is still what stands.
        historyIndex = history[index]!.memo === memo ? LIVE : index
        restoreArmed = false
        draw()
    }

    /** Redraw the box from the report already in hand — for a change of run state. */
    function redrawReport(): void {
        drawReport(lastReport)
    }

    /**
     * The live line beside the Tracker heading.
     *
     * `busy` is not cosmetic: it is the only thing on screen that says work is
     * happening *now*, as against the report box, which is always history. The
     * two are deliberately different shapes — a message here, a box below — so
     * that a running pass cannot be read as a finished one.
     */
    /** Show a failure, and keep showing it. */
    function reportProblem(message: string): void {
        problemText.textContent = message
        problem.hidden = false
    }

    function clearProblem(): void {
        problemText.textContent = ''
        problem.hidden = true
    }

    /** The four display preferences read off a set; true when any moved. */
    function readDisplayPrefs(prefs: Record<string, unknown>): boolean {
        const next = {
            portraits: typeof prefs.portraitsEnabled === 'boolean' ? prefs.portraitsEnabled : portraitsEnabled,
            total: typeof prefs.inventoryShowTotal === 'boolean' ? prefs.inventoryShowTotal : inventoryDisplay.showTotal,
            mode: prefs.inventoryWorthMode === 'display' || prefs.inventoryWorthMode === 'hover' ? prefs.inventoryWorthMode : inventoryDisplay.worthMode,
            xpBar: typeof prefs.xpBarAtBottom === 'boolean' ? prefs.xpBarAtBottom : xpBarAtBottom,
            layout: prefs.panelLayoutMode === 'tabs' || prefs.panelLayoutMode === 'stack' ? prefs.panelLayoutMode : panelLayoutMode,
            tab: typeof prefs.trackerActiveTab === 'string' ? prefs.trackerActiveTab : activeTab,
            animate: typeof prefs.animateAllCustomBarChanges === 'boolean' ? prefs.animateAllCustomBarChanges : animateCustomBars,
            groups: {
                groups: prefs.displayGroups !== undefined ? readDisplayGroups(prefs.displayGroups) : displayGroups.groups,
                enabled: typeof prefs.displayGroupsEnabled === 'boolean' ? prefs.displayGroupsEnabled : displayGroups.enabled,
                showGaps: typeof prefs.displayGroupsShowGaps === 'boolean' ? prefs.displayGroupsShowGaps : displayGroups.showGaps,
            },
        }
        const groupsMoved = JSON.stringify(next.groups) !== JSON.stringify(displayGroups)
        const moved = next.portraits !== portraitsEnabled || next.total !== inventoryDisplay.showTotal || next.mode !== inventoryDisplay.worthMode || next.xpBar !== xpBarAtBottom || next.animate !== animateCustomBars || groupsMoved || next.layout !== panelLayoutMode || next.tab !== activeTab
        portraitsEnabled = next.portraits
        inventoryDisplay = { showTotal: next.total, worthMode: next.mode }
        xpBarAtBottom = next.xpBar
        animateCustomBars = next.animate
        displayGroups = next.groups
        panelLayoutMode = next.layout
        activeTab = next.tab
        return moved
    }

    function say(message: string, tone: 'ok' | 'error' | 'busy' = 'ok'): void {
        status.textContent = message
        status.classList.toggle('lh-tracker-status-error', tone === 'error')
        status.classList.toggle('lh-tracker-status-busy', tone === 'busy')
    }

    /** What the header should say while a pass is in flight. */
    function busyMessage(): string {
        return running?.trigger === 'direct'
            ? 'Running the tracker with your instruction… this takes about as long as a reply does.'
            : running?.trigger === 'manual'
              ? 'Running the tracker… this takes about as long as a reply does.'
              : 'The tracker is updating after the last reply…'
    }

    function fail(error: unknown): void {
        // On the line nothing overwrites, not the one every pass clears.
        reportProblem(error instanceof Error ? error.message : String(error))
    }

    /**
     * Draw the cards.
     *
     * `innerHTML` is deliberate and safe here: every string in that markup went
     * through `escapeHtml`/`escapeHtmlWithColor` on the way in, and the only
     * tags that survive are the ones the renderer wrote. Building the same tree
     * node by node would mean reimplementing the renderer twice — and the
     * renderer has to emit a string anyway, because that is what
     * `ctx.messages.renderWidget()` takes.
     */
    function draw(): void {
        instantFold.setChat(chatId, !memo.trim())
        creatorFold.setChat(chatId, !memo.trim())
        // The starting area (69): open for a chat with no memo, folded for one with an adventure under way,
        // decided as the chat changes and left to the hand after.
        if (startGroupChat !== chatId) {
            startGroupChat = chatId
            startGroup.open = !!chatId && !memo.trim()
        }
        if (playerCardChat !== chatId) { playerCardChat = chatId; playerCardFold.setChat(chatId); waysFold.setChat(chatId); importFold.setChat(chatId); libraryFold.setChat(chatId); npcFold.setChat(chatId); sceneFold.setChat(chatId); recordsFold.setChat(chatId); terminalFold.setChat(chatId); sandboxFold.setChat(chatId); evoResetAt = null; detailsModal?.close(); if (activationChat !== chatId) { activation = null; activationChat = chatId; drawActivation() } }
        const position = readPosition(history, historyIndex, memo)
        // The cards show whatever the stepper is pointing at. The live memo is
        // untouched by looking — nothing is written until a restore.
        const showing = position.entry ? position.entry.memo : memo
        drawHistoryRow(position)
        // The phase of the memo on screen — stepped or live, as the cards are — on the body, and the badge in the head.
        applyDayNightPhase(root.ownerDocument.body, showing)
        skySlot.innerHTML = renderDayNightBadge(currentClockFromMemo(showing))
        const view = buildTrackerView(showing, { ...current, portraits: portraitsEnabled ? portraits : {}, bars, animateCustomBars }, archivedQuests)
        lastView = view
        // The animated bars (74h): what the bars and the XP row showed before this redraw, compared after it within one chat and stepper position, as the legacy does.
        const animationContext = barAnimationContext(chatId, historyIndex)
        const xpHost = xpBarAtBottom ? bottomXp : cards
        const captured = captureBarAnimations(cards, xpHost, animationContext)
        // Tab Mode (76): Character and Combat pinned, the vitals strip, the rest behind the strip; the stacked cards otherwise.
        const cardOptions = { collapsed, partyCompact, partyCompactButton: true, inventory: inventoryDisplay, xpBarAtBottom, bars, displayGroups }
        cards.innerHTML = panelLayoutMode === 'tabs'
            ? renderTabModeHtml(view, { ...cardOptions, tabMode: { activeTab, portraits: portraitsEnabled ? portraits : {} } })
            : renderTrackerHtml(view, cardOptions)
        cards.classList.toggle('lh-tracker-cards--tabs', panelLayoutMode === 'tabs')
        drawFootClock(showing)
        footTokens.textContent = `~${memoTokenEstimate(showing)} tokens`
        drawChangeLog()
        // The XP bar at the bottom (74f): the row from the memo on screen, or nothing and the bar hidden.
        const bottomXpHtml = xpBarAtBottom ? renderBottomXpBar(view, bars) : ''
        bottomXp.innerHTML = bottomXpHtml
        bottomXp.hidden = !bottomXpHtml
        playBarAnimations(cards, xpHost, captured, animationContext)
        syncArchiveButton()
        drawPortraitEditor(view)
        bindRecolor(cards)
    }

    /**
     * Whether the clear button is armed — the second press does it.
     *
     * Clearing cannot be undone: the quests are gone from the memo already, so
     * there is nothing to restore them from. A single click is the wrong shape
     * for that, and a confirm dialog is not something this panel has. So the
     * button says what it is about to do and waits to be pressed again.
     */
    let clearArmed = false

    /**
     * Draw the stepper: where it is, and which way it may move.
     *
     * The restore button appears only when a past state is on screen. Live is
     * already the live state, and a button offering to restore it would be one
     * more thing to read past.
     */
    function drawHistoryRow(position: ReturnType<typeof readPosition>): void {
        historyRow.hidden = false
        historyLabel.textContent = position.index === LIVE ? '[ LIVE ]' : describePosition(position, clock)
        historyLabel.title = position.index === LIVE ? 'The live state; \u2190 steps into the history' : describePosition(position, clock)
        historyBack.hidden = history.length === 0 && position.index === LIVE
        historyForward.hidden = historyBack.hidden
        historyRow.classList.toggle('lh-tracker-history--past', position.index !== LIVE)
        historyBack.disabled = !position.canGoBack
        historyForward.disabled = !position.canGoForward
        historyRestore.hidden = position.index === LIVE
        if (position.index === LIVE) restoreArmed = false
        historyRestore.textContent = restoreArmed
            ? 'Replace the live tracker?'
            : 'Restore this state'
        historyRestore.classList.toggle('lh-button--danger', restoreArmed)

        const past = position.index !== LIVE
        rawHistoryNote.hidden = !past
        rawText.readOnly = past
        saveButton.disabled = past
        revertButton.disabled = past
    }

    /** Load the stored states, so the stepper has something to step through. */
    async function loadHistory(): Promise<void> {
        if (!chatId) {
            history = []
            historyIndex = LIVE
            return
        }
        try {
            const result = await bridge.request<TrackerHistoryResult>('tracker.history', { chatId })
            if (destroyed) return
            history = result.snapshots ?? []
        } catch {
            // A stepper that cannot load is a stepper that hides itself. The
            // tracker is still perfectly usable without it.
            history = []
        }
        historyIndex = LIVE
    }

    /** Move the stepper, and redraw the cards at the new position. */
    async function stepTo(direction: 'back' | 'forward'): Promise<void> {
        // Re-read before the first step away from live: passes land while the
        // panel is open, and stepping into a stale list shows the wrong turn.
        if (historyIndex === LIVE) await loadHistory()
        historyIndex = stepHistory(history, historyIndex, direction, memo)
        restoreArmed = false
        draw()
    }

    /**
     * Write the state on screen back as the live memo, in two presses.
     *
     * A restore is a write over live state, so it says what it is about to
     * replace before replacing it — the same shape as clearing the archive, and
     * for the same reason: this panel has no confirm dialog.
     *
     * It names the *message*, never the position. The history is capped and
     * every tracked turn pushes an entry in, so an index read a minute ago can
     * point somewhere else by the time the button is pressed.
     */
    async function restoreState(): Promise<void> {
        const position = readPosition(history, historyIndex, memo)
        if (!position.entry) return
        if (!chatId) {
            say('No chat open.', 'error')
            return
        }

        if (!restoreArmed) {
            restoreArmed = true
            drawHistoryRow(position)
            say(
                `This replaces the live tracker with the state from `
                + `${describePosition(position, clock).toLowerCase()}. Press again to confirm.`,
            )
            return
        }

        restoreArmed = false
        const result = await bridge.request<TrackerResult>('tracker.restore', {
            chatId,
            messageId: position.entry.messageId,
        })
        if (result.memo !== memo) {
            liveChangeLog = memoChangeLog(memo, result.memo)
            changeLogCleared = false
        }
        memo = result.memo
        archivedQuests = result.archivedQuests ?? archivedQuests
        historyIndex = LIVE
        draw()
        say('Restored. The tracker now shows that state.')
    }

    /** Take the clear button out of its armed state, wherever we are. */
    function disarmClear(): void {
        if (!clearArmed) return
        clearArmed = false
        syncArchiveButton()
    }


    /** Show the clear button only when there is an archive to clear. */
    function syncArchiveButton(): void {
        const count = archivedQuests.length
        archiveActions.hidden = count === 0
        clearArchiveButton.hidden = count === 0
        if (!count) clearArmed = false
        clearArchiveButton.textContent = clearArmed
            ? `Really clear ${count} finished quest${count === 1 ? '' : 's'}?`
            : `Clear finished quests (${count})`
        clearArchiveButton.classList.toggle('lh-button--danger', clearArmed)
    }

    /**
     * Empty the archive, in two presses.
     *
     * Disarmed by any other panel action that redraws, because an armed button
     * left sitting there is a trap: the user comes back to the panel, presses
     * what they think is a first click, and loses the log.
     */
    async function clearArchive(): Promise<void> {
        if (!chatId) {
            say('No chat open.', 'error')
            return
        }

        if (!clearArmed) {
            clearArmed = true
            syncArchiveButton()
            say('Clearing finished quests cannot be undone. Press again to confirm.')
            return
        }

        clearArmed = false
        const result = await bridge.request<TrackerResult>('tracker.clearArchive', { chatId })
        archivedQuests = result.archivedQuests ?? []
        memo = result.memo
        draw()
        say('Finished quests cleared.')
    }

    /**
     * Fold a card away, or open it.
     *
     * Delegated rather than bound per header, because `draw()` replaces the
     * whole subtree on every tracker event — a listener attached to a header
     * would be thrown away with it. The set of folded tags lives out here for
     * the same reason: it has to survive the redraw that a fold does not cause.
     *
     * Not persisted. A fold is a glance-management gesture, and reloading the
     * panel to a state you set an hour ago and forgot is worse than starting
     * open. The quest archive is the exception and starts folded, because it is
     * history rather than a workload; the renderer decides that, not this.
     */
    function toggle(target: EventTarget | null): void {
        if (!(target instanceof Element)) return
        // A portrait on an entity card opens large (Phase 64) and folds nothing.
        const picture = zoomTarget(target)
        if (picture) {
            enlarge?.(picture.src, picture.title, portraitActions(picture.title))
            return
        }
        // The PARTY card's Compact button sits in its header: it flips the
        // mode, not the fold, and the preference follows so the cards under
        // the messages and the next session draw the same.
        if (target.closest('.rt-party-compact-btn')) {
            partyCompact = !partyCompact
            draw()
            bridge.request<PrefsResult>('prefs.patch', { patch: { partyCompact } }).catch(() => undefined)
            return
        }
        // Tab Mode (76): a tab button shows its pane; a member of the vitals strip jumps to the PARTY tab.
        const tabButton = target.closest('.rt-tab-btn[data-tag]')
        if (tabButton) { chooseTab(tabButton.getAttribute('data-tag') ?? ''); return }
        const jump = target.closest('.rt-vitals-member[data-jump-tag]')
        if (jump) { chooseTab(jump.getAttribute('data-jump-tag') ?? ''); landOnEntity(jump.getAttribute('data-jump-entity')); return }
        const header = target.closest('.rt-section-header')
        const section = header?.parentElement
        const tag = section?.getAttribute('data-tag')
        if (!tag) return

        if (collapsed.has(tag)) collapsed.delete(tag)
        else collapsed.add(tag)
        draw()
    }

    async function refresh(): Promise<void> {
        if (destroyed) return

        const previousChat = chatId
        chatId = host.getActiveChat().chatId
        // A chat the backend could not name for want of a card is asked again
        // here, on a chat event or a Refresh (51-bis) — not on a redraw, which
        // the answer itself causes.
        // (No prefs guard: a chat is in the set only after an ask, and an ask
        // waits for the prefs. A mutation found the guard dead.)
        if (chatId && nameAgain.delete(chatId)) {
            namingAsked.delete(chatId)
            nameCampaign()
        }
        // Belongs to the chat it was asked about, and to no other.
        if (chatId !== previousChat) {
            agentReport = null
            agentButton.textContent = 'Run the agent now'
            drawAgent()
            drawCampaign()
            // The books belong to the chat (55): read again for the new one when the fold is open.
            books = null
            booksLast = null
            drawBooks()
            refreshBooks()
            // A failure belongs to the chat it happened in. Left up, it would
            // sit under a different chat's heading describing something that
            // never happened there — the rule every other section here follows.
            clearProblem()
            // The world's clock is per chat too, and so is the skeleton's source.
            worldStatus = null
            worldRunning = null
            skeletonRunning = null
            skeletonSource.value = ''
            worldBooks = null
            worldPurgeNote.textContent = ''
            drawWorld()
            mapStatus = null
            picture.clear()
            architectRunning = null
            // The picture's light belongs to the chat it was drawn in (49-bis).
            sceneDrawing = null
            sceneDrawLast = null
            libraryDrawing = null
            libraryDrawLast = null
            autoDrawing = null
            autoDrawLast = null
            portraitAuto = emptyPortraitAuto()
            drawMaps()
        }
        // A pass in flight belongs to the chat it was started for; moving away
        // from that chat means this panel is no longer waiting on anything.
        if (chatId !== previousChat) running = null

        // The Change Log is the chat's (78d): live again on another, read off its history when opened.
        if (chatId !== previousChat) { liveChangeLog = null; changeLogCleared = false }
        if (!chatId) {
            memo = ''
            archivedQuests = []
            history = []
            historyIndex = LIVE
            rawText.value = ''
            draw()
            say('No chat open.')
            return
        }

        // The chat can go while this loads — a reload's chat events come
        // in a burst, one of them with no chat — and a load that went on
        // asked for the gone chat's portraits with no chat at all (56-bis).
        // Everything after an await belongs to the chat it was asked for.
        const startedFor = chatId
        say('Loading…')
        const result = await bridge.request<TrackerResult>('tracker.get', { chatId })
        if (destroyed || chatId !== startedFor) return

        memo = result.memo
        archivedQuests = result.archivedQuests ?? []
        // Not awaited: the world fold fills in on its own and must not hold
        // the tracker view back.
        loadWorld().catch(() => undefined)
        loadMaps().catch(() => undefined)
        clearArmed = false
        restoreArmed = false
        // Back to live on every refresh. A stepper left pointing into the past
        // across a chat change or a new pass would be showing one chat's state
        // under another's heading.
        historyIndex = LIVE
        await loadHistory()
        if (destroyed || chatId !== startedFor) return
        try {
            portraits = (await bridge.request<PortraitsResult>('portraits.get', { chatId })).portraits ?? {}
        } catch {
            // A missing picture is not worth failing the memo read over.
            portraits = {}
        }
        if (destroyed || chatId !== startedFor) return
        // What is being drawn for this chat (61); the ask is also the backend's first look at the chat, which seeds it.
        try {
            portraitAuto = await bridge.request<PortraitAutoStatus>('portraits.auto.status', { chatId })
        } catch {
            portraitAuto = emptyPortraitAuto()
        }
        if (destroyed || chatId !== startedFor) return
        const inFlight = portraitAuto.drawing[0]
        if (inFlight) autoDrawing = { name: inFlight.name, at: inFlight.at || new Date().toISOString() }
        rawText.value = memo
        draw()
        drawReport(result.lastPass)
        loadReports().catch(() => undefined)
        // A pass that started while this was loading is still the more useful
        // thing to say; the memo it is about to write is the reason to wait.
        if (running) say(busyMessage(), 'busy')
        else say(memo.trim() ? '' : 'No tracker state for this chat yet.')
    }

    /**
     * Run a pass on demand.
     *
     * The button is disabled while it runs — a tracker call is a full model
     * round trip, and a second press would queue a second one behind it.
     *
     * Running out of time waiting is not the same as failing, and this is the
     * only place in the panel where the difference matters. A tracker pass is a
     * generation: it can take longer than any deadline this side is willing to
     * hold a button for, and the backend keeps going regardless — it will emit
     * `tracker.changed` when it lands. So a timeout here reports that the pass
     * is still going, and leaves the subscription to bring back the result.
     * Reporting it as an error instead is what made a working tracker look
     * broken.
     */
    async function runNow(instruction?: string): Promise<void> {
        if (!chatId) {
            say('No chat open.', 'error')
            return
        }

        const startedFor = chatId
        disarmClear()
        runButton.disabled = true
        trackerBar.setBusy(true)
        running = { at: new Date().toISOString(), trigger: instruction ? 'direct' : 'manual' }
        redrawReport()
        say(busyMessage(), 'busy')
        try {
            const result = instruction
                ? await bridge.request<TrackerResult>('tracker.instruct', { chatId, instruction })
                : await bridge.request<TrackerResult>('tracker.run', { chatId })
            if (destroyed || chatId !== startedFor) return
            running = null
            memo = result.memo
            if (result.archivedQuests) archivedQuests = result.archivedQuests
            if (rawText.value !== memo) rawText.value = memo
            draw()
            drawReport(result.lastPass)
            say('')
        } catch (error) {
            if (!(error instanceof RequestTimeoutError)) {
                running = null
                redrawReport()
                // The failure itself goes to the problem line, which nothing
                // overwrites — so the busy notice has to be taken down here.
                // It used to be replaced by the error landing on top of it.
                say('')
                throw error
            }
            // Still running, as far as anyone here knows. `running` stays set,
            // so the report below stays marked as the previous pass until the
            // real one arrives.
            if (destroyed) return
            say(
                'The tracker is taking longer than the panel waits. It is still running — ' +
                    'this will fill in on its own when it finishes.',
                'busy',
            )
        } finally {
            runButton.disabled = false
            trackerBar.setBusy(false)
        }
    }

    /** Every entity the memo currently names, in the order the cards draw them. */
    function entitiesInView(view: ReturnType<typeof buildTrackerView>): string[] {
        const names: string[] = []
        const seen = new Set<string>()

        for (const block of view.blocks.concat(view.benchedParty ? [view.benchedParty] : [])) {
            if (!ENTITY_TAGS.has(block.tag) || !block.entities) continue
            for (const token of block.entities.tokens) {
                if (token.kind !== 'entity') continue
                const name = token.entity.name
                if (seen.has(name)) continue
                seen.add(name)
                names.push(name)
            }
        }
        return names
    }

    /**
     * Draw one row per entity: its picture, its name, and a way to change it.
     *
     * Rebuilt whenever the cards are, because the cast changes with the story.
     * The summary carries a count so the fold says whether there is anything in
     * it without being opened.
     */
    function drawPortraitEditor(view: ReturnType<typeof buildTrackerView>): void {
        const names = entitiesInView(view)
        // Never hidden since 61: the drawing's switches live in the fold, and an NPC may be drawn with nobody in play.
        portraitSummary.textContent = `Portraits in play (${names.length})`
        portraitList.replaceChildren()

        for (const name of names) {
            const row = el('div', { class: 'lh-portrait-row' })

            // The reference as stored, and the reference as it may be drawn.
            // They are deliberately read separately: everything this row has to
            // say about a portrait that is not on screen lives in the gap
            // between them.
            const stored = lookupPortrait(portraits, name)
            const src = portraitFor(portraits, name)
            const problem = portraitProblem(stored)

            /** The dashed box a row shows instead of a picture. */
            const placeholder = (mark: string): HTMLSpanElement => {
                const span = el('span', { class: 'lh-portrait-thumb lh-portrait-thumb--empty' })
                span.textContent = mark
                return span
            }

            const thumb: HTMLElement = src
                ? el('img', { class: 'lh-portrait-thumb', src, alt: '' })
                : placeholder(problem === 'unusable' ? '!' : '—')
            zoomable(thumb, src, name, enlarge, () => portraitActions(name))

            const labels = el('div', { class: 'lh-portrait-labels' })
            const label = el('span', { class: 'lh-portrait-name' })
            label.textContent = name
            const note = el('span', { class: 'lh-portrait-note' })
            labels.append(label, note)

            /**
             * Say what is wrong with this row, or nothing at all.
             *
             * The stored reference goes in the note verbatim when there is a
             * problem with it. It is the one thing nothing on screen has ever
             * shown, and it is the answer to "I set a picture and nothing
             * happened" — which cost a phase to notice and cannot be worked out
             * from anywhere else in the panel.
             */
            const complain = (message: string): void => {
                note.textContent = message
                row.classList.add('lh-portrait-row--problem')
            }

            const failure = portraitErrors.get(name)
            if (failure) complain(`could not be set — ${failure}`)
            else if (problem === 'unusable') complain(`stored, but not an address this build will draw — ${stored}`)

            // The draw (61): in flight, waiting, or what the last one did, in the same note.
            const key = normalizeEntityName(name)
            const sameName = (other: string) => normalizeEntityName(other).localeCompare(key, undefined, { sensitivity: 'accent' }) === 0
            const inFlight = portraitAuto.drawing.find((d) => sameName(d.name))
            const ahead = portraitAuto.queued.findIndex((n) => sameName(n))
            const lastDraw = Object.entries(portraitAuto.last).find(([stored]) => sameName(stored))?.[1]
            if (inFlight) note.textContent = `drawing now${inFlight.at ? `, since ${clock(inFlight.at)}` : ''}…`
            else if (ahead >= 0) note.textContent = `queued to be drawn${ahead ? ` (${ahead} ahead)` : ''}`
            else if (!failure && problem !== 'unusable' && lastDraw) {
                if (lastDraw.outcome === 'drawn') note.textContent = `drawn by ${lastDraw.provider} (${lastDraw.model})${lastDraw.size ? `, ${lastDraw.size}` : ''}`
                else complain(`could not be drawn — ${lastDraw.reason ?? 'no reason given'}`)
            }

            // An address we are willing to draw is not an address the host will
            // serve. A 404 or a refused request leaves a broken image and no
            // explanation, so the row asks the browser and reports the answer.
            if (src) {
                thumb.addEventListener('error', () => {
                    // Swapped rather than restyled: an `<img>` whose source
                    // failed keeps the browser's own broken-image glyph, which
                    // is the least informative thing that could be on screen
                    // beside a row that is about to explain itself.
                    thumb.replaceWith(placeholder('!'))
                    complain(`stored, but the picture did not load — ${src}`)
                })
            }

            const pick = el('button', { type: 'button', class: 'lh-button' })
            pick.textContent = stored ? 'Change' : 'Set image'
            pick.disabled = !host.uploads
            pick.title = host.uploads ? '' : 'This build has no file picker.'
            pick.addEventListener('click', () => { pickPortrait(name).catch(fail) })

            // Drawn through the host's image generation (61), whatever the switches say.
            const drawButton = el('button', { type: 'button', class: 'lh-button', 'aria-label': `Draw the portrait of “${name}”` })
            drawButton.textContent = '🎨 Draw'
            drawButton.title = 'Write an image prompt from the memo (an NPC from their entry) and draw the portrait on the image connection under Drawing the portraits.'
            drawButton.disabled = !!inFlight || ahead >= 0
            drawButton.addEventListener('click', () => { drawPortrait(name).catch(fail) })

            row.append(thumb, labels, pick, drawButton)

            // Offered whenever something is *stored*, not whenever something is
            // drawn: a reference this build refuses is exactly the one a user
            // most needs to be able to clear.
            if (stored) {
                const remove = el('button', { type: 'button', class: 'lh-button' })
                remove.textContent = 'Remove'
                remove.addEventListener('click', () => { setPortrait(name, '').catch(fail) })
                row.append(remove)
            }

            portraitList.append(row)
        }
    }

    /**
     * The recolour popup (74i): Multihog's `handleRecolor`, sliced from the
     * pin, through the one binding the cards under the messages share
     * (74i-ter), over the legacy's own settings shape.
     */
    const recolor = createRecolorBinding({
        document: root.ownerDocument,
        patch: async (patch) => (await bridge.request<PrefsResult>('prefs.patch', { patch: { bars: patch } })).prefs?.bars,
        redraw: (next) => {
            bars = next
            draw()
        },
        fail,
    })

    /** Take the store's bars as the legacy's map and the typed preferences both. */
    function takeBars(next: BarPrefs | undefined): void {
        bars = recolor.take(next).bars
    }

    /** A click on any bar's recolour handle opens the legacy's popup over it, as its card events bind it. */
    function bindRecolor(scope: HTMLElement): void {
        recolor.bind(scope)
    }

    /**
     * Run one portrait write, and leave the row saying what happened.
     *
     * The failure is recorded against the entity and redrawn with it, so it
     * survives the next tracker event instead of being wiped by it.
     */
    async function writePortrait(name: string, write: () => Promise<PortraitsResult>): Promise<void> {
        if (!chatId) {
            say('No chat open.', 'error')
            return
        }
        try {
            const result = await write()
            portraits = result.portraits ?? {}
            portraitErrors.delete(name)
        } catch (error) {
            portraitErrors.set(name, error instanceof Error ? error.message : String(error))
            draw()
            throw error
        }
        draw()
    }

    /** The prefix this chat's books are actually named after, right now. */
    function effectivePrefix(): string {
        return resolveCampaignPrefix({
            chatId,
            override: chatId ? campaignNames[chatId] : '',
            anchorChatId: chatId,
        })
    }

    /** The chat being named right now (51), the chats asked once this session, and the ones this session named. */
    let naming: string | null = null
    const namingAsked = new Set<string>()
    const namedHere = new Set<string>()
    /** Chats the backend could not name yet, no card being known (51-bis): asked again on the next chat event, never on a redraw. */
    const nameAgain = new Set<string>()
    /** Whether the preferences have been read: the box draws once before they are, with an empty name map, and must not mint on it. */
    let prefsRead = false

    /**
     * Name an unnamed campaign after the card and the clock (51): asked once
     * per chat per session, so a name the user clears stays cleared until a
     * reload, and a backend that cannot name leaves the hint as it was.
     */
    function nameCampaign(): void {
        const target = chatId
        if (!target || naming || namingAsked.has(target)) return
        naming = target
        namingAsked.add(target)
        const narrator = host.getActiveChat().characterId
        bridge.request<CampaignNameResult>('campaign.name', { chatId: target, ...(narrator ? { characterId: narrator } : {}) })
            .then((result) => {
                if (result.name) campaignNames = { ...campaignNames, [target]: result.name }
                else nameAgain.add(target)
                if (result.minted) namedHere.add(target)
            })
            .catch((error) => { console.warn('[AdventureTime] the campaign could not be named after the card', error) })
            .finally(() => { if (naming === target) naming = null; drawCampaign() })
    }

    /** Show the name, and what the books will be called because of it. */
    function drawCampaign(): void {
        agentTools.setChat(chatId)
        if (!chatId) {
            campaignInput.value = ''
            campaignHint.textContent = 'No chat open.'
            return
        }
        campaignInput.value = campaignNames[chatId] ?? ''
        const prefix = effectivePrefix()
        if (campaignNames[chatId]) {
            campaignHint.textContent = namedHere.has(chatId)
                ? `Named after the card and the clock. New books will be named ${prefix}_NPC, ${prefix}_LOC and so on; type another name to change that.`
                : `New books will be named ${prefix}_NPC, ${prefix}_LOC and so on.`
            return
        }
        if (naming === chatId) {
            campaignHint.textContent = 'Naming the campaign after the card and the clock…'
            return
        }
        campaignHint.textContent = `Unnamed, so books are named after the chat: ${prefix}_NPC. Give it a name to fix that.`
        if (prefsRead) nameCampaign()
    }

    /**
     * Store the name.
     *
     * Books already made keep working: ownership is recorded by name as they
     * are created, and that list outranks the prefix. Only new books take the
     * new name — said out loud in the hint rather than left to be discovered.
     */
    async function saveCampaignName(): Promise<void> {
        if (!chatId) return
        const name = campaignInput.value.trim()
        // A name typed or cleared by hand is the user's: no minting over it this session.
        namingAsked.add(chatId)
        namedHere.delete(chatId)
        const result = await bridge.request<PrefsResult>('prefs.patch', {
            patch: { campaignNames: { ...campaignNames, [chatId]: name } },
        })
        campaignNames = result.prefs?.campaignNames ?? {}
        drawCampaign()
    }

    /** Show the window, and say plainly what zero means. */
    function drawLookback(): void {
        lookbackInput.value = agentLookback ? String(agentLookback) : '0'
        lookbackHint.textContent = agentLookback
            ? `The agent reads the last ${agentLookback} messages of this chat.`
            : 'The agent reads the whole chat. Set a number to read only the most recent messages.'
    }

    /** Show the budget, in the unit that actually costs the user time. */
    function drawMaxTurns(): void {
        turnsInput.value = String(agentMaxTurns)
        turnsHint.textContent =
            `Up to ${agentMaxTurns} model call${agentMaxTurns === 1 ? '' : 's'} per pass, one after another. ` +
            'Lower is faster; too low and the agent stops before it has decided anything.'
    }

    /** Show the cadence, and say plainly what zero means. */
    function drawCadence(): void {
        cadenceInput.value = String(agentRunEvery)
        cadenceHint.textContent = agentRunEvery
            ? `A pass runs by itself after every ${agentRunEvery} `
                + `repl${agentRunEvery === 1 ? 'y' : 'ies'}, reading the story since the last one. `
                + 'Set 0 to only ever run it yourself.'
            : 'The agent only runs when you press the button. '
                + 'Set a number to have it keep the books up to date on its own.'
    }

    /** Store the cadence. Anything unusable switches automatic passes off. */
    async function saveCadence(): Promise<void> {
        const asked = Math.floor(Number(cadenceInput.value))
        const value = Number.isFinite(asked) && asked > 0 ? Math.min(asked, 50) : 0
        const result = await bridge.request<PrefsResult>('prefs.patch', { patch: { agentRunEvery: value } })
        agentRunEvery = result.prefs?.agentRunEvery ?? 0
        drawCadence()
    }

    /** The send bars' windows, as the backend last settled them. */
    function drawDirectLookbacks(): void {
        trackerBar.lookback.value = String(trackerDirectLookback)
        agentBar.lookback.value = String(agentDirectLookback)
    }

    /** Store a send bar's window. The backend clamps it; this shows what it settled on. */
    async function saveDirectLookback(key: 'trackerDirectLookback' | 'agentDirectLookback', count: number): Promise<void> {
        const result = await bridge.request<PrefsResult>('prefs.patch', { patch: { [key]: count } })
        trackerDirectLookback = result.prefs?.trackerDirectLookback ?? trackerDirectLookback
        agentDirectLookback = result.prefs?.agentDirectLookback ?? agentDirectLookback
        drawDirectLookbacks()
    }

    /** Store the window. Anything unusable falls back to the whole chat. */
    async function saveLookback(): Promise<void> {
        const asked = Math.floor(Number(lookbackInput.value))
        const value = Number.isFinite(asked) && asked > 0 ? asked : 0
        const result = await bridge.request<PrefsResult>('prefs.patch', { patch: { agentLookback: value } })
        agentLookback = result.prefs?.agentLookback ?? 0
        drawLookback()
    }

    /** Store the budget. The backend clamps it; this shows what it settled on. */
    async function saveMaxTurns(): Promise<void> {
        const result = await bridge.request<PrefsResult>('prefs.patch', {
            patch: { agentMaxTurns: Math.floor(Number(turnsInput.value)) },
        })
        agentMaxTurns = result.prefs?.agentMaxTurns ?? agentMaxTurns
        drawMaxTurns()
    }

    /**
     * Ask the backend to stop whatever is running for this chat.
     *
     * The button does not clear the running notice itself. The pass reports its
     * own end — `tracker.changed` or `agent.finished` — and letting that event
     * do the clearing keeps one source of truth for "is something running".
     * Clearing optimistically would show an idle panel while a pass that had
     * already passed the point of interruption carried on writing.
     */
    async function stopPass(kind: 'tracker' | 'agent'): Promise<void> {
        if (!chatId) return
        const button = kind === 'tracker' ? stopTrackerButton : stopAgentButton
        button.disabled = true
        try {
            const result = await bridge.request<{ stopped?: boolean }>(`${kind}.cancel`, { chatId })
            // Nothing running is not a failure. It usually means the pass
            // finished its last model call while the press was in flight.
            if (!result?.stopped) button.textContent = 'Stop'
        } finally {
            button.disabled = false
        }
    }

    /**
     * Draw both model pickers from whatever the host listed.
     *
     * A stored choice the host no longer lists is kept and shown as missing
     * rather than silently reset: the user picked it, and quietly falling back
     * to the default would make a deleted connection look like a working one.
     */
    function drawConnections(): void {
        creatorFold.setConnections(connectionChoices, connectionsUnavailable ?? '')
        portraitDraw.setTextConnections(connectionChoices, connectionsUnavailable ?? '')
        drawEvoConnection()
        for (const [control, chosen] of [
            [agentConnection, agentConnectionId],
        ] as const) {
            const { select, note } = control
            select.replaceChildren()

            const fallback = el('option', { value: '' }) as HTMLOptionElement
            fallback.textContent = NARRATOR_BLANK
            select.append(fallback)

            for (const choice of connectionChoices) {
                const option = el('option', { value: choice.id }) as HTMLOptionElement
                option.textContent = choice.model ? `${choice.name} — ${choice.model}` : choice.name
                select.append(option)
            }

            const known = connectionChoices.some((choice) => choice.id === chosen)
            if (chosen && !known) {
                const missing = el('option', { value: chosen }) as HTMLOptionElement
                missing.textContent = 'The connection you chose is no longer listed'
                select.append(missing)
            }
            select.value = chosen

            note.textContent = connectionsUnavailable
                ? connectionsUnavailable
                : connectionChoices.length === 0
                  ? 'No connection profiles found, so this runs on the default.'
                  : chosen && known
                    ? 'This job runs on that model instead of the one writing the story.'
                    : 'Point this at a smaller, faster model to make passes quicker.'
            select.disabled = !!connectionsUnavailable
        }
    }


    /** Ask the host what connections exist, once, on mount. */
    async function loadConnections(): Promise<void> {
        const result = await bridge.request<ConnectionsResult>('connections.list', {})
        if (destroyed) return
        connectionChoices = result?.connections ?? []
        connectionsUnavailable = result?.unavailable
        drawConnections()
    }

    /** Store a model choice, and redraw from what the backend settled on. */
    async function saveConnection(key: 'trackerConnectionId' | 'agentConnectionId', id: string): Promise<void> {
        const result = await bridge.request<PrefsResult>('prefs.patch', { patch: { [key]: id } })
        trackerConnectionId = result.prefs?.trackerConnectionId ?? trackerConnectionId
        agentConnectionId = result.prefs?.agentConnectionId ?? agentConnectionId
        drawConnections()
    }

    /** Run one agent pass, and draw what it did. */
    async function runAgent(instruction?: string): Promise<void> {
        if (!chatId) {
            say('No chat open.', 'error')
            return
        }
        const startedFor = chatId
        agentButton.disabled = true
        agentBar.setBusy(true)
        // An undo pressed mid-pass would read the snapshot from the pass
        // *before* this one and then be overwritten by the one still running,
        // leaving the books in a state neither pass produced.
        agentTools.setRunning(true)
        agentButton.textContent = 'Running\u2026'
        agentNote.textContent = instruction
            ? 'The agent is working on your instruction\u2026'
            : 'The agent is reading the story and your lorebooks\u2026'
        agentNote.classList.remove('lh-agent-note--error')
        agentDetail.replaceChildren()
        try {
            const result = instruction
                ? await bridge.request<AgentRunResult>('agent.instruct', { chatId, instruction })
                : await bridge.request<AgentRunResult>('agent.run', { chatId })
            if (destroyed || chatId !== startedFor) return
            agentReport = result
            drawAgent()
            noteAgentReport(result)
        } catch (error) {
            if (!(error instanceof RequestTimeoutError)) throw error
            if (destroyed) return
            // Running out of patience is not the pass failing. It reports
            // itself through `agent.finished` when it lands, so this says so
            // rather than showing a red error over work that is still going.
            agentNote.textContent =
                'The agent is taking longer than the panel waits. It is still running \u2014 '
                + 'this will fill in on its own when it finishes.'
        } finally {
            agentButton.disabled = false
            agentBar.setBusy(false)
            agentTools.setRunning(false)
            agentButton.textContent = 'Run the agent again'
        }
    }

    /** Draw the last pass: what it did, what it refused, and how it got there. */
    /** The Lorebook Agent's footer (78a): the party's place, and when the agent last ran, with the next automatic pass when the last was held for the count. */
    function drawAgentFooter(): void {
        const s = mapStatus && !mapStatus.unavailable ? mapStatus : null
        footPlace.textContent = s?.currentLocation ?? ''
        footPlace.hidden = !s?.currentLocation
        // A pass of an earlier session counts (78b): the history keeps the last thirty, newest first.
        const lastAt = agentReport?.at || reportHistory.agent[0]?.at || ''
        const last = lastAt ? `Last run: ${when(lastAt)}` : 'Last run: never'
        const held = agentReport?.summary?.match(/(\d+) more repl(?:y|ies) before the next pass/)
        agentFooterRun.textContent = held ? `${last} \u00b7 Next in: ${held[1]} repl${held[1] === '1' ? 'y' : 'ies'}` : last
    }

    function drawAgent(): void {
        drawHead()
        drawAgentFooter()
        agentHistorySelect.value = ''
        agentTools.setRunning(Boolean(agentRunning))

        // A pass nobody pressed went eight replies before the maintainer
        // noticed it had run, because nothing on screen said so while it ran
        // and the report carried no clock time afterwards. Both halves of
        // Phase 4a's fix, in the place that needed it more: this one writes to
        // the campaign.
        agentLive.hidden = !agentRunning
        if (agentRunning) {
            const started = clock(agentRunning.at)
            const words = el('span')
            words.textContent =
                (started ? `A pass is running now, started ${started}.` : 'A pass is running now.')
                + ' Best not to swipe until it lands.'
                // Everything under this line is the *previous* pass. Saying so
                // is the whole of Phase 4a's lesson: two ages on screen at once
                // need both of them named.
                + (agentReport ? ' Below is the previous one.' : '')
            agentLive.replaceChildren(words, stopAgentButton)
        }

        paintAgent(agentReport, false)
    }

    /** The agent's note and detail for the pass given: the last one, or an earlier one from the history (47e). */
    function paintAgent(shown: AgentRunResult | null, earlier: boolean): void {
        agentDetail.replaceChildren()
        if (earlier) {
            const note = el('div', { class: 'lh-report-earlier' })
            note.textContent = 'An earlier pass, from the history. The first choice in the list is the last pass.'
            agentDetail.append(note)
        }
        if (!shown) {
            agentNote.textContent = agentRunning
                ? 'The agent is reading the story and your lorebooks\u2026'
                : 'Reads the story so far and updates this campaign\u2019s lorebooks.'
            agentNote.classList.remove('lh-agent-note--error')
            return
        }

        if (shown.unavailable) {
            agentNote.textContent = shown.unavailable
            agentNote.classList.add('lh-agent-note--error')
            return
        }

        // Dated, always. "It did run, but I went 8 turns before I saw that it
        // had" — without a stamp there is no way to tell which reply a report
        // belongs to, and a stale one has been read as current here before.
        const stamped = shown.at ? when(shown.at) : ''
        agentNote.textContent = [shown.summary || 'The agent finished.', stamped && `Ran ${stamped}.`]
            .filter(Boolean)
            .join(' ')
        agentNote.classList.toggle('lh-agent-note--error', shown.outcome === 'failed')

        const write = shown.write
        const line = (label: string, items: string[], kind: string): void => {
            if (!items.length) return
            const row = el('div', { class: `lh-agent-line lh-agent-line--${kind}` })
            row.textContent = `${label}: ${items.join(', ')}`
            agentDetail.append(row)
        }
        line('Written', write?.changed ?? [], 'changed')
        line('Deleted', write?.deleted ?? [], 'deleted')
        line('Books created', write?.createdBooks ?? [], 'created')
        if (write?.createdBooks.length) {
            // A created book is scanned only once it is attached (55): the
            // sweep attaches it to the narrator's card as it is made when the
            // switch under Lorebooks is on, and the list there says whether
            // the narrator sees it — a book full of lore the narrator never
            // sees is the most expensive kind of silent failure there is.
            const attach = el('div', { class: 'lh-agent-line lh-agent-line--attach' })
            attach.textContent =
                'A new book is seen by the narrator only once it is attached. The Lorebooks list under the Campaign name box says whether it is: '
                + 'green is attached, red is not, with Attach on the row; the switch there attaches new books to the narrator\u2019s card as they are made.'
            agentDetail.append(attach)
        }
        // Refusals are the interesting half — they are where the ownership
        // rules bit, and a silent one reads as the agent misbehaving.
        line('Left alone', write?.refused ?? [], 'refused')
        line('Could not be used', shown.problems, 'refused')

        if (!shown.steps.length) return
        const steps = el('details', { class: 'lh-agent-steps' })
        const stepsSummary = el('summary')
        stepsSummary.textContent = `What it did (${shown.turnsUsed} turn${shown.turnsUsed === 1 ? '' : 's'})`
        steps.append(stepsSummary)
        for (const step of shown.steps) {
            const row = el('div', { class: `lh-agent-step lh-agent-step--${step.kind}` })
            row.textContent = describeStep(step)
            steps.append(row)
        }
        agentDetail.append(steps)
    }

    /**
     * The portrait's own buttons on the large view (80, the maintainer's ask;
     * Multihog's portrait menu): the row's three ops for one entity by name,
     * read at the click so a portrait set a moment ago offers Remove.
     */
    function portraitActions(name: string): PictureActions | undefined {
        if (!chatId) return undefined
        const stored = lookupPortrait(portraits, name)
        return {
            kind: 'portrait',
            set: host.uploads ? () => pickPortrait(name) : null,
            draw: () => drawPortrait(name),
            ...(stored ? { remove: () => setPortrait(name, '') } : {}),
            ...(host.uploads ? {} : { note: 'This build has no file picker.' }),
            fail,
        }
    }

    /**
     * A place's picture from the Campaign Records (80, Multihog's location
     * image menu): the scene's ops on that path, wherever the party stands.
     * The picture lands under the place's pin, where the scene and the
     * Visuals/Map hero read it.
     */
    function locationActions(path: string): PictureActions | undefined {
        if (!chatId) return undefined
        const asked = chatId
        const leaf = path.split(' :: ').pop() ?? path
        const stored = portraitFor(portraits, locationImageKey(path))
        return {
            kind: 'picture',
            set: host.uploads
                ? async () => {
                    const [picked] = await host.uploads!.pickFile({ accept: PORTRAIT_FILE_TYPES, maxSizeBytes: MAX_PORTRAIT_BYTES })
                    if (!picked) { say('No picture was picked.'); return }
                    say(`Storing the picture of ${leaf}…`, 'busy')
                    await bridge.request<SceneResult>('scene.setImage', { chatId: asked, path, src: toDataUrl(picked.bytes, picked.mimeType), filename: picked.name || 'scene.png' })
                    say(`The picture of ${leaf} is set.`)
                }
                : null,
            draw: async () => {
                say(`Writing the prompt for ${leaf}…`, 'busy')
                try {
                    const edited = await editedPrompt(async () => { const r = await bridge.request<ScenePromptResult>('scene.prompt', { chatId: asked, path }); return { title: `The picture of ${r.leaf}`, prompt: r.prompt } })
                    if (destroyed || chatId !== asked) return
                    if (!edited) { say('Nothing was drawn.'); return }
                    say(`Drawing the picture of ${leaf}…`, 'busy')
                    const result = await bridge.request<SceneDrawResult>('scene.draw', { chatId: asked, path, ...edited })
                    if (destroyed || chatId !== asked) return
                    say(`The picture of ${leaf} is drawn by ${result.provider} (${result.model}).`)
                } catch (error) {
                    if (error instanceof RequestTimeoutError) {
                        if (destroyed || chatId !== asked) return
                        say('The draw is taking longer than the panel waits. It is still being drawn; the thumbnail fills in when it lands.', 'busy')
                        return
                    }
                    say('')
                    throw error
                }
            },
            ...(stored ? { remove: async () => { await bridge.request<SceneResult>('scene.setImage', { chatId: asked, path, src: '' }); say(`The picture of ${leaf} is forgotten.`) } } : {}),
            ...(host.uploads ? {} : { note: 'This build has no file picker.' }),
            fail,
        }
    }

    /** Point an entity at a picture, or clear it. */
    async function setPortrait(name: string, src: string): Promise<void> {
        await writePortrait(name, () =>
            bridge.request<PortraitsResult>('portraits.set', { chatId, name, src }),
        )
        say(src ? `Portrait set for ${name}.` : `Portrait removed for ${name}.`)
    }

    /** Draw one entity's portrait now (61): the row's name, through the queue. */
    async function drawPortrait(name: string): Promise<void> {
        if (!chatId) {
            say('No chat open.', 'error')
            return
        }
        const startedFor = chatId
        say(`Writing the prompt for ${name}…`, 'busy')
        try {
            const edited = await editedPrompt(async () => { const r = await bridge.request<PortraitPromptResult>('portraits.prompt', { chatId: startedFor, name }); return { title: `The portrait of ${r.name}`, prompt: r.prompt } })
            if (destroyed || chatId !== startedFor) return
            if (!edited) { say('Nothing was drawn.'); return }
            say(`Drawing the portrait of ${name}…`, 'busy')
            const result = await bridge.request<PortraitDrawResult>('portraits.draw', { chatId, name, ...edited })
            if (destroyed || chatId !== startedFor) return
            say(`The portrait of ${name} is drawn by ${result.provider} (${result.model})${result.size ? `, ${result.size}` : ''}.`)
        } catch (error) {
            if (error instanceof RequestTimeoutError) {
                if (destroyed || chatId !== startedFor) return
                say('The draw is taking longer than the panel waits. It is still being drawn; the row fills in when it lands.', 'busy')
                return
            }
            say('')
            throw error
        }
    }

    /**
     * Choose a file and store it with the host.
     *
     * The picker is the host's, and the bytes go over the bridge as a data URL
     * because that is what survives it. Storing them with the host rather than
     * in our own file is the lesson the legacy learned late: it embedded a
     * generation of data URLs in its settings and had to migrate them out.
     */
    async function pickPortrait(name: string): Promise<void> {
        if (!chatId) {
            say('No chat open.', 'error')
            return
        }
        if (!host.uploads) {
            say('This build cannot open a file picker.', 'error')
            return
        }

        const [picked] = await host.uploads.pickFile({
            accept: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
            maxSizeBytes: MAX_PORTRAIT_BYTES,
        })
        if (!picked) return

        say(`Storing the picture for ${name}…`, 'busy')
        await writePortrait(name, () =>
            bridge.request<PortraitsResult>('portraits.upload', {
                chatId,
                name,
                dataUrl: toDataUrl(picked.bytes, picked.mimeType),
                filename: picked.name,
            }),
        )
        say(`Portrait set for ${name}.`)
    }

    /**
     * Read the preference on mount, so the box shows the truth.
     *
     * Failure is silent and leaves the box as it is: a build with no preference
     * store draws the cards, which is what the box already says.
     */
    async function loadPrefs(): Promise<void> {
        try {
            const result = await bridge.request<PrefsResult>('prefs.get', {})
            if (destroyed) return
            lastPrefs = { ...(result.prefs ?? {}) } as Record<string, unknown>
            partyCompact = result.prefs?.partyCompact === true
            relationshipFloatOn = lastPrefs.npcRelationshipToast !== false
            locationImages = lastPrefs.locationImages === true
            readDisplayPrefs(result.prefs ?? {})
            takeBars(result.prefs?.bars)
            campaignNames = result.prefs?.campaignNames ?? {}
            booksAutoInput.checked = result.prefs?.attachBooksToCard !== false
            booksTargetSelect.value = result.prefs?.attachBooksTarget === 'card' ? 'card' : 'chat'
            prefsRead = true
            agentLookback = result.prefs?.agentLookback ?? 0
            agentMaxTurns = result.prefs?.agentMaxTurns ?? agentMaxTurns
            quickMode.applyPrefs(lastPrefs)
            quickMore.applyPrefs(lastPrefs)
            trackerConnectionId = result.prefs?.trackerConnectionId ?? ''
            agentConnectionId = result.prefs?.agentConnectionId ?? ''
            agentRunEvery = result.prefs?.agentRunEvery ?? 0
            trackerDirectLookback = result.prefs?.trackerDirectLookback ?? 5
            agentDirectLookback = result.prefs?.agentDirectLookback ?? 10
            terminalFold.applyPrefs((result.prefs ?? {}) as Record<string, unknown>)
            agentTools.applyPrefs((result.prefs ?? {}) as Record<string, unknown>)
            creatorFold.applyPrefs(result.prefs ?? {})
            instantFold.applyPrefs(result.prefs ?? {})
            playerCardFold.applyPrefs(result.prefs ?? {})
            waysFold.applyPrefs(result.prefs ?? {})
            importFold.applyPrefs(result.prefs ?? {})
            startArea.applyPrefs((result.prefs ?? {}) as Record<string, unknown>)
            narrator.applyPrefs((result.prefs ?? {}) as Record<string, unknown>)
            npcFold.applyPrefs(result.prefs ?? {})
            sceneFold.applyPrefs(result.prefs ?? {})
            portraitDraw.applyPrefs(result.prefs ?? {})
            cardSettings.applyPrefs(result.prefs ?? {})
            drawDirectLookbacks()
            drawCampaign()
            drawLookback()
            drawMaxTurns()
            drawConnections()
            loadConnections().catch(fail)
            drawCadence()
            draw()
        } catch {
            // Leave the default.
        }
    }

    /** The preferences as last seen, so an event can say which keys moved (63c). */
    let lastPrefs: Record<string, unknown> = {}

    function movedKeys(prefs: Record<string, unknown>): string[] {
        const keys = new Set([...Object.keys(lastPrefs), ...Object.keys(prefs)])
        const moved: string[] = []
        for (const key of keys) if (JSON.stringify(lastPrefs[key]) !== JSON.stringify(prefs[key])) moved.push(key)
        lastPrefs = { ...prefs }
        return moved
    }

    /**
     * The tracker's and the agent's dials, as the category's mirror may have
     * moved them (63c): the same assignments the first read makes, then the
     * same redraws. The campaign's name, the bars and the cards' switch are
     * not dials and are left to their own paths.
     */
    function applyDialPrefs(prefs: NonNullable<PrefsResult['prefs']>): void {
        if (prefs.attachBooksToCard !== undefined) booksAutoInput.checked = prefs.attachBooksToCard !== false
        if (prefs.attachBooksTarget !== undefined) booksTargetSelect.value = prefs.attachBooksTarget === 'card' ? 'card' : 'chat'
        if (prefs.agentLookback !== undefined) agentLookback = prefs.agentLookback
        if (prefs.agentMaxTurns !== undefined) agentMaxTurns = prefs.agentMaxTurns
        if (prefs.agentRunEvery !== undefined) agentRunEvery = prefs.agentRunEvery
        if (prefs.trackerDirectLookback !== undefined) trackerDirectLookback = prefs.trackerDirectLookback
        if (prefs.agentDirectLookback !== undefined) agentDirectLookback = prefs.agentDirectLookback
        drawDirectLookbacks()
        drawLookback()
        drawMaxTurns()
        drawCadence()
    }

    async function save(): Promise<void> {
        if (!chatId) {
            say('No chat open.', 'error')
            return
        }
        disarmClear()
        const result = await bridge.request<TrackerResult>('tracker.setMemo', { chatId, memo: rawText.value })
        if (result.memo !== memo) {
            liveChangeLog = memoChangeLog(memo, result.memo)
            changeLogCleared = false
        }
        memo = result.memo
        if (result.archivedQuests) archivedQuests = result.archivedQuests
        draw()
        say('Memo saved.')
    }

    /**
     * Redraw when the tracker pass updates this chat's memo.
     *
     * The event carries the new memo, so this needs no round trip. A memo for
     * a different chat is ignored — a background pass can finish for a chat the
     * user has already navigated away from, and painting it here would show
     * them another campaign's state.
     */
    const unsubscribe = bridge.on((event) => {
        /**
         * A pass has begun.
         *
         * This is the whole point of the event: the pass after a reply runs in
         * the background with nothing on screen to show for it, so until it
         * landed there was no way to tell it apart from a tracker that had
         * stopped working — you waited a few minutes and looked for an
         * `updated` line. Now the panel says so while it happens.
         *
         * A start for another chat is ignored for the same reason a memo for
         * another chat is: a background pass can be running for a campaign the
         * user has navigated away from.
         */
        /**
         * An agent pass that finished, whether or not this side was still
         * waiting on it. A pass can outlast any deadline the panel holds a
         * button for, and a pass that wrote to the campaign must not go
         * unreported because the request gave up first.
         */
        /**
         * A pass that started on its own, announced before it finishes.
         *
         * Nobody pressed anything, so without this the only sign is a report
         * appearing minutes later — and a pass that writes to the campaign is
         * exactly the thing not to swipe over halfway through.
         */
        /**
         * A portrait changed, from whichever hand: the editor's own save, a
         * library card seated, an NPC made, a card imported, a picture set for
         * a place. The map arrives whole, so the cards redraw at once rather
         * than after a reload (43-bis).
         */
        // A relationship value moved, from whichever hand (44): the fold re-reads.
        if (event.name === 'relationships.changed') {
            const changed = event.data as { chatId?: string } | undefined
            if (!chatId || (changed?.chatId && changed.chatId !== chatId)) return
            recordsFold.refreshRelations().catch(() => undefined)
            return
        }

        // An award placed by the tracker's block or the narrator's line (78c): Multihog's float over the tracker, while the switch is on.
        if (event.name === 'relationships.awarded') {
            const awarded = event.data as { chatId?: string; awards?: RelationshipAward[] } | undefined
            if (!chatId || !awarded?.chatId || awarded.chatId !== chatId || !relationshipFloatOn) return
            for (const award of awarded.awards ?? []) {
                if (!award || (award.field !== 'friendship' && award.field !== 'affection') || !Number.isFinite(award.delta)) continue
                relationshipFloat.show({ npc: String(award.npc ?? ''), field: award.field, delta: award.delta })
            }
            return
        }

        // A preference saved anywhere (63): the connections are mirrored in the Connections category, so a
        // change there shows in the folds, and one made in a fold shows there, through this one event.
        if (event.name === 'prefs.changed') {
            const prefs = (event.data as PrefsResult | undefined)?.prefs
            if (!prefs) return
            if ((prefs as Record<string, unknown>).npcRelationshipToast !== undefined) relationshipFloatOn = (prefs as Record<string, unknown>).npcRelationshipToast !== false
            if ((prefs as Record<string, unknown>).locationImages !== undefined && locationImages !== ((prefs as Record<string, unknown>).locationImages === true)) {
                locationImages = (prefs as Record<string, unknown>).locationImages === true
                recordsFold.redraw()
            }
            if (prefs.trackerConnectionId !== undefined) trackerConnectionId = prefs.trackerConnectionId
            if (prefs.agentConnectionId !== undefined) agentConnectionId = prefs.agentConnectionId
            if (prefs.mapEvolutionConnectionId !== undefined) evoConnectionId = prefs.mapEvolutionConnectionId
            drawConnections()
            if (prefs.creatorConnectionId !== undefined) creatorFold.applyConnection(prefs.creatorConnectionId)
            // The terminal's drafts, lookbacks and tab (71b); the Quick Settings dials (78a).
            terminalFold.applyPrefs(prefs as Record<string, unknown>)
            quickMode.applyPrefs(prefs as Record<string, unknown>)
            quickMore.applyPrefs(prefs as Record<string, unknown>)
            // The cards' display preferences (72b) redraw the cards; so does a bar recoloured
            // under a message (74i-ter), which the same event carries.
            const barsMoved = prefs.bars !== undefined && recolor.take(prefs.bars).changed
            if (barsMoved) bars = recolor.current()
            if (readDisplayPrefs(prefs) || barsMoved) draw()
            // The scene's drawing settings and the portraits' switches are mirrored too (63b): the whole set, each fold taking what it draws.
            sceneFold.applyPrefs(prefs)
            portraitDraw.applyPrefs(prefs)
            // And the rest of the dials (63c): the tracker's and the agent's rows redraw from the set; the
            // world's and the maps' folds read their status again, which carries their dials, when one of
            // their keys moved; the creator's starting choices and Instant Action's switches follow too.
            const moved = movedKeys(prefs as Record<string, unknown>)
            applyDialPrefs(prefs)
            creatorFold.applyDefaults(prefs)
            instantFold.applyPrefs(prefs)
            narrator.applyPrefs(prefs as Record<string, unknown>)
            startArea.applyPrefs(prefs as Record<string, unknown>)
            if (moved.some((key) => key.startsWith('world'))) loadWorld().catch(() => undefined)
            if (moved.some((key) => key.startsWith('map'))) loadMaps().catch(() => undefined)
            return
        }

        if (event.name === 'portraits.changed') {
            const changed = event.data as (PortraitsResult & { chatId?: string }) | undefined
            if (!changed?.portraits || !chatId || (changed.chatId && changed.chatId !== chatId)) return
            portraits = changed.portraits
            draw()
            sceneFold.refresh().catch(() => undefined)
            // The Campaign Records' thumbnails and portrait boxes read the same map (80).
            recordsFold.redraw()
            return
        }

        if (event.name === 'agent.started') {
            const start = event.data as { chatId?: string; at?: string } | undefined
            if (!start || (start.chatId && start.chatId !== chatId)) return
            agentRunning = { at: typeof start.at === 'string' ? start.at : new Date().toISOString() }
            drawAgent()
            return
        }

        if (event.name === 'agent.finished') {
            const finished = event.data as (AgentRunResult & { chatId?: string }) | undefined
            if (!finished || (finished.chatId && finished.chatId !== chatId)) return
            agentRunning = null
            agentReport = finished
            drawAgent()
            noteAgentReport(finished)
            // A pass may have made a book (55), and wrote entries the records show (71a).
            refreshBooks()
            if (recordsFold.root.open) recordsFold.load().catch(() => undefined)
            return
        }

        /**
         * A pass rolled back because the reply it read was swiped away.
         *
         * The report on screen describes writes that no longer exist, and the
         * user did not press anything — so this has to say so itself, or the
         * panel would show a pass that has been undone as though it stood.
         */
        if (event.name === 'world.started') {
            const start = event.data as { chatId?: string; at?: string; trigger?: string } | undefined
            if (!start || (start.chatId && start.chatId !== chatId)) return
            worldRunning = { at: typeof start.at === 'string' ? start.at : new Date().toISOString(), trigger: start.trigger ?? 'automatic' }
            drawWorld()
            return
        }

        if (event.name === 'map.architect.started') {
            const start = event.data as { chatId?: string; site?: string; at?: string } | undefined
            if (!start || (start.chatId && start.chatId !== chatId)) return
            architectRunning = { site: String(start.site ?? ''), at: String(start.at ?? new Date().toISOString()) }
            drawArchitect()
            return
        }

        // The terminal (71b): a pass's step, as it happens.
        if (event.name === 'terminal.step') {
            const data = event.data as { chatId?: string; step?: TerminalStep } | undefined
            if (data?.chatId && data.step) terminalFold.push(data.chatId, data.step)
            return
        }

        if (event.name === 'map.architect.finished') {
            const finished = event.data as (MapArchitectResult & { chatId?: string }) | undefined
            if (!finished || (finished.chatId && finished.chatId !== chatId)) return
            architectRunning = null
            if (mapStatus) mapStatus = { ...mapStatus, lastArchitect: finished }
            drawArchitect()
            loadMaps().catch(() => undefined)
            if (recordsFold.root.open) recordsFold.load().catch(() => undefined)
            return
        }

        if (event.name === 'map.updater.started') {
            const start = event.data as { chatId?: string; site?: string; at?: string } | undefined
            if (!start || (start.chatId && start.chatId !== chatId)) return
            updaterRunning = { site: String(start.site ?? ''), at: String(start.at ?? new Date().toISOString()) }
            drawUpdater()
            return
        }

        if (event.name === 'map.updater.finished') {
            const finished = event.data as (MapUpdaterResult & { chatId?: string }) | undefined
            if (!finished || (finished.chatId && finished.chatId !== chatId)) return
            updaterRunning = null
            if (mapStatus) mapStatus = { ...mapStatus, lastUpdater: finished }
            drawUpdater()
            if (!updaterPressed) loadMaps().catch(() => undefined)
            return
        }

        if (event.name === 'map.evolution.started') {
            const start = event.data as { chatId?: string; sites?: string[]; at?: string } | undefined
            if (!start || (start.chatId && start.chatId !== chatId)) return
            evolutionRunning = { sites: Array.isArray(start.sites) ? start.sites.map(String) : [], at: String(start.at ?? new Date().toISOString()) }
            drawEvolution()
            return
        }

        // The scene picture (49): a draw began or finished, pressed or on its own.
        if (event.name === 'scene.picture.started') {
            const start = event.data as { chatId?: string; path?: string; at?: string } | undefined
            if (!start?.path || (start.chatId && start.chatId !== chatId)) return
            const at = start.at ?? new Date().toISOString()
            sceneDrawing = { path: start.path, at }
            drawHead()
            sceneFold.drawingStarted({ chatId: start.chatId, path: start.path, at })
            return
        }

        if (event.name === 'scene.picture.finished') {
            const report = event.data as ScenePictureReport | undefined
            if (!report?.path || (report.chatId && report.chatId !== chatId)) return
            sceneDrawing = null
            sceneDrawLast = report
            drawHead()
            sceneFold.drawingFinished(report)
            return
        }

        // A library card's photo (60-bis): the same light, its own words.
        if (event.name === 'library.photo.started') {
            const start = event.data as { chatId?: string; name?: string; at?: string } | undefined
            if (!start?.name || (start.chatId && start.chatId !== chatId)) return
            libraryDrawing = { name: start.name, at: start.at ?? new Date().toISOString() }
            drawHead()
            return
        }

        if (event.name === 'library.photo.finished') {
            const report = event.data as { chatId?: string; name?: string; at?: string; outcome?: 'drawn' | 'failed'; reason?: string } | undefined
            if (!report?.name || !report.outcome || (report.chatId && report.chatId !== chatId)) return
            libraryDrawing = null
            libraryDrawLast = { name: report.name, at: report.at ?? new Date().toISOString(), outcome: report.outcome, ...(report.reason ? { reason: report.reason } : {}) }
            drawHead()
            return
        }

        // A portrait drawn as it appears (61): the light, and the row's note.
        if (event.name === 'portrait.draw.started') {
            const start = event.data as { chatId?: string; name?: string; at?: string } | undefined
            if (!start?.name || !chatId || start.chatId !== chatId) return
            const at = start.at ?? new Date().toISOString()
            autoDrawing = { name: start.name, at }
            portraitAuto = { ...portraitAuto, drawing: [{ name: start.name, at }], queued: portraitAuto.queued.filter((n) => normalizeEntityName(n) !== normalizeEntityName(start.name)) }
            drawHead()
            draw()
            return
        }

        if (event.name === 'portrait.draw.finished') {
            const report = event.data as PortraitDrawReport | undefined
            if (!report?.name || !report.outcome || !chatId || report.chatId !== chatId) return
            autoDrawing = null
            autoDrawLast = { name: report.name, at: report.at ?? new Date().toISOString(), outcome: report.outcome, ...(report.reason ? { reason: report.reason } : {}) }
            portraitAuto = { ...portraitAuto, drawing: [], last: { ...portraitAuto.last, [normalizeEntityName(report.name)]: report } }
            if (report.prompt) {
                portraitPromptBox.textContent = `${report.name}: ${report.prompt}`
                portraitPromptBox.hidden = false
                portraitPromptLabel.hidden = false
            }
            drawHead()
            draw()
            return
        }

        if (event.name === 'map.evolution.finished') {
            const finished = event.data as (MapEvolutionResult & { chatId?: string }) | undefined
            if (!finished || (finished.chatId && finished.chatId !== chatId)) return
            evolutionRunning = null
            if (mapStatus) mapStatus = { ...mapStatus, lastEvolution: finished }
            drawEvolution()
            if (!evolutionPressed && !sandboxFold.busy()) loadMaps().catch(() => undefined)
            return
        }

        // The Testing Ground (71d): a simulate's tick, as it goes.
        if (event.name === 'map.sandbox.progress') {
            const tick = event.data as { chatId?: string; index: number; count: number; timeLabel: string; phase: string } | undefined
            if (tick) sandboxFold.progress(tick)
            return
        }

        if (event.name === 'world.finished') {
            const finished = event.data as (WorldRunResult & { chatId?: string }) | undefined
            if (!finished || (finished.chatId && finished.chatId !== chatId)) return
            worldRunning = null
            if (worldStatus) worldStatus = { ...worldStatus, lastRun: finished }
            drawWorld()
            loadWorld().catch(() => undefined)
            return
        }

        if (event.name === 'agent.undone') {
            const undone = event.data as (AgentUndoResult & { chatId?: string }) | undefined
            if (!undone || (undone.chatId && undone.chatId !== chatId)) return
            agentRunning = null
            agentReport = null
            drawAgent()
            agentTools.noteUndone(undone)
            return
        }
        // The agent's tools (71c): a full audit's chunk, and an undone pass written back.
        if (event.name === 'agent.audit.progress') {
            const progress = event.data as { chatId?: string; chunk: number; total: number; status: 'running' | 'skipped' | 'done' } | undefined
            if (progress && typeof progress.chunk === 'number') agentTools.progress(progress)
            return
        }
        if (event.name === 'agent.redone') {
            const redone = event.data as (AgentRedoResult & { chatId?: string }) | undefined
            if (!redone || (redone.chatId && redone.chatId !== chatId)) return
            agentTools.noteRedone(redone)
            return
        }

        if (event.name === 'tracker.started') {
            const start = event.data as Partial<TrackerPassStartedDTO> | undefined
            if (!start || start.chatId !== chatId) return

            running = {
                at: typeof start.at === 'string' ? start.at : new Date().toISOString(),
                trigger: start.trigger === 'manual' ? 'manual' : start.trigger === 'direct' ? 'direct' : 'reply',
            }
            redrawReport()
            say(busyMessage(), 'busy')
            return
        }

        if (event.name !== 'tracker.changed') return
        const data = event.data as
            | { chatId?: string; memo?: string; report?: TrackerPassReportDTO; archivedQuests?: Quest[] }
            | undefined
        if (!data || data.chatId !== chatId || typeof data.memo !== 'string') return

        // Whatever this panel was waiting on, this is it arriving.
        running = null
        drawReport(data.report)
        noteTrackerReport(data.report)

        // A pass that archived a quest changed the log as much as one that
        // changed a block, and the archive is not in the memo to be read back.
        if (Array.isArray(data.archivedQuests)) archivedQuests = data.archivedQuests

        const editing = rawText.value !== memo
        // The Change Log (78d): the diff this pass made, as the legacy keeps `lastDelta`.
        liveChangeLog = memoChangeLog(memo, data.memo)
        changeLogCleared = false
        memo = data.memo
        // Do not clobber an edit in progress; the Revert button still offers
        // the way back to what was just saved.
        if (!editing) rawText.value = memo

        // A pass just wrote a new state, so every position in the stepper's
        // list has shifted by one. Back to live: leaving the cursor where it
        // was would renumber the turn on screen without saying so.
        //
        // The list itself is *not* re-fetched here. This event carries the memo
        // precisely so a pass costs no round trip, and `stepTo` reloads before
        // the first step away from live — which is the only moment a stale list
        // could be read.
        const wasStepping = historyIndex !== LIVE
        historyIndex = LIVE
        restoreArmed = false

        draw()
        if (wasStepping) say('A pass landed, so the tracker is back on the live state.')
        else say(editing ? 'Tracker updated — your unsaved edit is still here.' : '')
    })

    cards.addEventListener('click', (event) => { toggle(event.target) })
    // Tab Mode's swipe (76), the legacy's: a mostly horizontal swipe of 50px or more over the pane moves to the neighbouring tab.
    let touchStart: { x: number; y: number } | null = null
    cards.addEventListener('touchstart', (event) => {
        if (event.touches.length !== 1) { touchStart = null; return }
        touchStart = { x: event.touches[0]!.clientX, y: event.touches[0]!.clientY }
    }, { passive: true })
    cards.addEventListener('touchend', (event) => {
        const start = touchStart
        touchStart = null
        const pane = cards.querySelector('.rt-tabmode-content')
        const wrap = cards.querySelector('.rt-tabmode-wrap')
        if (!start || !pane || !wrap || !(event.target instanceof Node) || !pane.contains(event.target)) return
        const order = (wrap.getAttribute('data-tab-order') ?? '').split(',').filter(Boolean)
        const touch = event.changedTouches[0]
        if (!touch || !order.length) return
        const dx = touch.clientX - start.x
        const dy = touch.clientY - start.y
        if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return
        const index = order.indexOf(pane.getAttribute('data-active-tag') ?? '')
        if (index === -1) return
        const next = dx < 0 ? Math.min(order.length - 1, index + 1) : Math.max(0, index - 1)
        if (next !== index) chooseTab(order[next]!)
    }, { passive: true })
    cards.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            // The headers carry role="button", so they have to answer to a
            // keyboard the way a button does.
            event.preventDefault()
            toggle(event.target)
        }
    })

    runButton.addEventListener('click', () => { runNow().catch(fail) })
    refreshButton.addEventListener('click', () => { refresh().catch(fail) })
    saveButton.addEventListener('click', () => { save().catch(fail) })
    clearArchiveButton.addEventListener('click', () => { clearArchive().catch(fail) })
    revertButton.addEventListener('click', () => {
        disarmClear()
        rawText.value = memo
        say('Reverted to the saved memo.')
    })

    refresh().catch(fail)
    loadPrefs().catch(() => undefined)

    return {
        refresh,
        setSettings(next: TrackerSettings): void {
            current = next
            narrator.setSettings(next as SettingsBag)
            waysFold.applySettings(next as Record<string, unknown>)
            draw()
        },
        instruct(instruction: string): Promise<void> {
            return runNow(instruction)
        },
        destroy(): void {
            destroyed = true
            recolor.close()
            picture.destroy()
            locationBackground.clear()
            unsubscribe()
            detailsModal?.close()
            recordsFold.closeModal()
            relationshipFloat.destroy()
            skeletonView.remove()
            root.replaceChildren()
            if (rest !== root) rest.replaceChildren()
            scene?.replaceChildren()
            slots.sceneHead?.replaceChildren()
            slots.sceneFoot?.replaceChildren()
        },
    }
}

/** One line of an agent pass's step log, in words. */
export function describeStep(step: {
    kind: string
    text?: string
    name?: string
    argument?: string
    reply?: string
}): string {
    if (step.kind === 'tool') return `${step.name}(${step.argument ?? ''})`
    if (step.kind === 'thought') return step.text ?? ''
    // First line plus a count of the rest. It used to be the first line alone,
    // which made `inspect_book` — whose first line is only a header — report
    // `"Vell_Characters" has 4 entries:` and then nothing, so the log could
    // not show what the agent had actually been given.
    if (step.kind === 'observation') {
        const lines = (step.text ?? '').split('\n').filter((line) => line.trim())
        const rest = lines.length - 1
        return `→ ${lines[0] ?? ''}${rest > 0 ? ` (+${rest} more line${rest === 1 ? '' : 's'})` : ''}`
    }
    // Longer than the rest on purpose: an unreadable reply is the only step
    // whose *content* is the diagnosis. Live, two of these went by showing
    // eighty characters, which was not enough to tell a truncated reply from
    // malformed JSON.
    if (step.kind === 'unreadable') return `(unreadable reply) ${(step.reply ?? '').slice(0, 300)}`
    if (step.kind === 'error') return `error: ${step.text ?? ''}`
    return step.kind
}
