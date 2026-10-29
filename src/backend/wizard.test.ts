import { describe, expect, it, vi } from 'vitest'

import { RT_USER_MACRO_SENTINEL } from '../tracker/wizard-legacy-sentinel.js'
import type { WizardDraft } from '../tracker/wizard.js'
import { createWizard, type WizardDeps } from './wizard.js'

const REPLY = '<meta name="Heat" icon="🔥" needs_tracker="true" driver_time="true" driver_gm_annotation="false" driver_stated_fact="false" effect_owner="tracker"/>\n<gm_section tag="heat">\nYou watch Poppy. __RT_USER_MACRO__ rests.\n</gm_section>\n<tracker_module tag="HEAT" label="Heat" icon="🔥">\nYou maintain heat.\n[HEAT]\n- Heat: ((BAR)) 1/10\n[/HEAT]\n</tracker_module>'

function harness(reply: string | Error = REPLY, over: Partial<WizardDeps> = {}) {
    const calls: Array<Record<string, unknown>> = []
    const deps: WizardDeps = {
        generate: {
            quiet: vi.fn(async (input: Record<string, unknown>) => {
                calls.push(input)
                if (reply instanceof Error) throw reply
                return { content: reply }
            }),
        },
        chat: { getMessages: async () => [{ role: 'user', name: 'Wrenna', content: 'I open the door.' }, { role: 'assistant', content: 'Locked.' }] },
        memo: async () => '[TIME]\n07:00 AM\n[/TIME]',
        userName: async () => 'Poppy',
        log: { info: vi.fn(), warn: vi.fn() },
        ...over,
    }
    return { wizard: createWizard(deps), calls, deps }
}
const messagesOf = (call: Record<string, unknown>) => call.messages as Array<{ role: string; content: string }>
const base = { chatId: 'c1', userId: 'u1', lookback: 5, injectMemo: true }

