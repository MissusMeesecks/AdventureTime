import { describe, expect, it } from 'vitest'

import { UNDERCROFT } from './map.test.js'
import { appendThreads, threadsFromTransaction, type ThreadsBySite } from './updater.js'
import { CRYPT, TOWN } from './updater.test.js'
import {
    activeSite,
    appendBacklogEntry,
    applyDigests,
    buildCompressionRequest,
    buildEvolutionCorrectionPrompt,
    buildEvolutionPrompt,
    buildEvolutionSystemPrompt,
    buildReportOutcomes,
    checkEvolutionReply,
    DEFAULT_MAP_EVOLUTION_COMPRESS_SYSTEM_PROMPT,
    DEFAULT_MAP_EVOLUTION_DIRECT_SYSTEM_PROMPT,
    DEFAULT_MAP_EVOLUTION_SYSTEM_PROMPT,
    collectArcSubjects,
    describeAssetArc,
    describeMemoryUsage,
    describeBacklog,
    describeEvolutionIssues,
    getSiteIntervalOverride,
    MAX_MAP_EVOLUTION_THREADS,
    replaceMemoCurrentTime,
    setSiteIntervalOverride,
    describeThreads,
    describeTimeWindow,
    filterSitesByRoots,
    lastFiredMinutes,
    narratorSiteActivity,
    normalizeScope,
    parseCompressionDigests,
    parseInWorldMinutes,
    partyIsAt,
    pendingReportsForSite,
    pickSitesForTick,
    resolvePlayerBubble,
    resolveSiteIntervalHours,
    siteDue,
    stampLastFired,
    stampReportOutcomes,
    summarizeDigest,
    summarizeSchedule,
    worldReportsFromEntries,
    type EvolutionPromptContext,
    type EvolutionSite,
    formatRecentStory,
    normalizeStoryLookback,
    DEFAULT_MAP_EVOLUTION_LOOKBACK,
} from './evolution.js'

const SITES: EvolutionSite[] = [
    { siteRoot: 'Abbey Undercroft', document: UNDERCROFT },
    { siteRoot: 'Varnholde Crypts', document: CRYPT },
    { siteRoot: 'Elmridge', document: TOWN },
]
const DAY5 = '09:00 AM, Day 5'

describe('the clocks', () => {
    it('reads an in-world label as minutes only when it carries a date or a time, and describes the window since a site last evolved', () => {
        expect(parseInWorldMinutes('04:40 AM, Day 2')).toBe(parseInWorldMinutes('Day 2, 4:40 AM'))
        expect(parseInWorldMinutes('Day 3')).toBeGreaterThan(parseInWorldMinutes('Day 2'))
        expect(parseInWorldMinutes('a quiet morning')).toBe(-1)
        expect(parseInWorldMinutes('')).toBe(-1)
        expect(describeTimeWindow('', DAY5)).toMatchObject({ lastEvolved: 'Never', elapsedMinutes: -1, elapsed: expect.stringContaining('no Last Evolved baseline') })
        expect(describeTimeWindow('08:00 AM, Day 5', 'nothing')).toMatchObject({ elapsedMinutes: -1, elapsed: expect.stringContaining('could not be parsed') })
        expect(describeTimeWindow('10:00 AM, Day 5', DAY5)).toMatchObject({ elapsedMinutes: -1, elapsed: expect.stringContaining('precedes Last Evolved') })
        expect(describeTimeWindow('08:30 AM, Day 4', DAY5)).toEqual({ lastEvolved: '08:30 AM, Day 4', currentTime: DAY5, elapsedMinutes: 1470, elapsed: '1 day, 30 minutes (1470 in-world minutes total)' })
    })

    it('fires on the interval after a first baseline, with the on-site interval while the party is there', () => {
        expect(siteDue(-1, 100, 12)).toEqual({ due: false, baseline: true })
        expect(siteDue(100, -1, 12)).toEqual({ due: false, baseline: false })
        expect(siteDue(100, 100 + 12 * 60, 12)).toEqual({ due: true, baseline: false })
        expect(siteDue(100, 100 + 12 * 60 - 1, 12)).toEqual({ due: false, baseline: false })
        expect(siteDue(100, 9999, 0)).toEqual({ due: false, baseline: false })
        const settings = { intervalHours: 12, onSiteIntervalHours: 1, onSiteIntervalMinutes: 30 }
        expect(resolveSiteIntervalHours('Elmridge', settings, 'Elmridge')).toBe(1.5)
        expect(resolveSiteIntervalHours('Abbey Undercroft', settings, 'Elmridge')).toBe(12)
        expect(resolveSiteIntervalHours('Elmridge', { ...settings, onSiteIntervalHours: 0, onSiteIntervalMinutes: 0 }, 'Elmridge')).toBe(0)
        expect(resolveSiteIntervalHours('X', { intervalHours: 999, onSiteIntervalHours: 1, onSiteIntervalMinutes: 0 }, '')).toBe(168)
        // A site's own hours (71d) win over both dials, 0 included; the key is the loose label.
        const own = setSiteIntervalOverride(undefined, 'The Elmridge', 3)
        expect(own).toEqual({ elmridge: 3 })
        expect(resolveSiteIntervalHours('Elmridge', { ...settings, intervalHoursBySite: own }, 'Elmridge')).toBe(3)
        expect(resolveSiteIntervalHours('Elmridge', { ...settings, intervalHoursBySite: setSiteIntervalOverride(own, 'elmridge', 0) }, '')).toBe(0)
        expect(getSiteIntervalOverride(own, 'elmridge')).toBe(3)
        expect(getSiteIntervalOverride(own, 'Abbey')).toBeNull()
        expect(setSiteIntervalOverride(own, 'Elmridge', null)).toEqual({})
        expect(setSiteIntervalOverride(own, 'Elmridge', '')).toEqual({})
        expect(setSiteIntervalOverride(own, 'Elmridge', 500)).toEqual({ elmridge: 168 })
        expect(setSiteIntervalOverride({ elmridge: -4, '': 2 }, 'X', 1)).toEqual({ x: 1 })
        const stamped = stampLastFired(undefined, ['Abbey Undercroft', 'The Abbey Undercroft'], DAY5)
        expect(stamped).toEqual({ 'abbey undercroft': DAY5 })
        expect(lastFiredMinutes(stamped, 'abbey undercroft')).toBe(parseInWorldMinutes(DAY5))
        expect(lastFiredMinutes(stamped, 'Elmridge')).toBe(-1)
        const schedule = summarizeSchedule(stamped, { intervalHoursFor: () => 12, currentMinutes: parseInWorldMinutes(DAY5) })
        expect(schedule).toEqual({ lastMins: parseInWorldMinutes(DAY5), nextMins: parseInWorldMinutes(DAY5) + 12 * 60 })
        expect(summarizeSchedule({}, { intervalHoursFor: () => 12, currentMinutes: 600 })).toEqual({ lastMins: -1, nextMins: 600 + 720 })
    })
})

