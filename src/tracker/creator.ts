/**
 * The character creator (roadmap row 10, Phase 35): the typed face over the
 * legacy's creator half.
 *
 * A player describes the character they want -- as much or as little as they
 * like -- and one prompt asks the tracker's model for the complete sheet:
 * every block the modules keep, at the level and gear tier asked for, in the
 * genre's idiom, with the legacy's rules for XP, time, gear and combat
 * scaling attached. The prompt is the legacy's own, out of the generated
 * `creator-legacy.js`; this file names the draft, the lists the form offers,
 * the name roll, and the check that the sheet actually arrived.
 */
import { createCreatorLegacy } from './creator-legacy.js'
import { ENTITY_FIELD_RULES } from './lines.js'
import { DEFAULT_NPC_SECTION_NAMES } from './npc-creator.js'

/**
 * What the prompt builders read from the host: set afresh by every call, so
 * nothing leaks between two. The Player Card's writer reads the settings and
 * the chat before its first await, so one instance serves every caller.
 */
let current: { settings: Record<string, unknown>; card: CreatorCard | null; chat: Array<{ is_user: boolean; name: string; mes: string }> } = { settings: {}, card: null, chat: [] }
/** The last prompt the Player Card's writer handed to its model call: captured, never sent from here. */
let captured: { system: string; user: string } | null = null

const plain = createCreatorLegacy({
    getSettings: () => current.settings,
    SillyTavern: { getContext: () => ({ characterId: current.card ? 0 : undefined, characters: current.card ? [current.card] : [], chat: current.chat }) },
    sendStateRequest: async (_connection, system, user) => { captured = { system, user }; return '' },
    getCharacterCreationConnectionSettings: () => null,
    toastr: { warning: () => undefined },
})

export type CreatorGenre = '' | 'fantasy' | 'realistic' | 'scifi' | 'horror'

/** The genres the form offers, in the legacy's words; `''` leaves it to the model. */
export const CREATOR_GENRES: ReadonlyArray<{ value: CreatorGenre; label: string }> = [
    { value: '', label: '✨ None — AI decides from context' },
    { value: 'fantasy', label: '⚔️ Fantasy RPG' },
    { value: 'realistic', label: '🏙️ Modern' },
    { value: 'scifi', label: '🚀 Sci-Fi' },
    { value: 'horror', label: '👻 Horror' },
]

export function normalizeGenre(value: unknown): CreatorGenre {
    const genre = String(value ?? '')
    return CREATOR_GENRES.some((g) => g.value === genre) ? (genre as CreatorGenre) : ''
}

export type GearTier = 'auto' | 'mundane' | 'low' | 'standard' | 'well_equipped' | 'heroic' | 'none'

/** The gear tiers, as the legacy lists them. */
export const GEAR_TIERS: ReadonlyArray<{ value: GearTier; label: string }> = plain.STARTING_GEAR_TIER_OPTIONS as Array<{ value: GearTier; label: string }>

export function normalizeGearTier(value: unknown): GearTier {
    const tier = String(value ?? '')
    return GEAR_TIERS.some((t) => t.value === tier) ? (tier as GearTier) : 'auto'
}

/** A level 1–20, or `'none'` for a system without numeric levels. */
export type CreatorLevel = number | 'none'

export function normalizeLevel(value: unknown): CreatorLevel {
    const resolved = plain.resolveOnboardingLevelPreference(value) as { stored: number | 'none' }
    return resolved.stored
}

/** The class the sheet is asked for: a name, `'__other__'` with the player's own words, or `'__story__'` for the model's choice. */
export const CLASS_OTHER = '__other__'
export const CLASS_STORY = '__story__'

/** The classes the form offers for a genre, with the two constants after them; a genre of `''` offers the constants alone. */
export function classOptions(genre: CreatorGenre): Array<{ value: string; label: string }> {
    const lists = plain._CR_CLASS_LISTS as unknown as Record<string, Array<[string, string]>>
    const constants = plain._CR_CLASS_CONSTANTS as unknown as Array<[string, string]>
    const list = genre ? (lists[genre] ?? lists.fantasy ?? []) : []
    return [...list, ...constants].map(([label, value]) => ({ value, label }))
}

/** The archetype names for a genre, without the two constants. */
export function archetypesForGenre(genre: string): string[] {
    return plain.getArchetypesForGenre(genre)
}

/** What the player filled in. Every field may be blank: the model invents what is missing. */
export interface CreatorDraft {
    name: string
    gender: string
    age: string
    orientation: string
    species: string
    ethnicity: string
    genre: CreatorGenre
    level: CreatorLevel
    gearTier: GearTier
    combatScalingGuide: boolean
    class: string
    classOther: string
    traits: string
    abilities: string
    background: string
    appearance: string
    additional: string
}

