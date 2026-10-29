import { describe, expect, it, vi } from 'vitest'

import { createCreator, type CreatorDeps } from './creator.js'
import type { TrackerPassOutcome, TrackerPassRequest } from './tracker-pass.js'

const SHEET = '[CHARACTER]\nRobin Vale (Rogue 3): 22/24 HP\n[/CHARACTER]\n[XP]\nLevel: 3 | XP: 0/2,700\n[/XP]'

function harness(over: Partial<CreatorDeps> = {}, outcome: Partial<TrackerPassOutcome> = {}) {
    let memo = ''
    const runs: TrackerPassRequest[] = []
    const log: string[] = []
    const deps: CreatorDeps = {
        trackerPass: {
            run: vi.fn(async (request: TrackerPassRequest) => {
                runs.push(request)
                memo = SHEET
                return { status: 'updated', memo, delta: { added: ['CHARACTER', 'XP'], replaced: [], removed: [], noChange: false } as never, report: {} as never, ...outcome } as TrackerPassOutcome
            }),
        },
        settings: { load: async () => ({ modules: { character: true, xp: true, time: true, party: true }, customFields: [], useDdMmYyFormat: false }) },
        memos: { load: async () => ({ memo }) },
        prefs: { load: async () => ({ creatorLevel: 3, creatorGearTier: 'standard', creatorCombatScalingGuide: true, creatorInitialDate: 'Day 1', creatorInitialTime: '08:00 AM', creatorConnectionId: 'creator-conn', trackerDirectLookback: 4, creatorPlayerCard: false, creatorPersona: true, creatorCardWords: 150, creatorGenre: 'fantasy' }) },
        log: { info: (m) => log.push(m), warn: (m) => log.push(`warn: ${m}`) },
        now: () => new Date('2026-10-04T10:00:00Z'),
        ...over,
    }
    return { creator: createCreator(deps), runs, log, setMemo: (m: string) => { memo = m } }
}

