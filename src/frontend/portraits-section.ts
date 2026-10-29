/**
 * The *Portraits and location images* section after Multihog's (Phase 83,
 * the maintainer's ask of 2026-10-28): the switches first, in Multihog's
 * order — the portraits on the cards, the prompt editor, the story lookback,
 * *Auto-generate for* — then *Location images & visualisation*, the
 * Real-Time box, the connections' note; the art styles and the three prompt
 * boxes follow as the binder's rows, the prompts under a folded card of their
 * own at the foot (*Portrait prompt templates*), and *Purge all portraits*
 * last, as Multihog's section ends.
 *
 * Nothing here is new state: every row is the same preference the folds and
 * the gears write — 61's switches and lookback through `portrait-draw.ts`,
 * the scene's dials through `scene-picture-settings.ts`, both handed in
 * rather than drawn again — and `prefs.changed` keeps every copy in step.
 * The two pieces that had no row in the section before are the portraits
 * switch (a dial of the category's box until 83) and *Show Location Images*
 * (the Locations ⚙'s, with its rule: off takes the auto draw with it, 80).
 */
import type { PurgePortraitsResult } from '../protocol.js'
import type { PortraitDrawSettings } from './portrait-draw.js'
import type { ScenePictureSettings } from './scene-picture-settings.js'

export interface PortraitsSectionHost {
    el(tag: string, attrs?: Record<string, string>): HTMLElement
    savePrefs(patch: Record<string, unknown>): Promise<void>
    /** Multihog's Emergency: Purge All Portraits, 72a's op; asks first. */
    purge(): Promise<PurgePortraitsResult>
    confirm(title: string, message: string, label: string): Promise<boolean>
    fail(error: unknown): void
}

export interface PortraitsSection {
    /** Before the binder's rows: the switches, the location block, the Real-Time box, the connections' note. */
    header: HTMLElement
    /** After the rows: Purge all portraits. */
    footer: HTMLElement
    applyPrefs(prefs: Record<string, unknown>): void
}

export const PORTRAITS_SECTION_CSS = `
.adventuretime-panel .lh-portraits-head { display: flex; flex-direction: column; gap: 6px; font-size: 0.85em; margin: 2px 0 8px; }
.adventuretime-panel .lh-portraits-head .lh-portrait-settings-row, .adventuretime-panel .lh-portraits-head .lh-scene-picture-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.adventuretime-panel .lh-portraits-head .lh-portrait-settings-row[hidden], .adventuretime-panel .lh-portraits-head .lh-scene-picture-row[hidden] { display: none; }
.adventuretime-panel .lh-portraits-group { font-size: 0.9em; opacity: 0.75; margin-top: 4px; }
.adventuretime-panel .lh-portraits-lead { font-size: 0.85em; opacity: 0.65; line-height: 1.4; }
.adventuretime-panel .lh-portraits-realtime { border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.35))); border-radius: var(--lumiverse-radius, 8px); padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; background: var(--lh-accent-bg, rgba(127,127,127,0.06)); }
.adventuretime-panel .lh-portraits-realtime-head { display: flex; align-items: center; gap: 8px; }
.adventuretime-panel .lh-portraits-realtime-icon { font-size: 1.2em; }
.adventuretime-panel .lh-portraits-realtime-title { font-weight: 600; }
.adventuretime-panel .lh-portraits-realtime-sub { font-size: 0.85em; opacity: 0.65; }
.adventuretime-panel .lh-portraits-conn { border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25))); border-radius: var(--lumiverse-radius, 6px); padding: 6px 10px; }
.adventuretime-panel .lh-portraits-conn-title { font-weight: 600; }
.adventuretime-panel .lh-portraits-conn-sub { font-size: 0.85em; opacity: 0.65; }
.adventuretime-panel .lh-portraits-foot { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.adventuretime-panel .lh-portraits-foot .lh-button--danger { width: 100%; }
.adventuretime-panel .lh-portraits-note { font-size: 0.8em; opacity: 0.8; }
.adventuretime-panel .lh-portraits-note:empty { display: none; }
.adventuretime-panel .lh-portraits-note--problem { color: var(--lumiverse-danger, #ff6b6b); opacity: 1; }
`

