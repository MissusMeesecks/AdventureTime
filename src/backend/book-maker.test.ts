import { describe, expect, it } from 'vitest'

import { createBookMaker } from './book-maker.js'

function harness(initial: Array<{ id: string; name: string }> = []) {
    const books = [...initial]
    const log: string[] = []
    let creates = 0
    let gate: (() => void) | null = null
    const maker = createBookMaker({
        list: async () => [...books],
        create: async (name) => {
            creates++
            // A create that waits until the test lets it through, so two callers can overlap.
            await new Promise<void>((resolve) => { gate = resolve })
            if (name === 'Broken_LOC') throw new Error('the host refused')
            const made = { id: `b${creates}`, name }
            books.push(made)
            return made
        },
        log: { info: (m) => log.push(m) },
    })
    const release = () => { gate?.(); gate = null }
    return { maker, books, log, creates: () => creates, release }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('a book made once (66)', () => {
    it('makes a name once when two callers ask inside one make', async () => {
        const h = harness()
        const first = h.maker('Vell_LOC', 'u1')
        await tick()
        const second = h.maker('Vell_LOC', 'u1')
        h.release()
        const [a, b] = await Promise.all([first, second])
        expect(a).toEqual({ id: 'b1', name: 'Vell_LOC' })
        expect(b).toBe(a)
        expect(h.creates()).toBe(1)
    })

    it('lists afresh before creating, so a caller with a stale list gets the book made meanwhile', async () => {
        const h = harness([{ id: 'agent-made', name: 'Vell_LOC' }])
        const got = h.maker('vell_loc', 'u1')
        await tick()
        h.release()
        expect(await got).toEqual({ id: 'agent-made', name: 'Vell_LOC' })
        expect(h.creates()).toBe(0)
        expect(h.log).toEqual(['books: "Vell_LOC" was made meanwhile; not made again'])
    })

    it('makes the book when none is listed, and a second ask after it finishes finds it', async () => {
        const h = harness()
        const first = h.maker('Vell_NPC', 'u1')
        await tick()
        h.release()
        expect(await first).toEqual({ id: 'b1', name: 'Vell_NPC' })
        const again = h.maker('Vell_NPC', 'u1')
        await tick()
        h.release()
        expect(await again).toEqual({ id: 'b1', name: 'Vell_NPC' })
        expect(h.creates()).toBe(1)
    })

    it('keeps two names, and two users, apart', async () => {
        const h = harness()
        const a = h.maker('Vell_LOC', 'u1')
        await tick()
        h.release()
        await a
        const b = h.maker('Vell_NPC', 'u1')
        await tick()
        h.release()
        await b
        const c = h.maker('Vell_LOC', 'u2')
        await tick()
        h.release()
        // Another user's list is the same here, so the book is found; the lock was not shared.
        await c
        expect(h.creates()).toBe(2)
    })

    it('lets a failed make go, so the next ask tries again', async () => {
        const h = harness()
        const first = h.maker('Broken_LOC', 'u1')
        await tick()
        h.release()
        await expect(first).rejects.toThrow('the host refused')
        const second = h.maker('Broken_LOC', 'u1')
        await tick()
        h.release()
        await expect(second).rejects.toThrow('the host refused')
        expect(h.creates()).toBe(2)
    })
})
