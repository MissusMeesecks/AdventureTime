/**
 * The character editor's tab (Phase 48, roadmap row 48): *send to AdventureTime*.
 *
 * The host's character editor takes extension tabs. This one offers the card
 * being edited to AdventureTime three ways — the NPC creator's paths (41a) from the
 * editor instead of the fold, with the install's NPC library (41) as the
 * third destination:
 *
 * - **Save to the NPC library** keeps the card as is, outside any chat: the
 *   description and the personality in one `[CORE]`, the name and its first
 *   word as the keywords, the picture as the portrait. A name the library
 *   already keeps asks before it is replaced.
 * - **Add as is** writes it into the open chat's NPC book at once, verbatim
 *   or after the one review for the world the *Add as is* preference asks
 *   for — the same preference the NPC creator's fold shows.
 * - **Fit into story** drafts it against the open chat and shows the tag to
 *   check, and **Add NPC** writes it.
 *
 * What is read is the card as the host has saved it; the editor's unsaved
 * draft is the host's until it saves it. The open chat is whichever chat
 * the host has active while the editor is up.
 */

import type { CardChoice, LibraryRecordView, NpcAddResult, NpcDraftResult, NpcSource } from '../protocol.js'
import { normalizeAddAsIsMode, parseNpcTag, type AddAsIsMode } from '../tracker/npc-creator.js'
import { describeNpcAdd, describeNpcDraftFailure } from './npc-creator-fold.js'
import { reasonText } from './player-card-fold.js'

/** What the tab reads of the host's editor: whether it is up, and whose card. */
export interface EditorState {
    open: boolean
    characterId: string | null
}

export type LibrarySaveOutcome = LibraryRecordView | { status: 'exists'; name: string }

export interface EditorTabHost {
    el(tag: string, attrs?: Record<string, string>): HTMLElement
    /** The host's editor: its state now, and its changes. */
    editor: {
        getState(): EditorState
        onChange(handler: (state: EditorState) => void): () => void
    }
    /** The chat the host has active, nulls on the home screen. */
    activeChat(): { chatId: string | null; characterId: string | null }
    /** The host's cards, for the name of the one being edited. */
    cards(): Promise<{ cards: CardChoice[] }>
    prefs(): Promise<EditorTabPrefs>
    savePrefs(patch: Record<string, unknown>): Promise<void>
    saveCard(request: { characterId: string; overwrite?: boolean }): Promise<LibrarySaveOutcome>
    add(request: { chatId: string; source: NpcSource; narratorCharacterId?: string }): Promise<NpcAddResult>
    draft(request: { chatId: string; source: NpcSource; narratorCharacterId?: string }): Promise<NpcDraftResult>
    commit(request: { chatId: string; tag: string; name: string; how: NpcDraftResult['how']; portrait?: NpcSource }): Promise<NpcAddResult>
    /** Ask before a library card is replaced. Absent, a kept name is left alone. */
    confirm?(message: string): Promise<boolean>
    fail(error: unknown): void
    when(iso: string): string
}

export interface EditorTabPrefs {
    npcAddAsIsMode?: 'literal' | 'ai_review'
}

export interface EditorTab {
    root: HTMLElement
    applyPrefs(prefs: EditorTabPrefs): void
    /** Read the host's state again: the open chat changed under the editor. */
    refresh(): void
    busy(): boolean
    destroy(): void
}

/** The tab's help, shown by the host's guide viewer. */
export const EDITOR_TAB_GUIDE = `Send this character to AdventureTime.

**Save to the NPC library** keeps the card as it is saved, outside any chat: the description and the personality become the NPC's \`[CORE]\` identity, the name its keyword, the picture its portrait. From the NPC library fold it can join any campaign's party, be played as the player character, or be added to a campaign's NPC book.

**Add as is** writes the card into the open chat's NPC book at once, so the lorebook agent reads it from then on — verbatim, or after one model call that fixes only world and era impossibilities; the *Add as is* box says which.

**Fit into story** asks a model to rewrite the card to fit the open chat's campaign and shows the entry here to check before **Add NPC** writes it.

What is sent is the card as saved; save the editor first if you changed it.`

export function describeLibrarySave(result: LibrarySaveOutcome): string {
    if ('status' in result) return `“${result.name}” is already in the NPC library; nothing was saved.`
    return `Saved “${result.name}” to the NPC library${result.portraitPath ? ' with its portrait' : ''}. The NPC library fold puts them into play.`
}