const MOVE = { operation_id: 'evo-1', operations: [{ op: 'MOVE_ASSET', evidence: 'EVOLVED', asset_id: 'pack', from: 'crypt', to: 'landing', detail: 'Sniffing at the door.', cause: 'Drawn by the lantern light.', actor: 'pack', thread_status: 'open' }] }

describe('the Testing Ground\'s pieces (71d)', () => {
    it('replaces the memo\'s clock line, keeping the rest line, or adds a [TIME] block to a memo without one', () => {
        expect(replaceMemoCurrentTime('[TIME]\nTime: 09:00 AM, Day 5\nLast rest: Day 4\n[/TIME]\n[PARTY]\nx\n[/PARTY]', 'Day 6, 10:00 AM')).toBe('[TIME]\nDay 6, 10:00 AM\nLast rest: Day 4\n[/TIME]\n[PARTY]\nx\n[/PARTY]')
        expect(replaceMemoCurrentTime('[TIME]\nLast rest: Day 4\n[/TIME]', 'Day 6')).toBe('[TIME]\nDay 6\nLast rest: Day 4\n[/TIME]')
        expect(replaceMemoCurrentTime('[PARTY]\nx\n[/PARTY]', 'Day 6')).toBe('[PARTY]\nx\n[/PARTY]\n\n[TIME]\nDay 6\n[/TIME]\n')
        expect(replaceMemoCurrentTime('', 'Day 6')).toBe('[TIME]\nDay 6\n[/TIME]\n')
        expect(replaceMemoCurrentTime('[TIME]\nDay 5\n[/TIME]', '')).toBe('[TIME]\nDay 5\n[/TIME]')
    })

    it('measures a site\'s stored memory, lists the subjects an operator may follow, and follows one through its events', () => {
        const threads: ThreadsBySite = appendThreads(undefined, 'Abbey Undercroft', threadsFromTransaction(MOVE, { at: 'Day 6', createdAssets: [] }))
        const memory = describeMemoryUsage(threads, { 'abbey undercroft': [{ kind: 'commit', at: 'Day 6', elapsedMinutes: 60, operationId: 'evo-1', summary: 'Abbey Undercroft: pack moved to landing' }] }, 'Abbey Undercroft', { threshold: 10000, compressEnabled: true })
        expect(memory).toMatchObject({ entryCount: 1, openCount: 1, backlogCount: 1, threshold: 10000, compressEnabled: true, overThreshold: false, digestCount: 0 })
        expect(memory.threadText).toContain('OPEN pack by pack: Drawn by the lantern light.')
        expect(memory.backlogText).toContain('pack moved to landing')
        expect(memory.totalTokens).toBe(memory.threadTokens + memory.backlogTokens)
        const subjects = collectArcSubjects(memory.storedThreads, UNDERCROFT)
        // The live ones first, by name, then the dead, then the off-map.
        expect(subjects.map((s) => s.id)).toEqual(['pack', 'lantern', 'ghoul'])
        expect(subjects[0]).toMatchObject({ id: 'pack', name: 'Crawling Dead Pack', kind: 'GROUP', onMap: true, eventCount: 1, open: true })
        const arc = describeAssetArc(memory.storedThreads, 'pack', { storedBacklog: memory.storedBacklog, document: UNDERCROFT })
        expect(arc).toMatchObject({ subjectId: 'pack', name: 'Crawling Dead Pack', onMap: true, open: true })
        expect(arc.events.map((e) => e.role)).toEqual(['subject'])
        expect(arc.backlogHits.map((b) => b.summary)).toEqual(['Abbey Undercroft: pack moved to landing'])
        expect(describeAssetArc(memory.storedThreads, 'nobody', { storedBacklog: [], document: UNDERCROFT })).toMatchObject({ onMap: false, open: false, events: [], backlogHits: [] })
        expect(describeThreads(threads, 'Abbey Undercroft', { lookback: MAX_MAP_EVOLUTION_THREADS }).entries).toHaveLength(1)
    })
})

