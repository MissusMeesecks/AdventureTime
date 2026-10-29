import { describe, expect, it } from 'vitest'

import { LOCATION_BOOK } from '../tracker/map.test.js'
import { createMapSync, isLocationBookName, type MapBookReader, type MapSyncDeps } from './map-sync.js'
import { MapStore } from './map-store.js'
import type { MemoStorage } from './memo-store.js'

function storage(): MemoStorage {
    const files = new Map<string, unknown>()
    return {
        async getJson<T>(path: string, options?: { fallback?: T }): Promise<T> { return (files.has(path) ? files.get(path) : options?.fallback) as T },
        async setJson(path: string, value: unknown): Promise<void> { files.set(path, JSON.parse(JSON.stringify(value))) },
    }
}

function reader(seed: Record<string, Record<string, { comment: string; content: string }>>): MapBookReader & { reads: string[] } {
    const books = Object.keys(seed).map((name, i) => ({ id: `b${i + 1}`, name }))
    const reads: string[] = []
    return {
        reads,
        listBooks: async () => books.map((b) => ({ ...b })),
        listEntries: async (id) => {
            const book = books.find((b) => b.id === id)!
            reads.push(book.name)
            return Object.entries(seed[book.name]!).map(([uid, e]) => ({ uid, comment: e.comment, content: e.content }))
        },
    }
}

const BOOKS = {
    Vell_LOC: LOCATION_BOOK,
    Vell_NPC: { 1: { comment: 'Ilyra', content: '[MAP]\n{"site":"Not a place"}\n[/MAP]' } },
    Other_LOC: { 1: { comment: 'Elsewhere', content: '[MAP]\n{"version":3,"site":"Elsewhere","areas":[],"assets":[]}\n[/MAP]' } },
    'Shared Places': { 1: { comment: 'Old Barrow', content: '[MAP]\n{"version":3,"site":"Old Barrow","areas":[],"assets":[]}\n[/MAP]' } },
    Vell_World: { 1: { comment: 'Day 2', content: 'a report' } },
}

function harness(over: Partial<MapSyncDeps> = {}, turn = { reply: '*(Location: Abbey Undercroft, Cellar Landing)*', userText: 'Back to Morrowfen soon.' }, seed = BOOKS) {
    const books = reader(seed)
    const state = new MapStore(storage())
    const log: string[] = []
    const deps: MapSyncDeps = {
        store: () => books,
        campaign: async () => ({ prefix: 'Vell', owned: ['Vell_LOC', 'Vell_NPC', 'Vell_World', 'Shared Places'] }),
        lastTurn: async () => turn,
        enabled: async () => true,
        state,
        log: { info: (m) => log.push(m), warn: (m) => log.push(`warn: ${m}`) },
        now: () => new Date('2026-10-02T12:00:00Z'),
        ...over,
    }
    return { sync: createMapSync(deps), books, state, log }
}

describe('which books hold places', () => {
    it('is by the category or the name, never World Progression\'s own', () => {
        expect(isLocationBookName('Vell_LOC', 'Vell')).toBe(true)
        expect(isLocationBookName('Vell_Locations', 'Vell')).toBe(true)
        expect(isLocationBookName('vell_places', 'Vell')).toBe(true)
        expect(isLocationBookName('Shared Places', 'Vell')).toBe(true)
        expect(isLocationBookName('Vell_NPC', 'Vell')).toBe(false)
        expect(isLocationBookName('Vell_World', 'Vell')).toBe(false)
        expect(isLocationBookName('Vell_Skeleton', 'Vell')).toBe(false)
        // Another campaign's category book is not this campaign's place book; ownership keeps it out anyway.
        expect(isLocationBookName('Other_LOC', 'Vell')).toBe(false)
        expect(isLocationBookName('Other_Locations', 'Vell')).toBe(true)
    })
})

