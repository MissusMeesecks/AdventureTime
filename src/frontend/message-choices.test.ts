// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'

import { Bridge } from './bridge.js'
import { mountMessageChoices, renderChoice, renderChoices, type MessageChoicesHost } from './message-choices.js'
import { CHANNEL, isRequest, type EventMessage, type RequestMessage } from '../protocol.js'

type Offered = Array<{ messageId: string; choices: string[] }>

/** A bridge wired to a fake backend that serves one choice list per chat, and records the click. */
function makeBridge(seed: Record<string, Offered> = {}) {
    const offered = new Map(Object.entries(seed))
    const requests: RequestMessage[] = []
    let deliver: ((payload: unknown) => void) | null = null
    let chooseError: string | undefined
    let holdChoose: (() => void) | null = null
    let holdNext = false
    const bridge = new Bridge({
        sendToBackend(payload: unknown): void {
            if (!isRequest(payload)) return
            requests.push(payload)
            const chatId = String(payload.params?.chatId ?? '')
            let data: unknown
            let error: string | undefined
            if (payload.op === 'cyoa.choices') data = { messages: offered.get(chatId) ?? [] }
            else if (payload.op === 'cyoa.choose') {
                if (chooseError) error = chooseError
                else data = { messageId: 'u9' }
                if (holdNext) {
                    holdNext = false
                    const id = payload.id
                    holdChoose = () => deliver?.({ channel: CHANNEL, kind: 'response', id, ok: !error, data, error })
                    return
                }
            } else error = `no canned answer for ${payload.op}`
            queueMicrotask(() => {
                deliver?.({ channel: CHANNEL, kind: 'response', id: payload.id, ok: !error, data, error })
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
        setOffered: (chatId: string, list: Offered) => offered.set(chatId, list),
        failChoose: (message: string) => { chooseError = message },
        holdNextChoose: () => { holdNext = true },
        release: () => { holdChoose?.(); holdChoose = null },
    }
}

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
    const host: MessageChoicesHost = {
        dom: {
            listMessageElements: () => Array.from(bubbles, ([messageId, element]) => ({ messageId, element })),
            inject(target, html, position = 'beforeend'): Element {
                const wrapper = document.createElement('div')
                wrapper.innerHTML = html
                const injected = wrapper.firstElementChild as Element
                ;(target as Element).insertAdjacentElement(position, injected)
                return injected
            },
            uninject(element): void { element.remove() },
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
        unmount: (messageId: string) => { bubbles.get(messageId)?.remove() },
        /** Stop listing a bubble without touching its DOM, as a chat switch leaves a stale wrapper behind. */
        hide: (messageId: string) => { bubbles.delete(messageId) },
        setChat: (next: string | null) => { active = next },
        fire: (event: string) => { for (const handler of listeners.get(event) ?? []) handler() },
    }
}

const settle = async (ms = 0) => { await new Promise((resolve) => setTimeout(resolve, ms)) }
const buttonsUnder = (messageId: string) =>
    Array.from(document.querySelectorAll(`[data-message="${messageId}"] .lh-choices-list button`)) as HTMLButtonElement[]

const OFFERED: Offered = [{ messageId: 'm2', choices: ['1. 🚪 Open it — [Strength (+2) DC 12]', '2. 👂 Listen first'] }]

beforeEach(() => { document.body.replaceChildren() })

describe('drawing the choices', () => {
    it('marks the mechanics inside a choice and escapes the rest', () => {
        expect(renderChoice('1. Open it — [Strength (+2) DC 12] <b>')).toBe(
            '1. Open it — <span class="lh-choice-mech">[Strength (+2) DC 12]</span> &lt;b&gt;',
        )
        expect(renderChoices(['a', 'b'])).toContain('data-lh-choice="1"')
        // A block of their own: the host's wrapper is not a column.
        expect(renderChoices(['a', 'b']).startsWith('<div class="lh-choices-list">')).toBe(true)
    })

    it('paints the buttons inside their own block, even when the host hands back its own wrapper', async () => {
        const { bridge } = makeBridge({ 'chat-1': OFFERED })
        const { host, addMessage } = makeHost()
        addMessage('m2')
        // The real host returns a wrapper of its own around the injected HTML.
        const inject = host.dom.inject.bind(host.dom)
        host.dom.inject = (target, html, position) => {
            const outer = document.createElement('div')
            outer.className = 'host-wrapper'
            outer.innerHTML = html
            ;(target as Element).insertAdjacentElement(position ?? 'beforeend', outer)
            void inject
            return outer
        }
        mountMessageChoices(bridge, host)
        await settle()
        expect(document.querySelector('[data-message="m2"] .host-wrapper > .lh-choices-list')).not.toBeNull()
        expect(buttonsUnder('m2')).toHaveLength(2)
    })

    // Phase 33a: the block's own lines, as the host renders them, are hidden
    // from this side; the regex script that did it cost every render.
    it('hides the lines the host made of the block, under the reply they belong to', async () => {
        const { bridge } = makeBridge({ 'chat-1': OFFERED })
        const { host, addMessage } = makeHost()
        const other = addMessage('m1')
        other.innerHTML = '<ol><li>🚪 Open it — [Strength (+2) DC 12]</li></ol>'
        const bubble = addMessage('m2')
        bubble.innerHTML = '<p>The door is shut.</p><ol><li>🚪 Open it — [Strength (+2) DC 12]</li><li>👂 Listen first</li></ol>'
        mountMessageChoices(bridge, host)
        await settle()
        expect((bubble.querySelector('ol') as HTMLElement).style.display).toBe('none')
        expect((bubble.querySelector('p') as HTMLElement).style.display).toBe('')
        expect(buttonsUnder('m2')).toHaveLength(2)
        // A reply that offered no choices keeps every line, however it reads.
        expect((other.querySelector('ol') as HTMLElement).style.display).toBe('')
    })

    // The maintainer's HTML (33a-ter): the host keeps the block's <button>
    // tags as real buttons inside its prose, and *replaces* our injected root
    // with a wrapper of its own, keeping only the list. The prose buttons must
    // go and ours must stand -- the first run hid ours as duplicates.
    it('hides the host\'s own rendering of the buttons and keeps ours, in the real host\'s shape', async () => {
        const { bridge } = makeBridge({ 'chat-1': OFFERED })
        const { host, addMessage } = makeHost()
        const row = addMessage('m2')
        row.innerHTML = '<div class="_card"><div class="_prose"><p>The door is shut.</p><button style="">1. 🚪 Open it — [Strength (+2) DC 12]</button>\n<button style="">2. 👂 Listen first</button></div></div>'
        host.dom.inject = (target, html, position) => {
            const outer = document.createElement('div')
            outer.setAttribute('data-spindle-ext', 'x')
            // The host drops our root and keeps its contents.
            const parsed = document.createElement('div')
            parsed.innerHTML = html
            outer.innerHTML = parsed.firstElementChild?.innerHTML ?? ''
            ;(target as Element).insertAdjacentElement(position ?? 'beforeend', outer)
            return outer
        }
        mountMessageChoices(bridge, host)
        await settle()
        const prose = Array.from(row.querySelectorAll('._prose button')) as HTMLButtonElement[]
        expect(prose).toHaveLength(2)
        expect(prose.every((b) => b.style.display === 'none')).toBe(true)
        const ours = Array.from(row.querySelectorAll('[data-spindle-ext] .lh-choices-list button')) as HTMLButtonElement[]
        expect(ours).toHaveLength(2)
        expect(ours.every((b) => b.style.display === '')).toBe(true)
        expect(row.querySelector('.lh-choices')).toBeNull()
    })

    it('puts a button per choice under the reply that offered them, and nothing under the others', async () => {
        const { bridge, requests } = makeBridge({ 'chat-1': OFFERED })
        const { host, addMessage } = makeHost()
        addMessage('m1')
        addMessage('m2')
        mountMessageChoices(bridge, host)
        await settle()

        expect(requests[0]).toMatchObject({ op: 'cyoa.choices', params: { chatId: 'chat-1' } })
        expect(buttonsUnder('m2').map((b) => b.textContent)).toEqual(['1. 🚪 Open it — [Strength (+2) DC 12]', '2. 👂 Listen first'])
        expect(buttonsUnder('m1')).toHaveLength(0)
    })

    it('draws under a bubble mounted later, and once only', async () => {
        const { bridge } = makeBridge({ 'chat-1': OFFERED })
        const { host, addMessage, fire } = makeHost()
        mountMessageChoices(bridge, host)
        await settle()
        expect(buttonsUnder('m2')).toHaveLength(0)

        addMessage('m2')
        fire('USER_MESSAGE_RENDERED')
        expect(buttonsUnder('m2')).toHaveLength(2)
        fire('USER_MESSAGE_RENDERED')
        expect(document.querySelectorAll('.lh-choices')).toHaveLength(1)
    })

    it('re-reads the choices when a reply lands, is swiped or edited, and drops stale buttons', async () => {
        const { bridge, requests, setOffered } = makeBridge({ 'chat-1': OFFERED })
        const { host, addMessage, fire } = makeHost()
        addMessage('m2')
        addMessage('m3')
        mountMessageChoices(bridge, host)
        await settle()
        expect(buttonsUnder('m2')).toHaveLength(2)

        setOffered('chat-1', [{ messageId: 'm3', choices: ['1. Go'] }])
        fire('GENERATION_ENDED')
        fire('CHARACTER_MESSAGE_RENDERED')
        await settle(80)
        // Coalesced: two events, one read.
        expect(requests.filter((r) => r.op === 'cyoa.choices')).toHaveLength(2)
        expect(buttonsUnder('m2')).toHaveLength(0)
        expect(buttonsUnder('m3').map((b) => b.textContent)).toEqual(['1. Go'])

        setOffered('chat-1', [])
        fire('MESSAGE_SWIPED')
        await settle(80)
        expect(document.querySelectorAll('.lh-choices')).toHaveLength(0)
    })

    it('follows the user to another chat and clears the old one\'s buttons', async () => {
        const { bridge, setOffered } = makeBridge({ 'chat-1': OFFERED })
        const { host, addMessage, fire, setChat, hide } = makeHost()
        addMessage('m2')
        mountMessageChoices(bridge, host)
        await settle()
        expect(buttonsUnder('m2')).toHaveLength(2)

        setOffered('chat-2', [])
        setChat('chat-2')
        // The host stops listing the old chat's bubbles; whatever it left in
        // the DOM is this module's to take down.
        hide('m2')
        fire('CHAT_SWITCHED')
        await settle()
        expect(document.querySelectorAll('.lh-choices')).toHaveLength(0)
    })
})

describe('taking a choice', () => {
    it('sends the choice\'s text as written, for the active chat', async () => {
        const { bridge, requests } = makeBridge({ 'chat-1': OFFERED })
        const { host, addMessage } = makeHost()
        addMessage('m2')
        mountMessageChoices(bridge, host)
        await settle()

        buttonsUnder('m2')[1]!.click()
        await settle()
        const sent = requests.find((r) => r.op === 'cyoa.choose')
        expect(sent?.params).toEqual({ chatId: 'chat-1', text: '2. 👂 Listen first' })
    })

    it('holds every reply\'s buttons while a choice is on its way, so a second click waits', async () => {
        const { bridge, requests, holdNextChoose, release } = makeBridge({
            'chat-1': [...OFFERED, { messageId: 'm3', choices: ['1. Later'] }],
        })
        const { host, addMessage } = makeHost()
        addMessage('m2')
        addMessage('m3')
        mountMessageChoices(bridge, host)
        await settle()

        holdNextChoose()
        buttonsUnder('m2')[0]!.click()
        await settle()
        expect(buttonsUnder('m2').every((b) => b.disabled)).toBe(true)
        expect(buttonsUnder('m3').every((b) => b.disabled)).toBe(true)
        // A click that reaches the handler anyway (the button re-enabled by
        // hand, a stale frame) still sends nothing while one is in flight.
        buttonsUnder('m3')[0]!.disabled = false
        buttonsUnder('m3')[0]!.click()
        await settle()
        expect(requests.filter((r) => r.op === 'cyoa.choose')).toHaveLength(1)

        release()
        await settle()
        expect(buttonsUnder('m2').every((b) => !b.disabled)).toBe(true)
        expect(buttonsUnder('m3').every((b) => !b.disabled)).toBe(true)
    })

    it('frees the buttons when the send fails', async () => {
        const { bridge, failChoose } = makeBridge({ 'chat-1': OFFERED })
        const { host, addMessage } = makeHost()
        addMessage('m2')
        mountMessageChoices(bridge, host)
        await settle()
        failChoose('the host said no')

        buttonsUnder('m2')[0]!.click()
        await settle()
        expect(buttonsUnder('m2').every((b) => !b.disabled)).toBe(true)
    })

    it('stops listening and clears up when destroyed', async () => {
        const { bridge, requests } = makeBridge({ 'chat-1': OFFERED })
        const { host, addMessage, fire } = makeHost()
        addMessage('m2')
        const mounted = mountMessageChoices(bridge, host)
        await settle()
        mounted.destroy()
        expect(document.querySelectorAll('.lh-choices')).toHaveLength(0)
        const before = requests.length
        fire('CHARACTER_MESSAGE_RENDERED')
        await settle(80)
        expect(requests.length).toBe(before)
    })
})
