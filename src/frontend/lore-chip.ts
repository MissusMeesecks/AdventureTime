/**
 * The lore size warning's chip and its window (1.1.0, departure 175): when
 * the lore Lumiverse sent with the last reply is over the user's number, a
 * chip stands beside the head's lights — not a light, since a light means a
 * pass is running — and a press opens the entries by size in the host's
 * modal, each of the campaign's own with the agent's targeted Clean.
 *
 * Nothing here changes what Lumiverse activates.
 */

import { openDetailsModal, type DetailsModalUi } from './details-modal.js'
import type { LoreLoadEntry, LoreLoadResult } from '../protocol.js'

type El = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, string>) => HTMLElementTagNameMap[K]

const number = (n: number): string => n.toLocaleString('en-US')

/** `61k`, `9.6k`, `840`: short enough for the lights' row on a phone. */
export function shortTokens(total: number): string {
    if (total < 1000) return String(Math.round(total))
    if (total < 10000) return `${(Math.floor(total / 100) / 10).toString().replace(/\.0$/, '')}k`
    return `${Math.round(total / 1000)}k`
}

export function loreWarningText(total: number, threshold: number): string {
    return `Lumiverse sent about ${number(total)} tokens of lore with the last reply, over your ${number(threshold)} warning.`
}

export const LORE_BUDGET_PLACE = 'Lumiverse’s own limit is Max Token Budget, under Activation Settings in its World Book panel. AdventureTime cannot read that setting. When it is set, Lumiverse leaves out the lowest-priority entries over it. Entries marked always sent are never left out.'

/** What Lumiverse's own limits did to this reply, as far as the host said. */
export function loreBudgetLine(leftOut: number | null): string {
    if (leftOut === null) return 'Lumiverse’s own budget: this Lumiverse did not say whether it left any entry out.'
    if (leftOut === 0) return 'Lumiverse’s own budget: no entry was left out of this reply, so no limit is set or none was reached.'
    return `Lumiverse’s own budget: a limit is set, and Lumiverse left ${leftOut} entr${leftOut === 1 ? 'y' : 'ies'} out of this reply because of it.`
}

export interface LoreChipDeps {
    el: El
    ui: DetailsModalUi | undefined
    /** Where the window stands when the host has no modal. */
    inline: HTMLElement
    /** The agent's cleanup pass on one entry, by its `Book::uid` address. */
    clean(target: string): Promise<void>
}

export interface LoreChip {
    readonly node: HTMLButtonElement
    /** The backend's last answer for the open chat; `null` for no chat. */
    set(result: LoreLoadResult | null): void
}

const PRESS_EVENTS = ['pointerdown', 'mousedown', 'touchstart'] as const

export function createLoreChip(deps: LoreChipDeps): LoreChip {
    const { el } = deps
    const node = el('button', { type: 'button', class: 'lh-lore-chip', 'data-lh-field': 'lore-chip' })
    node.hidden = true
    // The one window's title row is the host's drag handle: the chip keeps its own press.
    for (const type of PRESS_EVENTS) node.addEventListener(type, (event) => { event.stopPropagation() })
    let current: LoreLoadResult | null = null
    let close: (() => void) | null = null

    function row(entry: LoreLoadEntry): HTMLElement {
        const line = el('div', { class: 'lh-lore-row', 'data-lh-lore-entry': entry.id })
        const name = el('div', { class: 'lh-lore-row-name' })
        const title = el('span', { class: 'lh-lore-row-title' })
        title.textContent = entry.title || '(untitled entry)'
        const book = el('span', { class: 'lh-lore-row-book' })
        book.textContent = [entry.book, entry.constant ? 'always sent' : ''].filter(Boolean).join(' · ')
        name.append(title, book)
        const tokens = el('span', { class: 'lh-lore-row-tokens' })
        tokens.textContent = `${number(entry.tokens)} tokens`
        line.append(name, tokens)
        if (entry.cleanTarget) {
            const target = entry.cleanTarget
            const clean = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'lore-clean' })
            clean.textContent = '🧹 Clean'
            clean.title = 'Run the Lorebook Agent’s cleanup on this one entry. It rewrites the entry shorter and keeps its facts.'
            const note = el('div', { class: 'lh-lore-row-note' })
            clean.addEventListener('click', () => {
                clean.disabled = true
                note.classList.remove('lh-lore-row-note--problem')
                note.textContent = 'Cleaning. The Lorebook Agent is rewriting this entry…'
                deps.clean(target)
                    .then(() => { note.textContent = 'Cleanup finished. The agent’s report is in the Lore widget. The new size shows after the next reply.' })
                    .catch((error: unknown) => {
                        note.classList.add('lh-lore-row-note--problem')
                        note.textContent = `Cleanup failed: ${error instanceof Error ? error.message : String(error)}`
                    })
                    .finally(() => { clean.disabled = false })
            })
            line.append(clean, note)
        }
        return line
    }

    function open(): void {
        const load = current?.load
        if (!current || !load) return
        close?.()
        const box = el('div', { class: 'lh-lore-load', 'data-lh-field': 'lore-load' })
        const lead = el('div', { class: 'lh-lore-load-lead' })
        lead.textContent = loreWarningText(load.total, current.threshold)
        const budget = el('div', { class: 'lh-lore-load-budget' })
        budget.textContent = `${loreBudgetLine(load.leftOut)} ${LORE_BUDGET_PLACE}`
        const hint = el('div', { class: 'lh-lore-load-hint' })
        hint.textContent = 'Sizes are Lumiverse’s own estimate, about four characters to a token. Clean is offered on this campaign’s own entries. Change the warning under Lorebook Agent → Cleanup & full audit.'
        const list = el('div', { class: 'lh-lore-rows' })
        for (const entry of load.entries) list.append(row(entry))
        const shut = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'lore-load-close' })
        shut.textContent = 'Close'
        box.append(lead, budget, hint, list, shut)
        const modal = openDetailsModal(deps.ui, { title: 'Active lore by size', nodes: [box], width: 640 })
        if (!modal) deps.inline.replaceChildren(box)
        close = () => { modal?.close(); box.remove(); close = null }
        shut.addEventListener('click', () => { close?.() })
    }

    node.addEventListener('click', open)

    return {
        node,
        set(result) {
            current = result
            const load = result?.load
            const over = !!result && result.over && !!load
            node.hidden = !over
            if (!over || !load || !result) {
                node.textContent = ''
                node.removeAttribute('title')
                return
            }
            node.textContent = `⚠ Lore ${shortTokens(load.total)}`
            const text = loreWarningText(load.total, result.threshold)
            node.title = text
            node.setAttribute('aria-label', `${text} Open the entries by size.`)
        },
    }
}