describe('the character creator', () => {
    it('writes the sheet through the direct pass in modules-only mode on its own connection, and names the character', async () => {
        const { creator, runs, log } = harness()
        const result = await creator.generate({ chatId: 'c1', userId: 'u1', draft: { name: 'Robin Vale', genre: 'fantasy', class: 'Rogue', level: 3 } })
        expect(result).toEqual({ status: 'written', at: '2026-10-04T10:00:00.000Z', name: 'Robin Vale', added: ['CHARACTER', 'XP'], replaced: [] })
        expect(runs).toHaveLength(1)
        expect(runs[0]).toMatchObject({ chatId: 'c1', userId: 'u1', trigger: 'direct', window: 4, systemPromptMode: 'modules_only', connectionId: 'creator-conn', playerName: 'Robin Vale' })
        expect(runs[0]!.instruction).toContain('STARTING LEVEL: 3 (mandatory')
        expect(runs[0]!.instruction).toContain('Name:         Robin Vale')
        expect(runs[0]!.instruction).toContain('Class: Rogue')
        expect(runs[0]!.instruction).toContain('(enabled stock modules and custom fields): CHARACTER, XP, TIME.')
        expect(runs[0]!.instruction).toContain('Current Time: 08:00 AM, Day 1')
        expect(runs[0]!.instruction).toContain('• STARTING GEAR: Standard kit for Level 3')
        expect(runs[0]!.instruction).not.toContain('CHARACTER CARD CONTEXT')
        expect(log[0]).toBe('creator: writing the sheet for chat c1 (Robin Vale, fantasy, level 3, Rogue)')
        expect(log[1]).toBe('creator: wrote the sheet for "Robin Vale": CHARACTER, XP')
    })

    it('starts a blank draft from the preferences, and defers to the tracker\'s connection when none is set', async () => {
        const { creator, runs } = harness({ prefs: { load: async () => ({ creatorLevel: 'none', creatorGearTier: 'heroic', creatorCombatScalingGuide: false, creatorInitialDate: '14/02/2026', creatorInitialTime: '21:30', creatorConnectionId: '', trackerDirectLookback: 0, creatorPlayerCard: false, creatorPersona: true, creatorCardWords: 150, creatorGenre: 'fantasy' }) }, settings: { load: async () => ({ modules: { character: true, time: true }, customFields: [], useDdMmYyFormat: true }) } })
        await creator.generate({ chatId: 'c1', userId: undefined, draft: undefined })
        expect(runs[0]).not.toHaveProperty('connectionId')
        expect(runs[0]!.playerName).toBe('')
        expect(runs[0]!.window).toBe(0)
        expect(runs[0]!.instruction!.startsWith('LEVEL SYSTEM: This character creation system does not use numeric character levels.')).toBe(true)
        expect(runs[0]!.instruction).toContain('Current Time: 21:30, 14/02/2026')
        expect(runs[0]!.instruction).not.toContain('COMBAT & SKILL SCALING GUIDE')
        expect(runs[0]!.instruction).toContain('Elite signature kit for Level 1')
        expect(await creator.defaults('u1')).toEqual({ level: 'none', gearTier: 'heroic', combatScalingGuide: false })
    })

    it('puts the narrator\'s card in the prompt when the host provides one, and goes on without it when the read fails', async () => {
        const { creator, runs } = harness({ card: async () => ({ name: 'Gorm', description: 'A grim narrator.' }) })
        await creator.generate({ chatId: 'c1', userId: 'u1', draft: {} })
        expect(runs[0]!.instruction).toContain('--- CHARACTER CARD CONTEXT ---\nActive Card: Gorm — A grim narrator.')
        const failing = harness({ card: async () => { throw new Error('PERMISSION_DENIED') } })
        expect((await failing.creator.generate({ chatId: 'c1', userId: 'u1', draft: {} })).status).toBe('written')
        expect(failing.runs[0]!.instruction).not.toContain('CHARACTER CARD CONTEXT')
    })

    it('fails when no sheet arrived: a pass that changed nothing, a reply without a [CHARACTER] block, or a pass that failed', async () => {
        const unchanged = harness({ trackerPass: { run: vi.fn(async () => ({ status: 'no-change' as const, reason: 'the tracker model returned an empty reply', memo: '', report: {} as never })) } })
        const result = await unchanged.creator.generate({ chatId: 'c1', userId: 'u1', draft: {} })
        expect(result).toEqual({ status: 'failed', at: '2026-10-04T10:00:00.000Z', name: '', reason: 'Character generation failed — State Model returned no character sheet (the tracker model returned an empty reply). Check your API connection.' })
        expect(unchanged.log.at(-1)).toMatch(/^warn: creator: Character generation failed/)
        const clock = harness({ trackerPass: { run: vi.fn(async () => ({ status: 'updated' as const, memo: '[TIME]\nDay 1\n[/TIME]', delta: { added: ['TIME'], replaced: [], removed: [], noChange: false } as never, report: {} as never })) }, memos: { load: async () => ({ memo: '[TIME]\nDay 1\n[/TIME]' }) } })
        expect((await clock.creator.generate({ chatId: 'c1', userId: 'u1', draft: {} })).reason).toMatch(/no character sheet/)
        // A chat that already had a sheet: the legacy's message, then the sentence that says so (35c-bis).
        const again = harness({ trackerPass: { run: vi.fn(async () => ({ status: 'no-change' as const, reason: 'empty', memo: SHEET, report: {} as never })) }, memos: { load: async () => ({ memo: SHEET }) } })
        expect((await again.creator.generate({ chatId: 'c1', userId: 'u1', draft: {} })).reason).toMatch(/no character sheet \(empty\).* The chat already had a sheet before this run, and the pass changed nothing: the cards above still hold the earlier one\.$/)
        expect((await again.creator.ways({ chatId: 'c1', userId: 'u1', way: 'custom', name: 'Robin', instructions: 'x' })).reason).toContain('The chat already had a sheet before this run')
        const failed = harness({ trackerPass: { run: vi.fn(async () => ({ status: 'failed' as const, reason: 'the tracker model call failed: 500', memo: '', report: {} as never })) } })
        expect((await failed.creator.generate({ chatId: 'c1', userId: 'u1', draft: {} })).reason).toContain('(the tracker model call failed: 500)')
    })

    it('reports a pass that threw, rather than throwing', async () => {
        const { creator, log } = harness({ trackerPass: { run: vi.fn(async () => { throw new Error('no chat') }) } })
        expect(await creator.generate({ chatId: 'c1', userId: 'u1', draft: {} })).toEqual({ status: 'failed', at: '2026-10-04T10:00:00.000Z', name: '', reason: 'no chat' })
        expect(log.at(-1)).toBe('warn: creator: the sheet could not be written: no chat')
    })
})

