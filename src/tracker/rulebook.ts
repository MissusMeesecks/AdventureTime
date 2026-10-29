/**
 * The narrator's rulebook — Multihog's system prompt, assembled.
 *
 * **Roadmap row: "The narrator's rulebook" (`docs/ROADMAP.md`).** Before this
 * module the tracker faithfully recorded HP that the narrator had never been
 * told the rules for losing. Multihog is a rulebook the storyteller plays by,
 * with a tracker recording the results; AdventureTime had the tracker and none of the
 * rulebook.
 *
 * What the legacy does (`index.js` `buildSysprompt`, `game-systems.js`
 * `getSectionRowDescriptor` / `transformBaseSectionContent` /
 * `normalizeSectionOrder`, `src/state/section-enabled.js`,
 * `src/state/narrative-pacing.js`, `src/state/relationship-prompts.js`), and
 * what this ports, step by step:
 *
 * 1. Pick the raw text — `sysprompt.txt` when tool-call dice are on,
 *    `sysprompt_legacy.txt` otherwise. They differ in three lines. Both are
 *    extracted from the pin by `scripts/extract-rulebook.mjs`, never typed.
 * 2. Split it into its 22 top-level `<tag>` sections.
 * 3. Reconcile `syspromptSectionOrder` against those tags and the user's own
 *    `customSyspromptLibrary` entries: drop stale keys, slot in missing base
 *    tags beside their neighbours, put new library entries before
 *    `<constraints>`, keep `CYOA_mode` above `<constraints>`.
 * 4. Walk the order. A base slot may be taken over by an "unlocked" library
 *    override; otherwise it is on unless `syspromptModules[tag] === false`
 *    (`relationship_tracking` follows `npcRelationshipBars`; `CYOA_mode` is
 *    on only when its flag is *true*).
 * 5. Transform each base section for the settings in force — the quests block
 *    rebuilt from `QUESTS_NARRATOR` minus the deadline and frustration lines
 *    when those are off, the benching sub-blocks stripped from
 *    `<[PARTY]_mechanics>` when `party_bench` is off, the RNG section rewritten
 *    to a fallback when dice are off, the pacing section built from
 *    `narrativePacing`, d100 substitutions applied last.
 * 6. Join, substitute a legacy `{{modulesText}}` placeholder, strip dice-tool
 *    lines when dice are off, collapse blank runs.
 *
 * ## Engine limits
 *
 * Three things the rulebook promises that this build cannot yet keep, and so
 * are forced off here regardless of the flag — the same shape as Phase 12's
 * `UNSUPPORTED_MODULES`, for the same reason: a switch that reads on and
 * changes nothing is the lie this project keeps finding (lessons 2, 21). Each
 * is a roadmap row; flipping the limit is the last step of porting it.
 *
 * - **dice** (`rngEnabled`): lifted in Phase 27. The queue is rolled and
 *   injected every turn (`dice.ts`, `dice-injection.ts`), so `<rng_system>`
 *   goes out in its queue wording. Row 2.
 * - **tool-call dice** (`diceFunctionTool`): lifted in Phase 28. The tool is
 *   registered (`dice-tool.ts`), so hybrid mode sends the tool-call wording
 *   outside combat and the queue wording inside it. Row 3.
 * - **party benching** (`syspromptModules.party_bench`): lifted in Phase 29.
 *   `[BENCH]`/`[UNBENCH]` are merged (`bench.ts`), so the narrator is told to
 *   bench and the tracker's commands move the sheet. Row 4.
 * - **CYOA** (`syspromptModules.CYOA_mode`): lifted in Phase 31. The legacy
 *   injects it separately from its interceptor and never into the main
 *   prompt, and so does this build (`backend/cyoa-injection.ts`); the row
 *   here reports that message's size. Row 6.
 *
 * The map-architect *text opener* variant of the mapping section (Phase 46):
 * with `mapArchitectOpener` at `'text'` the section's opening bullets give way
 * to the opener's rules, exactly as the legacy's `transformBaseSectionContent`
 * does it -- at the pin the marker it keeps the rest from is not in the
 * section's text, so the rules are the whole section.
 *
 * Pure throughout. Macros (`{{user}}`) are the interceptor's job.
 */

