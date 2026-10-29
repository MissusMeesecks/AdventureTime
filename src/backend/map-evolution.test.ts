import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_MAP_EVOLUTION_DIRECT_SYSTEM_PROMPT, DEFAULT_MAP_EVOLUTION_SYSTEM_PROMPT, parseInWorldMinutes } from '../tracker/evolution.js'
import { extractMapSection, parseMapDocument } from '../tracker/map.js'
import { LOCATION_BOOK } from '../tracker/map.test.js'
import { appendThreads, threadsFromTransaction } from '../tracker/updater.js'
import { formatInWorldTime } from '../tracker/world.js'
import { createMapEvolution, type MapEvolutionDeps, type MapEvolutionOptions } from './map-evolution.js'
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

type Entry = WorldEntry & { disabled?: boolean }

function makeBooks(seed: Record<string, Array<Partial<Entry>>> = {}) {
    const books: Array<{ id: string; name: string }> = []
    const entries = new Map<string, Entry[]>()
    let n = 1
    const log: string[] = []
    for (const [name, list] of Object.entries(seed)) {
        const book = { id: `b${books.length + 1}`, name }
        books.push(book)
        entries.set(book.id, list.map((e, i) => ({ id: `e${n++}`, uid: e.uid ?? String(i + 1), key: e.key ?? [], content: e.content ?? '', comment: e.comment ?? '', extensions: e.extensions ?? {}, disabled: e.disabled, createdAt: e.createdAt })))
    }
    const store: WorldBookStore = {
        listBooks: async () => books.map((b) => ({ ...b })),
        createBook: async (name) => { const book = { id: `b${books.length + 1}`, name }; books.push(book); entries.set(book.id, []); return { ...book } },
        listEntries: async (id) => (entries.get(id) ?? []).map((e) => ({ ...e, extensions: { ...(e.extensions ?? {}) } })),
        createEntry: async (id, entry) => { const list = entries.get(id)!; const made: Entry = { id: `e${n++}`, uid: String(list.length + 1), key: entry.key, comment: entry.comment, content: entry.content, extensions: entry.extensions ?? {}, disabled: entry.disabled }; list.push(made); log.push(`create ${entry.comment}`); return { ...made } },
        updateEntry: async (id, patch) => { for (const list of entries.values()) { const f = list.find((e) => e.id === id); if (f) Object.assign(f, JSON.parse(JSON.stringify(patch))) } log.push(`update ${id}`) },
        deleteEntry: async (id) => { for (const list of entries.values()) { const i = list.findIndex((e) => e.id === id); if (i >= 0) list.splice(i, 1) } log.push(`delete ${id}`) },
    }
    const entriesOf = (name: string) => entries.get(books.find((b) => b.name === name)!.id) ?? []
    return { store, entriesOf, books, log }
}

const REPORT = { uid: 'r1', comment: 'Day 4, 09:00 AM', key: ['world progression'], content: '## Abbey Undercroft\nThe dead stir beneath the abbey.\n\n## Wider Currents\nRain on the coast.', extensions: { rpgWorldProgression: { reportId: 'Vell_World::r1', periodLabel: 'Day 4, 09:00 AM', selectedLocations: ['Abbey Undercroft'] } }, createdAt: 4 }
const SEED = () => ({ Vell_LOC: Object.values(LOCATION_BOOK), Vell_World: [REPORT] })

const PACK_MOVES = JSON.stringify({ operation_id: 'evo-day6-pack', operations: [
    { op: 'MOVE_ASSET', evidence: 'EVOLVED', asset_id: 'pack', from: 'crypt', to: 'landing', detail: 'Sniffing at the door.', cause: 'Drawn by the lantern light.', actor: 'pack', thread_status: 'open' },
], report_outcomes: [{ report_id: 'Vell_World::r1', status: 'materialized' }] })
const QUIET = '{"noop":true,"report_outcomes":[{"report_id":"Vell_World::r1","status":"considered"}]}'
const BAD = JSON.stringify({ operation_id: 'evo-bad', operations: [{ op: 'SET_ASSET', evidence: 'EVOLVED', asset_id: 'nobody', state: 'LEFT', cause: 'c' }] })

const OPTIONS: MapEvolutionOptions = { enabled: true, intervalHours: 12, onSiteIntervalHours: 1, onSiteIntervalMinutes: 0, onSitePreset: 'dynamic', scope: 'all', count: 2, randomize: false, selectedRoots: [], worldReportLookback: 5, storyLookback: 20, systemPrompt: '', compressEnabled: true, compressThreshold: 10000 }

