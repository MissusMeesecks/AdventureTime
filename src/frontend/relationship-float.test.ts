// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createRelationshipFloat, REL_FLOAT_LIFETIME_MS, REL_FLOAT_STAGGER_MS, RELATIONSHIP_FLOAT_LAYER_ID } from './relationship-float.js'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren() })

function harness(options: { host?: HTMLElement | null } = {}) {
    const host = options.host === undefined ? document.createElement('div') : options.host
    if (host) document.body.append(host)
    const float = createRelationshipFloat({ host: () => host })
    const layer = () => document.getElementById(RELATIONSHIP_FLOAT_LAYER_ID)
    const floats = () => Array.from(document.querySelectorAll<HTMLElement>('.lh-rel-float'))
    return { float, host, layer, floats }
}

describe('the relationship float (78c)', () => {
    it('floats the icon, the signed delta, the axis and the name over the tracker, in the axis’s colour class', () => {
        const { float, layer, floats } = harness()
        float.show({ npc: ' Marcus Vane ', field: 'friendship', delta: 5 })
        expect(layer()).toBeNull()
        vi.advanceTimersByTime(0)
        expect(layer()).not.toBeNull()
        expect(layer()!.parentElement).toBe(document.body)
        expect(layer()!.getAttribute('aria-live')).toBe('polite')
        const [el] = floats()
        expect(el!.className).toBe('lh-rel-float lh-rel-float--friendship lh-rel-float--positive')
        expect(el!.getAttribute('role')).toBe('status')
        expect(Array.from(el!.children).map((c) => [c.className, c.textContent])).toEqual([
            ['lh-rel-float-icon', '🤝'], ['lh-rel-float-delta', '+5'], ['lh-rel-float-label', 'Friendship'], ['lh-rel-float-npc', 'Marcus Vane'],
        ])
        expect(el!.style.getPropertyValue('--lh-rel-float-x')).toBe('0px')
        expect(el!.style.getPropertyValue('--lh-rel-float-y')).toBe('0px')
        // The layer sits above the legacy's base when no ancestor names a z-index.
        expect(layer()!.style.zIndex).toBe('2040')
    })

    it('draws a loss in affection without a plus, leaves the name off when there is none, and floats nothing for a zero', () => {
        const { float, floats } = harness()
        float.show({ npc: '', field: 'affection', delta: -3 })
        float.show({ npc: 'Kes', field: 'affection', delta: 0 })
        vi.advanceTimersByTime(REL_FLOAT_STAGGER_MS * 2)
        expect(floats()).toHaveLength(1)
        const [el] = floats()
        expect(el!.className).toBe('lh-rel-float lh-rel-float--affection lh-rel-float--negative')
        expect(el!.querySelector('.lh-rel-float-delta')!.textContent).toBe('-3')
        expect(el!.querySelector('.lh-rel-float-npc')).toBeNull()
    })

    it('staggers concurrent awards and spreads them across slots; a finished one frees its slot and the empty layer goes', () => {
        const { float, floats, layer } = harness()
        float.show({ npc: 'A', field: 'friendship', delta: 1 })
        float.show({ npc: 'B', field: 'affection', delta: 2 })
        float.show({ npc: 'C', field: 'friendship', delta: 3 })
        vi.advanceTimersByTime(0)
        expect(floats().map((f) => f.querySelector('.lh-rel-float-npc')!.textContent)).toEqual(['A'])
        vi.advanceTimersByTime(REL_FLOAT_STAGGER_MS)
        expect(floats()).toHaveLength(2)
        vi.advanceTimersByTime(REL_FLOAT_STAGGER_MS)
        expect(floats()).toHaveLength(3)
        expect(floats().map((f) => [f.style.getPropertyValue('--lh-rel-float-x'), f.style.getPropertyValue('--lh-rel-float-y')])).toEqual([['0px', '0px'], ['16px', '40px'], ['32px', '60px']])
        // The first animation ends: its slot is free, and the next award takes it.
        floats()[0]!.dispatchEvent(new Event('animationend'))
        expect(floats()).toHaveLength(2)
        float.show({ npc: 'D', field: 'friendship', delta: 4 })
        vi.advanceTimersByTime(REL_FLOAT_STAGGER_MS)
        const d = floats().find((f) => f.querySelector('.lh-rel-float-npc')!.textContent === 'D')!
        expect(d.style.getPropertyValue('--lh-rel-float-y')).toBe('0px')
        // The fallback timer takes the rest down when no animationend comes, and the layer with them.
        vi.advanceTimersByTime(REL_FLOAT_LIFETIME_MS + REL_FLOAT_STAGGER_MS * 4)
        expect(floats()).toHaveLength(0)
        expect(layer()).toBeNull()
    })

    it('aligns the layer with the tracker and lifts it above the highest z-index up its chain', () => {
        const frame = document.createElement('div')
        frame.style.zIndex = '3100'
        frame.style.position = 'absolute'
        const host = document.createElement('div')
        host.getBoundingClientRect = () => ({ left: 40, top: 60, width: 300, height: 500, right: 340, bottom: 560, x: 40, y: 60, toJSON: () => ({}) })
        frame.append(host)
        document.body.append(frame)
        const float = createRelationshipFloat({ host: () => host })
        float.show({ npc: 'A', field: 'friendship', delta: 1 })
        vi.advanceTimersByTime(0)
        const layer = document.getElementById(RELATIONSHIP_FLOAT_LAYER_ID)!
        expect([layer.style.left, layer.style.top, layer.style.width, layer.style.height]).toEqual(['40px', '60px', '300px', '500px'])
        expect(layer.style.zIndex).toBe('3140')
    })

    it('floats nothing without a tracker, and destroy cancels what is pending and takes the layer down', () => {
        const none = harness({ host: null })
        none.float.show({ npc: 'A', field: 'friendship', delta: 1 })
        vi.advanceTimersByTime(0)
        expect(none.layer()).toBeNull()
        const { float, layer, floats } = harness()
        float.show({ npc: 'A', field: 'friendship', delta: 1 })
        float.show({ npc: 'B', field: 'friendship', delta: 1 })
        vi.advanceTimersByTime(0)
        expect(floats()).toHaveLength(1)
        float.destroy()
        vi.advanceTimersByTime(REL_FLOAT_STAGGER_MS * 2)
        expect(layer()).toBeNull()
        float.show({ npc: 'C', field: 'friendship', delta: 1 })
        vi.advanceTimersByTime(REL_FLOAT_STAGGER_MS * 2)
        expect(layer()).toBeNull()
    })
})
