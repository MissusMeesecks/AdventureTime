import { describe, expect, it, vi } from 'vitest'

import { ARGS, ASSETS, TOPOLOGY } from '../tracker/architect.test.js'
import { extractMapSection, parseMapDocument } from '../tracker/map.js'
import { LOCATION_BOOK } from '../tracker/map.test.js'
import { createMapArchitect, type MapArchitectDeps } from './map-architect.js'
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

function makeBooks(seed: Record<string, Array<Partial<WorldEntry>>> = {}) {
    const books: Array<{ id: string; name: string }> = []
    const entries = new Map<string, Array<WorldEntry & { disabled?: boolean }>>()
    let n = 1
    const log: string[] = []
    for (const [name, list] of Object.entries(seed)) {
        const book = { id: `b${books.length + 1}`, name }
        books.push(book)
        entries.set(book.id, list.map((e, i) => ({ id: `e${n++}`, uid: e.uid ?? String(i + 1), key: e.key ?? [], content: e.content ?? '', comment: e.comment ?? '', extensions: e.extensions ?? {} })))
    }
    const store: WorldBookStore = {
        listBooks: async () => books.map((b) => ({ ...b })),
        createBook: async (name) => { const book = { id: `b${books.length + 1}`, name }; books.push(book); entries.set(book.id, []); log.push(`create book ${name}`); return { ...book } },
        listEntries: async (id) => (entries.get(id) ?? []).map((e) => ({ ...e })),
        createEntry: async (id, entry) => {
            const list = entries.get(id)!
            const made = { id: `e${n++}`, uid: String(list.length + 1), key: entry.key, comment: entry.comment, content: entry.content, extensions: entry.extensions ?? {}, disabled: entry.disabled }
            list.push(made)
            log.push(`create entry ${entry.comment} disabled=${entry.disabled}`)
            return { ...made }
        },
        updateEntry: async (id, patch) => { for (const list of entries.values()) { const f = list.find((e) => e.id === id); if (f) Object.assign(f, patch) } log.push(`update ${id} ${Object.keys(patch).join(',')}`) },
        deleteEntry: async (id) => { log.push(`delete ${id}`) },
    }
    const entriesOf = (name: string) => entries.get(books.find((b) => b.name === name)!.id) ?? []
    return { store, entriesOf, books, log }
}

const GOOD = [JSON.stringify(TOPOLOGY), JSON.stringify(ASSETS)]

function harness(replies: string[] = GOOD, over: Partial<MapArchitectDeps> = {}, seed: Record<string, Array<Partial<WorldEntry>>> = { Vell_LOC: Object.values(LOCATION_BOOK), Vell_NPC: [{ comment: 'Ilyra', content: 'x' }] }) {
    const books = makeBooks(seed)
    const state = new MapStore(storage())
    const owned = Object.keys(seed)
    const made: string[] = []
    const calls: Array<Array<{ role: string; content: string }>> = []
    const events: string[] = []
    const refreshed: string[] = []
    let i = 0
    const deps: MapArchitectDeps = {
        store: () => books.store as MapArchitectDeps['store'] extends (u: never) => infer R ? R : never,
        generate: vi.fn(async (messages) => { calls.push(messages); const reply = replies[Math.min(i++, replies.length - 1)]!; if (reply.startsWith('throw:')) throw new Error(reply.slice(6)); return reply }),
        campaign: async () => ({ prefix: 'Vell', owned: [...owned] }),
        ownership: { made: async (_c, names) => { made.push(...names); for (const name of names) if (!owned.includes(name)) owned.push(name) } },
        story: async (_c, _u, lookback) => ({ lines: ['PLAYER: We go down.', 'NARRATOR: The gate is broken.'].slice(-lookback), lastReply: 'The gate is broken. *(Location: Varnholde Road)*' }),
        memo: async () => '[TIME]\nCurrent: 09:00 AM, Day 5\n[/TIME]',
        options: async () => ({ lookback: 12, systemPrompt: '' }),
        enabled: async () => true,
        state,
        refresh: async (chatId) => { refreshed.push(chatId) },
        events: { started: (_c, _u, site) => events.push(`started:${site}`), finished: (_c, _u, r) => events.push(`finished:${r.status}`) },
        log: { info: () => undefined, warn: () => undefined },
        now: () => new Date('2026-10-02T12:00:00Z'),
        ...over,
    }
    return { architect: createMapArchitect(deps), books, state, owned, made, calls, events, refreshed, deps }
}

const CALL = { site: 'Varnholde Crypts', entrance: 'Broken Gate', kind: 'DUNGEON', scale: 'SMALL', threat: 'HIGH', prompt: ARGS.prompt, brief_description: 'A flooded crypt.' }

describe('the Location\'s General field (45c)', () => {
    const BOILERPLATE = '[CORE]\nVarnholde Crypts is a mapped site. Its private map stores current objective reality; child Location entries preserve player-observable history.\n[/CORE]'

    it('writes the brief description into a root entry that has no description of its own, and leaves one the agent wrote', async () => {
        const seeded = harness(GOOD, {}, { Vell_LOC: [...Object.values(LOCATION_BOOK), { comment: 'Varnholde Crypts', key: ['Varnholde Crypts'], content: BOILERPLATE }] })
        expect(await seeded.architect.run({ chatId: 'c1', userId: 'u1', args: CALL })).toContain('Map saved to')
        const root = seeded.books.entriesOf('Vell_LOC').find((e) => e.comment === 'Varnholde Crypts')!
        expect(root.content.startsWith('[CORE]\nA flooded crypt.\n[/CORE]')).toBe(true)
        expect(root.content).toContain('[MAP]')
        const authored = harness(GOOD, {}, { Vell_LOC: [...Object.values(LOCATION_BOOK), { comment: 'Varnholde Crypts', key: ['Varnholde Crypts'], content: '[CORE]\nA crypt the agent described.\n[/CORE]\n[#4] The party found it.' }] })
        expect(await authored.architect.run({ chatId: 'c1', userId: 'u1', args: CALL })).toContain('Map saved to')
        const kept = authored.books.entriesOf('Vell_LOC').find((e) => e.comment === 'Varnholde Crypts')!
        expect(kept.content.startsWith('[CORE]\nA crypt the agent described.\n[/CORE]\n[#4] The party found it.')).toBe(true)
        // A new root entry carries it too, as before.
        const fresh = harness()
        await fresh.architect.run({ chatId: 'c1', userId: 'u1', args: CALL })
        expect(fresh.books.entriesOf('Vell_LOC').find((e) => e.comment === 'Varnholde Crypts')!.content.startsWith('[CORE]\nA flooded crypt.\n[/CORE]')).toBe(true)
    })
})

