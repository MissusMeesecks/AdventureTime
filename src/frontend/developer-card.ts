/**
 * Multihog's *Debug & Factory Reset* drawer (Phase 72a), the last card of
 * *General & visuals* as it is the last of the legacy's tab, under the
 * caption *Developer & reset*.
 *
 * Two switches and five buttons, in the legacy's order: **Debug logging**
 * (every model call's prompt and reply in the Server Logs); **Refresh the
 * stock texts after an update**, with *Update changed prompts* beside it
 * when an update changed texts the switch did not refresh; **Reset every
 * prompt to stock**; **Purge all portraits**; and **Factory reset**, in
 * red (*Clean up orphaned chat data* moved to Core & Branching in 81, where
 * Multihog keeps it). Every button asks first, in words
 * that say what goes and what stays, and says in a note what it did. The
 * legacy's *Force Disk Checkpoint* has no counterpart: every write here
 * lands when it is made.
 *
 * The switches are preferences, so a change made elsewhere reaches them
 * through `applyPrefs`; the pending list comes with the status line's
 * read through `applyStatus`.
 */

import type { PurgePortraitsResult, SettingsResult, StatusResult } from '../protocol.js'

export interface DeveloperCardHost {
    el(tag: string, attrs?: Record<string, string>): HTMLElement
    /** Ask before an irreversible step; true to go ahead. */
    confirm(title: string, message: string, confirmLabel: string): Promise<boolean>
    request<T>(op: string, params?: Record<string, unknown>): Promise<T>
    savePrefs(patch: Record<string, unknown>): Promise<void>
    /** The settings whole, after a reset, for every editor to follow. */
    onSettings(settings: Record<string, unknown>): void
    fail(error: unknown): void
}

export interface DeveloperCard {
    root: HTMLDetailsElement
    applyPrefs(prefs: Record<string, unknown>): void
    applyStatus(status: StatusResult): void
}

export const DEVELOPER_CARD_CSS = `
.adventuretime-panel .lh-developer-caption { font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.6; margin: 10px 0 4px; }
.adventuretime-panel .lh-developer-body { display: flex; flex-direction: column; gap: 8px; padding: 8px 10px 10px; font-size: 0.85em; }
.adventuretime-panel .lh-developer-row { display: flex; flex-direction: column; gap: 4px; }
.adventuretime-panel .lh-developer-switch { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; }
.adventuretime-panel .lh-developer-switch input { flex: 0 0 auto; margin: 2px 0 0; }
.adventuretime-panel .lh-developer-hint { font-size: 0.9em; opacity: 0.7; line-height: 1.4; }
.adventuretime-panel .lh-developer-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.adventuretime-panel .lh-developer-note { font-size: 0.9em; opacity: 0.85; line-height: 1.4; }
.adventuretime-panel .lh-developer-note:empty { display: none; }
.adventuretime-panel .lh-developer-note--problem { color: var(--lumiverse-danger, #d9534f); }
.adventuretime-panel .lh-button--danger { border-color: var(--lumiverse-danger, #d9534f); color: var(--lumiverse-danger, #d9534f); }
.adventuretime-panel .lh-developer [hidden] { display: none; }
`

/** The names of a stock-text list, short enough for a note. */
export function describeKeys(keys: readonly string[], limit = 6): string {
    if (!keys.length) return ''
    const shown = keys.slice(0, limit).join(', ')
    return keys.length > limit ? `${shown} and ${keys.length - limit} more` : shown
}

