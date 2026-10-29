/**
 * Frontend entry point — loaded in the browser.
 *
 * Like the backend entry, this is thin on purpose: it is the only file that
 * touches the Spindle frontend context, so everything under src/frontend/ can
 * be tested against a fake.
 *
 * It registers the drawer tab or tabs through the layout module (47b), the
 * character editor's tab (48), mounts the cards that hang under each message,
 * and subscribes to the two chat events that decide which chat is on screen.
 */

import type { SpindleFrontendContext, SpindleFrontendTeardown } from 'lumiverse-spindle-types'

import { Bridge } from './frontend/bridge.js'
import { EDITOR_TAB_GUIDE, mountEditorTab, type EditorTab } from './frontend/editor-tab.js'
import { createLayout } from './frontend/layout.js'
import { mountMessageCards } from './frontend/message-cards.js'
import { mountMessageChoices } from './frontend/message-choices.js'
import { mountPanel, PANEL_CSS } from './frontend/panel.js'
import type { CardChoice, LibraryRecordView, NpcAddResult, NpcDraftResult, PrefsResult } from './protocol.js'

export function setup(ctx: SpindleFrontendContext): SpindleFrontendTeardown {
    const removeStyle = ctx.dom.addStyle(PANEL_CSS)

    const bridge = new Bridge(ctx)

    /**
     * The drawer tab (or two, 47b) and the panel in them. The layout module
     * registers the main tab at once and mounts the panel once the layout
     * preference has been read; a change of the preference rebuilds it.
     */
    const panel = createLayout({
        registerTab: (options) => ctx.ui.registerDrawerTab(options),
        // The floating widgets (47c). The host draws the frame and the drag;
        // the layout module dresses the inside. Needs the ui_panels grant.
        createWidget: ({ title, width, height, initialPosition }) => ctx.ui.createFloatWidget({
            width, height, initialPosition, snapToEdge: true, tooltip: title,
        }),
        mount: (root, slots) => mountPanel(root, bridge, ctx, slots),
        // The two floating widgets alone since 82 (the maintainer's ask of 2026-10-28): the Layout select is
        // gone and a stored `layout` is not read, so an install on the tabs or the classic tab comes back as
        // the widgets. The two older layouts stay in layout.ts for the day they are wanted, and the fall
        // back to the two tabs when the widgets cannot be made (no ui_panels grant) stays live.
        readLayout: () => bridge.request<PrefsResult>('prefs.get', {})
            .then((result) => ({
                layout: 'widgets' as const,
                positions: result.prefs?.widgetPositions ?? {},
                sizes: result.prefs?.widgetSizes ?? {},
                minimized: result.prefs?.widgetMinimized ?? {},
            })),
        savePositions: (widgetPositions) => {
            bridge.request<PrefsResult>('prefs.patch', { patch: { widgetPositions } }).catch(() => undefined)
        },
        saveSizes: (widgetSizes) => {
            bridge.request<PrefsResult>('prefs.patch', { patch: { widgetSizes } }).catch(() => undefined)
        },
        saveMinimized: (widgetMinimized) => {
            bridge.request<PrefsResult>('prefs.patch', { patch: { widgetMinimized } }).catch(() => undefined)
        },
        // Nothing writes the preference now (82), so nothing to follow.
        onLayoutChange: () => () => undefined,
    })

    /**
     * The character editor's tab (48): *send to AdventureTime*. The host's editor
     * takes extension tabs; a host without them, or one that refuses, costs
     * the tab and nothing else, with the reason in the browser console.
     */
    let editorTab: EditorTab | null = null
    let editorHandle: { destroy(): void } | null = null
    try {
        if (typeof ctx.ui.registerCharacterEditorTab === 'function' && ctx.ui.characterEditor) {
            const handle = ctx.ui.registerCharacterEditorTab({ id: 'adventuretime-send', title: 'AdventureTime', guide: { markdown: EDITOR_TAB_GUIDE, title: 'Send to AdventureTime' } })
            editorHandle = handle
            editorTab = mountEditorTab(handle.root, {
                el: ctx.dom.createElement,
                editor: ctx.ui.characterEditor,
                activeChat: () => ctx.getActiveChat(),
                cards: () => bridge.request<{ cards: CardChoice[] }>('creator.cards'),
                prefs: () => bridge.request<PrefsResult>('prefs.get', {}).then((result) => result.prefs ?? {}),
                savePrefs: async (patch) => { await bridge.request<PrefsResult>('prefs.patch', { patch }) },
                saveCard: (request) => bridge.request<LibraryRecordView | { status: 'exists'; name: string }>('library.saveCard', request),
                add: (request) => bridge.request<NpcAddResult>('npc.add', request),
                draft: (request) => bridge.request<NpcDraftResult>('npc.draft', request),
                commit: (request) => bridge.request<NpcAddResult>('npc.commit', request),
                confirm: async (message) => (await ctx.ui.showConfirm({ title: 'NPC library', message, variant: 'warning', confirmLabel: 'Replace it' })).confirmed,
                fail: (error) => { console.error('[AdventureTime] the character editor tab:', error) },
                when: (iso) => {
                    const stamp = new Date(iso)
                    return Number.isNaN(stamp.getTime()) ? '' : `at ${stamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                },
            })
        } else {
            console.warn('[AdventureTime] this host has no character editor tabs; the send-to-AdventureTime action is not offered')
        }
    } catch (error) {
        editorHandle?.destroy()
        editorHandle = null
        editorTab = null
        console.error('[AdventureTime] the character editor tab could not be made', error)
    }
    // The Add as is preference is one preference in two places (the NPC
    // creator's fold and this tab); a change in either reaches both.
    const unsubscribePrefs = bridge.on((event) => {
        if (event.name !== 'prefs.changed' || !editorTab) return
        const prefs = (event.data as { prefs?: { npcAddAsIsMode?: 'literal' | 'ai_review' } } | undefined)?.prefs
        if (prefs) editorTab.applyPrefs(prefs)
    })

    /**
     * The tracker under each message, drawn from what the memo held at that
     * turn. Independent of the panel: it has its own subscriptions and its own
     * chat handling, so a failure in one does not take the other down.
     */
    const messageCards = mountMessageCards(bridge, ctx)
    // The narrator's choices as buttons under each reply (roadmap row 6).
    // Its own module for the same reason the cards are: a failure in one
    // does not take the other down.
    const messageChoices = mountMessageChoices(bridge, ctx)

    // A memo belongs to one chat, so the panel has to follow the user between
    // them. Both events are listened for: CHAT_SWITCHED fires when the user
    // picks a different chat, CHAT_CHANGED when the open one is replaced
    // underneath them (a fork, a rename, an import).
    const unsubscribe = ['CHAT_SWITCHED', 'CHAT_CHANGED'].map((event) =>
        ctx.events.on(event, () => { panel.refreshTracker(); editorTab?.refresh() }),
    )

    ctx.ready()

    return () => {
        for (const off of unsubscribe) off()
        unsubscribePrefs()
        editorTab?.destroy()
        editorHandle?.destroy()
        messageChoices.destroy()
        messageCards.destroy()
        panel.destroy()
        bridge.dispose()
        removeStyle()
        ctx.dom.cleanup()
    }
}
