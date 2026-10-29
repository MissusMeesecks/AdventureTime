/**
 * The Display Groups (roadmap row 73, Phase 75): the typed face over the
 * twenty-second generated file, Multihog's `src/features/display-groups.js`
 * sliced whole.
 *
 * A group is a display-only bundling of module cards under one shared
 * header, the members' own headers hidden: an id, a name, an icon, an
 * enabled flag and an ordered list of member tags. It never touches the
 * memo, the prompts, the module switches or the wizard's systems. The
 * grammar is the legacy's — the three tags that can never be grouped, the
 * normaliser (the first group to claim a tag wins), the render plan (the
 * members present in a memo replaced by one virtual host at the first
 * member's position, in the group's own order; the flat list byte for byte
 * with the switch off), the mover that carries a group's members through
 * the section order together, and the virtual key — and this file only
 * types it. The one AdventureTime piece beside it is the module list the manager
 * offers, which the legacy keeps in its popup (`display-groups.js`,
 * `knownDisplayGroupModules`) and is transcribed here in the same shape.
 */
import { createDisplayGroupsLegacy, LEGACY_DISPLAY_GROUP_CSS } from './display-groups-legacy.js'
import { BLOCK_ICONS, BLOCK_ORDER, DEFAULT_BLOCK_ICON, type CustomField } from './view.js'

export interface DisplayGroup {
    id: string
    name: string
    icon: string
    enabled: boolean
    /** Member tags, upper case, in the order the group draws them. */
    members: string[]
}

/** One entry of the render plan: a module drawn as its own card, or a group drawn as one host holding its present members. */
export type DisplayGroupPlanEntry =
    | { kind: 'module'; tag: string }
    | { kind: 'group'; key: string; group: DisplayGroup; tags: string[] }

interface Legacy {
    DISPLAY_GROUP_EXCLUDED_TAGS: Set<string>
    normalizeDisplayGroupTag(value: unknown): string
    displayGroupRenderKey(id: unknown): string
    normalizeDisplayGroups(value: unknown): DisplayGroup[]
    buildDisplayGroupRenderPlan(tags: unknown, groups: unknown, enabled: unknown): DisplayGroupPlanEntry[]
    moveDisplayGroupInOrder(order: unknown, members: unknown, direction: 'up' | 'down'): string[]
}

const legacy = createDisplayGroupsLegacy() as unknown as Legacy

/** The three blocks that can never be grouped: `COMBAT`, `BENCHED PARTY`, `QUESTS`. */
export const DISPLAY_GROUP_EXCLUDED_TAGS: ReadonlySet<string> = legacy.DISPLAY_GROUP_EXCLUDED_TAGS
/** The group card's stylesheet rules, the legacy's own, as text. */
export const DISPLAY_GROUP_CSS: string = LEGACY_DISPLAY_GROUP_CSS

/** The legacy's: a tag as the groups keep it, upper case, letters, digits, underscores and spaces only. */
export const normalizeDisplayGroupTag = (value: unknown): string => legacy.normalizeDisplayGroupTag(value)
/** The legacy's virtual key for a group's card and tab, `DISPLAY_GROUP_<id>`; `''` for an id with nothing safe in it. */
export const displayGroupRenderKey = (id: unknown): string => legacy.displayGroupRenderKey(id)
/** The legacy's normaliser: at most fifty groups of at most a hundred members, an id and a name required, the excluded tags dropped, a tag kept by the first group that claims it. */
export const normalizeDisplayGroups = (value: unknown): DisplayGroup[] => legacy.normalizeDisplayGroups(value)
/** The preference's reader is the legacy's normaliser. */
export const readDisplayGroups = normalizeDisplayGroups
/** The legacy's plan over the ordered tags a memo holds. */
export const planDisplayGroups = (tags: readonly string[], groups: readonly DisplayGroup[] | unknown, enabled: boolean): DisplayGroupPlanEntry[] =>
    legacy.buildDisplayGroupRenderPlan(tags, groups, enabled)
/** The legacy's mover: every present member of the group moved one place together, the rest of the order kept. */
export const moveDisplayGroupInOrder = (order: readonly string[], members: readonly string[], direction: 'up' | 'down'): string[] =>
    legacy.moveDisplayGroupInOrder(order, members, direction)

/** One module the manager may offer a group: a stock block or a custom field, with where it came from. */
export interface DisplayGroupModule {
    tag: string
    icon: string
    label: string
    kind: 'Stock' | 'Wizard' | 'Custom'
}

/**
 * The modules a group may hold, as the legacy's manager lists them: the stock
 * blocks in their stock order less the three excluded, then the custom fields
 * (a wizard's marked so), each tag once.
 */
export function knownDisplayGroupModules(settings: { customFields?: unknown }): DisplayGroupModule[] {
    const stock: DisplayGroupModule[] = BLOCK_ORDER
        .filter((tag) => !DISPLAY_GROUP_EXCLUDED_TAGS.has(tag))
        .map((tag) => ({ tag, icon: BLOCK_ICONS[tag] || DEFAULT_BLOCK_ICON, label: tag, kind: 'Stock' }))
    const fields = Array.isArray(settings.customFields) ? (settings.customFields as Array<Partial<CustomField> | null>) : []
    const custom: DisplayGroupModule[] = fields
        .map((field) => ({
            tag: String(field?.tag || '').toUpperCase(),
            icon: (typeof field?.icon === 'string' && field.icon) || DEFAULT_BLOCK_ICON,
            label: (typeof field?.label === 'string' && field.label) || String(field?.tag || '') || 'Custom Module',
            kind: (field?.origin === 'wizard' ? 'Wizard' : 'Custom') as 'Wizard' | 'Custom',
        }))
        .filter((item) => item.tag && !DISPLAY_GROUP_EXCLUDED_TAGS.has(item.tag))
    const seen = new Set<string>()
    return [...stock, ...custom].filter((item) => !seen.has(item.tag) && !!seen.add(item.tag))
}
