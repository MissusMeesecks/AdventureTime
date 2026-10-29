/**
 * The other ways to begin (roadmap row 10, Phase 35c): the legacy's *Other
 * Ways to Begin* drawer.
 *
 * Two ways in: a character that embodies the host's active persona, and one
 * from custom instructions alone. Both take the level, genre, gear tier and
 * scaling guide the drawer shows — the creator's own defaults, shared through
 * the same preferences — and the Player Card and persona switches. Custom
 * needs a name (rolled from the genre's pool, or typed) and instructions, as
 * the legacy's disabled button says: *Roll a genre-matched name before using
 * Custom.* The persona way takes the persona's name. The legacy's third
 * button, Import Card, is row 83's and not here.
 */

import type { WaysResult } from '../protocol.js'
import { CREATOR_GENRES, GEAR_TIERS, normalizeInstantGenre, rollCreatorName, type CreatorGenre } from '../tracker/creator.js'
import { createCardWordsControl } from './card-words.js'
import { describeCardSteps, reasonText } from './player-card-fold.js'

export interface WaysFoldHost {
    el(tag: string, attrs?: Record<string, string>): HTMLElement
    begin(request: { way: 'persona' | 'custom'; name: string; instructions: string; level: number | 'none'; genre: string; gearTier: string; combatScalingGuide: boolean; playerCard: boolean; persona: boolean; cardWords: number }): Promise<WaysResult>
    savePrefs(patch: Record<string, unknown>): Promise<void>
    /** The time & date segment's two cartridge keys (72b): `use24hTime` and `useDdMmYyFormat`. Absent, the segment shows the two preferences alone. */
    commitSettings?(patch: Record<string, unknown>): Promise<void>
    fail(error: unknown): void
    when(iso: string): string
    random?: () => number
}

export interface WaysPrefs {
    creatorInitialDate?: string
    creatorInitialTime?: string
    creatorLevel?: number | 'none'
    creatorGenre?: string
    creatorGearTier?: string
    creatorCombatScalingGuide?: boolean
    creatorPlayerCard?: boolean
    creatorPersona?: boolean
    creatorCardWords?: number
    creatorWaysDraft?: { name?: string; instructions?: string } | null
}

export interface WaysFold {
    root: HTMLDetailsElement
    applyPrefs(prefs: WaysPrefs): void
    /** The cartridge's two clock keys, for the segment (72b). */
    applySettings(settings: Record<string, unknown>): void
    setChat(chatId: string | null): void
    busy(): boolean
}

/** The note after a run, in words. */
export function describeWaysResult(result: WaysResult, when: (iso: string) => string): string {
    const stamped = result.at ? when(result.at) : ''
    const tail = stamped ? ` Ran ${stamped}.` : ''
    const from = result.way === 'persona' ? `from the persona${result.source ? ` “${result.source}”` : ''}` : 'from the instructions'
    if (result.status === 'written') {
        const blocks = [...(result.added ?? []), ...(result.replaced ?? [])]
        const who = result.name ? `for ${result.name}` : 'for a character the sheet does not name'
        const steps = describeCardSteps(result)
        return `Wrote the sheet ${who} ${from}${blocks.length ? `: ${blocks.join(', ')}` : ''}. It is in the tracker’s cards.${steps ? ` ${steps}` : ''}${tail}`
    }
    return `The sheet was not written ${from}: ${reasonText(result.reason)}.${tail}`
}

export const WAYS_FOLD_CSS = `
.lh-ways > summary { cursor: pointer; font-size: 0.85em; opacity: 0.8; }
.lh-ways-body { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.lh-ways-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end; }
.lh-ways-field { display: flex; flex-direction: column; gap: 2px; flex: 1 1 8em; min-width: 0; }
.lh-ways-field > label { font-size: 0.78em; opacity: 0.75; }
.lh-ways-field .lh-input { width: 100%; min-width: 0; box-sizing: border-box; }
.lh-ways-field textarea.lh-input { resize: vertical; font: inherit; font-size: 0.85em; }
/* In the body's column, a flex basis is a height: the instructions field keeps its own. */
.lh-ways-field--wide { flex: 0 0 auto; }
.lh-ways-name { display: flex; gap: 6px; align-items: center; }
.lh-ways-name .lh-input { flex: 1 1 10em; min-width: 0; }
.lh-ways-hint { font-size: 0.75em; opacity: 0.65; }
.lh-ways-switches { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; font-size: 0.8em; }
.lh-ways-note:empty { display: none; }
.lh-ways [hidden] { display: none; }
`

