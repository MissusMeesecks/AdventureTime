import { describe, expect, it } from 'vitest'

import { buildQuestCardView, buildQuestLogView } from './quest-view.js'
import { parseQuestsFromText, type Quest } from './quests.js'

/** One quest, from the format the extractor prompt documents. */
function quest(...lines: string[]): Quest {
    const parsed = parseQuestsFromText(lines.join('\n'))
    if (!parsed[0]) throw new Error('the fixture did not parse into a quest')
    return parsed[0]
}

const SHEEP = [
    'QUEST: The Missing Sheep',
    '  ID: quest_1',
    '  STATUS: active',
    '  GIVER: Farmer Hemwick @ Crestwood Mill',
    '  ACCEPTED: 08:00 AM, Day 1',
    '  DEADLINE: 08:00 AM, Day 2',
    '  FRUSTRATION_COEFF: 1.0',
    '  OBJ_ACTIVE: Collect mushrooms [4/6]',
    '  OBJ_COMPLETED: Ask about the wolf',
    '  OBJ_ACTIVE: Bring a lantern (optional)',
    '  REWARD: 100 GP',
]

/**
 * The same quest with a different status.
 *
 * Written as a replacement rather than an extra line because `parseQuestsFromText`
 * takes the *first* value for a label — appending a second `STATUS:` changes
 * nothing, which is a good property of the parser and a trap for a fixture.
 */
function withStatus(lines: string[], status: string): Quest {
    return quest(...lines.map((line) => (/^\s*STATUS:/.test(line) ? `  STATUS: ${status}` : line)))
}

const ALL_ON = { showDeadlines: true, showFrustration: true, showArchive: true }

