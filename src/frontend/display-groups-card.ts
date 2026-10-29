/**
 * The Display Groups manager (Phase 75, roadmap row 73): Multihog's
 * `display-groups.js` popup as a card of *State tracker & modules* (63's
 * rule: on the panel, not a modal), after the rendering tags library,
 * where Multihog's button sits under *Modules & Order*.
 *
 * The two switches, the list of groups (enable, edit, delete), **Create
 * Display Group**, and the editor: the icon and the name, *MODULE ORDER IN
 * THIS GROUP* with arrows, the member checklist — the stock blocks less the
 * three excluded, the custom and wizard fields, a tag another group claims
 * greyed with *In <group>*, a member the install no longer has kept ticked
 * as *Unavailable* — and **Save Display Group**. The legacy's popup saves an
 * open edit on *Done*; a card has no Done, so **Cancel** closes the editor
 * and drops the edit. Every change is a `prefs.patch` of the three
 * preferences, normalised by the legacy's own rule first; the answer comes
 * back on `prefs.changed`, which every drawer reads.
 */
import {
    DISPLAY_GROUP_EXCLUDED_TAGS,
    knownDisplayGroupModules,
    normalizeDisplayGroups,
    readDisplayGroups,
    type DisplayGroup,
    type DisplayGroupModule,
} from '../tracker/display-groups.js'

type El = (tag: string, attrs?: Record<string, string>) => HTMLElement

export interface DisplayGroupsCardHost {
    el: El
    /** `prefs.patch` with the three preferences. */
    savePrefs(patch: Record<string, unknown>): Promise<unknown>
    confirm(title: string, message: string, confirmLabel: string): Promise<boolean>
    fail(error: unknown): void
}

export interface DisplayGroupsCard {
    root: HTMLDetailsElement
    /** The three preferences read off a set, as `prefs.get` and `prefs.changed` carry them. */
    applyPrefs(prefs: Record<string, unknown>): void
    /** The cartridge, for the custom fields the checklist offers. */
    setSettings(settings: { customFields?: unknown }): void
}

