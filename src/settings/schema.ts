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
    { id: 'systems', icon: '🎩', title: 'Game systems & customisation', description: 'The game systems and custom fields, the wizard, and the narrator’s rulebook.' },
    { id: 'tracker', icon: '🧠', title: 'State tracker & modules', description: 'The extractor prompt, the dice, the time formats, the modules and the cards’ order.' },
    { id: 'agent', icon: '🧭', title: 'Lorebook agent', description: 'The agent’s prompts and modules, the custom tags, and the character sheets.' },
    { id: 'maps', icon: '🗺️', title: 'Persistent maps', description: 'The Map Architect, the Updater and Evolution.' },
    { id: 'world', icon: '🌐', title: 'World progression', description: 'The report prompt.' },
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
    { value: 'normal', label: 'Normal (no length instructions)' },
    { value: 'shorter_outputs', label: 'Shorter Outputs' },
    { value: 'high_agency', label: 'High-Agency Mode' },
    { value: 'downtime', label: 'Downtime / Slice of Life Mode' },
]

/**
 * RNG mode. `rngEnabled` and `diceFunctionTool` are not independently
 * meaningful — the legacy UI presented exactly three combinations and never
 * exposed the fourth (`rngEnabled: false, diceFunctionTool: true`). Modelling
 * them as two checkboxes would let a user reach a state the prompt stack has
 * never seen, so they stay behind one control.
 */
