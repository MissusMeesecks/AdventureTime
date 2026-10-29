/**
 * What the Lorebook Agent is told, where the words are the legacy's (Phase
 * 45b, extended by 72c).
 *
 * The agent's prompt is assembled around the cartridge's two templates
 * (`agent-pass.ts`), and what fills them must say what the legacy says: the
 * per-category **module instructions** (`routerModules`, the cartridge's —
 * the NPC one carries the `[CORE]` format and the complete-profile rule of
 * upstream 2026.9.25, which a stored instruction is refreshed to the way
 * upstream refreshes it), the memo's **`[COMBAT]` and `[PARTY]` blocks** as
 * the canonical source of an NPC's Combat Profile (2026.8.76: a companion's
 * profile is patched from the party sheet after a level-up, never invented
 * from it), the **Combat Profile guidance** that goes with them, and since
 * 72c the other three **runtime fragments** — the automatic pass's and the
 * direct pass's `[CORE]` restriction, the existing-NPC nudge — with the
 * **eligible-field rule** that decides which identity fields a pass may
 * touch, the **timestamp adjuster** that rewrites a template's examples to
 * the cartridge's clock and calendar, the **enabled-category list**, the
 * strip of the static map guidance, the **mapped-site note** and the
 * **current-location section**. The legacy code is `router-legacy.js`; this
 * is its typed face. What is AdventureTime's own here — the activation sections
 * taken out of a template — says so.
 */

import { createRouterLegacy } from '../tracker/router-legacy.js'
import { campaignBookName, isWorldModuleTag } from './campaign.js'

export { isWorldModuleTag }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const plain = createRouterLegacy() as unknown as Record<string, any>

export interface AgentModuleSetting {
    enabled?: boolean
    tag?: string
    instruction?: string
}

export interface AgentModuleSettings {
    routerModules?: Record<string, AgentModuleSetting>
    routerCustomTags?: Array<{ tag?: string; instruction?: string }>
    routerCombatProfileGuidanceAgentTemplate?: string
    routerCombatProfileGuidanceBasicTemplate?: string
    /** The agent's two prompt templates and the three other fragments (72c), the cartridge's. */
    routerSystemPromptTemplate?: string
    routerAgentSharedContextTemplate?: string
    routerAutoPassRestrictionTemplate?: string
    routerManualPassRestrictionTemplate?: string
    routerExistingNpcNudgeTemplate?: string
    routerRelSectionAgentTemplate?: string
    /** The NPC `[CORE]` sections, whose names are the eligible fields. */
    npcCoreSections?: unknown
    /** The clock and the calendar, which the templates' examples follow. */
    use24hTime?: boolean
    useDdMmYyFormat?: boolean
}

/** The legacy's shipped NPC-creation paragraph, refreshed in a stored instruction; any other text is left alone. */
export function upgradeNpcInstruction(instruction: string): string {
    return plain.upgradeNpcCreationGuidance(instruction) as string
}

/** The legacy's line for a module in its prompt: `- TAG: instruction`. Held to `router.js` by the pin test. */
export const MODULE_LINE_FRAME = '.map(m => `- ${m.tag}: ${m.instruction}`)'

/**
 * The legacy's module lines: one per enabled module, the NPC instruction
 * refreshed, then the custom tags under their own heading when there are any.
 */
export function agentModuleLines(settings: AgentModuleSettings): string[] {
    const lines: string[] = []
    for (const [key, module] of Object.entries(settings.routerModules ?? {})) {
        if (!module || module.enabled === false) continue
        const tag = String(module.tag ?? key).trim()
        const instruction = String(module.instruction ?? '').trim()
        if (!tag || !instruction) continue
        // The stock WORLD module (55-quater): in the legacy, switched on, the
        // agent writes a period report into the World book itself. Here World
        // Progression's own pass writes that book, and the writer refuses the
        // agent (33), so a category the agent is told and then refused on
        // every pass is a wasted turn: it is not told.
        if (isWorldModuleTag(tag)) continue
        lines.push(`- ${tag}: ${key === 'npc' ? upgradeNpcInstruction(instruction) : instruction}`)
    }
    const custom = (settings.routerCustomTags ?? []).filter((m) => m && String(m.tag ?? '').trim() && String(m.instruction ?? '').trim())
    if (custom.length) {
        lines.push('', '### CUSTOM CATEGORIES', ...custom.map((m) => `- ${String(m.tag).trim().toUpperCase()}: ${String(m.instruction).trim()}`))
    }
    return lines
}

