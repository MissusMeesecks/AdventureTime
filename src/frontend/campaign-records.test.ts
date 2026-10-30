// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'

import type { CampaignRecordsResult, MapCreateResult, RecordEntryDTO } from '../protocol.js'
import { coreFields, createRecordsFold, RECORDS_FOLD_CSS, stampLines, treeOf, withStockFolders, type RecordsFoldHost } from './campaign-records.js'
import { synopsis } from '../tracker/npc-library.js'

const el = (tag: string, attrs?: Record<string, string>) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n }
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0)) }

const entry = (over: Partial<RecordEntryDTO>): RecordEntryDTO => ({ id: 'e', uid: '1', title: 'X', keys: ['X'], content: 'Prose.', tokens: 2, pinned: false, disabled: false, hasMap: false, root: true, ...over })
const ELARA = entry({ id: 'n1', title: 'Elara', keys: ['Elara', 'innkeeper'], content: '[CORE]\nSpecies: Human\nRole: Innkeeper of the Gilded Hare\nBody: Tall, red hair\n[/CORE]\n[#4] She lent the party a room.', tokens: 30 })
const BRIN = entry({ id: 'n2', uid: '2', title: 'Brin', keys: ['Brin'], content: 'A smith.', tokens: 2, pinned: true })
// Titled and stamped as the agent wrote before 73a: the stamp on the title and at the head of the prose.
const OLD = entry({ id: 'n3', uid: '3', title: 'Old Tam [msg #0]', keys: ['Tam'], content: '[msg #0] [CORE]\nSpecies: Human\n[/CORE]\n[msg #7] He sold the party a mule.\nA plain line.', tokens: 12 })
const ABBEY = entry({ id: 'l1', title: 'Abbey Undercroft', keys: ['Abbey Undercroft'], content: '[CORE]\nA crypt beneath the abbey.\n[/CORE]', tokens: 9, hasMap: true, disabled: true })
const LANDING = entry({ id: 'l2', title: 'Abbey Undercroft :: Cellar Landing', keys: [], content: 'The party rested here.', tokens: 5, root: false })
const GLASSMERE = entry({ id: 'l3', title: 'Glassmere', keys: ['Glassmere'], content: 'A lake settlement with no map.', tokens: 7 })
const ORPHAN = entry({ id: 'l4', title: 'Hollow Keep :: Gate', keys: [], content: 'A gate.', tokens: 2, root: false })
const RESULT: CampaignRecordsResult = {
    prefix: 'Vell',
    books: [
        { id: 'b1', name: 'Vell_NPC', category: 'NPC', kind: 'npc', entries: [ELARA, BRIN], tokens: 32 },
        { id: 'b2', name: 'Vell_LOC', category: 'LOC', kind: 'location', entries: [ABBEY, LANDING, GLASSMERE, ORPHAN], tokens: 23 },
        { id: 'b3', name: 'Vell_World', category: 'World', kind: 'world', entries: [entry({ id: 'w1', title: 'Day 1', content: 'A report.' })], tokens: 2 },
    ],
    mapping: true,
    mapped: [{ siteRoot: 'Abbey Undercroft', kind: 'DUNGEON', hosted: false }, { siteRoot: 'Morrowfen', kind: 'SETTLEMENT', hosted: false }, { siteRoot: 'Inner Cell', kind: 'INTERIOR', hosted: true }],
    allBooks: ['Elsewhere', 'Vell_LOC', 'Vell_NPC', 'Vell_World'],
}
/** The same campaign with the old stamped entry in its NPC book (73a-ter). */
const WITH_OLD: CampaignRecordsResult = { ...RESULT, books: [{ ...RESULT.books[0]!, entries: [ELARA, BRIN, OLD], tokens: 44 }, ...RESULT.books.slice(1)] }

afterEach(() => { document.body.replaceChildren() })

function mount(options: { result?: CampaignRecordsResult; confirmed?: boolean; create?: MapCreateResult; libraryExists?: boolean; listFail?: string; cards?: boolean; extra?: Partial<RecordsFoldHost> } = {}) {
    const calls: Array<[string, ...unknown[]]> = []
    const failures: unknown[] = []
    let result = options.result ?? RESULT
    const host: RecordsFoldHost = {
        el,
        list: async () => { calls.push(['list']); if (options.listFail) throw new Error(options.listFail); return result },
        update: async (write) => { calls.push(['update', write]); return { entry: entry({ ...write, keys: write.keys }) } },
        remove: async (entryId) => { calls.push(['remove', entryId]); return { removed: true, title: entryId } },
        pin: async (entryId, pinned) => { calls.push(['pin', entryId, pinned]); return { entry: entry({ id: entryId, title: 'Brin', pinned }) } },
        removeMap: async (entryId) => { calls.push(['removeMap', entryId]); return { siteRoot: 'Abbey Undercroft', entry: entry({ id: entryId }) } },
        create: async (request) => { calls.push(['create', request]); return options.create ?? { status: 'written', at: 't', site: String(request.site), kind: 'DUNGEON', areas: 4, assets: 3, entryId: 'Vell_LOC::9' } },
        cards: async () => { calls.push(['cards']); return [{ id: 'k1', name: 'Mara', snippet: '' }] },
        saveToLibrary: async (entryId, overwrite) => { calls.push(['library', entryId, overwrite]); return options.libraryExists && !overwrite ? { status: 'exists', name: 'Elara' } : { name: 'Elara' } },
        clean: async (target, requirements) => { calls.push(['clean', target, requirements]) },
        confirm: async (title, _message, label) => { calls.push(['confirm', title, label]); return options.confirmed !== false },
        onMapsChanged: () => { calls.push(['maps']) },
        onLibraryChanged: () => { calls.push(['library-changed']) },
        fail: (error) => { failures.push(error) },
        // The compact rows unless a test asks for Multihog's cards (78b).
        npcCards: () => options.cards === true,
        ...(options.extra ?? {}),
    }
    const fold = createRecordsFold(host)
    document.body.append(fold.root)
    const root = fold.root
    const q = <T extends Element>(selector: string) => root.querySelector(selector) as T
    const rows = () => Array.from(root.querySelectorAll<HTMLElement>('.lh-records-folder-body:not([hidden]) .lh-records-row'))
    const row = (id: string) => root.querySelector(`[data-lh-entry="${id}"]`) as HTMLElement
    const folder = (name: string) => root.querySelector(`[data-lh-book="${name}"]`) as HTMLElement
    const openFolder = (name: string) => { (folder(name).querySelector('.lh-records-folder-head') as HTMLElement).click() }
    const note = () => q<HTMLElement>('[data-lh-field="records-note"]').textContent ?? ''
    const openIt = async () => { root.open = true; root.dispatchEvent(new Event('toggle')); await settle() }
    return { fold, root, calls, failures, q, rows, row, folder, openFolder, note, openIt, setResult: (r: CampaignRecordsResult) => { result = r } }
}

describe('the records’ helpers (71a)', () => {
    it('reads an NPC’s CORE as fields, the rest as notes, and nothing from an entry without one', () => {
        expect(coreFields(ELARA.content)).toEqual([['Species', 'Human'], ['Role', 'Innkeeper of the Gilded Hare'], ['Body', 'Tall, red hair']])
        expect(coreFields('[CORE]\nJust prose here.\nMood: grim\n[/CORE]')).toEqual([['Notes', 'Just prose here.'], ['Mood', 'grim']])
        expect(coreFields('[CORE]\nMood: grim\nand worse\n[/CORE]')).toEqual([['Mood', 'grim\nand worse']])
        expect(coreFields('A smith.')).toBeNull()
    })

    it('builds the two-level tree: roots in the book’s order, their children sorted, a parent with no entry virtual', () => {
        const tree = treeOf([LANDING, ABBEY, GLASSMERE, ORPHAN, entry({ id: 'l5', title: 'Abbey Undercroft :: Altar', root: false })])
        expect(tree.map((n) => [n.root, n.entry?.id ?? null, n.children.map((c) => c.id)])).toEqual([
            ['Abbey Undercroft', 'l1', ['l5', 'l2']],
            ['Glassmere', 'l3', []],
            ['Hollow Keep', null, ['l4']],
        ])
    })
})