import { isTextOpener, MAP_ARCHITECT_TEXT_OPENER_RULES } from './opener.js'
import { buildCyoaModeBlock, type CyoaConfig } from './cyoa.js'
import { buildModulesInstructionText, type TrackerPromptSettings } from './prompt.js'
import { QUESTS_NARRATOR, RULEBOOK_QUEUE, RULEBOOK_TOOLCALL } from './rulebook-text.js'

/** What this build cannot honour yet. See the module note. */
export const ENGINE_LIMITS = Object.freeze({
    dice: true,
    partyBench: true,
    cyoa: true,
})

export interface RulebookSection {
    tag: string
    content: string
}

/** One entry of `customSyspromptLibrary`, as far as assembly cares. */
export interface RulebookLibraryEntry {
    id?: string
    tag?: string
    content?: string
    enabled?: boolean
    origin?: string
    baseTag?: string
    _chatSetupMember?: boolean
    [key: string]: unknown
}

export interface RulebookSettings {
    syspromptModules?: Record<string, boolean>
    syspromptSectionOrder?: string[]
    customSyspromptLibrary?: RulebookLibraryEntry[]
    rngEnabled?: boolean
    diceFunctionTool?: boolean
    diceD100Mode?: boolean
    rngQueueD20?: boolean
    rngQueueD100?: boolean
    narrativePacing?: string
    npcRelationshipBars?: boolean
    npcRelationshipMax?: number
    npcRelationshipMaxDefault?: number
    use24hTime?: boolean
    useDdMmYyFormat?: boolean
    /** The choice slots and switches behind `<CYOA_mode>`; read by its injection. */
    cyoaConfig?: CyoaConfig
    /** The Map Architect's opener (46): `'text'` for the block in the prose, the tool otherwise. A preference, not a cartridge key. */
    mapArchitectOpener?: string
    [key: string]: unknown
}

/** The rulebook section that switches the hidden map on, by its tag. */
export const MAPPING_SECTION_TAG = 'dungeon_reality_and_hidden_mapping'

/**
 * Whether the narrator is asked for choices this turn.
 *
 * The flag must be *true*, as `isBaseSectionEnabled` reads it, and the engine
 * must have the injection -- one place for both, so the injection and the
 * panel row can never disagree about whether choices are on.
 */
export function isCyoaActive(settings: RulebookSettings): boolean {
    return ENGINE_LIMITS.cyoa && isBaseSectionEnabled('CYOA_mode', settings)
}

export interface RulebookOptions {
    /**
     * The chat's current memo, for the in-combat RNG switch: in hybrid mode
     * `<rng_system>` tells the narrator to call the tool outside combat and
     * to read the queue inside it.
     */
    memo?: string
}

/** The legacy's tag grammar: `role`, `[PARTY]_mechanics`, `combat_start`. */
const TAG_NAME = '(?:\\[[^\\]]+\\][\\w_-]*|\\w[\\w_-]*)'

/**
 * Split the raw prompt into its top-level `<tag>…</tag>` sections.
 *
 * The lazy match is what makes nested blocks work: `<combat>` runs to the
 * first `</combat>`, swallowing `<combat_start>` and friends as content, and
 * the scan resumes after it. Twenty-two sections in the pinned text, checked
 * against the golden order by a test.
 */
export function extractTopLevelSections(raw: string): RulebookSection[] {
    const sections: RulebookSection[] = []
    const re = new RegExp(`<(${TAG_NAME})>([\\s\\S]*?)<\\/\\1>`, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(raw || ''))) sections.push({ tag: m[1]!, content: m[2]!.trim() })
    return sections
}

/** Empty, or an empty wrapper like `<tag>\n\n</tag>`. */
export function isBlankSectionContent(content: unknown): boolean {
    const trimmed = String(content ?? '').trim()
    if (!trimmed) return true
    return new RegExp(`^<(${TAG_NAME})>\\s*<\\/\\1>$`).test(trimmed)
}

/** The unlocked override that occupies a base slot, if any. */
export function findActiveUnlockedBaseOverride(
    library: readonly RulebookLibraryEntry[] | undefined,
    tag: string,
): RulebookLibraryEntry | null {
    return (
        (library ?? []).find(
            (p) => p.origin === 'unlocked_base' && p.baseTag === tag && p._chatSetupMember !== false,
        ) ?? null
    )
}

