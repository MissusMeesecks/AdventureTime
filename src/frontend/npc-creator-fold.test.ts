// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'

import type { CardChoice, LibraryRecordView, NpcAddResult, NpcDraftResult } from '../protocol.js'
import { createNpcCreatorFold, describeNpcAdd, describeNpcDraftFailure, NPC_CARD_PAGE, NPC_CREATOR_FOLD_CSS, type NpcCreatorFold, type NpcCreatorFoldHost } from './npc-creator-fold.js'

afterEach(() => { document.body.replaceChildren() })

const CARDS: CardChoice[] = [{ id: 'c1', name: 'Igor Vask', snippet: 'A hunchbacked porter.' }, { id: 'c2', name: 'Orrin', snippet: '' }]
const KESTREL: LibraryRecordView = { id: 'k1', name: 'Kestrel Vane', keys: ['Kestrel Vane'], content: '[CORE]\nSpecies: Human\n[/CORE]', portraitPath: '', notes: '', createdAt: 1, updatedAt: 2, blurb: 'Human — Lean.\n\nWary.' }
const ADDED: NpcAddResult = { status: 'added', at: '2026-10-05T10:00:00Z', name: 'Igor Vask', book: 'Vell_NPC', entryId: 'Vell_NPC::7', how: 'reviewed', portrait: true }
const DRAFTED: NpcDraftResult = { status: 'drafted', at: '2026-10-05T10:00:00Z', how: 'fit', source: 'Igor Vask', name: 'Mira Voss', tag: '[[NPC: Mira Voss | [CORE]\nSpecies: Elf\n[/CORE] | Mira Voss, Mira]]', duplicate: false }

function harness(over: Partial<NpcCreatorFoldHost> & { records?: LibraryRecordView[] } = {}) {
    const calls: unknown[][] = []
    const { records = [KESTREL], ...rest } = over
    const host: NpcCreatorFoldHost = {
        el: (tag, attrs) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n },
        cards: async () => { calls.push(['cards']); return { cards: CARDS } },
        library: async () => { calls.push(['library']); return { records } },
        draft: async (request) => { calls.push(['draft', request]); return DRAFTED },
        add: async (request) => { calls.push(['add', request]); return ADDED },
        commit: async (request) => { calls.push(['commit', request]); return { ...ADDED, name: 'Mira Voss', how: 'fit', portrait: false } },
        savePrefs: async (patch) => { calls.push(['prefs', patch]) },
        fail: (e) => calls.push(['fail', e]),
        when: (iso) => `at ${iso}`,
        ...rest,
    }
    const fold = createNpcCreatorFold(host)
    document.body.append(fold.root)
    return { fold, calls, host }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const open = async (fold: NpcCreatorFold) => { fold.root.open = true; fold.root.dispatchEvent(new Event('toggle')); await settle() }
