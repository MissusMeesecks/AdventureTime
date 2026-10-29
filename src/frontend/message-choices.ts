/**
 * The narrator's choices, as buttons under the reply that offered them.
 *
 * Multihog's CYOA mode (roadmap row 6): every reply ends with a `<choices>`
 * block, and the legacy turns the `<button>`s SillyTavern happened to render
 * into clickable ones that fill its send box and press its send button. This
 * build draws the buttons itself, from the text the model wrote, and a click
 * asks the backend to send that text as the user's message and start the
 * reply -- the host appends and generates in one call.
 *
 * Same home and same mechanics as the tracker cards (`message-cards.ts`):
 * `dom.inject()` into the bubble, so the page's stylesheet applies and the
 * host replays the injection when a virtualized bubble remounts, with the
 * element identity -- and so the click handler -- preserved. The choices are
 * read from the chat through the backend rather than from the rendered
 * bubble, because what Lumiverse makes of a `<button>` inside a reply is its
 * business and not something to parse.
 *
 * Every reply with a block gets its buttons, not only the newest, as the
 * legacy binds every message: choosing from an older reply is a way of
 * saying "back to that", and it sends exactly as any other choice does.
 */

import type { Bridge } from './bridge.js'
import { hideChoicesInBubble } from './choices-hide.js'
import { escapeHtml } from '../tracker/html.js'
import type { CyoaChoicesResult } from '../protocol.js'
import type { MessageCardsHost } from './message-cards.js'

export type MessageChoicesHost = MessageCardsHost

export interface MessageChoices {
    /** Re-read the chat's choices and redraw. Safe on a chat switch. */
    refresh(): Promise<void>
    destroy(): void
}

/** The wrapper class, also the marker for "this bubble already has its choices". */
export const CHOICES_CLASS = 'lh-choices'

/**
 * One choice's text as a button's inside.
 *
 * The legacy decorates the mechanics: `[Stealth (+6) DC 14]` gets its own
 * colour. Here the bracketed parts are marked and the stylesheet dims them,
 * so the action reads first and the arithmetic second.
 */
export function renderChoice(text: string): string {
    return escapeHtml(text).replace(/\[([^\]]+)\]/g, '<span class="lh-choice-mech">[$1]</span>')
}

/**
 * The buttons, inside their own block.
 *
 * Inside a block of their own on purpose: what `dom.inject()` hands back is
 * the *host's* wrapper, and painting bare buttons into it left them inline,
 * two to a line, in the first live reply (Phase 31a). The tracker cards never
 * met this because a card is a block already. The test host that returned the
 * injected element itself could not see it either.
 */
export function renderChoices(choices: readonly string[]): string {
    const buttons = choices
        .map((choice, index) =>
            `<button type="button" class="lh-choice" data-lh-choice="${index}">${renderChoice(choice)}</button>`)
        .join('')
    return `<div class="lh-choices-list">${buttons}</div>`
}

