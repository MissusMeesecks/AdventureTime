// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest'

import type { StatusResult } from '../protocol.js'
import { checklistItems, CORE_CARD_CSS, createCoreCard } from './core-card.js'
import { createNarratorRows } from './second-pass-cards.js'

const el = (tag: string, attrs?: Record<string, string>) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n }
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const STATUS = (dice: StatusResult['dice'], passes?: StatusResult['passes']): StatusResult => ({ version: '0.160.0', granted: [], missing: [], checked: true, ...(dice ? { dice } : {}), ...(passes ? { passes } : {}) } as StatusResult)
const PASSES = (over: Partial<NonNullable<StatusResult['passes']>> = {}): NonNullable<StatusResult['passes']> => ({ id: 'c-main', name: 'Main', provider: 'anthropic', model: 'claude', why: 'seen', listed: 2, maxTokens: 0, ...over })
const CALL = { tool: 'RollTheDice', at: 't', input: {}, output: '' } as never

function mount(options: { confirmed?: boolean; answers?: Record<string, unknown>; modal?: boolean } = {}) {
    const asked: Array<[string, string, string]> = []
    const requests: string[] = []
    const removed: number[] = []
    const failures: unknown[] = []
    const modals: Array<{ title: string; nodes: HTMLElement[]; close: () => void }> = []
    const narrator = createNarratorRows({ el, create: async (name) => ({ id: 'c1', name, created: true }), savePrefs: async () => undefined, fail: () => undefined })
    const card = createCoreCard({
        el,
        confirm: async (title, message, label) => { asked.push([title, message, label]); return options.confirmed !== false },
        request: async <T,>(op: string) => { requests.push(op); return (options.answers?.[op] ?? {}) as T },
        narrator,
        ...(options.modal === false ? {} : {
            modal: (opts) => {
                let open = true
                const box = { get open() { return open }, close: () => { if (!open) return; open = false; opts.onClose?.() } }
                modals.push({ title: opts.title, nodes: opts.nodes, close: box.close })
                return box
            },
        }),
        onChatsRemoved: () => { removed.push(1) },
        fail: (error) => { failures.push(error) },
    })
    document.body.append(card.root)
    const field = (name: string) => card.root.querySelector(`[data-lh-field="${name}"]`) as HTMLElement
    const button = (name: string) => field(name).querySelector('button') as HTMLButtonElement
    const note = (name: string) => field(name).querySelector('.lh-core-note')!.textContent
    return { card, asked, requests, removed, failures, modals, field, button, note }
}

