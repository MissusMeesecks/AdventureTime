/**
 * The frontend <-> backend message protocol.
 *
 * Spindle gives us a pair of one-way channels (`ctx.sendToBackend` and
 * `spindle.sendToFrontend`) rather than a request/response API, so this module
 * defines the small envelope that turns them into one: every request carries
 * an `id`, and the reply carries it back.
 *
 * Both bundles import this file, so the two sides cannot drift apart without
 * a compile error.
 */

import type { Quest } from './tracker/quests.js'
import type { WizardDraft } from './tracker/wizard.js'
import type { MapTheme } from './tracker/map-themes.js'
import type { DisplayGroup } from './tracker/display-groups.js'

/** Marks a message as ours. Cheap insurance, and a place to version from. */
export const CHANNEL = 'adventure_time'

/**
 * The smallest a floating widget may be dragged to (47c-bis): the head and
 * a card still readable. Here, not in the preferences store, because the
 * frontend's layout reads it and a value import from the backend's store
 * would carry the store and everything under it into the frontend bundle
 * (lesson 54's shape: 887 KB became 1267 KB the first time).
 */
export const MIN_WIDGET_SIZE = { width: 280, height: 200 } as const

/**
 * The panel's visual themes (74a, departure 81): Multihog's seven, by the
 * names its classes carry (`rt-theme-<name>`). `native` is the host's own
 * colours, the look before the theme pass; `custom` waits on the AI Theme
 * Wizard (74b) and is offered greyed until then. Shared here because the
 * backend's preference reader and the frontend's select both need the list.
 */
export const THEME_IDS = ['native', 'hacker', 'fantasy', 'hologram', 'pacific', 'cherry', 'custom'] as const
export type ThemeId = (typeof THEME_IDS)[number]
export const DEFAULT_THEME: ThemeId = 'native'
/** A stored theme, or the host's colours for anything unknown. */
export function readThemeId(value: unknown): ThemeId {
    return (THEME_IDS as readonly string[]).includes(String(value)) ? (value as ThemeId) : DEFAULT_THEME
}

/**
 * The font sizes (74e): Multihog's two sliders, 8 to 32 px. Here 0 is the
 * host's own size, the default (departure 122: Multihog's defaults are 14
 * and 13 px; AdventureTime's roots take the host's size until a slider moves, as
 * *Match Lumiverse* takes its colours). A number is clamped to the slider.
 */
export const FONT_SIZE_MIN = 8
export const FONT_SIZE_MAX = 32
/** A box's backdrop (74d): the day image's and the night image's addresses in the host's store (or https URLs), and the tint's strength 0–100. */
export interface Backdrop {
    day: string
    night: string
    strength: number
}

/** Multihog's default tint strength, in percent. */
export const DEFAULT_BACKDROP_STRENGTH = 55

/** A stored backdrop, or anything else as none: the addresses as trimmed strings, the strength a whole number 0–100 (the default when it is not a number). */
export function readBackdrop(value: unknown): Backdrop {
    const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
    const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
    const strength = Number(record.strength)
    return {
        day: text(record.day),
        night: text(record.night),
        strength: Number.isFinite(strength) ? Math.max(0, Math.min(100, Math.round(strength))) : DEFAULT_BACKDROP_STRENGTH,
    }
}

export function readFontSize(value: unknown): number {
    const n = Math.round(Number(value))
    if (!Number.isFinite(n) || n <= 0) return 0
    return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, n))
}

/** Operations the backend answers. */
export type RequestOp =
    | 'settings.get'
    | 'settings.patch'
    | 'settings.reset'
    | 'settings.factory'
    | 'settings.upgradeStock'
    | 'maintenance.resetPrompts'
    | 'maintenance.factoryReset'
    | 'maintenance.purgePortraits'
    | 'maintenance.orphans'
    | 'maintenance.cleanOrphans'
    /** Every chat's data counted and removed (81, Multihog's *Remove all chat links*); the same shapes as the orphans'. */
    | 'maintenance.chatData'
    | 'maintenance.removeAllChats'
    | 'cartridge.export'
    | 'cartridge.import'
    | 'tracker.get'
    | 'tracker.setMemo'
    | 'tracker.run'
    | 'tracker.instruct'
    | 'tracker.clearArchive'
    | 'tracker.history'
    | 'tracker.restore'
    /** The last reports of the tracker and the agent for a chat (47e). */
    | 'reports.history'
    | 'portraits.get'
    | 'portraits.set'
    | 'portraits.upload'
    /** A backdrop's image (74d), picked and stored with the host, then written into the box's preference; answers as `prefs.patch` does. */
    | 'backdrop.upload'
    /** The portraits drawn as they appear (61): one name drawn on a press; what is drawing and queued, the chat seeded on the first ask; the check a ticked switch asks for. */
    | 'portraits.draw'
    | 'portraits.auto.status'
    | 'portraits.auto.check'
    | 'portraits.presets.load'
    | 'portraits.presets.save'
    | 'portraits.presets.delete'
    | 'lore.activated'
    | 'agent.run'
    | 'agent.instruct'
    | 'cyoa.choices'
    | 'cyoa.choose'
    | 'wizard.draft'
    | 'wizard.revise'
    | 'agent.undo'
    /** The agent's tools (71c): the cleanup pass, the full audit and its stop, the redo, the campaign's books cloned. */
    | 'agent.cleanup'
    | 'agent.audit'
    | 'agent.audit.stop'
    | 'agent.redo'
    | 'campaign.clone'
    | 'prefs.get'
    | 'prefs.patch'
    /** Self-named campaigns (51): the chat's campaign name, minted from the card and the clock when it has none. */
    | 'campaign.name'
    | 'status.get'
    | 'connections.list'
    | 'tracker.cancel'
    | 'agent.cancel'
    | 'world.get'
    | 'world.run'
    | 'world.reset'
    /** The World Skeleton (33b): generate the seed book, and purge the campaign's world history. */
    | 'world.skeleton'
    | 'world.purge'
    /** 33c: write the skeleton's source from the chat, and list the books the skeleton may read. */
    | 'world.skeletonSource'
    | 'world.books'
    /** 72b: the oldest N raw reports consolidated now, and the next report's time set by hand. */
    | 'world.consolidate'
    | 'world.overrideNext'
    /** 72b: an empty narrator card made under the chosen name, or found. */
    | 'narrator.create'
    /** 72b: the NPC word targets, written into the NPC module's instruction. */
    | 'settings.npcWords'
    | 'settings.sections'
    /** The hidden map (row 9, Phase 34): what is mapped and where the party is. */
    | 'map.get'
    /** The Map Updater (34b): a pass now, on the party's site or a named one, with an instruction if given. */
    | 'map.update'
    /** Map Evolution (34c): a pass now, on the party's site or named ones, with an instruction if given. */
    | 'map.evolve'
    | 'map.view'
    /** Campaign Records (71a): the campaign's books with their entries; one edited, removed, pinned, or its map taken off. */
    | 'records.list'
    | 'records.update'
    | 'records.remove'
    | 'records.pin'
    | 'records.removeMap'
    /** Edit with AI (78c): one call rewriting an entry or the Player Card to the user's instructions; the panel applies it. */
    | 'records.aiEdit'
    /** A location made and mapped from the panel (71a), the narrator not involved; and a map's raw JSON read and written. */
    | 'map.create'
    | 'map.raw.get'
    | 'map.raw.set'
    /** Map Evolution's tools (71d): a site's own hours between passes, and the Testing Ground's nine. */
    | 'map.evolution.interval'
    /** Multihog's Reset Timeline (78a): every site's last-evolved clock forgotten. */
    | 'map.evolution.reset'
    | 'map.sandbox.get'
    | 'map.sandbox.time'
    | 'map.sandbox.asset.add'
    | 'map.sandbox.asset.set'
    | 'map.sandbox.evolve'
    | 'map.sandbox.simulate'
    | 'map.sandbox.undo'
    | 'map.sandbox.redo'
    | 'map.sandbox.clear'
    /** The terminal (71b): the kept steps of every agent on a chat, one agent's feed cleared, and the Map Architect's direct command. */
    | 'terminal.get'
    | 'terminal.clear'
    | 'map.direct'
    | 'creator.generate'
    | 'creator.instant'
    | 'creator.card.get'
    | 'creator.card.write'
    | 'creator.card.save'
    | 'creator.card.remove'
    | 'creator.card.persona'
    | 'creator.ways'
    /** Import Card (39): the host's character cards, and one imported as the player. */
    | 'creator.cards'
    | 'creator.import'
    /** The NPC library (41): the records, their sources, the packages, and a card put into play. */
    | 'library.list'
    | 'library.sources'
    | 'library.saveEntry'
    | 'library.savePlayerCard'
    /** The character editor's tab (48): a host card kept in the library as is. */
    | 'library.saveCard'
    | 'library.update'
    | 'library.remove'
    | 'library.import'
    | 'library.export'
    | 'library.party'
    | 'library.playAsPc'
    /** A card's photo (60): set from a file, drawn through the host's image generation, or removed. */
    | 'library.photo.set'
    | 'library.photo.draw'
    | 'library.photo.remove'
    /** The NPC creator (41a): a draft to preview, a card added as is, and a draft committed. */
    | 'npc.draft'
    | 'npc.add'
    | 'npc.commit'
    /** The scene view (42): where the party is and who is present, and a picture set for the place. */
    | 'scene.get'
    | 'scene.setImage'
    | 'scene.draw'
    | 'scene.prompt'
    | 'library.photo.prompt'
    | 'portraits.prompt'
    | 'scene.connections'
    | 'lore.books'
    /** Every book the host has, by name (73h): the tracker's lorebook filter picks from it. */
    | 'books.list'
    | 'theme.generate'
    | 'lore.attach'
    /** A book named as the campaign's but owned by no chat of ours, or another, made this campaign's (56). */
    | 'lore.adopt'
    /** The relationship system (44): the standings, one set by hand, one forgotten. */
    | 'relations.get'
    | 'relations.set'
    | 'relations.remove'
    /** The history alone cleared, the values kept (80, Multihog's Clear Log). */
    | 'relations.clearLog'

