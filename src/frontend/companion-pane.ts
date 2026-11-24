/**
 * The Adventure Companion's chat (Phase 100a, roadmap row 100): a second
 * conversation beside the story. A message list, a typing box, Send and
 * Clear, and two options — whether the guide is sent with every message
 * (the install's preference, so off is off in every chat) and where the
 * chat stands (a tab of the Lore widget, or a card of the settings tab).
 *
 * The conversation is the backend's, per chat (`companion.get`, `.send`,
 * `.clear`). A reply is drawn as simple formatted text built from DOM
 * nodes, never as HTML from the model.
 */

import type { CompanionChatMessage, CompanionState } from '../protocol.js'
import { helpAfter, withHelp } from './help-tip.js'

export type CompanionPlace = 'widget' | 'settings'

export interface CompanionPaneHost {
    el(tag: string, attrs?: Record<string, string>): HTMLElement
    load(chatId: string): Promise<CompanionState>
    send(chatId: string, text: string): Promise<CompanionState>
    clear(chatId: string): Promise<CompanionState>
    /** Answer a proposed player turn (100c): send it as the player, or drop it. */
    answerTurn(chatId: string, send: boolean): Promise<CompanionState>
    savePrefs(patch: Record<string, unknown>): Promise<void>
    /** The host's confirm; without one Clear clears at once. */
    confirm?(title: string, message: string, confirmLabel: string): Promise<boolean>
    /** A message's time in the browser's own format. */
    clock?(iso: string): string
    /** Called when the place preference changes, from this pane or from another device. */
    onPlace?(place: CompanionPlace): void
}

export interface CompanionPane {
    root: HTMLDetailsElement
    setChat(chatId: string | null): void
    applyPrefs(prefs: Record<string, unknown>): void
    place(): CompanionPlace
    /** Resolves when the load or the send in flight has been drawn; for a test. */
    settled(): Promise<void>
}

export const COMPANION_TEXT = {
    title: 'Adventure Companion',
    sub: 'Ask how AdventureTime works, talk over your story, or ask it to update the campaign.',
    intro: 'Ask how AdventureTime works, or talk over your story. The Companion sees only what you choose below. Ask it to change the character sheet, the lore or the map and it does; ask it to take your turn and it shows you the message first.',
    empty: 'No messages yet. Ask a question, for example: “How do I turn off spell slots?”',
    noChat: 'Open a chat to talk to the Companion. Each chat has its own conversation.',
    placeholder: 'Ask the Companion… (Enter to send, Shift+Enter for a new line)',
    writing: 'The Companion is writing…',
    you: 'You',
    companion: 'Companion',
    guideHelp: 'Sends the whole AdventureTime guide with every message to the Companion, so its answers match what is on your screen. Without the guide, the model answers from what it knows of other tools, which is often wrong here. This setting applies to every chat: when you turn it off, it stays off everywhere until you turn it on again. Default: on.',
    seesHelp: 'What the Companion is shown of your campaign with every message. “Recent story” is the number of latest chat messages it reads; 0 shows it none, and “Whole story” sends every message. “Character sheet” is the tracker’s sheet. “Active lore” is the lorebook entries Lumiverse has active for this chat. “Site map” is the map of the site the party is in, as the party knows it: never what is still hidden. Each one adds tokens to every message. These settings apply to every chat. Default: 5 messages, the other three off.',
    turnLead: 'The Companion wants to send this as your turn:',
    turnSending: 'Sending your turn…',
    confirmHelp: 'When on, the Companion shows you the message before it sends a turn for you, and sends it only when you press “Send as my turn”. When off, it sends the turn at once. Changes to the character sheet, the lore and the map are never asked about: the Companion makes them when you ask, and lists each one under its reply. This setting applies to every chat. Default: on.',
    placeHelp: 'Where the Companion’s chat appears. “The Lore widget” adds a Companion tab beside Visuals/Map. “The settings tab” puts it in the AdventureTime settings tab instead, between Starting the adventure and Raw tracker memo, so it can stay open beside the widgets. Default: the Lore widget.',
} as const