describe('Core & Branching (81): Multihog’s first drawer as the first card', () => {
    it('draws the four captions in Multihog’s order with the hints that say what Lumiverse has no need of, the two buttons, the checklist and the narrator rows', () => {
        const { card, field } = mount()
        expect(card.root.getAttribute('data-lh-card')).toBe('core-branching')
        expect(card.root.querySelector('.lh-card-title')!.textContent).toBe('Core & Branching')
        expect(Array.from(card.root.querySelectorAll('.lh-core-caption')).map((c) => c.textContent)).toEqual(['Chat links', 'Branching', 'Help', 'Narrator card'])
        expect(field('core-links-hint').textContent).toContain('nothing to link or to lock')
        expect(field('core-branching-hint').textContent).toContain('no way to make a chat')
        expect(Array.from(card.root.querySelectorAll('.lh-second-row[data-lh-field]')).map((r) => r.getAttribute('data-lh-field'))).toEqual(['remove-all-chats', 'clean-orphans', 'lumiverse-checklist'])
        expect(field('remove-all-chats').querySelector('button')!.classList.contains('lh-button--danger')).toBe(true)
        expect(field('narrator-rows')).not.toBeNull()
        expect(field('narrator-rows').querySelector('[data-lh-field="narrator-create"]')).not.toBeNull()
        expect(field('lumiverse-checklist-box').hidden).toBe(true)
        // Drawn from the first paint (81-bis), and hidden by a rule of its own, since display: flex beats the attribute (lesson 60).
        expect(field('lumiverse-checklist-box').querySelectorAll('.lh-checklist-item')).toHaveLength(5)
        expect(CORE_CARD_CSS).toContain('.lh-checklist[hidden] { display: none; }')
        expect(CORE_CARD_CSS).toContain('.lh-checklist-item {')
    })

    it('counts every chat’s data, asks in words that name what goes and what stays, removes it, tells the tracker and says so; a refusal removes nothing; nothing to remove says so', async () => {
        const { asked, requests, removed, button, note } = mount({ answers: {
            'maintenance.chatData': { chatIds: ['a', 'b', 'c'], prefsEntries: 4 },
            'maintenance.removeAllChats': { removed: ['a', 'b', 'c'], files: 9, prefsEntries: 4, prefs: {} },
        } })
        button('remove-all-chats').click()
        await settle()
        await settle()
        expect(asked).toEqual([['Remove every chat’s data', expect.stringContaining('all 3 chats'), 'Remove everything']])
        expect(asked[0]![1]).toContain('4 preference entries')
        expect(asked[0]![1]).toContain('the lorebooks and the cartridge stay')
        expect(requests).toEqual(['maintenance.chatData', 'maintenance.removeAllChats'])
        expect(removed).toEqual([1])
        expect(note('remove-all-chats')).toBe('Removed the data of 3 chats (9 files) and 4 preference entries. The lorebooks and the cartridge stand; a chat’s campaign name is minted again when it is next shown.')
        const refused = mount({ confirmed: false, answers: { 'maintenance.chatData': { chatIds: ['a'], prefsEntries: 0 } } })
        refused.button('remove-all-chats').click()
        await settle()
        await settle()
        expect(refused.requests).toEqual(['maintenance.chatData'])
        expect(refused.removed).toEqual([])
        expect(refused.note('remove-all-chats')).toBe('Nothing was removed.')
        const empty = mount({ answers: { 'maintenance.chatData': { chatIds: [], prefsEntries: 0 } } })
        empty.button('remove-all-chats').click()
        await settle()
        await settle()
        expect(empty.asked).toEqual([])
        expect(empty.note('remove-all-chats')).toBe('No chat has any AdventureTime data yet.')
    })

    it('cleans the orphans as Debug & factory reset did (72a), from here', async () => {
        const { asked, requests, removed, button, note } = mount({ answers: {
            'maintenance.orphans': { chatIds: ['x', 'y'], prefsEntries: 1 },
            'maintenance.cleanOrphans': { removed: ['x', 'y'], files: 6, prefsEntries: 1, prefs: {} },
        } })
        button('clean-orphans').click()
        await settle()
        await settle()
        expect(asked.map(([t, , l]) => [t, l])).toEqual([['Clean up orphaned chat data', 'Clean up']])
        expect(requests).toEqual(['maintenance.orphans', 'maintenance.cleanOrphans'])
        expect(removed).toEqual([])
        expect(note('clean-orphans')).toBe('Removed the state of 2 chats (6 files) and 1 preference entries.')
    })

    it('reads a refused op into the note in red and hands it on', async () => {
        const failing = createCoreCard({
            el,
            confirm: async () => true,
            request: async () => { throw new Error('the host refused') },
            narrator: createNarratorRows({ el, create: async (name) => ({ id: 'c1', name, created: true }), savePrefs: async () => undefined, fail: () => undefined }),
            onChatsRemoved: () => undefined,
            fail: () => undefined,
        })
        document.body.append(failing.root)
        ;(failing.root.querySelector('[data-lh-field="remove-all-chats"] button') as HTMLButtonElement).click()
        await settle()
        await settle()
        const note = failing.root.querySelector('[data-lh-field="remove-all-chats"] .lh-core-note') as HTMLElement
        expect(note.textContent).toBe('the host refused')
        expect(note.classList.contains('lh-core-note--problem')).toBe(true)
    })
})

