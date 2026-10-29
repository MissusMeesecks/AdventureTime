import { describe, it, expect } from 'vitest'

import { SettingsStore, SETTINGS_PATH, createDefaultSettings, withFactoryDefaults } from './settings-store.js'
import type { SettingsStorage } from './settings-store.js'
import { CARTRIDGE_PAYLOAD_KEYS } from '../state/payload-groups.js'
import { SETTINGS_SCHEMA } from '../settings/schema.js'

/** An in-memory stand-in for `spindle.userStorage`, one bucket per user. */
class FakeStorage implements SettingsStorage {
    files = new Map<string, unknown>()
    writes = 0
    /** Set to delay writes, so overlapping saves can be observed. */
    writeDelayMs = 0

    #key(path: string, userId?: string): string {
        return `${userId ?? '@self'}:${path}`
    }

    async getJson<T>(path: string, options?: { fallback?: T; userId?: string }): Promise<T> {
        const value = this.files.get(this.#key(path, options?.userId))
        return (value === undefined ? options?.fallback : value) as T
    }

    async setJson(path: string, value: unknown, options?: { userId?: string }): Promise<void> {
        if (this.writeDelayMs) await new Promise((r) => setTimeout(r, this.writeDelayMs))
        this.writes += 1
        this.files.set(this.#key(path, options?.userId), JSON.parse(JSON.stringify(value)))
    }
}

describe('default settings', () => {
    it('start as the full factory cartridge surface', () => {
        const settings = createDefaultSettings()
        expect(Object.keys(settings).sort()).toEqual([...CARTRIDGE_PAYLOAD_KEYS].sort())
    })

    it('backfill keys a stored file predates', () => {
        const settings = withFactoryDefaults({ rngEnabled: false })
        expect(settings.rngEnabled).toBe(false)
        for (const key of CARTRIDGE_PAYLOAD_KEYS) expect(settings[key]).not.toBeUndefined()
    })

    it('keep settings outside the cartridge surface', () => {
        const settings = withFactoryDefaults({ someLocalPreference: 'keep me' })
        expect(settings.someLocalPreference).toBe('keep me')
    })

    it('survive a corrupt or missing file', () => {
        expect(Object.keys(withFactoryDefaults(null))).toHaveLength(CARTRIDGE_PAYLOAD_KEYS.length)
    })
})

describe('SettingsStore', () => {
    it('serves factory defaults on a first run and does not write until asked', async () => {
        const storage = new FakeStorage()
        const store = new SettingsStore(storage)

        const settings = await store.load('u1')
        expect(settings.rngEnabled).toBe(true)
        expect(storage.writes).toBe(0)
    })

    it('keeps users apart', async () => {
        const storage = new FakeStorage()
        const store = new SettingsStore(storage)

        await store.patch('u1', { use24hTime: true })
        const other = await store.load('u2')

        expect(other.use24hTime).toBe(false)
        expect(storage.files.has(`u1:${SETTINGS_PATH}`)).toBe(true)
        expect(storage.files.has(`u2:${SETTINGS_PATH}`)).toBe(false)
    })

    it('coerces a patch to the type the setting expects', async () => {
        const store = new SettingsStore(new FakeStorage())
        const settings = await store.patch('u1', { portraitPromptWordTarget: '250', use24hTime: 'yes' })

        expect(settings.portraitPromptWordTarget).toBe(250)
        expect(settings.use24hTime).toBe(true)
    })

    it('clamps an out-of-range number instead of storing it', async () => {
        const store = new SettingsStore(new FakeStorage())
        const settings = await store.patch('u1', { portraitPromptWordTarget: 999999 })
        expect(settings.portraitPromptWordTarget).toBe(2000)
    })

    it('refuses a key the schema does not own', async () => {
        const store = new SettingsStore(new FakeStorage())
        await expect(store.patch('u1', { notASetting: 1 })).rejects.toThrow(/Unknown setting/)
    })

    it('refuses a managed key\'s value its validator refuses, and takes what it accepts', async () => {
        // Every managed key has an editor and a validator since 77 (the
        // sections were the last four; this was `modules` until Phase 24,
        // `cyoaConfig` until 31, `blockOrder` until 37). The refusal of a
        // managed key with no validator stays in the store for the next key
        // a phase adds before its editor; what is tested here is the
        // validator's gate, which is what the guard exists to force.
        const store = new SettingsStore(new FakeStorage())
        await expect(store.patch('u1', { npcCoreSections: [{ name: '' }] } as never)).rejects.toThrow(/All sections must have a name/)
        await expect(store.patch('u1', { npcCoreSections: 'x' } as never)).rejects.toThrow(/must be a list/)
        const saved = await store.patch('u1', { npcCoreSections: [{ name: 'Voice', description: 'How they speak.' }] } as never)
        expect(saved.npcCoreSections).toEqual([{ id: 'voice', name: 'Voice', description: 'How they speak.', icon: '', color: '#aaaaaa' }])
    })

    it('writes derived keys as a pair', async () => {
        const store = new SettingsStore(new FakeStorage())
        const settings = await store.patch('u1', { rngEnabled: false, diceFunctionTool: false })
        expect(settings.rngEnabled).toBe(false)
        expect(settings.diceFunctionTool).toBe(false)
    })

    // Multihog's panel kept the four dice switches in step with the mode; the
    // store does it here so a cartridge edited from anywhere gets the same.
    it('sets the four dice switches to match a new RNG mode', async () => {
        const store = new SettingsStore(new FakeStorage())
        const hybrid = await store.patch('u1', { rngEnabled: true, diceFunctionTool: true })
        expect(hybrid.rngToolD20).toBe(true)
        expect(hybrid.rngQueueD20).toBe(true)
        expect(hybrid.rngToolD100).toBe(false)
        const off = await store.patch('u1', { rngEnabled: false, diceFunctionTool: false })
        expect(off.rngToolD20).toBe(false)
        expect(off.rngQueueD20).toBe(false)
    })

    it('turns d100 mode on when a d100 switch is ticked, and leaves other keys alone', async () => {
        const store = new SettingsStore(new FakeStorage())
        const s = await store.patch('u1', { rngToolD100: true })
        expect(s.diceD100Mode).toBe(true)
        const t = await store.patch('u1', { narrativePacing: 'downtime' })
        expect(t.diceD100Mode).toBe(true)
        expect(t.rngToolD100).toBe(true)
    })

    it('rejects a value no derived control could have produced', async () => {
        // The frontend is our own code, but it is still the untrusted side of
        // a message channel.
        const store = new SettingsStore(new FakeStorage())
        await expect(store.patch('u1', { rngEnabled: 'banana' })).rejects.toThrow(/Invalid value/)
    })

    it('does not lose a patch to an overlapping one', async () => {
        // The failure this guards is the one that killed the legacy build:
        // two writes racing, the later one built on stale state.
        const storage = new FakeStorage()
        storage.writeDelayMs = 5
        const store = new SettingsStore(storage)

        await Promise.all([
            store.patch('u1', { use24hTime: true }),
            store.patch('u1', { useDdMmYyFormat: true }),
        ])
        await store.flush('u1')

        const stored = storage.files.get(`u1:${SETTINGS_PATH}`) as Record<string, unknown>
        expect(stored.use24hTime).toBe(true)
        expect(stored.useDdMmYyFormat).toBe(true)
    })

    it('reads back what it wrote', async () => {
        const storage = new FakeStorage()
        await new SettingsStore(storage).patch('u1', { use24hTime: true })

        const settings = await new SettingsStore(storage).load('u1')
        expect(settings.use24hTime).toBe(true)
    })

    it('falls back to defaults when storage throws', async () => {
        const broken: SettingsStorage = {
            async getJson() { throw new Error('disk on fire') },
            async setJson() {},
        }
        const settings = await new SettingsStore(broken).load('u1')
        expect(Object.keys(settings)).toHaveLength(CARTRIDGE_PAYLOAD_KEYS.length)
    })

    it('has no snapshot before a load, and one after', async () => {
        const store = new SettingsStore(new FakeStorage())
        expect(store.snapshot('u1')).toBeUndefined()
        await store.load('u1')
        expect(store.snapshot('u1')).toBeDefined()
    })

    it('resets keys to their factory values', async () => {
        const store = new SettingsStore(new FakeStorage())
        await store.patch('u1', { use24hTime: true })

        const settings = await store.resetKeys('u1', ['use24hTime'])
        expect(settings.use24hTime).toBe(false)
    })

    it('refuses to reset something that is not a cartridge setting', async () => {
        const store = new SettingsStore(new FakeStorage())
        await expect(store.resetKeys('u1', ['nope'])).rejects.toThrow(/Not a cartridge setting/)
    })
})

/**
 * Managed keys — the ones a dedicated editor owns.
 *
 * There was no test here at all, and that is exactly how the custom fields
 * editor shipped unable to save: the editor was tested against a fake, the
 * store was tested on editable keys, and nothing crossed the seam between them.
 * Every commit the editor made threw `Setting is not editable here`.
 */
describe('managed settings', () => {
    it('stores custom fields, which is what the editor sends', async () => {
        const store = new SettingsStore(new FakeStorage())

        const settings = await store.patch('u1', {
            customFields: [{ tag: 'QUIVER', prompt: 'Track the arrows.', enabled: true }],
        } as never)

        // Exactly what was sent, with nothing invented: filling in the two
        // properties the editor did not send would change the cartridge.
        expect(settings.customFields).toEqual([
            { tag: 'QUIVER', prompt: 'Track the arrows.', enabled: true },
        ])
    })

    it('keeps them across a reload, not just in the returned bag', async () => {
        const storage = new FakeStorage()
        await new SettingsStore(storage).patch('u1', {
            customFields: [{ tag: 'QUIVER', prompt: 'Track the arrows.', enabled: true }],
        } as never)

        const reloaded = await new SettingsStore(storage).load('u1')
        expect((reloaded.customFields as Array<{ tag: string }>)[0]!.tag).toBe('QUIVER')
    })

    // The guard still means something, and every managed key in the schema now
    // has a validator — `gameSystems` gained one with its editor — so this
    // asserts the rule against a field built for the purpose rather than
    // against whichever key happens to be unfinished this month. A future
    // managed key added without a validator has to stay refused.
    it('has a validator on every managed key since 77, so none is refused for want of one', () => {
        // The sections and their presets were the last four managed keys
        // without an editor (the panel said *dedicated editor not built yet*);
        // 77 gave them one. The store's refusal of a managed key with no
        // validator stays for the next key a phase adds before its editor.
        const without = SETTINGS_SCHEMA.flatMap((section) => section.fields.filter((field) => field.type === 'managed' && !field.validate)).map((field) => field.key)
        expect(without).toEqual([])
    })

    // Written down because the ratio is the point: a managed key is *refused by
    // default*, and an editor is what earns it a validator. The list catches a
    // validator without an editor; it cannot catch an editor without a
    // validator, which is how `stockPrompts` shipped refused (36-bis) -- the
    // round trip below is what catches that.
    it('has validators for exactly the managed keys with editors', () => {
        const withValidator = SETTINGS_SCHEMA.flatMap((section) =>
            section.fields.filter((field) => field.type === 'managed' && field.validate),
        ).map((field) => field.key)

        // Two of these have no editor of their own and are writable anyway:
        // `syspromptModules` because the modules editor's quests row has to
        // clear a gate living in it, and `syspromptSectionOrder` because
        // deleting a world-rule section has to take its place in the order with
        // it. The validator is what makes each safe, which is the point -- the
        // guard is "checked before it is stored", not "has a panel".
        // The two preset keys (63b) are written by the backend's own preset
        // ops, through the store, so each has a validator; the styles editor
        // is mounted on the saved setups' row.
        expect(withValidator.sort()).toEqual([
            'activePortraitPromptPresetId',
            'blockOrder',
            'customFields',
            'customSyspromptLibrary',
            'cyoaConfig',
            'gameSystems',
            'modules',
            'npcCoreSections',
            'npcSectionPresets',
            'pcCoreSections',
            'pcSectionPresets',
            'routerCustomTags',
            'routerModules',
            'savedPortraitPromptPresets',
            'stockPrompts',
            'syspromptModules',
            'syspromptSectionOrder',
        ])
    })

    // The stock module texts, saved whole (36-bis). Phase 36's editor shipped
    // without this, and every save was refused with the custom fields editor's
    // old message. A validator is what makes the key writable; this proves the
    // store takes the editor's patch and the next load carries the new cap.
    it('writes stockPrompts through the editor\'s validator', async () => {
        const storage = new FakeStorage()
        const store = new SettingsStore(storage)
        const factory = (await store.load('u1')).stockPrompts as Record<string, string>
        const party = factory.party!.replace('(max 5 + {{user}})', '(max 8 + {{user}})')
        expect(party).not.toBe(factory.party)

        await store.patch('u1', { stockPrompts: { ...factory, party } } as never)

        const reloaded = (await new SettingsStore(storage).load('u1')).stockPrompts as Record<string, string>
        expect(reloaded.party).toContain('(max 8 + {{user}})')
        expect(Object.keys(reloaded)).toEqual(Object.keys(factory))
        await expect(store.patch('u1', { stockPrompts: [] } as never)).rejects.toThrow(/table of module texts/)
    })

    // The cards' order, saved whole (37) -- through the real store, per lesson 46.
    it('writes blockOrder through the editor\'s validator', async () => {
        const storage = new FakeStorage()
        const store = new SettingsStore(storage)
        const order = ['CHARACTER', 'COMBAT', 'PARTY', 'INVENTORY', 'ABILITIES', 'SPELLS', 'XP', 'TIME', 'QUESTS']

        await store.patch('u1', { blockOrder: [...order, '', 7] } as never)

        expect((await new SettingsStore(storage).load('u1')).blockOrder).toEqual(order)
        await expect(store.patch('u1', { blockOrder: 'COMBAT' } as never)).rejects.toThrow(/list of block tags/)
    })

    // A patch is all-or-nothing: a bad value must not leave half of it applied.
    it('rejects the whole patch when the value is the wrong shape', async () => {
        const store = new SettingsStore(new FakeStorage())

        await expect(store.patch('u1', { customFields: 'nope' } as never)).rejects.toThrow(/must be a list/)
        expect((await store.load('u1')).customFields).toEqual([])
    })
})
