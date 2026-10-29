import { describe, expect, it } from 'vitest'

import {
    architectAcknowledgement,
    ArchitectFailure,
    createAreaMapCommandIsComplete,
    parseCreateAreaMapCommand,
    stripCreateAreaMapCommand,
    textOpenerBrief,
    architectResult,
    buildAssetsCorrectionPrompt,
    buildAssetsPrompt,
    buildTopologyCorrectionPrompt,
    buildTopologyPrompt,
    CREATE_AREA_MAP_TOOL_NAME,
    createAreaMapToolRegistration,
    DEFAULT_MAP_ARCHITECT_SYSTEM_PROMPT,
    DEFAULT_MAP_ARCHITECT_TOPOLOGY_SYSTEM_PROMPT,
    describeIssues,
    existingMapResult,
    findExistingSite,
    normalizeArchitectArgs,
    parseArchitectResponse,
    rootEntryCore,
    siteRootsMatch,
    validateAssets,
    validateTopology,
    type ArchitectArgs,
} from './architect.js'
import {
    applyTextOpenerCyoaCaveat,
    isTextOpener,
    MAP_ARCHITECT_TEXT_OPENER_CYOA_CAVEAT,
    MAP_ARCHITECT_TEXT_OPENER_RULES,
    normalizeMapArchitectOpener,
} from './opener.js'
import { buildMapSites, type MapDocument } from './map.js'
import { LOCATION_BOOK } from './map.test.js'

export const ARGS: ArchitectArgs = { site: 'Varnholde Crypts', entrance: 'Broken Gate', prompt: 'A flooded crypt held by ghouls; one sealed reliquary.', briefDescription: 'A flooded crypt.', kind: 'DUNGEON', scale: 'SMALL', threat: 'HIGH' }

/** A topology a model might return for ARGS: five rooms, every route reciprocal. */
export const TOPOLOGY = {
    version: 3, site: 'Varnholde Crypts', kind: 'DUNGEON', threat: 'HIGH',
    areas: [
        { id: 'broken-gate', name: 'Broken Gate', knowledge: 'VISITED', geometry: ['A collapsed iron gate in a flooded arch.'], connections: [{ to: 'drowned-nave', state: 'OPEN', detail: 'A waist-deep flooded passage' }] },
        { id: 'drowned-nave', name: 'Drowned Nave', knowledge: 'UNREVEALED', geometry: ['A long vaulted nave, knee-deep in black water.'], connections: [{ to: 'broken-gate', state: 'OPEN', detail: 'A waist-deep flooded passage' }, { to: 'ossuary', state: 'OPEN', detail: 'A low side arch' }, { to: 'reliquary', state: 'LOCKED', detail: 'A bronze door sealed with wax' }] },
        { id: 'ossuary', name: 'Ossuary', knowledge: 'UNREVEALED', geometry: ['Bone shelves line a dry side chamber.'], connections: [{ to: 'drowned-nave', state: 'OPEN', detail: 'A low side arch' }, { to: 'stair', state: 'OPEN', detail: 'A worn spiral stair' }] },
        { id: 'reliquary', name: 'Sealed Reliquary', knowledge: 'UNREVEALED', geometry: ['A small vault with a stone altar.'], connections: [{ to: 'drowned-nave', state: 'LOCKED', detail: 'A bronze door sealed with wax' }] },
        { id: 'stair', name: 'Lower Stair', knowledge: 'UNREVEALED', geometry: ['A spiral stair descending into water.'], connections: [{ to: 'ossuary', state: 'OPEN', detail: 'A worn spiral stair' }] },
    ],
}
export const ASSETS = {
    assets: [
        { id: 'ghoul-pack', kind: 'GROUP', name: 'Ghoul Pack', location: 'drowned-nave', state: 'ACTIVE', knowledge: 'UNREVEALED', detail: 'Four ghouls wading in the dark.', origin: 'INITIAL_MAP', count: 4 },
        { id: 'wax-seal', kind: 'BARRIER', name: 'Wax Seal', location: 'reliquary', state: 'INTACT', knowledge: 'UNREVEALED', detail: 'Consecrated wax that burns the undead.', origin: 'INITIAL_MAP' },
        { id: 'reliquary-chest', kind: 'LOOT', name: 'Reliquary Chest', location: 'reliquary', state: 'INTACT', knowledge: 'UNREVEALED', detail: 'A saint\'s finger bone in silver.', origin: 'INITIAL_MAP' },
        { id: 'collapse', kind: 'HAZARD', name: 'Unstable Vault', location: 'stair', state: 'ACTIVE', knowledge: 'UNREVEALED', detail: 'The stair\'s roof sheds stone when disturbed.', origin: 'INITIAL_MAP' },
    ],
}

