import { describe, expect, it } from 'vitest'

import { emptyCommit, type Commit } from './commit.js'
import { applyCommit, replaceCoreField, type LoreBook, type LoreEntry, type LoreStore } from './writer.js'

/** An in-memory world-book store, close enough to the host's shape to test against. */
function makeStore(seed: Record<string, Array<Partial<LoreEntry>>> = {}) {
    let nextBook = 1
    let nextEntry = 1
    const books: LoreBook[] = []
    const entries = new Map<string, LoreEntry[]>()
    const deleted: string[] = []

    for (const [name, list] of Object.entries(seed)) {
        const book = { id: `b${nextBook++}`, name }
        books.push(book)
        entries.set(
            book.id,
            list.map((entry, index) => ({
                id: `e${nextEntry++}`,
                uid: entry.uid ?? String(index + 1),
                key: entry.key ?? [],
                content: entry.content ?? '',
                comment: entry.comment ?? '',
            })),
        )
    }

    const store: LoreStore = {
        listBooks: async () => books.map((book) => ({ ...book })),
        createBook: async (name) => {
            const book = { id: `b${nextBook++}`, name }
            books.push(book)
            entries.set(book.id, [])
            return { ...book }
        },
        listEntries: async (bookId) => (entries.get(bookId) ?? []).map((entry) => ({ ...entry })),
        createEntry: async (bookId, entry) => {
            const list = entries.get(bookId)!
            const made: LoreEntry = {
                id: `e${nextEntry++}`,
                uid: String(list.length + 1),
                key: entry.key,
                content: entry.content,
                comment: entry.comment,
            }
            list.push(made)
            return { ...made }
        },
        updateEntry: async (entryId, patch) => {
            for (const list of entries.values()) {
                const found = list.find((entry) => entry.id === entryId)
                if (found) Object.assign(found, patch)
            }
        },
        deleteEntry: async (entryId) => {
            deleted.push(entryId)
            for (const [bookId, list] of entries) {
                entries.set(bookId, list.filter((entry) => entry.id !== entryId))
            }
        },
    }

    const find = (bookName: string, uid: string): LoreEntry | undefined => {
        const book = books.find((candidate) => candidate.name === bookName)
        return book ? entries.get(book.id)?.find((entry) => entry.uid === uid) : undefined
    }

    return { store, books, find, deleted, entriesOf: (name: string) => entries.get(books.find((b) => b.name === name)!.id)! }
}

const commit = (over: Partial<Commit>): Commit => ({ ...emptyCommit(), ...over })

const OWNED = ['Vell', 'Vell_NPC']

