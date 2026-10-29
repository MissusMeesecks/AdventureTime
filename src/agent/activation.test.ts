import { describe, expect, it } from 'vitest'

import { buildActivationView, type ActivatedEntry } from './activation.js'

const keyword = (comment: string, over: Partial<ActivatedEntry> = {}): ActivatedEntry =>
    ({ id: comment, comment, source: 'keyword', ...over })
const vector = (comment: string, score: number, over: Partial<ActivatedEntry> = {}): ActivatedEntry =>
    ({ id: comment, comment, source: 'vector', score, ...over })

describe('arranging what the host loaded', () => {
    it('puts the entries found by meaning first', () => {
        // The ordering is the argument. A vector hit is an entry Lumiverse
        // found *without* its keywords being in the text — the work the legacy
        // agent did by hand — so it is the first thing on screen.
        const view = buildActivationView([keyword('Alice'), vector('The Ring', 0.8), keyword('Bob')])
        expect(view.rows.map((row) => row.label)).toEqual(['The Ring', 'Alice', 'Bob'])
    })

    it('leads each group with the strongest match, then sorts by name', () => {
        const view = buildActivationView([
            vector('Weak', 0.3),
            vector('Strong', 0.9),
            keyword('Zeta'),
            keyword('Alpha'),
        ])
        expect(view.rows.map((row) => row.label)).toEqual(['Strong', 'Weak', 'Alpha', 'Zeta'])
    })

    it('counts each mechanism separately', () => {
        const view = buildActivationView([keyword('a'), vector('b', 0.5), vector('c', 0.4)])
        expect(view).toMatchObject({ total: 3, keywordCount: 1, vectorCount: 2 })
    })

    it('shows a score only for a match by meaning', () => {
        // A keyword hit showing 0.00 would read as having scored badly rather
        // than as not having been scored at all.
        // 0.8249 rather than 0.815: the latter sits just under the halfway
        // point in binary and rounds down, which makes the test about floating
        // point rather than about the rule.
        const view = buildActivationView([keyword('Alice', { score: 0.9 }), vector('Ring', 0.8249)])
        expect(view.rows.find((row) => row.label === 'Alice')?.score).toBe('')
        expect(view.rows.find((row) => row.label === 'Ring')?.score).toBe('0.82')
    })

    it('leaves the score blank when the host gave none', () => {
        expect(buildActivationView([{ id: 'x', comment: 'Ring', source: 'vector' }])[
            'rows'
        ][0]!.score).toBe('')
    })

    it('gives an untitled entry something to show', () => {
        // A blank row reads as a bug in the panel; an untitled entry is a real
        // thing a user can make.
        expect(buildActivationView([{ id: 'x', comment: '', source: 'keyword', keys: ['rope'] }]).rows[0]!.label)
            .toBe('(untitled — rope)')
        expect(buildActivationView([{ id: 'x', comment: '  ', source: 'keyword' }]).rows[0]!.label)
            .toBe('(untitled entry)')
    })

    it('carries the keys for the tooltip', () => {
        expect(buildActivationView([keyword('Alice', { keys: ['Alice', ' ', 'rope-keeper'] })]).rows[0]!.keys)
            .toBe('Alice, rope-keeper')
    })

    it.each([
        ['nothing at all', [], 'Lumiverse loaded no lore entries for this chat.'],
        ['a null', null, 'Lumiverse loaded no lore entries for this chat.'],
    ])('says plainly when %s came back', (_label, entries, expected) => {
        expect(buildActivationView(entries as ActivatedEntry[]).summary).toBe(expected)
    })

    it('says what the counts mean, not just what they are', () => {
        // The numbers alone only help someone who already knows the question.
        expect(buildActivationView([keyword('a'), vector('b', 0.5)]).summary)
            .toBe('2 entries loaded, 1 by keyword, 1 added by meaning — the ones added by meaning are ones keyword matching had missed.')
        expect(buildActivationView([keyword('a'), { id: 'c', comment: 'C', source: 'keyword', constant: true }]).summary)
            .toBe('2 entries loaded, 1 by keyword, 1 always on — meaning added nothing keyword had not already found.')
        expect(buildActivationView([keyword('a')]).summary)
            .toBe('1 entry loaded, 1 by keyword — meaning added nothing keyword had not already found.')
    })

    it('ignores rubbish in the list rather than failing on it', () => {
        const view = buildActivationView([null, undefined, keyword('Alice')] as unknown as ActivatedEntry[])
        expect(view.rows.map((row) => row.label)).toEqual(['Alice'])
    })

    it('treats an unrecognised source as a keyword hit', () => {
        // Fail soft: a host that grows a third mechanism should not make the
        // section unreadable, and "keyword" is the conservative reading — it
        // never claims a match by meaning that did not happen.
        const view = buildActivationView([{ id: 'x', comment: 'A', source: 'sorcery' } as unknown as ActivatedEntry])
        expect(view).toMatchObject({ vectorCount: 0, keywordCount: 1 })
    })
})


describe('an entry that is always on', () => {
    const always = (comment: string): ActivatedEntry =>
        ({ id: comment, comment, source: 'keyword', constant: true })

    it('does not count as a keyword hit', () => {
        // The host reports a constant entry as a keyword hit because it has no
        // other category for it. It matched nothing — calling it a hit inflates
        // the number the whole question turns on.
        const view = buildActivationView([always('Register & coin'), keyword('Lissa')])
        expect(view).toMatchObject({ keywordCount: 1, alwaysCount: 1, vectorCount: 0 })
        expect(view.rows.find((row) => row.label === 'Register & coin')?.source).toBe('always')
    })

    it('sorts below the entries that actually matched', () => {
        const view = buildActivationView([always('Always'), keyword('Keyword'), vector('Meaning', 0.7)])
        expect(view.rows.map((row) => row.source)).toEqual(['vector', 'keyword', 'always'])
    })
})

describe('saying what a zero means', () => {
    it('never claims meaning could not have found anything', () => {
        // The correction. 9d asserted that with no entry marked vectorized,
        // "nothing could have been found that way". Lumiverse's own per-entry
        // diagnostics disprove it: it scores vector distance and reranks
        // regardless, and credits the entry to keyword only because keyword
        // matched it first — "vector retrieval did not add a second copy".
        const view = buildActivationView([keyword('a'), keyword('b')], { vectorized: 0, total: 9 })
        expect(view.diagnosis).not.toMatch(/could not|nothing could/i)
        expect(view.diagnosis).toContain('not the same as')
    })

    it('frames the zero as what meaning added, not what it found', () => {
        const view = buildActivationView([keyword('a')], { vectorized: 4, total: 9 })
        expect(view.diagnosis).toContain('added by meaning that keyword had not already found')
        expect(view.diagnosis).toContain('4 of 9')
    })

    it('still says the useful part when the flags could not be read', () => {
        // The explanation does not depend on the count, so losing the count
        // must not lose the explanation.
        expect(buildActivationView([keyword('a')]).diagnosis).toContain('not the same as')
        expect(buildActivationView([keyword('a')]).diagnosis).not.toMatch(/\d+ of \d+/)
        expect(buildActivationView([keyword('a')], { vectorized: 0, total: 0 }).diagnosis)
            .not.toMatch(/\d+ of \d+/)
    })

    it('says nothing at all when meaning did add something', () => {
        expect(buildActivationView([vector('a', 0.7)], { vectorized: 4, total: 9 }).diagnosis).toBe('')
    })
})
