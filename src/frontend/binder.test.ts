// @vitest-environment happy-dom

import { describe, it, expect, vi } from 'vitest'

import { bindSettings } from './binder.js'
import type { SectionDef, SettingsBag } from '../settings/schema.js'

const createElement = (<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs?: Record<string, string>,
): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag)
    for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, value)
    return node
}) as <K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, string>) => HTMLElementTagNameMap[K]

const schema: SectionDef[] = [{
    id: 'stateTracker',
    icon: '🧪',
    title: 'State Tracker',
    category: 'tracker',
    fields: [
        { key: 'rngEnabled', type: 'boolean', label: 'RNG enabled' },
        {
            key: 'diceD100Mode',
            type: 'boolean',
            label: 'd100 mode',
            visibleWhen: (s) => s.rngEnabled !== false,
        },
        {
            key: 'rngMode',
            type: 'derived',
            label: 'RNG mode',
            options: [{ value: 'hybrid', label: 'Hybrid' }, { value: 'none', label: 'None' }],
            keys: ['rngEnabled', 'diceFunctionTool'],
            read: (s) => (s.rngEnabled ? 'hybrid' : 'none'),
            write: (v) => (v === 'hybrid'
                ? { rngEnabled: true, diceFunctionTool: true }
                : { rngEnabled: false, diceFunctionTool: false }),
        },
        { key: 'portraitPromptWordTarget', type: 'number', label: 'Word target', min: 10, max: 2000 },
        { key: 'systemPromptTemplate', type: 'textarea', label: 'Extractor prompt' },
        { key: 'modules', type: 'managed', label: 'Modules', help: 'No editor yet.' },
    ],
}]

function mount(settings: SettingsBag = { rngEnabled: true, diceD100Mode: false, portraitPromptWordTarget: 200, systemPromptTemplate: 'hi' }) {
    const root = document.createElement('div')
    document.body.replaceChildren(root)
    const commit = vi.fn(async () => {})
    const bound = bindSettings(schema, settings, root, { createElement, commit })
    return { root, commit, bound }
}

/** Fire the event a real user interaction would. */
function change(node: Element, type = 'change'): void {
    node.dispatchEvent(new Event(type, { bubbles: true }))
}

