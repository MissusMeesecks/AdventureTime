/**
 * Import a character card (39, roadmap row 84).
 *
 * The legacy's Import Card panel under the archetype buttons: a search box
 * over the host's character cards, each with **Fit into Story** (the card
 * rewritten to fit the campaign) and **Add as is** (the card's writing kept,
 * only impossibilities fixed), a Player Card length that opens on *Same as
 * the card*, and the creator's two switches. One press imports: the sheet
 * through the tracker's pass, then the persona, then the Player Card from the
 * card's own text. The level, genre and gear tier are the creator's
 * preferences, shared with the other folds.
 *
 * The cards are fetched when the fold is first opened, and again on
 * **Reload the cards**; a host that has not granted the `characters`
 * permission says so in the list's place.
 */

import type { CardChoice, ImportResult } from '../protocol.js'
import { IMPORT_WORD_OPTIONS, normalizeCardWords } from '../tracker/creator.js'
import { describeCardSteps, reasonText } from './player-card-fold.js'

export interface ImportFoldHost {
    el(tag: string, attrs?: Record<string, string>): HTMLElement
    list(): Promise<{ cards: CardChoice[] }>
    importCard(request: { characterId: string; mode: 'minimal' | 'full'; cardWords: 'same' | number; playerCard: boolean; persona: boolean }): Promise<ImportResult>
    savePrefs(patch: Record<string, unknown>): Promise<void>
    fail(error: unknown): void
    when(iso: string): string
}

export interface ImportPrefs {
    creatorPlayerCard?: boolean
    creatorPersona?: boolean
}

export interface ImportFold {
    root: HTMLDetailsElement
    applyPrefs(prefs: ImportPrefs): void
    setChat(chatId: string | null): void
    /** Fetch the cards again. */
    refresh(): Promise<void>
    busy(): boolean
}

/** How many cards the list shows before *Show more*, as the legacy's. */
export const IMPORT_PAGE = 10

export function describeImportResult(result: ImportResult, when: (iso: string) => string): string {
    const stamped = result.at ? when(result.at) : ''
    const tail = stamped ? ` Ran ${stamped}.` : ''
    const how = result.mode === 'minimal' ? 'as is' : 'fitted into the story'
    if (result.status === 'written') {
        const blocks = [...(result.added ?? []), ...(result.replaced ?? [])]
        const who = result.name && result.name !== result.source ? ` as ${result.name}` : ''
        const steps = describeCardSteps(result)
        const portrait = result.portrait === true ? ' Their portrait is the card’s picture.' : result.portrait === false ? ' The card’s picture could not be placed as the portrait.' : ''
        return `Imported “${result.source || 'the card'}”${who}, ${how}${blocks.length ? `: ${blocks.join(', ')}` : ''}. The sheet is in the tracker’s cards.${steps ? ` ${steps}` : ''}${portrait}${tail}`
    }
    return `The card${result.source ? ` “${result.source}”` : ''} was not imported: ${reasonText(result.reason)}.${tail}`
}

export const IMPORT_FOLD_CSS = `
.lh-import > summary { cursor: pointer; font-size: 0.85em; opacity: 0.8; }
.lh-import-body { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.lh-import-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; font-size: 0.85em; }
.lh-import-row label { opacity: 0.75; white-space: nowrap; }
.lh-import-custom { width: 5em; }
.lh-import-list { display: flex; flex-direction: column; gap: 4px; max-height: 260px; overflow-y: auto; }
.lh-import-card { display: flex; align-items: center; gap: 8px; padding: 5px 7px; border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(255,255,255,0.12))); border-radius: 5px; }
.lh-import-info { flex: 1; min-width: 0; }
.lh-import-name { font-size: 0.85em; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lh-import-snippet { font-size: 0.75em; opacity: 0.55; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lh-import-buttons { display: flex; flex-direction: column; gap: 3px; flex: 0 0 auto; }
.lh-import-buttons .lh-button { font-size: 0.75em; padding: 2px 7px; white-space: nowrap; }
.lh-import-more { font-size: 0.8em; opacity: 0.6; text-align: center; }
.lh-import-empty { font-size: 0.8em; opacity: 0.6; padding: 4px 0; }
`

function option(el: ImportFoldHost['el'], value: string, label: string): HTMLOptionElement {
    const node = el('option', { value }) as HTMLOptionElement
    node.textContent = label
    return node
}

