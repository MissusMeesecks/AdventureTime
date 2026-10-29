/**
 * Multihog's *Debug & Factory Reset* drawer, the resets (Phase 72a).
 *
 * Four of its buttons, each one op:
 *
 * - **Reset every prompt to stock** (the legacy's *Reset All & Apply*): every
 *   prompt key of the cartridge, the tracker's module table, the cards'
 *   order, the stock module texts and the agent's modules back to the
 *   factory. The user's own sections, custom fields and game systems stay —
 *   the legacy leaves custom modules alone too. Nothing to apply after: the
 *   rulebook is assembled on every reply.
 * - **Factory reset** (the legacy's *FACTORY RESET*): the whole cartridge to
 *   the factory, and the install's preferences — the layout, the widgets'
 *   positions and sizes, the connections, every dial — to their defaults.
 *   What belongs to a chat stays: its memo, its history, its portraits, its
 *   Player Card, its relationships, and in the preferences the campaign's
 *   name, the books it owns and the two watermarks, which name what is
 *   already written in the lorebooks and must not be forgotten by a reset
 *   of dials. The legacy's reset keeps the chat's metadata the same way.
 * - **Purge all portraits** (the legacy's *Emergency: Purge All Portraits*):
 *   every chat's portrait references cleared. The pictures themselves stay
 *   in the host's image store: a reference may be a character card's own
 *   picture (39, 43), and deleting it would take the card's picture with
 *   it. The NPC library's photos are the library's, not a chat's, and stay.
 * - **Clean up orphaned chat data** (the legacy's *Clean up orphaned chat
 *   data*): the files kept under `chats/<id>/` for a chat the host no
 *   longer has, and that chat's entries in the preferences' per-chat maps.
 *   Listed first, so the confirm can say how many; a chat the host still
 *   has is never touched.
 */

import type { SettingsBag } from '../settings/schema.js'
import { SETTINGS_SCHEMA } from '../settings/schema.js'
import { CARTRIDGE_PAYLOAD_KEYS } from '../state/payload-groups.js'
import type { SettingsStore } from './settings-store.js'
import type { PrefsStore, UiPrefs } from './prefs-store.js'
import type { PortraitStore } from './portrait-store.js'
import type { LogApi } from './generation.js'

export interface MaintenanceStorage {
    list(prefix?: string, userId?: string): Promise<string[]>
    delete(path: string, userId?: string): Promise<void>
}

export interface MaintenanceDeps {
    storage: MaintenanceStorage
    store: SettingsStore
    prefs: PrefsStore
    portraits: PortraitStore
    /** The host's chats, a page at a time. */
    chats: { list(options: { limit: number; offset: number; userId?: string }): Promise<{ data: Array<{ id: string }>; total: number }> }
    /** Drop every store's cached copy of a chat, after its files went. */
    forget: (chatId: string, userId: string | undefined) => void
    log: LogApi
}

export interface Maintenance {
    resetPrompts(userId: string | undefined): Promise<SettingsBag>
    factoryReset(userId: string | undefined): Promise<{ settings: SettingsBag; prefs: UiPrefs }>
    purgePortraits(userId: string | undefined): Promise<{ chats: number; portraits: number }>
    orphans(userId: string | undefined): Promise<{ chatIds: string[]; prefsEntries: number }>
    cleanOrphans(userId: string | undefined): Promise<{ removed: string[]; files: number; prefsEntries: number; prefs: UiPrefs }>
    /** Every chat AdventureTime keeps files for, and every per-chat preference entry (81, Multihog's *Remove all chat links*). */
    chatData(userId: string | undefined): Promise<{ chatIds: string[]; prefsEntries: number }>
    /** Remove every chat's files and prune every per-chat preference entry; the host's chats, the books and the cartridge stay. */
    removeAllChats(userId: string | undefined): Promise<{ removed: string[]; files: number; prefsEntries: number; prefs: UiPrefs }>
}

/** The four tables a prompt reset puts back beside the prompts. */
const PROMPT_TABLE_KEYS = ['modules', 'blockOrder', 'stockPrompts', 'routerModules'] as const

/** Every cartridge key *Reset every prompt to stock* resets: the schema's prompts and the four tables. */
export function promptResetKeys(): string[] {
    const keys: string[] = []
    for (const section of SETTINGS_SCHEMA) {
        for (const field of section.fields) if (field.type === 'textarea' && !keys.includes(field.key)) keys.push(field.key)
    }
    for (const key of PROMPT_TABLE_KEYS) if (!keys.includes(key)) keys.push(key)
    return keys.filter((key) => CARTRIDGE_PAYLOAD_KEYS.includes(key))
}

/** The preference maps keyed by chat id, which a factory reset keeps and an orphan clean-up prunes. */
export const PER_CHAT_PREF_KEYS = ['campaignNames', 'campaignBooks', 'trackerWatermarks', 'agentWatermarks'] as const

/**
 * The chat ids with files under `chats/`, from whatever shape the host's
 * listing returns — `chats/<id>/memo.json`, `chats/<id>`, or `<id>` alone.
 */
