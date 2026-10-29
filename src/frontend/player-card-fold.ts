/**
 * The Player Card fold (roadmap row 10, Phase 35b).
 *
 * The legacy shows the Player Card at the top of the Lorebook Agent's
 * catalogue, with a popup to read it in sections, edit the text, regenerate
 * it, or unlink it, and a preview overlay when the creator writes one. Here
 * it is one fold under the creator: the card in its sections, the text
 * editable, written from the sheet or pasted, removed, and the persona
 * made from it. The fold never opens itself: the creator and Instant Action
 * write the card for you and say so in their own notes.
 */

import type { CardResult, PersonaResult, PlayerCardView } from '../protocol.js'
import { parseCardSections } from '../tracker/creator.js'
import { createCardWordsControl } from './card-words.js'

export interface PlayerCardFoldHost {
    el(tag: string, attrs?: Record<string, string>): HTMLElement
    load(): Promise<PlayerCardView>
    write(request: { name: string; words: number }): Promise<CardResult>
    save(request: { name: string; bio: string }): Promise<CardResult>
    remove(): Promise<void>
    persona(request: { name: string }): Promise<PersonaResult>
    savePrefs(patch: Record<string, unknown>): Promise<void>
    fail(error: unknown): void
    when(iso: string): string
    /** Ask before replacing or removing a card; absent, it is done. */
    confirm?(message: string): Promise<boolean>
    /** Edit with AI (78c, Multihog's): the card as it stands and the instructions; the whole revised card back, for review. Absent, no button. */
    aiEdit?(content: string, instructions: string): Promise<{ text: string }>
}

export interface PlayerCardFold {
    root: HTMLDetailsElement
    /** Which chat is open; the card is read afresh. */
    setChat(chatId: string | null): void
    /** Read the card again: after the creator or Instant Action wrote one. */
    refresh(): void
    applyPrefs(prefs: { creatorCardWords?: number }): void
    /** Open the editor, as the Edit button does (78b: the records' ✎ on the PC card). */
    edit(): void
    busy(): boolean
}

/** A reason as a sentence's end: the legacy's reasons carry their own full stop, ours do not. */
export function reasonText(reason: string | undefined): string {
    return (reason ?? 'no reason given').trim().replace(/\.$/, '')
}

/** The creator's and Instant Action's card and persona steps, in words, for their notes. */
export function describeCardSteps(result: { card?: CardResult; persona?: PersonaResult }): string {
    const parts: string[] = []
    if (result.card) {
        parts.push(result.card.status === 'written'
            ? `The Player Card is written${result.card.words ? ` (${result.card.words} words)` : ''}; it is in the Player Card fold.`
            : `The Player Card was not written: ${reasonText(result.card.reason)}.`)
    }
    if (result.persona) {
        parts.push(result.persona.status === 'active'
            ? `The persona “${result.persona.name}” is ${result.persona.created ? 'made and active; if Lumiverse’s persona picker does not list it yet, press its refresh button' : 'active'}.`
            : `The persona could not be made: ${reasonText(result.persona.reason)}.`)
    }
    return parts.join(' ')
}

/** The status line over the card. */
export function describeCard(view: PlayerCardView, when: (iso: string) => string): string {
    if (!view.card) return 'No Player Card for this chat. Write one from the sheet in the tracker’s cards, or paste one here.'
    const sections = parseCardSections(view.card.bio).filter((s) => s.label).length
    const words = view.card.bio.split(/\s+/).filter(Boolean).length
    const stamp = view.card.at ? ` ${when(view.card.at)}` : ''
    return `${view.card.name}’s card: ${sections} section${sections === 1 ? '' : 's'}, ${words} words, written${stamp}. The narrator sees it as [PLAYER_CHARACTER].`
}

