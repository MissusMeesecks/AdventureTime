/**
 * The NPC library's fold (Phase 41).
 *
 * The legacy's NPC/PC Manager, its Library tab: the identity cards kept
 * outside any chat, each with its blurb and portrait; **Full card** opens the
 * text to edit, with the card's photo beside it (Phase 60, roadmap row 60):
 * **Set photo** from a file, **Draw the photo** through the host's image
 * generation in 2:3, **Remove photo**; a photo set or drawn while the open
 * chat names the card is placed on that entity too; **Add to Party** seats the card in `[PARTY]` through the
 * tracker; **Add to world** (Phase 53, roadmap row 53) writes it into the
 * campaign's NPC book as is, as the NPC creator does; **Play as PC** makes
 * it the player; **Export** writes one `.mnpc.json` with the portrait inside;
 * **Remove** asks first. A tick on each card picks it, and the bar over the
 * list adds every picked card to the party or the world, one after another.
 * Cards come in from **Save from this campaign** (the campaign's NPC entries
 * and the chat's Player Card, each with a Save button) and **Import a
 * package**.
 */

import type { LibraryActionResult, LibraryPhotoResult, LibraryRecordView, LibrarySources, NpcAddResult } from '../protocol.js'
import { describeNpcAdd } from './npc-creator-fold.js'
import { zoomable, type Enlarge, type PictureActions } from './enlarge.js'
import { describeCardSteps, reasonText } from './player-card-fold.js'

export interface LibraryFoldHost {
    el(tag: string, attrs?: Record<string, string>): HTMLElement
    list(): Promise<{ records: LibraryRecordView[] }>
    sources(): Promise<LibrarySources>
    saveEntry(request: { entryId: string; overwrite: boolean }): Promise<LibraryRecordView | { status: 'exists'; name: string }>
    savePlayerCard(request: { overwrite: boolean }): Promise<LibraryRecordView | { status: 'exists'; name: string }>
    update(request: { id: string; name: string; content: string; keys: string[]; notes: string }): Promise<LibraryRecordView>
    remove(id: string): Promise<void>
    importText(text: string): Promise<{ records: LibraryRecordView[] }>
    exportCard(id: string, portraitDataUrl: string): Promise<{ filename: string; file: string; withPortrait: boolean }>
    party(id: string): Promise<LibraryActionResult>
    /** The card into the campaign's NPC book as is (53): the NPC creator's add on a library record. */
    world(id: string): Promise<NpcAddResult>
    playAsPc(id: string): Promise<LibraryActionResult>
    /** A file picked by the user, as text; `null` when none was. */
    pickText(): Promise<string | null>
    /** An image picked by the user, as a data URL with its name; `null` when none was. Absent, the photo cannot be set from a file. */
    pickImage?(): Promise<{ dataUrl: string; filename: string } | null>
    /** The card's photo from a file (60); `place` says the open chat names the card, so the photo lands on that entity too. */
    setPhoto(request: { id: string; dataUrl: string; filename: string; place: boolean }): Promise<LibraryPhotoResult>
    /** The card's photo drawn (60), through the host's image generation. Absent, the button is not offered. */
    /** Draw the photo (60); `null` when the prompt editor was cancelled (73f). */
    drawPhoto?(request: { id: string; place: boolean }): Promise<LibraryPhotoResult | null>
    removePhoto(id: string): Promise<LibraryPhotoResult>
    /** Whether the open chat's memo names an entity of this name (60): the photo is then placed on it too. Absent, never. */
    inPlay?(name: string): boolean
    /** A portrait's reference read as a data URL for a package; `''` when it cannot be. */
    portraitData(src: string): Promise<string>
    /** A picture large (Phase 64), in the host's modal; absent, the pictures stay small. */
    enlarge?: Enlarge
    download(filename: string, text: string): void
    fail(error: unknown): void
    when(iso: string): string
    /** Ask before replacing or removing a card; absent, it is done. */
    confirm?(message: string): Promise<boolean>
}

export interface LibraryFold {
    root: HTMLDetailsElement
    /** The foot of the fold, for what belongs with the library but is not a card: the portraits in play (60). */
    tail: HTMLElement
    setChat(chatId: string | null): void
    /** Read the library again: after a card was saved from elsewhere. */
    refresh(): Promise<void>
    busy(): boolean
}

