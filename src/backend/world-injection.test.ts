import { describe, expect, it } from 'vitest'

import { WORLD_INJECTION_HEADING } from '../tracker/world.js'
import { createWorldInjection, WORLD_INJECTION_LABEL } from './world-injection.js'
import { emptyWorldRecord, type WorldRecord } from './world-store.js'

const context = (over: Record<string, unknown> = {}) =>
    ({ userId: 'u1', chatId: 'c1', generationId: 'g1', isDryRun: false, ...over }) as never

const record = (reports: WorldRecord['activeReports']): WorldRecord => ({ ...emptyWorldRecord(), activeReports: reports })
const TWO = [
    { id: 'e1', reportId: 'W::1', label: 'Day 2, 08:00 AM', content: '## Morrowfen\nCalm.' },
    { id: 'e2', reportId: 'W::2', label: 'Day 3, 08:00 AM', content: '## Morrowfen\nStorm.' },
]

describe('injecting the world', () => {
    it('hands the narrator the active reports under the legacy heading, labelled', () => {
        const out = createWorldInjection({ state: () => record(TWO), enabled: () => true })(context())!
        expect(out.label).toBe(WORLD_INJECTION_LABEL)
        expect(out.messages).toHaveLength(1)
        expect(out.messages[0]!.role).toBe('system')
        expect(out.messages[0]!.content).toBe(`${WORLD_INJECTION_HEADING}\n### [Day 2, 08:00 AM]\n## Morrowfen\nCalm.\n\n### [Day 3, 08:00 AM]\n## Morrowfen\nStorm.`)
    })

    it('injects nothing while switched off, with no record, with no reports, or when a read throws', () => {
        expect(createWorldInjection({ state: () => record(TWO), enabled: () => false })(context())).toBeNull()
        expect(createWorldInjection({ state: () => undefined, enabled: () => true })(context())).toBeNull()
        expect(createWorldInjection({ state: () => record([]), enabled: () => true })(context())).toBeNull()
        expect(createWorldInjection({ state: () => { throw new Error('x') }, enabled: () => true })(context())).toBeNull()
    })

    it('reads the record for the chat and the user it is asked about', () => {
        const seen: string[] = []
        const provider = createWorldInjection({
            state: (chatId, userId) => { seen.push(`${chatId}/${userId}`); return record(TWO) },
            enabled: (userId) => { seen.push(`on?${userId}`); return true },
        })
        provider(context({ chatId: 'c9', userId: 'u9' }))
        expect(seen).toEqual(['on?u9', 'c9/u9'])
    })
})
