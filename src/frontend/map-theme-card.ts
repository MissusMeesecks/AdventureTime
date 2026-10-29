/**
 * The Map Themes card (roadmap row 74, Phase 74g): Multihog's *Map Themes*
 * drawer as the second card of *Persistent maps* — the preset select with
 * Load, Save as and Delete, the twenty-two colour rows in their four
 * groups, the canvas image with its overlay, and Reset to Ember. The
 * grammar is the legacy's (`src/tracker/map-themes.ts`, the twentieth
 * generated file); the theme is painted on the body through the legacy's
 * applier, so every map on screen takes it at once, and the three
 * preferences carry it: `mapTheme`, `savedMapThemePresets` and
 * `activeMapThemePresetId`. The canvas image goes through the host's image
 * store as the backdrops do (74d, departure 125).
 */
import type { PrefsResult } from '../protocol.js'
import {
    DEFAULT_MAP_THEME,
    DEFAULT_MAP_THEME_PRESET_ID,
    FACTORY_MAP_THEME_PRESETS,
    MAP_THEME_FIELDS,
    applyMapThemeToRoot,
    mapThemePresetName,
    readMapTheme,
    readMapThemePresetId,
    readSavedMapThemePresets,
    resolveMapThemePreset,
    type MapTheme,
    type MapThemeColorKey,
} from '../tracker/map-themes.js'
import { resolvePortraitSrc } from '../tracker/portraits.js'

type El = (tag: string, attrs?: Record<string, string>) => HTMLElement

export interface MapThemeCardHost {
    el: El
    /** `prefs.patch`; the answer's set is drawn. */
    savePrefs(patch: Record<string, unknown>): Promise<PrefsResult>
    /** `backdrop.upload` with the map's box; the answer's set is drawn. */
    upload(dataUrl: string, filename: string): Promise<PrefsResult>
    /** The host's picker, as the portraits' is asked: the picked file, or null. */
    pickFile(): Promise<{ name: string; bytes: Uint8Array; mimeType?: string } | null>
    /** The bytes as a data URL, scaled as the legacy scales a panel image. */
    toDataUrl(bytes: Uint8Array, mimeType: string): Promise<string>
    confirm(title: string, message: string, confirmLabel: string): Promise<boolean>
    /** Paint the theme where every map sees it: the body. */
    apply(theme: MapTheme): void
    fail(error: unknown): void
}