describe('applying a commit', () => {
    it('appends to an entry rather than replacing it', async () => {
        const { store, find } = makeStore({ Vell_NPC: [{ uid: '1', content: 'She keeps rope.' }] })
        await applyCommit(commit({ update: [{ id: 'Vell_NPC::1', content: 'Now wary.' }] }), {
            store, prefix: 'Vell', ownedBooks: OWNED,
        })
        expect(find('Vell_NPC', '1')?.content).toBe('She keeps rope.\nNow wary.')
    })

    it('stamps added content with the in-world time', async () => {
        const { store, find } = makeStore({ Vell_NPC: [{ uid: '1', content: '' }] })
        await applyCommit(commit({ update: [{ id: 'Vell_NPC::1', content: 'Wary.' }] }), {
            store, prefix: 'Vell', ownedBooks: OWNED, timePrefix: '[Day 4]',
        })
        expect(find('Vell_NPC', '1')?.content).toBe('[Day 4] Wary.')
    })

    it('keeps [CORE] through a rewrite, and takes an old title stamp off with it (73a-bis: the cleanup pass rewrites)', async () => {
        const { store, find } = makeStore({
            Vell_NPC: [{ uid: '1', comment: 'Fae Queen [msg #0]', content: '[CORE]\nSpecies: fae\n[/CORE]\nOld prose.' }, { uid: '2', comment: 'Plain', content: 'Old.' }],
        })
        await applyCommit(commit({ rewrite: [{ id: 'Vell_NPC::1', content: 'New prose.' }, { id: 'Vell_NPC::2', content: 'New.' }] }), {
            store, prefix: 'Vell', ownedBooks: OWNED,
        })
        expect(find('Vell_NPC', '1')?.content).toBe('[CORE]\nSpecies: fae\n[/CORE]\nNew prose.')
        expect(find('Vell_NPC', '1')?.comment).toBe('Fae Queen')
        expect(find('Vell_NPC', '2')?.comment).toBe('Plain')
    })

    it('creates the campaign book an entry needs, and records it as created', async () => {
        // The record is what an undo reads: a book this pass made may be
        // deleted on a swipe, one it merely wrote into must not be.
        const { store, find } = makeStore({})
        const report = await applyCommit(
            commit({ record: [{ label: 'Lissa', category: 'NPC', keys: ['Lissa'], content: 'A rope-keeper.' }] }),
            { store, prefix: 'Vell', ownedBooks: [] },
        )
        expect(report.createdBooks).toEqual(['Vell_NPC'])
        expect(report.createdEntries).toEqual(['Vell_NPC::1'])
        expect(report.ownedBooks).toContain('Vell_NPC')
        expect(find('Vell_NPC', '1')?.comment).toBe('Lissa')
    })

    it('deletes the entries a merge consumed, and keeps the survivor', async () => {
        const { store, find, entriesOf } = makeStore({
            Vell_NPC: [
                { uid: '1', content: '[CORE]\nSpecies: fae\n[/CORE]\nFirst.' },
                { uid: '2', content: 'Second.' },
            ],
        })
        const report = await applyCommit(
            commit({ consolidate: [{ survivor: 'Vell_NPC::1', targets: ['Vell_NPC::2'], content: 'Merged.' }] }),
            { store, prefix: 'Vell', ownedBooks: OWNED },
        )
        expect(find('Vell_NPC', '1')?.content).toBe('[CORE]\nSpecies: fae\n[/CORE]\nMerged.')
        expect(entriesOf('Vell_NPC')).toHaveLength(1)
        expect(report.deleted).toEqual(['Vell_NPC::2'])
    })

    it('keeps a mapped place through a merge or a delete, and says so (45c-quinquies)', async () => {
        const { store, find, entriesOf } = makeStore({
            Vell_LOC: [
                { uid: '1', content: 'The ranch.' },
                { uid: '2', content: 'The root cellar.\n\n[MAP]\n{"kind":"DUNGEON"}\n[/MAP]' },
                { uid: '3', content: 'A shed.' },
            ],
        })
        const report = await applyCommit(
            commit({
                consolidate: [{ survivor: 'Vell_LOC::1', targets: ['Vell_LOC::2', 'Vell_LOC::3'], content: 'Merged.' }],
                deleteIds: ['Vell_LOC::2'],
            }),
            { store, prefix: 'Vell', ownedBooks: ['Vell_LOC'] },
        )
        expect(find('Vell_LOC', '2')?.content).toContain('[MAP]')
        expect(entriesOf('Vell_LOC').map((e) => e.uid)).toEqual(['1', '2'])
        expect(report.deleted).toEqual(['Vell_LOC::3'])
        expect(report.refused).toEqual([
            'consolidate: "Vell_LOC::2" holds a map and was kept; the agent does not merge away a mapped place',
            'delete: "Vell_LOC::2" holds a map and was kept; the agent does not delete a mapped place',
        ])
    })

    it('deletes last, so a merge can still read what it is merging', async () => {
        const { store, entriesOf } = makeStore({
            Vell_NPC: [{ uid: '1', content: 'Keep.' }, { uid: '2', content: 'Absorb me.' }],
        })
        await applyCommit(
            commit({
                consolidate: [{ survivor: 'Vell_NPC::1', targets: ['Vell_NPC::2'], content: '' }],
                deleteIds: ['Vell_NPC::2'],
            }),
            { store, prefix: 'Vell', ownedBooks: OWNED },
        )
        // The merge took the target's text before the deletion removed it.
        expect(entriesOf('Vell_NPC')[0]!.content).toContain('Absorb me.')
    })
})