describe('the sites', () => {
    it('finds the site the party is in, the bubble to freeze, and which sites a tick stamps or evolves', () => {
        expect(activeSite(SITES, 'Abbey Undercroft, Cellar Landing')?.siteRoot).toBe('Abbey Undercroft')
        expect(activeSite(SITES, 'Nowhere')).toBeNull()
        // A footer that names only an area still finds the site whose map holds it.
        expect(activeSite(SITES, 'Cellar Landing')?.siteRoot).toBe('Abbey Undercroft')
        expect(partyIsAt(SITES[2]!, 'Elmridge, Main Street')).toBe(true)
        expect(partyIsAt(SITES[2]!, 'Abbey Road')).toBe(false)
        expect(resolvePlayerBubble(UNDERCROFT, 'Abbey Undercroft, Crypt Passage', true)).toEqual({ frozenAreaIds: ['crypt'], combatActive: true, area: expect.objectContaining({ id: 'crypt', name: 'Crypt Passage' }) })
        expect(resolvePlayerBubble(UNDERCROFT, 'Elsewhere', false)).toEqual({ frozenAreaIds: [], combatActive: false, area: null })
        const now = parseInWorldMinutes(DAY5)
        const fired: Record<string, number> = { 'abbey undercroft': now - 13 * 60, 'varnholde crypts': now - 60 }
        const base = { count: 1, randomize: false, selectedRoots: [], currentRoot: 'Elmridge', lastFiredMinutesFor: (root: string) => fired[root.toLowerCase()] ?? -1, currentMinutes: now, intervalHoursFor: (root: string) => (root === 'Elmridge' ? 1 : 12) }
        const all = pickSitesForTick(SITES, { ...base, scope: 'all' })
        expect(all.baseline.map((s) => s.siteRoot)).toEqual(['Elmridge'])
        expect(all.baseline[0]?.stampBaselineOnly).toBe(true)
        expect(all.due.map((s) => s.siteRoot)).toEqual(['Abbey Undercroft'])
        expect(pickSitesForTick(SITES, { ...base, scope: 'active' }).pool.map((s) => s.siteRoot)).toEqual(['Elmridge'])
        expect(pickSitesForTick(SITES, { ...base, scope: 'selected', selectedRoots: ['varnholde crypts'] }).pool.map((s) => s.siteRoot)).toEqual(['Varnholde Crypts'])
        const counted = pickSitesForTick(SITES, { ...base, scope: 'count', count: 1, lastFiredMinutesFor: () => now - 24 * 60 })
        expect(counted.due).toHaveLength(1)
        expect(pickSitesForTick(SITES, { ...base, scope: 'count', count: 0, lastFiredMinutesFor: () => now - 24 * 60 }).due).toHaveLength(3)
        expect(normalizeScope('SELECTED')).toBe('selected')
        expect(normalizeScope('nonsense')).toBe('all')
        expect(filterSitesByRoots(SITES, ['The Abbey Undercroft', 'nowhere']).map((s) => s.siteRoot)).toEqual(['Abbey Undercroft'])
    })
})