export interface RequestMessage {
    channel: typeof CHANNEL
    kind: 'request'
    id: string
    op: RequestOp
    params?: Record<string, unknown>
}

export interface ResponseMessage {
    channel: typeof CHANNEL
    kind: 'response'
    id: string
    ok: boolean
    data?: unknown
    error?: string
}

/** Unsolicited backend -> frontend notifications. */
export interface EventMessage {
    channel: typeof CHANNEL
    kind: 'event'
    name:
        | 'settings.changed'
        | 'tracker.changed'
        | 'tracker.started'
        | 'prefs.changed'
        | 'portraits.changed'
        /** A relationship value moved, from whichever hand (44): the fold re-reads. */
        | 'relationships.changed'
        /** Awards placed by the tracker's block or the narrator's inline line (78c): the float feedback. */
        | 'relationships.awarded'
        | 'agent.started'
        | 'agent.finished'
        | 'agent.undone'
        /** The agent's tools (71c): a full audit's chunk begun, skipped or done; an undone pass written back. */
        | 'agent.audit.progress'
        | 'agent.redone'
        | 'dice.rolled'
        /** World Progression (roadmap row 8): a report started, and one finished. */
        | 'world.started'
        | 'world.finished'
        /** The Map Architect (row 9, Phase 34a): a map started, and one finished. */
        | 'map.architect.started'
        | 'map.architect.finished'
        /** The Map Updater (34b): a pass started, and one finished. */
        | 'map.updater.started'
        | 'map.updater.finished'
        /** Map Evolution (34c): a pass started, and one finished. */
        | 'map.evolution.started'
        | 'map.evolution.finished'
        /** The Testing Ground (71d): one tick of a simulate, as it goes. */
        | 'map.sandbox.progress'
        /** The terminal (71b): one step of a pass, as it happens. */
        | 'terminal.step'
        /** The scene picture (49): a draw started, and one finished, pressed or on its own. */
        | 'scene.picture.started'
        | 'scene.picture.finished'
        /** A library card's photo drawn (60-bis): the draw started, and finished; the head's Picture light reads them. */
        | 'library.photo.started'
        | 'library.photo.finished'
        /** A portrait drawn as it appears (61), on its own or on a press: the draw started, and finished. */
        | 'portrait.draw.started'
        | 'portrait.draw.finished'
    data?: unknown
}

export type Message = RequestMessage | ResponseMessage | EventMessage

export function isRequest(value: unknown): value is RequestMessage {
    const m = value as Partial<RequestMessage> | null
    return !!m && m.channel === CHANNEL && m.kind === 'request' && typeof m.id === 'string' && typeof m.op === 'string'
}

export function isResponse(value: unknown): value is ResponseMessage {
    const m = value as Partial<ResponseMessage> | null
    return !!m && m.channel === CHANNEL && m.kind === 'response' && typeof m.id === 'string'
}

export function isEvent(value: unknown): value is EventMessage {
    const m = value as Partial<EventMessage> | null
    return !!m && m.channel === CHANNEL && m.kind === 'event' && typeof m.name === 'string'
}

/** Payload of a successful `settings.get` / `settings.patch` / `settings.reset`. */
export interface SettingsResult {
    settings: Record<string, unknown>
}

/** What the last tracker pass did, so the panel can say so. */
/**
 * What a Stop press did.
 *
 * `stopped` is false when nothing was running — the honest answer, rather than
 * claiming to have cancelled nothing. A pass that had already finished its
 * model call and moved on to writing also reports false, because by then there
 * is genuinely nothing left to stop.
 */
/** One connection profile, as the panel's dropdowns need it. */
export interface ConnectionChoice {
    id: string
    name: string
    /** Shown beside the name, because "Fast" tells you nothing on its own. */
    model: string
    isDefault: boolean
}

/**
 * The connections a user can point a pass at.
 *
 * `unavailable` rather than an error when the host will not list them: the
 * dropdown is an optimisation, and a panel that fails to load because a
 * secondary control could not be populated would be worse than one that says
 * why the control is empty.
 */
export interface ConnectionsResult {
    connections: ConnectionChoice[]
    unavailable?: string
}

export interface CancelResult {
    stopped: boolean
}

export interface TrackerPassReportDTO {
    status: 'updated' | 'no-change' | 'skipped' | 'failed' | 'cancelled'
    at: string
    reason?: string
    replaced?: string[]
    added?: string[]
    removed?: string[]
    /** Members moved onto the benched roster this pass, and off it, by name. */
    benched?: string[]
    unbenched?: string[]
    /** Bench or unbench commands that named nobody on either roster. */
    unmatched?: string[]
    /** Set on a pass the user instructed from the send bar. Absent otherwise. */
    trigger?: 'direct'
    /** Quests dropped from the memo because they finished. Titles, for the panel. */
    archived?: string[]
    /** Relationship awards the pass placed (44), in words: `Marcus Vane friendship +5 (now +45)`. */
    relations?: string[]
    /** Names in the pass's `[RELATIONS]` block that no entry matched. */
    relationsUnmatched?: string[]
    /** The opening of the model's reply, when it could not be parsed. */
    sample?: string
}

/**
 * Payload of the `tracker.started` event.
 *
 * Sent when a pass begins rather than when it ends. A pass that runs after a
 * reply is otherwise entirely invisible until it finishes minutes later — the
 * only way to tell "still working" from "did nothing" was to wait and see
 * whether an `updated` line eventually appeared. `trigger` separates the pass
 * the user asked for from the one the turn caused, because only the second one
 * needs announcing: the panel already knows about the button it disabled.
 */
export interface TrackerPassStartedDTO {
    chatId: string
    /** When it started, ISO 8601. */
    at: string
    trigger: 'reply' | 'manual' | 'direct'
}

/** Payload of a successful `tracker.get` / `tracker.setMemo` / `tracker.run`. */
export interface TrackerResult {
    /** The chat's memo, or `''` for a chat with no tracked turn yet. */
    memo: string
    /** When it was last written, ISO 8601. */
    updatedAt: string
    /** Absent when no pass has ever run for this chat. */
    lastPass?: TrackerPassReportDTO
    /**
     * The chat's finished quests, newest first.
     *
     * They are not in the memo — the tracker pass strips a quest out of it as
     * soon as it is over — so they travel beside it and are folded back in by
     * `buildTrackerView`. Empty for a chat that has finished none.
     */
    archivedQuests?: Quest[]
}

