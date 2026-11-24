/**
 * The declarative settings table.
 *
 * The legacy build bound every control by hand — 171 bindings across ~1,700
 * lines, each one re-implementing "read the value, coerce it, write it back,
 * save, then poke whatever else depends on it". This replaces that shape with
 * a table: a row per control, and one binder that knows how to render and
 * bind any row (see src/frontend/binder.ts).
 *
 * Scope note. Phase 0 covers the **cartridge surface** — the 49 keys in
 * CARTRIDGE_PAYLOAD_GROUPS that a Game Cartridge carries. That is deliberate:
 * those are the settings whose contract is locked by tests/, so they are the
 * ones worth wiring first, and it makes the panel round-trip a real cartridge
 * end to end. The rest of the legacy settings (map lookback, portrait
 * connections, toasts, and so on) arrive with the features that use them.
 *
 * Section ids match CARTRIDGE_PAYLOAD_GROUPS ids so the panel and the
 * cartridge groups stay in step.
 */

import { CARTRIDGE_PAYLOAD_GROUPS } from '../state/payload-groups.js'
import {
    readCustomFields,
    readFlagTable,
    readCyoaConfig,
    readGameSystems,
    readBlockOrder,
    readSectionOrder,
    readStockPrompts,
    readRouterCustomTags,
    readRouterModules,
    readSyspromptLibrary,
    validateCoreSections,
    validateSectionPresets,
} from './managed-values.js'

export type SettingsBag = Record<string, unknown>

export type FieldType =
    | 'boolean'
    | 'number'
    | 'text'
    | 'textarea'
    | 'select'
    /**
     * One control standing in front of several settings keys. The legacy RNG
     * mode radio is the motivating case: three radio values write two
     * different booleans, and neither boolean has a control of its own.
     */
    | 'derived'
    /**
     * Part of the cartridge surface, but edited by a dedicated editor rather
     * than a plain control — module tables, game systems, CYOA config, saved
     * presets. Listed in the panel so the surface stays visible and honest;
     * the editors themselves are Phase 1+.
     */
    | 'managed'

export interface SelectOption {
    value: string
    label: string
}

export interface FieldDef {
    /** Settings key this field owns. For `derived`, see `keys`. */
    key: string
    type: FieldType
    label: string
    /** One-line explanation shown under the control. */
    help?: string
    /** `number` only. */
    min?: number
    max?: number
    step?: number
    /** `select` and `derived` (when rendered as a select). */
    options?: SelectOption[]
    /** `derived` only: every settings key the control writes. */
    keys?: string[]
    /** `derived` only: compute the control's value from settings. */
    read?: (settings: SettingsBag) => string
    /**
     * Listed for its validator and drawn by another field's editor, so the
     * binder draws no row for it: the cards' order is a column of the
     * modules editor since 82.
     */
    hidden?: boolean
    /**
     * A folded sub-card the row is drawn in (83), by title: the rows sharing a
     * title share one card, at the first's place among the section's rows —
     * Multihog's *Portrait Prompt Templates*, closed at the section's foot.
     */
    fold?: string
    /** `derived` only: turn the control's value into a settings patch. */
    write?: (value: string) => SettingsBag
    /**
     * `managed` only: how a dedicated editor's value is checked on the way in.
     *
     * A managed key is writable **only** when it has one of these. Without it
     * the store refuses the write, which is what protects a cartridge key that
     * has no editor yet — and what silently blocked the one that does, until
     * this existed. Throwing rejects the whole patch; returning a value stores
     * it.
     */
    validate?: (value: unknown) => unknown
    /** Reactive visibility. Replaces the hand-written `sync*Ui()` helpers. */
    visibleWhen?: (settings: SettingsBag) => boolean
}

/**
 * The settings' categories (Phase 63): Multihog's seven, in its order, on
 * AdventureTime's side panel — a fold each on the settings tab, holding the
 * sections and editors that belong to it. Adventure Companion, Multihog's
 * eighth, is closed (`docs/ROADMAP.md`).
 */
export type SettingsCategoryId = 'general' | 'connections' | 'systems' | 'tracker' | 'agent' | 'maps' | 'world'

