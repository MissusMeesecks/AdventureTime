import { describe, expect, it } from 'vitest'

import { barAnimates, barBackground, barPrefFor, barShowsPercentage, collectBars, isBarColor, readBarPref, readBarPrefs } from './bars.js'
import { buildTrackerView } from './view.js'

describe('what counts as a colour', () => {
    it.each(['#fff', '#FFF', '#2ecc71', '#2ECC71'])('accepts %s', (value) => {
        expect(isBarColor(value)).toBe(true)
    })

    it.each([
        ['a named colour', 'red'],
        ['an rgb() call', 'rgb(1,2,3)'],
        ['a url', 'url(javascript:alert(1))'],
        ['a hex with a trailing semicolon', '#fff;'],
        ['four digits', '#ffff'],
        ['nothing', ''],
        ['a number', 0x2ecc71],
    ])('refuses %s', (_name, value) => {
        // It is interpolated straight into a `style` attribute, and the file it
        // comes from is one a user can edit. Hex is the shape a picker emits.
        expect(isBarColor(value)).toBe(false)
    })
})

describe('reading a stored preference', () => {
    it('keeps the legacy’s shape (74i): the mode, the colour and the gradient’s second, the percentage readout, the change animation', () => {
        expect(readBarPref({ mode: 'gradient', color: '#FF8800', color2: '#003300', showAsPercentage: true, animateChanges: true }))
            .toEqual({ mode: 'gradient', color: '#ff8800', color2: '#003300', showAsPercentage: true, animateChanges: true })
        expect(readBarPref({ mode: 'solid', color: '#fff' })).toEqual({ mode: 'solid', color: '#fff' })
        // Dynamic needs no colour; a mode without one means nothing, as the legacy's resolver would draw `undefined`.
        expect(readBarPref({ mode: 'dynamic' })).toEqual({ mode: 'dynamic' })
        expect(readBarPref({ mode: 'gradient' })).toBeNull()
        expect(readBarPref({ mode: 'stripes', color: '#fff' })).toEqual({ color: '#fff' })
        // The legacy's older bare colour string.
        expect(readBarPref('#AABBCC')).toEqual({ mode: 'solid', color: '#aabbcc' })
        expect(readBarPref('red')).toBeNull()
    })

    it('reads the names AdventureTime stored before 74i, so no install loses a choice', () => {
        expect(readBarPref({ color: '#FF8800', percent: true })).toEqual({ color: '#ff8800', showAsPercentage: true })
        expect(readBarPref({ animate: true })).toEqual({ animateChanges: true })
        expect(readBarPref({ animate: false })).toBeNull()
        expect(readBarPref({ animateChanges: 'yes' })).toBeNull()
    })

    it('drops a preference that says nothing', () => {
        // Keeping it would grow the file with entries that change no pixel.
        expect(readBarPref({})).toBeNull()
        expect(readBarPref({ showAsPercentage: false })).toBeNull()
        expect(readBarPref({ color: 'red' })).toBeNull()
        expect(readBarPref({ color2: '#fff' })).toBeNull()
    })

    it('keeps the good entries in a map and drops the rest', () => {
        expect(readBarPrefs({ a: { color: '#fff' }, b: { color: 'red' }, c: null, '': { showAsPercentage: true } }))
            .toEqual({ a: { color: '#fff' } })
    })

    it('answers for a bar with no preference', () => {
        expect(barPrefFor({ a: { showAsPercentage: true } }, 'b')).toEqual({})
        expect(barPrefFor(undefined, 'a')).toEqual({})
        expect(barPrefFor({ a: { showAsPercentage: true } }, undefined)).toEqual({})
    })
})

describe('the legacy’s resolver (74i)', () => {
    it('draws the stored config: a solid colour, a gradient, or the HP thresholds for dynamic', () => {
        expect(barBackground({ mode: 'solid', color: '#123456' }, 'X::Y', 'red', 20)).toBe('#123456')
        expect(barBackground({ color: '#123456' }, 'X::Y', 'red', 20)).toBe('#123456')
        expect(barBackground({ mode: 'gradient', color: '#111111', color2: '#222222' }, 'X::Y', 'red', 20)).toBe('linear-gradient(90deg, #111111, #222222)')
        expect(barBackground({ mode: 'gradient', color: '#111111' }, 'X::Y', 'red', 20)).toBe('linear-gradient(90deg, #111111, #111111)')
        expect(barBackground({ mode: 'dynamic', color: '#111111' }, 'X::Y', 'red', 70)).toBe('#00ffaa')
        expect(barBackground({ mode: 'dynamic' }, 'X::Y', 'red', 45)).toBe('#ffaa00')
        expect(barBackground({ mode: 'dynamic' }, 'X::Y', 'red', 30)).toBe('#ff5555')
        expect(barBackground({ mode: 'dynamic' }, 'X::Y', 'red', null)).toBe('#00ffaa')
    })

    it('with no config hands the default back, but colours an HP bar’s default green by its fraction', () => {
        expect(barBackground(undefined, 'X::Y', 'red', 20)).toBe('red')
        // A config of ticks alone has no colour to draw: the default's path, thresholds included (74i-bis).
        expect(barBackground({ showAsPercentage: true }, 'X::Y', 'red', 20)).toBe('red')
        expect(barBackground({ showAsPercentage: true, animateChanges: true }, 'COMBAT:Brenna:HP', '#00ffaa', 31)).toBe('#ffaa00')
        expect(barBackground({}, 'COMBAT:Brenna:HP', '#00ffaa', 61)).toBe('#00ffaa')
        expect(barBackground(null, 'COMBAT:Brenna:HP', '#00ffaa', 31)).toBe('#ffaa00')
        expect(barBackground(null, 'COMBAT:Brenna:HP', '#00ffaa', 30)).toBe('#ff5555')
        expect(barBackground(null, 'PARTY:A:HPBAR[L0]', '#00ffaa', 10)).toBe('#ff5555')
        // An explicit marker colour on an HP bar passes through, as the legacy keeps ((BARGREEN)).
        expect(barBackground(null, 'COMBAT:Brenna:HP', 'green', 10)).toBe('green')
        expect(barBackground(null, 'COMBAT:Brenna:HP', '#00ffaa', null)).toBe('#00ffaa')
        expect(barBackground(null, '', '#00ffaa', 10)).toBe('#00ffaa')
    })

    it('answers the percentage and the animation from the config alone', () => {
        expect(barShowsPercentage({ showAsPercentage: true }, 'X::Y')).toBe(true)
        expect(barShowsPercentage({ color: '#fff' }, 'X::Y')).toBe(false)
        expect(barShowsPercentage(undefined, 'X::Y')).toBe(false)
        expect(barAnimates({ animateChanges: true }, 'X::Y')).toBe(true)
        expect(barAnimates({}, 'X::Y')).toBe(false)
        expect(barAnimates({ animateChanges: true }, '')).toBe(false)
    })
})

