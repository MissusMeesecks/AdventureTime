/**
 * The entity grammar, differentially tested against the legacy build itself.
 *
 * The legacy carries *two* independent implementations of this grammar, which
 * is unusual and useful. `renderer.js` anchors entities inline while building
 * HTML, and `src/state/combat-persistence.js` parses the same blocks into a
 * structure so defeated combatants can be archived. This port is checked
 * against both:
 *
 *   - `parseCombatSideHeader` and `isResolvedCombatantStatusLine` are compared
 *     function to function — they are cleanly exported and this port is a
 *     direct transcription of them.
 *   - The anchoring itself is compared against `parseCombatants`, over combat
 *     blocks where the two legacy parsers agree by construction. Where they
 *     disagree the renderer is the authority, because it is the one that
 *     decides what appears on screen; those cases are covered by unit tests in
 *     `entities.test.ts` instead and are listed at the bottom of this file.
 *
 * Opt-in, like the other `.pin` tests. To run it:
 *
 *   git clone --filter=blob:none \
 *     https://github.com/MultihogAurelius/SillyTavern-MultihogDnDFramework /tmp/mh
 *   git -C /tmp/mh checkout d6aab004f97f1f9a286f235de62f22ba1abadbe8
 *   MULTIHOG_CHECKOUT=/tmp/mh npx vitest run src/tracker/entities.pin.test.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { isResolvedCombatantStatusLine, parseCombatSideHeader, parseEntityBlock } from './entities.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const combatPersistence = `${checkout}/src/state/combat-persistence.js`
const available = !!checkout && existsSync(combatPersistence)

interface Legacy {
    parseCombatSideHeader(line: string): 'allies' | 'enemies' | null
    isResolvedCombatantStatusLine(line: string): boolean
    parseCombatants(content: string): Array<{ name: string; side: string; lines: string[] }>
}

describe.skipIf(!available)('the entity grammar against the pinned legacy build', () => {
    const legacy: Legacy = (() => {
        if (!available) return {} as Legacy
        const source = readFileSync(combatPersistence, 'utf8')

        const start = source.indexOf('const COMBATANT_HP_RX')
        const end = source.indexOf('export function partitionResolvedCombatants')
        if (start === -1 || end === -1) throw new Error('combat-persistence.js no longer has the shape this test slices')

        const body = source.slice(start, end).replace(/^\s*export /gm, '')
        return eval(`(function () {
            ${body}
            return { parseCombatSideHeader, isResolvedCombatantStatusLine, parseCombatants };
        })`)()
    })()

    // ── the two exported helpers, function to function ────────────────────

    const HEADERS = [
        'ENEMIES:', 'ENEMIES', 'enemies:', 'ALLIES:', 'ALLIES', 'NON-PARTY ALLIES:',
        'NON PARTY ALLIES:', '  ENEMIES:  ', 'ENEMIES: Goblin', 'Enemy:', 'ALLIES AND FRIENDS:',
        'Goblin Archer: 7/12 HP', '', '   ', 'Combat Round 3',
    ]

    it.each(HEADERS)('reads the side header %j identically', (line) => {
        expect(parseCombatSideHeader(line)).toBe(legacy.parseCombatSideHeader(line))
    })

    const STATUSES = [
        'Status: Defeated', 'Status: Dead', 'status:dead', 'Status: (-) Defeated',
        'Status: ((PILLS)) Dead', 'Goblin: 0/12 HP | Status: Defeated',
        'Goblin: 0/12 HP | Status: Prone', 'Status: Deadly Poison', 'Status: Defeating the party',
        'Notes: the bandit is dead to us', 'Status: Unconscious', 'Status: Dying', '0/12 HP', '',
    ]

    it.each(STATUSES)('agrees whether %j resolves a combatant', (line) => {
        expect(isResolvedCombatantStatusLine(line)).toBe(legacy.isResolvedCombatantStatusLine(line))
    })

    // ── the anchoring, against the second legacy parser ───────────────────

    const CASES: Array<[string, string]> = [
        ['a headerless block', [
            'Goblin Archer: 7/12 HP | AC: 13 | Status: (-) Prone',
            'Notes: perched on the mill roof',
            'Bandit Chief: 24/30 HP | AC: 15',
        ].join('\n')],
        ['both sides named', [
            'ENEMIES:',
            'Goblin Archer: 7/12 HP',
            'NON-PARTY ALLIES:',
            'Village Militia: 10/10 HP',
        ].join('\n')],
        ['a loose line right after a side header', [
            'Militia: 10/10 HP',
            'ENEMIES:',
            'The door bursts open.',
            'Goblin Archer: 7/12 HP',
        ].join('\n')],
        ['a defeated enemy', [
            'ENEMIES:',
            'Bandit Chief: 0/30 HP | Status: Defeated',
            'Goblin Archer: 7/12 HP',
        ].join('\n')],
        ['unknown hit points', ['Shadow: ?/? HP | Status: Unseen', 'Wraith: ??/40 HP'].join('\n')],
        ['lines before any combatant', [
            'The mill is burning.',
            'Goblin Archer: 7/12 HP',
            'Notes: coughing',
        ].join('\n')],
        ['sub-lines with markers', [
            'Goblin Archer: 7/12 HP',
            '((PILLS)) Prone, Bleeding',
            'Morale: ((BAR)) 3/10',
        ].join('\n')],
        ['thousands separators and negatives', ['Ancient Wyrm: 1,200/1,500 HP', 'Cultist: -3/8 HP'].join('\n')],
        ['a current value with no maximum', 'Swarm: 40 HP | Info: uncountable'],
        ['empty lines between combatants', 'Goblin: 7/12 HP\n\n\nBandit: 9/9 HP'],
        ['nothing that anchors at all', 'The room is quiet.\nDust settles.'],
        ['an empty block', ''],
    ]

    /**
     * Names only, deliberately, not sides.
     *
     * The legacy persistence parser starts a headerless block at `enemies` so
     * that an un-headered fight still archives its dead. This port leaves the
     * side unset until a header names one, because here the side is a red or
     * blue edge on a card — and a headerless block routinely lists the party
     * too, so defaulting would paint the party as enemies. Covered by
     * `entities.test.ts`.
     */
    it.each(CASES)('anchors the same combatants in %s', (_name, content) => {
        const ours = parseEntityBlock(content, 'COMBAT')
        const mine = (ours ?? [])
            .filter((token): token is Extract<typeof token, { kind: 'entity' }> => token.kind === 'entity')
            .map((token) => token.entity.name)

        expect(mine).toEqual(legacy.parseCombatants(content).map((entity) => entity.name))
    })

    it.each(CASES)('agrees which side a header put a combatant on in %s', (_name, content) => {
        // Once a header *has* named a side, the two must agree exactly.
        const ours = parseEntityBlock(content, 'COMBAT')
        const mine = (ours ?? [])
            .filter((token): token is Extract<typeof token, { kind: 'entity' }> => token.kind === 'entity')
            .map((token) => token.entity.side)
            .filter((side) => side !== null)

        const theirs = legacy.parseCombatants(content).map((entity) => entity.side)
        expect(mine).toEqual(theirs.slice(theirs.length - mine.length))
    })

    it.each(CASES)('groups the same lines under each combatant in %s', (_name, content) => {
        const ours = parseEntityBlock(content, 'COMBAT')
        const theirs = legacy.parseCombatants(content)

        const entities = (ours ?? []).filter(
            (token): token is Extract<typeof token, { kind: 'entity' }> => token.kind === 'entity',
        )

        entities.forEach((token, index) => {
            // The legacy keeps the anchor line at the head of its own list; this
            // port splits the anchor out into name, hp and fields, so what is
            // compared is everything after it.
            expect(token.entity.lines.map((line) => line.trim())).toEqual(theirs[index]!.lines.slice(1))
        })
    })

    /*
     * Where the two legacy parsers disagree, and why this port follows the
     * renderer:
     *
     *   - `Combat Round 3` is a header to the renderer and an ordinary line to
     *     the persistence parser. It is drawn as a header, so the renderer wins.
     *   - A `[CHARACTER]` or `[PARTY]` block anchors its first line on a bare
     *     name; the persistence parser only ever looks at COMBAT and so has no
     *     opinion.
     *   - The inline `Name ((BARGREEN)) 12/20` form anchors in the renderer and
     *     does not in the persistence parser, which reads only the classic
     *     `Name: x/y HP` spelling. This port keeps the renderer's form but not
     *     its bug: `Morale: ((BAR)) 3/10` is a labelled bar about an entity,
     *     and the renderer anchors an entity named `Morale:` off it.
     *   - A headerless block's side, as above.
     *   - A list marker before the name (`- Perrin: 12/12 HP`, 60-bis) is
     *     dropped here and kept by both legacy parsers. The stock formats
     *     ask for none; a model writes one; and a portrait keyed to `Perrin`
     *     never met `- Perrin`. The legacy has the same hole.
     *
     * All are covered by `entities.test.ts`.
     */
})
