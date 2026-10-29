/**
 * Settings persistence.
 *
 * This is the module the whole migration is about. The legacy build kept its
 * settings inside SillyTavern's single shared `settings.json`, alongside every
 * other extension, with concurrent writers and no ownership — which is the
 * defect its author quit over, and the reason ~1,400 lines of defensive
 * persistence code existed to survive it.
 *
 * Spindle gives each extension its own storage, and `userStorage` scopes that
 * per user on top. There is no shared file, no other writer, and nothing to
 * defend against. So this module is what the durable-persistence layer,
 * serializer worker and localStorage WAL collapse into: read a file, write a
 * file, and keep writes for one user in order.
 *
 * The one piece of real care is that last part. Two patches landing in the
 * same tick must not both read-modify-write the same starting state, or the
 * second silently drops the first. Writes are therefore chained per user.
 */

import { getFactoryCartridgePayload } from '../state/factory.js'
import { reconcileRngFlags } from '../settings/rng-flags.js'
import { CARTRIDGE_PAYLOAD_KEYS } from '../state/payload-groups.js'
import { coerce, derivedAllowedValues, fieldForKey, type SettingsBag } from '../settings/schema.js'

/** The slice of `spindle.userStorage` this module needs. */
export interface SettingsStorage {
    getJson<T>(path: string, options?: { fallback?: T; userId?: string }): Promise<T>
    setJson(path: string, value: unknown, options?: { indent?: number; userId?: string }): Promise<void>
}

/** Where settings live inside the extension's per-user storage. */
export const SETTINGS_PATH = 'settings.json'

/** Stand-in user key for single-user installs, where `userId` is undefined. */
const DEFAULT_USER = '@self'

/**
 * A fresh settings object: the factory cartridge surface and nothing else.
 *
 * Note what this does *not* include — the saved cartridge library, UI state,
 * connection choices. Those are settings too, but they are not part of the
 * cartridge surface, and Phase 0 has no features that need them yet.
 */
export function createDefaultSettings(): SettingsBag {
    return getFactoryCartridgePayload()
}

/**
 * Fill in keys a stored settings file predates.
 *
 * Same rule as a partial cartridge: a missing key takes its factory value
 * rather than being an error. That is what lets an install survive an update
 * that adds settings.
 */
export function withFactoryDefaults(stored: SettingsBag | null | undefined): SettingsBag {
    const settings = createDefaultSettings()
    if (!stored || typeof stored !== 'object') return settings
    for (const [key, value] of Object.entries(stored)) {
        if (value !== undefined) settings[key] = value
    }
    return settings
}

export class SettingsStore {
    readonly #storage: SettingsStorage
    readonly #cache = new Map<string, SettingsBag>()
    readonly #loads = new Map<string, Promise<SettingsBag>>()
    readonly #writes = new Map<string, Promise<unknown>>()

    constructor(storage: SettingsStorage) {
        this.#storage = storage
    }

