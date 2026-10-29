/**
 * The stock texts refreshed after an update (Phase 72a, Multihog's
 * *Auto-Update Prompts on Upgrade* and *Update Changed Prompts*).
 *
 * The cartridge's prompt keys hold a *value*, not a pointer to the factory:
 * a stored text the user never touched stays as it was when it was seeded,
 * and when the pin moves and the factory's text changes with it, the
 * install keeps reading the old one. Multihog keeps a fingerprint of the
 * bundled defaults and, when it changes, puts the new text under every
 * key still at the old default (`index.js`, `_runPromptDefaultsDialog`).
 *
 * The same here, by hashes: `stock-hashes.json` holds, per stock text, the
 * hash of the factory text the install was last seen at. A stored text
 * whose hash is that one was never edited, so it takes the factory's new
 * text; one whose hash is something else was edited and is kept, and
 * named, so the user can decide. The first run writes the hashes without
 * refreshing anything: with no record there is nothing to compare, and a
 * text that differs from the factory may be an edit.
 *
 * The stock texts are the schema's prompts (every `textarea` field), the
 * tracker's stock module texts (`stockPrompts`, one per module) and the
 * agent's module instructions (`routerModules`, one per module). A user's
 * own sections (`customSyspromptLibrary`), custom fields and game systems
 * are never touched: they have no factory text.
 */

import { SETTINGS_SCHEMA, type SettingsBag } from '../settings/schema.js'

/** The record kept in `stock-hashes.json`. */
export interface StockHashes {
    version: 1
    /** The factory text's hash per stock key, as last seen. */
    hashes: Record<string, string>
    /** When they were last written. */
    at: string
}

export const STOCK_HASHES_PATH = 'stock-hashes.json'

/** What a check found: the keys refreshed, the edited ones kept, and the hashes to keep. */
export interface StockUpgradePlan {
    /** Keys whose stored text was the old factory's and takes the new. */
    refreshed: string[]
    /** Keys whose factory text changed under an edit, which stands. */
    kept: string[]
    /** The settings with the refreshed texts in, when there are any. */
    settings: SettingsBag
    hashes: StockHashes
}

/**
 * A small, fast hash of a text: two FNV-1a 32-bit passes with different
 * seeds, sixteen hex digits. Not cryptographic; it tells one text from
 * another, which is all the comparison needs.
 */
export function hashText(text: string): string {
    let a = 0x811c9dc5
    let b = 0x01000193 ^ 0x5bd1e995
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i)
        a ^= c
        a = Math.imul(a, 0x01000193) >>> 0
        b ^= c
        b = Math.imul(b, 0x01000193) >>> 0
        b ^= b >>> 13
    }
    return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}

/** The flat stock-text keys: `key`, `stockPrompts.<module>`, `routerModules.<id>.instruction`. */
export function stockTextKeys(factory: SettingsBag): string[] {
    const keys: string[] = []
    for (const section of SETTINGS_SCHEMA) {
        for (const field of section.fields) {
            if (field.type === 'textarea' && typeof factory[field.key] === 'string') keys.push(field.key)
        }
    }
    const stock = factory.stockPrompts
    if (stock && typeof stock === 'object' && !Array.isArray(stock)) {
        for (const [name, text] of Object.entries(stock as Record<string, unknown>)) if (typeof text === 'string') keys.push(`stockPrompts.${name}`)
    }
    const modules = factory.routerModules
    if (modules && typeof modules === 'object' && !Array.isArray(modules)) {
        for (const [id, module] of Object.entries(modules as Record<string, unknown>)) {
            const instruction = module && typeof module === 'object' ? (module as Record<string, unknown>).instruction : undefined
            if (typeof instruction === 'string') keys.push(`routerModules.${id}.instruction`)
        }
    }
    return keys
}

/** Read a flat stock key out of a settings bag; `undefined` when it is not a string there. */
export function readStockText(bag: SettingsBag, key: string): string | undefined {
    const parts = key.split('.')
    let node: unknown = bag
    for (const part of parts) {
        if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined
        node = (node as Record<string, unknown>)[part]
    }
    return typeof node === 'string' ? node : undefined
}

/** Write a flat stock key into a settings bag, making the path's objects fresh copies. */
export function writeStockText(bag: SettingsBag, key: string, text: string): void {
    const parts = key.split('.')
    let node: Record<string, unknown> = bag
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i]!
        const child = node[part]
        const copy = child && typeof child === 'object' && !Array.isArray(child) ? { ...(child as Record<string, unknown>) } : {}
        node[part] = copy
        node = copy
    }
    node[parts[parts.length - 1]!] = text
}

/**
 * Compare the install's stock texts with the factory's against the hashes
 * last written. `previous` absent is the first run: every key at the
 * factory's text is recorded, nothing is refreshed, and a key whose text
 * differs is not recorded as at the factory — so a later refresh will not
 * take it for an unedited one.
 */