describe('buildQuestCardView', () => {
    it('carries the quest across unchanged where it needs no arithmetic', () => {
        const card = buildQuestCardView(quest(...SHEEP), '08:00 AM, Day 1', ALL_ON)
        expect(card.id).toBe('quest_1')
        expect(card.title).toBe('The Missing Sheep')
        expect(card.giverName).toBe('Farmer Hemwick')
        expect(card.giverLocation).toBe('Crestwood Mill')
        expect(card.rewards).toEqual(['100 GP'])
    })

    describe('the status badge', () => {
        const labelFor = (status: string) =>
            buildQuestCardView(quest('QUEST: X', `  STATUS: ${status}`), '', ALL_ON)

        it('spells the four statuses out', () => {
            expect(labelFor('active').statusLabel).toBe('Active')
            expect(labelFor('completed').statusLabel).toBe('Completed')
            expect(labelFor('failed').statusLabel).toBe('Failed')
            expect(labelFor('past deadline').statusLabel).toBe('Past Deadline')
        })

        it('gives past deadline the failed styling, since that is what it is', () => {
            expect(labelFor('past deadline').tone).toBe('failed')
        })

        it('reads a status it does not know as active rather than dropping the quest', () => {
            const card = labelFor('on hold')
            expect(card.tone).toBe('active')
            // The badge falls back, but the raw word survives for anything else
            // that reads it.
            expect(card.status).toBe('on hold')
        })
    })

    describe('objectives', () => {
        const card = buildQuestCardView(quest(...SHEEP), '08:00 AM, Day 1', ALL_ON)

        it('ticks the completed one and leaves the rest open', () => {
            expect(card.objectives.map((o) => o.icon)).toEqual(['○', '✓', '○'])
        })

        it('shows a counter on an open objective', () => {
            expect(card.objectives[0]!.progress).toBe('4/6')
        })

        it('marks the optional one, and only that one', () => {
            expect(card.objectives.map((o) => o.required)).toEqual([true, true, false])
        })

        it('ticks every objective of a completed quest, because the model rarely goes back to', () => {
            const done = buildQuestCardView(withStatus(SHEEP, 'completed'), '', ALL_ON)
            expect(done.objectives.map((o) => o.done)).toEqual([true, true, true])
        })

        it('leaves a failed objective failed even when the quest completed', () => {
            const mixed = buildQuestCardView(
                quest('QUEST: X', '  STATUS: completed', '  OBJ_FAILED: Save the horse', '  OBJ_ACTIVE: Ride on'),
                '',
                ALL_ON,
            )
            expect(mixed.objectives.map((o) => [o.done, o.failed])).toEqual([
                [false, true],
                [true, false],
            ])
        })

        it('drops the counter once an objective is done — a tick and a 4/6 contradict each other', () => {
            const done = buildQuestCardView(withStatus(SHEEP, 'completed'), '', ALL_ON)
            expect(done.objectives.every((o) => o.progress === '')).toBe(true)
        })

        it('shows a bare count when the total is unknown', () => {
            const card = buildQuestCardView(quest('QUEST: X', '  OBJ_ACTIVE: Gather herbs [3/9]'), '', ALL_ON)
            expect(card.objectives[0]!.progress).toBe('3/9')

            // A total with no progress reads as nothing rather than as `/6`.
            const totalOnly = buildQuestCardView(
                quest('QUEST: X', '  OBJ_ACTIVE: Gather herbs', '  OBJ_TOTAL: 6'),
                '',
                ALL_ON,
            )
            expect(totalOnly.objectives[0]!.progress).toBe('')
        })
    })

    describe('the mood bar', () => {
        const at = (time: string, settings = ALL_ON) => buildQuestCardView(quest(...SHEEP), time, settings)

        it('starts at the far left when the quest was just accepted', () => {
            expect(at('08:00 AM, Day 1').mood).toMatchObject({ value: -1, fillPercent: 0 })
        })

        it('sits at the neutral tick when the deadline is reached', () => {
            // The two ticks the bar draws are at a third and two thirds, so
            // these two numbers are what make the bar readable at all.
            expect(at('08:00 AM, Day 2').mood).toMatchObject({ value: 0, fillPercent: 33 })
        })

        it('sits at the deadline tick a full window past the deadline', () => {
            expect(at('08:00 AM, Day 3').mood).toMatchObject({ value: 1, fillPercent: 67 })
        })

        it('pins at the end rather than running off it', () => {
            const late = at('08:00 AM, Day 9')
            expect(late.mood!.value).toBeGreaterThan(2)
            expect(late.mood!.fillPercent).toBe(100)
        })

        it('names the giver when frustration is on, and the clock when it is off', () => {
            // Three quarters of the way to the deadline.
            expect(at('02:00 AM, Day 2').mood!.label).toBe('Pleased')
            expect(at('02:00 AM, Day 2', { ...ALL_ON, showFrustration: false }).mood!.label).toBe('Ahead of Schedule')
        })

        it('puts the number in the tooltip, since the bar only shows a position', () => {
            expect(at('08:00 AM, Day 2').mood!.title).toBe('NPC Mood: Neutral (+0.00)')
            expect(at('08:00 AM, Day 2', { ...ALL_ON, showFrustration: false }).mood!.title).toBe(
                'Time Progress: Ahead of Schedule',
            )
        })

        it('has no mood on an emergent quest — nobody is waiting on it', () => {
            const own = buildQuestCardView(
                quest('QUEST: X', '  GIVER: Self', '  ACCEPTED: 08:00 AM, Day 1', '  DEADLINE: 08:00 AM, Day 2'),
                '08:00 AM, Day 2',
                ALL_ON,
            )
            expect(own.emergent).toBe(true)
            expect(own.mood).toBeNull()
        })

        it('has no mood without a usable deadline', () => {
            const open = buildQuestCardView(
                quest('QUEST: X', '  GIVER: Hemwick @ Mill', '  ACCEPTED: 08:00 AM, Day 1', '  DEADLINE: none'),
                '08:00 AM, Day 2',
                ALL_ON,
            )
            expect(open.mood).toBeNull()
        })

        it('draws the bar frozen and unlabelled on a finished quest', () => {
            // `computeFrustration` gives up on a non-active quest, and a mood
            // label on something already over would be a claim about nothing.
            const done = buildQuestCardView(withStatus(SHEEP, 'completed'), '08:00 AM, Day 2', ALL_ON)
            expect(done.mood).toMatchObject({ label: '', value: 0, title: '' })
        })
    })

    describe('the time rows', () => {
        it('says how long ago the quest was taken', () => {
            const card = buildQuestCardView(quest(...SHEEP), '02:00 PM, Day 2', ALL_ON)
            expect(card.accepted).toEqual({ time: '08:00 AM, Day 1', elapsed: '1 day 6 hours ago' })
        })

        it('counts down to the deadline, and then up past it', () => {
            expect(buildQuestCardView(quest(...SHEEP), '06:00 AM, Day 2', ALL_ON).deadline).toEqual({
                time: '08:00 AM, Day 2',
                remaining: '2 hours left',
                overdue: false,
            })
            expect(buildQuestCardView(quest(...SHEEP), '11:00 AM, Day 2', ALL_ON).deadline).toEqual({
                time: '08:00 AM, Day 2',
                remaining: '3 hours ago',
                overdue: true,
            })
        })

        it('still names the times when the clock cannot be read', () => {
            // No [TIME] block yet is the normal state of a fresh chat. The
            // quest's own labels are still worth showing; only the gap is not.
            const card = buildQuestCardView(quest(...SHEEP), '', ALL_ON)
            expect(card.accepted).toEqual({ time: '08:00 AM, Day 1', elapsed: '' })
            expect(card.deadline).toMatchObject({ time: '08:00 AM, Day 2', remaining: '' })
        })

        it('hides the deadline row when deadlines are switched off', () => {
            const card = buildQuestCardView(quest(...SHEEP), '08:00 AM, Day 2', { ...ALL_ON, showDeadlines: false })
            expect(card.deadline).toBeNull()
            // The mood itself is unaffected: it is the renderer that keeps the
            // bar inside the deadline row.
            expect(card.mood).not.toBeNull()
        })

        it('has no accepted row when the quest never recorded one', () => {
            expect(buildQuestCardView(quest('QUEST: X'), '08:00 AM, Day 2', ALL_ON).accepted).toBeNull()
        })
    })
})

