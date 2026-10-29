/**
 * A fork keeps its campaign (Phase 56, roadmap row 56).
 *
 * Lumiverse forks a chat by copying its messages up to a point into a new
 * chat, with the record's metadata — so the campaign's books stay attached
 * to the fork. Everything AdventureTime keeps per chat did not follow: the fork
 * came up with no campaign name (so it minted a new one), no ownership of
 * the books (so the list read them as another campaign's and the agent
 * refused to write into them), no memo, no portraits, no Player Card, no
 * relationships. The maintainer tried to duplicate the prefix by hand and
 * could not make the module recognise the books (2026-10-13).
 *
 * So the host's `CHAT_FORKED` event copies the campaign across: the name,
 * the books owned, the memo as it stood after the message the fork was
 * taken at (the memo history's snapshot for it, else the chat's current
 * memo), the portraits, the Player Card and its persona, the relationships,
 * and both passes' watermarks clipped to the fork point so the first passes
 * in the fork read what is new and not the whole chat again. The fork is
 * written only where it is empty: a fork that has already been played in,
 * or named, keeps what it has. World Progression's clock and Map
 * Evolution's clocks are not copied — the reports and the maps live in the
 * books, which the fork shares — so the clocks start on the fork's first
 * pass, as they do for any chat. Never throws: a copy that fails is said in
 * the log and the fork is still a chat.
 */

export interface CampaignForkPrefs {
    campaignNames?: Record<string, string>
    campaignBooks?: Record<string, string[]>
    trackerWatermarks?: Record<string, number>
    agentWatermarks?: Record<string, number>
}

export interface CampaignForkDeps {
    prefs: {
        load(userId: string | undefined): Promise<CampaignForkPrefs>
        patch(patch: CampaignForkPrefs, userId: string | undefined): Promise<unknown>
    }
    memos: {
        load(chatId: string, userId: string | undefined): Promise<{ memo: string }>
        save(chatId: string, memo: string, userId: string | undefined): Promise<unknown>
    }
    memoHistory?: {
        load(chatId: string, userId: string | undefined): Promise<{ snapshots: Array<{ messageId: string; memo: string }> }>
    }
    portraits?: {
        load(chatId: string, userId: string | undefined): Promise<{ portraits: Record<string, string> }>
        replace(chatId: string, portraits: Record<string, string>, userId: string | undefined): Promise<unknown>
    }
    playerCards?: {
        load(chatId: string, userId: string | undefined): Promise<{ card: unknown | null; persona: unknown | null }>
        save(chatId: string, patch: { card?: unknown | null; persona?: unknown | null }, userId: string | undefined): Promise<unknown>
    }
    relationships?: {
        load(chatId: string, userId: string | undefined): Promise<{ npcs: Record<string, unknown> }>
        replace(chatId: string, npcs: Record<string, unknown>, userId: string | undefined): Promise<unknown>
    }
    log: { info(m: string): void; warn(m: string): void }
}

export interface CampaignForkInput {
    sourceChatId: string
    forkedChatId: string
    /** The message the fork was taken at; the memo after it is the fork's. */
    forkedAtMessageId?: string
    /** Zero-based; messages up to and including it were copied. */
    forkedAtMessageIndex?: number
}

export interface CampaignForkResult {
    /** What was copied, in words, for the log. */
    copied: string[]
    /** What was left as the fork had it, in words. */
    kept: string[]
    /** What could not be copied, with why. */
    failed: string[]
}

