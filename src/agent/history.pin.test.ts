/**
 * Campaign ownership and undo bookkeeping, against the pinned legacy build.
 *
 * This is the layer that decides which of a user's lorebooks the agent may
 * write to, and which books an undo is allowed to *delete*. Getting either
 * wrong destroys work that has nothing to do with this extension, so both are
 * checked against the legacy rather than believed.
 *
 * Opt-in, like the other `.pin` tests. To run it:
 *
 *   git clone --filter=blob:none \
 *     https://github.com/MultihogAurelius/SillyTavern-MultihogDnDFramework /tmp/mh
 *   git -C /tmp/mh checkout d6aab004f97f1f9a286f235de62f22ba1abadbe8
 *   MULTIHOG_CHECKOUT=/tmp/mh npx vitest run src/agent/history.pin.test.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { bookBelongsToCampaign, sanitizeCampaignPrefix } from './campaign.js'
import {
    findHistoryIndexForChat,
    getCreatedBookNames,
    getSnapshotBookNames,
    isHistoryEntryForChat,
    trimHistoryForRollback,
    type LoreHistoryEntry,
} from './history.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available =
    !!checkout &&
    existsSync(`${checkout}/src/state/lorebook-history.js`) &&
    existsSync(`${checkout}/src/state/settings.js`)

interface Legacy {
    bookBelongsToCampaignPrefix(bookName: string, prefix: string): boolean
    getLorebookSnapshotNames(snapshot: unknown): string[]
    isLoreHistoryEntryForChat(entry: unknown, scope: unknown): boolean
    findLoreHistoryIndexForChat(history: unknown, scope: unknown): number
    trimLoreHistoryForRollback(history: unknown, index: number): unknown[]
    getCreatedLorebookNames(input: unknown): string[]
    sanitizeCampaignPrefixString(raw: string): string
}

describe.skipIf(!available)('campaign ownership and undo against the pinned legacy build', () => {
    const legacy: Legacy = (() => {
        if (!available) return {} as Legacy

        const history = readFileSync(`${checkout}/src/state/lorebook-history.js`, 'utf8')
        const settings = readFileSync(`${checkout}/src/state/settings.js`, 'utf8')

        const slice = (source: string, from: string, to: string): string => {
            const start = source.indexOf(from)
            const end = source.indexOf(to, start)
            if (start === -1 || end === -1) throw new Error(`upstream no longer contains: ${from}`)
            return source.slice(start, end)
        }

        const body = [
            // The whole history module — every function in it is under test.
            history,
            slice(settings, 'export function sanitizeCampaignPrefixString', '/**\n * Prefix used for world activation'),
        ]
            .join('\n')
            .replace(/^\s*export /gm, '')

        const names = [
            'bookBelongsToCampaignPrefix',
            'getLorebookSnapshotNames',
            'isLoreHistoryEntryForChat',
            'findLoreHistoryIndexForChat',
            'trimLoreHistoryForRollback',
            'getCreatedLorebookNames',
            'sanitizeCampaignPrefixString',
        ]
        return new Function(`${body}\nreturn { ${names.join(', ')} }`)() as Legacy
    })()

    describe('sanitizing a name the user typed', () => {
        it.each([
            'Vellmoor',
            'Vellmoor: Book II',
            '  spaced  out  ',
            '___leading and trailing___',
            'punctuation!!!everywhere???',
            'ünïcodé náme',
            '12345',
            '!!!',
            '',
        ])('agrees on %j', (raw) => {
            expect(sanitizeCampaignPrefix(raw)).toBe(legacy.sanitizeCampaignPrefixString(raw))
        })
    })

    describe('deciding whether a book belongs to a campaign', () => {
        const PREFIX = 'Vellmoor'
        it.each([
            ['the root book itself', 'Vellmoor'],
            ['the root in another case', 'vellmoor'],
            ['one segment below', 'Vellmoor_NPCs'],
            ['one segment, different case', 'VELLMOOR_npcs'],
            ['two segments below', 'Vellmoor_NPCs_Old'],
            ['no separator', 'VellmoorNPCs'],
            ['a different campaign', 'Ashfell_NPCs'],
            ['a longer name that starts the same', 'VellmoorTwo'],
            ["somebody else's book", 'My World Bible'],
            ['an empty name', ''],
        ])('agrees on %s', (_label, book) => {
            expect(bookBelongsToCampaign(book, PREFIX)).toBe(legacy.bookBelongsToCampaignPrefix(book, PREFIX))
        })

        it('agrees that nothing belongs to an empty prefix', () => {
            expect(bookBelongsToCampaign('Vellmoor', '')).toBe(
                legacy.bookBelongsToCampaignPrefix('Vellmoor', ''),
            )
        })

        it('DIVERGES: a bare trailing separator is not a campaign book here', () => {
            // The legacy claims `Vellmoor_` for the campaign: it strips the
            // prefix and its underscore, gets an empty leaf, and an empty leaf
            // contains no underscore so the check passes. Found by this test on
            // its first run.
            //
            // Kept narrower on purpose, in the safe direction. Our own
            // sanitizer strips trailing underscores, so this build can never
            // *create* such a book — the only way one exists is that the user
            // made it by hand. Claiming it would mean the agent may write to a
            // book it did not make, and an undo may delete it. Refusing costs
            // nothing and is exactly the guarantee the maintainer asked for.
            expect(legacy.bookBelongsToCampaignPrefix('Vellmoor_', 'Vellmoor')).toBe(true)
            expect(bookBelongsToCampaign('Vellmoor_', 'Vellmoor')).toBe(false)
        })
    })

    describe('the names a snapshot speaks for', () => {
        it.each([
            ['an empty snapshot', {}],
            ['captured books only', { bookSnapshots: { A: {}, B: {} } }],
            ['named books only', { campaignBookNames: ['A', 'B'] }],
            ['owned books only', { campaignBooks: ['A', 'C'] }],
            [
                'all three, overlapping',
                { bookSnapshots: { A: {} }, campaignBookNames: ['A', 'B'], campaignBooks: ['C'] },
            ],
            ['an empty string among the owned', { campaignBooks: ['', 'A'] }],
        ])('agrees on %s', (_label, snapshot) => {
            expect(getSnapshotBookNames(snapshot).sort()).toEqual(
                legacy.getLorebookSnapshotNames(snapshot).sort(),
            )
        })
    })

    describe('scoping a history entry to a chat', () => {
        const CASES: Array<[string, unknown, unknown]> = [
            ['matching chat ids', { chatId: 'c1' }, { chatId: 'c1' }],
            ['different chat ids', { chatId: 'c1' }, { chatId: 'c2' }],
            ['no chat id on the entry, prefixes agree', { campaignPrefix: 'Vell' }, { campaignPrefix: 'Vell' }],
            ['no chat id, prefixes differ', { campaignPrefix: 'Vell' }, { campaignPrefix: 'Ashfell' }],
            ['no chat id, prefix case differs', { campaignPrefix: 'VELL' }, { campaignPrefix: 'vell' }],
            ['entry has a chat id, scope does not', { chatId: 'c1' }, { campaignPrefix: 'Vell' }],
            ['scope has a chat id, entry does not', { campaignPrefix: 'Vell' }, { chatId: 'c1' }],
            ['neither has anything', {}, {}],
            ['a null entry', null, { chatId: 'c1' }],
            ['an empty-string chat id on the entry', { chatId: '' }, { chatId: 'c1' }],
            [
                'both a chat id and a prefix, chat ids differ',
                { chatId: 'c1', campaignPrefix: 'Vell' },
                { chatId: 'c2', campaignPrefix: 'Vell' },
            ],
        ]

        it.each(CASES)('agrees on %s', (_label, entry, scope) => {
            expect(isHistoryEntryForChat(entry as LoreHistoryEntry, scope as never)).toBe(
                legacy.isLoreHistoryEntryForChat(entry, scope),
            )
        })
    })

    describe('finding and trimming history for a rollback', () => {
        // Two campaigns interleaved, which is the case the per-chat scoping
        // exists for and the one a naive splice gets wrong.
        const HISTORY: LoreHistoryEntry[] = [
            { chatId: 'c2', campaignPrefix: 'Ashfell' },
            { chatId: 'c1', campaignPrefix: 'Vell' },
            { chatId: 'c2', campaignPrefix: 'Ashfell' },
            { chatId: 'c1', campaignPrefix: 'Vell' },
            { campaignPrefix: 'Vell' },
        ]

        it.each([
            ['the first chat', { chatId: 'c1', campaignPrefix: 'Vell' }],
            ['the second chat', { chatId: 'c2', campaignPrefix: 'Ashfell' }],
            ['a chat with no entries', { chatId: 'c9', campaignPrefix: 'Nowhere' }],
            ['a prefix-only scope', { campaignPrefix: 'Vell' }],
        ])('agrees on the index for %s', (_label, scope) => {
            expect(findHistoryIndexForChat(HISTORY, scope)).toBe(
                legacy.findLoreHistoryIndexForChat(HISTORY, scope),
            )
        })

        it.each([[-1], [0], [1], [2], [3], [4], [5], [99]])('agrees on the trim at index %i', (index) => {
            expect(trimHistoryForRollback(HISTORY, index)).toEqual(
                legacy.trimLoreHistoryForRollback(HISTORY, index),
            )
        })
    })

    describe('deciding which books an undo may delete', () => {
        const CASES: Array<[string, Record<string, unknown>]> = [
            [
                'a snapshot that says exactly what it created',
                {
                    snapshot: { createdBookNames: ['Vell_NPCs'], campaignBooks: ['Vell'] },
                    currentNames: ['Vell', 'Vell_NPCs'],
                    prefix: 'Vell',
                },
            ],
            [
                'a created book that no longer exists',
                {
                    snapshot: { createdBookNames: ['Vell_Gone'] },
                    currentNames: ['Vell'],
                    prefix: 'Vell',
                },
            ],
            [
                'a created book that was in the baseline after all',
                {
                    snapshot: { createdBookNames: ['Vell_NPCs'], campaignBooks: ['Vell_NPCs'] },
                    currentNames: ['Vell_NPCs'],
                    prefix: 'Vell',
                },
            ],
            [
                'a created book outside the campaign',
                {
                    snapshot: { createdBookNames: ['Someone_Elses_Book'] },
                    currentNames: ['Someone_Elses_Book'],
                    prefix: 'Vell',
                },
            ],
            [
                'an older snapshot, falling back to the pass log',
                {
                    snapshot: { routerLog: [{ record: ['Vell::1'] }], campaignBooks: ['Vell'] },
                    currentNames: ['Vell', 'Vell_NPCs'],
                    currentRouterLog: [{ record: ['Vell_NPCs::4'] }, { record: ['Vell::1'] }],
                    prefix: 'Vell',
                },
            ],
            [
                'an oldest snapshot, with no log at all',
                {
                    snapshot: { campaignBooks: ['Vell'] },
                    currentNames: ['Vell', 'Vell_LOC'],
                    currentRouterLog: [{ record: ['Vell_LOC::2'] }],
                    historyIndex: 0,
                    prefix: 'Vell',
                },
            ],
            [
                'a book the user made that merely matches the prefix',
                {
                    snapshot: { campaignBookNames: ['Vell'], campaignBooks: ['Vell'] },
                    currentNames: ['Vell', 'Vell_Mine'],
                    currentRouterLog: [],
                    prefix: 'Vell',
                },
            ],
            ['nothing at all', {}],
        ]

        it.each(CASES)('agrees on %s', (_label, input) => {
            // Our field names differ from the legacy's (`passLog` for
            // `routerLog`), so the input is translated rather than shared —
            // the *decision* is what is under test, not the spelling.
            const ours = getCreatedBookNames({
                snapshot: {
                    ...(input.snapshot as object),
                    passLog: (input.snapshot as { routerLog?: [] })?.routerLog,
                },
                currentNames: input.currentNames as string[],
                currentPassLog: input.currentRouterLog as [],
                historyIndex: input.historyIndex as number,
                prefix: input.prefix as string,
            })
            expect(ours.sort()).toEqual(legacy.getCreatedLorebookNames(input).sort())
        })
    })
})
