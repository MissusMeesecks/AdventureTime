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
    /** What a blank choice means, in the fold's own words. */
    blank: string
    hint: string
    kind: 'text' | 'image'
}

/**
 * What a blank tracker or agent row means (89): the narrator's connection by
 * the backend's chain — the chat's own, the one seen writing the last reply,
 * Lumiverse's default-ticked one, the first listed — never *whatever writes
 * the story* as such, which Lumiverse's quiet path does not offer.
 */
export const NARRATOR_BLANK = 'The narrator’s connection (the chat’s own, else the one seen writing the story, else Lumiverse’s default)'

/** The output length's preference (89), blank as it ships. */
export const MAX_TOKENS_FIELD = 'connection-max-tokens'

/** The rows, in the order the passes run: the story's, then the pictures'. */
export const CONNECTION_ROWS: readonly ConnectionRowDef[] = [
    { key: 'trackerConnectionId', field: 'connection-tracker', label: 'State tracker', blank: NARRATOR_BLANK, hint: 'The model that reads the story and writes the memo. Also under Tracker settings, instruction and the last report.', kind: 'text' },
    { key: 'agentConnectionId', field: 'connection-agent', label: 'Lorebook agent', blank: NARRATOR_BLANK, hint: 'The model that records the lore, and the one the world, the maps and the pictures’ prompts fall back to. Also in the Lorebook agent fold.', kind: 'text' },
    { key: 'creatorConnectionId', field: 'connection-creator', label: 'Character creator', blank: 'The tracker’s connection', hint: 'The sheet, Instant Action and the other ways to begin. Also in the Character creator fold.', kind: 'text' },
    { key: 'mapArchitectConnectionId', field: 'connection-architect', label: 'Map Architect', blank: 'The agent’s connection', hint: 'The two calls that draw a site’s map — the topology, then the contents — and the brief a map asked for from the panel fills first. A model that writes long, exact JSON suits it.', kind: 'text' },
    { key: 'mapUpdaterConnectionId', field: 'connection-updater', label: 'Map Updater', blank: 'The agent’s connection', hint: 'The pass after every reply inside a mapped site: one JSON transaction against the map. A fast model suits it.', kind: 'text' },
    { key: 'mapEvolutionConnectionId', field: 'connection-evolution', label: 'Map Evolution', blank: 'The agent’s connection', hint: 'A fast model suits it: a pass can take several sites in one turn. Also under Evolution in the Maps fold.', kind: 'text' },
    { key: 'portraitPromptConnectionId', field: 'connection-portrait-prompt', label: 'Portrait prompts', blank: 'The agent’s connection', hint: 'The text model that writes a portrait’s image prompt, the library’s photo included. Also under Drawing the portraits.', kind: 'text' },
    { key: 'scenePictureConnectionId', field: 'connection-scene-image', label: 'Scene picture', blank: 'The host’s default image connection', hint: 'The image connection the place’s picture is drawn on. Also under Drawing the picture in the Scene fold.', kind: 'image' },
    { key: 'portraitConnectionId', field: 'connection-portrait-image', label: 'Portraits', blank: 'The scene picture’s connection', hint: 'The image connection a portrait and the library’s photo are drawn on. Also under Drawing the portraits.', kind: 'image' },
]

