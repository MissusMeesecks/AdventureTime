/**
 * The Custom tags editor (47e).
 *
 * `routerCustomTags` is the user's own categories for the Lorebook Agent,
 * beside the six it ships with: a tag (`SHIP`, `RUMOUR`) and an
 * instruction, listed to the agent under *CUSTOM CATEGORIES* and written
 * to a book of the campaign named for the tag (`<Campaign>_Ship`: the
 * first letter up, the rest down, upstream's rule). Each row is the tag,
 * the book it writes to, the instruction, and a remove; **Add a tag**
 * adds an empty row, which the agent ignores until it has both a tag and
 * an instruction. A tag must be letters, digits and underscores, is kept
 * upper-cased, and may not repeat another row's or a stock module's.
 * Every change writes the list whole.
 */

export interface CustomTag {
    tag: string
    instruction: string
    format?: string
}

export interface CustomTagsHost {
    createElement: <K extends keyof HTMLElementTagNameMap>(
        tag: K,
        attrs?: Record<string, string>,
    ) => HTMLElementTagNameMap[K]
}

export interface CustomTagsEditor {
    setTags(tags: unknown, stockTags: string[]): void
    destroy(): void
}

export interface CustomTagsChange {
    routerCustomTags: CustomTag[]
}

export const DEFAULT_TAG_FORMAT = 'Name | Description | Keywords'

/** The book a tag writes to, as upstream names it: the first letter up, the rest down. */
export function bookNameFor(tag: string): string {
    const clean = tag.trim()
    return clean ? clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase() : ''
}

/** Why a tag cannot be used, or null. `others` are the other rows' tags; `stock` the shipped modules'. */
export function validateCustomTag(tag: string, others: string[], stock: string[]): string | null {
    const clean = tag.trim().toUpperCase()
    if (!clean) return 'A tag needs a name.'
    if (!/^[A-Z0-9_]+$/.test(clean)) return 'A tag is letters, digits and underscores only.'
    if (stock.some((s) => s.toUpperCase() === clean)) return `${clean} is one of the shipped categories.`
    if (others.some((o) => o.trim().toUpperCase() === clean)) return `Another row already uses ${clean}.`
    return null
}

function readTags(value: unknown): CustomTag[] {
    if (!Array.isArray(value)) return []
    return value
        .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
        .map((entry) => ({ ...entry, tag: String(entry.tag ?? ''), instruction: String(entry.instruction ?? '') }) as CustomTag)
}

export function mountCustomTagsEditor(
    root: HTMLElement,
    host: CustomTagsHost,
    initial: { tags: unknown; stockTags: string[] },
    onChange: (change: CustomTagsChange) => void,
): CustomTagsEditor {
    const el = host.createElement

    let tags: CustomTag[] = readTags(initial.tags)
    let stock: string[] = [...initial.stockTags]
    /** A row's refused tag and why, kept until the next render that takes a change. */
    let errors: Record<number, string> = {}

    const lead = el('div', { class: 'lh-tm-lead' })
    lead.textContent = 'Your own categories for the Lorebook Agent, beside the shipped ones. Each writes to its own book of the campaign, named for the tag.'
    const list = el('div', { class: 'lh-tm-list' })
    const add = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'custom-tag-add' })
    add.textContent = 'Add a tag'
    add.addEventListener('click', () => {
        write([...tags, { tag: '', instruction: '', format: DEFAULT_TAG_FORMAT }])
    })
    root.replaceChildren(lead, list, add)

    function write(next: CustomTag[]): void {
        tags = next
        errors = {}
        onChange({ routerCustomTags: next.map((t) => ({ ...t })) })
        render()
    }

    function renderRow(tag: CustomTag, index: number): HTMLElement {
        const row = el('div', { class: 'lh-ct-row' })
        const head = el('div', { class: 'lh-ct-head' })

        const name = el('input', { type: 'text', class: 'lh-input lh-ct-tag', placeholder: 'TAG', 'data-lh-field': `custom-tag-name-${index}` })
        name.value = tag.tag
        const book = el('span', { class: 'lh-ct-book' })
        const showBook = (value: string): void => { book.textContent = value.trim() ? `→ …_${bookNameFor(value)}` : '' }
        showBook(tag.tag)
        name.addEventListener('input', () => { showBook(name.value) })
        name.addEventListener('change', () => {
            const others = tags.filter((_, i) => i !== index).map((t) => t.tag)
            const why = validateCustomTag(name.value, others, stock)
            if (why) {
                errors = { ...errors, [index]: why }
                render()
                return
            }
            write(tags.map((t, i) => (i === index ? { ...t, tag: name.value.trim().toUpperCase() } : t)))
        })
        const remove = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-ct-remove', 'data-lh-field': `custom-tag-remove-${index}` })
        remove.textContent = '✕'
        remove.title = 'Remove this tag. Entries already written to its book stay.'
        remove.addEventListener('click', () => { write(tags.filter((_, i) => i !== index)) })
        head.append(name, book, remove)
        row.append(head)

        if (errors[index]) {
            const why = el('div', { class: 'lh-ct-error' })
            why.textContent = errors[index]
            row.append(why)
        }

        const instruction = el('textarea', { class: 'lh-input lh-ct-text', rows: '3', placeholder: 'What the agent should record under this tag…', 'data-lh-field': `custom-tag-text-${index}` })
        instruction.value = tag.instruction
        instruction.addEventListener('change', () => {
            write(tags.map((t, i) => (i === index ? { ...t, instruction: instruction.value } : t)))
        })
        row.append(instruction)
        return row
    }

    function render(): void {
        if (!tags.length) {
            const none = el('div', { class: 'lh-tm-note' })
            none.textContent = 'No custom tags yet.'
            list.replaceChildren(none)
            return
        }
        list.replaceChildren(...tags.map(renderRow))
    }

    render()

    return {
        setTags(next: unknown, stockTags: string[]): void {
            tags = readTags(next)
            stock = [...stockTags]
            errors = {}
            render()
        },
        destroy(): void {
            root.replaceChildren()
        },
    }
}
