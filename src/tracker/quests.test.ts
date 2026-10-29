import { describe, expect, it } from 'vitest'

import {
    applyQuestSync,
    getQuestMood,
    isArchivedQuestStatus,
    isEmergentQuest,
    parseQuestsFromMemo,
    parseQuestsFromText,
    questHasEffectiveDeadline,
    serializeQuestsToText,
    stripArchivedQuestsFromMemo,
    writeQuestsToMemo,
    type Quest,
} from './quests.js'

/** The format the extractor prompt documents, verbatim. */
const STOCK = [
    'QUEST: The Missing Sheep',
    '  ID: quest_1746703200000',
    '  STATUS: active',
    '  GIVER: Farmer Hemwick @ Crestwood Mill',
    '  ACCEPTED: 08:00 AM, Day 1',
    '  DEADLINE: 06:00 PM, Day 4',
    '  REWARD: 100 GP',
    '  FRUSTRATION_COEFF: 1.2',
    '  OBJ_ACTIVE: Find the missing sheep',
    '  OBJ_ACTIVE: Collect 6 Phosphor-Cap mushrooms [4/6]',
    '  OBJ_TOTAL: 6',
    '  OBJ_COMPLETED: Ask about the wolf',
    '  OBJ_FAILED: Save the lamb',
].join('\n')

const quest = (over: Partial<Quest> = {}): Quest => ({
    id: 'q1',
    title: 'A quest',
    status: 'active',
    giver_name: 'Giver',
    giver_location: 'Place',
    accepted_time: null,
    deadline_time: null,
    objectives: [],
    rewards: [],
    ...over,
})

describe('parsing the documented format', () => {
    const [q] = parseQuestsFromText(STOCK)

    it('reads the header fields', () => {
        expect(q).toMatchObject({
            id: 'quest_1746703200000',
            title: 'The Missing Sheep',
            status: 'active',
            giver_name: 'Farmer Hemwick',
            giver_location: 'Crestwood Mill',
            accepted_time: '08:00 AM, Day 1',
            deadline_time: '06:00 PM, Day 4',
            frustration_coefficient: 1.2,
        })
    })

    it('reads every objective with its state', () => {
        expect(q!.objectives.map((o) => [o.text, o.status])).toEqual([
            ['Find the missing sheep', 'active'],
            ['Collect 6 Phosphor-Cap mushrooms', 'active'],
            ['Ask about the wolf', 'completed'],
            ['Save the lamb', 'failed'],
        ])
    })

    it('pulls an inline counter out of the objective text', () => {
        expect(q!.objectives[1]).toMatchObject({ progress: 4, total: 6 })
        expect(q!.objectives[1]!.text).not.toContain('[4/6]')
    })

    it('collects rewards', () => {
        expect(q!.rewards).toEqual(['100 GP'])
    })

    it('numbers objectives positionally', () => {
        expect(q!.objectives.map((o) => o.id)).toEqual(['obj_0', 'obj_1', 'obj_2', 'obj_3'])
    })
})

