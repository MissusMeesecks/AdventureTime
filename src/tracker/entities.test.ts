import { describe, expect, it } from 'vitest'

import { parseEntityBlock, type TrackerEntity } from './entities.js'

/** The entities a block anchored, in order. */
function entities(content: string, tag = 'COMBAT'): TrackerEntity[] {
    return (parseEntityBlock(content, tag) ?? [])
        .filter((token): token is Extract<typeof token, { kind: 'entity' }> => token.kind === 'entity')
        .map((token) => token.entity)
}

const first = (content: string, tag = 'COMBAT'): TrackerEntity => {
    const [entity] = entities(content, tag)
    if (!entity) throw new Error('nothing anchored')
    return entity
}

describe('anchoring an entity', () => {
    it('reads the classic Name: cur/max HP line', () => {
        const entity = first('Brenna: 12/20 HP')
        expect(entity.name).toBe('Brenna')
        expect(entity.hp).toMatchObject({ currentText: '12', maxText: '20', current: 12, max: 20, percent: 60 })
    })

    it('reads a current value with no maximum', () => {
        const entity = first('Swarm: 40 HP')
        expect(entity.hp).toMatchObject({ currentText: '40', maxText: null, percent: 100 })
    })

    it('keeps thousands separators as written but compares them as numbers', () => {
        const entity = first('Ancient Wyrm: 1,200/1,500 HP')
        expect(entity.hp).toMatchObject({ currentText: '1,200', maxText: '1,500', current: 1200, max: 1500 })
        expect(entity.hp!.percent).toBeCloseTo(80)
    })

    it('drops a list marker a model put before the name, in every spelling (60-bis)', () => {
        // The portrait set for Perrin never matched `- Perrin`, on the card or in the store.
        expect(first("- Perrin O'Dwyer [msg #2] (Ranger): 12/12 HP | Combat: BAB +1", 'PARTY').name).toBe("Perrin O'Dwyer [msg #2] (Ranger)")
        expect(first('\u2013 Carol (Explorer): 9/9 HP').name).toBe('Carol (Explorer)')
        expect(first('\u2022 Bob: 5/5 HP').name).toBe('Bob')
        expect(first('* Al: 3/3 HP').name).toBe('Al')
        expect(first('- Rat ((BAR)) 4/4').name).toBe('Rat')
        expect(first('- Brenna', 'CHARACTER').name).toBe('Brenna')
        expect(first('- Name: Brenna', 'CHARACTER').name).toBe('Brenna')
        // A hyphenated name, or a dash with no space, is a name.
        expect(first('-Ghost: 1/1 HP').name).toBe('-Ghost')
        expect(first('Mary-Anne: 1/1 HP').name).toBe('Mary-Anne')
    })

    it('draws unknown hit points as a full neutral bar, not an empty one', () => {
        // An enemy the party cannot read is not an enemy who is nearly dead.
        const entity = first('Shadow: ?/? HP')
        expect(entity.hp).toMatchObject({ unknown: true, percent: 100 })
    })

    it('clamps a value past its own maximum', () => {
        expect(first('Blessed: 30/20 HP').hp!.percent).toBe(100)
        expect(first('Cursed: -5/20 HP').hp!.percent).toBe(0)
    })

    it('gives each bar an identity scoped to its block and entity', () => {
        // Two combatants both called out on HP must not share one bar identity.
        expect(first('Brenna: 12/20 HP').hp!.barId).toBe('COMBAT:Brenna:HP')
        expect(first('Brenna: 12/20 HP', 'PARTY').hp!.barId).toBe('PARTY:Brenna:HP')
    })

    it('accepts a leading ((HP)) marker, which makes the HP suffix optional', () => {
        const entity = first('((HP)) Brenna: 12/20')
        expect(entity.name).toBe('Brenna')
        expect(entity.hp).toMatchObject({ current: 12, max: 20 })
    })

    it('accepts the inline bar form, and takes the colour from the marker', () => {
        const entity = first('Brenna ((BARGREEN)) 12/20')
        expect(entity.name).toBe('Brenna')
        expect(entity.hp).toMatchObject({ current: 12, max: 20 })
        expect(entity.hp!.color).toBeTruthy()
    })

    it('does not mistake a labelled bar for a new entity', () => {
        // `Morale: ((BAR)) 3/10` is a bar *about* Brenna. The legacy renderer
        // anchors an entity literally named `Morale:` here; its own second
        // parser does not, and this follows that one.
        const all = entities(['Brenna: 12/20 HP', 'Morale: ((BAR)) 3/10'].join('\n'))
        expect(all.map((e) => e.name)).toEqual(['Brenna'])
        expect(all[0]!.lines).toEqual(['Morale: ((BAR)) 3/10'])
    })
})

