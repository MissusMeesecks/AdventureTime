// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'

import type { MapSandboxOutcome, MapSandboxResult } from '../protocol.js'
import { createSandboxFold, memoryStatus, outcomeWords, SANDBOX_FOLD_CSS, SANDBOX_LEAD, type SandboxFoldHost } from './sandbox-fold.js'

const el = (tag: string, attrs?: Record<string, string>) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n }
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0)) }

const THREAD = { id: 't1', at: 'Day 5, 10:00 AM', status: 'open' as const, op: 'MOVE_ASSET', subjectId: 'pack', actor: 'pack', cause: 'Drawn by the lantern light.', summary: 'pack moved to landing by pack: Drawn by the lantern light.', compressed: false }
const DIGEST = { id: 'd1', at: 'Day 1–4', status: 'transformed' as const, op: 'DIGEST', subjectId: '', actor: '', cause: 'The pack prowled.', summary: 'The pack prowled the crypt for days.', compressed: true }
const VIEW: MapSandboxResult = {
    timeLabel: '09:00 AM, Day 5', minutes: 6300,
    sites: [{ siteRoot: 'Abbey Undercroft', current: true }, { siteRoot: 'Morrowfen', current: false }],
    siteRoot: 'Abbey Undercroft', kind: 'DUNGEON',
    areas: [{ id: 'landing', name: 'Cellar Landing' }, { id: 'crypt', name: 'Crypt Passage' }],
    assets: [{ id: 'pack', name: 'Crawling Dead Pack', kind: 'GROUP', state: 'ACTIVE', location: 'landing', count: 6, actor: 'pack', cause: 'Drawn by the lantern light.', changedAt: 'Day 5, 10:00 AM' }, { id: 'ghoul', name: 'Crypt Ghoul', kind: 'CREATURE', state: 'DESTROYED', location: 'crypt' }],
    kinds: ['CREATURE', 'GROUP', 'OBJECT'], states: ['DESTROYED', 'DEAD', 'ACTIVE'],
    lastEvolved: 'Day 5, 10:00 AM', elapsed: '2 hours (120 in-world minutes total)',
    memory: { storedThreads: [THREAD, DIGEST], storedBacklog: [{ kind: 'commit', at: 'Day 5, 10:00 AM', summary: 'Abbey Undercroft: pack moved to landing' }], threadText: '- Day 5 — OPEN pack', backlogText: '- Day 5 — pack moved', closedTokens: 12, openTokens: 8, backlogTokens: 6, totalTokens: 26, threshold: 10000, compressEnabled: true, overThreshold: false, openCount: 1, digestCount: 1, entryCount: 2, backlogCount: 1 },
    threads: { entries: [DIGEST, THREAD], open: [THREAD], truncated: true },
    arcSubjects: [{ id: 'pack', name: 'Crawling Dead Pack', kind: 'GROUP', state: 'ACTIVE', location: 'landing', onMap: true, eventCount: 1, open: true }, { id: 'ghoul', name: 'Crypt Ghoul', kind: 'CREATURE', state: 'DESTROYED', location: 'crypt', onMap: true, eventCount: 0, open: false }],
    lastPass: null, intervalHours: 8,
}

function mount(over: Partial<SandboxFoldHost> = {}, view: MapSandboxResult = VIEW) {
    const calls: unknown[][] = []
    let current = view
    let outcome: MapSandboxOutcome = { ok: true, timeLabel: 'Day 6, 09:00 AM', applied: 2 }
    let confirmAnswer = true
    const fold = createSandboxFold({
        el,
        get: async (siteRoot, arcSubject) => { calls.push(['get', siteRoot, arcSubject]); return current },
        time: async (request) => { calls.push(['time', request]); return outcome },
        add: async (request) => { calls.push(['add', request]); return outcome },
        set: async (request) => { calls.push(['set', request]); return outcome },
        evolve: async (siteRoot) => { calls.push(['evolve', siteRoot]); return outcome },
        simulate: async (request) => { calls.push(['simulate', request]); return outcome },
        undo: async () => { calls.push(['undo']); return outcome },
        redo: async () => { calls.push(['redo']); return outcome },
        clear: async (siteRoot) => { calls.push(['clear', siteRoot]); return outcome },
        confirm: async (message) => { calls.push(['confirm', message]); return confirmAnswer },
        fail: (error) => { calls.push(['fail', error]) },
        onChanged: () => { calls.push(['changed']) },
        ...over,
    })
    document.body.append(fold.root)
    const q = <T extends HTMLElement>(field: string) => fold.root.querySelector(`[data-lh-field="${field}"]`) as T
    const text = (field: string) => q<HTMLElement>(field).textContent ?? ''
    return { fold, calls, q, text, setView: (v: MapSandboxResult) => { current = v }, setOutcome: (o: MapSandboxOutcome) => { outcome = o }, setConfirm: (v: boolean) => { confirmAnswer = v } }
}

