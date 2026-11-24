// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import { PREF_DIAL_GROUPS, createPrefDials, dialRows, type PrefDialsHost } from './pref-dials.js'

function harness(groupId: string, over: Partial<PrefDialsHost> = {}) {
    const calls: unknown[][] = []
    const host: PrefDialsHost = {
        el: (tag, attrs) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n },
        savePrefs: async (patch) => { calls.push(['savePrefs', patch]) },
        fail: (error) => { calls.push(['fail', error instanceof Error ? error.message : String(error)]) },
        ...over,
    }
    const group = PREF_DIAL_GROUPS.find((g) => g.id === groupId)!
    const dials = createPrefDials(host, group)
    document.body.replaceChildren(dials.root)
    const row = (key: string) => dials.root.querySelector(`[data-lh-field="dial-${key}"]`) as HTMLElement
    const control = <T extends HTMLElement>(key: string) => row(key).querySelector('input, select, textarea') as T
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
    return { dials, calls, row, control, settle }
}

describe('the mirrored dials (63c)', () => {
    it('names six groups in the categories that hold them, every key once, with the folds’ limits', () => {
        expect(PREF_DIAL_GROUPS.map((g) => [g.id, g.category])).toEqual([['general', 'general'], ['tracker', 'tracker'], ['agent', 'agent'], ['maps', 'maps'], ['world', 'world'], ['creator', 'systems']])
        const keys = dialRows().map((r) => r.key)
        expect(new Set(keys).size).toBe(keys.length)
        // 74 since 72b: the master switches, the rollbacks, the history context, the agent's window mode, the portraits and the inventory's two; 75 with 72c's User Prompt Suffix; 79 with 71c's cleanup three and the audit's tokens; 80 with 73c's Full Review Mode.
        // 83 with 73g's wizard switches; 85 with 73h's Inject lorebooks and its filter; 76 since 82 took the
        // skeleton's nine rows into the World Skeleton & Atmosphere card the fold draws; 75 since 83 put the
        // portraits switch at the head of the portraits section; 72 since 97 took the three map prompt boxes
        // out (the passes read the cartridge's prompts, edited in its own Map Architect card); 66 since 96 took
        // the wizard's six out (audit D6: the wizard's own controls are their one place on screen).
        expect(keys).toHaveLength(66)
        expect(keys.filter((key) => key.startsWith('wizard'))).toEqual([])
        for (const key of ['mapArchitectSystemPrompt', 'mapUpdaterSystemPrompt', 'mapEvolutionSystemPrompt']) expect(keys, key).not.toContain(key)
        expect(keys.indexOf('trackerFullReviewMode')).toBe(keys.indexOf('frameworkEnabled') + 1)
        expect(keys.indexOf('trackerInjectLorebooks')).toBe(keys.indexOf('trackerHistoryStates') + 1)
        expect(dialRows().find((r) => r.key === 'trackerLorebookFilter')).toMatchObject({ kind: 'books' })
        expect(dialRows().filter((r) => ['agentCleanupUseThreshold', 'agentCleanupThreshold', 'agentCleanupEvery', 'agentAuditTokens'].includes(r.key)).map((r) => r.kind)).toEqual(['switch', 'number', 'number', 'number'])
        expect(dialRows().find((r) => r.key === 'trackerUserPromptSuffix')).toMatchObject({ kind: 'prompt', placeholder: '## OUTPUT ONLY CHANGED SECTIONS:' })
        expect(keys).toContain('worldProgressionExclusionList')
        expect(keys).toContain('mapRevealAll')
        expect(keys).not.toContain('mapEvolutionSelectedRoots')
        expect(keys).not.toContain('campaignNames')
        for (const r of dialRows()) {
            if (r.kind === 'number') expect(r.min, r.key).toBeDefined()
            if (r.kind === 'select') expect(r.options!.length, r.key).toBeGreaterThan(1)
        }
    })

    it('draws each group as Multihog’s cards (63d): an icon, a centred title, a lead and the rows, closed by default', () => {
        const { dials } = harness('world')
        const cards = Array.from(dials.root.querySelectorAll<HTMLDetailsElement>('.lh-dial-card'))
        // The World Skeleton & Atmosphere card is the tracker panel's since 82, drawn first among these.
        expect(cards.map((c) => c.getAttribute('data-lh-card'))).toEqual(['rotation', 'timing', 'injection', 'history'])
        expect(cards.map((c) => c.querySelector('.lh-card-title')!.textContent)).toEqual(['Location rotation', 'Timing & narrative input', 'Context injection', 'Report history & consolidation'])
        expect(cards.every((c) => !c.open && !!c.querySelector('.lh-card-icon svg') && !!c.querySelector('.lh-chevron'))).toBe(true)
        // The lead is behind the header's [?] (96): in the card from the first paint, hidden until pressed.
        expect(cards[0]!.querySelector('.lh-help-note')!.textContent).toBe('World Progression reports on locations, not on individual people or things.')
        expect((cards[0]!.querySelector('.lh-help-note') as HTMLElement).hidden).toBe(true)
        expect(cards[0]!.querySelector('.lh-section-help')).toBeNull()
        expect(Array.from(cards[0]!.querySelectorAll('.lh-dial')).map((r) => r.getAttribute('data-lh-field'))).toEqual(['dial-worldProgressionLocationsPerReport', 'dial-worldProgressionLocationRandomize', 'dial-worldProgressionExclusionList'])
        expect(PREF_DIAL_GROUPS.find((g) => g.id === 'maps')!.sections.map((s) => s.title)).toEqual(['Map Architect', 'Map Updater', 'Map Evolution', 'Map display'])
    })

    it('says the deck’s text on the maps cards, every help behind a [?] and no build history or Multihog credit left (96, stage 2f)', () => {
        const { dials, row } = harness('maps')
        const card = (id: string) => dials.root.querySelector(`[data-lh-card="${id}"]`) as HTMLDetailsElement
        expect(card('architect').querySelector('summary .lh-help-tip')).not.toBeNull()
        expect(card('architect').textContent).toContain('Map Architect draws a map when the party first enters an unmapped site.')
        expect(card('updater').textContent).toContain('NPC biographies and relationships are recorded by the Lorebook Agent, not here.')
        expect(card('evolution').textContent).toContain('Its connection is set under Connections & models.')
        // Map display's one sentence named a fold that is gone: the card has no header help, its switch has its own.
        expect(card('screen').querySelector('summary .lh-help-tip')).toBeNull()
        const labels: Record<string, string> = {
            mapArchitectOpener: 'How the narrator asks for a map', mapArchitectLookback: 'Messages read by Map Architect',
            mapUpdaterEnabled: 'Update maps during play', mapUpdaterRunEvery: 'Replies between updates', mapUpdaterLookback: 'User turns read by Map Updater',
            mapEvolutionEnabled: 'Evolve sites over in-world time', mapEvolutionIntervalHours: 'Hours between passes, away',
            mapEvolutionOnSitePreset: 'Change style on the party’s site', mapEvolutionScope: 'Sites a pass considers', mapEvolutionCount: 'Number of sites',
            mapEvolutionRandomize: 'Pick sites at random', mapEvolutionWorldReportLookback: 'World reports a site reads', mapEvolutionLookback: 'User turns of story a pass reads',
            mapEvolutionCompressEnabled: 'Compress long site history', mapEvolutionCompressThreshold: 'Compress above this many tokens',
            mapEvolutionNarratorCommitTokens: 'Site activity tokens for the narrator', mapRevealAll: 'Reveal all',
        }
        const rows = dialRows([PREF_DIAL_GROUPS.find((g) => g.id === 'maps')!])
        for (const [key, text] of Object.entries(labels)) expect(rows.find((r) => r.key === key)!.label, key).toBe(text)
        expect(Array.from(row('mapArchitectOpener').querySelectorAll('option')).map((o) => o.textContent)).toEqual(['Tool call (CreateAreaMap)', 'Text block'])
        expect(Array.from(row('mapEvolutionScope').querySelectorAll('option')).map((o) => o.textContent)).toEqual(['All', 'Party’s site', 'Some', 'Named'])
        // Every row has help, each behind its own [?], hidden from the first paint.
        for (const r of rows) {
            expect(r.hint, r.key).toBeTruthy()
            const note = row(r.key).querySelector<HTMLElement>('.lh-help-note')!
            expect(note.textContent, r.key).toBe(r.hint)
            expect(note.hidden, r.key).toBe(true)
            expect(row(r.key).querySelector('label .lh-help-tip'), r.key).toBeNull()
        }
        expect(row('mapEvolutionIntervalHours').querySelector('.lh-help-note')!.textContent).toBe('In-world hours between passes for a site the party is not in. Default: 8.')
        expect(row('mapEvolutionRandomize').querySelector('.lh-help-note')!.textContent).toContain('When off, the sites changed longest ago go first.')
        expect(row('mapEvolutionCompressEnabled').querySelector('.lh-help-note')!.textContent).toBe('When on, a site’s closed history is shortened once it passes the token limit below. Default: on.')
        expect(dials.root.textContent).not.toMatch(/Multihog|Maps fold|\bfold\b|Phase \d/)
    })

    it('says the deck’s text on the world cards: the rotation’s switch named for what it does, no lead that only lists the rows (96, stage 2f)', () => {
        const { dials, row } = harness('world')
        const card = (id: string) => dials.root.querySelector(`[data-lh-card="${id}"]`) as HTMLDetailsElement
        expect(card('timing').querySelector('.lh-help-note')!.textContent).toBe('“Write a report now” and “Reset the timeline” are in the World Progression drawer of the Lore widget.')
        expect(card('injection').querySelector('summary .lh-help-tip')).toBeNull()
        expect(card('history').querySelector('summary .lh-help-tip')).toBeNull()
        const rows = dialRows([PREF_DIAL_GROUPS.find((g) => g.id === 'world')!])
        expect(rows.map((r) => r.label)).toEqual(['Locations per report', 'Randomize equally old locations', 'Excluded places', 'Write reports', 'In-world hours between reports', 'Replies the report writer reads', 'Reports shown to the narrator', 'Earlier reports the report writer reads', 'Consolidate old reports', 'Reports between consolidations'])
        for (const r of rows) expect(r.hint, r.key).toBeTruthy()
        const note = (key: string) => row(key).querySelector<HTMLElement>('.lh-help-note')!
        expect(note('worldProgressionLocationRandomize').textContent).toBe('The locations reported on longest ago always go first. When on, locations that are equally old are picked in random order. When off, they are picked in a fixed order. Default: on.')
        expect(note('worldProgressionLocationRandomize').hidden).toBe(true)
        expect(note('worldProgressionKeepActive').textContent).toContain('Default: 1.')
        expect(dials.root.textContent).not.toMatch(/Multihog|\bfold\b|_World|first place on screen/)
    })

    it('states the defaults the store ships with (96, stage 2f)', async () => {
        const { DEFAULT_PREFS } = await import('../backend/prefs-store.js')
        const prefs = DEFAULT_PREFS as unknown as Record<string, unknown>
        const rows = dialRows(PREF_DIAL_GROUPS.filter((g) => g.id === 'maps' || g.id === 'world'))
        for (const r of rows) {
            const stated = /Default: ([^.,]+(?:,\d{3})*)/.exec(r.hint ?? '')
            if (!stated) continue
            const value = prefs[r.key]
            const words = stated[1]!.trim()
            if (typeof value === 'boolean') expect(words, r.key).toBe(value ? 'on' : 'off')
            else if (typeof value === 'number') expect(Number(words.replace(/,/g, '')), r.key).toBe(value)
            else expect(r.options!.find((o) => o.value === value)!.label.toLowerCase(), r.key).toContain(words.split(' ')[0]!.toLowerCase())
        }
        expect(rows.find((r) => r.key === 'worldProgressionConsolidateInterval')!.hint).toContain(`Default: ${prefs.worldProgressionConsolidateInterval}.`)
    })

    it('puts every hint behind a [?] after the row’s label, the text under the row and hidden (96)', () => {
        const { dials, row } = harness('tracker')
        const cadence = row('trackerRunEvery')
        const tip = cadence.querySelector<HTMLButtonElement>('.lh-dial-label-line > .lh-help-tip')!
        expect(tip.getAttribute('aria-label')).toBe('Help: Replies between tracker passes')
        const note = cadence.querySelector<HTMLElement>('.lh-help-note')!
        expect(note.parentElement).toBe(cadence)
        expect(note.hidden).toBe(true)
        expect(note.textContent).toContain('1 runs a tracker pass after every reply, which is recommended.')
        tip.click()
        expect(note.hidden).toBe(false)
        // A tick's [?] is beside its label, outside it, so a press cannot tick the box.
        const power = row('frameworkEnabled')
        expect(power.querySelector('label .lh-help-tip')).toBeNull()
        expect(power.querySelector('.lh-dial-label-line > .lh-help-tip')).not.toBeNull()
        // A prompt's help stands between its label and its box.
        const suffix = row('trackerUserPromptSuffix')
        expect(Array.from(suffix.children).map((c) => c.className || c.tagName)).toEqual(['lh-dial-main', 'lh-help-note', 'lh-input'])
        // Every row with a hint has one button and one note (the lorebook picker a second, for Clear selection); no always-visible hint is left.
        const hinted = dialRows().filter((r) => PREF_DIAL_GROUPS.find((g) => g.id === 'tracker')!.sections.some((s) => s.rows.includes(r)) && r.hint)
        expect(dials.root.querySelectorAll('.lh-dial .lh-help-tip')).toHaveLength(hinted.length + 1)
        expect(dials.root.querySelector('.lh-dial > .lh-conn-hint:not([data-lh-field])')).toBeNull()
    })

    it('puts the display regex switch in a card of its own under General & visuals (Phase 65)', () => {
        const { dials } = harness('general')
        const cards = Array.from(dials.root.querySelectorAll<HTMLDetailsElement>('.lh-dial-card'))
        // The portraits and the inventory's card follows it since 72b.
        expect(cards.map((c) => c.getAttribute('data-lh-card'))).toEqual(['choices', 'display'])
        expect(cards.map((c) => c.querySelector('.lh-card-title')!.textContent)).toEqual(['Choices block in replies', 'Inventory'])
        // Neither card has a lead (96): its one sentence said what the title says.
        expect(cards.map((c) => c.querySelector('summary .lh-help-tip'))).toEqual([null, null])
        // Each row's help is behind its [?], hidden until pressed.
        const help = (key: string) => dials.root.querySelector(`[data-lh-field="dial-${key}"] .lh-help-note`) as HTMLElement
        expect(help('choicesDisplayRegex').textContent).toBe('When on, AdventureTime installs a display-only regex script in Lumiverse that hides the raw <choices> block in every reply. When off, the script is removed and AdventureTime hides the block itself after each reply, so the block can show until the next refresh. Turn it off if a long chat becomes slow. Default: on.')
        expect(help('inventoryShowTotal').textContent).toBe('When on, the Inventory card’s header shows the sum of every item’s worth and all money. The total uses the currency most lines use. Default: off.')
        expect(help('inventoryWorthMode').textContent).toMatch(/^Sets how an item’s worth.*Default: tooltip on hover\.$/)
        expect([help('choicesDisplayRegex').hidden, help('inventoryShowTotal').hidden, help('inventoryWorthMode').hidden]).toEqual([true, true, true])
        expect(Array.from(dials.root.querySelectorAll('[data-lh-field="dial-inventoryWorthMode"] option')).map((o) => [o.getAttribute('value'), o.textContent])).toEqual([['hover', 'Tooltip on hover'], ['display', 'Badge beside the item']])
        expect(dials.root.querySelector('[data-lh-field="dial-choicesDisplayRegex"] label')!.textContent).toBe('Hide with a Lumiverse regex script')
        expect(Array.from(cards[0]!.querySelectorAll('.lh-dial')).map((r) => r.getAttribute('data-lh-field'))).toEqual(['dial-choicesDisplayRegex'])
        expect((cards[0]!.querySelector('[data-lh-field="dial-choicesDisplayRegex"] input') as HTMLInputElement).type).toBe('checkbox')
    })

    it('draws a row per dial, saves each kind as changed, clamps a number, and shows a dependent row only when its rule holds', async () => {
        const { dials, calls, row, control, settle } = harness('maps')
        expect(row('mapEvolutionCount').hidden).toBe(true)
        dials.applyPrefs({ mapEvolutionScope: 'count', mapEvolutionCount: 3, mapUpdaterEnabled: true, mapEvolutionCompressEnabled: false })
        expect(row('mapEvolutionCount').hidden).toBe(false)
        expect(row('mapEvolutionCompressThreshold').hidden).toBe(true)
        expect(control<HTMLInputElement>('mapEvolutionCount').value).toBe('3')
        expect(control<HTMLInputElement>('mapUpdaterEnabled').checked).toBe(true)
        control<HTMLInputElement>('mapUpdaterEnabled').checked = false
        control('mapUpdaterEnabled').dispatchEvent(new Event('change'))
        control<HTMLSelectElement>('mapEvolutionScope').value = 'all'
        control('mapEvolutionScope').dispatchEvent(new Event('change'))
        expect(row('mapEvolutionCount').hidden).toBe(true)
        control<HTMLInputElement>('mapEvolutionIntervalHours').value = '999'
        control('mapEvolutionIntervalHours').dispatchEvent(new Event('change'))
        expect(control<HTMLInputElement>('mapEvolutionIntervalHours').value).toBe('168')
        await settle()
        expect(calls).toEqual([
            ['savePrefs', { mapUpdaterEnabled: false }],
            ['savePrefs', { mapEvolutionScope: 'all' }],
            ['savePrefs', { mapEvolutionIntervalHours: 168 }],
        ])
    })

    it('saves a text dial, leaves the control being typed in alone, and reports a failed save', async () => {
        const { dials, calls, control, settle } = harness('world', { savePrefs: async () => { throw new Error('no store') } })
        dials.applyPrefs({ worldProgressionExclusionList: 'Morrowfen, The Docks', worldProgressionEnabled: true })
        const list = control<HTMLInputElement>('worldProgressionExclusionList')
        expect(list.value).toBe('Morrowfen, The Docks')
        list.focus()
        list.value = 'Glassmere'
        dials.applyPrefs({ worldProgressionExclusionList: 'Elsewhere' })
        expect(list.value).toBe('Glassmere')
        list.dispatchEvent(new Event('change'))
        await settle()
        expect(calls).toEqual([['fail', 'no store']])
        list.blur()
        dials.applyPrefs({ worldProgressionExclusionList: 'Elsewhere' })
        expect(list.value).toBe('Elsewhere')
    })
})