/**
 * Whether a built-in base section is on.
 *
 * Any tag can be switched off by `syspromptModules[tag] === false`, not just
 * the ones the factory names — `role` and `constraints` included. Two are
 * special: `relationship_tracking` follows the bars setting, and `CYOA_mode`
 * is off unless its flag is *true*.
 */
export function isBaseSectionEnabled(tag: string, settings: RulebookSettings): boolean {
    if (tag === 'relationship_tracking') return !!settings.npcRelationshipBars
    const mods = settings.syspromptModules ?? {}
    if (tag === 'CYOA_mode') return mods.CYOA_mode === true
    return mods[tag] !== false
}

/**
 * Reconcile a saved order against the live base tags and library.
 *
 * Pure — the legacy mutates `settings` in place and this returns the result
 * instead. Same rules: `party_join_leave` is the old name of
 * `[PARTY]_mechanics`; stale keys are dropped; a missing base tag is placed
 * after its nearest earlier neighbour from the raw text, else before its
 * nearest later one; `CYOA_mode` is kept above `constraints`; new library
 * entries go before `constraints`, or last. Unlocked overrides ride on their
 * base slot and get no entry of their own unless detached from the chat setup.
 */
export function normalizeSectionOrder(
    order: readonly string[] | undefined,
    baseSections: readonly RulebookSection[],
    library: readonly RulebookLibraryEntry[] | undefined,
): string[] {
    const saved = (Array.isArray(order) ? order : []).map((key) =>
        key === 'base:party_join_leave' ? 'base:[PARTY]_mechanics' : key,
    )
    const lib = (library ?? []).map((p) =>
        p.baseTag === 'party_join_leave' ? { ...p, baseTag: '[PARTY]_mechanics' } : p,
    )
    const orderableLibKeys = new Set(
        lib
            .filter((p) => p.origin !== 'unlocked_base' || p._chatSetupMember === false)
            .map((p) => `lib:${p.id}`),
    )
    const baseKeys = baseSections.map((s) => `base:${s.tag}`)
    const baseKeySet = new Set(baseKeys)

    const out = saved.filter((key) => {
        if (typeof key !== 'string') return false
        if (key.startsWith('base:')) return baseKeySet.has(key)
        if (key.startsWith('lib:')) return orderableLibKeys.has(key)
        return false
    })

    baseKeys.forEach((key) => {
        if (out.includes(key)) return
        const fileIdx = baseKeys.indexOf(key)
        let insertAt = out.length
        for (let i = fileIdx - 1; i >= 0; i--) {
            const earlier = out.indexOf(baseKeys[i]!)
            if (earlier !== -1) {
                insertAt = earlier + 1
                break
            }
        }
        if (insertAt === out.length) {
            for (let i = fileIdx + 1; i < baseKeys.length; i++) {
                const later = out.indexOf(baseKeys[i]!)
                if (later !== -1) {
                    insertAt = later
                    break
                }
            }
        }
        out.splice(insertAt, 0, key)
    })

    const cyoaIdx = out.indexOf('base:CYOA_mode')
    const constraintsIdx = out.indexOf('base:constraints')
    if (cyoaIdx !== -1 && constraintsIdx !== -1 && cyoaIdx > constraintsIdx) {
        out.splice(cyoaIdx, 1)
        out.splice(constraintsIdx, 0, 'base:CYOA_mode')
    }

    const newLibKeys = [...orderableLibKeys].filter((key) => !out.includes(key))
    if (newLibKeys.length) {
        const at = out.indexOf('base:constraints')
        if (at === -1) out.push(...newLibKeys)
        else out.splice(at, 0, ...newLibKeys)
    }

    return out
}

// ── the per-section helpers the transform rebuilds from ───────────────────

const SHARED_NARRATIVE_RULES = `- Simulate realistic time passage; advance the time in the status footer accordingly.
- Multiple skill checks per output are fine when appropriate.
- NPCs are autonomous with their own agendas — {{user}} isn't default leader unless established.
- High-competence/alpha NPCs (e.g. Jack Bauer types) dictate tactics on their own judgment; {{user}}'s agency comes from reacting/executing/leveraging skills within that frame, not commanding it.
- NPCs can express opinions about things, and they can even leave over serious value conflicts.
- NPCs only know what they'd realistically know based on established narrative and their archetype; they're not omniscient.
- NPC tone and behavior is guided by their injected permanent profile (the identity fields above any chronicle lines).`

