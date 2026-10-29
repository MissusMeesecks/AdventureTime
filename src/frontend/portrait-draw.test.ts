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
        expect(skip.closest('label')!.textContent).toBe('Skip the prompt editor on a pressed draw')
        expect(skip.closest('label')!.nextElementSibling).toBe(field('portrait-lookback').closest('label'))
        skip.checked = true
        skip.dispatchEvent(new Event('change'))
        await settle()
        expect(calls.at(-1)).toEqual(['savePrefs', { portraitSkipPromptDialog: true }])
        settings.applyPrefs({ portraitSkipPromptDialog: false })
        expect(skip.checked).toBe(false)
    })
})