describe('the fields on an anchor line', () => {
    const fields = (line: string) => first(line).fields

    it('splits the labelled ones out on the pipes', () => {
        expect(fields('Brenna: 12/20 HP | AC: 15 | Status: Prone, Bleeding')).toEqual([
            { label: 'AC', value: '15', kind: 'text' },
            { label: 'Status', value: 'Prone, Bleeding', kind: 'pills' },
        ])
    })

    it('knows the five labels the format defines', () => {
        const parsed = fields('X: 1/1 HP | AC: 15 | Saves: Str (+3) | Status: Prone | Res: Fire | Other: Darkvision')
        expect(parsed.map((f) => [f.label, f.kind])).toEqual([
            ['AC', 'text'],
            ['Saves', 'highlight'],
            ['Status', 'pills'],
            ['Res', 'pills'],
            ['Other', 'pills'],
        ])
    })

    it('gathers everything unlabelled under one heading rather than guessing', () => {
        expect(fields('X: 1/1 HP | flanked | out of arrows')).toEqual([
            { label: 'Info', value: 'flanked | out of arrows', kind: 'highlight' },
        ])
    })

    it('has no fields when the line said nothing after the hit points', () => {
        expect(fields('Brenna: 12/20 HP')).toEqual([])
    })
})

describe('lines hanging off an entity', () => {
    it('attaches every following line until the next anchor', () => {
        const all = entities(['Goblin: 7/12 HP', 'Notes: on the roof', 'Perception: 12', 'Bandit: 9/9 HP'].join('\n'))
        expect(all.map((e) => e.name)).toEqual(['Goblin', 'Bandit'])
        expect(all[0]!.lines).toEqual(['Notes: on the roof', 'Perception: 12'])
        expect(all[1]!.lines).toEqual([])
    })

    it('keeps a line that arrived before any entity as a loose line', () => {
        const tokens = parseEntityBlock('The mill is burning.\nGoblin: 7/12 HP', 'COMBAT')!
        expect(tokens[0]).toEqual({ kind: 'line', line: 'The mill is burning.' })
    })
})

