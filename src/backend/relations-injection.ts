/**
 * The relationship standings in the narrator's prompt (Phase 44).
 *
 * The legacy injects `[NPC_RELATIONS]` right after `[PLAYER_CHARACTER]`,
 * before the pacing, the choices and the dice, so the narrator knows where it
 * stands with everyone before it writes. Same here, as its own system message
 * after the player. Synchronous, from memory, as every injection is: a record
 * not loaded yet costs one turn and warms the next, which the service does.
 */

import type { Injection, InjectionProvider } from './interceptor.js'

export interface RelationsInjectionDeps {
    /** The block, or `null` when the system is off or nothing is loaded yet. */
    block: (chatId: string, userId: string | undefined) => string | null
    label?: string
}

export const RELATIONS_INJECTION_LABEL = 'AdventureTime — the relations'

export function createRelationsInjection(deps: RelationsInjectionDeps): InjectionProvider {
    const label = deps.label ?? RELATIONS_INJECTION_LABEL
    return (context): Injection | null => {
        if (!context.chatId) return null
        let block: string | null
        try {
            block = deps.block(context.chatId, context.userId)
        } catch {
            // A read that throws costs the block, never the reply.
            return null
        }
        if (!block || !block.trim()) return null
        return { messages: [{ role: 'system', content: block }], label }
    }
}
