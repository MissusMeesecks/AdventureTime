/**
 * The world rules editor.
 *
 * Switch a section on or off, read what it says, and delete one you are done
 * with. `src/settings/sysprompt-library.ts` has the reasoning; the short
 * version is that these 44 sections are the maintainer's own writing and until
 * now nothing in this build read a word of them.
 *
 * Three things shape it:
 *
 * **The prose is the point**, so a row opens to show it rather than
 * summarising it. A summary of someone's world-building is not a substitute
 * for it, and the one question this editor has to answer — *what am I actually
 * sending the storyteller?* — is unanswerable without the text.
 *
 * **The cost is stated**, per row and in total. 152,000 characters sit in this
 * cartridge; switching the wrong ten on is an expensive mistake to make
 * silently.
 *
 * **Delete is armed, not immediate.** It removes a section and its place in the
 * order, and there is no undo. Two presses, and the second says what it will
 * take.
 */

import {
    buildSyspromptView,
    deleteSection,
    setSectionEnabled,
    type SyspromptSection,
} from '../settings/sysprompt-library.js'

export interface SyspromptHost {
    createElement: <K extends keyof HTMLElementTagNameMap>(
        tag: K,
        attrs?: Record<string, string>,
    ) => HTMLElementTagNameMap[K]
}

export interface SyspromptEditor {
    setData(sections: SyspromptSection[], order: string[]): void
    destroy(): void
}

/** What a change here writes. The order moves only on a delete. */
export interface SyspromptChange {
    customSyspromptLibrary: SyspromptSection[]
    syspromptSectionOrder?: string[]
}

export function mountSyspromptEditor(
    root: HTMLElement,
    host: SyspromptHost,
    initialSections: SyspromptSection[],
    initialOrder: string[],
    onChange: (change: SyspromptChange) => void,
): SyspromptEditor {
    const el = host.createElement

    let sections = initialSections.map((section) => ({ ...section }))
    let order = [...initialOrder]
    const open = new Set<string>()
    let armed: string | null = null

    const summary = el('div', { class: 'lh-wr-summary' })
    const list = el('div', { class: 'lh-wr-list' })
    root.replaceChildren(summary, list)

    function setEnabled(id: string, enabled: boolean): void {
        sections = setSectionEnabled(sections, id, enabled) as SyspromptSection[]
        onChange({ customSyspromptLibrary: sections })
        render()
    }

    function remove(id: string): void {
        const next = deleteSection(sections, order, id)
        sections = next.customSyspromptLibrary as SyspromptSection[]
        order = next.syspromptSectionOrder
        armed = null
        open.delete(id)
        onChange({ customSyspromptLibrary: sections, syspromptSectionOrder: order })
        render()
    }

    function renderRow(row: ReturnType<typeof buildSyspromptView>['rows'][number]): HTMLElement {
        const item = el('div', {
            class: `lh-wr-row${row.enabled ? ' lh-wr-row--on' : ''}${row.empty ? ' lh-wr-row--empty' : ''}`,
        })

        const head = el('div', { class: 'lh-wr-head' })

        const toggle = el('input', { type: 'checkbox' })
        toggle.checked = row.enabled
        toggle.title = `Send ${row.tag} to the storyteller`
        toggle.addEventListener('change', () => { setEnabled(row.id, toggle.checked) })
        head.append(toggle)

        const name = el('span', { class: 'lh-wr-name' })
        name.textContent = row.icon ? `${row.icon} ${row.tag}` : row.tag
        // The head folds the body; the checkbox above stops the click there.
        name.addEventListener('click', () => {
            if (open.has(row.id)) open.delete(row.id)
            else open.add(row.id)
            render()
        })
        head.append(name)

        if (row.empty) {
            const chip = el('span', { class: 'lh-wr-chip' })
            chip.textContent = 'nothing written'
            head.append(chip)
        }

        const size = el('span', { class: 'lh-wr-size' })
        size.textContent = row.size ? `~${row.tokens.toLocaleString()} tokens` : '—'
        head.append(size)

        item.append(head)

        if (row.description) {
            const description = el('div', { class: 'lh-wr-description' })
            description.textContent = row.description
            item.append(description)
        }

        if (open.has(row.id)) {
            const body = el('pre', { class: 'lh-wr-body' })
            const section = sections.find((candidate) => String(candidate.id ?? '') === row.id)
            body.textContent = String(section?.content ?? '')
            item.append(body)

            const actions = el('div', { class: 'lh-wr-actions' })
            const del = el('button', {
                type: 'button',
                class: `lh-button lh-button--quiet${armed === row.id ? ' lh-button--danger' : ''}`,
            })
            del.textContent = armed === row.id ? `Delete ${row.tag} for good` : 'Delete this section'
            del.addEventListener('click', () => {
                if (armed === row.id) remove(row.id)
                else { armed = row.id; render() }
            })
            actions.append(del)

            if (armed === row.id) {
                const warning = el('span', { class: 'lh-wr-warning' })
                warning.textContent =
                    `${row.size.toLocaleString()} characters of your writing. There is no undo — ` +
                    'a cartridge export is the only copy.'
                actions.append(warning)
            }

            item.append(actions)
        }

        return item
    }

    function render(): void {
        const view = buildSyspromptView(sections, order)

        summary.replaceChildren()

        const lead = el('div', { class: 'lh-wr-lead' })
        lead.textContent = view.summary
        summary.append(lead)

        const counts = el('div', { class: 'lh-wr-counts' })
        counts.textContent = view.counts ? `${view.counts} · ${view.cost}` : view.cost
        summary.append(counts)

        for (const note of view.notes) {
            const line = el('div', { class: 'lh-wr-note' })
            line.textContent = note
            summary.append(line)
        }

        list.replaceChildren(...view.rows.map(renderRow))
    }

    render()

    return {
        setData(nextSections: SyspromptSection[], nextOrder: string[]): void {
            sections = nextSections.map((section) => ({ ...section }))
            order = [...nextOrder]
            armed = null
            render()
        },
        destroy(): void {
            root.replaceChildren()
        },
    }
}
