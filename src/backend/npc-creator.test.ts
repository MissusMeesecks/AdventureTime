import { describe, expect, it } from 'vitest'

import type { LibraryRecord } from '../tracker/npc-library.js'
import { createNpcCreator, type NpcCreatorDeps } from './npc-creator.js'

const KESTREL: LibraryRecord = { id: 'k1', name: 'Kestrel Vane', keys: ['Kestrel Vane', 'Kes'], content: '[CORE]\nSpecies: Human\nBody: Lean.\n[/CORE]', portraitPath: 'https://host/k.png', notes: '', createdAt: 1, updatedAt: 2 }
const TAG = '[[NPC: Mira Voss | [CORE]\nSpecies: Elf\nBody: Tall.\n[/CORE] | Mira Voss, Mira]]'

type Entry = { id: string; uid: string; key: string[]; content: string; comment: string }
type Options = Partial<NpcCreatorDeps> & { reply?: string | Error; bookList?: Array<{ id: string; name: string }>; entryMap?: Record<string, Entry[]>; owned?: string[]; mode?: string }

function harness(options: Options = {}) {
    const { reply, bookList, entryMap, owned: ownedList, mode, ...over } = options
    const calls: unknown[][] = []
    const log: string[] = []
    const books = bookList ?? [{ id: 'b1', name: 'Vellmoor_NPC' }, { id: 'b2', name: 'Vellmoor_LOC' }, { id: 'b3', name: 'Shared Bestiary' }]
    const entries: Record<string, Entry[]> = entryMap ?? {
        b1: [{ id: 'e1', uid: '1', key: ['Mother Sedge'], content: '[CORE]\nSpecies: Human\n[/CORE]', comment: '[Major] Mother Sedge' }],
        b2: [{ id: 'e2', uid: '1', key: ['Morrowfen'], content: 'A port.', comment: 'Morrowfen' }],
        b3: [{ id: 'e3', uid: '1', key: ['Gods'], content: 'Many.', comment: 'Gods' }],
    }
    let owned = ownedList ?? ['Vellmoor_NPC', 'Vellmoor_LOC']
    let nextUid = 7
    const deps: NpcCreatorDeps = {
        settings: { load: async () => ({ routerSystemPromptTemplate: 'TEMPLATE', routerModules: { npc: { instruction: 'NPC INSTRUCTION' } }, npcCoreSections: [{ name: 'Species' }, { name: 'Body' }] }) },
        memos: { load: async () => ({ memo: '[TIME]\nCurrent: 09:40 AM, Day 5\n[/TIME]' }) },
        prefs: { load: async () => ({ campaignNames: { 'chat-1': 'Vellmoor' }, npcAddAsIsMode: mode ?? 'ai_review' }) },
        books: () => ({
            listBooks: async () => books,
            createBook: async (name) => { calls.push(['createBook', name]); const made = { id: `made-${name}`, name }; books.push(made); entries[made.id] = []; return made },
            listEntries: async (bookId) => entries[bookId] ?? [],
            createEntry: async (bookId, entry) => { calls.push(['createEntry', bookId, entry]); const made = { id: `n${nextUid}`, uid: String(nextUid++), ...entry }; (entries[bookId] ??= []).push(made); return made },
        }),
        ownership: { get: async () => owned, set: async (_chat, list) => { calls.push(['own', list]); owned = list }, made: async (_chat, names) => { calls.push(['made', names]); owned = names.reduce((list, name) => list.includes(name) ? list : [...list, name], owned) } },
        characters: { get: async (id) => { calls.push(['character', id]); return id === 'c1' ? { id: 'c1', name: 'Igor Vask', description: 'A hunchbacked porter with a smartphone.', personality: 'Grumbling.', avatar: 'https://host/igor.png' } : id === 'narrator' ? { id, name: 'GM', description: 'A drowned coast.', personality: '' } : null } },
        library: { load: async () => [KESTREL] },
        generate: async (messages, chatId, userId) => { calls.push(['generate', messages, chatId, userId]); const answer = reply ?? TAG; if (answer instanceof Error) throw answer; return answer },
        recent: async () => [{ user: true, name: 'Player', text: 'I knock.' }, { user: false, name: 'Narrator', text: 'The door opens.' }],
        portraits: { set: async (chatId, name, src) => { calls.push(['portrait', chatId, name, src]) } },
        log: { info: (m) => log.push(m), warn: (m) => log.push(`warn: ${m}`) },
        now: () => new Date('2026-10-05T12:00:00.000Z'),
        ...over,
    }
    return { creator: createNpcCreator(deps), calls, log, entries, books, owned: () => owned }
}