function harness(replies: string[] = [PACK_MOVES, QUIET], over: Partial<MapEvolutionDeps> = {}, options: Partial<MapEvolutionOptions> = {}, seed = SEED()) {
    const books = makeBooks(seed)
    const state = new MapStore(storage())
    const owned = Object.keys(seed)
    const calls: Array<Array<{ role: string; content: string }>> = []
    const events: string[] = []
    const refreshed: string[] = []
    let i = 0
    const world = { time: '09:00 AM, Day 5', footer: 'Abbey Road', combat: false }
    const deps: MapEvolutionDeps = {
        store: () => books.store as ReturnType<MapEvolutionDeps['store']>,
        generate: vi.fn(async (msgs) => { calls.push(msgs); const reply = replies[Math.min(i++, replies.length - 1)]!; if (reply.startsWith('throw:')) throw new Error(reply.slice(6)); return reply }),
        campaign: async () => ({ prefix: 'Vell', owned: [...owned] }),
        lastReply: async () => `The road is empty. *(Location: ${world.footer})*`,
        memo: async () => `[TIME]\nTime: ${world.time}\n[/TIME]${world.combat ? '\n[COMBAT]\nRound 2\n[/COMBAT]' : ''}`,
        options: async () => ({ ...OPTIONS, ...options }),
        enabled: async () => true,
        state,
        refresh: async (chatId) => { refreshed.push(chatId) },
        events: { started: (_c, _u, sites, _at, trigger) => events.push(`started:${trigger}:${sites.join('+')}`), finished: (_c, _u, r) => events.push(`finished:${r.status}`) },
        log: { info: () => undefined, warn: () => undefined },
        now: () => new Date('2026-10-03T12:00:00Z'),
        random: () => 0,
        ...over,
    }
    return { evolution: createMapEvolution(deps), books, state, calls, events, refreshed, world, deps }
}

const abbey = (b: ReturnType<typeof makeBooks>) => b.entriesOf('Vell_LOC').find((e) => e.comment === 'Abbey Undercroft')!
const abbeyMap = (b: ReturnType<typeof makeBooks>) => parseMapDocument(extractMapSection(abbey(b).content), 'Abbey Undercroft').document
const DAY5 = parseInWorldMinutes('09:00 AM, Day 5')

