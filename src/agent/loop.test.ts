import { describe, expect, it, vi } from 'vitest'

import {
    clipStep,
    BUDGET_WARNING_AT,
    DEFAULT_MAX_TURNS,
    HARD_CALL_CEILING,
    MAX_UNREADABLE_REPLIES,
    runAgentLoop,
    thoughtFrom,
    type AgentLoopDeps,
    type AgentMessage,
} from './loop.js'

const PROMPT: AgentMessage[] = [{ role: 'system', content: 'You are the researcher.' }]

/** A model that says each of these in turn, then repeats the last forever. */
function scriptedModel(replies: string[]) {
    let index = 0
    return vi.fn(async (_messages: AgentMessage[]) => replies[Math.min(index++, replies.length - 1)]!)
}

/** What the model was shown last, per call — captured, not read back later. */
function lastSaidTo(generate: { mock: { calls: [AgentMessage[]][] } }): string[] {
    return generate.mock.calls.map((call) => call[0].at(-1)?.content ?? '')
}

function deps(replies: string[], over: Partial<AgentLoopDeps> = {}): AgentLoopDeps {
    return {
        generate: scriptedModel(replies),
        tools: {
            grepLore: async (q) => `3 hits for ${q}`,
            inspectBook: async (b) => `${b} has 4 entries`,
            readEntry: async (id) => `Entry ${id}: prose.`,
        },
        ...over,
    }
}

describe('running a pass', () => {
    it('uses a tool, reads the answer, and then commits', async () => {
        const d = deps([
            'I should look this up.\nAction: grep_lore("Iron Syndicate")',
            'Action: commit({"record": [{"label": "Iron Syndicate", "category": "FAC"}]})',
        ])
        const result = await runAgentLoop(PROMPT, d)

        expect(result.outcome).toBe('committed')
        expect(result.commit?.record).toEqual([
            { label: 'Iron Syndicate', category: 'FAC', keys: [], content: '' },
        ])
        expect(result.turnsUsed).toBe(2)
        expect(result.steps.map((s) => s.kind))
            .toEqual(['thought', 'tool', 'observation', 'thought', 'tool'])
        // The commit's line counts what it carried (65-bis), so a refused
        // item can be read against the shape it came in.
        expect(result.steps[4]).toEqual({ kind: 'tool', name: 'commit', argument: 'record 1' })
    })

    it('counts a commit\'s fields on its transcript line, the reason and empty lists left out', async () => {
        const d = deps(['Action: commit({"record": [{"label": "A", "category": "NPC"}, {"label": "B", "category": "NPC"}], "rel": [{"name": "A", "field": "friendship", "delta": 5}], "update": [], "reason": "why"})'])
        const result = await runAgentLoop(PROMPT, d)
        expect(result.steps.find((s) => s.kind === 'tool')).toEqual({ kind: 'tool', name: 'commit', argument: 'record 2, rel 1' })
        const empty = await runAgentLoop(PROMPT, deps(['Action: commit({})']))
        expect(empty.steps.find((s) => s.kind === 'tool')).toEqual({ kind: 'tool', name: 'commit', argument: '' })
    })

    it('feeds the tool result back to the model', async () => {
        const generate = scriptedModel([
            'Action: read_entry("NPCs::4")',
            'Action: commit({})',
        ])
        await runAgentLoop(PROMPT, deps([], { generate }))

        const second = generate.mock.calls[1]![0]
        expect(second.at(-1)).toEqual({ role: 'user', content: 'Entry NPCs::4: prose.' })
        expect(second.at(-2)?.role).toBe('assistant')
    })

    it('stops at the turn budget without committing', async () => {
        // Not an error. An agent that looks and decides nothing needs doing is
        // behaving correctly.
        const d = deps(['Action: grep_lore("anything")'])
        const result = await runAgentLoop(PROMPT, d, )

        expect(result.outcome).toBe('no-commit')
        expect(result.turnsUsed).toBe(DEFAULT_MAX_TURNS)
        expect(d.generate).toHaveBeenCalledTimes(DEFAULT_MAX_TURNS)
    })

    it('honours a smaller budget', async () => {
        const d = deps(['Action: grep_lore("x")'], { maxTurns: 2 })
        expect((await runAgentLoop(PROMPT, d)).turnsUsed).toBe(2)
        expect(d.generate).toHaveBeenCalledTimes(2)
    })

    it('always spends at least one turn, however the budget is set', async () => {
        // A zero or negative budget must not mean "call the model forever" or
        // "do nothing silently".
        for (const maxTurns of [0, -3]) {
            const d = deps(['Action: grep_lore("x")'], { maxTurns })
            const result = await runAgentLoop(PROMPT, d)
            expect(result.turnsUsed).toBe(1)
        }
    })
})

