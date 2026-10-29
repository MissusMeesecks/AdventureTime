/**
 * Tracker cards under the messages themselves.
 *
 * The panel answers "what is true now". A card under a reply from an hour ago
 * answers a different question — what the party looked like *then* — and the
 * tracker could not answer it until the pass started keeping one memo snapshot
 * per tracked message. This draws those snapshots.
 *
 * Note what this is not: the legacy build had no such thing. It rendered into
 * its own panel and nowhere else, so there is no grammar to port and no pinned
 * behaviour to match. That makes it the first piece of this project with no
 * oracle, which is a reason to keep the logic here thin — the memo goes through
 * the same `buildTrackerView` and `renderTrackerHtml` the panel uses, and this
 * module only decides which memo goes under which message.
 *
 * `dom.inject()` rather than `messages.renderWidget()`, deliberately. The
 * widget API renders into a sandboxed iframe, which would mean shipping a copy
 * of `PANEL_CSS` inside every single card and re-implementing the fold as
 * scripts inside each frame. Injection puts the same markup the panel draws
 * into the page that already has the stylesheet, and the host replays
 * injections when a virtualized bubble remounts — with the element identity
 * preserved, so a click handler bound here survives a scroll.
 */

import { renderTrackerHtml } from '../tracker/render.js'
import { summariseTrackerView } from '../tracker/summary.js'
import { buildTrackerView, type TrackerView, type TrackerSettings } from '../tracker/view.js'
import type { BarPrefs } from '../tracker/bars.js'
import { escapeHtml } from '../tracker/html.js'
import type { Bridge } from './bridge.js'
import { createRecolorBinding } from './recolor.js'
import { readDisplayGroups, type DisplayGroup } from '../tracker/display-groups.js'
import { createEnlarge, zoomTarget, type ModalUi } from './enlarge.js'
import { createPortraitActions } from './portrait-actions.js'
import type { MemoSnapshotDTO, PortraitsResult, PrefsResult, SettingsResult, TrackerHistoryResult } from '../protocol.js'

/** The slice of the Spindle frontend context this needs. */
export interface MessageCardsHost {
    dom: {
        listMessageElements(): Array<{ messageId: string; element: Element }>
        inject(target: string | Element, html: string, position?: InsertPosition): Element
        uninject(element: Element): void
    }
    events: { on(event: string, handler: (payload?: unknown) => void): () => void }
    getActiveChat(): { chatId: string | null; characterId: string | null }
    /** The host's modal (Phase 64), for a portrait on a card large; absent on an older host. */
    ui?: ModalUi
    /** The host's file picker (80), for the portrait's From a file under the large view; absent, the button is greyed. */
    uploads?: { pickFile(options?: { accept?: string[]; multiple?: boolean; maxSizeBytes?: number }): Promise<Array<{ name: string; bytes: Uint8Array; mimeType?: string }>> }
}

export interface MessageCards {
    /** Re-read the chat's history and redraw. Safe on a chat switch. */
    refresh(): Promise<void>
    /** Redraw from the snapshots already in hand — for when settings change. */
    setSettings(settings: TrackerSettings): void
    destroy(): void
}

/** The wrapper class, also the marker for "this bubble already has a card". */
export const CARD_CLASS = 'lh-msg-card'

/**
 * Every section a view draws, so the card can fold them all but the ones
 * the user opened.
 *
 * The quest archives are sections of their own under the quest log, and
 * the camp roster rides inside PARTY (or stands alone when everyone is
 * away), so the block tags alone would leave those open.
 */
export function foldedSections(view: TrackerView, opened: ReadonlySet<string>): Set<string> {
    const folded = new Set<string>(['QUESTS_COMPLETED', 'QUESTS_FAILED'])
    for (const block of view.blocks) folded.add(block.tag)
    if (view.benchedParty) folded.add(view.benchedParty.tag)
    for (const tag of opened) folded.delete(tag)
    return folded
}

/**
 * Draw one snapshot as a folded card.
 *
 * Folded by default and summarised in its header, because the alternative — a
 * full tracker card under every reply — buries the story it is annotating.
 * Inside it every section is folded too (Phase 47, by the maintainer's
 * request): an open card is a glance at what changed, and the section the
 * glance is about opens with a click on its header, as in the panel.
 * `opened` names the sections to draw open.
 */
