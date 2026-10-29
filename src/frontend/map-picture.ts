/**
 * The map on screen (roadmap row 9, Phase 34d): the picture in the Maps fold.
 *
 * The backend draws it (`map.view`): the party's site, or the one picked,
 * as the knowledge-filtered graph in SVG, the readable entries and the
 * site's evolution history, all under Reveal all. This module places them
 * and gives the picture its hands: drag to pan, a card on hovering a glyph
 * (pinned by a click), a click on a room that opens its entry below. The
 * legacy does the same in its Visuals panel and its Map Details popup;
 * here both are one block, since the panel is the one place AdventureTime has.
 */
import type { MapRawResult, MapRawSaveResult, MapViewResult } from '../protocol.js'
import { glyphCardHtml, overflowCardsHtml, parseOverflowCards } from '../tracker/graph-tips.js'

export interface MapPictureHost {
    el(tag: string, attrs?: Record<string, string>): HTMLElement
    /** The picture for a site; `''` asks for the party's. */
    load(siteRoot: string): Promise<MapViewResult>
    /** Reveal all, saved; the caller reloads afterwards. */
    setRevealAll(on: boolean): Promise<void>
    /** The raw JSON editor (71a): a site's document read and written. Absent on a build without it. */
    raw?: {
        get(siteRoot: string): Promise<MapRawResult>
        set(siteRoot: string, json: string): Promise<MapRawSaveResult>
    }
    fail(error: unknown): void
}

export interface MapPicture {
    root: HTMLElement
    /** The folds under the graph — Map entries, Evolution history, Raw JSON and its gate — as one box (78a), so Map Details can take them into the host's modal and put them back. */
    details: HTMLElement
    /** Ask again, for the site picked or the party's. Nothing is drawn until the answer. */
    refresh(): Promise<void>
    /** Forget the chat: nothing drawn, no site picked. */
    clear(): void
    /** The site picked in the bar, `''` for the party's. */
    chosenSite(): string
    destroy(): void
}

/** How far a pointer moves before a press is a pan rather than a click. */
export const PAN_THRESHOLD_PX = 5

/** The line over the picture, in words. */
export function describeMapView(result: MapViewResult | null, loading: boolean): string {
    if (!result) return loading ? 'Drawing the map…' : ''
    if (result.problem) return `The map could not be drawn: ${result.problem}`
    if (!result.siteRoot) {
        return result.sites.length
            ? 'The party is outside every mapped site. Pick one above to look at it.'
            : 'No site has a map yet; the picture appears once the architect has drawn one.'
    }
    const where = result.partyInside ? 'the party is in it' : 'the party is elsewhere'
    const drawn = result.rooms
        ? `${result.rooms} room${result.rooms === 1 ? '' : 's'} drawn, ${result.revealAll ? 'everything revealed' : 'as the party knows it'}.`
        : 'Nothing the party knows of it can be drawn yet.'
    return `${result.siteRoot}${result.kind ? ` (${result.kind})` : ''}: ${where}. ${drawn}`
}

/**
 * The picture's styles: the legacy's own rules for the graph, its cards and
 * its entries, scoped to the block, each colour the legacy's `--rt-map-*`
 * variable with Ember as its fallback (74g), so a body with no Map Theme
 * written is the look before the pass and the applier recolours every map
 * at once.
 */
