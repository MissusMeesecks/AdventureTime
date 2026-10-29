// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FACTORY_CARTRIDGE_DEFAULTS } from '../state/factory-defaults.js'
import {
    isMaintained,
    mergeCustomFields,
    mountCustomFieldsEditor,
    readCustomFieldsFile,
    STOCK_MODULE_TAGS,
    validateTag,
    type CustomField,
    type CustomFieldsHost,
} from './custom-fields.js'

const host: CustomFieldsHost = {
    createElement: ((tag: string, attrs?: Record<string, string>) => {
        const node = document.createElement(tag)
        for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, value)
        return node
    }) as CustomFieldsHost['createElement'],
}

const FIELDS: CustomField[] = [
    { tag: 'WAYSTONE', label: 'Waystone', icon: '💠', prompt: 'Track the waystone.', enabled: false },
    { tag: 'TRAIL', label: 'Trail', icon: '🛣️', prompt: 'Track the journey.', enabled: true },
]

let root: HTMLElement

beforeEach(() => {
    document.body.replaceChildren()
    root = document.createElement('div')
    document.body.append(root)
})

function mount(fields = FIELDS) {
    const onChange = vi.fn()
    const editor = mountCustomFieldsEditor(root, host, fields, onChange)
    return { editor, onChange }
}

const rows = () => Array.from(root.querySelectorAll('.lh-field'))
const toggles = () => Array.from(root.querySelectorAll<HTMLInputElement>('.lh-field-head input[type=checkbox]'))
const inputs = (index: number) =>
    Array.from(rows()[index].querySelectorAll<HTMLInputElement>('.lh-field-body input[type=text]'))
const button = (text: string) =>
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement

describe('validateTag', () => {
    it.each(['WAYSTONE', 'MORALE_INDEX', 'TRAIL2', 'A'])('accepts %s', (tag) => {
        expect(validateTag(tag, [])).toBeNull()
    })

    it.each([
        ['', 'empty'],
        ['2FAST', 'starting with a digit'],
        ['lower', 'lower case is upper-cased first, so this one is fine'],
    ].slice(0, 2))('rejects %j', (tag) => {
        expect(validateTag(tag as string, [])).toBeTruthy()
    })

    it('upper-cases before checking, so typing in lower case works', () => {
        expect(validateTag('waystone', [])).toBeNull()
    })

    it('rejects a tag with a space', () => {
        // It parses, but the duplicate-block scan skips space-containing tags,
        // so a new field has no business walking into that quirk.
        expect(validateTag('BENCHED PARTY', [])).toBeTruthy()
    })

    it('rejects a duplicate', () => {
        expect(validateTag('WAYSTONE', ['WAYSTONE'])).toMatch(/already a field/)
    })
})

describe('showing the fields', () => {
    it('lists every field, on or off', () => {
        mount()
        expect(rows()).toHaveLength(2)
        expect(root.textContent).toContain('Waystone')
        expect(root.textContent).toContain('[TRAIL]')
    })

    it('reflects which are switched on', () => {
        mount()
        expect(toggles().map((t) => t.checked)).toEqual([false, true])
    })

    it('says how many are on, and what being off means', () => {
        // The confusion this editor exists to remove: a field that is off still
        // renders from an existing memo and simply never updates.
        mount()
        const summary = root.querySelector('.lh-fields-summary')?.textContent ?? ''
        expect(summary).toContain('1 of 2 switched on')
        expect(summary).toMatch(/never told to maintain it/)
    })

    it('drops the caveat when everything is on', () => {
        mount(FIELDS.map((f) => ({ ...f, enabled: true })))
        expect(root.querySelector('.lh-fields-summary')?.textContent).not.toMatch(/never told/)
    })

    it('says so when there are none at all', () => {
        mount([])
        expect(root.querySelector('.lh-fields-summary')?.textContent).toMatch(/No custom fields yet/)
    })

    it('falls back to the tag and a generic icon', () => {
        mount([{ tag: 'EMBERS' }])
        expect(root.querySelector('.lh-field-name')?.textContent).toBe('📄 EMBERS')
    })
})

