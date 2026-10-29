import { describe, expect, it } from 'vitest'

import { MAX_INDEX_ENTRIES, buildCampaignIndex, categoriesInUse } from './inventory.js'

const book = (name: string, ...titles: string[]) => ({
    name,
    entries: titles.map((comment, i) => ({ uid: `u${i + 1}`, comment })),
})

describe('the index of what the books already hold', () => {
    it('gives every entry its full address, so nothing has to be looked up', () => {
        // The pass that prompted this spent three turns calling inspect_book on
        // the three books it had just been shown, purely to turn titles into
        // ids — and a fourth inventing an address that did not exist.
        expect(buildCampaignIndex([book('Vell_Events', 'Day Three — Road to Hallen')])).toBe(
            'Vell_Events (1 entry):\n'
            + '  "Day Three — Road to Hallen" → Vell_Events::u1',
        )
    })

    it('lists each book with all of its entries', () => {
        const index = buildCampaignIndex([book('Vell_Characters', 'Wrenna', 'Lissa')])
        expect(index).toContain('Vell_Characters (2 entries):')
        expect(index).toContain('"Wrenna" → Vell_Characters::u1')
        expect(index).toContain('"Lissa" → Vell_Characters::u2')
    })

    it('says a book is empty rather than leaving the line blank', () => {
        // "Vell_Events:" with nothing after it reads as a rendering fault.
        // The whole point of the index is that an absence is visible.
        expect(buildCampaignIndex([book('Vell_Events')])).toBe('Vell_Events: (empty)')
    })

    it('is empty when the campaign has no books, so the prompt can say something else', () => {
        expect(buildCampaignIndex([])).toBe('')
    })

    it('caps a long book and says how many it did not list', () => {
        const titles = Array.from({ length: MAX_INDEX_ENTRIES + 7 }, (_, i) => `Entry ${i + 1}`)
        const index = buildCampaignIndex([book('Vell_Characters', ...titles)])

        expect(index).toContain(`(${MAX_INDEX_ENTRIES + 7} entries)`)
        expect(index).toContain(`"Entry ${MAX_INDEX_ENTRIES}" →`)
        expect(index).not.toContain(`"Entry ${MAX_INDEX_ENTRIES + 1}" →`)
        expect(index).toContain(`…and 7 more, not listed`)
    })

    it('does not claim there are more when it listed them all', () => {
        expect(buildCampaignIndex([book('Vell_World', 'Hallen')])).not.toContain('more')
    })

    it('names an untitled entry rather than showing a gap', () => {
        const index = buildCampaignIndex([{ name: 'Vell_World', entries: [{ uid: '7', comment: '  ' }] }])
        expect(index).toBe('Vell_World (1 entry):\n  "(untitled)" → Vell_World::7')
    })
})

describe('the categories a campaign already files under', () => {
    // A category becomes a book name. Live, one commit produced Vell_NPC
    // beside the Vell_Characters it had been shown in the same prompt.
    it('reads them off the campaign\'s own book names', () => {
        expect(categoriesInUse(['Vell_Characters', 'Vell_Events', 'Vell_World'], 'Vell'))
            .toEqual(['Characters', 'Events', 'World'])
    })

    it('ignores books belonging to anyone else', () => {
        expect(categoriesInUse(['Vell_Characters', 'My World Bible', 'Other_NPCs'], 'Vell'))
            .toEqual(['Characters'])
    })

    it('ignores a bare prefix, which names no category', () => {
        expect(categoriesInUse(['Vell', 'Vell_Events'], 'Vell')).toEqual(['Events'])
    })

    it('does not repeat a category that differs only in case', () => {
        expect(categoriesInUse(['Vell_Events', 'Vell_events'], 'Vell')).toEqual(['Events'])
    })

    it('is empty for a campaign with no books', () => {
        expect(categoriesInUse([], 'Vell')).toEqual([])
    })
})

describe('what the model is shown of a stamp', () => {
    it('shows the entry name without the turn stamp', async () => {
        // The stamp is for a person reading the book. Showing the model a turn
        // number on every pass is how it ends up in a label the model writes —
        // 9p's lesson, where a free-hand category became a book name.
        const index = buildCampaignIndex([
            { name: 'Vell_NPC', entries: [{ uid: '4', comment: 'Iron Syndicate [msg #31]' }] },
        ])
        expect(index).toContain('"Iron Syndicate"')
        expect(index).not.toContain('msg #31')
    })

    it('still shows the address, which is what the model actually needs', async () => {
        const index = buildCampaignIndex([
            { name: 'Vell_NPC', entries: [{ uid: '4', comment: 'Iron Syndicate [msg #31]' }] },
        ])
        expect(index).toContain('Vell_NPC::4')
    })

    it('calls an entry that is nothing but a stamp untitled, not blank', async () => {
        const index = buildCampaignIndex([
            { name: 'Vell_NPC', entries: [{ uid: '4', comment: '[msg #31]' }] },
        ])
        expect(index).not.toContain('""')
    })
})