const system = (calls: unknown[][]) => ((calls.find(([op]) => op === 'generate')![1] as Array<{ role: string; content: string }>)[0]!.content)
const user = (calls: unknown[][]) => ((calls.find(([op]) => op === 'generate')![1] as Array<{ role: string; content: string }>)[1]!.content)

describe('Add as is', () => {
    it('reviews a host card by default: one model call, the tag read, the entry made with the avatar as its portrait', async () => {
        const { creator, calls, log } = harness({ reply: '[[NPC: Igor Vask | [CORE]\nA hunchbacked porter with a slate.\nGrumbling.\n[/CORE] | Igor Vask, Igor, the porter]]' })
        const result = await creator.add({ chatId: 'chat-1', userId: 'u1', source: { kind: 'card', characterId: 'c1' }, narratorCharacterId: 'narrator' })
        expect(result).toEqual({ status: 'added', at: '2026-10-05T12:00:00.000Z', name: 'Igor Vask', book: 'Vellmoor_NPC', entryId: 'Vellmoor_NPC::7', how: 'reviewed', portrait: true })
        expect(system(calls).startsWith('TEMPLATE\n\n---\n\nYou are an NPC Minimal Review Agent.')).toBe(true)
        expect(user(calls)).toContain('CHARACTER CARD:\nName: Igor Vask\nDescription: A hunchbacked porter with a smartphone.\nPersonality: Grumbling.')
        expect(user(calls)).toContain('NARRATOR/WORLD CARD:\nA drowned coast.')
        expect(user(calls)).toContain('CURRENT GAME STATE:\n[TIME]')
        expect(calls.find(([op]) => op === 'createEntry')).toEqual(['createEntry', 'b1', { key: ['Igor Vask', 'Igor', 'the porter'], content: '[CORE]\nA hunchbacked porter with a slate.\nGrumbling.\n[/CORE]', comment: 'Igor Vask' }])
        expect(calls.find(([op]) => op === 'portrait')).toEqual(['portrait', 'chat-1', 'Igor Vask', 'https://host/igor.png'])
        expect(calls.find(([op]) => op === 'own')).toBeUndefined()
        expect(log).toContain('npc: "Igor Vask" added to Vellmoor_NPC::7 (reviewed, with its portrait)')
    })

    it('adds a host card verbatim in literal mode, with no model call', async () => {
        const { creator, calls } = harness({ mode: 'literal' })
        const result = await creator.add({ chatId: 'chat-1', userId: 'u1', source: { kind: 'card', characterId: 'c1' } })
        expect(result).toMatchObject({ status: 'added', name: 'Igor Vask', how: 'literal', portrait: true })
        expect(calls.find(([op]) => op === 'generate')).toBeUndefined()
        expect(calls.find(([op]) => op === 'createEntry')).toEqual(['createEntry', 'b1', { key: ['Igor Vask', 'Igor'], content: '[CORE]\nA hunchbacked porter with a smartphone.\nGrumbling.\n[/CORE]', comment: 'Igor Vask' }])
    })

    it('takes a reviewed reply without a tag whole, and reports an empty reply', async () => {
        const { creator, calls, log } = harness({ reply: 'Species: Human\nA porter.' })
        expect(await creator.add({ chatId: 'chat-1', userId: 'u1', source: { kind: 'card', characterId: 'c1' } })).toMatchObject({ status: 'added', name: 'Igor Vask', how: 'reviewed' })
        expect((calls.find(([op]) => op === 'createEntry')![2] as { content: string }).content).toBe('[CORE]\nSpecies: Human\nA porter.\n[/CORE]')
        expect(log.some((line) => line.includes('had no [[NPC: …]] tag; its text is taken whole'))).toBe(true)
        const empty = harness({ reply: '   ' })
        expect(await empty.creator.add({ chatId: 'chat-1', userId: 'u1', source: { kind: 'card', characterId: 'c1' } })).toMatchObject({ status: 'failed', name: 'Igor Vask', how: 'reviewed', reason: 'the model answered with nothing' })
        expect(empty.calls.find(([op]) => op === 'createEntry')).toBeUndefined()
    })

    it('adds a library record verbatim with its own keys and portrait, never asking the model', async () => {
        const { creator, calls } = harness()
        const result = await creator.add({ chatId: 'chat-1', userId: 'u1', source: { kind: 'library', id: 'k1' } })
        expect(result).toMatchObject({ status: 'added', name: 'Kestrel Vane', how: 'literal', portrait: true, entryId: 'Vellmoor_NPC::7' })
        expect(calls.find(([op]) => op === 'generate')).toBeUndefined()
        expect(calls.find(([op]) => op === 'createEntry')).toEqual(['createEntry', 'b1', { key: ['Kestrel Vane', 'Kes'], content: KESTREL.content, comment: 'Kestrel Vane' }])
        expect(calls.find(([op]) => op === 'portrait')).toEqual(['portrait', 'chat-1', 'Kestrel Vane', 'https://host/k.png'])
    })

    it('refuses a name already in the book, case-blind and past a [tag], without writing', async () => {
        const { creator, calls } = harness({ mode: 'literal', characters: { get: async () => ({ id: 'c1', name: 'mother sedge', description: 'x', personality: '' }) } })
        expect(await creator.add({ chatId: 'chat-1', userId: 'u1', source: { kind: 'card', characterId: 'c1' } })).toEqual({ status: 'exists', at: '2026-10-05T12:00:00.000Z', name: 'mother sedge', book: 'Vellmoor_NPC', how: 'literal' })
        expect(calls.find(([op]) => op === 'createEntry')).toBeUndefined()
        expect(calls.find(([op]) => op === 'portrait')).toBeUndefined()
    })

    it('makes the NPC book when the campaign has none and records it as the campaign\'s', async () => {
        const { creator, calls, owned } = harness({ mode: 'literal', bookList: [{ id: 'b3', name: 'Shared Bestiary' }], entryMap: { b3: [] }, owned: [] })
        const result = await creator.add({ chatId: 'chat-1', userId: 'u1', source: { kind: 'card', characterId: 'c1' } })
        expect(result).toMatchObject({ status: 'added', book: 'Vellmoor_NPC', entryId: 'Vellmoor_NPC::7' })
        expect(calls[1]).toEqual(['createBook', 'Vellmoor_NPC'])
        // Through the made hook (66): recorded and attached at once, whatever the name's standing.
        expect(calls[2]).toEqual(['made', ['Vellmoor_NPC']])
        expect(calls.find(([op]) => op === 'own')).toBeUndefined()
        expect(owned()).toEqual(['Vellmoor_NPC'])
    })

    it('puts a book made under a name the campaign already owned through the made hook (66)', async () => {
        const { creator, calls } = harness({ mode: 'literal', bookList: [], entryMap: {}, owned: ['Vellmoor_NPC'] })
        await creator.add({ chatId: 'chat-1', userId: 'u1', source: { kind: 'card', characterId: 'c1' } })
        expect(calls.find(([op]) => op === 'createBook')).toEqual(['createBook', 'Vellmoor_NPC'])
        expect(calls.filter(([op]) => op === 'made')).toEqual([['made', ['Vellmoor_NPC']]])
    })

    it('records an existing book the campaign had not claimed, once', async () => {
        const { creator, calls } = harness({ mode: 'literal', owned: ['Vellmoor_LOC'] })
        await creator.add({ chatId: 'chat-1', userId: 'u1', source: { kind: 'card', characterId: 'c1' } })
        expect(calls.filter(([op]) => op === 'own')).toEqual([['own', ['Vellmoor_LOC', 'Vellmoor_NPC']]])
    })

    it('names what went wrong: a missing grant, a missing card, a missing record, a source that is not a card, a failed write, a portrait that would not place', async () => {
        const none = harness({ characters: undefined })
        expect(await none.creator.add({ chatId: 'chat-1', userId: 'u1', source: { kind: 'card', characterId: 'c1' } })).toMatchObject({ status: 'failed', reason: expect.stringContaining('characters permission') })
        const { creator } = harness({ mode: 'literal' })
        expect(await creator.add({ chatId: 'chat-1', userId: 'u1', source: { kind: 'card', characterId: 'nope' } })).toMatchObject({ status: 'failed', reason: 'No character card was found for "nope".' })
        expect(await creator.add({ chatId: 'chat-1', userId: 'u1', source: { kind: 'library', id: 'gone' } })).toMatchObject({ status: 'failed', reason: 'That card is no longer in the library.' })
        expect(await creator.add({ chatId: 'chat-1', userId: 'u1', source: { kind: 'freeform', name: '', description: 'x' } })).toMatchObject({ status: 'failed', reason: 'only a card or a library record can be added as is' })
        const down = harness({ mode: 'literal', books: () => ({ listBooks: async () => { throw new Error('the host is down') }, createBook: async () => { throw new Error('x') }, listEntries: async () => [], createEntry: async () => { throw new Error('x') } }) })
        expect(await down.creator.add({ chatId: 'chat-1', userId: 'u1', source: { kind: 'card', characterId: 'c1' } })).toMatchObject({ status: 'failed', name: 'Igor Vask', how: 'literal', reason: 'the host is down' })
        const failing = harness({ mode: 'literal', portraits: { set: async () => { throw new Error('no store') } } })
        const result = await failing.creator.add({ chatId: 'chat-1', userId: 'u1', source: { kind: 'library', id: 'k1' } })
        expect(result).toMatchObject({ status: 'added', portrait: false })
        expect(failing.log.some((line) => line.includes('warn: npc: the portrait for "Kestrel Vane" could not be placed: no store'))).toBe(true)
    })
})

