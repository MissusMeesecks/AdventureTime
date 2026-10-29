import { describe, expect, it } from 'vitest'

import {
    DEFAULT_PORTRAIT_PRESET_ID,
    FACTORY_PORTRAIT_PRESETS,
    factoryLocationPrompt,
    factoryPortraitPreset,
    findShippedLocationPresetId,
    isFactoryPortraitPresetId,
    isFactoryPortraitPresetName,
    isShippedLocationPrompt,
    locationPromptForToggle,
    resolvePortraitPresetBundle,
    savedPresetId,
} from './portrait-presets.js'
import { FACTORY_CARTRIDGE_DEFAULTS as factory } from '../state/factory-defaults.js'

describe('the art styles (63b)', () => {
    it('ships the legacy’s seven, Fantasy first and the default', () => {
        expect(FACTORY_PORTRAIT_PRESETS.map((p) => p.id)).toEqual(['fantasy', 'anime', 'photorealistic', 'oil_painting', 'comic', 'watercolor', 'dark_fantasy'])
        expect(DEFAULT_PORTRAIT_PRESET_ID).toBe('fantasy')
        expect(factoryPortraitPreset('anime').name).toBe('Anime')
        expect(factoryPortraitPreset('nope').id).toBe('fantasy')
        expect(isFactoryPortraitPresetId('comic')).toBe(true)
        expect(isFactoryPortraitPresetId('user:Mine')).toBe(false)
        expect(isFactoryPortraitPresetName(' Oil Painting ')).toBe(true)
        expect(isFactoryPortraitPresetName('My setup')).toBe(false)
        expect(savedPresetId('Mine')).toBe('user:Mine')
    })

    it('resolves a style to three prompts with its art lines, the location’s in the variant asked for', () => {
        const anime = resolvePortraitPresetBundle('anime', false)
        expect(anime.wordTarget).toBe(200)
        expect(anime.npcSystemPrompt).toContain('Art style: anime style portrait')
        expect(anime.characterSystemPrompt).toContain('Art style: anime style portrait')
        expect(anime.locationSystemPrompt).toContain('Art style: anime style scene')
        expect(anime.locationSystemPrompt).toContain('Scene composition:')
        expect(anime.locationSystemPrompt).not.toContain('Characters:')
        const dark = resolvePortraitPresetBundle('dark_fantasy', true)
        expect(dark.locationSystemPrompt).toContain('Characters:')
        expect(dark.locationSystemPrompt).toContain('Art style: dark fantasy scene')
        // The factory cartridge's three prompts are the fantasy style's, the location's without the NPCs.
        const fantasy = resolvePortraitPresetBundle('fantasy', false)
        expect(factory.portraitNpcSystemPrompt).toBe(fantasy.npcSystemPrompt)
        expect(factory.portraitCharacterSystemPrompt).toBe(fantasy.characterSystemPrompt)
        expect(factory.portraitLocationSystemPrompt).toBe(fantasy.locationSystemPrompt)
    })

    it('knows a shipped location prompt in either variant, and not an edited one', () => {
        for (const preset of FACTORY_PORTRAIT_PRESETS) {
            expect(findShippedLocationPresetId(factoryLocationPrompt(false, preset.id))).toBe(preset.id)
            expect(findShippedLocationPresetId(factoryLocationPrompt(true, preset.id))).toBe(preset.id)
        }
        expect(isShippedLocationPrompt(`${factoryLocationPrompt(false)}\n- And one more rule.`)).toBe(false)
        expect(isShippedLocationPrompt('')).toBe(false)
        expect(findShippedLocationPresetId(`  ${factoryLocationPrompt(true, 'comic').replace(/\n/g, '\r\n')}\n`)).toBe('comic')
    })

    it('swaps a shipped location prompt with the toggle, in its own style, and leaves an edited one alone', () => {
        const comic = factoryLocationPrompt(false, 'comic')
        expect(locationPromptForToggle(comic, true)).toBe(factoryLocationPrompt(true, 'comic'))
        expect(locationPromptForToggle(comic, false)).toBeNull()
        expect(locationPromptForToggle('', true, 'anime')).toBe(factoryLocationPrompt(true, 'anime'))
        expect(locationPromptForToggle('', true)).toBe(factoryLocationPrompt(true, 'fantasy'))
        expect(locationPromptForToggle('', false, 'user:Mine')).toBe(factoryLocationPrompt(false, 'fantasy'))
        expect(locationPromptForToggle(`${comic}\nMy own line.`, true, 'comic')).toBeNull()
    })
})
