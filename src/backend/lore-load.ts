/**
 * The lore size warning (the maintainer's ask of 2026-11-25, departure 175):
 * how many tokens of lore Lumiverse sent with the last reply, against a
 * number the user chose. A warning and nothing else: activation stays
 * Lumiverse's (docs/DECISION-ACTIVATION.md), no entry is switched, moved or
 * cleaned by this module.
 *
 * The measure is the host's own. Lumiverse emits `WORLD_INFO_ACTIVATED` for
 * every real generation, after its budget has cut, with the entries it put
 * in the prompt and their sizes by its budget's own rule — the content's
 * length over four, rounded up (`estimateWorldInfoEntryTokens`). So the
 * total here is the number Lumiverse's Max Token Budget is held against; its
 * Prompt Breakdown counts the same entries with the model's tokenizer and
 * reads a little differently.
 */

/** Lumiverse's budget rule, to the character (`world-info-activation.service.ts`). */
export function estimateLoreTokens(content: string): number {
    return Math.ceil(content.length / 4)
}

export const DEFAULT_LORE_WARN_TOKENS = 10000
export const MAX_LORE_WARN_TOKENS = 1000000

export interface LoreLoadEntry {
    id: string
    title: string
    /** The book's name, or blank when the host named none and the book could not be read. */
    book: string
    tokens: number
    /** Always in the prompt; Lumiverse's budget never leaves it out. */
    constant: boolean
    /** `Book::uid` for the agent's targeted cleanup, on an entry of the campaign's own books alone. */
    cleanTarget?: string
}

export interface LoreLoadRecord {
    chatId: string
    at: string
    total: number
    entries: LoreLoadEntry[]
    /** Entries Lumiverse left out by its own limits; `null` when the host did not say. */
    leftOut: number | null
}

export interface LoreLoadResult {
    /** `null` until Lumiverse has sent a reply for this chat since the backend started. */
    load: LoreLoadRecord | null
    /** The user's warning; 0 is off. */
    threshold: number
    over: boolean
}

interface ActivationEntry { id: string; title: string; bookId: string; bookName: string; tokens: number | null }
export interface ActivationEvent { chatId: string; entries: ActivationEntry[]; hostTotal: number | null; leftOut: number | null }

const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null)

/** The host's payload, read without trusting its shape: the typed DTO names fewer fields than the event carries. */
export function readActivationEvent(payload: unknown): ActivationEvent | null {
    if (!payload || typeof payload !== 'object') return null
    const source = payload as { chatId?: unknown; entries?: unknown; stats?: unknown }
    if (typeof source.chatId !== 'string' || !source.chatId) return null
    const entries: ActivationEntry[] = []
    for (const raw of Array.isArray(source.entries) ? source.entries : []) {
        if (!raw || typeof raw !== 'object') continue
        const entry = raw as Record<string, unknown>
        if (typeof entry.id !== 'string' || !entry.id) continue
        entries.push({
            id: entry.id,
            title: typeof entry.comment === 'string' ? entry.comment : '',
            bookId: typeof entry.bookId === 'string' ? entry.bookId : '',
            bookName: typeof entry.bookName === 'string' ? entry.bookName : '',
            tokens: finite(entry.estimatedTokens),
        })
    }
    const stats = source.stats && typeof source.stats === 'object' ? source.stats as Record<string, unknown> : {}
    const cut = finite(stats.evictedByBudget)
    const low = finite(stats.evictedByMinPriority)
    return { chatId: source.chatId, entries, hostTotal: finite(stats.estimatedTokens), leftOut: cut === null && low === null ? null : (cut ?? 0) + (low ?? 0) }
}

export interface LoreLoadBooks {
    listBooks(): Promise<Array<{ id: string; name: string }>>
    listEntries(bookId: string): Promise<Array<{ id: string; uid: string; content: string; comment: string; constant?: boolean }>>
}

export interface LoreLoadDeps {
    books(userId: string | undefined): LoreLoadBooks
    /** Whether a book is this chat's campaign's own, which is what the agent's cleanup may rewrite. */
    cleanable(chatId: string, userId: string | undefined): Promise<(bookName: string) => boolean>
    threshold(userId: string | undefined): Promise<number>
    notify(chatId: string, result: LoreLoadResult, userId: string | undefined): void
    log: { info(message: string): void; warn(message: string): void }
    now?: () => Date
}

