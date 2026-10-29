import { describe, expect, it } from 'vitest'

import {
    bioOf,
    blurb,
    createRecord,
    dataUrlFromPayload,
    findById,
    findByName,
    identityOf,
    LIBRARY_FORMAT,
    packageFilename,
    parsePackages,
    partyPrompt,
    playAsPcPrompt,
    portraitPayload,
    removeRecord,
    sanitizeRecords,
    serializePackage,
    synopsis,
    uniqueName,
    upsertRecord,
    type LibraryRecord,
} from './npc-library.js'

const CORE = '[CORE]\nSpecies: Human\nBody: Lean, weathered, a crooked nose.\nPersonality: Wary and dry.\nFriendship/Rapport: 40/100\n[/CORE]\n\nChronicle: met the party at the gate.'

const kestrel = (): LibraryRecord => createRecord({ id: 'k1', name: 'Kestrel', content: CORE, keys: ['Kes'], portraitPath: 'https://host/k.png', notes: 'scout' })

describe('the identity text', () => {
    it('keeps the first [CORE] block and drops the relationship lines and the chronicle', () => {
        // The dropped line leaves its blank behind, as the legacy leaves it.
        expect(identityOf(CORE)).toBe('[CORE]\nSpecies: Human\nBody: Lean, weathered, a crooked nose.\nPersonality: Wary and dry.\n\n[/CORE]')
    })

    it('keeps a text with no block, cleaned the same way', () => {
        expect(identityOf('Species: Elf\nAffection/Interest: 2/10\n\n\n\nPersonality: Kind')).toBe('Species: Elf\n\nPersonality: Kind')
    })

    it('gives the Player Card bio with the tags off', () => {
        expect(bioOf(CORE)).toBe('Species: Human\nBody: Lean, weathered, a crooked nose.\nPersonality: Wary and dry.')
    })
})

describe('records', () => {
    it('makes a record with the name first among the keys, the content reduced, the times set', () => {
        const record = kestrel()
        expect(record).toMatchObject({ id: 'k1', name: 'Kestrel', keys: ['Kestrel', 'Kes'], portraitPath: 'https://host/k.png', notes: 'scout' })
        expect(record.content).toBe(identityOf(CORE))
        expect(record.createdAt).toBeGreaterThan(0)
        expect(createRecord({ name: '  ', keys: 'a, b' }).name).toBe('Unnamed NPC')
        expect(createRecord({ name: 'Orrin', keys: 'a, b' }).keys).toEqual(['Orrin', 'a', 'b'])
    })

    it('inserts, replaces by id, and removes, handing the list back rather than keeping one', () => {
        const first = upsertRecord([], kestrel())
        expect(first.records).toHaveLength(1)
        const changed = upsertRecord(first.records, { ...kestrel(), notes: 'changed' }, 'k1')
        expect(changed.records).toHaveLength(1)
        expect(changed.stored.notes).toBe('changed')
        expect(changed.records[0]!.createdAt).toBe(first.stored.createdAt)
        const gone = removeRecord(changed.records, 'k1')
        expect(gone.removed?.name).toBe('Kestrel')
        expect(gone.records).toEqual([])
        expect(removeRecord([], 'nope').removed).toBeNull()
        expect(first.records).toHaveLength(1)
    })

    it('never changes the list it was given, and replaces the record overwriteId names whatever the new one\'s id', () => {
        const given = [kestrel()]
        const { records } = upsertRecord(given, { ...kestrel(), id: 'o', name: 'Orrin' })
        expect(given).toHaveLength(1)
        expect(records).toHaveLength(2)
        const replaced = upsertRecord(given, { ...kestrel(), id: 'fresh', notes: 'new text' }, 'k1')
        expect(replaced.records).toHaveLength(1)
        expect(replaced.stored.id).toBe('k1')
        expect(replaced.stored.notes).toBe('new text')
        expect(given[0]!.notes).toBe('scout')
    })

    it('finds by name without case, and by id', () => {
        const { records } = upsertRecord([], kestrel())
        expect(findByName(records, 'kestrel ')?.id).toBe('k1')
        expect(findByName(records, 'Orrin')).toBeNull()
        expect(findById(records, 'k1')?.name).toBe('Kestrel')
        expect(findById(records, '')).toBeNull()
    })

    it('gives a second record of a name a number', () => {
        const { records } = upsertRecord([], kestrel())
        expect(uniqueName('Kestrel', records)).toBe('Kestrel (2)')
        expect(uniqueName('Kestrel', records, 'k1')).toBe('Kestrel')
        expect(uniqueName('', [])).toBe('Imported NPC')
    })

    it('reduces stored records that still carry a chronicle', () => {
        const dirty = [{ ...kestrel(), content: CORE }]
        const { records, changed } = sanitizeRecords(dirty)
        expect(changed).toBe(true)
        expect(records[0]!.content).toBe(identityOf(CORE))
        expect(sanitizeRecords(records).changed).toBe(false)
    })
})

