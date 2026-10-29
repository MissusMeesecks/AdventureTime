import { describe, expect, it, vi } from 'vitest'

import type { ProviderParameter } from '../tracker/library-photo.js'
import { createRecord, type LibraryRecord } from '../tracker/npc-library.js'
import { createNpcLibrary, partyRoomHint, type NpcLibraryDeps } from './npc-library.js'
import type { TrackerPassOutcome, TrackerPassRequest } from './tracker-pass.js'

const CORE = '[CORE]\nSpecies: Human\nBody: Lean.\nPersonality: Wary.\nFriendship/Rapport: 40/100\n[/CORE]\n\nChronicle: met the party.'
const kestrel = (): LibraryRecord => createRecord({ id: 'k1', name: 'Kestrel', content: CORE, keys: ['Kes'], portraitPath: 'https://host/k.png', createdAt: 5 })

function harness(over: Partial<NpcLibraryDeps> = {}, outcome: Partial<TrackerPassOutcome> = {}, initial: LibraryRecord[] = []) {
    let records = initial
    const runs: TrackerPassRequest[] = []
    const log: string[] = []
    const placed: Array<[string, string, string]> = []
    const saved: unknown[] = []
    const uploads: string[] = []
    const deps: NpcLibraryDeps = {
        store: { load: async () => records.map((r) => ({ ...r })), save: async (next: LibraryRecord[]) => { records = next; return next } } as never,
        trackerPass: { run: vi.fn(async (request: TrackerPassRequest) => { runs.push(request); return { status: 'updated', memo: '[CHARACTER]\nKestrel Vane (Scout 2): 14/14 HP\n[/CHARACTER]', delta: { added: ['PARTY'], replaced: [], removed: [], noChange: false } as never, report: {} as never, ...outcome } as TrackerPassOutcome }) },
        prefs: { load: async () => ({ trackerDirectLookback: 5, campaignNames: { c1: 'Vell' } }) },
        books: () => ({
            listBooks: async () => [{ id: 'b2', name: 'Vell_LOC' }, { id: 'b1', name: 'Vell_NPC' }],
            listEntries: async (bookId) => (bookId === 'b1' ? [{ id: 'e1', key: ['Orrin', 'smith'], content: CORE.replace('Human', 'Dwarf'), comment: 'Orrin' }, { id: 'e2', key: [], content: 'Loose notes', comment: '' }, { id: 'e3', key: ['Sedge'], content: 'No core here.', comment: 'Mother Sedge' }] : []),
        }),
        portraits: { load: async () => ({ portraits: { orrin: 'https://host/o.png' } }), set: async (chatId, name, src) => { placed.push([chatId, name, src]) } },
        images: { uploadFromDataUrl: async (dataUrl) => { uploads.push(dataUrl); return { url: 'https://host/stored.png' } } },
        characters: { get: async (id) => (id === 'h1' ? { id, name: ' Igor Vask ', description: 'A hunchbacked porter.\nFriendship/Rapport: 50/100', personality: 'Dour and loyal.', avatar: 'https://host/igor.png' } : id === 'h2' ? { id, name: 'Orrin', description: 'Dour and loyal. A smith.', personality: 'Dour and loyal.' } : null) },
        playerCard: {
            view: async () => ({ card: { name: 'Robin Vale', bio: 'Species: Halfling\nPersonality: Wry.', wordCount: 20, at: 't' }, persona: null, personasAvailable: true, activePersona: '', activeDescribed: false }),
            save: async (request) => { saved.push(request); return { status: 'written', at: 's', name: request.name, words: 4 } },
        },
        log: { info: (m) => log.push(m), warn: (m) => log.push(`warn: ${m}`) },
        now: () => new Date('2026-10-05T10:00:00Z'),
        ...over,
    }
    return { library: createNpcLibrary(deps), runs, log, placed, saved, uploads, records: () => records }
}