const VOICE_LINE = `- Voice: may expand {{user}}'s dialogue/actions consistent with their character.`

/** Mode-specific pacing tags; empty for `normal`. */
export function buildNarrativeModeTags(pacing: unknown): string {
    if (pacing === 'high_agency') {
        return `<high_agency_mode_on>
- Emphasize player-agency. Keep outputs short-to moderate-length to maintain high player agency/room for input.
</high_agency_mode_on>`
    }
    if (pacing === 'shorter_outputs') {
        return `<output_length>
- Keep the output length short/modest; don't let it drift out of control.
</output_length>`
    }
    if (pacing === 'downtime') {
        return `<slice_of_life_mode_on>
- Keep the pacing relaxed; don't enforce action or "save the world" plots. This is a "slice of life" type of roleplay.
</slice_of_life_mode_on>`
    }
    return ''
}

export function buildNarrativePacingSection(pacing: unknown): string {
    const parts = [SHARED_NARRATIVE_RULES]
    if (pacing === 'normal' || pacing === 'shorter_outputs') parts.push(VOICE_LINE)
    const modeTags = buildNarrativeModeTags(pacing)
    if (modeTags) parts.push(modeTags)
    return `<narrative>\n${parts.join('\n')}\n</narrative>`
}

function normalizeNpcRelationshipMax(raw: unknown): number {
    const n = Number(raw)
    if (!Number.isFinite(n)) return 150
    return Math.max(10, Math.min(10000, Math.round(n)))
}

/** Effective relationship scale: the chat's own value, else the default, else 150. */
export function getNpcRelationshipMax(settings: RulebookSettings): number {
    if (settings.npcRelationshipMax != null) return normalizeNpcRelationshipMax(settings.npcRelationshipMax)
    return normalizeNpcRelationshipMax(settings.npcRelationshipMaxDefault ?? 150)
}

export function buildRelationshipTrackingSysprompt(max: number): string {
    const m = max
    return `RELATIONSHIP TRACKING — only active when [NPC_RELATIONS] appears in context.

[NPC_RELATIONS] at the top of each turn shows current standings with active NPCs. Scale: -${m} (deep hostility) to +${m} (deep bond). Friendship = platonic trust. Affection = romantic/emotional warmth. Point changes are absolute increments clamped to ±${m}.

WHEN TO EMIT:
- When {{user}} acts in a way an NPC would appreciate, admire, etc. Use the NPC's injected permanent profile (if available) as a guide. What would this NPC appreciate; what might they dislike? Don't be afraid to give negative points if {{user}} acts in a way the NPC in question would dislike.

DO NOT EMIT when: the interaction has no emotional weight (buying supplies, directions), the NPC is absent, or nothing meaningful happened between {{user}} and that NPC this turn.

INLINE ANNOTATION (visible — place immediately after the triggering moment):
*(Friendship: Marcus +10 — saved his life in the alley)*
*(Affection: Elena +2 — she seemed touched by the compliment)*
*(Friendship: Horgath the Warrior -7 — showed disrespect toward self-sacrifice)*

Affection is not necessarily limited to explicitly romantic actions.`
}

// ── the transform ─────────────────────────────────────────────────────────

/** The settings the rulebook actually runs on, with the engine limits applied. */
export function effectiveRulebookSettings(settings: RulebookSettings): RulebookSettings {
    const out: RulebookSettings = { ...settings }
    if (!ENGINE_LIMITS.dice) out.rngEnabled = false
    if (!ENGINE_LIMITS.partyBench) {
        out.syspromptModules = { ...(settings.syspromptModules ?? {}), party_bench: false }
    }
    // No CYOA line here on purpose: the legacy never put `<CYOA_mode>` in the
    // main prompt (it is its own injection), so the text is the same either
    // way and the limit gates only the panel row. A line forcing the flag off
    // would be dead code, and a mutation deleting it stayed green.
    return out
}

/**
 * Rewrite one base section for the settings in force.
 *
 * A direct port of the legacy's `transformBaseSectionContent`, the
 * map-architect text-opener branch included (46). `settings` here is
 * expected to be the *effective* settings — call `effectiveRulebookSettings`
 * first — so the limits are already applied.
 */
