import { describe, expect, it, vi } from 'vitest'

import { createMapOpener, OPENER_BRIEF_REPLIES, type MapOpenerDeps } from './map-opener.js'
import { MapStore } from './map-store.js'
import type { MemoStorage } from './memo-store.js'

const BLOCK = '[CREATE_AREA_MAP]\nsite: Cellar Crypt\nentrance: Crypt Threshold\nkind: DUNGEON\nscale: SMALL\nthreat: HIGH\nprompt: A funerary complex beyond the sealed passage.\nbrief_description: A sealed funerary complex.\n[/CREATE_AREA_MAP]'
const REPLY = `The sealed passage gives way to a cold draught.\n\n${BLOCK}\n\n<choices>\n1. Go in\n</choices>`

function storage(): MemoStorage {
    const files = new Map<string, unknown>()
    return {
        async getJson<T>(path: string, options?: { fallback?: T }): Promise<T> { return (files.has(path) ? files.get(path) : options?.fallback) as T },
        async setJson(path: string, value: unknown): Promise<void> { files.set(path, JSON.parse(JSON.stringify(value))) },
    }
}

function harness(over: Partial<MapOpenerDeps> = {}, outcome: 'written' | 'failed' | 'reused' = 'written') {
    const state = new MapStore(storage())
    const edits: Array<[string, string, string]> = []
    const runs: Array<Record<string, unknown>> = []
    const logs: string[] = []
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const deps: MapOpenerDeps = {
        enabled: async () => true,
        architect: {
            run: vi.fn(async (request) => {
                runs.push(request.args)
                await gate
                const site = String(request.args.site)
                await state.save(request.chatId, { lastArchitect: { status: outcome, at: 't', site, ...(outcome === 'failed' ? { reason: 'no topology' } : {}) } }, request.userId)
                return outcome === 'written' ? `[MAP_ARCHITECT_RESULT]\nDrew ${site}` : outcome === 'reused' ? `[MAP_ARCHITECT_RESULT]\n${site} is already mapped` : `[MAP_ARCHITECT_RESULT — PRIVATE]\nMap Architect failed: no topology`
            }),
        },
        state,
        updateMessage: async (chatId, messageId, content) => { edits.push([chatId, messageId, content]) },
        log: { info: (m) => logs.push(m), warn: (m) => logs.push(`warn: ${m}`) },
        ...over,
    }
    return { opener: createMapOpener(deps), state, edits, runs, logs, release: () => release(), deps }
}

const settle = () => new Promise((r) => setTimeout(r, 0))
/** Until the drawing behind the return has written (or dropped) its brief. */
async function drawn(h: ReturnType<typeof harness>, chatId = 'c1'): Promise<void> {
    for (let i = 0; i < 50; i++) {
        await settle()
        const record = await h.state.load(chatId, 'u1')
        if (record.openerBrief !== undefined) return
        if (h.logs.some((l) => l.startsWith('warn: map: text opener failed'))) return
    }
}

