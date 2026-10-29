/**
 * The prompts the tracker sends and injects.
 *
 * Two directions, and they want different text:
 *
 *   - **Out to the tracker pass** — the system prompt is the cartridge's own
 *     extractor prompt plus one instruction per enabled module. The module
 *     instructions *are* the sub-modules: a cartridge's `[WAYSTONE]` behaviour is
 *     the paragraph its custom field carries, assembled here. This is why
 *     module toggles and prompt text are cartridge-surface keys.
 *   - **In to the story** — the memo becomes context for the narrative model,
 *     with the display markers taken out. `((BARCYAN))` means something to the
 *     card renderer and nothing to a storyteller, so it is stripped rather than
 *     spent as tokens and risked as confusion.
 *
 * Ported from `buildModulesInstructionText` and the tracker call site in the
 * legacy build at the pin. The prompt strings themselves come from the
 * cartridge — they are tuned artifacts, and the plan lists them as text that
 * must survive verbatim.
 */

import { compactBenchedPartyForContext } from './bench.js'
import { stripMemoHtml } from './memo.js'

/**
 * State-transport invariants, appended to a COMBAT prompt that lacks them.
 *
 * Kept active for a customized or older COMBAT prompt without editing the
 * user's saved text: they are how combat state travels between turns, not
 * theme, so a cartridge that predates them still needs them.
 */
const DEFEATED_COMBATANTS_PROMPT_RULE =
    '- DEFEATED COMBATANTS: Mark defeated enemies as Status: Defeated. Do not omit them from the memo.'
const COMBAT_SIDES_PROMPT_RULE =
    '- COMBAT SIDES: Group combatants under ENEMIES: and NON-PARTY ALLIES: headers, with enemies first. NON-PARTY ALLIES are allied combatants who are NOT listed in [PARTY]. Never put any [PARTY] member in [COMBAT]. Include both headers when non-party allies are present; otherwise include ENEMIES: only.'

/** Prompts that exist only as alternate spellings of another module. */
const HELPER_PROMPT_KEYS = new Set(['time_24h', 'time_ddmmyy', 'time_ddmmyy_24h'])

/**
 * Modules whose prompt promises engine behaviour this build does not have.
 *
 * `benched party` tells the model "Code moves their full [PARTY] stat sheet
 * automatically" and "code handles roster moves". Nothing does — `[BENCH]` and
 * `[UNBENCH]` are the one part of the legacy merge that was never ported, and
 * `mergeMemo` says so. The module is on in the factory and in every cartridge
 * exported since, so the default has always been a module that lies: the
 * companion stays in `[PARTY]` with full stats while a raw `[BENCH] Name —
 * reason` command line accumulates in the other block, and the model has been
 * told not to re-output `[PARTY]`, so nothing corrects it.
 *
 * Switching it off here rather than in the cartridge is deliberate. `modules`
 * is a cartridge-surface key with no editor yet, and the factory file is
 * generated from the legacy build (rule 3a) — neither is a place to record
 * "our engine cannot do this". A cartridge still round-trips the flag
 * untouched, so switching it back on is this one line, once the commands land.
 *
 * The legacy behaves the same way with the module switched off, so this is the
 * pinned "module off" path rather than a new one: the `party` prompt's own
 * closing sentence already covers it — "If [BENCHED PARTY] is disabled,
 * separations are just narration and nothing here changes."
 */
export const UNSUPPORTED_MODULES: ReadonlySet<string> = new Set([])

/**
 * The settings a pass actually runs on, with unsupported modules switched off.
 *
 * Separate from `buildTrackerPrompt` so the pin test can hand the same
 * effective settings to both sides and go on comparing *assembly* rather than
 * failing over a module set we deliberately differ on.
 */
export function effectiveTrackerSettings(settings: TrackerPromptSettings): TrackerPromptSettings {
    const modules = settings.modules ?? {}
    if (![...UNSUPPORTED_MODULES].some((key) => modules[key])) return settings

    const trimmed: Record<string, boolean> = { ...modules }
    for (const key of UNSUPPORTED_MODULES) delete trimmed[key]
    return { ...settings, modules: trimmed }
}

/**
 * Where the extractor template wants its module list.
 *
 * The template is not a preamble the modules follow — it is a document with a
 * hole in it. The hole sits inside `<modules>`, directly under "You must track
 * the following enabled modules:" and directly above "NEVER ignore a module",
 * and those two lines are the only thing that tells the model what the list is
 * *for*. Appending instead of filling the hole leaves the literal characters
 * `{{modulesText}}` between them and strands the instructions at the end of the
 * prompt, past `</custom_formatting>`, where nothing introduces them.
 */
