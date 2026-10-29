/**
 * The NPC library's service (Phase 41): the records, their sources in a
 * campaign, the packages in and out, and the two ways a card goes into play.
 *
 * The legacy's library sits in its NPC/PC Manager: a card is bookmarked from
 * Campaign Records (a campaign NPC's entry, or the Player Card), listed with
 * its blurb, opened as a Full Card to edit, exported as one `.mnpc.json`
 * with the portrait inside, imported from one, and put into play by **Add to
 * Party** (the tracker's direct prompt that seats it in `[PARTY]`) or **Play
 * as PC** (the Player Card set from the card, then the direct prompt that
 * swaps `[CHARACTER]`). This build has no Campaign Records view, so the
 * sources are listed here: the campaign's NPC book's entries, and the chat's
 * Player Card.
 *
 * Portraits are references, as everywhere in this build: a campaign NPC's
 * portrait address is copied into the record, and put back on the entity
 * when the card joins a chat. A package carries the picture as base64; on
 * import it goes to the host's image store and the record keeps the address.
 */

import { campaignBookName, resolveCampaignPrefix } from '../agent/campaign.js'
import { extractCharacterName } from '../tracker/creator.js'
import {
    bioOf,
    blurb,
    createRecord,
    dataUrlFromPayload,
    findById,
    findByName,
    identityOf,
    packageFilename,
    parsePackages,
    partyPrompt,
    playAsPcPrompt,
    removeRecord,
    serializePackage,
    uniqueName,
    upsertRecord,
    type LibraryRecord,
} from '../tracker/npc-library.js'
import { buildLibraryPhotoPrompt, portraitSize, type ProviderParameter } from '../tracker/library-photo.js'
import { entryFrom } from '../tracker/npc-creator.js'
import { parseEntityBlock } from '../tracker/entities.js'
import { parseMemoBlocks } from '../tracker/memo.js'
import type { CardResult, LibraryActionResult, LibraryPhotoPromptResult, LibraryPhotoResult, LibraryRecordView, LibrarySources } from '../protocol.js'
import type { NpcLibraryStore } from './npc-library-store.js'
import type { PlayerCardService } from './player-card.js'
import type { TrackerPass, TrackerPassOutcome } from './tracker-pass.js'

export interface NpcLibraryDeps {
    store: NpcLibraryStore
    trackerPass: TrackerPass
    /** The preferences: the direct pass's lookback, the campaign names, and the scene's image connection, which a photo is drawn on too (60). */
    prefs: { load(userId: string | undefined): Promise<{ trackerDirectLookback: number; campaignNames?: Record<string, string>; scenePictureConnectionId?: string; portraitConnectionId?: string }> }
    /** The campaign's books, for the sources: the NPC book's entries. */
    books: (userId: string | undefined) => {
        listBooks(): Promise<Array<{ id: string; name: string }>>
        listEntries(bookId: string): Promise<Array<{ id: string; key: string[]; content: string; comment: string }>>
    }
    /** The chat's portraits: read for a saved card, written for a card put into play. Absent, portraits are left alone. */
    portraits?: {
        load(chatId: string, userId: string | undefined): Promise<{ portraits: Record<string, string> }>
        set(chatId: string, name: string, src: string, userId: string | undefined): Promise<unknown>
    }
    /** The host's image store, for a package's portrait and a photo set from a file or drawn as data (60). Absent, an imported portrait is dropped and a photo cannot be set. */
    images?: { uploadFromDataUrl(dataUrl: string, filename: string, userId: string | undefined): Promise<{ url?: string } | null | undefined> }
    /** The model call that writes a photo's image prompt (60): the system and user prompts in, the text out; no chat when none is open. Absent, a photo cannot be drawn. */
    generate?: (system: string, user: string, chatId: string | undefined, userId: string | undefined) => Promise<string>
    /** The host's image generation (60); absent when the grant is missing. The providers' schemas say whether a connection takes a size. */
    imageGen?: {
        generate(input: { prompt: string; connection_id?: string; parameters?: Record<string, unknown>; userId: string | undefined }): Promise<{ imageDataUrl: string; imageUrl?: string; imageId?: string; model: string; provider: string }>
        listConnections(userId: string | undefined): Promise<Array<{ id: string; name: string; provider: string; model: string; is_default: boolean; default_parameters?: Record<string, unknown> }>>
        getProviders?(userId: string | undefined): Promise<Array<{ id: string; capabilities?: { parameters?: Record<string, ProviderParameter> } }>>
    }
    /** The host's character cards, for one saved from the character editor (48); absent when the grant is missing. `avatar` is the card's picture address, `''` without one. */
    characters?: {
        get(id: string, userId: string | undefined): Promise<{ id: string; name: string; description: string; personality: string; avatar?: string } | null>
    }
    /** The Player Card: a source to save, and the card Play as PC sets. */
    playerCard?: Pick<PlayerCardService, 'view' | 'save'>
    /** The cartridge, for the party module's text and the cap it names (53-bis). Absent, a refused seat gets the generic hint. */
    settings?: { load(userId: string | undefined): Promise<Record<string, unknown>> }
    /** A photo's draw announced (60-bis), for the head's Picture light; the chat when one is named. */
    events?: {
        started(chatId: string | undefined, userId: string | undefined, name: string, at: string): void
        finished(chatId: string | undefined, userId: string | undefined, report: { name: string; at: string; outcome: 'drawn' | 'failed'; reason?: string }): void
    }
    log: { info(m: string): void; warn(m: string): void }
    now?: () => Date
}

