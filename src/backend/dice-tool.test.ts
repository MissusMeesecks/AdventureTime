import { describe, expect, it, vi } from 'vitest'

import {
    DICE_TOOL_D100,
    DICE_TOOL_D20,
    createDiceToolSync,
    createDiceToolCoordinator,
    diceToolRegistrations,
    explainDiceTools,
    handleDiceToolInvocation,
    wantedDiceTools,
} from './dice-tool.js'

const HYBRID = { rngEnabled: true, diceFunctionTool: true, rngToolD20: true }
const COMBAT = '[COMBAT]\nRound 1: goblin 4/7\n[/COMBAT]'
const faces = (...values: number[]) => {
    let i = 0
    return () => values[i++ % values.length]! - 1
}

describe('which tools the settings ask for', () => {
    it('registers the unified roller for the d20 flag, with its DC-anchored schema, inline', () => {
        const [tool] = diceToolRegistrations({ rngToolD20: true })
        expect(tool!.name).toBe(DICE_TOOL_D20)
        expect(tool!.display_name).toBe('Dice Roll (with DC)')
        expect(tool!.inline_available).toBe(true)
        const params = tool!.parameters as { required: string[]; properties: Record<string, { description: string }> }
        expect(params.required).toEqual(['who', 'for', 'formula', 'dc'])
        expect(params.properties.dc!.description).toContain('Anchors difficulty BEFORE the roll is made')
        expect(params.properties.formula!.description).toContain('"2d20kh1" for advantage')
    })

    it('registers the d100 roller for the d100 flag, roll-under', () => {
        const tools = diceToolRegistrations({ rngToolD100: true })
        expect(tools.map((t) => t.name)).toEqual([DICE_TOOL_D100])
        expect(tools[0]!.description).toContain('roll ≤ dc = success')
    })

    it('registers both, d20 first, or neither', () => {
        expect(diceToolRegistrations({ rngToolD20: true, rngToolD100: true }).map((t) => t.name)).toEqual([DICE_TOOL_D20, DICE_TOOL_D100])
        expect(diceToolRegistrations({})).toEqual([])
    })

    it('drops the DC from the schema under the legacy naming', () => {
        const [tool] = diceToolRegistrations({ rngToolD20: true, legacyDiceNaming: true })
        expect(tool!.display_name).toBe('Dice Roll')
        expect((tool!.parameters as { required: string[] }).required).toEqual(['who', 'formula'])
    })
})

describe('which tools are wanted right now', () => {
    it('follows the flags outside combat', () => {
        expect(wantedDiceTools(HYBRID, null).map((t) => t.name)).toEqual([DICE_TOOL_D20])
        expect(wantedDiceTools(HYBRID, '[HP]\n1\n[/HP]').map((t) => t.name)).toEqual([DICE_TOOL_D20])
    })

    // In combat the queue is the only mechanic, so the schemas go away.
    it('is nothing in combat in hybrid mode', () => {
        expect(wantedDiceTools(HYBRID, COMBAT)).toEqual([])
        expect(wantedDiceTools(HYBRID, '[COMBAT]\nEND_COMBAT\n[/COMBAT]').map((t) => t.name)).toEqual([DICE_TOOL_D20])
    })

    it('leaves the flags in charge when the mode is not hybrid', () => {
        expect(wantedDiceTools({ ...HYBRID, diceFunctionTool: false }, COMBAT).map((t) => t.name)).toEqual([DICE_TOOL_D20])
    })
})