describe('the list and the sources', () => {
    it('lists the records by name with their blurbs', async () => {
        const { library } = harness({}, {}, [{ ...kestrel(), id: 'z', name: 'Yorick' }, kestrel()])
        const list = await library.list('u1')
        expect(list.map((r) => r.name)).toEqual(['Kestrel', 'Yorick'])
        expect(list[0]!.blurb).toBe('Human — Lean.\n\nWary.')
    })

    it('lists the campaign\'s NPC entries with a name, and the Player Card', async () => {
        const { library } = harness()
        const sources = await library.sources('c1', 'u1')
        expect(sources.book).toBe('Vell_NPC')
        expect(sources.entries).toEqual([
            { id: 'e3', name: 'Mother Sedge', blurb: 'No core here.', core: false },
            { id: 'e1', name: 'Orrin', blurb: 'Dwarf — Lean.\n\nWary.', core: true },
        ])
        expect(sources.playerCard).toEqual({ name: 'Robin Vale', blurb: 'Halfling\n\nWry.' })
    })

    it('says when the campaign has no NPC book, and when the books could not be read', async () => {
        const none = harness({ books: () => ({ listBooks: async () => [], listEntries: async () => [] }) })
        expect(await none.library.sources('c1', 'u1')).toMatchObject({ book: '', entries: [] })
        const broken = harness({ books: () => ({ listBooks: async () => { throw new Error('PERMISSION_DENIED') }, listEntries: async () => [] }) })
        const sources = await broken.library.sources('c1', 'u1')
        expect(sources.error).toBe('PERMISSION_DENIED')
        expect(sources.playerCard).not.toBeNull()
    })
})

describe('saving a card', () => {
    it('saves an entry as its identity with its keys and the chat\'s portrait for the name', async () => {
        const { library, records, log } = harness()
        const view = await library.saveEntry({ chatId: 'c1', userId: 'u1', entryId: 'e1' })
        expect(view).toMatchObject({ name: 'Orrin', keys: ['Orrin', 'smith'], portraitPath: 'https://host/o.png', content: '[CORE]\nSpecies: Dwarf\nBody: Lean.\nPersonality: Wary.\n\n[/CORE]' })
        expect(records()).toHaveLength(1)
        expect(log.at(-1)).toBe('library: saved "Orrin" with its portrait')
    })

    it('refuses a name already kept unless overwriting, which keeps the id and the portrait', async () => {
        const { library, records } = harness({}, {}, [kestrel()])
        const sedge = await library.saveEntry({ chatId: 'c1', userId: 'u1', entryId: 'e3' })
        expect(sedge).toMatchObject({ name: 'Mother Sedge' })
        const again = await library.savePlayerCard({ chatId: 'c1', userId: 'u1' })
        expect(again).toMatchObject({ name: 'Robin Vale', content: 'Species: Halfling\nPersonality: Wry.' })
        const existing = { ...kestrel(), name: 'Robin Vale', id: 'rv', portraitPath: 'https://host/rv.png' }
        const h = harness({}, {}, [existing])
        expect(await h.library.savePlayerCard({ chatId: 'c1', userId: 'u1' })).toEqual({ status: 'exists', name: 'Robin Vale' })
        const replaced = await h.library.savePlayerCard({ chatId: 'c1', userId: 'u1', overwrite: true })
        expect(replaced).toMatchObject({ id: 'rv', name: 'Robin Vale', portraitPath: 'https://host/rv.png', createdAt: 5 })
        expect(h.records()).toHaveLength(1)
        expect(records()).toHaveLength(3)
    })

    it('saves a host card as is (48): the creator\'s [CORE] wrap, the name and first name as keys, the avatar as the portrait', async () => {
        const { library, records, log } = harness()
        const view = await library.saveCard({ characterId: 'h1', userId: 'u1' })
        expect(view).toMatchObject({ name: 'Igor Vask', keys: ['Igor Vask', 'Igor'], portraitPath: 'https://host/igor.png', content: '[CORE]\nA hunchbacked porter.\n\nDour and loyal.\n[/CORE]' })
        // The blank line is the legacy's identity extractor dropping the relationship line, as saveEntry's test shows too.
        expect(records()).toHaveLength(1)
        expect(log).toEqual(['library: saving the card "Igor Vask" with its picture', 'library: saved "Igor Vask" with its portrait'])
        // A personality the description already opens with is not repeated; no avatar, no portrait.
        const orrin = await library.saveCard({ characterId: 'h2', userId: 'u1' })
        expect(orrin).toMatchObject({ name: 'Orrin', keys: ['Orrin'], portraitPath: '', content: '[CORE]\nDour and loyal. A smith.\n[/CORE]' })
    })

    it('refuses a card whose name the library keeps unless overwriting, and says when the card or the grant is missing', async () => {
        const { library, records } = harness({}, {}, [{ ...kestrel(), id: 'ig', name: 'Igor Vask', portraitPath: 'https://host/old.png' }])
        expect(await library.saveCard({ characterId: 'h1', userId: 'u1' })).toEqual({ status: 'exists', name: 'Igor Vask' })
        const replaced = await library.saveCard({ characterId: 'h1', userId: 'u1', overwrite: true })
        expect(replaced).toMatchObject({ id: 'ig', name: 'Igor Vask', portraitPath: 'https://host/igor.png', createdAt: 5 })
        expect(records()).toHaveLength(1)
        await expect(library.saveCard({ characterId: 'gone', userId: 'u1' })).rejects.toThrow(/No character card was found for "gone"/)
        const ungranted = harness({ characters: undefined })
        await expect(ungranted.library.saveCard({ characterId: 'h1', userId: 'u1' })).rejects.toThrow(/characters permission/)
    })

    it('throws for a missing book, a missing entry, and a chat without a Player Card', async () => {
        const none = harness({ books: () => ({ listBooks: async () => [], listEntries: async () => [] }) })
        await expect(none.library.saveEntry({ chatId: 'c1', userId: 'u1', entryId: 'e1' })).rejects.toThrow(/no NPC book yet/)
        await expect(harness().library.saveEntry({ chatId: 'c1', userId: 'u1', entryId: 'gone' })).rejects.toThrow(/no longer in the NPC book/)
        const bare = harness({ playerCard: { view: async () => ({ card: null, persona: null, personasAvailable: true, activePersona: '', activeDescribed: false }), save: async () => { throw new Error('x') } } })
        await expect(bare.library.savePlayerCard({ chatId: 'c1', userId: 'u1' })).rejects.toThrow(/no Player Card to save/)
    })
})