/** The line under the guide tick: what the guide costs while attached, or that it is off everywhere. */
export function guideCostLine(attached: boolean, tokens: number): string {
    if (!attached) return 'The guide is not sent, in any chat. Answers about AdventureTime may be wrong.'
    if (tokens <= 0) return 'The guide is sent with every message.'
    return `The guide adds about ${tokens.toLocaleString('en-US')} tokens to every message. A small, cheap model suits the Companion.`
}

/** One action's receipt under a reply: a tick or a cross, the action's name, what it reported. */
export function receiptLine(receipt: { action: string; success: boolean; message: string }): string {
    return `${receipt.success ? '✓' : '✗'} ${receipt.action}: ${receipt.message}`
}

type El = CompanionPaneHost['el']

/**
 * Inline marks of one line, as nodes: `**bold**`, `*italic*`, `***both***` and `code`. A mark may hold
 * the other inside it, since the guide writes a path in italics with the control's name in bold at its
 * end (`*Settings → **Tracker modules***`) and a model answering from it does the same. Anything else is text.
 */
// As Markdown has it, a mark opens before a non-space and closes after one, so `2 * 3` is arithmetic.
const INLINE = new RegExp([
    '`([^`\\n]+)`',
    '\\*\\*\\*(?!\\s)([^*\\n]+)(?<!\\s)\\*\\*\\*',
    '\\*\\*(?!\\s)((?:[^*\\n]|\\*(?![*\\s])[^*\\n]+(?<!\\s)\\*(?!\\*))+)(?<!\\s)\\*\\*',
    '\\*(?![*\\s])((?:[^*\\n]|\\*\\*(?!\\s)[^*\\n]+(?<!\\s)\\*\\*)+)(?<!\\s)\\*',
].join('|'), 'g')

function inline(el: El, text: string, into: HTMLElement): void {
    let last = 0
    for (const match of text.matchAll(INLINE)) {
        const at = match.index ?? 0
        if (at > last) into.append(text.slice(last, at))
        const [, code, both, bold, italic] = match
        if (code !== undefined) {
            const node = el('code')
            node.textContent = code
            into.append(node)
        } else if (both !== undefined) {
            const strong = el('strong')
            const em = el('em')
            em.textContent = both
            strong.append(em)
            into.append(strong)
        } else {
            // The inside may carry the other mark: read it the same way.
            const node = el(bold !== undefined ? 'strong' : 'em')
            inline(el, bold ?? italic ?? '', node)
            into.append(node)
        }
        last = at + match[0].length
    }
    if (last < text.length) into.append(text.slice(last))
}

/**
 * A reply as simple formatted text: paragraphs, bulleted and numbered
 * lists, headings as bold lines, and the three inline marks. Built from
 * nodes with `textContent`, so nothing the model writes is read as HTML.
 */
export function renderCompanionText(el: El, text: string): HTMLElement {
    const root = el('div', { class: 'lh-companion-text' })
    let list: HTMLElement | null = null
    let paragraph: HTMLElement | null = null
    const close = (): void => { list = null; paragraph = null }
    for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
        const line = raw.trim()
        if (!line) { close(); continue }
        const bullet = /^[-*•]\s+(.*)$/.exec(line)
        const numbered = /^\d+[.)]\s+(.*)$/.exec(line)
        const heading = /^#{1,6}\s+(.*)$/.exec(line)
        if (bullet || numbered) {
            const tag = bullet ? 'ul' : 'ol'
            if (!list || list.tagName.toLowerCase() !== tag) { close(); list = el(tag); root.append(list) }
            const item = el('li')
            inline(el, (bullet ?? numbered)![1]!, item)
            list.append(item)
            paragraph = null
            continue
        }
        if (heading) {
            close()
            const head = el('p', { class: 'lh-companion-heading' })
            const strong = el('strong')
            inline(el, heading[1]!, strong)
            head.append(strong)
            root.append(head)
            continue
        }
        list = null
        if (!paragraph) { paragraph = el('p'); root.append(paragraph) } else paragraph.append(el('br'))
        inline(el, line, paragraph)
    }
    return root
}

