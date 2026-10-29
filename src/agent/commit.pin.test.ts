/**
 * The commit helpers, differentially tested against the pinned legacy build.
 *
 * Three of them decide what survives a rewrite of the user's campaign lore, so
 * "we believe this matches" is not good enough. `protectCoreBlock` is the one
 * that matters most: it is what stops a model rewriting an entry to add a
 * sentence and dropping the `[CORE]` block that says who the entity is.
 *
 * Opt-in, like the other `.pin` tests. To run it:
 *
 *   MULTIHOG_CHECKOUT=/tmp/mh npx vitest run src/agent/commit.pin.test.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { cleanKeys, protectCoreBlock, stripIdMarkers } from './commit.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && existsSync(`${checkout}/router.js`)

interface Legacy {
    cleanKeys(keys: unknown): string[]
    protectCoreBlock(original: string, next: string): string
}

describe.skipIf(!available)('the commit helpers against the pinned legacy build', () => {
    const legacy: Legacy = (() => {
        if (!available) return {} as Legacy
        const source = readFileSync(`${checkout}/router.js`, 'utf8')
        const slice = (from: string, to: string): string => {
            const start = source.indexOf(from)
            const end = source.indexOf(to, start)
            if (start === -1 || end === -1) throw new Error(`router.js no longer contains: ${from}`)
            return source.slice(start, end)
        }
        const body = [
            slice('function cleanKeys(keys)', '/** Site name first'),
            slice('function protectCoreBlock(originalContent, newContent)', '\n/**'),
        ].join('\n')
        return new Function(`${body}\nreturn { cleanKeys, protectCoreBlock }`)() as Legacy
    })()

    describe('tidying a keyword list', () => {
        it.each([
            ['a plain list', ['Lissa', 'rope-keeper']],
            ['blanks and padding', ['  Lissa  ', '', '   ', 'rope']],
            ['duplicates', ['Lissa', 'Lissa', 'rope']],
            ['more than the cap', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']],
            ['duplicates that only collide after trimming', ['Lissa', ' Lissa ']],
            ['not an array at all', 'Lissa'],
            ['an empty array', []],
            ['nulls among the keys', ['Lissa', null, undefined, 'rope']],
        ])('agrees on %s', (_label, keys) => {
            expect(cleanKeys(keys)).toEqual(legacy.cleanKeys(keys))
        })
    })

    describe('protecting the blocks a rewrite must not destroy', () => {
        const CORE = '[CORE]\nSpecies: fae\nOrigin: the Dimmerwood\n[/CORE]'
        const MAP = '[MAP]\nroom: cellar\n[/MAP]'

        it.each([
            ['a rewrite that dropped [CORE] entirely', `${CORE}\nShe keeps rope.`, 'She keeps rope and a knife.'],
            ['a rewrite that rewrote [CORE]', `${CORE}\nShe keeps rope.`, '[CORE]\nSpecies: human\n[/CORE]\nRope.'],
            ['a rewrite that kept [CORE] as it was', `${CORE}\nRope.`, `${CORE}\nRope and a knife.`],
            ['an original with no [CORE]', 'Just prose.', 'Different prose.'],
            ['an empty original', '', '[CORE]\nSpecies: human\n[/CORE]'],
            ['an empty rewrite', `${CORE}\nRope.`, ''],
            ['a [MAP] block dropped', `${CORE}\n${MAP}`, 'New prose.'],
            ['a [MAP] block rewritten', `${CORE}\n${MAP}`, `New prose.\n[MAP]\nroom: attic\n[/MAP]`],
            ['both blocks dropped from a long rewrite', `${MAP}\n${CORE}\nProse.`, 'Entirely new prose.'],
            ['lower-case tags in the original', '[core]\nSpecies: fae\n[/core]\nProse.', 'New prose.'],
            ['a rewrite that is only whitespace', `${CORE}\nRope.`, '   '],
        ])('agrees on %s', (_label, original, next) => {
            expect(protectCoreBlock(original, next)).toBe(legacy.protectCoreBlock(original, next))
        })
    })

    describe('stripping the id markers the agent reads back', () => {
        it.each([
            'no markers here',
            '[ID:NPCs::4]\nShe keeps rope.',
            'Before [ID:NPCs::4] after',
            '[ID:a]\n[ID:b]\nContent.',
            '',
        ])('matches the legacy regex on %j', (content) => {
            // The strip is one regex, lifted; this pins the regex rather than
            // the surrounding function, which does the writing too.
            const theirs = String(content).replace(/\[ID:[^\]]+\]\n?/gi, '').trim()
            expect(stripIdMarkers(content)).toBe(theirs)
        })
    })
})
