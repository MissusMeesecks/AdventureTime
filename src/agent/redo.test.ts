import { describe, expect, it } from 'vitest'

import { applyRedo, captureForRedo, createRedoStack, describeRedo, MAX_REDO, redoDidSomething, type RedoEntry, type RedoStore } from './redo.js'
import type { LorePassSnapshot } from './undo.js'

function makeStore(seed: Record<string, Array<{ uid: string; content: string; comment?: string; key?: string[] }>>) {
    const books: Array<{ id: string; name: string }> = []
    const entries = new Map<string, Array<{ id: string; uid: string; key: string[]; content: string; comment: string }>>()
    let n = 1
    for (const [name, list] of Object.entries(seed)) {
        const book = { id: `b${books.length + 1}`, name }
        books.push(book)
        entries.set(book.id, list.map((e) => ({ id: `e${n++}`, uid: e.uid, key: e.key ?? [], content: e.content, comment: e.comment ?? '' })))
    }
    const store: RedoStore = {
        listBooks: async () => books.map((b) => ({ ...b })),
        createBook: async (name) => { const book = { id: `b${books.length + 1}`, name }; books.push(book); entries.set(book.id, []); return { ...book } },
        listEntries: async (id) => (entries.get(id) ?? []).map((e) => ({ ...e })),
        createEntry: async (id, entry) => { const list = entries.get(id)!; const made = { id: `e${n++}`, uid: String(list.length + 1), ...entry }; list.push(made); return { ...made } },
        updateEntry: async (id, patch) => { for (const list of entries.values()) { const f = list.find((e) => e.id === id); if (f) Object.assign(f, patch) } },
        deleteEntry: async (id) => { for (const [bid, list] of entries) entries.set(bid, list.filter((e) => e.id !== id)) },
        deleteBook: async (id) => { const i = books.findIndex((b) => b.id === id); if (i >= 0) books.splice(i, 1); entries.delete(id) },
    }
    const contents = (name: string) => (entries.get(books.find((b) => b.name === name)?.id ?? '') ?? []).map((e) => e.content)
    return { store, contents, names: () => books.map((b) => b.name) }
}

const snapshot = (over: Partial<LorePassSnapshot>): LorePassSnapshot => ({ chatId: 'c1', at: '', prefix: 'Vell', books: [], ownedBooks: [], createdBooks: [], ...over })

describe('the redo stack (71c)', () => {
    it('keeps the undone passes per chat, newest out first, five at most, and forgets a chat whole', () => {
        const stack = createRedoStack()
        const entry = (n: number): RedoEntry => ({ pre: snapshot({ at: `pre${n}` }), post: snapshot({ at: `post${n}` }) })
        for (let i = 1; i <= MAX_REDO + 2; i++) stack.push('c1', entry(i))
        stack.push('c2', entry(9))
        expect(stack.waiting('c1')).toBe(MAX_REDO)
        expect(stack.pop('c1')?.pre.at).toBe(`pre${MAX_REDO + 2}`)
        expect(stack.pop('c1')?.pre.at).toBe(`pre${MAX_REDO + 1}`)
        expect(stack.waiting('c1')).toBe(MAX_REDO - 2)
        stack.clear('c1')
        expect(stack.waiting('c1')).toBe(0)
        expect(stack.pop('c1')).toBeNull()
        expect(stack.waiting('c2')).toBe(1)
    })
})