export const EDITOR_TAB_CSS = `
.lh-editor-tab { gap: 10px; }
.lh-editor-title { font-size: 1em; font-weight: 600; }
.lh-editor-section { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(255,255,255,0.12))); border-radius: 6px; }
.lh-editor-section-title { font-size: 0.85em; font-weight: 600; }
.lh-editor-chat { font-size: 0.8em; opacity: 0.75; }
`

function option(el: EditorTabHost['el'], value: string, label: string): HTMLOptionElement {
    const node = el('option', { value }) as HTMLOptionElement
    node.textContent = label
    return node
}

export function mountEditorTab(root: HTMLElement, host: EditorTabHost): EditorTab {
    const { el } = host
    // The panel's root class (lesson 56): every rule in PANEL_CSS is scoped to it.
    root.classList.add('adventuretime-panel', 'lh-editor-tab')
    root.replaceChildren()

    const title = el('div', { class: 'lh-editor-title', 'data-lh-field': 'editor-title' })
    const lead = el('div', { class: 'lh-world-lead' })
    lead.textContent = 'The card as it is saved: its description and personality become an NPC’s [CORE] identity, its name the keyword, its picture the portrait. Keep it in the NPC library, outside any chat, or add it to the open chat’s NPC book, where the lorebook agent reads it from then on.'

    // ── The NPC library ───────────────────────────────────────────────────
    const librarySection = el('div', { class: 'lh-editor-section' })
    const libraryTitle = el('div', { class: 'lh-editor-section-title' })
    libraryTitle.textContent = 'The NPC library'
    const libraryHint = el('div', { class: 'lh-world-lead' })
    libraryHint.textContent = 'As is, with the picture. A name the library already keeps asks before it is replaced.'
    const saveLibrary = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'editor-save-library' }) as HTMLButtonElement
    saveLibrary.textContent = '📚 Save to the NPC library'
    librarySection.append(libraryTitle, libraryHint, saveLibrary)

    // ── The open chat ─────────────────────────────────────────────────────
    const chatSection = el('div', { class: 'lh-editor-section' })
    const chatTitle = el('div', { class: 'lh-editor-section-title' })
    chatTitle.textContent = 'The open chat’s NPC book'
    const chatLine = el('div', { class: 'lh-editor-chat', 'data-lh-field': 'editor-chat-line' })
    const modeRow = el('div', { class: 'lh-npc-mode' })
    const modeLabel = el('label')
    modeLabel.textContent = 'Add as is'
    const mode = el('select', { class: 'lh-input', 'data-lh-field': 'editor-mode-input', 'aria-label': 'What Add as is does with the card' }) as HTMLSelectElement
    mode.append(option(el, 'ai_review', 'reviews the card for the world first'), option(el, 'literal', 'copies the card verbatim'))
    mode.value = 'ai_review'
    mode.addEventListener('change', () => { host.savePrefs({ npcAddAsIsMode: normalizeAddAsIsMode(mode.value) }).catch(host.fail); draw() })
    modeRow.append(modeLabel, mode)
    const chatButtons = el('div', { class: 'lh-npc-buttons' })
    const add = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'editor-add' }) as HTMLButtonElement
    add.textContent = '+ Add as is'
    const fit = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'editor-fit' }) as HTMLButtonElement
    fit.textContent = '🤖 Fit into story'
    chatButtons.append(add, fit)
    chatSection.append(chatTitle, chatLine, modeRow, chatButtons)

    // ── The preview, the live line and the note ───────────────────────────
    const preview = el('div', { class: 'lh-npc-preview', 'data-lh-field': 'editor-preview' })
    preview.hidden = true
    const previewTitle = el('div', { class: 'lh-npc-preview-title' })
    const previewWarning = el('div', { class: 'lh-npc-warning' })
    const previewHint = el('div', { class: 'lh-world-lead' })
    previewHint.textContent = 'Read the drafted entry. Change what you like, then press Add NPC.'
    const previewText = el('textarea', { class: 'lh-input', rows: '8', 'data-lh-field': 'editor-preview-input', 'aria-label': 'The drafted entry' }) as HTMLTextAreaElement
    const previewButtons = el('div', { class: 'lh-npc-buttons' })
    const commit = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'editor-commit' }) as HTMLButtonElement
    commit.textContent = '✅ Add NPC'
    const cancel = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'editor-cancel' }) as HTMLButtonElement
    cancel.textContent = 'Cancel'
    previewButtons.append(commit, cancel)
    preview.append(previewTitle, previewWarning, previewHint, previewText, previewButtons)
    const live = el('div', { class: 'lh-world-running', hidden: 'hidden' })
    const note = el('div', { class: 'lh-world-note lh-editor-note' })

    root.append(title, lead, librarySection, chatSection, preview, live, note)

    // ── State ─────────────────────────────────────────────────────────────
    let characterId: string | null = null
    let cards: CardChoice[] | null = null
    let loading: Promise<void> | null = null
    /** The card last looked for in the list, so a card the list lacks is looked up once, not on every change. */
    let lookedUp: string | null = null
    let prefsRead = false
    let running: { what: 'library' | 'add' | 'draft' | 'commit'; label: string } | null = null
    let drafted: NpcDraftResult | null = null
    let last: { text: string; error: boolean } | null = null

    function name(): string {
        return (characterId && cards?.find((card) => card.id === characterId)?.name) || 'this character'
    }

    function say(text: string, error = false): void {
        last = { text, error }
        draw()
    }

    /** The cards for the name, and the preference, once. A failed read costs the name and nothing else: the actions say why themselves. */
    function load(): Promise<void> {
        if (loading) return loading
        lookedUp = characterId
        loading = Promise.all([
            host.cards().then((result) => { cards = result.cards }).catch(() => { cards = cards ?? [] }),
            prefsRead ? Promise.resolve() : host.prefs().then((prefs) => { prefsRead = true; applyPrefs(prefs) }).catch(() => undefined),
        ])
            .then(() => undefined)
            .finally(() => { loading = null; draw() })
        draw()
        return loading
    }

    function applyPrefs(prefs: EditorTabPrefs): void {
        if (prefs.npcAddAsIsMode !== undefined) {
            const value: AddAsIsMode = normalizeAddAsIsMode(prefs.npcAddAsIsMode)
            if (mode.value !== value) { mode.value = value; draw() }
        }
    }

    function source(): NpcSource | null {
        return characterId ? { kind: 'card', characterId } : null
    }

    function describeError(error: unknown): string {
        return reasonText(error instanceof Error ? error.message : String(error))
    }

    function saveToLibrary(): void {
        const id = characterId
        if (running || !id) return
        running = { what: 'library', label: name() }
        last = null
        draw()
        const attempt = async (): Promise<void> => {
            const result = await host.saveCard({ characterId: id })
            if ('status' in result && host.confirm && await host.confirm(`The NPC library already has “${result.name}”. Replace it with this card?`)) {
                last = { text: describeLibrarySave(await host.saveCard({ characterId: id, overwrite: true })), error: false }
                return
            }
            last = { text: describeLibrarySave(result), error: false }
        }
        attempt()
            .catch((error) => { last = { text: `The card was not saved: ${describeError(error)}.`, error: true } })
            .finally(() => { running = null; draw() })
    }

    /** The open chat's id and narrator at the press, as the fold reads them at its own. */
    function chat(): { chatId: string; narratorCharacterId?: string } | null {
        const active = host.activeChat()
        if (!active.chatId) return null
        return { chatId: active.chatId, ...(active.characterId ? { narratorCharacterId: active.characterId } : {}) }
    }

    function begin(what: 'add' | 'draft'): void {
        const from = source()
        const target = chat()
        if (running || !from || !target) return
        running = { what, label: name() }
        last = null
        if (what === 'draft') drafted = null
        draw()
        const call = what === 'add'
            ? host.add({ ...target, source: from }).then((result) => { last = { text: describeNpcAdd(result, host.when), error: result.status !== 'added' } })
            : host.draft({ ...target, source: from }).then((result) => {
                if (result.status === 'drafted') {
                    drafted = result
                    last = { text: `Drafted “${result.name}” — read it below, change what you like, then press Add NPC.`, error: false }
                } else {
                    last = { text: describeNpcDraftFailure(result, host.when), error: true }
                }
            })
        call
            .catch((error) => { last = { text: `${what === 'add' ? 'The NPC was not added' : 'Nothing was drafted'}: ${describeError(error)}.`, error: true } })
            .finally(() => { running = null; draw() })
    }

    function commitDraft(): void {
        const from = source()
        const target = chat()
        if (running || !from || !target || !drafted) return
        const tag = previewText.value
        const npcName = parseNpcTag(tag)?.name || drafted.name
        running = { what: 'commit', label: npcName }
        last = null
        draw()
        host.commit({ chatId: target.chatId, tag, name: npcName, how: drafted.how, portrait: from })
            .then((result) => {
                last = { text: describeNpcAdd(result, host.when), error: result.status !== 'added' }
                if (result.status === 'added') drafted = null
            })
            .catch((error) => { last = { text: `The NPC was not added: ${describeError(error)}.`, error: true } })
            .finally(() => { running = null; draw() })
    }

    saveLibrary.addEventListener('click', saveToLibrary)
    add.addEventListener('click', () => { begin('add') })
    fit.addEventListener('click', () => { begin('draft') })
    commit.addEventListener('click', commitDraft)
    cancel.addEventListener('click', () => { drafted = null; draw() })

    /** The editor's state: a new card forgets the draft and the note; an open editor reads the cards for the name. */
    function take(state: EditorState): void {
        if (state.characterId !== characterId) {
            characterId = state.characterId
            drafted = null
            last = null
        }
        if (state.open && characterId && !loading && (!cards || (lookedUp !== characterId && !cards.some((card) => card.id === characterId)))) load().catch(host.fail)
        draw()
    }

    // ── Drawing ───────────────────────────────────────────────────────────
    function draw(): void {
        const busy = !!running
        const who = name()
        title.textContent = `Send “${who}” to AdventureTime`
        const active = host.activeChat()
        const own = !!characterId && active.characterId === characterId
        chatLine.textContent = !active.chatId
            ? 'No chat is open. Open the chat whose NPC book should take the character, then come back here.'
            : `The character goes into the open chat’s NPC book, where the lorebook agent reads it from then on.${own ? ' This is the open chat’s own character.' : ''}`
        saveLibrary.disabled = busy || !characterId
        saveLibrary.title = characterId ? 'Keep the card as is in the NPC library, with its picture as the portrait.' : 'Open a character in the editor first.'
        const noChat = !active.chatId
        add.disabled = fit.disabled = busy || !characterId || noChat
        const review = normalizeAddAsIsMode(mode.value) === 'ai_review'
        add.title = noChat ? 'Open a chat first.' : review ? 'One model call fixes only world and era impossibilities, then the card goes in. Change this under Add as is.' : 'The card’s description goes in verbatim, wrapped in [CORE]. Change this under Add as is.'
        fit.title = noChat ? 'Open a chat first.' : 'The card rewritten to fit the open chat’s campaign, shown below to check before it is added.'
        mode.disabled = busy
        live.hidden = !busy
        live.textContent = running
            ? running.what === 'library'
                ? `📚 Saving “${running.label}” to the NPC library…`
                : running.what === 'add'
                    ? `➕ Adding “${running.label}” to the NPC book…`
                    : running.what === 'commit'
                        ? `➕ Adding “${running.label}”…`
                        : `🤖 Drafting an NPC from “${running.label}”… the entry appears below when it is ready.`
            : ''
        note.textContent = last?.text ?? ''
        note.classList.toggle('lh-world-note--error', !!last?.error)

        preview.hidden = !drafted
        if (drafted) {
            previewTitle.textContent = `✨ Generated NPC — ${drafted.name}`
            previewWarning.textContent = drafted.duplicate ? `⚠️ An NPC named “${drafted.name}” is already in the book. Change the name inside [[NPC: Name | …]] before adding.` : ''
            previewWarning.hidden = !drafted.duplicate
            if (previewText.dataset.draft !== drafted.at + drafted.name) {
                previewText.value = drafted.tag ?? ''
                previewText.dataset.draft = drafted.at + drafted.name
            }
            previewText.disabled = busy
            commit.disabled = busy || noChat
            cancel.disabled = busy
        }
    }

    const unsubscribe = host.editor.onChange(take)
    take(host.editor.getState())

    return {
        root,
        applyPrefs,
        refresh: () => { take(host.editor.getState()) },
        busy: () => !!running,
        destroy: () => { unsubscribe(); root.replaceChildren() },
    }
}
