/**
 * The Agent modules editor (47e).
 *
 * `routerModules` is what the Lorebook Agent is told about each category
 * it records — NPC, LOC, FAC, QUEST, EVENT, WORLD — one instruction each,
 * with a switch. Since 45b the agent's prompt carries these words, and
 * until this editor the settings panel's row read *dedicated editor not
 * built yet*: the text the agent was sent could be neither seen nor
 * changed here. Same shape as the tracker modules editor (36), since it
 * answers the same question for the other model: a row per module with
 * its switch, its tag, an *edited* badge against the factory's text,
 * and **Edit the instruction** opening the text with Save, Cancel and
 * Reset to stock. A save writes the map whole, as the tracker's does.
 *
 * The NPC instruction's shipped paragraph is refreshed on the way to the
 * model whatever is saved here (45b), so an edit that keeps the old
 * paragraph is not a way to send it.
 */

import { isWorldModuleTag } from '../agent/campaign.js'

export interface AgentModule {
    enabled?: boolean
    tag?: string
    format?: string
    instruction?: string
}

export interface AgentModulesSettings {
    routerModules?: Record<string, AgentModule>
}

export interface AgentModulesHost {
    createElement: <K extends keyof HTMLElementTagNameMap>(
        tag: K,
        attrs?: Record<string, string>,
    ) => HTMLElementTagNameMap[K]
}

export interface AgentModulesEditor {
    setSettings(settings: AgentModulesSettings): void
    /** The factory's modules, fetched by the panel: the *edited* badges and Reset to stock need them. */
    setFactory(factory: Record<string, AgentModule>): void
    destroy(): void
}

export interface AgentModulesChange {
    routerModules: Record<string, AgentModule>
}

/** The module's tag as the agent's prompt prints it: the stored tag, or the key, upper-cased. */
export function moduleTag(key: string, module: AgentModule | undefined): string {
    return String(module?.tag ?? key).trim().toUpperCase() || key.toUpperCase()
}

