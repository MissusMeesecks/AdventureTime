/**
 * Instant Action (roadmap row 10, Phase 35a): the legacy's Quick Start.
 *
 * Pick a genre, roll a name or leave it to the model, write a line of setup
 * if you like, press Begin: a random class and a level of 1 to 10 are rolled,
 * the sheet is written into the tracker, and the opening message starts the
 * adventure. The legacy builds a Player Card and a name-only persona between
 * the sheet and the opening message; those join in 35b.
 *
 * The fold keeps the legacy's words: *Select a genre to begin*, *Fantasy
 * selected — name optional*, *Name ready — reroll or begin*. The class and
 * level are rolled in the backend, so the running line names only what the
 * fold knows, and the ready line names what came back.
 */

import type { InstantResult } from '../protocol.js'
import { INSTANT_GENRES, INSTANT_SETUP_MAX, normalizeInstantGenre, rollCreatorName, type CreatorGenre, type InstantGenre } from '../tracker/creator.js'
import { createCardWordsControl } from './card-words.js'
import { describeCardSteps, reasonText } from './player-card-fold.js'

export interface InstantFoldHost {
    el(tag: string, attrs?: Record<string, string>): HTMLElement
    /** Roll the character, write the sheet, and begin; the chat is the host's business. */
    begin(request: { genre: InstantGenre; name: string; setup: string; sendStarter: boolean; cardWords: number }): Promise<InstantResult>
    savePrefs(patch: Record<string, unknown>): Promise<void>
    /** Asked before a chat that already has a sheet is begun over (73d, departure 57); absent, it is begun. */
    confirm?(title: string, message: string, confirmLabel: string): Promise<boolean>
    fail(error: unknown): void
    /** Minutes-ago wording for a timestamp, the panel's own. */
    when(iso: string): string
    random?: () => number
}

export interface InstantPrefs {
    creatorSendStarter?: boolean
    creatorCardWords?: number
    /** Roll the level 1 to 10 instead of starting at 1 (45d). */
    creatorInstantRandomLevel?: boolean
}

export interface InstantFold {
    root: HTMLDetailsElement
    applyPrefs(prefs: InstantPrefs): void
    /** Which chat is open and whether its memo is empty; the fold opens itself on the first empty memo of a chat. */
    setChat(chatId: string | null, memoEmpty: boolean): void
    busy(): boolean
    /** The genre picked, or '' for none yet. */
    genre(): string
}

/** The genre's plain label: the legacy's `GENRE_LABELS`. */
export function instantGenreLabel(genre: string): string {
    const found = INSTANT_GENRES.find((g) => g.value === genre)
    // The label carries its emoji; the status line wants the word alone.
    return found ? found.label.replace(/^\S+\s+/, '') : genre
}

/** The status line after a run, in words. */
export function describeInstantResult(result: InstantResult, when: (iso: string) => string): string {
    const stamped = result.at ? when(result.at) : ''
    const tail = stamped ? ` Ran ${stamped}.` : ''
    if (result.status === 'ready') {
        const who = result.name || 'the character'
        const what = [result.className, result.level === null ? '' : `level ${result.level}`].filter(Boolean).join(', ')
        const sheet = `The sheet is in the tracker’s cards.`
        const steps = describeCardSteps(result)
        const next = result.started ? 'The adventure has begun.' : 'Type your first action.'
        return `Ready — ${who}${what ? ` (${what})` : ''}. ${sheet}${steps ? ` ${steps}` : ''} ${next}${tail}`
    }
    const rolled = result.className ? ` Rolled ${result.className}${result.level === null ? '' : `, level ${result.level}`}.` : ''
    return `Instant Action failed: ${reasonText(result.reason)}.${rolled}${tail}`
}

export const INSTANT_FOLD_CSS = `
/* Multihog's Instant Action box (83): bordered, the title and its sub-line centred, the genres two by two, Begin full width. */
.lh-instant { border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25))); border-radius: var(--lumiverse-radius, 8px); padding: 8px; background: rgba(0, 0, 0, 0.12); }
.lh-instant > summary { cursor: pointer; list-style: none; text-align: center; font-size: 0.95em; font-weight: 700; letter-spacing: 0.02em; position: relative; }
.lh-instant > summary::-webkit-details-marker { display: none; }
.lh-instant-body { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.lh-instant-sub { text-align: center; padding: 0 4px; }
.lh-instant-genres { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 2px; }
.lh-instant-genre { padding: 8px 10px; font-weight: 600; }
.lh-instant-genre.is-selected { outline: 2px solid var(--lh-accent, var(--lumiverse-primary, #d4a940)); outline-offset: -2px; background: var(--lh-accent-bg, rgba(212, 169, 64, 0.18)); }
.lh-instant-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.lh-instant-row .lh-input { flex: 1 1 10em; min-width: 0; }
.lh-instant-begin { width: 100%; padding: 8px 12px; font-weight: 700; }
.lh-instant-status { text-align: center; }
.lh-instant-field { display: flex; flex-direction: column; gap: 2px; }
.lh-instant-field > label { font-size: 0.78em; opacity: 0.75; }
.lh-instant-field textarea.lh-input { width: 100%; box-sizing: border-box; resize: vertical; font: inherit; font-size: 0.85em; }
.lh-instant-hint { font-size: 0.75em; opacity: 0.65; }
.lh-instant-switch { font-size: 0.8em; display: flex; gap: 6px; align-items: center; }
.lh-instant-status { font-size: 0.8em; opacity: 0.85; }
.lh-instant-status.lh-world-note--error { opacity: 1; }
.lh-instant [hidden] { display: none; }
`

