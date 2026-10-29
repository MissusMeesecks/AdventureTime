import { describe, expect, it, vi } from 'vitest'

import type { AgentPassReport } from './agent-pass.js'
import { createFullAudit, type AuditProgress } from './agent-audit.js'

const report = (summary: string): AgentPassReport => ({ at: '', chatId: 'c1', prefix: 'Vell', outcome: 'committed', summary, steps: [], turnsUsed: 1, problems: [] })

function harness(over: Partial<Parameters<typeof createFullAudit>[0]> = {}) {
    const passes: Array<{ chunk: string; index: number; total: number }> = []
    const steps: Array<[string, string]> = []
    const progress: AuditProgress[] = []
    const audit = createFullAudit({
        lines: async () => [
            { name: 'Player', text: 'a'.repeat(4000) },
            { name: 'Narrator', text: 'b'.repeat(4000) },
            { name: 'Narrator', text: '```json\n[skip]' },
            { name: 'Player', text: 'c'.repeat(100) },
        ],
        tokens: async () => 4000, // limit 1000 tokens: ~4000 characters a chunk
        pass: async (_chat, _user, chunk, index, total) => { passes.push({ chunk, index, total }); return report(`wrote ${index}`) },
        running: () => false,
        cancel: () => false,
        step: () => (type, content) => { steps.push([type, content]) },
        progress: (_user, p) => { progress.push(p) },
        log: { info: () => undefined, warn: () => undefined },
        waitMs: 0,
        waits: 2,
        ...over,
    })
    return { audit, passes, steps, progress }
}

