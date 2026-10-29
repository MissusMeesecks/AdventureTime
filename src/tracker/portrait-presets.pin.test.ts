/**
 * The art styles' legacy half, held to the pinned source two ways: the
 * generated module must equal a fresh slice of the checkout byte for byte,
 * and the typed face must agree with the checkout's own module -- imported
 * as it is, since it imports nothing -- over every style, both location
 * variants, and a corpus of texts.
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { exportedNames, sliceLegacy } from '../../scripts/extract-portrait-presets.mjs'
import { createPortraitPresetsLegacy } from './portrait-presets-legacy.js'
import {
    DEFAULT_PORTRAIT_PRESET_ID,
    FACTORY_PORTRAIT_PRESETS,
    factoryLocationPrompt,
    findShippedLocationPresetId,
    isFactoryPortraitPresetName,
    isShippedLocationPrompt,
    resolvePortraitPresetBundle,
} from './portrait-presets.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const FILE = 'src/state/portrait-prompts.js'
const available = !!checkout && existsSync(`${checkout}/${FILE}`)

type Legacy = ReturnType<typeof createPortraitPresetsLegacy>

describe.skipIf(!available)('the art styles against the pinned legacy build', () => {
    it('is the generated module, byte for byte, from a fresh slice of the checkout, with every export', () => {
        const committed = readFileSync('src/tracker/portrait-presets-legacy.js', 'utf8')
        expect(committed).toContain(sliceLegacy(checkout!))
        const names = exportedNames(readFileSync(`${checkout}/${FILE}`, 'utf8'))
        expect(names.length).toBeGreaterThanOrEqual(17)
        const made = createPortraitPresetsLegacy() as Record<string, unknown>
        for (const name of names) expect(made[name], name).toBeDefined()
    })

    it('agrees with the checkout’s own module over every style, both variants and a corpus of texts', async () => {
        const theirs = (await import(`${checkout}/${FILE}`)) as Legacy
        expect(DEFAULT_PORTRAIT_PRESET_ID).toBe(theirs.DEFAULT_PORTRAIT_PROMPT_PRESET_ID)
        expect(FACTORY_PORTRAIT_PRESETS).toEqual(theirs.FACTORY_PORTRAIT_PROMPT_PRESETS)
        for (const preset of theirs.FACTORY_PORTRAIT_PROMPT_PRESETS) {
            for (const withNpcs of [false, true]) {
                expect(resolvePortraitPresetBundle(preset.id, withNpcs)).toEqual(theirs.resolveFactoryPortraitPromptBundle(preset.id, withNpcs))
                expect(factoryLocationPrompt(withNpcs, preset.id)).toBe(theirs.getDefaultPortraitLocationSystemPrompt(withNpcs, preset.id))
            }
            expect(isFactoryPortraitPresetName(preset.name.toUpperCase())).toBe(theirs.getFactoryPortraitPromptPresetNameSet().has(preset.name.toLowerCase()))
        }
        const texts = [
            '', '  ', 'Draw it.',
            theirs.PORTRAIT_LOCATION_SYSTEM_PROMPT_LEGACY, theirs.PORTRAIT_LOCATION_SYSTEM_PROMPT_WITH_NPCS_V1,
            theirs.PORTRAIT_LOCATION_SYSTEM_PROMPT_WITHOUT_NPCS, theirs.PORTRAIT_LOCATION_SYSTEM_PROMPT_WITH_NPCS,
            `${theirs.PORTRAIT_LOCATION_SYSTEM_PROMPT_WITH_NPCS}\n- One more rule.`,
            ...theirs.FACTORY_PORTRAIT_PROMPT_PRESETS.flatMap((p) => [theirs.buildLocationPortraitSystemPrompt(p.sceneArtStyle, false), `\r\n${theirs.buildLocationPortraitSystemPrompt(p.sceneArtStyle, true).replace(/\n/g, '\r\n')}  `]),
        ]
        for (const text of texts) {
            expect(findShippedLocationPresetId(text)).toBe(theirs.findShippedPortraitLocationPresetId(text))
            expect(isShippedLocationPrompt(text)).toBe(theirs.isShippedPortraitLocationSystemPrompt(text))
        }
    })
})
