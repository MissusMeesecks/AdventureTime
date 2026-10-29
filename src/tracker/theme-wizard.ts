/**
 * The AI Theme Wizard's grammar (Phase 74b, departure 81): Multihog's
 * prompt and its reading of the reply, from the nineteenth generated file.
 *
 * `openThemeWizard` in the legacy's `theme-manager.js` sends one call with
 * a fixed designer prompt (fifteen `--rt-custom-*` keys and their CSS
 * values) and a user message that is either the description or, when
 * iterating, the current theme as JSON and the change asked for; it reads
 * the first `{…}` of the reply as JSON and tolerates up to three missing
 * keys. The texts are sliced at the pin (`scripts/extract-themes.mjs`),
 * so the prompt is Multihog's. This module is data only — the backend
 * sends, the frontend paints — and imports the generated file for its
 * texts alone.
 */
import { LEGACY_THEME_WIZARD } from '../frontend/themes-legacy.js'

/** A custom theme as the wizard writes it: the legacy's `--rt-custom-*` keys to CSS values. */
export type CustomTheme = Record<string, string>

/** The fifteen keys the wizard asks for, in the legacy's order. */
export const THEME_WIZARD_KEYS: readonly string[] = LEGACY_THEME_WIZARD.expectedKeys

/** The legacy's system prompt, verbatim. */
export const THEME_WIZARD_SYSTEM_PROMPT: string = LEGACY_THEME_WIZARD.systemPrompt

/** The two messages of a wizard call: the fixed prompt, and the description or the change against the current theme. */
export function buildThemeWizardPrompt(input: { description: string; current?: CustomTheme | null }): { system: string; user: string; iterated: boolean } {
    const description = input.description.trim()
    const iterated = !!input.current && Object.keys(input.current).length > 0
    const user = iterated
        ? LEGACY_THEME_WIZARD.iterationFrame
            .replace('${JSON.stringify(settings.customTheme, null, 2)}', JSON.stringify(input.current, null, 2))
            .replace('${promptText}', description)
        : LEGACY_THEME_WIZARD.newFrame.replace('${promptText}', description)
    return { system: THEME_WIZARD_SYSTEM_PROMPT, user, iterated }
}

export type ThemeWizardReading =
    | { ok: true; theme: CustomTheme; missing: string[] }
    | { ok: false; reason: string }

/**
 * The legacy's reading of the reply: the first `{…}` as JSON, up to three of
 * the fifteen keys missing. Only the expected keys with string values are
 * kept (the legacy keeps whatever the object held and writes it to `:root`
 * with `!important`; here a token is a token).
 */
export function readThemeWizardReply(raw: string): ThemeWizardReading {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return { ok: false, reason: 'AI did not return valid JSON. Try a different prompt or model.' }
    let parsed: unknown
    try {
        parsed = JSON.parse(match[0])
    } catch {
        return { ok: false, reason: 'Failed to parse AI response as JSON.' }
    }
    const vars = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    const missing = THEME_WIZARD_KEYS.filter((key) => !vars[key])
    if (missing.length > LEGACY_THEME_WIZARD.missingTolerated) {
        return { ok: false, reason: `AI response is missing too many theme keys: ${missing.join(', ')}` }
    }
    const theme: CustomTheme = {}
    for (const key of THEME_WIZARD_KEYS) {
        const value = vars[key]
        if (typeof value === 'string' && value.trim()) theme[key] = value.trim()
    }
    return { ok: true, theme, missing }
}

/** A stored custom theme, or null: only the wizard's keys, only non-empty strings. */
export function readCustomTheme(value: unknown): CustomTheme | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const theme: CustomTheme = {}
    for (const key of THEME_WIZARD_KEYS) {
        const entry = (value as Record<string, unknown>)[key]
        if (typeof entry === 'string' && entry.trim()) theme[key] = entry.trim()
    }
    return Object.keys(theme).length > 0 ? theme : null
}

/** The saved library: a name to a theme, anything unreadable dropped. */
export function readSavedThemes(value: unknown): Record<string, CustomTheme> {
    const out: Record<string, CustomTheme> = {}
    if (!value || typeof value !== 'object' || Array.isArray(value)) return out
    for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
        const theme = readCustomTheme(entry)
        if (name.trim() && theme) out[name.trim()] = theme
    }
    return out
}

/** The legacy's key to AdventureTime's token: `--rt-custom-accent` is `--lh-accent`. */
export function customKeyToToken(key: string): string {
    return key.replace(/^--rt-custom-/, '--lh-')
}
