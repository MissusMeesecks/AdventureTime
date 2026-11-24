// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import { PORTRAIT_DRAW_SWITCHES, createPortraitDrawSettings, type PortraitDrawHost } from './portrait-draw.js'

function harness(over: Partial<PortraitDrawHost> & { mirror?: boolean } = {}) {
    const calls: unknown[][] = []
    const host: PortraitDrawHost = {
        el: (tag, attrs) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n },
        savePrefs: async (patch) => { calls.push(['savePrefs', patch]) },
        imageConnections: async () => { calls.push(['imageConnections']); return { connections: [{ id: 'img-1', name: 'Fast', provider: 'swarmui', model: 'anima', isDefault: true }, { id: 'img-2', name: 'Slow', provider: 'other', model: '', isDefault: false }] } },
        check: async () => { calls.push(['check']) },
        fail: (error) => { calls.push(['fail', error instanceof Error ? error.message : String(error)]) },
        ...over,
    }
    const settings = createPortraitDrawSettings(host, over.mirror ? { mirror: true } : {})
    document.body.replaceChildren(settings.root)
    const field = <T extends HTMLElement>(name: string) => settings.root.querySelector(`[data-lh-field="${name}"]`) as T
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
    return { settings, calls, field, settle }
}

describe('the mirror in the settings (63b)', () => {
    it('prefixes every field, leaves the two connections out, and still follows the preferences and saves', async () => {
        const { settings, calls, field, settle } = harness({ mirror: true })
        expect(document.querySelector('[data-lh-field="portrait-auto-party"]')).toBeNull()
        expect(field('mirror-portrait-auto-party')).not.toBeNull()
        expect(field('mirror-portrait-connection')).toBeNull()
        expect(field('mirror-portrait-prompt-connection')).toBeNull()
        expect(settings.root.querySelector('.lh-portrait-settings-lead')!.textContent).toContain('Connections & models')
        settings.setTextConnections([{ id: 'conn-1', name: 'Main', model: '', isDefault: true }], '')
        settings.applyPrefs({ portraitAutoNpcs: true, portraitStoryLookback: true, portraitStoryLookbackCount: 3, portraitConnectionId: 'img-1' })
        expect(field<HTMLInputElement>('mirror-portrait-auto-npcs').checked).toBe(true)
        expect(field<HTMLInputElement>('mirror-portrait-lookback-count').value).toBe('3')
        const player = field<HTMLInputElement>('mirror-portrait-auto-player')
        player.checked = true
        player.dispatchEvent(new Event('change'))
        await settle()
        expect(calls).toEqual([['savePrefs', { portraitAutoPlayer: true }], ['check']])
    })
})

describe('the switches (61)', () => {
    it('draws the legacy’s four, in its words, and a tick saves then asks for the check; an untick saves alone', async () => {
        const { calls, field, settle } = harness()
        expect(PORTRAIT_DRAW_SWITCHES.map((s) => s.label)).toEqual(['Player character', 'Party members', 'Combat enemies', 'Lorebook NPCs'])
        const party = field<HTMLInputElement>('portrait-auto-party')
        party.checked = true
        party.dispatchEvent(new Event('change'))
        await settle()
        expect(calls).toEqual([['savePrefs', { portraitAutoParty: true }], ['check']])
        party.checked = false
        party.dispatchEvent(new Event('change'))
        await settle()
        expect(calls.slice(2)).toEqual([['savePrefs', { portraitAutoParty: false }]])
        const npcs = field<HTMLInputElement>('portrait-auto-npcs')
        npcs.checked = true
        npcs.dispatchEvent(new Event('change'))
        await settle()
        expect(calls.slice(3)).toEqual([['savePrefs', { portraitAutoNpcs: true }], ['check']])
    })

    it('reads the preferences as given, and a failed save is reported', async () => {
        const { settings, calls, field, settle } = harness({ savePrefs: async () => { throw new Error('no store') } })
        settings.applyPrefs({ portraitAutoPlayer: true, portraitAutoEnemies: true, portraitStoryLookback: true, portraitStoryLookbackCount: 12 })
        expect(field<HTMLInputElement>('portrait-auto-player').checked).toBe(true)
        expect(field<HTMLInputElement>('portrait-auto-party').checked).toBe(false)
        expect(field<HTMLInputElement>('portrait-auto-enemies').checked).toBe(true)
        expect(field<HTMLInputElement>('portrait-lookback').checked).toBe(true)
        expect(field<HTMLInputElement>('portrait-lookback-count').value).toBe('12')
        expect(field<HTMLInputElement>('portrait-lookback-count').closest('label')!.hidden).toBe(false)
        const player = field<HTMLInputElement>('portrait-auto-player')
        player.checked = false
        player.dispatchEvent(new Event('change'))
        await settle()
        expect(calls).toEqual([['fail', 'no store']])
    })
})