describe('the backlog and the threads', () => {
    it('keeps a bounded ledger per site, merging quiet checkpoints and keeping a commit once, and describes the trajectory', () => {
        let backlog = appendBacklogEntry(undefined, 'Abbey Undercroft', { kind: 'quiet', at: 'Day 4, 08:00 AM', elapsedMinutes: 60, summary: 'nothing' })
        backlog = appendBacklogEntry(backlog, 'Abbey Undercroft', { kind: 'quiet', at: 'Day 4, 09:00 AM', elapsedMinutes: 60, summary: 'nothing' })
        expect(backlog['abbey undercroft']).toHaveLength(1)
        expect(backlog['abbey undercroft']![0]).toMatchObject({ kind: 'quiet', elapsedMinutes: 120, passes: 2, summary: '2 consecutive Map Evolution passes committed no material change.' })
        backlog = appendBacklogEntry(backlog, 'Abbey Undercroft', { kind: 'commit', at: 'Day 4, 10:00 PM', elapsedMinutes: 780, operationId: 'evo-1', summary: 'Abbey Undercroft: pack moved to vault' })
        backlog = appendBacklogEntry(backlog, 'Abbey Undercroft', { kind: 'commit', at: 'Day 4, 10:00 PM', elapsedMinutes: 780, operationId: 'evo-1', summary: 'again' })
        expect(backlog['abbey undercroft']).toHaveLength(2)
        const described = describeBacklog(backlog, 'Abbey Undercroft', 660)
        expect(described.entries).toHaveLength(2)
        expect(described.representedMinutes).toBe(120 + 780 + 660)
        expect(described.quietMinutes).toBe(660)
        expect(described.quietElapsed).toBe('11 hours (660 in-world minutes total)')
        expect(describeBacklog(undefined, 'Nowhere', -1)).toMatchObject({ entries: [], representedElapsed: 'Unknown', quietElapsed: 'Unknown' })
        let threads: ThreadsBySite = appendThreads(undefined, 'Abbey Undercroft', threadsFromTransaction({ operation_id: 'evo-1', operations: [{ op: 'MOVE_ASSET', asset_id: 'pack', to: 'vault', cause: 'Hunting.', thread_status: 'open' }] }, { at: 'Day 4', createdAssets: [] }))
        threads = appendThreads(threads, 'Abbey Undercroft', threadsFromTransaction({ operation_id: 'evo-2', operations: [{ op: 'SET_ASSET', asset_id: 'ghoul', state: 'DESTROYED', actor: 'pack', cause: 'Torn apart.', thread_status: 'resolved' }] }, { at: 'Day 5', createdAssets: [] }))
        const described2 = describeThreads(threads, 'Abbey Undercroft')
        expect(described2.open.map((t) => t.subjectId)).toEqual(['pack'])
        expect(described2.entries).toHaveLength(2)
        expect(described2.truncated).toBe(false)
    })
})

describe('the world\'s pressure', () => {
    const ENTRIES = [
        { uid: '3', comment: 'Day 3, 09:00 AM', key: ['world progression'], content: '## Abbey Undercroft\nThe dead stir.\n\n## Wider Currents\nA cold wind.', extensions: { rpgWorldProgression: { reportId: 'W::3', periodLabel: 'Day 3, 09:00 AM', selectedLocations: ['Abbey Undercroft'] } }, createdAt: 3 },
        { uid: '4', comment: 'Days 1-3 condensed', key: ['world progression'], content: 'old', extensions: {}, createdAt: 4 },
        { uid: '5', comment: 'Day 4, 09:00 AM', key: ['World Report'], content: '## Elmridge\nThe diner reopens.', extensions: {}, createdAt: 5 },
        { uid: '6', comment: 'A note', key: [], content: 'not a report', extensions: {}, createdAt: 6 },
        { uid: '1', comment: 'Day 1, 09:00 AM', key: [], content: '## Wider Currents\nRain.', extensions: {}, createdAt: 1 },
    ]

    it('reads the reports out of the World book in filing order, skipping consolidations and notes, and finds the ones a site has not felt', () => {
        const reports = worldReportsFromEntries(ENTRIES, 'Vell_World')
        expect(reports.map((r) => r.reportId)).toEqual(['Vell_World::1', 'W::3', 'Vell_World::5'])
        expect(reports[1]).toMatchObject({ periodLabel: 'Day 3, 09:00 AM', selectedLocations: ['Abbey Undercroft'] })
        const pending = pendingReportsForSite(reports, 'Abbey Undercroft', { lookback: 5, applications: undefined })
        expect(pending.map((r) => r.reportId)).toEqual(['Vell_World::1', 'W::3'])
        expect(pending[1]?.excerpt).toBe('## Abbey Undercroft\nThe dead stir.\n\n## Wider Currents\nA cold wind.')
        expect(pending[0]?.excerpt).toBe('## Wider Currents\nRain.')
        const applied = stampReportOutcomes(undefined, 'Abbey Undercroft', [{ reportId: 'W::3', status: 'materialized', localDigest: 'd' }], 'Day 5')
        expect(applied).toEqual({ 'abbey undercroft': { 'W::3': { status: 'materialized', localDigest: 'd', consideredAt: 'Day 5' } } })
        expect(pendingReportsForSite(reports, 'Abbey Undercroft', { lookback: 5, applications: applied }).map((r) => r.reportId)).toEqual(['Vell_World::1'])
        expect(pendingReportsForSite(reports, 'Abbey Undercroft', { lookback: 1, applications: undefined }).map((r) => r.reportId)).toEqual(['W::3'])
        // Fifty outcomes are kept per site; the oldest go.
        let many = applied
        for (let i = 0; i < 60; i++) many = stampReportOutcomes(many, 'Abbey Undercroft', [{ reportId: `r${i}`, status: 'considered', localDigest: '' }], 'Day 6')
        expect(Object.keys(many['abbey undercroft']!)).toHaveLength(50)
        expect(many['abbey undercroft']!['W::3']).toBeUndefined()
    })

    it('stamps every supplied report from the model\'s outcomes, defaulting to considered, and lets a bare noop consume nothing', () => {
        const reports = worldReportsFromEntries(ENTRIES, 'B')
        expect(buildReportOutcomes([{ report_id: 'W::3', status: 'materialized' }, { report_id: 'x', status: 'nonsense' }], reports, { digest: 'd' })).toEqual([
            { reportId: 'B::1', status: 'considered', localDigest: 'd' },
            { reportId: 'W::3', status: 'materialized', localDigest: 'd' },
            { reportId: 'B::5', status: 'considered', localDigest: 'd' },
        ])
        expect(buildReportOutcomes(undefined, reports, { noop: true })).toEqual([])
        expect(buildReportOutcomes([{ report_id: 'W::3', status: 'already_realized_by_play' }], reports, { noop: true })).toHaveLength(3)
    })
})