const MODULES_PLACEHOLDER = '{{modulesText}}'

/**
 * Rewrite the day-counter examples for a campaign on calendar dates.
 *
 * Ported from the legacy tracker call site, which applies this to the *whole*
 * assembled system prompt rather than to one module. `buildModulesInstructionText`
 * separately rewrites three of these inside the quest prompt — that narrower pass
 * is the legacy builder's own and is pinned by `prompt.pin.test.ts`, so both
 * layers stay. Running twice is harmless: the second pass finds nothing left.
 *
 * The first three entries are redundant and kept anyway. `Day 3, 14:00` through
 * the bare `Day 3` rule alone already gives `03/01/2026, 14:00`, and
 * `[Day X, HH:MM]` already gives `[DD/MM/YYYY, HH:MM]` — the bare rules subsume
 * all three for every input, so neither their presence nor their position is
 * observable. That is not a guess: a mutation swapping the dated `Day 3` rule
 * for the bare one stayed green, and the equivalence was checked by hand
 * afterwards. They stay because this chain is a verbatim port and a reader
 * diffing it against the pin should find it unchanged, not because they do
 * anything.
 */
function applyDdMmYyFormat(prompt: string): string {
    return prompt
        .replace(/\[Day\s+X,\s+HH:MM\]/g, '[DD/MM/YYYY, HH:MM]')
        .replace(/Day\s+3,\s+14:00/g, '03/01/2026, 14:00')
        .replace(/Day\s+1,\s+11:52/g, '01/01/2026, 11:52')
        .replace(/Day\s+1/g, '01/01/2026')
        .replace(/Day\s+2/g, '02/01/2026')
        .replace(/Day\s+3/g, '03/01/2026')
        .replace(/Day\s+4/g, '04/01/2026')
        .replace(/Day\s+6/g, '06/01/2026')
        .replace(/Day\s+N/g, 'DD/MM/YYYY')
        .replace(/Day\s+X/g, 'DD/MM/YYYY')
}

/** The stock prompt key for the user's chosen clock and date format. */
export function resolveTimePromptKey(settings: TrackerPromptSettings): string {
    if (settings.useDdMmYyFormat) return settings.use24hTime ? 'time_ddmmyy_24h' : 'time_ddmmyy'
    return settings.use24hTime ? 'time_24h' : 'time'
}

/** A user-defined tracker block, as a cartridge carries it. */
export interface PromptCustomField {
    tag?: string
    prompt?: string
    enabled?: boolean
    [key: string]: unknown
}

/** The slice of settings the prompt builders read. All cartridge-surface keys. */
export interface TrackerPromptSettings {
    systemPromptTemplate?: string
    stockPrompts?: Record<string, string>
    modules?: Record<string, boolean>
    syspromptModules?: Record<string, boolean>
    customFields?: PromptCustomField[]
    use24hTime?: boolean
    useDdMmYyFormat?: boolean
    initialDate?: string
}

/**
 * Trim the quest prompt to the quest features that are switched on.
 *
 * The stock quest prompt describes deadlines and a frustration coefficient.
 * Both are optional, and leaving their instructions in while the features are
 * off makes the model emit fields nothing reads.
 */
function tailorQuestPrompt(prompt: string, settings: TrackerPromptSettings): string {
    let p = prompt

    if (settings.useDdMmYyFormat) {
        p = p.replace(/Day 1/g, '01/01/2026').replace(/Day 4/g, '04/01/2026').replace(/Day N/g, 'DD/MM/YYYY')
    }
    if (!settings.syspromptModules?.questsDeadlines) {
        p = p.replace(/\n\s*DEADLINE:.*?\n/g, '\n')
    }
    if (!settings.syspromptModules?.questsFrustration) {
        p = p
            .replace(/\n\s*FRUSTRATION_COEFF:.*?\n/g, '\n')
            .replace(/\n- On quest creation, set FRUSTRATION_COEFF.*\n/g, '\n')
            .replace(/\n- For NPC-given quests only[^\n]*\n/g, '\n')
            .replace(/\n- Omit FRUSTRATION_COEFF for emergent\/self-imposed quests[^\n]*\n/g, '\n')
            .replace(
                /\n- For emergent\/self-imposed quests: set TYPE: emergent, use GIVER: Self @ —, and omit FRUSTRATION_COEFF entirely \(no NPC expects completion\)\.\n/g,
                '\n- For emergent/self-imposed quests: set TYPE: emergent and use GIVER: Self @ —.\n',
            )
    }

    return p
}

/**
 * Build the per-module instruction block for the extractor's system prompt.
 *
 * One line per enabled module, stock modules first and the cartridge's custom
 * fields after. A module that is switched off contributes nothing, which is how
 * a toggle stops a block being emitted at all.
 */
