/**
 * Spell slots and hit dice, read for the pips (Phase 38, roadmap row 70).
 *
 * The legacy draws two kinds of pip. A `[SPELLS]` line `Level 1 (2/4): Hunter's
 * Mark, Longstrider` is a row: the level, four blue pips with two lit, and the
 * spell names as chips linking to the 5e wiki (`renderer.js`, the `SPELLS`
 * case). A party member's or the character's `Spells:` sub-line is the same
 * rows, one per group, with the groups joined by `|` on one line
 * (`renderSpellGroups`), and a `Spells:` line that has no levels on it falls
 * back to pills. An `HD: d10 (3/5)` sub-line is the die in brackets and five
 * gold pips with three lit (`renderHDPips`).
 *
 * This module is the reading; `lines.ts` decides where it applies (the
 * `[SPELLS]` block, and the lines hanging off an entity) and `render.ts` draws
 * it. The regexes are the legacy's, kept verbatim.
 */

export interface SpellGroup {
    /** `Level 1` or `Cantrips`, as written. */
    label: string
    /** Slots available of the maximum; `null` for cantrips and for a group written without them. */
    slots: { available: number; max: number } | null
    spells: string[]
}

/** A `[SPELLS]` line: the level, its slots, and a spell list that must be there. */
const BLOCK_LINE_RX = /^(Level\s*\d+|Cantrips?)\s*(?:\((\d+)\/(\d+)[^)]*\))?\s*:\s*(.+)$/i

/** One group of an entity's `Spells:` value: the spell list may be missing. */
const GROUP_RX = /^(Level\s*\d+|Cantrips?)\s*(?:\((\d+)\/(\d+)[^)]*\))?\s*(?::\s*(.+))?$/i

const HIT_DICE_RX = /^([^(]+?)\s*(?:\(([\d,]+)\/([\d,]+)\))?$/

function toGroup(match: RegExpMatchArray): SpellGroup {
    const [, label, available, max, list] = match
    const cantrip = /cantrip/i.test(label!)
    return {
        label: label!.trim(),
        slots: !cantrip && available !== undefined && max !== undefined ? { available: parseInt(available, 10), max: parseInt(max, 10) } : null,
        spells: list ? list.split(',').map((name) => name.trim()).filter(Boolean) : [],
    }
}

/** A `[SPELLS]` block line, or `null` when it is not one. */
export function parseSpellBlockLine(line: string): SpellGroup | null {
    const match = line.trim().match(BLOCK_LINE_RX)
    return match ? toGroup(match) : null
}

/**
 * The groups on an entity's `Spells:` value. Several groups share one line
 * joined by `|`; a piece that is not a group is skipped, as the legacy skips
 * it. Empty when none is a group — the flat case.
 *
 * The legacy splits only when the value also names a level or cantrips. That
 * second test is dead: a piece can match only by naming one, so a value that
 * names none yields no groups whether it is split or not. A mutation removing
 * it stayed green, and it is gone rather than kept untestable.
 */
export function parseSpellGroups(value: string): SpellGroup[] {
    const pieces = value.includes('|') ? value.split(/\s*\|\s*/) : [value]
    const groups: SpellGroup[] = []
    for (const piece of pieces) {
        const match = piece.trim().match(GROUP_RX)
        if (match) groups.push(toGroup(match))
    }
    return groups
}

/** An `HD:` value with a fraction, or `null` to draw it as written. */
export function parseHitDice(value: string): { die: string; current: number; max: number } | null {
    const match = value.trim().match(HIT_DICE_RX)
    if (!match || match[2] === undefined || match[3] === undefined) return null
    return {
        die: match[1]!.trim(),
        current: parseInt(match[2].replace(/,/g, ''), 10),
        max: parseInt(match[3].replace(/,/g, ''), 10),
    }
}

/** Where a spell's chip links: the 5e wiki, by the legacy's slug. */
export const SPELL_WIKI = 'https://dnd5e.wikidot.com/spell:'

export function spellSlug(name: string): string {
    return name.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-')
}