describe('combat headers', () => {
    it('reads a round header and breaks the entity context on it', () => {
        const tokens = parseEntityBlock(['Goblin: 7/12 HP', 'Combat Round 2', 'Notes: loose'].join('\n'), 'COMBAT')!
        expect(tokens[1]).toEqual({ kind: 'round', label: 'Combat Round 2' })
        // The note came after the round header, so it belongs to nobody.
        expect(tokens[2]).toEqual({ kind: 'line', line: 'Notes: loose' })
    })

    it('reads a side header and puts the combatants after it on that side', () => {
        const all = entities(['ENEMIES:', 'Goblin: 7/12 HP', 'NON-PARTY ALLIES:', 'Militia: 10/10 HP'].join('\n'))
        expect(all.map((e) => [e.name, e.side])).toEqual([
            ['Goblin', 'enemies'],
            ['Militia', 'allies'],
        ])
    })

    it('breaks the entity context on a side header', () => {
        // Without this a note under `ENEMIES:` would still be attached to the
        // last ally above it, and would draw inside their card.
        const tokens = parseEntityBlock(
            ['Militia: 10/10 HP', 'ENEMIES:', 'The door bursts open.', 'Goblin: 7/12 HP'].join('\n'),
            'COMBAT',
        )!
        expect(tokens[2]).toEqual({ kind: 'line', line: 'The door bursts open.' })
    })

    it('breaks the entity context on a round header too', () => {
        const tokens = parseEntityBlock(
            ['Goblin: 7/12 HP', 'Combat Round 2', 'Initiative is re-rolled.'].join('\n'),
            'COMBAT',
        )!
        expect(tokens[2]).toEqual({ kind: 'line', line: 'Initiative is re-rolled.' })
    })

    it('leaves the side unset in a headerless block', () => {
        // The legacy's persistence parser defaults these to enemies so an
        // un-headered fight still archives its dead. Here the side is a
        // coloured edge, and a headerless block routinely lists the party too.
        expect(first('Brenna: 12/20 HP').side).toBeNull()
    })

    it('only reads round and side headers inside COMBAT', () => {
        expect(parseEntityBlock('Combat Round 2\nBrenna: 12/20 HP', 'PARTY')![0]).toMatchObject({ kind: 'entity' })
    })
})

describe('defeated combatants', () => {
    it('marks one whose status says so on the anchor line', () => {
        expect(first('Bandit: 0/30 HP | Status: Defeated').defeated).toBe(true)
    })

    it('marks one whose status says so on a later line', () => {
        expect(first('Bandit: 0/30 HP\nStatus: Dead').defeated).toBe(true)
    })

    it('does not take zero hit points as settled', () => {
        // A dying character is still in the fight, and still needs to be seen.
        expect(first('Brenna: 0/20 HP | Status: Dying').defeated).toBe(false)
    })

    it('says nothing about defeat outside COMBAT', () => {
        expect(first('Brenna: 0/20 HP | Status: Defeated', 'PARTY').defeated).toBe(false)
    })
})

describe('bare-name anchors', () => {
    it('anchors the first line of a CHARACTER block on its own name', () => {
        const entity = first('Brenna Stonefoot', 'CHARACTER')
        expect(entity.name).toBe('Brenna Stonefoot')
        expect(entity.hp).toBeNull()
    })

    it('unwraps an explicit Name: label', () => {
        expect(first('Name: Brenna Stonefoot', 'CHARACTER').name).toBe('Brenna Stonefoot')
    })

    it('keeps the rest of the header line beside the name', () => {
        const entity = first('Brenna Stonefoot: Dwarf Cleric, Level 3', 'CHARACTER')
        expect(entity.name).toBe('Brenna Stonefoot')
        expect(entity.fields).toEqual([{ label: '', value: 'Dwarf Cleric, Level 3', kind: 'text' }])
    })

    it('anchors on a bare name only once, so the rest are details not people', () => {
        const all = entities(['Brenna Stonefoot', 'Class: Cleric', 'Alignment: Lawful Good'].join('\n'), 'CHARACTER')
        expect(all).toHaveLength(1)
        expect(all[0]!.lines).toEqual(['Class: Cleric', 'Alignment: Lawful Good'])
    })

    it('does not do it in COMBAT, where a nameless line is not a combatant', () => {
        expect(parseEntityBlock('The mill is burning.', 'COMBAT')).toBeNull()
    })
})

describe('when nothing anchors', () => {
    it('returns null so the caller falls back to plain lines', () => {
        // The failure mode that would look like data loss. A model writing
        // something this does not recognise has to see its own words.
        expect(parseEntityBlock('The room is quiet.\nDust settles.', 'COMBAT')).toBeNull()
        expect(parseEntityBlock('', 'COMBAT')).toBeNull()
        expect(parseEntityBlock(null, 'PARTY')).toBeNull()
    })

    it('returns null for a block that is only headers', () => {
        expect(parseEntityBlock('ENEMIES:\nCombat Round 1', 'COMBAT')).toBeNull()
    })
})