    #userKey(userId?: string): string {
        return userId ?? DEFAULT_USER
    }

    /**
     * Read a user's settings, from cache if we have them.
     *
     * A read failure is not fatal: the caller gets factory defaults, which is
     * the same answer a first run gives. Losing a settings file should not
     * take the panel down with it.
     *
     * Concurrent first reads share one in-flight promise. Without that, two
     * patches arriving before the file has loaded would each build their own
     * settings object, each mutate its own copy, and the second write would
     * silently erase the first — the stale-write race that the legacy build
     * spent ~1,400 lines defending against. It cannot happen here because
     * there is only ever one object per user.
     */
    load(userId?: string): Promise<SettingsBag> {
        const key = this.#userKey(userId)

        const cached = this.#cache.get(key)
        if (cached) return Promise.resolve(cached)

        const inFlight = this.#loads.get(key)
        if (inFlight) return inFlight

        const load = (async (): Promise<SettingsBag> => {
            let stored: SettingsBag | null = null
            try {
                stored = await this.#storage.getJson<SettingsBag | null>(SETTINGS_PATH, {
                    fallback: null,
                    userId,
                })
            } catch {
                stored = null
            }

            const settings = withFactoryDefaults(stored)
            this.#cache.set(key, settings)
            this.#loads.delete(key)
            return settings
        })()

        this.#loads.set(key, load)
        return load
    }

    /**
     * The cached settings for a user, without awaiting a read.
     *
     * The interceptor runs inside the generation's latency budget, so it reads
     * through this and never through `load()`. Returns undefined if nothing is
     * loaded yet, and the caller is expected to inject nothing rather than
     * block.
     */
    snapshot(userId?: string): SettingsBag | undefined {
        return this.#cache.get(this.#userKey(userId))
    }

    /**
     * Apply a partial update and persist it.
     *
     * Every key is checked against the settings schema and coerced to the
     * expected type. A key the schema does not own is rejected outright — the
     * frontend cannot invent settings keys, and a typo fails loudly here
     * instead of quietly creating a key that no cartridge will ever carry.
     *
     * The frontend is our own code, but it is still the untrusted side of a
     * message channel, so nothing arrives here on trust.
     */
    async patch(userId: string | undefined, patch: SettingsBag): Promise<SettingsBag> {
        const settings = await this.load(userId)

        for (const [key, raw] of Object.entries(patch)) {
            const field = fieldForKey(key)
            if (!field) throw new Error(`Unknown setting: ${key}`)
            if (field.type === 'managed') {
                // A managed key belongs to a dedicated editor rather than to a
                // plain control, and until one exists there is nothing that
                // could legitimately write it — so a managed field with no
                // validator is still refused. With one, the editor's value goes
                // through it: these are cartridge keys, and whatever lands here
                // travels in every export the user ever makes.
                //
                // This refusal used to be unconditional, which meant the custom
                // fields editor could not save at all. It threw on every commit
                // and the message landed in the shared status line, where the
                // next tracker event wiped it.
                if (!field.validate) throw new Error(`Setting is not editable here: ${key}`)
                settings[key] = field.validate(raw)
                continue
            }

            if (field.type === 'derived') {
                // A derived key has no type of its own to coerce against, so
                // accept only what one of the control's options produces.
                if (!derivedAllowedValues(field, key).some((allowed) => allowed === raw)) {
                    throw new Error(`Invalid value for ${key}`)
                }
                settings[key] = raw
                continue
            }

            settings[key] = coerce(field, raw)
        }

        // The dice flags follow the RNG mode and d100 mode follows the flags,
        // as Multihog's panel kept them; see `rng-flags.ts`.
        Object.assign(settings, reconcileRngFlags(settings, Object.keys(patch)))

        await this.#persist(userId, settings)
        return settings
    }

    /**
     * Replace the whole cartridge surface — what a cartridge import does.
     *
     * Keys outside the surface are left alone, because that is precisely what
     * `applyCartridgePayload` guarantees and what makes a cartridge load
     * non-destructive to everything else.
     */
    async replaceCartridgeSurface(
        userId: string | undefined,
        apply: (settings: SettingsBag) => void,
    ): Promise<SettingsBag> {
        const settings = await this.load(userId)
        apply(settings)
        await this.#persist(userId, settings)
        return settings
    }

    /** Restore the factory value for a set of keys. */
    async resetKeys(userId: string | undefined, keys: string[]): Promise<SettingsBag> {
        const settings = await this.load(userId)
        const factory = getFactoryCartridgePayload()
        for (const key of keys) {
            if (!CARTRIDGE_PAYLOAD_KEYS.includes(key)) throw new Error(`Not a cartridge setting: ${key}`)
            settings[key] = factory[key]
        }
        await this.#persist(userId, settings)
        return settings
    }

    /**
     * Queue a write behind any write already in flight for this user.
     *
     * Serializing per user is the whole of the concurrency story. It is enough
     * because nothing else writes this file.
     */
    #persist(userId: string | undefined, settings: SettingsBag): Promise<void> {
        const key = this.#userKey(userId)
        const previous = this.#writes.get(key) ?? Promise.resolve()
        const next = previous
            .catch(() => undefined)
            .then(() => this.#storage.setJson(SETTINGS_PATH, settings, { indent: 2, userId }))
        this.#writes.set(key, next)
        return next
    }

    /** Resolve once every queued write for this user has landed. */
    async flush(userId?: string): Promise<void> {
        await this.#writes.get(this.#userKey(userId))
    }
}
