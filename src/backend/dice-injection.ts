/**
 * Putting the dice queue into the story's prompt.
 *
 * The third injection, between the rulebook and the memo: standing rules
 * first, then this turn's dice, then this turn's facts. `<rng_system>` in
 * the rulebook tells the narrator to pop lines from the queue in order; this
 * is the queue. A fresh one every generation -- a swipe gets new dice, as it
 * did in Multihog. Roadmap row 2.
 *
 * Same contract as the other two providers: synchronous, reads what is in
 * memory, injects nothing rather than waiting. Rolling twelve lines of six
 * dice is microseconds. The memo is read for one reason -- hybrid mode
 * injects the queue only in combat -- and a memo not yet loaded reads as
 * "not in combat", which in queue-only mode changes nothing.
 */

import { buildDiceInjection, type DiceSettings } from '../tracker/dice.js'
import { effectiveRulebookSettings, type RulebookSettings } from '../tracker/rulebook.js'
import type { Injection, InjectionProvider } from './interceptor.js'

export interface DiceInjectionDeps {
    /** The settings as last loaded, synchronously, for this user (rule 3f). */
    settings: (userId: string) => (RulebookSettings & DiceSettings) | null
    /** The chat's memo as last loaded, for the in-combat check. */
    memo: (chatId: string, userId: string) => string | null | undefined
    /** Attribution in Lumiverse's Prompt Breakdown. */
    label?: string
    /** 32 random bits; tests pin it. */
    random?: () => number
    /** The clock behind `turn_id`; tests pin it. */
    now?: () => number
}

export const DICE_INJECTION_LABEL = 'AdventureTime — the dice'

export function createDiceInjection(deps: DiceInjectionDeps): InjectionProvider {
    const label = deps.label ?? DICE_INJECTION_LABEL

    return (context): Injection | null => {
        let settings: (RulebookSettings & DiceSettings) | null
        let memo: string | null | undefined
        try {
            settings = deps.settings(context.userId)
            memo = context.chatId ? deps.memo(context.chatId, context.userId) : null
        } catch {
            // A read that throws costs the dice, never the reply.
            return null
        }
        if (!settings) return null

        // The same engine limits the rulebook applies, so the queue and the
        // wording that describes it can never disagree.
        const effective = effectiveRulebookSettings(settings) as RulebookSettings & DiceSettings
        const text = buildDiceInjection(effective, memo, { random: deps.random, now: deps.now })
        if (!text.trim()) return null

        return { messages: [{ role: 'system', content: text.trimEnd() }], label }
    }
}