export interface CreatorDefaults {
    level: CreatorLevel
    gearTier: GearTier
    combatScalingGuide: boolean
    /** Instant Action (45d): roll the level 1 to 10 instead of starting at 1. */
    instantRandomLevel?: boolean
}

export function emptyDraft(defaults: CreatorDefaults): CreatorDraft {
    return {
        name: '', gender: '', age: '', orientation: '', species: '', ethnicity: '',
        genre: '', level: defaults.level, gearTier: defaults.gearTier, combatScalingGuide: defaults.combatScalingGuide,
        class: CLASS_STORY, classOther: '', traits: '', abilities: '', background: '', appearance: '', additional: '',
    }
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** A draft from storage or a preset, every field made safe; a class the genre does not offer falls back to the model's choice. */
export function normalizeDraft(raw: unknown, defaults: CreatorDefaults): CreatorDraft {
    const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const genre = normalizeGenre(source.genre)
    const wanted = text(source.class) || CLASS_STORY
    const offered = classOptions(genre).some((o) => o.value === wanted)
    return {
        name: text(source.name), gender: text(source.gender), age: text(source.age), orientation: text(source.orientation),
        species: text(source.species), ethnicity: text(source.ethnicity),
        genre,
        level: source.level === undefined ? defaults.level : normalizeLevel(source.level),
        gearTier: source.gearTier === undefined ? defaults.gearTier : normalizeGearTier(source.gearTier),
        combatScalingGuide: typeof source.combatScalingGuide === 'boolean' ? source.combatScalingGuide : defaults.combatScalingGuide,
        class: offered ? wanted : CLASS_STORY,
        classOther: text(source.classOther),
        traits: text(source.traits), abilities: text(source.abilities), background: text(source.background),
        appearance: text(source.appearance), additional: text(source.additional),
    }
}

/** The narrator's character card, as the legacy shows it to the model. */
export interface CreatorCard {
    name: string
    description: string
}

export interface SheetPromptContext {
    /** The cartridge settings the prompt reads: the modules and custom fields that are on, and the calendar format. */
    settings: { modules?: Record<string, boolean>; customFields?: unknown[]; useDdMmYyFormat?: boolean }
    /** The campaign's starting date, `Day 1` or `DD/MM/YYYY`, and time of day. */
    initialDate: string
    initialTime: string
    card?: CreatorCard | null
    /** Instant Action's one-time setup, which outranks the rolled defaults (35a). */
    instantActionInstructions?: string
}

export interface SheetPrompt {
    prompt: string
    /** The player's hints as a block, for the Player Card after the sheet (35b). */
    extraHints: string
    cardSnippet: string
}

/** The prompt that asks for the sheet: the legacy's `buildCharacterGenerationPrompt` over the draft. */
export function buildSheetPrompt(draft: CreatorDraft, context: SheetPromptContext): SheetPrompt {
    current = {
        settings: { ...context.settings, initialDate: context.initialDate, initialTime: context.initialTime },
        card: context.card ?? null,
        chat: [],
    }
    return plain.buildCharacterGenerationPrompt({
        nameVal: draft.name, genderVal: draft.gender, ageVal: draft.age, orientationVal: draft.orientation,
        speciesVal: draft.species, ethnicityVal: draft.ethnicity,
        genre: draft.genre,
        level: draft.level === 'none' ? null : draft.level,
        gearTier: draft.gearTier,
        useCombatScalingGuide: draft.combatScalingGuide,
        classRaw: draft.class, classOtherVal: draft.classOther,
        traitsVal: draft.traits, abilitiesVal: draft.abilities, backgroundVal: draft.background,
        appearanceVal: draft.appearance, additionalVal: draft.additional,
        ...(context.instantActionInstructions ? { instantActionInstructions: context.instantActionInstructions } : {}),
    }) as SheetPrompt
}

/** The blocks the sheet is asked for: the modules that are on and the enabled custom fields, never PARTY, QUESTS or COMBAT. */
export function activeBlocks(settings: SheetPromptContext['settings']): string[] {
    return plain.buildOnboardingActiveBlocks(settings)
}

/**
 * A name from the genre's pool, or from every pool when no genre is chosen.
 * The legacy's genre-less button adds eighty names of its own, written into
 * its panel; those are not carried.
 */
export function rollCreatorName(genre: CreatorGenre, random: () => number = Math.random): string {
    if (genre) return plain.pickGenreCharacterName(genre, random)
    const pools = plain.CHARACTER_CREATOR_NAME_ADDITIONS as { firstNames: readonly string[]; surnames: readonly string[] }
    const pick = (list: readonly string[]): string => list[Math.min(list.length - 1, Math.floor(random() * list.length))] ?? ''
    return `${pick(pools.firstNames)} ${pick(pools.surnames)}`
}

/** The character's name out of a memo's `[CHARACTER]` block, or `''`. */
export function extractCharacterName(memo: string): string {
    return plain.extractCharNameFromMemo(memo)
}

/** The legacy's sentence for a pass that wrote no sheet (`character-creator.js` at the pin; the pin test holds it). */
export const NO_SHEET_MESSAGE = 'Character generation failed — State Model returned no character sheet. Check your API connection.'

/**
 * Whether the pass wrote a sheet: the memo changed and carries `[CHARACTER]`.
 * The legacy's inline condition at the pin, with the pass's own reason kept in
 * the sentence — the legacy throws that reason first, from
 * `assertDirectPromptOwned`, when the pass itself failed; here the two are one
 * line, since the report under it shows the model's reply either way.
 */
export function checkSheet(memoBefore: string, memoAfter: string, outcome: { changed: boolean; message?: string }): { ok: true; name: string } | { ok: false; reason: string } {
    const unchanged = outcome.changed === false || !memoAfter || memoAfter === memoBefore
    if (unchanged || !/\[CHARACTER\]/i.test(memoAfter)) {
        const detail = outcome.message ? ` (${outcome.message})` : ''
        return { ok: false, reason: NO_SHEET_MESSAGE.replace('no character sheet.', `no character sheet${detail}.`) }
    }
    return { ok: true, name: extractCharacterName(memoAfter) }
}

/**
 * A second run on a chat that already has a sheet fails the legacy's check
 * the same way an empty reply does (35c-bis, live): the memo did not change.
 * The check stays the legacy's; this is the sentence the report adds.
 */
export function alreadyHadSheet(memoBefore: string): string {
    return /\[CHARACTER\][\s\S]*?\[\/CHARACTER\]/i.test(memoBefore)
        ? ' The chat already had a sheet before this run, and the pass changed nothing: the cards above still hold the earlier one.'
        : ''
}

// ── Instant Action (35a) ─────────────────────────────────────────────────

export type InstantGenre = 'fantasy' | 'realistic' | 'scifi' | 'horror'

/** The four genres Instant Action offers, in the legacy's words. */
export const INSTANT_GENRES: ReadonlyArray<{ value: InstantGenre; label: string }> = [
    { value: 'fantasy', label: '⚔️ Fantasy' },
    { value: 'realistic', label: '🏙️ Modern' },
    { value: 'scifi', label: '🚀 Sci-Fi' },
    { value: 'horror', label: '👻 Horror' },
]

/** A genre Instant Action knows, or fantasy, as the legacy falls back. */
export function normalizeInstantGenre(value: unknown): InstantGenre {
    const genre = String(value ?? '')
    return INSTANT_GENRES.some((g) => g.value === genre) ? (genre as InstantGenre) : 'fantasy'
}

/** One of the genre's twenty archetypes, at random; `Fighter` for a genre with none. */
export function randomArchetype(genre: string, random: () => number = Math.random): string {
    const list = archetypesForGenre(genre)
    if (!list.length) return 'Fighter'
    return list[Math.min(list.length - 1, Math.floor(random() * list.length))] ?? list[0]!
}

/** A starting level 1–10, as Instant Action rolls it. */
export function rollInstantLevel(random: () => number = Math.random): number {
    return plain.rollInstantActionLevel(random)
}

/**
 * Instant Action's starting level (45d, upstream 2026.8.73): 1, or a roll of
 * 1 to 10 with Random Level on, or none for a system without levels. The
 * setup may still name a level, which outranks this in the prompt.
 */
export function resolveInstantLevel(opts: { noLevel?: boolean; randomLevel?: boolean; random?: () => number } = {}): number | null {
    return plain.resolveInstantActionStartingLevel(opts) as number | null
}

/** The setup text, trimmed and cut to the legacy's thousand characters. */
export function normalizeInstantSetup(value: unknown): string {
    return plain.normalizeInstantActionInstructions(value)
}

export const INSTANT_SETUP_MAX: number = plain.MAX_INSTANT_ACTION_INSTRUCTION_LENGTH

/** The level the setup names, 1–20, or `null`. */
export function instantSetupLevel(setup: string): number | null {
    return plain.extractInstantActionLevel(setup)
}

/** The setup as a prompt section, for the sheet and the card alike; '' without a setup. */
export function instantPromptSection(setup: string): string {
    return plain.buildInstantActionPromptSection(setup)
}

/** The user message that opens the adventure, carrying the setup if any. */
export function instantOpeningMessage(setup: string): string {
    return plain.buildInstantActionOpeningMessage(setup)
}

// ── the Player Card (35b) ────────────────────────────────────────────────

/** A line of the recent story as the card's writer reads it: the player's own, or a named speaker's. */
export interface CardStoryLine {
    user: boolean
    name: string
    text: string
}

export interface CardPromptContext {
    /** The memo the sheet is in. */
    memo: string
    /** The cartridge settings: `pcCoreSections` names the sections; `directPromptContext` the story window. */
    settings: Record<string, unknown>
    /** The recent story, oldest first; the writer keeps the last N non-empty lines. */
    story: readonly CardStoryLine[]
    extraHints?: string
    /** Put the `[CHARACTER]` block first in the card the writer reads, as the persona-derived ways do. */
    preferCharacterBlock?: boolean
}

/** The word counts the legacy's select offers. */
export const CARD_WORD_OPTIONS: readonly number[] = [100, 150, 200, 300, 400, 500, 750, 1000]
export const CARD_WORDS_DEFAULT = 150
export const CARD_WORDS_MIN = 50
export const CARD_WORDS_MAX = 5000

/** A word count the writer may be asked for: an integer between the legacy's custom bounds, or the default. */
export function normalizeCardWords(value: unknown): number {
    const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10)
    if (!Number.isFinite(n)) return CARD_WORDS_DEFAULT
    return Math.min(CARD_WORDS_MAX, Math.max(CARD_WORDS_MIN, Math.round(n)))
}

