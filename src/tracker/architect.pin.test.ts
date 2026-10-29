/**
 * The Map Architect's legacy half, held to the pinned source: the generated
 * module must equal a fresh slice of the checkout byte for byte, and the three
 * modules the checkout can lend as they are -- the prompts, the parser, the
 * schemas -- must agree with ours over a corpus.
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { sliceLegacy } from '../../scripts/extract-architect.mjs'
import { createArchitectLegacy } from './architect-legacy.js'
import { createMapLegacy } from './map-legacy.js'
import {
    createAreaMapToolRegistration,
    DEFAULT_MAP_ARCHITECT_SYSTEM_PROMPT,
    DEFAULT_MAP_ARCHITECT_TOPOLOGY_SYSTEM_PROMPT,
    parseArchitectResponse,
} from './architect.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && existsSync(`${checkout}/map-architect.js`)

describe.skipIf(!available)('the Map Architect against the pinned legacy build', () => {
    it('is the generated module, byte for byte, from a fresh slice of the checkout', () => {
        const committed = readFileSync('src/tracker/architect-legacy.js', 'utf8')
        expect(committed).toContain(sliceLegacy(checkout!))
    })

    it('carries the checkout\'s prompts, schemas, parser and tool schema', async () => {
        const prompts = (await import(`${checkout}/map-architect-prompt.js`)) as Record<string, string>
        expect(DEFAULT_MAP_ARCHITECT_TOPOLOGY_SYSTEM_PROMPT).toBe(prompts.DEFAULT_MAP_ARCHITECT_TOPOLOGY_SYSTEM_PROMPT)
        expect(DEFAULT_MAP_ARCHITECT_SYSTEM_PROMPT).toBe(prompts.DEFAULT_MAP_ARCHITECT_SYSTEM_PROMPT)
        const ours = createArchitectLegacy(createMapLegacy())
        expect(ours.DEFAULT_MAP_ARCHITECT_BRIEF_SYSTEM_PROMPT).toBe(prompts.DEFAULT_MAP_ARCHITECT_BRIEF_SYSTEM_PROMPT)
        const schemas = (await import(`${checkout}/map-architect-schema.js`)) as Record<string, unknown>
        for (const name of ['MAP_ARCHITECT_TOPOLOGY_JSON_SCHEMA', 'MAP_ARCHITECT_ASSETS_JSON_SCHEMA', 'MAP_ARCHITECT_JSON_SCHEMA', 'MAP_ARCHITECT_BRIEF_JSON_SCHEMA']) {
            expect((ours as Record<string, unknown>)[name], name).toEqual(schemas[name])
        }
        const parser = (await import(`${checkout}/map-architect-parser.js`)) as { parseMapArchitectResponse: (s: string) => unknown }
        for (const reply of ['{"a":1}', '```json\n{"version":3,"site":"Crypt","areas":[],"assets":[]}\n```', 'Here: {"x":{"y":"}"}} trailing', '{"version":3,"areas":[', 'no json', '', '```\n{"a":[1,2]}\n```']) {
            expect(parseArchitectResponse(reply), reply).toEqual(parser.parseMapArchitectResponse(reply))
        }
        // The tool's schema is the one `narrative-hooks.js` registers, read from the source.
        const hooks = readFileSync(`${checkout}/narrative-hooks.js`, 'utf8')
        const tool = createAreaMapToolRegistration()
        expect(hooks).toContain(`description: '${(tool.description as string).replace(/'/g, "\\'")}'`)
        expect(hooks).toContain("required: ['site', 'entrance', 'kind', 'scale', 'threat', 'prompt', 'brief_description'],")
    })
})