/** The legacy's headings for the two mechanical blocks, held to `router.js` by the pin test. */
export const MECHANICAL_TEXT = {
    combat: '## ACTIVE COMBAT STATE (canonical mechanical stats — use this as the source for NPC Combat Profiles, not the GM prose)',
    party: '## PARTY MECHANICAL STATE (canonical companion combat stats — patch existing NPC Combat Profiles after level-up / lasting progression; do not invent new Combat Profiles from this block)',
} as const

export interface MechanicalState {
    /** The memo's `[COMBAT]` block, whole, or `null`. */
    combat: string | null
    /** The memo's `[PARTY]` block, whole, or `null`. */
    party: string | null
    /** The Combat Profile guidance when either block is present, else `''`. The cartridge's template, or the legacy's stock. */
    guidance: string
}

/** What the memo holds for the agent's Combat Profiles, and the guidance that goes with it. */
export function mechanicalState(memo: string | null | undefined, settings: AgentModuleSettings): MechanicalState {
    const combat = (plain.extractActiveCombatBlock(memo ?? '') as string | null) ?? null
    const party = (plain.extractPartyBlock(memo ?? '') as string | null) ?? null
    const guidance = String(plain.resolveCombatProfileGuidance(settings, !!(combat || party), 'agent') ?? '').trim()
    return { combat, party, guidance }
}

/** The two sections as the legacy puts them before the narrative: heading, block, a blank line; `''` with neither. */
export function formatMechanicalSections(state: MechanicalState): string {
    return (state.combat ? `${MECHANICAL_TEXT.combat}\n${state.combat}\n\n` : '')
        + (state.party ? `${MECHANICAL_TEXT.party}\n${state.party}\n\n` : '')
}

/**
 * The NPC word targets written into the module's instruction (72b): the
 * legacy's `buildNpcInstruction(majorWords, minorWords)` puts the two numbers
 * into its `<CORE LENGTH TARGETS>` sentences, and rewrites the instruction
 * whenever the targets change. The shipped text is the pin's, so the same two
 * sentences are rewritten here, and an instruction that no longer carries
 * them (edited past recognition) is returned as it is: the targets then have
 * nothing to be written into, which the panel says.
 */
export function applyNpcWordTargets(instruction: string, majorWords: number, minorWords: number): { instruction: string; applied: boolean } {
    const major = /(Major NPCs \([^)]*\): the \[CORE\] block's sections must together total exactly )(\d+)( words)/
    const minor = /(Minor NPCs \([^)]*\): the \[CORE\] block's sections must together total exactly )(\d+)( words)/
    if (!major.test(instruction) || !minor.test(instruction)) return { instruction, applied: false }
    const next = instruction
        .replace(major, `$1${Math.max(1, Math.floor(majorWords))}$3`)
        .replace(minor, `$1${Math.max(1, Math.floor(minorWords))}$3`)
    return { instruction: next, applied: true }
}

/** The legacy's three built module instructions (77). */
export interface StockModuleInstructions { npc: string; loc: string; fac: string }

/** The NPC word targets the builders take (72b: preferences here, cartridge keys in the legacy). */
export interface NpcWordTargets { major: number; minor: number }

/**
 * The legacy's NPC, LOC and FAC instructions built from a cartridge (77):
 * `buildNpcInstruction`, `buildLocInstruction` and `buildFacInstruction` as
 * `rebuildAllModuleInstructions` calls them — the `[CORE]` template and the
 * section names from `npcCoreSections` (the stock sections when it is
 * empty), the date examples from `useDdMmYyFormat`, the word targets from
 * their preferences — with the relationship bars read as off: the legacy's
 * NPC instruction carries the relationship section when the bars are on,
 * and AdventureTime sends that section once, through the shared context (72c).
 * With a factory cartridge and the shipped targets the three are the
 * factory's own texts, byte for byte, which is what makes the rebuild rule
 * below safe.
 */
export function stockModuleInstructions(settings: Record<string, unknown>, words: NpcWordTargets): StockModuleInstructions {
    const read = { ...settings, npcRelationshipBars: false }
    return {
        npc: String(plain.buildNpcInstruction(words.major, words.minor, false, read)),
        loc: String(plain.buildLocInstruction(read)),
        fac: String(plain.buildFacInstruction(read)),
    }
}