function context(over: Partial<EvolutionPromptContext> = {}): EvolutionPromptContext {
    return {
        site: SITES[0]!, trigger: 'interval', worldReports: [], digest: '', bubble: { frozenAreaIds: [], combatActive: false, area: null }, currentLocation: 'Abbey Road', partyIsHere: false, onSitePreset: 'dynamic',
        timeWindow: describeTimeWindow('08:00 AM, Day 4', DAY5), backlog: describeBacklog(undefined, 'Abbey Undercroft', 1500), threads: describeThreads(undefined, 'Abbey Undercroft'), instruction: '',
        ...over,
    }
}

describe('the prompts', () => {
    it('appends the three contracts to the system prompt for a routine pass, and uses the compact prompt for an instruction', () => {
        expect(buildEvolutionSystemPrompt('', '').startsWith(DEFAULT_MAP_EVOLUTION_SYSTEM_PROMPT)).toBe(true)
        expect(buildEvolutionSystemPrompt('', '')).toContain('\n\nAUTHORITATIVE TIME-SCALE CONTRACT\n')
        expect(buildEvolutionSystemPrompt('', '')).toContain('AUTHORITATIVE CAUSAL THREAD CONTRACT')
        expect(buildEvolutionSystemPrompt('Mine.', '').startsWith('Mine.\n\nAUTHORITATIVE')).toBe(true)
        expect(buildEvolutionSystemPrompt('Mine.', 'Move the patrol.')).toBe(DEFAULT_MAP_EVOLUTION_DIRECT_SYSTEM_PROMPT)
    })

    it('frames the interval pass with the window, the backlog, the threads, the bubble, the map, the reports and the digest; the exit and direct passes differently', () => {
        const prompt = buildEvolutionPrompt(context({ worldReports: [{ reportId: 'W::3', periodLabel: 'Day 3', selectedLocations: [], content: 'c', excerpt: 'The dead stir.' }], digest: 'Elmridge: diner reopened' }))
        expect(prompt.startsWith('INTERVAL RESTLESSNESS\nExact site root: Abbey Undercroft\nKind: DUNGEON\nDUNGEON: restock and new occupants')).toBe(true)
        expect(prompt).toContain('## EVOLUTION TIME WINDOW (AUTHORITATIVE)\nLast Evolved for this site: 08:00 AM, Day 4\nCurrent in-world time: 09:00 AM, Day 5\nElapsed since Last Evolved: 1 day, 1 hour (1500 in-world minutes total)')
        expect(prompt).toContain('## ACCUMULATED EVOLUTION BACKLOG (THIS SITE)\nRecent trajectory represented, including the current gap: 1 day, 1 hour (1500 in-world minutes total)')
        expect(prompt).toContain('(No prior Map Evolution checkpoints are retained for this site.)')
        expect(prompt).toContain('## OPEN CAUSAL THREADS (THIS SITE)\nOpen threads (latest per subject):\n(No open causal threads are retained for this site.)')
        expect(prompt).toContain('## PLAYER BUBBLE (FROZEN)\n(Party is not inside this site. No freeze.)')
        expect(prompt).toContain('## CURRENT MAP\n')
        expect(prompt).toContain('pack | GROUP | Crawling Dead Pack')
        expect(prompt).toContain('## WORLD REPORT PRESSURES\n### Day 3 [report_id: W::3]\nThe dead stir.')
        expect(prompt).toContain('## PRIOR EVOLUTION THIS PERIOD\nElmridge: diner reopened')
        expect(prompt).not.toContain('LEVEL OF DETAIL')
        const onSite = buildEvolutionPrompt(context({ partyIsHere: true, currentLocation: 'Abbey Undercroft, Cellar Landing', bubble: resolvePlayerBubble(UNDERCROFT, 'Abbey Undercroft, Cellar Landing', true) }))
        expect(onSite).toContain('## PLAYER BUBBLE (FROZEN)\nlanding (Cellar Landing) — combat is active')
        expect(onSite).toContain('## LEVEL OF DETAIL — CURRENT MAP (TACTICAL AND FELT)')
        expect(buildEvolutionPrompt(context({ partyIsHere: true, onSitePreset: 'standard' }))).not.toContain('LEVEL OF DETAIL')
        expect(buildEvolutionPrompt(context({ trigger: 'site_exit' })).startsWith('SITE EXIT RESTOCK / DECAY')).toBe(true)
        const direct = buildEvolutionPrompt(context({ trigger: 'manual', instruction: 'Move the pack to the vault.' }))
        expect(direct.startsWith('MANUAL MAP EVOLUTION\nExact site root: Abbey Undercroft')).toBe(true)
        expect(direct).toContain('## DIRECT INSTRUCTION (THIS PASS ONLY)')
        expect(direct).not.toContain('WORLD REPORT PRESSURES')
        const correction = buildEvolutionCorrectionPrompt(context(), '{"bad":1}', [{ code: 'PLAYER_BUBBLE_FROZEN', path: 'map.operations[0]', hint: 'Leave it.' }], 2)
        expect(correction.startsWith('CORRECTION PASS 2')).toBe(true)
        expect(correction).toContain('"code": "PLAYER_BUBBLE_FROZEN"')
        expect(correction).toContain('PREVIOUS OUTPUT\n{"bad":1}')
        expect(correction).toContain('INTERVAL RESTLESSNESS\nExact site root')
    })
})

