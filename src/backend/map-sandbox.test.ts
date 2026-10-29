import { describe, expect, it, vi } from 'vitest'

import { extractMapSection, parseMapDocument } from '../tracker/map.js'
import { LOCATION_BOOK } from '../tracker/map.test.js'
import { createMapEvolution, type MapEvolutionDeps, type MapEvolutionOptions } from './map-evolution.js'
import { createMapSandbox, MAX_SANDBOX_TICKS, SANDBOX_ASSET_KINDS, SANDBOX_ASSET_STATES, type MapSandboxDeps } from './map-sandbox.js'
import { MapStore } from './map-store.js'
import type { MemoRecord, MemoStorage } from './memo-store.js'
import type { WorldBookStore, WorldEntry } from './world-pass.js'

function storage(): MemoStorage {
    const files = new Map<string, unknown>()
    return {
        async getJson<T>(path: string, options?: { fallback?: T }): Promise<T> { return (files.has(path) ? files.get(path) : options?.fallback) as T },
        async setJson(path: string, value: unknown): Promise<void> { files.set(path, JSON.parse(JSON.stringify(value))) },
    }
}

type Entry = WorldEntry & { disabled?: boolean }

function makeBooks(seed: Record<string, Array<Partial<Entry>>>) {
    const books: Array<{ id: string; name: string }> = []
    const entries = new Map<string, Entry[]>()
    let n = 1
    for (const [name, list] of Object.entries(seed)) {
        const book = { id: `b${books.length + 1}`, name }
        books.push(book)
        entries.set(book.id, list.map((e, i) => ({ id: `e${n++}`, uid: e.uid ?? String(i + 1), key: e.key ?? [], content: e.content ?? '', comment: e.comment ?? '', extensions: e.extensions ?? {}, disabled: e.disabled })))
    }
    const store: WorldBookStore = {
        listBooks: async () => books.map((b) => ({ ...b })),
        createBook: async (name) => { const book = { id: `b${books.length + 1}`, name }; books.push(book); entries.set(book.id, []); return { ...book } },
        listEntries: async (id) => (entries.get(id) ?? []).map((e) => ({ ...e, extensions: { ...(e.extensions ?? {}) } })),
        createEntry: async (id, entry) => { const list = entries.get(id)!; const made: Entry = { id: `e${n++}`, uid: String(list.length + 1), key: entry.key, comment: entry.comment, content: entry.content, extensions: entry.extensions ?? {}, disabled: entry.disabled }; list.push(made); return { ...made } },
        updateEntry: async (id, patch) => { for (const list of entries.values()) { const f = list.find((e) => e.id === id); if (f) Object.assign(f, JSON.parse(JSON.stringify(patch))) } },
        deleteEntry: async (id) => { for (const list of entries.values()) { const i = list.findIndex((e) => e.id === id); if (i >= 0) list.splice(i, 1) } },
    }
    return { store, entriesOf: (name: string) => entries.get(books.find((b) => b.name === name)!.id) ?? [] }
}

const PACK_MOVES = JSON.stringify({ operation_id: 'evo-pack', operations: [{ op: 'MOVE_ASSET', evidence: 'EVOLVED', asset_id: 'pack', from: 'crypt', to: 'landing', detail: 'Sniffing at the door.', cause: 'Drawn by the lantern light.', actor: 'pack', thread_status: 'open' }], chronicles: [{ area_id: 'crypt', text: 'The pack crept out toward the landing.' }] })
const QUIET = '{"noop":true}'
const OPTIONS: MapEvolutionOptions = { enabled: true, intervalHours: 8, onSiteIntervalHours: 1, onSiteIntervalMinutes: 0, onSitePreset: 'dynamic', scope: 'all', count: 2, randomize: false, selectedRoots: [], worldReportLookback: 5, storyLookback: 0, systemPrompt: '', compressEnabled: true, compressThreshold: 10000 }