export function buildModulesInstructionText(settings: TrackerPromptSettings, memo = ''): string {
    const prompts = settings.stockPrompts ?? {}
    const modules = settings.modules ?? {}
    let text = '### CORE MODULES\n'

    for (const [key, prompt] of Object.entries(prompts)) {
        if (HELPER_PROMPT_KEYS.has(key)) continue
        if (key === 'quests' && settings.syspromptModules?.quests === false) continue
        if (!modules[key]) continue

        let p = prompt
        if (key === 'quests') p = tailorQuestPrompt(p, settings)
        if (key === 'time') {
            const timeKey = resolveTimePromptKey(settings)
            if (timeKey !== 'time') p = prompts[timeKey] ?? p
        }
        if (key === 'combat') {
            if (!/\bDEFEATED COMBATANTS\s*:/i.test(p)) p = `${p}\n${DEFEATED_COMBATANTS_PROMPT_RULE}`
            if (!/\bNON-PARTY\s+ALLIES\b/i.test(p)) p = `${p}\n${COMBAT_SIDES_PROMPT_RULE}`
        }

        text += `- [${key.toUpperCase()}]: ${p}\n`
    }

    // Only on the first turn of a campaign. Once the pass has written a [TIME]
    // block it owns the clock, and re-anchoring would drag it backwards.
    if (settings.initialDate && !/\[TIME\]/i.test(memo)) {
        text +=
            `\n### CAMPAIGN TIMING RULES\n- The campaign starting date is ${settings.initialDate}. ` +
            `Ensure the very first [TIME] block and all early timeline entries align with this starting anchor.\n`
    }

    const customFields = (settings.customFields ?? []).filter((f) => f.enabled && f.tag)
    if (customFields.length > 0) {
        text += '\n### CUSTOM MODULES\n'
        for (const field of customFields) {
            const instruction = field.prompt || ''
            if (instruction) text += `- [${String(field.tag).toUpperCase()}]: ${instruction}\n`
        }
    }

    return text.trim()
}

/** What a tracker pass is asked. */
export interface TrackerPromptInput {
    settings: TrackerPromptSettings
    /** The memo as it stands before this turn. */
    memo: string
    /** Recent narrative, already formatted one message per entry. */
    narrative: string[]
    /**
     * Earlier memo states the tracker is shown before the current one (72b):
     * the legacy's *History Context (States)*, oldest first. With any given,
     * the prior section takes the legacy's automatic-pass shape — one
     * `## TRACKER STATE -k` per earlier state, then `## TRACKER STATE 0
     * (Current)` — since that is the shape the legacy sends when its count is
     * above one. Absent or empty, the section is `## PRIOR MEMO` as it always was.
     */
    priorStates?: string[]
    /**
     * What the user typed into the send bar, for an instructed pass (Phase 30,
     * Multihog's 💬). Absent on the automatic pass after a reply.
     */
    instruction?: string
    /**
     * The system prompt is the module instructions alone, without the
     * extractor's operating rules: the legacy's `modules_only` mode, which
     * character creation uses (Phase 35) -- a sheet is written from a format,
     * not diffed out of a story.
     */
    modulesOnly?: boolean
    /**
     * The lorebooks' entries as one section (73h, Multihog's *Inject
     * Lorebooks*): `buildWorldLoreContext`'s text, which the legacy puts at
     * the head of the user prompt on every pass, before the prior memo.
     * Blank or absent, the prompt opens on the prior memo as it always did.
     */
    worldLore?: string
    /**
     * The line that closes the user prompt (72c): Multihog's User Prompt
     * Suffix, the preference's text. Blank or absent, the pin's own line.
     */
    outputSuffix?: string
}

export interface TrackerPrompt {
    system: string
    user: string
}

/**
 * The instruction closing the user prompt when the preference is blank: the
 * pin's `userPromptSuffix` default. Since 72c it closes the instructed pass
 * too, as it does at the pin — the `OR NEW SECTIONS` line of the first pin's
 * `sendDirectPrompt` is gone from the legacy, and the User Prompt Suffix
 * closes both of its passes.
 */
export const DEFAULT_OUTPUT_SUFFIX = '## OUTPUT ONLY CHANGED SECTIONS:'

/**
 * Assemble the incremental tracker pass — "here is the state, here is what just
 * happened, tell me what changed".
 *
 * The prior memo goes in with its display HTML stripped: colour markup is for
 * the cards and costs tokens here. The `((MARKER))` tokens deliberately stay,
 * because the pass is expected to echo them back and stripping them would lose
 * every authored module's formatting on the next turn.
 */