/** What a photo op did (60), for the note. */
export function describePhoto(what: 'set' | 'drawn' | 'removed', result: LibraryPhotoResult): string {
    const name = result.record.name
    if (what === 'removed') return `The photo of “${name}” is removed. A chat that shows it keeps it.`
    const placed = result.placed ? ' It is placed in this chat too.' : ''
    if (what === 'set') return `The photo of “${name}” is set.${placed}`
    const size = result.size ? `, ${result.size}` : result.sizeNote ? ` at the connection’s own size (${result.sizeNote})` : ''
    return `The photo of “${name}” is drawn by ${result.provider ?? 'the host'}${result.model ? ` (${result.model})` : ''}${size}.${placed} The prompt is under the card’s editor.`
}

export function describeLibraryAction(result: LibraryActionResult, when: (iso: string) => string): string {
    const stamped = result.at ? when(result.at) : ''
    const tail = stamped ? ` Ran ${stamped}.` : ''
    const blocks = [...(result.added ?? []), ...(result.replaced ?? [])]
    if (result.status === 'done') {
        const portrait = result.portrait ? ' Their portrait is placed.' : ''
        if (result.action === 'party') return `${result.name || 'The card'} joined the party${blocks.length ? `: ${blocks.join(', ')}` : ''}. The roster is in the tracker’s cards.${portrait}${tail}`
        const steps = describeCardSteps(result)
        return `${result.name || 'The card'} is the player now${blocks.length ? `: ${blocks.join(', ')}` : ''}. The sheet is in the tracker’s cards.${steps ? ` ${steps}` : ''}${portrait}${tail}`
    }
    const what = result.action === 'party' ? 'did not join the party' : 'did not become the player'
    return `${result.name || 'The card'} ${what}: ${reasonText(result.reason)}.${tail}`
}

/** One card's outcome in a batch (53). */
export interface BatchOutcome {
    name: string
    ok: boolean
    /** Why not, when not. */
    reason?: string
    /** The NPC book's name, for a world add. */
    book?: string
}

/** The note after a batch (53): who went in, and who did not with why. */
export function describeBatch(what: 'party' | 'world', outcomes: BatchOutcome[]): string {
    const went = outcomes.filter((o) => o.ok)
    const failed = outcomes.filter((o) => !o.ok)
    const parts: string[] = []
    if (went.length) {
        if (what === 'party') parts.push(`Joined the party: ${went.map((o) => o.name).join(', ')}. The roster is in the tracker’s cards.`)
        else {
            const book = went.find((o) => o.book)?.book || 'the NPC book'
            parts.push(`Added to ${book} as is: ${went.map((o) => o.name).join(', ')}. The agent reads them from here on.`)
        }
    }
    if (failed.length) parts.push(`${what === 'party' ? 'Did not join' : 'Not added'}: ${failed.map((o) => `${o.name} (${reasonText(o.reason)})`).join('; ')}.`)
    return parts.join(' ')
}

export const LIBRARY_FOLD_CSS = `
.lh-library-picked { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 0.8em; padding: 5px 7px; border: 1px solid var(--lh-accent, var(--lumiverse-primary, #d4a940)); border-radius: 5px; }
.lh-library-picked[hidden] { display: none; }
.lh-library-picked .lh-button { font-size: 0.75em; padding: 2px 7px; white-space: nowrap; }
.lh-library-pick { flex: 0 0 auto; margin: 0; }
.lh-library > summary { cursor: pointer; font-size: 0.85em; opacity: 0.8; }
.lh-library-body { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.lh-library-tools { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.lh-library-sources { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px; border: 1px dashed var(--lh-accent-dim, var(--lumiverse-border, rgba(255,255,255,0.18))); border-radius: 6px; }
.lh-library-source { display: flex; align-items: center; gap: 8px; font-size: 0.85em; }
.lh-library-source .lh-library-info { flex: 1; min-width: 0; }
.lh-library-list { display: flex; flex-direction: column; gap: 4px; }
.lh-library-card { display: flex; flex-direction: column; gap: 4px; padding: 5px 7px; border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(255,255,255,0.12))); border-radius: 5px; }
.lh-library-row { display: flex; align-items: center; gap: 8px; }
.lh-library-portrait { flex: 0 0 auto; width: 32px; height: 32px; border-radius: 50%; object-fit: cover; background: rgba(127,127,127,0.2); display: flex; align-items: center; justify-content: center; font-size: 1em; }
.lh-library-info { flex: 1; min-width: 0; }
.lh-library-name { font-size: 0.85em; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lh-library-blurb { font-size: 0.75em; opacity: 0.55; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lh-library-buttons { display: flex; gap: 4px; flex-wrap: wrap; }
.lh-library-buttons .lh-button { font-size: 0.75em; padding: 2px 7px; white-space: nowrap; }
.lh-library-editor { display: flex; flex-direction: column; gap: 4px; }
.lh-library-editor textarea { width: 100%; box-sizing: border-box; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.78em; line-height: 1.45; }
.lh-library-photo { display: flex; align-items: center; gap: 8px; }
.lh-library-photo-thumb { flex: 0 0 auto; width: 48px; height: 72px; border-radius: 4px; object-fit: cover; background: rgba(127,127,127,0.2); display: flex; align-items: center; justify-content: center; font-size: 1.4em; }
.lh-library-photo-buttons { display: flex; gap: 4px; flex-wrap: wrap; }
.lh-library-photo-buttons .lh-button { font-size: 0.75em; padding: 2px 7px; white-space: nowrap; }
.lh-library-prompt { font-size: 0.78em; white-space: pre-wrap; opacity: 0.8; max-height: 160px; overflow: auto; padding: 4px 6px; border: 1px dashed var(--lh-accent-dim, var(--lumiverse-border, rgba(255,255,255,0.18))); border-radius: 6px; }
.lh-library-tail:empty { display: none; }
.lh-library-empty { font-size: 0.8em; opacity: 0.6; padding: 4px 0; }
`