export function createConnectionsCategory(host: ConnectionsCategoryHost): ConnectionsCategory {
    const { el } = host
    const root = el('div', { class: 'lh-connections' })
    const lead = el('div', { class: 'lh-section-help lh-search-item' })
    lead.textContent = 'Each connection is also beside what it drives; a change here shows there, and the other way round. Blank is the fallback the row names.'
    root.append(lead)

    const chosen: Record<string, string> = {}
    let texts: ConnectionChoice[] = []
    let textsUnavailable = ''
    let images: SceneConnectionsResult | null = null
    let asked = false
    const selects = new Map<string, { select: HTMLSelectElement; hint: HTMLElement; def: ConnectionRowDef }>()

    for (const def of CONNECTION_ROWS) {
        const row = el('label', { class: 'lh-conn lh-search-item', 'data-lh-field': def.field })
        const name = el('span', { class: 'lh-conn-label' })
        name.textContent = def.label
        const select = el('select', { class: 'lh-input' }) as HTMLSelectElement
        const hint = el('div', { class: 'lh-conn-hint' })
        hint.textContent = def.hint
        row.append(name, select, hint)
        select.addEventListener('change', () => {
            chosen[def.key] = select.value
            host.savePrefs({ [def.key]: select.value }).catch(host.fail)
        })
        selects.set(def.key, { select, hint, def })
        root.append(row)
    }

    // Apply to all (Multihog's): one text connection for every pass.
    const allRow = el('div', { class: 'lh-conn lh-search-item', 'data-lh-field': 'connection-all' })
    const allLabel = el('span', { class: 'lh-conn-label' })
    allLabel.textContent = 'Apply one text connection to all'
    const allSelect = el('select', { class: 'lh-input' }) as HTMLSelectElement
    const allButton = el('button', { type: 'button', class: 'lh-button' }) as HTMLButtonElement
    allButton.textContent = 'Apply to all'
    allButton.title = 'Sets the tracker, the agent, the creator, Map Evolution and the portrait prompts to this connection. The two image connections are not touched.'
    const allHint = el('div', { class: 'lh-conn-hint' })
    allHint.textContent = 'Every text connection above to one choice; blank puts each back to its own fallback.'
    allRow.append(allLabel, allSelect, allButton, allHint)
    allButton.addEventListener('click', () => {
        const patch: Record<string, unknown> = {}
        for (const def of CONNECTION_ROWS) if (def.kind === 'text') patch[def.key] = allSelect.value
        host.savePrefs(patch).catch(host.fail)
    })
    root.append(allRow)

    // The output length for AdventureTime's own calls (89): a preset's numbers never reach a quiet
    // call, so this is the one number the passes get; blank leaves each provider's own default.
    const tokensRow = el('label', { class: 'lh-conn lh-search-item', 'data-lh-field': MAX_TOKENS_FIELD })
    const tokensLabel = el('span', { class: 'lh-conn-label' })
    tokensLabel.textContent = 'Output length for AdventureTime’s calls'
    const tokensInput = el('input', { type: 'number', class: 'lh-input', min: '0', step: '1', placeholder: 'blank: each provider’s own default' }) as HTMLInputElement
    const tokensHint = el('div', { class: 'lh-conn-hint' })
    tokensHint.textContent = 'Sent as max_tokens on every pass AdventureTime makes — the tracker, the agent, the maps, the creator, the prompts — on whichever connection it runs. Blank leaves each provider’s own default (Anthropic’s through Lumiverse is 4,096). Set it when a pass’s JSON reply ends mid-object; some providers refuse a number above the model’s limit, so keep it at or under the model’s.'
    tokensRow.append(tokensLabel, tokensInput, tokensHint)
    let maxTokens = 0
    tokensInput.addEventListener('change', () => {
        const n = Math.floor(Number(tokensInput.value))
        const next = Number.isFinite(n) && n > 0 ? n : 0
        tokensInput.value = next ? String(next) : ''
        maxTokens = next
        host.savePrefs({ passMaxTokens: next }).catch(host.fail)
    })
    root.append(tokensRow)

    function drawOne(entry: { select: HTMLSelectElement; hint: HTMLElement; def: ConnectionRowDef }): void {
        const { select, hint, def } = entry
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
            missing.textContent = 'The connection you chose is no longer listed'
            select.append(missing)
        }
        select.value = current
        const unavailable = def.kind === 'text' ? textsUnavailable : images?.unavailable ?? ''
        hint.textContent = unavailable || def.hint
    }

    function draw(): void {
        for (const entry of selects.values()) drawOne(entry)
        allSelect.replaceChildren()
        const none = el('option', { value: '' }) as HTMLOptionElement
        none.textContent = 'Each pass’s own fallback'
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
