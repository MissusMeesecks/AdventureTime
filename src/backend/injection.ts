/**
 * Putting the memo into the story's prompt.
 *
 * This is the other half of the loop: the pass writes state after each turn,
 * and this hands that state to the next generation, so the narrative model
 * knows what it established a hundred turns ago.
 *
 * It runs inside the interceptor, which is the one place in this extension
 * where latency is visible to the user as silence before the first token — so
 * it is **synchronous and does no work**. It reads a memo that is already in
 * memory or it injects nothing. Missing one turn's injection costs a little
 * continuity; holding the generation open costs the user their patience.
 *
 * A miss also warms the cache for next time. That read is deliberately not
 * awaited: it is a side effect for the following turn, not this one.
 */

import { memoForNarrativeContext } from '../tracker/prompt.js'
import type { Injection, InjectionProvider, LogApi } from './interceptor.js'
import type { MemoStore } from './memo-store.js'

export interface MemoInjectionDeps {
    memos: MemoStore
    log: LogApi
    /** Heading the memo is injected under. */
    heading?: string
    /** Attribution in Lumiverse's Prompt Breakdown. */
    label?: string
}

export const DEFAULT_INJECTION_HEADING = '## CURRENT STATE'
export const DEFAULT_INJECTION_LABEL = 'AdventureTime — tracker state'

/**
 * Build the interceptor's injection provider.
 *
 * The memo goes in with its display markers removed: `((BARCYAN))` is an
 * instruction to the card renderer and noise to a storyteller, so injecting it
 * would spend tokens to make the prompt worse.
 */
export function createMemoInjection(deps: MemoInjectionDeps): InjectionProvider {
    const heading = deps.heading ?? DEFAULT_INJECTION_HEADING
    const label = deps.label ?? DEFAULT_INJECTION_LABEL

    return (context): Injection | null => {
        const { chatId, userId } = context
        if (!chatId) return null

        const record = deps.memos.snapshot(chatId, userId)
        if (!record) {
            // Not loaded yet — first turn after a restart, usually. Warm it for
            // next time and inject nothing now. Deliberately not awaited.
            void deps.memos.load(chatId, userId).catch(() => undefined)
            return null
        }

        const text = memoForNarrativeContext(record.memo)
        if (!text.trim()) return null

        return {
            messages: [{ role: 'system', content: `${heading}\n${text}` }],
            label,
        }
    }
}
