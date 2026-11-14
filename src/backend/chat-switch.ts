/**
 * The per-chat switch (Phase 94c, roadmap row 94, the maintainer's ask of
 * 2026-11-12): a tick at the top of the settings tab, *AdventureTime is on in
 * this chat*, on for every chat as it ships. Off, AdventureTime leaves that
 * chat alone exactly as the master power (72b, `frameworkEnabled`) leaves
 * every chat alone: nothing is injected into the narrator's prompt and no
 * pass runs after a reply — no tracker, agent, map, world or picture — while
 * the buttons still work. Other chats are not touched.
 *
 * The preference is a map of the chats switched off, `disabledChats`, keyed
 * by chat id and holding `true` alone, so a file carries only the exceptions
 * and a chat the host no longer lists is pruned with the other per-chat maps
 * (`PER_CHAT_PREF_KEYS`). The master power and the per-chat tick are two
 * switches in series: either off is off.
 */

/** The map read defensively: the chat ids switched off, nothing else. */
export function readDisabledChats(value: unknown): Record<string, true> {
    const off: Record<string, true> = {}
    if (!value || typeof value !== 'object' || Array.isArray(value)) return off
    for (const [chatId, flag] of Object.entries(value as Record<string, unknown>)) {
        if (chatId.trim() && flag === true) off[chatId] = true
    }
    return off
}

/** The map with one chat switched on or off. */
export function withChatEnabled(map: Record<string, true> | undefined, chatId: string, enabled: boolean): Record<string, true> {
    const next = readDisabledChats(map)
    if (enabled) delete next[chatId]
    else next[chatId] = true
    return next
}

/**
 * Why the framework is off for a chat, or `null` when it is on: `'master'`
 * for the master power, `'chat'` for the chat's own tick. The master power
 * is read first, since it is the one the Server Logs have named since 72b.
 */
export function frameworkOff(
    prefs: { frameworkEnabled?: boolean; disabledChats?: Record<string, unknown> } | undefined,
    chatId: string | null | undefined,
): 'master' | 'chat' | null {
    if (prefs?.frameworkEnabled === false) return 'master'
    if (chatId && readDisabledChats(prefs?.disabledChats)[chatId]) return 'chat'
    return null
}
