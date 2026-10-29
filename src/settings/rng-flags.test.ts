import { describe, expect, it } from 'vitest'

import { reconcileRngFlags, rngFlagsForMode } from './rng-flags.js'

describe('the four flags for a mode', () => {
    it('are all off with the RNG off', () => {
        expect(rngFlagsForMode({ rngEnabled: false, rngToolD20: true })).toEqual({
            rngToolD20: false, rngToolD100: false, rngQueueD20: false, rngQueueD100: false,
        })
    })

    it('are the one queue in queue-only mode', () => {
        expect(rngFlagsForMode({ rngEnabled: true, diceFunctionTool: false })).toEqual({
            rngToolD20: false, rngToolD100: false, rngQueueD20: true, rngQueueD100: false,
        })
        expect(rngFlagsForMode({ rngEnabled: true, diceFunctionTool: false, diceD100Mode: true })).toEqual({
            rngToolD20: false, rngToolD100: false, rngQueueD20: false, rngQueueD100: true,
        })
    })

    it('are the tool and the queue of one flavour in hybrid mode', () => {
        expect(rngFlagsForMode({ rngEnabled: true, diceFunctionTool: true })).toEqual({
            rngToolD20: true, rngToolD100: false, rngQueueD20: true, rngQueueD100: false,
        })
        expect(rngFlagsForMode({ rngEnabled: true, diceFunctionTool: true, diceD100Mode: true })).toEqual({
            rngToolD20: false, rngToolD100: true, rngQueueD20: false, rngQueueD100: true,
        })
    })
})

describe('what else a patch changes', () => {
    it('sets the flags when the mode changes', () => {
        expect(reconcileRngFlags({ rngEnabled: true, diceFunctionTool: true }, ['rngEnabled', 'diceFunctionTool']))
            .toEqual({ rngToolD20: true, rngToolD100: false, rngQueueD20: true, rngQueueD100: false })
    })

    it('sets the flags when d100 mode changes', () => {
        expect(reconcileRngFlags({ rngEnabled: true, diceFunctionTool: false, diceD100Mode: true }, ['diceD100Mode']))
            .toEqual({ rngToolD20: false, rngToolD100: false, rngQueueD20: false, rngQueueD100: true })
    })

    it('sets d100 mode from the flags when a flag changes', () => {
        expect(reconcileRngFlags({ rngToolD100: true }, ['rngToolD100'])).toEqual({ diceD100Mode: true })
        expect(reconcileRngFlags({ rngQueueD100: true, rngToolD100: false }, ['rngQueueD20'])).toEqual({ diceD100Mode: true })
        expect(reconcileRngFlags({ rngToolD20: true }, ['rngToolD20'])).toEqual({ diceD100Mode: false })
    })

    it('touches nothing for any other key', () => {
        expect(reconcileRngFlags({ rngEnabled: true }, ['loot', 'narrativePacing'])).toEqual({})
        expect(reconcileRngFlags({ rngEnabled: true }, [])).toEqual({})
    })
})