describe('rendering', () => {
    it('renders one row per field', () => {
        const { root } = mount()
        expect(root.querySelectorAll('.lh-row')).toHaveLength(6)
    })

    it('shows current values in the controls', () => {
        const { root } = mount()
        expect(root.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(true)
        expect(root.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('hi')
        expect(root.querySelector<HTMLInputElement>('input[type=number]')!.value).toBe('200')
    })

    it('renders a managed key as a labelled note, not a control', () => {
        const { root } = mount()
        const row = root.querySelector('.lh-row-managed')!
        expect(row.querySelector('input, select, textarea')).toBeNull()
        expect(row.textContent).toMatch(/Modules/)
    })

    it('does not interpret prompt text as markup', () => {
        // Prompt templates are full of angle brackets. Building nodes rather
        // than HTML strings is what makes this a non-issue.
        const { root } = mount({ rngEnabled: true, systemPromptTemplate: '<script>alert(1)</script>' })
        expect(root.querySelector('script')).toBeNull()
        expect(root.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('<script>alert(1)</script>')
    })

    it('offers a reset control only when the panel supplies one', () => {
        const { root } = mount()
        expect(root.querySelector('.lh-reset')).toBeNull()

        const withReset = document.createElement('div')
        bindSettings(schema, {}, withReset, { createElement, commit: async () => {}, resetSection: () => {} })
        expect(withReset.querySelector('.lh-reset')).not.toBeNull()
    })
})

describe('binding', () => {
    it('commits a checkbox change immediately', () => {
        const { root, commit } = mount()
        const checkbox = root.querySelector<HTMLInputElement>('input[type=checkbox]')!
        checkbox.checked = false
        change(checkbox)

        expect(commit).toHaveBeenCalledWith({ rngEnabled: false })
    })

    it('coerces and clamps a number before committing', () => {
        const { root, commit } = mount()
        const input = root.querySelector<HTMLInputElement>('input[type=number]')!
        input.value = '99999'
        change(input)

        expect(commit).toHaveBeenCalledWith({ portraitPromptWordTarget: 2000 })
    })

    it('writes every key a derived control owns', () => {
        const { root, commit } = mount()
        const select = root.querySelector<HTMLSelectElement>('select')!
        select.value = 'none'
        change(select)

        expect(commit).toHaveBeenCalledWith({ rngEnabled: false, diceFunctionTool: false })
    })

    it('debounces typing into a textarea', async () => {
        vi.useFakeTimers()
        try {
            const { root, commit } = mount()
            const textarea = root.querySelector<HTMLTextAreaElement>('textarea')!

            for (const value of ['h', 'he', 'hel']) {
                textarea.value = value
                change(textarea, 'input')
            }
            expect(commit).not.toHaveBeenCalled()

            await vi.advanceTimersByTimeAsync(500)
            expect(commit).toHaveBeenCalledTimes(1)
            expect(commit).toHaveBeenCalledWith({ systemPromptTemplate: 'hel' })
        } finally {
            vi.useRealTimers()
        }
    })

    it('reports a failed save instead of swallowing it', async () => {
        const root = document.createElement('div')
        const onError = vi.fn()
        bindSettings(schema, { rngEnabled: true }, root, {
            createElement,
            commit: async () => { throw new Error('storage full') },
            onError,
        })

        const checkbox = root.querySelector<HTMLInputElement>('input[type=checkbox]')!
        checkbox.checked = false
        change(checkbox)

        await Promise.resolve()
        await Promise.resolve()
        expect(onError).toHaveBeenCalledWith(expect.stringMatching(/storage full/))
    })
})

describe('reactive visibility', () => {
    it('hides dependent rows when their predicate goes false', () => {
        const { root } = mount()
        const dependent = root.querySelectorAll<HTMLElement>('.lh-row')[1]!
        expect(dependent.hidden).toBe(false)

        const checkbox = root.querySelector<HTMLInputElement>('input[type=checkbox]')!
        checkbox.checked = false
        change(checkbox)

        expect(dependent.hidden).toBe(true)
    })

    it('brings them back when it goes true again', () => {
        const { root, bound } = mount({ rngEnabled: false })
        const dependent = root.querySelectorAll<HTMLElement>('.lh-row')[1]!
        expect(dependent.hidden).toBe(true)

        bound.setSettings({ rngEnabled: true })
        expect(dependent.hidden).toBe(false)
    })
})

describe('adopting backend state', () => {
    it('updates controls from authoritative settings', () => {
        const { root, bound } = mount()
        bound.setSettings({ rngEnabled: false, portraitPromptWordTarget: 500, systemPromptTemplate: 'new' })

        expect(root.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false)
        expect(root.querySelector<HTMLInputElement>('input[type=number]')!.value).toBe('500')
        expect(root.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('new')
    })

    it('leaves the field being typed in alone', () => {
        // Writing to a focused textarea would jump the caret mid-sentence.
        const { root, bound } = mount()
        const textarea = root.querySelector<HTMLTextAreaElement>('textarea')!
        textarea.focus()
        textarea.value = 'still typing'

        bound.setSettings({ systemPromptTemplate: 'from the backend' })
        expect(textarea.value).toBe('still typing')
    })

    it('updates a derived control from the keys behind it', () => {
        const { root, bound } = mount()
        bound.setSettings({ rngEnabled: false })
        expect(root.querySelector<HTMLSelectElement>('select')!.value).toBe('none')
    })
})

describe('teardown', () => {
    it('empties the container', () => {
        const { root, bound } = mount()
        bound.destroy()
        expect(root.children).toHaveLength(0)
    })
})

describe('the section host (63)', () => {
    it('puts each section where the host says, and into the root when there is none', () => {
        const root = createElement('div')
        const host = createElement('div')
        const asked: string[] = []
        bindSettings(schema, {}, root, { createElement: createElement, commit: async () => undefined, sectionHost: (section) => { asked.push(section.id); return host } })
        expect(asked).toEqual(['stateTracker'])
        expect(root.querySelector('.lh-section')).toBeNull()
        expect(host.querySelector('.lh-section-title')!.textContent).toBe('State Tracker')
        const plain = createElement('div')
        bindSettings(schema, {}, plain, { createElement: createElement, commit: async () => undefined })
        expect(plain.querySelector('.lh-section')).not.toBeNull()
    })

    it('draws a section as a card (63d): its icon, the title, the reset, a chevron', () => {
        const root = createElement('div')
        const resets: string[] = []
        bindSettings(schema, {}, root, { createElement: createElement, commit: async () => undefined, resetSection: (id) => { resets.push(id) } })
        const section = root.querySelector('.lh-section') as HTMLDetailsElement
        expect(section.classList.contains('lh-card')).toBe(true)
        const summary = section.querySelector('summary')!
        expect(Array.from(summary.children).map((c) => c.className)).toEqual(['lh-card-icon', 'lh-section-title lh-card-title', 'lh-reset', 'lh-chevron'])
        expect(summary.querySelector('.lh-card-icon')!.textContent).toBe('🧪')
        expect(section.open).toBe(false)
    })

    it('draws a section whole by its named editor (70), and row by row when the panel has none', () => {
        const root = createElement('div')
        const seen: Array<[HTMLElement, SettingsBag]> = []
        const whole: SectionDef[] = [{ ...schema[0]!, id: 'narrator', group: 'stateTracker', editor: 'narrator' }]
        bindSettings(whole, { rngEnabled: true }, root, { createElement: createElement, commit: async () => undefined, sectionEditors: { narrator: (mount, settings) => { seen.push([mount, settings]); mount.textContent = 'the block' } } })
        expect(root.querySelectorAll('.lh-row')).toHaveLength(0)
        expect(root.querySelector('.lh-section-editor')!.textContent).toBe('the block')
        expect(seen[0]![1]).toEqual({ rngEnabled: true })
        const rows = createElement('div')
        bindSettings(whole, {}, rows, { createElement: createElement, commit: async () => undefined })
        expect(rows.querySelectorAll('.lh-row').length).toBe(schema[0]!.fields.length)
    })

    it('gives a split-off section no reset of its own (70): its group’s card resets it', () => {
        const root = createElement('div')
        const split: SectionDef[] = [schema[0]!, { ...schema[0]!, id: 'rulebook', group: 'stateTracker', title: 'The rulebook' }]
        bindSettings(split, {}, root, { createElement: createElement, commit: async () => undefined, resetSection: () => undefined })
        const sections = Array.from(root.querySelectorAll('.lh-section'))
        expect(sections.map((s) => !!s.querySelector('.lh-reset'))).toEqual([true, false])
    })

    it('puts a section’s footer after its rows, only for the section it is given for (63b)', () => {
        const root = createElement('div')
        const foot = createElement('div', { class: 'foot' })
        bindSettings(schema, {}, root, { createElement: createElement, commit: async () => undefined, sectionFooter: (section) => (section.id === 'stateTracker' ? foot : null) })
        const section = root.querySelector('.lh-section')!
        expect(section.lastElementChild).toBe(foot)
        expect(foot.previousElementSibling!.classList.contains('lh-row')).toBe(true)
        const none = createElement('div')
        bindSettings(schema, {}, none, { createElement: createElement, commit: async () => undefined, sectionFooter: () => null })
        expect(none.querySelector('.foot')).toBeNull()
    })
})
