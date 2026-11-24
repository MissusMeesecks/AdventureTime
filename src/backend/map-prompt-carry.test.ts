import { describe, expect, it, vi } from 'vitest'
import { carryMapPrompts, CARRIED_MAP_PROMPT_KEYS, type MapPromptCarryDeps } from './map-prompt-carry.js'

function harness(prefs: Record<string, string>, cartridge: Record<string, unknown>, over: Partial<MapPromptCarryDeps['store']> = {}) {
    const state = { prefs: { ...prefs }, cartridge: { ...cartridge } }
    const lines: string[] = []
    const deps: MapPromptCarryDeps = {
        prefs: {
            load: async () => ({ ...state.prefs }),
            patch: vi.fn(async (patch) => { Object.assign(state.prefs, patch); return state.prefs }),
        },
        store: {
            load: async () => ({ ...state.cartridge }),
            patch: vi.fn(async (_userId, patch) => { Object.assign(state.cartridge, patch); return { ...state.cartridge } }),
            ...over,
        },
        log: { info: (m) => lines.push(m), warn: (m) => lines.push(`warn: ${m}`) },
    }
    return { deps, state, lines }
}

const STOCK = { mapArchitectSystemPrompt: 'Stock architect.', mapUpdaterSystemPrompt: 'Stock updater.', mapEvolutionSystemPrompt: 'Stock evolution.', mapEvolutionCompressSystemPrompt: 'Stock compress.' }

describe('carryMapPrompts (97)', () => {
    it('names the three preferences the dial boxes wrote, and not the compression prompt, which never had one', () => {
        expect([...CARRIED_MAP_PROMPT_KEYS]).toEqual(['mapArchitectSystemPrompt', 'mapUpdaterSystemPrompt', 'mapEvolutionSystemPrompt'])
    })

    it('writes nothing and logs nothing when every box was blank, as on almost every install', async () => {
        const { deps, state, lines } = harness({ mapArchitectSystemPrompt: '', mapUpdaterSystemPrompt: '  ', mapEvolutionSystemPrompt: '' }, STOCK)
        const report = await carryMapPrompts(deps, 'u1')
        expect(report).toEqual({ carried: [], replaced: [] })
        expect(deps.store.patch).not.toHaveBeenCalled()
        expect(deps.prefs.patch).not.toHaveBeenCalled()
        expect(state.cartridge).toEqual(STOCK)
        expect(lines).toEqual([])
    })

    it('carries a box\'s text into the cartridge, empties the box, and leaves the other prompts as they are', async () => {
        const { deps, state, lines } = harness({ mapArchitectSystemPrompt: '', mapUpdaterSystemPrompt: 'My updater.', mapEvolutionSystemPrompt: '' }, STOCK)
        const report = await carryMapPrompts(deps, 'u1')
        expect(report.carried).toEqual(['mapUpdaterSystemPrompt'])
        expect(report.replaced).toEqual(['mapUpdaterSystemPrompt'])
        expect(report.settings).toMatchObject({ mapUpdaterSystemPrompt: 'My updater.' })
        expect(state.cartridge).toEqual({ ...STOCK, mapUpdaterSystemPrompt: 'My updater.' })
        expect(state.prefs).toEqual({ mapArchitectSystemPrompt: '', mapUpdaterSystemPrompt: '', mapEvolutionSystemPrompt: '' })
        expect(lines[0]).toBe('maps: carried 1 map prompt from the old dial boxes into the cartridge: mapUpdaterSystemPrompt')
        expect(lines[1]).toContain('replaced; no pass had read it')
    })

    it('runs once: a second session finds the boxes empty and writes nothing', async () => {
        const { deps } = harness({ mapArchitectSystemPrompt: 'Mine.', mapUpdaterSystemPrompt: '', mapEvolutionSystemPrompt: 'Also mine.' }, STOCK)
        expect((await carryMapPrompts(deps, 'u1')).carried).toEqual(['mapArchitectSystemPrompt', 'mapEvolutionSystemPrompt'])
        expect((await carryMapPrompts(deps, 'u1')).carried).toEqual([])
        expect(deps.store.patch).toHaveBeenCalledTimes(1)
    })

    it('empties a box whose text the cartridge already holds without writing the cartridge', async () => {
        const { deps, state } = harness({ mapArchitectSystemPrompt: 'Stock architect.', mapUpdaterSystemPrompt: '', mapEvolutionSystemPrompt: '' }, STOCK)
        const report = await carryMapPrompts(deps, 'u1')
        expect(report).toEqual({ carried: ['mapArchitectSystemPrompt'], replaced: [] })
        expect(deps.store.patch).not.toHaveBeenCalled()
        expect(state.prefs.mapArchitectSystemPrompt).toBe('')
    })

    it('keeps the box\'s text when the cartridge write fails, so the next session tries again', async () => {
        const { deps, state } = harness({ mapArchitectSystemPrompt: 'Mine.', mapUpdaterSystemPrompt: '', mapEvolutionSystemPrompt: '' }, STOCK, { patch: async () => { throw new Error('store refused') } })
        await expect(carryMapPrompts(deps, 'u1')).rejects.toThrow('store refused')
        expect(state.prefs.mapArchitectSystemPrompt).toBe('Mine.')
        expect(deps.prefs.patch).not.toHaveBeenCalled()
    })
})
