import { describe, expect, it } from 'vitest'

import {
    applyBenchCommands,
    compactBenchedPartyForContext,
    dedupePartyAgainstBenched,
    extractBenchCommands,
    hydratePartyRelocationStats,
    isBenchCommandOnlyContent,
    splitPartyMemberEntries,
} from './bench.js'
import { mergeMemo, mergeMemoDetailed } from './merge.js'

const GARETH = [
    '- Gareth (Fighter 3): 28/30 HP',
    'Combat: BAB: +3 | Melee: +5 | Base AC: 14 | Total AC: 16',
    'Gear: Longsword (1d8+3) | Chain Shirt (+4 AC)',
    'Status: Healthy',
].join('\n')
const ROBIN = [
    '- Robin Fletcher (Rogue 2): 18/18 HP',
    'Combat: BAB: +1 | Ranged: +5 | Base AC: 12 | Total AC: 14',
    'Status: (+) Blessed (+1d4 saves, 1h)',
].join('\n')
const PRIOR = `[TIME]\n06:15 AM, Day 4\n[/TIME]\n\n[PARTY]\n${GARETH}\n${ROBIN}\n[/PARTY]`
const BENCHED_GARETH = GARETH.replace('Status: Healthy', 'Status: Benched (06:15 AM, Day 4, resting)')
const PRIOR_BENCHED = `[TIME]\n07:00 AM, Day 4\n[/TIME]\n\n[PARTY]\n${ROBIN}\n[/PARTY]\n\n[BENCHED PARTY]\n${BENCHED_GARETH}\n[/BENCHED PARTY]`

describe('reading the commands', () => {
    it('finds bench and unbench lines, with the reason after the dash', () => {
        expect(extractBenchCommands('[BENCHED PARTY]\n[BENCH] Gareth — stayed to rest\n[UNBENCH] Robin\n[/BENCHED PARTY]')).toEqual({
            benches: [{ name: 'Gareth', reason: 'stayed to rest' }],
            unbenches: ['Robin'],
        })
    })

    it('tolerates a list bullet and a plain hyphen, and no reason at all', () => {
        expect(extractBenchCommands('- [BENCH] Gareth - resting').benches).toEqual([{ name: 'Gareth', reason: 'resting' }])
        expect(extractBenchCommands('[BENCH] Gareth').benches).toEqual([{ name: 'Gareth', reason: '' }])
        expect(extractBenchCommands('nothing here')).toEqual({ benches: [], unbenches: [] })
    })

    it('knows a block that is only commands from one that is a roster', () => {
        expect(isBenchCommandOnlyContent('[BENCH] Gareth — resting\n- [UNBENCH] Robin')).toBe(true)
        expect(isBenchCommandOnlyContent('- Gareth: Benched (resting)')).toBe(false)
        expect(isBenchCommandOnlyContent('REMOVED')).toBe(false)
        expect(isBenchCommandOnlyContent('')).toBe(false)
    })
})

describe('the member grammar', () => {
    it('splits on header lines only, never on a sub-field', () => {
        const entries = splitPartyMemberEntries(`${GARETH}\n${ROBIN}`)
        expect(entries.map((e) => e.name)).toEqual(['Gareth (Fighter 3)', 'Robin Fletcher (Rogue 2)'])
        expect(entries[0]!.lines).toHaveLength(4)
    })

    it('reads a compact benched header and a marker-wrapped HP header', () => {
        expect(splitPartyMemberEntries('- Gareth: Benched (resting)')[0]!.name).toBe('Gareth')
        expect(splitPartyMemberEntries('- Alice: ((BAR)) 100/100 HP\nStatus: Healthy')[0]!.name).toBe('Alice')
    })

    it('is empty for an erasure word', () => {
        expect(splitPartyMemberEntries('REMOVED')).toEqual([])
    })
})