describe('the interval tick after a reply', () => {
    it('stamps a baseline on every site the first time, with no model call, and evolves the ones due once their interval has passed', async () => {
        const { evolution, calls, state, events, world } = harness()
        const first = await evolution.afterReply('c1', 'u1', 'm2')
        expect(first).toMatchObject({ status: 'baseline', trigger: 'interval', currentTime: '09:00 AM, Day 5', sites: [{ siteRoot: 'Abbey Undercroft', status: 'baseline' }, { siteRoot: 'Morrowfen', status: 'baseline' }] })
        expect(calls).toHaveLength(0)
        expect(events).toEqual(['finished:baseline'])
        expect((await state.load('c1', 'u1')).evolution).toMatchObject({ lastFiredBySite: { 'abbey undercroft': '09:00 AM, Day 5', morrowfen: '09:00 AM, Day 5' }, lastSiteRoot: '' })
        // The fold's clocks: the memo's time, the newest stamp, the soonest next pass.
        expect(await evolution.schedule('c1', 'u1')).toEqual({ currentTime: '09:00 AM, Day 5', lastFired: formatInWorldTime(DAY5), nextDue: formatInWorldTime(DAY5 + 12 * 60), sites: [] })
        expect(await harness().evolution.schedule('c1', 'u1')).toEqual({ currentTime: '09:00 AM, Day 5', lastFired: '', nextDue: formatInWorldTime(DAY5 + 12 * 60), sites: [] })
        // Eleven hours on: nothing is due yet.
        world.time = '08:00 PM, Day 5'
        expect(await evolution.afterReply('c1', 'u1', 'm4')).toBeNull()
        expect(calls).toHaveLength(0)
        // A day on: both are due, in turn, the second told what the first did.
        world.time = '09:00 AM, Day 6'
        const report = await evolution.afterReply('c1', 'u1', 'm6')
        expect(report).toMatchObject({ status: 'applied', trigger: 'interval', currentTime: '09:00 AM, Day 6', sites: [{ siteRoot: 'Abbey Undercroft', status: 'applied', summary: 'pack moved to landing by pack: Drawn by the lantern light.', operations: 1 }, { siteRoot: 'Morrowfen', status: 'noop' }] })
        expect(calls).toHaveLength(2)
        expect(events).toEqual(['finished:baseline', 'started:interval:Abbey Undercroft+Morrowfen', 'finished:applied'])
    })

    it('forgets every site clock on Reset timeline (78a), as Multihog empties lastFiredBySite, and touches nothing else', async () => {
        const { evolution, state } = harness([QUIET, QUIET, QUIET])
        await state.save('c1', { sites: [{ siteRoot: 'Abbey Undercroft', kind: 'DUNGEON', entryId: 'Vell_LOC::1' }, { siteRoot: 'Morrowfen', kind: 'SETTLEMENT', entryId: 'Vell_LOC::3' }], activeSiteRoot: 'Morrowfen' }, 'u1')
        await evolution.afterReply('c1', 'u1', 'm2')
        await evolution.setSiteInterval('c1', 'u1', 'Abbey Undercroft', 2)
        expect(Object.keys((await state.load('c1', 'u1')).evolution.lastFiredBySite).length).toBeGreaterThan(0)
        await evolution.resetTimeline('c1', 'u1')
        const after = (await state.load('c1', 'u1')).evolution
        expect(after.lastFiredBySite).toEqual({})
        // The site's own hours stand: only the clocks are forgotten.
        expect(after.intervalHoursBySite).toEqual({ 'abbey undercroft': 2 })
        expect((await evolution.schedule('c1', 'u1')).lastFired).toBe('')
    })

    it('lets a site keep its own hours (71d): they win over the dials, 0 is never, and clearing them inherits again', async () => {
        const { evolution, calls, state, world } = harness([QUIET, QUIET, QUIET])
        await state.save('c1', { sites: [{ siteRoot: 'Abbey Undercroft', kind: 'DUNGEON', entryId: 'Vell_LOC::1' }, { siteRoot: 'Morrowfen', kind: 'SETTLEMENT', entryId: 'Vell_LOC::3' }], activeSiteRoot: 'Morrowfen' }, 'u1')
        await evolution.afterReply('c1', 'u1', 'm2')
        // Two hours for the abbey: the fold's reading names its own hours against the dials' twelve.
        expect(await evolution.setSiteInterval('c1', 'u1', 'The Abbey Undercroft', 2)).toEqual({ siteRoot: 'The Abbey Undercroft', current: false, automaticHours: 12, overrideHours: 2 })
        expect((await state.load('c1', 'u1')).evolution.intervalHoursBySite).toEqual({ 'abbey undercroft': 2 })
        expect((await evolution.schedule('c1', 'u1')).sites).toEqual([
            { siteRoot: 'Abbey Undercroft', current: false, automaticHours: 12, overrideHours: 2 },
            { siteRoot: 'Morrowfen', current: true, automaticHours: 1, overrideHours: null },
        ])
        // Two hours on: the abbey is due on its own hours, Morrowfen (the party's, one hour) too, the party's site first as the tick orders them.
        world.time = '11:00 AM, Day 5'
        world.footer = 'The Docks'
        const report = await evolution.afterReply('c1', 'u1', 'm4')
        expect(report?.sites.map((s) => s.siteRoot)).toEqual(['Morrowfen', 'Abbey Undercroft'])
        expect(calls).toHaveLength(2)
        // 0 is never: a day on, the abbey stays still while Morrowfen moves.
        expect(await evolution.setSiteInterval('c1', 'u1', 'Abbey Undercroft', 0)).toMatchObject({ overrideHours: 0 })
        world.time = '11:00 AM, Day 6'
        expect((await evolution.afterReply('c1', 'u1', 'm6'))?.sites.map((s) => s.siteRoot)).toEqual(['Morrowfen'])
        // Cleared, the dials govern again, and the hours are capped at the legacy's 168.
        expect(await evolution.setSiteInterval('c1', 'u1', 'Abbey Undercroft', null)).toMatchObject({ overrideHours: null })
        expect(await evolution.setSiteInterval('c1', 'u1', 'Abbey Undercroft', 999)).toMatchObject({ overrideHours: 168 })
        expect((await state.load('c1', 'u1')).evolution.intervalHoursBySite).toEqual({ 'abbey undercroft': 168 })
    })

    it('shows each site its window, backlog, threads, bubble, map and the reports it has not felt, and remembers what it felt', async () => {
        const { evolution, books, calls, state, refreshed, world } = harness()
        await evolution.afterReply('c1', 'u1', 'm2')
        world.time = '09:00 AM, Day 6'
        await evolution.afterReply('c1', 'u1', 'm6')
        const system = calls[0]![0]!.content
        expect(system.startsWith(DEFAULT_MAP_EVOLUTION_SYSTEM_PROMPT)).toBe(true)
        expect(system).toContain('AUTHORITATIVE TIME-SCALE CONTRACT')
        const prompt = calls[0]![1]!.content
        expect(prompt.startsWith('INTERVAL RESTLESSNESS\nExact site root: Abbey Undercroft\nKind: DUNGEON')).toBe(true)
        expect(prompt).toContain('Last Evolved for this site: 09:00 AM, Day 5\nCurrent in-world time: 09:00 AM, Day 6\nElapsed since Last Evolved: 1 day (1440 in-world minutes total)')
        expect(prompt).toContain('## PLAYER BUBBLE (FROZEN)\n(Party is not inside this site. No freeze.)')
        expect(prompt).toContain('## WORLD REPORT PRESSURES\n### Day 4, 09:00 AM [report_id: Vell_World::r1]\n## Abbey Undercroft\nThe dead stir beneath the abbey.')
        expect(prompt).toContain('## PRIOR EVOLUTION THIS PERIOD\n(None yet this period.)')
        const second = calls[1]![1]!.content
        expect(second.startsWith('INTERVAL RESTLESSNESS\nExact site root: Morrowfen\nKind: SETTLEMENT')).toBe(true)
        expect(second).toContain('## PRIOR EVOLUTION THIS PERIOD\npack moved to landing by pack: Drawn by the lantern light.')
        expect(second).toContain('### Day 4, 09:00 AM [report_id: Vell_World::r1]\n## Wider Currents\nRain on the coast.')
        // The map changed, the root stays out of the keyword scan, the maps were re-read.
        expect(abbeyMap(books).assets.find((a) => a.id === 'pack')?.location).toBe('landing')
        expect((abbey(books) as Entry).disabled).toBe(true)
        expect(refreshed).toEqual(['c1'])
        const record = await state.load('c1', 'u1')
        expect(record.evolution.lastFiredBySite).toEqual({ 'abbey undercroft': '09:00 AM, Day 6', morrowfen: '09:00 AM, Day 6' })
        expect(record.evolution.backlogBySite['abbey undercroft']).toEqual([expect.objectContaining({ kind: 'commit', at: '09:00 AM, Day 6', elapsedMinutes: 1440, operationId: 'evo-day6-pack' })])
        expect(record.evolution.backlogBySite['morrowfen']).toEqual([expect.objectContaining({ kind: 'quiet', elapsedMinutes: 1440, passes: 1 })])
        expect(record.evolution.reportApplications).toEqual({ 'abbey undercroft': { 'Vell_World::r1': expect.objectContaining({ status: 'materialized', consideredAt: '09:00 AM, Day 6' }) }, morrowfen: { 'Vell_World::r1': expect.objectContaining({ status: 'considered' }) } })
        expect(record.threadsBySite['abbey undercroft']).toHaveLength(1)
        expect(record.evolutionUndo).toMatchObject({ messageId: 'm6', created: [], bookkeeping: { lastFiredBySite: { 'abbey undercroft': '09:00 AM, Day 5' } } })
        expect(record.lastEvolution?.status).toBe('applied')
        // A day on again: the report is felt already, so it is not offered twice.
        world.time = '09:00 AM, Day 7'
        await evolution.afterReply('c1', 'u1', 'm8')
        expect(calls[2]![1]!.content).toContain('## WORLD REPORT PRESSURES\n(No unconsumed World Report pressure applies to this location.)')
        expect(calls[2]![1]!.content).toContain('## OPEN CAUSAL THREADS (THIS SITE)\nOpen threads (latest per subject):\n- 09:00 AM, Day 6 — OPEN pack by pack: Drawn by the lantern light.')
        expect(calls[2]![1]!.content).toContain('MATERIAL COMMIT [operation_id: evo-day6-pack]')
    })

    it('uses the on-site interval and freezes the party\'s area while they are inside, and the scope decides which sites a tick considers', async () => {
        const inside = harness([QUIET, QUIET])
        inside.world.footer = 'Abbey Undercroft, Cellar Landing'
        inside.world.combat = true
        await inside.evolution.afterReply('c1', 'u1', 'm2')
        expect((await inside.state.load('c1', 'u1')).evolution.lastSiteRoot).toBe('Abbey Undercroft')
        inside.world.time = '10:30 AM, Day 5'
        const report = await inside.evolution.afterReply('c1', 'u1', 'm4')
        expect(report?.sites.map((s) => s.siteRoot)).toEqual(['Abbey Undercroft'])
        expect(inside.calls).toHaveLength(1)
        expect(inside.calls[0]![1]!.content).toContain('## PLAYER BUBBLE (FROZEN)\nlanding (Cellar Landing) — combat is active')
        expect(inside.calls[0]![1]!.content).toContain('## LEVEL OF DETAIL — CURRENT MAP (TACTICAL AND FELT)')
        const standard = harness([QUIET], {}, { onSitePreset: 'standard', scope: 'active' })
        standard.world.footer = 'Abbey Undercroft, Cellar Landing'
        await standard.evolution.afterReply('c1', 'u1', 'm2')
        standard.world.time = '11:00 AM, Day 5'
        await standard.evolution.afterReply('c1', 'u1', 'm4')
        expect(standard.calls[0]![1]!.content).not.toContain('LEVEL OF DETAIL')
        // Scope active with the party outside every map: no tick at all.
        const outside = harness([QUIET], {}, { scope: 'active' })
        expect(await outside.evolution.afterReply('c1', 'u1', 'm2')).toBeNull()
        expect((await outside.state.load('c1', 'u1')).evolution.lastFiredBySite).toEqual({})
        // Scope count takes one due site per tick; selected takes the named ones.
        const counted = harness([QUIET, QUIET], {}, { scope: 'count', count: 1 })
        await counted.evolution.afterReply('c1', 'u1', 'm2')
        counted.world.time = '09:00 AM, Day 6'
        expect((await counted.evolution.afterReply('c1', 'u1', 'm4'))?.sites).toHaveLength(1)
        const selected = harness([QUIET, QUIET], {}, { scope: 'selected', selectedRoots: ['morrowfen'] })
        await selected.evolution.afterReply('c1', 'u1', 'm2')
        selected.world.time = '09:00 AM, Day 6'
        expect((await selected.evolution.afterReply('c1', 'u1', 'm4'))?.sites.map((s) => s.siteRoot)).toEqual(['Morrowfen'])
        expect((await selected.state.load('c1', 'u1')).evolution.lastFiredBySite).toEqual({ morrowfen: '09:00 AM, Day 6' })
    })

    it('runs one pass over a site the party has just left, unless it evolved at that very moment', async () => {
        const { evolution, calls, state, world, events } = harness([QUIET, QUIET])
        world.footer = 'Abbey Undercroft, Crypt Passage'
        await evolution.afterReply('c1', 'u1', 'm2')
        world.footer = 'Abbey Road'
        world.time = '09:30 AM, Day 5'
        const report = await evolution.afterReply('c1', 'u1', 'm4')
        expect(report).toMatchObject({ status: 'noop', trigger: 'site_exit', sites: [{ siteRoot: 'Abbey Undercroft', status: 'noop' }] })
        expect(calls).toHaveLength(1)
        expect(calls[0]![1]!.content.startsWith('SITE EXIT RESTOCK / DECAY\nExact site root: Abbey Undercroft')).toBe(true)
        expect(events).toEqual(['finished:baseline', 'started:site_exit:Abbey Undercroft', 'finished:noop'])
        expect((await state.load('c1', 'u1')).evolution).toMatchObject({ lastSiteRoot: '', pendingExitRoot: '', lastFiredBySite: { 'abbey undercroft': '09:30 AM, Day 5' } })
        // Staying outside: nothing more.
        expect(await evolution.afterReply('c1', 'u1', 'm6')).toBeNull()
        expect(calls).toHaveLength(1)
        // Leaving in the same minute the site evolved: no second pass.
        const same = harness([QUIET, QUIET])
        same.world.footer = 'Abbey Undercroft, Crypt Passage'
        await same.evolution.afterReply('c1', 'u1', 'm2')
        same.world.time = '10:00 AM, Day 5'
        await same.evolution.afterReply('c1', 'u1', 'm4')
        expect(same.calls).toHaveLength(1)
        same.world.footer = 'Abbey Road'
        expect(await same.evolution.afterReply('c1', 'u1', 'm6')).toBeNull()
        expect(same.calls).toHaveLength(1)
    })

    it('corrects a rejected reply twice, gives up with the problems named, and skips while off or busy', async () => {
        const corrected = harness([BAD, PACK_MOVES, QUIET])
        await corrected.evolution.afterReply('c1', 'u1', 'm2')
        corrected.world.time = '09:00 AM, Day 6'
        const report = await corrected.evolution.afterReply('c1', 'u1', 'm4')
        expect(report?.sites[0]).toMatchObject({ status: 'applied' })
        expect(corrected.calls[1]![1]!.content.startsWith('CORRECTION PASS 1')).toBe(true)
        expect(corrected.calls[1]![1]!.content).toContain('ASSET_NOT_FOUND')
        expect(corrected.calls[1]![1]!.content).toContain(`PREVIOUS OUTPUT\n${BAD}`)
        const stubborn = harness([BAD, BAD, BAD, QUIET])
        await stubborn.evolution.afterReply('c1', 'u1', 'm2')
        stubborn.world.time = '09:00 AM, Day 6'
        const failed = await stubborn.evolution.afterReply('c1', 'u1', 'm4')
        expect(failed?.sites[0]).toMatchObject({ siteRoot: 'Abbey Undercroft', status: 'failed', reason: expect.stringContaining('ASSET_NOT_FOUND') })
        expect(failed?.sites[1]).toMatchObject({ siteRoot: 'Morrowfen', status: 'noop' })
        expect(failed?.status).toBe('noop')
        expect(abbeyMap(stubborn.books).assets.find((a) => a.id === 'pack')?.location).toBe('crypt')
        expect((await stubborn.state.load('c1', 'u1')).evolution.lastFiredBySite['abbey undercroft']).toBe('09:00 AM, Day 5')
        expect((await stubborn.state.load('c1', 'u1')).evolutionUndo).toBeUndefined()
        const off = harness([QUIET], { enabled: async () => false })
        expect(await off.evolution.afterReply('c1', 'u1', 'm2')).toBeNull()
        const disabled = harness([QUIET], {}, { enabled: false })
        expect(await disabled.evolution.afterReply('c1', 'u1', 'm2')).toBeNull()
        expect((await disabled.state.load('c1', 'u1')).evolution.lastFiredBySite).toEqual({})
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => { release = resolve })
        const busy = harness([], { generate: async () => { await gate; return QUIET } })
        await busy.evolution.afterReply('c1', 'u1', 'm2')
        busy.world.time = '09:00 AM, Day 6'
        const first = busy.evolution.afterReply('c1', 'u1', 'm4')
        await new Promise((r) => setTimeout(r, 0))
        expect(busy.evolution.running('c1')).toBe(true)
        expect(await busy.evolution.run({ chatId: 'c1', userId: 'u1', siteRoots: ['Morrowfen'] })).toMatchObject({ status: 'skipped', reason: 'another evolution pass is still running' })
        release()
        expect((await first)?.status).toBe('noop')
    })

    it('compresses a site\'s closed history into digests once it is long, with one more call, and keeps the open threads', async () => {
        const { evolution, state, calls, world } = harness([PACK_MOVES, '{"digests":[{"at":"Day 1 – Day 4","summary":"Eighty visitors came and went."}]}', QUIET], {}, { compressThreshold: 1 })
        let threads = {}
        for (let i = 0; i < 80; i++) threads = appendThreads(threads, 'Abbey Undercroft', threadsFromTransaction({ operation_id: `old-${i}`, operations: [{ op: 'SET_ASSET', asset_id: `visitor-${i}`, state: 'LEFT', cause: `Visitor ${i} argued with the delvers over the reliquary shelves and went home to the salt road.`, thread_status: 'resolved' }] }, { at: `Day ${i + 1}`, createdAssets: [] }))
        await state.save('c1', { threadsBySite: threads }, 'u1')
        await evolution.afterReply('c1', 'u1', 'm2')
        world.time = '09:00 AM, Day 6'
        const report = await evolution.afterReply('c1', 'u1', 'm4')
        expect(report?.sites[0]).toMatchObject({ siteRoot: 'Abbey Undercroft', status: 'applied', compressed: 1 })
        expect(calls).toHaveLength(3)
        expect(calls[1]![0]!.content.startsWith('You are Map Evolution History Compression')).toBe(true)
        expect(calls[1]![1]!.content.startsWith('SITE: Abbey Undercroft\n\nOPEN THREADS')).toBe(true)
        expect(calls[1]![1]!.content).toContain('OPEN pack by pack: Drawn by the lantern light.')
        const rows = (await state.load('c1', 'u1')).threadsBySite['abbey undercroft'] as Array<{ op: string; compressed: boolean }>
        expect(rows.map((r) => r.op)).toEqual(['DIGEST', 'MOVE_ASSET'])
        const off = harness([PACK_MOVES, QUIET], {}, { compressThreshold: 1, compressEnabled: false })
        await off.state.save('c1', { threadsBySite: threads }, 'u1')
        await off.evolution.afterReply('c1', 'u1', 'm2')
        off.world.time = '09:00 AM, Day 6'
        await off.evolution.afterReply('c1', 'u1', 'm4')
        expect(off.calls).toHaveLength(2)
    })
})

