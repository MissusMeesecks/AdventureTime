import { describe, expect, it } from 'vitest'

import {
    bookBelongsToCampaign,
    bookStanding,
    campaignBookName,
    isWritableBook,
    mintCampaignName,
    uniqueCampaignName,
    rememberCampaignBook,
    resolveCampaignPrefix,
    sanitizeCampaignPrefix,
} from './campaign.js'

describe('naming a campaign', () => {
    it('turns what a user typed into a name a lorebook can carry', () => {
        expect(sanitizeCampaignPrefix('Vellmoor: Book II')).toBe('Vellmoor_Book_II')
        expect(sanitizeCampaignPrefix('  spaced  out  ')).toBe('spaced_out')
    })

    it('never leaves a trailing separator, which would widen what it owns', () => {
        // A prefix ending in `_` would make `Vellmoor__NPCs` look like one
        // segment below `Vellmoor_`. The separator is what the ownership
        // check counts, so it cannot be part of the prefix.
        expect(sanitizeCampaignPrefix('Vellmoor_')).toBe('Vellmoor')
        expect(sanitizeCampaignPrefix('___Vellmoor___')).toBe('Vellmoor')
    })

    it('builds a category book underneath the campaign', () => {
        expect(campaignBookName('Vellmoor', 'NPC')).toBe('Vellmoor_NPC')
        expect(campaignBookName('Vellmoor', '')).toBe('Vellmoor')
    })

    it('keeps a punctuated category to one segment, so the book stays ours', () => {
        // Caught by this test: sanitizing the category the same way as the
        // prefix turned `NPC: Minor` into `Vellmoor_NPC_Minor`, two segments
        // below the campaign — a book the campaign creates and then disowns.
        // Separators are removed from a category rather than substituted.
        expect(campaignBookName('Vellmoor', 'NPC: Minor')).toBe('Vellmoor_NPCMinor')
        expect(bookBelongsToCampaign(campaignBookName('Vellmoor', 'NPC: Minor'), 'Vellmoor')).toBe(true)
    })

    it.each(['NPC', 'LOC', 'FAC', 'EVENT', 'STATS'])('leaves the stock category %s alone', (category) => {
        expect(campaignBookName('Vellmoor', category)).toBe(`Vellmoor_${category}`)
    })
})

describe('resolving which campaign a chat belongs to', () => {
    it('derives a prefix from the chat when the user has named nothing', () => {
        expect(resolveCampaignPrefix({ chatId: 'chat-42' })).toBe('chat_42')
    })

    it('uses the name the user typed, for the chat they typed it in', () => {
        expect(resolveCampaignPrefix({ chatId: 'c1', override: 'Vellmoor', anchorChatId: 'c1' }))
            .toBe('Vellmoor')
    })

    it('does not lend one chat\'s campaign name to another', () => {
        // Branching a campaign makes a second chat. Without the anchor both
        // would resolve to one prefix and share a stack of books, so a
        // deactivation in one branch would land in the other.
        expect(resolveCampaignPrefix({ chatId: 'c2', override: 'Vellmoor', anchorChatId: 'c1' }))
            .toBe('c2')
    })

    it('refuses an override with no chat anchored to it', () => {
        // The legacy resolved this against whichever chat was on screen. That
        // is ambient state, and the safe half of the behaviour is to decline.
        expect(resolveCampaignPrefix({ chatId: 'c1', override: 'Vellmoor' })).toBe('c1')
    })
})

