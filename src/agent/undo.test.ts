import { describe, expect, it } from 'vitest'

import {
    captureSnapshot,
    describeUndo,
    planUndo,
    type LiveBook,
    type LorePassSnapshot,
} from './undo.js'

const entry = (uid: string, over: Partial<{ key: string[]; content: string; comment: string }> = {}) => ({
    uid, key: over.key ?? ['k'], content: over.content ?? 'before', comment: over.comment ?? 'Title',
})

const liveEntry = (id: string, uid: string, over: Partial<{ key: string[]; content: string; comment: string }> = {}) => ({
    id, uid, key: over.key ?? ['k'], content: over.content ?? 'before', comment: over.comment ?? 'Title',
})

const snapshot = (over: Partial<LorePassSnapshot> = {}): LorePassSnapshot => ({
    chatId: 'chat-1',
    at: '2026-09-01T00:00:00.000Z',
    prefix: 'Vell',
    books: [{ name: 'Vell_NPC', entries: [entry('1')] }],
    ownedBooks: ['Vell_NPC'],
    createdBooks: [],
    ...over,
})

const live = (...books: LiveBook[]) => books

describe('planning an undo', () => {
    it('restores an entry the pass changed', () => {
        const plan = planUndo(
            snapshot(),
            live({ id: 'b1', name: 'Vell_NPC', entries: [liveEntry('e1', '1', { content: 'after' })] }),
        )
        expect(plan.restore).toEqual([{ entryId: 'e1', key: ['k'], content: 'before', comment: 'Title' }])
        expect(plan.remove).toEqual([])
        expect(plan.recreate).toEqual([])
    })

    it('leaves an untouched entry alone', () => {
        // An undo that rewrites every entry it can see would churn the whole
        // campaign and make the diff useless for reading afterwards.
        const plan = planUndo(
            snapshot(),
            live({ id: 'b1', name: 'Vell_NPC', entries: [liveEntry('e1', '1')] }),
        )
        expect(plan.restore).toEqual([])
        expect(describeUndo(plan)).toBe('Nothing to undo — the books already match.')
    })

    // `rename` changes the title, or the keys, or both, and leaves content
    // alone. Checked one at a time: a test that changes both passes even if
    // only one of them is being compared.
    it('notices a changed title on its own', () => {
        const plan = planUndo(
            snapshot(),
            live({ id: 'b1', name: 'Vell_NPC', entries: [liveEntry('e1', '1', { comment: 'Renamed' })] }),
        )
        expect(plan.restore).toEqual([{ entryId: 'e1', key: ['k'], content: 'before', comment: 'Title' }])
    })

    it('notices changed keys on their own', () => {
        const plan = planUndo(
            snapshot(),
            live({ id: 'b1', name: 'Vell_NPC', entries: [liveEntry('e1', '1', { key: ['k', 'extra'] })] }),
        )
        expect(plan.restore).toEqual([{ entryId: 'e1', key: ['k'], content: 'before', comment: 'Title' }])
    })

    it('notices keys that changed without changing in number', () => {
        // Comparing lengths alone would call these equal.
        const plan = planUndo(
            snapshot(),
            live({ id: 'b1', name: 'Vell_NPC', entries: [liveEntry('e1', '1', { key: ['different'] })] }),
        )
        expect(plan.restore).toHaveLength(1)
    })

    it('puts back an entry the pass deleted', () => {
        // consolidate merges entries and deletes the rest. One live pass
        // reported "1 merge" and "1 deleted".
        const plan = planUndo(
            snapshot(),
            live({ id: 'b1', name: 'Vell_NPC', entries: [] }),
        )
        expect(plan.recreate).toEqual([
            { bookId: 'b1', bookName: 'Vell_NPC', entry: entry('1') },
        ])
    })

    it('removes an entry the pass added to a book that already existed', () => {
        const plan = planUndo(
            snapshot(),
            live({ id: 'b1', name: 'Vell_NPC', entries: [liveEntry('e1', '1'), liveEntry('e2', '2')] }),
        )
        expect(plan.remove).toEqual([{ entryId: 'e2', address: 'Vell_NPC::2' }])
    })

    it('removes only the entries the pass itself created, once the snapshot says which (45c-quinquies)', () => {
        // The architect's root entry and the updater's chronicles land in a
        // captured book after the snapshot; they are not the pass's to remove.
        const plan = planUndo(
            snapshot({ createdEntries: ['Vell_NPC::2'] }),
            live({ id: 'b1', name: 'Vell_NPC', entries: [liveEntry('e1', '1'), liveEntry('e2', '2'), liveEntry('e3', '3', { content: 'The architect wrote this.' })] }),
        )
        expect(plan.remove).toEqual([{ entryId: 'e2', address: 'Vell_NPC::2' }])
        expect(plan.problems).toEqual([])
    })

    it('keeps an entry the pass created once it holds a map drawn since, and says so', () => {
        const plan = planUndo(
            snapshot({ createdEntries: ['Vell_NPC::2'] }),
            live({ id: 'b1', name: 'Vell_NPC', entries: [liveEntry('e1', '1'), liveEntry('e2', '2', { content: 'Root Cellar.\n\n[MAP]\n{"kind":"DUNGEON"}\n[/MAP]' })] }),
        )
        expect(plan.remove).toEqual([])
        expect(plan.problems).toEqual(['"Vell_NPC::2" was kept: it holds a map drawn since the pass'])
        // The old rule, on a snapshot that does not say what the pass created, keeps a mapped entry too.
        const old = planUndo(snapshot(), live({ id: 'b1', name: 'Vell_NPC', entries: [liveEntry('e1', '1'), liveEntry('e2', '2', { content: '[MAP]\n{}\n[/MAP]' }), liveEntry('e3', '3')] }))
        expect(old.remove).toEqual([{ entryId: 'e3', address: 'Vell_NPC::3' }])
        expect(old.problems).toHaveLength(1)
    })

    it('carries a map drawn or changed since the pass into a restored entry', () => {
        const drawn = planUndo(
            snapshot(),
            live({ id: 'b1', name: 'Vell_NPC', entries: [liveEntry('e1', '1', { content: 'after\n\n[MAP]\n{"a":1}\n[/MAP]' })] }),
        )
        expect(drawn.restore).toEqual([{ entryId: 'e1', key: ['k'], content: 'before\n\n[MAP]\n{"a":1}\n[/MAP]', comment: 'Title' }])
        const changed = planUndo(
            snapshot({ books: [{ name: 'Vell_NPC', entries: [entry('1', { content: 'before\n[MAP]\n{"a":1}\n[/MAP]' })] }] }),
            live({ id: 'b1', name: 'Vell_NPC', entries: [liveEntry('e1', '1', { content: 'after\n[MAP]\n{"a":2}\n[/MAP]' })] }),
        )
        expect(changed.restore[0]!.content).toBe('before\n[MAP]\n{"a":2}\n[/MAP]')
        // Prose unchanged and only the map moved: nothing to restore.
        const mapOnly = planUndo(
            snapshot({ books: [{ name: 'Vell_NPC', entries: [entry('1', { content: 'same\n[MAP]\n{"a":1}\n[/MAP]' })] }] }),
            live({ id: 'b1', name: 'Vell_NPC', entries: [liveEntry('e1', '1', { content: 'same\n[MAP]\n{"a":2}\n[/MAP]' })] }),
        )
        expect(mapOnly.restore).toEqual([])
    })

    it('deletes a book the pass created, and only such a book', () => {
        // 9b's rule, and the one action nothing can walk back. A book that
        // merely matches the campaign's naming is not ours to delete.
        const plan = planUndo(
            snapshot({ createdBooks: ['Vell_Events'] }),
            live(
                { id: 'b1', name: 'Vell_NPC', entries: [liveEntry('e1', '1')] },
                { id: 'b2', name: 'Vell_Events', entries: [liveEntry('e2', '1')] },
                { id: 'b3', name: 'Vell_Loot', entries: [liveEntry('e3', '1')] },
            ),
        )
        expect(plan.deleteBooks).toEqual([{ id: 'b2', name: 'Vell_Events' }])
    })

    it('says nothing about a book nobody snapshotted', () => {
        // A hand-written world bible, or another campaign's book. The plan only
        // ever speaks about books it captured.
        const plan = planUndo(
            snapshot(),
            live(
                { id: 'b1', name: 'Vell_NPC', entries: [liveEntry('e1', '1')] },
                { id: 'b9', name: 'My World Bible', entries: [liveEntry('e9', '1', { content: 'theirs' })] },
            ),
        )
        expect(plan.restore).toEqual([])
        expect(plan.remove).toEqual([])
        expect(plan.deleteBooks).toEqual([])
    })

    it('restores the ownership list as it was before the pass', () => {
        // The ownership list is part of the baseline (9b): a book we own but
        // did not read this pass must not look newly created next time.
        const plan = planUndo(snapshot({ ownedBooks: ['Vell_NPC'], createdBooks: ['Vell_Events'] }), live())
        expect(plan.ownedBooks).toEqual(['Vell_NPC'])
    })

    it('says so when a snapshotted book has since vanished', () => {
        const plan = planUndo(snapshot(), live())
        expect(plan.problems).toEqual([
            '"Vell_NPC" no longer exists, so its entries were not restored',
        ])
        expect(plan.recreate).toEqual([])
    })

    it('takes a book already deleted as work already done', () => {
        // The end state an undo wants is the state it is already in.
        const plan = planUndo(
            snapshot({ books: [], createdBooks: ['Vell_Events'] }),
            live(),
        )
        expect(plan.deleteBooks).toEqual([])
        expect(plan.problems).toEqual([])
    })

    it('refuses to delete a book that was also captured', () => {
        // Contradictory bookkeeping: the capture happens before the pass, so a
        // created book has nothing to capture. Deleting on the strength of one
        // half would destroy entries the other half says predate the pass.
        const plan = planUndo(
            snapshot({ createdBooks: ['Vell_NPC'] }),
            live({ id: 'b1', name: 'Vell_NPC', entries: [liveEntry('e1', '1')] }),
        )
        expect(plan.deleteBooks).toEqual([])
        expect(plan.problems[0]).toContain('both captured and created')
    })
})