describe('the tool', () => {
    it('is the legacy\'s schema under Spindle\'s field names, inline for the narrator', () => {
        const tool = createAreaMapToolRegistration()
        expect(tool.name).toBe(CREATE_AREA_MAP_TOOL_NAME)
        expect(tool.display_name).toBe('Map Architect')
        expect(tool.inline_available).toBe(true)
        expect(tool.description).toContain('Create and save one private objective map.')
        const params = tool.parameters as { required: string[]; properties: Record<string, { enum?: string[] }> }
        expect(params.required).toEqual(['site', 'entrance', 'kind', 'scale', 'threat', 'prompt', 'brief_description'])
        expect(params.properties.kind!.enum).toEqual(['DUNGEON', 'SETTLEMENT', 'INTERIOR'])
        expect(params.properties.threat!.enum).toEqual(['NONE', 'LOW', 'MODERATE', 'HIGH', 'DEADLY'])
        expect(Object.keys(params.properties)).toContain('attachTo')
    })

    it('cleans a call: the three strings, the enums normalised, a brief from the prompt, and refuses what this build does not do yet', () => {
        const args = normalizeArchitectArgs({ site: ' Varnholde Crypts ', entrance: 'Broken Gate', kind: 'dungeon', scale: 'tiny', threat: 'HIGH', prompt: 'A flooded crypt held by ghouls. Deep water.' })
        expect(args).toEqual({ site: 'Varnholde Crypts', entrance: 'Broken Gate', prompt: 'A flooded crypt held by ghouls. Deep water.', briefDescription: 'A flooded crypt held by ghouls.', kind: 'DUNGEON', scale: 'MEDIUM', threat: 'HIGH' })
        expect(normalizeArchitectArgs({ site: 'X', entrance: 'Y', premise: 'p', kind: 'INTERIOR', brief_description: 'b' })).toMatchObject({ prompt: 'p', briefDescription: 'b', threat: 'LOW', scale: 'MEDIUM' })
        // An unreadable threat falls back to the kind's default: MODERATE for a settlement, LOW for an interior.
        expect(normalizeArchitectArgs({ site: 'X', entrance: 'Y', prompt: 'p', kind: 'SETTLEMENT', threat: 'nonsense' }).threat).toBe('MODERATE')
        expect(() => normalizeArchitectArgs({ site: 'X', prompt: 'p' })).toThrow(ArchitectFailure)
        // attachTo is read as the hosting reads it (58): both strings, or refused in the attachment envelope.
        expect(normalizeArchitectArgs({ site: 'X', entrance: 'Y', prompt: 'p', attachTo: { site: ' A ', cell: 'B' } }).attachTo).toEqual({ site: 'A', cell: 'B' })
        expect(normalizeArchitectArgs({ site: 'X', entrance: 'Y', prompt: 'p' })).not.toHaveProperty('attachTo')
        expect(() => normalizeArchitectArgs({ site: 'X', entrance: 'Y', prompt: 'p', attachTo: 'A' })).toThrow(/\[MAP_ARCHITECT_ATTACHMENT_ERROR — PRIVATE\]\nattachTo must be an object/)
        // Settlement inclusion (62): the names deduplicated and kept on a SETTLEMENT, refused on anything else with the legacy's words.
        expect(normalizeArchitectArgs({ site: 'X', entrance: 'Y', prompt: 'p', kind: 'SETTLEMENT', include: [' A ', 'B', 'A', ''] }).include).toEqual(['A', 'B'])
        expect(normalizeArchitectArgs({ site: 'X', entrance: 'Y', prompt: 'p', kind: 'SETTLEMENT', include: [] })).not.toHaveProperty('include')
        expect(() => normalizeArchitectArgs({ site: 'X', entrance: 'Y', prompt: 'p', kind: 'DUNGEON', include: ['A'] })).toThrow(/\[MAP_ARCHITECT_ERROR — PRIVATE\]\ninclude\[\] is valid only while first creating a SETTLEMENT map\./)
        // The failure is the legacy's private envelope, and it is the whole answer.
        const failure = new ArchitectFailure('nope')
        expect(failure.message.startsWith('[MAP_ARCHITECT_ERROR — PRIVATE]\nnope\nDo not call CreateAreaMap again in this turn.')).toBe(true)
        expect(failure.message.trimEnd().endsWith('[/MAP_ARCHITECT_ERROR]')).toBe(true)
    })

    it('finds a site the campaign already maps, loosely, and answers with the map it has', () => {
        const sites = buildMapSites(LOCATION_BOOK, 'Vell_LOC')
        expect(findExistingSite(sites, 'the abbey undercroft')?.siteRoot).toBe('Abbey Undercroft')
        expect(findExistingSite(sites, 'Nowhere')).toBeUndefined()
        const result = existingMapResult(findExistingSite(sites, 'Abbey Undercroft')!)
        expect(result.startsWith('[MAP_ARCHITECT_RESULT — PRIVATE]\nA map for Abbey Undercroft was already attached. Reuse it; do not create or replace it.')).toBe(true)
        expect(result).toContain('Dungeon Site: Abbey Undercroft')
        expect(siteRootsMatch('The Abbey Undercroft', 'abbey undercroft')).toBe(true)
        expect(siteRootsMatch('Abbey Undercroft', 'Abbey Crypt')).toBe(false)
    })
})

