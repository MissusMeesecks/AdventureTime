/**
 * The NPC creator's fold (Phase 41a).
 *
 * The legacy's NPC/PC Manager dialog, less its Library tab's own actions
 * (which the NPC library fold carries): four tabs — **Library**, **From
 * a card**, **Freeform**, **Archetype** — and two ways in. **Add as is** writes
 * a library record, or a host card (verbatim, or after one review for the
 * world and era, the *Add as is* preference), into the campaign's NPC book at
 * once. **Fit into story**, **Generate NPC** on a description and **Generate
 * NPC** on an archetype each draft one `[[NPC: …]]` tag, shown in the preview
 * below to edit, and **Add NPC** writes it. A name already in the book is
 * refused, and the preview warns before you press.
 */

import type { CardChoice, LibraryRecordView, NpcAddResult, NpcDraftResult, NpcSource } from '../protocol.js'
import { NPC_ARCHETYPES, normalizeAddAsIsMode, parseNpcTag, type AddAsIsMode } from '../tracker/npc-creator.js'
import { reasonText } from './player-card-fold.js'

export interface NpcCreatorFoldHost {
    el(tag: string, attrs?: Record<string, string>): HTMLElement
    cards(): Promise<{ cards: CardChoice[] }>
    library(): Promise<{ records: LibraryRecordView[] }>
    draft(request: { source: NpcSource }): Promise<NpcDraftResult>
    add(request: { source: NpcSource }): Promise<NpcAddResult>
    commit(request: { tag: string; name: string; how: NpcDraftResult['how']; portrait?: NpcSource }): Promise<NpcAddResult>
    savePrefs(patch: Record<string, unknown>): Promise<void>
    fail(error: unknown): void
    when(iso: string): string
}

export interface NpcCreatorPrefs {
    npcAddAsIsMode?: 'literal' | 'ai_review'
}

export interface NpcCreatorFold {
    root: HTMLDetailsElement
    applyPrefs(prefs: NpcCreatorPrefs): void
    setChat(chatId: string | null): void
    /** Read the cards and the library again. */
    refresh(): Promise<void>
    busy(): boolean
}

export type NpcTab = 'library' | 'card' | 'freeform' | 'archetype'

/** How many cards the list shows before *Show more*, as the legacy's. */
export const NPC_CARD_PAGE = 10

const HOW_WORDS: Record<NpcAddResult['how'], string> = {
    literal: 'as is',
    reviewed: 'after a review for the world',
    fit: 'fitted into the story',
    freeform: 'from the description',
    archetype: 'from the archetype',
}

export function describeNpcAdd(result: NpcAddResult, when: (iso: string) => string): string {
    const stamped = result.at ? when(result.at) : ''
    const tail = stamped ? ` Ran ${stamped}.` : ''
    const who = result.name ? `“${result.name}”` : 'The NPC'
    if (result.status === 'added') {
        const portrait = result.portrait ? ' Their portrait is placed.' : ''
        return `Added ${who} to ${result.book || 'the NPC book'} ${HOW_WORDS[result.how]}.${portrait} The agent reads it from here on.${tail}`
    }
    if (result.status === 'exists') return `${who} is already in ${result.book || 'the NPC book'}; nothing was added.${tail}`
    return `${who} was not added: ${reasonText(result.reason)}.${tail}`
}

export function describeNpcDraftFailure(result: NpcDraftResult, when: (iso: string) => string): string {
    const stamped = result.at ? when(result.at) : ''
    const tail = stamped ? ` Ran ${stamped}.` : ''
    const from = result.how === 'fit' ? `“${result.source || 'the card'}”` : result.how === 'archetype' ? `the archetype ${result.source || ''}`.trim() : 'the description'
    return `Nothing was drafted from ${from}: ${reasonText(result.reason)}.${tail}`
}

