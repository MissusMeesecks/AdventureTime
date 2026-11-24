/**
 * Game systems, and which half of one works here.
 *
 * A game system is not a thing the engine reads. It is a **join record**: the
 * legacy's own delete calls it *"a Game System bundle (GM section + tracker
 * module + order entry)"*, and nothing in `index.js`, `router.js`,
 * `narrative-hooks.js` or `llm-client.js` mentions `gameSystems` at all. Its
 * two halves are what do the work:
 *
 * | Half | Where it lives | Here |
 * |---|---|---|
 * | tracker module | `customFields[]`, keyed by `customFieldTag` | **real** — the extractor is told about it every turn |
 * | GM section | `customSyspromptLibrary[]`, keyed by `syspromptLibraryId` | **real** since Phase 27 — the rulebook sends it when it is on under Your world rules |
 *
 * When this module was written the second row read *nothing*: AdventureTime had no
 * narrator prompt, and an on/off switch on a system would have been Phase 21's
 * bug built deliberately. The rulebook has since been ported, so both halves
 * now reach a model — but each through its own switch, in its own editor. This
 * list stays a reading of the bundle, and says which switch is which; the
 * wizard under it (Phase 32) is where a system is made and edited.
 */

/** One game system, as the cartridge stores it. */
export interface GameSystem {
    id?: string
    name?: string
    icon?: string
    description?: string
    enabled?: boolean
    /** The tracker module half — a `customFields[].tag`. */
    customFieldTag?: string
    /** The GM section half — a `customSyspromptLibrary[].id`. */
    syspromptLibraryId?: string
    [key: string]: unknown
}

/** Just enough of a custom field to join against. */
export interface LinkedField {
    tag?: string
    enabled?: boolean
    [key: string]: unknown
}

/**
 * What this build can actually do with a system.
 *
 * `gm-only` and `broken` both draw an inert row, and they are kept apart for
 * the reason every verdict in this project is: they mean different things and
 * suggest different actions. A GM-only system is *correct data this build
 * cannot use*; a broken one is *a link that has come apart*.
 */
export type GameSystemVerdict = 'live' | 'off' | 'gm-only' | 'broken'

/** One system, arranged for reading. */
export interface GameSystemRow {
    id: string
    name: string
    icon: string
    description: string
    /** The tracker module's tag, or `''` when the system has no tracker half. */
    tag: string
    /** Whether that tag names a custom field that actually exists. */
    fieldExists: boolean
    /** Whether that field is switched on — the thing that decides `live`. */
    fieldEnabled: boolean
    /** The system's own flag, which is what the user set in the legacy's UI. */
    systemEnabled: boolean
    /**
     * The system's switch and its field's switch disagree.
     *
     * Worth surfacing because the user's mental model is the *system* — they
     * think "The Trail is on" — while the only switch that reaches the extractor
     * is the field's. A cartridge where the two have drifted apart will behave
     * in a way its own settings page contradicts.
     */
    disagrees: boolean
    verdict: GameSystemVerdict
}

/** One badge, explained once. */
export interface GameSystemLegendEntry {
    verdict: GameSystemVerdict
    label: string
    meaning: string
}

export interface GameSystemsView {
    rows: GameSystemRow[]
    /**
     * What each badge in this list means, once.
     *
     * The per-row note says the same sentence sixteen times on the maintainer's
     * own cartridge — *"Its tracker module [X] exists but is switched off"* —
     * which is a legend wearing a row's clothes. Only the verdicts actually
     * present are listed, so a healthy cartridge is not lectured about broken
     * links it does not have. Found by rendering twenty real rows; two test
     * rows could never have shown it.
     */
    legend: GameSystemLegendEntry[]
    /** `20 systems · 16 with a tracker module · 4 narrator rule only` */
    counts: string
    /** The empty list's line; empty when there are systems (what a system is stands behind the heading's `[?]`, 96). */
    summary: string
    /** Present only when something is actually wrong. */
    warning: string
}

