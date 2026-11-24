// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import { mountPortraitStyles, type PortraitStylesHost } from './portrait-styles.js'

function harness(settings: Record<string, unknown> = {}, over: Partial<PortraitStylesHost> = {}, confirmed = true) {
    const calls: unknown[][] = []
    const host: PortraitStylesHost = {
        load: async (id) => { calls.push(['load', id]) },
        save: async (name, overwrite) => { calls.push(['save', name, overwrite]) },
        remove: async (name) => { calls.push(['remove', name]) },
        confirm: async (title, message, label) => { calls.push(['confirm', title, message, label]); return confirmed },
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
        expect(names('factory')).toEqual(['Fantasy (default)', 'Anime', 'Photorealistic', 'Oil painting', 'Comic book', 'Watercolor', 'Dark fantasy'])
        expect(names('saved')).toEqual(['Mine'])
        expect(Array.from(mount.querySelectorAll('.lh-style--active .lh-style-name')).map((n) => n.textContent)).toEqual(['Anime'])
        button('Load comic book').click()
        expect(button('Load anime').disabled).toBe(true)
        await settle()
        expect(calls).toEqual([['load', 'comic']])
        expect(note().textContent).toBe('Loaded the Comic book style.')
        button('Load Mine').click()
        await settle()
        expect(calls[1]).toEqual(['load', 'user:Mine'])
        // The settings as they come back decide the mark; an empty id marks nothing.
        styles.setSettings({ activePortraitPromptPresetId: 'user:Mine', savedPortraitPromptPresets: { Mine: {}, Other: {} } })
        expect(Array.from(mount.querySelectorAll('.lh-style--active .lh-style-name')).map((n) => n.textContent)).toEqual(['Mine'])
        expect(names('saved')).toEqual(['Mine', 'Other'])
        styles.setSettings({ activePortraitPromptPresetId: '', savedPortraitPromptPresets: {} })
        expect(mount.querySelector('.lh-style--active')).toBeNull()
        expect(mount.querySelector('[data-lh-field="portrait-styles-saved-label"]')!.textContent).toBe('Saved setups (none yet)')
    })

    it('saves under a typed name, asks before replacing a kept one, deletes after a confirm, and shows a refusal', async () => {
        const { mount, calls, button, note, settle } = harness({ savedPortraitPromptPresets: { Mine: {} } }, { save: async (name) => { if (name === 'Anime') throw new Error('"Anime" is a factory art style’s name.'); calls.push(['save', name]) } })
        const input = mount.querySelector('[data-lh-field="style-name"]') as HTMLInputElement
        const save = Array.from(mount.querySelectorAll('button')).find((b) => b.textContent === 'Save setup') as HTMLButtonElement
        save.click()
        await settle()
        expect(note().textContent).toBe('Enter a setup name first.')
        expect(note().classList.contains('lh-styles-note--error')).toBe(true)
        input.value = ' Grim '
        save.click()
        await settle()
        expect(calls).toEqual([['save', 'Grim']])
        expect(note().textContent).toBe('Saved the setup "Grim".')
        input.value = 'Mine'
        save.click()
        await settle()
        expect(calls.slice(1)).toEqual([['confirm', 'Art styles', 'A setup named "Mine" already exists. Replace it?', 'Replace'], ['save', 'Mine']])
        input.value = 'Anime'
        save.click()
        await settle()
        expect(note().textContent).toBe('"Anime" is a factory art style’s name.')
        button('Delete setup Mine').click()
        await settle()
        expect(calls.slice(3)).toEqual([['confirm', 'Art styles', 'Delete the setup "Mine"? This cannot be undone.', 'Delete'], ['remove', 'Mine']])
        expect(note().textContent).toBe('Deleted the setup Mine.')
        // A declined confirm removes nothing.
        const declined = harness({ savedPortraitPromptPresets: { Mine: {} } }, {}, false)
        declined.button('Delete setup Mine').click()
        await declined.settle()
        expect(declined.calls.map((c) => c[0])).toEqual(['confirm'])
    })

    it('shows the deck’s words (96): each description behind its row’s [?], no lead paragraph, no tooltip, and Multihog named nowhere', () => {
        const { styles, mount } = harness({ savedPortraitPromptPresets: { Mine: {} } })
        expect(mount.querySelector('.lh-section-help')).toBeNull()
        expect(mount.querySelector('.lh-styles-label')!.textContent).toBe('Built-in styles')
        expect(mount.querySelector('[data-lh-field="portrait-styles-saved-label"]')!.textContent).toBe('Saved setups')
        const notes = Array.from(mount.querySelectorAll('[data-lh-field="portrait-styles-factory"] .lh-style > .lh-help-note')) as HTMLElement[]
        expect(notes.map((n) => n.textContent)).toEqual([
            'High-quality fantasy art with dramatic lighting. This is the default style.',
            'Clean anime illustration look with expressive features and vibrant color.',
            'Photographic realism with natural lighting and fine detail.',
            'Classical oil-painting look with rich brushwork.',
            'Bold comic-book illustration with strong inks and dynamic shading.',
            'Soft watercolor washes with delicate color.',
            'Grim gothic fantasy with a muted palette and heavy shadows.',
        ])
        expect(notes.every((n) => n.hidden)).toBe(true)
        const first = mount.querySelector('[data-lh-field="portrait-styles-factory"] .lh-style') as HTMLElement
        // The [?] directly after the name; a press shows the description and loads nothing.
        const tip = first.querySelector('.lh-style-name')!.nextElementSibling as HTMLButtonElement
        expect(tip.classList.contains('lh-help-tip')).toBe(true)
        tip.click()
        expect(notes[0]!.hidden).toBe(false)
        const saved = mount.querySelector('[data-lh-field="portrait-styles-saved"] .lh-style') as HTMLElement
        expect(saved.querySelector('.lh-help-note')!.textContent).toBe('Your saved prompts, word target and NPC choice.')
        expect(saved.querySelector('button[aria-label="Delete setup Mine"]')!.getAttribute('title')).toBe('Delete setup')
        const input = mount.querySelector('[data-lh-field="style-name"]') as HTMLInputElement
        expect(input.placeholder).toBe('Setup name')
        expect(input.getAttribute('aria-label')).toBe('Setup name')
        const save = Array.from(mount.querySelectorAll('button')).find((b) => b.textContent === 'Save setup') as HTMLButtonElement
        expect(save.title).toBe('')
        expect((save.nextElementSibling as HTMLElement).classList.contains('lh-help-tip')).toBe(true)
        expect(save.parentElement!.querySelector('.lh-help-note')!.textContent).toBe('Saves the three prompts, the word target and the "Include present NPCs in the picture" choice under this name. Saved setups are part of the cartridge.')
        // No help left as a tooltip on a name or a Load button, and a redraw keeps the notes in the DOM.
        expect(Array.from(mount.querySelectorAll('.lh-style-name, .lh-style button')).filter((n) => n.getAttribute('title') && n.getAttribute('title') !== 'Delete setup')).toEqual([])
        styles.setSettings({ activePortraitPromptPresetId: 'fantasy', savedPortraitPromptPresets: {} })
        expect(mount.querySelectorAll('[data-lh-field="portrait-styles-factory"] .lh-style > .lh-help-note')).toHaveLength(7)
        expect(mount.textContent).not.toMatch(/Multihog|factory/i)
    })
})
