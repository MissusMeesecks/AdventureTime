import { describe, expect, it, vi } from 'vitest'

import { extractMapSection, parseMapDocument, serializeMapDocument } from '../tracker/map.js'
import { LOCATION_BOOK, UNDERCROFT } from '../tracker/map.test.js'
import { DEFAULT_MAP_UPDATER_DIRECT_SYSTEM_PROMPT, DEFAULT_MAP_UPDATER_SYSTEM_PROMPT, MAP_OPERATION_IDS_KEY } from '../tracker/updater.js'
import { TOWN } from '../tracker/updater.test.js'
import { MapStore } from './map-store.js'
import { createMapUpdater, type MapUpdaterDeps, type UpdaterMessage } from './map-updater.js'
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
        entries.set(book.id, list.map((e, i) => ({ id: `e${n++}`, uid: e.uid ?? String(i + 1), key: e.key ?? [], content: e.content ?? '', comment: e.comment ?? '', extensions: e.extensions ?? {}, disabled: e.disabled })))
    }
    const store: WorldBookStore = {
        listBooks: async () => books.map((b) => ({ ...b })),
        createBook: async (name) => { const book = { id: `b${books.length + 1}`, name }; books.push(book); entries.set(book.id, []); return { ...book } },
        listEntries: async (id) => (entries.get(id) ?? []).map((e) => ({ ...e, extensions: { ...(e.extensions ?? {}) } })),
        createEntry: async (id, entry) => {
            const list = entries.get(id)!
            const made: Entry = { id: `e${n++}`, uid: String(list.length + 1), key: entry.key, comment: entry.comment, content: entry.content, extensions: entry.extensions ?? {}, disabled: entry.disabled }
            list.push(made)
            log.push(`create ${entry.comment} disabled=${entry.disabled}`)
            return { ...made }
        },
        updateEntry: async (id, patch) => {
            for (const list of entries.values()) { const f = list.find((e) => e.id === id); if (f) Object.assign(f, JSON.parse(JSON.stringify(patch))) }
            log.push(`update ${id} ${Object.keys(patch).sort().join(',')}`)
        },
        deleteEntry: async (id) => { for (const list of entries.values()) { const i = list.findIndex((e) => e.id === id); if (i >= 0) list.splice(i, 1) } log.push(`delete ${id}`) },
    }
    const entriesOf = (name: string) => entries.get(books.find((b) => b.name === name)!.id) ?? []
    return { store, entriesOf, books, log }
}

const INSIDE: UpdaterMessage[] = [
    { id: 'm1', role: 'user', text: 'We go down.' },
    { id: 'm2', role: 'assistant', text: 'The landing is dark. *(Location: Abbey Undercroft, Cellar Landing)*' },
    { id: 'm3', role: 'user', text: 'We attack the pack.' },
    { id: 'm4', role: 'assistant', text: 'Four of the six fall. *(Location: Abbey Undercroft, Crypt Passage)*' },
]
const OUTSIDE: UpdaterMessage[] = [...INSIDE, { id: 'm5', role: 'user', text: 'We climb out.' }, { id: 'm6', role: 'assistant', text: 'Daylight. *(Location: Abbey Road)*' }]

const THINNED = JSON.stringify({ operation_id: 'day5-pack-thinned', operations: [
    { op: 'SET_ASSET', evidence: 'CONFIRMED', asset_id: 'pack', count: 2, knowledge: 'KNOWN', detail: 'Two of the six remain.', cause: 'The party destroyed four on the passage.', actor: 'party' },
], chronicles: [{ area_id: 'crypt', text: 'Four of the crawling dead were destroyed; two remain.' }] })
const BAD = JSON.stringify({ operation_id: 'day5-nobody', operations: [{ op: 'SET_ASSET', asset_id: 'nobody', state: 'DEAD', cause: 'c' }] })

const SEED = () => ({ Vell_LOC: Object.values(LOCATION_BOOK), Vell_NPC: [{ comment: 'Ilyra', content: 'x' }] })

