/**
 * The portraits drawn as they appear (Phase 61, roadmap row 61): the
 * legacy's per-entity auto-generation (`portraits.js`), in the backend.
 *
 * After every tracker pass and every agent pass the chat's roster is read
 * — the character, the party, the enemies, by the legacy's readers in
 * `portrait-prompt.ts`, and the campaign's NPC book — and whoever the
 * switches cover and has no portrait is drawn: the prompt written by a
 * model on the portrait's text connection (the character's prompt over the
 * memo and the narrator's card, an NPC's over their entry), the picture by
 * the host's image generation at 60's 2:3 pair, kept under the name in the
 * chat's portraits. One draw at a time, whoever asked, as the legacy
 * queues them.
 *
 * The legacy's rules, kept: the first check of a chat records who is
 * there and draws nobody (its F5 rule, so a page reload never draws the
 * whole cast), a party member, the player or an enemy is drawn only when
 * new since, an NPC whenever they have no portrait, a switch ticked on
 * draws everyone it covers at once, and a name with a portrait or a draw
 * in flight is skipped. One departure: a name whose draw failed is not
 * tried again on its own until a switch is ticked or Draw is pressed — the
 * legacy retries every check, which with a provider down is a failed call
 * per reply.
 */

import type { PortraitAutoStatus, PortraitDrawReport, PortraitDrawResult, PortraitPromptResult } from '../protocol.js'
import { portraitSize, type ProviderParameter } from '../tracker/library-photo.js'
import { buildCharacterPortraitPrompt, buildNpcPortraitPrompt, keyMeetsName, lookbackCount, portraitRoster, type StoryLine } from '../tracker/portrait-prompt.js'
import { lookupPortrait, normalizeEntityName } from '../tracker/portraits.js'
import { stripStamp } from '../agent/provenance.js'

export interface PortraitAutoPrefs {
    portraitAutoPlayer?: boolean
    portraitAutoParty?: boolean
    portraitAutoEnemies?: boolean
    portraitAutoNpcs?: boolean
    portraitStoryLookback?: boolean
    portraitStoryLookbackCount?: number
    /** The host's image connection, `''` for the scene picture's, then the host's default. */
    portraitConnectionId?: string
    scenePictureConnectionId?: string
}

export interface PortraitNpcEntry {
    name: string
    content: string
    /** The entry's keywords, for the lookback's matching rule. */
    keys?: string[]
}

export interface PortraitAutoDeps {
    memos: { load(chatId: string, userId: string | undefined): Promise<{ memo: string }> }
    /** The cartridge, for the two prompts and the word target. */
    settings: { load(userId: string | undefined): Promise<Record<string, unknown>> }
    prefs: { load(userId: string | undefined): Promise<PortraitAutoPrefs> }
    portraits: {
        load(chatId: string, userId: string | undefined): Promise<{ portraits: Record<string, string> }>
        set(chatId: string, name: string, src: string, userId: string | undefined): Promise<unknown>
    }
    /** The model call that writes the image prompt, on the portrait's text connection. */
    generate: (system: string, user: string, chatId: string, userId: string | undefined) => Promise<string>
    /** The host's image generation; absent when the grant is missing. */
    imageGen?: {
        generate(input: { prompt: string; connection_id?: string; parameters?: Record<string, unknown>; owner_chat_id?: string; userId: string | undefined }): Promise<{ imageDataUrl: string; imageUrl?: string; model: string; provider: string }>
        listConnections(userId: string | undefined): Promise<Array<{ id: string; name: string; provider: string; is_default: boolean; default_parameters?: Record<string, unknown> }>>
        getProviders?(userId: string | undefined): Promise<Array<{ id: string; capabilities?: { parameters?: Record<string, ProviderParameter> } }>>
    }
    images?: {
        uploadFromDataUrl(dataUrl: string, options: { originalFilename: string; owner_chat_id: string; userId: string | undefined }): Promise<{ url?: string } | null | undefined>
    }
    /** The campaign's NPC book, as entries with a name; empty when there is none. */
    npcs: (chatId: string, userId: string | undefined) => Promise<PortraitNpcEntry[]>
    /** The campaign's entries that may match a name, for the lookback; absent reads none. */
    lore?: (chatId: string, userId: string | undefined) => Promise<Array<{ label: string; content: string; keys: string[] }>>
    /** The chat, oldest first, for the lookback. */
    messages?: (chatId: string, userId: string | undefined) => Promise<StoryLine[]>
    persona?: (userId: string | undefined) => Promise<{ description: string } | null>
    narrator?: (chatId: string, userId: string | undefined) => Promise<{ description: string } | null>
    /** Whether the benched-party module is on, for the game state's compaction. */
    benchedParty?: (userId: string | undefined) => Promise<boolean>
    events?: {
        started(chatId: string, userId: string | undefined, start: { name: string; at: string; source: PortraitDrawReport['source']; queued: number }): void
        finished(chatId: string, userId: string | undefined, report: PortraitDrawReport): void
    }
    log: { info(m: string): void; warn(m: string): void }
    now?: () => Date
}

