import { describe, expect, it } from 'vitest'

import {
    DEFAULT_MAP_THEME,
    DEFAULT_MAP_THEME_PRESET_ID,
    FACTORY_MAP_THEME_PRESETS,
    MAP_THEME_FIELDS,
    applyMapThemeToRoot,
    mapThemePresetName,
    normalizeMapTheme,
    readMapTheme,
    readMapThemeImage,
    readMapThemePresetId,
    readSavedMapThemePresets,
    resolveMapThemePreset,
} from './map-themes.js'

describe('the Map Themes (74g)', () => {
    it('carries the legacy’s fields, default and five factory presets', () => {
        expect(MAP_THEME_FIELDS.map((field) => field.key)).toEqual(['background', 'textbox', 'frame', 'node', 'nodeDiscovered', 'nodeFog', 'text', 'textMuted', 'accent', 'route', 'routeLocked', 'routeBlocked', 'creature', 'group', 'trap', 'hazard', 'alarm', 'barrier', 'object', 'loot', 'effect', 'other'])
        expect([...new Set(MAP_THEME_FIELDS.map((field) => field.group))]).toEqual(['Map', 'Areas', 'Routes', 'Assets'])
        expect(DEFAULT_MAP_THEME.accent).toBe('#ffaa00')
        expect(DEFAULT_MAP_THEME.backgroundImageStrength).toBe(55)
        expect(FACTORY_MAP_THEME_PRESETS.map((preset) => preset.id)).toEqual(['factory:ember', 'factory:blueprint', 'factory:verdant', 'factory:parchment', 'factory:blue-white'])
        expect(resolveMapThemePreset(DEFAULT_MAP_THEME_PRESET_ID)).toEqual(DEFAULT_MAP_THEME)
        expect(resolveMapThemePreset('user:Night', { Night: { background: '#010203' } })?.background).toBe('#010203')
        expect(resolveMapThemePreset('missing')).toBeNull()
    })

    it('reads a theme as the legacy does, but keeps a canvas image stored with the host (departure 125)', () => {
        const theme = readMapTheme({ accent: '#AABBCC', route: 'red', backgroundImage: '/images/stored/map.jpg', backgroundImageStrength: 150, surprise: '#123456' })
        expect(theme.accent).toBe('#aabbcc')
        expect(theme.route).toBe(DEFAULT_MAP_THEME.route)
        expect(theme.backgroundImage).toBe('/images/stored/map.jpg')
        expect(theme.backgroundImageStrength).toBe(100)
        expect(theme).not.toHaveProperty('surprise')
        // The legacy's own normaliser drops the host's address; ours is the difference.
        expect(normalizeMapTheme({ backgroundImage: '/images/stored/map.jpg' }).backgroundImage).toBe('')
        // The legacy's two sources pass as they are; a scheme, or another origin dressed as a path, does not.
        expect(readMapThemeImage('https://host/a.png')).toBe('https://host/a.png')
        expect(readMapThemeImage('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
        expect(readMapThemeImage('javascript:alert(1)')).toBe('')
        expect(readMapThemeImage('data:text/html,bad')).toBe('')
        expect(readMapThemeImage('//evil/a.png')).toBe('')
        expect(readMapThemeImage('  ')).toBe('')
        expect(readMapTheme(null)).toEqual(DEFAULT_MAP_THEME)
        expect(readMapTheme([1])).toEqual(DEFAULT_MAP_THEME)
    })

    it('reads the saved presets by the legacy’s rules with the same image rule', () => {
        const source: Record<string, unknown> = Object.create(null)
        source.Night = { background: '#010203', backgroundImage: '/images/stored/n.jpg' }
        source['  '] = { background: '#ffffff' }
        source.__proto__ = { background: '#ffffff' }
        source.constructor = { background: '#ffffff' } as never
        const presets = readSavedMapThemePresets(source)
        expect(Object.keys(presets)).toEqual(['Night'])
        expect(presets.Night!.background).toBe('#010203')
        expect(presets.Night!.backgroundImage).toBe('/images/stored/n.jpg')
        expect(readSavedMapThemePresets(null)).toEqual({})
        expect(readSavedMapThemePresets([{ a: 1 }])).toEqual({})
        const long = 'x'.repeat(100)
        expect(Object.keys(readSavedMapThemePresets({ [long]: {} }))[0]).toHaveLength(80)
        expect(Object.keys(readSavedMapThemePresets(Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`p${i}`, {}]))))).toHaveLength(100)
    })

    it('reads a preset id and names it', () => {
        expect(readMapThemePresetId('factory:ember')).toBe('factory:ember')
        expect(readMapThemePresetId(7)).toBe('')
        expect(mapThemePresetName('factory:verdant')).toBe('Verdant')
        expect(mapThemePresetName('user:Night', { Night: {} })).toBe('Night')
        expect(mapThemePresetName('user:Night')).toBeNull()
        expect(mapThemePresetName('')).toBeNull()
    })

    it('writes the twenty-nine variables on a root through the legacy’s applier', () => {
        const vars: Record<string, string> = {}
        applyMapThemeToRoot({ ...DEFAULT_MAP_THEME, accent: '#123456', backgroundImage: 'https://host/map texture.jpg', backgroundImageStrength: 25 }, { style: { setProperty: (name, value) => { vars[name] = value } } })
        expect(Object.keys(vars)).toHaveLength(29)
        expect(vars['--rt-map-accent']).toBe('#123456')
        expect(vars['--rt-map-accent-soft']).toBe('rgba(18, 52, 86, 0.28)')
        expect(vars['--rt-map-background-image']).toBe('url("https://host/map texture.jpg")')
        expect(vars['--rt-map-background-overlay']).toBe('rgba(12, 12, 12, 0.25)')
    })
})
