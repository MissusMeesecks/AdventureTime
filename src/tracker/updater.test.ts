import { describe, expect, it } from 'vitest'

import { ASSETS, TOPOLOGY } from './architect.test.js'
import type { MapDocument } from './map.js'
import {
    appendChronicle,
    appendThreads,
    applyTransaction,
    buildUpdaterCorrectionPrompt,
    buildUpdaterPrompt,
    checkUpdaterReply,
    chronicleChild,
    currentTimeFor,
    DEFAULT_MAP_UPDATER_DIRECT_SYSTEM_PROMPT,
    DEFAULT_MAP_UPDATER_SYSTEM_PROMPT,
    describeUpdaterIssues,
    findChronicleChild,
    formatStory,
    partyNames,
    previousFooterForSite,
    priorApplication,
    readAppliedOperations,
    resolvePopulationTarget,
    resolveStoryWindow,
    selectSystemPrompt,
    stampChronicle,
    summarizeOperations,
    threadsFromTransaction,
    transactionSignature,
    type StoryMessage,
} from './updater.js'

export const CRYPT: MapDocument = { ...TOPOLOGY, assets: ASSETS.assets } as unknown as MapDocument

/** A settlement with one building the party has not been inside. */
export const TOWN: MapDocument = {
    version: 3, site: 'Elmridge', kind: 'SETTLEMENT', threat: 'LOW',
    areas: [
        { id: 'main-street', name: 'Main Street', knowledge: 'VISITED', geometry: ['A dirt street of false-front shops.'], connections: [{ to: 'town-square', state: 'OPEN', detail: '' }] },
        { id: 'town-square', name: 'Town Square', knowledge: 'DISCOVERED', geometry: ['A square with a dry fountain.'], connections: [{ to: 'main-street', state: 'OPEN', detail: '' }] },
    ],
    assets: [
        { id: 'mabs-diner', kind: 'BUILDING', name: 'Mab\'s Diner', location: 'main-street', state: 'ACTIVE', knowledge: 'KNOWN', detail: 'A chrome diner.', notEntered: true },
        { id: 'street-dogs', kind: 'GROUP', name: 'Stray Dogs', location: 'town-square', state: 'ACTIVE', knowledge: 'UNREVEALED', detail: 'Three thin dogs.', count: 3 },
    ],
} as unknown as MapDocument

export const MEMO = '[TIME]\nTime: 09:00 AM, Day 5\n[/TIME]\n[PARTY]\n- Teodor: 10/10 HP (Fighter 2)\n  Status: fine\n- Mara Voss: 8/8 HP\n  Status: tired\n[/PARTY]'

const STORY: StoryMessage[] = [
    { role: 'user', text: 'We go in.' },
    { role: 'assistant', text: 'The gate groans. *(Location: Varnholde Crypts, Broken Gate)*' },
    { role: 'system', text: 'ignored' },
    { role: 'user', text: 'We attack the ghouls.' },
    { role: 'assistant', text: 'Four ghouls fall. *(Location: Varnholde Crypts, Drowned Nave)*' },
    { role: 'user', text: 'We leave.' },
    { role: 'assistant', text: 'You climb out. *(Location: Varnholde Road)*' },
]

const base = { siteRoot: 'Varnholde Crypts', document: CRYPT, currentLocation: 'Varnholde Crypts, Drowned Nave', story: 'Player: We attack.\n\nNarrator: Four ghouls fall.', memo: MEMO, currentTime: '09:00 AM, Day 5', populationTarget: null, instruction: '' }

