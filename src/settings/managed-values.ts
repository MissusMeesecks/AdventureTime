/**
 * Validators for the cartridge keys a dedicated editor owns.
 *
 * A `managed` field is one the settings panel lists but does not draw a plain
 * control for — "part of the cartridge surface, but edited by a dedicated
 * editor" is the schema's own wording. The store refused **every** write to such
 * a key, which meant the one editor that exists could not save: the custom
 * fields editor shipped in Phase 1c, and every change made in it since has been
 * thrown away with `Setting is not editable here: customFields`.
 *
 * So a managed field may now name a validator, and only then is it writable.
 * A managed key with no validator is still refused, loudly — which keeps the
 * guard meaning something and leaves `gameSystems`, which has no editor,
 * exactly as protected as it was.
 *
 * The guard was worth having. These are **cartridge keys**: whatever lands here
 * travels in every export the user ever makes, so the frontend does not get to
 * put arbitrary shapes into one. A validator is what replaces the refusal, not
 * a hole where the refusal used to be.
 */

/**
 * Read a custom fields array the way the cartridge stores it.
 *
 * The rule that matters most is **preservation**. The editor knows five
 * properties; the golden cartridge's sixteen fields carry **nine** —
 * `origin`, `scope`, `template` and `_chatSetupMember` as well. A validator
 * that rebuilt each field from the properties it understands would silently
 * strip the rest from all sixteen the first time a user edited any one of them,
 * and that loss would then travel in every export.
 *
 * So this normalises the properties it knows and copies everything else
 * through untouched.
 */
/**
 * The CYOA configuration, defended (Phase 31).
 *
 * Slots and presets keep only what the builder reads -- a type it knows (the
 * retired `roll` included, read as narrative by the builder), a label, a text
 * -- and every unknown key on the bag itself travels unchanged, as the
 * legacy's colour keys do: this build does not draw them and must not lose
 * them. A slot that is not an object is dropped; a preset that is not a list
 * is dropped; a bag that is not an object is refused.
 */
export function readCyoaConfig(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('cyoaConfig must be an object.')
    }
    const source = value as Record<string, unknown>
    const readSlots = (raw: unknown): Array<Record<string, unknown>> | null => {
        if (!Array.isArray(raw)) return null
        const slots: Array<Record<string, unknown>> = []
        for (const item of raw) {
            if (!item || typeof item !== 'object' || Array.isArray(item)) continue
            const slot = item as Record<string, unknown>
            const type = typeof slot.type === 'string' ? slot.type.trim() : ''
            if (!CYOA_SLOT_KINDS.has(type)) continue
            const clean: Record<string, unknown> = { type }
            for (const key of ['label', 'text', 'left', 'right']) {
                if (typeof slot[key] === 'string') clean[key] = slot[key]
            }
            slots.push(clean)
        }
        return slots
    }

    const clean: Record<string, unknown> = { ...source }
    const slots = readSlots(source.slots)
    if (slots) clean.slots = slots
    else delete clean.slots
    if (source.presets && typeof source.presets === 'object' && !Array.isArray(source.presets)) {
        const presets: Record<string, Array<Record<string, unknown>>> = {}
        for (const [name, raw] of Object.entries(source.presets as Record<string, unknown>)) {
            const list = readSlots(raw)
            if (name.trim() && list) presets[name.trim()] = list
        }
        clean.presets = presets
    } else {
        delete clean.presets
    }
    for (const key of ['useCustomPrompt', 'useEmojis', 'useXmlTag', 'useButtonTags', 'stripOldChoicesFromPrompt']) {
        if (source[key] !== undefined) clean[key] = Boolean(source[key])
    }
    if (source.customPromptText !== undefined) clean.customPromptText = String(source.customPromptText ?? '')
    return clean
}

const CYOA_SLOT_KINDS = new Set(['narrative', 'normal', 'trait', 'prefix', 'custom', 'roll'])

