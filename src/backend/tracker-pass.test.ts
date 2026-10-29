import { describe, expect, it, vi } from 'vitest'

import { MemoStore, type MemoStorage } from './memo-store.js'
import { MemoHistoryStore } from './memo-history.js'
import { ReportHistoryStore } from './report-history.js'
import { QuestArchiveStore } from './quest-archive.js'
import {
    createTrackerPass,
    numberedNarrative,
    selectNarrativeWindow,
    trackerPassResolvers,
    formatNarrative,
    readGenerationText,
    type ChatMessage,
    messageNumberOf,
    SAMPLE_LENGTH,
    syncQuests,
    type TrackerPassDeps,
    narrativeText,
} from './tracker-pass.js'

const SETTINGS = {
    systemPromptTemplate: 'You are the State Extractor Model.',
    stockPrompts: { time: 'Track the clock.' },
    modules: { time: true },
}

const MESSAGES: ChatMessage[] = [
    // Numbered as the host numbers them, deliberately not from zero: a number
    // derived from the position in this array would pass a test that starts at
    // 0 and be wrong against a real chat.
    { id: 'm1', role: 'user', content: 'I open the door.', index_in_chat: 20 },
    { id: 'm2', role: 'assistant', content: 'It is locked. An hour passes.', index_in_chat: 21 },
]

function fakeStorage(): MemoStorage {
    const files = new Map<string, unknown>()
    return {
        async getJson<T>(path: string, options?: { fallback?: T }): Promise<T> {
            return (files.has(path) ? files.get(path) : options?.fallback) as T
        },
        async setJson(path: string, value: unknown): Promise<void> {
            files.set(path, JSON.parse(JSON.stringify(value)))
        },
    }
}

function harness(reply: string | string[] = '<memo>[TIME]\n07:00 AM, Day 4\n[/TIME]</memo>') {
    const replies = Array.isArray(reply) ? [...reply] : [reply]
    const quiet = vi.fn(async (_input: Record<string, unknown>) => ({
        content: replies.length > 1 ? replies.shift() : replies[0],
    }))
    const storage = fakeStorage()
    const memos = new MemoStore(storage)
    const archive = new QuestArchiveStore(storage)
    const history = new MemoHistoryStore(storage)
    const reports = new ReportHistoryStore(storage)
    const changes: unknown[] = []
    const starts: Array<{ chatId: string; userId?: string; at: string; trigger: string }> = []

    const deps: TrackerPassDeps = {
        chat: { getMessages: vi.fn(async (_chatId: string) => MESSAGES) },
        settings: { load: vi.fn(async (_userId?: string) => SETTINGS as Record<string, unknown>) },
        memos,
        archive,
        history,
        reports,
        generate: { quiet },
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        onPassStart: (event) => { starts.push(event) },
        onPassComplete: (event) => { changes.push(event) },
    }

    /** Every pass event, and just the ones that actually moved the memo. */
    const updates = () => changes.filter((c) => (c as { report: { status: string } }).report.status === 'updated')

    /** The archived quests' titles, newest first. */
    const archived = async (chatId = 'c1', userId?: string) =>
        (await archive.load(chatId, userId)).quests.map((e) => e.quest.title)

    return { pass: createTrackerPass(deps), deps, memos, archive, archived, history, reports, quiet, changes, starts, updates }
}

describe('the report history (47e)', () => {
    it('keeps every pass\'s report, newest first, whatever its outcome', async () => {
        const h = harness(['<memo>[TIME]\n08:00 AM, Day 1\n[/TIME]</memo>', '<memo>[TIME]\n09:00 AM, Day 1\n[/TIME]</memo>', 'nonsense'])
        await h.pass.run({ chatId: 'c1', userId: 'u1' })
        await h.pass.run({ chatId: 'c1', userId: 'u1' })
        await h.pass.run({ chatId: 'c1', userId: 'u1' })
        const kept = (await h.reports.load('c1', 'u1')).tracker
        expect(kept.length).toBe(3)
        expect(kept.map((r: { status: string }) => r.status)).toEqual(h.changes.map((c: unknown) => (c as { report: { status: string } }).report.status).reverse())
        expect(kept[0]!.at >= kept[2]!.at).toBe(true)
    })

    it('still reports the pass when the history write fails', async () => {
        const h = harness()
        h.deps.reports = { recordTracker: async () => { throw new Error('disk gone') } }
        await h.pass.run({ chatId: 'c1', userId: 'u1' })
        expect(h.changes.length).toBe(1)
        expect(h.deps.log.warn).toHaveBeenCalledWith(expect.stringMatching(/could not keep the tracker report in the history/))
    })
})

describe('readGenerationText', () => {
    it.each([
        ['a plain string', 'hello', 'hello'],
        ['a response object', { content: 'hello' }, 'hello'],
        ['a response with no content', { finish_reason: 'stop' }, ''],
        ['null', null, ''],
        ['a number', 42, ''],
    ])('reads %s', (_label, input, expected) => {
        expect(readGenerationText(input)).toBe(expected)
    })
})

describe('formatNarrative', () => {
    it('labels each side and keeps only the most recent', () => {
        expect(formatNarrative(MESSAGES, 1)).toEqual(['GM: It is locked. An hour passes.'])
        expect(formatNarrative(MESSAGES, 5)).toEqual([
            'User: I open the door.',
            'GM: It is locked. An hour passes.',
        ])
    })

    // A choice is what might happen next, not what did (Phase 31).
    it('reads a narrator reply without its choices', () => {
        const messages: ChatMessage[] = [
            { role: 'user', content: 'I open the door. <choices><button>quoted</button></choices>' },
            { role: 'assistant', content: 'It is locked.\n<choices>\n<button>1. Force it — [-1 HP]</button>\n<button>2. Leave</button>\n</choices>' },
        ]
        expect(formatNarrative(messages, 5)).toEqual([
            'User: I open the door. <choices><button>quoted</button></choices>',
            'GM: It is locked.',
        ])
        expect(narrativeText(messages[1]!)).toBe('It is locked.')
        const { lines } = numberedNarrative([{ ...messages[1]!, id: 'm9', index_in_chat: 9 }], 5)
        expect(lines.join('\n')).not.toContain('<choices>')
        expect(lines.join('\n')).toContain('It is locked.')
    })

    it('leaves out system messages and blank ones', () => {
        const messages: ChatMessage[] = [
            { role: 'system', content: 'You are a GM.' },
            { role: 'user', content: '   ' },
            { role: 'user', content: 'Hello.' },
        ]
        expect(formatNarrative(messages, 10)).toEqual(['User: Hello.'])
    })
})

describe('a successful pass', () => {
    it('merges the reply into the memo and saves it', async () => {
        const { pass, memos } = harness()
        const outcome = await pass.run({ chatId: 'c1', messageId: 'm2', generationType: 'normal' })

        expect(outcome.status).toBe('updated')
        expect((await memos.load('c1')).memo).toContain('07:00 AM, Day 4')
    })

    it('sends the prior memo and the narrative to the model', async () => {
        const { pass, memos, quiet } = harness()
        await memos.save('c1', '[TIME]\n06:15 AM, Day 4\n[/TIME]')
        await pass.run({ chatId: 'c1', messageId: 'm2' })

        const sent = quiet.mock.calls[0]![0] as unknown as { messages: Array<{ role: string; content: string }> }
        expect(sent.messages[0].content).toContain('You are the State Extractor Model.')
        expect(sent.messages[0].content).toContain('- [TIME]: Track the clock.')
        expect(sent.messages[1].content).toContain('06:15 AM, Day 4')
        expect(sent.messages[1].content).toContain('It is locked. An hour passes.')
    })

    it('goes through the macro-resolving wrapper with the chat in context', async () => {
        // Never spindle.generate directly — that would send {{char}} literally.
        const { pass, quiet } = harness()
        await pass.run({ chatId: 'c1', userId: 'u1' })
        expect(quiet.mock.calls[0]![0]).toMatchObject({ chatId: 'c1', userId: 'u1' })
    })

    it('announces the change so the panel can redraw', async () => {
        const { pass, updates } = harness()
        await pass.run({ chatId: 'c1' })
        expect(updates()).toHaveLength(1)
        expect(updates()[0]).toMatchObject({ chatId: 'c1' })
    })

    it('records what it did, block by block', async () => {
        const { pass, memos } = harness('<memo>[TIME]\nnew\n[/TIME]\n[XP]\n1/2\n[/XP]</memo>')
        await memos.save('c1', '[TIME]\nold\n[/TIME]')
        const outcome = await pass.run({ chatId: 'c1' })
        expect(outcome.delta).toMatchObject({ replaced: ['TIME'], added: ['XP'] })
    })

    // A bench reads as "updated PARTY" otherwise, which is also what losing a
    // member looks like; the report names who moved.
    it('reports a benched member by name', async () => {
        const { pass, memos, changes } = harness('<memo>[BENCHED PARTY]\n[BENCH] Oswin — stayed with the horse\n[/BENCHED PARTY]</memo>')
        await memos.save('c1', '[TIME]\n07:00 AM, Day 4\n[/TIME]\n\n[PARTY]\n- Oswin (Guard 1): 9/11 HP\nCombat: BAB: +1\nStatus: Healthy\n[/PARTY]')
        const outcome = await pass.run({ chatId: 'c1' })
        expect(outcome.report).toMatchObject({ status: 'updated', benched: ['Oswin (Guard 1)'] })
        expect(outcome.report.unbenched).toBeUndefined()
        expect((changes[0] as { report: { benched?: string[] } }).report.benched).toEqual(['Oswin (Guard 1)'])
        expect(outcome.memo).toContain('[BENCHED PARTY]\n- Oswin (Guard 1): 9/11 HP')
    })

    it('says so when the bench command names nobody on the roster', async () => {
        // The first live bench: "[BENCH] Oswin" against a header of "Advisor".
        const { pass, memos, deps } = harness('<memo>[BENCHED PARTY]\n[BENCH] Oswin — to the village\n[/BENCHED PARTY]</memo>')
        await memos.save('c1', '[TIME]\n07:00 AM, Day 4\n[/TIME]\n\n[PARTY]\n- Advisor (Expert 1): 6/6 HP\nCombat: BAB: +0\nStatus: Healthy\n[/PARTY]')
        const outcome = await pass.run({ chatId: 'c1' })
        expect(outcome.report).toMatchObject({ status: 'no-change', unmatched: ['Oswin'] })
        expect(outcome.report.reason).toMatch(/nobody on the roster has that name/)
        expect(outcome.report.reason).toContain('Oswin')
        expect((await memos.load('c1')).memo).toContain('- Advisor (Expert 1)')
        // And when other blocks moved in the same reply, the report still carries it.
        const { pass: pass2, memos: memos2 } = harness('<memo>[TIME]\n08:00 AM, Day 4\n[/TIME]\n[BENCH] Oswin\n</memo>')
        await memos2.save('c1', '[TIME]\n07:00 AM, Day 4\n[/TIME]\n\n[PARTY]\n- Advisor (Expert 1): 6/6 HP\nCombat: BAB: +0\nStatus: Healthy\n[/PARTY]')
        const second = await pass2.run({ chatId: 'c1' })
        expect(second.report).toMatchObject({ status: 'updated', unmatched: ['Oswin'] })
        expect((deps.log.info as ReturnType<typeof vi.fn>).mock.calls.flat().join('\n')).not.toContain('no member called')
    })
})

