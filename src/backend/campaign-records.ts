/**
 * Campaign Records (roadmap row 71, Phase 71a): the campaign's books as
 * folders with their entries, read and written from the panel.
 *
 * Multihog's Lorebook Agent tab lists every book of the campaign with each
 * entry's tokens, a pin, an edit form, a delete and a cleanup, an NPC's CORE
 * card and its bookmark into the library, and on a location root the MAP
 * badge with its × and + MAP. Until now the host's own lorebook editor was
 * the only way to an entry here. This is the service behind that browser:
 * the listing, the edit, the delete, the pin and the map's removal; the
 * cleanup is the agent's instructed pass, the bookmark the library's own
 * `saveEntry`, and the map's making `map-create.ts`.
 *
 * Three rules of this build's own:
 *  - **The pin is the host's `constant` flag.** Multihog's pin keeps an entry
 *    in the agent's active pool; activation is the host's here, and constant
 *    is what the host has for "always in the prompt".
 *  - **A map root cannot be pinned**, since constant would put the whole map
 *    document into every prompt through the host's scan, which the root is
 *    disabled to prevent: the map reaches the narrator through the injection.
 *  - **An edit never touches the map.** The editor shows and saves the prose;
 *    the `[MAP]` section is kept as it stands, and the raw editor is its way.
 */

import { bookStanding, campaignBookName } from '../agent/campaign.js'
import { extractMapSection, normalizeMapDocument, normalizeMapLabel, parseMapDocument, replaceMapSection, serializeMapDocument, stripMapSection } from '../tracker/map.js'
import { clearEvolutionHistoryForSite, siteKey } from '../tracker/evolution.js'
import type { CampaignRecordsResult, MapRawResult, MapRawSaveResult, RecordBookDTO, RecordEntryDTO, RecordEntryResult, RecordRemoveMapResult } from '../protocol.js'
import { isLocationBookName, readMapSites } from './map-sync.js'
import type { MapStore } from './map-store.js'
import type { WorldBookStore, WorldEntry } from './world-pass.js'

export interface CampaignRecordsDeps {
    store: (userId: string | undefined) => WorldBookStore
    /** This campaign's prefix and the books it owns. */
    campaign: (chatId: string, userId: string | undefined) => Promise<{ prefix: string; owned: string[] }>
    /** The maps: whether the rulebook's mapping section is on, the record, and the re-read after a map changed. */
    mapping: {
        enabled(userId: string | undefined): Promise<boolean>
        state: MapStore
        refresh(chatId: string, userId: string | undefined): Promise<unknown>
    }
    log: { info(m: string): void; warn(m: string): void }
}