describe('drafting a system', () => {
    it('sends the architect prompt with the story and the memo, {{user}} shielded, on the connection asked', async () => {
        const { wizard, calls } = harness()
        const draft = await wizard.draft({ ...base, description: 'a heat meter', effectOwner: 'gm', connectionId: 'conn-9' })
        const [system, user] = messagesOf(calls[0]!)
        expect(system!.content).toContain('You are a game-system architect')
        expect(system!.content).toContain('effect_owner="gm" (GM section owns threshold effects')
        expect(system!.content).not.toContain('{{user}}')
        expect(system!.content).toContain(RT_USER_MACRO_SENTINEL)
        expect(user!.content).toContain('<story_context>\nUSER (Wrenna):\nI open the door.')
        // The description is a prompt too: a {{user}} in it must not be resolved either.
        const shielded = await wizard.draft({ ...base, description: 'a meter for {{user}}', effectOwner: 'gm' })
        expect(shielded).toBeTruthy()
        expect(messagesOf(calls[1]!)[1]!.content).not.toContain('{{user}}')
        expect(messagesOf(calls[1]!)[1]!.content).toContain(`a meter for ${RT_USER_MACRO_SENTINEL}`)
        expect(user!.content).toContain('<state_memo>\n[TIME]')
        expect(user!.content.endsWith('Describe the mechanic:\na heat meter')).toBe(true)
        expect(calls[0]).toMatchObject({ chatId: 'c1', userId: 'u1', connection_id: 'conn-9' })
        // The reply comes back with the macro restored and the name mapped to it.
        expect(draft.gmContent).toBe('<heat>\nYou watch {{user}}. {{user}} rests.\n</heat>')
        expect(draft.trackerTag).toBe('HEAT')
    })

    it('the context switches (73g): the module examples first, every message, the host’s active lore under its titles, the memo, then the task', async () => {
        const { wizard, calls, deps } = harness(REPLY, {
            chat: { getMessages: async () => [{ role: 'user', name: 'Wrenna', content: 'One.' }, { role: 'assistant', content: 'Two.' }, { role: 'user', content: 'Three.' }] },
            settings: async () => ({ modules: { xp: true }, stockPrompts: { xp: 'XP text' } }),
            activeLore: async (chatId, userId) => { calls.push({ lore: [chatId, userId] }); return [{ title: '[LOC] Hollow Barrow [msg #3]', content: ' A tomb. ' }, { title: 'Empty', content: '  ' }] },
        })
        await wizard.draft({ chatId: 'c1', userId: 'u1', description: 'heat', effectOwner: 'tracker', lookback: 1, lookbackAll: true, injectMemo: true, injectLore: true, injectModulePrompts: true, moduleExampleKeys: ['stock:XP'] })
        const user = (calls[1]!.messages as Array<{ role: string; content: string }>).find((m) => m.role === 'user')!.content
        expect(calls[0]).toEqual({ lore: ['c1', 'u1'] })
        expect(user.indexOf('=== EXISTING MODULE PROMPTS')).toBe(0)
        expect(user).toContain('[XP] (Stock Module)\nPrompt:\nXP text')
        expect(user).toContain('<story_context>\nUSER (Wrenna):\nOne.\n\nASSISTANT:\nTwo.\n\nUSER:\nThree.\n</story_context>')
        expect(user).toContain('<active_lore>\n### Hollow Barrow\nA tomb.\n</active_lore>')
        expect(user.indexOf('<story_context>')).toBeLessThan(user.indexOf('<active_lore>'))
        expect(user.indexOf('<active_lore>')).toBeLessThan(user.indexOf('<state_memo>'))
        expect(user.indexOf('<state_memo>')).toBeLessThan(user.indexOf('Describe the mechanic'))
        // Switched off: none of the three, and the lore reader is not asked.
        calls.length = 0
        await wizard.draft({ chatId: 'c1', userId: 'u1', description: 'heat', effectOwner: 'tracker', lookback: 1, injectMemo: false, moduleExampleKeys: ['stock:XP'] })
        const plain = (calls[0]!.messages as Array<{ role: string; content: string }>).find((m) => m.role === 'user')!.content
        expect(plain).not.toContain('EXISTING MODULE PROMPTS')
        expect(plain).not.toContain('<active_lore>')
        expect(plain).toContain('<story_context>\nUSER:\nThree.\n</story_context>')
        expect(calls.some((c) => 'lore' in c)).toBe(false)
        // A lore read or a cartridge read that fails is logged and left out.
        const failing = harness(REPLY, { settings: async () => { throw new Error('no cartridge') }, activeLore: async () => { throw new Error('no host') } })
        await failing.wizard.draft({ chatId: 'c1', userId: 'u1', description: 'heat', effectOwner: 'tracker', lookback: 0, injectMemo: false, injectLore: true, injectModulePrompts: true, moduleExampleKeys: ['stock:XP'] })
        expect(failing.deps.log.warn).toHaveBeenCalledWith('wizard: could not read the module prompts, drafting without them: no cartridge')
        expect(failing.deps.log.warn).toHaveBeenCalledWith('wizard: could not read the active lore, drafting without it: no host')
        expect(deps.log.warn).not.toHaveBeenCalled()
    })

    it('reads no story for a zero window and no memo when not asked, and takes the user\'s own prompt', async () => {
        const { wizard, calls } = harness()
        await wizard.draft({ ...base, lookback: 0, injectMemo: false, systemPrompt: 'Mine.', description: 'x', effectOwner: 'tracker' })
        const [system, user] = messagesOf(calls[0]!)
        expect(system!.content.startsWith('Mine.')).toBe(true)
        expect(user!.content).toBe('Describe the mechanic:\nx')
        expect(calls[0]).not.toHaveProperty('connection_id')
    })

    it('drafts without the story or the memo when they cannot be read, and says so', async () => {
        const { wizard, calls, deps } = harness(REPLY, {
            chat: { getMessages: async () => { throw new Error('no chat') } },
            memo: async () => { throw new Error('no memo') },
            userName: async () => { throw new Error('no macro') },
        })
        await expect(wizard.draft({ ...base, description: 'x', effectOwner: 'tracker' })).resolves.toBeTruthy()
        expect(messagesOf(calls[0]!)[1]!.content).toBe('Describe the mechanic:\nx')
        expect((deps.log.warn as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]).join('\n')).toMatch(/story.*no chat[\s\S]*memo.*no memo/)
    })

    it('keeps the effect owner the user chose, whatever the reply says or omits (72b-ter)', async () => {
        // The canned reply says tracker; the model was asked for gm, and the choice wins.
        const { wizard } = harness()
        const draft = await wizard.draft({ ...base, description: 'a heat meter', effectOwner: 'gm' })
        expect(draft.effectOwner).toBe('gm')
        // A reply with no attribute at all does not fall to the parser's default either.
        const bare = harness(REPLY.replace(' effect_owner="tracker"', ''))
        expect((await bare.wizard.draft({ ...base, description: 'x', effectOwner: 'gm' })).effectOwner).toBe('gm')
        expect((await harness().wizard.draft({ ...base, description: 'x', effectOwner: 'tracker' })).effectOwner).toBe('tracker')
    })

    it('fails plainly on an empty reply, an unusable one, or a model error', async () => {
        await expect(harness('').wizard.draft({ ...base, description: 'x', effectOwner: 'tracker' })).rejects.toThrow(/returned nothing/)
        await expect(harness('Sorry.').wizard.draft({ ...base, description: 'x', effectOwner: 'tracker' })).rejects.toThrow(/gm_section or tracker_module/)
        await expect(harness(new Error('boom')).wizard.draft({ ...base, description: 'x', effectOwner: 'tracker' })).rejects.toThrow('boom')
    })
})

