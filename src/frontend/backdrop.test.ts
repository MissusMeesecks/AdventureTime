// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { LEGACY_DAY_NIGHT } from './themes-legacy.js'
import { BACKDROP_ATTR, BACKDROP_CLASS, BACKDROP_CSS, BACKDROP_KEYS, applyBackdrop, applyBackdrops, backdropConfig, backdropRoot, readBackdrop, scaleBackdropImage } from './backdrop.js'

describe('the backdrops (74d)', () => {
    it('reads a stored backdrop: trimmed addresses, the strength a whole number 0–100, Multihog’s 55 when it is not a number', () => {
        expect(readBackdrop(null)).toEqual({ day: '', night: '', strength: 55 })
        expect(readBackdrop({ day: ' /images/a.jpg ', night: 7, strength: '40.6' })).toEqual({ day: '/images/a.jpg', night: '', strength: 41 })
        expect(readBackdrop({ strength: 250 }).strength).toBe(100)
        expect(readBackdrop({ strength: -3 }).strength).toBe(0)
        expect(readBackdrop({ strength: 'strong' }).strength).toBe(55)
        expect(readBackdrop('x')).toEqual({ day: '', night: '', strength: 55 })
    })

    it('decides what a box draws by the legacy’s rule: each image falls to the other, the strength 0–1, an address the renderer refuses draws nothing', () => {
        expect(BACKDROP_KEYS).toEqual({ dayKey: 'day', nightKey: 'night', strengthKey: 'strength' })
        expect(backdropConfig({ day: '/images/d.jpg', night: '', strength: 55 })).toEqual({ day: '/images/d.jpg', night: '/images/d.jpg', strength: 0.55, hasImage: true })
        expect(backdropConfig({ day: '', night: 'https://host/n.jpg', strength: 30 })).toEqual({ day: 'https://host/n.jpg', night: 'https://host/n.jpg', strength: 0.3, hasImage: true })
        expect(backdropConfig({ day: 'images/d.jpg', night: '/images/n.jpg', strength: 100 })).toEqual({ day: '/images/d.jpg', night: '/images/n.jpg', strength: 1, hasImage: true })
        expect(backdropConfig({ day: '', night: '', strength: 55 })).toEqual({ day: '', night: '', strength: 0.55, hasImage: false })
        // A scheme the portraits refuse is refused here: nothing is drawn, and the box wears no class.
        expect(backdropConfig({ day: 'javascript:alert(1)', night: '', strength: 55 })).toEqual({ day: '', night: '', strength: 0.55, hasImage: false })
        expect(backdropConfig(null).hasImage).toBe(false)
    })

    it('puts the class and the three tokens on a box, Multihog’s url() shape, and takes them off for none', () => {
        const box = document.createElement('div')
        const config = applyBackdrop(box, { day: '/images/d.jpg', night: '/images/n.jpg', strength: 40 })
        expect(config.hasImage).toBe(true)
        expect(box.classList.contains(BACKDROP_CLASS)).toBe(true)
        expect(box.style.getPropertyValue('--lh-backdrop')).toBe('url("/images/d.jpg")')
        expect(box.style.getPropertyValue('--lh-backdrop-night')).toBe('url("/images/n.jpg")')
        expect(box.style.getPropertyValue('--lh-backdrop-strength')).toBe('0.4')
        applyBackdrop(box, null)
        expect(box.classList.contains('lh-backdrop')).toBe(false)
        expect(box.getAttribute('style') ?? '').toBe('')
    })

    it('marks a box’s root — the widget around a widget’s body, else the root — and applies each box’s backdrop to every root marked for it', () => {
        document.body.replaceChildren()
        const widget = document.createElement('div')
        widget.className = 'lh-widget'
        const body = document.createElement('div')
        widget.append(body)
        const tab = document.createElement('div')
        const scene = document.createElement('div')
        document.body.append(widget, tab, scene)
        expect(backdropRoot(body, 'tracker')).toBe(widget)
        expect(widget.getAttribute(BACKDROP_ATTR)).toBe('tracker')
        expect(backdropRoot(tab, 'settings')).toBe(tab)
        backdropRoot(scene, 'settings')
        applyBackdrops([widget, tab, scene, body], { trackerBackdrop: { day: '/images/t.jpg', night: '', strength: 55 }, settingsBackdrop: { day: '', night: '/images/s.jpg', strength: 20 } })
        expect(widget.classList.contains('lh-backdrop')).toBe(true)
        expect(widget.style.getPropertyValue('--lh-backdrop')).toBe('url("/images/t.jpg")')
        expect(body.classList.contains('lh-backdrop')).toBe(false)
        for (const root of [tab, scene]) {
            expect(root.classList.contains('lh-backdrop')).toBe(true)
            expect(root.style.getPropertyValue('--lh-backdrop')).toBe('url("/images/s.jpg")')
            expect(root.style.getPropertyValue('--lh-backdrop-strength')).toBe('0.2')
        }
        applyBackdrops([widget, tab, scene], { trackerBackdrop: null, settingsBackdrop: undefined })
        expect(widget.classList.contains('lh-backdrop')).toBe(false)
        expect(tab.classList.contains('lh-backdrop')).toBe(false)
    })

    it('scales an upload as Multihog does where the page can draw, and hands it back as it came where it cannot', async () => {
        // happy-dom has no canvas to draw on: the legacy's scaler is not called, and the picture goes up as picked.
        const picked = 'data:image/png;base64,AAAA'
        expect(await scaleBackdropImage(picked)).toBe(picked)
    })

    it('draws the art and the tint as the legacy draws them — behind the content, the night image from the body’s phase, the phase’s tint colour with the cycle on', () => {
        expect(BACKDROP_CSS).toContain('.lh-backdrop { --lh-backdrop-scrim: rgba(18, 18, 24, 0.72); --lh-backdrop-strength: 0.55; position: relative; isolation: isolate; background-color: transparent !important; background-image: none !important; }')
        expect(BACKDROP_CSS).toContain('.lh-backdrop::before { content: \'\'; position: absolute; inset: 0; z-index: -2;')
        expect(BACKDROP_CSS).toContain('background-image: var(--lh-backdrop, none); background-size: cover; background-position: center; background-repeat: no-repeat;')
        // The night token is always written beside the day's (each falls to the other), so no token nests another (74a's rule).
        expect(BACKDROP_CSS).toContain('.lh-phase-lateNight .lh-backdrop::before,\n.lh-phase-night .lh-backdrop::before { background-image: var(--lh-backdrop-night, none); }')
        expect(BACKDROP_CSS).not.toMatch(/var\(--lh-[a-z-]+, (1px solid )?var\(--lh-/)
        expect(BACKDROP_CSS).toContain('.lh-backdrop::after { content: \'\'; position: absolute; inset: 0; z-index: -1;')
        expect(BACKDROP_CSS).toContain('background: var(--lh-backdrop-scrim); opacity: var(--lh-backdrop-strength);')
        // A themed panel inside a widget with art goes clear, and its blur would blur the art.
        expect(BACKDROP_CSS).toContain('.lh-widget.lh-backdrop .adventuretime-panel { background: transparent !important; backdrop-filter: none !important; }')
        // The seven tint colours, the legacy's, each needing the cycle's class.
        for (const [phase, colour] of Object.entries(LEGACY_DAY_NIGHT.overlays)) {
            expect(BACKDROP_CSS).toContain(`.lh-daynight.lh-phase-${phase} .lh-backdrop { --lh-backdrop-scrim: ${colour}; }`)
        }
        expect(BACKDROP_CSS).toContain('--lh-backdrop-scrim: rgba(6, 8, 26, 0.82);')
        expect(BACKDROP_CSS).not.toMatch(/^\.lh-phase-\w+ \.lh-backdrop \{/m)
        expect(BACKDROP_CSS).not.toContain('--rt-')
        expect(BACKDROP_CSS).not.toContain('rpg-tracker')
    })
})
