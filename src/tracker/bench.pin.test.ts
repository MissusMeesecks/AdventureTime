/**
 * Benching against the pinned legacy build.
 *
 * The benching half of `memo-processor.js` is sliced out of the source and
 * evaluated with its one dependency stubbed (the settings getter, module on),
 * then every function is run over the same cases as the port.
 *
 *   MULTIHOG_CHECKOUT=/tmp/mh npx vitest run src/tracker/bench.pin.test.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
    applyBenchCommands,
    compactBenchedPartyForContext,
    dedupePartyAgainstBenched,
    extractBenchCommands,
    hydratePartyRelocationStats,
    isBenchCommandOnlyContent,
    splitPartyMemberEntries,
} from './bench.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && existsSync(`${checkout}/memo-processor.js`)
type AnyFn = (...args: any[]) => any

const GARETH = '- Gareth (Fighter 3): 28/30 HP\nCombat: BAB: +3 | Melee: +5 | Base AC: 14 | Total AC: 16\nGear: Longsword (1d8+3)\nStatus: Healthy'
const ROBIN = '- Robin Fletcher (Rogue 2): 18/18 HP\nCombat: BAB: +1 | Ranged: +5\nStatus: (+) Blessed (+1d4 saves, 1h)'
const MARKED = '- Alice: ((BAR)) 100/100 HP\nCombat: BAB: +0\nStatus: Healthy'
const PRIOR = `[TIME]\n06:15 AM, Day 4\n[/TIME]\n\n[PARTY]\n${GARETH}\n${ROBIN}\n[/PARTY]`
const PRIOR_NO_TIME = `[PARTY]\n${GARETH}\n[/PARTY]`
const BENCHED_GARETH = GARETH.replace('Status: Healthy', 'Status: Benched (06:15 AM, Day 4, resting)')
const PRIOR_BENCHED = `[TIME]\n07:00 AM, Day 4\n[/TIME]\n\n[PARTY]\n${ROBIN}\n[/PARTY]\n\n[BENCHED PARTY]\n${BENCHED_GARETH}\n[/BENCHED PARTY]`
const BOTH = `[PARTY]\n${GARETH}\n${ROBIN}\n[/PARTY]\n\n[BENCHED PARTY]\n${BENCHED_GARETH}\n[/BENCHED PARTY]`

const MEMOS = [PRIOR, PRIOR_NO_TIME, PRIOR_BENCHED, BOTH, '', 'no blocks', `[PARTY]\n${MARKED}\n[/PARTY]`, '[BENCHED PARTY]\nREMOVED\n[/BENCHED PARTY]', '[PARTY]\nsome custom roster format\n[/PARTY]']
const COMMANDS = [
    { benches: [{ name: 'Gareth', reason: 'stayed to rest' }], unbenches: [] },
    { benches: [{ name: 'Robin', reason: '' }], unbenches: [] },
    { benches: [{ name: 'Robin Fletcher (Rogue 2)', reason: 'captured' }], unbenches: [] },
    { benches: [{ name: 'Nobody', reason: 'x' }], unbenches: [] },
    { benches: [], unbenches: ['Gareth'] },
    { benches: [], unbenches: ['gareth (fighter 3)'] },
    { benches: [{ name: 'Gareth', reason: 'away' }], unbenches: ['Robin'] },
    { benches: [{ name: 'Alice', reason: 'ill' }], unbenches: [] },
    { benches: [], unbenches: [] },
]
const OUTPUTS = [
    '[BENCHED PARTY]\n[BENCH] Gareth — stayed to rest\n[UNBENCH] Robin\n[/BENCHED PARTY]',
    '- [BENCH] Gareth - resting',
    '[BENCH] Gareth',
    '[BENCH] Robin — scouting — ETA: Day 4, 12:00',
    '[UNBENCH]Gareth',
    'nothing here',
    '',
]
const CONTENTS = ['[BENCH] Gareth — resting\n- [UNBENCH] Robin', '- Gareth: Benched (resting)', 'REMOVED', '', '[BENCH] Gareth\nnot a command', `${GARETH}\n${ROBIN}`, MARKED, 'Combat: BAB +1\nStatus: x']
const MERGED = [
    PRIOR_BENCHED.replace(BENCHED_GARETH, '- Gareth (Fighter 3): Benched (07:00 AM, Day 4, still resting)'),
    `[PARTY]\n${ROBIN}\n- Gareth (Fighter 3): 28/30 HP\n[/PARTY]`,
    '[PARTY]\nsome custom roster format\n[/PARTY]',
    '[BENCHED PARTY]\n- Gareth: Benched\n[/BENCHED PARTY]',
    '[PARTY]\nREMOVED\n[/PARTY]',
    '',
]

describe.skipIf(!available)('benching against the pinned legacy build', () => {
    const source = available ? readFileSync(`${checkout}/memo-processor.js`, 'utf8') : ''
    const slice = (from: string, to: string): string => {
        const start = source.indexOf(from)
        const end = source.indexOf(to, start)
        if (start === -1 || end === -1) throw new Error(`memo-processor.js no longer contains: ${from}`)
        return source.slice(start, end)
    }
    const legacy = available
        ? (eval(`(function () {
            const getSettings = () => ({ debugMode: false, modules: { 'benched party': true, party: true } });
            ${slice('export function escapeRegex', 'export function escapeHtml').replace(/^\s*export /gm, '')}
            ${slice('export function extractCurrentTimeStr', '\n}\n').replace(/^\s*export /gm, '')}
            }
            ${slice('// ── Benched Party', 'export function memoForTrackerContext').replace(/^\s*export /gm, '')}
            return { extractBenchCommands, isBenchCommandOnlyContent, splitPartyMemberEntries, applyBenchCommands, hydratePartyRelocationStats, compactBenchedPartyForContext, dedupePartyAgainstBenched };
        })`)() as Record<string, AnyFn>)
        : ({} as Record<string, AnyFn>)

    it('sliced the seven functions', () => {
        for (const name of ['extractBenchCommands', 'isBenchCommandOnlyContent', 'splitPartyMemberEntries', 'applyBenchCommands', 'hydratePartyRelocationStats', 'compactBenchedPartyForContext', 'dedupePartyAgainstBenched']) {
            expect(typeof legacy[name], name).toBe('function')
        }
    })

    it('reads commands and command-only blocks the same', () => {
        for (const o of OUTPUTS) expect(extractBenchCommands(o), o).toEqual(legacy.extractBenchCommands!(o))
        for (const c of CONTENTS) expect(isBenchCommandOnlyContent(c), c).toBe(legacy.isBenchCommandOnlyContent!(c))
    })

    it('splits member entries the same', () => {
        for (const c of CONTENTS) expect(splitPartyMemberEntries(c), c).toEqual(legacy.splitPartyMemberEntries!(c))
    })

    it('applies every command to every memo the same', () => {
        for (const prior of MEMOS) for (const memo of MEMOS) for (const cmd of COMMANDS) {
            expect(applyBenchCommands(prior, memo, cmd), JSON.stringify({ prior, memo, cmd })).toBe(legacy.applyBenchCommands!(prior, memo, cmd))
        }
    })

    it('hydrates, compacts and dedupes the same', () => {
        for (const prior of MEMOS) for (const merged of [...MEMOS, ...MERGED]) {
            expect(hydratePartyRelocationStats(prior, merged), JSON.stringify({ prior, merged })).toBe(legacy.hydratePartyRelocationStats!(prior, merged))
        }
        for (const m of [...MEMOS, ...MERGED]) {
            expect(compactBenchedPartyForContext(m), m).toBe(legacy.compactBenchedPartyForContext!(m))
            expect(dedupePartyAgainstBenched(m), m).toBe(legacy.dedupePartyAgainstBenched!(m))
        }
    })
})