/** The persona line under it. */
export function describePersona(view: PlayerCardView): string {
    if (!view.personasAvailable) return 'This build cannot make personas: the host has not granted the personas permission.'
    const name = view.card?.name ?? view.persona?.name ?? ''
    if (view.activePersona && name && view.activePersona.trim().toLowerCase() === name.trim().toLowerCase()) {
        return view.activeDescribed
            ? `The persona “${view.activePersona}” is active, and carries a description of its own: Lumiverse sends that beside the card, so empty it in Lumiverse if the two disagree.`
            : `The persona “${view.activePersona}” is active: your messages carry the character’s name.`
    }
    if (view.activePersona) return `The active persona is “${view.activePersona}”, not the character. Use as persona switches to one with the character’s name.`
    return view.persona ? `The persona “${view.persona.name}” was made for this character; none is active now.` : 'No persona made for this character yet.'
}

export const PLAYER_CARD_FOLD_CSS = `
.lh-player-card > summary { cursor: pointer; font-size: 0.85em; opacity: 0.8; }
.lh-player-card-body { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.lh-card-status, .lh-card-persona { font-size: 0.8em; opacity: 0.85; }
.lh-card-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.lh-card-row .lh-input[type="text"] { flex: 1 1 10em; min-width: 0; }
.lh-card-words { display: inline-flex; gap: 4px; align-items: center; }
.lh-card-words input[type="number"] { width: 5.5em; }
.lh-card-sections { display: flex; flex-direction: column; gap: 4px; font-size: 0.85em; padding: 6px 8px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 4px; }
.lh-card-section > b { display: block; font-size: 0.85em; opacity: 0.75; text-transform: uppercase; letter-spacing: 0.04em; }
.lh-card-section > div { white-space: pre-wrap; }
.lh-card-editor textarea.lh-input { width: 100%; box-sizing: border-box; min-height: 12em; resize: vertical; font: inherit; font-size: 0.85em; }
.lh-card-ai { display: flex; flex-direction: column; gap: 6px; }
.lh-card-ai-head { font-size: 0.75em; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; opacity: 0.8; }
.lh-card-ai textarea.lh-input { width: 100%; box-sizing: border-box; resize: vertical; font: inherit; font-size: 0.85em; }
.lh-card-ai-instructions { min-height: 5em; }
.lh-card-ai-preview { min-height: 14em; font-family: ui-monospace, monospace; }
.lh-card-ai-review { display: flex; flex-direction: column; gap: 6px; }
.lh-player-card [hidden] { display: none; }
.lh-card-note:empty { display: none; }
`