export function transformBaseSectionContent(
    tag: string,
    innerContent: string,
    settings: RulebookSettings,
    opts: RulebookOptions = {},
): string {
    const mods = settings.syspromptModules ?? {}
    const d100Mode = !!settings.diceD100Mode

    if (tag === 'narrative') return buildNarrativePacingSection(settings.narrativePacing)

    // The legacy injects CYOA from its interceptor, never into the main prompt.
    if (tag === 'CYOA_mode') return ''

    // The text opener (46): the opener's rules in place of the tool-call
    // bullets, the rest of the section kept from the legacy's marker when it
    // is there -- which, at the pin, it is not.
    if (tag === MAPPING_SECTION_TAG && isTextOpener(settings)) {
        const restStart = innerContent.search(/- DUNGEON maps are room-scale/)
        const rest = restStart >= 0 ? innerContent.slice(restStart).trim() : ''
        return `<${MAPPING_SECTION_TAG}>\n${MAP_ARCHITECT_TEXT_OPENER_RULES}${rest ? `\n${rest}` : ''}\n</${MAPPING_SECTION_TAG}>`
    }

    if (tag === 'relationship_tracking') {
        if (!settings.npcRelationshipBars) return ''
        return `<relationship_tracking>\n${buildRelationshipTrackingSysprompt(getNpcRelationshipMax(settings))}\n</relationship_tracking>`
    }

    if (tag === 'rng_system' && !settings.rngEnabled) {
        const dieWord = d100Mode ? 'd100' : 'd20'
        let fallbackText = `To resolve actions, simulate a fair ${dieWord} roll internally and maintain all ROLL FORMAT rules.\n\n`
        let matchedFormat = false
        if (innerContent.includes('ROLL FORMAT')) {
            const m = innerContent.match(/(ROLL FORMAT[\s\S]*?)(?=\n\[FALLBACK\]|$)/i)
            if (m) {
                fallbackText += m[1]!.trim()
                matchedFormat = true
            }
        } else {
            const l4 = innerContent.match(/4\.\s*(Output[\s\S]*?)(?=\n\[FALLBACK\]|$)/i)
            if (l4) {
                fallbackText += l4[1]!.replace(/5\.\s*/g, '').trim()
                matchedFormat = true
            }
        }
        if (!matchedFormat) {
            fallbackText += `Output rolls as \`[ROLL: 1${dieWord}+Mod vs DC X (Result: Y) -> Outcome]\` or \`[ROLL: 1${dieWord}+Mod (Result: Y) -> Outcome]\`.`
        }
        return `<rng_system>\n${fallbackText.trim()}\n</rng_system>`
    }

    if (tag === 'rng_system' && settings.rngEnabled && settings.diceFunctionTool) {
        const combatMatch = (opts.memo ?? '').match(/\[COMBAT\]([\s\S]*?)\[\/COMBAT\]/i)
        const combatBody = combatMatch?.[1]?.trim() ?? ''
        const inCombat = !!combatBody && !/^END_COMBAT$/i.test(combatBody)
        const dieWord = d100Mode ? 'd100' : 'd20'
        const toolName = d100Mode ? 'RollTheDiceD100' : 'RollTheDice'
        if (!inCombat) {
            return `<rng_system>\nFor each roll, call ${toolName} with the DC included in the tool parameters; set the DC before seeing the result. Output the DC, roll, and success/failure in parentheses. In combat, prefer batching multiple rolls into a single tool call for efficiency.\n</rng_system>`
        }
        const queueName = d100Mode ? '[RNG_QUEUE_d100 v7.0]' : '[RNG_QUEUE v7.0]'
        return `<rng_system>\n${queueName} is the sole RNG mechanic — internal physics, never revealed or explained.\n<rng_queue_instructions>\nPop lines in order (1, 2, 3...). Each line has labeled dice (${dieWord}=, d4=, d6=, d8=, d10=, d12=). Queue length 12, wraps on exhaustion.\n- ${dieWord} = attacks/checks. Damage dice = matching label on the same line.\n- Always fold in ability scores/proficiency. Reveal a roll only right before it appears in the narrative.\n</rng_queue_instructions>\n\nROLL FORMAT (strict):\n- Attack: *(Attack: 12 [Roll] + 1 [Mod] = 13 vs AC 14)*\n- Save / effect: *(Dexterity Save: 12 [Roll] + 3 [Mod] = 15 vs DC 14)*\n- Damage: *(Damage: d10 + 3 → 8 piercing)*\n\nDC SCALE: Trivial 8 | Easy 14 | Moderate 18 | Hard 23 | Severe 28 | Near-impossible 33+\n\nUnknown skill bonuses: judge from background/archetype + situational mods.\n[FALLBACK]: No queue provided → simulate a fair ${dieWord} internally, same ROLL FORMAT.\n</rng_system>`
    }

    if (tag === 'quests') {
        let instruction = QUESTS_NARRATOR
        if (!mods.questsFrustration) {
            instruction = instruction.replace(
                /\n?- ?Quest MOOD \(in STATE MEMO, from time pressure \+ FRUSTRATION_COEFF\) should guide questgiver tone for NPC-given quests only\./g,
                '',
            )
        }
        let result = `<quests>\n${instruction.trim()}\n</quests>`
        if (!mods.questsDeadlines) {
            result = result.replace(/- Assign an in-world Deadline.*\n/g, '')
            result = result.replace(/- Set auto_fail to true for quests.*\n/g, '')
            result = result.replace(/- If a duration is given.* Day N.*\n/g, '')
        }
        return result
    }

    if (tag === '[PARTY]_mechanics') {
        let content = innerContent.trim()
        if (mods.party_bench === false) {
            content = content.replace(/\s*<leaving_vs_benching>[\s\S]*?<\/leaving_vs_benching>/i, '').trim()
            content = content.replace(/\s*<bench_ETA_system>[\s\S]*?<\/bench_ETA_system>/i, '').trim()
        } else if (settings.rngEnabled) {
            // The bench's return roll follows the live RNG mechanic (upstream
            // 2026.8.78, Phase 45): the tool outside combat in hybrid mode,
            // the queue in combat and in pre-seeded mode — the same boundary
            // the rng_system branch above draws, read from the same memo.
            const queueName = d100Mode ? '[RNG_QUEUE_d100 v7.0]' : '[RNG_QUEUE v7.0]'
            const dieWord = d100Mode ? 'd100' : 'd20'
            const toolName = d100Mode ? 'RollTheDiceD100' : 'RollTheDice'
            const combatMatch = (opts.memo ?? '').match(/\[COMBAT\]([\s\S]*?)\[\/COMBAT\]/i)
            const combatBody = combatMatch?.[1]?.trim() ?? ''
            const inCombat = !!combatBody && !/^END_COMBAT$/i.test(combatBody)
            const useQueue = !settings.diceFunctionTool || inCombat
            const benchEta = useQueue
                ? `On benching, estimate a return ETA. Just before return (never once already in-scene), pop a ${dieWord} from ${queueName} to resolve task success/failure — DC by task difficulty + character suitability. Critical failure = injured return, no return, or similarly severe outcome. This pop is mandatory, always pre-return.`
                : `On benching, estimate a return ETA. Just before return (never once already in-scene), call ${toolName} to resolve task success/failure — DC by task difficulty + character suitability. Critical failure = injured return, no return, or similarly severe outcome. This roll is mandatory, always pre-return.`
            content = content.replace(
                /<bench_ETA_system>[\s\S]*?<\/bench_ETA_system>/i,
                `<bench_ETA_system>\n${benchEta}\n</bench_ETA_system>`,
            )
        }
        return `<[PARTY]_mechanics>\n${content}\n</[PARTY]_mechanics>`
    }

    // A flag, not a section: it only ever gates sub-blocks of the one above.
    if (tag === 'party_bench') return ''

    if (tag === 'end_of_output_footer') {
        let footer = `<end_of_output_footer>\n${innerContent.trim()}\n</end_of_output_footer>`
        if (settings.use24hTime) {
            footer = footer.replace(/\[HH:MM AM\/PM\]/g, '[HH:MM] (24-hour clock, NO AM/PM)')
        }
        if (settings.useDdMmYyFormat) {
            footer = footer.replace(/Day\s+\[X\]/g, '[DD/MM/YYYY]')
        }
        return footer
    }

    let result = `<${tag}>\n${innerContent.trim()}\n</${tag}>`

    // Applied last so it reaches every section, not only rng_system.
    if (d100Mode) {
        result = result
            .replace(/\bRollTheDice\b/g, 'RollTheDiceD100')
            .replace(/\[RNG_QUEUE v7\.0\]/g, '[RNG_QUEUE_d100 v7.0]')
            .replace(/\[\/RNG_QUEUE\]/g, '[/RNG_QUEUE_d100]')
            .replace(/\b1d20\b/g, '1d100')
            .replace(/\bd20\b/gi, 'd100')
            .replace(
                /(?:The\s+)?first\s+number\s+in\s+each\s+entry\s+is\s+the\s+d100\s+result/gi,
                'Each entry in the queue is a d100 result',
            )
            .replace(/(queue\s+length(?:\s+is|:)\s+)12/gi, '$130')
    }

    return result
}

