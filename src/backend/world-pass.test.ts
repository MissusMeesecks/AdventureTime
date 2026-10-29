import { describe, expect, it, vi } from 'vitest'

import { FACTORY_CARTRIDGE_DEFAULTS } from '../state/factory-defaults.js'
import { WORLD_REPORT_METADATA_KEY } from '../tracker/world.js'
import type { MemoStorage } from './memo-store.js'
import { createWorldProgression, type WorldBookStore, type WorldEntry, type WorldOptions, type WorldPassDeps } from './world-pass.js'
import { WorldStore } from './world-store.js'

const PROMPT = (FACTORY_CARTRIDGE_DEFAULTS as { worldProgressionSystemPrompt: string }).worldProgressionSystemPrompt

function storage(): MemoStorage {
    const files = new Map<string, unknown>()
    return {
        async getJson<T>(path: string, options?: { fallback?: T }): Promise<T> {
            return (files.has(path) ? files.get(path) : options?.fallback) as T
        },
        async setJson(path: string, value: unknown): Promise<void> {
            files.set(path, JSON.parse(JSON.stringify(value)))
        },
    }
}

function makeBooks(seed: Record<string, Array<Partial<WorldEntry>>> = {}, mint: 'numbers' | 'slugs' = 'numbers') {
    const books: Array<{ id: string; name: string }> = []
    const entries = new Map<string, Array<WorldEntry & { disabled?: boolean }>>()
    let n = 1
    // The host's clock, for `created_at`: strictly increasing, as a host's is.
    let tick = 1_700_000_000_000
    const log: string[] = []
    for (const [name, list] of Object.entries(seed)) {
        const book = { id: `b${books.length + 1}`, name }
        books.push(book)
        entries.set(book.id, list.map((e, i) => ({ id: `e${n++}`, uid: e.uid ?? String(i + 1), key: e.key ?? [], content: e.content ?? '', comment: e.comment ?? '', extensions: e.extensions ?? {}, ...(e.createdAt !== undefined ? { createdAt: e.createdAt } : {}) })))
    }
    const store: WorldBookStore = {
        listBooks: async () => books.map((b) => ({ ...b })),
        createBook: async (name) => {
            const book = { id: `b${books.length + 1}`, name }
            books.push(book)
            entries.set(book.id, [])
            log.push(`create book ${name}`)
            return { ...book }
        },
        listEntries: async (id) => (entries.get(id) ?? []).map((e) => ({ ...e })),
        createEntry: async (id, entry) => {
            const list = entries.get(id)!
            const uids = list.map((e) => Number(e.uid))
            // Spindle mints slug uids from the comment, nothing like a counter (lesson 40).
            const uid = mint === 'slugs' ? entry.comment.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `e${n}` : String(uids.length ? Math.max(...uids) + 1 : 1)
            const made = { id: `e${n++}`, uid, key: entry.key, comment: entry.comment, content: entry.content, extensions: entry.extensions ?? {}, disabled: entry.disabled, createdAt: tick++ }
            list.push(made)
            log.push(`create entry ${entry.comment} disabled=${entry.disabled}`)
            return { ...made }
        },
        updateEntry: async (id, patch) => {
            for (const list of entries.values()) {
                const found = list.find((e) => e.id === id)
                if (found) Object.assign(found, patch)
            }
            log.push(`update ${id}`)
        },
        deleteEntry: async (id) => {
            for (const [bookId, list] of entries) entries.set(bookId, list.filter((e) => e.id !== id))
            log.push(`delete ${id}`)
        },
    }
    const entriesOf = (name: string) => entries.get(books.find((b) => b.name === name)!.id) ?? []
    return { store, entriesOf, books, log }
}

const LORE = {
    Vell_LOC: [
        { comment: 'Morrowfen', key: ['morrowfen'], content: 'A tidal trade town.\n[MAP]\n{"secret":1}\n[/MAP]' },
        { comment: 'Glassmere', key: ['glassmere'], content: 'A lake settlement.' },
        { comment: 'Old Barrow', key: ['barrow'], content: 'A burial hill.' },
    ],
    Vell_NPC: [{ comment: 'Captain Ilyra', key: ['ilyra'], content: 'Commands the Morrowfen watch.' }],
    Vell_FAC: [{ comment: 'Salt Compact', key: ['salt'], content: 'Controls Morrowfen shipping.' }],
    // Another campaign's book, and one that mentions a place of ours: only the
    // ownership filter keeps it out of Morrowfen's dossier.
    Other_LOC: [{ comment: 'Elsewhere', key: ['elsewhere'], content: 'A rival port, far from Morrowfen.' }],
}

function options(over: Partial<WorldOptions> = {}): WorldOptions {
    return {
        enabled: true,
        prefix: 'Vell',
        intervalHours: 24,
        keepActive: 1,
        lookback: 2,
        historyLookback: 0,
        locationsPerReport: 2,
        locationRandomize: false,
        exclusionList: '',
        consolidateEnabled: false,
        consolidateInterval: 7,
        systemPrompt: PROMPT,
        clock: {},
        ...over,
        skeleton: { factions: 4, locations: 4, conflicts: 3, systemPrompt: '', useLorebooks: false, lorebookOnly: false, lorebookFilter: [], useExisting: true, sourceLookback: 30, ...(over.skeleton ?? {}) },
    }
}

const REPORT = '## Glassmere\nReed prices fall.\n\n## Morrowfen\nThe docks grumble.\n\n## Wider Currents\nA cold wind.'

