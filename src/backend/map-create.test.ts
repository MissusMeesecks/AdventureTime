import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_MAP_ARCHITECT_BRIEF_SYSTEM_PROMPT } from '../tracker/architect.js'
import { LOCATION_BOOK } from '../tracker/map.test.js'
import { buildBriefPrompt, buildReferenceContext, cardReferenceFields, createMapCreation, readBriefReply, resolveLookback, type MapCreationDeps } from './map-create.js'
import { MapStore } from './map-store.js'
import type { MemoStorage } from './memo-store.js'

function storage(): MemoStorage {
    const files = new Map<string, unknown>()
    return {
        async getJson<T>(path: string, options?: { fallback?: T }): Promise<T> { return (files.has(path) ? files.get(path) : options?.fallback) as T },
        async setJson(path: string, value: unknown): Promise<void> { files.set(path, JSON.parse(JSON.stringify(value))) },
    }
}

const BRIEF = JSON.stringify({ kind: 'dungeon', entrance: 'Broken Gate', scale: 'small', threat: 'high', prompt: 'A flooded crypt with three chambers.', brief_description: 'A flooded crypt.', keywords: ['crypt', 'Varnholde'] })

function harness(over: Partial<MapCreationDeps> = {}, options: { brief?: string; outcome?: 'written' | 'failed' | 'none' } = {}) {
    const state = new MapStore(storage())
    const runs: Array<Record<string, unknown>> = []
    const calls: Array<Array<{ role: string; content: string }>> = []
    const log: string[] = []
    const events: unknown[][] = []
    const entries = {
        // The last root is one the agent stamped (71d-ter).
        b1: [...Object.values(LOCATION_BOOK), { comment: 'Hollow Barrow [msg #12]', content: '[CORE]\nA barrow.\n[/CORE]' }].map((e, i) => ({ id: `e${i + 1}`, uid: String(i + 1), comment: e.comment, content: e.content, key: [e.comment] })),
        b2: [{ id: 'r1', uid: '7', comment: 'The Kings', content: 'Three kings ruled.', key: ['kings'] }, { id: 'r2', uid: '8', comment: '', content: 'A rumour.', key: ['rumour'] }, { id: 'r3', uid: '9', comment: 'Empty', content: '   ', key: [] }],
    }
    const deps: MapCreationDeps = {
        architect: {
            run: async (request) => {
                runs.push({ ...request })
                const outcome = options.outcome ?? 'written'
                if (outcome === 'written') await state.save(request.chatId, { lastArchitect: { status: 'written', at: '2026-10-19T12:00:01.000Z', site: String(request.args.site), kind: String(request.args.kind), areas: 4, assets: 3, entryId: 'Vell_LOC::9' } }, request.userId)
                if (outcome === 'failed') await state.save(request.chatId, { lastArchitect: { status: 'failed', at: '2026-10-19T12:00:01.000Z', site: String(request.args.site), reason: 'The architect could not produce a valid connected topology.' } }, request.userId)
                return outcome === 'none' ? '[MAP_ARCHITECT_ERROR — PRIVATE]\nsite, entrance, and prompt are required.\n[/MAP_ARCHITECT_ERROR]' : '[MAP_ARCHITECT_RESULT — PRIVATE]\nMap saved to Vell_LOC::9.\n[/MAP_ARCHITECT_RESULT]'
            },
        },
        generate: vi.fn(async (messages) => { calls.push(messages); return options.brief ?? BRIEF }),
        store: () => ({
            listBooks: async () => [{ id: 'b1', name: 'Vell_LOC' }, { id: 'b2', name: 'Realm Lore' }],
            listEntries: async (id) => entries[id as 'b1' | 'b2'] ?? [],
        }),
        campaign: async () => ({ prefix: 'Vell', owned: ['Vell_LOC'] }),
        story: async (_c, _u, lookback) => ({ lines: ['PLAYER: We go down.', 'NARRATOR: The gate is broken.'].slice(-lookback), lastReply: '' }),
        options: async () => ({ lookback: 12, systemPrompt: '' }),
        enabled: async () => true,
        state,
        cards: async (_u, ids) => ids.map((id) => ({ name: `Card ${id}`, description: `The card ${id}.` })),
        log: { info: (m) => log.push(m), warn: (m) => log.push(`warn: ${m}`) },
        now: () => new Date('2026-10-19T12:00:00.000Z'),
        events: { started: (chatId, userId, site, at) => { events.push(['started', chatId, userId, site, at]) }, finished: (chatId, userId, report) => { events.push(['finished', chatId, userId, report]) } },
        ...over,
    }
    return { creation: createMapCreation(deps), runs, calls, log, state, events }
}