describe('editing a field', () => {
    it('switches one on and reports the whole list back', () => {
        const { onChange } = mount()
        toggles()[0].checked = true
        toggles()[0].dispatchEvent(new Event('change'))

        expect(onChange).toHaveBeenCalledTimes(1)
        expect(onChange.mock.calls[0]![0]).toEqual([
            { ...FIELDS[0], enabled: true },
            FIELDS[1],
        ])
    })

    it('does not let a toggle click reach the summary that would fold the row', () => {
        // The toggle lives inside a <summary>; a click that propagates opens
        // and closes the details instead of just flipping the checkbox.
        mount()
        const reachedSummary = vi.fn()
        rows()[0].querySelector('.lh-field-head')!.addEventListener('click', reachedSummary)

        toggles()[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

        expect(reachedSummary).not.toHaveBeenCalled()
    })

    it('renames a field', () => {
        const { onChange } = mount()
        const [, name] = inputs(0)
        name.value = 'Waystone readings'
        name.dispatchEvent(new Event('change'))

        expect(onChange.mock.calls[0]![0][0]).toMatchObject({ label: 'Waystone readings' })
    })

    it('upper-cases a tag on the way in', () => {
        const { onChange } = mount()
        const [tag] = inputs(0)
        tag.value = 'runestone'
        tag.dispatchEvent(new Event('change'))

        expect(onChange.mock.calls[0]![0][0]).toMatchObject({ tag: 'RUNESTONE' })
    })

    it('refuses an invalid tag, says why, and does not save', () => {
        const { onChange } = mount()
        const [tag] = inputs(0)
        tag.value = 'not a tag!'
        tag.dispatchEvent(new Event('change'))

        expect(onChange).not.toHaveBeenCalled()
        expect(rows()[0].querySelector('.lh-field-error')?.textContent).toMatch(/capitals, digits/)
        expect(tag.value).toBe('WAYSTONE')
    })

    it('refuses a tag that another field already has', () => {
        const { onChange } = mount()
        const [tag] = inputs(0)
        tag.value = 'TRAIL'
        tag.dispatchEvent(new Event('change'))

        expect(onChange).not.toHaveBeenCalled()
        expect(rows()[0].querySelector('.lh-field-error')?.textContent).toMatch(/already a field/)
    })

    it('lets a field keep its own tag', () => {
        const { onChange } = mount()
        const [tag] = inputs(0)
        tag.value = 'WAYSTONE'
        tag.dispatchEvent(new Event('change'))
        expect(onChange).toHaveBeenCalled()
    })

    it('edits the instruction, which is the module itself', () => {
        const { onChange } = mount()
        const prompt = rows()[0].querySelector('textarea') as HTMLTextAreaElement
        prompt.value = 'Track it differently.'
        prompt.dispatchEvent(new Event('change'))

        expect(onChange.mock.calls[0]![0][0]).toMatchObject({ prompt: 'Track it differently.' })
    })

    it('keeps fields a cartridge carries that this editor does not know about', () => {
        // scope, origin and _chatSetupMember ride along in real cartridges.
        const { onChange } = mount([{ tag: 'EMBERS', enabled: false, scope: 'chat', origin: 'wizard' }])
        toggles()[0].checked = true
        toggles()[0].dispatchEvent(new Event('change'))

        expect(onChange.mock.calls[0]![0][0]).toMatchObject({ scope: 'chat', origin: 'wizard' })
    })
})

describe('adding and deleting', () => {
    it('adds a field, switched on', () => {
        // A field you just made and cannot see updating is exactly the
        // confusion this editor exists to remove.
        const { onChange } = mount()
        button('Add a field').click()

        const added = onChange.mock.calls[0]![0]
        expect(added).toHaveLength(3)
        expect(added[2]).toMatchObject({ enabled: true })
        expect(added[2].tag).toMatch(/^NEW_FIELD_/)
    })

    it('does not collide with an existing placeholder tag', () => {
        const { onChange } = mount([{ tag: 'NEW_FIELD_1', enabled: true }])
        button('Add a field').click()
        expect(onChange.mock.calls[0]![0][1].tag).toBe('NEW_FIELD_2')
    })

    it('deletes a field', () => {
        const { onChange } = mount()
        ;(rows()[0].querySelector('.lh-field-delete') as HTMLButtonElement).click()

        expect(onChange.mock.calls[0]![0]).toEqual([FIELDS[1]])
    })

    it('redraws after a change, so the next edit targets the right row', () => {
        mount()
        ;(rows()[0].querySelector('.lh-field-delete') as HTMLButtonElement).click()
        expect(rows()).toHaveLength(1)
        expect(root.textContent).toContain('[TRAIL]')
    })
})

describe('adopting settings from elsewhere', () => {
    it('redraws when a cartridge import replaces the fields', () => {
        const { editor } = mount()
        editor.setFields([{ tag: 'NEWONE', label: 'New one', enabled: true }])

        expect(rows()).toHaveLength(1)
        expect(root.textContent).toContain('[NEWONE]')
    })

    it('does not report a change it was handed', () => {
        const { editor, onChange } = mount()
        editor.setFields([{ tag: 'NEWONE', enabled: true }])
        expect(onChange).not.toHaveBeenCalled()
    })

    it('does not hand back the caller own array to mutate', () => {
        const fields: CustomField[] = [{ tag: 'A', enabled: false }]
        const { onChange } = mount(fields)
        toggles()[0].checked = true
        toggles()[0].dispatchEvent(new Event('change'))

        expect(fields[0].enabled).toBe(false)
        expect(onChange.mock.calls[0]![0][0].enabled).toBe(true)
    })

    it('does not alias the fields handed to setFields either', () => {
        // Editing would otherwise mutate the panel's copy of settings in place,
        // so a later save would send state nobody chose.
        const { editor, onChange } = mount()
        const handed: CustomField[] = [{ tag: 'A', enabled: false }]
        editor.setFields(handed)

        toggles()[0].checked = true
        toggles()[0].dispatchEvent(new Event('change'))

        expect(handed[0].enabled).toBe(false)
        expect(onChange.mock.calls[0]![0][0].enabled).toBe(true)
    })
})

describe('tags the stock modules already own', () => {
    // A custom field tagged INVENTORY puts two contradictory instructions for
    // one block in the same prompt, and the user's own stock module is the one
    // that loses.
    it.each(STOCK_MODULE_TAGS)('refuses %s', (tag) => {
        expect(validateTag(tag, [])).toMatch(/built-in module/)
    })

    it('refuses one typed in lower case too', () => {
        expect(validateTag('inventory', [])).toMatch(/built-in module/)
    })

    // The list is written out by hand so the editor need not be handed the
    // whole cartridge. This is the lock that stops it drifting from the modules
    // that actually exist — same mechanism as EXPECTED_PAYLOAD_KEYS.
    it('matches the modules the generated factory actually has', () => {
        const modules = Object.keys(
            (FACTORY_CARTRIDGE_DEFAULTS as { modules: Record<string, unknown> }).modules,
        )
        const expected = modules
            .map((key) => key.toUpperCase())
            // A tag with a space cannot be typed past TAG_PATTERN, so reserving
            // it would be reserving something unreachable.
            .filter((tag) => !tag.includes(' '))
            .sort()

        expect([...STOCK_MODULE_TAGS].sort()).toEqual(expected)
    })

    it('still allows a tag that merely resembles one', () => {
        expect(validateTag('INVENTORY_2', [])).toBeNull()
        expect(validateTag('WAYSTONE', [])).toBeNull()
    })
})

describe('a field that is on but has no instruction', () => {
    // The instruction *is* the module. prompt.ts drops a field without one, so
    // the block is never mentioned to the tracker however the switch is set —
    // and pressing "Add a field" produces exactly this state.
    const silent: CustomField[] = [{ tag: 'QUIVER', label: 'Quiver', prompt: '', enabled: true }]

    it('is not counted as maintained', () => {
        expect(isMaintained(silent[0])).toBe(false)
        expect(isMaintained({ tag: 'A', prompt: '   ', enabled: true })).toBe(false)
        expect(isMaintained({ tag: 'A', prompt: 'Track it.', enabled: true })).toBe(true)
    })

    // A field that is off is a different problem with the same symptom, and it
    // already had its own note. This one must not borrow it.
    it('is not counted as maintained when it is switched off either', () => {
        expect(isMaintained({ tag: 'A', prompt: 'Track it.', enabled: false })).toBe(false)
    })

    it('says so in the summary, beside the reassuring count', () => {
        mount(silent)

        expect(root.textContent).toContain('1 of 1 switched on')
        expect(root.textContent).toContain('has no instruction')
        expect(root.querySelector('.lh-field-warning')).not.toBeNull()
    })

    // Lesson 7: a message about one thing must go on that thing.
    it('marks the row it is about', () => {
        mount(silent)

        expect(root.querySelector('.lh-field-silent')?.textContent).toBe('no instruction')
        expect(rows()[0]!.classList.contains('lh-field--silent')).toBe(true)
    })

    it('stops saying so once an instruction is written', () => {
        mount([{ tag: 'QUIVER', prompt: 'Track the arrows.', enabled: true }])

        expect(root.querySelector('.lh-field-silent')).toBeNull()
        expect(root.querySelector('.lh-field-warning')).toBeNull()
    })

    // The Add button's own comment says a field you just created and cannot see
    // updating is the confusion this editor exists to remove — and then it
    // created exactly that. It still creates it (switched on is right), but it
    // no longer creates it silently.
    it('is what "Add a field" produces, and it is marked immediately', () => {
        const { onChange } = mount([])

        button('Add a field').click()

        const created = onChange.mock.calls[0]![0] as CustomField[]
        expect(created[0]!.enabled).toBe(true)
        expect(isMaintained(created[0]!)).toBe(false)
    })

    it('shows the block format rather than only describing it', () => {
        mount(silent)

        const example = root.querySelector('.lh-field-example')?.textContent ?? ''
        expect(example).toContain('[QUIVER]')
        expect(example).toContain('[/QUIVER]')
    })
})

describe('export, import and clear all (72b)', () => {
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
    it('reads a modules file in either shape and merges it over the current fields by tag', () => {
        expect(readCustomFieldsFile(JSON.stringify({ adventuretimeCustomFields: [{ tag: 'trail', label: 'Trail', icon: '🛣️', prompt: 'p', enabled: false }] }))).toEqual([{ tag: 'TRAIL', label: 'Trail', icon: '🛣️', prompt: 'p', enabled: false }])
        expect(readCustomFieldsFile(JSON.stringify({ customFields: [{ tag: 'X' }] }))).toEqual([{ tag: 'X', label: 'X', icon: '📋', prompt: '', enabled: true }])
        expect(readCustomFieldsFile('[{"tag":"Y","prompt":"q"}]')).toHaveLength(1)
        // A file exported before the rename (0.156.0) still reads.
        expect(readCustomFieldsFile(JSON.stringify({ lumihogCustomFields: [{ tag: 'old', prompt: 'o' }] }))).toEqual([{ tag: 'OLD', label: 'OLD', icon: '📋', prompt: 'o', enabled: true }])
        expect(() => readCustomFieldsFile('not json')).toThrow('The file is not JSON.')
        expect(() => readCustomFieldsFile('{"a":1}')).toThrow('holds no custom fields')
        expect(() => readCustomFieldsFile('[{"label":"no tag"}]')).toThrow('holds no custom fields')
        expect(mergeCustomFields(FIELDS, [{ tag: 'TRAIL', label: 'Trail 2', icon: '🛣️', prompt: 'new', enabled: true }, { tag: 'SEA', label: 'Sea', icon: '🌊', prompt: 's', enabled: true }]).map((f) => [f.tag, f.label])).toEqual([['WAYSTONE', 'Waystone'], ['TRAIL', 'Trail 2'], ['SEA', 'Sea']])
    })

    it('exports the fields as a file, imports one and commits the merge, and clears all after the confirm', async () => {
        const downloads: Array<[string, string]> = []
        const changes: CustomField[][] = []
        let picked: string | null = JSON.stringify({ adventuretimeCustomFields: [{ tag: 'SEA', label: 'Sea', icon: '🌊', prompt: 's', enabled: true }] })
        let confirmed = true
        const withTools: CustomFieldsHost = { ...host, download: (name, text) => { downloads.push([name, text]) }, pickJson: async () => picked, confirm: async () => confirmed }
        mountCustomFieldsEditor(root, withTools, FIELDS, (fields) => { changes.push(fields) })
        const button = (f: string) => root.querySelector(`[data-lh-field="${f}"]`) as HTMLButtonElement
        const note = () => root.querySelector('[data-lh-field="fields-tools-note"]')!.textContent
        button('fields-export').click()
        expect(downloads).toHaveLength(1)
        expect(downloads[0]![0]).toMatch(/^adventuretime-modules-\d{4}-\d{2}-\d{2}\.json$/)
        expect(JSON.parse(downloads[0]![1]).adventuretimeCustomFields).toEqual(FIELDS)
        expect(note()).toBe('Exported 2 fields.')
        button('fields-import').click()
        await settle()
        expect(changes).toHaveLength(1)
        expect(changes[0]!.map((f) => f.tag)).toEqual(['WAYSTONE', 'TRAIL', 'SEA'])
        expect(note()).toBe('Imported 1 field: SEA.')
        picked = null
        button('fields-import').click()
        await settle()
        expect(note()).toBe('No file was picked.')
        picked = 'nope'
        button('fields-import').click()
        await settle()
        expect(note()).toBe('Could not import: The file is not JSON.')
        expect(changes).toHaveLength(1)
        confirmed = false
        button('fields-clear').click()
        await settle()
        expect(changes).toHaveLength(1)
        confirmed = true
        button('fields-clear').click()
        await settle()
        expect(changes).toHaveLength(2)
        expect(changes[1]).toEqual([])
        expect(note()).toBe('Removed 3 fields.')
        // Without a host that can file or pick, only Clear all is drawn.
        const bare = document.createElement('div')
        mountCustomFieldsEditor(bare, host, FIELDS, () => undefined)
        expect(bare.querySelector('[data-lh-field="fields-export"]')).toBeNull()
        expect(bare.querySelector('[data-lh-field="fields-import"]')).toBeNull()
        expect(bare.querySelector('[data-lh-field="fields-clear"]')).not.toBeNull()
    })
})