/** The badge on a row, by verdict (96). The meanings are in the heading's `[?]`, once. */
export const GAME_SYSTEM_BADGES: Record<GameSystemVerdict, string> = {
    live: 'Tracked',
    off: 'Off',
    'gm-only': 'Narrator rule only',
    broken: 'Broken link',
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/**
 * Join the systems against the fields and say what each one amounts to.
 *
 * Pure, and takes both lists rather than the settings bag, so every rule here
 * is testable without a panel.
 */
export function buildGameSystemsView(
    systems: readonly GameSystem[] | undefined,
    fields: readonly LinkedField[] | undefined,
): GameSystemsView {
    const list = Array.isArray(systems) ? systems : []
    const byTag = new Map<string, LinkedField>()
    for (const field of Array.isArray(fields) ? fields : []) {
        const tag = text(field?.tag).trim().toUpperCase()
        if (tag) byTag.set(tag, field)
    }

    const rows: GameSystemRow[] = list.map((system) => {
        const tag = text(system.customFieldTag).trim().toUpperCase()
        const field = tag ? byTag.get(tag) : undefined
        const fieldExists = Boolean(field)
        const fieldEnabled = Boolean(field?.enabled)
        const systemEnabled = Boolean(system.enabled)

        const verdict: GameSystemVerdict = !tag
            ? 'gm-only'
            : !fieldExists
              ? 'broken'
              : fieldEnabled
                ? 'live'
                : 'off'

        return {
            id: text(system.id),
            name: text(system.name) || '(unnamed system)',
            icon: text(system.icon),
            description: text(system.description),
            tag,
            fieldExists,
            fieldEnabled,
            systemEnabled,
            // Only meaningful where both halves exist. A GM-only system has no
            // field to disagree with, and a broken one has lost the thing the
            // comparison would be against.
            disagrees: fieldExists && systemEnabled !== fieldEnabled,
            verdict,
        }
    })

    const withModule = rows.filter((row) => row.tag).length
    const gmOnly = rows.filter((row) => row.verdict === 'gm-only').length
    const counts = rows.length
        ? [
              `${rows.length} system${rows.length === 1 ? '' : 's'}`,
              `${withModule} with a tracker module`,
              `${gmOnly} narrator rule only`,
          ].join(' · ')
        : ''

    // What a system is stands behind the heading's `[?]` (96); only the empty list says anything here.
    const summary = rows.length
        ? ''
        : 'No game systems yet. Draft one with the wizard below, press Import system to load one from a file, or Paste system text for one shared as text. Export system and Copy as text appear on each system’s row.'

    // Only when something is actually wrong. A GM-only system is not wrong.
    const broken = rows.filter((row) => row.verdict === 'broken').length
    const drifted = rows.filter((row) => row.disagrees).length
    const problems: string[] = []
    if (broken > 0) {
        problems.push(
            `${broken} system${broken === 1 ? '' : 's'} name${broken === 1 ? 's' : ''} a tracker module that no longer exists.`,
        )
    }
    if (drifted > 0) {
        problems.push(
            drifted === 1
                ? '1 system is marked differently from its tracker module. The tracker module’s switch decides.'
                : `${drifted} systems are marked differently from their tracker module. The tracker module’s switch decides.`,
        )
    }

    const MEANINGS: Array<[GameSystemVerdict, string, string]> = [
        ['live', GAME_SYSTEM_BADGES.live, 'the tracker module is on, so the tracker updates it on every pass.'],
        ['off', GAME_SYSTEM_BADGES.off, 'the tracker module is off, so the tracker is not told about it.'],
        ['gm-only', GAME_SYSTEM_BADGES['gm-only'], 'there is no tracker module.'],
        ['broken', GAME_SYSTEM_BADGES.broken, 'the system names a tracker module that no longer exists.'],
    ]
    const present = new Set(rows.map((row) => row.verdict))
    const legend: GameSystemLegendEntry[] = MEANINGS.filter(([verdict]) => present.has(verdict)).map(
        ([verdict, label, meaning]) => ({ verdict, label, meaning }),
    )

    return { rows, legend, counts, summary, warning: problems.join(' ') }
}


/**
 * Carry a change to a tracker module across to the system it is half of.
 *
 * The two `enabled` flags are one fact stored twice, and **the panel used to
 * be able to break them apart in one click**: the custom fields editor wrote
 * only `customFields`, so switching a module there left its system behind and
 * manufactured exactly the drift the section above it reports. A warning about
 * a state your own UI creates with a tick is worse than no warning.
 *
 * So every write to the fields carries the systems with it. Only systems whose
 * tag names a field in this list move: a GM-only system has no module to
 * follow, and a broken one has lost the module it named — inventing a value
 * for either would be guessing at data the user has not touched.
 *
 * Pure, and returns the same array object when nothing moved, so a caller can
 * skip a needless patch.
 */
export function syncSystemsToFields(
    systems: readonly GameSystem[] | undefined,
    fields: readonly LinkedField[] | undefined,
): GameSystem[] {
    const list = Array.isArray(systems) ? systems : []
    const byTag = new Map<string, LinkedField>()
    for (const field of Array.isArray(fields) ? fields : []) {
        const tag = text(field?.tag).trim().toUpperCase()
        if (tag) byTag.set(tag, field)
    }

    return list.map((system) => {
        const tag = text(system.customFieldTag).trim().toUpperCase()
        const field = tag ? byTag.get(tag) : undefined
        if (!field) return system

        const enabled = Boolean(field.enabled)
        // Spread rather than rebuild, for rule 3a's reason one layer down: a
        // system carries fifteen properties and we understand six.
        return Boolean(system.enabled) === enabled ? system : { ...system, enabled }
    })
}