describe('the full audit (71c)', () => {
    it('cuts the chat into chunks and runs each through the pass in turn, announcing every chunk', async () => {
        const h = harness()
        const result = await h.audit.run('c1', 'u1')
        expect(result).toMatchObject({ status: 'complete', chunks: 3, done: 3, skipped: 0, summaries: ['Chunk 1: wrote 1', 'Chunk 2: wrote 2', 'Chunk 3: wrote 3'] })
        expect(h.passes.map((p) => p.chunk.slice(0, 12))).toEqual(['Player: aaaa', 'Narrator: bb', 'Player: cccc'])
        expect(h.passes.map((p) => [p.index, p.total])).toEqual([[1, 3], [2, 3], [3, 3]])
        expect(h.steps).toEqual([
            ['thought', 'Agent Full Audit: Chunk 1 of 3...'], ['thought', 'Agent Full Audit: Chunk 2 of 3...'], ['thought', 'Agent Full Audit: Chunk 3 of 3...'],
            ['finish', 'Agent Full Audit complete (3 chunks).'],
        ])
        expect(h.progress.map((p) => `${p.chunk}/${p.total} ${p.status}`)).toEqual(['1/3 running', '1/3 done', '2/3 running', '2/3 done', '3/3 running', '3/3 done'])
        expect(h.audit.running('c1')).toBe(false)
    })

    it('says when there is nothing to audit', async () => {
        const h = harness({ lines: async () => [{ name: 'Narrator', text: '  ' }] })
        expect(await h.audit.run('c1', 'u1')).toMatchObject({ status: 'nothing', chunks: 0, reason: 'No chat history to audit.' })
        expect(h.passes).toEqual([])
    })

    it('waits on a running pass, then skips the chunk as the legacy does', async () => {
        // Busy through the two waits and the check after them; free from the next chunk on.
        let calls = 0
        const h = harness({ running: () => ++calls <= 4 })
        const result = await h.audit.run('c1', 'u1')
        expect(result).toMatchObject({ status: 'complete', chunks: 3, done: 2, skipped: 1 })
        expect(h.passes.map((p) => p.index)).toEqual([2, 3])
        expect(h.steps[1]).toEqual(['error', 'Chunk 1 skipped — agent was still busy.'])
        expect(h.progress[1]).toMatchObject({ chunk: 1, status: 'skipped' })
    })

    it('stops after the chunk in flight when asked, and refuses a second audit while one runs', async () => {
        const h = harness()
        let stopped: boolean | null = null
        let second: Awaited<ReturnType<typeof h.audit.run>> | null = null
        h.passes.length = 0
        const audit = createFullAudit({
            lines: async () => [{ name: 'Player', text: 'a'.repeat(4000) }, { name: 'Narrator', text: 'b'.repeat(4000) }],
            tokens: async () => 4000,
            pass: async (_c, _u, _chunk, index) => {
                if (index === 1) { second = await audit.run('c1', 'u1'); stopped = audit.stop('c1') }
                return report(`wrote ${index}`)
            },
            running: () => false,
            cancel: () => false,
            step: () => () => undefined,
            log: { info: () => undefined, warn: () => undefined },
            waitMs: 0,
        })
        const result = await audit.run('c1', 'u1')
        expect(second).toMatchObject({ status: 'busy' })
        expect(stopped).toBe(true)
        expect(result).toMatchObject({ status: 'stopped', chunks: 2, done: 1, reason: 'Agent Full Audit stopped after chunk 1 of 2.' })
        expect(audit.stop('c1')).toBe(false)
    })

    it('stops the chunk in flight through the agent’s cancel and ends the audit with it (71c-bis)', async () => {
        const cancelled: string[] = []
        let audit: ReturnType<typeof createFullAudit> | null = null
        const h = harness({
            cancel: (chatId) => { cancelled.push(chatId); return true },
            pass: async (_c, _u, _chunk, index) => {
                if (index === 2) {
                    expect(audit!.stop('c1')).toBe(true)
                    return { ...report('stopped'), outcome: 'cancelled' }
                }
                return report(`wrote ${index}`)
            },
        })
        audit = h.audit
        const result = await h.audit.run('c1', 'u1')
        expect(cancelled).toEqual(['c1'])
        expect(result).toMatchObject({ status: 'stopped', chunks: 3, done: 1, summaries: ['Chunk 1: wrote 1'], reason: 'Agent Full Audit stopped after chunk 1 of 3.' })
        expect(h.steps.at(-1)).toEqual(['error', 'Agent Full Audit stopped after chunk 1 of 3.'])
        expect(h.audit.running('c1')).toBe(false)
    })

    it('ends the audit when the agent’s own Stop ended a chunk, rather than starting the next', async () => {
        const ran: number[] = []
        const h = harness({ pass: async (_c, _u, _chunk, index) => { ran.push(index); return index === 1 ? { ...report('stopped'), outcome: 'cancelled' } : report(`wrote ${index}`) } })
        const result = await h.audit.run('c1', 'u1')
        expect(ran).toEqual([1])
        expect(result).toMatchObject({ status: 'stopped', done: 0, reason: 'Agent Full Audit stopped after chunk 0 of 3.' })
    })

    it('does not cancel a pass the audit is only waiting on, and ends the wait when stopped', async () => {
        const cancelled: string[] = []
        let audit: ReturnType<typeof createFullAudit> | null = null
        let checks = 0
        const h = harness({
            cancel: (chatId) => { cancelled.push(chatId); return true },
            running: () => { checks += 1; if (checks === 2) audit!.stop('c1'); return true },
            waits: 50,
        })
        audit = h.audit
        const result = await h.audit.run('c1', 'u1')
        expect(cancelled).toEqual([])
        expect(h.passes).toEqual([])
        expect(checks).toBeLessThan(10)
        expect(result).toMatchObject({ status: 'stopped', done: 0, skipped: 0 })
    })

    it('reports a pass that throws as a failed audit and frees the chat', async () => {
        const h = harness({ pass: async () => { throw new Error('host down') } })
        const result = await h.audit.run('c1', 'u1')
        expect(result).toMatchObject({ status: 'failed', chunks: 3, done: 0, reason: 'host down' })
        expect(h.steps.at(-1)).toEqual(['error', 'Agent Full Audit failed. host down'])
        expect(h.audit.running('c1')).toBe(false)
        vi.restoreAllMocks()
    })
})
