import { describe, expect, it } from 'vitest'

import { createCampaignBooks, type CampaignBooksDeps } from './campaign-books.js'

function harness(over: Partial<CampaignBooksDeps> & { attach?: boolean; target?: 'chat' | 'card'; world?: boolean; owned?: string[]; cardBooks?: string[]; chatBooks?: unknown; bookList?: Array<{ id: string; name: string }>; globals?: string[]; personaBook?: string | null } = {}) {
    const { attach, target, world, owned, cardBooks, chatBooks, bookList, globals, personaBook, ...rest } = over
    let cardIds: string[] = cardBooks ?? ['b-npc']
    // The chat's record as the host keeps it: other keys of its own, and the attachment list under the found key.
    let metadata: Record<string, unknown> = { wi_state: { x: 1 }, ...(chatBooks === undefined ? {} : { chat_world_book_ids: chatBooks }) }
    const calls: unknown[][] = []
    const log: string[] = []
    const deps: CampaignBooksDeps = {
        prefs: { load: async () => ({ campaignNames: { 'chat-1': 'Vellmoor' }, campaignBooks: { 'chat-1': owned ?? ['Vellmoor_NPC', 'Vellmoor_LOC', 'Vellmoor_Journey'] }, ...(attach === undefined ? {} : { attachBooksToCard: attach }), ...(target === undefined ? {} : { attachBooksTarget: target }), ...(world === undefined ? {} : { worldProgressionEnabled: world }) }) },
        // The stock WORLD module switched on (55-quater): World Progression's book, listed with the world's and never as `_WORLD`.
        settings: { load: async () => ({ routerModules: { npc: { enabled: true, tag: 'NPC' }, loc: { enabled: true, tag: 'LOC' }, fac: { enabled: false, tag: 'FAC' }, quest: { enabled: true, tag: 'QUEST' }, world: { enabled: true, tag: 'WORLD' } }, routerCustomTags: [{ tag: 'Lore', instruction: 'x' }, { tag: ' ', instruction: 'y' }] }) },
        books: () => ({ listBooks: async () => bookList ?? [{ id: 'b-npc', name: 'Vellmoor_NPC' }, { id: 'b-loc', name: 'Vellmoor_LOC' }, { id: 'b-j', name: 'Vellmoor_Journey' }, { id: 'b-other', name: 'Other_NPC' }, { id: 'b-sk', name: 'Vellmoor_Skeleton' }] }),
        chats: {
            get: async () => ({ characterId: 'card-1', metadata: { ...metadata } }),
            setMetadata: async (chatId, next) => { calls.push(['setMetadata', chatId, next]); metadata = { ...next } },
        },
        characters: {
            get: async (id) => ({ id, name: 'Vell Keeper', worldBookIds: [...cardIds] }),
            setWorldBooks: async (id, ids) => { calls.push(['setWorldBooks', id, ids]); cardIds = [...ids] },
        },
        persona: async () => ({ attachedWorldBookId: personaBook ?? null }),
        global: async () => globals ?? [],
        ownership: { set: async (chatId, books) => { calls.push(['ownership', chatId, books]) } },
        log: { info: (m) => log.push(m), warn: (m) => log.push(`warn: ${m}`) },
        ...rest,
    }
    return { books: createCampaignBooks(deps), calls, log, cardIds: () => cardIds, metadata: () => metadata }
}

