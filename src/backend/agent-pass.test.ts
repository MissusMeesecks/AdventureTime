import { describe, expect, it, vi } from 'vitest'

import {
    agentPassOptions,
    connectionField,
    buildAgentPrompt,
    runAgentPass,
    undoAgentPass,
    undoAgentPassForMessage,
    type AgentPassDeps,
    redoAgentPass,
} from './agent-pass.js'
import type { LorePassSnapshot } from '../agent/undo.js'
import type { LoreBook, LoreEntry, LoreStore } from '../agent/writer.js'
import { COMMIT_FIELDS } from '../agent/commit.js'
import { DEFAULT_MAX_TURNS } from '../agent/loop.js'
import { FACTORY_CARTRIDGE_DEFAULTS } from '../state/factory-defaults.js'

function makeStore(seed: Record<string, Array<Partial<LoreEntry>>> = {}) {
    const books: LoreBook[] = []
    const entries = new Map<string, LoreEntry[]>()
    let n = 1
    for (const [name, list] of Object.entries(seed)) {
        const book = { id: `b${books.length + 1}`, name }
        books.push(book)
        entries.set(book.id, list.map((entry, i) => ({
            id: `e${n++}`, uid: entry.uid ?? String(i + 1),
            key: entry.key ?? [], content: entry.content ?? '', comment: entry.comment ?? '',
        })))
    }
    const store: LoreStore = {
        listBooks: async () => books.map((b) => ({ ...b })),
        createBook: async (name) => {
            const book = { id: `b${books.length + 1}`, name }
            books.push(book); entries.set(book.id, []); return { ...book }
        },
        listEntries: async (id) => (entries.get(id) ?? []).map((e) => ({ ...e })),
        createEntry: async (id, entry) => {
            const list = entries.get(id)!
            const made = { id: `e${n++}`, uid: String(list.length + 1), ...entry }
            list.push(made); return { ...made }
        },
        updateEntry: async (id, patch) => {
            for (const list of entries.values()) {
                const found = list.find((e) => e.id === id)
                if (found) Object.assign(found, patch)
            }
        },
        deleteEntry: async (id) => {
            for (const [bookId, list] of entries) entries.set(bookId, list.filter((e) => e.id !== id))
        },
    }
    return { store, entriesOf: (name: string) => entries.get(books.find((b) => b.name === name)!.id)! }
}

function deps(replies: string[], over: Partial<AgentPassDeps> = {}): AgentPassDeps & { owned: string[]; made: string[]; others: string[] } {
    let index = 0
    const owned: string[] = []
    const made: string[] = []
    const others: string[] = []
    return {
        store: makeStore().store,
        generate: vi.fn(async () => replies[Math.min(index++, replies.length - 1)]!),
        narrative: async () => 'The party reached the Handler\'s Rest.',
        ownership: {
            get: async () => [...owned],
            set: async (_chat, books) => { owned.length = 0; owned.push(...books) },
            made: async (_chat, names) => { made.push(...names); for (const name of names) if (!owned.includes(name)) owned.push(name) },
            others: async () => [...others],
        },
        campaign: { override: 'Vell', anchorChatId: 'chat-1' },
        owned,
        made,
        others,
        ...over,
    }
}