function harness(replies: string[] = [THINNED], over: Partial<MapUpdaterDeps> = {}, options: Partial<Awaited<ReturnType<MapUpdaterDeps['options']>>> = {}, seed: Record<string, Array<Partial<Entry>>> = SEED(), messages: UpdaterMessage[] = INSIDE) {
    const books = makeBooks(seed)
    const state = new MapStore(storage())
    const owned = Object.keys(seed)
    const calls: Array<Array<{ role: string; content: string }>> = []
    const events: string[] = []
    const refreshed: string[] = []
    let i = 0
    const deps: MapUpdaterDeps = {
        store: () => books.store as ReturnType<MapUpdaterDeps['store']>,
        generate: vi.fn(async (msgs) => { calls.push(msgs); const reply = replies[Math.min(i++, replies.length - 1)]!; if (reply.startsWith('throw:')) throw new Error(reply.slice(6)); return reply }),
        campaign: async () => ({ prefix: 'Vell', owned: [...owned] }),
        messages: async () => messages.map((m) => ({ ...m })),
        memo: async () => '[TIME]\nTime: 09:00 AM, Day 5\n[/TIME]\n[PARTY]\n- Teodor: 10/10 HP\n  Status: fine\n[/PARTY]',
        options: async () => ({ enabled: true, runEvery: 1, lookback: 4, systemPrompt: '', ...options }),
        enabled: async () => true,
        state,
        refresh: async (chatId) => { refreshed.push(chatId) },
        events: { started: (_c, _u, site, _at, trigger) => events.push(`started:${trigger}:${site}`), finished: (_c, _u, r) => events.push(`finished:${r.status}`) },
        log: { info: () => undefined, warn: () => undefined },
        now: () => new Date('2026-10-02T12:00:00Z'),
        ...over,
    }
    return { updater: createMapUpdater(deps), books, state, calls, events, refreshed, deps }
}

const root = (b: ReturnType<typeof makeBooks>) => b.entriesOf('Vell_LOC').find((e) => e.comment === 'Abbey Undercroft')!
const mapOf = (b: ReturnType<typeof makeBooks>) => parseMapDocument(extractMapSection(root(b).content), 'Abbey Undercroft').document