function harness(replies: string[] = [REPORT], over: Partial<WorldPassDeps> = {}, seed = LORE, opts: Partial<WorldOptions> = {}, mint: 'numbers' | 'slugs' = 'numbers') {
    const books = makeBooks(seed, mint)
    const state = new WorldStore(storage())
    const owned: string[] = Object.keys(seed).filter((n) => n.startsWith('Vell_'))
    const made: string[] = []
    const calls: Array<Array<{ role: string; content: string }>> = []
    let i = 0
    const events: string[] = []
    let memo = '[TIME]\nCurrent: 09:00 AM, Day 5\n[/TIME]'
    const deps: WorldPassDeps = {
        store: () => books.store,
        generate: vi.fn(async (messages) => {
            calls.push(messages)
            const reply = replies[Math.min(i++, replies.length - 1)]!
            if (reply.startsWith('throw:')) throw new Error(reply.slice(6))
            return reply
        }),
        memo: async () => memo,
        narrative: async (_c, _u, lookback) => ['The gates close.', 'Rain falls.', 'A rider arrives.'].slice(-lookback),
        history: async (_c, _u, lookback) => ['User: We ride for the coast.', 'GM: The gates close behind you.', 'User: Robin checks the map.', 'GM: Rain falls on the barrow road.'].slice(-lookback),
        options: async () => options(opts),
        ownership: { get: async () => [...owned], made: async (_c, names) => { made.push(...names); for (const name of names) if (!owned.includes(name)) owned.push(name) } },
        state,
        events: { started: (_c, _u, _at, trigger) => events.push(`started:${trigger}`), finished: (_c, _u, r) => events.push(`finished:${r.status}`) },
        log: { info: () => undefined, warn: () => undefined },
        now: () => new Date('2026-10-01T12:00:00Z'),
        ...over,
    }
    const world = createWorldProgression(deps)
    return { world, books, state, owned, made, calls, events, setMemo: (m: string) => { memo = m }, deps }
}

