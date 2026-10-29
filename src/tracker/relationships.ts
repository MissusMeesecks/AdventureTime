/**
 * The relationship system's grammar (Phase 44): Multihog's friendship and
 * affection component, the typed face of `relationships-legacy.js`.
 *
 * Two axes per NPC, each from -max to +max (150 by default), each with
 * thirteen tiers that carry a behavioural hint for the narrator. The values
 * move three ways in the legacy: the narrator annotates a moment inline
 * (`*(Friendship: Marcus +10 — saved his life)*`) and either the State
 * Tracker turns the annotations into a `[RELATIONS]` command block that code
 * applies (the default mode) or a regex reads them off the reply directly;
 * and the Lorebook Agent sets starting values when it first records an NPC.
 * The narrator is shown the standings at the top of every turn as
 * `[NPC_RELATIONS]`, built here from the store's view.
 *
 * The name scan the awards need (`fuzzyResolveNpcName`) is a closure over the
 * legacy's manifest and is transcribed as `resolveNpcName`; the standings
 * block's text is transcribed and pinned to `narrative-hooks.js`.
 */

import { createRelationshipsLegacy } from './relationships-legacy.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const plain = createRelationshipsLegacy() as unknown as Record<string, any>

export type RelationshipField = 'friendship' | 'affection'
export const RELATIONSHIP_FIELDS: readonly RelationshipField[] = ['friendship', 'affection']

export interface RelationshipTier {
    label: string
    hint: string
}

/** One change asked of the store: the NPC as named, the axis, the signed delta. */
export interface RelationshipCommand {
    npc: string
    field: RelationshipField
    delta: number
}

export const DEFAULT_RELATIONSHIP_MAX = 150

/** The legacy's scale rule: a whole number from 10 to 10000, 150 when unreadable. */
export function normalizeRelationshipMax(raw: unknown): number {
    return plain.normalizeNpcRelationshipMax(raw) as number
}

export function clampRelationshipValue(value: unknown, max: number): number {
    return plain.clampRelationshipValue(value, max) as number
}

/** Bar fill in percent of the track: half the track is the whole scale, as the legacy draws it. */
export function relationshipBarPct(value: number, max: number): number {
    return plain.relationshipBarPct(value, max) as number
}

export function friendshipTier(value: number, max: number): RelationshipTier {
    return plain.getFriendshipTier(value, max) as RelationshipTier
}

export function affectionTier(value: number, max: number): RelationshipTier {
    return plain.getAffectionTier(value, max) as RelationshipTier
}

export function tierOf(field: RelationshipField, value: number, max: number): RelationshipTier {
    return field === 'friendship' ? friendshipTier(value, max) : affectionTier(value, max)
}

/** The legacy's inline style for a tier pill: hue by axis and sign, intensity by |value| / max. */
export function tierBadgeStyle(field: RelationshipField, value: number, max: number): string {
    return plain.getRelTierBadgeStyle(field, value, max) as string
}

/**
 * The State Tracker's `[RELATIONS]` block, read out of its reply and removed
 * from the memo text: `Friendship +5 Exact NPC Name` per line. An unclosed
 * block runs to the end of the reply, as the legacy has it.
 */
export function extractRelationshipCommands(text: string | null | undefined): { memo: string; commands: RelationshipCommand[] } {
    const result = plain.extractStateTrackerRelationshipCommands(text ?? '') as { memo: string; commands: Array<{ npc: string; field: RelationshipField; delta: number }> }
    return { memo: result.memo, commands: result.commands.map((c) => ({ npc: c.npc, field: c.field, delta: c.delta })) }
}

/** The instruction appended to the tracker's prompt that asks for the block; a custom text may carry `{{max}}`. */
export function relationshipCommandInstruction(max: number, customPrompt = ''): string {
    return plain.buildStateTrackerRelationshipCommandInstruction(max, false, customPrompt) as string
}

/**
 * The agent's starting-value section, its `{{p30}}`-style placeholders
 * expanded for the scale — from the cartridge's `routerRelSectionAgentTemplate`
 * since 72c, the pin's text when that is blank, as the legacy's
 * `buildNpcRelationshipInstruction` reads it.
 */
export function agentRelationshipSection(max: number, template?: string | null): string {
    const text = String(template ?? '').trim() || (plain.DEFAULT_ROUTER_REL_SECTION_AGENT as string)
    return (plain.expandRelationshipPctPlaceholders(text, max) as string).trim()
}

// ── The narrator's annotations ──────────────────────────────────────────────

/**
 * The legacy's regex for an inline award: `*(Friendship: Marcus +10 — reason)*`,
 * the asterisks optional, the name everything between the colon and the
 * number. The text piece is held to `narrative-hooks.js` by the pin test.
 */
export const NARRATIVE_AWARD_SOURCE = '\\*?\\(\\s*(friendship|affection)\\s*:\\s*(.+?)\\s+([+-]?\\d+)[^)]*\\)\\*?'