describe('putting a pass back after a swipe', () => {
    it('restores the entries, the clocks, the ledgers and the threads, says so, and ignores any other reply', async () => {
        const { evolution, books, state, world, refreshed, events } = harness()
        await evolution.afterReply('c1', 'u1', 'm2')
        world.time = '09:00 AM, Day 6'
        await evolution.afterReply('c1', 'u1', 'm4')
        expect(await evolution.rollBack('c1', 'u1', 'm9')).toBe(false)
        expect(await evolution.rollBack('c1', 'u1', undefined)).toBe(false)
        expect(await evolution.rollBack('c1', 'u1', 'm4')).toBe(true)
        expect(abbeyMap(books).assets.find((a) => a.id === 'pack')?.location).toBe('crypt')
        expect(abbey(books).extensions).toEqual({})
        const record = await state.load('c1', 'u1')
        expect(record.evolutionUndo).toBeUndefined()
        expect(record.evolution.lastFiredBySite).toEqual({ 'abbey undercroft': '09:00 AM, Day 5', morrowfen: '09:00 AM, Day 5' })
        expect(record.evolution.backlogBySite).toEqual({})
        expect(record.threadsBySite).toEqual({})
        expect(record.lastEvolution).toMatchObject({ status: 'undone', trigger: 'interval', reason: 'the reply it followed was replaced', sites: [{ siteRoot: 'Abbey Undercroft' }, { siteRoot: 'Morrowfen' }] })
        expect(refreshed).toEqual(['c1', 'c1'])
        expect(events.at(-1)).toBe('finished:undone')
        expect(await evolution.rollBack('c1', 'u1', 'm4')).toBe(false)
    })
})