describe('answering CreateAreaMap', () => {
    it('draws the topology, then the contents, saves the map disabled in the campaign\'s place book, re-reads the maps, and answers with the canon', async () => {
        const { architect, books, calls, events, refreshed, state } = harness()
        const answer = await architect.run({ chatId: 'c1', userId: 'u1', args: CALL })
        expect(calls).toHaveLength(2)
        expect(calls[0]![0]!.content.startsWith('You are the Map Architect\'s topology specialist.')).toBe(true)
        expect(calls[0]![1]!.content).toContain('Exact site root: Varnholde Crypts')
        expect(calls[0]![1]!.content).toContain('Live location footer: Varnholde Road')
        expect(calls[0]![1]!.content).toContain('PLAYER: We go down.')
        expect(calls[1]![0]!.content.startsWith('You are the Map Architect\'s content-placement specialist.')).toBe(true)
        expect(calls[1]![1]!.content).toMatch(/Current in-world time \(authoritative\): [^\n]*Day 5/)
        expect(calls[1]![1]!.content).toContain('"id": "drowned-nave"')
        const made = books.entriesOf('Vell_LOC').find((e) => e.comment === 'Varnholde Crypts')!
        expect(made).toMatchObject({ key: ['Varnholde Crypts'], disabled: true })
        expect(made.content.startsWith('[CORE]\nA flooded crypt.\n[/CORE]\n\n[MAP]\n')).toBe(true)
        const stored = parseMapDocument(extractMapSection(made.content)).document
        expect(stored.areas).toHaveLength(5)
        expect(stored.assets.map((a) => a.id)).toEqual(['ghoul-pack', 'wax-seal', 'reliquary-chest', 'collapse'])
        expect(answer.startsWith('[MAP_ARCHITECT_RESULT — PRIVATE]\nMap saved to Vell_LOC::5.')).toBe(true)
        expect(answer).toContain('Ghoul Pack ×4')
        expect(answer).toContain('copy this exact site name into the Location footer: "Varnholde Crypts"')
        expect(refreshed).toEqual(['c1'])
        expect(events).toEqual(['started:Varnholde Crypts', 'finished:written'])
        expect((await state.load('c1', 'u1')).lastArchitect).toEqual({ status: 'written', at: '2026-10-02T12:00:00.000Z', site: 'Varnholde Crypts', kind: 'DUNGEON', areas: 5, assets: 4, entryId: 'Vell_LOC::5' })
    })

    it('attaches the map to a Location entry the agent already made for the site, and disables it', async () => {
        const { architect, books } = harness(GOOD, {}, { Vell_LOC: [{ comment: 'Varnholde Crypts', content: '[CORE]\nThe agent wrote this.\n[/CORE]\nA chronicle line.' }, { comment: 'Varnholde Crypts :: Broken Gate', content: 'The party camped here.' }] })
        const answer = await architect.run({ chatId: 'c1', userId: 'u1', args: CALL })
        expect(answer).toContain('Map saved to Vell_LOC::1.')
        const root = books.entriesOf('Vell_LOC')[0]!
        expect(root.content.startsWith('[CORE]\nThe agent wrote this.\n[/CORE]\nA chronicle line.')).toBe(true)
        expect(extractMapSection(root.content)).toContain('"site": "Varnholde Crypts"')
        expect(root.disabled).toBe(true)
        expect(books.entriesOf('Vell_LOC')).toHaveLength(2)
    })

    it('takes the agent\'s stamp off the site\'s name (71d-ter): a call naming a stamped root, or + MAP passing its title, files the map under the plain name and renames the root', async () => {
        const { architect, books } = harness(GOOD, {}, { Vell_LOC: [{ comment: 'Varnholde Crypts [msg #12]', content: '[CORE]\nThe agent wrote this.\n[/CORE]' }] })
        const answer = await architect.run({ chatId: 'c1', userId: 'u1', args: { ...CALL, site: 'Varnholde Crypts [msg #12]' } })
        expect(answer).toContain('Map saved to Vell_LOC::1.')
        expect(answer).not.toContain('[msg #')
        const root = books.entriesOf('Vell_LOC')[0]!
        expect(root.comment).toBe('Varnholde Crypts')
        expect(extractMapSection(root.content)).toContain('"site": "Varnholde Crypts"')
        expect(books.entriesOf('Vell_LOC')).toHaveLength(1)
        // The plain name finds the stamped root too, and a reuse answers by the plain name.
        const again = harness(GOOD, {}, { Vell_LOC: [{ comment: 'Varnholde Crypts [msg #3]', content: 'x' }] })
        await again.architect.run({ chatId: 'c1', userId: 'u1', args: CALL })
        expect(again.books.entriesOf('Vell_LOC').map((e) => e.comment)).toEqual(['Varnholde Crypts'])
    })

    it('makes the place book when the campaign has none, and records it as the campaign\'s', async () => {
        const { architect, books, owned } = harness(GOOD, {}, { Vell_NPC: [{ comment: 'Ilyra', content: 'x' }] })
        await architect.run({ chatId: 'c1', userId: 'u1', args: CALL })
        expect(books.books.map((b) => b.name)).toContain('Vell_LOC')
        expect(owned).toContain('Vell_LOC')
        expect(books.entriesOf('Vell_LOC')[0]?.comment).toBe('Varnholde Crypts')
    })

    it('corrects a rejected topology and rejected contents, up to twice each, naming the problems', async () => {
        const wrongSite = JSON.stringify({ ...TOPOLOGY, site: 'Elsewhere' })
        const lost = JSON.stringify({ assets: [{ ...ASSETS.assets[0], location: 'nowhere' }] })
        const { architect, calls } = harness([wrongSite, '{"version":3,"areas":[', JSON.stringify(TOPOLOGY), 'not json', lost, JSON.stringify(ASSETS)])
        const answer = await architect.run({ chatId: 'c1', userId: 'u1', args: CALL })
        expect(answer).toContain('Map saved to')
        expect(calls).toHaveLength(6)
        expect(calls[1]![1]!.content.startsWith('TOPOLOGY CORRECTION PASS 1')).toBe(true)
        expect(calls[1]![1]!.content).toContain('SITE_MISMATCH')
        expect(calls[2]![1]!.content.startsWith('TOPOLOGY CORRECTION PASS 2')).toBe(true)
        expect(calls[2]![1]!.content).toContain('INVALID_JSON')
        expect(calls[4]![1]!.content.startsWith('CONTENT CORRECTION PASS 1')).toBe(true)
        expect(calls[5]![1]!.content.startsWith('CONTENT CORRECTION PASS 2')).toBe(true)
        // Three strikes on the topology: nothing saved, the narrator told why.
        const stubborn = harness([wrongSite, wrongSite, wrongSite])
        const failed = await stubborn.architect.run({ chatId: 'c1', userId: 'u1', args: CALL })
        expect(failed.startsWith('[MAP_ARCHITECT_ERROR — PRIVATE]\nThe architect could not produce a valid connected topology after 3 attempts. Nothing was saved. Problems: SITE_MISMATCH')).toBe(true)
        expect(stubborn.calls).toHaveLength(3)
        expect(stubborn.books.entriesOf('Vell_LOC').some((e) => e.comment === 'Varnholde Crypts')).toBe(false)
        expect(stubborn.events).toEqual(['started:Varnholde Crypts', 'finished:failed'])
        expect((await stubborn.state.load('c1', 'u1')).lastArchitect).toMatchObject({ status: 'failed', reason: expect.stringContaining('valid connected topology') })
        const hollow = harness([JSON.stringify(TOPOLOGY), lost, lost, lost])
        expect(await hollow.architect.run({ chatId: 'c1', userId: 'u1', args: CALL })).toContain('could not place valid contents after 3 attempts')
        expect(hollow.calls).toHaveLength(4)
    })

    it('hands back the map that is there rather than drawing it twice', async () => {
        const { architect, calls, events } = harness()
        const answer = await architect.run({ chatId: 'c1', userId: 'u1', args: { ...CALL, site: 'the abbey undercroft' } })
        expect(answer).toContain('A map for Abbey Undercroft was already attached. Reuse it; do not create or replace it.')
        expect(calls).toHaveLength(0)
        // Nothing ran, so nothing started; the fold's note is the finished event's.
        expect(events).toEqual(['finished:reused'])
    })

    it('refuses a bad call, a nested map, the section off, a nameless campaign and a model error, each in the private envelope, and saves nothing', async () => {
        const bad = harness()
        expect(await bad.architect.run({ chatId: 'c1', userId: 'u1', args: { site: 'X' } })).toContain('site, entrance, and prompt are required')
        expect(bad.events).toEqual([])
        expect((await bad.state.load('c1', 'u1')).lastArchitect).toMatchObject({ status: 'failed', site: 'X' })
        // A nested map is drawn since 58; one whose parent the campaign does not map is refused in the attachment envelope.
        const unhosted = await bad.architect.run({ chatId: 'c1', userId: 'u1', args: { ...CALL, attachTo: { site: 'Nowhere Keep', cell: 'Cellar Landing' } } })
        expect(unhosted.startsWith('[MAP_ARCHITECT_ATTACHMENT_ERROR — PRIVATE]\nParent map "Nowhere Keep" was not found exactly.')).toBe(true)
        expect(unhosted).toContain('Available mapped sites: Abbey Undercroft, Morrowfen.')
        expect((await bad.state.load('c1', 'u1')).lastArchitect).toMatchObject({ status: 'failed', reason: expect.stringContaining('Parent map "Nowhere Keep" was not found exactly') })
        const off = harness(GOOD, { enabled: async () => false })
        expect(await off.architect.run({ chatId: 'c1', userId: 'u1', args: CALL })).toContain('mapping section is off')
        expect(off.calls).toHaveLength(0)
        const nameless = harness(GOOD, { campaign: async () => ({ prefix: '', owned: [] }) })
        expect(await nameless.architect.run({ chatId: 'c1', userId: 'u1', args: CALL })).toContain('no name')
        const broken = harness(['throw:refused'])
        const answer = await broken.architect.run({ chatId: 'c1', userId: 'u1', args: CALL })
        expect(answer.startsWith('[MAP_ARCHITECT_ERROR — PRIVATE]\nMap Architect failed before a validated map could be saved: refused')).toBe(true)
        expect(answer.trimEnd().endsWith('[/MAP_ARCHITECT_ERROR]')).toBe(true)
        expect(broken.books.entriesOf('Vell_LOC').some((e) => e.comment === 'Varnholde Crypts')).toBe(false)
        expect(broken.events).toEqual(['started:Varnholde Crypts', 'finished:failed'])
    })

    it('uses the user\'s own placement prompt when there is one, and reads the lookback it is given', async () => {
        const { architect, calls } = harness(GOOD, { options: async () => ({ lookback: 1, systemPrompt: 'Place sparsely.' }) })
        await architect.run({ chatId: 'c1', userId: 'u1', args: CALL })
        expect(calls[1]![0]!.content).toBe('Place sparsely.')
        expect(calls[0]![1]!.content).toContain('NARRATOR: The gate is broken.')
        expect(calls[0]![1]!.content).not.toContain('PLAYER: We go down.')
    })

    it('answers the tool at once that the map is being drawn, and draws it behind the reply (34a-bis)', async () => {
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => { release = resolve })
        let n = 0
        const { architect, books, calls, events, refreshed, state } = harness([], { generate: async (messages) => { calls.push(messages); if (n++ === 0) await gate; return n === 1 ? JSON.stringify(TOPOLOGY) : JSON.stringify(ASSETS) } })
        const answer = await architect.answer({ chatId: 'c1', userId: 'u1', args: CALL })
        // Answered before the first model call has returned.
        expect(answer.startsWith('[MAP_ARCHITECT_RESULT — PRIVATE]\nThe Map Architect is drawing "Varnholde Crypts" (DUNGEON) now.')).toBe(true)
        expect(answer).toContain('Narrate only up to and including the entrance, Broken Gate')
        expect(calls.length).toBeLessThanOrEqual(1)
        expect(events).toEqual(['started:Varnholde Crypts'])
        expect(refreshed).toEqual([])
        expect(books.entriesOf('Vell_LOC').some((e) => e.comment === 'Varnholde Crypts')).toBe(false)
        // A second call while it draws is told the same, not refused and not drawn twice.
        expect(await architect.answer({ chatId: 'c1', userId: 'u1', args: CALL })).toBe(answer)
        expect(calls.length).toBeLessThanOrEqual(1)
        // The drawing goes on without the narrator: the save, the re-read and the finished event land after.
        release()
        const finished = await architect.run({ chatId: 'c1', userId: 'u1', args: CALL })
        expect(finished).toContain('Map saved to Vell_LOC::5.')
        expect(calls).toHaveLength(2)
        expect(events).toEqual(['started:Varnholde Crypts', 'finished:written'])
        expect(refreshed).toEqual(['c1'])
        expect(books.entriesOf('Vell_LOC').find((e) => e.comment === 'Varnholde Crypts')?.disabled).toBe(true)
        expect((await state.load('c1', 'u1')).lastArchitect).toMatchObject({ status: 'written', site: 'Varnholde Crypts' })
        // Once it is drawn, a further call is answered from the book, not from the finished run.
        expect(await architect.answer({ chatId: 'c1', userId: 'u1', args: CALL })).toContain('A map for Varnholde Crypts was already attached.')
        expect(events).toEqual(['started:Varnholde Crypts', 'finished:written', 'finished:reused'])
        expect(calls).toHaveLength(2)
    })

    it('answers a refusal, the section off and a site already mapped in full, at once, with nothing left drawing (34a-bis)', async () => {
        const bad = harness()
        expect(await bad.architect.answer({ chatId: 'c1', userId: 'u1', args: { site: 'X' } })).toContain('site, entrance, and prompt are required')
        expect(bad.events).toEqual([])
        const off = harness(GOOD, { enabled: async () => false })
        expect(await off.architect.answer({ chatId: 'c1', userId: 'u1', args: CALL })).toContain('mapping section is off')
        expect(off.calls).toHaveLength(0)
        expect(off.events).toEqual([])
        expect((await off.state.load('c1', 'u1')).lastArchitect).toMatchObject({ status: 'failed', site: 'Varnholde Crypts', reason: expect.stringContaining('mapping section is off') })
        // A refusal holds nothing: the same site can be drawn once the section is on.
        let on = false
        const later = harness(GOOD, { enabled: async () => on })
        expect(await later.architect.answer({ chatId: 'c1', userId: 'u1', args: CALL })).toContain('mapping section is off')
        on = true
        expect(await later.architect.answer({ chatId: 'c1', userId: 'u1', args: CALL })).toContain('is drawing "Varnholde Crypts"')
        expect(await later.architect.run({ chatId: 'c1', userId: 'u1', args: CALL })).toContain('Map saved to')
        const there = harness()
        const answer = await there.architect.answer({ chatId: 'c1', userId: 'u1', args: { ...CALL, site: 'Abbey Undercroft' } })
        expect(answer).toContain('A map for Abbey Undercroft was already attached. Reuse it; do not create or replace it.')
        expect(there.calls).toHaveLength(0)
        expect(there.events).toEqual(['finished:reused'])
        // A failure behind the reply is recorded for the fold and the event, with nothing saved.
        const broken = harness(['throw:refused'])
        const ack = await broken.architect.answer({ chatId: 'c1', userId: 'u1', args: CALL })
        expect(ack).toContain('is drawing "Varnholde Crypts"')
        await broken.architect.run({ chatId: 'c1', userId: 'u1', args: CALL })
        expect(broken.events).toEqual(['started:Varnholde Crypts', 'finished:failed'])
        expect((await broken.state.load('c1', 'u1')).lastArchitect).toMatchObject({ status: 'failed', reason: expect.stringContaining('refused') })
        expect(broken.books.entriesOf('Vell_LOC').some((e) => e.comment === 'Varnholde Crypts')).toBe(false)
    })

    it('answers a second call for the same site with the run already in flight', async () => {
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => { release = resolve })
        let n = 0
        const { architect, calls } = harness([], { generate: async (messages) => { calls.push(messages); if (n++ === 0) await gate; return n === 1 ? JSON.stringify(TOPOLOGY) : JSON.stringify(ASSETS) } })
        const first = architect.run({ chatId: 'c1', userId: 'u1', args: CALL })
        const second = architect.run({ chatId: 'c1', userId: 'u1', args: CALL })
        release()
        const [a, b] = await Promise.all([first, second])
        expect(a).toBe(b)
        expect(calls).toHaveLength(2)
    })
})

