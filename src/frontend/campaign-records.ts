/**
 * Campaign Records (roadmap row 71, Phase 71a): Multihog's browser of the
 * campaign's books, in the Lorebook agent fold after the Lorebooks list.
 *
 * Each book is a folder — NPCs, Locations, World, the custom tags — with
 * its entries under it: a dot for its standing (pinned, in the scan, out of
 * it), the title, the legacy's token estimate, and the row's buttons in
 * Multihog's order: the NPC's bookmark into the library, 📌 pin, ✎ edit,
 * 🧹 clean, 🗑 delete. A click on the row opens it: the keys and the prose,
 * an NPC's `[CORE]` as its fields; Edit turns the same body into a form.
 * On the Locations folder **+ Add Mapped Location** and on an unmapped root
 * **+ MAP** open the legacy's form — Auto or Manual, the reference context,
 * the peers a settlement absorbs — and a mapped root wears its **MAP** badge
 * with the × that takes the map off and keeps the entry.
 *
 * The clean is the cleanup pass on that one entry (71c; Multihog's
 * `__CLEANUP__::Book::UID`, the archivist's own prompt), so its report lands
 * where every pass's does; the bookmark is the library's `saveEntry`. The form
 * runs `map.create`, which can take minutes: the live line says so and the
 * Maps fold is told when it lands.
 *
 * Since 78b the browser is Multihog's manifest whole: the Player Character's
 * card at the top (portrait, synopsis, the badge, **Full PC Card**, the
 * bookmark, ✎, the unlink), the NPCs folder with **NPC/PC Manager** and its
 * ⚙, the Locations folder with **Maps Guide**, **+ Add Mapped Location** and
 * its ⚙, and every NPC as a card — portrait, the appearance synopsis, the
 * status badge, the two relationship bars with their tier pills while the
 * relationship system is on, **Full NPC Card** and the five icons — a click
 * on the card opening the entry inline as the rows do. The Full NPC Card is
 * Multihog's popup in the host's modal: the portrait large, the sections,
 * the bars with their sliders and the detailed tier, the relationship
 * history, Edit text and Save to Library. The standings the Relationships
 * fold drew (44) live on the cards now, and the fold is gone.
 */

import type { CampaignRecordsResult, CardChoice, MapCreateResult, PlayerCardView, RecordBookDTO, RecordEntryDTO, RecordEntryResult, RecordRemoveMapResult, RelationshipsView } from '../protocol.js'
import { briefDescriptionFromPrompt, premiseFromLocationContent } from '../tracker/map-premise.js'
import { stripStamp } from '../agent/provenance.js'
import { clampRelationshipValue, relationshipBarPct, tierBadgeStyle, tierOf, type RelationshipField } from '../tracker/relationships.js'
import { synopsis } from '../tracker/npc-library.js'
import { signed } from './relations-text.js'
import type { DetailsModal } from './details-modal.js'
import { zoomable, type PictureActions } from './enlarge.js'

export interface RecordsFoldHost {
    el(tag: string, attrs?: Record<string, string>): HTMLElement
    list(): Promise<CampaignRecordsResult>
    update(write: { entryId: string; title: string; keys: string[]; content: string }): Promise<RecordEntryResult>
    remove(entryId: string): Promise<{ removed: true; title: string }>
    pin(entryId: string, pinned: boolean): Promise<RecordEntryResult>
    removeMap(entryId: string): Promise<RecordRemoveMapResult>
    /** `map.create`'s params, the chat added by the caller. */
    create(request: Record<string, unknown>): Promise<MapCreateResult>
    /** The host's character cards, for the reference context. */
    cards(): Promise<CardChoice[]>
    saveToLibrary(entryId: string, overwrite: boolean): Promise<{ name: string } | { status: 'exists'; name: string }>
    /** The cleanup pass on one entry (71c): its `Book::uid` and the user's requirements. */
    clean(target: string, requirements: string): Promise<void>
    /** Edit with AI (78c, Multihog's Full NPC Card): the entry's text and the instructions; the whole revised entry back, for review. Absent, no button. */
    aiEdit?(content: string, instructions: string): Promise<{ text: string }>
    confirm(title: string, message: string, confirmLabel: string): Promise<boolean>
    /** A map was made or taken off: the Maps fold reads again. */
    onMapsChanged(): void
    onLibraryChanged(): void
    fail(error: unknown): void
    /** The standings (44), read with the books; the bars draw while the view says the system is on. */
    relations?(): Promise<RelationshipsView>
    setRelation?(id: string, field: RelationshipField, value: number): Promise<RelationshipsView>
    forgetRelation?(id: string): Promise<RelationshipsView>
    /** The chat's Player Card (35b), for the card at the top. */
    playerCard?(): Promise<PlayerCardView>
    savePlayerCardToLibrary?(overwrite: boolean): Promise<{ name: string } | { status: 'exists'; name: string }>
    removePlayerCard?(): Promise<void>
    /** A name's portrait as the tracker's cards find it, or ''. */
    portrait?(name: string): string
    /** The NPCs draw as cards while this says so (Multihog's portraits switch); the compact rows otherwise. */
    npcCards?(): boolean
    /** The host's modal, for the Full cards, the manager and the gears; `null` on a host without one. */
    modal?(options: { title: string; nodes: HTMLElement[]; width?: number; onClose?: () => void }): DetailsModal | null
    /** The panel's own pieces the buttons open: the Player Card fold, the library and the creator, the two gears, the Maps Guide. */
    panels?: {
        playerCard?: { root: HTMLDetailsElement; edit(): void }
        manager?: HTMLDetailsElement[]
        npcSettings?: HTMLElement
        locationSettings?: HTMLElement
        mapsGuide?: HTMLElement
    }
    /** A picture large (64), with its buttons under it (80). */
    enlarge?(src: string, name: string, actions?: PictureActions): void
    /** The portrait's own buttons on the large view (80): set, draw, remove, for an entity by name. */
    portraitActions?(name: string): PictureActions | undefined
    /** Multihog's Show Location Images (80): the Locations folder's rows carry the place's picture while it says so. */
    locationImages?(): boolean
    /** A place's picture as the scene keeps it, by the entry's path, or ''. */
    locationImage?(path: string): string
    /** The place's picture's buttons on the large view (80): the scene's ops on that path. */
    locationActions?(path: string): PictureActions | undefined
    /** Multihog's Clear Log (80): the NPC's history alone, the values kept. */
    clearRelationLog?(id: string): Promise<RelationshipsView>
    when?(iso: string): string
    /** The standings read: the cartridge's switch as the backend reports it, for the NPC gear's tick. */
    onRelations?(view: RelationshipsView): void
}

export interface RecordsFold {
    root: HTMLDetailsElement
    setChat(chatId: string | null): void
    /** Read the books again now. */
    load(): Promise<void>
    /** Read the standings again, when the fold is open: a value moved by another hand (44-bis). */
    refreshRelations(): Promise<void>
    /** Read the Player Card again, when the fold is open. */
    refreshPlayerCard(): Promise<void>
    /** Close the Full card or the gear open in the modal, if any. */
    closeModal(): void
    /** Draw again from what is in hand: the portraits or the location images moved (80). */
    redraw(): void
}

/**
 * The two stock folders drawn whatever the campaign holds (83, the maintainer's
 * ask): Multihog's manifest shows NPCs and Locations on a blank chat, `0/0 (0t)`,
 * with their buttons — the manager, the Maps Guide, + Add Mapped Location, the
 * gears — before any book is made. A book the campaign has not made yet is
 * drawn as an empty folder under the name it will take; the agent makes the
 * NPC book as it records, and + Add Mapped Location makes the Locations book
 * through the architect. The real books keep their order after the two.
 */
export function withStockFolders(result: CampaignRecordsResult): RecordBookDTO[] {
    if (!result.prefix) return result.books
    const stock: Array<{ kind: RecordBookDTO['kind']; category: string }> = [{ kind: 'npc', category: 'NPC' }, { kind: 'location', category: 'LOC' }]
    const head: RecordBookDTO[] = []
    for (const { kind, category } of stock) {
        const real = result.books.find((b) => b.kind === kind)
        head.push(real ?? { id: '', name: `${result.prefix}_${category}`, category, kind, entries: [], tokens: 0 })
    }
    return [...head, ...result.books.filter((b) => !head.includes(b))]
}

/** The folder's name as Multihog's manifest shows it. */
export function folderName(book: RecordBookDTO): string {
    return book.kind === 'npc' ? 'NPCs' : book.kind === 'location' ? 'Locations' : book.kind === 'world' ? 'World' : book.kind === 'skeleton' ? 'World skeleton' : book.category
}

/** The status badge's words (Multihog's): pinned outranks the scan. */
export function statusBadge(entry: { pinned: boolean; disabled: boolean }): { text: string; kind: 'pinned' | 'active' | 'inactive' } {
    if (entry.pinned) return { text: '📌 Pinned', kind: 'pinned' }
    return entry.disabled ? { text: '○ Inactive', kind: 'inactive' } : { text: '● Active', kind: 'active' }
}

