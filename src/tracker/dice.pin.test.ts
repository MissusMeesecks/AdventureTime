/**
 * The dice queue against the pinned legacy build.
 *
 * `narrative-hooks.js` cannot be imported -- it reaches for SillyTavern at
 * module scope -- so the RNG engine's functions are sliced out of its source
 * and evaluated with the two things they touch stubbed: the settings getter
 * and the platform's random bytes. With the same random sequence on both
 * sides the queues, lines and blocks must be byte-identical.
 *
 *   MULTIHOG_CHECKOUT=/tmp/mh npx vitest run src/tracker/dice.pin.test.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
    buildRngBlock,
    formatRngQueueLine,
    isCombatActive,
    makeRngQueue,
    rollDie,
} from './dice.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available =
    !!checkout && existsSync(`${checkout}/narrative-hooks.js`) && existsSync(`${checkout}/llm-client.js`)

type AnyFn = (...args: any[]) => any

function slice(source: string, name: string): string {
    const start = source.indexOf(`export function ${name}(`)
    if (start < 0) throw new Error(`no export function ${name}`)
    const end = source.indexOf('\n}\n', start)
    return source.slice(start, end + 3).replace(/^\s*export /gm, '')
}

/** A deterministic 32-bit sequence both sides draw from. */
function lcg(seed: number): () => number {
    let x = seed >>> 0
    return () => {
        x = (Math.imul(x, 1664525) + 1013904223) >>> 0
        return x
    }
}

describe.skipIf(!available)('the dice queue against the pinned legacy build', () => {
    const hooks = available ? readFileSync(`${checkout}/narrative-hooks.js`, 'utf8') : ''
    const llm = available ? readFileSync(`${checkout}/llm-client.js`, 'utf8') : ''
    const constants = available
        ? (hooks.match(/^export const RNG_QUEUE_[A-Z0-9_]+ = .*$/gm) ?? []).map((l) => l.replace(/^export /, '')).join('\n')
        : ''

    const legacy = (settings: Record<string, unknown>, random: () => number, now = 0) =>
        (eval(`(function (getSettings, crypto, Date) {
            ${constants}
            ${slice(hooks, 'rollDie')}
            ${slice(hooks, 'makeRngQueue')}
            ${slice(hooks, 'formatRngQueueLine')}
            ${slice(hooks, 'buildRngBlock')}
            ${slice(llm, 'isCombatActive')}
            return { rollDie, makeRngQueue, formatRngQueueLine, buildRngBlock, isCombatActive, RNG_QUEUE_LEN, RNG_QUEUE_TAG_D20, RNG_QUEUE_TAG_D100 };
        })`) as AnyFn)(
            () => settings,
            { getRandomValues: (buf: Uint32Array) => { buf[0] = random(); return buf } },
            { now: () => now },
        ) as Record<string, AnyFn> & { RNG_QUEUE_LEN: number; RNG_QUEUE_TAG_D20: string; RNG_QUEUE_TAG_D100: string }

    it('sliced the four functions and the constants', () => {
        const fns = legacy({}, lcg(1))
        expect(fns.RNG_QUEUE_LEN).toBe(12)
        expect(fns.RNG_QUEUE_TAG_D20).toBe('[RNG_QUEUE v7.0]')
        expect(fns.RNG_QUEUE_TAG_D100).toBe('[RNG_QUEUE_d100 v7.0]')
    })

    it('rolls the same face from the same bits, rejection included', () => {
        for (const sides of [4, 6, 8, 10, 12, 20, 100]) {
            const ours = lcg(sides)
            const theirs = lcg(sides)
            const fns = legacy({}, theirs)
            for (let i = 0; i < 500; i++) expect(rollDie(sides, ours)).toBe(fns.rollDie!(sides))
        }
        // Values at the top of the range are rejected on both sides.
        const top = 4294967295
        const seq = () => { let n = 0; return () => (n++ < 2 ? top : 7) }
        expect(rollDie(6, seq())).toBe(legacy({}, seq()).rollDie!(6))
    })

    it('builds the same queue for both flavours, as the interceptor calls it', () => {
        for (const seed of [1, 2, 3]) {
            expect(makeRngQueue(false, { random: lcg(seed) })).toEqual(legacy({}, lcg(seed)).makeRngQueue!(12, false))
            expect(makeRngQueue(true, { random: lcg(seed) })).toEqual(legacy({}, lcg(seed)).makeRngQueue!(30, true))
        }
        // The legacy's default length falls out of the d100 flag the same way.
        expect(legacy({ diceD100Mode: true }, lcg(9)).makeRngQueue!(undefined, undefined)).toHaveLength(30)
        expect(makeRngQueue(true, { random: lcg(9) })).toHaveLength(30)
    })

    it('formats lines and blocks identically', () => {
        const fns = legacy({}, lcg(5), 1700000000000)
        const d20 = makeRngQueue(false, { random: lcg(5) })
        const d100 = makeRngQueue(true, { random: lcg(6) })
        d20.forEach((line, i) => expect(formatRngQueueLine(i + 1, line)).toBe(fns.formatRngQueueLine!(i + 1, line, false)))
        d100.forEach((line, i) => expect(formatRngQueueLine(i + 1, line)).toBe(fns.formatRngQueueLine!(i + 1, line, true)))
        expect(buildRngBlock(d20, false, 1700000000000)).toBe(fns.buildRngBlock!(d20, false))
        expect(buildRngBlock(d100, true, 1700000000000)).toBe(fns.buildRngBlock!(d100, true))
    })

    it('reads combat from the memo the same way', () => {
        const fns = legacy({}, lcg(1))
        for (const memo of [
            null, '', '[HP]\n1\n[/HP]', '[COMBAT]\n[/COMBAT]', '[COMBAT]\n  \n[/COMBAT]',
            '[COMBAT]\nEND_COMBAT\n[/COMBAT]', '[COMBAT]\nend_combat\n[/COMBAT]', '[COMBAT]\nRound 1\n[/COMBAT]',
            '[combat]\nx\n[/combat]', '[COMBAT]\nEND_COMBAT extra\n[/COMBAT]',
        ]) {
            expect(isCombatActive(memo)).toBe(fns.isCombatActive!(memo))
        }
    })
})