// ── assembly ──────────────────────────────────────────────────────────────

/** `sysprompt.txt` with tool-call dice, `sysprompt_legacy.txt` without. */
export function selectRulebookText(settings: RulebookSettings): string {
    return settings.diceFunctionTool ? RULEBOOK_TOOLCALL : RULEBOOK_QUEUE
}

/** One resolved row of the order, before transformation. */
export interface RulebookRow {
    key: string
    kind: 'base' | 'unlocked' | 'custom'
    tag: string
    enabled: boolean
    content: string
}

/** The legacy's `getSectionRowDescriptor`, reduced to what assembly reads. */
export function resolveRow(
    key: string,
    settings: RulebookSettings,
    baseSectionMap: ReadonlyMap<string, string>,
): RulebookRow | null {
    const library = settings.customSyspromptLibrary ?? []
    if (key.startsWith('base:')) {
        const tag = key.slice(5)
        const override = findActiveUnlockedBaseOverride(library, tag)
        if (override) {
            return {
                key,
                kind: 'unlocked',
                tag,
                enabled: !!override.enabled,
                content: String(override.content ?? ''),
            }
        }
        return {
            key,
            kind: 'base',
            tag,
            enabled: isBaseSectionEnabled(tag, settings),
            content: baseSectionMap.get(tag) ?? '',
        }
    }
    const id = key.slice(4)
    const item = library.find((p) => String(p.id ?? '') === id)
    if (!item) return null
    return {
        key,
        kind: 'custom',
        tag: String(item.tag ?? ''),
        enabled: !!item.enabled,
        content: String(item.content ?? ''),
    }
}

