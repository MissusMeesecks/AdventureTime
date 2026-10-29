import { describe, expect, it } from 'vitest'

import { BLOCK_ORDER, buildTrackerView, orderBlockTags } from './view.js'
import type { Quest } from './quests.js'

const MEMO = [
    '[TIME]',
    '06:15 AM, Day 4',
    '[/TIME]',
    '[WAYSTONE]',
    'Attunement: ((BARCYAN)) 640/1000 (Harmonious)',
    'Steward: Odile',
    '[/WAYSTONE]',
    '[XP]',
    '450/1000 Level 3',
    '[/XP]',
].join('\n')

describe('orderBlockTags', () => {
    it('draws the ordered tags first, in the order given', () => {
        const { ordered } = orderBlockTags(['TIME', 'COMBAT', 'XP'], BLOCK_ORDER)
        expect(ordered).toEqual(['COMBAT', 'XP', 'TIME'])
    })

    it('skips ordered tags the memo does not carry', () => {
        expect(orderBlockTags(['TIME'], BLOCK_ORDER).ordered).toEqual(['TIME'])
    })

    it('appends unmentioned tags alphabetically rather than dropping them', () => {
        const { ordered, unordered } = orderBlockTags(['ZEBRA', 'TIME', 'ACME'], BLOCK_ORDER)
        expect(ordered).toEqual(['TIME', 'ACME', 'ZEBRA'])
        expect(unordered).toEqual(['ACME', 'ZEBRA'])
    })

    it('never gives BENCHED PARTY a place of its own', () => {
        // It folds into the PARTY card; a top-level slot would duplicate it.
        expect(orderBlockTags(['BENCHED PARTY', 'PARTY'], ['PARTY', 'BENCHED PARTY']).ordered).toEqual(['PARTY'])
    })
})

describe('buildTrackerView', () => {
    it('reports an empty memo as empty', () => {
        expect(buildTrackerView('').empty).toBe(true)
        expect(buildTrackerView('just narrative').empty).toBe(true)
        expect(buildTrackerView('').blocks).toEqual([])
    })

    it('orders blocks by the stock order when settings say nothing', () => {
        expect(buildTrackerView(MEMO).blocks.map((b) => b.tag)).toEqual(['XP', 'TIME', 'WAYSTONE'])
    })

    it('honours a cartridge blockOrder, custom tags included', () => {
        const view = buildTrackerView(MEMO, { blockOrder: ['WAYSTONE', 'XP', 'TIME'] })
        expect(view.blocks.map((b) => b.tag)).toEqual(['WAYSTONE', 'XP', 'TIME'])
        expect(view.unordered).toEqual([])
    })

    it('parses each line of each block', () => {
        const waystone = buildTrackerView(MEMO).blocks.find((b) => b.tag === 'WAYSTONE')!
        expect(waystone.lines).toHaveLength(2)
        expect(waystone.lines[0].kind).toBe('markers')
        expect(waystone.lines[1]).toEqual({ kind: 'kv', label: 'Steward', value: 'Odile' })
    })

    it('takes label and icon from a matching custom field', () => {
        const view = buildTrackerView(MEMO, {
            customFields: [{ tag: 'WAYSTONE', label: 'Runestone', icon: '💠' }],
        })
        const waystone = view.blocks.find((b) => b.tag === 'WAYSTONE')!
        expect(waystone.label).toBe('Runestone')
        expect(waystone.icon).toBe('💠')
    })

    it('falls back to the stock icon, then to a generic one', () => {
        const view = buildTrackerView(MEMO)
        expect(view.blocks.find((b) => b.tag === 'TIME')!.icon).toBe('🕒')
        expect(view.blocks.find((b) => b.tag === 'WAYSTONE')!.icon).toBe('📄')
        expect(view.blocks.find((b) => b.tag === 'WAYSTONE')!.label).toBe('WAYSTONE')
    })

    it('keeps the raw content, so a raw view needs no second parse', () => {
        expect(buildTrackerView(MEMO).blocks.find((b) => b.tag === 'TIME')!.raw).toBe('06:15 AM, Day 4')
    })

    it('holds BENCHED PARTY aside instead of giving it a card', () => {
        const view = buildTrackerView('[PARTY]\nBrenna\n[/PARTY]\n[BENCHED PARTY]\nAnsel\n[/BENCHED PARTY]')
        expect(view.blocks.map((b) => b.tag)).toEqual(['PARTY'])
        expect(view.benchedParty?.raw).toBe('Ansel')
    })

    it('flags an erased block but still shows it', () => {
        // Module toggles govern what the model emits, not what is drawn. A
        // block that is still in the memo is state the user should see.
        const view = buildTrackerView('[SECRETS]\nNONE\n[/SECRETS]')
        expect(view.blocks[0].erased).toBe(true)
        expect(view.blocks[0].tag).toBe('SECRETS')
    })

    it('matches a custom field tag case-insensitively', () => {
        const view = buildTrackerView('[waystone]\nx\n[/waystone]', { customFields: [{ tag: 'waystone', label: 'Runestone' }] })
        expect(view.blocks[0].label).toBe('Runestone')
    })
})

