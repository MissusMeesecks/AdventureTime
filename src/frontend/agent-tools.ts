/**
 * The agent's tools (Phase 71c, roadmap row 71): Multihog's title bar and
 * footer of the Lorebook Agent tab — 📕 Full Audit, 🧹 Cleanup, ⏸ Pause, ⧉
 * Clone Stack over the pass, and ← undo [ LIVE ] redo → under it.
 *
 * A strip of buttons after the agent's bar, a panel under it where the one
 * tool pressed opens its form (the audit's confirm is the host's dialog, as
 * every irreversible button's is), and the footer with the undo and the
 * redo around the legacy's label. Every tool answers in a note of its own
 * and in the agent's report box, since each runs a pass of the agent.
 */

import type { AgentAuditResult, AgentRedoResult, AgentRunResult, AgentUndoResult, CampaignCloneResult } from '../protocol.js'

export interface AgentToolsHost {
    el(tag: string, attrs?: Record<string, string>): HTMLElement
    /** The campaign's name, for the clone's lead. */
    campaignName(): string
    audit(): Promise<AgentAuditResult>
    auditStop(): Promise<{ stopped: boolean }>
    cleanup(instructions: string): Promise<AgentRunResult>
    undo(): Promise<AgentUndoResult>
    redo(): Promise<AgentRedoResult>
    clone(newPrefix: string): Promise<CampaignCloneResult>
    savePrefs(patch: Record<string, unknown>): Promise<void>
    /** The host's confirmation dialog; absent, the audit starts without asking. */
    confirm?(title: string, message: string, confirmLabel: string): Promise<boolean>
    fail(error: unknown): void
    /** A tool is at work, or done: the fold's own Run button and bar wait with it. */
    onBusy?(busy: boolean): void
    /** The agent's report box follows a pass these tools ran. */
    onPass?(result: AgentRunResult): void
    /** The report on screen describes a pass that no longer stands, or stands again. */
    onUndone?(result: AgentUndoResult): void
    onRedone?(result: AgentRedoResult): void
}

export interface AgentTools {
    /** The strip of buttons, and the pause banner. */
    strip: HTMLElement
    /** Where a pressed tool's form, live line and note go. */
    panel: HTMLElement
    /** ← undo, the label, redo →, and the note under them. */
    footer: HTMLElement
    applyPrefs(prefs: Record<string, unknown>): void
    setChat(chatId: string | null): void
    /** A pass is running on the chat: the tools wait. */
    setRunning(running: boolean): void
    /** The backend's audit progress, for the live line. */
    progress(data: { chatId?: string; chunk: number; total: number; status: 'running' | 'skipped' | 'done' }): void
    /** An undone pass written back elsewhere (a swipe's rollback, the backend's event). */
    noteUndone(result: AgentUndoResult): void
    noteRedone(result: AgentRedoResult): void
    /** For a test: the words on screen. */
    text(field: string): string
}

/** The legacy's confirm, in plain text, and its button. */
export const AUDIT_CONFIRM = {
    title: '📚 Lorebook Agent Full Audit',
    message: 'You are about to run a Full Audit of the entire chat history through the Lorebook Agent. '
        + 'This may take several minutes depending on the size of your chat: the agent will process the history in chunks, rebuilding and updating your lorebooks one chunk after another. '
        + 'Do not send messages to the AI while the audit is running.',
    confirmLabel: 'Start Full Audit',
} as const

/** The legacy's `[ LIVE ]` and `[ -N ]`. */
export function redoLabel(waiting: number): { text: string; title: string } {
    return waiting > 0
        ? { text: `[ -${waiting} ]`, title: `Rolled back ${waiting} agent pass${waiting === 1 ? '' : 'es'} — use → to redo` }
        : { text: '[ LIVE ]', title: 'Lorebook is at current live state' }
}

