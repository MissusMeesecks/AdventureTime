/**
 * Full Review Mode's two texts (departure 22, Phase 73c) against the pinned
 * legacy build: the generated module must be what a fresh read of the
 * checkout's `src/state/defaults.js` gives, and the texts themselves must
 * be the contract the mode promises. Needs MULTIHOG_CHECKOUT for the
 * differential half; the shape half runs always.
 */
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

import { EXPORTS, SOURCE, renderLegacy } from '../../scripts/extract-full-review.mjs'
import { FULL_REVIEW_STATE_SYSTEM_PROMPT, FULL_REVIEW_USER_PROMPT_SUFFIX } from './full-review-legacy.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && existsSync(`${checkout}/${SOURCE}`)

describe('Full Review Mode’s texts (73c)', () => {
    it('is a complete-dump contract: the modules placeholder, no NO_CHANGES_DETECTED, the suffix asking for every module', () => {
        expect(FULL_REVIEW_STATE_SYSTEM_PROMPT).toContain('FULL REVIEW MODE')
        expect(FULL_REVIEW_STATE_SYSTEM_PROMPT).toContain('{{modulesText}}')
        expect(FULL_REVIEW_STATE_SYSTEM_PROMPT).toContain('`NO_CHANGES_DETECTED` is FORBIDDEN')
        expect(FULL_REVIEW_USER_PROMPT_SUFFIX).toBe('## OUTPUT THE COMPLETE, VERIFIED STATE MEMO FOR EVERY ENABLED MODULE:')
    })
})

describe.skipIf(!available)('Full Review Mode’s texts against the pinned legacy build', () => {
    it('is the generated module, byte for byte, from a fresh read of the checkout', async () => {
        const upstream = await import(pathToFileURL(`${checkout}/${SOURCE}`).href) as Record<string, unknown>
        const values: Record<string, string> = Object.fromEntries(EXPORTS.map((name: string) => [name, String(upstream[name])]))
        const head = readFileSync('src/tracker/full-review-legacy.js', 'utf8').match(/@ ([0-9a-f]{40})\./)![1]!
        expect(readFileSync('src/tracker/full-review-legacy.js', 'utf8')).toBe(renderLegacy(values, head))
        expect(upstream.FULL_REVIEW_STATE_SYSTEM_PROMPT).toBe(FULL_REVIEW_STATE_SYSTEM_PROMPT)
        expect(upstream.FULL_REVIEW_USER_PROMPT_SUFFIX).toBe(FULL_REVIEW_USER_PROMPT_SUFFIX)
    })
})
