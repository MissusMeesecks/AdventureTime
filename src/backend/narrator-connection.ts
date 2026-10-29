/**
 * The connection a pass runs on when its row is blank (Phase 89, the
 * maintainer's other session's finding of 2026-10-29).
 *
 * A blank connection row used to send no `connection_id`, and the label said
 * *whatever writes the story*. Lumiverse's quiet path does not do that: a
 * quiet call with no id runs on the connection ticked **Set as default
 * connection**, and with none ticked it fails — *No connection profile found.
 * Create one first.* A new connection starts unticked and nothing ticks one,
 * while a chat reply never needs the tick (the chat's pinned connection, the
 * send's, the active profile). So on an install whose connection was never
 * ticked, no tracker and no agent ran at all, and the maintainer's own install
 * hid it: theirs is ticked.
 *
 * This module makes a blank row mean the narrator's connection, in this order:
 *
 * 1. **The chat's own**: `metadata.connection_profile_id` on the chat's
 *    record, when the chat pins one.
 * 2. **The one seen writing the story**: the interceptor's context carries
 *    the reply's connection — `connectionId` at runtime by the host's own
 *    source, `mainDispatch.descriptor.connectionId` by the types we build
 *    against; both are read, and the Server Logs say which arrived, once —
 *    remembered per user and persisted, so a backend restart keeps it.
 * 3. **Lumiverse's default-ticked connection**, before any reply is seen.
 * 4. **The first connection listed**, with none ticked.
 *
 * A remembered or pinned id the host no longer lists is skipped, not sent: a
 * deleted connection must not look like a working one. The resolution is
 * cached for a few seconds per user and chat, since the agent's loop makes one
 * generation per turn and need not list the connections for each.
 */

/** What the resolver needs of a connection: the list op's shape. */
export interface ConnectionSummary {
    id: string
    name: string
    provider: string
    model: string
    isDefault: boolean
}

/** Why a blank row resolved to the connection it did. */
export type PassConnectionWhy = 'chat' | 'seen' | 'default' | 'first' | 'none'

/** The connection a blank row runs on, with the reason, for the log and the checklist. */
export interface PassConnection {
    /** The id to send, or nothing when Lumiverse lists none. */
    id: string | undefined
    name: string
    provider: string
    model: string
    why: PassConnectionWhy
    /** How many connections Lumiverse listed, or -1 when the list could not be read. */
    listed: number
}

/** The reasons in words, for the log line and the checklist's evidence. */
export const WHY_WORDS: Record<PassConnectionWhy, string> = {
    chat: 'the chat’s own connection',
    seen: 'the narrator’s connection, seen writing the last reply',
    default: 'Lumiverse’s default-ticked connection; no reply has been seen yet',
    first: 'the first connection Lumiverse lists; none is ticked as default and no reply has been seen yet',
    none: 'no connection at all: Lumiverse lists none',
}

/** The slice of the interceptor's context the resolver reads; `connectionId` is the host's runtime field, which the types do not declare. */
export interface SeenContext {
    userId?: string
    connectionId?: unknown
    mainDispatch?: { descriptor?: { connectionId?: unknown } | null } | null
}

export interface NarratorConnectionDeps {
    /** `spindle.connections.list` for the user; a throw is read as an unreadable list. */
    listConnections(userId: string | undefined): Promise<ConnectionSummary[]>
    /** The chat's pinned connection, `metadata.connection_profile_id` on its record, or null. */
    chatConnection(chatId: string, userId: string | undefined): Promise<string | null>
    /** The connection seen last, persisted per user: read on the first resolve after a restart, written when it changes. */
    seen: {
        load(userId: string | undefined): Promise<string>
        save(userId: string | undefined, id: string): Promise<void>
    }
    log: { info(message: string): void; warn(message: string): void }
    /** The clock, for the cache; tests pass their own. */
    now?: () => number
}

export interface NarratorConnection {
    /** Read the reply's connection off the interceptor's context and remember it. */
    seen(context: SeenContext): void
    /** The connection a blank row runs on for this chat, with the reason. */
    resolve(chatId: string | undefined, userId: string | undefined): Promise<PassConnection>
    /** Forget the cached resolutions (a test's, or a connection change's). */
    forget(): void
}

/** How long a resolution is reused for the same user and chat. */
export const RESOLVE_CACHE_MS = 5_000

