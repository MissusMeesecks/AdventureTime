/**
 * The animated bars' legacy half (74h), held to the pinned source two ways:
 * the generated module must equal a fresh slice of the checkout byte for
 * byte, and the face must agree with the checkout's own two modules --
 * imported as they are, since they import nothing -- over a corpus of
 * transitions, frames, values and captured rows.
 */
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { Window } from 'happy-dom'
import { describe, expect, it } from 'vitest'

import { FUNCTIONS, MODULES, SOURCE_CSS, exportedNames, renderLegacy, sliceBarAnimationCss, sliceFunction, sliceLegacy, sliceRecolorCss } from '../../scripts/extract-bars.mjs'
import { LEGACY_BAR_ANIMATION_CSS, LEGACY_RECOLOR_CSS, createBarChangeLegacy, createBarColorsLegacy, createRecolorLegacy, createXpGainLegacy } from './bars-legacy.js'
import { captureBarAnimations } from './bar-animation.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && [...MODULES, ...FUNCTIONS].every((piece) => existsSync(`${checkout}/${piece.file}`))

type BarChange = ReturnType<typeof createBarChangeLegacy>
type XpGain = ReturnType<typeof createXpGainLegacy>

const bar = (current: number, overrides: Record<string, unknown> = {}) => ({ id: 'NPC:Alice:Morale', current, max: 100, kind: 'linear', animateChanges: true, ...overrides })
const xp = (current: number, max = 2700, level = '3', showAsPercentage = false) => ({ current, max, level, showAsPercentage })

const BAR_PAIRS: Array<[unknown, unknown]> = [
    [bar(25), bar(40)], [bar(70), bar(55)], [null, bar(20)], [bar(20), null], [bar(20), bar(30, { animateChanges: false })],
    [bar(20), bar(20)], [bar(20), bar(30, { max: 200 })], [bar(20), bar(30, { id: 'other' })], [bar(20), bar(30, { kind: 'barrel' })],
    [bar(-40, { kind: 'barrel' }), bar(20, { kind: 'barrel' })], [bar(60, { kind: 'barrel' }), bar(-120, { kind: 'barrel' })],
    [bar(0), bar(100)], [bar(100), bar(0)], [bar(1.5), bar(2.25)], [bar(20, { max: 0 }), bar(30, { max: 0 })], [bar(Number.NaN), bar(30)],
    [bar(20, { max: 50 }), bar(80, { max: 50 })], [bar(-5), bar(5)],
]
const XP_PAIRS: Array<[unknown, unknown]> = [
    [xp(1200), xp(1500)], [null, xp(1200)], [xp(1200), null], [xp(1200), xp(1100)], [xp(2600), xp(0, 6500, '4')], [xp(1200), xp(1500, 6500)],
    [xp(1200), xp(1200)], [xp(1200), xp(1200.4)], [xp(0), xp(2700)], [xp(2000), xp(9000)], [xp(10, 0), xp(20, 0)], [xp(1200, 2700, ''), xp(1500, 2700, '')],
    [xp(1200, 2700, '3', true), xp(1500, 2700, '3', true)],
]

const ROWS = [
    '<div class="rt-xp-row" data-xp-current="1500" data-xp-visible-current="1240" data-xp-max="2700" data-xp-level="3" data-xp-show-percentage="false"></div>',
    '<div class="rt-xp-row" data-xp-current="1500" data-xp-max="2700" data-xp-level=""></div>',
    '<div class="rt-xp-row" data-xp-current="x" data-xp-max="2700"></div>',
    '<div class="rt-xp-row" data-xp-current="7" data-xp-max="10" data-xp-show-percentage="true"></div>',
    '<div class="rt-hp-bar-wrap" data-rt-bar-id="PARTY:Alice:HP" data-rt-bar-current="20" data-rt-bar-max="100" data-rt-bar-kind="linear" data-rt-bar-animate="true"></div>'
    + '<div class="rt-barrel-track" data-rt-bar-id="NPC::Trust" data-rt-bar-current="-20" data-rt-bar-visible-current="-15.5" data-rt-bar-max="100" data-rt-bar-kind="barrel" data-rt-bar-animate="false"></div>'
    + '<div data-rt-bar-id="PARTY:Alice:HP" data-rt-bar-current="99" data-rt-bar-max="100"></div>'
    + '<div data-rt-bar-id="" data-rt-bar-current="1" data-rt-bar-max="2"></div>'
    + '<div data-rt-bar-id="bad" data-rt-bar-current="x" data-rt-bar-max="2"></div>',
    '',
]