export const RNG_MODE_OPTIONS: SelectOption[] = [
    { value: 'hybrid', label: 'Pre-seeded + tool calls (recommended without CYOA Mode)' },
    { value: 'legacy', label: 'Pre-seeded only (recommended with CYOA Mode)' },
    { value: 'none', label: 'No RNG (the model makes numbers up — not recommended)' },
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
        description: 'The extractor prompt, the time formats, the modules and the cards’ order. Reset to factory here resets the narrator’s configuration and the rulebook with them: they are one group in a cartridge.',
        fields: [
            prompt('systemPromptTemplate', 'Extractor system prompt',
                'The prompt the State Extractor model runs. Tuned text — edit with care.'),
            { key: 'use24hTime', type: 'boolean', label: 'Use 24-hour time' },
            { key: 'useDdMmYyFormat', type: 'boolean', label: 'Use DD/MM/YYYY calendar dates' },
            managed('modules', 'Tracker modules', 'Per-module enable/tag/format/instruction table.', readFlagTable('modules')),
            // Drawn as the arrows of the modules editor (82); listed here so the store takes the key.
            { ...managed('blockOrder', 'Section order', 'The order the cards are drawn in, in the panel and under each message.', readBlockOrder), hidden: true },
            managed('stockPrompts', 'Stock prompts', 'Per-module stock prompt text.', readStockPrompts),
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
        title: 'Narrator configuration',
        description: 'Pacing, the dice, the quests and the optional components the narrator plays with. The same block is in the starting area of the tracker.',
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
        title: 'CYOA Mode',
        description: 'Choice slots, custom prompt, button appearance, and saved CYOA presets.',
        fields: [
            managed('cyoaConfig', 'CYOA configuration', 'Slot setup, custom prompt text, and button appearance.', readCyoaConfig),
        ],
    },
    {
        id: 'gameSystems',
        icon: '🎩',
        category: 'systems',
        title: 'Game Systems & Custom Fields',
        description: 'Linked GM-section / tracker-module pairs, and custom tracker fields.',
        fields: [
            managed('gameSystems', 'Game systems', 'Paired GM section + tracker module definitions.', readGameSystems),
            // Both managed keys now have an editor, and so a validator each.
            // A managed key without one is still refused (see
            // `managed-values.ts`); nothing is left in that state today.
            managed('customFields', 'Custom fields', 'Extra tracker fields.', readCustomFields),
        ],
    },
    {
        // The rulebook (70): its switches, their order and the user's own
        // sections, under Game systems, where Multihog keeps `rpg_sysprompt_mod_*`.
        id: 'rulebook',
        group: 'stateTracker',
        icon: '📜',
        category: 'systems',
        title: 'The narrator’s rulebook',
        description: 'Which of Multihog’s rules are sent, in what order, and your own sections among them.',
        fields: [
            managed('syspromptModules', 'The rulebook', 'Which of Multihog’s narrator rules are sent.', readFlagTable('syspromptModules')),
            managed('syspromptSectionOrder', 'Sysprompt section order', 'Order of the sysprompt sections.', readSectionOrder),
            managed('customSyspromptLibrary', 'Your world rules', 'Your own instructions to the storyteller.', readSyspromptLibrary),
        ],
    },
    {
        id: 'characterSheets',
        icon: '👤',
        category: 'agent',
        title: 'Character Sheets',
        description: 'NPC and PC sheet sections, saved section presets, relationship bars.',
        fields: [
            {
                key: 'npcRelationshipBars',
                type: 'boolean',
                label: 'Relationship system',
                help: "Tracks each NPC's friendship and affection toward you.",
            },
            managed('npcCoreSections', 'NPC sections', 'The [CORE] identity sections every NPC is recorded under: the name the agent writes, the instruction telling it what the section holds, the icon and colour the cards draw. Save rebuilds the agent’s NPC, LOC and FAC instructions where they still read as stock.', validateCoreSections),
            managed('pcCoreSections', 'PC sections', 'The Player Card’s sections, read when a character is generated or a card imported.', validateCoreSections),
            { ...managed('npcSectionPresets', 'NPC section presets', 'Saved NPC section layouts.', validateSectionPresets), visibleWhen: () => false },
            { ...managed('pcSectionPresets', 'PC section presets', 'Saved PC section layouts.', validateSectionPresets), visibleWhen: () => false },
        ],
    },
    {
        id: 'portraits',
        icon: '🖼️',
        category: 'general',
        title: 'Portraits and location images',
        description: 'Who is drawn and when, the location images, the scene drawn as you play, the art styles, and the prompts a portrait and a scene picture are written from. The connections are under Connections & models.',
        // Multihog's order (83): the switches the panel draws first, then the art
        // styles, then the three prompts and the word target under a folded card
        // of their own at the foot, Multihog's *Portrait Prompt Templates*.
        fields: [
            // The art styles (63b): the styles editor is mounted on the saved
            // setups' row and shows which is active, so the id's own row is
            // hidden; both are written by the backend's preset ops and carried
            // in every cartridge.
            { ...managed('activePortraitPromptPresetId', 'Active art style', 'Which art style or saved setup was loaded last; empty once a prompt is edited.', validateActivePreset), visibleWhen: () => false },
            managed('savedPortraitPromptPresets', 'Portrait and location image styles', 'Multihog’s seven art styles, each loading the three prompt templates below, and your own setups saved under a name.', validateSavedPresets),
            { ...prompt('portraitNpcSystemPrompt', 'NPC portrait prompt'), fold: 'Portrait prompt templates' },
            { ...prompt('portraitCharacterSystemPrompt', 'Character portrait prompt'), fold: 'Portrait prompt templates' },
            { ...prompt('portraitLocationSystemPrompt', 'Location portrait prompt'), fold: 'Portrait prompt templates' },
            {
                key: 'portraitPromptWordTarget',
                type: 'number',
                label: 'Portrait prompt word target',
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
        title: 'Lorebook Agent',
        description: 'The researcher agent: its prompts, module definitions, and custom tags.',
        // The seven texts the agent is told (72c), where Multihog's agent
        // mode reads them. The four Basic Mode texts — the basic system
        // prompt, the modular format prompt, the basic Combat Profile
        // guidance, the basic relationship section — have no row: Basic Mode
        // (one-shot tag parsing, with activation) is not ported, so nothing
        // would read an edit. The keys ride through every cartridge untouched.
        fields: [
            prompt('routerSystemPromptTemplate', 'Agent system prompt', 'Multihog’s system prompt for the agent, sent first. Its three activation sections — basic_instructions, context_maximization, bravery — are not sent: the active set they curate is Lumiverse’s to keep. So the text the agent reads opens at <player_character_safeguard>, about sixty lines down this box; an edit above that line is never sent. Every other section goes in as written here, with its date examples rewritten to the time format.'),
            prompt('routerAgentSharedContextTemplate', 'Shared context template', 'Multihog’s shared context, sent after the tools. Its {{…}} placeholders are filled on every pass — the eligible [CORE] fields, the pass restriction, the nudge, the campaign’s books, the module instructions, the Combat Profile guidance, the relationship section. The MEMORY LIMIT section is not sent, and the DUNGEON LOCATION OWNERSHIP section is swapped for the mapped-site note as Multihog swaps it.'),
            prompt('routerCombatProfileGuidanceAgentTemplate', 'Combat profile guidance (agent)', 'Sent while the memo holds a [COMBAT] or [PARTY] block, where the shared context asks for it.'),
            prompt('routerAutoPassRestrictionTemplate', 'Auto-pass restriction', 'Sent on the pass after a reply: a core edit may touch the Combat Profile and nothing else, and the writer refuses any other field.'),
            prompt('routerManualPassRestrictionTemplate', 'Manual-pass restriction', 'Sent on a pressed or an instructed pass; {{eligibleCoreFields}} is the identity fields the NPC sections name.'),
            prompt('routerExistingNpcNudgeTemplate', 'Existing-NPC nudge', 'Sent on every pass, where the shared context asks for it.'),
            prompt('routerRelSectionAgentTemplate', 'Relationship section (agent)', 'Sent while the relationship system is on, its {{max}} and {{p30}}-style placeholders expanded for the scale.'),
            managed('routerModules', 'Agent modules', 'What the Lorebook Agent is told about each category it records.', readRouterModules),
            managed('routerCustomTags', 'Custom tags', 'Your own categories for the Lorebook Agent.', readRouterCustomTags),
        ],
    },
    {
        id: 'mapArchitect',
        icon: '🗺️',
        category: 'maps',
        title: 'Map Architect',
        description: 'Hidden-site generation, occupancy, and off-screen evolution prompts. The map itself is Phase 2.',
        fields: [
            prompt('mapArchitectSystemPrompt', 'Map architect prompt'),
            prompt('mapUpdaterSystemPrompt', 'Map updater prompt'),
            prompt('mapEvolutionSystemPrompt', 'Map evolution prompt'),
            prompt('mapEvolutionCompressSystemPrompt', 'Map evolution compression prompt'),
        ],
    },
    {
        id: 'worldProgression',
        icon: '🖥️',
        category: 'world',
        title: 'World Progression',
        description: 'The report prompt used by the World Progression engine.',
        fields: [
            prompt('worldProgressionSystemPrompt', 'World progression prompt'),
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
