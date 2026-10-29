import { describe, expect, it } from 'vitest'

import {
    indexAt,
    LIVE,
    describePosition,
    findByMessage,
    firstPastIndex,
    readPosition,
    stepHistory,
    type HistoryEntry,
} from './history-view.js'

/** Newest first, as the store keeps them. */
const history = (n: number): HistoryEntry[] =>
    Array.from({ length: n }, (_, i) => ({
        messageId: `m${n - i}`,
        memo: `state ${n - i}`,
        at: `2026-09-02T0${i}:00:00.000Z`,
    }))

/** The live memo in the normal case: the state the newest snapshot recorded. */
const liveFor = (snapshots: readonly HistoryEntry[]): string => snapshots[0]?.memo ?? ''

const step = (snapshots: HistoryEntry[], index: number, direction: 'back' | 'forward', live?: string) =>
    stepHistory(snapshots, index, direction, live ?? liveFor(snapshots))

const posn = (snapshots: HistoryEntry[], index: number, live?: string) =>
    readPosition(snapshots, index, live ?? liveFor(snapshots))

describe('stepping through the tracker\'s past', () => {
    it('skips the newest snapshot, which is the state already on screen', () => {
        // "Hitting the back button once seems the same as leaving it as-is" —
        // it was. `snapshots[0]` is the memo after the newest tracked turn,
        // which is the live memo, so stepping onto it changed nothing.
        expect(step(history(5), LIVE, 'back')).toBe(1)
    })

    it('keeps walking backwards', () => {
        expect(step(history(5), 1, 'back')).toBe(2)
        expect(step(history(5), 2, 'back')).toBe(3)
    })

    it('stops at the oldest snapshot it has', () => {
        // The store is capped, so there is always an oldest. Running off the
        // end would leave the cursor pointing at nothing.
        expect(step(history(3), 2, 'back')).toBe(2)
    })

    it('steps forward towards the present', () => {
        expect(step(history(5), 3, 'forward')).toBe(2)
    })

    it('returns to live from the first past state', () => {
        expect(step(history(5), 1, 'forward')).toBe(LIVE)
    })

    it('stays live when there is nothing stored', () => {
        expect(step([], LIVE, 'back')).toBe(LIVE)
        expect(step([], LIVE, 'forward')).toBe(LIVE)
    })

    it('stays live when the only snapshot is the live state', () => {
        // One tracked turn means there is no *past* to step to.
        expect(step(history(1), LIVE, 'back')).toBe(LIVE)
    })
})

describe('reading where the cursor is', () => {
    it('says it is live, with nothing to show, and that it can go back', () => {
        const live = posn(history(5), LIVE)
        expect(live).toMatchObject({ index: LIVE, entry: null, canGoBack: true, canGoForward: false })
    })

    it('hands back the snapshot being viewed', () => {
        expect(posn(history(5), 2).entry?.memo).toBe('state 3')
    })

    it('cannot go back from the oldest', () => {
        expect(posn(history(3), 2).canGoBack).toBe(false)
    })

    it('cannot go back at all with no history', () => {
        expect(posn([], LIVE)).toMatchObject({ index: LIVE, canGoBack: false, entry: null })
    })

    it('cannot go back when the only snapshot is the live state', () => {
        expect(posn(history(1), LIVE).canGoBack).toBe(false)
    })

    it('clamps an index the history has since outgrown', () => {
        // Every tracked turn pushes an entry in and the store is capped, so an
        // index read a minute ago can point past the end.
        expect(posn(history(3), 9).index).toBe(2)
    })

    it('never lands on the newest snapshot, even asked to', () => {
        expect(posn(history(5), 0).index).toBe(1)
    })

    it('treats a chat that lost its history as live', () => {
        expect(posn([], 4).index).toBe(LIVE)
    })
})

describe('saying which state is on screen', () => {
    const clock = () => '2:31 PM'

    it('says live when it is live', () => {
        expect(describePosition(posn(history(5), LIVE), clock)).toBe('Live')
    })

    it('counts in turns, because that is how deleted messages are counted', () => {
        // One back is one turn before now, not the state now.
        expect(describePosition(posn(history(5), 1), clock)).toBe('1 turn back · 2:31 PM')
        expect(describePosition(posn(history(5), 3), clock)).toBe('3 turns back · 2:31 PM')
    })

    it('names the message, which is the part that matches exactly', () => {
        // A pass runs after the reply it reads and takes a while, so its clock
        // time is routinely a minute past the message's own.
        const snapshots: HistoryEntry[] = [
            { messageId: 'm16', memo: 'now', at: '', messageNumber: 16 },
            { messageId: 'm15', memo: 'x', at: '', messageNumber: 15 },
        ]
        expect(describePosition(posn(snapshots, 1), clock)).toBe('#15 · 1 turn back')
    })

    it('shows a number of zero, which is a real message', () => {
        const snapshots: HistoryEntry[] = [
            { messageId: 'm1', memo: 'now', at: '', messageNumber: 1 },
            { messageId: 'm0', memo: 'x', at: '', messageNumber: 0 },
        ]
        expect(describePosition(posn(snapshots, 1), clock)).toBe('#0 · 1 turn back')
    })

    it('manages without a message number, for states recorded before it existed', () => {
        const snapshots: HistoryEntry[] = [
            { messageId: 'm2', memo: 'now', at: '' },
            { messageId: 'm1', memo: 'x', at: '' },
        ]
        expect(describePosition(posn(snapshots, 1), clock)).toBe('1 turn back')
    })
})

