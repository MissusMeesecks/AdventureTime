import { describe, expect, it } from 'vitest'

import { appendBacklogEntry } from '../tracker/evolution.js'
import { LOCATION_BOOK } from '../tracker/map.test.js'
import { MapStore } from './map-store.js'
import type { MapBookReader } from './map-sync.js'
import { createMapView, type MapViewDeps } from './map-view.js'
import type { MemoStorage } from './memo-store.js'

function storage(): MemoStorage {
    const files = new Map<string, unknown>()
    return {
        async getJson<T>(path: string, options?: { fallback?: T }): Promise<T> { return (files.has(path) ? files.get(path) : options?.fallback) as T },
        async setJson(path: string, value: unknown): Promise<void> { files.set(path, JSON.parse(JSON.stringify(value))) },
    }
}

function reader(seed: Record<string, Record<string, { comment: string; content: string }>>): MapBookReader {
    const books = Object.keys(seed).map((name, i) => ({ id: `b${i + 1}`, name }))
    return {
        listBooks: async () => books.map((b) => ({ ...b })),
        listEntries: async (id) => Object.entries(seed[books.find((b) => b.id === id)!.name]!).map(([uid, e]) => ({ uid, comment: e.comment, content: e.content })),
    }
}

async function harness(over: Partial<MapViewDeps> = {}, record: Record<string, unknown> = { currentLocation: 'Abbey Undercroft, Cellar Landing', activeSiteRoot: 'Abbey Undercroft' }) {
    const state = new MapStore(storage())
    await state.save('c1', record as never, 'u1')
    const log: string[] = []
    const deps: MapViewDeps = {
        store: () => reader({ Vell_LOC: LOCATION_BOOK, Vell_NPC: { 1: { comment: 'Ilyra', content: 'no map' } } }),
        campaign: async () => ({ prefix: 'Vell', owned: ['Vell_LOC', 'Vell_NPC'] }),
        revealAll: async () => false,
        state,
        log: { info: (m) => log.push(m), warn: (m) => log.push(`warn: ${m}`) },
        ...over,
    }
    return { view: createMapView(deps), state, log }
}

