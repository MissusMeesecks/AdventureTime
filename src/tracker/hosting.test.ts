import { describe, expect, it } from 'vitest'

import { ATTACHMENT_ERROR_TAG, findHostedMapEntry, isAttachmentFailure, MAX_HOSTED_MAP_DEPTH, mirrorHostCore, normalizeMapAttachment, peerSitePath, promoteGateway, reparentHostedEntries, resolveHostContext, stampHostedPeer, type HostContext } from './hosting.js'
import type { MapArea, MapDocument, MapSite, MapSites } from './map.js'

/** The legacy test suite's own fixture maker: a site record with one map chunk. */
export function mappedRecord(siteRoot: string, entryId: string, kind: string, areas: MapArea[], hostSite = ''): MapSite {
    return {
        siteRoot,
        entryId,
        mapChunks: [JSON.stringify({ version: 3, site: siteRoot, kind, ...(hostSite ? { hostSite, hostBrief: `Contained in ${hostSite}.` } : {}), areas, assets: [] })],
        locationEntries: [],
        statusLog: [],
    }
}

const area = (id: string, name: string, knowledge: MapArea['knowledge'] = 'VISITED'): MapArea => ({ id, name, knowledge, geometry: [], connections: [] })

export const MONUMENT = mappedRecord('Malarkey Monument', 'Book::1', 'INTERIOR', [area('ritual-workroom', 'Ritual Workroom'), area('cellar-crypt', 'Cellar Crypt')])
const CRYPT = mappedRecord('Malarkey Monument :: Cellar Crypt :: Cellar Crypt Dungeon', 'Book::2', 'DUNGEON', [area('western-seal', 'Western Seal')], 'Malarkey Monument')
const DEEP = mappedRecord('Malarkey Monument :: Cellar Crypt :: Cellar Crypt Dungeon :: Western Seal :: Deep Vault', 'Book::3', 'DUNGEON', [area('vault-floor', 'Vault Floor')], 'Malarkey Monument :: Cellar Crypt :: Cellar Crypt Dungeon')
const TOWN = mappedRecord('Elmridge', 'Book::4', 'SETTLEMENT', [area('market-square', 'Market Square'), area('mill-row', 'Mill Row')])

const call = (site: string, kind: string, attachTo?: { site: string; cell: string }) => ({ site, kind, prompt: 'A design.', briefDescription: 'A brief.', ...(attachTo ? { attachTo } : {}) })

/** Every case the pin test runs the checkout's resolver over too. */
export const HOSTING_CORPUS: Array<{ sites: MapSites; location: string; args: ReturnType<typeof call> }> = [
    { sites: { MONUMENT }, location: 'Faraway Coast, Harbor', args: call('Cellar Crypt Dungeon', 'DUNGEON', { site: 'Malarkey Monument', cell: 'Cellar Crypt' }) },
    { sites: { MONUMENT }, location: '', args: call('Cellar Crypt Dungeon', 'DUNGEON', { site: 'Malarkey Monument', cell: 'Cellar Crypt Dungeon' }) },
    { sites: { MONUMENT }, location: '', args: call('Cellar Crypt Dungeon', 'DUNGEON', { site: 'Malarkey Monument', cell: 'Attic' }) },
    { sites: { MONUMENT }, location: '', args: call('Cellar Crypt Dungeon', 'DUNGEON', { site: 'Old Mill', cell: 'Cellar Crypt' }) },
    { sites: { MONUMENT }, location: '', args: call('Market Town', 'SETTLEMENT', { site: 'Malarkey Monument', cell: 'Cellar Crypt' }) },
    { sites: { MONUMENT, CRYPT, DEEP }, location: '', args: call('Bottomless Well', 'DUNGEON', { site: DEEP.siteRoot, cell: 'Vault Floor' }) },
    { sites: { MONUMENT, CRYPT }, location: '', args: call('Malarkey Monument', 'INTERIOR', { site: CRYPT.siteRoot, cell: 'Western Seal' }) },
    { sites: { TOWN }, location: 'Elmridge, Market Square', args: call('Old Mill', 'INTERIOR') },
    { sites: { TOWN }, location: 'Elmridge, Market Square', args: call('Chapel', 'SETTLEMENT') },
    { sites: { TOWN }, location: 'Open Road', args: call('Old Mill', 'INTERIOR') },
    { sites: {}, location: '', args: call('Old Mill', 'INTERIOR') },
    { sites: { MONUMENT }, location: '', args: call('Cellar Crypt Dungeon', 'DUNGEON', { site: '', cell: 'Cellar Crypt' }) },
]

