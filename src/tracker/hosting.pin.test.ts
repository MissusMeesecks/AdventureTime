/**
 * The nested-map hosting, held to the pinned source (58): the generated
 * module must equal a fresh slice of the checkout byte for byte, and the
 * checkout's own two modules, which import only the map library, must agree
 * with ours over a corpus of attachments.
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { sliceLegacy } from '../../scripts/extract-hosting.mjs'
import { MAX_HOSTED_MAP_DEPTH, mirrorHostCore, normalizeMapAttachment, peerSitePath, resolveHostContext, stampHostedPeer } from './hosting.js'
import { HOSTING_CORPUS, MONUMENT, mappedRecord } from './hosting.test.js'
import type { MapAsset, MapDocument } from './map.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && existsSync(`${checkout}/map-hosting-context.js`)

describe.skipIf(!available)('the nested-map hosting against the pinned legacy build', () => {
    it('is the generated module, byte for byte, from a fresh slice of the checkout', () => {
        const committed = readFileSync('src/tracker/hosting-legacy.js', 'utf8')
        expect(committed).toContain(sliceLegacy(checkout!))
    })

    it('resolves every attachment of the corpus as the checkout does, and stamps, paths and mirrors the same', async () => {
        const theirs = (await import(`${checkout}/map-hosting-context.js`)) as { resolveHostedCreationContext: (c: unknown, l: string, a: unknown) => unknown; normalizeMapAttachment: (v: unknown) => unknown }
        const hosting = (await import(`${checkout}/map-hosting.js`)) as { MAX_HOSTED_MAP_DEPTH: number; buildHostedPeerSitePath: (d: unknown, a: unknown) => string; stampHostedPeerDocument: (p: unknown, h: unknown, a: unknown) => unknown; ensureHostCoreMirror: (c: string, s: string, b: string) => string }
        expect(MAX_HOSTED_MAP_DEPTH).toBe(hosting.MAX_HOSTED_MAP_DEPTH)
        const outcome = (run: () => unknown) => { try { return { value: run() } } catch (error) { return { error: (error as Error).message } } }
        for (const { sites, location, args } of HOSTING_CORPUS) {
            const label = JSON.stringify(args)
            expect(outcome(() => resolveHostContext(sites, location, args)), label).toEqual(outcome(() => theirs.resolveHostedCreationContext({ sites }, location, args)))
        }
        for (const value of [null, undefined, { site: 'A', cell: 'B' }, { site: ' A ', cell: '' }, { site: '', cell: '' }, 'A', ['A'], 7]) {
            expect(outcome(() => normalizeMapAttachment(value)), String(value)).toEqual(outcome(() => theirs.normalizeMapAttachment(value)))
        }
        const host = JSON.parse(MONUMENT.mapChunks[0]!) as MapDocument
        const asset: MapAsset = { id: 'subsite-1', kind: 'SUBDUNGEON', name: 'Cellar Crypt Dungeon', location: 'cellar-crypt', state: 'ACTIVE', knowledge: 'KNOWN', detail: 'A sealed complex.', origin: 'NARRATOR_ESTABLISHED' }
        const peer = JSON.parse(mappedRecord('Cellar Crypt Dungeon', 'Book::9', 'DUNGEON', [{ id: 'gate', name: 'Gate', knowledge: 'VISITED', geometry: [], connections: [] }]).mapChunks[0]!) as MapDocument
        expect(peerSitePath(host, asset)).toBe(hosting.buildHostedPeerSitePath(host, asset))
        expect(stampHostedPeer(peer, host, asset)).toEqual(hosting.stampHostedPeerDocument(peer, host, asset))
        for (const content of ['[CORE]\nA crypt.\n[/CORE]\nmore', 'no core', '[CORE]\nHost Site: Old\nHost Brief: Old brief\nText\n[/CORE]', '']) {
            expect(mirrorHostCore(content, 'Malarkey Monument', 'Contained in Malarkey Monument, Cellar Crypt.')).toBe(hosting.ensureHostCoreMirror(content, 'Malarkey Monument', 'Contained in Malarkey Monument, Cellar Crypt.'))
        }
    })
})
