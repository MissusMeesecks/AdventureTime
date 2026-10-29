/**
 * The campaign's lorebooks and whether the narrator can see them (Phase 55).
 *
 * A book the agent, the NPC creator, the architect or World Progression
 * makes is a world book Lumiverse scans only once it is attached to the
 * chat — to the chat's own record, to its character card, to the persona,
 * or globally — and nothing said so: a book could be made and filled for
 * an hour while the narrator saw none of it. This lists every book the
 * campaign expects (one per enabled agent module and custom tag, the
 * architect's `LOC`, World Progression's `World` and `Skeleton` when in
 * play) and every book it owns besides, each as *missing*, *attached* (and
 * by what) or *detached*; it attaches a book on request, additively, to
 * the chat's own record (55-ter: the host keeps a chat's attachments under
 * `chat_world_book_ids` in the record's metadata, found live by attaching
 * one by hand, and a card reused across campaigns then carries none of
 * them) or to the narrator's card (the `characters` grant); and, when the
 * preference says, sweeps as a book is made so it is attached at once.
 */

import { bookStanding, campaignBookName, isWorldModuleTag, resolveCampaignPrefix } from '../agent/campaign.js'
import type { CampaignBooksResult } from '../protocol.js'

/** The key the host keeps a chat's own attachments under, in the chat record's metadata (55-ter). */
export const CHAT_BOOKS_KEY = 'chat_world_book_ids'

export interface CampaignBooksDeps {
    prefs: { load(userId: string | undefined): Promise<{ campaignNames?: Record<string, string>; campaignBooks?: Record<string, string[]>; attachBooksToCard?: boolean; attachBooksTarget?: 'chat' | 'card'; worldProgressionEnabled?: boolean }> }
    /** The cartridge, for the agent's modules and custom tags. */
    settings: { load(userId: string | undefined): Promise<Record<string, unknown>> }
    books: (userId: string | undefined) => { listBooks(): Promise<Array<{ id: string; name: string }>> }
    /** The chat's record — its card and its metadata, where its own attachments live — and the write of that metadata whole (the `chats` grant); absent when missing. */
    chats?: {
        get(chatId: string, userId: string | undefined): Promise<{ characterId: string | null; metadata?: Record<string, unknown> } | null>
        setMetadata?(chatId: string, metadata: Record<string, unknown>, userId: string | undefined): Promise<unknown>
    }
    /** The narrator's card and its attachments (the `characters` grant); absent when missing. */
    characters?: {
        get(id: string, userId: string | undefined): Promise<{ id: string; name: string; worldBookIds: string[] } | null>
        setWorldBooks(id: string, worldBookIds: string[], userId: string | undefined): Promise<unknown>
    }
    /** The active persona's attached book; absent when the grant is missing. */
    persona?: (userId: string | undefined) => Promise<{ attachedWorldBookId: string | null } | null>
    /** The globally active books; absent when the host has no such list. */
    global?: (userId: string | undefined) => Promise<string[]>
    /** The record of which books the campaign owns, for Adopt (56); absent when adoption is not offered. */
    ownership?: { set(chatId: string, books: string[], userId: string | undefined): Promise<unknown> }
    log: { info(m: string): void; warn(m: string): void }
}

