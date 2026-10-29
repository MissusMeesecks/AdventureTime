/**
 * The ten stock tracker modules, and what each one amounts to here.
 *
 * `modules` is the biggest live managed key in the build — thirty runtime
 * references — and until now it had no editor at all. It decides one thing,
 * at `prompt.ts:198`:
 *
 * ```ts
 * if (!modules[key]) continue
 * ```
 *
 * A switched-off module contributes **no instruction line to the extractor**,
 * so the tracker is never told that block exists. That is lesson 2 exactly:
 * the block still renders from whatever the memo already holds, and travels in
 * cartridges, and simply never updates again. The custom fields editor has said
 * so about the user's own blocks since Phase 1c; the ten stock ones had no
 * equivalent.
 *
 * Two things make this more than a row of checkboxes, and both are patterns
 * this project has already had to learn:
 *
 * **`quests` is gated twice.** `modules.quests` *and* `syspromptModules.quests`
 * each switch it off, in two separate places (`prompt.ts:197` and
 * `tracker-pass.ts:212`, where the quest sync is skipped). One fact, two keys —
 * lesson 29. So the row reads the *effective* state and a write sets both,
 * exactly as `syncSystemsToFields` does for game systems.
 *
 * **`benched party` is switched off by the engine, not by the user.** Phase 12
 * put it in `UNSUPPORTED_MODULES` because its prompt promises `[BENCH]`
 * handling this build does not have. Its cartridge flag is still `true` and
 * still round-trips. Drawing a live switch on it would be Phase 21's bug — a
 * control that says it did something and did not — so it gets an inert row and
 * the reason, like a GM-only game system.
 */


/** Modules whose block is not maintained, and why. */
export type ModuleVerdict =
    | 'on'
    /** Switched off by the user: the block freezes wherever the memo left it. */
    | 'off'
    /** Forced off by this build regardless of the flag. See `UNSUPPORTED_MODULES`. */
    | 'unsupported'
    /**
     * Switched on with no stock prompt to send.
     *
     * `buildModulesInstructionText` walks `stockPrompts`, not `modules`, so a
     * module the prompts do not mention is never visited — on, and silent. The
     * golden cartridge has none; a partial or hand-edited one could.
     */
    | 'no-prompt'

export interface ModuleRow {
    /** The cartridge key, e.g. `benched party`. */
    key: string
    /** Title case for reading: `Benched party`. */
    label: string
    /** The memo block it maintains, e.g. `[BENCHED PARTY]`. */
    tag: string
    /** The opening sentence of its stock prompt, or `''`. */
    summary: string
    /** The whole prompt, as the cartridge holds it (36). */
    prompt: string
    /** Whether the prompt differs from the factory's text for this key (36). */
    edited: boolean
    /** The flag in `modules`. */
    enabled: boolean
    /** What it amounts to once every gate is applied. */
    verdict: ModuleVerdict
    /** Whether this row's switch can change anything. */
    switchable: boolean
    /**
     * A second key also switches this module off.
     *
     * Only `quests`, via `syspromptModules.quests`. Recorded rather than hidden
     * because the switch has to write both and something has to say why.
     */
    secondGate: boolean
}

export interface TrackerModulesView {
    rows: ModuleRow[]
    /** `10 modules · 9 maintained` */
    counts: string
    summary: string
    /** Present only when a row needs explaining. */
    notes: string[]
}

/**
 * Modules this build refuses to send, mirroring `UNSUPPORTED_MODULES`.
 *
 * Empty since Phase 29 ported `[BENCH]`/`[UNBENCH]`; `benched party` sat here
 * from Phase 12 until then. The mechanism stays for the next module whose
 * prompt promises an engine this build lacks.
 */
export const ENGINE_DISABLED_MODULES: ReadonlySet<string> = new Set([])

/** Why each engine-disabled module is off, in the user's words rather than the code's. */
const DISABLED_REASON: Record<string, string> = {}

/** Prompt keys that are variants of another module rather than modules. */
const HELPER_PROMPT_KEYS: ReadonlySet<string> = new Set(['time_24h', 'time_ddmmyy', 'time_ddmmyy_24h'])

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/**
 * The opening sentence of a stock prompt, for a one-line row summary.
 *
 * Cut at the first full stop or colon — and then back out of any parenthesis
 * that cut left open. The abilities prompt is *"Non-spell class features and
 * active abilities ONLY (e.g. Lay on Hands, Action Surge)"*, and the stop
 * inside `e.g.` left the row reading `…active abilities ONLY (e.g`, which looks
 * like a rendering fault rather than a summary. Dropping the whole parenthetical
 * is right anyway: an example is the first thing a one-liner should lose.
 * Caught by looking at ten real rows, not by a test.
 */
