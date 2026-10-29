import { describe, expect, it } from 'vitest'

import {
    MARKER_TOKEN_RE,
    MARKER_TYPE_MAP,
    applyMarkerColorOverride,
    getMarkerLibraryKeys,
    isValidMarkerColor,
    resolveMarkerTabStops,
    tokenizeMarkers,
} from './markers.js'

/**
 * The marker vocabulary, locked.
 *
 * Same rule as EXPECTED_PAYLOAD_KEYS in the cartridge gate, and for the same
 * reason: authored sub-modules write these names into their output formats. A
 * name that disappears renders as plain text in every module that used it, with
 * no error anywhere. Adding a marker means adding it here on purpose.
 */
const EXPECTED_MARKER_KEYS = [
    'PILLS', 'PLS', 'PILL', 'BAR', 'B', 'HPBAR', 'HPB', 'HP', 'BARREL', 'NPC',
    'XPBAR', 'XB', 'TEXT', 'BADGE', 'BDG', 'HIGHLIGHT', 'HGT', 'OBJ', 'REWARD',
    'DIFFICULTY', 'PROGRESS', 'WARNING', 'DANGER', 'SUCCESS', 'INFO', 'GOLD',
    'SILVER', 'BRONZE', 'DOLLAR', 'HEART', 'SKULL', 'SOUL', 'ROLL', 'CLOCK',
    'STARS', 'WEIGHT', 'CAPACITY', 'WEATHER', 'ORBS', 'AP', 'SLOTS', 'PHASE',
    'STEP', 'GAUGE', 'METER', 'CHARGE', 'BATTERY',
]

describe('the marker table', () => {
    it('carries exactly the markers the legacy build shipped', () => {
        expect(Object.keys(MARKER_TYPE_MAP)).toEqual(EXPECTED_MARKER_KEYS)
    })

    it('excludes shorthand aliases from the library list', () => {
        const library = getMarkerLibraryKeys()
        expect(library).toContain('BAR')
        expect(library).not.toContain('HP')
        expect(library).not.toContain('B')
        expect(library.length).toBeLessThan(EXPECTED_MARKER_KEYS.length)
    })

    it('points every alias at a marker that exists', () => {
        for (const [key, rule] of Object.entries(MARKER_TYPE_MAP)) {
            if (!rule.aliasOf) continue
            expect(MARKER_TYPE_MAP[rule.aliasOf], `${key} aliases a missing marker`).toBeDefined()
            expect(MARKER_TYPE_MAP[rule.aliasOf].renderType).toBe(rule.renderType)
        }
    })
})

describe('the marker token pattern', () => {
    it('is not global, so re-execing it cannot skip a token', () => {
        // tokenizeMarkers re-execs this regex against a shrinking remainder. A
        // sticky lastIndex would drop every second marker on a line.
        expect(MARKER_TOKEN_RE.global).toBe(false)
    })

    it('prefers the longer marker name where two share a prefix', () => {
        expect(tokenizeMarkers('((PILLS)) a')[0].markerType).toBe('PILLS')
        expect(tokenizeMarkers('((PILL)) a')[0].markerType).toBe('PILL')
    })
})

