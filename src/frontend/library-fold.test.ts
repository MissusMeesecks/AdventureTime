// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'

import type { LibraryActionResult, LibraryRecordView, LibrarySources, NpcAddResult } from '../protocol.js'
import { createLibraryFold, describeBatch, describeLibraryAction, describePhoto, type LibraryFold, type LibraryFoldHost } from './library-fold.js'

afterEach(() => { document.body.replaceChildren() })

const KESTREL: LibraryRecordView = { id: 'k1', name: 'Kestrel', keys: ['Kestrel', 'Kes'], content: '[CORE]\nSpecies: Human\n[/CORE]', portraitPath: 'https://host/k.png', notes: 'scout', createdAt: 1, updatedAt: 2, blurb: 'Human' }
const ORRIN: LibraryRecordView = { ...KESTREL, id: 'o2', name: 'Orrin', keys: ['Orrin'], portraitPath: '', blurb: '', notes: '' }
const DONE: LibraryActionResult = { status: 'done', at: '2026-10-05T10:00:00Z', action: 'party', name: 'Kestrel', added: ['PARTY'], replaced: [], portrait: true }
const ADDED: NpcAddResult = { status: 'added', at: '2026-10-11T10:00:00Z', name: 'Kestrel', book: 'Vell_NPC', entryId: 'Vell_NPC::7', how: 'literal', portrait: true }
const SOURCES: LibrarySources = { book: 'Vell_NPC', entries: [{ id: 'e1', name: 'Mother Sedge', blurb: 'Keeper of the reeds.', core: true }, { id: 'e2', name: 'Loose Bill', blurb: '', core: false }], playerCard: { name: 'Robin Vale', blurb: 'Halfling' } }

function harness(over: Partial<LibraryFoldHost> = {}) {
    const calls: unknown[][] = []
    let records = [KESTREL, ORRIN]
    const host: LibraryFoldHost = {
        el: (tag, attrs) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n },
        list: async () => { calls.push(['list']); return { records } },
        sources: async () => { calls.push(['sources']); return SOURCES },
        saveEntry: async (request) => { calls.push(['saveEntry', request]); return { ...KESTREL, id: 'new', name: 'Mother Sedge' } },
        savePlayerCard: async (request) => { calls.push(['savePlayerCard', request]); return { ...KESTREL, id: 'pc', name: 'Robin Vale' } },
        update: async (request) => { calls.push(['update', request]); return { ...KESTREL, ...request, blurb: '' } },
        remove: async (id) => { calls.push(['remove', id]); records = records.filter((r) => r.id !== id) },
        importText: async (text) => { calls.push(['import', text]); return { records: [{ ...ORRIN, id: 'i', name: 'Imported' }] } },
        exportCard: async (id, portraitDataUrl) => { calls.push(['export', id, portraitDataUrl]); return { filename: 'multihog_npc_kestrel.mnpc.json', file: '{}', withPortrait: !!portraitDataUrl } },
        party: async (id) => { calls.push(['party', id]); return DONE },
        world: async (id) => { calls.push(['world', id]); return { ...ADDED, name: id === 'k1' ? 'Kestrel' : 'Orrin' } },
        playAsPc: async (id) => { calls.push(['pc', id]); return { ...DONE, action: 'pc', name: 'Kestrel Vane', card: { status: 'written', at: 't', name: 'Kestrel', words: 3 } } },
        pickText: async () => { calls.push(['pick']); return '{"name":"x"}' },
        pickImage: async () => { calls.push(['pickImage']); return { dataUrl: 'data:image/png;base64,AAAA', filename: 'kes.png' } },
        setPhoto: async (request) => { calls.push(['setPhoto', request]); records = records.map((r) => (r.id === request.id ? { ...r, portraitPath: 'https://host/set.png' } : r)); return { record: records.find((r) => r.id === request.id)!, placed: request.place } },
        drawPhoto: async (request) => { calls.push(['drawPhoto', request]); records = records.map((r) => (r.id === request.id ? { ...r, portraitPath: 'https://host/drawn.png' } : r)); return { record: records.find((r) => r.id === request.id)!, placed: request.place, prompt: 'A wary scout.', provider: 'swarm', model: 'sdxl', size: '896×1344' } },
        removePhoto: async (id) => { calls.push(['removePhoto', id]); records = records.map((r) => (r.id === id ? { ...r, portraitPath: '' } : r)); return { record: records.find((r) => r.id === id)!, placed: false } },
        inPlay: (name) => name === 'Kestrel',
        portraitData: async (src) => { calls.push(['portraitData', src]); return 'data:image/png;base64,AAAA' },
        download: (filename, text) => { calls.push(['download', filename, text]) },
        fail: (e) => calls.push(['fail', e]),
        when: (iso) => `at ${iso}`,
        confirm: async (message) => { calls.push(['confirm', message]); return true },
        ...over,
    }
    const fold = createLibraryFold(host)
    document.body.append(fold.root)
    return { fold, calls, host }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const open = async (fold: LibraryFold) => { fold.root.open = true; fold.root.dispatchEvent(new Event('toggle')); await settle() }