export const MAP_PICTURE_CSS = `
.lh-map-picture { position: relative; display: flex; flex-direction: column; gap: 6px; }
.lh-map-bar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.lh-map-site-row { display: inline-flex; align-items: center; gap: 6px; font-size: 0.85em; }
.lh-map-site-row[hidden] { display: none; }
.lh-map-raw > summary { cursor: pointer; font-size: 0.85em; opacity: 0.8; }
.lh-map-raw[hidden], .lh-map-raw-gate[hidden] { display: none; }
.lh-map-raw-body { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.lh-map-raw-hint, .lh-map-raw-gate { font-size: 0.78em; opacity: 0.7; }
.lh-map-raw-text { width: 100%; box-sizing: border-box; font-family: var(--lh-font-mono, var(--lumiverse-font-mono, monospace)); font-size: 0.8em; resize: vertical; }
.lh-map-raw-bar { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.lh-map-raw-note { font-size: 0.8em; opacity: 0.85; overflow-wrap: anywhere; }
.lh-map-raw-note--error { color: var(--lumiverse-danger, #d9534f); opacity: 1; }
.lh-map-site { max-width: 16em; }
.lh-map-line:empty { display: none; }
.lh-map-scroll { overflow: auto; max-height: 260px; border: 1px solid var(--rt-map-frame, #ffaa00); border-radius: 8px; background-color: var(--rt-map-background, #0c0c0c); background-image: linear-gradient(var(--rt-map-background-overlay, rgba(12, 12, 12, 0.55)), var(--rt-map-background-overlay, rgba(12, 12, 12, 0.55))), var(--rt-map-background-image, none); background-position: center; background-size: cover; background-repeat: no-repeat; padding: 4px; cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none; }
.lh-map-scroll[hidden] { display: none; }
.lh-map-scroll--panning { cursor: grabbing; }
.lh-map-scroll .rt-dungeon-graph-svg { display: block; max-width: none; }
.lh-map-scroll .rt-dungeon-graph-edge { stroke: var(--rt-map-route, rgba(255, 170, 0, 0.48)); stroke-width: 1.6; }
.lh-map-scroll .rt-dungeon-graph-edge-locked, .lh-map-scroll .rt-dungeon-graph-edge-closed { stroke-dasharray: 5 4; stroke: var(--rt-map-route-locked, rgba(255, 170, 0, 0.72)); }
.lh-map-scroll .rt-dungeon-graph-edge-blocked, .lh-map-scroll .rt-dungeon-graph-edge-destroyed { stroke-dasharray: 2 3; stroke: var(--rt-map-route-blocked, rgba(234, 67, 53, 0.55)); }
.lh-map-scroll .rt-dungeon-graph-node rect, .lh-map-scroll .rt-dungeon-graph-node circle { fill: var(--rt-map-node, #161616); stroke: var(--rt-map-accent-medium, rgba(255, 170, 0, 0.55)); stroke-width: 1.2; }
.lh-map-scroll .rt-dungeon-graph-node text { fill: var(--rt-map-text, #f0f0f0); pointer-events: none; font-family: inherit; }
.lh-map-scroll .rt-dungeon-graph-node-discovered rect { fill: var(--rt-map-node-discovered, #101010); stroke: var(--rt-map-accent-soft, rgba(255, 170, 0, 0.28)); }
.lh-map-scroll .rt-dungeon-graph-node-discovered text { fill: var(--rt-map-text-muted, #c8c8c8); opacity: 0.78; }
.lh-map-scroll .rt-dungeon-graph-node-fog circle { fill: var(--rt-map-node-fog, #0a0a0a); stroke: var(--rt-map-accent-faint, rgba(255, 170, 0, 0.18)); stroke-dasharray: 2 2; }
.lh-map-scroll .rt-dungeon-graph-node-fog text { fill: var(--rt-map-accent-medium, rgba(255, 170, 0, 0.45)); font-size: 10px; }
.lh-map-scroll .rt-dungeon-graph-node-current rect { fill: var(--rt-map-node-discovered, #0e0e0e); stroke: var(--rt-map-accent, #ffaa00); stroke-width: 2.2; }
.lh-map-scroll .rt-dungeon-graph-node-current text { fill: var(--rt-map-accent, #ffaa00); font-weight: 700; }
.lh-map-scroll .rt-dungeon-graph-node-revealed { cursor: pointer; }
.lh-map-scroll .rt-dungeon-graph-node-revealed:focus { outline: none; }
.lh-map-scroll .rt-dungeon-graph-node-revealed:focus-visible rect { stroke: #ffffff; }
.lh-map-scroll .rt-dungeon-graph-icon { pointer-events: none; color: var(--rt-map-accent, #ffaa00); }
.lh-map-scroll .rt-dungeon-graph-node .rt-dungeon-graph-icon-art { fill: currentColor; stroke: none; pointer-events: none !important; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; -webkit-mask-position: center; mask-position: center; -webkit-mask-size: contain; mask-size: contain; }
.lh-map-scroll .rt-dungeon-graph-node .rt-dungeon-graph-icon-hit, .lh-map-scroll .rt-dungeon-graph-node .rt-dungeon-graph-icon-overflow-hit { fill: transparent; stroke: none; pointer-events: all; cursor: help; }
.lh-map-scroll .rt-dungeon-graph-icon path { pointer-events: none; }
.lh-map-scroll .rt-dungeon-graph-icon-creature, .lh-map-scroll .rt-dungeon-graph-icon-stressed { color: var(--rt-map-creature, #ffffff); }
.lh-map-scroll .rt-dungeon-graph-icon-group { color: var(--rt-map-group, #ffffff); }
.lh-map-scroll .rt-dungeon-graph-icon-trap { color: var(--rt-map-trap, #ff5a2a); }
.lh-map-scroll .rt-dungeon-graph-icon-hazard { color: var(--rt-map-hazard, #ffc53d); }
.lh-map-scroll .rt-dungeon-graph-icon-alarm { color: var(--rt-map-alarm, #ffaa00); }
.lh-map-scroll .rt-dungeon-graph-icon-barrier { color: var(--rt-map-barrier, #e8d5b0); }
.lh-map-scroll .rt-dungeon-graph-icon-object { color: var(--rt-map-object, #d4a574); }
.lh-map-scroll .rt-dungeon-graph-icon-loot { color: var(--rt-map-loot, #ffcc4a); }
.lh-map-scroll .rt-dungeon-graph-icon-effect { color: var(--rt-map-effect, #ff9a5c); }
.lh-map-scroll .rt-dungeon-graph-icon-other { color: var(--rt-map-other, #c8925a); }
.lh-map-scroll .rt-dungeon-graph-icon-deactivated, .lh-map-scroll .rt-dungeon-graph-icon-spent { opacity: 0.82; }
.lh-map-scroll .rt-dungeon-graph-icon-destroyed, .lh-map-scroll .rt-dungeon-graph-icon-dead { opacity: 0.7; }
.lh-map-scroll .rt-dungeon-graph-icon-suspected { opacity: 0.88; }
.lh-map-scroll .rt-dungeon-graph-icon-unrevealed { opacity: 0.55; }
.lh-map-scroll .rt-dungeon-graph-icon-overflow { pointer-events: none; }
.lh-map-scroll .rt-dungeon-graph-icon-overflow text { fill: #e8e8e8; pointer-events: none; }
.lh-map-tip { position: absolute; z-index: 5; min-width: 148px; max-width: 260px; padding: 7px 8px 8px; border: 1px solid var(--rt-map-accent-medium, rgba(255, 170, 0, 0.45)); border-radius: 8px; background: var(--rt-map-textbox, #0c0c0c); box-shadow: 0 10px 24px rgba(0, 0, 0, 0.55); color: var(--rt-map-text, #e8e8e8); font-size: 12px; line-height: 1.35; pointer-events: none; }
.lh-map-tip[hidden] { display: none; }
.lh-map-tip::after { content: ''; position: absolute; left: var(--lh-map-tip-arrow, 50%); top: 100%; transform: translateX(-50%); border: 6px solid transparent; border-top-color: var(--rt-map-accent-medium, rgba(255, 170, 0, 0.45)); }
.lh-map-tip--below::after { top: auto; bottom: 100%; border-top-color: transparent; border-bottom-color: var(--rt-map-accent-medium, rgba(255, 170, 0, 0.45)); }
.lh-map-tip .rt-dungeon-graph-asset-tip-head { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; color: var(--rt-map-accent, #ffaa00); }
.lh-map-tip .rt-dungeon-graph-asset-tip-head strong { font-weight: 650; color: var(--rt-map-text, #e8e8e8); }
.lh-map-tip .rt-dungeon-graph-asset-tip-detail { margin-top: 5px; font-size: 11px; line-height: 1.4; opacity: 0.88; }
.lh-map-tip .rt-dungeon-graph-overflow-tip { display: flex; flex-direction: column; gap: 6px; }
.lh-map-tip .rt-dungeon-graph-overflow-tip-item + .rt-dungeon-graph-overflow-tip-item { border-top: 1px solid var(--rt-map-accent-medium, rgba(255, 170, 0, 0.25)); padding-top: 6px; }
.lh-map-picture .rt-dungeon-map-tag { display: inline-flex; padding: 1px 5px; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 999px; font-size: 0.72em; letter-spacing: 0.04em; text-transform: uppercase; opacity: 0.85; }
.lh-map-picture .rt-dungeon-map-state { border-color: var(--rt-map-accent-medium, rgba(255, 170, 0, 0.45)); }
.lh-map-picture .rt-dungeon-map-knowledge { border-color: rgba(125, 211, 252, 0.45); }
.lh-map-entries > summary, .lh-map-history > summary { cursor: pointer; font-size: 0.85em; opacity: 0.8; }
.lh-map-entries[hidden], .lh-map-history[hidden] { display: none; }
.lh-map-entries-body, .lh-map-history-body { margin-top: 6px; font-size: 0.8em; }
.lh-map-entries-body i.fa-solid { display: none; }
.lh-map-entries-body .rt-dungeon-map-summary { display: flex; gap: 6px; margin-bottom: 8px; }
.lh-map-entries-body .rt-dungeon-map-area-list { display: flex; flex-direction: column; gap: 9px; }
.lh-map-entries-body .rt-dungeon-map-area { padding: 9px 10px; border: 1px solid rgba(125, 211, 252, 0.2); border-radius: 9px; background: rgba(0, 0, 0, 0.22); }
.lh-map-entries-body .rt-dungeon-map-area.lh-map-area-picked { border-color: var(--rt-map-accent, #ffaa00); box-shadow: 0 0 0 1px var(--rt-map-accent-soft, rgba(255, 170, 0, 0.4)); }
.lh-map-entries-body .rt-dungeon-map-area-head, .lh-map-entries-body .rt-dungeon-map-asset-head { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.lh-map-entries-body .rt-dungeon-map-area-head { margin-bottom: 6px; color: #bae6fd; }
.lh-map-entries-body .rt-dungeon-map-section-label { display: block; margin: 7px 0 4px; font-size: 0.8em; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.7; }
.lh-map-entries-body .rt-dungeon-map-geometry { margin: 0; padding-left: 18px; line-height: 1.45; }
.lh-map-entries-body .rt-dungeon-map-empty { opacity: 0.7; font-style: italic; }
.lh-map-entries-body .rt-dungeon-map-connections { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.lh-map-entries-body .rt-dungeon-map-route { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 5px; padding: 3px 6px; border-radius: 5px; background: rgba(94, 184, 212, 0.09); }
.lh-map-entries-body .rt-dungeon-map-route::before { content: '\\2192'; opacity: 0.7; }
.lh-map-entries-body .rt-dungeon-map-route-detail { opacity: 0.65; }
.lh-map-entries-body .rt-dungeon-map-assets { margin-top: 7px; padding-top: 1px; border-top: 1px solid rgba(255, 255, 255, 0.07); }
.lh-map-entries-body .rt-dungeon-map-asset { margin-top: 5px; padding: 6px 8px; border-left: 3px solid rgba(212, 169, 64, 0.65); border-radius: 5px; background: rgba(212, 169, 64, 0.07); }
.lh-map-entries-body .rt-dungeon-map-asset-head { color: #f6dda0; }
.lh-map-entries-body .rt-dungeon-map-asset-detail { margin-top: 3px; }
.lh-map-entries-body .rt-dungeon-map-asset-meta { margin-top: 3px; opacity: 0.8; font-size: 0.92em; }
.lh-map-entries-body .rt-dungeon-map-meta-sep { margin: 0 5px; opacity: 0.5; }
.lh-map-entries-body .rt-dungeon-map-contained { margin-left: 8px; }
.lh-map-entries-body .rt-dungeon-map-unplaced { opacity: 0.85; }
.lh-map-history-body { display: flex; flex-direction: column; gap: 6px; }
.lh-map-history-entry { padding: 6px 8px; border-left: 3px solid rgba(125, 211, 252, 0.4); border-radius: 5px; background: rgba(0, 0, 0, 0.22); }
.lh-map-history-commit { border-left-color: var(--rt-map-accent-strong, rgba(255, 170, 0, 0.7)); }
.lh-map-history-head { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-weight: 600; }
.lh-map-history-head time { opacity: 0.75; font-weight: 400; }
.lh-map-history-elapsed { opacity: 0.7; font-size: 0.92em; }
.lh-map-history-summary { margin-top: 2px; }
.lh-map-history-entry code { font-size: 0.85em; opacity: 0.7; }
.lh-map-history-empty { opacity: 0.75; font-style: italic; }
`

