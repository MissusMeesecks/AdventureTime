/**
 * The terminal (Phase 71b, roadmap row 71): Multihog's Terminal/Direct
 * Prompt in the Lorebook Agent panel — one tab per agent, each with the live
 * feed of its pass's steps, a direct bar with its own lookback, and a draft
 * kept across reloads.
 *
 * The feed is the backend's (`terminal.get` for what it kept, `terminal.step`
 * as a pass goes); the bar runs the same passes the folds' buttons run, so a
 * command sent here lands in the same report, the same history and the
 * same undo. The Map Architect's bar takes the legacy's creation command,
 * `Create SETTLEMENT|DUNGEON|INTERIOR map for "Site"`, or briefs the site
 * the party stands in.
 */

import type { TerminalResult, TerminalSource, TerminalStep } from '../protocol.js'

export const TERMINAL_TABS: ReadonlyArray<{ id: TerminalSource; label: string; placeholder: string; lookbackKey: string; lookbackMax: number }> = [
    { id: 'state_tracker', label: 'State Tracker', placeholder: 'Instruct the State Tracker… (Enter to send, Shift+Enter for a new line)', lookbackKey: 'trackerDirectLookback', lookbackMax: 50 },
    { id: 'lorebook_agent', label: 'Lorebook Agent', placeholder: 'Instruct the Lorebook Agent… (Enter to send, Shift+Enter for a new line)', lookbackKey: 'agentDirectLookback', lookbackMax: 100 },
    { id: 'map_updater', label: 'Map Updater', placeholder: 'Instruct the Map Updater… (Enter to send, Shift+Enter for a new line)', lookbackKey: 'mapUpdaterDirectLookback', lookbackMax: 100 },
    { id: 'map_evolution', label: 'Map Evolution', placeholder: 'Instruct Map Evolution… (Enter to send, Shift+Enter for a new line)', lookbackKey: 'mapEvolutionDirectLookback', lookbackMax: 100 },
    { id: 'map_architect', label: 'Map Architect', placeholder: 'Instruct the Map Architect for the current site, or “Create DUNGEON map for "Site"”… (Enter to send)', lookbackKey: 'mapArchitectDirectLookback', lookbackMax: 100 },
]

export const TERMINAL_SOURCES: readonly TerminalSource[] = TERMINAL_TABS.map((t) => t.id)

export interface TerminalFoldHost {
    el(tag: string, attrs?: Record<string, string>): HTMLElement
    /** The kept steps of the chat. */
    load(chatId: string): Promise<TerminalResult>
    /** One feed forgotten. */
    clear(chatId: string, source: TerminalSource): Promise<TerminalResult>
    /** The pass behind the tab, run with the command and the bar's lookback; resolves when it has landed. */
    run(source: TerminalSource, text: string, lookback: number): Promise<void>
    savePrefs(patch: Record<string, unknown>): Promise<void>
    fail(error: unknown): void
    /** The clock on a step, HH:MM:SS; the browser's when absent. */
    clock?(iso: string): string
    now?: () => Date
}

export interface TerminalFold {
    root: HTMLDetailsElement
    setChat(chatId: string | null): void
    applyPrefs(prefs: Record<string, unknown>): void
    /** A step announced by the backend; one for another chat is dropped. */
    push(chatId: string, step: TerminalStep): void
    /** The tab shown. */
    active(): TerminalSource
    /** Lines drawn in one feed, for a test. */
    lines(source: TerminalSource): string[]
    /** Under a tab's bar (78a): where the agent's own report goes, Multihog's Agent Log History under its Lorebook Agent tab. */
    history(source: TerminalSource): HTMLElement
}

const TITLES: Record<TerminalStep['type'], { icon: string; title: string }> = {
    start: { icon: '▶', title: 'Starting' },
    thought: { icon: '💭', title: 'Thought' },
    tool: { icon: '🔧', title: 'Tool' },
    result: { icon: '📋', title: 'Result' },
    error: { icon: '⚠️', title: 'Error' },
    finish: { icon: '✅', title: 'Finished' },
}

export function isTerminalSource(value: unknown): value is TerminalSource {
    return typeof value === 'string' && (TERMINAL_SOURCES as readonly string[]).includes(value)
}