const KEPT_CHATS = 12
const number = (n: number): string => n.toLocaleString('en-US')

export function loreWarningLine(chatId: string, load: LoreLoadRecord, threshold: number): string {
    const largest = load.entries.slice(0, 3).map((entry) => `"${entry.title || entry.id}" ${number(entry.tokens)}`).join(', ')
    const left = load.leftOut ? `; Lumiverse left ${load.leftOut} more out by its own limits` : ''
    return `lore: Lumiverse sent about ${number(load.total)} tokens of lore with the reply in chat ${chatId} (${load.entries.length} entr${load.entries.length === 1 ? 'y' : 'ies'}), over the warning of ${number(threshold)}${largest ? `; the largest: ${largest}` : ''}${left}`
}

export function createLoreLoad(deps: LoreLoadDeps) {
    const kept = new Map<string, LoreLoadRecord>()
    const key = (chatId: string, userId: string | undefined): string => `${userId ?? ''}\n${chatId}`

    const result = async (load: LoreLoadRecord | null, userId: string | undefined): Promise<LoreLoadResult> => {
        const threshold = Math.max(0, Math.floor(await deps.threshold(userId)) || 0)
        return { load, threshold, over: !!load && threshold > 0 && load.total > threshold }
    }

    /** One activation announced by the host: sized, kept, compared, and told to the panel. */
    async function onActivated(payload: unknown, userId: string | undefined): Promise<void> {
        const event = readActivationEvent(payload)
        if (!event) return
        const books = deps.books(userId)
        const names = new Map<string, string>()
        const read = new Map<string, Map<string, { uid: string; content: string; constant: boolean }>>()
        let cleanable: (bookName: string) => boolean = () => false
        try {
            for (const book of await books.listBooks()) names.set(book.id, book.name)
            cleanable = await deps.cleanable(event.chatId, userId)
        } catch (error) {
            deps.log.warn(`lore: the books could not be listed for the size of chat ${event.chatId}'s lore: ${String(error)}`)
        }
        for (const bookId of new Set(event.entries.map((entry) => entry.bookId).filter(Boolean))) {
            try {
                const byId = new Map<string, { uid: string; content: string; constant: boolean }>()
                for (const entry of await books.listEntries(bookId)) byId.set(entry.id, { uid: entry.uid, content: entry.content, constant: entry.constant === true })
                read.set(bookId, byId)
            } catch (error) {
                deps.log.warn(`lore: the book "${names.get(bookId) ?? bookId}" could not be read for the size of its entries: ${String(error)}`)
            }
        }
        const entries: LoreLoadEntry[] = event.entries.map((entry) => {
            const stored = read.get(entry.bookId)?.get(entry.id)
            const book = entry.bookName || names.get(entry.bookId) || ''
            const mine = !!stored && !!names.get(entry.bookId) && cleanable(names.get(entry.bookId)!)
            return {
                id: entry.id,
                title: entry.title,
                book,
                // The host's own number first; an older host that sends none is sized by the same rule from the stored text.
                tokens: entry.tokens ?? (stored ? estimateLoreTokens(stored.content) : 0),
                constant: stored?.constant === true,
                ...(mine ? { cleanTarget: `${names.get(entry.bookId)}::${stored!.uid}` } : {}),
            }
        }).sort((a, b) => b.tokens - a.tokens || a.title.localeCompare(b.title))
        const load: LoreLoadRecord = {
            chatId: event.chatId,
            at: (deps.now?.() ?? new Date()).toISOString(),
            total: event.hostTotal ?? entries.reduce((sum, entry) => sum + entry.tokens, 0),
            entries,
            leftOut: event.leftOut,
        }
        kept.delete(key(event.chatId, userId))
        kept.set(key(event.chatId, userId), load)
        while (kept.size > KEPT_CHATS) kept.delete(kept.keys().next().value as string)
        const answer = await result(load, userId)
        if (answer.over) deps.log.info(loreWarningLine(event.chatId, load, answer.threshold))
        deps.notify(event.chatId, answer, userId)
    }

    return {
        onActivated,
        get: (chatId: string, userId: string | undefined): Promise<LoreLoadResult> => result(kept.get(key(chatId, userId)) ?? null, userId),
    }
}
