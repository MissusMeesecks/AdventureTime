// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest'

import type { StatusResult } from '../protocol.js'
import { checklistItems, SUMMARISER_CHECK, CHECKLIST_BUTTON_HELP, CHECKLIST_HELP, CORE_CARD_CSS, CORE_CARD_HELP, createCoreCard } from './core-card.js'
import { createNarratorRows, NARRATOR_CARD_HELP } from './second-pass-cards.js'

const el = (tag: string, attrs?: Record<string, string>) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n }

const STATUS = (dice: StatusResult['dice'], passes?: StatusResult['passes']): StatusResult => ({ version: '0.160.0', granted: [], missing: [], checked: true, ...(dice ? { dice } : {}), ...(passes ? { passes } : {}) } as StatusResult)
const PASSES = (over: Partial<NonNullable<StatusResult['passes']>> = {}): NonNullable<StatusResult['passes']> => ({ id: 'c-main', name: 'Main', provider: 'anthropic', model: 'claude', why: 'seen', listed: 2, maxTokens: 0, ...over })
const CALL = { tool: 'RollTheDice', at: 't', input: {}, output: '' } as never

function mount(options: { modal?: boolean } = {}) {
    const modals: Array<{ title: string; nodes: HTMLElement[]; close: () => void }> = []
    const narrator = createNarratorRows({ el, create: async (name) => ({ id: 'c1', name, created: true }), savePrefs: async () => undefined, fail: () => undefined })
    const card = createCoreCard({
        el,
        narrator,
        ...(options.modal === false ? {} : {
            modal: (opts) => {
                let open = true
                const box = { get open() { return open }, close: () => { if (!open) return; open = false; opts.onClose?.() } }
                modals.push({ title: opts.title, nodes: opts.nodes, close: box.close })
                return box
            },
        }),
    })
    document.body.append(card.root)
    const field = (name: string) => card.root.querySelector(`[data-lh-field="${name}"]`) as HTMLElement
    const button = (name: string) => field(name).querySelector('button.lh-button') as HTMLButtonElement
    return { card, modals, field, button }
}

/** The note a `[?]` button opens. */
const noteOf = (button: Element): HTMLElement => button.ownerDocument.getElementById(button.getAttribute('aria-controls')!)!