describe('the pass after a reply', () => {
    it('reads the story, shows the map, applies the transaction to the root entry, files the chronicle under the area, records the undo and the threads, and re-reads the maps', async () => {
        const { updater, books, calls, events, refreshed, state } = harness()
        const report = await updater.afterReply('c1', 'u1', 'm4')
        expect(report).toEqual({ status: 'applied', at: '2026-10-02T12:00:00.000Z', site: 'Abbey Undercroft', trigger: 'reply', summary: 'SET_ASSET pack', operations: 1, entryId: 'Vell_LOC::1' })
        expect(calls).toHaveLength(1)
        expect(calls[0]![0]!.content).toBe(DEFAULT_MAP_UPDATER_SYSTEM_PROMPT)
        const prompt = calls[0]![1]!.content
        expect(prompt.startsWith('UPDATE THE ATTACHED MAP\nExact site root: Abbey Undercroft\nKind: DUNGEON')).toBe(true)
        expect(prompt).toContain('## CURRENT LOCATION\nAbbey Undercroft, Crypt Passage')
        expect(prompt).toContain('- Teodor')
        expect(prompt).toContain('09:00 AM, Day 5')
        expect(prompt).toContain('pack | GROUP | Crawling Dead Pack')
        expect(prompt).toContain('Player: We go down.')
        expect(prompt).toContain('Narrator: Four of the six fall.')
        // The root entry: the map changed, the operation remembered, the entry kept out of the keyword scan.
        const entry = root(books)
        expect(mapOf(books).assets.find((a) => a.id === 'pack')).toMatchObject({ count: 2, knowledge: 'KNOWN', actor: 'party' })
        expect(mapOf(books).areas.find((a) => a.id === 'crypt')?.knowledge).toBe('VISITED')
        expect(entry.extensions?.[MAP_OPERATION_IDS_KEY]).toEqual([{ id: 'day5-pack-thinned', signature: expect.stringMatching(/^[0-9a-f]{8}$/) }])
        expect((entry as Entry).disabled).toBe(true)
        expect(entry.content.startsWith('[CORE]\nA crypt beneath the abbey.\n[/CORE]')).toBe(true)
        // The chronicle: a new child entry for the passage, stamped, enabled for the scan.
        const child = books.entriesOf('Vell_LOC').find((e) => e.comment === 'Abbey Undercroft :: Crypt Passage')!
        expect(child).toMatchObject({ key: ['Crypt Passage', 'Abbey Undercroft'], disabled: false })
        expect(child.content).toBe('[CORE]\nCrypt Passage is a location within Abbey Undercroft; its permanent details are established through play.\n[/CORE]\n[09:00 AM, Day 5] Four of the crawling dead were destroyed; two remain.')
        expect(refreshed).toEqual(['c1'])
        expect(events).toEqual(['started:reply:Abbey Undercroft', 'finished:applied'])
        const record = await state.load('c1', 'u1')
        expect(record.lastUpdater).toEqual(report)
        expect(record.updater).toEqual({ tick: 0, watermark: 4, lastSiteRoot: 'Abbey Undercroft', pendingExitRoot: '' })
        expect(record.updaterUndo).toMatchObject({ messageId: 'm4', bookName: 'Vell_LOC', created: [child.id], watermark: 0 })
        expect(record.updaterUndo?.restore[0]).toMatchObject({ id: entry.id, content: LOCATION_BOOK[1].content })
        expect(record.threadsBySite['abbey undercroft']).toHaveLength(1)
        expect((record.threadsBySite['abbey undercroft']![0] as { summary: string }).summary).toBe('SET_ASSET pack by party: The party destroyed four on the passage.')
    })

    it('appends a chronicle to the area\'s existing entry rather than making a second, and reads only since the last pass', async () => {
        const { updater, books, calls, state } = harness([JSON.stringify({ operation_id: 'day5-rest', operations: [{ op: 'SET_ASSET', asset_id: 'lantern', state: 'TAKEN', cause: 'Teodor took it.', actor: 'party' }], chronicles: [{ area_id: 'landing', text: 'Took the lantern.' }] })])
        await state.save('c1', { updater: { tick: 0, watermark: 2, lastSiteRoot: 'Abbey Undercroft', pendingExitRoot: '' } }, 'u1')
        await updater.afterReply('c1', 'u1', 'm4')
        expect(calls[0]![1]!.content).not.toContain('Player: We go down.')
        expect(calls[0]![1]!.content).toContain('Player: We attack the pack.')
        const landing = books.entriesOf('Vell_LOC').filter((e) => e.comment === 'Abbey Undercroft :: Cellar Landing')
        expect(landing).toHaveLength(1)
        expect(landing[0]!.content).toBe('The party rested here on Day 2.\n[09:00 AM, Day 5] Took the lantern.')
        expect((await state.load('c1', 'u1')).updaterUndo?.restore.map((r) => r.id)).toEqual([root(books).id, landing[0]!.id])
    })

    it('runs on the cadence, and at once when the party has stepped into a building the map has not furnished', async () => {
        const every2 = harness([THINNED], {}, { runEvery: 2 })
        expect(await every2.updater.afterReply('c1', 'u1', 'm2')).toBeNull()
        expect(every2.calls).toHaveLength(0)
        expect((await every2.state.load('c1', 'u1')).updater).toMatchObject({ tick: 1, lastSiteRoot: 'Abbey Undercroft' })
        expect((await every2.updater.afterReply('c1', 'u1', 'm4'))?.status).toBe('applied')
        expect((await every2.state.load('c1', 'u1')).updater.tick).toBe(0)
        const town = { Vell_LOC: [{ comment: 'Elmridge', content: `[MAP]\n${serializeMapDocument(TOWN)}\n[/MAP]` }] }
        const diner = harness([JSON.stringify({ operation_id: 'diner-first', operations: [
            { op: 'ADD_ASSET', evidence: 'CONFIRMED', name: 'Mab', kind: 'CREATURE', location: 'mabs-diner', state: 'ACTIVE', knowledge: 'KNOWN', detail: 'Behind the counter.', cause: 'Met on entry.' },
            { op: 'SET_ASSET', evidence: 'CONFIRMED', asset_id: 'mabs-diner', notEntered: false, cause: 'The party went in.' },
        ] })], {}, { runEvery: 5 }, town, [{ id: 'a', role: 'user', text: 'We go into the diner.' }, { id: 'b', role: 'assistant', text: 'A bell rings. *(Location: Elmridge, Main Street, Mab\'s Diner)*' }])
        const report = await diner.updater.afterReply('c1', 'u1', 'b')
        expect(report?.status).toBe('applied')
        expect(diner.calls[0]![1]!.content).toContain('## FIRST-ENTRY BUILDING POPULATION (MANDATORY THIS PASS)')
        const saved = parseMapDocument(extractMapSection(diner.books.entriesOf('Vell_LOC')[0]!.content), 'Elmridge').document
        expect(saved.assets.find((a) => a.id === 'mabs-diner')?.notEntered).toBe(false)
        expect(saved.assets.find((a) => a.name === 'Mab')?.location).toBe('mabs-diner')
    })

    it('honours a noop, corrects a rejected transaction twice with the previous output shown, and gives up with the problems named and nothing written', async () => {
        const quiet = harness(['{"noop":true}'])
        expect(await quiet.updater.afterReply('c1', 'u1', 'm4')).toMatchObject({ status: 'noop', site: 'Abbey Undercroft' })
        expect(root(quiet.books).content).toBe(LOCATION_BOOK[1].content)
        const after = await quiet.state.load('c1', 'u1')
        expect(after.updater.watermark).toBe(4)
        expect(after.updaterUndo).toBeUndefined()
        expect(quiet.events).toEqual(['started:reply:Abbey Undercroft', 'finished:noop'])
        const corrected = harness([BAD, 'not json', THINNED])
        expect((await corrected.updater.afterReply('c1', 'u1', 'm4'))?.status).toBe('applied')
        expect(corrected.calls).toHaveLength(3)
        expect(corrected.calls[1]![1]!.content.startsWith('CORRECTION PASS 1')).toBe(true)
        expect(corrected.calls[1]![1]!.content).toContain('ASSET_NOT_FOUND')
        expect(corrected.calls[1]![1]!.content).toContain(`PREVIOUS OUTPUT\n${BAD}`)
        expect(corrected.calls[2]![1]!.content.startsWith('CORRECTION PASS 2')).toBe(true)
        expect(corrected.calls[2]![1]!.content).toContain('INVALID_JSON')
        const stubborn = harness([BAD, BAD, BAD])
        const failed = await stubborn.updater.afterReply('c1', 'u1', 'm4')
        expect(failed).toMatchObject({ status: 'failed', reason: expect.stringContaining('ASSET_NOT_FOUND at map.operations[0].asset_id') })
        expect(stubborn.calls).toHaveLength(3)
        expect(root(stubborn.books).content).toBe(LOCATION_BOOK[1].content)
        expect(stubborn.refreshed).toEqual([])
        expect(stubborn.events).toEqual(['started:reply:Abbey Undercroft', 'finished:failed'])
        const broken = harness(['throw:refused'])
        expect(await broken.updater.afterReply('c1', 'u1', 'm4')).toMatchObject({ status: 'failed', reason: 'refused' })
    })

    it('reviews a site the party has left, once, before anything else, and does nothing while they stay outside', async () => {
        const { updater, calls, state, events } = harness(['{"noop":true}'], {}, {}, SEED(), OUTSIDE)
        await state.save('c1', { updater: { tick: 0, watermark: 4, lastSiteRoot: 'Abbey Undercroft', pendingExitRoot: '' } }, 'u1')
        const report = await updater.afterReply('c1', 'u1', 'm6')
        expect(report).toMatchObject({ status: 'noop', trigger: 'exit', site: 'Abbey Undercroft' })
        expect(calls).toHaveLength(1)
        expect(calls[0]![1]!.content).toContain('## SITE EXIT CLEANUP (MANDATORY REVIEW)\nDeparted mapped site: Abbey Undercroft\nPrevious footer location: Abbey Undercroft, Crypt Passage\nCurrent footer location: Abbey Road')
        expect(events).toEqual(['started:exit:Abbey Undercroft', 'finished:noop'])
        // The tick counts every reply, inside a site or not, as the legacy's does; only the pass itself resets it.
        expect((await state.load('c1', 'u1')).updater).toEqual({ tick: 1, watermark: 6, lastSiteRoot: '', pendingExitRoot: '' })
        expect(await updater.afterReply('c1', 'u1', 'm6')).toBeNull()
        expect(calls).toHaveLength(1)
    })

    it('skips while the mapping section or the updater is off, while another pass runs, and when the chat cannot be read', async () => {
        const off = harness([THINNED], { enabled: async () => false })
        expect(await off.updater.afterReply('c1', 'u1', 'm4')).toBeNull()
        expect((await off.state.load('c1', 'u1')).updater.tick).toBe(0)
        const disabled = harness([THINNED], {}, { enabled: false })
        expect(await disabled.updater.afterReply('c1', 'u1', 'm4')).toBeNull()
        expect(disabled.calls).toHaveLength(0)
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => { release = resolve })
        const busy = harness([], { generate: async () => { await gate; return '{"noop":true}' } })
        const first = busy.updater.afterReply('c1', 'u1', 'm4')
        await new Promise((r) => setTimeout(r, 0))
        expect(busy.updater.running('c1')).toBe(true)
        const second = await busy.updater.afterReply('c1', 'u1', 'm4')
        expect(second).toMatchObject({ status: 'skipped', reason: 'another map update is still running' })
        release()
        expect((await first)?.status).toBe('noop')
        const unreadable = harness([THINNED], { messages: async () => { throw new Error('PERMISSION_DENIED: chat_mutation') } })
        expect(await unreadable.updater.afterReply('c1', 'u1', 'm4')).toBeNull()
        expect(unreadable.calls).toHaveLength(0)
    })

    it('applies a transaction once: the same id again is already applied, the same id for a different change is a conflict', async () => {
        const { updater, books, calls } = harness([THINNED])
        expect((await updater.afterReply('c1', 'u1', 'm4'))?.status).toBe('applied')
        const writes = books.log.length
        expect((await updater.afterReply('c1', 'u1', 'm4'))?.status).toBe('applied')
        expect(books.log).toHaveLength(writes)
        expect(calls).toHaveLength(2)
        const conflict = harness([JSON.stringify({ operation_id: 'day5-pack-thinned', operations: [{ op: 'SET_ASSET', asset_id: 'lantern', state: 'TAKEN', cause: 'c', actor: 'party' }] })])
        const applied = root(books).extensions
        conflict.books.entriesOf('Vell_LOC')[0]!.extensions = JSON.parse(JSON.stringify(applied))
        const report = await conflict.updater.afterReply('c1', 'u1', 'm4')
        expect(report).toMatchObject({ status: 'failed', reason: expect.stringContaining('OPERATION_ID_CONFLICT') })
        expect(conflict.calls).toHaveLength(3)
        expect(conflict.calls[1]![1]!.content).toContain('OPERATION_ID_CONFLICT')
    })
})