describe('the Campaign records fold (71a)', () => {
    it('reads the books when opened for a chat, draws them as folders in order, and the entries with their standing, tokens and buttons', async () => {
        const { fold, root, calls, openIt, folder, openFolder, row, rows } = mount()
        expect(root.querySelector('.lh-records-empty')!.textContent).toBe('No chat open.')
        fold.setChat('c1')
        expect(calls).toEqual([])
        await openIt()
        expect(calls).toEqual([['list']])
        expect(root.querySelector('summary')!.textContent).toBe('Campaign records — 3 books')
        expect(Array.from(root.querySelectorAll('.lh-records-folder')).map((f) => f.getAttribute('data-lh-book'))).toEqual(['Vell_NPC', 'Vell_LOC', 'Vell_World'])
        expect(folder('Vell_NPC').querySelector('.lh-records-folder-name')!.textContent).toBe('NPCs')
        expect(folder('Vell_LOC').querySelector('.lh-records-folder-name')!.textContent).toBe('Locations')
        // Multihog's count: the entries in the scan over all of them.
        expect(folder('Vell_NPC').querySelector('.lh-records-folder-count')!.textContent).toBe('2/2 (32t)')
        expect(folder('Vell_LOC').querySelector('.lh-records-folder-count')!.textContent).toBe('3/4 (23t)')
        expect((folder('Vell_NPC').querySelector('.lh-records-folder-body') as HTMLElement).hidden).toBe(true)
        expect(folder('Vell_LOC').querySelector('[data-lh-field="records-add-mapped"]')!.textContent).toBe('+ Add Mapped Location')
        expect(folder('Vell_NPC').querySelector('[data-lh-field="records-add-mapped"]')).toBeNull()
        openFolder('Vell_NPC')
        expect(rows().map((r) => r.getAttribute('data-lh-entry'))).toEqual(['n1', 'n2'])
        expect(row('n1').querySelector('.lh-records-tokens')!.textContent).toBe('30t')
        expect(row('n2').querySelector('.lh-records-dot')!.classList.contains('lh-records-dot--pinned')).toBe(true)
        expect(row('n2').querySelector('[data-lh-field="records-pin"]')!.classList.contains('lh-records-icon--on')).toBe(true)
        expect(Array.from(row('n1').querySelectorAll('.lh-records-actions button')).map((b) => b.getAttribute('data-lh-field'))).toEqual(['records-bookmark', 'records-pin', 'records-edit', 'records-clean', 'records-delete'])
        openFolder('Vell_LOC')
        expect(rows().map((r) => r.getAttribute('data-lh-entry') ?? r.textContent)).toEqual(['n1', 'n2', 'l1', 'l2', 'l3', 'Hollow Keep', 'l4'])
        expect(row('l2').classList.contains('lh-records-row--child')).toBe(true)
        expect(row('l2').querySelector('.lh-records-title')!.textContent).toBe('Cellar Landing')
        expect(row('l1').querySelector('[data-lh-field="records-map-badge"]')).not.toBeNull()
        expect(row('l1').querySelector('.lh-records-dot')!.classList.contains('lh-records-dot--disabled')).toBe(true)
        expect(row('l3').querySelector('[data-lh-field="records-map-make"]')!.textContent).toBe('+ MAP')
        expect(row('l2').querySelector('[data-lh-field="records-map-make"]')).toBeNull()
        expect(Array.from(row('l1').querySelectorAll('.lh-records-actions button')).map((b) => b.getAttribute('data-lh-field'))).toEqual(['records-pin', 'records-edit', 'records-clean', 'records-delete'])
        openFolder('Vell_World')
        expect(row('w1').querySelector('[data-lh-field="records-clean"]')).toBeNull()
        expect(folder('Vell_World').querySelector('.lh-records-folder-icon')!.textContent).toBe('🌍')
        // The World Skeleton's seed book is its own folder after the reports (78b-bis): it drew as a second World.
        const skeleton = { id: 'b4', name: 'Vell_Skeleton', category: 'Skeleton', kind: 'skeleton' as const, entries: [entry({ id: 's1', title: 'FACTION: The Night Shift Network', content: 'A seed.', disabled: true })], tokens: 2 }
        const seeded = mount({ result: { ...RESULT, books: [...RESULT.books, skeleton] } })
        seeded.fold.setChat('c1')
        await seeded.openIt()
        expect(Array.from(seeded.root.querySelectorAll('.lh-records-folder')).map((f) => f.querySelector('.lh-records-folder-name')!.textContent)).toEqual(['NPCs', 'Locations', 'World', 'World skeleton'])
        expect(seeded.folder('Vell_Skeleton').querySelector('.lh-records-folder-icon')!.textContent).toBe('🦴')
        seeded.openFolder('Vell_Skeleton')
        expect(seeded.row('s1').querySelector('[data-lh-field="records-clean"]')).toBeNull()
        // The mapping section off: no badges, no form button.
        const off = mount({ result: { ...RESULT, mapping: false } })
        off.fold.setChat('c1')
        await off.openIt()
        expect(off.folder('Vell_LOC').querySelector('[data-lh-field="records-add-mapped"]')).toBeNull()
        off.openFolder('Vell_LOC')
        expect(off.row('l1').querySelector('[data-lh-field="records-map-badge"]')).toBeNull()
        expect(off.row('l3').querySelector('[data-lh-field="records-map-make"]')).toBeNull()
    })

    it('opens an entry on a click — an NPC’s CORE as fields — and edits it, the keys split and the map noted', async () => {
        const { fold, root, calls, openIt, openFolder, row, q, note } = mount()
        fold.setChat('c1')
        await openIt()
        openFolder('Vell_NPC')
        row('n1').click()
        const body = root.querySelector('[data-lh-entry-body="n1"]')!
        expect(body.querySelector('.lh-records-keys')!.textContent).toBe('Keys: Elara, innkeeper')
        expect(Array.from(body.querySelectorAll('.lh-records-core dt')).map((d) => d.textContent)).toEqual(['Species', 'Role', 'Body'])
        expect(body.querySelector('.lh-records-text')!.textContent).toBe('[#4] She lent the party a room.')
        row('n1').click()
        expect(root.querySelector('[data-lh-entry-body="n1"]')).toBeNull()
        ;(row('n1').querySelector('[data-lh-field="records-edit"]') as HTMLButtonElement).click()
        const title = q<HTMLInputElement>('[data-lh-field="records-edit-title"]')
        expect(title.value).toBe('Elara')
        title.value = 'Elara Vey'
        title.dispatchEvent(new Event('input'))
        const keys = q<HTMLInputElement>('[data-lh-field="records-edit-keys"]')
        keys.value = 'Elara, Vey; innkeeper'
        keys.dispatchEvent(new Event('input'))
        const content = q<HTMLTextAreaElement>('[data-lh-field="records-edit-content"]')
        content.value = '[CORE]\nSpecies: Human\n[/CORE]'
        content.dispatchEvent(new Event('input'))
        q<HTMLButtonElement>('[data-lh-field="records-edit-save"]').click()
        await settle()
        expect(calls.filter((c) => c[0] === 'update')).toEqual([['update', { entryId: 'n1', title: 'Elara Vey', keys: ['Elara', 'Vey', 'innkeeper'], content: '[CORE]\nSpecies: Human\n[/CORE]' }]])
        expect(note()).toBe('Saved “Elara Vey”.')
        expect(calls.filter((c) => c[0] === 'list')).toHaveLength(2)
        // A mapped root's editor says the map is kept.
        openFolder('Vell_LOC')
        ;(row('l1').querySelector('[data-lh-field="records-edit"]') as HTMLButtonElement).click()
        expect(root.querySelector('[data-lh-entry-body="l1"] .lh-records-hint')!.textContent).toContain('The [MAP] section is kept as it stands')
    })

    it('pins and unpins, asks before a delete and before a map’s removal, and tells the Maps fold', async () => {
        const { fold, calls, openIt, openFolder, row, note } = mount()
        fold.setChat('c1')
        await openIt()
        openFolder('Vell_NPC')
        ;(row('n2').querySelector('[data-lh-field="records-pin"]') as HTMLButtonElement).click()
        await settle()
        expect(calls.filter((c) => c[0] === 'pin')).toEqual([['pin', 'n2', false]])
        expect(note()).toBe('Unpinned “Brin”.')
        ;(row('n1').querySelector('[data-lh-field="records-pin"]') as HTMLButtonElement).click()
        await settle()
        expect(calls.filter((c) => c[0] === 'pin')).toEqual([['pin', 'n2', false], ['pin', 'n1', true]])
        expect(note()).toBe('Pinned “Brin”: always in the prompt.')
        openFolder('Vell_LOC')
        ;(row('l1').querySelector('[data-lh-field="records-delete"]') as HTMLButtonElement).click()
        await settle()
        expect(calls.filter((c) => c[0] === 'confirm')).toEqual([['confirm', 'Delete this entry', 'Delete']])
        expect(calls.filter((c) => c[0] === 'remove')).toEqual([['remove', 'l1']])
        expect(calls.filter((c) => c[0] === 'maps')).toEqual([['maps']])
        ;(row('l1').querySelector('[data-lh-field="records-map-remove"]') as HTMLButtonElement).click()
        await settle()
        expect(calls.filter((c) => c[0] === 'confirm').at(-1)).toEqual(['confirm', 'Remove the map', 'Remove the map'])
        expect(calls.filter((c) => c[0] === 'removeMap')).toEqual([['removeMap', 'l1']])
        expect(note()).toBe('Removed the map from “Abbey Undercroft”.')
        expect(calls.filter((c) => c[0] === 'maps')).toHaveLength(2)
        // Declined: nothing happens.
        const declined = mount({ confirmed: false })
        declined.fold.setChat('c1')
        await declined.openIt()
        declined.openFolder('Vell_NPC')
        ;(declined.row('n1').querySelector('[data-lh-field="records-delete"]') as HTMLButtonElement).click()
        await settle()
        expect(declined.calls.some((c) => c[0] === 'remove')).toBe(false)
    })

    it('bookmarks an NPC into the library, asking before a kept name is replaced, and cleans through the agent', async () => {
        const { fold, root, calls, openIt, openFolder, row, note, q } = mount({ libraryExists: true })
        fold.setChat('c1')
        await openIt()
        openFolder('Vell_NPC')
        ;(row('n1').querySelector('[data-lh-field="records-bookmark"]') as HTMLButtonElement).click()
        await settle()
        expect(calls.filter((c) => c[0] === 'library' || c[0] === 'confirm' || c[0] === 'library-changed')).toEqual([['library', 'n1', false], ['confirm', 'NPC library', 'Replace'], ['library', 'n1', true], ['library-changed']])
        expect(note()).toBe('Saved “Elara” to the NPC library.')
        ;(row('n1').querySelector('[data-lh-field="records-clean"]') as HTMLButtonElement).click()
        expect(root.querySelector('[data-lh-field="records-clean"]')).not.toBeNull()
        q<HTMLTextAreaElement>('[data-lh-field="records-clean-text"]').value = 'Keep the Body line'
        q<HTMLButtonElement>('[data-lh-field="records-clean-go"]').click()
        await settle()
        expect(calls.filter((c) => c[0] === 'clean')).toEqual([['clean', 'Vell_NPC::1', 'Keep the Body line']])
        expect(calls.filter((c) => c[0] === 'update')).toEqual([])
        expect(note()).toBe('The agent cleaned “Elara”; its report is in the agent’s box.')
    })

    it('takes an old stamp off the title itself when cleaning a stamped entry (73a-ter), before the agent runs, and says so', async () => {
        const { fold, calls, openIt, openFolder, row, note, q } = mount({ result: WITH_OLD })
        fold.setChat('c1')
        await openIt()
        openFolder('Vell_NPC')
        ;(row('n3').querySelector('[data-lh-field="records-clean"]') as HTMLButtonElement).click()
        q<HTMLButtonElement>('[data-lh-field="records-clean-go"]').click()
        await settle()
        expect(calls.filter((c) => c[0] === 'update' || c[0] === 'clean')).toEqual([
            ['update', { entryId: 'n3', title: 'Old Tam', keys: ['Tam'], content: OLD.content }],
            ['clean', 'Vell_NPC::3', ''],
        ])
        expect(note()).toBe('The agent cleaned “Old Tam”, and the stamp is off its title; its report is in the agent’s box.')
    })

    it('draws the prose stamps as notes (73a-ter): a bare stamp line as written at message N, a stamped line with the message before its prose', () => {
        expect(stampLines('[msg #0]\n[msg #7] He sold a mule.\nA plain line.\n  [msg #12]  ')).toEqual([
            { stamp: 0, note: 'written at message 0', text: '' },
            { stamp: 7, note: 'message 7', text: 'He sold a mule.' },
            { stamp: null, note: '', text: 'A plain line.' },
            { stamp: 12, note: 'written at message 12', text: '' },
        ])
    })

    it('shows the notes in an opened entry (73a-ter): the stamp at the head of the prose as written at message 0, a stamped line with its message, a plain line as it is', async () => {
        const { fold, root, openIt, openFolder, row } = mount({ result: WITH_OLD })
        fold.setChat('c1')
        await openIt()
        openFolder('Vell_NPC')
        row('n3').click()
        const body = root.querySelector('[data-lh-entry-body="n3"]')!
        expect(Array.from(body.querySelectorAll('.lh-records-core dt')).map((d) => d.textContent)).toEqual(['Species'])
        expect(Array.from(body.querySelectorAll('.lh-records-stamp')).map((s) => s.textContent)).toEqual(['written at message 0', 'message 7'])
        expect(body.querySelector('.lh-records-text')!.textContent).toBe('written at message 0\nmessage 7 He sold the party a mule.\nA plain line.')
        expect(body.querySelector('.lh-records-text')!.textContent).not.toContain('[msg #')
    })

    it('+ MAP opens the form on the root with the premise filled; Manual hands the form to the architect and says what was drawn', async () => {
        const { fold, root, calls, openIt, openFolder, row, q, note } = mount()
        fold.setChat('c1')
        await openIt()
        openFolder('Vell_LOC')
        ;(row('l3').querySelector('[data-lh-field="records-map-make"]') as HTMLButtonElement).click()
        await settle()
        const form = root.querySelector('[data-lh-field="records-mapform"]') as HTMLElement
        expect(form).not.toBeNull()
        expect(form.querySelector('[data-lh-field="mapform-name"]')).toBeNull()
        expect(calls.some((c) => c[0] === 'cards')).toBe(true)
        expect(q<HTMLTextAreaElement>('[data-lh-field="mapform-prompt"]').value).toBe('A lake settlement with no map.')
        expect(q<HTMLInputElement>('[data-lh-field="mapform-description"]').value).toBe('A lake settlement with no map.')
        expect(Array.from(form.querySelectorAll('[data-lh-field="mapform-include"] input')).map((i) => i.getAttribute('data-lh-include'))).toEqual(['Abbey Undercroft'])
        expect(Array.from(form.querySelectorAll('[data-lh-field="mapform-lorebooks"] input')).map((i) => i.getAttribute('data-lh-lorebook'))).toEqual(['Elsewhere', 'Vell_LOC', 'Vell_NPC', 'Vell_World'])
        expect(Array.from(form.querySelectorAll('[data-lh-field="mapform-cards"] input')).map((i) => i.getAttribute('data-lh-card'))).toEqual(['k1'])
        const manual = form.querySelector('input[value="manual"]') as HTMLInputElement
        manual.checked = true
        manual.dispatchEvent(new Event('change'))
        expect((form.querySelector('[data-lh-field="mapform-manual"]') as HTMLElement).hidden).toBe(false)
        const dungeon = form.querySelector('input[value="DUNGEON"]') as HTMLInputElement
        dungeon.checked = true
        dungeon.dispatchEvent(new Event('change'))
        expect(q<HTMLSelectElement>('[data-lh-field="mapform-threat"]').value).toBe('HIGH')
        q<HTMLInputElement>('[data-lh-field="mapform-entrance"]').value = 'Boathouse'
        ;(form.querySelector('[data-lh-include="Abbey Undercroft"]') as HTMLInputElement).checked = true
        ;(form.querySelector('[data-lh-lorebook="Elsewhere"]') as HTMLInputElement).checked = true
        ;(form.querySelector('[data-lh-card="k1"]') as HTMLInputElement).checked = true
        q<HTMLButtonElement>('[data-lh-field="mapform-go"]').click()
        await settle()
        expect(calls.filter((c) => c[0] === 'create')).toEqual([['create', { site: 'Glassmere', mode: 'manual', requireNew: false, lorebooks: ['Elsewhere'], cards: ['k1'], kind: 'DUNGEON', entrance: 'Boathouse', scale: 'MEDIUM', threat: 'HIGH', prompt: 'A lake settlement with no map.', briefDescription: 'A lake settlement with no map.', include: ['Abbey Undercroft'] }]])
        expect(note()).toBe('Drew Glassmere (DUNGEON): 4 areas, 3 things in them, saved to Vell_LOC::9.')
        expect(calls.filter((c) => c[0] === 'maps')).toEqual([['maps']])
        expect(root.querySelector('[data-lh-field="records-mapform"]')).toBeNull()
    })

    it('+ Add Mapped Location asks for a name and sends Auto’s brief, lookback and keywords; a failure stays in the form with its reason', async () => {
        const { fold, root, calls, openIt, folder, q, note } = mount({ create: { status: 'failed', at: 't', site: 'Nowhere Keep', reason: 'A location named "Nowhere Keep" already exists. Use + MAP on that root instead.' } })
        fold.setChat('c1')
        await openIt()
        ;(folder('Vell_LOC').querySelector('[data-lh-field="records-add-mapped"]') as HTMLButtonElement).click()
        await settle()
        const form = root.querySelector('[data-lh-field="records-mapform"]') as HTMLElement
        expect((folder('Vell_LOC').querySelector('.lh-records-folder-body') as HTMLElement).hidden).toBe(false)
        q<HTMLButtonElement>('[data-lh-field="mapform-go"]').click()
        expect(note()).toBe('A location name is required.')
        q<HTMLInputElement>('[data-lh-field="mapform-name"]').value = 'Nowhere :: Keep'
        q<HTMLButtonElement>('[data-lh-field="mapform-go"]').click()
        expect(note()).toBe('Use a location root name, not a nested :: path.')
        q<HTMLInputElement>('[data-lh-field="mapform-name"]').value = 'Nowhere Keep'
        q<HTMLTextAreaElement>('[data-lh-field="mapform-brief"]').value = 'A ruined keep on the moor.'
        q<HTMLInputElement>('[data-lh-field="mapform-lookback"]').value = '0'
        const manual = form.querySelector('input[value="manual"]') as HTMLInputElement
        manual.checked = true
        manual.dispatchEvent(new Event('change'))
        q<HTMLInputElement>('[data-lh-field="mapform-keys"]').value = 'the keep, moor'
        const auto = form.querySelector('input[value="auto"]') as HTMLInputElement
        auto.checked = true
        manual.checked = false
        auto.dispatchEvent(new Event('change'))
        q<HTMLButtonElement>('[data-lh-field="mapform-go"]').click()
        await settle()
        expect(calls.filter((c) => c[0] === 'create')).toEqual([['create', { site: 'Nowhere Keep', mode: 'auto', requireNew: true, lorebooks: [], cards: [], brief: 'A ruined keep on the moor.', lookback: 0, keywords: ['the keep', 'moor'] }]])
        expect(note()).toBe('The architect failed for Nowhere Keep: A location named "Nowhere Keep" already exists. Use + MAP on that root instead.')
        expect(root.querySelector('[data-lh-field="records-mapform"]')).not.toBeNull()
        expect(calls.some((c) => c[0] === 'maps')).toBe(false)
    })

    it('says when the books could not be read, when the campaign has no name, forgets everything on a chat change and reads again on Refresh', async () => {
        const broken = mount({ listFail: 'PERMISSION_DENIED' })
        broken.fold.setChat('c1')
        await broken.openIt()
        expect(broken.root.querySelector('.lh-records-note--error')!.textContent).toBe('The books could not be read: PERMISSION_DENIED')
        const unnamed = mount({ result: { prefix: '', books: [], mapping: false, mapped: [], allBooks: [] } })
        unnamed.fold.setChat('c1')
        await unnamed.openIt()
        expect(unnamed.root.querySelector('.lh-records-empty')!.textContent).toBe('Name the campaign to see its records.')
        const { fold, root, calls, openIt, openFolder, row, q } = mount()
        fold.setChat('c1')
        await openIt()
        openFolder('Vell_NPC')
        row('n1').click()
        expect(root.querySelector('[data-lh-entry-body="n1"]')).not.toBeNull()
        fold.setChat('c2')
        await settle()
        expect(calls.filter((c) => c[0] === 'list')).toHaveLength(2)
        expect(root.querySelector('[data-lh-entry-body="n1"]')).toBeNull()
        q<HTMLButtonElement>('[data-lh-field="records-refresh"]').click()
        await settle()
        expect(calls.filter((c) => c[0] === 'list')).toHaveLength(3)
        fold.setChat(null)
        expect(root.querySelector('.lh-records-empty')!.textContent).toBe('No chat open.')
    })
})

