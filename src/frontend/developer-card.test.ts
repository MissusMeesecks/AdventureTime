// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest'

import { CHAT_DATA_HELP, createDeveloperCard, DEVELOPER_CARD_CSS, describeKeys } from './developer-card.js'

const el = (tag: string, attrs?: Record<string, string>) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n }
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function mount(options: { confirmed?: boolean; answers?: Record<string, unknown>; failOp?: string } = {}) {
    const asked: Array<[string, string, string]> = []
    const requests: string[] = []
    const prefs: Array<Record<string, unknown>> = []
    const seeded: unknown[] = []
    const removed: number[] = []
    const failures: unknown[] = []
    const card = createDeveloperCard({
        el,
        confirm: async (title, message, label) => { asked.push([title, message, label]); return options.confirmed !== false },
        request: async <T,>(op: string) => {
            requests.push(op)
            if (op === options.failOp) throw new Error(`${op} refused`)
            return (options.answers?.[op] ?? {}) as T
        },
        savePrefs: async (patch) => { prefs.push(patch) },
        onSettings: (settings) => { seeded.push(settings) },
        onChatsRemoved: () => { removed.push(1) },
        fail: (error) => { failures.push(error) },
    })
    document.body.append(card.root)
    const field = (name: string) => card.root.querySelector(`[data-lh-field="${name}"]`) as HTMLElement
    const button = (name: string) => field(name).querySelector('button.lh-button') as HTMLButtonElement
    const note = (name: string) => field(name).querySelector('.lh-developer-note')!.textContent
    const help = (name: string) => { const tip = field(name).querySelector('.lh-help-tip'); return tip ? document.getElementById(tip.getAttribute('aria-controls')!) : null }
    const warning = (name: string) => field(name).querySelector('.lh-developer-warning')?.textContent ?? null
    return { card, asked, requests, prefs, seeded, removed, failures, field, button, note, help, warning }
}