export function buildTrackerPrompt(input: TrackerPromptInput): TrackerPrompt {
    const { settings: raw, memo, narrative } = input
    const settings = effectiveTrackerSettings(raw)

    const template = settings.systemPromptTemplate ?? ''
    const modulesText = buildModulesInstructionText(settings, memo)

    // The replacer is a function on purpose. `String.replace` reads `$&`, `$'`
    // and friends out of a *string* replacement, and the module text is built
    // from cartridge prompts a user can write — a custom field containing `$&`
    // would otherwise splice the placeholder back into its own replacement.
    //
    // First occurrence only, as the legacy does. A template carrying the
    // placeholder twice is pathological, and pasting eighteen thousand
    // characters of instructions in twice is worse than matching the pin.
    let system = input.modulesOnly
        ? modulesText
        : template.includes(MODULES_PLACEHOLDER)
        ? template.replace(MODULES_PLACEHOLDER, () => modulesText)
        : // Deliberately *not* the legacy behaviour, and in the safe direction:
          // there, a template that has lost its placeholder silently drops every
          // module instruction, so the extractor is asked to track nothing and
          // the memo quietly stops moving. Appending keeps a customized or
          // hand-edited template working.
          [template, modulesText].filter((part) => part.trim()).join('\n\n')

    if (settings.useDdMmYyFormat) system = applyDdMmYyFormat(system)

    // An instruction changes two things, each the legacy `sendDirectPrompt`'s:
    // an empty memo is named as the initial setup, because "set up my
    // character" is the documented first use; and the instruction goes in as
    // its own section after the story. The closing line is the suffix either
    // way (72c), as it is at the pin.
    // The narrative section is left out when there is no narrative -- an
    // instructed pass may be told to read nothing -- rather than announcing
    // the last zero messages.
    const instruction = input.instruction?.trim() ?? ''
    const prior = stripMemoHtml(memo || '').trim() || (instruction ? '(empty — this is the initial setup)' : '(empty)')
    const states = (input.priorStates ?? []).map((state) => stripMemoHtml(state || '').trim()).filter(Boolean)
    const priorSection = states.length
        ? [...states.map((state, i) => `## TRACKER STATE ${i - states.length}\n${state}`), `## TRACKER STATE 0 (Current)\n${prior}`].join('\n\n')
        : `## PRIOR MEMO\n${prior}`
    // The world lore first (73h), as the legacy's `worldLoreSection +` opens both of its user prompts.
    const worldLore = input.worldLore?.trim() ?? ''
    const user = [
        ...(worldLore ? [worldLore] : []),
        priorSection,
        ...(narrative.length ? [`## NARRATIVE HISTORY (Last ${narrative.length} messages)\n${narrative.join('\n\n')}`] : []),
        ...(instruction ? [`## USER INSTRUCTION\n${instruction}`] : []),
        input.outputSuffix?.trim() || DEFAULT_OUTPUT_SUFFIX,
    ].join('\n\n')

    return { system, user }
}

/**
 * The memo as the *storyteller* should see it.
 *
 * Display markers come out. `((...))` is only ever the marker delimiter inside a
 * memo — it is never prose punctuation there — so everything between double
 * parens is removed outright rather than unwrapped. That is leak-proof by
 * construction: there is no "keep the inner text" case to get wrong, so a new
 * marker spelling never needs handling here.
 *
 * `[QUESTS]` is dropped too: the quest log is injected separately in the legacy
 * build, and repeating it here would spend the budget twice.
 */
export function memoForNarrativeContext(memo: string, opts: { benchedParty?: boolean } = {}): string {
    const stripped = (memo || '')
        .replace(/\[QUESTS\][\s\S]*?\[\/QUESTS\]/gi, '')
        .trim()
        .replace(/\(\([^)]*\)\)/g, '')
        .replace(/ {2,}/g, ' ')
    // The benched roster as a name and a status each, never the sheet -- the
    // legacy's `memoForGmContext` ends the same way. With the module off the
    // block is left out.
    return compactBenchedPartyForContext(stripped, opts.benchedParty !== false).trim()
}

/**
 * The memo as the *tracker* should see it as its prior memo.
 *
 * The legacy's `memoForTrackerContext`, less the resolved-combatant archive
 * that is not ported: the benched roster compacted to name and status, so the
 * pass is never handed a sheet it might re-emit or forget. The full sheets
 * stay in the persisted memo and come back through `hydratePartyRelocationStats`.
 */
export function memoForTrackerContext(memo: string, opts: { benchedParty?: boolean } = {}): string {
    return compactBenchedPartyForContext(memo || '', opts.benchedParty !== false)
}