describe('keeping the host in step', () => {
    const make = () => {
        const host = { registerTool: vi.fn(), unregisterTool: vi.fn() }
        const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
        return { host, log, sync: createDiceToolSync(host, log) }
    }

    it('registers what is wanted and unregisters what is not, once each', () => {
        const { host, sync } = make()
        sync.sync(HYBRID, null)
        sync.sync(HYBRID, null)
        expect(host.registerTool).toHaveBeenCalledTimes(1)
        expect(sync.registered()).toEqual([DICE_TOOL_D20])

        sync.sync(HYBRID, COMBAT)
        expect(host.unregisterTool).toHaveBeenCalledWith(DICE_TOOL_D20)
        expect(sync.registered()).toEqual([])

        sync.sync(HYBRID, null)
        expect(host.registerTool).toHaveBeenCalledTimes(2)
    })

    // Our record and the host's can drift invisibly; asked to, sync
    // registers afresh even when nothing changed, and says so in the log.
    it('registers afresh when asked, even with nothing changed', () => {
        const { host, log, sync } = make()
        sync.sync(HYBRID, null)
        sync.sync(HYBRID, null, { reassert: true })
        expect(host.unregisterTool).toHaveBeenCalledTimes(1)
        expect(host.registerTool).toHaveBeenCalledTimes(2)
        expect(log.info).toHaveBeenCalledWith(expect.stringContaining('registered afresh'))
        expect(sync.registered()).toEqual([DICE_TOOL_D20])
    })

    it('registers afresh even if the host has nothing to unregister', () => {
        const { host, sync } = make()
        host.unregisterTool.mockImplementation(() => { throw new Error('unknown tool') })
        sync.sync(HYBRID, null, { reassert: true })
        expect(host.registerTool).toHaveBeenCalledTimes(1)
        expect(sync.registered()).toEqual([DICE_TOOL_D20])
    })

    it('does not register afresh on an ordinary sync', () => {
        const { host, sync } = make()
        sync.sync(HYBRID, null)
        sync.sync(HYBRID, null)
        sync.sync(HYBRID, null, {})
        expect(host.registerTool).toHaveBeenCalledTimes(1)
    })

    it('re-registers a tool whose schema changed', () => {
        const { host, sync } = make()
        sync.sync(HYBRID, null)
        sync.sync({ ...HYBRID, legacyDiceNaming: true }, null)
        expect(host.unregisterTool).toHaveBeenCalledWith(DICE_TOOL_D20)
        expect(host.registerTool).toHaveBeenCalledTimes(2)
    })

    it('treats missing settings as nothing wanted', () => {
        const { host, sync } = make()
        sync.sync(HYBRID, null)
        sync.sync(null, null)
        expect(host.unregisterTool).toHaveBeenCalledWith(DICE_TOOL_D20)
    })

    // The `tools` permission missing is the likely cause; the audit names it.
    it('logs and carries on when the host refuses', () => {
        const { host, log, sync } = make()
        host.registerTool.mockImplementation(() => { throw new Error('PERMISSION_DENIED') })
        expect(() => sync.sync(HYBRID, null)).not.toThrow()
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('PERMISSION_DENIED'))
        expect(sync.registered()).toEqual([])
    })

    it('unregisters everything on dispose', () => {
        const { host, sync } = make()
        sync.sync({ ...HYBRID, rngToolD100: true }, null)
        sync.dispose()
        expect(host.unregisterTool).toHaveBeenCalledTimes(2)
        expect(sync.registered()).toEqual([])
    })
})

