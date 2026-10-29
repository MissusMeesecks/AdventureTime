import { describe, expect, it } from 'vitest'

import { DEFAULT_RUN_EVERY, autoPassLookback, decideAutoPass, watermarkAfterRollback } from './auto-pass.js'

/** A chat of `n` exchanges: the user writes, the model replies. */
const chat = (exchanges: number): string[] =>
    Array.from({ length: exchanges * 2 }, (_, i) => (i % 2 === 0 ? 'user' : 'assistant'))

const decide = (over: Partial<Parameters<typeof decideAutoPass>[0]> = {}) =>
    decideAutoPass({ roles: [], watermark: 0, runEvery: DEFAULT_RUN_EVERY, ...over })

describe('deciding whether a pass runs on its own', () => {
    it('counts the model\'s replies, not every message', () => {
        // The maintainer's own question caught this: a chat holds their
        // messages too, so counting length made a cadence of 4 fire after two
        // exchanges. The legacy ticks once per generation. The default is
        // Multihog's 3 since 73b (departure 5).
        expect(decide({ roles: chat(2) }).run).toBe(false)
        expect(decide({ roles: chat(3) }).run).toBe(true)
    })

    it('does not count the user writing several times in a row', () => {
        const roles = ['user', 'user', 'user', 'user', 'user', 'assistant']
        expect(decide({ roles }).replies).toBe(1)
        expect(decide({ roles }).run).toBe(false)
    })

    it('ignores system messages', () => {
        const roles = ['system', 'system', 'user', 'assistant', 'system']
        expect(decide({ roles }).replies).toBe(1)
    })

    it('counts from the last pass, not from the start of the chat', () => {
        expect(decide({ roles: chat(20), watermark: 36 }).run).toBe(false)
        expect(decide({ roles: chat(20), watermark: 32 }).run).toBe(true)
    })

    it('says how many replies are still to come', () => {
        expect(decide({ roles: chat(1) }).reason).toContain('2 more replies')
        expect(decide({ roles: chat(2) }).reason).toContain('1 more reply')
    })

    it('is off when the cadence is zero', () => {
        // The number is the switch: nobody should have to find a separate
        // checkbox to stop it writing.
        const held = decide({ roles: chat(50), runEvery: 0 })
        expect(held.run).toBe(false)
        expect(held.reason).toContain('switched off')
    })

    it('is off for a nonsense cadence rather than running every reply', () => {
        for (const runEvery of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(decide({ roles: chat(50), runEvery }).run).toBe(false)
        }
    })

    it('runs every reply when asked to', () => {
        expect(decide({ roles: chat(20), watermark: 38, runEvery: 1 }).run).toBe(true)
    })

    it('reads only what is new once a pass has run, counted in messages', () => {
        // The cadence counts replies; the lookback is a slice of the chat, so
        // four replies since the watermark is eight messages of story.
        const decision = decide({ roles: chat(20), watermark: 32 })
        expect(decision.replies).toBe(4)
        expect(decision.lookback).toBe(8)
    })

    it('reads the whole chat when no pass has ever run', () => {
        // A first pass over an established campaign wants the lot; `0` is how
        // the rest of the build spells that.
        expect(decide({ roles: chat(40), watermark: 0 }).lookback).toBe(0)
    })

    it('is not advanced by a swipe, which replaces a message rather than adding one', () => {
        const roles = chat(3)
        expect(decide({ roles, watermark: 0 })).toEqual(decide({ roles, watermark: 0 }))
    })

    it('hands back a watermark corrected for messages that were deleted', () => {
        // The first version clamped on the way in and threw the result away, so
        // nothing was ever new and automatic passes stopped for good.
        const decision = decide({ roles: chat(2), watermark: 83 })
        expect(decision.watermark).toBe(4)
        expect(decision.run).toBe(false)
    })

    it('runs again a cycle after a deletion, once that correction is stored', () => {
        expect(decide({ roles: chat(6), watermark: 4 }).run).toBe(true)
    })

    it('moves the watermark to the end of the chat when it runs', () => {
        expect(decide({ roles: chat(20), watermark: 32 }).watermark).toBe(40)
    })

    it('leaves the watermark where it is while holding', () => {
        expect(decide({ roles: chat(20), watermark: 36 }).watermark).toBe(36)
    })

    it('tolerates a fractional cadence rather than never firing', () => {
        expect(decide({ roles: chat(5), runEvery: 4.7 }).run).toBe(true)
    })
})