describe('telling the model it is on a clock', () => {
    it('leaves room to look before committing, without inviting ten round trips', () => {
        // This number has moved twice and the history is the point. 9j raised it
        // to ten because the model started with only a list of book names and
        // spent all five legacy turns searching. 9o then showed it the index of
        // what its books hold, and the next pass committed in two — so the
        // reason for ten was gone, and the leftover budget was the "slow pass"
        // report. It is five again, and configurable per install.
        //
        // The assertion is the shape, not the number: enough turns to search and
        // then decide, and well clear of the hard ceiling that exists to stop a
        // runaway loop.
        expect(DEFAULT_MAX_TURNS).toBeGreaterThanOrEqual(3)
        expect(DEFAULT_MAX_TURNS).toBeLessThan(HARD_CALL_CEILING / 2)
    })


    it('warns as the budget runs down, alongside the tool result', async () => {
        // The first live pass used all five turns researching and committed
        // nothing — with no way to know it was running out. The warning rides
        // with the tool's answer so the model reads both in one turn.
        const generate = scriptedModel(['Action: grep_lore("x")'])
        await runAgentLoop(PROMPT, deps([], { generate, maxTurns: 4 }))

        const said = lastSaidTo(generate)
        // Four turns: after the first, three remain, which is above the
        // threshold and so says nothing. Then the countdown starts.
        expect(said[1]).not.toMatch(/turns left|LAST turn/)
        expect(said[2]).toContain(`${BUDGET_WARNING_AT} turns left`)
        expect(said[3]).toContain('LAST turn')
    })

    it('says plainly on the last turn that it is the last', async () => {
        const generate = scriptedModel(['Action: grep_lore("x")'])
        await runAgentLoop(PROMPT, deps([], { generate, maxTurns: 3 }))

        // The last message the model *reads* is the one before its final call.
        const last = lastSaidTo(generate).at(-1) ?? ''
        expect(last).toContain('LAST turn')
        expect(last).toContain('Commit what you have now')
    })

    it('keeps the tool result alongside the warning, not instead of it', async () => {
        const generate = scriptedModel(['Action: read_entry("A::1")'])
        await runAgentLoop(PROMPT, deps([], { generate, maxTurns: 2 }))

        const last = lastSaidTo(generate).at(-1) ?? ''
        expect(last).toContain('Entry A::1: prose.')
        expect(last).toContain('LAST turn')
    })

    it('says a pass ran out while still researching, not merely that it stopped', async () => {
        const result = await runAgentLoop(PROMPT, deps(['Action: grep_lore("x")'], { maxTurns: 2 }))
        expect(result.summary).toContain('still researching')
    })
})

describe('when the user presses Stop', () => {
    /** What the host throws when the AbortSignal fires. */
    function aborted() {
        const error = new Error('The operation was aborted')
        error.name = 'AbortError'
        return error
    }

    it('reports a cancellation rather than a failure', async () => {
        // A red "the agent could not reach the model" for a button the user
        // pressed themselves is Phase 1d's confusion in a new place.
        const d = deps([], { generate: vi.fn(async () => { throw aborted() }) })
        const result = await runAgentLoop(PROMPT, d)

        expect(result.outcome).toBe('cancelled')
        expect(result.summary).toContain('Nothing was written')
    })

    it('leaves no commit behind, whatever it had found', async () => {
        // The property that makes the button safe to offer: the write happens
        // after the last model call, so a stopped pass has touched no lorebook.
        const generate = vi.fn()
            .mockResolvedValueOnce('Action: grep_lore("Iron Syndicate")')
            .mockImplementationOnce(async () => { throw aborted() })
        const result = await runAgentLoop(PROMPT, deps([], { generate }))

        expect(result.outcome).toBe('cancelled')
        expect(result.commit).toBeNull()
    })

    it('says how far it got', async () => {
        const generate = vi.fn()
            .mockResolvedValueOnce('Action: grep_lore("x")')
            .mockResolvedValueOnce('Action: grep_lore("y")')
            .mockImplementationOnce(async () => { throw aborted() })
        const result = await runAgentLoop(PROMPT, deps([], { generate }))

        expect(result.turnsUsed).toBe(3)
        expect(result.summary).toContain('3 turns')
    })

    it('still calls a real model failure a failure', async () => {
        const d = deps([], { generate: vi.fn(async () => { throw new Error('502 from the provider') }) })
        expect((await runAgentLoop(PROMPT, d)).outcome).toBe('failed')
    })
})