describe('Setup & help (96; Core & Branching of 81): the checklist and the narrator card', () => {
    it('is named Setup & help under its old card name, holds Help and Narrator card and nothing of the chat data or the branching caption', () => {
        const { card, field } = mount()
        expect(card.root.getAttribute('data-lh-card')).toBe('core-branching')
        expect(card.root.querySelector('.lh-card-title')!.textContent).toBe('Setup & help')
        expect(Array.from(card.root.querySelectorAll('.lh-core-caption')).map((c) => c.textContent)).toEqual(['Help', 'Narrator card'])
        // The two data buttons are in Debug & factory reset (96), and the explanation-only hints are gone.
        expect(field('remove-all-chats')).toBeNull()
        expect(field('clean-orphans')).toBeNull()
        expect(field('core-links-hint')).toBeNull()
        expect(field('core-branching-hint')).toBeNull()
        expect(card.root.querySelector('.lh-core-hint')).toBeNull()
        expect(Array.from(card.root.querySelectorAll('.lh-second-row[data-lh-field]')).map((r) => r.getAttribute('data-lh-field'))).toEqual(['lumiverse-checklist'])
        expect(field('narrator-rows').querySelector('[data-lh-field="narrator-create"]')).not.toBeNull()
        expect(field('lumiverse-checklist-box').hidden).toBe(true)
        // Drawn from the first paint (81-bis), and hidden by a rule of its own, since display: flex beats the attribute (lesson 60).
        expect(field('lumiverse-checklist-box').querySelectorAll('.lh-checklist-item')).toHaveLength(5)
        expect(CORE_CARD_CSS).toContain('.lh-checklist[hidden] { display: none; }')
        expect(CORE_CARD_CSS).toContain('.lh-checklist-item {')
    })

    it('keeps what the Branching caption said behind the card’s own [?], which opens the card and never folds it', () => {
        const { card } = mount()
        const summary = card.root.querySelector('summary')!
        const tip = summary.querySelector('.lh-help-tip') as HTMLButtonElement
        expect(tip.previousElementSibling!.classList.contains('lh-card-title')).toBe(true)
        const note = noteOf(tip)
        expect(note.hidden).toBe(true)
        expect(note.textContent).toBe(CORE_CARD_HELP)
        expect(CORE_CARD_HELP).toContain('use Branch on a message in Lumiverse')
        expect(CORE_CARD_HELP).toContain('\n\nDifferent from Multihog: there is no Branch campaign button')
        expect(card.root.open).toBe(false)
        tip.click()
        expect(card.root.open).toBe(true)
        expect(note.hidden).toBe(false)
    })

    it('puts the checklist button’s and the narrator name’s help behind a [?] beside each, with no title tooltip and no lead paragraph', () => {
        const { field, button } = mount()
        expect(button('lumiverse-checklist').textContent).toBe('Open Lumiverse checklist')
        expect(button('lumiverse-checklist').hasAttribute('title')).toBe(false)
        const tip = field('lumiverse-checklist').querySelector('.lh-help-tip') as HTMLButtonElement
        expect(tip.previousElementSibling).toBe(button('lumiverse-checklist'))
        expect(noteOf(tip).textContent).toBe(CHECKLIST_BUTTON_HELP)
        expect(noteOf(tip).hidden).toBe(true)
        const rows = field('narrator-rows')
        expect(rows.querySelector('.lh-second-lead')).toBeNull()
        const nameTip = rows.querySelector('.lh-help-tip') as HTMLButtonElement
        expect(nameTip.previousElementSibling!.textContent).toBe('Narrator card name')
        expect(nameTip.closest('label')).toBeNull()
        expect(noteOf(nameTip).closest('label')).toBeNull()
        expect(noteOf(nameTip).textContent).toBe(NARRATOR_CARD_HELP)
        expect(noteOf(nameTip).hidden).toBe(true)
        // The label still names its box.
        expect(rows.querySelector('label')!.getAttribute('for')).toBe(rows.querySelector('[data-lh-field="narrator-name"]')!.id)
    })
})