export function createInstantFold(host: InstantFoldHost): InstantFold {
    const { el } = host
    const random = host.random ?? Math.random

    const root = el('details', { class: 'lh-instant' }) as HTMLDetailsElement
    // Multihog's box since 83: the title centred, its sub-line, the genres in a grid of two.
    const summary = el('summary', { class: 'lh-instant-title' })
    summary.textContent = '⚡ Instant Action'
    // Folded as it ships since 84 (the maintainer's ask), with the drawers' chevron at the title's right edge.
    const chevron = el('span', { class: 'lh-start-drawer-chevron lh-start-fold-chevron', 'aria-hidden': 'true' })
    chevron.textContent = '▸'
    summary.append(chevron)
    const body = el('div', { class: 'lh-instant-body' })
    const lead = el('div', { class: 'lh-world-lead lh-instant-sub' })
    lead.textContent = 'Choose a genre, optionally enter a name or an initial setup, then begin. Leave the name blank to let the model choose it. It uses your Narrator configuration, starts at level 1 with 0 XP unless Random level is on, rolls a class and whatever is left unspecified, writes the sheet into the tracker, and builds a Player Card plus a name-only persona. Untick Send the opening message if you want to type your own first action instead of letting the model open the campaign.'

    // ── the genres ───────────────────────────────────────────────────────
    const genres = el('div', { class: 'lh-instant-genres', role: 'group', 'aria-label': 'Instant Action genre' })
    const genreButtons = INSTANT_GENRES.map((g) => {
        const button = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-instant-genre', 'data-genre': g.value, 'aria-pressed': 'false' }) as HTMLButtonElement
        button.textContent = g.label
        genres.append(button)
        return button
    })

    // ── the name ─────────────────────────────────────────────────────────
    const nameRow = el('div', { class: 'lh-instant-row' })
    const name = el('input', { type: 'text', class: 'lh-input', 'data-lh-field': 'instant-name-input', placeholder: 'Optional — enter, roll, or let the model choose', autocomplete: 'off', 'aria-label': 'Instant Action character name' }) as HTMLInputElement
    const rollButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet' }) as HTMLButtonElement
    rollButton.textContent = '🎲 Roll name'
    rollButton.title = 'A name from the genre’s pool.'
    nameRow.append(name, rollButton)

    // ── the setup ────────────────────────────────────────────────────────
    const setupField = el('div', { class: 'lh-instant-field' })
    const setupLabel = el('label')
    setupLabel.textContent = 'Initial setup (optional)'
    const setupHint = el('div', { class: 'lh-instant-hint' })
    setupHint.textContent = 'Guide the character, setting, premise or tone. Anything left unsaid is still rolled. A level named here outranks the rolled one.'
    const setup = el('textarea', { class: 'lh-input', rows: '2', maxlength: String(INSTANT_SETUP_MAX), 'data-lh-field': 'instant-setup-input', placeholder: 'e.g. A 28-year-old ranger with a crossbow, starting in a storm-battered frontier town', 'aria-label': 'Instant Action initial setup' }) as HTMLTextAreaElement
    setupField.append(setupLabel, setupHint, setup)

    // ── the switch and the button ────────────────────────────────────────
    const cardRow = el('div', { class: 'lh-instant-row' })
    const cardLabel = el('span', { class: 'lh-instant-hint' })
    cardLabel.textContent = 'Player Card length'
    const cardWords = createCardWordsControl(el, 'instant-card-words', (n) => { host.savePrefs({ creatorCardWords: n }).catch(host.fail) })
    cardRow.append(cardLabel, cardWords.root)
    const options = el('div', { class: 'lh-instant-row' })
    const sendLabel = el('label', { class: 'lh-instant-switch', title: 'Ticked, the model opens the campaign as soon as the character is ready.' })
    const sendStarter = el('input', { type: 'checkbox', 'data-lh-field': 'instant-send-starter-input' }) as HTMLInputElement
    sendStarter.checked = true
    const sendText = el('span')
    sendText.textContent = 'Send the opening message'
    sendLabel.append(sendStarter, sendText)
    // Random level (45d, upstream 2026.8.73): the character starts at level 1 unless this is ticked.
    const randomLabel = el('label', { class: 'lh-instant-switch', title: 'Ticked, the character starts at a rolled level of 1 to 10, as Instant Action did before Multihog 2026.8.73. Unticked, level 1. A level named in the setup outranks either.' })
    const randomLevel = el('input', { type: 'checkbox', 'data-lh-field': 'instant-random-level-input' }) as HTMLInputElement
    randomLevel.checked = false
    const randomText = el('span')
    randomText.textContent = 'Random level (1–10)'
    randomLabel.append(randomLevel, randomText)
    const beginButton = el('button', { type: 'button', class: 'lh-button lh-instant-begin' }) as HTMLButtonElement
    beginButton.textContent = '⚡ Begin Instant Action'
    options.append(randomLabel, sendLabel)

    const status = el('div', { class: 'lh-instant-status' })
    body.append(lead, genres, nameRow, setupField, cardRow, options, beginButton, status)
    root.append(summary, body)

    let chatId: string | null = null
    let memoEmpty = true
    let selected: InstantGenre | '' = ''
    let running = false
    let last: InstantResult | null = null
    let message = 'Select a genre to begin'

    function drawState(): void {
        for (const button of genreButtons) {
            const on = button.dataset.genre === selected
            button.classList.toggle('is-selected', on)
            button.setAttribute('aria-pressed', String(on))
            button.disabled = running
        }
        rollButton.disabled = running || !selected
        beginButton.disabled = running || !selected || !chatId
        // A chat with a sheet says so on the button (73d, departure 57), before the confirm does.
        beginButton.title = !chatId ? 'Open a chat first.' : !selected ? 'Pick a genre first.' : !memoEmpty ? 'This chat already has a character sheet; Instant Action replaces it, and asks first.' : 'Roll the character, write the sheet, and begin.'
        name.disabled = running
        setup.disabled = running
        sendStarter.disabled = running
        cardWords.setDisabled(running)
        status.classList.toggle('lh-world-running', running)
        status.classList.toggle('lh-world-note--error', !running && last?.status === 'failed')
        status.textContent = running ? message : last ? describeInstantResult(last, host.when) : message
    }

    for (const button of genreButtons) {
        button.addEventListener('click', () => {
            if (running) return
            selected = normalizeInstantGenre(button.dataset.genre)
            last = null
            message = name.value.trim() ? 'Name ready — edit, reroll, or begin' : `${instantGenreLabel(selected)} selected — name optional`
            drawState()
        })
    }
    rollButton.addEventListener('click', () => {
        if (running || !selected) return
        name.value = rollCreatorName(selected as CreatorGenre, random)
        last = null
        message = 'Name ready — reroll or begin'
        drawState()
    })
    name.addEventListener('input', () => {
        if (running) return
        last = null
        if (name.value.trim()) message = 'Name ready — edit, reroll, or begin'
        else if (selected) message = 'Name blank — the model will choose'
        drawState()
    })
    sendStarter.addEventListener('change', () => { host.savePrefs({ creatorSendStarter: sendStarter.checked }).catch(host.fail) })
    randomLevel.addEventListener('change', () => { host.savePrefs({ creatorInstantRandomLevel: randomLevel.checked }).catch(host.fail) })

    beginButton.addEventListener('click', () => { begin().catch(host.fail) })

    /** Multihog allows Instant Action on an empty chat only (departure 57); here it asks instead, and replaces. */
    async function begin(): Promise<void> {
        if (running || !selected || !chatId) return
        if (!memoEmpty && host.confirm) {
            const ok = await host.confirm('Begin Instant Action', 'This chat already has a character sheet. Instant Action writes a new sheet over it, makes a new persona and Player Card, and sends the first message. Multihog allows this on an empty chat only.', 'Replace the sheet')
            if (!ok || running || !selected || !chatId) return
        }
        const genre = selected
        const request = { genre, name: name.value.trim(), setup: setup.value, sendStarter: sendStarter.checked, cardWords: cardWords.value() }
        running = true
        last = null
        message = `Creating the character (${[instantGenreLabel(genre), request.setup.trim() ? 'custom setup' : randomLevel.checked ? 'a rolled class and level' : 'a rolled class at level 1', request.name || 'a name of the model’s choosing'].join(' · ')})…`
        drawState()
        // The legacy remembers the genre as `onboardingGenre`; the other ways to begin (35c) start from it.
        host.savePrefs({ creatorGenre: genre }).catch(host.fail)
        host.begin(request)
            .then((result) => { last = result })
            .catch((error) => { last = { status: 'failed', at: new Date().toISOString(), genre, className: '', level: null, name: '', started: false, reason: error instanceof Error ? error.message : String(error) } })
            .finally(() => {
                running = false
                message = selected ? `${instantGenreLabel(selected)} selected — name optional` : 'Select a genre to begin'
                drawState()
            })
    }

    drawState()

    return {
        root,
        applyPrefs(prefs) {
            if (typeof prefs.creatorSendStarter === 'boolean') sendStarter.checked = prefs.creatorSendStarter
            if (typeof prefs.creatorInstantRandomLevel === 'boolean') randomLevel.checked = prefs.creatorInstantRandomLevel
            if (typeof prefs.creatorCardWords === 'number') cardWords.set(prefs.creatorCardWords)
        },
        setChat(id, empty) {
            chatId = id
            memoEmpty = empty
            // Folded whatever the chat holds since 84: the starting area opens for an empty memo (69), the box waits for the hand.
            if (!id) last = null
            drawState()
        },
        busy: () => running,
        genre: () => selected,
    }
}