export function mountMessageChoices(bridge: Bridge, host: MessageChoicesHost): MessageChoices {
    let chatId: string | null = null
    let destroyed = false
    /** The choices each reply offers, keyed by message id. */
    const choices = new Map<string, string[]>()
    /** The wrapper this module injected into each bubble. */
    const drawn = new Map<string, Element>()
    /** What each wrapper was drawn from, so an unchanged sweep does no work. */
    const painted = new Map<string, string>()
    /** The message whose choice is on its way, so a second click waits. */
    let sending: string | null = null

    function clear(): void {
        for (const [, wrapper] of drawn) {
            try {
                host.dom.uninject(wrapper)
            } catch {
                // A bubble the host already tore down.
            }
        }
        drawn.clear()
        painted.clear()
    }

    function paint(messageId: string, wrapper: Element): void {
        const list = choices.get(messageId)
        if (!list) return
        // Every reply's buttons hold while any choice is on its way: one
        // choice is one turn, and a second from another reply would be a
        // second turn queued behind it.
        const key = `${list.join('\u0000')}::${sending ? 'sending' : ''}`
        if (painted.get(messageId) === key) return
        wrapper.innerHTML = renderChoices(list)
        if (sending) {
            wrapper.querySelectorAll('button').forEach((button) => { button.disabled = true })
        }
        painted.set(messageId, key)
    }

    function repaintAll(): void {
        for (const [messageId, wrapper] of drawn) paint(messageId, wrapper)
    }

    async function choose(messageId: string, index: number): Promise<void> {
        const text = choices.get(messageId)?.[index]
        if (!text || !chatId || sending) return
        const startedFor = chatId
        sending = messageId
        repaintAll()
        try {
            await bridge.request('cyoa.choose', { chatId, text })
        } finally {
            if (!destroyed && chatId === startedFor) {
                sending = null
                repaintAll()
            }
        }
    }

    function onClick(messageId: string, target: EventTarget | null): void {
        if (!(target instanceof Element)) return
        const button = target.closest('button[data-lh-choice]')
        if (!button) return
        const index = Number(button.getAttribute('data-lh-choice'))
        if (!Number.isFinite(index)) return
        choose(messageId, index).catch(() => undefined)
    }

    /** Put the buttons under every mounted reply that offered choices. */
    function sweep(): void {
        if (destroyed || !chatId) return
        for (const { messageId, element } of host.dom.listMessageElements()) {
            if (!choices.has(messageId)) {
                // A reply whose choices went (an edit, a swipe) loses its buttons.
                const stale = drawn.get(messageId)
                if (stale) {
                    try { host.dom.uninject(stale) } catch { /* gone already */ }
                    drawn.delete(messageId)
                    painted.delete(messageId)
                }
                continue
            }
            let wrapper = drawn.get(messageId)
            if (!wrapper || !wrapper.isConnected) {
                if (wrapper) {
                    try { host.dom.uninject(wrapper) } catch { /* gone already */ }
                }
                wrapper = host.dom.inject(element, `<div class="${CHOICES_CLASS}"></div>`, 'beforeend')
                wrapper.addEventListener('click', (event) => { onClick(messageId, event.target) })
                drawn.set(messageId, wrapper)
                painted.delete(messageId)
            }
            paint(messageId, wrapper)
            // The block's own lines, as the host rendered them, go out of
            // sight here rather than through a regex script in the host's
            // library (Phase 33a, lesson 37). Cheap and idempotent: a bubble
            // already done costs a lookup per line.
            try {
                hideChoicesInBubble(element, choices.get(messageId) ?? [])
            } catch {
                // A bubble the host is tearing down. The buttons still stand.
            }
        }
    }

    async function refresh(): Promise<void> {
        if (destroyed) return
        const next = host.getActiveChat().chatId
        if (next !== chatId) {
            clear()
            choices.clear()
            sending = null
            chatId = next
        }
        if (!chatId) return
        const asked = chatId
        try {
            const result = await bridge.request<CyoaChoicesResult>('cyoa.choices', { chatId })
            if (destroyed || chatId !== asked) return
            choices.clear()
            for (const entry of result.messages ?? []) choices.set(entry.messageId, entry.choices)
        } catch {
            // A backend that cannot list them leaves the buttons as they were.
            return
        }
        sweep()
    }

    /**
     * A reply landing, a swipe, an edit: the choices may have changed, so
     * they are re-read. Coalesced, because the host fires the render event
     * for every bubble it mounts on a scroll.
     */
    let pending: ReturnType<typeof setTimeout> | null = null
    const scheduleRefresh = (): void => {
        if (pending) return
        pending = setTimeout(() => {
            pending = null
            void refresh().catch(() => undefined)
        }, 50)
    }

    const unsubscribeHost = [
        ...['CHARACTER_MESSAGE_RENDERED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'GENERATION_ENDED'].map((event) =>
            host.events.on(event, () => { scheduleRefresh() }),
        ),
        host.events.on('USER_MESSAGE_RENDERED', () => { sweep() }),
        ...['CHAT_SWITCHED', 'CHAT_CHANGED'].map((event) =>
            host.events.on(event, () => { void refresh().catch(() => undefined) }),
        ),
    ]

    void refresh().catch(() => undefined)

    return {
        refresh,
        destroy(): void {
            destroyed = true
            if (pending) clearTimeout(pending)
            for (const off of unsubscribeHost) off()
            clear()
        },
    }
}
