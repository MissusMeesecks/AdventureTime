// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createLoreChip, loreBudgetLine, loreWarningText, shortTokens } from './lore-chip.js'
import type { LoreLoadResult } from '../protocol.js'

const el = ((tag: string, attrs?: Record<string, string>) => {
    const node = document.createElement(tag)
    for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, value)
    return node
}) as never

let inline: HTMLElement
beforeEach(() => {
    document.body.replaceChildren()
    inline = document.createElement('div')
    document.body.append(inline)
})

const q = (name: string) => document.querySelector(`[data-lh-field="${name}"]`) as HTMLElement | null
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function fakeUi() {
    const opened: Array<{ title: string }> = []
    return {
        opened,
        ui: {
            showModal(options: { title: string }) {
                opened.push(options)
                const root = document.createElement('div')
                document.body.append(root)
                return { root, dismiss: () => { root.remove() } }
            },
        },
    }
}

const over = (): LoreLoadResult => ({
    threshold: 10000,
    over: true,
    load: {
        chatId: 'c', at: '2030-01-02T03:04:05.000Z', total: 61200, leftOut: 0,
        entries: [
            { id: 'e-1', title: 'Harbourmaster Quill', book: 'Brine_NPC', tokens: 40000, constant: false, cleanTarget: 'Brine_NPC::harbourmaster' },
            { id: 'e-3', title: 'Tide tables', book: 'Old Atlas', tokens: 21200, constant: true },
        ],
    },
})

describe('the lore chip', () => {
    it('shortens a total for the lights’ row', () => {
        expect([840, 1000, 9649, 10400, 61200, 61500].map(shortTokens)).toEqual(['840', '1k', '9.6k', '10k', '61k', '62k'])
    })

    it('words the warning and what Lumiverse’s own limits did', () => {
        expect(loreWarningText(61200, 10000)).toBe('Lumiverse sent about 61,200 tokens of lore with the last reply, over your 10,000 warning.')
        expect(loreBudgetLine(null)).toContain('did not say')
        expect(loreBudgetLine(0)).toBe('Lumiverse’s own budget: no entry was left out of this reply, so no limit is set or none was reached.')
        expect(loreBudgetLine(1)).toBe('Lumiverse’s own budget: a limit is set, and Lumiverse left 1 entry out of this reply because of it.')
        expect(loreBudgetLine(4)).toContain('left 4 entries out')
    })

    it('is hidden until a reply is over the warning, and hidden again when it is not', () => {
        const chip = createLoreChip({ el, ui: undefined, inline, clean: async () => undefined })
        expect(chip.node.hidden).toBe(true)
        chip.set(over())
        expect(chip.node.hidden).toBe(false)
        expect(chip.node.textContent).toBe('⚠ Lore 61k')
        expect(chip.node.title).toBe('Lumiverse sent about 61,200 tokens of lore with the last reply, over your 10,000 warning.')
        chip.set({ ...over(), over: false })
        expect(chip.node.hidden).toBe(true)
        expect(chip.node.textContent).toBe('')
        chip.set(over())
        chip.set(null)
        expect(chip.node.hidden).toBe(true)
        chip.set({ load: null, threshold: 10000, over: true })
        expect(chip.node.hidden).toBe(true)
    })

    it('keeps its own press from the title row’s drag', () => {
        const chip = createLoreChip({ el, ui: undefined, inline, clean: async () => undefined })
        const row = document.createElement('div')
        row.append(chip.node)
        const heard = vi.fn()
        row.addEventListener('pointerdown', heard)
        chip.node.dispatchEvent(new Event('pointerdown', { bubbles: true }))
        expect(heard).not.toHaveBeenCalled()
    })

    it('opens the entries by size in the host’s modal, with Clean on the campaign’s own alone', async () => {
        const { ui, opened } = fakeUi()
        let finish!: () => void
        const clean = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
        const chip = createLoreChip({ el, ui, inline, clean })
        document.body.append(chip.node)
        chip.set(over())
        chip.node.click()
        expect(opened).toMatchObject([{ title: 'Active lore by size' }])
        const box = q('lore-load')!
        expect(box.closest('.adventuretime-panel')).not.toBeNull()
        expect(box.querySelector('.lh-lore-load-lead')!.textContent).toBe('Lumiverse sent about 61,200 tokens of lore with the last reply, over your 10,000 warning.')
        expect(box.querySelector('.lh-lore-load-budget')!.textContent).toContain('no entry was left out of this reply')
        expect(box.querySelector('.lh-lore-load-budget')!.textContent).toContain('Max Token Budget')
        const rows = Array.from(box.querySelectorAll('.lh-lore-row'))
        expect(rows.map((r) => r.querySelector('.lh-lore-row-title')!.textContent)).toEqual(['Harbourmaster Quill', 'Tide tables'])
        expect(rows.map((r) => r.querySelector('.lh-lore-row-book')!.textContent)).toEqual(['Brine_NPC', 'Old Atlas · always sent'])
        expect(rows.map((r) => r.querySelector('.lh-lore-row-tokens')!.textContent)).toEqual(['40,000 tokens', '21,200 tokens'])
        expect(rows.map((r) => !!r.querySelector('[data-lh-field="lore-clean"]'))).toEqual([true, false])

        const button = rows[0]!.querySelector('[data-lh-field="lore-clean"]') as HTMLButtonElement
        const note = rows[0]!.querySelector('.lh-lore-row-note')!
        button.click()
        expect(clean).toHaveBeenCalledWith('Brine_NPC::harbourmaster')
        expect(button.disabled).toBe(true)
        expect(note.textContent).toContain('Cleaning.')
        finish()
        await settle()
        expect(button.disabled).toBe(false)
        expect(note.textContent).toContain('Cleanup finished.')

        // A second press replaces the window; it never stacks a second one.
        chip.node.click()
        expect(document.querySelectorAll('[data-lh-field="lore-load"]').length).toBe(1)

        q('lore-load-close')!.click()
        expect(q('lore-load')).toBeNull()
    })

    it('says why a clean failed, in red, and gives the button back', async () => {
        const { ui } = fakeUi()
        const chip = createLoreChip({ el, ui, inline, clean: async () => { throw new Error('An agent is already running.') } })
        chip.set(over())
        chip.node.click()
        const row = document.querySelector('.lh-lore-row')!
        ;(row.querySelector('[data-lh-field="lore-clean"]') as HTMLButtonElement).click()
        await settle()
        const note = row.querySelector('.lh-lore-row-note')!
        expect(note.textContent).toBe('Cleanup failed: An agent is already running.')
        expect(note.classList.contains('lh-lore-row-note--problem')).toBe(true)
        expect((row.querySelector('[data-lh-field="lore-clean"]') as HTMLButtonElement).disabled).toBe(false)
    })

    it('stands inline on a host without a modal, one window at a time', () => {
        const chip = createLoreChip({ el, ui: undefined, inline, clean: async () => undefined })
        chip.set(over())
        chip.node.click()
        chip.node.click()
        expect(inline.querySelectorAll('[data-lh-field="lore-load"]').length).toBe(1)
        q('lore-load-close')!.click()
        expect(inline.children.length).toBe(0)
    })
})
