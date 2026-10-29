// @vitest-environment happy-dom
/**
 * The recolour popup's trim (74i-bis): the tick comes off the box where the
 * bar does not read it, and stays off as the box redraws itself.
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createRecolorBinding, handleReadsPercentage, stripRecolorHandles, trimRecolorPopup, RECOLOR_POPUP_ID } from './recolor.js'

const BOX = `<div><div class="title">Bar Settings</div>
    <label><input id="show-as-percentage" type="checkbox" /><span>Show as Percentage</span></label>
    <label><input id="animate-bar-changes" type="checkbox" /><span>Animate Changes</span></label></div>`

function makePopup(): HTMLElement {
    const popup = document.createElement('div')
    popup.id = 'rt-recolor-popup'
    popup.innerHTML = BOX
    document.body.appendChild(popup)
    return popup
}

const tick = (popup: HTMLElement) => popup.querySelector('#show-as-percentage')
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('stripRecolorHandles', () => {
    it('takes the handles, their titles and a barrel’s half-controls off a drawing that takes no click, and leaves the rest', () => {
        const scope = document.createElement('div')
        scope.innerHTML = `<div class="rt-hp-bar-wrap" data-rt-bar-id="A" data-recolor-id="A" data-recolor-current="red" data-recolor-explicit-color="false" title="Click to recolor" data-recolor-percent="true"><div class="rt-hp-bar"></div></div>
            <div class="rt-barrel-track" data-rt-bar-id="B"><div class="rt-barrel-color-control rt-barrel-negative-control" data-recolor-id="B:negative" title="Click to recolor the negative side"></div><div class="rt-barrel-color-control rt-barrel-positive-control" data-recolor-id="B:positive"></div><div class="rt-barrel-fill"></div></div>
            <span class="rt-pill" title="Hover for details">x</span>`
        stripRecolorHandles(scope)
        expect(scope.querySelector('[data-recolor-id]')).toBeNull()
        expect(scope.querySelector('[title^="Click to recolor"]')).toBeNull()
        expect(scope.querySelector('[data-recolor-current], [data-recolor-explicit-color], [data-recolor-percent]')).toBeNull()
        expect(scope.querySelector('.rt-barrel-color-control')).toBeNull()
        expect(scope.querySelector('.rt-hp-bar-wrap')?.getAttribute('data-rt-bar-id')).toBe('A')
        expect(scope.querySelector('.rt-barrel-fill')).not.toBeNull()
        expect(scope.querySelector('.rt-pill')?.getAttribute('title')).toBe('Hover for details')
    })
})

describe('createRecolorBinding', () => {
    const handle = (id: string, percent = true) => {
        const wrap = document.createElement('div')
        wrap.className = 'rt-hp-bar-wrap'
        wrap.dataset.recolorId = id
        wrap.dataset.recolorCurrent = '#123456'
        if (percent) wrap.dataset.recolorPercent = 'true'
        wrap.innerHTML = '<div class="rt-hp-bar" style="background:#123456"></div>'
        document.body.appendChild(wrap)
        return wrap
    }
    const popup = () => document.getElementById(RECOLOR_POPUP_ID)
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
    afterEach(() => { document.body.innerHTML = '' })

    it('takes the store’s bars as typed preferences and says whether they moved', () => {
        const binding = createRecolorBinding({ document, patch: async () => undefined, redraw: () => undefined })
        expect(binding.take({ a: { color: '#FF0000', percent: true } } as never)).toEqual({ bars: { a: { color: '#ff0000', showAsPercentage: true } }, changed: true })
        expect(binding.take({ a: { color: '#FF0000', percent: true } } as never).changed).toBe(false)
        expect(binding.current()).toEqual({ a: { color: '#ff0000', showAsPercentage: true } })
        expect(binding.take(undefined)).toEqual({ bars: {}, changed: true })
    })

    it('opens the legacy’s popup on a click, redraws as a change is made, patches only the bars that moved, and takes the box down on close', async () => {
        const patches: Array<Record<string, unknown>> = []
        const redraws: unknown[] = []
        const binding = createRecolorBinding({
            document,
            patch: async (bars) => { patches.push(bars); return { ...bars } as never },
            redraw: (bars) => { redraws.push(bars) },
        })
        binding.take({ other: { color: '#00ff00' } })
        const wrap = handle('X::Y')
        binding.bind(document.body)
        wrap.click()
        expect(popup()).not.toBeNull()
        expect(popup()!.querySelector('#show-as-percentage')).not.toBeNull()
        ;(popup()!.querySelector('.mode-btn[data-mode="gradient"]') as HTMLButtonElement).click()
        await flush()
        expect(redraws).toHaveLength(1)
        expect(redraws[0]).toMatchObject({ 'X::Y': { mode: 'gradient' }, other: { color: '#00ff00' } })
        expect(patches).toHaveLength(1)
        expect(Object.keys(patches[0]!)).toEqual(['X::Y'])
        binding.close()
        expect(popup()).toBeNull()
    })

    it('trims the tick off the box for a handle that does not read it', () => {
        const binding = createRecolorBinding({ document, patch: async () => undefined, redraw: () => undefined })
        const wrap = handle('ORBS::1', false)
        binding.bind(document.body)
        wrap.click()
        expect(popup()).not.toBeNull()
        expect(popup()!.querySelector('#show-as-percentage')).toBeNull()
        binding.close()
    })
})

describe('trimRecolorPopup', () => {
    afterEach(() => { document.body.innerHTML = '' })

    it('reads the renderer’s flag off the handle', () => {
        expect(handleReadsPercentage({ dataset: { recolorPercent: 'true' } as DOMStringMap })).toBe(true)
        expect(handleReadsPercentage({ dataset: {} as DOMStringMap })).toBe(false)
        expect(handleReadsPercentage({ dataset: { recolorPercent: 'false' } as DOMStringMap })).toBe(false)
    })

    it('leaves the box whole when the bar reads the tick, and with no box at all', () => {
        const popup = makePopup()
        trimRecolorPopup(popup, { percent: true })
        expect(tick(popup)).not.toBeNull()
        expect(() => trimRecolorPopup(null, { percent: false })).not.toThrow()
    })

    it('takes the tick off, with its label, and keeps it off as the box redraws', async () => {
        const popup = makePopup()
        trimRecolorPopup(popup, { percent: false })
        expect(tick(popup)).toBeNull()
        expect(popup.textContent).not.toContain('Show as Percentage')
        expect(popup.querySelector('#animate-bar-changes')).not.toBeNull()
        expect(popup.querySelectorAll('label')).toHaveLength(1)
        // The legacy's mode buttons rewrite the whole box; the trim follows.
        popup.innerHTML = BOX
        await flush()
        expect(tick(popup)).toBeNull()
        expect(popup.querySelector('#animate-bar-changes')).not.toBeNull()
    })
})
