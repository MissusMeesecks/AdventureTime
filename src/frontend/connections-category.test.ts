// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import { GEAR_TIERS } from '../tracker/creator.js'
import { CATEGORY_COPY } from './category-copy.js'
import { PREF_DIAL_GROUPS, createPrefDials } from './pref-dials.js'
import { CONNECTION_ROWS, MAX_TOKENS_FIELD, NARRATOR_BLANK, createConnectionsCategory, type ConnectionsCategoryHost } from './connections-category.js'

function harness(over: Partial<ConnectionsCategoryHost> = {}) {
    const calls: unknown[][] = []
    const host: ConnectionsCategoryHost = {
        el: (tag, attrs) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n },
        savePrefs: async (patch) => { calls.push(['savePrefs', patch]) },
        textConnections: async () => { calls.push(['text']); return { connections: [{ id: 'conn-1', name: 'Main', model: 'deepseek', isDefault: true }, { id: 'conn-2', name: 'Fast', model: '', isDefault: false }] } },
        imageConnections: async () => { calls.push(['image']); return { connections: [{ id: 'img-1', name: 'Swarm', provider: 'swarmui', model: 'anima', isDefault: true }] } },
        fail: (error) => { calls.push(['fail', error instanceof Error ? error.message : String(error)]) },
        ...over,
    }
    const category = createConnectionsCategory(host)
    document.body.replaceChildren(category.root)
    const select = (field: string) => category.root.querySelector(`[data-lh-field="${field}"] select`) as HTMLSelectElement
    const options = (field: string) => Array.from(select(field).options).map((o) => o.textContent)
    const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0)) }
    return { category, calls, select, options, settle }
}

