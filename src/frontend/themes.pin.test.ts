/**
 * The visual themes (74a, departure 81) against the pinned legacy build: the
 * generated module must be what a fresh slice of the checkout's `style.css`
 * and `settings.html` gives, and the tokens the face writes must be the
 * legacy's own values. Needs MULTIHOG_CHECKOUT and skips without it.
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { SOURCE_APPEARANCE, SOURCE_CSS, SOURCE_HTML, SOURCE_RENDERER, SOURCE_WIZARD, renderLegacy, sliceThemes } from '../../scripts/extract-themes.mjs'
import { LEGACY_DAY_NIGHT, LEGACY_THEME_VARS, LEGACY_THEME_WIZARD, cssUrlFromImageSrc, getPanelBgConfig } from './themes-legacy.js'
import { BACKDROP_CSS, BACKDROP_KEYS, backdropConfig } from './backdrop.js'
import { THEME_WIZARD_SYSTEM_PROMPT, buildThemeWizardPrompt } from '../tracker/theme-wizard.js'
import { STYLED_THEMES, THEME_CSS } from './themes.js'
import { DAY_NIGHT_CSS, getTimeOfDayInfo, renderDayNightBadge } from './day-night.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && existsSync(`${checkout}/${SOURCE_CSS}`) && existsSync(`${checkout}/${SOURCE_HTML}`) && existsSync(`${checkout}/${SOURCE_WIZARD}`) && existsSync(`${checkout}/${SOURCE_RENDERER}`) && existsSync(`${checkout}/${SOURCE_APPEARANCE}`)

describe.skipIf(!available)('the visual themes against the pinned legacy build', () => {
    it('is the generated module, byte for byte, from a fresh slice of the checkout', () => {
        const committed = readFileSync('src/frontend/themes-legacy.js', 'utf8')
        const head = committed.match(/@ ([0-9a-f]{40})\./)![1]!
        expect(committed).toBe(renderLegacy(sliceThemes(checkout!), head))
    })

    it('writes every named theme’s tokens with the value the checkout’s stylesheet declares', () => {
        const css = readFileSync(`${checkout}/${SOURCE_CSS}`, 'utf8')
        for (const theme of STYLED_THEMES) {
            const legacy = css.match(new RegExp(`^\\.rpg-tracker-panel\\.rt-theme-${theme} \\{\\n([\\s\\S]*?)\\n\\}`, 'm'))![1]!
            const ours = THEME_CSS.match(new RegExp(`\\.lh-theme-${theme} \\{([^}]*)\\}`))![1]!
            const declared = [...legacy.matchAll(/^\s*(--rt-[\w-]+):\s*(.+?);\s*$/gm)]
            expect(declared.length, theme).toBe(Object.keys(LEGACY_THEME_VARS[theme as keyof typeof LEGACY_THEME_VARS]).length)
            for (const [, name, value] of declared) expect(ours, `${theme} ${name}`).toContain(`${name!.replace(/^--rt-/, '--lh-')}: ${value};`)
        }
        // The one the maintainer will see first: Hacker's green, Multihog's own.
        expect(css).toContain('--rt-accent: #00ffaa;')
        expect(THEME_CSS).toContain('.lh-theme-hacker {')
    })

    it('sends the AI Theme Wizard the prompt the checkout’s openThemeWizard holds, word for word (74b)', () => {
        const js = readFileSync(`${checkout}/${SOURCE_WIZARD}`, 'utf8')
        // Read independently of the extractor: the literal between its own backticks.
        const start = js.indexOf('const systemPrompt = `') + 'const systemPrompt = `'.length
        const legacyPrompt = js.slice(start, js.indexOf('`;', start))
        expect(legacyPrompt.length).toBeGreaterThan(1000)
        expect(THEME_WIZARD_SYSTEM_PROMPT).toBe(legacyPrompt)
        expect(buildThemeWizardPrompt({ description: 'noir' }).system).toBe(legacyPrompt)
        // The legacy's user frames, with the JS escapes evaluated as the legacy evaluates them.
        expect(js).toContain(': `\\n\\nUser description: ${promptText}`;')
        expect(LEGACY_THEME_WIZARD.newFrame).toBe('\n\nUser description: ${promptText}')
        expect(js).toContain("if (missing.length > 3)")
        expect(LEGACY_THEME_WIZARD.missingTolerated).toBe(3)
        for (const key of LEGACY_THEME_WIZARD.expectedKeys) expect(js).toContain(`'${key}'`)
    })

    it('reads the time of day as the checkout’s own getTimeOfDayInfo does, over a corpus of clocks (74c)', () => {
        const js = readFileSync(`${checkout}/${SOURCE_RENDERER}`, 'utf8')
        // The checkout's function, read independently of the extractor and run as it is.
        const start = js.indexOf('export function getTimeOfDayInfo(')
        const end = js.indexOf('\n}\n', start) + 2
        const source = js.slice(start, end).replace(/^export /, '')
        const legacy = new Function(`${source}\nreturn getTimeOfDayInfo;`)() as (s: string) => unknown
        const corpus = ['Day 4, 06:15 AM', '12:00 AM', '12:00 PM', '12:30 am', '04:59 AM', '5:00 AM', '6:59 AM', '7:00 AM', '11:59 AM', '13:59', '14:00', '17:59', '18:00', '19:59', '20:00', '23:59', '24:00', '25:10', '9:5', 'Day 3', '', 'Time: 11:30 PM, Day 2', 'Last rest: 10:00 PM', 'Current Time: 09:40 AM (Day 5)', '1:00', '0:00 PM', '12:60 AM']
        for (const clock of corpus) expect(getTimeOfDayInfo(clock), clock).toEqual(legacy(clock))
        expect(js).toContain("const DAYNIGHT_MOON_PHASES = new Set(['lateNight', 'night']);")
        // The badge's shape and hover text are the checkout's renderDayNightBadge.
        expect(js).toContain('title="In-world time of day: ${escapeHtml(phase.replace(/([A-Z])/g, \' $1\').toLowerCase())}"')
        expect(js).toContain("const starsHtml = isMoon ? `<div class=\"rt-sky-stars\"></div>` : '';")
        expect(renderDayNightBadge('11:30 PM')).toContain('title="In-world time of day: night"><span class="lh-sky-stars">')
    })

    it('sets every phase’s palette with the values the checkout’s stylesheet declares, and registers the colours it registers (74c)', () => {
        const css = readFileSync(`${checkout}/${SOURCE_CSS}`, 'utf8')
        for (const phase of Object.keys(LEGACY_DAY_NIGHT.phases)) {
            const legacy = css.match(new RegExp(`^\\.rpg-tracker-panel\\.rt-daynight-active\\.rt-phase-${phase} \\{\\n([\\s\\S]*?)\\n\\}`, 'm'))![1]!
            const ours = DAY_NIGHT_CSS.match(new RegExp(`\\}\\n\\.lh-daynight\\.lh-phase-${phase} \\{([^}]*)\\}`))![1]!
            const declared = [...legacy.matchAll(/^\s*(--rt-[\w-]+):\s*(.+?);\s*$/gm)]
            expect(declared.length, phase).toBe(10)
            for (const [, name, value] of declared) {
                const twin = css.includes(`@property ${name} {`) ? name!.replace('--rt-', '--lh-dn-') : name!.replace('--rt-', '--lh-')
                expect(ours, `${phase} ${name}`).toContain(`${twin}: ${value};`)
            }
        }
        for (const [name, initial] of Object.entries(LEGACY_DAY_NIGHT.properties)) {
            expect(css).toContain(`@property ${name} {\n    syntax: '<color>';\n    inherits: true;\n    initial-value: ${initial};\n}`)
        }
        expect(css).toContain('        --rt-bg 2s ease,\n')
        expect(DAY_NIGHT_CSS).toContain('--lh-dn-bg 2s ease,')
    })

    it('decides a backdrop as the checkout’s own getPanelBgConfig does, over a corpus, and draws the art and the tint with the checkout’s values (74d)', () => {
        const js = readFileSync(`${checkout}/${SOURCE_APPEARANCE}`, 'utf8')
        const fn = (name: string) => {
            const start = js.indexOf(`function ${name}(`)
            const end = js.indexOf('\n}\n', start) + 2
            return js.slice(start, end)
        }
        const legacyConfig = new Function(`${fn('getPanelBgConfig')}\nreturn getPanelBgConfig;`)() as (s: Record<string, unknown>, k: typeof BACKDROP_KEYS) => unknown
        const legacyUrl = new Function(`${fn('cssUrlFromImageSrc')}\nreturn cssUrlFromImageSrc;`)() as (s: string) => string
        const corpus: Array<Record<string, unknown>> = [
            { day: '/images/d.jpg', night: '', strength: 55 }, { day: '', night: '/images/n.jpg', strength: 40 }, { day: ' a ', night: ' b ', strength: '70' },
            { day: '', night: '', strength: 0 }, { day: 'x', strength: 250 }, { day: 'x', strength: -4 }, { day: 'x', strength: 'strong' }, { day: 'x' }, {}, { day: 0, night: null, strength: 55.6 },
        ]
        for (const entry of corpus) expect(getPanelBgConfig(entry, BACKDROP_KEYS), JSON.stringify(entry)).toEqual(legacyConfig(entry, BACKDROP_KEYS))
        for (const src of ['', '  ', '/images/d.jpg', ' https://host/a "b".jpg ', 'data:image/png;base64,AAAA']) expect(cssUrlFromImageSrc(src), src).toBe(legacyUrl(src))
        // The legacy's keys are the legacy's names, and ours read a stored backdrop through the same rule.
        expect(js).toContain("export const PANEL_BG_TRACKER_KEYS = { dayKey: 'panelBgImage', nightKey: 'panelBgImageNight', strengthKey: 'panelBgOverlayStrength' };")
        expect(backdropConfig({ day: '', night: '/images/n.jpg', strength: 40 })).toEqual({ day: '/images/n.jpg', night: '/images/n.jpg', strength: 0.4, hasImage: true })
        // The stylesheet's base tint and strength, the art's and the tint's layering, and the night swap are the checkout's.
        const css = readFileSync(`${checkout}/${SOURCE_CSS}`, 'utf8')
        expect(css).toContain('.rpg-tracker-panel.rt-has-bg-image {\n    --rt-bg-overlay-color: rgba(18, 18, 24, 0.72);\n    --rt-bg-overlay-strength: 0.55;')
        expect(BACKDROP_CSS).toContain('--lh-backdrop-scrim: rgba(18, 18, 24, 0.72); --lh-backdrop-strength: 0.55;')
        expect(css).toContain('background-image: var(--rt-user-bg-image-night, var(--rt-user-bg-image, none));')
        expect(css).toContain('    background: var(--rt-bg-overlay-color);\n    opacity: var(--rt-bg-overlay-strength);')
        expect(js).toContain('resolve(canvas.toDataURL(\'image/jpeg\', 0.78));')
        for (const [phase, colour] of Object.entries(LEGACY_DAY_NIGHT.overlays)) {
            expect(css).toContain(`.rpg-tracker-panel.rt-has-bg-image.rt-daynight-active.rt-phase-${phase} {\n    --rt-bg-overlay-color: ${colour};\n}`)
        }
    })
})
