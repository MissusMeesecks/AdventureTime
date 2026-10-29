import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SCENE_PROMPT_LIMITS, SCENE_PROMPT_TEXT } from './scene-prompt.js'

/**
 * The scene picture's prompt is transcribed from `portraits.js`, a closure
 * over the whole install that cannot be sliced; this pins each piece of
 * text to the checkout so an upstream rewording is caught.
 */
const checkout = process.env.MULTIHOG_CHECKOUT
const describeIf = checkout ? describe : describe.skip

describeIf('the scene prompt against the pinned legacy (49)', () => {
    const source = () => readFileSync(join(checkout!, 'portraits.js'), 'utf8')

    it('carries the legacy’s context labels word for word', () => {
        const text = source()
        expect(text).toContain('`Location Path: ${normPath}`')
        expect(text).toContain('`Location Lorebook Entry (PRIMARY — depict this specific place):\\n${locContent.trim()}`')
        expect(text).toContain("const role = i === 0 ? 'Immediate parent' : 'Ancestor';")
        expect(text).toContain(SCENE_PROMPT_TEXT.referenceArt)
        expect(text).toContain('`Parent Location Chain (style/theme guides only — generate a DISTINCT image for "${normPath}", not a duplicate of a parent):\\n${parentBlocks.join(\'\\n\\n\')}`')
        expect(text).toContain('`Recent Narrator Output (last 2 replies — use for mood, staging, and moment):\\n${narratorBlock.substring(0, 6000)}`')
        expect(text).toContain('`Characters Present Now (include in the scene):\\n${charBlocks.join(\'\\n\\n\')}`')
        expect(text).toContain(SCENE_PROMPT_TEXT.noLore)
        expect(text).toContain(SCENE_PROMPT_TEXT.noBio)
        expect(text).toContain('`Player Character: ${pc.name}`')
        expect(text).toContain('`User Persona (for art style context):\\n${persona.trim()}`')
        expect(text).toContain('`Narrator Card Description (for world context):\\n${charData.description.substring(0, 1500)}`')
        expect(text).toContain("contextParts.join('\\n\\n---\\n\\n')")
        expect(text).toContain("const narratorBlock = formatRecentNarratorOutputs(ctx, 2);")
        expect(text).toContain('lore.content.trim().substring(0, 900)')
        expect(SCENE_PROMPT_LIMITS).toEqual({ ancestorContent: 900, narration: 6000, narratorCard: 1500, narrationsRead: 2 })
    })

    it('fills the same three placeholders of the location system prompt', () => {
        const text = source()
        expect(text).toContain(".replace(/\\{\\{name\\}\\}/g, leafName)")
        expect(text).toContain(".replace(/\\{\\{path\\}\\}/g, normPath)")
        expect(text).toContain(".replace(/\\{\\{wordtarget\\}\\}/g, String(s.portraitPromptWordTarget || 200))")
    })
})