describe('the Player Card and the persona after the sheet (35b)', () => {
    const cardService = () => {
        const calls: Array<[string, Record<string, unknown>]> = []
        return {
            calls,
            playerCard: {
                write: async (request: Record<string, unknown>) => { calls.push(['write', request]); return { status: 'written' as const, at: 't', name: 'Robin Vale', words: 160 } },
                persona: async (request: Record<string, unknown>) => { calls.push(['persona', request]); return { status: 'active' as const, at: 't', name: 'Robin Vale', created: true } },
                save: async () => { throw new Error('unused') },
                remove: async () => undefined,
                view: async () => ({ card: null, persona: null, personasAvailable: true, activePersona: '', activeDescribed: false }),
                patch: async () => ({ ok: true as const }),
                name: async () => '',
            } as unknown as CreatorDeps['playerCard'],
        }
    }

    it('writes neither by default from the creator, both when the preferences or the request ask, and reports what they did', async () => {
        const quiet = cardService()
        const { creator } = harness({ playerCard: quiet.playerCard })
        const plain = await creator.generate({ chatId: 'c1', userId: 'u1', draft: { name: 'Robin Vale' } })
        expect(plain).not.toHaveProperty('card')
        expect(quiet.calls.map(([op]) => op)).toEqual(['persona'])
        expect(plain.persona).toMatchObject({ status: 'active', name: 'Robin Vale' })
        // The request's own switches outrank the preferences; the card gets the sheet's hints and the words asked for.
        const asked = cardService()
        const both = harness({ playerCard: asked.playerCard, card: async () => ({ name: 'Gorm', description: 'A grim narrator.' }) })
        const result = await both.creator.generate({ chatId: 'c1', userId: 'u1', draft: { name: 'Robin Vale', traits: 'wry' }, playerCard: true, persona: false, cardWords: 300 })
        expect(asked.calls.map(([op]) => op)).toEqual(['write'])
        expect(asked.calls[0]![1]).toMatchObject({ chatId: 'c1', userId: 'u1', name: 'Robin Vale', words: 300 })
        expect(String(asked.calls[0]![1].extraHints)).toContain('wry')
        expect(String(asked.calls[0]![1].extraHints)).toContain('--- CHARACTER CARD CONTEXT ---')
        expect(result.card).toMatchObject({ status: 'written', words: 160 })
        expect(result).not.toHaveProperty('persona')
        // The preferences alone switch the card on.
        const byPrefs = cardService()
        const prefs = harness({ playerCard: byPrefs.playerCard, prefs: { load: async () => ({ creatorLevel: 3, creatorGearTier: 'standard', creatorCombatScalingGuide: true, creatorInitialDate: 'Day 1', creatorInitialTime: '08:00 AM', creatorConnectionId: '', trackerDirectLookback: 4, creatorPlayerCard: true, creatorPersona: true, creatorCardWords: 100, creatorGenre: 'fantasy' }) } })
        await prefs.creator.generate({ chatId: 'c1', userId: 'u1', draft: {} })
        expect(byPrefs.calls.map(([op]) => op)).toEqual(['persona', 'write'])
        expect(byPrefs.calls[1]![1]).toMatchObject({ words: 100 })
        // Without the service, nothing is attempted and nothing is reported.
        const none = await harness().creator.generate({ chatId: 'c1', userId: 'u1', draft: {}, playerCard: true, persona: true })
        expect(none).not.toHaveProperty('card')
        expect(none).not.toHaveProperty('persona')
    })

    it('does not write the card or the persona when the sheet failed, and Instant Action always writes both with the setup as a hint', async () => {
        const failed = cardService()
        const unchanged = harness({ playerCard: failed.playerCard, trackerPass: { run: vi.fn(async () => ({ status: 'no-change' as const, reason: 'empty', memo: '', report: {} as never })) } })
        await unchanged.creator.generate({ chatId: 'c1', userId: 'u1', draft: {}, playerCard: true, persona: true })
        expect(failed.calls).toEqual([])
        const instant = cardService()
        const { creator } = harness({ playerCard: instant.playerCard, send: async () => ({ id: 'm1' }), random: () => 0.5 })
        const result = await creator.instant({ chatId: 'c1', userId: 'u1', genre: 'fantasy', setup: 'A heist.' })
        expect(instant.calls.map(([op]) => op)).toEqual(['persona', 'write'])
        expect(instant.calls[1]![1]).toMatchObject({ name: 'Robin Vale', words: 150 })
        expect(String(instant.calls[1]![1].extraHints)).toContain('A heist.')
        expect(result.card).toMatchObject({ status: 'written' })
        expect(result.persona).toMatchObject({ status: 'active' })
        expect(result.started).toBe(true)
        const plain = await harness({ playerCard: cardService().playerCard, send: async () => ({ id: 'm1' }) }).creator.instant({ chatId: 'c1', userId: 'u1', genre: 'fantasy' })
        expect(plain.card).toBeDefined()
    })

    it('sends the opening message as the persona it just made active, when the host named one (76-ter)', async () => {
        const asPersona: Array<string | undefined> = []
        const send = async (_chat: string, _content: string, _user: string | undefined, personaId?: string) => { asPersona.push(personaId); return { id: 'm3' } }
        const named = cardService()
        ;(named.playerCard as { persona: unknown }).persona = async (request: Record<string, unknown>) => { named.calls.push(['persona', request]); return { status: 'active' as const, at: 't', name: 'Robin Vale', id: 'p7', created: true } }
        const { creator, log } = harness({ playerCard: named.playerCard, send, random: () => 0.5 })
        const result = await creator.instant({ chatId: 'c1', userId: 'u1', genre: 'fantasy' })
        expect(result.started).toBe(true)
        expect(asPersona).toEqual(['p7'])
        expect(log.at(-1)).toBe('creator: instant action began the adventure for "Robin Vale" (message m3, as the persona p7)')
        // A persona the host could not make leaves the message to the host's active persona setting, as before.
        const failed = cardService()
        ;(failed.playerCard as { persona: unknown }).persona = async () => ({ status: 'failed' as const, at: 't', name: 'Robin Vale', reason: 'no grant' })
        asPersona.length = 0
        await harness({ playerCard: failed.playerCard, send, random: () => 0.5 }).creator.instant({ chatId: 'c1', userId: 'u1', genre: 'fantasy' })
        expect(asPersona).toEqual([undefined])
    })
})