/**
 * The Player Card's prompt, as the legacy's `generatePersonaBio` builds it:
 * the section template out of the settings (or the stock eight), the memo
 * cleaned of its tags, the last N story lines, the word count said twice.
 * The legacy's function makes the call itself; here it is run up to the
 * call and the prompt taken from it, so the text is the pin's.
 */
export function buildCardPrompt(name: string, words: number, context: CardPromptContext): { system: string; user: string } {
    current = { settings: { ...context.settings, currentMemo: context.memo }, card: null, chat: context.story.map((line) => ({ is_user: line.user, name: line.name, mes: line.text })) }
    captured = null
    void plain.generatePersonaBio(name, words, context.extraHints ?? '', { preferCharacterBlock: !!context.preferCharacterBlock })
    const prompt = captured as { system: string; user: string } | null
    if (!prompt) throw new Error('the Player Card prompt was not built')
    return prompt
}

/** The card's name as the legacy stores it: quotes and backslashes out, or `My Character`. */
export function cardName(name: unknown): string {
    return (plain.buildNameOnlyPersonaIdentity(name) as { name: string }).name
}

/** The block the narrator sees, as the legacy injects it. */
export function cardBlock(name: string, bio: string): string {
    return `[PLAYER_CHARACTER]\nName: ${name}\n${bio}\n[/PLAYER_CHARACTER]`
}

