import { describe, expect, it, vi } from 'vitest'

import type { LoreBook, LoreEntry, LoreStore } from '../agent/writer.js'
import type { LorePassSnapshot } from '../agent/undo.js'
import type { AgentPassDeps } from './agent-pass.js'
import { createAutoCleanup, runCleanupPass } from './agent-cleanup.js'

function makeStore(seed: Record<string, Array<Partial<LoreEntry>>> = {}) {
    const books: LoreBook[] = []
    const entries = new Map<string, LoreEntry[]>()
    let n = 1
    for (const [name, list] of Object.entries(seed)) {
        const book = { id: `b${books.length + 1}`, name }
        books.push(book)
        entries.set(book.id, list.map((entry, i) => ({ id: `e${n++}`, uid: entry.uid ?? String(i + 1), key: entry.key ?? [], content: entry.content ?? '', comment: entry.comment ?? '' })))
    }
    const store: LoreStore = {
        listBooks: async () => books.map((b) => ({ ...b })),
        createBook: async (name) => { const book = { id: `b${books.length + 1}`, name }; books.push(book); entries.set(book.id, []); return { ...book } },
        listEntries: async (id) => (entries.get(id) ?? []).map((e) => ({ ...e })),
        createEntry: async (id, entry) => { const list = entries.get(id)!; const made = { id: `e${n++}`, uid: String(list.length + 1), ...entry }; list.push(made); return { ...made } },
        updateEntry: async (id, patch) => { for (const list of entries.values()) { const found = list.find((e) => e.id === id); if (found) Object.assign(found, patch) } },
        deleteEntry: async (id) => { for (const [bookId, list] of entries) entries.set(bookId, list.filter((e) => e.id !== id)) },
    }
    return { store, entriesOf: (name: string) => entries.get(books.find((b) => b.name === name)!.id)! }
}

const LONG = `[Day 1] Bram the smith keeps the forge by the gate.\n${'[Day 2] Bram the smith keeps the forge by the gate still.\n'.repeat(30)}`

function deps(replies: string[], seed: Record<string, Array<Partial<LoreEntry>>>, over: Partial<AgentPassDeps> = {}) {
    let index = 0
    const owned = Object.keys(seed).filter((name) => name.startsWith('Vell'))
    const steps: Array<[string, string]> = []
    const generated: Array<Array<{ role: string; content: string }>> = []
    const passes: LorePassSnapshot[] = []
    const made = makeStore(seed)
    const d: AgentPassDeps = {
        store: made.store,
        generate: vi.fn(async (messages: Array<{ role: string; content: string }>) => { generated.push(messages.map((m) => ({ role: m.role, content: m.content }))); return replies[Math.min(index++, replies.length - 1)]! }),
        narrative: async () => 'unused',
        ownership: {
            get: async () => [...owned],
            set: async (_c, books) => { owned.length = 0; owned.push(...books) },
            made: async (_c, names) => { for (const name of names) if (!owned.includes(name)) owned.push(name) },
            others: async () => ['Other_NPC'],
        },
        campaign: { override: 'Vell', anchorChatId: 'chat-1' },
        history: { record: async (_c, s) => { passes.unshift(s) }, latest: async () => passes[0] ?? null, drop: async () => { passes.shift() } },
        step: (type, content) => { steps.push([type, content]) },
        watermark: 7,
        ...over,
    }
    return { deps: d, steps, generated, passes, ...made }
}

