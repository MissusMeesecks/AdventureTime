import { describe, expect, it } from 'vitest'

import { hasBullet, isErasedBlockContent, parseMemoBlocks, splitBlockLines, stripMemoHtml } from './memo.js'

describe('parseMemoBlocks', () => {
    it('reads a block into tag and content', () => {
        expect(parseMemoBlocks('[TIME]\n06:15 AM, Day 4\n[/TIME]')).toEqual({ TIME: '06:15 AM, Day 4' })
    })

    it('keeps several blocks apart, including narrative between them', () => {
        const memo = 'chatter\n[TIME]\nDay 4\n[/TIME]\nmore chatter\n[XP]\n450/1000\n[/XP]'
        expect(parseMemoBlocks(memo)).toEqual({ TIME: 'Day 4', XP: '450/1000' })
    })

    it('upper-cases the tag, so [time] and [TIME] are one block', () => {
        expect(parseMemoBlocks('[time]\nDay 4\n[/time]')).toEqual({ TIME: 'Day 4' })
    })

    it('keeps the last of a repeated tag', () => {
        // A model that emits a block twice has usually corrected itself.
        expect(parseMemoBlocks('[XP]\n1\n[/XP]\n[XP]\n2\n[/XP]')).toEqual({ XP: '2' })
    })

    it('skips an unterminated block rather than swallowing the rest', () => {
        expect(parseMemoBlocks('[XP]\n450\n[TIME]\nDay 4\n[/TIME]')).toEqual({ TIME: 'Day 4' })
    })

    it('handles a tag with a space in it', () => {
        expect(parseMemoBlocks('[BENCHED PARTY]\nBrenna\n[/BENCHED PARTY]')).toEqual({ 'BENCHED PARTY': 'Brenna' })
    })

    it('preserves inner line structure but trims the edges', () => {
        expect(parseMemoBlocks('[A]\n\n  one\n  two\n\n[/A]').A).toBe('one\n  two')
    })

    it('returns nothing for a memo with no blocks', () => {
        expect(parseMemoBlocks('just narrative')).toEqual({})
        expect(parseMemoBlocks('')).toEqual({})
    })
})

describe('erasure sentinels', () => {
    it.each(['REMOVED', 'EXPIRED', 'CLEARED', 'NONE', 'none', '  none  ', ''])('treats %j as erased', (content) => {
        expect(isErasedBlockContent(content)).toBe(true)
    })

    it.each(['NONE of your business', 'Steward: Odile', '0/5'])('leaves %j alone', (content) => {
        expect(isErasedBlockContent(content)).toBe(false)
    })
})

describe('splitBlockLines', () => {
    it('drops blank lines and trims what is left', () => {
        expect(splitBlockLines('a\n\n  b  \n').lines).toEqual(['a', 'b'])
    })

    it('strips bullets for display but records the originals', () => {
        const { raw, lines } = splitBlockLines('- Sword\n* Shield\n• Rope')
        expect(lines).toEqual(['Sword', 'Shield', 'Rope'])
        expect(raw).toEqual(['- Sword', '* Shield', '• Rope'])
    })

    it('does not mistake a negative number for a bullet', () => {
        expect(splitBlockLines('-5 HP').lines).toEqual(['-5 HP'])
        expect(hasBullet('-5 HP')).toBe(false)
        expect(hasBullet('- 5 HP')).toBe(true)
    })
})

describe('stripMemoHtml', () => {
    it('removes tags but keeps their text', () => {
        expect(stripMemoHtml('<font color="red">Hostile</font>')).toBe('Hostile')
    })

    it('turns <br> into a real line break so line structure survives', () => {
        expect(stripMemoHtml('a<br>b<br />c')).toBe('a\nb\nc')
    })

    it('leaves markers alone — the model is meant to echo them back', () => {
        expect(stripMemoHtml('Attunement: ((BARCYAN)) 640/1000')).toBe('Attunement: ((BARCYAN)) 640/1000')
    })
})
