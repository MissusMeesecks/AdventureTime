import { describe, expect, it } from 'vitest'

import { COMMIT_FIELDS, cleanLabel, isEmptyCommit, normalizeCommit } from './commit.js'

const read = (args: unknown) => normalizeCommit(args)

describe('reading a commit', () => {
    it('keeps the well-formed items and says what it dropped', () => {
        // The rule that matters: one bad id must not cost the whole turn's
        // lore. A partial update beats a lost one.
        const { commit, problems } = read({
            update: [
                { id: 'NPCs::1', content: 'Now wary of the party.' },
                { id: 'not-an-id', content: 'Lost.' },
            ],
        })
        expect(commit.update).toEqual([{ id: 'NPCs::1', content: 'Now wary of the party.' }])
        expect(problems).toHaveLength(1)
        expect(problems[0]).toContain('not-an-id')
    })

    it.each([
        ['no separator', 'NPCs'],
        ['nothing after the separator', 'NPCs::'],
        ['nothing before it', '::4'],
        ['a number', 4],
        ['a null', null],
    ])('refuses an id with %s', (_label, id) => {
        expect(read({ update: [{ id, content: 'x' }] }).commit.update).toEqual([])
    })

    it('reads the Player Card\'s addresses for Body, Worn Equipment and core edits only, and only with a card (35b)', () => {
        const args = { appearance: [{ id: '{{user}}', content: 'Tall.' }], equipment: [{ id: 'player', content: 'A cloak.' }], core: [{ id: 'Robin Vale', field: 'Body', content: 'Taller.' }], update: [{ id: 'pc', content: 'x' }] }
        const withCard = normalizeCommit(args, { playerCard: 'Robin Vale' })
        expect(withCard.commit.core).toEqual([{ id: '{{user}}', field: 'Body', content: 'Tall.' }, { id: 'player', field: 'Worn Equipment', content: 'A cloak.' }, { id: 'Robin Vale', field: 'Body', content: 'Taller.' }])
        expect(withCard.problems).toEqual(['update: "pc" is not an entry id'])
        const without = normalizeCommit(args)
        expect(without.commit.core).toEqual([])
        expect(without.problems).toEqual(['update: "pc" is not an entry id', 'appearance: "{{user}}" is not an entry id', 'equipment: "player" is not an entry id', 'core: "Robin Vale" is not an entry id'])
        expect(normalizeCommit({ core: [{ id: 'Oswin', field: 'Body', content: 'x' }] }, { playerCard: 'Robin Vale' }).problems).toEqual(['core: "Oswin" is not an entry id'])
    })

    it('folds appearance and equipment into core edits, as the legacy does', () => {
        const { commit } = read({
            appearance: [{ id: 'NPCs::1', content: 'Scarred left hand.' }],
            equipment: [{ id: 'NPCs::1', content: 'Coil of tarred rope.' }],
            core: [{ id: 'NPCs::1', field: 'Species', content: 'half-elf' }],
        })
        expect(commit.core).toEqual([
            { id: 'NPCs::1', field: 'Body', content: 'Scarred left hand.' },
            { id: 'NPCs::1', field: 'Worn Equipment', content: 'Coil of tarred rope.' },
            { id: 'NPCs::1', field: 'Species', content: 'half-elf' },
        ])
    })

    it('refuses a rewrite with no content, which would empty the entry', () => {
        const { commit, problems } = read({ rewrite: [{ id: 'NPCs::1', content: '   ' }] })
        expect(commit.rewrite).toEqual([])
        expect(problems[0]).toContain('emptied')
    })

    it('refuses to record an entry with no category, rather than guessing a book', () => {
        // The category decides which lorebook it lands in. Guessing would file
        // a user's lore somewhere they did not ask for.
        const { commit, problems } = read({ record: [{ label: 'Lissa', keys: ['Lissa'] }] })
        expect(commit.record).toEqual([])
        expect(problems[0]).toContain('no category')
    })

    it('strips the category prefix a model puts on a label anyway', () => {
        expect(cleanLabel('NPC: Lissa')).toBe('Lissa')
        expect(cleanLabel('Lissa')).toBe('Lissa')
        // Not a prefix — a real title that happens to contain a colon.
        expect(cleanLabel('Kalvermoor :: The Ring')).toBe('Kalvermoor :: The Ring')
    })

    it('never lets a consolidate delete its own survivor', () => {
        // The merge deletes every target. A survivor listed among them would
        // destroy the entry the merge had just written.
        const { commit } = read({
            consolidate: [{ survivor: 'EVENT::4', targets: ['EVENT::4', 'EVENT::5'], content: 'Merged.' }],
        })
        expect(commit.consolidate).toEqual([{ survivor: 'EVENT::4', targets: ['EVENT::5'], content: 'Merged.' }])
    })

    it('drops a consolidate with nothing left to merge', () => {
        const { commit, problems } = read({
            consolidate: [{ survivor: 'EVENT::4', targets: ['EVENT::4'], content: 'x' }],
        })
        expect(commit.consolidate).toEqual([])
        expect(problems[0]).toContain('nothing to merge')
    })

    it('needs a field and a number for a relationship nudge', () => {
        const { commit } = read({
            rel: [
                { id: 'NPCs::1', field: 'Trust', delta: -2 },
                { id: 'NPCs::1', field: 'Trust', delta: 'a lot' },
                { id: 'NPCs::1', delta: 3 },
            ],
        })
        expect(commit.rel).toEqual([{ id: 'NPCs::1', field: 'Trust', delta: -2 }])
    })

    it('drops a rename that changes nothing, and an empty title', () => {
        expect(read({ rename: [{ id: 'NPCs::1' }] }).commit.rename).toEqual([])
        expect(read({ rename: [{ id: 'NPCs::1', label: '  ' }] }).commit.rename).toEqual([])
        expect(read({ rename: [{ id: 'NPCs::1', keys: ['a'] }] }).commit.rename)
            .toEqual([{ id: 'NPCs::1', keys: ['a'] }])
    })

    it.each([
        ['a null', null],
        ['a string', 'commit'],
        ['an array', []],
        ['nothing', undefined],
    ])('reads %s as a commit that asked for nothing', (_label, args) => {
        const { commit, problems } = read(args)
        expect(isEmptyCommit(commit)).toBe(true)
        expect(problems).toEqual([])
    })

    it('carries the model\'s reason through for the pass log', () => {
        expect(read({ reason: '  The party left the Ring.  ' }).commit.reason)
            .toBe('The party left the Ring.')
    })
})