describe('putting an update back after a swipe', () => {
    it('restores every entry the commit touched, deletes the one it made, moves the watermark back, says so at once, and ignores any other reply', async () => {
        const { updater, books, state, refreshed, events } = harness([THINNED])
        await updater.afterReply('c1', 'u1', 'm4')
        const before = books.entriesOf('Vell_LOC').length
        expect(await updater.rollBack('c1', 'u1', 'm9')).toBe(false)
        expect(await updater.rollBack('c1', 'u1', undefined)).toBe(false)
        expect(await updater.rollBack('c1', 'u1', 'm4')).toBe(true)
        expect(root(books).content).toBe(LOCATION_BOOK[1].content)
        expect(root(books).extensions).toEqual({})
        expect((root(books) as Entry).disabled).toBe(true)
        expect(books.entriesOf('Vell_LOC')).toHaveLength(before - 1)
        expect(books.entriesOf('Vell_LOC').some((e) => e.comment === 'Abbey Undercroft :: Crypt Passage')).toBe(false)
        const record = await state.load('c1', 'u1')
        expect(record.updaterUndo).toBeUndefined()
        expect(record.updater.watermark).toBe(0)
        expect(record.lastUpdater).toMatchObject({ status: 'undone', site: 'Abbey Undercroft', reason: 'the reply it followed was replaced' })
        expect(refreshed).toEqual(['c1', 'c1'])
        // The fold is told, as it is of a pass: live, the undo went unseen until the next reply made the fold reload.
        expect(events).toEqual(['started:reply:Abbey Undercroft', 'finished:applied', 'finished:undone'])
        expect(await updater.rollBack('c1', 'u1', 'm4')).toBe(false)
    })
})

