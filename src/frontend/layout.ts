/**
 * The panel's layout (47b, 47c): which drawer tabs and floating widgets
 * exist, and what goes in them.
 *
 * Three layouts, chosen by the `layout` preference:
 *
 *   - **classic** — one tab, `AdventureTime`, holding everything in the order it
 *     has always had. The UI pass keeps this one untouched until the
 *     maintainer flips the preference, so the old and the new can be looked
 *     at side by side in one install.
 *   - **tabs** — the same tab holds the play parts (the tracker's head and
 *     cards, the map, the scene, the relationships) and a second tab,
 *     `AdventureTime settings`, holds the rest: the version line, the character
 *     creator and its folds, the agent, the world, the lore, and the
 *     settings with the cartridge buttons.
 *   - **widgets** — two floating boxes: the tracker (its head, its cards)
 *     and the map, the scene and the relationships as three tabs of one
 *     box; the one drawer tab holds the rest. Each box has a × that hides
 *     it and a button in the settings that brings it back; where it is
 *     dragged to, and the size its corner grip is dragged to (47c-bis:
 *     the host frames and moves a widget but offers no resize of its
 *     own, only `setSize`), are kept per install. The widgets need the `ui_panels`
 *     grant; without it the layout falls back to the two tabs and says so
 *     in the console, and the version line names the grant.
 *
 * The main tab is registered at once, so the icon is there before the
 * preference has been read; the panel is mounted when the read lands (a
 * local storage read, a few milliseconds), classic if it fails. A change of
 * the preference tears the panel down and mounts it again in the other
 * shape — the second tab and the widgets registered or destroyed with it.
 *
 * On a phone (91, the mobile pass) the two boxes are made hidden: the
 * host clamps each to the viewport less 12 px a side and lands both at
 * the same spot over the chat, so from the first paint the chat was
 * covered twice. The buttons that bring a box back stand at the top of
 * the drawer tab there, and a box shown on a phone is shown through the
 * host's own fullscreen mode (`setFullscreen`, which sizes it from the
 * host's keyboard-aware viewport), its × the way out; the fold, the grip
 * and the kept places are the desktop's and are left alone. *Phone* is
 * the host's one definition (`mobile.ts`), read once at mount.
 *
 * The one window (92, the maintainer's ask of 2026-11-05) is a fourth
 * layout, `one`, behind the `oneWindow` preference: the tracker and the
 * second box's three tabs as four tabs of one floating box. The host's
 * widget is a bare frame, so the tab row is ours — the Tracker button,
 * then the panel's own strip of three — and the box's strip and foot swap
 * with the pane shown by a class on the root the stylesheet reads. Its
 * place, size and fold are kept under its own name; on a phone it starts
 * hidden and opens full-screen from one button in the tab.
 *
 * The mobile widget (92f, the maintainer's ask of 2026-11-06, after Pocket's
 * launcher): on a phone a third float widget, 56 px square and chromeless
 * (the host's `chromeless` strips its frame), carrying the d20 on a disc of
 * the accent colour. It stands over the chat while the box is hidden and
 * opens the box full-screen on a tap; the box's × hides the box and the
 * disc comes back. The host drags it as it drags a box, so a tap that moved
 * is a drag, not a press; where it is dragged to is kept under `bubble`.
 * The `mobileWidget` preference, on as it ships, is the tick beside *Show
 * AdventureTime* in the drawer tab; off, the disc is taken down and the
 * button is the way in, as before 92f. In the two-box layout the disc
 * opens the Tracker widget.
 *
 * Nothing here touches the Spindle context: `frontend.ts` hands in the
 * things it needs, so this is tested against a fake.
 */

import type { PanelLayout, WidgetPositions, WidgetSizes } from '../backend/prefs-store.js'
import { MIN_WIDGET_SIZE } from '../protocol.js'

export interface LayoutTabOptions {
    id: string
    title: string
    shortName: string
    description: string
    keywords: string[]
    iconSvg: string
}

export interface LayoutTab {
    root: HTMLElement
    destroy(): void
}

export type WidgetName = 'tracker' | 'scene' | 'one'

/**
 * Which of the two box layouts the `oneWindow` preference asks for (92b):
 * `true` the one window and `false` the two boxes on every device; `null`,
 * as it ships, is automatic — the one window on a phone, where the box is a
 * full-screen page and two pages are one too many, the two boxes on a
 * desktop (the maintainer's decision of 2026-11-05). A tick pressed anywhere
 * writes `true` or `false` and settles it for every device of the install.
 */
export function layoutForOneWindow(oneWindow: unknown, phone: boolean): 'one' | 'widgets' {
    if (oneWindow === true) return 'one'
    if (oneWindow === false) return 'widgets'
    return phone ? 'one' : 'widgets'
}

export interface LayoutWidgetOptions {
    which: WidgetName | 'bubble'
    title: string
    width: number
    height: number
    initialPosition: { x: number; y: number }
    /** The host's frame stripped (92f): no border, background, shadow or rounding; the inside draws itself. */
    chromeless?: boolean
}

/** `ctx.ui.createFloatWidget`'s handle, narrowed. */
export interface LayoutWidget {
    root: HTMLElement
    setVisible(visible: boolean): void
    isVisible(): boolean
    onDragEnd(handler: (pos: { x: number; y: number }) => void): () => void
    /** The host sizes its frame; the inside follows. */
    setSize(width: number, height: number): void
    /** The host's fullscreen mode (91): the box anchored at the viewport's origin and sized to it. A host without it floats the box clamped, as before. */
    setFullscreen?(fullscreen: boolean): void
    isFullscreen?(): boolean
    destroy(): void
}