describe('the shapes a model actually emits', () => {
    // Three live passes, three shapes, none of them the one the grammar wanted
    // — and every one of them silently produced an empty commit while the panel
    // reported "committed no changes".
    it.each([
        ['a list, as documented', { update: [{ id: 'B::1', content: 'x' }] }],
        ['keyed by id, with an object', { update: { 'B::1': { content: 'x' } } }],
        ['keyed by id, with a bare string', { update: { 'B::1': 'x' } }],
        ['a list using "text" instead of "content"', { update: [{ id: 'B::1', text: 'x' }] }],
        ['keyed by id, using "text"', { update: { 'B::1': { text: 'x' } } }],
    ])('reads %s', (_label, args) => {
        expect(read(args).commit.update).toEqual([{ id: 'B::1', content: 'x' }])
    })

    it('lets an explicit id inside the item win over the key', () => {
        expect(read({ update: { wrong: { id: 'B::1', content: 'x' } } }).commit.update)
            .toEqual([{ id: 'B::1', content: 'x' }])
    })

    it('reads the keyed shape for records and rewrites too', () => {
        expect(read({ rewrite: { 'B::1': 'new text' } }).commit.rewrite)
            .toEqual([{ id: 'B::1', content: 'new text' }])
        expect(read({ record: [{ label: 'A', category: 'NPC', text: 'prose' }] }).commit.record)
            .toEqual([{ label: 'A', category: 'NPC', keys: [], content: 'prose' }])
    })

    it('complains when a field is sent but yields nothing, instead of dropping it', () => {
        // The silent failure this layer exists to prevent: three passes said
        // "committed no changes" while the model had asked for an update every
        // time.
        const { commit, problems } = read({ update: 'not a list at all' })
        expect(commit.update).toEqual([])
        expect(problems[0]).toContain('could not be read')
    })

    it('says nothing about a field sent as an empty list or an empty object (65-quater)', () => {
        // Told that every field is a list, a live pass sent one for each field
        // it had nothing for, and was refused four times over.
        const { commit, problems } = read({ record: [{ label: 'A', category: 'NPC' }], update: [], rewrite: {}, rename: [], core: [], rel: [], consolidate: {} })
        expect(problems).toEqual([])
        expect(commit.record).toHaveLength(1)
        expect(commit.update).toEqual([])
        expect(commit.rel).toEqual([])
        // Something that is neither is still the silent failure.
        expect(read({ update: 'not a list at all', rel: 7 }).problems.map((p) => p.split(':')[0])).toEqual(['update', 'rel'])
    })

    it('says nothing about a field the model never sent', () => {
        expect(read({ record: [{ label: 'A', category: 'NPC' }] }).problems).toEqual([])
    })

    it('still refuses a bare entry id with no book name', () => {
        // Seen live. An id without its book is ambiguous across books, and
        // guessing which one was meant is not a guess worth making.
        const { commit, problems } = read({ update: [{ id: '503d528b-c3f0', content: 'x' }] })
        expect(commit.update).toEqual([])
        expect(problems[0]).toContain('is not an entry id')
    })
})

