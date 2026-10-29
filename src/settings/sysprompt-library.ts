/**
 * The custom sysprompt library — the maintainer's own writing.
 *
 * **This is the largest thing the port left behind, and it was mislabelled for
 * two phases.** `customSyspromptLibrary` and `syspromptSectionOrder` have no
 * runtime references, and Phase 24's sweep filed them under *inert storage —
 * do not build an editor*. The grep was right and the conclusion was backwards:
 * for a key holding 44 authored sections and 152,000 characters of a person's
 * own prose, "nothing reads this" is not dead weight, it is **the missing
 * feature**. Phase 23 said the GM half "travels in your cartridge untouched"
 * four times without asking whether it should.
 *
 * What these are: narrative direction for the storyteller. Voice, world rules,
 * biology, the meaning of a tracker block. In the legacy they are assembled
 * into the narrator's system prompt. Here they went in with a cartridge import
 * and did nothing at all.
 *
 * They can, though, and cheaply: the interceptor already puts the tracker memo
 * into every generation as a `role: 'system'` message, labelled in Lumiverse's
 * Prompt Breakdown. These go through the same door.
 *
 * ## What is deliberately not ported
 *
 * `syspromptSectionOrder` interleaves **`base:`** sections with **`lib:`** ones.
 * The `base:` text lives in the legacy build, not in the cartridge — 22 stock
 * narrator sections we do not have. Only the `lib:` half is here, and only the
 * `lib:` half is the user's own. Lumiverse supplies its own narrator framing
 * through the character card and system prompt, so these land as additive world
 * rules on top of it rather than as a replacement for it.
 *
 * `scope` (`chat` / `global`) and `globalEnabled` are **preserved untouched and
 * not interpreted**. On the golden cartridge every section is `scope: 'chat'`
 * and `enabled === true` agrees with `_chatSetupMember` on all four active
 * ones, so `enabled` is unambiguous there — but the legacy's exact scope rules
 * were not read, and guessing at them would be inventing behaviour for someone
 * else's data.
 */

/** One authored section, as the cartridge stores it. */
export interface SyspromptSection {
    id?: string
    /** The XML-ish name it wraps itself in, e.g. `embers`. */
    tag?: string
    /** The prose. This is the thing. */
    content?: string
    icon?: string
    description?: string
    enabled?: boolean
    [key: string]: unknown
}

export interface SyspromptRow {
    id: string
    tag: string
    icon: string
    description: string
    enabled: boolean
    /** Characters of prose. */
    size: number
    /** A rough token count, at four characters a token. */
    tokens: number
    /** Switched on with nothing in it — on, and silent. */
    empty: boolean
    /** Its place in `syspromptSectionOrder`, or -1 when the order forgot it. */
    position: number
}