export interface LayoutPanel {
    refreshTracker(): void
    destroy(): void
}

export interface LayoutSlots {
    rest?: HTMLElement
    scene?: HTMLElement
    /** The tracker widget's strip under its title (57): the part that never scrolls, for the head's lights. */
    trackerHead?: HTMLElement
    /** The one window's place for the lights row (92e): its title row, seen from every pane. */
    trackerLights?: HTMLElement
    /** The tracker widget's foot under its body (74f): the part that never scrolls, for the XP bar at the bottom. */
    trackerFoot?: HTMLElement
    /** The second widget's strip and foot (78a): the tab strip, and the Lorebook Agent's footer. */
    sceneHead?: HTMLElement
    sceneFoot?: HTMLElement
    widgets?: LayoutWidgetControls
}

/** What the Layout box can do with the widgets (47c, 67). */
export interface LayoutWidgetControls {
    show(which: WidgetName): void
    /** Hide a box that shows, or bring back one hidden with its × (67). */
    toggle(which: WidgetName): void
    /**
     * Both boxes as a fresh install draws them (67, 67-bis): the kept
     * positions, sizes and folds forgotten and the boxes remade through the
     * host, which is the path every reload takes. 67 moved them with the
     * host's `moveTo`, and a box moved that way could not be dragged until
     * it was hidden and shown again.
     */
    reset(): void
    /** True in the one window (92): one box, one toggle, one button in the tab. */
    one?: boolean
    /** The mobile widget (92f): make the disc over the chat, or take it down, as the tick moves. Only a phone has one to make. */
    mobileWidget?(on: boolean): void
}

export type WidgetMinimized = Record<string, boolean>

export interface LayoutRead {
    layout: PanelLayout
    positions: WidgetPositions
    sizes: WidgetSizes
    /** Which widgets start folded to their heads (57). */
    minimized?: WidgetMinimized
    /** The mobile widget (92f): the disc over the chat on a phone. Absent reads as on, as the preference ships. */
    mobileWidget?: boolean
}

export interface LayoutHost {
    /** `ctx.ui.registerDrawerTab`, narrowed. */
    registerTab(options: LayoutTabOptions): LayoutTab
    /** `ctx.ui.createFloatWidget`, narrowed. May throw: the grant missing, the cap reached. */
    createWidget(options: LayoutWidgetOptions): LayoutWidget
    /** `mountPanel`, with the other roots when there are any. */
    mount(root: HTMLElement, slots: LayoutSlots): LayoutPanel
    /** The preference and the widgets' places, read once at start. Rejects or resolves; never hangs. */
    readLayout(): Promise<LayoutRead>
    /** Keep where the widgets are. Best effort; nothing waits on it. */
    savePositions(positions: WidgetPositions): void
    /** Keep how big the widgets are. Best effort, like the positions. */
    saveSizes(sizes: WidgetSizes): void
    /** Keep which widgets are folded (57). Best effort, like the sizes. */
    saveMinimized(minimized: WidgetMinimized): void
    /** Called with the new layout whenever the preferences change. */
    onLayoutChange(handler: (layout: PanelLayout) => void): () => void
    /** The host's test for a phone (91, `isMobileViewportOrDevice`), read once at each mount. Absent, the desktop path. */
    isMobile?(): boolean
    /** The viewport's size (92f), for where the disc first stands. Absent, a far corner the host clamps. */
    viewport?(): { width: number; height: number }
}

export interface Layout {
    /** The layout on screen now, or `null` before the first read lands. */
    current(): PanelLayout | null
    refreshTracker(): void
    destroy(): void
}

/** Tab icon: a d20, which is as close to a mission statement as this gets. */
export const MAIN_ICON_SVG = `
<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
     stroke-width="1.6" stroke-linejoin="round">
  <path d="M12 2 21 7.2v9.6L12 22 3 16.8V7.2z"/>
  <path d="M12 2 7.4 9.6h9.2z"/>
  <path d="M7.4 9.6 12 22l4.6-12.4z"/>
  <path d="M3 7.2h4.4M21 7.2h-4.4M3 16.8l4.4-7.2M21 16.8l-4.4-7.2"/>
</svg>`

/** The second tab's icon: a cog. */
export const SETTINGS_ICON_SVG = `
<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
     stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">
  <circle cx="12" cy="12" r="3.2"/>
  <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>
</svg>`

export const MAIN_TAB: LayoutTabOptions = {
    id: 'adventure_time',
    title: 'AdventureTime',
    shortName: 'AdventureTime',
    description: 'Multihog D&D Framework — tracker, lorebook agent, and game cartridges',
    keywords: ['multihog', 'adventure_time', 'dnd', 'rpg', 'tracker', 'cartridge', 'lorebook'],
    iconSvg: MAIN_ICON_SVG,
}

export const SETTINGS_TAB: LayoutTabOptions = {
    id: 'adventuretime-settings',
    title: 'AdventureTime settings',
    shortName: 'LH setup',
    description: 'AdventureTime — the character creator, the lorebook agent, the world, and the settings',
    keywords: ['multihog', 'adventure_time', 'settings', 'cartridge', 'creator', 'agent', 'world'],
    iconSvg: SETTINGS_ICON_SVG,
}

