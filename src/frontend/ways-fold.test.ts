// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'

import type { WaysResult } from '../protocol.js'
import { rollCreatorName } from '../tracker/creator.js'
import { createWaysFold, describeWaysResult, type WaysFold, type WaysFoldHost } from './ways-fold.js'

afterEach(() => { document.body.replaceChildren() })

const WRITTEN: WaysResult = { status: 'written', at: '2026-10-04T10:00:00Z', way: 'custom', name: 'Robin Vale', added: ['CHARACTER', 'XP'], replaced: [] }

function harness(answer: () => WaysResult | Promise<WaysResult> = () => WRITTEN) {
    const begun: unknown[] = []
    const patches: Record<string, unknown>[] = []
    const failures: unknown[] = []
    const host: WaysFoldHost = {
        el: (tag, attrs) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n },
        begin: async (request) => { begun.push(request); return answer() },
        savePrefs: async (patch) => { patches.push(patch) },
        fail: (e) => failures.push(e),
        when: (iso) => `at ${iso}`,
        random: () => 0,
    }
    const fold = createWaysFold(host)
    document.body.append(fold.root)
    return { fold, begun, patches, failures }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const control = (fold: WaysFold, name: string) => fold.root.querySelector(`[data-lh-field="ways-${name}-input"]`) as HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement
const button = (fold: WaysFold, text: string) => Array.from(fold.root.querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement
const note = (fold: WaysFold) => fold.root.querySelector('.lh-ways-note')!.textContent ?? ''
const hint = (fold: WaysFold) => fold.root.querySelector('[data-lh-field="ways-name-hint"]')!.textContent ?? ''
const PERSONA = '🎭 From the active persona'
const CUSTOM = '⚙️ From the instructions'
const type = (node: HTMLInputElement | HTMLTextAreaElement, value: string) => { node.value = value; node.dispatchEvent(new Event('input')); node.dispatchEvent(new Event('change')) }

describe('the note', () => {
    it('says which way wrote the sheet, for whom, from what, and what the steps did', () => {
        const when = (iso: string) => `at ${iso}`
        expect(describeWaysResult(WRITTEN, when)).toBe('Wrote the sheet for Robin Vale from the instructions: CHARACTER, XP. It is in the tracker’s cards. Ran at 2026-10-04T10:00:00Z.')
        expect(describeWaysResult({ ...WRITTEN, way: 'persona', source: 'Z', at: '', card: { status: 'written', at: 't', name: 'Robin Vale', words: 160 } }, when)).toBe('Wrote the sheet for Robin Vale from the persona “Z”: CHARACTER, XP. It is in the tracker’s cards. The Player Card is written (160 words); it is in the Player Card fold.')
        expect(describeWaysResult({ status: 'written', at: '', way: 'persona', name: '' }, when)).toBe('Wrote the sheet for a character the sheet does not name from the persona. It is in the tracker’s cards.')
        expect(describeWaysResult({ status: 'failed', at: 't', way: 'persona', name: '', reason: 'No persona is set. Pick a persona in Lumiverse and try again.' }, when)).toBe('The sheet was not written from the persona: No persona is set. Pick a persona in Lumiverse and try again. Ran at t.')
        expect(describeWaysResult({ status: 'failed', at: '', way: 'custom', name: 'Robin' }, when)).toBe('The sheet was not written from the instructions: no reason given.')
    })
})

describe('the fold', () => {
    it('starts closed, needs a chat for the persona way and a name and instructions for the custom way, and says so', () => {
        const { fold } = harness()
        expect(fold.root.open).toBe(false)
        expect(button(fold, PERSONA).disabled).toBe(true)
        expect(button(fold, CUSTOM).disabled).toBe(true)
        expect(hint(fold)).toBe('Roll a genre-matched name before using From the instructions.')
        fold.setChat('chat-1')
        expect(button(fold, PERSONA).disabled).toBe(false)
        expect(button(fold, CUSTOM).disabled).toBe(true)
        expect(button(fold, CUSTOM).title).toBe('Roll or type a name first.')
        type(control(fold, 'name'), 'Robin')
        expect(hint(fold)).toBe('Name ready — edit, reroll, or choose From the instructions.')
        expect(button(fold, CUSTOM).disabled).toBe(true)
        expect(button(fold, CUSTOM).title).toBe('Write the instructions first.')
        type(control(fold, 'instructions'), 'A decker')
        expect(button(fold, CUSTOM).disabled).toBe(false)
        type(control(fold, 'name'), '  ')
        expect(button(fold, CUSTOM).disabled).toBe(true)
        fold.setChat(null)
        expect(button(fold, PERSONA).disabled).toBe(true)
        // The genres are the four, without the "none" the creator offers.
        expect(Array.from(control(fold, 'genre').options).map((o) => o.value)).toEqual(['fantasy', 'realistic', 'scifi', 'horror'])
        expect(control(fold, 'level').options[0]!.value).toBe('none')
        expect(control(fold, 'level').options.length).toBe(21)
    })

    it('rolls a name from the genre\'s pool, keeps the name and instructions as a draft, and keeps the settings as the creator\'s preferences', async () => {
        const { fold, patches } = harness()
        fold.setChat('chat-1')
        control(fold, 'genre').value = 'scifi'
        control(fold, 'genre').dispatchEvent(new Event('change'))
        button(fold, '🎲 Roll name').click()
        const rolled = control(fold, 'name').value
        expect(rolled).toBe(rollCreatorName('scifi', () => 0))
        expect(rolled).not.toBe(rollCreatorName('fantasy', () => 0))
        await settle()
        expect(patches).toEqual([{ creatorGenre: 'scifi' }, { creatorWaysDraft: { name: rolled, instructions: '' } }])
        patches.length = 0
        type(control(fold, 'instructions'), 'A decker')
        control(fold, 'level').value = 'none'
        control(fold, 'level').dispatchEvent(new Event('change'))
        control(fold, 'gear-tier').value = 'heroic'
        control(fold, 'gear-tier').dispatchEvent(new Event('change'))
        control(fold, 'combat-guide').checked = false
        control(fold, 'combat-guide').dispatchEvent(new Event('change'))
        control(fold, 'player-card').checked = true
        control(fold, 'player-card').dispatchEvent(new Event('change'))
        control(fold, 'persona').checked = false
        control(fold, 'persona').dispatchEvent(new Event('change'))
        const words = fold.root.querySelector('[data-lh-field="ways-card-words-input"]') as HTMLSelectElement
        words.value = '300'
        words.dispatchEvent(new Event('change'))
        await settle()
        expect(patches).toEqual([{ creatorWaysDraft: { name: rolled, instructions: 'A decker' } }, { creatorLevel: 'none' }, { creatorGearTier: 'heroic' }, { creatorCombatScalingGuide: false }, { creatorPlayerCard: true }, { creatorPersona: false }, { creatorCardWords: 300 }])
        // The preferences read back, draft included, without re-saving the draft.
        patches.length = 0
        fold.applyPrefs({ creatorLevel: 7, creatorGenre: 'horror', creatorGearTier: 'low', creatorCombatScalingGuide: true, creatorPlayerCard: false, creatorPersona: true, creatorCardWords: 500, creatorWaysDraft: { name: 'Mara', instructions: 'A nun' } })
        expect(control(fold, 'level').value).toBe('7')
        expect(control(fold, 'genre').value).toBe('horror')
        expect(control(fold, 'gear-tier').value).toBe('low')
        expect(control(fold, 'combat-guide').checked).toBe(true)
        expect(control(fold, 'player-card').checked).toBe(false)
        expect(control(fold, 'persona').checked).toBe(true)
        expect(words.value).toBe('500')
        expect(control(fold, 'name').value).toBe('Mara')
        expect(control(fold, 'instructions').value).toBe('A nun')
        expect(button(fold, CUSTOM).disabled).toBe(false)
        fold.applyPrefs({ creatorWaysDraft: null, creatorGenre: 'western' })
        expect(control(fold, 'name').value).toBe('')
        expect(control(fold, 'genre').value).toBe('fantasy')
        expect(patches).toEqual([])
    })

    it('begins the custom way with everything on the form, holds the form while running, and reports what came back', async () => {
        let release!: (r: WaysResult) => void
        const { fold, begun } = harness(() => new Promise<WaysResult>((resolve) => { release = resolve }))
        fold.setChat('chat-1')
        type(control(fold, 'name'), ' Robin ')
        type(control(fold, 'instructions'), 'A decker')
        control(fold, 'level').value = '5'
        control(fold, 'player-card').checked = true
        button(fold, CUSTOM).click()
        expect(fold.busy()).toBe(true)
        expect(begun).toEqual([{ way: 'custom', name: 'Robin', instructions: 'A decker', level: 5, genre: 'fantasy', gearTier: 'auto', combatScalingGuide: true, playerCard: true, persona: true, cardWords: 150 }])
        expect(button(fold, PERSONA).disabled).toBe(true)
        expect(control(fold, 'instructions').disabled).toBe(true)
        expect((fold.root.querySelector('.lh-world-running') as HTMLElement).hidden).toBe(false)
        expect(fold.root.querySelector('.lh-world-running')!.textContent).toContain('Customizing');
        (button(fold, PERSONA) as HTMLButtonElement).disabled = false
        button(fold, PERSONA).click()
        expect(begun).toHaveLength(1)
        release({ ...WRITTEN, card: { status: 'written', at: 't', name: 'Robin Vale', words: 160 } })
        await settle()
        expect(fold.busy()).toBe(false)
        expect(note(fold)).toContain('Wrote the sheet for Robin Vale from the instructions: CHARACTER, XP. It is in the tracker’s cards. The Player Card is written (160 words)')
        expect(fold.root.querySelector('.lh-ways-note')!.classList.contains('lh-world-note--error')).toBe(false)
    })

    it('begins the persona way without a name, and says in red when it fails or the request throws', async () => {
        const { fold, begun } = harness(() => ({ status: 'failed', at: 't', way: 'persona', name: '', reason: 'No persona is set. Pick a persona in Lumiverse and try again.' }))
        fold.setChat('chat-1')
        control(fold, 'level').value = 'none'
        button(fold, PERSONA).click()
        expect((begun[0] as Record<string, unknown>).way).toBe('persona')
        expect((begun[0] as Record<string, unknown>).level).toBe('none')
        expect(fold.root.querySelector('.lh-world-running')!.textContent).toContain('Embodying')
        await settle()
        expect(note(fold)).toBe('The sheet was not written from the persona: No persona is set. Pick a persona in Lumiverse and try again. Ran at t.')
        expect(fold.root.querySelector('.lh-ways-note')!.classList.contains('lh-world-note--error')).toBe(true)
        const threw = harness(() => { throw new Error('creator.ways timed out after 180s') })
        threw.fold.setChat('chat-1')
        button(threw.fold, PERSONA).click()
        await settle()
        expect(note(threw.fold)).toContain('The sheet was not written from the persona: creator.ways timed out after 180s.')
        threw.fold.setChat(null)
        expect(note(threw.fold)).toBe('')
    })
})

describe('the time & date segment (72b)', () => {
    it('writes the calendar and the clock to the cartridge, the start to the preferences, and follows both', async () => {
        const root = document.createElement('div')
        const prefs: Array<Record<string, unknown>> = []
        const settings: Array<Record<string, unknown>> = []
        const fold = createWaysFold({
            el: (tag, attrs) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n },
            begin: async () => ({ status: 'failed', at: 't', way: 'custom', name: '' }) as WaysResult,
            savePrefs: async (p) => { prefs.push(p) },
            commitSettings: async (p) => { settings.push(p) },
            fail: () => undefined,
            when: () => '',
        })
        root.append(fold.root)
        const q = (f: string) => root.querySelector(`[data-lh-field="${f}"]`) as HTMLInputElement | HTMLSelectElement
        expect((q('ways-calendar-input') as HTMLSelectElement).value).toBe('day')
        expect((q('ways-clock-input') as HTMLSelectElement).value).toBe('12')
        expect(q('ways-start-day-input').value).toBe('Day 1')
        q('ways-calendar-input').value = 'date'
        q('ways-calendar-input').dispatchEvent(new Event('change'))
        q('ways-clock-input').value = '24'
        q('ways-clock-input').dispatchEvent(new Event('change'))
        q('ways-start-day-input').value = ' Day 3 '
        q('ways-start-day-input').dispatchEvent(new Event('change'))
        q('ways-start-time-input').value = ''
        q('ways-start-time-input').dispatchEvent(new Event('change'))
        expect(settings).toEqual([{ useDdMmYyFormat: true }, { use24hTime: true }])
        expect(prefs).toEqual([{ creatorInitialDate: 'Day 3' }, { creatorInitialTime: '08:00 AM' }])
        fold.applySettings({ useDdMmYyFormat: false, use24hTime: false })
        expect((q('ways-calendar-input') as HTMLSelectElement).value).toBe('day')
        expect((q('ways-clock-input') as HTMLSelectElement).value).toBe('12')
        fold.applyPrefs({ creatorInitialDate: '01/01/2026', creatorInitialTime: '21:00' })
        expect(q('ways-start-day-input').value).toBe('01/01/2026')
        expect(q('ways-start-time-input').value).toBe('21:00')
        // Without a cartridge writer the two selects are drawn disabled.
        const bare = createWaysFold({ el: (tag, attrs) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n }, begin: async () => ({ status: 'failed', at: 't', way: 'custom', name: '' }) as WaysResult, savePrefs: async () => undefined, fail: () => undefined, when: () => '' })
        expect((bare.root.querySelector('[data-lh-field="ways-calendar-input"]') as HTMLSelectElement).disabled).toBe(true)
    })
})
