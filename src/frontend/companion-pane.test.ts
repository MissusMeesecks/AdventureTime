// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'

import type { CompanionState } from '../protocol.js'
import { COMPANION_PANE_CSS, COMPANION_TEXT, createCompanionPane, guideCostLine, receiptLine, renderCompanionText, type CompanionPlace } from './companion-pane.js'

const el = (tag: string, attrs?: Record<string, string>) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n }

function harness(options: { confirm?: boolean; noConfirm?: boolean } = {}) {
    const chats: Record<string, CompanionState['messages']> = {}
    const sent: Array<[string, string]> = []
    const patches: Array<Record<string, unknown>> = []
    const places: CompanionPlace[] = []
    const confirms: string[] = []
    let sendError: Error | null = null
    let hold: Promise<void> | null = null
    /** A turn the Companion proposes, per chat (100c). */
    const proposed: Record<string, string | undefined> = {}
    const answers: Array<[string, boolean]> = []
    let answerError: Error | null = null
    const state = (chatId: string): CompanionState => ({ chatId, messages: [...(chats[chatId] ?? [])], busy: false, guideAttached: true, guideTokens: 19000, pending: proposed[chatId] ? { text: proposed[chatId]! } : null })
    const pane = createCompanionPane({
        el,
        load: async (chatId) => state(chatId),
        send: async (chatId, text) => {
            sent.push([chatId, text])
            if (hold) await hold
            if (sendError) throw sendError
            chats[chatId] = [...(chats[chatId] ?? []), { role: 'user', content: text, at: '2031-01-01T00:00:00.000Z' }, { role: 'assistant', content: `Answer to **${text}**`, at: '2031-01-01T00:00:01.000Z' }]
            return state(chatId)
        },
        clear: async (chatId) => { chats[chatId] = []; return state(chatId) },
        answerTurn: async (chatId, send) => {
            answers.push([chatId, send])
            if (hold) await hold
            if (answerError) throw answerError
            const text = proposed[chatId]!
            proposed[chatId] = undefined
            chats[chatId] = [...(chats[chatId] ?? []), send
                ? { role: 'assistant', content: 'Bold as brass.', at: '', actions: [{ action: 'Player Turn', success: true, message: `Submitted player action: ${text}` }] }
                : { role: 'assistant', content: `Not sent: ${text}`, at: '' }]
            return state(chatId)
        },
        savePrefs: async (patch) => { patches.push(patch) },
        ...(options.noConfirm ? {} : { confirm: async (title: string) => { confirms.push(title); return options.confirm !== false } }),
        clock: () => '12:00',
        onPlace: (place) => { places.push(place) },
    })
    document.body.append(pane.root)
    return { pane, chats, sent, patches, places, confirms, proposed, answers, setAnswerError: (e: Error | null) => { answerError = e }, setSendError: (e: Error | null) => { sendError = e }, setHold: (p: Promise<void> | null) => { hold = p } }
}

const field = <T extends HTMLElement = HTMLElement>(name: string) => document.querySelector(`[data-lh-field="${name}"]`) as T
const rows = () => Array.from(document.querySelectorAll('.lh-companion-message')).map((row) => [row.getAttribute('data-lh-role'), row.querySelector('.lh-companion-text')!.textContent])
const type = (text: string) => { field<HTMLTextAreaElement>('companion-input').value = text }

beforeEach(() => { document.body.replaceChildren() })