/** What the audit's answer says, in the panel's words. */
export function auditOutcome(result: AgentAuditResult): { text: string; error: boolean } {
    if (result.unavailable) return { text: result.unavailable, error: true }
    switch (result.status) {
        case 'complete': return { text: `Agent Full Audit complete (${result.chunks} chunk${result.chunks === 1 ? '' : 's'}).${result.skipped ? ` ${result.skipped} skipped while a pass was still busy.` : ''}`, error: result.skipped > 0 }
        case 'stopped': return { text: result.reason ?? 'The audit was stopped.', error: false }
        case 'nothing': return { text: result.reason ?? 'No chat history to audit.', error: false }
        case 'busy': return { text: result.reason ?? 'A full audit is already running on this chat.', error: true }
        default: return { text: `Agent Full Audit failed. ${result.reason ?? ''}`.trim(), error: true }
    }
}

/** What a clone's answer says. */
export function cloneOutcome(result: CampaignCloneResult): { text: string; error: boolean } {
    if (result.unavailable) return { text: result.unavailable, error: true }
    if (result.refused) return { text: result.refused, error: true }
    const n = result.cloned.length
    const made = `Cloned ${n} lorebook${n === 1 ? '' : 's'} → prefix "${result.newPrefix}". Name a campaign "${result.newPrefix}" in another chat and adopt them from its Lorebooks list.`
    return result.errors.length ? { text: `${made} ${result.errors.length} could not be copied: ${result.errors.join('; ')}`, error: true } : { text: made, error: false }
}

