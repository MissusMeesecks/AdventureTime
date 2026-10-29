import { describe, expect, it } from 'vitest'

import { createDiceLog, summariseDiceCall } from './dice-log.js'

const AT = new Date('2026-09-13T13:02:00.000Z')

describe('summarising a call', () => {
    it('reads who, what for, the formula, the DC, the total and the verdict', () => {
        const rec = summariseDiceCall(
            { toolName: 'RollTheDice', args: { who: 'Poppy', for: 'Stealth', formula: '1d20+7', dc: 14 } },
            'Poppy (Stealth) rolls a 1d20+7 against DC 14. The result is: 24. Individual rolls: 17 (Result: SUCCESS)',
            AT,
        )
        expect(rec).toEqual({
            at: '2026-09-13T13:02:00.000Z', toolName: 'RollTheDice', who: 'Poppy', for: 'Stealth',
            formula: '1d20+7', dc: 14, total: 24, verdict: 'success',
        })
    })

    it('reads the anonymous wording, a percentage verdict, and a negative total', () => {
        expect(summariseDiceCall(
            { toolName: 'RollTheDiceD100', args: { formula: '1d100', dc: 35 } },
            'The result of a 1d100 roll against DC 35 is: 20. Individual rolls: 20 (Result: 20 ≤ 35% → HIT)',
            AT,
        )).toMatchObject({ who: '', for: '', total: 20, verdict: 'hit' })
        expect(summariseDiceCall(
            { toolName: 'RollTheDice', args: { for: 'luck', formula: '1d4-6' } },
            'The result (luck) of a 1d4-6 roll against DC 0 is: -3. Individual rolls: 3',
            AT,
        )).toMatchObject({ dc: null, total: -3, verdict: null })
    })

    it('tells a failure from a success, and a miss from a hit', () => {
        const rec = (result: string) => summariseDiceCall({ toolName: 'RollTheDice', args: {} }, result, AT).verdict
        expect(rec('Poppy rolls a 1d20 against DC 15. The result is: 9. Individual rolls: 9 (Result: FAILURE)')).toBe('failure')
        expect(rec('The result of a 1d100 roll against DC 35 is: 80. Individual rolls: 80 (Result: 80 ≤ 35% → MISS)')).toBe('miss')
    })

    it('survives missing or odd args', () => {
        expect(summariseDiceCall({ toolName: 'RollTheDice', args: undefined as never }, 'nonsense', AT))
            .toMatchObject({ who: '', formula: '', dc: null, total: null, verdict: null })
        expect(summariseDiceCall({ toolName: 'RollTheDice', args: { dc: 'twelve' } }, '', AT).dc).toBeNull()
        // The tool treats a DC of zero as "no DC" and gives no verdict, so the
        // line must not show "vs DC 0".
        expect(summariseDiceCall({ toolName: 'RollTheDice', args: { dc: 0 } }, '', AT).dc).toBeNull()
    })
})

describe('this reply\'s calls', () => {
    it('collects the calls since the reply began, and starts over on the next', () => {
        const log = createDiceLog(() => AT)
        const call = (who: string) => log.record({ toolName: 'RollTheDice', args: { who, formula: '1d20' } }, `${who} rolls a 1d20 against DC 0. The result is: 5. Individual rolls: 5`)
        call('A')
        log.beginTurn()
        call('B')
        call('C')
        expect(log.turn().map((c) => c.who)).toEqual(['B', 'C'])
        expect(log.count()).toBe(3)
        log.beginTurn()
        expect(log.turn()).toEqual([])
        expect(log.last()!.who).toBe('C')
    })

    it('hands out a copy, not the list itself', () => {
        const log = createDiceLog(() => AT)
        log.record({ toolName: 'RollTheDice', args: {} }, 'The result of a 1d20 roll against DC 0 is: 5. Individual rolls: 5')
        log.turn().length = 0
        expect(log.turn()).toHaveLength(1)
    })
})

describe('the log', () => {
    it('counts calls and keeps the last', () => {
        let n = 0
        const log = createDiceLog(() => new Date(AT.getTime() + n++ * 1000))
        expect(log.count()).toBe(0)
        expect(log.last()).toBeUndefined()
        log.record({ toolName: 'RollTheDice', args: { who: 'A', formula: '1d20' } }, 'A rolls a 1d20 against DC 0. The result is: 5. Individual rolls: 5')
        const second = log.record({ toolName: 'RollTheDice', args: { who: 'B', formula: '1d20' } }, 'B rolls a 1d20 against DC 0. The result is: 9. Individual rolls: 9')
        expect(log.count()).toBe(2)
        expect(log.last()).toBe(second)
        expect(log.last()!.who).toBe('B')
        expect(log.last()!.at).toBe('2026-09-13T13:02:01.000Z')
    })
})
