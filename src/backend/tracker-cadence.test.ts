import { describe, expect, it, vi } from 'vitest'

import {
    DEFAULT_TRACKER_RUN_EVERY,
    MAX_TRACKER_RUN_EVERY,
    decideTrackerPass,
    maybeRunTrackerPass,
    readTrackerRunEvery,
    type TrackerCadenceDeps,
} from './tracker-cadence.js'

/** `u a u a …` — a chat of alternating turns, as a role list. */
function chat(turns: number): string[] {
    return Array.from({ length: turns * 2 }, (_, i) => (i % 2 === 0 ? 'user' : 'assistant'))
}

describe('the default cadence', () => {
    // The rule everything else is measured against. An install nobody has
    // touched must behave exactly as it did before this module existed.
    it('runs on every reply, and asks for no floor', () => {
        const decision = decideTrackerPass({ roles: chat(5), watermark: 4, runEvery: 1 })

        expect(decision.run).toBe(true)
        expect(decision.floor).toBe(0)
        expect(decision.reason).toContain('every reply')
    })

    // At cadence 1 nothing in here may widen the window, however far behind the
    // watermark happens to be — that is the byte-identical guarantee.
    it('asks for no floor at cadence 1 even when the watermark is far behind', () => {
        const decision = decideTrackerPass({ roles: chat(20), watermark: 2, runEvery: 1 })

        expect(decision.floor).toBe(0)
    })

    it('is the value a missing or nonsense setting reads as', () => {
        for (const value of [undefined, null, '', 0, -3, Number.NaN, 'nope']) {
            expect(readTrackerRunEvery(value)).toBe(DEFAULT_TRACKER_RUN_EVERY)
        }
    })

    // Unlike the agent's cadence, 0 is not "off" — the legacy clamps to 1, and
    // a tracker that never runs is a much bigger switch than "less often".
    it('never reads as off', () => {
        expect(readTrackerRunEvery(0)).toBe(1)
        expect(decideTrackerPass({ roles: chat(3), watermark: 0, runEvery: 0 }).run).toBe(true)
    })

    it('clamps an absurd cadence rather than accepting it', () => {
        expect(readTrackerRunEvery(9999)).toBe(MAX_TRACKER_RUN_EVERY)
    })
})

describe('throttling', () => {
    it('holds until the cadence is reached, and says how many are left', () => {
        // Two replies since the watermark, cadence of three.
        const decision = decideTrackerPass({ roles: chat(5), watermark: 6, runEvery: 3 })

        expect(decision.replies).toBe(2)
        expect(decision.run).toBe(false)
        expect(decision.reason).toBe('1 more reply before the next pass')
    })

    it('runs once the replies have accumulated', () => {
        const decision = decideTrackerPass({ roles: chat(5), watermark: 4, runEvery: 3 })

        expect(decision.replies).toBe(3)
        expect(decision.run).toBe(true)
        expect(decision.watermark).toBe(10)
    })

    // The user's messages are not replies. The agent's cadence shipped counting
    // `messages.length` and fired twice as often as it promised (lesson 17);
    // the same unit error is available here.
    it('counts the model\'s replies, not messages', () => {
        // Six messages after the watermark, but only three of them are replies.
        const decision = decideTrackerPass({ roles: chat(5), watermark: 4, runEvery: 4 })

        expect(decision.replies).toBe(3)
        expect(decision.run).toBe(false)
    })
})

describe('the floor — what a throttled pass must still read', () => {
    // The divergence from the pin. The legacy rebuilds its window from
    // `chat.length` with no knowledge of the tick, so raising the cadence there
    // drops the skipped turns' story silently.
    it('reaches back to where the last pass ran', () => {
        const decision = decideTrackerPass({ roles: chat(5), watermark: 4, runEvery: 3 })

        // Six messages have arrived since the last pass; all six must be read.
        expect(decision.floor).toBe(6)
    })

    // The floor covers what a *previous* pass would have covered. None ran, so
    // there is nothing to catch up on, and a first pass on a long chat must not
    // suddenly send two hundred messages to the extractor.
    it('asks for nothing when no pass has ever run', () => {
        const decision = decideTrackerPass({ roles: chat(80), watermark: 0, runEvery: 3 })

        expect(decision.run).toBe(true)
        expect(decision.floor).toBe(0)
    })

    it('asks for nothing when it is holding', () => {
        const decision = decideTrackerPass({ roles: chat(5), watermark: 6, runEvery: 3 })

        expect(decision.run).toBe(false)
        expect(decision.floor).toBe(0)
    })
})