/** The widgets' sizes and the places they start, before anyone drags them. */
export const WIDGETS: Record<WidgetName, Omit<LayoutWidgetOptions, 'which'>> = {
    tracker: { title: 'AdventureTime — Tracker', width: 520, height: 620, initialPosition: { x: 24, y: 80 } },
    scene: { title: 'AdventureTime — Lore', width: 460, height: 520, initialPosition: { x: 560, y: 80 } },
    one: { title: 'AdventureTime', width: 560, height: 680, initialPosition: { x: 24, y: 80 } },
}

export type WidgetSize = { width: number; height: number }

/** The mobile widget (92f): the disc's side, Pocket's launcher is 58; and its margins from the viewport's right and bottom edges, the bottom one clear of the host's input bar. */
export const BUBBLE_SIZE = 56
export const BUBBLE_MARGIN = { right: 16, bottom: 96 }
/** Where the disc first stands (92f): the bottom-right corner, over the input bar; a far corner the host clamps when the viewport is not known. */
export function bubblePosition(viewport: { width: number; height: number } | undefined): { x: number; y: number } {
    if (!viewport) return { x: 9999, y: 9999 }
    return { x: Math.max(0, viewport.width - BUBBLE_SIZE - BUBBLE_MARGIN.right), y: Math.max(0, viewport.height - BUBBLE_SIZE - BUBBLE_MARGIN.bottom) }
}
/** A tap on the disc that moved this far is a drag, not a press (92f). */
export const BUBBLE_TAP_SLOP = 8

/** A folded box's height when its head cannot be measured (57): room for the title row and a strip. */
export const MINIMIZED_HEIGHT_FLOOR = 36
/** Room under a folded box's head (57-bis), so the strip's last row is not cut by a rounded frame. */
export const MINIMIZED_ALLOWANCE = 6

/** What the grip does with a drag: apply a size while it goes, keep it when it ends. */
interface Resize {
    size: WidgetSize
    apply(size: WidgetSize): void
    done(size: WidgetSize): void
}

/** What the fold button does (57): the size to come back to, and where the state is kept. */
interface Fold {
    current(): WidgetSize
    changed(minimized: boolean): void
}

/** A widget's furniture as `dress` leaves it (57): the strip for a head that must not scroll, the body, and the fold's control. */
export interface Dressed {
    /** The title row: the name, the fold button and ×; the one window puts its lights row in it (92e). */
    head: HTMLElement
    strip: HTMLElement
    body: HTMLElement
    /** The foot under the body (74f), hidden with the body on a folded box. */
    foot: HTMLElement
    /** Fold or unfold the box now; used at mount for a box read as folded. */
    setMinimized(minimized: boolean): void
    /** Put a part into the title row, after the name and before the fold button (92e). */
    intoHead(part: HTMLElement): void
}

/** A dragged size, floored so the head and a card stay readable. */
export function clampSize(width: number, height: number): WidgetSize {
    return {
        width: Math.max(MIN_WIDGET_SIZE.width, Math.round(width)),
        height: Math.max(MIN_WIDGET_SIZE.height, Math.round(height)),
    }
}

/**
 * The grip in a box's bottom-right corner (47c-bis). The host offers no
 * resize of its own for a float widget, only `setSize`, so the grip is
 * ours: a press on it takes the pointer, every move sets the size to the
 * starting size plus the distance moved, and the release keeps it. The
 * press is stopped from bubbling so the host's own drag does not move
 * the box while its corner is pulled.
 */
function grip(root: HTMLElement, resize: Resize): HTMLElement {
    const doc = root.ownerDocument
    const handle = doc.createElement('div')
    handle.className = 'lh-widget-grip'
    handle.title = 'Drag to resize this box'
    let size = resize.size
    handle.addEventListener('pointerdown', (down: PointerEvent) => {
        down.preventDefault()
        down.stopPropagation()
        const from = size
        const startX = down.clientX
        const startY = down.clientY
        const move = (event: PointerEvent): void => {
            size = clampSize(from.width + (event.clientX - startX), from.height + (event.clientY - startY))
            resize.apply(size)
        }
        const up = (): void => {
            doc.removeEventListener('pointermove', move)
            doc.removeEventListener('pointerup', up)
            doc.removeEventListener('pointercancel', up)
            resize.done(size)
        }
        doc.addEventListener('pointermove', move)
        doc.addEventListener('pointerup', up)
        doc.addEventListener('pointercancel', up)
    })
    return handle
}

/**
 * The host's frame around a widget's root (47c-ter): the nearest ancestor
 * the host positions, which is the element it drags. The root itself when
 * nothing above it is positioned (a test, or a host that changed shape).
 */
export function frameOf(root: HTMLElement): HTMLElement {
    const view = root.ownerDocument.defaultView
    for (let el = root.parentElement; el; el = el.parentElement) {
        const position = el.style.position || (view ? view.getComputedStyle(el).position : '')
        if (position === 'fixed' || position === 'absolute') return el
    }
    return root
}

/**
 * Where two boxes part (47c-quater): the two children of their deepest
 * common ancestor, one on each side. Whatever the host wraps a box in,
 * which box is on top is decided between these two, since everything
 * under a box is inside its own one; the frame found by `frameOf` was
 * an inner wrapper on the live host, and a `z-index` set there ordered
 * nothing. Null while the roots are not both in one document, or one
 * holds the other.
 */