describe('parsing what a model actually writes', () => {
    it('accepts OBJ_DONE, the older spelling of completed', () => {
        const [q] = parseQuestsFromText('QUEST: T\n  OBJ_DONE: A thing')
        expect(q!.objectives[0]!.status).toBe('completed')
    })

    it('marks an (optional) objective as not required', () => {
        const [q] = parseQuestsFromText('QUEST: T\n  OBJ_ACTIVE: Feed the horse (optional)')
        expect(q!.objectives[0]).toMatchObject({ text: 'Feed the horse', required: false })
    })

    it('splits several objectives written on one line', () => {
        // The tell is a marker mid-string; a lone objective's can only be last.
        const [q] = parseQuestsFromText(
            'QUEST: T\n  OBJ_ACTIVE: Buy rope (required), Feed the horse (optional), Sharpen the axe (required)',
        )
        expect(q!.objectives.map((o) => o.text)).toEqual(['Buy rope', 'Feed the horse', 'Sharpen the axe'])
        expect(q!.objectives.map((o) => o.required)).toEqual([true, false, true])
    })

    it('leaves a comma alone when it is part of the objective', () => {
        const [q] = parseQuestsFromText('QUEST: T\n  OBJ_ACTIVE: Speak to Aldric, then to Mira (required)')
        expect(q!.objectives).toHaveLength(1)
        expect(q!.objectives[0]!.text).toBe('Speak to Aldric, then to Mira')
    })

    it('falls back to an OBJ_TOTAL line when there is no inline counter', () => {
        const [q] = parseQuestsFromText('QUEST: T\n  OBJ_ACTIVE: Collect roots\n  OBJ_TOTAL: 12')
        expect(q!.objectives[0]).toMatchObject({ total: 12 })
        expect(q!.objectives[0]!.progress).toBeUndefined()
    })

    it('takes the first value when a field is written twice', () => {
        const [q] = parseQuestsFromText('QUEST: T\n  STATUS: active\n  STATUS: completed')
        expect(q!.status).toBe('active')
    })

    it('defaults an absent giver to Unknown rather than dropping the quest', () => {
        const [q] = parseQuestsFromText('QUEST: T')
        expect(q).toMatchObject({ giver_name: 'Unknown', giver_location: 'Unknown', status: 'active' })
    })

    it('invents an id only when the model omitted one', () => {
        const [q] = parseQuestsFromText('QUEST: T', { now: () => 1234 })
        expect(q!.id).toBe('quest_1234_0')
    })

    it('drops a block with no title instead of making a nameless quest', () => {
        expect(parseQuestsFromText('QUEST:\n  STATUS: active')).toEqual([])
    })

    it('ignores a coefficient that is not a number', () => {
        const [q] = parseQuestsFromText('QUEST: T\n  GIVER: A @ B\n  FRUSTRATION_COEFF: very patient')
        expect(q!.frustration_coefficient).toBeUndefined()
    })

    it('returns nothing for empty input', () => {
        expect(parseQuestsFromText('')).toEqual([])
        expect(parseQuestsFromText(null)).toEqual([])
    })
})

describe('emergent quests', () => {
    it.each([
        ['TYPE: emergent', 'QUEST: T\n  TYPE: emergent\n  GIVER: Someone @ Somewhere'],
        ['EMERGENT: yes', 'QUEST: T\n  EMERGENT: yes\n  GIVER: Someone @ Somewhere'],
        ['a self giver', 'QUEST: T\n  GIVER: Self @ —'],
        ['a {{user}} giver', 'QUEST: T\n  GIVER: {{user}} @ Anywhere'],
    ])('recognises one declared by %s', (_name, text) => {
        const [q] = parseQuestsFromText(text)
        expect(q!.emergent).toBe(true)
        expect(q!.type).toBe('emergent')
    })

    it('never carries a frustration coefficient, even when one was written', () => {
        // Nobody is waiting on a self-imposed quest, so a coefficient could
        // only produce a mood for an NPC that does not exist.
        const [q] = parseQuestsFromText('QUEST: T\n  GIVER: Self @ —\n  FRUSTRATION_COEFF: 2.0')
        expect(q!.frustration_coefficient).toBeUndefined()
    })

    it('leaves an NPC quest alone', () => {
        expect(isEmergentQuest(quest({ giver_name: 'Farmer Hemwick' }))).toBe(false)
    })
})

describe('deadlines', () => {
    it('accepts a real one', () => {
        expect(questHasEffectiveDeadline(quest({ accepted_time: 'Day 1', deadline_time: 'Day 4' }))).toBe(true)
    })

    it.each(['none', 'N/A', 'no deadline', 'unlimited', 'tbd', '—'])('rejects the sentinel %j', (value) => {
        expect(questHasEffectiveDeadline(quest({ deadline_time: value }))).toBe(false)
    })

    it('rejects an unparseable one rather than treating it as passed', () => {
        expect(questHasEffectiveDeadline(quest({ deadline_time: 'when the moon is right' }))).toBe(false)
    })

    it('rejects a deadline at or before the accepted time', () => {
        // Not a window at all — and left in, it would make the quest
        // permanently, maximally overdue.
        expect(questHasEffectiveDeadline(quest({ accepted_time: 'Day 5', deadline_time: 'Day 2' }))).toBe(false)
        expect(questHasEffectiveDeadline(quest({ accepted_time: 'Day 5', deadline_time: 'Day 5' }))).toBe(false)
    })

    it('rejects a missing one', () => {
        expect(questHasEffectiveDeadline(quest())).toBe(false)
    })
})

