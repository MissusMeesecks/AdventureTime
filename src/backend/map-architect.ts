/**
 * The Map Architect's pass (roadmap row 9, Phase 34a): answering
 * `CreateAreaMap`.
 *
 * The narrator calls the tool as the party reaches an unmapped site. This
 * runs the legacy's two stages -- the topology, then the contents, each
 * validated and corrected up to twice -- saves the map into the site's
 * Location entry in the campaign's own place book, and answers the narrator.
 * The answer is the whole of what the narrator sees: a failure is answered
 * in the legacy's private envelope, never thrown into the host.
 *
 * The legacy answers the tool with the finished map, because SillyTavern
 * waits for a tool as long as it takes. Lumiverse does not: a tool
 * invocation has a time limit the extension cannot see or extend, and two
 * model calls overran it, which failed the narrator's whole reply (lesson
 * 41). So `answer` checks what can be checked at once -- the call, the
 * section, the campaign, whether the site is already mapped -- and answers
 * those in full; a site that needs drawing is answered with an
 * acknowledgement, and the drawing goes on in the background, to be read by
 * the sync and sent from the next turn. `run` is the same machinery awaited
 * to the end.
 *
 * Nested maps (58): a call's `attachTo`, or the active cell as shorthand,
 * resolves to a host context; the prompts are told the parent cell; the
 * save promotes the gateway asset on the parent map, stamps the child
 * with its host, files it under `Parent :: Cell :: Child` and reparents a
 * standalone root; an existing map named with a host is linked, not
 * redrawn. The hosting is the legacy's, sliced (`tracker/hosting.ts`).
 *
 * What the legacy's version does that this one does not yet: settlement
 * inclusion (`include`); the user-picked reference lorebooks; the panel's
 * own "+ MAP" button with the brief inferred by a model. Each is refused or
 * absent with a line saying so.
 */

import { campaignBookName } from '../agent/campaign.js'
import { stripStamp } from '../agent/provenance.js'
import {
    ArchitectFailure,
    architectAcknowledgement,
    architectResult,
    buildAssetsCorrectionPrompt,
    buildAssetsPrompt,
    buildTopologyCorrectionPrompt,
    buildTopologyPrompt,
    DEFAULT_MAP_ARCHITECT_SYSTEM_PROMPT,
    DEFAULT_MAP_ARCHITECT_TOPOLOGY_SYSTEM_PROMPT,
    describeIssues,
    existingMapResult,
    existingPeerLinkedResult,
    findExistingSite,
    MAX_CORRECTION_ATTEMPTS,
    normalizeArchitectArgs,
    applyMappedSiteCore,
    rootEntryCore,
    siteRootsMatch,
    validateAssets,
    validateTopology,
    type ArchitectArgs,
    type ArchitectIssue,
    locationKeysForNewRoot,
    resolveIncludeManifest,
    type IncludeManifestItem,
} from '../tracker/architect.js'
import { findHostedMapEntry, isAttachmentFailure, mirrorHostCore, peerSitePath, promoteGateway, reparentHostedEntries, resolveHostContext, stampHostedPeer, type HostContext } from '../tracker/hosting.js'
import { extractFooterLocation, extractMapSection, normalizeMapSiteKind, parseMapDocument, replaceMapSection, serializeMapDocument, type MapDocument } from '../tracker/map.js'
import { extractCurrentTimeStr, currentTimeFromMemo } from '../tracker/time.js'
import { isLocationBookName, readMapSites, type MapBookReader } from './map-sync.js'
import type { MapArchitectReport, MapStore } from './map-store.js'
import { secondsSince, type StepFn } from './terminal.js'
import type { WorldBookStore } from './world-pass.js'

export interface MapArchitectOptions {
    /** Recent messages the architect reads for context. The legacy's 12. */
    lookback: number
    /** The user's own content-placement prompt; `''` for the stock one. */
    systemPrompt: string
}