describe('a pass that should change nothing', () => {
    it('leaves the memo alone when the model returns prose', async () => {
        const { pass, memos } = harness('Nothing changed this turn.')
        await memos.save('c1', '[TIME]\n06:15 AM\n[/TIME]')

        const outcome = await pass.run({ chatId: 'c1' })
        expect(outcome.status).toBe('no-change')
        expect((await memos.load('c1')).memo).toBe('[TIME]\n06:15 AM\n[/TIME]')
    })

    it('leaves the memo alone when the model returns nothing at all', async () => {
        const { pass, memos } = harness('')
        await memos.save('c1', '[TIME]\n06:15 AM\n[/TIME]')

        expect((await pass.run({ chatId: 'c1' })).status).toBe('no-change')
        expect((await memos.load('c1')).memo).toBe('[TIME]\n06:15 AM\n[/TIME]')
    })

    it('announces that it ran even when nothing changed', async () => {
        // A tracker that reports only its successes is indistinguishable from
        // a broken one, which is exactly the position a user is left in when
        // state stops moving.
        const { pass, changes, updates } = harness('Nothing changed.')
        await pass.run({ chatId: 'c1' })
        expect(updates()).toEqual([])
        expect(changes).toHaveLength(1)
        expect(changes[0]).toMatchObject({ report: { status: 'no-change' } })
    })

    it('skips an impersonate generation, which is the user drafting their own text', async () => {
        const { pass, quiet } = harness()
        const outcome = await pass.run({ chatId: 'c1', generationType: 'impersonate' })
        expect(outcome.status).toBe('skipped')
        expect(quiet).not.toHaveBeenCalled()
    })

    it('skips a chat with no narrative in it yet', async () => {
        const { pass, deps, quiet } = harness()
        deps.chat.getMessages = vi.fn(async (_chatId: string) => [] as ChatMessage[])
        const outcome = await createTrackerPass(deps).run({ chatId: 'c1' })
        expect(outcome.status).toBe('skipped')
        expect(quiet).not.toHaveBeenCalled()
    })
})

describe('when the generation fails', () => {
    it('reports the failure and leaves the memo untouched', async () => {
        const { deps, memos } = harness()
        deps.generate.quiet = vi.fn(async (_input: Record<string, unknown>) => { throw new Error('provider unreachable') })
        await memos.save('c1', '[TIME]\nkept\n[/TIME]')

        const outcome = await createTrackerPass(deps).run({ chatId: 'c1' })
        expect(outcome.status).toBe('failed')
        expect(outcome.reason).toContain('provider unreachable')
        expect((await memos.load('c1')).memo).toBe('[TIME]\nkept\n[/TIME]')
    })

    it('logs it rather than throwing into the event handler', async () => {
        const { deps } = harness()
        deps.generate.quiet = vi.fn(async (_input: Record<string, unknown>) => { throw new Error('boom') })
        await expect(createTrackerPass(deps).run({ chatId: 'c1' })).resolves.toMatchObject({ status: 'failed' })
        expect(deps.log.warn).toHaveBeenCalled()
    })
})

describe('when the user presses Stop', () => {
    function aborted() {
        const error = new Error('The operation was aborted')
        error.name = 'AbortError'
        return error
    }

    it('reports a cancellation rather than a failure', async () => {
        // The user pressed a button. Painting that red is Phase 1d's confusion
        // — a panel that cannot tell a fault from a choice.
        const { deps } = harness()
        deps.generate.quiet = vi.fn(async (_input: Record<string, unknown>) => { throw aborted() })

        const outcome = await createTrackerPass(deps).run({ chatId: 'c1' })
        expect(outcome.status).toBe('cancelled')
        expect(outcome.reason).toContain('memo is unchanged')
    })

    it('leaves the memo exactly as it was', async () => {
        // The property that makes the button safe: the merge happens after the
        // model call, so a stopped pass has written nothing.
        const { deps, memos } = harness()
        await memos.save('c1', '[TIME]\nkept\n[/TIME]')
        deps.generate.quiet = vi.fn(async (_input: Record<string, unknown>) => { throw aborted() })

        await createTrackerPass(deps).run({ chatId: 'c1' })
        expect((await memos.load('c1')).memo).toBe('[TIME]\nkept\n[/TIME]')
    })

    it('hands the model call the signal for this chat', async () => {
        // A resolver, because the pass is built once and runs many times. If it
        // is not asked for per run, Stop stops nothing.
        const { deps } = harness()
        const controller = new AbortController()
        deps.signal = vi.fn((_chatId: string) => controller.signal)

        await createTrackerPass(deps).run({ chatId: 'c1' })

        expect(deps.signal).toHaveBeenCalledWith('c1')
        const sent = (deps.generate.quiet as ReturnType<typeof vi.fn>).mock.calls[0]![0]
        expect(sent.signal).toBe(controller.signal)
    })

    it('still calls a real model failure a failure', async () => {
        const { deps } = harness()
        deps.generate.quiet = vi.fn(async (_input: Record<string, unknown>) => {
            throw new Error('502 from the provider')
        })
        expect((await createTrackerPass(deps).run({ chatId: 'c1' })).status).toBe('failed')
    })
})

describe('the floor reaching the pass', () => {
    // Caught by a green mutation, and it is the link that matters most: the
    // floor was computed correctly by the cadence and honoured correctly by the
    // window selector, and *nothing* checked that the pass carried it between
    // them. Deleting it from the call site left the whole suite green — lesson
    // 19's shape, one layer in from where it usually bites.
    const LONG: ChatMessage[] = [
        { id: 'm1', role: 'user', content: 'u1', index_in_chat: 1 },
        { id: 'm2', role: 'assistant', content: 'a1', index_in_chat: 2 },
        { id: 'm3', role: 'user', content: 'u2', index_in_chat: 3 },
        { id: 'm4', role: 'assistant', content: 'a2', index_in_chat: 4 },
        { id: 'm5', role: 'user', content: 'u3', index_in_chat: 5 },
        { id: 'm6', role: 'assistant', content: 'a3', index_in_chat: 6 },
    ]

    /** What the model was actually shown. */
    const sentPrompt = (quiet: ReturnType<typeof vi.fn>): string => {
        const input = quiet.mock.calls[0]![0] as { messages: Array<{ content: string }> }
        return input.messages.map((m) => m.content).join('\n')
    }

    it('sends the widened window when a throttled pass asks for one', async () => {
        const { deps, quiet } = harness()
        deps.chat.getMessages = vi.fn(async () => LONG)

        await createTrackerPass(deps).run({ chatId: 'c1', floor: 6 })

        // All three turns, not just the newest exchange.
        const prompt = sentPrompt(quiet)
        expect(prompt).toContain('u1')
        expect(prompt).toContain('a1')
        expect(prompt).toContain('a3')
    })

    it('sends the configured window when no floor is asked for', async () => {
        const { deps, quiet } = harness()
        deps.chat.getMessages = vi.fn(async () => LONG)

        await createTrackerPass(deps).run({ chatId: 'c1' })

        const prompt = sentPrompt(quiet)
        expect(prompt).toContain('a3')
        expect(prompt).not.toContain('u1')
    })
})

