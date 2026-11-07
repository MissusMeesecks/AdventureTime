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
 *
 * The chat switch on a phone (93, the maintainer's report of 2026-11-06):
 * the chat list there is the host's home screen, and `CHAT_SWITCHED` fires
 * with a null chat on the way to it. The module read that as a chat with no
 * buttons to draw and took every button down, and when the next switch's
 * event came before the host's own view of the active chat had moved, the
 * read ran for the chat being left and nothing drew the new one's. So: a
 * null chat holds what stands (the bubbles go with it, or they do not and
 * the buttons stay theirs), a switch event's own chat id outranks the
 * host's view, a wrapper the host replays into a remounted bubble is
 * adopted rather than drawn beside, and a heartbeat sweeps every second and
 * a half for a chat the events missed or a bubble the host redrew bare,
 * saying so once in the console when it had to.
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

/** The heartbeat's pace (93): a sweep is a few lookups per mounted bubble, so this is cheap. */
export const CHOICES_HEARTBEAT_MS = 1500

/** What a chat event says about the chat (93): the switch's own id, null for the home screen; the change's chat. */
export function chatOfEvent(event: string, payload: unknown): string | null | undefined {
    const data = payload as { chatId?: unknown; chat?: { id?: unknown } } | undefined
    if (event === 'CHAT_SWITCHED') {
        if (!data || !('chatId' in data)) return undefined
        return typeof data.chatId === 'string' ? data.chatId : null
    }
    if (event === 'CHAT_CHANGED') return typeof data?.chat?.id === 'string' ? data.chat.id : undefined
    return undefined
}

export function mountMessageChoices(bridge: Bridge, host: MessageChoicesHost, options: { heartbeatMs?: number } = {}): MessageChoices {
    let chatId: string | null = null
    let destroyed = false
    /** The wrappers this mount bound a click to, so one the host replays is not bound twice (93). */
    const bound = new WeakSet<Element>()
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

    /** A wrapper standing in the bubble that this module does not hold (93): one the host replayed after a switch away and back. */
    function replayed(element: Element): Element | null {
        const list = element.querySelector('.lh-choices-list')
        return list?.parentElement ?? null
    }

    function bind(messageId: string, wrapper: Element): void {
        if (bound.has(wrapper)) return
        bound.add(wrapper)
        wrapper.addEventListener('click', (event) => { onClick(messageId, event.target) })
    }

    /** Put the buttons under every mounted reply that offered choices. */
    function sweep(reason: 'event' | 'heartbeat' = 'event'): void {
        if (destroyed || !chatId) return
        let redrawn = 0
        for (const { messageId, element } of host.dom.listMessageElements()) {
            if (!choices.has(messageId)) {
                // A reply whose choices went (an edit, a swipe) loses its buttons — one the host replayed too.
                const stale = drawn.get(messageId) ?? replayed(element)
                if (stale) {
                    try { host.dom.uninject(stale) } catch { /* gone already */ }
                    if (stale.isConnected) stale.remove()
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
                // The host replays an injection into a bubble it remounts (its contract); a wrapper it put back
                // is this module's again, not a second one beside it.
                wrapper = replayed(element) ?? host.dom.inject(element, `<div class="${CHOICES_CLASS}"></div>`, 'beforeend')
                bind(messageId, wrapper)
                drawn.set(messageId, wrapper)
                painted.delete(messageId)
                redrawn += 1
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
        if (reason === 'heartbeat' && redrawn > 0) {
            console.debug(`[AdventureTime] choices: the buttons under ${redrawn} ${redrawn === 1 ? 'reply were' : 'replies were'} redrawn by the heartbeat; the host remounted the bubbles without a render event`)
        }
    }

    /**
     * Re-read the chat's choices and redraw. `hint` is what a chat event said
     * (93): a switch's own chat id outranks the host's view, which can lag
     * it; `null` is the host's home screen, which holds what stands. Without
     * one, the host's view, read the same way.
     */
    async function refresh(hint?: string | null): Promise<void> {
        if (destroyed) return
        const next = hint !== undefined ? hint : host.getActiveChat().chatId
        if (next === null) return
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
            host.events.on(event, (payload) => { void refresh(chatOfEvent(event, payload)).catch(() => undefined) }),
        ),
    ]

    // The heartbeat (93): a chat the events missed is read; a bubble the host redrew bare gets its buttons back.
    const heartbeat = setInterval(() => {
        if (destroyed) return
        const live = host.getActiveChat().chatId
        if (live && live !== chatId) void refresh(live).catch(() => undefined)
        else sweep('heartbeat')
    }, options.heartbeatMs ?? CHOICES_HEARTBEAT_MS)

    void refresh().catch(() => undefined)

    return {
        refresh: () => refresh(),
        destroy(): void {
            destroyed = true
            if (pending) clearTimeout(pending)
            clearInterval(heartbeat)
            for (const off of unsubscribeHost) off()
            clear()
        },
    }
}