describe('a pass from the panel', () => {
    it('runs now on the party\'s site with the given lookback, or with a direct instruction on the compact prompt', async () => {
        const { updater, calls, state } = harness([THINNED])
        await state.save('c1', { updater: { tick: 0, watermark: 4, lastSiteRoot: 'Abbey Undercroft', pendingExitRoot: '' } }, 'u1')
        const report = await updater.run({ chatId: 'c1', userId: 'u1', lookback: 1 })
        expect(report).toMatchObject({ status: 'applied', trigger: 'manual', site: 'Abbey Undercroft' })
        expect(calls[0]![1]!.content).not.toContain('Player: We go down.')
        expect(calls[0]![1]!.content).toContain('Player: We attack the pack.')
        expect(calls[0]![1]!.content.startsWith('UPDATE THE ATTACHED MAP')).toBe(true)
        const direct = harness([JSON.stringify({ operation_id: 'direct-open', operations: [{ op: 'SET_CONNECTION', from: 'landing', to: 'vault', state: 'OPEN', cause: 'The user opened it.' }] })])
        const opened = await direct.updater.run({ chatId: 'c1', userId: 'u1', instruction: 'Open the glyph door to the vault.' })
        expect(opened).toMatchObject({ status: 'applied', summary: 'SET_CONNECTION landing → vault' })
        expect(direct.calls[0]![0]!.content).toBe(DEFAULT_MAP_UPDATER_DIRECT_SYSTEM_PROMPT)
        expect(direct.calls[0]![1]!.content.startsWith('DIRECT MAP COMMAND\n\n## DIRECT INSTRUCTION (AUTHORITATIVE SCOPE)\nOpen the glyph door to the vault.')).toBe(true)
        expect(mapOf(direct.books).areas.find((a) => a.id === 'landing')?.connections.find((c) => c.to === 'vault')?.state).toBe('OPEN')
        expect((await direct.state.load('c1', 'u1')).updaterUndo).toBeUndefined()
    })

    it('inspects a named site the party is not in, and says why it cannot run otherwise', async () => {
        const { updater, calls } = harness(['{"noop":true}'])
        const report = await updater.run({ chatId: 'c1', userId: 'u1', siteRoot: 'morrowfen' })
        expect(report).toMatchObject({ status: 'noop', site: 'Morrowfen', trigger: 'manual' })
        expect(calls[0]![1]!.content).toContain('## INSPECTOR TARGET SITE\nMorrowfen\nThis manual pass targets this exact site from Map Details. The party is likely elsewhere')
        expect(await updater.run({ chatId: 'c1', userId: 'u1', siteRoot: 'Nowhere' })).toMatchObject({ status: 'skipped', reason: 'no map is attached to "Nowhere"' })
        const outside = harness(['{"noop":true}'], {}, {}, SEED(), OUTSIDE)
        expect(await outside.updater.run({ chatId: 'c1', userId: 'u1' })).toMatchObject({ status: 'skipped', reason: 'the party is not inside a mapped site' })
        const off = harness([], { enabled: async () => false })
        expect(await off.updater.run({ chatId: 'c1', userId: 'u1' })).toMatchObject({ status: 'skipped', reason: 'the rulebook’s mapping section is off' })
        expect(off.events).toEqual(['finished:skipped'])
    })
})

