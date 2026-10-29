/**
 * The lorebooks shown to the tracker (Phase 73h, the departures list's
 * part B row *Context & Lorebooks*): Multihog's `buildLorebookContext` in
 * `memo-processor.js`, which, with *Inject Lorebooks* on, reads every
 * enabled entry of the chosen books -- every book the host has when none
 * is chosen -- and puts them at the head of the State Tracker's user
 * prompt as one `## WORLD LORE` section, the entries parted by a rule.
 *
 * The legacy's builder is a closure over SillyTavern's world-info API, so
 * the reading is the backend's; this is the assembly, with the two strings
 * the legacy writes, held to the pin by `prompt.pin.test.ts`.
 */

/** Between two entries, as the legacy joins them. */
export const WORLD_LORE_SEPARATOR = '\n---\n'

export interface WorldLoreBook {
    id: string
    name: string
}

/**
 * What an empty filter means (73h-bis, departure 121, the maintainer's
 * decision of 2026-10-21): the legacy reads every book the host has; here
 * the default is the books linked to the chat -- attached to the chat's
 * record, its card, the persona or the global list -- since a whole
 * library sent by default should not happen.
 */
export type WorldLoreScope = 'all' | 'chat'

/**
 * Which books the filter names: those whose name is in it, in the host's
 * order. With the filter empty, every book when the scope is `all` (the
 * legacy's read), or those whose id is among `attached` when it is `chat`.
 * A name the host has twice is read twice -- the legacy loads by name too.
 */
export function selectLoreBooks<T extends WorldLoreBook>(books: readonly T[], filter: readonly string[], scope: WorldLoreScope = 'all', attached: readonly string[] = []): T[] {
    const wanted = new Set(filter.map((name) => name.trim()).filter(Boolean))
    if (wanted.size) return books.filter((book) => wanted.has(book.name.trim()))
    if (scope === 'all') return [...books]
    const ids = new Set(attached)
    return books.filter((book) => ids.has(book.id))
}

/** The legacy's label: the filter's names, or *All Books*; *This chat's books* for the chat scope (73h-bis). */
export function worldLoreLabel(filter: readonly string[], scope: WorldLoreScope = 'all'): string {
    const names = filter.map((name) => name.trim()).filter(Boolean)
    if (names.length) return `Filtered: ${names.join(', ')}`
    return scope === 'chat' ? 'This chat’s books' : 'All Books'
}

/**
 * The section as the legacy builds it: blank with nothing to show (the
 * legacy pushes nothing, so the prompt opens on the prior memo as before).
 * An entry that is blank is left out, as `if (!e.disable && e.content)`
 * leaves it out there.
 */
export function buildWorldLoreContext(entries: readonly string[], filter: readonly string[], scope: WorldLoreScope = 'all'): string {
    const kept = entries.filter((content) => typeof content === 'string' && content.length > 0)
    if (!kept.length) return ''
    return `## WORLD LORE (${worldLoreLabel(filter, scope)})\n${kept.join(WORLD_LORE_SEPARATOR)}`
}