/** The memo as it stood after one message was tracked. */
export interface MemoSnapshotDTO {
    messageId: string
    memo: string
    /** When the pass wrote it, ISO 8601. */
    at: string
}

/**
 * Payload of a successful `tracker.history`.
 *
 * What the cards under old messages are drawn from. The live memo answers "what
 * is true now"; these answer "what was true then", which is a question nothing
 * in the tracker could answer until the history was kept.
 */
/** Payload of `reports.history` (47e): the last thirty reports of each, newest first. */
export interface ReportsHistoryResult {
    tracker: TrackerPassReportDTO[]
    agent: AgentRunResult[]
}

export interface TrackerHistoryResult {
    snapshots: MemoSnapshotDTO[]
}

/**
 * Payload of `agent.run`.
 *
 * One manual pass of the Lorebook Agent. Manual on purpose: the first thing
 * that writes to a campaign should be a thing the user presses and watches.
 */
export interface AgentRunResult {
    at: string
    outcome: 'committed' | 'no-commit' | 'unreadable' | 'failed' | 'cancelled'
    summary: string
    /** What the agent did, in order, for the fold under the summary. */
    steps: Array<{ kind: string; text?: string; name?: string; argument?: string; reply?: string }>
    turnsUsed: number
    /** Addresses written and deleted, and books created. Absent without a commit. */
    write?: { changed: string[]; deleted: string[]; createdBooks: string[]; refused: string[] }
    problems: string[]
    /** Absent when the build cannot run a pass at all. */
    unavailable?: string
}

/**
 * Payload of `agent.undo`.
 *
 * Putting the books back as the last pass found them. The maintainer asked for
 * this before the agent existed, and a single live pass has since written 28
 * entries, rewritten three and deleted one — which is the argument.
 */
export interface AgentUndoResult {
    at: string
    /** One line, in words. */
    summary: string
    /** Whether anything actually changed. */
    undone: boolean
    problems: string[]
    /** Absent when the build cannot undo at all. */
    unavailable?: string
    /** How many undone passes wait for a redo (71c): the legacy's `[ -N ]`. */
    waiting?: number
}

/** Payload of `agent.redo` (71c). */
export interface AgentRedoResult {
    at: string
    summary: string
    redone: boolean
    problems: string[]
    unavailable?: string
    waiting?: number
}

/** Payload of `agent.audit` (71c): the full audit's outcome, once every chunk has run. */
export interface AgentAuditResult {
    at: string
    status: 'complete' | 'stopped' | 'nothing' | 'failed' | 'busy'
    chunks: number
    done: number
    skipped: number
    /** One line per chunk's pass. */
    summaries: string[]
    reason?: string
    unavailable?: string
}

/** Payload of `campaign.clone` (71c). */
export interface CampaignCloneResult {
    newPrefix: string
    cloned: string[]
    errors: string[]
    refused?: string
    unavailable?: string
}

/**
 * Payload of `lore.activated`.
 *
 * What Lumiverse itself decided to load for this chat, and by which mechanism.
 * Read-only, and it activates nothing: the extension is asking the host what it
 * already did.
 */
export interface ActivatedLoreResult {
    entries: Array<{
        id: string
        comment: string
        keys?: string[]
        source: 'keyword' | 'vector'
        score?: number
        bookId?: string
        /** Always loaded, rather than matched by anything. Enriched, so optional. */
        constant?: boolean
        /** Eligible for matching by meaning at all. Enriched, so optional. */
        vectorized?: boolean
    }>
    /**
     * How many entries in the books in play are eligible for vector matching.
     *
     * The difference between "meaning found nothing" and "meaning was never
     * switched on", which are the same empty list and completely different
     * problems. Absent when the entries could not be read.
     */
    eligibility?: { vectorized: number; total: number }
    /** Absent when the host cannot answer — a missing grant, or an older build. */
    unavailable?: string
}

/**
 * Payload of the three `portraits.*` ops.
 *
 * The whole chat's map every time, because it is small, the panel redraws from
 * it wholesale, and a set that answered with only the entity it changed would
 * leave the caller to merge — which is where a stale map comes from.
 */
export interface PortraitsResult {
    /** Normalized entity name -> image reference. */
    portraits: Record<string, string>
}

/**
 * Payload of `prefs.get` / `prefs.patch`, and of the `prefs.changed` event.
 *
 * Display preferences are deliberately *not* cartridge settings: the cartridge
 * surface is the legacy build's 49 keys and closed (see `prefs-store.ts`), and
 * "do I want a card under every message" is a property of this install rather
 * than of the game being played.
 */
/**
 * Payload of `cyoa.choices`: the choices each narrator reply in the chat
 * offers, for the buttons under it. Replies without a `<choices>` block are
 * left out. Roadmap row 6.
 */
export interface CyoaChoicesResult {
    messages: Array<{ messageId: string; choices: string[] }>
}

/** Payload of `wizard.draft`: the system the model drafted, both halves, for the panel to edit and save. */
export interface WizardDraftResult {
    draft: WizardDraft
}

/** Payload of `wizard.revise`: the halves the model rewrote. Absent halves were not asked for. */
export interface WizardReviseResult {
    halves: { gmTag?: string; gmContent?: string; trackerTag?: string; trackerContent?: string; trackerLabel?: string; trackerIcon?: string }
}

/** Payload of `cyoa.choose`: the user message the choice became. */
export interface CyoaChooseResult {
    messageId: string
}

