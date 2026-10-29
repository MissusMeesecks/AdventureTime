// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import { DEFAULT_NPC_SECTIONS, DEFAULT_PC_SECTIONS } from '../tracker/creator.js'
import { mountSectionsEditor, readSectionPresets, readSections, type SectionsEditorHost, type SectionsKind } from './sections-editor.js'

function harness(kind: SectionsKind = 'npc', settings: Record<string, unknown> = {}, confirmed = true, over: Partial<SectionsEditorHost> = {}) {
    const calls: unknown[][] = []
    const host: SectionsEditorHost = {
        save: async (k, sections) => { calls.push(['save', k, sections]); return { rebuilt: ['npc', 'loc', 'fac'], kept: [] } },
        savePresets: async (k, presets) => { calls.push(['presets', k, presets]) },
        confirm: async (message) => { calls.push(['confirm', message]); return confirmed },
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
    it('draws the stock sections when the cartridge holds none, marks an edit, and Save writes the list with the agent’s rebuilt instructions named', async () => {
        const { calls, button, rows, names, note, dirty, type, settle } = harness()
        expect(names()).toEqual(DEFAULT_NPC_SECTIONS.map((s) => s.name))
        expect(rows()[8]!.querySelector('.lh-sec-hidden')!.textContent).toBe('hidden until set')
        expect(button('Save the sections').disabled).toBe(true)
        expect(dirty()).toBe('')
        const first = rows()[0]!
        type(first.querySelector('.lh-sec-name') as HTMLInputElement, 'Lineage')
        type(first.querySelector('.lh-sec-desc') as HTMLInputElement, 'Where they come from.')
        expect(dirty()).toBe('edited, not saved')
        expect(button('Save the sections').disabled).toBe(false)
        // The cursor stays: an edit redraws no row (lesson 30).
        expect(rows()[0]).toBe(first)
        button('Save the sections').click()
        await settle()
        const saved = calls.find((c) => c[0] === 'save')!
        expect(saved[1]).toBe('npc')
        expect((saved[2] as Array<{ id: string; name: string; description: string }>)[0]).toMatchObject({ id: 'sec_species', name: 'Lineage', description: 'Where they come from.' })
        expect((saved[2] as unknown[]).length).toBe(9)
        expect(note()).toBe('9 sections saved. the agent’s npc, loc, fac instructions rebuilt around them.')
        expect(dirty()).toBe('')
        expect(button('Save the sections').disabled).toBe(true)
    })

    it('refuses a nameless section in the legacy’s words, reports a refused save, and names an instruction kept as edited', async () => {
        const { calls, button, rows, note, type, settle } = harness('npc', {}, true, { save: async () => ({ rebuilt: ['loc', 'fac'], kept: ['npc'] }) })
        type(rows()[1]!.querySelector('.lh-sec-name') as HTMLInputElement, '   ')
        button('Save the sections').click()
        await settle()
        expect(note()).toBe('All sections must have a name.')
        expect(calls.filter((c) => c[0] === 'save')).toEqual([])
        type(rows()[1]!.querySelector('.lh-sec-name') as HTMLInputElement, 'Body')
        type(rows()[1]!.querySelector('.lh-sec-icon') as HTMLInputElement, '🫀')
        button('Save the sections').click()
        await settle()
        expect(note()).toBe('9 sections saved. the agent’s loc, fac instructions rebuilt around them; the npc instruction is edited and kept as it is.')
        const failing = harness('npc', {}, true, { save: async () => { throw new Error('no') } })
        failing.type(failing.rows()[0]!.querySelector('.lh-sec-name') as HTMLInputElement, 'X')
        failing.button('Save the sections').click()
        await failing.settle()
        expect(failing.note()).toBe('The sections could not be saved: no')
        expect(failing.button('Save the sections').disabled).toBe(false)
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
        button('Add a custom section').click()
        expect(names()).toEqual(['Alpha', 'Beta', 'New Section'])
        button('Remove Beta').click()
        await settle()
        expect(calls.at(-1)).toEqual(['confirm', 'Remove this section?'])
        expect(names()).toEqual(['Alpha', 'New Section'])
        button('Save the sections').click()
        await settle()
        const saved = calls.find((c) => c[0] === 'save')!
        expect(saved[1]).toBe('pc')
        expect((saved[2] as Array<{ id: string }>)[1]!.id).toMatch(/^custom_\d+$/)
        expect((rows()[0]!.querySelector('.lh-sec-color') as HTMLInputElement).value).toBe('#111111')
        button('Add a custom section').click()
        expect(dirty()).toBe('edited, not saved')
        button('Revert the sections').click()
        expect(names()).toEqual(['Alpha', 'New Section'])
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
        expect(button('Save over the preset').disabled).toBe(false)
        // Save as: a name is required; the list as it stands is kept under it.
        button('Save as a preset').click()
        expect(note()).toBe('Type a name for the preset.')
        type(mount.querySelector('[data-lh-field="sections-preset-name"]') as HTMLInputElement, 'Mine')
        button('Save as a preset').click()
        await settle()
        expect(calls.at(-1)).toEqual(['presets', 'npc', { Kept: two, Old: [{ id: 'z', name: 'Yorick', description: '', icon: '', color: '#333333' }], Mine: two }])
        expect(note()).toBe('Saved the preset: Mine.')
        // Loading a preset with no edits asks nothing; with edits it asks, and a no leaves the list.
        select().value = 'Old'
        select().dispatchEvent(new Event('change'))
        await settle()
        expect(names()).toEqual(['Yorick'])
        expect(calls.some((c) => c[0] === 'confirm')).toBe(false)
        type(rows()[0]!.querySelector('.lh-sec-name') as HTMLInputElement, 'Yorick edited')
        expect(select().value).toBe('')
        const refusing = harness('npc', { npcCoreSections: two, npcSectionPresets: { Old: [{ id: 'z', name: 'Yorick', description: '', icon: '', color: '#333333' }] } }, false)
        refusing.type(refusing.rows()[0]!.querySelector('.lh-sec-name') as HTMLInputElement, 'Alpha edited')
        refusing.select().value = 'Old'
        refusing.select().dispatchEvent(new Event('change'))
        await refusing.settle()
        expect(refusing.calls.at(-1)).toEqual(['confirm', 'Load the preset “Old”? Unsaved changes to the current sections will be lost.'])
        expect(refusing.names()).toEqual(['Alpha edited'])
        // Save over the matching preset, then delete it after a confirm.
        select().value = 'Kept'
        select().dispatchEvent(new Event('change'))
        await settle()
        expect(calls.at(-1)).toEqual(['confirm', 'Load the preset “Kept”? Unsaved changes to the current sections will be lost.'])
        type(rows()[0]!.querySelector('.lh-sec-icon') as HTMLInputElement, '🅰️')
        expect(button('Save over the preset').disabled).toBe(true)
        select().value = 'Kept'
        select().dispatchEvent(new Event('change'))
        await settle()
        button('Save over the preset').click()
        await settle()
        expect((calls.at(-1)![2] as Record<string, unknown[]>).Kept).toEqual(two)
        expect(note()).toBe('Preset saved: Kept.')
        button('Delete the preset').click()
        await settle()
        expect(calls.at(-2)).toEqual(['confirm', 'Delete the preset “Kept”?'])
        expect(Object.keys(calls.at(-1)![2] as Record<string, unknown>)).toEqual(['Old', 'Mine'])
        expect(note()).toBe('Deleted the preset: Kept.')
        // Reset puts the stock in the list, unsaved.
        button('Reset the sections to stock').click()
        await settle()
        expect(names()).toEqual(DEFAULT_NPC_SECTIONS.map((s) => s.name))
        expect(note()).toBe('The stock sections are in the list; Save the sections applies them.')
        expect(button('Save the sections').disabled).toBe(false)
    })

    it('keeps a draft through a commit from elsewhere and yields it to a load or a reset', () => {
        const { editor, names, rows, type, dirty } = harness('npc', { npcCoreSections: [{ id: 'a', name: 'Alpha', description: '', icon: '', color: '#111111' }] })
        type(rows()[0]!.querySelector('.lh-sec-name') as HTMLInputElement, 'Alpha edited')
        editor.setSettings({ npcCoreSections: [{ id: 'a', name: 'Alpha', description: '', icon: '', color: '#111111' }], npcSectionPresets: { P: [] } }, 'commit')
        expect(names()).toEqual(['Alpha edited'])
        expect(dirty()).toBe('edited, not saved')
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
