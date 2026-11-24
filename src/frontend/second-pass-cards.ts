/**
 * Three small cards of the settings' second pass (Phase 72b, roadmap row 72):
 *
 * - **Narrator card** (Multihog's *Narrator card name* and *Create narrator
 *   card*): a name, a button that makes an empty card under it through the
 *   host or finds the one that carries it, and a note. The card is not
 *   selected — Lumiverse opens a chat from a card itself. Since 81 the rows
 *   sit under Help in the Core & Branching card, where Multihog keeps them.
 * - **NPC word targets** (*Lorebook agent*, Multihog's *Major / Minor NPC Total
 *   Word Target*): two numbers written into the NPC module's instruction by
 *   `settings.npcWords`, as the legacy rebuilds the instruction from them.
 * - **Display marker library** (*State Tracker*; Multihog's *Rendering tags
 *   library* button, renamed in 96): every display marker with its example line, drawn live by
 *   the same renderer the cards use, so a module's author can see what
 *   `((BAR)) 50/100` becomes before writing it into a format.
 */

import { setCardIcon } from './icons.js'
import { getMarkerLibraryKeys, MARKER_TYPE_MAP } from '../tracker/markers.js'
import { parseBlockLine } from '../tracker/lines.js'
import { renderLine } from '../tracker/render.js'
import { stripRecolorHandles } from './recolor.js'
import type { NarratorCardResult } from '../protocol.js'
import { attachCardHelp, createHelpTip } from './help-tip.js'
import { MARKER_DESCRIPTIONS, MARKER_LIBRARY_HELP } from './marker-help.js'

type El = (tag: string, attrs?: Record<string, string>) => HTMLElement

function card(el: El, id: string, icon: string, title: string, lead: string): { root: HTMLDetailsElement; body: HTMLElement; summary: HTMLElement; title: HTMLElement } {
    const root = el('details', { class: 'lh-card lh-second-card lh-search-item', 'data-lh-card': id }) as HTMLDetailsElement
    const summary = el('summary')
    const iconEl = el('span', { class: 'lh-card-icon', 'aria-hidden': 'true' })
    setCardIcon(iconEl, title, icon)
    const titleEl = el('span', { class: 'lh-card-title' })
    titleEl.textContent = title
    summary.append(iconEl, titleEl, el('span', { class: 'lh-chevron', 'aria-hidden': 'true' }))
    const body = el('div', { class: 'lh-second-body' })
    if (lead) {
        const leadEl = el('div', { class: 'lh-second-lead' })
        leadEl.textContent = lead
        body.append(leadEl)
    }
    root.append(summary, body)
    return { root, body, summary, title: titleEl }
}

export const SECOND_PASS_CSS = `
.adventuretime-panel .lh-second-body { display: flex; flex-direction: column; gap: 8px; padding: 8px 10px 10px; font-size: 0.8em; }
.adventuretime-panel .lh-second-lead { font-size: 0.92em; opacity: 0.7; line-height: 1.4; }
.adventuretime-panel .lh-second-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end; }
.adventuretime-panel .lh-second-field { display: flex; flex-direction: column; gap: 2px; flex: 1 1 8em; min-width: 0; }
.adventuretime-panel .lh-second-field > span { font-size: 0.8em; opacity: 0.75; }
.adventuretime-panel .lh-second-label-line { display: flex; align-items: center; gap: 4px; }
.adventuretime-panel .lh-second-label-line > label { font-size: 0.8em; opacity: 0.75; min-width: 0; }
.adventuretime-panel .lh-second-field .lh-input { width: 100%; box-sizing: border-box; }
.adventuretime-panel .lh-second-note { font-size: 0.92em; opacity: 0.85; line-height: 1.4; overflow-wrap: anywhere; }
.adventuretime-panel .lh-second-note:empty { display: none; }
.adventuretime-panel .lh-second-note--error { color: var(--lumiverse-danger, #d9534f); opacity: 1; }
.adventuretime-panel .lh-tags-entry { border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25))); border-radius: 6px; padding: 6px 8px; display: flex; flex-direction: column; gap: 4px; }
.adventuretime-panel .lh-tags-token { font-family: var(--lh-font-mono, var(--lumiverse-font-mono, monospace)); font-size: 0.8em; opacity: 0.8; overflow-wrap: anywhere; }
.adventuretime-panel .lh-tags-head { display: flex; align-items: center; gap: 4px; min-width: 0; }
.adventuretime-panel .lh-tags-name { font-family: var(--lh-font-mono, var(--lumiverse-font-mono, monospace)); font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
.adventuretime-panel .lh-tags-entry > .lh-help-note { margin: 0; }
.adventuretime-panel .lh-tags-preview { min-width: 0; overflow-wrap: anywhere; }
`