export interface PrefsResult {
    /**
     * The cartridge's settings, only when the change moved one (63b): the
     * present-NPCs toggle swaps a shipped location prompt to its matching
     * variant, as the legacy does, and the panel re-seeds its editors from this.
     */
    settings?: Record<string, unknown>
    prefs: {
        messageCards: boolean
        /** The PARTY card compact: portrait, name and HP only (47e-ter). Absent reads as off. */
        partyCompact?: boolean
        /** The display regex that hides the `<choices>` block in the host's library (65). Absent reads as on. */
        choicesDisplayRegex?: boolean
        /** Per-bar choices keyed by `data-rt-bar-id`, in Multihog's shape since 74i: the mode, the colour and the gradient's second, the percentage readout, the change animation. */
        bars: Record<string, { mode?: 'solid' | 'gradient' | 'dynamic'; color?: string; color2?: string; showAsPercentage?: boolean; animateChanges?: boolean }>
        /** What the user called each chat's campaign, keyed by chat id. */
        campaignNames?: Record<string, string>
        /** Messages of history the Lorebook Agent reads. `0` for the whole chat. */
        agentLookback?: number
        /** How much story a tracker pass reads: the exchange, or a fixed count. */
        trackerLookbackMode?: 'since-last-user' | 'fixed'
        /** The panel's layout (47b, 47c): one tab with everything; the play tab and the rest; or the two widgets and one tab. */
        layout?: 'classic' | 'tabs' | 'widgets'
        /** The panel's visual theme (74a): one of THEME_IDS; `native` is the host's own colours. */
        trackerTheme?: ThemeId
        /** The tracker's font size in px (74e): the tracker widget, the play tab, the cards under the messages; 0 is the host's. */
        trackerFontSize?: number
        /** The second widget's font size in px (90): the Lorebook Agent, Campaign Records and Visuals/Map box; it sized with the settings tab before. 0 is the host's. */
        agentFontSize?: number
        /** The settings tab's font size in px (74e; the second widget's too until 90); 0 is the host's. */
        settingsFontSize?: number
        /** The day/night cycle (74c): tint every root and show the sky badge by the memo's `[TIME]` clock. Off, as Multihog ships it. */
        dayNightCycle?: boolean
        /** The choice buttons' backing (74c-ter, 74c-quater; departure 154): what a theme or the day/night phase does to the choice buttons under the replies — `tinted` (the translucent accent), `solid` (the theme's background behind them) or `hover` (that backing while the list is hovered). `tinted`. */
        choicesBacking?: 'tinted' | 'solid' | 'hover'
        /** The XP bar at the bottom (74f): the XP card's row pinned at the foot of the tracker's box, the card left out. On, as Multihog's `xpBarAtBottom` ships. */
        xpBarAtBottom?: boolean
        /** The animated bars (74h): gains and losses shown on every custom `((BAR))` and `((BARREL))` as they land. On, as Multihog's `animateAllCustomBarChanges` ships. */
        animateAllCustomBarChanges?: boolean
        /** The Display Groups (75): Multihog's display-only bundling of module cards under one shared header — the master switch, the gaps between grouped modules, and the groups themselves. Off, off and none, as the legacy ships. */
        displayGroupsEnabled?: boolean
        displayGroupsShowGaps?: boolean
        displayGroups?: DisplayGroup[]
        /** Tab Mode (76): Multihog's `panelLayoutMode` — the tracker's cards stacked, or Character and Combat pinned above a tab strip holding the rest. `stack`, as the legacy ships. */
        panelLayoutMode?: 'stack' | 'tabs'
        /** The tab Tab Mode shows (76): a module's tag or a group's virtual key; `''` is the first. */
        trackerActiveTab?: string
        /** The Map Themes (74g): the persistent maps' colours and canvas image, Multihog's `mapTheme`; the saved presets by name; the preset the theme was loaded from (`''` for Custom). */
        mapTheme?: MapTheme
        savedMapThemePresets?: Record<string, MapTheme>
        activeMapThemePresetId?: string
        /** The backdrops (74d): the art behind the tracker's box and behind the second box, each a day image, a night image and a tint strength. */
        trackerBackdrop?: Backdrop
        settingsBackdrop?: Backdrop
        /** The AI Theme Wizard's theme (74b), the legacy's `--rt-custom-*` keys to CSS values; null for none. */
        customTheme?: Record<string, string> | null
        /** The wizard's library (74b): saved themes by name. */
        savedThemes?: Record<string, Record<string, string>>
        /** Where each floating widget was last left (47c), by name, in viewport pixels. */
        widgetPositions?: Record<string, { x: number; y: number }>
        /** Each floating widget's size (47c-bis), by name, in pixels, as last dragged by its grip. */
        widgetSizes?: Record<string, { width: number; height: number }>
        /** Which floating widgets are folded to their heads (57), by name. */
        widgetMinimized?: Record<string, boolean>
        /** Messages read when the lookback mode is `fixed`. */
        trackerLookbackCount?: number
        /** Connection the tracker's model call runs on. `''` for the default. */
        trackerConnectionId?: string
        /** Connection the agent's turns run on. `''` for the default. */
        agentConnectionId?: string
        /** Model calls one agent pass may make, in sequence. Its speed dial. */
        agentMaxTurns?: number
        /** Replies between automatic agent passes. `0` switches them off. */
        /** The model's replies between automatic tracker passes. Minimum 1. */
        trackerRunEvery?: number
        /** Where the last tracker pass got to, per chat. */
        trackerWatermarks?: Record<string, number>
        agentRunEvery?: number
        /** Messages an instructed tracker pass reads. `0` reads none. */
        trackerDirectLookback?: number
        /** The newest narrator replies the scene's name scan reads (52), 1 to 20. */
        sceneLookback?: number
        /** The scene picture drawn on its own after a reply (49): the legacy's Real-Time Mode. Off by default. */
        scenePictureAuto?: boolean
        /** When it draws (49): on arriving at a place with no picture; whenever the place changes; or every N replies besides. */
        scenePictureTrigger?: 'location_enter' | 'location_change' | 'every_n_outputs'
        /** N for `every_n_outputs` (49), 1 to 50. */
        scenePictureEveryN?: number
        /** Whether the NPCs present go into the picture's prompt (49); the player always does. */
        scenePicturePresentNpcs?: boolean
        /** The host's image connection the picture is drawn on (49). `''` for the host's default. */
        scenePictureConnectionId?: string
        /** Multihog's *Skip Prompt Edit Dialog* (73f): on, a pressed draw draws at once; off (the default), the prompt is shown for editing first. */
        portraitSkipPromptDialog?: boolean
        /** Multihog's *Use Location Images as Chat Background* (73f): the place's picture laid behind the chat. Off by default. */
        portraitLocationBackground?: boolean
        /** Whether a campaign book is attached to the narrator's card as it is made (55). On by default. */
        attachBooksToCard?: boolean
        attachBooksTarget?: 'chat' | 'card'
        /** Messages an instructed agent pass reads. `0` for the whole chat. */
        agentDirectLookback?: number
        /** The portraits drawn as they appear (61): the legacy's four switches, off by default. */
        portraitAutoPlayer?: boolean
        portraitAutoParty?: boolean
        portraitAutoEnemies?: boolean
        portraitAutoNpcs?: boolean
        /** Whether the recent story, the persona and the lore go into a portrait's prompt (61); off, as the legacy's. */
        portraitStoryLookback?: boolean
        /** How many messages of it (61), 0 to 100; 5 as the legacy's. */
        portraitStoryLookbackCount?: number
        /** The host's image connection a portrait is drawn on (61); `''` for the scene picture's, then the host's default. */
        portraitConnectionId?: string
        /** The text connection that writes a portrait's prompt (61); `''` for the agent's. */
        portraitPromptConnectionId?: string
        /** Multihog's *Inject Lorebooks* into the tracker (73h), and the filter's book names; empty reads every book. */
        trackerInjectLorebooks?: boolean
        trackerLorebookFilter?: string[]
        /** Messages the game system wizard reads for context. `0` for none. */
        wizardLookback?: number
        /** Every message, the count ignored (73g). */
        wizardLookbackAll?: boolean
        /** The lore the host has active for the chat (73g). */
        wizardInjectLore?: boolean
        /** Existing module prompts as formatting examples, and which (73g). */
        wizardInjectModulePrompts?: boolean
        wizardModuleExampleKeys?: string[]
        /** Whether the wizard is shown the tracker's memo. */
        wizardInjectMemo?: boolean
        /** The user's own architect prompt for the wizard. `''` for the stock. */
        wizardSystemPrompt?: string
        /** World Progression (roadmap row 8). See `prefs-store.ts`. */
        worldProgressionEnabled?: boolean
        worldProgressionIntervalHours?: number
        worldProgressionKeepActive?: number
        worldProgressionLookback?: number
        worldProgressionHistoryLookback?: number
        worldProgressionLocationsPerReport?: number
        worldProgressionLocationRandomize?: boolean
        worldProgressionExclusionList?: string
        worldProgressionConsolidateEnabled?: boolean
        worldProgressionConsolidateInterval?: number
        /** The World Skeleton (33b). See `prefs-store.ts`. */
        worldSkeletonFactions?: number
        worldSkeletonLocations?: number
        worldSkeletonConflicts?: number
        worldSkeletonSystemPrompt?: string
        worldSkeletonUseLorebooks?: boolean
        worldSkeletonLorebookOnly?: boolean
        worldSkeletonLorebookFilter?: string
        worldSkeletonUseExisting?: boolean
        worldSkeletonSourceLookback?: number
        /** The Map Architect (Phase 34a). See `prefs-store.ts`. */
        mapArchitectLookback?: number
        mapArchitectSystemPrompt?: string
        /** The Map Updater (Phase 34b). See `prefs-store.ts`. */
        mapUpdaterEnabled?: boolean
        /** The map on screen (Phase 34d): Reveal all. */
        mapRevealAll?: boolean
        /** The relationship system (44): the scale (150), the update mode, and the user's own tracker instruction (`''` for the stock). */
        relationshipMax?: number
        relationshipMode?: 'state_tracker' | 'regex'
        relationshipTrackerPrompt?: string
        mapUpdaterRunEvery?: number
        mapUpdaterLookback?: number
        mapUpdaterSystemPrompt?: string
        /** Map Evolution (Phase 34c). See `prefs-store.ts`. */
        mapEvolutionEnabled?: boolean
        mapEvolutionIntervalHours?: number
        mapEvolutionOnSiteIntervalHours?: number
        mapEvolutionOnSiteIntervalMinutes?: number
        mapEvolutionOnSitePreset?: 'dynamic' | 'standard'
        mapEvolutionScope?: 'active' | 'count' | 'all' | 'selected'
        mapEvolutionCount?: number
        mapEvolutionRandomize?: boolean
        mapEvolutionSelectedRoots?: string
        mapEvolutionWorldReportLookback?: number
        mapEvolutionSystemPrompt?: string
        mapEvolutionCompressEnabled?: boolean
        mapEvolutionCompressThreshold?: number
        mapEvolutionNarratorCommitTokens?: number
        /** The character creator (Phase 35). See `prefs-store.ts`. */
        creatorDraft?: Record<string, unknown> | null
        creatorPresets?: Array<{ id: string; name: string; data: Record<string, unknown> }>
        creatorLevel?: number | 'none'
        creatorGearTier?: string
        creatorCombatScalingGuide?: boolean
        creatorInitialDate?: string
        creatorInitialTime?: string
        creatorConnectionId?: string
        /** Map Evolution's own text connection (45c); `''` for the agent's. Mirrored in the Connections category (63). */
        mapEvolutionConnectionId?: string
        /** Instant Action (35a): the genre last chosen, and whether Begin sends the opening message. */
        creatorGenre?: string
        creatorSendStarter?: boolean
        /** Instant Action's level (45d): a roll of 1 to 10 when true, level 1 otherwise. */
        creatorInstantRandomLevel?: boolean
        /** The Player Card and the persona (35b): whether the creator writes them, and the card's word count. */
        creatorPlayerCard?: boolean
        creatorPersona?: boolean
        creatorCardWords?: number
        /** The other ways to begin (35c): the name and instructions typed, kept as a draft. */
        creatorWaysDraft?: { name?: string; instructions?: string } | null
        /** The NPC creator (41a): what Add as is does with a host card, the legacy's `npcAddAsIsMode`. */
        npcAddAsIsMode?: 'literal' | 'ai_review'
    }
}