export function openingSentence(prompt: unknown, limit = 110): string {
    const body = text(prompt).trim().replace(/\s+/g, ' ')
    if (!body) return ''

    const stop = body.search(/[.:]\s/)
    let first = stop > 0 ? body.slice(0, stop) : body

    const open = first.lastIndexOf('(')
    if (open >= 0 && !first.slice(open).includes(')')) first = first.slice(0, open)

    first = first.trim().replace(/[,;(]+$/, '').trim()
    return first.length > limit ? `${first.slice(0, limit - 1)}…` : first
}

/**
 * Keys that do not title-case into their own name.
 *
 * `xp` became `Xp` on screen, beside a `[XP]` tag that had it right. One entry
 * is not a pattern worth generalising, and a lookup that says so beats a rule
 * that guesses which words are acronyms.
 */
const LABEL_OVERRIDES: Record<string, string> = { xp: 'XP' }

/** `benched party` -> `Benched party`, `xp` -> `XP`. */
function labelFor(key: string): string {
    if (LABEL_OVERRIDES[key]) return LABEL_OVERRIDES[key]
    return key ? key.charAt(0).toUpperCase() + key.slice(1) : key
}

export interface TrackerModuleSettings {
    modules?: Record<string, boolean>
    stockPrompts?: Record<string, string>
    syspromptModules?: Record<string, boolean>
    [key: string]: unknown
}

/**
 * Replace one module's prompt text (36). The whole `stockPrompts` map comes
 * back, since a settings patch writes keys whole; every other prompt is kept
 * as it was. Trailing whitespace goes, the rest is the user's. An empty text
 * keeps the key with `''`, which the view reports as *no instructions*.
 */
export function setModulePrompt(settings: TrackerModuleSettings, key: string, prompt: string): { stockPrompts: Record<string, string> } {
    const prompts = { ...((settings?.stockPrompts ?? {}) as Record<string, string>) }
    prompts[key] = String(prompt ?? '').replace(/\s+$/, '')
    return { stockPrompts: prompts }
}

/**
 * Read the module table the way the extractor does.
 *
 * Pure, and takes the settings bag rather than three lists, because the whole
 * point is that three keys decide one row between them.
 */
/**
 * @param factory The factory's stock prompts, for the *edited* flag (36). The
 * panel fetches them from the backend rather than bundling the whole factory
 * — the two rulebook prompts alone are a sixth of the frontend. Absent, no
 * row reads as edited.
 */
export function buildTrackerModulesView(settings: TrackerModuleSettings, factory: Record<string, string> = {}): TrackerModulesView {
    const modules = (settings?.modules ?? {}) as Record<string, boolean>
    const prompts = (settings?.stockPrompts ?? {}) as Record<string, string>
    const sysprompt = (settings?.syspromptModules ?? {}) as Record<string, boolean>

    const rows: ModuleRow[] = Object.keys(modules)
        .filter((key) => !HELPER_PROMPT_KEYS.has(key))
        .map((key) => {
            const enabled = Boolean(modules[key])
            // Only `quests`, and only where the second key says so. An absent
            // syspromptModules must not read as a gate: the factory sets it and
            // every real settings object backfills, so a missing one means
            // "nothing said otherwise", not "off".
            const secondGate = key === 'quests' && sysprompt.quests === false
            const hasPrompt = typeof prompts[key] === 'string' && prompts[key].trim() !== ''

            const verdict: ModuleVerdict = ENGINE_DISABLED_MODULES.has(key)
                ? 'unsupported'
                : !enabled || secondGate
                  ? 'off'
                  : !hasPrompt
                    ? 'no-prompt'
                    : 'on'

            const prompt = text(prompts[key])
            return {
                key,
                label: labelFor(key),
                tag: `[${key.toUpperCase()}]`,
                summary: openingSentence(prompts[key]),
                prompt,
                edited: typeof factory[key] === 'string' && prompt.trim() !== factory[key].trim(),
                enabled,
                verdict,
                // An engine-disabled module has nothing a switch could change.
                switchable: !ENGINE_DISABLED_MODULES.has(key),
                secondGate: key === 'quests',
            }
        })

    const maintained = rows.filter((row) => row.verdict === 'on').length
    const counts = rows.length
        ? `${rows.length} module${rows.length === 1 ? '' : 's'} · ${maintained} maintained`
        : ''

    const summary = rows.length
        ? 'These are the tracker’s stock blocks. A module that is switched on is described to the ' +
          'tracker every turn, so its block keeps up with the story. One that is off is never ' +
          'mentioned — its block still shows whatever it already holds, and still travels in your ' +
          'cartridge, but it stops updating.'
        : 'No tracker modules in this cartridge.'

    const notes: string[] = []
    for (const row of rows) {
        if (row.verdict === 'unsupported' && DISABLED_REASON[row.key]) {
            notes.push(`${row.label}: ${DISABLED_REASON[row.key]}`)
        }
        if (row.verdict === 'no-prompt') {
            notes.push(
                `${row.label} is switched on but has no instructions in this cartridge, so the tracker ` +
                    'is never told about it and its block will not update.',
            )
        }
    }

    return { rows, counts, summary, notes }
}

/**
 * Switch a module on or off, writing every key that gates it.
 *
 * Returns the two keys a caller must patch together. `quests` is the only
 * module with a second gate today, and leaving `syspromptModules.quests` at
 * `false` while `modules.quests` says `true` would give the user a switch that
 * reads on and changes nothing — lesson 29, and the reason this returns a pair
 * rather than a single object.
 *
 * Unchanged keys come back as the same object, so a caller can send one key
 * rather than two when only one moved.
 */
export function setModuleEnabled(
    settings: TrackerModuleSettings,
    key: string,
    enabled: boolean,
): { modules: Record<string, boolean>; syspromptModules: Record<string, boolean> } {
    const modules = (settings?.modules ?? {}) as Record<string, boolean>
    const sysprompt = (settings?.syspromptModules ?? {}) as Record<string, boolean>

    // Refused rather than silently ignored: a caller reaching for a switch that
    // is not drawn has misunderstood something, and writing `true` into a flag
    // the engine overrides is the lie this module exists to avoid.
    if (ENGINE_DISABLED_MODULES.has(key)) return { modules, syspromptModules: sysprompt }

    const nextModules =
        Boolean(modules[key]) === enabled ? modules : { ...modules, [key]: enabled }

    // Only touched where it is actually a gate, and only to clear it. Setting
    // it true on the way on is the whole point; setting it false on the way off
    // would be writing a second key the user never asked about.
    const nextSysprompt =
        key === 'quests' && enabled && sysprompt.quests === false
            ? { ...sysprompt, quests: true }
            : sysprompt

    return { modules: nextModules, syspromptModules: nextSysprompt }
}
