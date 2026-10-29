/**
 * The Testing Ground (Phase 71d, roadmap row 71): Multihog's 🧪 popup as
 * the last sub-fold of Evolution.
 *
 * Advance time, spawn or kill entities with causes, and run Evolution
 * without playing through the campaign: the legacy's popup
 * (`src/ui/panel/panel-map-evolution-debug.js`) drawn as a fold, in its
 * words, over the backend's sandbox. It reads the site when opened and
 * after every action, and the assets on the right open the arc on a click.
 */

import type { MapSandboxOutcome, MapSandboxResult, SandboxThread } from '../protocol.js'

export interface SandboxFoldHost {
    el(tag: string, attrs?: Record<string, string>): HTMLElement
    get(siteRoot?: string, arcSubject?: string): Promise<MapSandboxResult>
    time(request: { label: string } | { minutes: number }): Promise<MapSandboxOutcome>
    add(request: Record<string, string>): Promise<MapSandboxOutcome>
    set(request: Record<string, string>): Promise<MapSandboxOutcome>
    evolve(siteRoot: string): Promise<MapSandboxOutcome>
    simulate(request: { siteRoot: string; ticks: number; hoursPerTick: number }): Promise<MapSandboxOutcome>
    undo(): Promise<MapSandboxOutcome>
    redo(): Promise<MapSandboxOutcome>
    clear(siteRoot: string): Promise<MapSandboxOutcome>
    /** The clear's confirm; absent, it goes ahead. */
    confirm?(message: string): Promise<boolean>
    fail(error: unknown): void
    /** After an action that changed the map or the clock: the Maps fold reads again. */
    onChanged?(): void
}

export interface SandboxFold {
    root: HTMLDetailsElement
    setChat(chatId: string | null): void
    load(siteRoot?: string): Promise<void>
    /** A simulate's tick, from the backend's event. */
    progress(tick: { chatId?: string; index: number; count: number; timeLabel: string; phase: string }): void
    /** Whether a sandbox action is in flight. */
    busy(): boolean
}

export const SANDBOX_LEAD = 'Advance time, spawn or kill entities with causes, and run Evolution without playing through the campaign. Changes write to this chat’s maps and [TIME] block. After a pass, Undo restores the map, [TIME], Last Evolved, and Evolution memory to immediately before that run so you can Redo the same pass. Clear evolution history before comparing prompts so prior ticks do not bias the next pass.'

const OUTCOME_WORDS = {
    busy: 'An agent is already running.',
}

/** The memory bar's status line: the legacy's three. */
export function memoryStatus(memory: MapSandboxResult['memory']): string {
    if (!memory.compressEnabled) return 'Compression off'
    return memory.overThreshold
        ? 'At or over threshold — this Evolution pass will compress closed threads after it records'
        : 'Under threshold — closed history is kept verbatim'
}

/** The words an outcome gets, by the action: the legacy's status lines. */
export function outcomeWords(action: 'evolve' | 'simulate' | 'undo' | 'redo' | 'set-time' | 'advance' | 'add' | 'set' | 'clear', result: MapSandboxOutcome, context: { siteRoot: string; lastType?: 'evolve' | 'simulate' } = { siteRoot: '' }): string {
    if (!result.ok) return result.skipped === 'busy' ? OUTCOME_WORDS.busy : result.error || `${action} failed.`
    switch (action) {
        case 'set-time': return `Time set to ${result.timeLabel ?? ''}.`
        case 'advance': return `Advanced to ${result.timeLabel ?? ''}.`
        case 'add': return 'Entity added.'
        case 'set': return 'Entity updated.'
        case 'clear': return `Cleared evolution history for ${context.siteRoot}.`
        case 'evolve': return result.applied ? `Evolution applied ${result.applied} material update(s). Undo to rewind that pass.` : 'Evolution ran; no material change. Undo to rewind that pass.'
        case 'simulate': return `Simulated ${result.ticks ?? 0} tick(s) of ${result.hoursPerTick ?? 0}h. Undo to rewind that run.`
        case 'undo': return `Undid ${result.action?.type === 'simulate' ? 'Simulate ticks' : 'Evolve'} on ${result.action?.siteRoot ?? context.siteRoot}. Redo to run that same pass again.`
        case 'redo':
            if (result.action?.type === 'simulate') return `Redid Simulate: ${result.ticks ?? 0} tick(s) of ${result.hoursPerTick ?? 0}h.`
            return result.applied ? `Redid Evolve: applied ${result.applied} material update(s).` : 'Redid Evolve; no material change.'
    }
}

function badge(entry: Pick<SandboxThread, 'compressed' | 'status'>): { label: string; cls: string } {
    if (entry.compressed) return { label: 'DIGEST', cls: 'lh-sandbox-badge--compressed' }
    const status = String(entry.status || 'open')
    return { label: status.toUpperCase(), cls: `lh-sandbox-badge--${status}` }
}

