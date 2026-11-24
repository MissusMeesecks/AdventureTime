// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_MAP_THEME, FACTORY_MAP_THEME_PRESETS, type MapTheme } from '../tracker/map-themes.js'
import { MAP_THEME_CSS, applyMapTheme, createMapThemeCard, type MapThemeCardHost } from './map-theme-card.js'

const el = (tag: string, attrs?: Record<string, string>) => {
    const node = document.createElement(tag)
    for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, value)
    return node
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function makeCard(answer: Record<string, unknown> = {}, confirmed = true) {
    const patches: Record<string, unknown>[] = []
    const applied: MapTheme[] = []
    const uploads: Array<{ dataUrl: string; filename: string }> = []
    let picked: { name: string; bytes: Uint8Array; mimeType?: string } | null = { name: 'texture.png', bytes: new Uint8Array([137, 80, 78, 71]) }
    const confirm = vi.fn(async () => confirmed)
    const host: MapThemeCardHost = {
        el,
        savePrefs: async (patch) => { patches.push(patch); return { prefs: answer } as never },
        upload: async (dataUrl, filename) => { uploads.push({ dataUrl, filename }); return { prefs: { mapTheme: { ...DEFAULT_MAP_THEME, backgroundImage: '/images/stored/map-canvas.png' }, activeMapThemePresetId: '' } } as never },
        pickFile: async () => picked,
        toDataUrl: async (bytes, mimeType) => `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`,
        confirm,
        apply: (theme) => { applied.push(theme) },
        fail: () => undefined,
    }
    const card = createMapThemeCard(host)
    document.body.append(card.root)
    const q = <T extends Element>(selector: string) => card.root.querySelector(selector) as T
    return { card, patches, applied, uploads, confirm, q, setPicked: (next: typeof picked) => { picked = next } }
}