describe('writing an undone pass back (71c)', () => {
    it('captures every book the campaign owns now, the pass’s own included', async () => {
        const { store } = makeStore({ Vell_NPC: [{ uid: 'a', content: 'Bram' }], Vell_EVENT: [{ uid: 'e', content: 'the fire' }], Other_NPC: [{ uid: 'o', content: 'not ours' }] })
        const post = await captureForRedo(store, 'c1', 'Vell', ['Vell_NPC', 'Vell_EVENT'])
        expect(post.books.map((b) => b.name)).toEqual(['Vell_NPC', 'Vell_EVENT'])
        expect(post.ownedBooks).toEqual(['Vell_NPC', 'Vell_EVENT'])
        expect(post.createdBooks).toEqual([])
    })

    it('restores a rewritten entry, writes a removed one again, removes a put-back one, and makes a deleted book again', async () => {
        // The pass rewrote a, created b, created the book Vell_EVENT; the undo put a back, removed b, deleted the book.
        const { store, contents, names } = makeStore({ Vell_NPC: [{ uid: 'a', content: 'Bram the old' }] })
        const entry: RedoEntry = {
            pre: snapshot({ books: [{ name: 'Vell_NPC', entries: [{ uid: 'a', key: [], content: 'Bram the old', comment: '' }] }], ownedBooks: ['Vell_NPC'], createdBooks: ['Vell_EVENT'] }),
            post: snapshot({
                books: [
                    { name: 'Vell_NPC', entries: [{ uid: 'a', key: ['bram'], content: 'Bram the new', comment: 'Bram' }, { uid: 'b', key: ['ivo'], content: 'Ivo', comment: 'Ivo' }] },
                    { name: 'Vell_EVENT', entries: [{ uid: '1', key: ['fire'], content: 'the fire', comment: 'Fire' }] },
                ],
                ownedBooks: ['Vell_NPC', 'Vell_EVENT'],
            }),
        }
        const done = await applyRedo(entry, store)
        expect(done.madeBooks).toEqual(['Vell_EVENT'])
        expect(done.restore).toHaveLength(1)
        expect(done.recreate.map((r) => r.entry.uid).sort()).toEqual(['1', 'b'])
        expect(done.problems).toEqual([])
        expect(names()).toEqual(['Vell_NPC', 'Vell_EVENT'])
        expect(contents('Vell_NPC')).toEqual(['Bram the new', 'Ivo'])
        expect(contents('Vell_EVENT')).toEqual(['the fire'])
        expect(redoDidSomething(done)).toBe(true)
        expect(describeRedo(done)).toBe('Redone: 1 book made again, 2 entries written again, 1 entry restored.')
    })

    it('removes an entry the undo put back and keeps one that holds a map', async () => {
        const { store, contents } = makeStore({ Vell_LOC: [{ uid: 'x', content: 'put back by the undo' }, { uid: 'm', content: 'a root\n[MAP]{"site":"Cellar"}[/MAP]' }] })
        const entry: RedoEntry = {
            pre: snapshot({}),
            post: snapshot({ books: [{ name: 'Vell_LOC', entries: [] }], ownedBooks: ['Vell_LOC'] }),
        }
        const done = await applyRedo(entry, store)
        expect(done.remove).toHaveLength(1)
        expect(contents('Vell_LOC')).toEqual(['a root\n[MAP]{"site":"Cellar"}[/MAP]'])
        expect(done.problems[0]).toMatch(/holds a map/)
        expect(describeRedo(done)).toBe('Redone: 1 entry removed. 1 could not be redone.')
    })

    it('says when the books already match', async () => {
        const { store } = makeStore({ Vell_NPC: [{ uid: 'a', content: 'Bram' }] })
        const done = await applyRedo({ pre: snapshot({}), post: snapshot({ books: [{ name: 'Vell_NPC', entries: [{ uid: 'a', key: [], content: 'Bram', comment: '' }] }], ownedBooks: ['Vell_NPC'] }) }, store)
        expect(redoDidSomething(done)).toBe(false)
        expect(describeRedo(done)).toBe('Nothing to redo — the books already match.')
    })

    it('names a book that could not be made again and goes on', async () => {
        const { store } = makeStore({})
        store.createBook = async () => { throw new Error('host down') }
        const done = await applyRedo({ pre: snapshot({}), post: snapshot({ books: [{ name: 'Vell_NPC', entries: [{ uid: 'a', key: [], content: 'Bram', comment: '' }] }] }) }, store)
        expect(done.madeBooks).toEqual([])
        expect(done.problems.join(' ')).toMatch(/could not be made again: Error: host down/)
        expect(done.problems.join(' ')).toMatch(/no longer exists/)
    })
})
