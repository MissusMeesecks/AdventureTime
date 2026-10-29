import { describe, expect, it, vi } from 'vitest'

import type { Quest } from '../tracker/quests.js'
import {
    foldArchivedQuests,
    MAX_ARCHIVED_QUESTS,
    QuestArchiveStore,
    questArchivePath,
    type ArchivedQuest,
    type QuestArchiveStorage,
} from './quest-archive.js'

function quest(over: Partial<Quest> = {}): Quest {
    return {
        id: 'q1',
        title: 'The Rat Cellar',
        status: 'completed',
        giver_name: 'Farmer Hemwick',
        giver_location: 'Crestwood Mill',
        accepted_time: '08:00 AM, Day 1',
        deadline_time: null,
        objectives: [],
        rewards: [],
        ...over,
    }
}

/** Keyed by user as well as path, because `spindle.userStorage` is. */
function fakeStorage(seed: Record<string, unknown> = {}) {
    const files = new Map<string, unknown>(Object.entries(seed))
    const at = (path: string, userId?: string): string => `${userId ?? '@self'}:${path}`

    const storage: QuestArchiveStorage = {
        async getJson<T>(path: string, options?: { fallback?: T; userId?: string }): Promise<T> {
            const key = at(path, options?.userId)
            return (files.has(key) ? files.get(key) : options?.fallback) as T
        },
        async setJson(path: string, value: unknown, options?: { userId?: string }): Promise<void> {
            files.set(at(path, options?.userId), JSON.parse(JSON.stringify(value)))
        },
    }
    return { storage, files }
}

describe('where the archive lives', () => {
    it('sits beside the memo, in the chat directory', () => {
        expect(questArchivePath('c1')).toBe('chats/c1/quest-archive.json')
    })

    it('refuses a chat id that could climb out of it', () => {
        // Same guard as the memo, and for the same reason: a rewritten id would
        // read and write the wrong chat rather than fail.
        expect(() => questArchivePath('../../settings')).toThrow(/unsafe chat id/)
    })
})

describe('folding a turn into the archive', () => {
    it('keeps what is already there and puts the new ones first', () => {
        const existing: ArchivedQuest[] = [{ quest: quest({ id: 'old', title: 'Old' }), at: '2026-01-01T00:00:00.000Z' }]
        const folded = foldArchivedQuests(existing, [quest({ id: 'new', title: 'New' })], { at: 'now' })

        expect(folded.map((e) => e.quest.title)).toEqual(['New', 'Old'])
        expect(folded[0]!.at).toBe('now')
    })

    it('replaces what the pass it re-runs had concluded', () => {
        // A swipe re-runs the pass for the same message. The memo rolls back to
        // `previous`; the archive rolls back by message id. Without this a quest
        // completed on a swipe the user rejected would stay archived for good
        // while the memo showed it active again — the same quest in two places,
        // disagreeing.
        const first = foldArchivedQuests([], [quest({ id: 'a', title: 'Rejected ending' })], { messageId: 'm7' })
        const second = foldArchivedQuests(first, [quest({ id: 'b', title: 'Kept ending' })], { messageId: 'm7' })

        expect(second.map((e) => e.quest.title)).toEqual(['Kept ending'])
    })

    it('leaves earlier messages alone when one is re-tracked', () => {
        const first = foldArchivedQuests([], [quest({ id: 'a', title: 'Earlier' })], { messageId: 'm6' })
        const second = foldArchivedQuests(first, [quest({ id: 'b', title: 'Later' })], { messageId: 'm7' })
        const retrack = foldArchivedQuests(second, [quest({ id: 'c', title: 'Redone' })], { messageId: 'm7' })

        expect(retrack.map((e) => e.quest.title)).toEqual(['Redone', 'Earlier'])
    })

    it('un-archives when the re-run concludes nothing', () => {
        // The swipe that takes the quest back out of "completed" archives
        // nothing at all, and the entry from the reply it replaced has to go
        // with it.
        const first = foldArchivedQuests([], [quest({ id: 'a' })], { messageId: 'm7' })
        expect(foldArchivedQuests(first, [], { messageId: 'm7' })).toEqual([])
    })

    it('does not let a manual run sweep away every other manual run', () => {
        // A pass the user started names no message. Treating "no message" as a
        // key would make each manual run delete the last one's work.
        const first = foldArchivedQuests([], [quest({ id: 'a', title: 'First' })])
        const second = foldArchivedQuests(first, [quest({ id: 'b', title: 'Second' })])

        expect(second.map((e) => e.quest.title)).toEqual(['Second', 'First'])
    })

    it('keeps one entry per quest, the newest', () => {
        const first = foldArchivedQuests([], [quest({ id: 'a', status: 'completed' })], { at: 'then' })
        const second = foldArchivedQuests(first, [quest({ id: 'a', status: 'failed' })], { at: 'now' })

        expect(second).toHaveLength(1)
        expect(second[0]!.quest.status).toBe('failed')
        expect(second[0]!.at).toBe('now')
    })

    it('matches on the title when the model wrote no id', () => {
        // `parseQuestsFromText` invents `quest_<clock>_<index>` for a quest with
        // no ID line, so the same quest parsed twice has two ids. Keying on
        // those would archive one quest once per pass, forever.
        const first = foldArchivedQuests([], [quest({ id: 'quest_1756000000000_0' })], { at: 'then' })
        const second = foldArchivedQuests(first, [quest({ id: 'quest_1756000000999_3' })], { at: 'now' })

        expect(second).toHaveLength(1)
        expect(second[0]!.at).toBe('now')
    })

    it('drops a quest with no title rather than keeping a nameless card', () => {
        expect(foldArchivedQuests([], [quest({ title: '   ' })])).toEqual([])
    })

    it('caps the list, dropping the oldest', () => {
        let archive: ArchivedQuest[] = []
        for (let i = 0; i < MAX_ARCHIVED_QUESTS + 5; i++) {
            archive = foldArchivedQuests(archive, [quest({ id: `q${i}`, title: `Quest ${i}` })])
        }

        expect(archive).toHaveLength(MAX_ARCHIVED_QUESTS)
        expect(archive[0]!.quest.title).toBe(`Quest ${MAX_ARCHIVED_QUESTS + 4}`)
        expect(archive.at(-1)!.quest.title).toBe('Quest 5')
    })
})

