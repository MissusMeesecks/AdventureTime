import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { DEFAULT_NPC_SECTION_NAMES, NPC_ARCHETYPES, NPC_CREATOR_TEXT } from './npc-creator.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && existsSync(`${checkout}/src/ui/panel/panel-builder.js`)

describe.skipIf(!available)('the NPC creator against the pinned legacy build (41a)', () => {
    it('transcribes the creator\'s prompt text from the panel\'s closures, piece for piece', () => {
        // The dialog is a closure over the panel and cannot be sliced; its template text is held here instead.
        const panel = readFileSync(`${checkout}/src/ui/panel/panel-builder.js`, 'utf8')
        const defaults = readFileSync(`${checkout}/src/state/defaults.js`, 'utf8')
        const source = `${panel}\n${defaults}`
        for (const [key, piece] of Object.entries(NPC_CREATOR_TEXT)) {
            // Template literals hold their newlines raw; one piece has an escaped quote, and the
            // MATCH LENGTH line sits in a nested literal where a newline is the two characters.
            const asSource = piece.replace(/\n/g, '\\n')
            const found = source.includes(piece) || source.includes(piece.replace(/'/g, "\\'")) || source.includes(asSource)
            expect(found, `NPC_CREATOR_TEXT.${key} is not in the legacy source: ${JSON.stringify(piece)}`).toBe(true)
        }
    })

    it('names the default NPC sections and the archetypes as the legacy does', () => {
        const sections = readFileSync(`${checkout}/src/state/schema-sections.js`, 'utf8')
        const block = sections.slice(sections.indexOf('export const DEFAULT_NPC_SECTIONS'), sections.indexOf('export const DEFAULT_PC_SECTIONS'))
        const names = Array.from(block.matchAll(/name: '([^']+)'/g)).map((m) => m[1])
        expect(names).toEqual([...DEFAULT_NPC_SECTION_NAMES])
        const panel = readFileSync(`${checkout}/src/ui/panel/panel-builder.js`, 'utf8')
        const chips = Array.from(panel.matchAll(/\{ id: '([^']+)', icon: '([^']+)' \}/g)).map((m) => ({ id: m[1], icon: m[2] }))
        expect(chips).toEqual([...NPC_ARCHETYPES])
    })
})