describe('the activation fields we deliberately do not act on', () => {
    it('records them instead of discarding them', () => {
        // Lumiverse owns activation here (docs/DECISION-ACTIVATION.md), but the
        // stock prompt still asks for these, so a model still sends them.
        // "Ignored 2 activation requests" is a fact worth showing; silently
        // dropping them would look like the commit half-failed.
        const { commit, ignoredActivation } = read({
            activate: ['NPCs::1', 'LOC::2', 'rubbish'],
            deactivate: ['NPCs::3'],
            update: [{ id: 'NPCs::1', content: 'Real work.' }],
        })
        expect(ignoredActivation).toEqual({ activate: ['NPCs::1', 'LOC::2'], deactivate: ['NPCs::3'] })
        // And they change nothing about what the commit will do.
        expect(commit.update).toHaveLength(1)
        expect(isEmptyCommit({ ...commit, update: [] })).toBe(true)
    })

    it('does not count them as a reason to call the commit non-empty', () => {
        const { commit } = read({ activate: ['NPCs::1'] })
        expect(isEmptyCommit(commit)).toBe(true)
    })
})

describe('the field list the prompt is checked against', () => {
    // COMMIT_FIELDS exists so `agent-pass.test.ts` can assert the prompt shows
    // a shape for every field. That is only worth anything if the list matches
    // what this reader actually accepts, so pin it from this side too: a name
    // here that the reader ignores would let a shape be documented for a field
    // that does nothing.
    const sample: Record<(typeof COMMIT_FIELDS)[number], unknown> = {
        record: [{ label: 'Lissa', category: 'NPC', keys: ['Lissa'], content: 'A rope-keeper.' }],
        update: [{ id: 'Book::1', content: 'More.' }],
        rewrite: [{ id: 'Book::1', content: 'Instead.' }],
        rename: [{ id: 'Book::1', label: 'New' }],
        core: [{ id: 'Book::1', field: 'Species', content: 'fae' }],
        consolidate: [{ survivor: 'Book::1', targets: ['Book::2'], content: 'Merged.' }],
        delete_ids: ['Book::1'],
    }

    for (const field of COMMIT_FIELDS) {
        it(`reads ${field}`, () => {
            const { commit } = read({ [field]: sample[field] })
            expect(isEmptyCommit(commit)).toBe(false)
        })
    }
})