describe('the story the updater reads', () => {
    it('reads since the last pass, or the last N user turns, or more when a building needs furnishing', () => {
        expect(resolveStoryWindow(STORY, { watermark: 0, lookback: 1 })).toEqual({ startIdx: 5, sinceLastRun: false })
        expect(resolveStoryWindow(STORY, { watermark: 3, lookback: 1 })).toEqual({ startIdx: 3, sinceLastRun: true })
        expect(resolveStoryWindow(STORY, { watermark: 3, lookback: 1, manual: true })).toEqual({ startIdx: 5, sinceLastRun: false })
        expect(resolveStoryWindow(STORY, { watermark: 6, lookback: 1, minTurns: 10 })).toEqual({ startIdx: 0, sinceLastRun: false })
        expect(resolveStoryWindow(STORY, { watermark: 9, lookback: 2 })).toEqual({ startIdx: 7, sinceLastRun: true })
    })

    it('formats the story as Player and Narrator lines, leaving system messages out', () => {
        expect(formatStory(STORY, 3)).toBe('Player: We attack the ghouls.\n\nNarrator: Four ghouls fall. *(Location: Varnholde Crypts, Drowned Nave)*\n\nPlayer: We leave.\n\nNarrator: You climb out. *(Location: Varnholde Road)*')
        expect(formatStory(STORY, 7)).toBe('')
        expect(formatStory(STORY, 0)).not.toContain('ignored')
        expect(formatStory(STORY, 0).split('\n\n')).toHaveLength(6)
    })

    it('finds the footer the party had inside a site before the last one, and the party\'s names and the time', () => {
        expect(previousFooterForSite(STORY, 'Varnholde Crypts')).toBe('Varnholde Crypts, Drowned Nave')
        expect(previousFooterForSite(STORY.slice(0, 2), 'Varnholde Crypts')).toBe('Varnholde Crypts')
        expect(partyNames(MEMO)).toEqual(['Teodor', 'Mara Voss'])
        expect(currentTimeFor(MEMO, 'nothing stamped')).toBe('09:00 AM, Day 5')
        expect(currentTimeFor(MEMO, 'It is 11:30 PM, Day 6 when they arrive.')).toBe('11:30 PM, Day 6')
    })
})

describe('the prompts', () => {
    it('frames the routine pass with the site, the kind rule, the footer, the party, the time, the map and the story', () => {
        const prompt = buildUpdaterPrompt(base)
        expect(prompt.startsWith('UPDATE THE ATTACHED MAP\nExact site root: Varnholde Crypts\nKind: DUNGEON\nDUNGEON is room-scale.')).toBe(true)
        expect(prompt).toContain('## CURRENT LOCATION\nVarnholde Crypts, Drowned Nave')
        expect(prompt).toContain('## PARTY (must not exist as assets)')
        expect(prompt).toContain('- Teodor\n- Mara Voss')
        expect(prompt).toContain('## CURRENT IN-WORLD TIME (AUTHORITATIVE)\n09:00 AM, Day 5')
        expect(prompt).toContain('ghoul-pack | GROUP | Ghoul Pack | loc=drowned-nave')
        expect(prompt).toContain('## RECENT STORY\nPlayer: We attack.')
        expect(prompt.trimEnd().endsWith('Use {"noop":true} when no durable map fact changed.')).toBe(true)
        const correction = buildUpdaterCorrectionPrompt(base, '{"bad":true}', [{ code: 'ASSET_NOT_FOUND', path: 'map.operations[0].asset_id', hint: 'Use an exact asset ID.' }], 1)
        expect(correction.startsWith('CORRECTION PASS 1')).toBe(true)
        expect(correction).toContain('"code": "ASSET_NOT_FOUND"')
        expect(correction).toContain('PREVIOUS OUTPUT\n{"bad":true}')
    })

    it('frames the exit pass, the inspector pass, a furnishing and a direct instruction', () => {
        expect(buildUpdaterPrompt({ ...base, exitPass: true, previousLocation: 'Varnholde Crypts, Drowned Nave', currentLocation: 'Varnholde Road' })).toContain('## SITE EXIT CLEANUP (MANDATORY REVIEW)\nDeparted mapped site: Varnholde Crypts\nPrevious footer location: Varnholde Crypts, Drowned Nave\nCurrent footer location: Varnholde Road')
        expect(buildUpdaterPrompt({ ...base, inspectorPass: true, currentLocation: 'Elsewhere' })).toContain('## INSPECTOR TARGET SITE\nVarnholde Crypts\nThis manual pass targets this exact site from Map Details. The party is likely elsewhere')
        const target = resolvePopulationTarget(TOWN, 'Elmridge, Main Street, Mab\'s Diner')!
        expect(target.building?.id).toBe('mabs-diner')
        const furnishing = buildUpdaterPrompt({ ...base, siteRoot: 'Elmridge', document: TOWN, currentLocation: 'Elmridge, Main Street, Mab\'s Diner', populationTarget: target })
        expect(furnishing).toContain('## FIRST-ENTRY BUILDING POPULATION (MANDATORY THIS PASS)')
        expect(furnishing).toContain('Building: mabs-diner | Mab\'s Diner')
        expect(furnishing).toContain('Kind: SETTLEMENT\nOrdinary settlement structures the party enters are BUILDING assets')
        const untracked = resolvePopulationTarget(TOWN, 'Elmridge, Main Street, The Feed Store')!
        expect(untracked).toMatchObject({ building: null, untrackedName: 'The Feed Store' })
        expect(resolvePopulationTarget(TOWN, 'Elmridge, Town Square')).toBeNull()
        expect(resolvePopulationTarget(CRYPT, 'Varnholde Crypts, Drowned Nave')).toBeNull()
        const direct = buildUpdaterPrompt({ ...base, instruction: 'Open the bronze door.' })
        expect(direct.startsWith('DIRECT MAP COMMAND\n\n## DIRECT INSTRUCTION (AUTHORITATIVE SCOPE)\nOpen the bronze door.')).toBe(true)
        expect(direct).toContain('## PARTY NAMES (REFERENCE ONLY)')
        expect(selectSystemPrompt('', '')).toBe(DEFAULT_MAP_UPDATER_SYSTEM_PROMPT)
        expect(selectSystemPrompt('', 'Mine.')).toBe('Mine.')
        expect(selectSystemPrompt('Open it.', 'Mine.')).toBe(DEFAULT_MAP_UPDATER_DIRECT_SYSTEM_PROMPT)
    })
})

