import { describe, it, expect } from 'vitest'

import {
    chatIdsInStorage,
    createMaintenance,
    orphanChatIds,
    orphanPrefEntries,
    promptResetKeys,
    PER_CHAT_PREF_KEYS,
} from './maintenance.js'
import { SettingsStore, type SettingsStorage } from './settings-store.js'
import { PrefsStore, DEFAULT_PREFS } from './prefs-store.js'
import { PortraitStore } from './portrait-store.js'
import { getFactoryCartridgePayload } from '../state/factory.js'

/** One in-memory storage with the JSON and the file faces the stores and the clean-up use. */
function makeStorage() {
    const files = new Map<string, unknown>()
    const key = (path: string, userId?: string) => `${userId ?? '@self'}:${path}`
    const storage: SettingsStorage & { list(prefix?: string, userId?: string): Promise<string[]>; delete(path: string, userId?: string): Promise<void> } = {
        async getJson<T>(path: string, options?: { fallback?: T; userId?: string }): Promise<T> {
            const value = files.get(key(path, options?.userId))
            return (value === undefined ? options?.fallback : value) as T
        },
        async setJson(path, value, options): Promise<void> {
            files.set(key(path, options?.userId), JSON.parse(JSON.stringify(value)))
        },
        async list(prefix = '', userId?: string): Promise<string[]> {
            const head = key(prefix, userId)
            return [...files.keys()].filter((k) => k.startsWith(head)).map((k) => k.slice(`${userId ?? '@self'}:`.length))
        },
        async delete(path, userId): Promise<void> {
            if (!files.delete(key(path, userId))) throw new Error(`no such file: ${path}`)
        },
    }
    return { storage, files }
}

