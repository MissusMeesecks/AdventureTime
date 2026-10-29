// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MIN_WIDGET_SIZE } from '../protocol.js'
import { clampSize, createLayout, frameOf, layersOf, MAIN_TAB, MINIMIZED_ALLOWANCE, MINIMIZED_HEIGHT_FLOOR, SETTINGS_TAB, WIDGETS, type LayoutHost, type LayoutPanel, type LayoutSlots, type LayoutTab, type LayoutWidget } from './layout.js'

/** Let the preference read land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

type Read = 'classic' | 'tabs' | 'widgets' | 'fail'

type Size = { width: number; height: number }

function makeHost(layout: Read = 'classic', options: { positions?: Record<string, { x: number; y: number }>; sizes?: Record<string, Size>; minimized?: Record<string, boolean>; refuseWidgets?: boolean } = {}) {
    const tabs: Array<{ id: string; tab: LayoutTab; destroyed: boolean }> = []
    const widgets: Array<{ which: string; title: string; initialPosition: { x: number; y: number }; size: Size; sized: Size[]; widget: LayoutWidget; visible: boolean; destroyed: boolean; drag: ((pos: { x: number; y: number }) => void) | null }> = []
    const mounts: Array<{ root: HTMLElement; slots: LayoutSlots; panel: LayoutPanel; destroyed: boolean; refreshed: number }> = []
    const saved: Array<Record<string, { x: number; y: number }>> = []
    const savedSizes: Array<Record<string, Size>> = []
    const savedMinimized: Array<Record<string, boolean>> = []
    const hostLayers = document.createElement('div')
    document.body.append(hostLayers)
    let handler: ((layout: 'classic' | 'tabs' | 'widgets') => void) | null = null
    let unsubscribed = 0

    const host: LayoutHost = {
        registerTab(opts) {
            const entry = { id: opts.id, destroyed: false, tab: null as unknown as LayoutTab }
            entry.tab = { root: document.createElement('div'), destroy: () => { entry.destroyed = true } }
            tabs.push(entry)
            return entry.tab
        },
        createWidget(opts) {
            if (options.refuseWidgets) throw new Error('PERMISSION_DENIED: ui_panels')
            const entry = { which: opts.which, title: opts.title, initialPosition: opts.initialPosition, size: { width: opts.width, height: opts.height }, sized: [] as Size[], visible: true, destroyed: false, drag: null as ((pos: { x: number; y: number }) => void) | null, widget: null as unknown as LayoutWidget }
            // The host's layering, as the live host has it (47c-quater): a layer
            // per box under one parent, and inside it a positioned inner wrapper
            // around the root, which is the frame `frameOf` finds and the wrong
            // place for a z-index.
            const frame = document.createElement('div')
            frame.className = 'host-layer'
            frame.style.position = 'fixed'
            frame.style.zIndex = '40'
            const inner = document.createElement('div')
            inner.style.position = 'relative'
            const root = document.createElement('div')
            inner.append(root)
            frame.append(inner)
            hostLayers.append(frame)
            entry.widget = {
                root,
                setVisible: (v) => { entry.visible = v },
                isVisible: () => entry.visible,
                onDragEnd: (h) => { entry.drag = h; return () => { entry.drag = null } },
                setSize: (width, height) => { entry.sized.push({ width, height }) },
                destroy: () => { entry.destroyed = true; frame.remove() },
            }
            widgets.push(entry)
            return entry.widget
        },
        mount(root, slots) {
            const entry = { root, slots, destroyed: false, refreshed: 0, panel: null as unknown as LayoutPanel }
            entry.panel = { refreshTracker: () => { entry.refreshed += 1 }, destroy: () => { entry.destroyed = true } }
            mounts.push(entry)
            return entry.panel
        },
        readLayout: layout === 'fail'
            ? () => Promise.reject(new Error('no backend'))
            : () => Promise.resolve({ layout, positions: options.positions ?? {}, sizes: options.sizes ?? {}, minimized: options.minimized }),
        savePositions: (positions) => { saved.push(positions) },
        saveSizes: (sizes) => { savedSizes.push(sizes) },
        saveMinimized: (minimized) => { savedMinimized.push(minimized) },
        onLayoutChange(next) { handler = next; return () => { unsubscribed += 1 } },
    }
    return { host, tabs, widgets, mounts, saved, savedSizes, savedMinimized, hostLayers, change: (next: 'classic' | 'tabs' | 'widgets') => handler?.(next), unsubscribed: () => unsubscribed }
}

// The layers' one debug line is for the live console, not the test output.
beforeEach(() => { vi.spyOn(console, 'debug').mockImplementation(() => undefined) })
afterEach(() => { vi.restoreAllMocks() })

describe('the layout (47b)', () => {
    it('registers the main tab at once and mounts classic when the preference says so', async () => {
        const { host, tabs, mounts } = makeHost('classic')
        const layout = createLayout(host)

        expect(tabs.map((t) => t.id)).toEqual([MAIN_TAB.id])
        expect(layout.current()).toBeNull()
        expect(mounts.length).toBe(0)

        await settle()
        expect(layout.current()).toBe('classic')
        expect(mounts.length).toBe(1)
        expect(mounts[0].root).toBe(tabs[0].tab.root)
        expect(mounts[0].slots.rest).toBeUndefined()
        expect(tabs.length).toBe(1)
    })

    it('registers the settings tab and mounts into both when the preference is tabs', async () => {
        const { host, tabs, mounts } = makeHost('tabs')
        const layout = createLayout(host)
        await settle()

        expect(layout.current()).toBe('tabs')
        expect(tabs.map((t) => t.id)).toEqual([MAIN_TAB.id, SETTINGS_TAB.id])
        expect(mounts[0].root).toBe(tabs[0].tab.root)
        expect(mounts[0].slots.rest).toBe(tabs[1].tab.root)
    })

    it('mounts classic when the preference cannot be read', async () => {
        const { host, tabs, mounts } = makeHost('fail')
        const layout = createLayout(host)
        await settle()

        expect(layout.current()).toBe('classic')
        expect(mounts.length).toBe(1)
        expect(tabs.length).toBe(1)
    })

    it('rebuilds in the other shape when the preference changes, and tears the old one down', async () => {
        const { host, tabs, mounts, change } = makeHost('classic')
        createLayout(host)
        await settle()

        change('tabs')
        expect(mounts[0].destroyed).toBe(true)
        expect(mounts.length).toBe(2)
        expect(mounts[1].slots.rest).toBe(tabs[1].tab.root)
        expect(tabs[0].destroyed).toBe(false)

        change('classic')
        expect(mounts[1].destroyed).toBe(true)
        expect(tabs[1].destroyed).toBe(true)
        expect(mounts.length).toBe(3)
        expect(mounts[2].slots.rest).toBeUndefined()
        // The main tab was never re-registered: its icon stayed put.
        expect(tabs.filter((t) => t.id === MAIN_TAB.id).length).toBe(1)
    })

    it('does nothing for a preference change that keeps the layout', async () => {
        const { host, mounts, change } = makeHost('tabs')
        createLayout(host)
        await settle()

        change('tabs')
        expect(mounts.length).toBe(1)
        expect(mounts[0].destroyed).toBe(false)
    })

    it('passes a refresh to the panel on screen, and nothing to one that is not yet', async () => {
        const { host, mounts } = makeHost('classic')
        const layout = createLayout(host)
        expect(() => layout.refreshTracker()).not.toThrow()
        await settle()

        layout.refreshTracker()
        expect(mounts[0].refreshed).toBe(1)
    })

    it('takes everything down on destroy, and ignores a change after it', async () => {
        const { host, tabs, mounts, change, unsubscribed } = makeHost('tabs')
        const layout = createLayout(host)
        await settle()

        layout.destroy()
        expect(mounts[0].destroyed).toBe(true)
        expect(tabs.every((t) => t.destroyed)).toBe(true)
        expect(unsubscribed()).toBe(1)

        change('classic')
        expect(mounts.length).toBe(1)
    })

    it('ignores a read that lands after destroy', async () => {
        let resolve: ((read: { layout: 'classic' | 'tabs' | 'widgets'; positions: Record<string, { x: number; y: number }>; sizes: Record<string, Size> }) => void) | null = null
        const { host, mounts } = makeHost('classic')
        host.readLayout = () => new Promise((r) => { resolve = r })
        const layout = createLayout(host)
        layout.destroy()
        resolve!({ layout: 'tabs', positions: {}, sizes: {} })
        await settle()

        expect(mounts.length).toBe(0)
        expect(layout.current()).toBeNull()
    })
})

describe('the widgets (47c)', () => {
    it('makes the two widgets, dresses them, and mounts the panel across them and the one tab', async () => {
        const { host, tabs, widgets, mounts } = makeHost('widgets')
        const layout = createLayout(host)
        await settle()

        expect(layout.current()).toBe('widgets')
        expect(tabs.map((t) => t.id)).toEqual([MAIN_TAB.id])
        expect(widgets.map((w) => w.which)).toEqual(['tracker', 'scene'])
        expect(widgets[0].initialPosition).toEqual(WIDGETS.tracker.initialPosition)
        expect(widgets[1].initialPosition).toEqual(WIDGETS.scene.initialPosition)

        const [tracker, scene] = widgets
        for (const w of [tracker, scene]) {
            expect(w.widget.root.classList.contains('lh-widget')).toBe(true)
            expect(w.widget.root.classList.contains('adventuretime-panel')).toBe(true)
            expect(w.widget.root.querySelector('.lh-widget-head-title')!.textContent).toBe(w.title)
            expect(w.widget.root.querySelector('.lh-widget-hide')).not.toBeNull()
            expect(w.widget.root.querySelector('.lh-widget-grip')).not.toBeNull()
        }
        expect(widgets[0].size).toEqual({ width: WIDGETS.tracker.width, height: WIDGETS.tracker.height })
        expect(widgets[1].size).toEqual({ width: WIDGETS.scene.width, height: WIDGETS.scene.height })
        expect(mounts.length).toBe(1)
        expect(mounts[0].root).toBe(tracker.widget.root.querySelector('.lh-widget-body'))
        expect(mounts[0].slots.rest).toBe(tabs[0].tab.root)
        expect(mounts[0].slots.scene).toBe(scene.widget.root.querySelector('.lh-widget-body'))
        expect(mounts[0].slots.widgets).toBeDefined()
    })

    it('starts each widget where it was last left', async () => {
        const { host, widgets } = makeHost('widgets', { positions: { tracker: { x: 300, y: 200 } } })
        createLayout(host)
        await settle()

        expect(widgets[0].initialPosition).toEqual({ x: 300, y: 200 })
        expect(widgets[1].initialPosition).toEqual(WIDGETS.scene.initialPosition)
    })

    it('hides a widget with its × and brings it back from the settings', async () => {
        const { host, widgets, mounts } = makeHost('widgets')
        createLayout(host)
        await settle()

        ;(widgets[1].widget.root.querySelector('.lh-widget-hide') as HTMLButtonElement).click()
        expect(widgets[1].visible).toBe(false)
        expect(widgets[0].visible).toBe(true)

        mounts[0].slots.widgets!.show('scene')
        expect(widgets[1].visible).toBe(true)

        ;(widgets[0].widget.root.querySelector('.lh-widget-hide') as HTMLButtonElement).click()
        expect(widgets[0].visible).toBe(false)
        mounts[0].slots.widgets!.show('tracker')
        expect(widgets[0].visible).toBe(true)
    })

    it('toggles a widget: hides one that shows, brings back one hidden with its × (67)', async () => {
        const { host, widgets, mounts } = makeHost('widgets')
        createLayout(host)
        await settle()

        mounts[0].slots.widgets!.toggle('scene')
        expect(widgets[1].visible).toBe(false)
        expect(widgets[0].visible).toBe(true)
        mounts[0].slots.widgets!.toggle('scene')
        expect(widgets[1].visible).toBe(true)
        ;(widgets[0].widget.root.querySelector('.lh-widget-hide') as HTMLButtonElement).click()
        expect(widgets[0].visible).toBe(false)
        mounts[0].slots.widgets!.toggle('tracker')
        expect(widgets[0].visible).toBe(true)
    })

    it('resets the widgets: remade as a fresh install draws them, the kept positions, sizes and folds forgotten (67-bis)', async () => {
        const { host, widgets, mounts, saved, savedSizes, savedMinimized } = makeHost('widgets', { positions: { tracker: { x: 300, y: 400 }, scene: { x: 900, y: 50 } }, sizes: { tracker: { width: 600, height: 700 } }, minimized: { scene: true } })
        createLayout(host)
        await settle()
        expect(widgets[0].initialPosition).toEqual({ x: 300, y: 400 })
        expect(widgets[0].size).toEqual({ width: 600, height: 700 })
        ;(widgets[1].widget.root.querySelector('.lh-widget-hide') as HTMLButtonElement).click()

        mounts[0].slots.widgets!.reset()
        // The old boxes are gone, the panel with them; two new boxes stand where a fresh install draws them.
        expect(widgets[0].destroyed).toBe(true)
        expect(widgets[1].destroyed).toBe(true)
        expect(mounts[0].destroyed).toBe(true)
        expect(widgets.length).toBe(4)
        expect(widgets[2].initialPosition).toEqual({ x: 24, y: 80 })
        expect(widgets[3].initialPosition).toEqual({ x: 560, y: 80 })
        expect(widgets[2].size).toEqual({ width: 520, height: 620 })
        expect(widgets[3].size).toEqual({ width: 460, height: 520 })
        expect(widgets[3].visible).toBe(true)
        // The scene box was kept folded; the remade one is not.
        expect(widgets[3].widget.root.classList.contains('lh-widget--minimized')).toBe(false)
        expect(mounts.length).toBe(2)
        expect(saved).toEqual([{}])
        expect(savedSizes).toEqual([{}])
        expect(savedMinimized).toEqual([{}])
        // A drag after the reset keeps only its own box, since the old places are gone.
        widgets[3].drag!({ x: 700, y: 90 })
        expect(saved.at(-1)).toEqual({ scene: { x: 700, y: 90 } })
    })

    it('offers no reset outside the widgets layout (67-bis)', async () => {
        const { host, widgets, mounts, saved, savedSizes } = makeHost('tabs')
        createLayout(host)
        await settle()
        expect(mounts[0].slots.widgets).toBeUndefined()
        expect(widgets.length).toBe(0)
        expect(saved).toEqual([])
        expect(savedSizes).toEqual([])
    })

    it('keeps where a widget is dragged to, whole, so the other\'s place is not lost', async () => {
        const { host, widgets, saved } = makeHost('widgets', { positions: { scene: { x: 500, y: 90 } } })
        createLayout(host)
        await settle()

        widgets[0].drag!({ x: 10.4, y: 300.6 })
        expect(saved).toEqual([{ scene: { x: 500, y: 90 }, tracker: { x: 10, y: 301 } }])
        widgets[1].drag!({ x: 600, y: 100 })
        expect(saved[1]).toEqual({ scene: { x: 600, y: 100 }, tracker: { x: 10, y: 301 } })
    })

    it('falls back to the two tabs when the host refuses a widget, and says so', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const { host, tabs, widgets, mounts } = makeHost('widgets', { refuseWidgets: true })
        const layout = createLayout(host)
        await settle()

        expect(layout.current()).toBe('tabs')
        expect(widgets.length).toBe(0)
        expect(tabs.map((t) => t.id)).toEqual([MAIN_TAB.id, SETTINGS_TAB.id])
        expect(mounts[0].slots.rest).toBe(tabs[1].tab.root)
        expect(mounts[0].slots.scene).toBeUndefined()
        expect(error).toHaveBeenCalledWith(expect.stringContaining('ui_panels'), expect.any(Error))
    })

    it('destroys the widgets on a switch away, and on destroy', async () => {
        const { host, widgets, mounts, change } = makeHost('widgets')
        const layout = createLayout(host)
        await settle()

        change('classic')
        expect(widgets.every((w) => w.destroyed)).toBe(true)
        expect(mounts[0].destroyed).toBe(true)
        expect(mounts[1].slots.scene).toBeUndefined()

        change('widgets')
        expect(widgets.length).toBe(4)
        layout.destroy()
        expect(widgets.every((w) => w.destroyed)).toBe(true)
    })

})

/** A pointer event the grip and the document can hear; happy-dom's MouseEvent carries the coordinates. */
function pointer(type: string, x: number, y: number): MouseEvent {
    return new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true })
}

