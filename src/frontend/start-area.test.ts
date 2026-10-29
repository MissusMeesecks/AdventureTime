// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import { MULTIHOG_WALKTHROUGH_URL, START_AREA_CSS, SUMMARYCEPTION_URL, createStartArea, type StartAreaHost } from './start-area.js'

const el = (tag: string, attrs?: Record<string, string>) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n }
const settle = () => new Promise((r) => setTimeout(r, 0))

function harness(over: Partial<StartAreaHost> = {}) {
    const calls: unknown[][] = []
    const creator = el('details', { class: 'lh-creator' })
    const instant = el('details', { class: 'lh-instant' })
    const ways = el('details', { class: 'lh-ways' })
    const importCard = el('details', { class: 'lh-import' })
    const narrator = el('details', { class: 'lh-narrator' })
    const host: StartAreaHost = {
        el,
        creator, instant, ways, importCard, narrator,
        createNarratorCard: async (name) => { calls.push(['create', name]); return { id: 'c1', name, created: name !== 'Taken' } },
        savePrefs: async (patch) => { calls.push(['prefs', patch]) },
        fail: (error) => { calls.push(['fail', error instanceof Error ? error.message : String(error)]) },
        ...over,
    }
    const area = createStartArea(host)
    document.body.append(area.root)
    const q = (field: string) => area.root.querySelector(`[data-lh-field="${field}"]`) as HTMLElement
    return { area, calls, q, creator, instant, ways, importCard, narrator }
}