describe('benching', () => {
    it('moves the full sheet out of the party and stamps the time and reason', () => {
        const out = applyBenchCommands(PRIOR, PRIOR, { benches: [{ name: 'Gareth', reason: 'stayed to rest' }], unbenches: [] })
        expect(out).toContain('[BENCHED PARTY]\n- Gareth (Fighter 3): 28/30 HP\nCombat: BAB: +3')
        expect(out).toContain('Status: Benched (06:15 AM, Day 4, stayed to rest)')
        expect(out.match(/Gareth/g)).toHaveLength(1)
        expect(out).toContain('[PARTY]\n- Robin Fletcher')
    })

    it('matches a first name to a full header, and a full header to itself', () => {
        expect(applyBenchCommands(PRIOR, PRIOR, { benches: [{ name: 'Robin', reason: 'scouting' }], unbenches: [] })).toContain('[BENCHED PARTY]\n- Robin Fletcher (Rogue 2)')
        expect(applyBenchCommands(PRIOR, PRIOR, { benches: [{ name: 'Robin Fletcher (Rogue 2)', reason: 'scouting' }], unbenches: [] })).toContain('[BENCHED PARTY]\n- Robin Fletcher')
    })

    it('leaves the memo alone for a name nobody has', () => {
        expect(applyBenchCommands(PRIOR, PRIOR, { benches: [{ name: 'Nobody', reason: 'x' }], unbenches: [] })).toBe(PRIOR)
    })

    // The first live bench: the narrator says "Oswin", the roster says
    // "Advisor Oswin", and the legacy's start-of-header match finds nobody.
    it('matches a word from anywhere in the header when it names one member', () => {
        const OSWIN = '- Advisor Oswin (Expert 1): 6/6 HP\nCombat: BAB: +0\nStatus: Healthy'
        const prior = `[PARTY]\n${GARETH}\n${OSWIN}\n[/PARTY]`
        const out = applyBenchCommands(prior, prior, { benches: [{ name: 'Oswin', reason: 'to the village' }], unbenches: [] })
        expect(out).toContain('[BENCHED PARTY]\n- Advisor Oswin (Expert 1): 6/6 HP')
        expect(out).not.toMatch(/\[PARTY\][^]*Oswin[^]*\[\/PARTY\]/)
        // And back again by the same word.
        expect(applyBenchCommands(out, out, { benches: [], unbenches: ['oswin'] })).toContain('[PARTY]\n- Gareth (Fighter 3): 28/30 HP')
        // Every word of the query must be in the name; the class in brackets is not a name.
        expect(applyBenchCommands(prior, prior, { benches: [{ name: 'Oswin the Elder', reason: '' }], unbenches: [] })).toBe(prior)
        expect(applyBenchCommands(prior, prior, { benches: [{ name: 'Expert', reason: '' }], unbenches: [] })).toBe(prior)
    })

    it('refuses a word two members share rather than guess', () => {
        // A shared *leading* word is the legacy's own prefix rule and takes the
        // first header, as it always did; the word rule only sees what that
        // rule missed, so the shared word here is the second one.
        const TOM = '- Tom Guard (Warrior 1): 10/10 HP\nStatus: Healthy'
        const ANN = '- Ann Guard (Warrior 1): 10/10 HP\nStatus: Healthy'
        const prior = `[PARTY]\n${TOM}\n${ANN}\n[/PARTY]`
        expect(applyBenchCommands(prior, prior, { benches: [{ name: 'Guard', reason: '' }], unbenches: [] })).toBe(prior)
        expect(applyBenchCommands(prior, prior, { benches: [{ name: 'Ann', reason: '' }], unbenches: [] })).toContain('[BENCHED PARTY]\n- Ann Guard')
    })

    it('still prefers the legacy match when both would apply', () => {
        // "Robin" starts one header and is a word in none other; the start
        // rule answers first and the word rule never runs.
        const ROBIN2 = '- Marian Robin (Bard 1): 9/9 HP\nStatus: Healthy'
        const prior = `[PARTY]\n${ROBIN}\n${ROBIN2}\n[/PARTY]`
        expect(applyBenchCommands(prior, prior, { benches: [{ name: 'Robin', reason: '' }], unbenches: [] })).toContain('[BENCHED PARTY]\n- Robin Fletcher')
    })

    it('strips the party block when the last member is benched', () => {
        const solo = `[PARTY]\n${GARETH}\n[/PARTY]`
        const out = applyBenchCommands(solo, solo, { benches: [{ name: 'Gareth', reason: 'away' }], unbenches: [] })
        expect(out).not.toContain('[PARTY]')
        expect(out).toContain('[BENCHED PARTY]')
        expect(out).toContain('Benched (unknown time, away)')
    })

    it('takes the sheet from the prior memo when the pass already dropped the member', () => {
        const dropped = PRIOR.replace(`${GARETH}\n`, '')
        const out = applyBenchCommands(PRIOR, dropped, { benches: [{ name: 'Gareth', reason: 'resting' }], unbenches: [] })
        expect(out).toContain('[BENCHED PARTY]\n- Gareth (Fighter 3): 28/30 HP\nCombat:')
    })
})