describe('the two stages', () => {
    it('frames the topology prompt with the call, the story and the footer, and the correction with the issues', () => {
        const prompt = buildTopologyPrompt(ARGS, 'PLAYER: We go in.', 'Varnholde Road')
        expect(prompt.startsWith('CREATE ONE PRIVATE TOPOLOGY\nExact site root: Varnholde Crypts\nEntrance area: Broken Gate\nEntrance knowledge: VISITED\nKind: DUNGEON')).toBe(true)
        expect(prompt).toContain('Scale: SMALL\nThreat: HIGH')
        expect(prompt).toContain(ARGS.prompt)
        expect(prompt).toContain('Live location footer: Varnholde Road')
        expect(prompt).toContain('RECENT STORY CONTEXT\nPLAYER: We go in.')
        expect(prompt).toContain('USER-SELECTED REFERENCE CONTEXT\n(none selected)')
        expect(buildTopologyPrompt(ARGS, '', '')).toContain('(No additional recent context.)')
        const correction = buildTopologyCorrectionPrompt(ARGS, '', '{bad', 'Invalid JSON: x', [], 1)
        expect(correction.startsWith('TOPOLOGY CORRECTION PASS 1')).toBe(true)
        expect(correction).toContain('INVALID_JSON')
        expect(DEFAULT_MAP_ARCHITECT_TOPOLOGY_SYSTEM_PROMPT.startsWith('You are the Map Architect\'s topology specialist.')).toBe(true)
        expect(DEFAULT_MAP_ARCHITECT_SYSTEM_PROMPT.startsWith('You are the Map Architect\'s content-placement specialist.')).toBe(true)
    })

    it('locks a valid topology, and names what is wrong with an invalid one', () => {
        const good = validateTopology(JSON.stringify(TOPOLOGY), ARGS)
        expect(good.issues).toEqual([])
        expect(good.topology?.areas.map((a) => a.id)).toEqual(['broken-gate', 'drowned-nave', 'ossuary', 'reliquary', 'stair'])
        expect(good.topology?.assets).toEqual([])
        const fenced = validateTopology('Here it is:\n```json\n' + JSON.stringify(TOPOLOGY) + '\n```', ARGS)
        expect(fenced.topology).not.toBeNull()
        const wrongSite = validateTopology(JSON.stringify({ ...TOPOLOGY, site: 'Somewhere Else' }), ARGS)
        expect(wrongSite.topology).toBeNull()
        expect(wrongSite.issues.map((i) => i.code)).toContain('SITE_MISMATCH')
        const extra = validateTopology(JSON.stringify({ ...TOPOLOGY, assets: [] }), ARGS)
        expect(extra.issues.map((i) => i.code)).toContain('UNKNOWN_FIELD')
        const broken = validateTopology('{"version":3,"areas":[', ARGS)
        expect(broken.issues).toEqual([{ code: 'INVALID_JSON', path: '$', hint: expect.stringMatching(/incomplete|Invalid JSON/i) }])
        expect(broken.parseError).toBeTruthy()
        // A missing reverse passage is mirrored before validation; a conflicting one is not.
        const oneWay = JSON.parse(JSON.stringify(TOPOLOGY)) as typeof TOPOLOGY
        oneWay.areas[4]!.connections = []
        expect(validateTopology(JSON.stringify(oneWay), ARGS).topology?.areas[4]?.connections).toEqual([{ to: 'ossuary', state: 'OPEN', detail: 'A worn spiral stair' }])
        expect(describeIssues(wrongSite.issues)).toContain('SITE_MISMATCH at $.site')
    })

    it('frames the contents prompt on the locked topology and the time, and places valid assets or says why not', () => {
        const topology = validateTopology(JSON.stringify(TOPOLOGY), ARGS).topology as MapDocument
        const prompt = buildAssetsPrompt(ARGS, topology, 'NARRATOR: Water drips.', '09:00 AM, Day 5')
        expect(prompt.startsWith('POPULATE ONE LOCKED PRIVATE MAP\nExact site root: Varnholde Crypts\nKind: DUNGEON')).toBe(true)
        expect(prompt).toContain('Current in-world time (authoritative): 09:00 AM, Day 5')
        expect(prompt).toContain('"id": "drowned-nave"')
        expect(prompt).not.toContain('"assets": [')
        expect(prompt.trimEnd().endsWith('Output exactly {"assets":[...]} and nothing else.')).toBe(true)
        expect(buildAssetsPrompt(ARGS, topology, '', '')).toContain('Current in-world time (authoritative): Unknown')
        const placed = validateAssets(JSON.stringify(ASSETS), topology, ARGS)
        expect(placed.issues).toEqual([])
        expect(placed.document?.assets.map((a) => a.id)).toEqual(['ghoul-pack', 'wax-seal', 'reliquary-chest', 'collapse'])
        expect(placed.document?.areas).toHaveLength(5)
        const lost = validateAssets(JSON.stringify({ assets: [{ ...ASSETS.assets[0], location: 'nowhere' }] }), topology, ARGS)
        expect(lost.document).toBeNull()
        expect(lost.issues.length).toBeGreaterThan(0)
        const envelope = validateAssets(JSON.stringify({ assets: [], areas: [] }), topology, ARGS)
        expect(envelope.issues.map((i) => i.code)).toContain('UNKNOWN_FIELD')
        const correction = buildAssetsCorrectionPrompt(ARGS, topology, '', '{"assets":[', 'Invalid JSON: x', [], 2, '')
        expect(correction.startsWith('CONTENT CORRECTION PASS 2')).toBe(true)
        expect(parseArchitectResponse('nothing here').error).toBe('No JSON object was found.')
    })

    it('writes the root entry\'s brief and the narrator\'s result', () => {
        expect(rootEntryCore('Varnholde Crypts', ' A flooded crypt. ')).toBe('[CORE]\nA flooded crypt.\n[/CORE]')
        expect(rootEntryCore('Varnholde Crypts', '')).toBe('[CORE]\nVarnholde Crypts is a mapped site. Its private map stores current objective reality; child Location entries preserve player-observable history.\n[/CORE]')
        const topology = validateTopology(JSON.stringify(TOPOLOGY), ARGS).topology as MapDocument
        const document = validateAssets(JSON.stringify(ASSETS), topology, ARGS).document as MapDocument
        const result = architectResult('Map saved to Vell_LOC::7.', document, ARGS)
        expect(result.startsWith('[MAP_ARCHITECT_RESULT — PRIVATE]\nMap saved to Vell_LOC::7.\nTreat this as objective current canon. Do not expose unseen facts.\n\nDungeon Site: Varnholde Crypts')).toBe(true)
        expect(result).toContain('Ghoul Pack ×4')
        expect(result).toContain('Continue narration from Broken Gate; reveal only what the player can perceive. Once they enter, copy this exact site name into the Location footer: "Varnholde Crypts".')
        expect(result.trimEnd().endsWith('[/MAP_ARCHITECT_RESULT]')).toBe(true)
    })

    it('tells the narrator a map is being drawn, holds it to the entrance, and says where the map will be (34a-bis)', () => {
        const ack = architectAcknowledgement(ARGS)
        expect(ack.startsWith('[MAP_ARCHITECT_RESULT — PRIVATE]\nThe Map Architect is drawing "Varnholde Crypts" (DUNGEON) now.')).toBe(true)
        expect(ack).toContain('listed in [MAPPED_SITES — INTERNAL] from the next turn')
        expect(ack).toContain('Narrate only up to and including the entrance, Broken Gate')
        expect(ack).toContain('Do not invent the layout, occupants or contents beyond the entrance')
        expect(ack).toContain('copy this exact site name into the Location footer: "Varnholde Crypts"')
        expect(ack).toContain('Do not call CreateAreaMap again for this site.')
        expect(ack.trimEnd().endsWith('[/MAP_ARCHITECT_RESULT]')).toBe(true)
    })
})

