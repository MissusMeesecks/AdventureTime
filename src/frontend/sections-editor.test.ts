// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_NPC_SECTIONS, DEFAULT_PC_SECTIONS } from '../tracker/creator.js'
import { mountSectionsEditor, readSectionPresets, readSections, type SectionsEditorHost, type SectionsKind } from './sections-editor.js'

function harness(kind: SectionsKind = 'npc', settings: Record<string, unknown> = {}, confirmed = true, over: Partial<SectionsEditorHost> = {}) {
    const calls: unknown[][] = []
    const host: SectionsEditorHost = {
        save: async (k, sections) => { calls.push(['save', k, sections]); return { rebuilt: ['npc', 'loc', 'fac'], kept: [] } },
        savePresets: async (k, presets) => { calls.push(['presets', k, presets]) },
        confirm: async (title, message, confirmLabel) => { calls.push(['confirm', title, message, confirmLabel]); return confirmed },
        ...over,
    }
    const mount = document.createElement('div')
    document.body.replaceChildren(mount)
    const el = (tag: string, attrs?: Record<string, string>) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n }
    const editor = mountSectionsEditor(mount, { createElement: el }, settings, kind, host)
    const button = (label: string) => mount.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement
    const rows = () => Array.from(mount.querySelectorAll('.lh-sec-row'))
    const names = () => rows().map((r) => (r.querySelector('.lh-sec-name') as HTMLInputElement).value)
    const note = () => (mount.querySelector('[data-lh-field="sections-note"]') as HTMLElement).textContent
    const dirty = () => (mount.querySelector('[data-lh-field="sections-dirty"]') as HTMLElement).textContent
    const select = () => mount.querySelector('[data-lh-field="sections-preset"]') as HTMLSelectElement
    const type = (input: HTMLInputElement, value: string) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })) }
    const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0)) }
    return { editor, mount, calls, button, rows, names, note, dirty, select, type, settle }
}

