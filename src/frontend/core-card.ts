/**
 * Core & Branching (Phase 81, roadmap row 81): Multihog's first drawer of
 * *General & Visuals*, as the first card of *General & visuals* here — the
 * maintainer's ask of 2026-10-28, *I'd like the rest of it implemented*.
 *
 * Multihog's drawer, at the pin (`settings.html`): **Chat Links** (*Chat-Linked
 * Mode*, *Lock Control Room & Modules to each chat*, *Remove all chat links*,
 * *Clean up orphaned chat data*), **History Storage** (the migration of
 * histories out of `settings.json`), **Branching** (*Branch Campaign*), **Help**
 * (*CHAT*, the Adventure Companion; the *Anti-Museum Tour*, SillyTavern's API
 * checklist), the narrator card's name and *Create narrator card*, and **Main
 * Prompt Backup**. What of it is Lumiverse's:
 *
 * - Every chat is its own campaign here from its first pass — the memo, the
 *   histories, the portraits, the Player Card, the relationships, the name —
 *   so there is nothing to link, and the histories are files already. The
 *   two ticks and the migration have no counterpart; the hint says so.
 * - **Remove every chat's data** is *Remove all chat links*: every chat's
 *   files and every per-chat preference entry, after a confirm that counts
 *   them (`maintenance.chatData`, `maintenance.removeAllChats`). Multihog's
 *   leaves the live memo standing because SillyTavern keeps one outside the
 *   partitions; here the live chat is one of the chats, and its tracker
 *   reads empty after (departure 145).
 * - **Clean up orphaned chat data** moves here from *Debug & factory reset*
 *   (72a), where Multihog does not have it.
 * - **Branching**: the host gives an extension no way to make a chat, so
 *   there is no button; Lumiverse's own Branch on a message fires
 *   `CHAT_FORKED` and AdventureTime copies the campaign into the branch (56).
 *   The hint says where it is (departure 143).
 * - **Lumiverse checklist** is the Anti-Museum Tour in Lumiverse's terms:
 *   the four things SillyTavern's defaults got wrong, as what to check in a
 *   Lumiverse connection and preset, with AdventureTime's own evidence where
 *   it has any — the dice tool's standing from `status.get` — and *check in
 *   Lumiverse* where a preset's numbers are not readable without the
 *   `presets` grant (departure 144). Opened in the host's modal.
 * - The narrator card's rows (72b) move in under Help, as Multihog has them.
 * - The Main prompt backup is SillyTavern's prompt box; the rulebook is
 *   injected here and overwrites nothing.
 */

import type { CleanOrphansResult, OrphansResult, StatusResult } from '../protocol.js'
import type { DetailsModal } from './details-modal.js'

type El = (tag: string, attrs?: Record<string, string>) => HTMLElement

export interface CoreCardHost {
    el: El
    confirm(title: string, message: string, confirmLabel: string): Promise<boolean>
    request<T>(op: string, params?: Record<string, unknown>): Promise<T>
    /** The narrator card's rows (72b): the name as a preference, the card through the host. */
    narrator: { node: HTMLElement; applyPrefs(prefs: Record<string, unknown>): void }
    /** The host's modal, for the checklist; `null` on a host without one, and the checklist opens inline. */
    modal?(options: { title: string; nodes: HTMLElement[]; width?: number; onClose?: () => void }): DetailsModal | null
    /** The tracker reads its chat again: every chat's data went, the live one's with it. */
    onChatsRemoved(): void
    fail(error: unknown): void
}

export interface CoreCard {
    root: HTMLDetailsElement
    applyPrefs(prefs: Record<string, unknown>): void
    /** The status as the panel last read it: the checklist's evidence. */
    applyStatus(status: StatusResult): void
}

/** One item of the checklist: a title, why, and what AdventureTime can see of it. */
export interface ChecklistItem {
    id: 'tools' | 'passes' | 'output' | 'context' | 'narrator'
    title: string
    why: string
    /** `ok` seen right; `warn` not seen yet, or set a way that may be intended; `unknown` not readable here; `bad` seen wrong. */
    state: 'ok' | 'warn' | 'unknown' | 'bad'
    evidence: string
}

