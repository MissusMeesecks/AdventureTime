/**
 * The other mirrored dials (Phase 63c, roadmap row 63): the preferences
 * the folds hold — the tracker's window and cadence, the agent's cadence,
 * window and turns, the wizard's context, the Map Architect's, the
 * Updater's and Evolution's dials, World Progression's and the skeleton's,
 * the character creator's starting choices — each drawn again in its
 * Multihog category, as a declarative row bound to the same preference key
 * the fold saves. One preference, two rows, kept in step by the
 * `prefs.changed` event every save sends (63): a change here shows in the
 * fold through that event, and one made in the fold shows here. The folds
 * keep their own markup and their status lines; this table carries the
 * folds' words. Five of World Progression's dials had no row anywhere
 * before this (the history lookback, the rotation, the exclusion list,
 * consolidation): the backend honours them, and this is their first place
 * on screen.
 */

import type { SettingsCategoryId } from '../settings/schema.js'
import { CARD_WORDS_MAX, CARD_WORDS_MIN, GEAR_TIERS } from '../tracker/creator.js'

/** `books` (73h): a list of the host's lorebooks with a tick each, saved as the ticked names. */
export type DialKind = 'switch' | 'number' | 'select' | 'text' | 'prompt' | 'books'

export interface DialRow {
    key: string
    kind: DialKind
    label: string
    hint?: string
    min?: number
    max?: number
    step?: number
    options?: ReadonlyArray<{ value: string; label: string }>
    /** `prompt` only: the box's placeholder, which says what blank means. */
    placeholder?: string
    /** Drawn only while this holds of the preferences, as the fold draws it. */
    visibleWhen?: (prefs: Record<string, unknown>) => boolean
}

/** One card of dials (63d): Multihog's sub-drawer, with its icon and its lead. */
export interface DialSection {
    id: string
    icon: string
    title: string
    lead: string
    rows: readonly DialRow[]
}

export interface DialGroup {
    id: string
    category: SettingsCategoryId
    sections: readonly DialSection[]
}

/** Every row of every group, in order. */
export function dialRows(groups: readonly DialGroup[] = PREF_DIAL_GROUPS): DialRow[] {
    return groups.flatMap((g) => g.sections.flatMap((s) => [...s.rows]))
}

const LEVELS: Array<{ value: string; label: string }> = [{ value: 'none', label: 'N/A — No Levels (Custom System)' }]
for (let i = 1; i <= 20; i++) LEVELS.push({ value: String(i), label: `Level ${i}` })