describe('editing and removing', () => {
    it('edits the name, text, keys and notes, keeping the id and the portrait, and refuses a clash', async () => {
        const { library, records } = harness({}, {}, [kestrel(), { ...kestrel(), id: 'o', name: 'Orrin' }])
        const view = await library.update({ userId: 'u1', id: 'k1', name: ' Kestrel Vane ', content: 'Species: Elf\nAffection/Interest: 1\n[CORE]x[/CORE]', keys: ['KV'], notes: 'edited' })
        expect(view).toMatchObject({ id: 'k1', name: 'Kestrel Vane', keys: ['Kestrel Vane', 'KV'], content: '[CORE]x[/CORE]', notes: 'edited', portraitPath: 'https://host/k.png' })
        expect(records().find((r) => r.id === 'k1')!.createdAt).toBe(5)
        await expect(library.update({ userId: 'u1', id: 'k1', name: 'orrin' })).rejects.toThrow(/"Orrin" is already in the library/)
        await expect(library.update({ userId: 'u1', id: 'nope' })).rejects.toThrow(/no longer in the library/)
    })

    it('removes a record, and says when there was none', async () => {
        const { library, records } = harness({}, {}, [kestrel()])
        expect(await library.remove('u1', 'k1')).toBe(true)
        expect(records()).toEqual([])
        expect(await library.remove('u1', 'k1')).toBe(false)
    })
})

describe('packages', () => {
    it('imports a package, numbering a taken name and storing the portrait with the host', async () => {
        const { library, records, uploads } = harness({}, {}, [kestrel()])
        const text = JSON.stringify({ format: 'multihog-npc', version: 1, name: 'Kestrel', keys: ['Kes'], content: CORE, notes: 'n', portrait: { mime: 'image/png', data: 'AAAA' } })
        const stored = await library.importPackages({ userId: 'u1', text })
        expect(stored).toHaveLength(1)
        expect(stored[0]).toMatchObject({ name: 'Kestrel (2)', portraitPath: 'https://host/stored.png', notes: 'n' })
        expect(uploads).toEqual(['data:image/png;base64,AAAA'])
        expect(records()).toHaveLength(2)
    })

    it('imports without a portrait when the host cannot store images, and refuses a bad package', async () => {
        const { library, log } = harness({ images: undefined })
        const [one] = await library.importPackages({ userId: 'u1', text: JSON.stringify({ name: 'Orrin', content: 'x', portrait: { mime: 'image/png', data: 'AAAA' } }) })
        expect(one!.portraitPath).toBe('')
        await expect(library.importPackages({ userId: 'u1', text: 'nope' })).rejects.toThrow('Could not parse that as JSON.')
        const failing = harness({ images: { uploadFromDataUrl: async () => { throw new Error('full') } } })
        const [two] = await failing.library.importPackages({ userId: 'u1', text: JSON.stringify({ name: 'Orrin', content: 'x', portrait: { mime: 'image/png', data: 'AAAA' } }) })
        expect(two!.portraitPath).toBe('')
        expect(failing.log.some((m) => m.includes('could not be stored: full'))).toBe(true)
        expect(log.at(-1)).toContain('imported 1 card: Orrin')
    })

    it('exports a record as the legacy\'s file, the portrait inside when given', async () => {
        const { library } = harness({}, {}, [kestrel()])
        const out = await library.exportPackage({ userId: 'u1', id: 'k1', portraitDataUrl: 'data:image/png;base64,AAAA' })
        expect(out.filename).toBe('multihog_npc_kestrel.mnpc.json')
        expect(out.withPortrait).toBe(true)
        expect(JSON.parse(out.file)).toMatchObject({ format: 'multihog-npc', name: 'Kestrel', portrait: { mime: 'image/png', data: 'AAAA' } })
        expect((await library.exportPackage({ userId: 'u1', id: 'k1' })).withPortrait).toBe(false)
        await expect(library.exportPackage({ userId: 'u1', id: 'x' })).rejects.toThrow(/no longer in the library/)
    })
})

