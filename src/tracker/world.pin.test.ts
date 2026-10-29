/**
 * World Progression's legacy half, held to the pinned source two ways: the
 * generated module must equal a fresh slice of the checkout byte for byte,
 * and the behaviours the legacy's own test suite asserts of the library must
 * hold of the typed face over it -- so a regeneration from a drifted upstream
 * is caught by behaviour as well as by text.
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { sliceLegacy } from '../../scripts/extract-world.mjs'
import { createWorldLegacy } from './world-legacy.js'
import { parseInWorldTime } from './time.js'
import {
    buildLocationDossiers,
    buildSkeletonLorebookContext,
    buildSkeletonSystemPrompt,
    buildSkeletonUserPrompt,
    buildWorldSourceUserPrompt,
    existingSkeletonPremises,
    extractWorldReportForLocation,
    formatInWorldTime,
    normalizeWorldReportMetadata,
    parseSkeletonOutput,
    selectLocations,
    WORLD_SOURCE_SYSTEM_PROMPT,
    stampLocationAdvancement,
    WORLD_REPORT_METADATA_KEY,
    type WorldBooks,
} from './world.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && existsSync(`${checkout}/world-progression-lib.js`)

/** The legacy test's own corpus, verbatim (`tests/world-progression-lib.test.js`). */
export const LEGACY_BOOKS: WorldBooks = {
    Campaign_LOC: {
        entries: {
            1: {
                comment: 'Morrowfen',
                key: ['morrowfen'],
                content: 'A tidal trade town governed by competing ward councils.\n[MAP]\n{"version":3,"site":"Morrowfen","assets":[{"id":"harbor-watch"}]}\n[/MAP]',
            },
            2: { comment: 'Morrowfen :: Docks', key: ['docks'], content: 'Warehouses and fish markets line the flood-prone quay.' },
            3: { comment: 'Glassmere', key: ['glassmere'], content: 'A lake settlement supported by reed farms.' },
        },
    },
    Campaign_NPC: {
        entries: {
            1: { comment: 'Captain Ilyra', key: ['ilyra'], content: 'Commands the Morrowfen harbor watch from the Docks.' },
            2: { comment: 'Remote Hermit', key: ['hermit'], content: 'Lives alone beyond the northern glaciers.' },
        },
    },
    Campaign_FAC: {
        entries: {
            1: { comment: 'Salt Compact', key: ['salt compact'], content: 'Controls Morrowfen shipping contracts.' },
            2: { comment: 'Sun Court', key: ['sun court'], content: 'A regional power contesting trade routes.' },
        },
    },
    Campaign_Skeleton: {
        entries: {
            1: { comment: 'Morrowfen', content: 'An obsolete Day 0 seed.', extensions: { rpgCategory: 'LOC' } },
            2: { comment: 'Old Barrow', content: 'An isolated burial hill.', extensions: { rpgCategory: 'LOC' } },
            3: { comment: 'Captain Ilyra', content: 'An obsolete NPC seed in Morrowfen.', extensions: { rpgCategory: 'NPC' } },
            4: { comment: 'Unrealized Envoy', content: 'A legacy named seed assigned to Morrowfen.', extensions: { rpgCategory: 'NPC' } },
        },
    },
    Campaign_World: { entries: { 1: { comment: 'Day 1', content: 'Historical report.' } } },
}