describe('the terminal’s steps (71b)', () => {
    it('announces the pass, the site, the model call, the operations and the end', async () => {
        const steps: Array<[string, string]> = []
        const { updater, state } = harness([THINNED], { steps: () => (type, content) => { steps.push([type, content]) } })
        await state.save('c1', { updater: { tick: 0, watermark: 4, lastSiteRoot: 'Abbey Undercroft', pendingExitRoot: '' } }, 'u1')
        await updater.run({ chatId: 'c1', userId: 'u1', lookback: 1 })
        expect(steps.map((s) => s[0])).toEqual(['start', 'thought', 'thought', 'result', 'finish'])
        expect(steps[0]![1]).toBe('Initializing Map Updater…')
        expect(steps[1]![1]).toContain('Site: Abbey Undercroft')
        expect(steps[2]![1]).toBe('Requesting occupancy update…')
        expect(steps[4]![1]).toMatch(/^Applied \d+ operations? to Abbey Undercroft\.$/)
        const quiet = harness(['{"noop":true}'], { steps: () => (type, content) => { steps.push([type, content]) } })
        steps.length = 0
        await quiet.updater.run({ chatId: 'c1', userId: 'u1', siteRoot: 'morrowfen' })
        expect(steps.at(-1)).toEqual(['finish', 'Noop — no durable map fact changed at Morrowfen.'])
        const broken = harness(['throw:refused'], { steps: () => (type, content) => { steps.push([type, content]) } })
        steps.length = 0
        await broken.updater.run({ chatId: 'c1', userId: 'u1', siteRoot: 'morrowfen' })
        expect(steps.at(-1)).toEqual(['error', 'refused'])
    })
})