export function createAgentTools(host: AgentToolsHost): AgentTools {
    const { el } = host
    let chatId: string | null = null
    let paused = false
    let running = false
    let auditing = false
    let open: 'cleanup' | 'clone' | null = null
    let waiting = 0
    const prefs: { useThreshold: boolean; threshold: number; every: number } = { useThreshold: true, threshold: 300, every: 0 }

    // ── The strip ────────────────────────────────────────────────────────
    const strip = el('div', { class: 'lh-agent-tools', 'data-lh-field': 'agent-tools' })
    const auditButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-agent-tool', 'data-lh-field': 'agent-audit' }) as HTMLButtonElement
    auditButton.textContent = '📕 Full audit'
    auditButton.title = 'Audit the entire chat history through the Lorebook Agent, in chunks, rebuilding the lorebooks'
    const cleanupButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-agent-tool', 'data-lh-field': 'agent-cleanup' }) as HTMLButtonElement
    cleanupButton.textContent = '🧹 Cleanup'
    cleanupButton.title = 'Consolidate the bloated entries of this campaign’s lorebooks'
    const pauseButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-agent-tool', 'data-lh-field': 'agent-pause' }) as HTMLButtonElement
    const cloneButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-agent-tool', 'data-lh-field': 'agent-clone' }) as HTMLButtonElement
    cloneButton.textContent = '⧉ Clone the books'
    cloneButton.title = 'Duplicate all campaign lorebooks under a new prefix for branching'
    const banner = el('span', { class: 'lh-agent-pause-banner', 'data-lh-field': 'agent-pause-banner', hidden: 'hidden' })
    banner.textContent = 'AGENT PAUSED'
    strip.append(auditButton, cleanupButton, pauseButton, cloneButton, banner)

    // ── The panel ────────────────────────────────────────────────────────
    const panel = el('div', { class: 'lh-agent-tools-panel' })
    const live = el('div', { class: 'lh-agent-tools-live', hidden: 'hidden' })
    const liveWords = el('span', { 'data-lh-field': 'agent-audit-live' })
    const stopButton = el('button', { type: 'button', class: 'lh-button lh-button--stop', 'data-lh-field': 'agent-audit-stop' }) as HTMLButtonElement
    stopButton.textContent = 'Stop the audit'
    stopButton.title = 'Stop the chunk in flight, as the agent’s Stop does, and end the audit. The chunks already written stand.'
    live.append(liveWords, stopButton)
    const form = el('div', { class: 'lh-agent-tools-form', hidden: 'hidden' })
    const note = el('div', { class: 'lh-agent-tools-note', 'data-lh-field': 'agent-tools-note' })
    panel.append(live, form, note)

    // ── The footer ───────────────────────────────────────────────────────
    const footer = el('div', { class: 'lh-agent-tools-footer' })
    const nav = el('div', { class: 'lh-agent-nav' })
    const undoButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'agent-undo' }) as HTMLButtonElement
    undoButton.textContent = '← Undo the last pass'
    undoButton.title = 'Undo last lorebook pass'
    const label = el('span', { class: 'lh-agent-nav-label', 'data-lh-field': 'agent-nav-label' })
    const redoButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'agent-redo' }) as HTMLButtonElement
    redoButton.textContent = 'Redo →'
    redoButton.title = 'Redo lorebook pass'
    nav.append(undoButton, label, redoButton)
    const undoNote = el('div', { class: 'lh-agent-tools-note', 'data-lh-field': 'agent-undo-note' })
    footer.append(nav, undoNote)

    function say(text: string, error = false): void {
        note.textContent = text
        note.classList.toggle('lh-agent-tools-note--error', error)
    }
    function sayUndo(text: string, error = false): void {
        undoNote.textContent = text
        undoNote.classList.toggle('lh-agent-tools-note--error', error)
    }

    let toldBusy = false
    function drawButtons(): void {
        const busy = running || auditing || !chatId
        const atWork = running || auditing
        if (atWork !== toldBusy) { toldBusy = atWork; host.onBusy?.(atWork) }
        for (const button of [auditButton, cleanupButton, cloneButton]) button.disabled = busy
        pauseButton.disabled = !chatId
        pauseButton.textContent = paused ? '▶ Resume the agent' : '⏸ Pause the agent'
        pauseButton.title = paused ? 'Resume Agent (auto-runs paused)' : 'Pause Agent (skip auto-runs)'
        pauseButton.classList.toggle('lh-agent-tool--paused', paused)
        banner.hidden = !paused
        undoButton.disabled = busy
        redoButton.disabled = busy || waiting === 0
        const words = redoLabel(waiting)
        label.textContent = words.text
        label.title = words.title
        live.hidden = !auditing
        cleanupButton.classList.toggle('lh-agent-tool--open', open === 'cleanup')
        cloneButton.classList.toggle('lh-agent-tool--open', open === 'clone')
    }

    function drawForm(): void {
        form.replaceChildren()
        form.hidden = open === null
        if (open === 'cleanup') form.append(cleanupForm())
        if (open === 'clone') form.append(cloneForm())
    }

    // ── The cleanup menu ─────────────────────────────────────────────────
    function cleanupForm(): HTMLElement {
        const box = el('div', { class: 'lh-records-form', 'data-lh-field': 'agent-cleanup-form' })
        const lead = el('div', { class: 'lh-agent-tools-lead' })
        lead.textContent = `A Global Cleanup pass consolidates every bloated lore entry (over ${prefs.threshold} tokens${prefs.useThreshold ? '' : '; the threshold is off, so every entry'}). Custom requirements for the compression, if any (e.g. "Keep background lore detailed but condense quest status"):`
        const text = el('textarea', { class: 'lh-input', rows: '2', placeholder: 'Leave blank for standard cleanup...', 'data-lh-field': 'agent-cleanup-text' }) as HTMLTextAreaElement
        const settings = el('div', { class: 'lh-agent-tools-settings' })
        const useRow = el('label', { class: 'lh-agent-tools-setting' })
        const use = el('input', { type: 'checkbox', 'data-lh-field': 'agent-cleanup-use-threshold' }) as HTMLInputElement
        use.checked = prefs.useThreshold
        use.title = 'Off, every entry is flagged whatever its size.'
        useRow.append(use, document.createTextNode(' Use the token threshold'))
        const thresholdRow = el('label', { class: 'lh-agent-tools-setting' })
        thresholdRow.classList.toggle('lh-agent-tools-setting--dim', !prefs.useThreshold)
        const threshold = el('input', { type: 'number', class: 'lh-input lh-input--short', min: '50', max: '5000', step: '10', 'data-lh-field': 'agent-cleanup-threshold' }) as HTMLInputElement
        threshold.value = String(prefs.threshold)
        thresholdRow.append(document.createTextNode('Token threshold '), threshold)
        const everyRow = el('label', { class: 'lh-agent-tools-setting' })
        const every = el('input', { type: 'number', class: 'lh-input lh-input--short', min: '0', max: '100', step: '1', 'data-lh-field': 'agent-cleanup-every' }) as HTMLInputElement
        every.value = String(prefs.every)
        every.title = 'A cleanup pass of its own after every N agent passes that find something bloated. 0: never.'
        everyRow.append(document.createTextNode('Auto-cleanup every N passes (0 = off) '), every)
        settings.append(useRow, thresholdRow, everyRow)
        use.addEventListener('change', () => { prefs.useThreshold = use.checked; host.savePrefs({ agentCleanupUseThreshold: use.checked }).catch(host.fail); drawForm() })
        threshold.addEventListener('change', () => {
            const n = Math.min(5000, Math.max(50, Math.floor(Number(threshold.value)) || 300))
            prefs.threshold = n
            threshold.value = String(n)
            host.savePrefs({ agentCleanupThreshold: n }).catch(host.fail)
        })
        every.addEventListener('change', () => {
            const n = Math.min(100, Math.max(0, Math.floor(Number(every.value)) || 0))
            prefs.every = n
            every.value = String(n)
            host.savePrefs({ agentCleanupEvery: n }).catch(host.fail)
        })
        const buttons = el('div', { class: 'lh-records-buttons' })
        const cancel = el('button', { type: 'button', class: 'lh-button lh-button--quiet' }) as HTMLButtonElement
        cancel.textContent = 'Cancel'
        cancel.addEventListener('click', () => { open = null; drawForm(); drawButtons() })
        const go = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'agent-cleanup-go' }) as HTMLButtonElement
        go.textContent = 'Clean all bloated'
        go.addEventListener('click', () => { runCleanup(text.value).catch(host.fail) })
        buttons.append(cancel, go)
        box.append(lead, text, settings, buttons)
        return box
    }

    async function runCleanup(instructions: string): Promise<void> {
        if (!chatId) return
        const startedFor = chatId
        open = null
        drawForm()
        running = true
        drawButtons()
        say('Starting lorebook cleanup mode…')
        try {
            const result = await host.cleanup(instructions.trim())
            if (chatId !== startedFor) return
            say(result.unavailable ?? result.summary, Boolean(result.unavailable) || result.outcome === 'failed')
            host.onPass?.(result)
        } catch (error) {
            say(`The cleanup could not run: ${error instanceof Error ? error.message : String(error)}`, true)
        } finally {
            if (chatId === startedFor) { running = false; drawButtons() }
        }
    }

    // ── The full audit ───────────────────────────────────────────────────
    async function runAudit(): Promise<void> {
        if (!chatId) return
        const startedFor = chatId
        if (host.confirm && !(await host.confirm(AUDIT_CONFIRM.title, AUDIT_CONFIRM.message, AUDIT_CONFIRM.confirmLabel))) return
        if (chatId !== startedFor) return
        auditing = true
        liveWords.textContent = 'Agent Full Audit: reading the chat…'
        say('')
        drawButtons()
        try {
            const result = await host.audit()
            if (chatId !== startedFor) return
            const outcome = auditOutcome(result)
            say(result.summaries.length ? `${outcome.text}\n${result.summaries.join('\n')}` : outcome.text, outcome.error)
        } catch (error) {
            say(`Agent Full Audit failed. ${error instanceof Error ? error.message : String(error)}`, true)
        } finally {
            if (chatId === startedFor) { auditing = false; drawButtons() }
        }
    }

    stopButton.addEventListener('click', () => {
        stopButton.disabled = true
        host.auditStop().then((result) => {
            liveWords.textContent = result.stopped ? 'Stopping the chunk in flight…' : 'No audit is running.'
        }).catch(host.fail).finally(() => { stopButton.disabled = false })
    })

    // ── The clone ────────────────────────────────────────────────────────
    function cloneForm(): HTMLElement {
        const box = el('div', { class: 'lh-records-form', 'data-lh-field': 'agent-clone-form' })
        const lead = el('div', { class: 'lh-agent-tools-lead' })
        const prefix = host.campaignName().trim()
        lead.textContent = prefix
            ? `All lorebooks under the prefix "${prefix}" will be duplicated. Enter the new prefix for the cloned stack (e.g. ${prefix}_Branch1).`
            : 'No campaign prefix is active. Name the campaign first, and run the agent once so it owns some books.'
        const input = el('input', { type: 'text', class: 'lh-input', placeholder: 'Eldoria_Branch1', 'data-lh-field': 'agent-clone-prefix' }) as HTMLInputElement
        const buttons = el('div', { class: 'lh-records-buttons' })
        const cancel = el('button', { type: 'button', class: 'lh-button lh-button--quiet' }) as HTMLButtonElement
        cancel.textContent = 'Cancel'
        cancel.addEventListener('click', () => { open = null; drawForm(); drawButtons() })
        const go = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'agent-clone-go' }) as HTMLButtonElement
        go.textContent = 'Clone'
        go.disabled = !prefix
        go.addEventListener('click', () => { runClone(input.value).catch(host.fail) })
        input.addEventListener('keydown', (event) => { if ((event as KeyboardEvent).key === 'Enter') { event.preventDefault(); runClone(input.value).catch(host.fail) } })
        buttons.append(cancel, go)
        box.append(lead, input, buttons)
        return box
    }

    async function runClone(newPrefix: string): Promise<void> {
        if (!chatId) return
        const startedFor = chatId
        running = true
        drawButtons()
        say(`Cloning lorebooks to prefix "${newPrefix.trim()}"…`)
        try {
            const result = await host.clone(newPrefix.trim())
            if (chatId !== startedFor) return
            const outcome = cloneOutcome(result)
            say(outcome.text, outcome.error)
            if (!outcome.error) { open = null; drawForm() }
        } catch (error) {
            say(`The clone could not run: ${error instanceof Error ? error.message : String(error)}`, true)
        } finally {
            if (chatId === startedFor) { running = false; drawButtons() }
        }
    }

    // ── Undo and redo ────────────────────────────────────────────────────
    async function runUndo(): Promise<void> {
        if (!chatId) return
        const startedFor = chatId
        running = true
        drawButtons()
        sayUndo('Putting the lorebooks back…')
        try {
            const result = await host.undo()
            if (chatId !== startedFor) return
            waiting = result.waiting ?? waiting
            sayUndo(`${result.unavailable ?? result.summary}${result.problems.length ? ` ${result.problems.join(' ')}` : ''}`, Boolean(result.unavailable) || result.problems.length > 0)
            if (result.undone) host.onUndone?.(result)
        } catch (error) {
            sayUndo(`The undo could not run: ${error instanceof Error ? error.message : String(error)}`, true)
        } finally {
            if (chatId === startedFor) { running = false; drawButtons() }
        }
    }

    async function runRedo(): Promise<void> {
        if (!chatId) return
        const startedFor = chatId
        running = true
        drawButtons()
        sayUndo('Writing the undone pass back…')
        try {
            const result = await host.redo()
            if (chatId !== startedFor) return
            waiting = result.waiting ?? Math.max(0, waiting - 1)
            sayUndo(`${result.unavailable ?? result.summary}${result.problems.length ? ` ${result.problems.join(' ')}` : ''}`, Boolean(result.unavailable) || result.problems.length > 0)
            if (result.redone) host.onRedone?.(result)
        } catch (error) {
            sayUndo(`The redo could not run: ${error instanceof Error ? error.message : String(error)}`, true)
        } finally {
            if (chatId === startedFor) { running = false; drawButtons() }
        }
    }

    auditButton.addEventListener('click', () => { runAudit().catch(host.fail) })
    cleanupButton.addEventListener('click', () => { open = open === 'cleanup' ? null : 'cleanup'; drawForm(); drawButtons() })
    cloneButton.addEventListener('click', () => { open = open === 'clone' ? null : 'clone'; drawForm(); drawButtons() })
    pauseButton.addEventListener('click', () => {
        paused = !paused
        drawButtons()
        host.savePrefs({ agentPaused: paused }).catch((error: unknown) => { paused = !paused; drawButtons(); host.fail(error) })
    })
    undoButton.addEventListener('click', () => { runUndo().catch(host.fail) })
    redoButton.addEventListener('click', () => { runRedo().catch(host.fail) })

    drawButtons()
    return {
        strip,
        panel,
        footer,
        applyPrefs(next) {
            paused = next.agentPaused === true
            prefs.useThreshold = next.agentCleanupUseThreshold !== false
            if (typeof next.agentCleanupThreshold === 'number') prefs.threshold = next.agentCleanupThreshold
            if (typeof next.agentCleanupEvery === 'number') prefs.every = next.agentCleanupEvery
            drawButtons()
            if (open === 'cleanup') drawForm()
        },
        setChat(next) {
            if (next !== chatId) {
                chatId = next
                open = null
                waiting = 0
                auditing = false
                running = false
                say('')
                sayUndo('')
                drawForm()
            }
            drawButtons()
        },
        setRunning(next) { running = next; drawButtons() },
        progress(data) {
            if (data.chatId && data.chatId !== chatId) return
            // The words only: whether an audit is running is the press's to say, so an event arriving after its answer re-arms nothing.
            liveWords.textContent = data.status === 'skipped'
                ? `Agent Full Audit: chunk ${data.chunk} of ${data.total} skipped — the agent was still busy.`
                : `Agent Full Audit: chunk ${data.chunk} of ${data.total}${data.status === 'done' ? ' done' : '…'}`
        },
        noteUndone(result) {
            waiting = result.waiting ?? waiting + 1
            sayUndo(`Rolled back after a swipe. ${result.summary}`, result.problems.length > 0)
            drawButtons()
        },
        noteRedone(result) {
            waiting = result.waiting ?? Math.max(0, waiting - 1)
            sayUndo(result.summary, result.problems.length > 0)
            drawButtons()
        },
        text(field) {
            const found = [strip, panel, footer].map((root) => root.querySelector(`[data-lh-field="${field}"]`)).find(Boolean) as HTMLElement | null
            return found?.textContent ?? ''
        },
    }
}

