import { describe, expect, it, vi } from 'vitest'

import { createWorldLoreReader } from './world-lore.js'

function harness(opts: { inject?: boolean; filter?: string[]; broken?: string; attached?: string[] } = {}) {
    const log = { info: vi.fn(), warn: vi.fn() }
    const entries: Record<string, Array<{ id: string; content: string; disabled: boolean }>> = {
        b1: [{ id: 'e1', content: 'A keep on the moor.', disabled: false }, { id: 'e2', content: 'Hidden.', disabled: true }, { id: 'e3', content: '', disabled: false }],
        b2: [{ id: 'e4', content: 'A ferryman named Oss.', disabled: false }],
        b3: [{ id: 'e5', content: 'Shared canon.', disabled: false }],
    }
    const listed: string[] = []
    let attachedAsked = 0
    const reader = createWorldLoreReader({
        prefs: async () => ({ inject: opts.inject ?? true, filter: opts.filter ?? [] }),
        attached: async () => { attachedAsked += 1; return opts.attached ?? ['b1', 'b2', 'b3'] },
        store: () => ({
            listBooks: async () => [{ id: 'b1', name: 'Vell_NPC' }, { id: 'b2', name: 'Vell_LOC' }, { id: 'b3', name: 'Shared' }],
            listEntries: async (bookId) => {
                listed.push(bookId)
                if (bookId === opts.broken) throw new Error('book gone')
                return entries[bookId]!.map((e) => ({ ...e, uid: e.id, key: [], comment: '', extensions: {}, constant: false }))
            },
        }),
        log,
    })
    return { reader, log, listed, attachedAsked: () => attachedAsked }
}

describe('the lorebooks read for the tracker (73h)', () => {
    it('reads every enabled entry with content of the books linked to the chat when the filter is empty, and says so (73h-bis)', async () => {
        const h = harness()
        expect(await h.reader('c1', 'u1')).toBe('## WORLD LORE (This chat’s books)\nA keep on the moor.\n---\nA ferryman named Oss.\n---\nShared canon.')
        expect(h.listed).toEqual(['b1', 'b2', 'b3'])
        expect(h.attachedAsked()).toBe(1)
        expect(h.log.info).toHaveBeenCalledWith('tracker pass for chat c1: 3 lore entries of 3 books sent as world lore (the 3 books linked to this chat)')
        // Only the linked ones, never the whole library; a chat with none linked sends nothing.
        const some = harness({ attached: ['b3'] })
        expect(await some.reader('c1', 'u1')).toBe('## WORLD LORE (This chat’s books)\nShared canon.')
        expect(some.listed).toEqual(['b3'])
        const none = harness({ attached: [] })
        expect(await none.reader('c1', 'u1')).toBe('')
        expect(none.listed).toEqual([])
        expect(none.log.info).toHaveBeenCalledWith('tracker pass for chat c1: 0 lore entries of 0 books sent as world lore (the 0 books linked to this chat)')
    })

    it('reads the filtered books alone, by name, in the host’s order, the chat’s links not asked for', async () => {
        const h = harness({ filter: ['Shared', 'Vell_NPC'], attached: ['b2'] })
        expect(await h.reader('c1', 'u1')).toBe('## WORLD LORE (Filtered: Shared, Vell_NPC)\nA keep on the moor.\n---\nShared canon.')
        expect(h.listed).toEqual(['b1', 'b3'])
        expect(h.attachedAsked()).toBe(0)
        expect(h.log.info).toHaveBeenCalledWith('tracker pass for chat c1: 2 lore entries of 2 books sent as world lore (filtered: Shared, Vell_NPC)')
    })

    it('sends nothing with the switch off, reading no book', async () => {
        const h = harness({ inject: false })
        expect(await h.reader('c1', 'u1')).toBe('')
        expect(h.listed).toEqual([])
        expect(h.log.info).not.toHaveBeenCalled()
    })

    it('skips a book that cannot be read, names it, and sends the rest', async () => {
        const h = harness({ broken: 'b2' })
        expect(await h.reader('c1', 'u1')).toBe('## WORLD LORE (This chat’s books)\nA keep on the moor.\n---\nShared canon.')
        expect(h.log.warn).toHaveBeenCalledWith('tracker: the lorebook "Vell_LOC" could not be read for the world lore: book gone')
        expect(h.log.info).toHaveBeenCalledWith('tracker pass for chat c1: 2 lore entries of 2 books sent as world lore (the 3 books linked to this chat)')
    })
})
