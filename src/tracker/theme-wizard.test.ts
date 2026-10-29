import { describe, expect, it } from 'vitest'

import { LEGACY_THEME_WIZARD } from '../frontend/themes-legacy.js'
import { THEME_WIZARD_KEYS, THEME_WIZARD_SYSTEM_PROMPT, buildThemeWizardPrompt, customKeyToToken, readCustomTheme, readSavedThemes, readThemeWizardReply } from './theme-wizard.js'

const full = Object.fromEntries(THEME_WIZARD_KEYS.map((k) => [k, k === '--rt-custom-accent' ? '#ff00aa' : 'rgba(1,2,3,0.5)']))

describe('the AI Theme Wizard’s prompt (74b)', () => {
    it('is Multihog’s designer prompt with its fifteen keys', () => {
        expect(THEME_WIZARD_KEYS).toHaveLength(15)
        expect(THEME_WIZARD_KEYS[0]).toBe('--rt-custom-bg')
        expect(THEME_WIZARD_KEYS[14]).toBe('--rt-custom-card-header')
        expect(THEME_WIZARD_SYSTEM_PROMPT).toMatch(/^You are a CSS theme designer for a dark-UI RPG tracker panel\./)
        for (const key of THEME_WIZARD_KEYS) expect(THEME_WIZARD_SYSTEM_PROMPT).toContain(`"${key}":`)
        expect(THEME_WIZARD_SYSTEM_PROMPT).toContain('Output ONLY the JSON object.')
    })

    it('frames a new theme as the legacy does, and an iteration with the current theme as JSON', () => {
        const fresh = buildThemeWizardPrompt({ description: '  neon noir  ' })
        expect(fresh).toEqual({ system: THEME_WIZARD_SYSTEM_PROMPT, user: '\n\nUser description: neon noir', iterated: false })
        const again = buildThemeWizardPrompt({ description: 'make it warmer', current: { '--rt-custom-accent': '#00ffaa' } })
        expect(again.iterated).toBe(true)
        expect(again.user).toBe('\n\nCURRENT THEME STATE (JSON):\n' + JSON.stringify({ '--rt-custom-accent': '#00ffaa' }, null, 2) + '\n\nUser wants to CHANGE this theme as follows: make it warmer')
        // An empty current theme is a new one.
        expect(buildThemeWizardPrompt({ description: 'x', current: {} }).iterated).toBe(false)
        expect(buildThemeWizardPrompt({ description: 'x', current: null }).iterated).toBe(false)
        // The frames are the legacy's own, with their placeholders.
        expect(LEGACY_THEME_WIZARD.newFrame).toBe('\n\nUser description: ${promptText}')
        expect(LEGACY_THEME_WIZARD.missingTolerated).toBe(3)
    })
})

describe('the AI Theme Wizard’s reading of a reply (74b)', () => {
    it('takes the first JSON object out of prose and fences, and keeps the fifteen keys', () => {
        const reading = readThemeWizardReply('Sure! ```json\n' + JSON.stringify({ ...full, extra: 'no' }) + '\n```')
        expect(reading.ok).toBe(true)
        if (!reading.ok) return
        expect(Object.keys(reading.theme)).toEqual([...THEME_WIZARD_KEYS])
        expect(reading.theme['--rt-custom-accent']).toBe('#ff00aa')
        expect(reading.missing).toEqual([])
    })

    it('tolerates up to three missing keys and refuses four, naming them', () => {
        const three = { ...full }
        delete three['--rt-custom-blur']; delete three['--rt-custom-font']; delete three['--rt-custom-shadow']
        const ok = readThemeWizardReply(JSON.stringify(three))
        expect(ok.ok).toBe(true)
        if (ok.ok) expect(ok.missing).toEqual(['--rt-custom-blur', '--rt-custom-font', '--rt-custom-shadow'])
        const four = { ...three }
        delete four['--rt-custom-card-bg']
        expect(readThemeWizardReply(JSON.stringify(four))).toEqual({ ok: false, reason: 'AI response is missing too many theme keys: --rt-custom-blur, --rt-custom-font, --rt-custom-shadow, --rt-custom-card-bg' })
        // An empty value counts as missing, as the legacy's `!vars[k]` does.
        expect(readThemeWizardReply(JSON.stringify({ ...full, '--rt-custom-bg': '', '--rt-custom-text': '', '--rt-custom-font': '', '--rt-custom-blur': '' })).ok).toBe(false)
    })

    it('says so for no JSON and for JSON that will not parse', () => {
        expect(readThemeWizardReply('I cannot do that.')).toEqual({ ok: false, reason: 'AI did not return valid JSON. Try a different prompt or model.' })
        expect(readThemeWizardReply('{ "--rt-custom-bg": }')).toEqual({ ok: false, reason: 'Failed to parse AI response as JSON.' })
        // A non-string value is dropped, not written.
        const reading = readThemeWizardReply(JSON.stringify({ ...full, '--rt-custom-shadow': 3 }))
        expect(reading.ok && reading.theme['--rt-custom-shadow']).toBeUndefined()
    })

    it('reads a stored theme and a library, dropping what is not the wizard’s', () => {
        expect(readCustomTheme(null)).toBeNull()
        expect(readCustomTheme('x')).toBeNull()
        expect(readCustomTheme({ '--lh-accent': '#fff' })).toBeNull()
        expect(readCustomTheme({ '--rt-custom-accent': ' #fff ', '--rt-custom-bg': 2, other: 'y' })).toEqual({ '--rt-custom-accent': '#fff' })
        expect(readSavedThemes({ ' Night ': { '--rt-custom-accent': '#123' }, Bad: 'no', '': { '--rt-custom-accent': '#1' } })).toEqual({ Night: { '--rt-custom-accent': '#123' } })
        expect(readSavedThemes([1])).toEqual({})
        expect(customKeyToToken('--rt-custom-card-header')).toBe('--lh-card-header')
    })
})