export const AGENT_TOOLS_CSS = `
.lh-agent-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35em; margin: 0.4em 0; }
.lh-agent-tool--open { outline: 1px solid var(--lh-accent, var(--lumiverse-primary, #c9a227)); }
.lh-agent-tool--paused { color: var(--lumiverse-warning, #ffa500); border-color: var(--lumiverse-warning, #ffa500); }
.lh-agent-pause-banner { margin-left: auto; font-weight: 700; letter-spacing: 0.08em; color: var(--lumiverse-warning, #ffa500); }
.lh-agent-pause-banner[hidden] { display: none; }
.lh-agent-tools-panel { display: flex; flex-direction: column; gap: 0.3em; }
.lh-agent-tools-form[hidden] { display: none; }
.lh-agent-tools-settings { display: flex; flex-wrap: wrap; gap: 0.6em 1.2em; margin: 0.3em 0; font-size: 0.85em; }
.lh-agent-tools-setting { display: inline-flex; align-items: center; gap: 0.35em; }
.lh-agent-tools-setting--dim { opacity: 0.35; }
.lh-agent-tools-note, .lh-agent-tools-lead { font-size: 0.8em; opacity: 0.85; overflow-wrap: anywhere; white-space: pre-wrap; }
.lh-agent-tools-note--error { color: var(--lumiverse-danger, #ff6b6b); opacity: 1; }
.lh-agent-tools-live { display: flex; align-items: center; gap: 0.6em; padding: 0.4em 0.6em; border: 1px solid var(--lh-accent, var(--lumiverse-primary, #c9a227)); border-radius: 6px; font-size: 0.85em; }
.lh-agent-tools-live[hidden] { display: none; }
.lh-agent-tools-footer { margin-top: 0.4em; }
.lh-agent-nav { display: flex; align-items: center; gap: 0.6em; }
.lh-agent-nav-label { font-family: monospace; opacity: 0.8; }
/* A button that cannot be pressed looks it (71c-bis): the panel's stylesheet
   draws no disabled state, so Redo → after an undo looked as it had before.
   The legacy's nav buttons dim to 0.3 when disabled; the strip's follow. */
.adventuretime-panel .lh-agent-tools .lh-button:disabled, .adventuretime-panel .lh-agent-nav .lh-button:disabled { opacity: 0.3; cursor: default; }
`