describe('the blurb', () => {
    it('is the species and body, then the personality', () => {
        expect(blurb(CORE)).toBe('Human — Lean, weathered, a crooked nose.\n\nWary and dry.')
        expect(synopsis(CORE)).toBe('Human — Lean, weathered, a crooked nose.')
    })

    it('falls back to the first lines, and is empty for nothing', () => {
        expect(blurb('A tired smith.\nOwes money.\nThird line.')).toBe('A tired smith. Owes money.')
        expect(blurb('')).toBe('')
    })
})

describe('packages', () => {
    it('serializes a record with its portrait inside, and reads it back', () => {
        const pkg = serializePackage(kestrel(), 'data:image/png;base64,AAAA')
        expect(pkg).toMatchObject({ format: LIBRARY_FORMAT, version: 1, name: 'Kestrel', keys: ['Kestrel', 'Kes'], notes: 'scout', portrait: { mime: 'image/png', data: 'AAAA' } })
        expect(serializePackage(kestrel()).portrait).toBeNull()
        const [back] = parsePackages(JSON.stringify(pkg))
        expect(back).toEqual({ name: 'Kestrel', keys: ['Kestrel', 'Kes'], content: identityOf(CORE), notes: 'scout', portrait: { mime: 'image/png', data: 'AAAA' } })
        expect(dataUrlFromPayload(back!.portrait)).toBe('data:image/png;base64,AAAA')
        expect(portraitPayload('not a data url')).toBeNull()
    })

    it('reads a pack and a plain list, and refuses the rest with the legacy\'s words', () => {
        const one = serializePackage(kestrel())
        expect(parsePackages(JSON.stringify({ format: 'multihog-npc-pack', npcs: [one, { ...one, name: 'Orrin' }] }))).toHaveLength(2)
        expect(parsePackages(JSON.stringify([one]))).toHaveLength(1)
        expect(() => parsePackages('nope')).toThrow('Could not parse that as JSON.')
        expect(() => parsePackages('[]')).toThrow('NPC pack is empty.')
        expect(() => parsePackages(JSON.stringify({ format: 'other', name: 'x', content: 'y' }))).toThrow('Not a Multihog NPC package (found "other").')
        expect(() => parsePackages(JSON.stringify({ name: '', content: 'y' }))).toThrow('NPC package is missing a name.')
        expect(() => parsePackages(JSON.stringify({ name: 'x', content: '' }))).toThrow('NPC package is missing NPC content.')
    })

    it('names the file after the record', () => {
        expect(packageFilename({ name: "Mother Sedge o' the Reeds" })).toBe('multihog_npc_mother_sedge_o_the_reeds.mnpc.json')
    })
})

describe('the prompts', () => {
    it('seat a card in the party with the name held and the identity below', () => {
        const prompt = partyPrompt(kestrel())
        expect(prompt.startsWith('Add this NPC to the active [PARTY] roster as a new companion.')).toBe(true)
        expect(prompt).toContain('(Kestrel joins the party.)')
        expect(prompt).toContain('- Preserve their name exactly: Kestrel')
        expect(prompt).toContain('If the active roster is already at the max size (5 + {{user}}), do not add them.')
        expect(prompt.endsWith(`NPC IDENTITY CARD:\nName: Kestrel\nKeywords: Kestrel, Kes\n\n${identityOf(CORE)}`)).toBe(true)
    })

    it('make a card the player character', () => {
        const prompt = playAsPcPrompt(kestrel())
        expect(prompt.startsWith("Replace the player's [CHARACTER] sheet with this identity. They are now the player character.")).toBe(true)
        expect(prompt).toContain('- Also output [INVENTORY], [ABILITIES], and/or [SPELLS] when those modules are enabled')
        expect(prompt).toContain('PLAYER IDENTITY CARD:\nName: Kestrel\nKeywords: Kestrel, Kes')
    })
})