const button = (fold: NpcCreatorFold, label: string) => fold.root.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement
const textButton = (fold: NpcCreatorFold, text: string) => Array.from(fold.root.querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement
const tab = (fold: NpcCreatorFold, id: string) => fold.root.querySelector(`[data-lh-tab="${id}"]`) as HTMLButtonElement
const panel = (fold: NpcCreatorFold, id: string) => fold.root.querySelector(`[data-lh-panel="${id}"]`) as HTMLElement
const field = (fold: NpcCreatorFold, name: string) => fold.root.querySelector(`[data-lh-field="npc-${name}-input"]`) as HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement
const names = (fold: NpcCreatorFold, list: string) => Array.from(fold.root.querySelectorAll(`[data-lh-field="npc-${list}-list"] .lh-npc-name`)).map((n) => n.textContent)
const note = (fold: NpcCreatorFold) => fold.root.querySelector('.lh-npc-note')!.textContent ?? ''
const preview = (fold: NpcCreatorFold) => fold.root.querySelector('[data-lh-field="npc-preview"]') as HTMLElement
const selected = (fold: NpcCreatorFold) => Array.from(fold.root.querySelectorAll('[data-lh-tab]')).find((b) => b.getAttribute('aria-selected') === 'true')?.getAttribute('data-lh-tab')

describe('the note', () => {
    it('says what an add did, by how it came in', () => {
        const when = (iso: string) => `at ${iso}`
        expect(describeNpcAdd(ADDED, when)).toBe('Added “Igor Vask” to Vell_NPC after a review for the world. Their portrait is placed. The agent reads it from here on. Ran at 2026-10-05T10:00:00Z.')
        expect(describeNpcAdd({ ...ADDED, how: 'literal', portrait: false, at: '' }, when)).toBe('Added “Igor Vask” to Vell_NPC as is. The agent reads it from here on.')
        expect(describeNpcAdd({ ...ADDED, how: 'fit' }, when)).toContain('fitted into the story')
        expect(describeNpcAdd({ ...ADDED, how: 'freeform' }, when)).toContain('from the description')
        expect(describeNpcAdd({ ...ADDED, how: 'archetype', book: '' }, when)).toContain('to the NPC book from the archetype')
        expect(describeNpcAdd({ status: 'exists', at: 't', name: 'Igor Vask', book: 'Vell_NPC', how: 'literal' }, when)).toBe('“Igor Vask” is already in Vell_NPC; nothing was added. Ran at t.')
        expect(describeNpcAdd({ status: 'failed', at: '', name: '', how: 'literal', reason: 'the host is down' }, when)).toBe('The NPC was not added: the host is down.')
        expect(describeNpcDraftFailure({ status: 'failed', at: 't', how: 'fit', source: 'Igor', name: 'Igor', reason: 'no tag' }, when)).toBe('Nothing was drafted from “Igor”: no tag. Ran at t.')
        expect(describeNpcDraftFailure({ status: 'failed', at: '', how: 'archetype', source: 'Rival', name: '' }, when)).toBe('Nothing was drafted from the archetype Rival: no reason given.')
        expect(describeNpcDraftFailure({ status: 'failed', at: '', how: 'freeform', source: 'the concept', name: '' }, when)).toBe('Nothing was drafted from the description: no reason given.')
    })
})

describe('the stylesheet', () => {
    it('hides what is hidden: the flex rules would otherwise outrank the attribute', () => {
        // happy-dom does not lay out, so this is the only test that can see it; the browser screenshot found it.
        for (const cls of ['lh-npc-panel', 'lh-npc-preview', 'lh-npc-field', 'lh-npc-warning']) {
            expect(NPC_CREATOR_FOLD_CSS, cls).toMatch(new RegExp(`\\.${cls}\\[hidden\\][^{]*\\{[^}]*display: none`))
        }
    })
})

describe('the tabs and the lists', () => {
    it('reads nothing until opened, then lists the library and the cards and opens on the library when it holds a card', async () => {
        const { fold, calls } = harness()
        expect(calls).toEqual([])
        await open(fold)
        expect(calls).toEqual([['library'], ['cards']])
        expect(selected(fold)).toBe('library')
        expect(panel(fold, 'library').hidden).toBe(false)
        expect(panel(fold, 'card').hidden).toBe(true)
        expect(names(fold, 'library')).toEqual(['Kestrel Vane'])
        expect(fold.root.querySelector('[data-lh-field="npc-library-list"] .lh-npc-blurb')!.textContent).toBe('Human — Lean.')
        tab(fold, 'card').click()
        expect(selected(fold)).toBe('card')
        expect(panel(fold, 'card').hidden).toBe(false)
        expect(names(fold, 'card')).toEqual(['Igor Vask', 'Orrin'])
    })

    it('opens on the cards when the library is empty, and says so in the library tab', async () => {
        const { fold } = harness({ records: [] })
        await open(fold)
        expect(selected(fold)).toBe('card')
        expect(panel(fold, 'library').textContent).toContain('The library is empty.')
    })

    it('names a list that could not be read, and keeps the other', async () => {
        const { fold } = harness({ cards: async () => { throw new Error('the host has not granted the characters permission') } })
        await open(fold)
        expect(names(fold, 'library')).toEqual(['Kestrel Vane'])
        expect(panel(fold, 'card').textContent).toContain('The cards could not be listed: the host has not granted the characters permission.')
    })

    it('searches each list, pages the cards, and reloads both', async () => {
        const many = Array.from({ length: 23 }, (_, i) => ({ id: `c${i}`, name: `Card ${i}`, snippet: '' }))
        const { fold, calls } = harness({ cards: async () => { calls.push(['cards']); return { cards: many } } })
        await open(fold)
        tab(fold, 'card').click()
        expect(names(fold, 'card')).toHaveLength(NPC_CARD_PAGE)
        expect(textButton(fold, 'Show more (10 of 23)')).toBeTruthy()
        textButton(fold, 'Show more (10 of 23)').click()
        expect(names(fold, 'card')).toHaveLength(20)
        field(fold, 'card-search').value = 'card 2'
        field(fold, 'card-search').dispatchEvent(new Event('input'))
        expect(names(fold, 'card')).toEqual(['Card 2', 'Card 20', 'Card 21', 'Card 22'])
        field(fold, 'library-search').value = 'zzz'
        field(fold, 'library-search').dispatchEvent(new Event('input'))
        expect(names(fold, 'library')).toEqual([])
        expect(panel(fold, 'library').textContent).toContain('No cards match.')
        calls.length = 0
        textButton(fold, '↻ Reload the cards').click()
        await settle()
        expect(calls.map(([op]) => op)).toEqual(['library', 'cards'])
    })
})

describe('Add as is', () => {
    it('adds a card at once, naming the chat\'s source, and says what happened', async () => {
        const { fold, calls } = harness()
        fold.setChat('chat-1')
        await open(fold)
        tab(fold, 'card').click()
        expect(button(fold, 'Add “Igor Vask” as an NPC').title).toContain('One model call fixes only world and era impossibilities')
        button(fold, 'Add “Igor Vask” as an NPC').click()
        expect(fold.busy()).toBe(true)
        expect(fold.root.querySelector('.lh-world-running')!.textContent).toBe('➕ Adding “Igor Vask” to the NPC book…')
        expect(button(fold, 'Add “Orrin” as an NPC').disabled).toBe(true)
        await settle()
        expect(calls.filter(([op]) => op === 'add')).toEqual([['add', { source: { kind: 'card', characterId: 'c1' } }]])
        expect(note(fold)).toBe('Added “Igor Vask” to Vell_NPC after a review for the world. Their portrait is placed. The agent reads it from here on. Ran at 2026-10-05T10:00:00Z.')
        expect(fold.busy()).toBe(false)
    })

    it('adds a library record as is, and reports a kept name in red', async () => {
        const { fold, calls } = harness({ add: async (request) => { calls.push(['add', request]); return { status: 'exists', at: 't', name: 'Kestrel Vane', book: 'Vell_NPC', how: 'literal' } } })
        fold.setChat('chat-1')
        await open(fold)
        button(fold, 'Add “Kestrel Vane” as an NPC').click()
        await settle()
        expect(calls.filter(([op]) => op === 'add')).toEqual([['add', { source: { kind: 'library', id: 'k1' } }]])
        expect(note(fold)).toBe('“Kestrel Vane” is already in Vell_NPC; nothing was added. Ran at t.')
        expect(fold.root.querySelector('.lh-npc-note')!.classList.contains('lh-world-note--error')).toBe(true)
    })

    it('keeps every button off without a chat, and a second press while running sends nothing', async () => {
        let release: (r: NpcAddResult) => void = () => {}
        const { fold, calls } = harness({ add: async (request) => { calls.push(['add', request]); return new Promise((resolve) => { release = resolve }) } })
        await open(fold)
        expect(button(fold, 'Add “Kestrel Vane” as an NPC').disabled).toBe(true)
        expect(button(fold, 'Add “Kestrel Vane” as an NPC').title).toBe('Open a chat first.')
        expect(button(fold, 'Generate the NPC from the description').disabled).toBe(true)
        fold.setChat('chat-1')
        expect(button(fold, 'Add “Kestrel Vane” as an NPC').disabled).toBe(false)
        button(fold, 'Add “Kestrel Vane” as an NPC').click()
        button(fold, 'Add “Kestrel Vane” as an NPC').disabled = false
        button(fold, 'Add “Kestrel Vane” as an NPC').click()
        await settle()
        expect(calls.filter(([op]) => op === 'add')).toHaveLength(1)
        release(ADDED)
        await settle()
        expect(fold.busy()).toBe(false)
    })

    it('saves the mode when changed and reads it from the preferences, changing the button\'s title', async () => {
        const { fold, calls } = harness()
        fold.setChat('chat-1')
        await open(fold)
        tab(fold, 'card').click()
        field(fold, 'mode').value = 'literal'
        field(fold, 'mode').dispatchEvent(new Event('change'))
        await settle()
        expect(calls.filter(([op]) => op === 'prefs')).toEqual([['prefs', { npcAddAsIsMode: 'literal' }]])
        expect(button(fold, 'Add “Igor Vask” as an NPC').title).toContain('goes in verbatim')
        fold.applyPrefs({ npcAddAsIsMode: 'ai_review' })
        expect(field(fold, 'mode').value).toBe('ai_review')
        expect(button(fold, 'Add “Igor Vask” as an NPC').title).toContain('One model call')
    })
})

describe('a draft and the preview', () => {
    it('fits a card into the story: the draft fills the preview, Add NPC commits the text as edited with the card as the portrait', async () => {
        const { fold, calls } = harness()
        fold.setChat('chat-1')
        await open(fold)
        tab(fold, 'card').click()
        expect(preview(fold).hidden).toBe(true)
        button(fold, 'Fit “Igor Vask” into the story as an NPC').click()
        expect(fold.root.querySelector('.lh-world-running')!.textContent).toContain('Drafting an NPC from “Igor Vask”')
        await settle()
        expect(calls.filter(([op]) => op === 'draft')).toEqual([['draft', { source: { kind: 'card', characterId: 'c1' } }]])
        expect(preview(fold).hidden).toBe(false)
        expect(fold.root.querySelector('.lh-npc-preview-title')!.textContent).toBe('✨ Generated NPC — Mira Voss')
        expect(field(fold, 'preview').value).toBe(DRAFTED.tag)
        expect((fold.root.querySelector('.lh-npc-warning') as HTMLElement).hidden).toBe(true)
        expect(note(fold)).toBe('Drafted “Mira Voss” — read it below, change what you like, then press Add NPC.')
        field(fold, 'preview').value = '[[NPC: Mira Vossen | [CORE]\nSpecies: Elf\n[/CORE] | Mira]]'
        button(fold, 'Add the drafted NPC').click()
        await settle()
        expect(calls.filter(([op]) => op === 'commit')).toEqual([['commit', { tag: '[[NPC: Mira Vossen | [CORE]\nSpecies: Elf\n[/CORE] | Mira]]', name: 'Mira Vossen', how: 'fit', portrait: { kind: 'card', characterId: 'c1' } }]])
        expect(preview(fold).hidden).toBe(true)
        expect(note(fold)).toContain('Added “Mira Voss” to Vell_NPC fitted into the story.')
    })

    it('warns of a duplicate name, keeps the preview when the commit is refused, and Cancel drops it', async () => {
        const { fold } = harness({
            draft: async () => ({ ...DRAFTED, name: 'Mother Sedge', duplicate: true }),
            commit: async () => ({ status: 'exists', at: 't', name: 'Mother Sedge', book: 'Vell_NPC', how: 'fit' }),
        })
        fold.setChat('chat-1')
        await open(fold)
        button(fold, 'Fit “Kestrel Vane” into the story as an NPC').click()
        await settle()
        expect(fold.root.querySelector('.lh-npc-warning')!.textContent).toContain('An NPC named “Mother Sedge” is already in the book.')
        button(fold, 'Add the drafted NPC').click()
        await settle()
        expect(preview(fold).hidden).toBe(false)
        expect(note(fold)).toBe('“Mother Sedge” is already in Vell_NPC; nothing was added. Ran at t.')
        textButton(fold, 'Cancel').click()
        expect(preview(fold).hidden).toBe(true)
    })

    it('generates from a description, requiring one, and falls back to the typed name for a tagless edit', async () => {
        const { fold, calls } = harness()
        fold.setChat('chat-1')
        await open(fold)
        tab(fold, 'freeform').click()
        button(fold, 'Generate the NPC from the description').click()
        expect(note(fold)).toBe('Write a description first.')
        expect(calls.filter(([op]) => op === 'draft')).toEqual([])
        field(fold, 'freeform-name').value = ' Igor '
        field(fold, 'freeform-description').value = 'A porter.'
        button(fold, 'Generate the NPC from the description').click()
        expect(fold.root.querySelector('.lh-world-running')!.textContent).toContain('Drafting an NPC from “Igor”')
        await settle()
        expect(calls.filter(([op]) => op === 'draft')).toEqual([['draft', { source: { kind: 'freeform', name: 'Igor', description: 'A porter.' } }]])
        field(fold, 'preview').value = 'Species: Human'
        button(fold, 'Add the drafted NPC').click()
        await settle()
        expect(calls.filter(([op]) => op === 'commit')).toEqual([['commit', { tag: 'Species: Human', name: 'Mira Voss', how: 'fit' }]])
    })

    it('generates from an archetype: a chip or the custom role, the name and the concept', async () => {
        const { fold, calls } = harness({ draft: async (request) => { calls.push(['draft', request]); return { ...DRAFTED, how: 'archetype', source: 'Rival' } } })
        fold.setChat('chat-1')
        await open(fold)
        tab(fold, 'archetype').click()
        button(fold, 'Generate the NPC from the archetype').click()
        expect(note(fold)).toBe('Pick an archetype first.')
        const chip = (id: string) => fold.root.querySelector(`[data-lh-archetype="${id}"]`) as HTMLButtonElement
        expect(field(fold, 'archetype-custom').closest('label')!.hidden).toBe(true)
        chip('Custom').click()
        expect(chip('Custom').getAttribute('aria-pressed')).toBe('true')
        expect(field(fold, 'archetype-custom').closest('label')!.hidden).toBe(false)
        button(fold, 'Generate the NPC from the archetype').click()
        expect(note(fold)).toBe('Type the custom role first.')
        chip('Rival').click()
        expect(chip('Custom').getAttribute('aria-pressed')).toBe('false')
        expect(field(fold, 'archetype-custom').closest('label')!.hidden).toBe(true)
        field(fold, 'archetype-name').value = 'Mira'
        field(fold, 'archetype-concept').value = ' A duellist. '
        button(fold, 'Generate the NPC from the archetype').click()
        expect(fold.root.querySelector('.lh-world-running')!.textContent).toContain('Drafting an NPC from “Rival”')
        await settle()
        expect(calls.filter(([op]) => op === 'draft')).toEqual([['draft', { source: { kind: 'archetype', archetype: 'Rival', name: 'Mira', concept: 'A duellist.' } }]])
        button(fold, 'Add the drafted NPC').click()
        await settle()
        expect(calls.filter(([op]) => op === 'commit')).toEqual([['commit', { tag: DRAFTED.tag, name: 'Mira Voss', how: 'archetype' }]])
        chip('Custom').click()
        field(fold, 'archetype-custom').value = 'Bartender'
        button(fold, 'Generate the NPC from the archetype').click()
        await settle()
        expect(calls.filter(([op]) => op === 'draft')[1]).toEqual(['draft', { source: { kind: 'archetype', archetype: 'Bartender', name: 'Mira', concept: 'A duellist.' } }])
    })

    it('reports a failed draft, a draft that threw, and a commit that threw, and a chat change drops the preview', async () => {
        const { fold } = harness({ draft: async () => ({ status: 'failed', at: 't', how: 'fit', source: 'Kestrel Vane', name: 'Kestrel Vane', reason: 'the reply had no [[NPC: …]] tag in it: Sorry' }) })
        fold.setChat('chat-1')
        await open(fold)
        button(fold, 'Fit “Kestrel Vane” into the story as an NPC').click()
        await settle()
        expect(note(fold)).toBe('Nothing was drafted from “Kestrel Vane”: the reply had no [[NPC: …]] tag in it: Sorry. Ran at t.')
        expect(preview(fold).hidden).toBe(true)
        const threw = harness({ draft: async () => { throw new Error('timed out') } })
        threw.fold.setChat('chat-1')
        await open(threw.fold)
        button(threw.fold, 'Fit “Kestrel Vane” into the story as an NPC').click()
        await settle()
        expect(note(threw.fold)).toBe('Nothing was drafted: timed out.')
        const commitThrew = harness({ commit: async () => { throw new Error('no book') } })
        commitThrew.fold.setChat('chat-1')
        await open(commitThrew.fold)
        button(commitThrew.fold, 'Fit “Kestrel Vane” into the story as an NPC').click()
        await settle()
        button(commitThrew.fold, 'Add the drafted NPC').click()
        await settle()
        expect(note(commitThrew.fold)).toBe('The NPC was not added: no book.')
        expect(preview(commitThrew.fold).hidden).toBe(false)
        commitThrew.fold.setChat('chat-2')
        expect(preview(commitThrew.fold).hidden).toBe(true)
        expect(note(commitThrew.fold)).toBe('')
    })
})