export interface CampaignBooks {
    /** The standing of every book; `report` writes what the chat's record holds to the log (71d-bis), for the fold's own read. */
    status(chatId: string, userId: string | undefined, options?: { report?: boolean }): Promise<CampaignBooksResult>
    /** Attach one book, or every detached one when no id is given, to the narrator's card. */
    attach(chatId: string, userId: string | undefined, bookId?: string): Promise<CampaignBooksResult>
    /** After a reply: attach what is detached, when the preference says so. Never throws. */
    sweep(chatId: string, userId: string | undefined): Promise<void>
    /** Make a book named as the campaign's, which no chat of ours made, this campaign's (56). */
    adopt(chatId: string, userId: string | undefined, bookId: string): Promise<CampaignBooksResult>
    /**
     * Every book the host would scan for the chat (73h-bis): the chat's own
     * record, its narrator's card, the persona, the global list — any book,
     * not only the campaign's. A source that cannot be read is skipped and
     * named in the log; never throws.
     */
    attached(chatId: string, userId: string | undefined): Promise<string[]>
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

/** The category a book name carries after the prefix, for a book the list did not expect. */
function kindOf(name: string, prefix: string): string {
    const root = campaignBookName(prefix, null)
    return name.toLowerCase().startsWith(`${root.toLowerCase()}_`) ? name.slice(root.length + 1) : name
}

export function createCampaignBooks(deps: CampaignBooksDeps): CampaignBooks {
    async function card(chatId: string, userId: string | undefined): Promise<{ id: string; name: string; worldBookIds: string[] } | null> {
        if (!deps.chats || !deps.characters) return null
        const chat = await deps.chats.get(chatId, userId)
        if (!chat?.characterId) return null
        return deps.characters.get(chat.characterId, userId)
    }

    /**
     * The chat's own attachments (55-ter): the record's metadata under
     * `chat_world_book_ids`, a list of book ids; absent is none. Any other
     * shape is the host's, not this build's to rewrite, and is said.
     */
    function chatBooks(metadata: Record<string, unknown> | undefined): { ids: string[]; problem?: string } {
        const value = (metadata ?? {})[CHAT_BOOKS_KEY]
        if (value === undefined || value === null) return { ids: [] }
        if (Array.isArray(value) && value.every((id) => typeof id === 'string')) return { ids: value as string[] }
        return { ids: [], problem: `the chat's record holds ${CHAT_BOOKS_KEY} in a shape this build does not know` }
    }

    /** The chat's record, read for its own attachments; `null` with the reason when it cannot be. */
    async function chatRecord(chatId: string, userId: string | undefined): Promise<{ metadata: Record<string, unknown>; ids: string[] } | { problem: string }> {
        if (!deps.chats) return { problem: 'this build cannot read the chat’s record: the host has not granted the chats permission' }
        let chat: { characterId: string | null; metadata?: Record<string, unknown> } | null
        try {
            chat = await deps.chats.get(chatId, userId)
        } catch (error) {
            return { problem: `the chat's record could not be read: ${describe(error)}` }
        }
        if (!chat) return { problem: 'the chat’s record is not known to the host' }
        const books = chatBooks(chat.metadata)
        if (books.problem) return { problem: books.problem }
        return { metadata: { ...(chat.metadata ?? {}) }, ids: books.ids }
    }

    async function status(chatId: string, userId: string | undefined, options: { report?: boolean } = {}): Promise<CampaignBooksResult> {
        const prefs = await deps.prefs.load(userId)
        const target = prefs.attachBooksTarget === 'card' ? 'card' : 'chat'
        const prefix = resolveCampaignPrefix({ chatId, override: prefs.campaignNames?.[chatId], anchorChatId: chatId })
        const owned = prefs.campaignBooks?.[chatId] ?? []
        const settings = await deps.settings.load(userId).catch(() => ({} as Record<string, unknown>))
        const problems: string[] = []

        // What the campaign expects: a book per enabled module and custom tag, the architect's and the world's.
        const expected: Array<{ kind: string; name: string }> = []
        const add = (kind: string) => {
            const name = campaignBookName(prefix, kind)
            if (!expected.some((e) => e.name.toLowerCase() === name.toLowerCase())) expected.push({ kind: name.slice(campaignBookName(prefix, null).length + 1), name })
        }
        const modules = (settings.routerModules ?? {}) as Record<string, { enabled?: boolean; tag?: string } | undefined>
        for (const [key, module] of Object.entries(modules)) {
            if (!module || module.enabled === false) continue
            const tag = String(module.tag ?? key).trim()
            // The stock WORLD module is World Progression's book here (55-quater): listed with the world's, once.
            if (tag && !isWorldModuleTag(tag)) add(tag)
        }
        add('LOC')
        for (const custom of (settings.routerCustomTags ?? []) as Array<{ tag?: string } | undefined>) {
            const tag = String(custom?.tag ?? '').trim()
            if (tag) add(tag)
        }

        let all: Array<{ id: string; name: string }> = []
        try {
            all = await deps.books(userId).listBooks()
        } catch (error) {
            problems.push(`the lorebooks could not be listed: ${describe(error)}`)
        }
        const mine = all.filter((book) => bookStanding(book.name, prefix, owned) === 'owned')
        // Named as this campaign's and not owned (56): a fork's, or a hand-typed prefix's. Adoptable, never written to until adopted.
        const adoptable = all.filter((book) => bookStanding(book.name, prefix, owned) === 'adoptable')
        const worldWanted = prefs.worldProgressionEnabled === true
        for (const kind of ['World', 'Skeleton']) {
            const name = campaignBookName(prefix, kind)
            if (worldWanted || mine.some((b) => b.name.toLowerCase() === name.toLowerCase())) add(kind)
        }

        let narrator: { id: string; name: string; worldBookIds: string[] } | null = null
        try {
            narrator = await card(chatId, userId)
        } catch (error) {
            problems.push(`the narrator's card could not be read: ${describe(error)}`)
        }
        const record = await chatRecord(chatId, userId)
        const chatIds = 'ids' in record ? record.ids : []
        if ('problem' in record) problems.push(record.problem)
        // What the host's record holds, in the log, on the fold's own read (71d-bis): the
        // key this build reads and writes was found live (55-ter), and a Lore tab that
        // shows none of what this list calls attached is answered by where the host keeps
        // them now — a list of ids under another key is named here, whatever its name.
        if (options.report) {
            if ('ids' in record) {
                const nameOf = (id: string) => all.find((b) => b.id === id)?.name ?? `(${id}: no such book)`
                const held = record.ids.length ? record.ids.map((id) => `"${nameOf(id)}"`).join(', ') : 'nothing'
                const others = Object.entries(record.metadata).filter(([key]) => key !== CHAT_BOOKS_KEY)
                const lists = others.filter(([, value]) => Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string')).map(([key, value]) => `${key}: ${(value as string[]).map((id) => `"${nameOf(id)}"`).join(', ')}`)
                deps.log.info(`books: the chat's record holds ${CHAT_BOOKS_KEY}: ${held}; its other metadata keys: ${others.length ? others.map(([key]) => key).join(', ') : 'none'}${lists.length ? `; other lists of names in it: ${lists.join('; ')}` : ''}`)
            } else {
                deps.log.info(`books: the chat's record could not be read for what it holds: ${record.problem}`)
            }
        }
        let personaBook: string | null = null
        try {
            personaBook = deps.persona ? (await deps.persona(userId))?.attachedWorldBookId ?? null : null
        } catch (error) {
            problems.push(`the persona could not be read: ${describe(error)}`)
        }
        let globals: string[] = []
        try {
            globals = deps.global ? await deps.global(userId) : []
        } catch (error) {
            problems.push(`the global lorebooks could not be read: ${describe(error)}`)
        }

        const sourcesOf = (id: string): CampaignBooksResult['books'][number]['sources'] => {
            const sources: CampaignBooksResult['books'][number]['sources'] = []
            if (chatIds.includes(id)) sources.push('chat')
            if (narrator?.worldBookIds.includes(id)) sources.push('character')
            if (personaBook === id) sources.push('persona')
            if (globals.includes(id)) sources.push('global')
            return sources
        }
        const rows: CampaignBooksResult['books'] = []
        const seen = new Set<string>()
        for (const want of expected) {
            const book = mine.find((b) => b.name.toLowerCase() === want.name.toLowerCase())
            if (book) seen.add(book.id)
            const sources = book ? sourcesOf(book.id) : []
            const other = book ? undefined : adoptable.find((b) => b.name.toLowerCase() === want.name.toLowerCase())
            if (other) {
                seen.add(other.id)
                rows.push({ kind: want.kind, name: other.name, id: other.id, state: 'adoptable', sources: sourcesOf(other.id) })
                continue
            }
            rows.push({ kind: want.kind, name: book?.name ?? want.name, id: book?.id ?? null, state: !book ? 'missing' : sources.length ? 'attached' : 'detached', sources })
        }
        for (const book of mine) {
            if (seen.has(book.id)) continue
            const sources = sourcesOf(book.id)
            rows.push({ kind: kindOf(book.name, prefix), name: book.name, id: book.id, state: sources.length ? 'attached' : 'detached', sources })
        }
        for (const book of adoptable) {
            if (seen.has(book.id)) continue
            rows.push({ kind: kindOf(book.name, prefix), name: book.name, id: book.id, state: 'adoptable', sources: sourcesOf(book.id) })
        }
        return {
            prefix,
            card: narrator ? { id: narrator.id, name: narrator.name } : null,
            books: rows,
            target,
            chatScope: 'ids' in record && !!deps.chats?.setMetadata,
            ...(problems.length ? { problem: problems.join('; ') } : {}),
        }
    }

    /** Attach to where the preference says; the ids newly attached, and the words for the log. */
    async function attachTo(chatId: string, userId: string | undefined, bookIds: string[]): Promise<{ attached: string[]; where: string }> {
        const prefs = await deps.prefs.load(userId)
        if (prefs.attachBooksTarget === 'card') {
            if (!deps.characters) throw new Error('This build cannot attach lorebooks to the card: the host has not granted the characters permission.')
            const narrator = await card(chatId, userId)
            if (!narrator) throw new Error('The chat’s card is not known, so there is nothing to attach the books to.')
            const missing = bookIds.filter((id) => !narrator.worldBookIds.includes(id))
            // Additive: the card's list as it stands, plus the books; nothing of the user's is dropped.
            if (missing.length) await deps.characters.setWorldBooks(narrator.id, [...narrator.worldBookIds, ...missing], userId)
            return { attached: missing, where: `the card "${narrator.name}"` }
        }
        if (!deps.chats?.setMetadata) throw new Error('This build cannot attach lorebooks to the chat: the host has not granted the chats permission.')
        const record = await chatRecord(chatId, userId)
        if ('problem' in record) throw new Error(`The books cannot be attached to the chat: ${record.problem}.`)
        const missing = bookIds.filter((id) => !record.ids.includes(id))
        // The record's metadata written whole with the one key changed: the
        // host's other keys kept as read, this list additive.
        if (missing.length) await deps.chats.setMetadata(chatId, { ...record.metadata, [CHAT_BOOKS_KEY]: [...record.ids, ...missing] }, userId)
        return { attached: missing, where: 'the chat' }
    }

    return {
        status,

        async attached(chatId, userId) {
            const ids = new Set<string>()
            const record = await chatRecord(chatId, userId)
            if ('ids' in record) for (const id of record.ids) ids.add(id)
            else deps.log.warn(`books: the chat's own attachments could not be read: ${record.problem}`)
            try {
                for (const id of (await card(chatId, userId))?.worldBookIds ?? []) ids.add(id)
            } catch (error) {
                deps.log.warn(`books: the narrator's card could not be read for its books: ${describe(error)}`)
            }
            try {
                const personaBook = deps.persona ? (await deps.persona(userId))?.attachedWorldBookId ?? null : null
                if (personaBook) ids.add(personaBook)
            } catch (error) {
                deps.log.warn(`books: the persona could not be read for its book: ${describe(error)}`)
            }
            try {
                for (const id of deps.global ? await deps.global(userId) : []) ids.add(id)
            } catch (error) {
                deps.log.warn(`books: the global lorebooks could not be read: ${describe(error)}`)
            }
            return [...ids]
        },

        async attach(chatId, userId, bookId) {
            const before = await status(chatId, userId)
            const wanted = before.books.filter((b) => b.id && (bookId ? b.id === bookId : b.state === 'detached')).map((b) => b.id!)
            if (bookId && !wanted.length) throw new Error('That book is not one of this campaign’s.')
            const { attached, where } = await attachTo(chatId, userId, wanted)
            const names = before.books.filter((b) => b.id && attached.includes(b.id)).map((b) => b.name)
            if (names.length) deps.log.info(`books: attached ${names.map((n) => `"${n}"`).join(', ')} to ${where} on request`)
            return status(chatId, userId)
        },

        async adopt(chatId, userId, bookId) {
            if (!deps.ownership) throw new Error('This build cannot adopt a book.')
            const before = await status(chatId, userId)
            const book = before.books.find((b) => b.id === bookId)
            if (!book) throw new Error('That book is not named as this campaign’s.')
            if (book.state !== 'adoptable') throw new Error(`${book.name} is this campaign’s already.`)
            const prefs = await deps.prefs.load(userId)
            await deps.ownership.set(chatId, [...(prefs.campaignBooks?.[chatId] ?? []), book.name], userId)
            deps.log.info(`books: adopted "${book.name}" as the campaign’s on request`)
            return status(chatId, userId)
        },

        async sweep(chatId, userId) {
            try {
                const prefs = await deps.prefs.load(userId)
                if (prefs.attachBooksToCard === false || !deps.chats) return
                const current = await status(chatId, userId)
                const detached = current.books.filter((b) => b.id && b.state === 'detached')
                if (!detached.length) return
                if (current.target === 'card' ? !current.card : !current.chatScope) {
                    deps.log.warn(`books: ${detached.length} of the campaign's books are not attached and ${current.target === 'card' ? 'the chat\'s card is not known' : 'the chat\'s record cannot be written'}; nothing attached`)
                    return
                }
                const { attached, where } = await attachTo(chatId, userId, detached.map((b) => b.id!))
                const names = detached.filter((b) => attached.includes(b.id!)).map((b) => `"${b.name}"`)
                if (names.length) deps.log.info(`books: attached ${names.join(', ')} to ${where} as they were made`)
            } catch (error) {
                deps.log.warn(`books: the campaign's books could not be attached: ${describe(error)}`)
            }
        },
    }
}
