/**
 * The quest grammar, differentially tested against the legacy build itself.
 *
 * Quest records are user data with a long life — a campaign's quest log
 * accumulates for months — so "we believe this matches" is not good enough. This
 * lifts the legacy quest functions straight out of `memo-processor.js` at the
 * pinned commit and runs both implementations over the same corpus: the format
 * the extractor prompt documents, the malformed shapes a model actually
 * produces, the emergent-quest special cases, and the deadline arithmetic.
 *
 * Where the legacy read `getSettings()` mid-function, the stub below supplies
 * the same values this port takes as arguments — so what is compared is the
 * grammar, with the host reach that the port removed held constant.
 *
 * Opt-in, like the other `.pin` tests. To run it:
 *
 *   git clone --filter=blob:none \
 *     https://github.com/MultihogAurelius/SillyTavern-MultihogDnDFramework /tmp/mh
 *   git -C /tmp/mh checkout d6aab004f97f1f9a286f235de62f22ba1abadbe8
 *   MULTIHOG_CHECKOUT=/tmp/mh npx vitest run src/tracker/quests.pin.test.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { formatTimeDiff, parseInWorldTime } from './time.js'
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

const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && existsSync(`${checkout}/memo-processor.js`)

/** The clock both implementations see, so a generated quest id is comparable. */
const FIXED_NOW = 1_746_703_200_000

interface Legacy {
    parseQuestsFromText(text: string): Quest[]
    parseQuestsFromMemo(memo: string): Quest[]
    serializeQuestsToText(quests: Quest[]): string
    writeQuestsToMemo(quests: Quest[], memo: string): string
    stripArchivedQuestsFromMemo(memo: string): string
    applyQuestSyncAndStripMemo(memo: string): string
    isArchivedQuestStatus(status: string): boolean
    isEmergentQuest(quest: unknown): boolean
    questHasEffectiveDeadline(quest: unknown): boolean
    parseInWorldTime(str: string): number | null
    formatTimeDiff(diffMinutes: number, isFuture: boolean): string
    getQuestMood(quest: unknown, currentTime: string, show: boolean): { label: string }
    setSettings(next: Record<string, unknown>): void
}