export function createCompanionPane(host: CompanionPaneHost): CompanionPane {
    const { el } = host
    const root = el('details', { class: 'lh-companion', 'data-lh-field': 'companion' }) as HTMLDetailsElement
    const summary = el('summary')
    const icon = el('span', { class: 'lh-start-option-icon', 'aria-hidden': 'true' })
    icon.textContent = '💬'
    const label = el('span', { class: 'lh-start-option-label' })
    const title = el('span', { class: 'lh-start-option-title' })
    title.textContent = COMPANION_TEXT.title
    const sub = el('small', { class: 'lh-start-option-sub' })
    sub.textContent = COMPANION_TEXT.sub
    label.append(title, sub)
    summary.append(icon, label, el('span', { class: 'lh-chevron', 'aria-hidden': 'true' }))

    const body = el('div', { class: 'lh-companion-body lh-start-option-body' })
    const intro = el('p', { class: 'lh-companion-intro', 'data-lh-field': 'companion-intro' })
    intro.textContent = COMPANION_TEXT.intro
    const list = el('div', { class: 'lh-companion-messages', role: 'log', 'aria-live': 'polite', 'data-lh-field': 'companion-messages' })
    const busyLine = el('div', { class: 'lh-companion-busy', 'data-lh-field': 'companion-busy' })
    busyLine.textContent = COMPANION_TEXT.writing
    busyLine.hidden = true
    const error = el('div', { class: 'lh-companion-error', role: 'alert', 'data-lh-field': 'companion-error' })
    error.hidden = true
    // A turn the Companion proposes (100c): the message, and the player's two answers.
    const turnCard = el('div', { class: 'lh-companion-turn', 'data-lh-field': 'companion-turn' })
    turnCard.hidden = true
    const turnLead = el('div', { class: 'lh-companion-turn-lead' })
    turnLead.textContent = COMPANION_TEXT.turnLead
    const turnText = el('div', { class: 'lh-companion-turn-text', 'data-lh-field': 'companion-turn-text' })
    const turnButtons = el('div', { class: 'lh-companion-buttons' })
    const turnSend = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'companion-turn-send' }) as HTMLButtonElement
    turnSend.textContent = 'Send as my turn'
    const turnCancel = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'companion-turn-cancel' }) as HTMLButtonElement
    turnCancel.textContent = 'Don’t send'
    turnButtons.append(turnSend, turnCancel)
    turnCard.append(turnLead, turnText, turnButtons)

    const bar = el('div', { class: 'lh-companion-bar' })
    const input = el('textarea', { class: 'lh-input', rows: '2', placeholder: COMPANION_TEXT.placeholder, 'aria-label': 'Message to the Companion', 'data-lh-field': 'companion-input' }) as HTMLTextAreaElement
    const buttons = el('div', { class: 'lh-companion-buttons' })
    const sendButton = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'companion-send' }) as HTMLButtonElement
    sendButton.textContent = 'Send'
    const clearButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'companion-clear' }) as HTMLButtonElement
    clearButton.textContent = 'Clear'
    buttons.append(sendButton, clearButton)
    bar.append(input, buttons)

    const options = el('div', { class: 'lh-companion-options' })
    const guideRow = el('label', { class: 'lh-companion-tick' })
    const guideTick = el('input', { type: 'checkbox', 'data-lh-field': 'companion-guide' }) as HTMLInputElement
    guideTick.checked = true
    const guideWords = el('span')
    guideWords.textContent = 'Attach the guide'
    guideRow.append(guideTick, guideWords)
    const cost = el('div', { class: 'lh-companion-cost', 'data-lh-field': 'companion-cost' })
    // A row, not a label: the help button sits between the words and the select.
    const placeRow = el('div', { class: 'lh-companion-place' })
    const placeWords = el('span')
    placeWords.textContent = 'Show the Companion in'
    const placeSelect = el('select', { class: 'lh-input', 'aria-label': 'Show the Companion in', 'data-lh-field': 'companion-place' }) as HTMLSelectElement
    for (const [value, text] of [['widget', 'The Lore widget'], ['settings', 'The settings tab']] as const) {
        const option = el('option', { value }) as HTMLOptionElement
        option.textContent = text
        placeSelect.append(option)
    }
    placeRow.append(placeWords, placeSelect)
    // What the Companion is shown of the campaign (100b): Multihog's four context choices, the install's.
    const seesHead = el('div', { class: 'lh-companion-sees-head' })
    const seesWords = el('span')
    seesWords.textContent = 'The Companion sees'
    seesHead.append(seesWords)
    const sees = el('div', { class: 'lh-companion-sees', 'data-lh-field': 'companion-sees' })
    const storyRow = el('div', { class: 'lh-companion-story' })
    const storyWords = el('span')
    storyWords.textContent = 'Recent story'
    const lookbackInput = el('input', { type: 'number', class: 'lh-input', min: '0', max: '100', step: '1', 'aria-label': 'Recent story: messages', 'data-lh-field': 'companion-lookback' }) as HTMLInputElement
    const storyUnit = el('span')
    storyUnit.textContent = 'messages'
    const tick = (words: string, field: string): [HTMLElement, HTMLInputElement] => {
        const row = el('label', { class: 'lh-companion-tick' })
        const box = el('input', { type: 'checkbox', 'data-lh-field': field }) as HTMLInputElement
        const text = el('span')
        text.textContent = words
        row.append(box, text)
        return [row, box]
    }
    const [allRow, allTick] = tick('Whole story', 'companion-all')
    storyRow.append(storyWords, lookbackInput, storyUnit, allRow)
    const [sheetRow, sheetTick] = tick('Character sheet', 'companion-sheet')
    const [loreRow, loreTick] = tick('Active lore', 'companion-lore')
    const [mapRow, mapTick] = tick('Site map', 'companion-map')
    sees.append(storyRow, sheetRow, loreRow, mapRow)
    const [confirmRow, confirmTick] = tick('Ask before it takes my turn', 'companion-confirm')
    confirmTick.checked = true
    options.append(
        helpAfter(el, seesHead, seesWords, 'The Companion sees', COMPANION_TEXT.seesHelp), sees,
        withHelp(el, confirmRow, 'Ask before it takes my turn', COMPANION_TEXT.confirmHelp),
        withHelp(el, guideRow, 'Attach the guide', COMPANION_TEXT.guideHelp), cost,
        helpAfter(el, placeRow, placeWords, 'Show the Companion in', COMPANION_TEXT.placeHelp),
    )

    body.append(intro, list, turnCard, busyLine, error, bar, options)
    root.append(summary, body)

    let chatId: string | null = null
    let state: CompanionState | null = null
    /** The message being answered, drawn before the backend has it. */
    let pending: string | null = null
    /** A proposed turn being answered: neither button works twice. */
    let answering = false
    let confirmAct = true
    let guideAttached = true
    let guideTokens = 0
    let where: CompanionPlace = 'widget'
    /** What the Companion is shown (100b), as the install's preferences stand. */
    const shown = { lookback: 5, all: false, sheet: false, lore: false, map: false }
    let token = 0
    let work: Promise<void> = Promise.resolve()

    function showError(message: string | null): void {
        error.textContent = message ?? ''
        error.hidden = !message
    }

    function bubble(message: CompanionChatMessage): HTMLElement {
        const row = el('div', { class: `lh-companion-message lh-companion-message--${message.role}`, 'data-lh-role': message.role })
        const who = el('div', { class: 'lh-companion-who' })
        const stamp = message.at && host.clock ? host.clock(message.at) : ''
        who.textContent = `${message.role === 'user' ? COMPANION_TEXT.you : COMPANION_TEXT.companion}${stamp ? ` · ${stamp}` : ''}`
        if (message.role === 'assistant') {
            row.append(who, renderCompanionText(el, message.content))
            if (message.actions?.length) {
                const receipts = el('ul', { class: 'lh-companion-receipts', 'data-lh-field': 'companion-receipts' })
                for (const receipt of message.actions) {
                    const item = el('li', { class: receipt.success ? 'lh-companion-receipt' : 'lh-companion-receipt lh-companion-receipt--failed' })
                    item.textContent = receiptLine(receipt)
                    receipts.append(item)
                }
                row.append(receipts)
            }
        } else {
            const text = el('div', { class: 'lh-companion-text' })
            text.textContent = message.content
            row.append(who, text)
        }
        return row
    }

    function draw(): void {
        list.textContent = ''
        const messages: CompanionChatMessage[] = [...(state?.messages ?? [])]
        if (pending !== null) messages.push({ role: 'user', content: pending, at: '' })
        if (!chatId || messages.length === 0) {
            const empty = el('div', { class: 'lh-companion-empty' })
            empty.textContent = chatId ? COMPANION_TEXT.empty : COMPANION_TEXT.noChat
            list.append(empty)
        } else {
            for (const message of messages) list.append(bubble(message))
        }
        const busy = pending !== null || answering || state?.busy === true
        busyLine.hidden = !busy
        busyLine.textContent = answering ? COMPANION_TEXT.turnSending : COMPANION_TEXT.writing
        const proposed = pending === null ? state?.pending ?? null : null
        turnCard.hidden = !proposed
        turnText.textContent = proposed?.text ?? ''
        turnSend.disabled = answering
        turnCancel.disabled = answering
        confirmTick.checked = confirmAct
        input.disabled = !chatId
        sendButton.disabled = !chatId || busy
        clearButton.disabled = !chatId || busy || (state?.messages.length ?? 0) === 0
        guideTick.checked = guideAttached
        cost.textContent = guideCostLine(guideAttached, guideTokens)
        placeSelect.value = where
        // A box being typed in is left alone: a preference echo must not move the caret.
        if (lookbackInput.ownerDocument.activeElement !== lookbackInput) lookbackInput.value = String(shown.lookback)
        lookbackInput.disabled = shown.all
        allTick.checked = shown.all
        sheetTick.checked = shown.sheet
        loreTick.checked = shown.lore
        mapTick.checked = shown.map
        list.scrollTop = list.scrollHeight
    }

    function adopt(next: CompanionState): void {
        state = next
        guideAttached = next.guideAttached
        guideTokens = next.guideTokens
    }

    function load(): void {
        const asked = chatId
        const mine = ++token
        pending = null
        answering = false
        state = null
        showError(null)
        draw()
        if (!asked) return
        work = host.load(asked).then((next) => {
            if (mine !== token) return
            adopt(next)
            draw()
        }).catch((reason: unknown) => {
            if (mine !== token) return
            showError(reason instanceof Error ? reason.message : String(reason))
        })
    }

    function send(): void {
        const asked = chatId
        const text = input.value.trim()
        if (!asked || !text || pending !== null || answering || state?.busy) return
        const mine = ++token
        pending = text
        input.value = ''
        showError(null)
        draw()
        work = host.send(asked, text).then((next) => {
            if (mine !== token) return
            pending = null
            adopt(next)
            draw()
        }).catch((reason: unknown) => {
            if (mine !== token) return
            // The message was not kept: put it back in the box so nothing typed is lost.
            pending = null
            if (!input.value) input.value = text
            showError(reason instanceof Error ? reason.message : String(reason))
            draw()
        })
    }

    function answerTurn(send: boolean): void {
        const asked = chatId
        if (!asked || answering || !state?.pending) return
        const mine = ++token
        answering = true
        showError(null)
        draw()
        work = host.answerTurn(asked, send).then((next) => {
            if (mine !== token) return
            answering = false
            adopt(next)
            draw()
        }).catch((reason: unknown) => {
            if (mine !== token) return
            // The turn stays proposed: the player can try again or drop it.
            answering = false
            showError(reason instanceof Error ? reason.message : String(reason))
            draw()
        })
    }

    async function clear(): Promise<void> {
        const asked = chatId
        if (!asked || pending !== null || answering) return
        if (host.confirm && !(await host.confirm('Clear the conversation?', 'This removes the Companion’s conversation for this chat. The story, the character sheet and the lore are not touched. It cannot be undone.', 'Clear'))) return
        if (asked !== chatId) return
        const mine = ++token
        showError(null)
        work = host.clear(asked).then((next) => {
            if (mine !== token) return
            adopt(next)
            draw()
        }).catch((reason: unknown) => {
            if (mine !== token) return
            showError(reason instanceof Error ? reason.message : String(reason))
        })
    }

    sendButton.addEventListener('click', () => { send() })
    turnSend.addEventListener('click', () => { answerTurn(true) })
    turnCancel.addEventListener('click', () => { answerTurn(false) })
    confirmTick.addEventListener('change', () => { confirmAct = confirmTick.checked; save({ companionConfirmAct: confirmAct }) })
    clearButton.addEventListener('click', () => { void clear() })
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault()
            send()
        }
    })
    guideTick.addEventListener('change', () => {
        guideAttached = guideTick.checked
        draw()
        host.savePrefs({ companionGuide: guideAttached }).catch((reason: unknown) => { showError(reason instanceof Error ? reason.message : String(reason)) })
    })
    const save = (patch: Record<string, unknown>): void => {
        draw()
        host.savePrefs(patch).catch((reason: unknown) => { showError(reason instanceof Error ? reason.message : String(reason)) })
    }
    lookbackInput.addEventListener('change', () => {
        const typed = Math.floor(Number(lookbackInput.value))
        shown.lookback = Number.isFinite(typed) ? Math.min(100, Math.max(0, typed)) : shown.lookback
        lookbackInput.value = String(shown.lookback)
        save({ companionLookback: shown.lookback })
    })
    allTick.addEventListener('change', () => { shown.all = allTick.checked; save({ companionLookbackAll: shown.all }) })
    sheetTick.addEventListener('change', () => { shown.sheet = sheetTick.checked; save({ companionSheet: shown.sheet }) })
    loreTick.addEventListener('change', () => { shown.lore = loreTick.checked; save({ companionLore: shown.lore }) })
    mapTick.addEventListener('change', () => { shown.map = mapTick.checked; save({ companionMap: shown.map }) })
    placeSelect.addEventListener('change', () => {
        where = placeSelect.value === 'settings' ? 'settings' : 'widget'
        host.onPlace?.(where)
        host.savePrefs({ companionPlace: where }).catch((reason: unknown) => { showError(reason instanceof Error ? reason.message : String(reason)) })
    })

    draw()

    return {
        root,
        setChat(next) {
            if (next === chatId) return
            chatId = next
            load()
        },
        applyPrefs(prefs) {
            if (typeof prefs.companionGuide === 'boolean') guideAttached = prefs.companionGuide
            if (typeof prefs.companionLookback === 'number') shown.lookback = prefs.companionLookback
            if (typeof prefs.companionLookbackAll === 'boolean') shown.all = prefs.companionLookbackAll
            if (typeof prefs.companionSheet === 'boolean') shown.sheet = prefs.companionSheet
            if (typeof prefs.companionLore === 'boolean') shown.lore = prefs.companionLore
            if (typeof prefs.companionMap === 'boolean') shown.map = prefs.companionMap
            if (typeof prefs.companionConfirmAct === 'boolean') confirmAct = prefs.companionConfirmAct
            const place: CompanionPlace = prefs.companionPlace === 'settings' ? 'settings' : prefs.companionPlace === 'widget' ? 'widget' : where
            const moved = place !== where
            where = place
            draw()
            if (moved) host.onPlace?.(where)
        },
        place: () => where,
        settled: () => work,
    }
}