describe('the widgets\' grips (47c-bis)', () => {
    it('starts each widget at the size it was last dragged to', async () => {
        const { host, widgets } = makeHost('widgets', { sizes: { scene: { width: 700, height: 300 } } })
        createLayout(host)
        await settle()

        expect(widgets[0].size).toEqual({ width: WIDGETS.tracker.width, height: WIDGETS.tracker.height })
        expect(widgets[1].size).toEqual({ width: 700, height: 300 })
    })

    it('resizes the box as the grip is pulled, from the size it started at, and keeps the size on release, whole', async () => {
        const { host, widgets, savedSizes } = makeHost('widgets', { sizes: { scene: { width: 700, height: 300 } } })
        createLayout(host)
        await settle()

        const grip = widgets[0].widget.root.querySelector('.lh-widget-grip') as HTMLElement
        grip.dispatchEvent(pointer('pointerdown', 100, 100))
        document.dispatchEvent(pointer('pointermove', 140, 110))
        expect(widgets[0].sized).toEqual([{ width: WIDGETS.tracker.width + 40, height: WIDGETS.tracker.height + 10 }])
        document.dispatchEvent(pointer('pointermove', 160, 90))
        expect(widgets[0].sized[1]).toEqual({ width: WIDGETS.tracker.width + 60, height: WIDGETS.tracker.height - 10 })
        expect(savedSizes.length).toBe(0)

        document.dispatchEvent(pointer('pointerup', 160, 90))
        expect(savedSizes).toEqual([{ scene: { width: 700, height: 300 }, tracker: { width: WIDGETS.tracker.width + 60, height: WIDGETS.tracker.height - 10 } }])

        // The release let go of the document: a later move resizes nothing.
        document.dispatchEvent(pointer('pointermove', 400, 400))
        expect(widgets[0].sized.length).toBe(2)

        // A second pull starts from where the first left it.
        grip.dispatchEvent(pointer('pointerdown', 0, 0))
        document.dispatchEvent(pointer('pointermove', 5, 5))
        expect(widgets[0].sized[2]).toEqual({ width: WIDGETS.tracker.width + 65, height: WIDGETS.tracker.height - 5 })
        document.dispatchEvent(pointer('pointerup', 5, 5))
        expect(savedSizes[1].tracker).toEqual({ width: WIDGETS.tracker.width + 65, height: WIDGETS.tracker.height - 5 })
    })

    it('never lets a box be pulled smaller than the minimum', async () => {
        const { host, widgets, savedSizes } = makeHost('widgets')
        createLayout(host)
        await settle()

        const grip = widgets[1].widget.root.querySelector('.lh-widget-grip') as HTMLElement
        grip.dispatchEvent(pointer('pointerdown', 500, 500))
        document.dispatchEvent(pointer('pointermove', 0, 0))
        expect(widgets[1].sized).toEqual([{ width: MIN_WIDGET_SIZE.width, height: MIN_WIDGET_SIZE.height }])
        document.dispatchEvent(pointer('pointerup', 0, 0))
        expect(savedSizes[0].scene).toEqual({ width: MIN_WIDGET_SIZE.width, height: MIN_WIDGET_SIZE.height })
        expect(clampSize(10.4, 9000.6)).toEqual({ width: MIN_WIDGET_SIZE.width, height: 9001 })
    })

    it('keeps a press on the grip from reaching the host\'s drag', async () => {
        const { host, widgets } = makeHost('widgets')
        createLayout(host)
        await settle()

        const heard: string[] = []
        widgets[0].widget.root.addEventListener('pointerdown', (event) => { heard.push(event.type) })
        const grip = widgets[0].widget.root.querySelector('.lh-widget-grip') as HTMLElement
        const down = pointer('pointerdown', 1, 1)
        grip.dispatchEvent(down)
        expect(heard).toEqual([])
        expect(down.defaultPrevented).toBe(true)
        document.dispatchEvent(pointer('pointerup', 1, 1))
    })
})

