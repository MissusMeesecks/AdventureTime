/**
 * Self-named campaigns (Phase 51, roadmap row 51).
 *
 * A chat whose campaign nobody named used to name its books after the chat
 * id, which is a GUID (9k). Now the first time the panel shows such a chat
 * it asks here, and the campaign is named after the card and the clock —
 * `Vell_261011_1432` — and the name is stored as the chat's campaign name,
 * where a typed one goes, so every book the chat makes from then on shares
 * it. A typed name still wins: this never replaces one, and the panel's box
 * still takes one.
 *
 * Which card the chat belongs to comes from the chat's own record, through
 * the `chats` grant (51-bis): the panel's `getActiveChat().characterId` is
 * empty for a chat just made, and the first live try named every new chat
 * `Chat_…` on it. The panel's id is the fallback when the record cannot be
 * read. The card is then read through the `characters` grant; a card that
 * cannot be read is `Chat_…`. With no card known at all — no record and no
 * id — nothing is named: the panel asks again on the next chat event.
 */

import { mintCampaignName, resolveCampaignPrefix, uniqueCampaignName } from '../agent/campaign.js'
import type { CampaignNameResult } from '../protocol.js'

export interface CampaignNamerDeps {
    prefs: {
        load(userId: string | undefined): Promise<{ campaignNames?: Record<string, string> }>
        patch(patch: { campaignNames: Record<string, string> }, userId: string | undefined): Promise<unknown>
    }
    /** The host's character cards; absent when the grant is missing. */
    characters?: { get(id: string, userId: string | undefined): Promise<{ name: string } | null> }
    /** The host's chat records, for the card a chat belongs to (51-bis); absent when the grant is missing. */
    chats?: { get(chatId: string, userId: string | undefined): Promise<{ characterId: string | null } | null> }
    log: { info(m: string): void; warn(m: string): void }
    now?: () => Date
}

export interface CampaignNamer {
    /** The chat's campaign name, minted and stored if it had none. */
    name(request: { chatId: string; userId: string | undefined; characterId?: string }): Promise<CampaignNameResult>
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

export function createCampaignNamer(deps: CampaignNamerDeps): CampaignNamer {
    const now = deps.now ?? (() => new Date())
    return {
        async name({ chatId, userId, characterId }) {
            const prefs = await deps.prefs.load(userId)
            const names = prefs.campaignNames ?? {}
            const existing = (names[chatId] ?? '').trim()
            const prefixOf = (name: string) => resolveCampaignPrefix({ chatId, override: name, anchorChatId: chatId })
            if (existing) return { name: existing, minted: false, prefix: prefixOf(existing) }

            // The chat's own record outranks the panel's view of it (51-bis).
            let cardId = characterId ?? ''
            if (deps.chats) {
                try {
                    cardId = (await deps.chats.get(chatId, userId))?.characterId || cardId
                } catch (error) {
                    deps.log.warn(`campaign: the chat ${chatId} could not be read for its card: ${describe(error)}`)
                }
            }
            if (!cardId) {
                deps.log.info(`campaign: chat ${chatId} has no card known yet; not named`)
                return { name: '', minted: false, prefix: prefixOf(''), reason: 'the chat’s card is not known yet' }
            }
            let cardName = ''
            if (deps.characters) {
                try {
                    cardName = (await deps.characters.get(cardId, userId))?.name ?? ''
                } catch (error) {
                    deps.log.warn(`campaign: the card ${cardId} could not be read for the name: ${describe(error)}`)
                }
            }
            const taken = Object.entries(names).filter(([id]) => id !== chatId).map(([, name]) => name)
            const name = uniqueCampaignName(mintCampaignName(cardName, now()), taken)
            // Read again at the write: a pass may have stored one meanwhile.
            const latest = (await deps.prefs.load(userId)).campaignNames ?? {}
            const raced = (latest[chatId] ?? '').trim()
            if (raced) return { name: raced, minted: false, prefix: prefixOf(raced) }
            await deps.prefs.patch({ campaignNames: { ...latest, [chatId]: name } }, userId)
            deps.log.info(`campaign: named chat ${chatId} "${name}"${cardName ? ` after "${cardName}"` : ' (no card to name it after)'}`)
            return { name, minted: true, prefix: prefixOf(name) }
        },
    }
}