describe('the recent story (45c)', () => {
    const CHAT = [
        { role: 'system', content: 'host note' },
        { role: 'user', content: 'We ride for the abbey.' },
        { role: 'assistant', content: 'The road is empty.\n<choices>\n1. Go on\n</choices>' },
        { role: 'user', content: 'Through the gate.' },
        { role: 'assistant', content: '   ' },
        { role: 'assistant', content: 'The crypt yawns.' },
    ]

    it('shows the chat from the Nth user message back, Player and Narrator each on a line, choices stripped, blanks dropped', () => {
        expect(formatRecentStory(CHAT, 1)).toBe('Player: Through the gate.\n\nNarrator: The crypt yawns.')
        expect(formatRecentStory(CHAT, 2)).toBe('Player: We ride for the abbey.\n\nNarrator: The road is empty.\n\nPlayer: Through the gate.\n\nNarrator: The crypt yawns.')
        // Fewer user turns than asked: the whole chat, the host's system line left out.
        expect(formatRecentStory(CHAT, 50)).toBe(formatRecentStory(CHAT, 2))
    })

    it('is empty at a lookback of 0 or with nothing to show, and clamps as the legacy does', () => {
        expect(formatRecentStory(CHAT, 0)).toBe('')
        expect(formatRecentStory([], 20)).toBe('')
        expect(formatRecentStory([{ role: 'assistant', content: '<choices>\n1. x\n</choices>' }], 5)).toBe('')
        expect(normalizeStoryLookback(undefined)).toBe(DEFAULT_MAP_EVOLUTION_LOOKBACK)
        expect(DEFAULT_MAP_EVOLUTION_LOOKBACK).toBe(20)
        expect(normalizeStoryLookback(500)).toBe(100)
        expect(normalizeStoryLookback(-3)).toBe(0)
        expect(normalizeStoryLookback('7.9')).toBe(7)
    })

    it('goes into every prompt as the RECENT STORY block, which names its absence', () => {
        const story = 'Player: Through the gate.\n\nNarrator: The crypt yawns.'
        const prompt = buildEvolutionPrompt(context({ recentStory: story }))
        expect(prompt).toContain(`## RECENT STORY\n${story}\n`)
        expect(prompt).toContain('When present, it is global recent play')
        expect(buildEvolutionPrompt(context())).toContain('## RECENT STORY\n(None \u2014 lookback is 0 or chat is empty.)')
        expect(buildEvolutionPrompt(context({ trigger: 'manual', instruction: 'Move the pack.', recentStory: story }))).toContain(`## RECENT STORY\n${story}`)
        expect(buildEvolutionCorrectionPrompt(context({ recentStory: story }), '{}', [], 1)).toContain(`## RECENT STORY\n${story}`)
        // The stock prompt and the contract carry upstream's REMOVE_ASSET reading of a stale occupant.
        expect(DEFAULT_MAP_EVOLUTION_SYSTEM_PROMPT).toContain('stale ACTIVE occupancy contradicted by RECENT STORY')
        expect(buildEvolutionSystemPrompt('', '')).toContain('AUTHORITATIVE RECENT STORY CONTRACT')
    })
})

