/**
 * The NPC creator's service (Phase 41a): a card, a library record, a concept
 * or an archetype made into an entry in the campaign's NPC book.
 *
 * The legacy's NPC/PC Manager does it in three tabs and two buttons. **Add as
 * is** writes the card into the book at once: verbatim in `[CORE]`, or after
 * one model call that fixes only world and era impossibilities (the
 * `npcAddAsIsMode` preference, `ai_review` by default); a library record goes
 * in verbatim with its own keys and portrait. **Fit into Story**, **Freeform**
 * and **Archetype** each make one model call that answers with a
 * `[[NPC: …]]` tag, which the legacy shows in a preview to edit before adding:
 * here that is `draft`, and the preview's **Add NPC** is `commit`, which takes
 * the tag as it stands in the box.
 *
 * The entry goes into `<prefix>_NPC`, made and recorded as the campaign's if it
 * does not exist yet, as the agent would make it. A name already in the book
 * is refused (`exists`), as the legacy refuses it. A portrait travels with the
 * card: a host card's avatar, or a record's portrait address.
 */

import { bookBelongsToCampaign, campaignBookName, rememberCampaignBook, resolveCampaignPrefix } from '../agent/campaign.js'
import { upgradeNpcInstruction } from '../agent/modules.js'
import type { LibraryRecord } from '../tracker/npc-library.js'
import {
    adaptPrompt,
    archetypePrompt,
    entryFrom,
    freeformPrompt,
    hasEntryNamed,
    normalizeAddAsIsMode,
    parseNpcTag,
    reviewPrompt,
    type NpcEntry,
    type NpcPrompt,
    type NpcPromptContext,
    type NpcSourceCard,
    type RecentLine,
} from '../tracker/npc-creator.js'
import type { NpcAddResult, NpcDraftResult, NpcSource } from '../protocol.js'

export interface NpcCreatorBooks {
    listBooks(): Promise<Array<{ id: string; name: string }>>
    createBook(name: string): Promise<{ id: string; name: string }>
    listEntries(bookId: string): Promise<Array<{ id: string; uid: string; key: string[]; content: string; comment: string }>>
    createEntry(bookId: string, entry: { key: string[]; content: string; comment: string }): Promise<{ id: string; uid: string }>
}

export interface NpcCreatorDeps {
    /** The cartridge: the agent's template, the NPC module's instruction, the sections. */
    settings: { load(userId: string | undefined): Promise<Record<string, unknown>> }
    memos: { load(chatId: string, userId: string | undefined): Promise<{ memo: string }> }
    prefs: { load(userId: string | undefined): Promise<{ campaignNames?: Record<string, string>; npcAddAsIsMode?: string }> }
    books: (userId: string | undefined) => NpcCreatorBooks
    /** The campaign's ownership list, and a way to record the book this makes. */
    ownership: {
        get(chatId: string, userId: string | undefined): Promise<string[]>
        set(chatId: string, books: string[], userId: string | undefined): Promise<void>
        /** A book this made: recorded as the campaign's and attached at once (66), whatever the name's standing. */
        made(chatId: string, names: string[], userId: string | undefined): Promise<void>
    }
    /** The host's character cards; absent when the grant is missing. `avatar` is the card's picture address, `''` without one. */
    characters?: {
        get(id: string, userId: string | undefined): Promise<{ id: string; name: string; description: string; personality: string; avatar?: string } | null>
    }
    /** The NPC library's records, for a card taken from it. */
    library?: { load(userId: string | undefined): Promise<LibraryRecord[]> }
    /** One model call on the agent's connection. */
    generate: (messages: Array<{ role: 'system' | 'user'; content: string }>, chatId: string, userId: string | undefined) => Promise<string>
    /** The recent story: the last `count` messages, oldest first. */
    recent?: (chatId: string, userId: string | undefined, count: number) => Promise<RecentLine[]>
    /** The chat's portraits, written when the card has one. Absent, portraits are left alone. */
    portraits?: { set(chatId: string, name: string, src: string, userId: string | undefined): Promise<unknown> }
    log: { info(m: string): void; warn(m: string): void }
    now?: () => Date
}

