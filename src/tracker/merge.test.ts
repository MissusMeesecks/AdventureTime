import { describe, expect, it } from 'vitest'

import { computeDelta, deduplicateMemo, escapeRegex, mergeMemo, mergeMemoDetailed } from './merge.js'
import { parseMemoBlocks } from './memo.js'

const PRIOR = [
    '[TIME]',
    '06:15 AM, Day 4',
    '[/TIME]',
    '',
    '[WAYSTONE]',
    'Attunement: ((BARCYAN)) 640/1000',
    'Steward: Odile',
    '[/WAYSTONE]',
].join('\n')

describe('a pass that changes nothing', () => {
    // The most important behaviour in the file. A model that refuses, rambles,
    // or gets cut off must not be able to clear a campaign's state.
    it.each([
        ['an empty response', ''],
        ['prose', 'No changes this turn.'],
        ['a refusal', 'I cannot help with that request.'],
        ['an unterminated block', '[TIME]\n07:00 AM, Day 4'],
        ['a stray closing tag', '[/TIME]\n07:00'],
        ['a block with no closing tag at all', '[TIME] 07:00 AM'],
    ])('leaves the memo untouched given %s', (_label, output) => {
        expect(mergeMemo(PRIOR, output)).toBe(PRIOR)
    })

    it('reports itself as a no-change rather than as a normal merge', () => {
        const result = mergeMemoDetailed(PRIOR, 'No changes this turn.')
        expect(result.noChange).toBe(true)
        expect(result).toMatchObject({ replaced: [], added: [], removed: [] })
    })
})

describe('replacing a block', () => {
    it('rewrites only the block the pass emitted', () => {
        const merged = mergeMemo(PRIOR, '[TIME]\n07:00 AM, Day 4\n[/TIME]')
        const blocks = parseMemoBlocks(merged)
        expect(blocks.TIME).toBe('07:00 AM, Day 4')
        expect(blocks.WAYSTONE).toBe('Attunement: ((BARCYAN)) 640/1000\nSteward: Odile')
    })

    it('matches an existing block regardless of the case it was written in', () => {
        expect(parseMemoBlocks(mergeMemo(PRIOR, '[time]\n07:00\n[/time]')).TIME).toBe('07:00')
    })

    it('writes regex metacharacters through literally', () => {
        // `$&` in a replacement string would otherwise re-insert the match.
        const merged = mergeMemo(PRIOR, '[WAYSTONE]\nSteward: $& $1 cost: $100\n[/WAYSTONE]')
        expect(parseMemoBlocks(merged).WAYSTONE).toBe('Steward: $& $1 cost: $100')
    })

    it('handles several blocks in one pass', () => {
        const result = mergeMemoDetailed(PRIOR, '[TIME]\n08:00\n[/TIME]\n[XP]\n1/2\n[/XP]')
        expect(result.replaced).toEqual(['TIME'])
        expect(result.added).toEqual(['XP'])
    })

    it('ignores prose wrapped around a real block', () => {
        const merged = mergeMemo(PRIOR, 'Here is the update:\n[TIME]\n09:00\n[/TIME]\nAnything else?')
        expect(parseMemoBlocks(merged).TIME).toBe('09:00')
        expect(merged).not.toContain('Anything else')
    })
})

describe('adding a block', () => {
    it('appends one the memo did not have', () => {
        const result = mergeMemoDetailed(PRIOR, '[SECRETS]\n- A loose floorboard\n[/SECRETS]')
        expect(result.added).toEqual(['SECRETS'])
        expect(parseMemoBlocks(result.memo).SECRETS).toBe('- A loose floorboard')
    })

    it('starts a memo from nothing', () => {
        expect(parseMemoBlocks(mergeMemo('', '[TIME]\nDay 1\n[/TIME]')).TIME).toBe('Day 1')
    })
})