describe('the other ways to begin (35c)', () => {
    it('writes a character from the active persona, named for it, on the creator\'s settings, and reports the source', async () => {
        const { creator, runs, log } = harness({ activePersona: async () => ({ name: ' Quill ', description: ' A prince. ' }) })
        const result = await creator.ways({ chatId: 'c1', userId: 'u1', way: 'persona', instructions: 'a western' })
        expect(result).toEqual({ status: 'written', at: '2026-10-04T10:00:00.000Z', way: 'persona', name: 'Robin Vale', source: 'Quill', added: ['CHARACTER', 'XP'], replaced: [] })
        expect(runs[0]).toMatchObject({ chatId: 'c1', userId: 'u1', trigger: 'direct', window: 4, systemPromptMode: 'modules_only', connectionId: 'creator-conn', playerName: 'Quill' })
        expect(runs[0]!.instruction).toContain('STARTING LEVEL: 3 (mandatory')
        expect(runs[0]!.instruction).toContain('The character\'s name MUST be "Quill" (the active persona name).')
        expect(runs[0]!.instruction).toContain('\n\nPersona — Quill:\nA prince.')
        expect(runs[0]!.instruction).toContain('Additional setting/instruction constraints: a western.')
        expect(runs[0]!.instruction).toContain('STARTING GEAR: Standard kit for Level 3')
        expect(log[0]).toBe('creator: a character from the persona "Quill" for chat c1 (fantasy, level 3, with instructions)')
        // The request's own level, genre, gear tier and guide outrank the preferences.
        const { creator: own, runs: ownRuns } = harness({ activePersona: async () => ({ name: 'Quill', description: 'x' }) })
        await own.ways({ chatId: 'c1', userId: 'u1', way: 'persona', level: 'none', genre: 'scifi', gearTier: 'heroic', combatScalingGuide: false })
        expect(ownRuns[0]!.instruction!.startsWith('LEVEL SYSTEM:')).toBe(true)
        expect(ownRuns[0]!.instruction).toContain('Elite signature kit')
        expect(ownRuns[0]!.instruction).not.toContain('COMBAT & SKILL SCALING GUIDE')
    })

    it('fails without a persona, without the grant, without instructions for Custom, and without a name for Custom', async () => {
        expect(await harness({ activePersona: async () => null }).creator.ways({ chatId: 'c1', userId: 'u1', way: 'persona' })).toEqual({ status: 'failed', at: '2026-10-04T10:00:00.000Z', way: 'persona', name: '', reason: 'No persona is set. Pick a persona in Lumiverse and try again.' })
        expect(await harness({ activePersona: async () => ({ name: '', description: '  ' }) }).creator.ways({ chatId: 'c1', userId: 'u1', way: 'persona' })).toMatchObject({ status: 'failed', reason: 'No persona is set. Pick a persona in Lumiverse and try again.' })
        expect(await harness().creator.ways({ chatId: 'c1', userId: 'u1', way: 'persona' })).toMatchObject({ status: 'failed', reason: 'the host has not granted the personas permission, so the active persona cannot be read' })
        expect(await harness().creator.ways({ chatId: 'c1', userId: 'u1', way: 'custom', name: 'Robin' })).toMatchObject({ status: 'failed', way: 'custom', name: 'Robin', reason: 'Please enter custom setting/character instructions first.' })
        expect(await harness().creator.ways({ chatId: 'c1', userId: 'u1', way: 'custom', instructions: 'A decker' })).toMatchObject({ status: 'failed', way: 'custom', reason: 'Roll a character name before generating.' })
        const { runs } = harness()
        expect(runs).toEqual([])
    })

    it('writes a character from custom instructions with the name given, then the card and the persona as asked, with the instructions as hints', async () => {
        const calls: Array<[string, Record<string, unknown>]> = []
        const playerCard = {
            write: async (request: Record<string, unknown>) => { calls.push(['write', request]); return { status: 'written' as const, at: 't', name: 'Robin Vale', words: 160 } },
            persona: async (request: Record<string, unknown>) => { calls.push(['persona', request]); return { status: 'active' as const, at: 't', name: 'Robin Vale', created: true } },
        } as unknown as CreatorDeps['playerCard']
        const { creator, runs } = harness({ playerCard })
        const result = await creator.ways({ chatId: 'c1', userId: 'u1', way: 'custom', name: ' Mara ', instructions: ' A decker ', playerCard: true, persona: true, cardWords: 300 })
        expect(result).toMatchObject({ status: 'written', way: 'custom', name: 'Robin Vale', added: ['CHARACTER', 'XP'], card: { status: 'written' }, persona: { status: 'active' } })
        expect(result).not.toHaveProperty('source')
        expect(runs[0]!.playerName).toBe('Mara')
        expect(runs[0]!.instruction).toContain('based entirely on these custom instructions: "A decker". The character\'s name MUST be "Mara" exactly.')
        expect(calls.map(([op]) => op)).toEqual(['persona', 'write'])
        expect(calls[0]![1]).toMatchObject({ name: 'Robin Vale' })
        expect(calls[1]![1]).toMatchObject({ name: 'Robin Vale', words: 300, extraHints: '\n\n--- PLAYER PREFERENCES & HINTS ---\nAdditional: A decker\n' })
    })

    it('reports a sheet that did not arrive, and a pass that threw', async () => {
        const unchanged = harness({ trackerPass: { run: vi.fn(async () => ({ status: 'no-change' as const, reason: 'empty', memo: '', report: {} as never })) } })
        expect(await unchanged.creator.ways({ chatId: 'c1', userId: 'u1', way: 'custom', name: 'Robin', instructions: 'x' })).toMatchObject({ status: 'failed', way: 'custom', name: 'Robin', reason: expect.stringContaining('no character sheet (empty)') })
        const threw = harness({ trackerPass: { run: vi.fn(async () => { throw new Error('no chat') }) } })
        expect(await threw.creator.ways({ chatId: 'c1', userId: 'u1', way: 'custom', name: 'Robin', instructions: 'x' })).toEqual({ status: 'failed', at: '2026-10-04T10:00:00.000Z', way: 'custom', name: 'Robin', reason: 'no chat' })
        expect(threw.log.at(-1)).toBe('warn: creator: the custom way failed: no chat')
    })
})