describe('the connections in one place (63)', () => {
    it('draws a row per connection in the passes’ order, each blank named for its fallback', () => {
        const { options } = harness()
        // The Companion's blank row is the narrator's connection (100a), as the tracker's and the agent's.
        expect(CONNECTION_ROWS.filter((r) => r.blank === 'Use the narrator connection').map((r) => r.key)).toEqual(['trackerConnectionId', 'agentConnectionId', 'companionConnectionId'])
        expect(CONNECTION_ROWS.map((r) => r.label)).toEqual(['State Tracker', 'Lorebook Agent', 'Character creator', 'Adventure Companion', 'Map Architect', 'Map Updater', 'Map Evolution', 'Portrait prompts', 'Scene picture', 'Portraits'])
        expect(options('connection-tracker')).toEqual([NARRATOR_BLANK])
        expect(options('connection-evolution')).toEqual(['Use the Lorebook Agent connection'])
        expect(options('connection-portrait-image')).toEqual(['Use the location image connection'])
    })

    it('reads the two lists once when loaded, text rows from the one and image rows from the other, keeping a chosen id not listed', async () => {
        const { category, calls, options, select, settle } = harness()
        category.applyPrefs({ trackerConnectionId: 'conn-2', scenePictureConnectionId: 'img-9', portraitConnectionId: '' })
        expect(options('connection-tracker')).toEqual([NARRATOR_BLANK, 'Missing connection (no longer in Lumiverse)'])
        category.load()
        category.load()
        await settle()
        expect(calls).toEqual([['text'], ['image']])
        expect(options('connection-tracker')).toEqual([NARRATOR_BLANK, 'Main — deepseek', 'Fast'])
        expect(select('connection-tracker').value).toBe('conn-2')
        expect(options('connection-scene-image')).toEqual(['Use Lumiverse’s default image connection', 'Swarm — swarmui · anima (default)', 'Missing connection (no longer in Lumiverse)'])
        expect(select('connection-scene-image').value).toBe('img-9')
        expect(options('connection-portrait-image')).toEqual(['Use the location image connection', 'Swarm — swarmui · anima (default)'])
    })

    it('saves a choice under its own preference, and Apply to all sets the eight text connections and no image', async () => {
        const { category, calls, select, settle } = harness()
        category.load()
        await settle()
        calls.length = 0
        select('connection-agent').value = 'conn-1'
        select('connection-agent').dispatchEvent(new Event('change'))
        await settle()
        expect(calls).toEqual([['savePrefs', { agentConnectionId: 'conn-1' }]])
        const all = category.root.querySelector('[data-lh-field="connection-all"] select') as HTMLSelectElement
        expect(Array.from(all.options).map((o) => o.textContent)).toEqual(['Use each row’s fallback', 'Main — deepseek', 'Fast'])
        all.value = 'conn-2'
        ;(category.root.querySelector('[data-lh-field="connection-all"] button.lh-button') as HTMLButtonElement).click()
        await settle()
        // Seven text connections since 72b: the Architect's and the Updater's joined the five.
        expect(calls[1]).toEqual(['savePrefs', { trackerConnectionId: 'conn-2', agentConnectionId: 'conn-2', creatorConnectionId: 'conn-2', companionConnectionId: 'conn-2', mapArchitectConnectionId: 'conn-2', mapUpdaterConnectionId: 'conn-2', mapEvolutionConnectionId: 'conn-2', portraitPromptConnectionId: 'conn-2' }])
    })

    // 89: the output length for AdventureTime's own calls, the one number a pass gets.
    it('draws the output length after the rows, blank as it ships, saving a whole number and blank as zero, and following the preference', async () => {
        const { category, calls } = harness()
        const input = category.root.querySelector(`[data-lh-field="${MAX_TOKENS_FIELD}"] input`) as HTMLInputElement
        expect(input.value).toBe('')
        expect(input.placeholder).toBe('Provider default')
        const row = category.root.querySelector(`[data-lh-field="${MAX_TOKENS_FIELD}"]`)!
        expect(row.querySelector('.lh-conn-label')!.textContent).toBe('Pass output length')
        expect(row.querySelector('.lh-help-note')!.textContent).toContain('4,096 for Anthropic through Lumiverse')
        expect(row.querySelector('.lh-conn-hint')).toBeNull()
        expect(Array.from(category.root.querySelectorAll('.lh-conn')).at(-1)!.getAttribute('data-lh-field')).toBe(MAX_TOKENS_FIELD)
        input.value = '4096.9'
        input.dispatchEvent(new Event('change'))
        expect(calls.at(-1)).toEqual(['savePrefs', { passMaxTokens: 4096 }])
        expect(input.value).toBe('4096')
        input.value = ''
        input.dispatchEvent(new Event('change'))
        expect(calls.at(-1)).toEqual(['savePrefs', { passMaxTokens: 0 }])
        input.value = '-3'
        input.dispatchEvent(new Event('change'))
        expect(calls.at(-1)).toEqual(['savePrefs', { passMaxTokens: 0 }])
        category.applyPrefs({ passMaxTokens: 8000 })
        expect(input.value).toBe('8000')
        category.applyPrefs({ passMaxTokens: 0 })
        expect(input.value).toBe('')
        // The blank label of the two story rows names the narrator's connection (89); its chain is on the category's [?] (96).
        expect(NARRATOR_BLANK).toBe('Use the narrator connection')
    })

    it('says in the hints why a list could not be read, and a failed save is reported', async () => {
        const { category, calls, select, settle } = harness({
            textConnections: async () => { throw new Error('no connections permission') },
            imageConnections: async () => ({ connections: [], unavailable: 'PERMISSION_DENIED: image_gen' }),
            savePrefs: async () => { throw new Error('no store') },
        })
        category.load()
        await settle()
        expect(select('connection-tracker').parentElement!.querySelector('.lh-conn-hint')!.textContent).toBe('Connections could not be listed: no connections permission')
        expect(select('connection-scene-image').parentElement!.querySelector('.lh-conn-hint')!.textContent).toBe('Connections could not be listed: PERMISSION_DENIED: image_gen')
        expect((category.root.querySelector('[data-lh-field="connection-all"] button.lh-button') as HTMLButtonElement).disabled).toBe(true)
        select('connection-portrait-prompt').value = ''
        select('connection-portrait-prompt').dispatchEvent(new Event('change'))
        await settle()
        expect(calls.at(-1)).toEqual(['fail', 'no store'])
    })

    // 96: a row's help is behind the [?] after its label; the line under the control is the status alone.
    it('keeps every row’s help behind a [?] and shows no line under a control that has nothing to report', async () => {
        const { category, settle } = harness()
        const rows = Array.from(category.root.querySelectorAll<HTMLElement>('.lh-conn'))
        expect(rows).toHaveLength(CONNECTION_ROWS.length + 2)
        for (const row of rows) {
            expect(row.tagName).toBe('DIV')
            const button = row.querySelector('.lh-conn-label-line > .lh-help-tip') as HTMLButtonElement
            const note = Array.from(row.children).find((child) => child.classList.contains('lh-help-note')) as HTMLElement
            expect(button.previousElementSibling!.classList.contains('lh-conn-label')).toBe(true)
            expect(note.hidden).toBe(true)
            expect(note.closest('label')).toBeNull()
            // The label still names its control.
            const control = row.querySelector('select, input') as HTMLElement
            expect(row.querySelector('label')!.getAttribute('for')).toBe(control.id)
        }
        const tracker = category.root.querySelector('[data-lh-field="connection-tracker"]') as HTMLElement
        expect(tracker.querySelector('.lh-help-note')!.textContent).toBe('The model that reads the story and writes the tracker memo.')
        const status = tracker.querySelector('.lh-conn-hint') as HTMLElement
        expect(status.hidden).toBe(true)
        expect(status.textContent).toBe('')
        ;(tracker.querySelector('.lh-help-tip') as HTMLButtonElement).click()
        expect((tracker.querySelector('.lh-help-note') as HTMLElement).hidden).toBe(false)
        category.load()
        await settle()
        expect(status.hidden).toBe(true)
        // No lead above the rows, no old tails, no help as a hover title.
        const text = category.root.textContent ?? ''
        expect(text).not.toContain('Blank is the fallback')
        expect(text).not.toContain('Also under')
        expect(text).not.toContain('Also in the')
        expect(text).not.toContain('host')
        expect(category.root.querySelector('[title]')).toBeNull()
    })

    it('says how many text connections Apply to all sets, as many as the rows it writes', () => {
        const { category } = harness()
        const row = category.root.querySelector('[data-lh-field="connection-all"]') as HTMLElement
        expect(row.querySelector('.lh-conn-label')!.textContent).toBe('Apply to all text connections')
        expect(CONNECTION_ROWS.filter((r) => r.kind === 'text')).toHaveLength(8)
        expect(CONNECTION_ROWS.filter((r) => r.kind === 'image')).toHaveLength(2)
        expect(row.querySelector('.lh-help-note')!.textContent).toBe('Sets all eight text connections above to the chosen connection. The two image connections do not change. Choose the blank option to return every row to its own fallback.')
        expect(row.querySelector('.lh-conn-hint')).toBeNull()
    })

    it('shows the status line only while a list cannot be read', async () => {
        const { category, select, settle } = harness({ imageConnections: async () => ({ connections: [], unavailable: 'This build cannot list connections.' }) })
        category.load()
        await settle()
        const image = select('connection-portrait-image').parentElement!.querySelector('.lh-conn-hint') as HTMLElement
        expect(image.hidden).toBe(false)
        expect(image.textContent).toBe('Connections could not be listed: This build cannot list connections.')
        expect((select('connection-agent').parentElement!.querySelector('.lh-conn-hint') as HTMLElement).hidden).toBe(true)
    })
})

