// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Bridge } from './bridge.js'
import { mountMessageCards, renderMessageCard, type MessageCardsHost } from './message-cards.js'
import { CHANNEL, isRequest, type EventMessage, type MemoSnapshotDTO, type RequestMessage } from '../protocol.js'

const MEMO = ['[TIME]', '09:30 PM, Day 4', '[/TIME]', '[XP]', '450/1000 Level 3', '[/XP]'].join('\n')
const LATER = ['[TIME]', '11:00 PM, Day 4', '[/TIME]', '[XP]', '900/1000 Level 3', '[/XP]'].join('\n')

const snap = (messageId: string, memo = MEMO, at = '2026-08-30T00:00:00.000Z'): MemoSnapshotDTO => ({
    messageId,
    memo,
    at,
})

/** A bridge wired to a fake backend that serves one history per chat. */
function makeBridge(
    seed: Record<string, MemoSnapshotDTO[]> = {},
    messageCards = true,
    portraits: Record<string, string> = {},
    bars: Record<string, { color?: string; showAsPercentage?: boolean }> = {},
    /** The cartridge `settings.get` answers with (74c-bis). */
    settings: Record<string, unknown> = {},
) {
    const histories = new Map(Object.entries(seed))
    const requests: RequestMessage[] = []
    let deliver: ((payload: unknown) => void) | null = null
    let cardsOn = messageCards

    const bridge = new Bridge({
        sendToBackend(payload: unknown): void {
            if (!isRequest(payload)) return
            requests.push(payload)
            const chatId = String(payload.params?.chatId ?? '')
            const data =
                payload.op === 'prefs.get'
                    ? { prefs: { messageCards: cardsOn, bars } }
                    : payload.op === 'prefs.patch'
                      ? { prefs: { bars: Object.assign(bars, (payload.params?.patch as { bars?: Record<string, never> })?.bars ?? {}) } }
                    : payload.op === 'portraits.get'
                      ? { portraits }
                      : payload.op === 'settings.get'
                        ? { settings }
                        : { snapshots: histories.get(chatId) ?? [] }
            queueMicrotask(() => {
                deliver?.({ channel: CHANNEL, kind: 'response', id: payload.id, ok: true, data })
            })
        },
        onBackendMessage(handler: (payload: unknown) => void): () => void {
            deliver = handler
            return () => {}
        },
    })

    const emit = (event: Omit<EventMessage, 'channel' | 'kind'>): void => {
        deliver?.({ channel: CHANNEL, kind: 'event', ...event })
    }

    return {
        bridge,
        requests,
        emit,
        setHistory: (chatId: string, s: MemoSnapshotDTO[]) => histories.set(chatId, s),
        setCardsOn: (on: boolean) => { cardsOn = on },
    }
}

/**
 * A fake chat: message bubbles in a page, and the host DOM helper over them.
 *
 * `inject` mimics the real contract closely enough to matter — it returns a
 * wrapper element whose identity the module is entitled to hold on to.
 */
function makeHost(chatId: string | null = 'chat-1') {
    const listeners = new Map<string, Set<(payload?: unknown) => void>>()
    const bubbles = new Map<string, Element>()
    let active = chatId

    const chat = document.createElement('div')
    document.body.append(chat)

    const addMessage = (messageId: string): Element => {
        const bubble = document.createElement('div')
        bubble.setAttribute('data-message', messageId)
        chat.append(bubble)
        bubbles.set(messageId, bubble)
        return bubble
    }

    const host: MessageCardsHost = {
        dom: {
            listMessageElements: () => Array.from(bubbles, ([messageId, element]) => ({ messageId, element })),
            inject(target, html, position = 'beforeend'): Element {
                const wrapper = document.createElement('div')
                wrapper.innerHTML = html
                const injected = wrapper.firstElementChild as Element
                ;(target as Element).insertAdjacentElement(position, injected)
                return injected
            },
            uninject(element): void {
                element.remove()
            },
        },
        events: {
            on(event, handler): () => void {
                const set = listeners.get(event) ?? new Set()
                set.add(handler)
                listeners.set(event, set)
                return () => set.delete(handler)
            },
        },
        getActiveChat: () => ({ chatId: active, characterId: null }),
    }

    return {
        host,
        addMessage,
        /** Drop a bubble from the DOM without telling anyone, as the virtualizer does. */
        unmount: (messageId: string) => { bubbles.get(messageId)?.remove() },
        remove: (messageId: string) => { bubbles.get(messageId)?.remove(); bubbles.delete(messageId) },
        setChat: (next: string | null) => { active = next },
        fire: (event: string) => { for (const handler of listeners.get(event) ?? []) handler() },
    }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const cards = () => Array.from(document.querySelectorAll('.lh-msg-card'))
const cardFor = (messageId: string) =>
    document.querySelector(`[data-message="${messageId}"] .lh-msg-card`) as HTMLElement | null
const headerFor = (messageId: string) =>
    cardFor(messageId)?.querySelector('.lh-msg-card-header') as HTMLElement | undefined

beforeEach(() => {
    document.body.replaceChildren()
})

describe('drawing one card', () => {
    it('summarises the memo in a header and folds the detail away', () => {
        const html = renderMessageCard(snap('m1'), {}, false)
        expect(html).toContain('09:30 PM, Day 4 · XP')
        expect(html).toContain('aria-expanded="false"')
        expect(html).toContain('hidden')
    })

    it('draws the same cards the panel does when opened', () => {
        const html = renderMessageCard(snap('m1'), {}, true)
        expect(html).toContain('rt-section')
        expect(html).toContain('450/1000')
        expect(html).toContain('aria-expanded="true"')
    })

    it('marks the card as the tracker’s for the font size (74e), on the inner box the host leaves alone', () => {
        const html = renderMessageCard(snap('m1'), {}, false)
        expect(html).toMatch(/^<div class="lh-msg-card-inner lh-size-tracker[" ]/)
    })

    it('says so rather than offering an empty fold', () => {
        // A pass ran and the memo was empty. There is nothing to open.
        expect(renderMessageCard(snap('m1', ''), {}, false)).toContain('No tracker state after this message')
    })

    it('escapes what the model wrote into the summary', () => {
        const html = renderMessageCard(snap('m1', '[TIME]\n<img src=x onerror=alert(1)>\n[/TIME]'), {}, false)
        expect(html).not.toContain('<img src=x')
        expect(html).toContain('&lt;img')
    })
})