export const RECORDS_FOLD_CSS = `
.adventuretime-panel .lh-records > summary { cursor: pointer; font-size: 0.85em; opacity: 0.8; }
.adventuretime-panel .lh-records-body { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.adventuretime-panel .lh-records-lead { font-size: 0.78em; opacity: 0.7; }
.adventuretime-panel .lh-records-bar { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.adventuretime-panel .lh-records-note { font-size: 0.8em; opacity: 0.85; overflow-wrap: anywhere; }
.adventuretime-panel .lh-records-note:empty { display: none; }
.adventuretime-panel .lh-records-note--error { color: var(--lumiverse-danger, #d9534f); opacity: 1; }
.adventuretime-panel .lh-records-folder { border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25))); border-radius: var(--lumiverse-radius, 6px); }
.adventuretime-panel .lh-records-folder-head { display: flex; align-items: center; gap: 6px; padding: 5px 6px; cursor: pointer; font-size: 0.82em; background: rgba(127,127,127,0.06); flex-wrap: wrap; }
.adventuretime-panel .lh-records-chevron { width: 10px; opacity: 0.6; font-family: monospace; font-size: 0.85em; flex: 0 0 auto; }
.adventuretime-panel .lh-records-folder-name { font-weight: 600; flex: 1 1 auto; }
.adventuretime-panel .lh-records-folder-count { opacity: 0.6; font-size: 0.9em; }
.adventuretime-panel .lh-records-folder--virtual > .lh-records-folder-head { border-bottom-style: dashed; }
.adventuretime-panel .lh-records-folder--virtual .lh-records-folder-name { opacity: 0.8; }
.adventuretime-panel .lh-records-folder-body { display: flex; flex-direction: column; gap: 2px; padding: 4px 6px 6px; }
.adventuretime-panel .lh-records-folder-body[hidden] { display: none; }
.adventuretime-panel .lh-records-row { display: flex; align-items: center; gap: 5px; padding: 2px 4px; border-radius: 3px; cursor: pointer; font-size: 0.8em; flex-wrap: wrap; }
.adventuretime-panel .lh-records-row:hover { background: rgba(127,127,127,0.08); }
.adventuretime-panel .lh-records-row--child { margin-left: 14px; }
.adventuretime-panel .lh-records-row--virtual { cursor: default; opacity: 0.7; font-style: italic; }
.adventuretime-panel .lh-records-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--lh-accent, var(--lumiverse-primary, #d4a940)); flex: 0 0 auto; }
.adventuretime-panel .lh-records-dot--pinned { background: var(--lumiverse-success, #34a853); box-shadow: 0 0 4px var(--lumiverse-success, #34a853); }
.adventuretime-panel .lh-records-dot--disabled { background: transparent; border: 1px solid rgba(127,127,127,0.6); box-sizing: border-box; }
.adventuretime-panel .lh-records-dot--virtual { background: transparent; border: 1px dashed rgba(127,127,127,0.6); box-sizing: border-box; }
.adventuretime-panel .lh-records-title { flex: 1 1 auto; overflow-wrap: anywhere; }
.adventuretime-panel .lh-records-loc-thumb { width: 44px; height: 28px; border-radius: 3px; object-fit: cover; flex: 0 0 auto; background: rgba(0,0,0,0.3); border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(212,169,64,0.2))); display: inline-flex; align-items: center; justify-content: center; font-size: 0.95em; }
.adventuretime-panel .lh-records-loc-thumb--empty { opacity: 0.5; }
.adventuretime-panel .lh-records-tokens { font-size: 0.8em; opacity: 0.55; background: rgba(127,127,127,0.12); padding: 0 4px; border-radius: 4px; }
.adventuretime-panel .lh-records-actions { display: flex; gap: 2px; align-items: center; flex: 0 0 auto; }
.adventuretime-panel .lh-records-icon { background: none; border: none; cursor: pointer; padding: 1px 3px; font-size: 0.95em; opacity: 0.7; line-height: 1; color: inherit; }
.adventuretime-panel .lh-records-icon:hover { opacity: 1; }
.adventuretime-panel .lh-records-icon--on { opacity: 1; color: var(--lumiverse-success, #34a853); }
.adventuretime-panel .lh-records-map { display: inline-flex; align-items: center; gap: 0; border: 1px solid var(--lh-accent, var(--lumiverse-primary, #d4a940)); border-radius: 3px; font-size: 0.8em; }
.adventuretime-panel .lh-records-map > span { padding: 0 5px; color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
.adventuretime-panel .lh-records-map > button { background: none; border: none; border-left: 1px solid var(--lh-accent, var(--lumiverse-primary, #d4a940)); cursor: pointer; padding: 0 4px; color: inherit; opacity: 0.8; }
.adventuretime-panel .lh-records-mapmake { border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.4))); background: none; border-radius: 3px; font-size: 0.8em; padding: 0 5px; cursor: pointer; color: inherit; opacity: 0.8; }
.adventuretime-panel .lh-records-entry { margin: 2px 0 6px 14px; padding: 6px 8px; border-left: 2px solid rgba(127,127,127,0.25); display: flex; flex-direction: column; gap: 5px; font-size: 0.8em; }
.adventuretime-panel .lh-records-entry--child { margin-left: 28px; }
.adventuretime-panel .lh-records-keys { opacity: 0.65; font-family: var(--lh-font-mono, var(--lumiverse-font-mono, monospace)); font-size: 0.9em; overflow-wrap: anywhere; }
.adventuretime-panel .lh-records-text { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.4; max-height: 320px; overflow: auto; }
.adventuretime-panel .lh-records-stamp { opacity: 0.55; font-size: 0.85em; font-style: italic; }
.adventuretime-panel .lh-records-core { display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px; }
.adventuretime-panel .lh-records-core dt { opacity: 0.6; }
.adventuretime-panel .lh-records-core dd { margin: 0; overflow-wrap: anywhere; }
.adventuretime-panel .lh-records-form { display: flex; flex-direction: column; gap: 5px; }
.adventuretime-panel .lh-records-form label { display: flex; flex-direction: column; gap: 2px; font-size: 0.95em; }
.adventuretime-panel .lh-records-form textarea { min-height: 90px; resize: vertical; font-family: var(--lh-font-mono, var(--lumiverse-font-mono, monospace)); font-size: 0.95em; }
.adventuretime-panel .lh-records-form-actions { display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; }
.adventuretime-panel .lh-records-mapform { margin: 4px 0 8px; padding: 8px; border: 1px dashed var(--lh-accent, var(--lumiverse-primary, #d4a940)); border-radius: var(--lumiverse-radius, 6px); display: flex; flex-direction: column; gap: 6px; font-size: 0.8em; }
.adventuretime-panel .lh-records-mapform-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.adventuretime-panel .lh-records-mapform-row label { display: flex; gap: 4px; align-items: center; }
.adventuretime-panel .lh-records-mapform-field { display: flex; flex-direction: column; gap: 2px; flex: 1 1 120px; }
.adventuretime-panel .lh-records-mapform [hidden] { display: none; }
.adventuretime-panel .lh-records-ticks { display: flex; flex-direction: column; gap: 2px; max-height: 120px; overflow: auto; border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25))); border-radius: 4px; padding: 4px; }
.adventuretime-panel .lh-records-ticks label { display: flex; gap: 4px; align-items: center; }
.adventuretime-panel .lh-records-hint { font-size: 0.9em; opacity: 0.65; line-height: 1.35; }
.adventuretime-panel .lh-records-empty { font-size: 0.8em; opacity: 0.6; font-style: italic; }
/* Multihog's manifest (78b): the folder header's buttons, the NPC cards, the PC card, the Full card. */
.adventuretime-panel .lh-records-folder-head .lh-records-head-button { border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.4))); background: none; border-radius: 4px; font-size: 0.9em; padding: 1px 7px; cursor: pointer; color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); white-space: nowrap; }
.adventuretime-panel .lh-records-folder-head .lh-records-head-button:hover { background: rgba(127,127,127,0.1); }
.adventuretime-panel .lh-records-folder-head .lh-records-gear { background: none; border: none; cursor: pointer; opacity: 0.5; padding: 0 2px; color: inherit; font-size: 0.95em; line-height: 1; }
.adventuretime-panel .lh-records-folder-head .lh-records-gear:hover { opacity: 1; }
.adventuretime-panel .lh-records-folder-icon { font-size: 0.95em; }
.adventuretime-panel .lh-records-cards { display: flex; flex-direction: column; gap: 6px; padding: 4px 0; }
.adventuretime-panel .lh-npc-card { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; padding: 8px; border-radius: 6px; border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(212,169,64,0.18))); background: linear-gradient(135deg, rgba(127,127,127,0.06), rgba(255,255,255,0.02)); cursor: pointer; position: relative; font-size: 0.8em; }
.adventuretime-panel .lh-npc-card:hover { border-color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); box-shadow: 0 2px 8px rgba(0,0,0,0.12); }
.adventuretime-panel .lh-npc-card--open { border-color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
.adventuretime-panel .lh-npc-card--pc { border-left: 3px solid #c4b5fd; cursor: default; margin-bottom: 6px; }
.adventuretime-panel .lh-npc-card--pc .lh-npc-name { color: #c4b5fd; }
.adventuretime-panel .lh-npc-portrait { width: 64px; height: 64px; min-width: 64px; border-radius: 6px; overflow: hidden; background: rgba(0,0,0,0.3); border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(212,169,64,0.2))); position: relative; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 22px; opacity: 1; }
.adventuretime-panel .lh-npc-portrait img { width: 100%; height: 100%; object-fit: cover; display: block; cursor: zoom-in; }
.adventuretime-panel .lh-npc-portrait--empty { opacity: 0.35; user-select: none; }
.adventuretime-panel .lh-npc-info { flex: 1 1 calc(100% - 72px); min-width: 0; max-width: calc(100% - 72px); display: flex; flex-direction: column; gap: 2px; justify-content: center; }
.adventuretime-panel .lh-npc-name { font-size: 1.1em; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3; display: flex; align-items: center; gap: 6px; }
.adventuretime-panel .lh-npc-desc { font-size: 0.9em; opacity: 0.75; line-height: 1.35; word-break: break-word; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.adventuretime-panel .lh-npc-badge { display: inline-block; font-size: 0.78em; padding: 1px 6px; border-radius: 8px; font-weight: 700; white-space: nowrap; width: fit-content; border: 1px solid rgba(127,127,127,0.25); background: rgba(127,127,127,0.08); opacity: 0.8; }
.adventuretime-panel .lh-npc-badge--active { background: rgba(0,255,170,0.12); color: var(--lumiverse-success, #34a853); border-color: rgba(0,255,170,0.25); opacity: 1; }
.adventuretime-panel .lh-npc-badge--pinned { background: rgba(52,168,83,0.12); color: var(--lumiverse-success, #34a853); border-color: rgba(52,168,83,0.45); opacity: 1; }
.adventuretime-panel .lh-npc-badge--pc { background: rgba(120,80,220,0.15); color: #c4b5fd; border-color: rgba(120,80,220,0.5); opacity: 1; }
.adventuretime-panel .lh-npc-bars { display: flex; flex-direction: column; gap: 3px; margin-top: 3px; width: 100%; }
.adventuretime-panel .lh-npc-bar { display: flex; align-items: center; gap: 4px; font-size: 0.85em; }
.adventuretime-panel .lh-npc-bar-icon { flex-shrink: 0; width: 14px; text-align: center; }
.adventuretime-panel .lh-npc-bar-track { flex: 1; height: 6px; background: rgba(127,127,127,0.15); border-radius: 3px; position: relative; overflow: hidden; }
.adventuretime-panel .lh-npc-bar-track::after { content: ''; position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: rgba(255,255,255,0.25); z-index: 1; }
.adventuretime-panel .lh-npc-bar-fill { position: absolute; top: 0; bottom: 0; border-radius: 3px; transition: width 0.3s ease; }
.adventuretime-panel .lh-npc-bar-fill--up { left: 50%; }
.adventuretime-panel .lh-npc-bar-fill--down { right: 50%; }
.adventuretime-panel .lh-npc-bar-fill--friendship.lh-npc-bar-fill--up { background: linear-gradient(90deg, #4ade8088, #4ade80); }
.adventuretime-panel .lh-npc-bar-fill--friendship.lh-npc-bar-fill--down { background: linear-gradient(270deg, #ef444488, #ef4444); }
.adventuretime-panel .lh-npc-bar-fill--affection.lh-npc-bar-fill--up { background: linear-gradient(90deg, #f472b688, #f472b6); }
.adventuretime-panel .lh-npc-bar-fill--affection.lh-npc-bar-fill--down { background: linear-gradient(270deg, #a855f788, #a855f7); }
.adventuretime-panel .lh-npc-bar-value { flex-shrink: 0; width: 30px; text-align: right; font-family: var(--lh-font-mono, var(--lumiverse-font-mono, monospace)); font-weight: 700; line-height: 1; opacity: 0.6; }
.adventuretime-panel .lh-npc-bar-value--friendship-up { color: #4ade80; opacity: 1; }
.adventuretime-panel .lh-npc-bar-value--friendship-down { color: #ef4444; opacity: 1; }
.adventuretime-panel .lh-npc-bar-value--affection-up { color: #f472b6; opacity: 1; }
.adventuretime-panel .lh-npc-bar-value--affection-down { color: #a855f7; opacity: 1; }
.adventuretime-panel .lh-npc-tiers { display: flex; gap: 5px; margin-top: 3px; flex-wrap: wrap; }
.adventuretime-panel .lh-npc-tier { display: inline-block; font-size: 0.72em; font-weight: 700; letter-spacing: 0.3px; padding: 2px 7px; border-radius: 8px; white-space: nowrap; text-transform: uppercase; cursor: help; }
.adventuretime-panel .lh-npc-actions { display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap; align-items: center; }
.adventuretime-panel .lh-npc-action { background: none; border: 1px solid rgba(127,127,127,0.3); color: inherit; cursor: pointer; font-size: 0.9em; padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; opacity: 0.5; line-height: 1.2; }
.adventuretime-panel .lh-npc-action--view { opacity: 1; color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); border-color: var(--lh-accent-dim, var(--lumiverse-border, rgba(212,169,64,0.4))); }
.adventuretime-panel .lh-npc-card:hover .lh-npc-action { opacity: 0.9; }
.adventuretime-panel .lh-npc-action:hover { opacity: 1; border-color: rgba(127,127,127,0.6); background: rgba(127,127,127,0.1); }
.adventuretime-panel .lh-npc-action--on { opacity: 1; color: var(--lumiverse-success, #34a853); }
.adventuretime-panel .lh-npc-card .lh-records-entry { flex: 1 1 100%; width: 100%; box-sizing: border-box; margin: 6px 0 0; border-left: none; border-top: 1px solid rgba(127,127,127,0.2); padding: 6px 0 0; cursor: default; }
.adventuretime-panel .lh-npc-card .lh-records-mapform { flex: 1 1 100%; }
.adventuretime-panel .lh-npc-full { display: flex; flex-direction: column; gap: 14px; font-size: 0.9em; }
.adventuretime-panel .lh-npc-full-head { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; }
.adventuretime-panel .lh-npc-full-portrait { flex: 0 0 200px; width: 200px; max-width: 100%; aspect-ratio: 1; border-radius: 12px; overflow: hidden; border: 2px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(212,169,64,0.3))); background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; font-size: 64px; }
.adventuretime-panel .lh-npc-full-portrait img { width: 100%; height: 100%; object-fit: cover; display: block; cursor: zoom-in; }
.adventuretime-panel .lh-npc-full-title { flex: 1 1 220px; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.adventuretime-panel .lh-npc-full-name { font-size: 1.6em; font-weight: 700; color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); line-height: 1.2; overflow-wrap: anywhere; }
.adventuretime-panel .lh-npc-full-buttons { display: flex; gap: 6px; flex-wrap: wrap; }
.adventuretime-panel .lh-npc-full-sections { display: flex; flex-direction: column; gap: 6px; }
.adventuretime-panel .lh-npc-full-sections .lh-records-entry { margin: 0; padding: 0; border: none; font-size: 1em; }
.adventuretime-panel .lh-npc-full-bars { display: flex; flex-direction: column; gap: 12px; border-top: 1px solid rgba(127,127,127,0.2); padding-top: 12px; }
.adventuretime-panel .lh-npc-full-axis { display: grid; grid-template-columns: auto 80px 1fr 56px; align-items: center; column-gap: 12px; row-gap: 6px; }
.adventuretime-panel .lh-npc-full-axis .lh-npc-bar-icon { font-size: 1.4em; width: auto; }
.adventuretime-panel .lh-npc-full-axis .lh-npc-bar-track { height: 12px; border-radius: 6px; }
.adventuretime-panel .lh-npc-full-axis input[type="number"] { width: 56px; box-sizing: border-box; text-align: right; font-family: var(--lh-font-mono, var(--lumiverse-font-mono, monospace)); font-weight: 700; }
.adventuretime-panel .lh-npc-full-axis input[type="range"] { grid-column: 3; width: 100%; margin: 0; height: 4px; cursor: pointer; }
.adventuretime-panel .lh-npc-full-tier { grid-column: 1 / -1; font-size: 0.95em; padding: 6px 10px; border-radius: 8px; line-height: 1.4; }
.adventuretime-panel .lh-npc-full-tier b { margin-right: 4px; }
.adventuretime-panel .lh-npc-full-log { border-top: 1px solid rgba(127,127,127,0.2); padding-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.adventuretime-panel .lh-npc-full-log-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 0.8em; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; opacity: 0.6; }
.adventuretime-panel .lh-npc-full-log table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
.adventuretime-panel .lh-npc-full-log td { padding: 3px 8px 3px 0; white-space: nowrap; }
.adventuretime-panel .lh-npc-full-log td.lh-npc-full-log-delta { font-family: var(--lh-font-mono, var(--lumiverse-font-mono, monospace)); font-weight: 700; }
.adventuretime-panel .lh-npc-full-log td.lh-npc-full-log-who { opacity: 0.6; white-space: normal; }
.adventuretime-panel .lh-npc-full-note { font-size: 0.9em; opacity: 0.85; min-height: 1em; }
.adventuretime-panel .lh-npc-full-ai { display: flex; flex-direction: column; gap: 8px; }
.adventuretime-panel .lh-npc-full-ai[hidden], .adventuretime-panel .lh-npc-full-ai-review[hidden] { display: none; }
.adventuretime-panel .lh-npc-full-ai-head { font-size: 0.75em; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; opacity: 0.8; }
.adventuretime-panel .lh-npc-full-ai textarea.lh-input { width: 100%; box-sizing: border-box; resize: vertical; font: inherit; font-size: 0.9em; line-height: 1.5; }
.adventuretime-panel .lh-npc-full-ai-instructions { min-height: 5em; }
.adventuretime-panel .lh-npc-full-ai-preview { min-height: 16em; font-family: ui-monospace, monospace; }
.adventuretime-panel .lh-npc-full-ai-review { display: flex; flex-direction: column; gap: 8px; }
.adventuretime-panel .lh-npc-full-note--error { color: var(--lumiverse-danger, #d9534f); opacity: 1; }
.adventuretime-panel .lh-details-modal .lh-player-card > summary, .adventuretime-panel .lh-details-modal .lh-library > summary, .adventuretime-panel .lh-details-modal .lh-npc-creator > summary { display: none; }
`