// ── nested maps (58) ────────────────────────────────────────────────────

/** A mapped town with a building the party could enter, and a cell with none. */
const TOWN = {
    version: 3, site: 'Elmridge', kind: 'SETTLEMENT', threat: 'LOW',
    areas: [
        { id: 'market-square', name: 'Market Square', knowledge: 'VISITED', geometry: ['A cobbled square.'], connections: [{ to: 'mill-row', state: 'OPEN', detail: 'A lane' }] },
        { id: 'mill-row', name: 'Mill Row', knowledge: 'DISCOVERED', geometry: ['A row of mills.'], connections: [{ to: 'market-square', state: 'OPEN', detail: 'A lane' }] },
    ],
    assets: [{ id: 'old-mill', kind: 'BUILDING', name: 'Old Mill', location: 'mill-row', state: 'ACTIVE', knowledge: 'KNOWN', detail: 'A disused mill.', origin: 'INITIAL_MAP' }],
}
const TOWN_ENTRY = { comment: 'Elmridge', key: ['Elmridge'], content: `[CORE]\nA river town.\n[/CORE]\n\n[MAP]\n${JSON.stringify(TOWN)}\n[/MAP]` }
/** The mill as the model draws it: four rooms, the entrance first. */
const mill = (entranceKnowledge: string) => ({
    version: 3, site: 'Old Mill', kind: 'INTERIOR', threat: 'LOW',
    areas: [
        { id: 'mill-door', name: 'Mill Door', knowledge: entranceKnowledge, geometry: ['A warped door.'], connections: [{ to: 'grindstone', state: 'OPEN', detail: 'A short hall' }] },
        { id: 'grindstone', name: 'Grindstone Room', knowledge: 'UNREVEALED', geometry: ['A great stone.'], connections: [{ to: 'mill-door', state: 'OPEN', detail: 'A short hall' }, { to: 'loft', state: 'OPEN', detail: 'A ladder' }, { to: 'cellar', state: 'CLOSED', detail: 'A trapdoor' }] },
        { id: 'loft', name: 'Grain Loft', knowledge: 'UNREVEALED', geometry: ['Sacks and dust.'], connections: [{ to: 'grindstone', state: 'OPEN', detail: 'A ladder' }] },
        { id: 'cellar', name: 'Flour Cellar', knowledge: 'UNREVEALED', geometry: ['A low cellar.'], connections: [{ to: 'grindstone', state: 'CLOSED', detail: 'A trapdoor' }] },
    ],
})
const MILL_ASSETS = { assets: [{ id: 'miller', kind: 'CREATURE', name: 'Old Miller', location: 'grindstone', state: 'ACTIVE', knowledge: 'UNREVEALED', detail: 'Dusty and deaf.', origin: 'INITIAL_MAP' }] }
const MILL_CALL = { site: 'Old Mill', entrance: 'Mill Door', kind: 'INTERIOR', scale: 'SMALL', threat: 'LOW', prompt: 'A disused mill with a deaf miller and a flour cellar.', brief_description: 'A disused mill.' }
const ATTACHED = { ...MILL_CALL, attachTo: { site: 'Elmridge', cell: 'Mill Row' } }
const CANONICAL = 'Elmridge :: Mill Row :: Old Mill'

