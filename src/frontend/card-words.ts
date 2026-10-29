/**
 * The Player Card's word count, as the legacy's select offers it: the eight
 * stock counts and *Custom…*, which shows a number box. Shared by the creator,
 * Instant Action and the Player Card fold (35b).
 */

import { CARD_WORD_OPTIONS, CARD_WORDS_MAX, CARD_WORDS_MIN, normalizeCardWords } from '../tracker/creator.js'

export interface CardWordsControl {
    root: HTMLElement
    value(): number
    set(words: number): void
    setDisabled(disabled: boolean): void
}

export function createCardWordsControl(
    el: (tag: string, attrs?: Record<string, string>) => HTMLElement,
    name: string,
    onChange: (words: number) => void,
): CardWordsControl {
    const root = el('span', { class: 'lh-card-words' })
    const select = el('select', { class: 'lh-input', 'data-lh-field': `${name}-input`, 'aria-label': 'Player Card length' }) as HTMLSelectElement
    for (const n of CARD_WORD_OPTIONS) {
        const option = el('option', { value: String(n) }) as HTMLOptionElement
        option.textContent = `${n} words`
        select.append(option)
    }
    const other = el('option', { value: 'other' }) as HTMLOptionElement
    other.textContent = 'Custom…'
    select.append(other)
    const custom = el('input', { type: 'number', class: 'lh-input', 'data-lh-field': `${name}-custom-input`, min: String(CARD_WORDS_MIN), max: String(CARD_WORDS_MAX), placeholder: `${CARD_WORDS_MIN}–${CARD_WORDS_MAX}`, 'aria-label': 'Custom Player Card length' }) as HTMLInputElement
    custom.hidden = true
    root.append(select, custom)

    const value = (): number => normalizeCardWords(select.value === 'other' ? custom.value : select.value)
    const set = (words: number): void => {
        const n = normalizeCardWords(words)
        if (CARD_WORD_OPTIONS.includes(n)) {
            select.value = String(n)
            custom.hidden = true
        } else {
            select.value = 'other'
            custom.value = String(n)
            custom.hidden = false
        }
    }
    select.addEventListener('change', () => {
        custom.hidden = select.value !== 'other'
        if (select.value === 'other') { custom.focus(); return }
        onChange(value())
    })
    custom.addEventListener('change', () => { onChange(value()) })
    set(150)
    return { root, value, set, setDisabled: (disabled) => { select.disabled = disabled; custom.disabled = disabled } }
}