function option(el: WaysFoldHost['el'], value: string, label: string): HTMLOptionElement {
    const node = el('option', { value }) as HTMLOptionElement
    node.textContent = label
    return node
}

export function createWaysFold(host: WaysFoldHost): WaysFold {
    const { el } = host
    const random = host.random ?? Math.random

    const root = el('details', { class: 'lh-ways' }) as HTMLDetailsElement
    const summary = el('summary')
    // Inside Multihog's Other Ways to Begin drawer since 83, so the fold names its two ways.
    summary.textContent = 'From the persona or the instructions'
    const body = el('div', { class: 'lh-ways-body' })
    const lead = el('div', { class: 'lh-world-lead' })
    lead.textContent = 'Two more ways in. From the active persona: the character embodies the persona Lumiverse has active, with its name and its description, and the instructions below as constraints. From the instructions: a character built entirely from what you write, with a name rolled or typed. Both use the level, genre, gear tier and guide here, and write the Player Card and the persona as the switches say.'

    const field = (name: string, label: string, control: HTMLElement): HTMLElement => {
        const wrap = el('div', { class: 'lh-ways-field', 'data-lh-field': `ways-${name}` })
        const text = el('label')
        text.textContent = label
        wrap.append(text, control)
        return wrap
    }
    const level = el('select', { class: 'lh-input', 'data-lh-field': 'ways-level-input' }) as HTMLSelectElement
    level.append(option(el, 'none', 'N/A — No Levels'))
    for (let i = 1; i <= 20; i++) level.append(option(el, String(i), `Level ${i}`))
    const genre = el('select', { class: 'lh-input', 'data-lh-field': 'ways-genre-input' }) as HTMLSelectElement
    for (const g of CREATOR_GENRES) if (g.value) genre.append(option(el, g.value, g.label))
    const gearTier = el('select', { class: 'lh-input', 'data-lh-field': 'ways-gear-tier-input' }) as HTMLSelectElement
    for (const t of GEAR_TIERS) gearTier.append(option(el, t.value, t.label))
    const settingsRow = el('div', { class: 'lh-ways-row' })
    settingsRow.append(field('level', 'Level', level), field('genre', 'Genre', genre), field('gear-tier', 'Gear tier', gearTier))

    // Time & date (72b): Multihog's segment in this drawer — the calendar and the clock format, which are the
    // cartridge's two keys the tracker's time formats hold, and the starting day and time, the creator's two preferences.
    const timeRow = el('div', { class: 'lh-ways-row', 'data-lh-field': 'ways-time' })
    const calendar = el('select', { class: 'lh-input', 'data-lh-field': 'ways-calendar-input' }) as HTMLSelectElement
    calendar.append(option(el, 'day', 'Day 1 (narrative days)'), option(el, 'date', 'Calendar date (DD/MM/YYYY)'))
    const clock = el('select', { class: 'lh-input', 'data-lh-field': 'ways-clock-input' }) as HTMLSelectElement
    clock.append(option(el, '12', '12-hour clock'), option(el, '24', '24-hour clock'))
    const startDay = el('input', { type: 'text', class: 'lh-input', 'data-lh-field': 'ways-start-day-input', placeholder: 'Day 1' }) as HTMLInputElement
    startDay.value = 'Day 1'
    const startTime = el('input', { type: 'text', class: 'lh-input', 'data-lh-field': 'ways-start-time-input', placeholder: '08:00 AM' }) as HTMLInputElement
    startTime.value = '08:00 AM'
    timeRow.append(field('calendar', 'Calendar', calendar), field('clock', 'Clock', clock), field('start-day', 'Starting day', startDay), field('start-time', 'Starting time', startTime))
    const timeHint = el('div', { class: 'lh-ways-hint' })
    timeHint.textContent = 'What the [TIME] block opens at, and how the tracker writes every clock. The calendar and the clock are the cartridge’s (also under Time formats in the settings); the start is the creator’s, shared with Instant Action.'
    calendar.addEventListener('change', () => { host.commitSettings?.({ useDdMmYyFormat: calendar.value === 'date' }).catch(host.fail) })
    clock.addEventListener('change', () => { host.commitSettings?.({ use24hTime: clock.value === '24' }).catch(host.fail) })
    startDay.addEventListener('change', () => { host.savePrefs({ creatorInitialDate: startDay.value.trim() || 'Day 1' }).catch(host.fail) })
    startTime.addEventListener('change', () => { host.savePrefs({ creatorInitialTime: startTime.value.trim() || '08:00 AM' }).catch(host.fail) })
    if (!host.commitSettings) { calendar.disabled = true; clock.disabled = true }

    const combatRow = el('label', { class: 'lh-world-switch', 'data-lh-field': 'ways-combat-guide' })
    const combat = el('input', { type: 'checkbox', 'data-lh-field': 'ways-combat-guide-input' }) as HTMLInputElement
    combat.checked = true
    const combatText = el('span')
    combatText.textContent = 'Use the combat and skill scaling guide'
    combatRow.append(combat, combatText)

    const instructions = el('textarea', { class: 'lh-input', rows: '2', 'data-lh-field': 'ways-instructions-input', placeholder: 'Custom setting/character instructions (e.g. Victorian London, space marine, gritty realism, cyberpunk decker…)' }) as HTMLTextAreaElement
    const instructionsField = field('instructions', 'Instructions', instructions)
    instructionsField.classList.add('lh-ways-field--wide')

    const nameRow = el('div', { class: 'lh-ways-name' })
    const name = el('input', { type: 'text', class: 'lh-input', 'data-lh-field': 'ways-name-input', placeholder: 'Roll or enter a name', autocomplete: 'off', 'aria-label': 'Other ways character name' }) as HTMLInputElement
    const rollButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet' }) as HTMLButtonElement
    rollButton.textContent = '🎲 Roll name'
    nameRow.append(name, rollButton)
    const nameHint = el('div', { class: 'lh-ways-hint', 'data-lh-field': 'ways-name-hint' })

    const switches = el('div', { class: 'lh-ways-switches' })
    const cardLabel = el('label', { class: 'lh-world-switch' })
    const playerCard = el('input', { type: 'checkbox', 'data-lh-field': 'ways-player-card-input' }) as HTMLInputElement
    const cardText = el('span')
    cardText.textContent = 'Write a Player Card (recommended)'
    cardLabel.append(playerCard, cardText)
    const cardWords = createCardWordsControl(el, 'ways-card-words', (n) => { host.savePrefs({ creatorCardWords: n }).catch(host.fail) })
    const personaLabel = el('label', { class: 'lh-world-switch' })
    const persona = el('input', { type: 'checkbox', 'data-lh-field': 'ways-persona-input' }) as HTMLInputElement
    persona.checked = true
    const personaText = el('span')
    personaText.textContent = 'Create a persona with the character’s name (recommended)'
    personaLabel.append(persona, personaText)
    switches.append(cardLabel, cardWords.root, personaLabel)

    const buttons = el('div', { class: 'lh-world-buttons' })
    const personaButton = el('button', { type: 'button', class: 'lh-button' }) as HTMLButtonElement
    personaButton.textContent = '🎭 From the active persona'
    const customButton = el('button', { type: 'button', class: 'lh-button' }) as HTMLButtonElement
    customButton.textContent = '⚙️ From the instructions'
    buttons.append(personaButton, customButton)
    const live = el('div', { class: 'lh-world-running', hidden: 'hidden' })
    const note = el('div', { class: 'lh-world-note lh-ways-note' })
    body.append(lead, settingsRow, timeRow, timeHint, combatRow, instructionsField, nameRow, nameHint, switches, buttons, live, note)
    root.append(summary, body)

    let chatId: string | null = null
    let running: '' | 'persona' | 'custom' = ''
    let last: WaysResult | null = null

    function drawState(): void {
        const busy = running !== ''
        for (const control of [level, genre, gearTier, combat, instructions, name, playerCard, persona]) control.disabled = busy
        cardWords.setDisabled(busy)
        rollButton.disabled = busy
        const named = !!name.value.trim()
        nameHint.textContent = named ? 'Name ready — edit, reroll, or choose From the instructions.' : 'Roll a genre-matched name before using From the instructions.'
        personaButton.disabled = busy || !chatId
        personaButton.title = chatId ? 'One model call writes a sheet that embodies the active persona.' : 'Open a chat first.'
        customButton.disabled = busy || !chatId || !named || !instructions.value.trim()
        customButton.title = !chatId ? 'Open a chat first.' : !named ? 'Roll or type a name first.' : !instructions.value.trim() ? 'Write the instructions first.' : 'One model call writes a sheet from the instructions alone.'
        live.hidden = !busy
        live.textContent = running === 'persona' ? '🎭 Embodying the persona… the tracker’s cards fill in when the sheet is written.' : running === 'custom' ? '⚙️ Customizing… the tracker’s cards fill in when the sheet is written.' : ''
        note.textContent = last ? describeWaysResult(last, host.when) : ''
        note.classList.toggle('lh-world-note--error', last?.status === 'failed')
    }

    // Setting a control's value fires no event, so applying the preferences never re-saves the draft.
    const saveDraft = (): void => {
        host.savePrefs({ creatorWaysDraft: { name: name.value, instructions: instructions.value } }).catch(host.fail)
    }
    level.addEventListener('change', () => { host.savePrefs({ creatorLevel: level.value === 'none' ? 'none' : Number(level.value) }).catch(host.fail) })
    genre.addEventListener('change', () => { host.savePrefs({ creatorGenre: genre.value }).catch(host.fail) })
    gearTier.addEventListener('change', () => { host.savePrefs({ creatorGearTier: gearTier.value }).catch(host.fail) })
    combat.addEventListener('change', () => { host.savePrefs({ creatorCombatScalingGuide: combat.checked }).catch(host.fail) })
    playerCard.addEventListener('change', () => { host.savePrefs({ creatorPlayerCard: playerCard.checked }).catch(host.fail) })
    persona.addEventListener('change', () => { host.savePrefs({ creatorPersona: persona.checked }).catch(host.fail) })
    instructions.addEventListener('input', drawState)
    instructions.addEventListener('change', saveDraft)
    name.addEventListener('input', drawState)
    name.addEventListener('change', saveDraft)
    rollButton.addEventListener('click', () => {
        if (running) return
        name.value = rollCreatorName(normalizeInstantGenre(genre.value) as CreatorGenre, random)
        saveDraft()
        drawState()
    })

    const begin = (way: 'persona' | 'custom'): void => {
        if (running || !chatId) return
        if (way === 'custom' && (!name.value.trim() || !instructions.value.trim())) return
        running = way
        last = null
        drawState()
        host.begin({ way, name: name.value.trim(), instructions: instructions.value, level: level.value === 'none' ? 'none' : Number(level.value), genre: genre.value, gearTier: gearTier.value, combatScalingGuide: combat.checked, playerCard: playerCard.checked, persona: persona.checked, cardWords: cardWords.value() })
            .then((result) => { last = result })
            .catch((error) => { last = { status: 'failed', at: new Date().toISOString(), way, name: name.value.trim(), reason: error instanceof Error ? error.message : String(error) } })
            .finally(() => { running = ''; drawState() })
    }
    personaButton.addEventListener('click', () => begin('persona'))
    customButton.addEventListener('click', () => begin('custom'))

    drawState()

    return {
        root,
        applySettings(settings) {
            if (settings.useDdMmYyFormat !== undefined) calendar.value = settings.useDdMmYyFormat === true ? 'date' : 'day'
            if (settings.use24hTime !== undefined) clock.value = settings.use24hTime === true ? '24' : '12'
        },
        applyPrefs(prefs) {
            if (typeof prefs.creatorInitialDate === 'string' && document.activeElement !== startDay) startDay.value = prefs.creatorInitialDate
            if (typeof prefs.creatorInitialTime === 'string' && document.activeElement !== startTime) startTime.value = prefs.creatorInitialTime
            if (prefs.creatorLevel !== undefined) level.value = String(prefs.creatorLevel)
            if (typeof prefs.creatorGenre === 'string') genre.value = normalizeInstantGenre(prefs.creatorGenre)
            if (typeof prefs.creatorGearTier === 'string') gearTier.value = prefs.creatorGearTier
            if (typeof prefs.creatorCombatScalingGuide === 'boolean') combat.checked = prefs.creatorCombatScalingGuide
            if (typeof prefs.creatorPlayerCard === 'boolean') playerCard.checked = prefs.creatorPlayerCard
            if (typeof prefs.creatorPersona === 'boolean') persona.checked = prefs.creatorPersona
            if (typeof prefs.creatorCardWords === 'number') cardWords.set(prefs.creatorCardWords)
            if (prefs.creatorWaysDraft !== undefined) {
                name.value = prefs.creatorWaysDraft?.name ?? ''
                instructions.value = prefs.creatorWaysDraft?.instructions ?? ''
            }
            drawState()
        },
        setChat(id) {
            chatId = id
            if (!id) last = null
            drawState()
        },
        busy: () => running !== '',
    }
}
