/**
 * The relationship system (Phase 44, roadmap row 86): Multihog's friendship
 * and affection component, as a service over the per-chat store.
 *
 * Four things move a value and all four come through here, so the scale, the
 * clamp, the log and the name resolution are one rule: the State Tracker's
 * `[RELATIONS]` block (the legacy's default mode), the narrator's inline
 * awards read by regex (the other mode), the Lorebook Agent's `rel` commit
 * items (starting values for an NPC it just recorded), and the fold's own
 * slider. The narrator is shown the standings at the top of each turn as
 * `[NPC_RELATIONS]`, built from memory; the tracker's prompt carries the
 * command instruction in tracker mode and nothing in regex mode — the legacy's
 * *the inactive method receives no instructions and does not run*.
 *
 * The switch is the cartridge's `npcRelationshipBars` (Character Sheets →
 * Relationship system); the scale and the mode are preferences, since neither
 * is a cartridge key here. Nothing in this file touches a lorebook.
 */

import { bookStanding, resolveCampaignPrefix } from '../agent/campaign.js'
import { stripStamp } from '../agent/provenance.js'
import { isNpcBookName } from '../tracker/scene.js'
import {
    affectionTier,
    agentRelationshipSection,
    buildNpcRelationsBlock,
    DEFAULT_RELATIONSHIP_MAX,
    extractRelationshipCommands,
    narrativeAwards,
    normalizeRelationshipMax,
    normalizeRelationshipMode,
    relationshipCommandInstruction,
    resolveNpcName,
    friendshipTier,
    type NpcNameEntry,
    type RelationshipCommand,
    type RelationshipField,
    type RelationshipMode,
} from '../tracker/relationships.js'
import type { RelationshipChange, RelationshipRecord, RelationshipSource, RelationshipStore } from './relationship-store.js'
import type { RelationshipsView } from '../protocol.js'

export interface RelationshipPrefs {
    relationshipMax?: number
    relationshipMode?: string
    relationshipTrackerPrompt?: string
    campaignNames?: Record<string, string>
    campaignBooks?: Record<string, string[]>
}

export interface RelationshipsDeps {
    store: RelationshipStore
    /** The cartridge, for the switch; the snapshot for the synchronous reads. */
    settings: {
        load(userId?: string): Promise<Record<string, unknown>>
        snapshot(userId?: string): Record<string, unknown> | undefined | null
    }
    prefs: {
        load(userId?: string): Promise<RelationshipPrefs>
        snapshot(userId?: string): RelationshipPrefs | undefined
    }
    /** The campaign's books, for who an award is for. */
    books: (userId: string | undefined) => {
        listBooks(): Promise<Array<{ id: string; name: string }>>
        listEntries(bookId: string): Promise<Array<{ uid: string; comment: string; key?: string[] }>>
    }
    /** The chat, for the regex mode's read of the latest reply. */
    messages?: (chatId: string, userId: string | undefined) => Promise<Array<{ id?: string; role: string; content: string }>>
    log: { info(m: string): void; warn(m: string): void }
    now?: () => Date
    /**
     * The float feedback (78c): every award the tracker's block or the
     * narrator's inline line placed, with the delta asked for — the legacy
     * floats `command.delta`, not the clamped change — once the write is
     * done. The agent's starting values and a value set by hand float
     * nothing, as in the legacy; a swipe's put-back floats nothing either.
     */
    onAwards?: (chatId: string, awards: Array<{ npc: string; field: RelationshipField; delta: number }>, userId: string | undefined) => void
}

/** One award placed, in the panel's words. */
export interface RelationshipPlaced {
    id: string
    label: string
    field: RelationshipField
    delta: number
    applied: number
    newValue: number
}

export interface RelationshipApplyResult {
    placed: RelationshipPlaced[]
    /** Names no entry matched, as written. */
    unmatched: string[]
    /** Entries put back for the message being replaced. */
    reverted: number
}

export interface ApplyOptions {
    source: RelationshipSource
    messageId?: string
    /** The message is being replaced: put back what it awarded first. */
    retrack?: boolean
}

