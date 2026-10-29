/**
 * The scene fold (Phase 42): the legacy's Visuals mode.
 *
 * Where the party is — the place as the last footer names it, resolved to
 * the place book's path with its breadcrumb, under a picture set for the
 * place — and who is **present now**: the Player Character and every NPC the
 * newest narrator replies name (the window, a preference, Phase 52), as tiles
 * with their portraits and how recently each was named. A tile opens
 * the entry's text below the grid. The map itself stays in the Maps fold,
 * which the line under the picture points to when the party is inside a
 * mapped site. The fold reads the scene when opened and again after every
 * reply the panel hears about.
 *
 * The picture can be **drawn** (Phase 49): one model call writes the prompt
 * from the place and the moment, the host's image connection draws it, and
 * it is kept where a picture set by hand goes. *Draw a picture on its own*
 * is the legacy's Real-Time Mode, with its three triggers; it fails closed,
 * as the legacy does, and the note says so when it did.
 */

import type { SceneConnectionsResult, SceneDrawResult, ScenePictureReport, SceneResult } from '../protocol.js'
import { reasonText } from './player-card-fold.js'
import { zoomable, type Enlarge, type PictureActions } from './enlarge.js'
import { SCENE_PICTURE_TRIGGERS, createScenePictureSettings } from './scene-picture-settings.js'

export { SCENE_PICTURE_TRIGGERS }

export interface SceneFoldHost {
    el(tag: string, attrs?: Record<string, string>): HTMLElement
    get(): Promise<SceneResult>
    /** Keep a picture for a place: an address, a data URL with its filename, or `''` to forget it. */
    setImage(path: string, src: string, filename?: string): Promise<SceneResult>
    /** A picture picked by the user, as a data URL; `null` when none was. */
    pickImage(): Promise<{ dataUrl: string; filename: string } | null>
    /** Ask for an address; absent, the URL way is not offered. */
    askUrl?(current: string): Promise<string | null>
    /** The window (52), and the picture's preferences (49). */
    savePrefs(patch: Record<string, unknown>): Promise<void>
    /** Draw the picture of where the party is, now (49); `null` when the prompt editor was cancelled (73f). */
    draw?(): Promise<SceneDrawResult | null>
    /** Lay the place's picture behind the chat, or take it off with `null` (73f); absent, the switch does nothing here. */
    setBackground?(src: string | null): void
    /** The host's image connections (49), for the select. */
    connections?(): Promise<SceneConnectionsResult>
    /** Show the picture large (55), in the host's modal; absent, the picture is not clickable. */
    enlarge?: Enlarge
    /** The portrait's own buttons under the Full portrait (80), for an NPC by name. */
    portraitActions?(name: string): PictureActions | undefined
    fail(error: unknown): void
    when(iso: string): string
}

export interface SceneFoldPrefs {
    sceneLookback?: number
    scenePictureAuto?: boolean
    scenePictureTrigger?: 'location_enter' | 'location_change' | 'every_n_outputs'
    scenePictureEveryN?: number
    scenePicturePresentNpcs?: boolean
    scenePictureConnectionId?: string
    portraitLocationBackground?: boolean
}

export interface SceneFold {
    root: HTMLDetailsElement
    /** Between the hero and Present now (78a): where the Visuals/Map tab puts the site map, as Multihog's view orders them. */
    siteMapSlot: HTMLElement
    /** The *Drawing the picture* settings (49): the Locations gear opens them in the modal (78b); they sit at the fold's foot otherwise. */
    pictureSettings: HTMLDetailsElement
    setChat(chatId: string | null): void
    applyPrefs(prefs: SceneFoldPrefs): void
    /** Read the scene again, when the fold is open. */
    refresh(): Promise<void>
    busy(): boolean
    /** A draw began, from whichever hand (49): the live line says so. */
    drawingStarted(start: { chatId?: string; path: string; at: string }): void
    /** A draw finished (49): the note says what it did, and the scene is read again. */
    drawingFinished(report: ScenePictureReport): void
}