export function createDeveloperCard(host: DeveloperCardHost): DeveloperCard {
    const el = host.el
    const root = el('details', { class: 'lh-card lh-developer', 'data-lh-field': 'developer-card' }) as HTMLDetailsElement
    const summary = el('summary')
    const icon = el('span', { class: 'lh-card-icon', 'aria-hidden': 'true' })
    icon.textContent = '🛠️'
    const title = el('span', { class: 'lh-card-title' })
    title.textContent = 'Debug & factory reset'
    summary.append(icon, title, el('span', { class: 'lh-chevron', 'aria-hidden': 'true' }))
    const body = el('div', { class: 'lh-developer-body' })
    root.append(summary, body)

    let busy = false

    function row(): HTMLElement {
        const node = el('div', { class: 'lh-developer-row lh-search-item' })
        body.append(node)
        return node
    }

    function switchRow(field: string, label: string, hint: string, onChange: (on: boolean) => void): HTMLInputElement {
        const node = row()
        node.setAttribute('data-lh-field', field)
        const wrap = el('label', { class: 'lh-developer-switch' })
        const input = el('input', { type: 'checkbox' }) as HTMLInputElement
        const text = el('span')
        const name = el('span')
        name.textContent = label
        const note = el('div', { class: 'lh-developer-hint' })
        note.textContent = hint
        text.append(name, note)
        wrap.append(input, text)
        node.append(wrap)
        input.addEventListener('change', () => { onChange(input.checked) })
        return input
    }

    function actionRow(field: string, label: string, hint: string, danger = false): { button: HTMLButtonElement; note: HTMLElement; node: HTMLElement } {
        const node = row()
        node.setAttribute('data-lh-field', field)
        const actions = el('div', { class: 'lh-developer-actions' })
        const button = el('button', { type: 'button', class: `lh-button${danger ? ' lh-button--danger' : ''}` }) as HTMLButtonElement
        button.textContent = label
        actions.append(button)
        const hintNode = el('div', { class: 'lh-developer-hint' })
        hintNode.textContent = hint
        const note = el('div', { class: 'lh-developer-note' })
        node.append(actions, hintNode, note)
        return { button, note, node }
    }

    function tell(note: HTMLElement, text: string, problem = false): void {
        note.textContent = text
        note.classList.toggle('lh-developer-note--problem', problem)
    }

    async function run(note: HTMLElement, work: () => Promise<string>): Promise<void> {
        if (busy) return
        busy = true
        try {
            tell(note, await work())
        } catch (error) {
            tell(note, error instanceof Error ? error.message : String(error), true)
            host.fail(error)
        } finally {
            busy = false
        }
    }

    // ── the switches ──────────────────────────────────────────────────────

    const debug = switchRow('debug-logging', 'Debug logging',
        'Every model call AdventureTime makes — the tracker, the agent, the world, the maps, the creator, the portraits — goes to the Server Logs with its full prompt and reply, one line per message. Off, as in Multihog. The Server Logs keep 150 lines by default; raise the buffer first.',
        (on) => { host.savePrefs({ debugLogging: on }).catch((error) => { debug.checked = !on; host.fail(error) }) })

    const auto = switchRow('auto-update-prompts', 'Refresh the stock texts after an update',
        'When an update changes a stock prompt or module text you never edited, the new text is put in; a text you edited is kept and named in the Server Logs. Off, a changed text waits for the button below.',
        (on) => { host.savePrefs({ autoUpdatePrompts: on }).catch((error) => { auto.checked = !on; host.fail(error) }) })

    const upgrade = actionRow('upgrade-stock', 'Update changed prompts', 'The stock texts an update changed, put in now; your edited texts are kept.')
    upgrade.node.hidden = true
    upgrade.button.addEventListener('click', () => {
        run(upgrade.note, async () => {
            const result = await host.request<SettingsResult & { refreshed: string[]; kept: string[] }>('settings.upgradeStock')
            host.onSettings(result.settings)
            upgrade.node.hidden = !result.refreshed.length && !result.kept.length
            const refreshed = result.refreshed.length ? `Refreshed ${result.refreshed.length}: ${describeKeys(result.refreshed)}.` : 'Nothing was waiting to be refreshed.'
            const kept = result.kept.length ? ` Kept ${result.kept.length} edited: ${describeKeys(result.kept)}.` : ''
            return refreshed + kept
        }).catch(() => undefined)
    })

    // ── the resets ────────────────────────────────────────────────────────

    const prompts = actionRow('reset-prompts', 'Reset every prompt to stock',
        'Every prompt of the cartridge, the tracker’s modules and their stock texts, the cards’ order and the agent’s modules back to Multihog’s. Your own sections, custom fields and game systems stay. Nothing to apply after: the rulebook is read on the next reply.')
    prompts.button.addEventListener('click', () => {
        run(prompts.note, async () => {
            const ok = await host.confirm('Reset every prompt to stock',
                'Put every prompt and module text back to Multihog’s stock text? Your edits to them are lost. Your own world-rule sections, custom fields and game systems are kept.',
                'Reset the prompts')
            if (!ok) return 'Not reset.'
            const result = await host.request<SettingsResult>('maintenance.resetPrompts')
            host.onSettings(result.settings)
            return 'Every prompt and module text is Multihog’s stock text again.'
        }).catch(() => undefined)
    })

    const portraits = actionRow('purge-portraits', 'Purge all portraits',
        'Every chat’s portrait references cleared — the cards and the scene show none until new ones are set or drawn. The pictures stay in Lumiverse’s image store, since a reference may be a character card’s own picture; the NPC library’s photos stay too.')
    portraits.button.addEventListener('click', () => {
        run(portraits.note, async () => {
            const ok = await host.confirm('Purge all portraits',
                'Clear the portraits of every chat? The cards and the scene will show none until new ones are set or drawn. The pictures themselves stay in Lumiverse, and the NPC library keeps its photos.',
                'Purge the portraits')
            if (!ok) return 'Not purged.'
            const result = await host.request<PurgePortraitsResult>('maintenance.purgePortraits')
            return result.portraits ? `Cleared ${result.portraits} portrait references across ${result.chats} chats.` : 'No chat had a portrait to clear.'
        }).catch(() => undefined)
    })

    const factory = actionRow('factory-reset', 'Factory reset',
        'The whole cartridge to Multihog’s factory, and this install’s preferences — the layout, the widgets’ places and sizes, the connections, every dial — to their defaults. The chats keep their memos, histories, portraits, Player Cards, relationships, campaign names and lorebooks. The NPC library stays.',
        true)
    factory.button.addEventListener('click', () => {
        run(factory.note, async () => {
            const ok = await host.confirm('Factory reset',
                'Reset AdventureTime to the factory? Every setting of the cartridge and every preference of this install goes back to its default: the prompts, the modules, the rulebook, your own world-rule sections, the custom fields, the game systems, the layout, the widgets, the connections and the dials. The chats keep their state and their campaigns’ books, and the NPC library stays. This cannot be undone; export a cartridge first if you want to keep your setup.',
                'Reset to factory')
            if (!ok) return 'Not reset.'
            const result = await host.request<SettingsResult & { prefs: Record<string, unknown> }>('maintenance.factoryReset')
            host.onSettings(result.settings)
            return 'Reset to the factory. Reload the page to redraw the widgets where a fresh install puts them.'
        }).catch(() => undefined)
    })

    return {
        root,
        applyPrefs(prefs) {
            if (prefs.debugLogging !== undefined) debug.checked = prefs.debugLogging === true
            if (prefs.autoUpdatePrompts !== undefined) auto.checked = prefs.autoUpdatePrompts !== false
        },
        applyStatus(status) {
            const report = status.stockUpgrade
            if (!report) return
            const pending = report.pending.length
            upgrade.node.hidden = !pending && !report.refreshed.length && !report.kept.length
            if (pending) {
                tell(upgrade.note, `An update changed ${pending} stock texts the refresh did not put in: ${describeKeys(report.pending)}.`)
            } else if (report.refreshed.length || report.kept.length) {
                const refreshed = report.refreshed.length ? `Refreshed ${report.refreshed.length} after the last update: ${describeKeys(report.refreshed)}.` : ''
                const kept = report.kept.length ? ` Kept ${report.kept.length} you edited where the factory’s changed: ${describeKeys(report.kept)}.` : ''
                tell(upgrade.note, (refreshed + kept).trim())
            }
        },
    }
}
