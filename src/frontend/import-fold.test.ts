// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'

import type { CardChoice, ImportResult } from '../protocol.js'
import { createImportFold, describeImportResult, IMPORT_PAGE, type ImportFold, type ImportFoldHost } from './import-fold.js'

afterEach(() => { document.body.replaceChildren() })

const WRITTEN: ImportResult = { status: 'written', at: '2026-10-05T10:00:00Z', name: 'Kestrel', source: 'Kestrel', mode: 'full', added: ['CHARACTER', 'XP'], replaced: [] }
const CARDS: CardChoice[] = [
    { id: 'k1', name: 'Kestrel', snippet: 'A hawk-eyed scout.' },
    { id: 'o2', name: 'Orrin', snippet: '' },
]

function harness(answer: () => ImportResult | Promise<ImportResult> = () => WRITTEN, cards: () => Promise<{ cards: CardChoice[] }> = async () => ({ cards: CARDS })) {
    const imports: unknown[] = []
    const patches: Record<string, unknown>[] = []
    const failures: unknown[] = []
    let lists = 0
    const host: ImportFoldHost = {
        el: (tag, attrs) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n },
        list: async () => { lists += 1; return cards() },
        importCard: async (request) => { imports.push(request); return answer() },
        savePrefs: async (patch) => { patches.push(patch) },
        fail: (e) => failures.push(e),
        when: (iso) => `at ${iso}`,
    }
    const fold = createImportFold(host)
    document.body.append(fold.root)
    return { fold, imports, patches, failures, lists: () => lists }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const control = (fold: ImportFold, name: string) => fold.root.querySelector(`[data-lh-field="import-${name}-input"]`) as HTMLInputElement & HTMLSelectElement
const names = (fold: ImportFold) => Array.from(fold.root.querySelectorAll('.lh-import-name')).map((n) => n.textContent)
const button = (fold: ImportFold, label: string) => fold.root.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement
const note = (fold: ImportFold) => fold.root.querySelector('.lh-import-note')!.textContent ?? ''
const open = async (fold: ImportFold) => { fold.root.open = true; fold.root.dispatchEvent(new Event('toggle')); await settle() }
const FIT = 'Fit “Kestrel” into the story'
const AS_IS = 'Add “Kestrel” as is'

describe('the note', () => {
    it('says what was imported, how, as whom, and what the steps did', () => {
        const when = (iso: string) => `at ${iso}`
        expect(describeImportResult(WRITTEN, when)).toBe('Imported “Kestrel”, fitted into the story: CHARACTER, XP. The sheet is in the tracker’s cards. Ran at 2026-10-05T10:00:00Z.')
        expect(describeImportResult({ ...WRITTEN, portrait: true }, when)).toContain('The sheet is in the tracker’s cards. Their portrait is the card’s picture. Ran')
        expect(describeImportResult({ ...WRITTEN, portrait: false }, when)).toContain('The card’s picture could not be placed as the portrait.')
        expect(describeImportResult({ ...WRITTEN, name: 'Kestrel Vane', mode: 'minimal', at: '', card: { status: 'written', at: 't', name: 'Kestrel', words: 160 } }, when)).toBe('Imported “Kestrel” as Kestrel Vane, as is: CHARACTER, XP. The sheet is in the tracker’s cards. The Player Card is written (160 words); it is in the Player Card fold.')
        expect(describeImportResult({ status: 'written', at: '', name: '', source: '', mode: 'full' }, when)).toBe('Imported “the card”, fitted into the story. The sheet is in the tracker’s cards.')
        expect(describeImportResult({ status: 'failed', at: 't', name: 'Kestrel', source: 'Kestrel', mode: 'full', reason: 'the tracker pass changed nothing.' }, when)).toBe('The card “Kestrel” was not imported: the tracker pass changed nothing. Ran at t.')
        expect(describeImportResult({ status: 'failed', at: '', name: '', source: '', mode: 'minimal' }, when)).toBe('The card was not imported: no reason given.')
    })
})

describe('the list', () => {
    it('fetches nothing until opened, then lists the cards with their snippets, once', async () => {
        const { fold, lists } = harness()
        expect(lists()).toBe(0)
        expect(fold.root.querySelector('.lh-import-empty')!.textContent).toBe('Open the fold to list your character cards.')
        await open(fold)
        expect(lists()).toBe(1)
        expect(names(fold)).toEqual(['Kestrel', 'Orrin'])
        expect(Array.from(fold.root.querySelectorAll('.lh-import-snippet')).map((n) => n.textContent)).toEqual(['A hawk-eyed scout.', 'No description'])
        fold.root.dispatchEvent(new Event('toggle'))
        await settle()
        expect(lists()).toBe(1)
    })

    it('fetches again on Reload the cards, and says when the list could not be read', async () => {
        let fail = false
        const { fold, lists } = harness(() => WRITTEN, async () => { if (fail) throw new Error('the host has not granted the characters permission'); return { cards: CARDS } })
        await open(fold)
        fail = true
        ;(Array.from(fold.root.querySelectorAll('button')).find((b) => b.textContent === '↻ Reload the cards') as HTMLButtonElement).click()
        await settle()
        expect(lists()).toBe(2)
        expect(fold.root.querySelector('.lh-import-empty')!.textContent).toBe('The cards could not be listed: the host has not granted the characters permission.')
        expect(fold.root.querySelector('.lh-import-empty')!.classList.contains('lh-world-note--error')).toBe(true)
    })

    it('filters by the search box, and says when nothing matches', async () => {
        const { fold } = harness()
        await open(fold)
        const search = control(fold, 'search')
        search.value = 'orr'
        search.dispatchEvent(new Event('input'))
        expect(names(fold)).toEqual(['Orrin'])
        search.value = 'zzz'
        search.dispatchEvent(new Event('input'))
        expect(fold.root.querySelector('.lh-import-empty')!.textContent).toBe('No characters match.')
    })

    it('shows ten at a time, with Show more', async () => {
        const many = Array.from({ length: 23 }, (_, i) => ({ id: `c${i}`, name: `Card ${i}`, snippet: '' }))
        const { fold } = harness(() => WRITTEN, async () => ({ cards: many }))
        await open(fold)
        expect(names(fold)).toHaveLength(IMPORT_PAGE)
        const more = fold.root.querySelector('.lh-import-more') as HTMLButtonElement
        expect(more.textContent).toBe('Show more (10 of 23)')
        more.click()
        expect(names(fold)).toHaveLength(20)
        ;(fold.root.querySelector('.lh-import-more') as HTMLButtonElement).click()
        expect(names(fold)).toHaveLength(23)
        expect(fold.root.querySelector('.lh-import-more')).toBeNull()
    })

    it('says there are no characters when the host has none', async () => {
        const { fold } = harness(() => WRITTEN, async () => ({ cards: [] }))
        await open(fold)
        expect(fold.root.querySelector('.lh-import-empty')!.textContent).toBe('No characters found.')
    })
})