describe('Instant Action (35a)', () => {
    // `random` picks the archetype: 0.5 lands mid-list, 0 on the first. The level is 1 unless Random level is on (45d), when 0.5 rolls 6.
    const sent: Array<[string, string, string | undefined]> = []
    const send = async (chatId: string, content: string, userId: string | undefined) => { sent.push([chatId, content, userId]); return { id: 'm9' } }

    it('rolls a class and a level, writes the sheet with the setup, names the character from the sheet, and sends the opening message', async () => {
        sent.length = 0
        const { creator, runs, log } = harness({ send, random: () => 0.5 })
        const result = await creator.instant({ chatId: 'c1', userId: 'u1', genre: 'fantasy', name: 'Robin', setup: '  A heist in the capital.  ' })
        expect(result).toEqual({ status: 'ready', at: '2026-10-04T10:00:00.000Z', genre: 'fantasy', className: 'Barbarian', level: 1, name: 'Robin Vale', started: true, messageId: 'm9', added: ['CHARACTER', 'XP'] })
        expect(runs[0]).toMatchObject({ trigger: 'direct', systemPromptMode: 'modules_only', playerName: 'Robin', connectionId: 'creator-conn' })
        expect(runs[0]!.instruction).toContain('Class: Barbarian')
        expect(runs[0]!.instruction).toContain('Level:        1 (fallback')
        expect(runs[0]!.instruction).toContain('A heist in the capital.')
        expect(runs[0]!.instruction).not.toContain('  A heist')
        expect(sent).toEqual([['c1', 'Begin the adventure.\n\nInitial Setup:\nA heist in the capital.', 'u1']])
        expect(log[0]).toBe('creator: instant action for chat c1 (fantasy, Barbarian, level 1, Robin, with a setup)')
        expect(log.at(-1)).toBe('creator: instant action began the adventure for "Robin Vale" (message m9)')
    })

    it('rolls the level 1 to 10 when Random level is on (45d)', async () => {
        sent.length = 0
        const { creator, runs } = harness({ send, random: () => 0.5, prefs: { load: async () => ({ creatorLevel: 3, creatorGearTier: 'auto', creatorCombatScalingGuide: true, creatorInitialDate: 'Day 1', creatorInitialTime: '08:00 AM', creatorConnectionId: '', trackerDirectLookback: 4, creatorPlayerCard: false, creatorPersona: true, creatorCardWords: 150, creatorGenre: 'fantasy', creatorInstantRandomLevel: true }) } })
        const result = await creator.instant({ chatId: 'c1', userId: 'u1', genre: 'fantasy', name: 'Robin' })
        expect(result).toMatchObject({ status: 'ready', className: 'Barbarian', level: 6 })
        expect(runs[0]!.instruction).toMatch(/STARTING LEVEL: 6/)
    })

    it('holds the opening message back when asked, keeps no level for a system without them, falls back to fantasy for a genre it does not know, and takes the typed name when the sheet has none', async () => {
        sent.length = 0
        // A sheet with no name line: the memo is empty before the pass and holds a nameless block after it.
        const asked: TrackerPassRequest[] = []
        const nameless = () => { let memo = ''; return { trackerPass: { run: vi.fn(async (request: TrackerPassRequest) => { asked.push(request); memo = '[CHARACTER]\nx\n[/CHARACTER]'; return { status: 'updated' as const, memo, delta: { added: ['CHARACTER'], replaced: [], removed: [], noChange: false } as never, report: {} as never } }) }, memos: { load: async () => ({ memo }) } } }
        const { creator } = harness({ send, random: () => 0, prefs: { load: async () => ({ creatorLevel: 'none', creatorGearTier: 'auto', creatorCombatScalingGuide: true, creatorInitialDate: 'Day 1', creatorInitialTime: '08:00 AM', creatorConnectionId: '', trackerDirectLookback: 4, creatorPlayerCard: false, creatorPersona: true, creatorCardWords: 150, creatorGenre: 'fantasy' }) }, ...nameless() })
        const result = await creator.instant({ chatId: 'c1', userId: 'u1', genre: 'western', name: ' Mara ', sendStarter: false })
        expect(result).toMatchObject({ status: 'ready', genre: 'fantasy', className: 'Fighter', level: null, name: 'Mara', started: false })
        expect(result).not.toHaveProperty('messageId')
        expect(asked[0]!.instruction).toContain('Class: Fighter')
        expect(asked[0]!.instruction).toContain('Level:        N/A')
        expect(asked[0]!.playerName).toBe('Mara')
        expect(sent).toEqual([])
        // Neither a sheet name nor a typed one: the legacy's "My Character".
        const untyped = harness({ send, random: () => 0, ...nameless() })
        expect((await untyped.creator.instant({ chatId: 'c1', userId: 'u1', genre: 'horror', sendStarter: false })).name).toBe('My Character')
        // A setup of whitespace alone is no setup: the log does not claim one and the opening message is the plain one.
        sent.length = 0
        const blank = harness({ send, random: () => 0 })
        await blank.creator.instant({ chatId: 'c1', userId: 'u1', genre: 'horror', setup: '   \n  ' })
        expect(blank.log[0]).toBe('creator: instant action for chat c1 (horror, Paranormal Investigator, level 1, a name of the model\u2019s choosing)')
        expect(sent).toEqual([['c1', 'Begin the adventure', 'u1']])
    })

    it('fails without sending when no sheet arrived, when the pass threw, or when the build cannot send', async () => {
        sent.length = 0
        const unchanged = harness({ send, random: () => 0.5, trackerPass: { run: vi.fn(async () => ({ status: 'no-change' as const, reason: 'empty', memo: '', report: {} as never })) } })
        expect(await unchanged.creator.instant({ chatId: 'c1', userId: 'u1', genre: 'scifi' })).toEqual({ status: 'failed', at: '2026-10-04T10:00:00.000Z', genre: 'scifi', className: 'Bounty Hunter', level: 1, name: '', started: false, reason: expect.stringContaining('no character sheet (empty)') })
        expect(sent).toEqual([])
        const threw = harness({ send, random: () => 0.5, trackerPass: { run: vi.fn(async () => { throw new Error('no chat') }) } })
        expect(await threw.creator.instant({ chatId: 'c1', userId: 'u1', genre: 'scifi' })).toMatchObject({ status: 'failed', className: 'Bounty Hunter', level: null, reason: 'no chat' })
        expect(threw.log.at(-1)).toBe('warn: creator: instant action failed: no chat')
        const noSend = harness({ random: () => 0.5 })
        expect(await noSend.creator.instant({ chatId: 'c1', userId: 'u1', genre: 'horror' })).toMatchObject({ status: 'failed', name: 'Robin Vale', reason: 'the sheet for Robin Vale was written, but this build cannot send the opening message' })
    })
})