describe('a relationship nudge, which the writer does not apply', () => {
    // The legacy kept relationship values outside the lorebooks entirely, in a
    // store with its own cap, log and rollback record. That store is the
    // pass's to write (44), not the writer's — and a `rel` item used to be
    // counted as a change anyway, which made a rel-only commit report success
    // and write nothing.
    it('is read, with an address or a bare name as the legacy allows', () => {
        const { commit } = read({ rel: [{ id: 'NPCs::1', field: 'Trust', delta: 2 }] })
        expect(commit.rel).toEqual([{ id: 'NPCs::1', field: 'Trust', delta: 2 }])
        // An NPC recorded in the same commit has no address yet: the name is kept for the pass to resolve.
        const named = read({ rel: [{ id: ' Lissa ', field: 'friendship', delta: '30' }, { id: '', field: 'friendship', delta: 1 }] })
        expect(named.commit.rel).toEqual([{ id: 'Lissa', field: 'friendship', delta: 30 }])
        expect(named.problems).toEqual(['rel: "(no id)" names nobody'])
        // The name under another key (65-bis): an NPC recorded in the same
        // commit has no id, and a live pass named them as its record did.
        const spelt = read({ rel: [
            { name: 'Ivo', field: 'friendship', delta: -15 },
            { npc: 'Scooter', field: 'friendship', delta: -10 },
            { label: ' Countess ', field: 'affection', delta: 5 },
            { target: 'A', field: 'friendship', delta: 1 }, { entry: 'B', field: 'friendship', delta: 1 }, { who: 'C', field: 'friendship', delta: 1 }, { character: 'D', field: 'friendship', delta: 1 }, { title: 'E', field: 'friendship', delta: 1 },
            { id: 'NPCs::1', name: 'ignored when an id is there', field: 'friendship', delta: 2 },
            { name: '', field: 'friendship', delta: 2 },
        ] })
        expect(spelt.commit.rel.map((r) => r.id)).toEqual(['Ivo', 'Scooter', 'Countess', 'A', 'B', 'C', 'D', 'E', 'NPCs::1'])
        expect(spelt.problems).toEqual(['rel: "(no id)" names nobody'])
        expect(read({ rel: 'nonsense' }).problems).toEqual(['rel: could not be read — expected a list of items, or entries keyed by id'])
    })

    it('does not by itself make a commit worth applying', () => {
        const { commit } = read({ rel: [{ id: 'NPCs::1', field: 'Trust', delta: 2 }] })
        expect(isEmptyCommit(commit)).toBe(true)
    })

    it('does not stop a real change from counting', () => {
        const { commit } = read({
            rel: [{ id: 'NPCs::1', field: 'Trust', delta: 2 }],
            update: [{ id: 'NPCs::1', content: 'She stayed.' }],
        })
        expect(isEmptyCommit(commit)).toBe(false)
    })
})

describe('the turn a commit item cites', () => {
    const read = (source: unknown) => normalizeCommit(source).commit

    it('carries a cited message through on a record', () => {
        const { record } = read({ record: [{ label: 'A', category: 'NPC', msg: 43 }] })
        expect(record[0]?.msg).toBe(43)
    })

    it('carries one through on an update', () => {
        const { update } = read({ update: [{ id: 'B::1', content: 'x', msg: 43 }] })
        expect(update[0]?.msg).toBe(43)
    })

    it.each([
        ['a bare number', 43],
        ['a string', '43'],
        ['a string with the hash the prompt shows', '#43'],
        ['a padded string', '  43 '],
    ])('reads %s, because a model will write any of them', (_label, value) => {
        expect(read({ record: [{ label: 'A', category: 'NPC', msg: value }] }).record[0]?.msg).toBe(43)
    })

    it('accepts "message" as well as "msg"', () => {
        // 9n: a model given one field name will sometimes reach for the other.
        expect(read({ record: [{ label: 'A', category: 'NPC', message: 43 }] }).record[0]?.msg).toBe(43)
    })

    it('leaves the field off entirely when nothing usable was cited', () => {
        // Absent means "the model did not say", which the writer treats
        // differently from a number it can check.
        expect(read({ record: [{ label: 'A', category: 'NPC' }] }).record[0]?.msg).toBeUndefined()
        expect(read({ record: [{ label: 'A', category: 'NPC', msg: 'soon' }] }).record[0]?.msg).toBeUndefined()
        expect(read({ record: [{ label: 'A', category: 'NPC', msg: -4 }] }).record[0]?.msg).toBeUndefined()
    })

    it('keeps message zero, which is a real message', () => {
        expect(read({ record: [{ label: 'A', category: 'NPC', msg: 0 }] }).record[0]?.msg).toBe(0)
    })
})
