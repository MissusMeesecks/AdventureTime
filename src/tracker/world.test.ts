import { describe, expect, it } from 'vitest'

import { FACTORY_CARTRIDGE_DEFAULTS } from '../state/factory-defaults.js'
import {
    buildLocationDossiers,
    buildSkeletonLorebookContext,
    buildSkeletonSystemPrompt,
    buildSkeletonUserPrompt,
    buildWorldSourceUserPrompt,
    buildWorldSystemPrompt,
    cleanWorldSource,
    buildWorldUserPrompt,
    consolidationPlan,
    countSkeleton,
    decideWorldPass,
    DEFAULT_WORLD_SKELETON_SYSTEM_PROMPT,
    describeSkeletonCounts,
    existingSkeletonPremises,
    findReportForPeriod,
    formatInWorldTime,
    historicalReportLines,
    isRawReport,
    isSkeletonBookName,
    isWorldBookName,
    isWorldProgressionBookName,
    parseSkeletonOutput,
    periodLabelFor,
    renderWorldReports,
    reportKeys,
    rollingWindow,
    skeletonEntry,
    skeletonLabel,
    sortReports,
    WORLD_INJECTION_HEADING,
    WORLD_SOURCE_SYSTEM_PROMPT,
} from './world.js'
import { LEGACY_BOOKS } from './world.pin.test.js'

const TEMPLATE = (FACTORY_CARTRIDGE_DEFAULTS as { worldProgressionSystemPrompt: string }).worldProgressionSystemPrompt
const memoAt = (time: string) => `[TIME]\nCurrent: ${time}\n[/TIME]\n[PARTY]\n- Robin\n[/PARTY]`

describe('when a pass is due', () => {
    it('cannot decide without a readable clock', () => {
        expect(decideWorldPass({ memo: '', lastFiredPeriodLabel: '', intervalHours: 24 })).toEqual({ kind: 'no-time' })
        expect(decideWorldPass({ memo: '[PARTY]\n- Robin\n[/PARTY]', lastFiredPeriodLabel: 'Day 1', intervalHours: 24 })).toEqual({ kind: 'no-time' })
        expect(decideWorldPass({ memo: memoAt('Not yet rested'), lastFiredPeriodLabel: '', intervalHours: 24 }).kind).toBe('no-time')
    })

    it('starts the clock on the first sighting rather than firing', () => {
        expect(decideWorldPass({ memo: memoAt('08:00 AM, Day 3'), lastFiredPeriodLabel: '', intervalHours: 24 })).toEqual({
            kind: 'start',
            label: 'Day 3, 08:00 AM',
            currentMinutes: 2 * 1440 + 8 * 60,
        })
    })

    it('waits inside the interval and fires once it has elapsed, naming the period', () => {
        const last = 'Day 3, 08:00 AM'
        expect(decideWorldPass({ memo: memoAt('07:59 AM, Day 4'), lastFiredPeriodLabel: last, intervalHours: 24 })).toEqual({
            kind: 'wait',
            currentMinutes: 3 * 1440 + 7 * 60 + 59,
            dueAtMinutes: 3 * 1440 + 8 * 60,
        })
        expect(decideWorldPass({ memo: memoAt('09:30 PM, Day 4'), lastFiredPeriodLabel: last, intervalHours: 24 })).toEqual({
            kind: 'due',
            currentMinutes: 3 * 1440 + 21 * 60 + 30,
            // The clock's line as the memo has it, the legacy's `timeStr`.
            timeStr: 'Current: 09:30 PM, Day 4',
            // The period ends one interval after the last one, not at "now".
            periodLabel: 'Day 4, 08:00 AM',
        })
    })

    it('honours the interval and the clock style', () => {
        expect(decideWorldPass({ memo: memoAt('14:00, Day 1'), lastFiredPeriodLabel: 'Day 1, 08:00', intervalHours: 6, settings: { use24hTime: true } })).toMatchObject({
            kind: 'due',
            periodLabel: 'Day 1, 14:00',
        })
        expect(decideWorldPass({ memo: memoAt('14:00, Day 1'), lastFiredPeriodLabel: 'Day 1, 08:00', intervalHours: 0 })).toMatchObject({ kind: 'wait' })
    })

    it('names a forced first period one interval back from now', () => {
        expect(periodLabelFor({ lastFiredPeriodLabel: '', currentMinutes: 2 * 1440 + 8 * 60, intervalHours: 24 })).toBe('Day 3, 08:00 AM')
        expect(periodLabelFor({ lastFiredPeriodLabel: 'Day 2, 08:00 AM', currentMinutes: 9 * 1440, intervalHours: 24 })).toBe('Day 3, 08:00 AM')
        expect(formatInWorldTime(-5)).toBe('Never')
    })
})