/** What one of the other ways to begin did (35c). */
export interface WaysResult {
    status: 'written' | 'failed'
    at: string
    way: 'persona' | 'custom'
    /** The character's name as the sheet gives it, or as asked. */
    name: string
    /** The persona the character was made from, for the persona way. */
    source?: string
    added?: string[]
    replaced?: string[]
    card?: CardResult
    persona?: PersonaResult
    reason?: string
}

/** A library card as the fold shows it (41). */
export interface LibraryRecordView {
    id: string
    name: string
    keys: string[]
    content: string
    portraitPath: string
    notes: string
    createdAt: number
    updatedAt: number
    /** The species and body, then the personality: the legacy's list line. */
    blurb: string
}

/** What a chat offers the library (41): the campaign's NPC entries and its Player Card. */
export interface LibrarySources {
    /** The NPC book's name, or `''` when the campaign has none yet. */
    book: string
    entries: Array<{ id: string; name: string; blurb: string; core: boolean }>
    playerCard: { name: string; blurb: string } | null
    /** Why the book could not be read, when it could not. */
    error?: string
}

/** What putting a library card into play did (41). */
export interface LibraryActionResult {
    status: 'done' | 'failed'
    at: string
    action: 'party' | 'pc'
    /** The card's name, or the sheet's for Play as PC. */
    name: string
    added?: string[]
    replaced?: string[]
    /** The Player Card set by Play as PC. */
    card?: CardResult
    /** Whether the card's portrait was placed on the entity. */
    portrait?: boolean
    reason?: string
}

/** What a card's photo op did (60). */
/** A card's photo prompt written for editing (73f): the name and the text, nothing drawn. */
export interface LibraryPhotoPromptResult {
    name: string
    prompt: string
}

export interface LibraryPhotoResult {
    /** The record as it stands after the op. */
    record: LibraryRecordView
    /** Whether the photo was placed on the open chat's entity of the card's name too. */
    placed: boolean
    /** The image prompt the model wrote, for a draw. */
    prompt?: string
    provider?: string
    model?: string
    /** The size asked for (`896×1344`), `''` when none could be. */
    size?: string
    /** Why no size could be asked for, when none was. */
    sizeNote?: string
}

/** What naming a campaign did (51). */
export interface CampaignNameResult {
    /** The stored name, typed or minted; `''` when nothing could be named yet (51-bis), with `reason`. */
    name: string
    /** Why no name was made, when `name` is empty. */
    reason?: string
    /** Whether this call made it. */
    minted: boolean
    /** The prefix the chat's books take from it. */
    prefix: string
}

/** The scene (42): the place the party is in, and who is present now. */
export interface SceneResult {
    at: string
    location: {
        /** The footer's or the memo's text, `''` when neither says. */
        raw: string
        /** The place book's path it resolved to, `''` when none matched. */
        path: string
        leaf: string
        breadcrumb: string
        /** Where the place's picture is kept. */
        storagePath: string
        /** The picture's address, `''` without one. */
        image: string
        /** `Book::uid` of the place's entry, `''` when unresolved. */
        entryId: string
        /** The entry's text, its map section stripped. */
        content: string
    }
    present: Array<{
        id: string
        label: string
        portrait: string
        isPlayerCharacter: boolean
        content: string
        /** Which reply of the window named them (52): 0 the latest, 1 the one before. Absent for the player, who is always present. */
        ago?: number
    }>
    /** How many narrator replies the scan read (52): the preference, or fewer when the chat is shorter. */
    window?: number
    /** The mapped site the party is inside, from the Maps fold's state, or `''`. */
    mapSite: string
    /** The place and NPC books read. */
    books: string[]
    /** Why a book could not be read, when one could not. */
    problem?: string
    /** A picture being drawn for the chat right now (49): the place and when it began. */
    drawing?: { path: string; at: string }
}

/** A picture drawn for the scene (49). */
/** The scene picture's prompt written for editing (73f): the place and the text, nothing drawn. */
export interface ScenePromptResult {
    path: string
    leaf: string
    prompt: string
}

export interface SceneDrawResult {
    scene: SceneResult
    path: string
    leaf: string
    at: string
    /** The image prompt the model wrote. */
    prompt: string
    provider: string
    model: string
}

/** What a draw did (49), pressed or on its own, for the `scene.picture.finished` event. */
export interface ScenePictureReport {
    chatId: string
    path: string
    leaf: string
    at: string
    trigger: 'pressed' | 'arrival' | 'change' | 'outputs'
    outcome: 'drawn' | 'failed'
    prompt?: string
    provider?: string
    model?: string
    reason?: string
    /** A draw on its own that failed switched the mode off (49): the legacy fails closed. */
    disabled?: boolean
}

/** What a portrait's draw did (61), on its own or on a press, for the `portrait.draw.finished` event and the status. */
export interface PortraitDrawReport {
    chatId: string
    name: string
    at: string
    /** Who asked: a switch (which one), or Draw pressed on a row. */
    source: 'player' | 'party' | 'enemy' | 'npc' | 'pressed'
    outcome: 'drawn' | 'failed'
    prompt?: string
    provider?: string
    model?: string
    /** The size asked for (`896×1344`), `''` when none could be. */
    size?: string
    sizeNote?: string
    reason?: string
}

/** Payload of `portraits.draw` (61): the draw that landed. */
/** A portrait's prompt written for editing (73f): the name and the text, nothing drawn. */
export interface PortraitPromptResult {
    name: string
    prompt: string
}

export interface PortraitDrawResult {
    name: string
    at: string
    prompt: string
    provider: string
    model: string
    size: string
    sizeNote?: string
}

/** Payload of `portraits.auto.status` and `portraits.auto.check` (61). */
export interface PortraitAutoStatus {
    /** The draw in flight for this chat, if any. */
    drawing: Array<{ name: string; at: string }>
    /** The names waiting behind it, in order. */
    queued: string[]
    /** The last outcome per name (normalized), this session. */
    last: Record<string, PortraitDrawReport>
}