describe('when the model does not cooperate', () => {
    it('re-prompts a reply with no tool call, without charging the turn', async () => {
        const d = deps([
            'I think we should probably consider the situation carefully.',
            'Action: commit({"delete_ids": ["EVENT::9"]})',
        ])
        const result = await runAgentLoop(PROMPT, d)

        expect(result.outcome).toBe('committed')
        // Two model calls, but only the productive one charged.
        expect(d.generate).toHaveBeenCalledTimes(2)
        expect(result.turnsUsed).toBe(1)
        expect(result.steps.some((s) => s.kind === 'unreadable')).toBe(true)
    })

    it('gives up after a bounded number of unreadable replies', async () => {
        // The free retry must be bounded, or a model that never complies loops
        // forever against a budget it is not spending.
        const d = deps(['No tool call here, ever.'])
        const result = await runAgentLoop(PROMPT, d)

        expect(result.outcome).toBe('unreadable')
        expect(d.generate).toHaveBeenCalledTimes(MAX_UNREADABLE_REPLIES + 1)
        expect(result.summary).toMatch(/stopped making sense/)
    })

    it('terminates on a hard call ceiling even if the turn accounting is wrong', async () => {
        // Defence in depth, and it was earned. An unreadable reply refunds its
        // turn on purpose, so the turn budget is not the only way out — break
        // the bound on those and the loop spins forever against a budget it
        // never spends. When that bound was removed on purpose during mutation
        // testing it did not fail a test, it *hung*, which is worse.
        //
        // Nothing can refund a call against the ceiling, so this holds however
        // the accounting above is broken.
        // The model here is perfectly well-behaved — it makes a valid tool
        // call every time and simply never commits — so the unreadable-reply
        // bound never engages and the ceiling is the only thing that stops it.
        // Written that way on purpose: with an uncooperative model the retry
        // bound catches it first and this test would pass with the ceiling
        // removed, which is a test that proves nothing.
        const generate = vi.fn(async (_m: AgentMessage[]) => 'Action: grep_lore("more")')
        const result = await runAgentLoop(PROMPT, {
            ...deps([]),
            generate,
            maxTurns: 1000,
        })

        expect(generate.mock.calls.length).toBe(HARD_CALL_CEILING)
        expect(result.outcome).toBe('unreadable')
        expect(result.summary).toContain('without settling')
    })

    it('tells the model when it invents a tool, and carries on', async () => {
        const generate = scriptedModel([
            'Action: summon_dragon("Smaug")',
            'Action: commit({})',
        ])
        const result = await runAgentLoop(PROMPT, deps([], { generate }))

        expect(result.outcome).toBe('committed')
        const second = generate.mock.calls[1]![0]
        expect(second.at(-1)?.content).toContain('no tool called "summon_dragon"')
    })

    it('reports a model failure and leaves the lore alone', async () => {
        const result = await runAgentLoop(PROMPT, deps([], {
            generate: async () => { throw new Error('rate limited') },
        }))

        expect(result.outcome).toBe('failed')
        expect(result.commit).toBeNull()
        expect(result.summary).toContain('rate limited')
    })

    it('hands a failing tool back to the model rather than ending the pass', async () => {
        // A book that does not exist is something the model can work around.
        const generate = scriptedModel([
            'Action: inspect_book("No Such Book")',
            'Action: commit({})',
        ])
        const result = await runAgentLoop(PROMPT, deps([], {
            generate,
            tools: {
                grepLore: async () => '',
                inspectBook: async () => { throw new Error('no such book') },
                readEntry: async () => '',
            },
        }))

        expect(result.outcome).toBe('committed')
        const second = generate.mock.calls[1]![0]
        expect(second.at(-1)?.content).toContain('no such book')
        expect(result.steps.some((s) => s.kind === 'error')).toBe(true)
    })
})