export interface CampaignRecords {
    list(chatId: string, userId: string | undefined): Promise<CampaignRecordsResult>
    update(chatId: string, userId: string | undefined, write: { entryId: string; title: string; keys: string[]; content: string }): Promise<RecordEntryResult>
    remove(chatId: string, userId: string | undefined, entryId: string): Promise<{ removed: true; title: string }>
    pin(chatId: string, userId: string | undefined, entryId: string, pinned: boolean): Promise<RecordEntryResult>
    removeMap(chatId: string, userId: string | undefined, entryId: string): Promise<RecordRemoveMapResult>
    /** The raw map editor (71a, departure 53): a site's document as JSON, and one saved. */
    rawGet(chatId: string, userId: string | undefined, siteRoot: string): Promise<MapRawResult>
    rawSet(chatId: string, userId: string | undefined, siteRoot: string, json: string): Promise<MapRawSaveResult>
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

/** The legacy's token estimate: the prose's length over four, the map left out. */
export function estimateTokens(content: string): number {
    return Math.round(stripMapSection(content).length / 4)
}

/**
 * The kind a book's folder draws as, by the legacy's name rules: NPCs,
 * Locations, World, or any other — and the World Skeleton's seed book as
 * its own kind (78b-bis): it filed under World and drew as a second *World*
 * folder beside World Progression's reports.
 */
export function bookKind(name: string, prefix: string): RecordBookDTO['kind'] {
    const lower = name.toLowerCase()
    const root = campaignBookName(prefix, null).toLowerCase()
    const category = root && lower.startsWith(`${root}_`) ? lower.slice(root.length + 1) : lower
    if (['npc', 'npcs'].includes(category) || lower.endsWith('_npc') || lower.endsWith('_npcs')) return 'npc'
    if (isLocationBookName(name, prefix)) return 'location'
    if (category === 'skeleton' || lower.endsWith('_skeleton')) return 'skeleton'
    if (category === 'world' || lower.endsWith('_world')) return 'world'
    return 'other'
}

/** The category after the prefix, or the whole name when it does not carry the prefix. */
export function bookCategory(name: string, prefix: string): string {
    const root = campaignBookName(prefix, null)
    return root && name.toLowerCase().startsWith(`${root.toLowerCase()}_`) ? name.slice(root.length + 1) : name
}

const KIND_ORDER: Record<RecordBookDTO['kind'], number> = { npc: 0, location: 1, other: 2, world: 3, skeleton: 4 }

export function entryDTO(entry: WorldEntry): RecordEntryDTO {
    const title = String(entry.comment ?? '').trim()
    return {
        id: entry.id,
        uid: entry.uid,
        title,
        keys: [...(entry.key ?? [])],
        content: stripMapSection(entry.content),
        tokens: estimateTokens(entry.content),
        pinned: entry.constant === true,
        disabled: entry.disabled === true,
        hasMap: !!extractMapSection(entry.content),
        root: !!title && !title.includes('::'),
    }
}

/** The legacy's key cleaner for an edit: trimmed and unique, no cap — the cap is for a root being made. */
export function cleanEditKeys(keys: readonly unknown[]): string[] {
    return [...new Set(keys.map((k) => String(k ?? '').trim()).filter(Boolean))]
}

export function createCampaignRecords(deps: CampaignRecordsDeps): CampaignRecords {
    /** The campaign's own books, NPCs first, then Locations, the rest by name, World last. */
    async function ownBooks(chatId: string, userId: string | undefined): Promise<{ prefix: string; owned: string[]; books: Array<{ id: string; name: string; kind: RecordBookDTO['kind'] }>; all: string[] }> {
        const { prefix, owned } = await deps.campaign(chatId, userId)
        const listed = await deps.store(userId).listBooks()
        const books = listed
            .filter((b) => prefix && bookStanding(b.name, prefix, owned) === 'owned')
            .map((b) => ({ ...b, kind: bookKind(b.name, prefix) }))
            .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
        return { prefix, owned, books, all: listed.map((b) => b.name).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })) }
    }

    /** An entry by the host's id, in whichever of the campaign's books holds it. */
    async function findEntry(chatId: string, userId: string | undefined, entryId: string): Promise<{ entry: WorldEntry; book: { id: string; name: string; kind: RecordBookDTO['kind'] } }> {
        const { books } = await ownBooks(chatId, userId)
        const store = deps.store(userId)
        for (const book of books) {
            const entry = (await store.listEntries(book.id)).find((e) => e.id === entryId)
            if (entry) return { entry, book }
        }
        throw new Error('That entry is not in any of this campaign’s books.')
    }

    /** The site's clocks, ledger, threads and felt reports forgotten, as the legacy forgets them when a map goes. */
    async function forgetSite(chatId: string, userId: string | undefined, siteRoot: string): Promise<void> {
        const record = await deps.mapping.state.load(chatId, userId)
        const cleared = clearEvolutionHistoryForSite({ backlogBySite: record.evolution.backlogBySite, threadsBySite: record.threadsBySite, reportApplicationsBySite: record.evolution.reportApplications }, siteRoot)
        const key = siteKey(siteRoot)
        const lastFiredBySite = { ...record.evolution.lastFiredBySite }
        delete lastFiredBySite[key]
        await deps.mapping.state.save(chatId, {
            threadsBySite: cleared.threadsBySite,
            evolution: {
                ...record.evolution,
                backlogBySite: cleared.backlogBySite,
                reportApplications: cleared.reportApplicationsBySite,
                lastFiredBySite,
                lastSiteRoot: siteKey(record.evolution.lastSiteRoot) === key ? '' : record.evolution.lastSiteRoot,
                pendingExitRoot: siteKey(record.evolution.pendingExitRoot) === key ? '' : record.evolution.pendingExitRoot,
            },
        }, userId)
    }

    async function refreshMaps(chatId: string, userId: string | undefined): Promise<void> {
        await deps.mapping.refresh(chatId, userId).catch((error: unknown) => deps.log.warn(`records: could not re-read the maps: ${describe(error)}`))
    }

    return {
        async list(chatId, userId) {
            const out: CampaignRecordsResult = { prefix: '', books: [], mapping: false, mapped: [], allBooks: [] }
            try {
                const { prefix, owned, books, all } = await ownBooks(chatId, userId)
                out.prefix = prefix
                out.allBooks = all
                const store = deps.store(userId)
                for (const book of books) {
                    const entries = (await store.listEntries(book.id)).map(entryDTO)
                    out.books.push({ id: book.id, name: book.name, category: bookCategory(book.name, prefix), kind: book.kind, entries, tokens: entries.reduce((sum, e) => sum + e.tokens, 0) })
                }
                out.mapping = await deps.mapping.enabled(userId)
                if (out.mapping && prefix) {
                    const { sites } = await readMapSites(store, prefix, owned)
                    out.mapped = Object.values(sites).map((site) => {
                        const document = site.mapChunks[0] ? parseMapDocument(site.mapChunks[0], site.siteRoot).document : null
                        return { siteRoot: site.siteRoot, kind: String(document?.kind ?? ''), hosted: !!document?.hostSite }
                    })
                }
            } catch (error) {
                deps.log.warn(`records: the campaign's books could not be read: ${describe(error)}`)
                out.problem = describe(error)
            }
            return out
        },

        async update(chatId, userId, write) {
            const title = write.title.trim()
            if (!title) throw new Error('An entry needs a title.')
            const { entry } = await findEntry(chatId, userId, write.entryId)
            const section = extractMapSection(entry.content)
            // The prose is the editor's; the map, when there is one, stands as it was (the raw editor is its way).
            const content = section ? replaceMapSection(write.content, section) : write.content
            const key = cleanEditKeys(write.keys)
            await deps.store(userId).updateEntry(entry.id, { content, comment: title, key })
            deps.log.info(`records: edited "${entry.comment}"${title !== entry.comment.trim() ? ` as "${title}"` : ''} in chat ${chatId}`)
            if (section) await refreshMaps(chatId, userId)
            return { entry: entryDTO({ ...entry, content, comment: title, key }) }
        },

        async remove(chatId, userId, entryId) {
            const { entry } = await findEntry(chatId, userId, entryId)
            const title = entry.comment.trim()
            const hadMap = !!extractMapSection(entry.content)
            await deps.store(userId).deleteEntry(entry.id)
            deps.log.info(`records: deleted "${title}" from chat ${chatId}${hadMap ? ', with its map' : ''}`)
            if (hadMap) {
                await forgetSite(chatId, userId, title)
                await refreshMaps(chatId, userId)
            }
            return { removed: true, title }
        },

        async pin(chatId, userId, entryId, pinned) {
            const { entry } = await findEntry(chatId, userId, entryId)
            if (pinned && extractMapSection(entry.content)) {
                throw new Error('A mapped root cannot be pinned: pinned, the host would put the whole map into every prompt. The map reaches the narrator through the map injection instead.')
            }
            // Pinned is always in the prompt, so it is enabled too, as the legacy's pin activates.
            const patch = pinned ? { constant: true, disabled: false } : { constant: false }
            await deps.store(userId).updateEntry(entry.id, patch)
            deps.log.info(`records: ${pinned ? 'pinned' : 'unpinned'} "${entry.comment.trim()}" in chat ${chatId}`)
            return { entry: entryDTO({ ...entry, ...patch }) }
        },

        async removeMap(chatId, userId, entryId) {
            const { entry } = await findEntry(chatId, userId, entryId)
            if (!extractMapSection(entry.content)) throw new Error('That Location has no map.')
            const siteRoot = entry.comment.trim()
            const content = stripMapSection(entry.content)
            // The root goes back into the keyword scan: it was disabled for the map's sake alone.
            await deps.store(userId).updateEntry(entry.id, { content, disabled: false })
            await forgetSite(chatId, userId, siteRoot)
            deps.log.info(`records: removed the map of "${siteRoot}" in chat ${chatId}; the entry and its CORE stay`)
            await refreshMaps(chatId, userId)
            return { siteRoot, entry: entryDTO({ ...entry, content, disabled: false }) }
        },

        async rawGet(chatId, userId, siteRoot) {
            const { prefix, owned } = await deps.campaign(chatId, userId)
            const { sites } = await readMapSites(deps.store(userId), prefix, owned)
            const wanted = normalizeMapLabel(siteRoot)
            const site = Object.values(sites).find((s) => normalizeMapLabel(s.siteRoot) === wanted)
            if (!site?.mapChunks[0]) throw new Error(`${siteRoot} is not a mapped site.`)
            const document = parseMapDocument(site.mapChunks[0], site.siteRoot).document
            const bookName = site.entryId.slice(0, site.entryId.lastIndexOf('::'))
            return { siteRoot: site.siteRoot, entryId: site.entryId, bookName, json: JSON.stringify(document, null, 2) }
        },

        async rawSet(chatId, userId, siteRoot, json) {
            let raw: unknown
            try {
                raw = JSON.parse(json)
            } catch (error) {
                throw new Error(`The JSON could not be read: ${describe(error)}`)
            }
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The JSON must be one map document: an object with areas and assets.')
            const { prefix, owned } = await deps.campaign(chatId, userId)
            const store = deps.store(userId)
            const { sites, books } = await readMapSites(store, prefix, owned)
            const wanted = normalizeMapLabel(siteRoot)
            const site = Object.values(sites).find((s) => normalizeMapLabel(s.siteRoot) === wanted)
            if (!site?.mapChunks[0]) throw new Error(`${siteRoot} is not a mapped site.`)
            const document = normalizeMapDocument(raw, site.siteRoot)
            if (normalizeMapLabel(document.site) !== normalizeMapLabel(site.siteRoot)) {
                throw new Error(`The document's site must stay "${site.siteRoot}"; a site is renamed by its entry's title, not here.`)
            }
            const bookName = site.entryId.slice(0, site.entryId.lastIndexOf('::'))
            const uid = site.entryId.slice(site.entryId.lastIndexOf('::') + 2)
            const book = books.find((b) => b.name === bookName)
            if (!book) throw new Error(`${bookName} could not be read again.`)
            const root = (await store.listEntries(book.id)).find((e) => e.uid === uid)
            if (!root) throw new Error('The mapped root entry is gone.')
            await store.updateEntry(root.id, { content: replaceMapSection(root.content, serializeMapDocument(document)), disabled: true })
            deps.log.info(`map: raw JSON saved for "${site.siteRoot}" (${document.areas.length} areas, ${document.assets.length} assets)`)
            await refreshMaps(chatId, userId)
            return { siteRoot: site.siteRoot, areas: document.areas.length, assets: document.assets.length }
        },
    }
}