describe('a report, end to end', () => {
    it('writes the report into a _World book it creates, disabled, with its keys and routing metadata', async () => {
        const { world, books, owned, calls, events, state } = harness()
        const report = await world.run({ chatId: 'c1', userId: 'u1', trigger: 'manual' })
        expect(report).toMatchObject({ status: 'written', trigger: 'manual', periodLabel: 'Day 5, 09:00 AM', selectedLocations: ['Glassmere', 'Morrowfen'] })
        expect(books.books.map((b) => b.name)).toContain('Vell_World')
        expect(owned).toContain('Vell_World')
        const [entry] = books.entriesOf('Vell_World')
        expect(entry).toMatchObject({ comment: 'Day 5, 09:00 AM', content: REPORT, disabled: true, key: ['world progression', 'world report', 'day 5, 09:00 am', 'day 5'] })
        expect(entry!.extensions?.[WORLD_REPORT_METADATA_KEY]).toEqual({ reportId: 'Vell_World::1', periodLabel: 'Day 5, 09:00 AM', selectedLocations: ['Glassmere', 'Morrowfen'] })
        // The prompts: the period in the system prompt, the dossiers and the narrative in the user prompt, no map, no other campaign.
        const [system, user] = calls[0]!
        expect(system!.content).toContain('**Day 5, 09:00 AM**')
        expect(system!.content).toContain('LOCATION-CENTRIC RUNTIME CONTRACT')
        expect(user!.content).toContain('- Glassmere\n- Morrowfen')
        expect(user!.content).toContain('Captain Ilyra')
        expect(user!.content).toContain('Salt Compact')
        expect(user!.content).not.toContain('secret')
        expect(user!.content).not.toContain('Elsewhere')
        expect(user!.content).toContain('Rain falls.\n\nA rider arrives.')
        expect(user!.content).not.toContain('The gates close.')
        expect(user!.content).toContain('No prior World Progression reports.')
        // The clock, the watermarks and the window, in the record.
        const record = await state.load('c1', 'u1')
        expect(record.lastFiredPeriodLabel).toBe('Day 5, 09:00 AM')
        expect(record.locationLastAdvanced).toEqual({ glassmere: 'Day 5, 09:00 AM', morrowfen: 'Day 5, 09:00 AM' })
        expect(record.activeReports).toEqual([{ id: entry!.id, reportId: 'Vell_World::1', label: 'Day 5, 09:00 AM', content: REPORT }])
        expect(record.lastRun?.status).toBe('written')
        expect(events).toEqual(['started:manual', 'finished:written'])
    })

    it('rotates to the locations advanced longest ago, and dates each report at the clock (45c-ter)', async () => {
        const { world, state, calls, setMemo } = harness([REPORT, REPORT])
        await world.run({ chatId: 'c1', userId: 'u1', trigger: 'manual' })
        expect((await state.load('c1', 'u1')).locationLastAdvanced).not.toHaveProperty('old barrow')
        // A second press with the clock unmoved is the same period: already filed.
        expect((await world.run({ chatId: 'c1', userId: 'u1', trigger: 'manual' })).status).toBe('duplicate')
        setMemo('[TIME]\nCurrent: 02:10 PM, Day 5\n[/TIME]')
        const second = await world.run({ chatId: 'c1', userId: 'u1', trigger: 'manual' })
        // The clock's time, not the period after the last (which would be Day 6, 09:00 AM).
        expect(second.periodLabel).toBe('Day 5, 02:10 PM')
        expect(second.selectedLocations![0]).toBe('Old Barrow')
        // The first report is now history, and the window shows the newest only.
        expect(calls[1]![1]!.content).toContain('### Day 5, 09:00 AM\n## Glassmere')
        const record = await state.load('c1', 'u1')
        expect(record.activeReports.map((r) => r.label)).toEqual(['Day 5, 02:10 PM'])
    })

    it('keeps a wider window when asked, and includes extra instructions for one run only', async () => {
        const { world, state, calls, setMemo } = harness([REPORT, REPORT], {}, LORE, { keepActive: 2 })
        await world.run({ chatId: 'c1', userId: 'u1', trigger: 'manual', extraInstructions: ' storms everywhere ' })
        expect(calls[0]![0]!.content).toContain('## EXTRA INSTRUCTIONS FOR THIS RUN\nstorms everywhere')
        setMemo('[TIME]\nCurrent: 09:00 AM, Day 6\n[/TIME]')
        await world.run({ chatId: 'c1', userId: 'u1', trigger: 'manual' })
        expect(calls[1]![0]!.content).not.toContain('EXTRA INSTRUCTIONS')
        expect((await state.load('c1', 'u1')).activeReports.map((r) => r.label)).toEqual(['Day 5, 09:00 AM', 'Day 6, 09:00 AM'])
    })

    it('never files the same period twice: a duplicate advances the clock and reads the filed metadata', async () => {
        const seed = {
            ...LORE,
            Vell_World: [{ uid: '4', comment: 'Day 5, 09:00 AM', content: 'already', extensions: { [WORLD_REPORT_METADATA_KEY]: { reportId: 'Vell_World::4', periodLabel: 'Day 5, 09:00 AM', selectedLocations: ['Glassmere'] } } }],
        }
        const { world, books, state, deps } = harness([REPORT], {}, seed)
        const report = await world.run({ chatId: 'c1', userId: 'u1', trigger: 'automatic' })
        expect(report).toMatchObject({ status: 'duplicate', periodLabel: 'Day 5, 09:00 AM', selectedLocations: ['Glassmere'] })
        expect(deps.generate).not.toHaveBeenCalled()
        expect(books.entriesOf('Vell_World')).toHaveLength(1)
        const record = await state.load('c1', 'u1')
        expect(record.lastFiredPeriodLabel).toBe('Day 5, 09:00 AM')
        expect(record.locationLastAdvanced).toEqual({ glassmere: 'Day 5, 09:00 AM' })
    })

    it('consolidates the oldest raw reports first when they have piled up, then writes on the compressed history', async () => {
        const seed = {
            ...LORE,
            Vell_World: [1, 2, 3].map((d) => ({ uid: String(d), comment: `Day ${d}, 09:00 AM`, content: `report ${d}` })),
        }
        const { world, books, calls } = harness(['[Days 1–2] merged', REPORT], {}, seed, { consolidateEnabled: true, consolidateInterval: 2 })
        const report = await world.run({ chatId: 'c1', userId: 'u1', trigger: 'manual' })
        expect(report).toMatchObject({ status: 'written', consolidated: 'Days 1–2' })
        expect(calls[0]![0]!.content).toContain('You are the World Archivist')
        expect(calls[0]![1]!.content).toContain('### Day 1, 09:00 AM\nreport 1')
        const labels = books.entriesOf('Vell_World').map((e) => e.comment)
        expect(labels).toEqual(['Day 3, 09:00 AM', 'Days 1–2', 'Day 5, 09:00 AM'])
        // The new report read the compressed archive, not the three raw ones.
        expect(calls[1]![1]!.content).toContain('### Days 1–2\n[Days 1–2] merged')
        expect(calls[1]![1]!.content).not.toContain('report 1')
    })

    it('carries on without consolidation when that call fails', async () => {
        const seed = { ...LORE, Vell_World: [1, 2].map((d) => ({ uid: String(d), comment: `Day ${d}, 09:00 AM`, content: `report ${d}` })) }
        const { world, books } = harness(['throw:no archivist', REPORT], {}, seed, { consolidateEnabled: true, consolidateInterval: 2 })
        const report = await world.run({ chatId: 'c1', userId: 'u1', trigger: 'manual' })
        expect(report.status).toBe('written')
        expect(report.consolidated).toBeUndefined()
        expect(books.entriesOf('Vell_World')).toHaveLength(3)
    })

    it('fails plainly without a clock, on an empty reply, on a model error, and leaves the books alone', async () => {
        const noClock = harness()
        noClock.setMemo('[PARTY]\n- Robin\n[/PARTY]')
        expect(await noClock.world.run({ chatId: 'c1', userId: 'u1', trigger: 'manual' })).toMatchObject({ status: 'failed', reason: expect.stringContaining('[TIME]') })
        const empty = harness(['   '])
        expect(await empty.world.run({ chatId: 'c1', userId: 'u1', trigger: 'manual' })).toMatchObject({ status: 'failed', reason: 'The model returned nothing.' })
        const broken = harness(['throw:refused'])
        const report = await broken.world.run({ chatId: 'c1', userId: 'u1', trigger: 'manual' })
        expect(report).toMatchObject({ status: 'failed', reason: 'The model call failed: refused' })
        expect(broken.books.books.map((b) => b.name)).not.toContain('Vell_World')
        expect((await broken.state.load('c1', 'u1')).lastFiredPeriodLabel).toBe('')
        expect(broken.events).toEqual(['started:manual', 'finished:failed'])
    })

    it('writes nothing for a campaign with no name', async () => {
        const { world, deps } = harness([REPORT], {}, LORE, { prefix: '' })
        expect(await world.run({ chatId: 'c1', userId: 'u1', trigger: 'manual' })).toMatchObject({ status: 'failed', reason: expect.stringContaining('no name') })
        expect(deps.generate).not.toHaveBeenCalled()
    })
})

describe('after a reply', () => {
    it('does nothing while switched off, even with a report overdue', async () => {
        const { world, deps, state } = harness([REPORT], {}, LORE, { enabled: false })
        await state.save('c1', { lastFiredPeriodLabel: 'Day 1, 09:00 AM' }, 'u1')
        expect(await world.maybeRun('c1', 'u1')).toBeNull()
        expect(deps.generate).not.toHaveBeenCalled()
        expect((await state.load('c1', 'u1')).lastFiredPeriodLabel).toBe('Day 1, 09:00 AM')
    })

    it('reports a stop as a stop, not a failure', async () => {
        const controller = new AbortController()
        const { world, books } = harness([], {
            generate: async () => { controller.abort(); throw new Error('aborted') },
        })
        const report = await world.run({ chatId: 'c1', userId: 'u1', trigger: 'manual', signal: controller.signal })
        expect(report).toMatchObject({ status: 'cancelled', reason: 'Stopped.' })
        expect(books.books.map((b) => b.name)).not.toContain('Vell_World')
    })

    it('starts the clock on the first sighting, waits inside the interval, then runs once it has elapsed', async () => {
        const { world, state, deps, setMemo } = harness()
        expect(await world.maybeRun('c1', 'u1')).toBeNull()
        expect((await state.load('c1', 'u1')).lastFiredPeriodLabel).toBe('Day 5, 09:00 AM')
        setMemo('[TIME]\nCurrent: 08:59 AM, Day 6\n[/TIME]')
        expect(await world.maybeRun('c1', 'u1')).toBeNull()
        expect(deps.generate).not.toHaveBeenCalled()
        setMemo('[TIME]\nCurrent: 11:00 PM, Day 6\n[/TIME]')
        const report = await world.maybeRun('c1', 'u1')
        // Dated at the clock, not at the period the schedule reached (Day 6, 09:00 AM): a
        // skip of hours files one report for now, and the next is due an interval on.
        expect(report).toMatchObject({ status: 'written', trigger: 'automatic', periodLabel: 'Day 6, 11:00 PM' })
        // And not again for the same period.
        expect(await world.maybeRun('c1', 'u1')).toBeNull()
    })

    it('does nothing without a readable clock', async () => {
        const noClock = harness()
        noClock.setMemo('')
        expect(await noClock.world.maybeRun('c1', 'u1')).toBeNull()
        expect((await noClock.state.load('c1', 'u1')).lastFiredPeriodLabel).toBe('')
    })
})