describe('nested maps (58)', () => {
    it('draws an explicit attachment offsite: the parent cell told to both prompts, the entrance unrevealed, the building promoted to a gateway, the child filed under its canonical path with its host mirrored, the parent rewritten and disabled, and the narrator told nothing moved', async () => {
        const h = harness([JSON.stringify(mill('UNREVEALED')), JSON.stringify(MILL_ASSETS)], {}, { Vell_LOC: [TOWN_ENTRY, { comment: 'Elmridge :: Market Square', content: 'The square.' }] })
        const answer = await h.architect.run({ chatId: 'c1', userId: 'u1', args: ATTACHED })
        expect(h.calls).toHaveLength(2)
        const topology = h.calls[0]![1]!.content
        expect(topology).toContain('Entrance knowledge: UNREVEALED (offsite structural creation; the party has not entered)')
        expect(topology).toContain('Attachment: Create offsite and attach beneath map "Elmridge" in exact cell "Mill Row".')
        expect(topology).toContain('PARENT MAP CELL (LOCKED STRUCTURAL CONTEXT)')
        expect(topology).toContain('Target cell: Mill Row [mill-row]')
        const contents = h.calls[1]![1]!.content
        expect(contents).toContain('PARENT MAP CELL (LOCKED CONTEXT)')
        expect(contents).toContain('- old-mill: BUILDING "Old Mill" (ACTIVE, KNOWN) — A disused mill.')

        const entries = h.books.entriesOf('Vell_LOC')
        const parent = entries.find((e) => e.comment === 'Elmridge')!
        const parentMap = parseMapDocument(extractMapSection(parent.content)).document
        expect(parentMap.assets).toEqual([expect.objectContaining({ id: 'old-mill', kind: 'SUBINTERIOR', name: 'Old Mill', location: 'mill-row', knowledge: 'KNOWN' })])
        expect(parent.content.startsWith('[CORE]\nA river town.\n[/CORE]')).toBe(true)
        expect(parent).toMatchObject({ disabled: true })

        const child = entries.find((e) => e.comment === CANONICAL)!
        expect(child).toMatchObject({ key: ['Old Mill', CANONICAL], disabled: true })
        expect(child.content.startsWith('[CORE]\nA disused mill.\nHost Site: Elmridge\nHost Brief: Contained in Elmridge, Mill Row. A row of mills. Exit returns to Mill Row in Elmridge.\n[/CORE]\n\n[MAP]\n')).toBe(true)
        const childMap = parseMapDocument(extractMapSection(child.content)).document
        expect(childMap).toMatchObject({ site: CANONICAL, kind: 'INTERIOR', hostSite: 'Elmridge', hostBrief: 'Contained in Elmridge, Mill Row. A row of mills. Exit returns to Mill Row in Elmridge.' })
        expect(childMap.areas[0]).toMatchObject({ id: 'mill-door', knowledge: 'UNREVEALED' })
        expect(childMap.assets.map((a) => a.id)).toEqual(['miller'])

        expect(answer.startsWith('[MAP_ARCHITECT_RESULT — PRIVATE]\nMap saved to Vell_LOC::3.')).toBe(true)
        expect(answer).toContain('This was an offsite structural edit. Do not move the player, change the Location footer, or narrate entry into the new map.')
        expect(answer).not.toContain('copy this exact site name')
        expect(h.events).toEqual(['started:Old Mill', 'finished:written'])
        expect((await h.state.load('c1', 'u1')).lastArchitect).toMatchObject({ status: 'written', site: 'Old Mill', kind: 'INTERIOR', areas: 4, assets: 1, entryId: 'Vell_LOC::3' })
        expect(h.refreshed).toEqual(['c1'])
    })

    it('answers an explicit attachment at once with an offsite acknowledgement, and the drawing goes on behind it; a cell with no matching building gets a gateway made anew, unrevealed', async () => {
        const bare = { ...TOWN_ENTRY, content: TOWN_ENTRY.content.replace(JSON.stringify(TOWN), JSON.stringify({ ...TOWN, assets: [] })) }
        const h = harness([JSON.stringify(mill('UNREVEALED')), JSON.stringify(MILL_ASSETS)], {}, { Vell_LOC: [bare] })
        const answer = await h.architect.answer({ chatId: 'c1', userId: 'u1', args: ATTACHED })
        expect(answer).toContain('The Map Architect is drawing "Old Mill" (INTERIOR) inside "Elmridge", in the cell named, now.')
        expect(answer).toContain('This is an offsite structural edit. Do not move the player, change the Location footer, or narrate entry into the new map.')
        expect(answer).not.toContain('Narrate only up to and including the entrance')
        await h.architect.run({ chatId: 'c1', userId: 'u1', args: ATTACHED })
        expect(h.books.entriesOf('Vell_LOC').some((e) => e.comment === CANONICAL)).toBe(true)
        const parentMap = parseMapDocument(extractMapSection(h.books.entriesOf('Vell_LOC').find((e) => e.comment === 'Elmridge')!.content)).document
        expect(parentMap.assets).toEqual([expect.objectContaining({ kind: 'SUBINTERIOR', name: 'Old Mill', location: 'mill-row', knowledge: 'UNREVEALED', detail: 'A disused mill.', origin: 'NARRATOR_ESTABLISHED' })])
        expect(parentMap.assets[0]!.id.startsWith('subsite-')).toBe(true)
    })

    it('takes the active cell as shorthand for an interior made with the party inside a mapped town: the gateway made anew and known, the entrance visited, the narrator sent on as for any map', async () => {
        const h = harness([JSON.stringify(mill('VISITED')), JSON.stringify(MILL_ASSETS)], {
            story: async () => ({ lines: ['NARRATOR: The square is busy.'], lastReply: 'The square is busy. *(Location: Elmridge, Market Square)*' }),
        }, { Vell_LOC: [TOWN_ENTRY] })
        const second = h
        const drawn = await second.architect.run({ chatId: 'c1', userId: 'u1', args: MILL_CALL })
        expect(second.calls[0]![1]!.content).toContain('Entrance knowledge: VISITED')
        expect(second.calls[0]![1]!.content).toContain('No explicit offsite attachment; runtime may use the active mapped cell as shorthand.')
        expect(second.calls[0]![1]!.content).toContain('Target cell: Mill Row [mill-row]')
        const parentMap = parseMapDocument(extractMapSection(second.books.entriesOf('Vell_LOC').find((e) => e.comment === 'Elmridge')!.content)).document
        expect(parentMap.assets).toEqual([expect.objectContaining({ id: 'old-mill', kind: 'SUBINTERIOR', location: 'mill-row', knowledge: 'KNOWN' })])
        expect(second.books.entriesOf('Vell_LOC').some((e) => e.comment === CANONICAL)).toBe(true)
        expect(drawn).toContain('Continue narration from Mill Door; reveal only what the player can perceive. Once they enter, copy this exact site name into the Location footer: "Old Mill".')
    })

    it('links an existing standalone map inside its host without drawing: the root renamed to the canonical path with its breadcrumbs, the gateway promoted, the host mirrored into the CORE', async () => {
        const standalone = { comment: 'Old Mill', key: ['Old Mill'], content: `[CORE]\nThe agent wrote this.\n[/CORE]\n\n[MAP]\n${JSON.stringify({ ...mill('VISITED'), ...MILL_ASSETS })}\n[/MAP]` }
        const h = harness(GOOD, {}, { Vell_LOC: [TOWN_ENTRY, standalone, { comment: 'Old Mill :: Grindstone Room', content: 'The stone turned.' }] })
        const answer = await h.architect.run({ chatId: 'c1', userId: 'u1', args: ATTACHED })
        expect(h.calls).toHaveLength(0)
        expect(answer.startsWith('[MAP_ARCHITECT_RESULT — PRIVATE]\nThe existing peer map was preserved and linked inside Elmridge.')).toBe(true)
        expect(answer).toContain('This was an offsite structural edit. Keep the current player location and narration unchanged.')
        const entries = h.books.entriesOf('Vell_LOC')
        const root = entries.find((e) => e.comment === CANONICAL)!
        expect(root).toMatchObject({ key: ['Old Mill', CANONICAL], disabled: true })
        expect(root.content.startsWith('[CORE]\nThe agent wrote this.\nHost Site: Elmridge\nHost Brief: Contained in Elmridge, Mill Row.')).toBe(true)
        expect(parseMapDocument(extractMapSection(root.content)).document).toMatchObject({ site: CANONICAL, hostSite: 'Elmridge' })
        expect(entries.some((e) => e.comment === `${CANONICAL} :: Grindstone Room` && e.content === 'The stone turned.')).toBe(true)
        expect(entries.some((e) => e.comment === 'Old Mill')).toBe(false)
        expect(parseMapDocument(extractMapSection(entries.find((e) => e.comment === 'Elmridge')!.content)).document.assets[0]).toMatchObject({ kind: 'SUBINTERIOR', name: 'Old Mill' })
        expect(h.events).toEqual(['finished:written'])
        expect(h.books.log.some((l) => l.startsWith('update e2 content,disabled,comment,key'))).toBe(true)
        expect(h.books.log.some((l) => l.startsWith('update e3 content,comment,key'))).toBe(true)
    })

    it('refuses what the hosting refuses, in its own envelope, with nothing drawn or saved: a settlement attached, a cell not found, a kind the gateway cannot take', async () => {
        const settlement = harness(GOOD, {}, { Vell_LOC: [TOWN_ENTRY] })
        const refused = await settlement.architect.run({ chatId: 'c1', userId: 'u1', args: { ...CALL, kind: 'SETTLEMENT', attachTo: { site: 'Elmridge', cell: 'Mill Row' } } })
        expect(refused.startsWith('[MAP_ARCHITECT_ATTACHMENT_ERROR — PRIVATE]\nattachTo is valid only when creating a DUNGEON or INTERIOR child map.')).toBe(true)
        expect(settlement.calls).toHaveLength(0)
        const cell = await settlement.architect.run({ chatId: 'c1', userId: 'u1', args: { ...ATTACHED, attachTo: { site: 'Elmridge', cell: 'Harbour' } } })
        expect(cell).toContain('Cell "Harbour" was not found exactly in "Elmridge". Available cells: Market Square, Mill Row.')
        // The building is a BUILDING, which may become either gateway; an interior map named as a dungeon is the mismatch the save refuses.
        const standalone = { comment: 'Old Mill', key: ['Old Mill'], content: `[MAP]\n${JSON.stringify({ ...mill('VISITED'), ...MILL_ASSETS })}\n[/MAP]` }
        const mismatch = harness(GOOD, {}, { Vell_LOC: [TOWN_ENTRY, standalone] })
        const wrong = await mismatch.architect.run({ chatId: 'c1', userId: 'u1', args: { ...ATTACHED, kind: 'DUNGEON' } })
        expect(wrong).toContain('SUBDUNGEON requires a DUNGEON peer map, received INTERIOR.')
        expect(mismatch.calls).toHaveLength(0)
        expect(parseMapDocument(extractMapSection(mismatch.books.entriesOf('Vell_LOC')[0]!.content)).document.assets[0]!.kind).toBe('BUILDING')
        expect(mismatch.books.entriesOf('Vell_LOC').some((e) => e.comment === CANONICAL)).toBe(false)
    })
})