/** The words for why a blank row resolved as it did (89), for the evidence. */
const WHY_WORDS: Record<NonNullable<StatusResult['passes']>['why'], string> = {
    chat: 'the chat’s own connection',
    seen: 'the narrator’s connection, seen writing the last reply',
    default: 'Lumiverse’s default-ticked connection; no reply has been seen yet',
    first: 'the first connection Lumiverse lists, since none is ticked Set as default connection and no reply has been seen yet',
    none: 'nothing: Lumiverse lists no connection',
}

/** Multihog's four, in Lumiverse's terms, with what the status shows — and a fifth (89): the connection the passes run on. */
export function checklistItems(status: StatusResult | null): ChecklistItem[] {
    const dice = status?.dice
    const passes = status?.passes
    let runsOn: Pick<ChecklistItem, 'state' | 'evidence'>
    if (!passes) runsOn = { state: 'unknown', evidence: 'Not read yet: open the tracker once, then look again.' }
    else if (!passes.id) runsOn = { state: 'bad', evidence: 'Lumiverse lists no connection, so a pass has nothing to run on: make one under Lumiverse’s connections and tick Set as default connection on it.' }
    else {
        const named = `${passes.name || passes.id}${passes.provider ? ` (${passes.provider}${passes.model ? ` · ${passes.model}` : ''})` : ''}`
        runsOn = passes.why === 'first'
            ? { state: 'warn', evidence: `A blank row runs on ${named}: ${WHY_WORDS.first}. Tick Set as default connection on the one you mean, or pick it on the rows under Connections & models.` }
            : { state: 'ok', evidence: `A blank row runs on ${named}: ${WHY_WORDS[passes.why]}. Every connection row under Connections & models means this one when left blank.` }
    }
    let output: Pick<ChecklistItem, 'state' | 'evidence'>
    if (!passes) output = { state: 'unknown', evidence: 'Not read yet: open the tracker once, then look again.' }
    else if (passes.maxTokens > 0) output = { state: 'ok', evidence: `Output length for AdventureTime’s calls is ${passes.maxTokens.toLocaleString()} tokens, sent on every pass.` }
    else if (/anthropic|claude/i.test(passes.provider)) output = { state: 'warn', evidence: 'The field is blank, and on an Anthropic connection Lumiverse’s own fallback of 4,096 tokens applies to every pass — a long JSON reply can run past it. Set Output length for AdventureTime’s calls under Connections & models if a pass’s reply ends mid-object.' }
    else output = { state: 'unknown', evidence: `The field is blank, so each pass runs at the provider’s own default${passes.provider ? ` (${passes.provider})` : ''}, which is not readable here. Set Output length for AdventureTime’s calls under Connections & models if a pass’s reply ends mid-object.` }
    let tools: Pick<ChecklistItem, 'state' | 'evidence'>
    if (!dice) tools = { state: 'unknown', evidence: 'Not read yet: open the tracker once, then look again.' }
    else if (dice.registered.length) {
        const made = dice.turn?.length ?? 0
        tools = made
            ? { state: 'ok', evidence: `RollTheDice is registered and the narrator called it ${made === 1 ? 'once' : `${made} times`} in the last reply: the connection honours tools.` }
            : { state: 'warn', evidence: `RollTheDice is registered, and the last reply made no call. Unknown until a reply that should roll; if rolls appear in the prose with no call, Enable Function Calling is off on the connection.` }
    } else if (dice.absent === 'refused') tools = { state: 'bad', evidence: 'The host refused the dice tool: the tools permission, usually. The version line names it.' }
    else if (dice.absent === 'combat') tools = { state: 'warn', evidence: 'The queue has the dice for combat; the tool comes back after. Nothing to check now.' }
    else tools = { state: 'warn', evidence: 'The RNG mode asks for no tool (the queue is in use), so nothing here tests the connection. Fine if that is the mode you want; a connection that cannot call tools is what the queue is for.' }
    return [
        { id: 'tools', title: 'The narrator’s connection can call tools', why: 'The dice (RollTheDice) and the Map Architect (CreateAreaMap) are tools the narrator calls. A connection with function calling off never calls them: rolls get made up in the prose, and maps are never drawn — unless the RNG mode is the queue and the text opener is on, which is the path for a connection that cannot call tools.', ...tools },
        { id: 'passes', title: 'The passes have a connection to run on', why: 'A pass whose connection row is blank runs on the narrator’s connection: the chat’s own when the chat pins one, else the one seen writing the last reply, else Lumiverse’s default-ticked connection, else the first listed. Lumiverse itself gives a quiet call only the default-ticked one and refuses with none ticked, which is why a fresh install with an unticked connection ran no tracker and no agent before 1.0.0-beta.4.', ...runsOn },
        { id: 'output', title: 'The output length of AdventureTime’s own calls is enough', why: 'The agent, the architect, the updater and the evolution answer in JSON, and a low cap truncates it: the reply ends mid-object and the pass reports a parse error that reads like a bug. A preset’s numbers never reach these calls — Lumiverse applies a preset to a chat reply alone — so each pass runs at the provider’s own default unless Output length for AdventureTime’s calls under Connections & models is set, which is sent as max_tokens on every pass. Multihog’s 100,000 belongs to SillyTavern; some providers refuse a number above the model’s limit, so a smaller one suits here.', ...output },
        { id: 'context', title: 'The narrator’s context and output length leave room', why: 'Lumiverse takes the preset’s output length out of the chat’s room first — the context cap less Max Tokens is what the history fits in — then clips only the oldest chat history, and AdventureTime’s messages are added after. So the narrator’s Max Tokens is a reply plus any reasoning, not Multihog’s 100,000, and the context cap sits below the model’s maximum by AdventureTime’s share: read it off the Prompt Breakdown’s “AdventureTime —” rows (the rulebook alone is about 6,700 tokens). The summariser keeps the chat itself small.', state: 'unknown', evidence: 'Not readable here: a preset’s numbers need the presets permission, which AdventureTime does not ask for. Check the preset in Lumiverse’s connection settings.' },
        { id: 'narrator', title: 'The chat runs from a narrator card', why: 'Multihog is book-style play told by a narrator, not a one-on-one character chat: the rulebook is the whole prompt, so the card needs nothing in it. Make one with the rows under this list and open a chat from it.', state: 'unknown', evidence: 'Whether the open chat’s card is the narrator is not read here; the rows below make the card.' },
    ]
}