/** A stored agent module as the rebuild reads it: the instruction and whatever else the row keeps. */
export type StoredAgentModule = { instruction?: unknown } & Record<string, unknown>

/**
 * Multihog's rebuild of the stored instructions after the sections change
 * (`rebuildAllModuleInstructions`, which the legacy's section editor calls
 * on Save), held to AdventureTime's rule for a stored text (72b): an instruction
 * that still reads as the stock built from the settings *before* — the date
 * format as stored or as shipped, since that switch never rebuilt here — is
 * rebuilt from the settings *after*; one edited past that is kept and named,
 * so an edit is never written over. A text already right is left alone and
 * named in neither list.
 */
export function rebuildModuleInstructions(
    modules: Record<string, StoredAgentModule>,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    words: NpcWordTargets,
): { routerModules: Record<string, StoredAgentModule>; rebuilt: string[]; kept: string[] } {
    const stockAfter = stockModuleInstructions(after, words)
    const stockBefore = [stockModuleInstructions(before, words), stockModuleInstructions({ ...before, useDdMmYyFormat: false }, words)]
    const routerModules: Record<string, StoredAgentModule> = { ...modules }
    const rebuilt: string[] = []
    const kept: string[] = []
    for (const key of ['npc', 'loc', 'fac'] as const) {
        const module = modules[key]
        if (!module || typeof module.instruction !== 'string') continue
        const stored = module.instruction
        if (stored === stockAfter[key]) continue
        if (stockBefore.some((stock) => stock[key] === stored)) {
            routerModules[key] = { ...module, instruction: stockAfter[key] }
            rebuilt.push(key)
        } else {
            kept.push(key)
        }
    }
    return { routerModules, rebuilt, kept }
}

// ── The prompt's legacy pieces (72c) ──────────────────────────────────────

/**
 * The legacy's eligible-field rule: which `[CORE]` fields a `core` edit may
 * touch this pass, from the NPC sections' names (`npcSectionNames`, which
 * falls back to the legacy's defaults as the legacy does). Body and Worn Equipment never (they have `appearance` and
 * `equipment`); an automatic pass only the Combat Profile; a pressed or an
 * instructed pass — the legacy's `isManual`, true for every pass but the one
 * after a reply — every other identity field the NPC sections name.
 */
export function eligibleCoreFields(sectionNames: readonly string[], isManual: boolean): string[] {
    return plain.getEligibleCoreFieldNames(sectionNames.map((name) => ({ name })), isManual) as string[]
}

/** The pass restriction fragment: the automatic pass's, or the direct pass's with the eligible fields written in. */
export function passRestriction(settings: AgentModuleSettings, isManual: boolean, eligible: readonly string[]): string {
    return String(plain.resolveAutoPassRestriction(settings, isManual, eligible.join(', ')) ?? '')
}

/** The existing-NPC nudge fragment, the cartridge's or the pin's. */
export function existingNpcNudge(settings: AgentModuleSettings): string {
    return String(plain.resolveExistingNpcNudge(settings) ?? '')
}

/** The legacy's template expander: every `{{key}}` named in `values`, and nothing else. */
export function expandTemplate(template: string, values: Record<string, string | number | null | undefined>): string {
    return String(plain.expandLorebookPromptTemplate(template, values) ?? '')
}

/** The legacy's timestamp adjuster: a template's `Day N, HH:MM AM/PM` examples rewritten to the cartridge's clock and calendar. */
export function adjustPromptTimestamps(text: string, settings: AgentModuleSettings): string {
    return String(plain.adjustPromptTimestamps(text, settings) ?? '')
}

/**
 * The categories the agent may record under this pass: the enabled modules'
 * tags and every custom tag, upper-cased as the legacy does — minus the
 * stock WORLD module, which is World Progression's book here (55-quater).
 */
export function enabledCategoryTags(settings: AgentModuleSettings): string[] {
    return (plain.getEnabledRouterCategoryTags(settings) as string[]).filter((tag) => !isWorldModuleTag(tag))
}

/**
 * The legacy's `## AVAILABLE RECORD CATEGORIES` section, authoritative for
 * the pass: the tags, each routed to the book it names under this campaign.
 */
