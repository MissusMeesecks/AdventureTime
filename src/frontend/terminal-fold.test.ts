// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TerminalResult, TerminalSource, TerminalStep } from '../protocol.js'
import { createTerminalFold, stepClock, TERMINAL_FOLD_CSS, TERMINAL_TABS } from './terminal-fold.js'

const el = (tag: string, attrs?: Record<string, string>) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n }

const step = (source: TerminalSource, type: TerminalStep['type'], content: string, seconds?: number): TerminalStep => ({ source, type, content, at: '2026-10-19T12:00:00.000Z', ...(seconds !== undefined ? { seconds } : {}) })

function empty(): TerminalResult['steps'] {
    return { state_tracker: [], lorebook_agent: [], map_updater: [], map_evolution: [], map_architect: [] }
}

function harness(kept: TerminalResult['steps'] = empty()) {
    const patches: Array<Record<string, unknown>> = []
    const runs: Array<[TerminalSource, string, number]> = []
    const cleared: Array<[string, TerminalSource]> = []
    const failures: unknown[] = []
    let runError: Error | null = null
    const fold = createTerminalFold({
        el,
        load: async () => ({ steps: kept }),
        clear: async (chatId, source) => { cleared.push([chatId, source]); kept[source] = []; return { steps: kept } },
        run: async (source, text, lookback) => { runs.push([source, text, lookback]); if (runError) throw runError },
        savePrefs: async (patch) => { patches.push(patch) },
        fail: (error) => { failures.push(error) },
        clock: () => '12:00:00',
        now: () => new Date('2026-10-19T12:00:05.000Z'),
    })
    document.body.append(fold.root)
    return { fold, patches, runs, cleared, failures, setRunError: (e: Error | null) => { runError = e } }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const field = (name: string) => document.querySelector(`[data-lh-field="${name}"]`) as HTMLInputElement
const tab = (id: string) => document.querySelector(`[data-lh-terminal-tab="${id}"]`) as HTMLButtonElement
const pane = (id: string) => document.querySelector(`[data-lh-terminal-pane="${id}"]`) as HTMLElement

beforeEach(() => { document.body.replaceChildren() })

describe('the terminal fold (71b)', () => {
    it('draws the five tabs in the legacy’s order, the agent’s first shown, and keeps the tab picked', async () => {
        const { fold, patches } = harness()
        expect(Array.from(document.querySelectorAll('.lh-terminal-tab')).map((b) => b.textContent)).toEqual(['State Tracker', 'Lorebook Agent', 'Map Updater', 'Map Evolution', 'Map Architect'])
        expect(fold.active()).toBe('lorebook_agent')
        expect(pane('lorebook_agent').hidden).toBe(false)
        expect(pane('state_tracker').hidden).toBe(true)
        // The sheet gives a pane `display: flex`, which beats the browser's own `[hidden]` rule at equal
        // specificity (71b-bis, lesson 60): the sheet has to hide a hidden pane itself, or every pane shows.
        expect(TERMINAL_FOLD_CSS).toMatch(/\.lh-terminal-pane\[hidden\]\s*\{[^}]*display:\s*none/)
        tab('map_architect').click()
        expect(fold.active()).toBe('map_architect')
        expect(pane('map_architect').hidden).toBe(false)
        expect(tab('map_architect').getAttribute('aria-selected')).toBe('true')
        expect(patches).toEqual([{ agentTerminalTab: 'map_architect' }])
        // A preference from elsewhere moves the tab without a save of its own.
        fold.applyPrefs({ agentTerminalTab: 'state_tracker' })
        expect(fold.active()).toBe('state_tracker')
        expect(patches).toHaveLength(1)
        fold.applyPrefs({ agentTerminalTab: 'nowhere' })
        expect(fold.active()).toBe('state_tracker')
    })

    it('loads the kept steps on a chat, draws each with its time, icon, title and the time worked, and follows the live steps', async () => {
        const kept = empty()
        kept.lorebook_agent = [step('lorebook_agent', 'start', 'Initializing…'), step('lorebook_agent', 'tool', 'grep_lore(Lissa)'), step('lorebook_agent', 'finish', 'Done.', 12.3)]
        const { fold } = harness(kept)
        expect(fold.lines('lorebook_agent')).toEqual([])
        expect(pane('lorebook_agent').querySelector('.lh-terminal-empty')!.textContent).toBe('No chat open.')
        fold.setChat('c1')
        await settle()
        expect(fold.lines('lorebook_agent')).toEqual(['12:00:00▶StartingInitializing…', '12:00:00🔧Toolgrep_lore(Lissa)', '12:00:00✅FinishedWorked for 12.3sDone.'])
        expect(pane('lorebook_agent').querySelector('.lh-terminal-step--finish .lh-terminal-worked')!.textContent).toBe('Worked for 12.3s')
        expect(pane('state_tracker').querySelector('.lh-terminal-empty')!.textContent).toContain('No pass of this agent has run')
        // A live step lands on its own feed; a start empties the feed first; another chat's is dropped.
        fold.push('c1', step('map_updater', 'start', 'Initializing Map Updater…'))
        fold.push('c1', step('map_updater', 'thought', 'Requesting occupancy update…'))
        expect(fold.lines('map_updater')).toHaveLength(2)
        fold.push('c2', step('map_updater', 'error', 'elsewhere'))
        expect(fold.lines('map_updater')).toHaveLength(2)
        fold.push('c1', step('lorebook_agent', 'start', 'Again'))
        expect(fold.lines('lorebook_agent')).toEqual(['12:00:00▶StartingAgain'])
        // A chat change empties everything until the load answers.
        fold.setChat(null)
        expect(fold.lines('lorebook_agent')).toEqual([])
    })

    it('runs the tab’s pass with the bar’s text and lookback, clears the draft first, keeps both, and says when the request failed', async () => {
        const { fold, runs, patches, failures, setRunError } = harness()
        fold.setChat('c1')
        await settle()
        tab('map_architect').click()
        const input = field('terminal-input-map_architect') as unknown as HTMLTextAreaElement
        input.value = 'Create a DUNGEON map for "The Hollow"'
        field('terminal-lookback-map_architect').value = '250'
        field('terminal-lookback-map_architect').dispatchEvent(new Event('change'))
        expect(field('terminal-lookback-map_architect').value).toBe('100')
        expect(patches.at(-1)).toEqual({ mapArchitectDirectLookback: 100 })
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
        expect(input.value).toBe('')
        expect(field('terminal-run-map_architect').disabled).toBe(true)
        expect(field('terminal-note-map_architect').textContent).toBe('Running…')
        await settle()
        expect(runs).toEqual([['map_architect', 'Create a DUNGEON map for "The Hollow"', 100]])
        expect(field('terminal-run-map_architect').disabled).toBe(false)
        expect(patches.at(-1)).toEqual({ terminalDrafts: { state_tracker: '', lorebook_agent: '', map_updater: '', map_evolution: '', map_architect: '' }, mapArchitectDirectLookback: 100 })
        // Shift+Enter is a new line, not a send; an empty bar sends nothing.
        input.value = 'x'
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }))
        expect(runs).toHaveLength(1)
        input.value = '  '
        field('terminal-run-map_architect').click()
        expect(runs).toHaveLength(1)
        // A request that fails says so on the feed, in red, and tells the panel.
        setRunError(new Error('Name a site with “Create …”'))
        input.value = 'more rooms'
        field('terminal-run-map_architect').click()
        await settle()
        expect(fold.lines('map_architect').at(-1)).toContain('Name a site with')
        expect(pane('map_architect').querySelector('.lh-terminal-step--error')).not.toBeNull()
        expect(failures).toHaveLength(1)
    })

    it('keeps a draft a moment after the last keystroke, and takes the kept drafts and lookbacks from the preferences', async () => {
        vi.useFakeTimers()
        try {
            const { fold, patches } = harness()
            fold.setChat('c1')
            const input = field('terminal-input-state_tracker') as unknown as HTMLTextAreaElement
            input.value = 'Set the clock'
            input.dispatchEvent(new Event('input'))
            input.value = 'Set the clock to noon'
            input.dispatchEvent(new Event('input'))
            vi.advanceTimersByTime(399)
            expect(patches).toEqual([])
            vi.advanceTimersByTime(2)
            expect(patches).toEqual([{ terminalDrafts: { state_tracker: 'Set the clock to noon', lorebook_agent: '', map_updater: '', map_evolution: '', map_architect: '' } }])
            fold.applyPrefs({ terminalDrafts: { lorebook_agent: 'kept', state_tracker: 'Set the clock to noon' }, trackerDirectLookback: 7, mapEvolutionDirectLookback: 300, agentDirectLookback: 'x' })
            expect((field('terminal-input-lorebook_agent') as unknown as HTMLTextAreaElement).value).toBe('kept')
            expect(input.value).toBe('Set the clock to noon')
            expect(field('terminal-lookback-state_tracker').value).toBe('7')
            expect(field('terminal-lookback-map_evolution').value).toBe('100')
            expect(field('terminal-lookback-lorebook_agent').value).toBe('10')
        } finally {
            vi.useRealTimers()
        }
    })

    it('clears the shown tab’s feed through the backend', async () => {
        const kept = empty()
        kept.lorebook_agent = [step('lorebook_agent', 'finish', 'Done.')]
        const { fold, cleared } = harness(kept)
        fold.setChat('c1')
        await settle()
        expect(fold.lines('lorebook_agent')).toHaveLength(1)
        field('terminal-clear').click()
        await settle()
        expect(cleared).toEqual([['c1', 'lorebook_agent']])
        expect(fold.lines('lorebook_agent')).toEqual([])
    })

    it('names the lookback preference of each tab, the tracker’s and the agent’s being the bars’ own', () => {
        expect(TERMINAL_TABS.map((t) => [t.id, t.lookbackKey, t.lookbackMax])).toEqual([
            ['state_tracker', 'trackerDirectLookback', 50],
            ['lorebook_agent', 'agentDirectLookback', 100],
            ['map_updater', 'mapUpdaterDirectLookback', 100],
            ['map_evolution', 'mapEvolutionDirectLookback', 100],
            ['map_architect', 'mapArchitectDirectLookback', 100],
        ])
        expect(stepClock('not a date')).toBe('')
        expect(stepClock('2026-10-19T12:34:56.000Z')).toMatch(/^\d{2}:\d{2}:56$/)
    })
})

describe('the log history slot (78a)', () => {
    it('gives each tab a place under its bar, where the panel puts the agent\'s own report', () => {
        const { fold } = harness()
        const slot = fold.history('lorebook_agent')
        expect(slot.getAttribute('data-lh-field')).toBe('terminal-history-lorebook_agent')
        expect(slot.closest('[data-lh-terminal-pane="lorebook_agent"]')).not.toBeNull()
        expect(slot.previousElementSibling!.classList.contains('lh-terminal-note')).toBe(true)
        expect(fold.history('map_architect').closest('[data-lh-terminal-pane="map_architect"]')).not.toBeNull()
    })
})
