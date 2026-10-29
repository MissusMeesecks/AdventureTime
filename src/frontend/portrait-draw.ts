/**
 * The portraits drawn as they appear (Phase 61, roadmap row 61): the
 * settings of the legacy's auto-generation, as a sub-fold at the foot of
 * *Portraits in play* — Multihog's *Auto-generate for:* switches (the
 * player character, the party, the combat enemies, the lorebook NPCs), its
 * story lookback switch and count, and the two connections that are the
 * maintainer's ask: the image connection a portrait is drawn on (the scene
 * picture's when none is chosen, so 60's photo keeps drawing where it did)
 * and the text connection that writes its prompt (the agent's when none).
 *
 * A switch ticked on asks the backend for the legacy's `forceCheck`: everyone
 * it covers is drawn now. The lists of connections are read when the fold
 * is first opened, as the scene's are.
 */

import type { ConnectionChoice, PrefsResult, SceneConnectionsResult } from '../protocol.js'
import { reasonText } from './player-card-fold.js'

export interface PortraitDrawHost {
    el(tag: string, attrs?: Record<string, string>): HTMLElement
    savePrefs(patch: Record<string, unknown>): Promise<void>
    /** The host's image connections (49), the scene's list; absent, the select offers the default alone. */
    imageConnections?(): Promise<SceneConnectionsResult>
    /** The check a ticked switch asks for (61): everyone it covers, now. */
    check(): Promise<void>
    fail(error: unknown): void
}

export interface PortraitDrawSettings {
    root: HTMLDetailsElement
    /** The preferences as the backend holds them, on mount and after a change elsewhere. */
    applyPrefs(prefs: NonNullable<PrefsResult['prefs']> | Record<string, unknown>): void
    /** The text connections (the tracker's list), for the prompt's select. */
    setTextConnections(choices: ConnectionChoice[], unavailable: string): void
    /**
     * The rows themselves (83): the portraits section lays the mirror's rows out in
     * Multihog's order rather than keeping the fold, so it takes them one by one;
     * a row appended elsewhere leaves the fold, and `applyPrefs` still reaches it.
     */
    rows: { draw: HTMLElement[]; skip: HTMLElement; lookback: HTMLElement; count: HTMLElement }
}

/** The legacy's four switches, its words. */
export const PORTRAIT_DRAW_SWITCHES = [
    { key: 'portraitAutoPlayer', field: 'portrait-auto-player', label: 'Player character', title: 'The name the [CHARACTER] block opens with, drawn when it first appears.' },
    { key: 'portraitAutoParty', field: 'portrait-auto-party', label: 'Party members', title: 'Every [PARTY] member with hit points, drawn as they join.' },
    { key: 'portraitAutoEnemies', field: 'portrait-auto-enemies', label: 'Combat enemies', title: 'Every [COMBAT] line with hit points that is not the party’s, drawn as they appear.' },
    { key: 'portraitAutoNpcs', field: 'portrait-auto-npcs', label: 'Lorebook NPCs', title: 'Every entry of the campaign’s NPC book without a portrait, from its entry, after each pass.' },
] as const

export const PORTRAIT_DRAW_CSS = `
.lh-portrait-settings { font-size: 0.8em; margin-top: 8px; }
.lh-portrait-settings > summary { cursor: pointer; opacity: 0.8; }
.lh-portrait-settings-body { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.lh-portrait-settings-lead { opacity: 0.75; line-height: 1.4; }
.lh-portrait-settings-label { opacity: 0.75; margin-top: 2px; }
.lh-portrait-settings-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.lh-portrait-settings-row input[type="number"] { width: 4.5em; }
.lh-portrait-settings-row .lh-conn-hint { flex-basis: 100%; }
`

export interface PortraitDrawOptions {
    /**
     * The mirror in the settings (63b): the same switches and lookback under
     * *Portraits and location images*, with the field names prefixed so one
     * document holds both, and without the two connection rows — those are
     * the Connections category's.
     */
    mirror?: boolean
}