describe('what a pass reports', () => {
    it('never returns a raw commit — only a checked one', async () => {
        // The whole point of 9f sitting in front of this.
        const result = await runAgentLoop(PROMPT, deps([
            'Action: commit({"update": [{"id": "bad", "content": "x"}], "record": [{"label": "A", "category": "NPC"}]})',
        ]))
        expect(result.commit?.update).toEqual([])
        expect(result.problems).toHaveLength(1)
    })

    it('says what the commit asked for, in words', async () => {
        const result = await runAgentLoop(PROMPT, deps([
            'Action: commit({"record": [{"label": "A", "category": "NPC"}], "delete_ids": ["E::1", "E::2"]})',
        ]))
        expect(result.summary).toBe('The agent asked for 1 new entry, 2 deletions.')
    })

    it('says out loud that it ignored an activation request', async () => {
        // The stock prompt still asks the model to curate an active set. A
        // commit that quietly does less than asked looks half-broken.
        const result = await runAgentLoop(PROMPT, deps([
            'Action: commit({"activate": ["NPCs::1"], "record": [{"label": "A", "category": "NPC"}]})',
        ]))
        expect(result.summary).toContain('1 activation request ignored')
        expect(result.ignoredActivation.activate).toEqual(['NPCs::1'])
    })

    it('names a relationship nudge apart, rather than counting it as a change', async () => {
        // This used to read "1 relationship change" while the writer wrote
        // nothing: the legacy keeps relationship values outside the lorebooks,
        // and so does the store the pass applies them to (44). See `Commit.rel`.
        const result = await runAgentLoop(PROMPT, deps([
            'Action: commit({"rel": [{"id": "NPCs::1", "field": "Trust", "delta": 2}]})',
        ]))
        expect(result.summary).toContain('1 relationship change asked for')
        expect(result.summary).not.toContain('The agent asked for 1 relationship change')
    })

    it('says plainly when a commit changed nothing', async () => {
        const result = await runAgentLoop(PROMPT, deps(['Action: commit({})']))
        expect(result.summary).toBe('The agent committed no changes.')
    })
})

describe('reading the model\'s reasoning for the log', () => {
    it('prefers a labelled thought', () => {
        expect(thoughtFrom('Thought: The party has moved on.\nAction: x()'))
            .toBe('The party has moved on.')
    })

    it('falls back to the opening line, because most models never label one', () => {
        expect(thoughtFrom('The party has moved on.\nAction: x()')).toBe('The party has moved on.')
    })

    it('reads past a model\'s reasoning tags to the words (65-ter)', () => {
        expect(thoughtFrom('<serial-reasoning>\nIvo is covered.\n</serial-reasoning>\nAction: x()')).toBe('Ivo is covered.')
        expect(thoughtFrom('<think>Thought: Nothing to do.</think>\nAction: commit({})')).toBe('Nothing to do.')
    })

    it('truncates, so one rambling turn cannot flood the log', () => {
        expect(thoughtFrom('x'.repeat(400))).toHaveLength(200)
    })

    it('is empty for an empty reply', () => {
        expect(thoughtFrom('   ')).toBe('')
    })
})

describe('the terminal’s steps (71b)', () => {
    it('announces each turn, the thought, the tool call and the observation, and a failure, as the legacy’s feed shows them', async () => {
        const steps: Array<[string, string]> = []
        const d = deps([
            'I should look this up.\nAction: grep_lore("Iron Syndicate")',
            'Action: commit({"record": [{"label": "Iron Syndicate", "category": "FAC"}]})',
        ], { maxTurns: 4, step: (type, content) => { steps.push([type, content]) } })
        await runAgentLoop(PROMPT, d)
        expect(steps).toEqual([
            ['thought', 'Thinking (turn 1/4)…'],
            ['thought', 'I should look this up.'],
            ['tool', 'grep_lore(Iron Syndicate)'],
            ['result', '3 hits for Iron Syndicate'],
            ['thought', 'Thinking (turn 2/4)…'],
            ['tool', 'commit(record 1)'],
        ])
        const failing = deps(['Action: read_entry("B::9")', 'Action: commit({})'], {
            step: (type, content) => { steps.push([type, content]) },
            tools: { grepLore: async () => '', inspectBook: async () => '', readEntry: async () => { throw new Error('no such entry') } },
        })
        steps.length = 0
        await runAgentLoop(PROMPT, failing)
        expect(steps.slice(0, 4)).toEqual([
            ['thought', 'Thinking (turn 1/5)…'],
            ['tool', 'read_entry(B::9)'],
            ['error', 'no such entry'],
            ['result', 'That tool failed: no such entry'],
        ])
        // A long observation is clipped to the feed's line.
        expect(clipStep('a'.repeat(300))).toBe(`${'a'.repeat(200)}…`)
        expect(clipStep('  two\n  lines ')).toBe('two lines')
    })
})