export function createImportFold(host: ImportFoldHost): ImportFold {
    const { el } = host

    const root = el('details', { class: 'lh-import' }) as HTMLDetailsElement
    const summary = el('summary')
    summary.textContent = 'Import a character card'
    const body = el('div', { class: 'lh-import-body' })
    const lead = el('div', { class: 'lh-world-lead' })
    lead.textContent = 'One of your character cards becomes the player. Add as is keeps the card’s writing and fixes only what the setting makes impossible; Fit into story rewrites it to belong in the campaign. The sheet is written first, then the persona and the Player Card as the switches say, with the creator’s level, genre and gear tier.'

    const wordsRow = el('div', { class: 'lh-import-row' })
    const wordsLabel = el('label')
    wordsLabel.textContent = 'Player Card length'
    const words = el('select', { class: 'lh-input', 'data-lh-field': 'import-words-input' }) as HTMLSelectElement
    for (const o of IMPORT_WORD_OPTIONS) words.append(option(el, String(o.value), o.label))
    words.append(option(el, 'custom', 'Custom…'))
    const custom = el('input', { type: 'number', class: 'lh-input lh-import-custom', min: '50', max: '5000', step: '25', value: '150', 'data-lh-field': 'import-words-custom-input', 'aria-label': 'Custom Player Card length' }) as HTMLInputElement
    custom.hidden = true
    const wordsNote = el('span')
    wordsNote.textContent = '(Fit into story only)'
    wordsRow.append(wordsLabel, words, custom, wordsNote)
    words.addEventListener('change', () => { custom.hidden = words.value !== 'custom'; if (!custom.hidden) custom.focus() })

    const switches = el('div', { class: 'lh-ways-switches' })
    const cardLabel = el('label', { class: 'lh-world-switch' })
    const playerCard = el('input', { type: 'checkbox', 'data-lh-field': 'import-player-card-input' }) as HTMLInputElement
    const cardText = el('span')
    cardText.textContent = 'Write a Player Card from the card (recommended)'
    cardLabel.append(playerCard, cardText)
    const personaLabel = el('label', { class: 'lh-world-switch' })
    const persona = el('input', { type: 'checkbox', 'data-lh-field': 'import-persona-input' }) as HTMLInputElement
    persona.checked = true
    const personaText = el('span')
    personaText.textContent = 'Create a persona with the character’s name (recommended)'
    personaLabel.append(persona, personaText)
    switches.append(cardLabel, personaLabel)
    playerCard.addEventListener('change', () => { host.savePrefs({ creatorPlayerCard: playerCard.checked }).catch(host.fail) })
    persona.addEventListener('change', () => { host.savePrefs({ creatorPersona: persona.checked }).catch(host.fail) })

    const searchRow = el('div', { class: 'lh-import-row' })
    const search = el('input', { type: 'search', class: 'lh-input', placeholder: 'Search characters…', 'data-lh-field': 'import-search-input', 'aria-label': 'Search characters' }) as HTMLInputElement
    const reload = el('button', { type: 'button', class: 'lh-button lh-button--quiet' }) as HTMLButtonElement
    reload.textContent = '↻ Reload the cards'
    searchRow.append(search, reload)
    const list = el('div', { class: 'lh-import-list', 'data-lh-field': 'import-list' })
    const live = el('div', { class: 'lh-world-running', hidden: 'hidden' })
    const note = el('div', { class: 'lh-world-note lh-import-note' })
    body.append(lead, wordsRow, switches, searchRow, list, live, note)
    root.append(summary, body)

    let chatId: string | null = null
    let cards: CardChoice[] | null = null
    let loading: Promise<void> | null = null
    let listError = ''
    let shown = IMPORT_PAGE
    let running: { name: string; mode: 'minimal' | 'full' } | null = null
    let last: ImportResult | null = null

    function wordsValue(): 'same' | number {
        if (words.value === 'same') return 'same'
        if (words.value === 'custom') return normalizeCardWords(custom.value)
        return normalizeCardWords(words.value)
    }

    function drawList(): void {
        list.replaceChildren()
        if (listError) {
            const empty = el('div', { class: 'lh-import-empty lh-world-note--error' })
            empty.textContent = `The cards could not be listed: ${reasonText(listError)}.`
            list.append(empty)
            return
        }
        if (!cards) {
            const empty = el('div', { class: 'lh-import-empty' })
            empty.textContent = loading ? 'Loading the cards…' : 'Open the fold to list your character cards.'
            list.append(empty)
            return
        }
        const filter = search.value.trim().toLowerCase()
        const filtered = filter ? cards.filter((card) => card.name.toLowerCase().includes(filter)) : cards
        if (!filtered.length) {
            const empty = el('div', { class: 'lh-import-empty' })
            empty.textContent = cards.length ? 'No characters match.' : 'No characters found.'
            list.append(empty)
            return
        }
        for (const card of filtered.slice(0, shown)) list.append(drawCard(card))
        if (filtered.length > shown) {
            const more = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-import-more' }) as HTMLButtonElement
            more.textContent = `Show more (${Math.min(shown, filtered.length)} of ${filtered.length})`
            more.addEventListener('click', () => { shown += IMPORT_PAGE; drawList() })
            list.append(more)
        }
    }

    function drawCard(card: CardChoice): HTMLElement {
        const row = el('div', { class: 'lh-import-card', 'data-lh-card': card.id })
        const info = el('div', { class: 'lh-import-info' })
        const name = el('div', { class: 'lh-import-name' })
        name.textContent = card.name
        const snippet = el('div', { class: 'lh-import-snippet' })
        snippet.textContent = card.snippet || 'No description'
        info.append(name, snippet)
        const buttons = el('div', { class: 'lh-import-buttons' })
        const fit = el('button', { type: 'button', class: 'lh-button', 'aria-label': `Fit “${card.name}” into the story` }) as HTMLButtonElement
        fit.textContent = '🤖 Fit into story'
        fit.title = 'Full adaptation: the character is rewritten to fit the current campaign setting.'
        const asIs = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'aria-label': `Add “${card.name}” as is` }) as HTMLButtonElement
        asIs.textContent = '📋 Add as is'
        asIs.title = 'Minimal review: only logical world or era impossibilities are fixed. The original writing is kept.'
        const busy = !!running || !chatId
        fit.disabled = busy
        asIs.disabled = busy
        if (!chatId) fit.title = asIs.title = 'Open a chat first.'
        fit.addEventListener('click', () => { begin(card, 'full') })
        asIs.addEventListener('click', () => { begin(card, 'minimal') })
        buttons.append(fit, asIs)
        row.append(info, buttons)
        return row
    }

    function drawState(): void {
        const busy = !!running
        for (const control of [words, custom, playerCard, persona, search]) control.disabled = busy
        reload.disabled = busy || !!loading
        live.hidden = !busy
        live.textContent = running ? `📥 Importing “${running.name}” (${running.mode === 'minimal' ? 'as is' : 'fitted into the story'})… the tracker’s cards fill in when the sheet is written.` : ''
        note.textContent = last ? describeImportResult(last, host.when) : ''
        note.classList.toggle('lh-world-note--error', last?.status === 'failed')
        drawList()
    }

    function begin(card: CardChoice, mode: 'minimal' | 'full'): void {
        if (running || !chatId) return
        running = { name: card.name, mode }
        last = null
        drawState()
        host.importCard({ characterId: card.id, mode, cardWords: wordsValue(), playerCard: playerCard.checked, persona: persona.checked })
            .then((result) => { last = result })
            .catch((error) => { last = { status: 'failed', at: new Date().toISOString(), name: card.name, source: card.name, mode, reason: error instanceof Error ? error.message : String(error) } })
            .finally(() => { running = null; drawState() })
    }

    async function load(): Promise<void> {
        if (loading) return loading
        loading = host.list()
            .then((result) => { cards = result.cards; listError = ''; shown = IMPORT_PAGE })
            .catch((error) => { cards = null; listError = error instanceof Error ? error.message : String(error) })
            .finally(() => { loading = null; drawState() })
        drawState()
        return loading
    }

    root.addEventListener('toggle', () => { if (root.open && !cards && !loading) { load().catch(host.fail) } })
    reload.addEventListener('click', () => { load().catch(host.fail) })
    search.addEventListener('input', () => { shown = IMPORT_PAGE; drawList() })

    drawState()

    return {
        root,
        applyPrefs(prefs) {
            if (typeof prefs.creatorPlayerCard === 'boolean') playerCard.checked = prefs.creatorPlayerCard
            if (typeof prefs.creatorPersona === 'boolean') persona.checked = prefs.creatorPersona
        },
        setChat(id) {
            chatId = id
            if (!id) last = null
            drawState()
        },
        refresh: load,
        busy: () => !!running,
    }
}
