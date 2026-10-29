/**
 * A picture large (Phase 64): one opener for every picture the panel draws.
 *
 * Phase 55 gave the scene's picture a click that opens it in the host's
 * modal, and nothing else: an entity's portrait on a card, a row of the
 * portraits in play, a library card's picture and the Full card's photo
 * stayed at thumbnail size. The maintainer asked for any picture to open
 * large (2026-10-16), so the opener lives here and every site shares it.
 *
 * Two ways in, because the pictures are drawn two ways. A picture the panel
 * builds as an element is marked by `zoomable`, which takes the click and
 * the keys itself. The entity cards come out of the renderer as an HTML
 * string, rebuilt on every tracker event and placed by the host under the
 * messages, so a listener on the image would be thrown away with it; those
 * carry `data-lh-large` in their markup, and the cards' own delegated click
 * handlers ask `zoomTarget` whether the click landed on one. The attribute
 * is the one marker both ways share, and the cursor follows it.
 *
 * **The modal carries the picture's own buttons since 80** (the
 * maintainer's ask of 2026-10-27, departure 137): Multihog's portrait and
 * location-image menus are one popup each — the preview, Browse, AI
 * Generate, Clear — opened by a click on the picture's box; AdventureTime
 * keeps the click that opens the picture large and puts those buttons under
 * it, so the large view is the menu. A site passes `PictureActions` naming
 * what it can do for that picture; the modal draws a button per action,
 * closes itself as one is pressed, and runs it — the site's own note says
 * what happened, as it did for the buttons on its rows. A box with no
 * picture yet opens the same modal with the placeholder and the ways to
 * get one.
 */

/**
 * What a site can do for the picture it opened large (80). Each is one of
 * the site's own operations, wrapped with its own reporting; `null` offers
 * the button greyed with its `note` as the reason (a build with no file
 * picker, a connection that cannot draw), and an absent one is not offered.
 */
export interface PictureActions {
    /** The word for what the picture is, in the buttons' titles and the empty box. */
    kind: 'portrait' | 'photo' | 'picture'
    /** Pick a file and keep it. */
    set?: (() => Promise<void>) | null
    /** Paste an address. */
    url?: () => Promise<void>
    /** Draw it through the host's image generation. */
    draw?: (() => Promise<void>) | null
    /** Take it off; absent when nothing is stored. */
    remove?: () => Promise<void>
    /** Why a greyed button is greyed, under the buttons. */
    note?: string
    /** Where a failed action reports; absent, it is swallowed, as the site's own buttons never let one be. */
    fail?: (error: unknown) => void
}

/** Open a picture large, titled, with its actions when the site has any. */
export type Enlarge = (src: string, title: string, actions?: PictureActions) => void

/** The slice of the host's `ui` the opener needs; the modal is absent on an older host. */
export interface ModalUi {
    showModal?(options: { title: string; width?: number; maxHeight?: number }): { root: HTMLElement; dismiss(): void }
}

/** The attribute that marks a picture a click opens large; its value is the modal's title. */
export const LARGE_ATTR = 'data-lh-large'

/** What a marked picture says on hover. */
export const LARGE_TITLE = 'Open the picture large'

/** What an empty box with actions says on hover (80). */
export const LARGE_EMPTY_TITLE = 'Set, draw or paste a picture'

/** The buttons' words (80): one per action, in Multihog's order — the file, the address, the draw, the clear. */
export const LARGE_BUTTONS: ReadonlyArray<{ key: 'set' | 'url' | 'draw' | 'remove'; text: string; title: (kind: PictureActions['kind'], has: boolean) => string }> = [
    { key: 'set', text: '🖼 From a file', title: (kind, has) => `${has ? 'Replace' : 'Set'} the ${kind} from an image file; it is stored with the host.` },
    { key: 'url', text: '🔗 From an address', title: (kind) => `Paste an https address for the ${kind}.` },
    { key: 'draw', text: '🎨 Draw', title: (kind) => `Write an image prompt and draw the ${kind} on the image connection.` },
    { key: 'remove', text: '🗑 Remove', title: (kind) => `Take the ${kind} off; the picture stays in the host's store.` },
]

/**
 * The opener over the host's modal, or `undefined` when the host has none,
 * so a site can leave its picture plain rather than promise a click that
 * does nothing.
 */