/** The reply's connection id off the context, and where it was found. */
export function connectionIdOf(context: SeenContext): { id: string; source: 'connectionId' | 'mainDispatch.descriptor.connectionId' } | null {
    const direct = context.connectionId
    if (typeof direct === 'string' && direct.trim()) return { id: direct.trim(), source: 'connectionId' }
    const descriptor = context.mainDispatch?.descriptor?.connectionId
    if (typeof descriptor === 'string' && descriptor.trim()) return { id: descriptor.trim(), source: 'mainDispatch.descriptor.connectionId' }
    return null
}

export function createNarratorConnection(deps: NarratorConnectionDeps): NarratorConnection {
    const now = deps.now ?? (() => Date.now())
    /** The id seen last per user, in memory; the persisted copy is read once per user. */
    const seenNow = new Map<string, string>()
    const loaded = new Set<string>()
    /** What the log has said about the context's shape, once per user and shape. */
    const said = new Set<string>()
    const cache = new Map<string, { at: number; value: PassConnection }>()
    const key = (userId: string | undefined) => userId ?? ''

    function seen(context: SeenContext): void {
        const user = key(context.userId)
        const found = connectionIdOf(context)
        if (!found) {
            const line = `${user}\nnone`
            if (!said.has(line)) {
                said.add(line)
                deps.log.info('narrator connection: the interceptor’s context carries no connection id (neither connectionId nor mainDispatch.descriptor), so a blank row falls to the chat’s, then Lumiverse’s default')
            }
            return
        }
        const line = `${user}\n${found.source}`
        if (!said.has(line)) {
            said.add(line)
            deps.log.info(`narrator connection: "${found.id}" seen on the interceptor’s context as ${found.source}`)
        }
        if (seenNow.get(user) === found.id) return
        seenNow.set(user, found.id)
        loaded.add(user)
        cache.clear()
        deps.seen.save(context.userId, found.id).catch((error) => deps.log.warn(`narrator connection: could not keep "${found.id}": ${String(error)}`))
    }

    async function seenFor(userId: string | undefined): Promise<string> {
        const user = key(userId)
        if (!loaded.has(user)) {
            loaded.add(user)
            const stored = await deps.seen.load(userId).catch(() => '')
            if (stored && !seenNow.has(user)) seenNow.set(user, stored)
        }
        return seenNow.get(user) ?? ''
    }

    async function resolveFresh(chatId: string | undefined, userId: string | undefined): Promise<PassConnection> {
        let list: ConnectionSummary[] | null
        try {
            list = await deps.listConnections(userId)
        } catch (error) {
            deps.log.warn(`narrator connection: Lumiverse would not list the connections: ${String(error)}`)
            list = null
        }
        const listed = list ? list.length : -1
        const found = (id: string): PassConnection | null => {
            const c = list?.find((entry) => entry.id === id)
            if (c) return { id: c.id, name: c.name, provider: c.provider, model: c.model, why: 'chat', listed }
            // An unreadable list cannot say the id is gone; a readable one that lacks it can.
            return list ? null : { id, name: '', provider: '', model: '', why: 'chat', listed }
        }
        if (chatId) {
            const pinned = await deps.chatConnection(chatId, userId).catch(() => null)
            const hit = pinned ? found(pinned) : null
            if (hit) return hit
        }
        const seenId = await seenFor(userId)
        const seenHit = seenId ? found(seenId) : null
        if (seenHit) return { ...seenHit, why: 'seen' }
        const fallback = list?.find((c) => c.isDefault)
        if (fallback) return { id: fallback.id, name: fallback.name, provider: fallback.provider, model: fallback.model, why: 'default', listed }
        const first = list?.[0]
        if (first) return { id: first.id, name: first.name, provider: first.provider, model: first.model, why: 'first', listed }
        return { id: undefined, name: '', provider: '', model: '', why: 'none', listed }
    }

    return {
        seen,
        async resolve(chatId, userId) {
            const k = `${key(userId)}\n${chatId ?? ''}`
            const hit = cache.get(k)
            if (hit && now() - hit.at < RESOLVE_CACHE_MS) return hit.value
            const value = await resolveFresh(chatId, userId)
            cache.set(k, { at: now(), value })
            return value
        },
        forget() {
            cache.clear()
        },
    }
}

/** The log line a pass gets: what it runs on and why. */
export function describePassConnection(connection: PassConnection): string {
    if (!connection.id) return `no connection — ${WHY_WORDS.none}; the call goes without one and Lumiverse will refuse it`
    const name = connection.name ? `"${connection.name}"${connection.provider ? ` (${connection.provider}${connection.model ? ` · ${connection.model}` : ''})` : ''}` : connection.id
    return `${name} — ${WHY_WORDS[connection.why]}`
}
