/**
 * The scene picture's prompt (Phase 49, roadmap row 49): the legacy's
 * `generateLocationImagePrompt` (`portraits.js`), transcribed piece by
 * piece and pinned to the checkout by `scene-prompt.pin.test.ts`, since
 * the function is a closure over the whole SillyTavern install.
 *
 * One model call writes an image prompt from the place's entry, its parent
 * chain as a style guide, the newest narrator replies for the moment, who
 * is present, the persona and the narrator's card; the system prompt is
 * the cartridge's `portraitLocationSystemPrompt` with its three
 * placeholders filled. The image connection then draws what comes back.
 */

import { normalizeLocationPath } from './scene.js'

/** The legacy's `getAncestorLocationPaths`: the immediate parent first, then up. */
export function ancestorLocationPaths(path: string): string[] {
    const parts = normalizeLocationPath(path).split(' :: ').filter(Boolean)
    const ancestors: string[] = []
    for (let i = parts.length - 1; i >= 1; i--) ancestors.push(parts.slice(0, i).join(' :: '))
    return ancestors
}

export interface ScenePromptAncestor {
    path: string
    /** The ancestor's entry text, `''` when the books hold none. */
    content: string
    /** Whether a picture is kept for the ancestor: the legacy's "reference scene art". */
    hasArt: boolean
}

export interface ScenePromptPresence {
    label: string
    content: string
    isPlayerCharacter: boolean
}

export interface ScenePromptInput {
    /** The place's path, as the books title it. */
    path: string
    /** The place's entry text, its map stripped; `''` when no entry matches. */
    content: string
    ancestors: readonly ScenePromptAncestor[]
    /** The newest narrator replies, oldest first, at most two as the legacy reads. */
    narrations: readonly string[]
    present: readonly ScenePromptPresence[]
    persona: string
    narratorDescription: string
    /** The cartridge's `portraitLocationSystemPrompt`. */
    systemPrompt: string
    /** The cartridge's `portraitPromptWordTarget`. */
    wordTarget: number
}

/** The legacy's limits, kept as it has them. */
export const SCENE_PROMPT_LIMITS = { ancestorContent: 900, narration: 6000, narratorCard: 1500, narrationsRead: 2 } as const

/** The legacy's text, in the legacy's words (`portraits.js`, pinned). */
export const SCENE_PROMPT_TEXT = {
    locationPath: (path: string) => `Location Path: ${path}`,
    locationEntry: (content: string) => `Location Lorebook Entry (PRIMARY — depict this specific place):\n${content}`,
    immediateParent: 'Immediate parent',
    ancestor: 'Ancestor',
    referenceArt: '(Reference scene art exists for this parent — match its palette, architecture, era, materials, and atmosphere.)',
    parentChain: (path: string, blocks: string) => `Parent Location Chain (style/theme guides only — generate a DISTINCT image for "${path}", not a duplicate of a parent):\n${blocks}`,
    narration: (block: string) => `Recent Narrator Output (last 2 replies — use for mood, staging, and moment):\n${block}`,
    present: (blocks: string) => `Characters Present Now (include in the scene):\n${blocks}`,
    noLore: '(No lore content — infer appearance from name and scene context.)',
    noBio: '(No PC bio — infer appearance from recent narrator output and scene context.)',
    playerLabel: (name: string) => `Player Character: ${name}`,
    persona: (text: string) => `User Persona (for art style context):\n${text}`,
    narratorCard: (text: string) => `Narrator Card Description (for world context):\n${text}`,
    separator: '\n\n---\n\n',
} as const

/** The legacy's `formatRecentNarratorOutputs`: `Narrator:` and the text, blank line between. */
export function formatNarrations(narrations: readonly string[]): string {
    return narrations.map((text) => text.trim()).filter(Boolean).map((text) => `Narrator:\n${text}`).join('\n\n')
}

/** The two prompts of the model call that writes the image prompt. */
export function buildScenePrompt(input: ScenePromptInput): { system: string; user: string } {
    const path = normalizeLocationPath(input.path)
    const T = SCENE_PROMPT_TEXT
    const parts: string[] = [T.locationPath(path)]
    if (input.content.trim()) parts.push(T.locationEntry(input.content.trim()))

    const parentBlocks: string[] = []
    input.ancestors.forEach((ancestor, i) => {
        if (!ancestor.content.trim() && !ancestor.hasArt) return
        let block = `${i === 0 ? T.immediateParent : T.ancestor}: "${ancestor.path}"`
        if (ancestor.content.trim()) block += `\n${ancestor.content.trim().substring(0, SCENE_PROMPT_LIMITS.ancestorContent)}`
        if (ancestor.hasArt) block += `\n${T.referenceArt}`
        parentBlocks.push(block)
    })
    if (parentBlocks.length) parts.push(T.parentChain(path, parentBlocks.join('\n\n')))

    const narration = formatNarrations(input.narrations.slice(-SCENE_PROMPT_LIMITS.narrationsRead))
    if (narration) parts.push(T.narration(narration.substring(0, SCENE_PROMPT_LIMITS.narration)))

    if (input.present.length) {
        const blocks = input.present.map((who) => {
            const label = who.isPlayerCharacter ? T.playerLabel(who.label) : who.label
            const content = who.content.trim() || (who.isPlayerCharacter ? T.noBio : T.noLore)
            return `### ${label}\n${content}`
        })
        parts.push(T.present(blocks.join('\n\n')))
    }

    if (input.persona.trim()) parts.push(T.persona(input.persona.trim()))
    if (input.narratorDescription.trim()) parts.push(T.narratorCard(input.narratorDescription.substring(0, SCENE_PROMPT_LIMITS.narratorCard)))

    const leaf = path.split(' :: ').pop() || path
    const system = input.systemPrompt
        .replace(/\{\{name\}\}/g, leaf)
        .replace(/\{\{path\}\}/g, path)
        .replace(/\{\{wordtarget\}\}/g, String(input.wordTarget || 200))
    return { system, user: parts.join(T.separator) }
}