describe('the sections editor (77)', () => {
    beforeEach(() => { localStorage.clear() })

    it('draws the stock sections when the cartridge holds none, marks an edit, and Save writes the list with the agent’s rebuilt instructions named', async () => {
        const { calls, button, rows, names, note, dirty, type, settle } = harness()
        expect(names()).toEqual(DEFAULT_NPC_SECTIONS.map((s) => s.name))
        expect(rows()[8]!.querySelector('.lh-sec-hidden')!.textContent).toBe('Hidden until set')
        expect(button('Save sections').disabled).toBe(true)
        expect(dirty()).toBe('')
        const first = rows()[0]!
        type(first.querySelector('.lh-sec-name') as HTMLInputElement, 'Lineage')
        type(first.querySelector('.lh-sec-desc') as HTMLInputElement, 'Where they come from.')
        expect(dirty()).toBe('Unsaved changes')
        expect(button('Save sections').disabled).toBe(false)
        // The cursor stays: an edit redraws no row (lesson 30).
        expect(rows()[0]).toBe(first)
        button('Save sections').click()
        await settle()
        const saved = calls.find((c) => c[0] === 'save')!
        expect(saved[1]).toBe('npc')
        expect((saved[2] as Array<{ id: string; name: string; description: string }>)[0]).toMatchObject({ id: 'sec_species', name: 'Lineage', description: 'Where they come from.' })
        expect((saved[2] as unknown[]).length).toBe(9)
        expect(note()).toBe('9 sections saved. The agent’s npc, loc, fac instructions were rebuilt.')
        expect(dirty()).toBe('')
        expect(button('Save sections').disabled).toBe(true)
    })

    it('refuses a nameless section in the legacy’s words, reports a refused save, and names an instruction kept as edited', async () => {
        const { calls, button, rows, note, type, settle } = harness('npc', {}, true, { save: async () => ({ rebuilt: ['loc', 'fac'], kept: ['npc'] }) })
        type(rows()[1]!.querySelector('.lh-sec-name') as HTMLInputElement, '   ')
        button('Save sections').click()
        await settle()
        expect(note()).toBe('Every section needs a name.')
        expect(calls.filter((c) => c[0] === 'save')).toEqual([])
        type(rows()[1]!.querySelector('.lh-sec-name') as HTMLInputElement, 'Body')
        type(rows()[1]!.querySelector('.lh-sec-icon') as HTMLInputElement, '🫀')
        button('Save sections').click()
        await settle()
        expect(note()).toBe('9 sections saved. The agent’s loc, fac instructions were rebuilt. The npc instruction is edited and was kept.')
        const failing = harness('npc', {}, true, { save: async () => { throw new Error('no') } })
        failing.type(failing.rows()[0]!.querySelector('.lh-sec-name') as HTMLInputElement, 'X')
        failing.button('Save sections').click()
        await failing.settle()
        expect(failing.note()).toBe('The sections could not be saved: no')
        expect(failing.button('Save sections').disabled).toBe(false)
    })

    it('keeps a preset of the same name when the replace is refused', async () => {
        const kept = [{ id: 'z', name: 'Yorick', description: '', icon: '', color: '#333333' }]
        const refusing = harness('npc', { npcSectionPresets: { Kept: kept } }, false)
        const input = refusing.mount.querySelector('[data-lh-field="sections-preset-name"]') as HTMLInputElement
        input.value = 'Kept'
        input.dispatchEvent(new Event('input'))
        ;(Array.from(refusing.mount.querySelectorAll('button')).find((b) => b.textContent === 'Save as new preset') as HTMLButtonElement).click()
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(refusing.calls.at(-1)).toEqual(['confirm', 'Replace preset', 'A preset named “Kept” exists. Replace it?', 'Replace'])
        expect(refusing.calls.some((c) => c[0] === 'presets')).toBe(false)
    })

    it('moves a section with the arrows, adds a custom one with a fresh id, removes one after a confirm, and Revert puts the cartridge back', async () => {
        const { calls, button, names, rows, dirty, settle } = harness('pc', { pcCoreSections: [{ id: 'a', name: 'Alpha', description: '', icon: '', color: '#111111' }, { id: 'b', name: 'Beta', description: '', icon: '', color: '#222222' }] })
        expect(names()).toEqual(['Alpha', 'Beta'])
        expect(button('Move Alpha up').disabled).toBe(true)
        button('Move Alpha down').click()
        expect(names()).toEqual(['Beta', 'Alpha'])
        button('Move Alpha up').click()
        expect(names()).toEqual(['Alpha', 'Beta'])
        expect(dirty()).toBe('')
        button('Add custom section').click()
        expect(names()).toEqual(['Alpha', 'Beta', 'New section'])
        button('Remove Beta').click()
        await settle()
        expect(calls.at(-1)).toEqual(['confirm', 'Remove section', 'Remove this section? It is gone from the cartridge once you save.', 'Remove'])
        expect(names()).toEqual(['Alpha', 'New section'])
        button('Save sections').click()
        await settle()
        const saved = calls.find((c) => c[0] === 'save')!
        expect(saved[1]).toBe('pc')
        expect((saved[2] as Array<{ id: string }>)[1]!.id).toMatch(/^custom_\d+$/)
        expect((rows()[0]!.querySelector('.lh-sec-color') as HTMLInputElement).value).toBe('#111111')
        button('Add custom section').click()
        expect(dirty()).toBe('Unsaved changes')
        button('Revert changes').click()
        expect(names()).toEqual(['Alpha', 'New section'])
        expect(dirty()).toBe('')
        // A refused confirm removes nothing.
        const kept = harness('pc', {}, false)
        kept.button('Remove Species').click()
        await kept.settle()
        expect(kept.names()).toEqual(DEFAULT_PC_SECTIONS.map((s) => s.name))
    })

    it('saves, loads, overwrites and deletes presets, the select marking the one the list equals, a dirty list asking before a load, and Reset putting the stock in the list', async () => {
        const two = [{ id: 'a', name: 'Alpha', description: '', icon: '', color: '#111111' }]
        const { calls, button, names, rows, note, select, type, settle, mount } = harness('npc', { npcCoreSections: two, npcSectionPresets: { Kept: two, Old: { sections: [{ id: 'z', name: 'Yorick', description: '', icon: '', color: '#333333' }] } } })
        expect(Array.from(select().options).map((o) => o.value)).toEqual(['', 'Kept', 'Old'])
        expect(select().value).toBe('Kept')
        expect(button('Overwrite preset').disabled).toBe(false)
        // Save as: a name is required; the list as it stands is kept under it.
        button('Save as new preset').click()
        expect(note()).toBe('Type a name for the preset.')
        type(mount.querySelector('[data-lh-field="sections-preset-name"]') as HTMLInputElement, 'Mine')
        button('Save as new preset').click()
        await settle()
        expect(calls.at(-1)).toEqual(['presets', 'npc', { Kept: two, Old: [{ id: 'z', name: 'Yorick', description: '', icon: '', color: '#333333' }], Mine: two }])
        expect(note()).toBe('Preset saved: Mine.')
        // Loading a preset with no edits asks nothing; with edits it asks, and a no leaves the list.
        select().value = 'Old'
        select().dispatchEvent(new Event('change'))
        await settle()
        expect(names()).toEqual(['Yorick'])
        expect(calls.some((c) => c[0] === 'confirm')).toBe(false)
        // An edit keeps the loaded preset's name on the select, marked, so it can be overwritten (96, the try of 2e).
        type(rows()[0]!.querySelector('.lh-sec-name') as HTMLInputElement, 'Yorick edited')
        expect(select().value).toBe('Old')
        expect(select().selectedOptions[0]!.textContent).toBe('Old (edited)')
        expect(button('Overwrite preset').disabled).toBe(false)
        const refusing = harness('npc', { npcCoreSections: two, npcSectionPresets: { Old: [{ id: 'z', name: 'Yorick', description: '', icon: '', color: '#333333' }] } }, false)
        refusing.type(refusing.rows()[0]!.querySelector('.lh-sec-name') as HTMLInputElement, 'Alpha edited')
        refusing.select().value = 'Old'
        refusing.select().dispatchEvent(new Event('change'))
        await refusing.settle()
        expect(refusing.calls.at(-1)).toEqual(['confirm', 'Load preset', 'Load the preset “Old”? Unsaved changes in the list are lost.', 'Load'])
        expect(refusing.names()).toEqual(['Alpha edited'])
        // Save over the matching preset, then delete it after a confirm.
        select().value = 'Kept'
        select().dispatchEvent(new Event('change'))
        await settle()
        expect(calls.at(-1)).toEqual(['confirm', 'Load preset', 'Load the preset “Kept”? Unsaved changes in the list are lost.', 'Load'])
        type(rows()[0]!.querySelector('.lh-sec-icon') as HTMLInputElement, '🅰️')
        expect(select().value).toBe('Kept')
        button('Overwrite preset').click()
        await settle()
        expect((calls.at(-1)![2] as Record<string, unknown[]>).Kept).toEqual([{ ...two[0], icon: '🅰️' }])
        expect(select().selectedOptions[0]!.textContent).toBe('Kept')
        expect(note()).toBe('Preset saved: Kept.')
        button('Delete preset').click()
        await settle()
        expect(calls.at(-2)).toEqual(['confirm', 'Delete preset', 'Delete the preset “Kept”?', 'Delete'])
        expect(Object.keys(calls.at(-1)![2] as Record<string, unknown>)).toEqual(['Old', 'Mine'])
        expect(note()).toBe('Preset deleted: Kept.')
        // Reset puts the stock in the list, unsaved.
        button('Reset to stock sections').click()
        await settle()
        expect(calls.at(-1)).toEqual(['confirm', 'Reset to stock sections', 'Reset the list to the stock sections? Your edits in the list are replaced.', 'Reset'])
        expect(names()).toEqual(DEFAULT_NPC_SECTIONS.map((s) => s.name))
        expect(note()).toBe('The stock sections are in the list. Press Save sections to apply them.')
        expect(button('Save sections').disabled).toBe(false)
    })

    it('takes the preset’s name off the select on Reset to stock, puts it back on Revert changes, and remembers it over a reload (96, the try of 2e)', async () => {
        const one = [{ id: 'a', name: 'Alpha', description: '', icon: '', color: '#111111' }]
        const bag = { pcCoreSections: one, pcSectionPresets: { Mine: one, Plain: DEFAULT_PC_SECTIONS } }
        const first = harness('pc', bag)
        expect(first.select().value).toBe('Mine')
        first.type(first.rows()[0]!.querySelector('.lh-sec-name') as HTMLInputElement, 'Alpha edited')
        first.button('Revert changes').click()
        expect(first.select().selectedOptions[0]!.textContent).toBe('Mine')
        first.button('Reset to stock sections').click()
        await first.settle()
        // Stock is no preset, even with a saved preset that equals it.
        expect(first.select().value).toBe('')
        expect(first.button('Delete preset').disabled).toBe(true)
        // The card's own reset clears the name too; a cartridge load reads it by equality.
        first.editor.setSettings({ pcCoreSections: one, pcSectionPresets: { Mine: one } }, 'reset')
        expect(first.select().value).toBe('')
        first.editor.setSettings({ pcCoreSections: one, pcSectionPresets: { Mine: one } }, 'load')
        expect(first.select().value).toBe('Mine')
        const bare = harness('pc', { pcCoreSections: one, pcSectionPresets: { Mine: one } })
        bare.button('Reset to stock sections').click()
        await bare.settle()
        expect(bare.select().value).toBe('')
        expect(bare.button('Overwrite preset').disabled).toBe(true)
        expect(bare.button('Delete preset').disabled).toBe(true)
        bare.button('Revert changes').click()
        expect(bare.select().value).toBe('Mine')
        // A reload: the list no longer equals the preset, and the name still stands.
        const edited = [{ ...one[0]!, name: 'Alpha edited' }]
        const again = harness('pc', { pcCoreSections: edited, pcSectionPresets: { Mine: one } })
        expect(again.select().selectedOptions[0]!.textContent).toBe('Mine (edited)')
        // A name the cartridge no longer has is forgotten.
        expect(harness('pc', { pcCoreSections: edited, pcSectionPresets: {} }).select().value).toBe('')
    })

    it('says the decided text, keeps no help in the open or in a tooltip, and asks before a preset is replaced under its own title and verb (96)', async () => {
        const two = [{ id: 'a', name: 'Alpha', description: '', icon: '', color: '#111111' }]
        const { calls, button, note, select, type, settle, mount } = harness('npc', { npcSectionPresets: { Kept: two } })
        // The lead paragraph is gone: the help is the [?] on the row's heading, from the schema.
        expect(mount.querySelector('.lh-section-help')).toBeNull()
        expect(mount.textContent).not.toContain('identity sections')
        expect(Array.from(mount.querySelectorAll('.lh-sections-presets button, .lh-sections-foot button, .lh-sections-add')).map((b) => b.textContent)).toEqual(['Overwrite preset', 'Save as new preset', 'Reset to stock', 'Delete preset', 'Add custom section', 'Save sections', 'Revert changes'])
        // No help rides on a tooltip: the only titles left name an icon-only control.
        expect(Array.from(new Set(Array.from(mount.querySelectorAll('[title]')).map((n) => n.getAttribute('title')))).sort()).toEqual(['Colour', 'Icon (emoji)', 'Remove section'])
        expect(select().options[0]!.textContent).toBe('Choose a preset')
        expect(select().getAttribute('aria-label')).toBe('Saved preset')
        const name = mount.querySelector('[data-lh-field="sections-preset-name"]') as HTMLInputElement
        expect(name.placeholder).toBe('Preset name')
        const desc = mount.querySelector('.lh-sec-desc') as HTMLInputElement
        expect([desc.placeholder, desc.getAttribute('aria-label')]).toEqual(['What this section holds', 'Section instruction'])
        // A kept name asks, titled with the action, the button the verb.
        type(name, 'Kept')
        button('Save as new preset').click()
        await settle()
        expect(calls.find((c) => c[0] === 'confirm')).toEqual(['confirm', 'Replace preset', 'A preset named “Kept” exists. Replace it?', 'Replace'])
        expect(note()).toBe('Preset saved: Kept.')
        select().value = 'Kept'
        select().dispatchEvent(new Event('change'))
        await settle()
        expect(note()).toBe('Preset “Kept” is in the list. Press Save sections to apply it.')
        // A save that rebuilt nothing says the instructions already match.
        const quiet = harness('npc', {}, true, { save: async () => ({ rebuilt: [], kept: [] }) })
        quiet.type(quiet.rows()[0]!.querySelector('.lh-sec-name') as HTMLInputElement, 'Lineage')
        quiet.button('Save sections').click()
        await quiet.settle()
        expect(quiet.note()).toBe('9 sections saved. The agent’s instructions already match.')
    })

    it('keeps a draft through a commit from elsewhere and yields it to a load or a reset', () => {
        const { editor, names, rows, type, dirty } = harness('npc', { npcCoreSections: [{ id: 'a', name: 'Alpha', description: '', icon: '', color: '#111111' }] })
        type(rows()[0]!.querySelector('.lh-sec-name') as HTMLInputElement, 'Alpha edited')
        editor.setSettings({ npcCoreSections: [{ id: 'a', name: 'Alpha', description: '', icon: '', color: '#111111' }], npcSectionPresets: { P: [] } }, 'commit')
        expect(names()).toEqual(['Alpha edited'])
        expect(dirty()).toBe('Unsaved changes')
        editor.setSettings({ npcCoreSections: [{ id: 'b', name: 'Beta', description: '', icon: '', color: '#222222' }] }, 'load')
        expect(names()).toEqual(['Beta'])
        expect(dirty()).toBe('')
        editor.setSettings({}, 'reset')
        expect(names()).toEqual(DEFAULT_NPC_SECTIONS.map((s) => s.name))
    })

    it('reads the cartridge’s lists and presets as the legacy resolves them', () => {
        expect(readSections([], DEFAULT_PC_SECTIONS)).toEqual(DEFAULT_PC_SECTIONS)
        expect(readSections('x', DEFAULT_PC_SECTIONS)).toEqual(DEFAULT_PC_SECTIONS)
        expect(readSections([null, { name: 'A', hiddenUntilSet: true }], DEFAULT_PC_SECTIONS)).toEqual([{ id: '', name: 'A', description: '', icon: '', color: '#aaaaaa', hiddenUntilSet: true }])
        expect(readSectionPresets({ A: [{ name: 'x' }], B: { sections: [{ name: 'y' }] }, C: 'junk' }, DEFAULT_PC_SECTIONS)).toEqual({ A: [{ id: '', name: 'x', description: '', icon: '', color: '#aaaaaa' }], B: [{ id: '', name: 'y', description: '', icon: '', color: '#aaaaaa' }] })
        expect(readSectionPresets(null, DEFAULT_PC_SECTIONS)).toEqual({})
    })
})
