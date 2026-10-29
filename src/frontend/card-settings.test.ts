// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import { CARD_SETTINGS_CSS, createCardSettings, type CardSettingsHost } from './card-settings.js'

const el = (tag: string, attrs?: Record<string, string>) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n }
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0)) }

function mount(over: Partial<CardSettingsHost> = {}) {
    const calls: Array<[string, ...unknown[]]> = []
    const host: CardSettingsHost = {
        el,
        savePrefs: async (patch) => { calls.push(['prefs', patch]) },
        saveSettings: async (patch) => { calls.push(['settings', patch]) },
        saveWordTargets: async (major, minor) => { calls.push(['words', major, minor]); return { applied: true } },
        fail: (error) => { calls.push(['fail', error]) },
        ...over,
    }
    const scene = el('details', { class: 'lh-scene-picture-settings', 'data-lh-field': 'scene-picture-settings' })
    const settings = createCardSettings(host, [scene])
    document.body.append(settings.npc, settings.location)
    const field = <T extends HTMLElement>(name: string) => settings.npc.querySelector(`[data-lh-field="${name}"]`) as T
    const note = () => settings.npc.querySelector('[data-lh-field="npc-card-settings-note"]')!.textContent
    return { settings, calls, field, note, scene }
}

describe('the two gears of the Campaign Records (78b)', () => {
    it('the NPC box holds Multihog’s rows, each writing its own place: the portraits switch, the word targets, the relationship key, the mode, the scale, the import mode', async () => {
        const { settings, calls, field, note } = mount()
        expect(settings.npc.querySelector('.lh-card-settings-title')!.textContent).toBe('⚙️ NPC and PC Card Settings')
        settings.applyPrefs({ portraitsEnabled: true, npcMajorWords: 300, npcMinorWords: 100, relationshipMode: 'regex', relationshipMax: 200, npcAddAsIsMode: 'literal', npcRelationshipToast: false })
        settings.applyRelationships(true)
        expect(field<HTMLInputElement>('npc-card-portraits').checked).toBe(true)
        expect(field<HTMLInputElement>('npc-card-major-words').value).toBe('300')
        expect(field<HTMLInputElement>('npc-card-minor-words').value).toBe('100')
        expect(field<HTMLInputElement>('npc-card-relationships').checked).toBe(true)
        expect(field<HTMLInputElement>('npc-card-relationship-float').checked).toBe(false)
        expect(field<HTMLSelectElement>('npc-card-relationship-mode').value).toBe('regex')
        expect(field<HTMLInputElement>('npc-card-relationship-max').value).toBe('200')
        expect((settings.npc.querySelector('input[name="lh-npc-card-add-as-is"][value="literal"]') as HTMLInputElement).checked).toBe(true)
        // Show NPC portraits: the portraits preference.
        field<HTMLInputElement>('npc-card-portraits').checked = false
        field<HTMLInputElement>('npc-card-portraits').dispatchEvent(new Event('change'))
        await settle()
        expect(calls.at(-1)).toEqual(['prefs', { portraitsEnabled: false }])
        expect(note()).toBe('The NPCs draw as the compact list.')
        // The word targets: the NPC word targets op, both numbers at once, clamped.
        field<HTMLInputElement>('npc-card-major-words').value = '9000'
        field<HTMLInputElement>('npc-card-major-words').dispatchEvent(new Event('change'))
        await settle()
        expect(calls.at(-1)).toEqual(['words', 5000, 100])
        expect(note()).toContain('Saved: 5000 words for a major NPC, 100 for a minor one')
        // The relationship system: the cartridge key.
        field<HTMLInputElement>('npc-card-relationships').checked = false
        field<HTMLInputElement>('npc-card-relationships').dispatchEvent(new Event('change'))
        await settle()
        expect(calls.at(-1)).toEqual(['settings', { npcRelationshipBars: false }])
        // The float feedback (78c): Multihog's row, a preference, on as it ships.
        expect(field<HTMLInputElement>('npc-card-relationship-float').nextElementSibling!.textContent).toBe('Disabled')
        field<HTMLInputElement>('npc-card-relationship-float').checked = true
        field<HTMLInputElement>('npc-card-relationship-float').dispatchEvent(new Event('change'))
        await settle()
        expect(calls.at(-1)).toEqual(['prefs', { npcRelationshipToast: true }])
        expect(note()).toBe('An award floats over the tracker as it lands.')
        field<HTMLInputElement>('npc-card-relationship-float').checked = false
        field<HTMLInputElement>('npc-card-relationship-float').dispatchEvent(new Event('change'))
        await settle()
        expect(calls.at(-1)).toEqual(['prefs', { npcRelationshipToast: false }])
        // The mode and the scale: preferences, the scale clamped to the legacy's bounds.
        field<HTMLSelectElement>('npc-card-relationship-mode').value = 'state_tracker'
        field<HTMLSelectElement>('npc-card-relationship-mode').dispatchEvent(new Event('change'))
        await settle()
        expect(calls.at(-1)).toEqual(['prefs', { relationshipMode: 'state_tracker' }])
        field<HTMLInputElement>('npc-card-relationship-max').value = '5'
        field<HTMLInputElement>('npc-card-relationship-max').dispatchEvent(new Event('change'))
        await settle()
        expect(calls.at(-1)).toEqual(['prefs', { relationshipMax: 10 }])
        expect(note()).toBe('The scale is now ±10.')
        // Add as is: the creator's mode.
        const review = settings.npc.querySelector('input[name="lh-npc-card-add-as-is"][value="ai_review"]') as HTMLInputElement
        review.checked = true
        review.dispatchEvent(new Event('change'))
        await settle()
        expect(calls.at(-1)).toEqual(['prefs', { npcAddAsIsMode: 'ai_review' }])
    })

    it('says in red when a save is refused, and the word targets say when the instruction no longer carries the sentences', async () => {
        const { field, note, settings } = mount({ savePrefs: async () => { throw new Error('the store refused') }, saveWordTargets: async () => ({ applied: false }) })
        field<HTMLInputElement>('npc-card-portraits').checked = true
        field<HTMLInputElement>('npc-card-portraits').dispatchEvent(new Event('change'))
        await settle()
        expect(note()).toBe('Could not save: the store refused')
        expect(settings.npc.querySelector('.lh-card-settings-note--error')).not.toBeNull()
        field<HTMLInputElement>('npc-card-minor-words').value = '120'
        field<HTMLInputElement>('npc-card-minor-words').dispatchEvent(new Event('change'))
        await settle()
        expect(note()).toContain('the NPC instruction no longer carries the two length sentences')
    })

    it('the Location box holds the scene’s drawing settings handed in, their summary hidden by the sheet', () => {
        const { settings, scene } = mount()
        expect(settings.location.querySelector('.lh-card-settings-title')!.textContent).toBe('⚙️ Location Settings')
        expect(settings.location.contains(scene)).toBe(true)
        expect(CARD_SETTINGS_CSS).toContain('.lh-scene-picture-settings > summary { display: none; }')
    })
})