export interface SettingsCategory {
    id: SettingsCategoryId
    title: string
    description: string
    /** The fold's icon (63d), as Multihog's tabs carry one. */
    icon: string
}

export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
    { id: 'general', icon: '⚙️', title: 'General & visuals', description: 'The cartridges, the layout, the choices, and the portraits and pictures.' },
    { id: 'connections', icon: '🔌', title: 'Connections & models', description: 'Every connection AdventureTime’s passes and draws run on, in one place; each is also beside what it drives.' },
    { id: 'systems', icon: '🎩', title: 'Game systems & rulebook', description: 'The game systems and custom fields, the wizard, and the narrator rulebook.' },
    { id: 'tracker', icon: '🧠', title: 'State Tracker', description: 'The tracker’s system prompt, the time formats, the modules and the order of the cards.' },
    { id: 'agent', icon: '🧭', title: 'Lorebook Agent', description: 'The agent’s prompts, the character sheets, and how often and how far back it runs.' },
    { id: 'maps', icon: '🗺️', title: 'Persistent maps', description: 'The map themes, the map prompts, and how Map Architect, Map Updater and Map Evolution run.' },
    { id: 'world', icon: '🌐', title: 'World Progression', description: 'The report prompt, the World Skeleton, and when and where reports are written.' },
]

export interface SectionDef {
    /** Matches a CARTRIDGE_PAYLOAD_GROUPS id — or, with `group` set, names this section alone. */
    id: string
    /**
     * The payload group a split-off section's keys belong to (70): the
     * narrator's configuration and the rulebook are the State Tracker
     * group's keys drawn under *Game systems & customisation*, as Multihog
     * draws them. Such a section has no reset of its own; the group's card
     * resets it, and says so.
     */
    group?: string
    title: string
    description?: string
    /** One visible sentence beside the card's Reset to factory (96): what else the reset takes with it. */
    warning?: string
    /** The reset's confirm message, where the card's own sentence says more than the shared one (96). */
    resetConfirm?: string
    /** The line said after the reset, in place of the shared one (96). */
    resetDone?: string
    /** The category fold the section is drawn in (63). */
    category: SettingsCategoryId
    /** The card's icon (63d). */
    icon: string
    /**
     * A section drawn whole by a dedicated editor, named here, instead of
     * row by row (70): the narrator's configuration is Multihog's block of
     * radios and switches, not a list of selects. Its fields stay in the
     * schema as the store's allowlist and for the coercion of each key.
     */
    editor?: string
    fields: FieldDef[]
}

/** Valid `narrativePacing` values, with the labels the legacy UI used. */
export const NARRATIVE_PACING_OPTIONS: SelectOption[] = [
    { value: 'normal', label: 'Normal' },
    { value: 'shorter_outputs', label: 'Shorter replies' },
    { value: 'high_agency', label: 'High agency' },
    { value: 'downtime', label: 'Downtime / slice of life' },
]

/**
 * RNG mode. `rngEnabled` and `diceFunctionTool` are not independently
 * meaningful — the legacy UI presented exactly three combinations and never
 * exposed the fourth (`rngEnabled: false, diceFunctionTool: true`). Modelling
 * them as two checkboxes would let a user reach a state the prompt stack has
 * never seen, so they stay behind one control.
 */
export const RNG_MODE_OPTIONS: SelectOption[] = [
    { value: 'hybrid', label: 'Pre-seeded queue + tool calls' },
    { value: 'legacy', label: 'Pre-seeded queue only' },
    { value: 'none', label: 'No dice rolls' },
]

export function readRngMode(settings: SettingsBag): string {
    if (!settings.rngEnabled) return 'none'
    return settings.diceFunctionTool === false ? 'legacy' : 'hybrid'
}

export function writeRngMode(value: string): SettingsBag {
    if (value === 'hybrid') return { rngEnabled: true, diceFunctionTool: true }
    if (value === 'legacy') return { rngEnabled: true, diceFunctionTool: false }
    return { rngEnabled: false, diceFunctionTool: false }
}

/** `activePortraitPromptPresetId` (63b): a style's id, `user:Name`, or empty. */
function validateActivePreset(value: unknown): string {
    if (typeof value !== 'string') throw new Error('activePortraitPromptPresetId must be a string')
    return value
}

