import { describe, expect, it } from 'vitest'

import {
    RNG_QUEUE_LEN,
    RNG_QUEUE_LEN_D100,
    RNG_QUEUE_TAG_D100,
    RNG_QUEUE_TAG_D20,
    buildDiceInjection,
    buildRngBlock,
    formatRngQueueLine,
    isCombatActive,
    makeRngQueue,
    rollDie,
    shouldInjectQueue,
} from './dice.js'

/** A fixed sequence of "random" 32-bit values. */
const sequence = (...values: number[]) => {
    let i = 0
    return () => values[i++ % values.length]!
}

describe('one die', () => {
    it('lands on every face and never off the die', () => {
        const seen = new Set<number>()
        for (let i = 0; i < 2000; i++) {
            const r = rollDie(6)
            expect(r).toBeGreaterThanOrEqual(1)
            expect(r).toBeLessThanOrEqual(6)
            seen.add(r)
        }
        expect(seen.size).toBe(6)
    })

    it('maps the random value onto the face the legacy would', () => {
        expect(rollDie(20, sequence(0))).toBe(1)
        expect(rollDie(20, sequence(19))).toBe(20)
        expect(rollDie(20, sequence(20))).toBe(1)
    })

    // The last few values of the 32-bit range do not divide evenly by the
    // die, so they are thrown away rather than biasing the low faces.
    it('rejects a value past the fair limit and draws again', () => {
        const limit = Math.floor(4294967296 / 6) * 6
        expect(rollDie(6, sequence(limit, limit + 3, 4))).toBe(5)
    })
})

describe('the queue', () => {
    it('is twelve lines of six dice, or thirty of one', () => {
        const d20 = makeRngQueue(false)
        expect(d20).toHaveLength(RNG_QUEUE_LEN)
        expect(Object.keys(d20[0]!)).toEqual(['d20', 'd4', 'd6', 'd8', 'd10', 'd12'])
        const d100 = makeRngQueue(true)
        expect(d100).toHaveLength(RNG_QUEUE_LEN_D100)
        expect(Object.keys(d100[0]!)).toEqual(['d100'])
    })

    it('keeps every die on its own faces', () => {
        for (const line of makeRngQueue(false)) {
            if ('d100' in line) throw new Error('wrong flavour')
            expect(line.d4).toBeLessThanOrEqual(4)
            expect(line.d12).toBeLessThanOrEqual(12)
            expect(line.d20).toBeLessThanOrEqual(20)
        }
    })

    it('formats a line the way the rulebook describes it', () => {
        expect(formatRngQueueLine(3, { d20: 17, d4: 2, d6: 5, d8: 8, d10: 1, d12: 11 }))
            .toBe('3: d20=17 d4=2 d6=5 d8=8 d10=1 d12=11')
        expect(formatRngQueueLine(7, { d100: 42 })).toBe('7: d100=42')
    })

    it('wraps the block in the tag the rulebook names, with a turn id, and ends in a blank line', () => {
        const block = buildRngBlock([{ d20: 1, d4: 1, d6: 1, d8: 1, d10: 1, d12: 1 }], false, 1700000000000)
        expect(block).toBe(
            `${RNG_QUEUE_TAG_D20}\nturn_id=1700000000000\nscope=this_response\n1: d20=1 d4=1 d6=1 d8=1 d10=1 d12=1\n[/RNG_QUEUE]\n\n`,
        )
        const d100 = buildRngBlock([{ d100: 9 }], true, 5)
        expect(d100.startsWith(`${RNG_QUEUE_TAG_D100}\nturn_id=5\n`)).toBe(true)
        expect(d100.endsWith('\n[/RNG_QUEUE_d100]\n\n')).toBe(true)
    })

    it('is different every time', () => {
        expect(makeRngQueue(false)).not.toEqual(makeRngQueue(false))
    })
})

describe('combat', () => {
    it('is live only with a non-empty block that is not END_COMBAT', () => {
        expect(isCombatActive(null)).toBe(false)
        expect(isCombatActive('[HP]\n10/10\n[/HP]')).toBe(false)
        expect(isCombatActive('[COMBAT]\n\n[/COMBAT]')).toBe(false)
        expect(isCombatActive('[COMBAT]\nEND_COMBAT\n[/COMBAT]')).toBe(false)
        expect(isCombatActive('[COMBAT]\nRound 2: goblin 4/7\n[/COMBAT]')).toBe(true)
        expect(isCombatActive('[combat]\nx\n[/combat]')).toBe(true)
    })
})

describe('whether a turn gets a queue', () => {
    it('never, with the RNG off', () => {
        expect(shouldInjectQueue({ rngEnabled: false, rngQueueD20: true }, '[COMBAT]\nx\n[/COMBAT]')).toBe(false)
        expect(shouldInjectQueue({}, null)).toBe(false)
    })

    it('every turn in queue-only mode', () => {
        expect(shouldInjectQueue({ rngEnabled: true, diceFunctionTool: false }, null)).toBe(true)
    })

    it('only in combat in hybrid mode', () => {
        const hybrid = { rngEnabled: true, diceFunctionTool: true }
        expect(shouldInjectQueue(hybrid, null)).toBe(false)
        expect(shouldInjectQueue(hybrid, '[COMBAT]\nRound 1\n[/COMBAT]')).toBe(true)
    })
})

describe('the injected text', () => {
    const on = { rngEnabled: true, diceFunctionTool: false }

    it('is the d20 queue with the factory flags', () => {
        const text = buildDiceInjection({ ...on, rngQueueD20: true, rngQueueD100: false }, null, { now: () => 42 })
        expect(text.startsWith(`${RNG_QUEUE_TAG_D20}\nturn_id=42\n`)).toBe(true)
        expect(text.match(/^\d+: d20=/gm)).toHaveLength(RNG_QUEUE_LEN)
        expect(text).not.toContain('d100')
    })

    it('is both queues, d20 first, when both flags are on', () => {
        const text = buildDiceInjection({ ...on, rngQueueD20: true, rngQueueD100: true }, null, { now: () => 1 })
        expect(text.indexOf(RNG_QUEUE_TAG_D20)).toBeLessThan(text.indexOf(RNG_QUEUE_TAG_D100))
        expect(text.match(/^\d+: d100=/gm)).toHaveLength(RNG_QUEUE_LEN_D100)
    })

    it('is nothing when neither queue is asked for, or the RNG is off', () => {
        expect(buildDiceInjection({ ...on, rngQueueD20: false, rngQueueD100: false }, null)).toBe('')
        expect(buildDiceInjection({ rngEnabled: false, rngQueueD20: true }, null)).toBe('')
    })

    it('rolls from the random source it is given', () => {
        const a = buildDiceInjection({ ...on, rngQueueD20: true }, null, { now: () => 0, random: sequence(0) })
        const b = buildDiceInjection({ ...on, rngQueueD20: true }, null, { now: () => 0, random: sequence(0) })
        expect(a).toBe(b)
        expect(a).toContain('1: d20=1 d4=1 d6=1 d8=1 d10=1 d12=1')
    })
})