describe('a pass from the panel', () => {
    it('evolves the party\'s site now, or the named ones, with an instruction on the compact prompt, and says why it cannot otherwise', async () => {
        // Scope: the party's, as the button worked before 45c-quater made it follow the scope.
        const { evolution, calls, world, state } = harness([QUIET], {}, { scope: 'active' })
        world.footer = 'Abbey Undercroft, Cellar Landing'
        const report = await evolution.run({ chatId: 'c1', userId: 'u1' })
        expect(report).toMatchObject({ status: 'noop', trigger: 'manual', sites: [{ siteRoot: 'Abbey Undercroft', status: 'noop' }] })
        expect(calls[0]![1]!.content.startsWith('MANUAL MAP EVOLUTION\nExact site root: Abbey Undercroft')).toBe(true)
        expect((await state.load('c1', 'u1')).evolutionUndo).toBeUndefined()
        const direct = harness([PACK_MOVES])
        const moved = await direct.evolution.run({ chatId: 'c1', userId: 'u1', instruction: 'Move the pack to the landing.', siteRoots: ['abbey undercroft'] })
        expect(moved).toMatchObject({ status: 'applied', sites: [{ siteRoot: 'Abbey Undercroft', status: 'applied', operations: 1 }] })
        expect(direct.calls[0]![0]!.content).toBe(DEFAULT_MAP_EVOLUTION_DIRECT_SYSTEM_PROMPT)
        expect(direct.calls[0]![1]!.content).toContain('## DIRECT INSTRUCTION (THIS PASS ONLY)')
        expect(direct.calls[0]![1]!.content).not.toContain('WORLD REPORT PRESSURES')
        expect(abbeyMap(direct.books).assets.find((a) => a.id === 'pack')?.location).toBe('landing')
        expect(await evolution.run({ chatId: 'c1', userId: 'u1', siteRoots: ['Nowhere'] })).toMatchObject({ status: 'skipped', reason: 'no map is attached to "Nowhere"' })
        const outside = harness([QUIET], {}, { scope: 'active' })
        expect(await outside.evolution.run({ chatId: 'c1', userId: 'u1' })).toMatchObject({ status: 'skipped', reason: 'the party is not inside a mapped site' })
        const off = harness([], { enabled: async () => false })
        expect(await off.evolution.run({ chatId: 'c1', userId: 'u1' })).toMatchObject({ status: 'skipped', reason: 'the rulebook’s mapping section is off' })
        const broken = harness(['throw:refused'], {}, { scope: 'active' })
        broken.world.footer = 'Abbey Undercroft, Cellar Landing'
        expect(await broken.evolution.run({ chatId: 'c1', userId: 'u1' })).toMatchObject({ status: 'failed', sites: [{ siteRoot: 'Abbey Undercroft', status: 'failed', reason: 'refused' }] })
        expect(DAY5).toBeGreaterThan(0)
    })
})