export interface MapArchitectDeps {
    store: (userId: string | undefined) => WorldBookStore & MapBookReader
    /** One model call. */
    generate(messages: Array<{ role: 'system' | 'user'; content: string }>, chatId: string, userId: string | undefined): Promise<string>
    campaign: (chatId: string, userId: string | undefined) => Promise<{ prefix: string; owned: string[] }>
    /** A book this made: recorded as the campaign's and attached at once (66), whatever the name's standing. */
    ownership: { made(chatId: string, names: string[], userId: string | undefined): Promise<void> }
    /** The last `lookback` messages, oldest first, `PLAYER: …` / `NARRATOR: …`, and the last reply alone for its footer. */
    story: (chatId: string, userId: string | undefined, lookback: number) => Promise<{ lines: string[]; lastReply: string }>
    memo: (chatId: string, userId: string | undefined) => Promise<string>
    options: (userId: string | undefined) => Promise<MapArchitectOptions>
    enabled: (userId: string | undefined) => Promise<boolean>
    state: MapStore
    /** After a save: re-read the maps so the next turn's injection carries the new one. */
    refresh: (chatId: string, userId: string | undefined) => Promise<unknown>
    events?: {
        started(chatId: string, userId: string | undefined, site: string, at: string): void
        finished(chatId: string, userId: string | undefined, report: MapArchitectReport): void
    }
    log: { info(m: string): void; warn(m: string): void }
    now?: () => Date
    /** The terminal (71b): a step function for a run on this chat. */
    steps?: (chatId: string, userId: string | undefined) => StepFn
}

export interface MapArchitectRequest {
    chatId: string
    userId: string | undefined
    args: Record<string, unknown>
    /** Messages read for context, in place of the preference (71a, the form's own lookback; 0 reads none). */
    lookback?: number
}

export interface MapArchitect {
    /**
     * Answer the tool now. A refusal, the map that is already there, or --
     * for a site that needs drawing -- the acknowledgement, with the drawing
     * left running. Always a string for the narrator; never throws.
     */
    answer(request: MapArchitectRequest): Promise<string>
    /** The same, awaited to the end: the finished map or the failure. */
    run(request: MapArchitectRequest): Promise<string>
}