describe('the archive store', () => {
    it('starts empty for a chat that has finished nothing', async () => {
        const { storage } = fakeStorage()
        expect((await new QuestArchiveStore(storage).load('c1')).quests).toEqual([])
    })

    it('records a turn and reads it back', async () => {
        const { storage } = fakeStorage()
        const store = new QuestArchiveStore(storage)

        await store.record('c1', [quest({ title: 'The Rat Cellar' })], 'u1', { messageId: 'm2' })
        const record = await store.load('c1', 'u1')

        expect(record.quests.map((e) => e.quest.title)).toEqual(['The Rat Cellar'])
        expect(record.quests[0]!.messageId).toBe('m2')
    })

    it('keeps chats apart', async () => {
        const { storage } = fakeStorage()
        const store = new QuestArchiveStore(storage)

        await store.record('c1', [quest({ title: 'Campaign one' })])
        expect((await store.load('c2')).quests).toEqual([])
    })

    it('keeps users apart', async () => {
        const { storage } = fakeStorage()
        const store = new QuestArchiveStore(storage)

        await store.record('c1', [quest({ title: 'Theirs' })], 'u1')
        expect((await store.load('c1', 'u2')).quests).toEqual([])
    })

    it('survives to disk', async () => {
        const { storage } = fakeStorage()
        await new QuestArchiveStore(storage).record('c1', [quest({ title: 'Kept' })])

        // A second store over the same storage is the next session.
        const reloaded = await new QuestArchiveStore(storage).load('c1')
        expect(reloaded.quests.map((e) => e.quest.title)).toEqual(['Kept'])
    })

    it('does not write when a pass archived nothing new', async () => {
        // Most turns finish no quest. Rewriting the file on each of them is
        // work for nothing, and every write is a chance to lose the file.
        const { storage } = fakeStorage()
        const setJson = vi.spyOn(storage, 'setJson')
        const store = new QuestArchiveStore(storage)

        await store.record('c1', [quest()], undefined, { messageId: 'm1' })
        expect(setJson).toHaveBeenCalledTimes(1)

        await store.record('c1', [], undefined, { messageId: 'm2' })
        await store.record('c1', [], undefined, { messageId: 'm3' })
        expect(setJson).toHaveBeenCalledTimes(1)
    })

    it('clears', async () => {
        const { storage } = fakeStorage()
        const store = new QuestArchiveStore(storage)
        await store.record('c1', [quest()])

        expect((await store.clear('c1')).quests).toEqual([])
        expect((await store.load('c1')).quests).toEqual([])
    })

    it('reads an unreadable file as an empty archive', async () => {
        // A first run and a corrupted file look the same from here, and neither
        // is worth failing a panel draw over.
        const storage: QuestArchiveStorage = {
            async getJson(): Promise<never> {
                throw new Error('disk gone')
            },
            async setJson(): Promise<void> {},
        }
        expect((await new QuestArchiveStore(storage).load('c1')).quests).toEqual([])
    })

    it('drops entries a hand-edited file mangled, keeping the rest', async () => {
        const { storage } = fakeStorage({
            '@self:chats/c1/quest-archive.json': {
                version: 1,
                updatedAt: '2026-01-01T00:00:00.000Z',
                quests: [
                    { quest: quest({ title: 'Good' }), at: '2026-01-01T00:00:00.000Z' },
                    { quest: { title: '' }, at: 'x' },
                    { at: 'no quest at all' },
                    null,
                    'not an object',
                ],
            },
        })

        const record = await new QuestArchiveStore(storage).load('c1')
        expect(record.quests.map((e) => e.quest.title)).toEqual(['Good'])
    })

    it('rejects an unsafe chat id rather than answering with an empty archive', async () => {
        const { storage } = fakeStorage()
        await expect(new QuestArchiveStore(storage).load('../../settings')).rejects.toThrow(/unsafe chat id/)
    })

    it('shares one load between concurrent readers', async () => {
        const { storage } = fakeStorage()
        const getJson = vi.spyOn(storage, 'getJson')
        const store = new QuestArchiveStore(storage)

        await Promise.all([store.load('c1'), store.load('c1'), store.load('c1')])
        expect(getJson).toHaveBeenCalledTimes(1)
    })
})
