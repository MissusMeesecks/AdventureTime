import { describe, expect, it } from 'vitest'

import {
    AUDIT_INSTRUCTION, auditChunkLimit, chunkForAudit, cleanupContext, cleanupReason, cleanupSystemPrompt,
    countBloated, countRedundantPairs, estimateTokens, flagEntries, nothingToClean,
} from './cleanup.js'

const entry = (uid: string, content: string, comment = '', key: string[] = []) => ({ uid, content, comment, key })

describe('the cleanup pass’s pieces (71c)', () => {
    it('estimates tokens at four characters each and counts near-duplicate lines', () => {
        expect(estimateTokens('abcdefgh')).toBe(2)
        expect(estimateTokens('abcdefghi')).toBe(3)
        expect(estimateTokens('')).toBe(0)
        expect(countRedundantPairs('the guard watches the gate\nthe guard watches the gate at night\nsomething else entirely')).toBe(1)
        expect(countRedundantPairs('[Day 2] the guard watches the gate\n[Day 3] the guard watches the gate')).toBe(1)
        expect(countRedundantPairs('one\ntwo')).toBe(0)
    })

    it('writes the archivist’s prompt with the ACTIONS text, and the custom requirements between when given', () => {
        const plain = cleanupSystemPrompt()
        expect(plain.startsWith('You are the Lorebook Archivist.')).toBe(true)
        expect(plain).toContain('12. Call commit exactly once at the end.')
        expect(plain).toContain('\n\n## ACTIONS\nYou do NOT have access to native function calling.')
        expect(plain).not.toContain('USER CUSTOM REQUIREMENTS')
        const custom = cleanupSystemPrompt('  keep the quest status short  ')
        expect(custom).toContain('12. Call commit exactly once at the end. Do not call it per-entry.\n\n## USER CUSTOM REQUIREMENTS\nYou MUST adhere strictly to these custom compression instructions:\n- keep the quest status short\n\n## ACTIONS')
        expect(cleanupSystemPrompt('   ')).toBe(plain)
    })

    it('flags the entries over the threshold, biggest first, the world books skipped and a map not counted', () => {
        const long = 'x'.repeat(1300)
        const books = [
            { name: 'Vell_NPC', entries: [entry('a', long, 'Bram'), entry('b', 'short', 'Ivo', ['ivo'])] },
            { name: 'Vell_LOC', entries: [entry('c', `${'y'.repeat(800)}\n[MAP]${'m'.repeat(5000)}[/MAP]`, 'Cellar')] },
            { name: 'Vell_World', entries: [entry('d', long, 'Day 3')] },
            { name: 'Vell_Skeleton', entries: [entry('e', long, 'Seed')] },
        ]
        const flagged = flagEntries(books, { threshold: 300, useThreshold: true })
        expect(flagged.map((f) => f.id)).toEqual(['Vell_NPC::a'])
        expect(flagged[0]).toMatchObject({ label: 'Bram', tokens: 325, lines: 1, pairs: 0 })
        // The map is left out of the count (800 chars = 200 tokens, under 300) and kept in the content.
        const everything = flagEntries(books, { threshold: 300, useThreshold: false })
        expect(everything.map((f) => f.id)).toEqual(['Vell_NPC::a', 'Vell_LOC::c', 'Vell_NPC::b'])
        expect(everything[1]!.tokens).toBe(200)
        expect(everything[1]!.content).toContain('[MAP]')
        expect(everything[2]!.label).toBe('Ivo')
        expect(countBloated(books, 300)).toBe(1)
        expect(countBloated(books, 100)).toBe(2)
        // At the threshold exactly is flagged: the legacy's `>=`.
        const edge = [{ name: 'Vell_NPC', entries: [entry('e', 'x'.repeat(1200), 'Edge'), entry('u', 'x'.repeat(1196), 'Under')] }]
        expect(flagEntries(edge, { threshold: 300, useThreshold: true }).map((f) => f.id)).toEqual(['Vell_NPC::e'])
    })

    it('flags the one entry named whatever its size, and nothing when it is not there', () => {
        const books = [{ name: 'Vell_NPC', entries: [entry('a', 'tiny', 'Bram'), entry('b', 'x'.repeat(2000), 'Big')] }]
        expect(flagEntries(books, { threshold: 300, useThreshold: true, target: 'Vell_NPC::a' }).map((f) => f.id)).toEqual(['Vell_NPC::a'])
        expect(flagEntries(books, { threshold: 300, useThreshold: true, target: 'Vell_NPC::zz' })).toEqual([])
        const unlabelled = flagEntries([{ name: 'B', entries: [entry('u', 'text')] }], { threshold: 1, useThreshold: false })
        expect(unlabelled[0]!.label).toBe('u')
    })

    it('writes the context as the legacy does and names the empty cases', () => {
        const flagged = flagEntries(
            [{ name: 'Vell_NPC', entries: [entry('a', 'same line here\nsame line here too\nother', 'Bram'), entry('b', 'alone', 'Ivo')] }],
            { threshold: 1, useThreshold: false },
        )
        const context = cleanupContext(flagged)
        expect(context).toBe(
            '## ENTRIES FLAGGED FOR CONSOLIDATION\n'
            + '- Vell_NPC::a | "Bram" | ~10 tokens | 3 lines | ⚠ 1 redundant line pairs\n'
            + '- Vell_NPC::b | "Ivo" | ~2 tokens | 1 lines | ✓ low redundancy\n\n'
            + '## ENTRY CONTENTS\n'
            + '### Vell_NPC::a — "Bram"\nsame line here\nsame line here too\nother\n\n'
            + '### Vell_NPC::b — "Ivo"\nalone',
        )
        expect(nothingToClean({ threshold: 300, useThreshold: true, target: 'B::1' })).toBe('Cleanup: targeted entry "B::1" not found.')
        expect(nothingToClean({ threshold: 300, useThreshold: true })).toBe('Cleanup: no entries exceed the token threshold (300t). Nothing to do.')
        expect(nothingToClean({ threshold: 300, useThreshold: false })).toBe('Cleanup: no entries found in the campaign lorebook. Nothing to do.')
        expect(cleanupReason('B::1')).toBe('Targeted cleanup: B::1.')
        expect(cleanupReason(undefined)).toBe('Cleanup pass (agent mode).')
    })
})