/** What a draw did (49), for the note. */
export function describeDraw(report: ScenePictureReport): { text: string; error: boolean } {
    const how = report.trigger === 'pressed' ? '' : ' on its own'
    if (report.outcome === 'drawn') return { text: `The picture of ${report.leaf} is drawn${how} by ${report.provider}${report.model ? ` (${report.model})` : ''}. The prompt is below.`, error: false }
    const reason = reasonText(report.reason ?? 'unknown')
    return {
        text: `The picture of ${report.leaf} could not be drawn${how}: ${reason}.${report.disabled ? ' Drawing on its own is switched off after this failure, as the legacy does; tick it again to retry.' : ''}`,
        error: true,
    }
}

/** The status line: where the party is, in words. */
export function describeSceneLocation(scene: SceneResult): string {
    const { location } = scene
    if (!location.raw) return 'No place is named yet: the last reply had no Location footer, and the memo no Location line.'
    if (location.path) return `The party is at ${location.leaf}${location.breadcrumb !== location.leaf ? ` — ${location.breadcrumb}` : ''}.${scene.mapSite ? ` They are inside ${scene.mapSite}; its map is in the Maps fold.` : ''}`
    return `The party is at ${location.raw}, which no place entry matches yet.${scene.mapSite ? ` They are inside ${scene.mapSite}; its map is in the Maps fold.` : ''}`
}

/** How recently a tile was named (52), for the line under its name. */
export function describeAgo(ago: number | undefined, window: number | undefined): string {
    if (ago === undefined || !window || window < 2) return ''
    if (ago === 0) return 'the latest reply'
    return ago === 1 ? '1 reply ago' : `${ago} replies ago`
}

export const SCENE_FOLD_CSS = `
.lh-scene-picture-settings { font-size: 0.8em; }
.lh-scene-picture-settings > summary { cursor: pointer; opacity: 0.8; }
.lh-scene-picture-body { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.lh-scene-picture-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.lh-scene-picture-row input[type="number"] { width: 4.5em; }
.lh-scene-prompt { font-size: 0.78em; white-space: pre-wrap; opacity: 0.8; max-height: 160px; overflow: auto; padding: 4px 6px; border: 1px dashed var(--lh-accent-dim, var(--lumiverse-border, rgba(255,255,255,0.18))); border-radius: 6px; }
.lh-scene-prompt[hidden] { display: none; }
.lh-scene-window { display: flex; gap: 6px; align-items: center; font-size: 0.8em; flex-wrap: wrap; }
.lh-scene-window input { width: 4.5em; }
.lh-scene-ago { font-size: 0.62em; opacity: 0.55; text-align: center; width: 100%; line-height: 1.1; }
.lh-scene > summary { cursor: pointer; font-size: 0.85em; opacity: 0.8; }
.lh-scene-body { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
/* The hero (84, the maintainer's ask): no box colour of its own — the widget's background shows through — and the picture fills the box's width however the widget is stretched; the placeholder alone keeps a faint box. */
.lh-scene-hero { position: relative; border-radius: 8px; overflow: hidden; min-height: 96px; background: transparent; display: flex; align-items: flex-end; }
.lh-scene-hero-inner { flex: 1 1 100%; min-width: 0; width: 100%; }
.lh-scene-hero img { display: block; width: 100%; max-height: 220px; object-fit: cover; }
.lh-scene-hero-placeholder { width: 100%; min-height: 96px; display: flex; align-items: center; justify-content: center; font-size: 2.2em; opacity: 0.5; background: rgba(127,127,127,0.12); border-radius: 8px; }
.lh-scene-hero-overlay { position: absolute; left: 0; right: 0; bottom: 0; padding: 8px 10px; background: linear-gradient(transparent, rgba(0,0,0,0.65)); color: #fff; }
.lh-scene-hero-title { font-size: 1em; font-weight: 700; text-shadow: 0 1px 2px rgba(0,0,0,0.6); }
.lh-scene-hero-crumb { font-size: 0.75em; opacity: 0.85; }
.lh-scene-hero-crumb--unresolved { font-style: italic; }
.lh-scene-tools { display: flex; gap: 6px; flex-wrap: wrap; }
.lh-scene-tool { min-width: 2.4em; font-size: 1.05em; line-height: 1.2; }
.lh-scene-label-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.lh-scene-label { font-size: 0.72em; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.55; margin-top: 2px; }
.lh-scene-grid { display: flex; gap: 6px; flex-wrap: wrap; }
.lh-scene-tile { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; width: 88px; padding: 5px 3px; border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(255,255,255,0.12))); border-radius: 6px; background: transparent; color: inherit; cursor: pointer; font: inherit; }
.lh-scene-tile[aria-pressed="true"] { outline: 1px solid var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
.lh-scene-tile--pc { border-color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
.lh-scene-thumb { width: 48px; height: 48px; border-radius: 50%; object-fit: cover; background: rgba(127,127,127,0.2); display: flex; align-items: center; justify-content: center; font-size: 1.4em; }
.lh-scene-name { font-size: 0.72em; text-align: center; width: 100%; line-height: 1.2; max-height: 2.4em; overflow: hidden; overflow-wrap: anywhere; }
.lh-scene-tile .lh-scene-thumb { align-self: center; }
.lh-scene-detail { padding: 6px 8px; border: 1px dashed var(--lh-accent-dim, var(--lumiverse-border, rgba(255,255,255,0.18))); border-radius: 6px; font-size: 0.8em; white-space: pre-wrap; max-height: 240px; overflow: auto; }
.lh-scene-detail-name { font-weight: 600; margin-bottom: 4px; }
.lh-scene-detail-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.lh-scene-full-portrait { font-size: 0.9em; }
.lh-scene-empty { font-size: 0.8em; opacity: 0.6; }
.lh-scene-hero[hidden], .lh-scene-detail[hidden], .lh-scene-grid[hidden] { display: none; }
`

