/**
 * The character creator (roadmap row 10, Phase 35): the form in the panel.
 *
 * The legacy's Character Creator is a panel on its onboarding screen: the
 * player fills in as much as they like, picks a genre, a level, a gear tier
 * and a class, saves the lot as a preset if they want it again, and presses
 * Generate; the State Model writes the sheet into the memo. Here it is a
 * fold under the tracker's cards, open on its own when a chat has no memo
 * yet, with the same fields, the same presets, and a note that says what
 * the last generation did. The form is kept as a preference, so it is
 * there again after a reload; the sheet is the memo, so it shows in the
 * tracker’s cards as soon as it is written.
 */
import type { CreatorResult } from '../protocol.js'
import { createCardWordsControl } from './card-words.js'
import { describeCardSteps, reasonText } from './player-card-fold.js'
import {
    CLASS_OTHER,
    CLASS_STORY,
    classOptions,
    CREATOR_GENRES,
    emptyDraft,
    findPreset,
    GEAR_TIERS,
    normalizeDraft,
    rollCreatorName,
    upsertPreset,
    type CreatorDefaults,
    type CreatorDraft,
    type CreatorGenre,
    type CreatorPreset,
} from '../tracker/creator.js'

export interface CreatorFoldHost {
    el(tag: string, attrs?: Record<string, string>): HTMLElement
    /** Write the sheet from the draft, and the Player Card and the persona when asked (35b); the chat is the host's business. */
    generate(draft: CreatorDraft, options: { playerCard: boolean; persona: boolean; cardWords: number }): Promise<CreatorResult>
    /** Save preferences; the caller does not reload, the fold keeps its own state. */
    savePrefs(patch: Record<string, unknown>): Promise<void>
    fail(error: unknown): void
    /** Minutes-ago wording for a timestamp, the panel's own. */
    when(iso: string): string
    /** Ask before replacing a same-named preset; absent, it is replaced. */
    confirm?(message: string): Promise<boolean>
    random?: () => number
    createId?: () => string
}

export interface CreatorPrefs {
    creatorDraft?: Record<string, unknown> | null
    creatorPresets?: Array<{ id: string; name: string; data: unknown }>
    creatorLevel?: number | 'none'
    creatorGearTier?: string
    creatorCombatScalingGuide?: boolean
    creatorInitialDate?: string
    creatorInitialTime?: string
    creatorConnectionId?: string
    creatorPlayerCard?: boolean
    creatorPersona?: boolean
    creatorCardWords?: number
}

export interface CreatorFold {
    root: HTMLDetailsElement
    /** The preferences as loaded: the draft, the presets, the defaults, the dates and the connection. */
    applyPrefs(prefs: CreatorPrefs): void
    /** The starting choices alone (63c), from the category's mirror: the draft and the presets are left as they are, and a control being typed in too. */
    applyDefaults(prefs: CreatorPrefs): void
    /** The connection alone (63): a change made in the Connections category, mirrored here. */
    applyConnection(id: string): void
    /** The connections the sheet may be written on, as the panel lists them. */
    setConnections(choices: ReadonlyArray<{ id: string; name: string; model?: string }>, unavailable: string): void
    /** Which chat is open and whether its memo is empty; the fold opens itself on the first empty memo of a chat. */
    setChat(chatId: string | null, memoEmpty: boolean): void
    /** The draft as the form holds it now. */
    draft(): CreatorDraft
    busy(): boolean
}

/** The note after a generation, in words. */
export function describeCreatorResult(result: CreatorResult, when: (iso: string) => string): string {
    const stamped = result.at ? when(result.at) : ''
    const tail = stamped ? ` Ran ${stamped}.` : ''
    if (result.status === 'written') {
        const blocks = [...(result.added ?? []), ...(result.replaced ?? [])]
        const who = result.name ? `for ${result.name}` : 'for a character the sheet does not name'
        const steps = describeCardSteps(result)
        return `Wrote the sheet ${who}${blocks.length ? `: ${blocks.join(', ')}` : ''}. It is in the tracker’s cards.${steps ? ` ${steps}` : ''}${tail}`
    }
    return `The sheet was not written: ${reasonText(result.reason)}.${tail}`
}