function glyphOf(target: EventTarget | null): Element | null {
    return target instanceof Element ? target.closest('.rt-dungeon-graph-icon, .rt-dungeon-graph-icon-overflow') : null
}

export function createMapPicture(host: MapPictureHost): MapPicture {
    const { el } = host
    const root = el('div', { class: 'lh-map-picture' })
    const bar = el('div', { class: 'lh-map-bar' })
    const siteRow = el('label', { class: 'lh-map-site-row', 'data-lh-field': 'map-site' })
    const siteLabel = el('span')
    siteLabel.textContent = 'Site'
    const site = el('select', { class: 'lh-input lh-map-site' }) as HTMLSelectElement
    siteRow.append(siteLabel, site)
    const revealRow = el('label', { class: 'lh-world-switch lh-map-reveal', 'data-lh-field': 'map-reveal-all' })
    const reveal = el('input', { type: 'checkbox' }) as HTMLInputElement
    const revealText = el('span')
    revealText.textContent = 'Reveal all'
    revealRow.title = 'Draw what the party has not learned too: every room, every thing in them, and what each evolution pass did. Off, the picture is what the party knows.'
    revealRow.append(reveal, revealText)
    bar.append(siteRow, revealRow)
    const line = el('div', { class: 'lh-world-status lh-map-line' })
    const scroll = el('div', { class: 'lh-map-scroll' })
    const tip = el('div', { class: 'lh-map-tip', hidden: 'hidden' })
    const entriesView = el('details', { class: 'lh-map-entries' })
    const entriesSummary = el('summary')
    entriesSummary.textContent = 'Map entries'
    const entriesBody = el('div', { class: 'lh-map-entries-body' })
    entriesView.append(entriesSummary, entriesBody)
    const historyView = el('details', { class: 'lh-map-history' })
    const historySummary = el('summary')
    historySummary.textContent = 'Evolution history'
    const historyBody = el('div', { class: 'lh-map-history-body' })
    historyView.append(historySummary, historyBody)
    // The raw JSON editor (71a): Multihog's </> Raw JSON tab, offered with Reveal all on, as the legacy gates it.
    const rawView = el('details', { class: 'lh-map-raw', 'data-lh-field': 'map-raw' }) as HTMLDetailsElement
    const rawSummary = el('summary')
    rawSummary.textContent = 'Raw JSON'
    const rawBody = el('div', { class: 'lh-map-raw-body' })
    const rawHint = el('div', { class: 'lh-map-raw-hint' })
    rawHint.textContent = 'The site’s whole map document, to edit by hand. Save writes it back into the Location entry after a check of its shape; the party’s knowledge, the clocks and the history stand as they are.'
    const rawText = el('textarea', { class: 'lh-input lh-map-raw-text', rows: '14', spellcheck: 'false', 'aria-label': 'Map JSON editor' }) as HTMLTextAreaElement
    const rawBar = el('div', { class: 'lh-map-raw-bar' })
    const rawSave = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'map-raw-save' }) as HTMLButtonElement
    rawSave.textContent = 'Save JSON'
    const rawReload = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'map-raw-reload' }) as HTMLButtonElement
    rawReload.textContent = 'Reload'
    const rawNote = el('span', { class: 'lh-map-raw-note' })
    rawBar.append(rawSave, rawReload, rawNote)
    rawBody.append(rawHint, rawText, rawBar)
    rawView.append(rawSummary, rawBody)
    const rawGate = el('div', { class: 'lh-map-raw-gate', hidden: 'hidden' })
    rawGate.textContent = 'Turn on Reveal all to edit the raw JSON.'
    const details = el('div', { class: 'lh-map-details' })
    details.append(entriesView, historyView, rawView, rawGate)
    root.append(bar, line, scroll, tip, details)
    let rawFor = ''
    let rawBusy = false
    let rawLast: { text: string; error: boolean } | null = null

    let result: MapViewResult | null = null
    let chosen = ''
    let loading = false
    let destroyed = false
    let generation = 0

    function draw(): void {
        hideTip()
        const sites = result?.sites ?? []
        site.replaceChildren()
        const party = el('option', { value: '' }) as HTMLOptionElement
        party.textContent = 'Where the party is'
        site.append(party)
        for (const s of sites) {
            const option = el('option', { value: s.siteRoot }) as HTMLOptionElement
            option.textContent = s.kind ? `${s.siteRoot} (${s.kind})` : s.siteRoot
            site.append(option)
        }
        site.value = chosen
        siteRow.hidden = !sites.length
        site.disabled = loading
        reveal.checked = !!result?.revealAll
        reveal.disabled = loading || !result
        line.textContent = describeMapView(result, loading)
        line.classList.toggle('lh-world-note--error', !!result?.problem)
        const svg = result?.svg ?? ''
        scroll.innerHTML = svg
        scroll.hidden = !svg
        scroll.scrollLeft = 0
        scroll.scrollTop = 0
        entriesBody.innerHTML = result?.entries ?? ''
        entriesView.hidden = !result?.entries
        historyBody.innerHTML = result?.history ?? ''
        historyView.hidden = !result?.history
        const editable = !!host.raw && !!result?.siteRoot && !result.problem
        rawView.hidden = !editable || !result?.revealAll
        rawGate.hidden = !editable || !!result?.revealAll
        if (rawFor && rawFor !== result?.siteRoot) { rawFor = ''; rawText.value = ''; rawLast = null }
        rawSave.disabled = rawBusy || loading
        rawReload.disabled = rawBusy || loading
        rawNote.textContent = rawLast?.text ?? ''
        rawNote.classList.toggle('lh-map-raw-note--error', !!rawLast?.error)
    }

    /** The document read for the site drawn; the box keeps an unsaved edit until the site changes. */
    async function loadRaw(): Promise<void> {
        if (!host.raw || !result?.siteRoot) return
        const site = result.siteRoot
        rawBusy = true
        draw()
        try {
            const answer = await host.raw.get(site)
            if (destroyed) return
            rawFor = answer.siteRoot
            rawText.value = answer.json
            rawLast = null
        } catch (error) {
            if (destroyed) return
            rawLast = { text: `The map could not be read: ${error instanceof Error ? error.message : String(error)}`, error: true }
        } finally {
            if (!destroyed) { rawBusy = false; draw() }
        }
    }

    async function saveRaw(): Promise<void> {
        if (!host.raw || !result?.siteRoot) return
        const site = result.siteRoot
        rawBusy = true
        draw()
        try {
            const saved = await host.raw.set(site, rawText.value)
            if (destroyed) return
            rawBusy = false
            await refresh()
            await loadRaw()
            if (destroyed) return
            rawLast = { text: `Saved: ${saved.areas} areas, ${saved.assets} things in them.`, error: false }
        } catch (error) {
            if (destroyed) return
            rawLast = { text: error instanceof Error ? error.message : String(error), error: true }
        } finally {
            if (!destroyed) { rawBusy = false; draw() }
        }
    }

    rawView.addEventListener('toggle', () => { if (rawView.open && !rawBusy && rawFor !== result?.siteRoot) loadRaw().catch(host.fail) })
    rawReload.addEventListener('click', () => { loadRaw().catch(host.fail) })
    rawSave.addEventListener('click', () => { saveRaw().catch(host.fail) })

    async function refresh(): Promise<void> {
        const asked = ++generation
        loading = true
        draw()
        try {
            const answer = await host.load(chosen)
            if (destroyed || asked !== generation) return
            result = answer
        } catch (error) {
            if (destroyed || asked !== generation) return
            result = { siteRoot: '', kind: '', partyInside: false, rooms: 0, svg: '', entries: '', history: '', revealAll: !!result?.revealAll, currentLocation: '', sites: result?.sites ?? [], problem: error instanceof Error ? error.message : String(error) }
        } finally {
            if (!destroyed && asked === generation) {
                loading = false
                draw()
            }
        }
    }

    site.addEventListener('change', () => {
        chosen = site.value
        refresh().catch(host.fail)
    })
    reveal.addEventListener('change', () => {
        const on = reveal.checked
        reveal.disabled = true
        host.setRevealAll(on).catch(host.fail)
    })

    // ── the cards ────────────────────────────────────────────────────────
    let pinned: Element | null = null
    let shown: Element | null = null

    function hideTip(): void {
        tip.hidden = true
        tip.replaceChildren()
        shown = null
        pinned = null
    }

    function showTip(glyph: Element): void {
        if (shown === glyph) return
        const html = glyph.classList.contains('rt-dungeon-graph-icon-overflow')
            ? overflowCardsHtml(parseOverflowCards(glyph.getAttribute('data-overflow-assets')))
            : glyphCardHtml({ name: glyph.getAttribute('data-asset-name'), kind: glyph.getAttribute('data-asset-kind'), state: glyph.getAttribute('data-asset-state'), knowledge: glyph.getAttribute('data-asset-knowledge'), detail: glyph.getAttribute('data-asset-detail'), count: glyph.getAttribute('data-asset-count') })
        if (!html) return
        tip.innerHTML = html
        tip.hidden = false
        shown = glyph
        // Over the glyph, kept inside the picture's width; below it when there is no room above.
        const box = root.getBoundingClientRect()
        const at = glyph.getBoundingClientRect()
        const width = tip.offsetWidth || 0
        const height = tip.offsetHeight || 0
        const centre = at.left - box.left + at.width / 2
        const left = Math.max(0, Math.min(Math.round(centre - width / 2), Math.max(0, Math.round(box.width - width))))
        const above = at.top - box.top - height - 8
        const below = above < 0
        tip.classList.toggle('lh-map-tip--below', below)
        tip.style.left = `${left}px`
        tip.style.top = `${Math.round(below ? at.top - box.top + at.height + 8 : above)}px`
        tip.style.setProperty('--lh-map-tip-arrow', `${Math.round(centre - left)}px`)
    }

    scroll.addEventListener('pointerover', (event) => {
        const glyph = glyphOf(event.target)
        if (glyph && !pinned) showTip(glyph)
    })
    scroll.addEventListener('pointerout', (event) => {
        if (pinned) return
        const glyph = glyphOf(event.target)
        if (glyph && glyph === shown && !(event.relatedTarget instanceof Element && glyph.contains(event.relatedTarget))) hideTip()
    })

    // ── the pan ──────────────────────────────────────────────────────────
    let dragging = false
    let moved = false
    let startX = 0
    let startY = 0
    let startLeft = 0
    let startTop = 0
    let panned = false
    let pointer = 0

    scroll.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return
        dragging = true
        moved = false
        startX = event.clientX
        startY = event.clientY
        startLeft = scroll.scrollLeft
        startTop = scroll.scrollTop
        pointer = event.pointerId
    })
    scroll.addEventListener('pointermove', (event) => {
        if (!dragging) return
        const dx = event.clientX - startX
        const dy = event.clientY - startY
        if (!moved && (Math.abs(dx) > PAN_THRESHOLD_PX || Math.abs(dy) > PAN_THRESHOLD_PX)) {
            moved = true
            scroll.classList.add('lh-map-scroll--panning')
            hideTip()
            // Capture the pointer only once this is a drag. Captured from the
            // press, the release is retargeted to the box, and so is the click
            // that follows: a press on a room then opens nothing (34d-bis).
            try { scroll.setPointerCapture?.(pointer) } catch { /* the host may not support capture */ }
        }
        if (!moved) return
        scroll.scrollLeft = startLeft - dx
        scroll.scrollTop = startTop - dy
        event.preventDefault()
    })
    const endDrag = (event: PointerEvent): void => {
        if (!dragging) return
        dragging = false
        scroll.classList.remove('lh-map-scroll--panning')
        try { scroll.releasePointerCapture?.(event.pointerId) } catch { /* ignore */ }
        panned = moved
    }
    scroll.addEventListener('pointerup', endDrag)
    scroll.addEventListener('pointercancel', endDrag)
    scroll.addEventListener('dragstart', (event) => event.preventDefault())

    // ── the clicks ───────────────────────────────────────────────────────
    scroll.addEventListener('click', (event) => {
        if (panned) {
            panned = false
            event.preventDefault()
            return
        }
        const glyph = glyphOf(event.target)
        if (glyph) {
            event.preventDefault()
            if (pinned === glyph) { hideTip(); return }
            showTip(glyph)
            pinned = glyph
            return
        }
        const node = event.target instanceof Element ? event.target.closest('.rt-dungeon-graph-node-revealed') : null
        if (!node) return
        event.preventDefault()
        const name = node.querySelector('text')?.textContent ?? ''
        const id = node.getAttribute('data-area-id') ?? ''
        openEntry(id, name)
    })
    scroll.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        const node = event.target instanceof Element ? event.target.closest('.rt-dungeon-graph-node-revealed') : null
        if (!node) return
        event.preventDefault()
        openEntry(node.getAttribute('data-area-id') ?? '', node.querySelector('text')?.textContent ?? '')
    })

    /** The entry of the room clicked: the entries fold opens and the room's section is marked. */
    function openEntry(areaId: string, label: string): void {
        if (!result?.entries) return
        const path = result.svg.match(new RegExp(`data-area-id="${areaId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" data-area-path="([^"]*)"`))?.[1] ?? ''
        const name = path ? path.slice(path.lastIndexOf(' :: ') + 4) : label.replace(/…$/, '')
        const sections = Array.from(entriesBody.querySelectorAll('.rt-dungeon-map-area'))
        const picked = sections.find((s) => (s.querySelector('.rt-dungeon-map-area-head strong')?.textContent ?? '') === name)
            ?? sections.find((s) => (s.querySelector('.rt-dungeon-map-area-head strong')?.textContent ?? '').startsWith(name))
        for (const s of sections) s.classList.toggle('lh-map-area-picked', s === picked)
        if (!picked) return
        ;(entriesView as HTMLDetailsElement).open = true
        if (typeof (picked as HTMLElement).scrollIntoView === 'function') (picked as HTMLElement).scrollIntoView({ block: 'nearest' })
    }

    const onDocumentPointerDown = (event: Event): void => {
        if (!pinned) return
        if (tip.contains(event.target as Node) || glyphOf(event.target)) return
        hideTip()
    }
    root.ownerDocument?.addEventListener('pointerdown', onDocumentPointerDown, true)

    draw()
    return {
        root,
        details,
        refresh,
        clear() {
            generation++
            result = null
            chosen = ''
            loading = false
            draw()
        },
        chosenSite: () => chosen,
        destroy() {
            destroyed = true
            root.ownerDocument?.removeEventListener('pointerdown', onDocumentPointerDown, true)
        },
    }
}