describe('where the watermark goes after a swipe rolled a pass back', () => {
    it('leaves the next reply to fire a fresh pass', () => {
        // The rolled-back pass is gone. Waiting a whole cycle would leave the
        // campaign missing that turn's lore for four more replies. Live, this
        // did not happen: the prime was being overwritten by a concurrent
        // write, so the swipe rolled back and nothing regenerated.
        const roles = chat(10)
        const watermark = watermarkAfterRollback(roles, 4)

        expect(decideAutoPass({ roles, watermark, runEvery: 4 }).run).toBe(false)
        expect(decideAutoPass({ roles: chat(11), watermark, runEvery: 4 }).run).toBe(true)
    })

    it('walks back past replies, not messages', () => {
        // Three replies back in a chat of exchanges is six messages, and
        // walking back three *messages* would leave the count one short.
        expect(watermarkAfterRollback(chat(10), 4)).toBe(15)
    })

    it('fires on the very next reply when the cadence is every reply', () => {
        const roles = chat(10)
        const watermark = watermarkAfterRollback(roles, 1)

        expect(decideAutoPass({ roles, watermark, runEvery: 1 }).run).toBe(false)
        expect(decideAutoPass({ roles: chat(11), watermark, runEvery: 1 }).run).toBe(true)
    })

    it('goes to the start of a chat with too few replies to walk back past', () => {
        expect(watermarkAfterRollback(chat(1), 10)).toBe(0)
        expect(watermarkAfterRollback([], 4)).toBe(0)
    })
})


describe('what the next pass reads after a swipe rolled one back', () => {
    /** Which reply a message position sits at, 1-based, for readable failures. */
    const replyAt = (position: number) => Math.ceil(position / 2)

    it('re-reads every reply the rolled-back pass had covered', () => {
        // The scenario that found this. A pass ran after reply 20, reading from
        // watermark 32 — replies 17 to 20 — and wrote lore for all four. A
        // swipe rolled it back, deleting that lore. Restoring the watermark it
        // advanced is what puts those four replies back in front of the next
        // pass; walking back a cycle instead started at reply 18, and reply 17
        // was covered by no pass at all, ever.
        const restored = 32
        const next = chat(21)

        const decision = decideAutoPass({ roles: next, watermark: restored, runEvery: 4 })

        expect(decision.run).toBe(true)
        expect(replyAt(next.length - decision.lookback + 1)).toBe(17)
    })

    it('fires on the first reply after the swipe, not on the swiped reply', () => {
        // Swiping is something people do five times in a row looking for a
        // reply they like. A pass on each would write lore for alternatives
        // about to be discarded — which is why the legacy's denylist excludes
        // swipes, and why the caller skips the pass on one. The decision here
        // would say yes; the generation type is what holds it.
        const restored = 32
        expect(decideAutoPass({ roles: chat(20), watermark: restored, runEvery: 4 }).run).toBe(true)
    })

    it('walks back a cycle when the snapshot recorded no watermark', () => {
        // The fallback, for snapshots written before the watermark was stored.
        // Weaker on purpose: it cannot know what the pass covered, so it
        // guesses a cycle and the next reply fires.
        const roles = chat(20)
        const fallback = watermarkAfterRollback(roles, 4)

        expect(decideAutoPass({ roles, watermark: fallback, runEvery: 4 }).run).toBe(false)
        expect(decideAutoPass({ roles: chat(21), watermark: fallback, runEvery: 4 }).run).toBe(true)
    })
})

describe('the automatic pass’s window (72b)', () => {
    const roles = ['user', 'assistant', 'user', 'assistant', 'assistant']
    it('reads since the last run, since the last user message, or a fixed count, as the mode says', () => {
        expect(autoPassLookback(roles, 'since_last_run', 3, 10)).toBe(3)
        expect(autoPassLookback(roles, 'since_last_user', 3, 10)).toBe(3)
        expect(autoPassLookback(['user', 'assistant', 'user'], 'since_last_user', 1, 10)).toBe(1)
        expect(autoPassLookback(['assistant', 'assistant'], 'since_last_user', 1, 10)).toBe(0)
        expect(autoPassLookback(roles, 'fixed', 3, 10)).toBe(10)
        expect(autoPassLookback(roles, 'fixed', 3, 0)).toBe(0)
        expect(autoPassLookback(roles, 'fixed', 3, -4)).toBe(0)
    })
})