export interface PortraitAuto {
    /** The check after a pass: the first for a chat seeds, the rest draw what is new. */
    check(chatId: string, userId: string | undefined): Promise<void>
    /** The check a ticked switch asks for: everyone it covers, now. */
    force(chatId: string, userId: string | undefined): Promise<void>
    /** One name drawn on a press, whatever the switches say; the result when it lands. */
    draw(chatId: string, userId: string | undefined, name: string, prompt?: string): Promise<PortraitDrawResult>
    /** The portrait's prompt written and handed back for editing (73f): one model call, nothing drawn, nothing queued. */
    prompt(chatId: string, userId: string | undefined, name: string): Promise<PortraitPromptResult>
    /** What is drawing and queued for the chat, and the last outcome per name; seeds the chat as the panel's first look at it. */
    status(chatId: string, userId: string | undefined): Promise<PortraitAutoStatus>
}

const NO_GRANT = 'This build cannot draw portraits: the host has not granted the image_gen permission.'

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

interface ChatMemory {
    seeded: boolean
    /** Names seen, in upper case, as the legacy keeps them. */
    known: Set<string>
    /** Names whose last draw on its own failed, in upper case; cleared by a tick or a press. */
    failed: Set<string>
    last: Map<string, PortraitDrawReport>
}

interface Job {
    chatId: string
    userId: string | undefined
    name: string
    key: string
    source: PortraitDrawReport['source']
    /** The NPC's entry, for the NPC prompt; `null` for the character's. */
    npc: PortraitNpcEntry | null
    /** The prompt as the user edited it (73f), drawn in place of a written one. */
    prompt?: string
    /** How many were ahead of it when it was queued, the one running counted. */
    ahead: number
    /** When the draw began, once it has. */
    at?: string
    run: () => Promise<void>
}

