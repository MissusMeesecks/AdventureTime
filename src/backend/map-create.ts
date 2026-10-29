/**
 * A map made from the panel (roadmap row 71, Phase 71a): Multihog's
 * **+ Add Mapped Location** on the Locations folder and **+ MAP** on a
 * location root, the narrator not involved.
 *
 * Two ways in, as the legacy's dialog has them. **Manual** names everything
 * the CreateAreaMap call would -- kind, entrance, scale, threat, the map
 * prompt, the brief description, the peers a settlement absorbs -- and
 * hands it to the architect. **Auto** makes one model call first, the
 * legacy's brief handshake (`inferMapArchitectArgs`): the site locked, the
 * location's lore, the user's brief, the recent story and the reference
 * context in, the handshake's fields out as JSON, then the architect draws
 * from those. Either way the architect's own two calls, validation and save
 * follow, so a panel-made map is the narrator's kind of map.
 *
 * The **reference context** is the legacy's (`map-architect-context.js`):
 * the lorebooks and character cards the user ticked, sent whole as
 * established canon, into the brief and into both of the architect's
 * prompts, whatever the lookback says. Pinned to the checkout's own builder
 * in `map-create.pin.test.ts`.
 *
 * **requireNew** is Add Mapped Location's rule: a root of that name already
 * in the place book is refused, mapped or not -- *Use + MAP on that root
 * instead* -- so the panel never draws over a location the agent wrote.
 */

import type { StepFn } from './terminal.js'
import { ArchitectFailure, DEFAULT_MAP_ARCHITECT_BRIEF_SYSTEM_PROMPT, parseArchitectResponse, siteRootsMatch } from '../tracker/architect.js'
import { defaultMapSiteThreat, normalizeMapSiteKind, normalizeMapSiteThreat, type MapSiteKind, type MapSiteThreat } from '../tracker/map.js'
import { premiseFromLocationContent } from '../tracker/map-premise.js'
import type { MapCreateResult } from '../protocol.js'
import type { MapArchitect, MapArchitectOptions } from './map-architect.js'
import { isLocationBookName, type MapBookReader } from './map-sync.js'
import type { MapStore } from './map-store.js'
import { bookStanding } from '../agent/campaign.js'
import { stripStamp } from '../agent/provenance.js'

/** A character card as the reference context reads it: the legacy's six fields. */
export interface ReferenceCard {
    name: string
    description?: string
    personality?: string
    scenario?: string
    mesExample?: string
    firstMessage?: string
    creatorNotes?: string
}

export interface ReferenceBook {
    name: string
    entries: Array<{ uid: string; comment: string; key: string[]; content: string }>
}

export interface MapCreationDeps {
    architect: Pick<MapArchitect, 'run'>
    /** One model call, on the architect's connection: the Auto brief. */
    generate(messages: Array<{ role: 'system' | 'user'; content: string }>, chatId: string, userId: string | undefined): Promise<string>
    store: (userId: string | undefined) => MapBookReader
    campaign: (chatId: string, userId: string | undefined) => Promise<{ prefix: string; owned: string[] }>
    /** The recent story, as the architect reads it. */
    story: (chatId: string, userId: string | undefined, lookback: number) => Promise<{ lines: string[]; lastReply: string }>
    options: (userId: string | undefined) => Promise<MapArchitectOptions>
    enabled: (userId: string | undefined) => Promise<boolean>
    state: MapStore
    /** The architect's own announcements (34a), so the Maps light turns at the brief, not after it (73a); absent in tests that do not care. */
    events?: {
        started(chatId: string, userId: string | undefined, site: string, at: string): void
        finished(chatId: string, userId: string | undefined, report: { status: 'failed'; at: string; site: string; reason: string }): void
    }
    /** The host's character cards by id, for the reference context; absent when the grant is missing. */
    cards?: (userId: string | undefined, ids: string[]) => Promise<ReferenceCard[]>
    log: { info(m: string): void; warn(m: string): void }
    now?: () => Date
    /** The terminal (71b): the brief's steps on the Map Architect's feed. */
    steps?: (chatId: string, userId: string | undefined) => StepFn
}