function harness(replies: string[] = [PACK_MOVES, QUIET], over: Partial<MapSandboxDeps> = {}) {
    const books = makeBooks({ Vell_LOC: Object.values(LOCATION_BOOK) })
    const state = new MapStore(storage())
    const memo = { record: { version: 2, memo: '[TIME]\nTime: 09:00 AM, Day 5\nLast rest: Day 4\n[/TIME]\n[PARTY]\nx\n[/PARTY]', updatedAt: 't', previous: 'old', lastMessageId: 'm3' } as MemoRecord }
    const memoWrites: string[] = []
    const changed: string[] = []
    const progress: string[] = []
    const refreshed: string[] = []
    const log: string[] = []
    let i = 0
    let others = false
    const evoDeps: MapEvolutionDeps = {
        store: () => books.store as ReturnType<MapEvolutionDeps['store']>,
        generate: vi.fn(async () => { const reply = replies[Math.min(i++, replies.length - 1)]!; if (reply.startsWith('throw:')) throw new Error(reply.slice(6)); return reply }),
        campaign: async () => ({ prefix: 'Vell', owned: ['Vell_LOC'] }),
        lastReply: async () => 'The road is empty. *(Location: Abbey Road)*',
        memo: async () => memo.record.memo,
        options: async () => OPTIONS,
        enabled: async () => true,
        state,
        refresh: async () => undefined,
        log: { info: () => undefined, warn: () => undefined },
        now: () => new Date('2026-10-20T12:00:00Z'),
        random: () => 0,
    }
    const evolution = createMapEvolution(evoDeps)
    const deps: MapSandboxDeps = {
        store: evoDeps.store,
        campaign: evoDeps.campaign,
        memos: {
            load: async () => ({ ...memo.record }),
            save: async (_c, text, _u, meta) => { memo.record = { ...memo.record, ...meta, memo: text } as MemoRecord; memoWrites.push(text) },
        },
        memoChanged: (_c, _u, text) => { changed.push(text) },
        state,
        evolution,
        othersRunning: () => others,
        options: async () => ({ intervalHours: 8, compressEnabled: true, compressThreshold: 10000 }),
        refresh: async (chatId) => { refreshed.push(chatId) },
        progress: (_c, _u, tick) => { progress.push(`${tick.index + 1}/${tick.count} ${tick.phase} ${tick.timeLabel}`) },
        log: { info: (m) => log.push(m), warn: (m) => log.push(`warn: ${m}`) },
        ...over,
    }
    const sandbox = createMapSandbox(deps)
    const abbey = () => books.entriesOf('Vell_LOC').find((e) => e.comment === 'Abbey Undercroft')!
    const abbeyMap = () => parseMapDocument(extractMapSection(abbey().content), 'Abbey Undercroft').document
    return { sandbox, evolution, books, state, memo, memoWrites, changed, progress, refreshed, log, abbey, abbeyMap, setOthers: (v: boolean) => { others = v }, generate: evoDeps.generate as ReturnType<typeof vi.fn> }
}