describe('the Lumiverse checklist (81): the Anti-Museum Tour in Lumiverse’s terms', () => {
    it('reads the five items off the status: the dice tool’s standing as the evidence, the passes’ connection and output length (89), the preset’s numbers unreadable, the narrator card to make', () => {
        const unread = checklistItems(null)
        expect(unread.map((i) => [i.id, i.state])).toEqual([['tools', 'unknown'], ['passes', 'unknown'], ['output', 'unknown'], ['context', 'unknown'], ['narrator', 'unknown']])
        expect(unread[3]!.evidence).toContain('presets permission')
        // 89: the narrator's Max Tokens is a reply plus reasoning, not 100,000; the context sits below the maximum by AdventureTime's share.
        expect(unread[2]!.why).toContain('A preset’s numbers never reach these calls')
        expect(unread[2]!.why).toContain('sent as max_tokens on every pass')
        expect(unread[3]!.why).toContain('a reply plus any reasoning, not Multihog’s 100,000')
        expect(unread[3]!.why).toContain('“AdventureTime —” rows')
        expect(unread[3]!.why).toContain('about 6,700 tokens')
        expect(unread[3]!.why).not.toContain('a little below')
        const called = checklistItems(STATUS({ registered: ['RollTheDice'], absent: null, calls: 3, turn: [CALL, CALL] }))
        expect(called[0]).toMatchObject({ state: 'ok', evidence: expect.stringContaining('called it 2 times') })
        const idle = checklistItems(STATUS({ registered: ['RollTheDice'], absent: null, calls: 0, turn: [] }))
        expect(idle[0]).toMatchObject({ state: 'warn', evidence: expect.stringContaining('made no call') })
        expect(checklistItems(STATUS({ registered: [], absent: 'refused', calls: 0, turn: [] }))[0]!.state).toBe('bad')
        expect(checklistItems(STATUS({ registered: [], absent: 'combat', calls: 0, turn: [] }))[0]!.state).toBe('warn')
        expect(checklistItems(STATUS({ registered: [], absent: 'mode', calls: 0, turn: [] }))[0]).toMatchObject({ state: 'warn', evidence: expect.stringContaining('the queue is in use') })
        expect(checklistItems(STATUS({ registered: [], absent: 'flags', calls: 0, turn: [] }))[0]!.state).toBe('warn')
    })

    // 89: the connection a blank row runs on, with its reason, and the output length against the provider.
    it('names the connection the passes run on and why, warns on the first-listed fallback, fails on none, and reads the output length against the provider', () => {
        const seen = checklistItems(STATUS(undefined, PASSES()))
        expect(seen[1]).toMatchObject({ id: 'passes', state: 'ok', evidence: 'A blank row runs on Main (anthropic · claude): the narrator’s connection, seen writing the last reply. Every connection row under Connections & models means this one when left blank.' })
        expect(checklistItems(STATUS(undefined, PASSES({ why: 'chat' })))[1]!.evidence).toContain('the chat’s own connection')
        expect(checklistItems(STATUS(undefined, PASSES({ why: 'default', model: '' })))[1]!.evidence).toContain('runs on Main (anthropic): Lumiverse’s default-ticked connection')
        const first = checklistItems(STATUS(undefined, PASSES({ why: 'first', provider: 'openai', model: 'mini' })))
        expect(first[1]).toMatchObject({ state: 'warn', evidence: expect.stringContaining('none is ticked Set as default connection') })
        expect(first[1]!.evidence).toContain('Tick Set as default connection on the one you mean')
        const none = checklistItems(STATUS(undefined, PASSES({ id: null, name: '', provider: '', model: '', why: 'none', listed: 0 })))
        expect(none[1]).toMatchObject({ state: 'bad', evidence: expect.stringContaining('Lumiverse lists no connection') })
        // The output length: set is seen right; blank on Anthropic is the 4,096 fallback to warn of; blank elsewhere is unreadable.
        expect(seen[2]).toMatchObject({ state: 'warn', evidence: expect.stringContaining('fallback of 4,096 tokens') })
        expect(checklistItems(STATUS(undefined, PASSES({ maxTokens: 6000 })))[2]).toMatchObject({ state: 'ok', evidence: 'Output length for AdventureTime’s calls is 6,000 tokens, sent on every pass.' })
        expect(checklistItems(STATUS(undefined, PASSES({ provider: 'openai' })))[2]).toMatchObject({ state: 'unknown', evidence: expect.stringContaining('provider’s own default (openai)') })
        expect(none[2]!.state).toBe('unknown')
    })

    it('opens in the host’s modal with the items and the count, follows the status while open, closes on a second press, and unfolds inline without a modal', async () => {
        const { card, modals, field, button } = mount()
        button('lumiverse-checklist').click()
        expect(modals).toHaveLength(1)
        expect(modals[0]!.title).toBe('Lumiverse checklist')
        const box = modals[0]!.nodes[0]!
        expect(box.hidden).toBe(false)
        expect(Array.from(box.querySelectorAll('.lh-checklist-item')).map((i) => i.getAttribute('data-lh-field'))).toEqual(['checklist-tools', 'checklist-passes', 'checklist-output', 'checklist-context', 'checklist-narrator'])
        expect(box.querySelector('[data-lh-field="checklist-status"]')!.textContent).toBe('0 of 5 seen right here; the rest are Lumiverse’s connection settings to look at.')
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
        expect(field('lumiverse-checklist-box').querySelector('.lh-checklist-lead')!.textContent).toContain('Anti-Museum Tour')
    })

    it('hands the preferences to the narrator rows', () => {
        const { card, field } = mount()
        card.applyPrefs({ narratorCardName: 'Aurelius' })
        expect((field('narrator-rows').querySelector('[data-lh-field="narrator-name"]') as HTMLInputElement).value).toBe('Aurelius')
    })
})
