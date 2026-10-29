/**
 * The order the cards are drawn in (Phase 37, roadmap row 11).
 *
 * `blockOrder` is a cartridge key with one reader in this build: `orderBlockTags`
 * in `src/tracker/view.ts`, which lays the cards out in the panel and under
 * each message — anything the order names and the memo carries first, in that
 * order, then anything else alphabetically. The tracker's prompt is **not**
 * ordered by it: `buildModulesInstructionText` walks `stockPrompts`, and the
 * memo's blocks keep whatever order the model wrote them in. So the key is
 * display, and an editor for it moves cards and nothing else.
 *
 * The legacy's editor is the module order list in its settings (`ui-editors.js`,
 * `refreshOrderList`): every stock and custom block in one list with an up and
 * a down arrow, the order saved whole. It normalises the list on every draw —
 * stock tags appended if missing, custom tags appended as fields are made,
 * anything that is neither dropped — and so does this, in `normalizeBlockOrder`,
 * which is why the golden cartridge's order carries `QUESTS` and sixteen custom
 * tags after the factory's eight. What this does not copy: the legacy moves a
 * row only within its half of the list (active or inactive), and drops
 * `QUESTS` when the quests module is off. One list is what the view reads, so
 * one list is what is drawn, with the switched-off rows dimmed.
 */

import { BLOCK_ICONS, BLOCK_ORDER, DEFAULT_BLOCK_ICON } from '../tracker/view.js'

export interface BlockOrderSettings {
    blockOrder?: string[]
    customFields?: Array<{ tag: string; label?: string; icon?: string; enabled?: boolean; [key: string]: unknown }>
    modules?: Record<string, boolean>
    [key: string]: unknown
}

export interface BlockOrderRow {
    /** The memo tag, upper case: `COMBAT`, `RADS`. */
    tag: string
    /** `Combat`, or the custom field's label. */
    label: string
    icon: string
    /** A custom field's block rather than a stock one. */
    custom: boolean
    /** Whether the module that maintains it is switched on; off rows are dimmed, not hidden. */
    enabled: boolean
}

export interface BlockOrderView {
    rows: BlockOrderRow[]
    /** The normalised order the rows are in. */
    order: string[]
    /** True when the order is the stock one: the factory's eight, quests, then the custom fields as made. */
    stock: boolean
}

function cleanTag(raw: unknown): string {
    return String(raw ?? '').trim().toUpperCase()
}

/** The custom fields' tags, in the order the fields are kept, deduplicated. */
function customTags(settings: BlockOrderSettings): string[] {
    const out: string[] = []
    for (const field of Array.isArray(settings.customFields) ? settings.customFields : []) {
        const tag = cleanTag(field?.tag)
        if (tag && !BLOCK_ORDER.includes(tag) && !out.includes(tag)) out.push(tag)
    }
    return out
}

/** The order with nothing moved: the stock blocks, then the custom fields as they were made. */
export function stockBlockOrder(settings: BlockOrderSettings): string[] {
    return [...BLOCK_ORDER, ...customTags(settings)]
}

/**
 * The saved order, made whole: known tags kept in the order given, every
 * missing stock or custom tag appended, anything else dropped. The legacy's
 * `refreshOrderList` does the same before it draws.
 */
export function normalizeBlockOrder(settings: BlockOrderSettings): string[] {
    const custom = customTags(settings)
    const known = new Set([...BLOCK_ORDER, ...custom])
    const out: string[] = []
    for (const raw of Array.isArray(settings.blockOrder) ? settings.blockOrder : []) {
        const tag = cleanTag(raw)
        if (known.has(tag) && !out.includes(tag)) out.push(tag)
    }
    for (const tag of [...BLOCK_ORDER, ...custom]) if (!out.includes(tag)) out.push(tag)
    return out
}

function sameOrder(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((tag, index) => tag === b[index])
}

export function buildBlockOrderView(settings: BlockOrderSettings): BlockOrderView {
    const order = normalizeBlockOrder(settings)
    const fields = Array.isArray(settings.customFields) ? settings.customFields : []
    const modules = settings.modules ?? {}
    const rows = order.map((tag): BlockOrderRow => {
        const field = fields.find((candidate) => cleanTag(candidate?.tag) === tag)
        if (field && !BLOCK_ORDER.includes(tag)) {
            return {
                tag,
                label: typeof field.label === 'string' && field.label.trim() ? field.label.trim() : tag,
                icon: typeof field.icon === 'string' && field.icon ? field.icon : DEFAULT_BLOCK_ICON,
                custom: true,
                enabled: field.enabled !== false,
            }
        }
        return {
            tag,
            label: tag === 'XP' ? 'XP' : tag.charAt(0) + tag.slice(1).toLowerCase(),
            icon: BLOCK_ICONS[tag] ?? DEFAULT_BLOCK_ICON,
            custom: false,
            enabled: modules[tag.toLowerCase()] !== false,
        }
    })
    return { rows, order, stock: sameOrder(order, stockBlockOrder(settings)) }
}

/**
 * Swap a block with its neighbour. `null` when there is nothing to do — the
 * tag is not in the order, or it is already at that end — so the caller
 * writes nothing.
 */
export function moveBlock(settings: BlockOrderSettings, tag: string, delta: -1 | 1): string[] | null {
    const order = normalizeBlockOrder(settings)
    const from = order.indexOf(cleanTag(tag))
    const to = from + delta
    if (from < 0 || to < 0 || to >= order.length) return null
    const next = [...order]
    next[from] = order[to]!
    next[to] = order[from]!
    return next
}