export function renderMessageCard(
    snapshot: MemoSnapshotDTO,
    settings: TrackerSettings,
    expanded: boolean,
    opened: ReadonlySet<string> = new Set(),
    partyCompact = false,
    display: { portraitsEnabled: boolean; inventory: { showTotal: boolean; worthMode: 'hover' | 'display' }; displayGroups?: { groups: DisplayGroup[]; enabled: boolean; showGaps: boolean } } = { portraitsEnabled: true, inventory: { showTotal: false, worthMode: 'hover' } },
): string {
    const view = buildTrackerView(snapshot.memo, display.portraitsEnabled ? settings : { ...settings, portraits: {} })
    const summary = summariseTrackerView(view)

    // No blocks at all means the pass ran and the memo was empty. There is
    // nothing to open, so the card says so rather than offering an empty fold.
    const body = view.empty
        ? '<div class="lh-msg-card-empty">No tracker state after this message.</div>'
        : renderTrackerHtml(view, { collapsed: foldedSections(view, opened), partyCompact, inventory: display.inventory, displayGroups: display.displayGroups })

    // The card is the tracker's for the font size (74e): its root is the host's wrapper (lesson 38), so the class is on the inner box.
    return `<div class="lh-msg-card-inner lh-size-tracker${expanded ? ' lh-msg-card--open' : ''}">
        <div class="lh-msg-card-header" role="button" tabindex="0" aria-expanded="${expanded}">
            <span class="lh-msg-card-caret" aria-hidden="true">▸</span>
            <span class="lh-msg-card-summary">${escapeHtml(summary.text)}</span>
        </div>
        <div class="lh-msg-card-body"${expanded ? '' : ' hidden'}>${body}</div>
    </div>`
}

