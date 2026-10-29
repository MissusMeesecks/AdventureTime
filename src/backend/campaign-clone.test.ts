import { describe, expect, it } from 'vitest'

import { cloneCampaignStack, cloneName, type CloneStore } from './campaign-clone.js'

function makeStore(seed: Record<string, Array<{ key?: string[]; content: string; comment?: string; disabled?: boolean; constant?: boolean; extensions?: Record<string, unknown> }>>) {
    const books: Array<{ id: string; name: string }> = []
    const entries = new Map<string, Array<Record<string, unknown>>>()
    for (const [name, list] of Object.entries(seed)) {
        const book = { id: `b${books.length + 1}`, name }
        books.push(book)
        entries.set(book.id, list.map((e) => ({ key: e.key ?? [], content: e.content, comment: e.comment ?? '', ...(e.disabled !== undefined ? { disabled: e.disabled } : {}), ...(e.constant !== undefined ? { constant: e.constant } : {}), ...(e.extensions ? { extensions: e.extensions } : {}) })))
    }
    const created: Array<[string, Record<string, unknown>]> = []
    const store: CloneStore = {
        listBooks: async () => books.map((b) => ({ ...b })),
        createBook: async (name) => { const book = { id: `b${books.length + 1}`, name }; books.push(book); entries.set(book.id, []); return { ...book } },
        listEntries: async (id) => (entries.get(id) ?? []).map((e) => ({ ...e })) as never,
        createEntry: async (id, entry) => { created.push([books.find((b) => b.id === id)!.name, entry]); entries.get(id)!.push(entry) },
    }
    return { store, created, names: () => books.map((b) => b.name) }
}

describe('cloning the campaign’s books (71c)', () => {
    it('names the copies as the legacy does', () => {
        expect(cloneName('Vell', 'Vell', 'Branch')).toBe('Branch')
        expect(cloneName('Vell_NPC', 'Vell', 'Branch')).toBe('Branch_NPC')
        expect(cloneName('vell_LOC', 'Vell', 'Branch')).toBe('Branch_LOC')
        expect(cloneName('Odd', 'Vell', 'Branch')).toBe('Branch_Odd')
    })

    it('copies every owned book whole under the new prefix, flags and extensions with it, and nothing else', async () => {
        const { store, created, names } = makeStore({
            Vell_NPC: [{ key: ['bram'], content: 'Bram', comment: 'Bram', disabled: false, constant: true }],
            Vell_LOC: [{ key: ['cellar'], content: 'a root\n[MAP]x[/MAP]', comment: 'Cellar', disabled: true, extensions: { adventure_time: { map: true } } }],
            Vell_Stray: [{ content: 'named like ours, not owned' }],
            Other_NPC: [{ content: 'someone else’s' }],
        })
        const result = await cloneCampaignStack({ store, prefix: 'Vell', owned: ['Vell_NPC', 'Vell_LOC'], newPrefix: ' Eldoria Branch 1 ' })
        expect(result).toEqual({ newPrefix: 'Eldoria_Branch_1', cloned: ['Eldoria_Branch_1_NPC', 'Eldoria_Branch_1_LOC'], errors: [] })
        expect(names()).toEqual(['Vell_NPC', 'Vell_LOC', 'Vell_Stray', 'Other_NPC', 'Eldoria_Branch_1_NPC', 'Eldoria_Branch_1_LOC'])
        expect(created).toEqual([
            ['Eldoria_Branch_1_NPC', { key: ['bram'], content: 'Bram', comment: 'Bram', disabled: false, constant: true }],
            ['Eldoria_Branch_1_LOC', { key: ['cellar'], content: 'a root\n[MAP]x[/MAP]', comment: 'Cellar', disabled: true, extensions: { adventure_time: { map: true } } }],
        ])
    })

    it('refuses an empty prefix, the same prefix, nothing to clone, and a name already taken, writing nothing', async () => {
        const { store, created } = makeStore({ Vell_NPC: [{ content: 'Bram' }], Branch_NPC: [{ content: 'taken' }] })
        expect((await cloneCampaignStack({ store, prefix: 'Vell', owned: ['Vell_NPC'], newPrefix: '!!!' })).refused).toBe('New prefix cannot be empty or contain only special characters.')
        expect((await cloneCampaignStack({ store, prefix: 'Vell', owned: ['Vell_NPC'], newPrefix: 'vell' })).refused).toBe('New prefix is the same as the current prefix. Please choose a different name.')
        expect((await cloneCampaignStack({ store, prefix: 'Vell', owned: [], newPrefix: 'Branch' })).refused).toBe('No lorebooks found for prefix "Vell". Nothing to clone.')
        const collided = await cloneCampaignStack({ store, prefix: 'Vell', owned: ['Vell_NPC'], newPrefix: 'Branch' })
        expect(collided.refused).toBe('Clone aborted to protect existing lorebooks:\n- Branch_NPC\nChoose a different prefix, or rename/delete the conflicting books first.')
        expect(collided.cloned).toEqual([])
        expect(created).toEqual([])
    })

    it('names a book that could not be copied and copies the rest', async () => {
        const { store } = makeStore({ Vell_NPC: [{ content: 'Bram' }], Vell_LOC: [{ content: 'Cellar' }] })
        const create = store.createBook
        store.createBook = async (name) => { if (name.endsWith('_NPC')) throw new Error('host down'); return create(name) }
        const result = await cloneCampaignStack({ store, prefix: 'Vell', owned: ['Vell_NPC', 'Vell_LOC'], newPrefix: 'Branch' })
        expect(result.cloned).toEqual(['Branch_LOC'])
        expect(result.errors).toEqual(['Branch_NPC: host down'])
        expect(result.refused).toBeUndefined()
    })
})
