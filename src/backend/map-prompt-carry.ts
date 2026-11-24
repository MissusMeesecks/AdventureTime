/**
 * Phase 97: the map passes read their prompts from the cartridge.
 *
 * Until 97 the Map Architect, the Map Updater and Map Evolution read their
 * system prompts from three install preferences, edited in three boxes on
 * the *Persistent maps* dial cards, while the cartridge carried the four
 * prompts Multihog keeps (`mapArchitectSystemPrompt`, `mapUpdaterSystemPrompt`,
 * `mapEvolutionSystemPrompt`, `mapEvolutionCompressSystemPrompt`) in the
 * *Map Architect* card, which nothing read. An edit there changed nothing,
 * and the compression prompt had no working box at all (lesson 68).
 *
 * The passes read the cartridge now, as Multihog's do. This module carries
 * a preference that still holds text into the cartridge once per session,
 * so a prompt the passes ran on before the update is the one they run on
 * after it, and empties the preference so it is never carried again. A
 * cartridge text the preference replaces is named in the log: it was the
 * text no pass read.
 */

/** The three preferences 97 retires, each named as its cartridge key. */
export const CARRIED_MAP_PROMPT_KEYS = ['mapArchitectSystemPrompt', 'mapUpdaterSystemPrompt', 'mapEvolutionSystemPrompt'] as const

export type CarriedMapPromptKey = typeof CARRIED_MAP_PROMPT_KEYS[number]

type Bag = Record<string, unknown>

export interface MapPromptCarryDeps {
    prefs: {
        load(userId?: string): Promise<Partial<Record<CarriedMapPromptKey, string>>>
        patch(patch: Partial<Record<CarriedMapPromptKey, string>>, userId?: string): Promise<unknown>
    }
    store: {
        load(userId?: string): Promise<Bag>
        patch(userId: string | undefined, patch: Bag): Promise<Bag>
    }
    log: { info(message: string): void; warn(message: string): void }
}

export interface MapPromptCarryReport {
    /** The keys whose preference text was written into the cartridge. */
    carried: CarriedMapPromptKey[]
    /** Of those, the ones whose cartridge text differed and was replaced. */
    replaced: CarriedMapPromptKey[]
    /** The cartridge after the write, when anything was written. */
    settings?: Bag
}

/** The carry-over itself: every non-blank preference into the cartridge, then the preferences emptied. */
export async function carryMapPrompts(deps: MapPromptCarryDeps, userId: string | undefined): Promise<MapPromptCarryReport> {
    const prefs = await deps.prefs.load(userId)
    const pending = CARRIED_MAP_PROMPT_KEYS.filter((key) => typeof prefs[key] === 'string' && (prefs[key] as string).trim() !== '')
    if (!pending.length) return { carried: [], replaced: [] }

    const cartridge = await deps.store.load(userId)
    const patch: Bag = {}
    const replaced: CarriedMapPromptKey[] = []
    for (const key of pending) {
        const text = prefs[key] as string
        const current = typeof cartridge[key] === 'string' ? (cartridge[key] as string) : ''
        if (current === text) continue
        patch[key] = text
        replaced.push(key)
    }

    // The cartridge first: if its write fails, the preferences still hold the text and the next session tries again.
    const settings = Object.keys(patch).length ? await deps.store.patch(userId, patch) : undefined
    const cleared: Partial<Record<CarriedMapPromptKey, string>> = {}
    for (const key of pending) cleared[key] = ''
    await deps.prefs.patch(cleared, userId)

    deps.log.info(`maps: carried ${pending.length} map prompt${pending.length === 1 ? '' : 's'} from the old dial boxes into the cartridge: ${pending.join(', ')}`)
    if (replaced.length) deps.log.info(`maps: the cartridge's own ${replaced.join(', ')} ${replaced.length === 1 ? 'was' : 'were'} replaced; no pass had read ${replaced.length === 1 ? 'it' : 'them'} before 1.0.0-beta.26`)
    return { carried: [...pending], replaced, ...(settings ? { settings } : {}) }
}