export function readCustomFields(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) {
        throw new Error('customFields must be a list of fields.')
    }

    const out: Array<Record<string, unknown>> = []
    for (const item of value) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue

        const field = item as Record<string, unknown>
        const tag = String(field.tag ?? '').trim().toUpperCase()
        // A field with no tag has no block to maintain and no row to draw. It
        // is dropped rather than rejected: one unusable entry must not cost the
        // user the other fifteen.
        if (!tag) continue

        // Everything the editor does not know about, unchanged — and the rest
        // left alone unless present, for the reason `readGameSystems` spells
        // out: filling a missing property in changes the cartridge. The golden
        // cartridge's sixteen fields happen to carry all five, so nothing
        // exposed this here; a hand-made field carrying four would have.
        const clean: Record<string, unknown> = { ...field, tag }
        if (typeof field.label === 'string') clean.label = field.label
        if (typeof field.icon === 'string') clean.icon = field.icon
        if (typeof field.prompt === 'string') clean.prompt = field.prompt
        if (field.enabled !== undefined) clean.enabled = Boolean(field.enabled)
        out.push(clean)
    }

    return out
}

/**
 * Read a game systems array the way the cartridge stores it.
 *
 * Same rule as `readCustomFields`, and it matters more here: the editor
 * understands six properties and the golden cartridge's twenty systems carry
 * **fifteen** — `scope`, `needsTracker`, `driverTime`, `driverGmAnnotation`,
 * `driverStatedFact`, `effectOwner`, `createdAt` and `_chatSetupMember` as
 * well. Every one of those is legacy wizard state we neither read nor
 * understand, and rebuilding a system from what we do understand would strip
 * nine properties from all twenty on the first edit.
 *
 * `id` is the required field rather than `name`: it is what
 * `syspromptSectionOrder` and the chat-setup catalog point at, so a system
 * without one is unreferenceable and cannot be half of a bundle.
 */
export function readGameSystems(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) {
        throw new Error('gameSystems must be a list of systems.')
    }

    const out: Array<Record<string, unknown>> = []
    for (const item of value) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue

        const system = item as Record<string, unknown>
        const id = String(system.id ?? '').trim()
        // Dropped rather than rejected, for the same reason an untagged custom
        // field is: one unusable entry must not cost the user the other
        // nineteen.
        if (!id) continue

        // Everything we do not understand, unchanged — and everything we *do*
        // understand left alone unless it is actually present. Filling a
        // missing property in is a mutation too: the golden cartridge's four
        // GM-only systems carry `customFieldTag: null`, and rewriting that to
        // `''` would have changed twenty rows of the maintainer's own export
        // the first time they touched one. The golden test caught it.
        const clean: Record<string, unknown> = { ...system, id }
        if (typeof system.name === 'string') clean.name = system.name
        if (typeof system.icon === 'string') clean.icon = system.icon
        if (typeof system.description === 'string') clean.description = system.description
        // Upper-cased to match `customFields[].tag`, which is what it joins
        // against — the legacy compares these with `.toUpperCase()` on both
        // sides, so normalising once means the join never has to guess.
        if (typeof system.customFieldTag === 'string') {
            clean.customFieldTag = system.customFieldTag.trim().toUpperCase()
        }
        if (system.enabled !== undefined) clean.enabled = Boolean(system.enabled)
        out.push(clean)
    }

    return out
}

/**
 * Read a flag table — `modules` and `syspromptModules`.
 *
 * Both are plain `Record<string, boolean>` in the factory, so there is nothing
 * to preserve the way there is for the two list keys — every value is a flag
 * and every flag is understood. What this does is narrow: refuse anything that
 * is not an object, and coerce each value to a boolean. Coerced rather than
 * refused because the legacy wrote these by hand and a truthy non-boolean is a
 * value the user already lives with.
 *
 * **It cannot check the key set, and that is worth stating rather than
 * implying.** A validator sees only the incoming value, so it has no way to
 * know a key was invented or dropped — which would matter, because the
 * extractor walks `stockPrompts` and asks `modules`, so an invented key is
 * inert and a dropped one reads as off, silently and in every export
 * afterwards. What actually prevents it is upstream: the editor renders one row
 * per key it was handed and offers no way to make a new one, and it patches the
 * table it read rather than one it built. There is a test for that, because a
 * guarantee living in another file is exactly the kind this project has watched
 * come untied.
 */