describe('a draft', () => {
    it('fits a host card into the story: the adaptation prompt with the campaign\'s entries and the forbidden names, the tag back for the preview', async () => {
        const { creator, calls } = harness()
        const result = await creator.draft({ chatId: 'chat-1', userId: 'u1', source: { kind: 'card', characterId: 'c1' }, narratorCharacterId: 'narrator' })
        expect(result).toEqual({ status: 'drafted', at: '2026-10-05T12:00:00.000Z', how: 'fit', source: 'Igor Vask', name: 'Mira Voss', tag: TAG, duplicate: false })
        expect(system(calls)).toContain('You are an NPC Adaptation Agent.')
        expect(system(calls)).toContain('<npc_instructions>\nNPC INSTRUCTION\n</npc_instructions>')
        expect(system(calls)).toContain('(Species, Body)')
        expect(user(calls)).toContain('ACTIVE LOREBOOK ENTRIES (world context):\n[[Major] Mother Sedge]: [CORE]\nSpecies: Human\n[/CORE]\n[Morrowfen]: A port.')
        // The shared book is not the campaign's; its entry stays out.
        expect(user(calls)).not.toContain('[Gods]')
        expect(calls.find(([op]) => op === 'createEntry')).toBeUndefined()
    })

    it('fits a library record as its description, and flags a name the book already has', async () => {
        const { creator, calls } = harness({ reply: '[[NPC: Mother Sedge | [CORE]\nx\n[/CORE] | Sedge]]' })
        const result = await creator.draft({ chatId: 'chat-1', userId: 'u1', source: { kind: 'library', id: 'k1' } })
        expect(result).toMatchObject({ status: 'drafted', source: 'Kestrel Vane', name: 'Mother Sedge', duplicate: true })
        expect(user(calls)).toContain(`CHARACTER CARD:\nName: Kestrel Vane\nDescription: ${KESTREL.content}\nPersonality: `)
    })

    it('expands a concept with the forbidden names from the NPC book and the naming rule', async () => {
        const { creator, calls } = harness()
        const result = await creator.draft({ chatId: 'chat-1', userId: 'u1', source: { kind: 'freeform', name: ' Mira ', description: ' A duellist. ' } })
        expect(result).toMatchObject({ status: 'drafted', how: 'freeform', source: 'the concept', name: 'Mira Voss' })
        expect(system(calls)).toContain('Forbidden Names (Do NOT use these existing NPC/character names under any circumstances):\n- Mother Sedge\n\n<npc_instructions>')
        expect(system(calls)).toContain('[New NPC Naming Rule:')
        expect(user(calls).startsWith('USER\'S NPC CONCEPT:\nName: Mira\nDescription: A duellist.')).toBe(true)
    })

    it('makes an archetype, naming the role as the source', async () => {
        const { creator, calls } = harness()
        const result = await creator.draft({ chatId: 'chat-1', userId: 'u1', source: { kind: 'archetype', archetype: 'Rival', name: '', concept: 'A duellist.' } })
        expect(result).toMatchObject({ status: 'drafted', how: 'archetype', source: 'Rival', name: 'Mira Voss' })
        expect(system(calls)).toContain('Create a new NPC for the current ongoing campaign fitting the requested archetype.')
        expect(user(calls).startsWith('ARCHETYPE REQUEST:\nArchetype: Rival\nAdditional concept: A duellist.\n')).toBe(true)
    })

    it('reports a reply with no tag with its opening, an empty reply, and a model that threw', async () => {
        const noTag = harness({ reply: 'I cannot do that, sorry. '.repeat(20) })
        expect(await noTag.creator.draft({ chatId: 'chat-1', userId: 'u1', source: { kind: 'freeform', name: 'Mira', description: 'x' } })).toMatchObject({ status: 'failed', how: 'freeform', name: 'Mira', reason: expect.stringMatching(/^the reply had no \[\[NPC: …\]\] tag in it: I cannot do that, sorry\. .*…$/) })
        const empty = harness({ reply: '' })
        expect(await empty.creator.draft({ chatId: 'chat-1', userId: 'u1', source: { kind: 'card', characterId: 'c1' } })).toMatchObject({ status: 'failed', source: 'Igor Vask', name: 'Igor Vask', reason: 'the model answered with nothing' })
        const threw = harness({ reply: new Error('connection refused') })
        expect(await threw.creator.draft({ chatId: 'chat-1', userId: 'u1', source: { kind: 'archetype', archetype: 'Enemy', name: '', concept: '' } })).toMatchObject({ status: 'failed', how: 'archetype', source: 'Enemy', reason: 'connection refused' })
        expect(threw.log.some((line) => line.startsWith('warn: npc: the draft from Enemy failed: connection refused'))).toBe(true)
    })

    it('reads the campaign without a narrator, a memo or books, and still asks', async () => {
        const { creator, calls } = harness({ memos: { load: async () => { throw new Error('no memo') } }, bookList: [], entryMap: {}, owned: [], ownership: { get: async () => { throw new Error('x') }, set: async () => {}, made: async () => {} } })
        expect(await creator.draft({ chatId: 'chat-1', userId: 'u1', source: { kind: 'freeform', name: '', description: 'A porter.' } })).toMatchObject({ status: 'drafted', duplicate: false })
        expect(user(calls)).not.toContain('CURRENT GAME STATE')
        expect(user(calls)).not.toContain('NARRATOR/WORLD CARD')
        expect(system(calls)).not.toContain('Forbidden Names (Do NOT')
    })
})