export const NPC_CREATOR_FOLD_CSS = `
.lh-npc-creator > summary { cursor: pointer; font-size: 0.85em; opacity: 0.8; }
.lh-npc-body { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.lh-npc-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.lh-npc-tab { font-size: 0.78em; padding: 3px 9px; border-radius: 12px; opacity: 0.7; }
.lh-npc-tab[aria-selected="true"] { opacity: 1; outline: 1px solid var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
.lh-npc-panel { display: flex; flex-direction: column; gap: 6px; }
/* An author display rule outranks the UA's [hidden]; the screenshot showed every tab at once (41a). */
.lh-npc-panel[hidden], .lh-npc-preview[hidden], .lh-npc-field[hidden], .lh-npc-warning[hidden] { display: none; }
.lh-npc-tools { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.lh-npc-mode { display: flex; gap: 6px; align-items: center; font-size: 0.8em; flex-wrap: wrap; }
.lh-npc-list { display: flex; flex-direction: column; gap: 4px; }
.lh-npc-card { display: flex; align-items: center; gap: 8px; padding: 5px 7px; border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(255,255,255,0.12))); border-radius: 5px; }
.lh-npc-info { flex: 1; min-width: 0; }
.lh-npc-name { font-size: 0.85em; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lh-npc-blurb { font-size: 0.75em; opacity: 0.55; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lh-npc-buttons { display: flex; gap: 4px; flex-wrap: wrap; }
.lh-npc-buttons .lh-button { font-size: 0.75em; padding: 2px 7px; white-space: nowrap; }
.lh-npc-chips { display: flex; gap: 4px; flex-wrap: wrap; }
.lh-npc-chip { font-size: 0.78em; padding: 3px 8px; border-radius: 12px; opacity: 0.75; }
.lh-npc-chip[aria-pressed="true"] { opacity: 1; outline: 1px solid var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
.lh-npc-field { display: flex; flex-direction: column; gap: 2px; font-size: 0.8em; }
.lh-npc-field textarea, .lh-npc-preview textarea { width: 100%; box-sizing: border-box; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.78em; line-height: 1.45; }
.lh-npc-preview { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px; border: 1px dashed var(--lh-accent-dim, var(--lumiverse-border, rgba(255,255,255,0.18))); border-radius: 6px; }
.lh-npc-preview-title { font-size: 0.85em; font-weight: 600; }
.lh-npc-warning { font-size: 0.78em; color: #ff7b7b; }
.lh-npc-empty { font-size: 0.8em; opacity: 0.6; padding: 4px 0; }
`

function option(el: NpcCreatorFoldHost['el'], value: string, label: string): HTMLOptionElement {
    const node = el('option', { value }) as HTMLOptionElement
    node.textContent = label
    return node
}

