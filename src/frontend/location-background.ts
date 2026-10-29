/**
 * The location picture as the chat background (Phase 73f, departure B3's
 * *Use location images as chat background*): Multihog's
 * `applyLocationImageToChatBackground`, which sets `backgroundImage` on
 * SillyTavern's `#bg1`.
 *
 * Lumiverse has backgrounds of its own but no API an extension may set one
 * through, so this does what the legacy does, on the host's page: it looks
 * for the layer the host draws its background on -- an element that covers
 * most of the window and carries a background image, by preference one
 * whose id or class says *background* -- and lays the picture on it. With
 * no such layer the picture goes on the page body, which the host's panes
 * may well cover; the browser console says which was chosen, so a picture
 * that does not show can be followed up with the element's name. Nothing
 * is written while the switch is off, and clearing puts back whatever the
 * element had inline.
 *
 * The host writes to the same layer (73f-ter): it sets its own background
 * inline, on load and as the chat changes, and may do so after this chose
 * the layer and saved what it held. So the value put back on clear is only
 * ever put back over this module's own picture — a value the host changed
 * meanwhile is the host's, left as it is and kept as the one to restore —
 * and a picture the host wrote over is laid again on the next sync. Before
 * that, a clear after the host had written restored the empty value saved
 * earlier, which wiped the host's own background to a plain colour.
 */

/** What the finder reads: the page and its window, injectable for tests. */
export interface BackgroundView {
    innerWidth: number
    innerHeight: number
    getComputedStyle(element: Element): { backgroundImage: string }
}

const NAMED = /background|wallpaper|(^|[^a-z])bg([^a-z]|$)/i
const COVERS = 0.5
const AT_MOST = 6000

/** `tag#id.class.class`, for the console. */
export function describeElement(element: Element): string {
    const id = element.id ? `#${element.id}` : ''
    const classes = Array.from(element.classList).slice(0, 4).map((c) => `.${c}`).join('')
    return `${element.tagName.toLowerCase()}${id}${classes}`
}

/**
 * The host's background layer, or `null`: among the elements that cover
 * half the window or more, the named one with a background image first,
 * then any named one, then the largest with a background image.
 */
export function findBackgroundLayer(doc: Document, view: BackgroundView): HTMLElement | null {
    const body = doc.body
    if (!body) return null
    const area = Math.max(1, view.innerWidth * view.innerHeight)
    const all = Array.from(body.querySelectorAll<HTMLElement>('*')).slice(0, AT_MOST)
    let named: HTMLElement | null = null
    let namedWithImage: HTMLElement | null = null
    let largest: { element: HTMLElement; size: number } | null = null
    for (const element of all) {
        const rect = element.getBoundingClientRect()
        const size = rect.width * rect.height
        if (size / area < COVERS) continue
        const image = (view.getComputedStyle(element).backgroundImage ?? '').trim()
        const hasImage = !!image && image !== 'none'
        const isNamed = NAMED.test(`${element.id} ${element.className && typeof element.className === 'string' ? element.className : ''}`)
        if (isNamed && hasImage && !namedWithImage) namedWithImage = element
        if (isNamed && !named) named = element
        if (hasImage && (!largest || size > largest.size)) largest = { element, size }
    }
    return namedWithImage ?? named ?? largest?.element ?? null
}

export interface LocationBackground {
    /** Lay the picture behind the chat, or take it off with `null`. The same picture twice is nothing. */
    apply(src: string | null): void
    clear(): void
}

export function createLocationBackground(doc: Document, view: BackgroundView, log: (line: string) => void): LocationBackground {
    let layer: HTMLElement | null = null
    let onBody = false
    let kept: { image: string; size: string; position: string; repeat: string } | null = null
    let shown: string | null = null
    /** The image as the layer serialised it after this wrote it; the mark of this module's own picture. */
    let written: string | null = null

    /** Whether the layer still carries this module's picture, or the host wrote its own meanwhile. */
    function stillOurs(): boolean {
        return !!layer && written !== null && layer.style.backgroundImage === written
    }

    /** The host changed the layer's image under this module's: its value is the one to put back, and said once. */
    function adoptHostChange(): void {
        if (!layer || !kept || written === null || stillOurs()) return
        kept = { ...kept, image: layer.style.backgroundImage }
        log(`[AdventureTime] location background: the host changed the image of ${describeElement(layer)} meanwhile; that is what a clear puts back now`)
    }

    function choose(): HTMLElement {
        if (layer && layer.isConnected) return layer
        const found = findBackgroundLayer(doc, view)
        onBody = !found
        layer = found ?? doc.body
        kept = { image: layer.style.backgroundImage, size: layer.style.backgroundSize, position: layer.style.backgroundPosition, repeat: layer.style.backgroundRepeat }
        log(found
            ? `[AdventureTime] location background: laid on the host's ${describeElement(found)}`
            : '[AdventureTime] location background: no background layer found on the page; laid on the body, which the host’s panes may cover')
        return layer
    }

    return {
        apply(src) {
            if (!src) { this.clear(); return }
            if (src === shown && layer?.isConnected && stillOurs()) return
            if (layer?.isConnected) adoptHostChange()
            const target = choose()
            const escaped = src.replace(/["\\\r\n]/g, '\\$&')
            target.style.backgroundImage = `url("${escaped}")`
            written = target.style.backgroundImage
            if (onBody) {
                target.style.backgroundSize = 'cover'
                target.style.backgroundPosition = 'center'
                target.style.backgroundRepeat = 'no-repeat'
            }
            shown = src
        },
        clear() {
            if (layer && kept) {
                // Only this module's own picture is taken off; the host's value stands.
                if (stillOurs()) {
                    layer.style.backgroundImage = kept.image
                    if (onBody) {
                        layer.style.backgroundSize = kept.size
                        layer.style.backgroundPosition = kept.position
                        layer.style.backgroundRepeat = kept.repeat
                    }
                } else if (written !== null) {
                    log(`[AdventureTime] location background: the host changed the image of ${describeElement(layer)} meanwhile; left as it is`)
                }
            }
            layer = null
            kept = null
            shown = null
            written = null
        },
    }
}
