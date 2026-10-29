import { describe, expect, it } from 'vitest'

import { ENTITY_FIELD_RULES, entityFieldRule, parseBlockLine, parseFraction, type TrackerLine } from './lines.js'

const ctx = { tag: 'WAYSTONE', lineIndex: 0 }

/** Narrow to a marker line, so a wrong `kind` fails loudly rather than as `undefined`. */
function markers(line: TrackerLine) {
    if (line.kind !== 'markers') throw new Error(`expected a marker line, got ${line.kind}`)
    return line
}

describe('lines without markers', () => {
    it('reads Key: value as a kv pair', () => {
        expect(parseBlockLine('Steward: Odile', ctx)).toEqual({ kind: 'kv', label: 'Steward', value: 'Odile' })
    })

    it('splits on the first colon only', () => {
        expect(parseBlockLine('Next Inspection: 11:00 AM, Day 9', ctx)).toEqual({
            kind: 'kv',
            label: 'Next Inspection',
            value: '11:00 AM, Day 9',
        })
    })

    it('falls back to plain text with no colon', () => {
        expect(parseBlockLine('The vault door is ajar', ctx)).toEqual({ kind: 'text', text: 'The vault door is ajar' })
    })

    it('treats a colon with nothing after it as plain text', () => {
        expect(parseBlockLine('Gear:', ctx)).toEqual({ kind: 'text', text: 'Gear:' })
    })

    it('does not read a clock as a label and a value', () => {
        // `[TIME]` holds exactly this line, and its own colon was being read as
        // a key separator: the panel drew `09: 30 PM, Day 2`, every turn, with
        // the hour styled as a label.
        expect(parseBlockLine('09:30 PM, Day 2', { tag: 'TIME', lineIndex: 0 })).toEqual({
            kind: 'text',
            text: '09:30 PM, Day 2',
        })
    })

    it.each([
        ['a 24-hour clock', '21:30, Day 2'],
        ['a bare hour', '9:05'],
    ])('leaves %s alone', (_name, line) => {
        expect(parseBlockLine(line, { tag: 'TIME', lineIndex: 0 })).toEqual({ kind: 'text', text: line })
    })

    it('still reads a key that merely contains digits', () => {
        // Only a *bare* number is disqualified. "Day 2" and "Round 3" are keys.
        expect(parseBlockLine('Day 2: overcast', ctx)).toEqual({ kind: 'kv', label: 'Day 2', value: 'overcast' })
    })
})

describe('the pips (38)', () => {
    it('reads a [SPELLS] line as a spell row, in that block only', () => {
        expect(parseBlockLine('Level 1 (2/4): Shield, Sleep', { tag: 'SPELLS', lineIndex: 0 })).toEqual({
            kind: 'spells',
            groups: [{ label: 'Level 1', slots: { available: 2, max: 4 }, spells: ['Shield', 'Sleep'] }],
            flat: null,
        })
        expect(parseBlockLine('Level 1 (2/4): Shield, Sleep', ctx).kind).toBe('kv')
    })

    it('leaves a [SPELLS] line that is not a row as it was', () => {
        expect(parseBlockLine('Known: Fireball', { tag: 'SPELLS', lineIndex: 0 })).toEqual({ kind: 'kv', label: 'Known', value: 'Fireball' })
        expect(parseBlockLine('Level 1 (2/2)', { tag: 'SPELLS', lineIndex: 0 }).kind).toBe('text')
    })

    const entity = { tag: 'PARTY:Elara', lineIndex: 0, inEntity: true }

    it("reads an entity's Spells: sub-line as groups, or as a flat list", () => {
        expect(parseBlockLine('Spells: Cantrips: Mage Hand | Level 1 (1/2): Goodberry', entity)).toEqual({
            kind: 'spells',
            groups: [
                { label: 'Cantrips', slots: null, spells: ['Mage Hand'] },
                { label: 'Level 1', slots: { available: 1, max: 2 }, spells: ['Goodberry'] },
            ],
            flat: null,
        })
        expect(parseBlockLine('Spells: Ray of Sickness (2/2), Fire Bolt (at will)', entity)).toEqual({
            kind: 'spells',
            groups: [],
            flat: 'Ray of Sickness (2/2), Fire Bolt (at will)',
        })
    })

    it("reads an entity's HD: with a fraction as hit dice, and without one as a kv pair", () => {
        expect(parseBlockLine('HD: d10 (3/5)', entity)).toEqual({ kind: 'hd', die: 'd10', current: 3, max: 5 })
        expect(parseBlockLine('hd: d10', entity)).toEqual({ kind: 'kv', label: 'hd', value: 'd10' })
    })

    // The entity rules are the entity's: the same lines at block level are kv pairs.
    it('reads Spells: and HD: at block level as ordinary pairs', () => {
        expect(parseBlockLine('Spells: Level 1 (1/2): Goodberry', { tag: 'PARTY', lineIndex: 0 }).kind).toBe('kv')
        expect(parseBlockLine('HD: d10 (3/5)', ctx).kind).toBe('kv')
    })

    it('lets a marker win, as the legacy tries the marker first', () => {
        expect(parseBlockLine('HD: ((SLOTS)) 3/5', entity).kind).toBe('markers')
    })
})