export function createNpcCreatorFold(host: NpcCreatorFoldHost): NpcCreatorFold {
    const { el } = host

    const root = el('details', { class: 'lh-npc-creator' }) as HTMLDetailsElement
    const summary = el('summary')
    summary.textContent = 'NPC creator'
    const body = el('div', { class: 'lh-npc-body' })
    const lead = el('div', { class: 'lh-world-lead' })
    lead.textContent = 'A new NPC for this campaign’s NPC book: a library card, one of your character cards, a description in your own words, or a story role. Add as is copies it in; Fit into story and Generate ask a model and show the entry below to check before it is added.'

    // ── The tabs ──────────────────────────────────────────────────────────
    const tabs = el('div', { class: 'lh-npc-tabs', role: 'tablist' })
    const TABS: Array<{ id: NpcTab; label: string }> = [
        { id: 'library', label: '📚 Library' },
        { id: 'card', label: '🎴 From a card' },
        { id: 'freeform', label: '✍️ Freeform' },
        { id: 'archetype', label: '🎭 Archetype' },
    ]
    const tabButtons = new Map<NpcTab, HTMLButtonElement>()
    const panels = new Map<NpcTab, HTMLElement>()
    for (const { id, label } of TABS) {
        const button = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-npc-tab', role: 'tab', 'aria-selected': 'false', 'data-lh-tab': id }) as HTMLButtonElement
        button.textContent = label
        button.addEventListener('click', () => { show(id) })
        tabs.append(button)
        tabButtons.set(id, button)
        const panel = el('div', { class: 'lh-npc-panel', role: 'tabpanel', 'data-lh-panel': id })
        panel.hidden = true
        panels.set(id, panel)
    }

    // ── Library ───────────────────────────────────────────────────────────
    const libraryPanel = panels.get('library')!
    const librarySearch = el('input', { type: 'search', class: 'lh-input', placeholder: 'Search the library…', 'data-lh-field': 'npc-library-search-input', 'aria-label': 'Search the library' }) as HTMLInputElement
    const libraryList = el('div', { class: 'lh-npc-list', 'data-lh-field': 'npc-library-list' })
    libraryPanel.append(librarySearch, libraryList)

    // ── From a card ───────────────────────────────────────────────────────
    const cardPanel = panels.get('card')!
    const modeRow = el('div', { class: 'lh-npc-mode' })
    const modeLabel = el('label')
    modeLabel.textContent = 'Add as is'
    const mode = el('select', { class: 'lh-input', 'data-lh-field': 'npc-mode-input', 'aria-label': 'What Add as is does with a card' }) as HTMLSelectElement
    mode.append(option(el, 'ai_review', 'reviews the card for the world first'), option(el, 'literal', 'copies the card verbatim'))
    mode.value = 'ai_review'
    mode.addEventListener('change', () => { host.savePrefs({ npcAddAsIsMode: normalizeAddAsIsMode(mode.value) }).catch(host.fail); drawLists() })
    modeRow.append(modeLabel, mode)
    const cardTools = el('div', { class: 'lh-npc-tools' })
    const cardSearch = el('input', { type: 'search', class: 'lh-input', placeholder: 'Search characters by name…', 'data-lh-field': 'npc-card-search-input', 'aria-label': 'Search characters by name' }) as HTMLInputElement
    const reloadCards = el('button', { type: 'button', class: 'lh-button lh-button--quiet' }) as HTMLButtonElement
    reloadCards.textContent = '↻ Reload the cards'
    cardTools.append(cardSearch, reloadCards)
    const cardList = el('div', { class: 'lh-npc-list', 'data-lh-field': 'npc-card-list' })
    cardPanel.append(modeRow, cardTools, cardList)

    // ── Freeform ──────────────────────────────────────────────────────────
    const freeformPanel = panels.get('freeform')!
    const freeformHint = el('div', { class: 'lh-world-lead' })
    freeformHint.textContent = 'Describe the NPC in your own words. The model expands it into a full entry fitting the current campaign.'
    const freeformName = field('Name (optional)', 'input', 'npc-freeform-name-input', 'e.g. Igor, Mira Voss, …')
    const freeformDescription = field('Description / concept', 'textarea', 'npc-freeform-description-input', 'e.g. A massive bovine warrior, stoic and dry-witted, survivor of the Tether-Break…')
    const freeformButton = el('button', { type: 'button', class: 'lh-button', 'aria-label': 'Generate the NPC from the description' }) as HTMLButtonElement
    freeformButton.textContent = '🤖 Generate NPC'
    freeformButton.addEventListener('click', () => {
        const description = freeformDescription.input.value.trim()
        if (!description) { say('Write a description first.', true); return }
        begin({ kind: 'freeform', name: freeformName.input.value.trim(), description }, 'draft', freeformName.input.value.trim() || 'the description')
    })
    freeformPanel.append(freeformHint, freeformName.row, freeformDescription.row, freeformButton)

    // ── Archetype ─────────────────────────────────────────────────────────
    const archetypePanel = panels.get('archetype')!
    const archetypeHint = el('div', { class: 'lh-world-lead' })
    archetypeHint.textContent = 'Pick a story role, or type one. The model makes a fitting NPC grounded in the current campaign.'
    const chips = el('div', { class: 'lh-npc-chips', 'data-lh-field': 'npc-archetypes' })
    let archetype = ''
    const chipButtons = new Map<string, HTMLButtonElement>()
    for (const { id, icon } of NPC_ARCHETYPES) {
        const chip = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-npc-chip', 'aria-pressed': 'false', 'data-lh-archetype': id }) as HTMLButtonElement
        chip.textContent = `${icon} ${id}`
        chip.addEventListener('click', () => { archetype = id; drawChips() })
        chips.append(chip)
        chipButtons.set(id, chip)
    }
    const custom = field('Custom archetype / role', 'input', 'npc-archetype-custom-input', 'e.g. Mentor, Bartender, Guildmaster…')
    custom.row.hidden = true
    const archetypeName = field('Name (optional)', 'input', 'npc-archetype-name-input', 'Leave blank to let the model choose')
    const archetypeConcept = field('Extra concept / prompt (optional)', 'textarea', 'npc-archetype-concept-input', 'e.g. Owes the party a debt from before the story began…')
    const archetypeButton = el('button', { type: 'button', class: 'lh-button', 'aria-label': 'Generate the NPC from the archetype' }) as HTMLButtonElement
    archetypeButton.textContent = '🤖 Generate NPC'
    archetypeButton.addEventListener('click', () => {
        const role = archetype === 'Custom' ? custom.input.value.trim() : archetype
        if (!role) { say(archetype === 'Custom' ? 'Type the custom role first.' : 'Pick an archetype first.', true); return }
        begin({ kind: 'archetype', archetype: role, name: archetypeName.input.value.trim(), concept: archetypeConcept.input.value.trim() }, 'draft', role)
    })
    archetypePanel.append(archetypeHint, chips, custom.row, archetypeName.row, archetypeConcept.row, archetypeButton)

    // ── The preview, the live line and the note ───────────────────────────
    const preview = el('div', { class: 'lh-npc-preview', 'data-lh-field': 'npc-preview' })
    preview.hidden = true
    const previewTitle = el('div', { class: 'lh-npc-preview-title' })
    const previewWarning = el('div', { class: 'lh-npc-warning' })
    const previewHint = el('div', { class: 'lh-world-lead' })
    const previewText = el('textarea', { class: 'lh-input', rows: '8', 'data-lh-field': 'npc-preview-input', 'aria-label': 'The drafted entry' }) as HTMLTextAreaElement
    const previewButtons = el('div', { class: 'lh-npc-buttons' })
    const addDrafted = el('button', { type: 'button', class: 'lh-button', 'aria-label': 'Add the drafted NPC' }) as HTMLButtonElement
    addDrafted.textContent = '✅ Add NPC'
    const cancelDraft = el('button', { type: 'button', class: 'lh-button lh-button--quiet' }) as HTMLButtonElement
    cancelDraft.textContent = 'Cancel'
    previewButtons.append(addDrafted, cancelDraft)
    preview.append(previewTitle, previewWarning, previewHint, previewText, previewButtons)
    const live = el('div', { class: 'lh-world-running', hidden: 'hidden' })
    const note = el('div', { class: 'lh-world-note lh-npc-note' })

    body.append(lead, tabs, ...TABS.map(({ id }) => panels.get(id)!), preview, live, note)
    root.append(summary, body)

    // ── State ─────────────────────────────────────────────────────────────
    let chatId: string | null = null
    let tab: NpcTab | null = null
    let cards: CardChoice[] | null = null
    let cardsError = ''
    let shown = NPC_CARD_PAGE
    let records: LibraryRecordView[] | null = null
    let recordsError = ''
    let loading: Promise<void> | null = null
    let running: { what: 'add' | 'draft' | 'commit'; label: string } | null = null
    let drafted: { result: NpcDraftResult; source: NpcSource } | null = null
    let last: { text: string; error: boolean } | null = null

    function field(label: string, kind: 'input' | 'textarea', name: string, placeholder: string): { row: HTMLElement; input: HTMLInputElement | HTMLTextAreaElement } {
        const row = el('label', { class: 'lh-npc-field' })
        const text = el('span')
        text.textContent = label
        const input = el(kind, { class: 'lh-input', placeholder, 'data-lh-field': name, ...(kind === 'input' ? { type: 'text' } : { rows: '4' }) }) as HTMLInputElement | HTMLTextAreaElement
        row.append(text, input)
        return { row, input }
    }

    function say(text: string, error = false): void {
        last = { text, error }
        drawState()
    }

    function show(id: NpcTab): void {
        tab = id
        for (const [key, button] of tabButtons) button.setAttribute('aria-selected', key === id ? 'true' : 'false')
        for (const [key, panel] of panels) panel.hidden = key !== id
        if (id === 'card' && !cards && !loading) load().catch(host.fail)
    }

    async function load(): Promise<void> {
        if (loading) return loading
        loading = Promise.all([
            host.library().then((result) => { records = result.records; recordsError = '' }).catch((error) => { records = null; recordsError = error instanceof Error ? error.message : String(error) }),
            host.cards().then((result) => { cards = result.cards; cardsError = ''; shown = NPC_CARD_PAGE }).catch((error) => { cards = null; cardsError = error instanceof Error ? error.message : String(error) }),
        ])
            .then(() => {
                // The legacy opens on the library when it holds anything, else on the cards.
                if (!tab) show(records?.length ? 'library' : 'card')
            })
            .finally(() => { loading = null; drawState() })
        drawState()
        return loading
    }

    /** One action at a time: Add as is writes at once, a draft fills the preview. */
    function begin(source: NpcSource, what: 'add' | 'draft', label: string): void {
        if (running || !chatId) return
        running = { what, label }
        last = null
        if (what === 'draft') drafted = null
        drawState()
        const call = what === 'add' ? host.add({ source }).then((result) => { last = { text: describeNpcAdd(result, host.when), error: result.status !== 'added' } }) : host.draft({ source }).then((result) => {
            if (result.status === 'drafted') {
                drafted = { result, source }
                last = { text: `Drafted “${result.name}” — read it below, change what you like, then press Add NPC.`, error: false }
            } else {
                last = { text: describeNpcDraftFailure(result, host.when), error: true }
            }
        })
        call
            .catch((error) => { last = { text: `${what === 'add' ? 'The NPC was not added' : 'Nothing was drafted'}: ${reasonText(error instanceof Error ? error.message : String(error))}.`, error: true } })
            .finally(() => { running = null; drawState() })
    }

    function commitDraft(): void {
        if (running || !chatId || !drafted) return
        const tag = previewText.value
        const name = parseNpcTag(tag)?.name || drafted.result.name
        const { how } = drafted.result
        const portrait = drafted.source.kind === 'card' || drafted.source.kind === 'library' ? { portrait: drafted.source } : {}
        running = { what: 'commit', label: name }
        last = null
        drawState()
        host.commit({ tag, name, how, ...portrait })
            .then((result) => {
                last = { text: describeNpcAdd(result, host.when), error: result.status !== 'added' }
                if (result.status === 'added') drafted = null
            })
            .catch((error) => { last = { text: `The NPC was not added: ${reasonText(error instanceof Error ? error.message : String(error))}.`, error: true } })
            .finally(() => { running = null; drawState() })
    }

    addDrafted.addEventListener('click', commitDraft)
    cancelDraft.addEventListener('click', () => { drafted = null; drawState() })
    reloadCards.addEventListener('click', () => { load().catch(host.fail) })
    cardSearch.addEventListener('input', () => { shown = NPC_CARD_PAGE; drawLists() })
    librarySearch.addEventListener('input', drawLists)
    root.addEventListener('toggle', () => { if (root.open && !cards && !records && !loading) load().catch(host.fail) })

    // ── Drawing ───────────────────────────────────────────────────────────
    function drawChips(): void {
        for (const [id, chip] of chipButtons) chip.setAttribute('aria-pressed', id === archetype ? 'true' : 'false')
        custom.row.hidden = archetype !== 'Custom'
    }

    function pair(name: string, text: string, label: string, onAdd: () => void, onFit: () => void, addTitle: string): HTMLElement {
        const row = el('div', { class: 'lh-npc-card' })
        const info = el('div', { class: 'lh-npc-info' })
        const title = el('div', { class: 'lh-npc-name' })
        title.textContent = name
        const blurb = el('div', { class: 'lh-npc-blurb' })
        blurb.textContent = text || 'No description'
        info.append(title, blurb)
        const buttons = el('div', { class: 'lh-npc-buttons' })
        const add = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'aria-label': `Add “${label}” as an NPC` }) as HTMLButtonElement
        add.textContent = '+ Add as is'
        add.title = addTitle
        const fit = el('button', { type: 'button', class: 'lh-button', 'aria-label': `Fit “${label}” into the story as an NPC` }) as HTMLButtonElement
        fit.textContent = '🤖 Fit into story'
        fit.title = 'The card rewritten to fit the current campaign, shown below to check before it is added.'
        const busy = !!running || !chatId
        add.disabled = fit.disabled = busy
        if (!chatId) add.title = fit.title = 'Open a chat first.'
        add.addEventListener('click', onAdd)
        fit.addEventListener('click', onFit)
        buttons.append(add, fit)
        row.append(info, buttons)
        return row
    }

    function drawLists(): void {
        libraryList.replaceChildren()
        if (recordsError) {
            const empty = el('div', { class: 'lh-npc-empty lh-world-note--error' })
            empty.textContent = `The library could not be read: ${reasonText(recordsError)}.`
            libraryList.append(empty)
        } else if (!records) {
            const empty = el('div', { class: 'lh-npc-empty' })
            empty.textContent = loading ? 'Loading the library…' : 'Open the fold to list the library.'
            libraryList.append(empty)
        } else {
            const filter = librarySearch.value.trim().toLowerCase()
            const filtered = filter ? records.filter((r) => r.name.toLowerCase().includes(filter)) : records
            if (!filtered.length) {
                const empty = el('div', { class: 'lh-npc-empty' })
                empty.textContent = records.length ? 'No cards match.' : 'The library is empty. Save a card in the NPC library fold, or import a package there.'
                libraryList.append(empty)
            }
            for (const record of filtered) {
                libraryList.append(pair(record.name, record.blurb.split('\n')[0] ?? '', record.name,
                    () => { begin({ kind: 'library', id: record.id }, 'add', record.name) },
                    () => { begin({ kind: 'library', id: record.id }, 'draft', record.name) },
                    'Copy this identity into the story as an NPC, with its keywords and portrait.'))
            }
        }

        cardList.replaceChildren()
        if (cardsError) {
            const empty = el('div', { class: 'lh-npc-empty lh-world-note--error' })
            empty.textContent = `The cards could not be listed: ${reasonText(cardsError)}.`
            cardList.append(empty)
            return
        }
        if (!cards) {
            const empty = el('div', { class: 'lh-npc-empty' })
            empty.textContent = loading ? 'Loading the cards…' : 'Open the fold to list your character cards.'
            cardList.append(empty)
            return
        }
        const filter = cardSearch.value.trim().toLowerCase()
        const filtered = filter ? cards.filter((card) => card.name.toLowerCase().includes(filter)) : cards
        if (!filtered.length) {
            const empty = el('div', { class: 'lh-npc-empty' })
            empty.textContent = cards.length ? 'No characters match.' : 'No characters found.'
            cardList.append(empty)
            return
        }
        const review = normalizeAddAsIsMode(mode.value) === 'ai_review'
        for (const card of filtered.slice(0, shown)) {
            cardList.append(pair(card.name, card.snippet, card.name,
                () => { begin({ kind: 'card', characterId: card.id }, 'add', card.name) },
                () => { begin({ kind: 'card', characterId: card.id }, 'draft', card.name) },
                review ? 'One model call fixes only world and era impossibilities, then the card goes in. Change this under Add as is.' : 'The card’s description goes in verbatim, wrapped in [CORE]. Change this under Add as is.'))
        }
        if (filtered.length > shown) {
            const more = el('button', { type: 'button', class: 'lh-button lh-button--quiet' }) as HTMLButtonElement
            more.textContent = `Show more (${Math.min(shown, filtered.length)} of ${filtered.length})`
            more.addEventListener('click', () => { shown += NPC_CARD_PAGE; drawLists() })
            cardList.append(more)
        }
    }

    function drawPreview(): void {
        preview.hidden = !drafted
        if (!drafted) return
        const { result } = drafted
        previewTitle.textContent = `✨ Generated NPC — ${result.name}`
        previewWarning.textContent = result.duplicate ? `⚠️ An NPC named “${result.name}” is already in the book. Change the name inside [[NPC: Name | …]] before adding.` : ''
        previewWarning.hidden = !result.duplicate
        previewHint.textContent = 'Read the drafted entry. Change what you like, then press Add NPC.'
        if (previewText.dataset.draft !== result.at + result.name) {
            previewText.value = result.tag ?? ''
            previewText.dataset.draft = result.at + result.name
        }
        previewText.disabled = !!running
        addDrafted.disabled = !!running || !chatId
        cancelDraft.disabled = !!running
    }

    function drawState(): void {
        const busy = !!running
        for (const control of [mode, cardSearch, librarySearch, freeformName.input, freeformDescription.input, custom.input, archetypeName.input, archetypeConcept.input]) control.disabled = busy
        for (const chip of chipButtons.values()) chip.disabled = busy
        freeformButton.disabled = archetypeButton.disabled = busy || !chatId
        freeformButton.title = archetypeButton.title = chatId ? '' : 'Open a chat first.'
        reloadCards.disabled = busy || !!loading
        live.hidden = !busy
        live.textContent = running
            ? running.what === 'add'
                ? `➕ Adding “${running.label}” to the NPC book…`
                : running.what === 'commit'
                    ? `➕ Adding “${running.label}”…`
                    : `🤖 Drafting an NPC from ${running.label === 'the description' ? running.label : `“${running.label}”`}… the entry appears below when it is ready.`
            : ''
        note.textContent = last?.text ?? ''
        note.classList.toggle('lh-world-note--error', !!last?.error)
        drawChips()
        drawPreview()
        drawLists()
    }

    drawState()

    return {
        root,
        applyPrefs(prefs) {
            if (prefs.npcAddAsIsMode !== undefined) {
                const value: AddAsIsMode = normalizeAddAsIsMode(prefs.npcAddAsIsMode)
                if (mode.value !== value) { mode.value = value; drawLists() }
            }
        },
        setChat(id) {
            if (id !== chatId) {
                chatId = id
                drafted = null
                last = null
            }
            drawState()
        },
        refresh: load,
        busy: () => !!running,
    }
}
