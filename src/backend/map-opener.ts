/**
 * The Map Architect's text opener (roadmap row 9, Phase 46).
 *
 * Multihog's alternative handshake for a connection that cannot call tools:
 * instead of calling `CreateAreaMap`, the narrator writes a
 * `[CREATE_AREA_MAP] … [/CREATE_AREA_MAP]` block at the end of its reply and
 * stops. After the reply, the block is read, stripped from the message (the
 * prose before it stands; the block and anything after it go), and the
 * architect draws the site exactly as it does for the tool. The legacy then
 * *continues* the same reply with a private brief; Lumiverse has no continue,
 * so the brief rides in the next turn's map message instead, for two replies,
 * telling the narrator the map is there, to narrate from the entrance, and to
 * copy the site name into the footer once the party enters.
 *
 * The block is honoured whatever the opener setting says, as the legacy
 * honours it: a narrator that writes one in tool mode is asking for a map
 * too. The setting decides the rulebook's wording and whether the tool is
 * offered, nothing here.
 */

import { parseCreateAreaMapCommand, stripCreateAreaMapCommand, textOpenerBrief } from '../tracker/architect.js'
import type { MapArchitectRequest } from './map-architect.js'
import type { MapStore } from './map-store.js'

/** Replies the brief stays in the prompt for, counted from the drawing's end. */
export const OPENER_BRIEF_REPLIES = 2

export interface MapOpenerDeps {
    /** Whether the rulebook's mapping section is on for this user. */
    enabled: (userId: string | undefined) => Promise<boolean>
    /** The architect, awaited to the end: the finished map, the map already there, or the failure, as the narrator would be told. */
    architect: { run(request: MapArchitectRequest): Promise<string> }
    state: MapStore
    /** Rewrite the reply without the block. */
    updateMessage: (chatId: string, messageId: string, content: string, userId: string | undefined) => Promise<unknown>
    log: { info(m: string): void; warn(m: string): void }
}

export interface MapOpener {
    /**
     * After a reply: a block in it is stripped and drawn, and a brief owed from
     * an earlier drawing is counted down. True when a block was found. Never
     * throws; the drawing goes on behind the return.
     */
    afterReply(chatId: string, userId: string | undefined, messageId: string | undefined, generationType: string | undefined, content: string | undefined): Promise<boolean>
}

const SKIPPED_TYPES = new Set(['quiet', 'impersonate'])

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

export function createMapOpener(deps: MapOpenerDeps): MapOpener {
    return {
        async afterReply(chatId, userId, messageId, generationType, content) {
            const type = String(generationType ?? 'normal').toLowerCase()
            if (SKIPPED_TYPES.has(type)) return false
            try {
                // A brief already written is shown for a fixed number of replies, then dropped.
                const record = await deps.state.load(chatId, userId)
                if (record.openerBrief) {
                    const shown = (record.openerBriefReplies ?? 0) + 1
                    if (shown >= OPENER_BRIEF_REPLIES) await deps.state.save(chatId, { openerBrief: undefined, openerBriefReplies: undefined }, userId)
                    else await deps.state.save(chatId, { openerBriefReplies: shown }, userId)
                }

                const parsed = parseCreateAreaMapCommand(String(content ?? ''))
                if (!parsed) return false
                const site = parsed.args.site || '(unnamed)'
                if (!(await deps.enabled(userId))) {
                    deps.log.info(`map: text opener found a [CREATE_AREA_MAP] block for "${site}" with the mapping section off; left as written`)
                    return false
                }
                deps.log.info(`map: text opener found a [CREATE_AREA_MAP] block for "${site}" in message ${messageId ?? '(unknown)'}`)

                // The reply stands without the block: the prose before it, or a stub.
                if (messageId) {
                    const stripped = stripCreateAreaMapCommand(String(content ?? ''))
                    await deps.updateMessage(chatId, messageId, stripped.text, userId).catch((error: unknown) => {
                        deps.log.warn(`map: text opener could not strip the block from message ${messageId}: ${describe(error)}`)
                    })
                }

                // The drawing, behind the return: the fold announces it as the tool's does.
                void (async () => {
                    try {
                        const result = await deps.architect.run({ chatId, userId, args: parsed.args as unknown as Record<string, unknown> })
                        // An offsite attachment (58): the party is where it was, so no brief is seeded, as the legacy seeds none.
                        if (parsed.args.attachTo) {
                            deps.log.info(`map: text opener completed an offsite attachment of "${site}"; the narrator needs no brief`)
                            return
                        }
                        const after = await deps.state.load(chatId, userId)
                        const drawn = after.lastArchitect?.status === 'written' && after.lastArchitect.site === parsed.args.site
                        const brief = drawn ? textOpenerBrief(parsed.args) : result
                        await deps.state.save(chatId, { openerBrief: brief, openerBriefReplies: 0 }, userId)
                        deps.log.info(`map: text opener ${drawn ? 'drew' : 'could not draw'} "${site}"; the narrator is briefed from the next turn`)
                    } catch (error) {
                        deps.log.warn(`map: text opener failed for "${site}": ${describe(error)}`)
                    }
                })()
                return true
            } catch (error) {
                deps.log.warn(`map: text opener could not read the reply: ${describe(error)}`)
                return false
            }
        },
    }
}