describe('what the panel is told', () => {
    it('reports the switch, the clock, the next due time, the window and the last pass', async () => {
        const { world } = harness()
        const before = await world.status('c1', 'u1')
        expect(before).toMatchObject({ enabled: true, intervalHours: 24, locationsPerReport: 2, keepActive: 1, lookback: 2, prefix: 'Vell', worldBookName: 'Vell_World', lastFiredPeriodLabel: '', currentTimeLabel: 'Day 5, 09:00 AM', nextDueLabel: 'Day 6, 09:00 AM', activeReports: [] })
        expect(before.lastRun).toBeUndefined()
        await world.run({ chatId: 'c1', userId: 'u1', trigger: 'manual' })
        const after = await world.status('c1', 'u1')
        expect(after.lastFiredPeriodLabel).toBe('Day 5, 09:00 AM')
        expect(after.nextDueLabel).toBe('Day 6, 09:00 AM')
        expect(after.activeReports).toEqual([{ label: 'Day 5, 09:00 AM', reportId: 'Vell_World::1' }])
        expect(after.lastRun?.status).toBe('written')
    })

    it('resets the timeline so the next report starts from the current time, keeping the window', async () => {
        const { world, state } = harness()
        await world.run({ chatId: 'c1', userId: 'u1', trigger: 'manual' })
        await world.resetTimeline('c1', 'u1')
        const record = await state.load('c1', 'u1')
        expect(record.lastFiredPeriodLabel).toBe('')
        expect(record.activeReports).toHaveLength(1)
        expect((await world.status('c1', 'u1')).nextDueLabel).toBe('Day 6, 09:00 AM')
    })
})

