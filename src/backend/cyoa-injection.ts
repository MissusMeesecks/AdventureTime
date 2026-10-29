/**
 * Putting the CYOA instruction into the story's prompt.
 *
 * Between the rulebook and the dice, as the legacy's interceptor bundle has it
 * (`narrative-hooks.js`: pacing → CYOA → RNG queue → memo). The legacy never
 * puts `<CYOA_mode>` in the main prompt; it is its own every-turn message, and
 * the rulebook here leaves the section out for the same reason (Phase 26).
 * Roadmap row 6.
 *
 * Same contract as the other providers: synchronous, reads what is in memory,
 * injects nothing rather than waiting. The block is built from `cyoaConfig`
 * every turn, so an edit to the slots reaches the next reply; the `{{user}}`
 * in a custom slot is the interceptor's macro step, like any injected text.
 */

import { buildCyoaModeBlock, type CyoaConfig } from '../tracker/cyoa.js'
import { applyTextOpenerCyoaCaveat, isTextOpener } from '../tracker/opener.js'
import { isBaseSectionEnabled, isCyoaActive, MAPPING_SECTION_TAG, type RulebookSettings } from '../tracker/rulebook.js'
import type { Injection, InjectionProvider } from './interceptor.js'

export interface CyoaInjectionDeps {
    /** The settings as last loaded, synchronously, for this user (rule 3f). */
    settings: (userId: string) => RulebookSettings | null
    /** Attribution in Lumiverse's Prompt Breakdown. */
    label?: string
}

export const CYOA_INJECTION_LABEL = 'AdventureTime — the choices'

export function createCyoaInjection(deps: CyoaInjectionDeps): InjectionProvider {
    const label = deps.label ?? CYOA_INJECTION_LABEL

    return (context): Injection | null => {
        let settings: RulebookSettings | null
        try {
            settings = deps.settings(context.userId)
        } catch {
            // A read that throws costs the choices, never the reply.
            return null
        }
        if (!settings || !isCyoaActive(settings)) return null

        let text = buildCyoaModeBlock((settings.cyoaConfig as CyoaConfig | undefined) ?? {})
        // The text opener's exception (46), as the legacy prepends it: on the
        // block's turn, "always end with choices" must not win.
        if (isTextOpener(settings) && isBaseSectionEnabled(MAPPING_SECTION_TAG, settings)) text = applyTextOpenerCyoaCaveat(text)
        return { messages: [{ role: 'system', content: text }], label }
    }
}