const names = (fold: LibraryFold) => Array.from(fold.root.querySelectorAll('.lh-library-card .lh-library-name')).map((n) => n.textContent)
const button = (fold: LibraryFold, label: string) => fold.root.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement
const textButton = (fold: LibraryFold, text: string) => Array.from(fold.root.querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement
const note = (fold: LibraryFold) => fold.root.querySelector('.lh-library-note')!.textContent ?? ''
const field = (fold: LibraryFold, name: string) => fold.root.querySelector(`[data-lh-field="library-${name}-input"]`) as HTMLInputElement & HTMLTextAreaElement

describe('the note', () => {
    it('says what an action did, with the portrait and the steps', () => {
        const when = (iso: string) => `at ${iso}`
        expect(describeLibraryAction(DONE, when)).toBe('Kestrel joined the party: PARTY. The roster is in the tracker’s cards. Their portrait is placed. Ran at 2026-10-05T10:00:00Z.')
        expect(describeLibraryAction({ ...DONE, action: 'pc', name: 'Kestrel Vane', portrait: false, at: '', card: { status: 'written', at: 't', name: 'Kestrel', words: 3 } }, when)).toBe('Kestrel Vane is the player now: PARTY. The sheet is in the tracker’s cards. The Player Card is written (3 words); it is in the Player Card fold.')
        expect(describeLibraryAction({ status: 'failed', at: 't', action: 'party', name: 'Kestrel', reason: 'the tracker pass changed nothing' }, when)).toBe('Kestrel did not join the party: the tracker pass changed nothing. Ran at t.')
        expect(describeLibraryAction({ status: 'failed', at: '', action: 'pc', name: '' }, when)).toBe('The card did not become the player: no reason given.')
    })
})

describe('the list', () => {
    it('reads nothing until opened, then lists the cards with blurbs, portraits and buttons', async () => {
        const { fold, calls } = harness()
        expect(calls).toEqual([])
        await open(fold)
        expect(calls).toEqual([['list']])
        expect(names(fold)).toEqual(['Kestrel', 'Orrin'])
        expect(fold.root.querySelector('img.lh-library-portrait')!.getAttribute('src')).toBe('https://host/k.png')
        expect(Array.from(fold.root.querySelectorAll('.lh-library-card .lh-library-blurb')).map((n) => n.textContent)).toEqual(['Human', 'No description'])
        expect(button(fold, 'Add “Kestrel” to the party').disabled).toBe(true)
        expect(button(fold, 'Add “Kestrel” to the party').title).toBe('Open a chat first.')
        fold.setChat('chat-1')
        expect(button(fold, 'Add “Kestrel” to the party').disabled).toBe(false)
    })

    it('filters by the search box, says when the library is empty, and when it could not be read', async () => {
        const { fold } = harness()
        await open(fold)
        const search = field(fold, 'search')
        search.value = 'orr'
        search.dispatchEvent(new Event('input'))
        expect(names(fold)).toEqual(['Orrin'])
        const empty = harness({ list: async () => ({ records: [] }) })
        await open(empty.fold)
        expect(empty.fold.root.querySelector('.lh-library-empty')!.textContent).toBe('The library is empty. Save a card from this campaign, or import a package.')
        const broken = harness({ list: async () => { throw new Error('disk gone') } })
        await open(broken.fold)
        expect(broken.fold.root.querySelector('.lh-library-empty')!.textContent).toBe('The library could not be read: disk gone.')
    })
})

describe('saving from the campaign', () => {
    it('lists the campaign\'s entries and the Player Card when asked, each with a Save button, and saves one', async () => {
        const { fold, calls } = harness()
        fold.setChat('chat-1')
        await open(fold)
        expect(textButton(fold, '📌 Save from this campaign').disabled).toBe(false)
        textButton(fold, '📌 Save from this campaign').click()
        await settle()
        const box = fold.root.querySelector('[data-lh-field="library-sources"]') as HTMLElement
        expect(box.hidden).toBe(false)
        expect(box.textContent).toContain('The campaign’s NPC book is Vell_NPC.')
        expect(Array.from(box.querySelectorAll('.lh-library-name')).map((n) => n.textContent)).toEqual(['Robin Vale (the Player Card)', 'Mother Sedge', 'Loose Bill (no [CORE] block)'])
        button(fold, 'Save “Mother Sedge”').click()
        await settle()
        expect(calls.filter(([op]) => op === 'saveEntry')).toEqual([['saveEntry', { entryId: 'e1', overwrite: false }]])
        expect(note(fold)).toBe('Saved “Mother Sedge” to the library.')
        // The list is read again, so the saved card shows.
        expect(calls.filter(([op]) => op === 'list')).toHaveLength(2)
        button(fold, 'Save the Player Card “Robin Vale”').click()
        await settle()
        expect(calls.filter(([op]) => op === 'savePlayerCard')).toEqual([['savePlayerCard', { overwrite: false }]])
    })

    it('asks before replacing a card that is already kept, and saves again with overwrite', async () => {
        let first = true
        const { fold, calls } = harness({ saveEntry: async (request) => { calls.push(['saveEntry', request]); if (first) { first = false; return { status: 'exists', name: 'Mother Sedge' } } return { ...KESTREL, name: 'Mother Sedge' } } })
        fold.setChat('chat-1')
        await open(fold)
        textButton(fold, '📌 Save from this campaign').click()
        await settle()
        button(fold, 'Save “Mother Sedge”').click()
        await settle()
        expect(calls.filter(([op]) => op === 'confirm')).toEqual([['confirm', '“Mother Sedge” is already in the library. Replace it?']])
        expect(calls.filter(([op]) => op === 'saveEntry')).toEqual([['saveEntry', { entryId: 'e1', overwrite: false }], ['saveEntry', { entryId: 'e1', overwrite: true }]])
        expect(note(fold)).toBe('Saved “Mother Sedge” to the library.')
    })

    it('keeps the card when the replacement is declined, and says why a book could not be read', async () => {
        const { fold, calls } = harness({ saveEntry: async () => ({ status: 'exists', name: 'Mother Sedge' }), confirm: async () => false })
        fold.setChat('chat-1')
        await open(fold)
        textButton(fold, '📌 Save from this campaign').click()
        await settle()
        button(fold, 'Save “Mother Sedge”').click()
        await settle()
        expect(note(fold)).toBe('Mother Sedge was not saved: the library already has “Mother Sedge”.')
        expect(calls.filter(([op]) => op === 'list')).toHaveLength(1)
        const broken = harness({ sources: async () => ({ book: '', entries: [], playerCard: null, error: 'PERMISSION_DENIED' }) })
        broken.fold.setChat('chat-1')
        await open(broken.fold)
        textButton(broken.fold, '📌 Save from this campaign').click()
        await settle()
        expect(broken.fold.root.querySelector('[data-lh-field="library-sources"]')!.textContent).toContain('The campaign’s NPC book could not be read: PERMISSION_DENIED.')
    })
})

describe('the card', () => {
    it('opens the text to edit, saves the name, keys, notes and text, and reads the list again', async () => {
        const { fold, calls } = harness()
        await open(fold)
        button(fold, 'Open the card “Kestrel”').click()
        expect(field(fold, 'content').value).toBe('[CORE]\nSpecies: Human\n[/CORE]')
        expect(field(fold, 'keys').value).toBe('Kestrel, Kes')
        field(fold, 'name').value = ' Kestrel Vane '
        field(fold, 'name').dispatchEvent(new Event('input'))
        field(fold, 'keys').value = 'KV, , Kes'
        field(fold, 'keys').dispatchEvent(new Event('input'))
        field(fold, 'content').value = 'Species: Elf'
        field(fold, 'content').dispatchEvent(new Event('input'))
        textButton(fold, 'Save').click()
        await settle()
        expect(calls.filter(([op]) => op === 'update')).toEqual([['update', { id: 'k1', name: 'Kestrel Vane', content: 'Species: Elf', keys: ['KV', 'Kes'], notes: 'scout' }]])
        expect(field(fold, 'content')).toBeNull()
        expect(note(fold)).toBe('Saved “Kestrel Vane”.')
        expect(calls.filter(([op]) => op === 'list')).toHaveLength(2)
    })

    it('cancels without writing, and opens one card at a time', async () => {
        const { fold, calls } = harness()
        await open(fold)
        button(fold, 'Open the card “Kestrel”').click()
        expect(button(fold, 'Open the card “Kestrel”').disabled).toBe(true)
        button(fold, 'Open the card “Orrin”').click()
        expect(fold.root.querySelectorAll('[data-lh-field="library-content-input"]')).toHaveLength(1)
        expect(field(fold, 'name').value).toBe('Orrin')
        textButton(fold, 'Cancel').click()
        expect(field(fold, 'content')).toBeNull()
        expect(calls.filter(([op]) => op === 'update')).toEqual([])
    })

    it('removes after asking, and not when declined', async () => {
        const { fold, calls } = harness()
        await open(fold)
        button(fold, 'Remove “Orrin”').click()
        await settle()
        expect(calls.filter(([op]) => op === 'confirm')).toEqual([['confirm', 'Remove “Orrin” from the library? This cannot be undone.']])
        expect(calls.filter(([op]) => op === 'remove')).toEqual([['remove', 'o2']])
        expect(names(fold)).toEqual(['Kestrel'])
        expect(note(fold)).toBe('Removed “Orrin”.')
        const kept = harness({ confirm: async () => false })
        await open(kept.fold)
        button(kept.fold, 'Remove “Orrin”').click()
        await settle()
        expect(kept.calls.filter(([op]) => op === 'remove')).toEqual([])
    })
})

describe('packages', () => {
    it('exports with the portrait read as a data URL, and without one when it cannot be read', async () => {
        const { fold, calls } = harness()
        await open(fold)
        button(fold, 'Export “Kestrel”').click()
        await settle()
        expect(calls.filter(([op]) => op === 'portraitData')).toEqual([['portraitData', 'https://host/k.png']])
        expect(calls.filter(([op]) => op === 'export')).toEqual([['export', 'k1', 'data:image/png;base64,AAAA']])
        expect(calls.filter(([op]) => op === 'download')).toEqual([['download', 'multihog_npc_kestrel.mnpc.json', '{}']])
        expect(note(fold)).toBe('Exported “Kestrel” with its portrait: multihog_npc_kestrel.mnpc.json.')
        const blind = harness({ portraitData: async () => '' })
        await open(blind.fold)
        button(blind.fold, 'Export “Kestrel”').click()
        await settle()
        expect(note(blind.fold)).toBe('Exported “Kestrel” without its portrait (the picture could not be read): multihog_npc_kestrel.mnpc.json.')
        button(blind.fold, 'Export “Orrin”').click()
        await settle()
        expect(note(blind.fold)).toBe('Exported “Orrin”: multihog_npc_kestrel.mnpc.json.')
    })

    it('imports a picked file and reads the list again, and says when the package is bad or none was picked', async () => {
        const { fold, calls } = harness()
        await open(fold)
        textButton(fold, '📥 Import a package').click()
        await settle()
        expect(calls.filter(([op]) => op === 'import')).toEqual([['import', '{"name":"x"}']])
        expect(note(fold)).toBe('Imported 1 card: Imported.')
        const bad = harness({ importText: async () => { throw new Error('Could not parse that as JSON.') } })
        await open(bad.fold)
        textButton(bad.fold, '📥 Import a package').click()
        await settle()
        expect(note(bad.fold)).toBe('The package was not imported: Could not parse that as JSON.')
        const none = harness({ pickText: async () => null })
        await open(none.fold)
        textButton(none.fold, '📥 Import a package').click()
        await settle()
        expect(none.calls.filter(([op]) => op === 'import')).toEqual([])
    })
})

describe('into play', () => {
    it('seats a card in the party: the running line, then the note', async () => {
        let release: (r: LibraryActionResult) => void = () => undefined
        const { fold, calls } = harness({ party: async (id) => { calls.push(['party', id]); return new Promise((resolve) => { release = resolve }) } })
        fold.setChat('chat-1')
        await open(fold)
        button(fold, 'Add “Kestrel” to the party').click()
        expect(fold.busy()).toBe(true)
        expect(fold.root.querySelector('.lh-world-running')!.textContent).toBe('👥 Seating “Kestrel” in the party… the tracker’s cards fill in when the roster is written.')
        expect(button(fold, 'Play as “Orrin”').disabled).toBe(true)
        // A second press while running, even forced, sends nothing.
        button(fold, 'Play as “Orrin”').disabled = false
        button(fold, 'Play as “Orrin”').click()
        await settle()
        expect(calls.filter(([op]) => op === 'pc')).toEqual([])
        release(DONE)
        await settle()
        expect(fold.busy()).toBe(false)
        expect(note(fold)).toContain('Kestrel joined the party: PARTY.')
        expect(calls.filter(([op]) => op === 'party')).toEqual([['party', 'k1']])
    })

    it('makes a card the player, and reports a failure in red', async () => {
        const { fold } = harness()
        fold.setChat('chat-1')
        await open(fold)
        button(fold, 'Play as “Kestrel”').click()
        await settle()
        expect(note(fold)).toContain('Kestrel Vane is the player now: PARTY.')
        const broken = harness({ playAsPc: async () => { throw new Error('timed out') } })
        broken.fold.setChat('chat-1')
        await open(broken.fold)
        button(broken.fold, 'Play as “Kestrel”').click()
        await settle()
        expect(note(broken.fold)).toBe('Kestrel did not become the player: timed out.')
        expect(broken.fold.root.querySelector('.lh-library-note')!.classList.contains('lh-world-note--error')).toBe(true)
    })

    it('does nothing for a forced press without a chat, and forgets the note when the chat goes', async () => {
        const { fold, calls } = harness()
        await open(fold)
        const b = button(fold, 'Add “Kestrel” to the party')
        b.disabled = false
        b.click()
        await settle()
        expect(calls.filter(([op]) => op === 'party')).toEqual([])
        fold.setChat('chat-1')
        button(fold, 'Add “Kestrel” to the party').click()
        await settle()
        expect(note(fold)).not.toBe('')
        fold.setChat(null)
        expect(note(fold)).toBe('')
    })
})

describe('into the world (53)', () => {
    const pick = (fold: LibraryFold, id: string) => fold.root.querySelector(`[data-lh-field="library-pick-${id}"]`) as HTMLInputElement
    const bar = (fold: LibraryFold) => fold.root.querySelector('[data-lh-field="library-picked"]') as HTMLElement
    const tick = (fold: LibraryFold, id: string, on = true) => { const box = pick(fold, id); box.checked = on; box.dispatchEvent(new Event('change')) }

    it('words the batch: who went in, by destination, and who did not with why', () => {
        expect(describeBatch('party', [{ name: 'Kestrel', ok: true }, { name: 'Orrin', ok: true }])).toBe('Joined the party: Kestrel, Orrin. The roster is in the tracker’s cards.')
        expect(describeBatch('world', [{ name: 'Kestrel', ok: true, book: 'Vell_NPC' }, { name: 'Orrin', ok: false, reason: 'already in Vell_NPC' }])).toBe('Added to Vell_NPC as is: Kestrel. The agent reads them from here on. Not added: Orrin (already in Vell_NPC).')
        expect(describeBatch('world', [{ name: 'Kestrel', ok: true }])).toBe('Added to the NPC book as is: Kestrel. The agent reads them from here on.')
        expect(describeBatch('party', [{ name: 'Orrin', ok: false }])).toBe('Did not join: Orrin (no reason given).')
    })

    it('adds one card to the world as the NPC creator does, and says what came back', async () => {
        const { fold, calls } = harness()
        await open(fold)
        expect(button(fold, 'Add “Kestrel” to the world').disabled).toBe(true)
        fold.setChat('chat-1')
        expect(button(fold, 'Add “Kestrel” to the world').disabled).toBe(false)
        button(fold, 'Add “Kestrel” to the world').click()
        expect(fold.root.querySelector('.lh-world-running')!.textContent).toBe('🌍 Adding “Kestrel” to the NPC book…')
        await settle()
        expect(calls.filter(([op]) => op === 'world')).toEqual([['world', 'k1']])
        expect(note(fold)).toBe('Added “Kestrel” to Vell_NPC as is. Their portrait is placed. The agent reads it from here on. Ran at 2026-10-11T10:00:00Z.')
        const exists = harness({ world: async () => ({ status: 'exists', at: 't', name: 'Kestrel', book: 'Vell_NPC', how: 'literal' }) })
        exists.fold.setChat('chat-1')
        await open(exists.fold)
        button(exists.fold, 'Add “Kestrel” to the world').click()
        await settle()
        expect(note(exists.fold)).toBe('“Kestrel” is already in Vell_NPC; nothing was added. Ran at t.')
        expect(exists.fold.root.querySelector('.lh-library-note')!.classList.contains('lh-world-note--error')).toBe(true)
        const broken = harness({ world: async () => { throw new Error('npc.add timed out') } })
        broken.fold.setChat('chat-1')
        await open(broken.fold)
        button(broken.fold, 'Add “Kestrel” to the world').click()
        await settle()
        expect(note(broken.fold)).toBe('Kestrel was not added to the world: npc.add timed out.')
    })

    it('shows the bar once a card is ticked, counts the picks, and clears them', async () => {
        const { fold } = harness()
        fold.setChat('chat-1')
        await open(fold)
        expect(bar(fold).hidden).toBe(true)
        tick(fold, 'k1')
        expect(bar(fold).hidden).toBe(false)
        expect(bar(fold).textContent).toContain('1 picked')
        tick(fold, 'o2')
        expect(bar(fold).textContent).toContain('2 picked')
        tick(fold, 'k1', false)
        expect(bar(fold).textContent).toContain('1 picked')
        // A redraw keeps the ticks.
        fold.setChat('chat-2')
        expect(pick(fold, 'o2').checked).toBe(true)
        button(fold, 'Clear the picked cards').click()
        expect(bar(fold).hidden).toBe(true)
        expect(pick(fold, 'o2').checked).toBe(false)
    })

    it('adds the picked cards to the party one after another, in the list’s order, and unticks the ones that went in', async () => {
        const { fold, calls } = harness({ party: async (id) => { calls.push(['party', id]); return id === 'o2' ? { status: 'failed', at: 't', action: 'party', name: 'Orrin', reason: 'the tracker pass changed nothing' } : DONE } })
        fold.setChat('chat-1')
        await open(fold)
        tick(fold, 'o2')
        tick(fold, 'k1')
        button(fold, 'Add the picked cards to the party').click()
        expect(fold.root.querySelector('.lh-world-running')!.textContent).toBe('👥 Seating “Kestrel” in the party (1 of 2)… the tracker’s cards fill in when the roster is written.')
        expect(pick(fold, 'o2').disabled).toBe(true)
        await settle()
        await settle()
        expect(calls.filter(([op]) => op === 'party')).toEqual([['party', 'k1'], ['party', 'o2']])
        expect(note(fold)).toBe('Joined the party: Kestrel. The roster is in the tracker’s cards. Did not join: Orrin (the tracker pass changed nothing).')
        expect(fold.root.querySelector('.lh-library-note')!.classList.contains('lh-world-note--error')).toBe(true)
        expect(pick(fold, 'k1').checked).toBe(false)
        expect(pick(fold, 'o2').checked).toBe(true)
        expect(fold.busy()).toBe(false)
    })

    it('adds the picked cards to the world, naming the book, a kept name and a refused call', async () => {
        const { fold, calls } = harness({ world: async (id) => { calls.push(['world', id]); if (id === 'o2') return { status: 'exists', at: 't', name: 'Orrin', book: 'Vell_NPC', how: 'literal' }; return ADDED } })
        fold.setChat('chat-1')
        await open(fold)
        tick(fold, 'k1')
        tick(fold, 'o2')
        button(fold, 'Add the picked cards to the world').click()
        expect(fold.root.querySelector('.lh-world-running')!.textContent).toBe('🌍 Adding “Kestrel” to the NPC book (1 of 2)…')
        await settle()
        await settle()
        expect(calls.filter(([op]) => op === 'world')).toEqual([['world', 'k1'], ['world', 'o2']])
        expect(note(fold)).toBe('Added to Vell_NPC as is: Kestrel. The agent reads them from here on. Not added: Orrin (already in Vell_NPC).')
        const broken = harness({ world: async () => { throw new Error('PERMISSION_DENIED') } })
        broken.fold.setChat('chat-1')
        await open(broken.fold)
        tick(broken.fold, 'k1')
        button(broken.fold, 'Add the picked cards to the world').click()
        await settle()
        expect(note(broken.fold)).toBe('Not added: Kestrel (PERMISSION_DENIED).')
        expect(pick(broken.fold, 'k1').checked).toBe(true)
    })

    it('keeps the bar’s buttons off without a chat, forgets the ticks when the chat goes, and drops a tick on a card that is gone', async () => {
        let records = [KESTREL, ORRIN]
        const { fold, calls } = harness({ list: async () => ({ records }) })
        await open(fold)
        tick(fold, 'k1')
        expect(button(fold, 'Add the picked cards to the party').disabled).toBe(true)
        expect(button(fold, 'Add the picked cards to the world').title).toBe('Open a chat first.')
        button(fold, 'Add the picked cards to the world').disabled = false
        button(fold, 'Add the picked cards to the world').click()
        await settle()
        expect(calls.filter(([op]) => op === 'world')).toEqual([])
        fold.setChat('chat-1')
        expect(button(fold, 'Add the picked cards to the party').disabled).toBe(false)
        fold.setChat(null)
        expect(bar(fold).hidden).toBe(true)
        fold.setChat('chat-1')
        tick(fold, 'o2')
        records = [KESTREL]
        await fold.refresh()
        expect(bar(fold).hidden).toBe(true)
    })
})

describe('the card\'s photo (60)', () => {
    const photoButton = (fold: LibraryFold, what: string, name: string) => button(fold, `${what} the photo of “${name}”`)
    const thumb = (fold: LibraryFold) => fold.root.querySelector('[data-lh-field="library-photo"] .lh-library-photo-thumb')

    it('opens large from the list and from the editor when the host has a modal, and stays plain without one (Phase 64)', async () => {
        const shown: string[][] = []
        const actions: unknown[] = []
        const { fold, calls } = harness({ enlarge: (src, title, offered) => { shown.push([src, title]); actions.push(offered) } })
        await open(fold)
        const listed = fold.root.querySelector('img.lh-library-portrait') as HTMLImageElement
        expect(listed.getAttribute('data-lh-large')).toBe('Kestrel')
        listed.click()
        expect(shown).toEqual([['https://host/k.png', 'Kestrel']])
        // The photo's buttons under the large view (80): the editor's three, Remove since a photo is kept.
        expect(actions[0]).toEqual({ kind: 'photo', set: expect.any(Function), draw: expect.any(Function), remove: expect.any(Function), fail: expect.any(Function) })
        // A card with no photo opens the empty box with the ways to get one.
        const orrin = fold.root.querySelector('.lh-library-portrait[data-lh-large="Orrin"]') as HTMLElement
        expect(orrin.tagName).toBe('DIV')
        orrin.click()
        expect(shown.at(-1)).toEqual(['', 'Orrin'])
        expect(actions.at(-1)).toEqual({ kind: 'photo', set: expect.any(Function), draw: expect.any(Function), fail: expect.any(Function) })
        button(fold, 'Open the card “Kestrel”').click()
        const photo = thumb(fold) as HTMLImageElement
        expect(photo.getAttribute('data-lh-large')).toBe('Kestrel')
        photo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        expect(shown.at(-1)).toEqual(['https://host/k.png', 'Kestrel'])
        // The buttons run the editor's own ops: Remove takes the photo off through the host.
        await (actions[0] as { remove: () => Promise<void> }).remove()
        expect(calls.find((c) => c[0] === 'removePhoto')).toEqual(['removePhoto', 'k1'])

        const plain = harness()
        await open(plain.fold)
        expect(plain.fold.root.querySelector('img.lh-library-portrait')!.hasAttribute('data-lh-large')).toBe(false)
    })

    it('says what a photo op did', () => {
        const record = { ...KESTREL, portraitPath: 'https://host/p.png' }
        expect(describePhoto('set', { record, placed: false })).toBe('The photo of “Kestrel” is set.')
        expect(describePhoto('set', { record, placed: true })).toBe('The photo of “Kestrel” is set. It is placed in this chat too.')
        expect(describePhoto('drawn', { record, placed: true, prompt: 'p', provider: 'swarm', model: 'sdxl', size: '896×1344' })).toBe('The photo of “Kestrel” is drawn by swarm (sdxl), 896×1344. It is placed in this chat too. The prompt is under the card’s editor.')
        expect(describePhoto('drawn', { record, placed: false, prompt: 'p', provider: 'odd', size: '', sizeNote: 'the provider takes no width and height' })).toBe('The photo of “Kestrel” is drawn by odd at the connection’s own size (the provider takes no width and height). The prompt is under the card’s editor.')
        expect(describePhoto('removed', { record: { ...record, portraitPath: '' }, placed: false })).toBe('The photo of “Kestrel” is removed. A chat that shows it keeps it.')
    })

    it('shows the photo in the editor with Change, Draw and Remove, and Set with no Remove on a card without one', async () => {
        const { fold } = harness()
        await open(fold)
        button(fold, 'Open the card “Kestrel”').click()
        expect(thumb(fold)!.getAttribute('src')).toBe('https://host/k.png')
        expect(photoButton(fold, 'Set', 'Kestrel').textContent).toBe('🖼 Change photo')
        expect(photoButton(fold, 'Draw', 'Kestrel').disabled).toBe(false)
        expect(photoButton(fold, 'Remove', 'Kestrel')).not.toBeNull()
        textButton(fold, 'Cancel').click()
        button(fold, 'Open the card “Orrin”').click()
        expect(thumb(fold)!.tagName).toBe('DIV')
        expect(photoButton(fold, 'Set', 'Orrin').textContent).toBe('🖼 Set photo')
        expect(photoButton(fold, 'Remove', 'Orrin')).toBeNull()
    })

    it('sets the photo from a picked file, placing it in the chat only when the chat is open and names the card', async () => {
        const { fold, calls } = harness()
        await open(fold)
        button(fold, 'Open the card “Orrin”').click()
        photoButton(fold, 'Set', 'Orrin').click()
        await settle()
        expect(calls.filter(([op]) => op === 'setPhoto')).toEqual([['setPhoto', { id: 'o2', dataUrl: 'data:image/png;base64,AAAA', filename: 'kes.png', place: false }]])
        expect(note(fold)).toBe('The photo of “Orrin” is set.')
        // The editor stays open on the card, now with its photo.
        expect(thumb(fold)!.getAttribute('src')).toBe('https://host/set.png')
        expect(photoButton(fold, 'Remove', 'Orrin')).not.toBeNull()
        fold.setChat('chat-1')
        textButton(fold, 'Cancel').click()
        button(fold, 'Open the card “Kestrel”').click()
        photoButton(fold, 'Set', 'Kestrel').click()
        await settle()
        expect(calls.filter(([op]) => op === 'setPhoto').at(-1)).toEqual(['setPhoto', { id: 'k1', dataUrl: 'data:image/png;base64,AAAA', filename: 'kes.png', place: true }])
        expect(note(fold)).toBe('The photo of “Kestrel” is set. It is placed in this chat too.')
    })

    it('does nothing when the picker is dismissed, and offers no picker on a host without one', async () => {
        const dismissed = harness({ pickImage: async () => null })
        await open(dismissed.fold)
        button(dismissed.fold, 'Open the card “Orrin”').click()
        photoButton(dismissed.fold, 'Set', 'Orrin').click()
        await settle()
        expect(dismissed.calls.filter(([op]) => op === 'setPhoto')).toEqual([])
        const none = harness({ pickImage: undefined })
        await open(none.fold)
        button(none.fold, 'Open the card “Orrin”').click()
        expect(photoButton(none.fold, 'Set', 'Orrin').disabled).toBe(true)
        expect(photoButton(none.fold, 'Set', 'Orrin').title).toBe('This build has no file picker.')
    })

    it('a draw whose prompt editor was cancelled (73f) draws nothing and says so', async () => {
        const { fold, calls } = harness({ drawPhoto: async (request) => { calls.push(['drawPhoto', request]); return null } })
        await open(fold)
        button(fold, 'Open the card “Orrin”').click()
        photoButton(fold, 'Draw', 'Orrin').click()
        await settle()
        expect(calls.at(-1)).toEqual(['drawPhoto', { id: 'o2', place: false }])
        expect(note(fold)).toBe('Nothing was drawn.')
        expect((fold.root.querySelector('.lh-world-running') as HTMLElement).hidden).toBe(true)
    })

    it('draws the photo: the live line while it runs, the note after, and the prompt under the editor', async () => {
        let release: (() => void) | null = null
        const { fold, calls } = harness({ drawPhoto: async (request) => { calls.push(['drawPhoto', request]); await new Promise<void>((resolve) => { release = resolve }); return { record: { ...ORRIN, portraitPath: 'https://host/drawn.png' }, placed: false, prompt: 'A dour smith.', provider: 'swarm', model: 'sdxl', size: '896×1344' } } })
        await open(fold)
        button(fold, 'Open the card “Orrin”').click()
        photoButton(fold, 'Draw', 'Orrin').click()
        await settle()
        expect(calls.at(-1)).toEqual(['drawPhoto', { id: 'o2', place: false }])
        expect(fold.root.querySelector('.lh-world-running')!.textContent).toBe('🎨 Drawing the photo of “Orrin”… one model call writes the prompt, then the image connection draws it.')
        expect(button(fold, 'Add “Kestrel” to the party').disabled).toBe(true)
        release!()
        await settle()
        expect(note(fold)).toBe('The photo of “Orrin” is drawn by swarm (sdxl), 896×1344. The prompt is under the card’s editor.')
        expect(fold.root.querySelector('[data-lh-field="library-photo-prompt"]')!.textContent).toBe('A dour smith.')
        expect((fold.root.querySelector('.lh-world-running') as HTMLElement).hidden).toBe(true)
    })

    it('says why a draw failed, and offers no Draw on a host that cannot draw', async () => {
        const failing = harness({ drawPhoto: async () => { throw new Error('This build cannot draw pictures: the host has not granted the image_gen permission.') } })
        await open(failing.fold)
        button(failing.fold, 'Open the card “Orrin”').click()
        photoButton(failing.fold, 'Draw', 'Orrin').click()
        await settle()
        expect(note(failing.fold)).toBe('The photo of “Orrin” could not be drawn: This build cannot draw pictures: the host has not granted the image_gen permission.')
        expect(failing.fold.root.querySelector('.lh-library-note')!.classList.contains('lh-world-note--error')).toBe(true)
        const none = harness({ drawPhoto: undefined })
        await open(none.fold)
        button(none.fold, 'Open the card “Orrin”').click()
        expect(photoButton(none.fold, 'Draw', 'Orrin').disabled).toBe(true)
    })

    it('removes the photo and says the chat keeps its copy', async () => {
        const { fold, calls } = harness()
        await open(fold)
        button(fold, 'Open the card “Kestrel”').click()
        photoButton(fold, 'Remove', 'Kestrel').click()
        await settle()
        expect(calls.filter(([op]) => op === 'removePhoto')).toEqual([['removePhoto', 'k1']])
        expect(note(fold)).toBe('The photo of “Kestrel” is removed. A chat that shows it keeps it.')
        expect(photoButton(fold, 'Remove', 'Kestrel')).toBeNull()
        expect(thumb(fold)!.tagName).toBe('DIV')
    })

    it('has a foot for what belongs with the library but is not a card', () => {
        const { fold } = harness()
        expect(fold.tail.classList.contains('lh-library-tail')).toBe(true)
        expect(fold.root.querySelector('.lh-library-body > .lh-library-tail')).toBe(fold.tail)
    })
})
