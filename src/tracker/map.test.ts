import { describe, expect, it } from 'vitest'

import {
    buildMapCanonInjection,
    buildMappedSitesInjection,
    buildMapSites,
    extractFooterLocation,
    extractMapSection,
    formatMapForNarrator,
    formatMapForPlayer,
    listMapSiteSummaries,
    locationContainsSiteRoot,
    looksLikeDungeonSite,
    MAP_CANON_HEADING,
    MAP_SITE_KINDS,
    MAPPED_SITES_HEADING,
    mergeMapSites,
    normalizeMapLabel,
    parseMapDocument,
    replaceMapSection,
    resolveActiveMapSite,
    resolveMentionedMapSites,
    serializeMapDocument,
    siteRootOfLocation,
    stripMapSection,
    type MapDocument,
} from './map.js'

/** The legacy test suite's own fixture: a two-room crypt with one lurking ghoul. */
export const UNDERCROFT: MapDocument = {
    version: 3,
    site: 'Abbey Undercroft',
    kind: 'DUNGEON',
    threat: 'DEADLY',
    areas: [
        { id: 'landing', name: 'Cellar Landing', knowledge: 'VISITED', geometry: ['Low oak beams cross the ceiling.'], connections: [{ to: 'crypt', state: 'OPEN', detail: 'Iron-banded door' }, { to: 'vault', state: 'LOCKED', detail: 'Sealed glyph door' }] },
        { id: 'crypt', name: 'Crypt Passage', knowledge: 'DISCOVERED', geometry: ['A collapsed arch provides cover.'], connections: [{ to: 'landing', state: 'OPEN', detail: 'Iron-banded door' }] },
        { id: 'vault', name: 'Secret Vault', knowledge: 'UNREVEALED', geometry: ['Gold-lined shelves.'], connections: [{ to: 'landing', state: 'LOCKED', detail: 'Sealed glyph door' }] },
    ],
    assets: [
        { id: 'lantern', kind: 'OBJECT', name: 'Sooty Lantern', location: 'landing', state: 'ACTIVE', knowledge: 'KNOWN', detail: 'Hangs by the door.', origin: 'INITIAL_MAP' },
        { id: 'ghoul', kind: 'CREATURE', name: 'Crypt Ghoul', location: 'crypt', state: 'DESTROYED', knowledge: 'KNOWN', detail: 'Smoldering remains.', origin: 'INITIAL_MAP' },
        { id: 'pack', kind: 'GROUP', name: 'Crawling Dead Pack', location: 'crypt', state: 'ACTIVE', knowledge: 'UNREVEALED', detail: 'A knot of lesser corpses.', origin: 'INITIAL_MAP', count: 6 },
    ],
}

/** A Location book as the agent files it: the site's root entry carries the map; its rooms sit under it; a town has a map of its own. */
export const LOCATION_BOOK = {
    1: { comment: 'Abbey Undercroft', content: `[CORE]\nA crypt beneath the abbey.\n[/CORE]\n\n[MAP]\n${serializeMapDocument(UNDERCROFT)}\n[/MAP]` },
    2: { comment: 'Abbey Undercroft :: Cellar Landing', content: 'The party rested here on Day 2.' },
    3: { comment: 'Morrowfen', content: `A tidal town.\n[MAP]\n${JSON.stringify({ version: 3, site: 'Morrowfen', kind: 'SETTLEMENT', threat: 'LOW', areas: [{ id: 'docks', name: 'The Docks', knowledge: 'VISITED', geometry: ['Fish markets line the quay.'], connections: [] }], assets: [] })}\n[/MAP]` },
    4: { comment: 'Glassmere', content: 'A lake settlement with no map.' },
}