describe('the full audit’s chunking (71c)', () => {
    it('carries the legacy’s instruction', () => {
        expect(AUDIT_INSTRUCTION.startsWith('FULL AUDIT: Reconstruct lore from this history chunk.')).toBe(true)
    })

    it('keeps the context size less 3000, never under 1000', () => {
        expect(auditChunkLimit(32000)).toBe(29000)
        expect(auditChunkLimit(2000)).toBe(1000)
    })

    it('cuts the lines at the budget, never splits one, and leaves out empty lines and JSON fences', () => {
        const lines = [
            { name: 'Player', text: 'a'.repeat(40) },   // 10 + 2 = 12 tokens ("Player: " is 8 chars)
            { name: 'Narrator', text: '   ' },
            { name: 'Narrator', text: '```json\n[1]```' },
            { name: 'Narrator', text: 'b'.repeat(40) }, // 12 tokens
            { name: 'Player', text: 'c'.repeat(400) },  // over any small budget on its own
            { name: 'Narrator', text: 'd' },
        ]
        const chunks = chunkForAudit(lines, 20)
        expect(chunks).toEqual([
            [`Player: ${'a'.repeat(40)}`],
            [`Narrator: ${'b'.repeat(40)}`],
            [`Player: ${'c'.repeat(400)}`],
            ['Narrator: d'],
        ])
        expect(chunkForAudit(lines, 100000)).toHaveLength(1)
        expect(chunkForAudit(lines, 100000)[0]).toHaveLength(4)
        expect(chunkForAudit([], 100)).toEqual([])
        expect(chunkForAudit([{ name: 'Narrator', text: '```json\n{"a":1}' }], 100)).toEqual([])
        // A first line over the budget is a chunk of its own, never an empty chunk before it.
        expect(chunkForAudit([{ name: 'Player', text: 'c'.repeat(400) }, { name: 'Narrator', text: 'd' }], 20)).toEqual([[`Player: ${'c'.repeat(400)}`], ['Narrator: d']])
    })
})