describe('the Map Architect text opener (46)', () => {
    it('strips the block and everything after it from the reply, draws the site with the block\'s arguments, and briefs the narrator once drawn', async () => {
        const h = harness()
        expect(await h.opener.afterReply('c1', 'u1', 'm9', 'normal', REPLY)).toBe(true)
        expect(h.edits).toEqual([['c1', 'm9', 'The sealed passage gives way to a cold draught.']])
        expect(h.runs).toEqual([{ site: 'Cellar Crypt', entrance: 'Crypt Threshold', prompt: 'A funerary complex beyond the sealed passage.', brief_description: 'A sealed funerary complex.', kind: 'DUNGEON', scale: 'SMALL', threat: 'HIGH' }])
        // Nothing is owed until the drawing ends.
        expect((await h.state.load('c1', 'u1')).openerBrief).toBeUndefined()
        h.release()
        await drawn(h)
        const record = await h.state.load('c1', 'u1')
        expect(record.openerBrief).toContain('[MAP_ARCHITECT_RESULT — PRIVATE]')
        expect(record.openerBrief).toContain('Write only in-world narration from Crypt Threshold.')
        expect(record.openerBriefReplies).toBe(0)
        expect(h.logs.at(-1)).toBe('map: text opener drew "Cellar Crypt"; the narrator is briefed from the next turn')
    })

    it('leaves a stub when nothing stood before the block, and counts the brief down over the replies that follow', async () => {
        const h = harness()
        await h.opener.afterReply('c1', 'u1', 'm9', 'normal', BLOCK)
        expect(h.edits[0]![2]).toBe('​')
        h.release()
        await drawn(h)
        for (let shown = 1; shown < OPENER_BRIEF_REPLIES; shown++) {
            expect(await h.opener.afterReply('c1', 'u1', `m${10 + shown}`, 'normal', 'The crypt is quiet.')).toBe(false)
            expect((await h.state.load('c1', 'u1')).openerBriefReplies).toBe(shown)
        }
        await h.opener.afterReply('c1', 'u1', 'm20', 'normal', 'Still quiet.')
        const record = await h.state.load('c1', 'u1')
        expect(record.openerBrief).toBeUndefined()
        expect(record.openerBriefReplies).toBeUndefined()
    })

    it('hands the narrator the architect\'s own words when the site was already mapped or the drawing failed', async () => {
        const failed = harness({}, 'failed')
        await failed.opener.afterReply('c1', 'u1', 'm1', 'normal', REPLY)
        failed.release()
        await drawn(failed)
        expect((await failed.state.load('c1', 'u1')).openerBrief).toBe('[MAP_ARCHITECT_RESULT — PRIVATE]\nMap Architect failed: no topology')
        expect(failed.logs.at(-1)).toBe('map: text opener could not draw "Cellar Crypt"; the narrator is briefed from the next turn')
        const reused = harness({}, 'reused')
        await reused.opener.afterReply('c1', 'u1', 'm1', 'normal', REPLY)
        reused.release()
        await drawn(reused)
        expect((await reused.state.load('c1', 'u1')).openerBrief).toBe('[MAP_ARCHITECT_RESULT]\nCellar Crypt is already mapped')
    })

    it('does nothing for a reply without a block, a quiet or impersonated generation, or with the mapping section off', async () => {
        const h = harness()
        expect(await h.opener.afterReply('c1', 'u1', 'm1', 'normal', 'Plain prose.')).toBe(false)
        expect(await h.opener.afterReply('c1', 'u1', 'm1', 'quiet', REPLY)).toBe(false)
        expect(await h.opener.afterReply('c1', 'u1', 'm1', 'impersonate', REPLY)).toBe(false)
        const off = harness({ enabled: async () => false })
        expect(await off.opener.afterReply('c1', 'u1', 'm1', 'normal', REPLY)).toBe(false)
        expect(off.logs).toEqual(['map: text opener found a [CREATE_AREA_MAP] block for "Cellar Crypt" with the mapping section off; left as written'])
        expect(h.edits).toEqual([])
        expect(h.runs).toEqual([])
        expect(off.edits).toEqual([])
    })

    it('draws even when the reply cannot be rewritten, and says so; a drawing that throws is logged, never thrown', async () => {
        const h = harness({ updateMessage: async () => { throw new Error('read-only') } })
        expect(await h.opener.afterReply('c1', 'u1', 'm1', 'swipe', REPLY)).toBe(true)
        expect(h.logs).toContain('warn: map: text opener could not strip the block from message m1: read-only')
        expect(h.runs).toHaveLength(1)
        const broken = harness({ architect: { run: async () => { throw new Error('host down') } } })
        expect(await broken.opener.afterReply('c1', 'u1', 'm1', 'normal', REPLY)).toBe(true)
        await drawn(broken)
        expect(broken.logs.at(-1)).toBe('warn: map: text opener failed for "Cellar Crypt": host down')
        expect((await broken.state.load('c1', 'u1')).openerBrief).toBeUndefined()
    })
})

describe('an offsite attachment through the text opener (58)', () => {
    it('strips the block and draws the child inside its parent, and seeds no brief, since the party is where it was', async () => {
        const block = '[CREATE_AREA_MAP]\nsite: Old Mill\nentrance: Mill Door\nkind: INTERIOR\nscale: SMALL\nthreat: LOW\nprompt: A disused mill.\nbrief_description: A mill.\nattach_to_site: Elmridge\nattach_to_cell: Mill Row\n[/CREATE_AREA_MAP]'
        const h = harness()
        expect(await h.opener.afterReply('c1', 'u1', 'm9', 'normal', `The miller waves.\n\n${block}`)).toBe(true)
        expect(h.edits).toEqual([['c1', 'm9', 'The miller waves.']])
        expect(h.runs[0]).toMatchObject({ site: 'Old Mill', attachTo: { site: 'Elmridge', cell: 'Mill Row' } })
        h.release()
        for (let i = 0; i < 20 && !h.logs.some((l) => l.includes('offsite attachment')); i++) await settle()
        expect((await h.state.load('c1', 'u1')).openerBrief).toBeUndefined()
        expect(h.logs.at(-1)).toBe('map: text opener completed an offsite attachment of "Old Mill"; the narrator needs no brief')
    })
})
