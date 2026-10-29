/**
 * World-book writes.
 *
 * The lorebook agent's job is to keep a book of entries in step with the
 * story, which means it writes the same entry over and over as facts change.
 * Spindle exposes entry-level CRUD with the full World Info schema, so an
 * update is an update — no read-modify-write of a whole book, and no risk of
 * clobbering entries somebody else touched.
 *
 * Phase 0 provides only what the spine needs: find-or-create a book, and
 * upsert an entry within it. The agent's own logic (what to write, when, and
 * under which keys) is Phase 1.
 *
 * Entries are matched on `comment`, not on `key`. `comment` is the entry's
 * title and is stable; `key` is the activation keyword list and legitimately
 * changes as the agent learns better triggers. Matching on keys would create
 * duplicates every time the agent refined one.
 */

import type {
    WorldBookDTO,
    WorldBookEntryCreateDTO,
    WorldBookEntryDTO,
} from 'lumiverse-spindle-types'

/** The slice of `spindle.world_books` this module needs. */
export interface WorldBooksApi {
    list(options?: { limit?: number; offset?: number; userId?: string }): Promise<{ data: WorldBookDTO[]; total: number }>
    create(input: { name: string; description?: string }, userId?: string): Promise<WorldBookDTO>
    entries: {
        list(worldBookId: string, options?: { limit?: number; offset?: number; userId?: string }):
            Promise<{ data: WorldBookEntryDTO[]; total: number }>
        create(worldBookId: string, input: WorldBookEntryCreateDTO, userId?: string): Promise<WorldBookEntryDTO>
        update(entryId: string, input: WorldBookEntryCreateDTO, userId?: string): Promise<WorldBookEntryDTO>
    }
}

/** How many books/entries to pull per page when scanning for a match. */
const PAGE_SIZE = 100

/**
 * Find a world book by exact name, creating it if it does not exist.
 *
 * Name matching is exact and case-sensitive: a campaign called "Vellmoor"
 * and one called "vellmoor" are two campaigns, and quietly merging them
 * would be worse than making a second book.
 */
export async function getOrCreateBook(
    api: WorldBooksApi,
    name: string,
    userId?: string,
): Promise<WorldBookDTO> {
    for (let offset = 0; ; offset += PAGE_SIZE) {
        const page = await api.list({ limit: PAGE_SIZE, offset, userId })
        const found = page.data.find((book) => book.name === name)
        if (found) return found
        if (offset + page.data.length >= page.total || page.data.length === 0) break
    }
    return api.create({ name }, userId)
}

/**
 * Create or update an entry, matched on its `comment` (title).
 *
 * Returns the entry as the host stored it, so the caller sees the real id and
 * any fields the host defaulted.
 */
export async function upsertEntry(
    api: WorldBooksApi,
    worldBookId: string,
    entry: WorldBookEntryCreateDTO & { comment: string },
    userId?: string,
): Promise<WorldBookEntryDTO> {
    for (let offset = 0; ; offset += PAGE_SIZE) {
        const page = await api.entries.list(worldBookId, { limit: PAGE_SIZE, offset, userId })
        const existing = page.data.find((candidate) => candidate.comment === entry.comment)
        if (existing) return api.entries.update(existing.id, entry, userId)
        if (offset + page.data.length >= page.total || page.data.length === 0) break
    }
    return api.entries.create(worldBookId, entry, userId)
}