describe('the Map Themes card (74g)', () => {
    it('draws the preset select, the twenty-two colour rows in four groups, the image block and the reset, from the preferences', () => {
        const { card, applied, q } = makeCard()
        card.applyPrefs({ mapTheme: { ...DEFAULT_MAP_THEME, accent: '#123456', backgroundImage: 'https://host/t.png', backgroundImageStrength: 25 }, savedMapThemePresets: { Night: { ...DEFAULT_MAP_THEME, background: '#010203' }, Dawn: DEFAULT_MAP_THEME }, activeMapThemePresetId: 'user:Night' })
        expect(card.root.querySelector('.lh-card-title')!.textContent).toBe('Map themes')
        const select = q<HTMLSelectElement>('[data-lh-field="mapThemePreset"]')
        expect(Array.from(select.options).map((option) => option.value)).toEqual(['', ...FACTORY_MAP_THEME_PRESETS.map((preset) => preset.id), 'user:Dawn', 'user:Night'])
        expect(select.options[0]!.textContent).toBe('Custom (unsaved)')
        expect(Array.from(card.root.querySelectorAll('optgroup')).map((group) => group.getAttribute('label'))).toEqual(['Built-in themes', 'Your presets'])
        expect(select.value).toBe('user:Night')
        expect(q<HTMLButtonElement>('[data-lh-map-theme="delete"]').disabled).toBe(false)
        expect(card.root.querySelectorAll('[data-lh-map-color]').length).toBe(22)
        expect(Array.from(card.root.querySelectorAll('.lh-map-theme-group')).map((group) => group.textContent)).toEqual(['Map', 'Areas', 'Routes', 'Assets'])
        expect(q<HTMLInputElement>('[data-lh-map-color="accent"]').value).toBe('#123456')
        expect(q<HTMLInputElement>('[data-lh-map-hex="accent"]').value).toBe('#123456')
        expect(q<HTMLInputElement>('[data-lh-field="mapThemeUrl"]').value).toBe('https://host/t.png')
        expect(q<HTMLInputElement>('[data-lh-field="mapThemeOverlay"]').value).toBe('25')
        expect(q<HTMLElement>('.lh-map-theme-overlay-value').textContent).toBe('25%')
        const preview = q<HTMLElement>('.lh-map-theme-preview')
        expect(preview.style.backgroundColor).toBe('#0c0c0c')
        expect(preview.style.backgroundImage).toContain('url("https://host/t.png")')
        // Painted on mount, and again from the preferences.
        expect(applied.at(-1)?.accent).toBe('#123456')
        expect(MAP_THEME_CSS).toContain('.lh-map-theme-colors {')
        // A stored address shows in the preview but not in the address box, which is for https ones.
        card.applyPrefs({ mapTheme: { ...DEFAULT_MAP_THEME, backgroundImage: '/images/stored/m.jpg' } })
        expect(preview.style.backgroundImage).toContain('url("/images/stored/m.jpg")')
        expect(q<HTMLInputElement>('[data-lh-field="mapThemeUrl"]').value).toBe('')
        // An active id no option carries reads as Custom, the delete greyed.
        card.applyPrefs({ activeMapThemePresetId: 'user:Gone' })
        expect(select.value).toBe('')
        expect(q<HTMLButtonElement>('[data-lh-map-theme="delete"]').disabled).toBe(true)
        // A set with none of the three keys redraws nothing.
        const before = applied.length
        card.applyPrefs({ layout: 'tabs' })
        expect(applied.length).toBe(before)
    })

    it('previews a colour as the picker moves, marks the preset Custom, and saves when it settles; a bad hex is put back', async () => {
        const { card, patches, applied, q } = makeCard({ mapTheme: { ...DEFAULT_MAP_THEME, accent: '#abcdef' }, activeMapThemePresetId: '' })
        card.applyPrefs({ mapTheme: DEFAULT_MAP_THEME, activeMapThemePresetId: 'factory:ember' })
        const select = q<HTMLSelectElement>('[data-lh-field="mapThemePreset"]')
        expect(select.value).toBe('factory:ember')
        const picker = q<HTMLInputElement>('[data-lh-map-color="accent"]')
        picker.value = '#00FF00'
        picker.dispatchEvent(new Event('input'))
        expect(applied.at(-1)?.accent).toBe('#00ff00')
        expect(select.value).toBe('')
        expect(patches).toEqual([])
        picker.dispatchEvent(new Event('change'))
        expect(patches).toEqual([{ mapTheme: { ...DEFAULT_MAP_THEME, accent: '#00ff00' }, activeMapThemePresetId: '' }])
        await settle()
        // The answer is drawn whole.
        expect(q<HTMLInputElement>('[data-lh-map-hex="accent"]').value).toBe('#abcdef')
        const hex = q<HTMLInputElement>('[data-lh-map-hex="route"]')
        hex.value = 'red'
        hex.dispatchEvent(new Event('change'))
        expect(hex.value).toBe(DEFAULT_MAP_THEME.route)
        expect(patches.length).toBe(1)
        hex.value = '#112233'
        hex.dispatchEvent(new Event('change'))
        expect(patches.at(-1)).toEqual({ mapTheme: { ...DEFAULT_MAP_THEME, accent: '#abcdef', route: '#112233' }, activeMapThemePresetId: '' })
    })

    it('loads a factory or a saved preset (a saved image kept whole), refuses Custom', () => {
        const { card, patches, q } = makeCard()
        const night = { ...DEFAULT_MAP_THEME, background: '#010203', backgroundImage: '/images/stored/n.jpg' }
        card.applyPrefs({ mapTheme: DEFAULT_MAP_THEME, savedMapThemePresets: { Night: night }, activeMapThemePresetId: '' })
        const select = q<HTMLSelectElement>('[data-lh-field="mapThemePreset"]')
        const load = q<HTMLButtonElement>('[data-lh-map-theme="load"]')
        load.click()
        expect(patches).toEqual([])
        expect(q<HTMLElement>('.lh-map-theme-note').textContent).toBe('Choose a theme to load first.')
        expect(q<HTMLElement>('.lh-map-theme-note').classList.contains('lh-map-theme-note--error')).toBe(true)
        select.value = 'factory:verdant'
        select.dispatchEvent(new Event('change'))
        expect(q<HTMLButtonElement>('[data-lh-map-theme="delete"]').disabled).toBe(true)
        load.click()
        expect(patches.at(-1)).toEqual({ mapTheme: FACTORY_MAP_THEME_PRESETS[2]!.theme, activeMapThemePresetId: 'factory:verdant' })
        select.value = 'user:Night'
        select.dispatchEvent(new Event('change'))
        expect(q<HTMLButtonElement>('[data-lh-map-theme="delete"]').disabled).toBe(false)
        load.click()
        expect(patches.at(-1)).toEqual({ mapTheme: night, activeMapThemePresetId: 'user:Night' })
    })

    it('asks before Reset to Ember, and a refusal changes nothing (96)', async () => {
        const custom = { ...DEFAULT_MAP_THEME, accent: '#123456' }
        const yes = makeCard()
        yes.card.applyPrefs({ mapTheme: custom, activeMapThemePresetId: '' })
        yes.q<HTMLButtonElement>('[data-lh-map-theme="reset"]').click()
        expect(yes.patches).toEqual([])
        await settle()
        expect(yes.confirm).toHaveBeenCalledWith('Reset to Ember', 'This replaces the current colors and canvas image with the Ember theme. Unsaved custom colors are lost.', 'Reset')
        expect(yes.patches).toEqual([{ mapTheme: DEFAULT_MAP_THEME, activeMapThemePresetId: 'factory:ember' }])

        const no = makeCard({}, false)
        no.card.applyPrefs({ mapTheme: custom, activeMapThemePresetId: '' })
        const painted = no.applied.length
        no.q<HTMLButtonElement>('[data-lh-map-theme="reset"]').click()
        await settle()
        expect(no.confirm).toHaveBeenCalledTimes(1)
        expect(no.patches).toEqual([])
        expect(no.applied.length).toBe(painted)
        expect(no.q<HTMLInputElement>('[data-lh-map-color="accent"]').value).toBe('#123456')
        expect(no.q<HTMLElement>('.lh-map-theme-note').textContent).toBe('')
    })

    it('keeps its help behind [?]s, in the DOM from the first paint, and none in the open (96)', () => {
        const { card, q } = makeCard()
        const notes = Array.from(card.root.querySelectorAll<HTMLElement>('.lh-help-note'))
        expect(notes.map((note) => note.textContent)).toEqual([
            'Sets the colors of every map on screen. Changes show at once. They never change map or campaign data.',
            'Choose a theme and press Load preset to use it. Save preset as keeps the current colors and canvas image under the name you enter. Saved presets are kept with this install, not in a cartridge.',
            'Shows a texture or artwork behind the map. The canvas color is laid over it so rooms and routes stay readable. You can upload a file or paste an http or https image URL. Saved presets include the image.',
            'Higher values make the canvas color more opaque over the image. Default: 55%.',
        ])
        expect(notes.every((note) => note.hidden)).toBe(true)
        expect(DEFAULT_MAP_THEME.backgroundImageStrength).toBe(55)
        const tips = Array.from(card.root.querySelectorAll<HTMLButtonElement>('.lh-help-tip'))
        expect(tips.map((tip) => tip.getAttribute('aria-label'))).toEqual(['Help: Map themes', 'Help: Preset', 'Help: Canvas background image', 'Help: Canvas color overlay'])
        // No [?] and no note sits inside a <label>; the card's note is the body's first line.
        for (const node of [...tips, ...notes]) expect(node.closest('label')).toBeNull()
        expect(card.root.querySelector('summary')!.nextElementSibling).toBe(notes[0])
        // A press opens the help, and the card with it.
        expect(card.root.open).toBe(false)
        tips[0]!.click()
        expect(card.root.open).toBe(true)
        expect(notes[0]!.hidden).toBe(false)
        tips[1]!.click()
        expect(notes[1]!.hidden).toBe(false)
        expect(tips[1]!.previousElementSibling!.textContent).toBe('Preset')
        // The old standing paragraphs and the tooltip that carried help are gone.
        expect(card.root.querySelector('.lh-section-help')).toBeNull()
        expect(card.root.textContent).not.toContain('Customize the appearance')
        expect(card.root.textContent).not.toContain('(optional)')
        expect(q<HTMLInputElement>('[data-lh-field="mapThemeOverlay"]').hasAttribute('title')).toBe(false)
        expect(MAP_THEME_CSS).toContain('.lh-map-theme-label { display: flex;')
    })

    it('says the decided labels, the colour names through the display overrides (96)', () => {
        const { card, q } = makeCard()
        expect(q<HTMLElement>('[data-lh-map-theme="load"]').textContent).toBe('📂 Load preset')
        expect(q<HTMLElement>('[data-lh-map-theme="save"]').textContent).toBe('💾 Save preset as')
        expect(q<HTMLElement>('[data-lh-map-theme="delete"]').getAttribute('aria-label')).toBe('Delete saved preset')
        expect(q<HTMLElement>('[data-lh-map-theme="delete"]').title).toBe('Delete saved preset')
        expect(q<HTMLInputElement>('[data-lh-field="mapThemeName"]').placeholder).toBe('My map theme')
        expect(q<HTMLElement>('[data-lh-field="mapThemeName"]').getAttribute('aria-label')).toBe('Preset name')
        expect(q<HTMLElement>('[data-lh-map-theme="upload"]').textContent).toBe('⬆ Upload image')
        expect(q<HTMLElement>('[data-lh-map-theme="clear"]').textContent).toBe('Clear image')
        expect(q<HTMLInputElement>('[data-lh-field="mapThemeUrl"]').placeholder).toBe('https://example.com/map.png')
        expect(q<HTMLElement>('[data-lh-field="mapThemeUrl"]').getAttribute('aria-label')).toBe('Background image URL')
        expect(q<HTMLElement>('.lh-map-theme-preview').title).toBe('Background preview')
        expect(q<HTMLElement>('.lh-map-theme-image-title').textContent).toBe('Canvas background image')
        expect(q<HTMLElement>('[data-lh-map-theme="reset"]').textContent).toBe('↺ Reset to Ember')
        const shown = (key: string) => {
            const picker = q<HTMLInputElement>(`[data-lh-map-color="${key}"]`)
            const row = picker.closest('label')!
            return [row.querySelector('span')!.textContent, row.title, picker.getAttribute('aria-label'), q<HTMLElement>(`[data-lh-map-hex="${key}"]`).getAttribute('aria-label')]
        }
        expect(shown('textbox')).toEqual(['Hover card background', 'Choose the hover card background color', 'Hover card background color picker', 'Hover card background hex color'])
        expect(shown('textMuted')).toEqual(['Visited area text', 'Choose the visited area text color', 'Visited area text color picker', 'Visited area text hex color'])
        expect(shown('routeLocked')).toEqual(['Closed or locked route', 'Choose the closed or locked route color', 'Closed or locked route color picker', 'Closed or locked route hex color'])
        expect(shown('routeBlocked')).toEqual(['Blocked or destroyed route', 'Choose the blocked or destroyed route color', 'Blocked or destroyed route color picker', 'Blocked or destroyed route hex color'])
        expect(shown('other')).toEqual(['Other asset', 'Choose the other asset color', 'Other asset color picker', 'Other asset hex color'])
        // A field with no override keeps the generated name.
        expect(shown('background')).toEqual(['Canvas', 'Choose the canvas color', 'Canvas color picker', 'Canvas hex color'])
        expect(card.root.textContent).not.toContain('Textbox background')
    })

    it('saves the theme under a name, replacing a kept one after a confirm, and deletes a saved one after a confirm', async () => {
        const { card, patches, confirm, q } = makeCard()
        card.applyPrefs({ mapTheme: { ...DEFAULT_MAP_THEME, accent: '#123456' }, savedMapThemePresets: { Night: DEFAULT_MAP_THEME }, activeMapThemePresetId: '' })
        const name = q<HTMLInputElement>('[data-lh-field="mapThemeName"]')
        const save = q<HTMLButtonElement>('[data-lh-map-theme="save"]')
        save.click()
        await settle()
        expect(patches).toEqual([])
        expect(q<HTMLElement>('.lh-map-theme-note').textContent).toBe('Enter a preset name first.')
        name.value = '__proto__'
        save.click()
        await settle()
        expect(patches).toEqual([])
        expect(q<HTMLElement>('.lh-map-theme-note').textContent).toBe('Choose another preset name.')
        name.value = '  Dawn  '
        save.click()
        await settle()
        expect(confirm).not.toHaveBeenCalled()
        expect(patches.at(-1)).toEqual({ savedMapThemePresets: { Night: DEFAULT_MAP_THEME, Dawn: { ...DEFAULT_MAP_THEME, accent: '#123456' } }, activeMapThemePresetId: 'user:Dawn' })
        expect(name.value).toBe('')
        // A kept name, case-blind, asks first and takes the typed spelling.
        name.value = 'night'
        save.click()
        await settle()
        expect(confirm).toHaveBeenCalledWith('Replace map theme?', 'This replaces the saved preset "Night".', 'Replace')
        expect(patches.at(-1)).toEqual({ savedMapThemePresets: { night: { ...DEFAULT_MAP_THEME, accent: '#123456' } }, activeMapThemePresetId: 'user:night' })
        // Delete: the picked saved preset, after a confirm; the active id cleared when it was the one.
        card.applyPrefs({ savedMapThemePresets: { Night: DEFAULT_MAP_THEME, Dawn: DEFAULT_MAP_THEME }, activeMapThemePresetId: 'user:Night' })
        q<HTMLButtonElement>('[data-lh-map-theme="delete"]').click()
        await settle()
        expect(confirm).toHaveBeenLastCalledWith('Delete map theme?', 'This deletes the saved preset "Night". It cannot be undone.', 'Delete')
        expect(patches.at(-1)).toEqual({ savedMapThemePresets: { Dawn: DEFAULT_MAP_THEME }, activeMapThemePresetId: '' })
    })

    it('does nothing when a confirm is declined', async () => {
        const { card, patches, q } = makeCard({}, false)
        card.applyPrefs({ savedMapThemePresets: { Night: DEFAULT_MAP_THEME }, activeMapThemePresetId: 'user:Night' })
        q<HTMLInputElement>('[data-lh-field="mapThemeName"]').value = 'Night'
        q<HTMLButtonElement>('[data-lh-map-theme="save"]').click()
        await settle()
        q<HTMLButtonElement>('[data-lh-map-theme="delete"]').click()
        await settle()
        expect(patches).toEqual([])
    })

    it('takes the canvas image by address under the legacy’s rule, clears it, uploads it through the host, and moves the overlay', async () => {
        const { card, patches, applied, uploads, q, setPicked } = makeCard()
        card.applyPrefs({ mapTheme: DEFAULT_MAP_THEME, activeMapThemePresetId: 'factory:ember' })
        const url = q<HTMLInputElement>('[data-lh-field="mapThemeUrl"]')
        url.value = 'ftp://host/a.png'
        url.dispatchEvent(new Event('change'))
        expect(patches).toEqual([])
        expect(q<HTMLElement>('.lh-map-theme-note').textContent).toBe('Enter an http or https image URL, or upload a file.')
        url.value = 'https://host/a.png'
        url.dispatchEvent(new Event('change'))
        expect(patches.at(-1)).toEqual({ mapTheme: { ...DEFAULT_MAP_THEME, backgroundImage: 'https://host/a.png' }, activeMapThemePresetId: '' })
        q<HTMLButtonElement>('[data-lh-map-theme="clear"]').click()
        expect(patches.at(-1)).toEqual({ mapTheme: { ...DEFAULT_MAP_THEME, backgroundImage: '' }, activeMapThemePresetId: '' })
        // The overlay: previewed as it moves, Custom, saved when let go.
        const overlay = q<HTMLInputElement>('[data-lh-field="mapThemeOverlay"]')
        overlay.value = '80'
        overlay.dispatchEvent(new Event('input'))
        expect(applied.at(-1)?.backgroundImageStrength).toBe(80)
        expect(q<HTMLElement>('.lh-map-theme-overlay-value').textContent).toBe('80%')
        expect(q<HTMLSelectElement>('[data-lh-field="mapThemePreset"]').value).toBe('')
        const before = patches.length
        overlay.dispatchEvent(new Event('change'))
        expect(patches.length).toBe(before + 1)
        expect(patches.at(-1)).toEqual({ mapTheme: { ...DEFAULT_MAP_THEME, backgroundImageStrength: 80 }, activeMapThemePresetId: '' })
        // Upload: the picker, the bytes as a data URL, the op, the answer drawn.
        q<HTMLButtonElement>('[data-lh-map-theme="upload"]').click()
        await settle()
        await settle()
        expect(uploads).toEqual([{ dataUrl: 'data:image/png;base64,iVBORw==', filename: 'texture.png' }])
        expect(q<HTMLElement>('.lh-map-theme-preview').style.backgroundImage).toContain('/images/stored/map-canvas.png')
        expect(q<HTMLElement>('.lh-map-theme-note').textContent).toBe('Map background image set.')
        setPicked(null)
        q<HTMLButtonElement>('[data-lh-map-theme="upload"]').click()
        await settle()
        expect(q<HTMLElement>('.lh-map-theme-note').textContent).toBe('No image was chosen.')
    })

    it('paints a theme on a root through the legacy’s applier, a stored address made absolute first', () => {
        const vars: Record<string, string> = {}
        const fakeRoot = { ownerDocument: { baseURI: 'http://host/app/' }, style: { setProperty: (name: string, value: string) => { vars[name] = value } } } as unknown as HTMLElement
        applyMapTheme(fakeRoot, { ...DEFAULT_MAP_THEME, accent: '#123456', backgroundImage: '/images/stored/m.jpg' })
        expect(vars['--rt-map-accent']).toBe('#123456')
        expect(vars['--rt-map-background-image']).toBe('url("http://host/images/stored/m.jpg")')
        applyMapTheme(fakeRoot, { ...DEFAULT_MAP_THEME, backgroundImage: 'https://cdn/t.png' })
        expect(vars['--rt-map-background-image']).toBe('url("https://cdn/t.png")')
        // A scheme the resolver refuses never reaches the applier's url.
        applyMapTheme(fakeRoot, { ...DEFAULT_MAP_THEME, backgroundImage: 'javascript:alert(1)' })
        expect(vars['--rt-map-background-image']).toBe('none')
        // On the real body: the variables land on its style.
        applyMapTheme(document.body, { ...DEFAULT_MAP_THEME, accent: '#654321' })
        expect(document.body.style.getPropertyValue('--rt-map-accent')).toBe('#654321')
    })
})