describe('what the writer refuses', () => {
    it('will not touch a book this campaign does not own', async () => {
        // The guarantee, at the point of the write. A caller that forgot to
        // check gets a refusal, not a rewritten world bible.
        const { store, find } = makeStore({ 'My World Bible': [{ uid: '1', content: 'Mine.' }] })
        const report = await applyCommit(
            commit({ rewrite: [{ id: 'My World Bible::1', content: 'Theirs now.' }] }),
            { store, prefix: 'Vell', ownedBooks: OWNED },
        )
        expect(find('My World Bible', '1')?.content).toBe('Mine.')
        expect(report.changed).toEqual([])
        expect(report.refused[0]).toContain('does not belong to this campaign')
    })

    it('will not write into a book that merely matches the campaign name', async () => {
        // The gap 9b was built to close: a book named like ours, that we did
        // not make, is adoptable and not ours until the user says so.
        const { store, entriesOf } = makeStore({ Vell_NPC: [{ uid: '1', content: 'Pre-existing.' }] })
        const report = await applyCommit(
            commit({ record: [{ label: 'Lissa', category: 'NPC', keys: [], content: 'x' }] }),
            { store, prefix: 'Vell', ownedBooks: [] },
        )
        expect(entriesOf('Vell_NPC')).toHaveLength(1)
        expect(report.createdBooks).toEqual([])
        expect(report.refused[0]).toContain('is not this campaign')
    })

    it('says so when an entry is already gone rather than failing the pass', async () => {
        const { store } = makeStore({ Vell_NPC: [{ uid: '1' }] })
        const report = await applyCommit(
            commit({
                update: [{ id: 'Vell_NPC::9', content: 'x' }, { id: 'Vell_NPC::1', content: 'y' }],
            }),
            { store, prefix: 'Vell', ownedBooks: OWNED },
        )
        expect(report.refused[0]).toContain('not there any more')
        // And the good item still applied.
        expect(report.changed).toEqual(['Vell_NPC::1'])
    })

    it('says so when the book does not exist at all', async () => {
        const { store } = makeStore({})
        const report = await applyCommit(commit({ update: [{ id: 'Nowhere::1', content: 'x' }] }), {
            store, prefix: 'Vell', ownedBooks: OWNED,
        })
        expect(report.refused[0]).toContain('no book called "Nowhere"')
    })

    it('does nothing at all for an empty commit', async () => {
        const { store, deleted } = makeStore({ Vell_NPC: [{ uid: '1', content: 'Untouched.' }] })
        const report = await applyCommit(emptyCommit(), { store, prefix: 'Vell', ownedBooks: OWNED })
        expect(report).toMatchObject({ changed: [], deleted: [], createdBooks: [], refused: [] })
        expect(deleted).toEqual([])
    })
})