/** The groups, one per category that has dials of its own; the folds' labels and hints. */
export const PREF_DIAL_GROUPS: readonly DialGroup[] = [
    {
        id: 'general',
        category: 'general',
        sections: [
            {
                id: 'choices',
                icon: '🔀',
                title: 'The choices in the bubble',
                lead: 'How the raw <choices> block is kept out of the reply while the buttons stand under it.',
                rows: [
                    { key: 'choicesDisplayRegex', kind: 'switch', label: 'Hide the block with a regex script in the host’s library', hint: 'On, a display-only script (AdventureTime — hide the choices block) in Lumiverse’s regex library takes the block out of every reply as it is drawn; nothing stored or sent changes. Off, the script is removed and AdventureTime hides the lines itself after each reply, which can leave the block showing until the next refresh. Switch it off if a long chat slows down.' },
                ],
            },
            {
                id: 'display',
                icon: '🖼️',
                title: 'Portraits & inventory',
                lead: 'How an item’s worth is drawn. The portraits switch is the first row of Portraits and location images since 83.',
                rows: [
                    { key: 'inventoryShowTotal', kind: 'switch', label: 'Show the total inventory value', hint: 'Every item’s worth and every sum of money in the Inventory card added up in its header, in the currency most lines use.' },
                    { key: 'inventoryWorthMode', kind: 'select', label: 'Item worth', hint: 'An item’s (~120 GP) or (Worth: 120 GP): hover keeps it as a tooltip, display draws it as a coin badge beside the item.', options: [{ value: 'hover', label: 'Hover (tooltip only)' }, { value: 'display', label: 'Display (inline badge)' }] },
                ],
            },
        ],
    },
    {
        id: 'tracker',
        category: 'tracker',
        sections: [
            {
                id: 'advanced',
                icon: '🎛️',
                title: 'Advanced options',
                lead: 'The tracker’s window and cadence. The same dials are under Tracker settings, instruction and the last report; a change in either place shows in the other.',
                rows: [
                { key: 'trackerLookbackMode', kind: 'select', label: 'Story the tracker reads', hint: 'The current exchange: your last message and the reply to it, usually two. Less to send, and the tracker is only ever asked what changed this turn.', options: [{ value: 'since-last-user', label: 'The current exchange (recommended)' }, { value: 'fixed', label: 'A fixed number of messages' }] },
                { key: 'trackerLookbackCount', kind: 'number', label: 'Messages a pass reads', hint: 'When a fixed number: the last N messages, 1 to 50.', min: 1, max: 50, visibleWhen: (p) => p.trackerLookbackMode === 'fixed' },
                { key: 'trackerRunEvery', kind: 'number', label: 'Replies between tracker passes', hint: 'Every reply is the recommended setting. More: fewer model calls, but the memo lags, a pass reads back to the previous one, and only the turns a pass ran on get a card.', min: 1, max: 20 },
                { key: 'trackerDirectLookback', kind: 'number', label: 'Messages an instructed tracker pass reads', hint: 'The send bar’s window, 0 to 50. 0 reads none.', min: 0, max: 50 },
                { key: 'frameworkEnabled', kind: 'switch', label: 'Enable the framework', hint: 'The master power, Multihog’s ⏻: off, nothing is injected into the prompt and no pass runs on its own — no tracker, agent, map, world or picture after a reply. The buttons still work. The narrator then plays without the rulebook.' },
                { key: 'trackerFullReviewMode', kind: 'switch', label: 'Full Review Mode (recommended for weaker/local models)', hint: 'Forces the State Model to output the COMPLETE, verified state for every enabled module on every pass, instead of only the changed sections. Trades tokens/latency for reliability — recommended for weaker/local models that struggle to keep delta-tracked state consistent. While enabled, the Extractor system prompt and the User prompt suffix are replaced by built-in Full Review versions on every pass; your own text stays saved and is used again when you turn this off. Raise the response length generously: a full memo dump is larger than a delta update.' },
                { key: 'trackerHistoryStates', kind: 'number', label: 'History context (states)', hint: 'How many memo states the tracker is shown, the current one included: 1 shows the prior memo alone; 3 shows the two before it too, as TRACKER STATE -2 and -1. More context, more tokens.', min: 1, max: 10 },
                { key: 'trackerInjectLorebooks', kind: 'switch', label: 'Inject lorebooks', hint: 'Multihog’s Context & Lorebooks: every enabled entry of the books ticked below — the books linked to this chat when none is ticked — opens the tracker’s prompt as a WORLD LORE section on every pass, so the tracker knows the world’s names and places. Read afresh each pass; a big book is a lot of tokens, so tick the books that matter.' },
                { key: 'trackerLorebookFilter', kind: 'books', label: 'Books the tracker reads', hint: 'None ticked: the books linked to this chat — attached to the chat, its narrator’s card, the persona or the global list — and never the whole library (Multihog sends every book; AdventureTime does not, by the maintainer’s decision). Books are matched by name, as Multihog matches them, so a renamed book drops out of the filter until ticked again.', visibleWhen: (p) => p.trackerInjectLorebooks === true },
                { key: 'trackerUserPromptSuffix', kind: 'prompt', label: 'User prompt suffix', hint: 'The line that closes every tracker prompt, after the story and the instruction: Multihog’s User Prompt Suffix. Blank, the stock line — ## OUTPUT ONLY CHANGED SECTIONS: — closes both the automatic and the instructed pass, as it does in Multihog.', placeholder: 'Blank: ## OUTPUT ONLY CHANGED SECTIONS:' },
                { key: 'trackerSwipeRollback', kind: 'switch', label: 'Roll the memo back on a swipe', hint: 'A swipe or a regenerate reads from the memo as it stood before the replaced reply’s pass, so a turn is never counted twice. Off, the pass merges onto the memo as it stands.' },
                ],
            },
        ],
    },
    {
        id: 'agent',
        category: 'agent',
        sections: [
            {
                id: 'core',
                icon: '🧭',
                title: 'Agent core settings',
                lead: 'The agent’s cadence, window and turns. The same dials are in the Lorebook agent fold; the campaign’s name is per chat, and stays there.',
                rows: [
                { key: 'agentRunEvery', kind: 'number', label: 'Replies between automatic passes', hint: 'A pass runs by itself after every N replies, reading the story since the last one. 0: only when you press the button.', min: 0, max: 50 },
                { key: 'agentLookback', kind: 'number', label: 'Messages to read', hint: 'The last N messages of the chat. 0 reads the whole chat.', min: 0, max: 100000 },
                { key: 'agentMaxTurns', kind: 'number', label: 'Research turns', hint: 'Model calls one pass may make, one after another, 1 to 20. Lower is faster; too low and the agent stops before it has decided anything.', min: 1, max: 20 },
                { key: 'agentDirectLookback', kind: 'number', label: 'Messages an instructed agent pass reads', hint: 'The send bar’s window, 0 to 100. 0 reads the whole chat.', min: 0, max: 100 },
                { key: 'agentEnabled', kind: 'switch', label: 'Enable the Lorebook Agent', hint: 'Off, the automatic pass after a reply is held; Run the agent now and the send bar still run one. The cadence below is kept.' },
                { key: 'agentLookbackMode', kind: 'select', label: 'Story an automatic pass reads', hint: 'Since the last run: every message since the agent last ran, so nothing throttled by the cadence is missed (recommended). Since the last user message: the current exchange only. Fixed: the count below.', options: [{ value: 'since_last_run', label: 'Since the last run (recommended)' }, { value: 'since_last_user', label: 'Since the last user message' }, { value: 'fixed', label: 'A fixed count of messages' }] },
                { key: 'agentSwipeRollback', kind: 'switch', label: 'Roll a pass back on a swipe', hint: 'A swipe or a regenerate of the reply an automatic pass read undoes that pass; the lore it wrote for the discarded reply goes with it. Off, the pass stands. Multihog ships this off; AdventureTime always rolled back.' },
                ],
            },
            {
                id: 'cleanup',
                icon: '🧹',
                title: 'Cleanup & full audit',
                lead: 'Multihog’s 🧹 Cleanup menu and 📕 Full Audit, on the Lorebook agent fold’s tool strip. The threshold is what the cleanup scan flags; the auto-cleanup runs a pass of its own every N passes that find something over it.',
                rows: [
                { key: 'agentCleanupUseThreshold', kind: 'switch', label: 'Use the token threshold', hint: 'On, the cleanup flags every entry at or over the threshold; off, every entry of the campaign’s books.' },
                { key: 'agentCleanupThreshold', kind: 'number', label: 'Token threshold', hint: 'An entry this many tokens long (about four characters each, its map not counted) is bloated: 50 to 5000. Multihog’s 300.', min: 50, max: 5000 },
                { key: 'agentCleanupEvery', kind: 'number', label: 'Auto-cleanup every N passes', hint: 'After every Nth agent pass that finds something bloated, a cleanup pass runs on its own; 0 never. Every pass that finds something says so in the terminal either way.', min: 0, max: 100 },
                { key: 'agentAuditTokens', kind: 'number', label: 'Full audit context tokens', hint: 'Multihog’s Full Audit Max Tokens: the chat is cut into chunks of this size less 3000 tokens, each run through the agent with the audit instruction. Set it near the model’s context window.', min: 4000, max: 1000000 },
                ],
            },
            {
                id: 'books',
                icon: '📚',
                title: 'Lorebooks',
                lead: 'Whether the campaign’s books are attached as they are made, and to what. The Lorebooks sub-fold in the Lorebook agent fold shows each book’s standing.',
                rows: [
                { key: 'attachBooksToCard', kind: 'switch', label: 'Attach new books as they are made', hint: 'A book is scanned only once it is attached to the chat, the narrator’s card, the persona or the global list; on, every book the campaign makes is attached the moment it is made.' },
                { key: 'attachBooksTarget', kind: 'select', label: 'Attach to', hint: 'The chat: the books are scanned in this chat and nowhere else. The card: the books go wherever the card goes.', options: [{ value: 'chat', label: 'this chat only (recommended)' }, { value: 'card', label: 'the narrator’s card, for every chat it is used in' }] },
                ],
            },
        ],
    },
    {
        id: 'wizard',
        category: 'systems',
        sections: [
            {
                id: 'wizard',
                icon: '🪄',
                title: 'Wizard advanced options',
                lead: 'The wizard itself is in the Game Systems & Custom Fields card, under the game systems. These are what it reads when it drafts; the same dials are under the wizard, beside the list it adds to.',
                rows: [
                { key: 'wizardLookback', kind: 'number', label: 'Messages the wizard reads', hint: 'For context when drafting a system, 0 to 200. 0 reads none.', min: 0, max: 200 },
                { key: 'wizardLookbackAll', kind: 'switch', label: 'The wizard reads every message', hint: 'Multihog’s Read every message: the whole chat, the count above ignored.' },
                { key: 'wizardInjectMemo', kind: 'switch', label: 'Show the wizard the tracker state' },
                { key: 'wizardInjectLore', kind: 'switch', label: 'Show the wizard the lore the host has active', hint: 'Multihog’s Inject lorebooks: the entries Lumiverse has active for the chat, each under its title.' },
                { key: 'wizardInjectModulePrompts', kind: 'switch', label: 'Cite existing module prompts as formatting examples', hint: 'Multihog’s picker: which modules and sections to cite is chosen in the wizard’s fold, under the describe box.' },
                { key: 'wizardSystemPrompt', kind: 'prompt', label: 'The architect prompt', hint: 'What the model is told about designing a system. Multihog’s own, editable; blank it to go back to the stock text.', placeholder: 'Blank: the stock architect prompt.' },
                ],
            },
        ],
    },
    {
        id: 'maps',
        category: 'maps',
        sections: [
            {
                id: 'architect',
                icon: '🏛️',
                title: 'Map Architect',
                lead: 'When the narrator first enters an unmapped site, Map Architect first generates and locks its room or district topology, then runs a separate content-placement pass against those exact areas. Nothing is stored until both passes validate. The same dials are in the Maps fold.',
                rows: [
                { key: 'mapArchitectOpener', kind: 'select', label: 'How the narrator asks for a map', hint: 'Tool call: the narrator calls CreateAreaMap mid-reply, which needs Enable Function Calling on its connection. Block: for a connection that cannot call tools, the narrator writes a [CREATE_AREA_MAP] block at the end of its reply and stops; the map is drawn behind it.', options: [{ value: 'tool', label: 'A tool call (CreateAreaMap)' }, { value: 'text', label: 'A block at the end of the reply' }] },
                { key: 'mapArchitectLookback', kind: 'number', label: 'Messages the architect reads', hint: 'For context when it draws a site: who is there, what the story has shown. Multihog’s 12.', min: 0, max: 100 },
                { key: 'mapArchitectSystemPrompt', kind: 'prompt', label: 'The architect’s content prompt', hint: 'Your own content-placement prompt, in place of the stock.', placeholder: 'Blank: the stock prompt.' },
                ],
            },
            {
                id: 'updater',
                icon: '🔄',
                title: 'Map Updater',
                lead: 'After a map exists, this dedicated pass keeps occupancy current. It does not record NPC biographies or relationships — those stay on the Lorebook Agent. Every reply is the default, so the agent can stay on a slower cadence.',
                rows: [
                { key: 'mapUpdaterEnabled', kind: 'switch', label: 'Update the map with play', hint: 'After a reply inside a mapped site, one model call asks for a transaction against that site’s map.' },
                { key: 'mapUpdaterRunEvery', kind: 'number', label: 'Replies between updates', hint: 'Multihog’s 1: after every reply inside a mapped site. A building the party has just entered is furnished at once whatever this says.', min: 1, max: 50 },
                { key: 'mapUpdaterLookback', kind: 'number', label: 'User turns the updater reads', hint: 'When there is no last update to read from, and for an update pressed in the fold. After one, it reads what came since.', min: 1, max: 100 },
                { key: 'mapUpdaterSystemPrompt', kind: 'prompt', label: 'The updater’s prompt', hint: 'Your own occupancy prompt, in place of the stock.', placeholder: 'Blank: the stock prompt.' },
                ],
            },
            {
                id: 'evolution',
                icon: '🌒',
                title: 'Map Evolution',
                lead: 'Separate from occupancy: advances mapped sites off-screen on in-world time, and lets each map feel the World Reports that touch it. Its named sites are ticked in the Maps fold, from the mapped ones; its connection is under Connections & models.',
                rows: [
                { key: 'mapEvolutionEnabled', kind: 'switch', label: 'Let sites change while the party is away', hint: 'Every mapped site has a clock; once the tracker’s [TIME] has moved past its interval, one model call advances its map.' },
                { key: 'mapEvolutionIntervalHours', kind: 'number', label: 'In-world hours between passes, away', hint: 'For a site the party is not in. Multihog’s 12. The clock is the tracker’s [TIME] block.', min: 1, max: 168 },
                { key: 'mapEvolutionOnSiteIntervalHours', kind: 'number', label: 'Hours between passes, on site', hint: 'For the site the party is in, with the minutes below. Multihog’s 1. Both 0: never while they are there.', min: 0, max: 168 },
                { key: 'mapEvolutionOnSiteIntervalMinutes', kind: 'number', label: 'Minutes between passes, on site', hint: 'Added to the hours above.', min: 0, max: 59 },
                { key: 'mapEvolutionOnSitePreset', kind: 'select', label: 'On the party’s site', hint: 'Dynamic: bolder, encounter-rich change just beyond their area. Standard: the same restraint as elsewhere.', options: [{ value: 'dynamic', label: 'Dynamic' }, { value: 'standard', label: 'Standard' }] },
                { key: 'mapEvolutionScope', kind: 'select', label: 'Which sites a pass considers', hint: 'All: every mapped site that is due. The party’s: only the one they are in. Some: the number below, picked from the due ones. Named: the sites ticked in the Maps fold.', options: [{ value: 'all', label: 'All' }, { value: 'active', label: 'The party’s' }, { value: 'count', label: 'Some' }, { value: 'selected', label: 'Named' }] },
                { key: 'mapEvolutionCount', kind: 'number', label: 'How many, when some', hint: '0 for every due site.', min: 0, max: 50, visibleWhen: (p) => p.mapEvolutionScope === 'count' },
                { key: 'mapEvolutionRandomize', kind: 'switch', label: 'Pick them at random', visibleWhen: (p) => p.mapEvolutionScope === 'count' },
                { key: 'mapEvolutionWorldReportLookback', kind: 'number', label: 'World reports a site may feel', hint: 'The most recent ones, plus any aimed at the site. Multihog’s 5.', min: 1, max: 20 },
                { key: 'mapEvolutionLookback', kind: 'number', label: 'User turns of recent story a pass reads', hint: 'Every due site is shown the same window and told to apply only what touches its own map. 0 sends none. Multihog’s 20.', min: 0, max: 100 },
                { key: 'mapEvolutionCompressEnabled', kind: 'switch', label: 'Compress a site’s closed history when it grows long' },
                { key: 'mapEvolutionCompressThreshold', kind: 'number', label: 'Compress past this many tokens', hint: 'Of closed threads. One more model call, into a few digests. Multihog’s 10,000.', min: 500, max: 100000, step: 100, visibleWhen: (p) => p.mapEvolutionCompressEnabled !== false },
                { key: 'mapEvolutionNarratorCommitTokens', kind: 'number', label: 'Tokens of site activity for the narrator', hint: 'The briefing sent with a site’s map: open threads, recent commits, digests. Multihog’s 2,000.', min: 200, max: 20000, step: 100 },
                { key: 'mapEvolutionSystemPrompt', kind: 'prompt', label: 'The evolution prompt', hint: 'Your own evolution prompt, in place of the stock.', placeholder: 'Blank: the stock prompt.' },
                ],
            },
            {
                id: 'screen',
                icon: '🧭',
                title: 'The map on screen',
                lead: 'The party’s site as the Maps fold draws it.',
                rows: [
                { key: 'mapRevealAll', kind: 'switch', label: 'Reveal all on the map on screen', hint: 'Draw what the party has not learned too: every room, every thing in them, and what each evolution pass did. Off, the picture is what the party knows.' },
                ],
            },
        ],
    },
    {
        id: 'world',
        category: 'world',
        sections: [
            // The World Skeleton & Atmosphere card is the skeleton fold's own since 82: the tracker panel draws it first
            // among these, with the fold's controls in place of the nine mirrored rows that stood here.
            {
                id: 'rotation',
                icon: '🔀',
                title: 'Location Rotation',
                lead: 'World Progression advances location-scale conditions, not entity timelines. It selects the least recently covered location dossiers first. The random pick and the exclusion list have no row in the fold: the backend honours them, and this is their first place on screen.',
                rows: [
                { key: 'worldProgressionLocationsPerReport', kind: 'number', label: 'Locations per report', hint: 'The ones advanced longest ago go first; named people are never subjects.', min: 1, max: 12 },
                { key: 'worldProgressionLocationRandomize', kind: 'switch', label: 'Pick the locations at random', hint: 'Off, the ones advanced longest ago go first, as Multihog’s rotation does.' },
                { key: 'worldProgressionExclusionList', kind: 'text', label: 'Places never reported on', hint: 'Names, comma-separated, as their entries title them.' },
                ],
            },
            {
                id: 'timing',
                icon: '🕒',
                title: 'Timing & Narrative Input',
                lead: 'The switch, the interval on the tracker’s [TIME] block, and the replies the writer reads for scene context. Write a report now and Reset the timeline are in the World progression fold.',
                rows: [
                { key: 'worldProgressionEnabled', kind: 'switch', label: 'Write reports', hint: 'Off by default. The clock is the tracker’s [TIME] block; switching it on starts the clock on the next tracker pass.' },
                { key: 'worldProgressionIntervalHours', kind: 'number', label: 'In-world hours between reports', hint: 'Multihog’s 24: one report a day. The clock is the tracker’s [TIME] block.', min: 1, max: 720 },
                { key: 'worldProgressionLookback', kind: 'number', label: 'Replies the writer reads', hint: 'For scene context only. 0 reads none.', min: 0, max: 200 },
                ],
            },
            {
                id: 'injection',
                icon: '➡️',
                title: 'Context Injection Settings',
                lead: 'The rolling window: how many of the newest reports reach the narrator as the AdventureTime — the world message.',
                rows: [
                { key: 'worldProgressionKeepActive', kind: 'number', label: 'Reports shown to the narrator', hint: 'The newest N. The rest stay in the campaign’s _World book as history.', min: 1, max: 20 },
                ],
            },
            {
                id: 'history',
                icon: '📖',
                title: 'Report History & Consolidation',
                lead: 'What the writer reads of the earlier reports, and the consolidation that folds a long backlog into digests. None of these has a row in the fold; the backend honours them, and this is their first place on screen.',
                rows: [
                { key: 'worldProgressionHistoryLookback', kind: 'number', label: 'Earlier reports the writer reads', hint: 'The newest N of the history, besides the ones shown to the narrator, so a report follows from the last. 0 reads none.', min: 0, max: 100 },
                { key: 'worldProgressionConsolidateEnabled', kind: 'switch', label: 'Consolidate old reports', hint: 'Every N reports, the older ones in the _World book are folded into one digest by one more model call.' },
                { key: 'worldProgressionConsolidateInterval', kind: 'number', label: 'Reports between consolidations', hint: 'Multihog’s 7.', min: 2, max: 50, visibleWhen: (p) => p.worldProgressionConsolidateEnabled === true },
                ],
            },
        ],
    },
    {
        id: 'creator',
        category: 'connections',
        sections: [
            {
                id: 'creation',
                icon: '✍️',
                title: 'Character Creation & Starting Modes',
                lead: 'Shared by the Character creator, Instant Action and the other ways to begin, where the sheet is written. Multihog keeps these with its connections.',
                rows: [
                { key: 'creatorLevel', kind: 'select', label: 'Level', hint: 'The default for the next character; the level the creator starts at.', options: LEVELS },
                { key: 'creatorGearTier', kind: 'select', label: 'Starting gear', options: GEAR_TIERS.map((t) => ({ value: t.value, label: t.label })) },
                { key: 'creatorCombatScalingGuide', kind: 'switch', label: 'Use the combat and skill scaling guide', hint: 'A classic d20-style reference for how competence grows with level. Switch it off for a homebrew system that should not read like D&D.' },
                { key: 'creatorPlayerCard', kind: 'switch', label: 'Write a Player Card (recommended)', hint: 'A second model call writes the character’s appearance, personality, habits and backstory into a Player Card the narrator sees every turn.' },
                { key: 'creatorCardWords', kind: 'number', label: 'Player Card words', min: CARD_WORDS_MIN, max: CARD_WORDS_MAX, step: 10 },
                { key: 'creatorPersona', kind: 'switch', label: 'Create a persona with the character’s name (recommended)', hint: 'A persona with the character’s name and no description, made and switched to, so your messages carry the name while the Player Card stays the one biography.' },
                { key: 'creatorInitialDate', kind: 'text', label: 'Starting day', hint: 'What the [TIME] block opens at. Day 1.' },
                { key: 'creatorInitialTime', kind: 'text', label: 'Starting time', hint: '08:00 AM.' },
                { key: 'creatorSendStarter', kind: 'switch', label: 'Instant Action begins the adventure', hint: 'Begin sends the opening message as yours and starts the reply; off, you type your first action.' },
                { key: 'creatorInstantRandomLevel', kind: 'switch', label: 'Instant Action rolls the level (1–10)', hint: 'Off, level 1. A level named in the setup outranks either.' },
                ],
            },
        ],
    },
]