describe('the text opener (46)', () => {
    const BLOCK = '[CREATE_AREA_MAP]\nsite: Cellar Crypt\nentrance: Crypt Threshold\nkind: dungeon\nscale: small to medium\nthreat: HIGH\nprompt: A funerary complex.\nStill the prompt.\nbrief_description: A sealed crypt.\n[/CREATE_AREA_MAP]'

    it('reads the block the legacy way: keyed lines, a multi-line prompt, the kind and scale normalised, the prose before it kept', () => {
        const parsed = parseCreateAreaMapCommand(`The door yawns.\n\n${BLOCK}\n<choices>\n1. In\n</choices>`)!
        expect(parsed.args).toEqual({ site: 'Cellar Crypt', entrance: 'Crypt Threshold', prompt: 'A funerary complex.\nStill the prompt.', brief_description: 'A sealed crypt.', kind: 'DUNGEON', scale: 'MEDIUM', threat: 'HIGH' })
        expect(parsed.preamble).toBe('The door yawns.')
        expect(parsed.raw).toBe(BLOCK)
        expect(createAreaMapCommandIsComplete(parsed.args)).toBe(true)
        expect(createAreaMapCommandIsComplete(parseCreateAreaMapCommand('[CREATE_AREA_MAP]\nsite: X\n[/CREATE_AREA_MAP]')!.args)).toBe(false)
        expect(parseCreateAreaMapCommand('No block here.')).toBeNull()
        // HTML-escaped brackets and tags around the block, as a host may render them.
        expect(parseCreateAreaMapCommand('<p>&#91;CREATE_AREA_MAP&#93;</p><p>site: Vault</p><p>entrance: Gate</p><p>kind: INTERIOR</p><p>prompt: p</p><p>&#91;/CREATE_AREA_MAP&#93;</p>')!.args.site).toBe('Vault')
        // A JSON body is read too.
        expect(parseCreateAreaMapCommand('[CREATE_AREA_MAP]\n{"site":"Vault","entrance":"Gate","kind":"INTERIOR","prompt":"p","brief_description":"b"}\n[/CREATE_AREA_MAP]')!.args).toMatchObject({ site: 'Vault', kind: 'INTERIOR', scale: 'MEDIUM' })
    })

    it('strips the block and everything after it, leaving a zero-width stub when nothing came before', () => {
        expect(stripCreateAreaMapCommand(`Before.\n${BLOCK}\nAfter.`)).toMatchObject({ text: 'Before.' })
        expect(stripCreateAreaMapCommand(BLOCK).text).toBe('\u200b')
        expect(stripCreateAreaMapCommand('Nothing.')).toEqual({ text: 'Nothing.', command: null })
    })

    it('reads the setting, briefs from the entrance, and puts the CYOA exception in front of the block', () => {
        expect(normalizeMapArchitectOpener('text')).toBe('text')
        expect(normalizeMapArchitectOpener(' TEXT ')).toBe('text')
        expect(normalizeMapArchitectOpener('tool')).toBe('tool')
        expect(normalizeMapArchitectOpener(undefined)).toBe('tool')
        expect(isTextOpener({ mapArchitectOpener: 'text' })).toBe(true)
        expect(isTextOpener({})).toBe(false)
        expect(isTextOpener(null)).toBe(false)
        expect(textOpenerBrief({ entrance: 'Crypt Threshold' })).toContain('Write only in-world narration from Crypt Threshold.')
        expect(textOpenerBrief({})).toContain('from the entrance.')
        const block = '<CYOA_mode>\nAlways end with choices.\n</CYOA_mode>'
        const caveated = applyTextOpenerCyoaCaveat(block)
        expect(caveated.startsWith(`<CYOA_mode>\n[MAP OPENER EXCEPTION]\n${MAP_ARCHITECT_TEXT_OPENER_CYOA_CAVEAT}\n\nAlways end with choices.`)).toBe(true)
        expect(applyTextOpenerCyoaCaveat(caveated)).toBe(caveated)
        expect(MAP_ARCHITECT_TEXT_OPENER_RULES).toContain('Use these exact field names')
        expect(MAP_ARCHITECT_TEXT_OPENER_RULES).toContain(MAP_ARCHITECT_TEXT_OPENER_CYOA_CAVEAT)
    })
})