/** The campaign's lorebooks and whether the narrator can see them (55). */
export interface CampaignBooksResult {
    prefix: string
    /** The narrator's card the books attach to, or `null` when the chat's card is not known. */
    card: { id: string; name: string } | null
    books: Array<{
        /** The category: `NPC`, `LOC`, a custom tag, `World`… */
        kind: string
        name: string
        /** The host's id, `null` while the book is not made. */
        id: string | null
        /** `adoptable` (56): a book named as this campaign's that another campaign made — Adopt makes it this one's. */
        state: 'missing' | 'attached' | 'detached' | 'adoptable'
        /** What attaches it: the chat's record, the card, the persona, the global list. */
        sources: Array<'chat' | 'character' | 'persona' | 'global'>
    }>
    /** Where Attach and the sweep attach (55-ter): the chat's record, or the narrator's card. */
    target: 'chat' | 'card'
    /** Whether the chat's record was read and its attachment list is writable; `problem` says why not. */
    chatScope: boolean
    /** What could not be read, when something could not. */
    problem?: string
}

/** The host's image connections (49), for the fold's select. */
export interface SceneConnectionsResult {
    connections: Array<{
        id: string
        name: string
        provider: string
        model: string
        isDefault: boolean
        /** What the host saves with the connection and merges into every draw, as `key: value` (55-bis). */
        settings?: string[]
        /** The keys of the connection's metadata, where the host may keep what its own panel saves (55-bis). */
        metadata?: string[]
    }>
    unavailable?: string
}

/** The relationship system (44): every NPC with a standing, for the fold. */
export interface RelationshipsView {
    at: string
    /** The cartridge's `npcRelationshipBars`. */
    enabled: boolean
    mode: 'state_tracker' | 'regex'
    /** The scale: both axes run from `-max` to `+max`. */
    max: number
    updatedAt: string
    npcs: Array<{
        /** `Book::uid`. */
        id: string
        label: string
        friendship: number
        affection: number
        friendshipTier: { label: string; hint: string }
        affectionTier: { label: string; hint: string }
        /** Newest first, fifty deep. */
        log: Array<{ at: string; field: 'friendship' | 'affection'; delta: number; applied: number; newValue: number; source: 'tracker' | 'narrative' | 'agent' | 'manual' }>
    }>
}

/** Where an NPC comes from (41a): a host card, a library record, a concept or a story role. */
export type NpcSource =
    | { kind: 'card'; characterId: string }
    | { kind: 'library'; id: string }
    | { kind: 'freeform'; name: string; description: string }
    | { kind: 'archetype'; archetype: string; name: string; concept: string }

/** What one model call drafted (41a): the tag for the preview, or why there is none. */
export interface NpcDraftResult {
    status: 'drafted' | 'failed'
    at: string
    how: 'fit' | 'freeform' | 'archetype'
    /** The card's or record's name, or what the request was: *the concept*, the archetype. */
    source: string
    /** The name the tag gives, or the one typed. */
    name: string
    /** The model's reply whole, holding the `[[NPC: …]]` tag, as the preview shows it. */
    tag?: string
    /** Whether the NPC book already has an entry of that name. */
    duplicate?: boolean
    reason?: string
}

/** What adding an NPC did (41a). */
export interface NpcAddResult {
    status: 'added' | 'exists' | 'failed'
    at: string
    name: string
    /** The NPC book's name. */
    book?: string
    /** `Book::uid` of the entry made. */
    entryId?: string
    how: 'literal' | 'reviewed' | 'fit' | 'freeform' | 'archetype'
    /** Whether the card's portrait was placed on the entity. */
    portrait?: boolean
    reason?: string
}

/** A character card the host holds, as the import list shows it (39). */
export interface CardChoice {
    id: string
    name: string
    /** The opening of the description or the personality, cut short. */
    snippet: string
}

/** What importing a character card did (39). */
export interface ImportResult {
    status: 'written' | 'failed'
    at: string
    /** The character's name as the sheet gives it, or the card's. */
    name: string
    /** The card's name. */
    source: string
    mode: 'minimal' | 'full'
    added?: string[]
    replaced?: string[]
    card?: CardResult
    persona?: PersonaResult
    /** Whether the card's avatar was placed as the character's portrait (43). */
    portrait?: boolean
    reason?: string
}

/** What writing or saving the Player Card did (35b). */
export interface CardResult {
    status: 'written' | 'removed' | 'failed'
    at: string
    name: string
    /** The words the card holds, as written. */
    words?: number
    reason?: string
}

/** What making the persona did (35b). */
export interface PersonaResult {
    status: 'active' | 'failed'
    at: string
    name: string
    /** The host's id of the persona made active (76-ter): the first message is sent as it, whether or not the host's own view has refreshed. */
    id?: string
    created?: boolean
    reason?: string
}

/** The Player Card as the panel shows it (35b). */
export interface PlayerCardView {
    card: { name: string; bio: string; wordCount: number; at: string } | null
    /** The persona AdventureTime made or chose for this chat, if any. */
    persona: { id: string; name: string; at: string } | null
    /** Whether the host lets AdventureTime make personas at all. */
    personasAvailable: boolean
    /** The host's active persona's name, or '' when none or unknown. */
    activePersona: string
    /** Whether the active persona carries a description of its own, which Lumiverse sends beside the card. */
    activeDescribed: boolean
}

/** What Instant Action did (35a): the rolled choices, the sheet, and whether the adventure began. */
export interface InstantResult {
    status: 'ready' | 'failed'
    at: string
    genre: string
    className: string
    /** The rolled level, or `null` for a system without levels. */
    level: number | null
    /** The character's name as the sheet gives it, or as given. */
    name: string
    /** Whether the opening message was sent and the reply started. */
    started: boolean
    messageId?: string
    added?: string[]
    reason?: string
    /** What the Player Card and the persona steps did (35b), in words; absent when not attempted. */
    card?: CardResult
    persona?: PersonaResult
}

/** What the character creator did (Phase 35): the sheet written, or why not. */
export interface CreatorResult {
    status: 'written' | 'failed'
    /** What the Player Card and the persona steps did (35b); absent when not asked for. */
    card?: CardResult
    persona?: PersonaResult
    /** When, ISO 8601. */
    at: string
    /** The character's name as the sheet gives it; `''` when the sheet names none the reader can find. */
    name: string
    /** The blocks the pass added and replaced, when written. */
    added?: string[]
    replaced?: string[]
    reason?: string
}

/** What one World Progression pass did (roadmap row 8). */
export interface WorldRunResult {
    status: 'written' | 'duplicate' | 'skipped' | 'failed' | 'cancelled'
    at: string
    trigger: 'automatic' | 'manual'
    periodLabel?: string
    selectedLocations?: string[]
    consolidated?: string
    reason?: string
}

/** What one World Skeleton generation did (33b). */
export interface WorldSkeletonResult {
    status: 'written' | 'failed' | 'cancelled' | 'skipped'
    at: string
    mode: 'replace' | 'append'
    count?: number
    factions?: number
    locations?: number
    conflicts?: number
    reason?: string
}

/** Payload of `world.skeletonSource` (33c): the paragraph a model wrote from the chat, or why not. */
export interface WorldSourceResult {
    status: 'written' | 'failed' | 'cancelled' | 'skipped'
    at: string
    source?: string
    reason?: string
}

/** Payload of `books.list` (73h): every book the host has, sorted by name. */
export interface BooksListResult {
    books: Array<{ id: string; name: string }>
}

/** The AI Theme Wizard's answer (74b): the theme as the model wrote it (`--rt-custom-*` keys), kept as `customTheme`. */
/** Edit with AI (78c): the whole revised text, for review before it is applied. */
export interface CardAiEditResult {
    text: string
}

/** One award as `relationships.awarded` carries it (78c): the NPC's label, the axis and the delta asked for, as Multihog floats it. */
export interface RelationshipAward {
    npc: string
    field: 'friendship' | 'affection'
    delta: number
}

export interface ThemeGenerateResult {
    theme: Record<string, string>
    iterated: boolean
    missing: string[]
}

/** Payload of `world.books` (33c): the lorebooks the skeleton may read as canon, this campaign's own marked. */
export interface WorldBooksResult {
    books: Array<{ name: string; own: boolean }>
}