describe('hanging cards under the messages', () => {
    it('draws one under every message that has a snapshot', async () => {
        const { bridge } = makeBridge({ 'chat-1': [snap('m1'), snap('m2', LATER)] })
        const host = makeHost()
        host.addMessage('m1')
        host.addMessage('m2')

        mountMessageCards(bridge, host.host)
        await settle()

        expect(cards()).toHaveLength(2)
        expect(cardFor('m2')!.textContent).toContain('11:00 PM, Day 4')
    })

    it('leaves a message with no snapshot bare', async () => {
        // Older messages, and anything from before the history existed. A card
        // that said nothing would be worse than no card.
        const { bridge } = makeBridge({ 'chat-1': [snap('m2')] })
        const host = makeHost()
        host.addMessage('m1')
        host.addMessage('m2')

        mountMessageCards(bridge, host.host)
        await settle()

        expect(cardFor('m1')).toBeNull()
        expect(cardFor('m2')).not.toBeNull()
    })

    it('draws nothing at all with no chat open', async () => {
        const { bridge, requests } = makeBridge()
        const host = makeHost(null)
        host.addMessage('m1')

        mountMessageCards(bridge, host.host)
        await settle()

        expect(requests.some((r) => r.op === 'tracker.history')).toBe(false)
        expect(cards()).toHaveLength(0)
    })

    it('picks up bubbles the virtualizer mounts later', async () => {
        // The chat list only renders what is near the viewport, so scrolling
        // back is the normal way an old message first appears.
        const { bridge } = makeBridge({ 'chat-1': [snap('m1'), snap('m2')] })
        const host = makeHost()
        host.addMessage('m1')

        mountMessageCards(bridge, host.host)
        await settle()
        expect(cards()).toHaveLength(1)

        host.addMessage('m2')
        host.fire('CHARACTER_MESSAGE_RENDERED')
        expect(cards()).toHaveLength(2)
    })

    it('does not draw a second card on a message that already has one', async () => {
        const { bridge } = makeBridge({ 'chat-1': [snap('m1')] })
        const host = makeHost()
        host.addMessage('m1')

        mountMessageCards(bridge, host.host)
        await settle()

        host.fire('CHARACTER_MESSAGE_RENDERED')
        host.fire('USER_MESSAGE_RENDERED')
        expect(cards()).toHaveLength(1)
    })

    it('re-injects when the host drops a card without replaying it', async () => {
        const { bridge } = makeBridge({ 'chat-1': [snap('m1')] })
        const host = makeHost()
        const bubble = host.addMessage('m1')

        mountMessageCards(bridge, host.host)
        await settle()

        bubble.replaceChildren()
        expect(cardFor('m1')).toBeNull()

        host.fire('CHARACTER_MESSAGE_RENDERED')
        expect(cardFor('m1')).not.toBeNull()
    })
})

describe('following the pass', () => {
    it('updates a message card when its pass finishes', async () => {
        // The event carries the memo and the message it was for, which is
        // exactly what the backend stored — no round trip needed.
        const { bridge, emit } = makeBridge({ 'chat-1': [] })
        const host = makeHost()
        host.addMessage('m9')

        mountMessageCards(bridge, host.host)
        await settle()
        expect(cardFor('m9')).toBeNull()

        emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: LATER, messageId: 'm9' } })
        expect(cardFor('m9')!.textContent).toContain('11:00 PM, Day 4')
    })

    it('redraws a card whose message was re-tracked', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': [snap('m9')] })
        const host = makeHost()
        host.addMessage('m9')

        mountMessageCards(bridge, host.host)
        await settle()
        expect(cardFor('m9')!.textContent).toContain('09:30 PM')

        emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: LATER, messageId: 'm9' } })
        expect(cardFor('m9')!.textContent).toContain('11:00 PM')
    })

    it('ignores a pass for another chat', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': [] })
        const host = makeHost()
        host.addMessage('m9')

        mountMessageCards(bridge, host.host)
        await settle()

        emit({ name: 'tracker.changed', data: { chatId: 'chat-2', memo: LATER, messageId: 'm9' } })
        expect(cardFor('m9')).toBeNull()
    })

    it('ignores a manual pass, which belongs to no message', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': [] })
        const host = makeHost()
        host.addMessage('m9')

        mountMessageCards(bridge, host.host)
        await settle()

        emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: LATER } })
        expect(cardFor('m9')).toBeNull()
    })
})

