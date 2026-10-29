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
        purge: async () => { calls.push(['purge']); return { portraits: 3, chats: 2 } },
        confirm: async (title, _message, label) => { calls.push(['confirm', title, label]); return true },
        fail: (error) => { calls.push(['fail', error instanceof Error ? error.message : String(error)]) },
        ...over,
    }
    const portraits = createPortraitDrawSettings({ el, savePrefs: host.savePrefs, check: async () => { calls.push(['check']) }, fail: host.fail }, { mirror: true })
    const scene = createScenePictureSettings({ el, savePrefs: host.savePrefs, fail: host.fail }, 'mirror-')
    const section = createPortraitsSection(host, portraits, scene)
    document.body.append(section.header, section.footer)
    const q = (field: string) => section.header.querySelector(`[data-lh-field="${field}"]`) as HTMLInputElement
    return { section, calls, q, portraits, scene }
}

describe('the portraits section after Multihog’s (83)', () => {
    it('lays the two mirrors’ rows out flat in Multihog’s order with the portraits switch, Show location images, the Real-Time box and the connections’ note, every row a search item', () => {
        const { section, portraits, scene } = harness()
        const fields = Array.from(section.header.querySelectorAll('[data-lh-field]')).map((n) => n.getAttribute('data-lh-field'))
        expect(fields).toEqual(['portraits-enabled', 'mirror-portrait-skip-prompt', 'mirror-portrait-lookback', 'mirror-portrait-lookback-count', 'mirror-portrait-auto-player', 'mirror-portrait-auto-party', 'mirror-portrait-auto-enemies', 'mirror-portrait-auto-npcs', 'portraits-location-images', 'mirror-scene-picture-background', 'mirror-scene-picture-npcs', 'portraits-realtime', 'mirror-scene-picture-auto', 'mirror-scene-picture-trigger', 'mirror-scene-picture-every', 'portraits-connections'])
        // The rows left the mirrors' folds: the fold keeps only what was not taken.
        expect(portraits.root.querySelector('[data-lh-field="mirror-portrait-auto-party"]')).toBeNull()
        expect(portraits.root.querySelector('[data-lh-field="mirror-portrait-skip-prompt"]')).toBeNull()
        expect(scene.rows.every((row) => row.closest('[data-lh-field="portraits-head"]') === section.header)).toBe(true)
        expect(Array.from(section.header.querySelectorAll('.lh-portraits-group')).map((n) => n.textContent)).toEqual(['Auto-generate for:', 'Location images & visualisation'])
        expect(section.header.querySelector('.lh-portraits-realtime-title')!.textContent).toBe('Real-Time Visualization Mode')
        expect(section.header.querySelector('.lh-portraits-conn-title')!.textContent).toBe('🔌 Portrait generation connections')
        const rows = Array.from(section.header.querySelectorAll('label, .lh-portraits-conn'))
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

    it('purges every portrait from the foot after a confirm, in 72a’s words, and says when it was refused or failed', async () => {
        const { section, calls } = harness()
        const button = section.footer.querySelector('[data-lh-field="portraits-purge"]') as HTMLButtonElement
        const note = section.footer.querySelector('[data-lh-field="portraits-purge-note"]') as HTMLElement
        expect(button.textContent).toBe('🗑 Emergency: purge all portraits')
        button.click()
        expect(button.disabled).toBe(true)
        await settle()
        await settle()
        expect(calls).toContainEqual(['confirm', 'Purge all portraits', 'Purge the portraits'])
        expect(calls).toContainEqual(['purge'])
        expect(note.textContent).toBe('Cleared 3 portrait references across 2 chats.')
        expect(button.disabled).toBe(false)
        const declined = harness({ confirm: async () => false })
        ;(declined.section.footer.querySelector('[data-lh-field="portraits-purge"]') as HTMLButtonElement).click()
        await settle()
        await settle()
        expect(declined.calls.some((c) => c[0] === 'purge')).toBe(false)
        expect(declined.section.footer.querySelector('[data-lh-field="portraits-purge-note"]')!.textContent).toBe('Not purged.')
        const none = harness({ purge: async () => ({ portraits: 0, chats: 0 }) })
        ;(none.section.footer.querySelector('[data-lh-field="portraits-purge"]') as HTMLButtonElement).click()
        await settle()
        await settle()
        expect(none.section.footer.querySelector('[data-lh-field="portraits-purge-note"]')!.textContent).toBe('No chat had a portrait to clear.')
        const failing = harness({ purge: async () => { throw new Error('PERMISSION_DENIED') } })
        ;(failing.section.footer.querySelector('[data-lh-field="portraits-purge"]') as HTMLButtonElement).click()
        await settle()
        await settle()
        const failNote = failing.section.footer.querySelector('[data-lh-field="portraits-purge-note"]') as HTMLElement
        expect(failNote.textContent).toBe('Could not purge: PERMISSION_DENIED')
        expect(failNote.classList.contains('lh-portraits-note--problem')).toBe(true)
        expect(failing.calls).toContainEqual(['fail', 'PERMISSION_DENIED'])
    })
})
