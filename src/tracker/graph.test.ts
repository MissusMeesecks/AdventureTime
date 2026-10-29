import { describe, expect, it } from 'vitest'

import { appendBacklogEntry } from './evolution.js'
import { MAP_KIND_NAMES, mapKindArtCss } from './graph-css.js'
import {
    assetIconMood,
    buildMapGraph,
    collectAreaIcons,
    EVOLUTION_HISTORY_ENTRIES,
    graphHasRooms,
    layoutMapGraph,
    renderAssetTipHtml,
    renderEvolutionHistoryHtml,
    renderMapEntriesHtml,
    renderMapGraphSvg,
    renderOverflowTipHtml,
    siteDocument,
} from './graph.js'
import { buildMapSites, type MapDocument } from './map.js'
import { LOCATION_BOOK, UNDERCROFT } from './map.test.js'

const HERE = 'Abbey Undercroft, Cellar Landing'

describe('the graph under the knowledge filter', () => {
    it('draws the visited and discovered rooms, an unrevealed one beside them as fog, the known things in them, and marks the party', () => {
        const graph = buildMapGraph(UNDERCROFT, { currentLocation: HERE })
        expect(graph.site).toBe('Abbey Undercroft')
        expect(graph.currentAreaId).toBe('landing')
        expect(graph.nodes.map((n) => [n.id, n.fog, n.revealed, n.current, n.entrance, n.icons.map((i) => i.token)])).toEqual([
            ['landing', false, true, true, true, ['OBJECT_LIVE']],
            ['crypt', false, true, false, false, ['CREATURE_DESTROYED']],
            ['vault', true, false, false, false, []],
        ])
        expect(graph.edges).toEqual([
            { from: 'landing', to: 'crypt', state: 'OPEN', detail: 'Iron-banded door' },
            { from: 'landing', to: 'vault', state: 'LOCKED', detail: 'Sealed glyph door' },
        ])
        // The unrevealed pack in the crypt is not drawn for the player; it is under Reveal all.
        expect(graph.nodes[1]!.icons.map((i) => i.name)).toEqual(['Crypt Ghoul'])
        const all = buildMapGraph(UNDERCROFT, { playerFacing: false, currentLocation: HERE })
        expect(all.nodes.map((n) => [n.id, n.fog, n.revealed])).toEqual([['landing', false, true], ['crypt', false, true], ['vault', false, true]])
        expect(all.nodes[1]!.icons.map((i) => i.token)).toEqual(['CREATURE_DESTROYED', 'GROUP_LIVE'])
        expect(all.nodes[1]!.icons[1]).toMatchObject({ name: 'Crawling Dead Pack', count: 6, knowledge: 'UNREVEALED' })
        expect(graphHasRooms(graph)).toBe(true)
    })

    it('shows an unentered site as the normaliser leaves it, the rooms behind a locked door as fog, and draws nothing of an empty one', () => {
        // The document library discovers the entrance and what an open route reaches from it; the vault behind the glyph door stays unrevealed.
        const dark: MapDocument = { ...UNDERCROFT, areas: UNDERCROFT.areas.map((a) => ({ ...a, knowledge: 'UNREVEALED' })) }
        const graph = buildMapGraph(dark, { currentLocation: '' })
        expect(graph.nodes.map((n) => [n.id, n.knowledge, n.fog, n.current])).toEqual([['landing', 'DISCOVERED', false, false], ['crypt', 'DISCOVERED', false, false], ['vault', 'UNREVEALED', true, false]])
        expect(graph.currentAreaId).toBe('')
        const empty = buildMapGraph({ ...UNDERCROFT, areas: [], assets: [] })
        expect(empty.nodes).toEqual([])
        expect(graphHasRooms(empty)).toBe(false)
        expect(renderMapGraphSvg(empty)).toBe('<div class="rt-dungeon-graph-empty">No revealed rooms yet.</div>')
        expect(buildMapGraph(dark, { playerFacing: false }).nodes.every((n) => n.revealed && !n.fog)).toBe(true)
    })

    it('names the building the party is inside, and resolves a thing inside a building to the building\'s room', () => {
        const town: MapDocument = {
            version: 3, site: 'Morrowfen', kind: 'SETTLEMENT', threat: 'LOW',
            areas: [{ id: 'square', name: 'Market Square', knowledge: 'VISITED', geometry: [], connections: [] }],
            assets: [
                { id: 'inn', kind: 'BUILDING', name: 'The Gull', location: 'square', state: 'ACTIVE', knowledge: 'KNOWN', detail: '', origin: 'INITIAL_MAP' },
                { id: 'keeper', kind: 'CREATURE', name: 'Innkeeper', location: 'inn', state: 'ACTIVE', knowledge: 'KNOWN', detail: '', origin: 'INITIAL_MAP' },
            ],
        }
        const graph = buildMapGraph(town, { currentLocation: 'Morrowfen, The Gull' })
        expect(graph.currentAreaId).toBe('square')
        expect(graph.currentInteriorName).toBe('The Gull')
        expect(graph.nodes[0]!.icons.map((i) => i.name)).toEqual(['Innkeeper', 'The Gull'])
        expect(renderMapGraphSvg(graph)).toContain('aria-label="Market Square (in The Gull)"')
    })

    it('lays the rooms out left to right from the entrance, fog after rooms in a layer, and clips the routes to the borders', () => {
        const layout = layoutMapGraph(buildMapGraph(UNDERCROFT, { currentLocation: HERE }))
        expect(layout.compact).toBe(true)
        expect(layout.nodes.map((n) => [n.id, n.x, n.y, n.width])).toEqual([['landing', 14, 14, 140], ['crypt', 210, 14, 140], ['vault', 271, 63.9, 18]])
        expect(layout.width).toBe(364)
        expect(layout.edges[0]).toMatchObject({ from: 'landing', to: 'crypt', x1: 156.5, x2: 207.5 })
        const wide = layoutMapGraph(buildMapGraph(UNDERCROFT, { currentLocation: HERE }), { compact: false })
        expect(wide.compact).toBe(false)
        expect(wide.nodes[0]!.width).toBe(192)
        expect(wide.width).toBeGreaterThan(layout.width)
    })

    it('renders the SVG in the legacy\'s classes: edges by state with titles, rooms by knowledge, the party\'s room, fog stubs, glyphs with their data', () => {
        const svg = renderMapGraphSvg(buildMapGraph(UNDERCROFT, { currentLocation: HERE }), { siteRoot: 'Abbey Undercroft' })
        expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" class="rt-dungeon-graph-svg" viewBox="0 0 364 95.9"')).toBe(true)
        expect(svg).toContain('aria-label="Abbey Undercroft"')
        expect(svg).toContain('<line class="rt-dungeon-graph-edge rt-dungeon-graph-edge-open"')
        expect(svg).toContain('<line class="rt-dungeon-graph-edge rt-dungeon-graph-edge-locked"')
        expect(svg).toContain('<title>LOCKED — Sealed glyph door</title>')
        expect(svg).toContain('class="rt-dungeon-graph-node rt-dungeon-graph-node-visited rt-dungeon-graph-node-current rt-dungeon-graph-node-revealed" data-area-id="landing" data-area-path="Abbey Undercroft :: Cellar Landing" role="button" tabindex="0" aria-label="Cellar Landing (you are here)"')
        expect(svg).toContain('class="rt-dungeon-graph-node rt-dungeon-graph-node-discovered rt-dungeon-graph-node-revealed" data-area-id="crypt"')
        expect(svg).toContain('<g class="rt-dungeon-graph-node rt-dungeon-graph-node-fog" data-fog="1" aria-hidden="true"><circle')
        expect(svg).toContain('>?</text>')
        expect(svg).toContain('data-icon="CREATURE_DESTROYED" data-asset-name="Crypt Ghoul" data-asset-kind="CREATURE" data-asset-state="DESTROYED" data-asset-knowledge="KNOWN" data-asset-detail="Smoldering remains."')
        // The dead are crossed out; the live lantern carries no overlay.
        expect(svg.split('M2.3 2.3 L9.7 9.7').length - 1).toBe(2)
        expect(svg).not.toContain('Secret Vault')
    })

    it('escapes what the map names, and badges the sixth glyph and beyond as +N with the hidden ones serialised', () => {
        const crowded: MapDocument = {
            ...UNDERCROFT,
            areas: [{ id: 'hall', name: 'Hall of "Mirrors" <east>', knowledge: 'VISITED', geometry: [], connections: [] }],
            assets: Array.from({ length: 7 }, (_, i) => ({ id: `rat-${i}`, kind: 'CREATURE', name: `Rat ${i}`, location: 'hall', state: 'ACTIVE', knowledge: 'KNOWN', detail: `Rat & co ${i}`, origin: 'INITIAL_MAP' })),
        }
        const svg = renderMapGraphSvg(buildMapGraph(crowded))
        expect(svg).toContain('>Hall of &quot;Mirror…</text>')
        expect(svg).not.toContain('<east>')
        expect(svg).toContain('>+2</text>')
        expect(svg).toContain('data-overflow-assets="[{&quot;name&quot;:&quot;Rat 5&quot;')
        expect(svg).toContain('data-asset-detail="Rat &amp; co 0"')
    })

    it('reads the mood of a kind and state, and collects a room\'s glyphs in kind order', () => {
        expect(['CREATURE/DEAD', 'TRAP/TRIGGERED', 'TRAP/ACTIVE', 'TRAP/DEACTIVATED', 'GROUP/FLEEING', 'LOOT/TAKEN', 'OBJECT/CLOSED', 'ALARM/IDLE', 'EFFECT/EXPIRED', 'CREATURE/ACTIVE'].map((p) => { const [k, s] = p.split('/'); return assetIconMood(k!, s!) }))
            .toEqual(['DEAD', 'TRIGGERED', 'ARMED', 'DEACTIVATED', 'STRESSED', 'DESTROYED', 'DEACTIVATED', 'ARMED', 'SPENT', 'LIVE'])
        const icons = collectAreaIcons(UNDERCROFT.assets, 'crypt', { playerFacing: false })
        expect(icons.map((i) => i.kind)).toEqual(['CREATURE', 'GROUP'])
        expect(collectAreaIcons(UNDERCROFT.assets, 'crypt').map((i) => i.kind)).toEqual(['CREATURE'])
        expect(collectAreaIcons(UNDERCROFT.assets, 'nowhere')).toEqual([])
    })
})