export interface NpcLibrary {
    list(userId: string | undefined): Promise<LibraryRecordView[]>
    sources(chatId: string, userId: string | undefined): Promise<LibrarySources>
    saveEntry(request: { chatId: string; userId: string | undefined; entryId: string; overwrite?: boolean }): Promise<LibraryRecordView | { status: 'exists'; name: string }>
    savePlayerCard(request: { chatId: string; userId: string | undefined; overwrite?: boolean }): Promise<LibraryRecordView | { status: 'exists'; name: string }>
    /** A host card as is (48): the NPC creator's literal wrap, the name as the keyword, the avatar as the portrait. */
    saveCard(request: { characterId: string; userId: string | undefined; overwrite?: boolean }): Promise<LibraryRecordView | { status: 'exists'; name: string }>
    update(request: { userId: string | undefined; id: string; name?: string; content?: string; keys?: string[]; notes?: string }): Promise<LibraryRecordView>
    /** A card's photo from a file (60): stored with the host, kept on the record, and placed on the open chat's entity of that name when a chat is named. */
    setPhoto(request: { userId: string | undefined; id: string; dataUrl: string; filename?: string; chatId?: string }): Promise<LibraryPhotoResult>
    /** A card's photo drawn (60): the legacy's NPC prompt on the agent's connection, then the scene's image connection in 2:3. */
    drawPhoto(request: { userId: string | undefined; id: string; chatId?: string; prompt?: string }): Promise<LibraryPhotoResult>
    /** The photo's prompt written and handed back for editing (73f): one model call, nothing drawn. */
    photoPrompt(request: { userId: string | undefined; id: string; chatId?: string }): Promise<LibraryPhotoPromptResult>
    /** A card's photo taken off the record (60); the chats' portraits are left alone. */
    removePhoto(request: { userId: string | undefined; id: string }): Promise<LibraryPhotoResult>
    remove(userId: string | undefined, id: string): Promise<boolean>
    importPackages(request: { userId: string | undefined; text: string }): Promise<LibraryRecordView[]>
    exportPackage(request: { userId: string | undefined; id: string; portraitDataUrl?: string }): Promise<{ filename: string; file: string; withPortrait: boolean }>
    party(request: { chatId: string; userId: string | undefined; id: string }): Promise<LibraryActionResult>
    playAsPc(request: { chatId: string; userId: string | undefined; id: string }): Promise<LibraryActionResult>
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

const NO_IMAGE_GRANT = 'This build cannot draw pictures: the host has not granted the image_gen permission.'

/** The stored file's name: the card's, with the picked file's extension when it has one. */
function photoFilename(record: { name: string }, filename: string | undefined): string {
    const ext = /\.(png|jpe?g|webp|gif)$/i.exec(filename ?? '')?.[1]?.toLowerCase() ?? 'png'
    return `${packageFilename(record).replace(/\.mnpc\.json$/, '')}.${ext}`
}

/**
 * Why a seat was refused, when the tracker changed nothing (53-bis): the
 * usual cause is a full party. The cap is a sentence in the party module's
 * text — *(max 5 + {{user}})* — that no code enforces (36-bis), so this reads
 * the roster from the memo's [PARTY] block and the number from the text and
 * says which it is: full, with the two cures; not full, so the tracker's own
 * words are the clue; or unknown, with the generic hint.
 */
export function partyRoomHint(memo: string | null | undefined, partyText: string | null | undefined): string {
    const block = parseMemoBlocks(memo ?? '').PARTY
    // Every token of a PARTY block is a member: the grammar anchors the
    // block's first line on its name and hangs every later line off a
    // member (40), so a stray line reads as one here as it does in the cards.
    const tokens = block ? parseEntityBlock(block, 'PARTY') : null
    const seated = tokens ? tokens.length : null
    const cap = /\bmax\s*(\d+)/i.exec(partyText ?? '')
    const limit = cap ? Number(cap[1]) : null
    const cures = 'Raise the cap under Tracker modules (the party module’s text), or bench someone first.'
    if (seated !== null && limit !== null) {
        if (seated >= limit) return `The party is full: ${seated} on the roster, and the party module’s text caps it at ${limit} besides you. ${cures}`
        return `The roster has ${seated} of the ${limit} the party module’s text allows, so the party is not full; the Tracker report’s sample shows what the model said.`
    }
    if (seated !== null) return `A full party is the usual cause (${seated} on the roster; the party module’s text names the cap). ${cures}`
    return `A full party is the usual cause: the party module’s text caps it (max 5 besides you, as shipped). ${cures}`
}

/** A record as the fold shows it. */
export function viewOf(record: LibraryRecord): LibraryRecordView {
    return { ...record, keys: [...record.keys], blurb: blurb(record.content) }
}

export function createNpcLibrary(deps: NpcLibraryDeps): NpcLibrary {
    const now = deps.now ?? (() => new Date())

    async function records(userId: string | undefined): Promise<LibraryRecord[]> {
        return deps.store.load(userId)
    }

    async function campaignNpcBook(chatId: string, userId: string | undefined): Promise<{ id: string; name: string } | null> {
        const prefs = await deps.prefs.load(userId)
        const prefix = resolveCampaignPrefix({ chatId, override: prefs.campaignNames?.[chatId], anchorChatId: chatId })
        const wanted = campaignBookName(prefix, 'NPC').toLowerCase()
        const books = await deps.books(userId).listBooks()
        return books.find((book) => book.name.toLowerCase() === wanted) ?? null
    }

    /** Keep a card under a name: refused as `exists` unless overwriting, in which case the record keeps its id and its portrait when none is given. */
    async function keep(userId: string | undefined, input: { name: string; content: string; keys: string[]; portraitPath?: string; notes?: string }, overwrite: boolean): Promise<LibraryRecordView | { status: 'exists'; name: string }> {
        const current = await records(userId)
        const existing = findByName(current, input.name)
        if (existing && !overwrite) return { status: 'exists', name: existing.name }
        const record = createRecord({
            ...(existing ? { id: existing.id, createdAt: existing.createdAt } : {}),
            name: input.name,
            content: input.content,
            keys: input.keys,
            portraitPath: input.portraitPath !== undefined ? input.portraitPath : existing?.portraitPath ?? '',
            notes: input.notes ?? existing?.notes ?? '',
        })
        const { records: next, stored } = upsertRecord(current, record, existing?.id)
        await deps.store.save(next, userId)
        deps.log.info(`library: ${existing ? 'replaced' : 'saved'} "${stored.name}"${stored.portraitPath ? ' with its portrait' : ''}`)
        return viewOf(stored)
    }

    async function portraitOf(chatId: string, userId: string | undefined, name: string): Promise<string> {
        if (!deps.portraits) return ''
        try {
            const { portraits } = await deps.portraits.load(chatId, userId)
            const wanted = name.trim().toLowerCase()
            for (const [entity, src] of Object.entries(portraits)) if (entity.trim().toLowerCase() === wanted && src) return src
        } catch {
            return ''
        }
        return ''
    }

    /** Put a card's portrait on an entity in the chat, if the card has one. Never fails the action. */
    async function placePortrait(chatId: string, userId: string | undefined, record: LibraryRecord): Promise<void> {
        if (!deps.portraits || !record.portraitPath) return
        try {
            await deps.portraits.set(chatId, record.name, record.portraitPath, userId)
        } catch (error) {
            deps.log.warn(`library: the portrait for "${record.name}" could not be placed: ${describe(error)}`)
        }
    }

    /** The record by id, or the error the editor shows. */
    async function recordById(userId: string | undefined, id: string): Promise<LibraryRecord> {
        const record = findById(await records(userId), id)
        if (!record) throw new Error('That card is no longer in the library.')
        return record
    }

    /** The record with its photo's address replaced, saved. */
    async function withPhoto(userId: string | undefined, record: LibraryRecord, portraitPath: string): Promise<LibraryRecord> {
        const current = await records(userId)
        const { records: next, stored } = upsertRecord(current, createRecord({ ...record, portraitPath }), record.id)
        await deps.store.save(next, userId)
        return stored
    }

    /** The photo on the open chat's entity of the card's name (60), when a chat is named and the card has one. Never fails the action; the result says. */
    async function placeIn(chatId: string | undefined, userId: string | undefined, record: LibraryRecord): Promise<boolean> {
        if (!chatId || !deps.portraits || !record.portraitPath) return false
        try {
            await deps.portraits.set(chatId, record.name, record.portraitPath, userId)
            deps.log.info(`library: the photo of "${record.name}" placed in chat ${chatId}`)
            return true
        } catch (error) {
            deps.log.warn(`library: the photo of "${record.name}" could not be placed in chat ${chatId}: ${describe(error)}`)
            return false
        }
    }

    /** The draw itself (60): the prompt, the size, the picture, the record. `at` is the draw's clock, for the finished event. */
    /** The photo's prompt (60): the legacy's NPC prompt on the agent's connection. */
    async function writePhotoPrompt(record: LibraryRecord, userId: string | undefined, chatId: string | undefined): Promise<string> {
        if (!deps.generate) throw new Error('This build cannot write an image prompt.')
        const settings = (await deps.settings?.load(userId)) ?? {}
        const systemPrompt = typeof settings.portraitNpcSystemPrompt === 'string' ? settings.portraitNpcSystemPrompt : ''
        if (!systemPrompt.trim()) throw new Error('The cartridge has no NPC portrait prompt (portraitNpcSystemPrompt).')
        const wordTarget = Number(settings.portraitPromptWordTarget) || 200
        const { system, user } = buildLibraryPhotoPrompt({ name: record.name, content: record.content, systemPrompt, wordTarget })
        const prompt = (await deps.generate(system, user, chatId, userId)).trim()
        if (!prompt) throw new Error('The model returned no image prompt.')
        return prompt
    }

    async function drawPhotoOf(record: LibraryRecord, userId: string | undefined, chatId: string | undefined, at: string, given?: string): Promise<LibraryPhotoResult> {
        if (!deps.imageGen) throw new Error(NO_IMAGE_GRANT)
        // The edited prompt (73f) is drawn as given; otherwise one model call writes it.
        const prompt = (given ?? '').trim() || await writePhotoPrompt(record, userId, chatId)
        // The portrait's image connection (61), the scene's when none is chosen (49), else the host's default; its provider's schema and its own saved sizes decide the 2:3 pair.
        const chosen = await deps.prefs.load(userId)
        const wanted = (chosen.portraitConnectionId ?? '').trim() || (chosen.scenePictureConnectionId ?? '').trim()
        const connections = await deps.imageGen.listConnections(userId).catch(() => [])
        const connection = connections.find((c) => c.id === wanted) ?? connections.find((c) => c.is_default) ?? connections[0] ?? null
        const schema = await providerSchema(userId, connection?.provider ?? '')
        const size = portraitSize(schema, connection?.default_parameters ?? {})
        deps.log.info(`library: drawing the photo of "${record.name}"${connection ? ` on "${connection.name}"` : ''}${size.size ? ` at ${size.size}` : ` at the connection's own size (${size.reason})`}`)
        const drawn = await deps.imageGen.generate({ prompt, ...(wanted ? { connection_id: wanted } : {}), ...(Object.keys(size.parameters).length ? { parameters: size.parameters } : {}), userId })
        let src = (drawn.imageUrl ?? '').trim()
        if (!src) {
            if (!deps.images) throw new Error('The image came back as data and this build cannot store images.')
            const stored = await deps.images.uploadFromDataUrl(drawn.imageDataUrl, photoFilename(record, 'photo.png'), userId)
            if (!stored?.url) throw new Error('The image was stored but the host returned no address for it.')
            src = stored.url
        }
        const kept = await withPhoto(userId, record, src)
        deps.log.info(`library: the photo of "${kept.name}" drawn by ${drawn.provider} (${drawn.model})${size.size ? `, ${size.size}` : ''}`)
        deps.events?.finished(chatId, userId, { name: kept.name, at, outcome: 'drawn' })
        return { record: viewOf(kept), placed: await placeIn(chatId, userId, kept), prompt, provider: drawn.provider, model: drawn.model, size: size.size, ...(size.reason ? { sizeNote: size.reason } : {}) }
    }

    /** The provider's parameter schema, when the host lists it; `null` when it cannot be read. */
    async function providerSchema(userId: string | undefined, provider: string): Promise<Record<string, ProviderParameter> | null> {
        if (!provider || !deps.imageGen?.getProviders) return null
        try {
            const found = (await deps.imageGen.getProviders(userId)).find((p) => p.id === provider)
            return found?.capabilities?.parameters ?? null
        } catch (error) {
            deps.log.warn(`library: the image providers could not be listed: ${describe(error)}`)
            return null
        }
    }

    async function direct(chatId: string, userId: string | undefined, instruction: string, who: string): Promise<TrackerPassOutcome> {
        const prefs = await deps.prefs.load(userId)
        return deps.trackerPass.run({ chatId, userId, trigger: 'direct', instruction, window: prefs.trackerDirectLookback, playerName: who })
    }

    return {
        async list(userId) {
            return (await records(userId))
                .map(viewOf)
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
        },

        async sources(chatId, userId) {
            const out: LibrarySources = { book: '', entries: [], playerCard: null }
            try {
                const book = await campaignNpcBook(chatId, userId)
                if (book) {
                    out.book = book.name
                    const entries = await deps.books(userId).listEntries(book.id)
                    out.entries = entries
                        .filter((entry) => entry.comment.trim())
                        .map((entry) => ({ id: entry.id, name: entry.comment.trim(), blurb: blurb(entry.content), core: /\[CORE\]/i.test(entry.content) }))
                        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
                }
            } catch (error) {
                deps.log.warn(`library: the campaign's NPC book could not be read: ${describe(error)}`)
                out.error = describe(error)
            }
            if (deps.playerCard) {
                const view = await deps.playerCard.view(chatId, userId).catch(() => null)
                if (view?.card) out.playerCard = { name: view.card.name, blurb: blurb(view.card.bio) }
            }
            return out
        },

        async saveEntry({ chatId, userId, entryId, overwrite = false }) {
            const book = await campaignNpcBook(chatId, userId)
            if (!book) throw new Error('This campaign has no NPC book yet; the agent makes one when it records the first NPC.')
            const entry = (await deps.books(userId).listEntries(book.id)).find((candidate) => candidate.id === entryId)
            if (!entry) throw new Error('That entry is no longer in the NPC book.')
            const name = entry.comment.trim() || 'Unnamed NPC'
            const portrait = await portraitOf(chatId, userId, name)
            return keep(userId, { name, content: identityOf(entry.content), keys: entry.key.length ? entry.key : [name], ...(portrait ? { portraitPath: portrait } : {}) }, overwrite)
        },

        async savePlayerCard({ chatId, userId, overwrite = false }) {
            if (!deps.playerCard) throw new Error('This build has no Player Card to save.')
            const view = await deps.playerCard.view(chatId, userId)
            if (!view.card) throw new Error('This chat has no Player Card to save.')
            const portrait = await portraitOf(chatId, userId, view.card.name)
            return keep(userId, { name: view.card.name, content: identityOf(view.card.bio), keys: [view.card.name], ...(portrait ? { portraitPath: portrait } : {}) }, overwrite)
        },

        async saveCard({ characterId, userId, overwrite = false }) {
            if (!deps.characters) throw new Error('the host has not granted the characters permission, so no card can be read')
            const card = await deps.characters.get(characterId, userId)
            if (!card) throw new Error(`No character card was found for "${characterId}".`)
            // The NPC creator's Add as is, verbatim (41a): the description, the
            // personality after it when the description does not open with it,
            // in one [CORE]; the name and its first word as the keywords. The
            // same text the creator would write into a chat's NPC book, so a
            // card kept here and one added there read the same.
            const entry = entryFrom({ name: card.name.trim() || 'Unnamed', description: card.description ?? '', personality: card.personality ?? '' })
            deps.log.info(`library: saving the card "${entry.name}"${card.avatar ? ' with its picture' : ''}`)
            return keep(userId, { name: entry.name, content: identityOf(entry.content), keys: entry.keys, ...(card.avatar ? { portraitPath: card.avatar } : {}) }, overwrite)
        },

        async update({ userId, id, name, content, keys, notes }) {
            const current = await records(userId)
            const existing = findById(current, id)
            if (!existing) throw new Error('That card is no longer in the library.')
            const wanted = (name ?? existing.name).trim() || existing.name
            const clash = findByName(current, wanted)
            if (clash && clash.id !== id) throw new Error(`"${clash.name}" is already in the library.`)
            const record = createRecord({
                id,
                createdAt: existing.createdAt,
                name: wanted,
                content: content !== undefined ? identityOf(content) : existing.content,
                keys: keys ?? existing.keys,
                portraitPath: existing.portraitPath,
                notes: notes ?? existing.notes,
            })
            const { records: next, stored } = upsertRecord(current, record, id)
            await deps.store.save(next, userId)
            deps.log.info(`library: edited "${stored.name}"`)
            return viewOf(stored)
        },

        async setPhoto({ userId, id, dataUrl, filename, chatId }) {
            const record = await recordById(userId, id)
            if (!/^data:image\//i.test(dataUrl)) throw new Error('The photo must be an image.')
            if (!deps.images) throw new Error('This build cannot store images.')
            const stored = await deps.images.uploadFromDataUrl(dataUrl, photoFilename(record, filename), userId)
            if (!stored?.url) throw new Error('The image was stored but the host returned no address for it.')
            const kept = await withPhoto(userId, record, stored.url)
            deps.log.info(`library: the photo of "${kept.name}" set from a file`)
            return { record: viewOf(kept), placed: await placeIn(chatId, userId, kept) }
        },

        async photoPrompt({ userId, id, chatId }) {
            const record = await recordById(userId, id)
            deps.log.info(`library: writing the photo prompt of "${record.name}", to be edited before the draw`)
            return { name: record.name, prompt: await writePhotoPrompt(record, userId, chatId) }
        },

        async drawPhoto({ userId, id, chatId, prompt }) {
            const record = await recordById(userId, id)
            // Announced (60-bis): the head's Picture light turns amber, then green or red, as for the scene's draw.
            const at = (deps.now?.() ?? new Date()).toISOString()
            deps.events?.started(chatId, userId, record.name, at)
            try {
                return await drawPhotoOf(record, userId, chatId, at, prompt)
            } catch (error) {
                deps.events?.finished(chatId, userId, { name: record.name, at, outcome: 'failed', reason: describe(error) })
                throw error
            }
        },

        async removePhoto({ userId, id }) {
            const record = await recordById(userId, id)
            const kept = await withPhoto(userId, record, '')
            deps.log.info(`library: the photo of "${kept.name}" removed`)
            return { record: viewOf(kept), placed: false }
        },

        async remove(userId, id) {
            const { records: next, removed } = removeRecord(await records(userId), id)
            if (!removed) return false
            await deps.store.save(next, userId)
            deps.log.info(`library: removed "${removed.name}"`)
            return true
        },

        async importPackages({ userId, text }) {
            const packages = parsePackages(text)
            let current = await records(userId)
            const stored: LibraryRecordView[] = []
            for (const pkg of packages) {
                const name = uniqueName(pkg.name, current)
                let portraitPath = ''
                const dataUrl = dataUrlFromPayload(pkg.portrait)
                if (dataUrl && deps.images) {
                    try {
                        const put = await deps.images.uploadFromDataUrl(dataUrl, `${packageFilename({ name }).replace(/\.mnpc\.json$/, '')}.${pkg.portrait?.mime?.split('/')[1] ?? 'png'}`, userId)
                        portraitPath = put?.url ?? ''
                    } catch (error) {
                        deps.log.warn(`library: the portrait of "${name}" could not be stored: ${describe(error)}`)
                    }
                }
                const record = createRecord({ name, content: pkg.content, keys: pkg.keys, portraitPath, notes: pkg.notes })
                const result = upsertRecord(current, record)
                current = result.records
                stored.push(viewOf(result.stored))
            }
            await deps.store.save(current, userId)
            deps.log.info(`library: imported ${stored.length} card${stored.length === 1 ? '' : 's'}: ${stored.map((r) => r.name).join(', ')}`)
            return stored
        },

        async exportPackage({ userId, id, portraitDataUrl = '' }) {
            const record = findById(await records(userId), id)
            if (!record) throw new Error('That card is no longer in the library.')
            const pkg = serializePackage(record, portraitDataUrl)
            return { filename: packageFilename(record), file: JSON.stringify(pkg, null, 2), withPortrait: !!pkg.portrait }
        },

        async party({ chatId, userId, id }) {
            const at = now().toISOString()
            const record = findById(await records(userId), id)
            if (!record) return { status: 'failed', at, action: 'party', name: '', reason: 'That card is no longer in the library.' }
            try {
                deps.log.info(`library: seating "${record.name}" in the party of chat ${chatId}`)
                const outcome = await direct(chatId, userId, partyPrompt(record), '')
                if (outcome.status !== 'updated') {
                    let reason = `the tracker pass ${outcome.status === 'failed' ? 'failed' : 'changed nothing'}${outcome.reason ? `: ${outcome.reason}` : ''}`
                    // A seat the tracker declined (53-bis): say why it usually does.
                    if (outcome.status === 'no-change') {
                        const partyText = deps.settings ? await deps.settings.load(userId).then((s) => (s.stockPrompts as Record<string, unknown> | undefined)?.party).catch(() => undefined) : undefined
                        reason += `. ${partyRoomHint(outcome.memo, typeof partyText === 'string' ? partyText : null)}`
                    }
                    deps.log.warn(`library: "${record.name}" was not seated: ${reason}`)
                    return { status: 'failed', at, action: 'party', name: record.name, reason }
                }
                await placePortrait(chatId, userId, record)
                const added = outcome.delta?.added ?? []
                const replaced = outcome.delta?.replaced ?? []
                deps.log.info(`library: "${record.name}" seated: ${[...added, ...replaced].join(', ') || 'the memo'}`)
                return { status: 'done', at, action: 'party', name: record.name, added, replaced, portrait: !!record.portraitPath }
            } catch (error) {
                deps.log.warn(`library: seating "${record.name}" failed: ${describe(error)}`)
                return { status: 'failed', at, action: 'party', name: record.name, reason: describe(error) }
            }
        },

        async playAsPc({ chatId, userId, id }) {
            const at = now().toISOString()
            const record = findById(await records(userId), id)
            if (!record) return { status: 'failed', at, action: 'pc', name: '', reason: 'That card is no longer in the library.' }
            if (!deps.playerCard) return { status: 'failed', at, action: 'pc', name: record.name, reason: 'this build has no Player Card to set' }
            try {
                deps.log.info(`library: "${record.name}" becomes the player of chat ${chatId}`)
                const card: CardResult = await deps.playerCard.save({ chatId, userId, name: record.name, bio: bioOf(record.content) })
                await placePortrait(chatId, userId, record)
                const outcome = await direct(chatId, userId, playAsPcPrompt(record), record.name)
                if (outcome.status !== 'updated') {
                    const reason = `the Player Card is set, but the tracker pass ${outcome.status === 'failed' ? 'failed' : 'changed nothing'}${outcome.reason ? `: ${outcome.reason}` : ''}`
                    deps.log.warn(`library: ${reason}`)
                    return { status: 'failed', at, action: 'pc', name: record.name, card, reason }
                }
                const added = outcome.delta?.added ?? []
                const replaced = outcome.delta?.replaced ?? []
                const sheetName = extractCharacterName(outcome.memo ?? '') || record.name
                deps.log.info(`library: "${record.name}" is the player as "${sheetName}": ${[...added, ...replaced].join(', ') || 'the memo'}`)
                return { status: 'done', at, action: 'pc', name: sheetName, card, added, replaced, portrait: !!record.portraitPath }
            } catch (error) {
                deps.log.warn(`library: "${record.name}" could not become the player: ${describe(error)}`)
                return { status: 'failed', at, action: 'pc', name: record.name, reason: describe(error) }
            }
        },
    }
}