export interface SyspromptView {
    rows: SyspromptRow[]
    /** `44 sections · 4 switched on` */
    counts: string
    /** What the switched-on ones cost the narrator every single turn. */
    cost: string
    summary: string
    notes: string[]
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/**
 * An icon we can actually draw, or nothing.
 *
 * The legacy stores Font Awesome **class names** here — `fa-hat-wizard`,
 * `fa-wand-magic-sparkles`, `fa-pen-to-square` — and renders them through a
 * stylesheet this build does not load. Printed as text they put
 * `fa-hat-wizard` in front of every single row, which is what happened the
 * first time these were rendered.
 *
 * The rule is the simplest one that separates the two cases: a glyph we can
 * draw is non-ASCII, and a class name is not. That keeps an emoji icon working
 * if one is ever stored here, without a list of prefixes to maintain.
 */
export function displayIcon(icon: unknown): string {
    const value = text(icon).trim()
    // eslint-disable-next-line no-control-regex
    return value && /[^\u0000-\u007f]/.test(value) ? value : ''
}

/** Four characters a token. Rough on purpose — it is a warning, not a bill. */
export const CHARS_PER_TOKEN = 4

/**
 * Order the sections the way `syspromptSectionOrder` says.
 *
 * `base:` entries are skipped: that text is not in the cartridge. A section the
 * order has forgotten is kept and appended rather than dropped, because losing
 * a switched-on section over a bookkeeping gap is the worst failure available
 * here — the whole point is that the user's writing reaches the model.
 */
export function orderSections(
    sections: readonly SyspromptSection[] | undefined,
    order: readonly string[] | undefined,
): SyspromptSection[] {
    const list = Array.isArray(sections) ? sections.filter(Boolean) : []
    const refs = Array.isArray(order) ? order : []

    const byId = new Map<string, SyspromptSection>()
    for (const section of list) {
        const id = text(section.id).trim()
        if (id) byId.set(id, section)
    }

    const placed: SyspromptSection[] = []
    const seen = new Set<string>()
    for (const ref of refs) {
        if (typeof ref !== 'string' || !ref.startsWith('lib:')) continue
        const id = ref.slice(4)
        const section = byId.get(id)
        if (section && !seen.has(id)) {
            placed.push(section)
            seen.add(id)
        }
    }

    for (const section of list) {
        const id = text(section.id).trim()
        if (!id || !seen.has(id)) placed.push(section)
    }

    return placed
}

/**
 * The text this turn's narrator prompt gets.
 *
 * Only sections switched on, in order, separated by a blank line. Empty when
 * nothing is on — the caller injects nothing rather than a heading with nothing
 * under it.
 *
 * Macros are **not** resolved here. This is a pure function and
 * `spindle.macros.resolve` is an async host call; the injection layer does it,
 * so `{{user}}` in a section reaches the model as the persona's name.
 */
export function assembleSysprompt(
    sections: readonly SyspromptSection[] | undefined,
    order: readonly string[] | undefined,
): string {
    return orderSections(sections, order)
        .filter((section) => section.enabled === true)
        .map((section) => text(section.content).trim())
        .filter((body) => body !== '')
        .join('\n\n')
}

export function buildSyspromptView(
    sections: readonly SyspromptSection[] | undefined,
    order: readonly string[] | undefined,
): SyspromptView {
    const ordered = orderSections(sections, order)
    const refs = Array.isArray(order) ? order : []

    const rows: SyspromptRow[] = ordered.map((section) => {
        const id = text(section.id).trim()
        const body = text(section.content).trim()
        const enabled = section.enabled === true
        return {
            id,
            tag: text(section.tag) || '(untagged section)',
            icon: displayIcon(section.icon),
            description: text(section.description),
            enabled,
            size: body.length,
            tokens: Math.round(body.length / CHARS_PER_TOKEN),
            empty: enabled && body === '',
            position: refs.indexOf(`lib:${id}`),
        }
    })

    const on = rows.filter((row) => row.enabled)
    const counts = rows.length
        ? `${rows.length} section${rows.length === 1 ? '' : 's'} · ${on.length} switched on`
        : ''

    const onTokens = on.reduce((sum, row) => sum + row.tokens, 0)
    const cost = on.length
        ? `About ${onTokens.toLocaleString()} tokens go to the narrator every turn.`
        : 'Nothing is being sent to the narrator.'

    const summary = rows.length
        ? 'These are your own instructions to the storyteller — voice, world rules, how a ' +
          'mechanic reads. Every section switched on is sent with every reply, on top of ' +
          'whatever your character card and system prompt already say.'
        : 'No custom sections in this cartridge.'

    const notes: string[] = []
    const empty = rows.filter((row) => row.empty)
    if (empty.length) {
        notes.push(
            `${empty.length} section${empty.length === 1 ? ' is' : 's are'} switched on with nothing ` +
                'written in them, so they are skipped.',
        )
    }
    const lost = rows.filter((row) => row.position < 0)
    if (lost.length) {
        notes.push(
            `${lost.length} section${lost.length === 1 ? ' is' : 's are'} missing from your saved ` +
                'order, so they are placed last. Nothing is lost.',
        )
    }

    return { rows, counts, cost, summary, notes }
}

/** Switch one section on or off, touching nothing else. */
export function setSectionEnabled(
    sections: readonly SyspromptSection[] | undefined,
    id: string,
    enabled: boolean,
): SyspromptSection[] {
    const list = Array.isArray(sections) ? sections : []
    return list.map((section) =>
        text(section.id).trim() === id && section.enabled !== enabled
            ? { ...section, enabled }
            : section,
    )
}

/**
 * Remove a section, and its reference in the order with it.
 *
 * Two keys, one result — lesson 29. A section deleted from the library while
 * `syspromptSectionOrder` still names it leaves a `lib:` reference pointing at
 * nothing, which is the "broken link" state the game systems reading exists to
 * report and there is no reason to manufacture one here.
 *
 * **Destructive.** The caller confirms; this only computes the result.
 */
export function deleteSection(
    sections: readonly SyspromptSection[] | undefined,
    order: readonly string[] | undefined,
    id: string,
): { customSyspromptLibrary: SyspromptSection[]; syspromptSectionOrder: string[] } {
    const list = Array.isArray(sections) ? sections : []
    const refs = Array.isArray(order) ? order : []
    return {
        customSyspromptLibrary: list.filter((section) => text(section.id).trim() !== id),
        syspromptSectionOrder: refs.filter((ref) => ref !== `lib:${id}`),
    }
}