describe('editing one field inside [CORE]', () => {
    it('replaces the named line and leaves the rest of the block alone', () => {
        const before = '[CORE]\nSpecies: fae\nOrigin: the Dimmerwood\n[/CORE]\nProse.'
        expect(replaceCoreField(before, 'Species', 'half-elf'))
            .toBe('[CORE]\nSpecies: half-elf\nOrigin: the Dimmerwood\n[/CORE]\nProse.')
    })

    it('adds a field the block did not have', () => {
        expect(replaceCoreField('[CORE]\nSpecies: fae\n[/CORE]', 'Body', 'Scarred hand.'))
            .toBe('[CORE]\nSpecies: fae\nBody: Scarred hand.\n[/CORE]')
    })

    it('gives an entry a [CORE] block when it had none, keeping its prose', () => {
        expect(replaceCoreField('Just prose.', 'Species', 'fae'))
            .toBe('[CORE]\nSpecies: fae\n[/CORE]\nJust prose.')
    })

    it('is not confused by a field name containing regex characters', () => {
        expect(replaceCoreField('[CORE]\nRank (guild): novice\n[/CORE]', 'Rank (guild)', 'journeyman'))
            .toBe('[CORE]\nRank (guild): journeyman\n[/CORE]')
    })

    it('matches a field name without regard to case, keeping the line\'s own', () => {
        expect(replaceCoreField('[CORE]\nspecies: fae\n[/CORE]', 'Species', 'human'))
            .toBe('[CORE]\nspecies: human\n[/CORE]')
    })

    // The legacy's aliases: "gear" is the Worn Equipment line, "appearance" the Body line.
    it('resolves the legacy\'s field aliases onto the line they mean', () => {
        expect(replaceCoreField('[CORE]\nBody: Tall.\nWorn Equipment: rope\n[/CORE]', 'gear', 'knife'))
            .toBe('[CORE]\nBody: Tall.\nWorn Equipment: knife\n[/CORE]')
    })

    // 45b-bis, live: a level-up patched a companion's Combat Profile and the entry
    // held two stat blocks, the new one over the old. The field's value runs
    // to the next known header, not to the end of its first line.
    it('replaces a multi-line field whole, bounded by the next header, the block\'s end, or a custom section', () => {
        const before = '[CORE]\nSpecies: Human\nCombat Profile: Fenna (Ranger): 30/30 HP\nCombat: BAB: +3\nHD: d10 (3/3)\nStatus: Healthy\n[/CORE]\nProse.'
        expect(replaceCoreField(before, 'Combat Profile', 'Fenna (Ranger): 40/40 HP\nCombat: BAB: +4\nHD: d10 (4/4)\nStatus: Healthy'))
            .toBe('[CORE]\nSpecies: Human\nCombat Profile: Fenna (Ranger): 40/40 HP\nCombat: BAB: +4\nHD: d10 (4/4)\nStatus: Healthy\n[/CORE]\nProse.')
        const followed = '[CORE]\nCombat Profile: X 30/30\nCombat: BAB: +3\nFlaws: Proud.\n[/CORE]'
        expect(replaceCoreField(followed, 'Combat Profile', 'X 40/40\nCombat: BAB: +4'))
            .toBe('[CORE]\nCombat Profile: X 40/40\nCombat: BAB: +4\nFlaws: Proud.\n[/CORE]')
        // A stat block's own labels never bound a value, whatever the new one carries;
        // a label the new value carries as a line is the field's too.
        expect(replaceCoreField('[CORE]\nCombat Profile: X 30/30\nSaves: Fort +1\nStatus: Healthy\n[/CORE]', 'Combat Profile', 'X 40/40'))
            .toBe('[CORE]\nCombat Profile: X 40/40\n[/CORE]')
        expect(replaceCoreField('[CORE]\nCombat Profile: X 30/30\nMorale: Steady\nFlaws: Proud.\n[/CORE]', 'Combat Profile', 'X 40/40\nMorale: High'))
            .toBe('[CORE]\nCombat Profile: X 40/40\nMorale: High\nFlaws: Proud.\n[/CORE]')
        // Any other capitalised label bounds a value, as the legacy has it; a
        // section the campaign names bounds it even when its name is one the
        // legacy's scan cannot read, and a stat-block label named as a section stays a header.
        expect(replaceCoreField('[CORE]\nCombat Profile: X 30/30\nOath: Sworn.\n[/CORE]', 'Combat Profile', 'X 40/40'))
            .toBe('[CORE]\nCombat Profile: X 40/40\nOath: Sworn.\n[/CORE]')
        const odd = '[CORE]\nCombat Profile: X 30/30\nOath (sworn): Yes.\n[/CORE]'
        expect(replaceCoreField(odd, 'Combat Profile', 'X 40/40')).toBe('[CORE]\nCombat Profile: X 40/40\n[/CORE]')
        expect(replaceCoreField(odd, 'Combat Profile', 'X 40/40', ['Oath (sworn)'])).toBe('[CORE]\nCombat Profile: X 40/40\nOath (sworn): Yes.\n[/CORE]')
        expect(replaceCoreField('[CORE]\nCombat Profile: X 30/30\nStatus: Outlaw\n[/CORE]', 'Combat Profile', 'X 40/40', ['Status']))
            .toBe('[CORE]\nCombat Profile: X 40/40\nStatus: Outlaw\n[/CORE]')
    })
})