describe('the stock labels under an entity (40)', () => {
    const entity = { tag: 'PARTY:Elara', lineIndex: 0, inEntity: true }
    const ruleOf = (line: TrackerLine) => (line.kind === 'kv' ? line.rule : undefined)

    it('names the rule for a stock label, whatever its case', () => {
        expect(parseBlockLine('Skills: Athletics +3, Perception +5', entity)).toEqual({ kind: 'kv', label: 'Skills', value: 'Athletics +3, Perception +5', rule: 'pills' })
        expect(ruleOf(parseBlockLine('KEY SKILLS: Stealth +7', entity))).toBe('pills')
        expect(ruleOf(parseBlockLine('Saves: Fort +3 | Ref +5 | Will +2', entity))).toBe('numbers')
        expect(parseBlockLine('Combat: BAB: +3 | Melee (1 attack): +4', entity)).toMatchObject({ label: 'Combat', value: 'BAB: +3 | Melee (1 attack): +4', rule: 'numbers' })
        expect(ruleOf(parseBlockLine('Gear: Shortbow (1d6+3 Piercing)', entity))).toBe('highlight')
        expect(ruleOf(parseBlockLine('Attr: STR 12 (+1)', entity))).toBe('highlight')
        expect(ruleOf(parseBlockLine('AC: 15', entity))).toBe('text')
        expect(ruleOf(parseBlockLine('Att/Def: +4 / 14', entity))).toBe('numbers')
    })

    it('leaves a label the table does not know without a rule, and the same lines at block level without one', () => {
        expect(parseBlockLine('Mood: wary (hungry)', entity)).toEqual({ kind: 'kv', label: 'Mood', value: 'wary (hungry)' })
        expect(parseBlockLine('Skills: Athletics +3', ctx)).toEqual({ kind: 'kv', label: 'Skills', value: 'Athletics +3' })
    })

    it('matches the whole label, not its opening', () => {
        expect(ruleOf(parseBlockLine('Combat Style: archery', entity))).toBeUndefined()
        expect(ruleOf(parseBlockLine('Attributes: STR 12', entity))).toBe('highlight')
    })

    it('lets a marker win, and the pips keep their own kinds', () => {
        expect(parseBlockLine('Status: ((PILLS)) Poisoned', entity).kind).toBe('markers')
        expect(parseBlockLine('HD: d8 (2/2)', entity).kind).toBe('hd')
    })

    it('lists every label of the legacy table but the two pip rules', () => {
        expect(ENTITY_FIELD_RULES.map(([label]) => label)).toEqual(['combat', 'gear', 'attr', 'attributes', 'skills', 'key skills', 'saves', 'status', 'traits', 'abilities', 'other', 'resistances', 'res', 'weapon', 'att/def', 'primary weapon', 'ac'])
        expect(entityFieldRule(' Traits ')).toBe('pills')
        expect(entityFieldRule('hd')).toBeUndefined()
    })
})

describe('a marker at each place on the line', () => {
    it('at the start: everything is the value', () => {
        const [seg] = markers(parseBlockLine('((PILL)) Humming', ctx)).segments
        expect(seg).toMatchObject({ renderType: 'pill_colored', label: '', value: 'Humming' })
    })

    it('in the middle, after a label with a colon', () => {
        const [seg] = markers(parseBlockLine('Attunement: ((BARCYAN)) 640/1000 (Harmonious)', ctx)).segments
        expect(seg).toMatchObject({
            renderType: 'hp_bar',
            color: 'CYAN',
            label: 'Attunement:',
            value: '640/1000 (Harmonious)',
        })
    })

    it('in the middle, after a label with no colon: one is synthesized', () => {
        const [seg] = markers(parseBlockLine('[Epic] Sword - ((GAUGE)) 75/100', ctx)).segments
        expect(seg.label).toBe('[Epic] Sword -:')
        expect(seg.value).toBe('75/100')
    })

    it('at the end of a progression line: the label survives the fraction split', () => {
        const [seg] = markers(parseBlockLine('Durability 75/100 ((GAUGE))', ctx)).segments
        expect(seg).toMatchObject({ label: 'Durability:', value: '75/100' })
    })

    it('at the end of a non-progression line: no split is attempted', () => {
        const [seg] = markers(parseBlockLine('Utterly ruined ((HIGHLIGHT))', ctx)).segments
        expect(seg).toMatchObject({ label: '', value: 'Utterly ruined' })
    })
})