describe('the Testing Ground (71d)', () => {
    it('describes a site: the clock, the map’s areas and assets, the ledgers, the subjects to follow, and the chosen arc', async () => {
        const { sandbox, state } = harness()
        await state.save('c1', { activeSiteRoot: 'Morrowfen', sites: [] }, 'u1')
        const view = await sandbox.describe('c1', 'u1')
        // No site asked for: the party's.
        expect(view).toMatchObject({ timeLabel: '09:00 AM, Day 5', siteRoot: 'Morrowfen', kind: 'SETTLEMENT', lastEvolved: 'Never', lastPass: null, intervalHours: 8 })
        expect(view.sites).toEqual([{ siteRoot: 'Abbey Undercroft', current: false }, { siteRoot: 'Morrowfen', current: true }])
        const abbey = await sandbox.describe('c1', 'u1', 'the abbey undercroft', 'pack')
        expect(abbey.siteRoot).toBe('Abbey Undercroft')
        expect(abbey.areas.map((a) => a.id)).toEqual(['landing', 'crypt', 'vault'])
        expect(abbey.assets.map((a) => `${a.id}:${a.state}:${a.location}`)).toEqual(['lantern:ACTIVE:landing', 'ghoul:DESTROYED:crypt', 'pack:ACTIVE:crypt'])
        expect(abbey.assets[2]).toMatchObject({ name: 'Crawling Dead Pack', kind: 'GROUP', count: 6 })
        expect(abbey.memory).toMatchObject({ entryCount: 0, backlogCount: 0, threshold: 10000, compressEnabled: true })
        expect(abbey.threads).toEqual({ entries: [], open: [], truncated: false })
        expect(abbey.arcSubjects.map((s) => s.id)).toEqual(['pack', 'lantern', 'ghoul'])
        expect(abbey.arc).toMatchObject({ subjectId: 'pack', onMap: true, events: [] })
        // An unknown subject gets no arc; a site that is not mapped reads as itself with nothing on it.
        expect((await sandbox.describe('c1', 'u1', 'Abbey Undercroft', 'nobody')).arc).toBeUndefined()
        expect(await sandbox.describe('c1', 'u1', 'Nowhere')).toMatchObject({ siteRoot: 'Nowhere', kind: '', areas: [], assets: [] })
        expect(SANDBOX_ASSET_KINDS).toContain('CREATURE')
        expect(SANDBOX_ASSET_STATES[0]).toBe('DESTROYED')
        expect(MAX_SANDBOX_TICKS).toBe(20)
    })

    it('sets and advances the memo’s clock, keeping the rest line and the record’s other fields, and says why it cannot', async () => {
        const { sandbox, memo, memoWrites, changed } = harness()
        expect(await sandbox.setTime('c1', 'u1', 'Day 6, 10:30 AM')).toEqual({ ok: true, timeLabel: 'Day 6, 10:30 AM', minutes: 5 * 1440 + 630 })
        expect(memo.record.memo).toBe('[TIME]\nDay 6, 10:30 AM\nLast rest: Day 4\n[/TIME]\n[PARTY]\nx\n[/PARTY]')
        expect(memo.record).toMatchObject({ previous: 'old', lastMessageId: 'm3' })
        expect(changed).toEqual([memo.record.memo])
        expect(await sandbox.advance('c1', 'u1', 90)).toEqual({ ok: true, timeLabel: 'Day 6, 12:00 PM', minutes: 5 * 1440 + 720 })
        expect(await sandbox.advance('c1', 'u1', 1440)).toMatchObject({ ok: true, timeLabel: 'Day 7, 12:00 PM' })
        expect(memoWrites).toHaveLength(3)
        expect(await sandbox.setTime('c1', 'u1', '  ')).toEqual({ ok: false, error: 'Supply an in-world time label.' })
        expect(await sandbox.setTime('c1', 'u1', 'soonish')).toEqual({ ok: false, error: 'Could not parse in-world time: soonish' })
        expect(await sandbox.advance('c1', 'u1', 0)).toEqual({ ok: false, error: 'Advance time by a non-zero number of in-world minutes.' })
        memo.record = { ...memo.record, memo: '[PARTY]\nx\n[/PARTY]' }
        expect(await sandbox.advance('c1', 'u1', 60)).toEqual({ ok: false, error: 'No parseable [TIME] block in the current memo.' })
        // A memo with no clock takes one on a set.
        expect(await sandbox.setTime('c1', 'u1', 'Day 1')).toMatchObject({ ok: true })
        expect(memo.record.memo).toContain('[TIME]\nDay 1, 12:00 AM\n[/TIME]')
    })

    it('adds and changes entities through a CONFIRMED sandbox transaction, judged and committed as a pass’s, with its threads and backlog line kept', async () => {
        const { sandbox, state, abbeyMap, refreshed, log } = harness()
        expect(await sandbox.addAsset('c1', 'u1', { siteRoot: 'Abbey Undercroft', name: '', location: 'landing', cause: 'c' })).toEqual({ ok: false, error: 'Name is required.' })
        expect(await sandbox.addAsset('c1', 'u1', { siteRoot: 'Abbey Undercroft', name: 'Rat', location: '', cause: 'c' })).toEqual({ ok: false, error: 'Location (area id) is required.' })
        expect(await sandbox.addAsset('c1', 'u1', { siteRoot: 'Abbey Undercroft', name: 'Rat', location: 'landing', cause: ' ' })).toEqual({ ok: false, error: 'Cause is required.' })
        expect(await sandbox.addAsset('c1', 'u1', { siteRoot: 'Abbey Undercroft', name: 'Rat', location: 'landing', cause: 'c', state: 'DEAD' })).toEqual({ ok: false, error: 'DEAD/DESTROYED requires an actor (party, asset id, or off-map name).' })
        expect(await sandbox.addAsset('c1', 'u1', { siteRoot: 'Nowhere', name: 'Rat', location: 'landing', cause: 'c' })).toEqual({ ok: false, error: 'No mapped site named Nowhere.' })
        const added = await sandbox.addAsset('c1', 'u1', { siteRoot: 'Abbey Undercroft', name: 'Rat Swarm', kind: 'GROUP', location: 'landing', count: '4', faction: 'Vermin', cause: 'Spawned for the test', actor: 'party' })
        expect(added).toMatchObject({ ok: true, createdAssets: [{ name: 'Rat Swarm' }] })
        const rat = abbeyMap().assets.find((a) => a.name === 'Rat Swarm')!
        expect(rat).toMatchObject({ kind: 'GROUP', location: 'landing', state: 'ACTIVE', count: 4, faction: 'Vermin', origin: 'DEBUG_SANDBOX' })
        // The document's rules judge it: an unknown area is refused with the code and the hint.
        expect(await sandbox.addAsset('c1', 'u1', { siteRoot: 'Abbey Undercroft', name: 'Ghost', location: 'attic', cause: 'c' })).toMatchObject({ ok: false, error: expect.stringMatching(/attic|area|location/i) })
        // A change: the pack destroyed by the party.
        expect(await sandbox.setAsset('c1', 'u1', { siteRoot: 'Abbey Undercroft', assetId: '', cause: 'c' })).toEqual({ ok: false, error: 'Asset id is required.' })
        expect(await sandbox.setAsset('c1', 'u1', { siteRoot: 'Abbey Undercroft', assetId: 'pack', state: 'DESTROYED', cause: 'Killed by the party' })).toEqual({ ok: false, error: 'DEAD/DESTROYED requires an actor (party, asset id, or off-map name).' })
        expect(await sandbox.setAsset('c1', 'u1', { siteRoot: 'Abbey Undercroft', assetId: 'pack', state: 'DESTROYED', cause: 'Killed by the party', actor: 'party' })).toEqual({ ok: true, createdAssets: [] })
        expect(abbeyMap().assets.find((a) => a.id === 'pack')).toMatchObject({ state: 'DESTROYED', cause: 'Killed by the party', actor: 'party' })
        const record = await state.load('c1', 'u1')
        expect(record.threadsBySite['abbey undercroft']).toHaveLength(2)
        expect(record.evolution.backlogBySite['abbey undercroft']).toHaveLength(2)
        expect((record.evolution.backlogBySite['abbey undercroft'] as Array<{ kind: string; elapsedMinutes: number; summary: string }>)[1]).toMatchObject({ kind: 'commit', elapsedMinutes: -1, summary: expect.stringContaining('pack') })
        expect(refreshed).toEqual(['c1', 'c1'])
        expect(log.filter((l) => l.startsWith('map: sandbox committed'))).toHaveLength(2)
        // The view lists the new entity and its arc.
        const view = await sandbox.describe('c1', 'u1', 'Abbey Undercroft', rat.id)
        // Both changes left a thread; the destroyed pack's stays open until a pass closes it, as the legacy reads a cause without a status.
        expect(view.threads.open.map((t) => t.subjectId)).toEqual([rat.id, 'pack'])
        expect(view.arc?.events.map((e) => e.role)).toEqual(['subject'])
    })

    it('evolves one site now with a checkpoint before it, and refuses while another agent runs', async () => {
        const { sandbox, generate, setOthers, abbeyMap, log } = harness()
        expect(await sandbox.evolve('c1', 'u1', '')).toEqual({ ok: false, error: 'Pick a mapped site.' })
        setOthers(true)
        expect(await sandbox.evolve('c1', 'u1', 'Abbey Undercroft')).toEqual({ ok: false, skipped: 'busy', error: 'An agent is already running.' })
        setOthers(false)
        const result = await sandbox.evolve('c1', 'u1', 'Abbey Undercroft')
        expect(result).toMatchObject({ ok: true, applied: 1, evolved: { status: 'applied', sites: [{ siteRoot: 'Abbey Undercroft', status: 'applied', operations: 1 }] } })
        expect(generate).toHaveBeenCalledTimes(1)
        expect(abbeyMap().assets.find((a) => a.id === 'pack')?.location).toBe('landing')
        expect((await sandbox.describe('c1', 'u1')).lastPass).toEqual({ type: 'evolve', siteRoot: 'Abbey Undercroft', undone: false })
        expect(log).toContain('map: sandbox evolving "Abbey Undercroft" now')
        // A quiet pass is ok with nothing applied; a skipped one is not.
        expect(await sandbox.evolve('c1', 'u1', 'Abbey Undercroft')).toMatchObject({ ok: true, applied: 0 })
        expect(await sandbox.evolve('c1', 'u1', 'Nowhere')).toMatchObject({ ok: false, error: expect.stringContaining('Nowhere') })
    })

    it('simulates ticks: the clock advanced by the hours each time and the site evolved, the ticks announced, within the legacy’s cap', async () => {
        const { sandbox, memo, progress, generate } = harness([QUIET])
        expect(await sandbox.simulate('c1', 'u1', { siteRoot: '', ticks: 2, hoursPerTick: 8 })).toEqual({ ok: false, error: 'Pick a mapped site.' })
        const result = await sandbox.simulate('c1', 'u1', { siteRoot: 'Morrowfen', ticks: 3, hoursPerTick: 6 })
        expect(result).toMatchObject({ ok: true, ticks: 3, hoursPerTick: 6 })
        expect(memo.record.memo).toContain('Day 6, 03:00 AM')
        expect(generate).toHaveBeenCalledTimes(3)
        expect(progress).toEqual(['1/3 time Day 5, 03:00 PM', '1/3 evolved Day 5, 03:00 PM', '2/3 time Day 5, 09:00 PM', '2/3 evolved Day 5, 09:00 PM', '3/3 time Day 6, 03:00 AM', '3/3 evolved Day 6, 03:00 AM'])
        expect((await sandbox.describe('c1', 'u1')).lastPass).toEqual({ type: 'simulate', siteRoot: 'Morrowfen', ticks: 3, hoursPerTick: 6, undone: false })
        // The hours fall to the dial, the ticks are clamped.
        expect(await sandbox.simulate('c1', 'u1', { siteRoot: 'Morrowfen', ticks: 99, hoursPerTick: 0 })).toMatchObject({ ok: true, ticks: 20, hoursPerTick: 8 })
    })

    it('undoes the last pass — the map, the clock, the ledgers and the chronicle made — and redoes it the same way', async () => {
        const { sandbox, memo, books, abbeyMap, state, generate, setOthers } = harness([PACK_MOVES, PACK_MOVES])
        expect(await sandbox.undo('c1', 'u1')).toEqual({ ok: false, error: 'No Evolution pass to undo. Run one first.' })
        expect(await sandbox.redo('c1', 'u1')).toEqual({ ok: false, error: 'No Evolution pass to redo. Run one first.' })
        const before = books.entriesOf('Vell_LOC').length
        await sandbox.simulate('c1', 'u1', { siteRoot: 'Abbey Undercroft', ticks: 1, hoursPerTick: 4 })
        expect(memo.record.memo).toContain('Day 5, 01:00 PM')
        expect(abbeyMap().assets.find((a) => a.id === 'pack')?.location).toBe('landing')
        expect(books.entriesOf('Vell_LOC').length).toBe(before + 1)
        expect((await state.load('c1', 'u1')).evolution.lastFiredBySite['abbey undercroft']).toBe('Day 5, 01:00 PM')
        setOthers(true)
        expect(await sandbox.undo('c1', 'u1')).toMatchObject({ ok: false, skipped: 'busy' })
        setOthers(false)
        expect(await sandbox.undo('c1', 'u1')).toEqual({ ok: true, action: { type: 'simulate', siteRoot: 'Abbey Undercroft', ticks: 1, hoursPerTick: 4, undone: true } })
        expect(memo.record.memo).toContain('09:00 AM, Day 5')
        expect(abbeyMap().assets.find((a) => a.id === 'pack')?.location).toBe('crypt')
        expect(books.entriesOf('Vell_LOC').length).toBe(before)
        expect((await state.load('c1', 'u1')).evolution.lastFiredBySite).toEqual({})
        expect((await state.load('c1', 'u1')).threadsBySite).toEqual({})
        expect(await sandbox.undo('c1', 'u1')).toEqual({ ok: false, error: 'Last pass is already undone. Redo it or run a new one.' })
        // Redo: the snapshot restored first, then the same simulate again.
        expect(await sandbox.redo('c1', 'u1')).toMatchObject({ ok: true, redone: true, ticks: 1, hoursPerTick: 4, action: { type: 'simulate', undone: false } })
        expect(generate).toHaveBeenCalledTimes(2)
        expect(memo.record.memo).toContain('Day 5, 01:00 PM')
        expect(abbeyMap().assets.find((a) => a.id === 'pack')?.location).toBe('landing')
        expect(books.entriesOf('Vell_LOC').length).toBe(before + 1)
        // Forgotten on a chat switch, as the legacy's is.
        sandbox.forget('c1')
        expect((await sandbox.describe('c1', 'u1')).lastPass).toBeNull()
    })

    it('clears a site’s evolution history and leaves its map and clock alone', async () => {
        const { sandbox, state, abbeyMap } = harness([PACK_MOVES])
        await sandbox.evolve('c1', 'u1', 'Abbey Undercroft')
        let record = await state.load('c1', 'u1')
        expect(record.threadsBySite['abbey undercroft']).toHaveLength(1)
        expect(record.evolution.backlogBySite['abbey undercroft']).toHaveLength(1)
        expect(await sandbox.clearHistory('c1', 'u1', '')).toEqual({ ok: false, error: 'Pick a mapped site.' })
        expect(await sandbox.clearHistory('c1', 'u1', 'The Abbey Undercroft')).toEqual({ ok: true })
        record = await state.load('c1', 'u1')
        expect(record.threadsBySite['abbey undercroft']).toBeUndefined()
        expect(record.evolution.backlogBySite['abbey undercroft']).toBeUndefined()
        expect(record.evolution.lastFiredBySite['abbey undercroft']).toBe('09:00 AM, Day 5')
        expect(abbeyMap().assets.find((a) => a.id === 'pack')?.location).toBe('landing')
    })

    it('reads a chat it cannot read as a problem rather than throwing', async () => {
        const { sandbox } = harness([], { campaign: async () => { throw new Error('no prefs') } })
        expect(await sandbox.describe('c1', 'u1')).toMatchObject({ siteRoot: '', sites: [], problem: 'no prefs' })
    })
})