describe('the Player Card as a core target (35b)', () => {
    const CORE = { Vell_NPC: [{ uid: '1', content: '[CORE]\nBody: Scarred.\n[/CORE]\nProse.' }] }
    const card = () => {
        const applied: Array<[string, string]> = []
        return { applied, playerCard: { name: 'Robin Vale', apply: async (field: string, content: string) => { applied.push([field, content]); return field === 'Personality' ? { ok: false as const, reason: 'PC updates are limited to Body and Worn Equipment' } : { ok: true as const } } } }
    }

    it('sends an edit addressed to {{user}}, player, pc, user or the card\'s name to the card, not to a book', async () => {
        const { store, find } = makeStore(CORE)
        const { applied, playerCard } = card()
        const report = await applyCommit(
            commit({ core: [{ id: '{{user}}', field: 'Body', content: 'Tall.' }, { id: 'player', field: 'Worn Equipment', content: 'A cloak.' }, { id: 'robin vale', field: 'Body', content: 'Taller.' }, { id: 'Vell_NPC::1', field: 'Body', content: 'Unscarred.' }] }),
            { store, prefix: 'Vell', ownedBooks: OWNED, playerCard },
        )
        expect(applied).toEqual([['Body', 'Tall.'], ['Worn Equipment', 'A cloak.'], ['Body', 'Taller.']])
        expect(report.changed).toEqual(['{{user}}', 'player', 'robin vale', 'Vell_NPC::1'])
        expect(report.refused).toEqual([])
        expect(find('Vell_NPC', '1')!.content).toBe('[CORE]\nBody: Unscarred.\n[/CORE]\nProse.')
    })

    it('reports a field the card refuses, and without a card treats the address as any other', async () => {
        const { store } = makeStore(CORE)
        const { applied, playerCard } = card()
        const report = await applyCommit(commit({ core: [{ id: 'pc', field: 'Personality', content: 'Grim.' }] }), { store, prefix: 'Vell', ownedBooks: OWNED, playerCard })
        expect(applied).toEqual([['Personality', 'Grim.']])
        expect(report.changed).toEqual([])
        expect(report.refused).toEqual(['PC core update failed for "pc": PC updates are limited to Body and Worn Equipment'])
        const none = await applyCommit(commit({ core: [{ id: '{{user}}', field: 'Body', content: 'Tall.' }] }), { store, prefix: 'Vell', ownedBooks: OWNED })
        expect(none.refused).toEqual(['core: "{{user}}" is not an entry address'])
    })
})

describe('a category that nearly matches a book we already have', () => {
    // Live, one commit made Vell_Event beside the Vell_Events it had been
    // shown in the same prompt — a campaign's events split over one letter.
    const record = (category: string) =>
        commit({ record: [{ label: 'Day One', category, keys: ['day one'], content: 'They left.' }] })

    it('files into the existing book rather than making a near-duplicate', async () => {
        const { store, books, entriesOf } = makeStore({ Vell_Events: [] })

        const report = await applyCommit(record('Event'), {
            store, prefix: 'Vell', ownedBooks: ['Vell_Events'],
        })

        expect(report.createdBooks).toEqual([])
        expect(books.map((book) => book.name)).toEqual(['Vell_Events'])
        expect(entriesOf('Vell_Events')).toHaveLength(1)
    })

    it('matches regardless of case', async () => {
        const { store, entriesOf } = makeStore({ Vell_Events: [] })

        const report = await applyCommit(record('events'), {
            store, prefix: 'Vell', ownedBooks: ['Vell_Events'],
        })

        expect(report.createdBooks).toEqual([])
        expect(entriesOf('Vell_Events')).toHaveLength(1)
    })

    it('will not fold onto a book this campaign does not own', async () => {
        // A near-miss match onto a book we may not write to would put the entry
        // in someone else's lore. An adoptable book — right name, never
        // recorded as ours (9b) — is exactly that case, and the folding must
        // not be the thing that adopts it.
        const { store, books, entriesOf } = makeStore({ Vell_Events: [] })

        const report = await applyCommit(record('Event'), { store, prefix: 'Vell', ownedBooks: [] })

        expect(entriesOf('Vell_Events')).toEqual([])
        expect(report.createdBooks).toEqual(['Vell_Event'])
        expect(books.map((book) => book.name)).toEqual(['Vell_Events', 'Vell_Event'])
    })

    it('still makes a new book for a genuinely new category', async () => {
        const { store } = makeStore({ Vell_Events: [] })

        const report = await applyCommit(record('Characters'), {
            store, prefix: 'Vell', ownedBooks: ['Vell_Events'],
        })

        expect(report.createdBooks).toEqual(['Vell_Characters'])
    })
})