describe('the host context (58)', () => {
    it('resolves an explicit attachment to the parent cell, the canonical path and the gateway kind, with the cell told to both prompts', () => {
        const context = resolveHostContext({ MONUMENT }, 'Faraway Coast, Harbor', call('Cellar Crypt Dungeon', 'DUNGEON', { site: 'Malarkey Monument', cell: 'Cellar Crypt' }))!
        expect(context).toMatchObject({ hostSite: 'Malarkey Monument', hostEntryId: 'Book::1', hostAreaId: 'cellar-crypt', peerSite: 'Malarkey Monument :: Cellar Crypt :: Cellar Crypt Dungeon', expectedAssetKind: 'SUBDUNGEON', briefDescription: 'A brief.', explicit: true, hostDepth: 1, peerDepth: 2 })
        expect(context.promptContext).toContain('PARENT MAP CELL (LOCKED CONTEXT)')
        expect(context.promptContext).toContain('Target cell: Cellar Crypt [cellar-crypt]')
        expect(context.topologyPromptContext).toContain('PARENT MAP CELL (LOCKED STRUCTURAL CONTEXT)')
        expect(context.topologyPromptContext).not.toMatch(/asset/i)
        // An interior child is a SUBINTERIOR gateway.
        expect(resolveHostContext({ MONUMENT }, '', call('Scriptorium', 'INTERIOR', { site: 'Malarkey Monument', cell: 'Ritual Workroom' }))!.expectedAssetKind).toBe('SUBINTERIOR')
    })

    it('takes the active cell as shorthand for a dungeon or an interior made inside a mapped site, and nothing for a settlement or outside', () => {
        const inside = resolveHostContext({ TOWN }, 'Elmridge, Market Square', call('Old Mill', 'INTERIOR'))!
        expect(inside).toMatchObject({ hostSite: 'Elmridge', hostAreaId: 'market-square', peerSite: 'Elmridge :: Market Square :: Old Mill', expectedAssetKind: 'SUBINTERIOR', explicit: false })
        expect(resolveHostContext({ TOWN }, 'Elmridge, Market Square', call('Chapel', 'SETTLEMENT'))).toBeNull()
        expect(resolveHostContext({ TOWN }, 'Open Road', call('Old Mill', 'INTERIOR'))).toBeNull()
        expect(resolveHostContext({}, '', call('Old Mill', 'INTERIOR'))).toBeNull()
    })

    it('refuses in the attachment envelope: a settlement attached, a parent or a cell not found exactly, a chain past the cap, a site beneath itself', () => {
        const refusal = (run: () => unknown) => { try { run(); return '' } catch (error) { expect(isAttachmentFailure(error)).toBe(true); return (error as Error).message } }
        expect(refusal(() => resolveHostContext({ MONUMENT }, '', call('Market Town', 'SETTLEMENT', { site: 'Malarkey Monument', cell: 'Cellar Crypt' })))).toContain('SETTLEMENT maps cannot be nested')
        expect(refusal(() => resolveHostContext({ MONUMENT }, '', call('Cellar Crypt Dungeon', 'DUNGEON', { site: 'Old Mill', cell: 'Cellar Crypt' })))).toContain('Parent map "Old Mill" was not found exactly. Available mapped sites: Malarkey Monument.')
        expect(refusal(() => resolveHostContext({ MONUMENT }, '', call('Cellar Crypt Dungeon', 'DUNGEON', { site: 'Malarkey Monument', cell: 'Attic' })))).toContain('Cell "Attic" was not found exactly')
        expect(refusal(() => resolveHostContext({ MONUMENT, CRYPT, DEEP }, '', call('Bottomless Well', 'DUNGEON', { site: DEEP.siteRoot, cell: 'Vault Floor' })))).toContain(`Nested maps are limited to ${MAX_HOSTED_MAP_DEPTH} mapped levels`)
        expect(refusal(() => resolveHostContext({ MONUMENT, CRYPT }, '', call('Malarkey Monument', 'INTERIOR', { site: CRYPT.siteRoot, cell: 'Western Seal' })))).toContain('cannot be attached beneath itself')
        expect(refusal(() => normalizeMapAttachment({ site: '', cell: '' }))).toContain('attachTo requires both site and cell')
        expect(refusal(() => normalizeMapAttachment('A'))).toContain('attachTo must be an object')
        expect(normalizeMapAttachment(null)).toBeNull()
        expect(normalizeMapAttachment({ site: ' A ', cell: 'B' })).toEqual({ site: 'A', cell: 'B' })
        expect(ATTACHMENT_ERROR_TAG).toBe('[MAP_ARCHITECT_ATTACHMENT_ERROR — PRIVATE]')
        expect(isAttachmentFailure(new Error('plain'))).toBe(false)
    })
})