describe('Multihog’s manifest (78b): the Player Character, the NPC cards, the Full NPC Card, the folders’ doors', () => {
    const RELATIONS = { at: 't', enabled: true, mode: 'state_tracker' as const, max: 150, updatedAt: 't', npcs: [{ id: 'Vell_NPC::1', label: 'Elara', friendship: 40, affection: -5, friendshipTier: { label: 'x', hint: 'x' }, affectionTier: { label: 'x', hint: 'x' }, log: [{ at: 't', field: 'friendship' as const, delta: 40, applied: 40, newValue: 40, source: 'tracker' as const }] }] }
    const CARD = { card: { name: 'Robin Vale', bio: 'Species: Human\nBody: Lean and quick.\nPersonality: Wry.', wordCount: 8, at: 't' }, persona: null, personasAvailable: true, activePersona: '', activeDescribed: false }
    const shown: Array<{ title: string; nodes: HTMLElement[]; close: () => void }> = []
    const modal: NonNullable<RecordsFoldHost['modal']> = (options) => {
        let open = true
        const box = { get open() { return open }, close: () => { if (!open) return; open = false; options.onClose?.() } }
        shown.push({ title: options.title, nodes: options.nodes, close: box.close })
        return box
    }
    const playerRoot = el('details', { class: 'lh-player-card' }) as HTMLDetailsElement
    const library = el('details', { class: 'lh-library' }) as HTMLDetailsElement
    const npcBox = el('div', { 'data-lh-field': 'npc-card-settings' })
    const locBox = el('div', { 'data-lh-field': 'location-card-settings' })
    const guide = el('details', { class: 'lh-maps-guide' }) as HTMLDetailsElement
    const edits: string[] = []
    const extra = (over: Partial<RecordsFoldHost> = {}): Partial<RecordsFoldHost> => ({
        relations: async () => RELATIONS,
        setRelation: async (id, field, value) => ({ ...RELATIONS, npcs: RELATIONS.npcs.map((n) => (n.id === id ? { ...n, [field]: value } : n)) }),
        forgetRelation: async () => ({ ...RELATIONS, npcs: [] }),
        playerCard: async () => CARD,
        savePlayerCardToLibrary: async () => ({ name: 'Robin Vale' }),
        removePlayerCard: async () => undefined,
        portrait: (name) => (name === 'Elara' ? '/elara.png' : ''),
        modal,
        panels: { playerCard: { root: playerRoot, edit: () => { edits.push('edit') } }, manager: [library], npcSettings: npcBox, locationSettings: locBox, mapsGuide: guide },
        when: (iso) => `at ${iso}`,
        ...over,
    })

    it('draws the Player Character first — the portrait, the synopsis from the bio, the badge, Full PC Card, the bookmark, ✎ and the unlink — and the NPCs as cards with their bars and tiers', async () => {
        shown.length = 0
        const { fold, root, calls, openIt, openFolder, folder } = mount({ cards: true, extra: extra() })
        fold.setChat('c1')
        await openIt()
        expect(calls).toEqual([['list']])
        const pc = root.querySelector('[data-lh-field="records-pc"]') as HTMLElement
        expect(pc).not.toBeNull()
        expect(pc.previousElementSibling).toBeNull()
        expect(pc.querySelector('.lh-npc-name')!.textContent).toBe('Robin Vale')
        expect(pc.querySelector('.lh-npc-desc')!.textContent).toBe('Human — Lean and quick.')
        expect(pc.querySelector('.lh-npc-badge')!.textContent).toBe('👤 Player Character')
        expect(Array.from(pc.querySelectorAll('.lh-npc-action')).map((b) => b.getAttribute('data-lh-field'))).toEqual(['records-pc-view', 'records-pc-bookmark', 'records-pc-edit', 'records-pc-unlink'])
        // Full PC Card opens the Player Card fold in the modal, opened; ✎ does the same and starts the editor.
        ;(pc.querySelector('[data-lh-field="records-pc-view"]') as HTMLElement).click()
        expect(shown.at(-1)!.title).toBe('Robin Vale — Player Card')
        expect(shown.at(-1)!.nodes).toEqual([playerRoot])
        expect(playerRoot.open).toBe(true)
        ;(pc.querySelector('[data-lh-field="records-pc-edit"]') as HTMLElement).click()
        expect(edits).toEqual(['edit'])
        // The bookmark saves the Player Card to the library; the unlink asks, then removes it and reads again.
        ;(pc.querySelector('[data-lh-field="records-pc-bookmark"]') as HTMLElement).click()
        await settle()
        expect(root.querySelector('[data-lh-field="records-note"]')!.textContent).toBe('Saved “Robin Vale” to the NPC library.')
        ;(pc.querySelector('[data-lh-field="records-pc-unlink"]') as HTMLElement).click()
        await settle()
        expect(calls.find((c) => c[0] === 'confirm' && c[1] === 'Unlink the Player Character')).toBeTruthy()
        expect(calls.filter((c) => c[0] === 'list')).toHaveLength(2)
        // The NPCs folder: Multihog's name and count, the manager and the gear; the Locations folder: the guide, the add, the gear.
        const npcs = folder('Vell_NPC')
        expect(Array.from(npcs.querySelectorAll('.lh-records-folder-head button')).map((b) => b.getAttribute('data-lh-field'))).toEqual(['records-manager', 'records-npc-settings'])
        expect(Array.from(folder('Vell_LOC').querySelectorAll('.lh-records-folder-head button')).map((b) => b.getAttribute('data-lh-field'))).toEqual(['records-maps-guide', 'records-add-mapped', 'records-location-settings'])
        ;(npcs.querySelector('[data-lh-field="records-manager"]') as HTMLElement).click()
        expect(shown.at(-1)!.title).toBe('📚 NPC/PC Manager')
        expect(shown.at(-1)!.nodes).toEqual([library])
        expect(library.open).toBe(true)
        ;(npcs.querySelector('[data-lh-field="records-npc-settings"]') as HTMLElement).click()
        expect(shown.at(-1)!.nodes).toEqual([npcBox])
        ;(folder('Vell_LOC').querySelector('[data-lh-field="records-location-settings"]') as HTMLElement).click()
        expect(shown.at(-1)!.nodes).toEqual([locBox])
        ;(folder('Vell_LOC').querySelector('[data-lh-field="records-maps-guide"]') as HTMLElement).click()
        expect(shown.at(-1)!.nodes).toEqual([guide])
        // The cards: the portrait or its placeholder, the synopsis, the badge, the bars from the centre, the tiers, the six buttons.
        openFolder('Vell_NPC')
        const cards = Array.from(npcs.querySelectorAll('.lh-npc-card')) as HTMLElement[]
        expect(cards.map((c) => c.getAttribute('data-lh-entry'))).toEqual(['n1', 'n2'])
        expect(cards[0]!.querySelector('.lh-npc-portrait img')!.getAttribute('src')).toBe('/elara.png')
        expect(cards[1]!.querySelector('.lh-npc-portrait')!.classList.contains('lh-npc-portrait--empty')).toBe(true)
        expect(cards[0]!.querySelector('.lh-npc-name-text')!.textContent).toBe('Elara')
        // The legacy's own synopsis of the CORE, whatever it makes of the fields' order.
        expect(cards[0]!.querySelector('.lh-npc-desc')!.textContent).toBe(synopsis(ELARA.content))
        expect(cards[0]!.querySelector('[data-lh-field="records-status"]')!.textContent).toBe('● Active')
        expect(cards[1]!.querySelector('[data-lh-field="records-status"]')!.textContent).toBe('📌 Pinned')
        expect(Array.from(cards[0]!.querySelectorAll('.lh-npc-bar-value')).map((v) => v.textContent)).toEqual(['+40', '-5'])
        const fills = Array.from(cards[0]!.querySelectorAll('.lh-npc-bar-fill')) as HTMLElement[]
        expect(fills[0]!.classList.contains('lh-npc-bar-fill--up')).toBe(true)
        expect(parseFloat(fills[0]!.style.width)).toBeCloseTo((40 / 150) * 50, 3)
        expect(fills[1]!.classList.contains('lh-npc-bar-fill--down')).toBe(true)
        // An NPC with no standing draws the bars at zero, as Multihog's do.
        expect(Array.from(cards[1]!.querySelectorAll('.lh-npc-bar-value')).map((v) => v.textContent)).toEqual(['+0', '+0'])
        expect(cards[0]!.querySelectorAll('.lh-npc-tier')).toHaveLength(2)
        expect(Array.from(cards[0]!.querySelectorAll('.lh-npc-action')).map((b) => b.getAttribute('data-lh-field'))).toEqual(['records-view', 'records-bookmark', 'records-pin', 'records-edit', 'records-clean', 'records-delete'])
        // A click on the card opens the entry inline; on a button it does not.
        cards[0]!.click()
        expect(root.querySelector('.lh-npc-card[data-lh-entry="n1"] .lh-records-entry')).not.toBeNull()
        expect(root.querySelector('.lh-npc-card[data-lh-entry="n1"]')!.classList.contains('lh-npc-card--open')).toBe(true)
    })

    it('opens the Full NPC Card in the modal — the sections, the sliders that set a value, the history, Forget — and keeps it current as the books are read again', async () => {
        shown.length = 0
        const { fold, root, calls, openIt, openFolder, note } = mount({ cards: true, extra: extra() })
        fold.setChat('c1')
        await openIt()
        openFolder('Vell_NPC')
        ;(root.querySelector('.lh-npc-card[data-lh-entry="n1"] [data-lh-field="records-view"]') as HTMLElement).click()
        expect(shown.at(-1)!.title).toBe('Elara — Full NPC Card')
        const full = shown.at(-1)!.nodes[0]!
        expect(full.querySelector('.lh-npc-full-name')!.textContent).toBe('Elara')
        expect(full.querySelector('.lh-npc-full-portrait img')!.getAttribute('src')).toBe('/elara.png')
        expect(Array.from(full.querySelectorAll('.lh-records-core dt')).map((d) => d.textContent)).toEqual(['Species', 'Role', 'Body'])
        expect(full.querySelector('.lh-records-keys')!.textContent).toBe('Keys: Elara, innkeeper')
        expect(full.querySelectorAll('.lh-npc-full-axis')).toHaveLength(2)
        expect(full.querySelectorAll('.lh-npc-full-log tr')).toHaveLength(1)
        expect(full.querySelector('.lh-npc-full-log td')!.textContent).toBe('at t')
        // The slider paints as it moves and sets the value as it settles.
        const slider = full.querySelector('input[aria-label="Elara’s friendship slider"]') as HTMLInputElement
        const number = full.querySelector('input[aria-label="Elara’s friendship"]') as HTMLInputElement
        slider.value = '-30'
        slider.dispatchEvent(new Event('input'))
        expect(number.value).toBe('-30')
        expect((full.querySelector('.lh-npc-full-axis--friendship .lh-npc-bar-fill') as HTMLElement).classList.contains('lh-npc-bar-fill--down')).toBe(true)
        slider.dispatchEvent(new Event('change'))
        await settle()
        expect(note()).toBe('Elara’s friendship is set to -30.')
        // The value typed sets it too; a value out of range is clamped first.
        number.value = '900'
        number.dispatchEvent(new Event('change'))
        await settle()
        expect(note()).toBe('Elara’s friendship is set to +150.')
        // Edit text turns the sections into the form, in the modal; Save to Library bookmarks.
        ;(full.querySelector('[data-lh-field="records-full-edit"]') as HTMLElement).click()
        expect(full.querySelector('[data-lh-field="records-edit"]')).not.toBeNull()
        ;(full.querySelector('[data-lh-field="records-full-library"]') as HTMLElement).click()
        await settle()
        expect(calls.find((c) => c[0] === 'library')).toEqual(['library', 'n1', false])
        // Forget asks, then forgets the standing: the bars sit at zero and the history is empty.
        ;(full.querySelector('[data-lh-field="records-full-forget"]') as HTMLElement).click()
        await settle()
        expect(calls.find((c) => c[0] === 'confirm' && c[1] === 'Forget the standing')).toBeTruthy()
        expect(note()).toBe('Elara’s standing is forgotten.')
        expect(full.querySelector('[data-lh-field="records-full-forget"]')).toBeNull()
        expect(full.querySelector('.lh-npc-full-log .lh-records-empty')!.textContent).toContain('No standing yet')
        // The modal closes with the chat.
        fold.setChat('c2')
        expect(shown.at(-1)!.nodes[0]).toBe(full)
    })

    it('rewrites an entry with AI from the Full NPC Card (78c): the pane over the sections, the legacy’s refusal of blank instructions, the revised text for review, Regenerate, Cancel and Apply through update', async () => {
        shown.length = 0
        const asked: Array<[string, string]> = []
        let reply = '[CORE]\nSpecies: Elf\n[/CORE]'
        const { fold, root, calls, openIt, openFolder, note } = mount({ cards: true, extra: extra({ aiEdit: async (content, instructions) => { asked.push([content, instructions]); return { text: reply } } }) })
        fold.setChat('c1')
        await openIt()
        openFolder('Vell_NPC')
        ;(root.querySelector('.lh-npc-card[data-lh-entry="n1"] [data-lh-field="records-view"]') as HTMLElement).click()
        const full = shown.at(-1)!.nodes[0]!
        const field = <T extends HTMLElement>(name: string) => full.querySelector(`[data-lh-field="${name}"]`) as T
        expect(Array.from(full.querySelectorAll('.lh-npc-full-buttons button')).map((b) => b.textContent)).toEqual(['✏️ Edit text', '✨ Edit with AI', '📚 Save to Library'])
        expect(field<HTMLElement>('records-full-ai-pane').hidden).toBe(true)
        field<HTMLElement>('records-full-ai').click()
        expect(field<HTMLElement>('records-full-ai-pane').hidden).toBe(false)
        expect(field<HTMLElement>('records-full-sections').hidden).toBe(true)
        expect(field<HTMLElement>('records-full-bars').hidden).toBe(true)
        expect(field<HTMLElement>('records-full-log').hidden).toBe(true)
        // Blank instructions: the legacy's words, no call.
        field<HTMLElement>('records-full-ai-generate').click()
        await settle()
        expect(note()).toBe('Please describe what you want changed.')
        expect(asked).toEqual([])
        field<HTMLTextAreaElement>('records-full-ai-instructions').value = ' make her an elf '
        field<HTMLElement>('records-full-ai-generate').click()
        expect(field<HTMLButtonElement>('records-full-ai-generate').textContent).toBe('⏳ Generating…')
        await settle()
        expect(asked).toEqual([[ELARA.content, 'make her an elf']])
        expect(field<HTMLTextAreaElement>('records-full-ai-preview').value).toBe(reply)
        expect(field<HTMLButtonElement>('records-full-ai-generate').textContent).toBe('✨ Generate')
        expect(note()).toContain('The revised entry is below')
        // A re-read of the books while the pane is open keeps it open.
        await fold.load()
        expect(field<HTMLElement>('records-full-ai-pane').hidden).toBe(false)
        expect(field<HTMLElement>('records-full-sections').hidden).toBe(true)
        // Regenerate asks again; Cancel puts the sections back with nothing written.
        reply = '[CORE]\nSpecies: Half-elf\n[/CORE]'
        field<HTMLElement>('records-full-ai-regen').click()
        await settle()
        expect(asked).toHaveLength(2)
        expect(field<HTMLTextAreaElement>('records-full-ai-preview').value).toBe(reply)
        field<HTMLElement>('records-full-ai-cancel').click()
        expect(field<HTMLElement>('records-full-ai-pane').hidden).toBe(true)
        expect(field<HTMLElement>('records-full-sections').hidden).toBe(false)
        expect(field<HTMLElement>('records-full-bars').hidden).toBe(false)
        expect(calls.find((c) => c[0] === 'update')).toBeUndefined()
        // Apply writes what the box holds, the title and the keys kept.
        field<HTMLElement>('records-full-ai').click()
        field<HTMLTextAreaElement>('records-full-ai-instructions').value = 'older'
        field<HTMLElement>('records-full-ai-generate').click()
        await settle()
        field<HTMLTextAreaElement>('records-full-ai-preview').value = '[CORE]\nSpecies: Elf, old\n[/CORE]'
        field<HTMLElement>('records-full-ai-apply').click()
        await settle()
        expect(calls.find((c) => c[0] === 'update')).toEqual(['update', { entryId: 'n1', title: 'Elara', keys: ['Elara', 'innkeeper'], content: '[CORE]\nSpecies: Elf, old\n[/CORE]' }])
        expect(note()).toBe('Applied the AI edit to “Elara”.')
        expect(field<HTMLElement>('records-full-ai-pane').hidden).toBe(true)
        // A failed call says so in red and keeps the pane; without the hook there is no button.
        const failing = mount({ cards: true, extra: extra({ aiEdit: async () => { throw new Error('AI returned an empty result. Please try again.') } }) })
        failing.fold.setChat('c1')
        await failing.openIt()
        failing.openFolder('Vell_NPC')
        ;(failing.root.querySelector('.lh-npc-card[data-lh-entry="n1"] [data-lh-field="records-view"]') as HTMLElement).click()
        const f2 = shown.at(-1)!.nodes[0]!
        ;(f2.querySelector('[data-lh-field="records-full-ai"]') as HTMLElement).click()
        ;(f2.querySelector('[data-lh-field="records-full-ai-instructions"]') as HTMLTextAreaElement).value = 'x'
        ;(f2.querySelector('[data-lh-field="records-full-ai-generate"]') as HTMLElement).click()
        await settle()
        expect(failing.note()).toBe('AI returned an empty result. Please try again.')
        expect((f2.querySelector('[data-lh-field="records-full-ai-pane"]') as HTMLElement).hidden).toBe(false)
        const plain = mount({ cards: true, extra: extra() })
        plain.fold.setChat('c1')
        await plain.openIt()
        plain.openFolder('Vell_NPC')
        ;(plain.root.querySelector('.lh-npc-card[data-lh-entry="n1"] [data-lh-field="records-view"]') as HTMLElement).click()
        expect(shown.at(-1)!.nodes[0]!.querySelector('[data-lh-field="records-full-ai"]')).toBeNull()
    })

    it('hides the AI pane and its review box by rule, since their display: flex would beat the hidden attribute (78c-bis, lesson 60)', () => {
        expect(RECORDS_FOLD_CSS).toContain('.adventuretime-panel .lh-npc-full-ai[hidden], .adventuretime-panel .lh-npc-full-ai-review[hidden] { display: none; }')
    })

    it('falls back without a modal: Full NPC Card opens the entry inline, the doors are not offered, and the Player Card is drawn without them', async () => {
        const { fold, root, openIt, openFolder, folder } = mount({ cards: true, extra: extra({ modal: undefined, panels: undefined }) })
        fold.setChat('c1')
        await openIt()
        const pc = root.querySelector('[data-lh-field="records-pc"]') as HTMLElement
        expect(Array.from(pc.querySelectorAll('.lh-npc-action')).map((b) => b.getAttribute('data-lh-field'))).toEqual(['records-pc-bookmark', 'records-pc-unlink'])
        expect(Array.from(folder('Vell_NPC').querySelectorAll('.lh-records-folder-head button'))).toHaveLength(0)
        expect(Array.from(folder('Vell_LOC').querySelectorAll('.lh-records-folder-head button')).map((b) => b.getAttribute('data-lh-field'))).toEqual(['records-add-mapped'])
        openFolder('Vell_NPC')
        ;(root.querySelector('.lh-npc-card[data-lh-entry="n1"] [data-lh-field="records-view"]') as HTMLElement).click()
        expect(root.querySelector('.lh-npc-card[data-lh-entry="n1"] .lh-records-entry')).not.toBeNull()
    })

    it('draws the compact rows with the portraits switch off, bars nowhere while the relationship system is off, and no Player Character without a reader', async () => {
        const { fold, root, openIt, openFolder } = mount({ cards: false, extra: extra({ relations: async () => ({ ...RELATIONS, enabled: false }), playerCard: undefined }) })
        fold.setChat('c1')
        await openIt()
        expect(root.querySelector('[data-lh-field="records-pc"]')).toBeNull()
        openFolder('Vell_NPC')
        expect(root.querySelector('.lh-npc-card')).toBeNull()
        expect(root.querySelector('[data-lh-entry="n1"].lh-records-row')).not.toBeNull()
        const withCards = mount({ cards: true, extra: extra({ relations: async () => ({ ...RELATIONS, enabled: false }) }) })
        withCards.fold.setChat('c1')
        await withCards.openIt()
        withCards.openFolder('Vell_NPC')
        expect(withCards.root.querySelector('.lh-npc-card')).not.toBeNull()
        expect(withCards.root.querySelector('.lh-npc-bars')).toBeNull()
    })
})

