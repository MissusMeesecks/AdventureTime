/**
 * The hidden map's legacy half, held to the pinned source two ways: the
 * generated module must equal a fresh slice of the checkout byte for byte,
 * and the typed face must agree with the checkout's own module -- imported
 * as it is, since it imports nothing -- over a corpus of documents, books,
 * footers and texts. A regeneration from a drifted upstream is caught by
 * behaviour as well as by text.
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { exportedNames, sliceLegacy } from '../../scripts/extract-map.mjs'
import { createMapLegacy } from './map-legacy.js'
import {
    buildMapCanonInjection,
    buildMappedSitesInjection,
    buildMapSites,
    extractFooterLocation,
    extractMapSection,
    formatMapForNarrator,
    formatMapForPlayer,
    listMapSiteSummaries,
    parseMapDocument,
    resolveActiveMapSite,
    resolveMentionedMapSites,
    serializeMapDocument,
    stripMapSection,
    type MapLoreEntry,
} from './map.js'
import { LOCATION_BOOK, UNDERCROFT } from './map.test.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && existsSync(`${checkout}/dungeon-reality.js`)

type Legacy = ReturnType<typeof createMapLegacy>

describe.skipIf(!available)('the hidden map against the pinned legacy build', () => {
    it('is the generated module, byte for byte, from a fresh slice of the checkout, with every export', () => {
        const committed = readFileSync('src/tracker/map-legacy.js', 'utf8')
        expect(committed).toContain(sliceLegacy(checkout!))
        const names = exportedNames(readFileSync(`${checkout}/dungeon-reality.js`, 'utf8'))
        expect(names.length).toBeGreaterThanOrEqual(80)
        const made = createMapLegacy() as Record<string, unknown>
        for (const name of names) expect(made[name], name).toBeDefined()
    })

    it('agrees with the checkout\'s own module over documents, books, footers and texts', async () => {
        const theirs = (await import(`${checkout}/dungeon-reality.js`)) as Legacy
        const prose = 'Dungeon Site: Varnholde Crypts\n\nArea: Crypt Passage - East\n- 10-foot-wide corridor with a collapsed arch.\n- One ghoul crouches behind the collapsed arch.\n- North wall: rotten tapestry conceals Ossuary Behind Rotten Tapestry.\n\nArea: Ossuary Behind Rotten Tapestry\n- Three ossuary boxes rest on a stone shelf.'
        const documents = [serializeMapDocument(UNDERCROFT), JSON.stringify({ ...UNDERCROFT, kind: 'SETTLEMENT', threat: 'NONE' }), JSON.stringify({ ...UNDERCROFT, kind: 'INTERIOR', hostSite: 'Morrowfen', hostBrief: 'The abbey on the hill.' }), prose, '', 'not json, not a map']
        for (const body of documents) {
            const ours = parseMapDocument(body, 'Fallback')
            const legacy = theirs.parseDungeonMapDocument(body, 'Fallback')
            expect(ours.document).toEqual(legacy.document)
            expect(serializeMapDocument(ours.document)).toBe(theirs.serializeDungeonMapDocument(legacy.document))
            expect(formatMapForNarrator(body, 'Fallback')).toBe(theirs.formatDungeonMapForNarrator(body, 'Fallback'))
            for (const where of ['', 'Abbey Undercroft, Cellar Landing', 'Varnholde Crypts, Ossuary Behind Rotten Tapestry']) {
                expect(formatMapForPlayer(body, where)).toBe(theirs.formatDungeonMapForPlayer(body, where))
            }
        }
        const books: Array<Record<string, MapLoreEntry>> = [LOCATION_BOOK, {}, { 1: { comment: 'Plain', content: 'no map' } }, { 1: { comment: '', content: `[MAP]\n${prose}\n[/MAP]` } }]
        for (const book of books) {
            const ours = buildMapSites(book, 'Vell_LOC')
            expect(ours).toEqual(theirs.buildDungeonSitesFromLocationEntries(book, 'Vell_LOC'))
            expect(listMapSiteSummaries(ours)).toEqual(theirs.listMappedSiteSummaries(ours))
            expect(buildMappedSitesInjection(ours)).toBe(theirs.buildMappedSitesInjection(ours))
            const state = { version: 3, sites: ours }
            for (const where of ['', 'Abbey Undercroft', 'Abbey Undercroft, Cellar Landing', 'Abbey Undercroft :: Secret Vault :: Niche', 'Morrowfen, The Docks', 'Glassmere', 'the abbey undercroft']) {
                const active = resolveActiveMapSite(ours, where)
                expect(active).toEqual(theirs.resolveActiveDungeonSite(state, where))
                if (active) {
                    for (const referencedByName of [false, true]) {
                        expect(buildMapCanonInjection(active, where, { referencedByName, activityText: 'A patrol passed.' })).toBe(theirs.buildDungeonRealityInjection(active, where, { referencedByName, activityText: 'A patrol passed.' }))
                    }
                }
            }
            for (const text of ['We go to Morrowfen.', 'Back to the Abbey Undercroft, quickly.', '', 'nothing']) {
                expect(resolveMentionedMapSites(ours, text)).toEqual(theirs.resolveMentionedDungeonSites(state, text))
            }
            for (const entry of Object.values(book)) {
                expect(extractMapSection(entry.content)).toBe(theirs.extractDungeonMapSection(entry.content))
                expect(stripMapSection(entry.content)).toBe(theirs.stripDungeonMapSection(entry.content))
            }
        }
        for (const text of ['*(Status: 10/10) | (Location: Crypt of Whispers, Hall of Echoes)*', '(Location: A) text (Location: B, C)', 'none', '']) {
            expect(extractFooterLocation(text)).toBe(theirs.extractFooterLocation(text))
        }
    })
})