describe('into play', () => {
    it('seats a card in the party through the direct pass, then places its portrait', async () => {
        const { library, runs, placed, log } = harness({}, {}, [kestrel()])
        const result = await library.party({ chatId: 'c1', userId: 'u1', id: 'k1' })
        expect(result).toEqual({ status: 'done', at: '2026-10-05T10:00:00.000Z', action: 'party', name: 'Kestrel', added: ['PARTY'], replaced: [], portrait: true })
        expect(runs[0]).toMatchObject({ chatId: 'c1', userId: 'u1', trigger: 'direct', window: 5, playerName: '' })
        expect(runs[0]!.instruction!.startsWith('Add this NPC to the active [PARTY] roster as a new companion.')).toBe(true)
        expect(runs[0]).not.toHaveProperty('systemPromptMode')
        expect(placed).toEqual([['c1', 'Kestrel', 'https://host/k.png']])
        expect(log).toEqual(['library: seating "Kestrel" in the party of chat c1', 'library: "Kestrel" seated: PARTY'])
    })

    it('reports a pass that changed nothing or failed, placing no portrait', async () => {
        const still = harness({}, { status: 'no-change', delta: undefined }, [kestrel()])
        expect(await still.library.party({ chatId: 'c1', userId: 'u1', id: 'k1' })).toMatchObject({ status: 'failed', name: 'Kestrel', reason: expect.stringMatching(/^the tracker pass changed nothing\. A full party is the usual cause/) })
        expect(still.placed).toEqual([])
        const broken = harness({}, { status: 'failed', reason: 'no connection' }, [kestrel()])
        expect((await broken.library.party({ chatId: 'c1', userId: 'u1', id: 'k1' })).reason).toBe('the tracker pass failed: no connection')
        expect(await harness().library.party({ chatId: 'c1', userId: 'u1', id: 'k1' })).toMatchObject({ status: 'failed', reason: 'That card is no longer in the library.' })
    })

    it('makes a card the player: the Player Card set from its text, the portrait placed, the sheet swapped', async () => {
        const { library, runs, placed, saved } = harness({}, {}, [kestrel()])
        const result = await library.playAsPc({ chatId: 'c1', userId: 'u1', id: 'k1' })
        expect(result).toEqual({ status: 'done', at: '2026-10-05T10:00:00.000Z', action: 'pc', name: 'Kestrel Vane', card: { status: 'written', at: 's', name: 'Kestrel', words: 4 }, added: ['PARTY'], replaced: [], portrait: true })
        expect(saved).toEqual([{ chatId: 'c1', userId: 'u1', name: 'Kestrel', bio: 'Species: Human\nBody: Lean.\nPersonality: Wary.' }])
        expect(placed).toEqual([['c1', 'Kestrel', 'https://host/k.png']])
        expect(runs[0]).toMatchObject({ playerName: 'Kestrel' })
        expect(runs[0]!.instruction!.startsWith("Replace the player's [CHARACTER] sheet with this identity.")).toBe(true)
    })

    it('says the card is set when the pass then fails, and refuses without a Player Card', async () => {
        const still = harness({}, { status: 'no-change', delta: undefined }, [kestrel()])
        const result = await still.library.playAsPc({ chatId: 'c1', userId: 'u1', id: 'k1' })
        expect(result).toMatchObject({ status: 'failed', card: { status: 'written' }, reason: 'the Player Card is set, but the tracker pass changed nothing' })
        const none = harness({ playerCard: undefined }, {}, [kestrel()])
        expect(await none.library.playAsPc({ chatId: 'c1', userId: 'u1', id: 'k1' })).toMatchObject({ status: 'failed', reason: 'this build has no Player Card to set' })
    })

    it('never fails an action over a portrait that could not be placed', async () => {
        const h = harness({ portraits: { load: async () => ({ portraits: {} }), set: async () => { throw new Error('PERMISSION_DENIED') } } }, {}, [kestrel()])
        expect((await h.library.party({ chatId: 'c1', userId: 'u1', id: 'k1' })).status).toBe('done')
        expect(h.log.some((m) => m.includes('could not be placed'))).toBe(true)
    })
})