describe('opening a card', () => {
    it('unfolds on a click and folds back', async () => {
        const { bridge } = makeBridge({ 'chat-1': [snap('m1')] })
        const host = makeHost()
        host.addMessage('m1')

        mountMessageCards(bridge, host.host)
        await settle()

        expect(cardFor('m1')!.querySelector('.lh-msg-card-body')!.hasAttribute('hidden')).toBe(true)
        headerFor('m1')!.click()
        expect(cardFor('m1')!.querySelector('.lh-msg-card-body')!.hasAttribute('hidden')).toBe(false)
        headerFor('m1')!.click()
        expect(cardFor('m1')!.querySelector('.lh-msg-card-body')!.hasAttribute('hidden')).toBe(true)
    })

    it('answers the keyboard, since the header claims to be a button', async () => {
        const { bridge } = makeBridge({ 'chat-1': [snap('m1')] })
        const host = makeHost()
        host.addMessage('m1')

        mountMessageCards(bridge, host.host)
        await settle()

        headerFor('m1')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        expect(cardFor('m1')!.querySelector('.lh-msg-card-body')!.hasAttribute('hidden')).toBe(false)
    })

    it('opens one card without opening the rest', async () => {
        // Checking what the party had at one point should not unfold thirty
        // other cards as they scroll past.
        const { bridge } = makeBridge({ 'chat-1': [snap('m1'), snap('m2')] })
        const host = makeHost()
        host.addMessage('m1')
        host.addMessage('m2')

        mountMessageCards(bridge, host.host)
        await settle()

        headerFor('m1')!.click()
        expect(cardFor('m1')!.querySelector('.lh-msg-card-body')!.hasAttribute('hidden')).toBe(false)
        expect(cardFor('m2')!.querySelector('.lh-msg-card-body')!.hasAttribute('hidden')).toBe(true)
    })

    it('stays open when its own pass redraws it', async () => {
        // A card the user opened is a card they are reading.
        const { bridge, emit } = makeBridge({ 'chat-1': [snap('m1')] })
        const host = makeHost()
        host.addMessage('m1')

        mountMessageCards(bridge, host.host)
        await settle()
        headerFor('m1')!.click()

        emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: LATER, messageId: 'm1' } })

        expect(cardFor('m1')!.querySelector('.lh-msg-card-body')!.hasAttribute('hidden')).toBe(false)
        expect(cardFor('m1')!.textContent).toContain('11:00 PM')
    })

    it('ignores a click on the card body', async () => {
        const { bridge } = makeBridge({ 'chat-1': [snap('m1')] })
        const host = makeHost()
        host.addMessage('m1')

        mountMessageCards(bridge, host.host)
        await settle()
        headerFor('m1')!.click()

        ;(cardFor('m1')!.querySelector('.rt-section-title') as HTMLElement).click()
        expect(cardFor('m1')!.querySelector('.lh-msg-card-body')!.hasAttribute('hidden')).toBe(false)
    })
})