describe('the Companion pane', () => {
    it('asks for a chat first, then shows an empty conversation with an example', async () => {
        const h = harness()
        expect(document.querySelector('.lh-companion-empty')!.textContent).toBe(COMPANION_TEXT.noChat)
        expect(field<HTMLButtonElement>('companion-send').disabled).toBe(true)
        h.pane.setChat('c1')
        await h.pane.settled()
        expect(document.querySelector('.lh-companion-empty')!.textContent).toBe(COMPANION_TEXT.empty)
        expect(field<HTMLButtonElement>('companion-send').disabled).toBe(false)
        expect(field<HTMLButtonElement>('companion-clear').disabled).toBe(true)
        expect(field('companion-cost').textContent).toBe(guideCostLine(true, 19000))
    })

    it('sends on the button, shows the message at once with the writing line, then the reply formatted', async () => {
        const h = harness()
        h.pane.setChat('c1')
        await h.pane.settled()
        let release: () => void = () => {}
        h.setHold(new Promise((resolve) => { release = resolve }))
        type('  How do I rest?  ')
        field('companion-send').click()
        expect(h.sent).toEqual([['c1', 'How do I rest?']])
        expect(rows()).toEqual([['user', 'How do I rest?']])
        expect(field('companion-busy').hidden).toBe(false)
        expect(field<HTMLButtonElement>('companion-send').disabled).toBe(true)
        expect(field<HTMLTextAreaElement>('companion-input').value).toBe('')
        // A second press while it writes sends nothing.
        type('Again')
        field('companion-send').click()
        expect(h.sent).toHaveLength(1)
        // Nor does Enter, which no disabled button stands in front of.
        field<HTMLTextAreaElement>('companion-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        expect(h.sent).toHaveLength(1)
        type('')
        release()
        await h.pane.settled()
        expect(rows()).toEqual([['user', 'How do I rest?'], ['assistant', 'Answer to How do I rest?']])
        expect(document.querySelector('.lh-companion-message--assistant strong')!.textContent).toBe('How do I rest?')
        expect(document.querySelector('.lh-companion-message--assistant .lh-companion-who')!.textContent).toBe('Companion · 12:00')
        expect(field('companion-busy').hidden).toBe(true)
        expect(field<HTMLButtonElement>('companion-clear').disabled).toBe(false)
    })

    it('sends on Enter and not on Shift+Enter, and sends nothing for an empty box', async () => {
        const h = harness()
        h.pane.setChat('c1')
        await h.pane.settled()
        const input = field<HTMLTextAreaElement>('companion-input')
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        expect(h.sent).toEqual([])
        type('Line one')
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
        expect(h.sent).toEqual([])
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        expect(h.sent).toEqual([['c1', 'Line one']])
    })

    it('puts the text back in the box and says why when the send fails', async () => {
        const h = harness()
        h.pane.setChat('c1')
        await h.pane.settled()
        h.setSendError(new Error('The Companion could not answer: no connection'))
        type('Hello')
        field('companion-send').click()
        await h.pane.settled()
        expect(field<HTMLTextAreaElement>('companion-input').value).toBe('Hello')
        expect(field('companion-error').hidden).toBe(false)
        expect(field('companion-error').textContent).toBe('The Companion could not answer: no connection')
        expect(rows()).toEqual([])
        expect(field('companion-busy').hidden).toBe(true)
        // The next send clears the error.
        h.setSendError(null)
        field('companion-send').click()
        await h.pane.settled()
        expect(field('companion-error').hidden).toBe(true)
        expect(rows()).toHaveLength(2)
    })

    it('keeps each chat’s conversation apart, and drops a reply that lands after the chat changed', async () => {
        const h = harness()
        h.chats.c2 = [{ role: 'user', content: 'Earlier', at: '' }, { role: 'assistant', content: 'Reply', at: '' }]
        h.pane.setChat('c1')
        await h.pane.settled()
        let release: () => void = () => {}
        h.setHold(new Promise((resolve) => { release = resolve }))
        type('For chat one')
        field('companion-send').click()
        const sending = h.pane.settled()
        h.setHold(null)
        h.pane.setChat('c2')
        await h.pane.settled()
        expect(rows()).toEqual([['user', 'Earlier'], ['assistant', 'Reply']])
        release()
        await sending
        expect(rows()).toEqual([['user', 'Earlier'], ['assistant', 'Reply']])
        expect(field('companion-busy').hidden).toBe(true)
    })

    it('clears after the confirm, and not when it is refused', async () => {
        const refused = harness({ confirm: false })
        refused.chats.c1 = [{ role: 'user', content: 'Keep me', at: '' }]
        refused.pane.setChat('c1')
        await refused.pane.settled()
        field('companion-clear').click()
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(refused.confirms).toEqual(['Clear the conversation?'])
        expect(refused.chats.c1).toHaveLength(1)
        document.body.replaceChildren()
        const h = harness()
        h.chats.c1 = [{ role: 'user', content: 'Remove me', at: '' }]
        h.pane.setChat('c1')
        await h.pane.settled()
        field('companion-clear').click()
        await new Promise((resolve) => setTimeout(resolve, 0))
        await h.pane.settled()
        expect(h.chats.c1).toEqual([])
        expect(document.querySelector('.lh-companion-empty')!.textContent).toBe(COMPANION_TEXT.empty)
    })

    it('saves the guide tick as the install’s preference and says what off means', async () => {
        const h = harness()
        h.pane.setChat('c1')
        await h.pane.settled()
        const tick = field<HTMLInputElement>('companion-guide')
        expect(tick.checked).toBe(true)
        tick.checked = false
        tick.dispatchEvent(new Event('change'))
        expect(h.patches).toEqual([{ companionGuide: false }])
        expect(field('companion-cost').textContent).toBe(guideCostLine(false, 19000))
        expect(guideCostLine(false, 19000)).toContain('in any chat')
        // A preference changed elsewhere reaches the tick.
        h.pane.applyPrefs({ companionGuide: true })
        expect(tick.checked).toBe(true)
        expect(field('companion-cost').textContent).toContain('19,000 tokens')
    })

    it('shows what the Companion sees as the preferences stand, and saves each choice on its own (100b)', async () => {
        const h = harness()
        const lookback = field<HTMLInputElement>('companion-lookback')
        expect(lookback.value).toBe('5')
        expect(['companion-all', 'companion-sheet', 'companion-lore', 'companion-map'].map((name) => field<HTMLInputElement>(name).checked)).toEqual([false, false, false, false])
        for (const [name, key] of [['companion-sheet', 'companionSheet'], ['companion-lore', 'companionLore'], ['companion-map', 'companionMap']] as const) {
            const box = field<HTMLInputElement>(name)
            box.checked = true
            box.dispatchEvent(new Event('change'))
            expect(h.patches.at(-1)).toEqual({ [key]: true })
        }
        // The count is held between 0 and 100, and a junk entry leaves it as it was.
        lookback.value = '250'
        lookback.dispatchEvent(new Event('change'))
        expect(h.patches.at(-1)).toEqual({ companionLookback: 100 })
        expect(lookback.value).toBe('100')
        lookback.value = '-4'
        lookback.dispatchEvent(new Event('change'))
        expect(h.patches.at(-1)).toEqual({ companionLookback: 0 })
        lookback.value = 'many'
        lookback.dispatchEvent(new Event('change'))
        expect(h.patches.at(-1)).toEqual({ companionLookback: 0 })
        // The whole story greys the count, which no longer decides anything.
        const all = field<HTMLInputElement>('companion-all')
        all.checked = true
        all.dispatchEvent(new Event('change'))
        expect(h.patches.at(-1)).toEqual({ companionLookbackAll: true })
        expect(lookback.disabled).toBe(true)
        // Preferences changed elsewhere reach every control.
        h.pane.applyPrefs({ companionLookback: 12, companionLookbackAll: false, companionSheet: false, companionLore: true, companionMap: false })
        expect(lookback.value).toBe('12')
        expect(lookback.disabled).toBe(false)
        expect(['companion-all', 'companion-sheet', 'companion-lore', 'companion-map'].map((name) => field<HTMLInputElement>(name).checked)).toEqual([false, false, true, false])
        // And each one on its own, the other way round.
        h.pane.applyPrefs({ companionLookbackAll: true, companionSheet: true, companionLore: false, companionMap: true })
        expect(['companion-all', 'companion-sheet', 'companion-lore', 'companion-map'].map((name) => field<HTMLInputElement>(name).checked)).toEqual([true, true, false, true])
    })

    it('saves the place and tells the panel, from the select and from a preference changed elsewhere, once each', async () => {
        const h = harness()
        const select = field<HTMLSelectElement>('companion-place')
        expect(h.pane.place()).toBe('widget')
        select.value = 'settings'
        select.dispatchEvent(new Event('change'))
        expect(h.patches).toEqual([{ companionPlace: 'settings' }])
        expect(h.places).toEqual(['settings'])
        // The save's own echo moves nothing a second time.
        h.pane.applyPrefs({ companionPlace: 'settings' })
        expect(h.places).toEqual(['settings'])
        h.pane.applyPrefs({ companionPlace: 'widget' })
        expect(h.places).toEqual(['settings', 'widget'])
        expect(select.value).toBe('widget')
        h.pane.applyPrefs({ companionPlace: 'elsewhere' })
        expect(h.pane.place()).toBe('widget')
    })
})

describe('the Companion’s stylesheet', () => {
    it('takes a hidden tab out of the strip whatever the phone block says, and hides the two notes by rule', () => {
        expect(COMPANION_PANE_CSS).toContain('.adventuretime-panel .lh-widget-tab[hidden] { display: none; }')
        expect(COMPANION_PANE_CSS).toContain('.lh-companion-busy[hidden], .lh-companion-error[hidden], .lh-companion-turn[hidden] { display: none; }')
    })
})

describe('a reply as formatted text', () => {
    it('draws paragraphs, lists, headings and the inline marks as nodes', () => {
        const root = renderCompanionText(el, '## Resting\nOpen *Settings* and press **Rest**.\nThen wait.\n\n- one `a`\n- two\n\n1. first\n2) second\n\nLast.')
        expect(Array.from(root.children).map((child) => child.tagName)).toEqual(['P', 'P', 'UL', 'OL', 'P'])
        expect(root.querySelector('.lh-companion-heading strong')!.textContent).toBe('Resting')
        expect(root.children[1]!.querySelector('em')!.textContent).toBe('Settings')
        expect(root.children[1]!.querySelector('strong')!.textContent).toBe('Rest')
        expect(root.children[1]!.querySelectorAll('br')).toHaveLength(1)
        expect(Array.from(root.querySelectorAll('ul li')).map((li) => li.textContent)).toEqual(['one a', 'two'])
        expect(root.querySelector('ul code')!.textContent).toBe('a')
        expect(Array.from(root.querySelectorAll('ol li')).map((li) => li.textContent)).toEqual(['first', 'second'])
    })

    it('reads a mark inside a mark: a path in italics ending on a bold name, as the guide writes one', () => {
        const root = renderCompanionText(el, '*Settings → State Tracker → **Tracker modules***\n\nFind the ***Spells*** row. **Press *it* once**, then `**not bold**`.')
        const path = root.children[0]!
        expect(path.textContent).toBe('Settings → State Tracker → Tracker modules')
        expect(path.children).toHaveLength(1)
        expect(path.children[0]!.tagName).toBe('EM')
        expect(path.querySelector('em > strong')!.textContent).toBe('Tracker modules')
        const rest = root.children[1]!
        expect(rest.querySelector('strong > em')!.textContent).toBe('Spells')
        expect(Array.from(rest.querySelectorAll('strong')).map((n) => n.textContent)).toEqual(['Spells', 'Press it once'])
        expect(rest.querySelector('code')!.textContent).toBe('**not bold**')
        // No stray asterisk is left on screen.
        expect(path.textContent).not.toContain('*')
        expect(rest.textContent).toBe('Find the Spells row. Press it once, then **not bold**.')
        // An asterisk that marks nothing stays as typed.
        expect(renderCompanionText(el, '2 * 3 = 6 and a lone ** here').textContent).toBe('2 * 3 = 6 and a lone ** here')
    })

    it('never reads a reply as HTML', () => {
        const root = renderCompanionText(el, 'Hello <img src=x onerror=alert(1)> and <b>bold</b>')
        expect(root.querySelector('img')).toBeNull()
        expect(root.querySelector('b')).toBeNull()
        expect(root.textContent).toBe('Hello <img src=x onerror=alert(1)> and <b>bold</b>')
    })

    it('lists what the Companion did under its reply, a failed action marked (100c)', async () => {
        const h = harness()
        h.chats.c1 = [
            { role: 'user', content: 'Add a lantern and clear the yard.', at: '' },
            { role: 'assistant', content: 'The lantern is yours.', at: '', actions: [{ action: 'State Tracker', success: true, message: 'Added INVENTORY.' }, { action: 'Map Updater', success: false, message: 'No active map.' }] },
        ]
        h.pane.setChat('c1')
        await h.pane.settled()
        const items = Array.from(field('companion-receipts').querySelectorAll('li'))
        expect(items.map((li) => li.textContent)).toEqual(['✓ State Tracker: Added INVENTORY.', '✗ Map Updater: No active map.'])
        expect(items.map((li) => li.classList.contains('lh-companion-receipt--failed'))).toEqual([false, true])
        expect(receiptLine({ action: 'Player Turn', success: true, message: 'sent' })).toBe('✓ Player Turn: sent')
        // The player's own message never carries a list.
        expect(document.querySelectorAll('[data-lh-field="companion-receipts"]')).toHaveLength(1)
    })

    it('shows a proposed turn with its two answers, and nothing of it when none is proposed (100c)', async () => {
        const h = harness()
        h.pane.setChat('c1')
        await h.pane.settled()
        expect(field('companion-turn').hidden).toBe(true)
        h.proposed.c2 = 'I open the gate.\nQuietly.'
        h.pane.setChat('c2')
        await h.pane.settled()
        expect(field('companion-turn').hidden).toBe(false)
        expect(field('companion-turn').querySelector('.lh-companion-turn-lead')!.textContent).toBe(COMPANION_TEXT.turnLead)
        expect(field('companion-turn-text').textContent).toBe('I open the gate.\nQuietly.')
        expect([field('companion-turn-send').textContent, field('companion-turn-cancel').textContent]).toEqual(['Send as my turn', 'Don’t send'])
        expect(COMPANION_PANE_CSS).toContain('.lh-companion-turn[hidden]')
    })

    it('sends the turn on Send as my turn, once, saying so meanwhile, then shows the reaction', async () => {
        const h = harness()
        h.proposed.c1 = 'I open the gate.'
        h.pane.setChat('c1')
        await h.pane.settled()
        let release!: () => void
        h.setHold(new Promise<void>((resolve) => { release = resolve }))
        field<HTMLButtonElement>('companion-turn-send').click()
        field<HTMLButtonElement>('companion-turn-send').click()
        field<HTMLButtonElement>('companion-turn-cancel').click()
        expect(h.answers).toEqual([['c1', true]])
        expect(field('companion-busy').hidden).toBe(false)
        expect(field('companion-busy').textContent).toBe(COMPANION_TEXT.turnSending)
        expect(field<HTMLButtonElement>('companion-turn-send').disabled).toBe(true)
        expect(field<HTMLButtonElement>('companion-send').disabled).toBe(true)
        type('Something else')
        field<HTMLButtonElement>('companion-send').click()
        // Enter is the other way to send, and it waits too.
        field('companion-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
        expect(h.sent).toEqual([])
        release()
        await h.pane.settled()
        expect(field('companion-turn').hidden).toBe(true)
        expect(field('companion-busy').hidden).toBe(true)
        expect(rows()).toEqual([['assistant', 'Bold as brass.']])
        expect(field('companion-receipts').textContent).toBe('✓ Player Turn: Submitted player action: I open the gate.')
    })

    it('drops the turn on Don’t send', async () => {
        const h = harness()
        h.proposed.c1 = 'I open the gate.'
        h.pane.setChat('c1')
        await h.pane.settled()
        field<HTMLButtonElement>('companion-turn-cancel').click()
        await h.pane.settled()
        expect(h.answers).toEqual([['c1', false]])
        expect(field('companion-turn').hidden).toBe(true)
        expect(rows()).toEqual([['assistant', 'Not sent: I open the gate.']])
    })

    it('keeps the turn on offer when it could not be sent, with the reason, and lets the player try again', async () => {
        const h = harness()
        h.proposed.c1 = 'I open the gate.'
        h.pane.setChat('c1')
        await h.pane.settled()
        h.setAnswerError(new Error('The turn could not be sent: the host is generating'))
        field<HTMLButtonElement>('companion-turn-send').click()
        await h.pane.settled()
        expect(field('companion-error').textContent).toBe('The turn could not be sent: the host is generating')
        expect(field('companion-turn').hidden).toBe(false)
        expect(field<HTMLButtonElement>('companion-turn-send').disabled).toBe(false)
        h.setAnswerError(null)
        field<HTMLButtonElement>('companion-turn-send').click()
        await h.pane.settled()
        expect(h.answers).toEqual([['c1', true], ['c1', true]])
        expect(field('companion-error').hidden).toBe(true)
    })

    it('hides the offer while a new message is being answered, and answers nothing without an offer', async () => {
        const h = harness()
        h.pane.setChat('c1')
        await h.pane.settled()
        field<HTMLButtonElement>('companion-turn-send').click()
        expect(h.answers).toEqual([])
        h.proposed.c1 = 'I open the gate.'
        h.pane.setChat(null)
        h.pane.setChat('c1')
        await h.pane.settled()
        let release!: () => void
        h.setHold(new Promise<void>((resolve) => { release = resolve }))
        type('Actually, wait')
        field<HTMLButtonElement>('companion-send').click()
        expect(field('companion-turn').hidden).toBe(true)
        h.proposed.c1 = undefined
        release()
        await h.pane.settled()
        expect(field('companion-turn').hidden).toBe(true)
    })

    it('asks before a turn as it ships, saves the tick for every chat, and follows the preference from elsewhere', async () => {
        const h = harness()
        const tick = field<HTMLInputElement>('companion-confirm')
        expect(tick.checked).toBe(true)
        expect(tick.closest('label')!.textContent).toContain('Ask before it takes my turn')
        tick.checked = false
        tick.dispatchEvent(new Event('change'))
        expect(h.patches).toEqual([{ companionConfirmAct: false }])
        h.pane.applyPrefs({ companionConfirmAct: true })
        expect(tick.checked).toBe(true)
        h.pane.applyPrefs({ companionConfirmAct: 'no' })
        expect(tick.checked).toBe(true)
        // An echo of some other preference leaves it alone.
        h.pane.applyPrefs({ companionGuide: true })
        expect(tick.checked).toBe(true)
        h.pane.applyPrefs({ companionConfirmAct: false })
        expect(tick.checked).toBe(false)
    })

    it('says in its intro that it can change the campaign and shows a turn first', () => {
        harness()
        expect(field('companion-intro').textContent).toBe(COMPANION_TEXT.intro)
        expect(COMPANION_TEXT.intro).not.toContain('cannot change anything')
        expect(COMPANION_TEXT.intro).toContain('it shows you the message first')
    })
})
