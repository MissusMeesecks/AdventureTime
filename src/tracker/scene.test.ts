import { describe, expect, it } from 'vitest'

import {
    currentLocationText,
    formatLocationBreadcrumb,
    isNpcBookName,
    latestNarration,
    locationImageKey,
    narrativeMentionsNpc,
    normalizeLocationPath,
    presentNpcs,
    presentNpcsOver,
    recentNarrations,
    resolveLocationPath,
    resolveSceneLocation,
    sceneCharacterKey,
    sceneLabel,
    stripSceneChoices,
    tokenizeLocationText,
} from './scene.js'

const PATHS = ['Monastery :: Courtyard', 'Monastery :: Cellar', 'Morrowfen', 'Morrowfen :: The Drowned Bell']

describe('the legacy helpers through the face', () => {
    it('normalizes a path, tokenizes text, resolves the deepest suffix and falls back to the leaf', () => {
        expect(normalizeLocationPath(' Monastery::Courtyard ')).toBe('Monastery :: Courtyard')
        expect(normalizeLocationPath(null)).toBe('')
        expect(tokenizeLocationText('Monastery :: Courtyard, east wing')).toEqual(['monastery', 'courtyard', 'east', 'wing'])
        expect(resolveLocationPath('Monastery Courtyard', PATHS)).toBe('Monastery :: Courtyard')
        expect(resolveLocationPath('Morrowfen The Drowned Bell', PATHS)).toBe('Morrowfen :: The Drowned Bell')
        // The leaf fallback matches one token only: a three-word leaf on its own stays unresolved, as in the legacy.
        expect(resolveLocationPath('The Drowned Bell', PATHS)).toBeNull()
        expect(resolveLocationPath('Cellar', PATHS)).toBe('Monastery :: Cellar')
        expect(resolveLocationPath('Nowhere', PATHS)).toBeNull()
        expect(resolveLocationPath('', PATHS)).toBeNull()
        expect(resolveLocationPath('Courtyard', ['A :: Courtyard', 'B :: Courtyard'], { activeLocPaths: ['B :: Courtyard'] })).toBe('B :: Courtyard')
        expect(formatLocationBreadcrumb('Monastery :: Courtyard')).toBe('Monastery › Courtyard')
        expect(formatLocationBreadcrumb('')).toBe('')
    })

    it('strips the choices, names the NPC books and tests a name at word boundaries', () => {
        expect(stripSceneChoices('Hi <choices><button>Go</button></choices> there')).toBe('Hi  there')
        expect(stripSceneChoices('Hi &lt;button&gt;Go&lt;/button&gt; there')).toBe('Hi  there')
        expect(isNpcBookName('Vell_NPC')).toBe(true)
        expect(isNpcBookName('Vell_NPCs')).toBe(true)
        expect(isNpcBookName('NPCs')).toBe(true)
        expect(isNpcBookName('Vell_LOC')).toBe(false)
        expect(narrativeMentionsNpc('Old Sedge nodded.', 'Mother Sedge')).toBe(true)
        expect(narrativeMentionsNpc('Old Sedge nodded.', 'Mother Sedge', { requireFullName: true })).toBe(false)
        expect(narrativeMentionsNpc('Mother  Sedge nodded.', 'Mother Sedge (the keeper)', { requireFullName: true })).toBe(true)
        expect(narrativeMentionsNpc('Sedgewick nodded.', 'Mother Sedge')).toBe(false)
        expect(narrativeMentionsNpc('', 'Mother Sedge')).toBe(false)
    })
})

describe('the location', () => {
    it('reads the newest footer in the chat, whoever wrote it, else the memo', () => {
        const messages = [
            { role: 'assistant', content: 'The yard. (Location: Monastery Courtyard)' },
            { role: 'user', content: 'I go down. (Location: Cellar)' },
            { role: 'assistant', content: 'No footer here.' },
        ]
        expect(currentLocationText(messages, '')).toBe('Cellar')
        expect(currentLocationText([], '[TIME]\nLocation: Morrowfen\n[/TIME]')).toBe('Morrowfen')
        expect(currentLocationText([], 'nothing')).toBe('')
    })

    it('resolves the scene location with its leaf, breadcrumb and storage path', () => {
        expect(resolveSceneLocation('Monastery Courtyard', PATHS)).toEqual({ raw: 'Monastery Courtyard', path: 'Monastery :: Courtyard', leaf: 'Courtyard', breadcrumb: 'Monastery › Courtyard', storagePath: 'Monastery :: Courtyard' })
        expect(resolveSceneLocation('The Salt Road', PATHS)).toEqual({ raw: 'The Salt Road', path: '', leaf: 'The Salt Road', breadcrumb: '', storagePath: 'The Salt Road' })
        expect(resolveSceneLocation('', PATHS)).toEqual({ raw: '', path: '', leaf: '', breadcrumb: '', storagePath: '' })
        expect(resolveSceneLocation('Courtyard', ['A :: Courtyard', 'B :: Courtyard'], ['B :: Courtyard']).path).toBe('B :: Courtyard')
    })

    it('keeps a place\'s picture under a pin', () => {
        expect(locationImageKey('Monastery::Courtyard')).toBe('📍 Monastery :: Courtyard')
    })
})