/**
 * The narrator's system prompt for these settings.
 *
 * Empty when nothing is on, so the caller injects nothing rather than a
 * heading with nothing under it.
 */
export function buildRulebook(input: RulebookSettings, opts: RulebookOptions = {}): string {
    const settings = effectiveRulebookSettings(input)
    const raw = selectRulebookText(settings)
    const baseSections = extractTopLevelSections(raw)
    const baseSectionMap = new Map(baseSections.map((s) => [s.tag, s.content]))
    const order = normalizeSectionOrder(
        settings.syspromptSectionOrder,
        baseSections,
        settings.customSyspromptLibrary,
    )

    const pieces = order
        .map((key) => {
            const row = resolveRow(key, settings, baseSectionMap)
            if (!row || !row.enabled) return ''
            if (row.tag === 'CYOA_mode') return ''
            if (row.kind === 'base') return transformBaseSectionContent(row.tag, row.content, settings, opts)
            return isBlankSectionContent(row.content) ? '' : row.content
        })
        .filter(Boolean)

    let content = pieces.join('\n\n')

    // A legacy placeholder some custom sections still carry.
    if (content.includes('{{modulesText}}')) {
        content = content.replace(
            '{{modulesText}}',
            buildModulesInstructionText(settings as unknown as TrackerPromptSettings),
        )
    }

    if (!settings.rngEnabled) {
        content = content
            .replace(/.*RollTheDice(?:D100)?.*\n?/gi, '')
            .replace(/.*\[RNG_QUEUE(?:_d100)?\s+v[\d.]+[^\]]*\].*\n?/gi, '')
    }

    return content.replace(/\n{3,}/g, '\n\n').trim()
}

// ── the view, for the switches editor ─────────────────────────────────────

