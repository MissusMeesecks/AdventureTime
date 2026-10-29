/**
 * The NPC library against the pinned legacy build.
 *
 * Opt-in, like the other `.pin` tests. To run it:
 *
 *   git clone --filter=blob:none \
 *     https://github.com/MultihogAurelius/SillyTavern-MultihogDnDFramework /tmp/mh
 *   git -C /tmp/mh checkout d6aab004f97f1f9a286f235de62f22ba1abadbe8
 *   MULTIHOG_CHECKOUT=/tmp/mh npx vitest run src/tracker/npc-library.pin.test.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { allNames, sliceLegacy } from '../../scripts/extract-npc-library.mjs'
import { createNpcLibraryLegacy } from './npc-library-legacy.js'
import { blurb, createRecord, identityOf, parsePackages, partyPrompt, playAsPcPrompt, serializePackage, synopsis, uniqueName, type LibraryRecord } from './npc-library.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && existsSync(`${checkout}/npc-library-lib.js`)

type Fn = (...args: unknown[]) => unknown

describe.skipIf(!available)('the NPC library against the pinned legacy build', () => {
    it('is the generated module, byte for byte, from a fresh slice of the checkout, with every export', () => {
        const committed = readFileSync('src/tracker/npc-library-legacy.js', 'utf8')
        expect(committed).toContain(sliceLegacy(checkout!))
        const names = allNames(checkout!)
        expect(names.length).toBeGreaterThanOrEqual(24)
        const made = createNpcLibraryLegacy() as Record<string, unknown>
        for (const name of names) expect(made[name], name).toBeDefined()
    })

    it('agrees with the checkout\'s own modules over identities, names, packages, blurbs and prompts', async () => {
        const lib = (await import(`${checkout}/npc-library-lib.js`)) as Record<string, Fn>
        const synopsisModule = (await import(`${checkout}/src/ui/panel/card-synopsis.js`)) as Record<string, Fn>
        const texts = [
            '[CORE]\nSpecies: Human\nBody: Lean.\nPersonality: Wary.\nFriendship/Rapport: 40/100\n[/CORE]\n\nChronicle.',
            'Species: Elf\nAffection/Interest: 2/10\n\n\n\nPersonality: Kind',
            '[ID: 3]\nAppearance/Species: A tall orc.\nPersonality: Loud.',
            'A tired smith.\nOwes money.\nThird line.',
            '',
        ]
        for (const text of texts) {
            expect(identityOf(text)).toBe(lib.extractLibraryIdentityContent!(text))
            expect(blurb(text)).toBe(synopsisModule.getCardLibraryBlurb!(text))
            expect(synopsis(text)).toBe(synopsisModule.getCardAppearanceSynopsis!(text))
        }
        const records: LibraryRecord[] = [createRecord({ id: 'a', name: 'Kestrel', content: texts[0]!, keys: ['Kes'] }), createRecord({ id: 'b', name: 'Kestrel (2)', content: texts[1]! })]
        for (const name of ['Kestrel', 'kestrel', 'Orrin', '']) {
            expect(uniqueName(name, records)).toBe(lib.uniqueLibraryNpcName!(name, { npcLibrary: records }))
        }
        for (const record of records) {
            expect(partyPrompt(record)).toBe(lib.buildAddLibraryNpcToPartyPrompt!(record))
            expect(playAsPcPrompt(record)).toBe(lib.buildApplyLibraryCardAsPcPrompt!(record))
            const ours = serializePackage(record, 'data:image/png;base64,AAAA')
            const theirs = lib.serializeNpcPackage!(record, 'data:image/png;base64,AAAA') as Record<string, unknown>
            expect({ ...ours, exportedAt: 0 }).toEqual({ ...theirs, exportedAt: 0 })
            expect(parsePackages(JSON.stringify(ours))).toEqual(lib.parseNpcPackages!(JSON.stringify(theirs)))
        }
    })
})
