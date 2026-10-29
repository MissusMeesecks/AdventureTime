import { describe, expect, it } from 'vitest'

import { buildGameSystemFile, freeTag, importGameSystem, readGameSystemFile } from './game-system-file.js'

const SETTINGS = {
    gameSystems: [{ id: 'gs1', name: 'Sanity', icon: '🧠', enabled: true, customFieldTag: 'SANITY', syspromptLibraryId: 'sec1' }, { id: 'gs2', name: 'GM only', syspromptLibraryId: 'sec2' }],
    customFields: [{ tag: 'SANITY', label: 'Sanity', icon: '🧠', prompt: 'Track sanity.', enabled: true }],
    customSyspromptLibrary: [{ id: 'sec1', tag: 'sanity', content: 'Sanity rules.', enabled: true }, { id: 'sec2', tag: 'gm', content: 'x', enabled: true }],
}

describe('a game system as a file (72b)', () => {
    it('carries the system with its field and its section, or none of either, and nothing for an id not there', () => {
        const file = buildGameSystemFile(SETTINGS, 'gs1')!
        expect(file.adventuretimeGameSystem.system.name).toBe('Sanity')
        expect(file.adventuretimeGameSystem.field).toEqual(SETTINGS.customFields[0])
        expect(file.adventuretimeGameSystem.section).toEqual(SETTINGS.customSyspromptLibrary[0])
        expect(buildGameSystemFile(SETTINGS, 'gs2')!.adventuretimeGameSystem.field).toBeNull()
        expect(buildGameSystemFile(SETTINGS, 'nope')).toBeNull()
        expect(readGameSystemFile(JSON.stringify(file)).system.name).toBe('Sanity')
        expect(() => readGameSystemFile('{')).toThrow('The file is not JSON.')
        expect(() => readGameSystemFile('{"a":1}')).toThrow('holds no game system')
        expect(() => readGameSystemFile('{"adventuretimeGameSystem":{"system":{"name":" "}}}')).toThrow('holds no game system')
        // A file exported before the rename (0.156.0) still reads.
        expect(readGameSystemFile('{"lumihogGameSystem":{"system":{"name":"Old"}}}').system.name).toBe('Old')
    })

    it('imports under a new id, a free tag and a new section id, appending to the three lists', () => {
        const file = buildGameSystemFile(SETTINGS, 'gs1')!.adventuretimeGameSystem
        const { patch, name, tag } = importGameSystem(SETTINGS, file, () => 'gs9')
        expect(name).toBe('Sanity')
        expect(tag).toBe('SANITY_2')
        expect((patch.gameSystems as Array<Record<string, unknown>>).map((s) => s.id)).toEqual(['gs1', 'gs2', 'gs9'])
        expect((patch.gameSystems as Array<Record<string, unknown>>)[2]).toMatchObject({ id: 'gs9', customFieldTag: 'SANITY_2', syspromptLibraryId: 'gs9_gm' })
        expect((patch.customFields as Array<Record<string, unknown>>).map((f) => f.tag)).toEqual(['SANITY', 'SANITY_2'])
        expect((patch.customSyspromptLibrary as Array<Record<string, unknown>>).map((s) => s.id)).toEqual(['sec1', 'sec2', 'gs9_gm'])
        const gmOnly = importGameSystem(SETTINGS, buildGameSystemFile(SETTINGS, 'gs2')!.adventuretimeGameSystem, () => 'gs8')
        expect(gmOnly.tag).toBeNull()
        expect(gmOnly.patch.customFields).toBeUndefined()
        expect((gmOnly.patch.gameSystems as Array<Record<string, unknown>>)[2]).not.toHaveProperty('customFieldTag')
        expect(freeTag('trail', [])).toBe('TRAIL')
        expect(freeTag('a b!', ['A_B_'])).toBe('A_B__2')
        expect(freeTag('', [])).toBe('SYSTEM')
    })
})
