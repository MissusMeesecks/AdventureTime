/**
 * The Game System Wizard, in the panel.
 *
 * Under the game systems list: describe a mechanic in a sentence, have the
 * model draft both halves, read and edit them, ask for revisions, and save.
 * Roadmap row 7. The legacy's popups became one foldable block here, with the
 * same three screens in sequence -- describe, preview, saved -- and the same
 * choices on each: the effect owner before drafting; the name, icon, tags,
 * both halves, the drivers and whether each half exists on the preview;
 * revise with feedback or regenerate a half; save switched on or off.
 *
 * Nothing is written until **Save**, and the save is one `settings.patch` of
 * the three keys built by `buildSaveBundle` from the settings the panel holds,
 * so a system lands in the library, the fields and the records together or
 * not at all. Editing an existing system opens the preview on its halves.
 *
 * The context switches (73g, departure 117) sit with the lookback: every
 * message, the lore the host has active, and existing module prompts as
 * formatting examples with Multihog's picker of which — the stock modules
 * that are on, the custom fields, the GM sections — a tick with nothing
 * picked picking everything, as the legacy's does. All four are
 * preferences, mirrored in the category's dials but for the picker.
 *
 * The tracker half is drawn as it will look (73e, departure 41, Multihog's
 * *UI Live Preview*): the last complete `[TAG]…[/TAG]` sample block in the
 * module's text, through the same view and renderer as the tracker's cards,
 * with the draft's label and icon on a ghost field in place of any saved
 * field of that tag, redrawn on every keystroke in the four tracker fields.
 */

import { RequestTimeoutError, type Bridge } from './bridge.js'
import type { PrefsResult, WizardDraftResult, WizardReviseResult } from '../protocol.js'
import { renderBlockCard } from '../tracker/render.js'
import type { BarPrefs } from '../tracker/bars.js'
import { buildTrackerView } from '../tracker/view.js'
import { listWizardModuleExampleOptions, type WizardModuleExampleOption } from '../tracker/wizard-context.js'
import {
    buildSaveBundle,
    buildWizardPreviewMemo,
    defaultWizardSystemPrompt,
    draftFromSystem,
    seedInstruction,
    WIZARD_EXAMPLE_SYSTEMS,
    type EffectOwner,
    type WizardDraft,
    type WizardSaveTarget,
} from '../tracker/wizard.js'

export interface WizardHost {
    createElement: <K extends keyof HTMLElementTagNameMap>(
        tag: K,
        attrs?: Record<string, string>,
    ) => HTMLElementTagNameMap[K]
}

export interface WizardPanelDeps {
    bridge: Pick<Bridge, 'request'>
    /** The chat the wizard reads for context. */
    chatId(): string | null
    /** The three keys as the panel last saw them. */
    settings(): WizardSaveTarget
    /**
     * Write the three keys. The panel commits and re-seeds. `seed` is the
     * instruction for the tracker pass that creates the new block, when the
     * system was saved switched on with a tracker half -- `null` otherwise.
     */
    onSave(patch: WizardSaveTarget, seed: string | null): void
}

export interface WizardPanel {
    /** Open the preview on an existing system, to edit it. */
    edit(systemId: string): void
    setSettings(settings: WizardSaveTarget): void
    /** The preferences as the backend holds them (63c): the lookback, the memo switch and the prompt follow a change made in the category. */
    applyPrefs(prefs: PrefsResult['prefs']): void
    destroy(): void
}

type Screen = 'describe' | 'preview'