/** `savedPortraitPromptPresets` (63b): a name to the legacy's five fields, nothing else kept. */
function validateSavedPresets(value: unknown): Record<string, Record<string, unknown>> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('savedPortraitPromptPresets must be an object of setups by name')
    const out: Record<string, Record<string, unknown>> = {}
    for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
        if (!name.trim()) throw new Error('A saved setup needs a name')
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`The setup "${name}" is not an object`)
        const preset = raw as Record<string, unknown>
        const kept: Record<string, unknown> = {}
        for (const key of ['npcSystemPrompt', 'characterSystemPrompt', 'locationSystemPrompt'] as const) {
            if (preset[key] !== undefined) {
                if (typeof preset[key] !== 'string') throw new Error(`The setup "${name}" has a ${key} that is not text`)
                kept[key] = preset[key]
            }
        }
        if (preset.includePresentNpcs !== undefined) kept.includePresentNpcs = preset.includePresentNpcs === true
        if (preset.wordTarget !== undefined) {
            const n = Number(preset.wordTarget)
            if (!Number.isFinite(n)) throw new Error(`The setup "${name}" has a word target that is not a number`)
            kept.wordTarget = Math.max(1, Math.min(2000, Math.floor(n)))
        }
        out[name] = kept
    }
    return out
}

/** Shorthand for the many long prompt fields. */
function prompt(key: string, label: string, help?: string): FieldDef {
    return { key, type: 'textarea', label, help }
}

/** Shorthand for a key that exists in cartridges but has no control yet. */
function managed(
    key: string,
    label: string,
    help: string,
    validate?: (value: unknown) => unknown,
): FieldDef {
    return { key, type: 'managed', label, help, validate }
}