/**
 * The chat's look. The tab's `[hidden]` outweighs the phone block's display
 * rule for the tabs, so a tab taken out of the strip is gone there too.
 */
export const COMPANION_PANE_CSS = `
.adventuretime-panel .lh-widget-tab[hidden] { display: none; }
.lh-companion-body { display: flex; flex-direction: column; gap: 8px; }
.lh-companion-intro { margin: 0; font-size: 0.85em; opacity: 0.75; }
.lh-companion-messages { display: flex; flex-direction: column; gap: 8px; max-height: 55vh; overflow-y: auto; padding: 2px; }
.lh-companion-empty { font-size: 0.9em; opacity: 0.7; padding: 12px 4px; }
.lh-companion-message { max-width: 92%; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--lh-border, var(--lumiverse-border, rgba(128, 128, 128, 0.3))); overflow-wrap: anywhere; }
.lh-companion-message--user { align-self: flex-end; border-color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
.lh-companion-message--assistant { align-self: flex-start; background: var(--lh-card-bg, var(--lumiverse-fill-subtle, rgba(128, 128, 128, 0.08))); }
.lh-companion-who { font-size: 0.75em; opacity: 0.65; margin-bottom: 2px; }
.lh-companion-message--user .lh-companion-text { white-space: pre-wrap; }
.lh-companion-text p { margin: 0 0 6px; }
.lh-companion-text p:last-child, .lh-companion-text ul:last-child, .lh-companion-text ol:last-child { margin-bottom: 0; }
.lh-companion-text ul, .lh-companion-text ol { margin: 0 0 6px; padding-left: 1.4em; }
.lh-companion-text code { font-size: 0.9em; padding: 0 3px; border-radius: 3px; background: var(--lh-card-bg, var(--lumiverse-fill-subtle, rgba(128, 128, 128, 0.15))); }
.lh-companion-busy { font-size: 0.85em; font-style: italic; opacity: 0.75; }
.lh-companion-busy[hidden], .lh-companion-error[hidden], .lh-companion-turn[hidden] { display: none; }
.lh-companion-receipts { list-style: none; margin: 6px 0 0; padding: 4px 0 0; border-top: 1px dashed var(--lh-border, var(--lumiverse-border, rgba(128, 128, 128, 0.3))); font-size: 0.85em; opacity: 0.85; }
.lh-companion-receipt--failed { color: var(--lh-danger, var(--lumiverse-danger, #d9534f)); }
.lh-companion-turn { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
.lh-companion-turn-lead { font-size: 0.85em; opacity: 0.8; }
.lh-companion-turn-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.lh-companion-error { font-size: 0.85em; color: var(--lh-danger, var(--lumiverse-danger, #d9534f)); }
.lh-companion-bar { display: flex; align-items: flex-end; gap: 6px; flex-wrap: wrap; }
.lh-companion-bar textarea { flex: 1 1 12em; min-width: 0; resize: vertical; font-family: inherit; font-size: inherit; }
.lh-companion-buttons { display: flex; gap: 6px; }
.lh-companion-options { display: flex; flex-direction: column; gap: 4px; font-size: 0.9em; }
.lh-companion-tick { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.lh-companion-cost { font-size: 0.85em; opacity: 0.7; }
.lh-companion-sees-head { display: flex; align-items: center; gap: 6px; font-weight: 600; }
.lh-companion-sees { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; margin-bottom: 4px; }
.lh-companion-story { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; flex: 1 1 100%; }
.lh-companion-story input[type="number"] { width: 4.5em; }
.lh-companion-story input[type="number"]:disabled { opacity: 0.45; }
.lh-companion-place { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.lh-companion-place select { flex: 0 1 14em; min-width: 0; }
`