describe('the sections inside an open card', () => {
    const section = (id: string, tag: string) => cardFor(id)!.querySelector(`.rt-section[data-tag="${tag}"]`) as HTMLElement
    const sectionHeader = (id: string, tag: string) => section(id, tag).querySelector('.rt-section-header') as HTMLElement
    const folded = (id: string, tag: string) => section(id, tag).classList.contains('rt-section--collapsed')

    it('starts every section folded, since an open card is a glance', async () => {
        const { bridge } = makeBridge({ 'chat-1': [snap('m1')] })
        const host = makeHost()
        host.addMessage('m1')

        mountMessageCards(bridge, host.host)
        await settle()
        headerFor('m1')!.click()

        expect(folded('m1', 'TIME')).toBe(true)
        expect(folded('m1', 'XP')).toBe(true)
        expect(section('m1', 'TIME').querySelector('.rt-section-body')!.hasAttribute('hidden')).toBe(true)
    })

    it('opens a section on its header and folds it back', async () => {
        const { bridge } = makeBridge({ 'chat-1': [snap('m1')] })
        const host = makeHost()
        host.addMessage('m1')

        mountMessageCards(bridge, host.host)
        await settle()
        headerFor('m1')!.click()

        sectionHeader('m1', 'TIME').click()
        expect(folded('m1', 'TIME')).toBe(false)
        expect(section('m1', 'TIME').querySelector('.rt-section-body')!.hasAttribute('hidden')).toBe(false)
        // The other section stays as it was, and the card stays open.
        expect(folded('m1', 'XP')).toBe(true)
        expect(cardFor('m1')!.querySelector('.lh-msg-card-body')!.hasAttribute('hidden')).toBe(false)

        sectionHeader('m1', 'TIME').click()
        expect(folded('m1', 'TIME')).toBe(true)
    })

    it('answers the keyboard on a section header too', async () => {
        const { bridge } = makeBridge({ 'chat-1': [snap('m1')] })
        const host = makeHost()
        host.addMessage('m1')

        mountMessageCards(bridge, host.host)
        await settle()
        headerFor('m1')!.click()

        sectionHeader('m1', 'XP').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
        expect(folded('m1', 'XP')).toBe(false)
    })

    it('opens a section in one card without opening it in the rest', async () => {
        const { bridge } = makeBridge({ 'chat-1': [snap('m1'), snap('m2')] })
        const host = makeHost()
        host.addMessage('m1')
        host.addMessage('m2')

        mountMessageCards(bridge, host.host)
        await settle()
        headerFor('m1')!.click()
        headerFor('m2')!.click()

        sectionHeader('m1', 'TIME').click()
        expect(folded('m1', 'TIME')).toBe(false)
        expect(folded('m2', 'TIME')).toBe(true)
    })

    it('keeps an opened section open when its own pass redraws the card', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': [snap('m1')] })
        const host = makeHost()
        host.addMessage('m1')

        mountMessageCards(bridge, host.host)
        await settle()
        headerFor('m1')!.click()
        sectionHeader('m1', 'TIME').click()

        emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: LATER, messageId: 'm1' } })

        expect(folded('m1', 'TIME')).toBe(false)
        expect(section('m1', 'TIME').textContent).toContain('11:00 PM')
    })

    it('forgets the opened sections on a chat switch, as it forgets the opened cards', async () => {
        // A fork keeps its message ids: the PARTY opened under m1 in one chat
        // must not come up open under m1 in the other.
        const { bridge } = makeBridge({ 'chat-1': [snap('m1')], 'chat-2': [snap('m1', LATER)] })
        const host = makeHost()
        host.addMessage('m1')

        mountMessageCards(bridge, host.host)
        await settle()
        headerFor('m1')!.click()
        sectionHeader('m1', 'TIME').click()
        expect(folded('m1', 'TIME')).toBe(false)

        host.remove('m1')
        host.setChat('chat-2')
        host.addMessage('m1')
        host.fire('CHAT_SWITCHED')
        await settle()
        headerFor('m1')!.click()

        expect(folded('m1', 'TIME')).toBe(true)
    })

    it('draws every section folded when asked for the card alone', () => {
        const html = renderMessageCard(snap('m1'), {}, true)
        expect(html).toContain('rt-section rt-section--collapsed')
        expect(html).not.toMatch(/class="rt-section" /)
        const open = renderMessageCard(snap('m1'), {}, true, new Set(['TIME']))
        expect(open).toContain('data-tag="TIME"')
        expect(open).toMatch(/class="rt-section" data-tag="TIME"/)
    })
})

describe('following the user between chats', () => {
    it('takes the old chat cards down and draws the new chat', async () => {
        const { bridge } = makeBridge({ 'chat-1': [snap('m1')], 'chat-2': [snap('n1', LATER)] })
        const host = makeHost()
        host.addMessage('m1')

        const panel = mountMessageCards(bridge, host.host)
        await settle()
        expect(cardFor('m1')).not.toBeNull()

        host.remove('m1')
        host.setChat('chat-2')
        host.addMessage('n1')
        host.fire('CHAT_SWITCHED')
        await settle()

        expect(cardFor('n1')!.textContent).toContain('11:00 PM, Day 4')
    })

    it('never hangs one campaign state under another chat messages', async () => {
        // The read is asynchronous and the user can switch chats while it is in
        // flight. The late answer must not paint: it belongs to a campaign that
        // is no longer on screen. Same guard as the panel, same reason.
        const { bridge } = makeBridge({ 'chat-1': [snap('m1')], 'chat-2': [] })
        const host = makeHost()
        host.addMessage('m1')

        const panel = mountMessageCards(bridge, host.host)
        const inFlight = panel.refresh()

        // The switch lands while chat-1's history is still on its way back.
        host.setChat('chat-2')
        host.fire('CHAT_SWITCHED')

        await inFlight
        await settle()

        expect(cardFor('m1')).toBeNull()
    })

    it('draws nothing after it is destroyed', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': [snap('m1')] })
        const host = makeHost()
        host.addMessage('m1')

        const panel = mountMessageCards(bridge, host.host)
        await settle()
        panel.destroy()

        expect(cards()).toHaveLength(0)
        expect(() =>
            emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: LATER, messageId: 'm1' } }),
        ).not.toThrow()
        expect(cards()).toHaveLength(0)
    })

    it('draws a custom field’s label and icon from the cartridge it asks for on mount, and follows every cartridge write (74c-bis)', async () => {
        const { bridge, requests, emit } = makeBridge({ 'chat-1': [snap('m1', '[HORSE_CARE_XP]\nStatus: Novice\n[/HORSE_CARE_XP]')] }, true, {}, {}, { customFields: [{ tag: 'HORSE_CARE_XP', label: 'Horse Care XP', icon: '🐴' }] })
        const host = makeHost()
        host.addMessage('m1')

        mountMessageCards(bridge, host.host)
        await settle()
        // The cartridge is asked for once, after the preferences and before the first draw.
        expect(requests.map((r) => r.op).filter((op) => op === 'settings.get')).toHaveLength(1)
        expect(requests.findIndex((r) => r.op === 'settings.get')).toBeGreaterThan(requests.findIndex((r) => r.op === 'prefs.get'))
        const card = cardFor('m1')!
        expect(card.querySelector('.rt-section-title')!.textContent).toBe('Horse Care XP')
        expect(card.querySelector('.rt-section-icon')!.textContent).toBe('🐴')
        expect(card.textContent).not.toContain('HORSE_CARE_XP')

        // The event every cartridge write sends redraws the card with the new name.
        emit({ name: 'settings.changed', data: { settings: { customFields: [{ tag: 'HORSE_CARE_XP', label: 'Stable Craft', icon: '🏇' }] } } })
        expect(cardFor('m1')!.querySelector('.rt-section-title')!.textContent).toBe('Stable Craft')
        expect(cardFor('m1')!.querySelector('.rt-section-icon')!.textContent).toBe('🏇')
    })

    it('redraws with new settings when the user changes them', async () => {
        const { bridge } = makeBridge({ 'chat-1': [snap('m1', '[WAYSTONE]\nAttunement: 640/1000\n[/WAYSTONE]')] })
        const host = makeHost()
        host.addMessage('m1')

        const panel = mountMessageCards(bridge, host.host)
        await settle()
        expect(cardFor('m1')!.textContent).toContain('WAYSTONE')

        panel.setSettings({ customFields: [{ tag: 'WAYSTONE', label: 'Waystone' }] })
        expect(cardFor('m1')!.textContent).toContain('Waystone')
    })

    it('does not repaint a card nothing changed for', async () => {
        // Every sweep runs over every mounted bubble, and there is one on each
        // rendered message. Rebuilding untouched markup would throw away the
        // browser's own work for nothing.
        const { bridge } = makeBridge({ 'chat-1': [snap('m1')] })
        const host = makeHost()
        host.addMessage('m1')

        mountMessageCards(bridge, host.host)
        await settle()

        const before = cardFor('m1')!.firstElementChild
        host.fire('CHARACTER_MESSAGE_RENDERED')
        expect(cardFor('m1')!.firstElementChild).toBe(before)
    })
})