describe('the verdict', () => {
    const reports = [{ reportId: 'W::3', periodLabel: 'Day 3', selectedLocations: [], content: 'c', excerpt: 'e' }]
    const ctx = { document: UNDERCROFT, frozenAreaIds: ['landing'], currentTime: DAY5, worldReports: reports }

    it('applies EVOLVED operations with the bubble frozen and the dead left dead, strips the bookkeeping, and summarises the digest', () => {
        // The party is in the vault; the pack follows the open route crypt → landing.
        const reply = JSON.stringify({ operation_id: 'evo-day5-vault', operations: [
            { op: 'SET_AREA', evidence: 'EVOLVED', area_id: 'crypt', geometry_append: ['Gnawed bones litter the arch.'], cause: 'The pack fed here.' },
            { op: 'MOVE_ASSET', evidence: 'EVOLVED', asset_id: 'pack', from: 'crypt', to: 'landing', detail: 'Sniffing at the door.', cause: 'Drawn by the lantern light.', actor: 'pack', thread_status: 'open' },
            { op: 'ADD_ASSET', evidence: 'EVOLVED', name: 'Salt-Road Delvers', kind: 'GROUP', location: 'crypt', state: 'ACTIVE', knowledge: 'UNREVEALED', origin: 'MAP_EVOLUTION', count: 3, detail: 'Rival delvers.', cause: 'Came in after the pack left.' },
        ], report_outcomes: [{ report_id: 'W::3', status: 'materialized' }] })
        const verdict = checkEvolutionReply(reply, { ...ctx, frozenAreaIds: ['vault'] })
        expect(verdict.kind).toBe('applied')
        if (verdict.kind !== 'applied') return
        expect(verdict.transaction.report_outcomes).toBeUndefined()
        expect(verdict.applied.document.assets.find((a) => a.id === 'pack')?.location).toBe('landing')
        expect(verdict.applied.document.areas.find((a) => a.id === 'crypt')?.geometry).toContain('Gnawed bones litter the arch.')
        expect(verdict.applied.createdAssets).toEqual([{ id: 'salt-road-delvers', name: 'Salt-Road Delvers' }])
        expect(verdict.reportOutcomes).toEqual([{ reportId: 'W::3', status: 'materialized', localDigest: verdict.digest }])
        expect(verdict.digest).toBe('geometry crypt: The pack fed here.; pack moved to landing by pack: Drawn by the lantern light.; added Salt-Road Delvers in crypt: Came in after the pack left.')
        expect(summarizeDigest('x', { noop: true })).toBe('')
        expect(UNDERCROFT.assets.find((a) => a.id === 'pack')?.location).toBe('crypt')
    })

    it('honours a noop with and without bookkeeping, and rejects a touch on the bubble, a revival, a new area and bad JSON', () => {
        expect(checkEvolutionReply('{"noop":true}', ctx)).toEqual({ kind: 'noop', reportOutcomes: [] })
        expect(checkEvolutionReply('{"noop":true,"report_outcomes":[{"report_id":"W::3","status":"considered"}]}', ctx)).toEqual({ kind: 'noop', reportOutcomes: [{ reportId: 'W::3', status: 'considered', localDigest: '' }] })
        const frozen = checkEvolutionReply(JSON.stringify({ operation_id: 'evo-x', operations: [{ op: 'SET_ASSET', evidence: 'EVOLVED', asset_id: 'lantern', state: 'TAKEN', cause: 'c' }] }), ctx)
        expect(frozen).toMatchObject({ kind: 'rejected', issues: [{ code: 'PLAYER_BUBBLE_FROZEN' }] })
        const revived = checkEvolutionReply(JSON.stringify({ operation_id: 'evo-y', operations: [{ op: 'SET_ASSET', evidence: 'EVOLVED', asset_id: 'ghoul', state: 'ACTIVE', cause: 'c' }] }), ctx)
        expect(revived).toMatchObject({ kind: 'rejected', issues: [{ code: 'PLAY_CANON_LOCKED' }] })
        const area = checkEvolutionReply(JSON.stringify({ operation_id: 'evo-z', operations: [{ op: 'ADD_AREA', evidence: 'EVOLVED', name: 'New Hall', knowledge: 'UNREVEALED', cause: 'c' }] }), ctx)
        expect(area).toMatchObject({ kind: 'rejected', issues: [{ code: 'EVOLUTION_OP_NOT_ALLOWED' }] })
        expect(checkEvolutionReply('nope', ctx)).toMatchObject({ kind: 'rejected', issues: [{ code: 'INVALID_JSON' }] })
        expect(describeEvolutionIssues((frozen as { issues: Array<{ code: string; path: string; hint: string }> }).issues)).toMatch(/^PLAYER_BUBBLE_FROZEN at map\.operations\[0\]: /)
    })
})