describe('the brief and the reference context (71a)', () => {
    it('reads the brief reply as the legacy does, with the threat defaulting by kind', () => {
        expect(readBriefReply(BRIEF)).toEqual({ entrance: 'Broken Gate', kind: 'DUNGEON', scale: 'SMALL', threat: 'HIGH', prompt: 'A flooded crypt with three chambers.', briefDescription: 'A flooded crypt.', keywords: ['crypt', 'Varnholde'] })
        expect(readBriefReply('```json\n{"kind":"settlement","entrance":"Gate","prompt":"A town.","brief_description":"A town.","scale":"huge"}\n```')).toMatchObject({ kind: 'SETTLEMENT', scale: 'MEDIUM', threat: 'MODERATE', keywords: [] })
        expect(() => readBriefReply('{"kind":"dungeon","entrance":"Gate"}')).toThrow(/incomplete map brief/)
        expect(() => readBriefReply('no json here')).toThrow('No JSON object was found.')
        expect(resolveLookback(12, undefined)).toBe(12)
        expect(resolveLookback(12, 0)).toBe(0)
        expect(resolveLookback(12, 250)).toBe(100)
        expect(resolveLookback(12, -3)).toBe(0)
    })

    it('builds the reference context from the books’ entries and the cards, and nothing from nothing', () => {
        expect(buildReferenceContext([], [])).toBe('')
        expect(buildReferenceContext([{ name: 'Empty', entries: [{ uid: '1', comment: 'x', key: [], content: '  ' }] }], [{ name: 'Nobody' }])).toBe('')
        const text = buildReferenceContext(
            [{ name: 'Zeta', entries: [{ uid: '1', comment: 'The Kings', key: ['kings'], content: 'Three kings.' }] }, { name: 'Alpha', entries: [{ uid: '2', comment: '', key: ['rumour'], content: 'A rumour.' }, { uid: '3', comment: '', key: [], content: 'Untitled.' }] }],
            [{ name: 'Mara', description: 'A guide.', personality: '', scenario: 'Lost.' }],
        )
        expect(text.startsWith('USER-SELECTED REFERENCE CONTEXT\nTreat this as established canon')).toBe(true)
        expect(text.indexOf('### LOREBOOK: Alpha')).toBeLessThan(text.indexOf('### LOREBOOK: Zeta'))
        expect(text).toContain('#### rumour\nA rumour.')
        expect(text).toContain('#### Entry 3\nUntitled.')
        expect(text).toContain('### CHARACTER CARD: Mara\nDescription: A guide.\n\nScenario: Lost.')
        expect(cardReferenceFields({ name: '', description: 'x' })).toBe('### CHARACTER CARD: Unnamed character\nDescription: x')
    })

    it('writes the brief prompt with the vacuum note at a lookback of 0 and the placeholders when nothing is there', () => {
        const prompt = buildBriefPrompt({ site: 'Varnholde Crypts', lore: '', brief: '', windowSize: 0, context: '', referenceContext: '' })
        expect(prompt).toContain('Exact site root (locked, copy character-for-character): Varnholde Crypts')
        expect(prompt).toContain('USER BRIEF\n(none)')
        expect(prompt).toContain('LOCATION LORE\n(No location lore entry.)')
        expect(prompt).toContain('RECENT STORY CONTEXT (0 messages; vacuum — do not invent from chat)\n(No additional recent context.)')
        expect(prompt).toContain('USER-SELECTED REFERENCE CONTEXT\n(none selected)')
        expect(prompt.endsWith('Output only the JSON object.')).toBe(true)
    })
})