export function layersOf(a: HTMLElement, b: HTMLElement): [HTMLElement, HTMLElement] | null {
    const chain = (el: HTMLElement | null): HTMLElement[] => {
        const out: HTMLElement[] = []
        for (; el; el = el.parentElement) out.push(el)
        return out
    }
    const chainA = chain(a)
    const chainB = chain(b)
    let i = chainA.length - 1
    let j = chainB.length - 1
    if (chainA[i] !== chainB[j]) return null
    while (i > 0 && j > 0 && chainA[i - 1] === chainB[j - 1]) { i -= 1; j -= 1 }
    if (i === 0 || j === 0) return null
    return [chainA[i - 1], chainB[j - 1]]
}

/** The press events a drag can start from; stopped in the body so the host's drag does not take a field's press. */
const PRESS_EVENTS = ['pointerdown', 'mousedown', 'touchstart'] as const
/**
 * What a press in a box's strip or foot belongs to (92): a control keeps its
 * press, as the body keeps every press (47c-ter); a press on the strip's or
 * the foot's own ground goes through to the host, which drags the box by it.
 * A folded box is mostly strip, and its title row alone was hard to find.
 */
const PRESS_TARGETS = 'button, input, select, textarea, label, a, summary, [role="button"], [role="tab"], [role="slider"], [role="textbox"], [contenteditable]'

/**
 * A widget's furniture: a head with the title, a – that folds the box to
 * its head and a × that hides it; a strip under the head that never
 * scrolls (57), for the tracker's lights; the body the panel draws into;
 * and the grip that resizes it. The host draws the frame and the drag.
 *
 * Folded (57), the body and the grip are hidden and the host's frame is
 * set to the head's height — the title row and the strip, measured, with
 * a floor for a box not yet laid out — so the tracker's lights stay in
 * view on a box folded away; unfolded, the kept size comes back. The
 * state is kept per install, like the size. The host's frame has chrome
 * of its own around the root (57-bis: the first try cut the strip's
 * button row and left the title at the top of a taller frame), so the
 * frame is sized to the head plus the chrome — the kept height less the
 * root's measured height while unfolded — and a moment after each fold
 * the root's own overflow is read and the frame grown by what is cut.
 * What is left over, a frame the host will not make smaller, centres the
 * head.
 *
 * The body shields its presses from the host (47c-ter): the host's drag
 * handler took every press on the box, and a press it took is a press
 * that never focused a text field, opened a dropdown or stepped a number,
 * while a checkbox or a fold, which act on the click after, still worked.
 * So a press inside the body stops at the body and the host sees only the
 * head's, which is the drag handle, as it is on every window. Nothing is
 * prevented, so the field gets its press.
 */
function dress(widget: LayoutWidget, title: string, onHide: () => void, resize: Resize, fold: Fold): Dressed {
    const root = widget.root
    root.classList.add('lh-widget', 'adventuretime-panel')
    const head = root.ownerDocument.createElement('div')
    head.className = 'lh-widget-head'
    const name = root.ownerDocument.createElement('span')
    name.className = 'lh-widget-head-title'
    name.textContent = title
    const minimize = root.ownerDocument.createElement('button')
    minimize.type = 'button'
    minimize.className = 'lh-widget-minimize'
    const hide = root.ownerDocument.createElement('button')
    hide.type = 'button'
    hide.className = 'lh-widget-hide'
    hide.textContent = '×'
    hide.title = 'Hide this box. The settings tab has a button that brings it back.'
    hide.setAttribute('aria-label', 'Hide')
    hide.addEventListener('click', onHide)
    head.append(name, minimize, hide)
    const strip = root.ownerDocument.createElement('div')
    strip.className = 'lh-widget-strip'
    const body = root.ownerDocument.createElement('div')
    body.className = 'lh-widget-body'
    // The foot (74f): under the body, never scrolling, for the XP bar at the bottom.
    const foot = root.ownerDocument.createElement('div')
    foot.className = 'lh-widget-foot'
    // The strip holds buttons too (the tracker's), so a press on one of them is shielded as the body's
    // presses are; a press on the strip's or the foot's own ground is the host's, to drag by (92).
    const shield = (event: Event): void => {
        const target = event.target as Element | null
        if (target && typeof target.closest === 'function' && target.closest(PRESS_TARGETS)) event.stopPropagation()
    }
    for (const type of PRESS_EVENTS) {
        body.addEventListener(type, (event) => { event.stopPropagation() })
        strip.addEventListener(type, shield)
        foot.addEventListener(type, shield)
    }
    const handle = grip(root, resize)
    root.append(head, strip, body, foot, handle)
    /** Where a part goes into the title row: before the fold button, after the name (92e). */
    const intoHead = (part: HTMLElement): void => { head.insertBefore(part, minimize) }

    let minimized = false
    /** The host's frame beyond the root, measured while unfolded; nothing until a layout has happened. */
    let chrome = 0
    const measureChrome = (): void => {
        if (minimized) return
        const inner = root.getBoundingClientRect().height
        const outer = fold.current().height
        if (inner > 0 && outer > inner) chrome = Math.round(outer - inner)
    }
    const headHeight = (): number => {
        const measured = head.getBoundingClientRect().height + strip.getBoundingClientRect().height
        return Math.max(MINIMIZED_HEIGHT_FLOOR, Math.round(measured) + chrome + MINIMIZED_ALLOWANCE)
    }
    let folded = 0
    /** Grow a folded frame by what the root cannot show (57-bis); nothing to read before a layout. */
    const trim = (): void => {
        if (!minimized) return
        const cut = root.scrollHeight - root.clientHeight
        if (cut > 0 && root.clientHeight > 0) {
            folded += cut
            widget.setSize(fold.current().width, folded)
        }
    }
    const draw = (): void => {
        root.classList.toggle('lh-widget--minimized', minimized)
        body.hidden = minimized
        foot.hidden = minimized
        handle.hidden = minimized
        minimize.textContent = minimized ? '+' : '–'
        minimize.title = minimized ? 'Open this box again' : 'Fold this box to its head'
        minimize.setAttribute('aria-label', minimized ? 'Unfold' : 'Fold')
    }
    const apply = (): void => {
        const size = fold.current()
        if (minimized) {
            folded = headHeight()
            widget.setSize(size.width, folded)
            setTimeout(trim, 50)
        } else {
            widget.setSize(size.width, size.height)
        }
    }
    const setMinimized = (next: boolean): void => {
        measureChrome()
        minimized = next
        draw()
        apply()
    }
    minimize.addEventListener('click', () => {
        setMinimized(!minimized)
        fold.changed(minimized)
    })
    draw()
    // A folded frame follows its head (92): the strip changes height after the fold — its buttons wrap as
    // the frame narrows, the lights fill in — and a frame measured before that clipped the title row
    // (the try of beta.14: a folded box with its head pushed off the top and no + to reach). The frame
    // is sized again whenever the head or the strip changes size while folded; nothing on a host without
    // the observer, where the one measure after the fold stands as before.
    const view = root.ownerDocument.defaultView
    if (view && typeof view.ResizeObserver === 'function') {
        const observer = new view.ResizeObserver(() => { if (minimized && headHeight() !== folded) apply() })
        observer.observe(head)
        observer.observe(strip)
    }
    // A box read as folded is folded by the mount, once the strip is filled (a mutation found a fold here redundant).
    return { head, strip, body, foot, setMinimized, intoHead }
}