export interface CardSection {
    label: string
    text: string
}

/** The card read as `Label:` sections, for the panel. Text before the first label is an unlabelled section. */
export function parseCardSections(bio: string): CardSection[] {
    const out: CardSection[] = []
    let open: CardSection | null = null
    for (const raw of String(bio ?? '').split('\n')) {
        const line = raw.replace(/\r$/, '')
        // `Label:`, `**Label**:` or `**Label:**` — the model bolds a header either way.
        const header = line.match(/^\s*\**\s*([A-Z][A-Za-z0-9 \/&]{1,40}?)\s*\**\s*:\**\s*(.*)$/)
        if (header) {
            open = { label: header[1]!.trim(), text: header[2]!.trim() }
            out.push(open)
            continue
        }
        if (!line.trim()) continue
        if (!open) {
            open = { label: '', text: line.trim() }
            out.push(open)
            continue
        }
        open.text = open.text ? `${open.text}\n${line.trim()}` : line.trim()
    }
    return out
}

/** Whether a commit's target names the player character rather than an entry: `{{user}}`, `player`, `pc`, `user`, or the card's name. */
export function isCardTarget(id: unknown, name: string): boolean {
    return !!plain.isPcCoreTarget(id as never, name)
}

/** Which of the card's two mutable fields a commit's field names: Body, Worn Equipment, or neither. */
export function cardFieldOf(field: string): 'Body' | 'Worn Equipment' | null {
    if (plain.isAppearanceField(field)) return 'Body'
    if (plain.isEquipmentField(field)) return 'Worn Equipment'
    return null
}

/**
 * Patch one section of the card, as the legacy's agent may: Body and Worn
 * Equipment only; the rest are the player's own. The patcher appends the
 * section when the card has none.
 */
export function patchCard(bio: string, field: string, content: string): { ok: true; bio: string } | { ok: false; reason: string } {
    const target = cardFieldOf(field)
    if (!target) return { ok: false, reason: 'PC updates are limited to Body and Worn Equipment' }
    const result = plain.patchLabeledSection(bio, target, content, { isPc: true }) as { ok: boolean; text?: string; error?: string }
    return result.ok && typeof result.text === 'string' ? { ok: true, bio: result.text } : { ok: false, reason: result.error ?? 'the section could not be patched' }
}

/** The labels of a stat block's own lines (Phase 40's table, with the pips' two), which are never a `[CORE]` header. */
const STAT_BLOCK_LABELS: ReadonlySet<string> = new Set([...ENTITY_FIELD_RULES.map(([label]) => label), 'hd', 'spells'])

const MASK = '\u0001'