describe('settlement inclusion (62)', () => {
    /** The town as the model draws it around the mill: four districts (a SMALL settlement's floor), every lane reciprocal, no assets yet. */
    const TOWN_TOPOLOGY = {
        version: 3, site: 'Elmridge', kind: 'SETTLEMENT', threat: 'LOW',
        areas: [
            { id: 'market-square', name: 'Market Square', knowledge: 'VISITED', geometry: ['A cobbled square.'], connections: [{ to: 'mill-row', state: 'OPEN', detail: 'A lane' }, { to: 'chapel-close', state: 'OPEN', detail: 'A lane' }] },
            { id: 'mill-row', name: 'Mill Row', knowledge: 'DISCOVERED', geometry: ['A row of mills.'], connections: [{ to: 'market-square', state: 'OPEN', detail: 'A lane' }, { to: 'river-gate', state: 'OPEN', detail: 'A towpath' }] },
            { id: 'chapel-close', name: 'Chapel Close', knowledge: 'UNREVEALED', geometry: ['A quiet close.'], connections: [{ to: 'market-square', state: 'OPEN', detail: 'A lane' }] },
            { id: 'river-gate', name: 'River Gate', knowledge: 'UNREVEALED', geometry: ['A gate on the water.'], connections: [{ to: 'mill-row', state: 'OPEN', detail: 'A towpath' }] },
        ],
    }
    const TOWN_ASSETS = { assets: [{ id: 'old-mill', kind: 'SUBINTERIOR', name: 'Old Mill', location: 'mill-row', state: 'ACTIVE', knowledge: 'KNOWN', detail: 'A disused mill.', origin: 'INITIAL_MAP' }] }
    const TOWN_CALL = { site: 'Elmridge', entrance: 'Market Square', kind: 'SETTLEMENT', scale: 'SMALL', threat: 'LOW', prompt: 'A river town grown up around an old mill.', brief_description: 'A river town.', include: ['Old Mill'] }
    const STANDALONE_MILL = { comment: 'Old Mill', key: ['Old Mill'], content: `[CORE]\nThe agent wrote this.\n[/CORE]\n\n[MAP]\n${JSON.stringify({ ...mill('VISITED'), ...MILL_ASSETS })}\n[/MAP]` }
    const withLog = () => { const lines: string[] = []; return { lines, log: { info: (m: string) => { lines.push(m) }, warn: (m: string) => { lines.push(`warn: ${m}`) } } } }

    it('absorbs an existing standalone map into a new settlement: the peer locked in the contents prompt, placed as a gateway asset, then filed under the settlement with its breadcrumbs, stamped, mirrored and disabled', async () => {
        const { lines, log } = withLog()
        const h = harness([JSON.stringify(TOWN_TOPOLOGY), JSON.stringify(TOWN_ASSETS)], { log }, { Vell_LOC: [STANDALONE_MILL, { comment: 'Old Mill :: Grindstone Room', content: 'The stone turned.' }] })
        const answer = await h.architect.run({ chatId: 'c1', userId: 'u1', args: TOWN_CALL })
        expect(h.calls).toHaveLength(2)
        expect(h.calls[0]![1]!.content).not.toContain('INCLUDED EXISTING PEERS')
        expect(h.calls[1]![1]!.content).toContain('INCLUDED EXISTING PEERS (LOCKED)\n- Old Mill: create exactly one SUBINTERIOR asset with name exactly "Old Mill" and place it in the correct settlement district.')

        const entries = h.books.entriesOf('Vell_LOC')
        const town = entries.find((e) => e.comment === 'Elmridge')!
        expect(town).toMatchObject({ key: ['Elmridge'], disabled: true })
        const townMap = parseMapDocument(extractMapSection(town.content)).document
        expect(townMap.assets).toEqual([expect.objectContaining({ id: 'old-mill', kind: 'SUBINTERIOR', name: 'Old Mill', location: 'mill-row' })])
        expect(townMap.hostSite).toBeUndefined()

        const peer = entries.find((e) => e.comment === CANONICAL)!
        expect(peer).toMatchObject({ key: ['Old Mill', CANONICAL], disabled: true })
        expect(peer.content.startsWith('[CORE]\nThe agent wrote this.\nHost Site: Elmridge\nHost Brief: Contained in Elmridge, Mill Row. A row of mills. Exit returns to Mill Row in Elmridge.\n[/CORE]\n\n[MAP]\n')).toBe(true)
        const peerMap = parseMapDocument(extractMapSection(peer.content)).document
        expect(peerMap).toMatchObject({ site: CANONICAL, kind: 'INTERIOR', hostSite: 'Elmridge', hostBrief: 'Contained in Elmridge, Mill Row. A row of mills. Exit returns to Mill Row in Elmridge.' })
        expect(peerMap.assets.map((a) => a.id)).toEqual(['miller'])
        expect(entries.some((e) => e.comment === `${CANONICAL} :: Grindstone Room` && e.content === 'The stone turned.')).toBe(true)
        expect(entries.some((e) => e.comment === 'Old Mill')).toBe(false)

        expect(answer.startsWith('[MAP_ARCHITECT_RESULT — PRIVATE]\nMap saved to Vell_LOC::3.')).toBe(true)
        expect(answer).toContain('Continue narration from Market Square')
        expect(lines).toContain('map: architect absorbed the map of "Old Mill" into "Elmridge" as Elmridge :: Mill Row :: Old Mill')
        expect(lines).toContain('map: architect saved "Elmridge" (SETTLEMENT, 4 areas, 1 assets) to Vell_LOC::3, absorbing "Old Mill"')
        expect((await h.state.load('c1', 'u1')).lastArchitect).toMatchObject({ status: 'written', site: 'Elmridge', kind: 'SETTLEMENT', areas: 4, assets: 1 })
    })

    it('names the absorbed maps in the acknowledgement, and corrects a contents reply that forgot the peer\'s asset before saving', async () => {
        const forgot = { assets: [{ id: 'crier', kind: 'CREATURE', name: 'Town Crier', location: 'market-square', state: 'ACTIVE', knowledge: 'KNOWN', detail: 'Loud.', origin: 'INITIAL_MAP' }] }
        const h = harness([JSON.stringify(TOWN_TOPOLOGY), JSON.stringify(forgot), JSON.stringify(TOWN_ASSETS)], {}, { Vell_LOC: [STANDALONE_MILL] })
        const answer = await h.architect.answer({ chatId: 'c1', userId: 'u1', args: TOWN_CALL })
        expect(answer).toContain('The Map Architect is drawing "Elmridge" (SETTLEMENT) now.')
        expect(answer).toContain('The existing maps of "Old Mill" will be absorbed into it as peers, each reachable from the district it is placed in.')
        const drawn = await h.architect.run({ chatId: 'c1', userId: 'u1', args: TOWN_CALL })
        expect(h.calls).toHaveLength(3)
        const correction = h.calls[2]![1]!.content
        expect(correction).toContain('CONTENT CORRECTION PASS 1')
        expect(correction).toContain('INCLUDED_PEER_COUNT')
        // Inside the prompt's JSON block, so the quotes are escaped.
        expect(correction).toContain('Create exactly one asset named \\"Old Mill\\" for the included peer.')
        expect(correction).toContain('INCLUDED EXISTING PEERS (LOCKED)')
        expect(drawn.startsWith('[MAP_ARCHITECT_RESULT — PRIVATE]\nMap saved to')).toBe(true)
        expect(h.books.entriesOf('Vell_LOC').some((e) => e.comment === CANONICAL)).toBe(true)
    })

    it('refuses, in the envelope and before any drawing: a name that matches no mapped site, a settlement, a peer hosted elsewhere, and a settlement that already has a map', async () => {
        const unknown = harness(GOOD, {}, { Vell_LOC: [STANDALONE_MILL] })
        const refused = await unknown.architect.run({ chatId: 'c1', userId: 'u1', args: { ...TOWN_CALL, include: ['Old Mil'] } })
        expect(refused).toContain('[MAP_ARCHITECT_ERROR — PRIVATE]\ninclude must name one existing mapped DUNGEON or INTERIOR exactly. Could not resolve "Old Mil".')
        expect(unknown.calls).toHaveLength(0)
        expect(unknown.events).toEqual([])

        const settlement = harness(GOOD, {}, { Vell_LOC: [TOWN_ENTRY] })
        expect(await settlement.architect.run({ chatId: 'c1', userId: 'u1', args: { ...TOWN_CALL, site: 'Newtown', include: ['Elmridge'] } })).toContain('Included site "Elmridge" is SETTLEMENT; only DUNGEON or INTERIOR peers can be absorbed.')

        const hostedMill = { comment: CANONICAL, key: ['Old Mill', CANONICAL], content: `[CORE]\nx\n[/CORE]\n\n[MAP]\n${JSON.stringify({ ...mill('VISITED'), ...MILL_ASSETS, site: CANONICAL, hostSite: 'Elmridge', hostBrief: 'b' })}\n[/MAP]` }
        const hosted = harness(GOOD, {}, { Vell_LOC: [TOWN_ENTRY, hostedMill] })
        expect(await hosted.architect.run({ chatId: 'c1', userId: 'u1', args: { ...TOWN_CALL, site: 'Newtown', include: [CANONICAL] } })).toContain(`Included site "${CANONICAL}" is already hosted inside "Elmridge" and cannot be re-hosted.`)

        const mapped = harness(GOOD, {}, { Vell_LOC: [TOWN_ENTRY, STANDALONE_MILL] })
        expect(await mapped.architect.run({ chatId: 'c1', userId: 'u1', args: TOWN_CALL })).toContain('[MAP_ARCHITECT_ERROR — PRIVATE]\ninclude[] cannot modify a SETTLEMENT that already has a stored map.')
        expect(mapped.calls).toHaveLength(0)
        expect(mapped.books.entriesOf('Vell_LOC').some((e) => e.comment === 'Old Mill')).toBe(true)
    })
})