describe('the readable entries, the cards and the art', () => {
    it('lists the rooms, their routes and things under the filter, with routes into the unknown as Unexplored', () => {
        const player = renderMapEntriesHtml(UNDERCROFT, { revealAll: false })
        expect(player).toContain('<span class="rt-dungeon-map-tag ">2 areas</span>')
        expect(player).toContain('<strong>Cellar Landing</strong><span class="rt-dungeon-map-tag rt-dungeon-map-knowledge">VISITED</span>')
        expect(player).toContain('<li>Low oak beams cross the ceiling.</li>')
        expect(player).toContain('Unexplored<span class="rt-dungeon-map-tag ">LOCKED</span>')
        expect(player).toContain('<div class="rt-dungeon-map-empty">Not yet entered.</div>')
        expect(player).not.toContain('Secret Vault')
        expect(player).not.toContain('Crawling Dead Pack')
        const all = renderMapEntriesHtml(UNDERCROFT, { revealAll: true })
        expect(all).toContain('3 areas')
        expect(all).toContain('<strong>Secret Vault</strong>')
        expect(all).toContain('<strong>Crawling Dead Pack</strong>')
        expect(all).toContain('<b>Count:</b> 6')
        expect(all).toContain('<li>A collapsed arch provides cover.</li>')
        expect(renderMapEntriesHtml({ ...UNDERCROFT, areas: UNDERCROFT.areas.map((a) => ({ ...a, knowledge: 'UNREVEALED' })), assets: [] }, { revealAll: false })).toBe('<div class="rt-dungeon-map-empty">No revealed rooms yet.</div>')
    })

    it('renders a glyph\'s card and the stacked cards behind a badge', () => {
        expect(renderAssetTipHtml({ name: 'Crawling Dead Pack', kind: 'GROUP', state: 'ACTIVE', knowledge: 'KNOWN', detail: 'A knot.', count: '6' }))
            .toBe('<div class="rt-dungeon-graph-asset-tip-head"><strong>Crawling Dead Pack ×6</strong><span class="rt-dungeon-map-tag ">GROUP</span><span class="rt-dungeon-map-tag rt-dungeon-map-state">ACTIVE</span><span class="rt-dungeon-map-tag rt-dungeon-map-knowledge">KNOWN</span></div><div class="rt-dungeon-graph-asset-tip-detail">A knot.</div>')
        expect(renderAssetTipHtml({ name: '<b>', count: 1 })).toBe('<div class="rt-dungeon-graph-asset-tip-head"><strong>&lt;b&gt;</strong></div>')
        expect(renderOverflowTipHtml([{ name: 'A', kind: 'OBJECT' }, { name: 'B' }])).toBe('<div class="rt-dungeon-graph-overflow-tip"><div class="rt-dungeon-graph-overflow-tip-item"><div class="rt-dungeon-graph-asset-tip-head"><strong>A</strong><span class="rt-dungeon-map-tag ">OBJECT</span></div></div><div class="rt-dungeon-graph-overflow-tip-item"><div class="rt-dungeon-graph-asset-tip-head"><strong>B</strong></div></div></div>')
        expect(renderOverflowTipHtml([])).toBe('')
    })

    it('makes one mask rule per kind from the thirteen glyphs, inlined', () => {
        expect(MAP_KIND_NAMES).toEqual(['CREATURE', 'GROUP', 'TRAP', 'HAZARD', 'ALARM', 'BARRIER', 'EFFECT', 'LOOT', 'BUILDING', 'SUBDUNGEON', 'SUBINTERIOR', 'OBJECT', 'OTHER'])
        const css = mapKindArtCss()
        const rules = css.split('\n')
        expect(rules).toHaveLength(13)
        expect(rules[2]!.startsWith('.rt-dungeon-graph-icon-trap .rt-dungeon-graph-icon-art{-webkit-mask-image:url("data:image/svg+xml,%3Csvg')).toBe(true)
        expect(rules[2]).toContain('mask-image:url("data:image/svg+xml,')
        expect(css).not.toContain('import.meta')
        expect(css).not.toContain('<svg')
    })

    it('reads a site\'s document from its root entry, and nothing from a site without one', () => {
        const sites = buildMapSites(LOCATION_BOOK, 'Vell_LOC')
        const abbey = Object.values(sites).find((s) => s.siteRoot === 'Abbey Undercroft')!
        expect(siteDocument(abbey)?.areas.map((a) => a.id)).toEqual(['landing', 'crypt', 'vault'])
        expect(siteDocument({ ...abbey, mapChunks: [] })).toBeNull()
    })
})

