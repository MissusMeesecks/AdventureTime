/**
 * Putting the rulebook into the story's prompt.
 *
 * The sibling of `injection.ts`. The tracker memo has reached the narrator
 * since Phase 1b; from Phase 25 the maintainer's own sysprompt sections did
 * too; and from this phase the whole of Multihog's rulebook goes with them --
 * the 22 stock sections, the user's sections slotted in at their place in the
 * saved order, every `syspromptModules` switch honoured. Roadmap row: "The
 * narrator's rulebook".
 *
 * Same rules as the memo's injection, for the same reason -- this runs inside
 * the interceptor, where latency is silence before the first token. It reads
 * settings already in memory and assembles a string. No host calls, no awaits,
 * no work. Macro substitution happens one layer up, in the interceptor.
 */

import { buildRulebook, type RulebookSettings } from '../tracker/rulebook.js'
import type { Injection, InjectionProvider } from './interceptor.js'

export interface SyspromptInjectionDeps {
    /**
     * The settings as last loaded, synchronously, **for this user**.
     *
     * A function rather than a value because the user can switch a section on
     * mid-chat and the next reply should carry it -- and it takes the userId
     * because the install is operator-scoped and settings are stored per user
     * (rule 3f). Reading the wrong bag here would put one person's world rules
     * into another person's story.
     */
    settings: (userId: string) => RulebookSettings | null
    /**
     * The chat's memo as last loaded, for the in-combat dice switch: in
     * hybrid mode the narrator is told to call the tool outside combat and
     * to read the queue inside it. Optional so the seam tests stay small;
     * `backend.ts` passes it.
     */
    memo?: (chatId: string, userId: string) => string | null | undefined
    /** Attribution in Lumiverse's Prompt Breakdown. */
    label?: string
}

export const SYSPROMPT_INJECTION_LABEL = 'AdventureTime — the rulebook'

/**
 * No heading.
 *
 * Unlike the memo, which needs one because it is a data block the model has to
 * be told how to read, the rulebook opens with its own `<role>` and every
 * section wraps itself in a tag. Wrapping it in a AdventureTime heading would put
 * our voice above Multihog's, and above the user's.
 */
export function createSyspromptInjection(deps: SyspromptInjectionDeps): InjectionProvider {
    const label = deps.label ?? SYSPROMPT_INJECTION_LABEL

    return (context): Injection | null => {
        let settings: RulebookSettings | null
        let memo: string | null | undefined
        try {
            settings = deps.settings(context.userId)
            memo = deps.memo && context.chatId ? deps.memo(context.chatId, context.userId) : null
        } catch {
            // A settings read that throws costs the injection, never the reply.
            return null
        }
        if (!settings) return null

        const text = buildRulebook(settings, { memo: memo ?? undefined })
        if (!text.trim()) return null

        return { messages: [{ role: 'system', content: text }], label }
    }
}

/**
 * Every provider the interceptor serves, in prompt order.
 *
 * A seam, not a convenience. Lesson 19 has fired four times now: wiring that
 * lives only in `backend.ts` cannot have a test, and a mutation deleting it
 * leaves the suite green. The rulebook goes **before** the tracker state,
 * because it is standing instructions and the memo is this turn's facts —
 * the specific reads better last. The dice sit between: rolled for this
 * turn, but the rulebook is what says how to read them.
 */
export function stateInjectionProviders(deps: {
    memo: InjectionProvider
    sysprompt: InjectionProvider
    /** This turn's dice, between the standing rules and this turn's facts. */
    dice: InjectionProvider
    /** The Player Card (35b), at the top of the core block as the legacy has it: who the player is, before anything else. */
    player?: InjectionProvider
    /** The relationship standings (44), right after the player as the legacy's `[NPC_RELATIONS]` sits: before the choices and the dice. */
    relations?: InjectionProvider
    /** The choice instruction, above the dice as the legacy's bundle has it. */
    cyoa?: InjectionProvider
    /** The world's reports, after the memo: the legacy folds them in last (roadmap row 8). */
    world?: InjectionProvider
    /** The mapped sites and the active site's map, last: the legacy's depth injection sits nearest the reply (row 9). */
    map?: InjectionProvider
}): InjectionProvider[] {
    return [deps.sysprompt, ...(deps.player ? [deps.player] : []), ...(deps.relations ? [deps.relations] : []), ...(deps.cyoa ? [deps.cyoa] : []), deps.dice, deps.memo, ...(deps.world ? [deps.world] : []), ...(deps.map ? [deps.map] : [])]
}