describe('the giver mood', () => {
    const withDeadline = (over: Partial<Quest> = {}) =>
        quest({ accepted_time: '08:00 AM, Day 1', deadline_time: '08:00 AM, Day 5', ...over })

    it('starts pleased and ends furious', () => {
        expect(getQuestMood(withDeadline(), '08:00 AM, Day 1', true).label).toBe('Very Pleased')
        expect(getQuestMood(withDeadline(), '08:00 AM, Day 5', true).label).toBe('Neutral')
        expect(getQuestMood(withDeadline(), '08:00 AM, Day 20', true).label).toBe('Furious')
    })

    it('uses clock words instead when frustration display is off', () => {
        expect(getQuestMood(withDeadline(), '08:00 AM, Day 3', false).label).toBe('Ahead of Schedule')
        expect(getQuestMood(withDeadline(), '08:00 AM, Day 20', false).label).toBe('Overdue')
    })

    it('lets a patient giver stay happier for longer than a volatile one', () => {
        const patient = getQuestMood(withDeadline({ frustration_coefficient: 0.4 }), '08:00 AM, Day 3', true)
        const volatile = getQuestMood(withDeadline({ frustration_coefficient: 3 }), '08:00 AM, Day 3', true)
        expect(patient.value).toBeLessThan(volatile.value!)
    })

    it('has no opinion where the question does not apply', () => {
        // Distinct from Neutral, which is a real mood.
        expect(getQuestMood(withDeadline({ emergent: true }), 'Day 3', true).value).toBeNull()
        expect(getQuestMood(withDeadline({ status: 'completed' }), 'Day 3', true).value).toBeNull()
        expect(getQuestMood(quest(), 'Day 3', true).value).toBeNull()
        expect(getQuestMood(withDeadline(), 'nothing here', true).value).toBeNull()
    })
})

describe('archiving', () => {
    it.each(['completed', 'failed', 'past deadline', 'Completed', ' FAILED '])('treats %j as finished', (status) => {
        expect(isArchivedQuestStatus(status)).toBe(true)
    })

    it.each(['active', 'abandoned', '', undefined])('treats %j as still running', (status) => {
        expect(isArchivedQuestStatus(status)).toBe(false)
    })
})

describe('serializing', () => {
    it('round-trips the documented format back to itself', () => {
        const once = serializeQuestsToText(parseQuestsFromText(STOCK))
        expect(serializeQuestsToText(parseQuestsFromText(once))).toBe(once)
    })

    it('writes MOOD only when frustration display is on', () => {
        const quests = parseQuestsFromText(STOCK)
        const on = serializeQuestsToText(quests, { showFrustration: true, currentTime: '06:00 PM, Day 3' })
        const off = serializeQuestsToText(quests, { showFrustration: false, currentTime: '06:00 PM, Day 3' })
        expect(on).toMatch(/ {2}MOOD: /)
        expect(off).not.toContain('MOOD:')
    })

    it('writes no MOOD for an emergent quest even with display on', () => {
        const quests = parseQuestsFromText('QUEST: T\n  GIVER: Self @ —\n  ACCEPTED: Day 1\n  DEADLINE: Day 5')
        expect(serializeQuestsToText(quests, { showFrustration: true, currentTime: 'Day 3' })).not.toContain('MOOD:')
    })

    it('is empty for no quests', () => {
        expect(serializeQuestsToText([])).toBe('')
    })
})

describe('writing quests back into a memo', () => {
    const memo = `[TIME]\n06:15 PM, Day 3\n[/TIME]\n\n[QUESTS]\n${STOCK}\n[/QUESTS]`

    it('leaves finished quests out', () => {
        const quests = [quest({ id: 'a', title: 'Live' }), quest({ id: 'b', title: 'Done', status: 'completed' })]
        const result = writeQuestsToMemo(quests, memo)
        expect(result).toContain('QUEST: Live')
        expect(result).not.toContain('QUEST: Done')
    })

    it('removes the block entirely when nothing is left', () => {
        // An empty [QUESTS] tells the model the quest log exists and is empty,
        // which is a different and wrong claim.
        const result = writeQuestsToMemo([quest({ status: 'completed' })], memo)
        expect(result).not.toContain('[QUESTS]')
        expect(result).toContain('[TIME]')
    })

    it('appends a block to a memo that has none', () => {
        const result = writeQuestsToMemo([quest({ title: 'New' })], '[TIME]\nDay 1\n[/TIME]')
        expect(result).toContain('[QUESTS]')
        expect(result).toContain('QUEST: New')
    })

    it('leaves a memo without a block alone when there is nothing to write', () => {
        expect(writeQuestsToMemo([], '[TIME]\nDay 1\n[/TIME]')).toBe('[TIME]\nDay 1\n[/TIME]')
    })
})

