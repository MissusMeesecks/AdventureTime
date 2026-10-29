// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import { SCENE_PICTURE_TRIGGERS, createScenePictureSettings, type ScenePictureSettingsHost } from './scene-picture-settings.js'

function harness(prefix = '', over: Partial<ScenePictureSettingsHost> = {}) {
    const calls: unknown[][] = []
    const host: ScenePictureSettingsHost = {
        el: (tag, attrs) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n },
        savePrefs: async (patch) => { calls.push(['savePrefs', patch]) },
        fail: (error) => { calls.push(['fail', error instanceof Error ? error.message : String(error)]) },
        ...over,
    }
    const settings = createScenePictureSettings(host, prefix)
    const root = document.createElement('div')
    root.append(...settings.rows)
    document.body.replaceChildren(root)
    const field = <T extends HTMLElement>(name: string) => root.querySelector(`[data-lh-field="${prefix}${name}"]`) as T
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
    return { settings, root, calls, field, settle }
}

describe('the scene picture’s five dials (49, shared by 63b)', () => {
    it('draws the switch, the three triggers, N for the every-N trigger alone and the NPCs, and saves each as changed', async () => {
        const { calls, field, settle } = harness()
        expect(SCENE_PICTURE_TRIGGERS.map((t) => t.value)).toEqual(['location_enter', 'location_change', 'every_n_outputs'])
        expect(field<HTMLSelectElement>('scene-picture-trigger').value).toBe('location_change')
        expect(field<HTMLInputElement>('scene-picture-npcs').checked).toBe(true)
        const everyRow = field('scene-picture-every').closest('label') as HTMLElement
        expect(everyRow.hidden).toBe(true)
        field<HTMLInputElement>('scene-picture-auto').checked = true
        field('scene-picture-auto').dispatchEvent(new Event('change'))
        field<HTMLSelectElement>('scene-picture-trigger').value = 'every_n_outputs'
        field('scene-picture-trigger').dispatchEvent(new Event('change'))
        expect(everyRow.hidden).toBe(false)
        field<HTMLInputElement>('scene-picture-every').value = '99'
        field('scene-picture-every').dispatchEvent(new Event('change'))
        expect(field<HTMLInputElement>('scene-picture-every').value).toBe('50')
        field<HTMLInputElement>('scene-picture-npcs').checked = false
        field('scene-picture-npcs').dispatchEvent(new Event('change'))
        await settle()
        expect(calls).toEqual([
            ['savePrefs', { scenePictureAuto: true }],
            ['savePrefs', { scenePictureTrigger: 'every_n_outputs' }],
            ['savePrefs', { scenePictureEveryN: 50 }],
            ['savePrefs', { scenePicturePresentNpcs: false }],
        ])
    })

    it('takes the preferences as given, clamped, ignoring an unknown trigger; the switch can be read and unticked without a save; a failed save is reported', async () => {
        const { settings, calls, field, settle } = harness('mirror-', { savePrefs: async () => { throw new Error('no store') } })
        expect(document.querySelector('[data-lh-field="scene-picture-auto"]')).toBeNull()
        settings.applyPrefs({ scenePictureAuto: true, scenePictureTrigger: 'every_n_outputs', scenePictureEveryN: 0, scenePicturePresentNpcs: false })
        expect(field<HTMLInputElement>('scene-picture-auto').checked).toBe(true)
        expect(field<HTMLSelectElement>('scene-picture-trigger').value).toBe('every_n_outputs')
        expect((field('scene-picture-every').closest('label') as HTMLElement).hidden).toBe(false)
        expect(field<HTMLInputElement>('scene-picture-every').value).toBe('1')
        expect(field<HTMLInputElement>('scene-picture-npcs').checked).toBe(false)
        settings.applyPrefs({ scenePictureTrigger: 'whenever' })
        expect(field<HTMLSelectElement>('scene-picture-trigger').value).toBe('every_n_outputs')
        expect(settings.auto()).toBe(true)
        settings.setAuto(false)
        expect(field<HTMLInputElement>('scene-picture-auto').checked).toBe(false)
        field<HTMLInputElement>('scene-picture-npcs').checked = true
        field('scene-picture-npcs').dispatchEvent(new Event('change'))
        await settle()
        expect(calls).toEqual([['fail', 'no store']])
    })

    it('the chat background switch (73f) is the fifth row since 87, saves its preference and follows it', async () => {
        const { settings, calls, field, settle } = harness()
        expect(settings.rows).toHaveLength(5)
        expect(settings.rows[4]!.textContent).toBe('Use the location picture as the chat background')
        expect(field<HTMLInputElement>('scene-picture-background').checked).toBe(false)
        field<HTMLInputElement>('scene-picture-background').checked = true
        field('scene-picture-background').dispatchEvent(new Event('change'))
        await settle()
        expect(calls).toEqual([['savePrefs', { portraitLocationBackground: true }]])
        settings.applyPrefs({ portraitLocationBackground: false })
        expect(field<HTMLInputElement>('scene-picture-background').checked).toBe(false)
        settings.applyPrefs({ portraitLocationBackground: true })
        expect(field<HTMLInputElement>('scene-picture-background').checked).toBe(true)
    })
})