describe('Evolve now follows the scope (45c-quater)', () => {
    it('runs on the sites the scope names, their clocks ignored: the party\'s, the ticked ones, all, or some', async () => {
        // Named: the ticked site, not the one the party is in.
        const named = harness([QUIET], {}, { scope: 'selected', selectedRoots: ['Morrowfen'] })
        named.world.footer = 'Abbey Undercroft, Cellar Landing'
        expect(await named.evolution.run({ chatId: 'c1', userId: 'u1' })).toMatchObject({ status: 'noop', trigger: 'manual', sites: [{ siteRoot: 'Morrowfen', status: 'noop' }] })
        expect(named.events).toEqual(['started:manual:Morrowfen', 'finished:noop'])
        // All: every mapped site, with no clock to wait for.
        const all = harness([QUIET, QUIET], {}, { scope: 'all' })
        expect((await all.evolution.run({ chatId: 'c1', userId: 'u1' })).sites.map((s) => s.siteRoot)).toEqual(['Abbey Undercroft', 'Morrowfen'])
        // Some: the number below, the party's site first.
        const some = harness([QUIET], {}, { scope: 'count', count: 1, randomize: false })
        some.world.footer = 'Morrowfen, The Green'
        expect((await some.evolution.run({ chatId: 'c1', userId: 'u1' })).sites.map((s) => s.siteRoot)).toEqual(['Morrowfen'])
        // The party's: the site they are in, as before.
        const active = harness([QUIET], {}, { scope: 'active' })
        active.world.footer = 'Abbey Undercroft, Cellar Landing'
        expect((await active.evolution.run({ chatId: 'c1', userId: 'u1' })).sites.map((s) => s.siteRoot)).toEqual(['Abbey Undercroft'])
        // Names from the caller outrank the scope.
        const given = harness([QUIET], {}, { scope: 'selected', selectedRoots: ['Morrowfen'] })
        expect((await given.evolution.run({ chatId: 'c1', userId: 'u1', siteRoots: ['Abbey Undercroft'] })).sites.map((s) => s.siteRoot)).toEqual(['Abbey Undercroft'])
    })

    it('says why nothing ran: nothing ticked, a ticked site with no map, the party outside, no site mapped', async () => {
        const none = harness([QUIET], {}, { scope: 'selected', selectedRoots: [] })
        expect(await none.evolution.run({ chatId: 'c1', userId: 'u1' })).toMatchObject({ status: 'skipped', reason: 'no site is ticked under Named sites' })
        const stale = harness([QUIET], {}, { scope: 'selected', selectedRoots: ['Old Mill'] })
        expect(await stale.evolution.run({ chatId: 'c1', userId: 'u1' })).toMatchObject({ status: 'skipped', reason: 'no map is attached to "Old Mill"' })
        const outside = harness([QUIET], {}, { scope: 'active' })
        expect(await outside.evolution.run({ chatId: 'c1', userId: 'u1' })).toMatchObject({ status: 'skipped', reason: 'the party is not inside a mapped site' })
        const unmapped = harness([QUIET], {}, { scope: 'all' }, { Vell_LOC: [], Vell_World: [] })
        expect(await unmapped.evolution.run({ chatId: 'c1', userId: 'u1' })).toMatchObject({ status: 'skipped', reason: 'no site is mapped yet' })
        expect(none.calls).toHaveLength(0)
    })
})

