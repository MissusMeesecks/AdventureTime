import { describe, expect, it } from 'vitest'

import {
    findHistoryIndexForChat,
    getCreatedBookNames,
    getSnapshotBookNames,
    isHistoryEntryForChat,
    trimHistoryForRollback,
    type LoreHistoryEntry,
} from './history.js'

/** Two campaigns open at once, newest first — the case scoping exists for. */
const HISTORY: LoreHistoryEntry[] = [
    { chatId: 'c2', campaignPrefix: 'Ashfell', label: 'ashfell-newest' },
    { chatId: 'c1', campaignPrefix: 'Vell', label: 'vell-newest' },
    { chatId: 'c2', campaignPrefix: 'Ashfell', label: 'ashfell-older' },
    { chatId: 'c1', campaignPrefix: 'Vell', label: 'vell-older' },
]

describe('scoping an undo to one chat', () => {
    it('finds the newest entry belonging to this chat', () => {
        expect(findHistoryIndexForChat(HISTORY, { chatId: 'c1' })).toBe(1)
        expect(findHistoryIndexForChat(HISTORY, { chatId: 'c2' })).toBe(0)
    })

    it('finds nothing for a chat with no history', () => {
        expect(findHistoryIndexForChat(HISTORY, { chatId: 'c9' })).toBe(-1)
    })

    it('keeps the other chat\'s history when one chat rolls back', () => {
        // The whole reason this is not a splice. Undoing one campaign's last
        // pass must not discard another campaign's newer one.
        const trimmed = trimHistoryForRollback(HISTORY, 1)
        expect(trimmed.map((entry) => entry.label)).toEqual(['ashfell-newest', 'ashfell-older', 'vell-older'])
    })

    it('drops everything newer for the same chat, not just the entry itself', () => {
        const trimmed = trimHistoryForRollback(HISTORY, 3)
        expect(trimmed.map((entry) => entry.label)).toEqual(['ashfell-newest', 'ashfell-older'])
    })

    it('leaves the history alone for an index that is not in it', () => {
        expect(trimHistoryForRollback(HISTORY, -1)).toEqual(HISTORY)
        expect(trimHistoryForRollback(HISTORY, 99)).toEqual(HISTORY)
    })

    it('falls back to the campaign name only for an entry with no chat id', () => {
        expect(isHistoryEntryForChat({ campaignPrefix: 'Vell' }, { campaignPrefix: 'vell' })).toBe(true)
        // Not a second chance: an entry whose chat id simply did not match is
        // not then rescued by its prefix.
        expect(isHistoryEntryForChat({ chatId: 'c1', campaignPrefix: 'Vell' }, { chatId: 'c2', campaignPrefix: 'Vell' }))
            .toBe(false)
    })
})

describe('deciding which books an undo may delete', () => {
    it('deletes a book the pass created', () => {
        expect(
            getCreatedBookNames({
                snapshot: { createdBookNames: ['Vell_NPCs'], campaignBooks: ['Vell'] },
                currentNames: ['Vell', 'Vell_NPCs'],
                prefix: 'Vell',
            }),
        ).toEqual(['Vell_NPCs'])
    })

    it('never deletes a book that was already there', () => {
        // The guarantee. A book present in the pre-pass baseline is not this
        // pass's to remove, whatever its name looks like.
        expect(
            getCreatedBookNames({
                snapshot: { createdBookNames: ['Vell_NPCs'], campaignBooks: ['Vell_NPCs'] },
                currentNames: ['Vell_NPCs'],
                prefix: 'Vell',
            }),
        ).toEqual([])
    })

    it('never deletes a book outside the campaign, even if the pass made it', () => {
        expect(
            getCreatedBookNames({
                snapshot: { createdBookNames: ['Someone_Elses_Book'] },
                currentNames: ['Someone_Elses_Book'],
                prefix: 'Vell',
            }),
        ).toEqual([])
    })

    it('counts an owned-but-unread book as pre-existing', () => {
        // The legacy's own comment: ownership is part of the baseline so a book
        // that happened not to be read this pass is never treated as created.
        expect(
            getCreatedBookNames({
                snapshot: { campaignBooks: ['Vell_LOC'] },
                currentNames: ['Vell_LOC'],
                currentPassLog: [{ record: ['Vell_LOC::2'] }],
                prefix: 'Vell',
            }),
        ).toEqual([])
    })

    it('falls back to the pass log when a snapshot did not say what it made', () => {
        expect(
            getCreatedBookNames({
                snapshot: { passLog: [{ record: ['Vell::1'] }], campaignBooks: ['Vell'] },
                currentNames: ['Vell', 'Vell_NPCs'],
                currentPassLog: [{ record: ['Vell_NPCs::4'] }, { record: ['Vell::1'] }],
                prefix: 'Vell',
            }),
        ).toEqual(['Vell_NPCs'])
    })
})

describe('the names a snapshot speaks for', () => {
    it('unions the captured, the named and the owned', () => {
        expect(
            getSnapshotBookNames({
                bookSnapshots: { A: {} },
                campaignBookNames: ['A', 'B'],
                campaignBooks: ['C'],
            }).sort(),
        ).toEqual(['A', 'B', 'C'])
    })

    it('is empty for a snapshot that recorded nothing', () => {
        expect(getSnapshotBookNames({})).toEqual([])
    })
})
