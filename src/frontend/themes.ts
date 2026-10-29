/**
 * The visual themes (Phase 74a, departure 81): Multihog's seven looks as
 * `--lh-*` tokens on a class, built from the nineteenth generated file.
 *
 * Multihog paints its panel with fifteen `--rt-*` variables and swaps a
 * `rt-theme-<name>` class on every panel it draws. AdventureTime's stylesheet
 * reads the host's own `--lumiverse-*` variables (68); since 74a every
 * such use is nested behind a token of the same fifteen names —
 * `var(--lh-accent, var(--lumiverse-primary, #d4a940))` — so a root with
 * no theme class is the look of 0.134.0 byte for byte, and a theme class
 * sets the tokens. The class goes on the document's body, not on each
 * root: a custom property is inherited, only AdventureTime's rules read these,
 * and the host replaces the root it is handed for a card under a message
 * (lesson 38), so one class on the body reaches the panel, the widgets,
 * the second tab, the editor tab, the prompt dialog and every card at
 * once with no root to miss.
 *
 * The values are the legacy's own, read off `style.css` at the pin by
 * `scripts/extract-themes.mjs` and held by `themes.pin.test.ts`. Two
 * things are AdventureTime's: `native` writes no token (the host's colours are
 * the fallbacks already; Multihog's *Match ST UI* reads SillyTavern's),
 * and `--lh-accent-contrast`, the text colour on an accent-filled badge,
 * which Multihog has no variable for and the host does
 * (`--lumiverse-primary-contrast`), is derived from each theme's accent.
 */
import { DEFAULT_THEME, THEME_IDS, readThemeId, type ThemeId } from '../protocol.js'
import { LEGACY_THEME_EXTRAS, LEGACY_THEME_OPTIONS, LEGACY_THEME_VARS } from './themes-legacy.js'
import { customKeyToToken, type CustomTheme } from '../tracker/theme-wizard.js'

export { DEFAULT_THEME, THEME_IDS, readThemeId, type ThemeId }

/** The class a theme puts on the body. */
export function themeClass(theme: ThemeId): string {
    return `lh-theme-${theme}`
}

/** Multihog's fifteen variables, in its order; a token is the same name under `--lh-`. */
export const THEME_TOKENS = Object.keys(LEGACY_THEME_VARS.hacker ?? {}).map((name) => name.replace(/^--rt-/, '--lh-'))

/** The themes that set tokens in the stylesheet: the five named ones. `native` is the fallbacks; `custom` is the wizard's, written on the body (74b). */
export const STYLED_THEMES: readonly ThemeId[] = THEME_IDS.filter((id) => id !== 'native' && id !== 'custom')

/** One entry of the select, in Multihog's order and words (the first renamed for the host). */
export interface ThemeOption {
    id: ThemeId
    label: string
    /** False for a theme nothing can draw; every one of the seven can be since 74b. */
    available: boolean
}

/** The select's entries: Multihog's seven, *Match ST UI* read as *Match Lumiverse*. */
export function themeOptions(): ThemeOption[] {
    return LEGACY_THEME_OPTIONS.map((option: { value: string; label: string }) => {
        const id = readThemeId(option.value)
        return {
            id,
            label: id === 'native' ? 'Match Lumiverse' : option.label,
            available: true,
        }
    })
}

/**
 * The text colour that reads on an accent: dark on a light accent, light
 * on a dark one. Takes `#rgb`/`#rrggbb`; anything else is read as light,
 * since every accent Multihog ships is.
 */
export function accentContrast(accent: string): string {
    const hex = accent.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1]
    if (!hex) return '#0a0a0a'
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number]
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return luminance > 0.45 ? '#0a0a0a' : '#f4f4f4'
}

