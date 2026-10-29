// @vitest-environment happy-dom
/**
 * The animated bars' face (74h): what a redraw within one context plays, and
 * what a redraw across contexts, or a bar not opted in, leaves alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BAR_ANIMATION_CSS, barAnimationContext, captureBarAnimations, playBarAnimations } from './bar-animation.js'

const bar = (current: number, animate = true, max = 100) =>
    `<div class="rt-entity-sub-line rt-hp-row"><div class="rt-hp-bar-wrap" data-rt-bar-id="NPC::Morale" data-rt-bar-current="${current}" data-rt-bar-max="${max}" data-rt-bar-kind="linear" data-rt-bar-animate="${animate}"><div class="rt-hp-bar" style="width:${current}%;background:red;"></div></div><span class="rt-hp-label">${current}/${max}</span></div>`
const barrel = (current: number) =>
    `<div class="rt-entity-sub-line rt-barrel-row"><div class="rt-barrel-track" data-rt-bar-id="NPC::Trust" data-rt-bar-current="${current}" data-rt-bar-max="100" data-rt-bar-kind="barrel" data-rt-bar-animate="true"><div class="rt-barrel-center-marker"></div><div class="rt-barrel-fill ${current >= 0 ? 'rt-barrel-positive' : 'rt-barrel-negative'}" style="width:${Math.abs(current) / 2}%;background:green;"></div></div></div>`
const xpRow = (current: number) =>
    `<div class="rt-bottom-xp-content"><div class="rt-xp-row" data-xp-current="${current}" data-xp-max="2700" data-xp-level="3"><div class="rt-xp-label"><span>Level 3</span><span>XP: <span class="rt-xp-current">${current.toLocaleString('en-US')}</span> / <span class="rt-xp-max">2,700</span></span></div><div class="rt-xp-bar-wrap"><div class="rt-xp-bar" style="width:${(current / 27).toFixed(1)}%;"></div></div></div></div>`

let cards: HTMLElement
let xpHost: HTMLElement

/** A redraw as the tracker panel does it: capture, replace, play. */
function redraw(context: string, html: string, xpHtml = ''): void {
    const captured = captureBarAnimations(cards, xpHost, context)
    cards.innerHTML = html
    xpHost.innerHTML = xpHtml
    playBarAnimations(cards, xpHost, captured, context)
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] })
    cards = document.createElement('div')
    xpHost = document.createElement('div')
    document.body.append(cards, xpHost)
})
afterEach(() => {
    vi.useRealTimers()
    cards.remove()
    xpHost.remove()
})