describe('the prompts', () => {
    it('substitutes the period, appends the contract always and the date rule when asked', () => {
        const plain = buildWorldSystemPrompt({ template: TEMPLATE, periodLabel: 'Day 4, 08:00 AM' })
        expect(plain).toContain('The report covers the in-world period: **Day 4, 08:00 AM**')
        expect(plain).not.toContain('{periodLabel}')
        expect(plain).toContain('## LOCATION-CENTRIC RUNTIME CONTRACT (AUTHORITATIVE)')
        expect(plain).not.toContain('## DATE FORMAT RULE')
        expect(plain).not.toContain('EXTRA INSTRUCTIONS')
        const dated = buildWorldSystemPrompt({ template: 'Write {wordTarget} words for {periodLabel}.', periodLabel: 'P', useDdMmYyFormat: true, extraInstructions: ' make it stormy ' })
        expect(dated.startsWith('Write 600 words for P.')).toBe(true)
        expect(dated).toContain('## DATE FORMAT RULE')
        expect(dated.indexOf('## DATE FORMAT RULE')).toBeLessThan(dated.indexOf('## LOCATION-CENTRIC'))
        expect(dated.endsWith('## EXTRA INSTRUCTIONS FOR THIS RUN\nmake it stormy')).toBe(true)
        // The contract goes on even over a customised prompt: it is an authority boundary.
        expect(buildWorldSystemPrompt({ template: 'mine', periodLabel: 'P' })).toContain('never individual NPCs')
    })

    it('lists the prior reports newest last, windowed when asked, skipping the empty', () => {
        const reports = [
            { comment: 'Day 1', content: 'one' },
            { comment: '', key: ['day 2'], content: 'two' },
            { comment: 'Day 3', content: '   ' },
            { comment: 'Day 4', content: 'four' },
        ]
        expect(historicalReportLines(reports)).toEqual(['### Day 1\none', '### day 2\ntwo', '### Day 4\nfour'])
        expect(historicalReportLines(reports, 2)).toEqual(['### Day 4\nfour'])
    })

    it('assembles the user prompt in the legacy order, with the fallbacks for an empty world', () => {
        const { dossiers, globalContext } = buildLocationDossiers(LEGACY_BOOKS, { prefix: 'Campaign' })
        const selected = dossiers.filter((d) => d.name !== 'Old Barrow')
        const user = buildWorldUserPrompt({ selected, globalContext, history: ['### Day 1\nHistorical report.'], recentNarrative: 'The gates close.', periodLabel: 'Day 2, 08:00 AM' })
        const order = ['## DESIGNATED LOCATIONS', '- Glassmere', '- Morrowfen', '## LOCATION DOSSIERS', '# Glassmere', '## WIDER-WORLD CONTEXT', 'Sun Court', '## HISTORICAL WORLD REPORTS', '### Day 1', '## RECENT NARRATIVE (Current Scene Context)', 'The gates close.', 'Write the World Progression report for **Day 2, 08:00 AM**']
        let at = -1
        for (const needle of order) {
            const next = user.indexOf(needle, at + 1)
            expect(next, needle).toBeGreaterThan(at)
            at = next
        }
        expect(user).not.toContain('[MAP]')

        const empty = buildWorldUserPrompt({ selected: [], globalContext: '', history: [], periodLabel: 'P' })
        expect(empty).toContain('(No recorded locations are available; write only Wider Currents.)')
        expect(empty).toContain('(No location dossiers available.)')
        expect(empty).toContain('(No wider-world context recorded.)')
        expect(empty).toContain('No prior World Progression reports.')
        expect(empty).not.toContain('RECENT NARRATIVE')
    })

    it('files a report under the legacy keys', () => {
        expect(reportKeys('Day 3, 08:00 AM')).toEqual(['world progression', 'world report', 'day 3, 08:00 am', 'day 3'])
        expect(reportKeys('05/01/2026, 08:00')).toEqual(['world progression', 'world report', '05/01/2026, 08:00'])
    })
})