describe('buildQuestLogView', () => {
    const LOG = [
        ...SHEEP,
        'QUEST: The Rat Cellar',
        '  ID: quest_2',
        '  STATUS: completed',
        'QUEST: The Burned Bridge',
        '  ID: quest_3',
        '  STATUS: failed',
        'QUEST: The Late Delivery',
        '  ID: quest_4',
        '  STATUS: past deadline',
    ]
    const quests = parseQuestsFromText(LOG.join('\n'))

    it('separates what is being done from what is over', () => {
        const log = buildQuestLogView(quests, '08:00 AM, Day 2', ALL_ON)
        expect(log.active.map((q) => q.id)).toEqual(['quest_1'])
        expect(log.completed.map((q) => q.id)).toEqual(['quest_2'])
        expect(log.failed.map((q) => q.id)).toEqual(['quest_3', 'quest_4'])
    })

    it('counts only the active ones — the archive is history, not a workload', () => {
        expect(buildQuestLogView(quests, '', ALL_ON).activeCount).toBe(1)
    })

    it('drops the archive entirely when it is switched off', () => {
        const log = buildQuestLogView(quests, '', { ...ALL_ON, showArchive: false })
        expect(log.completed).toEqual([])
        expect(log.failed).toEqual([])
        expect(log.active).toHaveLength(1)
    })

    it('survives an empty log and a missing one alike', () => {
        for (const input of [[], null, undefined]) {
            expect(buildQuestLogView(input, '', ALL_ON)).toEqual({
                active: [],
                completed: [],
                failed: [],
                activeCount: 0,
            })
        }
    })
})
