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
 *
 * Since the settings cleanup (96) the card is **Setup & help**: the two data
 * buttons are in *Debug & factory reset* beside the other destructive actions,
 * the Branching caption is the card's own `[?]`, and every item of the
 * checklist keeps its help behind a `[?]` after its label. The card keeps its
 * `data-lh-card` name.
 */

import { setCardIcon } from './icons.js'
import type { StatusResult } from '../protocol.js'
import type { DetailsModal } from './details-modal.js'
import { attachCardHelp, createHelpTip } from './help-tip.js'

type El = (tag: string, attrs?: Record<string, string>) => HTMLElement

export interface CoreCardHost {
    el: El
    /** The narrator card's rows (72b): the name as a preference, the card through the host. */
    narrator: { node: HTMLElement; applyPrefs(prefs: Record<string, unknown>): void }
    /** The host's modal, for the checklist; `null` on a host without one, and the checklist opens inline. */
    modal?(options: { title: string; nodes: HTMLElement[]; width?: number; onClose?: () => void }): DetailsModal | null
}

export interface CoreCard {
    root: HTMLDetailsElement
    applyPrefs(prefs: Record<string, unknown>): void
    /** The status as the panel last read it: the checklist's evidence. */
    applyStatus(status: StatusResult): void
}

/** One item of the checklist: a title, why (behind the item's `[?]`), and what AdventureTime can see of it. */
export interface ChecklistItem {
    id: 'tools' | 'passes' | 'output' | 'context' | 'narrator' | 'summariser'
    title: string
    why: string
    /** `ok` seen right; `warn` not seen yet, or set a way that may be intended; `unknown` not readable here; `bad` seen wrong. */
    state: 'ok' | 'warn' | 'unknown' | 'bad'
    evidence: string
    /** A link drawn after the evidence: the summariser's own page. */
    link?: { label: string; url: string }
}

/** The Lumiverse port of Summaryception (84): the one address, here and in the starting area's Learn more. */
export const SUMMARYCEPTION_URL = 'https://github.com/Ryah/Lumi-Summaryception'

/** The card's own `[?]`: what the Branching caption said (96). */
export const CORE_CARD_HELP = 'To branch a campaign, use Branch on a message in Lumiverse. AdventureTime copies the campaign into the new chat as it stood at that message. To copy only the lorebooks, use Clone the lorebooks in the Lore widget’s Lorebook Agent tab.\n\nDifferent from Multihog: there is no Branch campaign button, because Lumiverse does not let an extension create a chat.'
export const CHECKLIST_BUTTON_HELP = 'Lists five things to check on your connection and its preset before you start a campaign. Each item shows what AdventureTime can confirm by itself.'
export const CHECKLIST_HELP = 'Most setup problems come from connection and preset settings in Lumiverse. This list says what to check there.'

const NOT_READ = 'Not read yet. Open the Tracker widget once, then look again.'

/** The words for why a blank row resolved as it did (89), for the evidence. */
const WHY_WORDS: Record<NonNullable<StatusResult['passes']>['why'], string> = {
    chat: 'the chat’s own connection',
    seen: 'the connection that wrote the last reply',
    default: 'Lumiverse’s default connection',
    first: 'the first connection in Lumiverse’s list',
    none: 'nothing: Lumiverse has no connection',
}