describe('present now', () => {
    const ENTRIES = [
        { id: 'Vell_NPC::1', comment: '[Major] Mother Sedge', content: ' Keeper of the reeds. ' },
        { id: 'Vell_NPC::2', comment: 'Loose Bill', content: 'A drunk.' },
        { id: 'Vell_NPC::3', comment: 'Mother Sedge (older)', content: 'A copy.' },
        { id: 'Vell_NPC::4', comment: '', content: 'Nameless.' },
    ]

    it('reads the newest narrator reply, choices stripped, and nothing from a summary or the player', () => {
        expect(latestNarration([{ role: 'assistant', content: 'Sedge waits. <choices><button>Greet Bill</button></choices>' }, { role: 'user', content: 'Bill!' }])).toBe('Sedge waits.')
        expect(latestNarration([{ role: 'assistant', content: '[Summary] Bill and Sedge met.' }])).toBe('')
        expect(latestNarration([{ role: 'user', content: 'Bill!' }])).toBe('')
    })

    it('matches entries by label, once per character, and requires the whole name of a freshly recorded one', () => {
        expect(presentNpcs('Old Sedge nodded to Bill.', ENTRIES)).toEqual([
            { id: 'Vell_NPC::1', label: 'Mother Sedge', content: 'Keeper of the reeds.' },
            { id: 'Vell_NPC::2', label: 'Loose Bill', content: 'A drunk.' },
        ])
        expect(presentNpcs('Old Sedge nodded.', ENTRIES, new Set(['Vell_NPC::1']))).toEqual([{ id: 'Vell_NPC::3', label: 'Mother Sedge (older)', content: 'A copy.' }])
        expect(presentNpcs('   ', ENTRIES)).toEqual([])
        expect(sceneLabel('[Major] Mother Sedge ')).toBe('Mother Sedge')
        expect(sceneCharacterKey('Mother Sedge (older)')).toBe('mother sedge')
    })
})

describe('the window (52)', () => {
    const chat = [
        { role: 'assistant', content: '[Summary] Bill and Sedge met long ago.' },
        { role: 'assistant', content: 'Sedge waits by the gate.' },
        { role: 'user', content: 'Bill!' },
        { role: 'assistant', content: 'Bill snores. <choices><button>Wake Bill</button></choices>' },
        { role: 'assistant', content: '(Summary of past events: nothing)' },
        { role: 'assistant', content: 'The gate creaks.' },
    ]
    const entries = [{ id: 'n1', comment: 'Mother Sedge', content: 'Keeper.' }, { id: 'n2', comment: 'Loose Bill', content: 'A drunk.' }, { id: 'n3', comment: 'Thessaly', content: 'x' }]

    it('reads the newest replies first, choices stripped, summaries skipped rather than counted, and never fewer than one', () => {
        expect(recentNarrations(chat, 2)).toEqual(['The gate creaks.', 'Bill snores.'])
        expect(recentNarrations(chat, 3)).toEqual(['The gate creaks.', 'Bill snores.', 'Sedge waits by the gate.'])
        expect(recentNarrations(chat, 10)).toEqual(['The gate creaks.', 'Bill snores.', 'Sedge waits by the gate.'])
        expect(recentNarrations(chat, 0)).toEqual(['The gate creaks.'])
        expect(recentNarrations(chat, Number.NaN)).toEqual(['The gate creaks.'])
        expect(recentNarrations(chat, -2)).toEqual(['The gate creaks.'])
        expect(recentNarrations([{ role: 'user', content: 'Bill!' }], 3)).toEqual([])
    })

    it('places each character by the newest reply that names them, once, with the player’s own entry still a match', () => {
        const over = presentNpcsOver(['Bill snores while Sedge watches.', 'Sedge waits.', 'Bill and Thessaly talk.'], entries)
        expect(over).toEqual([
            { id: 'n1', label: 'Mother Sedge', content: 'Keeper.', ago: 0 },
            { id: 'n2', label: 'Loose Bill', content: 'A drunk.', ago: 0 },
            { id: 'n3', label: 'Thessaly', content: 'x', ago: 2 },
        ])
        // Within one reply the entries' order holds, as the legacy's scan has it.
        expect(presentNpcsOver(['Thessaly, then Sedge.'], entries).map((n) => [n.label, n.ago])).toEqual([['Mother Sedge', 0], ['Thessaly', 0]])
        expect(presentNpcsOver([], entries)).toEqual([])
        expect(presentNpcsOver(['', 'Sedge.'], entries).map((n) => n.ago)).toEqual([1])
        // A freshly recorded entry still needs its whole name in every reply.
        expect(presentNpcsOver(['Sedge nods.'], entries, new Set(['n1']))).toEqual([])
    })
})
