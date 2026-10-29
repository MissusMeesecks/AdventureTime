// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'

import type { InstantResult } from '../protocol.js'
import { createInstantFold, describeInstantResult, instantGenreLabel, type InstantFold, type InstantFoldHost } from './instant-fold.js'

afterEach(() => { document.body.replaceChildren() })

const READY: InstantResult = { status: 'ready', at: '2026-10-04T10:00:00Z', genre: 'fantasy', className: 'Ranger', level: 4, name: 'Robin Vale', started: true, messageId: 'm1', added: ['CHARACTER'] }

function harness(answer: () => InstantResult | Promise<InstantResult> = () => READY, over: Partial<InstantFoldHost> = {}) {
    const begun: unknown[] = []
    const patches: Record<string, unknown>[] = []
    const failures: unknown[] = []
    const host: InstantFoldHost = {
        el: (tag, attrs) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n },
        begin: async (request) => { begun.push(request); return answer() },
        savePrefs: async (patch) => { patches.push(patch) },
        fail: (e) => failures.push(e),
        when: (iso) => `at ${iso}`,
        random: () => 0,
        ...over,
    }
    const fold = createInstantFold(host)
    document.body.append(fold.root)
    return { fold, begun, patches, failures }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const control = (fold: InstantFold, name: string) => fold.root.querySelector(`[data-lh-field="instant-${name}-input"]`) as HTMLInputElement & HTMLTextAreaElement