describe('running a pass end to end', () => {
    it('writes what the model committed, into a book it creates', async () => {
        const { store, entriesOf } = makeStore({})
        const d = deps(
            ['Action: commit({"record": [{"label": "Lissa", "category": "NPC", "keys": ["Lissa"], "content": "A rope-keeper."}]})'],
            { store },
        )
        const report = await runAgentPass('chat-1', 'u1', d)

        expect(report.outcome).toBe('committed')
        expect(report.write?.createdBooks).toEqual(['Vell_NPC'])
        expect(entriesOf('Vell_NPC')[0]).toMatchObject({ comment: 'Lissa', content: 'A rope-keeper.' })
        expect(report.summary).toContain('1 entry written')
        // The book it made goes through the made hook (66): recorded and attached at once, whatever the name's standing.
        expect(d.made).toEqual(['Vell_NPC'])
        expect(d.owned).toEqual(['Vell_NPC'])
    })

    it('puts a book made under a name the campaign already owned through the hook too (66)', async () => {
        const { store } = makeStore()
        const d = deps(
            ['Action: commit({"record": [{"label": "Lissa", "category": "NPC", "keys": ["Lissa"], "content": "A rope-keeper."}]})'],
            { store },
        )
        d.owned.push('Vell_NPC')
        const report = await runAgentPass('chat-1', 'u1', d)
        expect(report.outcome).toBe('committed')
        expect(d.made).toEqual(['Vell_NPC'])
    })

    it('does not call the hook when every book stood already', async () => {
        const { store } = makeStore({ Vell_NPC: [] })
        const d = deps(
            ['Action: commit({"record": [{"label": "Lissa", "category": "NPC", "keys": ["Lissa"], "content": "A rope-keeper."}]})'],
            { store },
        )
        d.owned.push('Vell_NPC')
        const report = await runAgentPass('chat-1', 'u1', d)
        expect(report.outcome).toBe('committed')
        expect(d.made).toEqual([])
    })

    it('sends the user\'s instruction with the pass, and says who started it', async () => {
        const starts: string[] = []
        const d = deps(['Action: done()'], {
            instruction: 'Add an entry for the innkeeper.',
            trigger: 'direct',
            onPassStart: ({ trigger }) => { starts.push(trigger) },
        })
        await runAgentPass('chat-1', 'u1', d)
        const first = (d.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Array<{ role: string; content: string }>
        expect(first[1]!.content).toContain('## INSTRUCTION\n\nAdd an entry for the innkeeper.')
        expect(starts).toEqual(['direct'])
    })

    it('records a created book as the campaign\'s, so an undo can tell', async () => {
        // 9b's baseline. A book we made and did not record looks pre-existing,
        // and an undo would then leave it behind.
        const d = deps(['Action: commit({"record": [{"label": "A", "category": "NPC"}]})'])
        await runAgentPass('chat-1', 'u1', d)
        expect(d.owned).toEqual(['Vell_NPC'])
    })

    it('does not touch the ownership list when nothing was created', async () => {
        const { store } = makeStore({ Vell_NPC: [{ uid: '1', content: 'Old.' }] })
        const d = deps(['Action: commit({"update": [{"id": "Vell_NPC::1", "content": "New."}]})'], { store })
        d.ownership.get = async () => ['Vell_NPC']
        const set = vi.fn()
        d.ownership.set = set

        await runAgentPass('chat-1', 'u1', d)
        expect(set).not.toHaveBeenCalled()
    })

    it('writes nothing when the pass did not commit', async () => {
        const { store, entriesOf } = makeStore({ Vell_NPC: [{ uid: '1', content: 'Untouched.' }] })
        const d = deps(['Action: grep_lore("anything")'], { store, maxTurns: 2 })
        const report = await runAgentPass('chat-1', 'u1', d)

        expect(report.outcome).toBe('no-commit')
        expect(report.write).toBeUndefined()
        expect(entriesOf('Vell_NPC')[0]!.content).toBe('Untouched.')
    })

    it('leaves the lore alone when the model call fails', async () => {
        const { store, entriesOf } = makeStore({ Vell_NPC: [{ uid: '1', content: 'Untouched.' }] })
        const d = deps([], { store, generate: async () => { throw new Error('rate limited') } })
        const report = await runAgentPass('chat-1', 'u1', d)

        expect(report.outcome).toBe('failed')
        expect(entriesOf('Vell_NPC')[0]!.content).toBe('Untouched.')
    })

    it('reports a refusal rather than hiding it', async () => {
        // A silent refusal looks like a bug in the agent. Refusals are the
        // interesting half — they are where the ownership rules bit.
        const { store, entriesOf } = makeStore({ 'My World Bible': [{ uid: '1', content: 'Mine.' }] })
        const d = deps(
            ['Action: commit({"rewrite": [{"id": "My World Bible::1", "content": "Theirs."}]})'],
            { store },
        )
        const report = await runAgentPass('chat-1', 'u1', d)

        expect(entriesOf('My World Bible')[0]!.content).toBe('Mine.')
        expect(report.write?.refused[0]).toContain('does not belong to this campaign')
        expect(report.summary).toContain('1 refused')
    })

    it('keeps the steps, so a pass that did nothing is not a pass that never ran', async () => {
        const d = deps(['Action: grep_lore("Lissa")', 'Action: commit({})'])
        const report = await runAgentPass('chat-1', 'u1', d)
        expect(report.steps.map((s) => s.kind)).toContain('tool')
        expect(report.turnsUsed).toBe(2)
    })

    it('uses the campaign name only for the chat it is anchored to', async () => {
        // Branching a campaign makes a second chat; without the anchor both
        // would write into one stack of books.
        const d = deps(['Action: commit({"record": [{"label": "A", "category": "NPC"}]})'])
        const report = await runAgentPass('chat-2', 'u1', d)
        expect(report.prefix).toBe('chat_2')
        expect(d.owned).toEqual(['chat_2_NPC'])
    })
})

describe('the Player Card in a pass (35b)', () => {
    it('hands the writer the card when the chat has one, so a {{user}} edit reaches it', async () => {
        const applied: Array<[string, string]> = []
        const d = deps(['Action: commit({"appearance": [{"id": "{{user}}", "content": "Tall now."}]})'], {
            playerCard: { name: 'Robin', apply: async (field, content) => { applied.push([field, content]); return { ok: true } } },
        })
        const report = await runAgentPass('chat-1', 'u1', d)
        expect(report.outcome).toBe('committed')
        expect(applied).toEqual([['Body', 'Tall now.']])
        expect(report.write?.changed).toEqual(['{{user}}'])
        // Without a card the same address is not an entry id, as before: the commit reads as empty and says why.
        const none = await runAgentPass('chat-1', 'u1', deps(['Action: commit({"appearance": [{"id": "{{user}}", "content": "Tall now."}]})'], { playerCard: null }))
        expect(none.write?.changed).toEqual([])
        expect(none.problems).toEqual(['appearance: "{{user}}" is not an entry id'])
    })

    it('tells the model about the card, and only when there is one', () => {
        const base = { prefix: 'Vell', narrative: 'x', bookNames: [], maxTurns: 3 }
        const told = buildAgentPrompt({ ...base, playerCard: 'Robin Vale' })[0]!.content
        expect(told).toContain('The player character is Robin Vale, and their Player Card is kept for you.')
        expect(told).toContain('change the card with a "core" edit whose id is "{{user}}" and whose field is\n"Body" or "Worn Equipment"')
        expect(buildAgentPrompt(base)[0]!.content).not.toContain('Player Card')
    })
})

describe('the relationship values in a pass (44)', () => {
    const REL = 'Action: commit({"record": [{"label": "Lissa", "category": "NPC", "keys": ["Lissa"], "content": "A rope-keeper."}], "rel": [{"id": "Lissa", "field": "friendship", "delta": 30}, {"id": "Ghost", "field": "affection", "delta": 1}]})'

    it('tells the model the section when the system is on, and hands the rel items to the store after the write, tied to the reply', async () => {
        const calls: unknown[] = []
        const d = deps([REL], {
            relationships: {
                section: async () => 'REL SECTION',
                apply: async (chatId, userId, items, messageId) => {
                    calls.push([chatId, userId, items, messageId])
                    return { placed: [{ label: 'Lissa', field: 'friendship', delta: 30, newValue: 30 }], unmatched: ['Ghost'] }
                },
            },
            latestMessageId: async () => 'm7',
        })
        const report = await runAgentPass('chat-1', 'u1', d)
        const first = (d.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Array<{ role: string; content: string }>
        expect(first[0]!.content).toContain('\nREL SECTION')
        expect(calls).toEqual([['chat-1', 'u1', [{ id: 'Lissa', field: 'friendship', delta: 30 }, { id: 'Ghost', field: 'affection', delta: 1 }], 'm7']])
        expect(report.summary).toContain('1 relationship value set: Lissa friendship +30.')
        expect(report.problems).toEqual(['rel: no entry of this campaign is named "Ghost", so its relationship value was not set'])
        expect(report.write?.createdBooks).toEqual(['Vell_NPC'])
    })

    it('hands a rel item named under another key to the store by that name (65-bis)', async () => {
        // The live pass: two NPCs recorded and named in the same commit, no
        // id to cite, both values lost to "(no id)" names nobody.
        const calls: unknown[] = []
        const named = 'Action: commit({"record": [{"label": "Ivo", "category": "NPC", "keys": ["Ivo"], "content": "A minion."}, {"label": "Scooter", "category": "NPC", "keys": ["Scooter"], "content": "The other one."}], "rel": [{"name": "Ivo", "field": "friendship", "delta": -15}, {"npc": "Scooter", "field": "friendship", "delta": -10}]})'
        const d = deps([named], {
            relationships: {
                section: async () => 'REL SECTION',
                apply: async (chatId, userId, items) => { calls.push(items); return { placed: items.map((i) => ({ label: i.id, field: i.field, delta: i.delta, newValue: i.delta })), unmatched: [] } },
            },
        })
        const report = await runAgentPass('chat-1', 'u1', d)
        expect(calls).toEqual([[{ id: 'Ivo', field: 'friendship', delta: -15 }, { id: 'Scooter', field: 'friendship', delta: -10 }]])
        expect(report.problems).toEqual([])
        expect(report.summary).toContain('2 relationship values set')
    })

    it('says the values were ignored without a store, and when the system is off; a store that throws is a problem, not a failed pass', async () => {
        const none = await runAgentPass('chat-1', 'u1', deps([REL]))
        expect(none.summary).toContain('2 relationship changes ignored — this build has no relationship store.')
        const off = await runAgentPass('chat-1', 'u1', deps([REL], { relationships: { section: async () => '', apply: async () => ({ placed: [], unmatched: [] }) } }))
        expect(off.summary).toContain('2 relationship changes ignored — the relationship system is off.')
        const first = (deps([REL]).generate as ReturnType<typeof vi.fn>).mock.calls
        expect(first).toEqual([])
        const broken = await runAgentPass('chat-1', 'u1', deps([REL], { relationships: { section: async () => { throw new Error('prefs down') }, apply: async () => { throw new Error('store down') } } }))
        expect(broken.outcome).toBe('committed')
        expect(broken.problems).toEqual(['the relationship values could not be set: Error: store down'])
    })
})

describe('the module instructions and the mechanical state (45b)', () => {
    const CARTRIDGE = {
        routerModules: { npc: { enabled: true, tag: 'NPC', instruction: 'Named people, with a [CORE] block.' }, loc: { enabled: false, tag: 'LOC', instruction: 'Places.' } },
        routerCombatProfileGuidanceAgentTemplate: '## COMBAT PROFILE\nPatch it from the sheet.',
    }
    const prompt = (d: AgentPassDeps) => (d.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Array<{ role: string; content: string }>

    it('tells the model each enabled module\'s instruction, and the memo\'s combat and party blocks with the guidance, before the narrative', async () => {
        const d = deps(['Action: done()'], {
            settings: async () => CARTRIDGE,
            memo: async () => '[TIME]\nDay 2\n[/TIME]\n[PARTY]\nKes (Rogue 3): 10/12\n[/PARTY]\n[COMBAT]\nENEMIES:\nWolf 4/8\n[/COMBAT]',
        })
        await runAgentPass('chat-1', 'u1', d)
        const [system, user] = prompt(d)
        expect(system!.content).toContain('WHAT EACH CATEGORY RECORDS')
        expect(system!.content).toContain('- NPC: Named people, with a [CORE] block.')
        expect(system!.content).not.toContain('- LOC:')
        expect(system!.content).toContain('## COMBAT PROFILE\nPatch it from the sheet.')
        expect(user!.content.indexOf('## ACTIVE COMBAT STATE')).toBeLessThan(user!.content.indexOf('## PARTY MECHANICAL STATE'))
        expect(user!.content.indexOf('## PARTY MECHANICAL STATE')).toBeLessThan(user!.content.indexOf('## NARRATIVE'))
        expect(user!.content).toContain('[COMBAT]ENEMIES:\nWolf 4/8[/COMBAT]')
        expect(user!.content).toContain('[PARTY]Kes (Rogue 3): 10/12[/PARTY]')
    })

    // 45b-bis: a Combat Profile is replaced whole, and the cartridge's own
    // section names bound it — the writer gets them from the pass.
    it('replaces a multi-line Combat Profile whole, stopping at a section the cartridge names', async () => {
        const { store, entriesOf } = makeStore({ Vell_NPC: [{ uid: '1', comment: 'Fenna', key: ['Fenna'], content: '[CORE]\nSpecies: Human\nCombat Profile: Fenna 30/30 HP\nSaves: Fort +1\nStatus: Healthy\nOath (sworn): Yes.\n[/CORE]' }] })
        const d = deps(['Action: commit({"core": [{"id": "Vell_NPC::1", "field": "Combat Profile", "content": "Fenna 40/40 HP\\nSaves: Fort +2\\nStatus: Healthy"}]})'], {
            store,
            settings: async () => ({ ...CARTRIDGE, npcCoreSections: [{ name: 'Species' }, { name: 'Oath (sworn)' }] }),
        })
        d.ownership.get = async () => ['Vell_NPC']
        const report = await runAgentPass('chat-1', 'u1', d)
        expect(report.outcome).toBe('committed')
        expect(entriesOf('Vell_NPC')[0]!.content).toBe('[CORE]\nSpecies: Human\nCombat Profile: Fenna 40/40 HP\nSaves: Fort +2\nStatus: Healthy\nOath (sworn): Yes.\n[/CORE]')
    })

    it('says nothing mechanical when the memo has neither block, and nothing of modules without the cartridge', async () => {
        const quiet = deps(['Action: done()'], { settings: async () => CARTRIDGE, memo: async () => '[TIME]\nDay 2\n[/TIME]' })
        await runAgentPass('chat-1', 'u1', quiet)
        expect(prompt(quiet)[0]!.content).not.toContain('## COMBAT PROFILE')
        // The legacy's quests section opens the message (72c); nothing mechanical before the narrative.
        expect(prompt(quiet)[1]!.content.startsWith('## ACTIVE QUESTS\nNone\n\n## NARRATIVE')).toBe(true)
        const bare = deps(['Action: done()'])
        await runAgentPass('chat-1', 'u1', bare)
        expect(prompt(bare)[0]!.content).not.toContain('WHAT EACH CATEGORY RECORDS')
        expect(prompt(bare)[0]!.content).not.toContain('## AVAILABLE RECORD CATEGORIES')
        expect(prompt(bare)[1]!.content.startsWith('## ACTIVE QUESTS\nNone\n\n## NARRATIVE')).toBe(true)
    })

    it('costs the pass only those words when the cartridge or the memo will not read', async () => {
        const warnings: string[] = []
        const d = deps(['Action: done()'], {
            settings: async () => { throw new Error('settings down') },
            memo: async () => { throw new Error('memo down') },
            log: { info: () => undefined, warn: (m: string) => { warnings.push(m) } },
        })
        const report = await runAgentPass('chat-1', 'u1', d)
        expect(report.outcome).toBe('no-commit')
        expect(prompt(d)[1]!.content).toContain('## NARRATIVE')
        expect(prompt(d)[1]!.content).not.toContain('## COMBAT')
        // An unread cartridge sends no category list: it would say none is enabled.
        expect(prompt(d)[0]!.content).not.toContain('## AVAILABLE RECORD CATEGORIES')
        expect(warnings.join('\n')).toContain('settings down')
        expect(warnings.join('\n')).toContain('memo down')
    })
})

describe('what the pass reads', () => {
    it('hides the user\'s other campaigns from the agent', async () => {
        const { store } = makeStore({
            Other_Events: [{ uid: '1', comment: 'Another story', content: 'Wrenna was taken.' }],
        })
        const d = deps(['Action: grep_lore("Wrenna")', 'Action: commit({})'], { store })
        d.others.push('Other_Events')

        const report = await runAgentPass('chat-1', 'u1', d)
        const observed = report.steps.filter((step) => step.kind === 'observation')
        expect(observed[0]).toMatchObject({ text: expect.stringContaining('No lore entry mentions') })
    })

    it('hides the campaign\'s own _World book: reports are the narrator\'s, not lore to edit', async () => {
        const { store } = makeStore({
            Vell_World: [{ uid: '1', comment: 'Day 2', content: 'Wrenna\'s town riots.' }],
            Vell_NPC: [{ uid: '1', comment: 'Wrenna', content: 'A lamplighter.' }],
        })
        const d = deps(['Action: grep_lore("Wrenna")', 'Action: commit({})'], { store })
        d.owned.push('Vell_World', 'Vell_NPC')

        const report = await runAgentPass('chat-1', 'u1', d)
        const observed = report.steps.filter((step) => step.kind === 'observation')
        expect(observed[0]!.text).toContain('Vell_NPC::1')
        expect(observed[0]!.text).not.toContain('Vell_World')
        // Nor is World offered as a category to file under.
        const system = (d.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0][0].content as string
        expect(system).not.toMatch(/\bWorld\b/)
    })

    it('hides the campaign\'s _Skeleton book too: seeds are World Progression\'s, read by nobody else (33b)', async () => {
        const { store } = makeStore({
            Vell_Skeleton: [{ uid: '1', comment: 'LOCATION: Harrowgate', content: '[Day 0 Baseline]\nWrenna founded it.' }],
            Vell_NPC: [{ uid: '1', comment: 'Wrenna', content: 'A lamplighter.' }],
        })
        const d = deps(['Action: grep_lore("Wrenna")', 'Action: commit({})'], { store })
        d.owned.push('Vell_Skeleton', 'Vell_NPC')

        const report = await runAgentPass('chat-1', 'u1', d)
        const observed = report.steps.filter((step) => step.kind === 'observation')
        expect(observed[0]!.text).toContain('Vell_NPC::1')
        expect(observed[0]!.text).not.toContain('Vell_Skeleton')
        const system = (d.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0][0].content as string
        expect(system).not.toMatch(/\bSkeleton\b/)
    })

    it('reads the whole chat by default', async () => {
        // A first pass over an established campaign wants everything. The agent
        // had been shown the last dozen messages and missed the days before.
        const seen: number[] = []
        const d = deps(['Action: commit({})'], {
            narrative: async (_chat, _who, lookback) => { seen.push(lookback); return 'Prose.' },
        })
        await runAgentPass('chat-1', 'u1', d)
        expect(seen).toEqual([0])
    })

    it('passes a window through when one is set', async () => {
        const seen: number[] = []
        const d = deps(['Action: commit({})'], {
            lookback: 40,
            narrative: async (_chat, _who, lookback) => { seen.push(lookback); return 'Prose.' },
        })
        await runAgentPass('chat-1', 'u1', d)
        expect(seen).toEqual([40])
    })
})

describe('the index the pass gathers', () => {
    const systemOf = (d: AgentPassDeps) =>
        String((d.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0][0].content)

    it('puts the campaign\'s own entry titles in front of the model', async () => {
        const { store } = makeStore({
            Vell_Events: [{ comment: 'Day Three — Road to Hallen' }],
            Vell_Characters: [{ comment: 'Wrenna' }, { comment: 'Lissa' }],
        })
        const d = deps(['Action: commit({})'], { store })
        d.owned.push('Vell_Events', 'Vell_Characters')

        await runAgentPass('chat-1', 'u1', d)

        const system = systemOf(d)
        expect(system).toContain('"Day Three — Road to Hallen" → Vell_Events::1')
        expect(system).toContain('"Wrenna" → Vell_Characters::1')
        expect(system).toContain('"Lissa" → Vell_Characters::2')
    })

    it('tells the model which categories it already files under', async () => {
        // Vell_Secrets matches the naming pattern and was never recorded as
        // ours, so it is adoptable, not owned (9b) — the writer refuses it.
        // Offering "Secrets" as a category would send the model at a book that
        // then rejects the entry, which is worse than not offering it.
        const { store } = makeStore({
            Vell_Characters: [{ comment: 'Wrenna' }],
            Vell_Events: [{ comment: 'Day Three' }],
            Vell_Secrets: [{ comment: 'Not ours' }],
            'My World Bible': [{ comment: 'The Gods' }],
        })
        const d = deps(['Action: commit({})'], { store })
        d.owned.push('Vell_Characters', 'Vell_Events')

        await runAgentPass('chat-1', 'u1', d)

        const system = systemOf(d)
        expect(system).toContain('category you already use: Characters, Events.')
        // It stays in "books you can read" — the agent reads it, it just may
        // not file anything there.
        expect(system).toContain('Vell_Secrets')
        expect(system).not.toMatch(/category you already use:[^\n]*Secrets/)
    })

    it('carries each entry\'s address, not only its title', async () => {
        const { store } = makeStore({ Vell_Events: [{ uid: 'abc-123', comment: 'Day Three' }] })
        const d = deps(['Action: commit({})'], { store })
        d.owned.push('Vell_Events')

        await runAgentPass('chat-1', 'u1', d)

        expect(systemOf(d)).toContain('"Day Three" → Vell_Events::abc-123')
    })

    it('leaves out books the campaign does not own', async () => {
        // A hand-written world bible is read by the tools but never written to,
        // and an adoptable book is refused at the write (9b). Listing either
        // under "what the books already hold" promises an update we then refuse.
        const { store } = makeStore({
            Vell_Events: [{ comment: 'Day Three' }],
            'My World Bible': [{ comment: 'The Gods of Hallen' }],
            Vell_Adoptable: [{ comment: 'Not ours yet' }],
        })
        const d = deps(['Action: commit({})'], { store })
        d.owned.push('Vell_Events')

        await runAgentPass('chat-1', 'u1', d)

        const system = systemOf(d)
        expect(system).toContain('Day Three')
        expect(system).not.toContain('The Gods of Hallen')
        expect(system).not.toContain('Not ours yet')
    })

    it('carries on when a book will not read', async () => {
        // An index is context. Losing one book's titles costs the model some
        // awareness; failing the pass over it costs the user the whole run.
        const { store } = makeStore({
            Vell_Events: [{ comment: 'Day Three' }],
            Vell_Broken: [{ comment: 'Unreachable' }],
        })
        const listEntries = store.listEntries.bind(store)
        store.listEntries = async (id) => {
            if (id === 'b2') throw new Error('gone')
            return listEntries(id)
        }
        const d = deps(['Action: commit({})'], { store })
        d.owned.push('Vell_Events', 'Vell_Broken')

        const report = await runAgentPass('chat-1', 'u1', d)

        expect(report.outcome).toBe('committed')
        expect(systemOf(d)).toContain('Day Three')
    })

    it('says nothing about an index on a first pass', async () => {
        const d = deps(['Action: commit({})'])
        await runAgentPass('chat-1', 'u1', d)
        expect(systemOf(d)).toContain('no books of its own yet')
    })
})

describe('what the model is told', () => {
    const prompt = (over = {}) =>
        buildAgentPrompt({ prefix: 'Vell', narrative: 'Prose.', bookNames: ['Vell_NPC'], maxTurns: 10, ...over })

    it('names the campaign and its books', () => {
        const system = prompt()[0]!.content
        expect(system).toContain('"Vell"')
        expect(system).toContain('Vell_NPC')
    })

    it('says so when there are no books yet', () => {
        expect(prompt({ bookNames: [] })[0]!.content).toContain('(none yet)')
    })

    it('tells the model not to manage activation', () => {
        // The decision, in the prompt. The legacy spends forty lines asking for
        // curation this build discards — asking for work we throw away is the
        // exact class of bug the stock-prompt audit exists to find.
        expect(prompt()[0]!.content).toMatch(/active.*handled for you/i)
    })

    it('puts the user\'s instruction after the narrative and makes it the task', () => {
        // Multihog's 💬 for the agent: the legacy's `## INSTRUCTION` section.
        const user = prompt({ instruction: 'Add an entry for the innkeeper.' })[1]!.content
        expect(user).toContain('## INSTRUCTION\n\nAdd an entry for the innkeeper.')
        expect(user.indexOf('## INSTRUCTION')).toBeGreaterThan(user.indexOf('## NARRATIVE'))
        expect(user).toMatch(/context for it, not a second task/)
        expect(user).not.toContain('Bring the lorebooks up to date')
        // Without one, or with a blank one, the pressed pass's brief as before.
        expect(prompt()[1]!.content).toContain('Bring the lorebooks up to date')
        expect(prompt({ instruction: '  ' })[1]!.content).toContain('Bring the lorebooks up to date')
    })

    it('tells the model how many turns it has, so it can plan', () => {
        // The first live pass spent every turn researching and committed
        // nothing. It had no way to know it was on a clock.
        expect(prompt({ maxTurns: 7 })[0]!.content).toContain('You have 7 turns')
    })

    it('says a campaign with no books of its own is normal', () => {
        // Otherwise a first pass looks like a misconfiguration: the agent finds
        // only foreign books and the user assumes something is missing.
        expect(prompt({ bookNames: ['Someone elses book'] })[0]!.content)
            .toMatch(/no books of its own yet/)
    })

    it('does not teach an entry-address shape, because the host picks it', () => {
        // Live, a uid came back as a GUID. An example like "BookName::4" tells
        // the model to expect small integers and invent them.
        const system = prompt()[0]!.content
        expect(system).not.toContain('::4')
        expect(system).toContain('Copy them exactly; do not invent one.')
    })

    it('shows the shape of every commit field, not just its name', () => {
        // Three live passes invented their own shapes and lost the whole
        // commit. The prompt had listed the field names and nothing else.
        const system = prompt()[0]!.content
        expect(system).toContain('"update": [{"id": "BookName::entry-id", "content": "text to add", "msg": 44}]')
        expect(system).toContain('Every commit field is a LIST')
    })

    it('shows msg in the worked example and says what it is for', () => {
        // Naming a field without showing its shape is what lost three live
        // commits (9n). And without the explanation the model reasonably reads
        // "msg" as the newest message, which is the whole bug.
        const system = prompt()[0]!.content
        expect(system).toContain('"msg": 43')
        expect(system).toContain('WHICH MESSAGE the thing happened in')
        expect(system).toContain('NOT the latest one you were shown')
    })

    it('tells the model the narrative lines are numbered, and to cite them', () => {
        const user = prompt({ narrative: '[#43] GM: She looks away.' })[1]!.content
        expect(user).toContain('[#43]')
        expect(user).toContain('cite that number as `msg`')
    })

    it('names the categories already in use, so a synonym does not build a book', () => {
        // Live, one commit produced Vell_NPC beside the Vell_Characters it
        // had been shown in the same prompt, and Vell_Event beside
        // Vell_Events. Nothing had told it which categories existed.
        const system = prompt({
            index: 'Vell_Characters (1 entry):\n  "Wrenna" → Vell_Characters::u1',
            categories: ['Characters', 'Events'],
        })[0]!.content
        expect(system).toContain('File new entries under a category you already use: Characters, Events.')
        expect(system).toContain('The category becomes the book name')
    })

    it('says nothing about categories when the campaign has none', () => {
        expect(prompt()[0]!.content).not.toContain('category you already use')
    })

    it('tells the model the indexed addresses are the only ones there are', () => {
        // A pass burned a turn on read_entry("Vell_World::the-oath-mark"),
        // a slug it invented, having already been shown the real address.
        const system = prompt({ index: 'Vell_World (1 entry):\n  "Hallen" → Vell_World::u1' })[0]!.content
        expect(system).toMatch(/only ones that exist/)
        expect(system).toMatch(/do not look them up again or shorten them to a slug/)
    })

    it('shows the model what its books already hold', () => {
        // The pass that prompted this used two of ten turns: one search, then a
        // commit revising the five entries that search returned. It was handed
        // book names and no contents, so it could not see what was absent.
        const system = prompt({
            index: 'Vell_Events (1 entry):\n  "Day Three" → Vell_Events::u1',
        })[0]!.content
        expect(system).toContain('WHAT THE BOOKS ALREADY HOLD')
        expect(system).toContain('"Day Three" → Vell_Events::u1')
    })

    it('asks for the difference between the story and the books, not a revision pass', () => {
        const system = prompt({ index: 'Vell_Events (1 entry):\n  "Day Three" → Vell_Events::u1' })[0]!.content
        expect(system).toMatch(/DIFFERENCE between the two/)
        expect(system).toMatch(/RECORD it/)
    })

    it('warns that committing on turn two is as wasteful as never committing', () => {
        // 9j over-corrected into "two or three lookups, then commit". That
        // produced a two-turn pass over a campaign with days of story in it.
        const system = prompt()[0]!.content
        expect(system).toContain('committing on turn two')
        expect(system).not.toContain('two or three lookups, then commit')
    })

    it('says a search result is not an inventory', () => {
        // grep_lore caps at 8 hits and says so, and the model treated the cap
        // as the lore anyway.
        expect(prompt()[0]!.content).toMatch(/not an inventory/)
    })

    it('falls back to the first-pass wording when there is no index', () => {
        const system = prompt()[0]!.content
        expect(system).toContain('no books of its own yet')
        expect(system).not.toContain('WHAT THE BOOKS ALREADY HOLD')
    })

    it('asks for the whole narrative, not its most recent part', () => {
        expect(prompt()[1]!.content).toMatch(/WHOLE of that narrative/)
    })

    it('shows a shape for every field the commit reader accepts', () => {
        // The three live failures were three *different* fields. Spot-checking
        // one example leaves the others free to go missing, so walk the lot:
        // every name `normalizeCommit` reads must appear in the prompt opening
        // a list, not merely be mentioned somewhere in the prose.
        const system = prompt()[0]!.content
        for (const field of COMMIT_FIELDS) {
            expect(system).toContain(`"${field}": [`)
        }
    })

    it('shows the rel shape only while the relationship section is sent (65-bis)', async () => {
        // A live pass without it named the NPCs the way its records did and
        // lost both starting values.
        const withSection = prompt({ relationshipSection: '## NPC RELATIONSHIPS\nset them' })[0]!.content
        expect(withSection).toContain('"rel": [{"id": "BookName::entry-id, or the NPC\'s name when this commit records them",')
        expect(withSection.indexOf('"rel": [')).toBeLessThan(withSection.indexOf('"consolidate": ['))
        expect(prompt()[0]!.content).not.toContain('"rel": [')
    })

    it('tells the model to use the full address, never the bare id', () => {
        expect(prompt()[0]!.content).toMatch(/FULL address.*never the bare entry id/s)
    })

    it('carries the narrative', () => {
        expect(prompt({ narrative: 'They reached the Rest.' })[1]!.content).toContain('They reached the Rest.')
    })
})


/** An in-memory stand-in for the snapshot file. */
function makeHistory() {
    const passes: LorePassSnapshot[] = []
    return {
        passes,
        history: {
            record: async (_chat: string, snapshot: LorePassSnapshot) => { passes.unshift(snapshot) },
            latest: async () => passes[0] ?? null,
            drop: async () => { passes.shift() },
        },
    }
}

describe('making a pass undoable', () => {
    it('records the books as they were before the pass wrote', async () => {
        const { store } = makeStore({ Vell_NPC: [{ uid: '1', content: 'She keeps rope.', comment: 'Lissa' }] })
        const { passes, history } = makeHistory()
        const d = deps(
            ['Action: commit({"update": [{"id": "Vell_NPC::1", "content": "Now wary."}]})'],
            { store, history },
        )
        d.owned.push('Vell_NPC')

        await runAgentPass('chat-1', 'u1', d)

        expect(passes).toHaveLength(1)
        expect(passes[0]!.books).toEqual([
            { name: 'Vell_NPC', entries: [{ uid: '1', key: [], content: 'She keeps rope.', comment: 'Lissa' }] },
        ])
    })

    it('records which books the pass created, so an undo may delete them', async () => {
        const { store } = makeStore({})
        const { passes, history } = makeHistory()
        const d = deps(
            ['Action: commit({"record": [{"label": "Lissa", "category": "NPC", "keys": ["Lissa"], "content": "Rope."}]})'],
            { store, history },
        )

        await runAgentPass('chat-1', 'u1', d)

        expect(passes[0]!.createdBooks).toEqual(['Vell_NPC'])
        expect(passes[0]!.createdEntries).toEqual(['Vell_NPC::1'])
    })

    it('records nothing for a pass that never committed', async () => {
        // There is nothing to undo, and a snapshot would let an undo remove
        // work a *later* pass did.
        const { passes, history } = makeHistory()
        const d = deps(['I am still thinking about it.'], { history })

        await runAgentPass('chat-1', 'u1', d)

        expect(passes).toEqual([])
    })

    it('does not fail a pass whose snapshot could not be stored', async () => {
        // The pass wrote. Reporting it as failed would be a lie, and losing
        // the write to a bookkeeping error would be worse.
        const { store } = makeStore({})
        const d = deps(
            ['Action: commit({"record": [{"label": "Lissa", "category": "NPC", "keys": [], "content": "Rope."}]})'],
            {
                store,
                history: {
                    record: async () => { throw new Error('disk full') },
                    latest: async () => null,
                    drop: async () => {},
                },
            },
        )

        const report = await runAgentPass('chat-1', 'u1', d)

        expect(report.outcome).toBe('committed')
        expect(report.problems.join(' ')).toContain('could not be made undoable')
    })
})

describe('undoing a pass', () => {
    it('puts back an entry the pass changed', async () => {
        const { store, entriesOf } = makeStore({ Vell_NPC: [{ uid: '1', content: 'She keeps rope.' }] })
        const { history } = makeHistory()
        const d = deps(
            ['Action: commit({"update": [{"id": "Vell_NPC::1", "content": "Now wary."}]})'],
            { store, history },
        )
        d.owned.push('Vell_NPC')

        await runAgentPass('chat-1', 'u1', d)
        expect(entriesOf('Vell_NPC')[0]!.content).toContain('Now wary.')

        const report = await undoAgentPass('chat-1', 'u1', d)

        expect(entriesOf('Vell_NPC')[0]!.content).toBe('She keeps rope.')
        expect(report.undone).toBe(true)
    })

    it('removes an entry the pass created and deletes the book it made', async () => {
        const { store } = makeStore({})
        const { history } = makeHistory()
        const deleted: string[] = []
        store.deleteBook = async (id: string) => { deleted.push(id) }
        const d = deps(
            ['Action: commit({"record": [{"label": "Lissa", "category": "NPC", "keys": [], "content": "Rope."}]})'],
            { store, history },
        )

        await runAgentPass('chat-1', 'u1', d)
        await undoAgentPass('chat-1', 'u1', d)

        expect(deleted).toHaveLength(1)
    })

    it('restores the ownership list, so a deleted book is not still owned', async () => {
        const { store } = makeStore({})
        const { history } = makeHistory()
        store.deleteBook = async () => {}
        const d = deps(
            ['Action: commit({"record": [{"label": "Lissa", "category": "NPC", "keys": [], "content": "Rope."}]})'],
            { store, history },
        )

        await runAgentPass('chat-1', 'u1', d)
        expect(d.owned).toContain('Vell_NPC')

        await undoAgentPass('chat-1', 'u1', d)

        expect(d.owned).not.toContain('Vell_NPC')
    })

    it('undoes one pass at a time', async () => {
        const { store, entriesOf } = makeStore({ Vell_NPC: [{ uid: '1', content: 'Original.' }] })
        const { history } = makeHistory()
        const d = deps(
            ['Action: commit({"update": [{"id": "Vell_NPC::1", "content": "First."}]})'],
            { store, history },
        )
        d.owned.push('Vell_NPC')
        await runAgentPass('chat-1', 'u1', d)

        const second = deps(
            ['Action: commit({"update": [{"id": "Vell_NPC::1", "content": "Second."}]})'],
            { store, history },
        )
        second.owned.push('Vell_NPC')
        await runAgentPass('chat-1', 'u1', second)

        await undoAgentPass('chat-1', 'u1', d)

        // Back to after the first pass, not back to the beginning.
        expect(entriesOf('Vell_NPC')[0]!.content).toContain('First.')
        expect(entriesOf('Vell_NPC')[0]!.content).not.toContain('Second.')
    })

    it('keeps the snapshot when the undo could not be finished', async () => {
        // Dropping it first would make a half-finished undo unretryable: the
        // books are between two states and the only record of the first one is
        // gone. Undoing twice is harmless — the second finds nothing to do.
        const { store } = makeStore({ Vell_NPC: [{ uid: '1', content: 'Original.' }] })
        const { passes, history } = makeHistory()
        const d = deps(
            ['Action: commit({"update": [{"id": "Vell_NPC::1", "content": "Changed."}]})'],
            { store, history },
        )
        d.owned.push('Vell_NPC')
        await runAgentPass('chat-1', 'u1', d)

        d.ownership.set = async () => { throw new Error('storage went away') }
        await expect(undoAgentPass('chat-1', 'u1', d)).rejects.toThrow('storage went away')

        expect(passes).toHaveLength(1)
    })

    it('says plainly when there is nothing to undo', async () => {
        const { history } = makeHistory()
        const report = await undoAgentPass('chat-1', 'u1', deps([], { history }))

        expect(report.undone).toBe(false)
        expect(report.summary).toContain('nothing to undo')
    })

    it('says so when the build keeps no history at all', async () => {
        const report = await undoAgentPass('chat-1', 'u1', deps([]))
        expect(report.summary).toContain('does not keep a history')
    })
})


describe('rolling a pass back when its reply is swiped away', () => {
    /** A pass that wrote, tied to message `msg-1`. */
    async function passOn(messageId: string | undefined) {
        const { store, entriesOf } = makeStore({ Vell_NPC: [{ uid: '1', content: 'Original.' }] })
        const { passes, history } = makeHistory()
        const d = deps(
            ['Action: commit({"update": [{"id": "Vell_NPC::1", "content": "Changed."}]})'],
            { store, history, latestMessageId: async () => messageId },
        )
        d.owned.push('Vell_NPC')
        await runAgentPass('chat-1', 'u1', d)
        return { d, passes, entriesOf }
    }

    it('records which reply the pass was built on', async () => {
        const { passes } = await passOn('msg-1')
        expect(passes[0]!.messageId).toBe('msg-1')
    })

    it('undoes the pass when that reply is the one being replaced', async () => {
        const { d, entriesOf } = await passOn('msg-1')
        expect(entriesOf('Vell_NPC')[0]!.content).toContain('Changed.')

        const report = await undoAgentPassForMessage('chat-1', 'msg-1', 'u1', d)

        expect(report?.undone).toBe(true)
        expect(entriesOf('Vell_NPC')[0]!.content).toBe('Original.')
    })

    it('leaves the pass alone when a different reply is replaced', async () => {
        // A swipe must never quietly revert lore some other turn produced.
        const { d, entriesOf } = await passOn('msg-1')

        expect(await undoAgentPassForMessage('chat-1', 'msg-2', 'u1', d)).toBeNull()
        expect(entriesOf('Vell_NPC')[0]!.content).toContain('Changed.')
    })

    it('does nothing for a pass that could not name its reply', async () => {
        // An older snapshot, or a pass over an empty chat. Undoing on a
        // guess is worse than not undoing.
        const { d, entriesOf } = await passOn(undefined)

        expect(await undoAgentPassForMessage('chat-1', 'msg-1', 'u1', d)).toBeNull()
        expect(entriesOf('Vell_NPC')[0]!.content).toContain('Changed.')
    })

    it('does nothing when the generation names no message at all', async () => {
        const { d } = await passOn('msg-1')
        expect(await undoAgentPassForMessage('chat-1', undefined, 'u1', d)).toBeNull()
    })

    it('does nothing when neither the pass nor the swipe names a message', async () => {
        // Both absent must not read as "these match". On a host that never
        // reports a message id, that would make every swipe undo the newest
        // pass — lore silently reverted by a turn that had nothing to do with
        // it, which is the failure this whole check exists to prevent.
        const { d, entriesOf } = await passOn(undefined)

        expect(await undoAgentPassForMessage('chat-1', undefined, 'u1', d)).toBeNull()
        expect(entriesOf('Vell_NPC')[0]!.content).toContain('Changed.')
    })

    it('only ever considers the newest pass', async () => {
        // Undoing an older one would leave the newer pass's writes standing on
        // top of a rolled-back campaign.
        const { store, entriesOf } = makeStore({ Vell_NPC: [{ uid: '1', content: 'Original.' }] })
        const { history } = makeHistory()

        const first = deps(
            ['Action: commit({"update": [{"id": "Vell_NPC::1", "content": "First."}]})'],
            { store, history, latestMessageId: async () => 'msg-1' },
        )
        first.owned.push('Vell_NPC')
        await runAgentPass('chat-1', 'u1', first)

        const second = deps(
            ['Action: commit({"update": [{"id": "Vell_NPC::1", "content": "Second."}]})'],
            { store, history, latestMessageId: async () => 'msg-2' },
        )
        second.owned.push('Vell_NPC')
        await runAgentPass('chat-1', 'u1', second)

        expect(await undoAgentPassForMessage('chat-1', 'msg-1', 'u1', first)).toBeNull()
        expect(entriesOf('Vell_NPC')[0]!.content).toContain('Second.')
    })

    it('does not fail a pass whose reply could not be read', async () => {
        const { store } = makeStore({})
        const { passes, history } = makeHistory()
        const d = deps(
            ['Action: commit({"record": [{"label": "A", "category": "NPC", "keys": [], "content": "x"}]})'],
            { store, history, latestMessageId: async () => { throw new Error('chat gone') } },
        )

        const report = await runAgentPass('chat-1', 'u1', d)

        expect(report.outcome).toBe('committed')
        expect(passes[0]!.messageId).toBeUndefined()
    })
})


describe('undoing the watermark a pass advanced', () => {
    it('records where the watermark stood before the pass ran', async () => {
        const { store } = makeStore({ Vell_NPC: [{ uid: '1', content: 'Original.' }] })
        const { passes, history } = makeHistory()
        const d = deps(
            ['Action: commit({"update": [{"id": "Vell_NPC::1", "content": "Changed."}]})'],
            { store, history, watermark: 32 },
        )
        d.owned.push('Vell_NPC')

        await runAgentPass('chat-1', 'u1', d)

        expect(passes[0]!.watermark).toBe(32)
    })

    it('hands that watermark back when the pass is undone', async () => {
        // The rolled-back pass read a span of story and wrote lore for all of
        // it. The rollback deletes that lore, so the next pass has to read the
        // *same* span again — starting partway through it leaves the replies
        // before that point covered by no pass at all, ever.
        const { store } = makeStore({ Vell_NPC: [{ uid: '1', content: 'Original.' }] })
        const { history } = makeHistory()
        const d = deps(
            ['Action: commit({"update": [{"id": "Vell_NPC::1", "content": "Changed."}]})'],
            { store, history, watermark: 32, latestMessageId: async () => 'msg-40' },
        )
        d.owned.push('Vell_NPC')
        await runAgentPass('chat-1', 'u1', d)

        const report = await undoAgentPassForMessage('chat-1', 'msg-40', 'u1', d)

        expect(report?.watermark).toBe(32)
    })

    it('says nothing about a watermark a snapshot never recorded', async () => {
        // Snapshots written before this existed. The caller falls back to
        // walking the watermark back a cycle rather than guessing.
        const { store } = makeStore({ Vell_NPC: [{ uid: '1', content: 'Original.' }] })
        const { history } = makeHistory()
        const d = deps(
            ['Action: commit({"update": [{"id": "Vell_NPC::1", "content": "Changed."}]})'],
            { store, history, latestMessageId: async () => 'msg-40' },
        )
        d.owned.push('Vell_NPC')
        await runAgentPass('chat-1', 'u1', d)

        expect((await undoAgentPassForMessage('chat-1', 'msg-40', 'u1', d))?.watermark).toBeUndefined()
    })
})

describe('the dials a pass takes from preferences', () => {
    it('carries the turn budget, the lookback and the watermark', () => {
        // The mutation that deleted `maxTurns` from `backend.ts` left the whole
        // suite green. A setting that saves, clamps and displays correctly and
        // never reaches the agent is invisible from every other test.
        expect(
            agentPassOptions(
                { agentLookback: 40, agentMaxTurns: 3, agentWatermarks: { 'chat-1': 17 } },
                'chat-1',
            ),
        ).toEqual({ lookback: 40, maxTurns: 3, watermark: 17, connectionId: undefined })
    })

    it('falls back to the loop\'s own budget rather than inventing a second number', () => {
        expect(agentPassOptions({}, 'chat-1').maxTurns).toBe(DEFAULT_MAX_TURNS)
    })

    it('reads the whole chat and starts at zero when nothing is stored', () => {
        expect(agentPassOptions({}, 'chat-1')).toEqual({
            lookback: 0,
            maxTurns: DEFAULT_MAX_TURNS,
            watermark: 0,
            connectionId: undefined,
        })
    })

    it('carries the connection the agent should run on', () => {
        // The mutation that removed this from backend.ts left the whole suite
        // green, exactly as the turn budget did before Phase 13. That file is
        // the host entry point and has no tests, so the mapping lives here.
        expect(agentPassOptions({ agentConnectionId: 'fast-small' }, 'chat-1').connectionId).toBe('fast-small')
    })

    it('leaves the connection to the host when none is chosen', () => {
        expect(agentPassOptions({}, 'chat-1').connectionId).toBeUndefined()
        expect(agentPassOptions({ agentConnectionId: '' }, 'chat-1').connectionId).toBeUndefined()
    })

    it('takes the watermark for this chat, not another one', () => {
        // Two campaigns interleave in one preferences file.
        const prefs = { agentWatermarks: { 'chat-1': 9, 'chat-2': 44 } }
        expect(agentPassOptions(prefs, 'chat-2').watermark).toBe(44)
        expect(agentPassOptions(prefs, 'chat-3').watermark).toBe(0)
    })
})

describe('announcing that a pass has begun', () => {
    it('announces itself, so every caller gets it without remembering to', async () => {
        // The bug this exists to prevent: Phase 14 hung the Stop button on the
        // "a pass is running now" notice, and that notice was raised by the
        // automatic caller only — so a pass the user *pressed* never announced
        // itself and could not be stopped. The tracker has never had that bug,
        // because its pass announces itself rather than trusting its callers.
        const onPassStart = vi.fn()
        await runAgentPass('chat-1', 'u1', deps(['Action: commit({})'], { onPassStart }))

        expect(onPassStart).toHaveBeenCalledTimes(1)
        expect(onPassStart).toHaveBeenCalledWith(
            expect.objectContaining({ chatId: 'chat-1', userId: 'u1', trigger: 'manual' }),
        )
    })

    it('calls a pass manual unless told otherwise', async () => {
        // The button is the common case and the one a missing trigger should
        // read as; an unannounced automatic pass is the rarer mistake.
        const onPassStart = vi.fn()
        await runAgentPass('chat-1', 'u1', deps(['Action: commit({})'], { onPassStart }))
        expect(onPassStart.mock.calls[0]![0].trigger).toBe('manual')
    })

    it('carries the automatic trigger through, so the panel can word it', async () => {
        const onPassStart = vi.fn()
        await runAgentPass(
            'chat-1',
            'u1',
            deps(['Action: commit({})'], { onPassStart, trigger: 'automatic' }),
        )
        expect(onPassStart.mock.calls[0]![0].trigger).toBe('automatic')
    })

    it('announces before it reads anything, so the button appears at once', async () => {
        // A pass that spends ten seconds reading books before it announces
        // itself is a pass the user cannot stop for ten seconds.
        const order: string[] = []
        const onPassStart = vi.fn(() => { order.push('announced') })
        const base = deps(['Action: commit({})'], { onPassStart })

        await runAgentPass('chat-1', 'u1', {
            ...base,
            ownership: {
                ...base.ownership,
                get: async () => { order.push('read ownership'); return [] },
            },
            narrative: async () => { order.push('read narrative'); return 'x' },
        })

        expect(order[0]).toBe('announced')
    })

    it('stamps the announcement with a real time', async () => {
        const onPassStart = vi.fn()
        await runAgentPass('chat-1', 'u1', deps(['Action: commit({})'], { onPassStart }))
        const { at } = onPassStart.mock.calls[0]![0]
        expect(Number.isNaN(new Date(at).getTime())).toBe(false)
    })
})

describe('the connection field on a generation call', () => {
    it('names the connection when one is chosen', () => {
        expect(connectionField('fast-small')).toEqual({ connection_id: 'fast-small' })
    })

    it.each([['nothing', undefined], ['an empty choice', '']])(
        'sends no field at all for %s',
        (_label, id) => {
            // Not an empty string: that is an id nothing will match, and the
            // host must pick exactly as it did before this setting existed.
            expect(connectionField(id)).toEqual({})
            expect('connection_id' in connectionField(id)).toBe(false)
        },
    )
})

describe('carrying the turn number into what a pass writes', () => {
    it('stamps the turn the model cited, not the newest one the pass read', async () => {
        // End to end: the numbers reach the model in the narrative, come back
        // in the commit, and get checked against what was actually read.
        const { store, entriesOf } = makeStore({})
        const d = deps(
            ['Action: commit({"record": [{"label": "Betrayal", "category": "NPC", "content": "Sold them out.", "msg": 43}]})'],
            {
                store,
                numberedNarrative: async () => ({
                    narrative: '[#43] GM: She sells them out.\n\n[#45] GM: Rain on the docks.',
                    readRange: [43, 45],
                }),
            },
        )
        await runAgentPass('chat-1', 'u1', d)

        const made = entriesOf('Vell_NPC').at(-1)
        expect(made?.comment).toBe('Betrayal') // 73a: the turn is on the prose alone
        expect(made?.content).toBe('[msg #43] Sold them out.')
    })

    it('shows the model a numbered narrative, so it has something to cite', async () => {
        const { store } = makeStore({})
        const generate = vi.fn(async () => 'Action: commit({})')
        await runAgentPass('chat-1', 'u1', deps([], {
            store,
            generate,
            numberedNarrative: async () => ({ narrative: '[#43] GM: She looks away.', readRange: [43] }),
        }))

        const shown = (generate.mock.calls as unknown as Array<[Array<{ content: string }>]>)[0]![0]
            .map((m) => m.content)
            .join('\n')
        expect(shown).toContain('[#43] GM: She looks away.')
    })

    it('stamps entries with the message the host reports', async () => {
        // The seam a mutation could quietly cut: the number is read in one
        // place and used in another.
        const { store, entriesOf } = makeStore({})
        const d = deps(['Action: commit({"record": [{"label": "Iron Syndicate", "category": "NPC", "content": "Smugglers.", "msg": 31}]})'], {
            store,
            numberedNarrative: async () => ({ narrative: '[#31] GM: Smugglers arrive.', readRange: [31] }),
        })
        await runAgentPass('chat-1', 'u1', d)

        expect(entriesOf('Vell_NPC').at(-1)?.comment).toBe('Iron Syndicate') // 73a: the turn is on the prose alone
        // And the body too: reading down an entry, every line says where it
        // came from, including the first.
        expect(entriesOf('Vell_NPC').at(-1)?.content).toBe('[msg #31] Smugglers.')
    })

    it('writes the entry unstamped rather than not at all when there is no number', async () => {
        const { store, entriesOf } = makeStore({})
        const d = deps(['Action: commit({"record": [{"label": "Iron Syndicate", "category": "NPC"}]})'], {
            store,
            numberedNarrative: async () => ({ narrative: 'GM: Smugglers arrive.', readRange: [] }),
        })
        await runAgentPass('chat-1', 'u1', d)

        expect(entriesOf('Vell_NPC').at(-1)?.comment).toBe('Iron Syndicate')
    })

    it('still writes when the host throws while being asked for the number', async () => {
        // Never fatal, like the message id beside it: an entry with no stamp is
        // still an entry.
        const { store, entriesOf } = makeStore({})
        const d = deps(['Action: commit({"record": [{"label": "Iron Syndicate", "category": "NPC"}]})'], {
            store,
            numberedNarrative: async () => { throw new Error('host unreachable') },
        })
        const report = await runAgentPass('chat-1', 'u1', d)

        expect(report.outcome).toBe('committed')
        expect(entriesOf('Vell_NPC').at(-1)?.comment).toBe('Iron Syndicate')
    })
})

describe('the terminal’s steps (71b)', () => {
    it('opens with a start, carries the loop’s steps, and closes with the summary and the time worked, or an error', async () => {
        const steps: Array<[string, string, number | undefined]> = []
        const step = (type: string, content: string, meta?: { seconds?: number }) => { steps.push([type, content, meta?.seconds]) }
        const { store } = makeStore({})
        await runAgentPass('chat-1', 'u1', deps(['Action: commit({"record": [{"label": "Lissa", "category": "NPC", "keys": ["Lissa"], "content": "A rope-keeper."}]})'], { store, step }))
        expect(steps[0]).toEqual(['start', 'Initializing Lorebook Agent…', undefined])
        expect(steps.map((s) => s[0])).toEqual(['start', 'thought', 'tool', 'finish'])
        expect(steps.at(-1)![1]).toMatch(/1 entry written.*\(1 turn\)/)
        expect(typeof steps.at(-1)![2]).toBe('number')
        steps.length = 0
        await runAgentPass('chat-1', 'u1', deps(['nonsense', 'nonsense', 'nonsense', 'nonsense'], { store: makeStore({}).store, step, instruction: 'Record Lissa.' }))
        expect(steps[0]).toEqual(['start', 'Initializing Lorebook Agent for your instruction…', undefined])
        expect(steps.at(-1)![0]).toBe('error')
    })
})

describe('what the agent is told, from the cartridge (72c)', () => {
    const FACTORY = FACTORY_CARTRIDGE_DEFAULTS as unknown as Record<string, string>
    const templates = { system: FACTORY.routerSystemPromptTemplate!, shared: FACTORY.routerAgentSharedContextTemplate! }
    const build = (over = {}) => buildAgentPrompt({ prefix: 'Vell', narrative: 'Prose.', bookNames: ['Vell_NPC'], maxTurns: 10, templates, ...over })

    it('opens with the system template less its activation sections, the campaign named', () => {
        const system = build()[0]!.content
        expect(system.startsWith('<player_character_safeguard>')).toBe(true)
        for (const gone of ['<basic_instructions>', '<context_maximization>', '<bravery>', 'Active Context saturated']) expect(system).not.toContain(gone)
        for (const kept of ['<formatting>', '<quests>', '<updating_entities>', '<timestamps>']) expect(system).toContain(kept)
        // `{{campaignRoot}}` is in the stripped opening alone; the host's own macros are left to it.
        expect(system).not.toContain('{{campaignRoot}}')
        expect(system).toContain('Always use the exact macro string `{{user}}`')
        // AdventureTime's own frame follows it.
        expect(system).toContain('You are the Researcher')
    })

    it('fills the shared context the way the legacy fills it, after the tools', () => {
        const system = build({
            moduleLines: ['- NPC: Named people.'],
            combatGuidance: '## COMBAT PROFILE\nPatch it.',
            relationshipSection: '## NPC RELATIONSHIPS\nSet them.',
            eligibleFields: ['Species', 'Flaws'],
            passRestriction: '- DIRECT PROMPT PASS: Species, Flaws',
            existingNpcNudge: '- the nudge',
        })[0]!.content
        expect(system).not.toContain('## MEMORY LIMIT')
        expect(system.indexOf('## PLAYER CHARACTER SAFEGUARD')).toBeGreaterThan(system.indexOf('Action: commit({ ... })'))
        expect(system).toContain('## NPC RELATIONSHIPS\nSet them.\n## PLAYER CHARACTER SAFEGUARD')
        expect(system).toContain('- Eligible commit.core fields this pass: Species, Flaws.\n- DIRECT PROMPT PASS: Species, Flaws\n- the nudge')
        expect(system).toContain('## COMBAT PROFILE\nPatch it.')
        expect(system).toContain('## FIELD INSTRUCTIONS\n- NPC: Named people.')
        expect(system).toContain('Campaign Root: "Vell"\n  NPCs -> "Vell_NPC"\n  Locations -> "Vell_LOC" (etc.)')
        // Each once: the template asked for them, so nothing is appended again.
        expect(system.split('## COMBAT PROFILE').length).toBe(2)
        expect(system.split('## NPC RELATIONSHIPS').length).toBe(2)
        expect(system).not.toContain('WHAT EACH CATEGORY RECORDS')
        // The static map guidance is stripped on every pass, as the legacy strips it; the skeleton rule stands.
        expect(system).not.toContain('## DUNGEON LOCATION OWNERSHIP')
        expect(system).toContain('## WORLD SKELETON (OFF-LIMITS)')
        expect(system).not.toMatch(/\{\{(?!user\}\}|char\}\})\w+\}\}/)
    })

    it('tells the model the fields a core edit may touch, and the appearance and equipment shapes', () => {
        const system = build({ eligibleFields: ['Combat Profile'] })[0]!.content
        expect(system).toContain('"core": [{"id": "BookName::entry-id", "field": "Combat Profile", "content": "fae"}]')
        expect(system).toContain('A "core" edit may touch these [CORE] fields this pass and no other: Combat Profile.')
        expect(system).toContain('"appearance": [{"id": "BookName::entry-id, an NPC\'s name, or {{user}}", "content": "new body text"}]')
        expect(system).toContain('"equipment": [')
        expect(build()[0]!.content).not.toContain('may touch these [CORE] fields')
    })

    it('appends the mapped-site note while the party is inside a map, and ends with the categories the pass may record', () => {
        const system = build({ location: { hierarchy: 'The Hollow, Gate', mappedSite: 'The Hollow' }, recordCategories: ['NPC', 'Characters'] })[0]!.content
        expect(system).toContain('## MAPPED SITE\nThe party is inside mapped site "The Hollow".')
        expect(system.trimEnd().endsWith('Categories not listed here are disabled and must not be used.')).toBe(true)
        expect(system).toContain('Routes: "NPC" -> "Vell_NPC", "Characters" -> "Vell_Characters".')
        expect(build({ location: { hierarchy: 'Trail' } })[0]!.content).not.toContain('## MAPPED SITE')
        expect(build()[0]!.content).not.toContain('## AVAILABLE RECORD CATEGORIES')
    })

    it('rewrites the templates\' examples to the cartridge\'s calendar and clock', () => {
        const system = build({ timeFormat: { useDdMmYyFormat: true } })[0]!.content
        expect(system).toContain('[DD/MM/YYYY, HH:MM AM/PM]')
        expect(system).not.toContain('[Day N, HH:MM AM/PM]')
        expect(build({ timeFormat: { use24hTime: true } })[0]!.content).toContain('[Day N, HH:MM]')
        expect(build()[0]!.content).toContain('[Day N, HH:MM AM/PM]')
    })

    it('falls back to 45b\'s own blocks when a template is blank or has no place for them', () => {
        const blank = build({ templates: { system: '', shared: '' }, moduleLines: ['- NPC: Named people.'], combatGuidance: '## COMBAT PROFILE\nPatch it.', relationshipSection: 'REL' })[0]!.content
        expect(blank.startsWith('You are the Researcher')).toBe(true)
        expect(blank).toContain('WHAT EACH CATEGORY RECORDS')
        expect(blank).toContain('- NPC: Named people.')
        expect(blank).toContain('## COMBAT PROFILE\nPatch it.')
        expect(blank).toContain('\nREL')
        const edited = build({ templates: { system: 'Mine.', shared: '## MY RULES\n- a rule' }, moduleLines: ['- NPC: Named people.'] })[0]!.content
        expect(edited.startsWith('Mine.\n\nYou are the Researcher')).toBe(true)
        expect(edited).toContain('## MY RULES\n- a rule')
        expect(edited).toContain('WHAT EACH CATEGORY RECORDS')
    })

    it('puts the party\'s place and the open quests before the narrative, as the legacy orders them', () => {
        const user = build({ location: { hierarchy: 'Khelt, The Anvil', mappedSite: 'Khelt' }, quests: '[QUESTS]\n- Find the key\n[/QUESTS]', mechanical: '## PARTY MECHANICAL STATE\nx\n\n' })[1]!.content
        expect(user.startsWith('## CURRENT LOCATION\nKhelt, The Anvil\nParsed from the narrator status footer and may lag.')).toBe(true)
        expect(user).toContain('## MAPPED SITE\nThe party is inside mapped site "Khelt".')
        expect(user.indexOf('## ACTIVE QUESTS\n[QUESTS]\n- Find the key\n[/QUESTS]')).toBeLessThan(user.indexOf('## PARTY MECHANICAL STATE'))
        expect(user.indexOf('## PARTY MECHANICAL STATE')).toBeLessThan(user.indexOf('## NARRATIVE'))
        expect(build({ location: {} })[1]!.content.startsWith('## CURRENT LOCATION\nUnknown\n')).toBe(true)
        expect(build()[1]!.content.startsWith('## NARRATIVE')).toBe(true)
    })

    it('reads the templates, the fragments by the trigger, the categories, the location and the quests in a pass', async () => {
        const read = (d: AgentPassDeps) => (d.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Array<{ role: string; content: string }>
        const cartridge = { ...FACTORY_CARTRIDGE_DEFAULTS, routerCustomTags: [{ tag: 'lore', instruction: 'Lore.' }] }
        const warnings: string[] = []
        const auto = deps(['Action: done()'], {
            settings: async () => cartridge as never,
            memo: async () => '[QUESTS]\n- Find the key\n[/QUESTS]',
            location: async () => ({ hierarchy: 'Khelt, The Anvil', mappedSite: 'Khelt' }),
            trigger: 'automatic',
        })
        await runAgentPass('chat-1', 'u1', auto)
        const [system, user] = read(auto).map((m) => m.content)
        expect(system!.startsWith('<player_character_safeguard>')).toBe(true)
        expect(system).toContain('- Eligible commit.core fields this pass: Combat Profile.\n- AUTOMATIC PASS RESTRICTION: Combat Profile is the only [CORE] field')
        expect(system).toContain('"field": "Combat Profile"')
        expect(system).toContain('The only valid `record[].category` values are: "NPC" | "LOC" | "FAC" | "QUEST" | "EVENT" | "LORE".')
        expect(system).toContain('## MAPPED SITE\nThe party is inside mapped site "Khelt".')
        expect(user!.startsWith('## CURRENT LOCATION\nKhelt, The Anvil\n')).toBe(true)
        // The legacy trims the block's inside, so the tags hug the lines.
        expect(user).toContain('## ACTIVE QUESTS\n[QUESTS]- Find the key[/QUESTS]')
        // A pressed pass unlocks the identity fields; a location that will not read costs its section alone.
        const pressed = deps(['Action: done()'], {
            settings: async () => cartridge as never,
            location: async () => { throw new Error('map down') },
            log: { info: () => undefined, warn: (m: string) => { warnings.push(m) } },
        })
        await runAgentPass('chat-1', 'u1', pressed)
        const [sys2, user2] = read(pressed).map((m) => m.content)
        expect(sys2).toContain('- DIRECT PROMPT PASS: you may update any eligible [CORE] identity field (Species, Personality, Brief Background, Habits/Behaviors, Strengths, Flaws, Combat Profile)')
        expect(user2!.startsWith('## CURRENT LOCATION\nUnknown\n')).toBe(true)
        expect(warnings.join('\n')).toContain('map down')
    })

    it('refuses a core edit of an identity field on the automatic pass, in the legacy\'s words, and allows it when pressed', async () => {
        const { store, entriesOf } = makeStore({ Vell_NPC: [{ uid: '1', comment: 'Lissa', content: '[CORE]\nSpecies: human\nCombat Profile: none\n[/CORE]' }] })
        const edit = 'Action: commit({"core": [{"id": "Vell_NPC::1", "field": "Species", "content": "fae"}, {"id": "Vell_NPC::1", "field": "Combat Profile", "content": "Lissa: 4/4 HP"}]})'
        const auto = deps([edit], { store, trigger: 'automatic' })
        auto.owned.push('Vell_NPC')
        const report = await runAgentPass('chat-1', 'u1', auto)
        expect(report.write?.refused).toEqual(['Automatic pass rejected core update of "Species" on "Vell_NPC::1" — only Combat Profile (and Body/Equipment via their dedicated tools) are allowed without a Direct Prompt.'])
        expect(entriesOf('Vell_NPC')[0]!.content).toContain('Species: human')
        expect(entriesOf('Vell_NPC')[0]!.content).toContain('Combat Profile: Lissa: 4/4 HP')
        const { store: store2, entriesOf: entries2 } = makeStore({ Vell_NPC: [{ uid: '1', comment: 'Lissa', content: '[CORE]\nSpecies: human\n[/CORE]' }] })
        const pressed = deps([edit], { store: store2 })
        pressed.owned.push('Vell_NPC')
        const report2 = await runAgentPass('chat-1', 'u1', pressed)
        expect(report2.write?.refused).toEqual([])
        expect(entries2('Vell_NPC')[0]!.content).toContain('Species: fae')
    })
})