export interface PrefDialsHost {
    el(tag: string, attrs?: Record<string, string>): HTMLElement
    savePrefs(patch: Record<string, unknown>): Promise<void>
    fail(error: unknown): void
    /** The host's lorebooks by name (73h), for a `books` row; absent, the row says the build cannot list them. */
    listBooks?(): Promise<Array<{ id: string; name: string }>>
}

export interface PrefDials {
    root: HTMLElement
    /** The preferences as the backend holds them, on mount and on every `prefs.changed`. A control being typed in is left alone. */
    applyPrefs(prefs: Record<string, unknown>): void
}

export const PREF_DIALS_CSS = `
.lh-dial-books-list { max-height: 160px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(128,128,128,0.3))); border-radius: 6px; padding: 6px 8px; background: var(--lh-card-bg, var(--lumiverse-fill, rgba(127,127,127,0.06))); }
.lh-dial-books-list:empty { display: none; }
.lh-dial-book { display: flex; align-items: center; gap: 6px; font-size: 0.85em; cursor: pointer; }
.adventuretime-panel .lh-dials { display: flex; flex-direction: column; gap: 8px; }
.adventuretime-panel .lh-dial-card > .lh-section-help { margin-top: 6px; }
.adventuretime-panel .lh-dial { display: flex; flex-direction: column; gap: 3px; }
.adventuretime-panel .lh-dial-main { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.adventuretime-panel .lh-dial-label { flex: 1; min-width: 10em; }
.adventuretime-panel .lh-dial input[type="number"] { width: 6em; }
.adventuretime-panel .lh-dial input[type="text"] { flex: 1; min-width: 10em; }
.adventuretime-panel .lh-dial textarea { width: 100%; box-sizing: border-box; }
.adventuretime-panel .lh-dials[hidden] { display: none; }
`

