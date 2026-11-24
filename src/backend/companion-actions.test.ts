import { describe, expect, it } from 'vitest'

import { summarizeAgentAction, summarizeMapAction, summarizeTrackerAction } from './companion-actions.js'
import type { AgentRunResult } from '../protocol.js'

const SINCE = '2031-01-01T00:00:10.000Z'
const AFTER = '2031-01-01T00:00:12.000Z'
const agent = (over: Partial<AgentRunResult>): AgentRunResult => ({ at: AFTER, outcome: 'committed', summary: '', steps: [], turnsUsed: 1, problems: [], ...over })

describe('what the Companion is told a State Tracker action did (100c)', () => {
    it('names what changed on the sheet, each kind once', () => {
        expect(summarizeTrackerAction({ status: 'updated', at: AFTER, replaced: ['INVENTORY'], added: ['SPELLS', 'XP'], benched: ['Orrin'], unmatched: ['Orin'] }, SINCE)).toEqual({
            action: 'State Tracker', success: true, status: 'completed',
            message: 'The character sheet changed: updated INVENTORY; added SPELLS, XP; benched Orrin. Nobody on the roster is named Orin.',
        })
        expect(summarizeTrackerAction({ status: 'updated', at: AFTER, removed: ['COMBAT'], unbenched: ['Orrin'], archived: ['The Toll'], relations: ['Pell friendship +5 (now +5)'] }, SINCE).message)
            .toBe('The character sheet changed: removed COMBAT; unbenched Orrin; archived the quests The Toll; relationships: Pell friendship +5 (now +5).')
        expect(summarizeTrackerAction({ status: 'updated', at: AFTER }, SINCE).message).toBe('State Tracker command completed.')
    })

    it('says a pass that changed nothing changed nothing, and counts it as done', () => {
        expect(summarizeTrackerAction({ status: 'no-change', at: AFTER, reason: 'The tracker re-sent INVENTORY unchanged.' }, SINCE)).toEqual({
            action: 'State Tracker', success: true, status: 'noop', message: 'The State Tracker made no change. The tracker re-sent INVENTORY unchanged.',
        })
    })

    it('reports a skipped, a stopped and a failed pass as not done, with the reason', () => {
        expect(summarizeTrackerAction({ status: 'skipped', at: AFTER, reason: 'Another pass is running.' }, SINCE)).toMatchObject({ success: false, status: 'unavailable', message: 'The State Tracker did not run. Another pass is running.' })
        expect(summarizeTrackerAction({ status: 'cancelled', at: AFTER }, SINCE)).toMatchObject({ success: false, status: 'stopped', message: 'The State Tracker pass was stopped.' })
        expect(summarizeTrackerAction({ status: 'failed', at: AFTER, reason: 'The reply had no blocks.' }, SINCE)).toMatchObject({ success: false, status: 'failed', message: 'The State Tracker pass failed. The reply had no blocks.' })
    })

    it('never takes an older pass’s report for this one’s', () => {
        const none = { action: 'State Tracker', success: false, status: 'failed', message: 'State Tracker did not report a result.' }
        expect(summarizeTrackerAction({ status: 'updated', at: '2031-01-01T00:00:09.000Z', replaced: ['INVENTORY'] }, SINCE)).toEqual(none)
        expect(summarizeTrackerAction(undefined, SINCE)).toEqual(none)
        expect(summarizeTrackerAction({ status: 'updated', at: SINCE }, SINCE).success).toBe(true)
    })
})

describe('what the Companion is told a Lorebook Agent action did (100c)', () => {
    it('passes on the agent’s own summary of a commit, with anything the writer refused', () => {
        expect(summarizeAgentAction(agent({ summary: ' Recorded Old Pell. ' }))).toEqual({ action: 'Lorebook Agent', success: true, status: 'completed', message: 'Recorded Old Pell.' })
        expect(summarizeAgentAction(agent({ summary: 'Recorded Old Pell.', write: { changed: [], deleted: [], createdBooks: [], refused: ['delete: holds a map and was kept'] } })).message)
            .toBe('Recorded Old Pell. Refused: delete: holds a map and was kept.')
        expect(summarizeAgentAction(agent({})).message).toBe('Lorebook Agent command completed.')
    })

    it('says a pass that wrote nothing wrote nothing', () => {
        expect(summarizeAgentAction(agent({ outcome: 'no-commit' }))).toEqual({ action: 'Lorebook Agent', success: true, status: 'noop', message: 'The Lorebook Agent wrote nothing.' })
    })

    it('reports an unavailable agent, a stopped pass and a failed one as not done', () => {
        expect(summarizeAgentAction(agent({ outcome: 'failed', unavailable: 'This build cannot run the lorebook agent.' }))).toMatchObject({ success: false, status: 'unavailable', message: 'This build cannot run the lorebook agent.' })
        expect(summarizeAgentAction(agent({ outcome: 'cancelled' }))).toMatchObject({ success: false, status: 'stopped', message: 'The Lorebook Agent pass was stopped.' })
        expect(summarizeAgentAction(agent({ outcome: 'unreadable', problems: ['no Action line', 'ran out of turns'] }))).toMatchObject({ success: false, status: 'failed', message: 'Lorebook Agent command did not complete. no Action line; ran out of turns' })
        expect(summarizeAgentAction(agent({ outcome: 'failed', summary: 'The call failed.' }))).toMatchObject({ success: false, status: 'failed', message: 'The call failed.' })
    })
})

describe('what the Companion is told a Map Updater action did (100c)', () => {
    const base = { at: AFTER, trigger: 'manual' as const }
    it('names the site and what was applied, or that nothing durable changed', () => {
        expect(summarizeMapAction({ ...base, status: 'applied', site: 'Mill Yard', summary: 'REMOVE_ASSET cart (1 operation)' })).toEqual({ action: 'Map Updater', success: true, status: 'completed', message: 'Map occupancy update applied (Mill Yard). REMOVE_ASSET cart (1 operation)' })
        expect(summarizeMapAction({ ...base, status: 'applied', site: '' }).message).toBe('Map occupancy update applied.')
        expect(summarizeMapAction({ ...base, status: 'noop', site: 'Mill Yard' })).toMatchObject({ success: true, status: 'noop', message: 'Nothing durable changed on the map (Mill Yard).' })
    })

    it('reports a skipped update as unavailable and a failed one as failed, in the updater’s own words when it gave any', () => {
        expect(summarizeMapAction({ ...base, status: 'skipped', site: '', reason: 'The party is outside every mapped site.' })).toMatchObject({ success: false, status: 'unavailable', message: 'The party is outside every mapped site.' })
        expect(summarizeMapAction({ ...base, status: 'skipped', site: '' }).message).toBe('The Map Updater did not run.')
        expect(summarizeMapAction({ ...base, status: 'failed', site: 'Mill Yard', reason: 'UNKNOWN_ASSET at ops[0]' })).toMatchObject({ success: false, status: 'failed', message: 'UNKNOWN_ASSET at ops[0]' })
        expect(summarizeMapAction({ ...base, status: 'undone', site: 'Mill Yard' })).toMatchObject({ success: false, status: 'failed', message: 'Could not apply a valid map occupancy update.' })
    })
})