describe('describing an undo', () => {
    it('counts each kind of change', () => {
        const plan = planUndo(
            snapshot({ books: [{ name: 'Vell_NPC', entries: [entry('1'), entry('2')] }], createdBooks: ['Vell_Events'] }),
            live(
                { id: 'b1', name: 'Vell_NPC', entries: [liveEntry('e1', '1', { content: 'after' }), liveEntry('e3', '3')] },
                { id: 'b2', name: 'Vell_Events', entries: [] },
            ),
        )
        expect(describeUndo(plan)).toBe(
            'Undone: 1 entry restored, 1 entry put back, 1 entry removed, 1 book deleted.',
        )
    })

    it('says how many it could not undo', () => {
        const plan = planUndo(snapshot(), live())
        expect(describeUndo(plan)).toContain('1 could not be undone.')
    })
})

describe('capturing the snapshot a pass can be undone from', () => {
    /** A store whose books read slowly, so sequential and parallel differ. */
    function slowStore(books: Array<{ id: string; name: string }>, options: { failOn?: string; delayMs?: number } = {}) {
        let inFlight = 0
        let peakInFlight = 0
        const store = {
            listBooks: async () => books,
            listEntries: async (bookId: string) => {
                inFlight += 1
                peakInFlight = Math.max(peakInFlight, inFlight)
                await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 5))
                inFlight -= 1
                if (bookId === options.failOn) throw new Error('this book will not read')
                return [liveEntry(`${bookId}-e`, `${bookId}-uid`)]
            },
            createEntry: async () => undefined,
            updateEntry: async () => undefined,
            deleteEntry: async () => undefined,
        }
        return { store, peak: () => peakInFlight }
    }

    const options = {
        chatId: 'chat-1',
        prefix: 'Vell',
        ownedBooks: ['Vell_NPC'],
        isOwn: (name: string) => name.startsWith('Vell_'),
    }

    it('captures only the books the campaign owns', async () => {
        const { store } = slowStore([
            { id: 'a', name: 'Vell_NPC' },
            { id: 'b', name: 'SomeoneElse_World' },
        ])
        const snap = await captureSnapshot(store, options)
        expect(snap.books.map((b) => b.name)).toEqual(['Vell_NPC'])
    })

    it('reads the books at once rather than one after another', async () => {
        // The point of the change: these are independent host round trips and
        // the model waits for all of them before its first turn.
        const { store, peak } = slowStore([
            { id: 'a', name: 'Vell_NPC' },
            { id: 'b', name: 'Vell_Events' },
            { id: 'c', name: 'Vell_Places' },
        ])
        await captureSnapshot(store, options)
        expect(peak()).toBe(3)
    })

    it('keeps the books in a stable order however the reads finish', async () => {
        const { store } = slowStore([
            { id: 'a', name: 'Vell_NPC' },
            { id: 'b', name: 'Vell_Events' },
            { id: 'c', name: 'Vell_Places' },
        ])
        const snap = await captureSnapshot(store, options)
        expect(snap.books.map((b) => b.name)).toEqual(['Vell_NPC', 'Vell_Events', 'Vell_Places'])
    })

    it('drops only the book that will not read, and keeps the rest', async () => {
        // A rejected Promise.all would lose the whole snapshot to one bad book,
        // which would leave the pass with nothing to be undone from.
        const { store } = slowStore(
            [
                { id: 'a', name: 'Vell_NPC' },
                { id: 'bad', name: 'Vell_Broken' },
                { id: 'c', name: 'Vell_Places' },
            ],
            { failOn: 'bad' },
        )
        const snap = await captureSnapshot(store, options)
        expect(snap.books.map((b) => b.name)).toEqual(['Vell_NPC', 'Vell_Places'])
    })
})