describe('the pictures’ buttons, Clear Log and the location images (80, departure 137)', () => {
    const STANDING = { at: 't', enabled: true, mode: 'state_tracker' as const, max: 150, updatedAt: 't', npcs: [{ id: 'Vell_NPC::1', label: 'Elara', friendship: 40, affection: -5, friendshipTier: { label: 'x', hint: 'x' }, affectionTier: { label: 'x', hint: 'x' }, log: [{ at: 't', field: 'friendship' as const, delta: 40, applied: 40, newValue: 40, source: 'tracker' as const }] }] }
    const shown: Array<{ title: string; nodes: HTMLElement[] }> = []
    const modal: NonNullable<RecordsFoldHost['modal']> = (options) => { shown.push({ title: options.title, nodes: options.nodes }); return { open: true, close: () => undefined } }
    const opened: Array<[string, string, unknown]> = []
    const portraitActions = (name: string) => ({ kind: 'portrait' as const, set: async () => undefined, draw: async () => undefined, ...(name === 'Elara' ? { remove: async () => undefined } : {}) })
    const locationActions = (path: string) => ({ kind: 'picture' as const, set: async () => undefined, draw: async () => undefined, ...(path === 'Abbey Undercroft' ? { remove: async () => undefined } : {}) })
    const extra = (over: Partial<RecordsFoldHost> = {}): Partial<RecordsFoldHost> => ({
        relations: async () => STANDING,
        setRelation: async () => STANDING,
        forgetRelation: async () => ({ ...STANDING, npcs: [] }),
        clearRelationLog: async () => ({ ...STANDING, npcs: STANDING.npcs.map((n) => ({ ...n, log: [] })) }),
        portrait: (name) => (name === 'Elara' ? '/elara.png' : ''),
        enlarge: (src, name, actions) => { opened.push([src, name, actions]) },
        portraitActions,
        modal,
        when: (iso) => `at ${iso}`,
        ...over,
    })

    it('opens a card’s portrait large with the portrait’s buttons, and an empty box the same with the ways to get one', async () => {
        opened.length = 0
        const { fold, root, openIt, openFolder } = mount({ cards: true, extra: extra() })
        fold.setChat('c1')
        await openIt()
        openFolder('Vell_NPC')
        const elara = root.querySelector('.lh-npc-card[data-lh-entry="n1"] .lh-npc-portrait img') as HTMLImageElement
        expect(elara.getAttribute('data-lh-large')).toBe('Elara')
        expect(elara.title).toBe('Elara — click to see it large, or to change it')
        elara.click()
        expect(opened.at(-1)).toEqual(['/elara.png', 'Elara', { kind: 'portrait', set: expect.any(Function), draw: expect.any(Function), remove: expect.any(Function) }])
        // The card is still closed: the click was the picture's.
        expect(root.querySelector('.lh-npc-card[data-lh-entry="n1"]')!.classList.contains('lh-npc-card--open')).toBe(false)
        const brin = root.querySelector('.lh-npc-card[data-lh-entry="n2"] .lh-npc-portrait') as HTMLElement
        expect(brin.classList.contains('lh-npc-portrait--empty')).toBe(true)
        expect(brin.getAttribute('data-lh-large')).toBe('Brin')
        brin.click()
        expect(opened.at(-1)).toEqual(['', 'Brin', { kind: 'portrait', set: expect.any(Function), draw: expect.any(Function) }])
        expect(root.querySelector('.lh-npc-card[data-lh-entry="n2"]')!.classList.contains('lh-npc-card--open')).toBe(false)
        // The Full card's large portrait carries the same.
        ;(root.querySelector('.lh-npc-card[data-lh-entry="n1"] [data-lh-field="records-view"]') as HTMLElement).click()
        const full = shown.at(-1)!.nodes[0]!
        ;(full.querySelector('.lh-npc-full-portrait img') as HTMLElement).click()
        expect(opened.at(-1)![1]).toBe('Elara')
        expect((opened.at(-1)![2] as { kind: string }).kind).toBe('portrait')
        // Without the actions the box stays the plain opener's, and an empty box opens nothing.
        opened.length = 0
        const plain = mount({ cards: true, extra: extra({ portraitActions: undefined }) })
        plain.fold.setChat('c1')
        await plain.openIt()
        plain.openFolder('Vell_NPC')
        ;(plain.root.querySelector('.lh-npc-card[data-lh-entry="n1"] .lh-npc-portrait img') as HTMLElement).click()
        expect(opened).toEqual([['/elara.png', 'Elara', undefined]])
        const emptyBox = plain.root.querySelector('.lh-npc-card[data-lh-entry="n2"] .lh-npc-portrait') as HTMLElement
        expect(emptyBox.hasAttribute('data-lh-large')).toBe(false)
    })

    it('clears the relationship history alone with Multihog’s Clear Log, in its words, and keeps Forget the standing beside it', async () => {
        const { fold, root, calls, openIt, openFolder, note } = mount({ cards: true, extra: extra() })
        fold.setChat('c1')
        await openIt()
        openFolder('Vell_NPC')
        ;(root.querySelector('.lh-npc-card[data-lh-entry="n1"] [data-lh-field="records-view"]') as HTMLElement).click()
        const full = shown.at(-1)!.nodes[0]!
        const clear = full.querySelector('[data-lh-field="records-full-clear-log"]') as HTMLButtonElement
        expect(clear.textContent).toBe('🗑️ Clear Log')
        expect(clear.title).toBe('Clear relationship history')
        expect(clear.nextElementSibling!.getAttribute('data-lh-field')).toBe('records-full-forget')
        expect(full.querySelectorAll('.lh-npc-full-log tr')).toHaveLength(1)
        clear.click()
        await settle()
        expect(calls.find((c) => c[0] === 'confirm')).toEqual(['confirm', 'Clear Log', 'Clear Log'])
        expect(note()).toBe('Elara’s relationship history is cleared; the values stand.')
        expect(full.querySelectorAll('.lh-npc-full-log tr')).toHaveLength(0)
        expect(full.querySelector('.lh-npc-full-log .lh-records-empty')!.textContent).toBe('No change recorded yet.')
        // The values stand, and with no history there is no log to clear; Forget is still offered.
        expect((full.querySelector('input[aria-label="Elara’s friendship"]') as HTMLInputElement).value).toBe('40')
        expect(full.querySelector('[data-lh-field="records-full-clear-log"]')).toBeNull()
        expect(full.querySelector('[data-lh-field="records-full-forget"]')).not.toBeNull()
        // A refused confirm clears nothing.
        const refused = mount({ cards: true, confirmed: false, extra: extra() })
        refused.fold.setChat('c1')
        await refused.openIt()
        refused.openFolder('Vell_NPC')
        ;(refused.root.querySelector('.lh-npc-card[data-lh-entry="n1"] [data-lh-field="records-view"]') as HTMLElement).click()
        const kept = shown.at(-1)!.nodes[0]!
        ;(kept.querySelector('[data-lh-field="records-full-clear-log"]') as HTMLElement).click()
        await settle()
        expect(kept.querySelectorAll('.lh-npc-full-log tr')).toHaveLength(1)
        // Without the op there is no button.
        const none = mount({ cards: true, extra: extra({ clearRelationLog: undefined }) })
        none.fold.setChat('c1')
        await none.openIt()
        none.openFolder('Vell_NPC')
        ;(none.root.querySelector('.lh-npc-card[data-lh-entry="n1"] [data-lh-field="records-view"]') as HTMLElement).click()
        expect(shown.at(-1)!.nodes[0]!.querySelector('[data-lh-field="records-full-clear-log"]')).toBeNull()
    })

    it('carries each location’s picture on its row while Show Location Images is on — the thumbnail or the empty box, opening large with the place’s buttons — and the plain rows otherwise; redraw follows the switch', async () => {
        opened.length = 0
        let images = true
        const { fold, root, openIt, openFolder, row } = mount({ extra: extra({ locationImages: () => images, locationImage: (path) => (path === 'Abbey Undercroft' ? '/abbey.png' : ''), locationActions }) })
        fold.setChat('c1')
        await openIt()
        openFolder('Vell_LOC')
        const abbey = row('l1').querySelector('[data-lh-field="records-loc-thumb"]') as HTMLImageElement
        expect(abbey.tagName).toBe('IMG')
        expect(abbey.getAttribute('src')).toBe('/abbey.png')
        expect(abbey.getAttribute('data-lh-large')).toBe('Abbey Undercroft')
        expect(abbey.title).toBe('Manage location image')
        expect(row('l1').firstElementChild).toBe(abbey)
        abbey.click()
        expect(opened.at(-1)).toEqual(['/abbey.png', 'Abbey Undercroft', { kind: 'picture', set: expect.any(Function), draw: expect.any(Function), remove: expect.any(Function) }])
        // The click was the picture's: the entry did not open.
        expect(root.querySelector('[data-lh-entry="l1"] + .lh-records-body')).toBeNull()
        // A child's path is its whole title; an entry with no picture is the empty box, opening with the ways to get one.
        const landing = row('l2').querySelector('[data-lh-field="records-loc-thumb"]') as HTMLElement
        expect(landing.tagName).toBe('SPAN')
        expect(landing.textContent).toBe('🗺️')
        expect(landing.title).toBe('Set location image')
        landing.click()
        expect(opened.at(-1)).toEqual(['', 'Abbey Undercroft :: Cellar Landing', { kind: 'picture', set: expect.any(Function), draw: expect.any(Function) }])
        // The NPC rows and the World carry none.
        openFolder('Vell_NPC')
        expect(row('n1').querySelector('[data-lh-field="records-loc-thumb"]')).toBeNull()
        // Off: the plain rows, on a redraw.
        images = false
        fold.redraw()
        expect(root.querySelector('[data-lh-field="records-loc-thumb"]')).toBeNull()
        images = true
        fold.redraw()
        expect(root.querySelectorAll('[data-lh-field="records-loc-thumb"]')).toHaveLength(4)
        // Without the opener the thumbnails are drawn and not clickable.
        const plain = mount({ extra: extra({ enlarge: undefined, locationImages: () => true, locationImage: () => '/x.png', locationActions }) })
        plain.fold.setChat('c1')
        await plain.openIt()
        plain.openFolder('Vell_LOC')
        expect(plain.row('l1').querySelector('[data-lh-field="records-loc-thumb"]')!.hasAttribute('data-lh-large')).toBe(false)
        // A redraw before any read draws nothing.
        const unread = mount({ extra: extra() })
        unread.fold.redraw()
        expect(unread.root.querySelector('.lh-records-folder')).toBeNull()
        expect(RECORDS_FOLD_CSS).toContain('.lh-records-loc-thumb {')
    })
})