describe('the skeleton (33b)', () => {
    const SKELETON = '## FACTIONS\n### The Salt Compact\nControls shipping.\n## LOCATIONS\n### Harrowgate\nA cliff town.\n### Glassmere\nA lake settlement.\n## CONFLICTS\n### The Tithe War\nTwo guilds dispute the quay.'

    it('writes the premises into a _Skeleton book it creates and owns, keyless and disabled, and keeps the source', async () => {
        const { world, books, owned, calls, state } = harness([SKELETON])
        const report = await world.skeleton({ chatId: 'c1', userId: 'u1', source: '  A drowned coast.  ', mode: 'replace' })
        expect(report).toMatchObject({ status: 'written', mode: 'replace', count: 4, factions: 1, locations: 2, conflicts: 1 })
        expect(books.books.map((b) => b.name)).toContain('Vell_Skeleton')
        expect(owned).toContain('Vell_Skeleton')
        expect(books.entriesOf('Vell_Skeleton').map((e) => ({ comment: e.comment, content: e.content, key: e.key, disabled: e.disabled, extensions: e.extensions }))).toEqual([
            { comment: 'FACTION: The Salt Compact', content: '[Day 0 Baseline]\nControls shipping.', key: [], disabled: true, extensions: { rpgCategory: 'FAC', rpgSkeleton: true } },
            { comment: 'LOCATION: Harrowgate', content: '[Day 0 Baseline]\nA cliff town.', key: [], disabled: true, extensions: { rpgCategory: 'LOC', rpgSkeleton: true } },
            { comment: 'LOCATION: Glassmere', content: '[Day 0 Baseline]\nA lake settlement.', key: [], disabled: true, extensions: { rpgCategory: 'LOC', rpgSkeleton: true } },
            { comment: 'CONFLICT: The Tithe War', content: '[Day 0 Baseline]\nTwo guilds dispute the quay.', key: [], disabled: true, extensions: { rpgCategory: 'EVENT', rpgSkeleton: true } },
        ])
        // The prompts: the stock architect with the counts, the contract, and the trimmed source.
        const [system, user] = calls[0]!
        expect(system!.content).toContain('Generate exactly 4 factions, 4 locations, and 3 conflicts.')
        expect(system!.content).toContain('## MACRO-ONLY SKELETON CONTRACT (AUTHORITATIVE)')
        expect(system!.content).not.toContain('LOREBOOK-ONLY')
        expect(user!.content).toBe('## SKELETON SOURCE\nA drowned coast.\n\nGenerate the world skeleton  now.')
        const record = await state.load('c1', 'u1')
        expect(record.skeletonSource).toBe('A drowned coast.')
        expect(record.lastSkeleton?.status).toBe('written')
        const status = await world.status('c1', 'u1')
        expect(status).toMatchObject({ skeletonBookName: 'Vell_Skeleton', skeletonCounts: { factions: 1, locations: 2, conflicts: 1 }, skeletonSource: 'A drowned coast.', skeleton: { factions: 4, lorebookFilter: '' } })
        expect(status.lastSkeleton?.count).toBe(4)
    })

    it('seeds the next report: a skeleton location with no lore of its own is a subject, its factions are context', async () => {
        const { world, calls } = harness([SKELETON, REPORT], {}, LORE, { locationsPerReport: 4 })
        await world.skeleton({ chatId: 'c1', userId: 'u1', source: 'A coast.', mode: 'replace' })
        const report = await world.run({ chatId: 'c1', userId: 'u1', trigger: 'manual' })
        expect(report.selectedLocations).toContain('Harrowgate')
        // Glassmere's seed is superseded by the real entry: one subject, not two.
        expect(report.selectedLocations!.filter((n) => n === 'Glassmere')).toHaveLength(1)
        const user = calls[1]![1]!.content
        expect(user).toContain('- Harrowgate\n')
        expect(user).toContain('# Harrowgate\n')
        expect(user).toContain('A cliff town.')
        expect(user).not.toContain('LOCATION: Harrowgate')
        // The conflict seed is wider context; the faction seed is superseded by
        // the real Salt Compact entry, which is shown instead.
        expect(user).toContain('The Tithe War')
        expect(user).toContain('Controls Morrowfen shipping.')
        expect(user).not.toContain('Controls shipping.')
        expect(user).not.toContain('[Day 0 Baseline]\nA lake settlement.')
    })

    it('replaces what is there, or adds to it with the filed premises shown to the model', async () => {
        const { world, books, calls } = harness([SKELETON, '## LOCATIONS\n### Old Barrow\nA burial hill.', '## FACTIONS\n### Sun Court\nA rival.'])
        await world.skeleton({ chatId: 'c1', userId: 'u1', source: 'A coast.', mode: 'replace' })
        const added = await world.skeleton({ chatId: 'c1', userId: 'u1', source: '', mode: 'append' })
        expect(added).toMatchObject({ status: 'written', mode: 'append', count: 1, locations: 1 })
        expect(books.entriesOf('Vell_Skeleton').map((e) => e.comment)).toEqual(['FACTION: The Salt Compact', 'LOCATION: Harrowgate', 'LOCATION: Glassmere', 'CONFLICT: The Tithe War', 'LOCATION: Old Barrow'])
        const user = calls[1]![1]!.content
        expect(user).toContain('(No written Skeleton Source provided')
        expect(user).toContain('## EXISTING SKELETON PREMISES\nAvoid duplicating these')
        expect(user).toContain('### LOCATION: Harrowgate\nA cliff town.')
        expect(user).not.toContain('[Day 0 Baseline]')
        expect(user.endsWith('Generate additional world skeleton premises now.')).toBe(true)
        // A fresh generation empties the book first; the ids move on.
        const replaced = await world.skeleton({ chatId: 'c1', userId: 'u1', source: 'Again.', mode: 'replace' })
        expect(replaced).toMatchObject({ status: 'written', count: 1, factions: 1 })
        expect(books.entriesOf('Vell_Skeleton').map((e) => e.comment)).toEqual(['FACTION: Sun Court'])
        expect(books.log.filter((l) => l.startsWith('delete'))).toHaveLength(5)
    })

    it('feeds the campaign\'s own books in as canon when asked, never another campaign\'s nor its own reports, or only the ones named', async () => {
        const seed = { ...LORE, Vell_World: [{ comment: 'Day 2', content: 'A report, not canon.' }], Vell_Skeleton: [{ comment: 'LOCATION: Seed', content: '[Day 0 Baseline]\nOld.', extensions: { rpgCategory: 'LOC' } }], 'Shared Canon': [{ comment: 'The Gods', content: 'Three of them.' }] }
        const own = harness([SKELETON], {}, seed, { skeleton: { useLorebooks: true } as never })
        await own.world.skeleton({ chatId: 'c1', userId: 'u1', source: 'x', mode: 'replace' })
        const user = own.calls[0]![1]!.content
        expect(user).toContain('## EXISTING LOREBOOK SOURCE MATERIAL')
        expect(user).toContain('### LOREBOOK: Vell_LOC')
        expect(user).toContain('### LOREBOOK: Vell_FAC')
        expect(user).not.toContain('Other_LOC')
        expect(user).not.toContain('Shared Canon')
        expect(user).not.toContain('A report, not canon.')
        expect(user).not.toContain('Old.')
        expect(user).toContain('create compatible additions')

        const named = harness([SKELETON], {}, seed, { skeleton: { useLorebooks: true, lorebookFilter: ['shared canon', 'Nowhere'] } as never })
        await named.world.skeleton({ chatId: 'c1', userId: 'u1', source: 'x', mode: 'replace' })
        const picked = named.calls[0]![1]!.content
        expect(picked).toContain('### LOREBOOK: Shared Canon\n#### The Gods\nThree of them.')
        expect(picked).not.toContain('Vell_LOC')

        // Lorebook-only: the override goes on the system prompt, and with nothing to read it fails rather than inventing.
        const literal = harness([SKELETON], {}, seed, { skeleton: { useLorebooks: true, lorebookOnly: true, lorebookFilter: ['Shared Canon'] } as never })
        await literal.world.skeleton({ chatId: 'c1', userId: 'u1', source: '', mode: 'replace' })
        expect(literal.calls[0]![0]!.content).toContain('## LOREBOOK-ONLY MODE')
        expect(literal.calls[0]![1]!.content).toContain('Do not invent, infer, or extrapolate')
        const starved = harness([SKELETON], {}, LORE, { skeleton: { useLorebooks: true, lorebookOnly: true, lorebookFilter: ['Nowhere'] } as never })
        expect(await starved.world.skeleton({ chatId: 'c1', userId: 'u1', source: 'x', mode: 'replace' })).toMatchObject({ status: 'failed', reason: expect.stringContaining('no usable entries') })
        expect(starved.deps.generate).not.toHaveBeenCalled()
    })

    it('uses the user\'s own architect prompt when there is one', async () => {
        const { world, calls } = harness([SKELETON], {}, LORE, { skeleton: { systemPrompt: 'Draw {locationCount} places.', locations: 7 } as never })
        await world.skeleton({ chatId: 'c1', userId: 'u1', source: 'x', mode: 'replace' })
        expect(calls[0]![0]!.content.startsWith('Draw 7 places.\n\n## MACRO-ONLY SKELETON CONTRACT')).toBe(true)
    })

    it('fails plainly with nothing to work from, on an empty or unparseable reply, on a model error, on a stop, and leaves the book alone', async () => {
        const bare = harness([SKELETON])
        expect(await bare.world.skeleton({ chatId: 'c1', userId: 'u1', source: '   ', mode: 'replace' })).toMatchObject({ status: 'failed', reason: expect.stringContaining('Nothing to work from') })
        expect(bare.deps.generate).not.toHaveBeenCalled()
        expect(await harness(['  ']).world.skeleton({ chatId: 'c1', userId: 'u1', source: 'x', mode: 'replace' })).toMatchObject({ status: 'failed', reason: 'The model returned nothing.' })
        expect(await harness(['Here is some prose about a coast with no sections.']).world.skeleton({ chatId: 'c1', userId: 'u1', source: 'x', mode: 'replace' })).toMatchObject({ status: 'failed', reason: expect.stringContaining('no premises in it (it began: "Here is some prose') })
        const broken = harness(['throw:refused'])
        expect(await broken.world.skeleton({ chatId: 'c1', userId: 'u1', source: 'x', mode: 'replace' })).toMatchObject({ status: 'failed', reason: 'The model call failed: refused' })
        expect(broken.books.books.map((b) => b.name)).not.toContain('Vell_Skeleton')
        const controller = new AbortController()
        const stopped = harness(['throw:aborted'], { generate: async (_m, _c, _u, signal) => { controller.abort(); if (signal?.aborted) throw new Error('aborted'); return '' } })
        expect(await stopped.world.skeleton({ chatId: 'c1', userId: 'u1', source: 'x', mode: 'replace', signal: controller.signal })).toMatchObject({ status: 'cancelled' })
        const nameless = harness([SKELETON], {}, LORE, { prefix: '' })
        expect(await nameless.world.skeleton({ chatId: 'c1', userId: 'u1', source: 'x', mode: 'replace' })).toMatchObject({ status: 'failed', reason: expect.stringContaining('no name') })
        // The source is kept even when the run fails: it is the user's writing.
        expect((await bare.state.load('c1', 'u1')).skeletonSource).toBe('')
        expect((await broken.state.load('c1', 'u1')).skeletonSource).toBe('x')
    })

    it('does not run beside a report, and a report does not run beside it', async () => {
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => { release = resolve })
        const { world } = harness([], { generate: async () => { await gate; return SKELETON } })
        const first = world.skeleton({ chatId: 'c1', userId: 'u1', source: 'x', mode: 'replace' })
        expect(await world.run({ chatId: 'c1', userId: 'u1', trigger: 'manual' })).toMatchObject({ status: 'skipped' })
        expect(await world.skeleton({ chatId: 'c1', userId: 'u1', source: 'x', mode: 'append' })).toMatchObject({ status: 'skipped' })
        expect(await world.maybeRun('c1', 'u1')).toBeNull()
        await expect(world.purge({ chatId: 'c1', userId: 'u1', includeSkeleton: true })).rejects.toThrow(/running/)
        release()
        expect((await first).status).toBe('written')
    })
})