/**
 * Patch one labelled section of an NPC's `[CORE]` body with the legacy's
 * patcher (45b-bis): the value runs to the next header, so a multi-line
 * Combat Profile is replaced whole rather than its first line only, and a
 * field the block lacks is appended. `extraHeaders` are the campaign's NPC
 * section names, so a custom section bounds a value too.
 *
 * One reading differs from the legacy's. Its patcher takes *every*
 * `Label:` line of the body for a header, and a Combat Profile is a stat
 * block whose lines are `Label:` lines (`Att/def:`, `Saves:`, `Status:` in
 * its own example) — so it replaced the profile's first line and left the
 * rest of the old block under the new one, which is what the maintainer
 * saw after a companion's level-up (lesson 49). Here a stat block's own labels,
 * and any label the new value carries as a line, are masked while the
 * legacy patches, so they bound nothing; a header the campaign names, or a
 * standard one, is never masked.
 */
export function patchCoreSection(body: string, field: string, content: string, extraHeaders: readonly string[] = []): { ok: true; body: string } | { ok: false; reason: string } {
    const keep = new Set([...DEFAULT_NPC_SECTION_NAMES, ...extraHeaders, ...(plain.resolveCoreFieldPatterns(field, {}) as string[])].map((h) => String(h).trim().toLowerCase()))
    const masked = new Set<string>()
    for (const label of STAT_BLOCK_LABELS) if (!keep.has(label)) masked.add(label)
    for (const line of String(content).split('\n')) {
        const label = labelOf(line)
        if (label && !keep.has(label)) masked.add(label)
    }
    const canMask = !body.includes(MASK)
    const maskedBody = canMask
        ? body.split('\n').map((line) => {
            const label = labelOf(line)
            return label && masked.has(label) ? line.replace(':', MASK) : line
        }).join('\n')
        : body
    const result = plain.patchLabeledSection(maskedBody, field, content, { extraHeaders: [...extraHeaders] }) as { ok: boolean; text?: string; error?: string }
    if (!result.ok || typeof result.text !== 'string') return { ok: false, reason: result.error ?? 'the section could not be patched' }
    return { ok: true, body: canMask ? result.text.split(MASK).join(':') : result.text }
}

/** The label of a `Label: value` line as the legacy's patcher scans for one, lower-cased; `null` for any other line. */
function labelOf(line: string): string | null {
    const match = line.trim().match(/^([A-Z][A-Za-z0-9 /&]+?)\s*:/)
    return match ? match[1].trim().toLowerCase() : null
}

// ── the other ways to begin (35c) ────────────────────────────────────────

export type BeginWay = 'persona' | 'custom'

/**
 * The legacy's *Other Ways to Begin* prompts, as `card-events.js` builds
 * them inside its click handler: from the active persona, or from custom
 * instructions alone. The handler is a closure over the panel and cannot be
 * sliced, so its template text is transcribed here in the static pieces
 * between the interpolations, and `creator.pin.test.ts` holds every piece
 * to the legacy source verbatim. Keep the pieces whole: a piece that is
 * reworded stops being found in the source and the pin fails.
 */
export const WAYS_TEXT = {
    levelNone: 'LEVEL SYSTEM: This character creation system does not use numeric character levels. Do NOT invent, assign, or output a level number, an [XP] block, or any D&D-style level indicator — balance the character using the setting\'s own internal logic instead.',
    levelXpA: 'STARTING LEVEL: ',
    levelXpB: ' (mandatory — the character MUST be exactly Level ',
    levelXpC: ').',
    levelNoXpC: '; scale/adjust HP, stats, saves, capabilities, and gear (everything a character of that level might have) to Level ',
    levelNoXpD: ' accordingly, but do NOT output an [XP] block as it is disabled).',
    nameA: ' The character\'s name MUST be "',
    nameB: '" exactly.',
    formatA: '\n\nCRITICAL TAG WRAPPING RULE: Every block you output MUST be enclosed in matching opening and closing tags. You must output the closing tag for every block (',
    formatB: ').\nCRITICAL PARTY RULE: Do NOT output a [PARTY] block under any circumstances unless explicitly instructed.\nCRITICAL QUESTS RULE: Do NOT add quests or output a [QUESTS] block under any circumstances unless explicitly instructed.\nCRITICAL FORMAT RULE: Follow the exact [CHARACTER]',
    formatInventory: '/[INVENTORY]',
    formatAbilities: '/[ABILITIES]',
    formatC: ' field format, structure, and terminology defined in the module instructions provided in this system prompt — do not invent, omit, rename, or substitute fields, and do not fall back to a generic D&D template if the defined format differs from one.',
    customNoneA: ' Generate a character based entirely on these custom instructions: "',
    customLevelA: ' Generate a random Level ',
    customLevelB: ' character based entirely on these custom instructions: "',
    customB: '".',
    customOutput: ' Output ',
    customSpells: " (and [SPELLS] if appropriate for the class, using 'Cantrips:' for level 0 spells)",
    customBlocks: ' blocks',
    customNoneC: '. Adapt all attributes, skills, saves, descriptions, and gear to match the setting and instructions perfectly — do not invent a numeric level.',
    customLevelC: '. Adapt all attributes, skills, saves, descriptions, and gear to match the setting and instructions perfectly.',
    customRealism: '\n\nCRITICAL REALISM RULE: This is a realistic/non-fantasy setting. Do NOT output a [SPELLS] block. Use realistic modern/historical currencies instead of GP/SP/CP. Firearms on new gear/NPCs/loot: damage ~2–3× D&D/PF norms by common sense; attack bonuses unchanged (not mid-scene conversion).',
    personaNoneA: ' Using the following persona description as the basis for the player character, create a character that faithfully embodies this persona.',
    personaLevelA: ' Using the following persona description as the basis for the player character, create a Level ',
    personaLevelB: ' character that faithfully embodies this persona.',
    personaNameA: ' The character\'s name MUST be "',
    personaNameB: '" (the active persona name).',
    personaC: ' Translate the personality, background, and traits into appropriate stats, class, race, and equipment. Output ',
    personaSpells: " (and [SPELLS] if the class is a spellcaster, using 'Cantrips:' for level 0 spells)",
    personaNoneD: '. Do not invent a numeric level — balance using the setting\'s own logic.',
    personaLevelD: '. All attributes and gear should be consistent with Level ',
    personaE: '\n\nPersona',
    personaF: ':\n',
    constraintsA: '\n\nAdditional setting/instruction constraints: ',
    constraintsB: '. Adapt the name, attributes, description, gear, and spells (if any) to match this setting/instruction perfectly.',
    hintsA: '\n\n--- PLAYER PREFERENCES & HINTS ---\n',
    hintsSource: 'Source: the previously active SillyTavern persona.',
    hintsAdditional: 'Additional: ',
} as const