const button = (fold: InstantFold, text: string) => Array.from(fold.root.querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement
const genre = (fold: InstantFold, value: string) => fold.root.querySelector(`button[data-genre="${value}"]`) as HTMLButtonElement
const status = (fold: InstantFold) => fold.root.querySelector('.lh-instant-status')!
const BEGIN = '⚡ Begin Instant Action'

describe('the words', () => {
    it('names the genre plainly, and says what a run did or why it failed', () => {
        const when = (iso: string) => `at ${iso}`
        expect(['fantasy', 'realistic', 'scifi', 'horror'].map(instantGenreLabel)).toEqual(['Fantasy', 'Modern', 'Sci-Fi', 'Horror'])
        expect(instantGenreLabel('western')).toBe('western')
        expect(describeInstantResult(READY, when)).toBe('Ready — Robin Vale (Ranger, level 4). The sheet is in the tracker’s cards. The adventure has begun. Ran at 2026-10-04T10:00:00Z.')
        expect(describeInstantResult({ ...READY, at: '', level: null, started: false }, when)).toBe('Ready — Robin Vale (Ranger). The sheet is in the tracker’s cards. Type your first action.')
        expect(describeInstantResult({ ...READY, at: '', card: { status: 'written', at: 't', name: 'Robin Vale', words: 160 }, persona: { status: 'active', at: 't', name: 'Robin Vale', created: true } }, when)).toBe('Ready \u2014 Robin Vale (Ranger, level 4). The sheet is in the tracker’s cards. The Player Card is written (160 words); it is in the Player Card fold. The persona \u201cRobin Vale\u201d is made and active; if Lumiverse\u2019s persona picker does not list it yet, press its refresh button. The adventure has begun.')
        expect(describeInstantResult({ ...READY, name: '', className: '', level: null }, when)).toBe('Ready — the character. The sheet is in the tracker’s cards. The adventure has begun. Ran at 2026-10-04T10:00:00Z.')
        expect(describeInstantResult({ status: 'failed', at: 't', genre: 'horror', className: 'Occultist', level: 2, name: '', started: false, reason: 'no sheet' }, when)).toBe('Instant Action failed: no sheet. Rolled Occultist, level 2. Ran at t.')
        expect(describeInstantResult({ status: 'failed', at: '', genre: 'horror', className: '', level: null, name: '', started: false }, when)).toBe('Instant Action failed: no reason given.')
    })
})

describe('the fold', () => {
    it('starts closed with nothing picked, stays folded on a chat with no memo (84; it opened itself before), wears the drawers’ chevron, and keeps Roll and Begin off until a genre is picked', () => {
        const { fold } = harness()
        expect(fold.root.open).toBe(false)
        expect(fold.root.querySelector('summary .lh-start-fold-chevron')!.textContent).toBe('▸')
        expect(status(fold).textContent).toBe('Select a genre to begin')
        expect(fold.genre()).toBe('')
        expect(button(fold, '🎲 Roll name').disabled).toBe(true)
        expect(button(fold, BEGIN).disabled).toBe(true)
        expect(genre(fold, 'fantasy').getAttribute('aria-pressed')).toBe('false')
        fold.setChat('chat-1', true)
        expect(fold.root.open).toBe(false)
        expect(button(fold, BEGIN).disabled).toBe(true)
        expect(button(fold, BEGIN).title).toBe('Pick a genre first.')
        fold.root.open = true
        fold.setChat('chat-1', true)
        expect(fold.root.open).toBe(true)
        fold.setChat('chat-2', false)
        expect(fold.root.open).toBe(true)
        fold.root.open = false
        genre(fold, 'horror').click()
        expect(fold.genre()).toBe('horror')
        expect(genre(fold, 'horror').classList.contains('is-selected')).toBe(true)
        expect(genre(fold, 'horror').getAttribute('aria-pressed')).toBe('true')
        expect(genre(fold, 'fantasy').getAttribute('aria-pressed')).toBe('false')
        expect(status(fold).textContent).toBe('Horror selected — name optional')
        expect(button(fold, '🎲 Roll name').disabled).toBe(false)
        expect(button(fold, BEGIN).disabled).toBe(false)
        fold.setChat(null, true)
        expect(button(fold, BEGIN).disabled).toBe(true)
        expect(button(fold, BEGIN).title).toBe('Open a chat first.')
    })

    it('rolls a name from the genre\'s pool, and follows the name box as it is typed and cleared', () => {
        const { fold } = harness()
        fold.setChat('chat-1', true)
        genre(fold, 'scifi').click()
        button(fold, '🎲 Roll name').click()
        expect(control(fold, 'name').value).not.toBe('')
        const rolled = control(fold, 'name').value
        expect(status(fold).textContent).toBe('Name ready — reroll or begin')
        control(fold, 'name').value = 'Vex'
        control(fold, 'name').dispatchEvent(new Event('input'))
        expect(status(fold).textContent).toBe('Name ready — edit, reroll, or begin')
        control(fold, 'name').value = ''
        control(fold, 'name').dispatchEvent(new Event('input'))
        expect(status(fold).textContent).toBe('Name blank — the model will choose')
        // Another genre rolls from another pool.
        genre(fold, 'fantasy').click()
        button(fold, '🎲 Roll name').click()
        expect(control(fold, 'name').value).not.toBe(rolled)
        // A name already typed keeps its status when a genre is picked after it.
        control(fold, 'name').value = 'Mara'
        genre(fold, 'horror').click()
        expect(status(fold).textContent).toBe('Name ready — edit, reroll, or begin')
    })

    it('keeps the starter switch and the card\'s words as preferences and reads them back', async () => {
        const { fold, patches } = harness()
        const words = fold.root.querySelector('[data-lh-field="instant-card-words-input"]') as HTMLSelectElement
        expect(words.value).toBe('150')
        words.value = '300'
        words.dispatchEvent(new Event('change'))
        await settle()
        expect(patches).toEqual([{ creatorCardWords: 300 }])
        patches.length = 0
        fold.applyPrefs({ creatorCardWords: 1000 })
        expect(words.value).toBe('1000')
        expect(control(fold, 'send-starter').checked).toBe(true)
        control(fold, 'send-starter').checked = false
        control(fold, 'send-starter').dispatchEvent(new Event('change'))
        await settle()
        expect(patches).toEqual([{ creatorSendStarter: false }])
        fold.applyPrefs({ creatorSendStarter: true })
        expect(control(fold, 'send-starter').checked).toBe(true)
        fold.applyPrefs({})
        expect(control(fold, 'send-starter').checked).toBe(true)
        // Random level (45d): off until ticked, a preference of its own.
        patches.length = 0
        expect(control(fold, 'random-level').checked).toBe(false)
        control(fold, 'random-level').checked = true
        control(fold, 'random-level').dispatchEvent(new Event('change'))
        await settle()
        expect(patches).toEqual([{ creatorInstantRandomLevel: true }])
        fold.applyPrefs({ creatorInstantRandomLevel: false })
        expect(control(fold, 'random-level').checked).toBe(false)
    })

    it('begins with the genre, the trimmed name, the setup and the switch, remembers the genre, holds the form while running, and reports what came back', async () => {
        let release!: (r: InstantResult) => void
        const { fold, begun, patches } = harness(() => new Promise<InstantResult>((resolve) => { release = resolve }))
        fold.setChat('chat-1', true)
        genre(fold, 'fantasy').click()
        control(fold, 'name').value = '  Robin  '
        control(fold, 'setup').value = 'A heist.'
        control(fold, 'send-starter').checked = false
        const words = fold.root.querySelector('[data-lh-field="instant-card-words-input"]') as HTMLSelectElement
        words.value = '300'
        button(fold, BEGIN).click()
        expect(fold.busy()).toBe(true)
        expect(begun).toEqual([{ genre: 'fantasy', name: 'Robin', setup: 'A heist.', sendStarter: false, cardWords: 300 }])
        expect(status(fold).textContent).toBe('Creating the character (Fantasy · custom setup · Robin)…')
        expect(status(fold).classList.contains('lh-world-running')).toBe(true)
        expect(button(fold, BEGIN).disabled).toBe(true)
        expect(genre(fold, 'horror').disabled).toBe(true)
        expect(control(fold, 'name').disabled).toBe(true)
        // A second press while running does nothing, even if the button were somehow live.
        button(fold, BEGIN).disabled = false
        button(fold, BEGIN).click()
        expect(begun).toHaveLength(1)
        await settle()
        expect(patches).toContainEqual({ creatorGenre: 'fantasy' })
        release({ ...READY, started: false })
        await settle()
        expect(fold.busy()).toBe(false)
        expect(status(fold).textContent).toBe('Ready — Robin Vale (Ranger, level 4). The sheet is in the tracker’s cards. Type your first action. Ran at 2026-10-04T10:00:00Z.')
        expect(status(fold).classList.contains('lh-world-running')).toBe(false)
        expect(button(fold, BEGIN).disabled).toBe(false)
        expect(genre(fold, 'fantasy').classList.contains('is-selected')).toBe(true)
        // Without a name or setup the running line says what is left to the model.
        control(fold, 'name').value = ''
        control(fold, 'setup').value = ''
        button(fold, BEGIN).click()
        expect(status(fold).textContent).toBe('Creating the character (Fantasy · a rolled class at level 1 · a name of the model’s choosing)…')
        release(READY)
        await settle()
        expect(status(fold).textContent).toContain('The adventure has begun.')
    })

    it('asks before beginning over a chat that already has a sheet (73d, departure 57), begins when the answer is yes, not when it is no, and never asks on an empty chat', async () => {
        const answers: boolean[] = []
        const asked: Array<[string, string, string]> = []
        const { fold, begun } = harness(async () => READY, { confirm: async (title, message, label) => { asked.push([title, message, label]); return answers.shift() ?? false } })
        fold.setChat('chat-1', false)
        genre(fold, 'fantasy').click()
        expect(button(fold, BEGIN).title).toBe('This chat already has a character sheet; Instant Action replaces it, and asks first.')
        answers.push(false)
        button(fold, BEGIN).click()
        await settle()
        expect(asked).toEqual([['Begin Instant Action', 'This chat already has a character sheet. Instant Action writes a new sheet over it, makes a new persona and Player Card, and sends the first message. Multihog allows this on an empty chat only.', 'Replace the sheet']])
        expect(begun).toEqual([])
        expect(fold.busy()).toBe(false)
        answers.push(true)
        button(fold, BEGIN).click()
        await settle()
        expect(begun).toHaveLength(1)
        await settle()
        // An empty chat is begun without a question, and the button says the plain thing.
        fold.setChat('chat-2', true)
        genre(fold, 'fantasy').click()
        expect(button(fold, BEGIN).title).toBe('Roll the character, write the sheet, and begin.')
        button(fold, BEGIN).click()
        await settle()
        expect(asked).toHaveLength(2)
        expect(begun).toHaveLength(2)
    })

    it('says in red when the run failed or the request threw, and clears the result when the chat closes or a choice changes', async () => {
        const { fold } = harness(() => { throw new Error('creator.instant timed out after 180s') })
        fold.setChat('chat-1', true)
        genre(fold, 'realistic').click()
        button(fold, BEGIN).click()
        await settle()
        expect(status(fold).textContent).toBe('Instant Action failed: creator.instant timed out after 180s.' + ' Ran at ' + status(fold).textContent!.split(' Ran at ')[1])
        expect(status(fold).classList.contains('lh-world-note--error')).toBe(true)
        genre(fold, 'horror').click()
        expect(status(fold).textContent).toBe('Horror selected — name optional')
        expect(status(fold).classList.contains('lh-world-note--error')).toBe(false)
        const failed = harness(() => ({ status: 'failed', at: 't', genre: 'horror', className: 'Occultist', level: 3, name: '', started: false, reason: 'no sheet' }))
        failed.fold.setChat('chat-1', true)
        genre(failed.fold, 'horror').click()
        button(failed.fold, BEGIN).click()
        await settle()
        expect(status(failed.fold).textContent).toBe('Instant Action failed: no sheet. Rolled Occultist, level 3. Ran at t.')
        failed.fold.setChat(null, false)
        expect(status(failed.fold).textContent).toBe('Horror selected — name optional')
    })
})
