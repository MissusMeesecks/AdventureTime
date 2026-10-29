// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import { mountPortraitStyles, type PortraitStylesHost } from './portrait-styles.js'

function harness(settings: Record<string, unknown> = {}, over: Partial<PortraitStylesHost> = {}, confirmed = true) {
    const calls: unknown[][] = []
    const host: PortraitStylesHost = {
        load: async (id) => { calls.push(['load', id]) },
        save: async (name, overwrite) => { calls.push(['save', name, overwrite]) },
        remove: async (name) => { calls.push(['remove', name]) },
        confirm: async (message) => { calls.push(['confirm', message]); return confirmed },
        ...over,
    }
    const mount = document.createElement('div')
    document.body.replaceChildren(mount)
    const el = (tag: string, attrs?: Record<string, string>) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n }
    const styles = mountPortraitStyles(mount, { createElement: el }, settings, host)
    const button = (label: string) => mount.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement
    const names = (which: 'factory' | 'saved') => Array.from(mount.querySelectorAll(`[data-lh-field="portrait-styles-${which}"] .lh-style-name`)).map((n) => n.textContent)
    const note = () => mount.querySelector('[data-lh-field="portrait-styles-note"]') as HTMLElement
    const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0)) }
    return { styles, mount, calls, button, names, note, settle }
}

describe('the art styles (63b)', () => {
    it('lists the seven factory styles and the saved setups, marks the one loaded last, and Load asks for it', async () => {
        const { styles, mount, calls, button, names, note, settle } = harness({ activePortraitPromptPresetId: 'anime', savedPortraitPromptPresets: { Mine: { wordTarget: 150 } } })
        expect(names('factory')).toEqual(['Fantasy (Default)', 'Anime', 'Photorealistic', 'Oil Painting', 'Comic Book', 'Watercolor', 'Dark Fantasy'])
        expect(names('saved')).toEqual(['Mine'])
        expect(Array.from(mount.querySelectorAll('.lh-style--active .lh-style-name')).map((n) => n.textContent)).toEqual(['Anime'])
        button('Load Comic Book').click()
        expect(button('Load Anime').disabled).toBe(true)
        await settle()
        expect(calls).toEqual([['load', 'comic']])
        expect(note().textContent).toBe('Loaded the Comic Book style: its three prompts and word target are above.')
        button('Load Mine').click()
        await settle()
        expect(calls[1]).toEqual(['load', 'user:Mine'])
        // The settings as they come back decide the mark; an empty id marks nothing.
        styles.setSettings({ activePortraitPromptPresetId: 'user:Mine', savedPortraitPromptPresets: { Mine: {}, Other: {} } })
        expect(Array.from(mount.querySelectorAll('.lh-style--active .lh-style-name')).map((n) => n.textContent)).toEqual(['Mine'])
        expect(names('saved')).toEqual(['Mine', 'Other'])
        styles.setSettings({ activePortraitPromptPresetId: '', savedPortraitPromptPresets: {} })
        expect(mount.querySelector('.lh-style--active')).toBeNull()
        expect(mount.querySelector('[data-lh-field="portrait-styles-saved-label"]')!.textContent).toBe('Your saved setups (none yet)')
    })

    it('saves under a typed name, asks before replacing a kept one, deletes after a confirm, and shows a refusal', async () => {
        const { mount, calls, button, note, settle } = harness({ savedPortraitPromptPresets: { Mine: {} } }, { save: async (name) => { if (name === 'Anime') throw new Error('"Anime" is a factory art style’s name.'); calls.push(['save', name]) } })
        const input = mount.querySelector('[data-lh-field="style-name"]') as HTMLInputElement
        const save = Array.from(mount.querySelectorAll('button')).find((b) => b.textContent === 'Save setup to library') as HTMLButtonElement
        save.click()
        await settle()
        expect(note().textContent).toBe('Give the setup a name first.')
        expect(note().classList.contains('lh-styles-note--error')).toBe(true)
        input.value = ' Grim '
        save.click()
        await settle()
        expect(calls).toEqual([['save', 'Grim']])
        expect(note().textContent).toBe('Saved "Grim" to the library.')
        input.value = 'Mine'
        save.click()
        await settle()
        expect(calls.slice(1)).toEqual([['confirm', 'A setup named "Mine" already exists. Replace it?'], ['save', 'Mine']])
        input.value = 'Anime'
        save.click()
        await settle()
        expect(note().textContent).toBe('"Anime" is a factory art style’s name.')
        button('Delete the setup Mine').click()
        await settle()
        expect(calls.slice(3)).toEqual([['confirm', 'Delete the portrait prompt setup "Mine"? This cannot be undone.'], ['remove', 'Mine']])
        expect(note().textContent).toBe('Deleted the setup Mine.')
        // A declined confirm removes nothing.
        const declined = harness({ savedPortraitPromptPresets: { Mine: {} } }, {}, false)
        declined.button('Delete the setup Mine').click()
        await declined.settle()
        expect(declined.calls.map((c) => c[0])).toEqual(['confirm'])
    })
})
