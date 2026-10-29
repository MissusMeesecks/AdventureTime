// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'

import type { CardChoice, LibraryRecordView, NpcAddResult, NpcDraftResult } from '../protocol.js'
import { describeLibrarySave, EDITOR_TAB_CSS, EDITOR_TAB_GUIDE, mountEditorTab, type EditorState, type EditorTab, type EditorTabHost } from './editor-tab.js'

afterEach(() => { document.body.replaceChildren() })

const CARDS: CardChoice[] = [{ id: 'c1', name: 'Igor Vask', snippet: 'A hunchbacked porter.' }, { id: 'c2', name: 'Orrin', snippet: '' }]
const SAVED: LibraryRecordView = { id: 'k1', name: 'Igor Vask', keys: ['Igor Vask', 'Igor'], content: '[CORE]\nA porter.\n[/CORE]', portraitPath: 'https://host/igor.png', notes: '', createdAt: 1, updatedAt: 2, blurb: 'A porter.' }
const ADDED: NpcAddResult = { status: 'added', at: '2026-10-11T10:00:00Z', name: 'Igor Vask', book: 'Vell_NPC', entryId: 'Vell_NPC::7', how: 'reviewed', portrait: true }
const DRAFTED: NpcDraftResult = { status: 'drafted', at: '2026-10-11T10:00:00Z', how: 'fit', source: 'Igor Vask', name: 'Mira Voss', tag: '[[NPC: Mira Voss | [CORE]\nSpecies: Elf\n[/CORE] | Mira Voss, Mira]]', duplicate: false }

function harness(over: Partial<EditorTabHost> & { state?: EditorState; chat?: { chatId: string | null; characterId: string | null } } = {}) {
    const calls: unknown[][] = []
    const { state = { open: true, characterId: 'c1' }, chat = { chatId: 'chat-1', characterId: 'narrator' }, ...rest } = over
    let current = state
    let active = chat
    const handlers = new Set<(state: EditorState) => void>()
    const host: EditorTabHost = {
        el: (tag, attrs) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n },
        editor: {
            getState: () => current,
            onChange: (handler) => { handlers.add(handler); return () => { handlers.delete(handler) } },
        },
        activeChat: () => active,
        cards: async () => { calls.push(['cards']); return { cards: CARDS } },
        prefs: async () => { calls.push(['prefs']); return { npcAddAsIsMode: 'literal' } },
        savePrefs: async (patch) => { calls.push(['savePrefs', patch]) },
        saveCard: async (request) => { calls.push(['saveCard', request]); return SAVED },
        add: async (request) => { calls.push(['add', request]); return ADDED },
        draft: async (request) => { calls.push(['draft', request]); return DRAFTED },
        commit: async (request) => { calls.push(['commit', request]); return { ...ADDED, name: 'Mira Voss', how: 'fit', portrait: false } },
        confirm: async (message) => { calls.push(['confirm', message]); return true },
        fail: (e) => calls.push(['fail', e]),
        when: (iso) => `at ${iso}`,
        ...rest,
    }
    const root = document.createElement('div')
    document.body.append(root)
    const tab = mountEditorTab(root, host)
    const change = (next: Partial<EditorState>) => { current = { ...current, ...next }; for (const h of handlers) h(current) }
    const switchChat = (next: { chatId: string | null; characterId: string | null }) => { active = next }
    return { tab, root, calls, host, change, switchChat, handlers }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const field = (tab: EditorTab, name: string) => tab.root.querySelector(`[data-lh-field="editor-${name}"]`) as HTMLElement & { value: string; disabled: boolean; title: string; click(): void }
const note = (tab: EditorTab) => tab.root.querySelector('.lh-editor-note')!.textContent ?? ''
const live = (tab: EditorTab) => tab.root.querySelector('.lh-world-running') as HTMLElement