export function createLibraryFold(host: LibraryFoldHost): LibraryFold {
    const { el } = host

    const root = el('details', { class: 'lh-library' }) as HTMLDetailsElement
    const summary = el('summary')
    summary.textContent = 'NPC library'
    const body = el('div', { class: 'lh-library-body' })
    const lead = el('div', { class: 'lh-world-lead' })
    lead.textContent = 'Identity cards kept outside any chat: a campaign NPC’s or a Player Card’s [CORE] text, keywords and portrait, to use in another story. Add to Party seats a card through the tracker; Add to world writes it into this campaign’s NPC book as is; Play as PC makes it the player. Tick several cards and the bar over the list takes them all, one after another. A package is one file with the portrait inside.'

    const tools = el('div', { class: 'lh-library-tools' })
    const sourcesButton = el('button', { type: 'button', class: 'lh-button' }) as HTMLButtonElement
    sourcesButton.textContent = '📌 Save from this campaign'
    const importButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet' }) as HTMLButtonElement
    importButton.textContent = '📥 Import a package'
    const reload = el('button', { type: 'button', class: 'lh-button lh-button--quiet' }) as HTMLButtonElement
    reload.textContent = '↻ Reload'
    const search = el('input', { type: 'search', class: 'lh-input', placeholder: 'Search the library…', 'data-lh-field': 'library-search-input', 'aria-label': 'Search the library' }) as HTMLInputElement
    tools.append(sourcesButton, importButton, reload, search)
    const sourcesBox = el('div', { class: 'lh-library-sources', 'data-lh-field': 'library-sources' })
    sourcesBox.hidden = true
    // The picked cards' bar (53): hidden until a card is ticked.
    const pickedBar = el('div', { class: 'lh-library-picked', 'data-lh-field': 'library-picked' })
    pickedBar.hidden = true
    const pickedCount = el('span', { class: 'lh-library-picked-count' })
    const pickedParty = el('button', { type: 'button', class: 'lh-button', 'aria-label': 'Add the picked cards to the party' }) as HTMLButtonElement
    pickedParty.textContent = '+ Add to Party'
    const pickedWorld = el('button', { type: 'button', class: 'lh-button', 'aria-label': 'Add the picked cards to the world' }) as HTMLButtonElement
    pickedWorld.textContent = '🌍 Add to world'
    const pickedClear = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'aria-label': 'Clear the picked cards' }) as HTMLButtonElement
    pickedClear.textContent = 'Clear'
    pickedBar.append(pickedCount, pickedParty, pickedWorld, pickedClear)
    const list = el('div', { class: 'lh-library-list', 'data-lh-field': 'library-list' })
    const live = el('div', { class: 'lh-world-running', hidden: 'hidden' })
    const note = el('div', { class: 'lh-world-note lh-library-note' })
    const tail = el('div', { class: 'lh-library-tail' })
    body.append(lead, tools, sourcesBox, pickedBar, list, live, note, tail)
    root.append(summary, body)

    let chatId: string | null = null
    let records: LibraryRecordView[] | null = null
    let listError = ''
    let loading: Promise<void> | null = null
    let sources: LibrarySources | null = null
    let sourcesOpen = false
    let editing: { id: string; name: string; keys: string; notes: string; content: string } | null = null
    let running: { name: string; what: 'party' | 'world' | 'pc' | 'save' | 'import' | 'export' | 'photo' | 'draw'; step?: { at: number; of: number } } | null = null
    /** The last drawn photo's prompt, shown under the editor of the card it was drawn for (60). */
    let lastPrompt: { id: string; prompt: string } | null = null
    let last: { text: string; error: boolean } | null = null
    /** The ticked cards (53), by id, in no order: the list's order decides the batch's. */
    const picked = new Set<string>()

    const confirm = async (message: string): Promise<boolean> => (host.confirm ? host.confirm(message) : true)

    function say(text: string, error = false): void {
        last = { text, error }
        drawState()
    }

    async function load(): Promise<void> {
        if (loading) return loading
        loading = host.list()
            .then((result) => {
                records = result.records
                listError = ''
                // A tick on a card that is gone is gone with it.
                for (const id of [...picked]) if (!records.some((r) => r.id === id)) picked.delete(id)
            })
            .catch((error) => { records = null; listError = error instanceof Error ? error.message : String(error) })
            .finally(() => { loading = null; drawState() })
        drawState()
        return loading
    }

    async function loadSources(): Promise<void> {
        sources = null
        drawState()
        try {
            sources = await host.sources()
        } catch (error) {
            sources = { book: '', entries: [], playerCard: null, error: error instanceof Error ? error.message : String(error) }
        }
        drawState()
    }

    async function keep(what: () => Promise<LibraryRecordView | { status: 'exists'; name: string }>, again: (overwrite: boolean) => Promise<LibraryRecordView | { status: 'exists'; name: string }>, label: string): Promise<void> {
        running = { name: label, what: 'save' }
        drawState()
        try {
            let result = await what()
            if ('status' in result && result.status === 'exists') {
                if (!(await confirm(`“${result.name}” is already in the library. Replace it?`))) { say(`${label} was not saved: the library already has “${result.name}”.`); return }
                result = await again(true)
                if ('status' in result && result.status === 'exists') { say(`${label} was not saved: the library already has “${result.name}”.`); return }
            }
            await load()
            say(`Saved “${(result as LibraryRecordView).name}” to the library.`)
        } catch (error) {
            say(`${label} was not saved: ${reasonText(error instanceof Error ? error.message : String(error))}.`, true)
        } finally {
            running = null
            drawState()
        }
    }

    function drawSources(): void {
        sourcesBox.replaceChildren()
        sourcesBox.hidden = !sourcesOpen
        if (!sourcesOpen) return
        const head = el('div', { class: 'lh-library-empty' })
        if (!sources) { head.textContent = 'Reading the campaign…'; sourcesBox.append(head); return }
        if (sources.error) {
            head.textContent = `The campaign’s NPC book could not be read: ${reasonText(sources.error)}.`
            head.classList.add('lh-world-note--error')
            sourcesBox.append(head)
        } else {
            head.textContent = sources.book ? `The campaign’s NPC book is ${sources.book}.` : 'This campaign has no NPC book yet; the agent makes one when it records the first NPC.'
            sourcesBox.append(head)
        }
        if (sources.playerCard) {
            sourcesBox.append(sourceRow(`${sources.playerCard.name} (the Player Card)`, sources.playerCard.blurb, `Save the Player Card “${sources.playerCard.name}”`, () => keep(() => host.savePlayerCard({ overwrite: false }), (overwrite) => host.savePlayerCard({ overwrite }), 'The Player Card')))
        }
        for (const entry of sources.entries) {
            sourcesBox.append(sourceRow(entry.name + (entry.core ? '' : ' (no [CORE] block)'), entry.blurb, `Save “${entry.name}”`, () => keep(() => host.saveEntry({ entryId: entry.id, overwrite: false }), (overwrite) => host.saveEntry({ entryId: entry.id, overwrite }), entry.name)))
        }
        if (!sources.playerCard && !sources.entries.length && !sources.error) {
            const empty = el('div', { class: 'lh-library-empty' })
            empty.textContent = 'Nothing to save yet: no NPC entries, and no Player Card.'
            sourcesBox.append(empty)
        }
    }

    function sourceRow(name: string, blurb: string, label: string, onSave: () => Promise<void>): HTMLElement {
        const row = el('div', { class: 'lh-library-source' })
        const info = el('div', { class: 'lh-library-info' })
        const title = el('div', { class: 'lh-library-name' })
        title.textContent = name
        const line = el('div', { class: 'lh-library-blurb' })
        line.textContent = blurb || 'No description'
        info.append(title, line)
        const save = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'aria-label': label }) as HTMLButtonElement
        save.textContent = 'Save'
        save.disabled = !!running
        save.addEventListener('click', () => { onSave().catch(host.fail) })
        row.append(info, save)
        return row
    }

    function drawList(): void {
        list.replaceChildren()
        if (listError) {
            const empty = el('div', { class: 'lh-library-empty lh-world-note--error' })
            empty.textContent = `The library could not be read: ${reasonText(listError)}.`
            list.append(empty)
            return
        }
        if (!records) {
            const empty = el('div', { class: 'lh-library-empty' })
            empty.textContent = loading ? 'Reading the library…' : 'Open the fold to read the library.'
            list.append(empty)
            return
        }
        const filter = search.value.trim().toLowerCase()
        const shown = filter ? records.filter((r) => r.name.toLowerCase().includes(filter)) : records
        if (!shown.length) {
            const empty = el('div', { class: 'lh-library-empty' })
            empty.textContent = records.length ? 'No cards match.' : 'The library is empty. Save a card from this campaign, or import a package.'
            list.append(empty)
            return
        }
        for (const record of shown) list.append(drawCard(record))
    }

    function drawCard(record: LibraryRecordView): HTMLElement {
        const card = el('div', { class: 'lh-library-card', 'data-lh-card': record.id })
        const row = el('div', { class: 'lh-library-row' })
        const pick = el('input', { type: 'checkbox', class: 'lh-library-pick', 'data-lh-field': `library-pick-${record.id}`, 'aria-label': `Pick “${record.name}”` }) as HTMLInputElement
        pick.checked = picked.has(record.id)
        pick.disabled = !!running
        pick.addEventListener('change', () => { if (pick.checked) picked.add(record.id); else picked.delete(record.id); drawPicked() })
        const portrait = record.portraitPath
            ? el('img', { class: 'lh-library-portrait', src: record.portraitPath, alt: '', loading: 'lazy' })
            : Object.assign(el('div', { class: 'lh-library-portrait', 'aria-hidden': 'true' }), { textContent: '👤' })
        zoomable(portrait, record.portraitPath ?? '', record.name, host.enlarge, () => photoActions(record))
        const info = el('div', { class: 'lh-library-info' })
        const name = el('div', { class: 'lh-library-name' })
        name.textContent = record.name
        const blurb = el('div', { class: 'lh-library-blurb' })
        blurb.textContent = record.blurb || record.notes || 'No description'
        info.append(name, blurb)
        row.append(pick, portrait, info)
        card.append(row)

        const buttons = el('div', { class: 'lh-library-buttons' })
        const busy = !!running
        const button = (text: string, label: string, quiet: boolean, disabled: boolean, title: string, onClick: () => void): HTMLButtonElement => {
            const b = el('button', { type: 'button', class: `lh-button${quiet ? ' lh-button--quiet' : ''}`, 'aria-label': label }) as HTMLButtonElement
            b.textContent = text
            b.disabled = disabled
            b.title = title
            b.addEventListener('click', onClick)
            return b
        }
        const chatTitle = chatId ? '' : 'Open a chat first.'
        buttons.append(
            button(editing?.id === record.id ? 'Editing…' : '🗂 Full card', `Open the card “${record.name}”`, true, busy || editing?.id === record.id, 'Open the card’s text to read or edit it.', () => { editing = { id: record.id, name: record.name, keys: record.keys.join(', '), notes: record.notes, content: record.content }; drawState() }),
            button('+ Add to Party', `Add “${record.name}” to the party`, false, busy || !chatId, chatTitle || 'One tracker pass seats this card in [PARTY], with its portrait.', () => { act('party', record) }),
            button('🌍 Add to world', `Add “${record.name}” to the world`, false, busy || !chatId, chatTitle || 'The card goes into this campaign’s NPC book as is, with its keywords and portrait; the lorebook agent reads it from then on.', () => { act('world', record) }),
            button('▶ Play as PC', `Play as “${record.name}”`, false, busy || !chatId, chatTitle || 'The Player Card is set from this card, and one tracker pass swaps [CHARACTER].', () => { act('pc', record) }),
            button('Export', `Export “${record.name}”`, true, busy, 'One .mnpc.json file, the portrait inside.', () => { exportCard(record).catch(host.fail) }),
            button('Remove', `Remove “${record.name}”`, true, busy, 'Take the card out of the library. It asks first.', () => { removeCard(record).catch(host.fail) }),
        )
        card.append(buttons)
        if (editing?.id === record.id) card.append(drawEditor(record))
        return card
    }

    function drawEditor(record: LibraryRecordView): HTMLElement {
        const draft = editing!
        const box = el('div', { class: 'lh-library-editor' })
        const nameInput = el('input', { type: 'text', class: 'lh-input', 'data-lh-field': 'library-name-input', 'aria-label': 'Card name' }) as HTMLInputElement
        nameInput.value = draft.name
        nameInput.addEventListener('input', () => { draft.name = nameInput.value })
        const keysInput = el('input', { type: 'text', class: 'lh-input', 'data-lh-field': 'library-keys-input', 'aria-label': 'Keywords, separated by commas', placeholder: 'Keywords, separated by commas' }) as HTMLInputElement
        keysInput.value = draft.keys
        keysInput.addEventListener('input', () => { draft.keys = keysInput.value })
        const notesInput = el('input', { type: 'text', class: 'lh-input', 'data-lh-field': 'library-notes-input', 'aria-label': 'Notes', placeholder: 'Notes (yours; never sent)' }) as HTMLInputElement
        notesInput.value = draft.notes
        notesInput.addEventListener('input', () => { draft.notes = notesInput.value })
        const area = el('textarea', { class: 'lh-input', rows: '10', spellcheck: 'false', 'data-lh-field': 'library-content-input', 'aria-label': 'Card text' }) as HTMLTextAreaElement
        area.value = draft.content
        area.addEventListener('input', () => { draft.content = area.value })
        // The photo (60): the picture as the record keeps it, and the three ways to change it.
        const photo = el('div', { class: 'lh-library-photo', 'data-lh-field': 'library-photo' })
        const thumb: HTMLElement = record.portraitPath
            ? el('img', { class: 'lh-library-photo-thumb', src: record.portraitPath, alt: `The photo of ${record.name}` })
            : Object.assign(el('div', { class: 'lh-library-photo-thumb', 'aria-hidden': 'true' }), { textContent: '👤' })
        zoomable(thumb, record.portraitPath ?? '', record.name, host.enlarge, () => photoActions(record))
        const photoButtons = el('div', { class: 'lh-library-photo-buttons' })
        const busy = !!running
        const photoButton = (text: string, label: string, disabled: boolean, title: string, onClick: () => void): HTMLButtonElement => {
            const b = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'aria-label': label }) as HTMLButtonElement
            b.textContent = text
            b.disabled = disabled
            b.title = title
            b.addEventListener('click', onClick)
            return b
        }
        photoButtons.append(
            photoButton(record.portraitPath ? '🖼 Change photo' : '🖼 Set photo', `Set the photo of “${record.name}”`, busy || !host.pickImage, host.pickImage ? 'Pick an image file; it is stored with the host and kept on the card.' : 'This build has no file picker.', () => { setPhoto(record).catch(host.fail) }),
            photoButton('🎨 Draw the photo', `Draw the photo of “${record.name}”`, busy || !host.drawPhoto, host.drawPhoto ? 'One model call describes the card for the image model, then the scene’s image connection draws it in 2:3.' : 'This build cannot draw pictures.', () => { drawPhoto(record).catch(host.fail) }),
        )
        if (record.portraitPath) photoButtons.append(photoButton('Remove photo', `Remove the photo of “${record.name}”`, busy, 'Take the photo off the card. A chat that shows it keeps it.', () => { removePhoto(record).catch(host.fail) }))
        photo.append(thumb, photoButtons)
        const buttons = el('div', { class: 'lh-world-buttons' })
        const save = el('button', { type: 'button', class: 'lh-button' }) as HTMLButtonElement
        save.textContent = 'Save'
        save.addEventListener('click', () => {
            host.update({ id: record.id, name: draft.name.trim(), content: draft.content, keys: draft.keys.split(',').map((k) => k.trim()).filter(Boolean), notes: draft.notes })
                .then(async (view) => { editing = null; await load(); say(`Saved “${view.name}”.`) })
                .catch((error) => { say(`The card was not saved: ${reasonText(error instanceof Error ? error.message : String(error))}.`, true) })
        })
        const cancel = el('button', { type: 'button', class: 'lh-button lh-button--quiet' }) as HTMLButtonElement
        cancel.textContent = 'Cancel'
        cancel.addEventListener('click', () => { editing = null; drawState() })
        buttons.append(save, cancel)
        box.append(photo, nameInput, keysInput, notesInput, area, buttons)
        if (lastPrompt?.id === record.id) {
            const promptBox = el('div', { class: 'lh-library-prompt', 'data-lh-field': 'library-photo-prompt' })
            promptBox.textContent = lastPrompt.prompt
            box.append(promptBox)
        }
        return box
    }

    /** Whether the open chat names the card (60): the photo then lands on that entity too. */
    const inPlay = (record: LibraryRecordView): boolean => !!chatId && !!host.inPlay?.(record.name)

    /** The photo's own buttons on the large view (80): the editor's three, with their notes. */
    function photoActions(record: LibraryRecordView): PictureActions | undefined {
        if (running) return undefined
        return {
            kind: 'photo',
            set: host.pickImage ? () => setPhoto(record) : null,
            draw: host.drawPhoto ? () => drawPhoto(record) : null,
            ...(record.portraitPath ? { remove: () => removePhoto(record) } : {}),
            ...(!host.pickImage ? { note: 'This build has no file picker.' } : !host.drawPhoto ? { note: 'This build cannot draw pictures.' } : {}),
            fail: host.fail,
        }
    }

    async function setPhoto(record: LibraryRecordView): Promise<void> {
        if (running || !host.pickImage) return
        const picked = await host.pickImage()
        if (!picked) return
        running = { name: record.name, what: 'photo' }
        drawState()
        try {
            const result = await host.setPhoto({ id: record.id, dataUrl: picked.dataUrl, filename: picked.filename, place: inPlay(record) })
            await load()
            say(describePhoto('set', result))
        } catch (error) {
            say(`The photo of “${record.name}” was not set: ${reasonText(error instanceof Error ? error.message : String(error))}.`, true)
        } finally {
            running = null
            drawState()
        }
    }

    async function drawPhoto(record: LibraryRecordView): Promise<void> {
        if (running || !host.drawPhoto) return
        running = { name: record.name, what: 'draw' }
        last = null
        drawState()
        try {
            const result = await host.drawPhoto({ id: record.id, place: inPlay(record) })
            if (!result) { say('Nothing was drawn.'); return }
            if (result.prompt) lastPrompt = { id: record.id, prompt: result.prompt }
            await load()
            say(describePhoto('drawn', result))
        } catch (error) {
            say(`The photo of “${record.name}” could not be drawn: ${reasonText(error instanceof Error ? error.message : String(error))}.`, true)
        } finally {
            running = null
            drawState()
        }
    }

    async function removePhoto(record: LibraryRecordView): Promise<void> {
        if (running) return
        try {
            const result = await host.removePhoto(record.id)
            await load()
            say(describePhoto('removed', result))
        } catch (error) {
            say(`The photo of “${record.name}” was not removed: ${reasonText(error instanceof Error ? error.message : String(error))}.`, true)
        }
    }

    function act(what: 'party' | 'world' | 'pc', record: LibraryRecordView): void {
        if (running || !chatId) return
        running = { name: record.name, what }
        last = null
        drawState()
        const call = what === 'world'
            ? host.world(record.id).then((result) => { say(describeNpcAdd(result, host.when), result.status !== 'added') })
            : (what === 'party' ? host.party(record.id) : host.playAsPc(record.id)).then((result) => { say(describeLibraryAction(result, host.when), result.status === 'failed') })
        call
            .catch((error) => { say(`${record.name} ${what === 'party' ? 'did not join the party' : what === 'world' ? 'was not added to the world' : 'did not become the player'}: ${reasonText(error instanceof Error ? error.message : String(error))}.`, true) })
            .finally(() => { running = null; drawState() })
    }

    /** The picked cards into the party or the world (53), one after another in the list's order; a card that went in is unticked, one that did not stays ticked. */
    async function actMany(what: 'party' | 'world'): Promise<void> {
        if (running || !chatId || !records) return
        const chosen = records.filter((r) => picked.has(r.id))
        if (!chosen.length) return
        const outcomes: BatchOutcome[] = []
        last = null
        try {
            for (const [index, record] of chosen.entries()) {
                running = { name: record.name, what, step: { at: index + 1, of: chosen.length } }
                drawState()
                try {
                    if (what === 'party') {
                        const result = await host.party(record.id)
                        outcomes.push(result.status === 'done' ? { name: record.name, ok: true } : { name: record.name, ok: false, reason: result.reason })
                    } else {
                        const result = await host.world(record.id)
                        outcomes.push(result.status === 'added'
                            ? { name: record.name, ok: true, ...(result.book ? { book: result.book } : {}) }
                            : { name: record.name, ok: false, reason: result.status === 'exists' ? `already in ${result.book || 'the NPC book'}` : result.reason })
                    }
                } catch (error) {
                    outcomes.push({ name: record.name, ok: false, reason: error instanceof Error ? error.message : String(error) })
                }
                if (outcomes[outcomes.length - 1]!.ok) picked.delete(record.id)
            }
        } finally {
            running = null
            say(describeBatch(what, outcomes), outcomes.some((o) => !o.ok))
        }
    }

    function drawPicked(): void {
        const count = picked.size
        pickedBar.hidden = count === 0
        pickedCount.textContent = `${count} picked`
        const busy = !!running
        pickedParty.disabled = pickedWorld.disabled = busy || !chatId
        pickedParty.title = pickedWorld.title = chatId ? '' : 'Open a chat first.'
        pickedClear.disabled = busy
    }

    async function exportCard(record: LibraryRecordView): Promise<void> {
        if (running) return
        running = { name: record.name, what: 'export' }
        drawState()
        try {
            const data = record.portraitPath ? await host.portraitData(record.portraitPath) : ''
            const out = await host.exportCard(record.id, data)
            host.download(out.filename, out.file)
            say(out.withPortrait ? `Exported “${record.name}” with its portrait: ${out.filename}.` : record.portraitPath ? `Exported “${record.name}” without its portrait (the picture could not be read): ${out.filename}.` : `Exported “${record.name}”: ${out.filename}.`)
        } catch (error) {
            say(`“${record.name}” was not exported: ${reasonText(error instanceof Error ? error.message : String(error))}.`, true)
        } finally {
            running = null
            drawState()
        }
    }

    async function removeCard(record: LibraryRecordView): Promise<void> {
        if (running) return
        if (!(await confirm(`Remove “${record.name}” from the library? This cannot be undone.`))) return
        try {
            await host.remove(record.id)
            if (editing?.id === record.id) editing = null
            await load()
            say(`Removed “${record.name}”.`)
        } catch (error) {
            say(`“${record.name}” was not removed: ${reasonText(error instanceof Error ? error.message : String(error))}.`, true)
        }
    }

    async function importPackage(): Promise<void> {
        if (running) return
        const text = await host.pickText()
        if (text === null) return
        running = { name: 'the package', what: 'import' }
        drawState()
        try {
            const { records: stored } = await host.importText(text)
            await load()
            say(`Imported ${stored.length} card${stored.length === 1 ? '' : 's'}: ${stored.map((r) => r.name).join(', ')}.`)
        } catch (error) {
            say(`The package was not imported: ${reasonText(error instanceof Error ? error.message : String(error))}.`, true)
        } finally {
            running = null
            drawState()
        }
    }

    function drawState(): void {
        const busy = !!running
        for (const control of [sourcesButton, importButton, search]) control.disabled = busy
        reload.disabled = busy || !!loading
        sourcesButton.disabled = busy || !chatId
        sourcesButton.title = chatId ? 'List the campaign’s NPC entries and the Player Card, each with a Save button.' : 'Open a chat first.'
        live.hidden = !busy
        const step = running?.step ? ` (${running.step.at} of ${running.step.of})` : ''
        live.textContent = running
            ? running.what === 'party' ? `👥 Seating “${running.name}” in the party${step}… the tracker’s cards fill in when the roster is written.`
            : running.what === 'world' ? `🌍 Adding “${running.name}” to the NPC book${step}…`
            : running.what === 'pc' ? `▶ Making “${running.name}” the player… the tracker’s cards fill in when the sheet is written.`
            : running.what === 'save' ? `📌 Saving ${running.name}…`
            : running.what === 'import' ? '📥 Importing the package…'
            : running.what === 'photo' ? `🖼 Storing the photo of “${running.name}”…`
            : running.what === 'draw' ? `🎨 Drawing the photo of “${running.name}”… one model call writes the prompt, then the image connection draws it.`
            : `Exporting “${running.name}”…`
            : ''
        note.textContent = last?.text ?? ''
        note.classList.toggle('lh-world-note--error', !!last?.error)
        drawSources()
        drawPicked()
        drawList()
    }

    pickedParty.addEventListener('click', () => { actMany('party').catch(host.fail) })
    pickedWorld.addEventListener('click', () => { actMany('world').catch(host.fail) })
    pickedClear.addEventListener('click', () => { picked.clear(); drawState() })

    root.addEventListener('toggle', () => { if (root.open && !records && !loading) { load().catch(host.fail) } })
    reload.addEventListener('click', () => { load().catch(host.fail) })
    search.addEventListener('input', () => { drawList() })
    sourcesButton.addEventListener('click', () => {
        sourcesOpen = !sourcesOpen
        if (sourcesOpen) loadSources().catch(host.fail)
        else drawState()
    })
    importButton.addEventListener('click', () => { importPackage().catch(host.fail) })

    drawState()

    return {
        root,
        tail,
        setChat(id) {
            chatId = id
            sourcesOpen = false
            sources = null
            if (!id) { last = null; picked.clear() }
            drawState()
        },
        refresh: load,
        busy: () => !!running,
    }
}