export function createPortraitAuto(deps: PortraitAutoDeps): PortraitAuto {
    const now = deps.now ?? (() => new Date())
    const chats = new Map<string, ChatMemory>()
    const queue: Job[] = []
    let running: Job | null = null

    function memory(chatId: string): ChatMemory {
        let m = chats.get(chatId)
        if (!m) {
            m = { seeded: false, known: new Set(), failed: new Set(), last: new Map() }
            chats.set(chatId, m)
        }
        return m
    }

    const keyOf = (name: string) => normalizeEntityName(name).toUpperCase()
    const inFlight = (chatId: string, key: string) => (running?.chatId === chatId && running.key === key) || queue.some((j) => j.chatId === chatId && j.key === key)

    async function drain(): Promise<void> {
        if (running) return
        while (queue.length > 0) {
            running = queue.shift()!
            try {
                await running.run()
            } catch (error) {
                deps.log.warn(`portraits: the draw of "${running.name}" threw: ${describe(error)}`)
            }
        }
        running = null
    }

    async function providerSchema(userId: string | undefined, provider: string): Promise<Record<string, ProviderParameter> | null> {
        if (!provider || !deps.imageGen?.getProviders) return null
        try {
            return (await deps.imageGen.getProviders(userId)).find((p) => p.id === provider)?.capabilities?.parameters ?? null
        } catch (error) {
            deps.log.warn(`portraits: the image providers could not be listed: ${describe(error)}`)
            return null
        }
    }

    /** The lookback's pieces, read only when the switch is on; a reader that fails reads as nothing. */
    async function lookbackFor(chatId: string, userId: string | undefined, prefs: PortraitAutoPrefs, name: string) {
        const count = lookbackCount(prefs.portraitStoryLookbackCount)
        const persona = deps.persona ? (await deps.persona(userId).catch(() => null))?.description ?? '' : ''
        const story = deps.messages ? await deps.messages(chatId, userId).catch(() => [] as StoryLine[]) : []
        const narratorDescription = deps.narrator ? (await deps.narrator(chatId, userId).catch(() => null))?.description ?? '' : ''
        const entries = deps.lore ? await deps.lore(chatId, userId).catch(() => []) : []
        const lore = entries.filter((e) => e.keys.some((k) => keyMeetsName(k, name))).map((e) => ({ label: e.label, content: e.content }))
        const benchedParty = deps.benchedParty ? await deps.benchedParty(userId).catch(() => true) : true
        return { count, persona, story, narratorDescription, lore, benchedParty }
    }

    async function writePrompt(chatId: string, userId: string | undefined, name: string, npc: PortraitNpcEntry | null, memo: string): Promise<string> {
        const settings = await deps.settings.load(userId).catch(() => ({} as Record<string, unknown>))
        const prefs = await deps.prefs.load(userId)
        const wordTarget = Number(settings.portraitPromptWordTarget) || 200
        const lookback = prefs.portraitStoryLookback === true ? await lookbackFor(chatId, userId, prefs, name) : null
        let built: { system: string; user: string }
        if (npc) {
            const systemPrompt = typeof settings.portraitNpcSystemPrompt === 'string' ? settings.portraitNpcSystemPrompt : ''
            if (!systemPrompt.trim()) throw new Error('The cartridge has no NPC portrait prompt (portraitNpcSystemPrompt).')
            built = buildNpcPortraitPrompt({ name, content: npc.content, systemPrompt, wordTarget, ...(lookback ? { lookback: { persona: lookback.persona, narratorDescription: lookback.narratorDescription, story: lookback.story, count: lookback.count } } : {}) })
        } else {
            const systemPrompt = typeof settings.portraitCharacterSystemPrompt === 'string' ? settings.portraitCharacterSystemPrompt : ''
            if (!systemPrompt.trim()) throw new Error('The cartridge has no character portrait prompt (portraitCharacterSystemPrompt).')
            // The narrator's card goes in whatever the lookback says, as the legacy's does.
            const narratorDescription = deps.narrator ? (await deps.narrator(chatId, userId).catch(() => null))?.description ?? '' : ''
            built = buildCharacterPortraitPrompt({ name, memo, narratorDescription, systemPrompt, wordTarget, ...(lookback ? { lookback: { persona: lookback.persona, lore: lookback.lore, story: lookback.story, count: lookback.count, benchedParty: lookback.benchedParty } } : {}) })
        }
        const prompt = (await deps.generate(built.system, built.user, chatId, userId)).trim()
        if (!prompt) throw new Error('The model returned no image prompt.')
        return prompt
    }

    /** One draw, start to finish: the prompt, the picture, the store, the events. Throws what failed after reporting it. */
    async function drawOne(job: Job): Promise<PortraitDrawResult> {
        const { chatId, userId, name, source } = job
        const at = now().toISOString()
        job.at = at
        const m = memory(chatId)
        deps.events?.started(chatId, userId, { name, at, source, queued: job.ahead })
        try {
            if (!deps.imageGen) throw new Error(NO_GRANT)
            const memo = (await deps.memos.load(chatId, userId).catch(() => ({ memo: '' }))).memo
            const prompt = (job.prompt ?? '').trim() || await writePrompt(chatId, userId, name, job.npc, memo)
            const prefs = await deps.prefs.load(userId)
            // The portrait's own image connection (61); the scene's when none is chosen (the library's rule of 60); else the host's default.
            const wanted = ((prefs.portraitConnectionId ?? '').trim() || (prefs.scenePictureConnectionId ?? '').trim())
            const connections = await deps.imageGen.listConnections(userId).catch(() => [])
            const connection = connections.find((c) => c.id === wanted) ?? connections.find((c) => c.is_default) ?? connections[0] ?? null
            const size = portraitSize(await providerSchema(userId, connection?.provider ?? ''), connection?.default_parameters ?? {})
            deps.log.info(`portraits: drawing "${name}" for chat ${chatId} (${source})${connection ? ` on "${connection.name}"` : ''}${size.size ? ` at ${size.size}` : ` at the connection's own size (${size.reason})`}`)
            const drawn = await deps.imageGen.generate({ prompt, ...(wanted ? { connection_id: wanted } : {}), ...(Object.keys(size.parameters).length ? { parameters: size.parameters } : {}), owner_chat_id: chatId, userId })
            let src = (drawn.imageUrl ?? '').trim()
            if (!src) {
                if (!deps.images) throw new Error('The image came back as data and this build cannot store images.')
                const stored = await deps.images.uploadFromDataUrl(drawn.imageDataUrl, { originalFilename: `portrait-${normalizeEntityName(name).replace(/[^\w-]+/g, '_') || 'entity'}.png`, owner_chat_id: chatId, userId })
                if (!stored?.url) throw new Error('The image was stored but the host returned no address for it.')
                src = stored.url
            }
            await deps.portraits.set(chatId, normalizeEntityName(name), src, userId)
            deps.log.info(`portraits: "${name}" drawn by ${drawn.provider} (${drawn.model})${size.size ? `, ${size.size}` : ''} for chat ${chatId}`)
            const report: PortraitDrawReport = { chatId, name, at, source, outcome: 'drawn', prompt, provider: drawn.provider, model: drawn.model, size: size.size, ...(size.reason ? { sizeNote: size.reason } : {}) }
            m.last.set(job.key, report)
            m.failed.delete(job.key)
            deps.events?.finished(chatId, userId, report)
            return { name, at, prompt, provider: drawn.provider, model: drawn.model, size: size.size, ...(size.reason ? { sizeNote: size.reason } : {}) }
        } catch (error) {
            const reason = describe(error)
            deps.log.warn(`portraits: "${name}" could not be drawn (${source}): ${reason}`)
            const report: PortraitDrawReport = { chatId, name, at, source, outcome: 'failed', reason }
            m.last.set(job.key, report)
            if (source !== 'pressed') m.failed.add(job.key)
            deps.events?.finished(chatId, userId, report)
            throw error
        }
    }

    /** Queue a draw unless the name has a portrait or one is in flight. Returns whether it was queued. */
    function enqueue(chatId: string, userId: string | undefined, name: string, source: PortraitDrawReport['source'], npc: PortraitNpcEntry | null, portraits: Record<string, string>, settle?: { resolve(r: PortraitDrawResult): void; reject(e: unknown): void }, prompt?: string): boolean {
        const key = keyOf(name)
        if (!key) return false
        if (source !== 'pressed' && lookupPortrait(portraits, name)) return false
        if (inFlight(chatId, key)) {
            settle?.reject(new Error(`A portrait of ${name} is already being drawn.`))
            return false
        }
        const ahead = queue.length + (running ? 1 : 0)
        const job: Job = {
            chatId, userId, name, key, source, npc, ahead,
            ...(prompt ? { prompt } : {}),
            run: async () => {
                try {
                    const result = await drawOne(job)
                    settle?.resolve(result)
                } catch (error) {
                    if (settle) settle.reject(error)
                }
            },
        }
        queue.push(job)
        deps.log.info(`portraits: queued "${name}" for chat ${chatId} (${source}${ahead ? `, ${ahead} ahead` : ''})`)
        void drain()
        return true
    }

    async function roster(chatId: string, userId: string | undefined, prefs: PortraitAutoPrefs) {
        const memo = (await deps.memos.load(chatId, userId).catch(() => ({ memo: '' }))).memo
        const r = portraitRoster(memo)
        // An NPC's name is the entry's title without the agent's old stamp (73a): "Teodor", not "Teodor [msg #0]".
        const npcs = prefs.portraitAutoNpcs === true ? (await deps.npcs(chatId, userId).catch((error) => { deps.log.warn(`portraits: the campaign's NPC book could not be read: ${describe(error)}`); return [] as PortraitNpcEntry[] })).map((npc) => ({ ...npc, name: stripStamp(npc.name) })).filter((npc) => npc.name) : []
        return { ...r, npcs }
    }

    async function run(chatId: string, userId: string | undefined, force: boolean): Promise<void> {
        const prefs = await deps.prefs.load(userId)
        const any = prefs.portraitAutoPlayer === true || prefs.portraitAutoParty === true || prefs.portraitAutoEnemies === true || prefs.portraitAutoNpcs === true
        const m = memory(chatId)
        const { character, party, enemies, npcs } = await roster(chatId, userId, prefs)
        // The first look at a chat records who is there and draws nobody — the legacy's F5 rule.
        if (!m.seeded && !force) {
            m.seeded = true
            for (const name of [...party, ...enemies, ...(character ? [character] : []), ...npcs.map((n) => n.name)]) m.known.add(keyOf(name))
            deps.log.info(`portraits: chat ${chatId} seen with ${m.known.size} names; nothing drawn on the first look`)
            return
        }
        m.seeded = true
        if (force) m.failed.clear()
        if (!any) {
            for (const name of [...party, ...enemies, ...(character ? [character] : [])]) m.known.add(keyOf(name))
            return
        }
        const portraits = (await deps.portraits.load(chatId, userId).catch(() => ({ portraits: {} }))).portraits
        const consider = (name: string, on: boolean, source: PortraitDrawReport['source'], npc: PortraitNpcEntry | null, always: boolean) => {
            const key = keyOf(name)
            if (!key) return
            const fresh = always || force || !m.known.has(key)
            m.known.add(key)
            if (!on || !fresh || (m.failed.has(key) && !force)) return
            enqueue(chatId, userId, name, source, npc, portraits)
        }
        for (const name of party) consider(name, prefs.portraitAutoParty === true, 'party', null, false)
        if (character) consider(character, prefs.portraitAutoPlayer === true, 'player', null, false)
        for (const name of enemies) consider(name, prefs.portraitAutoEnemies === true, 'enemy', null, false)
        // An NPC is drawn whenever they have no portrait, as the legacy does; the known list does not gate them.
        for (const npc of npcs) consider(npc.name, prefs.portraitAutoNpcs === true, 'npc', npc, true)
    }

    return {
        check: (chatId, userId) => run(chatId, userId, false),
        force: (chatId, userId) => run(chatId, userId, true),

        async draw(chatId, userId, name, prompt) {
            const clean = normalizeEntityName(name)
            if (!clean) throw new Error('A portrait needs a name.')
            const m = memory(chatId)
            m.failed.delete(keyOf(clean))
            // An NPC of the campaign's book is described from their entry; anyone else from the memo.
            const npcs = await deps.npcs(chatId, userId).catch(() => [] as PortraitNpcEntry[])
            const npc = npcs.find((n) => keyOf(n.name) === keyOf(clean)) ?? null
            return new Promise<PortraitDrawResult>((resolve, reject) => {
                enqueue(chatId, userId, clean, 'pressed', npc, {}, { resolve, reject }, (prompt ?? '').trim() || undefined)
            })
        },

        async prompt(chatId, userId, name) {
            const clean = normalizeEntityName(name)
            if (!clean) throw new Error('A portrait needs a name.')
            const npcs = await deps.npcs(chatId, userId).catch(() => [] as PortraitNpcEntry[])
            const npc = npcs.find((n) => keyOf(n.name) === keyOf(clean)) ?? null
            const memo = (await deps.memos.load(chatId, userId).catch(() => ({ memo: '' }))).memo
            deps.log.info(`portraits: writing the prompt for "${clean}" in chat ${chatId}, to be edited before the draw`)
            return { name: clean, prompt: await writePrompt(chatId, userId, clean, npc, memo) }
        },

        async status(chatId, userId) {
            const m = memory(chatId)
            if (!m.seeded) await run(chatId, userId, false).catch((error) => deps.log.warn(`portraits: chat ${chatId} could not be seeded: ${describe(error)}`))
            const drawing = running?.chatId === chatId ? [{ name: running.name, at: running.at ?? '' }] : []
            const queued = queue.filter((j) => j.chatId === chatId).map((j) => j.name)
            const last: Record<string, PortraitDrawReport> = {}
            for (const report of m.last.values()) last[normalizeEntityName(report.name)] = report
            return { drawing, queued, last }
        },
    }
}