/** Multihog's four, in Lumiverse's terms, with what the status shows — and a fifth (89): the connection the passes run on. */
export function checklistItems(status: StatusResult | null): ChecklistItem[] {
    const dice = status?.dice
    const passes = status?.passes
    let runsOn: Pick<ChecklistItem, 'state' | 'evidence'>
    if (!passes) runsOn = { state: 'unknown', evidence: NOT_READ }
    else if (!passes.id) runsOn = { state: 'bad', evidence: 'Lumiverse has no connection, so no pass can run. Create a connection in Lumiverse and turn on Set as default connection for it.' }
    else {
        const named = `${passes.name || passes.id}${passes.provider ? ` (${passes.provider}${passes.model ? ` · ${passes.model}` : ''})` : ''}`
        runsOn = passes.why === 'first'
            ? { state: 'warn', evidence: `A blank connection uses ${named}, ${WHY_WORDS.first}. No connection is set as default and no reply has been seen yet. Set a default connection in Lumiverse, or choose one under Connections & models.` }
            : { state: 'ok', evidence: `A blank connection uses ${named}: ${WHY_WORDS[passes.why]}. Every blank connection under Connections & models uses this one.` }
    }
    let output: Pick<ChecklistItem, 'state' | 'evidence'>
    if (!passes) output = { state: 'unknown', evidence: NOT_READ }
    else if (passes.maxTokens > 0) output = { state: 'ok', evidence: `Pass output length is ${passes.maxTokens.toLocaleString()} tokens, sent on every pass.` }
    else if (/anthropic|claude/i.test(passes.provider)) output = { state: 'warn', evidence: 'The field is blank. On an Anthropic connection Lumiverse then limits every pass to 4,096 tokens, which a long JSON answer can exceed. If a pass’s answer is cut off, set "Pass output length" under Connections & models.' }
    else output = { state: 'unknown', evidence: `The field is blank, so each pass uses the provider’s default${passes.provider ? ` (${passes.provider})` : ''}, which cannot be read here. If a pass’s answer is cut off, set "Pass output length" under Connections & models.` }
    let tools: Pick<ChecklistItem, 'state' | 'evidence'>
    if (!dice) tools = { state: 'unknown', evidence: NOT_READ }
    else if (dice.registered.length) {
        const made = dice.turn?.length ?? 0
        tools = made
            ? { state: 'ok', evidence: `The dice tool is registered and the narrator called it ${made === 1 ? 'once' : `${made} times`} in the last reply. The connection can call tools.` }
            : { state: 'warn', evidence: 'The dice tool is registered, but the last reply did not call it. Check again after a reply that should roll. If rolls appear in the story without a call, turn on Enable Function Calling on the connection.' }
    } else if (dice.absent === 'refused') tools = { state: 'bad', evidence: 'Lumiverse refused the dice tool. The tools permission is usually missing. The version line names any missing permission.' }
    else if (dice.absent === 'combat') tools = { state: 'warn', evidence: 'During combat the dice come from the pre-seeded queue. The tool returns after combat. Nothing to check now.' }
    else tools = { state: 'warn', evidence: 'The RNG mode does not use the dice tool, so this cannot test the connection. That is fine if you chose this mode for a connection that cannot call tools.' }
    // The narrator card and the open chat (98): readable since the status carries them; ❔ on an older backend.
    const told = status?.narrator
    let narrator: Pick<ChecklistItem, 'state' | 'evidence'>
    if (!told) narrator = { state: 'unknown', evidence: status ? 'Cannot be read here. Press Create narrator card, then open a chat from the card.' : NOT_READ }
    else if (!told.exists) narrator = { state: 'warn', evidence: `No card named “${told.name}” yet. Press Create narrator card, then open a new chat from it in Lumiverse.` }
    else if (told.chat === 'narrator') narrator = { state: 'ok', evidence: `This chat is from the narrator card “${told.name}”.` }
    else if (told.chat === 'other') narrator = { state: 'warn', evidence: `The card “${told.name}” exists, but this chat is from ${told.chatCardName ? `“${told.chatCardName}”` : 'another card'}. Open a new chat from “${told.name}” in Lumiverse, or enter this chat’s card as the narrator card name.` }
    else if (told.chat === 'none') narrator = { state: 'warn', evidence: `The card “${told.name}” exists. No chat is open: open a new chat from it in Lumiverse.` }
    else narrator = { state: 'ok', evidence: `The card “${told.name}” exists. Which card this chat is from cannot be read here, so open the chat from it.` }
    return [
        { id: 'tools', title: 'Narrator connection can call tools', why: 'The dice and the Map Architect are tools that the narrator calls. If function calling is off on the connection, dice rolls are made up in the story and maps are never drawn. For a connection that cannot call tools, set RNG mode to "Pre-seeded queue only" and use the Map Architect text opener.', ...tools },
        { id: 'passes', title: 'Passes have a connection', why: 'A pass with a blank connection uses the narrator’s connection. AdventureTime picks it in this order:\n1. The connection pinned to the chat.\n2. The connection that wrote the last reply.\n3. Lumiverse’s default connection.\n4. The first connection in Lumiverse’s list.', ...runsOn },
        { id: 'output', title: 'Pass output length is enough', why: 'The Lorebook Agent, Map Architect, Map Updater and Map Evolution answer in JSON. If the output length is too low, the answer is cut off and the pass reports a parse error. A preset does not apply to passes, so set "Pass output length" under Connections & models.\n\nDifferent from Multihog: do not copy Multihog’s 100,000 tokens. Some providers refuse a number above the model’s limit, so use a smaller one.', ...output },
        { id: 'context', title: 'Narrator context and output length leave room', why: 'Lumiverse reserves the preset’s Max Tokens out of the context cap, and the chat history must fit in what is left. Lumiverse trims only the oldest chat history. AdventureTime’s messages are added after that. Set the context cap below the model’s maximum to leave room for AdventureTime’s messages. The "AdventureTime —" rows of Lumiverse’s Prompt Breakdown show how many tokens they use. The rulebook alone is about 6,700 tokens. A summary extension such as Summaryception keeps the chat itself small.\n\nDifferent from Multihog: set the narrator’s Max Tokens to the length of one reply plus any reasoning, not Multihog’s 100,000.', state: 'unknown', evidence: 'Cannot be read here. AdventureTime does not ask for the presets permission. Check the preset in Lumiverse’s connection settings.' },
        { id: 'narrator', title: 'Chat uses a narrator card', why: 'AdventureTime is narrator-led play, not a one-on-one character chat. The rulebook is the whole prompt, so the narrator card can be empty. Create one under Narrator card on the Setup & help card, then open a chat from it.', ...narrator },
    ]
}