export interface WaysPromptContext {
    level: number | 'none'
    genre: string
    gearTier: string
    combatScalingGuide: boolean
    /** The cartridge settings: the modules, and the calendar format. */
    settings: Record<string, unknown>
    initialDate: string
    initialTime: string
    /** Custom: the name the sheet must carry; Persona: the persona's name. */
    name: string
    /** The custom instructions; required for Custom, an addendum for Persona. */
    instructions: string
    /** The active persona, for the persona way. */
    persona?: { name: string; description: string }
}

/** The prompt the legacy sends for one of the other ways, and the hints it hands the Player Card's writer. */
export function buildWaysPrompt(way: BeginWay, context: WaysPromptContext): { prompt: string; cardHints: string } {
    const T = WAYS_TEXT
    const mods = (context.settings.modules ?? {}) as Record<string, boolean>
    const hasXp = !!mods.xp
    const hasTime = !!mods.time
    const hasInventory = !!mods.inventory
    const hasAbilities = !!mods.abilities
    const hasSpells = !!mods.spells
    const noLevel = context.level === 'none'
    const level = noLevel ? 1 : Number(context.level) || 1
    const isCalendar = !!context.settings.useDdMmYyFormat
    const startDate = isCalendar ? (context.initialDate && context.initialDate !== 'Day 1' ? context.initialDate : '01/01/2026') : 'Day 1'
    const instructions = context.instructions.trim()

    const levelPrefix = noLevel
        ? T.levelNone
        : hasXp
            ? `${T.levelXpA}${level}${T.levelXpB}${level}${T.levelXpC}`
            : `${T.levelXpA}${level}${T.levelXpB}${level}${T.levelNoXpC}${level}${T.levelNoXpD}`
    const xpHint = hasXp && !noLevel ? String(plain.buildOnboardingXpHint(level)) : ''
    const timeHint = hasTime ? String(plain.buildOnboardingTimeHint(startDate, context.initialTime || '08:00 AM')) : ''
    const gearHint = String(plain.buildStartingGearHint(level, context.genre || 'fantasy', hasInventory, context.gearTier || 'auto'))
    const combatHint = context.combatScalingGuide ? String(plain.buildCombatAndSkillScalingHint()) : ''
    const blocks = plain.buildOnboardingActiveBlocks(context.settings) as string[]
    const blockList = blocks.join(', ')
    const closingTags = blocks.map((b) => `[/${b}]`).join(', ')
    const formatHint = `${T.formatA}${closingTags}${T.formatB}${hasInventory ? T.formatInventory : ''}${hasAbilities ? T.formatAbilities : ''}${T.formatC}`
    const tail = `${formatHint}${xpHint}${timeHint}${gearHint}`

    if (way === 'custom') {
        const nameInstruction = `${T.nameA}${context.name}${T.nameB}`
        let prompt = noLevel
            ? `${levelPrefix}${T.customNoneA}${instructions}${T.customB}${nameInstruction}${T.customOutput}${blockList}${T.customBlocks}${hasSpells ? T.customSpells : ''}${T.customNoneC}${tail}`
            : `${levelPrefix}${T.customLevelA}${level}${T.customLevelB}${instructions}${T.customB}${nameInstruction}${T.customOutput}${blockList}${T.customBlocks}${hasSpells ? T.customSpells : ''}${T.customLevelC}${tail}`
        if (isCalendar) prompt += T.customRealism
        return { prompt: prompt + combatHint, cardHints: `${T.hintsA}${T.hintsAdditional}${instructions}\n` }
    }

    const persona = context.persona ?? { name: context.name, description: '' }
    const nameClause = persona.name ? `${T.personaNameA}${persona.name}${T.personaNameB}` : ''
    const heading = `${T.personaE}${persona.name ? ` — ${persona.name}` : ''}${T.personaF}${persona.description}`
    let prompt = noLevel
        ? `${levelPrefix}${T.personaNoneA}${nameClause}${T.personaC}${blockList}${T.customBlocks}${hasSpells ? T.personaSpells : ''}${T.personaNoneD}${tail}${heading}`
        : `${levelPrefix}${T.personaLevelA}${level}${T.personaLevelB}${nameClause}${T.personaC}${blockList}${T.customBlocks}${hasSpells ? T.personaSpells : ''}${T.personaLevelD}${level}.${tail}${heading}`
    if (instructions) prompt += `${T.constraintsA}${instructions}${T.constraintsB}`
    return { prompt: prompt + combatHint, cardHints: `${T.hintsA}${T.hintsSource}${instructions ? `\n${T.hintsAdditional}${instructions}` : ''}\n` }
}