describe('stripping finished quests out of a memo', () => {
    const memoWith = (...blocks: string[]) => `[TIME]\nDay 9\n[/TIME]\n\n[QUESTS]\n${blocks.join('\n\n')}\n[/QUESTS]`

    const live = 'QUEST: Live\n  ID: a\n  STATUS: active\n  GIVER: X @ Y'
    const done = 'QUEST: Done\n  ID: b\n  STATUS: completed\n  GIVER: X @ Y'

    it('removes only the finished block', () => {
        const result = stripArchivedQuestsFromMemo(memoWith(live, done))
        expect(result).toContain('QUEST: Live')
        expect(result).not.toContain('QUEST: Done')
    })

    it('returns the memo untouched when nothing is finished', () => {
        // Byte-identical on purpose: a quest the parser did not fully
        // understand must not be silently reformatted by having survived.
        const memo = memoWith(live)
        expect(stripArchivedQuestsFromMemo(memo)).toBe(memo)
    })

    it('drops the whole block when every quest is finished', () => {
        const result = stripArchivedQuestsFromMemo(memoWith(done))
        expect(result).not.toContain('[QUESTS]')
    })

    it('handles the older JSON format too', () => {
        const memo = `[QUESTS]\n${JSON.stringify([
            { id: 'a', title: 'Live', status: 'active' },
            { id: 'b', title: 'Done', status: 'completed' },
        ])}\n[/QUESTS]`
        const result = stripArchivedQuestsFromMemo(memo)
        expect(result).toContain('Live')
        expect(result).not.toContain('Done')
    })

    it('leaves a block it cannot read alone', () => {
        const memo = '[QUESTS]\nThe hero owes a favour to the smith.\n[/QUESTS]'
        expect(stripArchivedQuestsFromMemo(memo)).toBe(memo)
    })

    it('leaves a memo with no quest block alone', () => {
        expect(stripArchivedQuestsFromMemo('[TIME]\nDay 1\n[/TIME]')).toBe('[TIME]\nDay 1\n[/TIME]')
    })
})

describe('parsing a whole memo', () => {
    it('reads the plain-text format', () => {
        expect(parseQuestsFromMemo(`[QUESTS]\n${STOCK}\n[/QUESTS]`)).toHaveLength(1)
    })

    it('reads the older JSON format, array or wrapped', () => {
        expect(parseQuestsFromMemo(`[QUESTS]\n[{"id":"a","title":"A"}]\n[/QUESTS]`)).toHaveLength(1)
        expect(parseQuestsFromMemo(`[QUESTS]\n{"quests":[{"id":"a","title":"A"}]}\n[/QUESTS]`)).toHaveLength(1)
    })

    it('returns nothing rather than throwing on a block it cannot read', () => {
        // A mangled block must not take a turn down.
        expect(parseQuestsFromMemo('[QUESTS]\n{ not json\n[/QUESTS]')).toEqual([])
        expect(parseQuestsFromMemo('no quest block here')).toEqual([])
    })
})

describe('applyQuestSync', () => {
    const memo = [
        '[TIME]',
        '06:00 PM, Day 3',
        '[/TIME]',
        '',
        '[QUESTS]',
        STOCK,
        '',
        'QUEST: The Rat Cellar\n  ID: b\n  STATUS: completed\n  GIVER: Innkeeper @ The Bell',
        '[/QUESTS]',
    ].join('\n')

    it('drops the finished quest and reports it', () => {
        const result = applyQuestSync(memo)
        expect(result.memo).not.toContain('The Rat Cellar')
        expect(result.memo).toContain('The Missing Sheep')
        expect(result.archived.map((q) => q.title)).toEqual(['The Rat Cellar'])
    })

    it('returns the full list, archived ones included', () => {
        expect(applyQuestSync(memo).quests.map((q) => q.title)).toEqual(['The Missing Sheep', 'The Rat Cellar'])
    })

    it('injects the mood when asked', () => {
        const result = applyQuestSync(memo, { showFrustration: true, currentTime: '06:00 PM, Day 3' })
        expect(result.memo).toContain('MOOD:')
    })

    it('leaves a memo with no quest block untouched', () => {
        expect(applyQuestSync('[TIME]\nDay 1\n[/TIME]').memo).toBe('[TIME]\nDay 1\n[/TIME]')
    })

    it('does not rewrite a JSON block into the text format', () => {
        // Reformatting a shape this build does not author is a change nobody
        // asked for; the archived entries still go.
        const json = `[QUESTS]\n${JSON.stringify([{ id: 'a', title: 'A', status: 'active' }])}\n[/QUESTS]`
        expect(applyQuestSync(json).memo).toContain('"title"')
        expect(applyQuestSync(json).memo).not.toContain('QUEST: A')
    })
})
