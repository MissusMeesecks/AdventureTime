// @vitest-environment happy-dom

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import manifest from '../../spindle.json'
import type { StatusResult } from '../protocol.js'
import { SUMMARISER_CHECK, checklistItems } from './core-card.js'
import { GUIDE_FILE, GUIDE_URL, MAKE_CHARACTER_HELP, MULTIHOG_WALKTHROUGH_URL, START_AREA_CSS, START_CHECKS, START_MARKS, SUMMARYCEPTION_URL, createStartArea, startReady, type StartAreaHost } from './start-area.js'

const el = (tag: string, attrs?: Record<string, string>) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n }
const settle = () => new Promise((r) => setTimeout(r, 0))
const details = (cls: string) => el('details', { class: cls }) as HTMLDetailsElement
/** The note a `[?]` button opens. */
const noteOf = (button: Element): HTMLElement => button.ownerDocument.getElementById(button.getAttribute('aria-controls')!)!

/** A status as the backend answers it: the passes' connection and the narrator card's standing. */
function status(passes: Partial<NonNullable<StatusResult['passes']>> | null, narrator?: Partial<NonNullable<StatusResult['narrator']>> | null): StatusResult {
    return {
        version: '1.0.0', granted: [], missing: [], checked: true,
        ...(passes ? { passes: { id: 'conn-1', name: 'Hearth', provider: 'openrouter', model: 'lantern-2', why: 'seen', maxTokens: null, ...passes } } : {}),
        ...(narrator ? { narrator: { name: 'Game Master', exists: true, chat: 'narrator', chatCardName: 'Game Master', ...narrator } } : {}),
    } as StatusResult
}

function harness(over: Partial<StartAreaHost> = {}) {
    const calls: unknown[][] = []
    const creator = details('lh-creator lh-start-option')
    const instant = details('lh-instant lh-start-option lh-start-option--recommended')
    const ways = details('lh-ways')
    const importCard = details('lh-import')
    const narrator = details('lh-narrator lh-start-option')
    const host: StartAreaHost = {
        el,
        creator, instant, ways, importCard, narrator,
        createNarratorCard: async (name) => { calls.push(['create', name]); return { id: 'c1', name, created: name !== 'Taken' } },
        savePrefs: async (patch) => { calls.push(['prefs', patch]) },
        refreshStatus: () => { calls.push(['refresh']) },
        fail: (error) => { calls.push(['fail', error instanceof Error ? error.message : String(error)]) },
        ...over,
    }
    const area = createStartArea(host)
    document.body.append(area.root)
    const q = (field: string) => area.root.querySelector(`[data-lh-field="${field}"]`) as HTMLElement
    return { area, calls, q, creator, instant, ways, importCard, narrator }
}