describe('deciding what the agent may write to', () => {
    const PREFIX = 'Vellmoor'

    it('writes to a book it made', () => {
        expect(bookStanding('Vellmoor_NPCs', PREFIX, ['Vellmoor_NPCs'])).toBe('owned')
        expect(isWritableBook('Vellmoor_NPCs', PREFIX, ['Vellmoor_NPCs'])).toBe(true)
    })

    it('refuses a book that merely looks like one of ours', () => {
        // The requirement, in one test: a lorebook that existed before this
        // campaign adopted its name is not ours to overwrite, however much the
        // name suggests otherwise. It is offered for adoption, not taken.
        expect(bookStanding('Vellmoor_NPCs', PREFIX, [])).toBe('adoptable')
        expect(isWritableBook('Vellmoor_NPCs', PREFIX, [])).toBe(false)
    })

    it('refuses a book belonging to nobody here at all', () => {
        expect(bookStanding('My World Bible', PREFIX, [])).toBe('foreign')
        expect(isWritableBook('My World Bible', PREFIX, [])).toBe(false)
    })

    it('keeps a book we made even after the campaign is renamed', () => {
        // The recorded list outranks the name in both directions. Renaming a
        // campaign must not orphan the books it already wrote.
        expect(bookStanding('Vellmoor_NPCs', 'Ashfell', ['Vellmoor_NPCs'])).toBe('owned')
    })

    it('matches a recorded book without regard to case', () => {
        expect(bookStanding('vellmoor_npcs', PREFIX, ['Vellmoor_NPCs'])).toBe('owned')
    })

    it('refuses an empty name outright', () => {
        expect(bookStanding('', PREFIX, [''])).toBe('foreign')
    })

    it('treats a book two segments deep as somebody else\'s', () => {
        expect(bookStanding('Vellmoor_NPCs_Old', PREFIX, [])).toBe('foreign')
    })
})

describe('recording a book as the campaign\'s', () => {
    it('adds a book and makes it writable', () => {
        const owned = rememberCampaignBook([], 'Vellmoor_NPCs')
        expect(owned).toEqual(['Vellmoor_NPCs'])
        expect(isWritableBook('Vellmoor_NPCs', 'Vellmoor', owned)).toBe(true)
    })

    it('does not record the same book twice', () => {
        expect(rememberCampaignBook(['Vellmoor_NPCs'], 'vellmoor_npcs')).toEqual(['Vellmoor_NPCs'])
    })

    it('ignores an empty name', () => {
        expect(rememberCampaignBook(['A'], '  ')).toEqual(['A'])
    })

    it('returns a new list rather than editing the one it was given', () => {
        // The list travels in a snapshot that an undo reads back. Mutating it
        // would edit the baseline the undo is measured against.
        const before = ['A']
        const after = rememberCampaignBook(before, 'B')
        expect(before).toEqual(['A'])
        expect(after).toEqual(['A', 'B'])
    })
})

describe('a self-made name (51)', () => {
    const at = new Date(2026, 9, 11, 14, 32)

    it('is the card’s first letters and the clock, letters and digits only, Chat without a card', () => {
        expect(mintCampaignName('Vellmoor Keeper', at)).toBe('Vell_261011_1432')
        expect(mintCampaignName("Mother Sedge", at)).toBe('Moth_261011_1432')
        expect(mintCampaignName('  Zé-7 x', at)).toBe('Z7x_261011_1432')
        expect(mintCampaignName('', at)).toBe('Chat_261011_1432')
        expect(mintCampaignName('—', new Date(2026, 0, 2, 3, 4))).toBe('Chat_260102_0304')
        // The sanitizer has nothing to change, so the prefix is the name.
        expect(sanitizeCampaignPrefix(mintCampaignName('Vellmoor', at))).toBe('Vell_261011_1432')
        expect(campaignBookName(mintCampaignName('Vellmoor', at), 'NPC')).toBe('Vell_261011_1432_NPC')
        expect(bookBelongsToCampaign('Vell_261011_1432_NPC', 'Vell_261011_1432')).toBe(true)
    })

    it('takes a letter when another chat carries the name, case-blind', () => {
        expect(uniqueCampaignName('Vell_261011_1432', [])).toBe('Vell_261011_1432')
        expect(uniqueCampaignName('Vell_261011_1432', ['vell_261011_1432'])).toBe('Vell_261011_1432b')
        expect(uniqueCampaignName('Vell_261011_1432', ['Vell_261011_1432', 'Vell_261011_1432b'])).toBe('Vell_261011_1432c')
        expect(uniqueCampaignName('X', ['Other'])).toBe('X')
    })
})
