// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import { PORTRAITS_SECTION_CSS, createPortraitsSection, type PortraitsSectionHost } from './portraits-section.js'
import { createPortraitDrawSettings } from './portrait-draw.js'
import { createScenePictureSettings } from './scene-picture-settings.js'

const el = (tag: string, attrs?: Record<string, string>) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n }
const settle = () => new Promise((r) => setTimeout(r, 0))

function harness(over: Partial<PortraitsSectionHost> = {}) {
    const calls: unknown[][] = []
    const host: PortraitsSectionHost = {
        el,
        savePrefs: async (patch) => { calls.push(['prefs', patch]) },
        fail: (error) => { calls.push(['fail', error instanceof Error ? error.message : String(error)]) },
        ...over,
    }
    const portraits = createPortraitDrawSettings({ el, savePrefs: host.savePrefs, check: async () => { calls.push(['check']) }, fail: host.fail }, { mirror: true })
    const scene = createScenePictureSettings({ el, savePrefs: host.savePrefs, fail: host.fail }, 'mirror-')
    const section = createPortraitsSection(host, portraits, scene)
    document.body.append(section.header)
    const q = (field: string) => section.header.querySelector(`[data-lh-field="${field}"]`) as HTMLInputElement
    return { section, calls, q, portraits, scene }
}

describe('the portraits section after Multihog’s (83)', () => {
    it('lays the two mirrors’ rows out flat in Multihog’s order with the portraits switch, Show location images and the Real-time box, every row a search item', () => {
        const { section, portraits, scene } = harness()
        const fields = Array.from(section.header.querySelectorAll('[data-lh-field]')).map((n) => n.getAttribute('data-lh-field'))
        expect(fields).toEqual(['portraits-enabled', 'mirror-portrait-skip-prompt', 'mirror-image-prompt-prefix', 'mirror-portrait-lookback', 'mirror-portrait-lookback-count', 'mirror-portrait-auto-player', 'mirror-portrait-auto-party', 'mirror-portrait-auto-enemies', 'mirror-portrait-auto-npcs', 'portraits-location-images', 'mirror-scene-picture-background', 'mirror-scene-picture-npcs', 'portraits-realtime', 'mirror-scene-picture-auto', 'mirror-scene-picture-trigger', 'mirror-scene-picture-every'])
        // The rows left the mirrors' folds: the fold keeps only what was not taken.
        expect(portraits.root.querySelector('[data-lh-field="mirror-portrait-auto-party"]')).toBeNull()
        expect(portraits.root.querySelector('[data-lh-field="mirror-portrait-skip-prompt"]')).toBeNull()
        expect(scene.rows.every((row) => row.closest('[data-lh-field="portraits-head"]') === section.header)).toBe(true)
        expect(Array.from(section.header.querySelectorAll('.lh-portraits-group')).map((n) => n.textContent)).toEqual(['Draw automatically for', 'Location images'])
        expect(section.header.querySelector('.lh-portraits-realtime-title')!.textContent).toBe('Real-time location images')
        const rows = Array.from(section.header.querySelectorAll('.lh-portrait-settings-row, .lh-scene-picture-row'))
        expect(rows.length).toBeGreaterThan(10)
        expect(rows.every((row) => row.classList.contains('lh-search-item'))).toBe(true)
        expect(PORTRAITS_SECTION_CSS).toContain('.lh-portraits-realtime')
    })

    it('saves the portraits switch and Show location images with its rule, follows the preferences, and still reaches the mirrors’ rows', async () => {
        const { section, calls, q } = harness()
        expect(q('portraits-enabled').checked).toBe(true)
        expect(q('portraits-location-images').checked).toBe(false)
        q('portraits-enabled').checked = false
        q('portraits-enabled').dispatchEvent(new Event('change'))
        q('portraits-location-images').checked = true
        q('portraits-location-images').dispatchEvent(new Event('change'))
        await settle()
        expect(calls).toContainEqual(['prefs', { portraitsEnabled: false }])
        expect(calls).toContainEqual(['prefs', { locationImages: true }])
        q('portraits-location-images').checked = false
        q('portraits-location-images').dispatchEvent(new Event('change'))
        await settle()
        expect(calls).toContainEqual(['prefs', { locationImages: false, scenePictureAuto: false }])
        // A mirrored row saves as it did in its fold.
        q('mirror-portrait-auto-party').checked = true
        q('mirror-portrait-auto-party').dispatchEvent(new Event('change'))
        await settle()
        expect(calls).toContainEqual(['prefs', { portraitAutoParty: true }])
        expect(calls).toContainEqual(['check'])
        section.applyPrefs({ portraitsEnabled: true, locationImages: true })
        expect(q('portraits-enabled').checked).toBe(true)
        expect(q('portraits-location-images').checked).toBe(true)
        section.applyPrefs({ portraitsEnabled: false })
        expect(q('portraits-enabled').checked).toBe(false)
        expect(q('portraits-location-images').checked).toBe(true)
    })

    it('keeps its help behind a [?] on each row and nothing in the open (96): no lead, no subtitle, no connections box, no tooltip', () => {
        const { section, q } = harness()
        const help = (field: string) => q(field).closest('.lh-portrait-settings-row')!.querySelector('.lh-help-note') as HTMLElement
        expect(q('portraits-enabled').closest('label')!.textContent).toBe('Show portraits on cards')
        expect(help('portraits-enabled').textContent).toBe('When on, portraits show on the Character, Party and Combat cards, in the Tracker widget and under each message, and on the NPC cards in Campaign Records. When off, the pictures are kept but hidden there. The NPC library and the location image are not affected. Default: on.')
        expect(q('portraits-location-images').closest('label')!.textContent).toBe('Show location images')
        expect(help('portraits-location-images').textContent).toBe('When on, each location in Campaign Records shows its picture. Click a picture to set, draw or remove it. When off, locations are a plain list and automatic scene drawing is turned off too. Default: off.')
        expect(help('portraits-enabled').hidden).toBe(true)
        // The [?] is beside the label, not in it, and a press shows the help without ticking the box.
        const tip = q('portraits-location-images').closest('.lh-portrait-settings-row')!.querySelector('.lh-help-tip') as HTMLButtonElement
        tip.click()
        expect(help('portraits-location-images').hidden).toBe(false)
        expect(q('portraits-location-images').checked).toBe(false)
        expect(section.header.querySelector('.lh-portraits-lead, .lh-portraits-realtime-sub, .lh-portraits-conn')).toBeNull()
        expect(section.header.querySelectorAll('[title]')).toHaveLength(0)
        // Every word in the open is a label: the help is all in the notes.
        const open = section.header.cloneNode(true) as HTMLElement
        for (const note of Array.from(open.querySelectorAll('.lh-help-note'))) note.remove()
        expect(open.textContent).not.toMatch(/Multihog|legacy|the host|Connections & models|\./)
        expect(section.header.querySelectorAll('.lh-help-note')).toHaveLength(12)
    })

    it('has no purge of its own (96, the audit’s finding 26): Purge all portraits is the Debug & factory reset card’s alone', () => {
        const { section } = harness()
        expect('footer' in section).toBe(false)
        expect(document.querySelector('[data-lh-field="portraits-purge"], [data-lh-field="portraits-foot"]')).toBeNull()
        expect(Array.from(section.header.querySelectorAll('button')).every((b) => b.classList.contains('lh-help-tip'))).toBe(true)
        expect(PORTRAITS_SECTION_CSS).not.toContain('lh-portraits-foot')
    })
})