describe('the archive', () => {
    const entries = [
        { id: 'e3', uid: '3', comment: 'Day 3, 08:00 AM', content: 'three' },
        { id: 'e1', uid: '1', comment: 'Day 1, 08:00 AM', content: 'one' },
        { id: 'e10', uid: '10', comment: 'Days 1–2', content: 'range' },
        { id: 'e2', uid: '2', comment: 'Day 2, 08:00 AM', content: 'two' },
    ]

    it('sorts by uid as a number, finds a period case-insensitively, and knows a world book by name', () => {
        expect(sortReports(entries).map((e) => e.uid)).toEqual(['1', '2', '3', '10'])
        // A host whose uids are slugs (lesson 40): the creation stamp decides, and
        // without one the period the label names does; a stamp outranks a number.
        const slugs = [
            { uid: 'day-3', comment: 'Day 3, 08:00 AM', content: '', createdAt: 300 },
            { uid: 'day-1', comment: 'Day 1, 08:00 AM', content: '', createdAt: 100 },
            { uid: 'days-1-2', comment: 'Days 1–2', content: '', createdAt: 250 },
            { uid: 'day-2', comment: 'Day 2, 08:00 AM', content: '', createdAt: 200 },
        ]
        expect(sortReports(slugs).map((e) => e.uid)).toEqual(['day-1', 'day-2', 'days-1-2', 'day-3'])
        const unstamped = slugs.map(({ createdAt: _c, ...rest }) => rest)
        expect(sortReports(unstamped).map((e) => e.uid)).toEqual(['days-1-2', 'day-1', 'day-2', 'day-3'])
        expect(sortReports([{ uid: '9', comment: 'x', createdAt: 1 }, { uid: '2', comment: 'y', createdAt: 2 }]).map((e) => e.uid)).toEqual(['9', '2'])
        expect(sortReports([{ uid: 'b', comment: '02/12/2026, 14:37' }, { uid: 'a', comment: '02/12/2026, 11:37' }]).map((e) => e.uid)).toEqual(['a', 'b'])
        expect(findReportForPeriod(entries, 'day 2, 08:00 am')?.id).toBe('e2')
        expect(findReportForPeriod(entries, 'Day 9')).toBeUndefined()
        expect(isWorldBookName('Vellmoor_World')).toBe(true)
        expect(isWorldBookName('world')).toBe(true)
        expect(isWorldBookName('Vellmoor_NPC')).toBe(false)
        expect(isRawReport('Day 2, 08:00 AM')).toBe(true)
        expect(isRawReport('Days 1–2')).toBe(false)
        expect(isRawReport('Day 2 (Condensed)')).toBe(false)
    })

    it('plans a consolidation only once enough raw reports have piled up, oldest first', () => {
        expect(consolidationPlan(entries, 7)).toBeNull()
        const plan = consolidationPlan(entries, 2)!
        expect(plan.toConsolidate.map((e) => e.uid)).toEqual(['1', '2'])
        expect(plan.label).toBe('Days 1–2')
        expect(plan.system).toContain('You are the World Archivist')
        expect(plan.system).toContain('[Days 1–2]')
        expect(plan.user).toContain('Compress the following 2 World Progression reports')
        expect(plan.user).toContain('### Day 1, 08:00 AM\none')
        // Two on one day condense rather than range.
        const sameDay = consolidationPlan([{ uid: '1', comment: 'Day 4, 08:00', content: 'a' }, { uid: '2', comment: 'Day 4, 20:00', content: 'b' }], 2)!
        expect(sameDay.label).toBe('Day 4 (Condensed)')
        // The floor is two; an unset interval is the legacy's seven.
        expect(consolidationPlan(entries, 1)!.toConsolidate).toHaveLength(2)
        expect(consolidationPlan(entries, 0)).toBeNull()
    })

    it('keeps the newest N active and the rest archived, never fewer than one', () => {
        const sorted = sortReports(entries)
        expect(rollingWindow(sorted, 1).active.map((e) => e.uid)).toEqual(['10'])
        expect(rollingWindow(sorted, 1).archived.map((e) => e.uid)).toEqual(['1', '2', '3'])
        expect(rollingWindow(sorted, 3).active.map((e) => e.uid)).toEqual(['2', '3', '10'])
        expect(rollingWindow(sorted, 0).active).toHaveLength(1)
        // Negative is "one", not a slice from the wrong end.
        expect(rollingWindow(sorted, -1)).toEqual({ active: [sorted[3]], archived: sorted.slice(0, 3) })
        expect(rollingWindow(sorted, 2.9).active).toHaveLength(2)
        expect(rollingWindow([], 2)).toEqual({ active: [], archived: [] })
    })

    it('renders the narrator\'s block as the legacy shaped it, or nothing', () => {
        expect(renderWorldReports([{ label: 'Day 2', content: ' two \n' }, { label: '', content: 'x' }, { label: 'Day 4', content: '  ' }]))
            .toBe(`${WORLD_INJECTION_HEADING}\n### [Day 2]\ntwo\n\n### [World Report]\nx`)
        expect(renderWorldReports([])).toBe('')
    })
})

