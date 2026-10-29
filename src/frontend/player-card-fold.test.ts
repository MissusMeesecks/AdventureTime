// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'

import type { CardResult, PersonaResult, PlayerCardView } from '../protocol.js'
import { createPlayerCardFold, describeCard, describeCardSteps, describePersona, type PlayerCardFold, type PlayerCardFoldHost } from './player-card-fold.js'

afterEach(() => { document.body.replaceChildren() })

const CARD = { name: 'Robin Vale', bio: 'Species: Halfling\nBody: Short, scarred.\nWorn Equipment: A duster.\nPersonality: Wry.', wordCount: 150, at: '2026-10-04T10:00:00Z' }
const EMPTY: PlayerCardView = { card: null, persona: null, personasAvailable: true, activePersona: '', activeDescribed: false }

function harness(view: PlayerCardView = EMPTY, over: Partial<PlayerCardFoldHost> = {}) {
    const ops: Array<[string, unknown]> = []
    const patches: Record<string, unknown>[] = []
    const failures: unknown[] = []
    let current = view
    const host: PlayerCardFoldHost = {
        el: (tag, attrs) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n },
        load: async () => { ops.push(['load', null]); return current },
        write: async (request) => { ops.push(['write', request]); current = { ...current, card: { ...CARD, name: request.name || CARD.name } }; return { status: 'written', at: 't', name: request.name || CARD.name, words: 11 } as CardResult },
        save: async (request) => { ops.push(['save', request]); current = { ...current, card: request.bio.trim() ? { ...CARD, name: request.name || CARD.name, bio: request.bio.trim() } : null }; return (request.bio.trim() ? { status: 'written', at: 't', name: request.name || CARD.name, words: 2 } : { status: 'removed', at: 't', name: request.name || CARD.name }) as CardResult },
        remove: async () => { ops.push(['remove', null]); current = { ...current, card: null } },
        persona: async (request) => { ops.push(['persona', request]); current = { ...current, activePersona: request.name || CARD.name }; return { status: 'active', at: 't', name: request.name || CARD.name, created: true } as PersonaResult },
        savePrefs: async (patch) => { patches.push(patch) },
        fail: (e) => failures.push(e),
        when: (iso) => `at ${iso}`,
        ...over,
    }
    const fold = createPlayerCardFold(host)
    document.body.append(fold.root)
    return { fold, ops, patches, failures, setView: (v: PlayerCardView) => { current = v } }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const button = (fold: PlayerCardFold, text: string) => Array.from(fold.root.querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement
const status = (fold: PlayerCardFold) => fold.root.querySelector('.lh-card-status')!.textContent ?? ''
const persona = (fold: PlayerCardFold) => fold.root.querySelector('.lh-card-persona')!.textContent ?? ''
const note = (fold: PlayerCardFold) => fold.root.querySelector('.lh-card-note')!.textContent ?? ''
const nameBox = (fold: PlayerCardFold) => fold.root.querySelector('[data-lh-field="card-name-input"]') as HTMLInputElement
const bioBox = (fold: PlayerCardFold) => fold.root.querySelector('[data-lh-field="card-bio-input"]') as HTMLTextAreaElement
const sections = (fold: PlayerCardFold) => Array.from(fold.root.querySelectorAll('.lh-card-section')).map((s) => [s.querySelector('b')?.textContent ?? '', s.querySelector('div')!.textContent])

describe('the words', () => {
    it('says what the card holds, where the persona stands, and what the creator\'s steps did', () => {
        const when = (iso: string) => `at ${iso}`
        expect(describeCard(EMPTY, when)).toBe('No Player Card for this chat. Write one from the sheet in the tracker’s cards, or paste one here.')
        expect(describeCard({ ...EMPTY, card: CARD }, when)).toBe('Robin Vale’s card: 4 sections, 11 words, written at 2026-10-04T10:00:00Z. The narrator sees it as [PLAYER_CHARACTER].')
        expect(describeCard({ ...EMPTY, card: { ...CARD, bio: 'Prose.', at: '' } }, when)).toBe('Robin Vale’s card: 0 sections, 1 words, written. The narrator sees it as [PLAYER_CHARACTER].')
        expect(describePersona(EMPTY)).toBe('No persona made for this character yet.')
        expect(describePersona({ ...EMPTY, personasAvailable: false })).toBe('This build cannot make personas: the host has not granted the personas permission.')
        expect(describePersona({ ...EMPTY, card: CARD, activePersona: 'robin vale' })).toBe('The persona “robin vale” is active: your messages carry the character’s name.')
        expect(describePersona({ ...EMPTY, card: CARD, activePersona: 'robin vale', activeDescribed: true })).toBe('The persona \u201crobin vale\u201d is active, and carries a description of its own: Lumiverse sends that beside the card, so empty it in Lumiverse if the two disagree.')
        expect(describePersona({ ...EMPTY, card: CARD, activePersona: 'Z' })).toBe('The active persona is “Z”, not the character. Use as persona switches to one with the character’s name.')
        expect(describePersona({ ...EMPTY, persona: { id: 'p1', name: 'Robin Vale', at: 't' } })).toBe('The persona “Robin Vale” was made for this character; none is active now.')
        expect(describeCardSteps({})).toBe('')
        expect(describeCardSteps({ card: { status: 'written', at: 't', name: 'R', words: 160 }, persona: { status: 'active', at: 't', name: 'R', created: true } })).toBe('The Player Card is written (160 words); it is in the Player Card fold. The persona “R” is made and active; if Lumiverse\u2019s persona picker does not list it yet, press its refresh button.')
        expect(describeCardSteps({ card: { status: 'failed', at: 't', name: 'R', reason: 'empty' }, persona: { status: 'active', at: 't', name: 'R', created: false } })).toBe('The Player Card was not written: empty. The persona “R” is active.')
        expect(describeCardSteps({ persona: { status: 'failed', at: 't', name: 'R', reason: 'no grant' } })).toBe('The persona could not be made: no grant.')
        expect(describeCardSteps({ card: { status: 'written', at: 't', name: 'R' }, persona: { status: 'failed', at: 't', name: 'R' } })).toBe('The Player Card is written; it is in the Player Card fold. The persona could not be made: no reason given.')
    })
})

describe('the fold', () => {
    it('starts closed with nothing, reads the card when a chat opens, draws its sections, and fills the name box', async () => {
        const { fold, ops } = harness({ ...EMPTY, card: CARD, activePersona: 'Robin Vale' })
        expect(fold.root.open).toBe(false)
        expect(status(fold)).toBe('Open a chat first.')
        expect(button(fold, 'Write the card').disabled).toBe(true)
        fold.setChat('chat-1')
        await settle()
        expect(ops).toEqual([['load', null]])
        expect(fold.root.open).toBe(false)
        expect(status(fold)).toContain('Robin Vale’s card: 4 sections')
        expect(persona(fold)).toContain('is active')
        expect(sections(fold)).toEqual([['Species', 'Halfling'], ['Body', 'Short, scarred.'], ['Worn Equipment', 'A duster.'], ['Personality', 'Wry.']])
        expect(nameBox(fold).value).toBe('Robin Vale')
        expect(button(fold, 'Write the card again').disabled).toBe(false)
        expect(button(fold, 'Remove').disabled).toBe(false)
        expect(button(fold, 'Edit the text').hidden).toBe(false)
        // Another chat starts over; no chat clears the lot.
        fold.setChat(null)
        expect(status(fold)).toBe('Open a chat first.')
        expect(nameBox(fold).value).toBe('')
    })

    it('writes the card from the sheet with the name and words, asks before replacing one, and reads it back', async () => {
        const asked: string[] = []
        const { fold, ops, patches } = harness(EMPTY, { confirm: async (m) => { asked.push(m); return !m.includes('Replace') } })
        fold.setChat('chat-1')
        await settle()
        expect(status(fold)).toContain('No Player Card')
        expect(button(fold, 'Paste a card')).toBeDefined()
        nameBox(fold).value = 'Mara'
        const words = fold.root.querySelector('[data-lh-field="card-words-input"]') as HTMLSelectElement
        words.value = '300'
        words.dispatchEvent(new Event('change'))
        await settle()
        expect(patches).toEqual([{ creatorCardWords: 300 }])
        button(fold, 'Write the card').click()
        await settle()
        expect(asked).toEqual([])
        expect(fold.busy()).toBe(false)
        expect(ops.filter(([op]) => op === 'write')).toEqual([['write', { name: 'Mara', words: 300 }]])
        expect(note(fold)).toBe('Wrote the Player Card for Mara (11 words). Ran at t.')
        expect(status(fold)).toContain('Mara’s card')
        // A second write asks, and a no leaves it.
        button(fold, 'Write the card again').click()
        await settle()
        expect(asked).toEqual(['Replace the Player Card for “Mara” with one written afresh from the sheet?'])
        expect(ops.filter(([op]) => op === 'write')).toHaveLength(1)
        // The preferences set the words.
        fold.applyPrefs({ creatorCardWords: 500 })
        expect(words.value).toBe('500')
    })

    it('holds the form while a write runs, and says so in red when it fails or throws', async () => {
        let release!: (r: CardResult) => void
        const { fold } = harness(EMPTY, { write: () => new Promise<CardResult>((resolve) => { release = resolve }) })
        fold.setChat('chat-1')
        await settle()
        button(fold, 'Write the card').click()
        await settle()
        expect(fold.busy()).toBe(true)
        expect(button(fold, 'Write the card').disabled).toBe(true)
        expect(nameBox(fold).disabled).toBe(true)
        expect((fold.root.querySelector('.lh-world-running') as HTMLElement).hidden).toBe(false)
        release({ status: 'failed', at: 't', name: 'Robin', reason: 'Persona generation returned empty.' })
        await settle()
        expect(fold.busy()).toBe(false)
        expect(note(fold)).toBe('The Player Card was not written: Persona generation returned empty. Ran at t.')
        expect(fold.root.querySelector('.lh-card-note')!.classList.contains('lh-world-note--error')).toBe(true)
        const threw = harness(EMPTY, { write: async () => { throw new Error('creator.card.write timed out after 180s') } })
        threw.fold.setChat('chat-1')
        await settle()
        button(threw.fold, 'Write the card').click()
        await settle()
        expect(note(threw.fold)).toBe('creator.card.write timed out after 180s')
    })

    it('edits the text and saves it, cancels without saving, removes an emptied card, and pastes one where there was none', async () => {
        const { fold, ops } = harness({ ...EMPTY, card: CARD })
        fold.setChat('chat-1')
        await settle()
        button(fold, 'Edit the text').click()
        expect((fold.root.querySelector('.lh-card-editor') as HTMLElement).hidden).toBe(false)
        expect((fold.root.querySelector('.lh-card-sections') as HTMLElement).hidden).toBe(true)
        expect(bioBox(fold).value).toBe(CARD.bio)
        bioBox(fold).value = 'Body: Tall now.'
        button(fold, 'Cancel').click()
        expect((fold.root.querySelector('.lh-card-editor') as HTMLElement).hidden).toBe(true)
        expect(ops.filter(([op]) => op === 'save')).toEqual([])
        button(fold, 'Edit the text').click()
        bioBox(fold).value = 'Body: Tall now.'
        nameBox(fold).value = 'Robin'
        button(fold, 'Save').click()
        await settle()
        expect(ops.filter(([op]) => op === 'save')).toEqual([['save', { name: 'Robin', bio: 'Body: Tall now.' }]])
        expect(note(fold)).toBe('Saved the Player Card for Robin.')
        expect(sections(fold)).toEqual([['Body', 'Tall now.']])
        // Saved empty, the card goes.
        button(fold, 'Edit the text').click()
        bioBox(fold).value = '  '
        button(fold, 'Save').click()
        await settle()
        expect(note(fold)).toBe('The card was empty, so it was removed.')
        expect(status(fold)).toContain('No Player Card')
        // Pasting where there is none.
        button(fold, 'Paste a card').click()
        expect(bioBox(fold).value).toBe('')
        bioBox(fold).value = 'Personality: Grim.'
        button(fold, 'Save').click()
        await settle()
        expect(sections(fold)).toEqual([['Personality', 'Grim.']])
    })

    it('rewrites the card with AI (78c): the request pane, the legacy’s refusal of blank instructions, the revised card for review, Regenerate, Cancel and Apply through save', async () => {
        const asked: Array<[string, string]> = []
        let reply = 'Species: Halfling\nBody: Short, scarred, and now one-eyed.'
        const { fold, ops } = harness({ ...EMPTY, card: CARD }, { aiEdit: async (content, instructions) => { asked.push([content, instructions]); return { text: reply } } })
        fold.setChat('chat-1')
        await settle()
        const pane = fold.root.querySelector('[data-lh-field="card-ai-pane"]') as HTMLElement
        const field = <T extends HTMLElement>(name: string) => fold.root.querySelector(`[data-lh-field="${name}"]`) as T
        expect(pane.hidden).toBe(true)
        expect(field<HTMLButtonElement>('card-ai-edit').hidden).toBe(false)
        field<HTMLButtonElement>('card-ai-edit').click()
        expect(pane.hidden).toBe(false)
        expect((fold.root.querySelector('.lh-card-sections') as HTMLElement).hidden).toBe(true)
        expect(button(fold, 'Edit the text').hidden).toBe(true)
        // Blank instructions: the legacy's words, and no call.
        field<HTMLButtonElement>('card-ai-generate').click()
        await settle()
        expect(note(fold)).toBe('Please describe what you want changed.')
        expect(asked).toEqual([])
        field<HTMLTextAreaElement>('card-ai-instructions').value = ' lose an eye '
        field<HTMLButtonElement>('card-ai-generate').click()
        expect(field<HTMLButtonElement>('card-ai-generate').textContent).toBe('⏳ Generating…')
        await settle()
        expect(asked).toEqual([[CARD.bio, 'lose an eye']])
        expect(field<HTMLTextAreaElement>('card-ai-preview').value).toBe(reply)
        expect((fold.root.querySelector('.lh-card-ai-review') as HTMLElement).hidden).toBe(false)
        expect(note(fold)).toContain('The revised card is below')
        // Regenerate asks again with the same instructions; the box takes the new text.
        reply = 'Species: Halfling\nBody: One-eyed.'
        field<HTMLButtonElement>('card-ai-regen').click()
        await settle()
        expect(asked).toHaveLength(2)
        expect(field<HTMLTextAreaElement>('card-ai-preview').value).toBe(reply)
        // Cancel keeps the card as it was.
        field<HTMLButtonElement>('card-ai-cancel').click()
        expect(pane.hidden).toBe(true)
        expect(ops.filter(([op]) => op === 'save')).toEqual([])
        expect(sections(fold)[1]).toEqual(['Body', 'Short, scarred.'])
        // Apply saves what the box holds, edited by hand too.
        field<HTMLButtonElement>('card-ai-edit').click()
        field<HTMLTextAreaElement>('card-ai-instructions').value = 'older'
        field<HTMLButtonElement>('card-ai-generate').click()
        await settle()
        field<HTMLTextAreaElement>('card-ai-preview').value = 'Species: Halfling\nBody: One-eyed and grey.'
        field<HTMLButtonElement>('card-ai-apply').click()
        await settle()
        expect(ops.filter(([op]) => op === 'save')).toEqual([['save', { name: 'Robin Vale', bio: 'Species: Halfling\nBody: One-eyed and grey.' }]])
        expect(note(fold)).toBe('Applied the AI edit to the Player Card for Robin Vale.')
        expect(pane.hidden).toBe(true)
        expect(sections(fold)).toEqual([['Species', 'Halfling'], ['Body', 'One-eyed and grey.']])
        // A failed call says so in red and leaves the pane open; no host hook, no button.
        const failing = harness({ ...EMPTY, card: CARD }, { aiEdit: async () => { throw new Error('AI returned an empty result. Please try again.') } })
        failing.fold.setChat('chat-1')
        await settle()
        ;(failing.fold.root.querySelector('[data-lh-field="card-ai-edit"]') as HTMLElement).click()
        ;(failing.fold.root.querySelector('[data-lh-field="card-ai-instructions"]') as HTMLTextAreaElement).value = 'x'
        ;(failing.fold.root.querySelector('[data-lh-field="card-ai-generate"]') as HTMLElement).click()
        await settle()
        expect(note(failing.fold)).toBe('AI returned an empty result. Please try again.')
        expect((failing.fold.root.querySelector('[data-lh-field="card-ai-pane"]') as HTMLElement).hidden).toBe(false)
        const plain = harness({ ...EMPTY, card: CARD })
        plain.fold.setChat('chat-1')
        await settle()
        expect((plain.fold.root.querySelector('[data-lh-field="card-ai-edit"]') as HTMLElement).hidden).toBe(true)
    })

    it('removes the card after asking, and makes the persona', async () => {
        const asked: string[] = []
        const { fold, ops } = harness({ ...EMPTY, card: CARD }, { confirm: async (m) => { asked.push(m); return true } })
        fold.setChat('chat-1')
        await settle()
        nameBox(fold).value = 'Robin Vale'
        button(fold, 'Use as persona').click()
        await settle()
        expect(ops.filter(([op]) => op === 'persona')).toEqual([['persona', { name: 'Robin Vale' }]])
        expect(note(fold)).toBe('The persona “Robin Vale” is made and active; if Lumiverse\u2019s persona picker does not list it yet, press its refresh button.')
        expect(persona(fold)).toContain('“Robin Vale” is active')
        button(fold, 'Remove').click()
        await settle()
        expect(asked).toEqual(['Remove the Player Card for “Robin Vale” from this chat? The narrator stops seeing it.'])
        expect(ops.filter(([op]) => op === 'remove')).toHaveLength(1)
        expect(note(fold)).toBe('The Player Card was removed.')
        expect(status(fold)).toContain('No Player Card')
        expect(button(fold, 'Remove').disabled).toBe(true)
        // Without the permission the persona button is off and the line says why.
        const none = harness({ ...EMPTY, personasAvailable: false })
        none.fold.setChat('chat-1')
        await settle()
        expect(button(none.fold, 'Use as persona').disabled).toBe(true)
        expect(persona(none.fold)).toContain('has not granted the personas permission')
    })

    it('ignores a load that lands after the chat changed, and reports a failed load', async () => {
        let release!: (v: PlayerCardView) => void
        const { fold, failures } = harness(EMPTY, { load: () => new Promise<PlayerCardView>((resolve) => { release = resolve }) })
        fold.setChat('chat-1')
        const first = release
        fold.setChat('chat-2')
        first({ ...EMPTY, card: CARD })
        await settle()
        expect(status(fold)).toBe('Open a chat first.' === status(fold) ? 'Open a chat first.' : status(fold))
        expect(sections(fold)).toEqual([])
        release({ ...EMPTY, card: CARD })
        await settle()
        expect(sections(fold)).toHaveLength(4)
        const failing = harness(EMPTY, { load: async () => { throw new Error('disk') } })
        failing.fold.setChat('chat-1')
        await settle()
        expect(failing.failures).toHaveLength(1)
    })
})