describe('the words', () => {
    it('says what a library save did', () => {
        expect(describeLibrarySave(SAVED)).toBe('Saved “Igor Vask” to the NPC library with its portrait. The NPC library fold puts them into play.')
        expect(describeLibrarySave({ ...SAVED, portraitPath: '' })).toBe('Saved “Igor Vask” to the NPC library. The NPC library fold puts them into play.')
        expect(describeLibrarySave({ status: 'exists', name: 'Igor Vask' })).toBe('“Igor Vask” is already in the NPC library; nothing was saved.')
    })

    it('has a guide naming the three ways and the saved-card caveat, and a stylesheet scoped to the tab', () => {
        for (const words of ['Save to the NPC library', 'Add as is', 'Fit into story', 'as saved']) expect(EDITOR_TAB_GUIDE).toContain(words)
        expect(EDITOR_TAB_CSS).toMatch(/\.lh-editor-section\s*\{/)
    })
})

describe('mounting', () => {
    it('dresses the root as a panel root (lesson 56), names the card from the host\'s list, and reads the preference once', async () => {
        const { tab, root, calls } = harness()
        expect(root.classList.contains('adventuretime-panel')).toBe(true)
        expect(field(tab, 'title').textContent).toBe('Send “this character” to AdventureTime')
        await settle()
        expect(field(tab, 'title').textContent).toBe('Send “Igor Vask” to AdventureTime')
        expect(field(tab, 'mode-input').value).toBe('literal')
        expect(calls).toEqual([['cards'], ['prefs']])
    })

    it('does not read the cards while the editor is closed, and reads them when it opens', async () => {
        const { tab, calls, change } = harness({ state: { open: false, characterId: null } })
        await settle()
        expect(calls).toEqual([])
        expect(field(tab, 'save-library').disabled).toBe(true)
        expect(field(tab, 'save-library').title).toBe('Open a character in the editor first.')
        change({ open: true, characterId: 'c2' })
        await settle()
        expect(calls).toEqual([['cards'], ['prefs']])
        expect(field(tab, 'title').textContent).toBe('Send “Orrin” to AdventureTime')
        expect(field(tab, 'save-library').disabled).toBe(false)
    })

    it('looks a card the list lacks up once more, and not again', async () => {
        const { calls, change } = harness()
        await settle()
        change({ characterId: 'new-card' })
        await settle()
        change({ characterId: 'c1' })
        change({ characterId: 'new-card' })
        await settle()
        expect(calls.filter((c) => c[0] === 'cards')).toHaveLength(2)
    })

    it('says when no chat is open and keeps the chat buttons off; names the open chat\'s own character', () => {
        const none = harness({ chat: { chatId: null, characterId: null } })
        expect(field(none.tab, 'chat-line').textContent).toMatch(/^No chat is open/)
        expect(field(none.tab, 'add').disabled).toBe(true)
        expect(field(none.tab, 'fit').disabled).toBe(true)
        expect(field(none.tab, 'add').title).toBe('Open a chat first.')
        expect(field(none.tab, 'save-library').disabled).toBe(false)
        const own = harness({ chat: { chatId: 'chat-1', characterId: 'c1' } })
        expect(field(own.tab, 'chat-line').textContent).toContain('This is the open chat’s own character.')
        expect(field(own.tab, 'add').disabled).toBe(false)
        // The chat changing under the editor is read again on refresh.
        own.switchChat({ chatId: null, characterId: null })
        own.tab.refresh()
        expect(field(own.tab, 'add').disabled).toBe(true)
    })

    it('unsubscribes from the editor and empties the root on destroy', () => {
        const { tab, root, handlers } = harness()
        expect(handlers.size).toBe(1)
        tab.destroy()
        expect(handlers.size).toBe(0)
        expect(root.childElementCount).toBe(0)
    })
})

describe('the NPC library', () => {
    it('saves the card by id and says so', async () => {
        const { tab, calls } = harness()
        await settle()
        field(tab, 'save-library').click()
        expect(tab.busy()).toBe(true)
        expect(live(tab).textContent).toBe('📚 Saving “Igor Vask” to the NPC library…')
        expect(field(tab, 'save-library').disabled).toBe(true)
        await settle()
        expect(calls.filter((c) => c[0] === 'saveCard')).toEqual([['saveCard', { characterId: 'c1' }]])
        expect(note(tab)).toBe('Saved “Igor Vask” to the NPC library with its portrait. The NPC library fold puts them into play.')
        expect(tab.busy()).toBe(false)
        expect(live(tab).hidden).toBe(true)
    })

    it('asks before replacing a kept name, and replaces only on yes', async () => {
        let answer = false
        const { tab, calls } = harness({
            saveCard: async (request) => { calls.push(['saveCard', request]); return request.overwrite ? SAVED : { status: 'exists', name: 'Igor Vask' } },
            confirm: async (message) => { calls.push(['confirm', message]); return answer },
        })
        await settle()
        field(tab, 'save-library').click()
        await settle()
        expect(calls.filter((c) => c[0] !== 'cards' && c[0] !== 'prefs')).toEqual([
            ['saveCard', { characterId: 'c1' }],
            ['confirm', 'The NPC library already has “Igor Vask”. Replace it with this card?'],
        ])
        expect(note(tab)).toBe('“Igor Vask” is already in the NPC library; nothing was saved.')
        answer = true
        field(tab, 'save-library').click()
        await settle()
        expect(calls.at(-1)).toEqual(['saveCard', { characterId: 'c1', overwrite: true }])
        expect(note(tab)).toMatch(/^Saved “Igor Vask” to the NPC library/)
    })

    it('leaves a kept name alone when the host cannot ask, and names a failure', async () => {
        const { tab, calls } = harness({ confirm: undefined, saveCard: async (request) => { calls.push(['saveCard', request]); return { status: 'exists', name: 'Igor Vask' } } })
        await settle()
        field(tab, 'save-library').click()
        await settle()
        expect(calls.filter((c) => c[0] === 'saveCard')).toHaveLength(1)
        expect(note(tab)).toBe('“Igor Vask” is already in the NPC library; nothing was saved.')
        const broken = harness({ saveCard: async () => { throw new Error('the host has not granted the characters permission, so no card can be read.') } })
        await settle()
        field(broken.tab, 'save-library').click()
        await settle()
        expect(note(broken.tab)).toBe('The card was not saved: the host has not granted the characters permission, so no card can be read.')
        expect(broken.tab.root.querySelector('.lh-editor-note')!.classList.contains('lh-world-note--error')).toBe(true)
    })
})

describe('the open chat', () => {
    it('adds as is into the chat open at the press, with its narrator, and says what came back', async () => {
        const { tab, calls, switchChat } = harness()
        await settle()
        switchChat({ chatId: 'chat-2', characterId: 'n2' })
        field(tab, 'add').click()
        expect(live(tab).textContent).toBe('➕ Adding “Igor Vask” to the NPC book…')
        await settle()
        expect(calls.filter((c) => c[0] === 'add')).toEqual([['add', { chatId: 'chat-2', narratorCharacterId: 'n2', source: { kind: 'card', characterId: 'c1' } }]])
        expect(note(tab)).toBe('Added “Igor Vask” to Vell_NPC after a review for the world. Their portrait is placed. The agent reads it from here on. Ran at 2026-10-11T10:00:00Z.')
    })

    it('sends no narrator field when the chat has no character, and names an add that was refused', async () => {
        const { tab, calls } = harness({ chat: { chatId: 'chat-1', characterId: null }, add: async (request) => { calls.push(['add', request]); return { status: 'exists', at: 't', name: 'Igor Vask', book: 'Vell_NPC', how: 'literal' } } })
        await settle()
        field(tab, 'add').click()
        await settle()
        expect(calls.filter((c) => c[0] === 'add')).toEqual([['add', { chatId: 'chat-1', source: { kind: 'card', characterId: 'c1' } }]])
        expect(note(tab)).toBe('“Igor Vask” is already in Vell_NPC; nothing was added. Ran at t.')
        expect(tab.root.querySelector('.lh-editor-note')!.classList.contains('lh-world-note--error')).toBe(true)
    })

    it('drafts into the preview, commits the edited tag with the card as the portrait, and clears the preview', async () => {
        const { tab, calls } = harness()
        await settle()
        expect(field(tab, 'preview').hidden).toBe(true)
        field(tab, 'fit').click()
        expect(live(tab).textContent).toBe('🤖 Drafting an NPC from “Igor Vask”… the entry appears below when it is ready.')
        await settle()
        expect(calls.filter((c) => c[0] === 'draft')).toEqual([['draft', { chatId: 'chat-1', narratorCharacterId: 'narrator', source: { kind: 'card', characterId: 'c1' } }]])
        expect(field(tab, 'preview').hidden).toBe(false)
        expect(field(tab, 'preview-input').value).toBe(DRAFTED.tag)
        expect(note(tab)).toBe('Drafted “Mira Voss” — read it below, change what you like, then press Add NPC.')
        field(tab, 'preview-input').value = '[[NPC: Mira Vossen | [CORE]\nSpecies: Elf\n[/CORE] | Mira]]'
        field(tab, 'commit').click()
        expect(live(tab).textContent).toBe('➕ Adding “Mira Vossen”…')
        await settle()
        expect(calls.filter((c) => c[0] === 'commit')).toEqual([['commit', { chatId: 'chat-1', tag: '[[NPC: Mira Vossen | [CORE]\nSpecies: Elf\n[/CORE] | Mira]]', name: 'Mira Vossen', how: 'fit', portrait: { kind: 'card', characterId: 'c1' } }]])
        expect(field(tab, 'preview').hidden).toBe(true)
        expect(note(tab)).toMatch(/^Added “Mira Voss” to Vell_NPC fitted into the story\./)
    })

    it('warns of a duplicate in the preview, cancels, and forgets the draft when the editor turns to another card', async () => {
        const { tab, change } = harness({ draft: async () => ({ ...DRAFTED, duplicate: true }) })
        await settle()
        field(tab, 'fit').click()
        await settle()
        expect(tab.root.querySelector('.lh-npc-warning')!.textContent).toContain('already in the book')
        field(tab, 'cancel').click()
        expect(field(tab, 'preview').hidden).toBe(true)
        field(tab, 'fit').click()
        await settle()
        expect(field(tab, 'preview').hidden).toBe(false)
        change({ characterId: 'c2' })
        expect(field(tab, 'preview').hidden).toBe(true)
        expect(note(tab)).toBe('')
        expect(field(tab, 'title').textContent).toBe('Send “Orrin” to AdventureTime')
    })

    it('names a draft that failed, and one the bridge refused', async () => {
        const failed = harness({ draft: async () => ({ status: 'failed', at: 't', how: 'fit', source: 'Igor Vask', name: 'Igor Vask', reason: 'the reply had no [[NPC: …]] tag in it' }) })
        await settle()
        field(failed.tab, 'fit').click()
        await settle()
        expect(note(failed.tab)).toBe('Nothing was drafted from “Igor Vask”: the reply had no [[NPC: …]] tag in it. Ran at t.')
        const refused = harness({ add: async () => { throw new Error('npc.add timed out after 180000 ms') } })
        await settle()
        field(refused.tab, 'add').click()
        await settle()
        expect(note(refused.tab)).toBe('The NPC was not added: npc.add timed out after 180000 ms.')
    })

    it('saves the Add as is preference from its select, takes it from outside, and tells the buttons', async () => {
        const { tab, calls } = harness()
        await settle()
        expect(field(tab, 'add').title).toMatch(/verbatim/)
        field(tab, 'mode-input').value = 'ai_review'
        field(tab, 'mode-input').dispatchEvent(new Event('change'))
        await settle()
        expect(calls.at(-1)).toEqual(['savePrefs', { npcAddAsIsMode: 'ai_review' }])
        expect(field(tab, 'add').title).toMatch(/One model call/)
        tab.applyPrefs({ npcAddAsIsMode: 'literal' })
        expect(field(tab, 'mode-input').value).toBe('literal')
        expect(field(tab, 'add').title).toMatch(/verbatim/)
        tab.applyPrefs({})
        expect(field(tab, 'mode-input').value).toBe('literal')
    })

    it('runs one action at a time', async () => {
        let release: () => void = () => undefined
        const { tab, calls } = harness({ add: async (request) => { calls.push(['add', request]); await new Promise<void>((resolve) => { release = resolve }); return ADDED } })
        await settle()
        field(tab, 'add').click()
        // The buttons are off while an action runs; a press that slips past
        // that (a stale draw, a host re-enabling them) is refused as well.
        for (const name of ['add', 'save-library', 'fit']) {
            expect(field(tab, name).disabled).toBe(true)
            field(tab, name).disabled = false
            field(tab, name).click()
        }
        expect(calls.filter((c) => ['add', 'saveCard', 'draft'].includes(c[0] as string))).toHaveLength(1)
        release()
        await settle()
        expect(tab.busy()).toBe(false)
    })
})