export interface Relationships {
    enabled(userId: string | undefined): Promise<boolean>
    scale(userId: string | undefined): Promise<number>
    mode(userId: string | undefined): Promise<RelationshipMode>
    /** The instruction appended to the tracker's prompt: `''` off, or in regex mode. */
    trackerInstruction(userId: string | undefined): Promise<string>
    /** The tracker's reply, its `[RELATIONS]` block read and removed in tracker mode; untouched otherwise. */
    extract(text: string, userId: string | undefined): Promise<{ memo: string; commands: RelationshipCommand[] }>
    /** Commands by NPC name, resolved against the campaign's entries and applied. */
    apply(chatId: string, userId: string | undefined, commands: readonly RelationshipCommand[], options: ApplyOptions): Promise<RelationshipApplyResult>
    /** The agent's section, for its prompt: `''` when off. */
    agentSection(userId: string | undefined): Promise<string>
    /** The agent's `rel` items: `Book::uid` or an exact title, as the legacy resolves them. */
    applyAgent(chatId: string, userId: string | undefined, items: ReadonlyArray<{ id: string; field: string; delta: number }>, messageId?: string): Promise<RelationshipApplyResult>
    /** Regex mode, after a reply: the awards in the latest narrator message. `null` when the mode is not regex or the system is off. */
    afterReply(chatId: string, userId: string | undefined, messageId: string | undefined, generationType: string | undefined): Promise<RelationshipApplyResult | null>
    view(chatId: string, userId: string | undefined): Promise<RelationshipsView>
    set(chatId: string, userId: string | undefined, id: string, field: RelationshipField, value: number): Promise<RelationshipsView>
    remove(chatId: string, userId: string | undefined, id: string): Promise<RelationshipsView>
    /** The history alone forgotten, the values kept (80): Multihog's Clear Log on the Full NPC Card. */
    clearLog(chatId: string, userId: string | undefined, id: string): Promise<RelationshipsView>
    /** The `[NPC_RELATIONS]` block, synchronously from memory; `null` when off or not loaded (which warms the next turn). */
    block(chatId: string, userId: string | undefined): string | null
    /** The rulebook's settings with the scale on them, so the narrator's tier text names the right range. */
    rulebookSettings<T extends Record<string, unknown>>(settings: T | null | undefined, userId: string | undefined): (T & { npcRelationshipMax: number }) | null
}

const RETRACK_TYPES = new Set(['regenerate', 'swipe', 'continue'])

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

/** The legacy's label for an award: a leading `[tag]` dropped. */
export function relationshipLabel(comment: string | null | undefined): string {
    return String(comment ?? '').replace(/^\[.*?\]\s*/i, '').trim()
}