describe('the on/off switch', () => {
    it('draws nothing when the user has them switched off', async () => {
        const { bridge, requests } = makeBridge({ 'chat-1': [snap('m1')] }, false)
        const host = makeHost()
        host.addMessage('m1')

        mountMessageCards(bridge, host.host)
        await settle()

        expect(cards()).toHaveLength(0)
        // And does not read a history it has no use for.
        expect(requests.some((r) => r.op === 'tracker.history')).toBe(false)
    })

    it('takes them down the moment they are switched off', async () => {
        // Leaving them until the next reload would make the switch look broken.
        const { bridge, emit } = makeBridge({ 'chat-1': [snap('m1')] })
        const host = makeHost()
        host.addMessage('m1')

        mountMessageCards(bridge, host.host)
        await settle()
        expect(cards()).toHaveLength(1)

        emit({ name: 'prefs.changed', data: { prefs: { messageCards: false } } })
        expect(cards()).toHaveLength(0)
    })

    it('draws none while the preference is absent: off as it ships since 82', async () => {
        // The harness's default is on; null stands for a record without the key.
        const { bridge } = makeBridge({ 'chat-1': [snap('m1')] }, null as unknown as boolean)
        const host = makeHost()
        host.addMessage('m1')

        mountMessageCards(bridge, host.host)
        await settle()
        expect(cards()).toHaveLength(0)
    })

    it('puts them back when they are switched on again', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': [snap('m1')] }, false)
        const host = makeHost()
        host.addMessage('m1')

        mountMessageCards(bridge, host.host)
        await settle()
        expect(cards()).toHaveLength(0)

        emit({ name: 'prefs.changed', data: { prefs: { messageCards: true } } })
        await settle()
        expect(cards()).toHaveLength(1)
    })

    it('stays off while it is off, whatever the tracker does', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': [] }, false)
        const host = makeHost()
        host.addMessage('m9')

        mountMessageCards(bridge, host.host)
        await settle()

        emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: LATER, messageId: 'm9' } })
        host.fire('CHARACTER_MESSAGE_RENDERED')
        expect(cards()).toHaveLength(0)
    })

    it('does not let a pass put cards back after they are switched off', async () => {
        // The chat is open and known, so the pass event passes its chat check —
        // the switch is the only thing standing between it and a card. Switching
        // off before mounting takes a different path entirely, which is why this
        // one needs its own test.
        const { bridge, emit } = makeBridge({ 'chat-1': [snap('m1')] })
        const host = makeHost()
        host.addMessage('m1')
        host.addMessage('m9')

        mountMessageCards(bridge, host.host)
        await settle()
        expect(cards()).toHaveLength(1)

        emit({ name: 'prefs.changed', data: { prefs: { messageCards: false } } })
        expect(cards()).toHaveLength(0)

        emit({ name: 'tracker.changed', data: { chatId: 'chat-1', memo: LATER, messageId: 'm9' } })
        host.fire('CHARACTER_MESSAGE_RENDERED')
        expect(cards()).toHaveLength(0)
    })

    it('draws them when the backend has no preference store at all', async () => {
        // An older backend answers nothing useful; the cards are the default.
        const { bridge } = makeBridge({ 'chat-1': [snap('m1')] })
        vi.spyOn(bridge, 'request').mockImplementation(async (op: string, params?: unknown) => {
            if (op === 'prefs.get') throw new Error('unknown op')
            return { snapshots: [snap('m1')] } as never
        })
        const host = makeHost()
        host.addMessage('m1')

        mountMessageCards(bridge, host.host)
        await settle()

        expect(cards()).toHaveLength(1)
    })
})