describe('the verdict on a reply', () => {
    const ctx = { document: CRYPT, memo: MEMO, populationTarget: null, directPass: false, currentTime: '09:00 AM, Day 5' }

    it('applies a valid transaction to a copy, leaving the document given untouched, and reports what it made', () => {
        const reply = JSON.stringify({ operation_id: 'day5-0900-ghouls', operations: [
            { op: 'SET_ASSET', evidence: 'CONFIRMED', asset_id: 'ghoul-pack', state: 'DESTROYED', knowledge: 'KNOWN', detail: 'Four ghoul corpses in the water.', cause: 'Killed by the party.', actor: 'party' },
            { op: 'ADD_ASSET', evidence: 'CONFIRMED', name: 'Odran', kind: 'CREATURE', location: 'ossuary', state: 'ACTIVE', knowledge: 'KNOWN', detail: 'A priest hiding among the bones.', cause: 'Found hiding here.' },
            { op: 'SET_CONNECTION', evidence: 'CONFIRMED', from: 'drowned-nave', to: 'reliquary', state: 'OPEN', detail: 'The wax seal broken', cause: 'The party broke the seal.' },
        ], chronicles: [{ area_id: 'ossuary', text: 'Found Odran among the bones.' }] })
        const verdict = checkUpdaterReply(reply, ctx)
        expect(verdict.kind).toBe('applied')
        if (verdict.kind !== 'applied') return
        expect(verdict.applied.operationId).toBe('day5-0900-ghouls')
        expect(verdict.applied.document.assets.find((a) => a.id === 'ghoul-pack')).toMatchObject({ state: 'DESTROYED', actor: 'party', cause: 'Killed by the party.' })
        expect(verdict.applied.createdAssets).toEqual([{ id: 'odran', name: 'Odran' }])
        expect(verdict.applied.document.areas.find((a) => a.id === 'ossuary')?.knowledge).toBe('VISITED')
        expect(verdict.applied.document.areas.find((a) => a.id === 'drowned-nave')?.connections.find((c) => c.to === 'reliquary')?.state).toBe('OPEN')
        expect(verdict.applied.chronicles).toEqual([{ areaId: 'ossuary', areaName: 'Ossuary', text: 'Found Odran among the bones.' }])
        expect(CRYPT.assets.find((a) => a.id === 'ghoul-pack')?.state).toBe('ACTIVE')
        expect(CRYPT.areas.find((a) => a.id === 'ossuary')?.knowledge).toBe('UNREVEALED')
        expect(summarizeOperations(verdict.transaction)).toBe('SET_ASSET ghoul-pack; ADD_ASSET Odran (CREATURE); SET_CONNECTION drowned-nave → reliquary')
    })

    it('honours a noop, and rejects bad JSON, a party member added, a party member left on the map, an unfurnished building and a broken rule, each named', () => {
        expect(checkUpdaterReply('{"noop":true}', ctx)).toEqual({ kind: 'noop' })
        expect(checkUpdaterReply('{"operation_id":"x","operations":[]}', ctx)).toEqual({ kind: 'noop' })
        const bad = checkUpdaterReply('not json', ctx)
        expect(bad).toMatchObject({ kind: 'rejected', issues: [{ code: 'INVALID_JSON' }] })
        const party = checkUpdaterReply(JSON.stringify({ operation_id: 'x', operations: [{ op: 'ADD_ASSET', name: 'Mara Voss', kind: 'CREATURE', location: 'ossuary', state: 'ACTIVE', knowledge: 'KNOWN', cause: 'c' }] }), ctx)
        expect(party).toMatchObject({ kind: 'rejected', issues: [{ code: 'PARTY_MEMBER_NOT_AN_ASSET', path: 'operations[0].name' }] })
        const withTeodor: MapDocument = { ...CRYPT, assets: [...CRYPT.assets, { id: 'teodor', kind: 'CREATURE', name: 'Teodor', location: 'ossuary', state: 'ACTIVE', knowledge: 'KNOWN', detail: '' }] }
        const stale = checkUpdaterReply('{"noop":true}', { ...ctx, document: withTeodor })
        expect(stale).toMatchObject({ kind: 'rejected', issues: [{ code: 'PARTY_CREATURE_MUST_BE_REMOVED' }] })
        // A direct instruction is not the pass that does party housekeeping.
        expect(checkUpdaterReply('{"noop":true}', { ...ctx, document: withTeodor, directPass: true })).toEqual({ kind: 'noop' })
        const target = resolvePopulationTarget(TOWN, 'Elmridge, Main Street, Mab\'s Diner')
        const empty = checkUpdaterReply('{"noop":true}', { ...ctx, document: TOWN, populationTarget: target })
        expect(empty).toMatchObject({ kind: 'rejected', issues: [{ code: 'BUILDING_POPULATION_NOT_RESOLVED' }] })
        const furnished = checkUpdaterReply(JSON.stringify({ operation_id: 'diner', operations: [
            { op: 'ADD_ASSET', evidence: 'CONFIRMED', name: 'Mab', kind: 'CREATURE', location: 'mabs-diner', state: 'ACTIVE', knowledge: 'KNOWN', detail: 'The owner, behind the counter.', cause: 'Met on entry.' },
            { op: 'SET_ASSET', evidence: 'CONFIRMED', asset_id: 'mabs-diner', notEntered: false, cause: 'The party went in.' },
        ] }), { ...ctx, document: TOWN, populationTarget: target })
        expect(furnished.kind).toBe('applied')
        if (furnished.kind === 'applied') expect(furnished.applied.document.assets.find((a) => a.id === 'mabs-diner')?.notEntered).toBe(false)
        const broken = checkUpdaterReply(JSON.stringify({ operation_id: 'x-op', operations: [{ op: 'SET_ASSET', asset_id: 'nobody', state: 'DEAD', cause: 'c' }] }), ctx)
        expect(broken).toMatchObject({ kind: 'rejected', issues: [{ code: 'ASSET_NOT_FOUND' }] })
        expect(describeUpdaterIssues((broken as { issues: Array<{ code: string; path: string; hint: string }> }).issues)).toMatch(/^ASSET_NOT_FOUND at map\.operations\[0\]\.asset_id: /)
        expect(applyTransaction(CRYPT, { operation_id: 'x-op', operations: [] }, '')).toMatchObject({ ok: false, issues: [{ code: 'MISSING_OPERATIONS' }] })
    })

    it('signs a transaction the same under any key order, and knows one it applied before', () => {
        const a = transactionSignature({ operation_id: 'x', operations: [{ op: 'SET_ASSET', asset_id: 'g', state: 'DEAD' }] })
        const b = transactionSignature({ operations: [{ state: 'DEAD', asset_id: 'g', op: 'SET_ASSET' }], operation_id: 'x' })
        expect(a).toBe(b)
        expect(a).toMatch(/^[0-9a-f]{8}$/)
        expect(transactionSignature({ operation_id: 'y' })).not.toBe(a)
        const applied = readAppliedOperations({ [`multihogDungeonMapOperationIds`]: ['old-style', { id: 'x', signature: a }, { nope: true }] })
        expect(applied).toEqual([{ id: 'old-style', signature: '' }, { id: 'x', signature: a }])
        expect(priorApplication(applied, 'x', a)).toBe('applied')
        expect(priorApplication(applied, 'x', 'ffffffff')).toBe('conflict')
        expect(priorApplication(applied, 'old-style', 'anything')).toBe('applied')
        expect(priorApplication(applied, 'new', a)).toBeNull()
        expect(readAppliedOperations(undefined)).toEqual([])
    })
})