function prettyJson(value: unknown): string {
    try { return JSON.stringify(value, null, 2) } catch { return String(value ?? '') }
}

export function createSandboxFold(host: SandboxFoldHost): SandboxFold {
    const { el } = host
    const root = el('details', { class: 'lh-sandbox', 'data-lh-field': 'sandbox' }) as HTMLDetailsElement
    const summary = el('summary')
    summary.textContent = '🧪 Testing ground'
    const body = el('div', { class: 'lh-world-body lh-sandbox-body' })
    root.append(summary, body)

    let chatId: string | null = null
    let view: MapSandboxResult | null = null
    let siteRoot = ''
    let arcSubject = ''
    let inFlight = false

    const lead = el('div', { class: 'lh-world-lead' })
    lead.textContent = SANDBOX_LEAD
    const siteRow = el('label', { class: 'lh-sandbox-site' })
    const siteSelect = el('select', { class: 'lh-input', 'data-lh-field': 'sandbox-site' }) as HTMLSelectElement
    siteRow.append(document.createTextNode('Site '), siteSelect)
    const stats = el('div', { class: 'lh-sandbox-stats', 'data-lh-field': 'sandbox-stats' })
    const memoryBar = el('div', { class: 'lh-sandbox-stats', 'data-lh-field': 'sandbox-memory' })
    const memoryLine = el('div', { class: 'lh-sandbox-memory-status', 'data-lh-field': 'sandbox-memory-status' })

    // ── time ─────────────────────────────────────────────────────────────
    const timeRow = el('div', { class: 'lh-sandbox-row' })
    const timeInput = el('input', { type: 'text', class: 'lh-input', placeholder: 'Set time, e.g. Day 3, 08:00', 'data-lh-field': 'sandbox-set-time' }) as HTMLInputElement
    const setTimeButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'sandbox-set-time-go' }) as HTMLButtonElement
    setTimeButton.textContent = 'Set time'
    const hoursInput = el('input', { type: 'number', class: 'lh-input lh-input--short', min: '1', max: '168', title: 'Hours to advance', 'data-lh-field': 'sandbox-hours' }) as HTMLInputElement
    const advanceButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'sandbox-advance' }) as HTMLButtonElement
    advanceButton.textContent = 'Advance hours'
    const dayButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'sandbox-day' }) as HTMLButtonElement
    dayButton.textContent = '+1 day'
    timeRow.append(timeInput, setTimeButton, hoursInput, advanceButton, dayButton)

    // ── the passes ───────────────────────────────────────────────────────
    const passRow = el('div', { class: 'lh-sandbox-row' })
    const evolveButton = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'sandbox-evolve' }) as HTMLButtonElement
    evolveButton.textContent = '✨ Evolve this map now'
    const ticksInput = el('input', { type: 'number', class: 'lh-input lh-input--short', min: '1', max: '20', value: '3', title: 'How many simulate ticks', 'data-lh-field': 'sandbox-ticks' }) as HTMLInputElement
    const simulateButton = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'sandbox-simulate' }) as HTMLButtonElement
    simulateButton.textContent = '⏩ Simulate ticks'
    const undoButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'sandbox-undo' }) as HTMLButtonElement
    undoButton.textContent = '↶ Undo last pass'
    undoButton.title = 'Restore map, [TIME], Last Evolved, and Evolution memory to immediately before the last Evolve or Simulate run.'
    const redoButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'sandbox-redo' }) as HTMLButtonElement
    redoButton.textContent = '↷ Redo last pass'
    redoButton.title = 'Restore the pre-pass snapshot, then run that same Evolve or Simulate again.'
    const clearButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'sandbox-clear' }) as HTMLButtonElement
    clearButton.textContent = '🧹 Clear evolution history'
    clearButton.title = 'Clears backlog and causal threads for this site. Does not change the map, [TIME], or Last Evolved.'
    passRow.append(evolveButton, ticksInput, simulateButton, undoButton, redoButton, clearButton)
    const status = el('div', { class: 'lh-sandbox-status', 'data-lh-field': 'sandbox-status', role: 'status' })

    // ── create entity ────────────────────────────────────────────────────
    const addFold = el('details', { class: 'lh-sandbox-form', 'data-lh-field': 'sandbox-add' }) as HTMLDetailsElement
    addFold.open = true
    const addSummary = el('summary')
    addSummary.textContent = 'Create entity'
    const addGrid = el('div', { class: 'lh-sandbox-grid' })
    const addName = el('input', { type: 'text', class: 'lh-input', placeholder: 'Name', 'data-lh-field': 'sandbox-add-name' }) as HTMLInputElement
    const addKind = el('select', { class: 'lh-input', 'data-lh-field': 'sandbox-add-kind' }) as HTMLSelectElement
    const addLocation = el('select', { class: 'lh-input', 'data-lh-field': 'sandbox-add-location' }) as HTMLSelectElement
    const addCount = el('input', { type: 'number', class: 'lh-input', min: '1', max: '99', placeholder: 'Count (packs: 2–99)', 'data-lh-field': 'sandbox-add-count' }) as HTMLInputElement
    const addFaction = el('input', { type: 'text', class: 'lh-input', placeholder: 'Faction (optional)', 'data-lh-field': 'sandbox-add-faction' }) as HTMLInputElement
    const addCause = el('input', { type: 'text', class: 'lh-input', placeholder: 'Cause (required)', 'data-lh-field': 'sandbox-add-cause' }) as HTMLInputElement
    const addActor = el('input', { type: 'text', class: 'lh-input', placeholder: 'Actor (optional)', 'data-lh-field': 'sandbox-add-actor' }) as HTMLInputElement
    addGrid.append(addName, addKind, addLocation, addCount, addFaction, addCause, addActor)
    const addRow = el('div', { class: 'lh-sandbox-row' })
    const addButton = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'sandbox-add-go' }) as HTMLButtonElement
    addButton.textContent = 'Add to map'
    addRow.append(addButton)
    addFold.append(addSummary, addGrid, addRow)

    // ── kill / change entity ─────────────────────────────────────────────
    const setFold = el('details', { class: 'lh-sandbox-form', 'data-lh-field': 'sandbox-set' }) as HTMLDetailsElement
    setFold.open = true
    const setSummary = el('summary')
    setSummary.textContent = 'Kill / change entity'
    const setGrid = el('div', { class: 'lh-sandbox-grid' })
    const setAsset = el('select', { class: 'lh-input', 'data-lh-field': 'sandbox-set-asset' }) as HTMLSelectElement
    const setState = el('select', { class: 'lh-input', 'data-lh-field': 'sandbox-set-state' }) as HTMLSelectElement
    const setCount = el('input', { type: 'number', class: 'lh-input', min: '1', max: '99', placeholder: 'Count (attrition)', 'data-lh-field': 'sandbox-set-count' }) as HTMLInputElement
    const setActor = el('input', { type: 'text', class: 'lh-input', placeholder: 'Actor: party, asset id, or "salt-road-delvers"', 'data-lh-field': 'sandbox-set-actor' }) as HTMLInputElement
    const setCause = el('input', { type: 'text', class: 'lh-input', placeholder: 'Cause, e.g. Killed by the party', 'data-lh-field': 'sandbox-set-cause' }) as HTMLInputElement
    setGrid.append(setAsset, setState, setCount, setActor, setCause)
    const setRow = el('div', { class: 'lh-sandbox-row' })
    const setButton = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'sandbox-set-go' }) as HTMLButtonElement
    setButton.textContent = 'Apply change'
    setRow.append(setButton)
    setFold.append(setSummary, setGrid, setRow)

    // ── threads, assets, the arc, the ledger ─────────────────────────────
    const columns = el('div', { class: 'lh-sandbox-columns' })
    const threadsPane = el('section')
    const threadsTitle = el('div', { class: 'lh-sandbox-subtitle' })
    threadsTitle.textContent = 'Causal threads'
    const threadsBox = el('div', { class: 'lh-sandbox-pane', 'data-lh-field': 'sandbox-threads' })
    threadsPane.append(threadsTitle, threadsBox)
    const assetsPane = el('section')
    const assetsTitle = el('div', { class: 'lh-sandbox-subtitle' })
    assetsTitle.textContent = 'Assets'
    const assetsBox = el('div', { class: 'lh-sandbox-pane', 'data-lh-field': 'sandbox-assets' })
    assetsPane.append(assetsTitle, assetsBox)
    columns.append(threadsPane, assetsPane)
    const arcBox = el('section', { class: 'lh-sandbox-arc', 'data-lh-field': 'sandbox-arc' })
    const ledger = el('details', { class: 'lh-sandbox-form lh-sandbox-ledger', 'data-lh-field': 'sandbox-ledger' }) as HTMLDetailsElement
    const ledgerSummary = el('summary')
    ledgerSummary.textContent = 'Stored evolution memory'
    const ledgerBody = el('div')
    ledger.append(ledgerSummary, ledgerBody)
    const problem = el('div', { class: 'lh-world-note lh-world-note--error', 'data-lh-field': 'sandbox-problem' })

    body.append(lead, siteRow, stats, memoryBar, memoryLine, timeRow, passRow, status, addFold, setFold, columns, arcBox, ledger, problem)

    function say(text: string, error = false): void {
        status.textContent = text
        status.classList.toggle('lh-world-note--error', error)
    }

    function stat(parent: HTMLElement, label: string, value: string, field?: string): void {
        const box = el('div', { class: 'lh-sandbox-stat', ...(field ? { 'data-lh-field': field } : {}) })
        const name = el('span')
        name.textContent = label
        const strong = el('strong')
        strong.textContent = value
        box.append(name, strong)
        parent.append(box)
    }

    function drawButtons(): void {
        const have = !!view && !!view.siteRoot && !view.problem
        const off = inFlight || !chatId
        for (const button of [setTimeButton, advanceButton, dayButton]) button.disabled = off || !view
        for (const button of [evolveButton, simulateButton, clearButton, addButton, setButton]) button.disabled = off || !have
        undoButton.disabled = off || !view?.lastPass || view.lastPass.undone
        redoButton.disabled = off || !view?.lastPass
    }

    function drawThreads(): void {
        threadsBox.replaceChildren()
        const threads = view?.threads
        if (!threads || (!threads.open.length && !threads.entries.length)) {
            const empty = el('div', { class: 'lh-sandbox-empty' })
            empty.textContent = 'No causal threads yet. Kill, wound, or move someone with a cause to start one.'
            threadsBox.append(empty)
            return
        }
        const openTitle = el('div', { class: 'lh-sandbox-subtitle' })
        openTitle.textContent = 'Open threads'
        const openList = el('ul', { class: 'lh-sandbox-list' })
        if (!threads.open.length) { const li = el('li', { class: 'lh-sandbox-empty' }); li.textContent = 'No open threads.'; openList.append(li) }
        for (const entry of threads.open) {
            const li = el('li')
            const tag = el('span', { class: 'lh-sandbox-badge lh-sandbox-badge--open' })
            tag.textContent = 'OPEN'
            const code = el('code')
            code.textContent = entry.subjectId
            const when = el('time')
            when.textContent = entry.at
            li.append(tag, document.createTextNode(' '), code, document.createTextNode(`${entry.actor ? ` by ${entry.actor}` : ''}: ${entry.cause} `), when)
            openList.append(li)
        }
        const eventsTitle = el('div', { class: 'lh-sandbox-subtitle' })
        eventsTitle.textContent = 'Attributed events'
        const eventsList = el('ul', { class: 'lh-sandbox-list' })
        const recent = [...threads.entries].reverse()
        if (!recent.length) { const li = el('li', { class: 'lh-sandbox-empty' }); li.textContent = 'None.'; eventsList.append(li) }
        for (const entry of recent) {
            const li = el('li')
            const words = badge(entry)
            const tag = el('span', { class: `lh-sandbox-badge ${words.cls}` })
            tag.textContent = words.label
            const when = el('time')
            when.textContent = entry.at
            li.append(tag, document.createTextNode(` ${entry.summary} `), when)
            eventsList.append(li)
        }
        threadsBox.append(openTitle, openList, eventsTitle, eventsList)
        if (threads.truncated) { const note = el('div', { class: 'lh-sandbox-empty' }); note.textContent = 'Older events were dropped at the stored-history cap.'; threadsBox.append(note) }
    }

    function drawAssets(): void {
        assetsBox.replaceChildren()
        const assets = view?.assets ?? []
        if (!assets.length) { const empty = el('div', { class: 'lh-sandbox-empty' }); empty.textContent = 'No assets on this map.'; assetsBox.append(empty); return }
        const list = el('ul', { class: 'lh-sandbox-list' })
        for (const asset of assets) {
            const li = el('li', { class: 'lh-sandbox-asset', title: 'Follow this asset’s arc', 'data-lh-arc': asset.id })
            li.classList.toggle('is-selected', asset.id === arcSubject)
            const code = el('code')
            code.textContent = asset.id
            const bits = `${asset.name}${Number.isInteger(asset.count) ? ` ×${asset.count}` : ''} [${asset.kind} / ${asset.state} / ${asset.location || '—'}]${asset.actor ? ` by ${asset.actor}` : ''}${asset.cause ? ` — ${asset.cause}` : ''}`
            li.append(code, document.createTextNode(` ${bits}`))
            if (asset.changedAt) { const when = el('time'); when.textContent = asset.changedAt; li.append(document.createTextNode(' '), when) }
            li.addEventListener('click', () => { arcSubject = asset.id; load(siteRoot).catch(host.fail) })
            list.append(li)
        }
        assetsBox.append(list)
    }

    function drawArc(): void {
        arcBox.replaceChildren()
        const title = el('div', { class: 'lh-sandbox-subtitle' })
        title.textContent = 'Asset arc'
        arcBox.append(title)
        const subjects = view?.arcSubjects ?? []
        if (!subjects.length) { const empty = el('div', { class: 'lh-sandbox-empty' }); empty.textContent = 'No assets or attributed events to follow yet.'; arcBox.append(empty); return }
        const leadLine = el('p', { class: 'lh-sandbox-lead' })
        leadLine.textContent = 'Follow one asset through occupancy changes. Click an asset on the right, or choose it here.'
        const row = el('label', { class: 'lh-sandbox-site' })
        const select = el('select', { class: 'lh-input', 'data-lh-field': 'sandbox-arc-subject' }) as HTMLSelectElement
        const blank = el('option', { value: '' })
        blank.textContent = 'Select an asset to follow'
        select.append(blank)
        for (const subject of subjects) {
            const bits: string[] = []
            if (subject.kind) bits.push(subject.kind)
            if (subject.state) bits.push(subject.state)
            if (!subject.onMap) bits.push('off-map')
            if (subject.open) bits.push('OPEN')
            if (subject.eventCount) bits.push(`${subject.eventCount} event${subject.eventCount === 1 ? '' : 's'}`)
            const option = el('option', { value: subject.id })
            option.textContent = `${subject.name} (${subject.id})${bits.length ? ` — ${bits.join(' · ')}` : ''}`
            select.append(option)
        }
        select.value = subjects.some((s) => s.id === arcSubject) ? arcSubject : ''
        select.addEventListener('change', () => { arcSubject = select.value; load(siteRoot).catch(host.fail) })
        row.append(document.createTextNode('Follow '), select)
        arcBox.append(leadLine, row)
        const now = el('div', { class: 'lh-sandbox-arc-now', 'data-lh-field': 'sandbox-arc-now' })
        const arc = view?.arc
        if (arc?.asset) {
            const code = el('code')
            code.textContent = arc.asset.id
            now.append(code, document.createTextNode(` ${arc.asset.name}${Number.isInteger(arc.asset.count) ? ` ×${arc.asset.count}` : ''} [${arc.asset.kind} / ${arc.asset.state} / ${arc.asset.location || '—'}]`))
            if (arc.open) { const tag = el('span', { class: 'lh-sandbox-badge lh-sandbox-badge--open' }); tag.textContent = 'OPEN'; now.append(document.createTextNode(' · '), tag) }
        } else if (arcSubject) {
            const code = el('code')
            code.textContent = arcSubject
            now.append(code, document.createTextNode(' is not on the current map.'))
            if (arc?.open) { now.append(document.createTextNode(' Thread is still ')); const tag = el('span', { class: 'lh-sandbox-badge lh-sandbox-badge--open' }); tag.textContent = 'OPEN'; now.append(tag, document.createTextNode('.')) }
        } else {
            now.textContent = 'Pick an asset from the list or the dropdown. Only that subject’s events are shown, including when it acted on someone else and DIGEST mentions after compression.'
        }
        arcBox.append(now)
        if (arc?.events.length) {
            const list = el('ol', { class: 'lh-sandbox-arc-list' })
            for (const entry of arc.events) {
                const li = el('li')
                const when = el('time')
                when.textContent = entry.at
                const words = badge(entry)
                const tag = el('span', { class: `lh-sandbox-badge ${words.cls}` })
                tag.textContent = words.label
                const role = el('span', { class: 'lh-sandbox-arc-role' })
                role.textContent = entry.role === 'actor' ? 'acted' : entry.role === 'digest' ? 'mentioned' : 'subject'
                li.append(when, document.createTextNode(' '), tag, document.createTextNode(' '), role, document.createTextNode(` ${entry.summary}`))
                list.append(li)
            }
            arcBox.append(list)
        }
        if (arc?.backlogHits.length) {
            const sub = el('div', { class: 'lh-sandbox-subtitle' })
            sub.textContent = 'Matching Evolution backlog'
            const list = el('ul', { class: 'lh-sandbox-list' })
            for (const entry of arc.backlogHits) {
                const li = el('li')
                const when = el('time')
                when.textContent = entry.at
                const tag = el('span', { class: 'lh-sandbox-badge lh-sandbox-badge--transformed' })
                tag.textContent = 'BACKLOG'
                li.append(when, document.createTextNode(' '), tag, document.createTextNode(` ${entry.summary}`))
                list.append(li)
            }
            arcBox.append(sub, list)
        }
        if (arcSubject && arc && !arc.events.length && !arc.backlogHits.length) { const empty = el('div', { class: 'lh-sandbox-empty' }); empty.textContent = 'No stored events mention this asset yet.'; arcBox.append(empty) }
    }

    function drawLedger(): void {
        ledgerBody.replaceChildren()
        const memory = view?.memory
        if (!memory) return
        const leadLine = el('p', { class: 'lh-sandbox-lead' })
        leadLine.textContent = 'This is the site ledger as stored. Closed events are what compression measures; DIGEST rows are compressor output; currently open threads stay verbatim.'
        const pre = (title: string, text: string, field: string) => {
            const sub = el('div', { class: 'lh-sandbox-subtitle' })
            sub.textContent = title
            const box = el('pre', { class: 'lh-sandbox-pre', 'data-lh-field': field })
            box.textContent = text
            ledgerBody.append(sub, box)
        }
        ledgerBody.append(leadLine)
        pre('Causal threads (stored JSON)', prettyJson(memory.storedThreads), 'sandbox-threads-json')
        pre('Evolution backlog (stored JSON)', prettyJson(memory.storedBacklog), 'sandbox-backlog-json')
        pre('Causal threads as Evolution reads them', memory.threadText.trim() || '(No causal-thread text stored.)', 'sandbox-threads-text')
        pre('Backlog as Evolution reads it', memory.backlogText.trim() || '(No evolution backlog stored.)', 'sandbox-backlog-text')
    }

    function draw(): void {
        siteSelect.replaceChildren()
        for (const site of view?.sites ?? []) {
            const option = el('option', { value: site.siteRoot })
            option.textContent = `${site.siteRoot}${site.current ? ' (current)' : ''}`
            siteSelect.append(option)
        }
        if (!view?.sites.length) { const option = el('option', { value: '' }); option.textContent = 'No site is mapped yet'; siteSelect.append(option) }
        siteSelect.value = view?.siteRoot ?? ''
        siteSelect.disabled = !view?.sites.length
        stats.replaceChildren()
        stat(stats, 'In-world time', view?.timeLabel || 'Unknown', 'sandbox-time')
        stat(stats, 'Last evolved', view?.lastEvolved || 'Never', 'sandbox-last')
        stat(stats, 'Elapsed', view?.elapsed || 'Unknown', 'sandbox-elapsed')
        memoryBar.replaceChildren()
        if (view) {
            const memory = view.memory
            memoryBar.classList.toggle('is-over', memory.overThreshold)
            memoryBar.classList.toggle('is-off', !memory.compressEnabled)
            stat(memoryBar, 'Closed-thread tokens', `${memory.closedTokens} / ${memory.threshold}`, 'sandbox-closed-tokens')
            stat(memoryBar, 'Open threads (kept)', `${memory.openTokens} tok · ${memory.openCount}`)
            stat(memoryBar, 'Backlog', `${memory.backlogTokens} tok · ${memory.backlogCount}`)
            stat(memoryBar, 'Stored memory total', `${memory.totalTokens} tok · ${memory.entryCount} events${memory.digestCount ? ` · ${memory.digestCount} digest${memory.digestCount === 1 ? '' : 's'}` : ''}`)
            memoryLine.textContent = memoryStatus(memory)
        } else memoryLine.textContent = ''
        if (document.activeElement !== timeInput) timeInput.value = view?.timeLabel ?? ''
        if (!hoursInput.value) hoursInput.value = String(view?.intervalHours ?? 8)
        // The kinds and the states the document library offers, from the view; a choice made is kept across a redraw.
        const kindWas = addKind.value
        addKind.replaceChildren()
        for (const kind of view?.kinds ?? []) { const option = el('option', { value: kind }); option.textContent = kind; addKind.append(option) }
        addKind.value = (view?.kinds ?? []).includes(kindWas) ? kindWas : (view?.kinds ?? []).includes('CREATURE') ? 'CREATURE' : view?.kinds[0] ?? ''
        const stateWas = setState.value
        setState.replaceChildren()
        for (const state of view?.states ?? []) { const option = el('option', { value: state }); option.textContent = state; setState.append(option) }
        setState.value = (view?.states ?? []).includes(stateWas) ? stateWas : view?.states[0] ?? ''
        addLocation.replaceChildren()
        for (const area of view?.areas ?? []) { const option = el('option', { value: area.id }); option.textContent = `${area.name} (${area.id})`; addLocation.append(option) }
        setAsset.replaceChildren()
        for (const asset of view?.assets ?? []) { const option = el('option', { value: asset.id }); option.textContent = `${asset.name} [${asset.state}]`; setAsset.append(option) }
        drawThreads()
        drawAssets()
        drawArc()
        drawLedger()
        problem.textContent = view?.problem ? `The Testing Ground could not read this chat: ${view.problem}` : ''
        problem.hidden = !view?.problem
        drawButtons()
    }

    async function load(root = siteRoot): Promise<void> {
        if (!chatId) { view = null; draw(); return }
        const asked = chatId
        const run = (async () => {
            try {
                const next = await host.get(root, arcSubject)
                if (chatId !== asked) return
                view = next
                siteRoot = next.siteRoot
                if (arcSubject && !next.arcSubjects.some((s) => s.id === arcSubject)) arcSubject = ''
            } catch (error) {
                if (chatId !== asked) return
                view = { timeLabel: '', minutes: -1, sites: [], siteRoot: '', kind: '', areas: [], assets: [], kinds: view?.kinds ?? [], states: view?.states ?? [], lastEvolved: 'Never', elapsed: 'Unknown', memory: { storedThreads: [], storedBacklog: [], threadText: '', backlogText: '', closedTokens: 0, openTokens: 0, backlogTokens: 0, totalTokens: 0, threshold: 0, compressEnabled: true, overThreshold: false, openCount: 0, digestCount: 0, entryCount: 0, backlogCount: 0 }, threads: { entries: [], open: [], truncated: false }, arcSubjects: [], lastPass: null, intervalHours: 8, problem: error instanceof Error ? error.message : String(error) }
            }
            draw()
        })()
        await run
    }

    async function act(action: Parameters<typeof outcomeWords>[0], run: () => Promise<MapSandboxOutcome>, pending: string): Promise<void> {
        if (!chatId || inFlight) return
        const asked = chatId
        inFlight = true
        drawButtons()
        say(pending)
        try {
            const result = await run()
            if (chatId !== asked) return
            const lastType = view?.lastPass?.type
            say(outcomeWords(action, result, { siteRoot, ...(lastType ? { lastType } : {}) }), !result.ok)
            if (result.ok && action !== 'clear') host.onChanged?.()
        } catch (error) {
            if (chatId !== asked) return
            say(`${action} failed: ${error instanceof Error ? error.message : String(error)}`, true)
        } finally {
            if (chatId === asked) { inFlight = false; drawButtons() }
        }
        if (chatId === asked) await load(siteRoot)
    }

    siteSelect.addEventListener('change', () => { arcSubject = ''; load(siteSelect.value).catch(host.fail) })
    setTimeButton.addEventListener('click', () => { act('set-time', () => host.time({ label: timeInput.value }), 'Setting the time…').catch(host.fail) })
    advanceButton.addEventListener('click', () => { const hours = Number(hoursInput.value) || 12; act('advance', () => host.time({ minutes: hours * 60 }), `Advancing ${hours} hour${hours === 1 ? '' : 's'}…`).catch(host.fail) })
    dayButton.addEventListener('click', () => { act('advance', () => host.time({ minutes: 1440 }), 'Advancing a day…').catch(host.fail) })
    evolveButton.addEventListener('click', () => { act('evolve', () => host.evolve(siteRoot), `Running Map Evolution for ${siteRoot}…`).catch(host.fail) })
    simulateButton.addEventListener('click', () => {
        const ticks = Number(ticksInput.value) || 3
        const hours = Number(hoursInput.value) || view?.intervalHours || 8
        act('simulate', () => host.simulate({ siteRoot, ticks, hoursPerTick: hours }), `Simulating ${ticks} tick(s) at ${hours}h…`).catch(host.fail)
    })
    undoButton.addEventListener('click', () => { act('undo', () => host.undo(), 'Restoring the pre-pass snapshot…').catch(host.fail) })
    redoButton.addEventListener('click', () => { act('redo', () => host.redo(), `Redoing ${view?.lastPass?.type === 'simulate' ? 'Simulate ticks' : 'Evolve'}…`).catch(host.fail) })
    clearButton.addEventListener('click', () => {
        (async () => {
            const root = siteRoot
            const message = `Clear evolution backlog and causal threads for "${root}"?\n\nThe map occupancy, [TIME], and Last Evolved clock stay as they are. This only removes prompt history so a later Evolution pass is not biased by ticks from a previous prompt.`
            if (host.confirm && !(await host.confirm(message))) return
            await act('clear', () => host.clear(root), `Clearing the evolution history of ${root}…`)
        })().catch(host.fail)
    })
    addButton.addEventListener('click', () => {
        act('add', () => host.add({ siteRoot, name: addName.value, kind: addKind.value, location: addLocation.value, count: addCount.value, faction: addFaction.value, cause: addCause.value, actor: addActor.value }), 'Adding the entity…')
            .then(() => { if (status.textContent === 'Entity added.') { addName.value = ''; addCount.value = ''; addCause.value = ''; addActor.value = '' } })
            .catch(host.fail)
    })
    setButton.addEventListener('click', () => {
        act('set', () => host.set({ siteRoot, assetId: setAsset.value, state: setState.value, count: setCount.value, actor: setActor.value, cause: setCause.value }), 'Applying the change…').catch(host.fail)
    })
    root.addEventListener('toggle', () => { if (root.open) load(siteRoot).catch(host.fail) })

    draw()
    return {
        root,
        setChat(next) {
            if (next === chatId) return
            chatId = next
            view = null
            siteRoot = ''
            arcSubject = ''
            inFlight = false
            hoursInput.value = ''
            say('')
            draw()
            if (root.open) load().catch(host.fail)
        },
        load,
        progress(tick) {
            if (!chatId || (tick.chatId && tick.chatId !== chatId) || !inFlight) return
            say(`Tick ${tick.index + 1}/${tick.count} (${tick.phase}) at ${tick.timeLabel}…`)
        },
        busy: () => inFlight,
    }
}

