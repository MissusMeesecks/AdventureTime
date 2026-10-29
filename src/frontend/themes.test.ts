// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { LEGACY_THEME_OPTIONS, LEGACY_THEME_VARS } from './themes-legacy.js'
import { STYLED_THEMES, THEME_CSS, THEME_IDS, THEME_TOKENS, THEME_WIZARD_CSS, accentContrast, applyCustomTheme, applyTheme, readThemeId, themeClass, themeOptions } from './themes.js'

describe('the visual themes (74a)', () => {
    it('names Multihog’s seven themes in its order, and the select follows them with the first renamed for the host', () => {
        expect(THEME_IDS).toEqual(LEGACY_THEME_OPTIONS.map((o: { value: string }) => o.value))
        const options = themeOptions()
        expect(options.map((o) => o.id)).toEqual([...THEME_IDS])
        expect(options[0]).toEqual({ id: 'native', label: 'Match Lumiverse', available: true })
        expect(options.find((o) => o.id === 'hacker')?.label).toBe('Hacker')
        expect(options.find((o) => o.id === 'pacific')?.label).toBe('Pacific Cove')
        // Custom is the wizard's (74b).
        expect(options[options.length - 1]).toEqual({ id: 'custom', label: '✨ Custom (AI Wizard)', available: true })
    })

    it('reads a stored theme, and the host’s colours for anything else', () => {
        expect(readThemeId('cherry')).toBe('cherry')
        expect(readThemeId('rt-theme-cherry')).toBe('native')
        expect(readThemeId(undefined)).toBe('native')
        expect(readThemeId(3)).toBe('native')
    })

    it('carries the fifteen tokens of Multihog’s variables under AdventureTime’s prefix', () => {
        expect(THEME_TOKENS).toEqual(['--lh-bg', '--lh-blur', '--lh-border', '--lh-text', '--lh-text-muted', '--lh-font', '--lh-font-mono', '--lh-accent', '--lh-accent-dim', '--lh-accent-bg', '--lh-card-border', '--lh-shadow', '--lh-header-bg', '--lh-card-bg', '--lh-card-header'])
    })

    it('writes one block per named theme with the legacy’s own values, and none for native or custom', () => {
        expect(STYLED_THEMES).toEqual(['hacker', 'fantasy', 'hologram', 'pacific', 'cherry'])
        for (const theme of STYLED_THEMES) {
            const block = THEME_CSS.match(new RegExp(`\\.lh-theme-${theme} \\{([^}]*)\\}`))
            expect(block, theme).not.toBeNull()
            for (const [name, value] of Object.entries(LEGACY_THEME_VARS[theme as keyof typeof LEGACY_THEME_VARS])) {
                expect(block![1]).toContain(`${name.replace(/^--rt-/, '--lh-')}: ${value};`)
            }
            expect(block![1]).not.toContain('--rt-')
        }
        expect(THEME_CSS).toContain('.lh-theme-hacker {')
        expect(THEME_CSS).toContain('--lh-accent: #00ffaa;')
        expect(THEME_CSS).toContain('--lh-accent: #f07aaa;')
        expect(THEME_CSS).not.toContain('.lh-theme-native')
        // Custom's block holds no value of its own: every token reads its twin (74c).
        expect(THEME_CSS.match(/\.lh-theme-custom \{([^}]*)\}/)![1]).not.toMatch(/: (?!var\(--lh-custom-)/)
    })

    it('derives a contrast colour for the accent, dark on every accent Multihog ships', () => {
        expect(accentContrast('#00ffaa')).toBe('#0a0a0a')
        expect(accentContrast('#ffd700')).toBe('#0a0a0a')
        expect(accentContrast('#123')).toBe('#f4f4f4')
        expect(accentContrast('#102030')).toBe('#f4f4f4')
        expect(accentContrast('rgba(0, 255, 170, 0.4)')).toBe('#0a0a0a')
        for (const theme of STYLED_THEMES) expect(THEME_CSS.match(new RegExp(`\\.lh-theme-${theme} \\{([^}]*)\\}`))![1]).toContain('--lh-accent-contrast: #0a0a0a;')
    })

    it('scopes the two themes’ scrollbar and pill rules under the panel’s root, never the host’s page', () => {
        expect(THEME_CSS).toContain('.lh-theme-pacific .adventuretime-panel *::-webkit-scrollbar {')
        expect(THEME_CSS).toContain('.lh-theme-cherry .adventuretime-panel .rt-hp-label { color: #f07aaa; font-weight: bold; }')
        expect(THEME_CSS).not.toMatch(/^\.lh-theme-[a-z]+ \*::-webkit-scrollbar/m)
        expect(THEME_CSS).not.toContain('.rt-theme-')
    })

    it('writes the wizard’s theme as the tokens’ twins inline on the body, read by the custom block; derives the contrast; clears them for no theme (74b, 74c)', () => {
        const body = document.createElement('div')
        applyCustomTheme(body, { '--rt-custom-accent': '#101010', '--rt-custom-bg': 'rgba(0,0,0,0.9)', '--rt-custom-nonsense': 'x', '--rt-custom-text': '' })
        expect(body.style.getPropertyValue('--lh-custom-accent')).toBe('#101010')
        expect(body.style.getPropertyValue('--lh-custom-bg')).toBe('rgba(0,0,0,0.9)')
        expect(body.style.getPropertyValue('--lh-custom-accent-contrast')).toBe('#f4f4f4')
        expect(body.style.getPropertyValue('--lh-custom-nonsense')).toBe('')
        expect(body.style.getPropertyValue('--lh-custom-text')).toBe('')
        // Never the token itself (74c): an inline token could not be outranked by the day/night palette.
        expect(body.style.getPropertyValue('--lh-accent')).toBe('')
        applyCustomTheme(body, null)
        expect(body.getAttribute('style') ?? '').toBe('')
        // The custom block reads each twin into its token, so a twin not written falls to the host's colour.
        const block = THEME_CSS.match(/\.lh-theme-custom \{([^}]*)\}/)![1]!
        for (const token of THEME_TOKENS) expect(block).toContain(`${token}: var(${token.replace('--lh-', '--lh-custom-')});`)
        expect(block).toContain('--lh-accent-contrast: var(--lh-custom-accent-contrast);')
        expect(block).not.toContain(', ')
        // The wizard's box hides as a flex box must (lesson 60).
        expect(THEME_WIZARD_CSS).toContain('.adventuretime-panel .lh-theme-wizard[hidden] { display: none; }')
    })

    it('swaps the theme class on an element, taking the old one off', () => {
        const body = document.createElement('div')
        body.classList.add('kept')
        applyTheme(body, 'hacker')
        expect(Array.from(body.classList)).toEqual(['kept', 'lh-theme-hacker'])
        applyTheme(body, 'cherry')
        expect(Array.from(body.classList)).toEqual(['kept', 'lh-theme-cherry'])
        expect(themeClass('native')).toBe('lh-theme-native')
    })
})