describe('the campaign’s lorebooks and their attachment (55)', () => {
    it('lists the expected books in order — the enabled modules, LOC, the custom tags, the world’s when in play — then the owned extras, each missing, attached or detached, with the card', async () => {
        const { books } = harness({ owned: ['Vellmoor_NPC', 'Vellmoor_LOC', 'Vellmoor_Journey', 'Vellmoor_Skeleton'], globals: ['b-j'] })
        const result = await books.status('chat-1', 'u1')
        expect(result.prefix).toBe('Vellmoor')
        expect(result.card).toEqual({ id: 'card-1', name: 'Vell Keeper' })
        // The target is the chat unless the preference names the card (55-ter), and the chat's record is writable here.
        expect(result.target).toBe('chat')
        expect(result.chatScope).toBe(true)
        expect((await harness({ target: 'card' }).books.status('chat-1', 'u1')).target).toBe('card')
        expect(result.books).toEqual([
            { kind: 'NPC', name: 'Vellmoor_NPC', id: 'b-npc', state: 'attached', sources: ['character'] },
            { kind: 'LOC', name: 'Vellmoor_LOC', id: 'b-loc', state: 'detached', sources: [] },
            { kind: 'QUEST', name: 'Vellmoor_QUEST', id: null, state: 'missing', sources: [] },
            { kind: 'Lore', name: 'Vellmoor_Lore', id: null, state: 'missing', sources: [] },
            // Skeleton exists, so it is listed; World does not and the switch is off, so it is not.
            { kind: 'Skeleton', name: 'Vellmoor_Skeleton', id: 'b-sk', state: 'detached', sources: [] },
            { kind: 'Journey', name: 'Vellmoor_Journey', id: 'b-j', state: 'attached', sources: ['global'] },
        ])
        // A book named as the campaign's that no chat of ours made (56): a fork's, or a hand-typed prefix's. Adoptable, listed in its expected place or after, with its sources read.
        const fork = harness({ owned: [], chatBooks: ['b-npc'] })
        const rows = (await fork.books.status('chat-1', 'u1')).books
        expect(rows.find((b) => b.kind === 'NPC')).toEqual({ kind: 'NPC', name: 'Vellmoor_NPC', id: 'b-npc', state: 'adoptable', sources: ['chat', 'character'] })
        expect(rows.find((b) => b.kind === 'LOC')).toMatchObject({ state: 'adoptable' })
        expect(rows.find((b) => b.kind === 'Journey')).toEqual({ kind: 'Journey', name: 'Vellmoor_Journey', id: 'b-j', state: 'adoptable', sources: [] })
        expect(rows.find((b) => b.name === 'Other_NPC')).toBeUndefined()
        expect(result.problem).toBeUndefined()
        // World Progression on: both world books are expected, made or not.
        const withWorld = await harness({ world: true }).books.status('chat-1', 'u1')
        expect(withWorld.books.map((b) => b.kind)).toEqual(['NPC', 'LOC', 'QUEST', 'Lore', 'World', 'Skeleton', 'Journey'])
        expect(withWorld.books.find((b) => b.kind === 'World')).toMatchObject({ state: 'missing', id: null })
        // The Skeleton book exists under the prefix and is not owned: adoptable since 56, not missing.
        expect(withWorld.books.find((b) => b.kind === 'Skeleton')).toMatchObject({ state: 'adoptable', id: 'b-sk' })
    })

    it('names every source — the chat, the card, the persona, the global list — and says what could not be read without failing', async () => {
        const { books } = harness({ personaBook: 'b-loc', globals: ['b-loc'], cardBooks: ['b-loc'], chatBooks: ['b-loc'] })
        const result = await books.status('chat-1', 'u1')
        expect(result.books.find((b) => b.kind === 'LOC')).toMatchObject({ state: 'attached', sources: ['chat', 'character', 'persona', 'global'] })
        const blind = harness({ chats: undefined, persona: async () => { throw new Error('no persona') }, global: async () => { throw new Error('PERMISSION_DENIED') } })
        const unseen = await blind.books.status('chat-1', 'u1')
        expect(unseen.card).toBeNull()
        expect(unseen.chatScope).toBe(false)
        expect(unseen.books.find((b) => b.kind === 'NPC')).toMatchObject({ state: 'detached', sources: [] })
        expect(unseen.problem).toBe('this build cannot read the chat’s record: the host has not granted the chats permission; the persona could not be read: no persona; the global lorebooks could not be read: PERMISSION_DENIED')
        // The chat's record read but its list in a shape this build does not know: not writable, and said; a read that failed, the same.
        const odd = await harness({ chatBooks: 'b-loc' }).books.status('chat-1', 'u1')
        expect(odd.chatScope).toBe(false)
        expect(odd.problem).toBe('the chat\'s record holds chat_world_book_ids in a shape this build does not know')
        expect(odd.books.find((b) => b.kind === 'NPC')).toMatchObject({ sources: ['character'] })
        const gone = await harness({ chats: { get: async () => null, setMetadata: async () => undefined } }).books.status('chat-1', 'u1')
        expect(gone.chatScope).toBe(false)
        expect(gone.problem).toBe('the chat’s record is not known to the host')
        const down = await harness({ chats: { get: async () => { throw new Error('boom') }, setMetadata: async () => undefined } }).books.status('chat-1', 'u1')
        expect(down.problem).toContain('the chat\'s record could not be read: boom')
        // A record with no write: readable, not attachable from here.
        expect((await harness({ chats: { get: async () => ({ characterId: 'card-1', metadata: {} }) } }).books.status('chat-1', 'u1')).chatScope).toBe(false)
        const deaf = harness({ books: () => ({ listBooks: async () => { throw new Error('the host is down') } }) })
        const nothing = await deaf.books.status('chat-1', 'u1')
        expect(nothing.books.every((b) => b.state === 'missing')).toBe(true)
        expect(nothing.problem).toBe('the lorebooks could not be listed: the host is down')
    })

    it('writes what the chat’s record holds to the log on the fold’s own read (71d-bis): the found key’s books by name, the other keys, and any other list of names; a plain read writes nothing', async () => {
        const h = harness({ chatBooks: ['b-loc', 'b-gone'], chats: {
            get: async () => ({ characterId: 'card-1', metadata: { wi_state: { x: 1 }, chat_world_book_ids: ['b-loc', 'b-gone'], chat_variables: {}, lore_books: ['b-npc'], empty: [] } }),
            setMetadata: async () => undefined,
        } })
        await h.books.status('chat-1', 'u1')
        expect(h.log).toEqual([])
        await h.books.status('chat-1', 'u1', { report: true })
        expect(h.log).toEqual(['books: the chat\'s record holds chat_world_book_ids: "Vellmoor_LOC", "(b-gone: no such book)"; its other metadata keys: wi_state, chat_variables, lore_books, empty; other lists of names in it: lore_books: "Vellmoor_NPC"'])
        const bare = harness({ chats: { get: async () => ({ characterId: 'card-1', metadata: {} }), setMetadata: async () => undefined } })
        await bare.books.status('chat-1', 'u1', { report: true })
        expect(bare.log).toEqual(['books: the chat\'s record holds chat_world_book_ids: nothing; its other metadata keys: none'])
        const blind = harness({ chats: { get: async () => null, setMetadata: async () => undefined } })
        await blind.books.status('chat-1', 'u1', { report: true })
        expect(blind.log).toEqual(['books: the chat\'s record could not be read for what it holds: the chat’s record is not known to the host'])
    })

    it('attaches one book or every detached one to the chat’s record (55-ter), additively and with the host’s other keys kept, logs it, and refuses what it cannot', async () => {
        const one = harness({ chatBooks: ['b-x'] })
        const after = await one.books.attach('chat-1', 'u1', 'b-loc')
        // The record written whole: the host's own key as read, the list with the book added.
        expect(one.calls).toEqual([['setMetadata', 'chat-1', { wi_state: { x: 1 }, chat_world_book_ids: ['b-x', 'b-loc'] }]])
        expect(after.books.find((b) => b.kind === 'LOC')).toMatchObject({ state: 'attached', sources: ['chat'] })
        expect(one.log).toEqual(['books: attached "Vellmoor_LOC" to the chat on request'])
        // Already attached: nothing written, nothing logged.
        await one.books.attach('chat-1', 'u1', 'b-loc')
        expect(one.calls).toHaveLength(1)
        // No list on the record yet: made, with everything detached in it.
        const fresh = harness()
        await fresh.books.attach('chat-1', 'u1')
        expect(fresh.calls).toEqual([['setMetadata', 'chat-1', { wi_state: { x: 1 }, chat_world_book_ids: ['b-loc', 'b-j'] }]])
        expect(fresh.metadata().chat_world_book_ids).toEqual(['b-loc', 'b-j'])
        await expect(harness().books.attach('chat-1', 'u1', 'b-other')).rejects.toThrow(/not one of this campaign/)
        await expect(harness({ chats: undefined }).books.attach('chat-1', 'u1', 'b-loc')).rejects.toThrow(/has not granted the chats permission/)
        await expect(harness({ chats: { get: async () => null, setMetadata: async () => undefined } }).books.attach('chat-1', 'u1', 'b-loc')).rejects.toThrow(/record is not known to the host/)
        await expect(harness({ chatBooks: { a: 1 } }).books.attach('chat-1', 'u1', 'b-loc')).rejects.toThrow(/a shape this build does not know/)
        // A book attached to the card by hand before 55-ter reads attached, by the card; asked for by name it is attached to the chat as well, additively.
        const kept = harness({ cardBooks: ['b-npc', 'b-loc'] })
        expect((await kept.books.status('chat-1', 'u1')).books.find((b) => b.kind === 'LOC')).toMatchObject({ state: 'attached', sources: ['character'] })
        expect((await kept.books.attach('chat-1', 'u1', 'b-loc')).books.find((b) => b.kind === 'LOC')).toMatchObject({ state: 'attached', sources: ['chat', 'character'] })
        expect(kept.calls).toEqual([['setMetadata', 'chat-1', { wi_state: { x: 1 }, chat_world_book_ids: ['b-loc'] }]])
    })

    it('adopts a book named as the campaign’s on request (56): recorded as owned, never on its name alone; refuses one not so named, or owned already', async () => {
        const fork = harness({ owned: [] })
        const after = await fork.books.adopt('chat-1', 'u1', 'b-npc')
        expect(fork.calls).toEqual([['ownership', 'chat-1', ['Vellmoor_NPC']]])
        expect(fork.log).toEqual(['books: adopted "Vellmoor_NPC" as the campaign’s on request'])
        // The status after is read again; the fake's ownership is not a store, so the row still reads adoptable here — the backend's record is.
        expect(after.books.find((b) => b.kind === 'NPC')).toMatchObject({ id: 'b-npc' })
        await expect(harness({ owned: [] }).books.adopt('chat-1', 'u1', 'b-other')).rejects.toThrow(/not named as this campaign/)
        await expect(harness().books.adopt('chat-1', 'u1', 'b-npc')).rejects.toThrow(/this campaign’s already/)
        await expect(harness({ owned: [], ownership: undefined }).books.adopt('chat-1', 'u1', 'b-npc')).rejects.toThrow(/cannot adopt/)
        // The sweep leaves an adoptable book alone: it is not detached.
        const left = harness({ owned: [] })
        await left.books.sweep('chat-1', 'u1')
        expect(left.calls).toEqual([])
    })

    it('attaches to the card instead when the preference names it (55), additively, and refuses what it cannot', async () => {
        const one = harness({ target: 'card' })
        const after = await one.books.attach('chat-1', 'u1', 'b-loc')
        expect(one.calls).toEqual([['setWorldBooks', 'card-1', ['b-npc', 'b-loc']]])
        expect(after.books.find((b) => b.kind === 'LOC')).toMatchObject({ state: 'attached', sources: ['character'] })
        expect(one.log).toEqual(['books: attached "Vellmoor_LOC" to the card "Vell Keeper" on request'])
        await one.books.attach('chat-1', 'u1', 'b-npc')
        expect(one.calls).toHaveLength(1)
        const all = harness({ target: 'card', owned: ['Vellmoor_NPC', 'Vellmoor_LOC', 'Vellmoor_Journey', 'Vellmoor_Skeleton'] })
        const everything = await all.books.attach('chat-1', 'u1')
        expect(all.calls).toEqual([['setWorldBooks', 'card-1', ['b-npc', 'b-loc', 'b-sk', 'b-j']]])
        expect(everything.books.filter((b) => b.id).every((b) => b.state === 'attached')).toBe(true)
        await expect(harness({ target: 'card', characters: undefined }).books.attach('chat-1', 'u1', 'b-loc')).rejects.toThrow(/has not granted the characters permission/)
        await expect(harness({ target: 'card', chats: { get: async () => null } }).books.attach('chat-1', 'u1', 'b-loc')).rejects.toThrow(/card is not known/)
    })

    it('sweeps as a book is made when the preference says: attaches what is detached where the target says; off, or with nowhere to write, or on a failure, it says so and never throws', async () => {
        const on = harness()
        await on.books.sweep('chat-1', 'u1')
        // The Skeleton book is only adoptable by its prefix, not owned, so it is not the sweep's to attach.
        expect(on.calls).toEqual([['setMetadata', 'chat-1', { wi_state: { x: 1 }, chat_world_book_ids: ['b-loc', 'b-j'] }]])
        expect(on.log).toEqual(['books: attached "Vellmoor_LOC", "Vellmoor_Journey" to the chat as they were made'])
        // Nothing detached: nothing written.
        await on.books.sweep('chat-1', 'u1')
        expect(on.calls).toHaveLength(1)
        const card = harness({ target: 'card' })
        await card.books.sweep('chat-1', 'u1')
        expect(card.calls).toEqual([['setWorldBooks', 'card-1', ['b-npc', 'b-loc', 'b-j']]])
        expect(card.log).toEqual(['books: attached "Vellmoor_LOC", "Vellmoor_Journey" to the card "Vell Keeper" as they were made'])
        const off = harness({ attach: false })
        await off.books.sweep('chat-1', 'u1')
        expect(off.calls).toEqual([])
        const nowhere = harness({ chatBooks: 'odd' })
        await nowhere.books.sweep('chat-1', 'u1')
        expect(nowhere.calls).toEqual([])
        expect(nowhere.log).toEqual(['warn: books: 2 of the campaign\'s books are not attached and the chat\'s record cannot be written; nothing attached'])
        const nobody = harness({ target: 'card', chats: { get: async () => null, setMetadata: async () => undefined } })
        await nobody.books.sweep('chat-1', 'u1')
        expect(nobody.calls).toEqual([])
        expect(nobody.log).toEqual(['warn: books: 3 of the campaign\'s books are not attached and the chat\'s card is not known; nothing attached'])
        const broken = harness({ chats: { get: async () => ({ characterId: 'card-1', metadata: {} }), setMetadata: async () => { throw new Error('PERMISSION_DENIED') } } })
        await broken.books.sweep('chat-1', 'u1')
        expect(broken.log.at(-1)).toBe('warn: books: the campaign\'s books could not be attached: PERMISSION_DENIED')
    })
})

describe('every book the host would scan for the chat (73h-bis)', () => {
    it('joins the chat’s record, the card, the persona and the global list, any book, each once', async () => {
        const { books } = harness({ chatBooks: ['b-x', 'b-n'], cardBooks: ['b-n', 'b-c'], personaBook: 'b-p', globals: ['b-g', 'b-x'] })
        expect((await books.attached('chat-1', 'u1')).sort()).toEqual(['b-c', 'b-g', 'b-n', 'b-p', 'b-x'])
    })

    it('skips a source that cannot be read, names it, and answers with the rest', async () => {
        const { books, log } = harness({ chatBooks: 'not-a-list', cardBooks: ['b-c'], persona: async () => { throw new Error('no persona') }, globals: ['b-g'] })
        expect((await books.attached('chat-1', 'u1')).sort()).toEqual(['b-c', 'b-g'])
        expect(log).toEqual([
            expect.stringContaining('warn: books: the chat\'s own attachments could not be read'),
            'warn: books: the persona could not be read for its book: no persona',
        ])
    })
})