export interface MapCreateRequest {
    chatId: string
    userId: string | undefined
    site: string
    mode: 'auto' | 'manual'
    /** Add Mapped Location: the root must not exist yet. + MAP: it does, and gets the map. */
    requireNew: boolean
    /** Auto: what the place is, in the user's words; and how many messages of story the brief reads. */
    brief?: string
    lookback?: number
    /** Extra keywords for a new root, the site's own name added first; at most six in all. */
    keywords?: string[]
    kind?: string
    entrance?: string
    scale?: string
    threat?: string
    prompt?: string
    briefDescription?: string
    include?: string[]
    /** The reference context: lorebooks by name, cards by the host's id. */
    lorebooks?: string[]
    cards?: string[]
}

export interface MapCreation {
    create(request: MapCreateRequest): Promise<MapCreateResult>
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

/** The legacy's `cardReferenceFields`: a card's six fields under a heading, the empty ones left out. */
export function cardReferenceFields(card: ReferenceCard | null | undefined): string {
    const source = card ?? ({} as ReferenceCard)
    const fields: Array<[string, string]> = ([
        ['Description', source.description],
        ['Personality', source.personality],
        ['Scenario', source.scenario],
        ['Example dialogue', source.mesExample],
        ['First message', source.firstMessage],
        ['Creator notes', source.creatorNotes],
    ] as Array<[string, unknown]>).map(([label, value]) => [label, String(value ?? '').trim()] as [string, string]).filter(([, value]) => value)
    if (!fields.length) return ''
    const name = String(source.name ?? 'Unnamed character').trim() || 'Unnamed character'
    return `### CHARACTER CARD: ${name}\n${fields.map(([label, value]) => `${label}: ${value}`).join('\n\n')}`
}

/**
 * The legacy's `buildMapArchitectReferenceContext`, over books already
 * read: each book's entries under its name, each entry under its title (its
 * first keyword, else `Entry <uid>`, when it has none), then the cards.
 * `''` when nothing was selected or nothing had text.
 */
export function buildReferenceContext(books: ReferenceBook[], cards: ReferenceCard[]): string {
    const sections: string[] = []
    for (const book of [...books].sort((a, b) => a.name.localeCompare(b.name))) {
        const entries = book.entries.map((entry) => {
            const content = String(entry.content ?? '').trim()
            if (!content) return ''
            const key = entry.key.find(Boolean) ?? ''
            const title = String(entry.comment || key || `Entry ${entry.uid}`).trim()
            return `#### ${title}\n${content}`
        }).filter(Boolean)
        if (entries.length) sections.push(`### LOREBOOK: ${book.name}\n${entries.join('\n\n')}`)
    }
    const cardTexts = cards.map(cardReferenceFields).filter(Boolean)
    if (cardTexts.length) sections.push(cardTexts.join('\n\n'))
    if (!sections.length) return ''
    return `USER-SELECTED REFERENCE CONTEXT\nTreat this as established canon for this map. Use it to ground the place, but do not force every referenced person, object, or event into the map.\n\n${sections.join('\n\n')}`
}

/** The legacy's brief handshake prompt (`inferMapArchitectArgs`), word for word, pinned to its source. */
export function buildBriefPrompt(input: { site: string; lore: string; brief: string; windowSize: number; context: string; referenceContext: string }): string {
    const lore = input.lore.trim() || '(No location lore entry.)'
    const brief = input.brief.trim() || '(none)'
    return `FILL CREATE_AREA_MAP FIELDS
Exact site root (locked, copy character-for-character): ${input.site}

USER BRIEF
${brief}

LOCATION LORE
${lore}

RECENT STORY CONTEXT (${input.windowSize} messages${input.windowSize === 0 ? '; vacuum — do not invent from chat' : ''})
${input.context || '(No additional recent context.)'}

${input.referenceContext || 'USER-SELECTED REFERENCE CONTEXT\n(none selected)'}

Infer entrance, kind, scale, threat, a complete private generation prompt, a brief description, and optional extra keywords as the GM would before calling CreateAreaMap.
SETTLEMENT = the city/town/village as a whole. DUNGEON = a high-risk room graph. INTERIOR = a significant lower-risk multi-room site such as a palace, headquarters, monastery, safehouse, or recurring base. Ordinary settlement structures with no peer map are not mapped here.
Do not include the locked site name in keywords.
Output only the JSON object.`
}

export interface InferredBrief {
    entrance: string
    kind: MapSiteKind
    scale: 'SMALL' | 'MEDIUM' | 'LARGE'
    threat: MapSiteThreat
    prompt: string
    briefDescription: string
    keywords: string[]
}

/** The brief reply read as the legacy reads it: the handshake's fields, or the reason it cannot be used. */
export function readBriefReply(reply: string): InferredBrief {
    const parsed = parseArchitectResponse(reply)
    if (!parsed.value) throw new Error(parsed.error || 'Map Architect returned no map brief JSON.')
    const value = parsed.value
    const kind = normalizeMapSiteKind(value.kind)
    const entrance = String(value.entrance ?? '').trim()
    const prompt = String(value.prompt ?? '').trim()
    const briefDescription = String(value.brief_description ?? '').trim()
    const scale = String(value.scale ?? 'MEDIUM').trim().toUpperCase()
    const threat = (normalizeMapSiteThreat(value.threat, defaultMapSiteThreat(kind)) || defaultMapSiteThreat(kind)) as MapSiteThreat
    if (!entrance || !prompt || !briefDescription) {
        throw new Error('Map Architect returned an incomplete map brief (entrance, prompt, and brief_description are required).')
    }
    const keywords = Array.isArray(value.keywords) ? value.keywords.map((k) => String(k ?? '').trim()).filter(Boolean) : []
    return { entrance, kind, scale: (['SMALL', 'MEDIUM', 'LARGE'].includes(scale) ? scale : 'MEDIUM') as InferredBrief['scale'], threat, prompt, briefDescription, keywords }
}

/** The legacy's lookback clamp: the preference, or the form's own, 0 to 100. */
export function resolveLookback(preference: number, asked: number | undefined): number {
    const value = asked === undefined || !Number.isFinite(asked) ? preference : asked
    return Math.max(0, Math.min(100, Math.floor(Number(value) || 0)))
}

export function createMapCreation(deps: MapCreationDeps): MapCreation {
    const now = deps.now ?? (() => new Date())

    /** The campaign's place books' entries, for the root's lore and the requireNew check. */
    async function placeEntries(chatId: string, userId: string | undefined): Promise<Array<{ comment: string; content: string }>> {
        const { prefix, owned } = await deps.campaign(chatId, userId)
        if (!prefix) return []
        const store = deps.store(userId)
        const books = (await store.listBooks()).filter((b) => bookStanding(b.name, prefix, owned) === 'owned' && isLocationBookName(b.name, prefix))
        const out: Array<{ comment: string; content: string }> = []
        for (const book of books) for (const e of await store.listEntries(book.id)) out.push({ comment: String(e.comment ?? ''), content: String(e.content ?? '') })
        return out
    }

    async function referenceContext(userId: string | undefined, names: string[], cardIds: string[]): Promise<string> {
        const books: ReferenceBook[] = []
        const store = deps.store(userId)
        if (names.length) {
            const listed = await store.listBooks()
            for (const name of [...new Set(names.map((n) => n.trim()).filter(Boolean))]) {
                const book = listed.find((b) => b.name === name)
                if (!book) { deps.log.warn(`map: the reference lorebook "${name}" is not among the host's books`); continue }
                try {
                    const entries = await store.listEntries(book.id)
                    books.push({ name, entries: entries.map((e) => ({ uid: e.uid, comment: String(e.comment ?? ''), key: [...(e.key ?? [])] as string[], content: String(e.content ?? '') })) })
                } catch (error) {
                    deps.log.warn(`map: the reference lorebook "${name}" could not be read: ${describe(error)}`)
                }
            }
        }
        let cards: ReferenceCard[] = []
        if (cardIds.length && deps.cards) {
            try {
                cards = await deps.cards(userId, cardIds)
            } catch (error) {
                deps.log.warn(`map: the reference cards could not be read: ${describe(error)}`)
            }
        }
        return buildReferenceContext(books, cards)
    }

    return {
        async create(request) {
            const { chatId, userId } = request
            // + MAP on a root the agent stamped passes its title; the stamp is not the name (71d-ter).
            const site = stripStamp(request.site.trim())
            const at = now().toISOString()
            const failed = (reason: string): MapCreateResult => ({ status: 'failed', at, site, reason })
            if (!site) return failed('A location name is required.')
            if (site.includes('::')) return failed('Use a location root name, not a nested :: path.')
            if (!(await deps.enabled(userId))) return failed('The rulebook’s mapping section is off. No map was generated or saved.')
            const places = await placeEntries(chatId, userId)
            const root = places.find((e) => { const title = stripStamp(e.comment); return title && !title.includes('::') && siteRootsMatch(title, site) }) ?? null
            if (request.requireNew && root) return failed(`A location named "${stripStamp(root.comment)}" already exists. Use + MAP on that root instead.`)
            const reference = await referenceContext(userId, request.lorebooks ?? [], request.cards ?? [])
            const options = await deps.options(userId)
            const lookback = resolveLookback(options.lookback, request.lookback)
            const keywords = request.keywords ?? []
            let args: Record<string, unknown>
            let inferred: MapCreateResult['inferred'] | undefined
            if (request.mode === 'manual') {
                const prompt = String(request.prompt ?? '').trim()
                const briefDescription = String(request.briefDescription ?? '').trim()
                if (!prompt || !briefDescription) return failed('Map-generation prompt and brief description are required.')
                args = {
                    site,
                    entrance: String(request.entrance ?? '').trim() || 'Entrance',
                    kind: normalizeMapSiteKind(request.kind),
                    scale: String(request.scale ?? 'MEDIUM').trim().toUpperCase(),
                    threat: String(request.threat ?? '').trim().toUpperCase() || defaultMapSiteThreat(normalizeMapSiteKind(request.kind)),
                    prompt,
                    brief_description: briefDescription,
                    include: request.include ?? [],
                    locationKeys: keywords,
                }
            } else {
                // The brief handshake: one model call fills what the call would carry.
                const lore = root ? premiseFromLocationContent(root.content) : ''
                const story = lookback > 0 ? await deps.story(chatId, userId, lookback) : { lines: [], lastReply: '' }
                const prompt = buildBriefPrompt({ site, lore: lore || (root ? '' : `${site} is a location root requested for a Persistent Map. Stay consistent with established story.`), brief: String(request.brief ?? ''), windowSize: lookback, context: story.lines.join('\n\n'), referenceContext: reference })
                deps.log.info(`map: filling the brief for "${site}" (${lookback} messages${reference ? ', with reference context' : ''})`)
                const step = deps.steps?.(chatId, userId)
                step?.('start', `Filling the brief for ${site} (${lookback} message${lookback === 1 ? '' : 's'}${reference ? ', with reference context' : ''})…`)
                // The brief is a model call of its own before the architect's two, and the
                // Maps light waited for the architect's start (73a, the try of 2026-10-21).
                deps.events?.started(chatId, userId, site, at)
                let brief: InferredBrief
                try {
                    brief = readBriefReply(await deps.generate([{ role: 'system', content: DEFAULT_MAP_ARCHITECT_BRIEF_SYSTEM_PROMPT }, { role: 'user', content: prompt }], chatId, userId))
                } catch (error) {
                    const reason = describe(error)
                    deps.log.warn(`map: the brief for "${site}" failed: ${reason}`)
                    step?.('error', `The brief for ${site} failed: ${reason}`)
                    await deps.state.save(chatId, { lastArchitect: { status: 'failed', at, site, reason } }, userId).catch(() => undefined)
                    deps.events?.finished(chatId, userId, { status: 'failed', at, site, reason })
                    return failed(reason)
                }
                inferred = { kind: brief.kind, entrance: brief.entrance, scale: brief.scale, threat: brief.threat, briefDescription: brief.briefDescription }
                deps.log.info(`map: the brief for "${site}" came back: ${brief.kind}, entrance "${brief.entrance}", ${brief.scale}, ${brief.threat}`)
                step?.('result', `The brief: ${brief.kind}, entrance "${brief.entrance}", ${brief.scale}, ${brief.threat}.`)
                // A kind the caller named (the terminal's `Create DUNGEON map for …`, 71b) outranks the brief's, as the legacy's directive does.
                const kind = String(request.kind ?? '').trim() ? normalizeMapSiteKind(request.kind) : brief.kind
                args = { site, entrance: brief.entrance, kind, scale: brief.scale, threat: brief.threat, prompt: brief.prompt, brief_description: brief.briefDescription, include: request.include ?? [], locationKeys: [...keywords, ...brief.keywords] }
            }
            if (reference) args.reference = reference
            const answer = await deps.architect.run({ chatId, userId, args, lookback })
            const report = (await deps.state.load(chatId, userId)).lastArchitect
            if (report && siteRootsMatch(report.site, site) && report.at >= at) {
                return { ...report, ...(inferred ? { inferred } : {}) }
            }
            // No report of this run: the answer's envelope carries the reason.
            const reason = answer.split('\n').find((line, i) => i > 0 && line.trim()) ?? answer
            return { ...failed(reason), ...(inferred ? { inferred } : {}) }
        },
    }
}
