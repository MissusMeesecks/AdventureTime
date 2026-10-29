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
    it('names seven groups in the categories that hold them, every key once, with the folds’ limits', () => {
        expect(PREF_DIAL_GROUPS.map((g) => [g.id, g.category])).toEqual([['general', 'general'], ['tracker', 'tracker'], ['agent', 'agent'], ['wizard', 'systems'], ['maps', 'maps'], ['world', 'world'], ['creator', 'connections']])
        const keys = dialRows().map((r) => r.key)
        expect(new Set(keys).size).toBe(keys.length)
        // 74 since 72b: the master switches, the rollbacks, the history context, the agent's window mode, the portraits and the inventory's two; 75 with 72c's User Prompt Suffix; 79 with 71c's cleanup three and the audit's tokens; 80 with 73c's Full Review Mode.
        // 83 with 73g's wizard switches; 85 with 73h's Inject lorebooks and its filter; 76 since 82 took the
        // skeleton's nine rows into the World Skeleton & Atmosphere card the fold draws; 75 since 83 put the
        // portraits switch at the head of the portraits section.
        expect(keys).toHaveLength(75)
        expect(keys.indexOf('trackerFullReviewMode')).toBe(keys.indexOf('frameworkEnabled') + 1)
        expect(keys.indexOf('trackerInjectLorebooks')).toBe(keys.indexOf('trackerHistoryStates') + 1)
        expect(dialRows().find((r) => r.key === 'trackerLorebookFilter')).toMatchObject({ kind: 'books' })
        expect(dialRows().filter((r) => ['agentCleanupUseThreshold', 'agentCleanupThreshold', 'agentCleanupEvery', 'agentAuditTokens'].includes(r.key)).map((r) => r.kind)).toEqual(['switch', 'number', 'number', 'number'])
        expect(dialRows().find((r) => r.key === 'trackerUserPromptSuffix')).toMatchObject({ kind: 'prompt', placeholder: 'Blank: ## OUTPUT ONLY CHANGED SECTIONS:' })
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
        expect(cards.map((c) => c.querySelector('.lh-card-title')!.textContent)).toEqual(['Location Rotation', 'Timing & Narrative Input', 'Context Injection Settings', 'Report History & Consolidation'])
        expect(cards.every((c) => !c.open && !!c.querySelector('.lh-card-icon')!.textContent && !!c.querySelector('.lh-chevron'))).toBe(true)
        expect(cards[0]!.querySelector('.lh-section-help')!.textContent).toContain('first place on screen')
        expect(Array.from(cards[0]!.querySelectorAll('.lh-dial')).map((r) => r.getAttribute('data-lh-field'))).toEqual(['dial-worldProgressionLocationsPerReport', 'dial-worldProgressionLocationRandomize', 'dial-worldProgressionExclusionList'])
        expect(PREF_DIAL_GROUPS.find((g) => g.id === 'maps')!.sections.map((s) => s.title)).toEqual(['Map Architect', 'Map Updater', 'Map Evolution', 'The map on screen'])
    })

    it('puts the display regex switch in a card of its own under General & visuals (Phase 65)', () => {
        const { dials } = harness('general')
        const cards = Array.from(dials.root.querySelectorAll<HTMLDetailsElement>('.lh-dial-card'))
        // The portraits and the inventory's card follows it since 72b.
        expect(cards.map((c) => c.getAttribute('data-lh-card'))).toEqual(['choices', 'display'])
        expect(cards[0]!.querySelector('.lh-card-title')!.textContent).toBe('The choices in the bubble')
        expect(Array.from(cards[0]!.querySelectorAll('.lh-dial')).map((r) => r.getAttribute('data-lh-field'))).toEqual(['dial-choicesDisplayRegex'])
        expect((cards[0]!.querySelector('[data-lh-field="dial-choicesDisplayRegex"] input') as HTMLInputElement).type).toBe('checkbox')
    })

    it('draws a row per dial, saves each kind as changed, clamps a number, and shows a dependent row only when its rule holds', async () => {
        const { dials, calls, row, control, settle } = harness('maps')
        expect(row('mapEvolutionCount').hidden).toBe(true)
        dials.applyPrefs({ mapEvolutionScope: 'count', mapEvolutionCount: 3, mapUpdaterEnabled: true, mapEvolutionCompressEnabled: false, mapArchitectSystemPrompt: 'Place things.' })
        expect(row('mapEvolutionCount').hidden).toBe(false)
        expect(row('mapEvolutionCompressThreshold').hidden).toBe(true)
        expect(control<HTMLInputElement>('mapEvolutionCount').value).toBe('3')
        expect(control<HTMLInputElement>('mapUpdaterEnabled').checked).toBe(true)
        expect(control<HTMLTextAreaElement>('mapArchitectSystemPrompt').value).toBe('Place things.')
        control<HTMLInputElement>('mapUpdaterEnabled').checked = false
        control('mapUpdaterEnabled').dispatchEvent(new Event('change'))
        control<HTMLSelectElement>('mapEvolutionScope').value = 'all'
        control('mapEvolutionScope').dispatchEvent(new Event('change'))
        expect(row('mapEvolutionCount').hidden).toBe(true)
        control<HTMLInputElement>('mapEvolutionIntervalHours').value = '999'
        control('mapEvolutionIntervalHours').dispatchEvent(new Event('change'))
        expect(control<HTMLInputElement>('mapEvolutionIntervalHours').value).toBe('168')
        control<HTMLTextAreaElement>('mapEvolutionSystemPrompt').value = 'Mine.'
        control('mapEvolutionSystemPrompt').dispatchEvent(new Event('change'))
        await settle()
        expect(calls).toEqual([
            ['savePrefs', { mapUpdaterEnabled: false }],
            ['savePrefs', { mapEvolutionScope: 'all' }],
            ['savePrefs', { mapEvolutionIntervalHours: 168 }],
            ['savePrefs', { mapEvolutionSystemPrompt: 'Mine.' }],
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
        ;(h.row('trackerLorebookFilter').querySelector('button') as HTMLButtonElement).click()
        await h.settle()
        expect(listed).toBe(2)
        expect(note(h)).toBe('Ticked, but the host lists no book so named: Old book.')
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
        expect(note(broken)).toBe('The books could not be listed: store down')
        expect(broken.calls).toEqual([['fail', 'store down']])
        const bare = harness('tracker')
        bare.dials.applyPrefs({ trackerInjectLorebooks: true })
        expect(note(bare)).toBe('This build cannot list the host’s lorebooks.')
    })
})
