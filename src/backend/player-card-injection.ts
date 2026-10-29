/**
 * The Player Card in the narrator's prompt (roadmap row 10, Phase 35b).
 *
 * The legacy injects `[PLAYER_CHARACTER]` at the top of its core block on
 * every turn, before the memo, so the narrator knows who the player is before
 * it reads what the player has. Same here, as its own system message after
 * the rulebook. Synchronous, from memory, as every injection is: a card not
 * loaded yet costs one turn and warms the next.
 */

import { cardBlock } from '../tracker/creator.js'
import type { Injection, InjectionProvider } from './interceptor.js'
import type { PlayerCardRecord } from './player-card-store.js'

export interface PlayerCardInjectionDeps {
    state: (chatId: string, userId: string | undefined) => PlayerCardRecord | undefined
    /** Warm the cache for the next turn when nothing is loaded. Not awaited. */
    warm?: (chatId: string, userId: string | undefined) => Promise<unknown>
    label?: string
}

export const PLAYER_CARD_INJECTION_LABEL = 'AdventureTime — the player'

export function createPlayerCardInjection(deps: PlayerCardInjectionDeps): InjectionProvider {
    const label = deps.label ?? PLAYER_CARD_INJECTION_LABEL
    return (context): Injection | null => {
        if (!context.chatId) return null
        let record: PlayerCardRecord | undefined
        try {
            record = deps.state(context.chatId, context.userId)
        } catch {
            return null
        }
        if (!record) {
            void deps.warm?.(context.chatId, context.userId).catch(() => undefined)
            return null
        }
        const card = record.card
        if (!card || !card.bio.trim()) return null
        return { messages: [{ role: 'system', content: cardBlock(card.name, card.bio.trim()) }], label }
    }
}