describe('the lorebooks into the tracker (73h)', () => {
    const BOOKS = [{ id: 'b3', name: 'Shared canon' }, { id: 'b2', name: 'Vell_LOC' }, { id: 'b1', name: 'Vell_NPC' }]
    const boxes = (h: ReturnType<typeof harness>) => Array.from(h.row('trackerLorebookFilter').querySelectorAll<HTMLInputElement>('input[data-lh-book]'))
    const note = (h: ReturnType<typeof harness>) => h.row('trackerLorebookFilter').querySelector('[data-lh-field="dial-trackerLorebookFilter-note"]')!.textContent

    it('hides the filter until the switch is on, then lists the host’s books with the filter’s names ticked, and saves the ticked names', async () => {
        let listed = 0
        const h = harness('tracker', { listBooks: async () => { listed += 1; return BOOKS } })
        h.dials.applyPrefs({ trackerInjectLorebooks: false, trackerLorebookFilter: ['Vell_NPC'] })
        expect(h.row('trackerLorebookFilter').hidden).toBe(true)
        expect(listed).toBe(0)
        h.dials.applyPrefs({ trackerInjectLorebooks: true })
        expect(h.row('trackerLorebookFilter').hidden).toBe(false)
        await h.settle()
        expect(listed).toBe(1)
        expect(boxes(h).map((b) => [b.dataset.lhBook, b.checked])).toEqual([['Shared canon', false], ['Vell_LOC', false], ['Vell_NPC', true]])
        expect(note(h)).toBe('')
        boxes(h)[0]!.checked = true
        boxes(h)[0]!.dispatchEvent(new Event('change'))
        expect(h.calls).toEqual([['savePrefs', { trackerLorebookFilter: ['Shared canon', 'Vell_NPC'] }]])
        // The event redraws the ticks from the preferences, and a name the host no longer lists is kept and named.
        h.dials.applyPrefs({ trackerLorebookFilter: ['Vell_LOC', 'Old book'] })
        expect(boxes(h).map((b) => b.checked)).toEqual([false, true, false])
        // Reload reads the list again, as the legacy's switch does; the kept name is noted.
        ;(h.row('trackerLorebookFilter').querySelector('button.lh-button') as HTMLButtonElement).click()
        await h.settle()
        expect(listed).toBe(2)
        expect(note(h)).toBe('Selected, but Lumiverse has no lorebook with this name: Old book.')
        // Clear (73h-bis) unticks every book and saves an empty filter, the stale name with them.
        ;(h.row('trackerLorebookFilter').querySelector('[data-lh-field="dial-trackerLorebookFilter-clear"]') as HTMLButtonElement).click()
        expect(boxes(h).map((b) => b.checked)).toEqual([false, false, false])
        expect(h.calls.at(-1)).toEqual(['savePrefs', { trackerLorebookFilter: [] }])
    })

    it('says when the host has no books, when the list fails, and when the build cannot list them', async () => {
        const none = harness('tracker', { listBooks: async () => [] })
        none.dials.applyPrefs({ trackerInjectLorebooks: true })
        await none.settle()
        expect(note(none)).toBe('No lorebooks found.')
        const broken = harness('tracker', { listBooks: async () => { throw new Error('store down') } })
        broken.dials.applyPrefs({ trackerInjectLorebooks: true })
        await broken.settle()
        expect(note(broken)).toBe('The lorebooks could not be listed: store down')
        expect(broken.calls).toEqual([['fail', 'store down']])
        const bare = harness('tracker')
        bare.dials.applyPrefs({ trackerInjectLorebooks: true })
        expect(note(bare)).toBe('This build cannot list Lumiverse’s lorebooks.')
    })

    it('says the deck’s text (96): the card and its rows renamed, every help behind a [?], Clear selection’s too and not a tooltip', () => {
        const h = harness('tracker', { listBooks: async () => [] })
        const card = h.row('trackerLookbackMode').closest('details')!
        expect(card.querySelector('.lh-card-title')!.textContent).toBe('Advanced tracker')
        const labels = dialRows().filter((r) => r.key.startsWith('tracker') || r.key === 'frameworkEnabled')
        expect(Object.fromEntries(labels.map((r) => [r.key, r.label]))).toMatchObject({
            trackerLookbackCount: 'Messages per pass',
            trackerDirectLookback: 'Messages an instructed pass reads',
            frameworkEnabled: 'AdventureTime is on in every chat',
            trackerFullReviewMode: 'Full Review Mode',
            trackerHistoryStates: 'Memo states shown',
            trackerInjectLorebooks: 'Send lorebooks to the tracker',
            trackerLorebookFilter: 'Lorebooks the tracker reads',
            trackerSwipeRollback: 'Roll back the memo on a swipe',
        })
        expect(Array.from(h.control<HTMLSelectElement>('trackerLookbackMode').options).map((o) => o.textContent)).toEqual(['Current exchange (recommended)', 'Fixed number of messages'])
        // No row of the card credits Multihog but the one difference, and none names the host.
        for (const r of labels) {
            expect(r.hint, r.key).toBeTruthy()
            expect(r.hint, r.key).not.toContain('the host')
            if (r.key !== 'trackerLorebookFilter') expect(r.hint, r.key).not.toContain('Multihog')
        }
        const filter = h.row('trackerLorebookFilter')
        const notes = Array.from(filter.querySelectorAll<HTMLElement>('.lh-help-note'))
        expect(notes).toHaveLength(2)
        expect(notes.every((n) => n.hidden)).toBe(true)
        expect(notes[0]!.textContent).toContain('\n\nDifferent from Multihog: with none selected, Multihog sends every lorebook in the library.')
        const clear = filter.querySelector<HTMLButtonElement>('[data-lh-field="dial-trackerLorebookFilter-clear"]')!
        expect(clear.textContent).toBe('Clear selection')
        expect(clear.hasAttribute('title')).toBe(false)
        const tip = clear.nextElementSibling as HTMLButtonElement
        expect(tip.getAttribute('aria-label')).toBe('Help: Clear selection')
        tip.click()
        expect(notes[1]!.hidden).toBe(false)
        expect(notes[1]!.textContent).toBe('Clears every selection. The tracker then reads the lorebooks linked to this chat.')
        expect(filter.querySelector('button.lh-button')!.textContent).toBe('↻ Reload lorebooks')
        // The help is never visible until asked for: the open text of the row is its label and buttons.
        expect(h.row('frameworkEnabled').querySelector<HTMLElement>('.lh-help-note')!.hidden).toBe(true)
    })

    it('says the deck’s text for the agent’s three cards (96): the cards and rows renamed, every help behind a [?], the stale places gone', () => {
        const h = harness('agent')
        const cards = Array.from(h.dials.root.querySelectorAll('details'))
        expect(cards.map((c) => c.querySelector('.lh-card-title')!.textContent)).toEqual(['Agent passes', 'Cleanup & full audit', 'Lorebooks'])
        // Each card's lead is behind its header's [?], hidden until pressed.
        const leads = cards.map((c) => c.querySelector<HTMLElement>('.lh-help-note')!)
        expect(leads.map((n) => n.hidden)).toEqual([true, true, true])
        expect(leads[0]!.textContent).toBe('How often the agent runs, how much of the chat it reads and how many model calls a pass may make. The same settings are under Quick settings in the Lore widget.')
        expect(leads[1]!.textContent).toBe('Settings for the Cleanup and Full audit buttons in the Lore widget. Cleanup shortens bloated entries. Full audit runs the whole chat through the agent in chunks.')
        expect(leads[2]!.textContent).toBe('Whether the campaign’s lorebooks are attached as they are made, and where. The Lorebooks list in the Lore widget shows whether each one is attached.')
        const rows = PREF_DIAL_GROUPS.find((g) => g.id === 'agent')!.sections.flatMap((s) => s.rows)
        expect(Object.fromEntries(rows.map((r) => [r.key, r.label]))).toEqual({
            agentRunEvery: 'Replies between automatic passes',
            agentLookback: 'Messages to read',
            agentMaxTurns: 'Research turns',
            agentDirectLookback: 'Messages an instructed pass reads',
            agentEnabled: 'Automatic agent passes',
            agentLookbackMode: 'Automatic pass reads',
            agentSwipeRollback: 'Roll back the agent pass on a swipe',
            agentCleanupUseThreshold: 'Use token threshold',
            agentCleanupThreshold: 'Token threshold',
            agentCleanupEvery: 'Auto-cleanup every N passes',
            agentAuditTokens: 'Full audit context tokens',
            attachBooksToCard: 'Attach new lorebooks automatically',
            attachBooksTarget: 'Attach to',
        })
        expect(Array.from(h.control<HTMLSelectElement>('agentLookbackMode').options).map((o) => o.textContent)).toEqual(['Since the last run (recommended)', 'Since the last user message', 'Fixed count of messages'])
        expect(Array.from(h.control<HTMLSelectElement>('attachBooksTarget').options).map((o) => o.textContent)).toEqual(['This chat only (recommended)', 'The narrator’s card (every chat that uses it)'])
        // Multihog is named in the one difference alone; no text names a fold that is gone, a position on the card, or the host.
        for (const text of [...rows.map((r) => r.hint ?? ''), ...leads.map((n) => n.textContent ?? '')]) {
            expect(text).toBeTruthy()
            for (const stale of ['fold', 'below', 'the host', 'send bar', ' books']) expect(text, stale).not.toContain(stale)
        }
        expect(rows.filter((r) => (r.hint ?? '').includes('Multihog')).map((r) => r.key)).toEqual(['agentSwipeRollback'])
        const rollback = h.row('agentSwipeRollback').querySelector<HTMLElement>('.lh-help-note')!
        expect(rollback.hidden).toBe(true)
        expect(rollback.textContent).toBe('When on, swiping or regenerating a reply undoes the automatic agent pass that read it. The lore written for the discarded reply is removed. Default: on.\n\nDifferent from Multihog: Multihog’s default is off. Here the default is on.')
        // A tick's [?] is beside its label, never inside it.
        const power = h.row('agentEnabled')
        expect(power.querySelector('label .lh-help-tip')).toBeNull()
        const tip = power.querySelector<HTMLButtonElement>('.lh-dial-label-line > .lh-help-tip')!
        expect(tip.getAttribute('aria-label')).toBe('Help: Automatic agent passes')
        const note = power.querySelector<HTMLElement>('.lh-help-note')!
        expect(note.hidden).toBe(true)
        tip.click()
        expect(note.hidden).toBe(false)
        expect(note.textContent).toBe('When off, no agent pass runs by itself after a reply. Run the agent now and instructed passes still work. The "Replies between automatic passes" number is kept. Default: on.')
    })
})
