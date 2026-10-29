/**
 * The Map Updater's legacy half, held to the pinned source: the generated
 * module must equal a fresh slice of the checkout byte for byte, and the
 * three modules the checkout can lend as they are -- the two prompts and the
 * helper library -- must agree with ours over a corpus.
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { sliceLegacy } from '../../scripts/extract-updater.mjs'
import { createMapLegacy } from './map-legacy.js'
import { extractCurrentTimeStr } from './time.js'
import { createUpdaterLegacy } from './updater-legacy.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && existsSync(`${checkout}/map-updater.js`)

const PARTIES = [
    '[PARTY]\n- Teodor: 10/10 HP (Fighter 2)\n  Status: fine\n- Mara Voss: 8/8 HP\n  Gear: a knife\n  Status: tired\n[/PARTY]',
    '[PARTY]\nOdran: 12/12 HP\nStatus: ok\nThe Ember Twins: 6/6 HP\n[/PARTY]',
    '[PARTY]\n[/PARTY]',
    'no party block at all',
    '[PARTY]\n- Oswin: ((Rogue)): 9/9 HP\n  Status: ok\n- Combat: none\n[/PARTY]',
]

describe.skipIf(!available)('the Map Updater against the pinned legacy build', () => {
    it('is the generated module, byte for byte, from a fresh slice of the checkout', () => {
        const committed = readFileSync('src/tracker/updater-legacy.js', 'utf8')
        expect(committed).toContain(sliceLegacy(checkout!))
    })

    it('carries the checkout\'s prompts and helper library', async () => {
        const map = createMapLegacy()
        const ours = createUpdaterLegacy({ ...map, extractCurrentTimeStr })
        const prompts = (await import(`${checkout}/map-updater-prompt.js`)) as Record<string, string>
        expect(ours.DEFAULT_MAP_UPDATER_SYSTEM_PROMPT).toBe(prompts.DEFAULT_MAP_UPDATER_SYSTEM_PROMPT)
        const direct = (await import(`${checkout}/map-updater-direct-prompt.js`)) as { DEFAULT_MAP_UPDATER_DIRECT_SYSTEM_PROMPT: string; selectMapUpdaterSystemPrompt: (i: string, n: string) => string }
        expect(ours.DEFAULT_MAP_UPDATER_DIRECT_SYSTEM_PROMPT).toBe(direct.DEFAULT_MAP_UPDATER_DIRECT_SYSTEM_PROMPT)
        for (const instruction of ['', '  ', 'Open the gate']) expect(ours.selectMapUpdaterSystemPrompt(instruction, 'normal')).toBe(direct.selectMapUpdaterSystemPrompt(instruction, 'normal'))
        const lib = (await import(`${checkout}/map-updater-lib.js`)) as Record<string, (...args: unknown[]) => unknown>
        for (const party of PARTIES) {
            expect(ours.extractPartyMemberNames(party), party).toEqual(lib.extractPartyMemberNames!(party))
            expect(ours.formatPartyRosterForMapUpdater(party), party).toBe(lib.formatPartyRosterForMapUpdater!(party))
        }
        const document = { version: 3, site: 'Crypt', kind: 'DUNGEON', areas: [{ id: 'hall', name: 'Hall', knowledge: 'VISITED', geometry: [], connections: [] }], assets: [{ id: 'teodor', kind: 'CREATURE', name: 'Teodor', location: 'hall', state: 'ACTIVE', knowledge: 'KNOWN', detail: '' }, { id: 'band', kind: 'GROUP', name: 'Mara Voss', location: 'hall', state: 'ACTIVE', knowledge: 'KNOWN', detail: '' }] }
        const transactions = [
            { operation_id: 'x', operations: [{ op: 'ADD_ASSET', name: 'Teodor' }] },
            { operation_id: 'x', operations: [{ op: 'REMOVE_ASSET', asset_id: 'teodor' }] },
            { noop: true },
            { operation_id: 'y', operations: [{ op: 'SET_ASSET', asset_id: 'chapel', notEntered: false }], chronicles: [{ area_id: 'hall', text: 'x' }] },
        ]
        const targets = [null, { building: { id: 'chapel' }, phase: 'entry' }, { building: null, untrackedName: 'Mab\'s Diner', phase: 'intent' }]
        for (const transaction of transactions) {
            expect(ours.validatePartyMemberRemovalTransaction(transaction, document, PARTIES[0])).toEqual(lib.validatePartyMemberRemovalTransaction!(transaction, document, PARTIES[0]))
            for (const target of targets) expect(ours.validateBuildingPopulationTransaction(transaction, target)).toEqual(lib.validateBuildingPopulationTransaction!(transaction, target))
        }
        const chat = [{ is_user: true }, { is_user: false }, { is_user: true }, { is_user: false }, { is_user: true }, { is_user: false }]
        for (const settings of [{ mapUpdaterLastRunChatLength: 0 }, { mapUpdaterLastRunChatLength: 4, routerLookback: 2 }, { mapUpdaterLastRunChatLength: 9, mapArchitectLookback: 1 }]) {
            for (const opts of [{}, { isManual: true, lookback: 1 }, { minLookbackTurns: 10 }]) {
                expect(ours.resolveMapUpdaterStoryWindow(chat, settings, opts as never)).toEqual(lib.resolveMapUpdaterStoryWindow!(chat, settings, opts))
            }
        }
    })
})
