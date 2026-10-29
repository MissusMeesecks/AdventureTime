/**
 * The tracker modules editor — and, since Phase 82, the cards' order with it.
 *
 * `src/settings/tracker-modules.ts` has the reasoning. The short version: this
 * is the switch for the ten stock blocks, and it is the counterpart of the
 * custom fields editor one section down — that one owns the user's own blocks,
 * this one owns the ones the cartridge ships with.
 *
 * Two rows behave unlike the rest and say so rather than pretending: `benched
 * party` is switched off by the engine (Phase 12) and draws no switch at all,
 * and `quests` is gated by a second key, so its switch writes both.
 *
 * Since Phase 36 a row's stock text can be edited in place: **Edit the text**
 * opens it, **Save** writes `stockPrompts` whole, **Reset to stock** puts the
 * factory's text back, and a row whose text differs from the factory's wears
 * an *edited* badge. The text is what both the tracker and the narrator are
 * told about the block, so the party cap in the party module's text (*max 5 +
 * {{user}}*) is changeable here and nowhere else.
 *
 * Since Phase 82 (the maintainer's ask of 2026-10-28) the list **is** the
 * section order (37): the rows stand in `blockOrder`, every one carries the
 * legacy's up and down arrows, a move writes the order whole and the cards
 * redraw from what comes back. The custom fields' blocks take their place in
 * the list too — a row each, with the arrows and nothing else, since their
 * switch and text are the custom fields editor's — and a Display Group (75)
 * is a dashed row at its first member whose arrows move the members
 * together, as the legacy's order list draws it. A module whose block has no
 * card of its own (`benched party`, folded into the Party card) stands after
 * the ordered rows without arrows, and says why. **Reset to stock order**
 * puts the factory's order back with the custom fields after it; a
 * switched-off block keeps its row, dimmed, since its card is still drawn
 * while the memo holds the block. The tracker's prompt is not ordered by any
 * of it: `src/settings/block-order.ts` says why.
 */

import {
    buildBlockOrderView,
    moveBlock,
    stockBlockOrder,
    type BlockOrderRow,
    type BlockOrderSettings,
} from '../settings/block-order.js'
import {
    buildTrackerModulesView,
    setModuleEnabled,
    setModulePrompt,
    type ModuleRow,
    type TrackerModuleSettings,
} from '../settings/tracker-modules.js'
import { moveDisplayGroupInOrder, type DisplayGroup } from '../tracker/display-groups.js'

export interface TrackerModulesHost {
    createElement: <K extends keyof HTMLElementTagNameMap>(
        tag: K,
        attrs?: Record<string, string>,
    ) => HTMLElementTagNameMap[K]
}

export interface TrackerModulesEditor {
    setSettings(settings: TrackerModuleSettings): void
    /** The factory's stock prompts (36), fetched by the panel: the *edited* badges and Reset to stock need them. */
    setFactory(factory: Record<string, string>): void
    /** The Display Groups (75), preferences rather than the cartridge's: each is drawn at its first member (82). */
    setDisplayGroups(groups: readonly DisplayGroup[], enabled: boolean): void
    destroy(): void
}

/**
 * What a change here writes. `syspromptModules` only when it actually moved;
 * `stockPrompts` alone for a text edit (36); `blockOrder` alone for a move (82).
 */
export interface TrackerModulesChange {
    modules?: Record<string, boolean>
    syspromptModules?: Record<string, boolean>
    stockPrompts?: Record<string, string>
    blockOrder?: string[]
}

/** Where a row stands in the order: its index and the count, for the arrows. */
interface Place {
    index: number
    count: number
    tag: string
}