describe('finding the snapshot a restore names', () => {
    it('finds it by message', () => {
        expect(findByMessage(history(5), 'm3')?.memo).toBe('state 3')
    })

    it('is nothing for a message it does not hold', () => {
        // The entry has aged off the end of the capped store, or the chat
        // changed under the panel. Overwriting the live memo with a guess is
        // the one thing a restore must not do.
        expect(findByMessage(history(5), 'm99')).toBeNull()
        expect(findByMessage(history(5), '')).toBeNull()
    })
})


describe('deciding which snapshot is the first one in the past', () => {
    // 10a skipped the newest snapshot by position, on the assumption that it
    // is always the live memo. It usually is — but that is a claim about the
    // relationship between two separate stores, not a fact, and when it was
    // false the skip ate a real state: the walk jumped from 31 straight past
    // 29 to 27.

    it('skips the newest when it is the state already on screen', () => {
        const snapshots = history(5)
        expect(firstPastIndex(snapshots, 'state 5')).toBe(1)
    })

    it('skips nothing when the newest snapshot is not what is live', () => {
        // A pass for the newest turn that has not been recorded, a hand-edited
        // memo, a restore — all leave the newest snapshot genuinely in the past.
        const snapshots = history(5)
        expect(firstPastIndex(snapshots, 'something else entirely')).toBe(0)
    })

    it('shows the state the skip used to eat', () => {
        const snapshots = history(5)
        const landed = step(snapshots, LIVE, 'back', 'something else entirely')

        expect(landed).toBe(0)
        expect(posn(snapshots, landed, 'something else entirely').entry?.memo).toBe('state 5')
    })

    it('calls the first press one turn back either way', () => {
        // Whether the newest snapshot was skipped is invisible to the user, so
        // the count must not give it away by reading 0 sometimes and 1 others.
        const snapshots = history(5)
        expect(posn(snapshots, step(snapshots, LIVE, 'back'), 'state 5').turnsBack).toBe(1)
        expect(posn(snapshots, step(snapshots, LIVE, 'back', 'other'), 'other').turnsBack).toBe(1)
    })

    it('skips only the newest, never a run of identical states', () => {
        // A pass that changed nothing records a memo identical to the one
        // before it. Those are real turns and hiding them would lose them.
        const snapshots: HistoryEntry[] = [
            { messageId: 'm3', memo: 'same', at: '' },
            { messageId: 'm2', memo: 'same', at: '' },
            { messageId: 'm1', memo: 'older', at: '' },
        ]
        expect(firstPastIndex(snapshots, 'same')).toBe(1)
        expect(posn(snapshots, 1, 'same').entry?.messageId).toBe('m2')
    })

    it('has nothing to step to when the only snapshot is the live one', () => {
        expect(step(history(1), LIVE, 'back', 'state 1')).toBe(LIVE)
    })

    it('has one thing to step to when that single snapshot is not live', () => {
        expect(step(history(1), LIVE, 'back', 'other')).toBe(0)
    })

    it('is nothing to decide with no snapshots at all', () => {
        expect(firstPastIndex([], 'anything')).toBe(0)
        expect(posn([], LIVE, 'anything').canGoBack).toBe(false)
    })
})

describe('indexAt (47e-bis)', () => {
    const list = [
        { messageId: 'm3', memo: 'c', at: '2026-10-10T20:30:00Z' },
        { messageId: 'm2', memo: 'b', at: '2026-10-10T20:20:00Z' },
        { messageId: 'm1', memo: 'a', at: '2026-10-10T20:10:00Z' },
    ]
    it('finds the state stamped at the moment, or the newest before it', () => {
        expect(indexAt(list, '2026-10-10T20:20:00Z')).toBe(1)
        expect(indexAt(list, '2026-10-10T20:25:00Z')).toBe(1)
        expect(indexAt(list, '2026-10-10T21:00:00Z')).toBe(0)
        expect(indexAt(list, '2026-10-10T20:10:00Z')).toBe(2)
    })
    it('answers null for a moment before every kept state, or one it cannot read', () => {
        expect(indexAt(list, '2026-10-10T20:00:00Z')).toBeNull()
        expect(indexAt(list, 'yesterday')).toBeNull()
        expect(indexAt([], '2026-10-10T20:20:00Z')).toBeNull()
    })
})