const STATE_MARK: Record<ChecklistItem['state'], string> = { ok: '✅', warn: '⚠️', unknown: '❔', bad: '❌' }

export const CORE_CARD_CSS = `
.adventuretime-panel .lh-core-caption { font-size: 0.72em; font-weight: 700; opacity: 0.65; text-transform: uppercase; letter-spacing: 0.4px; margin-top: 6px; }
.adventuretime-panel .lh-core-hint { font-size: 0.85em; opacity: 0.65; line-height: 1.4; }
.adventuretime-panel .lh-core-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.adventuretime-panel .lh-core-note { font-size: 0.9em; opacity: 0.85; line-height: 1.4; overflow-wrap: anywhere; }
.adventuretime-panel .lh-core-note:empty { display: none; }
.adventuretime-panel .lh-core-note--problem { color: var(--lumiverse-danger, #d9534f); opacity: 1; }
.adventuretime-panel .lh-checklist { display: flex; flex-direction: column; gap: 10px; font-size: 0.9em; }
.adventuretime-panel .lh-checklist[hidden] { display: none; }
.adventuretime-panel .lh-checklist-lead { opacity: 0.8; line-height: 1.45; }
.adventuretime-panel .lh-checklist-item { display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25))); border-radius: 6px; padding: 8px 10px; }
.adventuretime-panel .lh-checklist-mark { font-size: 1.1em; }
.adventuretime-panel .lh-checklist-title { font-weight: 600; }
.adventuretime-panel .lh-checklist-why { grid-column: 2; opacity: 0.7; line-height: 1.4; }
.adventuretime-panel .lh-checklist-evidence { grid-column: 2; line-height: 1.4; }
.adventuretime-panel .lh-checklist-item--ok .lh-checklist-evidence { color: var(--lumiverse-success, #34a853); }
.adventuretime-panel .lh-checklist-item--bad .lh-checklist-evidence { color: var(--lumiverse-danger, #d9534f); }
.adventuretime-panel .lh-checklist-status { font-size: 0.9em; opacity: 0.8; }
`