/** The legacy's time on a step: HH:MM:SS, 24-hour. */
export function stepClock(iso: string): string {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function emptyFeeds(): Record<TerminalSource, TerminalStep[]> {
    return { state_tracker: [], lorebook_agent: [], map_updater: [], map_evolution: [], map_architect: [] }
}

function readLookback(raw: string, fallback: number, max: number): number {
    const n = Math.floor(Number(raw))
    if (!Number.isFinite(n)) return fallback
    return Math.min(max, Math.max(0, n))
}

export function createTerminalFold(host: TerminalFoldHost): TerminalFold {
    const { el } = host
    const clock = host.clock ?? stepClock
    const now = host.now ?? (() => new Date())
    let chatId: string | null = null
    let activeTab: TerminalSource = 'lorebook_agent'
    let feeds = emptyFeeds()
    const drafts: Record<TerminalSource, string> = { state_tracker: '', lorebook_agent: '', map_updater: '', map_evolution: '', map_architect: '' }
    const lookbacks: Record<TerminalSource, number> = { state_tracker: 5, lorebook_agent: 10, map_updater: 10, map_evolution: 10, map_architect: 10 }
    const busy = new Set<TerminalSource>()
    let draftTimer: ReturnType<typeof setTimeout> | null = null

    const root = el('details', { class: 'lh-terminal', 'data-lh-field': 'terminal' }) as HTMLDetailsElement
    const summary = el('summary')
    summary.textContent = 'Terminal / direct prompt'
    const body = el('div', { class: 'lh-terminal-body' })
    const lead = el('div', { class: 'lh-world-lead' })
    lead.textContent = 'Every agent as it works, one tab each: the steps of its last pass as they happen, and a bar to instruct it directly. A command sent here runs the same pass as the fold’s button, with the bar’s own lookback; the draft is kept.'
    const head = el('div', { class: 'lh-terminal-head' })
    const tabs = el('div', { class: 'lh-terminal-tabs', role: 'tablist', 'aria-label': 'Terminal / direct prompt' })
    const clearButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-terminal-clear', 'data-lh-field': 'terminal-clear' }) as HTMLButtonElement
    clearButton.textContent = 'Clear'
    clearButton.title = 'Forget the steps shown on this tab.'
    head.append(tabs, clearButton)
    const panes = el('div', { class: 'lh-terminal-panes' })
    body.append(lead, head, panes)
    root.append(summary, body)

    const tabButtons = new Map<TerminalSource, HTMLButtonElement>()
    const paneOf = new Map<TerminalSource, { pane: HTMLElement; feed: HTMLElement; input: HTMLTextAreaElement; lookback: HTMLInputElement; run: HTMLButtonElement; note: HTMLElement; history: HTMLElement }>()

    for (const tab of TERMINAL_TABS) {
        const button = el('button', { type: 'button', class: 'lh-terminal-tab', role: 'tab', 'data-lh-terminal-tab': tab.id, 'aria-selected': 'false' }) as HTMLButtonElement
        button.textContent = tab.label
        button.addEventListener('click', () => { show(tab.id, true) })
        tabs.append(button)
        tabButtons.set(tab.id, button)

        const pane = el('div', { class: 'lh-terminal-pane', 'data-lh-terminal-pane': tab.id })
        pane.hidden = true
        const feed = el('div', { class: 'lh-terminal-feed', 'data-lh-field': `terminal-feed-${tab.id}` })
        const bar = el('div', { class: 'lh-terminal-bar' })
        const prompt = el('span', { class: 'lh-terminal-prompt', 'aria-hidden': 'true' })
        prompt.textContent = '$'
        const input = el('textarea', { class: 'lh-terminal-input', rows: '1', spellcheck: 'false', 'data-lh-field': `terminal-input-${tab.id}`, placeholder: tab.placeholder }) as HTMLTextAreaElement
        const actions = el('div', { class: 'lh-terminal-actions' })
        const lookbackLabel = el('label', { class: 'lh-terminal-lookback', title: 'Recent messages this direct run reads' })
        const lookbackText = el('span')
        lookbackText.textContent = 'Lookback:'
        const lookback = el('input', { type: 'number', min: '0', max: String(tab.lookbackMax), step: '1', class: 'lh-input', 'data-lh-field': `terminal-lookback-${tab.id}` }) as HTMLInputElement
        lookback.value = String(lookbacks[tab.id])
        lookbackLabel.append(lookbackText, lookback)
        const run = el('button', { type: 'button', class: 'lh-button lh-terminal-run', 'data-lh-field': `terminal-run-${tab.id}`, title: 'Run the command (Enter)' }) as HTMLButtonElement
        run.textContent = '↵'
        actions.append(lookbackLabel, run)
        bar.append(prompt, input, actions)
        const note = el('div', { class: 'lh-terminal-note', 'data-lh-field': `terminal-note-${tab.id}` })
        // The log history's place (78a): empty until the panel puts the agent's report in it.
        const history = el('div', { class: 'lh-terminal-history', 'data-lh-field': `terminal-history-${tab.id}` })
        pane.append(feed, bar, note, history)
        panes.append(pane)
        paneOf.set(tab.id, { pane, feed, input, lookback, run, note, history })

        const grow = () => {
            input.style.height = 'auto'
            const line = 18
            const next = Math.min(line * 5, Math.max(line, input.scrollHeight || line))
            input.style.height = `${next}px`
        }
        input.addEventListener('input', () => {
            grow()
            drafts[tab.id] = input.value
            keepDrafts()
        })
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                send(tab.id).catch(host.fail)
            }
        })
        lookback.addEventListener('change', () => {
            const value = readLookback(lookback.value, lookbacks[tab.id], tab.lookbackMax)
            lookback.value = String(value)
            lookbacks[tab.id] = value
            host.savePrefs({ [tab.lookbackKey]: value }).catch(host.fail)
        })
        run.addEventListener('click', () => { send(tab.id).catch(host.fail) })
    }

    clearButton.addEventListener('click', () => {
        if (!chatId) return
        const asked = chatId
        const source = activeTab
        host.clear(asked, source).then((result) => {
            if (chatId !== asked) return
            feeds = { ...emptyFeeds(), ...result.steps }
            render(source)
        }).catch(host.fail)
    })

    /** The drafts kept a moment after the last keystroke, the five together as the legacy keeps them. */
    function keepDrafts(): void {
        if (draftTimer) clearTimeout(draftTimer)
        draftTimer = setTimeout(() => {
            draftTimer = null
            host.savePrefs({ terminalDrafts: { ...drafts } }).catch(host.fail)
        }, 400)
    }

    function show(source: TerminalSource, persist: boolean): void {
        activeTab = source
        for (const [id, button] of tabButtons) {
            const on = id === source
            button.classList.toggle('lh-terminal-tab--active', on)
            button.setAttribute('aria-selected', on ? 'true' : 'false')
        }
        for (const [id, entry] of paneOf) entry.pane.hidden = id !== source
        const entry = paneOf.get(source)
        if (entry) entry.feed.scrollTop = entry.feed.scrollHeight
        if (persist) host.savePrefs({ agentTerminalTab: source }).catch(host.fail)
    }

    function renderStep(step: TerminalStep): HTMLElement {
        const look = TITLES[step.type] ?? TITLES.thought
        const row = el('div', { class: `lh-terminal-step lh-terminal-step--${step.type}` })
        const header = el('div', { class: 'lh-terminal-step-head' })
        const time = el('span', { class: 'lh-terminal-time' })
        time.textContent = clock(step.at)
        const icon = el('span', { class: 'lh-terminal-icon', 'aria-hidden': 'true' })
        icon.textContent = look.icon
        const title = el('b', { class: 'lh-terminal-title' })
        title.textContent = look.title
        header.append(time, icon, title)
        if (typeof step.seconds === 'number') {
            const worked = el('span', { class: 'lh-terminal-worked' })
            worked.textContent = `Worked for ${step.seconds}s`
            header.append(worked)
        }
        const content = el('div', { class: 'lh-terminal-content' })
        content.textContent = step.content
        row.append(header, content)
        return row
    }

    function render(source: TerminalSource): void {
        const entry = paneOf.get(source)
        if (!entry) return
        const steps = feeds[source] ?? []
        entry.feed.replaceChildren(...steps.map(renderStep))
        if (!steps.length) {
            const empty = el('div', { class: 'lh-terminal-empty' })
            empty.textContent = chatId ? 'No pass of this agent has run in this chat since the backend started.' : 'No chat open.'
            entry.feed.append(empty)
        }
        if (source === activeTab) entry.feed.scrollTop = entry.feed.scrollHeight
    }

    function renderAll(): void {
        for (const source of TERMINAL_SOURCES) render(source)
    }

    function setBusy(source: TerminalSource, on: boolean): void {
        if (on) busy.add(source)
        else busy.delete(source)
        const entry = paneOf.get(source)
        if (!entry) return
        entry.run.disabled = on
        entry.input.disabled = on
        entry.note.textContent = on ? 'Running…' : ''
        entry.note.classList.toggle('lh-terminal-note--busy', on)
    }

    /** A line of the fold's own, for a request that failed before any pass announced itself. */
    function say(source: TerminalSource, type: TerminalStep['type'], content: string): void {
        feeds[source] = [...(feeds[source] ?? []), { source, type, content, at: now().toISOString() }]
        render(source)
    }

    async function send(source: TerminalSource): Promise<void> {
        const entry = paneOf.get(source)
        if (!entry || busy.has(source)) return
        const text = entry.input.value.trim()
        if (!text) return
        if (!chatId) { say(source, 'error', 'No chat open.'); return }
        const tab = TERMINAL_TABS.find((t) => t.id === source)!
        const lookback = readLookback(entry.lookback.value, lookbacks[source], tab.lookbackMax)
        entry.lookback.value = String(lookback)
        lookbacks[source] = lookback
        // Cleared before the call, as the legacy clears its draft: a second Enter must not send it twice.
        entry.input.value = ''
        entry.input.style.height = ''
        drafts[source] = ''
        if (draftTimer) { clearTimeout(draftTimer); draftTimer = null }
        host.savePrefs({ terminalDrafts: { ...drafts }, [tab.lookbackKey]: lookback }).catch(host.fail)
        setBusy(source, true)
        try {
            await host.run(source, text, lookback)
        } catch (error) {
            say(source, 'error', error instanceof Error ? error.message : String(error))
            host.fail(error)
        } finally {
            setBusy(source, false)
        }
    }

    show(activeTab, false)
    renderAll()

    return {
        root,
        setChat(next) {
            chatId = next
            feeds = emptyFeeds()
            renderAll()
            if (!next) return
            const asked = next
            host.load(asked).then((result) => {
                if (chatId !== asked) return
                feeds = { ...emptyFeeds(), ...result.steps }
                renderAll()
            }).catch(host.fail)
        },
        applyPrefs(prefs) {
            const raw = prefs.terminalDrafts
            if (raw && typeof raw === 'object') {
                for (const source of TERMINAL_SOURCES) {
                    const value = (raw as Record<string, unknown>)[source]
                    if (typeof value !== 'string') continue
                    const entry = paneOf.get(source)!
                    // A draft typed here since the save is never overwritten by the save's own echo.
                    if (drafts[source] !== value && entry.input.value === drafts[source]) {
                        entry.input.value = value
                        entry.input.dispatchEvent(new Event('grow'))
                    }
                    drafts[source] = value
                }
            }
            for (const tab of TERMINAL_TABS) {
                const value = prefs[tab.lookbackKey]
                if (typeof value === 'number' && Number.isFinite(value)) {
                    lookbacks[tab.id] = Math.min(tab.lookbackMax, Math.max(0, Math.floor(value)))
                    paneOf.get(tab.id)!.lookback.value = String(lookbacks[tab.id])
                }
            }
            if (isTerminalSource(prefs.agentTerminalTab) && prefs.agentTerminalTab !== activeTab) show(prefs.agentTerminalTab, false)
        },
        push(forChat, step) {
            if (!chatId || forChat !== chatId || !isTerminalSource(step?.source)) return
            if (step.type === 'start') feeds[step.source] = []
            feeds[step.source] = [...(feeds[step.source] ?? []), step]
            render(step.source)
        },
        active: () => activeTab,
        lines: (source) => Array.from(paneOf.get(source)?.feed.querySelectorAll('.lh-terminal-step') ?? []).map((n) => n.textContent ?? ''),
        history: (source) => paneOf.get(source)!.history,
    }
}

