import { describe, it, expect } from 'vitest'
import type { WorldBookDTO, WorldBookEntryCreateDTO, WorldBookEntryDTO } from 'lumiverse-spindle-types'

import { getOrCreateBook, upsertEntry, type WorldBooksApi } from './world-books.js'

/** A world-book store with paging, so the paging logic is actually exercised. */
function makeApi(books: string[] = [], entriesPerBook: Record<string, string[]> = {}) {
    const bookList: WorldBookDTO[] = books.map((name, i) => ({
        id: `b${i}`, name, description: '', metadata: {}, created_at: 0, updated_at: 0,
    }))
    const entries = new Map<string, WorldBookEntryDTO[]>()
    for (const [bookId, comments] of Object.entries(entriesPerBook)) {
        entries.set(bookId, comments.map((comment, i) => ({ id: `${bookId}-e${i}`, comment } as WorldBookEntryDTO)))
    }

    const calls: string[] = []

    const api: WorldBooksApi = {
        async list(options) {
            calls.push('books.list')
            const offset = options?.offset ?? 0
            const limit = options?.limit ?? 100
            return { data: bookList.slice(offset, offset + limit), total: bookList.length }
        },
        async create(input) {
            calls.push('books.create')
            const book: WorldBookDTO = {
                id: `b${bookList.length}`, name: input.name, description: '', metadata: {},
                created_at: 0, updated_at: 0,
            }
            bookList.push(book)
            return book
        },
        entries: {
            async list(worldBookId, options) {
                calls.push('entries.list')
                const all = entries.get(worldBookId) ?? []
                const offset = options?.offset ?? 0
                const limit = options?.limit ?? 100
                return { data: all.slice(offset, offset + limit), total: all.length }
            },
            async create(worldBookId, input: WorldBookEntryCreateDTO) {
                calls.push('entries.create')
                const all = entries.get(worldBookId) ?? []
                const entry = { id: `${worldBookId}-e${all.length}`, ...input } as WorldBookEntryDTO
                entries.set(worldBookId, [...all, entry])
                return entry
            },
            async update(entryId, input) {
                calls.push('entries.update')
                return { id: entryId, ...input } as WorldBookEntryDTO
            },
        },
    }

    return { api, calls, bookList, entries }
}

describe('getOrCreateBook', () => {
    it('returns an existing book rather than making a second one', async () => {
        const { api, calls } = makeApi(['Vellmoor'])
        const book = await getOrCreateBook(api, 'Vellmoor')

        expect(book.name).toBe('Vellmoor')
        expect(calls).not.toContain('books.create')
    })

    it('creates the book when it does not exist', async () => {
        const { api, bookList } = makeApi(['Other'])
        const book = await getOrCreateBook(api, 'Vellmoor')

        expect(book.name).toBe('Vellmoor')
        expect(bookList).toHaveLength(2)
    })

    it('matches names exactly — two campaigns are two campaigns', async () => {
        const { api, bookList } = makeApi(['vellmoor'])
        await getOrCreateBook(api, 'Vellmoor')
        expect(bookList).toHaveLength(2)
    })
})

describe('upsertEntry', () => {
    it('creates an entry that is not there yet', async () => {
        const { api, entries } = makeApi(['Book'], { b0: [] })
        await upsertEntry(api, 'b0', { comment: 'Vex', content: 'A rogue.' })

        expect(entries.get('b0')).toHaveLength(1)
    })

    it('updates an existing entry instead of duplicating it', async () => {
        const { api, calls } = makeApi(['Book'], { b0: ['Vex'] })
        const entry = await upsertEntry(api, 'b0', { comment: 'Vex', content: 'A rogue, now wounded.' })

        expect(calls).toContain('entries.update')
        expect(calls).not.toContain('entries.create')
        expect(entry.id).toBe('b0-e0')
    })

    it('matches on comment, not on activation keys', async () => {
        // The agent refines an entry's keywords as it learns better triggers.
        // Matching on keys would make a new entry every time it did.
        const { api, calls } = makeApi(['Book'], { b0: ['Vex'] })
        await upsertEntry(api, 'b0', { comment: 'Vex', key: ['vex', 'the rogue'], content: 'x' })

        expect(calls).toContain('entries.update')
    })

    it('finds a match on a later page', async () => {
        const comments = Array.from({ length: 150 }, (_, i) => `Entry ${i}`)
        const { api, calls } = makeApi(['Book'], { b0: comments })
        await upsertEntry(api, 'b0', { comment: 'Entry 140', content: 'x' })

        expect(calls.filter((c) => c === 'entries.list')).toHaveLength(2)
        expect(calls).toContain('entries.update')
    })
})