describe('the coordinator', () => {
    const make = (memoByChat: Record<string, string | null>) => {
        const tools = { sync: vi.fn() }
        const coordinator = createDiceToolCoordinator({
            settings: (userId) => (userId === 'u1' ? HYBRID : null),
            memo: (chatId) => memoByChat[chatId] ?? null,
            tools,
        })
        return { tools, coordinator }
    }

    // The live bug: a sync naming no chat read as "not in combat" and put
    // the tool back in the middle of a fight.
    it('keeps using the last chat\'s memo when a sync names no chat', () => {
        const { tools, coordinator } = make({ c1: COMBAT })
        coordinator.sync('u1', 'c1')
        expect(tools.sync).toHaveBeenLastCalledWith(HYBRID, COMBAT, {})
        coordinator.sync('u1')
        expect(tools.sync).toHaveBeenLastCalledWith(HYBRID, COMBAT, {})
        coordinator.sync()
        expect(tools.sync).toHaveBeenLastCalledWith(HYBRID, COMBAT, {})
    })

    it('keeps using the last user\'s settings when a sync names no user', () => {
        const { tools, coordinator } = make({ c1: null })
        coordinator.sync('u1', 'c1')
        coordinator.sync(undefined, 'c1')
        expect(tools.sync).toHaveBeenLastCalledWith(HYBRID, null, {})
        expect(coordinator.current()).toEqual({ userId: 'u1', chatId: 'c1' })
    })

    it('follows a change of chat', () => {
        const { tools, coordinator } = make({ c1: COMBAT, c2: null })
        coordinator.sync('u1', 'c1')
        coordinator.sync('u1', 'c2')
        expect(tools.sync).toHaveBeenLastCalledWith(HYBRID, null, {})
    })

    it('passes the reassert option through', () => {
        const { tools, coordinator } = make({ c1: null })
        coordinator.sync('u1', 'c1', { reassert: true })
        expect(tools.sync).toHaveBeenLastCalledWith(HYBRID, null, { reassert: true })
    })

    it('syncs with nothing before any user is known', () => {
        const { tools, coordinator } = make({})
        coordinator.sync()
        expect(tools.sync).toHaveBeenLastCalledWith(null, null, {})
    })
})

describe('why there is no tool', () => {
    it('is nothing while one is registered', () => {
        expect(explainDiceTools({ rngEnabled: false }, null, ['RollTheDice'])).toBeNull()
    })

    it('names the mode first, then the switches, then combat, then the host', () => {
        expect(explainDiceTools({ rngEnabled: true, diceFunctionTool: false, rngToolD20: true }, COMBAT, [])).toBe('mode')
        expect(explainDiceTools(null, null, [])).toBe('mode')
        expect(explainDiceTools({ rngEnabled: true, diceFunctionTool: true }, COMBAT, [])).toBe('flags')
        expect(explainDiceTools(HYBRID, COMBAT, [])).toBe('combat')
        expect(explainDiceTools(HYBRID, null, [])).toBe('refused')
    })
})

describe('answering an invocation', () => {
    it('rolls the unified tool against its DC', () => {
        const out = handleDiceToolInvocation(
            { toolName: DICE_TOOL_D20, args: { who: 'Mara', for: 'perception', formula: '1d20+3', dc: 15 } },
            { random: faces(6) },
        )
        expect(out).toBe('Mara (perception) rolls a 1d20+3 against DC 15. The result is: 9. Individual rolls: 6 (Result: FAILURE)')
    })

    it('rolls the d100 tool under its percentage', () => {
        const out = handleDiceToolInvocation({ toolName: DICE_TOOL_D100, args: { who: 'GM', for: 'hit', dc: 60 } }, { random: faces(60) })
        expect(out).toContain('rolls a 1d100 against DC 60')
        expect(out).toContain('→ HIT')
    })

    it('falls back to the die the cartridge plays with, from either tool', () => {
        expect(handleDiceToolInvocation({ toolName: DICE_TOOL_D20, args: { formula: 'many' } }, { d100Mode: true, random: faces(77) }))
            .toContain('defaulted to 1d100')
        expect(handleDiceToolInvocation({ toolName: DICE_TOOL_D100, args: { formula: 'many' } }, { d100Mode: true, random: faces(77) }))
            .toContain('defaulted to 1d100')
        expect(handleDiceToolInvocation({ toolName: DICE_TOOL_D100, args: { formula: 'many' } }, { random: faces(7) }))
            .toContain('defaulted to 1d20')
    })

    it('does not answer for a tool that is not ours', () => {
        expect(handleDiceToolInvocation({ toolName: 'SomeoneElsesTool', args: {} })).toBeUndefined()
    })

    it('survives missing args', () => {
        expect(handleDiceToolInvocation({ toolName: DICE_TOOL_D20, args: undefined as never }, { random: faces(3) }))
            .toBe('The result of a 1d20 roll against DC 0 is: 3. Individual rolls: 3')
    })
})
