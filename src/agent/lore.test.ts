import { describe, expect, it } from 'vitest'

import { createLoreTools, MAX_SEARCH_HITS, SEARCH_SNIPPET } from './lore.js'
import type { LoreBook, LoreEntry, LoreStore } from './writer.js'

function makeStore(seed: Record<string, Array<Partial<LoreEntry>>>) {
    const books: LoreBook[] = []
    const entries = new Map<string, LoreEntry[]>()
    let n = 1
    for (const [name, list] of Object.entries(seed)) {
        const book = { id: `b${books.length + 1}`, name }
        books.push(book)
        entries.set(book.id, list.map((entry, index) => ({
            id: `e${n++}`,
            uid: entry.uid ?? String(index + 1),
            key: entry.key ?? [],
            content: entry.content ?? '',
            comment: entry.comment ?? '',
        })))
    }
    const store = {
        listBooks: async () => books.map((b) => ({ ...b })),
        listEntries: async (bookId: string) => (entries.get(bookId) ?? []).map((e) => ({ ...e })),
    } as unknown as LoreStore
    return store
}

const SEED = {
    Vell_NPC: [
        { uid: '1', comment: 'Lissa', key: ['Lissa', 'rope-keeper'], content: 'A rope-keeper from the docks.' },
        { uid: '2', comment: 'Thalric Thorne', key: ['Thalric'], content: 'A factor with a bad debt.' },
    ],
    'My World Bible': [{ uid: '1', comment: 'House rules', content: 'The Iron Syndicate runs the docks.' }],
}

const tools = (over = {}) =>
    createLoreTools({ store: makeStore(SEED), prefix: 'Vell', ownedBooks: ['Vell_NPC'], ...over })