/**
 * The summariser's check (1.0.1), out of the checklist and onto the starting area's *Before you start* since 1.1.2
 * (the maintainer's ask of 2026-11-26). Always ❔: an extension cannot see another.
 */
export const SUMMARISER_CHECK: ChecklistItem = {
    id: 'summariser',
    title: 'Summariser for long chats (recommended)',
    why: 'Every reply sends the whole chat again, so a long campaign grows until it no longer fits the model, costs more each turn, and loses its oldest messages. A summariser hides older messages and keeps a short summary of them. The Lorebook Agent keeps the details in lorebooks, so little is lost. Install one before a campaign gets long.',
    state: 'unknown',
    evidence: 'AdventureTime cannot see other extensions, so check this in Lumiverse’s extension list. Recommended: Lumi-Summaryception, the Lumiverse port of the summariser Multihog’s author recommends.',
    link: { label: 'Open Lumi-Summaryception', url: SUMMARYCEPTION_URL },
}

const STATE_MARK: Record<ChecklistItem['state'], string> = { ok: '✅', warn: '⚠️', unknown: '❔', bad: '❌' }

export const CORE_CARD_CSS = `
.adventuretime-panel .lh-core-caption { font-size: 0.72em; font-weight: 700; opacity: 0.65; text-transform: uppercase; letter-spacing: 0.4px; margin-top: 6px; }
.adventuretime-panel .lh-core-actions { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.adventuretime-panel .lh-checklist { display: flex; flex-direction: column; gap: 10px; font-size: 0.92em; }
.adventuretime-panel .lh-checklist[hidden] { display: none; }
.adventuretime-panel .lh-checklist-item { display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25))); border-radius: 6px; padding: 8px 10px; }
.adventuretime-panel .lh-checklist-mark { font-size: 1.1em; }
.adventuretime-panel .lh-checklist-head { display: flex; align-items: center; gap: 4px; min-width: 0; }
.adventuretime-panel .lh-checklist-title { font-weight: 600; }
.adventuretime-panel .lh-checklist-item .lh-help-note { grid-column: 2; margin: 0; }
.adventuretime-panel .lh-checklist-evidence { grid-column: 2; line-height: 1.4; }
.adventuretime-panel .lh-checklist-item--ok .lh-checklist-evidence { color: var(--lumiverse-success, #34a853); }
.adventuretime-panel .lh-checklist-item--bad .lh-checklist-evidence { color: var(--lumiverse-danger, #d9534f); }
.adventuretime-panel .lh-checklist-status { display: flex; align-items: center; gap: 4px; font-size: 0.92em; opacity: 0.8; }
`