describe.skipIf(!available)('the quest grammar against the pinned legacy build', () => {
    const source = available ? readFileSync(`${checkout}/memo-processor.js`, 'utf8') : ''

    const slice = (from: string, to: string): string => {
        const start = source.indexOf(from)
        const end = source.indexOf(to, start)
        if (start === -1 || end === -1) throw new Error(`memo-processor.js no longer contains: ${from}`)
        return source.slice(start, end)
    }

    const legacy: Legacy = (() => {
        if (!available) return {} as Legacy
        const body = [
            // computeFrustrationLocal + getQuestMood
            slice('function computeFrustrationLocal', 'export function escapeRegex'),
            slice('export function escapeRegex', 'export function escapeHtml'),
            slice('export function extractCurrentTimeStr', '/** Replace the current-time line'),
            // isRestTimeUnset, parseInWorldTime, NO_DEADLINE_SENTINELS,
            // questHasEffectiveDeadline, EMERGENT_GIVER_RE, isEmergentQuest,
            // and formatTimeDiff, which the quest card draws its two time rows with
            slice('export function isRestTimeUnset', '// ── Memo deduplication'),
            slice('export function writeQuestsToMemo', '/**\n * @deprecated Use writeQuestsToMemo'),
            // isArchivedQuestStatus, splitQuestTextBlocks,
            // questTextBlockIsArchived, stripArchivedQuestsFromMemo
            slice('export function isArchivedQuestStatus', '/** @deprecated Use stripArchivedQuestsFromMemo */'),
            // parseQuestsFromText, serializeQuestsToText, parseQuestsFromMemo
            slice('export function parseQuestsFromText', '/**\n * Parses the [QUESTS] block from a text string and updates settings.quests.'),
            slice('export function applyQuestSyncAndStripMemo', '/**\n * Removes a completed/failed quest'),
        ]
            .join('\n')
            .replace(/^\s*export /gm, '')

        return eval(`(function () {
            let settings = { currentMemo: '', quests: [], syspromptModules: {} };
            const getSettings = () => settings;
            // The one call applyQuestSyncAndStripMemo makes that this port
            // replaced with a return value rather than a settings write.
            const syncQuestsFromMemo = (memoText) => { settings.quests = parseQuestsFromMemo(memoText); };
            ${body}
            return {
                parseQuestsFromText, parseQuestsFromMemo, serializeQuestsToText,
                writeQuestsToMemo: (quests, memo) => writeQuestsToMemo(quests, memo),
                stripArchivedQuestsFromMemo, applyQuestSyncAndStripMemo,
                isArchivedQuestStatus, isEmergentQuest, questHasEffectiveDeadline,
                parseInWorldTime, formatTimeDiff, getQuestMood,
                setSettings: (next) => { settings = { ...settings, ...next }; },
            };
        })`)()
    })()

    beforeAll(() => {
        // Both sides read Date.now() for the fallback quest id.
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(FIXED_NOW)
    })
    afterAll(() => { vi.useRealTimers() })

    // ── the corpus ────────────────────────────────────────────────────────

    const STOCK = [
        'QUEST: The Missing Sheep',
        '  ID: quest_1746703200000',
        '  STATUS: active',
        '  GIVER: Farmer Hemwick @ Crestwood Mill',
        '  ACCEPTED: 08:00 AM, Day 1',
        '  DEADLINE: 06:00 PM, Day 4',
        '  REWARD: 100 GP',
        "  REWARD: Hemwick's family heirloom",
        '  FRUSTRATION_COEFF: 1.2',
        '  OBJ_ACTIVE: Find the missing sheep',
        '  OBJ_ACTIVE: Collect 6 Phosphor-Cap mushrooms [4/6]',
        '  OBJ_TOTAL: 6',
        '  OBJ_COMPLETED: Ask about the wolf',
        '  OBJ_FAILED: Save the lamb',
    ].join('\n')

    const BLOCKS: Record<string, string> = {
        'the format the prompt documents': STOCK,

        'an emergent quest, by TYPE': [
            'QUEST: Find my sister',
            '  ID: q_em',
            '  STATUS: active',
            '  TYPE: emergent',
            '  GIVER: Self @ —',
            '  OBJ_ACTIVE: Search the docks',
        ].join('\n'),

        'an emergent quest, by giver name alone': [
            'QUEST: Learn to swim',
            '  ID: q_em2',
            '  GIVER: {{user}} @ Anywhere',
            '  FRUSTRATION_COEFF: 2.0',
            '  OBJ_ACTIVE: Get in the water',
        ].join('\n'),

        'an emergent quest, by EMERGENT: yes': [
            'QUEST: Settle the score',
            '  ID: q_em3',
            '  EMERGENT: yes',
            '  GIVER: Ansel @ The Bridge',
        ].join('\n'),

        'several quests, one of them finished': [STOCK, [
            'QUEST: The Rat Cellar',
            '  ID: q_done',
            '  STATUS: completed',
            '  GIVER: Innkeeper @ The Bell',
            '  OBJ_COMPLETED: Clear the cellar',
        ].join('\n')].join('\n\n'),

        'every archived status at once': [
            'QUEST: A\n  ID: a\n  STATUS: completed\n  GIVER: X @ Y',
            'QUEST: B\n  ID: b\n  STATUS: failed\n  GIVER: X @ Y',
            'QUEST: C\n  ID: c\n  STATUS: past deadline\n  GIVER: X @ Y\n  ACCEPTED: Day 1\n  DEADLINE: Day 2',
            'QUEST: D\n  ID: d\n  STATUS: active\n  GIVER: X @ Y',
        ].join('\n\n'),

        'comma-separated objectives on one line': [
            'QUEST: Errands',
            '  ID: q_commas',
            '  GIVER: Steward @ Keep',
            '  OBJ_ACTIVE: Buy rope (required), Feed the horse (optional), Sharpen the axe (required)',
        ].join('\n'),

        'a comma in an objective that is not a separator': [
            'QUEST: Diplomacy',
            '  ID: q_comma2',
            '  GIVER: Envoy @ Court',
            '  OBJ_ACTIVE: Speak to Aldric, then to Mira (required)',
        ].join('\n'),

        'OBJ_TOTAL without an inline counter': [
            'QUEST: Gathering',
            '  ID: q_total',
            '  GIVER: Herbalist @ Grove',
            '  OBJ_ACTIVE: Collect roots',
            '  OBJ_TOTAL: 12',
        ].join('\n'),

        'OBJ_DONE, the older spelling': [
            'QUEST: Old save',
            '  ID: q_old',
            '  GIVER: Someone @ Somewhere',
            '  OBJ_DONE: A finished thing',
            '  OBJ_ACTIVE: An unfinished thing',
        ].join('\n'),

        'no fields at all beyond the title': 'QUEST: A bare quest',

        'a title and nothing parseable': 'QUEST: Mystery\n  this line is not a field\n  neither: is this really',

        'a deadline the model wrote as "none"': [
            'QUEST: Open-ended',
            '  ID: q_nodl',
            '  GIVER: Elder @ Village',
            '  ACCEPTED: 08:00 AM, Day 1',
            '  DEADLINE: none',
        ].join('\n'),

        'a deadline before the accepted time': [
            'QUEST: Impossible',
            '  ID: q_bad',
            '  GIVER: Trickster @ Crossroads',
            '  ACCEPTED: 08:00 AM, Day 5',
            '  DEADLINE: 08:00 AM, Day 2',
        ].join('\n'),

        'calendar dates rather than day numbers': [
            'QUEST: The Long Wait',
            '  ID: q_cal',
            '  GIVER: Archivist @ Library',
            '  ACCEPTED: 08:00 AM, 01/01/2026',
            '  DEADLINE: 06:00 PM, 15/01/2026',
            '  FRUSTRATION_COEFF: 0.4',
        ].join('\n'),

        'a coefficient that is not a number': [
            'QUEST: Nonsense',
            '  ID: q_nan',
            '  GIVER: Someone @ Somewhere',
            '  FRUSTRATION_COEFF: very patient',
        ].join('\n'),

        'no ID line, so one gets generated': [
            'QUEST: Unnamed',
            '  STATUS: active',
            '  GIVER: Stranger @ Road',
        ].join('\n'),

        'duplicate field lines — first wins': [
            'QUEST: Contradictory',
            '  ID: q_dupe',
            '  STATUS: active',
            '  STATUS: completed',
            '  GIVER: A @ B',
            '  GIVER: C @ D',
        ].join('\n'),
    }

    const entries = Object.entries(BLOCKS)

    it.each(entries)('parses %s the same way', (_name, block) => {
        expect(parseQuestsFromText(block)).toEqual(legacy.parseQuestsFromText(block))
    })

    it.each(entries)('round-trips %s to the same text', (_name, block) => {
        const quests = legacy.parseQuestsFromText(block)
        expect(serializeQuestsToText(quests)).toBe(legacy.serializeQuestsToText(quests))
    })

    it.each(entries)('strips archived quests from %s identically', (_name, block) => {
        const memo = `[TIME]\n06:15 PM, Day 3\n[/TIME]\n\n[QUESTS]\n${block}\n[/QUESTS]\n\n[XP]\n40/100\n[/XP]`
        expect(stripArchivedQuestsFromMemo(memo)).toBe(legacy.stripArchivedQuestsFromMemo(memo))
    })

    it.each(entries)('reads %s out of a whole memo identically', (_name, block) => {
        const memo = `[TIME]\n06:15 PM, Day 3\n[/TIME]\n\n[QUESTS]\n${block}\n[/QUESTS]`
        expect(parseQuestsFromMemo(memo)).toEqual(legacy.parseQuestsFromMemo(memo))
    })

    it.each(entries)('writes %s back into a memo identically', (_name, block) => {
        const memo = `[TIME]\n06:15 PM, Day 3\n[/TIME]\n\n[QUESTS]\n${block}\n[/QUESTS]`
        const quests = legacy.parseQuestsFromMemo(memo)
        legacy.setSettings({ currentMemo: memo, syspromptModules: { questsFrustration: false } })
        expect(writeQuestsToMemo(quests, memo)).toBe(legacy.writeQuestsToMemo(quests, memo))
    })

    // ── memo-level shapes ─────────────────────────────────────────────────

    const MEMOS: Record<string, string> = {
        'no quest block at all': '[TIME]\n06:15 PM, Day 3\n[/TIME]',
        'an empty quest block': '[TIME]\nDay 1\n[/TIME]\n\n[QUESTS]\n\n[/QUESTS]',
        'a quest block holding prose': '[QUESTS]\nThe hero owes a favour to the smith.\n[/QUESTS]',
        'the older JSON format': `[QUESTS]\n${JSON.stringify(
            [
                { id: 'j1', title: 'JSON one', status: 'active', giver_name: 'A', giver_location: 'B' },
                { id: 'j2', title: 'JSON two', status: 'completed', giver_name: 'C', giver_location: 'D' },
            ],
            null,
            2,
        )}\n[/QUESTS]`,
        'JSON under a quests key': `[QUESTS]\n${JSON.stringify({
            quests: [{ id: 'j3', title: 'Wrapped', status: 'failed', giver_name: 'E', giver_location: 'F' }],
        })}\n[/QUESTS]`,
        'JSON that does not parse': '[QUESTS]\n{ this is not json\n[/QUESTS]',
        'every quest finished, so the block goes': [
            '[TIME]',
            'Day 9',
            '[/TIME]',
            '',
            '[QUESTS]',
            'QUEST: Done\n  ID: z1\n  STATUS: completed\n  GIVER: X @ Y',
            '',
            'QUEST: Also done\n  ID: z2\n  STATUS: failed\n  GIVER: X @ Y',
            '[/QUESTS]',
        ].join('\n'),
    }

    const memoEntries = Object.entries(MEMOS)

    it.each(memoEntries)('parses a memo with %s identically', (_name, memo) => {
        expect(parseQuestsFromMemo(memo)).toEqual(legacy.parseQuestsFromMemo(memo))
    })

    it.each(memoEntries)('strips a memo with %s identically', (_name, memo) => {
        expect(stripArchivedQuestsFromMemo(memo)).toBe(legacy.stripArchivedQuestsFromMemo(memo))
    })

    it.each(memoEntries)('syncs a memo with %s identically', (_name, memo) => {
        legacy.setSettings({ currentMemo: memo, quests: [], syspromptModules: { questsFrustration: false } })
        expect(applyQuestSync(memo).memo).toBe(legacy.applyQuestSyncAndStripMemo(memo))
    })

    it('syncs the documented format identically, moods and all', () => {
        const memo = `[TIME]\n06:15 PM, Day 3\n[/TIME]\n\n[QUESTS]\n${STOCK}\n[/QUESTS]`
        legacy.setSettings({ currentMemo: memo, quests: [], syspromptModules: { questsFrustration: true } })

        const ours = applyQuestSync(memo, { showFrustration: true, currentTime: '06:15 PM, Day 3' })
        expect(ours.memo).toBe(legacy.applyQuestSyncAndStripMemo(memo))
        expect(ours.memo).toContain('MOOD:')
    })

    // ── the arithmetic underneath ─────────────────────────────────────────

    const TIMES = [
        '08:00 AM, Day 1', '06:00 PM, Day 4', 'Day 4', '10:00 PM', '12:00 AM, Day 2', '12:00 PM, Day 2',
        '08:00 AM, 01/01/2026', '06:00 PM, 15/01/2026', '01/01/26', 'D7 03:45', 'none', 'N/A', '—', '',
        'nothing here', '[TIME]\n06:15 AM, Day 4\nLast rest: Day 3\n[/TIME]',
    ]

    it.each(TIMES)('reads the in-world time %j identically', (label) => {
        expect(parseInWorldTime(label)).toBe(legacy.parseInWorldTime(label))
    })

    const MOOD_CASES: Array<[string, Partial<Quest>, string]> = [
        ['just accepted', { accepted_time: '08:00 AM, Day 1', deadline_time: '08:00 AM, Day 5' }, '08:00 AM, Day 1'],
        ['a quarter through', { accepted_time: '08:00 AM, Day 1', deadline_time: '08:00 AM, Day 5' }, '08:00 AM, Day 2'],
        ['at the deadline', { accepted_time: '08:00 AM, Day 1', deadline_time: '08:00 AM, Day 5' }, '08:00 AM, Day 5'],
        ['well past it', { accepted_time: '08:00 AM, Day 1', deadline_time: '08:00 AM, Day 5' }, '08:00 AM, Day 20'],
        ['a patient giver', { accepted_time: 'Day 1', deadline_time: 'Day 5', frustration_coefficient: 0.4 }, 'Day 3'],
        ['a volatile giver', { accepted_time: 'Day 1', deadline_time: 'Day 5', frustration_coefficient: 3 }, 'Day 3'],
        ['no deadline', { accepted_time: 'Day 1', deadline_time: null }, 'Day 3'],
        ['emergent', { accepted_time: 'Day 1', deadline_time: 'Day 5', emergent: true }, 'Day 3'],
    ]

    it.each(MOOD_CASES)('computes the mood for %s identically', (_name, over, currentTime) => {
        const quest = {
            id: 'q', title: 'T', status: 'active', giver_name: 'Giver', giver_location: 'Place',
            accepted_time: null, deadline_time: null, objectives: [], rewards: [], ...over,
        } as Quest

        for (const show of [true, false]) {
            expect(getQuestMood(quest, currentTime, show).label).toBe(legacy.getQuestMood(quest, currentTime, show).label)
        }
        expect(questHasEffectiveDeadline(quest)).toBe(legacy.questHasEffectiveDeadline(quest))
        expect(isEmergentQuest(quest)).toBe(legacy.isEmergentQuest(quest))
    })

    it.each(['active', 'completed', 'failed', 'past deadline', 'Completed', ' FAILED ', 'abandoned', ''])(
        'agrees whether %j is archived',
        (status) => {
            expect(isArchivedQuestStatus(status)).toBe(legacy.isArchivedQuestStatus(status))
        },
    )

    // The two time rows on a quest card are this function's output, so the
    // wording is user-visible state that has to survive the port unchanged.
    const DIFFS = [
        0, 1, -1, 59, 60, -60, 61, 90, 1439, 1440, -1440, 1441, 2880, -2880,
        1 * 1440 + 6 * 60 + 15, -(1 * 1440 + 6 * 60 + 15), 10080, 100000, -100000,
    ]

    it.each(DIFFS)('phrases a gap of %d minutes identically', (diff) => {
        for (const isFuture of [true, false]) {
            expect(formatTimeDiff(diff, isFuture)).toBe(legacy.formatTimeDiff(diff, isFuture))
        }
    })
})