export const SETTINGS_SCHEMA: SectionDef[] = [
    {
        id: 'stateTracker',
        icon: '🧠',
        category: 'tracker',
        title: 'State Tracker',
        description: 'The tracker’s system prompt, the time formats, the modules and the order of the cards.',
        // Stays in the open, beside the card's Reset to factory (96, TRK-013b): the two cards it names are in another category.
        warning: 'Reset to factory also resets the Narrator card and the Narrator rulebook.',
        fields: [
            prompt('systemPromptTemplate', 'Tracker system prompt',
                'The system prompt for every tracker pass. It is tuned text, so edit with care. While Full Review Mode is on, a built-in prompt is used in its place.'),
            { key: 'use24hTime', type: 'boolean', label: 'Use 24-hour time', help: 'When on, the in-world clock is written in 24-hour time. When off, it is written in 12-hour time. Default: off.' },
            { key: 'useDdMmYyFormat', type: 'boolean', label: 'Use DD/MM/YYYY dates', help: 'When on, in-world dates are written as calendar dates (DD/MM/YYYY). When off, they are written as a day count, such as Day 5. Default: off.' },
            // One [?] for the whole list (96): its rows are redrawn on every switch and move, so the rows' own help is lines of it.
            managed('modules', 'Tracker modules',
                'These are the tracker’s built-in blocks. When a module is on, the tracker is told about it on every pass and keeps its block up to date. When it is off, its block stops updating, but it keeps what it holds and still travels in the cartridge.\n\n' +
                'The arrows set the order of the cards, in the Tracker widget and under each message. A module that is off keeps its place, because its card is still drawn while the memo holds its block. The order does not change the tracker’s prompt.\n\n' +
                'Edited: this module’s text differs from the stock text.\n' +
                'In the Party card: benched party members are drawn inside the Party card, so this block has no place of its own in the order.\n' +
                'Custom field: turn it on or off and edit its text under Custom fields. Its place among the cards is set here. While it is off under Custom fields, its card is drawn only while the memo still holds its block.\n' +
                'Display group: its arrows move all its member modules together.',
                readFlagTable('modules')),
            // Drawn as the arrows of the modules editor (82); listed here so the store takes the key.
            { ...managed('blockOrder', 'Section order', 'The order the cards are drawn in, in the panel and under each message.', readBlockOrder), hidden: true },
            // Edited through Edit text on the modules' rows (36); the row itself had no control (96, TRK-106). The store still takes the key.
            { ...managed('stockPrompts', 'Stock prompts', 'Per-module stock prompt text.', readStockPrompts), hidden: true },
        ],
    },
    {
        // Multihog's Narrator Configuration block (70): the State Tracker group's
        // pacing and dice keys, drawn whole by `narrator-config.ts` under Game
        // systems, where Multihog draws the block, and again in the starting area.
        id: 'narrator',
        group: 'stateTracker',
        icon: '🎭',
        category: 'systems',
        title: 'Narrator',
        description: 'Sets pacing, dice, quests and optional components for the narrator. Changes take effect on the next reply. The same controls also appear under Starting the adventure.',
        editor: 'narrator',
        fields: [
            { key: 'narrativePacing', type: 'select', label: 'Narrative pacing', options: NARRATIVE_PACING_OPTIONS },
            {
                key: 'rngMode',
                type: 'derived',
                label: 'RNG mode',
                help: 'Pre-seeded: a queue of dice is rolled and sent with every reply, and the narrator reads from it. ' +
                    'Tool calls: the narrator declares the DC, then calls RollTheDice and quotes the result; the queue is used only in combat. ' +
                    'Choosing a mode sets the four dice switches below to match, as Multihog did.',
                options: RNG_MODE_OPTIONS,
                keys: ['rngEnabled', 'diceFunctionTool'],
                read: readRngMode,
                write: writeRngMode,
            },
            {
                key: 'diceD100Mode',
                type: 'boolean',
                label: 'd100 mode',
                help: 'Percentage rulesets: the rulebook\'s dice wording says d100, and the queue and tool below switch to their d100 forms. Follows the d100 switches, as in Multihog.',
                visibleWhen: (s) => s.rngEnabled !== false,
            },
            {
                key: 'rngToolD20',
                type: 'boolean',
                label: 'Register RollTheDice (unified tool)',
                help: 'Gives the narrator a dice tool to call by name, with the DC declared first. Needs the tools permission.',
                visibleWhen: (s) => s.rngEnabled !== false,
            },
            {
                key: 'rngToolD100',
                type: 'boolean',
                label: 'Register RollTheDiceD100 (d100 tool)',
                help: 'The same tool for percentage rulesets: roll under the chance given. Ticking it turns d100 mode on.',
                visibleWhen: (s) => s.rngEnabled !== false,
            },
            {
                key: 'rngQueueD20',
                type: 'boolean',
                label: 'Pre-seed [RNG_QUEUE] (d20 queue)',
                help: 'Twelve lines of d20, d4, d6, d8, d10 and d12, fresh for every reply.',
                visibleWhen: (s) => s.rngEnabled !== false,
            },
            {
                key: 'rngQueueD100',
                type: 'boolean',
                label: 'Pre-seed [RNG_QUEUE_d100] (d100 queue)',
                help: 'Thirty d100 lines, fresh for every reply. Goes with the d20 queue if both are on.',
                visibleWhen: (s) => s.rngEnabled !== false,
            },
        ],
    },
    {
        id: 'cyoa',
        icon: '🔀',
        category: 'general',
        title: 'CYOA mode',
        description: 'Sets how many choices the narrator offers after each reply and what kind each one is. You can save choice lists as presets or write the instruction yourself.',
        fields: [
            managed('cyoaConfig', 'Choice setup', '', readCyoaConfig),
        ],
    },
    {
        id: 'gameSystems',
        icon: '🎩',
        category: 'systems',
        title: 'Game systems & custom fields',
        description: 'A game system pairs a narrator rule with a tracker module. Custom fields are extra blocks the tracker keeps.',
        fields: [
            // One `[?]` for the list (96): what a system is, the four badges, the row's export. The rows are redrawn, so none carries help of its own.
            managed('gameSystems', 'Game systems',
                'A game system pairs a narrator rule with a tracker module. Turn the tracker module on or off in Custom fields. Turn the narrator rule on or off in World rules.\n\n' +
                'Tracked: the tracker module is on, so the tracker updates it on every pass.\n' +
                'Off: the tracker module is off, so the tracker is not told about it.\n' +
                'Narrator rule only: there is no tracker module.\n' +
                'Broken link: the system names a tracker module that no longer exists.\n\n' +
                'Export system saves a system as a file with its tracker field and its narrator rule.\n\n' +
                'More in this category’s guide.',
                readGameSystems),
            // Both managed keys now have an editor, and so a validator each.
            // A managed key without one is still refused (see
            // `managed-values.ts`); nothing is left in that state today.
            managed('customFields', 'Custom fields',
                'Extra blocks the tracker keeps, beyond the stock modules.\n\n' +
                'A field that is off is still saved in cartridges. Its card still shows if its block is already in the memo. The tracker is not told about it, so it does not update.\n\n' +
                'The instruction is everything the tracker is told about a block. A field with no instruction is left out of the tracker prompt, even when it is on.',
                readCustomFields),
        ],
    },
    {
        // The rulebook (70): its switches, their order and the user's own
        // sections, under Game systems, where Multihog keeps `rpg_sysprompt_mod_*`.
        id: 'rulebook',
        group: 'stateTracker',
        icon: '📜',
        category: 'systems',
        title: 'Narrator rulebook',
        description: 'Chooses which rulebook sections are sent to the narrator. Your own sections are sent among them.',
        fields: [
            managed('syspromptModules', 'Stock sections', 'The rules the narrator plays by: combat, resting, loot, levelling and more. Sections are listed in the order they are sent.\n\nYour own sections are shown in the list at the place they are sent.', readFlagTable('syspromptModules')),
            // Not drawn (96): the row showed a saved order no control changes. The key stays the store's and the
            // cartridge's; the world rules editor writes it when a section is deleted.
            { ...managed('syspromptSectionOrder', 'Sysprompt section order', 'Order of the sysprompt sections.', readSectionOrder), hidden: true },
            managed('customSyspromptLibrary', 'World rules', 'Your own instructions to the narrator. Every section that is on is sent with every reply.', readSyspromptLibrary),
        ],
    },
    {
        id: 'characterSheets',
        icon: '👤',
        category: 'agent',
        title: 'Character sheets',
        description: 'The sections of NPC and Player Card sheets, their saved presets, and the relationship system switch.',
        fields: [
            {
                key: 'npcRelationshipBars',
                type: 'boolean',
                label: 'Relationship system',
                help: 'Tracks each NPC’s friendship and affection toward your character. When on, the narrator sees every NPC’s standing, and the tracker or the narrator changes the values. Default: on.',
            },
            managed('npcCoreSections', 'NPC sections', 'The [CORE] identity sections every NPC is recorded under, in this order. Each section has a name, an icon, a colour and an instruction that tells the agent what to record. Saving rebuilds the agent’s NPC, location and faction instructions if they are still stock. An instruction you have edited is kept.\n\nOverwrite preset: replaces the chosen preset with the sections in the list. Choose a preset first, or use Save as new preset to make one.\nSave as new preset: saves the sections in the list as a preset under the name typed. Presets are stored in the cartridge.\nReset to stock: puts the stock sections in the list. Nothing changes until you press Save sections.\nRevert changes: discards unsaved edits and restores the list saved in the cartridge.\nHidden until set: a section marked this way is written only once it has a value. The stock Combat Profile section is one.', validateCoreSections),
            managed('pcCoreSections', 'PC sections', 'The sections of the Player Card, in this order. They are used when a character is generated or a character card is imported.\n\nOverwrite preset: replaces the chosen preset with the sections in the list. Choose a preset first, or use Save as new preset to make one.\nSave as new preset: saves the sections in the list as a preset under the name typed. Presets are stored in the cartridge.\nReset to stock: puts the stock sections in the list. Nothing changes until you press Save sections.\nRevert changes: discards unsaved edits and restores the list saved in the cartridge.\nHidden until set: a section marked this way is written only once it has a value. The stock Combat Profile section is one.', validateCoreSections),
            { ...managed('npcSectionPresets', 'NPC section presets', 'Saved sets of NPC sections.', validateSectionPresets), hidden: true },
            { ...managed('pcSectionPresets', 'PC section presets', 'Saved sets of PC sections.', validateSectionPresets), hidden: true },
        ],
    },
    {
        id: 'portraits',
        icon: '🖼️',
        category: 'general',
        title: 'Portraits & location images',
        description: 'Sets who gets a portrait and when, how location images are shown and drawn, and the prompts the pictures are written from. The image and prompt connections for portraits and location images are set under Connections & models.',
        // Multihog's order (83): the switches the panel draws first, then the art
        // styles, then the three prompts and the word target under a folded card
        // of their own at the foot, Multihog's *Portrait Prompt Templates*.
        fields: [
            // The art styles (63b): the styles editor is mounted on the saved
            // setups' row and shows which is active, so the id has no row of
            // its own (96, the audit's finding 22: it was drawn and always
            // hidden); both are written by the backend's preset ops and
            // carried in every cartridge.
            { ...managed('activePortraitPromptPresetId', 'Active art style', 'Shows which art style or saved setup was loaded last. It is empty once a prompt is edited.', validateActivePreset), hidden: true },
            managed('savedPortraitPromptPresets', 'Art styles', 'Loading a style replaces the three prompt templates and the word target below. You can save your own prompts as a named setup. The style loaded last is marked "loaded" until you edit a prompt.', validateSavedPresets),
            { ...prompt('portraitNpcSystemPrompt', 'NPC portrait prompt'), fold: 'Portrait prompt templates' },
            { ...prompt('portraitCharacterSystemPrompt', 'Character portrait prompt'), fold: 'Portrait prompt templates' },
            { ...prompt('portraitLocationSystemPrompt', 'Location image prompt'), fold: 'Portrait prompt templates' },
            {
                key: 'portraitPromptWordTarget',
                type: 'number',
                label: 'Prompt word target',
                min: 10,
                max: 2000,
                step: 10,
                fold: 'Portrait prompt templates',
            },
        ],
    },
    {
        id: 'lorebookAgent',
        icon: '🧭',
        category: 'agent',
        title: 'Agent prompts',
        description: 'The prompt texts the Lorebook Agent is sent on each pass.',
        // The seven texts the agent is told (72c), where Multihog's agent
        // mode reads them. The four Basic Mode texts — the basic system
        // prompt, the modular format prompt, the basic Combat Profile
        // guidance, the basic relationship section — have no row: Basic Mode
        // (one-shot tag parsing, with activation) is not ported, so nothing
        // would read an edit. The keys ride through every cartridge untouched.
        fields: [
            prompt('routerSystemPromptTemplate', 'Agent system prompt', 'The system prompt for the agent. It is sent first on every agent pass. The agent reads this text from <player_character_safeguard> onward, about sixty lines down. An edit above that line is never sent. Every other section is sent as written. Its date examples are rewritten to the campaign’s time format.\n\nDifferent from Multihog: the three activation sections (basic_instructions, context_maximization, bravery) are not sent. Lumiverse decides which lorebook entries are active, so those sections have nothing to manage.'),
            prompt('routerAgentSharedContextTemplate', 'Shared context template', 'The shared context for the agent. It is sent after the tool descriptions. Its {{…}} placeholders are filled on every pass with the other texts on this card, the campaign’s lorebooks and the module instructions. While the party is inside a mapped site, the DUNGEON LOCATION OWNERSHIP section is replaced by a short mapped-site note.\n\nDifferent from Multihog: the MEMORY LIMIT section is not sent.'),
            prompt('routerCombatProfileGuidanceAgentTemplate', 'Combat profile guidance', 'Sent while the tracker memo holds a [COMBAT] or [PARTY] block. It is inserted where the shared context template asks for it.'),
            prompt('routerAutoPassRestrictionTemplate', 'Automatic-pass restriction', 'Sent on an automatic pass after a reply. On that pass the agent may edit an NPC’s Combat Profile and no other [CORE] field. Edits to other fields are refused.'),
            prompt('routerManualPassRestrictionTemplate', 'Manual-pass restriction', 'Sent on a pass you run by hand or with an instruction. {{eligibleCoreFields}} is replaced by the identity fields named in NPC sections.'),
            prompt('routerExistingNpcNudgeTemplate', 'Existing-NPC nudge', 'Sent on every pass. It is inserted where the shared context template asks for it.'),
            prompt('routerRelSectionAgentTemplate', 'Relationship section', 'Sent while the relationship system is on. Placeholders such as {{max}} and {{p30}} are replaced with values for the current relationship scale.'),
            managed('routerModules', 'Agent modules', 'What the Lorebook Agent is told about each category it records.', readRouterModules),
            managed('routerCustomTags', 'Custom tags', 'Your own categories for the Lorebook Agent.', readRouterCustomTags),
        ],
    },
    {
        id: 'mapArchitect',
        icon: '🗺️',
        category: 'maps',
        title: 'Map prompts',
        description: 'The system prompts of the map passes: Map Architect’s contents pass, Map Updater, Map Evolution and Map Evolution’s history compression. They are saved in the cartridge. Reset to factory restores the stock text.',
        resetConfirm: 'This replaces the four map prompts with the factory text.',
        resetDone: 'Map prompts reset to factory values.',
        fields: [
            prompt('mapArchitectSystemPrompt', 'Map Architect prompt'),
            prompt('mapUpdaterSystemPrompt', 'Map Updater prompt'),
            prompt('mapEvolutionSystemPrompt', 'Map Evolution prompt'),
            prompt('mapEvolutionCompressSystemPrompt', 'Map Evolution compression prompt'),
        ],
    },
    {
        id: 'worldProgression',
        icon: '🖥️',
        category: 'world',
        title: 'Report prompt',
        description: 'The system prompt for the model that writes World Progression reports.',
        fields: [
            prompt('worldProgressionSystemPrompt', 'World Progression prompt'),
        ],
    },
]

