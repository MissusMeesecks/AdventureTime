import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { NAMES, sliceLegacy } from '../../scripts/extract-relationships.mjs'
import { createRelationshipsLegacy } from './relationships-legacy.js'
import { NARRATIVE_AWARD_SOURCE, RELATIONS_TEXT } from './relationships.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && existsSync(`${checkout}/src/state/relationship-commands.js`)

describe.skipIf(!available)('the relationships against the pinned legacy build (44)', () => {
    it('is the generated module, byte for byte, from a fresh slice of the checkout', () => {
        expect(readFileSync('src/tracker/relationships-legacy.js', 'utf8')).toContain(sliceLegacy(checkout!))
    })

    it('runs the checkout\'s own command parser beside ours over a corpus', async () => {
        const theirs = await import(/* @vite-ignore */ `${checkout}/src/state/relationship-commands.js`) as Record<string, (...args: unknown[]) => unknown>
        const ours = createRelationshipsLegacy() as unknown as Record<string, (...args: unknown[]) => unknown>
        for (const name of NAMES) expect(typeof ours[name], name).not.toBe('undefined')
        const corpus = [
            '[RELATIONS]\nFriendship +5 Marcus Vane\naffection -2 Elena\nFriendship5 Bob\tx\nnonsense\n[/RELATIONS] tail',
            'memo [RELATIONS]\nAffection +3 Kes',
            'no block',
            '',
            '[RELATIONS]\n[/RELATIONS]\n[RELATIONS]\nFriendship -150 A B C\n[/RELATIONS]',
        ]
        for (const text of corpus) expect(ours.extractStateTrackerRelationshipCommands!(text)).toEqual(theirs.extractStateTrackerRelationshipCommands!(text))
    })

    it('transcribes the award regex and the standings text from narrative-hooks.js', () => {
        const hooks = readFileSync(`${checkout}/narrative-hooks.js`, 'utf8')
        expect(hooks).toContain(`/${NARRATIVE_AWARD_SOURCE}/gi`)
        const asSource = (text: string) => text.replace(/\n/g, '\\n')
        for (const [key, piece] of Object.entries(RELATIONS_TEXT)) {
            expect(hooks.includes(asSource(piece)) || hooks.includes(piece), `RELATIONS_TEXT.${key}`).toBe(true)
        }
    })
})