// ── the narrator card ────────────────────────────────────────────────────

export interface NarratorCardHost {
    el: El
    create(name: string): Promise<NarratorCardResult>
    savePrefs(patch: Record<string, unknown>): Promise<void>
    fail(error: unknown): void
}

export interface NarratorRows {
    /** The lead, the row and the note, for the Core & Branching card to host (81). */
    node: HTMLElement
    applyPrefs(prefs: Record<string, unknown>): void
}

/** The `[?]` on *Narrator card name* (96). */
export const NARRATOR_CARD_HELP = 'Creates an empty character card with this name to act as the narrator. The card can be empty because AdventureTime’s rulebook is the whole prompt. If a card with this name already exists, nothing is created. Open a chat from the card in Lumiverse.'

let narratorSequence = 0

/** The narrator card's rows (72b), under Help in Multihog's Core & Branching drawer since 81 (*Setup & help* since 96). */
export function createNarratorRows(host: NarratorCardHost): NarratorRows {
    const { el } = host
    const node = el('div', { class: 'lh-narrator-rows', 'data-lh-field': 'narrator-rows' })
    const body = node
    const row = el('div', { class: 'lh-second-row lh-search-item' })
    // The help is behind a [?] after the label (96), in the row from the first paint; the label names its
    // box by id, so neither the button nor the note sits inside a <label>.
    const field = el('div', { class: 'lh-second-field' })
    const nameId = `lh-narrator-name-${++narratorSequence}`
    const line = el('div', { class: 'lh-second-label-line' })
    const label = el('label', { for: nameId })
    label.textContent = 'Narrator card name'
    const tip = createHelpTip(el, 'Narrator card name', NARRATOR_CARD_HELP)
    line.append(label, tip.button)
    const name = el('input', { id: nameId, type: 'text', class: 'lh-input', maxlength: '120', placeholder: 'Game Master', 'data-lh-field': 'narrator-name' }) as HTMLInputElement
    name.value = 'Game Master'
    name.addEventListener('change', () => { host.savePrefs({ narratorCardName: name.value.trim() || 'Game Master' }).catch(host.fail) })
    field.append(line, tip.note, name)
    const button = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'narrator-create' }) as HTMLButtonElement
    button.textContent = 'Create narrator card'
    const note = el('div', { class: 'lh-second-note', 'data-lh-field': 'narrator-note' })
    button.addEventListener('click', () => {
        button.disabled = true
        note.classList.remove('lh-second-note--error')
        note.textContent = 'Creating the card…'
        host.create(name.value.trim() || 'Game Master')
            .then((made) => {
                note.textContent = made.created
                    ? `Created the card “${made.name}”. Open a new chat from it in Lumiverse. You may need to refresh the Characters tab to see it.`
                    : `A card named “${made.name}” already exists, so nothing was created. Open a chat from it in Lumiverse.`
            })
            .catch((error: unknown) => {
                note.textContent = `The card could not be created: ${error instanceof Error ? error.message : String(error)}`
                note.classList.add('lh-second-note--error')
                host.fail(error)
            })
            .finally(() => { button.disabled = false })
    })
    row.append(field, button)
    body.append(row, note)
    return {
        node,
        applyPrefs(prefs) {
            if (typeof prefs.narratorCardName === 'string' && prefs.narratorCardName !== name.value) name.value = prefs.narratorCardName
        },
    }
}

// ── the NPC word targets ─────────────────────────────────────────────────

export interface NpcWordsHost {
    el: El
    /** `settings.npcWords`: the two targets kept and written into the instruction; `applied` false when the instruction no longer carries the sentences. */
    save(major: number, minor: number): Promise<{ applied: boolean }>
    fail(error: unknown): void
}

export interface NpcWordsCard {
    root: HTMLDetailsElement
    applyPrefs(prefs: Record<string, unknown>): void
}

/** The card's help, behind its header's [?] (96). */
export const NPC_WORDS_HELP = 'The target length, in words, of an NPC’s [CORE] text. A major NPC is recurring or important to the plot. A minor NPC is a shopkeeper, a guard or a one-off. The numbers are written into the NPC module’s instruction, which the agent reads.'