afterEach(() => { document.body.replaceChildren() })

describe('the Testing ground fold (71d)', () => {
    it('reads the site when opened and draws the legacy’s popup: the clock, the memory bar, the forms, the threads, the assets and the ledger', async () => {
        const { fold, calls, q, text } = mount()
        expect(fold.root.querySelector('summary')!.textContent).toBe('🧪 Testing ground')
        expect(fold.root.querySelector('.lh-world-lead')!.textContent).toBe(SANDBOX_LEAD)
        expect(q<HTMLButtonElement>('sandbox-evolve').disabled).toBe(true)
        fold.setChat('c1')
        expect(calls).toEqual([])
        fold.root.open = true
        fold.root.dispatchEvent(new Event('toggle'))
        await settle()
        expect(calls[0]).toEqual(['get', '', ''])
        expect(Array.from(q<HTMLSelectElement>('sandbox-site').options).map((o) => o.textContent)).toEqual(['Abbey Undercroft (current)', 'Morrowfen'])
        expect(q<HTMLSelectElement>('sandbox-site').value).toBe('Abbey Undercroft')
        expect(text('sandbox-time')).toBe('In-world time09:00 AM, Day 5')
        expect(text('sandbox-last')).toBe('Last evolvedDay 5, 10:00 AM')
        expect(text('sandbox-elapsed')).toBe('Elapsed2 hours (120 in-world minutes total)')
        expect(text('sandbox-closed-tokens')).toBe('Closed-thread tokens12 / 10000')
        expect(text('sandbox-memory')).toContain('Stored memory total26 tok · 2 events · 1 digest')
        expect(text('sandbox-memory-status')).toBe('Under threshold — closed history is kept verbatim')
        expect(q<HTMLInputElement>('sandbox-set-time').value).toBe('09:00 AM, Day 5')
        expect(q<HTMLInputElement>('sandbox-hours').value).toBe('8')
        expect(Array.from(q<HTMLSelectElement>('sandbox-add-kind').options).map((o) => o.value)).toEqual(['CREATURE', 'GROUP', 'OBJECT'])
        expect(q<HTMLSelectElement>('sandbox-add-kind').value).toBe('CREATURE')
        expect(Array.from(q<HTMLSelectElement>('sandbox-add-location').options).map((o) => o.textContent)).toEqual(['Cellar Landing (landing)', 'Crypt Passage (crypt)'])
        expect(Array.from(q<HTMLSelectElement>('sandbox-set-asset').options).map((o) => o.textContent)).toEqual(['Crawling Dead Pack [ACTIVE]', 'Crypt Ghoul [DESTROYED]'])
        expect(Array.from(q<HTMLSelectElement>('sandbox-set-state').options).map((o) => o.value)).toEqual(['DESTROYED', 'DEAD', 'ACTIVE'])
        // The threads: the open ones first, then the attributed events newest first, the cap's note after.
        const threads = text('sandbox-threads')
        expect(threads).toContain('Open threads')
        expect(threads).toContain('OPEN pack by pack: Drawn by the lantern light. Day 5, 10:00 AM')
        expect(threads.indexOf('OPEN pack moved to landing')).toBeLessThan(threads.indexOf('DIGEST The pack prowled'))
        expect(threads).toContain('Older events were dropped at the stored-history cap.')
        // The assets, each a row to click; the arc section with its chooser.
        expect(Array.from(q<HTMLElement>('sandbox-assets').querySelectorAll('li')).map((li) => li.textContent)).toEqual(['pack Crawling Dead Pack ×6 [GROUP / ACTIVE / landing] by pack — Drawn by the lantern light. Day 5, 10:00 AM', 'ghoul Crypt Ghoul [CREATURE / DESTROYED / crypt]'])
        expect(Array.from(q<HTMLSelectElement>('sandbox-arc-subject').options).map((o) => o.textContent)).toEqual(['Select an asset to follow', 'Crawling Dead Pack (pack) — GROUP · ACTIVE · OPEN · 1 event', 'Crypt Ghoul (ghoul) — CREATURE · DESTROYED'])
        expect(text('sandbox-arc-now')).toContain('Pick an asset from the list or the dropdown.')
        expect(text('sandbox-threads-json')).toContain('"subjectId": "pack"')
        expect(text('sandbox-threads-text')).toBe('- Day 5 — OPEN pack')
        expect(q<HTMLButtonElement>('sandbox-evolve').disabled).toBe(false)
        expect(q<HTMLButtonElement>('sandbox-undo').disabled).toBe(true)
        expect(q<HTMLButtonElement>('sandbox-redo').disabled).toBe(true)
        expect(SANDBOX_FOLD_CSS).toContain('.adventuretime-panel .lh-sandbox-asset.is-selected')
    })

    it('follows an asset on a click or from the chooser, asking the backend for that arc', async () => {
        const { fold, calls, q, text, setView } = mount()
        fold.setChat('c1')
        await fold.load()
        setView({ ...VIEW, arc: { subjectId: 'pack', name: 'Crawling Dead Pack', asset: { id: 'pack', name: 'Crawling Dead Pack', kind: 'GROUP', state: 'ACTIVE', location: 'landing', count: 6 }, onMap: true, open: true, events: [{ ...THREAD, role: 'subject' }, { ...DIGEST, role: 'digest' }], backlogHits: [{ at: 'Day 5, 10:00 AM', summary: 'pack moved to landing' }] } })
        q<HTMLElement>('sandbox-assets').querySelector('li')!.dispatchEvent(new Event('click'))
        await settle()
        expect(calls.at(-1)).toEqual(['get', 'Abbey Undercroft', 'pack'])
        expect(q<HTMLSelectElement>('sandbox-arc-subject').value).toBe('pack')
        expect(text('sandbox-arc-now')).toBe('pack Crawling Dead Pack ×6 [GROUP / ACTIVE / landing] · OPEN')
        const arc = q<HTMLElement>('sandbox-arc')
        expect(Array.from(arc.querySelectorAll('ol li')).map((li) => li.textContent)).toEqual(['Day 5, 10:00 AM OPEN subject pack moved to landing by pack: Drawn by the lantern light.', 'Day 1–4 DIGEST mentioned The pack prowled the crypt for days.'])
        expect(arc.textContent).toContain('Matching Evolution backlog')
        expect(arc.textContent).toContain('BACKLOG pack moved to landing')
        expect(q<HTMLElement>('sandbox-assets').querySelector('li')!.classList.contains('is-selected')).toBe(true)
        // The chooser blank again clears the arc; a site change clears it too.
        q<HTMLSelectElement>('sandbox-arc-subject').value = ''
        q<HTMLSelectElement>('sandbox-arc-subject').dispatchEvent(new Event('change'))
        await settle()
        expect(calls.at(-1)).toEqual(['get', 'Abbey Undercroft', ''])
        q<HTMLSelectElement>('sandbox-site').value = 'Morrowfen'
        q<HTMLSelectElement>('sandbox-site').dispatchEvent(new Event('change'))
        await settle()
        expect(calls.at(-1)).toEqual(['get', 'Morrowfen', ''])
    })

    it('runs each action on the chat and says what it did in the legacy’s words, reading the site again after', async () => {
        const { fold, calls, q, text, setOutcome, setView } = mount()
        fold.setChat('c1')
        await fold.load()
        calls.length = 0
        q<HTMLInputElement>('sandbox-set-time').value = 'Day 6, 09:00 AM'
        q<HTMLButtonElement>('sandbox-set-time-go').click()
        await settle()
        expect(calls).toEqual([['time', { label: 'Day 6, 09:00 AM' }], ['changed'], ['get', 'Abbey Undercroft', '']])
        expect(text('sandbox-status')).toBe('Time set to Day 6, 09:00 AM.')
        calls.length = 0
        q<HTMLInputElement>('sandbox-hours').value = '6'
        q<HTMLButtonElement>('sandbox-advance').click()
        await settle()
        expect(calls[0]).toEqual(['time', { minutes: 360 }])
        expect(text('sandbox-status')).toBe('Advanced to Day 6, 09:00 AM.')
        q<HTMLButtonElement>('sandbox-day').click()
        await settle()
        expect(calls.at(-3)).toEqual(['time', { minutes: 1440 }])
        calls.length = 0
        q<HTMLButtonElement>('sandbox-evolve').click()
        await settle()
        expect(calls[0]).toEqual(['evolve', 'Abbey Undercroft'])
        expect(text('sandbox-status')).toBe('Evolution applied 2 material update(s). Undo to rewind that pass.')
        setOutcome({ ok: true, ticks: 3, hoursPerTick: 6 })
        q<HTMLInputElement>('sandbox-ticks').value = '3'
        q<HTMLButtonElement>('sandbox-simulate').click()
        await settle()
        expect(calls.at(-3)).toEqual(['simulate', { siteRoot: 'Abbey Undercroft', ticks: 3, hoursPerTick: 6 }])
        expect(text('sandbox-status')).toBe('Simulated 3 tick(s) of 6h. Undo to rewind that run.')
        // The create form, cleared on success; the change form.
        setOutcome({ ok: true })
        q<HTMLInputElement>('sandbox-add-name').value = 'Rat Swarm'
        q<HTMLSelectElement>('sandbox-add-kind').value = 'GROUP'
        q<HTMLInputElement>('sandbox-add-count').value = '4'
        q<HTMLInputElement>('sandbox-add-cause').value = 'Spawned'
        q<HTMLButtonElement>('sandbox-add-go').click()
        await settle()
        expect(calls.at(-3)).toEqual(['add', { siteRoot: 'Abbey Undercroft', name: 'Rat Swarm', kind: 'GROUP', location: 'landing', count: '4', faction: '', cause: 'Spawned', actor: '' }])
        expect(text('sandbox-status')).toBe('Entity added.')
        expect(q<HTMLInputElement>('sandbox-add-name').value).toBe('')
        q<HTMLSelectElement>('sandbox-set-asset').value = 'pack'
        q<HTMLSelectElement>('sandbox-set-state').value = 'DEAD'
        q<HTMLInputElement>('sandbox-set-actor').value = 'party'
        q<HTMLInputElement>('sandbox-set-cause').value = 'Killed'
        q<HTMLButtonElement>('sandbox-set-go').click()
        await settle()
        expect(calls.at(-3)).toEqual(['set', { siteRoot: 'Abbey Undercroft', assetId: 'pack', state: 'DEAD', count: '', actor: 'party', cause: 'Killed' }])
        expect(text('sandbox-status')).toBe('Entity updated.')
        // Undo and redo light with a last pass; a refusal is said in red and reads nothing again.
        setView({ ...VIEW, lastPass: { type: 'simulate', siteRoot: 'Abbey Undercroft', ticks: 3, hoursPerTick: 6, undone: false } })
        await fold.load()
        expect(q<HTMLButtonElement>('sandbox-undo').disabled).toBe(false)
        setOutcome({ ok: true, action: { type: 'simulate', siteRoot: 'Abbey Undercroft', ticks: 3, hoursPerTick: 6, undone: true } })
        q<HTMLButtonElement>('sandbox-undo').click()
        await settle()
        expect(text('sandbox-status')).toBe('Undid Simulate ticks on Abbey Undercroft. Redo to run that same pass again.')
        setOutcome({ ok: false, skipped: 'busy', error: 'An agent is already running.' })
        q<HTMLButtonElement>('sandbox-redo').click()
        await settle()
        expect(text('sandbox-status')).toBe('An agent is already running.')
        expect(q<HTMLElement>('sandbox-status').classList.contains('lh-world-note--error')).toBe(true)
    })

    it('asks before clearing the history and does nothing when declined; a host that throws is said, not thrown', async () => {
        const { fold, calls, q, text, setConfirm } = mount()
        fold.setChat('c1')
        await fold.load()
        calls.length = 0
        setConfirm(false)
        q<HTMLButtonElement>('sandbox-clear').click()
        await settle()
        expect(calls.map((c) => c[0])).toEqual(['confirm'])
        expect(String(calls[0]![1])).toContain('Clear evolution backlog and causal threads for "Abbey Undercroft"?')
        setConfirm(true)
        q<HTMLButtonElement>('sandbox-clear').click()
        await settle()
        expect(calls.map((c) => c[0])).toEqual(['confirm', 'confirm', 'clear', 'get'])
        expect(text('sandbox-status')).toBe('Cleared evolution history for Abbey Undercroft.')
        const broken = mount({ evolve: async () => { throw new Error('host down') } })
        broken.fold.setChat('c1')
        await broken.fold.load()
        broken.q<HTMLButtonElement>('sandbox-evolve').click()
        await settle()
        expect(broken.text('sandbox-status')).toBe('evolve failed: host down')
    })

    it('follows a simulate’s ticks while one runs, forgets the view on a chat change, and says when the chat cannot be read', async () => {
        const { fold, q, text } = mount({ simulate: () => new Promise(() => undefined) })
        fold.setChat('c1')
        await fold.load()
        q<HTMLButtonElement>('sandbox-simulate').click()
        await settle()
        expect(fold.busy()).toBe(true)
        fold.progress({ chatId: 'c1', index: 1, count: 3, timeLabel: 'Day 5, 05:00 PM', phase: 'evolved' })
        expect(text('sandbox-status')).toBe('Tick 2/3 (evolved) at Day 5, 05:00 PM…')
        fold.progress({ chatId: 'c2', index: 2, count: 3, timeLabel: 'x', phase: 'time' })
        expect(text('sandbox-status')).toBe('Tick 2/3 (evolved) at Day 5, 05:00 PM…')
        expect(q<HTMLButtonElement>('sandbox-evolve').disabled).toBe(true)
        fold.setChat('c2')
        expect(fold.busy()).toBe(false)
        expect(text('sandbox-status')).toBe('')
        expect(text('sandbox-time')).toBe('In-world timeUnknown')
        const unread = mount({ get: async () => { throw new Error('no prefs') } })
        unread.fold.setChat('c1')
        await unread.fold.load()
        expect(unread.text('sandbox-problem')).toBe('The Testing Ground could not read this chat: no prefs')
        expect(unread.q<HTMLButtonElement>('sandbox-evolve').disabled).toBe(true)
    })

    it('words every outcome as the legacy does, and reads the memory bar’s standing', () => {
        expect(outcomeWords('evolve', { ok: true, applied: 0 })).toBe('Evolution ran; no material change. Undo to rewind that pass.')
        expect(outcomeWords('redo', { ok: true, applied: 3, action: { type: 'evolve', siteRoot: 'X', undone: false } })).toBe('Redid Evolve: applied 3 material update(s).')
        expect(outcomeWords('redo', { ok: true, action: { type: 'evolve', siteRoot: 'X', undone: false } })).toBe('Redid Evolve; no material change.')
        expect(outcomeWords('redo', { ok: true, ticks: 2, hoursPerTick: 8, action: { type: 'simulate', siteRoot: 'X', undone: false } })).toBe('Redid Simulate: 2 tick(s) of 8h.')
        expect(outcomeWords('undo', { ok: true, action: { type: 'evolve', siteRoot: 'Keep', undone: true } })).toBe('Undid Evolve on Keep. Redo to run that same pass again.')
        expect(outcomeWords('add', { ok: false, error: 'Cause is required.' })).toBe('Cause is required.')
        expect(outcomeWords('set', { ok: false, error: '' })).toBe('set failed.')
        expect(memoryStatus({ ...VIEW.memory, compressEnabled: false })).toBe('Compression off')
        expect(memoryStatus({ ...VIEW.memory, overThreshold: true })).toBe('At or over threshold — this Evolution pass will compress closed threads after it records')
    })
})