describe('Show Location Images (80): Multihog’s switch at the head of the Location box', () => {
    it('is the first row, writes the preference, switches the auto draw off with it as Multihog’s applier does, and follows the preference', async () => {
        const { settings, calls } = mount()
        const tick = settings.location.querySelector('[data-lh-field="location-card-images"]') as HTMLInputElement
        expect(tick).not.toBeNull()
        expect(settings.location.querySelector('.lh-card-settings-title')!.nextElementSibling!.contains(tick)).toBe(true)
        expect(tick.closest('.lh-card-settings-row')!.textContent).toContain('Show Location Images')
        expect(tick.checked).toBe(false)
        expect(tick.nextElementSibling!.textContent).toBe('Disabled')
        tick.checked = true
        tick.dispatchEvent(new Event('change'))
        await settle()
        expect(calls.at(-1)).toEqual(['prefs', { locationImages: true }])
        expect(settings.location.querySelector('.lh-card-settings-note')).toBeNull()
        tick.checked = false
        tick.dispatchEvent(new Event('change'))
        await settle()
        expect(calls.at(-1)).toEqual(['prefs', { locationImages: false, scenePictureAuto: false }])
        settings.applyPrefs({ locationImages: true })
        expect(tick.checked).toBe(true)
        expect(tick.nextElementSibling!.textContent).toBe('Enabled')
        // The drawing settings follow, as before.
        expect(settings.location.querySelector('[data-lh-field="scene-picture-settings"]')).not.toBeNull()
    })
})
