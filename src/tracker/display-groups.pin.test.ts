/**
 * The Display Groups' legacy half (75), held to the pinned source two ways:
 * the generated module must equal a fresh slice of the checkout byte for
 * byte, and the typed face must agree with the checkout's own module --
 * imported as it is, since it imports nothing -- over a corpus of groups,
 * tag lists and orders.
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { exportedNames, sliceCss, sliceLegacy } from '../../scripts/extract-display-groups.mjs'
import { createDisplayGroupsLegacy, LEGACY_DISPLAY_GROUP_CSS } from './display-groups-legacy.js'
import {
    DISPLAY_GROUP_EXCLUDED_TAGS,
    displayGroupRenderKey,
    moveDisplayGroupInOrder,
    normalizeDisplayGroupTag,
    normalizeDisplayGroups,
    planDisplayGroups,
} from './display-groups.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const FILE = 'src/features/display-groups.js'
const available = !!checkout && existsSync(`${checkout}/${FILE}`)

type Legacy = ReturnType<typeof createDisplayGroupsLegacy>

const GROUPS: unknown[] = [
    undefined, null, 'x', {}, [],
    [{ id: 'first', name: 'First', members: ['FUEL', 'CHARACTER', 'PARTY', 'COMBAT'] }, { id: 'second', name: 'Second', members: ['FUEL', 'QUESTS', 'OXYGEN', 'BENCHED PARTY'] }, { id: '', name: 'Broken', members: ['OTHER'] }],
    [{ id: 'a b/c', name: '  Named  ', icon: '🚙🚙🚙🚙🚙🚙🚙🚙🚙🚙', enabled: false, members: ['alpha', 'Alpha', 'al-pha', 'ALPHA STANDING', 7, null] }],
    [{ id: 'dup', name: 'One', members: ['A'] }, { id: 'dup', name: 'Two', members: ['B'] }, { id: 'empty', name: 'Empty', members: [] }, 'junk', { id: 'noname', members: ['C'] }],
    Array.from({ length: 60 }, (_, i) => ({ id: `g${i}`, name: `G${i}`, members: [`T${i}`] })),
    [{ id: 'wide', name: 'Wide', members: Array.from({ length: 120 }, (_, i) => `M${i}`) }],
]
const TAG_LISTS: unknown[] = [
    [], ['A'], ['ALPHA', 'BETA', 'GAMMA'], ['FUEL', 'OXYGEN', 'PARTY', 'COMBAT', 'TIME'], ['T3', 'T1', 'T59', 'OTHER'], ['M119', 'M0', 'X'], ['b', 'a'], 'nope', null,
]
const PLAN_GROUPS: unknown[] = [
    [{ id: 'g', name: 'G', members: ['BETA', 'ALPHA'] }],
    [{ id: 'g', name: 'G', members: ['FUEL', 'OXYGEN'], enabled: false }, { id: 'h', name: 'H', members: ['PARTY', 'TIME'] }],
    [{ id: 'g', name: 'G', members: ['ZZZ'] }],
    [{ id: '///', name: 'Bad key', members: ['A'] }],
    [{ id: 'dup', name: 'One', members: ['A'] }, { id: 'dup', name: 'Two', members: ['B'] }],
    GROUPS[8], GROUPS[9], [], null,
]
const ORDERS: Array<[string[], string[]]> = [
    [['A', 'B', 'C', 'D'], ['B', 'C']],
    [['A', 'B', 'C', 'D'], ['A', 'D']],
    [['A', 'B', 'C', 'D'], ['Z']],
    [['A', 'B', 'C', 'D'], ['A', 'B', 'C', 'D']],
    [['a', 'B', 'c'], ['A', 'C']],
    [[], ['A']],
]

describe.skipIf(!available)('the Display Groups against the pinned legacy build', () => {
    it('is the generated module, byte for byte, from a fresh slice of the checkout, with every export and the card’s rules', () => {
        const committed = readFileSync('src/tracker/display-groups-legacy.js', 'utf8')
        expect(committed).toContain(sliceLegacy(checkout!))
        expect(LEGACY_DISPLAY_GROUP_CSS).toBe(sliceCss(checkout!))
        expect(LEGACY_DISPLAY_GROUP_CSS).toContain('.rt-display-group-body--seamless .rt-display-group-member')
        const names = exportedNames(readFileSync(`${checkout}/${FILE}`, 'utf8'))
        expect(names).toEqual(['DISPLAY_GROUP_EXCLUDED_TAGS', 'normalizeDisplayGroupTag', 'displayGroupRenderKey', 'normalizeDisplayGroups', 'buildDisplayGroupRenderPlan', 'moveDisplayGroupInOrder'])
        const made = createDisplayGroupsLegacy() as Record<string, unknown>
        for (const name of names) expect(made[name], name).toBeDefined()
    })

    it('agrees with the checkout’s own module over groups, tag lists and orders', async () => {
        const theirs = (await import(`${checkout}/${FILE}`)) as Legacy
        expect([...DISPLAY_GROUP_EXCLUDED_TAGS]).toEqual([...theirs.DISPLAY_GROUP_EXCLUDED_TAGS])
        for (const value of ['Alpha Standing', ' fuel-2 ', 'x/y', '', null, 7, 'ALPHA_STANDING']) {
            expect(normalizeDisplayGroupTag(value)).toBe(theirs.normalizeDisplayGroupTag(value))
        }
        for (const id of ['vehicle_systems', 'a b/c', '///', '', null, 'x'.repeat(100)]) {
            expect(displayGroupRenderKey(id)).toBe(theirs.displayGroupRenderKey(id))
        }
        for (const groups of GROUPS) {
            expect(normalizeDisplayGroups(groups)).toEqual(theirs.normalizeDisplayGroups(groups))
        }
        for (const tags of TAG_LISTS) {
            for (const groups of PLAN_GROUPS) {
                for (const enabled of [true, false]) {
                    expect(planDisplayGroups(tags as never, groups, enabled)).toEqual(theirs.buildDisplayGroupRenderPlan(tags, groups, enabled))
                }
            }
        }
        for (const [order, members] of ORDERS) {
            for (const direction of ['up', 'down'] as const) {
                expect(moveDisplayGroupInOrder(order, members, direction)).toEqual(theirs.moveDisplayGroupInOrder(order, members, direction))
            }
        }
    })
})