export function readFlagTable(key: string): (value: unknown) => Record<string, boolean> {
    return (value: unknown) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error(`${key} must be a table of switches.`)
        }

        const out: Record<string, boolean> = {}
        for (const [name, flag] of Object.entries(value as Record<string, unknown>)) {
            out[name] = Boolean(flag)
        }
        return out
    }
}

/**
 * Read the block order (37).
 *
 * A list of tags, the order the cards are drawn in. The validator keeps every
 * non-empty string, trimmed, and nothing else: upper-casing, appending the
 * stock tags and dropping unknown ones are the editor's normalisation, done
 * before the write, and a hand-edited cartridge's odd entry is harmless to
 * the view, which ignores what the memo does not carry.
 */
export function readBlockOrder(value: unknown): string[] {
    if (!Array.isArray(value)) {
        throw new Error('blockOrder must be a list of block tags.')
    }
    return value
        .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
        .filter((tag) => tag !== '')
}

/**
 * Read the stock module texts (36-bis).
 *
 * `stockPrompts` is the map the tracker's system prompt is assembled from:
 * `buildModulesInstructionText` walks it and asks `modules` whether each key
 * is on. Phase 36 gave it an editor and no validator, so the store refused
 * every save with `Setting is not editable here: stockPrompts` — the custom
 * fields editor's own first-day failure, repeated, because the panel test
 * answered the patch with a canned success and the store's guard was never in
 * the loop (lesson 46).
 *
 * The map must be an object; every key is kept, since a dropped key would
 * read as a module with no text in every export afterwards; every value is
 * read as a string, a non-string coerced rather than refused, as the flag
 * tables do, because the legacy wrote these by hand too. The key set cannot be
 * checked here any more than the flag tables' can — the editor patches the map
 * it read and offers no way to add a key, and there is a test for that.
 */
export function readStockPrompts(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('stockPrompts must be a table of module texts.')
    }
    const out: Record<string, string> = {}
    for (const [name, text] of Object.entries(value as Record<string, unknown>)) {
        out[name] = typeof text === 'string' ? text : String(text ?? '')
    }
    return out
}

/**
 * Read the custom sysprompt library.
 *
 * 21a's preservation rule, and it has never mattered more: these entries carry
 * **nine** properties (`id`, `tag`, `content`, `icon`, `description`, `origin`,
 * `scope`, `enabled`, `_chatSetupMember`, and `globalEnabled` on some), and the
 * `content` of one runs to fourteen thousand characters of the user's own
 * writing. A validator that rebuilt an entry from what the editor understands
 * would not strip a field here — it would strip a chapter.
 *
 * `scope` and `globalEnabled` are copied through **uninterpreted**. The legacy's
 * exact scope rules were not read, and guessing at them would be inventing
 * behaviour for someone else's data.
 */
export function readSyspromptLibrary(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) {
        throw new Error('customSyspromptLibrary must be a list of sections.')
    }

    const out: Array<Record<string, unknown>> = []
    for (const item of value) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue

        const section = item as Record<string, unknown>
        const id = String(section.id ?? '').trim()
        // Dropped rather than fatal: one unusable entry must not cost the user
        // the other forty-three. An entry with no id is unreferenceable by
        // `syspromptSectionOrder` and cannot be switched or deleted.
        if (!id) continue

        const clean: Record<string, unknown> = { ...section, id }
        if (typeof section.tag === 'string') clean.tag = section.tag.trim()
        if (section.enabled !== undefined) clean.enabled = Boolean(section.enabled)
        out.push(clean)
    }

    return out
}

/**
 * Read the sysprompt section order.
 *
 * A list of opaque references — `base:role`, `lib:1785874562308`. We interpret
 * only the `lib:` prefix and pass everything else through, because the `base:`
 * entries name stock narrator sections this build does not have and dropping
 * them would quietly rewrite the user's ordering for a legacy build they may
 * still open the cartridge in.
 */
export function readSectionOrder(value: unknown): string[] {
    if (!Array.isArray(value)) {
        throw new Error('syspromptSectionOrder must be a list of section references.')
    }
    return value.filter((ref): ref is string => typeof ref === 'string' && ref.trim() !== '')
}

