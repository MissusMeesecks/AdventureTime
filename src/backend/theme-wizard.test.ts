import { describe, expect, it } from 'vitest'

import { THEME_WIZARD_KEYS } from '../tracker/theme-wizard.js'
import { createThemeWizard } from './theme-wizard.js'

const full = Object.fromEntries(THEME_WIZARD_KEYS.map((k) => [k, k === '--rt-custom-accent' ? '#ff00aa' : 'rgba(1,2,3,0.5)']))

function harness(options: { reply?: string; stored?: Record<string, string> | null; connection?: string } = {}) {
    const calls: Array<Record<string, unknown>> = []
    const patches: Array<[Record<string, unknown>, string | undefined]> = []
    const log: string[] = []
    const wizard = createThemeWizard({
        generate: { quiet: async (input) => { calls.push(input); return { content: options.reply ?? JSON.stringify(full) } } },
        prefs: {
            load: async () => ({ trackerConnectionId: options.connection ?? '', customTheme: options.stored ?? null }),
            patch: async (patch, userId) => { patches.push([patch, userId]) },
        },
        log: { info: (m) => log.push(m), warn: (m) => log.push(`warn: ${m}`) },
    })
    return { wizard, calls, patches, log }
}

describe('the AI Theme Wizard’s call (74b)', () => {
    it('sends Multihog’s prompt on the tracker’s connection, keeps the theme and puts the select on Custom', async () => {
        const h = harness({ connection: 'conn-tracker' })
        const result = await h.wizard.generate('u1', ' neon noir ', false)
        expect(result).toEqual({ theme: full, iterated: false, missing: [] })
        expect(h.calls).toHaveLength(1)
        expect(h.calls[0]).toMatchObject({ userId: 'u1', connectionId: 'conn-tracker' })
        const messages = h.calls[0]!.messages as Array<{ role: string; content: string }>
        expect(messages[0]!.role).toBe('system')
        expect(messages[0]!.content).toMatch(/^You are a CSS theme designer/)
        expect(messages[1]).toEqual({ role: 'user', content: '\n\nUser description: neon noir' })
        expect(h.patches).toEqual([[{ customTheme: full, trackerTheme: 'custom' }, 'u1']])
        expect(h.log).toContain('theme wizard: generating a theme from "neon noir"')
        // No connection chosen: the host's default, no field sent.
        const bare = harness()
        await bare.wizard.generate('u1', 'x', false)
        expect('connectionId' in bare.calls[0]!).toBe(false)
    })

    it('iterates on the stored theme, and makes a new one when none is stored', async () => {
        const stored = { '--rt-custom-accent': '#00ffaa' }
        const h = harness({ stored })
        const result = await h.wizard.generate('u1', 'warmer', true)
        expect(result.iterated).toBe(true)
        const user = (h.calls[0]!.messages as Array<{ content: string }>)[1]!.content
        expect(user).toContain('CURRENT THEME STATE (JSON):')
        expect(user).toContain('"--rt-custom-accent": "#00ffaa"')
        expect(user).toContain('User wants to CHANGE this theme as follows: warmer')
        const none = harness()
        expect((await none.wizard.generate('u1', 'warmer', true)).iterated).toBe(false)
        expect(none.log).toContain('theme wizard: no custom theme to iterate on; generating a new one instead')
    })

    it('refuses an empty description in the legacy’s words, and a reply it cannot read, writing nothing', async () => {
        const h = harness({ reply: 'No.' })
        await expect(h.wizard.generate('u1', '  ', false)).rejects.toThrow('Please describe a theme first.')
        await expect(h.wizard.generate('u1', '  ', true)).rejects.toThrow('Please describe the changes you want.')
        await expect(h.wizard.generate('u1', 'noir', false)).rejects.toThrow('AI did not return valid JSON')
        expect(h.patches).toEqual([])
        expect(h.log.some((l) => l.startsWith('warn: theme wizard: AI did not return valid JSON'))).toBe(true)
        // Three keys missing is kept and named; the stored theme holds twelve.
        const twelve = { ...full }
        delete twelve['--rt-custom-blur']; delete twelve['--rt-custom-font']; delete twelve['--rt-custom-shadow']
        const partial = harness({ reply: JSON.stringify(twelve) })
        const result = await partial.wizard.generate('u1', 'noir', false)
        expect(result.missing).toEqual(['--rt-custom-blur', '--rt-custom-font', '--rt-custom-shadow'])
        expect(Object.keys(partial.patches[0]![0].customTheme as object)).toHaveLength(12)
    })
})