// ── Import Card (39) ─────────────────────────────────────────────────────

export type ImportMode = 'minimal' | 'full'

export function normalizeImportMode(value: unknown): ImportMode {
    return value === 'minimal' ? 'minimal' : 'full'
}

/** The lengths the legacy's import panel offers for the Player Card: the card's own, or a count. */
export const IMPORT_WORD_OPTIONS: ReadonlyArray<{ value: 'same' | number; label: string }> = [
    { value: 'same', label: 'Same as the card' },
    { value: 150, label: 'Short (~150 words)' },
    { value: 300, label: 'Medium (~300 words)' },
    { value: 500, label: 'Long (~500 words)' },
]

/** A Player Card length for an import: `same`, or a word count within the legacy's bounds. */
export function normalizeImportWords(value: unknown): 'same' | number {
    return value === 'same' || value === undefined || value === null || value === '' ? 'same' : normalizeCardWords(value)
}

/**
 * The static text of the legacy's two import prompts (`importPcFromCard` in
 * `character-creator.js`): the handler reads the panel and cannot be sliced,
 * so its template text is transcribed in the pieces between the
 * interpolations, and `creator.pin.test.ts` holds every piece to the source
 * verbatim, as `WAYS_TEXT` is held. Keep the pieces whole.
 */
export const IMPORT_TEXT = {
    minimalA: 'You are a state tracker assistant. Translate this character card into state tracker format for the player character.\n\nRULES:\n- Preserve ALL values, stats, abilities, and inventory EXACTLY as written in the card.\n- Only adjust specific terminology that would be a hard logical impossibility in the current setting (e.g. "smartphone" in a medieval world).\n- Output every currently active state-memo field (enabled stock modules and custom fields): ',
    minimalB: '.\n- Do NOT invent stats or equipment not present on the card.\n- Do NOT add quests or output a [QUESTS] block under any circumstances unless explicitly instructed.\n- Use the existing system prompt\'s block format.\n\n',
    fullA: 'You are a state tracker assistant. Adapt this character card to the current campaign setting and translate it into state tracker format for the player character.\n\nRULES:\n- Fit the character\'s class, gear, backstory, and abilities naturally into the current world.\n- Rename anachronistic equipment or references to setting-appropriate equivalents.\n- Output every currently active state-memo field (enabled stock modules and custom fields): ',
    fullB: '.\n- Do NOT add quests or output a [QUESTS] block under any circumstances unless explicitly instructed.\n- Use the existing system prompt\'s block format.\n- CRITICAL: Never output template macro strings such as {{char}}, {{user}}, or any other {{...}} placeholders. Always replace them with the actual character\'s name or a fitting proper name.\n',
    cardA: 'CHARACTER CARD:\nName: ',
    cardB: '\nDescription: ',
    cardC: '\nPersonality: ',
    state: 'CURRENT GAME STATE:\n',
    chat: 'RECENT CHAT:\n',
    narrator: 'NARRATOR/WORLD CARD:\n',
    joiner: '\n\n---\n\n',
} as const

export interface ImportCard {
    name: string
    description: string
    personality: string
}