const KIND_ICON: Record<RecordBookDTO['kind'], string> = { npc: '👤', location: '🗺️', world: '🌍', skeleton: '🦴', other: '📁' }

/**
 * The prose's lines with the agent's turn stamp read off each (73a-ter): a line
 * that is nothing but `[msg #N]` is *written at message N*, a line that opens
 * with one carries *message N* before its prose, and any other line is itself.
 */
export function stampLines(text: string): Array<{ stamp: number | null; note: string; text: string }> {
    return text.split('\n').map((line) => {
        const match = line.match(/^\s*\[msg #(\d+)\]\s*(.*)$/)
        if (!match) return { stamp: null, note: '', text: line }
        const stamp = Number(match[1])
        const rest = match[2] ?? ''
        return { stamp, note: rest ? `message ${stamp}` : `written at message ${stamp}`, text: rest }
    })
}

/** The prose drawn with its stamps as dim notes rather than brackets. */
function drawText(text: string): HTMLElement {
    const box = document.createElement('div')
    box.className = 'lh-records-text'
    stampLines(text).forEach((line, index) => {
        if (index) box.append(document.createTextNode('\n'))
        if (line.stamp !== null) {
            const note = document.createElement('span')
            note.className = 'lh-records-stamp'
            note.title = `The agent wrote this at message ${line.stamp}.`
            note.textContent = line.note
            box.append(note)
            if (line.text) box.append(document.createTextNode(` ${line.text}`))
        } else {
            box.append(document.createTextNode(line.text))
        }
    })
    return box
}

/** The fields of an NPC's `[CORE]`, when the text carries one: `Key: value` lines, the rest under *Notes*. */
export function coreFields(content: string): Array<[string, string]> | null {
    const match = content.match(/\[CORE\]([\s\S]*?)\[\/CORE\]/i)
    if (!match) return null
    const out: Array<[string, string]> = []
    const notes: string[] = []
    for (const raw of match[1]!.split('\n')) {
        const line = raw.trim()
        if (!line) continue
        const pair = line.match(/^([A-Za-z][\w /&'-]{0,40}):\s*(.*)$/)
        if (pair) out.push([pair[1]!, pair[2]!])
        else if (out.length) out[out.length - 1]![1] += `\n${line}`
        else notes.push(line)
    }
    if (notes.length) out.unshift(['Notes', notes.join('\n')])
    return out
}

/** The folder's entries as a two-level tree: roots in the book's order, each with its `Root :: …` children; a root with no entry of its own is virtual. */
export function treeOf(entries: readonly RecordEntryDTO[]): Array<{ root: string; entry: RecordEntryDTO | null; children: RecordEntryDTO[] }> {
    const nodes = new Map<string, { root: string; entry: RecordEntryDTO | null; children: RecordEntryDTO[] }>()
    const order: string[] = []
    const rootOf = (title: string) => title.split('::')[0]!.trim().toLowerCase()
    const place = (key: string, title: string) => {
        if (!nodes.has(key)) { nodes.set(key, { root: title.split('::')[0]!.trim(), entry: null, children: [] }); order.push(key) }
        return nodes.get(key)!
    }
    for (const entry of entries) {
        const title = entry.title || '(untitled)'
        const node = place(rootOf(title), title)
        if (entry.root || !entry.title) { if (node.entry) node.children.push(entry); else { node.entry = entry; node.root = entry.title || '(untitled)' } } else node.children.push(entry)
    }
    for (const node of nodes.values()) node.children.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
    return order.map((key) => nodes.get(key)!)
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

export function createRecordsFold(host: RecordsFoldHost): RecordsFold {
    const { el } = host
    const root = el('details', { class: 'lh-records', 'data-lh-field': 'records' }) as HTMLDetailsElement
    const summary = el('summary')
    summary.textContent = 'Campaign records'
    const body = el('div', { class: 'lh-records-body' })
    const lead = el('div', { class: 'lh-records-lead' })
    lead.textContent = 'The campaign’s books as folders, with every entry the agent and the passes have filed: open one to read it, edit it, pin it so it is always in the prompt, clean it through the agent, or delete it. A location root can be given a map here, the narrator not involved.'
    const bar = el('div', { class: 'lh-records-bar' })
    const refresh = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'records-refresh' }) as HTMLButtonElement
    refresh.textContent = 'Refresh'
    refresh.addEventListener('click', () => { load().catch(host.fail) })
    bar.append(refresh)
    const folders = el('div', { class: 'lh-records-folders' })
    const live = el('div', { class: 'lh-world-running', hidden: 'hidden' })
    const note = el('div', { class: 'lh-records-note', 'data-lh-field': 'records-note' })
    body.append(lead, bar, folders, live, note)
    root.append(summary, body)

    let chatId: string | null = null
    let result: CampaignRecordsResult | null = null
    let loading: Promise<void> | null = null
    let loaded = false
    const openFolders = new Set<string>()
    const openEntries = new Set<string>()
    const editing = new Map<string, { title: string; keys: string; content: string }>()
    const cleaning = new Set<string>()
    /** The map form's place: the folder (a new root) or a root entry; one at a time. */
    let mapForm: { bookName: string; entry: RecordEntryDTO | null } | null = null
    let running: { what: string } | null = null
    let last: { text: string; error: boolean } | null = null
    let cards: CardChoice[] | null = null
    /** The standings (44) and the Player Card (35b), read beside the books; null until read or when unreadable. */
    let relations: RelationshipsView | null = null
    let playerCard: PlayerCardView | null = null
    /** The Full NPC Card open in the modal, or a gear: closed on a chat change and when its entry goes. */
    let modal: { id: string | null; box: DetailsModal } | null = null
    let fullCard: { id: string; sections: HTMLElement; log: HTMLElement; bars: HTMLElement; note: HTMLElement; aiOpen: boolean } | null = null

    function say(text: string, error = false): void {
        last = { text, error }
        draw()
    }

    async function load(): Promise<void> {
        if (!chatId) { result = null; relations = null; playerCard = null; draw(); return }
        if (loading) return loading
        const asked = chatId
        loading = Promise.all([
            host.list()
                .then((answer) => { if (chatId === asked) { result = answer; loaded = true } })
                .catch((error) => { if (chatId === asked) result = { prefix: '', books: [], mapping: false, mapped: [], allBooks: [], problem: describe(error) } }),
            readRelations(asked),
            readPlayerCard(asked),
        ]).then(() => undefined).finally(() => { loading = null; draw() })
        draw()
        return loading
    }

    /** The standings, failing soft: the cards draw without bars when they cannot be read. */
    async function readRelations(asked: string): Promise<void> {
        if (!host.relations) return
        try {
            const view = await host.relations()
            if (chatId === asked) { relations = view; host.onRelations?.(view) }
        } catch {
            if (chatId === asked) relations = null
        }
    }

    async function readPlayerCard(asked: string): Promise<void> {
        if (!host.playerCard) return
        try {
            const view = await host.playerCard()
            if (chatId === asked) playerCard = view
        } catch {
            if (chatId === asked) playerCard = null
        }
    }

    async function run<T>(what: string, work: () => Promise<T>): Promise<T | undefined> {
        if (running) { say(`Wait for the ${running.what} to finish.`, true); return undefined }
        running = { what }
        draw()
        try {
            return await work()
        } catch (error) {
            say(describe(error), true)
            host.fail(error)
            return undefined
        } finally {
            running = null
            draw()
        }
    }

    // ── the writes ───────────────────────────────────────────────────────

    async function saveEdit(entry: RecordEntryDTO): Promise<void> {
        const draft = editing.get(entry.id)
        if (!draft) return
        const answer = await run('save', () => host.update({ entryId: entry.id, title: draft.title, keys: draft.keys.split(/[,;\n]/).map((k) => k.trim()).filter(Boolean), content: draft.content }))
        if (!answer) return
        editing.delete(entry.id)
        say(`Saved “${answer.entry.title}”.`)
        await load()
    }

    async function removeEntry(entry: RecordEntryDTO): Promise<void> {
        const what = entry.hasMap ? `Delete “${entry.title}” and the map it holds? The map’s evolution history goes with it.` : `Delete the entry “${entry.title}”?`
        if (!(await host.confirm('Delete this entry', what, 'Delete'))) return
        const answer = await run('delete', () => host.remove(entry.id))
        if (!answer) return
        openEntries.delete(entry.id)
        editing.delete(entry.id)
        say(`Deleted “${answer.title}”.`)
        if (entry.hasMap) host.onMapsChanged()
        await load()
    }

    async function togglePin(entry: RecordEntryDTO): Promise<void> {
        const answer = await run('pin', () => host.pin(entry.id, !entry.pinned))
        if (!answer) return
        say(answer.entry.pinned ? `Pinned “${answer.entry.title}”: always in the prompt.` : `Unpinned “${answer.entry.title}”.`)
        await load()
    }

    async function removeMap(entry: RecordEntryDTO): Promise<void> {
        if (!(await host.confirm('Remove the map', `Remove the private map from “${entry.title}”? The Location entry and its CORE stay; the site’s evolution history is cleared.`, 'Remove the map'))) return
        const answer = await run('map removal', () => host.removeMap(entry.id))
        if (!answer) return
        say(`Removed the map from “${answer.siteRoot}”.`)
        host.onMapsChanged()
        await load()
    }

    async function bookmark(entry: RecordEntryDTO): Promise<void> {
        const answer = await run('save to the library', async () => {
            const first = await host.saveToLibrary(entry.id, false)
            if ('status' in first && first.status === 'exists') {
                if (!(await host.confirm('NPC library', `“${first.name}” is already in the library. Replace it?`, 'Replace'))) return null
                return host.saveToLibrary(entry.id, true)
            }
            return first
        })
        if (!answer) return
        say(`Saved “${answer.name}” to the NPC library.`)
        host.onLibraryChanged()
    }

    async function clean(entry: RecordEntryDTO, bookName: string, requirements: string): Promise<void> {
        cleaning.delete(entry.id)
        // A title stamped before 73a comes off here, by the fold's own hand (73a-ter):
        // the agent's pass may leave the entry as it stands, and then wrote nothing.
        const plain = stripStamp(entry.title)
        const retitled = plain !== entry.title.trim()
        const done = await run('clean', async () => {
            if (retitled) await host.update({ entryId: entry.id, title: plain, keys: entry.keys, content: entry.content })
            await host.clean(`${bookName}::${entry.uid}`, requirements.trim())
            return true
        })
        if (!done) return
        say(`The agent cleaned “${plain}”${retitled ? ', and the stamp is off its title' : ''}; its report is in the agent’s box.`)
        await load()
    }

    async function setRelation(id: string, field: RelationshipField, value: number): Promise<void> {
        if (!host.setRelation) return
        const view = await run('relationship value', () => host.setRelation!(id, field, value))
        if (!view) return
        relations = view
        const npc = view.npcs.find((n) => n.id === id)
        say(`${npc?.label ?? 'The NPC'}’s ${field} is set to ${signed(npc?.[field] ?? value)}.`)
    }

    /** Multihog's Clear Log (80), in its words: the history alone; the values and the entry stay. */
    async function clearRelationLog(id: string, label: string): Promise<void> {
        if (!host.clearRelationLog) return
        if (!(await host.confirm('Clear Log', 'Clear relationship history log for this NPC? (This cannot be undone)', 'Clear Log'))) return
        const view = await run('clearing the log', () => host.clearRelationLog!(id))
        if (!view) return
        relations = view
        say(`${label}’s relationship history is cleared; the values stand.`)
    }

    async function forgetRelation(id: string, label: string): Promise<void> {
        if (!host.forgetRelation) return
        if (!(await host.confirm('Forget the standing', `Forget ${label}’s friendship and affection? The values and their history go; the entry stays.`, 'Forget'))) return
        const view = await run('forgetting', () => host.forgetRelation!(id))
        if (!view) return
        relations = view
        say(`${label}’s standing is forgotten.`)
    }

    async function bookmarkPlayerCard(name: string): Promise<void> {
        if (!host.savePlayerCardToLibrary) return
        const answer = await run('save to the library', async () => {
            const first = await host.savePlayerCardToLibrary!(false)
            if ('status' in first && first.status === 'exists') {
                if (!(await host.confirm('NPC library', `“${first.name}” is already in the library. Replace it?`, 'Replace'))) return null
                return host.savePlayerCardToLibrary!(true)
            }
            return first
        })
        if (!answer) return
        say(`Saved “${answer.name || name}” to the NPC library.`)
        host.onLibraryChanged()
    }

    async function unlinkPlayerCard(name: string): Promise<void> {
        if (!host.removePlayerCard) return
        if (!(await host.confirm('Unlink the Player Character', `Remove the Player Card for “${name}” from this chat? The narrator stops seeing it; the sheet in the tracker stays.`, 'Remove'))) return
        const done = await run('removal', async () => { await host.removePlayerCard!(); return true })
        if (!done) return
        say('The Player Card was removed.')
        await load()
    }

    // ── the modal: the Full cards, the manager, the gears ───────────────

    /** Open the panel's nodes in the host's modal; `false` when the host has none. */
    function openModal(id: string | null, title: string, nodes: HTMLElement[], width?: number): boolean {
        if (!host.modal) return false
        closeModal()
        for (const node of nodes) {
            if (node instanceof HTMLDetailsElement && !node.open) { node.open = true; node.dispatchEvent(new Event('toggle')) }
        }
        const box = host.modal({ title, nodes, ...(width ? { width } : {}), onClose: () => { if (modal?.box === box) modal = null; if (fullCard?.id === id) fullCard = null } })
        if (!box) return false
        modal = { id, box }
        return true
    }

    function closeModal(): void {
        const open = modal
        modal = null
        fullCard = null
        open?.box.close()
    }

    // ── the map form ─────────────────────────────────────────────────────

    function drawMapForm(bookName: string, entry: RecordEntryDTO | null): HTMLElement {
        const site = entry?.title ?? ''
        const form = el('div', { class: 'lh-records-mapform', 'data-lh-field': 'records-mapform' })
        const head = el('div')
        head.textContent = entry
            ? `Create a private map for “${site}” with the Map Architect. The narrator is not involved.`
            : 'Create a new location root and generate its private map. The narrator is not involved.'
        form.append(head)
        const field = (label: string, input: HTMLElement) => { const box = el('label', { class: 'lh-records-mapform-field' }); const text = el('span'); text.textContent = label; box.append(text, input); return box }
        let nameInput: HTMLInputElement | null = null
        if (!entry) {
            nameInput = el('input', { type: 'text', class: 'lh-input', placeholder: 'Exact site root, no ::', 'data-lh-field': 'mapform-name' }) as HTMLInputElement
            form.append(field('Location name', nameInput))
        }
        const modeRow = el('div', { class: 'lh-records-mapform-row' })
        const modes: HTMLInputElement[] = []
        for (const [value, text] of [['auto', 'Auto'], ['manual', 'Manual']] as const) {
            const label = el('label')
            const radio = el('input', { type: 'radio', name: `lh-mapform-mode-${site || 'new'}`, value }) as HTMLInputElement
            radio.checked = value === 'auto'
            const span = el('span'); span.textContent = text
            label.append(radio, span)
            modeRow.append(label)
            modes.push(radio)
        }
        form.append(modeRow)
        // Auto: the brief and the lookback.
        const auto = el('div', { class: 'lh-records-form', 'data-lh-field': 'mapform-auto' })
        const autoLead = el('div', { class: 'lh-records-hint' })
        autoLead.textContent = 'The architect fills entrance, kind, scale, threat, a detailed generation prompt and a brief description from the location’s lore, your brief and the recent story, then draws the map.'
        const brief = el('textarea', { class: 'lh-input', rows: '3', placeholder: 'What this place is. The architect fills the rest.', 'data-lh-field': 'mapform-brief' }) as HTMLTextAreaElement
        const lookback = el('input', { type: 'number', min: '0', max: '100', step: '1', class: 'lh-input', 'data-lh-field': 'mapform-lookback' }) as HTMLInputElement
        lookback.value = '12'
        const lookbackHint = el('div', { class: 'lh-records-hint' })
        lookbackHint.textContent = '0 reads no recent chat: the name, the lore and the brief alone.'
        auto.append(autoLead, field('Brief', brief), field('Story lookback (messages)', lookback), lookbackHint)
        // Manual: everything the call would carry.
        const manual = el('div', { class: 'lh-records-form', 'data-lh-field': 'mapform-manual' })
        manual.hidden = true
        const keys = el('input', { type: 'text', class: 'lh-input', placeholder: 'Optional aliases, comma-separated', 'data-lh-field': 'mapform-keys' }) as HTMLInputElement
        const keysHint = el('div', { class: 'lh-records-hint' })
        keysHint.textContent = 'The location name is added first. Six keywords at most.'
        const kindRow = el('div', { class: 'lh-records-mapform-row' })
        const kinds: HTMLInputElement[] = []
        const threat = el('select', { class: 'lh-input', 'data-lh-field': 'mapform-threat' }) as HTMLSelectElement
        for (const t of ['NONE', 'LOW', 'MODERATE', 'HIGH', 'DEADLY']) { const o = el('option', { value: t }) as HTMLOptionElement; o.textContent = t; threat.append(o) }
        threat.value = 'MODERATE'
        for (const [value, text, defaultThreat] of [['SETTLEMENT', 'Settlement', 'MODERATE'], ['DUNGEON', 'Dungeon', 'HIGH'], ['INTERIOR', 'Interior', 'LOW']] as const) {
            const label = el('label')
            const radio = el('input', { type: 'radio', name: `lh-mapform-kind-${site || 'new'}`, value }) as HTMLInputElement
            radio.checked = value === 'SETTLEMENT'
            radio.addEventListener('change', () => { if (radio.checked) threat.value = defaultThreat })
            const span = el('span'); span.textContent = text
            label.append(radio, span)
            kindRow.append(label)
            kinds.push(radio)
        }
        const entrance = el('input', { type: 'text', class: 'lh-input', 'data-lh-field': 'mapform-entrance' }) as HTMLInputElement
        entrance.value = 'Entrance'
        const scale = el('select', { class: 'lh-input', 'data-lh-field': 'mapform-scale' }) as HTMLSelectElement
        for (const s of ['SMALL', 'MEDIUM', 'LARGE']) { const o = el('option', { value: s }) as HTMLOptionElement; o.textContent = s; scale.append(o) }
        scale.value = 'MEDIUM'
        const premise = entry ? premiseFromLocationContent(entry.content) : ''
        const prompt = el('textarea', { class: 'lh-input', rows: '5', placeholder: 'Detailed private facts and creative guidance for the architect', 'data-lh-field': 'mapform-prompt' }) as HTMLTextAreaElement
        prompt.value = entry ? (premise || `${site} is a location root requested for a Persistent Map. Stay consistent with established story.`) : ''
        const description = el('input', { type: 'text', class: 'lh-input', placeholder: 'A brief current description, for the CORE and the map gateways', 'data-lh-field': 'mapform-description' }) as HTMLInputElement
        description.value = entry ? briefDescriptionFromPrompt(prompt.value, site) : ''
        const sizeRow = el('div', { class: 'lh-records-mapform-row' })
        sizeRow.append(field('Scale', scale), field('Threat', threat))
        const peers = el('details')
        const peersSummary = el('summary'); peersSummary.textContent = 'Absorb existing mapped peers (a settlement only)'
        const peersBox = el('div', { class: 'lh-records-ticks', 'data-lh-field': 'mapform-include' })
        const eligible = (result?.mapped ?? []).filter((m) => ['DUNGEON', 'INTERIOR'].includes(m.kind) && !m.hosted && m.siteRoot !== site)
        if (!eligible.length) { const none = el('span', { class: 'lh-records-hint' }); none.textContent = 'No eligible DUNGEON or INTERIOR peers.'; peersBox.append(none) }
        for (const m of eligible) {
            const label = el('label')
            const tick = el('input', { type: 'checkbox', 'data-lh-include': m.siteRoot }) as HTMLInputElement
            const span = el('span'); span.textContent = `${m.siteRoot} (${m.kind})`
            label.append(tick, span)
            peersBox.append(label)
        }
        peers.append(peersSummary, peersBox)
        manual.append(field('Extra keywords', keys), keysHint, kindRow, field('Entrance', entrance), sizeRow, field('Map-generation prompt', prompt), field('Brief description', description), peers)
        form.append(auto, manual)
        for (const radio of modes) radio.addEventListener('change', () => { const isManual = modes.find((r) => r.checked)?.value === 'manual'; auto.hidden = isManual; manual.hidden = !isManual })
        // The reference context: lorebooks by name, cards by id.
        const reference = el('details')
        const referenceSummary = el('summary'); referenceSummary.textContent = 'Optional reference context'
        const referenceHint = el('div', { class: 'lh-records-hint' })
        referenceHint.textContent = 'What is ticked is sent to the architect as established canon, whatever the lookback says.'
        const booksLabel = el('div'); booksLabel.textContent = 'Lorebooks'
        const booksBox = el('div', { class: 'lh-records-ticks', 'data-lh-field': 'mapform-lorebooks' })
        for (const name of result?.allBooks ?? []) {
            const label = el('label')
            const tick = el('input', { type: 'checkbox', 'data-lh-lorebook': name }) as HTMLInputElement
            const span = el('span'); span.textContent = name
            label.append(tick, span)
            booksBox.append(label)
        }
        if (!(result?.allBooks ?? []).length) { const none = el('span', { class: 'lh-records-hint' }); none.textContent = 'No lorebooks.'; booksBox.append(none) }
        const cardsLabel = el('div'); cardsLabel.textContent = 'Character cards'
        const cardsBox = el('div', { class: 'lh-records-ticks', 'data-lh-field': 'mapform-cards' })
        const drawCards = () => {
            cardsBox.replaceChildren()
            if (!cards) { const wait = el('span', { class: 'lh-records-hint' }); wait.textContent = 'Listing the cards…'; cardsBox.append(wait); return }
            if (!cards.length) { const none = el('span', { class: 'lh-records-hint' }); none.textContent = 'No cards.'; cardsBox.append(none) }
            for (const card of cards) {
                const label = el('label')
                const tick = el('input', { type: 'checkbox', 'data-lh-card': card.id }) as HTMLInputElement
                const span = el('span'); span.textContent = card.name
                label.append(tick, span)
                cardsBox.append(label)
            }
        }
        drawCards()
        if (!cards) host.cards().then((list) => { cards = list; drawCards() }).catch((error) => { cards = []; drawCards(); host.fail(error) })
        reference.append(referenceSummary, referenceHint, booksLabel, booksBox, cardsLabel, cardsBox)
        form.append(reference)
        const actions = el('div', { class: 'lh-records-form-actions' })
        const go = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'mapform-go' }) as HTMLButtonElement
        go.textContent = entry ? 'Generate map' : 'Create location and map'
        const cancel = el('button', { type: 'button', class: 'lh-button lh-button--quiet' }) as HTMLButtonElement
        cancel.textContent = 'Cancel'
        cancel.addEventListener('click', () => { mapForm = null; draw() })
        go.addEventListener('click', () => {
            const name = (nameInput?.value ?? site).trim()
            if (!name) { say('A location name is required.', true); return }
            if (name.includes('::')) { say('Use a location root name, not a nested :: path.', true); return }
            const mode = modes.find((r) => r.checked)?.value === 'manual' ? 'manual' : 'auto'
            const ticked = (box: HTMLElement, attr: string) => Array.from(box.querySelectorAll<HTMLInputElement>('input:checked')).map((i) => i.getAttribute(attr) ?? '').filter(Boolean)
            const request: Record<string, unknown> = {
                site: name,
                mode,
                requireNew: !entry,
                lorebooks: ticked(booksBox, 'data-lh-lorebook'),
                cards: ticked(cardsBox, 'data-lh-card'),
            }
            if (mode === 'auto') {
                request.brief = brief.value
                request.lookback = Math.max(0, Math.min(100, Math.floor(Number(lookback.value) || 0)))
            } else {
                if (!prompt.value.trim() || !description.value.trim()) { say('Map-generation prompt and brief description are required.', true); return }
                request.kind = kinds.find((r) => r.checked)?.value ?? 'SETTLEMENT'
                request.entrance = entrance.value.trim() || 'Entrance'
                request.scale = scale.value
                request.threat = threat.value
                request.prompt = prompt.value
                request.briefDescription = description.value
                request.include = ticked(peersBox, 'data-lh-include')
            }
            if (!entry) request.keywords = keys.value.split(/[,;\n]/).map((k) => k.trim()).filter(Boolean)
            createMap(name, request).catch(host.fail)
        })
        actions.append(cancel, go)
        form.append(actions)
        return form
    }

    async function createMap(site: string, request: Record<string, unknown>): Promise<void> {
        const answer = await run(`map of “${site}”`, () => host.create(request))
        if (!answer) return
        if (answer.status === 'written') {
            mapForm = null
            say(`Drew ${answer.site}${answer.kind ? ` (${answer.kind})` : ''}: ${answer.areas ?? 0} areas, ${answer.assets ?? 0} things in them${answer.entryId ? `, saved to ${answer.entryId}` : ''}.`)
            host.onMapsChanged()
            await load()
        } else if (answer.status === 'reused') {
            mapForm = null
            say(`${answer.site} was already mapped; the map stands.`)
        } else {
            say(`The architect failed for ${answer.site}: ${answer.reason ?? 'no reason given'}`, true)
        }
    }

    // ── the drawing ──────────────────────────────────────────────────────

    function drawEntryBody(entry: RecordEntryDTO, book: RecordBookDTO, child: boolean): HTMLElement {
        const box = el('div', { class: `lh-records-entry${child ? ' lh-records-entry--child' : ''}`, 'data-lh-entry-body': entry.id })
        const draft = editing.get(entry.id)
        if (draft) {
            const form = el('div', { class: 'lh-records-form', 'data-lh-field': 'records-edit' })
            const title = el('input', { type: 'text', class: 'lh-input', 'data-lh-field': 'records-edit-title' }) as HTMLInputElement
            title.value = draft.title
            title.addEventListener('input', () => { draft.title = title.value })
            const keys = el('input', { type: 'text', class: 'lh-input', placeholder: 'keyword, keyword…', 'data-lh-field': 'records-edit-keys' }) as HTMLInputElement
            keys.value = draft.keys
            keys.addEventListener('input', () => { draft.keys = keys.value })
            const text = el('textarea', { class: 'lh-input', 'data-lh-field': 'records-edit-content' }) as HTMLTextAreaElement
            text.value = draft.content
            text.addEventListener('input', () => { draft.content = text.value })
            const field = (label: string, input: HTMLElement) => { const l = el('label'); const s = el('span'); s.textContent = label; l.append(s, input); return l }
            form.append(field('Title', title), field('Keys', keys), field('Content', text))
            if (entry.hasMap) { const hint = el('div', { class: 'lh-records-hint' }); hint.textContent = 'The [MAP] section is kept as it stands; the raw JSON editor in the Maps fold is its way.'; form.append(hint) }
            const actions = el('div', { class: 'lh-records-form-actions' })
            const cancel = el('button', { type: 'button', class: 'lh-button lh-button--quiet' }) as HTMLButtonElement
            cancel.textContent = 'Cancel'
            cancel.addEventListener('click', () => { editing.delete(entry.id); draw() })
            const save = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'records-edit-save' }) as HTMLButtonElement
            save.textContent = 'Save'
            save.disabled = !!running
            save.addEventListener('click', () => { saveEdit(entry).catch(host.fail) })
            actions.append(cancel, save)
            form.append(actions)
            box.append(form)
            return box
        }
        const keys = el('div', { class: 'lh-records-keys' })
        keys.textContent = entry.keys.length ? `Keys: ${entry.keys.join(', ')}` : 'No keywords.'
        box.append(keys)
        const fields = book.kind === 'npc' ? coreFields(entry.content) : null
        if (fields?.length) {
            const dl = el('dl', { class: 'lh-records-core' })
            for (const [key, value] of fields) { const dt = el('dt'); dt.textContent = key; const dd = el('dd'); dd.textContent = value; dl.append(dt, dd) }
            box.append(dl)
            const rest = entry.content.replace(/\[CORE\][\s\S]*?\[\/CORE\]/i, '').trim()
            if (rest) box.append(drawText(rest))
        } else {
            box.append(drawText(entry.content || '(Empty)'))
        }
        if (cleaning.has(entry.id)) {
            const form = el('div', { class: 'lh-records-form', 'data-lh-field': 'records-clean' })
            const lead = el('div', { class: 'lh-records-hint' })
            lead.textContent = `A targeted cleanup pass for “${entry.title}”: the agent rewrites it shorter, keeping every fact. Requirements of your own, if any:`
            const text = el('textarea', { class: 'lh-input', rows: '2', placeholder: 'Leave blank for the standard compression…', 'data-lh-field': 'records-clean-text' }) as HTMLTextAreaElement
            const actions = el('div', { class: 'lh-records-form-actions' })
            const cancel = el('button', { type: 'button', class: 'lh-button lh-button--quiet' }) as HTMLButtonElement
            cancel.textContent = 'Cancel'
            cancel.addEventListener('click', () => { cleaning.delete(entry.id); draw() })
            const go = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'records-clean-go' }) as HTMLButtonElement
            go.textContent = 'Clean entry'
            go.disabled = !!running
            go.addEventListener('click', () => { clean(entry, book.name, text.value).catch(host.fail) })
            actions.append(cancel, go)
            form.append(lead, text, actions)
            box.append(form)
        }
        return box
    }

    function iconButton(text: string, title: string, field: string, on: () => void, lit = false): HTMLButtonElement {
        const button = el('button', { type: 'button', class: `lh-records-icon${lit ? ' lh-records-icon--on' : ''}`, title, 'aria-label': title, 'data-lh-field': field }) as HTMLButtonElement
        button.textContent = text
        button.disabled = !!running
        button.addEventListener('click', (event) => { event.stopPropagation(); on() })
        return button
    }

    // ── Multihog's cards (78b) ───────────────────────────────────────────

    /** The standing of an entry: `Book::uid` is the relationship store's key. */
    function standingOf(entry: RecordEntryDTO, book: RecordBookDTO): RelationshipsView['npcs'][number] | null {
        if (!relations?.enabled) return null
        return relations.npcs.find((n) => n.id === `${book.name}::${entry.uid}`) ?? null
    }

    /**
     * The portrait on a card or the Full card: a click opens it large with
     * its buttons under it (80, Multihog's portrait menu on the box); a box
     * with no portrait yet opens the same view, with the ways to get one.
     */
    function portraitBox(name: string, large: boolean): HTMLElement {
        const src = host.portrait?.(name) ?? ''
        const box = el('div', { class: large ? 'lh-npc-full-portrait' : `lh-npc-portrait${src ? '' : ' lh-npc-portrait--empty'}` })
        const actions = host.portraitActions ? () => host.portraitActions!(name) : undefined
        if (src) {
            const img = el('img', { src, alt: name }) as HTMLImageElement
            zoomable(img, src, name, host.enlarge, actions)
            if (host.enlarge) img.title = `${name} — click to see it large${actions ? ', or to change it' : ''}`
            box.append(img)
        } else {
            box.textContent = '👤'
            box.title = 'No portrait yet'
            zoomable(box, '', name, host.enlarge, actions)
        }
        return box
    }

    /** One of Multihog's dual-direction bars: the fill from the centre, the signed value beside it. */
    function barRow(field: RelationshipField, value: number, max: number): HTMLElement {
        const clamped = clampRelationshipValue(value, max)
        const pct = relationshipBarPct(clamped, max)
        const dir = clamped >= 0 ? 'up' : 'down'
        const row = el('div', { class: `lh-npc-bar lh-npc-bar--${field}` })
        const icon = el('span', { class: 'lh-npc-bar-icon' })
        icon.textContent = field === 'friendship' ? '🤝' : '💗'
        const track = el('div', { class: 'lh-npc-bar-track', role: 'img', 'aria-label': `${field} ${signed(clamped)} of ${max}` })
        const fill = el('div', { class: `lh-npc-bar-fill lh-npc-bar-fill--${field} lh-npc-bar-fill--${dir}` })
        fill.style.width = `${pct}%`
        track.append(fill)
        const val = el('span', { class: `lh-npc-bar-value${clamped === 0 ? '' : ` lh-npc-bar-value--${field}-${dir}`}` })
        val.textContent = signed(clamped)
        row.append(icon, track, val)
        return row
    }

    function tierPill(field: RelationshipField, value: number, max: number): HTMLElement {
        const tier = tierOf(field, value, max)
        const pill = el('span', { class: `lh-npc-tier lh-npc-tier--${field}`, title: tier.hint, style: tierBadgeStyle(field, value, max) })
        pill.textContent = tier.label
        return pill
    }

    function actionButton(text: string, title: string, field: string, on: () => void, lit = false, view = false): HTMLButtonElement {
        const button = el('button', { type: 'button', class: `lh-npc-action${view ? ' lh-npc-action--view' : ''}${lit ? ' lh-npc-action--on' : ''}`, title, 'aria-label': title, 'data-lh-field': field }) as HTMLButtonElement
        button.textContent = text
        button.disabled = !!running
        button.addEventListener('click', (event) => { event.stopPropagation(); on() })
        return button
    }

    /** The Player Character's card at the top of the manifest. */
    function drawPlayerCard(): HTMLElement | null {
        if (!host.playerCard) return null
        const pc = playerCard?.card ?? null
        const name = pc?.name ?? ''
        const card = el('div', { class: 'lh-npc-card lh-npc-card--pc', 'data-lh-field': 'records-pc' })
        const info = el('div', { class: 'lh-npc-info' })
        const title = el('div', { class: 'lh-npc-name' })
        title.textContent = pc ? name : 'No Player Card yet'
        const desc = el('div', { class: 'lh-npc-desc' })
        desc.textContent = pc ? (synopsis(pc.bio) || pc.bio.slice(0, 260)) : 'The character’s biography, written from the sheet by one model call: Full PC Card writes it.'
        const badge = el('span', { class: 'lh-npc-badge lh-npc-badge--pc' })
        badge.textContent = '👤 Player Character'
        const actions = el('div', { class: 'lh-npc-actions' })
        const panel = host.panels?.playerCard
        if (panel && host.modal) {
            actions.append(actionButton('🪪 Full PC Card', 'View the Player Card: its sections, the persona, the editor', 'records-pc-view', () => {
                openModal(null, pc ? `${name} — Player Card` : 'Player Card', [panel.root], 720)
            }, false, true))
        }
        if (pc && host.savePlayerCardToLibrary) actions.append(actionButton('🔖', 'Save to the NPC library', 'records-pc-bookmark', () => { bookmarkPlayerCard(name).catch(host.fail) }))
        if (panel && host.modal) {
            actions.append(actionButton('✎', pc ? 'Edit the Player Card’s text' : 'Paste a Player Card', 'records-pc-edit', () => {
                if (openModal(null, pc ? `${name} — Player Card` : 'Player Card', [panel.root], 720)) panel.edit()
            }))
        }
        if (pc && host.removePlayerCard) actions.append(actionButton('⛓️‍💥', 'Unlink the Player Character: remove the card from this chat', 'records-pc-unlink', () => { unlinkPlayerCard(name).catch(host.fail) }))
        info.append(title, desc, badge, actions)
        card.append(portraitBox(name, false), info)
        return card
    }

    /** An NPC as Multihog's card; a click outside the buttons opens the entry inline, as a row's does. */
    function drawNpcCard(entry: RecordEntryDTO, book: RecordBookDTO): HTMLElement {
        const open = openEntries.has(entry.id)
        const card = el('div', { class: `lh-npc-card${open ? ' lh-npc-card--open' : ''}`, 'data-lh-entry': entry.id })
        const info = el('div', { class: 'lh-npc-info' })
        const title = el('div', { class: 'lh-npc-name' })
        const nameText = el('span', { class: 'lh-npc-name-text' })
        nameText.textContent = entry.title || '(untitled)'
        const tokens = el('span', { class: 'lh-records-tokens', title: 'Estimated tokens' })
        tokens.textContent = `${entry.tokens}t`
        title.append(nameText, tokens)
        const desc = el('div', { class: 'lh-npc-desc' })
        desc.textContent = synopsis(entry.content) || entry.content.replace(/\[\/?CORE\]/gi, '').trim().slice(0, 260)
        const status = statusBadge(entry)
        const badge = el('span', { class: `lh-npc-badge lh-npc-badge--${status.kind}`, 'data-lh-field': 'records-status' })
        badge.textContent = status.text
        info.append(title, desc, badge)
        const standing = standingOf(entry, book)
        if (relations?.enabled) {
            const max = relations.max
            const bars = el('div', { class: 'lh-npc-bars', 'data-lh-field': 'records-bars' })
            bars.append(barRow('friendship', standing?.friendship ?? 0, max), barRow('affection', standing?.affection ?? 0, max))
            const tiers = el('div', { class: 'lh-npc-tiers' })
            tiers.append(tierPill('friendship', standing?.friendship ?? 0, max), tierPill('affection', standing?.affection ?? 0, max))
            info.append(bars, tiers)
        }
        const actions = el('div', { class: 'lh-npc-actions' })
        actions.append(actionButton('🪪 Full NPC Card', 'View the NPC card', 'records-view', () => { openFullCard(entry, book) }, false, true))
        actions.append(actionButton('🔖', 'Save to the NPC library', 'records-bookmark', () => { bookmark(entry).catch(host.fail) }))
        actions.append(actionButton('📌', entry.pinned ? 'Pinned — always in the prompt. Unpin' : 'Pin — keep this entry always in the prompt', 'records-pin', () => { togglePin(entry).catch(host.fail) }, entry.pinned))
        actions.append(actionButton('✎', 'Edit this entry', 'records-edit', () => { editing.set(entry.id, { title: entry.title, keys: entry.keys.join(', '), content: entry.content }); openEntries.add(entry.id); draw() }))
        actions.append(actionButton('🧹', 'Run a targeted cleanup of this entry through the agent', 'records-clean', () => { cleaning.add(entry.id); openEntries.add(entry.id); draw() }))
        actions.append(actionButton('🗑', 'Delete this entry', 'records-delete', () => { removeEntry(entry).catch(host.fail) }))
        info.append(actions)
        card.append(portraitBox(entry.title, false), info)
        card.addEventListener('click', (event) => {
            if ((event.target as HTMLElement).closest('button, input, textarea, select, img, a')) return
            if (openEntries.has(entry.id)) openEntries.delete(entry.id); else openEntries.add(entry.id)
            draw()
        })
        if (open) card.append(drawEntryBody(entry, book, false))
        return card
    }

    /** The Full NPC Card: Multihog's popup, in the host's modal; inline under the card on a host without one. */
    function openFullCard(entry: RecordEntryDTO, book: RecordBookDTO): void {
        if (!host.modal) { openEntries.add(entry.id); draw(); return }
        const box = el('div', { class: 'lh-npc-full', 'data-lh-field': 'records-full' })
        const head = el('div', { class: 'lh-npc-full-head' })
        const titleBlock = el('div', { class: 'lh-npc-full-title' })
        const name = el('div', { class: 'lh-npc-full-name' })
        name.textContent = entry.title || '(untitled)'
        const status = statusBadge(entry)
        const badge = el('span', { class: `lh-npc-badge lh-npc-badge--${status.kind}` })
        badge.textContent = status.text
        const keys = el('div', { class: 'lh-records-keys' })
        keys.textContent = entry.keys.length ? `Keys: ${entry.keys.join(', ')}` : 'No keywords.'
        const buttons = el('div', { class: 'lh-npc-full-buttons' })
        const editButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'records-full-edit' }) as HTMLButtonElement
        editButton.textContent = '✏️ Edit text'
        editButton.addEventListener('click', () => { editing.set(entry.id, { title: entry.title, keys: entry.keys.join(', '), content: entry.content }); openEntries.add(entry.id); draw() })
        const libraryButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'records-full-library' }) as HTMLButtonElement
        libraryButton.textContent = '📚 Save to Library'
        libraryButton.addEventListener('click', () => { bookmark(entry).catch(host.fail) })
        buttons.append(editButton)
        const sections = el('div', { class: 'lh-npc-full-sections', 'data-lh-field': 'records-full-sections' })
        const bars = el('div', { class: 'lh-npc-full-bars', 'data-lh-field': 'records-full-bars' })
        const log = el('div', { class: 'lh-npc-full-log', 'data-lh-field': 'records-full-log' })
        const note = el('div', { class: 'lh-npc-full-note', 'data-lh-field': 'records-full-note' })
        // Edit with AI (78c): Multihog's request pane in the card, the revised entry to review, regenerate or apply.
        const aiPane = el('div', { class: 'lh-npc-full-ai', 'data-lh-field': 'records-full-ai-pane', hidden: 'hidden' })
        if (host.aiEdit) {
            const aiButton = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-npc-full-ai-button', 'data-lh-field': 'records-full-ai', title: 'Describe the changes; one model call rewrites the whole entry for you to review before it is kept.' }) as HTMLButtonElement
            aiButton.textContent = '✨ Edit with AI'
            buttons.append(aiButton)
            const aiHead = el('div', { class: 'lh-npc-full-ai-head' })
            aiHead.textContent = '✨ AI Edit Request'
            const instructions = el('textarea', { class: 'lh-input lh-npc-full-ai-instructions', rows: '4', spellcheck: 'true', 'data-lh-field': 'records-full-ai-instructions', 'aria-label': `What to change on ${entry.title}’s entry`, placeholder: 'Describe what you want changed or iterated on… e.g. \'Make her backstory more tragic\' or \'Add a rivalry with the player character\'' }) as HTMLTextAreaElement
            const aiButtons = el('div', { class: 'lh-records-form-actions' })
            const aiCancel = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'records-full-ai-cancel' }) as HTMLButtonElement
            aiCancel.textContent = 'Cancel'
            const aiGenerate = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'records-full-ai-generate' }) as HTMLButtonElement
            aiGenerate.textContent = '✨ Generate'
            aiButtons.append(aiCancel, aiGenerate)
            const review = el('div', { class: 'lh-npc-full-ai-review', hidden: 'hidden' })
            const reviewHead = el('div', { class: 'lh-npc-full-ai-head' })
            reviewHead.textContent = '📝 The revised entry — edit it here before applying'
            const preview = el('textarea', { class: 'lh-input lh-npc-full-ai-preview', rows: '14', spellcheck: 'false', 'data-lh-field': 'records-full-ai-preview', 'aria-label': `The revised entry for ${entry.title}` }) as HTMLTextAreaElement
            const reviewButtons = el('div', { class: 'lh-records-form-actions' })
            const aiRegen = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'records-full-ai-regen' }) as HTMLButtonElement
            aiRegen.textContent = '🔄 Regenerate'
            const aiApply = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'records-full-ai-apply' }) as HTMLButtonElement
            aiApply.textContent = '✅ Apply'
            reviewButtons.append(aiRegen, aiApply)
            review.append(reviewHead, preview, reviewButtons)
            aiPane.append(aiHead, instructions, aiButtons, review)
            const busy = (on: boolean): void => {
                for (const b of [aiCancel, aiGenerate, aiRegen, aiApply]) b.disabled = on
                instructions.disabled = on
                aiGenerate.textContent = on ? '⏳ Generating…' : '✨ Generate'
            }
            const showAi = (open: boolean): void => {
                if (fullCard?.id === entry.id) fullCard.aiOpen = open
                aiPane.hidden = !open
                refreshFullCard()
            }
            aiButton.addEventListener('click', () => { instructions.value = ''; preview.value = ''; review.hidden = true; showAi(true); instructions.focus() })
            aiCancel.addEventListener('click', () => showAi(false))
            const current = (): RecordEntryDTO | null => result?.books.flatMap((b) => b.entries).find((e) => e.id === entry.id) ?? null
            const generate = async (): Promise<void> => {
                const asked = instructions.value.trim()
                // The legacy's toast, in its words, before any call.
                if (!asked) { say('Please describe what you want changed.', true); instructions.focus(); return }
                const live = current()
                if (!live) { say('The entry is gone from the books.', true); return }
                busy(true)
                try {
                    const answer = await run('AI edit', () => host.aiEdit!(live.content, asked))
                    if (!answer) return
                    preview.value = answer.text
                    review.hidden = false
                    say('The revised entry is below: read it, change what you like, then Apply — or Regenerate for another take.')
                } finally {
                    busy(false)
                }
            }
            aiGenerate.addEventListener('click', () => { generate().catch(host.fail) })
            aiRegen.addEventListener('click', () => { generate().catch(host.fail) })
            aiApply.addEventListener('click', () => {
                const live = current()
                const revised = preview.value
                if (!live) { say('The entry is gone from the books.', true); return }
                if (!revised.trim()) { say('The revised entry is empty; nothing was applied.', true); return }
                busy(true)
                run('save', () => host.update({ entryId: live.id, title: live.title, keys: live.keys, content: revised }))
                    .then(async (answer) => {
                        if (!answer) return
                        showAi(false)
                        say(`Applied the AI edit to “${answer.entry.title}”.`)
                        await load()
                    })
                    .catch(host.fail)
                    .finally(() => busy(false))
            })
        }
        buttons.append(libraryButton)
        titleBlock.append(name, badge, keys, buttons)
        head.append(portraitBox(entry.title, true), titleBlock)
        box.append(head, aiPane, sections, bars, log, note)
        // The modal first: opening one closes whatever was open, the Full card's record with it.
        if (!openModal(entry.id, `${entry.title || 'NPC'} — Full NPC Card`, [box], 820)) { openEntries.add(entry.id); draw(); return }
        fullCard = { id: entry.id, sections, log, bars, note, aiOpen: false }
        refreshFullCard()
    }

    /** The Full card's insides from the entry and the standing as they stand now; closed when the entry is gone. */
    function refreshFullCard(): void {
        if (!fullCard || !modal || modal.id !== fullCard.id) return
        let found: { entry: RecordEntryDTO; book: RecordBookDTO } | null = null
        for (const book of result?.books ?? []) {
            const entry = book.entries.find((e) => e.id === fullCard!.id)
            if (entry) { found = { entry, book }; break }
        }
        if (!found) { closeModal(); return }
        const { entry, book } = found
        fullCard.sections.replaceChildren(drawEntryBody(entry, book, false))
        fullCard.note.textContent = last?.text ?? ''
        fullCard.note.classList.toggle('lh-npc-full-note--error', !!last?.error)
        const view = relations
        fullCard.bars.replaceChildren()
        fullCard.log.replaceChildren()
        // The AI edit pane stands in for the sections, the bars and the history while it is open (78c).
        fullCard.sections.hidden = fullCard.aiOpen
        fullCard.bars.hidden = !view?.enabled || fullCard.aiOpen
        fullCard.log.hidden = !view?.enabled || fullCard.aiOpen
        if (!view?.enabled) return
        const id = `${book.name}::${entry.uid}`
        const standing = view.npcs.find((n) => n.id === id) ?? null
        for (const field of ['friendship', 'affection'] as RelationshipField[]) {
            const value = clampRelationshipValue(standing?.[field] ?? 0, view.max)
            const axis = el('div', { class: `lh-npc-full-axis lh-npc-full-axis--${field}` })
            const icon = el('span', { class: 'lh-npc-bar-icon' })
            icon.textContent = field === 'friendship' ? '🤝' : '💗'
            const label = el('span')
            label.textContent = field === 'friendship' ? 'Friendship' : 'Affection'
            const track = el('div', { class: 'lh-npc-bar-track' })
            const fill = el('div', { class: `lh-npc-bar-fill lh-npc-bar-fill--${field} lh-npc-bar-fill--${value >= 0 ? 'up' : 'down'}` })
            fill.style.width = `${relationshipBarPct(value, view.max)}%`
            track.append(fill)
            const number = el('input', { type: 'number', class: 'lh-input', min: String(-view.max), max: String(view.max), step: '1', 'aria-label': `${entry.title}’s ${field}` }) as HTMLInputElement
            number.value = String(value)
            const slider = el('input', { type: 'range', min: String(-view.max), max: String(view.max), step: '1', 'aria-label': `${entry.title}’s ${field} slider` }) as HTMLInputElement
            slider.value = String(value)
            const tier = el('div', { class: `lh-npc-full-tier lh-npc-full-tier--${field}` })
            const paintTier = (v: number): void => {
                const t = tierOf(field, v, view.max)
                tier.replaceChildren()
                const b = el('b'); b.textContent = `${label.textContent} tier: ${t.label}`
                const hint = el('span'); hint.textContent = ` — ${t.hint}`
                tier.append(b, hint)
                tier.setAttribute('style', tierBadgeStyle(field, v, view.max))
            }
            const paint = (v: number): void => {
                fill.className = `lh-npc-bar-fill lh-npc-bar-fill--${field} lh-npc-bar-fill--${v >= 0 ? 'up' : 'down'}`
                fill.style.width = `${relationshipBarPct(v, view.max)}%`
                paintTier(v)
            }
            paintTier(value)
            slider.addEventListener('input', () => { const v = clampRelationshipValue(Number(slider.value), view.max); number.value = String(v); paint(v) })
            const commit = (raw: string): void => {
                const v = clampRelationshipValue(Math.round(Number(raw)), view.max)
                if (!Number.isFinite(v) || v === value) return
                slider.value = String(v); number.value = String(v); paint(v)
                setRelation(id, field, v).catch(host.fail)
            }
            slider.addEventListener('change', () => commit(slider.value))
            number.addEventListener('change', () => commit(number.value))
            axis.append(icon, label, track, number, slider, tier)
            fullCard.bars.append(axis)
        }
        const logHead = el('div', { class: 'lh-npc-full-log-head' })
        const logTitle = el('span')
        logTitle.textContent = '📊 Relationship History'
        logHead.append(logTitle)
        // Multihog's Clear Log (80), the history alone; Forget the standing, AdventureTime's own, beside it.
        if (host.clearRelationLog && standing?.log.length) {
            const clear = el('button', { type: 'button', class: 'lh-button lh-button--quiet lh-npc-full-clear-log', 'data-lh-field': 'records-full-clear-log', title: 'Clear relationship history' }) as HTMLButtonElement
            clear.textContent = '🗑️ Clear Log'
            clear.addEventListener('click', () => { clearRelationLog(id, entry.title).catch(host.fail) })
            logHead.append(clear)
        }
        if (host.forgetRelation && standing) {
            const forget = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'records-full-forget', title: 'Forget the values and their history; the entry stays' }) as HTMLButtonElement
            forget.textContent = '⛓️‍💥 Forget the standing'
            forget.addEventListener('click', () => { forgetRelation(id, entry.title).catch(host.fail) })
            logHead.append(forget)
        }
        fullCard.log.append(logHead)
        const entries = standing?.log.slice(0, 20) ?? []
        if (!entries.length) {
            const empty = el('div', { class: 'lh-records-empty' })
            empty.textContent = standing ? 'No change recorded yet.' : 'No standing yet: the bars sit at zero until the narrator awards or the agent records a starting value.'
            fullCard.log.append(empty)
            return
        }
        const table = el('table')
        for (const item of entries) {
            const tr = el('tr')
            const when = el('td', { class: 'lh-npc-full-log-when' })
            when.textContent = host.when ? host.when(item.at) : item.at
            const axis = el('td')
            axis.textContent = item.field === 'friendship' ? '🤝' : '💗'
            const delta = el('td', { class: 'lh-npc-full-log-delta' })
            delta.textContent = signed(item.delta)
            delta.style.color = item.delta > 0 ? '#4ade80' : item.delta < 0 ? '#ef4444' : ''
            const who = el('td', { class: 'lh-npc-full-log-who' })
            const by = { tracker: 'the tracker', narrative: 'the narrator', agent: 'the agent', manual: 'by hand' }[item.source] ?? item.source
            const clamped = item.applied !== item.delta ? `, ${signed(item.applied)} after the clamp` : ''
            who.textContent = `${item.source === 'manual' ? '✋' : '🤖'} → ${signed(item.newValue)}${clamped}, ${by}`
            tr.append(when, axis, delta, who)
            table.append(tr)
        }
        fullCard.log.append(table)
    }

    function drawRow(entry: RecordEntryDTO, book: RecordBookDTO, child: boolean): HTMLElement[] {
        const row = el('div', { class: `lh-records-row${child ? ' lh-records-row--child' : ''}`, 'data-lh-entry': entry.id })
        const dot = el('span', { class: `lh-records-dot${entry.pinned ? ' lh-records-dot--pinned' : entry.disabled ? ' lh-records-dot--disabled' : ''}` })
        dot.title = entry.pinned ? 'Pinned: always in the prompt' : entry.disabled ? 'Out of the keyword scan' : 'In the keyword scan'
        const title = el('span', { class: 'lh-records-title' })
        title.textContent = child ? entry.title.slice(entry.title.indexOf('::') + 2).trim() : (entry.title || '(untitled)')
        const tokens = el('span', { class: 'lh-records-tokens', title: 'Estimated tokens' })
        tokens.textContent = `${entry.tokens}t`
        // Multihog's location images (80): the place's picture before the row while Show Location Images is on;
        // a click opens it large with its buttons, and the empty box the same, with the ways to get one.
        if (book.kind === 'location' && host.locationImages?.()) {
            const path = entry.title
            const src = host.locationImage?.(path) ?? ''
            const thumb = src
                ? el('img', { class: 'lh-records-loc-thumb', src, alt: '', loading: 'lazy', 'data-lh-field': 'records-loc-thumb' })
                : Object.assign(el('span', { class: 'lh-records-loc-thumb lh-records-loc-thumb--empty', 'data-lh-field': 'records-loc-thumb' }), { textContent: '🗺️' })
            zoomable(thumb, src, path, host.enlarge, host.locationActions ? () => host.locationActions!(path) : undefined)
            if (host.enlarge) thumb.title = src ? 'Manage location image' : 'Set location image'
            row.append(thumb)
        }
        row.append(dot, title)
        if (book.kind === 'location' && result?.mapping && !child) {
            if (entry.hasMap) {
                const badge = el('span', { class: 'lh-records-map', 'data-lh-field': 'records-map-badge' })
                const label = el('span'); label.textContent = 'MAP'; label.title = 'This root holds a private map; the Maps fold draws it.'
                const off = el('button', { type: 'button', title: 'Remove the private map from this Location (keeps the CORE)', 'aria-label': `Remove the map of ${entry.title}`, 'data-lh-field': 'records-map-remove' }) as HTMLButtonElement
                off.textContent = '×'
                off.disabled = !!running
                off.addEventListener('click', (event) => { event.stopPropagation(); removeMap(entry).catch(host.fail) })
                badge.append(label, off)
                row.append(badge)
            } else if (entry.root) {
                const make = el('button', { type: 'button', class: 'lh-records-mapmake', title: 'Create a private map for this location root', 'data-lh-field': 'records-map-make' }) as HTMLButtonElement
                make.textContent = '+ MAP'
                make.disabled = !!running
                make.addEventListener('click', (event) => { event.stopPropagation(); mapForm = { bookName: book.name, entry }; draw() })
                row.append(make)
            }
        }
        row.append(tokens)
        const actions = el('div', { class: 'lh-records-actions' })
        if (book.kind === 'npc') actions.append(iconButton('🔖', 'Save to the NPC library', 'records-bookmark', () => { bookmark(entry).catch(host.fail) }))
        actions.append(iconButton('📌', entry.pinned ? 'Pinned — always in the prompt. Unpin' : 'Pin — keep this entry always in the prompt', 'records-pin', () => { togglePin(entry).catch(host.fail) }, entry.pinned))
        actions.append(iconButton('✎', 'Edit this entry', 'records-edit', () => { editing.set(entry.id, { title: entry.title, keys: entry.keys.join(', '), content: entry.content }); openEntries.add(entry.id); draw() }))
        // World Progression's reports and the skeleton's seed entries are never the agent's to clean (78b-bis).
        if (book.kind !== 'world' && book.kind !== 'skeleton') actions.append(iconButton('🧹', 'Run a targeted cleanup of this entry through the agent', 'records-clean', () => { cleaning.add(entry.id); openEntries.add(entry.id); draw() }))
        actions.append(iconButton('🗑', 'Delete this entry', 'records-delete', () => { removeEntry(entry).catch(host.fail) }))
        row.append(actions)
        row.addEventListener('click', () => { if (openEntries.has(entry.id)) openEntries.delete(entry.id); else openEntries.add(entry.id); draw() })
        const out: HTMLElement[] = [row]
        if (openEntries.has(entry.id)) out.push(drawEntryBody(entry, book, child))
        if (mapForm?.entry?.id === entry.id) out.push(drawMapForm(book.name, entry))
        return out
    }

    function headButton(text: string, title: string, field: string, on: () => void): HTMLButtonElement {
        const button = el('button', { type: 'button', class: 'lh-records-head-button', title, 'data-lh-field': field }) as HTMLButtonElement
        button.textContent = text
        button.disabled = !!running
        button.addEventListener('click', (event) => { event.stopPropagation(); on() })
        return button
    }

    function gearButton(title: string, field: string, node: HTMLElement): HTMLButtonElement {
        const button = el('button', { type: 'button', class: 'lh-records-gear', title, 'aria-label': title, 'data-lh-field': field }) as HTMLButtonElement
        button.textContent = '⚙️'
        button.addEventListener('click', (event) => { event.stopPropagation(); openModal(null, title, [node], 520) })
        return button
    }

    function drawFolder(book: RecordBookDTO): HTMLElement {
        // A stock folder whose book is not made yet (83) wears the mark and says so on hover.
        const virtual = !book.id
        const folder = el('div', { class: `lh-records-folder${virtual ? ' lh-records-folder--virtual' : ''}`, 'data-lh-book': book.name })
        const head = el('div', { class: 'lh-records-folder-head' })
        if (virtual) head.title = `${book.name} is not made yet: ${book.kind === 'npc' ? 'the agent makes it as it records an NPC.' : 'the agent makes it as it records a place, or + Add Mapped Location does.'}`
        const open = openFolders.has(book.name)
        const icon = el('span', { class: 'lh-records-folder-icon' }); icon.textContent = KIND_ICON[book.kind]
        const chevron = el('span', { class: 'lh-records-chevron' }); chevron.textContent = open ? '▼' : '▶'
        const name = el('span', { class: 'lh-records-folder-name' }); name.textContent = folderName(book)
        // Multihog's count: the entries in the scan over all of them, and the tokens.
        const active = book.entries.filter((e) => e.pinned || !e.disabled).length
        const count = el('span', { class: 'lh-records-folder-count' }); count.textContent = `${active}/${book.entries.length} (${book.tokens}t)`
        head.append(icon, chevron, name, count)
        const panels = host.panels
        if (book.kind === 'npc') {
            if (panels?.manager?.length && host.modal) head.append(headButton('👥 NPC/PC Manager', 'NPC/PC Manager — the library, add to the story, import and export', 'records-manager', () => { openModal(null, '📚 NPC/PC Manager', panels.manager!, 820) }))
            if (panels?.npcSettings && host.modal) head.append(gearButton('NPC and PC Card Settings', 'records-npc-settings', panels.npcSettings))
        }
        if (book.kind === 'location') {
            if (panels?.mapsGuide && host.modal) head.append(headButton('ℹ️ Maps Guide', 'Learn how Persistent Maps work', 'records-maps-guide', () => { openModal(null, 'Maps Guide', [panels.mapsGuide!], 720) }))
            if (result?.mapping) {
                const add = headButton('+ Add Mapped Location', 'Create a new location root and generate its private map', 'records-add-mapped', () => { openFolders.add(book.name); mapForm = { bookName: book.name, entry: null }; draw() })
                head.append(add)
            }
            if (panels?.locationSettings && host.modal) head.append(gearButton('Location Settings', 'records-location-settings', panels.locationSettings))
        }
        head.addEventListener('click', () => { if (openFolders.has(book.name)) openFolders.delete(book.name); else openFolders.add(book.name); draw() })
        const list = el('div', { class: 'lh-records-folder-body' })
        list.hidden = !open
        if (mapForm && mapForm.bookName === book.name && !mapForm.entry) list.append(drawMapForm(book.name, null))
        if (!book.entries.length) { const empty = el('div', { class: 'lh-records-empty' }); empty.textContent = virtual ? 'No entries yet; the book is made with the first.' : 'No entries yet.'; list.append(empty) }
        // The NPCs as Multihog's cards while the portraits switch is on; the compact rows otherwise, as the legacy's.
        if (book.kind === 'npc' && (host.npcCards ? host.npcCards() : true)) {
            const grid = el('div', { class: 'lh-records-cards', 'data-lh-field': 'records-npc-cards' })
            for (const entry of book.entries) grid.append(drawNpcCard(entry, book))
            list.append(grid)
            folder.append(head, list)
            return folder
        }
        for (const node of treeOf(book.entries)) {
            if (node.entry) list.append(...drawRow(node.entry, book, false))
            else {
                const row = el('div', { class: 'lh-records-row lh-records-row--virtual' })
                const dot = el('span', { class: 'lh-records-dot lh-records-dot--virtual' }); dot.title = 'No entry of its own yet'
                const title = el('span', { class: 'lh-records-title' }); title.textContent = node.root
                row.append(dot, title)
                list.append(row)
            }
            for (const child of node.children) list.append(...drawRow(child, book, true))
        }
        folder.append(head, list)
        return folder
    }

    function draw(): void {
        folders.replaceChildren()
        summary.textContent = result?.books.length ? `Campaign records — ${result.books.length} ${result.books.length === 1 ? 'book' : 'books'}` : 'Campaign records'
        refresh.disabled = !!loading || !!running || !chatId
        refresh.textContent = loading ? 'Reading…' : 'Refresh'
        if (!chatId) { const empty = el('div', { class: 'lh-records-empty' }); empty.textContent = 'No chat open.'; folders.append(empty) }
        else if (result) {
            if (result.problem) { const problem = el('div', { class: 'lh-records-note lh-records-note--error' }); problem.textContent = `The books could not be read: ${result.problem}`; folders.append(problem) }
            // The Player Character first (78b), as Multihog draws it even with no books.
            const pc = drawPlayerCard()
            if (pc) folders.append(pc)
            if (!result.prefix) { const empty = el('div', { class: 'lh-records-empty' }); empty.textContent = 'Name the campaign to see its records.'; folders.append(empty) }
            // The two stock folders first, made or not (83), then the campaign's other books.
            for (const book of withStockFolders(result)) folders.append(drawFolder(book))
            if (result.prefix && !result.books.length && !result.problem) { const empty = el('div', { class: 'lh-records-empty' }); empty.textContent = 'This campaign has no books yet; the agent makes them as it records.'; folders.append(empty) }
        } else if (loading) { const wait = el('div', { class: 'lh-records-empty' }); wait.textContent = 'Reading the books…'; folders.append(wait) }
        live.hidden = !running
        live.textContent = running ? `Working on the ${running.what}… a map takes the architect’s calls, which can be minutes.` : ''
        note.textContent = last?.text ?? ''
        note.classList.toggle('lh-records-note--error', !!last?.error)
        refreshFullCard()
    }

    root.addEventListener('toggle', () => { if (root.open && chatId && !loaded && !loading) load().catch(host.fail) })
    draw()

    return {
        root,
        setChat(next) {
            if (next === chatId) return
            chatId = next
            result = null
            loaded = false
            mapForm = null
            editing.clear()
            cleaning.clear()
            openEntries.clear()
            last = null
            cards = null
            relations = null
            playerCard = null
            closeModal()
            draw()
            if (root.open && chatId) load().catch(host.fail)
        },
        load,
        refreshRelations: async () => {
            if (!root.open || !chatId) return
            await readRelations(chatId)
            draw()
        },
        redraw() {
            if (!loaded) return
            draw()
            refreshFullCard()
        },
        refreshPlayerCard: async () => {
            if (!root.open || !chatId) return
            await readPlayerCard(chatId)
            draw()
        },
        closeModal,
    }
}
