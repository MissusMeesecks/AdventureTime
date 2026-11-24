/**
 * The other mirrored dials (Phase 63c, roadmap row 63): the preferences
 * the folds hold — the tracker's window and cadence, the agent's cadence,
 * window and turns (the wizard's context until 96, audit D6: its six rows
 * were the wizard's own controls drawn twice), the Map Architect's, the
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

import { setCardIcon } from './icons.js'
import type { SettingsCategoryId } from '../settings/schema.js'
import { CARD_WORDS_MAX, CARD_WORDS_MIN, GEAR_TIERS } from '../tracker/creator.js'
import { attachCardHelp, createHelpTip } from './help-tip.js'

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

/**
 * A dial's label and help by its preference key (96): the Lore widget draws some of the same dials in
 * its drawers, and a twin reads the table's words rather than a second copy of them.
 */
export function dialCopy(key: string): { label: string; hint: string } {
    const row = dialRows().find((r) => r.key === key)
    return { label: row?.label ?? '', hint: row?.hint ?? '' }
}

const LEVELS: Array<{ value: string; label: string }> = [{ value: 'none', label: 'No levels (custom system)' }]
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
                title: 'Choices block in replies',
                lead: '',
                rows: [
                    { key: 'choicesDisplayRegex', kind: 'switch', label: 'Hide with a Lumiverse regex script', hint: 'When on, AdventureTime installs a display-only regex script in Lumiverse that hides the raw <choices> block in every reply. When off, the script is removed and AdventureTime hides the block itself after each reply, so the block can show until the next refresh. Turn it off if a long chat becomes slow. Default: on.' },
                ],
            },
            {
                id: 'display',
                icon: '🎒',
                title: 'Inventory',
                lead: '',
                rows: [
                    { key: 'inventoryShowTotal', kind: 'switch', label: 'Show total inventory value', hint: 'When on, the Inventory card’s header shows the sum of every item’s worth and all money. The total uses the currency most lines use. Default: off.' },
                    { key: 'inventoryWorthMode', kind: 'select', label: 'Item worth', hint: 'Sets how an item’s worth, such as (~120 GP) or (Worth: 120 GP), is shown on the Inventory card. "Tooltip on hover" shows it when you point at the item. "Badge beside the item" shows it as a coin badge. Default: tooltip on hover.', options: [{ value: 'hover', label: 'Tooltip on hover' }, { value: 'display', label: 'Badge beside the item' }] },
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
                title: 'Advanced tracker',
                lead: 'How much story the tracker reads, how often it runs and what goes into its prompt.',
                rows: [
                { key: 'trackerLookbackMode', kind: 'select', label: 'Story the tracker reads', hint: 'Current exchange: the tracker reads your last message and the reply to it. This sends less text and asks the tracker only what changed this turn. Default: current exchange.', options: [{ value: 'since-last-user', label: 'Current exchange (recommended)' }, { value: 'fixed', label: 'Fixed number of messages' }] },
                { key: 'trackerLookbackCount', kind: 'number', label: 'Messages per pass', hint: 'Used with "Fixed number of messages". The tracker reads the last N messages, from 1 to 50. Default: 2.', min: 1, max: 50, visibleWhen: (p) => p.trackerLookbackMode === 'fixed' },
                { key: 'trackerRunEvery', kind: 'number', label: 'Replies between tracker passes', hint: '1 runs a tracker pass after every reply, which is recommended. A higher number makes fewer model calls, and each pass reads back to the previous one. The memo lags in between, and only the replies a pass ran on get a card under the message. Default: 1.', min: 1, max: 20 },
                { key: 'trackerDirectLookback', kind: 'number', label: 'Messages an instructed pass reads', hint: 'How many messages the tracker reads when you send it an instruction from the Tracker widget or the terminal. The range is 0 to 50. 0 reads no messages. Default: 5.', min: 0, max: 50 },
                { key: 'frameworkEnabled', kind: 'switch', label: 'AdventureTime is on in every chat', hint: 'When off, nothing is added to the narrator’s prompt, so the narrator plays without the rulebook. No tracker, agent, map, world or picture pass runs on its own after a reply. Buttons that run a pass still work. Default: on.' },
                { key: 'trackerFullReviewMode', kind: 'switch', label: 'Full Review Mode', hint: 'When on, every tracker pass writes the complete memo for every module that is on, not only the changed sections. This is more reliable for weaker or local models, but it uses more tokens and time, so raise the output length. Built-in prompts replace the tracker system prompt and the user prompt suffix while it is on, and your own texts are kept. Default: off.' },
                { key: 'trackerHistoryStates', kind: 'number', label: 'Memo states shown', hint: 'How many memo states the tracker is shown, counting the current one, from 1 to 10. 1 shows only the current memo. 3 also shows the two states before it. More states use more tokens. Default: 1.', min: 1, max: 10 },
                { key: 'trackerInjectLorebooks', kind: 'switch', label: 'Send lorebooks to the tracker', hint: 'When on, every tracker pass starts with a WORLD LORE section, so the tracker knows the world’s names and places. The section holds every enabled entry of the lorebooks selected below, or of the lorebooks linked to this chat when none is selected. Large lorebooks use many tokens, so select only the ones that matter. Default: off.' },
                { key: 'trackerLorebookFilter', kind: 'books', label: 'Lorebooks the tracker reads', hint: 'With none selected, the tracker reads the lorebooks linked to this chat. Those are the lorebooks attached to the chat, the narrator’s character card, the persona or the global list. Lorebooks are matched by name. A renamed lorebook drops out of the selection until you select it again.\n\nDifferent from Multihog: with none selected, Multihog sends every lorebook in the library. AdventureTime sends only the lorebooks linked to the chat.', visibleWhen: (p) => p.trackerInjectLorebooks === true },
                { key: 'trackerUserPromptSuffix', kind: 'prompt', label: 'User prompt suffix', hint: 'The last line of every tracker prompt, after the story and any instruction. Leave blank to use the stock line, "## OUTPUT ONLY CHANGED SECTIONS:", on both automatic and instructed passes. While Full Review Mode is on, a built-in line is used in its place.', placeholder: '## OUTPUT ONLY CHANGED SECTIONS:' },
                { key: 'trackerSwipeRollback', kind: 'switch', label: 'Roll back the memo on a swipe', hint: 'When on, a swipe or a regenerate starts from the memo as it was before the replaced reply’s pass. This stops a turn being counted twice. When off, the new pass merges onto the memo as it stands. Default: on.' },
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
                title: 'Agent passes',
                lead: 'How often the agent runs, how much of the chat it reads and how many model calls a pass may make. The same settings are under Quick settings in the Lore widget.',
                rows: [
                { key: 'agentRunEvery', kind: 'number', label: 'Replies between automatic passes', hint: 'An automatic agent pass runs after this many replies. Set 0 to run the agent only when you press Run the agent now. Default: 3.', min: 0, max: 50 },
                { key: 'agentLookback', kind: 'number', label: 'Messages to read', hint: 'The agent reads the last N messages of the chat. 0 reads the whole chat. An automatic pass uses this number only when "Automatic pass reads" is set to a fixed count. Default: 0.', min: 0, max: 100000 },
                { key: 'agentMaxTurns', kind: 'number', label: 'Research turns', hint: 'The number of model calls one agent pass may make, from 1 to 20. Lower is faster. If it is too low, the agent stops before it has decided anything. Default: 5.', min: 1, max: 20 },
                { key: 'agentDirectLookback', kind: 'number', label: 'Messages an instructed pass reads', hint: 'The number of messages the agent reads when you send it an instruction, from 0 to 100. 0 reads the whole chat. Default: 10.', min: 0, max: 100 },
                { key: 'agentEnabled', kind: 'switch', label: 'Automatic agent passes', hint: 'When off, no agent pass runs by itself after a reply. Run the agent now and instructed passes still work. The "Replies between automatic passes" number is kept. Default: on.' },
                { key: 'agentLookbackMode', kind: 'select', label: 'Automatic pass reads', hint: 'Since the last run: every message since the agent last ran, so nothing is missed between passes. Since the last user message: the current exchange only. Fixed count: the number in "Messages to read". Default: since the last run.', options: [{ value: 'since_last_run', label: 'Since the last run (recommended)' }, { value: 'since_last_user', label: 'Since the last user message' }, { value: 'fixed', label: 'Fixed count of messages' }] },
                { key: 'agentSwipeRollback', kind: 'switch', label: 'Roll back the agent pass on a swipe', hint: 'When on, swiping or regenerating a reply undoes the automatic agent pass that read it. The lore written for the discarded reply is removed. Default: on.\n\nDifferent from Multihog: Multihog’s default is off. Here the default is on.' },
                ],
            },
            {
                id: 'cleanup',
                icon: '🧹',
                title: 'Cleanup & full audit',
                lead: 'Settings for the Cleanup and Full audit buttons in the Lore widget. Cleanup shortens bloated entries. Full audit runs the whole chat through the agent in chunks.',
                rows: [
                { key: 'agentCleanupUseThreshold', kind: 'switch', label: 'Use token threshold', hint: 'When on, cleanup checks only entries at or over the token threshold. When off, it checks every entry in the campaign’s lorebooks. Default: on.' },
                { key: 'agentCleanupThreshold', kind: 'number', label: 'Token threshold', hint: 'An entry at or over this many tokens counts as bloated. A token is about four characters, and an entry’s map is not counted. Range: 50 to 5000. Default: 300.', min: 50, max: 5000 },
                { key: 'agentCleanupEvery', kind: 'number', label: 'Auto-cleanup every N passes', hint: 'A cleanup pass runs by itself after every Nth agent pass that finds a bloated entry. Set 0 to never run it automatically. The terminal reports bloated entries either way. Default: 0.', min: 0, max: 100 },
                { key: 'agentAuditTokens', kind: 'number', label: 'Full audit context tokens', hint: 'A full audit cuts the chat into chunks of this many tokens minus 3000. Each chunk is one agent pass. Set it near the model’s context window. Default: 32000.', min: 4000, max: 1000000 },
                ],
            },
            {
                id: 'books',
                icon: '📚',
                title: 'Lorebooks',
                lead: 'Whether the campaign’s lorebooks are attached as they are made, and where. The Lorebooks list in the Lore widget shows whether each one is attached.',
                rows: [
                { key: 'attachBooksToCard', kind: 'switch', label: 'Attach new lorebooks automatically', hint: 'Lumiverse scans a lorebook only when it is attached to the chat, the narrator’s character card, the persona or the global list. When on, each lorebook the campaign makes is attached as soon as it is made. Default: on.' },
                { key: 'attachBooksTarget', kind: 'select', label: 'Attach to', hint: 'This chat only: the lorebooks are scanned in this chat and nowhere else. The narrator’s card: the lorebooks are scanned in every chat that uses the card. Default: this chat only.', options: [{ value: 'chat', label: 'This chat only (recommended)' }, { value: 'card', label: 'The narrator’s card (every chat that uses it)' }] },
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
                lead: 'Map Architect draws a map when the party first enters an unmapped site. It makes two passes: one for the layout and one for the contents. Nothing is saved unless both passes succeed.',
                rows: [
                { key: 'mapArchitectOpener', kind: 'select', label: 'How the narrator asks for a map', hint: 'Tool call: the narrator calls a tool during its reply. This needs function calling turned on for the narrator’s connection. Text block: the narrator writes a map request at the end of its reply and stops, and the map is drawn after the reply. Use this for a connection that cannot call tools. Default: tool call.', options: [{ value: 'tool', label: 'Tool call (CreateAreaMap)' }, { value: 'text', label: 'Text block' }] },
                { key: 'mapArchitectLookback', kind: 'number', label: 'Messages read by Map Architect', hint: 'The number of recent messages Map Architect reads for context when it draws a site. Default: 12.', min: 0, max: 100 },
                ],
            },
            {
                id: 'updater',
                icon: '🔄',
                title: 'Map Updater',
                lead: 'Map Updater keeps an existing map current during play. It records who and what is where. NPC biographies and relationships are recorded by the Lorebook Agent, not here.',
                rows: [
                { key: 'mapUpdaterEnabled', kind: 'switch', label: 'Update maps during play', hint: 'When on, a pass runs after a reply inside a mapped site and applies what changed to that site’s map. Default: on.' },
                { key: 'mapUpdaterRunEvery', kind: 'number', label: 'Replies between updates', hint: 'How many replies inside a mapped site pass between updates. 1 updates after every reply. A building the party has just entered is filled in at once, whatever this number is. Default: 1.', min: 1, max: 50 },
                { key: 'mapUpdaterLookback', kind: 'number', label: 'User turns read by Map Updater', hint: 'How many user turns of story Map Updater reads on its first update of a site, and when you press "Update the map now". After an update it reads only what came since. Default: 4.', min: 1, max: 100 },
                ],
            },
            {
                id: 'evolution',
                icon: '🌒',
                title: 'Map Evolution',
                lead: 'Map Evolution changes mapped sites as in-world time passes, mainly while the party is away. It also applies World Progression reports that affect a site. Its connection is set under Connections & models.',
                rows: [
                { key: 'mapEvolutionEnabled', kind: 'switch', label: 'Evolve sites over in-world time', hint: 'When on, every mapped site has a clock that follows the tracker’s in-world time. When a site’s interval has passed, one pass changes its map. Default: on.' },
                { key: 'mapEvolutionIntervalHours', kind: 'number', label: 'Hours between passes, away', hint: 'In-world hours between passes for a site the party is not in. Default: 8.', min: 1, max: 168 },
                { key: 'mapEvolutionOnSiteIntervalHours', kind: 'number', label: 'Hours between passes, on site', hint: 'In-world hours between passes for the site the party is in. The minutes below are added. If both are 0, that site never changes while the party is there. Default: 1.', min: 0, max: 168 },
                { key: 'mapEvolutionOnSiteIntervalMinutes', kind: 'number', label: 'Minutes between passes, on site', hint: 'Added to the hours above. Default: 0.', min: 0, max: 59 },
                { key: 'mapEvolutionOnSitePreset', kind: 'select', label: 'Change style on the party’s site', hint: 'Dynamic: bolder changes with more encounters, just outside the party’s area. Standard: the same restraint as for other sites. Default: dynamic.', options: [{ value: 'dynamic', label: 'Dynamic' }, { value: 'standard', label: 'Standard' }] },
                { key: 'mapEvolutionScope', kind: 'select', label: 'Sites a pass considers', hint: 'All: every mapped site that is due. Party’s site: only the site the party is in. Some: a set number of the due sites. Named: the sites selected under "Named sites and their hours" in the Map Evolution drawer of the Lore widget. Default: all.', options: [{ value: 'all', label: 'All' }, { value: 'active', label: 'Party’s site' }, { value: 'count', label: 'Some' }, { value: 'selected', label: 'Named' }] },
                { key: 'mapEvolutionCount', kind: 'number', label: 'Number of sites', hint: 'How many due sites one pass takes. 0 takes every due site. Shown when "Sites a pass considers" is "Some". Default: 2.', min: 0, max: 50, visibleWhen: (p) => p.mapEvolutionScope === 'count' },
                { key: 'mapEvolutionRandomize', kind: 'switch', label: 'Pick sites at random', hint: 'When on, the sites for a pass are picked at random from the due ones. When off, the sites changed longest ago go first. The party’s site, when it is due, is always taken first. Default: on.', visibleWhen: (p) => p.mapEvolutionScope === 'count' },
                { key: 'mapEvolutionWorldReportLookback', kind: 'number', label: 'World reports a site reads', hint: 'How many of the most recent World Progression reports a pass reads. Reports aimed at the site are always included. Default: 5.', min: 1, max: 20 },
                { key: 'mapEvolutionLookback', kind: 'number', label: 'User turns of story a pass reads', hint: 'How many user turns of recent story a pass reads. Every due site gets the same story and applies only what affects its own map. 0 sends no story. Default: 20.', min: 0, max: 100 },
                { key: 'mapEvolutionCompressEnabled', kind: 'switch', label: 'Compress long site history', hint: 'When on, a site’s closed history is shortened once it passes the token limit below. Default: on.' },
                { key: 'mapEvolutionCompressThreshold', kind: 'number', label: 'Compress above this many tokens', hint: 'When a site’s closed history passes this many tokens, one extra pass shortens it into a few summaries. Default: 10,000.', min: 500, max: 100000, step: 100, visibleWhen: (p) => p.mapEvolutionCompressEnabled !== false },
                { key: 'mapEvolutionNarratorCommitTokens', kind: 'number', label: 'Site activity tokens for the narrator', hint: 'The token budget for the site activity briefing sent to the narrator with a site’s map. The briefing covers open threads, recent changes and summaries. Default: 2,000.', min: 200, max: 20000, step: 100 },
                ],
            },
            {
                id: 'screen',
                icon: '🧭',
                title: 'Map display',
                lead: '',
                rows: [
                { key: 'mapRevealAll', kind: 'switch', label: 'Reveal all', hint: 'When on, the map shows everything: every room, everything in them, and what each Map Evolution pass did. When off, the map shows only what the party knows. The same switch is beside the map in the Visuals/Map tab. Default: off.' },
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
                title: 'Location rotation',
                lead: 'World Progression reports on locations, not on individual people or things.',
                rows: [
                { key: 'worldProgressionLocationsPerReport', kind: 'number', label: 'Locations per report', hint: 'How many locations each report covers. The locations reported on longest ago are chosen first. Named people are never report subjects. Default: 3.', min: 1, max: 12 },
                { key: 'worldProgressionLocationRandomize', kind: 'switch', label: 'Randomize equally old locations', hint: 'The locations reported on longest ago always go first. When on, locations that are equally old are picked in random order. When off, they are picked in a fixed order. Default: on.' },
                { key: 'worldProgressionExclusionList', kind: 'text', label: 'Excluded places', hint: 'Locations that World Progression never reports on. Enter the names as their lorebook entries are titled, separated by commas.' },
                ],
            },
            {
                id: 'timing',
                icon: '🕒',
                title: 'Timing & narrative input',
                lead: '“Write a report now” and “Reset the timeline” are in the World Progression drawer of the Lore widget.',
                rows: [
                { key: 'worldProgressionEnabled', kind: 'switch', label: 'Write reports', hint: 'When on, World Progression writes a report each time the in-world interval passes. The clock is the tracker’s [TIME] block, and it starts counting on the next tracker pass. Default: off.' },
                { key: 'worldProgressionIntervalHours', kind: 'number', label: 'In-world hours between reports', hint: 'In-world hours between automatic reports, read from the tracker’s [TIME] block. Default: 24, one report per in-world day.', min: 1, max: 720 },
                { key: 'worldProgressionLookback', kind: 'number', label: 'Replies the report writer reads', hint: 'How many recent replies the report writer reads for scene context. Set 0 to read none. Default: 20.', min: 0, max: 200 },
                ],
            },
            {
                id: 'injection',
                icon: '➡️',
                title: 'Context injection',
                lead: '',
                rows: [
                { key: 'worldProgressionKeepActive', kind: 'number', label: 'Reports shown to the narrator', hint: 'How many of the newest reports the narrator sees, in the “AdventureTime — the world” prompt message. Older reports stay in the campaign’s World lorebook as history. Default: 1.', min: 1, max: 20 },
                ],
            },
            {
                id: 'history',
                icon: '📖',
                title: 'Report history & consolidation',
                lead: '',
                rows: [
                { key: 'worldProgressionHistoryLookback', kind: 'number', label: 'Earlier reports the report writer reads', hint: 'How many earlier reports the report writer reads, besides the ones shown to the narrator, so a new report follows from the last. Set 0 to read none. Default: 0.', min: 0, max: 100 },
                { key: 'worldProgressionConsolidateEnabled', kind: 'switch', label: 'Consolidate old reports', hint: 'When on, the older reports in the campaign’s World lorebook are merged into one digest after every set number of reports. Each merge is one more model call. Default: off.' },
                { key: 'worldProgressionConsolidateInterval', kind: 'number', label: 'Reports between consolidations', hint: 'How many reports are written between consolidations. Default: 7.', min: 2, max: 50, visibleWhen: (p) => p.worldProgressionConsolidateEnabled === true },
                ],
            },
        ],
    },
    {
        id: 'creator',
        // Under Game systems & rulebook since 100c (departure 170): Multihog keeps it with the connections.
        category: 'systems',
        sections: [
            {
                id: 'creation',
                icon: '✍️',
                title: 'Character creation & starting modes',
                lead: 'These defaults are used by the Character creator, Instant Action and the other ways to begin.',
                rows: [
                { key: 'creatorLevel', kind: 'select', label: 'Starting level', hint: 'The level the Character creator offers for the next character. Default: level 1.', options: LEVELS },
                { key: 'creatorGearTier', kind: 'select', label: 'Starting gear', options: GEAR_TIERS.map((t) => ({ value: t.value, label: t.value === 'none' ? 'None (skip gear guidance)' : t.label })) }, // the one tier shown in other words than the generated list's (96)
                { key: 'creatorCombatScalingGuide', kind: 'switch', label: 'Use the scaling guide', hint: 'When on, the character prompt includes a d20-style reference for how combat and skill ability grow with level. Turn it off for a homebrew system that should not read like D&D. Default: on.' },
                { key: 'creatorPlayerCard', kind: 'switch', label: 'Write a Player Card', hint: 'When on, one more model call writes the character’s appearance, personality, habits and backstory into a Player Card. The narrator sees the Player Card on every reply. Default: off. Recommended.' },
                { key: 'creatorCardWords', kind: 'number', label: 'Player Card length (words)', min: CARD_WORDS_MIN, max: CARD_WORDS_MAX, step: 10 },
                { key: 'creatorPersona', kind: 'switch', label: 'Create a matching persona', hint: 'When on, AdventureTime creates a Lumiverse persona with the character’s name and no description, and switches to it. Your messages then carry the character’s name, and the Player Card stays the only biography. Default: on. Recommended.' },
                { key: 'creatorInitialDate', kind: 'text', label: 'Starting day', hint: 'The day the in-world clock starts on. Default: Day 1.' },
                { key: 'creatorInitialTime', kind: 'text', label: 'Starting time', hint: 'The time the in-world clock starts at. Default: 08:00 AM.' },
                { key: 'creatorSendStarter', kind: 'switch', label: 'Instant Action sends the opening message', hint: 'When on, Instant Action sends the opening message for you and the narrator replies. When off, you type your first action. Default: on.' },
                { key: 'creatorInstantRandomLevel', kind: 'switch', label: 'Instant Action: random level (1–10)', hint: 'When on, Instant Action rolls a starting level from 1 to 10. When off, the character starts at level 1. A level named in the setup text overrides both. Default: off.' },
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
.lh-dial-book { display: flex; align-items: center; gap: 6px; font-size: 0.8em; cursor: pointer; }
.adventuretime-panel .lh-dials { display: flex; flex-direction: column; gap: 8px; }
.adventuretime-panel .lh-dial { display: flex; flex-direction: column; gap: 3px; }
.adventuretime-panel .lh-dial-main { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.adventuretime-panel .lh-dial-label { flex: 1; min-width: 10em; }
.adventuretime-panel .lh-dial-label-line { display: flex; align-items: center; gap: 4px; }
.adventuretime-panel .lh-dial-label-line > label { min-width: 0; }
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
        // The hint is behind a [?] after the label (96); its text goes under the row.
        const tip = row.hint ? createHelpTip(el, row.label, row.hint) : null
        const labelled = (node: HTMLElement): HTMLElement => {
            if (!tip) return node
            const line = el('span', { class: 'lh-dial-label lh-dial-label-line' })
            node.classList.remove('lh-dial-label')
            line.append(node, tip.button)
            return line
        }
        let control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        if (row.kind === 'switch') {
            const input = el('input', { type: 'checkbox', 'aria-label': row.label }) as HTMLInputElement
            input.addEventListener('change', () => save({ [row.key]: input.checked }))
            const box = el('label', { class: 'lh-dial-label' })
            box.append(input, label)
            label.className = ''
            main.append(labelled(box))
            control = input
        } else if (row.kind === 'select') {
            const select = el('select', { class: 'lh-input', 'aria-label': row.label }) as HTMLSelectElement
            for (const choice of row.options ?? []) {
                const option = el('option', { value: choice.value }) as HTMLOptionElement
                option.textContent = choice.label
                select.append(option)
            }
            select.addEventListener('change', () => save({ [row.key]: select.value }))
            main.append(labelled(label), select)
            control = select
        } else if (row.kind === 'books') {
            // The legacy's filter list: a tick per book the host has, saved as the ticked names; None ticked reads every book.
            const list = el('div', { class: 'lh-dial-books-list', 'data-lh-field': `dial-${row.key}-list` })
            const note = el('div', { class: 'lh-conn-hint', 'data-lh-field': `dial-${row.key}-note` })
            const reload = el('button', { type: 'button', class: 'lh-button lh-button--quiet' }) as HTMLButtonElement
            reload.textContent = '↻ Reload lorebooks'
            // Clear (73h-bis, the maintainer's ask): the list is long, and unticking it one by one is not a way back to the default.
            const clear = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': `dial-${row.key}-clear` }) as HTMLButtonElement
            clear.textContent = 'Clear selection'
            // Its help is behind a [?] beside it (96), not a tooltip.
            const clearTip = createHelpTip(el, 'Clear selection', 'Clears every selection. The tracker then reads the lorebooks linked to this chat.')
            const ticked = (): string[] => Array.from(list.querySelectorAll<HTMLInputElement>('input[data-lh-book]')).filter((box) => box.checked).map((box) => box.dataset.lhBook ?? '')
            const entry = { row, list, note, loaded: false, load: () => {} }
            entry.load = () => {
                if (!host.listBooks) { note.textContent = 'This build cannot list Lumiverse’s lorebooks.'; return }
                note.textContent = 'Reading the lorebooks…'
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
                        ? (missing.length ? `Selected, but Lumiverse has no lorebook with this name: ${missing.join(', ')}.` : '')
                        : 'No lorebooks found.'
                }).catch((error) => { note.textContent = `The lorebooks could not be listed: ${error instanceof Error ? error.message : String(error)}`; host.fail(error) })
            }
            reload.addEventListener('click', entry.load)
            clear.addEventListener('click', () => {
                for (const box of Array.from(list.querySelectorAll<HTMLInputElement>('input[data-lh-book]'))) box.checked = false
                save({ [row.key]: [] })
            })
            bookRows.push(entry)
            main.append(labelled(label), reload, clear, clearTip.button)
            container.classList.add('lh-dial--stacked')
            container.append(main)
            if (tip) container.append(tip.note)
            container.append(clearTip.note)
            container.append(list, note)
            into.append(container)
            return
        } else if (row.kind === 'prompt') {
            const box = el('textarea', { class: 'lh-input', rows: '3', spellcheck: 'false', 'aria-label': row.label, placeholder: row.placeholder ?? '' }) as HTMLTextAreaElement
            box.addEventListener('change', () => save({ [row.key]: box.value }))
            main.append(labelled(label))
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
            main.append(labelled(label), input)
            control = input
        }
        container.append(main)
        if (tip) container.append(tip.note)
        if (row.kind === 'prompt') container.append(control)
        rows.push({ row, container, control })
        into.append(container)
    }

    for (const section of group.sections) {
        const card = el('details', { class: 'lh-card lh-dial-card', 'data-lh-card': section.id }) as HTMLDetailsElement
        const summary = el('summary')
        const icon = el('span', { class: 'lh-card-icon', 'aria-hidden': 'true' })
        setCardIcon(icon, section.title, section.icon)
        const title = el('span', { class: 'lh-card-title' })
        title.textContent = section.title
        summary.append(icon, title, el('span', { class: 'lh-chevron', 'aria-hidden': 'true' }))
        card.append(summary)
        if (section.lead) attachCardHelp(el, card, summary, title, section.lead)
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