describe('the quest block', () => {
    const QUEST_MEMO = [
        '[TIME]',
        '08:00 AM, Day 2',
        '[/TIME]',
        '[QUESTS]',
        'QUEST: The Missing Sheep',
        '  ID: quest_1',
        '  STATUS: active',
        '  GIVER: Farmer Hemwick @ Crestwood Mill',
        '  ACCEPTED: 08:00 AM, Day 1',
        '  DEADLINE: 08:00 AM, Day 3',
        '  OBJ_ACTIVE: Find the sheep',
        '[/QUESTS]',
    ].join('\n')

    const ALL_ON = { questsDeadlines: true, questsFrustration: true, questsShowArchive: true }

    it('parses the block into quests rather than leaving it as lines', () => {
        const block = buildTrackerView(QUEST_MEMO, { syspromptModules: ALL_ON }).blocks.find((b) => b.tag === 'QUESTS')!
        expect(block.quests!.active).toHaveLength(1)
        expect(block.quests!.active[0]!.title).toBe('The Missing Sheep')
        expect(block.quests!.active[0]!.objectives[0]!.text).toBe('Find the sheep')
    })

    it('reads the clock out of the memo, so deadlines are arithmetic and not text', () => {
        const block = buildTrackerView(QUEST_MEMO, { syspromptModules: ALL_ON }).blocks.find((b) => b.tag === 'QUESTS')!
        expect(block.quests!.active[0]!.deadline).toMatchObject({ remaining: '1 day left', overdue: false })
    })

    it('keeps the lines too, so nothing depends on the quest grammar having won', () => {
        const block = buildTrackerView(QUEST_MEMO, { syspromptModules: ALL_ON }).blocks.find((b) => b.tag === 'QUESTS')!
        expect(block.lines.length).toBeGreaterThan(0)
        expect(block.raw).toContain('QUEST: The Missing Sheep')
    })

    it('leaves a block the quest grammar cannot read as plain lines', () => {
        // The fallback that matters. A model that writes something other than
        // the documented format must still see its text on screen, not an
        // empty quest log.
        const block = buildTrackerView('[QUESTS]\nGo and find the sheep, somehow\n[/QUESTS]').blocks[0]!
        expect(block.quests).toBeUndefined()
        expect(block.lines).toHaveLength(1)
    })

    it('gives no other block a quest log', () => {
        expect(buildTrackerView(QUEST_MEMO).blocks.find((b) => b.tag === 'TIME')!.quests).toBeUndefined()
    })

    it('honours the three quest module toggles', () => {
        const off = buildTrackerView(QUEST_MEMO, {
            syspromptModules: { questsDeadlines: false, questsFrustration: false, questsShowArchive: false },
        }).blocks.find((b) => b.tag === 'QUESTS')!
        expect(off.quests!.active[0]!.deadline).toBeNull()
        expect(off.quests!.active[0]!.mood!.label).toBe('Ahead of Schedule')
    })

    it('defaults to the legacy answers when the toggles are absent', () => {
        // Deadlines and frustration off, archive on — the legacy truthiness,
        // kept because that is what a settings object missing the key did.
        const block = buildTrackerView(QUEST_MEMO).blocks.find((b) => b.tag === 'QUESTS')!
        expect(block.quests!.active[0]!.deadline).toBeNull()
        expect(block.quests!.active[0]!.mood!.label).toBe('Ahead of Schedule')
    })
})