export function createCoreCard(host: CoreCardHost): CoreCard {
    const { el } = host
    const root = el('details', { class: 'lh-card lh-second-card lh-search-item', 'data-lh-card': 'core-branching' }) as HTMLDetailsElement
    const summary = el('summary')
    const icon = el('span', { class: 'lh-card-icon', 'aria-hidden': 'true' })
    setCardIcon(icon, 'Setup & help', '🎛️')
    const title = el('span', { class: 'lh-card-title' })
    title.textContent = 'Setup & help'
    summary.append(icon, title, el('span', { class: 'lh-chevron', 'aria-hidden': 'true' }))
    const body = el('div', { class: 'lh-second-body' })
    root.append(summary, body)
    // What the Branching caption said, behind the card's own [?] (96).
    attachCardHelp(el, root, summary, title, CORE_CARD_HELP)

    let status: StatusResult | null = null

    const caption = (text: string): HTMLElement => { const c = el('div', { class: 'lh-core-caption' }); c.textContent = text; return c }

    // ── Help: the checklist, then the narrator card ──────────────────────
    const checklistRow = el('div', { class: 'lh-second-row lh-search-item', 'data-lh-field': 'lumiverse-checklist' })
    const checklistActions = el('div', { class: 'lh-core-actions' })
    const checklistButton = el('button', { type: 'button', class: 'lh-button' }) as HTMLButtonElement
    checklistButton.textContent = 'Open Lumiverse checklist'
    const checklistTip = createHelpTip(el, 'Open Lumiverse checklist', CHECKLIST_BUTTON_HELP)
    checklistActions.append(checklistButton, checklistTip.button)
    checklistRow.append(checklistActions, checklistTip.note)

    // The box is built once, in the DOM from the first paint (81-bis), and only its marks and evidence are
    // written again on a status: a [?] the user opened stays open through a redraw, and no help is built lazily.
    const checklistBox = el('div', { class: 'lh-checklist', 'data-lh-field': 'lumiverse-checklist-box', hidden: 'hidden' })
    const parts = new Map<ChecklistItem['id'], { node: HTMLElement; mark: HTMLElement; evidence: HTMLElement }>()
    for (const item of checklistItems(null)) {
        const node = el('div', { class: 'lh-checklist-item', 'data-lh-field': `checklist-${item.id}` })
        const mark = el('span', { class: 'lh-checklist-mark', 'aria-hidden': 'true' })
        const head = el('span', { class: 'lh-checklist-head' })
        const t = el('span', { class: 'lh-checklist-title' })
        t.textContent = item.title
        const tip = createHelpTip(el, item.title, item.why)
        head.append(t, tip.button)
        const evidence = el('div', { class: 'lh-checklist-evidence' })
        node.append(mark, head, tip.note, evidence)
        checklistBox.append(node)
        parts.set(item.id, { node, mark, evidence })
    }
    const statusLine = el('div', { class: 'lh-checklist-status', 'data-lh-field': 'checklist-status' })
    const statusText = el('span')
    const statusTip = createHelpTip(el, 'Lumiverse checklist', CHECKLIST_HELP)
    statusLine.append(statusText, statusTip.button)
    checklistBox.append(statusLine, statusTip.note)
    let open: DetailsModal | null = null
    function drawChecklist(): void {
        const items = checklistItems(status)
        for (const item of items) {
            const part = parts.get(item.id)
            if (!part) continue
            part.node.className = `lh-checklist-item lh-checklist-item--${item.state}`
            part.mark.textContent = STATE_MARK[item.state]
            part.evidence.textContent = item.evidence
        }
        const seen = items.filter((i) => i.state === 'ok').length
        statusText.textContent = `${seen} of ${items.length} confirmed here. Check the rest in Lumiverse.`
    }
    // Its `hidden` is held by a rule of its own, since the box's display: flex would beat the attribute
    // (lesson 60) — which is how 0.160.0 showed the list under the button.
    drawChecklist()
    checklistButton.addEventListener('click', () => {
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
        caption('Help'), checklistRow, checklistBox,
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
