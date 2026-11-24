// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import { getMarkerLibraryKeys, MARKER_TYPE_MAP } from '../tracker/markers.js'
import { MARKER_DESCRIPTIONS, MARKER_LIBRARY_HELP } from './marker-help.js'
import { createMarkersCard, createNarratorRows, createNpcWordsCard, NARRATOR_CARD_HELP, NPC_WORDS_HELP, renderingTagsLibrary } from './second-pass-cards.js'

const el = (tag: string, attrs?: Record<string, string>) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n }
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the narrator card’s rows (72b; in Core & Branching since 81)', () => {
    it('keeps the name as a preference, makes or finds the card on the press, and says which', async () => {
        const prefs: Array<Record<string, unknown>> = []
        const asked: string[] = []
        let created = true
        const card = createNarratorRows({ el, create: async (name) => { asked.push(name); return { id: 'k1', name, created } }, savePrefs: async (p) => { prefs.push(p) }, fail: () => undefined })
        const name = card.node.querySelector('[data-lh-field="narrator-name"]') as HTMLInputElement
        const note = () => card.node.querySelector('[data-lh-field="narrator-note"]')!.textContent
        expect(name.value).toBe('Game Master')
        name.value = ' The Chronicler '
        name.dispatchEvent(new Event('change'))
        expect(prefs).toEqual([{ narratorCardName: 'The Chronicler' }])
        ;(card.node.querySelector('[data-lh-field="narrator-create"]') as HTMLButtonElement).click()
        await settle()
        expect(asked).toEqual(['The Chronicler'])
        expect(note()).toBe('Created the card “The Chronicler”. Open a new chat from it in Lumiverse. You may need to refresh the Characters tab to see it.')
        created = false
        ;(card.node.querySelector('[data-lh-field="narrator-create"]') as HTMLButtonElement).click()
        await settle()
        expect(note()).toBe('A card named “The Chronicler” already exists, so nothing was created. Open a chat from it in Lumiverse.')
        card.applyPrefs({ narratorCardName: 'Keeper' })
        expect(name.value).toBe('Keeper')
        const refused = createNarratorRows({ el, create: async () => { throw new Error('PERMISSION_DENIED') }, savePrefs: async () => undefined, fail: () => undefined })
        ;(refused.node.querySelector('[data-lh-field="narrator-create"]') as HTMLButtonElement).click()
        await settle()
        expect(refused.node.querySelector('[data-lh-field="narrator-note"]')!.textContent).toBe('The card could not be created: PERMISSION_DENIED')
    })

    it('keeps its help behind a [?] after the name’s label (96), outside any <label>, with no lead paragraph left in the open', () => {
        const card = createNarratorRows({ el, create: async (name) => ({ id: 'k1', name, created: true }), savePrefs: async () => undefined, fail: () => undefined })
        document.body.append(card.node)
        expect(card.node.querySelector('.lh-second-lead')).toBeNull()
        const tip = card.node.querySelector('.lh-help-tip') as HTMLButtonElement
        expect(tip.previousElementSibling!.tagName).toBe('LABEL')
        expect(tip.previousElementSibling!.textContent).toBe('Narrator card name')
        expect(tip.closest('label')).toBeNull()
        const note = document.getElementById(tip.getAttribute('aria-controls')!)!
        expect(card.node.contains(note)).toBe(true)
        expect(note.closest('label')).toBeNull()
        expect(note.hidden).toBe(true)
        expect(note.textContent).toBe(NARRATOR_CARD_HELP)
        expect(NARRATOR_CARD_HELP).toContain('If a card with this name already exists, nothing is created.')
        tip.click()
        expect(note.hidden).toBe(false)
        // The row is one the settings search finds, and the label still names the box.
        expect(tip.closest('.lh-search-item')).not.toBeNull()
        expect((card.node.querySelector('label') as HTMLLabelElement).getAttribute('for')).toBe(card.node.querySelector('[data-lh-field="narrator-name"]')!.id)
        expect(card.node.querySelector('[data-lh-field="narrator-create"]')!.textContent).toBe('Create narrator card')
    })
})