export const TERMINAL_FOLD_CSS = `
.lh-terminal { border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25))); border-radius: var(--lumiverse-radius, 8px); padding: 6px 8px; margin: 6px 0; }
.lh-terminal > summary { cursor: pointer; font-size: 0.85em; opacity: 0.8; }
.lh-terminal-body { margin-top: 6px; display: flex; flex-direction: column; gap: 6px; }
.lh-terminal-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.lh-terminal-tabs { display: flex; flex-wrap: wrap; gap: 4px; }
.lh-terminal-tab { font-size: 0.75em; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.3))); background: transparent; color: inherit; cursor: pointer; opacity: 0.75; }
.lh-terminal-tab--active { opacity: 1; border-color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
.lh-terminal-clear { font-size: 0.75em; color: var(--lumiverse-danger, #ff6b6b); }
.lh-terminal-pane { display: flex; flex-direction: column; gap: 6px; }
.lh-terminal-pane[hidden] { display: none; }
.lh-terminal-feed { max-height: 260px; overflow-y: auto; padding: 6px 8px; border-radius: var(--lumiverse-radius, 6px); background: var(--lh-card-bg, var(--lumiverse-surface, rgba(0,0,0,0.25))); font-family: var(--lh-font-mono, var(--lumiverse-font-mono, ui-monospace, monospace)); font-size: 0.72em; line-height: 1.4; }
.lh-terminal-empty { opacity: 0.55; font-style: italic; }
.lh-terminal-step { margin-bottom: 8px; }
.lh-terminal-step-head { display: flex; align-items: center; gap: 8px; opacity: 0.85; }
.lh-terminal-time { font-size: 0.85em; opacity: 0.5; }
.lh-terminal-icon { width: 1.4em; text-align: center; }
.lh-terminal-title { text-transform: uppercase; letter-spacing: 0.5px; }
.lh-terminal-worked { margin-left: auto; font-size: 0.85em; opacity: 0.6; }
.lh-terminal-content { margin-top: 2px; padding-left: 22px; white-space: pre-wrap; overflow-wrap: anywhere; }
.lh-terminal-step--start .lh-terminal-title { color: var(--lumiverse-warning, #f1c40f); }
.lh-terminal-step--tool .lh-terminal-title { color: var(--lumiverse-info, #3498db); }
.lh-terminal-step--result .lh-terminal-title { color: var(--lh-accent, var(--lumiverse-primary, #9b59b6)); }
.lh-terminal-step--error .lh-terminal-title, .lh-terminal-step--error .lh-terminal-content { color: var(--lumiverse-danger, #e74c3c); }
.lh-terminal-step--finish .lh-terminal-title { color: var(--lumiverse-success, #2ecc71); }
.lh-terminal-bar { display: flex; align-items: flex-start; gap: 6px; }
.lh-terminal-prompt { font-family: var(--lh-font-mono, var(--lumiverse-font-mono, ui-monospace, monospace)); opacity: 0.6; padding-top: 6px; }
.lh-terminal-input { flex: 1; min-width: 0; resize: none; font-family: var(--lh-font-mono, var(--lumiverse-font-mono, ui-monospace, monospace)); font-size: 0.8em; line-height: 18px; padding: 4px 6px; border-radius: var(--lumiverse-radius, 6px); border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.3))); background: transparent; color: inherit; }
.lh-terminal-actions { display: flex; align-items: center; gap: 6px; }
.lh-terminal-lookback { display: inline-flex; align-items: center; gap: 4px; font-size: 0.75em; opacity: 0.8; white-space: nowrap; }
.lh-terminal-lookback .lh-input { width: 4em; }
.lh-terminal-run { padding: 2px 10px; }
.lh-terminal-note { font-size: 0.75em; opacity: 0.75; }
.lh-terminal-note:empty { display: none; }
.lh-terminal-note--busy { color: var(--lumiverse-warning, #e3b341); opacity: 1; animation: lh-tracker-pulse 1.4s ease-in-out infinite; }
`