export function mountGameSystemWizard(root: HTMLElement, host: WizardHost, deps: WizardPanelDeps): WizardPanel {
    const el = host.createElement
    let settings = deps.settings()
    let screen: Screen = 'describe'
    let draft: WizardDraft | null = null
    let editingId: string | null = null
    let description = ''
    let busy = false
    let destroyed = false
    let lookback = 10
    let injectMemo = false
    let systemPrompt = ''
    let bars: BarPrefs = {}
    let exampleKeys: string[] = []

    root.classList.add('lh-wizard')
    const fold = el('details', { class: 'lh-wizard-fold' })
    const summary = el('summary')
    summary.textContent = 'Game system wizard'
    const body = el('div', { class: 'lh-wizard-body' })
    fold.append(summary, body)
    root.append(fold)

    const note = el('div', { class: 'lh-wizard-note' })
    const problem = el('div', { class: 'lh-wizard-problem', role: 'alert' })
    problem.hidden = true

    // ── describe ──
    const describe = el('div', { class: 'lh-wizard-screen', 'data-lh-screen': 'describe' })
    const lead = el('div', { class: 'lh-wizard-lead' })
    lead.textContent =
        'Describe one mechanic in plain language. The model drafts a rule for the narrator and, if the mechanic '
        + 'needs numbers kept, a tracker module to keep them — both yours to edit before anything is saved.'
    const descBox = el('textarea', { class: 'lh-wizard-desc', rows: '3', 'data-lh-field': 'wizard-description', placeholder: 'Example: Irradiated zones where the player accumulates RADS the longer they stay, with escalating debuffs at higher exposure.' })
    descBox.addEventListener('input', () => { description = descBox.value })
    const chips = el('div', { class: 'lh-wizard-chips' })
    for (const example of WIZARD_EXAMPLE_SYSTEMS) {
        const chip = el('button', { type: 'button', class: 'lh-wizard-chip' })
        chip.textContent = example.label
        chip.title = example.text
        chip.addEventListener('click', () => {
            description = example.text
            descBox.value = example.text
        })
        chips.append(chip)
    }
    const optionRow = el('div', { class: 'lh-wizard-row' })
    const ownerLabel = el('label', { class: 'lh-wizard-option' })
    const ownerText = el('span')
    ownerText.textContent = 'Threshold effects narrated by'
    const owner = el('select', { class: 'lh-select', 'data-lh-field': 'wizard-owner' })
    for (const [value, label] of [['tracker', 'the tracker, a turn later (recommended)'], ['gm', 'the narrator, the same turn']]) {
        const option = el('option', { value: value! })
        option.textContent = label!
        owner.append(option)
    }
    ownerLabel.append(ownerText, owner)
    optionRow.append(ownerLabel)
    const contextRow = el('div', { class: 'lh-wizard-row' })
    const lookbackLabel = el('label', { class: 'lh-wizard-option' })
    const lookbackText = el('span')
    lookbackText.textContent = 'reading the last'
    const lookbackInput = el('input', { type: 'number', min: '0', max: '200', step: '1', class: 'lh-input', 'data-lh-field': 'wizard-lookback' })
    const lookbackTail = el('span')
    lookbackTail.textContent = 'messages'
    lookbackLabel.append(lookbackText, lookbackInput, lookbackTail)
    lookbackInput.addEventListener('change', () => { savePrefs({ wizardLookback: Math.floor(Number(lookbackInput.value)) }).catch(fail) })
    const memoLabel = el('label', { class: 'lh-wizard-option' })
    const memoBox = el('input', { type: 'checkbox', 'data-lh-field': 'wizard-memo' })
    const memoText = el('span')
    memoText.textContent = 'show it the tracker state'
    memoLabel.append(memoBox, memoText)
    memoBox.addEventListener('change', () => { savePrefs({ wizardInjectMemo: memoBox.checked }).catch(fail) })
    // Every message (73g, Multihog's Read every message): the count greyed while it is on, as the legacy greys it.
    const allLabel = el('label', { class: 'lh-wizard-option' })
    const allBox = el('input', { type: 'checkbox', 'data-lh-field': 'wizard-lookback-all' })
    const allText = el('span')
    allText.textContent = 'or all of them'
    allLabel.title = 'Multihog’s Read every message: the whole chat goes in, the count ignored.'
    allLabel.append(allBox, allText)
    allBox.addEventListener('change', () => { lookbackInput.disabled = allBox.checked; savePrefs({ wizardLookbackAll: allBox.checked }).catch(fail) })
    const loreLabel = el('label', { class: 'lh-wizard-option' })
    const loreBox = el('input', { type: 'checkbox', 'data-lh-field': 'wizard-lore' })
    const loreText = el('span')
    loreText.textContent = 'show it the lore the host has active'
    loreLabel.title = 'Multihog’s Inject lorebooks: the entries Lumiverse has active for this chat, each under its title.'
    loreLabel.append(loreBox, loreText)
    loreBox.addEventListener('change', () => { savePrefs({ wizardInjectLore: loreBox.checked }).catch(fail) })
    contextRow.append(lookbackLabel, allLabel, memoLabel, loreLabel)
    // Existing module prompts as formatting examples (73g), with Multihog's picker of which.
    const examplesRow = el('div', { class: 'lh-wizard-examples' })
    const examplesLabel = el('label', { class: 'lh-wizard-option' })
    const examplesBox = el('input', { type: 'checkbox', 'data-lh-field': 'wizard-modules' })
    const examplesText = el('span')
    examplesText.textContent = 'cite existing module prompts as formatting examples'
    examplesLabel.title = 'Multihog’s: the State Tracker and GM section texts your campaign already uses — not live values — so the wizard matches your tags, layout and wording.'
    examplesLabel.append(examplesBox, examplesText)
    const picker = el('div', { class: 'lh-wizard-picker', 'data-lh-field': 'wizard-picker' })
    picker.hidden = true
    const pickerHint = el('div', { class: 'lh-wizard-hint' })
    pickerHint.textContent = 'Choose which prompt instructions to include. These are the State Tracker / GM section texts your campaign already uses — not current HP, inventory, or other live numbers.'
    const pickRow = el('div', { class: 'lh-wizard-row' })
    const pickAll = el('button', { type: 'button', class: 'lh-button lh-button--quiet' })
    pickAll.textContent = 'All'
    const pickNone = el('button', { type: 'button', class: 'lh-button lh-button--quiet' })
    pickNone.textContent = 'None'
    pickRow.append(pickAll, pickNone)
    const pickList = el('div', { class: 'lh-wizard-picker-list' })
    picker.append(pickerHint, pickRow, pickList)
    examplesRow.append(examplesLabel, picker)
    const exampleBoxes = (): HTMLInputElement[] => Array.from(pickList.querySelectorAll<HTMLInputElement>('input[data-lh-example-key]'))
    const pickedKeys = (): string[] => exampleBoxes().filter((box) => box.checked).map((box) => box.getAttribute('data-lh-example-key') ?? '').filter(Boolean)
    function saveKeys(): void {
        exampleKeys = pickedKeys()
        savePrefs({ wizardModuleExampleKeys: exampleKeys }).catch(fail)
    }
    function drawPicker(): void {
        const options = listWizardModuleExampleOptions(settings)
        const groups = new Map<string, WizardModuleExampleOption[]>()
        for (const option of options) {
            if (!groups.has(option.group)) groups.set(option.group, [])
            groups.get(option.group)!.push(option)
        }
        pickList.replaceChildren()
        for (const [group, items] of groups) {
            const head = el('div', { class: 'lh-wizard-hint lh-wizard-picker-group' })
            head.textContent = group
            pickList.append(head)
            for (const item of items) {
                const row = el('label', { class: 'lh-wizard-option' })
                const box = el('input', { type: 'checkbox', 'data-lh-example-key': item.key })
                box.checked = exampleKeys.includes(item.key)
                const text = el('span')
                text.textContent = item.label
                row.append(box, text)
                box.addEventListener('change', saveKeys)
                pickList.append(row)
            }
        }
        if (!options.length) {
            const none = el('div', { class: 'lh-wizard-hint' })
            none.textContent = 'No enabled tracker modules or GM sections are available to cite.'
            pickList.append(none)
        }
        pickRow.hidden = !options.length
        picker.hidden = !examplesBox.checked
    }
    examplesBox.addEventListener('change', () => {
        picker.hidden = !examplesBox.checked
        const patch: Record<string, unknown> = { wizardInjectModulePrompts: examplesBox.checked }
        // The legacy's rule: a tick with nothing picked picks everything.
        if (examplesBox.checked && pickedKeys().length === 0) {
            for (const box of exampleBoxes()) box.checked = true
            exampleKeys = pickedKeys()
            patch.wizardModuleExampleKeys = exampleKeys
        }
        savePrefs(patch).catch(fail)
    })
    pickAll.addEventListener('click', () => { for (const box of exampleBoxes()) box.checked = true; saveKeys() })
    pickNone.addEventListener('click', () => { for (const box of exampleBoxes()) box.checked = false; saveKeys() })
    const promptFold = el('details', { class: 'lh-wizard-prompt-fold' })
    const promptSummary = el('summary')
    promptSummary.textContent = 'The architect prompt'
    const promptHint = el('div', { class: 'lh-wizard-hint' })
    promptHint.textContent = 'What the model is told about designing a system. Multihog’s own, editable; blank it to go back to the stock text.'
    const promptBox = el('textarea', { class: 'lh-wizard-prompt', rows: '10', spellcheck: 'false', 'data-lh-field': 'wizard-system-prompt' })
    promptBox.addEventListener('change', () => {
        const value = promptBox.value.trim() === defaultWizardSystemPrompt().trim() ? '' : promptBox.value
        savePrefs({ wizardSystemPrompt: value }).catch(fail)
    })
    promptFold.append(promptSummary, promptHint, promptBox)
    const draftButton = el('button', { type: 'button', class: 'lh-button' })
    draftButton.textContent = 'Draft it'
    draftButton.addEventListener('click', () => { runDraft().catch(fail) })
    // The busy line sits beside the button that started the call (72b-ter): the note at the top of the fold
    // is out of view when the form is long, and a press with no answer near it was pressed five times.
    const describeBusy = el('div', { class: 'lh-wizard-busy', 'data-lh-field': 'wizard-busy-describe' })
    describeBusy.hidden = true
    describe.append(lead, descBox, chips, optionRow, contextRow, examplesRow, promptFold, draftButton, describeBusy)

    // ── preview ──
    const preview = el('div', { class: 'lh-wizard-screen', 'data-lh-screen': 'preview' })
    preview.hidden = true
    const previewLead = el('div', { class: 'lh-wizard-lead' })
    const nameRow = el('div', { class: 'lh-wizard-row' })
    const iconInput = el('input', { type: 'text', class: 'lh-input lh-wizard-icon', 'data-lh-field': 'wizard-icon', placeholder: '✨' })
    const nameInput = el('input', { type: 'text', class: 'lh-input', 'data-lh-field': 'wizard-name', placeholder: 'Name' })
    nameRow.append(iconInput, nameInput)
    iconInput.addEventListener('change', () => { if (draft) draft.icon = iconInput.value })
    nameInput.addEventListener('change', () => { if (draft) draft.name = nameInput.value })

    const gmHead = el('label', { class: 'lh-wizard-half-head' })
    const gmBox = el('input', { type: 'checkbox', 'data-lh-field': 'wizard-include-gm' })
    const gmTitle = el('span')
    gmTitle.textContent = 'A rule for the narrator, in the section'
    const gmTag = el('input', { type: 'text', class: 'lh-input lh-wizard-tag', 'data-lh-field': 'wizard-gm-tag' })
    gmHead.append(gmBox, gmTitle, gmTag)
    const gmContent = el('textarea', { class: 'lh-wizard-half', rows: '10', spellcheck: 'false', 'data-lh-field': 'wizard-gm-content' })
    gmBox.addEventListener('change', () => { if (draft) { draft.includeGm = gmBox.checked; render() } })
    gmTag.addEventListener('change', () => { if (draft) draft.gmTag = gmTag.value })
    gmContent.addEventListener('change', () => { if (draft) draft.gmContent = gmContent.value })
    const gmRegen = el('button', { type: 'button', class: 'lh-button lh-button--quiet' })
    gmRegen.textContent = 'Rewrite this half'
    gmRegen.addEventListener('click', () => { runRevise('gm').catch(fail) })

    const trHead = el('label', { class: 'lh-wizard-half-head' })
    const trBox = el('input', { type: 'checkbox', 'data-lh-field': 'wizard-include-tracker' })
    const trTitle = el('span')
    trTitle.textContent = 'A tracker module, in the block'
    const trTag = el('input', { type: 'text', class: 'lh-input lh-wizard-tag', 'data-lh-field': 'wizard-tracker-tag' })
    trHead.append(trBox, trTitle, trTag)
    const trMeta = el('div', { class: 'lh-wizard-row' })
    const trIcon = el('input', { type: 'text', class: 'lh-input lh-wizard-icon', 'data-lh-field': 'wizard-tracker-icon', placeholder: '📄' })
    const trLabel = el('input', { type: 'text', class: 'lh-input', 'data-lh-field': 'wizard-tracker-label', placeholder: 'Label on the card' })
    trMeta.append(trIcon, trLabel)
    const trContent = el('textarea', { class: 'lh-wizard-half', rows: '12', spellcheck: 'false', 'data-lh-field': 'wizard-tracker-content' })
    trBox.addEventListener('change', () => { if (draft) { draft.needsTracker = trBox.checked; render() } })
    trTag.addEventListener('change', () => { if (draft) draft.trackerTag = trTag.value.toUpperCase() })
    trIcon.addEventListener('change', () => { if (draft) draft.trackerIcon = trIcon.value })
    trLabel.addEventListener('change', () => { if (draft) draft.trackerLabel = trLabel.value })
    trContent.addEventListener('change', () => { if (draft) draft.trackerContent = trContent.value })
    // The live card (73e): the legacy redraws on every keystroke in these four, and so does this.
    trTag.addEventListener('input', () => { if (draft) { draft.trackerTag = trTag.value.toUpperCase(); drawPreview() } })
    trIcon.addEventListener('input', () => { if (draft) { draft.trackerIcon = trIcon.value; drawPreview() } })
    trLabel.addEventListener('input', () => { if (draft) { draft.trackerLabel = trLabel.value; drawPreview() } })
    trContent.addEventListener('input', () => { if (draft) { draft.trackerContent = trContent.value; drawPreview() } })
    const previewHead = el('div', { class: 'lh-wizard-half-head lh-wizard-preview-head' })
    previewHead.textContent = 'How the card will look'
    const previewHint = el('div', { class: 'lh-wizard-hint', 'data-lh-field': 'wizard-preview-hint' })
    const previewBox = el('div', { class: 'lh-wizard-preview', 'data-lh-field': 'wizard-preview' })
    const trRegen = el('button', { type: 'button', class: 'lh-button lh-button--quiet' })
    trRegen.textContent = 'Rewrite this half'
    trRegen.addEventListener('click', () => { runRevise('tracker').catch(fail) })

    const drivers = el('div', { class: 'lh-wizard-drivers' })
    const driverBox = (key: 'driverTime' | 'driverGmAnnotation' | 'driverStatedFact', label: string, hint: string): HTMLInputElement => {
        const row = el('label', { class: 'lh-wizard-option' })
        row.title = hint
        const box = el('input', { type: 'checkbox', 'data-lh-field': `wizard-${key}` })
        const text = el('span')
        text.textContent = label
        row.append(box, text)
        box.addEventListener('change', () => { if (draft) draft[key] = box.checked })
        drivers.append(row)
        return box
    }
    const driversHead = el('div', { class: 'lh-wizard-hint' })
    driversHead.textContent = 'How the value moves (used when a half is rewritten):'
    drivers.append(driversHead)
    const timeBox = driverBox('driverTime', 'with in-world time', 'A rate per minute of elapsed [TIME], applied by the tracker.')
    const annotationBox = driverBox('driverGmAnnotation', 'when the narrator annotates a change', 'The narrator writes *(Category: Event. +N Metric)* and the tracker applies it.')
    const factBox = driverBox('driverStatedFact', 'from a number stated in the story', 'The tracker reads a plain number out of the narration.')
    const ownerRow = el('label', { class: 'lh-wizard-option' })
    const ownerRowText = el('span')
    ownerRowText.textContent = 'Threshold effects narrated by'
    const ownerSelect = el('select', { class: 'lh-select', 'data-lh-field': 'wizard-owner-preview' })
    for (const [value, label] of [['tracker', 'the tracker, a turn later'], ['gm', 'the narrator, the same turn']]) {
        const option = el('option', { value: value! })
        option.textContent = label!
        ownerSelect.append(option)
    }
    ownerRow.append(ownerRowText, ownerSelect)
    ownerSelect.addEventListener('change', () => { if (draft) draft.effectOwner = ownerSelect.value === 'gm' ? 'gm' : 'tracker' })
    drivers.append(ownerRow)

    const reviseHead = el('div', { class: 'lh-wizard-hint' })
    reviseHead.textContent = 'Not quite it? Say what to change and the model revises the draft, keeping the rest.'
    const feedback = el('textarea', { class: 'lh-wizard-feedback', rows: '2', 'data-lh-field': 'wizard-feedback', placeholder: 'Example: drain twice as fast at night, and add a Frostbitten tier at 0.' })
    const reviseRow = el('div', { class: 'lh-wizard-row' })
    const reviseButton = el('button', { type: 'button', class: 'lh-button' })
    reviseButton.textContent = 'Revise'
    reviseButton.addEventListener('click', () => { runRevise('revise').catch(fail) })
    const bothButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet' })
    bothButton.textContent = 'Rewrite both halves'
    bothButton.addEventListener('click', () => { runRevise('both').catch(fail) })
    reviseRow.append(reviseButton, bothButton)
    const previewBusy = el('div', { class: 'lh-wizard-busy', 'data-lh-field': 'wizard-busy-preview' })
    previewBusy.hidden = true

    const saveRow = el('div', { class: 'lh-wizard-row' })
    const saveOn = el('button', { type: 'button', class: 'lh-button' })
    saveOn.textContent = 'Save and switch on'
    saveOn.addEventListener('click', () => { save(true) })
    const saveOff = el('button', { type: 'button', class: 'lh-button lh-button--quiet' })
    saveOff.textContent = 'Save switched off'
    saveOff.addEventListener('click', () => { save(false) })
    const backButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet' })
    backButton.textContent = 'Back'
    backButton.addEventListener('click', () => { screen = 'describe'; render() })
    saveRow.append(saveOn, saveOff, backButton)
    preview.append(previewLead, nameRow, gmHead, gmContent, gmRegen, trHead, trMeta, trContent, previewHead, previewHint, previewBox, trRegen, drivers, reviseHead, feedback, reviseRow, previewBusy, saveRow)

    body.append(note, problem, describe, preview)

    const controls = (): HTMLElement[] =>
        Array.from(body.querySelectorAll<HTMLElement>('button, textarea, input, select'))

    function fail(error: unknown): void {
        // A timeout is the panel giving up, not the model failing: the reply may
        // still arrive at the backend and be thrown away. Say so, with the wait.
        problem.textContent = error instanceof RequestTimeoutError
            ? `The model took longer than the panel waits (${Math.round(error.timeoutMs / 60_000)} minutes) and the draft was not kept. Try again, or shorten what it has to write.`
            : error instanceof Error ? error.message : String(error)
        problem.hidden = false
    }

    function setBusy(next: boolean, message = ''): void {
        busy = next
        for (const control of controls()) (control as HTMLButtonElement).disabled = next
        // A busy message goes beside the buttons, pulsing; a finished one (the save's) goes in the note at the top.
        for (const line of [describeBusy, previewBusy]) {
            line.textContent = next ? message : ''
            line.hidden = !next
        }
        if (next) note.textContent = ''
    }

    async function savePrefs(patch: Record<string, unknown>): Promise<void> {
        const result = await deps.bridge.request<PrefsResult>('prefs.patch', { patch })
        readPrefs(result)
    }

    function readPrefs(result: PrefsResult): void {
        bars = result.prefs?.bars ?? bars
        lookback = result.prefs?.wizardLookback ?? lookback
        injectMemo = result.prefs?.wizardInjectMemo ?? injectMemo
        systemPrompt = result.prefs?.wizardSystemPrompt ?? systemPrompt
        lookbackInput.value = String(lookback)
        memoBox.checked = injectMemo
        if (result.prefs?.wizardLookbackAll !== undefined) { allBox.checked = result.prefs.wizardLookbackAll === true; lookbackInput.disabled = allBox.checked }
        if (result.prefs?.wizardInjectLore !== undefined) loreBox.checked = result.prefs.wizardInjectLore === true
        if (result.prefs?.wizardInjectModulePrompts !== undefined) examplesBox.checked = result.prefs.wizardInjectModulePrompts === true
        if (Array.isArray(result.prefs?.wizardModuleExampleKeys)) exampleKeys = result.prefs.wizardModuleExampleKeys.map(String)
        drawPicker()
        const shown = systemPrompt.trim() ? systemPrompt : defaultWizardSystemPrompt()
        if (promptBox.value !== shown) promptBox.value = shown
    }

    async function runDraft(): Promise<void> {
        const chatId = deps.chatId()
        if (!chatId) { fail(new Error('No chat open.')); return }
        const text = description.trim()
        if (!text) { fail(new Error('Describe the mechanic first.')); return }
        problem.hidden = true
        setBusy(true, 'Drafting with the model… this takes about as long as a reply does.')
        try {
            const result = await deps.bridge.request<WizardDraftResult>('wizard.draft', {
                chatId,
                description: text,
                effectOwner: owner.value === 'gm' ? 'gm' : 'tracker',
            })
            if (destroyed) return
            draft = result.draft
            editingId = null
            screen = 'preview'
        } finally {
            if (!destroyed) setBusy(false)
        }
        render()
    }

    async function runRevise(mode: 'revise' | 'gm' | 'tracker' | 'both'): Promise<void> {
        const chatId = deps.chatId()
        if (!chatId || !draft) return
        if (mode === 'revise' && !feedback.value.trim()) { fail(new Error('Say what to change first.')); return }
        problem.hidden = true
        setBusy(true, mode === 'revise' ? 'Revising…' : 'Rewriting…')
        try {
            const result = await deps.bridge.request<WizardReviseResult>('wizard.revise', {
                chatId,
                description,
                draft,
                mode,
                ...(mode === 'revise' ? { feedback: feedback.value } : {}),
            })
            if (destroyed) return
            const halves = result.halves
            if (halves.gmContent !== undefined) {
                draft.gmContent = halves.gmContent
                if (halves.gmTag) draft.gmTag = halves.gmTag
            }
            if (halves.trackerContent !== undefined) {
                draft.trackerContent = halves.trackerContent
                if (halves.trackerTag) draft.trackerTag = halves.trackerTag
                if (halves.trackerLabel) draft.trackerLabel = halves.trackerLabel
                if (halves.trackerIcon) draft.trackerIcon = halves.trackerIcon
            }
            if (mode === 'revise') feedback.value = ''
        } finally {
            if (!destroyed) setBusy(false)
        }
        render()
    }

    function save(enabled: boolean): void {
        if (!draft) return
        if (!draft.includeGm && !draft.needsTracker) { fail(new Error('Keep at least one half.')); return }
        if (!draft.name.trim()) { fail(new Error('Give the system a name.')); return }
        problem.hidden = true
        const patch = buildSaveBundle(draft, settings, { enabled, description, existingId: editingId })
        const seed = enabled && draft.needsTracker ? seedInstruction(draft) : null
        deps.onSave(patch, seed)
        note.textContent = seed
            ? `Saved "${draft.name}", switched on, and asked the tracker to add its block now — the Tracker section shows the pass and its report.`
            : `Saved "${draft.name}"${enabled ? ', switched on' : ', switched off'}. It is in the lists above and in your cartridge.`
        draft = null
        editingId = null
        description = ''
        descBox.value = ''
        screen = 'describe'
        render()
    }

    /**
     * The tracker half's sample block as the card it will be. The legacy's
     * `renderUiLivePreview`: the memo is the block alone, the field a ghost
     * made of the draft's tag, label and icon in place of any saved field of
     * that tag, and the card is read-only -- its header folds nothing here.
     */
    function drawPreview(): void {
        const shown = draft && draft.needsTracker
        previewHead.hidden = !shown
        previewHint.hidden = !shown
        previewBox.hidden = !shown
        if (!draft || !shown) { previewBox.replaceChildren(); return }
        const typed = draft.trackerTag.trim().toUpperCase() || 'TRACKER_TAG'
        previewHint.textContent = `Drawn from the last complete [${typed}] … [/${typed}] sample block in the module above, as the tracker's cards draw it. Edit that block to change it.`
        const memo = buildWizardPreviewMemo(draft.trackerContent, draft.trackerTag)
        if (!memo) {
            const empty = el('div', { class: 'rt-empty' })
            empty.textContent = `Add a complete [${typed}] … [/${typed}] example block above to see its card.`
            previewBox.replaceChildren(empty)
            return
        }
        const tag = memo.slice(1, memo.indexOf(']'))
        const others = settings.customFields.filter((f) => String(f.tag ?? '').toUpperCase() !== tag) as Array<{ tag: string }>
        const ghost = { tag, label: draft.trackerLabel || tag, icon: draft.trackerIcon || '📄', enabled: true }
        const view = buildTrackerView(memo, { customFields: [...others, ghost], bars })
        const block = view.blocks.find((b) => b.tag === tag)
        previewBox.innerHTML = block ? renderBlockCard(block) : ''
    }

    function render(): void {
        describe.hidden = screen !== 'describe'
        preview.hidden = screen !== 'preview'
        if (screen !== 'preview' || !draft) { drawPreview(); return }
        previewLead.textContent = editingId
            ? 'Editing a saved system. Save writes your changes over it.'
            : 'The draft. Read both halves, change what you like, or ask for a revision. Nothing is saved until you press Save.'
        iconInput.value = draft.icon
        nameInput.value = draft.name
        gmBox.checked = draft.includeGm
        gmTag.value = draft.gmTag
        gmContent.value = draft.gmContent
        gmContent.hidden = !draft.includeGm
        gmRegen.hidden = !draft.includeGm
        trBox.checked = draft.needsTracker
        trTag.value = draft.trackerTag
        trIcon.value = draft.trackerIcon
        trLabel.value = draft.trackerLabel
        trContent.value = draft.trackerContent
        trMeta.hidden = !draft.needsTracker
        trContent.hidden = !draft.needsTracker
        trRegen.hidden = !draft.needsTracker
        timeBox.checked = draft.driverTime
        annotationBox.checked = draft.driverGmAnnotation
        factBox.checked = draft.driverStatedFact
        ownerSelect.value = draft.effectOwner
        drawPreview()
    }

    void deps.bridge.request<PrefsResult>('prefs.get', {}).then((result) => { if (!destroyed) readPrefs(result) }).catch(() => undefined)
    readPrefs({ prefs: { messageCards: true, bars: {} } })
    render()

    return {
        applyPrefs(prefs) { readPrefs({ prefs }) },
        edit(systemId) {
            const system = settings.gameSystems.find((s) => s.id === systemId)
            if (!system) return
            draft = draftFromSystem(system, settings)
            editingId = systemId
            description = String(system.description ?? '')
            screen = 'preview'
            fold.open = true
            problem.hidden = true
            render()
        },
        setSettings(next) {
            settings = next
            drawPicker()
        },
        destroy() {
            destroyed = true
            root.replaceChildren()
        },
    }
}
