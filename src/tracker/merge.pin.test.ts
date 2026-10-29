/**
 * The memo merge, differentially tested against the legacy build itself.
 *
 * `mergeMemo` decides what survives a turn, so "we believe this matches" is not
 * good enough. This rebuilds the legacy `deduplicateMemo` and `mergeMemo`
 * straight out of `memo-processor.js` at the pinned commit and runs both
 * implementations over a corpus of tracker outputs — ordinary updates, the
 * refusals and truncations that must change nothing, and the erasure spellings.
 *
 * One of the legacy function's extension points is stubbed out here, because
 * it is a feature not ported and the port says so: `partitionResolvedCombatants`
 * (defeated-combatant archiving, stubbed to pass content through). Benching
 * was stubbed too until Phase 29 ported it; now the legacy's own bench
 * functions are sliced in and the corpus is run twice, with the module on and
 * off, against the port's `bench` option.
 *
 * Opt-in, like `markers.pin.test.ts`. To run it:
 *
 *   git clone --filter=blob:none \
 *     https://github.com/MultihogAurelius/SillyTavern-MultihogDnDFramework /tmp/mh
 *   git -C /tmp/mh checkout d6aab004f97f1f9a286f235de62f22ba1abadbe8
 *   MULTIHOG_CHECKOUT=/tmp/mh npx vitest run src/tracker/merge.pin.test.ts
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { deduplicateMemo, mergeMemo } from './merge.js'

const PINNED_COMMIT = 'd6aab004f97f1f9a286f235de62f22ba1abadbe8'
const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && existsSync(`${checkout}/memo-processor.js`)

describe.skipIf(!available)('the memo merge against the pinned legacy build', () => {
    const source = available ? readFileSync(`${checkout}/memo-processor.js`, 'utf8') : ''

    const slice = (from: string, to: string): string => {
        const start = source.indexOf(from)
        const end = source.indexOf(to, start)
        if (start === -1 || end === -1) throw new Error(`memo-processor.js no longer contains: ${from}`)
        return source.slice(start, end)
    }

    /** The legacy functions, benching on or off, with the unported extension point stubbed. */
    const build = (bench: boolean): { mergeMemo(a: string, b: string): string; deduplicateMemo(m: string): string } => {
        if (!available) return { mergeMemo: () => '', deduplicateMemo: () => '' }
        const body = [
            slice('export function escapeRegex', 'export function escapeHtml'),
            slice('export function extractCurrentTimeStr', '\n}\n') + '\n}\n',
            slice('export function deduplicateMemo', '// ── Memo merge ─'),
            slice('export function mergeMemo', '/**\n * Writes a quest array'),
            slice('// ── Benched Party', 'export function memoForTrackerContext'),
        ]
            .join('\n')
            .replace(/^\s*export /gm, '')

        return eval(`(function () {
            const getSettings = () => ({ debugMode: false, modules: { 'benched party': ${bench}, party: ${bench} } });
            const partitionResolvedCombatants = (content) => ({ activeContent: content, defeatedCombatants: [] });
            ${body}
            return { mergeMemo, deduplicateMemo };
        })`)()
    }
    const legacy = build(false)
    const legacyBench = build(true)

    const PRIOR = [
        '[TIME]',
        '06:15 AM, Day 4',
        '[/TIME]',
        '',
        '[WAYSTONE]',
        'Attunement: ((BARCYAN)) 640/1000 (Harmonious)',
        'Steward: Odile',
        '[/WAYSTONE]',
        '',
        '[SECRETS]',
        '- 🔑 [Knowledge] The spare key under the well bucket',
        '[/SECRETS]',
    ].join('\n')

    /** Outputs a tracker pass really produces, good and bad. */
    const OUTPUTS = [
        // Ordinary single-block updates.
        '[TIME]\n07:00 AM, Day 4\n[/TIME]',
        '[WAYSTONE]\nAttunement: ((BARCYAN)) 700/1000 (Harmonious)\nSteward: Corin\n[/WAYSTONE]',
        // A block the prior memo does not have.
        '[XP]\n((XPBAR)) 450/1000 Level 3\n[/XP]',
        // Several at once, mixed new and existing.
        '[TIME]\n08:00 AM, Day 4\n[/TIME]\n[XP]\n1/2\n[/XP]\n[WAYSTONE]\nSteward: Corin\n[/WAYSTONE]',
        // Every erasure spelling, plus the empty pair.
        '[SECRETS]\nREMOVED\n[/SECRETS]',
        '[SECRETS]\nCLEARED\n[/SECRETS]',
        '[SECRETS]\nNONE\n[/SECRETS]',
        '[SECRETS]\nEXPIRED\n[/SECRETS]',
        '[SECRETS]\nremoved\n[/SECRETS]',
        '[SECRETS]\n[/SECRETS]',
        '[COMBAT]\nEND_COMBAT\n[/COMBAT]',
        // Erasing something that was never there.
        '[NOSUCHBLOCK]\nREMOVED\n[/NOSUCHBLOCK]',
        // The answers that must change nothing.
        '',
        'No changes this turn.',
        'I cannot help with that request.',
        '[TIME]\n07:00 AM, Day 4',
        '[/TIME]\n07:00',
        // Duplicates within one output.
        '[TIME]\nfirst\n[/TIME]\n[TIME]\nsecond\n[/TIME]',
        // Prose wrapped around a real block.
        'Here is the update you asked for:\n[TIME]\n09:00 AM, Day 4\n[/TIME]\nLet me know if you need more.',
        // Regex metacharacters in the content — the replacement must be literal.
        '[WAYSTONE]\nSteward: $& $1 $` cost: $100\n[/WAYSTONE]',
        // A tag with a space in it, which the dedupe scan deliberately misses.
        '[BENCHED PARTY]\nAnsel\n[/BENCHED PARTY]',
        // Underscored custom tags, as the golden cartridge uses.
        '[MORALE_INDEX]\n((BAR)) 420/1000\n[/MORALE_INDEX]',
        // Case that does not match the stored block's case.
        '[time]\n10:00 AM, Day 4\n[/time]',
        // Benching, as the tracker emits it (Phase 29): commands in a block, a
        // command with a bullet and no block, a bench and an unbench together,
        // a compact re-emission, a bare-header return to the party.
        '[BENCHED PARTY]\n[BENCH] Gareth — stayed at the lodging to rest\n[/BENCHED PARTY]',
        '- [BENCH] Robin — scouting ahead — ETA: Day 4, 12:00',
        '[BENCHED PARTY]\n[UNBENCH] Gareth\n[/BENCHED PARTY]',
        '[BENCHED PARTY]\n[BENCH] Gareth — away\n[UNBENCH] Robin\n[/BENCHED PARTY]\n[TIME]\n08:00 AM, Day 4\n[/TIME]',
        '[BENCHED PARTY]\n- Gareth (Fighter 3): Benched (07:00 AM, Day 4, still resting)\n[/BENCHED PARTY]',
        '[PARTY]\n- Robin Fletcher (Rogue 2): 18/18 HP\nCombat: BAB: +1\nStatus: Healthy\n- Gareth (Fighter 3): 28/30 HP\n[/PARTY]',
        '[BENCHED PARTY]\nREMOVED\n[/BENCHED PARTY]',
    ]

    const GARETH = '- Gareth (Fighter 3): 28/30 HP\nCombat: BAB: +3 | Melee: +5 | Base AC: 14 | Total AC: 16\nGear: Longsword (1d8+3)\nStatus: Healthy'
    const ROBIN = '- Robin Fletcher (Rogue 2): 18/18 HP\nCombat: BAB: +1 | Ranged: +5\nStatus: (+) Blessed (+1d4 saves, 1h)'
    const PARTY_PRIOR = `${PRIOR}\n\n[PARTY]\n${GARETH}\n${ROBIN}\n[/PARTY]`
    const BENCHED_PRIOR = `${PRIOR}\n\n[PARTY]\n${ROBIN}\n[/PARTY]\n\n[BENCHED PARTY]\n${GARETH.replace('Status: Healthy', 'Status: Benched (06:15 AM, Day 4, resting)')}\n[/BENCHED PARTY]`

    const PRIORS = ['', PRIOR, `${PRIOR}\n\n[XP]\n1/1000\n[/XP]`, PARTY_PRIOR, BENCHED_PRIOR]

    it('is reading the pinned commit', () => {
        const head = execFileSync('git', ['-C', checkout as string, 'rev-parse', 'HEAD'], {
            encoding: 'utf8',
        }).trim()
        expect(head, 'checkout is not at the pin; re-point it before trusting this run').toBe(PINNED_COMMIT)
    })

    it('merges every case exactly as the legacy build does, benching off', () => {
        const disagreements: Array<{ prior: string; output: string; mine: string; theirs: string }> = []

        for (const prior of PRIORS) {
            for (const output of OUTPUTS) {
                const mine = mergeMemo(prior, output, { bench: false })
                const theirs = legacy.mergeMemo(prior, output)
                if (mine !== theirs) disagreements.push({ prior, output, mine, theirs })
            }
        }

        expect(disagreements).toEqual([])
    })

    it('merges every case exactly as the legacy build does, benching on', () => {
        const disagreements: Array<{ prior: string; output: string; mine: string; theirs: string }> = []

        for (const prior of PRIORS) {
            for (const output of OUTPUTS) {
                const mine = mergeMemo(prior, output, { bench: true })
                const theirs = legacyBench.mergeMemo(prior, output)
                if (mine !== theirs) disagreements.push({ prior, output, mine, theirs })
            }
        }

        expect(disagreements).toEqual([])
    })

    it('deduplicates exactly as the legacy build does', () => {
        const cases = [
            PRIOR,
            `${PRIOR}\n\n[TIME]\nlater\n[/TIME]`,
            '[XP]\n1\n[/XP]\n[XP]\n2\n[/XP]\n[XP]\n3\n[/XP]',
            '[MORALE_INDEX]\na\n[/MORALE_INDEX]\n[MORALE_INDEX]\nb\n[/MORALE_INDEX]',
            '[BENCHED PARTY]\na\n[/BENCHED PARTY]\n[BENCHED PARTY]\nb\n[/BENCHED PARTY]',
            '',
            'no blocks at all',
        ]

        const disagreements = cases
            .map((memo) => ({ memo, mine: deduplicateMemo(memo), theirs: legacy.deduplicateMemo(memo) }))
            .filter((row) => row.mine !== row.theirs)

        expect(disagreements).toEqual([])
    })
})