describe('the map on screen', () => {
    it('draws the party\'s site under the filter, with their room marked, the entries and the history, and lists every mapped site', async () => {
        const { view } = await harness()
        const result = await view.view('c1', 'u1')
        expect(result).toMatchObject({ siteRoot: 'Abbey Undercroft', kind: 'DUNGEON', partyInside: true, rooms: 3, revealAll: false, currentLocation: 'Abbey Undercroft, Cellar Landing' })
        expect(result.sites).toEqual([{ siteRoot: 'Abbey Undercroft', kind: 'DUNGEON' }, { siteRoot: 'Morrowfen', kind: 'SETTLEMENT' }])
        expect(result.svg).toContain('aria-label="Cellar Landing (you are here)"')
        expect(result.svg).toContain('rt-dungeon-graph-node-fog')
        expect(result.svg).not.toContain('Secret Vault')
        expect(result.entries).toContain('<strong>Cellar Landing</strong>')
        expect(result.entries).not.toContain('Secret Vault')
        expect(result.history).toContain('No Map Evolution pass')
        expect(result.problem).toBeUndefined()
    })

    it('lifts the filter under Reveal all, in the picture, the entries and the history alike', async () => {
        const backlog = appendBacklogEntry(undefined, 'Abbey Undercroft', { kind: 'commit', at: 'Day 5', elapsedMinutes: 60, operationId: 'evo-1', summary: 'Abbey Undercroft: pack moved to vault by pack: Drawn in.' })
        const { view } = await harness({ revealAll: async () => true }, { currentLocation: 'Abbey Undercroft, Cellar Landing', activeSiteRoot: 'Abbey Undercroft', evolution: { lastFiredBySite: {}, backlogBySite: backlog, reportApplications: {}, lastSiteRoot: '', pendingExitRoot: '', intervalHoursBySite: {} } })
        const result = await view.view('c1', 'u1')
        expect(result.revealAll).toBe(true)
        expect(result.svg).toContain('Secret Vault')
        expect(result.svg).not.toContain('rt-dungeon-graph-node-fog')
        expect(result.entries).toContain('<strong>Crawling Dead Pack</strong>')
        expect(result.history).toContain('pack moved to vault by pack: Drawn in.')
        const hidden = await (await harness({}, { currentLocation: 'Abbey Undercroft, Cellar Landing', activeSiteRoot: 'Abbey Undercroft', evolution: { lastFiredBySite: {}, backlogBySite: backlog, reportApplications: {}, lastSiteRoot: '', pendingExitRoot: '', intervalHoursBySite: {} } })).view.view('c1', 'u1')
        expect(hidden.history).toContain('Material details hidden')
    })

    it('draws a named site without marking a room the party is not in, and says when the name is not mapped', async () => {
        const { view } = await harness()
        const town = await view.view('c1', 'u1', 'morrowfen')
        expect(town).toMatchObject({ siteRoot: 'Morrowfen', kind: 'SETTLEMENT', partyInside: false, rooms: 1 })
        expect(town.svg).toContain('aria-label="The Docks"')
        expect(town.svg).not.toContain('you are here')
        expect(town.currentLocation).toBe('Abbey Undercroft, Cellar Landing')
        // A room name the two sites share: the party is at the abbey's docks, not Morrowfen's.
        const shared = await (await harness({}, { currentLocation: 'Abbey Undercroft, The Docks', activeSiteRoot: 'Abbey Undercroft' })).view.view('c1', 'u1', 'Morrowfen')
        expect(shared.partyInside).toBe(false)
        expect(shared.svg).not.toContain('you are here')
        expect(shared.svg).not.toContain('rt-dungeon-graph-node-current')
        const missing = await view.view('c1', 'u1', 'Glassmere')
        expect(missing).toMatchObject({ siteRoot: '', svg: '', rooms: 0, problem: 'Glassmere is not a mapped site.' })
        expect(missing.sites).toHaveLength(2)
    })

    it('draws nothing when the party is outside every map and no site was asked for, and reports a book that cannot be read', async () => {
        const { view } = await harness({}, { currentLocation: 'Glassmere', activeSiteRoot: '' })
        const outside = await view.view('c1', 'u1')
        expect(outside).toMatchObject({ siteRoot: '', partyInside: false, rooms: 0, svg: '', entries: '', history: '', currentLocation: 'Glassmere' })
        expect(outside.problem).toBeUndefined()
        expect(outside.sites.map((s) => s.siteRoot)).toEqual(['Abbey Undercroft', 'Morrowfen'])
        const broken = await harness({ store: () => ({ listBooks: async () => { throw new Error('PERMISSION_DENIED: world_books') }, listEntries: async () => [] }) })
        const failed = await broken.view.view('c1', 'u1')
        expect(failed).toMatchObject({ siteRoot: '', svg: '', problem: 'PERMISSION_DENIED: world_books', sites: [] })
        expect(broken.log).toEqual(['warn: map: could not draw the map: PERMISSION_DENIED: world_books'])
        // Reveal all that cannot be read is off.
        const noPref = await harness({ revealAll: async () => { throw new Error('no prefs') } })
        expect((await noPref.view.view('c1', 'u1')).revealAll).toBe(false)
    })

    it('says when a site\'s map cannot be read, rather than drawing nothing silently', async () => {
        const { view } = await harness({ store: () => reader({ Vell_LOC: { 1: { comment: 'Hollow', content: '[MAP]\n{"version":3,"site":"Hollow","areas":[],"assets":[]}\n[/MAP]' } } }) }, { currentLocation: 'Hollow', activeSiteRoot: 'Hollow' })
        const result = await view.view('c1', 'u1')
        expect(result).toMatchObject({ siteRoot: 'Hollow', partyInside: true, rooms: 0, svg: '' })
        expect(result.entries).toContain('No revealed rooms yet.')
    })
})