describe('purging the history (33b)', () => {
    it('empties the reports and the seeds, leaves the books standing, forgets the clock and the window, and keeps the source', async () => {
        const { world, books, state, setMemo } = harness(['## LOCATIONS\n### Harrowgate\nA cliff.', REPORT, REPORT])
        await world.skeleton({ chatId: 'c1', userId: 'u1', source: 'A coast.', mode: 'replace' })
        await world.run({ chatId: 'c1', userId: 'u1', trigger: 'manual' })
        setMemo('[TIME]\nCurrent: 09:00 AM, Day 6\n[/TIME]')
        await world.run({ chatId: 'c1', userId: 'u1', trigger: 'manual' })
        expect(books.entriesOf('Vell_World')).toHaveLength(2)
        const result = await world.purge({ chatId: 'c1', userId: 'u1', includeSkeleton: true })
        expect(result).toEqual({ worldBookName: 'Vell_World', skeletonBookName: 'Vell_Skeleton', worldCleared: 2, skeletonCleared: 1 })
        expect(books.entriesOf('Vell_World')).toEqual([])
        expect(books.entriesOf('Vell_Skeleton')).toEqual([])
        expect(books.books.map((b) => b.name)).toEqual(expect.arrayContaining(['Vell_World', 'Vell_Skeleton']))
        const record = await state.load('c1', 'u1')
        expect(record).toMatchObject({ lastFiredPeriodLabel: '', locationLastAdvanced: {}, activeReports: [], skeletonSource: 'A coast.' })
        expect(record.lastRun).toBeUndefined()
        expect(record.lastSkeleton).toBeUndefined()
        const status = await world.status('c1', 'u1')
        expect(status.skeletonCounts).toEqual({ factions: 0, locations: 0, conflicts: 0 })
        expect(status.activeReports).toEqual([])
    })

    it('keeps the skeleton when told to, and counts nothing for books that are not there', async () => {
        const { world, books, state } = harness(['## LOCATIONS\n### Harrowgate\nA cliff.', REPORT])
        await world.skeleton({ chatId: 'c1', userId: 'u1', source: 'A coast.', mode: 'replace' })
        await world.run({ chatId: 'c1', userId: 'u1', trigger: 'manual' })
        expect(await world.purge({ chatId: 'c1', userId: 'u1', includeSkeleton: false })).toEqual({ worldBookName: 'Vell_World', skeletonBookName: 'Vell_Skeleton', worldCleared: 1, skeletonCleared: 0 })
        expect(books.entriesOf('Vell_Skeleton')).toHaveLength(1)
        expect((await state.load('c1', 'u1')).lastSkeleton?.status).toBe('written')
        expect(await harness().world.purge({ chatId: 'c2', userId: 'u1', includeSkeleton: true })).toEqual({ worldBookName: 'Vell_World', skeletonBookName: 'Vell_Skeleton', worldCleared: 0, skeletonCleared: 0 })
    })
})

