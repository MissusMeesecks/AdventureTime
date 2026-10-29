/**
 * Hide the rendered `<choices>` lines in a reply bubble, from this side.
 *
 * Phase 31a kept the raw block out of the bubble with a display-only regex
 * script in the host's regex library. Live, that script ran on every render
 * of every message of a 250-message chat and the maintainer felt it as a
 * severe slowdown, with the bubble's formatting sometimes left broken until
 * a reload (lesson 37). So the regex is gone, and the hiding is done here
 * instead: the module that draws the buttons already holds the reply's
 * element and the choice texts, and it hides the lines the host made of the
 * block -- the same text, rendered -- once, in its own sweep.
 *
 * Two shapes are handled, because what the host makes of the block is the
 * host's business and has changed before: a `<choices>` element left in the
 * DOM as an unknown tag, and the block's lines rendered as list items or
 * paragraphs. Matching is by text, number and emoji stripped, so a line is
 * hidden only when it *is* a choice. Nothing is removed; hidden nodes keep
 * a marker so a second sweep costs a lookup.
 */

export const HIDDEN_MARK = 'data-lh-choice-hidden'

/** A line and a choice compare without their numbering, emoji or punctuation. */
export function normalizeChoiceText(text: string): string {
    return String(text ?? '')
        .toLowerCase()
        .replace(/^\s*\d+\s*[.)\]:-]\s*/, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
}

const CANDIDATES = 'choices, p, li, h1, h2, h3, h4, h5, h6, blockquote, button'

/**
 * Our own buttons under the reply: the one thing that must stay visible.
 *
 * Not the root element this module injects: the host *replaces* that root
 * with a wrapper of its own (`data-spindle-ext`) and keeps only its contents,
 * so `.lh-choices` is never in the DOM and a check for it never matched -- the
 * first live run hid our buttons as duplicates of themselves (lesson 38). The
 * list inside the root survives, and so does the host's wrapper.
 */
const OWN_BLOCK = '.lh-choices-list, .lh-choices, [data-spindle-ext]'

/**
 * Hide the choice lines inside `bubble`. Returns how many nodes were hidden
 * this call, for the tests; a bubble already done returns 0.
 *
 * Two guards, after the first live run hid the options outright (33a-bis):
 * nothing that *contains* our own buttons is ever hidden, whatever its text,
 * and if our buttons are not standing visible in the bubble when the sweep is
 * done, everything this call hid is put back. Two menus are a blemish; no
 * menu is a reply the user cannot answer.
 */
export function hideChoicesInBubble(bubble: Element, choices: readonly string[]): number {
    if (!choices.length) return 0
    const wanted = new Set(choices.map(normalizeChoiceText).filter(Boolean))
    if (!wanted.size) return 0
    /**
     * Every choice in one paragraph, separated by line breaks the text does
     * not keep: each choice's text is taken out in turn, and what is left
     * may be numbering and nothing else.
     */
    const isWholeBlock = (text: string): boolean => {
        let rest = ` ${text} `
        for (const choice of wanted) {
            const at = rest.indexOf(choice)
            if (at < 0) return false
            rest = `${rest.slice(0, at)} ${rest.slice(at + choice.length)}`
        }
        return /^[\d\s]*$/.test(rest)
    }
    let hidden = 0
    const hiddenNow: Element[] = []

    // Every caller has checked the mark already; a second check here was
    // found redundant by a green mutation.
    const hide = (node: Element): void => {
        node.setAttribute(HIDDEN_MARK, '')
        ;(node as HTMLElement).style.display = 'none'
        hiddenNow.push(node)
        hidden += 1
    }

    for (const node of Array.from(bubble.querySelectorAll(CANDIDATES))) {
        // Never our own buttons, which sit in the block this module injected,
        // and never anything the host put them inside. For a line matched by
        // text the second check is moot -- the buttons' text is in the line's
        // -- but a <choices> element is hidden on its name alone.
        if (node.closest(OWN_BLOCK) || node.querySelector(OWN_BLOCK)) continue
        if (node.hasAttribute(HIDDEN_MARK)) continue
        if (node.tagName.toLowerCase() === 'choices') {
            hide(node)
            continue
        }
        const text = normalizeChoiceText(node.textContent ?? '')
        if (!text) continue
        // One line per choice, or every line in one paragraph.
        if (wanted.has(text) || isWholeBlock(text)) hide(node)
    }

    // A list whose every item is now hidden is itself hidden, so the host's
    // list styling leaves no empty gap.
    for (const list of Array.from(bubble.querySelectorAll('ol, ul'))) {
        // No containment check here: a list holding our block has a child
        // without the marker, so it never qualifies (a green mutation showed
        // the check was dead).
        if (list.closest(OWN_BLOCK) || list.hasAttribute(HIDDEN_MARK)) continue
        const items = Array.from(list.children)
        if (items.length && items.every((item) => item.hasAttribute(HIDDEN_MARK))) hide(list)
    }

    // The fail-safe: our buttons must be standing, or nothing goes.
    if (hiddenNow.length && !ownButtonsVisible(bubble)) {
        for (const node of hiddenNow) {
            node.removeAttribute(HIDDEN_MARK)
            ;(node as HTMLElement).style.display = ''
        }
        return 0
    }
    return hidden
}

/** Our buttons are in the bubble, and nothing between them and it is hidden. */
export function ownButtonsVisible(bubble: Element): boolean {
    const button = bubble.querySelector('.lh-choices-list button')
    if (!button) return false
    for (let node: Element | null = button; node && node !== bubble; node = node.parentElement) {
        if ((node as HTMLElement).style.display === 'none' || node.hasAttribute(HIDDEN_MARK)) return false
    }
    return true
}
