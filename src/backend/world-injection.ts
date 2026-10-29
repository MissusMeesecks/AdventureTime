/**
 * Putting the world's reports into the story's prompt.
 *
 * The other half of World Progression: the pass files a report every in-world
 * day, and this hands the newest of them to the narrator, under the legacy's
 * heading, so the world outside the scene has somewhere to have been. Same
 * contract as the memo injection: synchronous, reads what is already in
 * memory or injects nothing, and never costs the generation a round trip.
 */

import { renderWorldReports } from '../tracker/world.js'
import type { Injection, InjectionProvider } from './interceptor.js'
import type { WorldRecord } from './world-store.js'

export interface WorldInjectionDeps {
    /** The chat's world record as it stands in memory, or nothing (rule 3f: the user is named). */
    state: (chatId: string, userId: string) => WorldRecord | undefined
    /** Whether World Progression is switched on for this user, from the preferences in memory. */
    enabled: (userId: string) => boolean
    label?: string
}

export const WORLD_INJECTION_LABEL = 'AdventureTime — the world'

export function createWorldInjection(deps: WorldInjectionDeps): InjectionProvider {
    const label = deps.label ?? WORLD_INJECTION_LABEL
    return (context): Injection | null => {
        let record: WorldRecord | undefined
        let on = false
        try {
            on = deps.enabled(context.userId)
            record = on ? deps.state(context.chatId, context.userId) : undefined
        } catch {
            // A read that throws costs the reports, never the reply.
            return null
        }
        // `record` is only read when the switch is on, so one test covers both.
        if (!record || record.activeReports.length === 0) return null
        const text = renderWorldReports(record.activeReports)
        if (!text) return null
        return { messages: [{ role: 'system', content: text }], label }
    }
}
