import { describe, expect, it } from 'vitest'

import { LOCATION_BOOK } from '../tracker/map.test.js'
import { extractMapSection, parseMapDocument, serializeMapDocument } from '../tracker/map.js'
import { bookCategory, bookKind, cleanEditKeys, createCampaignRecords, entryDTO, estimateTokens, type CampaignRecordsDeps } from './campaign-records.js'
import { MapStore } from './map-store.js'
import type { MemoStorage } from './memo-store.js'
import type { WorldBookStore, WorldEntry } from './world-pass.js'

function storage(): MemoStorage {
    const files = new Map<string, unknown>()
    return {
        async getJson<T>(path: string, options?: { fallback?: T }): Promise<T> { return (files.has(path) ? files.get(path) : options?.fallback) as T },
        async setJson(path: string, value: unknown): Promise<void> { files.set(path, JSON.parse(JSON.stringify(value))) },
    }
}

function makeBooks(seed: Record<string, Array<Partial<WorldEntry>>>) {
    const books: Array<{ id: string; name: string }> = []
    const entries = new Map<string, WorldEntry[]>()
    const log: string[] = []
    let n = 1
    for (const [name, list] of Object.entries(seed)) {
        const book = { id: `b${books.length + 1}`, name }
        books.push(book)
        entries.set(book.id, list.map((e, i) => ({ id: `e${n++}`, uid: e.uid ?? String(i + 1), key: e.key ?? [], content: e.content ?? '', comment: e.comment ?? '', extensions: {}, disabled: e.disabled ?? false, constant: e.constant ?? false })))
    }
    const store: WorldBookStore = {
        listBooks: async () => books.map((b) => ({ ...b })),
        createBook: async (name) => { const book = { id: `b${books.length + 1}`, name }; books.push(book); entries.set(book.id, []); return book },
        listEntries: async (id) => (entries.get(id) ?? []).map((e) => ({ ...e })),
        createEntry: async (id, entry) => { const made = { id: `e${n++}`, uid: String(n), ...entry, extensions: {} }; entries.get(id)!.push(made); return made },
        updateEntry: async (id, patch) => { for (const list of entries.values()) { const f = list.find((e) => e.id === id); if (f) Object.assign(f, patch) } log.push(`update ${id} ${Object.keys(patch).join(',')}`) },
        deleteEntry: async (id) => { for (const list of entries.values()) { const i = list.findIndex((e) => e.id === id); if (i >= 0) list.splice(i, 1) } log.push(`delete ${id}`) },
    }
    const find = (id: string) => [...entries.values()].flat().find((e) => e.id === id)
    return { store, find, log, books }
}

const SEED: Record<string, Array<Partial<WorldEntry>>> = {
    Vell_LOC: Object.values(LOCATION_BOOK).map((e) => ({ ...e, key: [e.comment], disabled: !!extractMapSection(e.content) })),
    Vell_NPC: [{ comment: 'Elara', key: ['Elara'], content: '[CORE]\nSpecies: Human\nRole: Innkeeper\n[/CORE]', constant: true }, { comment: 'Brin', key: ['Brin', 'the smith'], content: 'A smith.' }],
    Vell_World: [{ comment: 'Day 1', content: 'A report.' }],
    Elsewhere: [{ comment: 'Not ours', content: 'x' }],
}

function harness(seed = SEED, over: Partial<CampaignRecordsDeps> = {}) {
    const books = makeBooks(seed)
    const state = new MapStore(storage())
    const refreshed: string[] = []
    const log: string[] = []
    const deps: CampaignRecordsDeps = {
        store: () => books.store,
        campaign: async () => ({ prefix: 'Vell', owned: ['Vell_LOC', 'Vell_NPC', 'Vell_World'] }),
        mapping: { enabled: async () => true, state, refresh: async (chatId) => { refreshed.push(chatId) } },
        log: { info: (m) => log.push(m), warn: (m) => log.push(`warn: ${m}`) },
        ...over,
    }
    return { records: createCampaignRecords(deps), books, state, refreshed, log }
}

