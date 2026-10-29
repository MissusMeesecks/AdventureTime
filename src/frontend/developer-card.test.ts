// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest'

import { createDeveloperCard, describeKeys } from './developer-card.js'

const el = (tag: string, attrs?: Record<string, string>) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n }
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function mount(options: { confirmed?: boolean; answers?: Record<string, unknown>; failOp?: string } = {}) {
    const asked: Array<[string, string]> = []
    const requests: string[] = []
    const prefs: Array<Record<string, unknown>> = []
    const seeded: unknown[] = []
    const failures: unknown[] = []
    const card = createDeveloperCard({
        el,
        confirm: async (title, _message, label) => { asked.push([title, label]); return options.confirmed !== false },
        request: async <T,>(op: string) => {
            requests.push(op)
            if (op === options.failOp) throw new Error(`${op} refused`)
            return (options.answers?.[op] ?? {}) as T
        },
        savePrefs: async (patch) => { prefs.push(patch) },
        onSettings: (settings) => { seeded.push(settings) },
        fail: (error) => { failures.push(error) },
    })
    const field = (name: string) => card.root.querySelector(`[data-lh-field="${name}"]`) as HTMLElement
    const button = (name: string) => field(name).querySelector('button') as HTMLButtonElement
    const note = (name: string) => field(name).querySelector('.lh-developer-note')!.textContent
    return { card, asked, requests, prefs, seeded, failures, field, button, note }
}

describe('Debug & factory reset (72a)', () => {
    it('draws Multihog’s drawer: two switches and the five buttons in its order, the update button hidden until needed', () => {
        const { card, field } = mount()
        expect(card.root.querySelector('.lh-card-title')!.textContent).toBe('Debug & factory reset')
        expect(Array.from(card.root.querySelectorAll('.lh-developer-row')).map((r) => r.getAttribute('data-lh-field'))).toEqual(['debug-logging', 'auto-update-prompts', 'upgrade-stock', 'reset-prompts', 'purge-portraits', 'factory-reset'])
        expect(field('upgrade-stock').hidden).toBe(true)
        expect(field('factory-reset').querySelector('button')!.classList.contains('lh-button--danger')).toBe(true)
        expect(Array.from(card.root.querySelectorAll('.lh-developer-row')).every((r) => r.classList.contains('lh-search-item'))).toBe(true)
    })

    it('writes the two switches as preferences and follows them', () => {
        const { card, field, prefs } = mount()
        const debug = field('debug-logging').querySelector('input') as HTMLInputElement
        debug.checked = true
        debug.dispatchEvent(new Event('change'))
        const auto = field('auto-update-prompts').querySelector('input') as HTMLInputElement
        auto.checked = false
        auto.dispatchEvent(new Event('change'))
        expect(prefs).toEqual([{ debugLogging: true }, { autoUpdatePrompts: false }])
        card.applyPrefs({ debugLogging: false, autoUpdatePrompts: true })
        expect(debug.checked).toBe(false)
        expect(auto.checked).toBe(true)
    })

    it('asks before each reset, runs the op, re-seeds the editors and says what it did', async () => {
        const { asked, requests, seeded, button, note } = mount({ answers: {
            'maintenance.resetPrompts': { settings: { a: 1 } },
            'maintenance.purgePortraits': { chats: 2, portraits: 5 },
            'maintenance.orphans': { chatIds: ['x', 'y'], prefsEntries: 1 },
            'maintenance.cleanOrphans': { removed: ['x', 'y'], files: 6, prefsEntries: 1, prefs: {} },
            'maintenance.factoryReset': { settings: { a: 2 }, prefs: {} },
        } })
        button('reset-prompts').click()
        await settle()
        button('purge-portraits').click()
        await settle()
        button('factory-reset').click()
        await settle()
        expect(asked.map(([t]) => t)).toEqual(['Reset every prompt to stock', 'Purge all portraits', 'Factory reset'])
        expect(requests).toEqual(['maintenance.resetPrompts', 'maintenance.purgePortraits', 'maintenance.factoryReset'])
        expect(seeded).toEqual([{ a: 1 }, { a: 2 }])
        expect(note('reset-prompts')).toContain('stock text again')
        expect(note('purge-portraits')).toBe('Cleared 5 portrait references across 2 chats.')
        expect(note('factory-reset')).toContain('Reset to the factory')
    })

    it('does nothing when the confirm is declined', async () => {
        const { asked, requests, button, note } = mount({ confirmed: false })
        button('factory-reset').click()
        await settle()
        expect(requests).toEqual([])
        expect(note('factory-reset')).toBe('Not reset.')
        expect(asked.map(([t]) => t)).toEqual(['Factory reset'])
    })

    it('names a refusal in the row’s note and reports it', async () => {
        const { button, note, failures } = mount({ failOp: 'maintenance.purgePortraits' })
        button('purge-portraits').click()
        await settle()
        expect(note('purge-portraits')).toBe('maintenance.purgePortraits refused')
        expect(failures).toHaveLength(1)
    })

    it('shows the update button with the status’s pending texts, and updates on demand', async () => {
        const { card, field, button, note, requests, seeded } = mount({ answers: { 'settings.upgradeStock': { settings: { a: 3 }, refreshed: ['systemPromptTemplate', 'stockPrompts.party'], kept: ['routerModules.npc.instruction'] } } })
        card.applyStatus({ version: '1', granted: [], missing: [], checked: true, stockUpgrade: { refreshed: [], kept: [], pending: ['systemPromptTemplate', 'stockPrompts.party'], at: 't' } })
        expect(field('upgrade-stock').hidden).toBe(false)
        expect(note('upgrade-stock')).toBe('An update changed 2 stock texts the refresh did not put in: systemPromptTemplate, stockPrompts.party.')
        button('upgrade-stock').click()
        await settle()
        expect(requests).toEqual(['settings.upgradeStock'])
        expect(seeded).toEqual([{ a: 3 }])
        expect(note('upgrade-stock')).toBe('Refreshed 2: systemPromptTemplate, stockPrompts.party. Kept 1 edited: routerModules.npc.instruction.')
        // A status that refreshed on its own says so too.
        card.applyStatus({ version: '1', granted: [], missing: [], checked: true, stockUpgrade: { refreshed: ['a'], kept: [], pending: [], at: 't' } })
        expect(note('upgrade-stock')).toBe('Refreshed 1 after the last update: a.')
        expect(describeKeys(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])).toBe('a, b, c, d, e, f and 2 more')
    })
})
