import { describe, expect, it } from 'vitest'

import { createMapInjection, MAP_INJECTION_LABEL } from './map-injection.js'
import { emptyMapRecord, type MapRecord } from './map-store.js'

const context = { chatId: 'c1', userId: 'u1' } as never

describe('the map injection', () => {
    it('sends the index and the canon as one system message, labelled, or nothing when the sync left nothing', () => {
        const record: MapRecord = { ...emptyMapRecord(), mappedSitesBlock: '[MAPPED_SITES — INTERNAL]\n- Abbey (DUNGEON)\n[/MAPPED_SITES]\n', canonBlock: '[DUNGEON_REALITY — INTERNAL GM CANON]\nSite: Abbey' }
        const inject = createMapInjection({ state: () => record })
        expect(inject(context)).toEqual({ label: MAP_INJECTION_LABEL, messages: [{ role: 'system', content: '[MAPPED_SITES — INTERNAL]\n- Abbey (DUNGEON)\n[/MAPPED_SITES]\n\n[DUNGEON_REALITY — INTERNAL GM CANON]\nSite: Abbey' }] })
        expect(createMapInjection({ state: () => ({ ...record, canonBlock: '' }) })(context)!.messages[0]!.content).toBe('[MAPPED_SITES — INTERNAL]\n- Abbey (DUNGEON)\n[/MAPPED_SITES]')
        expect(createMapInjection({ state: () => emptyMapRecord() })(context)).toBeNull()
        expect(createMapInjection({ state: () => undefined })(context)).toBeNull()
        expect(createMapInjection({ state: () => { throw new Error('no') } })(context)).toBeNull()
    })

    it('carries the text opener\'s brief after the canon while one is owed, even with no map read yet (46)', () => {
        const record: MapRecord = { ...emptyMapRecord(), mappedSitesBlock: '[MAPPED_SITES — INTERNAL]\n- Abbey (DUNGEON)\n[/MAPPED_SITES]', canonBlock: '[DUNGEON_REALITY — INTERNAL GM CANON]\nSite: Abbey', openerBrief: '[MAP_ARCHITECT_RESULT — PRIVATE]\nThe hidden map is attached.' }
        expect(createMapInjection({ state: () => record })(context)!.messages[0]!.content).toBe('[MAPPED_SITES — INTERNAL]\n- Abbey (DUNGEON)\n[/MAPPED_SITES]\n\n[DUNGEON_REALITY — INTERNAL GM CANON]\nSite: Abbey\n\n[MAP_ARCHITECT_RESULT — PRIVATE]\nThe hidden map is attached.')
        expect(createMapInjection({ state: () => ({ ...emptyMapRecord(), openerBrief: 'Failed.' }) })(context)!.messages[0]!.content).toBe('Failed.')
    })

    it('reads the record for the chat and user it is asked about', () => {
        const asked: unknown[] = []
        createMapInjection({ state: (chatId, userId) => { asked.push([chatId, userId]); return undefined } })(context)
        expect(asked).toEqual([['c1', 'u1']])
    })
})