describe('the cleanup pass (71c)', () => {
    it('shows the archivist the bloated entries whole and applies its rewrite, [CORE] kept, undoable', async () => {
        const h = deps(
            ['Thought: verbose.\nAction: commit({"rewrite": [{"id": "Vell_NPC::1", "content": "[Day 1] Bram the smith keeps the forge by the gate; so he has every day since."}]})'],
            { Vell_NPC: [{ uid: '1', content: `[CORE]\nSpecies: Human\n[/CORE]\n${LONG}`, comment: 'Bram' }, { uid: '2', content: 'short', comment: 'Ivo' }], Vell_World: [{ uid: 'w', content: LONG }], Other_NPC: [{ uid: 'o', content: LONG }] },
        )
        const report = await runCleanupPass('chat-1', 'u1', h.deps, { threshold: 300, useThreshold: true, instructions: 'keep the dates' })
        expect(report.outcome).toBe('committed')
        expect(report.summary).toBe('Cleanup pass (agent mode). 1 rewritten.')
        expect(h.generated[0]![0]!.content).toContain('## USER CUSTOM REQUIREMENTS\nYou MUST adhere strictly to these custom compression instructions:\n- keep the dates')
        expect(h.generated[0]![1]!.content).toMatch(/^## ENTRIES FLAGGED FOR CONSOLIDATION\n- Vell_NPC::1 \| "Bram" \| ~\d+ tokens \| \d+ lines \| ⚠ \d+ redundant line pairs\n\n## ENTRY CONTENTS\n### Vell_NPC::1 — "Bram"\n\[CORE\]/)
        expect(h.generated[0]![1]!.content).not.toContain('Ivo')
        expect(h.generated[0]![1]!.content).not.toContain('Vell_World')
        const rewritten = h.entriesOf('Vell_NPC')[0]!.content
        expect(rewritten.startsWith('[CORE]\nSpecies: Human\n[/CORE]')).toBe(true)
        expect(rewritten).toContain('so he has every day since')
        expect(h.steps.map(([t]) => t)).toEqual(['start', 'thought', 'thought', 'thought', 'thought', 'tool', 'finish'])
        expect(h.steps[1]![1]).toBe('Cleanup mode: scanning for bloated entries...')
        expect(h.steps[2]![1]).toBe('Cleanup: 1 bloated entry found. Requesting compression...')
        expect(h.steps.at(-1)![1]).toMatch(/^Cleanup done in \d+\.\ds\.$/)
        expect(h.passes).toHaveLength(1)
        expect(h.passes[0]!.watermark).toBe(7)
        expect(h.passes[0]!.books[0]!.entries[0]!.content).toContain(LONG.slice(0, 40))
    })

    it('cleans the one entry named whatever its size, with the targeted lines and reason', async () => {
        const h = deps(
            ['Action: commit({"rewrite": [{"id": "Vell_NPC::2", "content": "[Day 1] Ivo."}]})'],
            { Vell_NPC: [{ uid: '1', content: LONG, comment: 'Bram' }, { uid: '2', content: 'Ivo is short.', comment: 'Ivo' }] },
        )
        const report = await runCleanupPass('chat-1', 'u1', h.deps, { threshold: 300, useThreshold: true, target: 'Vell_NPC::2' })
        expect(report.summary).toBe('Targeted cleanup: Vell_NPC::2. 1 rewritten.')
        expect(h.generated[0]![1]!.content).not.toContain('Bram')
        expect(h.steps[1]![1]).toBe('Cleanup mode: targeted compression for "Vell_NPC::2"...')
        expect(h.steps[2]![1]).toBe('Cleanup: compressing target entry "Ivo"...')
        expect(h.entriesOf('Vell_NPC')[1]!.content).toBe('[Day 1] Ivo.')
    })

    it('finishes without a model call when nothing is over the threshold or the target is not there', async () => {
        const h = deps([], { Vell_NPC: [{ uid: '1', content: 'short', comment: 'Bram' }] })
        const report = await runCleanupPass('chat-1', 'u1', h.deps, { threshold: 300, useThreshold: true })
        expect(report).toMatchObject({ outcome: 'no-commit', summary: 'Cleanup: no entries exceed the token threshold (300t). Nothing to do.' })
        expect(h.deps.generate).not.toHaveBeenCalled()
        expect(h.steps.at(-1)).toEqual(['finish', 'Cleanup: no entries exceed the token threshold (300t). Nothing to do.'])
        const missing = await runCleanupPass('chat-1', 'u1', h.deps, { threshold: 300, useThreshold: true, target: 'Vell_NPC::9' })
        expect(missing.summary).toBe('Cleanup: targeted entry "Vell_NPC::9" not found.')
    })

    it('reports a model that never commits, writes nothing and records nothing', async () => {
        const h = deps(['I would rather not.'], { Vell_NPC: [{ uid: '1', content: LONG, comment: 'Bram' }] })
        const report = await runCleanupPass('chat-1', 'u1', h.deps, { threshold: 300, useThreshold: false, instructions: '' })
        expect(report.outcome).not.toBe('committed')
        expect(report.write).toBeUndefined()
        expect(h.passes).toEqual([])
        expect(h.entriesOf('Vell_NPC')[0]!.content).toBe(LONG)
        expect(h.steps.at(-1)![0]).toBe('error')
    })

    it('announces itself before any read, as a cleanup', async () => {
        const starts: unknown[] = []
        const h = deps([], { Vell_NPC: [] }, { onPassStart: (event) => { starts.push(event) } })
        await runCleanupPass('chat-1', 'u1', h.deps, { threshold: 300, useThreshold: true })
        expect(starts).toEqual([expect.objectContaining({ chatId: 'chat-1', userId: 'u1', trigger: 'cleanup' })])
        expect(h.steps[0]).toEqual(['start', 'Initializing Lorebook Agent for a cleanup…'])
    })
})

describe('the auto-cleanup after a pass (71c)', () => {
    const books = async () => [{ name: 'Vell_NPC', entries: [{ uid: '1', content: LONG }, { uid: '2', content: 'short' }] }]

    it('hints when something is bloated and runs a cleanup every Nth pass', async () => {
        vi.useFakeTimers()
        const steps: string[] = []
        const runs: string[] = []
        const auto = createAutoCleanup({
            settings: async () => ({ agentCleanupEvery: 2, agentCleanupThreshold: 300 }),
            books,
            step: () => (_type, content) => { steps.push(content) },
            run: async (chatId) => { runs.push(chatId) },
            log: { info: () => undefined, warn: () => undefined },
            delayMs: 0,
        })
        await auto.after('c1', 'u1')
        expect(steps).toEqual(['💡 1 entry may benefit from cleanup (>300 tokens). Use the 🧹 button to compress.'])
        await auto.after('c1', 'u1')
        expect(steps[1]).toBe('🧹 Auto-cleanup: 1 bloated entry found. Scheduling cleanup pass...')
        expect(runs).toEqual([])
        await vi.runAllTimersAsync()
        expect(runs).toEqual(['c1'])
        vi.useRealTimers()
    })

    it('says nothing when nothing is bloated, never runs with the dial at 0, and survives a failed read', async () => {
        const steps: string[] = []
        const runs: string[] = []
        const warnings: string[] = []
        const auto = createAutoCleanup({
            settings: async () => ({ agentCleanupEvery: 0, agentCleanupThreshold: 300 }),
            books: async () => [{ name: 'Vell_NPC', entries: [{ uid: '2', content: 'short' }] }],
            step: () => (_type, content) => { steps.push(content) },
            run: async (chatId) => { runs.push(chatId) },
            log: { info: () => undefined, warn: (m) => { warnings.push(m) } },
        })
        await auto.after('c1', 'u1')
        await auto.after('c1', 'u1')
        expect(steps).toEqual([])
        expect(runs).toEqual([])
        const broken = createAutoCleanup({ settings: async () => { throw new Error('no prefs') }, books, step: () => () => undefined, run: async () => undefined, log: { info: () => undefined, warn: (m) => { warnings.push(m) } } })
        await expect(broken.after('c1', 'u1')).resolves.toBeUndefined()
        expect(warnings[0]).toMatch(/cleanup check after the pass threw/)
    })
})