export function planStockUpgrade(settings: SettingsBag, factory: SettingsBag, previous: StockHashes | null, now = new Date()): StockUpgradePlan {
    const next: SettingsBag = { ...settings }
    const hashes: Record<string, string> = {}
    const refreshed: string[] = []
    const kept: string[] = []
    for (const key of stockTextKeys(factory)) {
        const factoryText = readStockText(factory, key)
        if (factoryText === undefined) continue
        const factoryHash = hashText(factoryText)
        const stored = readStockText(settings, key)
        const storedHash = stored === undefined ? '' : hashText(stored)
        const seen = previous?.hashes[key]
        if (storedHash === factoryHash) {
            // At the factory's text, whatever the record says.
            hashes[key] = factoryHash
            continue
        }
        if (seen !== undefined && seen === storedHash) {
            // Never edited: the text is the factory's as it was. It takes the new one.
            writeStockText(next, key, factoryText)
            hashes[key] = factoryHash
            refreshed.push(key)
            continue
        }
        if (seen !== undefined && seen !== factoryHash) {
            // Edited, and the factory moved under it: the edit stands, and is named.
            kept.push(key)
        }
        // Edited (or unknown, on the first run): the record keeps the factory's current hash for next time.
        hashes[key] = factoryHash
    }
    return { refreshed, kept, settings: next, hashes: { version: 1, hashes, at: now.toISOString() } }
}

/** Read a stored record, refusing a shape this build does not know. */
export function readStockHashes(raw: unknown): StockHashes | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const record = raw as Record<string, unknown>
    if (record.version !== 1 || !record.hashes || typeof record.hashes !== 'object' || Array.isArray(record.hashes)) return null
    const hashes: Record<string, string> = {}
    for (const [key, value] of Object.entries(record.hashes as Record<string, unknown>)) if (typeof value === 'string') hashes[key] = value
    return { version: 1, hashes, at: typeof record.at === 'string' ? record.at : '' }
}

// ── the check, run once a session and on demand ─────────────────────────

/** What the last check did for a user: refreshed now, kept as edited, or pending with the switch off. */
export interface StockUpgradeReport {
    refreshed: string[]
    kept: string[]
    pending: string[]
    at: string
}

export interface StockUpgradeDeps {
    storage: {
        getJson<T>(path: string, options?: { fallback?: T; userId?: string }): Promise<T>
        setJson(path: string, value: unknown, options?: { indent?: number; userId?: string }): Promise<void>
    }
    store: {
        load(userId?: string): Promise<SettingsBag>
        replaceCartridgeSurface(userId: string | undefined, apply: (settings: SettingsBag) => void): Promise<SettingsBag>
    }
    prefs: { load(userId?: string): Promise<{ autoUpdatePrompts: boolean }> }
    factory: () => SettingsBag
    log: { info(message: string): void; warn(message: string): void }
    now?: () => Date
}

export interface StockUpgrade {
    /** Compare and, with the switch on or `force`, refresh. The settings whole come back with the report. */
    check(userId: string | undefined, force?: boolean): Promise<StockUpgradeReport & { settings: SettingsBag }>
    /** The last check's report for the user, for the status line. */
    last(userId: string | undefined): StockUpgradeReport | null
}

export function createStockUpgrade(deps: StockUpgradeDeps): StockUpgrade {
    const reports = new Map<string, StockUpgradeReport>()
    const key = (userId: string | undefined) => userId ?? '@self'

    return {
        async check(userId, force = false) {
            const settings = await deps.store.load(userId)
            const factory = deps.factory()
            let previous: StockHashes | null = null
            try {
                previous = readStockHashes(await deps.storage.getJson<unknown>(STOCK_HASHES_PATH, { fallback: null, userId }))
            } catch {
                previous = null
            }
            const auto = (await deps.prefs.load(userId)).autoUpdatePrompts !== false
            const plan = planStockUpgrade(settings, factory, previous, deps.now?.() ?? new Date())
            let next = settings
            let refreshed: string[] = []
            let pending: string[] = []
            const hashes = { ...plan.hashes, hashes: { ...plan.hashes.hashes } }
            if (plan.refreshed.length && (auto || force)) {
                next = await deps.store.replaceCartridgeSurface(userId, (live) => {
                    for (const k of plan.refreshed) {
                        const text = readStockText(factory, k)
                        if (text !== undefined) writeStockText(live, k, text)
                    }
                })
                refreshed = plan.refreshed
                deps.log.info(`settings: ${refreshed.length} stock texts refreshed to the pin’s after an update: ${refreshed.join(', ')}`)
            } else if (plan.refreshed.length) {
                // Not applied: the record keeps the hash the text still has, so a later refresh knows it.
                pending = plan.refreshed
                for (const k of pending) if (previous?.hashes[k]) hashes.hashes[k] = previous.hashes[k]!
                deps.log.info(`settings: ${pending.length} stock texts changed in this update and the refresh is off; Update changed prompts under Developer & reset puts them in: ${pending.join(', ')}`)
            } else if (!previous) {
                deps.log.info(`settings: stock-text record written for ${Object.keys(hashes.hashes).length} texts; an update that changes one is refreshed from here on`)
            }
            if (plan.kept.length) deps.log.info(`settings: ${plan.kept.length} edited texts kept where the factory’s changed: ${plan.kept.join(', ')}`)
            try {
                await deps.storage.setJson(STOCK_HASHES_PATH, hashes, { indent: 2, userId })
            } catch (error) {
                deps.log.warn(`settings: the stock-text record could not be written: ${error instanceof Error ? error.message : String(error)}`)
            }
            const report: StockUpgradeReport = { refreshed, kept: plan.kept, pending, at: hashes.at }
            reports.set(key(userId), report)
            return { ...report, settings: next }
        },
        last(userId) {
            return reports.get(key(userId)) ?? null
        },
    }
}
