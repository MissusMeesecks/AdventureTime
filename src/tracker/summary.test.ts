import { describe, expect, it } from 'vitest'

import { summariseTrackerView } from './summary.js'
import { buildTrackerView } from './view.js'

const summarise = (memo: string, settings = {}) => summariseTrackerView(buildTrackerView(memo, settings))

describe('summarising a memo for a fold header', () => {
    const MEMO = [
        '[TIME]',
        '09:30 PM, Day 4',
        '[/TIME]',
        '[COMBAT]',
        'COMBAT ROUND 1',
        '[/COMBAT]',
        '[INVENTORY]',
        'Gear: a knife',
        '[/INVENTORY]',
    ].join('\n')

    it('leads with the in-world clock', () => {
        expect(summarise(MEMO).time).toBe('09:30 PM, Day 4')
        expect(summarise(MEMO).text).toMatch(/^09:30 PM, Day 4 · /)
    })

    it('names the other blocks, in the order they are drawn', () => {
        expect(summarise(MEMO).tags).toEqual(['COMBAT', 'INVENTORY'])
    })

    it('does not name TIME twice', () => {
        // Its content is already the first half of the line.
        expect(summarise(MEMO).tags).not.toContain('TIME')
    })

    it('uses a custom field label rather than its tag', () => {
        const memo = '[WAYSTONE]\nAttunement: 640/1000\n[/WAYSTONE]'
        const settings = { customFields: [{ tag: 'WAYSTONE', label: 'Waystone' }] }
        expect(summarise(memo, settings).tags).toEqual(['Waystone'])
    })

    it('leaves out a block the model erased', () => {
        // `NONE` means the inventory is empty. Naming it would suggest there is
        // something to open the card for.
        const memo = '[TIME]\nDay 4\n[/TIME]\n[INVENTORY]\nNONE\n[/INVENTORY]'
        expect(summarise(memo).tags).toEqual([])
        expect(summarise(memo).text).toBe('Day 4')
    })

    it('says something rather than nothing for an empty memo', () => {
        expect(summarise('').text).toBe('Tracker state')
    })

    it('manages without a clock', () => {
        const summary = summarise('[XP]\n450/1000\n[/XP]')
        expect(summary.time).toBe('')
        expect(summary.text).toBe('XP')
    })

    it('reads the clock from an unusual TIME block rather than giving up', () => {
        // Whatever the model wrote is more useful than an empty header.
        expect(summarise('[TIME]\nsometime after dusk\n[/TIME]').time).toBe('sometime after dusk')
    })

    it('skips blank lines at the top of the clock block', () => {
        expect(summarise('[TIME]\n\n  09:30 PM, Day 4\n[/TIME]').time).toBe('09:30 PM, Day 4')
    })

    it('treats an erased clock as no clock', () => {
        const summary = summarise('[TIME]\nNONE\n[/TIME]\n[XP]\n450/1000\n[/XP]')
        expect(summary.time).toBe('')
        expect(summary.text).toBe('XP')
    })
})