export function mountTrackerModulesEditor(
    root: HTMLElement,
    host: TrackerModulesHost,
    initial: TrackerModuleSettings,
    onChange: (change: TrackerModulesChange) => void,
): TrackerModulesEditor {
    const el = host.createElement

    let settings: TrackerModuleSettings = { ...initial }
    let factory: Record<string, string> = {}
    let displayGroups: readonly DisplayGroup[] = []
    let displayGroupsEnabled = false
    /** The row whose text is open for editing, and the draft as typed: kept across renders, so a settings refresh does not lose it. */
    let editing: { key: string; draft: string } | null = null

    const summary = el('div', { class: 'lh-tm-summary' })
    const list = el('div', { class: 'lh-tm-list' })
    const foot = el('div', { class: 'lh-tm-foot' })
    root.replaceChildren(summary, list, foot)

    function setEnabled(row: ModuleRow, enabled: boolean): void {
        const next = setModuleEnabled(settings, row.key, enabled)

        const change: TrackerModulesChange = { modules: next.modules }
        // Sent only when it moved, so an ordinary toggle is a one-key patch and
        // the quests case is a two-key one.
        if (next.syspromptModules !== settings.syspromptModules) {
            change.syspromptModules = next.syspromptModules
        }

        settings = { ...settings, ...next }
        onChange(change)
        render()
    }

    function savePrompt(row: ModuleRow, prompt: string): void {
        const next = setModulePrompt(settings, row.key, prompt)
        settings = { ...settings, ...next }
        editing = null
        onChange({ stockPrompts: next.stockPrompts })
        render()
    }

    /** A move of one block (37): the whole order, or nothing when the block is at that end already. */
    function move(tag: string, delta: -1 | 1): void {
        const next = moveBlock(settings as BlockOrderSettings, tag, delta)
        if (!next) return
        settings = { ...settings, blockOrder: next }
        onChange({ blockOrder: next })
        render()
    }

    function writeOrder(next: string[]): void {
        settings = { ...settings, blockOrder: next }
        onChange({ blockOrder: next })
        render()
    }

    function arrows(place: Place): HTMLElement[] {
        const up = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-tm-move', 'aria-label': `Move [${place.tag}] up` })
        up.textContent = '▲'
        up.disabled = place.index === 0
        up.addEventListener('click', () => { move(place.tag, -1) })
        const down = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-tm-move', 'aria-label': `Move [${place.tag}] down` })
        down.textContent = '▼'
        down.disabled = place.index === place.count - 1
        down.addEventListener('click', () => { move(place.tag, 1) })
        return [up, down]
    }

    function renderEditor(row: ModuleRow): HTMLElement {
        const box = el('div', { class: 'lh-tm-editor' })
        const hint = el('div', { class: 'lh-tm-hint' })
        hint.textContent = `What the tracker is told about ${row.tag}; the narrator reads it only where a world-rule section carries {{modulesText}}. {{user}} stands for the player’s name. Save writes it into the cartridge; Reset to stock puts the factory’s text back.`
        const area = el('textarea', { class: 'lh-input lh-tm-text', rows: '12', spellcheck: 'false', 'data-lh-field': `module-text-${row.key}` })
        area.value = editing?.draft ?? row.prompt
        area.addEventListener('input', () => { if (editing) editing.draft = area.value })
        const buttons = el('div', { class: 'lh-world-buttons' })
        const save = el('button', { type: 'button', class: 'lh-button' })
        save.textContent = 'Save'
        save.addEventListener('click', () => { savePrompt(row, area.value) })
        const cancel = el('button', { type: 'button', class: 'lh-button lh-button--quiet' })
        cancel.textContent = 'Cancel'
        cancel.addEventListener('click', () => { editing = null; render() })
        const reset = el('button', { type: 'button', class: 'lh-button lh-button--quiet' })
        reset.textContent = 'Reset to stock'
        const stock = factory[row.key] ?? ''
        reset.disabled = !stock || area.value.trim() === stock.trim()
        reset.title = stock ? 'Put the factory’s text in the box; Save keeps it.' : 'The factory’s text for this module is not to hand.'
        reset.addEventListener('click', () => { area.value = stock; if (editing) editing.draft = stock; reset.disabled = true })
        area.addEventListener('input', () => { reset.disabled = !stock || area.value.trim() === stock.trim() })
        buttons.append(save, cancel, reset)
        box.append(hint, area, buttons)
        return box
    }

    /** A stock module's row: the switch, the badges, the tag, the text, and its arrows where its block has a card of its own. */
    function renderRow(row: ModuleRow, place: Place | null): HTMLElement {
        const item = el('div', { class: `lh-tm-row lh-tm-row--${row.verdict}` })
        if (place) item.setAttribute('data-lh-order', place.tag)
        if (row.verdict === 'off') item.title = 'Switched off: its card is drawn only while the memo still holds the block.'

        const head = el('div', { class: 'lh-tm-head' })

        if (row.switchable) {
            const toggle = el('input', { type: 'checkbox' })
            toggle.checked = row.verdict === 'on' || row.verdict === 'no-prompt'
            toggle.title = `Maintain the ${row.tag} block`
            toggle.addEventListener('change', () => { setEnabled(row, toggle.checked) })
            head.append(toggle)
        } else {
            // A spacer, so the names line up down the column.
            head.append(el('span', { class: 'lh-tm-nocheck' }))
        }

        const name = el('span', { class: 'lh-tm-name' })
        name.textContent = row.label
        head.append(name)

        // Only the two states that are not simply on or off get a badge. An
        // ordinary switched-off row is a normal choice, not a fault, and
        // badging it would put a chip on most of the list.
        if (row.verdict === 'unsupported' || row.verdict === 'no-prompt') {
            const badge = el('span', { class: `lh-tm-badge lh-tm-badge--${row.verdict}` })
            badge.textContent = row.verdict === 'unsupported' ? 'engine off' : 'no instructions'
            head.append(badge)
        }

        if (row.edited) {
            const badge = el('span', { class: 'lh-tm-badge lh-tm-badge--edited' })
            badge.textContent = 'edited'
            badge.title = 'This module’s text differs from the factory’s.'
            head.append(badge)
        }

        const tag = el('code', { class: 'lh-tm-tag' })
        tag.textContent = row.tag
        head.append(tag)

        if (row.switchable) {
            const edit = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-tm-edit' })
            edit.textContent = editing?.key === row.key ? 'Editing…' : 'Edit the text'
            edit.disabled = editing?.key === row.key
            edit.title = `Open ${row.tag}’s text to change it.`
            edit.addEventListener('click', () => { editing = { key: row.key, draft: row.prompt }; render() })
            head.append(edit)
        }

        if (place) {
            head.append(...arrows(place))
        } else {
            // No card of its own, so no place in the order: the one case is benched party, drawn inside the Party card.
            const note = el('span', { class: 'lh-tm-noplace' })
            note.textContent = 'drawn inside the Party card'
            note.title = 'This block has no card of its own, so it has no place in the order.'
            head.append(note)
        }

        item.append(head)

        if (row.summary && editing?.key !== row.key) {
            const blurb = el('div', { class: 'lh-tm-summary-line' })
            blurb.textContent = row.summary
            item.append(blurb)
        }

        if (editing?.key === row.key) item.append(renderEditor(row))

        return item
    }

    /**
     * A block's place in the order and nothing else (82): a custom field's, whose switch and text are the
     * custom fields editor's, or a stock block the bag names no module for (a partial bag; the store's
     * backfill never leaves one).
     */
    function renderCustomRow(row: BlockOrderRow, place: Place): HTMLElement {
        const item = el('div', { class: `lh-tm-row${row.custom ? ' lh-tm-row--custom' : ''}${row.enabled ? '' : ' lh-tm-row--off'}`, 'data-lh-order': place.tag })
        if (row.custom) {
            item.title = row.enabled
                ? 'A custom field. Its switch and its text are under Custom fields; its place in the cards is here.'
                : 'A custom field, switched off under Custom fields: its card is drawn only while the memo still holds the block.'
        }
        const head = el('div', { class: 'lh-tm-head' })
        const icon = el('span', { class: 'lh-tm-icon', 'aria-hidden': 'true' })
        icon.textContent = row.icon
        const name = el('span', { class: 'lh-tm-name' })
        name.textContent = row.label
        const tag = el('code', { class: 'lh-tm-tag' })
        tag.textContent = `[${row.tag}]`
        head.append(icon, name)
        if (row.custom) {
            const badge = el('span', { class: 'lh-tm-badge lh-tm-badge--custom' })
            badge.textContent = 'custom field'
            head.append(badge)
        }
        head.append(tag, ...arrows(place))
        item.append(head)
        return item
    }

    /** The legacy's group row (75): dashed, dimmed while the group or the switch is off, its arrows moving the members as one. */
    function renderGroupRow(group: DisplayGroup, order: string[]): HTMLElement {
        const memberSet = new Set(group.members)
        const indices = order.map((tag, index) => (memberSet.has(tag) ? index : -1)).filter((index) => index >= 0)
        const firstIndex = indices[0] ?? -1
        const lastIndex = indices[indices.length - 1] ?? -1
        const active = displayGroupsEnabled && group.enabled
        const item = el('div', { class: `lh-tm-row lh-tm-group${active ? '' : ' lh-tm-row--off'}`, 'data-lh-group': group.id })
        item.title = 'Display-only group. Its arrows move all listed member modules together.'
        const head = el('div', { class: 'lh-tm-head' })
        const icon = el('span', { class: 'lh-tm-icon', 'aria-hidden': 'true' })
        icon.textContent = '🗂️'
        const name = el('span', { class: 'lh-tm-name' })
        name.textContent = `${group.icon} ${group.name} (${group.members.length})`
        const badge = el('span', { class: 'lh-tm-badge lh-tm-badge--group' })
        badge.textContent = 'DISPLAY GROUP'
        const moveGroup = (direction: 'up' | 'down'): void => {
            writeOrder(moveDisplayGroupInOrder(order, group.members, direction))
        }
        const up = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-tm-move', 'aria-label': `Move the group ${group.name} up` })
        up.textContent = '▲'
        up.disabled = firstIndex <= 0
        up.addEventListener('click', () => { moveGroup('up') })
        const down = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-tm-move', 'aria-label': `Move the group ${group.name} down` })
        down.textContent = '▼'
        down.disabled = lastIndex < 0 || lastIndex >= order.length - 1
        down.addEventListener('click', () => { moveGroup('down') })
        head.append(icon, name, badge, up, down)
        item.append(head)
        return item
    }

    function render(): void {
        const view = buildTrackerModulesView(settings, factory)
        const order = buildBlockOrderView(settings as BlockOrderSettings)

        summary.replaceChildren()

        const lead = el('div', { class: 'lh-tm-lead' })
        lead.textContent = view.summary
        summary.append(lead)

        const orderLead = el('div', { class: 'lh-tm-order-lead' })
        orderLead.textContent = 'Top first: the arrows set the order the cards are drawn in, in the panel and under each message. A switched-off block keeps its place, dimmed, since its card is drawn while the memo holds the block. The tracker’s prompt is not ordered by it.'
        summary.append(orderLead)

        if (view.counts) {
            const counts = el('div', { class: 'lh-tm-counts' })
            counts.textContent = view.counts
            summary.append(counts)
        }

        for (const note of view.notes) {
            const line = el('div', { class: 'lh-tm-note' })
            line.textContent = note
            summary.append(line)
        }

        // The rows in the order (82): a stock module's row where the order names its block, a custom
        // field's where it names a field, a group's row before its first member (75), and after them
        // the modules whose block has no card of its own.
        const byTag = new Map(view.rows.map((row) => [row.tag, row] as const))
        const groupsByFirstMember = new Map<string, DisplayGroup>()
        for (const group of displayGroups) {
            const first = order.order.find((tag) => group.members.includes(tag))
            if (first && !groupsByFirstMember.has(first)) groupsByFirstMember.set(first, group)
        }
        const placed = new Set<string>()
        const rows: HTMLElement[] = []
        order.rows.forEach((orderRow, index) => {
            const group = groupsByFirstMember.get(orderRow.tag)
            if (group) rows.push(renderGroupRow(group, order.order))
            const place: Place = { index, count: order.rows.length, tag: orderRow.tag }
            const module = byTag.get(`[${orderRow.tag}]`)
            if (module && !orderRow.custom) {
                placed.add(module.key)
                rows.push(renderRow(module, place))
            } else {
                rows.push(renderCustomRow(orderRow, place))
            }
        })
        for (const module of view.rows) if (!placed.has(module.key)) rows.push(renderRow(module, null))
        list.replaceChildren(...rows)

        const state = el('span', { class: 'lh-tm-state' })
        state.textContent = order.stock ? 'The stock order.' : 'Changed from the stock order.'
        const resetButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet' })
        resetButton.textContent = 'Reset to stock order'
        resetButton.disabled = order.stock
        resetButton.title = 'The factory’s order, with your own blocks after it.'
        resetButton.addEventListener('click', () => { writeOrder(stockBlockOrder(settings as BlockOrderSettings)) })
        foot.replaceChildren(state, resetButton)
    }

    render()

    return {
        setSettings(next) {
            settings = { ...next }
            render()
        },
        setFactory(next) {
            factory = { ...next }
            render()
        },
        setDisplayGroups(groups, enabled) {
            displayGroups = groups
            displayGroupsEnabled = enabled
            render()
        },
        destroy() {
            root.replaceChildren()
        },
    }
}