export function mountMessageCards(
    bridge: Bridge,
    host: MessageCardsHost,
    settings: TrackerSettings = {},
): MessageCards {
    let current: TrackerSettings = settings
    let chatId: string | null = null
    let destroyed = false
    /** A portrait on a card opens large (Phase 64), where the host has a modal; with its buttons under it (80). */
    const enlarge = createEnlarge(host.ui)
    const portraitActions = createPortraitActions({
        request: (op, params) => bridge.request(op, params),
        chatId: () => chatId,
        portraits: () => portraits,
        ...(host.uploads ? { uploads: host.uploads } : {}),
        ...(host.ui ? { ui: host.ui } : {}),
    })
    /**
     * Whether the user wants these at all.
     *
     * Asked for once on mount and updated by the `prefs.changed` event, so
     * switching them off in the panel takes the cards down immediately rather
     * than at the next reload. Assumed on until the answer arrives: the request
     * is local and fast, and a flash of the cards a user has switched off is a
     * smaller wrong than a pause before the cards a user wants.
     */
    let enabled = true

    /** The state after each tracked message, keyed by message id. */
    const snapshots = new Map<string, MemoSnapshotDTO>()
    /**
     * The chat's portraits, drawn on the entity cards inside every card here.
     *
     * Today's portraits on a three-day-old card, deliberately: a portrait is
     * who someone *is*, not what they looked like that turn, and the snapshot
     * holds the memo only.
     */
    let portraits: Record<string, string> = {}
    /**
     * The user's per-bar choices, applied here as in the panel.
     *
     * Read once with the preference that decides whether these cards exist at
     * all, and refreshed by `prefs.changed` — a colour picked in the panel
     * should reach the card under a message without a reload.
     */
    let bars: BarPrefs = {}

    /** The recolour popup over a card's bar (74i-ter), through the binding the panel uses. */
    const recolor = createRecolorBinding({
        document,
        patch: async (patch) => (await bridge.request<PrefsResult>('prefs.patch', { patch: { bars: patch } })).prefs?.bars,
        redraw: (next) => {
            setBars(next)
            sweep()
        },
    })
    /** The wrapper this module injected into each message bubble. */
    const drawn = new Map<string, Element>()
    /**
     * Which cards the user has opened.
     *
     * Not persisted, and deliberately per message rather than one shared "open
     * everything" flag: opening one card to check what the party had at that
     * point should not unfold thirty others as they scroll past.
     */
    const expanded = new Set<string>()
    /**
     * Which sections the user has opened inside each open card, by message.
     *
     * Per message for the same reason the cards are: the PARTY opened under
     * one reply is the party at that point, not an instruction to unfold
     * PARTY under every reply in the chat.
     */
    const openedSections = new Map<string, Set<string>>()
    /** What each drawn card was drawn from, so an unchanged sweep does no work. */
    const painted = new Map<string, string>()
    /** Part of that key: a new portrait has to repaint cards nothing else changed. */
    let portraitKey = ''
    /** And the same for the bar choices, which repaint cards nothing else moved. */
    let barKey = ''
    /** The PARTY card compact (47e-ter), from the preference: the panel's button sets it, the event brings it here. */
    let partyCompact = false
    /** The cards' display preferences (72b): the portraits on them, and the inventory's worth. */
    let portraitsEnabled = true
    let inventory: { showTotal: boolean; worthMode: 'hover' | 'display' } = { showTotal: false, worthMode: 'hover' }
    /** The Display Groups (75): the cards here draw the same groups the panel does. */
    let displayGroups: { groups: DisplayGroup[]; enabled: boolean; showGaps: boolean } = { groups: [], enabled: false, showGaps: false }
    /** The groups' part of the paint key: a group made or changed repaints cards nothing else moved. */
    const groupsKey = (): string => (displayGroups.enabled ? JSON.stringify(displayGroups) : '')
    /** Read the display preferences off a set; true when any moved, so every card is repainted. */
    function readDisplay(prefs: Record<string, unknown>): boolean {
        const groups = {
            groups: prefs.displayGroups !== undefined ? readDisplayGroups(prefs.displayGroups) : displayGroups.groups,
            enabled: typeof prefs.displayGroupsEnabled === 'boolean' ? prefs.displayGroupsEnabled : displayGroups.enabled,
            showGaps: typeof prefs.displayGroupsShowGaps === 'boolean' ? prefs.displayGroupsShowGaps : displayGroups.showGaps,
        }
        // The paint key carries the groups, so a change repaints on the sweep; the return below has no reader (72b's shape).
        displayGroups = groups
        const next = {
            portraits: typeof prefs.portraitsEnabled === 'boolean' ? prefs.portraitsEnabled : portraitsEnabled,
            total: typeof prefs.inventoryShowTotal === 'boolean' ? prefs.inventoryShowTotal : inventory.showTotal,
            mode: prefs.inventoryWorthMode === 'display' || prefs.inventoryWorthMode === 'hover' ? prefs.inventoryWorthMode : inventory.worthMode,
        }
        const moved = next.portraits !== portraitsEnabled || next.total !== inventory.showTotal || next.mode !== inventory.worthMode
        portraitsEnabled = next.portraits
        inventory = { showTotal: next.total, worthMode: next.mode }
        return moved
    }

    /** Take every card down — on a chat switch, or on teardown. */
    function clear(): void {
        for (const [, wrapper] of drawn) {
            try {
                host.dom.uninject(wrapper)
            } catch {
                // A bubble the host has already torn down. Nothing to undo.
            }
        }
        drawn.clear()
        painted.clear()
    }

    function paint(messageId: string, wrapper: Element): void {
        const snapshot = snapshots.get(messageId)
        if (!snapshot) return

        const opened = openedSections.get(messageId) ?? new Set<string>()
        const key = `${snapshot.at}::${snapshot.memo}::${expanded.has(messageId) ? '1' : '0'}::${[...opened].sort().join(',')}::${portraitKey}::${barKey}::${partyCompact ? 'c' : ''}::${portraitsEnabled ? 'p' : ''}${inventory.showTotal ? 't' : ''}${inventory.worthMode}::${groupsKey()}`
        if (painted.get(messageId) === key) return

        wrapper.innerHTML = renderMessageCard(snapshot, { ...current, portraits, bars }, expanded.has(messageId), opened, partyCompact, { portraitsEnabled, inventory, displayGroups })
        painted.set(messageId, key)
        // A click on a bar here opens the legacy's popup as the panel's does (74i-ter): Multihog binds
        // its per-message cards the same way. The handle stops the click, so the card does not fold.
        recolor.bind(wrapper)
    }

    /**
     * Fold a card open or shut.
     *
     * Bound to the wrapper rather than to the header, because the header is
     * replaced whenever the card is repainted and a listener on it would go
     * with it. The wrapper survives — the host replays it on remount with its
     * identity intact.
     */
    function toggle(messageId: string, target: EventTarget | null): void {
        if (!(target instanceof Element)) return

        // A portrait on an entity card opens large (Phase 64), and folds
        // nothing: the picture is inside the body, which no header contains.
        const picture = zoomTarget(target)
        if (picture) {
            enlarge?.(picture.src, picture.title, portraitActions(picture.title))
            return
        }

        // A section's header inside the card, before the card's own: the
        // sections are in the body, which the card's header never contains.
        const sectionHeader = target.closest('.rt-section-header')
        if (sectionHeader) {
            const tag = sectionHeader.parentElement?.getAttribute('data-tag')
            if (!tag) return
            const opened = openedSections.get(messageId) ?? new Set<string>()
            if (opened.has(tag)) opened.delete(tag)
            else opened.add(tag)
            openedSections.set(messageId, opened)
        } else {
            if (!target.closest('.lh-msg-card-header')) return
            if (expanded.has(messageId)) expanded.delete(messageId)
            else expanded.add(messageId)
        }

        const wrapper = drawn.get(messageId)
        if (wrapper) paint(messageId, wrapper)
    }

    /**
     * Put a card under every mounted message that has a snapshot.
     *
     * Only mounted ones: the chat list is virtualized, so this is called again
     * whenever the host renders more. Injections are replayed by the host on
     * remount, so a bubble scrolled out and back keeps its card without this
     * running at all.
     */
    function sweep(): void {
        if (destroyed || !chatId || !enabled) return

        for (const { messageId, element } of host.dom.listMessageElements()) {
            if (!snapshots.has(messageId)) continue

            let wrapper = drawn.get(messageId)
            if (!wrapper || !wrapper.isConnected) {
                // A wrapper the host dropped without replaying — re-inject
                // rather than leaving the message bare.
                if (wrapper) {
                    try {
                        host.dom.uninject(wrapper)
                    } catch {
                        // Already gone.
                    }
                    painted.delete(messageId)
                }

                wrapper = host.dom.inject(element, `<div class="${CARD_CLASS}"></div>`, 'beforeend')
                wrapper.addEventListener('click', (event) => { toggle(messageId, event.target) })
                wrapper.addEventListener('keydown', (event) => {
                    const key = (event as KeyboardEvent).key
                    if (key !== 'Enter' && key !== ' ') return
                    event.preventDefault()
                    toggle(messageId, event.target)
                })
                drawn.set(messageId, wrapper)
            }

            paint(messageId, wrapper)
        }
    }

    /** Re-read the chat's snapshots and redraw everything mounted. */
    async function refresh(): Promise<void> {
        if (destroyed) return

        const previous = chatId
        chatId = host.getActiveChat().chatId
        if (chatId !== previous) {
            clear()
            snapshots.clear()
            expanded.clear()
            openedSections.clear()
        }

        if (!chatId || !enabled) return

        const startedFor = chatId
        const result = await bridge.request<TrackerHistoryResult>('tracker.history', { chatId })
        // The user can switch chats while this is in flight, and painting the
        // answer then would hang one campaign's state off another's messages.
        if (destroyed || chatId !== startedFor) return

        snapshots.clear()
        for (const snapshot of result.snapshots ?? []) {
            if (snapshot?.messageId) snapshots.set(snapshot.messageId, snapshot)
        }

        try {
            const found = await bridge.request<PortraitsResult>('portraits.get', { chatId })
            if (destroyed || chatId !== startedFor) return
            setPortraits(found.portraits ?? {})
        } catch {
            // A missing picture is not a reason to draw no cards.
        }

        sweep()
    }

    /** Take new bar choices, and mark every card as needing a repaint. */
    function setBars(next: BarPrefs): void {
        bars = next
        barKey = JSON.stringify(next)
    }

    /** Take a new portrait map, and mark every card as needing a repaint. */
    function setPortraits(next: Record<string, string>): void {
        portraits = next
        portraitKey = JSON.stringify(next)
    }

    /**
     * A pass just finished. Update that message's card without a round trip.
     *
     * The event carries the memo the pass wrote and the message it was for,
     * which is exactly the snapshot the backend stored — so re-reading the
     * whole history to learn one thing we were already told would be wasteful.
     */
    const unsubscribeBridge = bridge.on((event) => {
        /**
         * The user switched the cards on or off.
         *
         * Off takes them down now — leaving them until the next reload would
         * make the switch look broken. On has to re-read, because everything
         * that happened while they were off went unrecorded here.
         */
        if (event.name === 'prefs.changed') {
            const prefs = (event.data as PrefsResult | undefined)?.prefs
            if (!prefs) return

            // A bar recoloured in the panel has to reach these cards too, and it
            // arrives on the same event as the on/off switch.
            if (prefs.bars) setBars(recolor.take(prefs.bars).bars)
            if (typeof prefs.partyCompact === 'boolean') partyCompact = prefs.partyCompact
            // The display preferences (72b): the card's key carries them, so the sweep repaints what they change.
            readDisplay(prefs)

            const next = prefs.messageCards
            if (typeof next !== 'boolean' || next === enabled) {
                sweep()
                return
            }

            enabled = next
            if (!enabled) clear()
            else void refresh().catch(() => undefined)
            return
        }

        /**
         * A portrait changed. Every card holding that entity is now wrong.
         *
         * The event carries the whole map, so this needs no round trip — and
         * the paint key changes with it, which is what makes the repaint happen
         * on cards whose memo did not move.
         */
        if (event.name === 'portraits.changed') {
            const data = event.data as (PortraitsResult & { chatId?: string }) | undefined
            if (!data?.portraits || (data.chatId && data.chatId !== chatId)) return

            setPortraits(data.portraits)
            sweep()
            return
        }

        // The cartridge moved (74c-bis): a custom field's label and icon, the
        // cards' order and the module switches are its, and every write sends
        // this event, as the panel's tracker follows it.
        if (event.name === 'settings.changed') {
            const data = event.data as SettingsResult | undefined
            if (data?.settings) { current = data.settings as TrackerSettings; painted.clear(); sweep() }
            return
        }

        if (event.name !== 'tracker.changed') return
        const data = event.data as { chatId?: string; memo?: string; messageId?: string } | undefined
        if (!data || data.chatId !== chatId) return
        if (typeof data.memo !== 'string' || !data.messageId) return

        snapshots.set(data.messageId, { messageId: data.messageId, memo: data.memo, at: new Date().toISOString() })
        sweep()
    })

    /**
     * Host events worth sweeping on.
     *
     * The two render events are the virtualizer telling us more bubbles exist;
     * a swipe or an edit can change which message is which. A chat switch goes
     * through `refresh`, because the snapshots themselves are per chat.
     */
    const unsubscribeHost = [
        ...['CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED'].map((event) =>
            host.events.on(event, () => { sweep() }),
        ),
        ...['CHAT_SWITCHED', 'CHAT_CHANGED'].map((event) =>
            host.events.on(event, () => { void refresh().catch(() => undefined) }),
        ),
    ]

    /**
     * Ask whether these are wanted, then draw.
     *
     * Sequenced rather than run alongside the first refresh: the answer decides
     * whether the refresh should happen at all, and injecting cards only to
     * remove them a tick later is visible.
     */
    void (async (): Promise<void> => {
        try {
            const result = await bridge.request<PrefsResult>('prefs.get', {})
            if (destroyed) return
            // Off unless the preference says on (82; on by default before it).
            enabled = result.prefs?.messageCards === true
            partyCompact = result.prefs?.partyCompact === true
            readDisplay(result.prefs ?? {})
            setBars(recolor.take(result.prefs?.bars ?? {}).bars)
        } catch {
            // A build with no preference store draws them, as it always did.
        }
        if (!enabled || destroyed) return
        // The cartridge (74c-bis): the custom fields' labels and icons, the
        // cards' order, the module switches. Before this the cards were drawn
        // with none of it, so a custom field's card wore its tag and the stock
        // icon while the panel's wore its name (the try of 0.139.0).
        try {
            const result = await bridge.request<SettingsResult>('settings.get', {})
            if (destroyed) return
            if (result.settings) current = result.settings as TrackerSettings
        } catch {
            // Drawn with the stock labels, as before.
        }
        await refresh()
    })().catch(() => undefined)

    return {
        refresh,
        setSettings(next: TrackerSettings): void {
            current = next
            painted.clear()
            sweep()
        },
        destroy(): void {
            destroyed = true
            unsubscribeBridge()
            for (const off of unsubscribeHost) off()
            clear()
            recolor.close()
        },
    }
}