export function createNpcWordsCard(host: NpcWordsHost): NpcWordsCard {
    const { el } = host
    // The lead behind the header's [?] (96).
    const { root, body, summary, title } = card(el, 'npc-words', '📏', 'NPC word targets', '')
    attachCardHelp(el, root, summary, title, NPC_WORDS_HELP)
    const row = el('div', { class: 'lh-second-row' })
    const number = (field: string, label: string, value: number) => {
        const wrap = el('label', { class: 'lh-second-field' })
        const text = el('span')
        text.textContent = label
        const input = el('input', { type: 'number', min: '1', max: '5000', step: '5', class: 'lh-input', 'data-lh-field': field }) as HTMLInputElement
        input.value = String(value)
        wrap.append(text, input)
        return { wrap, input }
    }
    const major = number('npc-major-words', 'Major NPC words', 225)
    const minor = number('npc-minor-words', 'Minor NPC words', 135)
    const note = el('div', { class: 'lh-second-note', 'data-lh-field': 'npc-words-note' })
    const save = () => {
        const a = Math.max(1, Math.min(5000, Math.floor(Number(major.input.value) || 225)))
        const b = Math.max(1, Math.min(5000, Math.floor(Number(minor.input.value) || 135)))
        major.input.value = String(a)
        minor.input.value = String(b)
        note.classList.remove('lh-second-note--error')
        host.save(a, b).then((result) => {
            note.textContent = result.applied
                ? `Saved: ${a} words for a major NPC, ${b} for a minor NPC. The NPC instruction is updated.`
                : `Saved as ${a} and ${b}, but the NPC instruction no longer contains the two length sentences, so it was not changed. To restore them, reset the NPC instruction to stock under Agent modules in the Lore widget.`
            note.classList.toggle('lh-second-note--error', !result.applied)
        }).catch((error: unknown) => {
            note.textContent = `Could not save: ${error instanceof Error ? error.message : String(error)}`
            note.classList.add('lh-second-note--error')
            host.fail(error)
        })
    }
    major.input.addEventListener('change', save)
    minor.input.addEventListener('change', save)
    row.append(major.wrap, minor.wrap)
    body.append(row, note)
    return {
        root,
        applyPrefs(prefs) {
            if (typeof prefs.npcMajorWords === 'number' && String(prefs.npcMajorWords) !== major.input.value) major.input.value = String(prefs.npcMajorWords)
            if (typeof prefs.npcMinorWords === 'number' && String(prefs.npcMinorWords) !== minor.input.value) minor.input.value = String(prefs.npcMinorWords)
        },
    }
}

// ── the display marker library ───────────────────────────────────────────

/** Every library marker with its example line, as Multihog lists them: `((KEY)) example`. */
export function renderingTagsLibrary(): Array<{ key: string; line: string }> {
    return getMarkerLibraryKeys().map((key) => ({ key, line: `((${key})) ${MARKER_TYPE_MAP[key]!.example}` }))
}

export function createMarkersCard(el: El): HTMLDetailsElement {
    const { root, body, summary, title } = card(el, 'tags-library', '🎨', 'Display marker library', '')
    // The card's two paragraphs are behind its header's [?] (96).
    attachCardHelp(el, root, summary, title, MARKER_LIBRARY_HELP)
    renderingTagsLibrary().forEach(({ key, line }, index) => {
        // A row (96): the marker's name with its [?], the description under it (in the row from the
        // first paint, hidden), the line as a module writes it — Multihog's example, untouched, the
        // thing a user copies — and that line drawn. The rows are built once, so a [?] each is safe.
        const entry = el('div', { class: 'lh-tags-entry', 'data-lh-tag': key })
        const head = el('div', { class: 'lh-tags-head' })
        const name = el('span', { class: 'lh-tags-name' })
        name.textContent = `((${key}))`
        head.append(name)
        entry.append(head)
        const description = MARKER_DESCRIPTIONS[key]
        if (description) {
            const tip = createHelpTip(el, name.textContent, description)
            head.append(tip.button)
            entry.append(tip.note)
        }
        const token = el('div', { class: 'lh-tags-token' })
        token.textContent = line
        const preview = el('div', { class: 'lh-tags-preview rt-section-body' })
        try {
            preview.innerHTML = renderLine(parseBlockLine(line, { tag: 'TAGLIB', lineIndex: index }))
            // The examples are reference (74i-ter): no handle, no title, no half-controls — the
            // legacy's own library draws them and binds nothing, which reads as a click that does nothing.
            stripRecolorHandles(preview)
        } catch {
            preview.textContent = '(could not be drawn)'
        }
        entry.append(token, preview)
        body.append(entry)
    })
    return root
}
