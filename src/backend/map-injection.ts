/**
 * Putting the hidden map into the story's prompt (roadmap row 9, Phase 34).
 *
 * Two blocks, as the legacy sends them: the index of every mapped site, so
 * the narrator never maps one twice, and -- while the party is inside a mapped
 * site, or for one turn when the user names one -- that site's map as GM
 * canon. Same contract as the memo injection: synchronous, reads what the
 * last sync left in memory or injects nothing, never a host round trip.
 */

import type { Injection, InjectionProvider } from './interceptor.js'
import type { MapRecord } from './map-store.js'

export interface MapInjectionDeps {
    state: (chatId: string, userId: string) => MapRecord | undefined
    label?: string
}

export const MAP_INJECTION_LABEL = 'AdventureTime — the map'

export function createMapInjection(deps: MapInjectionDeps): InjectionProvider {
    const label = deps.label ?? MAP_INJECTION_LABEL
    return (context): Injection | null => {
        let record: MapRecord | undefined
        try {
            record = deps.state(context.chatId, context.userId)
        } catch {
            return null
        }
        if (!record?.mappedSitesBlock && !record?.openerBrief) return null
        // The text opener's brief (46) rides after the canon while it is owed.
        const text = [record.mappedSitesBlock.trim(), record.canonBlock.trim(), String(record.openerBrief ?? '').trim()].filter(Boolean).join('\n\n')
        return { messages: [{ role: 'system', content: text }], label }
    }
}