describe('the records’ shape (71a)', () => {
    it('classes a book by the legacy’s name rules and reads its category off the prefix', () => {
        expect(bookKind('Vell_NPC', 'Vell')).toBe('npc')
        expect(bookKind('Vell_NPCs', 'Vell')).toBe('npc')
        expect(bookKind('Vell_LOC', 'Vell')).toBe('location')
        expect(bookKind('Vell_Places', 'Vell')).toBe('location')
        expect(bookKind('Vell_World', 'Vell')).toBe('world')
        expect(bookKind('Vell_Skeleton', 'Vell')).toBe('skeleton')
        expect(bookKind('Vell_skeleton', 'Vell')).toBe('skeleton')
        expect(bookKind('Vell_Factions', 'Vell')).toBe('other')
        expect(bookCategory('Vell_Factions', 'Vell')).toBe('Factions')
        expect(bookCategory('Other', 'Vell')).toBe('Other')
    })

    it('draws an entry with the legacy’s token estimate, the map left out of the prose, and its standing', () => {
        const mapped = entryDTO({ id: 'e1', uid: '1', comment: 'Abbey Undercroft', key: ['Abbey Undercroft'], content: LOCATION_BOOK[1].content, disabled: true })
        expect(mapped).toMatchObject({ title: 'Abbey Undercroft', hasMap: true, root: true, disabled: true, pinned: false })
        expect(mapped.content).toBe('[CORE]\nA crypt beneath the abbey.\n[/CORE]')
        expect(mapped.tokens).toBe(estimateTokens(LOCATION_BOOK[1].content))
        expect(mapped.tokens).toBe(Math.round(mapped.content.length / 4))
        const child = entryDTO({ id: 'e2', uid: '2', comment: 'Abbey Undercroft :: Cellar Landing', key: [], content: 'The party rested here.', constant: true })
        expect(child).toMatchObject({ root: false, hasMap: false, pinned: true })
        expect(cleanEditKeys([' a ', 'b', 'a', '', 'c', 'd', 'e', 'f', 'g'])).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
    })
})