describe('the Lumiverse checklist (81): what to check on a connection, in Lumiverse’s terms', () => {
    it('reads the five items off the status: the dice tool’s standing as the evidence, the passes’ connection and output length (89), the preset’s numbers unreadable, the narrator card to make', () => {
        const unread = checklistItems(null)
        expect(unread.map((i) => [i.id, i.state])).toEqual([['tools', 'unknown'], ['passes', 'unknown'], ['output', 'unknown'], ['context', 'unknown'], ['narrator', 'unknown']])
        expect(unread.map((i) => i.title)).toEqual(['Narrator connection can call tools', 'Passes have a connection', 'Pass output length is enough', 'Narrator context and output length leave room', 'Chat uses a narrator card'])
        expect(unread[0]!.evidence).toBe('Not read yet. Open the Tracker widget once, then look again.')
        expect(unread[3]!.evidence).toContain('presets permission')
        // The order a blank connection resolves in is a numbered list, one line each.
        expect(unread[1]!.why).toContain('in this order:\n1. The connection pinned to the chat.\n2. The connection that wrote the last reply.\n3. Lumiverse’s default connection.\n4. The first connection in Lumiverse’s list.')
        expect(unread[2]!.why).toContain('set "Pass output length" under Connections & models')
        expect(unread[2]!.why).toContain('\n\nDifferent from Multihog: do not copy Multihog’s 100,000 tokens.')
        // 89: the narrator's Max Tokens is a reply plus reasoning, not 100,000; the context sits below the maximum by AdventureTime's share.
        expect(unread[3]!.why).toContain('\n\nDifferent from Multihog: set the narrator’s Max Tokens to the length of one reply plus any reasoning, not Multihog’s 100,000.')
        expect(unread[3]!.why).toContain('"AdventureTime —" rows')
        expect(unread[3]!.why).toContain('about 6,700 tokens')
        // The checklist opens in a dialog, so the narrator item names the card the rows are on (96).
        expect(unread[4]!.why).toContain('Create one under Narrator card on the Setup & help card')
        expect(unread[4]!.evidence).toBe('Not read yet. Open the Tracker widget once, then look again.')
        // No history of fixed bugs, no version numbers, and "the host" is Lumiverse.
        for (const item of unread) {
            expect(`${item.why} ${item.evidence}`).not.toMatch(/beta|the host\b|Anti-Museum/)
        }
        const called = checklistItems(STATUS({ registered: ['RollTheDice'], absent: null, calls: 3, turn: [CALL, CALL] }))
        expect(called[0]).toMatchObject({ state: 'ok', evidence: 'The dice tool is registered and the narrator called it 2 times in the last reply. The connection can call tools.' })
        const idle = checklistItems(STATUS({ registered: ['RollTheDice'], absent: null, calls: 0, turn: [] }))
        expect(idle[0]).toMatchObject({ state: 'warn', evidence: expect.stringContaining('the last reply did not call it') })
        expect(checklistItems(STATUS({ registered: [], absent: 'refused', calls: 0, turn: [] }))[0]).toMatchObject({ state: 'bad', evidence: expect.stringContaining('Lumiverse refused the dice tool') })
        expect(checklistItems(STATUS({ registered: [], absent: 'combat', calls: 0, turn: [] }))[0]!.state).toBe('warn')
        expect(checklistItems(STATUS({ registered: [], absent: 'mode', calls: 0, turn: [] }))[0]).toMatchObject({ state: 'warn', evidence: expect.stringContaining('The RNG mode does not use the dice tool') })
        expect(checklistItems(STATUS({ registered: [], absent: 'flags', calls: 0, turn: [] }))[0]!.state).toBe('warn')
    })

    // 98: the narrator item reads the card by its name and the card the open chat is from.
    it('reads the narrator card’s standing off the status: none by that name, this chat from it, from another card, no chat open, the chat’s card unreadable, an older backend', () => {
        const told = (narrator: StatusResult['narrator']): StatusResult => ({ ...STATUS(undefined), ...(narrator ? { narrator } : {}) })
        const item = (narrator: StatusResult['narrator']) => checklistItems(told(narrator))[4]!
        expect(item(undefined)).toMatchObject({ id: 'narrator', state: 'unknown', evidence: 'Cannot be read here. Press Create narrator card, then open a chat from the card.' })
        expect(item({ name: 'Lanternkeeper', exists: false, chat: 'other', chatCardName: 'Bramble' })).toMatchObject({ state: 'warn', evidence: 'No card named “Lanternkeeper” yet. Press Create narrator card, then open a new chat from it in Lumiverse.' })
        expect(item({ name: 'Lanternkeeper', exists: true, chat: 'narrator', chatCardName: 'Lanternkeeper' })).toMatchObject({ state: 'ok', evidence: 'This chat is from the narrator card “Lanternkeeper”.' })
        expect(item({ name: 'Lanternkeeper', exists: true, chat: 'other', chatCardName: 'Bramble' })).toMatchObject({ state: 'warn', evidence: 'The card “Lanternkeeper” exists, but this chat is from “Bramble”. Open a new chat from “Lanternkeeper” in Lumiverse, or enter this chat’s card as the narrator card name.' })
        expect(item({ name: 'Lanternkeeper', exists: true, chat: 'other', chatCardName: '' }).evidence).toContain('this chat is from another card.')
        expect(item({ name: 'Lanternkeeper', exists: true, chat: 'none', chatCardName: '' })).toMatchObject({ state: 'warn', evidence: 'The card “Lanternkeeper” exists. No chat is open: open a new chat from it in Lumiverse.' })
        expect(item({ name: 'Lanternkeeper', exists: true, chat: 'unknown', chatCardName: '' })).toMatchObject({ state: 'ok', evidence: 'The card “Lanternkeeper” exists. Which card this chat is from cannot be read here, so open the chat from it.' })
        // A missing card outranks whatever the chat says.
        expect(item({ name: 'Lanternkeeper', exists: false, chat: 'none', chatCardName: '' }).state).toBe('warn')
    })

    // 89: the connection a blank row runs on, with its reason, and the output length against the provider.
    it('names the connection the passes run on and why, warns on the first-listed fallback, fails on none, and reads the output length against the provider', () => {
        const seen = checklistItems(STATUS(undefined, PASSES()))
        expect(seen[1]).toMatchObject({ id: 'passes', state: 'ok', evidence: 'A blank connection uses Main (anthropic · claude): the connection that wrote the last reply. Every blank connection under Connections & models uses this one.' })
        expect(checklistItems(STATUS(undefined, PASSES({ why: 'chat' })))[1]!.evidence).toContain('the chat’s own connection')
        expect(checklistItems(STATUS(undefined, PASSES({ why: 'default', model: '' })))[1]!.evidence).toContain('uses Main (anthropic): Lumiverse’s default connection.')
        const first = checklistItems(STATUS(undefined, PASSES({ why: 'first', provider: 'openai', model: 'mini' })))
        expect(first[1]).toMatchObject({ state: 'warn', evidence: 'A blank connection uses Main (openai · mini), the first connection in Lumiverse’s list. No connection is set as default and no reply has been seen yet. Set a default connection in Lumiverse, or choose one under Connections & models.' })
        const none = checklistItems(STATUS(undefined, PASSES({ id: null, name: '', provider: '', model: '', why: 'none', listed: 0 })))
        expect(none[1]).toMatchObject({ state: 'bad', evidence: expect.stringContaining('Lumiverse has no connection, so no pass can run') })
        // The output length: set is seen right; blank on Anthropic is the 4,096 limit to warn of; blank elsewhere is unreadable.
        expect(seen[2]).toMatchObject({ state: 'warn', evidence: expect.stringContaining('limits every pass to 4,096 tokens') })
        expect(checklistItems(STATUS(undefined, PASSES({ maxTokens: 6000 })))[2]).toMatchObject({ state: 'ok', evidence: 'Pass output length is 6,000 tokens, sent on every pass.' })
        expect(checklistItems(STATUS(undefined, PASSES({ provider: 'openai' })))[2]).toMatchObject({ state: 'unknown', evidence: expect.stringContaining('provider’s default (openai)') })
        expect(none[2]!.state).toBe('unknown')
    })

    it('keeps the summariser out of the list (1.1.2): the check is the starting area’s, always ❔, with why size matters and its link', () => {
        const { field } = mount()
        for (const status of [null, STATUS({ registered: ['RollTheDice'], absent: null, calls: 1, turn: [CALL] }, PASSES({ maxTokens: 4000 }))]) {
            expect(checklistItems(status).map((i) => i.id)).toEqual(['tools', 'passes', 'output', 'context', 'narrator'])
        }
        expect(field('lumiverse-checklist-box').querySelectorAll('a')).toHaveLength(0)
        expect(field('lumiverse-checklist-box').querySelector('[data-lh-field="checklist-summariser"]')).toBeNull()
        expect(SUMMARISER_CHECK.id).toBe('summariser')
        expect(SUMMARISER_CHECK.title).toBe('Summariser for long chats (recommended)')
        expect(SUMMARISER_CHECK.state).toBe('unknown')
        expect(SUMMARISER_CHECK.evidence).toBe('AdventureTime cannot see other extensions, so check this in Lumiverse’s extension list. Recommended: Lumi-Summaryception, the Lumiverse port of the summariser Multihog’s author recommends.')
        expect(SUMMARISER_CHECK.why).toContain('a long campaign grows until it no longer fits the model')
        expect(SUMMARISER_CHECK.link).toEqual({ label: 'Open Lumi-Summaryception', url: 'https://github.com/Ryah/Lumi-Summaryception' })
    })

    it('opens in the host’s modal with the items and the count, follows the status while open, closes on a second press, and unfolds inline without a modal', () => {
        const { card, modals, button } = mount()
        button('lumiverse-checklist').click()
        expect(modals).toHaveLength(1)
        expect(modals[0]!.title).toBe('Lumiverse checklist')
        const box = modals[0]!.nodes[0]!
        expect(box.hidden).toBe(false)
        expect(Array.from(box.querySelectorAll('.lh-checklist-item')).map((i) => i.getAttribute('data-lh-field'))).toEqual(['checklist-tools', 'checklist-passes', 'checklist-output', 'checklist-context', 'checklist-narrator'])
        expect(box.querySelector('[data-lh-field="checklist-status"]')!.textContent).toBe('0 of 5 confirmed here. Check the rest in Lumiverse.')
        card.applyStatus(STATUS({ registered: ['RollTheDice'], absent: null, calls: 1, turn: [CALL] }, PASSES({ maxTokens: 4000 })))
        expect(box.querySelector('[data-lh-field="checklist-tools"]')!.classList.contains('lh-checklist-item--ok')).toBe(true)
        expect(box.querySelector('[data-lh-field="checklist-passes"]')!.classList.contains('lh-checklist-item--ok')).toBe(true)
        expect(box.querySelector('[data-lh-field="checklist-status"]')!.textContent).toContain('3 of 5')
        button('lumiverse-checklist').click()
        expect(modals).toHaveLength(1)
        expect(box.hidden).toBe(true)
        // A status read while the box is hidden redraws it too (81-bis), so it is right the moment it opens.
        card.applyStatus(STATUS({ registered: [], absent: 'refused', calls: 0, turn: [] }))
        expect(box.querySelector('[data-lh-field="checklist-tools"]')!.classList.contains('lh-checklist-item--bad')).toBe(true)
        button('lumiverse-checklist').click()
        expect(modals).toHaveLength(2)
        expect(box.querySelector('[data-lh-field="checklist-tools"]')!.classList.contains('lh-checklist-item--bad')).toBe(true)
        // Without a modal the list unfolds under the button.
        const plain = mount({ modal: false })
        plain.button('lumiverse-checklist').click()
        expect(plain.field('lumiverse-checklist-box').hidden).toBe(false)
        expect(plain.modals).toHaveLength(0)
        plain.button('lumiverse-checklist').click()
        expect(plain.field('lumiverse-checklist-box').hidden).toBe(true)
    })

    it('keeps each item’s help behind a [?] after its label, the status line in the open, and an opened [?] open through a status', () => {
        const { card, field } = mount()
        const box = field('lumiverse-checklist-box')
        expect(box.querySelector('.lh-checklist-lead')).toBeNull()
        expect(box.querySelector('.lh-checklist-why')).toBeNull()
        const items = checklistItems(null)
        for (const item of items) {
            const node = box.querySelector(`[data-lh-field="checklist-${item.id}"]`)!
            const tip = node.querySelector('.lh-help-tip') as HTMLButtonElement
            expect(tip.previousElementSibling!.textContent).toBe(item.title)
            const note = noteOf(tip)
            // In the item from the first paint, hidden; the evidence is not.
            expect(node.contains(note)).toBe(true)
            expect(note.hidden).toBe(true)
            expect(note.textContent).toBe(item.why)
            expect(node.querySelector('.lh-checklist-evidence')!.textContent).toBe(item.evidence)
        }
        // The list's own help is the [?] on its count line.
        const statusTip = field('checklist-status').querySelector('.lh-help-tip') as HTMLButtonElement
        expect(noteOf(statusTip).textContent).toBe(CHECKLIST_HELP)
        expect(noteOf(statusTip).hidden).toBe(true)
        // The modal's box carries the panel's class, so the [?]'s rules reach it; the note's grid place is the item's.
        expect(CORE_CARD_CSS).toContain('.lh-checklist-item .lh-help-note { grid-column: 2;')
        const tools = box.querySelector('[data-lh-field="checklist-tools"]')!
        const tip = tools.querySelector('.lh-help-tip') as HTMLButtonElement
        tip.click()
        expect(noteOf(tip).hidden).toBe(false)
        card.applyStatus(STATUS({ registered: ['RollTheDice'], absent: null, calls: 1, turn: [CALL] }))
        expect(tools.querySelector('.lh-help-tip')).toBe(tip)
        expect(noteOf(tip).hidden).toBe(false)
        expect(tools.querySelector('.lh-checklist-mark')!.textContent).toBe('✅')
    })

    it('hands the preferences to the narrator rows', () => {
        const { card, field } = mount()
        card.applyPrefs({ narratorCardName: 'Aurelius' })
        expect((field('narrator-rows').querySelector('[data-lh-field="narrator-name"]') as HTMLInputElement).value).toBe('Aurelius')
    })
})
