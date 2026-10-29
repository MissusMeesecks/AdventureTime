/**
 * The Display Groups' face (75): the legacy's rules as typed, and the one
 * AdventureTime piece, the module list the manager offers.
 */
import { describe, expect, it } from 'vitest'

import {
    DISPLAY_GROUP_CSS,
    DISPLAY_GROUP_EXCLUDED_TAGS,
    displayGroupRenderKey,
    knownDisplayGroupModules,
    moveDisplayGroupInOrder,
    normalizeDisplayGroups,
    planDisplayGroups,
    readDisplayGroups,
} from './display-groups.js'

describe('the legacy’s rules, typed', () => {
    it('never groups COMBAT, BENCHED PARTY or QUESTS, and lets the first group keep a claimed tag', () => {
        expect([...DISPLAY_GROUP_EXCLUDED_TAGS]).toEqual(['COMBAT', 'BENCHED PARTY', 'QUESTS'])
        expect(normalizeDisplayGroups([
            { id: 'first', name: 'First', members: ['FUEL', 'CHARACTER', 'PARTY', 'COMBAT'] },
            { id: 'second', name: 'Second', members: ['FUEL', 'QUESTS', 'OXYGEN', 'BENCHED PARTY'] },
            { id: '', name: 'Broken', members: ['OTHER'] },
        ])).toEqual([
            { id: 'first', name: 'First', icon: '🗂️', enabled: true, members: ['FUEL', 'CHARACTER', 'PARTY'] },
            { id: 'second', name: 'Second', icon: '🗂️', enabled: true, members: ['OXYGEN'] },
        ])
        expect(readDisplayGroups('junk')).toEqual([])
        expect(displayGroupRenderKey('vehicle systems')).toBe('DISPLAY_GROUP_vehiclesystems')
        expect(displayGroupRenderKey('///')).toBe('')
    })

    it('plans one host at the first member’s place in the group’s own order, and the flat list with the switch off', () => {
        const groups = [{ id: 'g', name: 'G', icon: '🚙', enabled: true, members: ['BETA', 'ALPHA'] }]
        expect(planDisplayGroups(['TIME', 'ALPHA', 'XP', 'BETA'], groups, true)).toEqual([
            { kind: 'module', tag: 'TIME' },
            { kind: 'group', key: 'DISPLAY_GROUP_g', group: groups[0], tags: ['BETA', 'ALPHA'] },
            { kind: 'module', tag: 'XP' },
        ])
        expect(planDisplayGroups(['TIME', 'ALPHA'], groups, false)).toEqual([{ kind: 'module', tag: 'TIME' }, { kind: 'module', tag: 'ALPHA' }])
        expect(planDisplayGroups(['TIME'], groups, true)).toEqual([{ kind: 'module', tag: 'TIME' }])
    })

    it('moves a group’s members as one', () => {
        expect(moveDisplayGroupInOrder(['A', 'B', 'C', 'D'], ['B', 'C'], 'down')).toEqual(['A', 'D', 'B', 'C'])
        expect(moveDisplayGroupInOrder(['A', 'B', 'C', 'D'], ['B', 'C'], 'up')).toEqual(['B', 'C', 'A', 'D'])
    })

    it('carries the group card’s rules of the legacy’s stylesheet', () => {
        expect(DISPLAY_GROUP_CSS).toContain('.rt-display-group-member {')
        expect(DISPLAY_GROUP_CSS).toContain('.rt-display-group-body--seamless .rt-display-group-member > .rt-section-body')
        expect(DISPLAY_GROUP_CSS).not.toContain('.rt-display-group-options')
    })
})

describe('knownDisplayGroupModules', () => {
    it('lists the stock blocks less the three excluded, then the custom fields with their kind, each tag once', () => {
        const modules = knownDisplayGroupModules({ customFields: [
            { tag: 'rads', label: 'Radiation', icon: '☢️' },
            { tag: 'WAYSTONE', label: 'Waystone', origin: 'wizard' },
            { tag: 'quests', label: 'Nope' },
            { tag: 'RADS', label: 'Twice' },
            { tag: '' },
            null,
        ] })
        expect(modules.map((m) => m.tag)).toEqual(['CHARACTER', 'PARTY', 'INVENTORY', 'ABILITIES', 'SPELLS', 'XP', 'TIME', 'RADS', 'WAYSTONE'])
        expect(modules[0]).toEqual({ tag: 'CHARACTER', icon: '🧙', label: 'CHARACTER', kind: 'Stock' })
        expect(modules[7]).toEqual({ tag: 'RADS', icon: '☢️', label: 'Radiation', kind: 'Custom' })
        expect(modules[8]).toEqual({ tag: 'WAYSTONE', icon: '📄', label: 'Waystone', kind: 'Wizard' })
        expect(knownDisplayGroupModules({}).map((m) => m.tag)).toHaveLength(7)
    })
})