/** The legacy's id: the clock in base 36 and six random characters. */
function newDisplayGroupId(): string {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * The icons the editor offers on a click (75-bis): the stock modules' own, then
 * a spread for the groups people make. A typed emoji is still taken as it is.
 */
export const DISPLAY_GROUP_ICON_PALETTE: readonly string[] = [
    '🗂️', '🧙', '👥', '🎒', '✨', '📖', '🌟', '🕒', '🛡️', '⚔️', '🏹', '🧪', '💰', '🗺️', '🧭', '🏰',
    '🚙', '🐺', '🐉', '🔥', '❤️', '🧠', '🎲', '🎯', '⚙️', '📦', '🌙', '🌿', '🎵', '📡', '💎', '🧩',
]

const EXCLUDED_NOTE = 'Select modules to render under this shared header. Use the arrows below to choose their order inside the group. Combat, Quests, and Benched Party cannot be grouped.'

export function createDisplayGroupsCard(host: DisplayGroupsCardHost): DisplayGroupsCard {
    const el = host.el
    let groups: DisplayGroup[] = []
    let enabled = false
    let showGaps = false
    let settings: { customFields?: unknown } = {}
    /** The editor's state while it is open: the group's index (-1 for a new one), its draft and its member order. */
    let editing: { index: number; icon: string; name: string; order: string[] } | null = null

    const root = el('details', { class: 'lh-card lh-second-card lh-search-item', 'data-lh-card': 'display-groups' }) as HTMLDetailsElement
    const summary = el('summary')
    const iconEl = el('span', { class: 'lh-card-icon', 'aria-hidden': 'true' })
    iconEl.textContent = '🗂️'
    const titleEl = el('span', { class: 'lh-card-title' })
    titleEl.textContent = 'Display Groups'
    summary.append(iconEl, titleEl, el('span', { class: 'lh-chevron', 'aria-hidden': 'true' }))
    const body = el('div', { class: 'lh-second-body lh-dg-body' })
    const lead = el('div', { class: 'lh-second-lead' })
    lead.textContent = 'Display Groups allow you to visually bundle together related modules without their headers, allowing for a neater, less bulky display. Display Groups are global and display-only. They never merge memo blocks, prompts, module activation, scope, or Wizard Game Systems. Disable the master toggle to restore the existing renderer immediately.'

    const enabledRow = el('label', { class: 'lh-check lh-dg-option' })
    const enabledInput = el('input', { type: 'checkbox', 'data-lh-field': 'displayGroupsEnabled' }) as HTMLInputElement
    const enabledCopy = el('span', { class: 'lh-dg-option-copy' })
    enabledCopy.innerHTML = '<strong>Enable Display Groups</strong><small>Use your saved groups in the tracker display.</small>'
    enabledRow.title = 'Turn this off to immediately restore the existing independent module rendering without deleting your groups.'
    enabledRow.append(enabledInput, enabledCopy)
    const gapsRow = el('label', { class: 'lh-check lh-dg-option' })
    const gapsInput = el('input', { type: 'checkbox', 'data-lh-field': 'displayGroupsShowGaps' }) as HTMLInputElement
    const gapsCopy = el('span', { class: 'lh-dg-option-copy' })
    gapsCopy.innerHTML = '<strong>Show gaps between grouped modules</strong><small>Turn off for a completely seamless grouped display.</small>'
    gapsRow.title = 'When disabled, grouped modules have no separator line or vertical gap between them.'
    gapsRow.append(gapsInput, gapsCopy)

    const list = el('div', { class: 'lh-dg-list', 'data-lh-field': 'display-groups-list' })
    const add = el('button', { type: 'button', class: 'lh-button lh-dg-add', 'data-lh-action': 'display-group-add' })
    add.textContent = '+ Create Display Group'
    const editor = el('div', { class: 'lh-dg-editor', 'data-lh-field': 'display-group-editor' })
    editor.hidden = true
    const note = el('div', { class: 'lh-second-note', 'data-lh-field': 'display-groups-note' })

    body.append(lead, enabledRow, gapsRow, list, add, editor, note)
    root.append(summary, body)

    function say(message: string, error = false): void {
        note.textContent = message
        note.classList.toggle('lh-second-note--error', error)
    }

    /** Write the groups, normalised by the legacy's rule, and draw what was written. */
    function persist(next: DisplayGroup[]): void {
        groups = normalizeDisplayGroups(next)
        renderList()
        host.savePrefs({ displayGroups: groups }).catch((error: unknown) => { host.fail(error) })
    }

    enabledInput.addEventListener('change', () => {
        enabled = enabledInput.checked
        say(enabled ? 'Display Groups enabled.' : 'Display Groups disabled. Normal module cards restored.')
        host.savePrefs({ displayGroupsEnabled: enabled }).catch((error: unknown) => { host.fail(error) })
    })
    gapsInput.addEventListener('change', () => {
        showGaps = gapsInput.checked
        host.savePrefs({ displayGroupsShowGaps: showGaps }).catch((error: unknown) => { host.fail(error) })
    })
    add.addEventListener('click', () => { openEditor(-1) })

    function renderList(): void {
        list.replaceChildren()
        if (groups.length === 0) {
            const empty = el('div', { class: 'lh-dg-empty' })
            empty.textContent = 'No Display Groups configured.'
            list.append(empty)
            return
        }
        groups.forEach((group, index) => {
            const row = el('div', { class: 'lh-dg-row', 'data-lh-group': group.id })
            const tick = el('input', { type: 'checkbox', class: 'lh-dg-enabled', title: 'Enable this global Display Group' }) as HTMLInputElement
            tick.checked = group.enabled
            tick.addEventListener('change', () => {
                const next = groups.map((g, i) => (i === index ? { ...g, enabled: tick.checked } : g))
                persist(next)
            })
            const icon = el('span', { class: 'lh-dg-icon' })
            icon.textContent = group.icon
            const text = el('div', { class: 'lh-dg-text' })
            const name = el('div', { class: 'lh-dg-name' })
            name.textContent = group.name
            const members = el('div', { class: 'lh-dg-members-line' })
            members.textContent = group.members.join(' · ')
            text.append(name, members)
            const editButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-dg-edit', title: 'Edit' })
            editButton.textContent = '✎'
            editButton.addEventListener('click', () => { openEditor(index) })
            const deleteButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-dg-delete', title: 'Delete' })
            deleteButton.textContent = '🗑'
            deleteButton.addEventListener('click', () => {
                host.confirm('Delete Display Group?', `Delete Display Group "${group.name}"?\n\nIts modules will not be deleted or disabled.`, 'Delete')
                    .then((approved) => {
                        if (!approved) return
                        if (editing && editing.index === index) closeEditor()
                        persist(groups.filter((_, i) => i !== index))
                    })
                    .catch((error: unknown) => { host.fail(error) })
            })
            row.append(tick, icon, text, editButton, deleteButton)
            list.append(row)
        })
    }

    function closeEditor(): void {
        editing = null
        editor.hidden = true
        editor.replaceChildren()
    }

    function openEditor(index: number): void {
        const existing = index >= 0 ? groups[index] ?? null : null
        editing = { index, icon: existing?.icon ?? '🗂️', name: existing?.name ?? '', order: [...(existing?.members ?? [])] }
        editor.hidden = false
        renderEditor()
    }

    function renderEditor(): void {
        const draft = editing
        if (!draft) return
        const existing = draft.index >= 0 ? groups[draft.index] ?? null : null
        // What the other groups claim, so a tag is offered to one group only.
        const otherClaims = new Map<string, string>()
        groups.forEach((group, i) => {
            if (i === draft.index) return
            for (const tag of group.members) otherClaims.set(tag, group.name)
        })
        const modules = knownDisplayGroupModules(settings)
        const known = new Set(modules.map((m) => m.tag))
        const unavailable = (existing?.members ?? []).filter((tag) => !known.has(tag))
        const byTag = new Map<string, DisplayGroupModule>(modules.map((m) => [m.tag, m]))

        editor.replaceChildren()
        const title = el('div', { class: 'lh-dg-editor-title' })
        title.textContent = `${existing ? 'Edit' : 'Create'} Display Group`
        const head = el('div', { class: 'lh-dg-editor-head' })
        const iconInput = el('input', { class: 'lh-input lh-dg-icon-input', maxlength: '16', placeholder: '🗂️', title: 'The group’s icon: type or paste an emoji, or pick one from the row below', 'data-lh-field': 'display-group-icon' }) as HTMLInputElement
        iconInput.value = draft.icon
        // The palette (75-bis): Multihog's box takes a typed emoji and nothing else, and a typed emoji is
        // not obvious on every keyboard, so a row of icons under the head writes one into the box on a click.
        const palette = el('div', { class: 'lh-dg-icon-palette', role: 'group', 'aria-label': 'Pick an icon' })
        const markPicked = (): void => {
            for (const button of Array.from(palette.children) as HTMLElement[]) button.classList.toggle('lh-dg-icon-pick--picked', button.dataset['lhIcon'] === draft.icon)
        }
        for (const icon of DISPLAY_GROUP_ICON_PALETTE) {
            const button = el('button', { type: 'button', class: 'lh-dg-icon-pick', 'data-lh-icon': icon, title: `Use ${icon}` })
            button.textContent = icon
            button.addEventListener('click', () => { draft.icon = icon; iconInput.value = icon; markPicked() })
            palette.append(button)
        }
        iconInput.addEventListener('input', () => { draft.icon = iconInput.value; markPicked() })
        markPicked()
        const nameInput = el('input', { class: 'lh-input lh-dg-name-input', maxlength: '80', placeholder: 'Display Group name', 'data-lh-field': 'display-group-name' }) as HTMLInputElement
        nameInput.value = draft.name
        nameInput.addEventListener('input', () => { draft.name = nameInput.value })
        head.append(iconInput, nameInput)
        const hint = el('div', { class: 'lh-second-note' })
        hint.textContent = EXCLUDED_NOTE
        const orderTitle = el('div', { class: 'lh-dg-subtitle' })
        orderTitle.textContent = 'MODULE ORDER IN THIS GROUP'
        const orderBox = el('div', { class: 'lh-dg-order', 'data-lh-field': 'display-group-order' })
        const members = el('div', { class: 'lh-dg-members', 'data-lh-field': 'display-group-members' })

        const renderOrder = (): void => {
            orderBox.replaceChildren()
            if (draft.order.length === 0) {
                const empty = el('div', { class: 'lh-dg-empty' })
                empty.textContent = 'Select modules below, then arrange them here.'
                orderBox.append(empty)
                return
            }
            draft.order.forEach((tag, i) => {
                const item = byTag.get(tag)
                const row = el('div', { class: 'lh-dg-order-row', 'data-lh-order-tag': tag })
                const icon = el('span', { class: 'lh-dg-icon' })
                icon.textContent = item?.icon ?? '⚠️'
                const label = el('span', { class: 'lh-dg-order-label' })
                label.textContent = `${item?.label ?? tag} [${tag}]`
                const up = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-dg-move', title: 'Move up', 'aria-label': `Move ${tag} up` }) as HTMLButtonElement
                up.textContent = '▲'
                up.disabled = i === 0
                up.addEventListener('click', () => {
                    ;[draft.order[i - 1], draft.order[i]] = [draft.order[i]!, draft.order[i - 1]!]
                    renderOrder()
                })
                const down = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-dg-move', title: 'Move down', 'aria-label': `Move ${tag} down` }) as HTMLButtonElement
                down.textContent = '▼'
                down.disabled = i === draft.order.length - 1
                down.addEventListener('click', () => {
                    ;[draft.order[i], draft.order[i + 1]] = [draft.order[i + 1]!, draft.order[i]!]
                    renderOrder()
                })
                row.append(icon, label, up, down)
                orderBox.append(row)
            })
        }

        const memberRow = (tag: string, icon: string, label: string, aside: string, checked: boolean, disabled: boolean): HTMLElement => {
            const row = el('label', { class: `lh-dg-member-row${disabled ? ' lh-dg-member-row--claimed' : ''}` })
            const box = el('input', { type: 'checkbox', class: 'lh-dg-member', value: tag }) as HTMLInputElement
            box.checked = checked
            box.disabled = disabled
            box.addEventListener('change', () => {
                if (box.checked && !draft.order.includes(tag)) draft.order.push(tag)
                if (!box.checked) draft.order = draft.order.filter((member) => member !== tag)
                renderOrder()
            })
            const iconEl = el('span', { class: 'lh-dg-icon' })
            iconEl.textContent = icon
            const text = el('span', { class: 'lh-dg-member-label' })
            text.textContent = `${label} [${tag}]`
            const small = el('small', { class: 'lh-dg-member-kind' })
            small.textContent = aside
            row.append(box, iconEl, text, small)
            return row
        }
        for (const item of modules) {
            const claimedBy = otherClaims.get(item.tag)
            members.append(memberRow(item.tag, item.icon, item.label, claimedBy ? `In ${claimedBy}` : item.kind, draft.order.includes(item.tag), !!claimedBy))
        }
        for (const tag of unavailable) members.append(memberRow(tag, '⚠️', tag, 'Unavailable', true, false))
        if (modules.length === 0 && unavailable.length === 0) {
            const empty = el('div', { class: 'lh-dg-empty' })
            empty.textContent = 'No eligible modules found.'
            members.append(empty)
        }

        const buttons = el('div', { class: 'lh-dg-editor-buttons' })
        const save = el('button', { type: 'button', class: 'lh-button lh-dg-save', 'data-lh-action': 'display-group-save' })
        save.textContent = 'Save Display Group'
        save.addEventListener('click', () => { saveEditor() })
        const cancel = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-action': 'display-group-cancel' })
        cancel.textContent = 'Cancel'
        cancel.addEventListener('click', () => { closeEditor() })
        buttons.append(save, cancel)

        editor.append(title, head, palette, hint, orderTitle, orderBox, members, buttons)
        renderOrder()
    }

    function saveEditor(): void {
        const draft = editing
        if (!draft) return
        const name = draft.name.trim()
        const icon = draft.icon.trim() || '🗂️'
        const members = draft.order.filter((tag) => !DISPLAY_GROUP_EXCLUDED_TAGS.has(tag))
        if (!name) { say('Give the Display Group a name.', true); return }
        if (members.length === 0) { say('Select at least one module.', true); return }
        const existing = draft.index >= 0 ? groups[draft.index] ?? null : null
        const next: DisplayGroup = { id: existing?.id ?? newDisplayGroupId(), name, icon, enabled: existing ? existing.enabled !== false : true, members }
        const all = existing ? groups.map((g, i) => (i === draft.index ? next : g)) : [...groups, next]
        closeEditor()
        say(`Saved the Display Group “${name}”.`)
        persist(all)
    }

    renderList()

    return {
        root,
        applyPrefs(prefs) {
            if (typeof prefs.displayGroupsEnabled === 'boolean') { enabled = prefs.displayGroupsEnabled; enabledInput.checked = enabled }
            if (typeof prefs.displayGroupsShowGaps === 'boolean') { showGaps = prefs.displayGroupsShowGaps; gapsInput.checked = showGaps }
            if (prefs.displayGroups !== undefined) {
                groups = readDisplayGroups(prefs.displayGroups)
                renderList()
            }
        },
        setSettings(next) {
            settings = next
            if (editing) renderEditor()
        },
    }
}

export const DISPLAY_GROUPS_CARD_CSS = `
.adventuretime-panel .lh-dg-option { align-items: center; gap: 8px; cursor: pointer; }
.adventuretime-panel .lh-dg-option-copy { display: flex; flex-direction: column; gap: 1px; }
.adventuretime-panel .lh-dg-option-copy small { opacity: 0.7; }
.adventuretime-panel .lh-dg-list { display: flex; flex-direction: column; gap: 6px; }
.adventuretime-panel .lh-dg-empty { padding: 10px; text-align: center; opacity: 0.6; font-size: 0.9em; border: 1px dashed var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25))); border-radius: 6px; }
.adventuretime-panel .lh-dg-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25))); border-radius: 6px; }
.adventuretime-panel .lh-dg-icon { font-size: 1.2em; }
.adventuretime-panel .lh-dg-text { flex: 1; min-width: 0; }
.adventuretime-panel .lh-dg-name { font-weight: 600; }
.adventuretime-panel .lh-dg-members-line { font-family: var(--lh-font-mono, var(--lumiverse-font-mono, monospace)); font-size: 0.8em; opacity: 0.65; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.adventuretime-panel .lh-dg-editor { display: flex; flex-direction: column; gap: 8px; padding: 8px; border: 1px solid var(--lh-accent, var(--lumiverse-primary, #d4a940)); border-radius: 8px; }
.adventuretime-panel .lh-dg-editor-title { font-weight: 600; }
.adventuretime-panel .lh-dg-editor-head { display: flex; gap: 6px; }
.adventuretime-panel .lh-dg-icon-input { width: 4em; flex: 0 0 4em; text-align: center; }
.adventuretime-panel .lh-dg-icon-palette { display: flex; flex-wrap: wrap; gap: 3px; }
.adventuretime-panel .lh-dg-icon-pick { width: 2em; height: 2em; padding: 0; line-height: 1; font-size: 1.05em; border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25))); border-radius: 5px; background: transparent; color: inherit; cursor: pointer; }
.adventuretime-panel .lh-dg-icon-pick:hover { border-color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
.adventuretime-panel .lh-dg-icon-pick--picked { border-color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); background: var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25))); }
.adventuretime-panel .lh-dg-name-input { flex: 1; min-width: 0; }
.adventuretime-panel .lh-dg-subtitle { font-size: 0.78em; font-weight: 700; letter-spacing: 0.06em; opacity: 0.72; }
.adventuretime-panel .lh-dg-order { display: flex; flex-direction: column; gap: 3px; }
.adventuretime-panel .lh-dg-order-row { display: flex; align-items: center; gap: 6px; padding: 3px 6px; border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25))); border-radius: 4px; }
.adventuretime-panel .lh-dg-order-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.9em; }
.adventuretime-panel .lh-dg-members { max-height: 300px; overflow-y: auto; border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25))); border-radius: 5px; padding: 3px; display: flex; flex-direction: column; }
.adventuretime-panel .lh-dg-member-row { display: flex; align-items: center; gap: 7px; padding: 4px 6px; border-radius: 4px; cursor: pointer; }
.adventuretime-panel .lh-dg-member-row--claimed { opacity: 0.45; cursor: not-allowed; }
.adventuretime-panel .lh-dg-member-label { flex: 1; min-width: 0; font-size: 0.9em; overflow-wrap: anywhere; }
.adventuretime-panel .lh-dg-member-kind { opacity: 0.6; flex: 0 0 auto; }
.adventuretime-panel .lh-dg-editor-buttons { display: flex; gap: 6px; flex-wrap: wrap; }
.adventuretime-panel .lh-tm-group { border: 1px dashed var(--lh-accent, var(--lumiverse-primary, #d4a940)); border-radius: 4px; }
`