describe('the recent story (45c)', () => {
    it('reads the story once for the pass, at the lookback chosen, and every site sees the same window', async () => {
        const asked: number[] = []
        const h = harness([QUIET, QUIET], { recentStory: async (_c, _u, turns) => { asked.push(turns); return 'Player: We ride.\n\nNarrator: The road is empty.' } }, { storyLookback: 7 })
        const report = await h.evolution.run({ chatId: 'chat-1', userId: 'u1', siteRoots: ['Abbey Undercroft', 'Morrowfen'] })
        expect(report.sites.map((s) => s.status)).toEqual(['noop', 'noop'])
        expect(asked).toEqual([7])
        expect(h.calls).toHaveLength(2)
        for (const call of h.calls) expect(call[1]!.content).toContain('## RECENT STORY\nPlayer: We ride.\n\nNarrator: The road is empty.')
    })

    it('reads the window the terminal’s bar names for a direct pass (71b), the preference otherwise', async () => {
        const asked: number[] = []
        const h = harness([QUIET, QUIET], { recentStory: async (_c, _u, turns) => { asked.push(turns); return 'Player: We ride.' } }, { storyLookback: 7 })
        await h.evolution.run({ chatId: 'chat-1', userId: 'u1', siteRoots: ['Abbey Undercroft'], instruction: 'the cult moves in', lookback: 12 })
        await h.evolution.run({ chatId: 'chat-1', userId: 'u1', siteRoots: ['Abbey Undercroft'], instruction: 'the cult moves in' })
        expect(asked).toEqual([12, 7])
    })

    it('sends none at a lookback of 0, without a reader, or when the chat will not read; the pass goes on', async () => {
        const reader = vi.fn(async () => 'Player: x')
        const off = harness([QUIET], { recentStory: reader }, { storyLookback: 0 })
        await off.evolution.run({ chatId: 'chat-1', userId: 'u1', siteRoots: ['Abbey Undercroft'] })
        expect(reader).not.toHaveBeenCalled()
        expect(off.calls[0]![1]!.content).toContain('## RECENT STORY\n(None \u2014 lookback is 0 or chat is empty.)')
        const none = harness([QUIET])
        await none.evolution.run({ chatId: 'chat-1', userId: 'u1', siteRoots: ['Abbey Undercroft'] })
        expect(none.calls[0]![1]!.content).toContain('(None \u2014 lookback is 0 or chat is empty.)')
        const broken = harness([QUIET], { recentStory: async () => { throw new Error('chat down') } })
        const report = await broken.evolution.run({ chatId: 'chat-1', userId: 'u1', siteRoots: ['Abbey Undercroft'] })
        expect(report.status).toBe('noop')
        expect(broken.calls[0]![1]!.content).toContain('(None \u2014 lookback is 0 or chat is empty.)')
    })
})

