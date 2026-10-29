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
    { value: 'location_enter', label: 'On arriving at a place with no picture' },
    { value: 'location_change', label: 'Whenever the place changes (the default)' },
    { value: 'every_n_outputs', label: 'Every N replies, and whenever the place changes' },
]

export const MAX_SCENE_PICTURE_EVERY_N = 50

/**
 * @param fieldPrefix `''` in the Scene fold; the mirror in the settings uses its own, so one document holds both.
 */
export function createScenePictureSettings(host: ScenePictureSettingsHost, fieldPrefix = ''): ScenePictureSettings {
    const { el } = host
    const field = (name: string) => `${fieldPrefix}${name}`
    const autoRow = el('label', { class: 'lh-scene-picture-row' })
    const autoInput = el('input', { type: 'checkbox', 'data-lh-field': field('scene-picture-auto') }) as HTMLInputElement
    const autoLabel = el('span')
    autoLabel.textContent = 'Draw a picture on its own after a reply'
    autoRow.title = 'The legacy’s Real-Time Visualization Mode: after a reply, the place’s picture is drawn as the trigger below says. One failed draw switches this off again, as the legacy does; tick it again to retry.'
    autoRow.append(autoInput, autoLabel)
    const triggerRow = el('label', { class: 'lh-scene-picture-row' })
    const triggerLabel = el('span')
    triggerLabel.textContent = 'When'
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
    const npcsRow = el('label', { class: 'lh-scene-picture-row' })
    const npcsInput = el('input', { type: 'checkbox', 'data-lh-field': field('scene-picture-npcs') }) as HTMLInputElement
    npcsInput.checked = true
    const npcsLabel = el('span')
    npcsLabel.textContent = 'Put the NPCs present into the picture too'
    npcsRow.title = 'You are always in the picture when you have a Player Card; this adds every NPC the newest replies name. While the location prompt is still a shipped art style’s, it follows this switch to the matching variant; an edited prompt is left alone.'
    npcsRow.append(npcsInput, npcsLabel)
    // Multihog's Use Location Images as Chat Background (73f).
    const backgroundRow = el('label', { class: 'lh-scene-picture-row' })
    const backgroundInput = el('input', { type: 'checkbox', 'data-lh-field': field('scene-picture-background') }) as HTMLInputElement
    const backgroundLabel = el('span')
    backgroundLabel.textContent = 'Use the location picture as the chat background'
    backgroundRow.title = 'Multihog’s Use Location Images as Chat Background: the place’s picture is laid behind the chat as the party arrives, and one drawn or set for the current place goes up at once. The layer it is laid on is the host’s, found on the page; the browser console says which, and a picture that does not show is that choice to report.'
    backgroundRow.append(backgroundInput, backgroundLabel)

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
