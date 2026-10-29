/**
 * The formula roller and the tool's sentence against the pinned legacy build.
 *
 * `narrative-hooks.js` cannot be imported, so the roller, `doDiceRoll` and
 * `executeDiceToolAction` are sliced out and evaluated with the legacy's
 * surroundings stubbed: the settings getter, the random bytes, a SillyTavern
 * with no `droll` library (the tool path never needed it) and a silent
 * toastr. `src/state/dice-compare.js` is pure and imported as is.
 *
 *   MULTIHOG_CHECKOUT=/tmp/mh npx vitest run src/tracker/dice-formula.pin.test.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
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

const checkout = process.env.MULTIHOG_CHECKOUT
const available =
    !!checkout && existsSync(`${checkout}/narrative-hooks.js`) && existsSync(`${checkout}/src/state/dice-compare.js`)

type AnyFn = (...args: any[]) => any

/** Slice one top-level function -- exported or not -- out of a source file. */
function slice(source: string, name: string): string {
    const m = source.match(new RegExp(`^(?:export )?(?:async )?function ${name}\\(`, 'm'))
    if (!m || m.index === undefined) throw new Error(`no function ${name}`)
    const end = source.indexOf('\n}\n', m.index)
    return source.slice(m.index, end + 3).replace(/^\s*export /gm, '')
}

function lcg(seed: number): () => number {
    let x = seed >>> 0
    return () => {
        x = (Math.imul(x, 1664525) + 1013904223) >>> 0
        return x
    }
}

const FORMULAS = [
    '1d20', 'd20', '2d6', '2d6+3', '1d20+5-2', '2d20kh1', '2d20kl1', '4d6dl1', '4d6dh1', '3d8k2', '3d8d1',
    '1d20+1d4+10', '1d20-1d4', '2d6kh1-1', ' 1d20 + 7 ', '1d100', 'd100+5', '1d20+1d100',
    '1d20+1,1d20+1', 'nope, 2d6', 'nope, still no', 'roll high', '', '7', '7+3', '101d6', '0d6', '1d20+', 'custom',
]

describe.skipIf(!available)('the formula roller against the pinned legacy build', async () => {
    const hooks = available ? readFileSync(`${checkout}/narrative-hooks.js`, 'utf8') : ''
    const compare = available
        ? await import(pathToFileURL(`${checkout}/src/state/dice-compare.js`).href)
        : ({} as Record<string, AnyFn>)

    const legacy = (settings: Record<string, unknown>, random: () => number) =>
        (eval(`(function (getSettings, crypto, SillyTavern, toastr, resolveDiceCompare) {
            ${slice(hooks, 'rollDie')}
            ${slice(hooks, 'rollSingleGroup')}
            ${slice(hooks, 'parseAndRoll')}
            ${slice(hooks, 'sanitizeFormula')}
            ${slice(hooks, 'doDiceRoll')}
            ${slice(hooks, 'executeDiceToolAction')}
            return { rollSingleGroup, parseAndRoll, sanitizeFormula, doDiceRoll, executeDiceToolAction };
        })`) as AnyFn)(
            () => settings,
            { getRandomValues: (buf: Uint32Array) => { buf[0] = random(); return buf } },
            { libs: {}, getContext: () => ({ Popup: { show: { input: async () => '' } }, name1: 'You', sendSystemMessage() {} }) },
            { error() {}, warning() {} },
            compare.resolveDiceCompare,
        ) as Record<string, AnyFn>

    it('sliced the six functions', () => {
        const fns = legacy({}, lcg(1))
        for (const name of ['rollSingleGroup', 'parseAndRoll', 'sanitizeFormula', 'doDiceRoll', 'executeDiceToolAction']) {
            expect(typeof fns[name], name).toBe('function')
        }
    })

    it('rolls every group and formula the same', () => {
        for (const formula of FORMULAS) {
            for (const seed of [1, 2]) {
                const clean = formula.replace(/\s+/g, '')
                expect(rollSingleGroup(clean, lcg(seed)), formula).toEqual(legacy({}, lcg(seed)).rollSingleGroup!(clean))
                expect(parseAndRoll(formula, lcg(seed)), formula).toEqual(legacy({}, lcg(seed)).parseAndRoll!(formula))
                expect(sanitizeFormula(formula, lcg(seed)), formula).toBe(legacy({}, lcg(seed)).sanitizeFormula!(formula))
            }
        }
    })

    it('reads percentages the same', () => {
        for (const formula of FORMULAS) {
            expect(isPercentFormula(formula)).toBe(compare.isPercentFormula!(formula))
            for (const c of [undefined, '', 'gte', 'lte', 'GTE', 'sideways']) {
                expect(resolveDiceCompare(c, formula)).toBe(compare.resolveDiceCompare!(c, formula))
            }
        }
    })

    // `custom` opens a popup in the legacy, which the stub answers with
    // nothing; that path is not the tool's and is left out here.
    it('rolls a formula, or the fallback die, the same', async () => {
        for (const formula of FORMULAS.filter((f) => f !== 'custom')) {
            for (const d100Mode of [false, true]) {
                const ours = rollFormula(formula, { d100Mode, random: lcg(3) })
                const theirs = await legacy({ diceD100Mode: d100Mode }, lcg(3)).doDiceRoll!(formula, true)
                expect(ours, `${formula} d100=${d100Mode}`).toEqual(theirs)
            }
        }
    })

    it('writes the tool result sentence the same, word for word', async () => {
        const cases: Array<[Record<string, unknown>, Record<string, unknown>]> = [
            [{ who: 'Mara', for: 'perception', formula: '1d20+3', dc: 15 }, {}],
            [{ who: 'Mara', for: 'perception', formula: '1d20+3', dc: 15, compare: 'lte' }, {}],
            [{ who: 'GM', for: 'ambush', formula: '1d100', dc: 35 }, {}],
            [{ formula: '2d6' }, {}],
            [{ who: 'Mara', formula: 'many', dc: 12 }, {}],
            [{ who: 'Mara', formula: 'many', dc: 12 }, { d100Mode: true }],
            [{}, {}],
            [{ who: 'GM', for: 'hit', dc: 60 }, { defaultFormula: '1d100', forceLte: true }],
            [{ who: 'GM', for: 'hit', formula: '1d20', dc: 60 }, { defaultFormula: '1d100', forceLte: true }],
            [{ who: 'Mara', formula: '1d6' }, { isLegacy: true }],
            [{}, { isLegacy: true }],
            [{ who: 'Mara', formula: 'bad' }, { isLegacy: true }],
            [{ who: 'Mara', for: 'x', formula: '1d20+1,1d20+1', dc: 10 }, {}],
        ]
        for (const [args, opts] of cases) {
            for (const seed of [4, 5]) {
                const { d100Mode, ...toolOpts } = opts
                const ours = describeDiceRoll(args, { ...toolOpts, d100Mode: !!d100Mode, random: lcg(seed) })
                const theirs = await legacy({ diceD100Mode: !!d100Mode }, lcg(seed)).executeDiceToolAction!(args, toolOpts)
                expect(ours, JSON.stringify(args)).toBe(theirs)
            }
        }
    })
})