describe('a commit', () => {
    it('writes the tag as it stands, under the drafted name, with the source\'s portrait', async () => {
        const { creator, calls } = harness()
        const result = await creator.commit({ chatId: 'chat-1', userId: 'u1', tag: TAG, name: 'Kestrel Vane', how: 'fit', portrait: { kind: 'library', id: 'k1' } })
        expect(result).toEqual({ status: 'added', at: '2026-10-05T12:00:00.000Z', name: 'Mira Voss', book: 'Vellmoor_NPC', entryId: 'Vellmoor_NPC::7', how: 'fit', portrait: true })
        expect(calls.find(([op]) => op === 'createEntry')).toEqual(['createEntry', 'b1', { key: ['Mira Voss', 'Mira'], content: '[CORE]\nSpecies: Elf\nBody: Tall.\n[/CORE]', comment: 'Mira Voss' }])
        expect(calls.find(([op]) => op === 'portrait')).toEqual(['portrait', 'chat-1', 'Mira Voss', 'https://host/k.png'])
        expect(calls.find(([op]) => op === 'generate')).toBeUndefined()
    })

    it('falls back to the typed name for a tagless edit, takes a host card\'s avatar, and refuses a duplicate', async () => {
        const { creator, calls } = harness()
        expect(await creator.commit({ chatId: 'chat-1', userId: 'u1', tag: 'Species: Elf', name: '  ', how: 'freeform' })).toMatchObject({ status: 'added', name: 'New NPC', how: 'freeform', portrait: false })
        expect((calls.find(([op]) => op === 'createEntry')![2] as { content: string }).content).toBe('[CORE]\nSpecies: Elf\n[/CORE]')
        const withCard = harness()
        expect(await withCard.creator.commit({ chatId: 'chat-1', userId: 'u1', tag: TAG, name: 'Igor Vask', how: 'fit', portrait: { kind: 'card', characterId: 'c1' } })).toMatchObject({ status: 'added', portrait: true })
        expect(withCard.calls.find(([op]) => op === 'portrait')).toEqual(['portrait', 'chat-1', 'Mira Voss', 'https://host/igor.png'])
        const dup = harness()
        expect(await dup.creator.commit({ chatId: 'chat-1', userId: 'u1', tag: '[[NPC: Mother Sedge | x | ]]', name: 'x', how: 'archetype' })).toEqual({ status: 'exists', at: '2026-10-05T12:00:00.000Z', name: 'Mother Sedge', book: 'Vellmoor_NPC', how: 'archetype' })
        // A portrait source that is gone costs nothing: the entry is still written.
        const gone = harness()
        expect(await gone.creator.commit({ chatId: 'chat-1', userId: 'u1', tag: TAG, name: 'x', how: 'fit', portrait: { kind: 'library', id: 'gone' } })).toMatchObject({ status: 'added', portrait: false })
    })

    it('reports a failed write with the tag\'s name', async () => {
        const { creator: broken } = harness({ books: () => ({ listBooks: async () => [], createBook: async () => { throw new Error('the host refused') }, listEntries: async () => [], createEntry: async () => { throw new Error('x') } }) })
        expect(await broken.commit({ chatId: 'chat-1', userId: 'u1', tag: TAG, name: 'x', how: 'fit' })).toMatchObject({ status: 'failed', name: 'Mira Voss', how: 'fit', reason: 'the host refused' })
    })
})