describe('searching the lore', () => {
    it('finds an entry by its content, not just its title', async () => {
        // What the tool is actually for: "is there already an entry about this?"
        // before writing a duplicate.
        const out = await tools().grepLore('bad debt')
        expect(out).toContain('Thalric Thorne')
        expect(out).toContain('[Vell_NPC::2]')
    })

    it.each([['a title', 'Lissa'], ['a keyword', 'rope-keeper'], ['different case', 'LISSA']])(
        'finds an entry by %s',
        async (_label, query) => {
            expect(await tools().grepLore(query)).toContain('[Vell_NPC::1]')
        },
    )

    it('carries the address, because a commit has to name what it read', async () => {
        expect(await tools().grepLore('Lissa')).toMatch(/\[Vell_NPC::1\]/)
    })

    it('says plainly when nothing matches', async () => {
        expect(await tools().grepLore('dragons')).toBe('No lore entry mentions "dragons".')
    })

    it('asks for a search term rather than returning everything', async () => {
        expect(await tools().grepLore('  ')).toContain('needs something to search for')
    })

    it('caps the hits, because the answer goes into the next prompt', async () => {
        // An uncapped grep_lore("the") would spend the whole context on one
        // tool call.
        const many = Object.fromEntries([['Vell_NPC', Array.from({ length: 30 }, (_, i) => ({
            uid: String(i + 1), comment: `Entry ${i}`, content: 'common word here',
        }))]])
        const out = await createLoreTools({
            store: makeStore(many), prefix: 'Vell', ownedBooks: ['Vell_NPC'],
        }).grepLore('common')

        expect(out.match(/\[Vell_NPC::/g)).toHaveLength(MAX_SEARCH_HITS)
        expect(out).toContain('there may be more')
    })

    it('truncates a long entry rather than pasting all of it', async () => {
        const long = { Vell_NPC: [{ uid: '1', comment: 'Epic', content: 'x'.repeat(SEARCH_SNIPPET + 500) }] }
        const out = await createLoreTools({
            store: makeStore(long), prefix: 'Vell', ownedBooks: ['Vell_NPC'],
        }).grepLore('xxx')
        expect(out).toContain('…')
        expect(out.length).toBeLessThan(SEARCH_SNIPPET + 300)
    })

    it('reads books outside the campaign, which writing may not touch', async () => {
        // Deliberately asymmetric: reading a user's world bible is how the
        // agent avoids contradicting it; writing to one is what 9b prevents.
        expect(await tools().grepLore('Iron Syndicate')).toContain('My World Bible::1')
    })

    it('can be told to look only at the campaign\'s own books', async () => {
        const out = await tools({ readForeignBooks: false }).grepLore('Iron Syndicate')
        expect(out).toContain('No lore entry mentions')
    })
})

describe('hiding another campaign\'s books', () => {
    const withOther = (over = {}) =>
        createLoreTools({
            store: makeStore({
                ...SEED,
                Vellmoor_Events: [{ uid: '1', comment: 'The Hunt', content: 'Wrenna was taken.' }],
            }),
            prefix: 'Ashfell',
            ownedBooks: [],
            hiddenBooks: ['Vellmoor_Events'],
            ...over,
        })

    it('keeps another campaign\'s lore out of the search', async () => {
        // Live: an agent in one campaign found an entry in another campaign's
        // _Events book and tried to update it. The write would have been
        // refused, but it should never have been offered the entry — a scene
        // from somebody else's story does not belong in this model's context.
        expect(await withOther().grepLore('Wrenna was taken')).toContain('No lore entry mentions')
    })

    it('will not list or read it either', async () => {
        expect(await withOther().inspectBook('Vellmoor_Events')).toContain('no book called')
        expect(await withOther().readEntry('Vellmoor_Events::1')).toContain('no book called')
    })

    it('leaves it out of the list of available books', async () => {
        expect(await withOther().inspectBook('')).not.toContain('Vellmoor_Events')
    })

    it('still reads a genuine world bible, which is background rather than plot', async () => {
        // The distinction the whole thing turns on: a hand-written world bible
        // is context the agent must not contradict; another campaign's books
        // are a different story.
        expect(await withOther().grepLore('Iron Syndicate')).toContain('My World Bible')
    })

    it('matches a hidden book without regard to case', async () => {
        const tools = withOther({ hiddenBooks: ['vellmoor_events'] })
        expect(await tools.grepLore('Wrenna was taken')).toContain('No lore entry mentions')
    })
})

describe('listing a book', () => {
    it('lists its entries with addresses and keys', async () => {
        const out = await tools().inspectBook('Vell_NPC')
        expect(out).toContain('has 2 entries')
        expect(out).toContain('[Vell_NPC::1] Lissa — keys: Lissa, rope-keeper')
    })

    it('matches a book name without regard to case', async () => {
        expect(await tools().inspectBook('vell_npc')).toContain('[Vell_NPC::1]')
    })

    it('names the books that do exist when asked for one that does not', async () => {
        // A dead end that lists the way out. The model can recover from this.
        const out = await tools().inspectBook('Nope')
        expect(out).toContain('no book called "Nope"')
        expect(out).toContain('Vell_NPC')
    })

    it('offers the list when asked for no book at all', async () => {
        expect(await tools().inspectBook('')).toContain('Available: Vell_NPC, My World Bible')
    })
})

describe('reading one entry', () => {
    it('returns it in full, with its address and keys', async () => {
        const out = await tools().readEntry('Vell_NPC::1')
        expect(out).toContain('Entry Vell_NPC::1')
        expect(out).toContain('Keys: Lissa, rope-keeper')
        expect(out).toContain('A rope-keeper from the docks.')
    })

    it.each([
        ['an address with no separator', 'Vell_NPC', /not an entry address/],
        ['a book that does not exist', 'Nope::1', /no book called "Nope"/],
        ['an entry that does not exist', 'Vell_NPC::99', /not an entry in "Vell_NPC"/],
    ])('explains %s rather than failing', async (_label, address, expected) => {
        expect(await tools().readEntry(address)).toMatch(expected)
    })

    it('says so for an entry with nothing in it', async () => {
        const empty = { Vell_NPC: [{ uid: '1', comment: '', content: '' }] }
        const out = await createLoreTools({
            store: makeStore(empty), prefix: 'Vell', ownedBooks: ['Vell_NPC'],
        }).readEntry('Vell_NPC::1')
        expect(out).toContain('(untitled)')
        expect(out).toContain('(no content)')
    })
})

describe('the hidden map (Phase 34)', () => {
    it('never shows the agent a [MAP] section, in a search, a listing or a read, and does not match on it', async () => {
        const seed = {
            Vell_LOC: [{ uid: '1', comment: 'Abbey Undercroft', key: ['undercroft'], content: '[CORE]\nA crypt beneath the abbey.\n[/CORE]\n\n[MAP]\n{"version":3,"site":"Abbey Undercroft","areas":[{"id":"vault","name":"Secret Vault","knowledge":"UNREVEALED","geometry":["Gold-lined shelves."],"connections":[]}],"assets":[]}\n[/MAP]' }],
        }
        const t = createLoreTools({ store: makeStore(seed), prefix: 'Vell', ownedBooks: ['Vell_LOC'] })
        const read = await t.readEntry('Vell_LOC::1')
        expect(read).toContain('A crypt beneath the abbey.')
        expect(read).not.toContain('[MAP]')
        expect(read).not.toContain('Secret Vault')
        const hit = await t.grepLore('crypt')
        expect(hit).toContain('A crypt beneath the abbey.')
        expect(hit).not.toContain('Gold-lined')
        expect(await t.grepLore('Secret Vault')).toContain('No lore entry mentions')
        expect(await t.inspectBook('Vell_LOC')).not.toContain('version')
    })
})
