// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'

import type { CreatorResult } from '../protocol.js'
import { createCreatorFold, describeCreatorResult, type CreatorFold, type CreatorFoldHost } from './creator-fold.js'

afterEach(() => { document.body.replaceChildren() })

function harness(answer: () => CreatorResult | Promise<CreatorResult> = () => ({ status: 'written', at: '2026-10-04T10:00:00Z', name: 'Robin Vale', added: ['CHARACTER', 'XP'], replaced: [] }), confirm?: (message: string) => Promise<boolean>) {
    const generated: unknown[] = []
    const patches: Record<string, unknown>[] = []
    const failures: unknown[] = []
    let ids = 0
    const host: CreatorFoldHost = {
        ...(confirm ? { confirm } : {}),
        el: (tag, attrs) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n },
        generate: async (draft, options) => { generated.push([draft, options]); return answer() },
        savePrefs: async (patch) => { patches.push(patch) },
        fail: (e) => failures.push(e),
        when: (iso) => `at ${iso}`,
        random: () => 0,
        createId: () => `p${++ids}`,
    }
    const fold = createCreatorFold(host)
    document.body.append(fold.root)
    return { fold, generated, patches, failures }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const control = (fold: CreatorFold, name: string) => fold.root.querySelector(`[data-lh-field="creator-${name}-input"]`) as HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement
const button = (fold: CreatorFold, text: string) => Array.from(fold.root.querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement
const change = (node: Element) => node.dispatchEvent(new Event('change', { bubbles: true }))
const note = (fold: CreatorFold) => fold.root.querySelector('.lh-creator-note')!.textContent ?? ''

describe('the note', () => {
    it('says what the sheet holds, or why none was written', () => {
        const when = (iso: string) => `at ${iso}`
        expect(describeCreatorResult({ status: 'written', at: 't', name: 'Robin Vale', added: ['CHARACTER', 'XP'], replaced: ['TIME'] }, when)).toBe('Wrote the sheet for Robin Vale: CHARACTER, XP, TIME. It is in the tracker’s cards. Ran at t.')
        expect(describeCreatorResult({ status: 'written', at: '', name: '' }, when)).toBe('Wrote the sheet for a character the sheet does not name. It is in the tracker’s cards.')
        expect(describeCreatorResult({ status: 'failed', at: 't', name: '', reason: 'no sheet' }, when)).toBe('The sheet was not written: no sheet. Ran at t.')
        expect(describeCreatorResult({ status: 'failed', at: '', name: '' }, when)).toBe('The sheet was not written: no reason given.')
    })
})

describe('the Player Card switches (35b)', () => {
    it('reads the two switches and the words from the preferences, keeps a change, and sends them with the draft', async () => {
        const { fold, generated, patches } = harness()
        fold.setChat('chat-1', true)
        const card = control(fold, 'player-card')
        const persona = control(fold, 'persona')
        const words = control(fold, 'card-words')
        expect(card.checked).toBe(false)
        expect(persona.checked).toBe(true)
        expect(words.value).toBe('150')
        fold.applyPrefs({ creatorPlayerCard: true, creatorPersona: false, creatorCardWords: 300 })
        expect(card.checked).toBe(true)
        expect(persona.checked).toBe(false)
        expect(words.value).toBe('300')
        card.checked = false
        change(card)
        persona.checked = true
        change(persona)
        words.value = '500'
        change(words)
        await settle()
        expect(patches.slice(-3)).toEqual([{ creatorPlayerCard: false }, { creatorPersona: true }, { creatorCardWords: 500 }])
        button(fold, 'Generate the character').click()
        await settle()
        expect(generated).toHaveLength(1)
        expect((generated[0] as unknown[])[1]).toEqual({ playerCard: false, persona: true, cardWords: 500 })
        // The note carries the card's and the persona's words after the sheet's.
        const steps = harness(() => ({ status: 'written', at: '', name: 'Robin', added: ['CHARACTER'], replaced: [], card: { status: 'written', at: 't', name: 'Robin', words: 160 }, persona: { status: 'failed', at: 't', name: 'Robin', reason: 'no grant' } }))
        steps.fold.setChat('chat-1', true)
        button(steps.fold, 'Generate the character').click()
        await settle()
        expect(note(steps.fold)).toBe('Wrote the sheet for Robin: CHARACTER. It is in the tracker’s cards. The Player Card is written (160 words); it is in the Player Card fold. The persona could not be made: no grant.')
    })
})

describe('the fold', () => {
    it('starts closed and blank, stays folded on a chat with no memo (84; it opened itself before), wears the drawers’ chevron, and disables Generate without a chat', () => {
        const { fold } = harness()
        expect(fold.root.open).toBe(false)
        expect(fold.root.querySelector('summary .lh-start-hero-btn .lh-start-fold-chevron')!.textContent).toBe('▸')
        expect(button(fold, 'Generate the character').disabled).toBe(true)
        fold.setChat('chat-1', true)
        expect(fold.root.open).toBe(false)
        expect(button(fold, 'Generate the character').disabled).toBe(false)
        fold.root.open = true
        fold.setChat('chat-1', true)
        expect(fold.root.open).toBe(true)
        fold.setChat('chat-2', false)
        expect(fold.root.open).toBe(true)
        fold.root.open = false
        fold.setChat(null, true)
        expect(button(fold, 'Generate the character').disabled).toBe(true)
        expect(control(fold, 'class').value).toBe('__story__')
        expect(Array.from(control(fold, 'class').options).map((o) => o.value)).toEqual(['__other__', '__story__'])
        expect((control(fold, 'class-other').parentElement as HTMLElement).hidden).toBe(true)
    })

    it('lists a genre\'s classes when a genre is picked, shows the own-class box for Other, and keeps every change as the draft', async () => {
        const { fold, patches } = harness()
        fold.setChat('chat-1', true)
        control(fold, 'genre').value = 'fantasy'
        change(control(fold, 'genre'))
        expect(control(fold, 'class').options.length).toBe(22)
        expect(control(fold, 'class').value).toBe('__story__')
        control(fold, 'class').value = '__other__'
        change(control(fold, 'class'))
        expect((control(fold, 'class-other').parentElement as HTMLElement).hidden).toBe(false)
        control(fold, 'class-other').value = 'Beekeeper'
        change(control(fold, 'class-other'))
        control(fold, 'name').value = 'Robin Vale'
        change(control(fold, 'name'))
        await settle()
        expect(patches.at(-1)).toEqual({ creatorDraft: expect.objectContaining({ name: 'Robin Vale', genre: 'fantasy', class: '__other__', classOther: 'Beekeeper' }) })
        expect(fold.draft()).toMatchObject({ name: 'Robin Vale', genre: 'fantasy', class: '__other__', classOther: 'Beekeeper', level: 1, gearTier: 'auto', combatScalingGuide: true })
        // The level, tier and guide are the form's defaults as well as the draft's.
        control(fold, 'level').value = 'none'
        change(control(fold, 'level'))
        control(fold, 'gear-tier').value = 'heroic'
        change(control(fold, 'gear-tier'))
        const combat = fold.root.querySelector('[data-lh-field="creator-combat-guide"] input') as HTMLInputElement
        combat.checked = false
        change(combat)
        control(fold, 'start-date').value = '14/02/2026'
        change(control(fold, 'start-date'))
        await settle()
        expect(patches.find((p) => 'creatorLevel' in p)).toMatchObject({ creatorLevel: 'none' })
        expect(patches.find((p) => 'creatorGearTier' in p)).toMatchObject({ creatorGearTier: 'heroic' })
        expect(patches.find((p) => 'creatorCombatScalingGuide' in p)).toMatchObject({ creatorCombatScalingGuide: false })
        expect(patches.find((p) => 'creatorInitialDate' in p)).toEqual({ creatorInitialDate: '14/02/2026' })
        expect(fold.draft()).toMatchObject({ level: 'none', gearTier: 'heroic', combatScalingGuide: false })
    })

    it('takes the starting choices from the category’s mirror (63c), leaving the draft and a control being typed in alone', () => {
        const { fold, patches } = harness()
        fold.applyPrefs({ creatorDraft: { name: 'Odran', genre: 'horror', class: 'Occultist', level: 4 }, creatorLevel: 2, creatorGearTier: 'low', creatorInitialDate: 'Day 3', creatorPresets: [] })
        fold.applyDefaults({ creatorLevel: 6, creatorGearTier: 'heroic', creatorCombatScalingGuide: false, creatorInitialDate: 'Day 9', creatorInitialTime: '21:30', creatorPlayerCard: true, creatorPersona: false })
        expect(control(fold, 'name').value).toBe('Odran')
        expect(control(fold, 'level').value).toBe('6')
        expect(control(fold, 'gear-tier').value).toBe('heroic')
        expect(control(fold, 'start-date').value).toBe('Day 9')
        expect(control(fold, 'start-time').value).toBe('21:30')
        expect((fold.root.querySelector('[data-lh-field="creator-combat-guide"] input') as HTMLInputElement).checked).toBe(false)
        expect(patches).toEqual([])
        control(fold, 'start-date').focus()
        fold.applyDefaults({ creatorInitialDate: 'Day 1', creatorLevel: 1 })
        expect(control(fold, 'start-date').value).toBe('Day 9')
        expect(control(fold, 'level').value).toBe('1')
    })

    it('fills the form from the preferences, rolls a name from the genre, and clears the form to the defaults', async () => {
        const { fold, patches } = harness()
        fold.applyPrefs({ creatorDraft: { name: 'Odran', genre: 'horror', class: 'Occultist', level: 4 }, creatorLevel: 2, creatorGearTier: 'low', creatorCombatScalingGuide: false, creatorInitialDate: 'Day 3', creatorInitialTime: '21:30', creatorConnectionId: 'conn-9', creatorPresets: [] })
        expect(control(fold, 'name').value).toBe('Odran')
        expect(control(fold, 'genre').value).toBe('horror')
        expect(control(fold, 'class').value).toBe('Occultist')
        expect(control(fold, 'level').value).toBe('4')
        expect(control(fold, 'start-date').value).toBe('Day 3')
        expect(control(fold, 'start-time').value).toBe('21:30')
        expect(patches).toEqual([])
        button(fold, '🎲').click()
        expect(control(fold, 'name').value).toBe('Abigail Blackwood')
        button(fold, 'Clear the form').click()
        expect(control(fold, 'name').value).toBe('')
        expect(control(fold, 'genre').value).toBe('')
        expect(control(fold, 'level').value).toBe('2')
        expect(control(fold, 'gear-tier').value).toBe('low')
        await settle()
        expect(patches.at(-1)).toEqual({ creatorDraft: null })
    })

    it('saves, loads and deletes presets by name, and remembers them as a preference', async () => {
        const { fold, patches } = harness()
        const select = fold.root.querySelector('[data-lh-field="creator-preset"]') as HTMLSelectElement
        expect(select.options[0]!.textContent).toBe('No presets saved yet')
        expect(button(fold, 'Load').disabled).toBe(true)
        control(fold, 'name').value = 'Robin'
        const nameBox = fold.root.querySelector('[data-lh-field="creator-preset-name"]') as HTMLInputElement
        button(fold, 'Save').click()
        expect(patches.filter((p) => 'creatorPresets' in p)).toEqual([])
        nameBox.value = 'Rogue'
        button(fold, 'Save').click()
        await settle()
        expect(patches.at(-1)).toEqual({ creatorPresets: [{ id: 'p1', name: 'Rogue', data: expect.objectContaining({ name: 'Robin' }) }] })
        expect(select.value).toBe('p1')
        expect(nameBox.value).toBe('')
        // A same-named save replaces under the same id; a different name adds.
        control(fold, 'name').value = 'Robin Vale'
        nameBox.value = ' rogue '
        button(fold, 'Save').click()
        nameBox.value = 'Wizard'
        button(fold, 'Save').click()
        await settle()
        const saved = (patches.at(-1) as { creatorPresets: Array<{ id: string; name: string; data: { name: string } }> }).creatorPresets
        expect(saved.map((p) => [p.id, p.name, p.data.name])).toEqual([['p1', 'rogue', 'Robin Vale'], ['p2', 'Wizard', 'Robin Vale']])
        // Load puts the preset's draft in the form; Delete removes it.
        control(fold, 'name').value = 'someone else'
        select.value = 'p1'
        change(select)
        button(fold, 'Load').click()
        expect(control(fold, 'name').value).toBe('Robin Vale')
        button(fold, 'Delete').click()
        await settle()
        expect((patches.at(-1) as { creatorPresets: unknown[] }).creatorPresets).toHaveLength(1)
        expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'p2'])
        expect(select.value).toBe('')
    })

    it('asks before replacing a same-named preset when the host can ask, and keeps the old one on no (35-bis)', async () => {
        const asked: string[] = []
        let answer = false
        const { fold, patches } = harness(undefined, async (message) => { asked.push(message); return answer })
        const nameBox = fold.root.querySelector('[data-lh-field="creator-preset-name"]') as HTMLInputElement
        control(fold, 'name').value = 'Robin'
        nameBox.value = 'Rogue'
        button(fold, 'Save').click()
        await settle()
        expect(asked).toEqual([])
        control(fold, 'name').value = 'Someone Else'
        nameBox.value = ' ROGUE '
        button(fold, 'Save').click()
        await settle()
        expect(asked).toEqual(['A preset named “Rogue” already exists. Replace it with the form as it is now?'])
        expect((patches.at(-1) as { creatorPresets: Array<{ name: string; data: { name: string } }> }).creatorPresets).toEqual([expect.objectContaining({ name: 'Rogue', data: expect.objectContaining({ name: 'Robin' }) })])
        expect(nameBox.value).toBe(' ROGUE ')
        answer = true
        button(fold, 'Save').click()
        await settle()
        expect((patches.at(-1) as { creatorPresets: Array<{ id: string; name: string; data: { name: string } }> }).creatorPresets).toEqual([{ id: 'p1', name: 'ROGUE', data: expect.objectContaining({ name: 'Someone Else' }) }])
        expect(nameBox.value).toBe('')
    })

    it('writes the sheet with the draft, says it is running, then says what it wrote, and reports a failure in red', async () => {
        let release: (r: CreatorResult) => void = () => undefined
        const { fold, generated } = harness(() => new Promise<CreatorResult>((resolve) => { release = resolve }))
        fold.setChat('chat-1', true)
        control(fold, 'name').value = 'Robin Vale'
        button(fold, 'Generate the character').click()
        expect(fold.busy()).toBe(true)
        expect((fold.root.querySelector('.lh-world-running') as HTMLElement).hidden).toBe(false)
        expect(button(fold, 'Generate the character').disabled).toBe(true)
        expect(control(fold, 'name').disabled).toBe(true)
        expect(generated.map((g) => (g as unknown[])[0])).toEqual([expect.objectContaining({ name: 'Robin Vale' })])
        release({ status: 'written', at: '2026-10-04T10:00:00Z', name: 'Robin Vale', added: ['CHARACTER'], replaced: [] })
        await settle()
        expect(fold.busy()).toBe(false)
        expect((fold.root.querySelector('.lh-world-running') as HTMLElement).hidden).toBe(true)
        expect(note(fold)).toBe('Wrote the sheet for Robin Vale: CHARACTER. It is in the tracker’s cards. Ran at 2026-10-04T10:00:00Z.')
        expect(fold.root.querySelector('.lh-creator-note')!.classList.contains('lh-world-note--error')).toBe(false)
        const failing = harness(() => { throw new Error('the pass threw') })
        failing.fold.setChat('chat-1', false)
        button(failing.fold, 'Generate the character').click()
        await settle()
        expect(note(failing.fold)).toMatch(/^The sheet was not written: the pass threw\./)
        expect(failing.fold.root.querySelector('.lh-creator-note')!.classList.contains('lh-world-note--error')).toBe(true)
        const refused = harness(() => ({ status: 'failed', at: 't', name: '', reason: 'no character sheet' }))
        refused.fold.setChat('chat-1', false)
        button(refused.fold, 'Generate the character').click()
        await settle()
        expect(note(refused.fold)).toBe('The sheet was not written: no character sheet. Ran at t.')
    })

    it('offers the connections, keeps a chosen one that is no longer listed, and saves the choice', async () => {
        const { fold, patches } = harness()
        fold.applyPrefs({ creatorConnectionId: 'gone' })
        fold.setConnections([{ id: 'c1', name: 'Fast', model: 'small' }], '')
        const select = fold.root.querySelector('[data-lh-field="creator-connection"] select') as HTMLSelectElement
        expect(Array.from(select.options).map((o) => [o.value, o.textContent])).toEqual([['', 'The tracker’s connection'], ['c1', 'Fast — small'], ['gone', 'The connection you chose is no longer listed']])
        expect(select.value).toBe('gone')
        select.value = 'c1'
        change(select)
        await settle()
        expect(patches.at(-1)).toEqual({ creatorConnectionId: 'c1' })
        fold.setConnections([], 'The host refused the list')
        expect(fold.root.querySelector('[data-lh-field="creator-connection"] .lh-conn-hint')!.textContent).toBe('The host refused the list')
    })
})