describe.skipIf(!available)('the animated bars against the pinned legacy build', () => {
    it('is the generated module, byte for byte, from a fresh slice of the checkout, with every export', () => {
        const committed = readFileSync('src/frontend/bars-legacy.js', 'utf8')
        const slice = sliceLegacy(checkout!)
        expect(committed).toBe(renderLegacy(slice))
        expect(slice.modules.map((module) => module.names)).toEqual([
            ['getBarChangeTransition', 'getBarTrickleDuration', 'getBarTrickleFrame', 'captureBarChangeAnimationState', 'playBarChangeAnimations'],
            ['getXpGainTransition', 'formatAnimatedXpValue', 'captureXpGainAnimationState', 'playXpGainAnimation'],
        ])
        expect(LEGACY_BAR_ANIMATION_CSS).toBe(sliceBarAnimationCss(readFileSync(`${checkout}/${SOURCE_CSS}`, 'utf8')))
        expect(LEGACY_RECOLOR_CSS).toBe(sliceRecolorCss(readFileSync(`${checkout}/${SOURCE_CSS}`, 'utf8')))
        // The functions cut by their braces (74i): each present in the checkout, each on our factory, the popup's doc comment carried.
        expect(FUNCTIONS.map((piece) => piece.functions)).toEqual([['getBarBackground', 'getBarShowAsPercentage', 'getBarAnimateChanges'], ['handleRecolor', 'resolvePickerColor']])
        for (const piece of FUNCTIONS) {
            const source = readFileSync(`${checkout}/${piece.file}`, 'utf8')
            for (const name of piece.functions) expect(sliceFunction(source, name)).toMatch(new RegExp(`function ${name}\\(`))
        }
        expect(sliceFunction(readFileSync(`${checkout}/theme-manager.js`, 'utf8'), 'resolvePickerColor')).toMatch(/^\/\*\* Converts a CSS marker color/)
        const colors = createBarColorsLegacy({ getSettings: () => ({ barColors: { a: { mode: 'gradient', color: '#1', color2: '#2', showAsPercentage: true, animateChanges: true } } }) })
        expect(colors.getBarBackground('a', 'red', 50)).toBe('linear-gradient(90deg, #1, #2)')
        expect(colors.getBarShowAsPercentage('a')).toBe(true)
        expect(colors.getBarAnimateChanges('a')).toBe(true)
        const recolor = createRecolorLegacy({ getSettings: () => ({ barColors: {} }), saveSettings: () => {}, refreshRenderedView: () => {} })
        expect(recolor.handleRecolor).toBeTypeOf('function')
        expect(recolor.resolvePickerColor).toBeTypeOf('function')
        const made = [createBarChangeLegacy(), createXpGainLegacy()] as Array<Record<string, unknown>>
        slice.modules.forEach((module, i) => {
            expect(exportedNames(readFileSync(`${checkout}/${module.file}`, 'utf8'))).toEqual(module.names)
            for (const name of module.names) expect(made[i]![name], name).toBeTypeOf('function')
        })
    })

    it('agrees with the checkout’s own modules over transitions, durations, frames, values and captured rows', async () => {
        const theirBars = (await import(pathToFileURL(`${checkout}/${MODULES[0]!.file}`).href)) as BarChange
        const theirXp = (await import(pathToFileURL(`${checkout}/${MODULES[1]!.file}`).href)) as XpGain
        const ours = createBarChangeLegacy()
        const oursXp = createXpGainLegacy()
        for (const [previous, next] of BAR_PAIRS) {
            expect(ours.getBarChangeTransition(previous, next)).toEqual(theirBars.getBarChangeTransition(previous, next))
        }
        for (const [delta, max] of [[-1, 5], [-200, 1000], [50, 100], [10, 100], [0, 100], [100, 100], [3, 0], [Number.NaN, 10], [0.5, 1000]]) {
            expect(ours.getBarTrickleDuration(delta, max)).toBe(theirBars.getBarTrickleDuration(delta, max))
            expect(ours.getBarTrickleDuration(delta, max, true)).toBe(theirBars.getBarTrickleDuration(delta, max, true))
        }
        for (const [previous, delta, max, kind, progress] of [[5, -1, 5, 'linear', 0.5], [-40, 60, 100, 'barrel', 0.5], [0, 100, 100, 'linear', 1.2], [20, 10, 100, 'linear', Number.NaN], [50, -70, 100, 'barrel', 0.25]] as const) {
            expect(ours.getBarTrickleFrame(previous, delta, max, kind, progress)).toEqual(theirBars.getBarTrickleFrame(previous, delta, max, kind, progress))
        }
        for (const [previous, next] of XP_PAIRS) {
            expect(oursXp.getXpGainTransition(previous as never, next as never)).toEqual(theirXp.getXpGainTransition(previous as never, next as never))
        }
        for (const [current, max, pct] of [[1500, 2700, false], [1500, 2700, true], [0, 10, true], [1234567.6, 1, false], [7, 0, true]] as const) {
            expect(oursXp.formatAnimatedXpValue(current, max, pct)).toBe(theirXp.formatAnimatedXpValue(current, max, pct))
        }
        // The rows under happy-dom's own window: the checkout's module reads `instanceof HTMLElement` from the global.
        const window = new Window()
        const globals = globalThis as unknown as { HTMLElement: unknown; document: unknown }
        const kept = { HTMLElement: globals.HTMLElement, document: globals.document }
        globals.HTMLElement = window.HTMLElement
        globals.document = window.document
        try {
        for (const row of ROWS) {
            for (const context of ['chat::live', 'other::live']) {
                const mine = window.document.createElement('div') as unknown as HTMLElement
                mine.dataset.rtXpAnimationContext = 'chat::live'
                mine.dataset.rtBarAnimationContext = 'chat::live'
                mine.innerHTML = row
                const theirs = mine.cloneNode(true) as HTMLElement
                expect(captureBarAnimations(mine, mine, context)).toEqual({
                    xp: theirXp.captureXpGainAnimationState(theirs, context),
                    bars: theirBars.captureBarChangeAnimationState(theirs, context),
                })
            }
        }
        } finally {
            globals.HTMLElement = kept.HTMLElement
            globals.document = kept.document
            await window.happyDOM.close()
        }
    })
})