export type RulebookGate =
    /** `syspromptModules[tag]`, switchable here. */
    | 'flag'
    /** Follows `npcRelationshipBars`, a setting of its own. */
    | 'setting:npcRelationshipBars'
    /** Forced off by an engine limit; the flag is preserved and ignored. */
    | 'engine'
    /** A user's own section — switched in the world-rules editor, listed here for its place in the order. */
    | 'library'

export interface RulebookViewRow {
    key: string
    tag: string
    kind: 'base' | 'unlocked' | 'custom'
    gate: RulebookGate
    /** The flag's stored value, before any limit. */
    flag: boolean
    /** Whether it reaches the narrator once every gate and limit is applied. */
    sent: boolean
    /** Characters of what would be sent. */
    size: number
    tokens: number
    /** Sub-switches this section carries, e.g. quests' deadline and frustration lines. */
    children: Array<{ flag: string; label: string; on: boolean; engine: boolean }>
}

export interface RulebookView {
    rows: RulebookViewRow[]
    /** The whole assembled prompt's size. */
    size: number
    tokens: number
    counts: string
    limits: string[]
}

const CHILD_FLAGS: Record<string, Array<{ flag: string; label: string; engine?: boolean }>> = {
    quests: [
        { flag: 'questsDeadlines', label: 'deadlines' },
        { flag: 'questsFrustration', label: 'questgiver mood' },
    ],
    '[PARTY]_mechanics': [{ flag: 'party_bench', label: 'benching', engine: !ENGINE_LIMITS.partyBench }],
}

export function buildRulebookView(input: RulebookSettings): RulebookView {
    const settings = effectiveRulebookSettings(input)
    const stored = input.syspromptModules ?? {}
    const raw = selectRulebookText(settings)
    const baseSections = extractTopLevelSections(raw)
    const baseSectionMap = new Map(baseSections.map((s) => [s.tag, s.content]))
    const order = normalizeSectionOrder(
        settings.syspromptSectionOrder,
        baseSections,
        settings.customSyspromptLibrary,
    )

    const rows: RulebookViewRow[] = []
    for (const key of order) {
        const row = resolveRow(key, settings, baseSectionMap)
        if (!row) continue

        let gate: RulebookGate = 'flag'
        if (row.kind === 'custom') gate = 'library'
        else if (row.tag === 'relationship_tracking') gate = 'setting:npcRelationshipBars'
        else if (row.tag === 'CYOA_mode' && !ENGINE_LIMITS.cyoa) gate = 'engine'

        // CYOA is sized from the message its injection sends -- the rulebook
        // itself carries nothing for it -- so the row's cost is the real one.
        const body =
            row.tag === 'CYOA_mode'
                ? isCyoaActive(settings)
                    ? buildCyoaModeBlock(settings.cyoaConfig ?? {})
                    : ''
                : row.enabled
                  ? row.kind === 'base'
                      ? transformBaseSectionContent(row.tag, row.content, settings)
                      : isBlankSectionContent(row.content)
                        ? ''
                        : row.content
                  : ''

        rows.push({
            key,
            tag: row.tag,
            kind: row.kind,
            gate,
            flag: row.tag === 'CYOA_mode' ? stored.CYOA_mode === true : stored[row.tag] !== false,
            sent: body.trim() !== '',
            size: body.length,
            tokens: Math.round(body.length / 4),
            children: (CHILD_FLAGS[row.tag] ?? []).map((c) => ({
                flag: c.flag,
                label: c.label,
                on: c.engine ? false : stored[c.flag] !== false,
                engine: !!c.engine,
            })),
        })
    }

    const whole = buildRulebook(input)
    const base = rows.filter((r) => r.kind !== 'custom')
    const sent = base.filter((r) => r.sent).length
    const counts = `${base.length} stock sections · ${sent} sent`

    const limits: string[] = []
    if (!ENGINE_LIMITS.dice) {
        limits.push(
            'Dice are not built yet, so the RNG section tells the narrator to simulate a fair d20 internally. ' +
                'The rngEnabled setting is preserved and ignored until the dice engine lands.',
        )
    }
    if (!ENGINE_LIMITS.partyBench) {
        limits.push(
            'Party benching is switched off by AdventureTime: the [BENCH] and [UNBENCH] commands are not merged, ' +
                'so the narrator is not told to bench. The flag is preserved.',
        )
    }

    return { rows, size: whole.length, tokens: Math.round(whole.length / 4), counts, limits }
}