export function createPortraitDrawSettings(host: PortraitDrawHost, options: PortraitDrawOptions = {}): PortraitDrawSettings {
    const { el } = host
    const mirror = options.mirror === true
    const field = (name: string) => `${mirror ? 'mirror-' : ''}${name}`
    const root = el('details', { class: 'lh-portrait-settings', 'data-lh-field': field('portrait-settings') }) as HTMLDetailsElement
    const summary = el('summary')
    summary.textContent = 'Drawing the portraits'
    const body = el('div', { class: 'lh-portrait-settings-body' })
    const lead = el('div', { class: 'lh-portrait-settings-lead' })
    lead.textContent = 'Drawn on their own as they appear, after each tracker and agent pass, one at a time, at the photo’s 2:3. A page reload draws nobody; ticking a switch draws everyone it covers now. Draw on a row draws that one whatever the switches say.'
    if (mirror) lead.textContent += ' The same switches are under Portraits in play; the two connections are under Connections & models.'
    const forLabel = el('div', { class: 'lh-portrait-settings-label' })
    forLabel.textContent = 'Draw for:'
    body.append(lead, forLabel)

    const switches = new Map<string, HTMLInputElement>()
    const drawRows: HTMLElement[] = []
    for (const choice of PORTRAIT_DRAW_SWITCHES) {
        const row = el('label', { class: 'lh-portrait-settings-row' })
        drawRows.push(row)
        const input = el('input', { type: 'checkbox', 'data-lh-field': field(choice.field) }) as HTMLInputElement
        const text = el('span')
        text.textContent = choice.label
        row.title = choice.title
        row.append(input, text)
        input.addEventListener('change', () => {
            const on = input.checked
            host.savePrefs({ [choice.key]: on })
                .then(() => (on ? host.check() : undefined))
                .catch(host.fail)
        })
        switches.set(choice.key, input)
        body.append(row)
    }

    // Multihog's Skip Prompt Edit Dialog (73f): off, a pressed draw shows the prompt to edit first.
    const skipRow = el('label', { class: 'lh-portrait-settings-row' })
    const skipInput = el('input', { type: 'checkbox', 'data-lh-field': field('portrait-skip-prompt') }) as HTMLInputElement
    const skipText = el('span')
    skipText.textContent = 'Skip the prompt editor on a pressed draw'
    skipRow.title = 'Multihog’s Skip Prompt Edit Dialog. On, a pressed Draw — the scene’s picture, a library photo, a portrait in play — writes the prompt and draws at once. Off, the prompt is shown first, to edit, copy or cancel, before the image is drawn. Draws on their own never ask.'
    skipRow.append(skipInput, skipText)
    skipInput.addEventListener('change', () => { host.savePrefs({ portraitSkipPromptDialog: skipInput.checked }).catch(host.fail) })
    const lookbackRow = el('label', { class: 'lh-portrait-settings-row' })
    const lookbackInput = el('input', { type: 'checkbox', 'data-lh-field': field('portrait-lookback') }) as HTMLInputElement
    const lookbackText = el('span')
    lookbackText.textContent = 'Use the story when writing the prompt'
    lookbackRow.title = 'The legacy’s story lookback: the persona, the campaign’s entries whose keywords meet the name, the game state and the last messages go into the prompt. Off, a portrait is described from the memo and the narrator’s card alone (an NPC from their entry).'
    lookbackRow.append(lookbackInput, lookbackText)
    const countRow = el('label', { class: 'lh-portrait-settings-row' })
    const countLabel = el('span')
    countLabel.textContent = 'Messages it reads'
    const countInput = el('input', { type: 'number', class: 'lh-input', min: '0', max: '100', step: '1', 'data-lh-field': field('portrait-lookback-count') }) as HTMLInputElement
    countInput.value = '5'
    countRow.append(countLabel, countInput)
    countRow.hidden = true
    lookbackInput.addEventListener('change', () => {
        countRow.hidden = !lookbackInput.checked
        host.savePrefs({ portraitStoryLookback: lookbackInput.checked }).catch(host.fail)
    })
    countInput.addEventListener('change', () => {
        const n = Math.min(Math.max(Math.floor(Number(countInput.value) || 0), 0), 100)
        countInput.value = String(n)
        host.savePrefs({ portraitStoryLookbackCount: n }).catch(host.fail)
    })

    const imageRow = el('label', { class: 'lh-portrait-settings-row' })
    const imageLabel = el('span')
    imageLabel.textContent = 'Image connection'
    const imageSelect = el('select', { class: 'lh-input', 'data-lh-field': field('portrait-connection') }) as HTMLSelectElement
    const imageHint = el('span', { class: 'lh-conn-hint' })
    imageHint.textContent = 'Where a portrait is drawn, the library’s photo too. Blank is the scene picture’s connection, or the host’s default when the scene has none.'
    imageRow.append(imageLabel, imageSelect, imageHint)
    const promptRow = el('label', { class: 'lh-portrait-settings-row' })
    const promptLabel = el('span')
    promptLabel.textContent = 'Prompt connection'
    const promptSelect = el('select', { class: 'lh-input', 'data-lh-field': field('portrait-prompt-connection') }) as HTMLSelectElement
    const promptHint = el('span', { class: 'lh-conn-hint' })
    promptHint.textContent = 'The text model that writes the image prompt. Blank is the agent’s connection.'
    promptRow.append(promptLabel, promptSelect, promptHint)
    body.append(skipRow, lookbackRow, countRow)
    if (!mirror) body.append(imageRow, promptRow)
    root.append(summary, body)

    let imageConnectionId = ''
    let promptConnectionId = ''
    let images: SceneConnectionsResult | null = null
    let imagesAsked = false
    let texts: ConnectionChoice[] = []
    let textsUnavailable = ''

    function drawImages(): void {
        imageSelect.replaceChildren()
        const none = el('option', { value: '' }) as HTMLOptionElement
        none.textContent = 'The scene picture’s connection'
        imageSelect.append(none)
        for (const c of images?.connections ?? []) {
            const option = el('option', { value: c.id }) as HTMLOptionElement
            option.textContent = `${c.name} — ${c.provider}${c.model ? ` · ${c.model}` : ''}${c.isDefault ? ' (default)' : ''}`
            imageSelect.append(option)
        }
        if (imageConnectionId && !images?.connections.some((c) => c.id === imageConnectionId)) {
            const kept = el('option', { value: imageConnectionId }) as HTMLOptionElement
            kept.textContent = `${imageConnectionId} (not in the list)`
            imageSelect.append(kept)
        }
        imageSelect.value = imageConnectionId
        if (images?.unavailable) imageHint.textContent = reasonText(images.unavailable)
    }

    function drawTexts(): void {
        promptSelect.replaceChildren()
        const none = el('option', { value: '' }) as HTMLOptionElement
        none.textContent = 'The agent’s connection'
        promptSelect.append(none)
        for (const c of texts) {
            const option = el('option', { value: c.id }) as HTMLOptionElement
            option.textContent = c.model ? `${c.name} — ${c.model}` : c.name
            promptSelect.append(option)
        }
        if (promptConnectionId && !texts.some((c) => c.id === promptConnectionId)) {
            const kept = el('option', { value: promptConnectionId }) as HTMLOptionElement
            kept.textContent = 'The connection you chose is no longer listed'
            promptSelect.append(kept)
        }
        promptSelect.value = promptConnectionId
        if (textsUnavailable) promptHint.textContent = textsUnavailable
    }

    function loadImages(): void {
        if (imagesAsked || !host.imageConnections) return
        imagesAsked = true
        host.imageConnections()
            .then((result) => { images = result })
            .catch((error) => { images = { connections: [], unavailable: error instanceof Error ? error.message : String(error) } })
            .finally(drawImages)
    }

    imageSelect.addEventListener('change', () => { imageConnectionId = imageSelect.value; host.savePrefs({ portraitConnectionId: imageConnectionId }).catch(host.fail) })
    promptSelect.addEventListener('change', () => { promptConnectionId = promptSelect.value; host.savePrefs({ portraitPromptConnectionId: promptConnectionId }).catch(host.fail) })
    root.addEventListener('toggle', () => { if (root.open) loadImages() })
    drawImages()
    drawTexts()

    return {
        root,
        rows: { draw: drawRows, skip: skipRow, lookback: lookbackRow, count: countRow },
        applyPrefs(prefs) {
            const p = prefs as Record<string, unknown>
            for (const choice of PORTRAIT_DRAW_SWITCHES) {
                if (p[choice.key] !== undefined) switches.get(choice.key)!.checked = p[choice.key] === true
            }
            if (p.portraitSkipPromptDialog !== undefined) skipInput.checked = p.portraitSkipPromptDialog === true
            if (p.portraitStoryLookback !== undefined) {
                lookbackInput.checked = p.portraitStoryLookback === true
                countRow.hidden = !lookbackInput.checked
            }
            if (p.portraitStoryLookbackCount !== undefined) countInput.value = String(p.portraitStoryLookbackCount)
            if (p.portraitConnectionId !== undefined) { imageConnectionId = String(p.portraitConnectionId ?? ''); drawImages() }
            if (p.portraitPromptConnectionId !== undefined) { promptConnectionId = String(p.portraitPromptConnectionId ?? ''); drawTexts() }
        },
        setTextConnections(choices, unavailable) {
            texts = choices
            textsUnavailable = unavailable
            drawTexts()
        },
    }
}