/**
 * The box last pressed goes on top (47c-ter, 47c-quater). The host gives
 * no call for it, so this sets `z-index` directly on the two layers where
 * the boxes part: the pressed box one above the base, the other at it,
 * where the base is what the host gave the layer, read once. Never more
 * than one above, so the host's own overlays keep their place. A layer
 * the host left unpositioned is given `position: relative`, since
 * `z-index` orders nothing else. The layers are found at each raise, not
 * at mount: the roots may not be in the document yet when the widgets
 * are made, and a host may re-wrap them; `frameOf` is the fallback for
 * roots that are not in one tree.
 */
type TwoBoxes = 'tracker' | 'scene'
function stacking(roots: Record<TwoBoxes, HTMLElement>): (which: TwoBoxes) => void {
    let base: number | null = null
    let said = false
    return (which) => {
        const found = layersOf(roots.tracker, roots.scene)
        const layers: Record<TwoBoxes, HTMLElement> = found
            ? { tracker: found[0], scene: found[1] }
            : { tracker: frameOf(roots.tracker), scene: frameOf(roots.scene) }
        const view = layers.tracker.ownerDocument.defaultView
        if (base === null) {
            const read = layers.tracker.style.zIndex || (view ? view.getComputedStyle(layers.tracker).zIndex : '')
            const parsed = Number.parseInt(read, 10)
            base = Number.isFinite(parsed) ? parsed : 0
        }
        if (!said) {
            said = true
            const describe = (el: HTMLElement): string => `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).trim().replace(/\s+/g, '.') : ''}`
            console.debug(`[AdventureTime] the widgets are layered at ${describe(layers.tracker)} and ${describe(layers.scene)} (${found ? 'where they part' : 'their frames'}), base z-index ${base}`)
        }
        for (const name of ['tracker', 'scene'] as const) {
            const layer = layers[name]
            const position = layer.style.position || (view ? view.getComputedStyle(layer).position : '')
            if (!position || position === 'static') layer.style.position = 'relative'
            layer.style.zIndex = String(name === which ? base + 1 : base)
        }
    }
}