describe('redoing an undone pass (71c)', () => {
    const run = async () => {
        const { history, passes } = makeHistory()
        const made = makeStore({ Vell_NPC: [{ uid: '1', content: 'Bram the old', comment: 'Bram' }] })
        // The store can delete a book here, as the host's can: an undo deletes the book the pass made.
        const deleted = new Set<string>()
        const list = made.store.listBooks
        made.store.listBooks = async () => (await list()).filter((b) => !deleted.has(b.id))
        made.store.deleteBook = async (id) => { deleted.add(id) }
        const d = deps(
            ['Action: commit({"record": [{"category": "EVENT", "label": "The fire", "keys": ["fire"], "content": "[Day 1] The forge burned."}], "update": [{"id": "Vell_NPC::1", "field": "general", "content": "Lost his forge."}]})'],
            { store: made.store, history, watermark: 4 },
        )
        d.owned.push('Vell_NPC')
        const pass = await runAgentPass('chat-1', 'u1', d)
        expect(pass.outcome).toBe('committed')
        return { d, made, passes }
    }

    it('an undo hands back what a redo needs: the snapshot restored and the books as the undo found them', async () => {
        const { d, made, passes } = await run()
        const before = made.entriesOf('Vell_NPC')[0]!.content
        expect(before).toContain('Lost his forge.')
        const undone = await undoAgentPass('chat-1', 'u1', d)
        expect(undone.undone).toBe(true)
        expect(undone.watermark).toBe(4)
        expect(passes).toEqual([])
        expect(undone.redo?.pre.prefix).toBe('Vell')
        expect(undone.redo?.post.books.map((b) => b.name).sort()).toEqual(['Vell_EVENT', 'Vell_NPC'])
        expect(undone.redo?.post.books.find((b) => b.name === 'Vell_NPC')?.entries[0]?.content).toBe(before)
        expect(undone.redo?.post.ownedBooks.sort()).toEqual(['Vell_EVENT', 'Vell_NPC'])
        expect(made.entriesOf('Vell_NPC')[0]!.content).toBe('Bram the old')
        expect((await made.store.listBooks()).map((b) => b.name)).toEqual(['Vell_NPC'])
    })

    it('a redo writes the pass’s result back, makes its book again, and re-files the snapshot so it can be undone again', async () => {
        const { d, made, passes } = await run()
        const undone = await undoAgentPass('chat-1', 'u1', d)
        const redone = await redoAgentPass('chat-1', 'u1', d, { ...undone.redo!, watermark: 9 })
        expect(redone.redone).toBe(true)
        expect(redone.watermark).toBe(9)
        expect(redone.summary).toBe('Redone: 1 book made again, 1 entry written again, 1 entry restored.')
        expect(made.entriesOf('Vell_NPC')[0]!.content).toContain('Lost his forge.')
        expect((await made.store.listBooks()).map((b) => b.name)).toEqual(['Vell_NPC', 'Vell_EVENT'])
        const event = (await made.store.listBooks()).find((b) => b.name === 'Vell_EVENT')!
        expect((await made.store.listEntries(event.id))[0]!.content).toContain('The forge burned.')
        expect(d.owned.sort()).toEqual(['Vell_EVENT', 'Vell_NPC'])
        expect(passes).toHaveLength(1)
        // And undone again, cleanly.
        const again = await undoAgentPass('chat-1', 'u1', d)
        expect(again.undone).toBe(true)
        expect(made.entriesOf('Vell_NPC')[0]!.content).toBe('Bram the old')
    })

    it('an undo whose capture fails still undoes, and says the redo is lost', async () => {
        const { d, made } = await run()
        // The capture leaves out a book that will not read; only a listing that throws loses the redo.
        const books = made.store.listBooks
        let calls = 0
        made.store.listBooks = async () => { if (calls++ === 0) throw new Error('host down'); return books() }
        const undone = await undoAgentPass('chat-1', 'u1', d)
        expect(undone.undone).toBe(true)
        expect(undone.redo).toBeUndefined()
        expect(undone.problems[0]).toMatch(/cannot be redone: the books could not be captured first \(Error: host down\)/)
        expect(made.entriesOf('Vell_NPC')[0]!.content).toBe('Bram the old')
    })
})