export function chatIdsInStorage(entries: readonly string[]): string[] {
    const ids = new Set<string>()
    for (const raw of entries) {
        const path = raw.replace(/^\/+/, '').replace(/^chats\//, '')
        const id = path.split('/')[0]?.trim()
        if (id) ids.add(id)
    }
    return [...ids].sort()
}

/** The chat ids ours that the host does not have. */
export function orphanChatIds(ours: readonly string[], hosts: readonly string[]): string[] {
    const known = new Set(hosts)
    return ours.filter((id) => !known.has(id))
}

/** The entries of the per-chat preference maps that name an orphan, counted. */
export function orphanPrefEntries(prefs: UiPrefs, hostIds: ReadonlySet<string>): { pruned: Partial<UiPrefs>; count: number } {
    const pruned: Partial<UiPrefs> = {}
    let count = 0
    for (const key of PER_CHAT_PREF_KEYS) {
        const map = prefs[key] as Record<string, unknown>
        const kept: Record<string, unknown> = {}
        for (const [chatId, value] of Object.entries(map ?? {})) {
            if (hostIds.has(chatId)) kept[chatId] = value
            else count++
        }
        ;(pruned as Record<string, unknown>)[key] = kept
    }
    return { pruned, count }
}

export function createMaintenance(deps: MaintenanceDeps): Maintenance {
    async function hostChatIds(userId: string | undefined): Promise<Set<string>> {
        const ids = new Set<string>()
        const limit = 200
        for (let offset = 0; ; offset += limit) {
            const page = await deps.chats.list({ limit, offset, ...(userId ? { userId } : {}) })
            for (const chat of page.data ?? []) if (chat?.id) ids.add(chat.id)
            if (!page.data?.length || ids.size >= (page.total ?? 0) || page.data.length < limit) break
        }
        return ids
    }

    async function ourChatIds(userId: string | undefined): Promise<string[]> {
        let entries: string[] = []
        try {
            entries = await deps.storage.list('chats/', userId)
        } catch (error) {
            // A list the host refuses, or a fresh install with no `chats/` yet: nothing of ours is listed.
            deps.log.warn(`maintenance: the chats' files could not be listed: ${error instanceof Error ? error.message : String(error)}`)
            return []
        }
        return chatIdsInStorage(entries)
    }

    return {
        async resetPrompts(userId) {
            const keys = promptResetKeys()
            const settings = await deps.store.resetKeys(userId, keys)
            deps.log.info(`maintenance: ${keys.length} prompt keys and tables reset to stock`)
            return settings
        },

        async factoryReset(userId) {
            const settings = await deps.store.resetKeys(userId, [...CARTRIDGE_PAYLOAD_KEYS])
            const prefs = await deps.prefs.resetInstall(userId)
            deps.log.info('maintenance: factory reset — the cartridge to the factory, the install’s preferences to their defaults; the chats’ own state kept')
            return { settings, prefs }
        },

        async purgePortraits(userId) {
            let chats = 0
            let portraits = 0
            for (const chatId of await ourChatIds(userId)) {
                let record
                try {
                    record = await deps.portraits.load(chatId, userId)
                } catch {
                    continue
                }
                const count = Object.keys(record.portraits ?? {}).length
                if (!count) continue
                await deps.portraits.clear(chatId, userId)
                chats++
                portraits += count
            }
            deps.log.info(`maintenance: purged ${portraits} portrait references across ${chats} chats; the pictures stay in the host’s image store`)
            return { chats, portraits }
        },

        async orphans(userId) {
            const hosts = await hostChatIds(userId)
            const chatIds = orphanChatIds(await ourChatIds(userId), [...hosts])
            const prefs = await deps.prefs.load(userId)
            return { chatIds, prefsEntries: orphanPrefEntries(prefs, hosts).count }
        },

        async cleanOrphans(userId) {
            const hosts = await hostChatIds(userId)
            const removed = orphanChatIds(await ourChatIds(userId), [...hosts])
            let files = 0
            for (const chatId of removed) files += await removeChatFiles(chatId, userId)
            const current = await deps.prefs.load(userId)
            const { pruned, count } = orphanPrefEntries(current, hosts)
            const prefs = count ? await deps.prefs.patch(pruned, userId) : current
            deps.log.info(`maintenance: cleaned up ${removed.length} orphaned chats (${files} files) and ${count} preference entries`)
            return { removed, files, prefsEntries: count, prefs }
        },

        async chatData(userId) {
            const chatIds = await ourChatIds(userId)
            const prefs = await deps.prefs.load(userId)
            return { chatIds, prefsEntries: orphanPrefEntries(prefs, new Set()).count }
        },

        async removeAllChats(userId) {
            const removed = await ourChatIds(userId)
            let files = 0
            for (const chatId of removed) files += await removeChatFiles(chatId, userId)
            const current = await deps.prefs.load(userId)
            // No host id kept: every per-chat entry goes, as every chat's files did.
            const { pruned, count } = orphanPrefEntries(current, new Set())
            const prefs = count ? await deps.prefs.patch(pruned, userId) : current
            deps.log.info(`maintenance: removed every chat’s data — ${removed.length} chats (${files} files) and ${count} preference entries; the host’s chats, the books and the cartridge stay`)
            return { removed, files, prefsEntries: count, prefs }
        },
    }

    /** Remove one chat's files under `chats/<id>/` and drop the stores' copies; the count of files that went. */
    async function removeChatFiles(chatId: string, userId: string | undefined): Promise<number> {
        let files = 0
        let paths: string[] = []
        try {
            paths = await deps.storage.list(`chats/${chatId}/`, userId)
        } catch {
            paths = []
        }
        for (const raw of paths) {
            const path = raw.startsWith('chats/') ? raw : `chats/${chatId}/${raw.replace(/^\/+/, '')}`
            if (path === `chats/${chatId}/` || path === `chats/${chatId}`) continue
            try {
                await deps.storage.delete(path, userId)
                files++
            } catch (error) {
                deps.log.warn(`maintenance: ${path} could not be removed: ${error instanceof Error ? error.message : String(error)}`)
            }
        }
        try {
            await deps.storage.delete(`chats/${chatId}`, userId)
        } catch {
            // A host that removes a directory with its last file, or refuses directories: either way the files went.
        }
        deps.forget(chatId, userId)
        return files
    }
}
