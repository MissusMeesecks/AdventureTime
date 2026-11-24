/**
 * The *Portraits & location images* section after Multihog's (Phase 83, the
 * maintainer's ask of 2026-10-28), in the copy deck's words (96): the
 * switches first, in Multihog's order — the portraits on the cards, the
 * prompt editor, the prefix, the story lookback, *Draw automatically for* —
 * then *Location images* and the *Real-time location images* box; the art
 * styles and the three prompt boxes follow as the binder's rows, the prompts
 * under a folded card of their own at the foot (*Portrait prompt templates*).
 *
 * Nothing here is new state: every row is the same preference the folds and
 * the gears write — 61's switches and lookback through `portrait-draw.ts`,
 * the location image's dials through `scene-picture-settings.ts`, both handed
 * in rather than drawn again — and `prefs.changed` keeps every copy in step.
 * The two pieces that had no row in the section before are the portraits
 * switch (a dial of the category's box until 83) and *Show location images*
 * (the Locations ⚙'s, with its rule: off takes the auto draw with it, 80).
 *
 * Every row's help is behind its [?] (96). The connections' note is the
 * card's own [?] now, and *Purge all portraits* has one home, the Debug &
 * factory reset card (the audit's finding 26), so the section has no foot.
 */
import { createTickRow, type PortraitDrawSettings } from './portrait-draw.js'
import type { ScenePictureSettings } from './scene-picture-settings.js'

export interface PortraitsSectionHost {
    el(tag: string, attrs?: Record<string, string>): HTMLElement
    savePrefs(patch: Record<string, unknown>): Promise<void>
    fail(error: unknown): void
}

export interface PortraitsSection {
    /** Before the binder's rows: the switches, the location block, the Real-time box. */
    header: HTMLElement
    applyPrefs(prefs: Record<string, unknown>): void
}

export const PORTRAITS_ENABLED_HELP = 'When on, portraits show on the Character, Party and Combat cards, in the Tracker widget and under each message, and on the NPC cards in Campaign Records. When off, the pictures are kept but hidden there. The NPC library and the location image are not affected. Default: on.'
export const LOCATION_IMAGES_HELP = 'When on, each location in Campaign Records shows its picture. Click a picture to set, draw or remove it. When off, locations are a plain list and automatic scene drawing is turned off too. Default: off.'

export const PORTRAITS_SECTION_CSS = `
.adventuretime-panel .lh-portraits-head { display: flex; flex-direction: column; gap: 6px; font-size: 0.8em; margin: 2px 0 8px; }
.adventuretime-panel .lh-portraits-head .lh-portrait-settings-row, .adventuretime-panel .lh-portraits-head .lh-scene-picture-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.adventuretime-panel .lh-portraits-head .lh-portrait-settings-row[hidden], .adventuretime-panel .lh-portraits-head .lh-scene-picture-row[hidden] { display: none; }
.adventuretime-panel .lh-portraits-group { font-size: 0.92em; opacity: 0.75; margin-top: 4px; }
.adventuretime-panel .lh-portraits-realtime { border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.35))); border-radius: var(--lumiverse-radius, 8px); padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; background: var(--lh-accent-bg, rgba(127,127,127,0.06)); }
.adventuretime-panel .lh-portraits-realtime-head { display: flex; align-items: center; gap: 8px; }
.adventuretime-panel .lh-portraits-realtime-icon { font-size: 1.2em; }
.adventuretime-panel .lh-portraits-realtime-title { font-weight: 600; }
`

export function createPortraitsSection(host: PortraitsSectionHost, portraits: PortraitDrawSettings, scene: ScenePictureSettings): PortraitsSection {
    const { el } = host
    const header = el('div', { class: 'lh-portraits-head', 'data-lh-field': 'portraits-head' })
    const mark = (node: HTMLElement): HTMLElement => { node.classList.add('lh-search-item'); return node }
    const tick = (field: string, label: string, help: string, save: (on: boolean) => Promise<void>): { row: HTMLElement; input: HTMLInputElement } => {
        const { row, input } = createTickRow(el, 'lh-portrait-settings-row', field, label, help)
        input.addEventListener('change', () => { save(input.checked).catch(host.fail) })
        return { row: mark(row), input }
    }
    const group = (text: string): HTMLElement => { const node = el('div', { class: 'lh-portraits-group' }); node.textContent = text; return node }

    // Multihog's Enable Portraits in Tracker: the portraits switch (72b), one preference in three places.
    const enabled = tick('portraits-enabled', 'Show portraits on cards', PORTRAITS_ENABLED_HELP, (on) => host.savePrefs({ portraitsEnabled: on }))
    enabled.input.checked = true
    // Multihog's Show Location Images (80): the Locations ⚙'s switch, with its rule — off takes the auto draw with it.
    const locations = tick('portraits-location-images', 'Show location images', LOCATION_IMAGES_HELP, (on) => host.savePrefs(on ? { locationImages: true } : { locationImages: false, scenePictureAuto: false }))

    const realtime = el('div', { class: 'lh-portraits-realtime', 'data-lh-field': 'portraits-realtime' })
    const realtimeHead = el('div', { class: 'lh-portraits-realtime-head' })
    const realtimeIcon = el('span', { class: 'lh-portraits-realtime-icon', 'aria-hidden': 'true' })
    realtimeIcon.textContent = '✨'
    const realtimeTitle = el('div', { class: 'lh-portraits-realtime-title' })
    realtimeTitle.textContent = 'Real-time location images'
    realtimeHead.append(realtimeIcon, realtimeTitle)
    realtime.append(realtimeHead, mark(scene.named.auto), mark(scene.named.trigger), mark(scene.named.every))

    header.append(
        enabled.row,
        mark(portraits.rows.skip), mark(portraits.rows.prefix), mark(portraits.rows.lookback), mark(portraits.rows.count),
        group('Draw automatically for'), ...portraits.rows.draw.map(mark),
        group('Location images'),
        locations.row, mark(scene.named.background), mark(scene.named.npcs),
        realtime,
    )

    return {
        header,
        applyPrefs(prefs) {
            if (prefs.portraitsEnabled !== undefined) enabled.input.checked = prefs.portraitsEnabled !== false
            if (prefs.locationImages !== undefined) locations.input.checked = prefs.locationImages === true
        },
    }
}
