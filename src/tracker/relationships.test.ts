import { describe, expect, it } from 'vitest'

import {
    affectionTier,
    agentRelationshipSection,
    buildNpcRelationsBlock,
    clampRelationshipValue,
    extractRelationshipCommands,
    friendshipTier,
    narrativeAwards,
    normalizeRelationshipMax,
    normalizeRelationshipMode,
    relationshipBarPct,
    relationshipCommandInstruction,
    resolveNpcName,
    tierBadgeStyle,
    tierOf,
} from './relationships.js'

describe('the math through the face', () => {
    it('clamps to the scale, normalizes the scale, and fills half the track at the full scale', () => {
        expect(normalizeRelationshipMax('abc')).toBe(150)
        expect(normalizeRelationshipMax(3)).toBe(10)
        expect(normalizeRelationshipMax(99999)).toBe(10000)
        expect(normalizeRelationshipMax(200.4)).toBe(200)
        expect(clampRelationshipValue(999, 150)).toBe(150)
        expect(clampRelationshipValue(-999, 150)).toBe(-150)
        expect(clampRelationshipValue('x', 150)).toBe(0)
        expect(clampRelationshipValue(12.6, 150)).toBe(13)
        expect(relationshipBarPct(150, 150)).toBe(50)
        expect(relationshipBarPct(-75, 150)).toBe(25)
        expect(relationshipBarPct(10, 0)).toBe(0)
    })

    it('names the thirteen tiers of each axis by the fraction of the scale', () => {
        expect(friendshipTier(0, 150)).toEqual({ label: 'NEUTRAL/ACQUAINTANCE', hint: 'civil and transactional, neither warm nor cold' })
        expect(friendshipTier(40, 150).label).toBe('FRIENDLY')
        expect(friendshipTier(150, 150).label).toBe('BONDED/FAMILY')
        expect(friendshipTier(-150, 150).label).toBe('HOSTILE')
        expect(affectionTier(-100, 150).label).toBe('DISGUSTED')
        expect(affectionTier(140, 150).label).toBe('DEEPLY IN LOVE')
        expect(tierOf('affection', 20, 150).label).toBe('RECEPTIVE/FLIRTATIOUS')
        // The scale moves the thresholds with it.
        expect(friendshipTier(40, 1000).label).toBe('WARMING/FAVORABLE')
        expect(tierBadgeStyle('friendship', 0, 150)).toContain('var(--rt-text-muted')
        expect(tierBadgeStyle('friendship', 100, 150)).toMatch(/^color:hsl\(142,/)
        expect(tierBadgeStyle('affection', -100, 150)).toMatch(/^color:hsl\(275,/)
    })
})

describe('the tracker\'s command block', () => {
    it('reads the lines and strips the block, an unclosed block to the end', () => {
        const reply = '<memo>[TIME]\nDay 1\n[/TIME]</memo>\n[RELATIONS]\nFriendship +5 Marcus Vane\naffection -2 Elena\nFriendship5 Bob\nnonsense\nFriendship +0 Nobody\n[/RELATIONS]\ntail'
        const { memo, commands } = extractRelationshipCommands(reply)
        expect(memo).toBe('<memo>[TIME]\nDay 1\n[/TIME]</memo>\n\ntail')
        expect(commands).toEqual([
            { npc: 'Marcus Vane', field: 'friendship', delta: 5 },
            { npc: 'Elena', field: 'affection', delta: -2 },
            { npc: 'Bob', field: 'friendship', delta: 5 },
        ])
        expect(extractRelationshipCommands('memo [RELATIONS]\nAffection +3 Kes')).toEqual({ memo: 'memo', commands: [{ npc: 'Kes', field: 'affection', delta: 3 }] })
        expect(extractRelationshipCommands('')).toEqual({ memo: '', commands: [] })
        expect(extractRelationshipCommands(null)).toEqual({ memo: '', commands: [] })
    })

    it('asks for the block with the scale in the instruction, or a custom text with the placeholders filled', () => {
        const text = relationshipCommandInstruction(150)
        expect(text.startsWith('## RELATIONSHIP DELTA COMMANDS\nThe GM narrator is authoritative for relationship points.')).toBe(true)
        expect(text.endsWith('Each command is clamped to -150 through +150.')).toBe(true)
        expect(relationshipCommandInstruction(200, ' Scale {{max}}; {{full_audit_rule}} ')).toBe('Scale 200; The GM narrator is authoritative for relationship points. Only convert its explicit relationship annotations; never infer, award, adjust, or omit a delta yourself.')
        const agent = agentRelationshipSection(150)
        expect(agent.startsWith('## NPC RELATIONSHIPS')).toBe(true)
        expect(agent).toContain('Valid range: -150 to +150.')
        expect(agent).toContain('+45 to +90')
        expect(agentRelationshipSection(1000)).toContain('+300 to +600')
    })
})

describe('the narrator\'s annotations', () => {
    it('reads the awards once each, the asterisks optional, a reason ignored, a zero skipped', () => {
        const text = 'He grinned. *(Friendship: Marcus +10 — saved his life in the alley)* Later *(Affection: Elena Brightforge -2 — she flinched)* and (friendship: Horgath the Warrior +0) and *(Friendship: Marcus +10 — saved his life in the alley)* again (Affection : Kes 7).'
        expect(narrativeAwards(text)).toEqual([
            { npc: 'Marcus', field: 'friendship', delta: 10 },
            { npc: 'Elena Brightforge', field: 'affection', delta: -2 },
            { npc: 'Kes', field: 'affection', delta: 7 },
        ])
        expect(narrativeAwards('(Friendship: Marcus +10) (Friendship: Marcus +10 — twice)')).toHaveLength(2)
        expect(narrativeAwards('')).toEqual([])
    })
})

describe('who is meant', () => {
    const ENTRIES = [
        { id: 'B::1', label: '[Major] Ser Holdyn', keys: ['Holdyn', 'the knight'] },
        { id: 'B::2', label: 'Elena Brightforge', keys: ['Elena'] },
        { id: 'B::3', label: 'Bo', keys: [] },
        { id: 'B::4', label: 'Elena', keys: [] },
    ]

    it('takes an exact label first, then the nearest containing label or keyword, three letters or more', () => {
        expect(resolveNpcName('elena brightforge', ENTRIES)!.id).toBe('B::2')
        expect(resolveNpcName('Elena', ENTRIES)!.id).toBe('B::4')
        expect(resolveNpcName('Holdyn', ENTRIES)!.id).toBe('B::1')
        expect(resolveNpcName('Ser Holdyn the Brave', ENTRIES)!.id).toBe('B::1')
        expect(resolveNpcName('the knight', ENTRIES)!.id).toBe('B::1')
        expect(resolveNpcName('Brightforge', ENTRIES)!.id).toBe('B::2')
        expect(resolveNpcName('Bo', ENTRIES)!.id).toBe('B::3')
        expect(resolveNpcName('Bob', ENTRIES)).toBeNull()
        expect(resolveNpcName('Nobody', ENTRIES)).toBeNull()
        expect(resolveNpcName('  ', ENTRIES)).toBeNull()
    })
})

describe('the standings', () => {
    it('says nobody is tracked, or lists every NPC with both values and both tiers for the narrator', () => {
        expect(buildNpcRelationsBlock([], 150)).toBe('[NPC_RELATIONS]\nNo established relationships yet.\n[/NPC_RELATIONS]')
        const block = buildNpcRelationsBlock([{ id: 'B::1', label: 'Marcus', friendship: 40, affection: -5 }, { id: 'B::2', label: 'Elena', friendship: 999, affection: 0 }], 150)
        expect(block).toBe([
            '[NPC_RELATIONS]',
            'Current relationship standings between the protagonist and present NPCs. Both axes range from -150 to +150. Let the tier descriptions below each NPC guide how they behave toward {{user}} this turn.',
            '',
            'Marcus: Friendship +40, Affection -5',
            '  Friendship tier: FRIENDLY — genuine warmth, light humor, willing to help when asked',
            '  Affection tier: INDIFFERENT/UNINTERESTED — no romantic spark, gentle deflection of any advances',
            '',
            'Elena: Friendship +150, Affection +0',
            '  Friendship tier: BONDED/FAMILY — unbreakable loyalty, would risk life without hesitation, shares deepest secrets',
            '  Affection tier: NEUTRAL/NO AFFECTION — no romantic or emotional attachment toward you',
            '[/NPC_RELATIONS]',
        ].join('\n'))
        expect(normalizeRelationshipMode('regex')).toBe('regex')
        expect(normalizeRelationshipMode('nope')).toBe('state_tracker')
    })
})