/** What the Map Architect last did (Phase 34a). */
export interface MapArchitectResult {
    status: 'written' | 'reused' | 'failed'
    at: string
    site: string
    kind?: string
    areas?: number
    assets?: number
    entryId?: string
    reason?: string
}

/** What one Map Updater pass did (Phase 34b), and the payload of `map.update`. */
export interface MapUpdaterResult {
    status: 'applied' | 'noop' | 'skipped' | 'failed' | 'undone'
    at: string
    site: string
    trigger: 'reply' | 'exit' | 'manual'
    summary?: string
    operations?: number
    entryId?: string
    reason?: string
}

/** What one Map Evolution pass did (Phase 34c), and the payload of `map.evolve`. */
/**
 * Payload of `map.view` (Phase 34d): one site's map as the player may see
 * it, drawn. The party's site unless the request named one.
 */
export interface MapViewResult {
    /** The site drawn; `''` when the party is outside every map and none was asked for. */
    siteRoot: string
    kind: string
    /** Whether the party is inside the drawn site; only then is their room marked. */
    partyInside: boolean
    /** Rooms the picture holds; 0 means nothing is drawable and `svg` is `''`. */
    rooms: number
    /** The graph as inline SVG, in the legacy's class vocabulary. */
    svg: string
    /** The readable entries, as HTML. */
    entries: string
    /** The site's Map Evolution passes, as HTML. */
    history: string
    /** Reveal all, as the picture was drawn: `true` lifts the knowledge filter. */
    revealAll: boolean
    currentLocation: string
    /** Every mapped site, for the picker. */
    sites: Array<{ siteRoot: string; kind: string }>
    problem?: string
}

/** One entry of Campaign Records (71a), as the browser draws it. */
export interface RecordEntryDTO {
    /** The host's id, which the writes address. */
    id: string
    uid: string
    title: string
    keys: string[]
    /** The prose, with the `[MAP]` section taken out: the raw editor is the map's. */
    content: string
    /** The legacy's estimate: the prose's length over four. */
    tokens: number
    /** The host's constant flag: always in the prompt, whatever the scan finds. */
    pinned: boolean
    disabled: boolean
    hasMap: boolean
    /** A title with no `::`: a site's root, where a map may be made. */
    root: boolean
}

export interface RecordBookDTO {
    id: string
    name: string
    /** The category after the prefix: `NPC`, `LOC`, `World`… */
    category: string
    kind: 'npc' | 'location' | 'world' | 'skeleton' | 'other'
    entries: RecordEntryDTO[]
    tokens: number
}

/** Payload of `records.list` (71a): the campaign's books as folders with their entries. */
export interface CampaignRecordsResult {
    prefix: string
    books: RecordBookDTO[]
    /** The rulebook's mapping section is on: the MAP badges and Add Mapped Location are offered. */
    mapping: boolean
    /** Every mapped site, for a new settlement's peers; a hosted one is not offered. */
    mapped: Array<{ siteRoot: string; kind: string; hosted: boolean }>
    /** Every book the host lists, for the reference context a map may be drawn from. */
    allBooks: string[]
    problem?: string
}

/** Payload of `records.update` and `records.pin`: the entry as it stands now. */
export interface RecordEntryResult {
    entry: RecordEntryDTO
}

/** Payload of `records.removeMap`: the site whose map went, and the root as it stands. */
export interface RecordRemoveMapResult {
    siteRoot: string
    entry: RecordEntryDTO
}

/** Payload of `map.raw.get` (71a): a site's map document as JSON, to edit by hand. */
export interface MapRawResult {
    siteRoot: string
    entryId: string
    bookName: string
    json: string
}

/** Payload of `map.raw.set`: the document as it was saved. */
export interface MapRawSaveResult {
    siteRoot: string
    areas: number
    assets: number
}

/** Payload of `map.create` (71a): what the architect did for a map asked for from the panel. */
/** The terminal's five feeds (71b), Multihog's Terminal/Direct Prompt tabs. */
export type TerminalSource = 'state_tracker' | 'lorebook_agent' | 'map_updater' | 'map_evolution' | 'map_architect'
export type TerminalStepType = 'start' | 'thought' | 'tool' | 'result' | 'error' | 'finish'
export interface TerminalStep {
    source: TerminalSource
    type: TerminalStepType
    content: string
    /** ISO time the step was announced. */
    at: string
    /** How long the pass worked, on a finish or a failure. */
    seconds?: number
}
/** Payload of `terminal.get` and `terminal.clear` (71b): every kept step of the chat, per feed. */
export interface TerminalResult {
    steps: Record<TerminalSource, TerminalStep[]>
}

export interface MapCreateResult {
    status: 'written' | 'reused' | 'failed'
    at: string
    site: string
    kind?: string
    areas?: number
    assets?: number
    entryId?: string
    reason?: string
    /** What Auto filled in before the draw. */
    inferred?: { kind: string; entrance: string; scale: string; threat: string; briefDescription: string }
}

export interface MapEvolutionResult {
    status: 'applied' | 'noop' | 'baseline' | 'skipped' | 'failed' | 'undone'
    at: string
    trigger: 'interval' | 'site_exit' | 'manual'
    currentTime?: string
    sites: Array<{ siteRoot: string; status: 'applied' | 'noop' | 'failed' | 'baseline'; summary?: string; operations?: number; reason?: string; compressed?: number }>
    reason?: string
}

/** Map Evolution's standing in `map.get` (34c): its settings, its clocks in words, and whether a pass runs now. */
export interface MapEvolutionStatus {
    enabled: boolean
    intervalHours: number
    onSiteIntervalHours: number
    onSiteIntervalMinutes: number
    onSitePreset: 'dynamic' | 'standard'
    scope: 'active' | 'count' | 'all' | 'selected'
    count: number
    randomize: boolean
    selectedRoots: string
    worldReportLookback: number
    systemPrompt: string
    compressEnabled: boolean
    compressThreshold: number
    narratorCommitTokens: number
    /** User turns of recent story every due site is shown (45c); 0 for none. */
    storyLookback: number
    /** The connection the passes run on (45c); `''` for the agent's. */
    connectionId: string
    running: boolean
    /** The clock as the memo reads it, the newest site stamp, and the soonest next pass; `''` for none. */
    currentTime: string
    lastFired: string
    nextDue: string
    /** Every mapped site with its interval (71d): the hours the dials give it, and its own when set. */
    sites: Array<{ siteRoot: string; current: boolean; automaticHours: number; overrideHours: number | null }>
}

/** Payload of `map.evolution.interval` (71d): the site's interval after the write. */
export interface MapEvolutionIntervalResult {
    siteRoot: string
    current: boolean
    automaticHours: number
    overrideHours: number | null
}

/** One stored thread as the Testing Ground lists it (71d): the updater's shape. */
export interface SandboxThread {
    id: string
    at: string
    status: 'open' | 'resolved' | 'transformed'
    op: string
    subjectId: string
    actor: string
    cause: string
    summary: string
    compressed: boolean
}

/** Payload of `map.sandbox.get` (71d): the Testing Ground's reading of one site, as the legacy's popup paints it. */
export interface MapSandboxResult {
    timeLabel: string
    minutes: number
    sites: Array<{ siteRoot: string; current: boolean }>
    siteRoot: string
    kind: string
    areas: Array<{ id: string; name: string }>
    assets: Array<{ id: string; name: string; kind: string; state: string; location: string; count?: number; actor?: string; cause?: string; changedAt?: string }>
    /** The kinds the Create entity form offers and the states the Kill / change form does: the document library's. */
    kinds: string[]
    states: string[]
    lastEvolved: string
    elapsed: string
    memory: {
        storedThreads: unknown[]
        storedBacklog: unknown[]
        threadText: string
        backlogText: string
        closedTokens: number
        openTokens: number
        backlogTokens: number
        totalTokens: number
        threshold: number
        compressEnabled: boolean
        overThreshold: boolean
        openCount: number
        digestCount: number
        entryCount: number
        backlogCount: number
    }
    threads: { entries: SandboxThread[]; open: SandboxThread[]; truncated: boolean }
    arcSubjects: Array<{ id: string; name: string; kind: string; state: string; location: string; onMap: boolean; eventCount: number; open: boolean }>
    arc?: { subjectId: string; name: string; asset: { id: string; name: string; kind: string; state: string; location?: string; count?: number } | null; onMap: boolean; open: boolean; events: Array<SandboxThread & { role: 'subject' | 'actor' | 'digest' }>; backlogHits: Array<{ at: string; summary: string; kind?: string }> }
    lastPass: { type: 'evolve' | 'simulate'; siteRoot: string; ticks?: number; hoursPerTick?: number; undone: boolean } | null
    intervalHours: number
    problem?: string
}

