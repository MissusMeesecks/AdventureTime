/**
 * The four dice flags follow the RNG mode, as they did in Multihog's panel.
 *
 * The legacy has six controls for the dice -- the mode, d100 mode, and four
 * checkboxes for the d20 tool, the d100 tool, the d20 queue and the d100
 * queue -- and its UI keeps them consistent by hand: choosing a mode or
 * flipping d100 mode rewrites the four (`autoSelectRngToolsFromMode`), and
 * ticking any of the four rewrites d100 mode (`updateD100ToggleState`). The
 * factory ships every tool flag *off*, so without this a person choosing
 * "Pre-seeded + tool calls" would get no tool at all, which is exactly the
 * switch-that-does-nothing this project keeps finding (lesson 21).
 *
 * Ported as one pure function the settings store runs after every patch,
 * rather than as UI wiring, so it has a test and a cartridge edited from
 * anywhere gets the same treatment.
 */

export interface RngFlagSettings {
    rngEnabled?: boolean
    diceFunctionTool?: boolean
    diceD100Mode?: boolean
    rngToolD20?: boolean
    rngToolD100?: boolean
    rngQueueD20?: boolean
    rngQueueD100?: boolean
    [key: string]: unknown
}

const MODE_KEYS = ['rngEnabled', 'diceFunctionTool', 'diceD100Mode']
const FLAG_KEYS = ['rngToolD20', 'rngToolD100', 'rngQueueD20', 'rngQueueD100']

/** The legacy's `autoSelectRngToolsFromMode`: the four flags for a mode. */
export function rngFlagsForMode(s: RngFlagSettings): Pick<RngFlagSettings, 'rngToolD20' | 'rngToolD100' | 'rngQueueD20' | 'rngQueueD100'> {
    if (!s.rngEnabled) {
        return { rngToolD20: false, rngToolD100: false, rngQueueD20: false, rngQueueD100: false }
    }
    if (s.diceFunctionTool === false) {
        return s.diceD100Mode
            ? { rngToolD20: false, rngToolD100: false, rngQueueD20: false, rngQueueD100: true }
            : { rngToolD20: false, rngToolD100: false, rngQueueD20: true, rngQueueD100: false }
    }
    return s.diceD100Mode
        ? { rngToolD20: false, rngToolD100: true, rngQueueD20: false, rngQueueD100: true }
        : { rngToolD20: true, rngToolD100: false, rngQueueD20: true, rngQueueD100: false }
}

/**
 * What else changes when these keys were just written.
 *
 * `settings` already carries the new values; `changed` names the keys the
 * patch wrote. A flag change decides d100 mode; a mode change decides the
 * flags. Nothing else is touched, and a patch touching neither returns `{}`.
 */
export function reconcileRngFlags(settings: RngFlagSettings, changed: readonly string[]): RngFlagSettings {
    if (changed.some((k) => FLAG_KEYS.includes(k))) {
        return { diceD100Mode: !!(settings.rngToolD100 || settings.rngQueueD100) }
    }
    if (changed.some((k) => MODE_KEYS.includes(k))) {
        return { ...rngFlagsForMode(settings) }
    }
    return {}
}
