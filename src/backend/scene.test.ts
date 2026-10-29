import { describe, expect, it } from 'vitest'

import { createScene, type SceneDeps } from './scene.js'

type Entry = { id: string; uid: string; content: string; comment: string }

function harness(over: Partial<SceneDeps> & { messages?: SceneDeps['messages']; entryMap?: Record<string, Entry[]>; bookList?: Array<{ id: string; name: string }>; owned?: string[]; portraitMap?: Record<string, string>; window?: number } = {}) {
    const { entryMap, bookList, owned, portraitMap, window, ...rest } = over
    const calls: unknown[][] = []
    const log: string[] = []
    const books = bookList ?? [{ id: 'b1', name: 'Vellmoor_NPC' }, { id: 'b2', name: 'Vellmoor_LOC' }, { id: 'b3', name: 'Shared Bestiary' }, { id: 'b4', name: 'Other_NPC' }]
    const entries: Record<string, Entry[]> = entryMap ?? {
        b1: [{ id: 'e1', uid: '1', comment: '[Major] Mother Sedge', content: '[CORE]\nKeeper.\n[/CORE]' }, { id: 'e2', uid: '2', comment: 'Loose Bill', content: 'A drunk.' }, { id: 'e3', uid: '3', comment: 'Thessaly Brook', content: 'The player, recorded by mistake.' }],
        b2: [{ id: 'e4', uid: '1', comment: 'Monastery :: Courtyard', content: 'A yard.\n[MAP]\nx\n[/MAP]' }, { id: 'e5', uid: '2', comment: 'Morrowfen', content: 'A port.' }],
        b3: [{ id: 'e6', uid: '1', comment: 'Loose Bill', content: 'Shared.' }],
        b4: [{ id: 'e7', uid: '1', comment: 'Loose Bill', content: 'Another campaign.' }],
    }
    let portraits: Record<string, string> = portraitMap ?? { 'Mother Sedge': 'https://host/sedge.png', '📍 Monastery :: Courtyard': 'https://host/yard.png', 'Thessaly Brook (the player)': 'https://host/t.png' }
    const deps: SceneDeps = {
        messages: async () => [{ role: 'assistant', content: 'The gate. (Location: Monastery Courtyard)' }, { role: 'user', content: 'I look for Sedge.' }, { role: 'assistant', content: 'Old Sedge nods; Bill snores; Thessaly Brook watches. <choices><button>Wake Thessaly</button></choices>' }],
        memos: { load: async () => ({ memo: '[CHARACTER]\nName: Thessaly Brook\n[/CHARACTER]\n[TIME]\nLocation: Morrowfen\n[/TIME]' }) },
        prefs: { load: async () => ({ campaignNames: { 'chat-1': 'Vellmoor' }, campaignBooks: { 'chat-1': owned ?? ['Vellmoor_NPC', 'Vellmoor_LOC'] }, ...(window === undefined ? {} : { sceneLookback: window }) }) },
        books: () => ({ listBooks: async () => books, listEntries: async (bookId) => entries[bookId] ?? [] }),
        portraits: { load: async () => ({ portraits }), set: async (chatId, name, src) => { calls.push(['set', chatId, name, src]); if (src) portraits = { ...portraits, [name]: src }; else { const { [name]: _gone, ...kept } = portraits; portraits = kept } } },
        playerCard: { view: async () => ({ card: { name: 'Thessaly Brook', bio: 'Species: Human' } }) },
        mapState: { load: async () => ({ activeSiteRoot: 'Monastery' }) },
        log: { info: (m) => log.push(m), warn: (m) => log.push(`warn: ${m}`) },
        now: () => new Date('2026-10-05T12:00:00.000Z'),
        ...rest,
    }
    return { scene: createScene(deps), calls, log }
}