export function createRelationships(deps: RelationshipsDeps): Relationships {
    const now = deps.now ?? (() => new Date())

    async function enabled(userId: string | undefined): Promise<boolean> {
        const settings = await deps.settings.load(userId).catch(() => ({} as Record<string, unknown>))
        return settings.npcRelationshipBars === true
    }

    function scaleOf(prefs: RelationshipPrefs | undefined): number {
        return normalizeRelationshipMax(prefs?.relationshipMax ?? DEFAULT_RELATIONSHIP_MAX)
    }

    async function scale(userId: string | undefined): Promise<number> {
        return scaleOf(await deps.prefs.load(userId).catch(() => undefined))
    }

    async function mode(userId: string | undefined): Promise<RelationshipMode> {
        return normalizeRelationshipMode((await deps.prefs.load(userId).catch(() => undefined))?.relationshipMode)
    }

    async function trackerInstruction(userId: string | undefined): Promise<string> {
        if (!(await enabled(userId))) return ''
        const prefs = await deps.prefs.load(userId).catch(() => undefined)
        if (normalizeRelationshipMode(prefs?.relationshipMode) !== 'state_tracker') return ''
        return relationshipCommandInstruction(scaleOf(prefs), prefs?.relationshipTrackerPrompt ?? '')
    }

    async function extract(text: string, userId: string | undefined): Promise<{ memo: string; commands: RelationshipCommand[] }> {
        if (!(await enabled(userId)) || (await mode(userId)) !== 'state_tracker') return { memo: text, commands: [] }
        return extractRelationshipCommands(text)
    }

    /** The campaign's entries, NPC books first so a tie goes to an NPC. */
    async function entries(chatId: string, userId: string | undefined): Promise<{ npc: NpcNameEntry[]; all: NpcNameEntry[] }> {
        const prefs = await deps.prefs.load(userId).catch(() => ({} as RelationshipPrefs))
        const prefix = resolveCampaignPrefix({ chatId, override: prefs.campaignNames?.[chatId], anchorChatId: chatId })
        const owned = prefs.campaignBooks?.[chatId] ?? []
        const books = deps.books(userId)
        const npc: NpcNameEntry[] = []
        const rest: NpcNameEntry[] = []
        for (const book of await books.listBooks()) {
            if (bookStanding(book.name, prefix, owned) !== 'owned') continue
            const into = isNpcBookName(book.name) ? npc : rest
            for (const entry of await books.listEntries(book.id)) {
                // The agent titles what it writes `Name [msg #N]` (the
                // provenance stamp), and its own starting value then names
                // the NPC without it; the stamp is no part of the name
                // (65-ter: both values of a seeding pass were refused as
                // *no entry of this campaign is named "Ivo"*).
                const label = relationshipLabel(stripStamp(entry.comment))
                if (!label) continue
                into.push({ id: `${book.name}::${entry.uid}`, label, keys: entry.key ?? [] })
            }
        }
        return { npc, all: [...npc, ...rest] }
    }

    async function applyChanges(chatId: string, userId: string | undefined, changes: RelationshipChange[], unmatched: string[], options: ApplyOptions): Promise<RelationshipApplyResult> {
        const max = await scale(userId)
        const retrackId = options.retrack && options.messageId ? options.messageId : undefined
        if (!changes.length && !retrackId) return { placed: [], unmatched, reverted: 0 }
        const { applied, reverted } = await deps.store.apply(chatId, changes, max, retrackId ? { retrackMessageId: retrackId } : {}, userId)
        if (reverted) deps.log.info(`relationships: put back ${reverted} award${reverted === 1 ? '' : 's'} of the replaced reply in chat ${chatId}`)
        for (const a of applied) deps.log.info(`relationships: ${a.label} ${a.field} ${a.delta >= 0 ? '+' : ''}${a.delta} -> ${a.newValue >= 0 ? '+' : ''}${a.newValue} (${a.source})`)
        for (const name of unmatched) deps.log.warn(`relationships: no entry of chat ${chatId}'s campaign is named "${name}"; the award was dropped`)
        if (applied.length && (options.source === 'tracker' || options.source === 'narrative')) {
            try {
                deps.onAwards?.(chatId, applied.map((a) => ({ npc: a.label, field: a.field, delta: a.delta })), userId)
            } catch (error) {
                deps.log.warn(`relationships: the float feedback could not be sent: ${describe(error)}`)
            }
        }
        return { placed: applied.map((a) => ({ id: a.id, label: a.label, field: a.field, delta: a.delta, applied: a.applied, newValue: a.newValue })), unmatched, reverted }
    }

    async function apply(chatId: string, userId: string | undefined, commands: readonly RelationshipCommand[], options: ApplyOptions): Promise<RelationshipApplyResult> {
        if (!(await enabled(userId))) return { placed: [], unmatched: [], reverted: 0 }
        const changes: RelationshipChange[] = []
        const unmatched: string[] = []
        const known = commands.length ? await entries(chatId, userId) : { npc: [], all: [] }
        for (const command of commands) {
            const direct = command.npc.includes('::') ? command.npc.trim() : ''
            const entry = direct ? known.all.find((e) => e.id === direct) ?? { id: direct, label: direct.slice(direct.indexOf('::') + 2), keys: [] } : resolveNpcName(command.npc, known.all)
            if (!entry) {
                unmatched.push(command.npc)
                continue
            }
            changes.push({ id: entry.id, label: entry.label, field: command.field, delta: command.delta, source: options.source, ...(options.messageId ? { messageId: options.messageId } : {}) })
        }
        return applyChanges(chatId, userId, changes, unmatched, options)
    }

    async function agentSection(userId: string | undefined): Promise<string> {
        const settings = await deps.settings.load(userId).catch(() => ({} as Record<string, unknown>))
        if (settings.npcRelationshipBars !== true) return ''
        // The cartridge's template (72c), the pin's when blank.
        return agentRelationshipSection(await scale(userId), typeof settings.routerRelSectionAgentTemplate === 'string' ? settings.routerRelSectionAgentTemplate : '')
    }

    async function applyAgent(chatId: string, userId: string | undefined, items: ReadonlyArray<{ id: string; field: string; delta: number }>, messageId?: string): Promise<RelationshipApplyResult> {
        if (!items.length || !(await enabled(userId))) return { placed: [], unmatched: [], reverted: 0 }
        const known = await entries(chatId, userId)
        const changes: RelationshipChange[] = []
        const unmatched: string[] = []
        for (const item of items) {
            const field = String(item.field ?? '').toLowerCase()
            if ((field !== 'friendship' && field !== 'affection') || !Number.isFinite(item.delta)) {
                unmatched.push(`${item.id} (${item.field})`)
                continue
            }
            const wanted = String(item.id ?? '').trim()
            let entry: NpcNameEntry | undefined
            if (wanted.includes('::')) {
                entry = known.all.find((e) => e.id === wanted) ?? { id: wanted, label: wanted.slice(wanted.indexOf('::') + 2), keys: [] }
            } else {
                // The legacy: an exact title in the NPC book, then in any book.
                const clean = wanted.toLowerCase()
                entry = known.npc.find((e) => e.label.toLowerCase() === clean) ?? known.all.find((e) => e.label.toLowerCase() === clean)
            }
            if (!entry) {
                unmatched.push(wanted)
                continue
            }
            changes.push({ id: entry.id, label: entry.label, field, delta: Math.round(item.delta), source: 'agent', ...(messageId ? { messageId } : {}) })
        }
        return applyChanges(chatId, userId, changes, unmatched, { source: 'agent', ...(messageId ? { messageId } : {}) })
    }

    async function afterReply(chatId: string, userId: string | undefined, messageId: string | undefined, generationType: string | undefined): Promise<RelationshipApplyResult | null> {
        if (!deps.messages || !(await enabled(userId)) || (await mode(userId)) !== 'regex') return null
        let messages: Array<{ id?: string; role: string; content: string }>
        try {
            messages = await deps.messages(chatId, userId)
        } catch (error) {
            deps.log.warn(`relationships: the chat could not be read for the awards: ${describe(error)}`)
            return null
        }
        const latest = [...messages].reverse().find((m) => m.role === 'assistant')
        if (!latest) return null
        const awards = narrativeAwards(latest.content)
        const id = messageId ?? latest.id
        return apply(chatId, userId, awards, { source: 'narrative', ...(id ? { messageId: id } : {}), retrack: RETRACK_TYPES.has(generationType ?? 'normal') })
    }

    function toView(record: RelationshipRecord, on: boolean, max: number, which: RelationshipMode): RelationshipsView {
        return {
            at: now().toISOString(),
            enabled: on,
            mode: which,
            max,
            updatedAt: record.updatedAt,
            npcs: Object.entries(record.npcs)
                .map(([id, npc]) => ({
                    id,
                    label: npc.label,
                    friendship: npc.friendship,
                    affection: npc.affection,
                    friendshipTier: friendshipTier(npc.friendship, max),
                    affectionTier: affectionTier(npc.affection, max),
                    log: npc.log.map((e) => ({ at: e.at, field: e.field, delta: e.delta, applied: e.applied, newValue: e.newValue, source: e.source })),
                }))
                .sort((a, b) => a.label.localeCompare(b.label)),
        }
    }

    async function view(chatId: string, userId: string | undefined): Promise<RelationshipsView> {
        const [record, on, prefs] = await Promise.all([deps.store.load(chatId, userId), enabled(userId), deps.prefs.load(userId).catch(() => undefined)])
        return toView(record, on, scaleOf(prefs), normalizeRelationshipMode(prefs?.relationshipMode))
    }

    async function set(chatId: string, userId: string | undefined, id: string, field: RelationshipField, value: number): Promise<RelationshipsView> {
        if (!id.trim()) throw new Error('relations.set needs the NPC\'s entry address')
        if (field !== 'friendship' && field !== 'affection') throw new Error(`"${String(field)}" is not a relationship axis`)
        if (!Number.isFinite(value)) throw new Error('relations.set needs a number')
        const current = (await deps.store.load(chatId, userId)).npcs[id]
        const known = current ? undefined : (await entries(chatId, userId)).all.find((e) => e.id === id)
        const label = current?.label ?? known?.label ?? id.slice(id.indexOf('::') + 2)
        await deps.store.set(chatId, id, label, field, Math.round(value), await scale(userId), userId)
        deps.log.info(`relationships: ${label} ${field} set to ${Math.round(value)} by hand`)
        return view(chatId, userId)
    }

    async function remove(chatId: string, userId: string | undefined, id: string): Promise<RelationshipsView> {
        await deps.store.remove(chatId, id, userId)
        return view(chatId, userId)
    }

    async function clearLog(chatId: string, userId: string | undefined, id: string): Promise<RelationshipsView> {
        const record = await deps.store.clearLog(chatId, id, userId)
        deps.log.info(`relationships: the history of ${record.npcs[id]?.label ?? id} cleared by hand; the values stand`)
        return view(chatId, userId)
    }

    function block(chatId: string, userId: string | undefined): string | null {
        const settings = deps.settings.snapshot(userId)
        if (!settings || settings.npcRelationshipBars !== true) return null
        const record = deps.store.snapshot(chatId, userId)
        if (!record) {
            void deps.store.load(chatId, userId).catch(() => undefined)
            return null
        }
        const max = scaleOf(deps.prefs.snapshot(userId))
        return buildNpcRelationsBlock(Object.entries(record.npcs).map(([id, npc]) => ({ id, label: npc.label, friendship: npc.friendship, affection: npc.affection })), max)
    }

    function rulebookSettings<T extends Record<string, unknown>>(settings: T | null | undefined, userId: string | undefined): (T & { npcRelationshipMax: number }) | null {
        if (!settings) return null
        return { ...settings, npcRelationshipMax: scaleOf(deps.prefs.snapshot(userId)) }
    }

    return { enabled, scale, mode, trackerInstruction, extract, apply, agentSection, applyAgent, afterReply, view, set, remove, clearLog, block, rulebookSettings }
}