describe('the quest archive, folded back in', () => {
    const ACTIVE_MEMO = [
        '[TIME]',
        '08:00 AM, Day 2',
        '[/TIME]',
        '[QUESTS]',
        'QUEST: The Missing Sheep',
        '  ID: sheep',
        '  STATUS: active',
        '  GIVER: Farmer Hemwick @ Crestwood Mill',
        '[/QUESTS]',
    ].join('\n')

    const finished = (over: Partial<Quest> = {}): Quest => ({
        id: 'cellar',
        title: 'The Rat Cellar',
        status: 'completed',
        giver_name: 'Innkeeper',
        giver_location: 'The Bell',
        accepted_time: '08:00 AM, Day 1',
        deadline_time: null,
        objectives: [],
        rewards: [],
        ...over,
    })

    const questsOf = (memo: string, archive: Quest[]) =>
        buildTrackerView(memo, {}, archive).blocks.find((b) => b.tag === 'QUESTS')?.quests

    it('draws finished quests the memo no longer carries', () => {
        // They are not in the memo — the pass strips a quest the turn it ends —
        // so without this the Completed section could never have anything in it.
        const log = questsOf(ACTIVE_MEMO, [finished()])!
        expect(log.active.map((c) => c.title)).toEqual(['The Missing Sheep'])
        expect(log.completed.map((c) => c.title)).toEqual(['The Rat Cellar'])
    })

    it('separates failed from completed', () => {
        const log = questsOf(ACTIVE_MEMO, [finished({ id: 'x', title: 'The Lost Caravan', status: 'failed' })])!
        expect(log.failed.map((c) => c.title)).toEqual(['The Lost Caravan'])
        expect(log.completed).toEqual([])
    })

    it('counts only the active ones in the header', () => {
        expect(questsOf(ACTIVE_MEMO, [finished()])!.activeCount).toBe(1)
    })

    it('draws the archive when the memo has no quest block left at all', () => {
        // The pass removes the whole block once nothing active remains, so this
        // is the state a campaign reaches by finishing everything — exactly when
        // the archive matters most.
        const memo = '[TIME]\n08:00 AM, Day 2\n[/TIME]'
        const view = buildTrackerView(memo, {}, [finished()])
        const block = view.blocks.find((b) => b.tag === 'QUESTS')

        expect(block?.quests?.completed.map((c) => c.title)).toEqual(['The Rat Cellar'])
        expect(block?.quests?.activeCount).toBe(0)
        expect(view.empty).toBe(false)
    })

    it('lets the memo win when a quest is live again', () => {
        // Reopened by the model, or restored by a swipe the archive has not
        // caught up with. The same quest must not be in two sections at once.
        const log = questsOf(ACTIVE_MEMO, [finished({ id: 'sheep', title: 'The Missing Sheep' })])!
        expect(log.active.map((c) => c.title)).toEqual(['The Missing Sheep'])
        expect(log.completed).toEqual([])
    })

    it('matches a reopened quest on its title when it has no id', () => {
        const memo = ACTIVE_MEMO.replace('  ID: sheep\n', '')
        const log = questsOf(memo, [finished({ id: 'quest_1756000000000_0', title: 'The Missing Sheep' })])!
        expect(log.completed).toEqual([])
    })

    it('keeps an unreadable block as plain lines even with an archive', () => {
        // Fail soft outranks the archive: a model that wrote something the quest
        // grammar cannot read must see its own words, and drawing cards over
        // them would look like the text had been lost.
        const memo = '[QUESTS]\nGo and find the sheep, somehow\n[/QUESTS]'
        const block = buildTrackerView(memo, {}, [finished()]).blocks.find((b) => b.tag === 'QUESTS')!

        expect(block.quests).toBeUndefined()
        expect(block.lines).toHaveLength(1)
    })

    it('hides the archive when the user switched the archive sections off', () => {
        const block = buildTrackerView(ACTIVE_MEMO, { syspromptModules: { questsShowArchive: false } }, [finished()])
            .blocks.find((b) => b.tag === 'QUESTS')!
        expect(block.quests!.completed).toEqual([])
    })

    it('changes nothing when there is no archive', () => {
        expect(questsOf(ACTIVE_MEMO, [])!.completed).toEqual([])
        expect(buildTrackerView(ACTIVE_MEMO).blocks.find((b) => b.tag === 'QUESTS')!.quests!.active).toHaveLength(1)
    })

    it('ignores archive entries with nothing in them', () => {
        const log = questsOf(ACTIVE_MEMO, [null as unknown as Quest, finished({ title: '' })])
        expect(log!.completed).toEqual([])
    })
})