describe('the scene', () => {
    it('resolves the footer against the place book, reads the entry without its map, the picture, the site, and who is present with the player first', async () => {
        const { scene, log } = harness()
        const result = await scene.get('chat-1', 'u1')
        expect(result).toEqual({
            at: '2026-10-05T12:00:00.000Z',
            location: { raw: 'Monastery Courtyard', path: 'Monastery :: Courtyard', leaf: 'Courtyard', breadcrumb: 'Monastery › Courtyard', storagePath: 'Monastery :: Courtyard', image: 'https://host/yard.png', entryId: 'Vellmoor_LOC::1', content: 'A yard.' },
            present: [
                { id: 'player-character', label: 'Thessaly Brook', portrait: 'https://host/t.png', isPlayerCharacter: true, content: 'Species: Human' },
                { id: 'Vellmoor_NPC::1', label: 'Mother Sedge', portrait: 'https://host/sedge.png', isPlayerCharacter: false, content: '[CORE]\nKeeper.\n[/CORE]', ago: 0 },
                { id: 'Vellmoor_NPC::2', label: 'Loose Bill', portrait: '', isPlayerCharacter: false, content: 'A drunk.', ago: 0 },
            ],
            window: 2,
            mapSite: 'Monastery',
            books: ['Vellmoor_NPC', 'Vellmoor_LOC'],
        })
        expect(log).toContain('scene: party at "Monastery Courtyard" = Monastery :: Courtyard; present over 2 replies: Thessaly Brook, Mother Sedge, Loose Bill')
    })

    it('falls back to the memo without a footer, leaves an unknown place unresolved, and takes the sheet\'s name for the player\'s portrait', async () => {
        // The card is named for the persona; the sheet's name carries the portrait, as the legacy's fallback has it.
        const { scene } = harness({ messages: async () => [{ role: 'assistant', content: 'No footer. Wrenna waits.' }], portraitMap: { 'Thessaly Brook': 'https://host/t2.png' }, playerCard: { view: async () => ({ card: { name: 'Wrenna', bio: 'Species: Human' } }) } })
        const result = await scene.get('chat-1', 'u1')
        expect(result.location).toMatchObject({ raw: 'Morrowfen', path: 'Morrowfen', leaf: 'Morrowfen', entryId: 'Vellmoor_LOC::2', content: 'A port.', image: '' })
        expect(result.present).toEqual([{ id: 'player-character', label: 'Wrenna', portrait: 'https://host/t2.png', isPlayerCharacter: true, content: 'Species: Human' }])
        const nowhere = harness({ messages: async () => [{ role: 'assistant', content: 'Far away. (Location: The Salt Road)' }] })
        expect((await nowhere.scene.get('chat-1', 'u1')).location).toMatchObject({ raw: 'The Salt Road', path: '', leaf: 'The Salt Road', breadcrumb: '', storagePath: 'The Salt Road', entryId: '', content: '' })
    })

    it('reads only the campaign\'s own place and NPC books, and lists nobody without a card or a narrator reply', async () => {
        const { scene } = harness({ playerCard: undefined, messages: async () => [{ role: 'user', content: 'Bill? (Location: Morrowfen)' }] })
        const result = await scene.get('chat-1', 'u1')
        expect(result.present).toEqual([])
        expect(result.books).toEqual(['Vellmoor_NPC', 'Vellmoor_LOC'])
        const bare = harness({ owned: [], bookList: [{ id: 'b4', name: 'Other_NPC' }], mapState: undefined })
        const empty = await bare.scene.get('chat-1', 'u1')
        expect(empty.present.map((p) => p.label)).toEqual(['Thessaly Brook'])
        expect(empty.location.path).toBe('')
        expect(empty.mapSite).toBe('')
    })

    it('lists the campaign’s places with their maps stripped, for the picture’s parent chain (49)', async () => {
        const { scene } = harness()
        expect(await scene.places('chat-1', 'u1')).toEqual([{ path: 'Monastery :: Courtyard', content: 'A yard.' }, { path: 'Morrowfen', content: 'A port.' }])
        const broken = harness({ books: () => ({ listBooks: async () => { throw new Error('down') }, listEntries: async () => [] }) })
        expect(await broken.scene.places('chat-1', 'u1')).toEqual([])
    })

    it('names a book read that failed, and still answers', async () => {
        const { scene, log } = harness({ books: () => ({ listBooks: async () => { throw new Error('the host is down') }, listEntries: async () => [] }) })
        const result = await scene.get('chat-1', 'u1')
        expect(result.problem).toBe('the host is down')
        expect(result.present.map((p) => p.label)).toEqual(['Thessaly Brook'])
        expect(log.some((line) => line.startsWith('warn: scene: the campaign\'s books could not be read: the host is down'))).toBe(true)
        const quiet = harness({ messages: async () => { throw new Error('x') }, memos: { load: async () => { throw new Error('y') } }, portraits: { load: async () => { throw new Error('z') }, set: async () => {} } })
        expect((await quiet.scene.get('chat-1', 'u1')).location.raw).toBe('')
    })

    it('keeps and forgets a place\'s picture under its pin, and answers with the scene', async () => {
        const { scene, calls } = harness()
        const set = await scene.setImage('chat-1', 'u1', 'Morrowfen', 'https://host/port.png')
        expect(calls).toEqual([['set', 'chat-1', '📍 Morrowfen', 'https://host/port.png']])
        expect(set.location.path).toBe('Monastery :: Courtyard')
        const result = await scene.setImage('chat-1', 'u1', 'Monastery::Courtyard', '')
        expect(calls[1]).toEqual(['set', 'chat-1', '📍 Monastery :: Courtyard', ''])
        expect(result.location.image).toBe('')
        await expect(scene.setImage('chat-1', 'u1', '  ', 'x')).rejects.toThrow(/needs a name/)
    })
})

describe('the window (52)', () => {
    const chat = [
        { role: 'assistant', content: 'Bill snores in the hay. (Location: Monastery Courtyard)' },
        { role: 'user', content: 'I look around.' },
        { role: 'assistant', content: 'Old Sedge nods at you.' },
        { role: 'assistant', content: 'The gate creaks.' },
    ]

    it('reads as many replies as the preference says, placing each by the newest that names them, and says how many it read', async () => {
        const { scene, log } = harness({ messages: async () => chat, window: 3 })
        const result = await scene.get('chat-1', 'u1')
        expect(result.present.map((p) => [p.label, p.ago])).toEqual([['Thessaly Brook', undefined], ['Mother Sedge', 1], ['Loose Bill', 2]])
        expect(result.window).toBe(3)
        expect(log).toContain('scene: party at "Monastery Courtyard" = Monastery :: Courtyard; present over 3 replies: Thessaly Brook, Mother Sedge, Loose Bill')
        // One is the legacy's: the latest reply only, and here it names nobody.
        const one = harness({ messages: async () => chat, window: 1 })
        const latest = await one.scene.get('chat-1', 'u1')
        expect(latest.present.map((p) => p.label)).toEqual(['Thessaly Brook'])
        expect(latest.window).toBe(1)
        // Three without a stored preference; a short chat reads what there is.
        const unset = harness({ messages: async () => chat.slice(2) })
        const short = await unset.scene.get('chat-1', 'u1')
        expect(short.present.map((p) => [p.label, p.ago])).toEqual([['Thessaly Brook', undefined], ['Mother Sedge', 1]])
        expect(short.window).toBe(2)
    })
})
