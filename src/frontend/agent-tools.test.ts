// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

import type { AgentAuditResult, AgentRedoResult, AgentRunResult, AgentUndoResult, CampaignCloneResult } from '../protocol.js'
import { AGENT_TOOLS_CSS, AUDIT_CONFIRM, auditOutcome, cloneOutcome, createAgentTools, redoLabel } from './agent-tools.js'

const el = (tag: string, attrs?: Record<string, string>) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n }
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const pass = (summary: string, outcome: AgentRunResult['outcome'] = 'committed'): AgentRunResult => ({ at: '', outcome, summary, steps: [], turnsUsed: 1, problems: [] })

function mount(over: Partial<Parameters<typeof createAgentTools>[0]> = {}) {
    const calls: unknown[][] = []
    const patches: Array<Record<string, unknown>> = []
    const failures: unknown[] = []
    let confirmAnswer = true
    const tools = createAgentTools({
        el,
        campaignName: () => 'Vell',
        audit: async () => { calls.push(['audit']); return { at: '', status: 'complete', chunks: 2, done: 2, skipped: 0, summaries: ['Chunk 1: wrote 3', 'Chunk 2: wrote 1'] } as AgentAuditResult },
        auditStop: async () => { calls.push(['stop']); return { stopped: true } },
        cleanup: async (instructions) => { calls.push(['cleanup', instructions]); return pass('Cleanup pass (agent mode). 2 rewritten.') },
        undo: async () => { calls.push(['undo']); return { at: '', summary: 'Undone: 2 entries restored.', undone: true, problems: [], waiting: 1 } as AgentUndoResult },
        redo: async () => { calls.push(['redo']); return { at: '', summary: 'Redone: 2 entries restored.', redone: true, problems: [], waiting: 0 } as AgentRedoResult },
        clone: async (newPrefix) => { calls.push(['clone', newPrefix]); return { newPrefix, cloned: ['Branch_NPC', 'Branch_LOC'], errors: [] } as CampaignCloneResult },
        savePrefs: async (patch) => { patches.push(patch) },
        confirm: async (title, message, label) => { calls.push(['confirm', title, message, label]); return confirmAnswer },
        fail: (error) => { failures.push(error) },
        ...over,
    })
    const root = document.createElement('div')
    root.append(tools.strip, tools.panel, tools.footer)
    const q = <T extends HTMLElement>(field: string) => root.querySelector(`[data-lh-field="${field}"]`) as T
    return { tools, root, calls, patches, failures, q, setConfirm: (v: boolean) => { confirmAnswer = v } }
}

