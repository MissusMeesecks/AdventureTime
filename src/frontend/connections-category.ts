/**
 * Every connection in one place (Phase 63, roadmap row 63 — the
 * *Connections & models* category, Multihog's second): a row per
 * connection AdventureTime's passes and draws run on, each bound to the same
 * preference the fold beside the pass holds — one preference, two rows, as
 * `npcAddAsIsMode` is (48) — so the maintainer can set everything up here
 * and still reach the dial from the fold while playing. The folds and this
 * category stay in step through the `prefs.changed` event every save
 * sends. **Apply to all** sets every text connection to one choice, as
 * Multihog's *Apply Connection Setup to All* does.
 */

import type { ConnectionChoice, SceneConnectionsResult } from '../protocol.js'
import { createHelpTip } from './help-tip.js'

type El = (tag: string, attrs?: Record<string, string>) => HTMLElement

export interface ConnectionsCategoryHost {
    el: El
    savePrefs(patch: Record<string, unknown>): Promise<void>
    /** The host's text connections, the tracker's list. */
    textConnections(): Promise<{ connections: ConnectionChoice[]; unavailable?: string }>
    /** The host's image connections (49), the scene's list. */
    imageConnections(): Promise<SceneConnectionsResult>
    fail(error: unknown): void
}

export interface ConnectionsCategory {
    root: HTMLElement
    /** The preferences as the backend holds them, on mount and on every `prefs.changed`. */
    applyPrefs(prefs: Record<string, unknown>): void
    /** Read the two lists, once; called when the category is first opened. */
    load(): void
}

export interface ConnectionRowDef {
    key: string
    field: string
    label: string
    /** What a blank choice means: the row's fallback, named. */
    blank: string
    /** The row's help, behind the `[?]` after its label (96). */
    hint: string
    kind: 'text' | 'image'
}

/**
 * What a blank tracker or agent row means (89): the narrator's connection by
 * the backend's chain — the chat's own, the one seen writing the last reply,
 * Lumiverse's default-ticked one, the first listed — never *whatever writes
 * the story* as such, which Lumiverse's quiet path does not offer.
 */
export const NARRATOR_BLANK = 'Use the narrator connection'

/** What a blank map or portrait-prompt row means. */
const AGENT_BLANK = 'Use the Lorebook Agent connection'

/** The output length's preference (89), blank as it ships. */
export const MAX_TOKENS_FIELD = 'connection-max-tokens'

/** The rows, in the order the passes run: the story's, then the pictures'. */
export const CONNECTION_ROWS: readonly ConnectionRowDef[] = [
    { key: 'trackerConnectionId', field: 'connection-tracker', label: 'State Tracker', blank: NARRATOR_BLANK, hint: 'The model that reads the story and writes the tracker memo.', kind: 'text' },
    { key: 'agentConnectionId', field: 'connection-agent', label: 'Lorebook Agent', blank: NARRATOR_BLANK, hint: 'The model that records lore in the campaign’s lorebooks. The Map Architect, Map Updater, Map Evolution and portrait prompts use it when their own rows are blank. World Progression always uses it.', kind: 'text' },
    { key: 'creatorConnectionId', field: 'connection-creator', label: 'Character creator', blank: 'Use the State Tracker connection', hint: 'The model that writes a character sheet. The Character creator, Instant Action and the other ways to begin all use it.', kind: 'text' },
    { key: 'companionConnectionId', field: 'connection-companion', label: 'Adventure Companion', blank: NARRATOR_BLANK, hint: 'The model that answers in the Companion’s chat. The whole guide is sent with every message while “Attach the guide” is on, so a small, cheap model suits it.', kind: 'text' },
    { key: 'mapArchitectConnectionId', field: 'connection-architect', label: 'Map Architect', blank: AGENT_BLANK, hint: 'Draws a site’s map in two calls: first the layout, then the contents. It also writes the brief when you ask for a map from the panel. Choose a model that writes long, exact JSON.', kind: 'text' },
    { key: 'mapUpdaterConnectionId', field: 'connection-updater', label: 'Map Updater', blank: AGENT_BLANK, hint: 'Runs after replies while the party is inside a mapped site. Each pass writes the changes to the map as JSON. A fast model suits it.', kind: 'text' },
    { key: 'mapEvolutionConnectionId', field: 'connection-evolution', label: 'Map Evolution', blank: AGENT_BLANK, hint: 'Changes mapped sites while the party is away. One pass can cover several sites, so a fast model suits it.', kind: 'text' },
    { key: 'portraitPromptConnectionId', field: 'connection-portrait-prompt', label: 'Portrait prompts', blank: AGENT_BLANK, hint: 'The text model that writes the image prompt for a portrait or an NPC library photo.', kind: 'text' },
    { key: 'scenePictureConnectionId', field: 'connection-scene-image', label: 'Scene picture', blank: 'Use Lumiverse’s default image connection', hint: 'The image connection that draws the picture of the party’s location.', kind: 'image' },
    { key: 'portraitConnectionId', field: 'connection-portrait-image', label: 'Portraits', blank: 'Use the location image connection', hint: 'The image connection that draws portraits and NPC library photos.', kind: 'image' },
]

