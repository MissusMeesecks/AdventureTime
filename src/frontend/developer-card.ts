/**
 * Multihog's *Debug & Factory Reset* drawer (Phase 72a), the last card of
 * *General & visuals* as it is the last of the legacy's tab, under the
 * caption *Developer & reset*.
 *
 * Two switches and the destructive actions: **Debug logging** (every model
 * call's prompt and reply in the Server Logs); **Refresh stock texts after
 * updates**, with *Update changed prompts* beside it when an update changed
 * texts the switch did not refresh; **Reset all prompts to stock**; **Purge
 * all portraits**; **Factory reset**, in red; and, under *Chat data*,
 * **Clean up data of deleted chats** and **Remove all chat data** (96: the
 * two were in Core & Branching from 81; the settings cleanup puts every
 * destructive action on this one card). Every button asks first, in words
 * that say what goes and what stays, and says in a note what it did. The
 * legacy's *Force Disk Checkpoint* has no counterpart: every write here
 * lands when it is made.
 *
 * Help is behind a `[?]` (96); a warning stays in the open beside its button.
 *
 * The switches are preferences, so a change made elsewhere reaches them
 * through `applyPrefs`; the pending list comes with the status line's
 * read through `applyStatus`.
 */

import { setCardIcon } from './icons.js'
import type { CleanOrphansResult, OrphansResult, PurgePortraitsResult, SettingsResult, StatusResult } from '../protocol.js'
import { createHelpTip } from './help-tip.js'

export interface DeveloperCardHost {
    el(tag: string, attrs?: Record<string, string>): HTMLElement
    /** Ask before an irreversible step; true to go ahead. */
    confirm(title: string, message: string, confirmLabel: string): Promise<boolean>
    request<T>(op: string, params?: Record<string, unknown>): Promise<T>
    savePrefs(patch: Record<string, unknown>): Promise<void>
    /** The settings whole, after a reset, for every editor to follow. */
    onSettings(settings: Record<string, unknown>): void
    /** The tracker reads its chat again: every chat's data went, the live one's with it. */
    onChatsRemoved(): void
    fail(error: unknown): void
}

export interface DeveloperCard {
    root: HTMLDetailsElement
    applyPrefs(prefs: Record<string, unknown>): void
    applyStatus(status: StatusResult): void
}

/** The `[?]` on the *Chat data* sub-heading (96). */
export const CHAT_DATA_HELP = 'Each chat keeps its own campaign data: the memo, the histories, the portraits, the Player Card, the relationships and the campaign name.\n\nDifferent from Multihog: there is no chat-linked mode, no module lock and no history migration. Every chat is always its own campaign.'