describe('portraits on the cards under messages', () => {
    const COMBAT = ['[TIME]', '09:30 PM, Day 2', '[/TIME]', '[COMBAT]', 'ENEMIES:', 'Moth Wraith ((BAR)) 10/10', '[/COMBAT]'].join('\n')

    const portraitIn = (messageId: string) =>
        document.querySelector(`[data-message="${messageId}"] .rt-entity-portrait`) as HTMLImageElement | null

    it('draws the chat portraits inside an opened card', async () => {
        // The same renderer as the panel, so this comes free — as long as the
        // map reaches it.
        const { bridge } = makeBridge({ 'chat-1': [snap('m1', COMBAT)] }, true, { 'Moth Wraith': '/rat.png' })
        const host = makeHost()
        host.addMessage('m1')

        mountMessageCards(bridge, host.host)
        await settle()
        headerFor('m1')!.click()

        expect(portraitIn('m1')!.getAttribute('src')).toBe('/rat.png')
    })

    it('opens the portrait large on a click when the host has a modal, and leaves the card as it was (Phase 64)', async () => {
        const { bridge, requests } = makeBridge({ 'chat-1': [snap('m1', COMBAT)] }, true, { 'Moth Wraith': '/rat.png' })
        const host = makeHost()
        host.addMessage('m1')
        const shown: Array<{ title: string; root: HTMLElement }> = []
        const ui = { showModal: (options: { title: string }) => { const root = document.createElement('div'); shown.push({ title: options.title, root }); return { root, dismiss: () => undefined } } }

        mountMessageCards(bridge, { ...host.host, ui })
        await settle()
        headerFor('m1')!.click()
        const portrait = portraitIn('m1')!
        expect(portrait.getAttribute('data-lh-large')).toBe('Moth Wraith')
        portrait.click()

        expect(shown).toHaveLength(1)
        expect(shown[0]!.title).toBe('Moth Wraith')
        expect(shown[0]!.root.querySelector('img.lh-large')?.getAttribute('src')).toBe('/rat.png')
        // The card is still open: the click was the picture's, not the header's.
        expect(portraitIn('m1')).not.toBeNull()
        // The portrait's buttons under it (80): the file greyed without a picker, the draw, and Remove since one is stored.
        const buttons = Array.from(shown[0]!.root.querySelectorAll('.lh-large-actions button')) as HTMLButtonElement[]
        expect(buttons.map((b) => [b.getAttribute('data-lh-field'), b.disabled])).toEqual([['large-set', true], ['large-draw', false], ['large-remove', false]])
        expect(shown[0]!.root.querySelector('.lh-large-note')!.textContent).toContain('no file picker')
        buttons[2]!.click()
        await settle()
        expect(requests.at(-1)).toMatchObject({ op: 'portraits.set', params: { chatId: 'chat-1', name: 'Moth Wraith', src: '' } })
    })

    it('offers the file button under the large view when the host has a picker (80), and sends the picked file through the upload', async () => {
        const { bridge, requests } = makeBridge({ 'chat-1': [snap('m1', COMBAT)] }, true, { 'Moth Wraith': '/rat.png' })
        const host = makeHost()
        host.addMessage('m1')
        const shown: Array<{ root: HTMLElement }> = []
        const ui = { showModal: () => { const root = document.createElement('div'); shown.push({ root }); return { root, dismiss: () => undefined } } }
        const uploads = { pickFile: async () => [{ name: 'rat.png', bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }] }
        mountMessageCards(bridge, { ...host.host, ui, uploads })
        await settle()
        headerFor('m1')!.click()
        portraitIn('m1')!.click()
        const set = shown[0]!.root.querySelector('[data-lh-field="large-set"]') as HTMLButtonElement
        expect(set.disabled).toBe(false)
        expect(shown[0]!.root.querySelector('.lh-large-note')).toBeNull()
        set.click()
        await settle()
        await settle()
        expect(requests.at(-1)).toMatchObject({ op: 'portraits.upload', params: { chatId: 'chat-1', name: 'Moth Wraith', filename: 'rat.png' } })
    })

    it('does nothing on a portrait click when the host has no modal', async () => {
        const { bridge } = makeBridge({ 'chat-1': [snap('m1', COMBAT)] }, true, { 'Moth Wraith': '/rat.png' })
        const host = makeHost()
        host.addMessage('m1')
        mountMessageCards(bridge, host.host)
        await settle()
        headerFor('m1')!.click()
        portraitIn('m1')!.click()
        expect(portraitIn('m1')).not.toBeNull()
    })

    it('repaints when a portrait changes, though no memo did', async () => {
        // The card's own state did not move, so without the portrait map in the
        // paint key nothing would redraw and the picture would appear only after
        // the next reply.
        const { bridge, emit } = makeBridge({ 'chat-1': [snap('m1', COMBAT)] })
        const host = makeHost()
        host.addMessage('m1')

        mountMessageCards(bridge, host.host)
        await settle()
        headerFor('m1')!.click()
        expect(portraitIn('m1')).toBeNull()

        emit({ name: 'portraits.changed', data: { chatId: 'chat-1', portraits: { 'Moth Wraith': '/rat.png' } } })
        expect(portraitIn('m1')!.getAttribute('src')).toBe('/rat.png')
    })

    it('ignores a portrait change in another chat', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': [snap('m1', COMBAT)] })
        const host = makeHost()
        host.addMessage('m1')

        mountMessageCards(bridge, host.host)
        await settle()
        headerFor('m1')!.click()

        emit({ name: 'portraits.changed', data: { chatId: 'chat-2', portraits: { 'Moth Wraith': '/rat.png' } } })
        expect(portraitIn('m1')).toBeNull()
    })

    it('draws cards as usual when the portraits cannot be read', async () => {
        const { bridge } = makeBridge({ 'chat-1': [snap('m1', COMBAT)] })
        vi.spyOn(bridge, 'request').mockImplementation(async (op: string) => {
            if (op === 'portraits.get') throw new Error('disk gone')
            if (op === 'prefs.get') return { prefs: { messageCards: true } } as never
            return { snapshots: [snap('m1', COMBAT)] } as never
        })
        const host = makeHost()
        host.addMessage('m1')

        mountMessageCards(bridge, host.host)
        await settle()

        expect(cards()).toHaveLength(1)
    })
})