export function createLayout(host: LayoutHost): Layout {
    const main = host.registerTab(MAIN_TAB)
    let settings: LayoutTab | null = null
    let widgets: Partial<Record<WidgetName, LayoutWidget>> = {}
    let dragOffs: Array<() => void> = []
    let panel: LayoutPanel | null = null
    let layout: PanelLayout | null = null
    let positions: WidgetPositions = {}
    let sizes: WidgetSizes = {}
    let minimized: WidgetMinimized = {}
    /** The mobile widget (92f): the disc over the chat on a phone, and whether the tick wants one. */
    let bubble: LayoutWidget | null = null
    let bubbleWanted = true
    let destroyed = false

    function unmount(): void {
        panel?.destroy()
        panel = null
        settings?.destroy()
        settings = null
        for (const off of dragOffs) off()
        dragOffs = []
        for (const widget of Object.values(widgets)) widget?.destroy()
        widgets = {}
        bubble?.destroy()
        bubble = null
    }

    /**
     * The mobile widget (92f): a chromeless float widget the size of a
     * button, the d20 on a disc, over the chat while every box is hidden.
     * A tap opens the box; the host's drag moves it, and a press that moved
     * more than the slop is the drag's, not a tap. Its place is kept under
     * `bubble`. Nothing when the host refuses, with the reason in the
     * console: the drawer tab's button is the way in then, as before.
     */
    function mountBubble(open: () => void): void {
        if (bubble || destroyed) return
        let widget: LayoutWidget
        try {
            widget = host.createWidget({ which: 'bubble', title: 'Show AdventureTime', width: BUBBLE_SIZE, height: BUBBLE_SIZE, chromeless: true, initialPosition: positions.bubble ?? bubblePosition(host.viewport?.()) })
        } catch (error) {
            console.warn('[AdventureTime] the mobile widget could not be made; the Show AdventureTime button in the tab is the way in', error)
            return
        }
        bubble = widget
        const root = widget.root
        root.classList.add('lh-bubble', 'adventuretime-panel')
        root.setAttribute('role', 'button')
        root.setAttribute('tabindex', '0')
        root.setAttribute('aria-label', 'Show AdventureTime')
        root.title = 'Show AdventureTime. Drag to move it.'
        root.innerHTML = MAIN_ICON_SVG
        // A press records where it began; the click after it opens the box only if the pointer stayed put,
        // since the host moves the disc by the same press and fires the click at the drag's end.
        let pressed: { x: number; y: number } | null = null
        root.addEventListener('pointerdown', (event: PointerEvent) => { pressed = { x: event.clientX, y: event.clientY } }, true)
        root.addEventListener('click', (event: MouseEvent) => {
            const from = pressed
            pressed = null
            if (from && (Math.abs(event.clientX - from.x) > BUBBLE_TAP_SLOP || Math.abs(event.clientY - from.y) > BUBBLE_TAP_SLOP)) return
            open()
        })
        root.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            open()
        })
        dragOffs.push(widget.onDragEnd((pos) => {
            positions = { ...positions, bubble: { x: Math.round(pos.x), y: Math.round(pos.y) } }
            host.savePositions(positions)
        }))
        syncBubble()
    }
    /** The disc stands while no box shows (92f): a box opened full-screen would be covered by it otherwise. */
    function syncBubble(): void {
        if (!bubble) return
        const anyShown = Object.values(widgets).some((widget) => widget?.isVisible())
        bubble.setVisible(!anyShown)
    }
    /** The tick's hand on the disc (92f): wanted and on a phone, made; unwanted, taken down. */
    function setBubble(on: boolean, phone: boolean, open: () => void): void {
        bubbleWanted = on
        if (!on) {
            bubble?.destroy()
            bubble = null
            return
        }
        if (phone) mountBubble(open)
    }

    function mountTabs(): void {
        settings = host.registerTab(SETTINGS_TAB)
        panel = host.mount(main.root, { rest: settings.root })
    }

    /** What a box's grip does (47c-bis): the kept size, by the box's name; nothing kept from a phone (91). */
    const makeResize = (which: WidgetName, widget: LayoutWidget, phone: boolean): Resize => ({
        size: sizes[which] ?? { width: WIDGETS[which].width, height: WIDGETS[which].height },
        apply: (size) => { widget.setSize(size.width, size.height) },
        done: (size) => {
            // The grip is hidden on a phone (91) and the host sizes a fullscreen box; the kept sizes are the desktop's.
            if (phone) return
            sizes = { ...sizes, [which]: size }
            host.saveSizes(sizes)
        },
    })
    /** What a box's fold does (57): the size to come back to, and the state kept by the box's name. */
    const makeFold = (which: WidgetName): Fold => ({
        current: () => sizes[which] ?? { width: WIDGETS[which].width, height: WIDGETS[which].height },
        changed: (next) => {
            minimized = { ...minimized, [which]: next }
            host.saveMinimized(minimized)
        },
    })

    /** The two widgets and the panel across them. False when the host refused a widget. */
    function mountWidgets(): boolean {
        const made: Partial<Record<WidgetName, LayoutWidget>> = {}
        // A phone (91): the host's one test, read once here as its components read it at render.
        const phone = host.isMobile?.() === true
        try {
            for (const which of ['tracker', 'scene'] as const) {
                const spec = WIDGETS[which]
                const size = sizes[which] ?? { width: spec.width, height: spec.height }
                made[which] = host.createWidget({ which, ...spec, ...size, initialPosition: positions[which] ?? spec.initialPosition })
            }
        } catch (error) {
            for (const widget of Object.values(made)) widget?.destroy()
            console.error('[AdventureTime] the floating widgets could not be made; the two tabs are drawn instead. Is the ui_panels permission granted?', error)
            return false
        }
        widgets = made
        const tracker = made.tracker as LayoutWidget
        const scene = made.scene as LayoutWidget
        const resize = (which: WidgetName, widget: LayoutWidget): Resize => makeResize(which, widget, phone)
        const fold = makeFold
        const trackerDress = dress(tracker, WIDGETS.tracker.title, () => { tracker.setVisible(false); syncBubble() }, resize('tracker', tracker), fold('tracker'))
        const sceneDress = dress(scene, WIDGETS.scene.title, () => { scene.setVisible(false); syncBubble() }, resize('scene', scene), fold('scene'))
        const trackerBody = trackerDress.body
        const sceneBody = sceneDress.body
        const raise = stacking({ tracker: tracker.root, scene: scene.root })
        for (const which of ['tracker', 'scene'] as const) {
            // Capture, so the raise comes before anything in the box stops the press.
            made[which]!.root.addEventListener('pointerdown', () => { raise(which) }, true)
            made[which]!.root.addEventListener('focusin', () => { raise(which) })
        }
        for (const which of ['tracker', 'scene'] as const) {
            dragOffs.push(made[which]!.onDragEnd((pos) => {
                // A fullscreen box is anchored by the host (91); a place it reports on a phone is not the desktop's to keep.
                if (phone) return
                positions = { ...positions, [which]: { x: Math.round(pos.x), y: Math.round(pos.y) } }
                host.savePositions(positions)
            }))
        }
        /**
         * Show a box (91): on a phone through the host's fullscreen mode first,
         * so it never lands clamped over the chat; the host's × and ours are
         * the way out. A host without the mode floats it clamped, as before.
         */
        const reveal = (which: WidgetName): void => {
            if (which === 'one') return
            const widget = widgets[which]
            if (!widget) return
            if (phone && widget.setFullscreen && widget.isFullscreen?.() !== true) widget.setFullscreen(true)
            widget.setVisible(true)
            raise(which)
            syncBubble()
        }
        if (phone) {
            // Both boxes start hidden on a phone (91): the chat is the first thing a phone shows, and the
            // buttons at the top of the drawer tab bring either box up. The class hides the fold and the grip.
            for (const which of ['tracker', 'scene'] as const) {
                made[which]!.root.classList.add('lh-widget--phone')
                made[which]!.setVisible(false)
            }
        }
        panel = host.mount(trackerBody, {
            rest: main.root,
            scene: sceneBody,
            trackerHead: trackerDress.strip,
            trackerFoot: trackerDress.foot,
            sceneHead: sceneDress.strip,
            sceneFoot: sceneDress.foot,
            widgets: {
                show: (which) => { reveal(which) },
                toggle: (which) => {
                    const widget = widgets[which]
                    if (!widget) return
                    if (widget.isVisible()) { widget.setVisible(false); syncBubble() }
                    else reveal(which)
                },
                reset: () => { reset() },
                mobileWidget: (on) => { setBubble(on, phone, () => { reveal('tracker') }) },
            },
        })
        // The mobile widget (92f): on a phone, the disc over the chat opens the Tracker widget.
        if (phone && bubbleWanted) mountBubble(() => { reveal('tracker') })
        // A box read as folded was sized before the panel filled its strip (57):
        // measure again now the lights are in it, and once more when the host
        // has laid the frame out, so the strip is not clipped on a reload.
        const dressed = { tracker: trackerDress, scene: sceneDress }
        const refold = (): void => {
            // A fold kept on the desktop is left there (91): a phone's box is a page, with no head to fold to.
            if (destroyed || phone) return
            for (const which of ['tracker', 'scene'] as const) if (minimized[which] === true) dressed[which].setMinimized(true)
        }
        refold()
        setTimeout(refold, 50)
        return true
    }

    /**
     * The one window (92, the maintainer's ask of 2026-11-05): the tracker
     * and the second box's three tabs as four tabs of one floating box. The
     * host's widget is a bare frame, so the tab row is ours — the Tracker
     * button first, then the panel's own strip of three (`tabbed`, placed in
     * `sceneHead`) — and the box's strip and foot swap with the pane shown:
     * the tracker's lights row, XP bar and footer with the tracker pane, the
     * agent's footer with the other three, by a class on the root the
     * stylesheet reads. A press on one of the panel's three tabs is also the
     * move to the second pane. The panes carry their own font-size classes,
     * since the two roots share the box (`sizeRoot`); the tab row takes the
     * Tracker widget's size whole (92d, the maintainer's ask of 2026-11-06:
     * the four names at one size, whatever the panes are set to — the agent's
     * size sized the three and the host's the first before it); and the box
     * wears the tracker's backdrop. On a phone the box starts hidden and opens
     * full-screen from one button in the tab (91's path), its tabs drawn as
     * icons by the stylesheet's phone block. False when the host refused.
     */
    function mountOne(): boolean {
        const phone = host.isMobile?.() === true
        const spec = WIDGETS.one
        let widget: LayoutWidget
        try {
            const size = sizes.one ?? { width: spec.width, height: spec.height }
            widget = host.createWidget({ which: 'one', ...spec, ...size, initialPosition: positions.one ?? spec.initialPosition })
        } catch (error) {
            console.error('[AdventureTime] the one window could not be made; the two tabs are drawn instead. Is the ui_panels permission granted?', error)
            return false
        }
        widgets = { one: widget }
        const dressed = dress(widget, spec.title, () => { widget.setVisible(false); syncBubble() }, makeResize('one', widget, phone), makeFold('one'))
        const root = widget.root
        const doc = root.ownerDocument
        const make = (className: string): HTMLElement => {
            const element = doc.createElement('div')
            element.className = className
            return element
        }
        const tabs = make('lh-one-tabs lh-size-tracker')
        tabs.setAttribute('role', 'tablist')
        const trackerTab = doc.createElement('button')
        trackerTab.type = 'button'
        trackerTab.className = 'lh-widget-tab'
        trackerTab.setAttribute('role', 'tab')
        trackerTab.setAttribute('data-lh-tab', 'tracker')
        trackerTab.setAttribute('data-lh-icon', '🎲')
        trackerTab.setAttribute('data-lh-short', 'Tracker')
        trackerTab.setAttribute('aria-label', 'Tracker')
        trackerTab.title = 'Tracker'
        const trackerTabText = doc.createElement('span')
        trackerTabText.className = 'lh-widget-tab-text'
        trackerTabText.textContent = 'Tracker'
        trackerTab.append(trackerTabText)
        const sceneTabs = make('lh-one-scene-tabs')
        tabs.append(trackerTab, sceneTabs)
        const trackerHead = make('lh-one-tracker-head lh-one-tracker-only lh-size-tracker')
        dressed.strip.append(tabs, trackerHead)
        // The lights row in the title row (92e, the maintainer's ask of 2026-11-06): seen from every pane,
        // with the day/night badge; the buttons and *Last run:* stay in the strip with the Tracker pane.
        const headLights = make('lh-one-head-lights lh-size-tracker')
        dressed.intoHead(headLights)
        root.querySelector('.lh-widget-head')?.classList.add('lh-widget-head--lights')
        const trackerPane = make('lh-one-pane lh-one-tracker-only')
        const scenePane = make('lh-one-pane lh-one-scene-only')
        dressed.body.append(trackerPane, scenePane)
        const trackerFoot = make('lh-one-tracker-only lh-size-tracker')
        const sceneFoot = make('lh-one-scene-only lh-size-agent')
        dressed.foot.append(trackerFoot, sceneFoot)
        const show = (pane: 'tracker' | 'scene'): void => {
            root.classList.toggle('lh-one--tracker', pane === 'tracker')
            root.classList.toggle('lh-one--scene', pane === 'scene')
            trackerTab.classList.toggle('lh-widget-tab--active', pane === 'tracker')
            trackerTab.setAttribute('aria-selected', pane === 'tracker' ? 'true' : 'false')
        }
        trackerTab.addEventListener('click', () => { show('tracker') })
        sceneTabs.addEventListener('click', (event) => {
            const target = event.target as Element | null
            if (target && typeof target.closest === 'function' && target.closest('.lh-widget-tab')) show('scene')
        })
        show('tracker')
        dragOffs.push(widget.onDragEnd((pos) => {
            if (phone) return
            positions = { ...positions, one: { x: Math.round(pos.x), y: Math.round(pos.y) } }
            host.savePositions(positions)
        }))
        const reveal = (): void => {
            if (phone && widget.setFullscreen && widget.isFullscreen?.() !== true) widget.setFullscreen(true)
            widget.setVisible(true)
            syncBubble()
        }
        if (phone) {
            root.classList.add('lh-widget--phone')
            widget.setVisible(false)
        }
        panel = host.mount(trackerPane, {
            rest: main.root,
            scene: scenePane,
            trackerHead,
            trackerLights: headLights,
            trackerFoot,
            sceneHead: sceneTabs,
            sceneFoot,
            widgets: {
                one: true,
                show: () => { reveal() },
                toggle: () => {
                    if (widget.isVisible()) { widget.setVisible(false); syncBubble() }
                    else reveal()
                },
                reset: () => { reset() },
                mobileWidget: (on) => { setBubble(on, phone, reveal) },
            },
        })
        // The mobile widget (92f): on a phone, the disc over the chat opens the window.
        if (phone && bubbleWanted) mountBubble(reveal)
        const refold = (): void => {
            if (destroyed || phone) return
            if (minimized.one === true) dressed.setMinimized(true)
        }
        refold()
        setTimeout(refold, 50)
        return true
    }

    /** The widgets as a fresh install draws them (67-bis): forget what was kept, and remake them. */
    function reset(): void {
        positions = {}
        sizes = {}
        minimized = {}
        host.savePositions(positions)
        host.saveSizes(sizes)
        host.saveMinimized(minimized)
        if (destroyed || (layout !== 'widgets' && layout !== 'one')) return
        const wanted = layout
        unmount()
        if (!(wanted === 'one' ? mountOne() : mountWidgets())) {
            layout = 'tabs'
            mountTabs()
        }
    }

    function apply(next: PanelLayout): void {
        if (destroyed || next === layout) return
        unmount()
        layout = next
        if (next === 'tabs') {
            mountTabs()
        } else if (next === 'widgets' || next === 'one') {
            if (!(next === 'one' ? mountOne() : mountWidgets())) {
                layout = 'tabs'
                mountTabs()
            }
        } else {
            panel = host.mount(main.root, {})
        }
    }

    // A value that is not one of the four reads as classic. The backend's
    // default is the widgets (47f); classic here is for a read that fails,
    // where nothing is known and the one tab is the shape that needs no grant.
    const read = (value: unknown): PanelLayout => (value === 'tabs' || value === 'widgets' || value === 'one' ? value : 'classic')

    host.readLayout()
        .then((result) => {
            positions = result.positions ?? {}
            sizes = result.sizes ?? {}
            minimized = result.minimized ?? {}
            bubbleWanted = result.mobileWidget !== false
            apply(read(result.layout))
        })
        .catch(() => { apply('classic') })

    const unsubscribe = host.onLayoutChange((next) => { apply(read(next)) })

    return {
        current: () => layout,
        refreshTracker(): void {
            panel?.refreshTracker()
        },
        destroy(): void {
            destroyed = true
            unsubscribe()
            unmount()
            main.destroy()
        },
    }
}
