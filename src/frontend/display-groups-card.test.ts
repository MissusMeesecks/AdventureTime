// @vitest-environment happy-dom
/**
 * The Display Groups manager (75): Multihog's popup as a card — the two
 * switches, the list, the editor with its checklist and member order, the
 * saves as `prefs.patch`, the delete after a confirm.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DISPLAY_GROUPS_CARD_CSS, createDisplayGroupsCard, type DisplayGroupsCard } from './display-groups-card.js'

const el = (tag: string, attrs?: Record<string, string>) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n }
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

let card: DisplayGroupsCard
let savePrefs: ReturnType<typeof vi.fn>
let confirm: ReturnType<typeof vi.fn>

const group = { id: 'vehicle_systems', name: 'Vehicle Systems', icon: '🚙', enabled: true, members: ['VEHICLE_FUEL', 'ALPHA_STANDING'] }
const settings = { customFields: [{ tag: 'ALPHA_STANDING', label: 'Alpha Standing', icon: '🐺' }, { tag: 'VEHICLE_FUEL', label: 'Vehicle Fuel', icon: '⛽', origin: 'wizard' }] }

const q = <T extends Element = HTMLElement>(sel: string) => card.root.querySelector(sel) as T
const qa = (sel: string) => Array.from(card.root.querySelectorAll<HTMLElement>(sel))
const field = (name: string) => q<HTMLInputElement>(`[data-lh-field="${name}"]`)
const action = (name: string) => q<HTMLButtonElement>(`[data-lh-action="${name}"]`)
const member = (tag: string) => q<HTMLInputElement>(`.lh-dg-member[value="${tag}"]`)
const lastPatch = () => savePrefs.mock.calls.at(-1)?.[0] as Record<string, unknown>

beforeEach(() => {
    document.body.replaceChildren()
    savePrefs = vi.fn(async () => ({}))
    confirm = vi.fn(async () => true)
    card = createDisplayGroupsCard({ el, savePrefs, confirm, fail: () => undefined })
    document.body.append(card.root)
    card.setSettings(settings)
})

describe('the switches and the list', () => {
    it('reads the three preferences, saves a switch as it is ticked, and lists each group with its members', () => {
        expect(card.root.getAttribute('data-lh-card')).toBe('display-groups')
        expect(q('.lh-dg-list').textContent).toContain('No display groups yet.')
        card.applyPrefs({ displayGroupsEnabled: true, displayGroupsShowGaps: false, displayGroups: [group] })
        expect(field('displayGroupsEnabled').checked).toBe(true)
        expect(field('displayGroupsShowGaps').checked).toBe(false)
        const row = q('[data-lh-group="vehicle_systems"]')
        expect(row.querySelector('.lh-dg-name')!.textContent).toBe('Vehicle Systems')
        expect(row.querySelector('.lh-dg-members-line')!.textContent).toBe('VEHICLE_FUEL · ALPHA_STANDING')
        expect(row.querySelector<HTMLInputElement>('.lh-dg-enabled')!.checked).toBe(true)
        field('displayGroupsShowGaps').click()
        expect(lastPatch()).toEqual({ displayGroupsShowGaps: true })
        field('displayGroupsEnabled').click()
        expect(lastPatch()).toEqual({ displayGroupsEnabled: false })
        expect(q('[data-lh-field="display-groups-note"]').textContent).toBe('Display groups off. Every module has its own card again.')
        // A group's own tick saves the groups whole, normalised.
        row.querySelector<HTMLInputElement>('.lh-dg-enabled')!.click()
        expect(lastPatch()).toEqual({ displayGroups: [{ ...group, enabled: false }] })
    })

    it('deletes a group after a confirm, and keeps it when the confirm is refused', async () => {
        card.applyPrefs({ displayGroups: [group, { ...group, id: 'other', name: 'Other', members: ['TIME'] }] })
        confirm.mockResolvedValueOnce(false)
        q('[data-lh-group="vehicle_systems"] .lh-dg-delete').click()
        await settle()
        expect(confirm).toHaveBeenCalledWith('Delete display group?', 'Delete display group "Vehicle Systems"? Its modules are not deleted or turned off.', 'Delete')
        expect(savePrefs).not.toHaveBeenCalled()
        q('[data-lh-group="vehicle_systems"] .lh-dg-delete').click()
        await settle()
        expect(lastPatch()).toEqual({ displayGroups: [{ ...group, id: 'other', name: 'Other', members: ['TIME'] }] })
        expect(q('[data-lh-group="vehicle_systems"]')).toBeNull()
    })
})

describe('the help behind a [?] (96)', () => {
    const tipFor = (label: string) => q<HTMLButtonElement>(`.lh-help-tip[aria-label="Help: ${label}"]`)
    const noteOf = (tip: HTMLElement) => document.getElementById(tip.getAttribute('aria-controls')!)!

    it('puts the card’s, the two ticks’ and the editor’s help behind buttons, hidden from the first paint, with no help left in the open', () => {
        expect(q('.lh-card-title').textContent).toBe('Display groups')
        const head = tipFor('Display groups')
        expect(head.parentElement!.tagName).toBe('SUMMARY')
        expect(noteOf(head).hidden).toBe(true)
        expect(noteOf(head).textContent).toBe('A display group draws the cards of several modules as one card under a shared header.\n\nDisplay groups apply to every chat and only change how cards are drawn. They never change the memo, the prompts, which modules are on or the game systems.')
        head.click()
        expect(card.root.open).toBe(true)
        expect(noteOf(head).hidden).toBe(false)
        for (const [name, label, text] of [
            ['displayGroupsEnabled', 'Enable display groups', 'When on, your saved groups are used in the tracker cards. When off, every module is drawn as its own card again, and your groups are kept. Default: off.'],
            ['displayGroupsShowGaps', 'Show gaps in groups', 'When on, a line and a gap separate the modules inside a group. When off, they run together with no separator. Default: off.'],
        ] as const) {
            const row = field(name).closest('label')!
            expect(row.textContent).toBe(label)
            expect(row.hasAttribute('title')).toBe(false)
            const tip = tipFor(label)
            expect(tip.closest('label')).toBeNull()
            expect(noteOf(tip).closest('label')).toBeNull()
            expect(noteOf(tip).hidden).toBe(true)
            expect(noteOf(tip).textContent).toBe(text)
        }
        expect(q('.lh-second-lead')).toBeNull()
        // The editor's two notes are in the DOM before it is ever opened.
        expect(qa('[data-lh-field="display-group-editor"] .lh-help-note').map((n) => n.hidden)).toEqual([true, true])
    })

    it('keeps the editor’s help through a redraw and a close, and names a group’s own switch for a screen reader', () => {
        card.applyPrefs({ displayGroups: [group] })
        const tick = q('[data-lh-group="vehicle_systems"] .lh-dg-enabled')
        expect(tick.getAttribute('aria-label')).toBe('Turn this group on or off')
        expect(tick.title).toBe('Turn this group on or off')
        action('display-group-add').click()
        expect(field('display-group-icon').hasAttribute('title')).toBe(false)
        expect(field('display-group-name').getAttribute('placeholder')).toBe('Group name')
        const icon = tipFor('Group icon')
        expect(icon.previousElementSibling).toBe(field('display-group-icon'))
        const order = tipFor('Module order in this group')
        expect(order.parentElement!.textContent).toBe('Module order in this group')
        order.click()
        expect(noteOf(order).textContent).toBe('Select the modules to draw under this shared header. Use the arrows to set their order inside the group. Combat, Quests and Benched party cannot be grouped, and a module can belong to only one group.')
        expect(noteOf(order).previousElementSibling).toBe(order.parentElement)
        expect(noteOf(icon).textContent).toBe('The group’s icon. Type or paste an emoji, or pick one from the row below.')
        // A redraw (the cartridge changed under the open editor) keeps the open note open.
        card.setSettings(settings)
        expect(noteOf(tipFor('Module order in this group')).hidden).toBe(false)
        expect(qa('[data-lh-field="display-group-editor"] .lh-help-note')).toHaveLength(2)
        action('display-group-cancel').click()
        expect(qa('[data-lh-field="display-group-editor"] .lh-help-note')).toHaveLength(2)
        expect(DISPLAY_GROUPS_CARD_CSS).toContain('.lh-dg-editor[hidden] { display: none; }')
    })
})

describe('the editor', () => {
    it('creates a group from the checklist in the order ticked, refusing no name and no member', async () => {
        expect(field('display-group-editor').hidden).toBe(true)
        action('display-group-add').click()
        expect(field('display-group-editor').hidden).toBe(false)
        expect(q('.lh-dg-editor-title').textContent).toBe('Create display group')
        // The stock blocks less the three excluded, then the custom fields with their kind.
        expect(qa('.lh-dg-member').map((m) => (m as HTMLInputElement).value)).toEqual(['CHARACTER', 'PARTY', 'INVENTORY', 'ABILITIES', 'SPELLS', 'XP', 'TIME', 'ALPHA_STANDING', 'VEHICLE_FUEL'])
        expect(qa('.lh-dg-member-kind').map((k) => k.textContent)).toEqual(['Built-in', 'Built-in', 'Built-in', 'Built-in', 'Built-in', 'Built-in', 'Built-in', 'Custom', 'Wizard'])
        expect(q('[data-lh-field="display-group-order"]').textContent).toContain('No modules selected yet.')
        action('display-group-save').click()
        expect(q('[data-lh-field="display-groups-note"]').textContent).toBe('Give the display group a name.')
        field('display-group-name').value = 'Vehicle Systems'
        field('display-group-name').dispatchEvent(new Event('input'))
        action('display-group-save').click()
        expect(q('[data-lh-field="display-groups-note"]').textContent).toBe('Select at least one module.')
        expect(savePrefs).not.toHaveBeenCalled()
        member('VEHICLE_FUEL').click()
        member('ALPHA_STANDING').click()
        expect(qa('.lh-dg-order-row').map((r) => r.getAttribute('data-lh-order-tag'))).toEqual(['VEHICLE_FUEL', 'ALPHA_STANDING'])
        // The arrows order the members inside the group; the checklist's order does not.
        q<HTMLButtonElement>('[aria-label="Move VEHICLE_FUEL down"]').click()
        expect(qa('.lh-dg-order-row').map((r) => r.getAttribute('data-lh-order-tag'))).toEqual(['ALPHA_STANDING', 'VEHICLE_FUEL'])
        field('display-group-icon').value = '🚙'
        field('display-group-icon').dispatchEvent(new Event('input'))
        action('display-group-save').click()
        const saved = lastPatch().displayGroups as Array<Record<string, unknown>>
        expect(saved).toHaveLength(1)
        expect(saved[0]).toMatchObject({ name: 'Vehicle Systems', icon: '🚙', enabled: true, members: ['ALPHA_STANDING', 'VEHICLE_FUEL'] })
        expect(String(saved[0]!.id)).toMatch(/^[a-z0-9]+_[a-z0-9]+$/)
        expect(field('display-group-editor').hidden).toBe(true)
        expect(q('.lh-dg-list').textContent).toContain('Vehicle Systems')
    })

    it('offers an icon palette (75-bis): a click writes the icon into the box and the save carries it; a typed one is kept and marked', async () => {
        action('display-group-add').click()
        expect(field('display-group-icon').value).toBe('🗂️')
        const picks = qa('.lh-dg-icon-pick')
        expect(picks.length).toBeGreaterThan(20)
        expect(picks[0]!.classList.contains('lh-dg-icon-pick--picked')).toBe(true)
        picks.find((b) => b.dataset['lhIcon'] === '🐉')!.click()
        expect(field('display-group-icon').value).toBe('🐉')
        expect(qa('.lh-dg-icon-pick--picked').map((b) => b.dataset['lhIcon'])).toEqual(['🐉'])
        field('display-group-icon').value = '🦊'
        field('display-group-icon').dispatchEvent(new Event('input'))
        expect(qa('.lh-dg-icon-pick--picked')).toEqual([])
        field('display-group-name').value = 'Beasts'
        field('display-group-name').dispatchEvent(new Event('input'))
        member('PARTY').click()
        action('display-group-save').click()
        await settle()
        expect((lastPatch().displayGroups as Array<{ icon: string }>)[0]!.icon).toBe('🦊')
    })

    it('edits a group with a claimed tag greyed and a missing member kept as unavailable, and Cancel drops the edit', () => {
        card.applyPrefs({ displayGroups: [group, { id: 'other', name: 'Other', icon: '🏠', enabled: true, members: ['TIME', 'GONE'] }] })
        q('[data-lh-group="other"] .lh-dg-edit').click()
        expect(q('.lh-dg-editor-title').textContent).toBe('Edit display group')
        expect(field('display-group-name').value).toBe('Other')
        expect(member('VEHICLE_FUEL').disabled).toBe(true)
        expect(member('VEHICLE_FUEL').closest('label')!.textContent).toContain('In Vehicle Systems')
        expect(member('TIME').checked).toBe(true)
        expect(member('GONE').checked).toBe(true)
        expect(member('GONE').closest('label')!.textContent).toContain('Unavailable')
        expect(qa('.lh-dg-order-row').map((r) => r.getAttribute('data-lh-order-tag'))).toEqual(['TIME', 'GONE'])
        member('GONE').click()
        field('display-group-name').value = 'Changed'
        field('display-group-name').dispatchEvent(new Event('input'))
        action('display-group-cancel').click()
        expect(field('display-group-editor').hidden).toBe(true)
        expect(savePrefs).not.toHaveBeenCalled()
        expect(q('[data-lh-group="other"] .lh-dg-name').textContent).toBe('Other')
        // Saved, the edit keeps the id and the enabled flag and drops the unticked member.
        q('[data-lh-group="other"] .lh-dg-edit').click()
        member('GONE').click()
        action('display-group-save').click()
        expect(lastPatch()).toEqual({ displayGroups: [group, { id: 'other', name: 'Other', icon: '🏠', enabled: true, members: ['TIME'] }] })
    })
})
