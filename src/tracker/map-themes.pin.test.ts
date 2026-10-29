/**
 * The Map Themes' legacy half (74g), held to the pinned source two ways: the
 * generated module must equal a fresh slice of the checkout byte for byte,
 * and the typed face must agree with the checkout's own module -- imported
 * as it is, since it imports nothing -- over a corpus of themes, presets,
 * ids and roots.
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { exportedNames, sliceLegacy } from '../../scripts/extract-map-themes.mjs'
import { createMapThemesLegacy } from './map-themes-legacy.js'
import {
    DEFAULT_MAP_THEME,
    FACTORY_MAP_THEME_PRESETS,
    MAP_THEME_FIELDS,
    applyMapThemeToRoot,
    normalizeMapTheme,
    normalizeSavedMapThemePresets,
    readMapTheme,
    readSavedMapThemePresets,
    resolveMapThemePreset,
} from './map-themes.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const FILE = 'src/state/map-themes.js'
const available = !!checkout && existsSync(`${checkout}/${FILE}`)

type Legacy = ReturnType<typeof createMapThemesLegacy>

const THEMES: unknown[] = [
    undefined, null, 'ember', [], {},
    { accent: '#AABBCC', route: 'red', backgroundImage: 'https://example.com/texture.png', backgroundImageStrength: 150, surprise: '#123456' },
    { background: '#010203', backgroundImage: 'javascript:alert(1)', backgroundImageStrength: 'x' },
    { backgroundImage: 'data:image/png;base64,AAAA', backgroundImageStrength: -4 },
    { backgroundImage: 'data:text/html,bad', backgroundImageStrength: 33.6 },
    { ...FACTORY_MAP_THEME_PRESETS[1]!.theme, text: '#FFF' },
    { ...FACTORY_MAP_THEME_PRESETS[4]!.theme, backgroundImage: 'http://host/x.jpg', backgroundImageStrength: '70' },
]

describe.skipIf(!available)('the Map Themes against the pinned legacy build', () => {
    it('is the generated module, byte for byte, from a fresh slice of the checkout, with every export', () => {
        const committed = readFileSync('src/tracker/map-themes-legacy.js', 'utf8')
        expect(committed).toContain(sliceLegacy(checkout!))
        const names = exportedNames(readFileSync(`${checkout}/${FILE}`, 'utf8'))
        expect(names).toEqual(['MAP_THEME_FIELDS', 'DEFAULT_MAP_THEME', 'FACTORY_MAP_THEME_PRESETS', 'normalizeMapTheme', 'normalizeSavedMapThemePresets', 'resolveMapThemePreset', 'applyMapThemeToRoot'])
        const made = createMapThemesLegacy() as Record<string, unknown>
        for (const name of names) expect(made[name], name).toBeDefined()
    })

    it('agrees with the checkout’s own module over themes, presets, ids and roots', async () => {
        const theirs = (await import(`${checkout}/${FILE}`)) as Legacy
        expect(MAP_THEME_FIELDS).toEqual(theirs.MAP_THEME_FIELDS)
        expect(DEFAULT_MAP_THEME).toEqual(theirs.DEFAULT_MAP_THEME)
        expect(FACTORY_MAP_THEME_PRESETS).toEqual(theirs.FACTORY_MAP_THEME_PRESETS)
        for (const theme of THEMES) {
            expect(normalizeMapTheme(theme)).toEqual(theirs.normalizeMapTheme(theme))
            // AdventureTime's reader is the legacy's normaliser for every source the legacy keeps.
            expect(readMapTheme(theme)).toEqual(theirs.normalizeMapTheme(theme))
            const ours: Record<string, string> = {}
            const legacy: Record<string, string> = {}
            applyMapThemeToRoot(theme, { style: { setProperty: (name, value) => { ours[name] = value } } })
            theirs.applyMapThemeToRoot(theme, { style: { setProperty: (name: string, value: string) => { legacy[name] = value } } } as never)
            expect(ours).toEqual(legacy)
            expect(Object.keys(ours)).toHaveLength(29)
        }
        const saved: Record<string, unknown> = Object.create(null)
        saved.Night = { background: '#010203' }
        saved['  Dawn  '] = THEMES[5]
        saved.__proto__ = { background: '#ffffff' }
        saved[''] = {}
        for (let i = 0; i < 110; i += 1) saved[`p${i}`] = { accent: '#000000' }
        for (const value of [saved, null, [], 'x', {}]) {
            expect(normalizeSavedMapThemePresets(value)).toEqual(theirs.normalizeSavedMapThemePresets(value))
            expect(readSavedMapThemePresets(value)).toEqual(theirs.normalizeSavedMapThemePresets(value))
        }
        const presets = normalizeSavedMapThemePresets(saved)
        for (const id of ['factory:ember', 'factory:blueprint', 'factory:blue-white', 'user:Night', 'user:Dawn', 'user:missing', '', 'ember', 7, null]) {
            expect(resolveMapThemePreset(id, presets)).toEqual(theirs.resolveMapThemePreset(id, presets))
        }
    })
})
