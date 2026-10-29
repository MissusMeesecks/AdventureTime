/**
 * The AI Theme Wizard's call (Phase 74b, departure 81): one quiet
 * generation on the tracker's connection — the legacy's `sendStateRequest`,
 * its State model — with Multihog's prompt, read as the legacy reads it,
 * and the theme kept as the install's `customTheme` with the select put
 * on *Custom*, as `openThemeWizard` does. Iterate sends the stored theme
 * as JSON with the change asked for; with no theme stored it makes a new
 * one instead, as the legacy's button does.
 */
import { readGenerationText } from './tracker-pass.js'
import { buildThemeWizardPrompt, readThemeWizardReply, type CustomTheme } from '../tracker/theme-wizard.js'

export interface ThemeWizardDeps {
    generate: { quiet(input: Record<string, unknown>): Promise<unknown> }
    prefs: {
        load(userId: string | undefined): Promise<{ trackerConnectionId?: string; customTheme?: CustomTheme | null }>
        patch(patch: Record<string, unknown>, userId: string | undefined): Promise<unknown>
    }
    log: { info(message: string): void; warn(message: string): void }
}

export interface ThemeWizardResult {
    theme: CustomTheme
    /** True when the stored theme was sent with the change asked for. */
    iterated: boolean
    /** The keys the model left out, up to the three the legacy tolerates. */
    missing: string[]
}

export interface ThemeWizard {
    generate(userId: string | undefined, description: string, iterate: boolean): Promise<ThemeWizardResult>
}

export function createThemeWizard(deps: ThemeWizardDeps): ThemeWizard {
    return {
        async generate(userId, description, iterate) {
            const text = description.trim()
            if (!text) throw new Error(iterate ? 'Please describe the changes you want.' : 'Please describe a theme first.')
            const prefs = await deps.prefs.load(userId)
            const current = iterate ? prefs.customTheme ?? null : null
            const prompt = buildThemeWizardPrompt({ description: text, current })
            if (iterate && !prompt.iterated) deps.log.info('theme wizard: no custom theme to iterate on; generating a new one instead')
            deps.log.info(`theme wizard: ${prompt.iterated ? 'refining the theme' : 'generating a theme'} from "${text.slice(0, 60)}"`)
            const raw = await deps.generate.quiet({
                userId,
                ...(prefs.trackerConnectionId ? { connectionId: prefs.trackerConnectionId } : {}),
                messages: [
                    { role: 'system', content: prompt.system },
                    { role: 'user', content: prompt.user },
                ],
            })
            const reading = readThemeWizardReply(readGenerationText(raw))
            if (!reading.ok) {
                deps.log.warn(`theme wizard: ${reading.reason}`)
                throw new Error(reading.reason)
            }
            if (reading.missing.length > 0) deps.log.info(`theme wizard: the reply left out ${reading.missing.join(', ')}; the token falls to the host's`)
            // The theme is the install's, and the select goes to Custom, as the legacy's does.
            await deps.prefs.patch({ customTheme: reading.theme, trackerTheme: 'custom' }, userId)
            deps.log.info(`theme wizard: ${prompt.iterated ? 'refined' : 'generated'} a theme (${Object.keys(reading.theme).length} keys)`)
            return { theme: reading.theme, iterated: prompt.iterated, missing: reading.missing }
        },
    }
}