describe('the save\'s pieces (58)', () => {
    const host = (): MapDocument => JSON.parse(MONUMENT.mapChunks[0]!) as MapDocument
    const peer = (): MapDocument => JSON.parse(mappedRecord('Cellar Crypt Dungeon', 'Book::9', 'DUNGEON', [area('gate', 'Gate')]).mapChunks[0]!) as MapDocument

    it('promotes a gateway on the parent: made anew hidden for an offsite edit, or from a matching building; the path and the stamp follow it', () => {
        const document = host()
        const made = promoteGateway(document, 'Cellar Crypt Dungeon', 'SUBDUNGEON', 'cellar-crypt', 'A sealed complex.', true)
        expect(made).toMatchObject({ kind: 'SUBDUNGEON', name: 'Cellar Crypt Dungeon', location: 'cellar-crypt', state: 'ACTIVE', knowledge: 'UNREVEALED', detail: 'A sealed complex.', origin: 'NARRATOR_ESTABLISHED' })
        expect(made.id.startsWith('subsite-')).toBe(true)
        expect(document.assets).toContain(made)
        expect(peerSitePath(document, made)).toBe('Malarkey Monument :: Cellar Crypt :: Cellar Crypt Dungeon')
        const stamped = stampHostedPeer(peer(), document, made)
        expect(stamped.hostSite).toBe('Malarkey Monument')
        expect(stamped.hostBrief).toBe('Contained in Malarkey Monument, Cellar Crypt. Exit returns to Cellar Crypt in Malarkey Monument.')

        const town = JSON.parse(TOWN.mapChunks[0]!) as MapDocument
        town.assets.push({ id: 'mill', kind: 'BUILDING', name: 'Old Mill', location: 'mill-row', state: 'ACTIVE', knowledge: 'KNOWN', detail: 'A mill.', origin: 'INITIAL_MAP' })
        const promoted = promoteGateway(town, 'Old Mill', 'SUBINTERIOR', 'mill-row', 'ignored', false)
        expect(promoted).toMatchObject({ id: 'mill', kind: 'SUBINTERIOR', location: 'mill-row', knowledge: 'KNOWN' })
        expect(town.assets).toHaveLength(1)
        // A gateway of the other kind is never re-promoted.
        expect(() => promoteGateway(town, 'Old Mill', 'SUBDUNGEON', 'market-square', '', false)).toThrow(/is SUBINTERIOR; expected SUBDUNGEON/)
        expect(() => stampHostedPeer({ ...peer(), kind: 'SETTLEMENT' }, document, made)).toThrow(/must be DUNGEON or INTERIOR/)
    })

    it('mirrors the host into the CORE once, reparents a standalone root with its breadcrumbs, and finds the root a hosted save writes into', () => {
        expect(mirrorHostCore('[CORE]\nA crypt.\n[/CORE]\nmore', 'Malarkey Monument', 'Contained in it.')).toBe('[CORE]\nA crypt.\nHost Site: Malarkey Monument\nHost Brief: Contained in it.\n[/CORE]\nmore')
        expect(mirrorHostCore(mirrorHostCore('[CORE]\nA crypt.\n[/CORE]', 'A', 'B'), 'A', 'B')).toBe('[CORE]\nA crypt.\nHost Site: A\nHost Brief: B\n[/CORE]')
        expect(mirrorHostCore('no core', 'A', 'B')).toBe('[CORE]\nHost Site: A\nHost Brief: B\n[/CORE]\nno core')

        const entries = {
            1: { comment: 'Cellar Crypt Dungeon', content: '[CORE]\nx\n[/CORE]', key: ['Cellar Crypt Dungeon'] },
            2: { comment: 'Cellar Crypt Dungeon :: Gate', content: 'The gate.', key: [] },
            3: { comment: 'Elsewhere', content: '', key: [] },
        }
        expect(reparentHostedEntries(entries, entries[1], 'Malarkey Monument :: Cellar Crypt :: Cellar Crypt Dungeon', 'Cellar Crypt Dungeon')).toBe(true)
        expect(entries[1].comment).toBe('Malarkey Monument :: Cellar Crypt :: Cellar Crypt Dungeon')
        expect(entries[1].key).toEqual(['Cellar Crypt Dungeon', 'Malarkey Monument :: Cellar Crypt :: Cellar Crypt Dungeon'])
        expect(entries[2].comment).toBe('Malarkey Monument :: Cellar Crypt :: Cellar Crypt Dungeon :: Gate')
        expect(entries[3].comment).toBe('Elsewhere')
        expect(reparentHostedEntries(entries, entries[1], entries[1].comment, 'Cellar Crypt Dungeon')).toBe(false)

        const context = resolveHostContext({ MONUMENT }, '', call('Cellar Crypt Dungeon', 'DUNGEON', { site: 'Malarkey Monument', cell: 'Cellar Crypt' })) as HostContext
        const standalone = { 7: { comment: 'Cellar Crypt Dungeon', content: `[MAP]\n${peer().site ? JSON.stringify(peer()) : ''}\n[/MAP]`, key: [] }, 8: { comment: 'Other', content: '', key: [] } }
        expect(findHostedMapEntry(standalone, context.peerSite, 'Cellar Crypt Dungeon', context)).toBe(standalone[7])
        const canonical = { 7: { comment: context.peerSite, content: '', key: [] } }
        expect(findHostedMapEntry(canonical, context.peerSite, 'Cellar Crypt Dungeon', context)).toBe(canonical[7])
        expect(findHostedMapEntry({ 9: { comment: 'Other', content: '', key: [] } }, context.peerSite, 'Cellar Crypt Dungeon', context)).toBeNull()
    })
})