describe('unbenching', () => {
    it('brings the sheet back with a healthy status and drops the empty benched block', () => {
        const out = applyBenchCommands(PRIOR_BENCHED, PRIOR_BENCHED, { benches: [], unbenches: ['Gareth'] })
        expect(out).not.toContain('[BENCHED PARTY]')
        expect(out).toContain('- Gareth (Fighter 3): 28/30 HP\nCombat: BAB: +3')
        expect(out).toContain('Status: Healthy')
        expect(out).not.toContain('Benched (')
    })

    it('does not resurrect a member the same turn benched', () => {
        const out = applyBenchCommands(PRIOR, PRIOR, {
            benches: [{ name: 'Gareth', reason: 'away' }],
            unbenches: ['Robin'],
        })
        expect(out.match(/Gareth/g)).toHaveLength(1)
        expect(out).toContain('[BENCHED PARTY]\n- Gareth')
    })
})

describe('one roster, not two', () => {
    it('drops a member from the party when the benched block also has them', () => {
        const both = `[PARTY]\n${GARETH}\n${ROBIN}\n[/PARTY]\n\n[BENCHED PARTY]\n${BENCHED_GARETH}\n[/BENCHED PARTY]`
        const out = dedupePartyAgainstBenched(both)
        expect(out).toContain('[PARTY]\n- Robin Fletcher')
        expect(out).not.toContain('[PARTY]\n- Gareth')
    })
})

describe('the compact roster the models see', () => {
    it('reduces a benched member to name and status', () => {
        expect(compactBenchedPartyForContext(PRIOR_BENCHED)).toContain('[BENCHED PARTY]\n- Gareth (Fighter 3): Benched (06:15 AM, Day 4, resting)\n[/BENCHED PARTY]')
        expect(compactBenchedPartyForContext(PRIOR_BENCHED)).not.toContain('Longsword')
    })

    it('leaves the block out entirely with the module off, and a memo without one alone', () => {
        expect(compactBenchedPartyForContext(PRIOR_BENCHED, false)).not.toContain('BENCHED PARTY')
        expect(compactBenchedPartyForContext(PRIOR)).toBe(PRIOR)
    })
})

describe('hydrating a bare header', () => {
    it('restores the full sheet from the prior memo, keeping the new status', () => {
        const merged = PRIOR_BENCHED.replace(BENCHED_GARETH, '- Gareth (Fighter 3): 28/30 HP\nStatus: Benched (07:00 AM, Day 4, still resting)')
        const out = hydratePartyRelocationStats(PRIOR_BENCHED, merged)
        expect(out).toContain('- Gareth (Fighter 3): 28/30 HP\nCombat: BAB: +3')
        expect(out).toContain('Status: Benched (07:00 AM, Day 4, still resting)')
    })

    // A legacy quirk, kept because the pin test holds the port to it: a
    // compact header re-emitted by the tracker (`- Name: Benched (...)`) is
    // read as the status line whole, name included. The tracker is told to
    // emit commands, never this line, so it is rare; it is recorded here so
    // nobody "fixes" the port into disagreeing with the original.
    it('takes a re-emitted compact header as the status, name and all, as the legacy does', () => {
        const merged = PRIOR_BENCHED.replace(BENCHED_GARETH, '- Gareth (Fighter 3): Benched (07:00 AM, Day 4, still resting)')
        const out = hydratePartyRelocationStats(PRIOR_BENCHED, merged)
        expect(out).toContain('Combat: BAB: +3')
        expect(out).toContain('Status: Gareth (Fighter 3): Benched (07:00 AM, Day 4, still resting)')
    })

    it('restores a member the pass put back in the party by name alone, as healthy', () => {
        const merged = `[PARTY]\n${ROBIN}\n- Gareth (Fighter 3): 28/30 HP\n[/PARTY]`
        const out = hydratePartyRelocationStats(PRIOR_BENCHED, merged)
        expect(out).toContain('- Gareth (Fighter 3): 28/30 HP\nCombat: BAB: +3')
        expect(out).toContain('Status: Healthy')
    })

    it('leaves a block it cannot parse exactly as written', () => {
        const merged = '[PARTY]\nsome custom roster format\n[/PARTY]'
        expect(hydratePartyRelocationStats(PRIOR, merged)).toBe(merged)
    })
})