describe('Debug & factory reset (72a; every destructive action since 96)', () => {
    it('draws two switches and the buttons, the chat data’s two under their own heading, the factory reset last, the update button hidden until needed', () => {
        const { card, field } = mount()
        expect(card.root.querySelector('.lh-card-title')!.textContent).toBe('Debug & factory reset')
        expect(Array.from(card.root.querySelectorAll('.lh-developer-row')).map((r) => r.getAttribute('data-lh-field'))).toEqual(['debug-logging', 'auto-update-prompts', 'upgrade-stock', 'reset-prompts', 'purge-portraits', 'clean-orphans', 'remove-all-chats', 'factory-reset'])
        expect(Array.from(card.root.querySelectorAll('.lh-developer-row .lh-button')).map((b) => b.textContent)).toEqual(['Update changed prompts', 'Reset all prompts to stock', 'Purge all portraits', 'Clean up data of deleted chats', 'Remove all chat data', 'Factory reset'])
        expect(Array.from(card.root.querySelectorAll('.lh-developer-switch')).map((l) => l.textContent)).toEqual(['Debug logging', 'Refresh stock texts after updates'])
        expect(field('upgrade-stock').hidden).toBe(true)
        expect(field('factory-reset').querySelector('button')!.classList.contains('lh-button--danger')).toBe(true)
        expect(field('remove-all-chats').querySelector('button')!.classList.contains('lh-button--danger')).toBe(true)
        expect(Array.from(card.root.querySelectorAll('.lh-developer-row')).every((r) => r.classList.contains('lh-search-item'))).toBe(true)
        // The heading sits over the two chat-data buttons, its [?] after its text and its note directly under it.
        const heading = field('chat-data-heading')
        expect(heading.firstElementChild!.textContent).toBe('Chat data')
        expect(heading.nextElementSibling!.classList.contains('lh-help-note')).toBe(true)
        expect(heading.nextElementSibling!.textContent).toBe(CHAT_DATA_HELP)
        expect((heading.nextElementSibling as HTMLElement).hidden).toBe(true)
        expect(heading.nextElementSibling!.nextElementSibling).toBe(field('clean-orphans'))
        expect(CHAT_DATA_HELP).toContain('\n\nDifferent from Multihog: there is no chat-linked mode')
        expect(DEVELOPER_CARD_CSS).toContain('.lh-developer [hidden] { display: none; }')
    })

    it('keeps help behind a [?] beside each control, a warning in the open beside a destructive one, and no old always-visible hint', () => {
        const { card, field, help, warning } = mount()
        expect(card.root.querySelector('.lh-developer-hint')).toBeNull()
        // Every [?] is outside a <label>, its note in the row from the first paint and hidden.
        const tips = Array.from(card.root.querySelectorAll('.lh-help-tip'))
        expect(tips).toHaveLength(7)
        for (const tip of tips) {
            expect(tip.closest('label')).toBeNull()
            const note = document.getElementById(tip.getAttribute('aria-controls')!)!
            expect(card.root.contains(note)).toBe(true)
            expect(note.closest('label')).toBeNull()
            expect(note.hidden).toBe(true)
        }
        expect(help('debug-logging')!.textContent).toBe('When on, every model call AdventureTime makes is written to Lumiverse’s Server Logs with its full prompt and reply. Default: off. The Server Logs keep 150 lines by default. Raise the buffer before you turn this on.')
        expect(help('auto-update-prompts')!.textContent).toContain('wait until you press "Update changed prompts". Default: on.')
        expect(help('upgrade-stock')!.textContent).toBe('Puts in the stock texts that an update changed. Texts you edited are kept.')
        expect(warning('reset-prompts')).toBe('Resets every prompt, every tracker and agent module text and the card order to stock. Your edits to them are lost.')
        expect(help('reset-prompts')!.textContent).toBe('Your own world-rule sections, custom fields and game systems are kept. The reset takes effect on the next reply.')
        expect(warning('purge-portraits')).toBe('Clears the portraits of every chat. The picture files stay in Lumiverse, and the NPC library keeps its photos.')
        expect(help('purge-portraits')).toBeNull()
        expect(warning('clean-orphans')).toBeNull()
        expect(help('clean-orphans')!.textContent).toBe('Deletes the data AdventureTime kept for chats that no longer exist in Lumiverse. Chats that still exist are not touched. This cannot be undone.')
        expect(warning('remove-all-chats')).toBe('Deletes AdventureTime’s data for every chat. Your chats and lorebooks are kept. This cannot be undone.')
        expect(help('remove-all-chats')).toBeNull()
        expect(warning('factory-reset')).toBe('Resets the whole cartridge and every preference of this install to defaults. This cannot be undone.')
        expect(help('factory-reset')!.textContent).toContain('Export a cartridge first to keep your prompts and game systems.')
        // Multihog is named only where the card says how it differs.
        const open = Array.from(card.root.querySelectorAll('.lh-developer-warning, .lh-developer-switch, .lh-button')).map((n) => n.textContent).join(' ')
        expect(open).not.toContain('Multihog')
        // A press on a [?] opens its note and ticks nothing.
        const tip = field('debug-logging').querySelector('.lh-help-tip') as HTMLButtonElement
        tip.click()
        expect(help('debug-logging')!.hidden).toBe(false)
        expect((field('debug-logging').querySelector('input') as HTMLInputElement).checked).toBe(false)
    })

    it('writes the two switches as preferences and follows them', () => {
        const { card, field, prefs } = mount()
        const debug = field('debug-logging').querySelector('input') as HTMLInputElement
        debug.checked = true
        debug.dispatchEvent(new Event('change'))
        const auto = field('auto-update-prompts').querySelector('input') as HTMLInputElement
        auto.checked = false
        auto.dispatchEvent(new Event('change'))
        expect(prefs).toEqual([{ debugLogging: true }, { autoUpdatePrompts: false }])
        card.applyPrefs({ debugLogging: false, autoUpdatePrompts: true })
        expect(debug.checked).toBe(false)
        expect(auto.checked).toBe(true)
    })

    it('asks before each reset under the action’s name with the verb on the button, runs the op, re-seeds the editors and says what it did', async () => {
        const { asked, requests, seeded, button, note } = mount({ answers: {
            'maintenance.resetPrompts': { settings: { a: 1 } },
            'maintenance.purgePortraits': { chats: 2, portraits: 5 },
            'maintenance.factoryReset': { settings: { a: 2 }, prefs: {} },
        } })
        button('reset-prompts').click()
        await settle()
        button('purge-portraits').click()
        await settle()
        button('factory-reset').click()
        await settle()
        expect(asked.map(([t, , l]) => [t, l])).toEqual([['Reset all prompts to stock', 'Reset prompts'], ['Purge all portraits', 'Purge portraits'], ['Factory reset', 'Reset to factory']])
        expect(asked[0]![1]).toBe('Reset every prompt and module text to stock? Your edits to them are lost. Your own world-rule sections, custom fields and game systems are kept.')
        expect(asked[2]![1]).toContain('Reset AdventureTime to factory defaults?')
        expect(asked.map(([, m]) => m).join(' ')).not.toContain('Multihog')
        expect(requests).toEqual(['maintenance.resetPrompts', 'maintenance.purgePortraits', 'maintenance.factoryReset'])
        expect(seeded).toEqual([{ a: 1 }, { a: 2 }])
        expect(note('reset-prompts')).toBe('Every prompt and module text is stock again.')
        expect(note('purge-portraits')).toBe('Cleared 5 portraits across 2 chats.')
        expect(note('factory-reset')).toBe('Reset to factory defaults. Reload the page to move the widgets back to their default places.')
    })

    it('counts every chat’s data, asks in words that name what goes and what stays, removes it, tells the tracker and says so; a refusal removes nothing; nothing to remove says so (96: from Core & Branching)', async () => {
        const { asked, requests, removed, button, note } = mount({ answers: {
            'maintenance.chatData': { chatIds: ['a', 'b', 'c'], prefsEntries: 4 },
            'maintenance.removeAllChats': { removed: ['a', 'b', 'c'], files: 9, prefsEntries: 4, prefs: {} },
        } })
        button('remove-all-chats').click()
        await settle()
        await settle()
        expect(asked).toEqual([['Remove all chat data', 'Remove AdventureTime’s data for all 3 chats? This deletes every memo, history, portrait, Player Card and relationship, and 4 per-chat settings. The chats, the lorebooks and the cartridge stay. This cannot be undone.', 'Remove all']])
        expect(requests).toEqual(['maintenance.chatData', 'maintenance.removeAllChats'])
        expect(removed).toEqual([1])
        expect(note('remove-all-chats')).toBe('Removed the data of 3 chats (9 files) and 4 per-chat settings. The lorebooks and the cartridge are kept. Each chat gets a new campaign name when it is next opened.')
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

    it('cleans up the data of deleted chats after a confirm that counts them, and leaves the tracker alone', async () => {
        const { asked, requests, removed, button, note } = mount({ answers: {
            'maintenance.orphans': { chatIds: ['x', 'y'], prefsEntries: 1 },
            'maintenance.cleanOrphans': { removed: ['x', 'y'], files: 6, prefsEntries: 1, prefs: {} },
        } })
        button('clean-orphans').click()
        await settle()
        await settle()
        expect(asked).toEqual([['Clean up data of deleted chats', 'Remove the data of 2 chats that no longer exist in Lumiverse, and 1 per-chat settings? This cannot be undone.', 'Clean up']])
        expect(requests).toEqual(['maintenance.orphans', 'maintenance.cleanOrphans'])
        expect(removed).toEqual([])
        expect(note('clean-orphans')).toBe('Removed the data of 2 chats (6 files) and 1 per-chat settings.')
        const refused = mount({ confirmed: false, answers: { 'maintenance.orphans': { chatIds: ['x'], prefsEntries: 0 } } })
        refused.button('clean-orphans').click()
        await settle()
        await settle()
        expect(refused.requests).toEqual(['maintenance.orphans'])
        expect(refused.note('clean-orphans')).toBe('Nothing was removed.')
        const none = mount({ answers: { 'maintenance.orphans': { chatIds: [], prefsEntries: 0 } } })
        none.button('clean-orphans').click()
        await settle()
        await settle()
        expect(none.asked).toEqual([])
        expect(none.note('clean-orphans')).toBe('Nothing to clean up. Every chat with AdventureTime data still exists.')
    })

    it('does nothing when the confirm is declined', async () => {
        const { asked, requests, button, note } = mount({ confirmed: false })
        button('factory-reset').click()
        await settle()
        expect(requests).toEqual([])
        expect(note('factory-reset')).toBe('Not reset.')
        expect(asked.map(([t]) => t)).toEqual(['Factory reset'])
    })

    it('names a refusal in the row’s note in red and reports it', async () => {
        const { button, note, failures, field } = mount({ failOp: 'maintenance.purgePortraits' })
        button('purge-portraits').click()
        await settle()
        expect(note('purge-portraits')).toBe('maintenance.purgePortraits refused')
        expect(field('purge-portraits').querySelector('.lh-developer-note')!.classList.contains('lh-developer-note--problem')).toBe(true)
        expect(failures).toHaveLength(1)
        const chats = mount({ failOp: 'maintenance.chatData' })
        chats.button('remove-all-chats').click()
        await settle()
        await settle()
        expect(chats.note('remove-all-chats')).toBe('maintenance.chatData refused')
        expect(chats.failures).toHaveLength(1)
    })

    it('shows the update button with the status’s pending texts, and updates on demand', async () => {
        const { card, field, button, note, requests, seeded } = mount({ answers: { 'settings.upgradeStock': { settings: { a: 3 }, refreshed: ['systemPromptTemplate', 'stockPrompts.party'], kept: ['routerModules.npc.instruction'] } } })
        card.applyStatus({ version: '1', granted: [], missing: [], checked: true, stockUpgrade: { refreshed: [], kept: [], pending: ['systemPromptTemplate', 'stockPrompts.party'], at: 't' } })
        expect(field('upgrade-stock').hidden).toBe(false)
        expect(note('upgrade-stock')).toBe('An update changed 2 stock texts that were not refreshed: systemPromptTemplate, stockPrompts.party.')
        button('upgrade-stock').click()
        await settle()
        expect(requests).toEqual(['settings.upgradeStock'])
        expect(seeded).toEqual([{ a: 3 }])
        expect(note('upgrade-stock')).toBe('Refreshed 2 texts: systemPromptTemplate, stockPrompts.party. Kept 1 edited texts: routerModules.npc.instruction.')
        // A status that refreshed on its own says so too.
        card.applyStatus({ version: '1', granted: [], missing: [], checked: true, stockUpgrade: { refreshed: ['a'], kept: ['b'], pending: [], at: 't' } })
        expect(note('upgrade-stock')).toBe('Refreshed 1 texts after the last update: a. Kept 1 edited texts: b.')
        expect(describeKeys(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])).toBe('a, b, c, d, e, f and 2 more')
    })
})