describe('the lookback and the connections (61)', () => {
    it('shows the count only with the lookback on, and clamps it 0 to 100', async () => {
        const { calls, field, settle } = harness()
        const count = field<HTMLInputElement>('portrait-lookback-count')
        expect(count.closest('label')!.hidden).toBe(true)
        const lookback = field<HTMLInputElement>('portrait-lookback')
        lookback.checked = true
        lookback.dispatchEvent(new Event('change'))
        await settle()
        expect(count.closest('label')!.hidden).toBe(false)
        count.value = '250'
        count.dispatchEvent(new Event('change'))
        await settle()
        expect(count.value).toBe('100')
        count.value = '-4'
        count.dispatchEvent(new Event('change'))
        await settle()
        expect(count.value).toBe('0')
        expect(calls).toEqual([['savePrefs', { portraitStoryLookback: true }], ['savePrefs', { portraitStoryLookbackCount: 100 }], ['savePrefs', { portraitStoryLookbackCount: 0 }]])
    })

    it('lists the image connections when first opened, blank for the scene’s, keeps a chosen one not listed, and saves a choice', async () => {
        const { settings, calls, field, settle } = harness()
        const select = field<HTMLSelectElement>('portrait-connection')
        expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['The scene picture’s connection'])
        settings.applyPrefs({ portraitConnectionId: 'img-9' })
        expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['The scene picture’s connection', 'img-9 (not in the list)'])
        settings.root.open = true
        settings.root.dispatchEvent(new Event('toggle'))
        await settle()
        await settle()
        expect(calls).toEqual([['imageConnections']])
        expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['The scene picture’s connection', 'Fast — swarmui · anima (default)', 'Slow — other', 'img-9 (not in the list)'])
        expect(select.value).toBe('img-9')
        select.value = 'img-2'
        select.dispatchEvent(new Event('change'))
        await settle()
        expect(calls.slice(1)).toEqual([['savePrefs', { portraitConnectionId: 'img-2' }]])
        // Asked once: a second open reads nothing again.
        settings.root.dispatchEvent(new Event('toggle'))
        await settle()
        expect(calls.filter((c) => c[0] === 'imageConnections')).toHaveLength(1)
    })

    it('says why the image list could not be read, in the hint', async () => {
        const { settings, field, settle } = harness({ imageConnections: async () => { throw new Error('PERMISSION_DENIED: image_gen') } })
        settings.root.open = true
        settings.root.dispatchEvent(new Event('toggle'))
        await settle()
        await settle()
        expect(field<HTMLElement>('portrait-connection').parentElement!.querySelector('.lh-conn-hint')!.textContent).toContain('image_gen')
    })

    it('lists the text connections it is handed, blank for the agent’s, and saves a choice', async () => {
        const { settings, calls, field, settle } = harness()
        const select = field<HTMLSelectElement>('portrait-prompt-connection')
        expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['The agent’s connection'])
        settings.applyPrefs({ portraitPromptConnectionId: 'conn-2' })
        settings.setTextConnections([{ id: 'conn-1', name: 'Main', model: 'deepseek', isDefault: true }, { id: 'conn-2', name: 'Fast', model: '', isDefault: false }], '')
        expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['The agent’s connection', 'Main — deepseek', 'Fast'])
        expect(select.value).toBe('conn-2')
        select.value = 'conn-1'
        select.dispatchEvent(new Event('change'))
        await settle()
        expect(calls).toEqual([['savePrefs', { portraitPromptConnectionId: 'conn-1' }]])
        settings.setTextConnections([], 'The host has no connections permission')
        expect(select.parentElement!.querySelector('.lh-conn-hint')!.textContent).toBe('The host has no connections permission')
        expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['The agent’s connection', 'The connection you chose is no longer listed'])
    })

    it('the prompt editor switch (73f) saves Multihog’s preference and follows it, before the lookback', async () => {
        const { calls, field, settle, settings } = harness()
        const skip = field<HTMLInputElement>('portrait-skip-prompt')
        expect(skip.checked).toBe(false)
        expect(skip.closest('label')!.textContent).toBe('Skip the prompt editor')
        // The image prompt prefix's row (94a) stands between it and the lookback.
        expect(skip.closest('.lh-portrait-settings-row')!.nextElementSibling).toBe(field('image-prompt-prefix').closest('.lh-portrait-settings-row'))
        skip.checked = true
        skip.dispatchEvent(new Event('change'))
        await settle()
        expect(calls.at(-1)).toEqual(['savePrefs', { portraitSkipPromptDialog: true }])
        settings.applyPrefs({ portraitSkipPromptDialog: false })
        expect(skip.checked).toBe(false)
    })

    it('the image prompt prefix (94a) is a text box under the prompt editor switch, saved trimmed on change, following the preferences', async () => {
        const { calls, field, settle, settings } = harness()
        const prefix = field<HTMLInputElement>('image-prompt-prefix')
        expect(prefix.value).toBe('')
        const prefixRow = prefix.closest('.lh-portrait-settings-row') as HTMLElement
        expect(prefixRow.firstElementChild!.textContent).toBe('Image prompt prefix')
        expect(prefix.getAttribute('aria-label')).toBe('Image prompt prefix')
        expect(prefix.placeholder).toBe('<lora:name:1>, masterpiece')
        expect(prefixRow.previousElementSibling).toBe(field('portrait-skip-prompt').closest('.lh-portrait-settings-row'))
        expect(prefixRow.nextElementSibling).toBe(field('portrait-lookback').closest('.lh-portrait-settings-row'))
        prefix.value = '  <lora:anima-turbo:1>  '
        prefix.dispatchEvent(new Event('change'))
        await settle()
        expect(calls.at(-1)).toEqual(['savePrefs', { imagePromptPrefix: '<lora:anima-turbo:1>' }])
        settings.applyPrefs({ imagePromptPrefix: 'masterpiece,' })
        expect(prefix.value).toBe('masterpiece,')
        settings.applyPrefs({ imagePromptPrefix: '' })
        expect(prefix.value).toBe('')
    })

    it('puts every row’s help behind a [?] beside its label, in the deck’s words, with no tooltip left (96)', () => {
        const { settings, field } = harness()
        const helps: Record<string, string> = {
            'portrait-auto-player': 'When on, your character’s portrait is drawn when the character first appears in the tracker. Turning this on draws a missing portrait now. Default: off.',
            'portrait-auto-party': 'When on, each party member with hit points gets a portrait when they join. Turning this on draws the missing portraits now. Default: off.',
            'portrait-auto-enemies': 'When on, each enemy with hit points in combat gets a portrait when it appears. Turning this on draws the missing portraits now. Default: off.',
            'portrait-auto-npcs': 'When on, every NPC in the campaign’s NPC lorebook that has no portrait gets one after each pass. The portrait is described from the NPC’s entry. Turning this on draws the missing portraits now. Default: off.',
            'portrait-skip-prompt': 'When off, pressing a Draw button shows the image prompt first, so you can edit, copy or cancel it. When on, the picture is drawn at once. Automatic draws never show the prompt. Default: off.',
            'image-prompt-prefix': 'This text is added to the front of every image prompt, for portraits, NPC photos and location images. Use it for a LoRA tag such as <lora:name:1>, a trigger word or a quality tag. The prompt editor shows the prompt without the prefix. Default: blank.',
            'portrait-lookback': 'When on, the prompt writer also reads your persona, the campaign’s lorebook entries whose keywords match the name, the game state and the last messages. When off, a portrait is described from the tracker memo and the narrator’s character card only, and an NPC from its lorebook entry. Default: off.',
        }
        for (const [name, help] of Object.entries(helps)) {
            const row = field(name).closest('.lh-portrait-settings-row') as HTMLElement
            const tip = row.querySelector('.lh-help-tip') as HTMLButtonElement
            const note = row.querySelector('.lh-help-note') as HTMLElement
            // In the row from the first paint, hidden, and neither the button nor the note inside a label.
            expect(note.textContent).toBe(help)
            expect(note.hidden).toBe(true)
            expect(tip.closest('label')).toBeNull()
            expect(note.closest('label')).toBeNull()
            expect(row.title).toBe('')
            tip.click()
            expect(note.hidden).toBe(false)
        }
        // A press on a tick row's [?] never ticks its box.
        expect(field<HTMLInputElement>('portrait-skip-prompt').checked).toBe(false)
        expect(field('portrait-lookback').closest('label')!.textContent).toBe('Use the story in the prompt')
        expect(field('portrait-lookback-count').closest('label')!.textContent).toBe('Messages to read')
        expect(settings.root.textContent).not.toMatch(/Multihog|legacy/)
    })
})