describe('marker rows', () => {
    it('a lone marker is a single-segment row', () => {
        const line = markers(parseBlockLine('((PILL)) Humming', ctx))
        expect(line.layout).toBe('single')
        expect(line.segments).toHaveLength(1)
    })

    it('two markers make a row, each owning its own half', () => {
        const line = markers(parseBlockLine('Spells: ((PLS)) Fireball, Magic Missile ((BAR)) Charges: 3/5', ctx))
        expect(line.layout).toBe('row')
        expect(line.segments[0]).toMatchObject({ renderType: 'pills', label: 'Spells:', value: 'Fireball, Magic Missile' })
        expect(line.segments[1]).toMatchObject({ renderType: 'hp_bar', label: 'Charges:', value: '3/5' })
    })

    it('|| marks explicit columns', () => {
        expect(markers(parseBlockLine('((PILLS)) Affection || ((BADGE)) Ally', ctx)).layout).toBe('columns')
    })

    it('|N gives every segment a span', () => {
        const line = markers(parseBlockLine('|0 ((TEXT)) a |60 ((TEXT)) b', ctx))
        expect(line.layout).toBe('tab-stops')
        expect(line.segments.map((s) => s.span?.start)).toEqual([0, 60])
    })

    it('a tab stop forces the row layout even for one marker', () => {
        // Otherwise the single-marker fast path would drop the span.
        const line = markers(parseBlockLine('|25 ((TEXT)) a', ctx))
        expect(line.layout).toBe('tab-stops')
        expect(line.segments[0].span).toBeDefined()
    })

    it('flags an all-pills row as compact', () => {
        expect(markers(parseBlockLine('((PILLS)) a ((BADGE)) b', ctx)).compactPills).toBe(true)
        expect(markers(parseBlockLine('((PILLS)) a ((BAR)) 1/2', ctx)).compactPills).toBe(false)
    })
})

describe('bar identity', () => {
    it('is given to bars and withheld from everything else', () => {
        expect(markers(parseBlockLine('HP: ((BAR)) 12/20', ctx)).segments[0].barId).toBeTruthy()
        expect(markers(parseBlockLine('((PILL)) Humming', ctx)).segments[0].barId).toBeUndefined()
    })

    it('keeps two identically-labelled bars on different lines apart', () => {
        const first = markers(parseBlockLine('Charges: ((BAR)) 3/5', { tag: 'GEAR', lineIndex: 0 })).segments[0]
        const second = markers(parseBlockLine('Charges: ((BAR)) 1/5', { tag: 'GEAR', lineIndex: 1 })).segments[0]
        expect(first.barId).not.toBe(second.barId)
    })

    it('keeps two identically-labelled bars on the same line apart', () => {
        const line = markers(parseBlockLine('Charges: ((BAR)) 3/5 Charges: ((BAR)) 1/5', { tag: 'GEAR', lineIndex: 0 }))
        expect(line.segments[0].barId).not.toBe(line.segments[1].barId)
    })

    it('holds steady as the value moves, so a chosen colour survives the turn', () => {
        const before = markers(parseBlockLine('HP: ((BAR)) 20/20', ctx)).segments[0]
        const after = markers(parseBlockLine('HP: ((BAR)) 3/20', ctx)).segments[0]
        expect(before.barId).toBe(after.barId)
    })

    it('anchors on the entity when there is one', () => {
        const brenna = markers(parseBlockLine('HP: ((BAR)) 12/20', { tag: 'PARTY', entityName: 'Brenna' }))
        const ansel = markers(parseBlockLine('HP: ((BAR)) 12/20', { tag: 'PARTY', entityName: 'Ansel' }))
        expect(brenna.segments[0].barId).not.toBe(ansel.segments[0].barId)
    })
})

describe('parseFraction', () => {
    it('reads a plain fraction', () => {
        expect(parseFraction('3/5')).toMatchObject({ current: 3, max: 5, percent: 60, rest: '' })
    })

    it('keeps the numbers as written and hands back the remainder', () => {
        expect(parseFraction('640/1,000 (Harmonious)')).toMatchObject({
            current: 640,
            max: 1000,
            currentText: '640',
            maxText: '1,000',
            rest: '(Harmonious)',
        })
    })

    it('clamps an over-full bar rather than overflowing the row', () => {
        expect(parseFraction('30/20')?.percent).toBe(100)
    })

    it('survives a zero maximum', () => {
        expect(parseFraction('0/0')?.percent).toBe(0)
    })

    it('returns nothing when there is no fraction', () => {
        expect(parseFraction('Humming')).toBeNull()
    })
})