export function createCoreCard(host: CoreCardHost): CoreCard {
    const { el } = host
    const root = el('details', { class: 'lh-card lh-second-card lh-search-item', 'data-lh-card': 'core-branching' }) as HTMLDetailsElement
    const summary = el('summary')
    const icon = el('span', { class: 'lh-card-icon', 'aria-hidden': 'true' })
    icon.textContent = '🎛️'
    const title = el('span', { class: 'lh-card-title' })
    title.textContent = 'Core & Branching'
    summary.append(icon, title, el('span', { class: 'lh-chevron', 'aria-hidden': 'true' }))
    const body = el('div', { class: 'lh-second-body' })
    root.append(summary, body)

    let busy = false
    let status: StatusResult | null = null

    const caption = (text: string): HTMLElement => { const c = el('div', { class: 'lh-core-caption' }); c.textContent = text; return c }
    const hint = (text: string, field?: string): HTMLElement => { const h = el('div', { class: 'lh-core-hint', ...(field ? { 'data-lh-field': field } : {}) }); h.textContent = text; return h }
    const tell = (note: HTMLElement, text: string, problem = false): void => { note.textContent = text; note.classList.toggle('lh-core-note--problem', problem) }
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
    const action = (field: string, label: string, danger: boolean, title: string): { row: HTMLElement; button: HTMLButtonElement; note: HTMLElement } => {
        const row = el('div', { class: 'lh-second-row lh-search-item', 'data-lh-field': field })
        const actions = el('div', { class: 'lh-core-actions' })
        const button = el('button', { type: 'button', class: `lh-button${danger ? ' lh-button--danger' : ''}`, title }) as HTMLButtonElement
        button.textContent = label
        actions.append(button)
        const note = el('div', { class: 'lh-core-note' })
        row.append(actions, note)
        return { row, button, note }
    }

    // ── Chat links ───────────────────────────────────────────────────────
    const removeAll = action('remove-all-chats', 'Remove every chat’s data', true, 'Every chat’s memo, histories, portraits, Player Card and relationships, and every per-chat preference entry; the chats themselves, the lorebooks and the cartridge stay.')
    removeAll.button.addEventListener('click', () => {
        run(removeAll.note, async () => {
            const found = await host.request<OrphansResult>('maintenance.chatData')
            if (!found.chatIds.length && !found.prefsEntries) return 'No chat has any AdventureTime data yet.'
            const ok = await host.confirm('Remove every chat’s data',
                `Remove the AdventureTime data of all ${found.chatIds.length} chats — the memos, the histories, the portraits, the Player Cards, the relationships — and ${found.prefsEntries} preference entries that name them (the campaign names, the books owned, the pass watermarks)? The chats themselves, the lorebooks and the cartridge stay. The open chat’s tracker reads empty after. This cannot be undone.`,
                'Remove everything')
            if (!ok) return 'Nothing was removed.'
            const result = await host.request<CleanOrphansResult>('maintenance.removeAllChats')
            host.onChatsRemoved()
            return `Removed the data of ${result.removed.length} chats (${result.files} files) and ${result.prefsEntries} preference entries. The lorebooks and the cartridge stand; a chat’s campaign name is minted again when it is next shown.`
        }).catch(() => undefined)
    })
    const orphans = action('clean-orphans', 'Clean up orphaned chat data', false, 'The data AdventureTime kept for chats Lumiverse no longer has, and their entries in the preferences. A chat Lumiverse still has is never touched.')
    orphans.button.addEventListener('click', () => {
        run(orphans.note, async () => {
            const found = await host.request<OrphansResult>('maintenance.orphans')
            if (!found.chatIds.length && !found.prefsEntries) return 'Nothing is orphaned: every chat AdventureTime has state for still exists.'
            const ok = await host.confirm('Clean up orphaned chat data',
                `Remove the state of ${found.chatIds.length} chats Lumiverse no longer has${found.prefsEntries ? `, and ${found.prefsEntries} preference entries that name them` : ''}? This cannot be undone.`,
                'Clean up')
            if (!ok) return 'Not cleaned up.'
            const result = await host.request<CleanOrphansResult>('maintenance.cleanOrphans')
            return `Removed the state of ${result.removed.length} chats (${result.files} files) and ${result.prefsEntries} preference entries.`
        }).catch(() => undefined)
    })

    // ── Branching ────────────────────────────────────────────────────────
    const branching = hint('Lumiverse branches a chat from any of its messages (Branch, on the message). AdventureTime copies the campaign into the branch as it is made — the name, the books, the memo as it stood at that message, the portraits, the Player Card, the relationships — so a branch plays on from where it was taken. Clone the books on their own is under the Lorebook Agent’s tools. There is no button here: the host gives an extension no way to make a chat.', 'core-branching-hint')

    // ── Help: the checklist, then the narrator card ──────────────────────
    const checklist = action('lumiverse-checklist', 'Lumiverse checklist', false, 'The five things to check on a connection and its preset before a campaign — Multihog’s Anti-Museum Tour, in Lumiverse’s terms, and the connection the passes run on — with what AdventureTime can see of them.')
    const checklistBox = el('div', { class: 'lh-checklist', 'data-lh-field': 'lumiverse-checklist-box', hidden: 'hidden' })
    let open: DetailsModal | null = null
    function drawChecklist(): void {
        checklistBox.replaceChildren()
        const lead = el('div', { class: 'lh-checklist-lead' })
        lead.textContent = 'Multihog’s Anti-Museum Tour: most of what read as bugs was the host’s defaults. Lumiverse has no API kind to switch and its numbers live on each connection’s preset, so this list says what to check there, and shows what AdventureTime can see for itself.'
        checklistBox.append(lead)
        const items = checklistItems(status)
        for (const item of items) {
            const node = el('div', { class: `lh-checklist-item lh-checklist-item--${item.state}`, 'data-lh-field': `checklist-${item.id}` })
            const mark = el('span', { class: 'lh-checklist-mark', 'aria-hidden': 'true' })
            mark.textContent = STATE_MARK[item.state]
            const t = el('span', { class: 'lh-checklist-title' })
            t.textContent = item.title
            const why = el('div', { class: 'lh-checklist-why' })
            why.textContent = item.why
            const evidence = el('div', { class: 'lh-checklist-evidence' })
            evidence.textContent = item.evidence
            node.append(mark, t, why, evidence)
            checklistBox.append(node)
        }
        const seen = items.filter((i) => i.state === 'ok').length
        const statusLine = el('div', { class: 'lh-checklist-status', 'data-lh-field': 'checklist-status' })
        statusLine.textContent = `${seen} of ${items.length} seen right here; the rest are Lumiverse’s connection settings to look at.`
        checklistBox.append(statusLine)
    }
    // Drawn from the first paint and on every status (81-bis), so the box is right wherever it shows: the
    // modal, or inline under the button on a host without one. Its `hidden` is held by a rule of its own,
    // since the box's display: flex would beat the attribute (lesson 60) — which is how 0.160.0 showed the
    // list under the button, drawn only once the button had been pressed.
    drawChecklist()
    checklist.button.addEventListener('click', () => {
        drawChecklist()
        if (host.modal) {
            if (open?.open) { open.close(); open = null; return }
            checklistBox.hidden = false
            open = host.modal({ title: 'Lumiverse checklist', nodes: [checklistBox], width: 640, onClose: () => { checklistBox.hidden = true; open = null } })
            if (open) return
        }
        // No modal: the list unfolds under the button.
        checklistBox.hidden = !checklistBox.hidden
    })

    body.append(
        caption('Chat links'),
        hint('Every chat keeps its own campaign here from its first pass — the memo, the histories, the portraits, the Player Card, the relationships, the campaign’s name — so there is nothing to link or to lock to a chat, and the histories are files of their own already.', 'core-links-hint'),
        removeAll.row, orphans.row,
        caption('Branching'), branching,
        caption('Help'), checklist.row, checklistBox,
        caption('Narrator card'), host.narrator.node,
    )

    return {
        root,
        applyPrefs(prefs) { host.narrator.applyPrefs(prefs) },
        applyStatus(next) {
            status = next
            drawChecklist()
        },
    }
}