describe('revising and regenerating', () => {
    const draft: WizardDraft = {
        name: 'Heat', icon: '🔥', needsTracker: true, driverTime: true, driverGmAnnotation: false, driverStatedFact: false,
        effectOwner: 'tracker', includeGm: true, gmTag: 'heat', gmContent: '<heat>\nOld.\n</heat>',
        trackerTag: 'HEAT', trackerLabel: 'Heat', trackerIcon: '🔥', trackerContent: 'Old tracker.',
    }

    it('quotes the current draft and the feedback in revision mode', async () => {
        const { wizard, calls } = harness()
        const halves = await wizard.revise({ ...base, description: 'a heat meter', draft, mode: 'revise', feedback: 'Slower drain.' })
        const [system, user] = messagesOf(calls[0]!)
        expect(system!.content).toContain('REVISION MODE')
        expect(user!.content).toContain('CURRENT DRAFT (revise this')
        expect(user!.content).toContain('<gm_section tag="heat">\n<heat>\nOld.\n</heat>\n</gm_section>')
        expect(user!.content.endsWith('User\'s iteration feedback (apply these changes):\nSlower drain.')).toBe(true)
        expect(halves.gmContent).toContain('{{user}}')
        expect(halves.trackerContent).toContain('You maintain heat.')
    })

    it('rewrites one half or both, and refuses a reply missing the half it asked for', async () => {
        const { wizard, calls } = harness('<gm_section tag="heat">\nOnly GM.\n</gm_section>')
        const gm = await wizard.revise({ ...base, description: 'x', draft, mode: 'gm' })
        expect(messagesOf(calls[0]!)[0]!.content).toContain('Rewrite ONLY the GM-facing section')
        expect(gm).toEqual({ gmTag: 'heat', gmContent: '<heat>\nOnly GM.\n</heat>' })
        await expect(wizard.revise({ ...base, description: 'x', draft, mode: 'tracker' })).rejects.toThrow(/tracker_module/)
        await expect(wizard.revise({ ...base, description: 'x', draft, mode: 'both' })).rejects.toThrow(/tracker_module/)
        await expect(wizard.revise({ ...base, description: 'x', draft, mode: 'revise', feedback: 'f' })).rejects.toThrow(/tracker_module/)
        // A GM-only draft revised needs no tracker half.
        const gmOnly = { ...draft, needsTracker: false }
        await expect(wizard.revise({ ...base, description: 'x', draft: gmOnly, mode: 'revise', feedback: 'f' })).resolves.toMatchObject({ gmContent: '<heat>\nOnly GM.\n</heat>' })
        // And the other way round: a tracker-only reply is refused everywhere a GM half was asked for.
        const trackerOnly = harness('<tracker_module tag="HEAT" label="Heat" icon="🔥">\nOnly tracker.\n</tracker_module>').wizard
        await expect(trackerOnly.revise({ ...base, description: 'x', draft, mode: 'gm' })).rejects.toThrow(/gm_section/)
        await expect(trackerOnly.revise({ ...base, description: 'x', draft, mode: 'both' })).rejects.toThrow(/gm_section/)
        await expect(trackerOnly.revise({ ...base, description: 'x', draft, mode: 'revise', feedback: 'f' })).rejects.toThrow(/gm_section/)
        await expect(trackerOnly.revise({ ...base, description: 'x', draft, mode: 'tracker' })).resolves.toMatchObject({ trackerContent: 'Only tracker.' })
    })
})