describe('the widgets\' heads (57)', () => {
    it('gives the tracker widget a strip under its title that never scrolls, hands it to the panel, and shields its presses as the body does', async () => {
        const { host, widgets, mounts } = makeHost('widgets')
        createLayout(host)
        await settle()

        const root = widgets[0].widget.root
        const strip = root.querySelector('.lh-widget-strip') as HTMLElement
        expect(strip).not.toBeNull()
        // Between the head and the body: the part of the box that stays put while the body scrolls.
        expect(Array.from(root.children).map((n) => n.className)).toEqual(['lh-widget-head', 'lh-widget-strip', 'lh-widget-body', 'lh-widget-foot', 'lh-widget-grip'])
        expect(mounts[0].slots.trackerHead).toBe(strip)
        // And a foot under the body (74f), handed to the panel for the XP bar, shielding its presses too.
        const foot = root.querySelector('.lh-widget-foot') as HTMLElement
        expect(mounts[0].slots.trackerFoot).toBe(foot)
        // The second box's strip and foot go to the panel as well (78a): the tab strip and the agent's footer.
        const second = widgets[1].widget.root
        expect(mounts[0].slots.sceneHead).toBe(second.querySelector('.lh-widget-strip'))
        expect(mounts[0].slots.sceneFoot).toBe(second.querySelector('.lh-widget-foot'))

        const frame = root.parentElement!.parentElement as HTMLElement
        const heard: string[] = []
        for (const type of ['pointerdown', 'mousedown', 'touchstart']) frame.addEventListener(type, (event) => { heard.push(event.type) })
        const button = document.createElement('button')
        strip.append(button)
        for (const type of ['pointerdown', 'mousedown']) {
            const press = pointer(type, 5, 5)
            button.dispatchEvent(press)
            expect(press.defaultPrevented).toBe(false)
        }
        button.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true }))
        expect(heard).toEqual([])
    })

    it('folds a box to its head with the – button, sizing the frame to the head and hiding the body and the grip, unfolds it to the kept size with +, and keeps the state', async () => {
        const { host, widgets, savedMinimized } = makeHost('widgets', { sizes: { tracker: { width: 600, height: 700 } } })
        createLayout(host)
        await settle()

        const root = widgets[0].widget.root
        const fold = root.querySelector('.lh-widget-minimize') as HTMLButtonElement
        expect(fold.textContent).toBe('–')
        expect(fold.getAttribute('aria-label')).toBe('Fold')
        expect(widgets[0].sized).toEqual([])

        fold.click()
        expect(root.classList.contains('lh-widget--minimized')).toBe(true)
        expect((root.querySelector('.lh-widget-body') as HTMLElement).hidden).toBe(true)
        expect((root.querySelector('.lh-widget-foot') as HTMLElement).hidden).toBe(true)
        expect((root.querySelector('.lh-widget-grip') as HTMLElement).hidden).toBe(true)
        // The width kept; the height the head's, floored where nothing is laid out.
        expect(widgets[0].sized.at(-1)).toEqual({ width: 600, height: MINIMIZED_HEIGHT_FLOOR })
        expect(fold.textContent).toBe('+')
        expect(fold.getAttribute('aria-label')).toBe('Unfold')
        expect(savedMinimized).toEqual([{ tracker: true }])

        fold.click()
        expect(root.classList.contains('lh-widget--minimized')).toBe(false)
        expect((root.querySelector('.lh-widget-body') as HTMLElement).hidden).toBe(false)
        expect((root.querySelector('.lh-widget-foot') as HTMLElement).hidden).toBe(false)
        expect((root.querySelector('.lh-widget-grip') as HTMLElement).hidden).toBe(false)
        expect(widgets[0].sized.at(-1)).toEqual({ width: 600, height: 700 })
        expect(savedMinimized.at(-1)).toEqual({ tracker: false })

        // The other box folds on its own, and the state carries both.
        ;(widgets[1].widget.root.querySelector('.lh-widget-minimize') as HTMLButtonElement).click()
        expect(savedMinimized.at(-1)).toEqual({ tracker: false, scene: true })
        expect(widgets[1].sized.at(-1)).toEqual({ width: WIDGETS.scene.width, height: MINIMIZED_HEIGHT_FLOOR })
        expect(widgets[0].widget.root.classList.contains('lh-widget--minimized')).toBe(false)
    })

    it('starts a box folded when it was left so, sized to its head once the panel has filled the strip, and its × still hides it', async () => {
        const { host, widgets } = makeHost('widgets', { minimized: { scene: true, tracker: false } })
        createLayout(host)
        await settle()

        expect(widgets[1].widget.root.classList.contains('lh-widget--minimized')).toBe(true)
        expect(widgets[1].sized.at(-1)).toEqual({ width: WIDGETS.scene.width, height: MINIMIZED_HEIGHT_FLOOR })
        expect(widgets[0].widget.root.classList.contains('lh-widget--minimized')).toBe(false)
        expect(widgets[0].sized).toEqual([])
        // Measured again after the host has laid the frame out.
        const before = widgets[1].sized.length
        await new Promise((resolve) => setTimeout(resolve, 60))
        expect(widgets[1].sized.length).toBeGreaterThan(before)
        expect(widgets[1].sized.at(-1)).toEqual({ width: WIDGETS.scene.width, height: MINIMIZED_HEIGHT_FLOOR })

        ;(widgets[1].widget.root.querySelector('.lh-widget-hide') as HTMLButtonElement).click()
        expect(widgets[1].visible).toBe(false)
    })
})

