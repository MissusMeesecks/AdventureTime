import { describe, expect, it, vi } from 'vitest'

import { createTerminal, parseMapArchitectDirective, secondsSince, TERMINAL_SOURCES, TERMINAL_TABS, type TerminalStep } from './terminal.js'

describe('the terminal (71b): a buffer of steps per chat and per source, each announced as it is kept', () => {
    it('keeps a step, announces it, and starts a source afresh on a start step', () => {
        const sent: TerminalStep[] = []
        let tick = 0
        const terminal = createTerminal({ send: (_chat, _user, step) => { sent.push(step) }, now: () => new Date(1_700_000_000_000 + tick++ * 1000) })
        terminal.step('c1', 'u1', 'lorebook_agent', 'start', 'Initializing the agent…')
        terminal.step('c1', 'u1', 'lorebook_agent', 'thought', 'Thinking…')
        terminal.step('c1', 'u1', 'lorebook_agent', 'finish', 'Done.', { seconds: 12.345 })
        expect(sent.map((s) => s.type)).toEqual(['start', 'thought', 'finish'])
        expect(sent[2]).toMatchObject({ source: 'lorebook_agent', type: 'finish', content: 'Done.', seconds: 12.3, at: new Date(1_700_000_002_000).toISOString() })
        expect(terminal.steps('c1').lorebook_agent).toHaveLength(3)
        expect(terminal.steps('c1').state_tracker).toEqual([])
        // The next pass's start empties the feed, as the legacy's does.
        terminal.step('c1', 'u1', 'lorebook_agent', 'start', 'Again')
        expect(terminal.steps('c1').lorebook_agent.map((s) => s.content)).toEqual(['Again'])
        // The copy handed out is the caller's: pushing onto it changes nothing kept.
        terminal.steps('c1').lorebook_agent.push({ source: 'lorebook_agent', type: 'error', content: 'x', at: '' })
        expect(terminal.steps('c1').lorebook_agent).toHaveLength(1)
    })

    it('binds a step function to one pass, bounds what is kept, forgets the oldest chat, and clears on request', () => {
        const terminal = createTerminal({ send: () => undefined, keep: 3, chats: 2 })
        const step = terminal.bind('map_updater', 'c1', 'u1')
        for (let i = 0; i < 5; i++) step('thought', `t${i}`)
        expect(terminal.steps('c1').map_updater.map((s) => s.content)).toEqual(['t2', 't3', 't4'])
        terminal.bind('state_tracker', 'c2', 'u1')('start', 'a')
        terminal.bind('state_tracker', 'c3', 'u1')('start', 'b')
        // c1 is the oldest untouched chat and is forgotten past two.
        expect(terminal.steps('c1').map_updater).toEqual([])
        expect(terminal.steps('c2').state_tracker).toHaveLength(1)
        terminal.clear('c2', 'state_tracker')
        expect(terminal.steps('c2').state_tracker).toEqual([])
        terminal.bind('map_evolution', 'c3', 'u1')('result', 'r')
        terminal.clear('c3')
        expect(Object.values(terminal.steps('c3')).every((list) => list.length === 0)).toBe(true)
        // A send that throws never loses the step.
        const loud = createTerminal({ send: () => { throw new Error('gone') } })
        loud.step('c9', undefined, 'map_architect', 'start', 'x')
        expect(loud.steps('c9').map_architect).toHaveLength(1)
    })

    it('names the five sources in the legacy’s tab order', () => {
        expect(TERMINAL_TABS.map((t) => t.id)).toEqual(TERMINAL_SOURCES)
        expect(TERMINAL_TABS.map((t) => t.label)).toEqual(['State Tracker', 'Lorebook Agent', 'Map Updater', 'Map Evolution', 'Map Architect'])
    })

    it('counts the seconds a pass worked', () => {
        expect(secondsSince(1000, 13500)).toBe(12.5)
        expect(secondsSince(5000, 1000)).toBe(0)
        vi.useFakeTimers()
        vi.setSystemTime(10_000)
        expect(secondsSince(7_000)).toBe(3)
        vi.useRealTimers()
    })
})

describe('the Map Architect’s direct command (71b), the legacy’s parser', () => {
    it('reads the kind and the site out of a creation command, quoted or bare, and nothing else', () => {
        expect(parseMapArchitectDirective('Create DUNGEON map for "The Hollow"')).toEqual({ kind: 'DUNGEON', site: 'The Hollow' })
        expect(parseMapArchitectDirective("create an interior map for 'Mill House': three floors")).toEqual({ kind: 'INTERIOR', site: 'Mill House' })
        expect(parseMapArchitectDirective('Please create a settlement map for Elmridge')).toEqual({ kind: 'SETTLEMENT', site: 'Elmridge' })
        expect(parseMapArchitectDirective('Create a SETTLEMENT map for Elmridge: a river town')).toEqual({ kind: 'SETTLEMENT', site: 'Elmridge' })
        expect(parseMapArchitectDirective('add a well to the square')).toBeNull()
        expect(parseMapArchitectDirective('create a CASTLE map for X')).toBeNull()
        expect(parseMapArchitectDirective('create a dungeon map for ')).toBeNull()
        expect(parseMapArchitectDirective('')).toBeNull()
    })
})