describe('bar preferences on the cards under messages', () => {
    const BAR_MEMO = ['[TIME]', '09:30 PM, Day 2', '[/TIME]', '[WAYSTONE]', 'Attunement: ((BAR)) 640/1000', '[/WAYSTONE]'].join('\n')
    const BAR_ID = 'WAYSTONE::Attunement[L0]'

    const bodyText = (messageId: string) =>
        document.querySelector(`[data-message="${messageId}"] .lh-msg-card-body`)?.textContent ?? ''

    it('applies them, as the panel does', async () => {
        const { bridge } = makeBridge({ 'chat-1': [snap('m1', BAR_MEMO)] }, true, {}, { [BAR_ID]: { showAsPercentage: true } })
        const host = makeHost()
        host.addMessage('m1')

        mountMessageCards(bridge, host.host)
        await settle()
        headerFor('m1')!.click()

        expect(bodyText('m1')).toContain('64%')
    })

    it('repaints when a bar changes, though no memo did', async () => {
        // The colour is picked in the panel; without the bar map in the paint
        // key the card under a message would keep the old one until the next
        // reply.
        const { bridge, emit } = makeBridge({ 'chat-1': [snap('m1', BAR_MEMO)] })
        const host = makeHost()
        host.addMessage('m1')

        mountMessageCards(bridge, host.host)
        await settle()
        headerFor('m1')!.click()
        expect(bodyText('m1')).toContain('640/1000')

        emit({ name: 'prefs.changed', data: { prefs: { messageCards: true, bars: { [BAR_ID]: { showAsPercentage: true } } } } })
        expect(bodyText('m1')).toContain('64%')
    })

    it('opens Multihog’s Bar Settings on a click on a card’s bar, as its per-message cards do (74i-ter), without folding the card', async () => {
        const { bridge, requests } = makeBridge({ 'chat-1': [snap('m1', BAR_MEMO)] })
        const host = makeHost()
        host.addMessage('m1')
        mountMessageCards(bridge, host.host)
        await settle()
        headerFor('m1')!.click()
        const bar = document.querySelector(`[data-message="m1"] [data-recolor-id="${BAR_ID}"]`) as HTMLElement
        expect(bar.title).toBe('Click to recolor')
        bar.click()
        const popup = document.getElementById('rt-recolor-popup')
        expect(popup).not.toBeNull()
        expect(popup!.textContent).toContain('Bar Settings')
        expect(bodyText('m1')).toContain('640/1000')
        const tick = popup!.querySelector('#show-as-percentage') as HTMLInputElement
        tick.checked = true
        tick.dispatchEvent(new Event('change'))
        await settle()
        expect(bodyText('m1')).toContain('64%')
        const patch = requests.find((r) => r.op === 'prefs.patch')
        expect(patch?.params).toMatchObject({ patch: { bars: { [BAR_ID]: { showAsPercentage: true } } } })
        ;(popup!.querySelector('#recolor-ok') as HTMLButtonElement).click()
        expect(document.getElementById('rt-recolor-popup')).toBeNull()
    })

    it('opens the box on the store’s config, seeded or arriving on prefs.changed, not a stale map (74i-ter)', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': [snap('m1', BAR_MEMO)] }, true, {}, { [BAR_ID]: { showAsPercentage: true } })
        const host = makeHost()
        host.addMessage('m1')
        mountMessageCards(bridge, host.host)
        await settle()
        headerFor('m1')!.click()
        const bar = () => document.querySelector(`[data-message="m1"] [data-recolor-id="${BAR_ID}"]`) as HTMLElement
        bar().click()
        expect((document.getElementById('rt-recolor-popup')!.querySelector('#show-as-percentage') as HTMLInputElement).checked).toBe(true)
        ;(document.getElementById('rt-recolor-popup')!.querySelector('#recolor-cancel') as HTMLButtonElement).click()
        emit({ name: 'prefs.changed', data: { prefs: { messageCards: true, bars: { [BAR_ID]: { mode: 'solid', color: '#abcdef' } } } } })
        await settle()
        expect(bodyText('m1')).toContain('640/1000')
        bar().click()
        const box = document.getElementById('rt-recolor-popup')!
        expect((box.querySelector('#show-as-percentage') as HTMLInputElement).checked).toBe(false)
        expect((box.querySelector('#color1') as HTMLInputElement).value).toBe('#abcdef')
        ;(box.querySelector('#recolor-cancel') as HTMLButtonElement).click()
    })
})

