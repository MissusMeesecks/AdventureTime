/**
 * Reading the campaign's maps after each reply (roadmap row 9, Phase 34).
 *
 * The legacy does this inside its prompt hook, every generation: find the
 * Location book, build the sites, read the footer of the last reply, pick the
 * site the party is in and the ones the user just named, render the two
 * blocks. Spindle's interceptor is synchronous, so the same work runs after
 * each reply instead -- and on request from the panel -- and leaves its result
 * in the chat's map record for the injection to read.
 *
 * Which books: every book this campaign owns whose name says it holds places
 * (`_LOC`, `_Locations`, `_Places`, or "location" or "place" in the name), the
 * same rule World Progression's dossiers use. The legacy reads one book,
 * `<prefix>_Locations`; this build's agent files places under the category
 * the cartridge names, so the rule is by name, not by one spelling.
 */

import { bookStanding, campaignBookName } from '../agent/campaign.js'
import {
    buildMapCanonInjection,
    buildMappedSitesInjection,
    buildMapSites,
    extractFooterLocation,
    listMapSiteSummaries,
    mergeMapSites,
    resolveActiveMapSite,
    resolveMentionedMapSites,
    type MapLoreEntry,
    type MapSites,
} from '../tracker/map.js'
import type { MapRecord, MapStore } from './map-store.js'

/** The slice of the host's world books the sync reads. Bound to a user (rule 3f). */
export interface MapBookReader {
    listBooks(): Promise<Array<{ id: string; name: string }>>
    listEntries(bookId: string): Promise<Array<{ uid: string; comment: string; content: string; key?: string[]; extensions?: Record<string, unknown> }>>
}

export interface MapSyncDeps {
    store: (userId: string | undefined) => MapBookReader
    /** This campaign's prefix and the books it owns. */
    campaign: (chatId: string, userId: string | undefined) => Promise<{ prefix: string; owned: string[] }>
    /** The narrator's last reply and the user's last message, as text; `''` for none. */
    lastTurn: (chatId: string, userId: string | undefined) => Promise<{ reply: string; userText: string }>
    /** Whether the rulebook's mapping section is on for this user. */
    enabled: (userId: string | undefined) => Promise<boolean>
    /** The site's recent off-screen life for the narrator (34c); `''` for none. Absent: no briefing. */
    activity?: (chatId: string, userId: string | undefined, siteRoot: string) => Promise<string>
    state: MapStore
    log: { info(m: string): void; warn(m: string): void }
    now?: () => Date
}

/** A book that holds places, by the rule the dossiers use. World Progression's own books fall out by category. */
export function isLocationBookName(name: string, prefix: string): boolean {
    const lower = String(name ?? '').toLowerCase()
    const root = campaignBookName(prefix, null).toLowerCase()
    const category = root && lower.startsWith(`${root}_`) ? lower.slice(root.length + 1) : ''
    return ['loc', 'location', 'locations', 'place', 'places'].includes(category) || lower.includes('location') || lower.includes('place')
}

export interface MapSync {
    /** Re-read the books and the last turn, and rewrite the record. Never throws; a problem is recorded. */
    refresh(chatId: string, userId: string | undefined): Promise<MapRecord>
}

/** Every site the campaign's own place books map, and the books they were read from. */
export async function readMapSites(reader: MapBookReader, prefix: string, owned: readonly string[]): Promise<{ sites: MapSites; books: Array<{ id: string; name: string }> }> {
    const books = (await reader.listBooks()).filter((b) => bookStanding(b.name, prefix, owned) === 'owned' && isLocationBookName(b.name, prefix))
    const sets: MapSites[] = []
    for (const book of books) {
        const entries = await reader.listEntries(book.id)
        const byUid: Record<string, MapLoreEntry> = Object.fromEntries(entries.map((e) => [e.uid, { comment: e.comment, content: e.content, extensions: e.extensions }]))
        sets.push(buildMapSites(byUid, book.name))
    }
    return { sites: mergeMapSites(...sets), books }
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

export function createMapSync(deps: MapSyncDeps): MapSync {
    const now = deps.now ?? (() => new Date())
    return {
        async refresh(chatId, userId) {
            const at = now().toISOString()
            try {
                if (!(await deps.enabled(userId))) {
                    return deps.state.save(chatId, { currentLocation: '', sites: [], activeSiteRoot: '', mentionedSiteRoots: [], mappedSitesBlock: '', canonBlock: '', syncedAt: at, problem: undefined }, userId)
                }
                const { prefix, owned } = await deps.campaign(chatId, userId)
                const { sites, books } = await readMapSites(deps.store(userId), prefix, owned)
                const turn = await deps.lastTurn(chatId, userId)
                const currentLocation = extractFooterLocation(turn.reply)
                const active = resolveActiveMapSite(sites, currentLocation)
                const mentioned = resolveMentionedMapSites(sites, turn.userText).filter((s) => s.entryId !== active?.entryId)
                const activity = async (siteRoot: string): Promise<string> => (deps.activity ? await deps.activity(chatId, userId, siteRoot).catch(() => '') : '')
                const blocks: string[] = []
                if (active) blocks.push(buildMapCanonInjection(active, currentLocation, { activityText: await activity(active.siteRoot) }))
                for (const s of mentioned) blocks.push(buildMapCanonInjection(s, currentLocation, { referencedByName: true, activityText: await activity(s.siteRoot) }))
                const canonBlock = blocks.filter(Boolean).join('\n\n')
                const summaries = listMapSiteSummaries(sites)
                const record = await deps.state.save(chatId, {
                    currentLocation,
                    sites: summaries.map((s) => ({ siteRoot: s.siteRoot, kind: s.kind, entryId: Object.values(sites).find((site) => site.siteRoot === s.siteRoot)?.entryId ?? '' })),
                    activeSiteRoot: active?.siteRoot ?? '',
                    mentionedSiteRoots: mentioned.map((s) => s.siteRoot),
                    mappedSitesBlock: buildMappedSitesInjection(sites),
                    canonBlock,
                    syncedAt: at,
                    problem: undefined,
                }, userId)
                deps.log.info(`map: ${summaries.length} mapped site${summaries.length === 1 ? '' : 's'} in ${books.length} book${books.length === 1 ? '' : 's'}; party at "${currentLocation || '(no footer)'}"${active ? `, inside ${active.siteRoot}` : ''}`)
                return record
            } catch (error) {
                deps.log.warn(`map: could not read the maps: ${describe(error)}`)
                return deps.state.save(chatId, { syncedAt: at, problem: describe(error) }, userId)
            }
        },
    }
}