describe('importing', () => {
    it('is off without a chat, and says so', async () => {
        const { fold, imports } = harness()
        await open(fold)
        expect(button(fold, FIT).disabled).toBe(true)
        expect(button(fold, FIT).title).toBe('Open a chat first.')
        button(fold, FIT).disabled = false
        button(fold, FIT).click()
        await settle()
        expect(imports).toEqual([])
        fold.setChat('chat-1')
        expect(button(fold, FIT).disabled).toBe(false)
        expect(button(fold, AS_IS).disabled).toBe(false)
    })

    it('sends the card, the mode, the length and the switches, shows the running line, then the note, and reads the card fold', async () => {
        let release: (r: ImportResult) => void = () => undefined
        const { fold, imports } = harness(() => new Promise((resolve) => { release = resolve }))
        fold.setChat('chat-1')
        await open(fold)
        control(fold, 'player-card').checked = true
        control(fold, 'persona').checked = false
        button(fold, FIT).click()
        expect(fold.busy()).toBe(true)
        expect(fold.root.querySelector('.lh-world-running')!.textContent).toBe('📥 Importing “Kestrel” (fitted into the story)… the tracker’s cards fill in when the sheet is written.')
        expect((fold.root.querySelector('.lh-world-running') as HTMLElement).hidden).toBe(false)
        expect(button(fold, AS_IS).disabled).toBe(true)
        expect(control(fold, 'words').disabled).toBe(true)
        expect(imports).toEqual([{ characterId: 'k1', mode: 'full', cardWords: 'same', playerCard: true, persona: false }])
        release(WRITTEN)
        await settle()
        expect(fold.busy()).toBe(false)
        expect(note(fold)).toContain('Imported “Kestrel”, fitted into the story: CHARACTER, XP.')
        expect(button(fold, AS_IS).disabled).toBe(false)
    })

    it('sends the minimal mode for Add as is, with a chosen or a custom length', async () => {
        const { fold, imports } = harness()
        fold.setChat('chat-1')
        await open(fold)
        const words = control(fold, 'words')
        words.value = '300'
        words.dispatchEvent(new Event('change'))
        button(fold, AS_IS).click()
        await settle()
        expect(imports[0]).toMatchObject({ characterId: 'k1', mode: 'minimal', cardWords: 300 })
        words.value = 'custom'
        words.dispatchEvent(new Event('change'))
        const custom = control(fold, 'words-custom')
        expect(custom.hidden).toBe(false)
        custom.value = '9000'
        button(fold, FIT).click()
        await settle()
        expect(imports[1]).toMatchObject({ mode: 'full', cardWords: 5000 })
    })

    it('reports a refused request as a failure in the note, and a second press while running does nothing', async () => {
        let calls = 0
        const { fold, imports } = harness(() => { calls += 1; if (calls === 1) throw new Error('timed out'); return WRITTEN })
        fold.setChat('chat-1')
        await open(fold)
        button(fold, FIT).click()
        button(fold, AS_IS).disabled = false
        button(fold, AS_IS).click()
        await settle()
        expect(imports).toHaveLength(1)
        expect(note(fold)).toMatch(/^The card “Kestrel” was not imported: timed out\. Ran at .+\.$/)
        expect(fold.root.querySelector('.lh-import-note')!.classList.contains('lh-world-note--error')).toBe(true)
    })

    it('saves the two switches as the creator\'s preferences, and reads them back', async () => {
        const { fold, patches } = harness()
        control(fold, 'player-card').checked = true
        control(fold, 'player-card').dispatchEvent(new Event('change'))
        control(fold, 'persona').checked = false
        control(fold, 'persona').dispatchEvent(new Event('change'))
        await settle()
        expect(patches).toEqual([{ creatorPlayerCard: true }, { creatorPersona: false }])
        fold.applyPrefs({ creatorPlayerCard: false, creatorPersona: true })
        expect(control(fold, 'player-card').checked).toBe(false)
        expect(control(fold, 'persona').checked).toBe(true)
    })

    it('forgets the note when the chat goes', async () => {
        const { fold } = harness()
        fold.setChat('chat-1')
        await open(fold)
        button(fold, FIT).click()
        await settle()
        expect(note(fold)).not.toBe('')
        fold.setChat(null)
        expect(note(fold)).toBe('')
    })
})
