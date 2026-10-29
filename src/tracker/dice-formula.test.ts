import { describe, expect, it } from 'vitest'

import {
    describeDiceRoll,
    isPercentFormula,
    parseAndRoll,
    resolveDiceCompare,
    rollFormula,
    rollSingleGroup,
    sanitizeFormula,
} from './dice-formula.js'

/** Random bits that land each die on the faces given, in order (face - 1 as the raw value). */
const faces = (...values: number[]) => {
    let i = 0
    return () => values[i++ % values.length]! - 1
}

describe('one die group', () => {
    it('rolls the count and sides asked for and sums them', () => {
        expect(rollSingleGroup('2d6', faces(3, 5))).toEqual({ kept: 8, rolls: [3, 5] })
        expect(rollSingleGroup('d20', faces(17))).toEqual({ kept: 17, rolls: [17] })
    })

    it('adds and subtracts flat modifiers', () => {
        expect(rollSingleGroup('1d20+5', faces(10))!.kept).toBe(15)
        expect(rollSingleGroup('1d20+5-2', faces(10))!.kept).toBe(13)
    })

    it('keeps the highest for advantage and the lowest for disadvantage', () => {
        expect(rollSingleGroup('2d20kh1', faces(4, 18))!.kept).toBe(18)
        expect(rollSingleGroup('2d20kl1', faces(4, 18))!.kept).toBe(4)
        expect(rollSingleGroup('2d20kh1', faces(4, 18))!.rolls).toEqual([4, 18])
    })

    it('drops the lowest for 4d6dl1, and the highest for dh', () => {
        expect(rollSingleGroup('4d6dl1', faces(1, 6, 3, 4))!.kept).toBe(13)
        expect(rollSingleGroup('4d6dh1', faces(1, 6, 3, 4))!.kept).toBe(8)
    })

    it('refuses what is not a die group, and more than a hundred dice', () => {
        expect(rollSingleGroup('20', faces(1))).toBeNull()
        expect(rollSingleGroup('1d20+', faces(1))).toBeNull()
        expect(rollSingleGroup('101d6', faces(1))).toBeNull()
        expect(rollSingleGroup('0d6', faces(1))).toBeNull()
    })
})

describe('a formula', () => {
    it('joins die groups and flat numbers with + and -', () => {
        expect(parseAndRoll('1d20+10+d4', faces(12, 3))).toEqual({ total: '25', rolls: ['12', '3'] })
        expect(parseAndRoll('10-1d4', faces(3))).toEqual({ total: '7', rolls: ['-3'] })
        expect(parseAndRoll('2d6kh1-1', faces(2, 5))).toEqual({ total: '4', rolls: ['2', '5'] })
    })

    // The legacy's own comment says `1d20+1d4+10` is "rolls 1d20, rolls 1d4,
    // adds flat 10". Its tokeniser reads it as `1d20+1` and `d4+10`: a die
    // group's trailing modifier swallows the count of the group after it, so
    // the dice are the same and the flats are not. Ported as is -- the pin
    // test holds it to the source -- and recorded here so nobody "fixes" the
    // port into disagreeing with the tool the narrator was trained on.
    it('reads a flat number after a die as that die\'s modifier, as the legacy does', () => {
        expect(parseAndRoll('1d20+1d4+10', faces(12, 3))).toEqual({ total: '26', rolls: ['12', '3'] })
        // `1d20-1d4` is `1d20-1` then `d4`: the d4 is added, not subtracted.
        expect(parseAndRoll('1d20-1d4', faces(12, 3))).toEqual({ total: '14', rolls: ['12', '3'] })
    })

    it('ignores whitespace', () => {
        expect(parseAndRoll(' 1d20 + 7 ', faces(1))!.total).toBe('8')
    })

    it('needs at least one die', () => {
        expect(parseAndRoll('7', faces(1))).toBeNull()
        expect(parseAndRoll('7+3', faces(1))).toBeNull()
    })

    it('is null for nonsense', () => {
        expect(parseAndRoll('roll high', faces(1))).toBeNull()
        expect(parseAndRoll('', faces(1))).toBeNull()
    })
})