describe('the window on a host whose uids are slugs (33c, lesson 40)', () => {
    const DATED = { intervalHours: 1, clock: { use24hTime: true, useDdMmYyFormat: true } }
    const memo = (t: string) => `[TIME]\nCurrent: ${t}\n[/TIME]`

    it('shows the narrator the newest report by filing order, not by whatever the host lists last', async () => {
        // Four reports an hour apart. With slug uids `Number(uid)` is NaN and the
        // old sort left the host's order, which is not the filing order.
        let clock = '02/12/2026, 11:37'
        const h = harness(['one', 'two', 'three', 'four'], { memo: async () => memo(clock) }, LORE, DATED, 'slugs')
        for (const t of ['02/12/2026, 11:37', '02/12/2026, 12:37', '02/12/2026, 13:37', '02/12/2026, 14:37']) {
            clock = t
            expect((await h.world.run({ chatId: 'c1', userId: 'u1', trigger: 'manual' })).status).toBe('written')
        }
        const filed = h.books.entriesOf('Vell_World')
        expect(filed.map((e) => e.uid)).toEqual(['02-12-2026-11-37', '02-12-2026-12-37', '02-12-2026-13-37', '02-12-2026-14-37'])
        // The host lists them in its own order; the window must not care.
        filed.reverse()
        filed.push(filed.shift()!)
        expect((await h.state.load('c1', 'u1')).activeReports.map((r) => r.label)).toEqual(['02/12/2026, 14:37'])
        expect((await h.world.status('c1', 'u1')).activeReports.map((r) => r.label)).toEqual(['02/12/2026, 14:37'])
        // And a wider window is the newest N, oldest first.
        const wide = harness(['one', 'two', 'three'], { memo: async () => memo(clock) }, LORE, { ...DATED, keepActive: 2 }, 'slugs')
        for (const t of ['02/12/2026, 15:37', '02/12/2026, 16:37', '02/12/2026, 17:37']) {
            clock = t
            await wide.world.run({ chatId: 'c1', userId: 'u1', trigger: 'manual' })
        }
        expect((await wide.state.load('c1', 'u1')).activeReports.map((r) => r.label)).toEqual(['02/12/2026, 16:37', '02/12/2026, 17:37'])
    })

    it('reads a book filed by an older build, with no creation stamps, in the order its labels name', async () => {
        const seed = {
            ...LORE,
            Vell_World: [
                { uid: 'b', comment: '02/12/2026, 13:37', content: 'three' },
                { uid: 'a', comment: '02/12/2026, 11:37', content: 'one' },
                { uid: 'c', comment: '02/12/2026, 12:37', content: 'two' },
            ],
        }
        const { world, calls } = harness([REPORT], { memo: async () => memo('02/12/2026, 15:37') }, seed, { ...DATED, historyLookback: 2 }, 'slugs')
        await world.run({ chatId: 'c1', userId: 'u1', trigger: 'manual' })
        const history = calls[0]![1]!.content
        expect(history.indexOf('### 02/12/2026, 12:37')).toBeLessThan(history.indexOf('### 02/12/2026, 13:37'))
        expect(history).not.toContain('### 02/12/2026, 11:37')
    })

    it('names a dossier without the agent\'s message stamp', async () => {
        const seed = { ...LORE, Vell_LOC: [{ comment: 'Hidden Smoke in the Lower Valley [msg #303]', key: ['smoke'], content: 'A hollow where the charcoal burners hide.' }] }
        const { world, calls } = harness([REPORT], {}, seed, { locationsPerReport: 1 })
        const report = await world.run({ chatId: 'c1', userId: 'u1', trigger: 'manual' })
        expect(report.selectedLocations).toEqual(['Hidden Smoke in the Lower Valley'])
        expect(calls[0]![1]!.content).toContain('- Hidden Smoke in the Lower Valley\n')
        expect(calls[0]![1]!.content).not.toContain('[msg #303]')
    })
})