/** What a call comes to before any drawing: an answer in full, or a drawing under way with the answer to give meanwhile. */
interface Started {
    answer: string
    drawing: Promise<string> | null
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

export function createMapArchitect(deps: MapArchitectDeps): MapArchitect {
    const now = deps.now ?? (() => new Date())
    /** One run per site per chat at a time, as the legacy keys its runs. */
    const running = new Map<string, Promise<Started>>()

    async function finish(chatId: string, userId: string | undefined, report: MapArchitectReport): Promise<void> {
        await deps.state.save(chatId, { lastArchitect: report }, userId).catch(() => undefined)
        deps.events?.finished(chatId, userId, report)
    }

    async function generateValid<T>(
        chatId: string,
        userId: string | undefined,
        system: string,
        firstPrompt: string,
        validate: (reply: string) => { result: T | null; issues: ArchitectIssue[]; parseError: string | null },
        correct: (priorOutput: string, parseError: string | null, issues: ArchitectIssue[], attempt: number) => string,
        label: string,
        site: string,
        step?: StepFn,
    ): Promise<{ result: T | null; issues: ArchitectIssue[] }> {
        let prompt = firstPrompt
        let issues: ArchitectIssue[] = []
        for (let attempt = 0; attempt <= MAX_CORRECTION_ATTEMPTS; attempt++) {
            deps.log.info(`map: architect ${label} for "${site}"${attempt ? `, correction ${attempt}` : ''}`)
            step?.('thought', attempt ? `${label === 'topology' ? 'Topology' : 'Content'} correction pass ${attempt} for ${site}…` : label === 'topology' ? `Building topology for ${site}…` : `Populating the locked areas of ${site}…`)
            const reply = await deps.generate([{ role: 'system', content: system }, { role: 'user', content: prompt }], chatId, userId)
            const checked = validate(reply)
            if (checked.result) return { result: checked.result, issues: [] }
            issues = checked.issues
            if (attempt < MAX_CORRECTION_ATTEMPTS) prompt = correct(reply, checked.parseError, issues, attempt + 1)
        }
        return { result: null, issues }
    }

    /** What the draw needs that the preflight already read. */
    interface Ground {
        prefix: string
        owned: string[]
        books: Awaited<ReturnType<typeof readMapSites>>['books']
        options: MapArchitectOptions
        story: Awaited<ReturnType<MapArchitectDeps['story']>>
        currentLocation: string
        /** The parent the child hangs in (58), or `null` for a standalone map. */
        host: HostContext | null
        /** The existing maps a new settlement absorbs (62), resolved and locked before the draw; empty for any other call. */
        include: IncludeManifestItem[]
    }

    /**
     * Everything that can be answered without a model: the section, the
     * campaign, the host (58), and whether the site is already mapped. A
     * refusal is thrown in the envelope; a mapped site is answered with its
     * map, or linked inside its host when the call names one; otherwise
     * the ground the draw stands on.
     */
    async function preflight(request: MapArchitectRequest, args: ArchitectArgs): Promise<{ existing: string } | { ground: Ground }> {
        const { chatId, userId } = request
        if (!(await deps.enabled(userId))) {
            throw new ArchitectFailure('The rulebook’s mapping section is off. No map was generated or saved.')
        }
        const { prefix, owned } = await deps.campaign(chatId, userId)
        if (!prefix) {
            throw new ArchitectFailure('This campaign has no name, so there is no place book to save a map in. Nothing was generated or saved.')
        }
        const { sites, books } = await readMapSites(deps.store(userId), prefix, owned)
        const options = await deps.options(userId)
        const story = await deps.story(chatId, userId, request.lookback ?? options.lookback)
        const currentLocation = extractFooterLocation(story.lastReply)
        // The included peers (62): each name resolved to exactly one mapped
        // DUNGEON or INTERIOR not hosted elsewhere, and locked by entry id.
        const include = args.include?.length ? resolveIncludeManifest(args.include, sites, args.site) : []
        // The host (58): named by attachTo, or the active cell as shorthand;
        // the legacy's attachment errors are the narrator's whole answer.
        let host: HostContext | null = null
        try {
            host = resolveHostContext(sites, currentLocation, args)
        } catch (error) {
            if (isAttachmentFailure(error)) throw new ArchitectFailure(error.message)
            throw error
        }
        const ground: Ground = { prefix, owned, books, options, story, currentLocation, host, include }
        const existing = findExistingSite(sites, args.site, host)
        if (existing?.mapChunks?.length) {
            if (include.length) throw new ArchitectFailure('include[] cannot modify a SETTLEMENT that already has a stored map.')
            if (host) {
                // An existing map hung inside the host: linked, never redrawn.
                const document = parseMapDocument(existing.mapChunks[0]!, existing.siteRoot).document
                const saved = await persist(request, args, document, ground)
                deps.log.info(`map: architect linked the map for "${args.site}" inside "${host.hostSite}" (${saved.entryId})`)
                deps.steps?.(chatId, userId)('finish', `Linked existing map for ${args.site} inside ${host.hostSite}.`)
                await finish(chatId, userId, { status: 'written', at: now().toISOString(), site: args.site, kind: String(saved.document.kind ?? ''), areas: saved.document.areas.length, assets: saved.document.assets.length, entryId: saved.entryId })
                return { existing: existingPeerLinkedResult(host.hostSite, saved.document, host.explicit) }
            }
            deps.log.info(`map: architect reused the map for "${args.site}"`)
            deps.steps?.(chatId, userId)('finish', `Reused existing map for ${args.site}.`)
            await finish(chatId, userId, { status: 'reused', at: now().toISOString(), site: args.site, entryId: existing.entryId })
            return { existing: existingMapResult(existing) }
        }
        return { ground }
    }

    /** An entry as the save reads and may change it: a copy, written back where it moved. */
    interface Row {
        id: string
        uid: string
        comment: string
        content: string
        key: string[]
    }

    /**
     * The save: the site's own Location entry, in the campaign's place book,
     * made when absent. The root entry is disabled, as the legacy's is: the
     * map reaches the narrator through the injection, never through the
     * host's keyword scan. Under a host (58): the gateway asset is promoted
     * on the parent map (hidden for an offsite edit), the child is stamped
     * with its host and filed under `Parent :: Cell :: Child`, a standalone
     * root is reparented with its breadcrumbs, the root's CORE mirrors the
     * host, and the parent entry is rewritten and disabled. With included
     * peers (62) the new settlement is the host: each peer's root, found by
     * its locked id, is stamped with the settlement and the gateway asset
     * the model placed for it, filed under `Settlement :: District :: Peer`
     * with its breadcrumbs, its CORE mirroring the host, and disabled; all
     * of it checked before anything is written, as the legacy saves whole.
     */
    async function persist(request: MapArchitectRequest, args: ArchitectArgs, document: MapDocument, ground: Ground): Promise<{ entryId: string; document: MapDocument }> {
        const { chatId, userId } = request
        const { prefix, owned, books, host, include } = ground
        const store = deps.store(userId)
        let book = books.find((b) => b.name.toLowerCase() === campaignBookName(prefix, 'LOC').toLowerCase()) ?? books[0] ?? null
        if (!book) {
            book = await store.createBook(campaignBookName(prefix, 'LOC'))
            await deps.ownership.made(chatId, [book.name], userId)
            deps.log.info(`map: created ${book.name} for the campaign's places`)
        }
        const rows: Row[] = (await store.listEntries(book.id)).map((e) => ({ id: e.id, uid: e.uid, comment: String(e.comment ?? ''), content: String(e.content ?? ''), key: [...(e.key ?? [])] }))
        const byUid: Record<string, Row> = Object.fromEntries(rows.map((r) => [r.uid, r]))
        const before = new Map(rows.map((r) => [r.uid, JSON.stringify([r.comment, r.content, r.key])]))
        const root = host
            ? findHostedMapEntry(byUid, host.peerSite, args.site, host)
            : rows.find((e) => { const title = stripStamp(e.comment); return title && !title.includes('::') && siteRootsMatch(title, args.site) }) ?? null
        // A root the agent stamped loses the stamp as it gains the map (71d-ter):
        // the map outlives any undo already (45c-quinquies), and the title is
        // the site's name wherever the records and the index show it.
        if (root && stripStamp(root.comment) !== root.comment.trim()) root.comment = stripStamp(root.comment)
        const hadMap = !!root && !!extractMapSection(root.content)
        let persisted: MapDocument = hadMap ? parseMapDocument(extractMapSection(root!.content), root!.comment).document : structuredClone(document)
        let hostRow: Row | null = null
        if (host) {
            hostRow = byUid[host.hostEntryId.slice(host.hostEntryId.lastIndexOf('::') + 2)] ?? null
            if (!hostRow || !extractMapSection(hostRow.content) || hostRow.comment.trim() !== host.hostSite) {
                throw new ArchitectFailure(`Host map "${host.hostSite}" changed before the peer could be saved.`)
            }
            const hostDocument = parseMapDocument(extractMapSection(hostRow.content), host.hostSite).document
            const asset = promoteGateway(hostDocument, args.site, host.expectedAssetKind, host.hostAreaId, host.briefDescription, host.explicit)
            if (peerSitePath(hostDocument, asset) !== host.peerSite) {
                throw new ArchitectFailure(`Host path for "${args.site}" changed before the peer could be saved.`)
            }
            const expectedPeerKind = host.expectedAssetKind === 'SUBINTERIOR' ? 'INTERIOR' : 'DUNGEON'
            const peerKind = normalizeMapSiteKind(persisted.kind)
            if (peerKind !== expectedPeerKind) {
                throw new ArchitectFailure(`${host.expectedAssetKind} requires a ${expectedPeerKind} peer map, received ${peerKind}.`)
            }
            persisted.site = host.peerSite
            persisted = stampHostedPeer(persisted, hostDocument, asset)
            if (root) reparentHostedEntries(byUid, root, host.peerSite, args.site)
            hostRow.content = replaceMapSection(hostRow.content, serializeMapDocument(hostDocument))
        }
        // The included peers (62), absorbed into the settlement as hosted peers.
        const peers = new Set<Row>()
        if (include.length && normalizeMapSiteKind(persisted.kind) !== 'SETTLEMENT') {
            throw new ArchitectFailure('include[] is valid only for a new SETTLEMENT map.')
        }
        for (const item of include) {
            const peerRow = rows.find((r) => { const title = r.comment.trim(); return title && !title.includes('::') && title === item.site }) ?? null
            const lockedUid = item.entryId.slice(item.entryId.lastIndexOf('::') + 2)
            if (!peerRow || peerRow.uid !== lockedUid) throw new ArchitectFailure(`Included peer "${item.site}" changed identity before the settlement could be saved.`)
            const peerSection = extractMapSection(peerRow.content)
            if (!peerSection) throw new ArchitectFailure(`Included peer "${item.site}" no longer exists.`)
            const peerDocument = parseMapDocument(peerSection, item.site).document
            const peerKind = normalizeMapSiteKind(peerDocument.kind)
            if (peerKind !== item.kind || (peerKind !== 'DUNGEON' && peerKind !== 'INTERIOR')) throw new ArchitectFailure(`Included peer "${item.site}" changed kind before the settlement could be saved.`)
            const matching = persisted.assets.filter((asset) => asset.name === item.site && asset.kind === item.assetKind)
            if (matching.length !== 1) throw new ArchitectFailure(`Settlement must contain exactly one ${item.assetKind} asset named "${item.site}".`)
            const hostedSite = peerSitePath(persisted, matching[0]!)
            const stamped = stampHostedPeer(peerDocument, persisted, matching[0]!)
            stamped.site = hostedSite
            reparentHostedEntries(byUid, peerRow, hostedSite, item.site)
            peerRow.content = replaceMapSection(mirrorHostCore(peerRow.content, stamped.hostSite!, stamped.hostBrief!), serializeMapDocument(stamped))
            peers.add(peerRow)
            deps.log.info(`map: architect absorbed the map of "${item.site}" into "${args.site}" as ${hostedSite}`)
        }
        const body = serializeMapDocument(persisted)
        const site = host ? host.peerSite : args.site
        const mirrored = (content: string): string => persisted.hostSite && persisted.hostBrief ? mirrorHostCore(content, persisted.hostSite, persisted.hostBrief) : content
        let entryId: string
        if (root) {
            // The brief description becomes the Location's General field when
            // the entry has none of its own (45c, upstream 2026.8.80).
            root.content = replaceMapSection(mirrored(hadMap ? root.content : applyMappedSiteCore(root.content, args.site, args.briefDescription)), body)
            entryId = `${book.name}::${root.uid}`
        } else {
            const made = await store.createEntry(book.id, { key: locationKeysForNewRoot(args.site, [site, ...(args.locationKeys ?? [])]), comment: site, content: `${mirrored(rootEntryCore(args.site, args.briefDescription))}\n\n[MAP]\n${body}\n[/MAP]`, disabled: true })
            entryId = `${book.name}::${made.uid}`
        }
        for (const row of rows) {
            const [comment, content, key] = JSON.parse(before.get(row.uid)!) as [string, string, string[]]
            const renamed = comment !== row.comment || JSON.stringify(key) !== JSON.stringify(row.key)
            const rename = renamed ? { comment: row.comment, key: row.key } : {}
            if (row === root || row === hostRow || peers.has(row)) await store.updateEntry(row.id, { content: row.content, disabled: true, ...rename })
            else if (renamed || content !== row.content) await store.updateEntry(row.id, { content: row.content, ...rename })
        }
        await deps.refresh(chatId, userId).catch((error: unknown) => deps.log.warn(`map: could not re-read the maps after the save: ${describe(error)}`))
        return { entryId, document: persisted }
    }

    /** The two model calls and the save. */
    async function draw(request: MapArchitectRequest, args: ArchitectArgs, ground: Ground, step?: StepFn): Promise<string> {
        const { chatId, userId } = request
        const { options, story, currentLocation, host, include } = ground
        const at = () => now().toISOString()
        const startedAt = Date.now()
        const context = story.lines.join('\n\n')
        const currentTime = extractCurrentTimeStr(currentTimeFromMemo(await deps.memo(chatId, userId)))
        // An offsite structural creation (58): the party has not entered, so the entrance starts unrevealed.
        const entranceKnowledge = host?.explicit ? 'UNREVEALED' : 'VISITED'

        // 1. The topology.
        const topology = await generateValid<MapDocument>(
            chatId, userId,
            DEFAULT_MAP_ARCHITECT_TOPOLOGY_SYSTEM_PROMPT,
            buildTopologyPrompt(args, context, currentLocation, host, entranceKnowledge),
            (reply) => { const v = validateTopology(reply, args, entranceKnowledge); return { result: v.topology, issues: v.issues, parseError: v.parseError } },
            (prior, parseError, issues, attempt) => buildTopologyCorrectionPrompt(args, context, prior, parseError, issues, attempt, host, entranceKnowledge),
            'topology', args.site, step,
        )
        if (!topology.result) {
            throw new ArchitectFailure(`The architect could not produce a valid connected topology after ${MAX_CORRECTION_ATTEMPTS + 1} attempts. Nothing was saved. Problems: ${describeIssues(topology.issues)}`)
        }
        deps.log.info(`map: topology locked with ${topology.result.areas.length} areas for "${args.site}"`)
        step?.('result', `Topology locked with ${topology.result.areas.length} areas for ${args.site}.`)

        // 2. The contents, on the locked topology.
        const placementSystem = options.systemPrompt.trim() || DEFAULT_MAP_ARCHITECT_SYSTEM_PROMPT
        const contents = await generateValid<MapDocument>(
            chatId, userId,
            placementSystem,
            buildAssetsPrompt(args, topology.result, context, currentTime, host, include),
            (reply) => { const v = validateAssets(reply, topology.result!, args, entranceKnowledge, include); return { result: v.document, issues: v.issues, parseError: v.parseError } },
            (prior, parseError, issues, attempt) => buildAssetsCorrectionPrompt(args, topology.result!, context, prior, parseError, issues, attempt, currentTime, host, include),
            'contents', args.site, step,
        )
        if (!contents.result) {
            throw new ArchitectFailure(`The architect produced valid topology but could not place valid contents after ${MAX_CORRECTION_ATTEMPTS + 1} attempts. Nothing was saved. Problems: ${describeIssues(contents.issues)}`)
        }

        // 3. The save.
        const saved = await persist(request, args, contents.result, ground)
        const document = saved.document
        deps.log.info(`map: architect saved "${args.site}" (${document.kind}, ${document.areas.length} areas, ${document.assets.length} assets) to ${saved.entryId}${host ? `, inside "${host.hostSite}"` : ''}${include.length ? `, absorbing ${include.map((i) => `"${i.site}"`).join(', ')}` : ''}`)
        step?.('result', `Map saved to ${saved.entryId}: ${document.kind}, ${document.areas.length} areas, ${document.assets.length} assets${host ? `, inside ${host.hostSite}` : ''}.`)
        step?.('finish', `Map Architect finished for ${args.site}.`, { seconds: secondsSince(startedAt) })
        await finish(chatId, userId, { status: 'written', at: at(), site: args.site, kind: String(document.kind ?? ''), areas: document.areas.length, assets: document.assets.length, entryId: saved.entryId })
        return architectResult(`Map saved to ${saved.entryId}.`, document, args, host?.explicit ?? false)
    }

    /** A refusal before any drawing: recorded for the fold, but no run started, so none finishes. */
    async function refuse(request: MapArchitectRequest, error: unknown, site: string): Promise<string> {
        const failure = error instanceof ArchitectFailure ? error : new ArchitectFailure(`Map Architect failed before a validated map could be saved: ${describe(error)}`)
        const reason = failure.message.split('\n')[1] ?? failure.message
        deps.log.warn(`map: architect refused the call: ${reason}`)
        deps.steps?.(request.chatId, request.userId)('error', reason)
        await deps.state.save(request.chatId, { lastArchitect: { status: 'failed', at: now().toISOString(), site, reason } }, request.userId).catch(() => undefined)
        return failure.message
    }

    /** The checks, then the drawing launched: never throws, so the key below is always released. */
    async function begin(request: MapArchitectRequest, args: ArchitectArgs): Promise<Started> {
        const { chatId, userId } = request
        let ground: Ground
        try {
            const checked = await preflight(request, args)
            if ('existing' in checked) return { answer: checked.existing, drawing: null }
            ground = checked.ground
        } catch (error) {
            return { answer: await refuse(request, error, args.site), drawing: null }
        }
        deps.events?.started(chatId, userId, args.site, now().toISOString())
        const host = ground.host
        const step = deps.steps?.(chatId, userId)
        step?.('start', `Initializing Map Architect for ${args.site}…`)
        const drawing = draw(request, args, ground, step).catch(async (error: unknown) => {
            const failure = error instanceof ArchitectFailure ? error : new ArchitectFailure(`Map Architect failed before a validated map could be saved: ${describe(error)}`)
            const reason = failure.message.split('\n')[1] ?? failure.message
            deps.log.warn(`map: architect failed for "${args.site}": ${reason}`)
            step?.('error', reason)
            await finish(chatId, userId, { status: 'failed', at: now().toISOString(), site: args.site, reason })
            return failure.message
        })
        return { answer: architectAcknowledgement(args, host), drawing }
    }

    async function start(request: MapArchitectRequest): Promise<Started> {
        let args: ArchitectArgs
        try {
            // The agent's `[msg #N]` stamp on a root's title is not the site's
            // name (71d-ter): + MAP on such a root passed it whole, and the map
            // was filed and indexed as "Hollow Pine [msg #0]".
            args = normalizeArchitectArgs({ ...(request.args ?? {}), site: stripStamp(String(request.args?.site ?? '')) })
        } catch (error) {
            return { answer: await refuse(request, error, String(request.args?.site ?? '')), drawing: null }
        }
        // One run per site per chat: a second call while the first is still
        // being checked or drawn is given the first's answer, not a second run.
        const key = `${request.chatId}::${args.site.toLowerCase()}`
        const inFlight = running.get(key)
        if (inFlight) return inFlight
        const begun = begin(request, args)
        running.set(key, begun)
        const started = await begun
        if (started.drawing) void started.drawing.finally(() => running.delete(key))
        else running.delete(key)
        return started
    }

    return {
        async answer(request) {
            return (await start(request)).answer
        },
        async run(request) {
            const started = await start(request)
            return started.drawing ?? started.answer
        },
    }
}