describe('the chronicles and the threads', () => {
    it('stamps a chronicle with the time once, files it under Site :: Area, finds the entry again and never writes a line twice', () => {
        expect(stampChronicle('Found Odran.', '09:00 AM, Day 5')).toBe('[09:00 AM, Day 5] Found Odran.')
        expect(stampChronicle('[Day 5, 09:00 AM] Found Odran.', '09:00 AM, Day 5')).toBe('[Day 5, 09:00 AM] Found Odran.')
        expect(stampChronicle('  Found Odran.  ', '')).toBe('Found Odran.')
        const child = chronicleChild('Varnholde Crypts', 'Ossuary', '[09:00 AM, Day 5] Found Odran.')
        expect(child).toEqual({ key: ['Ossuary', 'Varnholde Crypts'], comment: 'Varnholde Crypts :: Ossuary', content: '[CORE]\nOssuary is a location within Varnholde Crypts; its permanent details are established through play.\n[/CORE]\n[09:00 AM, Day 5] Found Odran.' })
        const entries = [{ comment: 'Other Keep :: Ossuary', key: [] }, { comment: 'Varnholde Crypts', key: ['Varnholde Crypts'] }, { comment: 'Varnholde Crypts :: The Ossuary', key: [] }, { comment: 'Ossuary', key: ['Elsewhere'] }, { comment: 'Lower Stair', key: ['varnholde crypts'] }]
        expect(findChronicleChild(entries, 'Varnholde Crypts', 'ossuary')).toBe(entries[2])
        expect(findChronicleChild(entries, 'Varnholde Crypts', 'Lower Stair')).toBe(entries[4])
        expect(findChronicleChild(entries, 'Varnholde Crypts', 'Drowned Nave')).toBeNull()
        expect(appendChronicle('[CORE]\nx\n[/CORE]\nA line.', 'A line.')).toBe('[CORE]\nx\n[/CORE]\nA line.')
        expect(appendChronicle('[CORE]\nx\n[/CORE]\nA line.\n', 'Another.')).toBe('[CORE]\nx\n[/CORE]\nA line.\nAnother.')
        expect(appendChronicle('', 'First.')).toBe('First.')
    })

    it('turns the operations into threads for Map Evolution, keyed by the site, with a resolution closing the thread it answers', () => {
        const transaction = { operation_id: 'day5-ghouls', operations: [
            { op: 'SET_ASSET', asset_id: 'ghoul-pack', state: 'DESTROYED', actor: 'party', cause: 'Killed by the party.' },
            { op: 'ADD_ASSET', name: 'Odran', kind: 'CREATURE', cause: 'Found hiding.' },
            { op: 'SET_CONNECTION', from: 'drowned-nave', to: 'reliquary', state: 'OPEN' },
        ] }
        const threads = threadsFromTransaction(transaction, { at: '09:00 AM, Day 5', createdAssets: [{ id: 'odran', name: 'Odran' }] })
        expect(threads.map((t) => t.summary)).toEqual(['ghoul-pack DESTROYED by party: Killed by the party.', 'ADD_ASSET odran: Found hiding.'])
        expect(threads[0]).toMatchObject({ id: 'day5-ghouls:0', at: '09:00 AM, Day 5', status: 'open', subjectId: 'ghoul-pack', actor: 'party' })
        let bySite = appendThreads(undefined, 'Varnholde Crypts', threads)
        expect(Object.keys(bySite)).toEqual(['varnholde crypts'])
        expect(bySite['varnholde crypts']).toHaveLength(2)
        bySite = appendThreads(bySite, 'Varnholde Crypts', threadsFromTransaction({ operation_id: 'day6', operations: [{ op: 'REMOVE_ASSET', asset_id: 'odran', thread_status: 'resolved', cause: 'He joined the party.' }] }, { at: 'Day 6', createdAssets: [] }))
        expect(bySite['varnholde crypts']!.map((t) => t.status)).toEqual(['open', 'resolved', 'resolved'])
        // Appending the same transaction again adds nothing.
        expect(appendThreads(bySite, 'Varnholde Crypts', threads)['varnholde crypts']).toHaveLength(3)
    })
})
