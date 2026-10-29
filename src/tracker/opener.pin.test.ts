/**
 * The Map Architect's text opener, held to the pinned source (46): the
 * generated module must equal a fresh slice of the checkout byte for byte,
 * and the checkout's own module, which imports only the map library, must
 * agree with both faces over a corpus of blocks.
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { sliceLegacy } from '../../scripts/extract-opener.mjs'
import {
    createAreaMapCommandIsComplete,
    parseCreateAreaMapCommand,
    stripCreateAreaMapCommand,
    textOpenerBrief,
} from './architect.js'
import {
    applyTextOpenerCyoaCaveat,
    isTextOpener,
    MAP_ARCHITECT_TEXT_OPENER_CYOA_CAVEAT,
    MAP_ARCHITECT_TEXT_OPENER_RULES,
    normalizeMapArchitectOpener,
} from './opener.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && existsSync(`${checkout}/map-architect-opener.js`)

describe.skipIf(!available)('the text opener against the pinned legacy build', () => {
    it('is the generated module, byte for byte, from a fresh slice of the checkout', () => {
        const committed = readFileSync('src/tracker/opener-legacy.js', 'utf8')
        expect(committed).toContain(sliceLegacy(checkout!))
    })

    it('carries the checkout\'s rules and caveat, and reads the setting, the block and the brief as it does', async () => {
        const theirs = (await import(`${checkout}/map-architect-opener.js`)) as Record<string, (...a: unknown[]) => unknown> & { MAP_ARCHITECT_TEXT_OPENER_RULES: string; MAP_ARCHITECT_TEXT_OPENER_CYOA_CAVEAT: string }
        expect(MAP_ARCHITECT_TEXT_OPENER_RULES).toBe(theirs.MAP_ARCHITECT_TEXT_OPENER_RULES)
        expect(MAP_ARCHITECT_TEXT_OPENER_CYOA_CAVEAT).toBe(theirs.MAP_ARCHITECT_TEXT_OPENER_CYOA_CAVEAT)
        const corpus = [
            'Prose.\n[CREATE_AREA_MAP]\nsite: Cellar Crypt\nentrance: Threshold\nkind: DUNGEON\nscale: SMALL\nthreat: HIGH\nprompt: A crypt.\nbrief_description: Sealed.\n[/CREATE_AREA_MAP]\nAfter.',
            '[ CREATE_AREA_MAP ]\n**site**: Vault\n_entrance_: Gate\nkind: interior\nscale: medium-large\nthreat: deadly\nprompt: One.\nTwo.\n[ /CREATE_AREA_MAP ]',
            '<p>&#91;CREATE_AREA_MAP&#93;</p><p>name: The Hollow</p><p>entrance: Mouth</p><p>kind: SETTLEMENT</p><p>premise: p</p><p>include: ["Old Mill"]</p><p>&#91;/CREATE_AREA_MAP&#93;</p>',
            '[CREATE_AREA_MAP]\n{"site":"Vault","entrance":"Gate","kind":"INTERIOR","prompt":"p","attach_to_site":"Town","attach_to_cell":"Square"}\n[/CREATE_AREA_MAP]',
            '[CREATE_AREA_MAP]\nsite: X\n[/CREATE_AREA_MAP]',
            'No block. (Location: Somewhere)',
            '',
        ]
        for (const text of corpus) {
            expect(parseCreateAreaMapCommand(text), text).toEqual(theirs.parseCreateAreaMapCommand!(text))
            expect(stripCreateAreaMapCommand(text), text).toEqual(theirs.stripCreateAreaMapCommand!(text))
            const parsed = parseCreateAreaMapCommand(text)
            expect(createAreaMapCommandIsComplete(parsed?.args)).toBe(theirs.createAreaMapCommandIsComplete!(parsed?.args))
        }
        for (const value of ['text', 'TEXT ', 'tool', '', undefined, 7]) {
            expect(normalizeMapArchitectOpener(value)).toBe(theirs.normalizeMapArchitectOpener!(value))
            expect(isTextOpener({ mapArchitectOpener: value })).toBe(theirs.isMapArchitectTextOpener!({ mapArchitectOpener: value }))
        }
        for (const args of [{ entrance: 'Gate' }, {}, { entrance: ' ' }]) expect(textOpenerBrief(args)).toBe(theirs.buildMapArchitectContinueBrief!(args))
        for (const block of ['<CYOA_mode>\nx\n</CYOA_mode>', '<cyoa_mode>  y', 'no tag', '']) expect(applyTextOpenerCyoaCaveat(block)).toBe(theirs.applyMapArchitectTextOpenerCyoaCaveat!(block))
    })

})
