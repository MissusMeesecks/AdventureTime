import { describe, expect, it } from 'vitest'

import { parseHitDice, parseSpellBlockLine, parseSpellGroups, spellSlug } from './spells.js'

describe('parseSpellBlockLine', () => {
    it('reads a level with its slots and spells', () => {
        expect(parseSpellBlockLine("Level 1 (2/4): Hunter's Mark, Longstrider, Detect Magic")).toEqual({
            label: 'Level 1',
            slots: { available: 2, max: 4 },
            spells: ["Hunter's Mark", 'Longstrider', 'Detect Magic'],
        })
    })

    it('reads cantrips with no slots, even when a fraction is written', () => {
        expect(parseSpellBlockLine('Cantrips: Mage Hand, Light')).toEqual({ label: 'Cantrips', slots: null, spells: ['Mage Hand', 'Light'] })
        expect(parseSpellBlockLine('Cantrip (3/3): Mage Hand')!.slots).toBeNull()
    })

    it('reads a level written without slots', () => {
        expect(parseSpellBlockLine('Level 2: Misty Step')).toEqual({ label: 'Level 2', slots: null, spells: ['Misty Step'] })
    })

    it('ignores a note after the fraction, as the legacy does', () => {
        expect(parseSpellBlockLine('Level 3 (1/2 slots): Fireball')!.slots).toEqual({ available: 1, max: 2 })
    })

    // The block form needs a spell list: a bare `Level 1 (2/2)` is not a row.
    it('returns null for a line that is not a spell row', () => {
        expect(parseSpellBlockLine('Level 1 (2/2)')).toBeNull()
        expect(parseSpellBlockLine('Known: Fireball')).toBeNull()
        expect(parseSpellBlockLine('')).toBeNull()
    })

    it('drops an empty name from a trailing comma', () => {
        expect(parseSpellBlockLine('Level 1 (1/1): Shield, ')!.spells).toEqual(['Shield'])
    })
})

describe('parseSpellGroups', () => {
    it('reads several groups joined by | on one line', () => {
        expect(parseSpellGroups("Cantrips: Mage Hand | Level 1 (2/2): Hunter's Mark, Goodberry")).toEqual([
            { label: 'Cantrips', slots: null, spells: ['Mage Hand'] },
            { label: 'Level 1', slots: { available: 2, max: 2 }, spells: ["Hunter's Mark", 'Goodberry'] },
        ])
    })

    it('reads a group with slots and no list', () => {
        expect(parseSpellGroups('Level 1 (0/2)')).toEqual([{ label: 'Level 1', slots: { available: 0, max: 2 }, spells: [] }])
    })

    // Only a | beside a level splits: a flat list with a | in it stays one value.
    it('skips a piece that is not a group, and is empty for a flat list', () => {
        expect(parseSpellGroups('Level 1 (1/1): Shield | Ritual casting')).toHaveLength(1)
        expect(parseSpellGroups('Ray of Sickness (2/2), Fire Bolt (at will)')).toEqual([])
        expect(parseSpellGroups('')).toEqual([])
    })
})

describe('parseHitDice', () => {
    it('reads the die and the fraction', () => {
        expect(parseHitDice('d10 (3/5)')).toEqual({ die: 'd10', current: 3, max: 5 })
        expect(parseHitDice('d8 (1,000/1,200)')).toEqual({ die: 'd8', current: 1000, max: 1200 })
    })

    it('returns null without a fraction, so the line is drawn as written', () => {
        expect(parseHitDice('d10')).toBeNull()
        expect(parseHitDice('5/5')).toBeNull()
    })
})

describe('spellSlug', () => {
    it("builds the wiki's slug: lower case, apostrophes gone, runs of anything else as one dash", () => {
        expect(spellSlug("Hunter's Mark")).toBe('hunters-mark')
        expect(spellSlug('Melf’s Acid Arrow')).toBe('melf-s-acid-arrow')
        expect(spellSlug('Fire Bolt (at will)')).toBe('fire-bolt-at-will-')
    })
})
