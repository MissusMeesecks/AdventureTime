import { describe, expect, it } from 'vitest'

import { CARD_AI_EDIT_TEXT } from '../tracker/card-ai-edit.js'
import { createCardAiEdit } from './card-ai-edit.js'

function harness(options: { reply?: string; connection?: string } = {}) {
    const calls: Array<Record<string, unknown>> = []
    const log: string[] = []
    const edit = createCardAiEdit({
        generate: { quiet: async (input) => { calls.push(input); return { content: options.reply ?? 'REVISED' } } },
        prefs: { load: async () => ({ agentConnectionId: options.connection ?? '' }) },
        log: { info: (m) => log.push(m), warn: (m) => log.push(`warn: ${m}`) },
    })
    return { edit, calls, log }
}

describe('Edit with AI’s call (78c)', () => {
    it('sends Multihog’s editor prompt on the agent’s connection and returns the whole revised text', async () => {
        const h = harness({ connection: 'conn-agent', reply: '  [CORE]\nSpecies: Elf\n[/CORE]\n' })
        const result = await h.edit.edit('u1', 'npc', '[CORE]\nSpecies: Human\n[/CORE]', ' make her an elf ')
        expect(result).toEqual({ text: '[CORE]\nSpecies: Elf\n[/CORE]' })
        expect(h.calls).toHaveLength(1)
        expect(h.calls[0]).toMatchObject({ userId: 'u1', connectionId: 'conn-agent' })
        const messages = h.calls[0]!.messages as Array<{ role: string; content: string }>
        expect(messages[0]).toEqual({ role: 'system', content: CARD_AI_EDIT_TEXT.npcSystem })
        expect(messages[1]!.content).toBe('CURRENT NPC ENTRY:\n[CORE]\nSpecies: Human\n[/CORE]\n\nREQUESTED CHANGES:\nmake her an elf\n\nOutput the full revised entry now.')
        expect(h.log[0]).toContain('rewriting an NPC entry with AI from "make her an elf"')
    })

    it('uses the persona prompt for the Player Card, and the host’s own connection when none is set', async () => {
        const h = harness()
        await h.edit.edit(undefined, 'pc', 'Species: Human', 'older')
        expect(h.calls[0]).not.toHaveProperty('connectionId')
        const messages = h.calls[0]!.messages as Array<{ role: string; content: string }>
        expect(messages[0]!.content).toBe(CARD_AI_EDIT_TEXT.pcSystem)
        expect(messages[1]!.content).toBe('CURRENT PERSONA:\nSpecies: Human\n\nREQUESTED CHANGES:\nolder\n\nOutput the full revised persona now.')
    })

    it('refuses blank instructions before any call, and an empty reply after one, in the legacy’s words', async () => {
        const h = harness({ reply: '   ' })
        await expect(h.edit.edit('u1', 'npc', 'x', '  ')).rejects.toThrow('Please describe what you want changed.')
        expect(h.calls).toHaveLength(0)
        await expect(h.edit.edit('u1', 'npc', 'x', 'change')).rejects.toThrow('AI returned an empty result. Please try again.')
        expect(h.calls).toHaveLength(1)
        expect(h.log.at(-1)).toContain('warn: card edit: the model answered with nothing')
    })
})
