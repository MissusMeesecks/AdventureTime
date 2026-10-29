/**
 * Edit with AI (78c): one quiet call on the agent's connection — the legacy
 * sends it on the router's — with Multihog's editor prompts, the whole revised
 * text back for the user to read before it is applied. Nothing is written here:
 * the panel's Apply goes through `records.update` or `creator.card.save`.
 */
import { readGenerationText } from './tracker-pass.js'
import { buildCardAiEditPrompt, CARD_AI_EDIT_TEXT, type CardAiEditKind } from '../tracker/card-ai-edit.js'

export interface CardAiEditDeps {
    generate: { quiet(input: Record<string, unknown>): Promise<unknown> }
    prefs: { load(userId: string | undefined): Promise<{ agentConnectionId?: string }> }
    log: { info(message: string): void; warn(message: string): void }
}

export interface CardAiEdit {
    edit(userId: string | undefined, kind: CardAiEditKind, content: string, instructions: string): Promise<{ text: string }>
}

export function createCardAiEdit(deps: CardAiEditDeps): CardAiEdit {
    return {
        async edit(userId, kind, content, instructions) {
            const asked = instructions.trim()
            if (!asked) throw new Error(CARD_AI_EDIT_TEXT.emptyInstructions)
            const what = kind === 'pc' ? 'the Player Card' : 'an NPC entry'
            const prefs: { agentConnectionId?: string } = await deps.prefs.load(userId).catch(() => ({}))
            const prompt = buildCardAiEditPrompt(kind, content, asked)
            deps.log.info(`card edit: rewriting ${what} with AI from "${asked.slice(0, 60)}" (${content.length} characters)`)
            const raw = await deps.generate.quiet({
                userId,
                ...(prefs.agentConnectionId ? { connectionId: prefs.agentConnectionId } : {}),
                messages: [
                    { role: 'system', content: prompt.system },
                    { role: 'user', content: prompt.user },
                ],
            })
            const text = readGenerationText(raw).trim()
            if (!text) {
                deps.log.warn(`card edit: the model answered with nothing for ${what}`)
                throw new Error(CARD_AI_EDIT_TEXT.emptyResult)
            }
            deps.log.info(`card edit: ${what} rewritten (${text.length} characters), shown for review`)
            return { text }
        },
    }
}