export const SANDBOX_FOLD_CSS = `
.adventuretime-panel .lh-sandbox > summary { cursor: pointer; }
.adventuretime-panel .lh-sandbox-body { display: flex; flex-direction: column; gap: 6px; }
.adventuretime-panel .lh-sandbox-site { display: flex; align-items: center; gap: 6px; font-size: 0.9em; }
.adventuretime-panel .lh-sandbox-site select { flex: 1 1 auto; min-width: 0; }
.adventuretime-panel .lh-sandbox-stats { display: flex; flex-wrap: wrap; gap: 6px 14px; padding: 6px 8px; border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25))); border-radius: 6px; font-size: 0.85em; }
.adventuretime-panel .lh-sandbox-stats.is-over { border-color: var(--lumiverse-warning, #ffa500); }
.adventuretime-panel .lh-sandbox-stats.is-off { opacity: 0.6; }
.adventuretime-panel .lh-sandbox-stat { display: flex; flex-direction: column; gap: 1px; }
.adventuretime-panel .lh-sandbox-stat span { opacity: 0.6; font-size: 0.85em; }
.adventuretime-panel .lh-sandbox-memory-status { font-size: 0.8em; opacity: 0.75; }
.adventuretime-panel .lh-sandbox-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.adventuretime-panel .lh-sandbox-row .lh-input { flex: 1 1 140px; min-width: 0; }
.adventuretime-panel .lh-sandbox-row .lh-input--short { flex: 0 0 64px; }
.adventuretime-panel .lh-sandbox-status { font-size: 0.85em; min-height: 1.2em; }
.adventuretime-panel .lh-sandbox-form { border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25))); border-radius: 6px; padding: 4px 8px; }
.adventuretime-panel .lh-sandbox-form > summary { cursor: pointer; font-size: 0.9em; }
.adventuretime-panel .lh-sandbox-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; margin: 6px 0; }
.adventuretime-panel .lh-sandbox-columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; }
.adventuretime-panel .lh-sandbox-subtitle { font-size: 0.8em; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; opacity: 0.7; margin: 4px 0 2px; }
.adventuretime-panel .lh-sandbox-pane { max-height: 220px; overflow: auto; font-size: 0.85em; }
.adventuretime-panel .lh-sandbox-list, .adventuretime-panel .lh-sandbox-arc-list { margin: 0; padding-left: 1.1em; }
.adventuretime-panel .lh-sandbox-list li, .adventuretime-panel .lh-sandbox-arc-list li { margin: 2px 0; line-height: 1.35; }
.adventuretime-panel .lh-sandbox-list time, .adventuretime-panel .lh-sandbox-arc-list time, .adventuretime-panel .lh-sandbox-asset time { opacity: 0.55; font-size: 0.85em; }
.adventuretime-panel .lh-sandbox-asset { cursor: pointer; }
.adventuretime-panel .lh-sandbox-asset.is-selected { outline: 1px solid var(--lh-accent, var(--lumiverse-primary, #c9a227)); border-radius: 4px; }
.adventuretime-panel .lh-sandbox-badge { font-size: 0.72em; font-weight: 700; padding: 0 5px; border-radius: 8px; border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.35))); }
.adventuretime-panel .lh-sandbox-badge--open { color: var(--lumiverse-warning, #ffa500); border-color: var(--lumiverse-warning, #ffa500); }
.adventuretime-panel .lh-sandbox-badge--resolved { color: var(--lumiverse-success, #34a853); border-color: var(--lumiverse-success, #34a853); }
.adventuretime-panel .lh-sandbox-badge--transformed { opacity: 0.8; }
.adventuretime-panel .lh-sandbox-badge--compressed { color: var(--lh-accent, var(--lumiverse-primary, #c9a227)); border-color: var(--lh-accent, var(--lumiverse-primary, #c9a227)); }
.adventuretime-panel .lh-sandbox-arc-role { font-size: 0.8em; opacity: 0.65; font-style: italic; }
.adventuretime-panel .lh-sandbox-arc-now { font-size: 0.85em; margin: 4px 0; }
.adventuretime-panel .lh-sandbox-lead { font-size: 0.8em; opacity: 0.75; margin: 2px 0; }
.adventuretime-panel .lh-sandbox-empty { font-size: 0.8em; opacity: 0.6; font-style: italic; }
.adventuretime-panel .lh-sandbox-pre { max-height: 180px; overflow: auto; font-size: 0.78em; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0 0 6px; }
.adventuretime-panel .lh-sandbox [hidden] { display: none; }
`