export function createPortraitsSection(host: PortraitsSectionHost, portraits: PortraitDrawSettings, scene: ScenePictureSettings): PortraitsSection {
    const { el } = host
    const header = el('div', { class: 'lh-portraits-head', 'data-lh-field': 'portraits-head' })
    const mark = (node: HTMLElement): HTMLElement => { node.classList.add('lh-search-item'); return node }
    const tick = (field: string, label: string, title: string, save: (on: boolean) => Promise<void>): { row: HTMLElement; input: HTMLInputElement } => {
        const row = el('label', { class: 'lh-portrait-settings-row', title })
        const input = el('input', { type: 'checkbox', 'data-lh-field': field }) as HTMLInputElement
        const text = el('span')
        text.textContent = label
        row.append(input, text)
        input.addEventListener('change', () => { save(input.checked).catch(host.fail) })
        return { row: mark(row), input }
    }
    const group = (text: string): HTMLElement => { const node = el('div', { class: 'lh-portraits-group' }); node.textContent = text; return node }

    // Multihog's Enable Portraits in Tracker: the portraits switch (72b), one preference in three places.
    const enabled = tick('portraits-enabled', 'Show portraits on the cards', 'The portrait thumbnails on the Character, Party and Combat cards, in the panel and under each message, and the NPC cards of the Campaign Records. Off, the pictures are kept and not drawn; the library and the scene keep theirs.', (on) => host.savePrefs({ portraitsEnabled: on }))
    enabled.input.checked = true
    // Multihog's Show Location Images (80): the Locations ⚙'s switch, with its rule — off takes the auto draw with it.
    const locations = tick('portraits-location-images', 'Show location images', 'Every location in the Campaign Records carries its picture, and a click sets, draws or removes it. Off, the plain list, and drawing the picture on its own is turned off with it.', (on) => host.savePrefs(on ? { locationImages: true } : { locationImages: false, scenePictureAuto: false }))

    const realtime = el('div', { class: 'lh-portraits-realtime', 'data-lh-field': 'portraits-realtime' })
    const realtimeHead = el('div', { class: 'lh-portraits-realtime-head' })
    const realtimeIcon = el('span', { class: 'lh-portraits-realtime-icon', 'aria-hidden': 'true' })
    realtimeIcon.textContent = '✨'
    const realtimeWords = el('div')
    const realtimeTitle = el('div', { class: 'lh-portraits-realtime-title' })
    realtimeTitle.textContent = 'Real-Time Visualization Mode'
    const realtimeSub = el('div', { class: 'lh-portraits-realtime-sub' })
    realtimeSub.textContent = 'Dynamic scene art that follows your story as you play: the place’s picture drawn on its own after a reply, as the trigger says. One failed draw switches it off again, as Multihog’s does.'
    realtimeWords.append(realtimeTitle, realtimeSub)
    realtimeHead.append(realtimeIcon, realtimeWords)
    realtime.append(realtimeHead, mark(scene.named.auto), mark(scene.named.trigger), mark(scene.named.every))

    const conn = el('div', { class: 'lh-portraits-conn lh-search-item', 'data-lh-field': 'portraits-connections' })
    const connTitle = el('div', { class: 'lh-portraits-conn-title' })
    connTitle.textContent = '🔌 Portrait generation connections'
    const connSub = el('div', { class: 'lh-portraits-conn-sub' })
    connSub.textContent = 'Managed under Connections & models: the portraits’ image and prompt connections, and the scene picture’s.'
    conn.append(connTitle, connSub)

    const locationLead = el('div', { class: 'lh-portraits-lead' })
    locationLead.textContent = 'Scene art in the Campaign Records — the locations’ thumbnails, the large view and Visuals/Map. Off as it ships.'

    header.append(
        enabled.row,
        mark(portraits.rows.skip), mark(portraits.rows.lookback), mark(portraits.rows.count),
        group('Auto-generate for:'), ...portraits.rows.draw.map(mark),
        group('Location images & visualisation'), locationLead,
        locations.row, mark(scene.named.background), mark(scene.named.npcs),
        realtime,
        conn,
    )

    // Multihog's Emergency: Purge All Portraits, at the section's foot; 72a's op and words.
    const footer = el('div', { class: 'lh-portraits-foot', 'data-lh-field': 'portraits-foot' })
    const purge = el('button', { type: 'button', class: 'lh-button lh-button--danger', 'data-lh-field': 'portraits-purge' }) as HTMLButtonElement
    purge.textContent = '🗑 Emergency: purge all portraits'
    purge.title = 'Every chat’s portrait references cleared — the cards and the scene show none until new ones are set or drawn. The pictures stay in Lumiverse’s image store, and the NPC library’s photos stay too.'
    const note = el('div', { class: 'lh-portraits-note', 'data-lh-field': 'portraits-purge-note' })
    purge.addEventListener('click', () => {
        purge.disabled = true
        note.classList.remove('lh-portraits-note--problem')
        host.confirm('Purge all portraits', 'Clear the portraits of every chat? The cards and the scene will show none until new ones are set or drawn. The pictures themselves stay in Lumiverse, and the NPC library keeps its photos.', 'Purge the portraits')
            .then(async (ok) => {
                if (!ok) { note.textContent = 'Not purged.'; return }
                const result = await host.purge()
                note.textContent = result.portraits ? `Cleared ${result.portraits} portrait references across ${result.chats} chats.` : 'No chat had a portrait to clear.'
            })
            .catch((error: unknown) => {
                note.textContent = `Could not purge: ${error instanceof Error ? error.message : String(error)}`
                note.classList.add('lh-portraits-note--problem')
                host.fail(error)
            })
            .finally(() => { purge.disabled = false })
    })
    footer.append(purge, note)

    return {
        header,
        footer,
        applyPrefs(prefs) {
            if (prefs.portraitsEnabled !== undefined) enabled.input.checked = prefs.portraitsEnabled !== false
            if (prefs.locationImages !== undefined) locations.input.checked = prefs.locationImages === true
        },
    }
}
