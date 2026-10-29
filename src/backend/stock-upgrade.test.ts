import { describe, it, expect } from 'vitest'

import {
    createStockUpgrade,
    hashText,
    planStockUpgrade,
    readStockHashes,
    readStockText,
    stockTextKeys,
    writeStockText,
    STOCK_HASHES_PATH,
    type StockHashes,
} from './stock-upgrade.js'
import { getFactoryCartridgePayload } from '../state/factory.js'
import type { SettingsBag } from '../settings/schema.js'

const factory = (): SettingsBag => getFactoryCartridgePayload() as SettingsBag

describe('the stock texts (72a)', () => {
    it('hashes texts apart, the same text the same', () => {
        expect(hashText('a')).toBe(hashText('a'))
        expect(hashText('a')).not.toBe(hashText('b'))
        expect(hashText('')).toHaveLength(16)
    })

    it('names every prompt of the schema, every stock module text and every agent instruction', () => {
        const keys = stockTextKeys(factory())
        expect(keys).toContain('systemPromptTemplate')
        expect(keys).toContain('worldProgressionSystemPrompt')
        expect(keys).toContain('stockPrompts.party')
        expect(keys).toContain('routerModules.npc.instruction')
        // Never the user's own: the library, the fields, the systems.
        expect(keys.some((k) => k.startsWith('customSyspromptLibrary'))).toBe(false)
        expect(keys).not.toContain('gameSystems')
    })

    it('reads and writes a nested key without touching its neighbours', () => {
        const bag: SettingsBag = { stockPrompts: { party: 'p', quests: 'q' } }
        expect(readStockText(bag, 'stockPrompts.party')).toBe('p')
        expect(readStockText(bag, 'stockPrompts.none')).toBeUndefined()
        const before = bag.stockPrompts
        writeStockText(bag, 'stockPrompts.party', 'new')
        expect(bag.stockPrompts).toEqual({ party: 'new', quests: 'q' })
        expect(bag.stockPrompts).not.toBe(before)
    })

    it('records the hashes on a first run and refreshes nothing, an edit standing', () => {
        const settings: SettingsBag = { ...factory(), systemPromptTemplate: 'my own extractor' }
        const plan = planStockUpgrade(settings, factory(), null)
        expect(plan.refreshed).toEqual([])
        expect(plan.kept).toEqual([])
        expect(plan.settings.systemPromptTemplate).toBe('my own extractor')
        // The record carries the factory's hash for every key, the edited one too.
        expect(plan.hashes.hashes.systemPromptTemplate).toBe(hashText(String(factory().systemPromptTemplate)))
    })

    it('refreshes a text still at the old factory, keeps an edited one and names it', () => {
        const old = factory()
        const previous: StockHashes = { version: 1, hashes: { systemPromptTemplate: hashText('old factory extractor'), 'stockPrompts.party': hashText('old party text') }, at: 't' }
        const settings: SettingsBag = { ...old, systemPromptTemplate: 'old factory extractor', stockPrompts: { ...(old.stockPrompts as Record<string, string>), party: 'my party text' } }
        const plan = planStockUpgrade(settings, old, previous)
        expect(plan.refreshed).toEqual(['systemPromptTemplate'])
        expect(plan.kept).toEqual(['stockPrompts.party'])
        expect(plan.settings.systemPromptTemplate).toBe(old.systemPromptTemplate)
        expect((plan.settings.stockPrompts as Record<string, string>).party).toBe('my party text')
        expect(plan.hashes.hashes['stockPrompts.party']).toBe(hashText((old.stockPrompts as Record<string, string>).party!))
    })

    it('refuses a record in a shape it does not know', () => {
        expect(readStockHashes(null)).toBeNull()
        expect(readStockHashes({ version: 2, hashes: {} })).toBeNull()
        expect(readStockHashes({ version: 1, hashes: { a: 'x', b: 2 }, at: 't' })).toEqual({ version: 1, hashes: { a: 'x' }, at: 't' })
    })
})

describe('the check (72a)', () => {
    function harness(options: { auto?: boolean; previous?: StockHashes | null; settings?: Partial<SettingsBag> } = {}) {
        const files = new Map<string, unknown>()
        if (options.previous) files.set(STOCK_HASHES_PATH, options.previous)
        let live: SettingsBag = { ...factory(), ...(options.settings ?? {}) }
        const log: string[] = []
        const upgrade = createStockUpgrade({
            storage: {
                getJson: async <T,>(path: string, o?: { fallback?: T }) => (files.has(path) ? files.get(path) : o?.fallback) as T,
                setJson: async (path, value) => { files.set(path, value) },
            },
            store: {
                load: async () => ({ ...live }),
                replaceCartridgeSurface: async (_u, apply) => { const next = { ...live }; apply(next); live = next; return next },
            },
            prefs: { load: async () => ({ autoUpdatePrompts: options.auto !== false }) },
            factory,
            log: { info: (m) => log.push(m), warn: (m) => log.push(`warn: ${m}`) },
        })
        return { upgrade, files, log, live: () => live }
    }

    it('refreshes with the switch on, writes the record, and reports', async () => {
        const previous: StockHashes = { version: 1, hashes: { systemPromptTemplate: hashText('old') }, at: 't' }
        const h = harness({ previous, settings: { systemPromptTemplate: 'old' } })
        const report = await h.upgrade.check('u1')
        expect(report.refreshed).toEqual(['systemPromptTemplate'])
        expect(report.pending).toEqual([])
        expect(h.live().systemPromptTemplate).toBe(factory().systemPromptTemplate)
        expect(report.settings.systemPromptTemplate).toBe(factory().systemPromptTemplate)
        expect((h.files.get(STOCK_HASHES_PATH) as StockHashes).hashes.systemPromptTemplate).toBe(hashText(String(factory().systemPromptTemplate)))
        expect(h.log[0]).toContain('1 stock texts refreshed')
        expect(h.upgrade.last('u1')?.refreshed).toEqual(['systemPromptTemplate'])
    })

    it('holds the refresh with the switch off, keeps the old hash so a later refresh still knows the text, and refreshes on demand', async () => {
        const previous: StockHashes = { version: 1, hashes: { systemPromptTemplate: hashText('old') }, at: 't' }
        const h = harness({ auto: false, previous, settings: { systemPromptTemplate: 'old' } })
        const report = await h.upgrade.check('u1')
        expect(report.pending).toEqual(['systemPromptTemplate'])
        expect(report.refreshed).toEqual([])
        expect(h.live().systemPromptTemplate).toBe('old')
        expect((h.files.get(STOCK_HASHES_PATH) as StockHashes).hashes.systemPromptTemplate).toBe(hashText('old'))
        const forced = await h.upgrade.check('u1', true)
        expect(forced.refreshed).toEqual(['systemPromptTemplate'])
        expect(h.live().systemPromptTemplate).toBe(factory().systemPromptTemplate)
    })

    it('writes the record on a first run and says so', async () => {
        const h = harness()
        const report = await h.upgrade.check(undefined)
        expect(report.refreshed).toEqual([])
        expect(h.files.has(STOCK_HASHES_PATH)).toBe(true)
        expect(h.log[0]).toContain('stock-text record written')
    })
})