/** One group of dials as a box of cards (63d): a card per Multihog sub-drawer, each with its icon, its lead and a row per preference. */
export function createPrefDials(host: PrefDialsHost, group: DialGroup): PrefDials {
    const { el } = host
    const root = el('div', { class: 'lh-dials', 'data-lh-dials': group.id })

    let prefs: Record<string, unknown> = {}
    const rows: Array<{ row: DialRow; container: HTMLElement; control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement }> = []
    /** The `books` rows (73h): each a list of ticks drawn from the host's books, filled once shown and on Reload. */
    const bookRows: Array<{ row: DialRow; list: HTMLElement; note: HTMLElement; loaded: boolean; load: () => void }> = []

    function save(patch: Record<string, unknown>): void {
        Object.assign(prefs, patch)
        refresh()
        host.savePrefs(patch).catch(host.fail)
    }

    function renderRow(row: DialRow, into: HTMLElement): void {
        const container = el('div', { class: 'lh-dial lh-search-item', 'data-lh-field': `dial-${row.key}` })
        const main = el('div', { class: 'lh-dial-main' })
        const label = el('label', { class: 'lh-dial-label' })
        label.textContent = row.label
        let control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        if (row.kind === 'switch') {
            const input = el('input', { type: 'checkbox', 'aria-label': row.label }) as HTMLInputElement
            input.addEventListener('change', () => save({ [row.key]: input.checked }))
            const box = el('label', { class: 'lh-dial-label' })
            box.append(input, label)
            label.className = ''
            main.append(box)
            control = input
        } else if (row.kind === 'select') {
            const select = el('select', { class: 'lh-input', 'aria-label': row.label }) as HTMLSelectElement
            for (const choice of row.options ?? []) {
                const option = el('option', { value: choice.value }) as HTMLOptionElement
                option.textContent = choice.label
                select.append(option)
            }
            select.addEventListener('change', () => save({ [row.key]: select.value }))
            main.append(label, select)
            control = select
        } else if (row.kind === 'books') {
            // The legacy's filter list: a tick per book the host has, saved as the ticked names; None ticked reads every book.
            const list = el('div', { class: 'lh-dial-books-list', 'data-lh-field': `dial-${row.key}-list` })
            const note = el('div', { class: 'lh-conn-hint', 'data-lh-field': `dial-${row.key}-note` })
            const reload = el('button', { type: 'button', class: 'lh-button lh-button--quiet' }) as HTMLButtonElement
            reload.textContent = '↻ Reload the books'
            // Clear (73h-bis, the maintainer's ask): the list is long, and unticking it one by one is not a way back to the default.
            const clear = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': `dial-${row.key}-clear` }) as HTMLButtonElement
            clear.textContent = 'Clear'
            clear.title = 'Untick every book: the tracker reads the books linked to this chat again.'
            const ticked = (): string[] => Array.from(list.querySelectorAll<HTMLInputElement>('input[data-lh-book]')).filter((box) => box.checked).map((box) => box.dataset.lhBook ?? '')
            const entry = { row, list, note, loaded: false, load: () => {} }
            entry.load = () => {
                if (!host.listBooks) { note.textContent = 'This build cannot list the host’s lorebooks.'; return }
                note.textContent = 'Reading the host’s books…'
                host.listBooks().then((books) => {
                    entry.loaded = true
                    const picked = new Set(Array.isArray(prefs[row.key]) ? (prefs[row.key] as string[]) : [])
                    list.replaceChildren()
                    for (const book of books) {
                        const line = el('label', { class: 'lh-dial-book' })
                        const box = el('input', { type: 'checkbox', 'data-lh-book': book.name }) as HTMLInputElement
                        box.checked = picked.has(book.name)
                        box.addEventListener('change', () => save({ [row.key]: ticked() }))
                        const text = el('span')
                        text.textContent = book.name
                        line.append(box, text)
                        list.append(line)
                    }
                    // A ticked name the host no longer lists is kept in the filter, as the legacy keeps it; the note says so.
                    const missing = [...picked].filter((name) => !books.some((book) => book.name === name))
                    note.textContent = books.length
                        ? (missing.length ? `Ticked, but the host lists no book so named: ${missing.join(', ')}.` : '')
                        : 'No lorebooks found.'
                }).catch((error) => { note.textContent = `The books could not be listed: ${error instanceof Error ? error.message : String(error)}`; host.fail(error) })
            }
            reload.addEventListener('click', entry.load)
            clear.addEventListener('click', () => {
                for (const box of Array.from(list.querySelectorAll<HTMLInputElement>('input[data-lh-book]'))) box.checked = false
                save({ [row.key]: [] })
            })
            bookRows.push(entry)
            main.append(label, reload, clear)
            container.classList.add('lh-dial--stacked')
            container.append(main, list, note)
            if (row.hint) {
                const hint = el('div', { class: 'lh-conn-hint' })
                hint.textContent = row.hint
                container.append(hint)
            }
            into.append(container)
            return
        } else if (row.kind === 'prompt') {
            const box = el('textarea', { class: 'lh-input', rows: '3', spellcheck: 'false', 'aria-label': row.label, placeholder: row.placeholder ?? '' }) as HTMLTextAreaElement
            box.addEventListener('change', () => save({ [row.key]: box.value }))
            main.append(label)
            container.classList.add('lh-dial--stacked')
            control = box
        } else {
            const input = el('input', { type: row.kind === 'number' ? 'number' : 'text', class: 'lh-input', 'aria-label': row.label }) as HTMLInputElement
            if (row.min !== undefined) input.min = String(row.min)
            if (row.max !== undefined) input.max = String(row.max)
            input.step = String(row.step ?? 1)
            input.addEventListener('change', () => {
                if (row.kind === 'number') {
                    const n = Math.floor(Number(input.value))
                    const clamped = Number.isFinite(n) ? Math.min(Math.max(n, row.min ?? -Infinity), row.max ?? Infinity) : (row.min ?? 0)
                    input.value = String(clamped)
                    save({ [row.key]: clamped })
                } else {
                    save({ [row.key]: input.value })
                }
            })
            main.append(label, input)
            control = input
        }
        container.append(main)
        if (row.kind === 'prompt') container.append(control)
        if (row.hint) {
            const hint = el('div', { class: 'lh-conn-hint' })
            hint.textContent = row.hint
            container.append(hint)
        }
        rows.push({ row, container, control })
        into.append(container)
    }

    for (const section of group.sections) {
        const card = el('details', { class: 'lh-card lh-dial-card', 'data-lh-card': section.id }) as HTMLDetailsElement
        const summary = el('summary')
        const icon = el('span', { class: 'lh-card-icon', 'aria-hidden': 'true' })
        icon.textContent = section.icon
        const title = el('span', { class: 'lh-card-title' })
        title.textContent = section.title
        summary.append(icon, title, el('span', { class: 'lh-chevron', 'aria-hidden': 'true' }))
        const lead = el('div', { class: 'lh-section-help' })
        lead.textContent = section.lead
        card.append(summary, lead)
        for (const row of section.rows) renderRow(row, card)
        root.append(card)
    }

    function refresh(): void {
        for (const { row, container } of rows) container.hidden = row.visibleWhen ? !row.visibleWhen(prefs) : false
        // A books row reads the host's list the first time it is shown (the legacy refreshes its list as the switch is ticked).
        for (const entry of bookRows) {
            const container = entry.list.parentElement as HTMLElement
            container.hidden = entry.row.visibleWhen ? !entry.row.visibleWhen(prefs) : false
            if (!container.hidden && !entry.loaded) entry.load()
        }
    }

    function draw(): void {
        for (const { row, control } of rows) {
            if (control === document.activeElement) continue
            const value = prefs[row.key]
            if (row.kind === 'switch') (control as HTMLInputElement).checked = value === true
            else if (value !== undefined && value !== null) control.value = String(value)
        }
        for (const entry of bookRows) {
            const picked = new Set(Array.isArray(prefs[entry.row.key]) ? (prefs[entry.row.key] as string[]) : [])
            for (const box of Array.from(entry.list.querySelectorAll<HTMLInputElement>('input[data-lh-book]'))) box.checked = picked.has(box.dataset.lhBook ?? '')
        }
        refresh()
    }

    refresh()
    return {
        root,
        applyPrefs(next) {
            prefs = { ...prefs, ...next }
            draw()
        },
    }
}