export const CREATOR_FOLD_CSS = `
.lh-creator > summary { cursor: pointer; font-size: 0.85em; opacity: 0.8; }
.lh-creator-body { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.lh-creator-row { display: flex; gap: 8px; flex-wrap: wrap; }
.lh-creator-field { display: flex; flex-direction: column; gap: 2px; flex: 1 1 9em; min-width: 0; }
.lh-creator-field--wide { flex-basis: 100%; }
.lh-creator-field > label { font-size: 0.78em; opacity: 0.75; display: flex; justify-content: space-between; align-items: center; gap: 6px; }
.lh-creator-field .lh-input { width: 100%; min-width: 0; box-sizing: border-box; }
.lh-creator-field textarea.lh-input { resize: vertical; font: inherit; font-size: 0.85em; }
.lh-creator-roll { background: none; border: none; color: inherit; cursor: pointer; padding: 0; font-size: 1em; line-height: 1; opacity: 0.85; }
.lh-creator-roll:hover { opacity: 1; }
.lh-creator-presets { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: 0.8em; padding-bottom: 4px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
.lh-creator-presets .lh-input { flex: 1 1 8em; min-width: 0; }
.lh-creator-presets[hidden] { display: none; }
.lh-creator-hint { font-size: 0.75em; opacity: 0.65; }
.lh-creator-card-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.lh-creator-note:empty { display: none; }
.lh-creator [hidden] { display: none; }
`

function option(el: CreatorFoldHost['el'], value: string, label: string): HTMLOptionElement {
    const node = el('option', { value }) as HTMLOptionElement
    node.textContent = label
    return node
}

