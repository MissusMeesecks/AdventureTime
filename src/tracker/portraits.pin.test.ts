/**
 * The portrait lookup, differentially tested against the legacy build itself.
 *
 * A portrait map is user data with a long life — someone sets a picture for
 * every NPC in a campaign and expects it to keep appearing — and the lookup is
 * deliberately forgiving in ways that are easy to get subtly wrong: a
 * parenthetical strip, then a case- and accent-blind fallback. "We believe this
 * matches" is not good enough, so this lifts `normalizeEntityName` and
 * `lookupCustomPortraitSrc` straight out of `portrait-storage.js` at the pinned
 * commit and runs both implementations over the same corpus.
 *
 * Opt-in, like the other `.pin` tests. To run it:
 *
 *   git clone --filter=blob:none \
 *     https://github.com/MultihogAurelius/SillyTavern-MultihogDnDFramework /tmp/mh
 *   git -C /tmp/mh checkout d6aab004f97f1f9a286f235de62f22ba1abadbe8
 *   MULTIHOG_CHECKOUT=/tmp/mh npx vitest run src/tracker/portraits.pin.test.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { lookupPortrait, normalizeEntityName } from './portraits.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && existsSync(`${checkout}/portrait-storage.js`)

interface Legacy {
    normalizeEntityName(name: string): string
    lookupCustomPortraitSrc(settings: unknown, entityName: string, map?: Record<string, string>): string
}

describe.skipIf(!available)('the portrait lookup against the pinned legacy build', () => {
    const legacy: Legacy = (() => {
        if (!available) return {} as Legacy

        const source = readFileSync(`${checkout}/portrait-storage.js`, 'utf8')
        const slice = (from: string, to: string): string => {
            const start = source.indexOf(from)
            const end = source.indexOf(to, start)
            if (start === -1 || end === -1) throw new Error(`portrait-storage.js no longer contains: ${from}`)
            return source.slice(start, end)
        }

        const body = [
            slice('function normalizeEntityName', 'export { normalizeEntityName }'),
            slice('export function lookupCustomPortraitSrc', '/** @returns {boolean} */'),
        ]
            .join('\n')
            .replace(/^\s*export /gm, '')

        // `decodeHtml` comes from memo-processor.js and `resolvePortraitDisplaySrc`
        // is the identity for anything already a usable src, so both are supplied
        // rather than sliced — what is being compared is the *matching*.
        return eval(`(function () {
            const decodeHtml = (str) => !str ? '' : String(str)
                .replace(/&quot;/g, '"')
                .replace(/&#0?39;/g, "'")
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&');
            const resolvePortraitDisplaySrc = (src) => src || '';
            ${body}
            return { normalizeEntityName, lookupCustomPortraitSrc };
        })`)() as Legacy
    })()

    const NAMES = [
        'Alice',
        'ALICE',
        'alice',
        'Alice (the innkeeper)',
        'Alice  (the innkeeper)',
        'Alice (the innkeeper) (again)',
        'Moth Wraith (a construct of Wrenna&#39;s dream)',
        'Élodie',
        'ELODIE',
        'Elodie',
        '  Padded Name  ',
        'Name &amp; Title',
        'Bob &lt;the Builder&gt;',
        'Multi Word Entity Name',
        '(only a parenthetical)',
        '',
        '   ',
        'Guard #2',
        'Guard (wounded)',
    ]

    it.each(NAMES)('normalizes %j the same way', (name) => {
        expect(normalizeEntityName(name)).toBe(legacy.normalizeEntityName(name))
    })

    const MAP: Record<string, string> = {
        Alice: '/user/images/alice.png',
        'Bob (the Builder)': '/user/images/bob.png',
        Élodie: '/user/images/elodie.png',
        'Guard #2': 'https://example.test/guard.png',
        'Multi Word Entity Name': 'data:image/png;base64,AAAA',
    }

    it.each([
        ...NAMES,
        'Bob',
        'bob',
        'BOB (the Builder)',
        'elodie',
        'Elodie',
        'guard #2',
        'multi word entity name',
        'Nobody',
    ])('looks up %j the same way', (name) => {
        expect(lookupPortrait(MAP, name)).toBe(legacy.lookupCustomPortraitSrc({}, name, MAP))
    })

    it.each([
        // Two keys differing only in case is what tells "exact first" apart from
        // "whichever the sweep reaches first". Both builds take the exact one.
        ['a map holding both cases', { alice: '/lower.png', Alice: '/upper.png' }],
        ['a map holding both cases, the other way round', { Alice: '/upper.png', alice: '/lower.png' }],
        ['a map holding an accent and its plain form', { Elodie: '/plain.png', 'Élodie': '/accented.png' }],
        ['an empty map', {}],
        ['a map with an empty value', { Alice: '' }],
        ['a map keyed with a parenthetical', { 'Alice (innkeeper)': '/a.png' }],
        ['a map keyed with padding', { '  Alice  ': '/a.png' }],
    ])('agrees on %s', (_name, map) => {
        for (const name of ['Alice', 'alice', 'ALICE', 'Alice (drunk)', 'Elodie', 'Élodie', 'Nobody']) {
            expect(lookupPortrait(map as Record<string, string>, name)).toBe(
                legacy.lookupCustomPortraitSrc({}, name, map as Record<string, string>),
            )
        }
    })

    it('agrees that a missing map finds nothing', () => {
        expect(lookupPortrait(undefined, 'Alice')).toBe(legacy.lookupCustomPortraitSrc({}, 'Alice', undefined))
    })
})