describe('applying a preference to a bar', () => {
    const MEMO = '[WAYSTONE]\nAttunement: ((BARCYAN)) 640/1000\n[/WAYSTONE]'
    // The real id carries its row context, so two `Charges` on different rows
    // cannot share one preference.
    const barId = 'WAYSTONE::Attunement[L0]'

    const segment = (bars = {}) => {
        const line = buildTrackerView(MEMO, { bars }).blocks[0]!.lines[0]!
        if (line.kind !== 'markers') throw new Error('expected a marker line')
        return line.segments[0]!
    }

    it('gives every bar an identity to hang a preference on', () => {
        expect(segment().barId).toBe(barId)
    })

    it('carries the user’s choices beside the author’s colour, for the renderer to resolve (74i)', () => {
        // The marker says what the author meant; the renderer draws what the reader wants.
        expect(segment().color).toBe('CYAN')
        expect(segment().barPref).toEqual({})
        expect(segment({ [barId]: { color: '#ff8800' } }).color).toBe('CYAN')
        expect(segment({ [barId]: { color: '#ff8800' } }).barPref).toEqual({ color: '#ff8800' })
    })

    it('marks a bar to read as a percentage', () => {
        expect(segment().percentLabel).toBeUndefined()
        expect(segment({ [barId]: { showAsPercentage: true } }).percentLabel).toBe(true)
    })

    it('leaves other bars alone', () => {
        expect(segment({ 'SOMETHING::Else': { color: '#ff8800' } }).barPref).toEqual({})
    })
})

describe('listing the bars in a view', () => {
    const MEMO = [
        '[WAYSTONE]',
        'Attunement: ((BARCYAN)) 640/1000',
        'Steward: Odile',
        '[/WAYSTONE]',
        '[COMBAT]',
        'ENEMIES:',
        'Moth Wraith ((BAR)) 10/10',
        '  Charges: ((BAR)) 2/3',
        '[/COMBAT]',
    ].join('\n')

    const bars = () => collectBars(buildTrackerView(MEMO))

    it('finds a marker bar and names it by its label', () => {
        expect(bars().find((b) => b.label === 'Attunement')?.barId).toBe('WAYSTONE::Attunement[L0]')
    })

    it("finds an entity's hit points and names them by the entity", () => {
        expect(bars().some((b) => b.label === 'Moth Wraith · HP')).toBe(true)
    })

    it("finds a bar hanging off an entity", () => {
        expect(bars().some((b) => b.label === 'Moth Wraith · Charges')).toBe(true)
    })

    it('says which block each bar came from, so two Charges can be told apart', () => {
        expect(bars().find((b) => b.label === 'Attunement')?.tag).toBe('WAYSTONE')
        expect(bars().find((b) => b.label === 'Moth Wraith · HP')?.tag).toBe('COMBAT')
    })

    it('lists only the bars that are actually drawn', () => {
        // An entity block's plain lines are parsed as a fallback and never
        // drawn once the entity grammar reads it, so its "Moth Wraith" line is
        // not a bar anyone can see — offering a colour for it would change
        // nothing on screen.
        expect(bars().filter((b) => b.label === 'Moth Wraith')).toEqual([])
        expect(bars().some((b) => b.label === 'Moth Wraith · HP')).toBe(true)
    })

    it('lists a bar once, however often it is drawn', () => {
        const ids = bars().map((b) => b.barId)
        expect(new Set(ids).size).toBe(ids.length)
    })

    it('finds nothing to configure in a memo with no bars', () => {
        expect(collectBars(buildTrackerView('[TIME]\n09:30 PM, Day 2\n[/TIME]'))).toEqual([])
        expect(collectBars(buildTrackerView(''))).toEqual([])
    })
})