export function createCreatorFold(host: CreatorFoldHost): CreatorFold {
    const { el } = host
    const random = host.random ?? Math.random
    const createId = host.createId ?? (() => Date.now().toString(36) + Math.floor(random() * 1e6).toString(36))

    const root = el('details', { class: 'lh-creator' }) as HTMLDetailsElement
    // The summary is Multihog's hero button since 83 (the starting area after its onboarding): the
    // glowing button and the sub-line under it, the form folding open under them.
    const summary = el('summary')
    const heroButton = el('span', { class: 'lh-start-hero-btn' })
    heroButton.textContent = '🎲 Character Creator'
    // Folded as it ships since 84 (the maintainer's ask), with the drawers' chevron at the button's right edge.
    const heroChevron = el('span', { class: 'lh-start-drawer-chevron lh-start-fold-chevron', 'aria-hidden': 'true' })
    heroChevron.textContent = '▸'
    heroButton.append(heroChevron)
    const heroSub = el('span', { class: 'lh-start-hero-sub' })
    heroSub.textContent = 'Build your character step by step — presets, a Player Card, and full stat generation.'
    summary.append(heroButton, heroSub)
    const body = el('div', { class: 'lh-creator-body' })
    const lead = el('div', { class: 'lh-world-lead' })
    lead.textContent = 'Describe the character you want — as much or as little as you like — and one model call writes the complete sheet into the tracker: every block the modules keep, at the level and gear tier chosen, in the genre’s idiom. What you leave blank, the model invents. The sheet appears in the tracker’s cards as soon as it is written.'

    // ── presets ──────────────────────────────────────────────────────────
    const presetsRow = el('div', { class: 'lh-creator-presets', 'data-lh-field': 'creator-presets' })
    const presetsLabel = el('span')
    presetsLabel.textContent = 'Presets'
    const presetSelect = el('select', { class: 'lh-input', 'data-lh-field': 'creator-preset' }) as HTMLSelectElement
    const loadButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet' }) as HTMLButtonElement
    loadButton.textContent = 'Load'
    const deleteButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet' }) as HTMLButtonElement
    deleteButton.textContent = 'Delete'
    const presetName = el('input', { type: 'text', class: 'lh-input', 'data-lh-field': 'creator-preset-name', placeholder: 'Name this preset' }) as HTMLInputElement
    const saveButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet' }) as HTMLButtonElement
    saveButton.textContent = 'Save'
    saveButton.title = 'Save the form as a preset under this name. A preset of the same name is replaced.'
    presetsRow.append(presetsLabel, presetSelect, loadButton, deleteButton, presetName, saveButton)

    // ── the form ─────────────────────────────────────────────────────────
    const fields: Record<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement> = {}
    function field(name: string, label: string, control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, options: { wide?: boolean; hint?: string; extra?: HTMLElement } = {}): HTMLElement {
        const wrap = el('div', { class: `lh-creator-field${options.wide ? ' lh-creator-field--wide' : ''}`, 'data-lh-field': `creator-${name}` })
        const text = el('label')
        const caption = el('span')
        caption.textContent = label
        text.append(caption)
        if (options.extra) text.append(options.extra)
        if (options.hint) text.title = options.hint
        wrap.append(text, control)
        fields[name] = control
        return wrap
    }
    const input = (name: string): HTMLInputElement => el('input', { type: 'text', class: 'lh-input', 'data-lh-field': `creator-${name}-input` }) as HTMLInputElement
    const area = (name: string, placeholder: string, rows = '2'): HTMLTextAreaElement => el('textarea', { class: 'lh-input', rows, placeholder, 'data-lh-field': `creator-${name}-input` }) as HTMLTextAreaElement
    const select = (name: string): HTMLSelectElement => el('select', { class: 'lh-input', 'data-lh-field': `creator-${name}-input` }) as HTMLSelectElement
    const row = (...children: HTMLElement[]): HTMLElement => { const r = el('div', { class: 'lh-creator-row' }); r.append(...children); return r }

    const rollButton = el('button', { type: 'button', class: 'lh-creator-roll', title: 'Roll a name from the genre’s pool, or from every pool when no genre is chosen' }) as HTMLButtonElement
    rollButton.textContent = '🎲'
    const name = input('name')
    const gender = input('gender')
    const age = input('age')
    const orientation = input('orientation')
    const species = input('species')
    const ethnicity = input('ethnicity')
    const genre = select('genre')
    for (const g of CREATOR_GENRES) genre.append(option(el, g.value, g.label))
    const level = select('level')
    level.append(option(el, 'none', 'N/A — No Levels (Custom System)'))
    for (let i = 1; i <= 20; i++) level.append(option(el, String(i), `Level ${i}`))
    const gearTier = select('gear-tier')
    for (const t of GEAR_TIERS) gearTier.append(option(el, t.value, t.label))
    const combatRow = el('label', { class: 'lh-world-switch', 'data-lh-field': 'creator-combat-guide' })
    const combat = el('input', { type: 'checkbox' }) as HTMLInputElement
    const combatText = el('span')
    combatText.textContent = 'Use the combat and skill scaling guide'
    combatRow.title = 'A classic d20-style reference for how competence grows with level. Switch it off for a homebrew system that should not read like D&D.'
    combatRow.append(combat, combatText)
    // The Player Card and the persona (35b): the legacy's two checkboxes and its word count.
    const cardRow = el('div', { class: 'lh-creator-card-row', 'data-lh-field': 'creator-card' })
    const cardLabel = el('label', { class: 'lh-world-switch' })
    const playerCard = el('input', { type: 'checkbox', 'data-lh-field': 'creator-player-card-input' }) as HTMLInputElement
    const cardText = el('span')
    cardText.textContent = 'Write a Player Card (recommended)'
    cardLabel.title = 'A second model call writes the character’s appearance, personality, habits and backstory into a Player Card the narrator sees every turn. It appears in the Player Card fold, where it can be edited or written again.'
    cardLabel.append(playerCard, cardText)
    const cardWords = createCardWordsControl(el, 'creator-card-words', (n) => { host.savePrefs({ creatorCardWords: n }).catch(host.fail) })
    cardRow.append(cardLabel, cardWords.root)
    const personaRow = el('label', { class: 'lh-world-switch', 'data-lh-field': 'creator-persona' })
    const persona = el('input', { type: 'checkbox', 'data-lh-field': 'creator-persona-input' }) as HTMLInputElement
    persona.checked = true
    const personaText = el('span')
    personaText.textContent = 'Create a persona with the character’s name (recommended)'
    personaRow.title = 'A persona with the character’s name and no description, made and switched to, so your messages carry the name while the Player Card stays the one biography.'
    personaRow.append(persona, personaText)
    const startDate = input('start-date')
    startDate.placeholder = 'Day 1 or DD/MM/YYYY'
    const startTime = input('start-time')
    startTime.placeholder = '08:00 AM'
    const classSelect = select('class')
    const classOther = input('class-other')
    classOther.placeholder = 'Describe your own class…'
    const traits = area('traits', 'Leave blank — the model invents traits')
    const abilities = area('abilities', 'Leave blank — the model generates abilities')
    const background = input('background')
    const appearance = input('appearance')
    const additional = area('additional', 'Extra constraints, setting notes…')

    const form = el('div', { class: 'lh-creator-form' })
    form.append(
        row(field('name', 'Name', name, { extra: rollButton }), field('gender', 'Gender', gender), field('age', 'Age', age)),
        row(field('orientation', 'Sexual orientation', orientation, { hint: 'For the relationship system and romantic choices; without it the narrator guesses.' }), field('species', 'Species', species), field('ethnicity', 'Ethnicity', ethnicity)),
        row(field('genre', 'Genre', genre, { hint: 'A genre lists its classes below; none leaves the class to the model and the story.' }), field('level', 'Level', level, { hint: 'N/A for a system without numeric levels: no level, no XP block.' }), field('gear-tier', 'Gear tier', gearTier, { hint: 'How well-equipped: from a mundane starter kit to named heroic gear. Auto scales with the level.' })),
        combatRow,
        row(field('start-date', 'Starting date', startDate, { hint: 'The first [TIME] block’s date: Day 1, or a calendar date when the cartridge uses DD/MM/YYYY.' }), field('start-time', 'Starting time', startTime, { hint: 'The first [TIME] block’s time of day.' })),
        field('class', 'Class', classSelect, { wide: true }),
        field('class-other', 'Your own class', classOther, { wide: true }),
        row(field('traits', 'Traits', traits), field('abilities', 'Abilities', abilities)),
        row(field('background', 'Background', background, { hint: 'A hint is enough: “ex-soldier”, “noble exile”. Blank, and the model invents one.' }), field('appearance', 'Appearance', appearance, { hint: 'A hint is enough: “tall, red hair, scar on one cheek”.' })),
        field('additional', 'Additional', additional, { wide: true }),
        cardRow,
        personaRow,
    )

    // ── the connection, the buttons, the note ────────────────────────────
    const connectionRow = el('div', { class: 'lh-conn', 'data-lh-field': 'creator-connection' })
    const connectionLabel = el('label', { class: 'lh-conn-label' })
    connectionLabel.textContent = 'Connection the sheet is written on'
    const connection = el('select', { class: 'lh-input' }) as HTMLSelectElement
    const connectionHint = el('div', { class: 'lh-conn-hint' })
    connectionRow.append(connectionLabel, connection, connectionHint)
    const buttons = el('div', { class: 'lh-world-buttons' })
    const generateButton = el('button', { type: 'button', class: 'lh-button' }) as HTMLButtonElement
    generateButton.textContent = 'Generate the character'
    const resetButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet' }) as HTMLButtonElement
    resetButton.textContent = 'Clear the form'
    buttons.append(generateButton, resetButton)
    const live = el('div', { class: 'lh-world-running', hidden: 'hidden' })
    const note = el('div', { class: 'lh-world-note lh-creator-note' })
    body.append(lead, presetsRow, form, connectionRow, buttons, live, note)
    root.append(summary, body)

    // ── state ────────────────────────────────────────────────────────────
    let defaults: CreatorDefaults = { level: 1, gearTier: 'auto', combatScalingGuide: true }
    let presets: CreatorPreset[] = []
    let connectionId = ''
    let running = false
    let chatId: string | null = null
    let last: CreatorResult | null = null
    let suppress = false

    function fillClasses(keep: string): void {
        classSelect.replaceChildren()
        for (const o of classOptions(genre.value as CreatorGenre)) classSelect.append(option(el, o.value, o.label))
        classSelect.value = classOptions(genre.value as CreatorGenre).some((o) => o.value === keep) ? keep : CLASS_STORY
        classOther.parentElement!.hidden = classSelect.value !== CLASS_OTHER
    }

    function readDraft(): CreatorDraft {
        return normalizeDraft({
            name: name.value, gender: gender.value, age: age.value, orientation: orientation.value, species: species.value, ethnicity: ethnicity.value,
            genre: genre.value, level: level.value, gearTier: gearTier.value, combatScalingGuide: combat.checked,
            class: classSelect.value, classOther: classOther.value,
            traits: traits.value, abilities: abilities.value, background: background.value, appearance: appearance.value, additional: additional.value,
        }, defaults)
    }

    function writeDraft(draft: CreatorDraft): void {
        suppress = true
        name.value = draft.name; gender.value = draft.gender; age.value = draft.age; orientation.value = draft.orientation
        species.value = draft.species; ethnicity.value = draft.ethnicity
        genre.value = draft.genre; level.value = String(draft.level); gearTier.value = draft.gearTier; combat.checked = draft.combatScalingGuide
        fillClasses(draft.class)
        classOther.value = draft.classOther
        traits.value = draft.traits; abilities.value = draft.abilities; background.value = draft.background; appearance.value = draft.appearance; additional.value = draft.additional
        suppress = false
    }

    function drawPresets(): void {
        const chosen = presetSelect.value
        presetSelect.replaceChildren(option(el, '', presets.length ? '— Select a preset —' : 'No presets saved yet'))
        for (const p of presets) presetSelect.append(option(el, p.id, p.name))
        presetSelect.value = presets.some((p) => p.id === chosen) ? chosen : ''
        loadButton.disabled = !presetSelect.value || running
        deleteButton.disabled = !presetSelect.value || running
    }

    function drawState(): void {
        const disabled = running
        for (const control of Object.values(fields)) control.disabled = disabled
        combat.disabled = disabled
        playerCard.disabled = disabled
        persona.disabled = disabled
        cardWords.setDisabled(disabled)
        connection.disabled = disabled
        rollButton.disabled = disabled
        generateButton.disabled = disabled || !chatId
        resetButton.disabled = disabled
        saveButton.disabled = disabled
        presetSelect.disabled = disabled
        presetName.disabled = disabled
        drawPresets()
        live.hidden = !running
        if (running) live.textContent = playerCard.checked ? 'Writing the sheet, then the Player Card. Two model calls; the tracker’s cards fill in after the first…' : 'Writing the sheet now. One model call; the tracker’s cards fill in when it is done…'
        note.textContent = last ? describeCreatorResult(last, host.when) : ''
        note.classList.toggle('lh-world-note--error', last?.status === 'failed')
        generateButton.title = chatId ? 'Write the sheet into this chat’s tracker.' : 'Open a chat first.'
    }

    const saveDraft = (): void => {
        if (suppress) return
        host.savePrefs({ creatorDraft: readDraft() as unknown as Record<string, unknown> }).catch(host.fail)
    }
    for (const control of [name, gender, age, orientation, species, ethnicity, traits, abilities, background, appearance, additional, classOther]) {
        control.addEventListener('change', saveDraft)
    }
    genre.addEventListener('change', () => { fillClasses(CLASS_STORY); saveDraft() })
    classSelect.addEventListener('change', () => { classOther.parentElement!.hidden = classSelect.value !== CLASS_OTHER; saveDraft() })
    level.addEventListener('change', () => { defaults = { ...defaults, level: level.value === 'none' ? 'none' : Number(level.value) }; host.savePrefs({ creatorLevel: defaults.level, creatorDraft: readDraft() as unknown as Record<string, unknown> }).catch(host.fail) })
    gearTier.addEventListener('change', () => { defaults = { ...defaults, gearTier: gearTier.value as CreatorDefaults['gearTier'] }; host.savePrefs({ creatorGearTier: gearTier.value, creatorDraft: readDraft() as unknown as Record<string, unknown> }).catch(host.fail) })
    combat.addEventListener('change', () => { defaults = { ...defaults, combatScalingGuide: combat.checked }; host.savePrefs({ creatorCombatScalingGuide: combat.checked, creatorDraft: readDraft() as unknown as Record<string, unknown> }).catch(host.fail) })
    playerCard.addEventListener('change', () => { host.savePrefs({ creatorPlayerCard: playerCard.checked }).catch(host.fail) })
    persona.addEventListener('change', () => { host.savePrefs({ creatorPersona: persona.checked }).catch(host.fail) })
    startDate.addEventListener('change', () => { host.savePrefs({ creatorInitialDate: startDate.value }).catch(host.fail) })
    startTime.addEventListener('change', () => { host.savePrefs({ creatorInitialTime: startTime.value }).catch(host.fail) })
    connection.addEventListener('change', () => { connectionId = connection.value; host.savePrefs({ creatorConnectionId: connectionId }).catch(host.fail) })
    rollButton.addEventListener('click', () => { name.value = rollCreatorName(genre.value as CreatorGenre, random); saveDraft() })
    resetButton.addEventListener('click', () => {
        writeDraft(emptyDraft(defaults))
        last = null
        host.savePrefs({ creatorDraft: null }).catch(host.fail)
        drawState()
    })

    presetSelect.addEventListener('change', drawPresets)
    loadButton.addEventListener('click', () => {
        const preset = presets.find((p) => p.id === presetSelect.value)
        if (!preset) return
        writeDraft(normalizeDraft(preset.data, defaults))
        saveDraft()
    })
    deleteButton.addEventListener('click', () => {
        const id = presetSelect.value
        if (!id) return
        presets = presets.filter((p) => p.id !== id)
        presetSelect.value = ''
        drawPresets()
        host.savePrefs({ creatorPresets: presets }).catch(host.fail)
    })
    saveButton.addEventListener('click', () => {
        const title = presetName.value.trim()
        if (!title) { presetName.focus(); return }
        const existing = findPreset(presets, title)
        const proceed = existing && host.confirm ? host.confirm(`A preset named “${existing.name}” already exists. Replace it with the form as it is now?`) : Promise.resolve(true)
        proceed.then((ok) => {
            if (!ok) return
            const result = upsertPreset(presets, title, readDraft(), createId)
            presets = result.presets
            presetName.value = ''
            drawPresets()
            presetSelect.value = result.preset.id
            drawPresets()
            host.savePrefs({ creatorPresets: presets }).catch(host.fail)
        }).catch(host.fail)
    })

    generateButton.addEventListener('click', () => {
        if (running || !chatId) return
        running = true
        last = null
        drawState()
        host.generate(readDraft(), { playerCard: playerCard.checked, persona: persona.checked, cardWords: cardWords.value() })
            .then((result) => { last = result })
            .catch((error) => { last = { status: 'failed', at: new Date().toISOString(), name: '', reason: error instanceof Error ? error.message : String(error) } })
            .finally(() => { running = false; drawState() })
    })

    fillClasses(CLASS_STORY)
    writeDraft(emptyDraft(defaults))
    drawState()

    return {
        root,
        applyPrefs(prefs) {
            defaults = {
                level: prefs.creatorLevel ?? defaults.level,
                gearTier: (prefs.creatorGearTier as CreatorDefaults['gearTier']) ?? defaults.gearTier,
                combatScalingGuide: prefs.creatorCombatScalingGuide ?? defaults.combatScalingGuide,
            }
            presets = (Array.isArray(prefs.creatorPresets) ? prefs.creatorPresets : []).map((p) => ({ id: p.id, name: p.name, data: normalizeDraft(p.data, defaults) }))
            writeDraft(normalizeDraft(prefs.creatorDraft ?? null, defaults))
            startDate.value = prefs.creatorInitialDate ?? 'Day 1'
            startTime.value = prefs.creatorInitialTime ?? '08:00 AM'
            connectionId = prefs.creatorConnectionId ?? ''
            connection.value = connectionId
            if (typeof prefs.creatorPlayerCard === 'boolean') playerCard.checked = prefs.creatorPlayerCard
            if (typeof prefs.creatorPersona === 'boolean') persona.checked = prefs.creatorPersona
            if (typeof prefs.creatorCardWords === 'number') cardWords.set(prefs.creatorCardWords)
            drawState()
        },
        applyDefaults(prefs) {
            defaults = {
                level: prefs.creatorLevel ?? defaults.level,
                gearTier: (prefs.creatorGearTier as CreatorDefaults['gearTier']) ?? defaults.gearTier,
                combatScalingGuide: prefs.creatorCombatScalingGuide ?? defaults.combatScalingGuide,
            }
            const active = document.activeElement
            if (prefs.creatorLevel !== undefined && active !== level) level.value = String(defaults.level)
            if (prefs.creatorGearTier !== undefined && active !== gearTier) gearTier.value = defaults.gearTier
            if (prefs.creatorCombatScalingGuide !== undefined) combat.checked = defaults.combatScalingGuide
            if (typeof prefs.creatorInitialDate === 'string' && active !== startDate) startDate.value = prefs.creatorInitialDate
            if (typeof prefs.creatorInitialTime === 'string' && active !== startTime) startTime.value = prefs.creatorInitialTime
            if (typeof prefs.creatorPlayerCard === 'boolean') playerCard.checked = prefs.creatorPlayerCard
            if (typeof prefs.creatorPersona === 'boolean') persona.checked = prefs.creatorPersona
            if (typeof prefs.creatorCardWords === 'number') cardWords.set(prefs.creatorCardWords)
            drawState()
        },
        applyConnection(id) {
            connectionId = id
            if (!Array.from(connection.options).some((o) => o.value === id)) connection.append(option(el, id, 'The connection you chose is no longer listed'))
            connection.value = id
        },
        setConnections(choices, unavailable) {
            connection.replaceChildren(option(el, '', 'The tracker’s connection'))
            for (const c of choices) connection.append(option(el, c.id, c.model ? `${c.name} — ${c.model}` : c.name))
            if (connectionId && !choices.some((c) => c.id === connectionId)) connection.append(option(el, connectionId, 'The connection you chose is no longer listed'))
            connection.value = connectionId
            connectionHint.textContent = unavailable || (choices.length ? 'Blank runs the sheet on whatever the tracker runs on.' : 'No connections are listed; the sheet runs on the tracker’s.')
        },
        setChat(id, memoEmpty) {
            chatId = id
            // Folded whatever the chat holds since 84: the starting area opens for an empty memo (69), the fold waits for the hand.
            void memoEmpty
            if (!id) last = null
            drawState()
        },
        draft: readDraft,
        busy: () => running,
    }
}