describe('a re-track', () => {
    // A swipe rebuilds the memo from the state before the replaced reply
    // (Phase 1b). Holding that for two more replies leaves the memo describing
    // a turn that did not happen — Phase 9r's argument, on the store that feeds
    // every prompt.
    it('runs whatever the cadence says', () => {
        const decision = decideTrackerPass({
            roles: chat(5),
            watermark: 8,
            runEvery: 5,
            retrack: true,
        })

        expect(decision.run).toBe(true)
        expect(decision.reason).toContain('replaced')
    })

    it('still reads back to the last pass', () => {
        const decision = decideTrackerPass({
            roles: chat(5),
            watermark: 4,
            runEvery: 5,
            retrack: true,
        })

        expect(decision.floor).toBe(6)
    })

    // A swipe replaces a message rather than adding one, so the chat does not
    // get longer and neither number moves. That is the legacy's swipe denylist
    // without depending on a generation type its own comment calls unreliable —
    // and the tracker is the one pass the legacy forgot to exclude.
    it('cannot spend the cadence, because the chat did not grow', () => {
        const before = decideTrackerPass({ roles: chat(5), watermark: 6, runEvery: 3 })
        // The same chat after a swipe: same length, same roles.
        const after = decideTrackerPass({ roles: chat(5), watermark: 6, runEvery: 3, retrack: true })

        expect(before.replies).toBe(after.replies)
    })
})

describe('a chat that got shorter', () => {
    // Clamped on the way in and thrown away is worse than not clamping: nothing
    // is ever new and passes stop for good. The decision carries the corrected
    // value and the caller writes it back.
    it('carries a corrected watermark even while holding', () => {
        const decision = decideTrackerPass({ roles: chat(2), watermark: 40, runEvery: 3 })

        expect(decision.watermark).toBe(4)
        expect(decision.run).toBe(false)
    })

    it('never reports a negative floor', () => {
        const decision = decideTrackerPass({ roles: chat(2), watermark: 40, runEvery: 3, retrack: true })

        expect(decision.floor).toBeGreaterThanOrEqual(0)
    })
})

describe('running it', () => {
    function deps(over: Partial<TrackerCadenceDeps> = {}) {
        const ran: Array<{ floor: number }> = []
        const written: number[] = []
        const base: TrackerCadenceDeps = {
            roles: async () => chat(5),
            runEvery: async () => 3,
            readWatermark: async () => 4,
            writeWatermark: async (_chatId, _userId, watermark) => {
                written.push(watermark)
            },
            run: async (request) => {
                ran.push({ floor: request.floor })
            },
            ...over,
        }
        return { base, ran, written }
    }

    it('runs the pass with the floor the decision produced', async () => {
        const { base, ran } = deps()

        await maybeRunTrackerPass(base, { chatId: 'c1', userId: 'u1' })

        expect(ran).toEqual([{ floor: 6 }])
    })

    it('does not run the pass while holding', async () => {
        const { base, ran } = deps({ readWatermark: async () => 6 })

        await maybeRunTrackerPass(base, { chatId: 'c1', userId: 'u1' })

        expect(ran).toEqual([])
    })

    it('records the watermark even when it held', async () => {
        const { base, written } = deps({ roles: async () => chat(2), readWatermark: async () => 40 })

        await maybeRunTrackerPass(base, { chatId: 'c1', userId: 'u1' })

        expect(written).toEqual([4])
    })

    // Recognised here rather than by the pass, because the cadence is what has
    // to be bypassed. The pass has its own list for a different question.
    it('treats a swipe as a re-track and runs anyway', async () => {
        const { base, ran } = deps({ readWatermark: async () => 10 })

        await maybeRunTrackerPass(base, { chatId: 'c1', userId: 'u1', generationType: 'swipe' })

        expect(ran).toHaveLength(1)
    })

    it('passes the message and generation type straight through', async () => {
        const seen: unknown[] = []
        const { base } = deps({ run: async (request) => { seen.push(request) } })

        await maybeRunTrackerPass(base, {
            chatId: 'c1',
            userId: 'u1',
            messageId: 'm9',
            generationType: 'normal',
        })

        expect(seen[0]).toMatchObject({ chatId: 'c1', userId: 'u1', messageId: 'm9', generationType: 'normal' })
    })

    // The tracker not running is the bug this project has spent the most
    // sessions on. Running it too often is a cost. Fail toward the cost.
    it('runs the pass anyway when the chat cannot be read', async () => {
        const { base, ran } = deps({
            roles: async () => {
                throw new Error('host is unhappy')
            },
        })

        await expect(maybeRunTrackerPass(base, { chatId: 'c1', userId: 'u1' })).resolves.toBeNull()
        expect(ran).toEqual([{ floor: 0 }])
    })

    // A watermark that cannot be stored is a lost optimisation, not a lost
    // pass. Letting it reject would take down the pass it was scheduling.
    it('still runs when the watermark cannot be stored', async () => {
        const { base, ran } = deps({
            writeWatermark: async () => {
                throw new Error('storage is full')
            },
        })

        await maybeRunTrackerPass(base, { chatId: 'c1', userId: 'u1' })

        expect(ran).toHaveLength(1)
    })

    it('says why when it skipped', async () => {
        const log = vi.fn()
        const { base } = deps({ readWatermark: async () => 6, log })

        await maybeRunTrackerPass(base, { chatId: 'c1', userId: 'u1' })

        expect(log).toHaveBeenCalledWith(expect.stringContaining('skipped'))
    })
})