describe('a refused seat (53-bis)', () => {
    const PARTY_TEXT = 'Companion/Party members (max 5 + {{user}}). Temporary separations…'
    const roster = (n: number) => `[CHARACTER]\nRobin (Rogue 2): 10/10 HP\n[/CHARACTER]\n[PARTY]\n${Array.from({ length: n }, (_, i) => `Member ${i + 1} (Fighter 1): 10/10 HP`).join('\n')}\n[/PARTY]`

    it('reads the roster against the cap the party text names, and says which case it is', () => {
        expect(partyRoomHint(roster(5), PARTY_TEXT)).toBe('The party is full: 5 on the roster, and the party module’s text caps it at 5 besides you. Raise the cap under Tracker modules (the party module’s text), or bench someone first.')
        expect(partyRoomHint(roster(6), 'max 5')).toMatch(/^The party is full: 6 on the roster, and the party module’s text caps it at 5/)
        expect(partyRoomHint(roster(2), PARTY_TEXT)).toBe('The roster has 2 of the 5 the party module’s text allows, so the party is not full; the Tracker report’s sample shows what the model said.')
        expect(partyRoomHint(roster(3), 'no number here')).toBe('A full party is the usual cause (3 on the roster; the party module’s text names the cap). Raise the cap under Tracker modules (the party module’s text), or bench someone first.')
        expect(partyRoomHint('[CHARACTER]\nRobin\n[/CHARACTER]', PARTY_TEXT)).toBe('A full party is the usual cause: the party module’s text caps it (max 5 besides you, as shipped). Raise the cap under Tracker modules (the party module’s text), or bench someone first.')
        expect(partyRoomHint(undefined, null)).toMatch(/^A full party is the usual cause: the party module’s text caps it/)
        // A stray first line is a member, as the grammar anchors it (40) and the cards draw it: the count is what is on screen.
        expect(partyRoomHint('[PARTY]\nTravelling since Day 1.\nMember 1 (Fighter 1): 10/10 HP\n[/PARTY]', 'max 2')).toMatch(/^The party is full: 2 on the roster/)
        // "Max" inside a word is not the cap.
        expect(partyRoomHint(roster(1), 'climax 9')).toMatch(/^A full party is the usual cause \(1 on the roster/)
    })

    it('appends the hint to a seat the tracker declined, with the cartridge\'s party text, and not to a failed pass', async () => {
        const noChange = { status: 'no-change' as const, memo: roster(5), reason: 'the reply carried no [TAG] blocks, so the memo was left alone' }
        const { library, log } = harness({ settings: { load: async () => ({ stockPrompts: { party: PARTY_TEXT } }) } }, noChange, [kestrel()])
        const result = await library.party({ chatId: 'c1', userId: 'u1', id: 'k1' })
        expect(result.reason).toBe('the tracker pass changed nothing: the reply carried no [TAG] blocks, so the memo was left alone. The party is full: 5 on the roster, and the party module’s text caps it at 5 besides you. Raise the cap under Tracker modules (the party module’s text), or bench someone first.')
        expect(log.at(-1)).toContain('warn: library: "Kestrel" was not seated: the tracker pass changed nothing')
        // Without the cartridge, the generic hint; a failed pass gets none.
        const bare = harness({}, noChange, [kestrel()])
        expect((await bare.library.party({ chatId: 'c1', userId: 'u1', id: 'k1' })).reason).toMatch(/left alone\. A full party is the usual cause \(5 on the roster; the party module’s text names the cap\)/)
        const failed = harness({ settings: { load: async () => ({ stockPrompts: { party: PARTY_TEXT } }) } }, { status: 'failed', reason: 'timed out' }, [kestrel()])
        expect((await failed.library.party({ chatId: 'c1', userId: 'u1', id: 'k1' })).reason).toBe('the tracker pass failed: timed out')
        const broken = harness({ settings: { load: async () => { throw new Error('no cartridge') } } }, noChange, [kestrel()])
        expect((await broken.library.party({ chatId: 'c1', userId: 'u1', id: 'k1' })).reason).toMatch(/A full party is the usual cause \(5 on the roster; the party module’s text names the cap\)/)
    })
})

describe('a card\'s photo (60)', () => {
    const imageGen = (over: Partial<NonNullable<NpcLibraryDeps['imageGen']>> = {}): NonNullable<NpcLibraryDeps['imageGen']> => ({
        generate: async () => ({ imageDataUrl: 'data:image/png;base64,AAAA', imageUrl: 'https://host/drawn.png', imageId: 'img-1', model: 'flux', provider: 'swarm' }),
        listConnections: async () => [
            { id: 'img-slow', name: 'Slow', provider: 'swarm', model: 'sdxl', is_default: true, default_parameters: { width: 1024, height: 1024, steps: 30 } },
            { id: 'img-fast', name: 'Fast', provider: 'openai', model: 'gpt-image', is_default: false, default_parameters: {} },
        ],
        getProviders: async (): Promise<Array<{ id: string; capabilities: { parameters: Record<string, ProviderParameter> } }>> => [
            { id: 'swarm', capabilities: { parameters: { width: { type: 'integer' }, height: { type: 'integer' } } } },
            { id: 'openai', capabilities: { parameters: { size: { type: 'select', options: [{ id: '1024x1024', label: 'Square' }, { id: '1024x1536', label: 'Portrait' }] } } } },
        ],
        ...over,
    })
    const settings = { load: async () => ({ portraitNpcSystemPrompt: 'Draw {{name}} in {{wordtarget}} words.', portraitPromptWordTarget: 90 }) }

    it('sets a photo from a file: stored under the card\'s name, kept on the record, and placed in the chat only when one is named', async () => {
        const { library, records, uploads, placed, log } = harness({}, {}, [{ ...kestrel(), portraitPath: '' }])
        const alone = await library.setPhoto({ userId: 'u1', id: 'k1', dataUrl: 'data:image/jpeg;base64,BBBB', filename: 'kes.JPG' })
        expect(alone).toEqual({ record: expect.objectContaining({ id: 'k1', portraitPath: 'https://host/stored.png' }), placed: false })
        expect(uploads).toEqual(['data:image/jpeg;base64,BBBB'])
        expect(records()[0]!.portraitPath).toBe('https://host/stored.png')
        expect(placed).toEqual([])
        expect(log.at(-1)).toBe('library: the photo of "Kestrel" set from a file')
        const inPlay = await library.setPhoto({ userId: 'u1', id: 'k1', dataUrl: 'data:image/png;base64,CCCC', chatId: 'c1' })
        expect(inPlay.placed).toBe(true)
        expect(placed).toEqual([['c1', 'Kestrel', 'https://host/stored.png']])
        expect(log.at(-1)).toBe('library: the photo of "Kestrel" placed in chat c1')
    })

    it('names the stored file after the card with the picked file\'s extension, and refuses what is not an image', async () => {
        const names: string[] = []
        const { library } = harness({ images: { uploadFromDataUrl: async (dataUrl, filename) => { names.push(filename); return { url: 'https://host/x.png' } } } }, {}, [kestrel()])
        await library.setPhoto({ userId: 'u1', id: 'k1', dataUrl: 'data:image/webp;base64,AAAA', filename: 'photo.webp' })
        await library.setPhoto({ userId: 'u1', id: 'k1', dataUrl: 'data:image/png;base64,AAAA' })
        expect(names).toEqual(['multihog_npc_kestrel.webp', 'multihog_npc_kestrel.png'])
        await expect(library.setPhoto({ userId: 'u1', id: 'k1', dataUrl: 'https://host/k.png' })).rejects.toThrow(/must be an image/)
        await expect(library.setPhoto({ userId: 'u1', id: 'nope', dataUrl: 'data:image/png;base64,AAAA' })).rejects.toThrow(/no longer in the library/)
        const noStore = harness({ images: undefined }, {}, [kestrel()])
        await expect(noStore.library.setPhoto({ userId: 'u1', id: 'k1', dataUrl: 'data:image/png;base64,AAAA' })).rejects.toThrow(/cannot store images/)
    })

    it('draws a photo: the legacy\'s NPC prompt on the agent\'s connection, then the scene\'s image connection at the 2:3 pair nearest its own size; the record keeps the address and the result says', async () => {
        const calls: unknown[][] = []
        const { library, records, placed, log } = harness({
            settings,
            prefs: { load: async () => ({ trackerDirectLookback: 5, scenePictureConnectionId: ' img-slow ' }) },
            generate: async (system, user, chatId, userId) => { calls.push(['generate', system, user, chatId, userId]); return '  A wary human scout in leathers.  ' },
            imageGen: imageGen({ generate: async (input) => { calls.push(['imageGen', input]); return { imageDataUrl: 'data:image/png;base64,AAAA', imageUrl: 'https://host/drawn.png', model: 'sdxl', provider: 'swarm' } } }),
        }, {}, [{ ...kestrel(), portraitPath: '' }])
        const result = await library.drawPhoto({ userId: 'u1', id: 'k1' })
        expect(calls).toEqual([
            ['generate', 'Draw Kestrel in 90 words.', `NPC Name: Kestrel\n\n---\n\nNPC Lorebook Entry:\n${kestrel().content}`, undefined, 'u1'],
            ['imageGen', { prompt: 'A wary human scout in leathers.', connection_id: 'img-slow', parameters: { width: 896, height: 1344 }, userId: 'u1' }],
        ])
        expect(result).toEqual({ record: expect.objectContaining({ portraitPath: 'https://host/drawn.png' }), placed: false, prompt: 'A wary human scout in leathers.', provider: 'swarm', model: 'sdxl', size: '896×1344' })
        expect(records()[0]!.portraitPath).toBe('https://host/drawn.png')
        expect(placed).toEqual([])
        expect(log).toContain('library: drawing the photo of "Kestrel" on "Slow" at 896×1344')
        expect(log.at(-1)).toBe('library: the photo of "Kestrel" drawn by swarm (sdxl), 896×1344')
    })

    it('writes the photo prompt for editing (73f) with nothing drawn, and draws an edited one without writing a second', async () => {
        const calls: unknown[][] = []
        const { library, log } = harness({
            settings,
            prefs: { load: async () => ({ trackerDirectLookback: 5, scenePictureConnectionId: 'img-slow' }) },
            generate: async (system, user, chatId, userId) => { calls.push(['generate', system, user, chatId, userId]); return 'A wary scout.' },
            imageGen: imageGen({ generate: async (input) => { calls.push(['imageGen', input]); return { imageDataUrl: 'data:image/png;base64,AAAA', imageUrl: 'https://host/drawn.png', model: 'sdxl', provider: 'swarm' } } }),
        }, {}, [{ ...kestrel(), portraitPath: '' }])
        expect(await library.photoPrompt({ userId: 'u1', id: 'k1', chatId: 'c1' })).toEqual({ name: 'Kestrel', prompt: 'A wary scout.' })
        expect(calls).toEqual([['generate', 'Draw Kestrel in 90 words.', `NPC Name: Kestrel\n\n---\n\nNPC Lorebook Entry:\n${kestrel().content}`, 'c1', 'u1']])
        expect(log.at(-1)).toBe('library: writing the photo prompt of "Kestrel", to be edited before the draw')
        const result = await library.drawPhoto({ userId: 'u1', id: 'k1', prompt: '  A scout in a green hood.  ' })
        expect(calls).toHaveLength(2)
        expect(calls[1]).toEqual(['imageGen', { prompt: 'A scout in a green hood.', connection_id: 'img-slow', parameters: { width: 896, height: 1344 }, userId: 'u1' }])
        expect(result.prompt).toBe('A scout in a green hood.')
        await library.drawPhoto({ userId: 'u1', id: 'k1', prompt: '  ' })
        expect(calls.filter((c) => c[0] === 'generate')).toHaveLength(2)
    })

    it('draws on the portrait\'s own image connection when one is chosen (61), the scene\'s otherwise', async () => {
        const calls: unknown[] = []
        const { library } = harness({
            settings,
            prefs: { load: async () => ({ trackerDirectLookback: 5, scenePictureConnectionId: 'img-slow', portraitConnectionId: ' img-fast ' }) },
            generate: async () => 'A smith.',
            imageGen: imageGen({ generate: async (input) => { calls.push(input); return { imageDataUrl: 'data:image/png;base64,DDDD', imageUrl: 'https://host/d.png', model: 'm', provider: 'p' } } }),
        }, {}, [kestrel()])
        await library.drawPhoto({ userId: 'u1', id: 'k1' })
        expect(calls).toEqual([{ prompt: 'A smith.', connection_id: 'img-fast', parameters: { size: '1024x1536' }, userId: 'u1' }])
    })

    it('draws on the host\'s default connection when none is chosen, asks a size-list provider for its portrait size, stores a result that came back as data, and places it in the chat when named', async () => {
        const calls: unknown[] = []
        const { library, uploads, placed } = harness({
            settings,
            prefs: { load: async () => ({ trackerDirectLookback: 5, scenePictureConnectionId: 'img-fast' }) },
            generate: async () => 'A smith.',
            imageGen: imageGen({ generate: async (input) => { calls.push(input); return { imageDataUrl: 'data:image/png;base64,DDDD', model: 'gpt-image', provider: 'openai' } } }),
        }, {}, [kestrel()])
        const result = await library.drawPhoto({ userId: 'u1', id: 'k1', chatId: 'c1' })
        expect(calls).toEqual([{ prompt: 'A smith.', connection_id: 'img-fast', parameters: { size: '1024x1536' }, userId: 'u1' }])
        expect(uploads).toEqual(['data:image/png;base64,DDDD'])
        expect(result).toMatchObject({ placed: true, size: '1024x1536', record: { portraitPath: 'https://host/stored.png' } })
        expect(placed).toEqual([['c1', 'Kestrel', 'https://host/stored.png']])
        // No connection chosen: the host's default, and no connection_id sent.
        const defaulted: unknown[] = []
        const plain = harness({ settings, generate: async () => 'A smith.', imageGen: imageGen({ generate: async (input) => { defaulted.push(input); return { imageDataUrl: 'data:image/png;base64,AAAA', imageUrl: 'https://host/d.png', model: 'm', provider: 'swarm' } } }) }, {}, [kestrel()])
        await plain.library.drawPhoto({ userId: 'u1', id: 'k1' })
        expect(defaulted).toEqual([{ prompt: 'A smith.', parameters: { width: 896, height: 1344 }, userId: 'u1' }])
    })

    it('draws at the connection\'s own size, and says why, when the provider takes none; and names what is missing', async () => {
        const calls: unknown[] = []
        const { library, log } = harness({
            settings, generate: async () => 'A smith.',
            imageGen: imageGen({
                listConnections: async () => [{ id: 'img-x', name: 'Odd', provider: 'odd', model: 'm', is_default: true, default_parameters: { quality: 'high' } }],
                getProviders: async () => { throw new Error('PERMISSION_DENIED') },
                generate: async (input) => { calls.push(input); return { imageDataUrl: 'data:image/png;base64,AAAA', imageUrl: 'https://host/o.png', model: 'm', provider: 'odd' } },
            }),
        }, {}, [kestrel()])
        const result = await library.drawPhoto({ userId: 'u1', id: 'k1' })
        expect(calls).toEqual([{ prompt: 'A smith.', userId: 'u1' }])
        expect(result).toMatchObject({ size: '', sizeNote: 'the provider takes no width and height' })
        expect(log).toContain('warn: library: the image providers could not be listed: PERMISSION_DENIED')
        expect(log).toContain("library: drawing the photo of \"Kestrel\" on \"Odd\" at the connection's own size (the provider takes no width and height)")
        await expect(harness({ settings, generate: async () => 'x' }, {}, [kestrel()]).library.drawPhoto({ userId: 'u1', id: 'k1' })).rejects.toThrow(/image_gen permission/)
        await expect(harness({ settings, imageGen: imageGen() }, {}, [kestrel()]).library.drawPhoto({ userId: 'u1', id: 'k1' })).rejects.toThrow(/cannot write an image prompt/)
        await expect(harness({ settings: { load: async () => ({}) }, generate: async () => 'x', imageGen: imageGen() }, {}, [kestrel()]).library.drawPhoto({ userId: 'u1', id: 'k1' })).rejects.toThrow(/portraitNpcSystemPrompt/)
        await expect(harness({ settings, generate: async () => '  ', imageGen: imageGen() }, {}, [kestrel()]).library.drawPhoto({ userId: 'u1', id: 'k1' })).rejects.toThrow(/no image prompt/)
    })

    it('announces a draw for the Picture light (60-bis): started, then drawn or failed, with the chat when one is named', async () => {
        const events: unknown[][] = []
        const deps = { settings, generate: async () => 'A smith.', imageGen: imageGen(), events: { started: (chatId: string | undefined, userId: string | undefined, name: string, at: string) => { events.push(['started', chatId, name, at]) }, finished: (chatId: string | undefined, userId: string | undefined, report: unknown) => { events.push(['finished', chatId, report]) } } }
        const { library } = harness(deps, {}, [kestrel()])
        await library.drawPhoto({ userId: 'u1', id: 'k1', chatId: 'c1' })
        expect(events).toEqual([
            ['started', 'c1', 'Kestrel', '2026-10-05T10:00:00.000Z'],
            ['finished', 'c1', { name: 'Kestrel', at: '2026-10-05T10:00:00.000Z', outcome: 'drawn' }],
        ])
        events.length = 0
        const failing = harness({ ...deps, generate: async () => { throw new Error('no connection') } }, {}, [kestrel()])
        await expect(failing.library.drawPhoto({ userId: 'u1', id: 'k1' })).rejects.toThrow('no connection')
        expect(events).toEqual([
            ['started', undefined, 'Kestrel', '2026-10-05T10:00:00.000Z'],
            ['finished', undefined, { name: 'Kestrel', at: '2026-10-05T10:00:00.000Z', outcome: 'failed', reason: 'no connection' }],
        ])
    })

    it('removes a photo from the record and leaves the chats alone', async () => {
        const { library, records, placed, log } = harness({}, {}, [kestrel()])
        const result = await library.removePhoto({ userId: 'u1', id: 'k1' })
        expect(result).toEqual({ record: expect.objectContaining({ id: 'k1', portraitPath: '' }), placed: false })
        expect(records()[0]!.portraitPath).toBe('')
        expect(placed).toEqual([])
        expect(log.at(-1)).toBe('library: the photo of "Kestrel" removed')
    })
})