describe('erasing a block', () => {
    it.each(['REMOVED', 'EXPIRED', 'CLEARED', 'NONE', 'END_COMBAT', 'removed', 'None'])(
        'removes the block for %s',
        (word) => {
            const result = mergeMemoDetailed(PRIOR, `[WAYSTONE]\n${word}\n[/WAYSTONE]`)
            expect(result.removed).toEqual(['WAYSTONE'])
            expect(parseMemoBlocks(result.memo).WAYSTONE).toBeUndefined()
            expect(parseMemoBlocks(result.memo).TIME).toBeDefined()
        },
    )

    it('treats an empty pair as an erasure rather than writing a hollow block', () => {
        // Weaker models emit these for a module with nothing to report.
        const merged = mergeMemo(PRIOR, '[WAYSTONE]\n[/WAYSTONE]')
        expect(merged).not.toContain('WAYSTONE')
    })

    it('does not erase on a word that merely starts with a removal term', () => {
        const merged = mergeMemo(PRIOR, '[WAYSTONE]\nNONE of the readings changed\n[/WAYSTONE]')
        expect(parseMemoBlocks(merged).WAYSTONE).toBe('NONE of the readings changed')
    })

    it('is a no-op when the block was never there', () => {
        const result = mergeMemoDetailed(PRIOR, '[NOSUCHBLOCK]\nREMOVED\n[/NOSUCHBLOCK]')
        expect(result.removed).toEqual([])
        expect(result.memo).toBe(PRIOR)
    })

    it('leaves no blank gap where the block was', () => {
        expect(mergeMemo(PRIOR, '[TIME]\nREMOVED\n[/TIME]')).not.toMatch(/\n{3,}/)
    })
})

describe('deduplicateMemo', () => {
    it('keeps the last of a repeated block', () => {
        expect(parseMemoBlocks(deduplicateMemo('[XP]\n1\n[/XP]\n[XP]\n2\n[/XP]')).XP).toBe('2')
    })

    it('leaves a memo with no duplicates alone', () => {
        expect(deduplicateMemo(PRIOR)).toBe(PRIOR)
    })

    it('handles an underscored custom tag', () => {
        const memo = '[MORALE_INDEX]\na\n[/MORALE_INDEX]\n[MORALE_INDEX]\nb\n[/MORALE_INDEX]'
        expect(parseMemoBlocks(deduplicateMemo(memo)).MORALE_INDEX).toBe('b')
    })

    it('leaves a space-containing tag alone, as the legacy scan does', () => {
        // The duplicate scan matches [A-Z_]+ only. Widening it would change
        // which memos get rewritten, so the quirk is kept deliberately.
        const memo = '[BENCHED PARTY]\na\n[/BENCHED PARTY]\n[BENCHED PARTY]\nb\n[/BENCHED PARTY]'
        expect(deduplicateMemo(memo)).toBe(memo)
    })

    it('collapses runs of blank lines', () => {
        expect(deduplicateMemo('[A]\nx\n[/A]\n\n\n\n[B]\ny\n[/B]')).toBe('[A]\nx\n[/A]\n\n[B]\ny\n[/B]')
    })

    it('returns empty for empty input', () => {
        expect(deduplicateMemo('')).toBe('')
    })

    it('runs as part of a merge, so a doubled pass output collapses', () => {
        expect(parseMemoBlocks(mergeMemo('', '[XP]\n1\n[/XP]\n[XP]\n2\n[/XP]')).XP).toBe('2')
    })
})

describe('computeDelta', () => {
    it('names what was added, removed and changed', () => {
        const before = '[TIME]\nDay 4\n[/TIME]\n[XP]\n1\n[/XP]'
        const after = '[TIME]\nDay 5\n[/TIME]\n[SECRETS]\nx\n[/SECRETS]'
        expect(computeDelta(before, after)).toEqual({ added: ['SECRETS'], removed: ['XP'], changed: ['TIME'] })
    })

    it('does not report a change when only block order moved', () => {
        // deduplicateMemo can move a block to the end; that is not a change.
        const before = '[A]\nx\n[/A]\n[B]\ny\n[/B]'
        const after = '[B]\ny\n[/B]\n[A]\nx\n[/A]'
        expect(computeDelta(before, after)).toEqual({ added: [], removed: [], changed: [] })
    })

    it('copes with an empty side', () => {
        expect(computeDelta('', '[A]\nx\n[/A]').added).toEqual(['A'])
        expect(computeDelta('[A]\nx\n[/A]', '').removed).toEqual(['A'])
    })
})

describe('escapeRegex', () => {
    it('neutralises metacharacters so a tag is matched literally', () => {
        expect(new RegExp(escapeRegex('A+B[C]')).test('A+B[C]')).toBe(true)
    })
})