describe('tokenizeMarkers', () => {
    it('returns nothing for a line with no marker', () => {
        expect(tokenizeMarkers('Steward: Odile')).toEqual([])
    })

    it('splits label from value around the marker', () => {
        const [seg] = tokenizeMarkers('Attunement: ((BAR)) 640/1000 (Harmonious)')
        expect(seg.preText).toBe('Attunement:')
        expect(seg.markerType).toBe('BAR')
        expect(seg.content).toBe('640/1000 (Harmonious)')
    })

    it('reads a colour glued to the marker name', () => {
        const [seg] = tokenizeMarkers('Attunement: ((BARCYAN)) 640/1000')
        expect(seg.markerType).toBe('BAR')
        expect(seg.rule.color).toBe('CYAN')
        // The base rule must not be mutated — every other BAR still has no colour.
        expect(MARKER_TYPE_MAP.BAR.color).toBeUndefined()
    })

    it('reads a delimited colour override', () => {
        const [seg] = tokenizeMarkers('((PILL - rebeccapurple)) Steady')
        expect(seg.rule.color).toBe('rebeccapurple')
        expect(seg.content).toBe('Steady')
    })

    it('gives a bar two colours as a gradient', () => {
        const [seg] = tokenizeMarkers('((BAR - #ff6699 #223344)) 12/20')
        expect(seg.rule.color).toBe('linear-gradient(90deg, #ff6699, #223344)')
    })

    it('gives a barrel two colours as its two signed halves', () => {
        const [seg] = tokenizeMarkers('Trust: ((BARREL - green red)) -38/150')
        expect(seg.rule.positiveColor).toBe('green')
        expect(seg.rule.negativeColor).toBe('red')
    })

    it('chains several markers, each owning the text that follows it', () => {
        const segs = tokenizeMarkers('Spells: ((PLS)) Fireball, Magic Missile ((BAR)) Charges: 3/5')
        expect(segs).toHaveLength(2)
        expect(segs[0].preText).toBe('Spells:')
        expect(segs[0].content).toBe('Fireball, Magic Missile')
        // The text between the markers was consumed as the first segment's
        // content, so it must not also be drawn as the second's label.
        expect(segs[1].preText).toBe('')
        expect(segs[1].content).toBe('Charges: 3/5')
    })

    it('treats || between markers as a column break, not content', () => {
        const segs = tokenizeMarkers('((PILLS)) Affection || ((BADGE)) Ally')
        expect(segs[0].content).toBe('Affection')
    })

    it('reads a |N tab stop off the text before a marker', () => {
        const segs = tokenizeMarkers('|50 ((PILLS)) Affection tier')
        expect(segs[0].tabStop).toBe(50)
        expect(segs[0].preText).toBe('')
    })

    it('strips a leading bullet from a label', () => {
        const [seg] = tokenizeMarkers('- Last check: ((PILLRED)) never')
        expect(seg.preText).toBe('Last check:')
    })

    it('falls back to plain text for an unknown marker-shaped token', () => {
        expect(tokenizeMarkers('((NOTAMARKER)) nothing')).toEqual([])
    })
})

describe('marker colours', () => {
    it('accepts six-digit hex and bare names only', () => {
        expect(isValidMarkerColor('#ff6699')).toBe(true)
        expect(isValidMarkerColor('rebeccapurple')).toBe(true)
        expect(isValidMarkerColor('#f69')).toBe(false)
        expect(isValidMarkerColor('red; background:url(x)')).toBe(false)
        expect(isValidMarkerColor('')).toBe(false)
    })

    it('drops the override entirely when the first colour is invalid', () => {
        const base = MARKER_TYPE_MAP.BAR
        expect(applyMarkerColorOverride(base, 'not a color!', 'red')).toBe(base)
    })

    it('ignores a second colour on a type that cannot gradient', () => {
        const rule = applyMarkerColorOverride(MARKER_TYPE_MAP.BADGE, 'red', 'blue')
        expect(rule.color).toBe('red')
    })
})

describe('tab stops', () => {
    it('spans a single marker across the whole row', () => {
        expect(resolveMarkerTabStops(tokenizeMarkers('|0 ((BAR)) 1/2'))).toEqual([{ start: 0, end: 100 }])
    })

    it('spreads unmarked segments evenly between explicit stops', () => {
        const segs = tokenizeMarkers('|0 ((TEXT)) a ((TEXT)) b |60 ((TEXT)) c')
        const stops = resolveMarkerTabStops(segs)
        expect(stops.map((s) => Math.round(s.start))).toEqual([0, 30, 60])
        expect(stops[2].end).toBe(100)
    })
})
