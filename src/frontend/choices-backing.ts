/**
 * The choice buttons' backing (74c-ter, 74c-quater; departure 154): what a
 * theme or the day/night cycle does to the narrator's choice buttons under
 * the replies.
 *
 * Multihog's themes and phases are scoped to its panel and never reach its
 * CYOA buttons, which are SillyTavern's own in the chat. AdventureTime's tokens
 * sit on the body (74a), so the buttons it draws (`message-choices.ts`) take
 * the theme's or the phase's accent fill — a tint at a tenth of the accent's
 * strength in every named theme and every phase — and over a location
 * picture with Lumiverse's glass look on the tint reads badly. `tinted` is
 * that look, as the buttons were drawn from the first day; `solid` draws
 * them on the theme's or the phase's own background (`--lh-bg`, the host's
 * own with no theme); `hover` does so only while the pointer is over the
 * list, the whole block at once, the hovered button's accent border the
 * panel's own rule and standing. 74c-ter offered the three under the
 * day/night cycle alone; 74c-quater opened them to every theme, the
 * maintainer's ask of 2026-10-30.
 */

/** The three, as the preference stores them. */
export type ChoicesBacking = 'tinted' | 'solid' | 'hover'

/** The three, in the select's order. */
export const CHOICES_BACKINGS: readonly ChoicesBacking[] = ['tinted', 'solid', 'hover']

/** A stored value as one of the three; anything else is the look before 74c-ter. */
export function readChoicesBacking(value: unknown): ChoicesBacking {
    return value === 'solid' || value === 'hover' ? value : 'tinted'
}

/** The class a backing puts on the body; `tinted` puts none. */
export function choicesBackingClass(mode: ChoicesBacking): string {
    return `lh-choice-backing-${mode}`
}

/** Puts the backing's class on the body, taking any other's off. Returns the backing read. */
export function applyChoicesBacking(body: Element, mode: unknown): ChoicesBacking {
    const read = readChoicesBacking(mode)
    for (const name of Array.from(body.classList)) if (name.startsWith('lh-choice-backing-')) body.classList.remove(name)
    if (read !== 'tinted') body.classList.add(choicesBackingClass(read))
    return read
}

/**
 * The stylesheet: the buttons on the theme's or the phase's own background,
 * always or while the list is hovered. The rules name the buttons and their
 * list and nothing else, so the chat's own background is never touched.
 */
export const CHOICES_BACKING_CSS = `/* The choice buttons' backing (74c-ter, 74c-quater): solid, or solid while the list is hovered. */
.${choicesBackingClass('solid')} .lh-choice,
.${choicesBackingClass('hover')} .lh-choices-list:hover .lh-choice {
    background: var(--lh-bg, var(--lumiverse-bg, rgba(20, 22, 30, 0.95)));
}
.${choicesBackingClass('hover')} .lh-choice { transition: background-color 0.2s ease; }
`