/** Every settings key any field in the schema owns. */
export function schemaKeys(schema: SectionDef[] = SETTINGS_SCHEMA): string[] {
    const keys: string[] = []
    for (const section of schema) {
        for (const field of section.fields) {
            if (field.type === 'derived') keys.push(...(field.keys ?? []))
            else keys.push(field.key)
        }
    }
    return keys
}

/** Look up the field that owns a settings key, if any. */
export function fieldForKey(key: string, schema: SectionDef[] = SETTINGS_SCHEMA): FieldDef | undefined {
    for (const section of schema) {
        for (const field of section.fields) {
            if (field.type === 'derived' ? (field.keys ?? []).includes(key) : field.key === key) return field
        }
    }
    return undefined
}

/**
 * Coerce a raw control value to the type the settings key expects.
 *
 * Out-of-range numbers clamp rather than reject: the legacy bindings did the
 * same, and a clamp is a better answer than silently discarding what the user
 * typed.
 */
export function coerce(field: FieldDef, raw: unknown): unknown {
    switch (field.type) {
        case 'boolean':
            return !!raw
        case 'number': {
            const parsed = Number.parseFloat(String(raw))
            if (!Number.isFinite(parsed)) return 0
            const lo = field.min ?? Number.NEGATIVE_INFINITY
            const hi = field.max ?? Number.POSITIVE_INFINITY
            return Math.min(hi, Math.max(lo, parsed))
        }
        case 'select': {
            const value = String(raw ?? '')
            const allowed = field.options ?? []
            if (allowed.length && !allowed.some((o) => o.value === value)) return allowed[0]!.value
            return value
        }
        case 'text':
        case 'textarea':
            return String(raw ?? '')
        default:
            return raw
    }
}

/**
 * The values a derived control can legitimately write to one of its keys.
 *
 * A derived field owns several keys and writes them as a set, so there is no
 * single `type` to coerce against. Instead the legal values are exactly those
 * some option produces — which makes the backend's check on a derived key as
 * strict as the one on any other setting, without the schema having to
 * restate types it already implies.
 */
export function derivedAllowedValues(field: FieldDef, key: string): unknown[] {
    if (field.type !== 'derived' || !field.write) return []
    return (field.options ?? []).map((option) => field.write!(option.value)[key])
}

/**
 * Guard against the schema and the cartridge contract drifting apart. Every
 * key the schema names must be a real cartridge payload key — a typo would
 * otherwise create a settings key that no cartridge carries and nothing ever
 * restores.
 */
export function unknownSchemaKeys(schema: SectionDef[] = SETTINGS_SCHEMA): string[] {
    const payloadKeys = new Set(CARTRIDGE_PAYLOAD_GROUPS.flatMap((g) => g.keys))
    return schemaKeys(schema).filter((key) => !payloadKeys.has(key))
}