export interface MapThemeCard {
    root: HTMLDetailsElement
    /** The three preferences read off a set, as `prefs.get` and `prefs.changed` carry them. */
    applyPrefs(prefs: Record<string, unknown>): void
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i
const PROTO_NAMES = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * The legacy's applier on a root, with the canvas image made absolute first:
 * an address in the host's store is relative, and the legacy keeps only
 * `data:image/` and `http(s)://` sources, so a relative one would be dropped.
 */
export function applyMapTheme(root: HTMLElement, theme: MapTheme): void {
    applyMapThemeToRoot({ ...theme, backgroundImage: absoluteImage(root, theme.backgroundImage) }, root)
}

function absoluteImage(root: HTMLElement, src: string): string {
    const value = resolvePortraitSrc(src)
    if (!value || /^(data:image\/|https?:\/\/)/i.test(value)) return value
    try {
        const url = new URL(value, root.ownerDocument?.baseURI || undefined)
        return /^https?:$/.test(url.protocol) ? url.href : value
    } catch {
        return value
    }
}

export function createMapThemeCard(host: MapThemeCardHost): MapThemeCard {
    const el = host.el
    const root = el('details', { class: 'lh-card lh-map-themes lh-search-item', 'data-lh-field': 'map-themes' }) as HTMLDetailsElement
    const summary = el('summary')
    const icon = el('span', { class: 'lh-card-icon', 'aria-hidden': 'true' })
    icon.textContent = '🎨'
    const title = el('span', { class: 'lh-card-title' })
    title.textContent = 'Map Themes'
    summary.append(icon, title, el('span', { class: 'lh-chevron', 'aria-hidden': 'true' }))
    const body = el('div', { class: 'lh-map-theme-body' })
    root.append(summary, body)

    let theme: MapTheme = { ...DEFAULT_MAP_THEME }
    let saved: Record<string, MapTheme> = {}
    let activeId = DEFAULT_MAP_THEME_PRESET_ID

    const help = el('div', { class: 'lh-section-help' })
    help.textContent = 'Customize the appearance used by every persistent map. Changes appear immediately and never alter map or campaign data.'

    // The preset row: the select, Load, a name and Save as, Delete.
    const presetLabel = el('label', { class: 'lh-map-theme-label' })
    presetLabel.textContent = 'Preset'
    const presetRow = el('div', { class: 'lh-map-theme-preset-row' })
    const select = el('select', { class: 'lh-select lh-map-theme-select', 'aria-label': 'Map theme preset', 'data-lh-field': 'mapThemePreset' }) as HTMLSelectElement
    const loadButton = el('button', { type: 'button', class: 'lh-button', 'data-lh-map-theme': 'load' }) as HTMLButtonElement
    loadButton.textContent = '📂 Load'
    const nameInput = el('input', { type: 'text', class: 'lh-input lh-map-theme-name', placeholder: 'My Map Theme', 'aria-label': 'A name for the preset', 'data-lh-field': 'mapThemeName' }) as HTMLInputElement
    const saveButton = el('button', { type: 'button', class: 'lh-button', 'data-lh-map-theme': 'save' }) as HTMLButtonElement
    saveButton.textContent = '💾 Save as'
    const deleteButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet', title: 'Delete the selected saved preset', 'aria-label': 'Delete the selected saved preset', 'data-lh-map-theme': 'delete' }) as HTMLButtonElement
    deleteButton.textContent = '🗑'
    presetRow.append(select, loadButton, nameInput, saveButton, deleteButton)

    // The colours: the legacy's twenty-two fields in their four groups, a picker and a hex box each.
    const colors = el('div', { class: 'lh-map-theme-colors', 'aria-label': 'Map theme colors' })
    const pickers = new Map<MapThemeColorKey, HTMLInputElement>()
    const hexes = new Map<MapThemeColorKey, HTMLInputElement>()
    let group = ''
    for (const field of MAP_THEME_FIELDS) {
        if (field.group !== group) {
            group = field.group
            const heading = el('div', { class: 'lh-map-theme-group' })
            heading.textContent = group
            colors.append(heading)
        }
        const row = el('label', { class: 'lh-map-theme-color', title: `Choose the ${field.label.toLowerCase()} color` })
        const picker = el('input', { type: 'color', 'aria-label': `${field.label} color picker`, 'data-lh-map-color': field.key }) as HTMLInputElement
        const name = el('span')
        name.textContent = field.label
        const hex = el('input', { type: 'text', class: 'lh-input lh-map-theme-hex', maxlength: '7', spellcheck: 'false', 'aria-label': `${field.label} hex color`, 'data-lh-map-hex': field.key }) as HTMLInputElement
        row.append(picker, name, hex)
        colors.append(row)
        pickers.set(field.key, picker)
        hexes.set(field.key, hex)
        // The picker previews as it moves and saves when it settles; the hex box on change, the invalid put back (the legacy's rule).
        picker.addEventListener('input', () => { setColor(field.key, picker.value, false) })
        picker.addEventListener('change', () => { setColor(field.key, picker.value, true) })
        hex.addEventListener('change', () => {
            if (!HEX_COLOR.test(hex.value.trim())) { hex.value = theme[field.key]; return }
            setColor(field.key, hex.value.trim(), true)
        })
    }

    // The canvas image: the preview, Upload and Clear, an address, the overlay.
    const imageBlock = el('div', { class: 'lh-map-theme-image' })
    const imageTitle = el('div', { class: 'lh-map-theme-image-title' })
    imageTitle.textContent = 'Canvas background image (optional)'
    const imageHelp = el('div', { class: 'lh-section-help' })
    imageHelp.textContent = 'Optional texture or artwork behind the map graph. The Canvas color overlays it to keep nodes and routes readable. Saved custom presets include the image.'
    const imageRow = el('div', { class: 'lh-map-theme-image-row' })
    const preview = el('div', { class: 'lh-map-theme-preview', title: 'Map background preview' })
    const imageFields = el('div', { class: 'lh-map-theme-image-fields' })
    const imageButtons = el('div', { class: 'lh-map-theme-buttons' })
    const uploadButton = el('button', { type: 'button', class: 'lh-button', 'data-lh-map-theme': 'upload' }) as HTMLButtonElement
    uploadButton.textContent = '⬆ Upload'
    const clearButton = el('button', { type: 'button', class: 'lh-button', 'data-lh-map-theme': 'clear' }) as HTMLButtonElement
    clearButton.textContent = 'Clear'
    imageButtons.append(uploadButton, clearButton)
    const urlInput = el('input', { type: 'text', class: 'lh-input lh-map-theme-url', placeholder: 'Or paste an image URL…', 'aria-label': 'Map background image URL', 'data-lh-field': 'mapThemeUrl' }) as HTMLInputElement
    imageFields.append(imageButtons, urlInput)
    imageRow.append(preview, imageFields)
    const overlayRow = el('div', { class: 'lh-map-theme-overlay' })
    const overlayLabel = el('span')
    overlayLabel.textContent = 'Canvas color overlay'
    const overlayValue = el('span', { class: 'lh-map-theme-overlay-value' })
    const overlay = el('input', { type: 'range', min: '0', max: '100', step: '1', title: 'Higher values make the Canvas color more opaque over the image', 'aria-label': 'Canvas color overlay', 'data-lh-field': 'mapThemeOverlay' }) as HTMLInputElement
    overlayRow.append(overlayLabel, overlay, overlayValue)
    imageBlock.append(imageTitle, imageHelp, imageRow, overlayRow)

    const resetRow = el('div', { class: 'lh-map-theme-reset' })
    const resetButton = el('button', { type: 'button', class: 'lh-button', 'data-lh-map-theme': 'reset' }) as HTMLButtonElement
    resetButton.textContent = '↺ Reset to Ember'
    resetRow.append(resetButton)
    const note = el('div', { class: 'lh-map-theme-note', role: 'status' })

    body.append(help, presetLabel, presetRow, colors, imageBlock, resetRow, note)

    const say = (message: string, error = false): void => {
        note.textContent = message
        note.classList.toggle('lh-map-theme-note--error', error)
    }

    /** A save: the answer is the truth, drawn whole. */
    const save = (patch: Record<string, unknown>, done: string): void => {
        host.savePrefs(patch)
            .then((result) => { applyPrefs((result.prefs ?? {}) as Record<string, unknown>); say(done) })
            .catch((error: unknown) => { say(error instanceof Error ? error.message : String(error), true); host.fail(error) })
    }

    /** A colour by hand: previewed at once, the preset Custom, saved when it settles (the legacy's flush). */
    const setColor = (key: MapThemeColorKey, value: string, settle: boolean): void => {
        if (!HEX_COLOR.test(value)) return
        theme = { ...theme, [key]: value.toLowerCase() }
        markCustom()
        host.apply(theme)
        if (settle) {
            drawColors()
            save({ mapTheme: theme, activeMapThemePresetId: '' }, '')
        }
    }

    const markCustom = (): void => {
        activeId = ''
        select.value = ''
        deleteButton.disabled = true
    }

    const drawSelect = (): void => {
        select.replaceChildren()
        const custom = el('option', { value: '' }) as HTMLOptionElement
        custom.textContent = 'Custom (unsaved)'
        select.append(custom)
        const factory = el('optgroup', { label: 'Factory themes' })
        for (const preset of FACTORY_MAP_THEME_PRESETS) {
            const option = el('option', { value: preset.id }) as HTMLOptionElement
            option.textContent = preset.name
            factory.append(option)
        }
        select.append(factory)
        const names = Object.keys(saved).sort((a, b) => a.localeCompare(b))
        if (names.length) {
            const yours = el('optgroup', { label: 'Your presets' })
            for (const name of names) {
                const option = el('option', { value: `user:${name}` }) as HTMLOptionElement
                option.textContent = name
                yours.append(option)
            }
            select.append(yours)
        }
        // An id no option carries leaves the select on Custom: the DOM's own rule (a mutation found the legacy's explicit check redundant).
        select.value = activeId
        deleteButton.disabled = !select.value.startsWith('user:')
    }

    const drawColors = (): void => {
        for (const [key, picker] of pickers) picker.value = theme[key]
        for (const [key, hex] of hexes) hex.value = theme[key]
    }

    const drawImage = (): void => {
        const alpha = Math.round(theme.backgroundImageStrength * 2.55).toString(16).padStart(2, '0')
        const src = resolvePortraitSrc(theme.backgroundImage)
        preview.style.backgroundColor = theme.background
        preview.style.backgroundImage = src
            ? `linear-gradient(${theme.background}${alpha}, ${theme.background}${alpha}), url(${JSON.stringify(src)})`
            : 'none'
        urlInput.value = /^https?:\/\//i.test(theme.backgroundImage) ? theme.backgroundImage : ''
        overlay.value = String(theme.backgroundImageStrength)
        overlayValue.textContent = `${theme.backgroundImageStrength}%`
    }

    const draw = (): void => {
        drawSelect()
        drawColors()
        drawImage()
        host.apply(theme)
    }

    function applyPrefs(prefs: Record<string, unknown>): void {
        let moved = false
        if (prefs.mapTheme !== undefined) { theme = readMapTheme(prefs.mapTheme); moved = true }
        if (prefs.savedMapThemePresets !== undefined) { saved = readSavedMapThemePresets(prefs.savedMapThemePresets); moved = true }
        if (prefs.activeMapThemePresetId !== undefined) { activeId = readMapThemePresetId(prefs.activeMapThemePresetId); moved = true }
        if (moved) draw()
    }

    select.addEventListener('change', () => { deleteButton.disabled = !select.value.startsWith('user:') })
    loadButton.addEventListener('click', () => {
        const id = select.value
        const picked = resolveMapThemePreset(id, saved)
        if (!picked) { say('Choose a saved or factory theme first.', true); return }
        // A preset's image is the legacy's two sources or a stored address (readMapTheme); the resolver's copy drops a stored one, so the saved copy is taken whole.
        const loaded = id.startsWith('user:') ? saved[id.slice(5)]! : picked
        save({ mapTheme: loaded, activeMapThemePresetId: id }, `Loaded ${mapThemePresetName(id, saved) ?? 'map theme'}.`)
    })
    saveButton.addEventListener('click', async () => {
        const name = nameInput.value.trim().slice(0, 80)
        if (!name) { say('Name the preset first.', true); return }
        if (PROTO_NAMES.has(name)) { say('Please choose another preset name.', true); return }
        const existing = Object.keys(saved).find((kept) => kept.toLowerCase() === name.toLowerCase())
        if (existing) {
            const replace = await host.confirm('Replace Map Theme?', `Replace the saved map theme "${existing}"?`, 'Replace')
            if (!replace) return
        }
        const { [existing ?? '']: _gone, ...rest } = saved
        const next = existing && existing !== name ? rest : { ...saved }
        next[name] = { ...theme }
        nameInput.value = ''
        save({ savedMapThemePresets: next, activeMapThemePresetId: `user:${name}` }, `Saved ${name}.`)
    })
    deleteButton.addEventListener('click', async () => {
        const id = select.value
        if (!id.startsWith('user:')) return
        const name = id.slice(5)
        const approved = await host.confirm('Delete Map Theme?', `Delete the saved map theme "${name}"?`, 'Delete')
        if (!approved) return
        const { [name]: _gone, ...rest } = saved
        save({ savedMapThemePresets: rest, activeMapThemePresetId: activeId === id ? '' : activeId }, `Deleted ${name}.`)
    })
    resetButton.addEventListener('click', () => {
        save({ mapTheme: { ...DEFAULT_MAP_THEME }, activeMapThemePresetId: DEFAULT_MAP_THEME_PRESET_ID }, 'Map theme reset to Ember.')
    })

    /** The image by address or cleared: the legacy's rule (http(s) or a file), the preset Custom. */
    const setImage = (source: string, done: string): void => {
        const stored = source.trim()
        if (stored && !/^https?:\/\//i.test(stored)) { say('Use an http(s) image URL or upload a file.', true); return }
        save({ mapTheme: { ...theme, backgroundImage: stored }, activeMapThemePresetId: '' }, done)
    }
    urlInput.addEventListener('change', () => { setImage(urlInput.value, urlInput.value.trim() ? 'Map background image set.' : 'Map background image cleared.') })
    clearButton.addEventListener('click', () => { setImage('', 'Map background image cleared.') })
    uploadButton.addEventListener('click', () => {
        host.pickFile()
            .then(async (picked) => {
                if (!picked) { say('No picture was picked.'); return }
                say('Storing the picture…')
                const mime = picked.mimeType || (/\.jpe?g$/i.test(picked.name) ? 'image/jpeg' : /\.webp$/i.test(picked.name) ? 'image/webp' : /\.gif$/i.test(picked.name) ? 'image/gif' : 'image/png')
                const dataUrl = await host.toDataUrl(picked.bytes, mime)
                const filename = dataUrl.startsWith('data:image/jpeg') ? 'map-canvas.jpg' : picked.name || 'map-canvas.png'
                const result = await host.upload(dataUrl, filename)
                applyPrefs((result.prefs ?? {}) as Record<string, unknown>)
                say('Map background image set.')
            })
            .catch((error: unknown) => { say(error instanceof Error ? error.message : String(error), true); host.fail(error) })
    })
    overlay.addEventListener('input', () => {
        const strength = Math.max(0, Math.min(100, Math.round(Number(overlay.value) || 0)))
        theme = { ...theme, backgroundImageStrength: strength }
        markCustom()
        host.apply(theme)
        drawImage()
    })
    overlay.addEventListener('change', () => { save({ mapTheme: theme, activeMapThemePresetId: '' }, '') })

    draw()
    return { root, applyPrefs }
}

export const MAP_THEME_CSS = `
.adventuretime-panel .lh-map-theme-body { display: flex; flex-direction: column; gap: 8px; padding: 8px 10px 10px; font-size: 0.85em; }
.adventuretime-panel .lh-map-theme-label { font-weight: 600; font-size: 0.9em; }
.adventuretime-panel .lh-map-theme-preset-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.adventuretime-panel .lh-map-theme-select { flex: 1 1 10em; min-width: 8em; }
.adventuretime-panel .lh-map-theme-name { flex: 1 1 8em; min-width: 7em; }
.adventuretime-panel .lh-map-theme-colors { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 4px 10px; }
.adventuretime-panel .lh-map-theme-group { grid-column: 1 / -1; margin-top: 6px; font-size: 0.78em; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.7; }
.adventuretime-panel .lh-map-theme-color { display: grid; grid-template-columns: 28px 1fr 5.5em; gap: 6px; align-items: center; cursor: pointer; }
.adventuretime-panel .lh-map-theme-color input[type="color"] { width: 28px; height: 22px; padding: 0; border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25))); border-radius: 4px; background: none; cursor: pointer; }
.adventuretime-panel .lh-map-theme-hex { font-family: var(--lh-font-mono, var(--lumiverse-font-mono, monospace)); font-size: 0.85em; }
.adventuretime-panel .lh-map-theme-image { display: flex; flex-direction: column; gap: 6px; padding-top: 6px; border-top: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25))); }
.adventuretime-panel .lh-map-theme-image-title { font-weight: 600; font-size: 0.9em; }
.adventuretime-panel .lh-map-theme-image-row { display: flex; gap: 10px; align-items: flex-start; flex-wrap: wrap; }
.adventuretime-panel .lh-map-theme-preview { width: 72px; height: 48px; border-radius: 6px; border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(255,255,255,0.15))); background: rgba(0,0,0,0.35) center/cover no-repeat; flex-shrink: 0; }
.adventuretime-panel .lh-map-theme-image-fields { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 140px; }
.adventuretime-panel .lh-map-theme-buttons { display: flex; gap: 4px; flex-wrap: wrap; }
.adventuretime-panel .lh-map-theme-overlay { display: flex; align-items: center; gap: 8px; font-size: 0.85em; }
.adventuretime-panel .lh-map-theme-overlay input[type="range"] { flex: 1; cursor: pointer; }
.adventuretime-panel .lh-map-theme-overlay-value { font-weight: bold; opacity: 0.8; min-width: 3em; text-align: right; }
.adventuretime-panel .lh-map-theme-reset { display: flex; justify-content: flex-end; }
.adventuretime-panel .lh-map-theme-note { font-size: 0.9em; opacity: 0.85; min-height: 1.2em; }
.adventuretime-panel .lh-map-theme-note--error { color: var(--lumiverse-danger, #d9534f); opacity: 1; }
`
