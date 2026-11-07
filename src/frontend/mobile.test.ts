import { describe, expect, it } from 'vitest'

import { isMobileViewportOrDevice, MOBILE_MAX_WIDTH, MOBILE_MEDIA } from './mobile.js'

describe('the host’s definition of a phone (91)', () => {
    it('is a coarse pointer, or a viewport of 600 px or less, as Lumiverse reads it', () => {
        expect(MOBILE_MAX_WIDTH).toBe(600)
        expect(isMobileViewportOrDevice({ innerWidth: 1280 })).toBe(false)
        expect(isMobileViewportOrDevice({ innerWidth: 601 })).toBe(false)
        expect(isMobileViewportOrDevice({ innerWidth: 600 })).toBe(true)
        expect(isMobileViewportOrDevice({ innerWidth: 360 })).toBe(true)
        expect(isMobileViewportOrDevice({ innerWidth: 1280, matchMedia: (q) => ({ matches: q === '(pointer: coarse)' }) })).toBe(true)
        expect(isMobileViewportOrDevice({ innerWidth: 1280, matchMedia: () => ({ matches: false }) })).toBe(false)
    })

    it('reads a host whose matchMedia throws as a pointer that is not coarse', () => {
        expect(isMobileViewportOrDevice({ innerWidth: 1280, matchMedia: () => { throw new Error('no media') } })).toBe(false)
        expect(isMobileViewportOrDevice({ innerWidth: 400, matchMedia: () => { throw new Error('no media') } })).toBe(true)
    })

    it('writes the same test as the media query every phone rule sits under', () => {
        expect(MOBILE_MEDIA).toBe('(max-width: 600px), (pointer: coarse)')
    })
})