export function recordCategoryGuidance(prefix: string, tags: readonly string[]): string {
    const head = '## AVAILABLE RECORD CATEGORIES (AUTHORITATIVE FOR THIS PASS)'
    if (!tags.length) return `${head}\nNo record categories are enabled. Do not create new records this pass.`
    const choices = tags.map((tag) => `"${tag}"`).join(' | ')
    const routes = tags.map((tag) => `"${tag}" -> "${campaignBookName(prefix, tag)}"`).join(', ')
    return `${head}\nThe only valid \`record[].category\` values are: ${choices}.\nRoutes: ${routes}.\nUse one of these exact values for every new record. Categories not listed here are disabled and must not be used.`
}

/** The legacy's strip of the template's static `## DUNGEON LOCATION OWNERSHIP` section, applied to every pass as the legacy applies it. */
export function stripStaticMapGuidance(text: string): string {
    return String(plain.stripStaticDungeonAgentGuidance(text) ?? '')
}

/** The legacy's `## MAPPED SITE` note while the party stands inside a mapped site; `''` outside one. */
export function mappedSiteNote(siteRoot: string | null | undefined): string {
    const root = String(siteRoot ?? '').trim()
    return root ? String(plain.formatMappedSiteAgentNote({ siteRoot: root }) ?? '') : ''
}

/** The legacy's `## CURRENT LOCATION` section, with its footer-lag note. */
export function currentLocationSection(hierarchy: string | null | undefined): string {
    return String(plain.formatCurrentLocationSection(String(hierarchy ?? '').trim()) ?? '')
}

/**
 * The memo's `[QUESTS]` block for the legacy's `## ACTIVE QUESTS` section
 * (72c): the block whole, or `None` — the legacy's inline `questMatchA`,
 * transcribed since it is three lines of a closure.
 */
export function extractQuestsBlock(memo: string | null | undefined): string {
    const match = String(memo ?? '').match(/\[QUESTS\]([\s\S]*?)\[\/QUESTS\]/i)
    return match ? `[QUESTS]${match[1]!.trim()}[/QUESTS]` : 'None'
}

/** The legacy's field tests, for the writer's automatic-pass rule (72c). */
export const coreFieldKind = {
    appearance: (field: string): boolean => plain.isAppearanceField(field) === true,
    equipment: (field: string): boolean => plain.isEquipmentField(field) === true,
    combat: (field: string): boolean => plain.isCombatProfileField(field) === true,
}

/** The legacy's existence rule, held for the departure note: its sense is carried, its words name an active set. */
export const LORE_EXISTENCE_RULE: string = String(plain.LORE_EXISTENCE_RULE ?? '')

/**
 * The names of the activation half of the legacy's two templates — AdventureTime's
 * own list, not the legacy's: the three tagged sections of the system
 * template and the one `##` section of the shared context that instruct the
 * agent to curate an active set, which this build does not do
 * (`docs/DECISION-ACTIVATION.md`, departure 1).
 */
export const ACTIVATION_SECTIONS = {
    /** `<tag>…</tag>` blocks of the system template. */
    tags: ['basic_instructions', 'context_maximization', 'bravery'],
    /** `## HEADING` sections of the shared context, to the next heading or a placeholder standing alone. */
    headings: ['MEMORY LIMIT'],
} as const

/**
 * A template without its activation sections (72c, AdventureTime's own): a tagged
 * block is taken out whole, tags included; a `##` section runs to the next
 * `## ` heading or to a `{{placeholder}}` standing on its own line, which the
 * shared context puts between its sections. A template that has lost the
 * tags, or never had them, is returned as it stands: nothing is guessed at.
 */
export function withoutActivationSections(template: string): string {
    let text = String(template ?? '')
    for (const tag of ACTIVATION_SECTIONS.tags) {
        text = text.replace(new RegExp(`[ \\t]*<${tag}>[\\s\\S]*?</${tag}>[ \\t]*\\n?`, 'gi'), '')
    }
    const lines = text.split('\n')
    const kept: string[] = []
    let dropping = false
    for (const line of lines) {
        const heading = /^##\s+(.+?)\s*$/.exec(line)
        if (heading) {
            dropping = ACTIVATION_SECTIONS.headings.some((name) => heading[1]!.toUpperCase() === name)
            if (dropping) continue
        } else if (dropping && /^\{\{\w+\}\}\s*$/.test(line)) {
            dropping = false
        }
        if (!dropping) kept.push(line)
    }
    return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