describe('the animated bars (74h)', () => {
    it('keys the context on the chat and the stepper’s position, as the legacy does', () => {
        expect(barAnimationContext('chat-1', -1)).toBe('chat-1::live')
        expect(barAnimationContext('chat-1', 2)).toBe('chat-1::history-2')
        expect(barAnimationContext('chat-1', 0)).toBe('chat-1::history-0')
        expect(barAnimationContext(null, -1)).toBe('global::live')
    })

    it('plays a gain on an opted-in bar: the old fill held, the changed segment lit, the delta floated and counted down to the new value', () => {
        redraw('c::live', bar(20))
        expect(cards.querySelector('.rt-bar-delta-segment')).toBeNull()
        redraw('c::live', bar(35))
        const wrap = cards.querySelector('.rt-hp-bar-wrap') as HTMLElement
        const fill = cards.querySelector('.rt-hp-bar') as HTMLElement
        const segment = cards.querySelector('.rt-bar-delta-segment') as HTMLElement
        const floater = cards.querySelector('.rt-bar-change-floater') as HTMLElement
        // Held at the old value first, the segment over the change.
        expect(fill.style.width).toBe('20.00%')
        expect(wrap.dataset.rtBarVisibleCurrent).toBe('20')
        expect(segment.classList.contains('rt-bar-delta-gain')).toBe(true)
        expect(segment.style.left).toBe('20.00%')
        expect(segment.style.width).toBe('15.00%')
        expect(floater.classList.contains('rt-bar-change-positive')).toBe(true)
        expect(floater.textContent).toBe('+15')
        expect(floater.getAttribute('aria-label')).toBe('Increased by 15')
        expect(wrap.closest('.rt-hp-row')!.classList.contains('rt-bar-change-host')).toBe(true)
        // The hold, then the trickle: the fill moves, the delta counts down.
        vi.advanceTimersByTime(480)
        expect(floater.classList.contains('rt-bar-change-trickling')).toBe(true)
        vi.advanceTimersByTime(300)
        const midway = Number(wrap.dataset.rtBarVisibleCurrent)
        expect(midway).toBeGreaterThan(20)
        expect(midway).toBeLessThan(35)
        expect(floater.textContent).toMatch(/^\+\d+$/)
        expect(floater.textContent).not.toBe('+15')
        vi.advanceTimersByTime(4000)
        expect(fill.style.width).toBe('35.00%')
        expect(wrap.dataset.rtBarVisibleCurrent).toBe('35')
        expect(floater.classList.contains('rt-bar-change-releasing')).toBe(true)
        vi.advanceTimersByTime(200)
        expect(cards.querySelector('.rt-bar-delta-segment')).toBeNull()
        expect(cards.querySelector('.rt-bar-change-floater')).toBeNull()
        expect(wrap.closest('.rt-hp-row')!.classList.contains('rt-bar-change-host')).toBe(false)
    })

    it('plays a loss in red, and a barrel’s change around its centre', () => {
        redraw('c::live', bar(70) + barrel(-40))
        redraw('c::live', bar(55) + barrel(20))
        const floaters = Array.from(cards.querySelectorAll('.rt-bar-change-floater')).map((n) => [n.className, n.textContent])
        expect(floaters).toEqual([['rt-bar-change-floater rt-bar-change-negative', '−15'], ['rt-bar-change-floater rt-bar-change-positive', '+60']])
        const segments = Array.from(cards.querySelectorAll('.rt-bar-delta-segment')).map((n) => [(n as HTMLElement).style.left, (n as HTMLElement).style.width])
        expect(segments).toEqual([['55.00%', '15.00%'], ['30.00%', '30.00%']])
        const fill = cards.querySelector('.rt-barrel-fill') as HTMLElement
        expect(fill.classList.contains('rt-barrel-negative')).toBe(true)
        expect(fill.style.right).toBe('50%')
        vi.advanceTimersByTime(6000)
        expect(fill.classList.contains('rt-barrel-positive')).toBe(true)
        expect(fill.style.left).toBe('50%')
        expect(fill.style.width).toBe('10.00%')
    })

    it('plays nothing across contexts, on a bar not opted in, on an unchanged value or on a changed scale', () => {
        redraw('c::live', bar(20))
        redraw('d::live', bar(40))
        expect(cards.querySelector('.rt-bar-delta-segment')).toBeNull()
        redraw('d::live', bar(60, false))
        expect(cards.querySelector('.rt-bar-delta-segment')).toBeNull()
        redraw('d::live', bar(60))
        expect(cards.querySelector('.rt-bar-delta-segment')).toBeNull()
        redraw('d::live', bar(60, true, 200))
        expect(cards.querySelector('.rt-bar-delta-segment')).toBeNull()
        redraw('d::history-0', bar(80))
        expect(cards.querySelector('.rt-bar-delta-segment')).toBeNull()
    })

    it('floats the XP gain under the row in the host given, counts it down as the bar fills, and leaves a loss or a level-up alone', () => {
        redraw('c::live', '', xpRow(1200))
        redraw('c::live', '', xpRow(1500))
        const row = xpHost.querySelector('.rt-xp-row') as HTMLElement
        const barEl = xpHost.querySelector('.rt-xp-bar') as HTMLElement
        const label = xpHost.querySelector('.rt-xp-current') as HTMLElement
        const floater = xpHost.querySelector('.rt-xp-gain-floater') as HTMLElement
        expect(row.classList.contains('rt-xp-gain-active')).toBe(true)
        expect(floater.textContent).toBe('+300 XP')
        expect(floater.getAttribute('aria-label')).toBe('Gained 300 experience points')
        expect(floater.style.getPropertyValue('--rt-xp-trickle-duration')).toBe('2640ms')
        expect(label.textContent).toBe('1,200')
        expect(barEl.style.width).toBe('44.4%')
        vi.advanceTimersByTime(840)
        expect(floater.classList.contains('rt-xp-gain-trickling')).toBe(true)
        vi.advanceTimersByTime(1320)
        expect(Number(row.dataset.xpVisibleCurrent)).toBeGreaterThan(1200)
        expect(Number(row.dataset.xpVisibleCurrent)).toBeLessThan(1500)
        vi.advanceTimersByTime(3000)
        expect(label.textContent).toBe('1,500')
        expect(barEl.style.width).toBe('55.6%')
        expect(xpHost.querySelector('.rt-xp-gain-floater')).toBeNull()
        expect(row.classList.contains('rt-xp-gain-active')).toBe(false)
        // A loss, a level-up: drawn as they are.
        redraw('c::live', '', xpRow(1400))
        expect(xpHost.querySelector('.rt-xp-gain-floater')).toBeNull()
        xpHost.innerHTML = xpRow(1400).replace('data-xp-level="3"', 'data-xp-level="4"')
        redraw('c::live', '', xpRow(1600).replace('data-xp-level="3"', 'data-xp-level="5"'))
        expect(xpHost.querySelector('.rt-xp-gain-floater')).toBeNull()
    })

    it('carries the legacy’s rules for the segment, the floaters and the XP row’s gain state', () => {
        for (const rule of ['.rt-bar-delta-gain', '.rt-bar-delta-loss', '.rt-bar-change-floater', '.rt-bar-change-releasing', '.rt-xp-row.rt-xp-gain-active', '.rt-bottom-xp-content .rt-xp-gain-floater', '@keyframes rt-xp-bottom-gain-fade', 'var(--rt-xp-trickle-duration, 2640ms)', '@media (prefers-reduced-motion: reduce)']) {
            expect(BAR_ANIMATION_CSS).toContain(rule)
        }
    })
})