describe('the evolution history', () => {
    const backlog = appendBacklogEntry(appendBacklogEntry(undefined, 'Abbey Undercroft', { kind: 'quiet', at: 'Day 4, 10:00 PM', elapsedMinutes: 600, summary: 'Map Evolution considered the site and committed no material change.' }), 'Abbey Undercroft', { kind: 'commit', at: 'Day 5, 02:00 AM', elapsedMinutes: 240, operationId: 'evo-2', summary: 'Abbey Undercroft: pack moved to vault by pack: Drawn by the open door.' })

    it('lists the passes with their kind, time and gap, hides a commit\'s details until Reveal all, and says when there is nothing', () => {
        const hidden = renderEvolutionHistoryHtml(backlog, 'Abbey Undercroft')
        expect(hidden).toBe('<div class="lh-map-history-entry lh-map-history-quiet"><div class="lh-map-history-head"><span>Quiet checkpoint</span><time>Day 4, 10:00 PM</time></div><div class="lh-map-history-elapsed">10 hours (600 in-world minutes total)</div><div class="lh-map-history-summary">Map Evolution considered the site and committed no material change.</div></div>'
            + '<div class="lh-map-history-entry lh-map-history-commit"><div class="lh-map-history-head"><span>Material commit</span><time>Day 5, 02:00 AM</time></div><div class="lh-map-history-elapsed">4 hours (240 in-world minutes total)</div><div class="lh-map-history-summary">Material details hidden. Turn on Reveal all to inspect this commit.</div></div>')
        const shown = renderEvolutionHistoryHtml(backlog, 'Abbey Undercroft', { revealAll: true })
        expect(shown).toContain('<div class="lh-map-history-summary">pack moved to vault by pack: Drawn by the open door.</div><code>evo-2</code>')
        expect(shown).not.toContain('Material details hidden')
        expect(renderEvolutionHistoryHtml(backlog, 'Morrowfen')).toBe('<div class="lh-map-history-empty">No Map Evolution pass has been recorded for this site.</div>')
        expect(renderEvolutionHistoryHtml(undefined, 'Morrowfen')).toContain('No Map Evolution pass')
    })

    it('merges repeated quiet passes into one row that counts them, escapes the text, and shows the newest twenty', () => {
        let long = backlog
        for (let i = 0; i < 3; i++) long = appendBacklogEntry(long, 'Abbey Undercroft', { kind: 'quiet', at: `Day ${6 + i}`, elapsedMinutes: 60, summary: 'Map Evolution considered the site and committed no material change.' })
        const html = renderEvolutionHistoryHtml(long, 'Abbey Undercroft')
        expect(html).toContain('<span>Quiet checkpoint · 3 passes</span><time>Day 8</time>')
        expect(html.split('lh-map-history-entry ').length - 1).toBe(3)
        let many = backlog
        for (let i = 0; i < 30; i++) many = appendBacklogEntry(many, 'Abbey Undercroft', { kind: 'commit', at: `Day ${10 + i}`, elapsedMinutes: 60, operationId: `op-${i}`, summary: `Abbey Undercroft: <rat ${i}> & co moved.` })
        // Twenty is all the ledger keeps, so the history shows the ledger whole; a lower cap would cut it.
        const capped = renderEvolutionHistoryHtml(many, 'Abbey Undercroft', { revealAll: true })
        expect(EVOLUTION_HISTORY_ENTRIES).toBe(20)
        expect(capped.split('lh-map-history-entry ').length - 1).toBe(20)
        expect(capped).toContain('&lt;rat 29&gt; &amp; co moved.')
        expect(capped).not.toContain('<rat')
        expect(capped).not.toContain('Day 10</time>')
    })
})