describe('the terminal’s steps (71b)', () => {
    it('announces the pass over its sites, each site’s call and outcome, and the tally at the end', async () => {
        const steps: Array<[string, string]> = []
        const direct = harness([PACK_MOVES], { steps: () => (type, content) => { steps.push([type, content]) } })
        await direct.evolution.run({ chatId: 'c1', userId: 'u1', instruction: 'Move the pack to the landing.', siteRoots: ['abbey undercroft'] })
        expect(steps[0]).toEqual(['start', 'Initializing Map Evolution (manual, direct instruction) for Abbey Undercroft…'])
        expect(steps[1]![0]).toBe('thought')
        expect(steps[1]![1]).toMatch(/^Abbey Undercroft: requesting evolution \(manual;/)
        expect(steps.map((s) => s[0]).slice(-3)).toEqual(['result', 'finish', 'finish'])
        expect(steps.at(-1)![1]).toBe('Map Evolution: 1 applied, 0 noop, 0 failed.')
        const broken = harness(['throw:refused'], { steps: () => (type, content) => { steps.push([type, content]) } }, { scope: 'active' })
        broken.world.footer = 'Abbey Undercroft, Cellar Landing'
        steps.length = 0
        await broken.evolution.run({ chatId: 'c1', userId: 'u1' })
        expect(steps.filter((s) => s[0] === 'error').map((s) => s[1])).toEqual(['Abbey Undercroft: refused', 'Map Evolution: 0 applied, 0 noop, 1 failed.'])
    })
})