describe('the NPC word targets (72b)', () => {
    it('saves both numbers on a change, clamped, and says when the instruction no longer carries the sentences', async () => {
        const saved: Array<[number, number]> = []
        let applied = true
        const card = createNpcWordsCard({ el, save: async (a, b) => { saved.push([a, b]); return { applied } }, fail: () => undefined })
        const major = card.root.querySelector('[data-lh-field="npc-major-words"]') as HTMLInputElement
        const minor = card.root.querySelector('[data-lh-field="npc-minor-words"]') as HTMLInputElement
        const note = () => card.root.querySelector('[data-lh-field="npc-words-note"]')!.textContent
        expect([major.value, minor.value]).toEqual(['225', '135'])
        major.value = '9000'
        major.dispatchEvent(new Event('change'))
        await settle()
        expect(saved).toEqual([[5000, 135]])
        expect(major.value).toBe('5000')
        expect(note()).toBe('Saved: 5000 words for a major NPC, 135 for a minor NPC. The NPC instruction is updated.')
        applied = false
        minor.value = '90'
        minor.dispatchEvent(new Event('change'))
        await settle()
        expect(saved[1]).toEqual([5000, 90])
        expect(note()).toBe('Saved as 5000 and 90, but the NPC instruction no longer contains the two length sentences, so it was not changed. To restore them, reset the NPC instruction to stock under Agent modules in the Lore widget.')
        card.applyPrefs({ npcMajorWords: 300, npcMinorWords: 100 })
        expect([major.value, minor.value]).toEqual(['300', '100'])
    })

    it('says the deck’s text (96): the lead behind the header’s [?], hidden until pressed, and the two short labels', () => {
        const card = createNpcWordsCard({ el, save: async () => ({ applied: true }), fail: () => undefined })
        document.body.replaceChildren(card.root)
        expect(card.root.getAttribute('data-lh-card')).toBe('npc-words')
        expect(card.root.querySelector('.lh-card-title')!.textContent).toBe('NPC word targets')
        // No lead stands in the open: the help is the header's, in the card from the first paint.
        expect(card.root.querySelector('.lh-second-lead')).toBeNull()
        const tip = card.root.querySelector<HTMLButtonElement>('summary .lh-help-tip')!
        expect(tip.getAttribute('aria-label')).toBe('Help: NPC word targets')
        const help = card.root.querySelector<HTMLElement>('.lh-help-note')!
        expect(help.textContent).toBe(NPC_WORDS_HELP)
        expect(help.textContent).toBe('The target length, in words, of an NPC’s [CORE] text. A major NPC is recurring or important to the plot. A minor NPC is a shopkeeper, a guard or a one-off. The numbers are written into the NPC module’s instruction, which the agent reads.')
        expect(help.hidden).toBe(true)
        tip.click()
        expect(help.hidden).toBe(false)
        expect(Array.from(card.root.querySelectorAll('.lh-second-field > span')).map((s) => s.textContent)).toEqual(['Major NPC words', 'Minor NPC words'])
        expect(card.root.textContent).not.toContain('Agent modules editor')
    })
})