describe.skipIf(!available)('World Progression against the pinned legacy build', () => {
    it('is the generated module, byte for byte, from a fresh slice of the checkout', () => {
        const committed = readFileSync('src/tracker/world-legacy.js', 'utf8')
        expect(committed).toContain(sliceLegacy(checkout!))
    })

    it('assembles the skeleton prompts and parses its reply as the legacy\'s router does, over a corpus', async () => {
        // The router's own code is not a library: `runSkeletonGenerationPass`
        // reads settings and the host inline. So the legacy half is held two
        // ways -- the generated slices above, byte for byte, and the typed
        // face's assembly against a re-evaluation of the router's own prompt
        // statements, lifted from the checkout here rather than remembered.
        const router = readFileSync(`${checkout}/router.js`, 'utf8')
        const defaults = readFileSync(`${checkout}/src/state/defaults.js`, 'utf8')
        const grab = (source: string, from: string, to: string) => {
            const start = source.indexOf(from)
            expect(start, from).toBeGreaterThan(-1)
            const end = source.indexOf(to, start + from.length)
            expect(end, to).toBeGreaterThan(start)
            return source.slice(start, end)
        }
        const stock = new Function(`return ${grab(defaults, '`You are a World Architect.', '`,')}\``)() as string
        const contract = new Function(`let systemPrompt = ''; ${grab(router, 'systemPrompt += `\\n\\n## MACRO-ONLY SKELETON CONTRACT', '`;')}\`; return systemPrompt`)() as string
        const lorebookOnly = new Function(`let systemPrompt = ''; ${grab(router, 'systemPrompt += `\\n\\n## LOREBOOK-ONLY MODE', '`;')}\`; return systemPrompt`)() as string
        for (const [counts, only] of [[[4, 4, 3], false], [[1, 2, 3], true], [[0, 0, 0], false]] as const) {
            const expected = stock.replace(/\{factionCount\}/g, String(counts[0])).replace(/\{locationCount\}/g, String(counts[1])).replace(/\{conflictCount\}/g, String(counts[2])) + contract + (only ? lorebookOnly : '')
            expect(buildSkeletonSystemPrompt({ factions: counts[0], locations: counts[1], conflicts: counts[2], lorebookOnly: only })).toBe(expected)
        }

        // The legacy test corpus for the lorebook source context, run through the checkout's module and ours.
        const legacyLorebooks = await import(`${checkout}/src/features/world-progression/skeleton-lorebooks.js`) as { buildSkeletonLorebookSourceContext: (names: string[], load: (n: string) => Promise<unknown>, o?: { lorebookOnly?: boolean }) => Promise<string> }
        const books = {
            'Existing World': { entries: { 1: { comment: 'The Brass Court', content: 'A mercantile council controls the harbor.' }, 2: { key: ['Glassward'], content: 'A district built over volcanic glass.' } } },
            Campaign_Skeleton: { entries: { 0: { comment: 'Seed', content: 'Hidden.' } } },
            'Canon Book': { entries: { 0: { comment: 'Known Faction', content: 'Explicit source entity.' } } },
        }
        for (const only of [false, true]) {
            const theirs = await legacyLorebooks.buildSkeletonLorebookSourceContext(Object.keys(books), async (n) => (books as Record<string, unknown>)[n], { lorebookOnly: only })
            expect(await buildSkeletonLorebookContext(books, { lorebookOnly: only })).toBe(theirs)
        }

        // The parser, over the replies a model has been seen to write.
        const legacyParse = new Function(`${grab(router, 'function parseSkeletonOutput(rawText) {', '/**\n * Generates the World Skeleton')}; return parseSkeletonOutput`)() as (raw: string) => unknown
        const replies = [
            '## FACTIONS\n### The Salt Compact\nA guild.\nThey tax every quay.\n## LOCATIONS\n- **Morrowfen**: A tidal town.\n- **Glassmere** - A lake.\n## CONFLICTS\n### The Tithe War\nTwo guilds.\nParties involved: both.\n## NPCS\n### Ilyra\nNever.',
            '## Locations\n1. **Harbour** — quay\n2. Keep: a fort\n\n## Events\n**The Siege**: ongoing\n',
            '## FACTION\nHarbour: a quay.\nSize: small.\n## CONFLICT\n### A\n\n### B\nb',
            'Prose only.',
            '',
            '## LOCATIONS\n### "Quoted"\n"content"  with   gaps',
        ]
        for (const reply of replies) expect(parseSkeletonOutput(reply), reply).toEqual(legacyParse(reply))

        // The user prompt: the router's own statements, re-evaluated with its variables.
        const assemble = new Function('atmosphere', 'sourceLorebooksStr', 'existingEntitiesStr', 'append', `${grab(router, 'let userPrompt = `## SKELETON SOURCE', 'const routerSettings = {')} return userPrompt`) as (a: string, s: string, e: string, append: boolean) => string
        const existingLegacy = new Function('formattedEntries', `let existingEntitiesStr = ''; ${grab(router, 'existingEntitiesStr = `Avoid duplicating', '`;')}\`; return existingEntitiesStr`) as (f: string) => string
        const filed = [{ comment: 'FACTION: X', content: '[Day 0 Baseline]\nx', extensions: { rpgCategory: 'FAC' } }]
        const premises = existingSkeletonPremises(filed)
        expect(premises).toBe(existingLegacy('### FACTION: X\nx'))
        for (const [source, lore, existing, append] of [['A coast.', 'canon', premises, true], ['', '', '', false], ['x', 'canon', '', false]] as const) {
            expect(buildSkeletonUserPrompt({ source, lorebookContext: lore, existingPremises: existing, append })).toBe(assemble(source, lore, existing, append))
        }

        // The source written from the chat (33c): both prompts re-evaluated from the router.
        const sourceSystem = new Function(`return ${grab(router, '`You are a World Architect. Analyze the provided chat history', '`;')}\``)() as string
        expect(WORLD_SOURCE_SYSTEM_PROMPT).toBe(sourceSystem)
        const sourceUser = new Function('formattedChatHistory', `return ${grab(router, '`## RECENT CHAT HISTORY', '`;')}\``) as (h: string) => string
        for (const lines of [['User: a', 'GM: b'], [], ['GM: only']]) expect(buildWorldSourceUserPrompt(lines)).toBe(sourceUser(lines.join('\n\n')))
    })

    it('formats the clock as the legacy does, in all four styles, over a week of minutes', () => {
        const source = readFileSync(`${checkout}/memo-processor.js`, 'utf8')
        const start = source.indexOf('export function formatInWorldTime')
        const end = source.indexOf('\n}\n', start)
        expect(start).toBeGreaterThan(0)
        for (const settings of [{}, { use24hTime: true }, { useDdMmYyFormat: true }, { use24hTime: true, useDdMmYyFormat: true }]) {
            const legacy = eval(`(function () { const getSettings = () => (${JSON.stringify(settings)}); ${source.slice(start, end + 2).replace('export ', '')} return formatInWorldTime; })`)() as (m: number) => string
            for (let minutes = -1; minutes < 7 * 1440; minutes += 37) {
                expect(formatInWorldTime(minutes, settings), `${minutes} ${JSON.stringify(settings)}`).toBe(legacy(minutes))
            }
        }
    })
})

describe('the behaviours the legacy suite asserts, held of the typed face', () => {
    it('builds complete location dossiers while stripping maps and treating entities as constraints', () => {
        const result = buildLocationDossiers(LEGACY_BOOKS, { prefix: 'Campaign' })
        const morrowfen = result.dossiers.find((d) => d.name === 'Morrowfen')!
        expect(morrowfen.text).toContain('Morrowfen :: Docks')
        expect(morrowfen.text).toContain('Captain Ilyra')
        expect(morrowfen.text).toContain('READ-ONLY CONSTRAINTS')
        expect(morrowfen.text).not.toContain('[MAP]')
        expect(morrowfen.text).not.toContain('harbor-watch')
        expect(morrowfen.text).not.toContain('obsolete Day 0 seed')
        expect(morrowfen.text).not.toContain('obsolete NPC seed')
        expect(morrowfen.text).not.toContain('Unrealized Envoy')
        expect(morrowfen.hasNarrativeLore).toBe(true)
        expect(result.dossiers.some((d) => d.name === 'Old Barrow')).toBe(true)
        expect(result.globalContext).toContain('Sun Court')
        expect(result.globalContext).not.toContain('Remote Hermit')
    })

    it('rotates oldest-unadvanced locations first and only randomizes equal cohorts', () => {
        const dossiers = buildLocationDossiers(LEGACY_BOOKS, { prefix: 'Campaign' }).dossiers
        const selected = selectLocations(dossiers, {
            count: 2,
            lastAdvanced: { morrowfen: 'Day 3, 08:00', glassmere: 'Day 2, 08:00' },
            randomize: false,
        })
        expect(selected.map((d) => d.name)).toEqual(['Old Barrow', 'Glassmere'])
        expect(stampLocationAdvancement({}, ['Morrowfen', 'Old Barrow'], 'Day 4, 08:00')).toEqual({
            morrowfen: 'Day 4, 08:00',
            'old barrow': 'Day 4, 08:00',
        })
    })

    it('routes prose by location section plus wider currents, never by entity mentions', () => {
        const report = '## Morrowfen\nDock labor slows as food prices rise.\n\n## Glassmere\nReed harvests recover.\n\n## Wider Currents\nA colder trade wind.'
        const excerpt = extractWorldReportForLocation(report, 'Morrowfen', ['Morrowfen', 'Glassmere'])
        expect(excerpt).toContain('Dock labor slows')
        expect(excerpt).toContain('colder trade wind')
        expect(excerpt).not.toContain('Reed harvests recover')
        expect(extractWorldReportForLocation('Captain Ilyra travels north.', 'Morrowfen', [])).toBe('')
    })

    it('reads routing metadata, or derives the id when there is none', () => {
        const entry = {
            comment: 'Day 4, 08:00',
            extensions: { [WORLD_REPORT_METADATA_KEY]: { reportId: 'Campaign_World::12', periodLabel: 'Day 4, 08:00', selectedLocations: ['Morrowfen'] } },
        }
        expect(normalizeWorldReportMetadata(entry, 'Campaign_World', '12')).toEqual({
            reportId: 'Campaign_World::12',
            periodLabel: 'Day 4, 08:00',
            selectedLocations: ['Morrowfen'],
        })
        expect(normalizeWorldReportMetadata({ comment: 'Day 1' }, 'Campaign_World', '1')).toEqual({
            reportId: 'Campaign_World::1',
            periodLabel: 'Day 1',
            selectedLocations: [],
        })
    })

    it('reads the rotation watermarks through our own clock parser', () => {
        // The generated module is handed `parseInWorldTime` from `time.ts`;
        // a label it cannot read sorts as never-advanced.
        const legacy = createWorldLegacy({ parseInWorldTime: (s: string) => parseInWorldTime(s), getSettings: () => ({}) })
        const dossiers = buildLocationDossiers(LEGACY_BOOKS, { prefix: 'Campaign' }).dossiers
        const ours = selectLocations(dossiers, { count: 3, lastAdvanced: { morrowfen: 'nonsense', glassmere: 'Day 2, 08:00' }, randomize: false })
        const theirs = legacy.selectWorldProgressionLocations(dossiers, { count: 3, lastAdvanced: { morrowfen: 'nonsense', glassmere: 'Day 2, 08:00' }, randomize: false })
        expect(ours.map((d) => d.name)).toEqual(theirs.map((d: { name: string }) => d.name))
        expect(ours.map((d) => d.name)).toEqual(['Morrowfen', 'Old Barrow', 'Glassmere'])
    })
})