export function createSceneFold(host: SceneFoldHost): SceneFold {
    const { el } = host

    const root = el('details', { class: 'lh-scene' }) as HTMLDetailsElement
    const summary = el('summary')
    summary.textContent = 'Scene'
    const body = el('div', { class: 'lh-scene-body' })
    const lead = el('div', { class: 'lh-world-lead' })
    lead.textContent = 'Where the party is, as the last reply’s Location footer names it, with a picture you set for the place; and who is present now — you, and every NPC the newest replies name, the window below deciding how many. A tile opens the entry.'
    const status = el('div', { class: 'lh-world-status lh-scene-status' })
    const hero = el('div', { class: 'lh-scene-hero', 'data-lh-field': 'scene-hero' })
    const heroInner = el('div', { class: 'lh-scene-hero-inner' })
    const overlay = el('div', { class: 'lh-scene-hero-overlay' })
    const title = el('div', { class: 'lh-scene-hero-title' })
    const crumb = el('div', { class: 'lh-scene-hero-crumb' })
    overlay.append(title, crumb)
    hero.append(heroInner, overlay)
    const tools = el('div', { class: 'lh-scene-tools' })
    // Icons alone, the words as the hover (78b, the maintainer's ask): the aria-label is the name a reader hears.
    const pickButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-scene-tool', 'aria-label': 'Set a picture for the place', title: 'Set a picture' }) as HTMLButtonElement
    pickButton.textContent = '🖼'
    const urlButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-scene-tool', 'aria-label': 'Set a picture for the place from an address', title: 'From an address' }) as HTMLButtonElement
    urlButton.textContent = '🔗'
    const forgetButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-scene-tool', 'aria-label': 'Forget the place’s picture', title: 'Forget the picture' }) as HTMLButtonElement
    forgetButton.textContent = '✖'
    const drawButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-scene-tool', 'aria-label': 'Draw the picture of the place', title: 'Draw the picture' }) as HTMLButtonElement
    drawButton.textContent = '🎨'
    const reload = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-scene-tool', 'aria-label': 'Re-read the scene', title: 'Re-read the scene' }) as HTMLButtonElement
    reload.textContent = '↻'
    tools.append(pickButton, urlButton, drawButton, forgetButton, reload)
    // The picture's settings (49): the legacy's Real-Time Mode.
    const pictureSettings = el('details', { class: 'lh-scene-picture-settings', 'data-lh-field': 'scene-picture-settings' }) as HTMLDetailsElement
    const pictureSummary = el('summary')
    pictureSummary.textContent = 'Drawing the picture'
    const pictureBody = el('div', { class: 'lh-scene-picture-body' })
    // The five dials (49), shared with their mirror in the settings (63b).
    const picture = createScenePictureSettings({ el, savePrefs: host.savePrefs, fail: host.fail })
    const connectionRow = el('label', { class: 'lh-scene-picture-row' })
    const connectionLabel = el('span')
    connectionLabel.textContent = 'Image connection'
    const connectionSelect = el('select', { class: 'lh-input', 'data-lh-field': 'scene-picture-connection' }) as HTMLSelectElement
    const connectionHint = el('span', { class: 'lh-conn-hint' })
    connectionRow.append(connectionLabel, connectionSelect, connectionHint)
    const promptLabel = el('div', { class: 'lh-scene-label' })
    promptLabel.textContent = 'The last prompt'
    const promptBox = el('div', { class: 'lh-scene-prompt', 'data-lh-field': 'scene-prompt' })
    promptBox.hidden = true
    promptLabel.hidden = true
    pictureBody.append(...picture.rows, connectionRow, promptLabel, promptBox)
    pictureSettings.append(pictureSummary, pictureBody)
    // The window (52): how many of the newest narrator replies the scan reads.
    const windowRow = el('label', { class: 'lh-scene-window' })
    const windowLabel = el('span')
    windowLabel.textContent = 'Replies the scan reads'
    const windowInput = el('input', { type: 'number', class: 'lh-input', min: '1', max: '20', step: '1', 'data-lh-field': 'scene-window-input', 'aria-label': 'How many of the newest narrator replies the scan reads' }) as HTMLInputElement
    windowInput.value = '3'
    windowInput.title = 'The newest narrator replies the name scan reads, 1 to 20. One is the legacy’s: the latest reply only.'
    windowInput.addEventListener('change', () => {
        const n = Math.min(Math.max(Math.floor(Number(windowInput.value) || 1), 1), 20)
        windowInput.value = String(n)
        host.savePrefs({ sceneLookback: n }).then(() => load()).catch(host.fail)
    })
    windowRow.append(windowLabel, windowInput)
    const label = el('div', { class: 'lh-scene-label' })
    label.textContent = 'Present now'
    const grid = el('div', { class: 'lh-scene-grid', 'data-lh-field': 'scene-present' })
    const detail = el('div', { class: 'lh-scene-detail', 'data-lh-field': 'scene-detail' })
    detail.hidden = true
    const live = el('div', { class: 'lh-world-running', hidden: 'hidden' })
    const note = el('div', { class: 'lh-world-note lh-scene-note' })
    // The live line sits under the buttons that start a draw and above the drawing fold (73f-bis, the maintainer's ask): at the foot it was off screen.
    // Multihog's order (78a): the hero, the site map, Present now with the scan's window beside its label. The drawing
    // settings are the Locations gear's (78b), opened from the Campaign Records; a host without a modal keeps them here.
    const siteMapSlot = el('div', { class: 'lh-scene-site-map', 'data-lh-field': 'scene-site-map' })
    const labelRow = el('div', { class: 'lh-scene-label-row' })
    labelRow.append(label, windowRow)
    body.append(lead, status, hero, tools, live, siteMapSlot, labelRow, grid, detail, note, pictureSettings)
    root.append(summary, body)

    let chatId: string | null = null
    let scene: SceneResult | null = null
    let loading: Promise<void> | null = null
    let running: string | null = null
    let opened: string | null = null
    let last: { text: string; error: boolean } | null = null
    /** The picture (49): a draw in flight for this chat, the connections as listed, and the chosen one. */
    let drawing: { path: string; at: string } | null = null
    /** A press of Draw in flight: the fold's own knowledge outranks a scene read's while it lasts. */
    let pressed = false
    let connectionId = ''
    let connections: SceneConnectionsResult | null = null
    let connectionsAsked = false

    function drawConnections(): void {
        connectionSelect.replaceChildren()
        const none = el('option', { value: '' }) as HTMLOptionElement
        none.textContent = connections?.connections.length ? 'The host’s default image connection' : connectionsAsked && connections ? (connections.unavailable ? 'The host’s default (the list could not be read)' : 'The host’s default (no connection is set up)') : 'The host’s default image connection'
        connectionSelect.append(none)
        for (const c of connections?.connections ?? []) {
            const option = el('option', { value: c.id }) as HTMLOptionElement
            option.textContent = `${c.name} — ${c.provider}${c.model ? ` · ${c.model}` : ''}${c.isDefault ? ' (default)' : ''}`
            connectionSelect.append(option)
        }
        if (connectionId && !connections?.connections.some((c) => c.id === connectionId)) {
            const kept = el('option', { value: connectionId }) as HTMLOptionElement
            kept.textContent = `${connectionId} (not in the list)`
            connectionSelect.append(kept)
        }
        connectionSelect.value = connectionId
        drawConnectionHint()
    }

    /**
     * What the host saves with the chosen connection and merges into every
     * draw (55-bis): the sizing the maintainer saw applied is this list, and
     * the metadata's keys are where the host's own panel may keep the rest.
     */
    function drawConnectionHint(): void {
        if (connections?.unavailable) { connectionHint.textContent = reasonText(connections.unavailable); return }
        const chosen = connections?.connections.find((c) => connectionId ? c.id === connectionId : c.isDefault) ?? null
        if (!chosen) { connectionHint.textContent = ''; return }
        const settings = chosen.settings?.length ? `Saved with it and applied to every draw: ${chosen.settings.join(', ')}.` : 'Nothing is saved with it beyond the model.'
        const metadata = chosen.metadata?.length ? ` Its record also carries: ${chosen.metadata.join(', ')}.` : ''
        connectionHint.textContent = `${settings}${metadata}`
    }

    function loadConnections(): void {
        if (connectionsAsked || !host.connections) return
        connectionsAsked = true
        host.connections()
            .then((result) => { connections = result })
            .catch((error) => { connections = { connections: [], unavailable: error instanceof Error ? error.message : String(error) } })
            .finally(drawConnections)
    }

    connectionSelect.addEventListener('change', () => { connectionId = connectionSelect.value; drawConnectionHint(); host.savePrefs({ scenePictureConnectionId: connectionId }).catch(host.fail) })
    pictureSettings.addEventListener('toggle', () => { if (pictureSettings.open) loadConnections() })

    function say(text: string, error = false): void {
        last = { text, error }
        drawState()
    }

    async function load(): Promise<void> {
        if (!chatId) return
        if (loading) return loading
        const asked = chatId
        loading = host.get()
            .then((result) => {
                if (chatId !== asked) return
                scene = result
                // The read says whether a draw is in flight (55-bis): adopted
                // and cleared from it, never kept from an earlier read — a
                // scene read mid-draw used to leave the live line standing
                // after the finish, under a green light.
                if (!pressed) drawing = result.drawing ? { path: result.drawing.path, at: result.drawing.at } : null
            })
            .catch((error) => { if (chatId === asked) { scene = null; last = { text: `The scene could not be read: ${reasonText(error instanceof Error ? error.message : String(error))}.`, error: true } } })
            .finally(() => { loading = null; drawState() })
        drawState()
        return loading
    }

    function showPrompt(prompt: string | undefined): void {
        promptBox.textContent = prompt ?? ''
        promptBox.hidden = !prompt
        promptLabel.hidden = !prompt
    }

    /** Draw the picture of the place (49): the button's and the large view's (80). */
    function drawPicture(): Promise<void> {
        if (!host.draw || running || drawing || !chatId || !scene?.location.storagePath) return Promise.resolve()
        const asked = chatId
        const leaf = scene.location.leaf || scene.location.storagePath
        drawing = { path: scene.location.storagePath, at: new Date().toISOString() }
        pressed = true
        last = null
        drawState()
        return host.draw()
            .then((result) => {
                if (chatId !== asked) return
                if (!result) { last = { text: 'Nothing was drawn.', error: false }; return }
                scene = result.scene
                last = describeDraw({ chatId: asked, path: result.path, leaf: result.leaf, at: result.at, trigger: 'pressed', outcome: 'drawn', prompt: result.prompt, provider: result.provider, model: result.model })
                showPrompt(result.prompt)
            })
            .catch((error) => {
                if (chatId !== asked) return
                last = { text: `The picture of ${leaf} could not be drawn: ${reasonText(error instanceof Error ? error.message : String(error))}.`, error: true }
            })
            .finally(() => { pressed = false; if (chatId === asked) { drawing = null; drawState() } })
    }
    drawButton.addEventListener('click', () => { drawPicture().catch(host.fail) })

    function act(what: string, call: () => Promise<SceneResult>, done: string): void {
        if (running || !chatId) return
        running = what
        last = null
        drawState()
        call()
            .then((result) => { scene = result; last = { text: done, error: false } })
            .catch((error) => { last = { text: `${what} failed: ${reasonText(error instanceof Error ? error.message : String(error))}.`, error: true } })
            .finally(() => { running = null; drawState() })
    }

    /** Set the picture from a file: the button's and the large view's (80). */
    function pickPicture(): Promise<void> {
        const path = scene?.location.storagePath
        if (!path) return Promise.resolve()
        return host.pickImage()
            .then((picked) => {
                // A pick that came back empty says so (66): the host's picker returns nothing both for a cancel
                // and for a file it refused, and a button that did nothing was the whole report.
                if (!picked) { say('No picture was picked.'); return }
                act('Setting the picture', () => host.setImage(path, picked.dataUrl, picked.filename), `The picture of ${scene?.location.leaf || path} is set.`)
            })
            .catch((error) => { say(`The picture could not be picked: ${reasonText(error instanceof Error ? error.message : String(error))}.`, true) })
    }
    function pastePicture(): Promise<void> {
        const path = scene?.location.storagePath
        if (!path || !host.askUrl) return Promise.resolve()
        return host.askUrl(scene?.location.image ?? '')
            .then((url) => {
                const src = url?.trim()
                if (!src) return
                act('Setting the picture', () => host.setImage(path, src), `The picture of ${scene?.location.leaf || path} is set.`)
            })
    }
    function forgetPicture(): Promise<void> {
        const path = scene?.location.storagePath
        if (path) act('Forgetting the picture', () => host.setImage(path, ''), `The picture of ${scene?.location.leaf || path} is forgotten.`)
        return Promise.resolve()
    }
    pickButton.addEventListener('click', () => { pickPicture().catch(host.fail) })
    urlButton.addEventListener('click', () => { pastePicture().catch(host.fail) })
    forgetButton.addEventListener('click', () => { forgetPicture().catch(host.fail) })

    /** The hero's buttons under the large view (80): the tools row's four, as they stand for the place on screen. */
    function pictureActions(): PictureActions | undefined {
        const location = scene?.location
        if (!location?.storagePath || !chatId) return undefined
        return {
            kind: 'picture',
            set: () => pickPicture(),
            ...(host.askUrl ? { url: () => pastePicture() } : {}),
            draw: host.draw ? () => drawPicture() : null,
            ...(location.image ? { remove: () => forgetPicture() } : {}),
            ...(host.draw ? {} : { note: 'This build cannot draw pictures.' }),
            fail: host.fail,
        }
    }
    reload.addEventListener('click', () => { load().catch(host.fail) })
    root.addEventListener('toggle', () => { if (root.open && !scene && !loading) load().catch(host.fail) })

    function drawHero(): void {
        heroInner.replaceChildren()
        const location = scene?.location
        const placeName = location?.leaf || location?.raw || 'The place'
        if (location?.image) {
            const img = el('img', { src: location.image, alt: location.leaf || 'The place', class: 'lh-scene-picture' })
            // A click opens it large (55): the hero is small, and a drawn picture deserves a look; its buttons under it (80).
            zoomable(img, location.image, placeName, host.enlarge, pictureActions)
            heroInner.append(img)
        } else {
            const placeholder = el('div', { class: 'lh-scene-hero-placeholder' })
            placeholder.textContent = '🗺️'
            // No picture yet (80): the box opens the large view with the ways to get one, once a place is named.
            zoomable(placeholder, '', placeName, host.enlarge, pictureActions)
            heroInner.append(placeholder)
        }
        title.textContent = location?.path ? location.leaf : location?.raw || 'Unknown location'
        crumb.textContent = location?.path ? location.breadcrumb : location?.raw || ''
        crumb.classList.toggle('lh-scene-hero-crumb--unresolved', !!location?.raw && !location.path)
        crumb.title = location?.raw && !location.path ? 'No place entry matches this name' : ''
        crumb.hidden = !crumb.textContent || (!!location?.path && location.breadcrumb === location.leaf)
    }

    function drawPresent(): void {
        grid.replaceChildren()
        const present = scene?.present ?? []
        if (!present.length) {
            const empty = el('div', { class: 'lh-scene-empty' })
            empty.textContent = scene ? `No player character linked and no NPCs named in the ${scene.window && scene.window > 1 ? `last ${scene.window} replies` : 'latest narrator output'}.` : loading ? 'Reading the scene…' : 'Open the fold to read the scene.'
            grid.append(empty)
            if (!scene || !present.length) { detail.hidden = true; opened = null }
            return
        }
        if (opened && !present.some((p) => p.id === opened)) opened = null
        for (const who of present) {
            const tile = el('button', { type: 'button', class: `lh-scene-tile${who.isPlayerCharacter ? ' lh-scene-tile--pc' : ''}`, 'aria-pressed': who.id === opened ? 'true' : 'false', 'aria-label': `${who.isPlayerCharacter ? 'You, ' : ''}${who.label}`, 'data-lh-present': who.id }) as HTMLButtonElement
            tile.title = who.isPlayerCharacter ? `${who.label} (the player character)` : who.label
            if (who.portrait) {
                tile.append(el('img', { src: who.portrait, alt: '', class: 'lh-scene-thumb' }))
            } else {
                const thumb = el('div', { class: 'lh-scene-thumb' })
                thumb.textContent = '👤'
                tile.append(thumb)
            }
            const name = el('div', { class: 'lh-scene-name' })
            name.textContent = who.label
            tile.append(name)
            const ago = describeAgo(who.ago, scene?.window)
            if (ago) {
                const when = el('div', { class: 'lh-scene-ago' })
                when.textContent = ago
                tile.append(when)
                tile.title += ` — named in ${ago}`
            }
            tile.addEventListener('click', () => { opened = opened === who.id ? null : who.id; drawState() })
            grid.append(tile)
        }
        const shown = present.find((p) => p.id === opened)
        detail.hidden = !shown
        detail.replaceChildren()
        if (shown) {
            const head = el('div', { class: 'lh-scene-detail-head' })
            const name = el('div', { class: 'lh-scene-detail-name' })
            name.textContent = shown.isPlayerCharacter ? `${shown.label} — the player character` : shown.label
            head.append(name)
            // The portrait large (65): the tile is a button that opens the
            // entry, so the picture opens from here, where the entry is.
            if (shown.portrait && host.enlarge) {
                const full = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-scene-full-portrait', 'data-lh-field': 'scene-full-portrait', 'aria-label': `Open the full portrait of ${shown.label}` }) as HTMLButtonElement
                full.textContent = '🖼️ Full portrait'
                const src = shown.portrait
                const title = shown.label
                full.addEventListener('click', () => { host.enlarge!(src, title, host.portraitActions?.(title)) })
                head.append(full)
            }
            const text = el('div')
            text.textContent = shown.content || 'The entry is empty.'
            detail.append(head, text)
        }
    }

    function drawState(): void {
        // A draw the backend reports with the scene (49), when the fold opened mid-draw.
        const busy = !!running || !!drawing
        const hasPlace = !!scene?.location.storagePath
        pickButton.disabled = busy || !hasPlace || !chatId
        urlButton.disabled = busy || !hasPlace || !chatId
        urlButton.hidden = !host.askUrl
        forgetButton.hidden = !scene?.location.image
        forgetButton.disabled = busy || !chatId
        reload.disabled = !!running || !!loading || !chatId
        windowInput.disabled = busy
        drawButton.hidden = !host.draw
        drawButton.disabled = busy || !hasPlace || !chatId
        status.textContent = scene ? describeSceneLocation(scene) : chatId ? (loading ? 'Reading the scene…' : 'Open the fold to read the scene.') : 'Open a chat first.'
        live.hidden = !busy
        live.textContent = running ? `${running}…` : drawing ? `Drawing the picture of ${drawing.path.split(' :: ').pop() || drawing.path}… one model call writes the prompt, then the image connection draws it.` : ''
        note.textContent = last?.text ?? (scene?.problem ? `A book could not be read: ${reasonText(scene.problem)}.` : '')
        note.classList.toggle('lh-world-note--error', !!last?.error || (!last && !!scene?.problem))
        drawHero()
        drawPresent()
        syncBackground()
    }

    // The chat background (73f): the current place's picture while the switch is on, nothing otherwise.
    let background = false
    function syncBackground(): void {
        host.setBackground?.(background && chatId ? scene?.location.image || null : null)
    }

    drawState()

    return {
        root,
        siteMapSlot,
        pictureSettings,
        setChat(id) {
            if (id !== chatId) {
                chatId = id
                scene = null
                opened = null
                last = null
                if (root.open && id) load().catch(host.fail)
            }
            drawState()
        },
        refresh: async () => { if (root.open) await load() },
        applyPrefs(prefs) {
            if (prefs.sceneLookback !== undefined) {
                const value = String(Math.min(Math.max(Math.floor(Number(prefs.sceneLookback) || 1), 1), 20))
                if (windowInput.value !== value) windowInput.value = value
            }
            picture.applyPrefs(prefs)
            if (prefs.scenePictureConnectionId !== undefined) { connectionId = prefs.scenePictureConnectionId; drawConnections() }
            if (prefs.portraitLocationBackground !== undefined) background = prefs.portraitLocationBackground === true
            drawState()
        },
        busy: () => !!running || !!drawing,
        drawingStarted(start) {
            if (!chatId || (start.chatId && start.chatId !== chatId)) return
            drawing = { path: start.path, at: start.at }
            drawState()
        },
        drawingFinished(report) {
            if (!chatId || (report.chatId && report.chatId !== chatId)) return
            drawing = null
            last = describeDraw(report)
            if (report.outcome === 'drawn') showPrompt(report.prompt)
            if (report.disabled) picture.setAuto(false)
            drawState()
            if (root.open) load().catch(host.fail)
        },
    }
}