describe('the sync', () => {
    it('reads the campaign\'s own place books, finds the party and the sites they named, and leaves both blocks rendered', async () => {
        const { sync, books, state, log } = harness()
        const record = await sync.refresh('c1', 'u1')
        expect(books.reads.sort()).toEqual(['Shared Places', 'Vell_LOC'])
        expect(record.currentLocation).toBe('Abbey Undercroft, Cellar Landing')
        expect(record.sites).toEqual([
            { siteRoot: 'Abbey Undercroft', kind: 'DUNGEON', entryId: 'Vell_LOC::1' },
            { siteRoot: 'Morrowfen', kind: 'SETTLEMENT', entryId: 'Vell_LOC::3' },
            { siteRoot: 'Old Barrow', kind: 'DUNGEON', entryId: 'Shared Places::1' },
        ])
        expect(record.activeSiteRoot).toBe('Abbey Undercroft')
        expect(record.mentionedSiteRoots).toEqual(['Morrowfen'])
        expect(record.mappedSitesBlock).toContain('- Abbey Undercroft (DUNGEON)')
        expect(record.mappedSitesBlock).not.toContain('Elsewhere')
        expect(record.canonBlock).toContain('[DUNGEON_REALITY — INTERNAL GM CANON]\nSite: Abbey Undercroft')
        expect(record.canonBlock).toContain('Current footer location: Abbey Undercroft, Cellar Landing')
        expect(record.canonBlock).toContain('Site: Morrowfen')
        expect(record.canonBlock).toContain('Activation: exact mapped-location name in the current player input')
        expect(record.canonBlock.indexOf('Site: Abbey Undercroft')).toBeLessThan(record.canonBlock.indexOf('Site: Morrowfen'))
        expect(record.syncedAt).toBe('2026-10-02T12:00:00.000Z')
        expect(record.problem).toBeUndefined()
        expect(state.snapshot('c1', 'u1')).toEqual(record)
        expect(log[0]).toBe('map: 3 mapped sites in 2 books; party at "Abbey Undercroft, Cellar Landing", inside Abbey Undercroft')
    })

    it('sends only the index when the party is outside every map and nothing was named, and says so without a footer', async () => {
        const outside = harness({}, { reply: '*(Location: Glassmere, Reed Farms)*', userText: 'Onward.' })
        const record = await outside.sync.refresh('c1', 'u1')
        expect(record.activeSiteRoot).toBe('')
        expect(record.canonBlock).toBe('')
        expect(record.mappedSitesBlock).toContain('Every site below already has a private map.')
        const bare = harness({}, { reply: 'No footer at all.', userText: '' })
        const none = await bare.sync.refresh('c1', 'u1')
        expect(none.currentLocation).toBe('')
        expect(none.canonBlock).toBe('')
        expect(bare.log[0]).toContain('party at "(no footer)"')
    })

    it('does not name a site twice when the party is inside the one they named', async () => {
        const { sync } = harness({}, { reply: '*(Location: Morrowfen, The Docks)*', userText: 'We stay in Morrowfen.' })
        const record = await sync.refresh('c1', 'u1')
        expect(record.activeSiteRoot).toBe('Morrowfen')
        expect(record.mentionedSiteRoots).toEqual([])
        expect(record.canonBlock.match(/\[DUNGEON_REALITY/g)).toHaveLength(1)
    })

    it('leaves the blocks empty while the mapping section is off, and records a read that failed without losing the last record', async () => {
        const off = harness({ enabled: async () => false })
        const record = await off.sync.refresh('c1', 'u1')
        expect(record.mappedSitesBlock).toBe('')
        expect(record.canonBlock).toBe('')
        expect(off.books.reads).toEqual([])
        const { sync, books, state } = harness()
        await sync.refresh('c1', 'u1')
        books.listEntries = async () => { throw new Error('PERMISSION_DENIED: world_books') }
        const failed = await sync.refresh('c1', 'u1')
        expect(failed.problem).toBe('PERMISSION_DENIED: world_books')
        expect(failed.activeSiteRoot).toBe('Abbey Undercroft')
        expect(failed.canonBlock).toContain('Site: Abbey Undercroft')
        expect((await state.load('c1', 'u1')).problem).toBe('PERMISSION_DENIED: world_books')
        books.listEntries = reader(BOOKS).listEntries
        expect((await sync.refresh('c1', 'u1')).problem).toBeUndefined()
    })

    it('reads no map from a campaign with no name', async () => {
        const { sync, books } = harness({ campaign: async () => ({ prefix: '', owned: [] }) })
        const record = await sync.refresh('c1', 'u1')
        expect(books.reads).toEqual([])
        expect(record.sites).toEqual([])
        expect(record.mappedSitesBlock).toContain('No private maps exist yet.')
    })

    it('hands the narrator each site\'s recent off-screen life with its canon, when there is any (34c)', async () => {
        const { sync } = harness({ activity: async (_c, _u, siteRoot) => (siteRoot === 'Abbey Undercroft' ? 'Open causal threads (latest per subject):\n- Day 4 — OPEN pack: Drawn by the open door.' : '') })
        const record = await sync.refresh('chat-1', 'u1')
        expect(record.canonBlock).toContain('- Day 4 — OPEN pack: Drawn by the open door.')
        expect(record.canonBlock.indexOf('Site: Abbey Undercroft')).toBeLessThan(record.canonBlock.indexOf('OPEN pack'))
        expect(record.canonBlock.indexOf('OPEN pack')).toBeLessThan(record.canonBlock.indexOf('Site: Morrowfen'))
        const failing = harness({ activity: async () => { throw new Error('no record') } })
        expect((await failing.sync.refresh('chat-1', 'u1')).canonBlock).toContain('Site: Abbey Undercroft')
    })
})