describe('the Display Groups under the messages (75)', () => {
    const GROUP_MEMO = ['[TIME]', '09:30 PM, Day 2', '[/TIME]', '[ALPHA_STANDING]', 'Alpha Standing: ((BARRED)) 50/100', '[/ALPHA_STANDING]', '[VEHICLE_FUEL]', 'Vehicle Fuel: ((BARRED)) 1000/1000', '[/VEHICLE_FUEL]'].join('\n')
    const group = { id: 'vehicle_systems', name: 'Vehicle Systems', icon: '🚙', enabled: true, members: ['ALPHA_STANDING', 'VEHICLE_FUEL'] }
    const body = (messageId: string) => document.querySelector(`[data-message="${messageId}"] .lh-msg-card-body`) as HTMLElement

    it('draws the same groups the panel does, from the preferences as they arrive, and repaints when they change', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': [snap('m1', GROUP_MEMO)] })
        const host = makeHost()
        host.addMessage('m1')
        mountMessageCards(bridge, host.host)
        await settle()
        headerFor('m1')!.click()
        expect(body('m1').querySelector('.rt-display-group-card')).toBeNull()
        emit({ name: 'prefs.changed', data: { prefs: { messageCards: true, displayGroupsEnabled: true, displayGroups: [group] } } })
        const card = body('m1').querySelector('.rt-display-group-card')!
        expect(card.getAttribute('data-tag')).toBe('DISPLAY_GROUP_vehicle_systems')
        expect(card.querySelectorAll('.rt-display-group-member')).toHaveLength(2)
        expect(card.querySelector('.rt-display-group-body--seamless')).not.toBeNull()
        expect(body('m1').querySelector('[data-tag="ALPHA_STANDING"]')).toBeNull()
        emit({ name: 'prefs.changed', data: { prefs: { messageCards: true, displayGroupsShowGaps: true } } })
        expect(body('m1').querySelector('.rt-display-group-body--seamless')).toBeNull()
        emit({ name: 'prefs.changed', data: { prefs: { messageCards: true, displayGroupsEnabled: false } } })
        expect(body('m1').querySelector('.rt-display-group-card')).toBeNull()
        expect(body('m1').querySelector('[data-tag="ALPHA_STANDING"]')).not.toBeNull()
    })
})

describe('the PARTY compact mode under the messages (47e-ter)', () => {
    const PARTY = { messageId: 'm1', memo: '[PARTY]\nElara (Ranger): 26/45 HP\nSkills: Athletics +3\n[/PARTY]', at: '2026-10-10T20:00:00Z' }

    it('follows the preference from the event, repainting the card, and never draws the button', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': [PARTY] })
        const host = makeHost()
        host.addMessage('m1')
        mountMessageCards(bridge, host.host)
        await settle()
        expect(document.querySelector('.rt-party-compact')).toBeNull()
        expect(document.querySelector('.rt-entity-body')).not.toBeNull()

        emit({ name: 'prefs.changed', data: { prefs: { partyCompact: true } } })
        expect(document.querySelector('.rt-party-compact')).not.toBeNull()
        expect(document.querySelector('.rt-party-compact-btn')).toBeNull()

        emit({ name: 'prefs.changed', data: { prefs: { partyCompact: false } } })
        expect(document.querySelector('.rt-party-compact')).toBeNull()
    })
})

describe('the display preferences (72b)', () => {
    const INVENTORY = ['[TIME]', '06:15 AM, Day 4', '[/TIME]', '[INVENTORY]', '- Volcanic Mace (~120 GP) [E]', '- 45 GP', '[/INVENTORY]', '[PARTY]', 'Kael: 12/12 HP', '[/PARTY]'].join('\n')
    it('draws the portraits unless the switch is off, and the inventory’s worth as the two preferences say', async () => {
        const { bridge, emit } = makeBridge({ 'chat-1': [{ ...snap('m1'), memo: INVENTORY }] }, true, { Kael: 'data:image/png;base64,AAA' })
        const host = makeHost()
        host.addMessage('m1')
        mountMessageCards(bridge, host.host)
        await settle()
        headerFor('m1')!.click()
        await settle()
        expect(cardFor('m1')!.querySelector('.rt-entity-portrait')).not.toBeNull()
        expect(cardFor('m1')!.innerHTML).toContain('title="Worth: 120 GP"')
        expect(cardFor('m1')!.querySelector('.rt-total-value-badge')).toBeNull()

        emit({ name: 'prefs.changed', data: { prefs: { portraitsEnabled: false, inventoryShowTotal: true, inventoryWorthMode: 'display' } } })
        await settle()
        expect(cardFor('m1')!.querySelector('.rt-entity-portrait')).toBeNull()
        expect(cardFor('m1')!.querySelector('.rt-total-value-badge')!.textContent).toBe('165 GP')
        expect(cardFor('m1')!.innerHTML).toContain('rt-coin-badge" style="color:#ffd700">120 GP')

        // A preference event that moves none of the three redraws nothing.
        const before = cardFor('m1')
        emit({ name: 'prefs.changed', data: { prefs: { portraitsEnabled: false } } })
        await settle()
        expect(cardFor('m1')).toBe(before)
    })
})