describe('the map document', () => {
    it('parses JSON or the legacy prose, serialises the normalised shape, and keeps a document round-tripping', () => {
        const { document, migrated } = parseMapDocument(serializeMapDocument(UNDERCROFT), 'Abbey Undercroft')
        expect(migrated).toBe(false)
        expect(document.site).toBe('Abbey Undercroft')
        expect(document.areas.map((a) => a.id)).toEqual(['landing', 'crypt', 'vault'])
        expect(document.assets.find((a) => a.id === 'pack')?.count).toBe(6)
        expect(parseMapDocument(serializeMapDocument(document)).document).toEqual(document)
        const prose = parseMapDocument('Dungeon Site: Varnholde Crypts\n\nArea: Main Chamber\n- A desecrated altar.\n- One ghoul crouches behind the altar.', 'Varnholde Crypts').document
        expect(prose.version).toBe(3)
        expect(parseMapDocument('Dungeon Site: X\nArea: Y\n- z', 'X').migrated).toBe(true)
        expect(prose.areas[0]).toMatchObject({ id: 'main-chamber', name: 'Main Chamber' })
        expect(prose.areas[0]!.geometry).toContain('A desecrated altar.')
        expect(prose.assets.some((a) => a.kind === 'CREATURE')).toBe(true)
        expect(parseMapDocument('', 'Nowhere').document.areas).toHaveLength(1)
        expect(MAP_SITE_KINDS).toEqual(['DUNGEON', 'SETTLEMENT', 'INTERIOR'])
    })

    it('reads, strips and replaces the [MAP] section of an entry', () => {
        const content = LOCATION_BOOK[1].content
        expect(extractMapSection(content)).toBe(serializeMapDocument(UNDERCROFT))
        expect(stripMapSection(content)).toBe('[CORE]\nA crypt beneath the abbey.\n[/CORE]')
        expect(extractMapSection('no map here')).toBe('')
        expect(stripMapSection('no map here')).toBe('no map here')
        const swapped = replaceMapSection(content, '{"version":3,"site":"X"}')
        expect(extractMapSection(swapped)).toBe('{"version":3,"site":"X"}')
        expect(stripMapSection(swapped)).toBe('[CORE]\nA crypt beneath the abbey.\n[/CORE]')
        expect(extractMapSection(replaceMapSection('Prose only.', '{"a":1}'))).toBe('{"a":1}')
    })

    it('shows the narrator routes, areas and assets with their states, and the player only what the party found', () => {
        const narrator = formatMapForNarrator(UNDERCROFT)
        expect(narrator.startsWith('Dungeon Site: Abbey Undercroft')).toBe(true)
        expect(narrator).toContain('Map kind: DUNGEON (room-scale).')
        expect(narrator).toContain('Site threat: DEADLY.')
        expect(narrator).toContain('Cellar Landing <-> Crypt Passage [OPEN] — Iron-banded door')
        expect(narrator).toContain('Area: Secret Vault [UNREVEALED]')
        expect(narrator).toContain('Crawling Dead Pack ×6 [GROUP / ACTIVE / UNREVEALED]')
        expect(narrator).not.toContain('"version"')
        const player = formatMapForPlayer(UNDERCROFT, 'Abbey Undercroft, Cellar Landing')
        expect(player).toContain('You are here: Cellar Landing')
        expect(player).toContain('Sooty Lantern')
        expect(player).toContain('Area: Crypt Passage [DISCOVERED]')
        expect(player).not.toContain('Secret Vault')
        expect(player).not.toContain('Crawling Dead Pack')
        expect(player).not.toContain('DEADLY')
    })
})