/**
 * Read the agent's modules (47e).
 *
 * `routerModules` is the map the agent's prompt lists its categories from
 * (`agentModuleLines`): a module per key with its switch, tag, format and
 * instruction. Every key is kept, since a dropped key is a category the
 * agent stops recording in every export afterwards; every module must be
 * an object; its four known fields are read as what they are, a
 * non-string coerced as the stock prompts' are, and anything else on it
 * copied through, since the legacy wrote these by hand.
 */
export function readRouterModules(value: unknown): Record<string, Record<string, unknown>> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('routerModules must be a table of agent modules.')
    }
    const out: Record<string, Record<string, unknown>> = {}
    for (const [key, module] of Object.entries(value as Record<string, unknown>)) {
        if (!module || typeof module !== 'object' || Array.isArray(module)) {
            throw new Error(`routerModules.${key} must be a module.`)
        }
        const m = module as Record<string, unknown>
        out[key] = {
            ...m,
            ...(m.enabled !== undefined ? { enabled: !!m.enabled } : {}),
            ...(m.tag !== undefined ? { tag: String(m.tag ?? '') } : {}),
            ...(m.format !== undefined ? { format: String(m.format ?? '') } : {}),
            ...(m.instruction !== undefined ? { instruction: String(m.instruction ?? '') } : {}),
        }
    }
    return out
}

/**
 * Read the agent's custom tags (47e): a list of `{ tag, instruction }`
 * with whatever else a row carries (`format`) copied through. A row that
 * is not an object is refused rather than dropped, so a broken editor
 * cannot quietly shorten the list.
 */
export function readRouterCustomTags(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) throw new Error('routerCustomTags must be a list of tags.')
    return value.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new Error(`routerCustomTags[${index}] must be a tag.`)
        }
        const e = entry as Record<string, unknown>
        return { ...e, tag: String(e.tag ?? ''), instruction: String(e.instruction ?? '') }
    })
}

/** One section as the sections editor stores it (77); `src/tracker/creator.ts` has the face's type. */
export interface CoreSectionRecord { id: string; name: string; description: string; icon: string; color: string; hiddenUntilSet?: boolean }

/**
 * `npcCoreSections` and `pcCoreSections` (77): the legacy's section shape —
 * id, name, description, icon, colour, *hidden until set* — a name required
 * as the legacy's Save requires it (its words), an id slugged from the name
 * where none is given as the legacy slugs it. An empty list is allowed: it
 * means the stock sections, as the legacy resolves it.
 */
export function validateCoreSections(value: unknown): CoreSectionRecord[] {
    if (!Array.isArray(value)) throw new Error('The sections must be a list')
    return value.map((raw, index) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Section ${index + 1} is not an object`)
        const section = raw as Record<string, unknown>
        const name = typeof section.name === 'string' ? section.name : ''
        if (!name.trim()) throw new Error('All sections must have a name.')
        const id = typeof section.id === 'string' && section.id.trim() ? section.id.trim() : name.trim().toLowerCase().replace(/[^a-z0-9]/g, '_')
        const out: CoreSectionRecord = {
            id,
            name,
            description: typeof section.description === 'string' ? section.description : '',
            icon: typeof section.icon === 'string' ? section.icon : '',
            color: typeof section.color === 'string' && section.color.trim() ? section.color.trim() : '#aaaaaa',
        }
        if (section.hiddenUntilSet === true) out.hiddenUntilSet = true
        return out
    })
}

/** `npcSectionPresets` and `pcSectionPresets` (77): a name to a list of sections; the legacy's older `{ sections }` shape read too, the list kept. */
export function validateSectionPresets(value: unknown): Record<string, CoreSectionRecord[]> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The section presets must be an object of lists by name')
    const out: Record<string, CoreSectionRecord[]> = {}
    for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
        if (!name.trim()) throw new Error('A section preset needs a name')
        const list = raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray((raw as { sections?: unknown }).sections) ? (raw as { sections: unknown }).sections : raw
        try {
            out[name] = validateCoreSections(list)
        } catch (error) {
            throw new Error(`The preset "${name}": ${error instanceof Error ? error.message : String(error)}`)
        }
    }
    return out
}
