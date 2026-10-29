import { describe, expect, it } from 'vitest'

import {
    carryStamp,
    newestMessageNumber,
    resolveTurn,
    stampContent,
    stampLabel,
    stampOn,
    stripContentStamp,
    stripStamp,
} from './provenance.js'

describe('the number a stamp uses', () => {
    it('takes the host\'s own number, which is the one on the bubble', () => {
        // Phase 10b: a number shown so it can be matched against the chat has
        // to come from the chat. Deriving one was off by one, and only the
        // maintainer knowing their own chat caught it.
        expect(newestMessageNumber([{ index_in_chat: 12 }, { index_in_chat: 31 }])).toBe(31)
    })

    it('counts message zero as a real message', () => {
        // Two places once treated zero as absent and a third coerced null into
        // it. Zero is the first message.
        expect(newestMessageNumber([{ index_in_chat: 0 }])).toBe(0)
    })

    it.each([
        ['an empty chat', []],
        ['a host that reports no number', [{}]],
        ['a number that is not one', [{ index_in_chat: 'seventeen' }]],
        ['a negative number', [{ index_in_chat: -1 }]],
    ])('has no number for %s', (_label, messages) => {
        expect(newestMessageNumber(messages)).toBeNull()
    })
})

describe('titling an entry the agent creates (73a: the title is the name, no stamp)', () => {
    it('gives the plain name whatever turn the pass is on', () => {
        // Departure 11, the maintainer's decision of 2026-10-21: the turn is
        // on the prose, and a title is what every lookup compares (lesson 64).
        expect(stampLabel('Iron Syndicate', 31)).toBe('Iron Syndicate')
        expect(stampLabel('The Inn', 0)).toBe('The Inn')
        expect(stampLabel('Iron Syndicate', null)).toBe('Iron Syndicate')
    })

    it('takes off a stamp the model wrote back into the label', () => {
        // The model is shown titles written before 73a and will echo one.
        expect(stampLabel('Iron Syndicate [msg #12]', 31)).toBe('Iron Syndicate')
        expect(stampLabel('  Iron Syndicate [msg #12]  ', null)).toBe('Iron Syndicate')
    })

    it('leaves nothing of a label that is nothing but a stamp', () => {
        expect(stampLabel('[msg #12]', 31)).toBe('')
        expect(stampLabel('[msg #12]', null)).toBe('')
    })
})

describe('reading a stamp back off a title', () => {
    it('gives the entry its own name', () => {
        expect(stripStamp('Iron Syndicate [msg #31]')).toBe('Iron Syndicate')
    })

    it('leaves an unstamped title exactly as it is', () => {
        expect(stripStamp('Iron Syndicate')).toBe('Iron Syndicate')
        expect(stripStamp('')).toBe('')
    })

    it('does not mistake a number inside the name for a stamp', () => {
        // Only a bracketed stamp at the very end counts.
        expect(stripStamp('Room [msg #3] of the Keep')).toBe('Room [msg #3] of the Keep')
        expect(stripStamp('Legion #31')).toBe('Legion #31')
        expect(stripStamp('The 31st Regiment')).toBe('The 31st Regiment')
    })

    it('finds the stamp itself when there is one', () => {
        expect(stampOn('Iron Syndicate [msg #31]')).toBe('[msg #31]')
        expect(stampOn('Iron Syndicate')).toBe('')
    })
})

describe('renaming an entry (73a)', () => {
    it('gives the plain new name, and an old title stamp comes off with the rename', () => {
        expect(carryStamp('The Syndicate', 'Iron Syndicate [msg #31]')).toBe('The Syndicate')
        expect(carryStamp('The Syndicate', 'Iron Syndicate')).toBe('The Syndicate')
    })

    it('takes off a stamp the model repeats in its new label', () => {
        expect(carryStamp('The Syndicate [msg #99]', 'Iron Syndicate [msg #31]')).toBe('The Syndicate')
    })

    it('gives nothing for an empty new name, whatever the old title carried', () => {
        expect(carryStamp('', 'Iron Syndicate [msg #31]')).toBe('')
    })
})

describe('marking the prose an update adds', () => {
    it('says which turn added this paragraph', () => {
        // The maintainer's actual words were "each lorebook *update*". A title
        // can only hold one number; an entry revised across ten turns needs the
        // mark where the new prose is.
        expect(stampContent('She now distrusts the Syndicate.', 45))
            .toBe('[msg #45] She now distrusts the Syndicate.')
    })

    it('adds nothing when the pass cannot place itself', () => {
        expect(stampContent('She now distrusts them.', null)).toBe('She now distrusts them.')
    })

    it('marks the first message as zero rather than dropping it', () => {
        expect(stampContent('It begins.', 0)).toBe('[msg #0] It begins.')
    })

    it('never doubles a stamp the model echoed back', () => {
        // The agent reads entries on later passes and will eventually copy one.
        expect(stampContent('[msg #12] She distrusts them.', 45)).toBe('[msg #45] She distrusts them.')
    })

    it('does not stamp prose that is not there', () => {
        // A paragraph that is nothing but a turn number is not lore. The text
        // itself is handed back untouched — this stamps, it does not clean.
        expect(stampContent('', 45)).toBe('')
        expect(stampContent('   ', 45)).toBe('   ')
    })

    it('only strips a stamp at the very start, not one inside the prose', () => {
        expect(stripContentStamp('She said "[msg #3]" aloud.')).toBe('She said "[msg #3]" aloud.')
        expect(stripContentStamp('[msg #3] Real prose.')).toBe('Real prose.')
    })
})

describe('deciding which turn a piece of lore belongs to', () => {
    const READ = [40, 41, 42, 43, 44, 45]

    it('believes a citation for a message the pass actually read', () => {
        // The bug this exists to fix: a pass reading 40-45 stamped everything
        // #45, so a betrayal at 43 was recorded as having happened at 45.
        expect(resolveTurn(43, READ)).toBe(43)
    })

    it('does not take the newest message as the answer', () => {
        expect(resolveTurn(43, READ)).not.toBe(45)
    })

    it('refuses a number the pass never read', () => {
        // A model asked for a message id will occasionally invent one, and an
        // invented number is worse than none because it looks checked.
        expect(resolveTurn(999, READ)).toBeNull()
        expect(resolveTurn(39, READ)).toBeNull()
    })

    it('says nothing when the model cited nothing and the window is wide', () => {
        // Phase 10a's rule: no number rather than the wrong one.
        expect(resolveTurn(null, READ)).toBeNull()
    })

    it('fills in the only message there was, which is a deduction not a guess', () => {
        // A pass that read one message found everything in that message.
        expect(resolveTurn(null, [43])).toBe(43)
    })

    it('has no answer when the pass read nothing it could number', () => {
        expect(resolveTurn(null, [])).toBeNull()
        expect(resolveTurn(43, [])).toBeNull()
    })

    it('treats message zero as citable', () => {
        expect(resolveTurn(0, [0, 1])).toBe(0)
        expect(resolveTurn(null, [0])).toBe(0)
    })
})
