import { describe, expect, it } from 'vitest'

import { FACTORY_CARTRIDGE_DEFAULTS } from './factory-defaults.js'
import { ADVENTURETIME_FACTORY_OVERRIDES, getFactoryCartridgePayload } from './factory.js'

describe('the factory overrides (82)', () => {
    it('serves the relationship system on, over a generated file that still says off', () => {
        // The generated file is the legacy's own and is never hand-edited (rule 3a); the override is applied on the way out.
        expect((FACTORY_CARTRIDGE_DEFAULTS as Record<string, unknown>).npcRelationshipBars).toBe(false)
        expect(ADVENTURETIME_FACTORY_OVERRIDES).toEqual({ npcRelationshipBars: true })
        expect(getFactoryCartridgePayload().npcRelationshipBars).toBe(true)
    })

    it('changes nothing else, and hands out a copy', () => {
        const payload = getFactoryCartridgePayload()
        for (const [key, value] of Object.entries(FACTORY_CARTRIDGE_DEFAULTS as Record<string, unknown>)) {
            if (key in ADVENTURETIME_FACTORY_OVERRIDES) continue
            expect(payload[key], key).toEqual(value)
        }
        delete (payload.stockPrompts as Record<string, unknown>).character
        expect((getFactoryCartridgePayload().stockPrompts as Record<string, unknown>).character).toBeTypeOf('string')
    })
})
