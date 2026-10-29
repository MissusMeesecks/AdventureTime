/**
 * Clone Stack (Phase 71c, roadmap row 71): Multihog's *Clone Stack* button.
 *
 * Every book the campaign owns, copied whole under a new prefix — entries,
 * keys, comments, the disabled and constant flags, the extensions — for a
 * branch of the story to go on from. As the legacy does it: a preflight
 * refuses the whole clone when any new name is taken, nothing is written
 * until every name is clear, and the chat stays on its own prefix; the
 * copies belong to no chat until a chat named for the new prefix adopts
 * them (the Lorebooks sub-fold's amber **Adopt**). Multihog's hint is to
 * make a branch chat whose sanitized name matches the new prefix; here the
 * campaign name box does the same.
 */

import { sanitizeCampaignPrefix } from '../agent/campaign.js'

export interface CloneStore {
    listBooks(): Promise<Array<{ id: string; name: string }>>
    createBook(name: string): Promise<{ id: string; name: string }>
    listEntries(bookId: string): Promise<Array<{ key: string[]; content: string; comment: string; disabled?: boolean; constant?: boolean; extensions?: Record<string, unknown> }>>
    createEntry(bookId: string, entry: { key: string[]; content: string; comment: string; disabled: boolean; constant?: boolean; extensions?: Record<string, unknown> }): Promise<unknown>
}

export interface CloneRequest {
    store: CloneStore
    /** The campaign's prefix now. */
    prefix: string
    /** The books the campaign owns, by name. */
    owned: readonly string[]
    /** The prefix asked for, as typed. */
    newPrefix: string
    log?: { info(m: string): void; warn(m: string): void }
}

export interface CloneResult {
    newPrefix: string
    /** The new books' names. */
    cloned: string[]
    /** Why nothing was written, in the legacy's words. */
    refused?: string
    /** Books that could not be copied whole; the rest were. */
    errors: string[]
}

/** The legacy's rename: the root book takes the new prefix; another keeps its suffix. */
export function cloneName(bookName: string, prefix: string, newPrefix: string): string {
    const lower = bookName.toLowerCase()
    const current = prefix.toLowerCase()
    if (lower === current) return newPrefix
    if (lower.startsWith(`${current}_`)) return newPrefix + bookName.slice(prefix.length)
    return `${newPrefix}_${bookName}`
}

export async function cloneCampaignStack(request: CloneRequest): Promise<CloneResult> {
    const newPrefix = sanitizeCampaignPrefix(request.newPrefix)
    if (!newPrefix) return { newPrefix, cloned: [], errors: [], refused: 'New prefix cannot be empty or contain only special characters.' }
    if (newPrefix.toLowerCase() === request.prefix.toLowerCase()) {
        return { newPrefix, cloned: [], errors: [], refused: 'New prefix is the same as the current prefix. Please choose a different name.' }
    }
    const all = await request.store.listBooks()
    const owned = new Set(request.owned.map((name) => name.toLowerCase()))
    const sources = all.filter((book) => owned.has(book.name.toLowerCase()))
    if (!sources.length) return { newPrefix, cloned: [], errors: [], refused: `No lorebooks found for prefix "${request.prefix}". Nothing to clone.` }

    const taken = new Set(all.map((book) => book.name.toLowerCase()))
    const plan = sources.map((book) => ({ book, name: cloneName(book.name, request.prefix, newPrefix) }))
    const collisions = plan.filter((item) => taken.has(item.name.toLowerCase())).map((item) => item.name)
    if (collisions.length) {
        return {
            newPrefix, cloned: [], errors: [],
            refused: `Clone aborted to protect existing lorebooks:\n${collisions.map((name) => `- ${name}`).join('\n')}\nChoose a different prefix, or rename/delete the conflicting books first.`,
        }
    }

    const cloned: string[] = []
    const errors: string[] = []
    for (const { book, name } of plan) {
        try {
            const entries = await request.store.listEntries(book.id)
            const made = await request.store.createBook(name)
            for (const entry of entries) {
                await request.store.createEntry(made.id, {
                    key: [...entry.key],
                    content: entry.content,
                    comment: entry.comment,
                    disabled: entry.disabled === true,
                    ...(entry.constant !== undefined ? { constant: entry.constant === true } : {}),
                    ...(entry.extensions && Object.keys(entry.extensions).length ? { extensions: entry.extensions } : {}),
                })
            }
            cloned.push(name)
            request.log?.info(`campaign: cloned "${book.name}" as "${name}" (${entries.length} entries)`)
        } catch (error) {
            errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
            request.log?.warn(`campaign: could not clone "${book.name}" as "${name}": ${String(error)}`)
        }
    }
    return { newPrefix, cloned, errors }
}
