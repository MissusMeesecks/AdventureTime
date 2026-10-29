import { describe, expect, it } from 'vitest'

import { WORLD_LORE_SEPARATOR, buildWorldLoreContext, selectLoreBooks, worldLoreLabel } from './world-lore.js'

const BOOKS = [{ id: 'b1', name: 'Vell_NPC' }, { id: 'b2', name: 'Vell_LOC' }, { id: 'b3', name: 'Shared canon' }]

describe('the lorebooks shown to the tracker (73h)', () => {
    it('selects every book on an empty filter, and the named ones otherwise, in the host’s order, trimming the names', () => {
        expect(selectLoreBooks(BOOKS, [])).toEqual(BOOKS)
        expect(selectLoreBooks(BOOKS, ['  ', ''])).toEqual(BOOKS)
        expect(selectLoreBooks(BOOKS, ['Shared canon', ' Vell_NPC '])).toEqual([BOOKS[0], BOOKS[2]])
        expect(selectLoreBooks(BOOKS, ['Nowhere'])).toEqual([])
    })

    it('with the chat scope, an empty filter selects the books linked to the chat alone, by id, and a named filter still wins (73h-bis)', () => {
        expect(selectLoreBooks(BOOKS, [], 'chat', ['b3', 'b1', 'b9'])).toEqual([BOOKS[0], BOOKS[2]])
        expect(selectLoreBooks(BOOKS, [], 'chat', [])).toEqual([])
        expect(selectLoreBooks(BOOKS, ['Vell_LOC'], 'chat', ['b1'])).toEqual([BOOKS[1]])
        expect(worldLoreLabel([], 'chat')).toBe('This chat’s books')
        expect(worldLoreLabel(['Vell_LOC'], 'chat')).toBe('Filtered: Vell_LOC')
        expect(buildWorldLoreContext(['One.'], [], 'chat')).toBe('## WORLD LORE (This chat’s books)\nOne.')
    })

    it('labels the section as the legacy does: the filter’s names, or All Books', () => {
        expect(worldLoreLabel([])).toBe('All Books')
        expect(worldLoreLabel(['Vell_NPC', 'Shared canon'])).toBe('Filtered: Vell_NPC, Shared canon')
    })

    it('builds the legacy’s section — the heading, the entries parted by a rule — and nothing when no entry has content', () => {
        expect(WORLD_LORE_SEPARATOR).toBe('\n---\n')
        expect(buildWorldLoreContext(['A keep on the moor.', '', 'A ferryman named Oss.'], [])).toBe('## WORLD LORE (All Books)\nA keep on the moor.\n---\nA ferryman named Oss.')
        expect(buildWorldLoreContext(['One.'], ['Vell_LOC'])).toBe('## WORLD LORE (Filtered: Vell_LOC)\nOne.')
        expect(buildWorldLoreContext([], [])).toBe('')
        expect(buildWorldLoreContext(['', ''], ['X'])).toBe('')
    })
})
