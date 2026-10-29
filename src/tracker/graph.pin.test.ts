/**
 * The map on screen's legacy half, held to the pinned source two ways: the
 * generated module and the art must equal a fresh slice of the checkout byte
 * for byte, and the typed face must agree with the checkout's own graph and
 * icon modules -- imported as they are, since they import only the map
 * library -- over a corpus of documents, filters, locations and sizes.
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { artTable, sliceArt, sliceLegacy } from '../../scripts/extract-graph.mjs'
import { MAP_KIND_ART } from './graph-art.js'
import {
    assetIconMood,
    buildMapGraph,
    collectAreaIcons,
    layoutMapGraph,
    renderAssetTipHtml,
    renderMapEntriesHtml,
    renderMapGraphSvg,
    renderOverflowTipHtml,
} from './graph.js'
import { parseMapDocument, type MapDocument } from './map.js'
import { UNDERCROFT } from './map.test.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && existsSync(`${checkout}/dungeon-map-graph.js`)

describe.skipIf(!available)('the map on screen against the pinned legacy build', () => {
    it('is the generated module and the art, byte for byte, from a fresh slice of the checkout', () => {
        expect(readFileSync('src/tracker/graph-legacy.js', 'utf8')).toContain(sliceLegacy(checkout!))
        expect(readFileSync('src/tracker/graph-art.js', 'utf8')).toContain(sliceArt(checkout!))
        const table = artTable(readFileSync(`${checkout}/dungeon-map-icons.js`, 'utf8'))
        expect(table.map(([kind]) => kind)).toEqual(Object.keys(MAP_KIND_ART))
        for (const [kind, file] of table) expect((MAP_KIND_ART as Record<string, string>)[kind]).toBe(readFileSync(`${checkout}/${file}`, 'utf8').trim())
    })

    it('agrees with the checkout\'s own modules over documents, filters, locations and sizes', async () => {
        const graph = (await import(`${checkout}/dungeon-map-graph.js`)) as Record<string, (...args: unknown[]) => unknown>
        const icons = (await import(`${checkout}/dungeon-map-icons.js`)) as Record<string, (...args: unknown[]) => unknown>
        const crowded: MapDocument = {
            ...UNDERCROFT,
            areas: [
                { id: 'hall', name: 'Hall of "Mirrors" <east>', knowledge: 'VISITED', geometry: ['Mirrors.'], connections: [{ to: 'stair', state: 'OPEN', detail: '' }, { to: 'pit', state: 'BLOCKED', detail: 'Rubble' }] },
                { id: 'stair', name: 'Stair', knowledge: 'DISCOVERED', geometry: [], connections: [{ to: 'hall', state: 'OPEN', detail: '' }, { to: 'pit', state: 'OPEN', detail: '' }] },
                { id: 'pit', name: 'Pit', knowledge: 'UNREVEALED', geometry: ['Deep.'], connections: [] },
            ],
            assets: ([
                ...Array.from({ length: 7 }, (_, i) => ({ id: `rat-${i}`, kind: 'CREATURE', name: `Rat ${i}`, location: 'hall', state: i % 2 ? 'DEAD' : 'FLEEING', knowledge: i % 3 ? 'KNOWN' : 'SUSPECTED', detail: `Rat & co ${i}`, origin: 'INITIAL_MAP', count: i })),
                { id: 'inn', kind: 'BUILDING', name: 'The Gull', location: 'stair', state: 'ACTIVE', knowledge: 'KNOWN', detail: '', origin: 'INITIAL_MAP' },
                { id: 'keeper', kind: 'CREATURE', name: 'Innkeeper', location: 'inn', state: 'ACTIVE', knowledge: 'KNOWN', detail: '', origin: 'INITIAL_MAP' },
                { id: 'trap', kind: 'TRAP', name: 'Pit Trap', location: 'pit', state: 'ARMED', knowledge: 'UNREVEALED', detail: '', origin: 'INITIAL_MAP' },
                { id: 'gone', kind: 'LOOT', name: 'Chest', location: '', state: 'TAKEN', knowledge: 'KNOWN', detail: 'Taken away.', origin: 'MAP_UPDATER', last_location: 'hall', actor: 'Rat 1', cause: 'Dragged off.', changed_at: 'Day 3' },
            ] as unknown) as MapDocument['assets'],
        }
        const prose = parseMapDocument('Dungeon Site: Varnholde Crypts\n\nArea: Crypt Passage - East\n- 10-foot-wide corridor.\n- One ghoul crouches behind the arch.\n\nArea: Ossuary\n- Three boxes.', 'Varnholde Crypts').document
        const documents = [UNDERCROFT, crowded, prose, { ...UNDERCROFT, kind: 'SETTLEMENT', threat: 'NONE' } as MapDocument, { ...UNDERCROFT, areas: [], assets: [] } as MapDocument]
        for (const document of documents) {
            for (const playerFacing of [true, false]) {
                for (const currentLocation of ['', 'Abbey Undercroft, Cellar Landing', 'Abbey Undercroft, The Gull', 'Varnholde Crypts, Ossuary', 'Nowhere']) {
                    const ours = buildMapGraph(document, { playerFacing, currentLocation })
                    expect(ours).toEqual(graph.buildDungeonMapGraph!(document, { playerFacing, currentLocation }))
                    for (const compact of [true, false]) {
                        expect(layoutMapGraph(ours, { compact })).toEqual(graph.layoutDungeonMapGraph!(ours, { compact }))
                        expect(renderMapGraphSvg(ours, { compact, siteRoot: document.site })).toBe(graph.renderDungeonMapGraphSvg!(ours, { compact, siteRoot: document.site }))
                    }
                    expect(renderMapGraphSvg(ours)).toBe(graph.renderDungeonMapGraphSvg!(ours))
                }
                expect(renderMapEntriesHtml(document, { revealAll: !playerFacing })).toBe(graph.renderDungeonMapReadableHtml!(document, { revealAll: !playerFacing }))
                for (const area of document.areas) expect(collectAreaIcons(document.assets, area.id, { playerFacing })).toEqual(icons.collectAreaAssetIcons!(document.assets, area.id, { playerFacing }))
            }
        }
        for (const kind of ['CREATURE', 'GROUP', 'TRAP', 'ALARM', 'LOOT', 'OBJECT', 'OTHER', '']) {
            for (const state of ['ACTIVE', 'DEAD', 'DESTROYED', 'TAKEN', 'TRIGGERED', 'ARMED', 'IDLE', 'DEACTIVATED', 'LOCKED', 'EXPIRED', 'FLEEING', 'ALERT', 'DORMANT', '']) {
                expect(assetIconMood(kind, state)).toBe(icons.mapAssetIconMood!(kind, state))
            }
        }
        const cards = [{ name: 'Pack', kind: 'GROUP', state: 'ACTIVE', knowledge: 'KNOWN', detail: 'A knot.', count: '6' }, { name: '<b>', count: 1 }, {}, { name: 'X', detail: 'Y & Z', count: null }]
        for (const card of cards) expect(renderAssetTipHtml(card)).toBe(icons.renderDungeonGraphAssetTipHtml!(card))
        expect(renderOverflowTipHtml(cards as never)).toBe(icons.renderDungeonGraphOverflowTipHtml!(cards))
        expect(renderOverflowTipHtml([])).toBe(icons.renderDungeonGraphOverflowTipHtml!([]))
    })
})
