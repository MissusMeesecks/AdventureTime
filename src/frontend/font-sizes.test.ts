// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { FONT_SIZE_CSS, FONT_SIZE_MAX, FONT_SIZE_MIN, applyFontSizes, fontSizeLabel, readFontSize, sizeRoot } from './font-sizes.js'

describe('the font sizes (74e)', () => {
    it('reads a size within Multihog’s slider, 8 to 32, and the host’s for nothing or nonsense', () => {
        expect([FONT_SIZE_MIN, FONT_SIZE_MAX]).toEqual([8, 32])
        expect(readFontSize(14)).toBe(14)
        expect(readFontSize('13')).toBe(13)
        expect(readFontSize(13.6)).toBe(14)
        expect(readFontSize(40)).toBe(32)
        expect(readFontSize(3)).toBe(8)
        expect(readFontSize(0)).toBe(0)
        expect(readFontSize(-2)).toBe(0)
        expect(readFontSize(undefined)).toBe(0)
        expect(readFontSize('big')).toBe(0)
        expect(fontSizeLabel(0)).toBe('the host’s')
        expect(fontSizeLabel(16)).toBe('16px')
    })

    it('writes each size as a token on the body in px, and takes it off for the host’s', () => {
        const body = document.createElement('div')
        applyFontSizes(body, { tracker: 16, settings: 0 })
        expect(body.style.getPropertyValue('--lh-size-tracker')).toBe('16px')
        expect(body.style.getPropertyValue('--lh-size-settings')).toBe('')
        // One box at a time: an undefined size leaves the other as it was.
        applyFontSizes(body, { settings: 12 })
        expect(body.style.getPropertyValue('--lh-size-tracker')).toBe('16px')
        expect(body.style.getPropertyValue('--lh-size-settings')).toBe('12px')
        applyFontSizes(body, { tracker: 0 })
        expect(body.style.getPropertyValue('--lh-size-tracker')).toBe('')
    })

    it('marks a root with its box’s class, on the widget around a widget’s body', () => {
        const plain = document.createElement('div')
        sizeRoot(plain, 'settings')
        expect(plain.classList.contains('lh-size-settings')).toBe(true)
        sizeRoot(plain, 'tracker')
        expect(Array.from(plain.classList)).toEqual(['lh-size-tracker'])
        const widget = document.createElement('div')
        widget.className = 'lh-widget adventuretime-panel'
        const body = document.createElement('div')
        widget.append(body)
        sizeRoot(body, 'tracker')
        expect(widget.classList.contains('lh-size-tracker')).toBe(true)
        expect(body.classList.contains('lh-size-tracker')).toBe(false)
    })

    it('reads each root’s size from its token, the host’s when unset', () => {
        expect(FONT_SIZE_CSS).toContain('.lh-size-tracker { font-size: var(--lh-size-tracker, inherit); }')
        expect(FONT_SIZE_CSS).toContain('.lh-size-settings { font-size: var(--lh-size-settings, inherit); }')
    })
})