describe('saying which turn produced an entry', () => {
    it('stamps a new entry with the message the pass read', async () => {
        // The maintainer's ask: open a book and see where an entry came from.
        const { store, entriesOf } = makeStore({ Vell_NPC: [] })
        await applyCommit(
            commit({ record: [{ label: 'Iron Syndicate', category: 'NPC', keys: ['syndicate'], content: 'Smugglers.', msg: 31 }] }),
            { store, prefix: 'Vell', ownedBooks: OWNED, readRange: [31] },
        )
        // 73a: the title is the plain name; the turn is on the prose.
        expect(entriesOf('Vell_NPC').at(-1)?.comment).toBe('Iron Syndicate')
        expect(entriesOf('Vell_NPC').at(-1)?.content).toBe('[msg #31] Smugglers.')
    })

    it('writes no stamp when the pass could not place itself', async () => {
        const { store, entriesOf } = makeStore({ Vell_NPC: [] })
        await applyCommit(
            commit({ record: [{ label: 'Iron Syndicate', category: 'NPC', keys: [], content: 'x', msg: null }] }),
            { store, prefix: 'Vell', ownedBooks: OWNED, readRange: [] },
        )
        expect(entriesOf('Vell_NPC').at(-1)?.comment).toBe('Iron Syndicate')
    })

    it('takes an old title stamp off through a rename (73a)', async () => {
        // The title is the name; a stamp written before 73a goes with the first rename.
        const { store, find } = makeStore({
            Vell_NPC: [{ uid: '1', comment: 'Iron Syndicate [msg #31]', content: 'x' }],
        })
        await applyCommit(commit({ rename: [{ id: 'Vell_NPC::1', label: 'The Syndicate' }] }), {
            store, prefix: 'Vell', ownedBooks: OWNED, readRange: [99],
        })
        expect(find('Vell_NPC', '1')?.comment).toBe('The Syndicate')
    })

    it('does not stamp an entry that never had one, however it is renamed', async () => {
        // Entries the user wrote by hand, and entries from before this existed.
        const { store, find } = makeStore({
            Vell_NPC: [{ uid: '1', comment: 'Hand-written note', content: 'x' }],
        })
        await applyCommit(commit({ rename: [{ id: 'Vell_NPC::1', label: 'Renamed note' }] }), {
            store, prefix: 'Vell', ownedBooks: OWNED, readRange: [99],
        })
        expect(find('Vell_NPC', '1')?.comment).toBe('Renamed note')
    })

    it('takes an old title stamp off an entry it appends to, and leaves a plain title alone (73a)', async () => {
        const { store, find } = makeStore({
            Vell_NPC: [{ uid: '1', comment: 'Iron Syndicate [msg #31]', content: 'Old.' }, { uid: '2', comment: 'Plain', content: 'Old.' }],
        })
        await applyCommit(commit({ update: [{ id: 'Vell_NPC::1', content: 'New.' }, { id: 'Vell_NPC::2', content: 'New.' }] }), {
            store, prefix: 'Vell', ownedBooks: OWNED, readRange: [99],
        })
        expect(find('Vell_NPC', '1')?.comment).toBe('Iron Syndicate')
        expect(find('Vell_NPC', '1')?.content).toBe('Old.\n[msg #99] New.')
        expect(find('Vell_NPC', '2')?.comment).toBe('Plain')
    })
})