describe('Starting the adventure, in setup order (98)', () => {
    it('lays the area out as the checks, the three ways in, the Narrator block and Learn more, in that order', () => {
        const { area, creator, instant, ways, importCard, narrator, q } = harness()
        expect(area.root.classList.contains('lh-start')).toBe(true)
        expect(area.root.querySelector('summary')!.textContent).toBe('Starting the adventure')
        const body = area.root.querySelector('.lh-start-body')!
        const other = q('start-other') as HTMLDetailsElement
        // The help of "Make your character" is in the DOM from the first paint, under its heading.
        expect(Array.from(body.children)).toEqual([q('start-before'), q('start-make'), body.children[2], instant, creator, other, narrator, q('start-learn')])
        expect(body.children[2]!.className).toBe('lh-help-note')
        // Instant Action leads; the third option holds the persona and description ways and the card import.
        expect(other.getAttribute('data-lh-option')).toBe('other')
        expect(other.classList.contains('lh-start-option')).toBe(true)
        expect(other.open).toBe(false)
        expect(other.querySelector('.lh-start-option-title')!.textContent).toBe('From a persona, description or card')
        expect(other.querySelector('.lh-start-option-sub')!.textContent).toBe('Start from your active persona, a written description, or a character card.')
        expect(Array.from(other.querySelector('.lh-start-option-body')!.children)).toEqual([ways, importCard])
        // The section's one line of help, behind its [?].
        const makeTip = q('start-make').querySelector('.lh-help-tip')!
        expect(q('start-make').textContent).toBe('Make your character')
        expect(noteOf(makeTip).textContent).toBe(MAKE_CHARACTER_HELP)
        expect(noteOf(makeTip).hidden).toBe(true)
        expect((q('start-learn') as HTMLDetailsElement).open).toBe(false)
    })

    it('shows three of the checklist’s items through the checklist’s own function, and the summariser’s check as a fourth: the mark, the evidence, and a [?] each', () => {
        const { area, q } = harness()
        expect(START_CHECKS.map((c) => [c.id, c.title, c.counts])).toEqual([['narrator', 'Narrator card', true], ['passes', 'Passes have a connection', true], ['tools', 'Function calling (optional)', false], ['summariser', 'Summariser for long chats (recommended)', false]])
        // Nothing read yet: every row ❔ with the checklist's own words.
        for (const check of START_CHECKS) {
            const row = q(`start-check-${check.id}`)
            expect(row.querySelector('.lh-start-check-mark')!.textContent).toBe('❔')
            expect(row.querySelector('.lh-start-check-evidence')!.textContent).toBe([...checklistItems(null), SUMMARISER_CHECK].find((i) => i.id === check.id)!.evidence)
            const tip = row.querySelector('.lh-help-tip')!
            expect(noteOf(tip).textContent).toBe(check.help)
            expect(noteOf(tip).hidden).toBe(true)
        }
        // A status: the same state and evidence the checklist would show for it, row by row.
        const told = status({ why: 'first' }, { exists: false })
        area.applyStatus(told)
        for (const check of START_CHECKS) {
            const item = [...checklistItems(told), SUMMARISER_CHECK].find((i) => i.id === check.id)!
            const row = q(`start-check-${check.id}`)
            expect(row.querySelector('.lh-start-check-mark')!.textContent).toBe(START_MARKS[item.state])
            expect(row.querySelector('.lh-start-check-evidence')!.textContent).toBe(item.evidence)
            expect(row.getAttribute('data-lh-state')).toBe(item.state)
        }
        expect(q('start-check-passes').getAttribute('data-lh-state')).toBe('warn')
        expect(q('start-check-narrator').querySelector('.lh-start-check-evidence')!.textContent).toContain('No card named “Game Master” yet')
        // The function-calling row names the two controls by their names on the Narrator card.
        expect(START_CHECKS[2]!.help).toContain('"Pre-seeded queue only" for Dice (RNG)')
        expect(START_CHECKS[2]!.help).toContain('"Text block" for How the narrator asks for a map')
        // No button on the optional row; the other checks stay in the checklist.
        expect(q('start-check-tools').querySelector('button.lh-button')).toBeNull()
        expect(q('start-open-checklist').textContent).toBe('Open Lumiverse checklist')
        // The summariser row (1.1.2): last, under function calling, always ❔, its link opening in a new tab.
        expect(Array.from(q('start-before').querySelectorAll('.lh-start-check')).map((r) => r.getAttribute('data-lh-field'))).toEqual(['start-check-narrator', 'start-check-passes', 'start-check-tools', 'start-check-summariser'])
        const sum = q('start-check-summariser')
        expect(sum.querySelector('.lh-start-check-head span')!.textContent).toBe('Summariser for long chats (recommended)')
        expect(sum.querySelector('.lh-start-check-mark')!.textContent).toBe('❔')
        expect(sum.querySelector('.lh-start-check-evidence')!.textContent).toBe(SUMMARISER_CHECK.evidence)
        const anchors = Array.from(sum.querySelectorAll('a')) as HTMLAnchorElement[]
        expect(anchors.map((a) => [a.textContent, a.getAttribute('href'), a.target, a.rel])).toEqual([['Open Lumi-Summaryception', 'https://github.com/Ryah/Lumi-Summaryception', '_blank', 'noopener noreferrer']])
    })

    it('folds to Ready to play when the narrator card and the connection are ✅, whatever function calling says, and opens again when one drops', () => {
        const { area, q } = harness()
        const before = q('start-before') as HTMLDetailsElement
        const ready = q('start-ready')
        const title = before.querySelector('summary .lh-start-step') as HTMLElement
        expect(before.open).toBe(true)
        expect(ready.hidden).toBe(true)
        expect(title.hidden).toBe(false)
        // Both ✅ (function calling still ❔): the one line, the rows folded away.
        area.applyStatus(status({}, {}))
        expect(q('start-check-tools').getAttribute('data-lh-state')).toBe('unknown')
        expect(before.open).toBe(false)
        expect(ready.hidden).toBe(false)
        expect(ready.textContent).toBe('✅ Ready to play')
        expect(title.hidden).toBe(true)
        // A hand's toggle stands through a status that says the same.
        before.open = true
        area.applyStatus(status({}, {}))
        expect(before.open).toBe(true)
        before.open = false
        // A ⚠️ on the connection opens it again; so does a chat from another card, and no connection at all.
        area.applyStatus(status({ why: 'first' }, {}))
        expect(before.open).toBe(true)
        expect(ready.hidden).toBe(true)
        expect(title.hidden).toBe(false)
        area.applyStatus(status({}, {}))
        expect(before.open).toBe(false)
        area.applyStatus(status({}, { chat: 'other', chatCardName: 'Bramble' }))
        expect(before.open).toBe(true)
        area.applyStatus(status({ id: '', why: 'none' }, {}))
        expect(ready.hidden).toBe(true)
        // A narrator check that cannot be read does not hold the fold open: Ready is the connection alone.
        area.applyStatus(status({}, null))
        expect(q('start-check-narrator').getAttribute('data-lh-state')).toBe('unknown')
        expect(before.open).toBe(false)
        // The rule on its own.
        expect(startReady(checklistItems(status({}, {})))).toBe(true)
        expect(startReady(checklistItems(status({}, { exists: false })))).toBe(false)
        expect(startReady(checklistItems(status(null, {})))).toBe(false)
        expect(startReady(checklistItems(null))).toBe(false)
        // The hidden line and the hidden title have rules of their own, since both carry a display.
        expect(START_AREA_CSS).toContain('.lh-start-ready[hidden] { display: none; }')
        expect(START_AREA_CSS).toContain('.lh-start-step[hidden] { display: none; }')
    })

    it('keeps one way in open at a time: opening one closes the other two', () => {
        const { creator, instant, q } = harness()
        const other = q('start-other') as HTMLDetailsElement
        const open = (d: HTMLDetailsElement) => { d.open = true; d.dispatchEvent(new Event('toggle')) }
        open(instant)
        expect([instant.open, creator.open, other.open]).toEqual([true, false, false])
        open(creator)
        expect([instant.open, creator.open, other.open]).toEqual([false, true, false])
        open(other)
        expect([instant.open, creator.open, other.open]).toEqual([false, false, true])
        // Closing one opens nothing, and the Narrator block is not one of the three.
        other.open = false
        other.dispatchEvent(new Event('toggle'))
        expect([instant.open, creator.open, other.open]).toEqual([false, false, false])
    })

    it('leaves the Narrator block out of the one-open rule', () => {
        const { creator, narrator } = harness()
        creator.open = true
        creator.dispatchEvent(new Event('toggle'))
        narrator.open = true
        narrator.dispatchEvent(new Event('toggle'))
        expect([creator.open, narrator.open]).toEqual([true, true])
    })

    it('opens Connections & models in the same tab and presses the checklist’s own button', () => {
        const { q } = harness()
        const category = el('details', { class: 'lh-category', 'data-lh-category': 'connections' }) as HTMLDetailsElement
        let scrolled = 0
        category.scrollIntoView = () => { scrolled += 1 }
        const row = el('div', { 'data-lh-field': 'lumiverse-checklist' })
        const checklist = el('button', { type: 'button', class: 'lh-button' }) as HTMLButtonElement
        let pressed = 0
        checklist.addEventListener('click', () => { pressed += 1 })
        row.append(checklist)
        document.body.append(category, row)
        ;(q('start-open-connections') as HTMLButtonElement).click()
        expect(category.open).toBe(true)
        expect(scrolled).toBe(1)
        ;(q('start-open-checklist') as HTMLButtonElement).click()
        expect(pressed).toBe(1)
        category.remove()
        row.remove()
    })

    it('says how it works in four lines, the summariser advice once, the models with their credit and the walkthrough, and none of what was cut', () => {
        const { area, q } = harness()
        const learn = q('start-learn')
        expect(learn.querySelector('summary')!.textContent).toBe('Learn more')
        expect(Array.from(learn.querySelectorAll('.lh-start-learn-title')).map((n) => n.textContent)).toEqual(['How it works', 'Save tokens', 'Which models', 'Video walkthrough'])
        expect(Array.from(learn.querySelectorAll('b')).map((n) => n.textContent)).toEqual(['State Tracker:', 'Lorebook Agent:', 'World Progression:', 'Map Evolution:'])
        expect(learn.textContent).toContain('AdventureTime adds its rulebook to every reply. Your narrator card’s own prompt is never changed.')
        expect(Array.from(learn.querySelectorAll('a')).map((a) => (a as HTMLAnchorElement).href)).toEqual([GUIDE_URL, SUMMARYCEPTION_URL, MULTIHOG_WALKTHROUGH_URL])
        // The guide is the fold's first line, and its address ends at the file the repository ships.
        expect(learn.querySelector('.lh-start-learn-body')!.firstElementChild).toBe(area.root.querySelector('[data-lh-field="start-guide-link"]'))
        expect(area.root.querySelector('[data-lh-field="start-guide-link"]')!.textContent).toBe('Read the AdventureTime guide: what each part does and how a turn runs.')
        expect(GUIDE_URL).toBe(`${manifest.github}/blob/main/guide/AdventureTime-guide.md`)
        expect(GUIDE_URL).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/main\/guide\//)
        expect(existsSync(join(process.cwd(), GUIDE_FILE))).toBe(true)
        // The Lumiverse port since 84, never the SillyTavern original.
        expect(SUMMARYCEPTION_URL).toBe('https://github.com/Ryah/Lumi-Summaryception')
        expect(learn.textContent!.match(/summariser/gi)).toHaveLength(1)
        expect(Array.from(learn.querySelectorAll('ul > li')).map((n) => n.textContent)).toEqual(['MiMo 2.5 Pro', 'DeepSeek V4 Pro and the latest Flash', 'GPT-5.6 Luna, for its cost-efficiency; a decent model overall'])
        expect(learn.textContent).toContain('It shows Multihog in SillyTavern. The pieces are the same here.')
        // What was cut: the Companion button, the Combat Override line, the Note, the connection box, the dividers, the tip box.
        const all = area.root.textContent ?? ''
        expect(all).not.toMatch(/Adventure Companion|Combat API Override|Character Creation Connection|It just works|Need help\? Try these|Initial Setup/)
        for (const field of ['start-companion', 'start-note', 'start-connection', 'start-divider', 'start-help', 'start-guide', 'start-how']) expect(q(field)).toBeNull()
        for (const dead of ['.lh-start-note', '.lh-start-tip', '.lh-start-conn', '.lh-start-companion', '.lh-start-divider', '.lh-start-hero', '.lh-start-drawer']) expect(START_AREA_CSS).not.toContain(dead)
        // UI text rules: Lumiverse by name, no phase numbers.
        expect(all).not.toMatch(/the host\b|beta|Phase \d/)
    })

    // 98-bis: the raw memo fold still wore the drawer's classes after 98 took their rules out, and drew unstyled.
    it('leaves no frontend source wearing a class of the removed drawer, hero or divider styles', () => {
        const dir = dirname(fileURLToPath(import.meta.url))
        const wearing = readdirSync(dir)
            .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
            .filter((name) => /lh-start-(drawer|hero|fold-chevron|divider|note|tip|conn|companion)/.test(readFileSync(join(dir, name), 'utf8')))
        expect(wearing).toEqual([])
    })

    it('gives the recommended option the accent border and a glow that stops once it is open', () => {
        expect(START_AREA_CSS).toContain('.lh-start-option--recommended { border-color: var(--lh-accent, var(--lumiverse-primary, #d4a940));')
        expect(START_AREA_CSS).toContain('animation: lh-start-option-glow')
        expect(START_AREA_CSS).toContain('.lh-start-option--recommended[open] { animation: none; box-shadow: none; }')
        expect(START_AREA_CSS).toContain('.lh-start-option[open] > summary .lh-chevron { transform: rotate(45deg); }')
    })

    it('makes the narrator card from its check row: the name saved as a preference, the card made or found, a refusal in red, the checks asked to read again', async () => {
        const { q, calls, area } = harness()
        const row = q('start-check-narrator')
        const name = q('start-narrator-name') as HTMLInputElement
        const button = q('start-narrator-create') as HTMLButtonElement
        const note = q('start-narrator-note')
        expect(row.contains(name) && row.contains(button) && row.contains(note)).toBe(true)
        expect(name.value).toBe('Game Master')
        expect(name.getAttribute('aria-label')).toBe('Narrator card name')
        name.value = '  '
        name.dispatchEvent(new Event('change'))
        await settle()
        expect(calls).toContainEqual(['prefs', { narratorCardName: 'Game Master' }])
        // A changed name is a different card to look for.
        expect(calls.filter((c) => c[0] === 'refresh')).toHaveLength(1)
        name.value = 'Lanternkeeper'
        name.dispatchEvent(new Event('change'))
        button.click()
        expect(button.disabled).toBe(true)
        expect(note.textContent).toBe('Creating the card…')
        await settle()
        expect(calls).toContainEqual(['create', 'Lanternkeeper'])
        expect(note.textContent).toContain('Created the card “Lanternkeeper”')
        expect(button.disabled).toBe(false)
        expect(calls.filter((c) => c[0] === 'refresh')).toHaveLength(3)
        name.value = 'Taken'
        button.click()
        await settle()
        expect(note.textContent).toContain('A card named “Taken” already exists, so nothing was created.')
        // The refusal: said in red, and nothing to read again.
        const failing = harness({ createNarratorCard: async () => { throw new Error('PERMISSION_DENIED') } })
        ;(failing.q('start-narrator-create') as HTMLButtonElement).click()
        await settle()
        expect(failing.q('start-narrator-note').textContent).toBe('The card could not be created: PERMISSION_DENIED')
        expect(failing.q('start-narrator-note').classList.contains('lh-start-gm-result--problem')).toBe(true)
        expect(failing.calls).toContainEqual(['fail', 'PERMISSION_DENIED'])
        expect(failing.calls.filter((c) => c[0] === 'refresh')).toHaveLength(0)
        // The preference read back, the box left alone while it already says so.
        area.applyPrefs({ narratorCardName: 'Chronicler' })
        expect(name.value).toBe('Chronicler')
        area.applyPrefs({ other: 1 })
        expect(name.value).toBe('Chronicler')
    })
})
