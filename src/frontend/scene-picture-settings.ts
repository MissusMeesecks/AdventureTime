/**
 * The scene picture's drawing settings (Phase 49, mirrored by 63b): the
 * legacy's Real-Time Mode switch, its three triggers with N, the NPCs in
 * the picture and the chat background (73f) — five preferences, one factory, two
 * instances: the *Drawing the picture* sub-fold of the Scene fold, and
 * the *Portraits and location images* section of the General category.
 * One preference, two rows, kept in step by `prefs.changed` (63). The image
 * connection stays with each place of its own: the fold's row, and the
 * Connections category.
 */

import { createTickRow } from './portrait-draw.js'

export interface ScenePictureSettingsHost {
    el(tag: string, attrs?: Record<string, string>): HTMLElement
    savePrefs(patch: Record<string, unknown>): Promise<void>
    fail(error: unknown): void
}

export interface ScenePicturePrefs {
    scenePictureAuto?: boolean
    scenePictureTrigger?: 'location_enter' | 'location_change' | 'every_n_outputs'
    scenePictureEveryN?: number
    scenePicturePresentNpcs?: boolean
    portraitLocationBackground?: boolean
}

export interface ScenePictureSettings {
    /** The six rows, in order; the host puts them where they go. */
    rows: HTMLElement[]
    /** The same six by name (83), for a host that lays them out in Multihog's order. */
    named: { auto: HTMLElement; trigger: HTMLElement; every: HTMLElement; npcs: HTMLElement; background: HTMLElement }
    applyPrefs(prefs: ScenePicturePrefs | Record<string, unknown>): void
    /** The switch, read or set without a save: the fold unticks it when a draw on its own failed (49). */
    auto(): boolean
    setAuto(on: boolean): void
}

/** The three triggers (49), in the legacy's words. */
export const SCENE_PICTURE_TRIGGERS: ReadonlyArray<{ value: NonNullable<ScenePicturePrefs['scenePictureTrigger']>; label: string }> = [
    { value: 'location_enter', label: 'On arrival at a location with no picture' },
    { value: 'location_change', label: 'When the location changes' },
    { value: 'every_n_outputs', label: 'Every N replies and when the location changes' },
]

export const MAX_SCENE_PICTURE_EVERY_N = 50

/** The three switches' help, behind each row's [?] (96). */
export const SCENE_PICTURE_AUTO_HELP = 'When on, the location image is drawn automatically after a reply, when the trigger below is met. If one automatic draw fails, this turns itself off. Turn it on again to retry. Default: off.'
export const SCENE_PICTURE_NPCS_HELP = 'When on, the location image includes every NPC named in the newest replies. Your character is always in the picture when you have a Player Card. If the location prompt is still an unedited art style, it switches to the matching variant. Default: on.'
export const SCENE_PICTURE_BACKGROUND_HELP = 'When on, the picture of the party’s current location is shown behind the chat. A picture drawn or set for the current location shows at once. Default: off.'

/**
 * @param fieldPrefix `''` in the Scene fold; the mirror in the settings uses its own, so one document holds both.
 */
export function createScenePictureSettings(host: ScenePictureSettingsHost, fieldPrefix = ''): ScenePictureSettings {
    const { el } = host
    const field = (name: string) => `${fieldPrefix}${name}`
    const { row: autoRow, input: autoInput } = createTickRow(el, 'lh-scene-picture-row', field('scene-picture-auto'), 'Draw location images automatically', SCENE_PICTURE_AUTO_HELP)
    const triggerRow = el('label', { class: 'lh-scene-picture-row' })
    const triggerLabel = el('span')
    triggerLabel.textContent = 'Trigger'
    const triggerSelect = el('select', { class: 'lh-input', 'data-lh-field': field('scene-picture-trigger') }) as HTMLSelectElement
    for (const choice of SCENE_PICTURE_TRIGGERS) {
        const option = el('option', { value: choice.value }) as HTMLOptionElement
        option.textContent = choice.label
        triggerSelect.append(option)
    }
    triggerSelect.value = 'location_change'
    triggerRow.append(triggerLabel, triggerSelect)
    const everyRow = el('label', { class: 'lh-scene-picture-row' })
    const everyLabel = el('span')
    everyLabel.textContent = 'Every'
    const everyInput = el('input', { type: 'number', class: 'lh-input', min: '1', max: String(MAX_SCENE_PICTURE_EVERY_N), step: '1', 'data-lh-field': field('scene-picture-every') }) as HTMLInputElement
    everyInput.value = '1'
    const everyAfter = el('span')
    everyAfter.textContent = 'replies'
    everyRow.append(everyLabel, everyInput, everyAfter)
    const { row: npcsRow, input: npcsInput } = createTickRow(el, 'lh-scene-picture-row', field('scene-picture-npcs'), 'Include present NPCs in the picture', SCENE_PICTURE_NPCS_HELP)
    npcsInput.checked = true
    // Multihog's Use Location Images as Chat Background (73f).
    const { row: backgroundRow, input: backgroundInput } = createTickRow(el, 'lh-scene-picture-row', field('scene-picture-background'), 'Use location image as chat background', SCENE_PICTURE_BACKGROUND_HELP)

    function drawEvery(): void {
        everyRow.hidden = triggerSelect.value !== 'every_n_outputs'
    }

    autoInput.addEventListener('change', () => { host.savePrefs({ scenePictureAuto: autoInput.checked }).catch(host.fail) })
    triggerSelect.addEventListener('change', () => { host.savePrefs({ scenePictureTrigger: triggerSelect.value }).catch(host.fail); drawEvery() })
    everyInput.addEventListener('change', () => {
        const n = Math.min(Math.max(Math.floor(Number(everyInput.value) || 1), 1), MAX_SCENE_PICTURE_EVERY_N)
        everyInput.value = String(n)
        host.savePrefs({ scenePictureEveryN: n }).catch(host.fail)
    })
    npcsInput.addEventListener('change', () => { host.savePrefs({ scenePicturePresentNpcs: npcsInput.checked }).catch(host.fail) })
    backgroundInput.addEventListener('change', () => { host.savePrefs({ portraitLocationBackground: backgroundInput.checked }).catch(host.fail) })
    drawEvery()

    return {
        rows: [autoRow, triggerRow, everyRow, npcsRow, backgroundRow],
        named: { auto: autoRow, trigger: triggerRow, every: everyRow, npcs: npcsRow, background: backgroundRow },
        applyPrefs(prefs) {
            const p = prefs as Record<string, unknown>
            if (p.scenePictureAuto !== undefined) autoInput.checked = p.scenePictureAuto === true
            if (p.scenePictureTrigger !== undefined && SCENE_PICTURE_TRIGGERS.some((t) => t.value === p.scenePictureTrigger)) triggerSelect.value = p.scenePictureTrigger as string
            if (p.scenePictureEveryN !== undefined) everyInput.value = String(Math.min(Math.max(Math.floor(Number(p.scenePictureEveryN) || 1), 1), MAX_SCENE_PICTURE_EVERY_N))
            if (p.scenePicturePresentNpcs !== undefined) npcsInput.checked = p.scenePicturePresentNpcs !== false
            if (p.portraitLocationBackground !== undefined) backgroundInput.checked = p.portraitLocationBackground === true
            drawEvery()
        },
        auto: () => autoInput.checked,
        setAuto(on) { autoInput.checked = on },
    }
}
