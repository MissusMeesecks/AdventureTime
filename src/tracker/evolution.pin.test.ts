/**
 * Map Evolution's legacy half, held to the pinned source: the generated
 * module must equal a fresh slice of the checkout byte for byte, and the
 * three prompt modules the checkout can lend as they are must agree with
 * ours. The helper library imports SillyTavern's settings through
 * `memo-processor.js`, so it is held by the byte diff alone.
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { exportedNames, sliceLegacy } from '../../scripts/extract-evolution.mjs'
import { parseArchitectResponse } from './architect.js'
import { createEvolutionLegacy } from './evolution-legacy.js'
import { createMapLegacy } from './map-legacy.js'
import { parseInWorldTime } from './time.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && existsSync(`${checkout}/map-evolution.js`)

describe.skipIf(!available)('Map Evolution against the pinned legacy build', () => {
    it('is the generated module, byte for byte, from a fresh slice of the checkout, with every library export carried', () => {
        const committed = readFileSync('src/tracker/evolution-legacy.js', 'utf8')
        expect(committed).toContain(sliceLegacy(checkout!))
        const ours = createEvolutionLegacy({ ...createMapLegacy(), parseInWorldTime, parseMapArchitectResponse: parseArchitectResponse, formatAgentChatLogFromIndex: () => '' }) as Record<string, unknown>
        for (const name of exportedNames(readFileSync(`${checkout}/map-evolution-lib.js`, 'utf8'))) expect(ours[name], name).toBeDefined()
    })

    it('carries the checkout\'s three prompts', async () => {
        const ours = createEvolutionLegacy({ ...createMapLegacy(), parseInWorldTime, parseMapArchitectResponse: parseArchitectResponse, formatAgentChatLogFromIndex: () => '' })
        const prompt = (await import(`${checkout}/map-evolution-prompt.js`)) as Record<string, string>
        expect(ours.DEFAULT_MAP_EVOLUTION_SYSTEM_PROMPT).toBe(prompt.DEFAULT_MAP_EVOLUTION_SYSTEM_PROMPT)
        const direct = (await import(`${checkout}/map-evolution-direct-prompt.js`)) as { DEFAULT_MAP_EVOLUTION_DIRECT_SYSTEM_PROMPT: string; selectMapEvolutionSystemPrompt: (i: string, n: string) => string }
        expect(ours.DEFAULT_MAP_EVOLUTION_DIRECT_SYSTEM_PROMPT).toBe(direct.DEFAULT_MAP_EVOLUTION_DIRECT_SYSTEM_PROMPT)
        for (const instruction of ['', ' ', 'Move the patrol']) expect(ours.selectMapEvolutionSystemPrompt(instruction, 'normal')).toBe(direct.selectMapEvolutionSystemPrompt(instruction, 'normal'))
        const compress = (await import(`${checkout}/map-evolution-compress-prompt.js`)) as Record<string, string>
        expect(ours.DEFAULT_MAP_EVOLUTION_COMPRESS_SYSTEM_PROMPT).toBe(compress.DEFAULT_MAP_EVOLUTION_COMPRESS_SYSTEM_PROMPT)
        // The contract and the compression prompt are lifted out of the pass's own function bodies, so hold them to the source text.
        const source = readFileSync(`${checkout}/map-evolution.js`, 'utf8')
        expect(source).toContain(ours.EVOLUTION_CONTRACT)
        expect(source).toContain('const userPrompt = `SITE: ${siteRoot}')
        expect(ours.compressionUserPrompt('Varnholde Crypts', 'open', 'closed', 12, 34)).toBe('SITE: Varnholde Crypts\n\nOPEN THREADS — keep these verbatim. Do not rewrite, omit, merge, or fold them into digests.\nopen\n\nCLOSED / RESOLVED / TRANSFORMED EVENTS AND PRIOR DIGESTS — this is the only compressible pool (12 estimated tokens; threshold 34):\nclosed\n\nReturn JSON only.')
    })
})