describe('the book it makes (66)', () => {
    it('records and attaches a _LOC it made through the made hook, even when the campaign already owned the name', async () => {
        // The campaign owns the name from a book since removed: the list says `Vell_LOC`, the host has no such book.
        const h = harness(GOOD, {}, { Vell_NPC: [{ comment: 'Ilyra', content: 'x' }] })
        h.owned.push('Vell_LOC')
        expect(await h.architect.run({ chatId: 'c1', userId: 'u1', args: CALL })).toContain('Map saved to')
        expect(h.books.log).toContain('create book Vell_LOC')
        expect(h.made).toEqual(['Vell_LOC'])
        expect(h.owned.filter((n) => n === 'Vell_LOC')).toHaveLength(1)
    })
})

describe('the terminal’s steps (71b)', () => {
    it('announces the run, the topology and the contents, the lock, the save and the end; a reuse and a failure too', async () => {
        const steps: Array<[string, string, number | undefined]> = []
        const stepsDep = () => (type: string, content: string, meta?: { seconds?: number }) => { steps.push([type, content, meta?.seconds]) }
        const { architect } = harness(GOOD, { steps: stepsDep })
        await architect.run({ chatId: 'c1', userId: 'u1', args: CALL })
        expect(steps.map((s) => [s[0], s[1]])).toEqual([
            ['start', 'Initializing Map Architect for Varnholde Crypts…'],
            ['thought', 'Building topology for Varnholde Crypts…'],
            ['result', 'Topology locked with 5 areas for Varnholde Crypts.'],
            ['thought', 'Populating the locked areas of Varnholde Crypts…'],
            ['result', 'Map saved to Vell_LOC::5: DUNGEON, 5 areas, 4 assets.'],
            ['finish', 'Map Architect finished for Varnholde Crypts.'],
        ])
        expect(typeof steps.at(-1)![2]).toBe('number')
        steps.length = 0
        await architect.run({ chatId: 'c1', userId: 'u1', args: CALL })
        expect(steps).toEqual([['finish', 'Reused existing map for Varnholde Crypts.', undefined]])
        steps.length = 0
        const refused = harness(GOOD, { steps: stepsDep })
        await refused.architect.run({ chatId: 'c1', userId: 'u1', args: { ...CALL, site: '' } })
        expect(steps[0]![0]).toBe('error')
    })
})