/** How many text connections **Apply to all** sets, in the words its help uses; the test holds the word to the rows. */
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const TEXT_ROW_COUNT = CONNECTION_ROWS.filter((row) => row.kind === 'text').length
const TEXT_ROW_WORD = NUMBER_WORDS[TEXT_ROW_COUNT] ?? String(TEXT_ROW_COUNT)

/** Ids for the rows' controls, unique across every category drawn on the page. */
let sequence = 0

export function createConnectionsCategory(host: ConnectionsCategoryHost): ConnectionsCategory {
    const { el } = host
    const root = el('div', { class: 'lh-connections' })
    const chosen: Record<string, string> = {}
    let texts: ConnectionChoice[] = []
    let textsUnavailable = ''
    let images: SceneConnectionsResult | null = null
    let asked = false
    const selects = new Map<string, { select: HTMLSelectElement; status: HTMLElement; def: ConnectionRowDef }>()
    let ids = 0

    /** A row's label line (96): the label, then its `[?]`; the label names the control by `for`, since the row is no `<label>`. */
    function labelLine(text: string, control: HTMLElement, help: string): { line: HTMLElement; note: HTMLElement } {
        control.id = `lh-conn-control-${++sequence}-${++ids}`
        const name = el('label', { class: 'lh-conn-label', for: control.id })
        name.textContent = text
        const tip = createHelpTip(el, text, help)
        const line = el('span', { class: 'lh-conn-label-line' })
        line.append(name, tip.button)
        return { line, note: tip.note }
    }

    for (const def of CONNECTION_ROWS) {
        const row = el('div', { class: 'lh-conn lh-search-item', 'data-lh-field': def.field })
        const select = el('select', { class: 'lh-input' }) as HTMLSelectElement
        const { line, note } = labelLine(def.label, select, def.hint)
        // The visible line under the control is the row's status alone (96): why a list could not be read. Empty, it is hidden.
        const status = el('div', { class: 'lh-conn-hint', role: 'status' })
        status.hidden = true
        row.append(line, note, select, status)
        select.addEventListener('change', () => {
            chosen[def.key] = select.value
            host.savePrefs({ [def.key]: select.value }).catch(host.fail)
        })
        selects.set(def.key, { select, status, def })
        root.append(row)
    }

    // Apply to all (Multihog's): one text connection for every pass.
    const allRow = el('div', { class: 'lh-conn lh-search-item', 'data-lh-field': 'connection-all' })
    const allSelect = el('select', { class: 'lh-input' }) as HTMLSelectElement
    const allButton = el('button', { type: 'button', class: 'lh-button' }) as HTMLButtonElement
    allButton.textContent = 'Apply to all'
    const allHead = labelLine('Apply to all text connections', allSelect, `Sets all ${TEXT_ROW_WORD} text connections above to the chosen connection. The two image connections do not change. Choose the blank option to return every row to its own fallback.`)
    allRow.append(allHead.line, allHead.note, allSelect, allButton)
    allButton.addEventListener('click', () => {
        const patch: Record<string, unknown> = {}
        for (const def of CONNECTION_ROWS) if (def.kind === 'text') patch[def.key] = allSelect.value
        host.savePrefs(patch).catch(host.fail)
    })
    root.append(allRow)

    // The output length for AdventureTime's own calls (89): a preset's numbers never reach a quiet
    // call, so this is the one number the passes get; blank leaves each provider's own default.
    const tokensRow = el('div', { class: 'lh-conn lh-search-item', 'data-lh-field': MAX_TOKENS_FIELD })
    const tokensInput = el('input', { type: 'number', class: 'lh-input', min: '0', step: '1', placeholder: 'Provider default' }) as HTMLInputElement
    const tokensHead = labelLine('Pass output length', tokensInput, 'The maximum reply length, in tokens, for every pass AdventureTime makes. Leave blank to use each provider’s default (4,096 for Anthropic through Lumiverse). Raise it if a pass’s JSON reply is cut off, and keep it at or below the model’s limit.')
    tokensRow.append(tokensHead.line, tokensHead.note, tokensInput)
    let maxTokens = 0
    tokensInput.addEventListener('change', () => {
        const n = Math.floor(Number(tokensInput.value))
        const next = Number.isFinite(n) && n > 0 ? n : 0
        tokensInput.value = next ? String(next) : ''
        maxTokens = next
        host.savePrefs({ passMaxTokens: next }).catch(host.fail)
    })
    root.append(tokensRow)

    function drawOne(entry: { select: HTMLSelectElement; status: HTMLElement; def: ConnectionRowDef }): void {
        const { select, status, def } = entry
        const current = chosen[def.key] ?? ''
        select.replaceChildren()
        const none = el('option', { value: '' }) as HTMLOptionElement
        none.textContent = def.blank
        select.append(none)
        const choices: Array<{ id: string; text: string }> = def.kind === 'text'
            ? texts.map((c) => ({ id: c.id, text: c.model ? `${c.name} — ${c.model}` : c.name }))
            : (images?.connections ?? []).map((c) => ({ id: c.id, text: `${c.name} — ${c.provider}${c.model ? ` · ${c.model}` : ''}${c.isDefault ? ' (default)' : ''}` }))
        for (const c of choices) {
            const option = el('option', { value: c.id }) as HTMLOptionElement
            option.textContent = c.text
            select.append(option)
        }
        if (current && !choices.some((c) => c.id === current)) {
            const missing = el('option', { value: current }) as HTMLOptionElement
            missing.textContent = 'Missing connection (no longer in Lumiverse)'
            select.append(missing)
        }
        select.value = current
        const unavailable = def.kind === 'text' ? textsUnavailable : images?.unavailable ?? ''
        status.textContent = unavailable ? `Connections could not be listed: ${unavailable}` : ''
        status.hidden = !unavailable
    }

    function draw(): void {
        for (const entry of selects.values()) drawOne(entry)
        allSelect.replaceChildren()
        const none = el('option', { value: '' }) as HTMLOptionElement
        none.textContent = 'Use each row’s fallback'
        allSelect.append(none)
        for (const c of texts) {
            const option = el('option', { value: c.id }) as HTMLOptionElement
            option.textContent = c.model ? `${c.name} — ${c.model}` : c.name
            allSelect.append(option)
        }
        allButton.disabled = !!textsUnavailable
    }

    draw()

    return {
        root,
        applyPrefs(prefs) {
            for (const def of CONNECTION_ROWS) {
                if (prefs[def.key] !== undefined) chosen[def.key] = typeof prefs[def.key] === 'string' ? (prefs[def.key] as string) : ''
            }
            if (prefs.passMaxTokens !== undefined) {
                const n = Number(prefs.passMaxTokens)
                maxTokens = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
                tokensInput.value = maxTokens ? String(maxTokens) : ''
            }
            draw()
        },
        load() {
            if (asked) return
            asked = true
            host.textConnections()
                .then((result) => { texts = result.connections ?? []; textsUnavailable = result.unavailable ?? '' })
                .catch((error) => { texts = []; textsUnavailable = error instanceof Error ? error.message : String(error) })
                .then(() => host.imageConnections())
                .then((result) => { images = result })
                .catch((error) => { images = { connections: [], unavailable: error instanceof Error ? error.message : String(error) } })
                .finally(draw)
        },
    }
}