describe('choosing how much story a pass reads', () => {
    const msg = (role: 'user' | 'assistant' | 'system', content: string) => ({ role, content }) as never
    const text = (chosen: ReturnType<typeof selectNarrativeWindow>) =>
        chosen.map((m) => String((m as { content: string }).content))

    const EXCHANGE = [
        msg('user', 'u1'), msg('assistant', 'a1'),
        msg('user', 'u2'), msg('assistant', 'a2'),
        msg('user', 'u3'), msg('assistant', 'a3'),
    ]

    it('reads the current exchange by default, not the last six messages', () => {
        // The whole point: the legacy's recommended mode sends about two
        // messages where this build sent six, on the most frequent call in the
        // extension.
        expect(text(selectNarrativeWindow(EXCHANGE))).toEqual(['u3', 'a3'])
    })

    it('keeps a whole turn when several replies follow one message', () => {
        // Tool calls and continuations produce more than one reply per turn.
        const chat = [msg('user', 'u1'), msg('assistant', 'a1'), msg('user', 'u2'),
                      msg('assistant', 'a2a'), msg('assistant', 'a2b'), msg('assistant', 'a2c')]
        expect(text(selectNarrativeWindow(chat))).toEqual(['u2', 'a2a', 'a2b', 'a2c'])
    })

    // The floor exists so a throttled pass does not lose the turns it skipped.
    // The legacy has exactly this hole: its tick and its window never speak, so
    // raising `stateTrackerRunEvery` there drops the skipped story silently.
    it('widens to the floor when a throttled pass has turns to catch up on', () => {
        expect(text(selectNarrativeWindow(EXCHANGE, { floor: 4 }))).toEqual(['u2', 'a2', 'u3', 'a3'])
    })

    it('widens a fixed window too', () => {
        expect(text(selectNarrativeWindow(EXCHANGE, { mode: 'fixed', count: 2, floor: 5 })))
            .toEqual(['a1', 'u2', 'a2', 'u3', 'a3'])
    })

    // A minimum, never a maximum. A floor smaller than the configured window
    // must not narrow it — that would make a cadence quietly *reduce* what the
    // extractor sees, which is the opposite of the point.
    it('never narrows a window that is already wider', () => {
        const chat = [msg('user', 'u1'), msg('assistant', 'a1'),
                      msg('assistant', 'a2'), msg('assistant', 'a3')]
        expect(text(selectNarrativeWindow(chat, { floor: 2 }))).toEqual(['u1', 'a1', 'a2', 'a3'])
    })

    it('changes nothing when the floor is zero, absent or nonsense', () => {
        for (const floor of [0, undefined, -5, Number.NaN]) {
            expect(text(selectNarrativeWindow(EXCHANGE, { floor }))).toEqual(['u3', 'a3'])
        }
    })

    // The greeting-nobody-answered fallback has to widen as well, or a
    // throttled pass on an all-narrator opening loses the same way.
    it('widens the no-user-message fallback', () => {
        const chat = [msg('assistant', 'a1'), msg('assistant', 'a2'), msg('assistant', 'a3')]
        expect(text(selectNarrativeWindow(chat, { floor: 3 }))).toEqual(['a1', 'a2', 'a3'])
    })

    it('takes a fixed window when asked', () => {
        expect(text(selectNarrativeWindow(EXCHANGE, { mode: 'fixed', count: 3 })))
            .toEqual(['a2', 'u3', 'a3'])
    })

    it('falls back to the last two when nobody has spoken yet', () => {
        // A greeting nobody has answered. The legacy hardcodes two here rather
        // than using the configured count, and so does this.
        const chat = [msg('assistant', 'g1'), msg('assistant', 'g2'), msg('assistant', 'g3')]
        expect(text(selectNarrativeWindow(chat))).toEqual(['g2', 'g3'])
    })

    it('never returns nothing when there is something to read', () => {
        expect(text(selectNarrativeWindow([msg('assistant', 'only')]))).toEqual(['only'])
        expect(text(selectNarrativeWindow([msg('user', 'only')]))).toEqual(['only'])
    })

    it('reads an empty chat as empty rather than throwing', () => {
        expect(selectNarrativeWindow([])).toEqual([])
        expect(selectNarrativeWindow([msg('system', 'setup')])).toEqual([])
    })

    it('does not let the host\'s own messages break the walk', () => {
        // Walking back to "the last user message" past a system entry would
        // pick up something the user never wrote.
        const chat = [msg('user', 'u1'), msg('assistant', 'a1'),
                      msg('system', 'a note'), msg('assistant', 'a2')]
        expect(text(selectNarrativeWindow(chat))).toEqual(['u1', 'a1', 'a2'])
    })

    it('floors a fixed window at one message', () => {
        expect(text(selectNarrativeWindow(EXCHANGE, { mode: 'fixed', count: 0 }))).toEqual(['a3'])
    })

    it('reaches the pass, and a read that throws costs the window not the pass', async () => {
        const { deps } = harness()
        deps.lookback = vi.fn(async (_userId?: string) => { throw new Error('storage down') })
        expect((await createTrackerPass(deps).run({ chatId: 'c1' })).status).toBe('updated')

        const { deps: d2 } = harness()
        d2.lookback = vi.fn(async (_userId?: string) => ({ mode: 'fixed' as const, count: 1 }))
        await createTrackerPass(d2).run({ chatId: 'c1' })
        expect(d2.lookback).toHaveBeenCalled()
    })
})

describe('which model the pass runs on', () => {
    it('sends the chosen connection with the call', async () => {
        // Multihog ran the tracker on its own profile and the port lost it, so
        // every pass ran on the model writing the story.
        const { deps } = harness()
        deps.connectionId = vi.fn(async (_userId?: string) => 'fast-small')

        await createTrackerPass(deps).run({ chatId: 'c1' })

        const sent = (deps.generate.quiet as ReturnType<typeof vi.fn>).mock.calls[0]![0]
        expect(sent.connection_id).toBe('fast-small')
    })

    it('sends no connection at all when the user has not chosen', async () => {
        // Not an empty string: that is an id nothing will match, and the host
        // must be left to pick exactly as it did before this existed.
        const { deps } = harness()
        await createTrackerPass(deps).run({ chatId: 'c1' })

        const sent = (deps.generate.quiet as ReturnType<typeof vi.fn>).mock.calls[0]![0]
        expect('connection_id' in sent).toBe(false)
    })

    it('omits it rather than failing the pass when the choice cannot be read', async () => {
        // A preferences read that throws must cost the default connection, not
        // the whole pass.
        const { deps } = harness()
        deps.connectionId = vi.fn(async (_userId?: string) => { throw new Error('storage down') })

        const outcome = await createTrackerPass(deps).run({ chatId: 'c1' })

        expect(outcome.status).toBe('updated')
        const sent = (deps.generate.quiet as ReturnType<typeof vi.fn>).mock.calls[0]![0]
        expect('connection_id' in sent).toBe(false)
    })
})

describe('re-tracking a swipe or a regenerate', () => {
    // The memo already includes the message being replaced. Merging the new
    // version on top would count the turn twice — an hour of game time
    // advancing two hours, a payment deducted twice.
    const ADVANCE = '<memo>[TIME]\n07:00 AM, Day 4\n[/TIME]</memo>'
    const OTHER_ADVANCE = '<memo>[TIME]\n08:00 AM, Day 4\n[/TIME]</memo>'

    it('merges onto the memo from before the replaced message', async () => {
        const { pass, memos } = harness([ADVANCE, OTHER_ADVANCE])
        await memos.save('c1', '[TIME]\n06:15 AM, Day 4\n[/TIME]')

        await pass.run({ chatId: 'c1', messageId: 'm2', generationType: 'normal' })
        expect((await memos.load('c1')).previous).toBe('[TIME]\n06:15 AM, Day 4\n[/TIME]')

        await pass.run({ chatId: 'c1', messageId: 'm2', generationType: 'swipe' })
        const after = await memos.load('c1')
        expect(after.memo).toContain('08:00 AM')
        // Still rooted at the pre-turn state, not at 07:00.
        expect(after.previous).toBe('[TIME]\n06:15 AM, Day 4\n[/TIME]')
    })

    it('treats a different message as a new turn, not a re-track', async () => {
        const { pass, memos } = harness([ADVANCE, OTHER_ADVANCE])
        await pass.run({ chatId: 'c1', messageId: 'm2', generationType: 'normal' })
        await pass.run({ chatId: 'c1', messageId: 'm3', generationType: 'normal' })

        expect((await memos.load('c1')).previous).toContain('07:00 AM')
    })

    it('commits a re-track that merges to no change, so the roll-back sticks', async () => {
        // Without this the memo would keep the replaced turn's effects.
        const { pass, memos } = harness([ADVANCE, 'No changes.'])
        await memos.save('c1', '[TIME]\n06:15 AM, Day 4\n[/TIME]')

        await pass.run({ chatId: 'c1', messageId: 'm2', generationType: 'normal' })
        await pass.run({ chatId: 'c1', messageId: 'm2', generationType: 'swipe' })

        expect((await memos.load('c1')).memo).toBe('[TIME]\n06:15 AM, Day 4\n[/TIME]')
    })
})