describe('the agent’s tools (71c)', () => {
    it('draws the strip, the pause banner hidden, and waits for a chat', () => {
        const { tools, q } = mount()
        expect(Array.from(tools.strip.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['📕 Full audit', '🧹 Cleanup', '⏸ Pause the agent', '⧉ Clone the books'])
        expect(q<HTMLElement>('agent-pause-banner').hidden).toBe(true)
        expect(q<HTMLButtonElement>('agent-audit').disabled).toBe(true)
        expect(tools.text('agent-nav-label')).toBe('[ LIVE ]')
        tools.setChat('c1')
        expect(q<HTMLButtonElement>('agent-audit').disabled).toBe(false)
        expect(q<HTMLButtonElement>('agent-redo').disabled).toBe(true)
        expect(AGENT_TOOLS_CSS).toMatch(/\.lh-agent-pause-banner\[hidden\]\s*\{[^}]*display:\s*none/)
        // 71c-bis: the panel draws no disabled state of its own, so the strip's
        // and the nav's buttons dim when they cannot be pressed, as the legacy's.
        expect(AGENT_TOOLS_CSS).toMatch(/\.adventuretime-panel \.lh-agent-nav \.lh-button:disabled[^{]*\{[^}]*opacity:\s*0\.3/)
        expect(AGENT_TOOLS_CSS).toMatch(/\.adventuretime-panel \.lh-agent-tools \.lh-button:disabled[^{]*\{[^}]*opacity:\s*0\.3/)
    })

    it('pauses and resumes the agent through the preference, the banner and the button following', async () => {
        const { tools, q, patches } = mount()
        tools.setChat('c1')
        q<HTMLButtonElement>('agent-pause').click()
        await settle()
        expect(patches).toEqual([{ agentPaused: true }])
        expect(q<HTMLButtonElement>('agent-pause').textContent).toBe('▶ Resume the agent')
        expect(q<HTMLElement>('agent-pause-banner').hidden).toBe(false)
        tools.applyPrefs({ agentPaused: false })
        expect(q<HTMLButtonElement>('agent-pause').textContent).toBe('⏸ Pause the agent')
        expect(q<HTMLElement>('agent-pause-banner').hidden).toBe(true)
    })

    it('puts the pause back when the save fails', async () => {
        const { tools, q, failures } = mount({ savePrefs: async () => { throw new Error('no prefs') } })
        tools.setChat('c1')
        q<HTMLButtonElement>('agent-pause').click()
        await settle()
        expect(q<HTMLButtonElement>('agent-pause').textContent).toBe('⏸ Pause the agent')
        expect(failures).toHaveLength(1)
    })

    it('asks before a full audit in the legacy’s words, shows the chunks as they go, and reports the outcome', async () => {
        const { tools, q, calls } = mount()
        tools.setChat('c1')
        q<HTMLButtonElement>('agent-audit').click()
        tools.progress({ chatId: 'c1', chunk: 1, total: 2, status: 'running' })
        expect(tools.text('agent-audit-live')).toBe('Agent Full Audit: chunk 1 of 2…')
        tools.progress({ chatId: 'c2', chunk: 9, total: 9, status: 'running' })
        expect(tools.text('agent-audit-live')).toBe('Agent Full Audit: chunk 1 of 2…')
        tools.progress({ chatId: 'c1', chunk: 1, total: 2, status: 'skipped' })
        expect(tools.text('agent-audit-live')).toBe('Agent Full Audit: chunk 1 of 2 skipped — the agent was still busy.')
        await settle()
        expect(calls[0]).toEqual(['confirm', AUDIT_CONFIRM.title, AUDIT_CONFIRM.message, 'Start Full Audit'])
        expect(calls[1]).toEqual(['audit'])
        expect(tools.text('agent-tools-note')).toBe('Agent Full Audit complete (2 chunks).\nChunk 1: wrote 3\nChunk 2: wrote 1')
        expect(q<HTMLButtonElement>('agent-audit').disabled).toBe(false)
    })

    it('does nothing when the audit is declined, and stops one on request', async () => {
        const { tools, q, calls, setConfirm } = mount()
        tools.setChat('c1')
        setConfirm(false)
        q<HTMLButtonElement>('agent-audit').click()
        await settle()
        expect(calls.map((c) => c[0])).toEqual(['confirm'])
        q<HTMLButtonElement>('agent-audit-stop').click()
        await settle()
        expect(calls.at(-1)).toEqual(['stop'])
        expect(tools.text('agent-audit-live')).toBe('Stopping the chunk in flight…')
    })

    it('opens the cleanup menu with its three settings, saves them, and runs the pass with the requirements', async () => {
        const { tools, q, calls, patches } = mount()
        tools.applyPrefs({ agentCleanupUseThreshold: true, agentCleanupThreshold: 400, agentCleanupEvery: 0 })
        tools.setChat('c1')
        const passes: AgentRunResult[] = []
        ;(tools as unknown as { host?: unknown }).host = undefined
        q<HTMLButtonElement>('agent-cleanup').click()
        expect(q<HTMLElement>('agent-cleanup-form')).not.toBeNull()
        expect(q<HTMLElement>('agent-cleanup-form').textContent).toContain('over 400 tokens')
        const use = q<HTMLInputElement>('agent-cleanup-use-threshold')
        expect(use.checked).toBe(true)
        use.checked = false
        use.dispatchEvent(new Event('change'))
        await settle()
        expect(patches).toEqual([{ agentCleanupUseThreshold: false }])
        expect(q<HTMLElement>('agent-cleanup-form').textContent).toContain('the threshold is off, so every entry')
        const threshold = q<HTMLInputElement>('agent-cleanup-threshold')
        threshold.value = '9999'
        threshold.dispatchEvent(new Event('change'))
        const every = q<HTMLInputElement>('agent-cleanup-every')
        every.value = '3'
        every.dispatchEvent(new Event('change'))
        await settle()
        expect(patches.slice(1)).toEqual([{ agentCleanupThreshold: 5000 }, { agentCleanupEvery: 3 }])
        expect(threshold.value).toBe('5000')
        q<HTMLTextAreaElement>('agent-cleanup-text').value = '  keep the quest status short '
        q<HTMLButtonElement>('agent-cleanup-go').click()
        await settle()
        expect(calls).toEqual([['cleanup', 'keep the quest status short']])
        expect(tools.text('agent-tools-note')).toBe('Cleanup pass (agent mode). 2 rewritten.')
        expect(q<HTMLElement>('agent-cleanup-form')).toBeNull()
        void passes
    })

    it('hands a cleanup’s result to the report box, and a failed one reads red', async () => {
        const seen: AgentRunResult[] = []
        const { tools, q } = mount({ cleanup: async () => pass('The model answered nothing usable.', 'failed'), onPass: (result) => { seen.push(result) } })
        tools.setChat('c1')
        q<HTMLButtonElement>('agent-cleanup').click()
        q<HTMLButtonElement>('agent-cleanup-go').click()
        await settle()
        expect(seen).toHaveLength(1)
        expect(q<HTMLElement>('agent-tools-note').classList.contains('lh-agent-tools-note--error')).toBe(true)
    })

    it('clones the books under a typed prefix and says where they went, or why not', async () => {
        const { tools, q, calls } = mount()
        tools.setChat('c1')
        q<HTMLButtonElement>('agent-clone').click()
        expect(q<HTMLElement>('agent-clone-form').textContent).toContain('All lorebooks under the prefix "Vell" will be duplicated.')
        q<HTMLInputElement>('agent-clone-prefix').value = ' Branch '
        q<HTMLButtonElement>('agent-clone-go').click()
        await settle()
        expect(calls).toEqual([['clone', 'Branch']])
        expect(tools.text('agent-tools-note')).toBe('Cloned 2 lorebooks → prefix "Branch". Name a campaign "Branch" in another chat and adopt them from its Lorebooks list.')
        expect(q<HTMLElement>('agent-clone-form')).toBeNull()
        const refused = mount({ clone: async () => ({ newPrefix: 'vell', cloned: [], errors: [], refused: 'New prefix is the same as the current prefix. Please choose a different name.' }) })
        refused.tools.setChat('c1')
        refused.q<HTMLButtonElement>('agent-clone').click()
        refused.q<HTMLInputElement>('agent-clone-prefix').value = 'vell'
        refused.q<HTMLInputElement>('agent-clone-prefix').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
        await settle()
        expect(refused.tools.text('agent-tools-note')).toBe('New prefix is the same as the current prefix. Please choose a different name.')
        expect(refused.q<HTMLElement>('agent-tools-note').classList.contains('lh-agent-tools-note--error')).toBe(true)
        expect(refused.q<HTMLElement>('agent-clone-form')).not.toBeNull()
    })

    it('greys the clone with no campaign named', () => {
        const { tools, q } = mount({ campaignName: () => '' })
        tools.setChat('c1')
        q<HTMLButtonElement>('agent-clone').click()
        expect(q<HTMLButtonElement>('agent-clone-go').disabled).toBe(true)
        expect(q<HTMLElement>('agent-clone-form').textContent).toContain('No campaign prefix is active.')
    })

    it('undoes, counts the undone pass in the label, redoes, and tells the report box both times', async () => {
        const undone: AgentUndoResult[] = []
        const redone: AgentRedoResult[] = []
        const { tools, q, calls } = mount({ onUndone: (r) => { undone.push(r) }, onRedone: (r) => { redone.push(r) } })
        tools.setChat('c1')
        q<HTMLButtonElement>('agent-undo').click()
        await settle()
        expect(calls).toEqual([['undo']])
        expect(tools.text('agent-undo-note')).toBe('Undone: 2 entries restored.')
        expect(tools.text('agent-nav-label')).toBe('[ -1 ]')
        expect(q<HTMLElement>('agent-nav-label').title).toBe('Rolled back 1 agent pass — use → to redo')
        expect(q<HTMLButtonElement>('agent-redo').disabled).toBe(false)
        q<HTMLButtonElement>('agent-redo').click()
        await settle()
        expect(calls).toEqual([['undo'], ['redo']])
        expect(tools.text('agent-undo-note')).toBe('Redone: 2 entries restored.')
        expect(tools.text('agent-nav-label')).toBe('[ LIVE ]')
        expect(q<HTMLButtonElement>('agent-redo').disabled).toBe(true)
        expect(undone).toHaveLength(1)
        expect(redone).toHaveLength(1)
    })

    it('reads an undo the backend announced, and a redo, into the label', () => {
        const { tools, q } = mount()
        tools.setChat('c1')
        tools.noteUndone({ at: '', summary: 'Undone: 1 entry removed.', undone: true, problems: ['x'], waiting: 2 })
        expect(tools.text('agent-undo-note')).toBe('Rolled back after a swipe. Undone: 1 entry removed.')
        expect(q<HTMLElement>('agent-undo-note').classList.contains('lh-agent-tools-note--error')).toBe(true)
        expect(tools.text('agent-nav-label')).toBe('[ -2 ]')
        tools.noteRedone({ at: '', summary: 'Redone.', redone: true, problems: [], waiting: 1 })
        expect(tools.text('agent-nav-label')).toBe('[ -1 ]')
        tools.setChat('c2')
        expect(tools.text('agent-nav-label')).toBe('[ LIVE ]')
        expect(tools.text('agent-undo-note')).toBe('')
    })

    it('holds every tool while a pass runs', () => {
        const { tools, q } = mount()
        tools.setChat('c1')
        tools.setRunning(true)
        for (const field of ['agent-audit', 'agent-cleanup', 'agent-clone', 'agent-undo']) expect(q<HTMLButtonElement>(field).disabled, field).toBe(true)
        expect(q<HTMLButtonElement>('agent-pause').disabled).toBe(false)
        tools.setRunning(false)
        expect(q<HTMLButtonElement>('agent-audit').disabled).toBe(false)
    })

    it('words the outcomes', () => {
        expect(redoLabel(0)).toEqual({ text: '[ LIVE ]', title: 'Lorebook is at current live state' })
        expect(redoLabel(3).text).toBe('[ -3 ]')
        expect(auditOutcome({ at: '', status: 'complete', chunks: 1, done: 1, skipped: 0, summaries: [] })).toEqual({ text: 'Agent Full Audit complete (1 chunk).', error: false })
        expect(auditOutcome({ at: '', status: 'complete', chunks: 3, done: 2, skipped: 1, summaries: [] })).toEqual({ text: 'Agent Full Audit complete (3 chunks). 1 skipped while a pass was still busy.', error: true })
        expect(auditOutcome({ at: '', status: 'stopped', chunks: 3, done: 1, skipped: 0, summaries: [], reason: 'Agent Full Audit stopped after chunk 1 of 3.' })).toEqual({ text: 'Agent Full Audit stopped after chunk 1 of 3.', error: false })
        expect(auditOutcome({ at: '', status: 'nothing', chunks: 0, done: 0, skipped: 0, summaries: [], reason: 'No chat history to audit.' }).text).toBe('No chat history to audit.')
        expect(auditOutcome({ at: '', status: 'busy', chunks: 0, done: 0, skipped: 0, summaries: [] })).toEqual({ text: 'A full audit is already running on this chat.', error: true })
        expect(auditOutcome({ at: '', status: 'failed', chunks: 2, done: 0, skipped: 0, summaries: [], reason: 'host down' })).toEqual({ text: 'Agent Full Audit failed. host down', error: true })
        expect(auditOutcome({ at: '', status: 'failed', chunks: 0, done: 0, skipped: 0, summaries: [], unavailable: 'This build cannot run a full audit.' }).text).toBe('This build cannot run a full audit.')
        expect(cloneOutcome({ newPrefix: 'B', cloned: ['B_NPC'], errors: ['B_LOC: host down'] })).toEqual({ text: 'Cloned 1 lorebook → prefix "B". Name a campaign "B" in another chat and adopt them from its Lorebooks list. 1 could not be copied: B_LOC: host down', error: true })
        expect(cloneOutcome({ newPrefix: '', cloned: [], errors: [], unavailable: 'no' })).toEqual({ text: 'no', error: true })
    })
})