describe('the skeleton', () => {
    const REPLY = [
        '## FACTIONS',
        '### The Salt Compact',
        'A guild of shipping magnates.',
        'They tax every quay.',
        '',
        '## LOCATIONS',
        '- **Morrowfen**: A tidal trade town.',
        '- **Glassmere** - A lake settlement.',
        '',
        '## CONFLICTS',
        '### The Tithe War',
        'Two guilds dispute the quay tax.',
        'Parties involved: the Compact and the wards.',
        '',
        '## NPCS',
        '### Captain Ilyra',
        'Never a skeleton entry.',
    ].join('\n')

    it('knows a skeleton book by name, and what World Progression owns', () => {
        expect(isSkeletonBookName('Vell_Skeleton')).toBe(true)
        expect(isSkeletonBookName('vell_skeleton')).toBe(true)
        expect(isSkeletonBookName('Vell_World')).toBe(false)
        expect(isSkeletonBookName('Skeleton')).toBe(false)
        expect(isWorldProgressionBookName('Vell_World')).toBe(true)
        expect(isWorldProgressionBookName('Vell_Skeleton')).toBe(true)
        expect(isWorldProgressionBookName('Vell_LOC')).toBe(false)
    })

    it('substitutes the counts into the stock prompt or the user\'s, and appends the contracts', () => {
        const stock = buildSkeletonSystemPrompt({ factions: 4, locations: 5, conflicts: 3 })
        expect(stock.startsWith(DEFAULT_WORLD_SKELETON_SYSTEM_PROMPT.replace(/\{factionCount\}/g, '4').replace(/\{locationCount\}/g, '5').replace(/\{conflictCount\}/g, '3'))).toBe(true)
        expect(stock).not.toContain('{factionCount}')
        expect(stock).toContain('## MACRO-ONLY SKELETON CONTRACT (AUTHORITATIVE)')
        expect(stock).not.toContain('LOREBOOK-ONLY MODE')
        // The user's own text, blank meaning the stock, and the override only when asked.
        const own = buildSkeletonSystemPrompt({ template: 'Make {factionCount} factions.', factions: 2, locations: 0, conflicts: 0, lorebookOnly: true })
        expect(own.startsWith('Make 2 factions.')).toBe(true)
        expect(own).toContain('## LOREBOOK-ONLY MODE — OVERRIDES EXACT COUNTS')
        expect(buildSkeletonSystemPrompt({ template: '   ', factions: 1, locations: 1, conflicts: 1 }).startsWith('You are a World Architect.')).toBe(true)
    })

    it('reads the selected lorebooks as canon, never a skeleton book, and tightens the rule in lorebook-only mode', async () => {
        const books = {
            'Canon Book': { entries: { 2: { key: ['Glassward'], content: 'A district built over volcanic glass.' }, 1: { comment: 'The Brass Court', content: 'A mercantile council controls the harbor.' }, 3: { comment: 'Empty', content: '   ' } } },
            Campaign_Skeleton: { entries: { 1: { comment: 'LOCATION: Seed', content: 'Must not be read.' } } },
            Bare: { entries: {} },
        }
        const context = await buildSkeletonLorebookContext(books)
        expect(context.startsWith('## EXISTING LOREBOOK SOURCE MATERIAL\nTreat the following material as established world canon.')).toBe(true)
        expect(context).toContain('### LOREBOOK: Canon Book\n#### The Brass Court\nA mercantile council controls the harbor.\n\n#### Glassward\nA district built over volcanic glass.')
        expect(context).not.toContain('Skeleton')
        expect(context).not.toContain('Bare')
        expect(context).not.toContain('Empty')
        expect(context).toContain('create compatible additions')
        const literal = await buildSkeletonLorebookContext(books, { lorebookOnly: true })
        expect(literal).toContain('Do not invent, infer, or extrapolate')
        expect(literal).toContain('Ignore the requested category counts')
        expect(literal).not.toContain('create compatible additions')
        expect(await buildSkeletonLorebookContext({ Campaign_Skeleton: books.Campaign_Skeleton, Bare: books.Bare })).toBe('')
    })

    it('shows the premises already filed, stamp stripped, and nothing for an empty or foreign book', () => {
        const shown = existingSkeletonPremises([
            { comment: 'FACTION: Salt Compact', content: '[Day 0 Baseline]\nControls shipping.', extensions: { rpgCategory: 'FAC' } },
            { comment: 'Captain Ilyra', content: '[Day 0 Baseline]\nA person.', extensions: { rpgCategory: 'NPC' } },
            { comment: '', content: 'Nameless.', extensions: { rpgCategory: 'LOC' } },
            { comment: 'LOCATION: Glassmere', content: 'A lake settlement.', extensions: { rpgCategory: 'LOC' } },
        ])
        expect(shown.startsWith('Avoid duplicating these or generating similar premises.')).toBe(true)
        expect(shown).toContain('### FACTION: Salt Compact\nControls shipping.\n\n### LOCATION: Glassmere\nA lake settlement.')
        expect(shown).not.toContain('Ilyra')
        expect(shown).not.toContain('Nameless')
        expect(existingSkeletonPremises([])).toBe('')
    })

    it('assembles the user prompt in the legacy order, with the fallback for no written source', () => {
        const full = buildSkeletonUserPrompt({ source: '  A drowned coast.  ', lorebookContext: '## EXISTING LOREBOOK SOURCE MATERIAL\nCanon.', existingPremises: 'Avoid these.', append: true })
        expect(full).toBe('## SKELETON SOURCE\nA drowned coast.\n\n## EXISTING LOREBOOK SOURCE MATERIAL\nCanon.\n\n## EXISTING SKELETON PREMISES\nAvoid these.\n\nGenerate additional world skeleton premises now.')
        const bare = buildSkeletonUserPrompt({ source: '', append: false })
        expect(bare).toBe('## SKELETON SOURCE\n(No written Skeleton Source provided — use the other supplied source material.)\n\nGenerate the world skeleton  now.')
    })

    it('parses headings, bold list items and plain titles into premises, and drops the retired NPC section', () => {
        expect(parseSkeletonOutput(REPLY)).toEqual([
            { label: 'The Salt Compact', content: 'A guild of shipping magnates. They tax every quay.', category: 'FAC' },
            { label: 'Morrowfen', content: 'A tidal trade town.', category: 'LOC' },
            { label: 'Glassmere', content: 'A lake settlement.', category: 'LOC' },
            { label: 'The Tithe War', content: 'Two guilds dispute the quay tax. Parties involved: the Compact and the wards.', category: 'EVENT' },
        ])
        expect(parseSkeletonOutput('')).toEqual([])
        expect(parseSkeletonOutput('Just prose, no sections.')).toEqual([])
        // A plain `Name: text` line opens an entry only when none is open.
        expect(parseSkeletonOutput('## LOCATIONS\nHarbour: a quay.\nSize: small.')).toEqual([{ label: 'Harbour', content: 'a quay. Size: small.', category: 'LOC' }])
    })

    it('names a seed without its category, whichever generator filed it', () => {
        expect(skeletonLabel('LOCATION: Harrowgate')).toBe('Harrowgate')
        expect(skeletonLabel('faction:  The Salt Compact ')).toBe('The Salt Compact')
        expect(skeletonLabel('CONFLICT: The Tithe War')).toBe('The Tithe War')
        expect(skeletonLabel('Harrowgate')).toBe('Harrowgate')
        expect(skeletonLabel('Location Harrowgate')).toBe('Location Harrowgate')
        expect(skeletonLabel(undefined)).toBe('')
    })

    it('files a premise as a keyless, disabled, stamped entry, and counts a book back', () => {
        const entry = skeletonEntry({ label: 'Morrowfen', content: 'A tidal trade town.', category: 'LOC' })
        expect(entry).toEqual({ key: [], comment: 'LOCATION: Morrowfen', content: '[Day 0 Baseline]\nA tidal trade town.', disabled: true, extensions: { rpgCategory: 'LOC', rpgSkeleton: true } })
        expect(skeletonEntry({ label: 'X', content: 'y', category: 'FAC' }).comment).toBe('FACTION: X')
        expect(skeletonEntry({ label: 'X', content: 'y', category: 'EVENT' }).comment).toBe('CONFLICT: X')
        const counts = countSkeleton([entry, skeletonEntry({ label: 'A', content: 'b', category: 'FAC' }), { extensions: { rpgCategory: 'NPC' } }, {}])
        expect(counts).toEqual({ factions: 1, locations: 1, conflicts: 0 })
        expect(describeSkeletonCounts(counts)).toBe('1 faction, 1 location, 0 conflicts')
        expect(describeSkeletonCounts({ factions: 4, locations: 4, conflicts: 3 })).toBe('4 factions, 4 locations, 3 conflicts')
    })

    it('seeds a report with the skeleton\'s locations until real lore supersedes them, and its factions as context', () => {
        // The legacy library's own rule, held of the typed face: Old Barrow is
        // a seed with no lore of its own, so it is a subject; Morrowfen's seed
        // is superseded by the real entry; the NPC seed is never a subject.
        const { dossiers, globalContext } = buildLocationDossiers(LEGACY_BOOKS, { prefix: 'Campaign' })
        const barrow = dossiers.find((d) => d.name === 'Old Barrow')
        expect(barrow?.text).toContain('An isolated burial hill.')
        expect(dossiers.find((d) => d.name === 'Morrowfen')?.text).not.toContain('obsolete')
        expect(dossiers.map((d) => d.name)).not.toContain('Captain Ilyra')
        expect(globalContext).toContain('Sun Court')
    })
})

describe('the source from the chat (33c)', () => {
    it('frames the recent lines as the legacy does, and cleans the paragraph as the legacy does', () => {
        expect(WORLD_SOURCE_SYSTEM_PROMPT.startsWith('You are a World Architect. Analyze the provided chat history')).toBe(true)
        expect(WORLD_SOURCE_SYSTEM_PROMPT).toContain('Do NOT name or identify player characters')
        expect(buildWorldSourceUserPrompt(['User: Hello.', 'GM: The gates close.'])).toBe('## RECENT CHAT HISTORY\nUser: Hello.\n\nGM: The gates close.\n\nGenerate the Skeleton Source:')
        expect(cleanWorldSource('  "A coast."  ')).toBe('A coast.')
        expect(cleanWorldSource("'A coast.'")).toBe('A coast.')
        expect(cleanWorldSource('"A coast." said nobody')).toBe('"A coast." said nobody')
        expect(cleanWorldSource('')).toBe('')
    })
})