export function createEnlarge(ui: ModalUi | undefined): Enlarge | undefined {
    const showModal = ui?.showModal
    if (!showModal) return undefined
    return (src, title, actions) => {
        const modal = showModal.call(ui, { title, width: 1100, maxHeight: 900 })
        const doc = modal.root.ownerDocument
        if (src) {
            const img = doc.createElement('img')
            img.setAttribute('src', src)
            img.setAttribute('alt', title)
            img.className = 'lh-large'
            modal.root.append(img)
        } else {
            // No picture yet (80): the box says so, and the buttons under it are the way to one.
            const empty = doc.createElement('div')
            empty.className = 'lh-large-empty'
            empty.textContent = `No ${actions?.kind ?? 'picture'} yet.`
            modal.root.append(empty)
        }
        if (!actions) return
        const bar = doc.createElement('div')
        bar.className = 'lh-large-actions'
        bar.setAttribute('data-lh-field', 'large-actions')
        for (const spec of LARGE_BUTTONS) {
            if (!(spec.key in actions) || actions[spec.key] === undefined) continue
            const action = actions[spec.key]
            const button = doc.createElement('button')
            button.type = 'button'
            button.className = 'lh-button lh-large-button'
            button.setAttribute('data-lh-field', `large-${spec.key}`)
            button.textContent = spec.text
            button.title = action ? spec.title(actions.kind, !!src) : (actions.note ?? spec.title(actions.kind, !!src))
            button.disabled = !action
            if (action) {
                button.addEventListener('click', () => {
                    // The modal closes first: a draw opens the prompt editor in a modal of its own, and the site's
                    // note is where the outcome reads, as it does for the same buttons on the site's rows.
                    modal.dismiss()
                    action().catch((error: unknown) => { actions.fail?.(error) })
                })
            }
            bar.append(button)
        }
        modal.root.append(bar)
        if (actions.note) {
            const note = doc.createElement('div')
            note.className = 'lh-large-note'
            note.textContent = actions.note
            modal.root.append(note)
        }
    }
}

/**
 * Mark a drawn picture as one a click or Enter opens large. With no opener
 * the picture is left exactly as it was: no role, no cursor, no promise.
 *
 * `actions` is read at the click (80), so the buttons say what the site can
 * do for the picture as it stands then, not as it stood when drawn. An
 * empty `src` is a box with no picture yet: it opens only when there are
 * actions to offer, and says so on hover.
 */
export function zoomable(img: HTMLElement, src: string, title: string, enlarge: Enlarge | undefined, actions?: () => PictureActions | undefined): void {
    if (!enlarge) return
    if (!src && !actions) return
    img.setAttribute(LARGE_ATTR, title)
    img.setAttribute('role', 'button')
    img.setAttribute('tabindex', '0')
    img.title = src ? LARGE_TITLE : LARGE_EMPTY_TITLE
    const open = (): void => {
        const offered = actions?.()
        if (!src && !offered) return
        enlarge(src, title, offered)
    }
    img.addEventListener('click', (event) => { event.stopPropagation(); open() })
    img.addEventListener('keydown', (event) => {
        const key = (event as KeyboardEvent).key
        if (key !== 'Enter' && key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        open()
    })
}

/**
 * The marked picture a click or a key landed on, for the delegated handlers
 * over rendered HTML; `null` when it landed anywhere else.
 */
export function zoomTarget(target: EventTarget | null): { src: string; title: string } | null {
    if (!(target instanceof Element)) return null
    const img = target.closest(`img[${LARGE_ATTR}]`)
    if (!img) return null
    const src = img.getAttribute('src')
    if (!src) return null
    return { src, title: img.getAttribute(LARGE_ATTR) || 'The picture' }
}

export const ENLARGE_CSS = `
img[data-lh-large] { cursor: zoom-in; }
[data-lh-large]:not(img) { cursor: pointer; }
.lh-large { display: block; max-width: 100%; max-height: 80vh; margin: 0 auto; object-fit: contain; }
.lh-large-empty { text-align: center; opacity: 0.6; padding: 48px 12px; font-size: 1.1em; }
.lh-large-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 12px; }
.lh-large-note { text-align: center; font-size: 0.85em; opacity: 0.7; margin-top: 6px; }
`