describe('a map made from the panel (71a)', () => {
    it('Manual: hands the form to the architect with the reference context and the keywords, and answers with its report', async () => {
        const { creation, runs, calls } = harness()
        const result = await creation.create({ chatId: 'c1', userId: 'u1', site: 'Varnholde Crypts', mode: 'manual', requireNew: true, kind: 'dungeon', entrance: 'Broken Gate', scale: 'small', threat: '', prompt: 'A flooded crypt.', briefDescription: 'A crypt.', keywords: ['crypt', 'the undercroft'], include: [], lorebooks: ['Realm Lore', 'Missing'], cards: ['k1'], lookback: 3 })
        expect(result).toMatchObject({ status: 'written', site: 'Varnholde Crypts', kind: 'DUNGEON', areas: 4, entryId: 'Vell_LOC::9' })
        expect(result.inferred).toBeUndefined()
        expect(calls).toEqual([])
        expect(runs).toHaveLength(1)
        expect(runs[0]!.lookback).toBe(3)
        const args = runs[0]!.args as Record<string, unknown>
        expect(args).toMatchObject({ site: 'Varnholde Crypts', kind: 'DUNGEON', entrance: 'Broken Gate', scale: 'SMALL', threat: 'HIGH', prompt: 'A flooded crypt.', brief_description: 'A crypt.', locationKeys: ['crypt', 'the undercroft'] })
        expect(String(args.reference)).toContain('### LOREBOOK: Realm Lore\n#### The Kings\nThree kings ruled.\n\n#### rumour\nA rumour.')
        expect(String(args.reference)).toContain('### CHARACTER CARD: Card k1\nDescription: The card k1.')
        // Without a prompt or a description, Manual is refused before anything runs.
        expect(await creation.create({ chatId: 'c1', userId: 'u1', site: 'Elsewhere', mode: 'manual', requireNew: true, prompt: '', briefDescription: 'x' })).toMatchObject({ status: 'failed', reason: 'Map-generation prompt and brief description are required.' })
        expect(runs).toHaveLength(1)
        // + MAP on a stamped root (71d-ter): the architect is handed the plain name, and the report carries it.
        const stamped = await creation.create({ chatId: 'c1', userId: 'u1', site: 'Varnholde Crypts [msg #12]', mode: 'manual', requireNew: false, prompt: 'A flooded crypt.', briefDescription: 'A crypt.' })
        expect(stamped).toMatchObject({ status: 'written', site: 'Varnholde Crypts' })
        expect((runs[1]!.args as Record<string, unknown>).site).toBe('Varnholde Crypts')
    })

    it('Auto: fills the brief with one model call on the lore, the story and the brief, then draws from it', async () => {
        const { creation, runs, calls, log, events } = harness()
        const result = await creation.create({ chatId: 'c1', userId: 'u1', site: 'Glassmere', mode: 'auto', requireNew: false, brief: 'A lake town of glassblowers.', lookback: 2, keywords: ['lake'] })
        expect(result).toMatchObject({ status: 'written', site: 'Glassmere', inferred: { kind: 'DUNGEON', entrance: 'Broken Gate', scale: 'SMALL', threat: 'HIGH', briefDescription: 'A flooded crypt.' } })
        // The Maps light turns at the brief (73a), not after it; the architect announces its own end.
        expect(events).toEqual([['started', 'c1', 'u1', 'Glassmere', '2026-10-19T12:00:00.000Z']])
        expect(calls).toHaveLength(1)
        expect(calls[0]![0]).toEqual({ role: 'system', content: DEFAULT_MAP_ARCHITECT_BRIEF_SYSTEM_PROMPT })
        const prompt = calls[0]![1]!.content
        expect(prompt).toContain('Exact site root (locked, copy character-for-character): Glassmere')
        expect(prompt).toContain('USER BRIEF\nA lake town of glassblowers.')
        expect(prompt).toContain('LOCATION LORE\nA lake settlement with no map.')
        expect(prompt).toContain('RECENT STORY CONTEXT (2 messages)\nPLAYER: We go down.\n\nNARRATOR: The gate is broken.')
        const args = runs[0]!.args as Record<string, unknown>
        expect(args).toMatchObject({ site: 'Glassmere', kind: 'DUNGEON', entrance: 'Broken Gate', scale: 'SMALL', threat: 'HIGH', prompt: 'A flooded crypt with three chambers.', brief_description: 'A flooded crypt.', locationKeys: ['lake', 'crypt', 'Varnholde'] })
        expect(args.reference).toBeUndefined()
        expect(runs[0]!.lookback).toBe(2)
        expect(log.some((l) => l.startsWith('map: filling the brief for "Glassmere" (2 messages)'))).toBe(true)
        // A new root with no lore and a lookback of 0: the legacy's placeholder premise, no story read.
        const vacuum = harness()
        await vacuum.creation.create({ chatId: 'c1', userId: 'u1', site: 'Nowhere Keep', mode: 'auto', requireNew: true, lookback: 0 })
        expect(vacuum.calls[0]![1]!.content).toContain('LOCATION LORE\nNowhere Keep is a location root requested for a Persistent Map. Stay consistent with established story.')
        expect(vacuum.calls[0]![1]!.content).toContain('RECENT STORY CONTEXT (0 messages; vacuum — do not invent from chat)')
    })

    it('refuses before any call: a name with ::, no name, the mapping section off, and a root that already exists when a new one is asked for', async () => {
        const { creation, runs, calls } = harness()
        expect(await creation.create({ chatId: 'c1', userId: 'u1', site: 'A :: B', mode: 'auto', requireNew: true })).toMatchObject({ status: 'failed', reason: 'Use a location root name, not a nested :: path.' })
        expect(await creation.create({ chatId: 'c1', userId: 'u1', site: '  ', mode: 'auto', requireNew: true })).toMatchObject({ status: 'failed', reason: 'A location name is required.' })
        expect(await creation.create({ chatId: 'c1', userId: 'u1', site: 'glassmere', mode: 'auto', requireNew: true })).toMatchObject({ status: 'failed', reason: 'A location named "Glassmere" already exists. Use + MAP on that root instead.' })
        // The agent's stamp on a title is not the name (71d-ter): a stamped root is the same root, and the architect is handed the plain name.
        expect(await creation.create({ chatId: 'c1', userId: 'u1', site: 'Glassmere [msg #4]', mode: 'auto', requireNew: true })).toMatchObject({ status: 'failed', reason: 'A location named "Glassmere" already exists. Use + MAP on that root instead.' })
        expect(await creation.create({ chatId: 'c1', userId: 'u1', site: 'Hollow Barrow', mode: 'auto', requireNew: true })).toMatchObject({ status: 'failed', reason: 'A location named "Hollow Barrow" already exists. Use + MAP on that root instead.' })
        expect(await creation.create({ chatId: 'c1', userId: 'u1', site: 'Abbey Undercroft', mode: 'manual', requireNew: true, prompt: 'x', briefDescription: 'y' })).toMatchObject({ status: 'failed', reason: /already exists/ })
        const off = harness({ enabled: async () => false })
        expect(await off.creation.create({ chatId: 'c1', userId: 'u1', site: 'Glassmere', mode: 'auto', requireNew: false })).toMatchObject({ status: 'failed', reason: /mapping section is off/ })
        expect(runs).toEqual([])
        expect(calls).toEqual([])
        expect(off.runs).toEqual([])
    })

    it('names a brief that could not be read, and the architect’s own refusal or failure', async () => {
        const noBrief = harness({}, { brief: 'I cannot do that.' })
        const result = await noBrief.creation.create({ chatId: 'c1', userId: 'u1', site: 'Glassmere', mode: 'auto', requireNew: false })
        expect(result.status).toBe('failed')
        expect(result.reason).toBe('No JSON object was found.')
        expect(noBrief.runs).toEqual([])
        expect((await noBrief.state.load('c1', 'u1')).lastArchitect).toMatchObject({ status: 'failed', site: 'Glassmere' })
        // A brief that failed puts the light out itself (73a): the architect never ran to do it.
        expect(noBrief.events).toEqual([['started', 'c1', 'u1', 'Glassmere', '2026-10-19T12:00:00.000Z'], ['finished', 'c1', 'u1', { status: 'failed', at: '2026-10-19T12:00:00.000Z', site: 'Glassmere', reason: 'No JSON object was found.' }]])
        const failed = harness({}, { outcome: 'failed' })
        expect(await failed.creation.create({ chatId: 'c1', userId: 'u1', site: 'Glassmere', mode: 'auto', requireNew: false })).toMatchObject({ status: 'failed', reason: 'The architect could not produce a valid connected topology.', inferred: { kind: 'DUNGEON' } })
        const none = harness({}, { outcome: 'none' })
        expect(await none.creation.create({ chatId: 'c1', userId: 'u1', site: 'Glassmere', mode: 'manual', requireNew: false, prompt: 'x', briefDescription: 'y' })).toMatchObject({ status: 'failed', reason: 'site, entrance, and prompt are required.' })
    })
})

describe('the terminal’s steps and the caller’s kind (71b)', () => {
    it('puts the brief on the architect’s feed, and a kind the caller names outranks the brief’s', async () => {
        const steps: Array<[string, string]> = []
        const { creation, runs } = harness({ steps: () => (type, content) => { steps.push([type, content]) } })
        await creation.create({ chatId: 'c1', userId: 'u1', site: 'Glassmere', mode: 'auto', requireNew: false, brief: 'A lake town.', lookback: 2, kind: 'settlement' })
        expect(steps).toEqual([
            ['start', 'Filling the brief for Glassmere (2 messages)…'],
            ['result', 'The brief: DUNGEON, entrance "Broken Gate", SMALL, HIGH.'],
        ])
        expect((runs[0]!.args as Record<string, unknown>).kind).toBe('SETTLEMENT')
        const failing = harness({ generate: async () => { throw new Error('no model') }, steps: () => (type, content) => { steps.push([type, content]) } })
        steps.length = 0
        await failing.creation.create({ chatId: 'c1', userId: 'u1', site: 'Glassmere', mode: 'auto', requireNew: false })
        expect(steps.at(-1)).toEqual(['error', 'The brief for Glassmere failed: no model'])
    })
})