export interface NpcCreator {
    /** One model call that answers with a tag, for the preview: Fit into Story, Freeform, Archetype. */
    draft(request: { chatId: string; userId: string | undefined; source: NpcSource; narratorCharacterId?: string }): Promise<NpcDraftResult>
    /** Add as is: a card (verbatim or reviewed) or a library record (verbatim) into the book at once. */
    add(request: { chatId: string; userId: string | undefined; source: NpcSource; narratorCharacterId?: string }): Promise<NpcAddResult>
    /** The preview's Add NPC: the tag as edited, into the book. */
    commit(request: { chatId: string; userId: string | undefined; tag: string; name: string; how: NpcDraftResult['how']; portrait?: NpcSource }): Promise<NpcAddResult>
}

/** How many entries the world context carries, the legacy's cap for an adaptation. */
export const LORE_CONTEXT_CAP = 15

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

/** The opening of a reply that could not be read, for the note. */
function sample(text: string): string {
    const flat = text.replace(/\s+/g, ' ').trim()
    return flat.length > 160 ? `${flat.slice(0, 157)}…` : flat
}

export function createNpcCreator(deps: NpcCreatorDeps): NpcCreator {
    const now = deps.now ?? (() => new Date())

    async function campaign(chatId: string, userId: string | undefined): Promise<{ prefix: string; bookName: string; book: { id: string; name: string } | null; books: NpcCreatorBooks }> {
        const prefs = await deps.prefs.load(userId)
        const prefix = resolveCampaignPrefix({ chatId, override: prefs.campaignNames?.[chatId], anchorChatId: chatId })
        const bookName = campaignBookName(prefix, 'NPC')
        const books = deps.books(userId)
        const wanted = bookName.toLowerCase()
        const book = (await books.listBooks()).find((candidate) => candidate.name.toLowerCase() === wanted) ?? null
        return { prefix, bookName, book, books }
    }

    async function npcEntries(chatId: string, userId: string | undefined): Promise<Array<{ comment: string }>> {
        const { book, books } = await campaign(chatId, userId)
        return book ? books.listEntries(book.id) : []
    }

    /** The campaign as the prompts see it: the cartridge's texts, the state, the story, the narrator, the campaign's own entries. */
    async function contextFor(chatId: string, userId: string | undefined, narratorCharacterId: string | undefined): Promise<NpcPromptContext> {
        const settings = await deps.settings.load(userId)
        const modules = settings.routerModules as { npc?: { instruction?: unknown } } | undefined
        const memo = (await deps.memos.load(chatId, userId).catch(() => ({ memo: '' }))).memo
        const recent = deps.recent ? await deps.recent(chatId, userId, 10).catch(() => []) : []
        let narrator = ''
        if (narratorCharacterId && deps.characters) {
            const card = await deps.characters.get(narratorCharacterId, userId).catch(() => null)
            narrator = card?.description?.trim() ?? ''
        }
        const { prefix, book, books } = await campaign(chatId, userId)
        const owned = await deps.ownership.get(chatId, userId).catch(() => [])
        const lore: NpcPromptContext['lore'] = []
        const forbidden: string[] = []
        try {
            for (const candidate of await books.listBooks()) {
                const own = owned.some((name) => name.toLowerCase() === candidate.name.toLowerCase()) || bookBelongsToCampaign(candidate.name, prefix)
                if (!own) continue
                const entries = await books.listEntries(candidate.id)
                if (book && candidate.id === book.id) forbidden.push(...entries.map((entry) => entry.comment.replace(/^\[.*?\]\s*/i, '').trim()).filter(Boolean))
                for (const entry of entries) {
                    if (lore.length >= LORE_CONTEXT_CAP) break
                    lore.push({ comment: entry.comment, content: entry.content })
                }
            }
        } catch (error) {
            deps.log.warn(`npc: the campaign's books could not be read for context: ${describe(error)}`)
        }
        return {
            template: typeof settings.routerSystemPromptTemplate === 'string' ? settings.routerSystemPromptTemplate : '',
            // Refreshed the way upstream refreshes a stored instruction (45b): the shipped paragraph only.
            npcInstruction: typeof modules?.npc?.instruction === 'string' ? upgradeNpcInstruction(modules.npc.instruction) : '',
            sections: settings.npcCoreSections,
            memo,
            recent,
            narrator,
            lore,
            forbidden,
        }
    }

    async function ask(prompt: NpcPrompt, chatId: string, userId: string | undefined): Promise<string> {
        const reply = await deps.generate([{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }], chatId, userId)
        return (reply || '').trim()
    }

    /** What a source stands for: the card itself, its label and its portrait. */
    async function resolve(source: NpcSource, userId: string | undefined): Promise<{ card: NpcSourceCard; label: string; portrait: string; content: string | null }> {
        if (source.kind === 'card') {
            if (!deps.characters) throw new Error('the host has not granted the characters permission, so no card can be read')
            const card = await deps.characters.get(source.characterId, userId)
            if (!card) throw new Error(`No character card was found for "${source.characterId}".`)
            const name = card.name.trim() || 'Unnamed'
            return { card: { name, description: card.description ?? '', personality: card.personality ?? '' }, label: name, portrait: card.avatar ?? '', content: null }
        }
        if (source.kind === 'library') {
            if (!deps.library) throw new Error('This build has no NPC library.')
            const record = (await deps.library.load(userId)).find((candidate) => candidate.id === source.id)
            if (!record) throw new Error('That card is no longer in the library.')
            // The legacy hands the record's text to the adaptation as its description, and to the literal add as content.
            return { card: { name: record.name, description: record.content, personality: '', keys: record.keys }, label: record.name, portrait: record.portraitPath, content: record.content }
        }
        if (source.kind === 'freeform') return { card: { name: source.name.trim() || 'New NPC' }, label: 'the concept', portrait: '', content: null }
        return { card: { name: source.name.trim() || 'New NPC' }, label: source.archetype.trim() || 'the archetype', portrait: '', content: null }
    }

    async function write(chatId: string, userId: string | undefined, entry: NpcEntry, how: NpcAddResult['how'], portraitSrc: string): Promise<NpcAddResult> {
        const at = now().toISOString()
        const { book: existing, bookName, books } = await campaign(chatId, userId)
        let book = existing
        if (!book) {
            book = await books.createBook(bookName)
            deps.log.info(`npc: made the book ${book.name} for chat ${chatId}`)
            // Recorded as the campaign's and attached at once (66), so the agent writes to it from here on.
            await deps.ownership.made(chatId, [book.name], userId)
        } else {
            // A book that stood already, recorded as the campaign's when it was not.
            const owned = await deps.ownership.get(chatId, userId)
            const remembered = rememberCampaignBook(owned, book.name)
            if (remembered.length !== owned.length) await deps.ownership.set(chatId, remembered, userId)
        }

        if (hasEntryNamed(await books.listEntries(book.id), entry.name)) {
            deps.log.info(`npc: "${entry.name}" is already in ${book.name}`)
            return { status: 'exists', at, name: entry.name, book: book.name, how }
        }
        const made = await books.createEntry(book.id, { key: entry.keys, content: entry.content, comment: entry.name })
        let portrait = false
        if (portraitSrc && deps.portraits) {
            try {
                await deps.portraits.set(chatId, entry.name, portraitSrc, userId)
                portrait = true
            } catch (error) {
                deps.log.warn(`npc: the portrait for "${entry.name}" could not be placed: ${describe(error)}`)
            }
        }
        deps.log.info(`npc: "${entry.name}" added to ${book.name}::${made.uid} (${how}${portrait ? ', with its portrait' : ''})`)
        return { status: 'added', at, name: entry.name, book: book.name, entryId: `${book.name}::${made.uid}`, how, portrait }
    }

    return {
        async draft({ chatId, userId, source, narratorCharacterId }) {
            const at = now().toISOString()
            const how: NpcDraftResult['how'] = source.kind === 'freeform' ? 'freeform' : source.kind === 'archetype' ? 'archetype' : 'fit'
            let label = ''
            try {
                const resolved = await resolve(source, userId)
                label = resolved.label
                const ctx = await contextFor(chatId, userId, narratorCharacterId)
                const prompt = source.kind === 'freeform'
                    ? freeformPrompt({ name: source.name.trim(), description: source.description.trim() }, ctx)
                    : source.kind === 'archetype'
                        ? archetypePrompt({ archetype: source.archetype.trim(), name: source.name.trim(), concept: source.concept.trim() }, ctx)
                        : adaptPrompt(resolved.card, ctx)
                deps.log.info(`npc: drafting from ${source.kind === 'card' || source.kind === 'library' ? `"${label}"` : label} for chat ${chatId} (${how})`)
                const reply = await ask(prompt, chatId, userId)
                const parsed = parseNpcTag(reply)
                if (!parsed) {
                    const reason = reply ? `the reply had no [[NPC: …]] tag in it: ${sample(reply)}` : 'the model answered with nothing'
                    deps.log.warn(`npc: the draft from ${label} failed: ${reason}`)
                    return { status: 'failed', at, how, source: label, name: resolved.card.name, reason }
                }
                const duplicate = hasEntryNamed(await npcEntries(chatId, userId), parsed.name)
                deps.log.info(`npc: drafted "${parsed.name}"${duplicate ? ' (a name already in the book)' : ''}`)
                return { status: 'drafted', at, how, source: label, name: parsed.name, tag: reply, duplicate }
            } catch (error) {
                deps.log.warn(`npc: the draft from ${label || source.kind} failed: ${describe(error)}`)
                return { status: 'failed', at, how, source: label, name: 'name' in source ? source.name : '', reason: describe(error) }
            }
        },

        async add({ chatId, userId, source, narratorCharacterId }) {
            const at = now().toISOString()
            if (source.kind !== 'card' && source.kind !== 'library') return { status: 'failed', at, name: '', how: 'literal', reason: 'only a card or a library record can be added as is' }
            let label = ''
            try {
                const resolved = await resolve(source, userId)
                label = resolved.label
                if (source.kind === 'library') {
                    deps.log.info(`npc: adding "${label}" from the library to chat ${chatId} as is`)
                    return await write(chatId, userId, entryFrom({ name: resolved.card.name, keys: resolved.card.keys }, resolved.content), 'literal', resolved.portrait)
                }
                const mode = normalizeAddAsIsMode((await deps.prefs.load(userId)).npcAddAsIsMode)
                if (mode === 'literal') {
                    deps.log.info(`npc: adding the card "${label}" to chat ${chatId} verbatim`)
                    return await write(chatId, userId, entryFrom(resolved.card), 'literal', resolved.portrait)
                }
                deps.log.info(`npc: reviewing the card "${label}" for chat ${chatId}`)
                const ctx = await contextFor(chatId, userId, narratorCharacterId)
                const reply = await ask(reviewPrompt(resolved.card, ctx), chatId, userId)
                if (!reply) return { status: 'failed', at, name: label, how: 'reviewed', reason: 'the model answered with nothing' }
                if (!parseNpcTag(reply)) deps.log.warn(`npc: the review of "${label}" had no [[NPC: …]] tag; its text is taken whole`)
                return await write(chatId, userId, entryFrom(resolved.card, reply), 'reviewed', resolved.portrait)
            } catch (error) {
                deps.log.warn(`npc: adding "${label || source.kind}" failed: ${describe(error)}`)
                return { status: 'failed', at, name: label, how: 'literal', reason: describe(error) }
            }
        },

        async commit({ chatId, userId, tag, name, how, portrait }) {
            const at = now().toISOString()
            const fallback = name.trim() || 'New NPC'
            try {
                let portraitSrc = ''
                if (portrait && (portrait.kind === 'card' || portrait.kind === 'library')) portraitSrc = (await resolve(portrait, userId).catch(() => null))?.portrait ?? ''
                const entry = entryFrom({ name: fallback }, tag)
                deps.log.info(`npc: adding the drafted "${entry.name}" to chat ${chatId} (${how})`)
                return await write(chatId, userId, entry, how, portraitSrc)
            } catch (error) {
                deps.log.warn(`npc: adding the drafted "${fallback}" failed: ${describe(error)}`)
                return { status: 'failed', at, name: parseNpcTag(tag)?.name || fallback, how, reason: describe(error) }
            }
        },
    }
}