describe('the display marker library (72b; 96)', () => {
    it('lists every library marker with Multihog’s example line and draws each through the cards’ renderer', () => {
        const library = renderingTagsLibrary()
        expect(library.map((e) => e.key)).toEqual(getMarkerLibraryKeys())
        expect(library.find((e) => e.key === 'BAR')!.line).toBe('((BAR)) 50/100 (Colored resource bar)')
        const card = createMarkersCard(el)
        expect(card.open).toBe(false)
        expect(card.querySelector('.lh-card-title')!.textContent).toBe('Display marker library')
        const entries = Array.from(card.querySelectorAll('.lh-tags-entry'))
        expect(entries).toHaveLength(library.length)
        const bar = card.querySelector('[data-lh-tag="BAR"]')!
        expect(bar.querySelector('.lh-tags-token')!.textContent).toBe('((BAR)) 50/100 (Colored resource bar)')
        expect(bar.querySelector('.lh-tags-preview')!.innerHTML).toContain('rt-')
        expect(card.querySelectorAll('.lh-tags-preview').length).toBe(library.length)
        expect(Array.from(card.querySelectorAll('.lh-tags-preview')).every((p) => p.innerHTML.length > 0)).toBe(true)
    })

    it('draws its examples with no recolour handle, title or half-control: they are reference, not bars to configure (74i-ter)', () => {
        const card = createMarkersCard(el)
        expect(card.querySelector('.lh-tags-preview .rt-hp-bar')).not.toBeNull()
        expect(card.querySelector('.lh-tags-preview .rt-barrel-fill')).not.toBeNull()
        expect(card.querySelector('[data-recolor-id]')).toBeNull()
        expect(card.querySelector('[title^="Click to recolor"]')).toBeNull()
        expect(card.querySelector('.rt-barrel-color-control')).toBeNull()
        expect(card.querySelector('[data-recolor-percent]')).toBeNull()
    })

    it('has a description for every marker the library lists, none empty, and none for a marker it does not list (96)', () => {
        const keys = getMarkerLibraryKeys()
        for (const key of keys) expect(MARKER_DESCRIPTIONS[key]?.trim(), key).toBeTruthy()
        expect(Object.keys(MARKER_DESCRIPTIONS).sort()).toEqual([...keys].sort())
        expect(MARKER_DESCRIPTIONS.PILLS).toBe('A row of pills, separated by commas. Text in brackets shows on hover.')
        expect(MARKER_DESCRIPTIONS.BARREL).toBe('A signed bar with zero at the centre. On a card, click either half to recolour it.')
        expect(MARKER_DESCRIPTIONS.XPBAR).toBe('An XP bar with the level.')
    })

    it('puts the card’s help and each marker’s description behind a [?], in the DOM from the first paint and hidden (96)', () => {
        const card = createMarkersCard(el)
        // The card: the [?] after the title, the two paragraphs first in the body, no lead or hint standing open.
        const title = card.querySelector('summary .lh-card-title')!
        expect(title.nextElementSibling!.classList.contains('lh-help-tip')).toBe(true)
        const cardNote = card.querySelector('summary')!.nextElementSibling as HTMLElement
        expect(cardNote.classList.contains('lh-help-note')).toBe(true)
        expect(cardNote.hidden).toBe(true)
        expect(cardNote.textContent).toBe(MARKER_LIBRARY_HELP)
        expect(MARKER_LIBRARY_HELP).toBe('Every display marker a module’s text can use, each with an example drawn as the cards draw it. Put a marker at the start of a memo line, such as ((PILLS)) or ((BAR)). You can add a named colour, as in ((BARRED)), or an exact colour, as in ((BAR - #ff8800)).\n\nThe tracker copies the markers back when it rewrites the memo, so a module keeps the markers in its text. The narrator never sees them.')
        expect(card.querySelector('.lh-second-lead')).toBeNull()
        expect(card.querySelector('.lh-tags-hint')).toBeNull()
        expect(card.textContent).not.toContain('as it echoes the memo')
        // A press on the header's [?] opens the card and shows the help.
        ;(title.nextElementSibling as HTMLButtonElement).click()
        expect(card.open).toBe(true)
        expect(cardNote.hidden).toBe(false)
        // Every row: the name, its [?] on the same line, the note under it, then the code line and the drawing.
        for (const key of getMarkerLibraryKeys()) {
            const entry = card.querySelector(`[data-lh-tag="${key}"]`)!
            const [head, note, token, preview] = Array.from(entry.children) as HTMLElement[]
            expect(head!.querySelector('.lh-tags-name')!.textContent).toBe(`((${key}))`)
            const button = head!.querySelector('.lh-help-tip') as HTMLButtonElement
            expect(button.getAttribute('aria-label')).toBe(`Help: ((${key}))`)
            expect(button.closest('label')).toBeNull()
            expect(note!.classList.contains('lh-help-note')).toBe(true)
            expect(note!.hidden).toBe(true)
            expect(note!.textContent).toBe(MARKER_DESCRIPTIONS[key])
            expect(token!.classList.contains('lh-tags-token')).toBe(true)
            expect(preview!.classList.contains('lh-tags-preview')).toBe(true)
        }
        const barrel = card.querySelector('[data-lh-tag="BARREL"]')!
        ;(barrel.querySelector('.lh-help-tip') as HTMLButtonElement).click()
        expect((barrel.querySelector('.lh-help-note') as HTMLElement).hidden).toBe(false)
        // The card is the search's item: its text holds every marker's name and description.
        expect(card.classList.contains('lh-search-item')).toBe(true)
        expect(card.textContent).toContain('((XPBAR))')
        expect(card.textContent).toContain('An XP bar with the level.')
    })

    it('leaves Multihog’s example strings as they are: they draw the previews (96)', () => {
        expect(MARKER_TYPE_MAP.BARREL!.example).toBe('Trust: -38/150 (signed centre-zero bar; click each side to recolor)')
        expect(MARKER_TYPE_MAP.PILLS!.example).toBe('Status (Hover for details), Condition (Another detail)')
    })
})
