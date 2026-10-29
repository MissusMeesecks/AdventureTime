/**
 * The recolour popup's rules around the legacy's own code (74i-bis, 74i-ter).
 *
 * Multihog's Bar Settings box is one template for every bar: it offers *Show
 * as Percentage* on all of them and its renderer reads the tick on a few, so
 * on a barrel's half, an orbs row or a clock the tick is there and changes
 * nothing. The box is the legacy's own code, run unchanged from the generated
 * file, so the rule lives here beside it: the renderer says on each handle
 * whether its readout honours the tick (`data-recolor-percent`), and the panel
 * takes the tick off the box when it does not. The box redraws its whole
 * content on every mode button, so the trim is kept up by an observer for
 * as long as the box stands.
 *
 * Since 74i-ter the binding itself lives here too, once for every place that
 * draws bars and takes a click on them — the tracker's cards and the cards
 * under the messages, as the legacy binds both — over the legacy's own
 * settings shape: `barColors` is the map the popup mutates as it works, a
 * save diffs it against what the store last answered and patches the bars
 * that moved, and a refresh reads the map back as the typed preferences and
 * redraws. The rendering tags library is the one place that draws bars and
 * takes no click: its examples are reference, so their handles come off.
 */

import { readBarPrefs, type BarPrefs } from '../tracker/bars.js'
import { createRecolorLegacy } from './bars-legacy.js'

/** Whether the bar under a recolour handle shows the tick's percentage. */
export function handleReadsPercentage(handle: { dataset: DOMStringMap }): boolean {
    return handle.dataset.recolorPercent === 'true'
}

/** Take *Show as Percentage* off the box, now and on every redraw of it, when the bar does not read it. */
export function trimRecolorPopup(popup: HTMLElement | null, reads: { percent: boolean }): void {
    if (!popup || reads.percent) return
    const trim = () => popup.querySelector('#show-as-percentage')?.closest('label')?.remove()
    trim()
    if (typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(() => {
        if (!popup.isConnected) {
            observer.disconnect()
            return
        }
        trim()
    })
    observer.observe(popup, { childList: true })
}

/**
 * Take every recolour handle off a drawing that takes no click (74i-ter): the
 * attributes the binder and the stylesheet key on, the *Click to recolor*
 * title, and a barrel's two half-controls, which are nothing but handles.
 */
export function stripRecolorHandles(scope: ParentNode): void {
    for (const control of Array.from(scope.querySelectorAll('.rt-barrel-color-control'))) control.remove()
    for (const handle of Array.from(scope.querySelectorAll<HTMLElement>('[data-recolor-id]'))) {
        for (const name of ['data-recolor-id', 'data-recolor-current', 'data-recolor-explicit-color', 'data-recolor-percent', 'title']) handle.removeAttribute(name)
    }
}

/** The id of the legacy's popup, the one element it puts on the page. */
export const RECOLOR_POPUP_ID = 'rt-recolor-popup'

export interface RecolorBindingDeps {
    /** The document the popup lives in. */
    document: Document
    /** Patch the bars that moved; answers the store's bars after the patch, or nothing when the store says nothing. */
    patch(bars: Record<string, unknown>): Promise<BarPrefs | undefined>
    /** Redraw with the typed preferences as the legacy's map now reads. */
    redraw(bars: BarPrefs): void
    /** Where a failed patch goes. */
    fail?(error: unknown): void
}

export interface RecolorBinding {
    /** Take the store's bars as the legacy's map; says whether they differ from the last take. */
    take(next: BarPrefs | undefined): { bars: BarPrefs; changed: boolean }
    /** The typed preferences as the legacy's map reads now. */
    current(): BarPrefs
    /** A click on any handle in the scope opens the legacy's popup over it, as its card events bind it. */
    bind(scope: ParentNode): void
    /** Take the popup down. */
    close(): void
}

export function createRecolorBinding(deps: RecolorBindingDeps): RecolorBinding {
    const settings: { barColors: Record<string, unknown> } = { barColors: {} }
    let stored: Record<string, unknown> = {}

    /** Patch every bar whose config differs from the store's last answer; an emptied one is cleared. */
    async function persist(): Promise<void> {
        const patch: Record<string, unknown> = {}
        for (const id of new Set([...Object.keys(stored), ...Object.keys(settings.barColors)])) {
            const now = settings.barColors[id]
            if (JSON.stringify(now ?? null) !== JSON.stringify(stored[id] ?? null)) patch[id] = now ?? {}
        }
        if (Object.keys(patch).length === 0) return
        const next = await deps.patch(patch)
        stored = { ...(next ?? {}) }
    }

    const legacy = createRecolorLegacy({
        getSettings: () => settings,
        saveSettings: () => { persist().catch((error: unknown) => deps.fail?.(error)) },
        refreshRenderedView: () => deps.redraw(readBarPrefs(settings.barColors)),
    })

    return {
        take(next) {
            const incoming = { ...(next ?? {}) }
            const changed = JSON.stringify(incoming) !== JSON.stringify(stored)
            stored = incoming
            settings.barColors = JSON.parse(JSON.stringify(stored)) as Record<string, unknown>
            return { bars: readBarPrefs(settings.barColors), changed }
        },
        current: () => readBarPrefs(settings.barColors),
        bind(scope) {
            for (const wrap of Array.from(scope.querySelectorAll<HTMLElement>('[data-recolor-id]'))) {
                wrap.addEventListener('click', (event) => {
                    event.stopPropagation()
                    legacy.handleRecolor(wrap.dataset.recolorId, wrap.dataset.recolorCurrent, wrap)
                    trimRecolorPopup(deps.document.getElementById(RECOLOR_POPUP_ID), { percent: handleReadsPercentage(wrap) })
                })
            }
        },
        close() {
            deps.document.getElementById(RECOLOR_POPUP_ID)?.remove()
        },
    }
}