describe('what the narrator and the compressor are told', () => {
    const threads = appendThreads(undefined, 'Abbey Undercroft', [
        ...threadsFromTransaction({ operation_id: 'evo-1', operations: [{ op: 'MOVE_ASSET', asset_id: 'pack', to: 'vault', cause: 'Drawn by the open door.', thread_status: 'open' }] }, { at: 'Day 4, 10:00 PM', createdAssets: [] }),
        ...threadsFromTransaction({ operation_id: 'evo-2', operations: [{ op: 'SET_ASSET', asset_id: 'ghoul', state: 'DESTROYED', actor: 'pack', cause: 'Torn apart over scraps.', thread_status: 'resolved' }, { op: 'SET_ASSET', asset_id: 'lantern', state: 'TAKEN', cause: 'Taken by delvers.', thread_status: 'resolved' }] }, { at: 'Day 5, 02:00 AM', createdAssets: [] }),
    ])
    const backlog = appendBacklogEntry(undefined, 'Abbey Undercroft', { kind: 'commit', at: 'Day 4, 10:00 PM', elapsedMinutes: 600, operationId: 'evo-1', summary: 'Abbey Undercroft: pack moved to vault by pack: Drawn by the open door.' })

    it('briefs the narrator on open threads, recent commits and digests, within a token cap, and says nothing when there is nothing', () => {
        expect(narratorSiteActivity(undefined, undefined, 'Abbey Undercroft', 2000)).toBe('')
        const briefing = narratorSiteActivity(threads, backlog, 'Abbey Undercroft', 2000)
        expect(briefing.startsWith('Use this to understand why occupancy looks this way.')).toBe(true)
        expect(briefing).toContain('Open causal threads (latest per subject):\n- Day 4, 10:00 PM — OPEN pack: Drawn by the open door.')
        expect(briefing).toContain('Recent material Evolution commits:\n- Day 4, 10:00 PM — pack moved to vault by pack: Drawn by the open door.')
        expect(briefing).not.toContain('Compressed history')
        expect(narratorSiteActivity(threads, backlog, 'Elmridge', 2000)).toBe('')
    })

    it('dates the briefing with the site\'s last pass when the clock has one, and never dates an empty one', () => {
        const clocks = stampLastFired(undefined, ['Abbey Undercroft', 'Elmridge'], 'Day 5, 09:52 AM')
        const dated = narratorSiteActivity(threads, backlog, 'Abbey Undercroft', 2000, clocks)
        expect(dated.startsWith('Last evolution pass: Day 5, 09:52 AM.\nUse this to understand why occupancy looks this way.')).toBe(true)
        expect(dated.slice(dated.indexOf('\n') + 1)).toBe(narratorSiteActivity(threads, backlog, 'Abbey Undercroft', 2000))
        expect(narratorSiteActivity(threads, backlog, 'Abbey Undercroft', 2000, {})).not.toContain('Last evolution pass')
        expect(narratorSiteActivity(threads, backlog, 'Elmridge', 2000, clocks)).toBe('')
    })

    it('compresses the closed history into digests once it is long enough, keeping the open threads whole', () => {
        // Two closed lines are far under the floor of five hundred tokens; eighty are not.
        expect(buildCompressionRequest(threads, 'Abbey Undercroft', 10000)).toBeNull()
        expect(buildCompressionRequest(threads, 'Abbey Undercroft', 1)).toBeNull()
        let long = threads
        for (let i = 0; i < 80; i++) long = appendThreads(long, 'Abbey Undercroft', threadsFromTransaction({ operation_id: `evo-${i + 10}`, operations: [{ op: 'SET_ASSET', asset_id: `visitor-${i}`, state: 'LEFT', cause: `Visitor ${i} came, argued with the delvers over the reliquary shelves, and went home to the salt road.`, thread_status: 'resolved' }] }, { at: `Day ${6 + i}`, createdAssets: [] }))
        expect(buildCompressionRequest(long, 'Abbey Undercroft', 100000)).toBeNull()
        const request = buildCompressionRequest(long, 'Abbey Undercroft', 1, '')!
        expect(request).not.toBeNull()
        expect(request.system).toBe(DEFAULT_MAP_EVOLUTION_COMPRESS_SYSTEM_PROMPT)
        expect(request.threshold).toBe(500)
        expect(request.tokens).toBeGreaterThanOrEqual(500)
        expect(request).toMatchObject({ open: 1, closed: 82 })
        expect(request.user.startsWith('SITE: Abbey Undercroft\n\nOPEN THREADS')).toBe(true)
        expect(request.user).toContain('- Day 4, 10:00 PM — OPEN pack: Drawn by the open door.')
        expect(request.user).toContain(`(${request.tokens} estimated tokens; threshold 500)`)
        expect(buildCompressionRequest(long, 'Abbey Undercroft', 1, 'Mine.')?.system).toBe('Mine.')
        expect(parseCompressionDigests('{"digests":[{"at":"Day 4 – Day 5","summary":"The pack took the vault; the ghoul died."},{"summary":""}]}')).toEqual({ ok: true, digests: [{ at: 'Day 4 – Day 5', summary: 'The pack took the vault; the ghoul died.' }] })
        expect(parseCompressionDigests('["a","b"]')).toEqual({ ok: true, digests: [{ at: 'Compressed history', summary: 'a' }, { at: 'Compressed history', summary: 'b' }] })
        expect(parseCompressionDigests('nope')).toMatchObject({ ok: false })
        expect(parseCompressionDigests('{"digests":[]}')).toEqual({ ok: false, error: 'No digests' })
        const compressed = applyDigests(threads, 'Abbey Undercroft', [{ at: 'Day 4 – Day 5', summary: 'The pack took the vault; the ghoul died.' }])
        const rows = compressed['abbey undercroft']!
        expect(rows.map((t) => [t.op, t.status, t.compressed])).toEqual([['DIGEST', 'transformed', true], ['MOVE_ASSET', 'open', false]])
        expect(narratorSiteActivity(compressed, backlog, 'Abbey Undercroft', 2000)).toContain('Compressed history still on the ledger:\n- Day 4 – Day 5 — DIGEST DIGEST: The pack took the vault; the ghoul died.')
        expect(applyDigests(threads, 'Abbey Undercroft', [])).toEqual(threads)
        expect(DEFAULT_MAP_EVOLUTION_COMPRESS_SYSTEM_PROMPT.startsWith('You are Map Evolution History Compression')).toBe(true)
    })
})