describe('the stock folders on a blank chat (83)', () => {
    const BLANK: CampaignRecordsResult = { prefix: 'Vell', books: [], mapping: true, mapped: [], allBooks: [] }
    const modal: NonNullable<RecordsFoldHost['modal']> = () => ({ open: true, close: () => undefined })
    const library = el('details', { class: 'lh-library' }) as HTMLDetailsElement
    const guide = el('details', { class: 'lh-maps-guide' }) as HTMLDetailsElement
    const npcBox = el('div')
    const locBox = el('div')
    const panels = { manager: [library], npcSettings: npcBox, locationSettings: locBox, mapsGuide: guide }

    it('puts NPCs and Locations first whatever the campaign holds, under the names the books will take, and leaves an unnamed campaign alone', () => {
        expect(withStockFolders(BLANK).map((b) => [b.name, b.kind, b.id, b.entries.length, b.tokens])).toEqual([['Vell_NPC', 'npc', '', 0, 0], ['Vell_LOC', 'location', '', 0, 0]])
        // The real books keep their order after the two; a made one is itself, not a twin.
        const world = RESULT.books[2]!
        expect(withStockFolders({ ...BLANK, books: [world] }).map((b) => b.name)).toEqual(['Vell_NPC', 'Vell_LOC', 'Vell_World'])
        expect(withStockFolders({ ...BLANK, books: [world, RESULT.books[0]!] }).map((b) => b.name)).toEqual(['Vell_NPC', 'Vell_LOC', 'Vell_World'])
        expect(withStockFolders({ ...BLANK, books: [world, RESULT.books[0]!] })[0]).toBe(RESULT.books[0])
        expect(withStockFolders({ ...BLANK, prefix: '' })).toEqual([])
    })

    it('draws the two folders with their buttons on a chat with no book, 0/0 (0t), marked as not made, and + Add Mapped Location opens the map form on the Locations folder', async () => {
        const { root, openIt, fold, folder } = mount({ result: BLANK, extra: { modal, panels } })
        fold.setChat('c1')
        await openIt()
        expect(Array.from(root.querySelectorAll('.lh-records-folder')).map((f) => f.getAttribute('data-lh-book'))).toEqual(['Vell_NPC', 'Vell_LOC'])
        expect(folder('Vell_NPC').classList.contains('lh-records-folder--virtual')).toBe(true)
        expect(folder('Vell_NPC').querySelector('.lh-records-folder-name')!.textContent).toBe('NPCs')
        expect(folder('Vell_NPC').querySelector('.lh-records-folder-count')!.textContent).toBe('0/0 (0t)')
        expect((folder('Vell_NPC').querySelector('.lh-records-folder-head') as HTMLElement).title).toContain('not made yet')
        expect(folder('Vell_NPC').querySelector('[data-lh-field="records-manager"]')).not.toBeNull()
        expect(folder('Vell_NPC').querySelector('[data-lh-field="records-npc-settings"]')).not.toBeNull()
        expect(folder('Vell_LOC').querySelector('.lh-records-folder-name')!.textContent).toBe('Locations')
        expect(folder('Vell_LOC').querySelector('[data-lh-field="records-maps-guide"]')).not.toBeNull()
        expect(folder('Vell_LOC').querySelector('[data-lh-field="records-location-settings"]')).not.toBeNull()
        expect(root.querySelector('.lh-records-folders > .lh-records-empty')!.textContent).toBe('This campaign has no books yet; the agent makes them as it records.')
        ;(folder('Vell_LOC').querySelector('[data-lh-field="records-add-mapped"]') as HTMLButtonElement).click()
        expect(folder('Vell_LOC').querySelector('[data-lh-field="records-mapform"]')).not.toBeNull()
        expect((folder('Vell_LOC').querySelector('.lh-records-folder-body') as HTMLElement).hidden).toBe(false)
        expect(folder('Vell_LOC').querySelector('.lh-records-folder-body .lh-records-empty')!.textContent).toBe('No entries yet; the book is made with the first.')
        // A made book draws as itself, unmarked.
        const made = mount({ extra: { modal, panels } })
        made.fold.setChat('c1')
        await made.openIt()
        expect(made.folder('Vell_NPC').classList.contains('lh-records-folder--virtual')).toBe(false)
        expect(made.root.querySelector('.lh-records-folders > .lh-records-empty')).toBeNull()
        expect(RECORDS_FOLD_CSS).toContain('.lh-records-folder--virtual')
    })
})