describe('through the merge', () => {
    const output = '[BENCHED PARTY]\n[BENCH] Gareth — stayed at the lodging to rest\n[/BENCHED PARTY]'

    it('applies commands instead of storing them, with benching on', () => {
        const out = mergeMemo(PRIOR, output, { bench: true })
        expect(out).not.toContain('[BENCH]')
        expect(out).toContain('[BENCHED PARTY]\n- Gareth (Fighter 3): 28/30 HP')
    })

    // With the module off the legacy still drops a command-only block rather
    // than storing it, and applies nothing: the roster is untouched.
    it('drops the commands and moves nobody with benching off, as the legacy does with the module off', () => {
        const out = mergeMemo(PRIOR, output, { bench: false })
        expect(out).not.toContain('[BENCH]')
        expect(out).not.toContain('[BENCHED PARTY]')
        expect(out).toContain(`[PARTY]\n${GARETH}`)
    })

    it('applies commands that arrive with no closed block at all', () => {
        const out = mergeMemo(PRIOR, '- [BENCH] Robin — scouting ahead', { bench: true })
        expect(out).toContain('[BENCHED PARTY]\n- Robin Fletcher')
    })

    it('still changes nothing for prose, with benching on', () => {
        expect(mergeMemo(PRIOR, 'No changes this turn.', { bench: true })).toBe(PRIOR)
    })

    // "updated PARTY" is also what losing a member reads as, so who moved is
    // reported by name -- from the memo, so a hand-moved member counts too.
    it('names who was benched and who came back', () => {
        const benched = mergeMemoDetailed(PRIOR, output, { bench: true })
        expect(benched.benched).toEqual(['Gareth (Fighter 3)'])
        expect(benched.unbenched).toEqual([])
        const back = mergeMemoDetailed(PRIOR_BENCHED, '[BENCHED PARTY]\n[UNBENCH] Gareth\n[/BENCHED PARTY]', { bench: true })
        expect(back.unbenched).toEqual(['Gareth (Fighter 3)'])
        expect(back.benched).toEqual([])
        const quiet = mergeMemoDetailed(PRIOR, '[TIME]\n07:00 AM, Day 4\n[/TIME]', { bench: true })
        expect(quiet.benched).toEqual([])
        expect(quiet.unbenched).toEqual([])
        // Someone already benched who stays benched is not news.
        const staying = mergeMemoDetailed(PRIOR_BENCHED, '[TIME]\n08:00 AM, Day 4\n[/TIME]', { bench: true })
        expect(staying.benched).toEqual([])
        expect(staying.unbenched).toEqual([])
        // Commands with no closed block move people too, and say so.
        const bare = mergeMemoDetailed(PRIOR, '- [BENCH] Robin — scouting ahead', { bench: true })
        expect(bare.benched).toEqual(['Robin Fletcher (Rogue 2)'])
    })

    it('names a command that moved nobody', () => {
        // A silent skip reads exactly like a bench that worked and scrolled
        // off the card, which is how the first live bench was reported.
        const nobody = mergeMemoDetailed(PRIOR, '[BENCHED PARTY]\n[BENCH] Oswin — to the village\n[/BENCHED PARTY]', { bench: true })
        expect(nobody.unmatched).toEqual(['Oswin'])
        expect(nobody.benched).toEqual([])
        expect(nobody.noChange).toBe(true)
        // With a block beside it, the same.
        const mixed = mergeMemoDetailed(PRIOR, '[TIME]\n07:00 AM, Day 4\n[/TIME]\n[BENCH] Oswin\n[UNBENCH] Marian', { bench: true })
        expect(mixed.unmatched).toEqual(['Oswin', 'Marian'])
        // A member who moved is on the roster they moved to, so not reported.
        expect(mergeMemoDetailed(PRIOR, output, { bench: true }).unmatched).toEqual([])
        // Nor is one already where the command wants them.
        expect(mergeMemoDetailed(PRIOR_BENCHED, '[BENCH] Gareth', { bench: true }).unmatched).toEqual([])
        // Benching off: the commands are dropped, and nothing is unmatched.
        expect(mergeMemoDetailed(PRIOR, '[BENCH] Oswin', { bench: false }).unmatched).toEqual([])
        expect(mergeMemoDetailed(PRIOR, '[TIME]\n07:00 AM, Day 4\n[/TIME]', { bench: true }).unmatched).toEqual([])
    })

    it('names a member the tracker moved by hand', () => {
        const byHand = `[BENCHED PARTY]\n- Robin Fletcher (Rogue 2): Benched (07:00 AM, Day 4, scouting)\n[/BENCHED PARTY]`
        expect(mergeMemoDetailed(PRIOR, byHand, { bench: false }).benched).toEqual(['Robin Fletcher (Rogue 2)'])
    })
})