/** Payload of the Testing Ground's actions (71d): what one did, or why not. */
export type MapSandboxOutcome =
    | { ok: true; timeLabel?: string; minutes?: number; applied?: number; ticks?: number; hoursPerTick?: number; redone?: boolean; action?: { type: 'evolve' | 'simulate'; siteRoot: string; ticks?: number; hoursPerTick?: number; undone: boolean }; createdAssets?: Array<{ id: string; name: string }> }
    | { ok: false; error: string; skipped?: 'busy' | 'chat_changed' | 'stopped' }

/** Payload of `map.get` (Phase 34): the campaign's mapped sites and the party's place among them. */
export interface MapStatusResult {
    /** The rulebook's mapping section is on, so the blocks are sent. */
    enabled: boolean
    currentLocation: string
    sites: Array<{ siteRoot: string; kind: string; entryId: string }>
    activeSiteRoot: string
    mentionedSiteRoots: string[]
    /** Size of the canon block the narrator is sent, in characters; 0 when none. */
    canonChars: number
    syncedAt: string
    problem?: string
    /** The architect (34a): whether its tool is registered, its opener (46), its two settings, and its last run. */
    architect: { toolRegistered: boolean; opener: 'tool' | 'text'; lookback: number; systemPrompt: string }
    lastArchitect?: MapArchitectResult
    /** The updater (34b): its switch and settings, whether a pass is running now, and its last pass. */
    updater: { enabled: boolean; runEvery: number; lookback: number; systemPrompt: string; running: boolean }
    lastUpdater?: MapUpdaterResult
    /** Evolution (34c): its standing, and its last pass. */
    evolution: MapEvolutionStatus
    lastEvolution?: MapEvolutionResult
    /** Absent when the build cannot read maps at all. */
    unavailable?: string
}

/** Payload of `world.consolidate` (72b): the digest's label and how many reports went into it. */
export interface WorldConsolidateResult {
    label: string
    consolidated: number
}

/** Payload of `narrator.create` (72b): the card, made now or found by name. */
export interface NarratorCardResult {
    id: string
    name: string
    created: boolean
}

/** Payload of `world.purge`: what was emptied. The books stay; their entries go. */
export interface WorldPurgeResult {
    worldBookName: string
    skeletonBookName: string
    worldCleared: number
    skeletonCleared: number
}

/** Payload of `world.get`: the switch, the clock, the window and the last pass. */
export interface WorldStatusResult {
    enabled: boolean
    intervalHours: number
    locationsPerReport: number
    keepActive: number
    lookback: number
    prefix: string
    worldBookName: string
    lastFiredPeriodLabel: string
    nextDueLabel: string
    currentTimeLabel: string
    activeReports: Array<{ label: string; reportId: string }>
    lastRun?: WorldRunResult
    /** The skeleton (33b): its book, what it holds, the user's source text, the generation settings and the last generation. */
    skeletonBookName: string
    skeletonCounts: { factions: number; locations: number; conflicts: number }
    skeletonSource: string
    skeleton: {
        factions: number
        locations: number
        conflicts: number
        systemPrompt: string
        useLorebooks: boolean
        lorebookOnly: boolean
        lorebookFilter: string
        useExisting: boolean
        sourceLookback: number
    }
    lastSkeleton?: WorldSkeletonResult
    /** Absent when the build cannot run World Progression at all. */
    unavailable?: string
}

/** One permission the extension declares, and what it buys. */
export interface PermissionStatusDTO {
    name: string
    /** What stops working without it, in words a user would recognise. */
    needs: string
}

/** One call the narrator made to the dice tool, as the status line shows it. */
export interface DiceCallDTO {
    /** ISO 8601. */
    at: string
    toolName: string
    who: string
    for: string
    formula: string
    dc: number | null
    total: number | null
    verdict: 'success' | 'failure' | 'hit' | 'miss' | null
}

/**
 * Whether the dice tool is on offer to the narrator right now, and what it
 * has been asked. A tool call leaves no trace on screen -- the reply reads the
 * same rolled or simulated -- so this is the only place the question "did it
 * call it?" is answered.
 */
export interface DiceStatusDTO {
    /** Tool names registered with the host right now. */
    registered: string[]
    /**
     * Why nothing is registered, when nothing is: the RNG mode does not ask
     * for a tool; neither tool switch is ticked; combat is on and the queue
     * has taken over; or the host refused (the `tools` permission, usually).
     */
    absent: 'mode' | 'flags' | 'combat' | 'refused' | null
    /** Calls answered since the backend started. */
    calls: number
    last?: DiceCallDTO
    /**
     * The calls made for the reply in progress or just finished, in order —
     * what to hold against the narration. A running total was the first
     * version, and it answered a question nobody was asking.
     */
    turn: DiceCallDTO[]
}

/**
 * Payload of a successful `status.get` — what build is running, and what the
 * host has actually granted it.
 *
 * This exists because two questions came up in every live debugging session so
 * far and neither could be answered from the panel: *did my update take?* and
 * *is the permission actually there?* The answers were in the backend log,
 * which is not somewhere a user goes. Now they are on screen.
 */
export interface StatusResult {
    /** The manifest version of the running build — `spindle.json`'s `version`. */
    version: string
    /** Lumiverse's own version, for when the answer is "not us". */
    host?: string
    /** Declared permissions the host has granted. */
    granted: string[]
    /** Declared permissions the host has *not* granted, and what each costs. */
    missing: PermissionStatusDTO[]
    /**
     * False when the host exposed no permissions API at all, so `granted` and
     * `missing` say nothing. Distinguishes "nothing granted" from "cannot tell",
     * which otherwise look identical — two empty lists.
     */
    checked: boolean
    /** The dice tool, from Phase 28a. Absent from an older backend. */
    dice?: DiceStatusDTO
    /** The stock texts' last check after an update (72a). Absent until one ran. */
    stockUpgrade?: StockUpgradeStatusDTO
    /** The connection a blank row runs on (89), with the reason. Absent from an older backend. */
    passes?: PassConnectionStatusDTO
}

/** What a blank connection row resolves to (89): the checklist's evidence. */
export interface PassConnectionStatusDTO {
    /** The id sent, or null when Lumiverse lists no connection. */
    id: string | null
    name: string
    provider: string
    model: string
    /** The chat's own; the narrator's as last seen; Lumiverse's default-ticked; the first listed; none. */
    why: 'chat' | 'seen' | 'default' | 'first' | 'none'
    /** How many connections Lumiverse lists, or -1 when it would not say. */
    listed: number
    /** The output length preference, sent as max_tokens on every pass; 0 is blank. */
    maxTokens: number
}

/** What the last stock-text check did (72a): refreshed now, kept as edited, or pending with the switch off. */
export interface StockUpgradeStatusDTO {
    refreshed: string[]
    kept: string[]
    pending: string[]
    at: string
}

/** Payload of `maintenance.purgePortraits` (72a). */
export interface PurgePortraitsResult {
    chats: number
    portraits: number
}

/** Payload of `maintenance.orphans` (72a): the chats ours that the host no longer has. */
export interface OrphansResult {
    chatIds: string[]
    prefsEntries: number
}

/** Payload of `maintenance.cleanOrphans` (72a). */
export interface CleanOrphansResult {
    removed: string[]
    files: number
    prefsEntries: number
    prefs: Record<string, unknown>
}

/** Payload of a successful `cartridge.export`. */
export interface CartridgeExportResult {
    /** The cartridge file, already serialized and ready to save or share. */
    file: string
    /** Suggested filename. */
    filename: string
}