describe('the reset keys (72a)', () => {
    it('names every prompt of the schema and the four tables, every one a cartridge key', () => {
        const keys = promptResetKeys()
        expect(keys).toContain('systemPromptTemplate')
        expect(keys).toContain('worldProgressionSystemPrompt')
        expect(keys).toContain('mapEvolutionSystemPrompt')
        expect(keys).toContain('modules')
        expect(keys).toContain('blockOrder')
        expect(keys).toContain('stockPrompts')
        expect(keys).toContain('routerModules')
        // The user's own stay.
        for (const kept of ['customSyspromptLibrary', 'customFields', 'gameSystems', 'cyoaConfig', 'syspromptModules']) expect(keys).not.toContain(kept)
        expect(new Set(keys).size).toBe(keys.length)
    })

    it('reads chat ids out of whatever shape the listing has, and finds the orphans', () => {
        expect(chatIdsInStorage(['chats/a/memo.json', 'chats/a/portraits.json', 'chats/b', 'c', '/chats/d/x'])).toEqual(['a', 'b', 'c', 'd'])
        expect(orphanChatIds(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c'])
    })

    it('prunes the per-chat preference maps of the orphans and counts them', () => {
        const prefs = { ...DEFAULT_PREFS, campaignNames: { a: 'A', b: 'B' }, campaignBooks: { a: ['A_NPC'] }, trackerWatermarks: { b: 3 }, agentWatermarks: { c: 1 } }
        const { pruned, count } = orphanPrefEntries(prefs, new Set(['b']))
        expect(count).toBe(3)
        expect(pruned).toEqual({ campaignNames: { b: 'B' }, campaignBooks: {}, trackerWatermarks: { b: 3 }, agentWatermarks: {} })
        expect(PER_CHAT_PREF_KEYS).toEqual(['campaignNames', 'campaignBooks', 'trackerWatermarks', 'agentWatermarks'])
    })
})

describe('the resets (72a)', () => {
    function harness(hostChats: string[] = []) {
        const { storage, files } = makeStorage()
        const store = new SettingsStore(storage)
        const prefs = new PrefsStore(storage)
        const portraits = new PortraitStore(storage)
        const forgotten: string[] = []
        const log: string[] = []
        const maintenance = createMaintenance({
            storage,
            store,
            prefs,
            portraits,
            chats: { list: async ({ limit, offset }) => ({ data: hostChats.slice(offset, offset + limit).map((id) => ({ id })), total: hostChats.length }) },
            forget: (chatId) => { forgotten.push(chatId) },
            log: { info: (m) => log.push(m), warn: (m) => log.push(`warn: ${m}`), error: (m) => log.push(`error: ${m}`) },
        })
        return { storage, files, store, prefs, portraits, maintenance, forgotten, log }
    }

    it('resets the prompts and the tables to the factory and leaves the user’s own', async () => {
        const h = harness()
        await h.store.patch('u1', { systemPromptTemplate: 'mine', narrativePacing: 'downtime', customSyspromptLibrary: [{ id: 'x', tag: 'x', content: 'c', enabled: true }] })
        const settings = await h.maintenance.resetPrompts('u1')
        expect(settings.systemPromptTemplate).toBe(getFactoryCartridgePayload().systemPromptTemplate)
        expect(settings.narrativePacing).toBe('downtime')
        expect(settings.customSyspromptLibrary).toEqual([{ id: 'x', tag: 'x', content: 'c', enabled: true }])
    })

    it('factory-resets the cartridge and the install’s preferences, keeping the chats’ names, books and watermarks', async () => {
        const h = harness()
        await h.store.patch('u1', { narrativePacing: 'downtime' })
        await h.prefs.patch({ messageCards: true, campaignNames: { c1: 'Vell' }, agentWatermarks: { c1: 5 } }, 'u1')
        const { settings, prefs } = await h.maintenance.factoryReset('u1')
        expect(settings.narrativePacing).toBe('normal')
        // Off as it ships since 82.
        expect(prefs.messageCards).toBe(false)
        expect(prefs.campaignNames).toEqual({ c1: 'Vell' })
        expect(prefs.agentWatermarks).toEqual({ c1: 5 })
    })

    it('purges every chat’s portrait references and counts them', async () => {
        const h = harness()
        await h.portraits.set('c1', 'Elara', 'img-1', 'u1')
        await h.portraits.set('c1', 'Brin', 'img-2', 'u1')
        await h.portraits.set('c2', 'Mara', 'img-3', 'u1')
        await h.store.patch('u1', {})
        const result = await h.maintenance.purgePortraits('u1')
        expect(result).toEqual({ chats: 2, portraits: 3 })
        expect((await h.portraits.load('c1', 'u1')).portraits).toEqual({})
        expect((await h.portraits.load('c2', 'u1')).portraits).toEqual({})
        expect(await h.maintenance.purgePortraits('u1')).toEqual({ chats: 0, portraits: 0 })
    })

    it('lists the orphans against the host’s chats, removes their files and prunes the preferences, and never touches a chat the host has', async () => {
        const h = harness(['keep'])
        await h.portraits.set('keep', 'Elara', 'img-1', 'u1')
        await h.portraits.set('gone', 'Mara', 'img-2', 'u1')
        await h.storage.setJson('chats/gone/memo.json', { memo: 'x' }, { userId: 'u1' })
        await h.prefs.patch({ campaignNames: { keep: 'K', gone: 'G' }, trackerWatermarks: { gone: 2 } }, 'u1')
        const found = await h.maintenance.orphans('u1')
        expect(found).toEqual({ chatIds: ['gone'], prefsEntries: 2 })
        const result = await h.maintenance.cleanOrphans('u1')
        expect(result.removed).toEqual(['gone'])
        expect(result.files).toBe(2)
        expect(result.prefsEntries).toBe(2)
        expect(result.prefs.campaignNames).toEqual({ keep: 'K' })
        expect(h.forgotten).toEqual(['gone'])
        expect([...h.files.keys()].some((k) => k.includes('chats/gone/'))).toBe(false)
        expect((await h.portraits.load('keep', 'u1')).portraits).toEqual({ Elara: 'img-1' })
        expect(await h.maintenance.orphans('u1')).toEqual({ chatIds: [], prefsEntries: 0 })
    })

    // Every chat's data (81): Multihog's Remove all chat links.
    it('counts every chat with files and every per-chat preference entry, removes them all whatever the host still has, and leaves the rest', async () => {
        const h = harness(['keep'])
        await h.portraits.set('keep', 'Elara', 'img-1', 'u1')
        await h.portraits.set('gone', 'Mara', 'img-2', 'u1')
        await h.storage.setJson('chats/gone/memo.json', { memo: 'x' }, { userId: 'u1' })
        await h.prefs.patch({ campaignNames: { keep: 'K', gone: 'G' }, trackerWatermarks: { keep: 5 } }, 'u1')
        expect(await h.maintenance.chatData('u1')).toEqual({ chatIds: ['gone', 'keep'], prefsEntries: 3 })
        const result = await h.maintenance.removeAllChats('u1')
        expect(result.removed).toEqual(['gone', 'keep'])
        expect(result.files).toBe(3)
        expect(result.prefsEntries).toBe(3)
        expect(result.prefs.campaignNames).toEqual({})
        expect(result.prefs.trackerWatermarks).toEqual({})
        expect(h.forgotten).toEqual(['gone', 'keep'])
        expect([...h.files.keys()].some((k) => k.includes('chats/'))).toBe(false)
        // The cartridge and the install's own preferences stand.
        expect((await h.prefs.load('u1')).messageCards).toBe(DEFAULT_PREFS.messageCards)
        expect(await h.maintenance.chatData('u1')).toEqual({ chatIds: [], prefsEntries: 0 })
        expect(h.log.at(-1)).toMatch(/^maintenance: removed every chat’s data — 2 chats \(3 files\) and 3 preference entries/)
    })
})
