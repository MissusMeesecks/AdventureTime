/**
 * Tab Mode's legacy pieces (76), held to the pinned source two ways: the
 * generated module must equal a fresh slice of the checkout byte for byte,
 * and the vitals reader must agree with the checkout's own — evaluated from
 * its text, since `renderer.js` is a closure over the whole install — over
 * a corpus of PARTY blocks.
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { CONSTANT, FUNCTIONS, PARAMS, SOURCE_CSS, SOURCE_JS, renderLegacy, sliceConstant, sliceFunction, sliceLegacy, sliceTabModeCss } from '../../scripts/extract-tab-mode.mjs'
import { createTabModeLegacy, LEGACY_TAB_MODE_CSS } from './tab-mode-legacy.js'
import { extractPartyVitals, renderPartyVitalsStrip, TAB_MODE_PINNED_TAGS } from './tab-mode.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && existsSync(`${checkout}/${SOURCE_JS}`) && existsSync(`${checkout}/${SOURCE_CSS}`)

const CORPUS = [
    'Alice: 12/20 HP | AC 14\nBob: 5 HP\nNotes: fine',
    '- Alice Smith: 12/20 HP\n* Bob: 0/30 HP\n• Cara: 1,200/2,000 HP, Poisoned',
    '—Dirk: -5/20 HP\n–Eve: +7/7 HP:\nFay: 40/0 HP',
    '',
    'Nobody here',
    'Gus: 3 HP\n  Status: Tired\nHal: 20/20 HP | Gear: sword',
    '-Ivy: 8/16 HP\n-  Jo: 16/16 HP',
]

describe.skipIf(!available)('Tab Mode against the pinned legacy build', () => {
    it('is the generated module, byte for byte, from a fresh slice of the checkout', () => {
        const committed = readFileSync('src/tracker/tab-mode-legacy.js', 'utf8')
        const slice = sliceLegacy(checkout!)
        expect(committed).toBe(renderLegacy(slice))
        expect(LEGACY_TAB_MODE_CSS).toBe(sliceTabModeCss(readFileSync(`${checkout}/${SOURCE_CSS}`, 'utf8')))
        const source = readFileSync(`${checkout}/${SOURCE_JS}`, 'utf8')
        expect(sliceConstant(source, CONSTANT)).toBe("const TABMODE_PINNED_TAGS = ['CHARACTER', 'COMBAT'];")
        expect(FUNCTIONS).toEqual(['extractPartyVitals', 'renderPartyVitalsStrip'])
        for (const name of FUNCTIONS) expect(sliceFunction(source, name)).toMatch(new RegExp(`function ${name}\\(`))
        // The strip's doc comment is carried, and every scope read is a parameter.
        expect(sliceFunction(source, 'renderPartyVitalsStrip')).toMatch(/^\/\*\*\n \* Renders the compact party-vitals strip/)
        for (const param of PARAMS) expect(sliceFunction(source, 'renderPartyVitalsStrip') + sliceFunction(source, 'extractPartyVitals')).toContain(param)
        expect(LEGACY_TAB_MODE_CSS).toContain('.rt-tab-strip {')
        expect(LEGACY_TAB_MODE_CSS).toContain('.rt-vitals-portrait-wrap {')
        expect(LEGACY_TAB_MODE_CSS).toContain('@media (hover: none) and (pointer: coarse)')
        expect(LEGACY_TAB_MODE_CSS).not.toContain('.rt-benched-panel')
    })

    it('agrees with the checkout’s own vitals reader and strip over the corpus', () => {
        const source = readFileSync(`${checkout}/${SOURCE_JS}`, 'utf8')
        const deps = { getBarShowAsPercentage: () => false, getBarBackground: (_id: string, d: string) => d, renderPortraitHtml: (n: string) => `<i>${n}</i>`, escapeHtml: (s: unknown) => String(s), DEFAULT_HP_COLOR: '#00ffaa' }
        const theirs = new Function(...PARAMS, `${sliceConstant(source, CONSTANT)}\n${sliceFunction(source, 'extractPartyVitals')}\n${sliceFunction(source, 'renderPartyVitalsStrip')}\nreturn { TABMODE_PINNED_TAGS, extractPartyVitals, renderPartyVitalsStrip };`)(
            deps.getBarShowAsPercentage, deps.getBarBackground, deps.renderPortraitHtml, deps.escapeHtml, deps.DEFAULT_HP_COLOR,
        ) as ReturnType<typeof createTabModeLegacy>
        const ours = createTabModeLegacy(deps)
        expect(ours.TABMODE_PINNED_TAGS).toEqual(theirs.TABMODE_PINNED_TAGS)
        expect(TAB_MODE_PINNED_TAGS).toEqual(theirs.TABMODE_PINNED_TAGS)
        for (const content of CORPUS) {
            expect(ours.extractPartyVitals(content)).toEqual(theirs.extractPartyVitals(content))
            expect(extractPartyVitals(content)).toEqual(theirs.extractPartyVitals(content))
            expect(ours.renderPartyVitalsStrip({ PARTY: content })).toBe(theirs.renderPartyVitalsStrip({ PARTY: content }))
        }
        // The face's strip is the legacy's with AdventureTime's portrait and colour readers behind it.
        const face = renderPartyVitalsStrip(CORPUS[1], { portraits: { 'Alice Smith': 'https://x/a.png' } })
        expect(face).toContain('src="https://x/a.png"')
        expect(face).toContain('rt-entity-portrait-placeholder')
    })
})