describe('the relationship system in a pass (44)', () => {
    const REPLY = '<memo>[TIME]\n08:00 AM, Day 4\n[/TIME]</memo>\n[RELATIONS]\nFriendship +5 Marcus Vane\naffection -2 Nobody\n[/RELATIONS]'

    function relationships(over: Partial<NonNullable<TrackerPassDeps['relationships']>> = {}) {
        const applied: unknown[] = []
        const dep: NonNullable<TrackerPassDeps['relationships']> = {
            instruction: async () => 'RELATIONSHIP INSTRUCTION',
            extract: async (text) => {
                const m = text.match(/\[RELATIONS\]([\s\S]*?)\[\/RELATIONS\]/)
                if (!m) return { memo: text, commands: [] }
                return {
                    memo: text.replace(m[0], ''),
                    commands: m[1]!.trim().split('\n').map((line) => {
                        const [field, delta, ...name] = line.split(' ')
                        return { npc: name.join(' '), field: field!.toLowerCase() as 'friendship' | 'affection', delta: Number(delta) }
                    }),
                }
            },
            apply: async (chatId, userId, commands, options) => {
                applied.push([chatId, userId, commands, options])
                const placed = commands.filter((c) => c.npc !== 'Nobody').map((c) => ({ label: c.npc, field: c.field, delta: c.delta, newValue: c.delta + 40 }))
                return { placed, unmatched: commands.filter((c) => c.npc === 'Nobody').map((c) => c.npc), reverted: 0 }
            },
            ...over,
        }
        return { dep, applied }
    }

    it('carries the instruction in the system prompt, reads the block out before the memo, and places the commands against the message', async () => {
        const h = harness(REPLY)
        const { dep, applied } = relationships()
        h.deps.relationships = dep
        const pass = createTrackerPass(h.deps)
        const outcome = await pass.run({ chatId: 'c1', userId: 'u1', messageId: 'm9' })
        const call = h.quiet.mock.calls[0]![0] as { messages: Array<{ content: string }> }
        expect(call.messages[0]!.content.endsWith('\n\nRELATIONSHIP INSTRUCTION')).toBe(true)
        expect(outcome.status).toBe('updated')
        // The block never reaches the memo.
        expect((await h.memos.load('c1', 'u1')).memo).not.toContain('RELATIONS')
        expect(applied).toEqual([['c1', 'u1', [{ npc: 'Marcus Vane', field: 'friendship', delta: 5 }, { npc: 'Nobody', field: 'affection', delta: -2 }], { source: 'tracker', messageId: 'm9', retrack: false }]])
        expect(outcome.report.relations).toEqual(['Marcus Vane friendship +5 (now +45)'])
        expect(outcome.report.relationsUnmatched).toEqual(['Nobody'])
    })

    it('places the commands even when the memo did not change, and says so in the no-change report', async () => {
        const h = harness('Nothing changed this turn.\n[RELATIONS]\nFriendship +5 Marcus Vane\n[/RELATIONS]')
        await h.memos.save('c1', '[TIME]\n06:15 AM\n[/TIME]', 'u1')
        const { dep, applied } = relationships()
        h.deps.relationships = dep
        const pass = createTrackerPass(h.deps)
        const outcome = await pass.run({ chatId: 'c1', userId: 'u1', messageId: 'm2' })
        expect(outcome.status).toBe('no-change')
        expect((await h.memos.load('c1', 'u1')).memo).toBe('[TIME]\n06:15 AM\n[/TIME]')
        expect(applied).toHaveLength(1)
        expect(outcome.report.relations).toEqual(['Marcus Vane friendship +5 (now +45)'])
    })

    it('asks the store to put back the replaced reply\'s awards on a retrack, even with nothing new', async () => {
        const h = harness(['<memo>[TIME]\n07:00 AM, Day 4\n[/TIME]</memo>', '<memo>[TIME]\n07:30 AM, Day 4\n[/TIME]</memo>'])
        const { dep, applied } = relationships()
        h.deps.relationships = dep
        const pass = createTrackerPass(h.deps)
        await pass.run({ chatId: 'c1', userId: 'u1', messageId: 'm1' })
        expect(applied).toEqual([])
        await pass.run({ chatId: 'c1', userId: 'u1', messageId: 'm1', generationType: 'swipe' })
        expect(applied).toEqual([['c1', 'u1', [], { source: 'tracker', messageId: 'm1', retrack: true }]])
    })

    it('leaves a modules-only pass alone, and costs the pass nothing when its reads throw', async () => {
        const h = harness(REPLY)
        const { dep, applied } = relationships()
        h.deps.relationships = dep
        const pass = createTrackerPass(h.deps)
        await pass.run({ chatId: 'c1', userId: 'u1', trigger: 'direct', instruction: 'Make a sheet', window: 0, systemPromptMode: 'modules_only' })
        expect((h.quiet.mock.calls[0]![0] as { messages: Array<{ content: string }> }).messages[0]!.content).not.toContain('RELATIONSHIP INSTRUCTION')
        expect(applied).toEqual([])

        const broken = harness(REPLY)
        broken.deps.relationships = relationships({
            instruction: async () => { throw new Error('prefs down') },
            extract: async () => { throw new Error('prefs down') },
            apply: async () => { throw new Error('store down') },
        }).dep
        const outcome = await createTrackerPass(broken.deps).run({ chatId: 'c1', userId: 'u1', messageId: 'm1', generationType: 'swipe' })
        expect(outcome.status).toBe('updated')
        expect((broken.deps.log.warn as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining([expect.stringContaining('prefs down')]))
    })
})

describe('running more than one pass', () => {
    it('runs one at a time per chat, so neither overwrites the other', async () => {
        // Both would otherwise read the same prior memo and the second would
        // silently erase the first.
        const { pass, memos } = harness(['<memo>[A]\n1\n[/A]</memo>', '<memo>[B]\n2\n[/B]</memo>'])

        await Promise.all([pass.run({ chatId: 'c1' }), pass.run({ chatId: 'c1' })])

        const memo = (await memos.load('c1')).memo
        expect(memo).toContain('[A]')
        expect(memo).toContain('[B]')
    })

    it('does not let one chat hold up another', async () => {
        const { deps } = harness()
        const control = { release: () => {} }
        const gate = new Promise<void>((resolve) => { control.release = resolve })

        deps.generate.quiet = vi.fn(async (input: Record<string, unknown>) => {
            if (input.chatId === 'slow') await gate
            return { content: '<memo>[A]\n1\n[/A]</memo>' }
        })

        const pass = createTrackerPass(deps)
        const slow = pass.run({ chatId: 'slow' })
        await expect(pass.run({ chatId: 'fast' })).resolves.toMatchObject({ status: 'updated' })

        control.release()
        await slow
    })

    it('keeps working after a pass fails', async () => {
        const { deps, memos } = harness()
        deps.generate.quiet = vi.fn<(input: Record<string, unknown>) => Promise<unknown>>()
            .mockRejectedValueOnce(new Error('transient'))
            .mockResolvedValue({ content: '<memo>[A]\n1\n[/A]</memo>' })

        const pass = createTrackerPass(deps)
        await pass.run({ chatId: 'c1' })
        await expect(pass.run({ chatId: 'c1' })).resolves.toMatchObject({ status: 'updated' })
        expect((await memos.load('c1')).memo).toContain('[A]')
    })
})

describe('reporting what it did', () => {
    it('records the blocks it moved', async () => {
        const { pass, memos } = harness('<memo>[TIME]\nnew\n[/TIME]\n[XP]\n1/2\n[/XP]</memo>')
        await memos.save('c1', '[TIME]\nold\n[/TIME]')
        await pass.run({ chatId: 'c1' })

        expect((await memos.load('c1')).lastPass).toMatchObject({
            status: 'updated',
            replaced: ['TIME'],
            added: ['XP'],
        })
    })

    it('records a no-change with a sample of what came back', async () => {
        // The single most useful thing to see when state stops moving: it tells
        // a refusal apart from a wrong output format apart from a model that
        // correctly found nothing to report.
        const { pass, memos } = harness('I cannot help with that request.')
        await pass.run({ chatId: 'c1' })

        const report = (await memos.load('c1')).lastPass
        expect(report).toMatchObject({ status: 'no-change' })
        expect(report?.sample).toContain('I cannot help')
        expect(report?.reason).toMatch(/no \[TAG\] blocks/)
    })

    it('keeps the sample when the model returned an empty memo envelope', async () => {
        // Distinct from a blank reply, and it says something specific: the
        // model understood the format and had nothing to put in it.
        const { pass, memos } = harness('<memo></memo>')
        await pass.run({ chatId: 'c1' })

        const report = (await memos.load('c1')).lastPass
        expect(report?.status).toBe('no-change')
        expect(report?.sample).toBe('<memo></memo>')
    })

    it('keeps the sample when the reply had nothing left after stripping', async () => {
        // A reply that is only an unclosed tag: nothing usable comes out, but
        // what came back is exactly what the user needs to see.
        const { pass, memos } = harness('<memo>')
        await pass.run({ chatId: 'c1' })

        const report = (await memos.load('c1')).lastPass
        expect(report?.reason).toMatch(/empty reply/)
        expect(report?.sample).toBe('<memo>')
    })

    it('truncates a long reply rather than storing the whole thing', async () => {
        const { pass, memos } = harness('x'.repeat(5000))
        await pass.run({ chatId: 'c1' })
        expect((await memos.load('c1')).lastPass?.sample?.length).toBe(SAMPLE_LENGTH)
    })

    it('records a failure and why', async () => {
        const { deps, memos } = harness()
        deps.generate.quiet = vi.fn(async (_input: Record<string, unknown>) => { throw new Error('no connection') })
        await createTrackerPass(deps).run({ chatId: 'c1' })

        const report = (await memos.load('c1')).lastPass
        expect(report?.status).toBe('failed')
        expect(report?.reason).toContain('no connection')
    })

    it('records a skip and why', async () => {
        const { pass, memos } = harness()
        await pass.run({ chatId: 'c1', generationType: 'impersonate' })
        expect((await memos.load('c1')).lastPass).toMatchObject({ status: 'skipped' })
        expect((await memos.load('c1')).lastPass?.reason).toContain('impersonate')
    })

    it('records a failure to read the chat, rather than dying silently', async () => {
        const { deps, memos } = harness()
        deps.chat.getMessages = vi.fn(async (_chatId: string) => { throw new Error('chat gone') })
        const outcome = await createTrackerPass(deps).run({ chatId: 'c1' })

        expect(outcome.status).toBe('failed')
        expect((await memos.load('c1')).lastPass?.reason).toContain('chat gone')
    })

    it('stamps every report with a time', async () => {
        const { pass, memos } = harness()
        await pass.run({ chatId: 'c1' })
        expect(Date.parse((await memos.load('c1')).lastPass!.at)).toBeGreaterThan(0)
    })

    it('does not disturb the swipe roll-back point when only reporting', async () => {
        // notePass rewrites the record; if it moved `previous`, re-tracking a
        // swipe would silently start merging onto the wrong base.
        const { pass, memos } = harness(['<memo>[TIME]\n07:00\n[/TIME]</memo>', 'No changes.'])
        await memos.save('c1', '[TIME]\n06:15\n[/TIME]')

        await pass.run({ chatId: 'c1', messageId: 'm2', generationType: 'normal' })
        await pass.run({ chatId: 'c1', messageId: 'm3', generationType: 'normal' })

        const after = await memos.load('c1')
        expect(after.previous).toBe('[TIME]\n06:15\n[/TIME]')
        expect(after.lastMessageId).toBe('m2')
        expect(after.lastPass?.status).toBe('no-change')
    })
})

/**
 * Settings that blow up where nothing is guarding.
 *
 * The load itself is inside a try, so a rejected load is an ordinary reported
 * failure. This one survives the load and throws where the prompt is built —
 * which is the shape of the bug the end-guarantee exists for.
 */
// Multihog's 💬: the send bar's pass is this pass with an instruction.
describe('a pass the user instructed', () => {
    const userPrompt = (quiet: ReturnType<typeof vi.fn>, call = 0): string =>
        String((quiet.mock.calls[call]![0] as { messages: Array<{ content: string }> }).messages[1]!.content)

    it('carries the instruction into the prompt and marks the report', async () => {
        const { pass, quiet, memos, starts } = harness()
        const outcome = await pass.run({ chatId: 'c1', trigger: 'direct', instruction: 'Advance the clock an hour.', window: 5 })

        expect(userPrompt(quiet)).toContain('## USER INSTRUCTION\nAdvance the clock an hour.')
        expect(userPrompt(quiet)).toMatch(/## NARRATIVE HISTORY \(Last \d+ messages\)/)
        expect(outcome.report).toMatchObject({ status: 'updated', trigger: 'direct' })
        expect((await memos.load('c1')).lastPass?.trigger).toBe('direct')
        expect(starts[0]?.trigger).toBe('direct')
    })

    it('reads the window it is given, and nothing at all for zero', async () => {
        const { pass, quiet } = harness()
        await pass.run({ chatId: 'c1', trigger: 'direct', instruction: 'x', window: 1 })
        expect(userPrompt(quiet)).toContain('(Last 1 messages)')

        const { pass: none, quiet: quietNone } = harness()
        const outcome = await none.run({ chatId: 'c1', trigger: 'direct', instruction: 'Set up my character.', window: 0 })
        expect(outcome.status).toBe('updated')
        expect(userPrompt(quietNone)).not.toContain('## NARRATIVE HISTORY')
        expect(userPrompt(quietNone)).toContain('## USER INSTRUCTION')
    })

    it('marks an instructed pass that changed nothing, so the panel can say whose it was', async () => {
        // Green mutation in Phase 30: only the updated report carried the mark.
        const { pass, memos } = harness('Nothing to change.')
        const outcome = await pass.run({ chatId: 'c1', trigger: 'direct', instruction: 'Check the clock.', window: 2 })
        expect(outcome.report).toMatchObject({ status: 'no-change', trigger: 'direct' })
        expect((await memos.load('c1')).lastPass).toMatchObject({ status: 'no-change', trigger: 'direct' })
    })

    it('runs in modules-only mode and on the connection it is given (Phase 35)', async () => {
        const { pass, quiet, deps } = harness()
        deps.connectionId = vi.fn(async () => 'tracker-conn')
        const system = (call = 0): string => String((quiet.mock.calls[call]![0] as { messages: Array<{ content: string }> }).messages[0]!.content)
        const connection = (call = 0): unknown => (quiet.mock.calls[call]![0] as Record<string, unknown>).connection_id
        await pass.run({ chatId: 'c1', trigger: 'direct', instruction: 'Design a character.', window: 0, systemPromptMode: 'modules_only', connectionId: 'creator-conn' })
        expect(system()).not.toContain('You are the State Extractor Model.')
        expect(system()).toContain('### CORE MODULES')
        expect(connection()).toBe('creator-conn')
        // The player's name stands in for {{user}} in the module formats, and a neutral phrase when none was given (35-bis).
        ;(deps.settings.load as ReturnType<typeof vi.fn>).mockResolvedValue({ ...SETTINGS, stockPrompts: { ...SETTINGS.stockPrompts, character: 'Format: {{user}} (Class): HP; {{ user }} again' }, modules: { ...SETTINGS.modules, character: true } })
        await pass.run({ chatId: 'c1', trigger: 'direct', instruction: 'Design a character.', window: 0, systemPromptMode: 'modules_only', playerName: 'Robin Vale' })
        expect(system(1)).toContain('Robin Vale (Class): HP; Robin Vale again')
        expect(system(1)).not.toContain('{{user}}')
        await pass.run({ chatId: 'c1', trigger: 'direct', instruction: 'Design a character.', window: 0, systemPromptMode: 'modules_only', playerName: '  ' })
        expect(system(2)).toContain('the player character (Class): HP')
        await pass.run({ chatId: 'c1', trigger: 'direct', instruction: 'Design a character.', window: 0, playerName: 'Robin Vale' })
        expect(system(3)).toContain('{{user}} (Class): HP')
        ;(deps.settings.load as ReturnType<typeof vi.fn>).mockResolvedValue(SETTINGS)
        // Without the mode the extractor's rules are back; a blank connection defers to the resolver.
        await pass.run({ chatId: 'c1', trigger: 'direct', instruction: 'Design a character.', window: 0, connectionId: '' })
        expect(system(4)).toContain('You are the State Extractor Model.')
        expect(connection(4)).toBe('tracker-conn')
    })

    it('runs on an empty chat, which the automatic pass skips', async () => {
        // The documented first use: a character set up before the first turn.
        const { pass, deps } = harness()
        ;(deps.chat.getMessages as ReturnType<typeof vi.fn>).mockResolvedValue([])
        expect((await pass.run({ chatId: 'c1' })).status).toBe('skipped')
        expect((await pass.run({ chatId: 'c1', trigger: 'direct', instruction: 'Set up my character.' })).status).toBe('updated')
    })

    it('leaves the ordinary pass exactly as it was', async () => {
        const { pass, quiet } = harness()
        const outcome = await pass.run({ chatId: 'c1' })
        expect(outcome.report.trigger).toBeUndefined()
        expect(userPrompt(quiet)).not.toContain('USER INSTRUCTION')
        // A blank instruction is no instruction: the ordinary window, unmarked.
        const { pass: blank, quiet: quietBlank } = harness()
        const second = await blank.run({ chatId: 'c1', trigger: 'direct', instruction: '   ', window: 0 })
        expect(userPrompt(quietBlank)).not.toContain('USER INSTRUCTION')
        expect(userPrompt(quietBlank)).toMatch(/## NARRATIVE HISTORY/)
        expect(second.report.trigger).toBe('direct')
    })
})

function explodingSettings(): Record<string, unknown> {
    const settings: Record<string, unknown> = { ...SETTINGS }
    Object.defineProperty(settings, 'stockPrompts', {
        get(): never {
            throw new Error('settings exploded')
        },
    })
    return settings
}

describe('announcing that a pass has begun', () => {
    it('reports the start before the outcome', async () => {
        // The pass after a reply is invisible until it lands, which is
        // indistinguishable from a tracker that has stopped working. The start
        // event is the only thing that can say "working on it".
        const order: string[] = []
        const h = harness()
        h.deps.onPassStart = () => { order.push('start') }
        h.deps.onPassComplete = () => { order.push('complete') }

        await h.pass.run({ chatId: 'c1', messageId: 'm2' })
        expect(order).toEqual(['start', 'complete'])
    })

    it('carries the chat, the user and a timestamp', async () => {
        const h = harness()
        const before = Date.now()
        await h.pass.run({ chatId: 'c1', userId: 'u1', messageId: 'm2' })

        expect(h.starts).toHaveLength(1)
        expect(h.starts[0]!.chatId).toBe('c1')
        expect(h.starts[0]!.userId).toBe('u1')
        expect(Date.parse(h.starts[0]!.at)).toBeGreaterThanOrEqual(before)
    })

    it('defaults to the automatic trigger and passes a manual one through', async () => {
        // The panel words the two differently: it already knows about the
        // button it disabled, and only the pass it did not ask for needs
        // announcing.
        const h = harness()
        await h.pass.run({ chatId: 'c1', messageId: 'm2' })
        await h.pass.run({ chatId: 'c1', messageId: 'm2', trigger: 'manual' })

        expect(h.starts.map((s) => s.trigger)).toEqual(['reply', 'manual'])
    })

    it('announces a pass it is about to skip', async () => {
        // A skip is an outcome like any other, and reaches the same report box.
        // Starting silently and then reporting would be the odd shape.
        const h = harness()
        const outcome = await h.pass.run({ chatId: 'c1', generationType: 'impersonate' })

        expect(outcome.status).toBe('skipped')
        expect(h.starts).toHaveLength(1)
        expect(h.changes).toHaveLength(1)
    })

    it('waits its turn in the queue before announcing', async () => {
        // The start means work is happening, not work is queued. A second pass
        // that announced itself while the first still held the chat would show
        // as running for as long as it sat waiting.
        const order: string[] = []
        const h = harness()
        h.deps.onPassStart = () => { order.push('start') }
        h.deps.onPassComplete = () => { order.push('complete') }

        await Promise.all([
            h.pass.run({ chatId: 'c1', messageId: 'm2' }),
            h.pass.run({ chatId: 'c1', messageId: 'm3' }),
        ])

        // Not start, start, complete, complete.
        expect(order).toEqual(['start', 'complete', 'start', 'complete'])
    })

    it('still reports an end when the pass throws unexpectedly', async () => {
        // Every ordinary failure inside a pass reports itself. This is the
        // guard for the one that does not: the panel shows "a pass is running"
        // from the start event until something ends it, so a start with no end
        // would leave that on screen for the rest of the session.
        const h = harness()
        h.deps.settings.load = vi.fn(async () => explodingSettings())

        await expect(h.pass.run({ chatId: 'c1', messageId: 'm2' })).rejects.toThrow('settings exploded')

        expect(h.starts).toHaveLength(1)
        expect(h.changes).toHaveLength(1)
        const report = (h.changes[0] as { report: { status: string; reason?: string } }).report
        expect(report.status).toBe('failed')
        expect(report.reason).toContain('settings exploded')
    })

    it('records that failure where the panel reads it', async () => {
        const h = harness()
        h.deps.settings.load = vi.fn(async () => explodingSettings())

        await h.pass.run({ chatId: 'c1', messageId: 'm2' }).catch(() => undefined)
        expect((await h.memos.load('c1')).lastPass?.status).toBe('failed')
    })
})

describe('keeping the state at each turn', () => {
    it('records the memo it just wrote, under the message it read', async () => {
        // What a card under an old message is drawn from. Nothing could answer
        // "what did the party look like then" before this.
        const h = harness()
        await h.pass.run({ chatId: 'c1', userId: 'u1', messageId: 'm2' })

        const snapshots = (await h.history.load('c1', 'u1')).snapshots
        expect(snapshots).toHaveLength(1)
        expect(snapshots[0]!.messageId).toBe('m2')
        expect(snapshots[0]!.memo).toContain('07:00 AM, Day 4')
    })

    it('records the host\'s number for that message, so the stepper can name it', async () => {
        // Live, the stepper offered to restore to #22 — a message the user had
        // written — when the state belonged to #21, because the number was
        // counted here rather than read from the host.
        const h = harness()
        await h.pass.run({ chatId: 'c1', userId: 'u1', messageId: 'm2' })

        expect((await h.history.load('c1', 'u1')).snapshots[0]!.messageNumber).toBe(21)
    })

    it('records no number when the host gave none', async () => {
        const h = harness()
        h.deps.chat.getMessages = vi.fn(async () => [
            { id: 'm2', role: 'assistant' as const, content: 'It is locked. An hour passes.' },
        ])
        await h.pass.run({ chatId: 'c1', userId: 'u1', messageId: 'm2' })

        expect((await h.history.load('c1', 'u1')).snapshots[0]!.messageNumber).toBeUndefined()
    })

    it('keeps one snapshot per message, so a swipe replaces rather than piles up', async () => {
        const h = harness([
            '<memo>[TIME]\n07:00 AM, Day 4\n[/TIME]</memo>',
            '<memo>[TIME]\n09:00 AM, Day 4\n[/TIME]</memo>',
        ])

        await h.pass.run({ chatId: 'c1', userId: 'u1', messageId: 'm2' })
        await h.pass.run({ chatId: 'c1', userId: 'u1', messageId: 'm2', generationType: 'swipe' })

        const snapshots = (await h.history.load('c1', 'u1')).snapshots
        expect(snapshots).toHaveLength(1)
        expect(snapshots[0]!.memo).toContain('09:00 AM')
    })

    it('records nothing for a pass the user started, which has no message', async () => {
        const h = harness()
        await h.pass.run({ chatId: 'c1', userId: 'u1', trigger: 'manual' })

        expect((await h.history.load('c1', 'u1')).snapshots).toEqual([])
    })

    it('names the message in the completion event, so one card can be redrawn', async () => {
        const h = harness()
        await h.pass.run({ chatId: 'c1', userId: 'u1', messageId: 'm2' })

        expect((h.changes[0] as { messageId?: string }).messageId).toBe('m2')
    })

    it('still saves the memo when the history write fails', async () => {
        const h = harness()
        h.deps.history = { record: async () => { throw new Error('disk gone') } }

        const outcome = await h.pass.run({ chatId: 'c1', userId: 'u1', messageId: 'm2' })

        expect(outcome.status).toBe('updated')
        expect((await h.memos.load('c1', 'u1')).memo).toContain('07:00 AM, Day 4')
        expect(h.deps.log.warn).toHaveBeenCalledWith(expect.stringMatching(/could not record the memo history/))
    })

    it('runs without a history store at all', async () => {
        const h = harness()
        delete h.deps.history

        expect((await h.pass.run({ chatId: 'c1', userId: 'u1', messageId: 'm2' })).status).toBe('updated')
    })
})

describe('quest housekeeping', () => {
    const QUEST_MEMO = [
        '<memo>',
        '[TIME]',
        '06:00 PM, Day 3',
        '[/TIME]',
        '[QUESTS]',
        'QUEST: The Missing Sheep',
        '  ID: a',
        '  STATUS: active',
        '  GIVER: Farmer Hemwick @ Crestwood Mill',
        '  ACCEPTED: 08:00 AM, Day 1',
        '  DEADLINE: 06:00 PM, Day 4',
        '  OBJ_ACTIVE: Find the sheep',
        '',
        'QUEST: The Rat Cellar',
        '  ID: b',
        '  STATUS: completed',
        '  GIVER: Innkeeper @ The Bell',
        '[/QUESTS]',
        '</memo>',
    ].join('\n')

    const questSettings = (over: Record<string, unknown> = {}) => ({
        ...SETTINGS,
        modules: { time: true, quests: true },
        syspromptModules: { quests: true, questsFrustration: true },
        ...over,
    })

    it('drops a finished quest from the memo it saves', async () => {
        // The extractor prompt promises the model the engine does this. Until
        // now nothing did, and a finished quest cost context on every turn.
        const h = harness(QUEST_MEMO)
        h.deps.settings.load = vi.fn(async () => questSettings())

        await h.pass.run({ chatId: 'c1', userId: 'u1' })

        const memo = (await h.memos.load('c1', 'u1')).memo
        expect(memo).toContain('The Missing Sheep')
        expect(memo).not.toContain('The Rat Cellar')
    })

    it('names the archived quest in the report, since it is no longer readable', async () => {
        const h = harness(QUEST_MEMO)
        h.deps.settings.load = vi.fn(async () => questSettings())

        const outcome = await h.pass.run({ chatId: 'c1', userId: 'u1' })
        expect(outcome.report.archived).toEqual(['The Rat Cellar'])
    })

    it('injects the giver mood the model is told not to write', async () => {
        const h = harness(QUEST_MEMO)
        h.deps.settings.load = vi.fn(async () => questSettings())

        await h.pass.run({ chatId: 'c1', userId: 'u1' })
        expect((await h.memos.load('c1', 'u1')).memo).toContain('MOOD:')
    })

    it('writes no mood when frustration display is off', async () => {
        const h = harness(QUEST_MEMO)
        h.deps.settings.load = vi.fn(async () =>
            questSettings({ syspromptModules: { quests: true, questsFrustration: false } }),
        )

        await h.pass.run({ chatId: 'c1', userId: 'u1' })
        expect((await h.memos.load('c1', 'u1')).memo).not.toContain('MOOD:')
    })

    it('leaves the block alone when the user has switched quests off', async () => {
        // Rewriting a block belonging to a disabled module is meddling, not
        // housekeeping.
        const h = harness(QUEST_MEMO)
        h.deps.settings.load = vi.fn(async () => questSettings({ modules: { time: true, quests: false } }))

        await h.pass.run({ chatId: 'c1', userId: 'u1' })
        const memo = (await h.memos.load('c1', 'u1')).memo
        expect(memo).toContain('The Rat Cellar')
        expect(memo).not.toContain('MOOD:')
    })

    it('keeps the finished quest rather than dropping it on the floor', async () => {
        // The whole point of the archive: the memo is what is live, the archive
        // is what is over. Before this the list was computed, named in the pass
        // report, and thrown away.
        const h = harness(QUEST_MEMO)
        h.deps.settings.load = vi.fn(async () => questSettings())

        await h.pass.run({ chatId: 'c1', userId: 'u1', messageId: 'm2' })

        expect(await h.archived('c1', 'u1')).toEqual(['The Rat Cellar'])
    })

    it('hands the archive to the panel with every pass, not only the ones that archive', async () => {
        // The panel redraws the whole card from the completion event, and the
        // finished quests are not in the memo to be redrawn from. A pass that
        // archived nothing this turn still has to carry them.
        const h = harness([QUEST_MEMO, '<memo>[TIME]\n07:00 PM, Day 3\n[/TIME]</memo>'])
        h.deps.settings.load = vi.fn(async () => questSettings())

        await h.pass.run({ chatId: 'c1', userId: 'u1', messageId: 'm2' })
        await h.pass.run({ chatId: 'c1', userId: 'u1', messageId: 'm3' })

        const last = h.changes.at(-1) as { archivedQuests?: Array<{ title: string }> }
        expect(last.archivedQuests?.map((q) => q.title)).toEqual(['The Rat Cellar'])
    })

    it('takes a quest back out of the archive when its turn is re-tracked', async () => {
        // A swipe replaces the reply that completed the quest. The memo rolls
        // back to `previous`; the archive has to roll back with it, or the log
        // shows the quest as finished while the memo shows it active.
        const h = harness([QUEST_MEMO, '<memo>[TIME]\n07:00 PM, Day 3\n[/TIME]</memo>'])
        h.deps.settings.load = vi.fn(async () => questSettings())

        await h.pass.run({ chatId: 'c1', userId: 'u1', messageId: 'm2' })
        expect(await h.archived('c1', 'u1')).toEqual(['The Rat Cellar'])

        await h.pass.run({ chatId: 'c1', userId: 'u1', messageId: 'm2', generationType: 'swipe' })
        expect(await h.archived('c1', 'u1')).toEqual([])
    })

    it('archives nothing when the user has switched quests off', async () => {
        const h = harness(QUEST_MEMO)
        h.deps.settings.load = vi.fn(async () => questSettings({ modules: { time: true, quests: false } }))

        await h.pass.run({ chatId: 'c1', userId: 'u1', messageId: 'm2' })
        expect(await h.archived('c1', 'u1')).toEqual([])
    })

    it('still saves the memo when the archive write fails', async () => {
        // Losing one turn's archive is worth far less than discarding the memo
        // the pass just wrote.
        const h = harness(QUEST_MEMO)
        h.deps.settings.load = vi.fn(async () => questSettings())
        h.deps.archive = {
            load: async () => ({ version: 1 as const, quests: [], updatedAt: '' }),
            record: async () => { throw new Error('disk gone') },
        }

        const outcome = await h.pass.run({ chatId: 'c1', userId: 'u1', messageId: 'm2' })

        expect(outcome.status).toBe('updated')
        expect((await h.memos.load('c1', 'u1')).memo).toContain('The Missing Sheep')
        expect(h.deps.log.warn).toHaveBeenCalledWith(expect.stringMatching(/could not archive/))
    })

    it('runs without an archive store at all', async () => {
        // Optional dependency: without it the pass behaves as it did before the
        // archive existed — quests still leave the memo, they are just not kept.
        const h = harness(QUEST_MEMO)
        h.deps.settings.load = vi.fn(async () => questSettings())
        delete h.deps.archive

        const outcome = await h.pass.run({ chatId: 'c1', userId: 'u1', messageId: 'm2' })
        expect(outcome.status).toBe('updated')
        expect((h.changes[0] as { archivedQuests?: unknown }).archivedQuests).toBeUndefined()
    })

    it('reports nothing archived on a pass with no quests in it', async () => {
        const h = harness()
        h.deps.settings.load = vi.fn(async () => questSettings())

        const outcome = await h.pass.run({ chatId: 'c1', userId: 'u1' })
        expect(outcome.report.status).toBe('updated')
        expect(outcome.report.archived).toBeUndefined()
    })
})

describe('syncQuests', () => {
    const memo = '[QUESTS]\nQUEST: Done\n  ID: a\n  STATUS: completed\n  GIVER: X @ Y\n[/QUESTS]'

    it('runs when quests are on', () => {
        expect(syncQuests(memo, { modules: { quests: true } }).archived).toHaveLength(1)
    })

    it('runs when the settings say nothing either way', () => {
        // Absent is not off — a cartridge that predates the toggle still gets
        // its quest log tidied.
        expect(syncQuests(memo, {}).archived).toHaveLength(1)
    })

    it.each([
        ['the block module', { modules: { quests: false } }],
        ['the prompt module', { syspromptModules: { quests: false } }],
    ])('does nothing when %s is off', (_name, settings) => {
        const result = syncQuests(memo, settings)
        expect(result.memo).toBe(memo)
        expect(result.archived).toEqual([])
    })
})


describe('which message a stored state belongs to', () => {
    const chat: ChatMessage[] = [
        { id: 'a', role: 'user', content: 'x', index_in_chat: 20 },
        { id: 'b', role: 'assistant', content: 'y', index_in_chat: 21 },
        { id: 'c', role: 'user', content: 'z', index_in_chat: 22 },
    ]

    it('reads the number off the host, never its own position', () => {
        // Counting positions named the message *after* the one it meant: the
        // stepper offered to restore to #22, a message the user had written,
        // when the state belonged to #21. The host publishes the number.
        expect(messageNumberOf(chat, 'b')).toBe(21)
    })

    it('keeps a number of zero, which is a real message', () => {
        expect(messageNumberOf([{ id: 'a', role: 'user', content: 'x', index_in_chat: 0 }], 'a')).toBe(0)
    })

    it('says nothing for a message it cannot find', () => {
        expect(messageNumberOf(chat, 'zzz')).toBeNull()
        expect(messageNumberOf(chat, '')).toBeNull()
        expect(messageNumberOf([], 'a')).toBeNull()
    })

    it('says nothing when the host gave no number', () => {
        // Better none than one worked out here: the point of showing it is
        // that it can be matched against the chat exactly.
        expect(messageNumberOf([{ id: 'a', role: 'user', content: 'x' }], 'a')).toBeNull()
    })
})


describe('the settings a tracker pass reads at run time', () => {
    // Built by a tested function rather than written out in backend.ts, which
    // has no tests. A mutation returning nothing from the resolver in that file
    // left the whole suite green — the third time a setting has been able to
    // vanish on the way to the thing it configures.
    const load = (prefs: Record<string, unknown>) => async (_userId: string | undefined) => prefs as never

    it('carries the window the user chose', async () => {
        const { lookback } = trackerPassResolvers(load({ trackerLookbackMode: 'fixed', trackerLookbackCount: 9 }))
        expect(await lookback('u1')).toEqual({ mode: 'fixed', count: 9 })
    })

    it('carries the connection the user chose', async () => {
        const { connectionId } = trackerPassResolvers(load({ trackerConnectionId: 'fast-small' }))
        expect(await connectionId('u1')).toBe('fast-small')
    })

    it('leaves the connection to the host when none is chosen', async () => {
        expect(await trackerPassResolvers(load({}))!.connectionId('u1')).toBeUndefined()
        expect(await trackerPassResolvers(load({ trackerConnectionId: '' })).connectionId('u1')).toBeUndefined()
    })

    it('asks for the user whose pass this is', async () => {
        const seen: Array<string | undefined> = []
        const { lookback } = trackerPassResolvers(async (userId) => { seen.push(userId); return {} })
        await lookback('u7')
        expect(seen).toEqual(['u7'])
    })
})

describe('numbering the narrative the agent reads', () => {
    const msg = (role: 'user' | 'assistant' | 'system', content: string, index_in_chat?: unknown) =>
        ({ role, content, index_in_chat }) as never

    it('puts the host\'s number on every line, so the model can cite it', () => {
        // Without these the model has nothing to say "this happened at 43"
        // with, and the only number available is the turn the pass ran on.
        const { lines, readRange } = numberedNarrative(
            [msg('user', 'I ask about the docks.', 43), msg('assistant', 'She looks away.', 44)],
            10,
        )
        expect(lines).toEqual(['[#43] User: I ask about the docks.', '[#44] GM: She looks away.'])
        expect(readRange).toEqual([43, 44])
    })

    it('takes the number from the host, never from the line\'s position', () => {
        // Phase 10b. A deleted message makes position and number disagree, and
        // that is exactly when this matters.
        const { readRange } = numberedNarrative([msg('assistant', 'a', 80), msg('assistant', 'b', 91)], 10)
        expect(readRange).toEqual([80, 91])
    })

    it('keeps a message the host will not number, uncitable but readable', () => {
        const { lines, readRange } = numberedNarrative(
            [msg('assistant', 'unnumbered'), msg('assistant', 'numbered', 44)],
            10,
        )
        expect(lines).toEqual(['GM: unnumbered', '[#44] GM: numbered'])
        expect(readRange).toEqual([44])
    })

    it('reports only what it actually showed the model', () => {
        // The range is what a citation is checked against, so it must not name
        // messages outside the window.
        const chat = [msg('user', 'a', 1), msg('assistant', 'b', 2), msg('user', 'c', 3)]
        expect(numberedNarrative(chat, 2).readRange).toEqual([2, 3])
    })

    it('leaves out the host\'s own messages, as the plain narrative does', () => {
        const { readRange } = numberedNarrative(
            [msg('system', 'setup', 1), msg('assistant', 'story', 2)],
            10,
        )
        expect(readRange).toEqual([2])
    })
})

describe('the User Prompt Suffix (72c)', () => {
    it('closes the prompt with the preference’s line, on the automatic and the instructed pass, and with the stock line when it is blank or will not read', async () => {
        const h = harness(['No changes.', 'No changes.'])
        h.deps.outputSuffix = async () => '## OUTPUT THE WHOLE MEMO:'
        await h.pass.run({ chatId: 'c1', messageId: 'm2', generationType: 'normal' })
        await h.pass.run({ chatId: 'c1', trigger: 'direct', instruction: 'Bench Oswin.' })
        const users = h.quiet.mock.calls.map((call) => (call[0] as { messages: Array<{ content: string }> }).messages[1]!.content.trimEnd())
        expect(users.every((user) => user.endsWith('## OUTPUT THE WHOLE MEMO:'))).toBe(true)
        const blank = harness(['No changes.'])
        blank.deps.outputSuffix = async () => '   '
        await blank.pass.run({ chatId: 'c1', messageId: 'm2', generationType: 'normal' })
        expect((blank.quiet.mock.calls[0]![0] as { messages: Array<{ content: string }> }).messages[1]!.content.trimEnd().endsWith('## OUTPUT ONLY CHANGED SECTIONS:')).toBe(true)
        const down = harness(['No changes.'])
        down.deps.outputSuffix = async () => { throw new Error('prefs down') }
        await down.pass.run({ chatId: 'c1', messageId: 'm2', generationType: 'normal' })
        expect((down.quiet.mock.calls[0]![0] as { messages: Array<{ content: string }> }).messages[1]!.content.trimEnd().endsWith('## OUTPUT ONLY CHANGED SECTIONS:')).toBe(true)
    })
})

describe('Full Review Mode (73c, departure 22)', () => {
    it('sends the built-in Core Prompt and suffix in place of the extractor’s and the User Prompt Suffix while on, on the automatic and the instructed pass, never on a modules-only pass, and logs it; off or unreadable, the extractor’s own', async () => {
        const h = harness(['No changes.', 'No changes.'])
        h.deps.fullReview = async () => true
        h.deps.outputSuffix = async () => '## OUTPUT THE WHOLE MEMO:'
        await h.pass.run({ chatId: 'c1', messageId: 'm2', generationType: 'normal' })
        await h.pass.run({ chatId: 'c1', trigger: 'direct', instruction: 'Bench Oswin.' })
        for (const call of h.quiet.mock.calls) {
            const messages = (call[0] as { messages: Array<{ content: string }> }).messages
            expect(messages[0]!.content).toContain('operating in FULL REVIEW MODE')
            expect(messages[0]!.content).not.toContain('{{modulesText}}')
            expect(messages[1]!.content.trimEnd().endsWith('## OUTPUT THE COMPLETE, VERIFIED STATE MEMO FOR EVERY ENABLED MODULE:')).toBe(true)
        }
        expect(vi.mocked(h.deps.log.info).mock.calls.filter((c) => String(c[0]).includes('Full Review Mode'))).toHaveLength(2)
        // A modules-only pass is the creator's own prompt, Full Review or not.
        const creator = harness(['[CHARACTER]\nName: Z\n[/CHARACTER]'])
        creator.deps.fullReview = async () => true
        await creator.pass.run({ chatId: 'c1', trigger: 'direct', instruction: 'Make a character.', systemPromptMode: 'modules_only' })
        const creatorMessages = (creator.quiet.mock.calls[0]![0] as { messages: Array<{ content: string }> }).messages
        expect(creatorMessages[0]!.content).not.toContain('FULL REVIEW MODE')
        expect(creatorMessages[1]!.content).not.toContain('COMPLETE, VERIFIED STATE MEMO')
        const off = harness(['No changes.'])
        off.deps.fullReview = async () => false
        await off.pass.run({ chatId: 'c1', messageId: 'm2', generationType: 'normal' })
        expect((off.quiet.mock.calls[0]![0] as { messages: Array<{ content: string }> }).messages[0]!.content).not.toContain('FULL REVIEW MODE')
        const down = harness(['No changes.'])
        down.deps.fullReview = async () => { throw new Error('prefs down') }
        await down.pass.run({ chatId: 'c1', messageId: 'm2', generationType: 'normal' })
        expect((down.quiet.mock.calls[0]![0] as { messages: Array<{ content: string }> }).messages[0]!.content).not.toContain('FULL REVIEW MODE')
    })
})

describe('the lorebooks shown to the tracker (73h)', () => {
    it('opens every pass’s user prompt with the world lore, the instructed and the modules-only pass included; blank or failed, the prompt opens as before', async () => {
        const LORE = '## WORLD LORE (All Books)\nA keep on the moor.'
        const h = harness(['No changes.', 'No changes.', '[CHARACTER]\nName: Z\n[/CHARACTER]'])
        const asked: string[] = []
        h.deps.worldLore = async (chatId) => { asked.push(chatId); return LORE }
        await h.pass.run({ chatId: 'c1', messageId: 'm2', generationType: 'normal' })
        await h.pass.run({ chatId: 'c1', trigger: 'direct', instruction: 'Bench Oswin.' })
        await h.pass.run({ chatId: 'c1', trigger: 'direct', instruction: 'Make a character.', systemPromptMode: 'modules_only' })
        expect(asked).toEqual(['c1', 'c1', 'c1'])
        for (const call of h.quiet.mock.calls) {
            const user = (call[0] as { messages: Array<{ content: string }> }).messages[1]!.content
            expect(user.startsWith(`${LORE}\n\n## PRIOR MEMO`)).toBe(true)
        }
        const blank = harness(['No changes.'])
        blank.deps.worldLore = async () => '  '
        await blank.pass.run({ chatId: 'c1', messageId: 'm2', generationType: 'normal' })
        expect((blank.quiet.mock.calls[0]![0] as { messages: Array<{ content: string }> }).messages[1]!.content.startsWith('## PRIOR MEMO')).toBe(true)
        const down = harness(['No changes.'])
        down.deps.worldLore = async () => { throw new Error('books down') }
        await down.pass.run({ chatId: 'c1', messageId: 'm2', generationType: 'normal' })
        expect((down.quiet.mock.calls[0]![0] as { messages: Array<{ content: string }> }).messages[1]!.content.startsWith('## PRIOR MEMO')).toBe(true)
        expect(vi.mocked(down.deps.log.warn).mock.calls.some((c) => String(c[0]).includes('the world lore could not be read'))).toBe(true)
    })
})

describe('the history context and the rollback switch (72b)', () => {
    const ADVANCE = '<memo>[TIME]\n07:00 AM, Day 4\n[/TIME]</memo>'
    const OTHER_ADVANCE = '<memo>[TIME]\n08:00 AM, Day 4\n[/TIME]</memo>'

    it('shows the earlier states before the current one when the count is above one, newest last, the current never repeated', async () => {
        const h = harness([ADVANCE, OTHER_ADVANCE, 'No changes.'])
        h.deps.historyStates = async () => 3
        await h.memos.save('c1', '[TIME]\n06:15 AM, Day 4\n[/TIME]')
        await h.pass.run({ chatId: 'c1', messageId: 'm2', generationType: 'normal' })
        await h.pass.run({ chatId: 'c1', messageId: 'm3', generationType: 'normal' })
        await h.pass.run({ chatId: 'c1', messageId: 'm4', generationType: 'normal' })
        const third = h.quiet.mock.calls[2]![0] as { messages: Array<{ content: string }> }
        const user = third.messages[1]!.content
        // The 06:15 memo was saved by hand, never recorded as a pass's state, so the history holds the two passes' states only.
        expect(user).not.toContain('## TRACKER STATE -2')
        expect(user).toContain('## TRACKER STATE -1\n[TIME]\n07:00 AM, Day 4\n[/TIME]')
        expect(user).toContain('## TRACKER STATE 0 (Current)\n[TIME]\n08:00 AM, Day 4\n[/TIME]')
        expect(user).not.toContain('## PRIOR MEMO')
        // At one, the prior memo alone, as it always was.
        const one = harness([ADVANCE, OTHER_ADVANCE])
        one.deps.historyStates = async () => 1
        await one.pass.run({ chatId: 'c1', messageId: 'm2', generationType: 'normal' })
        await one.pass.run({ chatId: 'c1', messageId: 'm3', generationType: 'normal' })
        expect((one.quiet.mock.calls[1]![0] as { messages: Array<{ content: string }> }).messages[1]!.content).toContain('## PRIOR MEMO')
    })

    it('leaves a swipe on the memo as it stands when the rollback switch is off', async () => {
        const h = harness([ADVANCE, OTHER_ADVANCE])
        h.deps.swipeRollback = async () => false
        await h.memos.save('c1', '[TIME]\n06:15 AM, Day 4\n[/TIME]')
        await h.pass.run({ chatId: 'c1', messageId: 'm2', generationType: 'normal' })
        await h.pass.run({ chatId: 'c1', messageId: 'm2', generationType: 'swipe' })
        // Merged onto 07:00, not onto the 06:15 the rollback would have gone back to.
        expect((await h.memos.load('c1')).previous).toBe('[TIME]\n07:00 AM, Day 4\n[/TIME]')
    })
})

describe('the terminal’s steps (71b)', () => {
    it('announces the pass, the model call, the memo’s delta and the end, by the outcome', async () => {
        const steps: Array<[string, string]> = []
        const h = harness()
        h.deps.steps = () => (type, content) => { steps.push([type, content]) }
        const pass = createTrackerPass(h.deps)
        await pass.run({ chatId: 'c1', messageId: 'm2', generationType: 'normal' })
        expect(steps).toEqual([
            ['start', 'Initializing State Tracker pass…'],
            ['thought', expect.stringMatching(/^Analyzing recent narrative \(\d+ messages?\)…$/)],
            ['result', expect.stringMatching(/^Memo updated: \d+ replaced, \d+ added, \d+ removed\.$/)],
            ['finish', 'State Tracker pass complete.'],
        ])
        steps.length = 0
        await pass.run({ chatId: 'c1', instruction: 'Set the clock to noon.', trigger: 'direct', window: 0 })
        expect(steps[0]).toEqual(['start', 'Processing direct State Tracker instruction…'])
        expect(steps[1]).toEqual(['thought', 'Requesting memo update from State Tracker…'])
        expect(steps.at(-1)![0]).toMatch(/finish|result/)
        steps.length = 0
        const failing = harness()
        failing.deps.steps = () => (type, content) => { steps.push([type, content]) }
        failing.quiet.mockRejectedValueOnce(new Error('the model is down'))
        await createTrackerPass(failing.deps).run({ chatId: 'c1', messageId: 'm3', generationType: 'normal' })
        expect(steps.at(-1)).toEqual(['error', expect.stringContaining('the model is down')])
    })
})