export function mountAgentModulesEditor(
    root: HTMLElement,
    host: AgentModulesHost,
    initial: AgentModulesSettings,
    onChange: (change: AgentModulesChange) => void,
): AgentModulesEditor {
    const el = host.createElement

    let modules: Record<string, AgentModule> = { ...(initial.routerModules ?? {}) }
    let factory: Record<string, AgentModule> = {}
    /** The row whose instruction is open, and the draft as typed; kept across renders so a settings refresh does not lose it. */
    let editing: { key: string; draft: string } | null = null

    const lead = el('div', { class: 'lh-tm-lead' })
    lead.textContent = 'What the Lorebook Agent is told about each category it records. A category switched off is not recorded. Save writes the instruction into the cartridge; Reset to stock puts the factory’s text back.'
    const list = el('div', { class: 'lh-tm-list' })
    root.replaceChildren(lead, list)

    function write(next: Record<string, AgentModule>): void {
        modules = next
        onChange({ routerModules: { ...next } })
        render()
    }

    function setEnabled(key: string, enabled: boolean): void {
        write({ ...modules, [key]: { ...modules[key], enabled } })
    }

    function saveInstruction(key: string, instruction: string): void {
        editing = null
        write({ ...modules, [key]: { ...modules[key], instruction } })
    }

    function renderEditor(key: string, module: AgentModule): HTMLElement {
        const box = el('div', { class: 'lh-tm-editor' })
        const hint = el('div', { class: 'lh-tm-hint' })
        hint.textContent = `What the agent is told about ${moduleTag(key, module)}. {{user}} stands for the player’s name.`
        const area = el('textarea', { class: 'lh-input lh-tm-text', rows: '12', spellcheck: 'false', 'data-lh-field': `agent-module-text-${key}` })
        area.value = editing?.draft ?? String(module.instruction ?? '')
        area.addEventListener('input', () => { if (editing) editing.draft = area.value })
        const buttons = el('div', { class: 'lh-world-buttons' })
        const save = el('button', { type: 'button', class: 'lh-button' })
        save.textContent = 'Save'
        save.addEventListener('click', () => { saveInstruction(key, area.value) })
        const cancel = el('button', { type: 'button', class: 'lh-button lh-button--quiet' })
        cancel.textContent = 'Cancel'
        cancel.addEventListener('click', () => { editing = null; render() })
        const reset = el('button', { type: 'button', class: 'lh-button lh-button--quiet' })
        reset.textContent = 'Reset to stock'
        const stock = String(factory[key]?.instruction ?? '')
        const same = (): boolean => !stock || area.value.trim() === stock.trim()
        reset.disabled = same()
        reset.title = stock ? 'Put the factory’s text in the box; Save keeps it.' : 'The factory’s text for this module is not to hand.'
        reset.addEventListener('click', () => { area.value = stock; if (editing) editing.draft = stock; reset.disabled = true })
        area.addEventListener('input', () => { reset.disabled = same() })
        buttons.append(save, cancel, reset)
        box.append(hint, area, buttons)
        return box
    }

    function renderRow(key: string, module: AgentModule): HTMLElement {
        const enabled = module.enabled !== false
        const item = el('div', { class: `lh-tm-row lh-tm-row--${enabled ? 'on' : 'off'}` })
        const head = el('div', { class: 'lh-tm-head' })

        const toggle = el('input', { type: 'checkbox', 'data-lh-field': `agent-module-enabled-${key}` })
        toggle.checked = enabled
        toggle.title = `Record ${moduleTag(key, module)} entries`
        toggle.addEventListener('change', () => { setEnabled(key, toggle.checked) })
        head.append(toggle)

        const name = el('span', { class: 'lh-tm-name' })
        name.textContent = moduleTag(key, module)
        head.append(name)

        const stock = factory[key]?.instruction
        if (typeof stock === 'string' && String(module.instruction ?? '').trim() !== stock.trim()) {
            const badge = el('span', { class: 'lh-tm-badge lh-tm-badge--edited' })
            badge.textContent = 'edited'
            badge.title = 'This module’s instruction differs from the factory’s.'
            head.append(badge)
        }

        if (isWorldModuleTag(moduleTag(key, module))) {
            // World Progression's book (55-quater): the switch is kept as the
            // cartridge carries it, and the row says the category goes nowhere.
            const badge = el('span', { class: 'lh-tm-badge lh-tm-badge--world' })
            badge.textContent = 'World Progression’s'
            badge.title = 'In AdventureTime the World book is written by World Progression’s own pass (the World progression fold). Switched on, this module is not sent to the agent, and a WORLD record is refused.'
            head.append(badge)
        }

        const format = el('code', { class: 'lh-tm-tag' })
        format.textContent = String(module.format ?? '')
        format.title = 'The fields an entry of this category carries.'
        head.append(format)

        const edit = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-tm-edit' })
        edit.textContent = editing?.key === key ? 'Editing…' : 'Edit the instruction'
        edit.disabled = editing?.key === key
        edit.addEventListener('click', () => { editing = { key, draft: String(module.instruction ?? '') }; render() })
        head.append(edit)

        item.append(head)
        if (editing?.key === key) item.append(renderEditor(key, module))
        return item
    }

    function render(): void {
        const keys = Object.keys(modules)
        if (!keys.length) {
            const none = el('div', { class: 'lh-tm-note' })
            none.textContent = 'This cartridge carries no agent modules.'
            list.replaceChildren(none)
            return
        }
        list.replaceChildren(...keys.map((key) => renderRow(key, modules[key] ?? {})))
    }

    render()

    return {
        setSettings(next: AgentModulesSettings): void {
            modules = { ...(next.routerModules ?? {}) }
            render()
        },
        setFactory(next: Record<string, AgentModule>): void {
            factory = { ...next }
            render()
        },
        destroy(): void {
            root.replaceChildren()
        },
    }
}