export interface CampaignFork {
    fork(input: CampaignForkInput, userId: string | undefined): Promise<CampaignForkResult>
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

export function createCampaignFork(deps: CampaignForkDeps): CampaignFork {
    return {
        async fork(input, userId) {
            const { sourceChatId: from, forkedChatId: to } = input
            const result: CampaignForkResult = { copied: [], kept: [], failed: [] }
            if (!from || !to || from === to) {
                result.failed.push('the fork names no source and fork, or the same chat twice')
                deps.log.warn(`fork: nothing copied: ${result.failed[0]}`)
                return result
            }
            const messages = typeof input.forkedAtMessageIndex === 'number' && input.forkedAtMessageIndex >= 0 ? Math.floor(input.forkedAtMessageIndex) + 1 : null

            // The preferences: the name, the books, the watermarks — one patch.
            try {
                const prefs = await deps.prefs.load(userId)
                const patch: CampaignForkPrefs = {}
                const name = prefs.campaignNames?.[from]?.trim()
                if (name) {
                    if (prefs.campaignNames?.[to]?.trim()) result.kept.push(`the campaign name "${prefs.campaignNames[to]}"`)
                    else { patch.campaignNames = { ...(prefs.campaignNames ?? {}), [to]: name }; result.copied.push(`the campaign name "${name}"`) }
                }
                const books = prefs.campaignBooks?.[from] ?? []
                if (books.length) {
                    const own = prefs.campaignBooks?.[to] ?? []
                    const missing = books.filter((b) => !own.some((o) => o.toLowerCase() === b.toLowerCase()))
                    if (missing.length) { patch.campaignBooks = { ...(prefs.campaignBooks ?? {}), [to]: [...own, ...missing] }; result.copied.push(`${missing.length} book${missing.length === 1 ? '' : 's'} owned`) }
                    else result.kept.push('the books owned')
                }
                for (const key of ['trackerWatermarks', 'agentWatermarks'] as const) {
                    const mark = prefs[key]?.[from]
                    if (typeof mark !== 'number' || prefs[key]?.[to] !== undefined) continue
                    patch[key] = { ...(prefs[key] ?? {}), [to]: messages === null ? mark : Math.min(mark, messages) }
                }
                if (patch.trackerWatermarks || patch.agentWatermarks) result.copied.push('the watermarks')
                if (Object.keys(patch).length) await deps.prefs.patch(patch, userId)
            } catch (error) {
                result.failed.push(`the preferences: ${describe(error)}`)
            }

            // The memo: as it stood after the fork point, else as it stands.
            try {
                const own = (await deps.memos.load(to, userId)).memo
                if (own.trim()) result.kept.push('the memo')
                else {
                    let memo = ''
                    let whence = 'the chat’s current memo'
                    if (input.forkedAtMessageId && deps.memoHistory) {
                        const history = await deps.memoHistory.load(from, userId)
                        const snapshot = history.snapshots.find((s) => s.messageId === input.forkedAtMessageId)
                        if (snapshot) { memo = snapshot.memo; whence = 'the memo as it stood at the fork point' }
                    }
                    if (!memo) memo = (await deps.memos.load(from, userId)).memo
                    if (memo.trim()) { await deps.memos.save(to, memo, userId); result.copied.push(whence) }
                }
            } catch (error) {
                result.failed.push(`the memo: ${describe(error)}`)
            }

            // The portraits.
            if (deps.portraits) {
                try {
                    const own = (await deps.portraits.load(to, userId)).portraits
                    if (Object.keys(own).length) result.kept.push('the portraits')
                    else {
                        const portraits = (await deps.portraits.load(from, userId)).portraits
                        const count = Object.keys(portraits).length
                        if (count) { await deps.portraits.replace(to, { ...portraits }, userId); result.copied.push(`${count} portrait${count === 1 ? '' : 's'}`) }
                    }
                } catch (error) {
                    result.failed.push(`the portraits: ${describe(error)}`)
                }
            }

            // The Player Card and its persona.
            if (deps.playerCards) {
                try {
                    const own = await deps.playerCards.load(to, userId)
                    if (own.card || own.persona) result.kept.push('the Player Card')
                    else {
                        const record = await deps.playerCards.load(from, userId)
                        if (record.card || record.persona) { await deps.playerCards.save(to, { card: record.card, persona: record.persona }, userId); result.copied.push('the Player Card') }
                    }
                } catch (error) {
                    result.failed.push(`the Player Card: ${describe(error)}`)
                }
            }

            // The relationships.
            if (deps.relationships) {
                try {
                    const own = (await deps.relationships.load(to, userId)).npcs
                    if (Object.keys(own).length) result.kept.push('the relationships')
                    else {
                        const npcs = (await deps.relationships.load(from, userId)).npcs
                        const count = Object.keys(npcs).length
                        if (count) { await deps.relationships.replace(to, structuredClone(npcs), userId); result.copied.push(`${count} relationship${count === 1 ? '' : 's'}`) }
                    }
                } catch (error) {
                    result.failed.push(`the relationships: ${describe(error)}`)
                }
            }

            const words = [
                result.copied.length ? `copied ${result.copied.join(', ')}` : 'nothing to copy',
                result.kept.length ? `kept the fork’s own ${result.kept.join(', ')}` : '',
                result.failed.length ? `could not copy ${result.failed.join('; ')}` : '',
            ].filter(Boolean).join('; ')
            ;(result.failed.length ? deps.log.warn : deps.log.info).call(deps.log, `fork: chat ${to} forked from ${from}${messages !== null ? ` at message ${messages}` : ''}: ${words}`)
            return result
        },
    }
}