/** The stylesheet: one block of tokens per styled theme, then the extras scoped under the panel's root. */
export function buildThemeCss(): string {
    const blocks: string[] = ['/* The visual themes (74a): Multihog\'s own values, as --lh-* tokens on the body\'s class. */']
    for (const theme of STYLED_THEMES) {
        const vars = (LEGACY_THEME_VARS as Record<string, Record<string, string>>)[theme] ?? {}
        const lines = Object.entries(vars).map(([name, value]) => `    ${name.replace(/^--rt-/, '--lh-')}: ${value};`)
        lines.push(`    --lh-accent-contrast: ${accentContrast(vars['--rt-accent'] ?? '')};`)
        blocks.push(`.${themeClass(theme)} {\n${lines.join('\n')}\n}`)
        const extras = (LEGACY_THEME_EXTRAS as Record<string, string>)[theme]
        // The legacy's own rules for the theme, each selector put under the
        // panel's root so a scrollbar rule never reaches the host's page.
        if (extras) blocks.push(extras.replace(/^\.rt-theme-([a-z]+) /gm, (_m, name: string) => `.${themeClass(readThemeId(name))} .adventuretime-panel `).trimEnd())
    }
    // The wizard's theme (74b): each token reads its `--lh-custom-` twin, which
    // `applyCustomTheme` writes inline on the body — Multihog's own shape, its
    // `:root { --rt-custom-* }` read by `.rt-theme-custom`. A twin not written
    // leaves the token invalid, so it falls to the host's colour; and a rule of
    // two classes (the day/night palette, 74c) outranks this one, where an
    // inline token could not be outranked.
    const custom = [...THEME_TOKENS, '--lh-accent-contrast'].map((token) => `    ${token}: var(${customTwin(token)});`)
    blocks.push(`.${themeClass('custom')} {\n${custom.join('\n')}\n}`)
    return `${blocks.join('\n')}\n`
}

/** `--lh-accent` → `--lh-custom-accent`: the inline twin the custom block reads. */
export function customTwin(token: string): string {
    return token.replace(/^--lh-/, '--lh-custom-')
}

/** The stylesheet, built once. */
export const THEME_CSS = buildThemeCss()

/**
 * Writes the wizard's theme (74b) as the tokens' `--lh-custom-` twins inline
 * on the body, which the `.lh-theme-custom` block reads into the tokens
 * (`buildThemeCss` says why the twins). Multihog injects its `--rt-custom-*`
 * on `:root` and its custom block reads them; here the legacy's keys are
 * AdventureTime's tokens by name, and the contrast colour is derived from the
 * accent as for the named themes. Cleared whenever the theme is not Custom,
 * so a named theme never reads a stale twin.
 */
export function applyCustomTheme(body: HTMLElement, theme: CustomTheme | null): void {
    for (const token of [...THEME_TOKENS, '--lh-accent-contrast']) body.style.removeProperty(customTwin(token))
    if (!theme) return
    for (const [key, value] of Object.entries(theme)) {
        const token = customKeyToToken(key)
        if (THEME_TOKENS.includes(token) && value) body.style.setProperty(customTwin(token), value)
    }
    body.style.setProperty(customTwin('--lh-accent-contrast'), accentContrast(theme['--rt-custom-accent'] ?? ''))
}

/** The wizard's box under the theme select (74b): Multihog's block, as a card of the panel's. */
export const THEME_WIZARD_CSS = `
.adventuretime-panel .lh-theme-wizard { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25))); border-radius: var(--lumiverse-radius, 6px); background: var(--lh-card-bg, rgba(127,127,127,0.04)); }
.adventuretime-panel .lh-theme-wizard[hidden] { display: none; }
.adventuretime-panel .lh-theme-wizard-title { font-weight: 600; }
.adventuretime-panel .lh-theme-wizard textarea { width: 100%; box-sizing: border-box; resize: vertical; min-height: 3.2em; }
.adventuretime-panel .lh-theme-wizard-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.adventuretime-panel .lh-theme-wizard-row .lh-button { flex: 1 1 auto; }
.adventuretime-panel .lh-theme-wizard-name { flex: 2 1 8em; min-width: 0; }
.adventuretime-panel .lh-theme-wizard-status { font-size: 0.85em; opacity: 0.85; min-height: 1.2em; font-style: italic; }
.adventuretime-panel .lh-theme-wizard-status--error { color: var(--lumiverse-danger, #d9534f); opacity: 1; font-style: normal; }
.adventuretime-panel .lh-theme-library { display: flex; flex-direction: column; gap: 4px; padding-top: 6px; border-top: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25))); }
.adventuretime-panel .lh-theme-library[hidden] { display: none; }
.adventuretime-panel .lh-theme-library-title { font-size: 0.85em; opacity: 0.75; }
.adventuretime-panel .lh-theme-library-row { display: flex; align-items: center; gap: 6px; }
.adventuretime-panel .lh-theme-library-name { flex: 1; text-align: left; }
`

/** Puts the theme's class on an element, taking any other theme's off — Multihog's `swapThemeOn`. */
export function applyTheme(target: Element, theme: ThemeId): void {
    for (const name of Array.from(target.classList)) if (name.startsWith('lh-theme-')) target.classList.remove(name)
    target.classList.add(themeClass(theme))
}