describe('the starting area after Multihog’s onboarding (83)', () => {
    it('lays the folds out in Multihog’s order — the hero, the box, the drawer of the other ways, the narrator’s drawer — then How It Works, Need Help, the Setup Guide and the connection', () => {
        const { area, creator, instant, ways, importCard, narrator } = harness()
        expect(area.root.classList.contains('lh-start')).toBe(true)
        expect(area.root.querySelector('summary')!.textContent).toBe('Starting the Adventure')
        const body = area.root.querySelector('.lh-start-body')!
        expect(Array.from(body.children)).toEqual([creator, instant, body.children[2], narrator, ...Array.from(body.children).slice(4)])
        expect(Array.from(body.children).map((n) => n.className.split(' ')[0])).toEqual(['lh-creator', 'lh-instant', 'lh-start-drawer', 'lh-narrator', 'lh-start-divider', 'lh-start-note', 'lh-start-how', 'lh-start-divider', 'lh-start-tip', 'lh-start-divider', 'lh-start-guide', 'lh-start-conn'])
        // The creator wears the hero's class; the narrator's fold the drawer's; the two other ways sit in their drawer.
        expect(creator.classList.contains('lh-start-creator')).toBe(true)
        expect(narrator.classList.contains('lh-start-drawer')).toBe(true)
        const other = body.children[2] as HTMLDetailsElement
        expect(other.getAttribute('data-lh-field')).toBe('start-other')
        expect(other.open).toBe(false)
        expect(other.querySelector('.lh-start-drawer-title')!.textContent).toBe('Other Ways to Begin')
        expect(Array.from(other.querySelector('.lh-start-drawer-body')!.children)).toEqual([ways, importCard])
        expect(Array.from(body.querySelectorAll('.lh-start-divider > span')).map((n) => n.textContent)).toEqual(['How It Works', 'Need Help', 'Setup Guide'])
    })

    it('carries Multihog’s facts in AdventureTime’s words: the note, the five paragraphs, the help links, the four steps, the models, and the connection shortcut', () => {
        const { q } = harness()
        expect(q('start-note').textContent).toContain('nothing is written over')
        expect((q('start-note').querySelector('a') as HTMLAnchorElement).href).toBe(SUMMARYCEPTION_URL)
        // The Lumiverse port since 84, never the SillyTavern original.
        expect(SUMMARYCEPTION_URL).toBe('https://github.com/Ryah/Lumi-Summaryception')
        expect(Array.from(q('start-guide').querySelectorAll('a')).map((a) => (a as HTMLAnchorElement).href)).toEqual([SUMMARYCEPTION_URL])
        expect(q('start-note').textContent).toContain('linked here in its Lumiverse port')
        expect(START_AREA_CSS).toContain('.lh-creator[open] > summary .lh-start-fold-chevron')
        expect(Array.from(q('start-how').querySelectorAll('b')).map((n) => n.textContent)).toEqual(['Auto-Tracking:', 'Prompt Injection:', 'Lorebook Agent 🤖:', 'World Progression 🌍:', 'Map Evolution 🗺️:'])
        expect(q('start-how').textContent).toContain('Lorebook Agent tab of the second box')
        const help = q('start-help')
        expect(help.querySelector('.lh-start-tip-title')!.textContent).toBe('Need help? Try these:')
        expect((help.querySelector('a') as HTMLAnchorElement).href).toBe(MULTIHOG_WALKTHROUGH_URL)
        expect((q('start-companion') as HTMLButtonElement).disabled).toBe(true)
        expect((q('start-companion') as HTMLButtonElement).title).toContain('A phase to come')
        const guide = q('start-guide')
        expect(guide.querySelector('.lh-start-guide-title')!.textContent).toBe('Initial Setup:')
        const steps = Array.from(guide.querySelector('ol')!.children).map((n) => n.textContent ?? '')
        expect(steps).toHaveLength(4)
        expect(steps[0]).toContain('Function Calling')
        expect(steps[0]).toContain('Text command')
        expect(steps[1]).toContain('Connections & models')
        expect(steps[2]).toContain('Narrator card name')
        expect(steps[3]).toContain('Instant Action')
        expect(guide.textContent).toContain('Token Optimization:')
        expect(Array.from(guide.querySelectorAll('ul > li')).map((n) => n.textContent)).toEqual(['MiMo 2.5 Pro', 'DeepSeek V4 Pro and the latest Flash', 'GPT-5.6 Luna, for its cost-efficiency; a decent model overall'])
        expect(guide.textContent).toContain('Combat API Override')
        expect(guide.textContent).toContain('not AdventureTime’s to switch')
        expect(q('start-connection').textContent).toContain('Shared by the Character Creator, Instant Action and Other Ways to Begin')
        expect(START_AREA_CSS).toContain('.lh-start-hero-btn')
        expect(START_AREA_CSS).toContain('.lh-start-drawer[open] > summary .lh-start-drawer-chevron')
    })

    it('makes the narrator card from the Setup Guide: the name saved as a preference, the card made or found, a refusal in red, and the preference read back', async () => {
        const { q, calls, area } = harness()
        const name = q('start-narrator-name') as HTMLInputElement
        const button = q('start-narrator-create') as HTMLButtonElement
        const note = q('start-narrator-note')
        expect(name.value).toBe('Game Master')
        name.value = '  '
        name.dispatchEvent(new Event('change'))
        await settle()
        expect(calls).toContainEqual(['prefs', { narratorCardName: 'Game Master' }])
        name.value = 'Aurelius'
        name.dispatchEvent(new Event('change'))
        button.click()
        expect(button.disabled).toBe(true)
        expect(note.textContent).toBe('Making the card…')
        await settle()
        expect(calls).toContainEqual(['create', 'Aurelius'])
        expect(note.textContent).toContain('Made the card “Aurelius”')
        expect(button.disabled).toBe(false)
        name.value = 'Taken'
        button.click()
        await settle()
        expect(note.textContent).toContain('A card named “Taken” already exists; nothing was made.')
        // The refusal.
        const failing = harness({ createNarratorCard: async () => { throw new Error('PERMISSION_DENIED') } })
        ;(failing.q('start-narrator-create') as HTMLButtonElement).click()
        await settle()
        expect(failing.q('start-narrator-note').textContent).toBe('The card could not be made: PERMISSION_DENIED')
        expect(failing.q('start-narrator-note').classList.contains('lh-start-gm-result--problem')).toBe(true)
        expect(failing.calls).toContainEqual(['fail', 'PERMISSION_DENIED'])
        // The preference read back, the box left alone while it already says so.
        area.applyPrefs({ narratorCardName: 'Chronicler' })
        expect(name.value).toBe('Chronicler')
        area.applyPrefs({ other: 1 })
        expect(name.value).toBe('Chronicler')
    })
})