describe('where the party is', () => {
    it('reads the last Location footer, its site root, and whether a place lies inside a site', () => {
        const reply = 'The stair exhales cold air.\n\n*(Status: 10/10) | (XP: 0/300) | (Location: Abbey Undercroft, Cellar Landing)*'
        expect(extractFooterLocation(reply)).toBe('Abbey Undercroft, Cellar Landing')
        expect(extractFooterLocation('*(Location: Morrowfen)* then *(Location: Glassmere, Reed Farms)*')).toBe('Glassmere, Reed Farms')
        expect(extractFooterLocation('no footer')).toBe('')
        expect(siteRootOfLocation('Abbey Undercroft, Cellar Landing')).toBe('Abbey Undercroft')
        expect(siteRootOfLocation('Abbey Undercroft :: Cellar Landing')).toBe('Abbey Undercroft')
        expect(locationContainsSiteRoot('Morrowfen, The Docks, The Salt Shed', 'Morrowfen')).toBe(true)
        expect(locationContainsSiteRoot('Glassmere, Reed Farms', 'Morrowfen')).toBe(false)
        expect(normalizeMapLabel('The Abbey Undercroft!')).toBe(normalizeMapLabel('abbey undercroft'))
        expect(looksLikeDungeonSite('Varnholde Crypts, Main Chamber')).toBe(true)
        expect(looksLikeDungeonSite('Morrowfen, The Docks')).toBe(false)
    })

    it('builds the sites a Location book maps, merges books, and finds the one the party is in by the deepest match', () => {
        const sites = buildMapSites(LOCATION_BOOK, 'Vell_LOC')
        expect(Object.keys(sites).sort()).toEqual(['abbey undercroft', 'morrowfen'])
        expect(sites['abbey undercroft']).toMatchObject({ siteRoot: 'Abbey Undercroft', entryId: 'Vell_LOC::1' })
        expect(sites['abbey undercroft']!.locationEntries.map((e) => e.label)).toEqual(['Abbey Undercroft', 'Abbey Undercroft :: Cellar Landing'])
        // The root entry's own prose is listed without its map.
        expect(sites['abbey undercroft']!.locationEntries[0]!.content).not.toContain('[MAP]')
        const merged = mergeMapSites(sites, buildMapSites({ 9: { comment: 'Old Barrow', content: '[MAP]\n{"version":3,"site":"Old Barrow","areas":[],"assets":[]}\n[/MAP]' } }, 'Vell_Places'))
        expect(Object.keys(merged)).toHaveLength(3)
        expect(resolveActiveMapSite(merged, 'Abbey Undercroft, Cellar Landing')?.siteRoot).toBe('Abbey Undercroft')
        expect(resolveActiveMapSite(merged, 'Morrowfen, The Docks')?.siteRoot).toBe('Morrowfen')
        expect(resolveActiveMapSite(merged, 'Glassmere, Reed Farms')).toBeNull()
        expect(resolveActiveMapSite(merged, '')).toBeNull()
        expect(resolveMentionedMapSites(merged, 'We should go back to Morrowfen and the Old Barrow.').map((s) => s.siteRoot).sort()).toEqual(['Morrowfen', 'Old Barrow'])
        expect(resolveMentionedMapSites(merged, 'Nothing named here.')).toEqual([])
        expect(listMapSiteSummaries(merged)).toEqual([
            { siteRoot: 'Abbey Undercroft', kind: 'DUNGEON', cells: ['Cellar Landing', 'Crypt Passage', 'Secret Vault'] },
            { siteRoot: 'Morrowfen', kind: 'SETTLEMENT', cells: ['The Docks'] },
            { siteRoot: 'Old Barrow', kind: 'DUNGEON', cells: ['Site Overview'] },
        ])
    })
})

describe('what the narrator is told', () => {
    it('indexes every mapped site, or says none exist and the architect may make one', () => {
        const none = buildMappedSitesInjection({})
        expect(none.startsWith(MAPPED_SITES_HEADING)).toBe(true)
        expect(none).toContain('No private maps exist yet.')
        expect(none).toContain('- None.')
        const some = buildMappedSitesInjection(buildMapSites(LOCATION_BOOK, 'Vell_LOC'))
        expect(some).toContain('Every site below already has a private map. Do not recreate one.')
        expect(some).toContain('- Abbey Undercroft (DUNGEON)')
        expect(some).toContain('attachTo.cell choices: Cellar Landing | Crypt Passage | Secret Vault')
        expect(some).toContain('- Morrowfen (SETTLEMENT)')
        expect(some.trimEnd().endsWith('[/MAPPED_SITES]')).toBe(true)
    })

    it('hands over the active site as GM canon, with the footer and the room-scale rules, and nothing for a site with no map', () => {
        const sites = buildMapSites(LOCATION_BOOK, 'Vell_LOC')
        const canon = buildMapCanonInjection(sites['abbey undercroft']!, 'Abbey Undercroft, Cellar Landing')
        expect(canon.startsWith(`${MAP_CANON_HEADING}\nSite: Abbey Undercroft`)).toBe(true)
        expect(canon).toContain('Current footer location: Abbey Undercroft, Cellar Landing')
        expect(canon).toContain('### Current objective map\nDungeon Site: Abbey Undercroft')
        expect(canon).toContain('Crawling Dead Pack ×6')
        expect(canon).toContain('### Abbey Undercroft :: Cellar Landing\nThe party rested here on Day 2.')
        expect(canon).toContain('room-scale dungeon canon')
        expect(canon).toContain('Site threat is DEADLY')
        const mentioned = buildMapCanonInjection(sites['morrowfen']!, 'Glassmere', { referencedByName: true })
        expect(mentioned).toContain('Activation: exact mapped-location name in the current player input; the party may still be elsewhere.')
        expect(mentioned).toContain('district-scale settlement canon')
        expect(buildMapCanonInjection({ siteRoot: 'X', entryId: 'B::1', mapChunks: [], locationEntries: [], statusLog: [] }, 'X')).toBe('')
    })
})