describe('what a model sends', () => {
    it('takes the first segment of a comma-joined formula that rolls', () => {
        expect(sanitizeFormula('1d20+1,1d20+1', faces(1))).toBe('1d20+1')
        expect(sanitizeFormula('nope, 2d6', faces(1))).toBe('2d6')
        expect(sanitizeFormula('1d20', faces(1))).toBe('1d20')
        expect(sanitizeFormula('nope, still no', faces(1))).toBe('nope')
    })

    it('reads d100 formulas as percentages that roll under, everything else as over', () => {
        expect(isPercentFormula('1d100')).toBe(true)
        expect(isPercentFormula('d100+5')).toBe(true)
        expect(isPercentFormula('1d20+1d100')).toBe(false)
        expect(isPercentFormula('')).toBe(false)
        expect(resolveDiceCompare(undefined, '1d100')).toBe('lte')
        expect(resolveDiceCompare(undefined, '1d20+3')).toBe('gte')
        expect(resolveDiceCompare('GTE', '1d100')).toBe('gte')
        expect(resolveDiceCompare('lte', '1d20')).toBe('lte')
        expect(resolveDiceCompare('sideways', '1d20')).toBe('gte')
    })
})

describe('rolling a formula', () => {
    it('returns the parsed roll with its formula', () => {
        expect(rollFormula('2d6+1', { random: faces(3, 4) })).toEqual({ total: '8', rolls: ['3', '4'], formula: '2d6+1' })
    })

    // A zero would auto-fail any check, so nonsense still rolls one fair die.
    it('never returns zero: an invalid formula rolls one die and says so', () => {
        const out = rollFormula('roll high', { random: faces(14) })
        expect(out).toEqual({ total: '14', rolls: ['14'], formula: '1d20', invalidFormula: 'roll high' })
        const d100 = rollFormula('nope', { d100Mode: true, random: faces(77) })
        expect(d100.formula).toBe('1d100')
        expect(d100.total).toBe('77')
    })

    it('rolls nothing for an empty request, as the legacy does', () => {
        expect(rollFormula('  ', { random: faces(14) })).toEqual({ total: '', rolls: [] })
    })
})

describe('the sentence the narrator gets back', () => {
    it('names who, what for, the formula, the DC and the verdict', () => {
        expect(describeDiceRoll({ who: 'Mara', for: 'perception', formula: '1d20+3', dc: 15 }, { random: faces(6) }))
            .toBe('Mara (perception) rolls a 1d20+3 against DC 15. The result is: 9. Individual rolls: 6 (Result: FAILURE)')
        expect(describeDiceRoll({ who: 'Mara', for: 'perception', formula: '1d20+3', dc: 15 }, { random: faces(12) }))
            .toContain('(Result: SUCCESS)')
    })

    it('rolls under for a percentage check', () => {
        expect(describeDiceRoll({ who: 'GM', for: 'ambush', formula: '1d100', dc: 35 }, { random: faces(20) }))
            .toBe('GM (ambush) rolls a 1d100 against DC 35. The result is: 20. Individual rolls: 20 (Result: 20 ≤ 35% → HIT)')
        expect(describeDiceRoll({ formula: '1d20', dc: 10, compare: 'lte' }, { random: faces(11) }))
            .toBe('The result of a 1d20 roll against DC 10 is: 11. Individual rolls: 11 (Result: 11 ≤ 10% → MISS)')
    })

    it('states no verdict without a DC', () => {
        expect(describeDiceRoll({ who: 'Mara', formula: '2d6' }, { random: faces(2, 3) }))
            .toBe('Mara rolls a 2d6 against DC 0. The result is: 5. Individual rolls: 2, 3')
    })

    it('uses the default formula when none is given, and notes an invalid one', () => {
        expect(describeDiceRoll({}, { random: faces(9) })).toBe('The result of a 1d20 roll against DC 0 is: 9. Individual rolls: 9')
        expect(describeDiceRoll({ formula: 'many' }, { random: faces(9) }))
            .toContain('(requested formula "many" was invalid, defaulted to 1d20)')
    })

    it('always rolls under for the d100 tool, and defaults to 1d100 there', () => {
        expect(describeDiceRoll({ who: 'GM', for: 'hit', dc: 60 }, { defaultFormula: '1d100', forceLte: true, random: faces(60) }))
            .toContain('rolls a 1d100 against DC 60. The result is: 60. Individual rolls: 60 (Result: 60 ≤ 60% → HIT)')
    })

    it('uses the older wording for the legacy naming', () => {
        expect(describeDiceRoll({ who: 'Mara', formula: '1d6' }, { isLegacy: true, random: faces(4) }))
            .toBe('Mara rolls a 1d6. The result is: 4. Individual rolls: 4')
        expect(describeDiceRoll({}, { isLegacy: true, random: faces(4) })).toBe('The result of a 1d6 roll is: 4. Individual rolls: 4')
    })
})
