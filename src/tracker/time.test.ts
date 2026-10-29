import { describe, expect, it } from 'vitest'

import { currentTimeFromMemo, extractCurrentTimeStr, formatTimeDiff, isRestTimeUnset, parseInWorldTime } from './time.js'

describe('extractCurrentTimeStr', () => {
    it('takes the time line and leaves the rest line', () => {
        expect(extractCurrentTimeStr('06:15 AM, Day 4\nLast rest: Day 3')).toBe('06:15 AM, Day 4')
    })

    it('skips a rest line written first', () => {
        expect(extractCurrentTimeStr('Last rest: Day 3\n06:15 AM, Day 4')).toBe('06:15 AM, Day 4')
    })

    it('strips a Time: or Current time: prefix', () => {
        expect(extractCurrentTimeStr('Current time: 09:00 AM, Day 2')).toBe('09:00 AM, Day 2')
        expect(extractCurrentTimeStr('Time: Day 5')).toBe('Day 5')
    })

    it('returns empty for nothing, or for a block that is only a rest line', () => {
        expect(extractCurrentTimeStr('')).toBe('')
        expect(extractCurrentTimeStr(undefined)).toBe('')
        expect(extractCurrentTimeStr('Last rest: Day 3')).toBe('')
    })
})

describe('isRestTimeUnset', () => {
    it.each(['', '   ', 'N/A', 'na', 'NONE', 'never', 'null', '—', '-'])('treats %j as unset', (value) => {
        expect(isRestTimeUnset(value)).toBe(true)
    })

    it('treats a real time as set', () => {
        expect(isRestTimeUnset('Day 3')).toBe(false)
    })
})

describe('currentTimeFromMemo', () => {
    it('finds the [TIME] block contents', () => {
        expect(currentTimeFromMemo('[XP]\n1/2\n[/XP]\n\n[TIME]\n06:15 AM, Day 4\n[/TIME]')).toBe('06:15 AM, Day 4')
    })

    it('is empty when there is no [TIME] block', () => {
        expect(currentTimeFromMemo('[XP]\n1/2\n[/XP]')).toBe('')
        expect(currentTimeFromMemo(null)).toBe('')
    })
})

describe('parseInWorldTime', () => {
    it('counts days from 1, so Day 1 midnight is the epoch', () => {
        expect(parseInWorldTime('Day 1')).toBe(0)
        expect(parseInWorldTime('Day 2')).toBe(1440)
    })

    it('reads the clock', () => {
        expect(parseInWorldTime('08:30 AM, Day 1')).toBe(8 * 60 + 30)
        expect(parseInWorldTime('08:30 PM, Day 1')).toBe(20 * 60 + 30)
    })

    it('gets the two meridiem edge cases right', () => {
        // 12 AM is midnight, 12 PM is noon — the two that a naive +12 breaks.
        expect(parseInWorldTime('12:00 AM, Day 1')).toBe(0)
        expect(parseInWorldTime('12:00 PM, Day 1')).toBe(720)
    })

    it('takes a bare time as day 1, so times within a day still compare', () => {
        expect(parseInWorldTime('10:00 PM')).toBe(22 * 60)
    })

    it('reads a calendar date, with a later date always larger', () => {
        const first = parseInWorldTime('08:00 AM, 01/01/2026')
        const later = parseInWorldTime('08:00 AM, 15/01/2026')
        expect(first).toBeGreaterThan(0)
        expect(later! - first!).toBe(14 * 1440)
    })

    it('expands a two-digit year into the 2000s', () => {
        expect(parseInWorldTime('01/01/26')).toBe(parseInWorldTime('01/01/2026'))
    })

    it('prefers a calendar date over a day counter when both appear', () => {
        expect(parseInWorldTime('Day 3, 01/01/2026')).toBe(parseInWorldTime('01/01/2026'))
    })

    it('returns null rather than zero when there is no time at all', () => {
        // The distinction is load-bearing: 0 is a real time (day 1, midnight),
        // and null is what stops an unreadable deadline reading as one passed.
        expect(parseInWorldTime('nothing here')).toBeNull()
        expect(parseInWorldTime('')).toBeNull()
        expect(parseInWorldTime(null)).toBeNull()
    })

    it.each(['none', 'N/A', '—'])('returns null for the sentinel %j', (value) => {
        expect(parseInWorldTime(value)).toBeNull()
    })

    it('accepts a whole [TIME] block, not just one line', () => {
        expect(parseInWorldTime('06:15 AM, Day 4\nLast rest: Day 3')).toBe(3 * 1440 + 6 * 60 + 15)
    })
})

describe('formatTimeDiff', () => {
    it('names every unit that has something in it, largest first', () => {
        expect(formatTimeDiff(1 * 1440 + 6 * 60 + 15)).toBe('1 day 6 hours 15 minutes ago')
    })

    it('leaves out the units that are zero', () => {
        expect(formatTimeDiff(2 * 1440)).toBe('2 days ago')
        expect(formatTimeDiff(90)).toBe('1 hour 30 minutes ago')
    })

    it('pluralises on more than one, not on one', () => {
        expect(formatTimeDiff(1440)).toBe('1 day ago')
        expect(formatTimeDiff(60)).toBe('1 hour ago')
        expect(formatTimeDiff(1)).toBe('1 minute ago')
    })

    it('takes the direction from the caller, not from the sign', () => {
        // A deadline asks "how long left" and answers "3 hours ago" once it has
        // passed; an accepted time only ever asks the past-tense question. The
        // caller knows which; the number does not.
        expect(formatTimeDiff(180, true)).toBe('3 hours left')
        expect(formatTimeDiff(-180, false)).toBe('3 hours ago')
        expect(formatTimeDiff(-180, true)).toBe('3 hours left')
    })

    it('says due now rather than 0 minutes', () => {
        expect(formatTimeDiff(0, true)).toBe('due now')
        expect(formatTimeDiff(0, false)).toBe('just now')
    })
})