/** Every award the narrator wrote into a reply, once each: the same tag twice is one award, as the legacy's processed-tag list has it. */
export function narrativeAwards(text: string | null | undefined): RelationshipCommand[] {
    const pattern = new RegExp(NARRATIVE_AWARD_SOURCE, 'gi')
    const seen = new Set<string>()
    const out: RelationshipCommand[] = []
    for (const match of String(text ?? '').matchAll(pattern)) {
        const field = match[1]!.toLowerCase() as RelationshipField
        const npc = match[2]!.trim()
        const delta = parseInt(match[3]!, 10)
        if (!npc || !Number.isFinite(delta) || delta === 0) continue
        if (seen.has(match[0])) continue
        seen.add(match[0])
        out.push({ npc, field, delta })
    }
    return out
}

// ── Who is meant ────────────────────────────────────────────────────────────

export interface NpcNameEntry {
    id: string
    label: string
    keys: readonly string[]
}

/** A label with a leading `[tag]` dropped, as the legacy strips it. */
function cleanLabel(label: string): string {
    return String(label ?? '').replace(/^\[.*?\]\s*/i, '').trim()
}

/**
 * The legacy's `fuzzyResolveNpcName`: an exact label wins at once; else the
 * label that contains the name or is contained by it (three letters or more),
 * nearest in length; an exact keyword wins at once too, and a containing
 * keyword counts like a label. Nothing, and the award has nobody to go to.
 */
export function resolveNpcName(query: string, entries: readonly NpcNameEntry[]): NpcNameEntry | null {
    const wanted = String(query ?? '').toLowerCase().trim()
    if (!wanted) return null
    let best: NpcNameEntry | null = null
    let bestDiff = Infinity
    const consider = (candidate: string, entry: NpcNameEntry): void => {
        if (candidate.length >= 3 && (candidate.includes(wanted) || wanted.includes(candidate))) {
            const diff = Math.abs(candidate.length - wanted.length)
            if (diff < bestDiff) {
                bestDiff = diff
                best = entry
            }
        }
    }
    for (const entry of entries) {
        const label = cleanLabel(entry.label).toLowerCase()
        if (!label) continue
        if (label === wanted) return entry
        consider(label, entry)
        // The legacy's keyword loop: an exact keyword takes the entry and stops
        // reading keys but not entries (a later exact label still wins, and a
        // later nearer label still can); a containing keyword counts once.
        for (const key of entry.keys) {
            const k = String(key ?? '').toLowerCase().trim()
            if (!k) continue
            if (k === wanted) {
                best = entry
                break
            }
            if (k.length >= 3 && (k.includes(wanted) || wanted.includes(k))) {
                consider(k, entry)
                break
            }
        }
    }
    return best
}

// ── The narrator's standings ────────────────────────────────────────────────

export interface RelationshipStanding {
    id: string
    label: string
    friendship: number
    affection: number
}

/** The legacy's text, piece by piece, held to `narrative-hooks.js` by the pin test. */
export const RELATIONS_TEXT = {
    open: '[NPC_RELATIONS]\n',
    none: 'No established relationships yet.\n[/NPC_RELATIONS]',
    headerA: 'Current relationship standings between the protagonist and present NPCs. Both axes range from -',
    headerB: '. Let the tier descriptions below each NPC guide how they behave toward {{user}} this turn.',
    close: '\n[/NPC_RELATIONS]',
} as const

export function formatSigned(n: number): string {
    return `${n >= 0 ? '+' : ''}${n}`
}

/**
 * The legacy's `buildNpcRelationsBlock`: every tracked NPC with both values
 * and both tiers, or the placeholder that tells the narrator the system is
 * on and nobody is tracked yet. `{{user}}` is left for the host's macros.
 */
export function buildNpcRelationsBlock(standings: readonly RelationshipStanding[], max: number): string {
    const T = RELATIONS_TEXT
    if (!standings.length) return `${T.open}${T.none}`
    const lines = standings.map((s) => {
        const f = clampRelationshipValue(s.friendship, max)
        const a = clampRelationshipValue(s.affection, max)
        const ft = friendshipTier(f, max)
        const at = affectionTier(a, max)
        return `${s.label}: Friendship ${formatSigned(f)}, Affection ${formatSigned(a)}\n  Friendship tier: ${ft.label} — ${ft.hint}\n  Affection tier: ${at.label} — ${at.hint}`
    })
    return `${T.open}${T.headerA}${max} to +${max}${T.headerB}\n\n${lines.join('\n\n')}${T.close}`
}

/** The update modes: the tracker's command block (the legacy's default), or the regex over the narrator's reply. */
export type RelationshipMode = 'state_tracker' | 'regex'

export function normalizeRelationshipMode(value: unknown): RelationshipMode {
    return value === 'regex' ? 'regex' : 'state_tracker'
}
