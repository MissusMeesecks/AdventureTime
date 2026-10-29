/**
 * Edit with AI (78c, Multihog's `✨ Edit with AI` on the Full NPC Card and the
 * Player Character's popup, `panel-builder.js` at the pin): one model call that
 * rewrites a whole entry or the Player Card to the user's instructions. The two
 * prompts are the legacy's, transcribed and held to the source by
 * `card-ai-edit.pin.test.ts`, since the popup is a closure over the whole panel
 * and cannot be sliced.
 */

export type CardAiEditKind = 'npc' | 'pc'

/** The legacy's pieces, each verbatim. */
export const CARD_AI_EDIT_TEXT = {
    npcSystem: 'You are a character editor for a roleplay lorebook system. The user wants to make specific changes to an existing NPC entry. Output the ENTIRE revised entry with the requested changes applied — keep the same format and everything else identical. Do not add preambles or commentary. Output only the revised entry text.',
    npcCurrent: 'CURRENT NPC ENTRY:',
    npcTail: 'Output the full revised entry now.',
    pcSystem: 'You are a persona editor for a roleplay system. The user wants to make specific changes to an existing character persona. Output the ENTIRE revised persona with the requested changes applied — keep everything else identical. Do not add preambles or commentary. Output only the revised persona text.',
    pcCurrent: 'CURRENT PERSONA:',
    pcTail: 'Output the full revised persona now.',
    changes: 'REQUESTED CHANGES:',
    /** The legacy's three toasts, in its words. */
    emptyInstructions: 'Please describe what you want changed.',
    emptyResult: 'AI returned an empty result. Please try again.',
} as const

export interface CardAiEditPrompt {
    system: string
    user: string
}

/** The system prompt and the user message for one edit, as the legacy builds them. */
export function buildCardAiEditPrompt(kind: CardAiEditKind, content: string, instructions: string): CardAiEditPrompt {
    const t = CARD_AI_EDIT_TEXT
    const current = kind === 'pc' ? t.pcCurrent : t.npcCurrent
    const tail = kind === 'pc' ? t.pcTail : t.npcTail
    return {
        system: kind === 'pc' ? t.pcSystem : t.npcSystem,
        user: `${current}\n${content || ''}\n\n${t.changes}\n${instructions}\n\n${tail}`,
    }
}