export function createPlayerCardFold(host: PlayerCardFoldHost): PlayerCardFold {
    const { el } = host
    const root = el('details', { class: 'lh-player-card' }) as HTMLDetailsElement
    const summary = el('summary')
    summary.textContent = 'Player Card'
    const body = el('div', { class: 'lh-player-card-body' })
    const lead = el('div', { class: 'lh-world-lead' })
    lead.textContent = 'The character’s biography in the Player Card’s sections — species, body, worn gear, personality, background, habits, strengths, flaws — written from the sheet by one model call and kept with this chat. The narrator sees it every turn; the agent may update its Body and Worn Equipment as the story changes them. A persona with the character’s name makes your messages carry it.'
    const status = el('div', { class: 'lh-card-status' })
    const personaLine = el('div', { class: 'lh-card-persona' })

    const controls = el('div', { class: 'lh-card-row' })
    const name = el('input', { type: 'text', class: 'lh-input', 'data-lh-field': 'card-name-input', placeholder: 'The character’s name (blank: the sheet’s)', 'aria-label': 'Player Card name' }) as HTMLInputElement
    const words = createCardWordsControl(el, 'card-words', (n) => { host.savePrefs({ creatorCardWords: n }).catch(host.fail) })
    controls.append(name, words.root)

    const buttons = el('div', { class: 'lh-world-buttons' })
    const writeButton = el('button', { type: 'button', class: 'lh-button' }) as HTMLButtonElement
    writeButton.textContent = 'Write the card'
    const personaButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet' }) as HTMLButtonElement
    personaButton.textContent = 'Use as persona'
    const editButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet' }) as HTMLButtonElement
    editButton.textContent = 'Edit the text'
    const removeButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet' }) as HTMLButtonElement
    removeButton.textContent = 'Remove'
    buttons.append(writeButton, personaButton, editButton, removeButton)

    const sections = el('div', { class: 'lh-card-sections' })
    const editor = el('div', { class: 'lh-card-editor' })
    const bio = el('textarea', { class: 'lh-input', rows: '12', 'data-lh-field': 'card-bio-input', placeholder: 'Species: …\nBody: …\nWorn Equipment: …\nPersonality: …', 'aria-label': 'Player Card text' }) as HTMLTextAreaElement
    const aiButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'card-ai-edit', title: 'Describe the changes; one model call rewrites the whole card for you to review before it is kept.' }) as HTMLButtonElement
    aiButton.textContent = '✨ Edit with AI'
    aiButton.hidden = !host.aiEdit
    buttons.append(aiButton)
    const editorButtons = el('div', { class: 'lh-world-buttons' })
    const saveButton = el('button', { type: 'button', class: 'lh-button' }) as HTMLButtonElement
    saveButton.textContent = 'Save'
    const cancelButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet' }) as HTMLButtonElement
    cancelButton.textContent = 'Cancel'
    editorButtons.append(saveButton, cancelButton)
    editor.append(bio, editorButtons)

    // Edit with AI (78c): Multihog's request pane, then the revised card to review, regenerate or apply.
    const aiPane = el('div', { class: 'lh-card-ai', 'data-lh-field': 'card-ai-pane' })
    const aiHead = el('div', { class: 'lh-card-ai-head' })
    aiHead.textContent = '✨ AI Edit Request'
    const aiInstructions = el('textarea', { class: 'lh-input lh-card-ai-instructions', rows: '4', spellcheck: 'true', 'data-lh-field': 'card-ai-instructions', 'aria-label': 'What to change on the Player Card', placeholder: 'Describe what you want changed or iterated on… e.g. \'Make her backstory more tragic\' or \'Add a rivalry with the player character\'' }) as HTMLTextAreaElement
    const aiButtons = el('div', { class: 'lh-world-buttons' })
    const aiCancelButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'card-ai-cancel' }) as HTMLButtonElement
    aiCancelButton.textContent = 'Cancel'
    const aiGenerateButton = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'card-ai-generate' }) as HTMLButtonElement
    aiGenerateButton.textContent = '✨ Generate'
    aiButtons.append(aiCancelButton, aiGenerateButton)
    const aiReview = el('div', { class: 'lh-card-ai-review', hidden: 'hidden' })
    const aiReviewHead = el('div', { class: 'lh-card-ai-head' })
    aiReviewHead.textContent = '📝 The revised card — edit it here before applying'
    const aiPreview = el('textarea', { class: 'lh-input lh-card-ai-preview', rows: '14', spellcheck: 'false', 'data-lh-field': 'card-ai-preview', 'aria-label': 'The revised Player Card' }) as HTMLTextAreaElement
    const aiReviewButtons = el('div', { class: 'lh-world-buttons' })
    const aiRegenButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'card-ai-regen' }) as HTMLButtonElement
    aiRegenButton.textContent = '🔄 Regenerate'
    const aiApplyButton = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'card-ai-apply' }) as HTMLButtonElement
    aiApplyButton.textContent = '✅ Apply'
    aiReviewButtons.append(aiRegenButton, aiApplyButton)
    aiReview.append(aiReviewHead, aiPreview, aiReviewButtons)
    aiPane.append(aiHead, aiInstructions, aiButtons, aiReview)

    const live = el('div', { class: 'lh-world-running', hidden: 'hidden' })
    const note = el('div', { class: 'lh-world-note lh-card-note' })
    body.append(lead, status, personaLine, controls, buttons, sections, editor, aiPane, live, note)
    root.append(summary, body)

    let chatId: string | null = null
    let view: PlayerCardView = { card: null, persona: null, personasAvailable: true, activePersona: '', activeDescribed: false }
    let running: '' | 'writing' | 'persona' | 'saving' | 'generating' = ''
    let editing = false
    let aiEditing = false
    let noteText = ''
    let noteError = false
    let loadSeq = 0

    function drawSections(): void {
        sections.replaceChildren()
        if (!view.card) { sections.hidden = true; return }
        const parsed = parseCardSections(view.card.bio)
        for (const section of parsed) {
            const block = el('div', { class: 'lh-card-section' })
            if (section.label) {
                const label = el('b')
                label.textContent = section.label
                block.append(label)
            }
            const text = el('div')
            text.textContent = section.text
            block.append(text)
            sections.append(block)
        }
        sections.hidden = parsed.length === 0 || editing || aiEditing
    }

    function drawState(): void {
        const busy = running !== ''
        status.textContent = chatId ? describeCard(view, host.when) : 'Open a chat first.'
        personaLine.textContent = chatId ? describePersona(view) : ''
        personaLine.hidden = !chatId
        name.disabled = busy
        words.setDisabled(busy)
        writeButton.disabled = busy || !chatId
        writeButton.textContent = view.card ? 'Write the card again' : 'Write the card'
        writeButton.title = chatId ? 'One model call writes the card from the sheet in the tracker’s cards.' : 'Open a chat first.'
        personaButton.disabled = busy || !chatId || !view.personasAvailable
        personaButton.title = view.personasAvailable ? 'A persona with the character’s name, found or made, and switched to.' : 'The host has not granted the personas permission.'
        editButton.disabled = busy || !chatId
        editButton.textContent = view.card ? 'Edit the text' : 'Paste a card'
        editButton.hidden = editing || aiEditing
        removeButton.disabled = busy || !chatId || !view.card
        removeButton.hidden = editing || aiEditing
        aiButton.disabled = busy || !chatId || !view.card
        aiButton.hidden = !host.aiEdit || editing || aiEditing
        editor.hidden = !editing
        aiPane.hidden = !aiEditing
        aiInstructions.disabled = busy
        aiCancelButton.disabled = busy
        aiGenerateButton.disabled = busy
        aiGenerateButton.textContent = running === 'generating' ? '⏳ Generating…' : '✨ Generate'
        aiRegenButton.disabled = busy
        aiApplyButton.disabled = busy
        saveButton.disabled = busy
        cancelButton.disabled = busy
        drawSections()
        live.hidden = !busy
        live.textContent = running === 'writing' ? 'Writing the Player Card now. One model call…' : running === 'persona' ? 'Making the persona…' : running === 'saving' ? 'Saving…' : running === 'generating' ? 'Rewriting the Player Card with AI. One model call…' : ''
        note.textContent = noteText
        note.classList.toggle('lh-world-note--error', noteError)
    }

    function load(): void {
        if (!chatId) { view = { card: null, persona: null, personasAvailable: true, activePersona: '', activeDescribed: false }; drawState(); return }
        const seq = ++loadSeq
        host.load().then((loaded) => {
            if (seq !== loadSeq) return
            view = loaded
            if (!editing && !name.value.trim() && loaded.card) name.value = loaded.card.name
            drawState()
        }).catch((error) => { if (seq === loadSeq) host.fail(error) })
    }

    const run = <T>(what: typeof running, work: () => Promise<T>, then: (result: T) => void): void => {
        if (running || !chatId) return
        running = what
        noteText = ''
        noteError = false
        drawState()
        work()
            .then(then)
            .catch((error) => { noteText = error instanceof Error ? error.message : String(error); noteError = true })
            .finally(() => { running = ''; drawState(); load() })
    }

    writeButton.addEventListener('click', () => {
        if (running || !chatId) return
        const proceed = view.card && host.confirm ? host.confirm(`Replace the Player Card for “${view.card.name}” with one written afresh from the sheet?`) : Promise.resolve(true)
        proceed.then((ok) => {
            if (!ok) return
            run('writing', () => host.write({ name: name.value.trim(), words: words.value() }), (result) => {
                noteText = result.status === 'written'
                    ? `Wrote the Player Card for ${result.name}${result.words ? ` (${result.words} words)` : ''}.${result.at ? ` Ran ${host.when(result.at)}.` : ''}`
                    : `The Player Card was not written: ${reasonText(result.reason)}.${result.at ? ` Ran ${host.when(result.at)}.` : ''}`
                noteError = result.status !== 'written'
            })
        }).catch(host.fail)
    })
    personaButton.addEventListener('click', () => {
        run('persona', () => host.persona({ name: name.value.trim() }), (result) => {
            noteText = result.status === 'active'
                ? `The persona “${result.name}” is ${result.created ? 'made and active; if Lumiverse’s persona picker does not list it yet, press its refresh button' : 'active'}.`
                : `The persona could not be made: ${reasonText(result.reason)}.`
            noteError = result.status !== 'active'
        })
    })
    function startEditing(): void {
        if (running || !chatId) return
        editing = true
        aiEditing = false
        bio.value = view.card?.bio ?? ''
        if (view.card) name.value = view.card.name
        drawState()
        bio.focus()
    }
    editButton.addEventListener('click', startEditing)
    aiButton.addEventListener('click', () => {
        if (running || !chatId || !view.card || !host.aiEdit) return
        aiEditing = true
        aiInstructions.value = ''
        aiReview.hidden = true
        aiPreview.value = ''
        drawState()
        aiInstructions.focus()
    })
    aiCancelButton.addEventListener('click', () => { aiEditing = false; drawState() })
    const generate = (): void => {
        if (!host.aiEdit || !view.card) return
        const asked = aiInstructions.value.trim()
        // The legacy's toast, in its words, before any call.
        if (!asked) { noteText = 'Please describe what you want changed.'; noteError = true; drawState(); aiInstructions.focus(); return }
        const current = view.card.bio
        run('generating', () => host.aiEdit!(current, asked), (result) => {
            aiPreview.value = result.text
            aiReview.hidden = false
            noteText = 'The revised card is below: read it, change what you like, then Apply — or Regenerate for another take.'
            noteError = false
        })
    }
    aiGenerateButton.addEventListener('click', generate)
    aiRegenButton.addEventListener('click', generate)
    aiApplyButton.addEventListener('click', () => {
        const revised = aiPreview.value
        if (!revised.trim()) { noteText = 'The revised card is empty; nothing was applied.'; noteError = true; drawState(); return }
        run('saving', () => host.save({ name: name.value.trim(), bio: revised }), (result) => {
            aiEditing = false
            noteText = result.status === 'written' ? `Applied the AI edit to the Player Card for ${result.name}.` : result.status === 'removed' ? 'The card was empty, so it was removed.' : `The card was not saved: ${reasonText(result.reason)}.`
            noteError = result.status === 'failed'
        })
    })
    cancelButton.addEventListener('click', () => { editing = false; drawState() })
    saveButton.addEventListener('click', () => {
        run('saving', () => host.save({ name: name.value.trim(), bio: bio.value }), (result) => {
            editing = false
            noteText = result.status === 'written' ? `Saved the Player Card for ${result.name}.` : result.status === 'removed' ? 'The card was empty, so it was removed.' : `The card was not saved: ${reasonText(result.reason)}.`
            noteError = result.status === 'failed'
        })
    })
    removeButton.addEventListener('click', () => {
        if (running || !chatId || !view.card) return
        const proceed = host.confirm ? host.confirm(`Remove the Player Card for “${view.card.name}” from this chat? The narrator stops seeing it.`) : Promise.resolve(true)
        proceed.then((ok) => {
            if (!ok) return
            run('saving', () => host.remove(), () => { noteText = 'The Player Card was removed.'; noteError = false; name.value = '' })
        }).catch(host.fail)
    })

    drawState()

    return {
        root,
        setChat(id) {
            if (id !== chatId) { editing = false; aiEditing = false; noteText = ''; noteError = false; name.value = '' }
            chatId = id
            load()
        },
        refresh: load,
        edit: startEditing,
        applyPrefs(prefs) {
            if (typeof prefs.creatorCardWords === 'number') words.set(prefs.creatorCardWords)
        },
        busy: () => running !== '',
    }
}
