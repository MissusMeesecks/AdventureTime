/**
 * The lorebooks read for the tracker (Phase 73h, Multihog's *Inject
 * Lorebooks*): with the preference on, every enabled entry of the books the
 * filter names -- the books linked to the chat when it names none (73h-bis,
 * departure 121; the legacy reads every book the host has) -- read
 * through the book store and assembled by `tracker/world-lore.ts` into the
 * section the tracker pass puts at the head of its user prompt.
 *
 * Fail soft, as the legacy warns and goes on: a book that cannot be read is
 * skipped and named in the log, and a preferences read that fails sends
 * nothing. The reading is per pass, as the legacy's is, so a book edited
 * between two replies is read as it stands.
 */

import { buildWorldLoreContext, selectLoreBooks } from '../tracker/world-lore.js'

export interface WorldLoreReaderDeps {
    /** The two preferences: the switch and the filter's book names. */
    prefs: (userId: string | undefined) => Promise<{ inject: boolean; filter: string[] }>
    /**
     * The ids of every book the host would scan for the chat (73h-bis,
     * departure 121): with the filter empty these are read, not the whole
     * library as the legacy reads it. Never throws (the service skips a
     * source it cannot read and names it).
     */
    attached: (chatId: string, userId: string | undefined) => Promise<string[]>
    store: (userId: string | undefined) => {
        listBooks(): Promise<Array<{ id: string; name: string }>>
        listEntries(bookId: string): Promise<Array<{ content: string; disabled?: boolean }>>
    }
    log: { info(message: string): void; warn(message: string): void }
}

export type WorldLoreReader = (chatId: string, userId: string | undefined) => Promise<string>

export function createWorldLoreReader(deps: WorldLoreReaderDeps): WorldLoreReader {
    return async (chatId, userId) => {
        const { inject, filter } = await deps.prefs(userId)
        if (!inject) return ''
        const store = deps.store(userId)
        const named = filter.some((name) => name.trim())
        const linked = named ? [] : await deps.attached(chatId, userId)
        const books = selectLoreBooks(await store.listBooks(), filter, 'chat', linked)
        const entries: string[] = []
        let read = 0
        for (const book of books) {
            try {
                for (const entry of await store.listEntries(book.id)) {
                    if (!entry.disabled && entry.content) entries.push(entry.content)
                }
                read += 1
            } catch (error) {
                deps.log.warn(`tracker: the lorebook "${book.name}" could not be read for the world lore: ${error instanceof Error ? error.message : String(error)}`)
            }
        }
        const text = buildWorldLoreContext(entries, filter, 'chat')
        deps.log.info(`tracker pass for chat ${chatId}: ${entries.length} lore entries of ${read} books sent as world lore${named ? ` (filtered: ${filter.join(', ')})` : ` (the ${linked.length} books linked to this chat)`}`)
        return text
    }
}