describe('the campaign’s records (71a)', () => {
    it('lists the campaign’s own books, NPCs first, Locations next, World last, with their entries, the mapped sites and every book of the host', async () => {
        const { records } = harness()
        const result = await records.list('c1', 'u1')
        expect(result.prefix).toBe('Vell')
        expect(result.books.map((b) => [b.name, b.kind, b.category, b.entries.length])).toEqual([['Vell_NPC', 'npc', 'NPC', 2], ['Vell_LOC', 'location', 'LOC', 4], ['Vell_World', 'world', 'World', 1]])
        expect(result.books[0]!.entries[0]).toMatchObject({ title: 'Elara', pinned: true, keys: ['Elara'] })
        expect(result.books[0]!.tokens).toBe(result.books[0]!.entries.reduce((s, e) => s + e.tokens, 0))
        expect(result.books[1]!.entries.filter((e) => e.hasMap).map((e) => e.title)).toEqual(['Abbey Undercroft', 'Morrowfen'])
        expect(result.mapping).toBe(true)
        expect(result.mapped.map((m) => m.siteRoot).sort()).toEqual(['Abbey Undercroft', 'Morrowfen'])
        expect(result.mapped.every((m) => !m.hosted)).toBe(true)
        expect(result.allBooks).toEqual(['Elsewhere', 'Vell_LOC', 'Vell_NPC', 'Vell_World'])
        // The World Skeleton's seed book is its own kind, listed after the reports (78b-bis): it filed as a second World.
        const seeded = harness({ ...SEED, Vell_Skeleton: [{ comment: 'FACTION: The Night Shift Network', content: 'A seed.', disabled: true }] }, { campaign: async () => ({ prefix: 'Vell', owned: ['Vell_LOC', 'Vell_NPC', 'Vell_World', 'Vell_Skeleton'] }) })
        const withSkeleton = await seeded.records.list('c1', 'u1')
        expect(withSkeleton.books.map((b) => [b.name, b.kind, b.category])).toEqual([['Vell_NPC', 'npc', 'NPC'], ['Vell_LOC', 'location', 'LOC'], ['Vell_World', 'world', 'World'], ['Vell_Skeleton', 'skeleton', 'Skeleton']])
        // With the mapping section off, no MAP badges and no peers.
        const off = harness(SEED, { mapping: { enabled: async () => false, state: new MapStore(storage()), refresh: async () => undefined } })
        expect(await off.records.list('c1', 'u1')).toMatchObject({ mapping: false, mapped: [] })
        // An unnamed campaign has no books.
        const unnamed = harness(SEED, { campaign: async () => ({ prefix: '', owned: [] }) })
        expect((await unnamed.records.list('c1', 'u1')).books).toEqual([])
        // A failed read is reported, not thrown.
        const broken = harness(SEED, { campaign: async () => { throw new Error('PERMISSION_DENIED') } })
        expect((await broken.records.list('c1', 'u1')).problem).toBe('PERMISSION_DENIED')
    })

    it('edits the prose, the title and the keys and keeps the map as it stands', async () => {
        const { records, books, refreshed } = harness()
        const plain = (await records.update('c1', 'u1', { entryId: 'e6', title: ' Brin the Smith ', keys: [' Brin ', 'smith', 'Brin'], content: 'A smith of Vell.' })).entry
        expect(plain).toMatchObject({ title: 'Brin the Smith', keys: ['Brin', 'smith'], content: 'A smith of Vell.' })
        expect(books.find('e6')).toMatchObject({ comment: 'Brin the Smith', key: ['Brin', 'smith'], content: 'A smith of Vell.' })
        expect(refreshed).toEqual([])
        const mapped = (await records.update('c1', 'u1', { entryId: 'e1', title: 'Abbey Undercroft', keys: ['Abbey Undercroft'], content: '[CORE]\nA crypt, now described.\n[/CORE]' })).entry
        expect(mapped.content).toBe('[CORE]\nA crypt, now described.\n[/CORE]')
        expect(mapped.hasMap).toBe(true)
        const stored = books.find('e1')!
        expect(extractMapSection(stored.content)).toBe(extractMapSection(LOCATION_BOOK[1].content))
        expect(stored.content.startsWith('[CORE]\nA crypt, now described.\n[/CORE]')).toBe(true)
        expect(refreshed).toEqual(['c1'])
        await expect(records.update('c1', 'u1', { entryId: 'e6', title: '  ', keys: [], content: 'x' })).rejects.toThrow(/needs a title/)
        await expect(records.update('c1', 'u1', { entryId: 'e9', title: 'x', keys: [], content: 'x' })).rejects.toThrow(/not in any of this campaign’s books/)
    })

    it('pins through the host’s constant flag, enabling the entry, and refuses a mapped root', async () => {
        const { records, books } = harness()
        books.find('e6')!.disabled = true
        expect((await records.pin('c1', 'u1', 'e6', true)).entry).toMatchObject({ pinned: true, disabled: false })
        expect(books.find('e6')).toMatchObject({ constant: true, disabled: false })
        expect((await records.pin('c1', 'u1', 'e6', false)).entry.pinned).toBe(false)
        expect(books.find('e6')!.constant).toBe(false)
        await expect(records.pin('c1', 'u1', 'e1', true)).rejects.toThrow(/mapped root cannot be pinned/)
        expect(books.find('e1')!.constant).toBe(false)
    })

    it('removes a map from its root, puts the root back into the scan, forgets the site’s evolution and re-reads the maps', async () => {
        const { records, books, state, refreshed } = harness()
        await state.save('c1', { threadsBySite: { 'abbey undercroft': [{ x: 1 }], morrowfen: [] }, evolution: { lastFiredBySite: { 'abbey undercroft': 'Day 2', morrowfen: 'Day 1' }, backlogBySite: { 'abbey undercroft': [{}] }, reportApplications: { 'abbey undercroft': {} }, lastSiteRoot: 'Abbey Undercroft', pendingExitRoot: 'Abbey Undercroft', intervalHoursBySite: {} } }, 'u1')
        const result = await records.removeMap('c1', 'u1', 'e1')
        expect(result.siteRoot).toBe('Abbey Undercroft')
        expect(result.entry).toMatchObject({ hasMap: false, disabled: false, content: '[CORE]\nA crypt beneath the abbey.\n[/CORE]' })
        expect(books.find('e1')).toMatchObject({ disabled: false, content: '[CORE]\nA crypt beneath the abbey.\n[/CORE]' })
        const record = await state.load('c1', 'u1')
        expect(record.evolution.lastFiredBySite).toEqual({ morrowfen: 'Day 1' })
        expect(record.evolution.backlogBySite).toEqual({})
        expect(record.threadsBySite).toEqual({ morrowfen: [] })
        expect(record.evolution.lastSiteRoot).toBe('')
        expect(record.evolution.pendingExitRoot).toBe('')
        expect(refreshed).toEqual(['c1'])
        await expect(records.removeMap('c1', 'u1', 'e4')).rejects.toThrow(/has no map/)
    })

    it('deletes an entry, and a mapped root with its site’s evolution', async () => {
        const { records, books, state, refreshed } = harness()
        await state.save('c1', { evolution: { lastFiredBySite: { morrowfen: 'Day 1' }, backlogBySite: {}, reportApplications: {}, lastSiteRoot: 'Morrowfen', pendingExitRoot: '', intervalHoursBySite: {} } }, 'u1')
        expect(await records.remove('c1', 'u1', 'e6')).toEqual({ removed: true, title: 'Brin' })
        expect(books.find('e6')).toBeUndefined()
        expect(refreshed).toEqual([])
        expect(await records.remove('c1', 'u1', 'e3')).toEqual({ removed: true, title: 'Morrowfen' })
        expect((await state.load('c1', 'u1')).evolution).toMatchObject({ lastFiredBySite: {}, lastSiteRoot: '' })
        expect(refreshed).toEqual(['c1'])
    })

    it('hands out a site’s map as JSON and saves one back, the site name held and the root kept out of the scan', async () => {
        const { records, books, refreshed } = harness()
        const raw = await records.rawGet('c1', 'u1', 'abbey undercroft')
        expect(raw).toMatchObject({ siteRoot: 'Abbey Undercroft', entryId: 'Vell_LOC::1', bookName: 'Vell_LOC' })
        const document = JSON.parse(raw.json)
        expect(document.areas.map((a: { id: string }) => a.id)).toEqual(['landing', 'crypt', 'vault'])
        await expect(records.rawGet('c1', 'u1', 'Glassmere')).rejects.toThrow(/not a mapped site/)
        document.areas[0].name = 'Cellar Landing, swept'
        const saved = await records.rawSet('c1', 'u1', 'Abbey Undercroft', JSON.stringify(document))
        expect(saved).toEqual({ siteRoot: 'Abbey Undercroft', areas: 3, assets: document.assets.length })
        const stored = parseMapDocument(extractMapSection(books.find('e1')!.content)).document
        expect(stored.areas[0]!.name).toBe('Cellar Landing, swept')
        expect(serializeMapDocument(stored)).toBe(serializeMapDocument(document))
        expect(books.find('e1')!.disabled).toBe(true)
        expect(books.find('e1')!.content.startsWith('[CORE]\nA crypt beneath the abbey.\n[/CORE]')).toBe(true)
        expect(refreshed).toEqual(['c1'])
        await expect(records.rawSet('c1', 'u1', 'Abbey Undercroft', '{not json')).rejects.toThrow(/could not be read/)
        await expect(records.rawSet('c1', 'u1', 'Abbey Undercroft', '[1]')).rejects.toThrow(/one map document/)
        await expect(records.rawSet('c1', 'u1', 'Abbey Undercroft', JSON.stringify({ ...document, site: 'Elsewhere' }))).rejects.toThrow(/must stay "Abbey Undercroft"/)
    })
})