describe('the source from the chat, and the shelf (33c)', () => {
    it('writes one paragraph from the recent messages of both sides, keeps it, and strips a pair of quotes', async () => {
        const { world, calls, state } = harness(['"A drowned coast of salt guilds and ward councils."'], {}, LORE, { skeleton: { sourceLookback: 3 } as never })
        const run = await world.writeSource({ chatId: 'c1', userId: 'u1' })
        expect(run).toMatchObject({ status: 'written', source: 'A drowned coast of salt guilds and ward councils.' })
        const [system, user] = calls[0]!
        expect(system!.content.startsWith('You are a World Architect. Analyze the provided chat history')).toBe(true)
        expect(user!.content).toBe('## RECENT CHAT HISTORY\nGM: The gates close behind you.\n\nUser: Robin checks the map.\n\nGM: Rain falls on the barrow road.\n\nGenerate the Skeleton Source:')
        expect((await state.load('c1', 'u1')).skeletonSource).toBe('A drowned coast of salt guilds and ward councils.')
        expect((await world.status('c1', 'u1')).skeletonSource).toBe('A drowned coast of salt guilds and ward councils.')
        expect((await world.status('c1', 'u1')).skeleton.sourceLookback).toBe(3)
    })

    it('fails plainly with no messages, on an empty reply or a model error, and keeps the source that was there', async () => {
        const empty = harness(['x'], { history: async () => [] })
        await empty.state.save('c1', { skeletonSource: 'Kept.' }, 'u1')
        expect(await empty.world.writeSource({ chatId: 'c1', userId: 'u1' })).toMatchObject({ status: 'failed', reason: expect.stringContaining('no readable messages') })
        expect(empty.deps.generate).not.toHaveBeenCalled()
        expect(await harness(['  ']).world.writeSource({ chatId: 'c1', userId: 'u1' })).toMatchObject({ status: 'failed', reason: 'The model returned nothing.' })
        const broken = harness(['throw:refused'])
        await broken.state.save('c1', { skeletonSource: 'Kept.' }, 'u1')
        expect(await broken.world.writeSource({ chatId: 'c1', userId: 'u1' })).toMatchObject({ status: 'failed', reason: 'The model call failed: refused' })
        expect((await broken.state.load('c1', 'u1')).skeletonSource).toBe('Kept.')
        const controller = new AbortController()
        const stopped = harness([], { generate: async (_m, _c, _u, signal) => { controller.abort(); if (signal?.aborted) throw new Error('aborted'); return '' } })
        expect(await stopped.world.writeSource({ chatId: 'c1', userId: 'u1', signal: controller.signal })).toMatchObject({ status: 'cancelled' })
    })

    it('takes the same lock as a report', async () => {
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => { release = resolve })
        const { world } = harness([], { generate: async () => { await gate; return 'A coast.' } })
        const first = world.writeSource({ chatId: 'c1', userId: 'u1' })
        expect(await world.run({ chatId: 'c1', userId: 'u1', trigger: 'manual' })).toMatchObject({ status: 'skipped' })
        expect(await world.skeleton({ chatId: 'c1', userId: 'u1', source: 'x', mode: 'replace' })).toMatchObject({ status: 'skipped' })
        release()
        expect((await first).status).toBe('written')
        // And the other way round: a report in flight holds the source off.
        let free: () => void = () => undefined
        const held = new Promise<void>((resolve) => { free = resolve })
        const other = harness([], { generate: async () => { await held; return REPORT } })
        const report = other.world.run({ chatId: 'c1', userId: 'u1', trigger: 'manual' })
        expect(await other.world.writeSource({ chatId: 'c1', userId: 'u1' })).toMatchObject({ status: 'skipped' })
        free()
        expect((await report).status).toBe('written')
    })

    it('lists every book but World Progression\'s own, this campaign\'s first and marked', async () => {
        const seed = { ...LORE, Vell_World: [], Vell_Skeleton: [], 'Shared Canon': [], Other_World: [] }
        const { world } = harness([], {}, seed)
        expect(await world.books('c1', 'u1')).toEqual([
            { name: 'Vell_FAC', own: true },
            { name: 'Vell_LOC', own: true },
            { name: 'Vell_NPC', own: true },
            { name: 'Other_LOC', own: false },
            { name: 'Shared Canon', own: false },
        ])
    })
})

describe('the books it makes (66)', () => {
    const SKELETON = '## FACTIONS\n### The Salt Compact\nControls shipping.\n## LOCATIONS\n### Harrowgate\nA cliff town.'

    it('attaches a _Skeleton remade under a name the campaign already owns: made, renamed, removed, made again', async () => {
        const { world, books, owned, made } = harness([SKELETON])
        owned.push('Vell_Skeleton')
        const report = await world.skeleton({ chatId: 'c1', userId: 'u1', source: 'A drowned coast.', mode: 'replace' })
        expect(report).toMatchObject({ status: 'written' })
        expect(books.books.map((b) => b.name)).toContain('Vell_Skeleton')
        expect(made).toEqual(['Vell_Skeleton'])
        expect(owned.filter((n) => n === 'Vell_Skeleton')).toHaveLength(1)
    })

    it('attaches a _World book remade under an owned name the same way', async () => {
        const { world, owned, made, books } = harness()
        owned.push('Vell_World')
        const report = await world.run({ chatId: 'c1', userId: 'u1', trigger: 'manual' })
        expect(report.status).toBe('written')
        expect(books.books.map((b) => b.name)).toContain('Vell_World')
        expect(made).toEqual(['Vell_World'])
    })

    it('does not call the hook for a skeleton book that stood already', async () => {
        const { world, made } = harness([SKELETON])
        await world.skeleton({ chatId: 'c1', userId: 'u1', source: 'A coast.', mode: 'replace' })
        await world.skeleton({ chatId: 'c1', userId: 'u1', source: 'A coast.', mode: 'append' })
        expect(made).toEqual(['Vell_Skeleton'])
    })
})

describe('consolidate now and override next (72b)', () => {
    it('folds the oldest N raw reports into one digest on request, and refuses with fewer than N', async () => {
        const seed = { ...LORE, Vell_World: [
            { comment: 'Day 1, 08:00 AM', content: 'One.' }, { comment: 'Day 2, 08:00 AM', content: 'Two.' }, { comment: 'Day 3, 08:00 AM', content: 'Three.' },
        ] }
        const { world, books, calls } = harness(['[Days 1–2] merged'], {}, seed)
        expect(await world.consolidateNow('c1', 'u1', 2)).toEqual({ label: 'Days 1–2', consolidated: 2 })
        expect(calls).toHaveLength(1)
        expect(books.entriesOf('Vell_World').map((e) => e.comment)).toEqual(['Day 3, 08:00 AM', 'Days 1–2'])
        await expect(world.consolidateNow('c1', 'u1', 5)).rejects.toThrow(/Only 1 raw report is filed; 5 are needed/)
        const empty = harness(['x'], {}, LORE)
        await expect(empty.world.consolidateNow('c1', 'u1', 2)).rejects.toThrow(/no World book yet/)
        const silent = harness([''], {}, seed)
        await expect(silent.world.consolidateNow('c1', 'u1', 2)).rejects.toThrow(/no digest/)
        expect(silent.books.entriesOf('Vell_World')).toHaveLength(3)
    })

    it('sets the next report’s time by taking the last as one interval before it, and refuses a time it cannot read', async () => {
        const { world, state } = harness([REPORT], {}, LORE, { intervalHours: 24 })
        await world.overrideNext('c1', 'u1', 'Day 6, 08:00 AM')
        expect((await state.load('c1', 'u1')).lastFiredPeriodLabel).toBe('Day 5, 08:00 AM')
        expect((await world.status('c1', 'u1')).nextDueLabel).toBe('Day 6, 08:00 AM')
        await world.overrideNext('c1', 'u1', 'Day 1, 06:00 AM')
        expect((await state.load('c1', 'u1')).lastFiredPeriodLabel).toBe('Day 1, 12:00 AM')
        await expect(world.overrideNext('c1', 'u1', 'soon')).rejects.toThrow(/not an in-world time/)
    })
})
