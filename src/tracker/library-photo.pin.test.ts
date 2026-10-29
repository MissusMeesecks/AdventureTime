import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { LIBRARY_PHOTO_TEXT } from './library-photo.js'

/**
 * The library photo's prompt is transcribed from `portraits.js`
 * (`generateNpcPortraitPrompt`), a closure over the whole install that
 * cannot be sliced; this pins each piece of text to the checkout so an
 * upstream rewording is caught, and pins the two facts the phase departs
 * from or leans on: the legacy's library popup offers the same menu on a
 * card, and squares what it draws.
 */
const checkout = process.env.MULTIHOG_CHECKOUT
const describeIf = checkout ? describe : describe.skip

describeIf('the library photo against the pinned legacy (60)', () => {
    const source = () => readFileSync(join(checkout!, 'portraits.js'), 'utf8')

    it('carries the legacy’s context labels word for word', () => {
        const text = source()
        expect(text).toContain('`NPC Name: ${entityName}`')
        expect(text).toContain('`NPC Lorebook Entry:\\n${npcContent.trim()}`')
        expect(LIBRARY_PHOTO_TEXT.name('X')).toBe('NPC Name: X')
        expect(LIBRARY_PHOTO_TEXT.entry(' Y ')).toBe('NPC Lorebook Entry:\nY')
        expect(text).toContain("contextParts.join('\\n\\n---\\n\\n')")
        expect(LIBRARY_PHOTO_TEXT.separator).toBe('\n\n---\n\n')
        // The persona, the narrator's card and the scene come in only behind the lookback switch, off by default.
        expect(text).toContain('const useStoryLookback = !!s.portraitUseStoryLookback;')
        expect(readFileSync(join(checkout!, 'src/state/defaults.js'), 'utf8')).toContain('portraitUseStoryLookback: false,')
    })

    it('fills the same two placeholders of the NPC system prompt', () => {
        const text = source()
        expect(text).toContain('const systemPrompt = (s.portraitNpcSystemPrompt || \'\')')
        expect(text).toContain('.replace(/\\{\\{name\\}\\}/g, entityName)')
        expect(text).toContain('.replace(/\\{\\{wordtarget\\}\\}/g, String(s.portraitPromptWordTarget || 200))')
    })

    it('offers the portrait menu on a library card, and squares what it draws — the size here is the maintainer’s 2:3', () => {
        const builder = readFileSync(join(checkout!, 'src/ui/panel/panel-builder.js'), 'utf8')
        expect(builder).toContain("await showPortraitSettingsMenu(record.name, refreshLibraryPortrait, record.content || '', {")
        const index = readFileSync(join(checkout!, 'index.js'), 'utf8')
        expect(index).toContain("{ text: '🤖 AI Generate', result: 4, classes: ['menu_button'] }")
        expect(index).toContain('const scaled = await scaleImageTo512Square(dataUrl);')
        expect(source()).toContain('export function scaleImageTo512Square(dataUrl) {')
    })
})