describe('saying which turn added a paragraph', () => {
    it('marks the prose an update appends', async () => {
        // The request was "each lorebook *update* includes which turn spawned
        // it". A title holds one number; an entry revised across ten turns
        // needs the mark where each addition is.
        const { store, find } = makeStore({ Vell_NPC: [{ uid: '1', content: 'She keeps rope.' }] })
        await applyCommit(commit({ update: [{ id: 'Vell_NPC::1', content: 'Now wary.', msg: 45 }] }), {
            store, prefix: 'Vell', ownedBooks: OWNED, readRange: [45],
        })
        expect(find('Vell_NPC', '1')?.content).toBe('She keeps rope.\n[msg #45] Now wary.')
    })

    it('builds a record across several turns', async () => {
        const { store, find } = makeStore({ Vell_NPC: [{ uid: '1', content: '' }] })
        const at = (n: number, text: string) =>
            applyCommit(commit({ update: [{ id: 'Vell_NPC::1', content: text, msg: n }] }), {
                store, prefix: 'Vell', ownedBooks: OWNED, readRange: [12, 31, 45],
            })

        await at(12, 'Met at the Rest.')
        await at(31, 'Sold them out.')
        await at(45, 'Now wary.')

        expect(find('Vell_NPC', '1')?.content)
            .toBe('[msg #12] Met at the Rest.\n[msg #31] Sold them out.\n[msg #45] Now wary.')
    })

    it('appends unmarked when the pass cannot place itself', async () => {
        const { store, find } = makeStore({ Vell_NPC: [{ uid: '1', content: 'Old.' }] })
        await applyCommit(commit({ update: [{ id: 'Vell_NPC::1', content: 'New.', msg: null }] }), {
            store, prefix: 'Vell', ownedBooks: OWNED, readRange: [],
        })
        expect(find('Vell_NPC', '1')?.content).toBe('Old.\nNew.')
    })

    it('keeps the in-world time marker alongside it, not instead of it', async () => {
        // Story time and chat position are different marks and both are
        // prefixes. timePrefix is the legacy's and still dormant, but if it is
        // ever switched on the two must not fight.
        const { store, find } = makeStore({ Vell_NPC: [{ uid: '1', content: '' }] })
        await applyCommit(commit({ update: [{ id: 'Vell_NPC::1', content: 'Wary.', msg: 45 }] }), {
            store, prefix: 'Vell', ownedBooks: OWNED, timePrefix: '[Day 4]', readRange: [45],
        })
        expect(find('Vell_NPC', '1')?.content).toBe('[Day 4] [msg #45] Wary.')
    })

    it('marks a new entry in the body as well as the title', async () => {
        // These are not a duplicate worth avoiding, which is what the previous
        // version of this test assumed. The title is what you scan in a list;
        // the body is what you read down, and an unmarked opening paragraph
        // above marked ones reads as prose nobody attributed.
        const { store, entriesOf } = makeStore({ Vell_NPC: [] })
        await applyCommit(
            commit({ record: [{ label: 'Iron Syndicate', category: 'NPC', keys: [], content: 'Smugglers.', msg: 31 }] }),
            { store, prefix: 'Vell', ownedBooks: OWNED, readRange: [31] },
        )
        const made = entriesOf('Vell_NPC').at(-1)
        expect(made?.comment).toBe('Iron Syndicate')
        expect(made?.content).toBe('[msg #31] Smugglers.')
    })

    it('reads down an entry\'s whole life with every line attributed', async () => {
        // The shape the maintainer is actually looking at: created at one turn,
        // grown at others, and no line left unaccounted for.
        const { store, entriesOf, find } = makeStore({ Vell_NPC: [] })
        await applyCommit(
            commit({ record: [{ label: 'Iron Syndicate', category: 'NPC', keys: [], content: 'Smugglers.', msg: 31 }] }),
            { store, prefix: 'Vell', ownedBooks: OWNED, readRange: [31] },
        )
        const uid = entriesOf('Vell_NPC').at(-1)!.uid
        await applyCommit(commit({ update: [{ id: `Vell_NPC::${uid}`, content: 'Now wary.', msg: 45 }] }), {
            store, prefix: 'Vell', ownedBooks: OWNED, readRange: [31, 45],
        })

        expect(find('Vell_NPC', uid)?.content).toBe('[msg #31] Smugglers.\n[msg #45] Now wary.')
    })

    it('leaves a new entry unmarked in both places when there is no number', async () => {
        const { store, entriesOf } = makeStore({ Vell_NPC: [] })
        await applyCommit(
            commit({ record: [{ label: 'Iron Syndicate', category: 'NPC', keys: [], content: 'Smugglers.', msg: null }] }),
            { store, prefix: 'Vell', ownedBooks: OWNED, readRange: [] },
        )
        const made = entriesOf('Vell_NPC').at(-1)
        expect(made?.comment).toBe('Iron Syndicate')
        expect(made?.content).toBe('Smugglers.')
    })
})