describe('Import Card (39)', () => {
    const KESTREL = { id: 'k1', name: 'Kestrel', description: 'A hawk-eyed scout.', personality: 'Wary, dry.' }
    const NARRATOR = { id: 'n1', name: 'The Engine', description: 'A grim narrator.', personality: '' }
    function withCards(over: Partial<CreatorDeps> = {}, outcome: Partial<TrackerPassOutcome> = {}) {
        const personas: unknown[] = []
        const saved: unknown[] = []
        const generated: unknown[] = []
        const h = harness({
            characters: {
                list: async () => [KESTREL, NARRATOR, { id: 'x', name: '', description: '', personality: '' }],
                get: async (id) => (id === 'k1' ? KESTREL : id === 'n1' ? NARRATOR : null),
            },
            generate: async (messages, chatId, userId, connectionId) => { generated.push({ messages, chatId, userId, connectionId }); return 'Personality:\nWary, dry, hawk-eyed.' },
            recent: async () => [{ user: true, name: 'Player', text: 'I look around.' }, { user: false, name: 'Narrator', text: 'The gate is shut.' }],
            playerCard: {
                persona: async (request: { chatId: string; userId: string | undefined; name?: string }) => { personas.push(request); return { status: 'active' as const, at: 'p', name: request.name ?? '', created: true } },
                save: async (request: { chatId: string; userId: string | undefined; name: string; bio: string }) => { saved.push(request); return { status: 'written' as const, at: 's', name: request.name, words: 4 } },
                write: async () => { throw new Error('the import never writes the card from the sheet') },
                remove: async () => undefined,
                view: async () => ({ card: null, persona: null, personasAvailable: true, activePersona: '', activeDescribed: false }),
            } as never,
            ...over,
        }, outcome)
        return { ...h, personas, saved, generated }
    }

    it('places the card\'s avatar as the portrait of the sheet\'s name, and reports a store that refused without failing the import (43)', async () => {
        const set: unknown[] = []
        const pictured = withCards({ characters: { list: async () => [], get: async (id) => (id === 'k1' ? { ...KESTREL, avatar: 'https://host/kestrel.png' } : null) }, portraits: { set: async (...args: unknown[]) => { set.push(args) } } })
        const result = await pictured.creator.importCard({ chatId: 'c1', userId: 'u1', characterId: 'k1', mode: 'full', playerCard: false, persona: false })
        expect(result).toMatchObject({ status: 'written', name: 'Robin Vale', portrait: true })
        expect(set).toEqual([['c1', 'Robin Vale', 'https://host/kestrel.png', 'u1']])
        expect(pictured.log).toContain('creator: the avatar of "Kestrel" is the portrait of "Robin Vale"')
        const bare = withCards({ portraits: { set: async (...args: unknown[]) => { set.push(args) } } })
        expect((await bare.creator.importCard({ chatId: 'c1', userId: 'u1', characterId: 'k1', mode: 'full', playerCard: false, persona: false })).portrait).toBeUndefined()
        expect(set).toHaveLength(1)
        const refused = withCards({ characters: { list: async () => [], get: async () => ({ ...KESTREL, avatar: 'https://host/kestrel.png' }) }, portraits: { set: async () => { throw new Error('no store') } } })
        const outcome = await refused.creator.importCard({ chatId: 'c1', userId: 'u1', characterId: 'k1', mode: 'full', playerCard: false, persona: false })
        expect(outcome).toMatchObject({ status: 'written', portrait: false })
        expect(refused.log.some((line) => line.includes('warn: creator: the avatar of "Kestrel" could not be placed as the portrait: no store'))).toBe(true)
    })

    it('lists the cards with a snippet, leaving out one with no name', async () => {
        const { creator } = withCards()
        expect(await creator.cards('u1')).toEqual([{ id: 'k1', name: 'Kestrel', snippet: 'A hawk-eyed scout.' }, { id: 'n1', name: 'The Engine', snippet: 'A grim narrator.' }])
        await expect(harness().creator.cards('u1')).rejects.toThrow(/characters permission/)
    })

    it('imports a card: the pass with the card and the world, then the persona, then the Player Card from the card\u2019s text', async () => {
        const { creator, runs, log, personas, saved, generated } = withCards()
        const result = await creator.importCard({ chatId: 'c1', userId: 'u1', characterId: 'k1', mode: 'full', playerCard: true, persona: true, cardWords: 300, narratorCharacterId: 'n1' })
        expect(result).toEqual({ status: 'written', at: '2026-10-04T10:00:00.000Z', name: 'Robin Vale', source: 'Kestrel', mode: 'full', added: ['CHARACTER', 'XP'], replaced: [], persona: { status: 'active', at: 'p', name: 'Kestrel', created: true }, card: { status: 'written', at: 's', name: 'Kestrel', words: 4 } })
        expect(runs[0]).toMatchObject({ chatId: 'c1', userId: 'u1', trigger: 'direct', window: 4, systemPromptMode: 'modules_only', connectionId: 'creator-conn', playerName: 'Kestrel' })
        expect(runs[0]!.instruction).toContain('Adapt this character card to the current campaign setting')
        expect(runs[0]!.instruction).toContain('CHARACTER CARD:\nName: Kestrel\nDescription: A hawk-eyed scout.\nPersonality: Wary, dry.')
        expect(runs[0]!.instruction).toContain('RECENT CHAT:\nPlayer: I look around.\n\nNarrator: The gate is shut.')
        expect(runs[0]!.instruction).toContain('NARRATOR/WORLD CARD:\nA grim narrator.')
        expect(runs[0]!.instruction).toContain('STARTING GEAR: Standard kit for Level 3')
        expect(personas).toEqual([{ chatId: 'c1', userId: 'u1', name: 'Kestrel' }])
        expect(generated).toHaveLength(1)
        expect(generated[0]).toMatchObject({ chatId: 'c1', userId: 'u1', connectionId: 'creator-conn' })
        expect((generated[0] as { messages: Array<{ content: string }> }).messages[0]!.content).toContain('approximately 300 words')
        expect(saved).toEqual([{ chatId: 'c1', userId: 'u1', name: 'Kestrel', bio: 'Personality:\nWary, dry, hawk-eyed.' }])
        expect(log).toEqual([
            'creator: importing the card "Kestrel" for chat c1 (fitted into the story, with the narrator\u2019s card)',
            'creator: imported the card "Kestrel" as "Robin Vale": CHARACTER, XP',
            'creator: writing the Player Card from the card "Kestrel" (300 words)',
        ])
    })

    it('reads the switches from the preferences, in the minimal mode, with the card\u2019s own length and no narrator', async () => {
        const { creator, runs, personas, saved, generated } = withCards()
        const result = await creator.importCard({ chatId: 'c1', userId: 'u1', characterId: 'k1', mode: 'minimal' })
        expect(result.status).toBe('written')
        expect(runs[0]!.instruction).toContain('Translate this character card into state tracker format')
        expect(runs[0]!.instruction).not.toContain('NARRATOR/WORLD CARD')
        // The prefs say persona on, card off.
        expect(personas).toHaveLength(1)
        expect(saved).toEqual([])
        expect(generated).toEqual([])
        expect(result.card).toBeUndefined()
    })

    it('fails without the grant, without the card, and when the pass changed nothing, naming an earlier sheet', async () => {
        expect(await harness().creator.importCard({ chatId: 'c1', userId: 'u1', characterId: 'k1', mode: 'full' })).toMatchObject({ status: 'failed', reason: 'the host has not granted the characters permission, so no card can be read' })
        expect(await withCards().creator.importCard({ chatId: 'c1', userId: 'u1', characterId: 'nope', mode: 'full' })).toMatchObject({ status: 'failed', reason: 'No character card was found for "nope".' })
        const still = withCards({}, { status: 'no-change', delta: undefined })
        still.setMemo('[CHARACTER]\nOld (Monk 1): 9/9 HP\n[/CHARACTER]')
        const result = await still.creator.importCard({ chatId: 'c1', userId: 'u1', characterId: 'k1', mode: 'full' })
        expect(result).toMatchObject({ status: 'failed', name: 'Kestrel', source: 'Kestrel', mode: 'full' })
        expect(result.reason).toBe('the tracker pass changed nothing The chat already had a sheet before this run, and the pass changed nothing: the cards above still hold the earlier one.')
        expect(still.personas).toEqual([])
        const broken = withCards({}, { status: 'failed', reason: 'no connection' })
        expect((await broken.creator.importCard({ chatId: 'c1', userId: 'u1', characterId: 'k1', mode: 'full' })).reason).toBe('the tracker pass failed: no connection')
    })

    it('reports a Player Card the model left empty, or that failed, without undoing the sheet', async () => {
        const empty = withCards({ generate: async () => '   ' })
        const result = await empty.creator.importCard({ chatId: 'c1', userId: 'u1', characterId: 'k1', mode: 'full', playerCard: true, persona: false })
        expect(result.status).toBe('written')
        expect(result.persona).toBeUndefined()
        expect(empty.personas).toEqual([])
        expect(result.card).toEqual({ status: 'failed', at: '2026-10-04T10:00:00.000Z', name: 'Kestrel', reason: 'the model returned no Player Card' })
        const thrown = withCards({ generate: async () => { throw new Error('model down') } })
        expect((await thrown.creator.importCard({ chatId: 'c1', userId: 'u1', characterId: 'k1', mode: 'full', playerCard: true })).card).toMatchObject({ status: 'failed', reason: 'model down' })
    })

    it('goes on without the story or the narrator when their reads fail, and never reads the card as its own narrator', async () => {
        const { creator, runs } = withCards({ recent: async () => { throw new Error('PERMISSION_DENIED') } })
        const result = await creator.importCard({ chatId: 'c1', userId: 'u1', characterId: 'k1', mode: 'full', narratorCharacterId: 'k1' })
        expect(result.status).toBe('written')
        expect(runs[0]!.instruction).not.toContain('RECENT CHAT')
        expect(runs[0]!.instruction).not.toContain('NARRATOR/WORLD CARD')
    })
})