export const DEVELOPER_CARD_CSS = `
.adventuretime-panel .lh-developer-caption { font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.6; margin: 10px 0 4px; }
.adventuretime-panel .lh-developer-body { display: flex; flex-direction: column; gap: 8px; padding: 8px 10px 10px; font-size: 0.8em; }
.adventuretime-panel .lh-developer-row { display: flex; flex-direction: column; gap: 4px; }
.adventuretime-panel .lh-developer-switch-line { display: flex; align-items: center; gap: 4px; }
.adventuretime-panel .lh-developer-switch { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; min-width: 0; }
.adventuretime-panel .lh-developer-switch input { flex: 0 0 auto; margin: 2px 0 0; }
.adventuretime-panel .lh-developer-subhead { display: flex; align-items: center; gap: 4px; font-size: 0.8em; font-weight: 700; opacity: 0.75; text-transform: uppercase; letter-spacing: 0.4px; margin-top: 6px; }
.adventuretime-panel .lh-developer-warning { font-size: 0.92em; opacity: 0.8; line-height: 1.4; }
.adventuretime-panel .lh-developer-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.adventuretime-panel .lh-developer-note { font-size: 0.92em; opacity: 0.85; line-height: 1.4; }
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
    setCardIcon(icon, 'Debug & factory reset', '🛠️')
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

    function switchRow(field: string, label: string, help: string, onChange: (on: boolean) => void): HTMLInputElement {
        const node = row()
        node.setAttribute('data-lh-field', field)
        // The [?] sits beside the label, never inside it: a press there would tick the box.
        const line = el('div', { class: 'lh-developer-switch-line' })
        const wrap = el('label', { class: 'lh-developer-switch' })
        const input = el('input', { type: 'checkbox' }) as HTMLInputElement
        const name = el('span')
        name.textContent = label
        wrap.append(input, name)
        const tip = createHelpTip(el, label, help)
        line.append(wrap, tip.button)
        node.append(line, tip.note)
        input.addEventListener('change', () => { onChange(input.checked) })
        return input
    }

    /** A button, its `[?]` when it has help, a warning that stays in the open when it has one, and the note for what it did. */
    function actionRow(field: string, label: string, text: { warning?: string; help?: string }, danger = false): { button: HTMLButtonElement; note: HTMLElement; node: HTMLElement } {
        const node = row()
        node.setAttribute('data-lh-field', field)
        const actions = el('div', { class: 'lh-developer-actions' })
        const button = el('button', { type: 'button', class: `lh-button${danger ? ' lh-button--danger' : ''}` }) as HTMLButtonElement
        button.textContent = label
        actions.append(button)
        node.append(actions)
        if (text.warning) {
            const warning = el('div', { class: 'lh-developer-warning' })
            warning.textContent = text.warning
            node.append(warning)
        }
        if (text.help) {
            const tip = createHelpTip(el, label, text.help)
            actions.append(tip.button)
            node.append(tip.note)
        }
        const note = el('div', { class: 'lh-developer-note' })
        node.append(note)
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
        'When on, every model call AdventureTime makes is written to Lumiverse’s Server Logs with its full prompt and reply. Default: off. The Server Logs keep 150 lines by default. Raise the buffer before you turn this on.',
        (on) => { host.savePrefs({ debugLogging: on }).catch((error) => { debug.checked = !on; host.fail(error) }) })

    const auto = switchRow('auto-update-prompts', 'Refresh stock texts after updates',
        'When on, an update that changes a stock prompt or module text replaces your copy if you never edited it. Texts you edited are kept and named in the Server Logs. When off, changed texts wait until you press "Update changed prompts". Default: on.',
        (on) => { host.savePrefs({ autoUpdatePrompts: on }).catch((error) => { auto.checked = !on; host.fail(error) }) })

    const upgrade = actionRow('upgrade-stock', 'Update changed prompts', { help: 'Puts in the stock texts that an update changed. Texts you edited are kept.' })
    upgrade.node.hidden = true
    upgrade.button.addEventListener('click', () => {
        run(upgrade.note, async () => {
            const result = await host.request<SettingsResult & { refreshed: string[]; kept: string[] }>('settings.upgradeStock')
            host.onSettings(result.settings)
            upgrade.node.hidden = !result.refreshed.length && !result.kept.length
            const refreshed = result.refreshed.length ? `Refreshed ${result.refreshed.length} texts: ${describeKeys(result.refreshed)}.` : 'Nothing to refresh.'
            const kept = result.kept.length ? ` Kept ${result.kept.length} edited texts: ${describeKeys(result.kept)}.` : ''
            return refreshed + kept
        }).catch(() => undefined)
    })

    // ── the resets ────────────────────────────────────────────────────────

    const prompts = actionRow('reset-prompts', 'Reset all prompts to stock', {
        warning: 'Resets every prompt, every tracker and agent module text and the card order to stock. Your edits to them are lost.',
        help: 'Your own world-rule sections, custom fields and game systems are kept. The reset takes effect on the next reply.',
    })
    prompts.button.addEventListener('click', () => {
        run(prompts.note, async () => {
            const ok = await host.confirm('Reset all prompts to stock',
                'Reset every prompt and module text to stock? Your edits to them are lost. Your own world-rule sections, custom fields and game systems are kept.',
                'Reset prompts')
            if (!ok) return 'Not reset.'
            const result = await host.request<SettingsResult>('maintenance.resetPrompts')
            host.onSettings(result.settings)
            return 'Every prompt and module text is stock again.'
        }).catch(() => undefined)
    })

    const portraits = actionRow('purge-portraits', 'Purge all portraits', {
        warning: 'Clears the portraits of every chat. The picture files stay in Lumiverse, and the NPC library keeps its photos.',
    })
    portraits.button.addEventListener('click', () => {
        run(portraits.note, async () => {
            const ok = await host.confirm('Purge all portraits',
                'Clear the portraits of every chat? The cards and the scene show none until you set or draw new ones. The picture files stay in Lumiverse, and the NPC library keeps its photos.',
                'Purge portraits')
            if (!ok) return 'Not purged.'
            const result = await host.request<PurgePortraitsResult>('maintenance.purgePortraits')
            return result.portraits ? `Cleared ${result.portraits} portraits across ${result.chats} chats.` : 'No chat had a portrait to clear.'
        }).catch(() => undefined)
    })

    // ── chat data (96: from Core & Branching, beside the other destructive actions) ──

    const chatData = el('div', { class: 'lh-developer-subhead', 'data-lh-field': 'chat-data-heading' })
    const chatDataText = el('span')
    chatDataText.textContent = 'Chat data'
    const chatDataTip = createHelpTip(el, 'Chat data', CHAT_DATA_HELP)
    chatData.append(chatDataText, chatDataTip.button)
    body.append(chatData, chatDataTip.note)

    const orphans = actionRow('clean-orphans', 'Clean up data of deleted chats', {
        help: 'Deletes the data AdventureTime kept for chats that no longer exist in Lumiverse. Chats that still exist are not touched. This cannot be undone.',
    })
    orphans.button.addEventListener('click', () => {
        run(orphans.note, async () => {
            const found = await host.request<OrphansResult>('maintenance.orphans')
            if (!found.chatIds.length && !found.prefsEntries) return 'Nothing to clean up. Every chat with AdventureTime data still exists.'
            const ok = await host.confirm('Clean up data of deleted chats',
                `Remove the data of ${found.chatIds.length} chats that no longer exist in Lumiverse${found.prefsEntries ? `, and ${found.prefsEntries} per-chat settings` : ''}? This cannot be undone.`,
                'Clean up')
            if (!ok) return 'Nothing was removed.'
            const result = await host.request<CleanOrphansResult>('maintenance.cleanOrphans')
            return `Removed the data of ${result.removed.length} chats (${result.files} files) and ${result.prefsEntries} per-chat settings.`
        }).catch(() => undefined)
    })

    const removeAll = actionRow('remove-all-chats', 'Remove all chat data', {
        warning: 'Deletes AdventureTime’s data for every chat. Your chats and lorebooks are kept. This cannot be undone.',
    }, true)
    removeAll.button.addEventListener('click', () => {
        run(removeAll.note, async () => {
            const found = await host.request<OrphansResult>('maintenance.chatData')
            if (!found.chatIds.length && !found.prefsEntries) return 'No chat has any AdventureTime data yet.'
            const ok = await host.confirm('Remove all chat data',
                `Remove AdventureTime’s data for all ${found.chatIds.length} chats? This deletes every memo, history, portrait, Player Card and relationship, and ${found.prefsEntries} per-chat settings. The chats, the lorebooks and the cartridge stay. This cannot be undone.`,
                'Remove all')
            if (!ok) return 'Nothing was removed.'
            const result = await host.request<CleanOrphansResult>('maintenance.removeAllChats')
            host.onChatsRemoved()
            return `Removed the data of ${result.removed.length} chats (${result.files} files) and ${result.prefsEntries} per-chat settings. The lorebooks and the cartridge are kept. Each chat gets a new campaign name when it is next opened.`
        }).catch(() => undefined)
    })

    // ── the factory reset, last ───────────────────────────────────────────

    const factory = actionRow('factory-reset', 'Factory reset', {
        warning: 'Resets the whole cartridge and every preference of this install to defaults. This cannot be undone.',
        help: 'Chats keep their tracker state, histories, portraits, Player Cards, relationships, campaign names and lorebooks. The NPC library is kept. Export a cartridge first to keep your prompts and game systems.',
    }, true)
    factory.button.addEventListener('click', () => {
        run(factory.note, async () => {
            const ok = await host.confirm('Factory reset',
                'Reset AdventureTime to factory defaults? Every cartridge setting and every preference of this install is reset, including your prompts, world-rule sections, custom fields, game systems, layout and connections. Chats keep their state and lorebooks, and the NPC library is kept. This cannot be undone. Export a cartridge first to keep your prompts and game systems.',
                'Reset to factory')
            if (!ok) return 'Not reset.'
            const result = await host.request<SettingsResult & { prefs: Record<string, unknown> }>('maintenance.factoryReset')
            host.onSettings(result.settings)
            return 'Reset to factory defaults. Reload the page to move the widgets back to their default places.'
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
                tell(upgrade.note, `An update changed ${pending} stock texts that were not refreshed: ${describeKeys(report.pending)}.`)
            } else if (report.refreshed.length || report.kept.length) {
                const refreshed = report.refreshed.length ? `Refreshed ${report.refreshed.length} texts after the last update: ${describeKeys(report.refreshed)}.` : ''
                const kept = report.kept.length ? ` Kept ${report.kept.length} edited texts: ${describeKeys(report.kept)}.` : ''
                tell(upgrade.note, (refreshed + kept).trim())
            }
        },
    }
}