export interface ImportPromptContext {
    /** The cartridge settings: the modules and the custom fields, for the block list and the inventory. */
    settings: Record<string, unknown>
    /** The level the gear hint is scaled to: the creator's preference, or 1 for a system without levels. */
    level: number
    genre: string
    gearTier: string
    card: ImportCard
    /** The memo as it stands, or `''`. */
    memo: string
    /** The recent story, oldest first; the last eight non-empty lines are sent, cut at 3,000 characters. */
    recent: readonly CardStoryLine[]
    /** The narrator's card description, or `''`. */
    narrator: string
}

/** The legacy's world context: the card, the memo, the recent chat and the narrator's card, joined by rules. */
function importWorldContext(context: ImportPromptContext): string {
    const T = IMPORT_TEXT
    const lines: string[] = []
    lines.push(`${T.cardA}${context.card.name || 'Unnamed'}${T.cardB}${context.card.description || ''}${T.cardC}${context.card.personality || ''}`)
    if (context.memo) lines.push(`${T.state}${context.memo}`)
    const recent = context.recent.filter((line) => line.text.trim()).slice(-8)
    if (recent.length) lines.push(`${T.chat}${recent.map((line) => `${line.name || (line.user ? 'User' : 'Character')}: ${line.text}`).join('\n\n').substring(0, 3000)}`)
    if (context.narrator) lines.push(`${T.narrator}${context.narrator}`)
    return lines.join(T.joiner)
}

/** The tracker's instruction for an imported card, as the legacy's `importPcFromCard` builds it for each mode. */
export function buildImportPrompt(mode: ImportMode, context: ImportPromptContext): string {
    const T = IMPORT_TEXT
    const blockList = (plain.buildOnboardingActiveBlocks(context.settings) as string[]).join(', ')
    const worldCtx = importWorldContext(context)
    if (mode === 'minimal') return `${T.minimalA}${blockList}${T.minimalB}${worldCtx}`
    const mods = (context.settings.modules ?? {}) as Record<string, boolean>
    const gearHint = String(plain.buildStartingGearHint(context.level, context.genre || 'fantasy', !!mods.inventory, context.gearTier || 'auto'))
    // The scaling guide is always in the full prompt, whatever the creator's switch says: the legacy does not read it here.
    const combatHint = String(plain.buildCombatAndSkillScalingHint())
    return `${T.fullA}${blockList}${T.fullB}${gearHint}\n${combatHint}\n\n${worldCtx}`
}

/**
 * The Player Card's prompt for an imported card, as the legacy's
 * `generatePcImportBio` builds it: the card's text with `{{char}}` resolved,
 * a transcription in the minimal mode or the sections in the full one, the
 * narrator's card as a reference not to copy. Run up to the call, as
 * `buildCardPrompt` is.
 */
export function buildImportBio(card: ImportCard, mode: ImportMode, words: 'same' | number, context: { settings: Record<string, unknown>; narrator: string }): { system: string; user: string } {
    current = { settings: { ...context.settings }, card: context.narrator ? { name: '', description: context.narrator } : null, chat: [] }
    captured = null
    void plain.generatePcImportBio(card, mode, words === 'same' ? 'same' : String(words))
    const prompt = captured as { system: string; user: string } | null
    if (!prompt) throw new Error('the Player Card prompt was not built')
    return prompt
}

// ── presets ──────────────────────────────────────────────────────────────

export interface CreatorPreset {
    id: string
    name: string
    data: CreatorDraft
}

/** A preset by name, case and surrounding space ignored; `null` for none. */
export function findPreset(presets: readonly CreatorPreset[], name: string): CreatorPreset | null {
    return plain.findCharacterCreatorPresetByName([...presets], name) as CreatorPreset | null
}

/** The list with the preset saved: a new one appended, a same-named one replaced under its own id. */
export function upsertPreset(presets: readonly CreatorPreset[], name: string, data: CreatorDraft, createId: () => string): { presets: CreatorPreset[]; preset: CreatorPreset; overwritten: boolean } {
    return plain.upsertCharacterCreatorPreset([...presets], name, data, createId) as { presets: CreatorPreset[]; preset: CreatorPreset; overwritten: boolean }
}

// ── the rest of the legacy half, for the later stages ────────────────────

export const XP_LEVEL_THRESHOLDS: readonly number[] = plain.XP_LEVEL_THRESHOLDS

/** One `[CORE]` or Player Card section as the legacy keeps it (77): the name the agent writes under, the instruction telling it what the section holds, the icon and colour the cards draw, and *hidden until set* for the Combat Profile. */
export interface CoreSection { id: string; name: string; description: string; icon: string; color: string; hiddenUntilSet?: boolean }

/** The NPC `[CORE]` sections the legacy ships (77): the stock when a cartridge's `npcCoreSections` is empty, and the editor's reset. */
export const DEFAULT_NPC_SECTIONS: ReadonlyArray<CoreSection> = plain.DEFAULT_NPC_SECTIONS

/** The Player Card's section template (35b). */
export const DEFAULT_PC_SECTIONS: ReadonlyArray<CoreSection> = plain.DEFAULT_PC_SECTIONS