// 96: the category's copy and its one card of dials, kept here so the category's tests are in one file.
describe('the Connections & models copy (96)', () => {
    const el = (tag: string, attrs?: Record<string, string>) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n }

    it('puts the fallback order on the category’s [?] as a numbered list of the four steps, one a line', () => {
        const intro = CATEGORY_COPY.connections.intro
        expect(intro.split('\n').filter((line) => /^\d\. /.test(line))).toEqual([
            '1. The chat’s own connection.',
            '2. The connection that wrote the last reply.',
            '3. Lumiverse’s default connection.',
            '4. The first connection Lumiverse lists.',
        ])
        expect(intro).toContain('Both places change the same setting.')
        expect(intro).toContain('Leave a row blank to use the fallback named in its list.')
    })

    it('writes the guide in the decided words, counting the text connections as the rows do', () => {
        const { guide } = CATEGORY_COPY.connections
        expect(guide.lead).toBe('Each kind of pass can run on its own text connection. Pictures are drawn on image connections.')
        expect(guide.steps.map((step) => step.title)).toEqual(['Set one connection for everything', 'Use a fast model for frequent work', 'Choose the image connections'])
        // The creation card is under Game systems & rulebook since 100c (departure 170), and that category's guide points to it.
        expect(CATEGORY_COPY.systems.guide.steps.map((step) => step.title)).toContain('Choose how characters start')
        expect(PREF_DIAL_GROUPS.find((g) => g.id === 'creator')!.category).toBe('systems')
        expect(guide.steps[0]!.text).toContain('All eight text connections change.')
        expect(CONNECTION_ROWS.filter((r) => r.kind === 'text')).toHaveLength(8)
        expect(guide.misc).toHaveLength(2)
        const all = [CATEGORY_COPY.connections.intro, guide.lead, ...guide.steps.flatMap((step) => [step.title, step.text]), ...guide.misc].join(' ')
        expect(all).not.toMatch(/Multihog|the host|five text/)
    })

    it('draws Character creation & starting modes with its help behind the [?]s, in the decided words', () => {
        const group = PREF_DIAL_GROUPS.find((g) => g.id === 'creator')!
        const dials = createPrefDials({ el, savePrefs: async () => {}, fail: () => {} }, group)
        const card = dials.root.querySelector('[data-lh-card="creation"]') as HTMLElement
        expect(card.querySelector('.lh-card-title')!.textContent).toBe('Character creation & starting modes')
        const cardHelp = Array.from(card.children).find((child) => child.classList.contains('lh-help-note')) as HTMLElement
        expect(cardHelp.textContent).toBe('These defaults are used by the Character creator, Instant Action and the other ways to begin.')
        expect(cardHelp.hidden).toBe(true)
        const row = (key: string) => card.querySelector(`[data-lh-field="dial-${key}"]`) as HTMLElement
        const label = (key: string) => row(key).querySelector('label')!.textContent
        expect(['creatorLevel', 'creatorCombatScalingGuide', 'creatorPlayerCard', 'creatorCardWords', 'creatorPersona', 'creatorSendStarter', 'creatorInstantRandomLevel'].map(label)).toEqual([
            'Starting level', 'Use the scaling guide', 'Write a Player Card', 'Player Card length (words)', 'Create a matching persona', 'Instant Action sends the opening message', 'Instant Action: random level (1–10)',
        ])
        const help = row('creatorPlayerCard').querySelector('.lh-help-note') as HTMLElement
        expect(help.hidden).toBe(true)
        expect(help.textContent).toContain('Default: off. Recommended.')
        expect(row('creatorInitialTime').querySelector('.lh-help-note')!.textContent).toBe('The time the in-world clock starts at. Default: 08:00 AM.')
        const levels = Array.from((row('creatorLevel').querySelector('select') as HTMLSelectElement).options).map((o) => o.textContent)
        expect(levels[0]).toBe('No levels (custom system)')
        expect(levels).toHaveLength(21)
        expect(card.textContent).not.toMatch(/Multihog|recommended\)/)
    })

    it('shows the last gear tier in its own words, over the generated list’s', () => {
        // The generated file keeps Multihog's label; if a pin move renames it, the override here is to be read again.
        expect(GEAR_TIERS.find((t) => t.value === 'none')!.label).toBe('None — skip gear guidance')
        const row = PREF_DIAL_GROUPS.find((g) => g.id === 'creator')!.sections[0]!.rows.find((r) => r.key === 'creatorGearTier')!
        expect(row.options!.map((o) => o.label)).toEqual(['Auto (match level)', 'Mundane only', 'Low', 'Standard', 'Well-equipped', 'Heroic', 'None (skip gear guidance)'])
    })
})