describe('the folded frame\'s chrome (57-bis)', () => {
    /** A box laid out: the root a given height inside the host's frame, the head and the strip their own. */
    function layOut(root: HTMLElement, heights: { root: number; head: number; strip: number }): void {
        const rect = (height: number) => () => ({ height, width: 500, top: 0, left: 0, right: 500, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
        root.getBoundingClientRect = rect(heights.root)
        ;(root.querySelector('.lh-widget-head') as HTMLElement).getBoundingClientRect = rect(heights.head)
        ;(root.querySelector('.lh-widget-strip') as HTMLElement).getBoundingClientRect = rect(heights.strip)
    }

    it('sizes a folded frame to the head plus the chrome the host keeps around the root, measured while unfolded', async () => {
        const { host, widgets } = makeHost('widgets', { sizes: { tracker: { width: 600, height: 700 } } })
        createLayout(host)
        await settle()
        const root = widgets[0].widget.root
        // The frame is 700 and the root inside it 680: 20 of chrome. The head is 32, the strip 70.
        layOut(root, { root: 680, head: 32, strip: 70 })

        ;(root.querySelector('.lh-widget-minimize') as HTMLButtonElement).click()
        expect(widgets[0].sized.at(-1)).toEqual({ width: 600, height: 32 + 70 + 20 + MINIMIZED_ALLOWANCE })
    })

    it('grows a folded frame a moment later by what the root cannot show', async () => {
        const { host, widgets } = makeHost('widgets')
        createLayout(host)
        await settle()
        const root = widgets[0].widget.root
        ;(root.querySelector('.lh-widget-minimize') as HTMLButtonElement).click()
        const before = widgets[0].sized.at(-1)!
        // Laid out folded: the root shows 60 of its 84.
        Object.defineProperty(root, 'scrollHeight', { value: 84, configurable: true })
        Object.defineProperty(root, 'clientHeight', { value: 60, configurable: true })
        await new Promise((resolve) => setTimeout(resolve, 60))
        expect(widgets[0].sized.at(-1)).toEqual({ width: before.width, height: before.height + 24 })

        // Unfolded, nothing is trimmed, whatever the root says.
        ;(root.querySelector('.lh-widget-minimize') as HTMLButtonElement).click()
        const count = widgets[0].sized.length
        await new Promise((resolve) => setTimeout(resolve, 60))
        expect(widgets[0].sized.length).toBe(count)
    })
})

describe('the widgets\' presses (47c-ter)', () => {
    it('finds the host\'s frame as the nearest positioned ancestor, or the root alone', () => {
        const frame = document.createElement('div')
        frame.style.position = 'absolute'
        const between = document.createElement('div')
        const root = document.createElement('div')
        frame.append(between)
        between.append(root)
        expect(frameOf(root)).toBe(frame)
        const bare = document.createElement('div')
        document.createElement('div').append(bare)
        expect(frameOf(bare)).toBe(bare)
    })

    it('finds where two boxes part, and nothing for roots in different trees or one inside the other', () => {
        const parent = document.createElement('div')
        const layerA = document.createElement('div')
        const layerB = document.createElement('div')
        const innerA = document.createElement('div')
        const rootA = document.createElement('div')
        const rootB = document.createElement('div')
        parent.append(layerA, layerB)
        layerA.append(innerA)
        innerA.append(rootA)
        layerB.append(rootB)
        expect(layersOf(rootA, rootB)).toEqual([layerA, layerB])
        expect(layersOf(rootB, rootA)).toEqual([layerB, layerA])
        expect(layersOf(rootA, document.createElement('div'))).toBeNull()
        // A root in another tree with a parent of its own: the depths alone would not say so.
        const elsewhere = document.createElement('div')
        const rootC = document.createElement('div')
        elsewhere.append(rootC)
        expect(layersOf(rootA, rootC)).toBeNull()
        expect(layersOf(rootA, layerA)).toBeNull()
    })

    it('puts the box last pressed on top, one above the host\'s base, and the other back at it, on the layers where they part', async () => {
        const { host, widgets } = makeHost('widgets')
        createLayout(host)
        await settle()
        const frames = widgets.map((w) => w.widget.root.parentElement!.parentElement as HTMLElement)
        const inners = widgets.map((w) => w.widget.root.parentElement as HTMLElement)
        expect(frames.map((f) => f.style.zIndex)).toEqual(['40', '40'])

        widgets[1].widget.root.querySelector('.lh-widget-body')!.dispatchEvent(pointer('pointerdown', 1, 1))
        expect(frames.map((f) => f.style.zIndex)).toEqual(['40', '41'])

        widgets[0].widget.root.querySelector('.lh-widget-head')!.dispatchEvent(pointer('pointerdown', 1, 1))
        expect(frames.map((f) => f.style.zIndex)).toEqual(['41', '40'])

        // Tabbing into a box raises it too, and so does bringing one back.
        widgets[1].widget.root.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
        expect(frames.map((f) => f.style.zIndex)).toEqual(['40', '41'])
        // The inner wrappers, the frames `frameOf` finds, were left alone.
        expect(inners.map((f) => f.style.zIndex)).toEqual(['', ''])
    })

    it('positions a layer the host left static, so the z-index orders it', async () => {
        const { host, widgets } = makeHost('widgets')
        createLayout(host)
        await settle()
        const frames = widgets.map((w) => w.widget.root.parentElement!.parentElement as HTMLElement)
        for (const f of frames) { f.style.position = ''; f.style.zIndex = '' }
        widgets[0].widget.root.dispatchEvent(pointer('pointerdown', 1, 1))
        expect(frames.map((f) => f.style.position)).toEqual(['relative', 'relative'])
        expect(frames.map((f) => f.style.zIndex)).toEqual(['1', '0'])
    })

    it('finds the layers at each press, so a host that re-wraps a box after it was made is followed', async () => {
        const { host, widgets, hostLayers } = makeHost('widgets')
        createLayout(host)
        await settle()
        const frames = widgets.map((w) => w.widget.root.parentElement!.parentElement as HTMLElement)
        widgets[0].widget.root.dispatchEvent(pointer('pointerdown', 1, 1))
        expect(frames.map((f) => f.style.zIndex)).toEqual(['41', '40'])

        const wrap = document.createElement('div')
        hostLayers.append(wrap)
        wrap.append(frames[1])
        widgets[1].widget.root.dispatchEvent(pointer('pointerdown', 1, 1))
        expect(wrap.style.zIndex).toBe('41')
        expect(frames[0].style.zIndex).toBe('40')
    })

    it('raises a box brought back with the show button', async () => {
        const { host, widgets, mounts } = makeHost('widgets')
        createLayout(host)
        await settle()
        widgets[1].widget.root.dispatchEvent(pointer('pointerdown', 1, 1))
        mounts[0].slots.widgets!.show('tracker')
        const frames = widgets.map((w) => w.widget.root.parentElement!.parentElement as HTMLElement)
        expect(frames.map((f) => f.style.zIndex)).toEqual(['41', '40'])
    })

    it('keeps a press in the body from reaching the host\'s frame, without preventing it, and lets the head\'s through', async () => {
        const { host, widgets } = makeHost('widgets')
        createLayout(host)
        await settle()
        const root = widgets[0].widget.root
        const frame = root.parentElement!.parentElement as HTMLElement
        const heard: string[] = []
        for (const type of ['pointerdown', 'mousedown', 'touchstart']) frame.addEventListener(type, (event) => { heard.push(event.type) })

        const field = document.createElement('input')
        root.querySelector('.lh-widget-body')!.append(field)
        for (const type of ['pointerdown', 'mousedown']) {
            const press = pointer(type, 5, 5)
            field.dispatchEvent(press)
            expect(press.defaultPrevented).toBe(false)
        }
        field.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true }))
        expect(heard).toEqual([])

        root.querySelector('.lh-widget-head')!.dispatchEvent(pointer('pointerdown', 5, 5))
        root.querySelector('.lh-widget-head')!.dispatchEvent(pointer('mousedown', 5, 5))
        expect(heard).toEqual(['pointerdown', 'mousedown'])
    })
})