describe('stamping the turn a thing happened in, not the turn the pass ran', () => {
    it('uses the message the model cited, not the newest one it read', async () => {
        // The reported bug: a pass reading 40-45 recorded a betrayal that
        // happened at 43 as having happened at 45.
        const { store, entriesOf } = makeStore({ Vell_NPC: [] })
        await applyCommit(
            commit({ record: [{ label: 'Betrayal', category: 'NPC', keys: [], content: 'Sold them out.', msg: 43 }] }),
            { store, prefix: 'Vell', ownedBooks: OWNED, readRange: [40, 41, 42, 43, 44, 45] },
        )
        const made = entriesOf('Vell_NPC').at(-1)
        expect(made?.comment).toBe('Betrayal')
        expect(made?.content).toBe('[msg #43] Sold them out.')
    })

    it('gives two items from one pass their own turns', async () => {
        // One pass, one commit, two things that happened at different times.
        const { store, entriesOf } = makeStore({ Vell_NPC: [] })
        await applyCommit(
            commit({
                record: [
                    { label: 'Meeting', category: 'NPC', keys: [], content: 'Met at the Rest.', msg: 41 },
                    { label: 'Betrayal', category: 'NPC', keys: [], content: 'Sold them out.', msg: 44 },
                ],
            }),
            { store, prefix: 'Vell', ownedBooks: OWNED, readRange: [41, 42, 43, 44] },
        )
        const made = entriesOf('Vell_NPC').map((entry) => entry.comment)
        expect(made).toContain('Meeting')
        expect(made).toContain('Betrayal')
    })

    it('refuses to file a record in World Progression\'s book', async () => {
        const { store } = makeStore({ Vell_World: [] })
        const report = await applyCommit(
            commit({ record: [{ label: 'Day 9', category: 'World', keys: [], content: 'invented report' }] }),
            { store, prefix: 'Vell', ownedBooks: ['Vell_World'] },
        )
        expect(report.changed).toEqual([])
        expect(report.refused[0]).toContain('World Progression')
        expect(report.refused[0]).toContain('switch the WORLD module off under Agent modules')
        // And the seed book (33b), by the same rule.
        const seeds = makeStore({ Vell_Skeleton: [] })
        const seeded = await applyCommit(
            commit({ record: [{ label: 'Harrowgate', category: 'Skeleton', keys: [], content: 'invented seed' }] }),
            { store: seeds.store, prefix: 'Vell', ownedBooks: ['Vell_Skeleton'] },
        )
        expect(seeded.changed).toEqual([])
        expect(seeded.refused[0]).toContain('World Progression')
        expect(seeds.store).toBeDefined()
    })

    it('refuses a number the pass never read rather than writing a wrong one', async () => {
        const { store, entriesOf } = makeStore({ Vell_NPC: [] })
        await applyCommit(
            commit({ record: [{ label: 'Invented', category: 'NPC', keys: [], content: 'x', msg: 999 }] }),
            { store, prefix: 'Vell', ownedBooks: OWNED, readRange: [40, 41] },
        )
        expect(entriesOf('Vell_NPC').at(-1)?.comment).toBe('Invented')
    })

    it('writes nothing rather than guessing when the model cited nothing', async () => {
        const { store, entriesOf } = makeStore({ Vell_NPC: [] })
        await applyCommit(
            commit({ record: [{ label: 'Unplaced', category: 'NPC', keys: [], content: 'x' }] }),
            { store, prefix: 'Vell', ownedBooks: OWNED, readRange: [40, 41, 42] },
        )
        expect(entriesOf('Vell_NPC').at(-1)?.comment).toBe('Unplaced')
    })

    it('fills in the only message a one-message pass could have meant', async () => {
        // A deduction rather than a guess.
        const { store, entriesOf } = makeStore({ Vell_NPC: [] })
        await applyCommit(
            commit({ record: [{ label: 'Deduced', category: 'NPC', keys: [], content: 'x' }] }),
            { store, prefix: 'Vell', ownedBooks: OWNED, readRange: [43] },
        )
        expect(entriesOf('Vell_NPC').at(-1)?.comment).toBe('Deduced')
    })
})
