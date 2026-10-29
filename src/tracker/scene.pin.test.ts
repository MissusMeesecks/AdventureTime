import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { NAMES, sliceLegacy } from '../../scripts/extract-scene.mjs'
import { createSceneLegacy } from './scene-legacy.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && existsSync(`${checkout}/src/state/present-now.js`)

describe.skipIf(!available)('the scene view against the pinned legacy build (42)', () => {
    it('is the generated module, byte for byte, from a fresh slice of the checkout', () => {
        expect(readFileSync('src/tracker/scene-legacy.js', 'utf8')).toContain(sliceLegacy(checkout!))
    })

    it('runs the checkout\'s own Present Now helpers beside ours over a corpus', async () => {
        const theirs = await import(/* @vite-ignore */ `${checkout}/src/state/present-now.js`) as Record<string, (...args: unknown[]) => unknown>
        const ours = createSceneLegacy() as Record<string, (...args: unknown[]) => unknown>
        for (const name of NAMES) expect(typeof ours[name], name).toBe('function')
        const corpus = [
            'Plain prose with no choices.',
            'Sedge waits. <choices><button>Greet Bill</button><button>Leave</button></choices>',
            'Escaped &lt;choices&gt;&lt;button&gt;Go&lt;/button&gt;&lt;/choices&gt; tail',
            '<div class="rt-cyoa-choices"><button>A</button></div>\n\n\n\nAfter.',
            '',
        ]
        for (const text of corpus) expect(ours.stripCyoaChoiceBlocks!(text)).toBe(theirs.stripCyoaChoiceBlocks!(text))
        const chats = [
            [{ is_user: true, mes: 'u' }, { mes: 'narrator' }, { is_user: true, mes: 'u2' }],
            [{ mes: 'a' }, { is_system: true, mes: 's' }],
            [{ mes: 'a', is_hidden: true }],
            [{ mes: 'a', extra: { summary: true } }],
            [],
        ]
        for (const chat of chats) {
            expect(ours.findMostRecentNarratorMessage!(chat)).toEqual(theirs.findMostRecentNarratorMessage!(chat))
            expect(ours.findMostRecentNarratorMessage!(chat, { includeHidden: true })).toEqual(theirs.findMostRecentNarratorMessage!(chat, { includeHidden: true }))
        }
    })
})
