/**
 * The AdventureTime panel — a drawer tab holding the settings table and the
 * cartridge import/export controls.
 *
 * The legacy build owned its own popup chrome, its own CSS for every control,
 * and its own DOM surgery to keep it all in sync. Here the host owns the tab
 * and the theme; this module owns the contents of one element.
 */

import { mapKindArtCss } from '../tracker/graph-css.js'
import { CREATOR_FOLD_CSS } from './creator-fold.js'
import { INSTANT_FOLD_CSS } from './instant-fold.js'
import { START_AREA_CSS } from './start-area.js'
import { PLAYER_CARD_FOLD_CSS } from './player-card-fold.js'
import { WAYS_FOLD_CSS } from './ways-fold.js'
import { IMPORT_FOLD_CSS } from './import-fold.js'
import { mountNarratorConfig, NARRATOR_CONFIG_CSS, type NarratorConfig } from './narrator-config.js'
import { createDeveloperCard, DEVELOPER_CARD_CSS } from './developer-card.js'
import { createMarkersCard, createNarratorRows, createNpcWordsCard, SECOND_PASS_CSS } from './second-pass-cards.js'
import { createCoreCard, CORE_CARD_CSS } from './core-card.js'
import { openDetailsModal } from './details-modal.js'
import { createDisplayGroupsCard, DISPLAY_GROUPS_CARD_CSS } from './display-groups-card.js'
import { DISPLAY_GROUP_CSS, readDisplayGroups } from '../tracker/display-groups.js'
import { TAB_MODE_CSS } from '../tracker/tab-mode.js'
import { buildGameSystemFile, importGameSystem, readGameSystemFile } from './game-system-file.js'
import { LIBRARY_FOLD_CSS } from './library-fold.js'
import { NPC_CREATOR_FOLD_CSS } from './npc-creator-fold.js'
import { EDITOR_TAB_CSS } from './editor-tab.js'
import { SCENE_FOLD_CSS } from './scene-fold.js'
import { PORTRAIT_DRAW_CSS, createPortraitDrawSettings } from './portrait-draw.js'
import { PORTRAITS_SECTION_CSS, createPortraitsSection } from './portraits-section.js'
import { PORTRAIT_STYLES_CSS, mountPortraitStyles, type PortraitStyles } from './portrait-styles.js'
import { SECTIONS_EDITOR_CSS, mountSectionsEditor, type SectionsEditor, type SectionsEditorHost } from './sections-editor.js'
import { createScenePictureSettings } from './scene-picture-settings.js'
import { PREF_DIALS_CSS, PREF_DIAL_GROUPS, createPrefDials } from './pref-dials.js'
import { CARDS_CSS } from './category-copy.js'
import { ENLARGE_CSS } from './enlarge.js'
import { CARD_SETTINGS_CSS } from './card-settings.js'
import { RELATIONSHIP_FLOAT_CSS } from './relationship-float.js'
import { MAP_PICTURE_CSS } from './map-picture.js'
import { RECORDS_FOLD_CSS } from './campaign-records.js'
import { TERMINAL_FOLD_CSS } from './terminal-fold.js'
import { AGENT_TOOLS_CSS } from './agent-tools.js'
import { SANDBOX_FOLD_CSS } from './sandbox-fold.js'
import { THEME_CSS, THEME_WIZARD_CSS, applyCustomTheme, applyTheme, readThemeId, themeOptions } from './themes.js'
import { readCustomTheme, readSavedThemes, type CustomTheme } from '../tracker/theme-wizard.js'
import { FONT_SIZE_CSS, FONT_SIZE_MAX, FONT_SIZE_MIN, applyFontSizes, fontSizeLabel, readFontSize, sizeRoot, type FontSizeBox } from './font-sizes.js'
import { DAY_NIGHT_CSS, applyDayNightCycle } from './day-night.js'
import { BACKDROP_CSS, BACKDROP_PREF, applyBackdrops, backdropConfig, backdropRoot, readBackdrop, scaleBackdropImage, type Backdrop, type BackdropBox } from './backdrop.js'
import { MAX_PORTRAIT_BYTES, toDataUrl } from './tracker-panel.js'
import { MAP_THEME_CSS, applyMapTheme, createMapThemeCard } from './map-theme-card.js'
import { BAR_ANIMATION_CSS, RECOLOR_CSS } from './bar-animation.js'
import { SETTINGS_SCHEMA, type SettingsBag } from '../settings/schema.js'
import { CARTRIDGE_PAYLOAD_GROUPS } from '../state/payload-groups.js'
import { bindSettings, type BoundSettings } from './binder.js'
import { mountTrackerPanel, type TrackerPanel, type TrackerPanelHost } from './tracker-panel.js'
import { mountCustomFieldsEditor, type CustomField, type CustomFieldsEditor } from './custom-fields.js'
import { moduleTag, mountAgentModulesEditor, type AgentModule, type AgentModulesEditor } from './agent-modules.js'
import { mountCustomTagsEditor, type CustomTagsEditor } from './custom-tags.js'
import {
    mountGameSystemsEditor,
    type GameSystemsEditor,
} from './game-systems.js'
import { syncSystemsToFields, type GameSystem, type LinkedField } from '../settings/game-systems.js'
import {
    mountTrackerModulesEditor,
    type TrackerModulesEditor,
} from './tracker-modules.js'
import { mountSyspromptEditor, type SyspromptEditor } from './sysprompt-library.js'
import { mountRulebookSwitches, type RulebookSwitchesEditor } from './rulebook-switches.js'
import { mountCyoaEditor, type CyoaEditor } from './cyoa-editor.js'
import { mountGameSystemWizard, type WizardPanel } from './wizard-panel.js'
import type { WizardSaveTarget } from '../tracker/wizard.js'
import type { SyspromptSection } from '../settings/sysprompt-library.js'
import type { Bridge } from './bridge.js'
import type { BooksListResult, CartridgeExportResult, ConnectionsResult, PrefsResult, PurgePortraitsResult, SceneConnectionsResult, SettingsResult, StatusResult, ThemeGenerateResult } from '../protocol.js'
import { CATEGORIES_CSS, createSettingsCategories, createSettingsSearch } from './categories.js'
import { createConnectionsCategory } from './connections-category.js'

/** The bits of the frontend context the panel uses. */
export interface PanelHost extends TrackerPanelHost {
    dom: {
        createElement: <K extends keyof HTMLElementTagNameMap>(
            tag: K,
            attrs?: Record<string, string>,
        ) => HTMLElementTagNameMap[K]
    }
    ui: {
        showConfirm(options: {
            title?: string
            message?: string
            variant?: 'info' | 'warning' | 'danger' | 'success'
            confirmLabel?: string
        }): Promise<{ confirmed: boolean }>
        /** The host's modal (55): the scene's picture, large. Optional: an older host has none, and the picture stays small. */
        showModal?(options: { title: string; width?: number; maxHeight?: number }): { root: HTMLElement; dismiss(): void }
    }
    uploads: {
        pickFile(options?: { accept?: string[]; multiple?: boolean; maxSizeBytes?: number }): Promise<
            Array<{ name: string; bytes: Uint8Array; mimeType?: string }>
        >
    }
}

export interface Panel {
    /** Re-read the tracker memo — call this when the active chat changes. */
    refreshTracker(): void
    destroy(): void
}

/**
 * How long an export's object URL is kept alive after the download starts.
 * Long enough to outlast a "where do you want to save this?" dialog.
 */
const URL_LIFETIME_MS = 60_000

/** The three keys the game system wizard reads and writes, as lists. */
function wizardTarget(settings: Record<string, unknown>): WizardSaveTarget {
    const list = (value: unknown): Array<Record<string, unknown>> => (Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [])
    return {
        customSyspromptLibrary: list(settings.customSyspromptLibrary),
        customFields: list(settings.customFields),
        gameSystems: list(settings.gameSystems),
        // The picker's options (73g): which stock modules are on.
        ...(settings.modules && typeof settings.modules === 'object' ? { modules: settings.modules as Record<string, boolean> } : {}),
        ...(settings.syspromptModules && typeof settings.syspromptModules === 'object' ? { syspromptModules: settings.syspromptModules as Record<string, boolean> } : {}),
    }
}

/**
 * Where the panel's parts go when the layout is two tabs (47b): `rest` is
 * the second tab's root. Left out, everything is in `root` — the classic
 * layout, which the UI pass keeps as it is until the preference is flipped.
 */
export interface PanelSlots {
    rest?: HTMLElement
    /** The second widget's body (47c, 78a): the Lorebook Agent, the Campaign Records and Visuals/Map as tabs. */
    scene?: HTMLElement
    /** The second widget's strip and foot (78a): the tab strip, and the Lorebook Agent's footer. */
    sceneHead?: HTMLElement
    sceneFoot?: HTMLElement
    /** The tracker widget's strip under its title (57): where the head's lights go, so they never scroll away. */
    trackerHead?: HTMLElement
    /** The tracker widget's foot under its body (74f): where the XP bar at the bottom goes, so it never scrolls away. */
    trackerFoot?: HTMLElement
    /** The widgets' controls, when there are widgets: a hidden one needs a way back. */
    widgets?: { show(which: 'tracker' | 'scene'): void; toggle(which: 'tracker' | 'scene'): void; reset(): void }
}

export function mountPanel(root: HTMLElement, bridge: Bridge, host: PanelHost, slots: PanelSlots = {}): Panel {
    const el = host.dom.createElement
    let bound: BoundSettings | null = null
    let tracker: TrackerPanel | null = null
    let customFields: CustomFieldsEditor | null = null
    let gameSystems: GameSystemsEditor | null = null
    let trackerModules: TrackerModulesEditor | null = null
    /** The agent's two editors (47e), and the factory's modules once fetched, for the badges. */
    let agentModules: AgentModulesEditor | null = null
    let customTags: CustomTagsEditor | null = null
    let factoryAgentModules: Record<string, AgentModule> | null = null
    let worldRules: SyspromptEditor | null = null
    let rulebook: RulebookSwitchesEditor | null = null
    /** Multihog's Narrator Configuration block (70), the settings' copy; the tracker's starting area holds the other. */
    let narrator: NarratorConfig | null = null
    let cyoa: CyoaEditor | null = null
    let wizard: WizardPanel | null = null
    /**
     * The settings as the backend last reported them.
     *
     * The custom fields editor needs the *systems* to keep their flags in step
     * with the fields it writes, and the value handed to an editor at mount is
     * a snapshot that goes stale on the first commit.
     */
    let latestSettings: SettingsBag | null = null

    root.classList.add('adventuretime-panel')
    root.replaceChildren()
    // The font sizes (74e): this root is the tracker's — the tracker widget's
    // body, the play tab, or the one classic tab — and the other two are the
    // second box's. The class goes on the widget around a widget's body, so
    // its head and strip scale with the cards.
    sizeRoot(root, 'tracker')
    // The backdrops (74d): the same two boxes, marked on the same roots and
    // kept, since a root may be painted before the host attaches it.
    const backdropTargets: Element[] = [backdropRoot(root, 'tracker')]
    // The second tab's root is a panel root too (47b-bis): every rule in
    // PANEL_CSS that is scoped to the class — the cartridge buttons' row,
    // the settings sections, their help lines — missed it, and the settings
    // tab drew as bare text (the maintainer's report of 2026-10-10).
    slots.rest?.classList.add('adventuretime-panel')
    slots.rest?.replaceChildren()
    slots.scene?.classList.add('adventuretime-panel')
    slots.scene?.replaceChildren()
    if (slots.rest) sizeRoot(slots.rest, 'settings')
    if (slots.scene) sizeRoot(slots.scene, 'settings')
    if (slots.rest) backdropTargets.push(backdropRoot(slots.rest, 'settings'))
    if (slots.scene) backdropTargets.push(backdropRoot(slots.scene, 'settings'))

    const status = el('div', { class: 'lh-status', role: 'status' })
    const actions = el('div', { class: 'lh-actions' })
    const importButton = el('button', { type: 'button', class: 'lh-button' })
    importButton.textContent = 'Import cartridge…'
    const exportButton = el('button', { type: 'button', class: 'lh-button' })
    exportButton.textContent = 'Export cartridge'
    actions.append(importButton, exportButton)

    /**
     * What build is running, and whether the host has granted it what it needs.
     *
     * One quiet line when all is well, and a warning when it is not. It sits at
     * the top because it answers the two questions that opened every live
     * debugging session so far, both of which used to require reading a backend
     * log:
     *
     *   - *Did my update take?* Lumiverse builds an extension at install time,
     *     so merging a fix does not update an install — someone has to press
     *     Update. A version on screen tells "the fix did not work" apart from
     *     "the fix is not installed yet".
     *   - *Is the permission actually there?* An undeclared permission failed
     *     every tracker pass once, and the only symptom was state that would
     *     not move.
     */
    const diagnostics = el('div', { class: 'lh-diagnostics' })
    // The dice tool, under the diagnostics: a tool call is invisible in the
    // reply, so this is where "did it call it?" is answered (Phase 28a).
    const diceLine = el('div', { class: 'lh-dice-line' })

    /**
     * Something the user did that did not work.
     *
     * A line of its own, because the status line above is the wrong place for
     * it and has been four times now. The status line is *ambient* — it says
     * "Loading settings…", "Saved.", "Ready." — and the useful life of those
     * messages is seconds. A failure is not that: it means work the user
     * believes they did is not there, and it has to survive until they have
     * read it.
     *
     * The custom fields editor is the case that forced this. Its commits were
     * refused for the editor's entire life, the refusal wrote
     * `Setting is not editable here: customFields` into the ambient line, and
     * the very next thing the user did replaced it with "Saved." from a
     * different control. Nothing on screen ever said *your fields were not
     * stored*.
     *
     * Dismissed by hand rather than on a timer, and never cleared by anything
     * the user did not do.
     */
    const problem = el('div', { class: 'lh-problem', role: 'alert' })
    problem.hidden = true
    const problemText = el('span', { class: 'lh-problem-text' })
    const problemDismiss = el('button', { type: 'button', class: 'lh-problem-dismiss' })
    problemDismiss.textContent = 'Dismiss'
    problemDismiss.title = 'Hide this. It does not undo or retry anything.'
    problemDismiss.addEventListener('click', () => { clearProblem() })
    problem.append(problemText, problemDismiss)

    // The tracker sits above the settings: it is the thing a user opens the
    // panel to look at, where the settings are something they configure once.
    const trackerRoot = el('div')
    // The cartridge buttons head the settings, not the panel (47a, by the
    // maintainer's list): a cartridge is a settings file, and the top of the
    // panel is for what is running. Their own box, because the binder
    // replaces the children of the element it is given.
    const cartridges = el('div', { class: 'lh-cartridges' })
    cartridges.append(actions)
    const settingsRoot = el('div', { class: 'lh-settings' })
    const body = el('div', { class: 'lh-body' })
    // The settings in Multihog's seven categories (63), with a search over them. The version line's twin
    // heads the first, so a search for "version" or a permission's name finds it; the line above stays.
    const plainEl = (tag: string, attrs?: Record<string, string>): HTMLElement => el(tag as keyof HTMLElementTagNameMap, attrs)
    const categories = createSettingsCategories(plainEl)
    const search = createSettingsSearch(plainEl, categories.root)
    /** A folding card of General & visuals in the look of the others (82): an icon, a title, a chevron, the body given. */
    const settingsCard = (id: string, icon: string, title: string, body: HTMLElement): HTMLDetailsElement => {
        const root = plainEl('details', { class: 'lh-card lh-second-card lh-search-item', 'data-lh-card': id }) as HTMLDetailsElement
        const summary = plainEl('summary')
        const iconEl = plainEl('span', { class: 'lh-card-icon', 'aria-hidden': 'true' })
        iconEl.textContent = icon
        const titleEl = plainEl('span', { class: 'lh-card-title' })
        titleEl.textContent = title
        summary.append(iconEl, titleEl, plainEl('span', { class: 'lh-chevron', 'aria-hidden': 'true' }))
        const wrap = plainEl('div', { class: 'lh-second-body' })
        wrap.append(body)
        root.append(summary, wrap)
        return root
    }
    const versionTwin = el('div', { class: 'lh-version-twin lh-search-item' })
    // Multihog's Debug & Factory Reset (72a), the last card of General & visuals.
    const developer = createDeveloperCard({
        el: plainEl,
        confirm: async (title, message, confirmLabel) => (await host.ui.showConfirm({ title, message, variant: 'warning', confirmLabel })).confirmed,
        request: (op, params) => bridge.request(op as never, params),
        savePrefs: async (patch) => { await bridge.request<PrefsResult>('prefs.patch', { patch }) },
        // A reset is a load: every editor follows, the custom fields and the world rules too.
        onSettings: (settings) => { seedEditors(settings, 'load') },
        fail: (error) => fail(error),
    })
    // The narrator card's rows (72b) under Help in Core & Branching (81), and the NPC word targets (72b).
    const narratorRows = createNarratorRows({
        el: plainEl,
        create: (name) => bridge.request('narrator.create', { name }),
        savePrefs: async (patch) => { await bridge.request<PrefsResult>('prefs.patch', { patch }) },
        fail: (error) => fail(error),
    })
    // Core & Branching (81): Multihog's first drawer of General & Visuals, as the first card here.
    const coreCard = createCoreCard({
        el: plainEl,
        confirm: async (title, message, confirmLabel) => (await host.ui.showConfirm({ title, message, variant: 'danger', confirmLabel })).confirmed,
        request: (op, params) => bridge.request(op as never, params),
        narrator: narratorRows,
        modal: (options) => openDetailsModal(host.ui, options),
        // Every chat's data went, the open one's with it: the tracker reads its chat again.
        onChatsRemoved: () => { tracker?.refresh().catch(() => undefined) },
        fail: (error) => fail(error),
    })
    const npcWords = createNpcWordsCard({
        el: plainEl,
        save: (major, minor) => bridge.request<{ applied: boolean }>('settings.npcWords', { major, minor }),
        fail: (error) => fail(error),
    })
    // The Map Themes (74g): Multihog's drawer as the second card of Persistent maps; the theme painted on the body, where every map sees it.
    const mapThemeCard = createMapThemeCard({
        el: plainEl,
        savePrefs: (patch) => bridge.request<PrefsResult>('prefs.patch', { patch }),
        upload: (dataUrl, filename) => bridge.request<PrefsResult>('backdrop.upload', { box: 'map', slot: 'day', dataUrl, filename }),
        pickFile: async () => (await host.uploads.pickFile({ accept: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], maxSizeBytes: MAX_PORTRAIT_BYTES }))[0] ?? null,
        toDataUrl: (bytes, mimeType) => scaleBackdropImage(toDataUrl(bytes, mimeType)),
        confirm: async (title, message, confirmLabel) => (await host.ui.showConfirm({ title, message, variant: 'warning', confirmLabel })).confirmed,
        apply: (theme) => { applyMapTheme(root.ownerDocument.body, theme) },
        fail: (error) => fail(error),
    })
    categories.folds.maps.insertBefore(mapThemeCard.root, categories.folds.maps.querySelector('.lh-maps-guide'))
    // The Display Groups (75): Multihog's manager as a card under State tracker & modules, after the tags library.
    const displayGroupsCard = createDisplayGroupsCard({
        el: plainEl,
        savePrefs: (patch) => bridge.request<PrefsResult>('prefs.patch', { patch }),
        confirm: async (title, message, confirmLabel) => (await host.ui.showConfirm({ title, message, variant: 'warning', confirmLabel })).confirmed,
        fail: (error) => fail(error),
    })
    /** The groups and their switch as the section order editor draws them (75); kept for an editor mounted after the preferences arrived. */
    let displayGroupsForOrder: { groups: ReturnType<typeof readDisplayGroups>; enabled: boolean } = { groups: [], enabled: false }
    function applyDisplayGroupPrefs(prefs: Record<string, unknown>): void {
        displayGroupsCard.applyPrefs(prefs)
        if (prefs.displayGroups !== undefined) displayGroupsForOrder = { ...displayGroupsForOrder, groups: readDisplayGroups(prefs.displayGroups) }
        if (typeof prefs.displayGroupsEnabled === 'boolean') displayGroupsForOrder = { ...displayGroupsForOrder, enabled: prefs.displayGroupsEnabled }
        trackerModules?.setDisplayGroups(displayGroupsForOrder.groups, displayGroupsForOrder.enabled)
    }
    const connections = createConnectionsCategory({
        el: plainEl,
        savePrefs: async (patch) => { await bridge.request<PrefsResult>('prefs.patch', { patch }) },
        textConnections: () => bridge.request<ConnectionsResult>('connections.list', {}),
        imageConnections: () => bridge.request<SceneConnectionsResult>('scene.connections', {}),
        fail: (error) => fail(error),
    })
    categories.bodies.connections.append(connections.root)
    categories.folds.connections.addEventListener('toggle', () => { if (categories.folds.connections.open) connections.load() })
    // The foot of the portraits section (63b): the drawing settings mirrored —
    // 61's switches and lookback, and the scene picture's five dials — one
    // preference, two rows, kept in step by `prefs.changed`, as the connections
    // are. The two connections stay the Connections category's.
    const savePrefs = async (patch: Record<string, unknown>): Promise<void> => { await bridge.request<PrefsResult>('prefs.patch', { patch }) }
    const mirrorPortraits = createPortraitDrawSettings({
        el: plainEl,
        savePrefs,
        check: async () => {
            const chatId = host.getActiveChat().chatId
            if (chatId) await bridge.request<unknown>('portraits.auto.check', { chatId })
        },
        fail: (error) => fail(error),
    }, { mirror: true })
    const mirrorScene = createScenePictureSettings({ el: plainEl, savePrefs, fail: (error) => fail(error) }, 'mirror-')
    // The section in Multihog's order (83): the two mirrors' rows laid out flat at its head with the
    // portraits switch and Show Location Images, the Real-Time box and the connections' note; the
    // purge at its foot. The two folds the rows sat in are gone from the settings.
    const portraitsSection = createPortraitsSection({
        el: plainEl,
        savePrefs,
        purge: () => bridge.request<PurgePortraitsResult>('maintenance.purgePortraits'),
        confirm: async (title, message, label) => (await host.ui.showConfirm({ title, message, variant: 'warning', confirmLabel: label })).confirmed,
        fail: (error) => fail(error),
    }, mirrorPortraits, mirrorScene)
    // The other mirrored dials (63c): a box per category with dials of its own, bound to the folds' keys,
    // appended after the category's sections once the binder has drawn them.
    const dialBoxes = PREF_DIAL_GROUPS.map((group) => createPrefDials({
        el: plainEl, savePrefs, fail: (error) => fail(error),
        // The host's books by name (73h), for the tracker's lorebook filter.
        listBooks: async () => (await bridge.request<BooksListResult>('books.list', {})).books,
    }, group))
    /** The art styles editor (63b), mounted on the saved setups' row. */
    let styles: PortraitStyles | null = null
    // The NPC and PC sections editors (77), one per kind on the Character Sheets card.
    let sectionsNpc: SectionsEditor | null = null
    let sectionsPc: SectionsEditor | null = null

    /**
     * The Layout box (47b): the install's furniture, preferences rather than
     * cartridge keys. The layout itself is the two floating widgets alone
     * since 82 (the maintainer's ask of 2026-10-28; the select that offered
     * the two tabs and the classic tab is gone, the layouts kept in
     * layout.ts), so the box opens on what the widgets do.
     */
    const layoutBox = el('div', { class: 'lh-layout' })
    const layoutHint = el('div', { class: 'lh-section-help' })
    layoutHint.textContent = 'The tracker is one floating box and the Lorebook Agent, the Campaign Records and Visuals/Map are the tabs of another; drag them where you like, pull the corner to size them, fold them to their heads. This tab holds the rest.'
    // Tab Mode (76): Multihog's Panel Layout toggle, under the layout select as it heads
    // Multihog's page — Stacked, or Character and Combat pinned above a tab strip.
    const panelLayoutRow = el('div', { class: 'lh-layout-row lh-panel-layout-row' })
    const panelLayoutLabel = el('span')
    panelLayoutLabel.textContent = 'Panel layout'
    const panelLayoutSeg = el('div', { class: 'lh-seg-toggle', role: 'group', 'data-lh-field': 'panelLayoutMode', title: 'Stacked shows every module at once, vertically. Tab Mode pins Character/Combat at the top and puts the rest behind a compact tab strip — better for small screens or mobile.' })
    const panelLayoutButtons = new Map<'stack' | 'tabs', HTMLButtonElement>()
    for (const [value, text] of [['stack', '📚 Stacked'], ['tabs', '🗂️ Tab Mode (Compact)']] as const) {
        const button = el('button', { type: 'button', class: 'lh-button lh-seg-button', 'data-lh-value': value }) as HTMLButtonElement
        button.textContent = text
        button.addEventListener('click', () => {
            showPanelLayout(value)
            bridge.request<PrefsResult>('prefs.patch', { patch: { panelLayoutMode: value } })
                .then((result) => { showPanelLayout(result.prefs?.panelLayoutMode) })
                .catch(fail)
        })
        panelLayoutButtons.set(value, button)
        panelLayoutSeg.append(button)
    }
    function showPanelLayout(mode: unknown): void {
        const chosen = mode === 'tabs' ? 'tabs' : 'stack'
        for (const [value, button] of panelLayoutButtons) {
            button.classList.toggle('active', value === chosen)
            button.setAttribute('aria-pressed', value === chosen ? 'true' : 'false')
        }
    }
    showPanelLayout('stack')
    panelLayoutRow.append(panelLayoutLabel, panelLayoutSeg)
    // The visual theme (74a, departure 81): Multihog's select, under the
    // layout as it sits under Multihog's layout buttons. A preference, not a
    // cartridge key (the maintainer's decision of 2026-10-21): the theme
    // travels with the install, not the game. The class goes on the body and
    // reaches every root at once (themes.ts says why).
    const themeRow = el('label', { class: 'lh-layout-row lh-theme-row' })
    const themeLabel = el('span')
    themeLabel.textContent = 'Visual theme'
    const themeSelect = el('select', { class: 'lh-select', 'data-lh-field': 'trackerTheme' }) as HTMLSelectElement
    for (const option of themeOptions()) {
        const item = el('option', { value: option.id }) as HTMLOptionElement
        item.textContent = option.label
        if (!option.available) item.disabled = true
        themeSelect.append(item)
    }
    themeRow.append(themeLabel, themeSelect)
    const themeHint = el('div', { class: 'lh-section-help' })
    themeHint.textContent = 'Multihog’s looks for the panel, the widgets and the cards under the messages: Hacker, Fantasy, Hologram, Pacific Cove and Cherry Blossom, with their own colours and fonts. Match Lumiverse is the host’s own colours, the look before the theme pass. Custom is the AI Theme Wizard’s: describe a look and a model writes the fifteen values.'
    // The AI Theme Wizard (74b, departure 81): Multihog's block under the
    // select, shown while Custom is chosen. The theme the wizard wrote and
    // the library are preferences; the undo stack is the panel's memory,
    // twenty deep, as the legacy's is.
    let customTheme: CustomTheme | null = null
    let savedThemes: Record<string, CustomTheme> = {}
    const themeUndo: CustomTheme[] = []
    const showTheme = (value: unknown) => {
        const theme = readThemeId(value)
        themeSelect.value = theme
        applyTheme(root.ownerDocument.body, theme)
        applyCustomTheme(root.ownerDocument.body, theme === 'custom' ? customTheme : null)
        wizardBox.hidden = theme !== 'custom'
    }
    const wizardBox = el('div', { class: 'lh-theme-wizard', 'data-lh-field': 'themeWizard' })
    wizardBox.hidden = true
    const wizardTitle = el('div', { class: 'lh-theme-wizard-title' })
    wizardTitle.textContent = '🪄 AI Theme Wizard'
    const wizardPrompt = el('textarea', { class: 'lh-input', rows: '3', placeholder: 'Describe visual style...', 'data-lh-field': 'themeWizardPrompt' }) as HTMLTextAreaElement
    const wizardStatus = el('div', { class: 'lh-theme-wizard-status', role: 'status' })
    const setWizardStatus = (message: string, isError = false) => {
        wizardStatus.textContent = message
        wizardStatus.classList.toggle('lh-theme-wizard-status--error', isError)
    }
    const wizardRun = el('div', { class: 'lh-theme-wizard-row' })
    const wizardNew = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'themeWizardNew' }) as HTMLButtonElement
    wizardNew.textContent = 'New'
    wizardNew.title = 'Write a new theme from the description, on the tracker’s connection.'
    const wizardIterate = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'themeWizardIterate' }) as HTMLButtonElement
    wizardIterate.textContent = 'Iterate'
    wizardIterate.title = 'Send the current theme with the change described, and take the result.'
    wizardRun.append(wizardNew, wizardIterate)
    const wizardKeep = el('div', { class: 'lh-theme-wizard-row' })
    const wizardName = el('input', { type: 'text', class: 'lh-input lh-theme-wizard-name', placeholder: 'My Custom Theme', 'data-lh-field': 'themeWizardName' }) as HTMLInputElement
    const wizardSave = el('button', { type: 'button', class: 'lh-button', 'data-lh-field': 'themeWizardSave' }) as HTMLButtonElement
    wizardSave.textContent = '🔖 Save to Library'
    const wizardUndo = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': 'themeWizardUndo' }) as HTMLButtonElement
    wizardUndo.textContent = '↶ Undo'
    wizardUndo.title = 'Put the theme back as it was before the last New, Iterate or Undo-able change, twenty deep.'
    wizardKeep.append(wizardName, wizardSave, wizardUndo)
    const wizardLibrary = el('div', { class: 'lh-theme-library', 'data-lh-field': 'themeLibrary' })
    wizardLibrary.hidden = true
    const drawLibrary = () => {
        wizardLibrary.replaceChildren()
        const names = Object.keys(savedThemes)
        wizardLibrary.hidden = names.length === 0
        if (names.length === 0) return
        const title = el('div', { class: 'lh-theme-library-title' })
        title.textContent = 'Saved themes — click one to load it'
        wizardLibrary.append(title)
        for (const name of names) {
            const row = el('div', { class: 'lh-theme-library-row' })
            const load = el('button', { type: 'button', class: 'lh-button lh-theme-library-name', 'data-lh-theme-load': name })
            load.textContent = name
            load.title = 'Click to load this theme'
            load.addEventListener('click', () => {
                const theme = savedThemes[name]
                if (!theme) return
                customTheme = { ...theme }
                showTheme('custom')
                bridge.request<PrefsResult>('prefs.patch', { patch: { customTheme, trackerTheme: 'custom' } })
                    .then(() => { setWizardStatus(`⚡ Loaded library theme: ${name}`) })
                    .catch((error: unknown) => { setWizardStatus(`❌ ${error instanceof Error ? error.message : String(error)}`, true) })
            })
            const remove = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-theme-delete': name })
            remove.textContent = '🗑'
            remove.title = 'Delete theme'
            remove.addEventListener('click', async () => {
                const { confirmed } = await host.ui.showConfirm({ title: 'Delete the saved theme?', message: `Are you sure you want to delete the theme "${name}"?`, variant: 'warning', confirmLabel: 'Delete' })
                if (!confirmed) return
                const { [name]: _gone, ...rest } = savedThemes
                savedThemes = rest
                drawLibrary()
                bridge.request<PrefsResult>('prefs.patch', { patch: { savedThemes } })
                    .then(() => { setWizardStatus(`Deleted theme: ${name}`) })
                    .catch((error: unknown) => { setWizardStatus(`❌ ${error instanceof Error ? error.message : String(error)}`, true) })
            })
            row.append(load, remove)
            wizardLibrary.append(row)
        }
    }
    const runWizard = (iterate: boolean) => {
        const description = wizardPrompt.value.trim()
        if (!description) {
            setWizardStatus(iterate ? '⚠ Please describe the changes you want.' : '⚠ Please describe a theme first.', true)
            return
        }
        wizardNew.disabled = true
        wizardIterate.disabled = true
        setWizardStatus(iterate && customTheme ? '⚡ Refining theme.' : '⚡ Generating theme.')
        bridge.request<ThemeGenerateResult>('theme.generate', { description, iterate })
            .then((result) => {
                if (customTheme) {
                    themeUndo.push({ ...customTheme })
                    if (themeUndo.length > 20) themeUndo.shift()
                }
                customTheme = readCustomTheme(result.theme)
                showTheme('custom')
                const left = result.missing.length > 0 ? ` The model left out ${result.missing.length} of the fifteen values; those fall to the host’s.` : ''
                setWizardStatus(`${result.iterated ? '✅ Theme refined!' : '✅ Theme generated!'}${left}`)
            })
            .catch((error: unknown) => { setWizardStatus(`❌ ${error instanceof Error ? error.message : String(error)}`, true) })
            .finally(() => { wizardNew.disabled = false; wizardIterate.disabled = false })
    }
    wizardNew.addEventListener('click', () => { runWizard(false) })
    wizardIterate.addEventListener('click', () => { runWizard(true) })
    wizardUndo.addEventListener('click', () => {
        const previous = themeUndo.pop()
        if (!previous) { setWizardStatus('No steps to undo.'); return }
        customTheme = previous
        showTheme('custom')
        bridge.request<PrefsResult>('prefs.patch', { patch: { customTheme: previous, trackerTheme: 'custom' } })
            .then(() => { setWizardStatus(`Undone last change. (${themeUndo.length} steps remaining)`) })
            .catch((error: unknown) => { setWizardStatus(`❌ ${error instanceof Error ? error.message : String(error)}`, true) })
    })
    wizardSave.addEventListener('click', async () => {
        if (!customTheme) { setWizardStatus('⚠ No custom theme to save. Generate one first!', true); return }
        const name = wizardName.value.trim() || 'My Custom Theme'
        if (savedThemes[name]) {
            const { confirmed } = await host.ui.showConfirm({ title: 'Replace the saved theme?', message: `A theme named "${name}" already exists. Overwrite?`, variant: 'warning', confirmLabel: 'Overwrite' })
            if (!confirmed) return
        }
        savedThemes = { ...savedThemes, [name]: { ...customTheme } }
        drawLibrary()
        bridge.request<PrefsResult>('prefs.patch', { patch: { savedThemes } })
            .then(() => { setWizardStatus(`Saved "${name}" to library.`) })
            .catch((error: unknown) => { setWizardStatus(`❌ ${error instanceof Error ? error.message : String(error)}`, true) })
    })
    wizardBox.append(wizardTitle, wizardPrompt, wizardRun, wizardKeep, wizardStatus, wizardLibrary)
    themeSelect.addEventListener('change', () => {
        const trackerTheme = readThemeId(themeSelect.value)
        // Shown at once; the event every save sends confirms it, and a refusal puts the stored one back.
        applyTheme(root.ownerDocument.body, trackerTheme)
        bridge.request<PrefsResult>('prefs.patch', { patch: { trackerTheme } })
            .then((result) => { showTheme(result.prefs?.trackerTheme) })
            .catch(fail)
    })
    // The day/night cycle (74c): Multihog's tick under its theme select. The
    // switch is a class on the body (day-night.ts); the phase beside it is the
    // tracker panel's, read off the memo on every redraw. Shown at once, as the
    // theme is, and confirmed by the event every save sends.
    const dayNightRow = el('label', { class: 'lh-layout-row lh-daynight-row' })
    const dayNightInput = el('input', { type: 'checkbox', 'data-lh-field': 'dayNightCycle' }) as HTMLInputElement
    const dayNightLabel = el('span')
    dayNightLabel.textContent = 'Day/night cycle'
    dayNightRow.append(dayNightInput, dayNightLabel)
    const dayNightHint = el('div', { class: 'lh-section-help' })
    dayNightHint.textContent = 'Shifts every box’s colours and shows a sun or moon in the tracker’s head to match the in-world time from the memo’s [TIME] block (it needs an HH:MM clock). Seven phases: late night, dawn, morning, midday, afternoon, sunset and night, crossfading over two seconds. Purely decorative: no effect on prompts or the memo.'
    const showDayNight = (stored: unknown) => {
        dayNightInput.checked = stored === true
        applyDayNightCycle(root.ownerDocument.body, stored === true)
    }
    dayNightInput.addEventListener('change', () => {
        const dayNightCycle = dayNightInput.checked
        applyDayNightCycle(root.ownerDocument.body, dayNightCycle)
        bridge.request<PrefsResult>('prefs.patch', { patch: { dayNightCycle } })
            .then((result) => { showDayNight(result.prefs?.dayNightCycle) })
            .catch(fail)
    })
    // The XP bar at the bottom (74f): Multihog's tick under the day/night
    // one, on as it ships. The tracker panel draws the bar and leaves the XP
    // card out; this row only writes the preference, which the event every
    // save sends carries to the tracker panel and back to this tick.
    const xpBarRow = el('label', { class: 'lh-layout-row lh-xpbar-row' })
    const xpBarInput = el('input', { type: 'checkbox', 'data-lh-field': 'xpBarAtBottom' }) as HTMLInputElement
    const xpBarLabel = el('span')
    xpBarLabel.textContent = 'XP bar at the foot of the tracker'
    xpBarRow.append(xpBarInput, xpBarLabel)
    const xpBarHint = el('div', { class: 'lh-section-help' })
    xpBarHint.textContent = 'Moves XP out of its module card and pins it at the foot of the tracker’s box, like an MMO experience bar: the widget’s foot, or the foot of the view in the tabs and classic layouts. The cards under the messages keep their XP card.'
    const showXpBar = (stored: unknown) => { xpBarInput.checked = stored === true }
    xpBarInput.addEventListener('change', () => {
        const xpBarAtBottom = xpBarInput.checked
        bridge.request<PrefsResult>('prefs.patch', { patch: { xpBarAtBottom } })
            .then((result) => { showXpBar(result.prefs?.xpBarAtBottom) })
            .catch(fail)
    })
    // The animated bars (74h): Multihog's tick under the XP bar's, on as it
    // ships. The renderer marks every custom BAR and BARREL to animate while
    // it is on; the tracker panel plays the change as the cards redraw. This
    // row only writes the preference, which the event every save sends
    // carries to the tracker panel and back to this tick.
    const animateBarsRow = el('label', { class: 'lh-layout-row lh-animate-bars-row' })
    const animateBarsInput = el('input', { type: 'checkbox', 'data-lh-field': 'animateAllCustomBarChanges' }) as HTMLInputElement
    const animateBarsLabel = el('span')
    animateBarsLabel.textContent = 'Animate changes on every custom bar'
    animateBarsRow.append(animateBarsInput, animateBarsLabel)
    const animateBarsHint = el('div', { class: 'lh-section-help' })
    animateBarsHint.textContent = 'A green gain or a red loss floated over every custom BAR and BARREL marker as it lands, the changed segment lit while the fill catches up. A bar’s own tick under Bars in the tracker still animates it with this off. The XP row’s gain floats either way.'
    const showAnimateBars = (stored: unknown) => { animateBarsInput.checked = stored === true }
    animateBarsInput.addEventListener('change', () => {
        const animateAllCustomBarChanges = animateBarsInput.checked
        bridge.request<PrefsResult>('prefs.patch', { patch: { animateAllCustomBarChanges } })
            .then((result) => { showAnimateBars(result.prefs?.animateAllCustomBarChanges) })
            .catch(fail)
    })
    // The font sizes (74e): Multihog's two sliders under its theme select,
    // 8 to 32 px. The tracker's covers the tracker widget, the play tab and
    // the cards under the messages; the second box's covers the map, scene
    // and relationships widget and the settings tab. A slider moves the box
    // as it is dragged and saves when it is let go; × puts the host's size
    // back (departure 122: the host's size is the default, not Multihog's
    // 14 and 13, so a panel that never touched a slider is the look before).
    const fontSizeRows: Partial<Record<FontSizeBox, { slider: HTMLInputElement; value: HTMLElement; reset: HTMLButtonElement }>> = {}
    const showFontSize = (box: FontSizeBox, stored: unknown) => {
        const size = readFontSize(stored)
        const row = fontSizeRows[box]
        if (row) {
            row.slider.value = String(size > 0 ? size : 13)
            row.value.textContent = fontSizeLabel(size)
            row.reset.disabled = size === 0
        }
        applyFontSizes(root.ownerDocument.body, { [box]: size })
    }
    const fontSizeBoxes: Array<{ box: FontSizeBox; key: 'trackerFontSize' | 'settingsFontSize'; label: string; title: string }> = [
        { box: 'tracker', key: 'trackerFontSize', label: 'Tracker font size', title: 'The tracker widget, the play tab and the cards under the messages.' },
        { box: 'settings', key: 'settingsFontSize', label: 'Settings font size', title: 'The map, scene and relationships widget, and the settings tab.' },
    ]
    const fontSizeBlock = el('div', { class: 'lh-font-sizes' })
    for (const { box, key, label, title } of fontSizeBoxes) {
        const row = el('label', { class: 'lh-layout-row lh-font-size-row', title })
        const name = el('span')
        name.textContent = label
        const slider = el('input', { type: 'range', min: String(FONT_SIZE_MIN), max: String(FONT_SIZE_MAX), step: '1', 'data-lh-field': key }) as HTMLInputElement
        slider.value = '13'
        const value = el('span', { class: 'lh-font-size-value' })
        value.textContent = fontSizeLabel(0)
        const reset = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-field': `${key}-reset` }) as HTMLButtonElement
        reset.textContent = '×'
        reset.title = 'Use the host’s own size.'
        reset.disabled = true
        row.append(name, slider, value, reset)
        fontSizeRows[box] = { slider, value, reset }
        // Dragging shows the size at once; letting go saves it, and a refusal puts the stored one back.
        slider.addEventListener('input', () => {
            const size = readFontSize(slider.value)
            value.textContent = fontSizeLabel(size)
            applyFontSizes(root.ownerDocument.body, { [box]: size })
        })
        const save = (size: number) => {
            showFontSize(box, size)
            bridge.request<PrefsResult>('prefs.patch', { patch: { [key]: size } })
                .then((result) => { showFontSize(box, result.prefs?.[key]) })
                .catch(fail)
        }
        slider.addEventListener('change', () => { save(readFontSize(slider.value)) })
        reset.addEventListener('click', () => { save(0) })
        fontSizeBlock.append(row)
    }
    const fontSizeHint = el('div', { class: 'lh-section-help' })
    fontSizeHint.textContent = 'Multihog’s two sliders, 8 to 32 px. Until a slider moves, each box keeps the host’s own size; × puts it back.'
    // The cards under the messages (67, the maintainer's ask): the switch
    // sat with the tracker since Phase 4 and lives under General & visuals
    // now. Not a cartridge key — the install's furniture, as the layout is.
    const cardsRow = el('label', { class: 'lh-layout-row lh-tracker-pref' })
    const cardsToggle = el('input', { type: 'checkbox', 'data-lh-field': 'message-cards' }) as HTMLInputElement
    // Off as it ships since 82; the preference read fills it.
    cardsToggle.checked = false
    const cardsLabel = el('span')
    cardsLabel.textContent = 'Show a tracker card under each message'
    cardsRow.append(cardsToggle, cardsLabel)
    cardsToggle.addEventListener('change', () => {
        // Put the box back if the write failed, rather than showing a state the backend does not have.
        const wanted = cardsToggle.checked
        bridge.request<PrefsResult>('prefs.patch', { patch: { messageCards: wanted } })
            .then(() => { say(wanted ? 'Cards will show under each message.' : 'Cards under messages are off.') })
            .catch((error: unknown) => { cardsToggle.checked = !wanted; fail(error) })
    })
    // A hidden widget needs a way back (47c), and a shown one a way out (67):
    // the buttons toggle, and a third puts both boxes back where a fresh
    // install draws them. Drawn only when the layout module has widgets.
    const widgetButtons = el('div', { class: 'lh-actions lh-widget-buttons' })
    if (slots.widgets) {
        for (const [which, text] of [['tracker', 'Toggle the tracker widget'], ['scene', 'Toggle the map, scene and relationships widget']] as const) {
            const button = el('button', { type: 'button', class: 'lh-button', 'data-lh-widget': which })
            button.textContent = text
            button.title = 'Hide the widget, or bring it back where it was if it was hidden with its ×.'
            button.addEventListener('click', () => { slots.widgets?.toggle(which) })
            widgetButtons.append(button)
        }
        const reset = el('button', { type: 'button', class: 'lh-button lh-button--quiet', 'data-lh-widget': 'reset' })
        reset.textContent = 'Reset the widgets’ positions'
        reset.title = 'Put both widgets back where a fresh install draws them, and show them. Their sizes are kept.'
        reset.addEventListener('click', () => { slots.widgets?.reset() })
        widgetButtons.append(reset)
    } else {
        widgetButtons.hidden = true
    }
    // The backdrops (74d): Multihog's two blocks under its tick — a day
    // image, a night image and the tint's strength per box — as the font
    // sizes' two boxes. An upload goes through the host's picker and store,
    // scaled as the legacy scales it; the preference holds the address.
    const backdrops: Record<BackdropBox, Backdrop> = { tracker: readBackdrop(null), settings: readBackdrop(null) }
    const backdropBlock = el('div', { class: 'lh-backdrops', 'data-lh-field': 'backdrops' })
    const backdropRows: Partial<Record<BackdropBox, { day: HTMLElement; night: HTMLElement; url: HTMLInputElement; nightUrl: HTMLInputElement; strength: HTMLInputElement; value: HTMLElement; note: HTMLElement }>> = {}
    const showBackdrop = (box: BackdropBox, stored: unknown) => {
        backdrops[box] = readBackdrop(stored)
        const rows = backdropRows[box]
        if (rows) {
            const config = backdropConfig(backdrops[box])
            rows.day.style.backgroundImage = config.day ? `url(${JSON.stringify(config.day)})` : 'none'
            rows.night.style.backgroundImage = config.night ? `url(${JSON.stringify(config.night)})` : 'none'
            rows.strength.value = String(backdrops[box].strength)
            rows.value.textContent = `${backdrops[box].strength}%`
            rows.url.value = /^https?:\/\//i.test(backdrops[box].day) ? backdrops[box].day : ''
            rows.nightUrl.value = /^https?:\/\//i.test(backdrops[box].night) ? backdrops[box].night : ''
        }
        applyBackdrops(backdropTargets, { trackerBackdrop: backdrops.tracker, settingsBackdrop: backdrops.settings })
    }
    const backdropBoxes: Array<{ box: BackdropBox; title: string; help: string }> = [
        { box: 'tracker', title: 'Backdrop behind the tracker’s box', help: 'Optional scenario art behind the tracker widget, the play tab or the one classic tab. A tint keeps the text readable; with the day/night cycle on it shifts with the in-world time. The night image swaps in during night and late night from [TIME], cycle or no cycle.' },
        { box: 'settings', title: 'Backdrop behind the second box', help: 'The map, scene and relationships widget, and the settings tab. In the classic layout everything is in the tracker’s box, so only its backdrop shows.' },
    ]
    for (const { box, title, help } of backdropBoxes) {
        const card = el('div', { class: 'lh-backdrop-box', 'data-lh-backdrop-box': box })
        const cardTitle = el('div', { class: 'lh-backdrop-title' })
        cardTitle.textContent = title
        const cardHelp = el('div', { class: 'lh-section-help' })
        cardHelp.textContent = help
        const note = el('div', { class: 'lh-backdrop-note', role: 'status' })
        const say = (message: string, error = false) => { note.textContent = message; note.classList.toggle('lh-backdrop-note--error', error) }
        const boxName = box === 'tracker' ? 'tracker’s' : 'second'
        const save = (next: Backdrop, done: string) => {
            bridge.request<PrefsResult>('prefs.patch', { patch: { [BACKDROP_PREF[box]]: next } })
                .then((result) => { showBackdrop(box, result.prefs?.[BACKDROP_PREF[box]]); say(done) })
                .catch((error: unknown) => { say(error instanceof Error ? error.message : String(error), true) })
        }
        const upload = async (slot: 'day' | 'night') => {
            const [picked] = await host.uploads.pickFile({ accept: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], maxSizeBytes: MAX_PORTRAIT_BYTES })
            if (!picked) { say('No picture was picked.'); return }
            say('Storing the picture…')
            const mime = picked.mimeType || (/\.jpe?g$/i.test(picked.name) ? 'image/jpeg' : /\.webp$/i.test(picked.name) ? 'image/webp' : /\.gif$/i.test(picked.name) ? 'image/gif' : 'image/png')
            const dataUrl = await scaleBackdropImage(toDataUrl(picked.bytes, mime))
            const filename = dataUrl.startsWith('data:image/jpeg') ? `backdrop-${box}-${slot}.jpg` : picked.name || `backdrop-${box}-${slot}.png`
            const result = await bridge.request<PrefsResult>('backdrop.upload', { box, slot, dataUrl, filename })
            showBackdrop(box, result.prefs?.[BACKDROP_PREF[box]])
            say(slot === 'day' ? `The ${boxName} box’s backdrop is set.` : `The ${boxName} box’s night backdrop is set.`)
        }
        const slotRow = (slot: 'day' | 'night') => {
            const row = el('div', { class: 'lh-backdrop-row' })
            const preview = el('div', { class: `lh-backdrop-preview${slot === 'night' ? ' lh-backdrop-preview--night' : ''}`, title: slot === 'day' ? 'Day / default background' : 'Night / late night background (optional)' })
            const fields = el('div', { class: 'lh-backdrop-fields' })
            if (slot === 'night') { const label = el('span', { class: 'lh-backdrop-slot' }); label.textContent = 'Night image (optional)'; fields.append(label) }
            const buttons = el('div', { class: 'lh-backdrop-buttons' })
            const uploadButton = el('button', { type: 'button', class: 'lh-button', 'data-lh-backdrop-upload': `${box}:${slot}` })
            uploadButton.textContent = slot === 'day' ? '⬆ Upload' : '🌙 Upload'
            uploadButton.addEventListener('click', () => { upload(slot).catch((error: unknown) => { say(error instanceof Error ? error.message : String(error), true) }) })
            const clearButton = el('button', { type: 'button', class: 'lh-button', 'data-lh-backdrop-clear': `${box}:${slot}` })
            clearButton.textContent = 'Clear'
            clearButton.addEventListener('click', () => { save({ ...backdrops[box], [slot]: '' }, slot === 'day' ? 'The backdrop is cleared.' : 'The night image is cleared.') })
            buttons.append(uploadButton, clearButton)
            fields.append(buttons)
            // An address box on both rows (74d-bis, the maintainer's ask: the
            // legacy's night row takes a file only).
            const url = el('input', { type: 'text', class: 'lh-input lh-backdrop-url', placeholder: slot === 'day' ? 'Or paste an image URL…' : 'Or paste a night image URL…', 'data-lh-backdrop-url': `${box}:${slot}` }) as HTMLInputElement
            url.addEventListener('change', () => {
                const value = url.value.trim()
                if (!value) { save({ ...backdrops[box], [slot]: '' }, slot === 'day' ? 'The backdrop is cleared.' : 'The night image is cleared.'); return }
                // The legacy's rule: an https address, or a file.
                if (!/^https?:\/\//i.test(value)) { say('Use an https image URL or upload a file.', true); return }
                save({ ...backdrops[box], [slot]: value }, slot === 'day' ? `The ${boxName} box’s backdrop is set.` : `The ${boxName} box’s night backdrop is set.`)
            })
            fields.append(url)
            row.append(preview, fields)
            return { row, preview, url }
        }
        const day = slotRow('day')
        const night = slotRow('night')
        const strengthRow = el('div', { class: 'lh-backdrop-strength' })
        const strengthLabel = el('span')
        strengthLabel.textContent = 'Overlay strength'
        const strength = el('input', { type: 'range', min: '0', max: '100', step: '1', 'data-lh-backdrop-strength': box, title: 'Higher = a stronger day/night (or neutral) tint over the image' }) as HTMLInputElement
        const value = el('span', { class: 'lh-backdrop-strength-value' })
        strength.addEventListener('input', () => {
            const next = Math.max(0, Math.min(100, Math.round(Number(strength.value) || 0)))
            backdrops[box] = { ...backdrops[box], strength: next }
            value.textContent = `${next}%`
            applyBackdrops(backdropTargets, { trackerBackdrop: backdrops.tracker, settingsBackdrop: backdrops.settings })
        })
        strength.addEventListener('change', () => { save(backdrops[box], '') })
        strengthRow.append(strengthLabel, strength, value)
        backdropRows[box] = { day: day.preview, night: night.preview, url: day.url, nightUrl: night.url, strength, value, note }
        card.append(cardTitle, cardHelp, day.row, night.row, strengthRow, note)
        backdropBlock.append(card)
        showBackdrop(box, null)
    }
    layoutBox.append(layoutHint, panelLayoutRow, themeRow, themeHint, wizardBox, dayNightRow, dayNightHint, xpBarRow, xpBarHint, animateBarsRow, animateBarsHint, fontSizeBlock, fontSizeHint, backdropBlock, cardsRow, widgetButtons)
    // Each in a folding card of its own (82, the maintainer's ask), as the cards around them.
    // Multihog's name for the drawer since 84 (the maintainer's ask): the theme, the sizes, the backdrops and the widgets live in it.
    const layoutCard = settingsCard('layout', '🎨', 'UI Appearance', layoutBox)
    const cartridgesCard = settingsCard('cartridges', '💾', 'Cartridges', cartridges)
    categories.bodies.general.append(versionTwin, coreCard.root, layoutCard, cartridgesCard)
    settingsRoot.append(search.root, categories.root)
    body.append(settingsRoot)
    // Two tabs: the play tab holds the tracker's play parts; the other holds
    // the status line, the dice line (78d), the version line, the problem line,
    // the rest of the tracker's folds and the settings. One tab: the order it has had.
    const trackerRest = slots.rest ? el('div') : null
    /**
     * Multihog's Modular Repertoire (78a): the Agent modules and Custom tags editors live in the Lorebook
     * Agent tab, not the settings. The binder draws their rows as every other row, and the rows are then
     * re-parented into this box, which the tracker panel places; a cartridge load re-seeds the editors in
     * place, so the move is made once.
     */
    const repertoire = el('div', { class: 'lh-repertoire', 'data-lh-field': 'repertoire' })
    /** The two rows, noted as the binder draws them and moved once it has placed them (it appends a row to its section after the editor mounts). */
    const repertoireRows: HTMLElement[] = []
    if (slots.rest && trackerRest) {
        // The dice line under the status line of the settings tab since 78d (the maintainer's ask); it headed the play tab before.
        root.append(trackerRoot)
        slots.rest.append(status, diceLine, diagnostics, problem, trackerRest, body)
    } else {
        root.append(status, diagnostics, diceLine, problem, trackerRoot, body)
    }

    function say(message: string, tone: 'ok' | 'error' = 'ok'): void {
        status.textContent = message
        status.classList.toggle('lh-status-error', tone === 'error')
    }

    /** Show a failure, and keep showing it. */
    function reportProblem(message: string): void {
        problemText.textContent = message
        problem.hidden = false
    }

    function clearProblem(): void {
        problemText.textContent = ''
        problem.hidden = true
    }

    /**
     * Report a failure on the line that is for failures.
     *
     * `context` names what the user was doing, because the host's own words
     * are frequently about our internals rather than about their action —
     * `Setting is not editable here: customFields` is true, and says nothing
     * about the fields the user just typed. The host's wording is kept after
     * it rather than replaced: repeating the host verbatim is what let Phase 7a
     * find a bug in one round trip.
     */
    function fail(error: unknown, context?: string): void {
        const words = error instanceof Error ? error.message : String(error)
        reportProblem(context ? `${context} — ${words}` : words)
    }

    /** `13:02`, local time, the same on every locale. */
    const clock = (iso: string): string => {
        const d = new Date(iso)
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }

    /** Draw the dice tool line from what the backend reported. */
    function drawDice(dice: StatusResult['dice']): void {
        diceLine.replaceChildren()
        diceLine.className = 'lh-dice-line'
        if (!dice) return

        // This reply's calls, each one against the narration; the total after.
        const describe = (c: NonNullable<typeof dice.last>) =>
            `${c.for || c.who || 'roll'} ${c.formula || '1d20'}${c.dc ? ` vs DC ${c.dc}` : ''}` +
            `${c.total !== null ? ` → ${c.total}` : ''}${c.verdict ? ` ${c.verdict}` : ''}`
        const turn = dice.turn ?? []
        const calls =
            dice.calls === 0
                ? 'not called yet'
                : turn.length === 0
                  ? `this reply: no calls · ${dice.calls} in total${dice.last ? `, last ${clock(dice.last.at)}` : ''}`
                  : `this reply: ${turn.map(describe).join('; ')} · ${dice.calls} in total`

        if (dice.absent === null) {
            diceLine.textContent = `Dice tool: ${dice.registered.join(', ')} registered · ${calls}`
            return
        }
        if (dice.absent === 'mode') {
            diceLine.textContent = 'Dice tool: off — RNG mode is not "Pre-seeded + tool calls".'
            return
        }
        if (dice.absent === 'flags') {
            diceLine.textContent = 'Dice tool: off — neither tool switch is ticked under RNG mode.'
            return
        }
        if (dice.absent === 'combat') {
            diceLine.textContent = `Dice tool: away during combat, the queue is rolling · ${calls}`
            return
        }
        diceLine.className = 'lh-dice-line lh-dice-line--warn'
        diceLine.textContent = 'Dice tool: could not be registered — the tools permission is the usual cause; the version line names a missing one.'
    }

    /** Draw the diagnostics line from what the backend reported. */
    function drawDiagnostics(result: StatusResult): void {
        drawDiagnosticsLine(result)
        developer.applyStatus(result)
        coreCard.applyStatus(result)
        versionTwin.textContent = diagnostics.textContent
        versionTwin.className = `lh-version-twin lh-search-item${diagnostics.classList.contains('lh-diagnostics--warn') ? ' lh-version-twin--warn' : ''}`
    }

    function drawDiagnosticsLine(result: StatusResult): void {
        drawDice(result.dice)
        diagnostics.replaceChildren()
        const name = result.version ? `AdventureTime ${result.version}` : 'AdventureTime'
        const hostVersion = result.host ? ` · Lumiverse ${result.host}` : ''

        if (!result.checked) {
            diagnostics.className = 'lh-diagnostics'
            diagnostics.textContent = `${name}${hostVersion} · permissions could not be checked`
            return
        }

        if (result.missing.length === 0) {
            diagnostics.className = 'lh-diagnostics'
            const count = result.granted.length
            diagnostics.textContent =
                `${name}${hostVersion} · all ${count} permission${count === 1 ? '' : 's'} granted`
            return
        }

        // Loud, and specific about what stops working. A missing permission
        // does not announce itself anywhere else the user can see.
        diagnostics.className = 'lh-diagnostics lh-diagnostics--warn'
        const headline = el('div', { class: 'lh-diagnostics-headline' })
        headline.textContent =
            `${name}${hostVersion} — ${result.missing.length} permission` +
            `${result.missing.length === 1 ? '' : 's'} not granted`
        diagnostics.append(headline)

        for (const permission of result.missing) {
            const line = el('div')
            line.textContent = `${permission.name} — ${permission.needs} will not work.`
            diagnostics.append(line)
        }

        const fix = el('div', { class: 'lh-diagnostics-fix' })
        fix.textContent =
            'Press Update in the Lumiverse extension panel so it re-reads the manifest, then reload the page. ' +
            'If the version above is already the latest, grant the permission there instead.'
        diagnostics.append(fix)
    }

    // ── settings ──────────────────────────────────────────────────────────

    /**
     * The human name of what a patch was trying to change.
     *
     * `Setting is not editable here: customFields` names a key; a user names
     * the thing they were typing into. The schema already carries the label
     * every control is drawn with, so use it.
     */
    function describePatch(patch: SettingsBag): string {
        const labels = Object.keys(patch).map((key) => {
            for (const section of SETTINGS_SCHEMA) {
                for (const field of section.fields) {
                    if (field.key === key) return field.label
                    if (field.keys?.includes(key)) return field.label
                }
            }
            return key
        })
        const unique = [...new Set(labels)]
        return unique.length ? unique.join(', ') : 'a setting'
    }

    /**
     * Every view of the settings, re-seeded from a fresh copy.
     *
     * One place for the three paths that replace the settings whole — a
     * commit, a reset and a cartridge load — so none of them can leave an
     * editor stale: the load re-seeded five of the nine and left the modules
     * editor, the rulebook switches, the CYOA editor, the wizard and the
     * world rules showing the cartridge that was there before (found in 37).
     *
     * The custom fields editor and the world rules are the exception on a
     * commit: they are the thing that sent it, and re-rendering under the
     * user's cursor would lose focus mid-edit. They re-seed on a load and a
     * reset, which come from a button. The rest draw checkboxes, lists and
     * badges with no cursor to lose, and have to re-seed on a commit too: a
     * quests toggle writes a second key the modules editor is the only view
     * of, a custom field made below takes its place in the order (37), and
     * the game systems' badges read the fields editor's data.
     */
    /** The shipped modules' tags, which a custom tag may not repeat (47e). */
    function stockAgentTags(settings: SettingsBag): string[] {
        const modules = (settings.routerModules ?? {}) as Record<string, AgentModule>
        return Object.entries(modules).map(([key, module]) => moduleTag(key, module))
    }

    function seedEditors(settings: SettingsBag, from: 'commit' | 'reset' | 'load'): void {
        latestSettings = settings
        bound?.setSettings(settings)
        // Block order, labels and icons all live in settings, so the cards
        // have to be redrawn when any of them moves.
        tracker?.setSettings(settings)
        if (from !== 'commit') {
            customFields?.setFields((settings.customFields as CustomField[]) ?? [])
            worldRules?.setData(
                (settings.customSyspromptLibrary as SyspromptSection[]) ?? [],
                (settings.syspromptSectionOrder as string[]) ?? [],
            )
        }
        gameSystems?.setData(
            (settings.gameSystems as GameSystem[]) ?? [],
            (settings.customFields as LinkedField[]) ?? [],
        )
        trackerModules?.setSettings(settings)
        displayGroupsCard.setSettings(settings as { customFields?: unknown })
        agentModules?.setSettings(settings as never)
        customTags?.setTags(settings.routerCustomTags, stockAgentTags(settings))
        rulebook?.setSettings(settings as never)
        narrator?.setSettings(settings)
        cyoa?.setSettings(settings as never)
        styles?.setSettings(settings)
        sectionsNpc?.setSettings(settings, from)
        sectionsPc?.setSettings(settings, from)
        wizard?.setSettings(wizardTarget(settings))
    }

    /**
     * The factory's texts for the edited badges and Reset to stock (36, 47e): one small op, not the whole
     * factory in the bundle. A failed fetch costs those two and nothing else. Since 77 the agent's NPC, LOC
     * and FAC texts in it are the live stock built from the cartridge's sections, so a sections save asks again.
     */
    function fetchFactory(): void {
        bridge.request<{ stockPrompts: Record<string, string>; routerModules?: Record<string, AgentModule> }>('settings.factory')
            .then((result) => {
                trackerModules?.setFactory(result.stockPrompts ?? {})
                factoryAgentModules = result.routerModules ?? {}
                agentModules?.setFactory(factoryAgentModules)
            })
            .catch(() => undefined)
    }

    const sectionsHost: SectionsEditorHost = {
        save: async (kind, sections) => {
            clearProblem()
            const result = await bridge.request<SettingsResult & { rebuilt: string[]; kept: string[] }>('settings.sections', { kind, sections })
            seedEditors(result.settings, 'commit')
            if (kind === 'npc') fetchFactory()
            return { rebuilt: result.rebuilt ?? [], kept: result.kept ?? [] }
        },
        savePresets: async (kind, presets) => {
            await commit({ [kind === 'npc' ? 'npcSectionPresets' : 'pcSectionPresets']: presets })
        },
        confirm: async (message) => (await host.ui.showConfirm({ title: 'The sections', message, variant: 'warning', confirmLabel: 'Yes' })).confirmed,
    }

    async function commit(patch: SettingsBag): Promise<void> {
        // Cleared here rather than on success: the user is retrying the thing
        // that failed, and leaving the old failure up while they do is what
        // makes a fixed problem look unfixed.
        clearProblem()
        const result = await bridge.request<SettingsResult>('settings.patch', { patch })
        seedEditors(result.settings, 'commit')
        say('Saved.')
    }

    async function resetSection(sectionId: string): Promise<void> {
        const group = CARTRIDGE_PAYLOAD_GROUPS.find((candidate) => candidate.id === sectionId)
        const { confirmed } = await host.ui.showConfirm({
            title: 'Reset to factory',
            message: `Restore "${group?.label ?? sectionId}" to its factory values? Your current settings for this section will be replaced.`,
            variant: 'warning',
            confirmLabel: 'Reset',
        })
        if (!confirmed) return

        const result = await bridge.request<SettingsResult>('settings.reset', { groupIds: [sectionId] })
        seedEditors(result.settings, 'reset')
        say(`Reset ${group?.label ?? sectionId} to factory values.`)
    }

    // ── cartridges ────────────────────────────────────────────────────────

    /**
     * Hand the user a file. The frontend module runs as an ordinary script on
     * the Lumiverse page (not in a widget sandbox), so an object URL and a
     * synthetic click is the whole of it.
     *
     * The timing is the fiddly part, and getting it wrong fails *silently*.
     * `click()` only starts the download; the browser reads the object URL
     * afterwards, on its own schedule. Revoking that URL in the same tick —
     * the obvious-looking way to write this — can pull the data out from
     * under the download before it is read, so nothing is saved and no error
     * is raised anywhere. It is worse when the browser is set to ask where to
     * save each file, because then the URL has to survive until the user
     * answers a dialog.
     *
     * So: the anchor is retired on the next tick, and the URL is held for a
     * minute before being released. Both are cheap; a download that silently
     * does nothing is not.
     */
    function download(filename: string, text: string): void {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))

        // A plain anchor, not `ctx.dom.createElement`: this element is a
        // throwaway that never belongs to the panel, and handing it to the
        // host's element tracker would only leave it something to clean up.
        const link = document.createElement('a')
        link.href = url
        link.download = filename
        link.rel = 'noopener'
        link.style.display = 'none'

        document.body.append(link)
        link.click()

        setTimeout(() => link.remove(), 0)
        setTimeout(() => URL.revokeObjectURL(url), URL_LIFETIME_MS)
    }

    async function exportCartridge(): Promise<void> {
        const result = await bridge.request<CartridgeExportResult>('cartridge.export', {
            name: 'Game Cartridge',
        })
        download(result.filename, result.file)
        say(`Exported ${result.filename} — check your browser's downloads.`)
    }

    async function importCartridge(): Promise<void> {
        const [file] = await host.uploads.pickFile({ accept: ['.json', 'application/json'] })
        if (!file) return

        // A cartridge load replaces the entire cartridge surface. That is what
        // it is for, and it is also not undoable, so it gets asked about.
        const { confirmed } = await host.ui.showConfirm({
            title: 'Load cartridge',
            message: `Load "${file.name}"? This replaces your tracker, agent, portrait and map settings. Export your current setup first if you want to keep it.`,
            variant: 'warning',
            confirmLabel: 'Load',
        })
        if (!confirmed) return

        const text = new TextDecoder().decode(file.bytes)
        const result = await bridge.request<SettingsResult & { name?: string }>('cartridge.import', { text })
        // A cartridge carries every key, so every editor follows it (43).
        seedEditors(result.settings, 'load')
        say(`Loaded ${result.name ?? file.name}.`)
    }

    importButton.addEventListener('click', () => { importCartridge().catch(fail) })
    exportButton.addEventListener('click', () => { exportCartridge().catch(fail) })

    // ── first paint ───────────────────────────────────────────────────────

    say('Loading settings…')
    bridge.request<SettingsResult>('settings.get')
        .then((result) => {
            latestSettings = result.settings
            bound = bindSettings(SETTINGS_SCHEMA, result.settings, settingsRoot, {
                createElement: el,
                // Each section into its category's fold (63).
                sectionHost: (section) => categories.bodies[section.category],
                sectionHeader: (section) => (section.id === 'portraits' ? portraitsSection.header : null),
                sectionFooter: (section) => (section.id === 'portraits' ? portraitsSection.footer : null),
                commit,
                onError: (message) => say(message, 'error'),
                onSaveFailed: (patch, message) => {
                    fail(message, `Could not save ${describePatch(patch)}`)
                },
                resetSection: (sectionId) => { resetSection(sectionId).catch(fail) },
                // The narrator's configuration drawn whole (70): Multihog's block under Game systems.
                sectionEditors: {
                    narrator: (mount, settings) => {
                        narrator = mountNarratorConfig(mount, { createElement: el }, settings, {
                            commit: (patch) => {
                                commit(patch).catch((error: unknown) => {
                                    fail(error, `Could not save ${describePatch(patch)}`)
                                })
                            },
                            savePref: (patch) => { bridge.request<PrefsResult>('prefs.patch', { patch }).catch(fail) },
                        })
                    },
                },
                editors: {
                    // The art styles (63b): the backend's preset ops write the
                    // cartridge and answer with the settings whole, which
                    // re-seeds every editor, the three prompt boxes first.
                    savedPortraitPromptPresets: (mount, _value, settings) => {
                        const through = async (op: 'portraits.presets.load' | 'portraits.presets.save' | 'portraits.presets.delete', params: Record<string, unknown>): Promise<void> => {
                            clearProblem()
                            const result = await bridge.request<SettingsResult>(op, params)
                            seedEditors(result.settings, 'commit')
                        }
                        styles = mountPortraitStyles(mount, { createElement: el }, settings, {
                            load: (id) => through('portraits.presets.load', { id }),
                            save: (name, overwrite) => through('portraits.presets.save', { name, overwrite }),
                            remove: (name) => through('portraits.presets.delete', { name }),
                            confirm: async (message) => (await host.ui.showConfirm({ title: 'Portrait prompt library', message, variant: 'warning', confirmLabel: 'Yes' })).confirmed,
                        })
                    },
                    // The NPC and PC sections (77): Multihog's two section editors on the Character Sheets card, one
                    // mount per kind; the presets ride in each. A save of the NPC sections rebuilds the agent's
                    // instructions and moves the factory's live stock, so the factory is fetched again after it.
                    npcCoreSections: (mount, _value, settings) => {
                        sectionsNpc = mountSectionsEditor(mount, { createElement: el }, settings, 'npc', sectionsHost)
                    },
                    pcCoreSections: (mount, _value, settings) => {
                        sectionsPc = mountSectionsEditor(mount, { createElement: el }, settings, 'pc', sectionsHost)
                    },
                    // Checkboxes only, so it is re-seeded on every commit
                    // (lesson 30): a library edit or a reset changes what it
                    // shows, and there is no cursor for a redraw to lose.
                    syspromptModules: (mount, _value, settings) => {
                        rulebook = mountRulebookSwitches(
                            mount,
                            { createElement: el },
                            settings as never,
                            (change) => {
                                commit(change as never).catch((error: unknown) => {
                                    fail(error, `Could not save ${describePatch(change as never)}`)
                                })
                            },
                        )
                    },
                    // The choice slots, presets and switches behind the
                    // <CYOA_mode> message (roadmap row 6).
                    cyoaConfig: (mount, _value, settings) => {
                        cyoa = mountCyoaEditor(
                            mount,
                            { createElement: el },
                            settings as never,
                            (change) => {
                                commit(change as never).catch((error: unknown) => {
                                    fail(error, `Could not save ${describePatch(change as never)}`)
                                })
                            },
                        )
                    },
                    customSyspromptLibrary: (mount, value, settings) => {
                        worldRules = mountSyspromptEditor(
                            mount,
                            { createElement: el },
                            Array.isArray(value) ? (value as SyspromptSection[]) : [],
                            (settings.syspromptSectionOrder as string[]) ?? [],
                            (change) => {
                                commit(change as never).catch((error: unknown) => {
                                    fail(error, `Could not save ${describePatch(change as never)}`)
                                })
                            },
                        )
                    },
                    modules: (mount, _value, settings) => {
                        const editor = mountTrackerModulesEditor(
                            mount,
                            { createElement: el },
                            settings,
                            // One key normally, two when the quests row moves --
                            // `setModuleEnabled` decides which, and a patch is
                            // all-or-nothing so they cannot half-apply.
                            (change) => {
                                commit(change as never).catch((error: unknown) => {
                                    fail(error, `Could not save ${describePatch(change as never)}`)
                                })
                            },
                        )
                        trackerModules = editor
                        editor.setDisplayGroups(displayGroupsForOrder.groups, displayGroupsForOrder.enabled)
                        fetchFactory()
                    },
                    // The agent's modules (47e): one key, written whole on
                    // every switch or save, as the tracker's modules are.
                    routerModules: (mount, _value, settings) => {
                        agentModules = mountAgentModulesEditor(
                            mount,
                            { createElement: el },
                            settings as never,
                            (change) => {
                                commit(change as never).catch((error: unknown) => {
                                    fail(error, `Could not save ${describePatch(change as never)}`)
                                })
                            },
                        )
                        if (factoryAgentModules) agentModules.setFactory(factoryAgentModules)
                        if (mount.parentElement) repertoireRows.push(mount.parentElement)
                    },
                    // The agent's custom tags (47e): the list, written whole.
                    routerCustomTags: (mount, value, settings) => {
                        customTags = mountCustomTagsEditor(
                            mount,
                            { createElement: el },
                            { tags: value, stockTags: stockAgentTags(settings) },
                            (change) => {
                                commit(change as never).catch((error: unknown) => {
                                    fail(error, `Could not save ${describePatch(change as never)}`)
                                })
                            },
                        )
                        if (mount.parentElement) repertoireRows.push(mount.parentElement)
                    },
                    // Read-only. Its switch used to live here and was the same
                    // switch as the custom field's one section down; see the
                    // module header.
                    gameSystems: (mount, value, settings) => {
                        gameSystems = mountGameSystemsEditor(
                            mount,
                            { createElement: el },
                            Array.isArray(value) ? (value as GameSystem[]) : [],
                            (settings.customFields as LinkedField[]) ?? [],
                            {
                                onEdit: (id) => { wizard?.edit(id) },
                                // Export and import of one system (72b, departure 41).
                                onExport: (id) => {
                                    const file = buildGameSystemFile((latestSettings ?? settings) as Record<string, unknown>, id)
                                    if (!file) { say('That system is no longer in the settings.', 'error'); return }
                                    const slug = String(file.adventuretimeGameSystem.system.name ?? 'system').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'system'
                                    download(`adventuretime-system-${slug}.json`, JSON.stringify(file, null, 2))
                                    say(`Exported the system “${file.adventuretimeGameSystem.system.name}” — check your browser's downloads.`)
                                },
                                onImport: () => {
                                    host.uploads.pickFile({ accept: ['.json', 'application/json'] })
                                        .then(([file]) => {
                                            if (!file) return
                                            const read = readGameSystemFile(new TextDecoder().decode(file.bytes))
                                            const { patch, name, tag } = importGameSystem((latestSettings ?? settings) as Record<string, unknown>, read)
                                            return commit(patch as SettingsBag).then(() => {
                                                say(`Imported the system “${name}”${tag ? ` with its field [${tag}]` : ''}. Its switch is under Custom fields; it is off until the tracker is told to maintain it.`)
                                            })
                                        })
                                        .catch((error: unknown) => { fail(error, 'The system could not be imported') })
                                },
                            },
                        )
                        // The wizard, under the list it adds to (roadmap row 7).
                        // Its save is one patch of the three keys, from the
                        // settings the panel last saw.
                        const wizardRoot = el('div')
                        mount.append(wizardRoot)
                        wizard = mountGameSystemWizard(wizardRoot, { createElement: el }, {
                            bridge,
                            chatId: () => host.getActiveChat().chatId,
                            settings: () => wizardTarget(latestSettings ?? settings),
                            onSave: (patch, seed) => {
                                commit(patch as never)
                                    .then(() => {
                                        // The block only after the save landed: a pass
                                        // reads the settings as stored, and the new
                                        // module must be in them to be created. A
                                        // failed pass is not a failed save, and says so.
                                        if (!seed || !tracker) return undefined
                                        return tracker.instruct(seed).catch((error: unknown) => {
                                            fail(error, 'The system is saved, but the tracker pass to add its block failed')
                                        })
                                    })
                                    .catch((error: unknown) => {
                                        fail(error, `Could not save ${describePatch(patch as never)}`)
                                    })
                            },
                        })
                    },
                    customFields: (mount, value) => {
                        customFields = mountCustomFieldsEditor(
                            mount,
                            {
                                createElement: el,
                                // Export, Import and Clear all (72b).
                                download: (filename, text) => { download(filename, text) },
                                pickJson: async () => {
                                    const [file] = await host.uploads.pickFile({ accept: ['.json', 'application/json'] })
                                    return file ? new TextDecoder().decode(file.bytes) : null
                                },
                                confirm: async (message) => (await host.ui.showConfirm({ title: 'Clear all custom fields', message, variant: 'danger', confirmLabel: 'Clear all' })).confirmed,
                            },
                            Array.isArray(value) ? (value as CustomField[]) : [],
                            (fields) => {
                                // Both halves, always. A field is the tracker
                                // half of a game system, and writing one flag
                                // without the other is what made the panel able
                                // to invent drift in a single tick.
                                const patch: SettingsBag = { customFields: fields }
                                const systems = syncSystemsToFields(
                                    (latestSettings?.gameSystems as GameSystem[]) ?? [],
                                    fields as LinkedField[],
                                )
                                if (systems.some((system, index) => system !== ((latestSettings?.gameSystems as GameSystem[]) ?? [])[index])) {
                                    patch.gameSystems = systems
                                }
                                commit(patch).catch((error: unknown) => {
                                    fail(error, `Could not save ${describePatch(patch)}`)
                                })
                            },
                        )
                    },
                },
            })
            for (const [i, group] of PREF_DIAL_GROUPS.entries()) categories.bodies[group.category].append(dialBoxes[i]!.root)
            // The second pass's cards (72b): the NPC word targets under the agent, the rendering tags library under
            // the tracker, each after the category's dials; the narrator card's rows are in Core & Branching (81).
            categories.bodies.agent.append(npcWords.root)
            categories.bodies.tracker.append(createMarkersCard(plainEl), displayGroupsCard.root)
            // The manager reads the cartridge's custom fields for its checklist, and the seed that feeds every
            // editor runs on a commit, not here (75-bis): hand it the first read, or a custom module is not
            // offered until something else writes the cartridge.
            displayGroupsCard.setSettings(result.settings as { customFields?: unknown })
            // Under the caption Developer & reset, after everything else of the category (72a).
            const developerCaption = plainEl('div', { class: 'lh-developer-caption' })
            developerCaption.textContent = 'Developer & reset'
            categories.bodies.general.append(developerCaption, developer.root)
            // The Modular Repertoire's rows leave the settings for the Lorebook Agent tab (78a), now the binder has placed them.
            repertoire.append(...repertoireRows)
            // The World skeleton goes into the World progression category (78b, the maintainer's answer), whatever the layout.
            tracker = mountTrackerPanel(trackerRoot, bridge, host, result.settings, trackerRest
                ? { rest: trackerRest, scene: slots.scene, head: slots.trackerHead, foot: slots.trackerFoot, sceneHead: slots.sceneHead, sceneFoot: slots.sceneFoot, repertoire, world: categories.bodies.world }
                : { repertoire, world: categories.bodies.world })
            say('Ready.')
        })
        .catch(fail)

    // Asked separately, not chained onto the settings load: a diagnostic that
    // only appears when everything else worked is no use on the day something
    // did not.
    bridge.request<StatusResult>('status.get')
        .then(drawDiagnostics)
        .catch(() => {
            // An older backend does not know this op. Say so plainly rather
            // than swallowing it — a frontend newer than its backend is itself
            // a sign the install is half-updated.
            diagnostics.className = 'lh-diagnostics'
            diagnostics.textContent = 'Could not read the extension status. This build may be out of date.'
        })

    // The dice line moves on its own: a call answered, a mode change, or a
    // tracker pass that started or ended combat. Re-read the status rather
    // than trusting the event's payload, so the line and the backend agree.
    const unsubscribeDice = bridge.on((event) => {
        if (event.name !== 'dice.rolled' && event.name !== 'settings.changed' && event.name !== 'tracker.changed') return
        bridge.request<StatusResult>('status.get').then(drawDiagnostics).catch(() => undefined)
    })

    // A settings change made elsewhere (70) — the narrator's block in the
    // tracker's starting area, a cartridge loaded — re-seeds every editor
    // here, as a commit of the panel's own does. The backend announces every
    // settings write; the panel's own writes come back the same way, which
    // is a second seed of the same values and nothing else.
    const unsubscribeSettings = bridge.on((event) => {
        if (event.name !== 'settings.changed') return
        const data = event.data as SettingsResult | undefined
        if (data?.settings) seedEditors(data.settings, 'commit')
    })

    // The layout select's value, after the settings and the status: the
    // tests read the first request as the settings', and so does anyone
    // reading the backend log.
    bridge.request<PrefsResult>('prefs.get', {})
        .then((result) => {
            showPanelLayout(result.prefs?.panelLayoutMode)
            customTheme = readCustomTheme(result.prefs?.customTheme)
            savedThemes = readSavedThemes(result.prefs?.savedThemes)
            drawLibrary()
            showTheme(result.prefs?.trackerTheme)
            showDayNight(result.prefs?.dayNightCycle)
            showXpBar(result.prefs?.xpBarAtBottom)
            showAnimateBars(result.prefs?.animateAllCustomBarChanges)
            showBackdrop('tracker', result.prefs?.trackerBackdrop)
            showBackdrop('settings', result.prefs?.settingsBackdrop)
            showFontSize('tracker', result.prefs?.trackerFontSize)
            showFontSize('settings', result.prefs?.settingsFontSize)
            cardsToggle.checked = result.prefs?.messageCards === true
            connections.applyPrefs((result.prefs ?? {}) as Record<string, unknown>)
            mirrorPortraits.applyPrefs((result.prefs ?? {}) as Record<string, unknown>)
            mirrorScene.applyPrefs((result.prefs ?? {}) as Record<string, unknown>)
            portraitsSection.applyPrefs((result.prefs ?? {}) as Record<string, unknown>)
            for (const box of dialBoxes) box.applyPrefs((result.prefs ?? {}) as Record<string, unknown>)
            narrator?.applyPrefs((result.prefs ?? {}) as Record<string, unknown>)
            developer.applyPrefs((result.prefs ?? {}) as Record<string, unknown>)
            coreCard.applyPrefs((result.prefs ?? {}) as Record<string, unknown>)
            applyDisplayGroupPrefs((result.prefs ?? {}) as Record<string, unknown>)
            npcWords.applyPrefs((result.prefs ?? {}) as Record<string, unknown>)
            mapThemeCard.applyPrefs((result.prefs ?? {}) as Record<string, unknown>)
        })
        .catch(() => { /* the default stands */ })
    // A connection saved in a fold shows in the category (63); the event every save sends carries the whole set.
    const unsubscribePrefs = bridge.on((event) => {
        if (event.name !== 'prefs.changed') return
        const data = event.data as PrefsResult | undefined
        const prefs = data?.prefs
        if (prefs) {
            if (prefs.messageCards !== undefined) cardsToggle.checked = prefs.messageCards === true
            if (prefs.customTheme !== undefined) customTheme = readCustomTheme(prefs.customTheme)
            if (prefs.savedThemes !== undefined) { savedThemes = readSavedThemes(prefs.savedThemes); drawLibrary() }
            if (prefs.trackerTheme !== undefined) showTheme(prefs.trackerTheme)
            else if (prefs.customTheme !== undefined) showTheme(themeSelect.value)
            if (prefs.dayNightCycle !== undefined) showDayNight(prefs.dayNightCycle)
            if (prefs.xpBarAtBottom !== undefined) showXpBar(prefs.xpBarAtBottom)
            if (prefs.panelLayoutMode !== undefined) showPanelLayout(prefs.panelLayoutMode)
            if (prefs.animateAllCustomBarChanges !== undefined) showAnimateBars(prefs.animateAllCustomBarChanges)
            if (prefs.trackerBackdrop !== undefined) showBackdrop('tracker', prefs.trackerBackdrop)
            if (prefs.settingsBackdrop !== undefined) showBackdrop('settings', prefs.settingsBackdrop)
            if (prefs.trackerFontSize !== undefined) showFontSize('tracker', prefs.trackerFontSize)
            if (prefs.settingsFontSize !== undefined) showFontSize('settings', prefs.settingsFontSize)
            mapThemeCard.applyPrefs(prefs as Record<string, unknown>)
            connections.applyPrefs(prefs as Record<string, unknown>)
            mirrorPortraits.applyPrefs(prefs as Record<string, unknown>)
            portraitsSection.applyPrefs(prefs as Record<string, unknown>)
            narrator?.applyPrefs(prefs as Record<string, unknown>)
            developer.applyPrefs(prefs as Record<string, unknown>)
            coreCard.applyPrefs(prefs as Record<string, unknown>)
            applyDisplayGroupPrefs(prefs as Record<string, unknown>)
            npcWords.applyPrefs(prefs as Record<string, unknown>)
            mirrorScene.applyPrefs(prefs as Record<string, unknown>)
            for (const box of dialBoxes) box.applyPrefs(prefs as Record<string, unknown>)
            wizard?.applyPrefs(prefs)
        }
        // A preference that moved a setting (63b): the present-NPCs toggle swapped the location prompt.
        if (data?.settings) seedEditors(data.settings, 'commit')
    })

    return {
        refreshTracker(): void {
            tracker?.refresh().catch(fail)
        },
        destroy(): void {
            unsubscribeDice()
            unsubscribePrefs()
            unsubscribeSettings()
            customFields?.destroy()
            customFields = null
            gameSystems?.destroy()
            gameSystems = null
            trackerModules?.destroy()
            trackerModules = null
            worldRules?.destroy()
            worldRules = null
            rulebook?.destroy()
            rulebook = null
            tracker?.destroy()
            tracker = null
            bound?.destroy()
            bound = null
            root.replaceChildren()
            slots.rest?.replaceChildren()
            slots.scene?.replaceChildren()
            slots.sceneHead?.replaceChildren()
            slots.sceneFoot?.replaceChildren()
            slots.trackerHead?.replaceChildren()
            slots.trackerFoot?.replaceChildren()
        },
    }
}

/**
 * Panel styling. Colours come from host theme variables, not from here.
 *
 * The `rt-*` rules are a deliberate first pass, not the port of the legacy
 * `style.css` — that file is ~11,000 lines and much of it is reproducible from
 * host theme variables, which is an open question in the plan (§9.4). What is
 * here is enough to make every marker legible: bars have a track and a fill,
 * pills and badges have a shape, counted markers line up. The class names are
 * the legacy ones, so a fuller port drops on top without a rename pass.
 */
/**
 * AdventureTime's own rules around the legacy's Tab Mode ones (76): the strip sticks
 * against the box's own padding, the foot clock beside the XP bar, the
 * segmented toggle in the Layout box.
 */
const TAB_MODE_PANEL_CSS = `
.adventuretime-panel .lh-tracker-cards--tabs { display: block; }
.adventuretime-panel .rt-tab-strip { top: -8px; margin: 0 -10px; padding-left: 10px; padding-right: 10px; }
.adventuretime-panel .rt-tabmode-wrap { padding-bottom: 120px; }
.adventuretime-panel .rt-tab-btn .rt-tab-badge { color: var(--lh-accent-contrast, #06251c); }
.adventuretime-panel .rt-tabmode-pinned:empty { display: none; }
.adventuretime-panel .rt-entity-card--landed { outline: 2px solid var(--lh-accent, var(--lumiverse-primary, #d4a940)); outline-offset: 2px; border-radius: 6px; transition: outline-color 0.6s ease 1.2s; }
.adventuretime-panel .lh-foot-clock { flex: 0 0 auto; padding: 3px 10px 0; font-size: 0.78em; color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); white-space: nowrap; opacity: 0.9; cursor: help; }
.lh-tracker > .lh-foot-clock { position: sticky; bottom: 0; z-index: 2; background: rgba(0, 0, 0, 0.28); }
.adventuretime-panel .lh-seg-toggle { display: flex; gap: 0; flex: 1 1 auto; }
.adventuretime-panel .lh-seg-button { flex: 1 1 0; border-radius: 0; opacity: 0.75; }
.adventuretime-panel .lh-seg-button:first-child { border-radius: 6px 0 0 6px; }
.adventuretime-panel .lh-seg-button:last-child { border-radius: 0 6px 6px 0; }
.adventuretime-panel .lh-seg-button.active { opacity: 1; background: var(--lh-accent, var(--lumiverse-primary, #d4a940)); color: var(--lh-accent-contrast, var(--lumiverse-primary-contrast, #1a1a1a)); }
`

export const PANEL_CSS = `
/* The theme layer (74a): a root with no theme class on the body is the look before it, byte for byte --
   every token is unset and every use falls to the host's variable, as 68 left it. A theme class on
   the body sets the tokens (themes.ts), and the root takes its background, blur, text and font. */
.adventuretime-panel { display: flex; flex-direction: column; gap: 10px; padding: 10px; background: var(--lh-bg, transparent); backdrop-filter: var(--lh-blur, none); color: var(--lh-text, inherit); font-family: var(--lh-font, inherit); }
.adventuretime-panel .lh-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.adventuretime-panel .lh-button,
.adventuretime-panel .lh-reset {
    padding: 5px 10px;
    background: var(--lh-accent-bg, var(--lumiverse-fill, rgba(127,127,127,0.12)));
    border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.35)));
    border-radius: var(--lumiverse-radius, 6px);
    color: var(--lh-text, var(--lumiverse-text, inherit));
    cursor: pointer;
    font: inherit;
}
.adventuretime-panel .lh-reset { font-size: 0.78em; padding: 2px 8px; margin-left: auto; }
.adventuretime-panel .lh-status { font-size: 0.82em; opacity: 0.75; min-height: 1.2em; }
.adventuretime-panel .lh-status-error { opacity: 1; color: var(--lumiverse-danger, #d9534f); }
/* Something the user did that did not work.
   Its own line because the status line is ambient and short-lived - in the
   tracker panel every pass clears that line twice, so a failure written there
   routinely survived less than one reply. This one is only ever written by a
   failure and only ever cleared by the user or by changing chat. */
.lh-problem {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 6px 0;
    padding: 6px 8px;
    font-size: 0.82em;
    border-radius: var(--lumiverse-radius, 6px);
    border: 1px solid var(--lumiverse-danger, #d9534f);
    color: var(--lumiverse-danger, #d9534f);
}
/* display:flex beats the browser's own [hidden] rule, so a hidden one stayed
   on screen showing an empty red box. Every fold in this panel needs this and
   two have shipped without it. */
.lh-problem[hidden] { display: none; }
.lh-problem-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.lh-problem-dismiss {
    flex: 0 0 auto;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
    opacity: 0.7;
    cursor: pointer;
    text-decoration: underline;
}

/* What is running, and what it is allowed to do. Quiet until it is not. */
.adventuretime-panel .lh-diagnostics { font-size: 0.75em; opacity: 0.55; }
.adventuretime-panel .lh-dice-line { font-size: 0.75em; opacity: 0.55; margin-top: 2px; }
.adventuretime-panel .lh-dice-line:empty { display: none; }
.adventuretime-panel .lh-dice-line--warn {
    opacity: 1;
    color: var(--lumiverse-warning, #d0a24c);
}
.adventuretime-panel .lh-diagnostics--warn {
    opacity: 1;
    font-size: 0.8em;
    padding: 6px 8px;
    border: 1px solid rgba(217,83,79,0.5);
    border-radius: var(--lumiverse-radius, 6px);
    background: rgba(217,83,79,0.08);
    display: flex;
    flex-direction: column;
    gap: 3px;
}
.adventuretime-panel .lh-diagnostics-headline { font-weight: 600; }
.adventuretime-panel .lh-diagnostics-fix { opacity: 0.8; }
/* A section is a card since 63d (the cards' CSS); its rows keep their own gutter. */
.adventuretime-panel .lh-section > .lh-row { margin-left: 10px; margin-right: 10px; }
.adventuretime-panel .lh-section-help { font-size: 0.8em; opacity: 0.7; margin: 4px 0 8px; color: var(--lh-text-muted, inherit); }
/* The version line's twin at the head of General & visuals (63). */
.adventuretime-panel .lh-portraits-drawing { margin-top: 8px; }
.lh-version-twin { font-size: 0.8em; opacity: 0.75; }
.adventuretime-panel .lh-version-twin--warn { opacity: 1; color: var(--lumiverse-danger, #ff6b6b); }
.adventuretime-panel .lh-row { display: flex; align-items: center; gap: 10px; padding: 5px 0; }
.adventuretime-panel .lh-row-stacked { flex-direction: column; align-items: stretch; }
.adventuretime-panel .lh-row[hidden] { display: none; }
.adventuretime-panel .lh-label { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.adventuretime-panel .lh-help { font-size: 0.75em; opacity: 0.65; }
.adventuretime-panel .lh-check { display: flex; align-items: flex-start; gap: 8px; width: 100%; }
.adventuretime-panel .lh-managed { font-size: 0.75em; opacity: 0.55; font-style: italic; }
.adventuretime-panel textarea,
.adventuretime-panel input[type="text"],
.adventuretime-panel input[type="number"],
.adventuretime-panel select {
    background: var(--lh-accent-bg, var(--lumiverse-fill, rgba(127,127,127,0.08)));
    border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.3)));
    border-radius: var(--lumiverse-radius, 6px);
    color: var(--lh-text, var(--lumiverse-text, inherit));
    font: inherit;
    padding: 5px 8px;
}
.adventuretime-panel textarea { width: 100%; font-family: ui-monospace, monospace; font-size: 0.8em; resize: vertical; }

/* ── tracker cards under the messages ────────────────────────────────── */

/* Injected into the message bubble itself, so it lives in the host's page
   rather than in the drawer. Kept visually quiet: it annotates the story, and
   the story is what the reader is there for. */
.lh-msg-card { margin-top: 6px; font-size: 0.85em; }
.lh-msg-card-inner {
    color: var(--lh-text, inherit);
    font-family: var(--lh-font, inherit);
    border: var(--lh-card-border, 1px solid var(--lumiverse-border, rgba(127,127,127,0.25)));
    border-radius: var(--lumiverse-radius, 6px);
    background: var(--lh-card-bg, var(--lumiverse-fill, rgba(127,127,127,0.06)));
    overflow: hidden;
}
.lh-msg-card-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    cursor: pointer;
    opacity: 0.75;
    user-select: none;
}
.lh-msg-card-header:hover { opacity: 1; }
.lh-msg-card-caret { display: inline-block; transition: transform 0.15s ease; font-size: 0.9em; }
.lh-msg-card--open .lh-msg-card-caret { transform: rotate(90deg); }
.lh-msg-card-summary { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lh-msg-card-body { padding: 0 8px 8px; display: flex; flex-direction: column; gap: 8px; }
/* The display:flex above beats the browser's own rule for [hidden], so a folded
   card would draw in full with a caret claiming it was shut. The panel's
   sections learned this once already; the same trap, one file down. */
.lh-msg-card-body[hidden] { display: none; }
.lh-msg-card-empty { padding: 0 8px 8px; opacity: 0.6; }

/* ── the tracker ─────────────────────────────────────────────────────── */

.lh-tracker { display: flex; flex-direction: column; gap: 8px; }
/* The head (47a): the five lights (the picture's since 49-bis), the last-run time and the two buttons on
   one wrapping line. Multihog's colours; red is ours. */
.lh-tracker-head { flex-wrap: wrap; row-gap: 4px; }
.lh-lights { display: inline-flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.lh-light { display: inline-flex; align-items: center; gap: 4px; font-size: 0.8em; opacity: 0.85; cursor: default; }
.lh-light-dot { width: 8px; height: 8px; border-radius: 50%; background: #555; flex-shrink: 0; }
.lh-light--running .lh-light-dot { background: #ffaa00; animation: lh-light-pulse 1s infinite alternate; }
.lh-light--done .lh-light-dot { background: #00ffaa; box-shadow: 0 0 5px #00ffaa; }
.lh-light--failed .lh-light-dot { background: var(--lumiverse-danger, #d9534f); box-shadow: 0 0 5px var(--lumiverse-danger, #d9534f); }
.lh-light--running, .lh-light--failed { opacity: 1; }
@keyframes lh-light-pulse { from { opacity: 0.5; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .lh-light--running .lh-light-dot { animation: none; } }
.lh-tracker-head-time { font-size: 0.8em; opacity: 0.7; flex: 1; white-space: nowrap; }
.lh-tracker-fold > summary { cursor: pointer; font-size: 0.85em; opacity: 0.8; }
.lh-tracker-fold[open] > summary { margin-bottom: 8px; }
.lh-tracker-fold > :not(summary) { margin-bottom: 8px; }
.adventuretime-panel .lh-cartridges { margin-bottom: 10px; }
.adventuretime-panel .lh-layout { margin-bottom: 12px; }
.adventuretime-panel .lh-layout-row { display: flex; align-items: center; gap: 8px; font-size: 0.9em; flex-wrap: wrap; }
.adventuretime-panel .lh-layout-row .lh-select { max-width: 100%; }
.adventuretime-panel .lh-widget-buttons { margin-top: 6px; }
.adventuretime-panel .lh-widget-buttons[hidden] { display: none; }
/* The floating widgets (47c): a header with the title, a – that folds the
   box to its head (57) and a × that hides it; a strip under the header
   that never scrolls (57), for the tracker's lights; and a body that
   scrolls. The host draws the frame. */
.lh-widget { display: flex; flex-direction: column; height: 100%; min-height: 0; position: relative; }
.lh-widget-strip { flex-shrink: 0; padding: 6px 10px; background: var(--lh-header-bg, transparent); border-bottom: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25))); }
.lh-widget-strip:empty { display: none; }
.lh-widget-strip .lh-tracker-head { margin: 0; }
.lh-widget-minimize { background: none; border: 0; color: inherit; cursor: pointer; font-size: 1.1em; line-height: 1; padding: 0 4px; opacity: 0.7; }
.lh-widget-minimize:hover { opacity: 1; }
.lh-widget--minimized .lh-widget-body, .lh-widget--minimized .lh-widget-grip { display: none; }
.lh-widget--minimized .lh-widget-strip { border-bottom: 0; }
/* A folded frame the host keeps taller than the head centres it (57-bis). */
.lh-widget--minimized { justify-content: center; }
.lh-widget--minimized .lh-widget-head { border-bottom: 0; }
.lh-widget-grip { position: absolute; right: 0; bottom: 0; width: 18px; height: 18px; cursor: nwse-resize; touch-action: none; opacity: 0.55; background: linear-gradient(135deg, transparent 0 50%, currentColor 50% 56%, transparent 56% 70%, currentColor 70% 76%, transparent 76% 90%, currentColor 90% 96%, transparent 96%); }
.lh-widget-grip:hover { opacity: 1; }
.lh-widget-head { display: flex; align-items: center; gap: 8px; padding: 6px 10px; font-weight: 600; font-size: 0.9em; flex-shrink: 0; background: var(--lh-header-bg, transparent); border-bottom: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25))); cursor: default; }
.lh-widget-head-title { flex: 1; }
.lh-widget-hide { background: none; border: 0; color: inherit; cursor: pointer; font-size: 1.1em; line-height: 1; padding: 0 4px; opacity: 0.7; }
.lh-widget-hide:hover { opacity: 1; }
.lh-widget-body { flex: 1; min-height: 0; overflow: auto; padding: 8px 10px; }
.lh-widget-tabs { display: flex; gap: 4px; margin-bottom: 8px; }
.lh-widget-tab { background: none; border: 0; border-bottom: 2px solid transparent; color: inherit; cursor: pointer; padding: 4px 8px; font-size: 0.9em; opacity: 0.7; }
.lh-widget-tab--active { opacity: 1; border-bottom-color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
.lh-widget-pane[hidden] { display: none; }
.lh-widget-pane > summary { display: none; }
/* The second widget after Multihog's Lorebook Agent tab (78a). */
.lh-widget-strip .lh-widget-tabs { margin-bottom: 0; }
.lh-agent-drawer > summary { cursor: pointer; font-weight: 600; font-size: 0.9em; display: flex; align-items: center; gap: 6px; padding: 4px 0; border-bottom: 1px solid var(--lh-border, var(--lumiverse-border, rgba(128,128,128,0.25))); }
.lh-agent-drawer > summary .lh-agent-drawer-title { flex: 1; }
.lh-agent-badge { font-size: 0.75em; padding: 1px 7px; border-radius: 10px; font-weight: 700; border: 1px solid var(--lh-border, rgba(128,128,128,0.3)); opacity: 0.6; }
.lh-agent-badge--on { color: var(--lumiverse-success, #34a853); border-color: var(--lumiverse-success, #34a853); opacity: 1; }
.lh-agent-drawer-body { display: flex; flex-direction: column; gap: 6px; margin: 6px 0 10px; }
.lh-agent-drawer .lh-dials { gap: 4px; }
.lh-agent-drawer .lh-dial-card { border: 0; padding: 0; }
.lh-agent-drawer .lh-dial-card > summary { display: none; }
.lh-agent-drawer .lh-dial-card > .lh-section-help { display: none; }
.lh-agent-more > summary { cursor: pointer; font-size: 0.82em; opacity: 0.75; }
.lh-agent-footer { display: flex; align-items: center; gap: 8px; font-size: 0.8em; flex-wrap: wrap; justify-content: space-between; }
.lh-agent-footer .lh-agent-tools-footer { margin: 0; }
.lh-agent-footer-run { opacity: 0.7; white-space: nowrap; }
/* The tracker's footer (78b, Multihog's main footer): the stepper, the clock, the party's place. */
.lh-tracker-footer { display: flex; align-items: center; gap: 10px; font-size: 0.8em; flex-wrap: wrap; padding: 3px 8px; }
.lh-tracker > .lh-tracker-footer { position: sticky; bottom: 0; z-index: 2; background: rgba(0, 0, 0, 0.28); }
.lh-tracker-footer .lh-tracker-history { flex: 0 0 auto; gap: 4px; }
.lh-tracker-footer .lh-foot-clock { padding: 0; }
.lh-tracker-footer-place { flex: 1; min-width: 6em; text-align: center; color: var(--lumiverse-success, #34a853); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lh-tracker-footer-place[hidden] { display: none; }
/* The foot after Multihog's (78d): the utility group on the right, the 💬 last; the Change Log and the instruction bar over the footer. */
.adventuretime-panel .lh-tracker-footer-utility { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto; }
.adventuretime-panel .lh-tracker-footer-tokens { opacity: 0.7; white-space: nowrap; cursor: help; }
.adventuretime-panel .lh-footer-btn { background: none; border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.35))); color: var(--lh-text-muted, var(--lumiverse-text-muted, inherit)); cursor: pointer; font-size: 0.85em; padding: 1px 5px; border-radius: 4px; line-height: 1.4; opacity: 0.8; font-family: inherit; }
.adventuretime-panel .lh-footer-btn:hover, .adventuretime-panel .lh-footer-btn--active { color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); border-color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); opacity: 1; }
.adventuretime-panel .lh-footer-icon-btn { background: none; border: none; color: var(--lh-text-muted, var(--lumiverse-text-muted, inherit)); cursor: pointer; font-size: 1em; padding: 2px 5px; border-radius: 4px; line-height: 1; flex: 0 0 auto; }
.adventuretime-panel .lh-footer-icon-btn:hover, .adventuretime-panel .lh-footer-icon-btn--active { color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); background: var(--lh-accent-bg, rgba(212, 169, 64, 0.12)); }
.adventuretime-panel .lh-footer-icon-btn--active { box-shadow: inset 0 0 0 1px var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.35))); }
.adventuretime-panel .lh-change-log { display: flex; flex-direction: column; height: 120px; flex-shrink: 0; overflow: hidden; background: rgba(0, 0, 0, 0.4); border-top: 1px solid rgba(255, 255, 255, 0.06); font-size: 0.85em; line-height: 1.5; }
.adventuretime-panel .lh-change-log[hidden] { display: none; }
.adventuretime-panel .lh-change-log-bar { display: flex; justify-content: space-between; align-items: center; padding: 3px 8px; background: var(--lh-card-bg, rgba(0, 0, 0, 0.2)); border-bottom: 1px solid rgba(255, 255, 255, 0.05); flex-shrink: 0; }
.adventuretime-panel .lh-change-log-title { font-size: 0.75em; color: var(--lh-text-muted, var(--lumiverse-text-muted, inherit)); text-transform: uppercase; letter-spacing: 0.5px; }
.adventuretime-panel .lh-change-log-content { overflow-y: auto; padding: 6px 10px; flex: 1; }
.adventuretime-panel .lh-delta-added { color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
.adventuretime-panel .lh-delta-removed { color: #ff5555; text-decoration: line-through; opacity: 0.8; }
.adventuretime-panel .lh-delta-empty { color: var(--lh-text-muted, var(--lumiverse-text-muted, inherit)); font-style: italic; }
.adventuretime-panel .lh-direct--compact { flex-direction: row; align-items: center; gap: 8px; padding: 6px 8px; border-top: 1px solid rgba(255, 255, 255, 0.07); background: rgba(0, 0, 0, 0.25); }
.adventuretime-panel .lh-direct--compact .lh-direct-input { flex: 1; min-height: 44px; max-height: 120px; }
.adventuretime-panel .lh-direct--compact .lh-direct-actions { flex-wrap: nowrap; gap: 8px; flex: 0 0 auto; }
.adventuretime-panel .lh-direct[hidden] { display: none; }
.lh-tracker-nav-button { padding: 0 8px; font-family: var(--lh-font-mono, var(--lumiverse-font-mono, monospace)); }
.lh-tracker-nav-button[hidden] { display: none; }
.lh-tracker-footer .lh-tracker-history-label { font-family: var(--lh-font-mono, var(--lumiverse-font-mono, monospace)); letter-spacing: 1px; cursor: help; }
/* Active Lore Keys (78b): the host's active entries as pills. */
.lh-lore-pills { display: flex; flex-wrap: wrap; gap: 4px; min-height: 24px; }
.lh-lore-pill { display: inline-block; font-size: 0.78em; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.4))); background: rgba(127,127,127,0.08); white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; cursor: help; }
.lh-lore-pill--vector { border-color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
.lh-lore-pill--always { opacity: 0.55; }
.lh-lore-pill--none { opacity: 0.5; font-style: italic; border-style: dashed; cursor: default; }
.lh-lore-note { font-size: 0.8em; opacity: 0.8; }
.lh-lore-note--error { color: var(--lumiverse-danger, #ff6b6b); opacity: 1; }
/* What the maps are doing (78b): at the head of Map Details. */
.lh-maps-status-block { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
.lh-maps-status-block[hidden] { display: none; }
.lh-maps-status-block .lh-button { align-self: flex-start; }
.lh-site-map-head { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 0.78em; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.8; }
.lh-site-map-head .lh-site-map-title { flex: 1; }
.lh-site-map-direct[hidden] { display: none; }
.lh-details-modal { display: flex; flex-direction: column; gap: 8px; }
.lh-details-modal .lh-map-entries, .lh-details-modal .lh-map-history, .lh-details-modal .lh-map-raw { margin: 0; }
.lh-campaign-records .lh-records > summary, .lh-maps .lh-scene > summary { display: none; }
.lh-map-details[hidden] { display: none; }
.lh-tracker-header { display: flex; align-items: center; gap: 8px; }
.lh-tracker-title { font-weight: 600; flex: 1; }
.lh-tracker-header .lh-button { white-space: nowrap; }
/* Its own line: in the header it squeezed the buttons into three-line blocks. */
.lh-tracker-status { font-size: 0.8em; opacity: 0.7; }
.lh-tracker-status:empty { display: none; }
.lh-tracker-status-error { opacity: 1; color: var(--lumiverse-danger, #d9534f); }
/* Work happening right now. The report box below is always history, so the
   live state gets a different shape as well as different words. */
.lh-tracker-status-busy { opacity: 1; }
.lh-tracker-status-busy::before {
    content: '';
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-right: 5px;
    border-radius: 50%;
    vertical-align: middle;
    background: var(--lh-accent, var(--lumiverse-primary, #d4a940));
    animation: lh-tracker-pulse 1.4s ease-in-out infinite;
}
@keyframes lh-tracker-pulse { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
    .lh-tracker-status-busy::before { animation: none; opacity: 0.85; }
}
.lh-tracker-cards { display: flex; flex-direction: column; gap: 8px; }
/* The raw memo's summary is the starting area's drawer since 84 (START_AREA_CSS); its box fills the drawer's body. */
.lh-tracker-raw-body textarea { width: 100%; box-sizing: border-box; font: inherit; font-size: 0.85em; }
.lh-tracker-raw-actions { display: flex; gap: 8px; margin-top: 6px; flex-wrap: wrap; }
/* Talk to the model directly (Multihog's 💬): one send bar per pass. */
.lh-direct { display: flex; flex-direction: column; gap: 4px; }
.lh-direct-input {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    min-height: 3.3em;
    font: inherit;
    font-size: 0.9em;
}
.lh-direct-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 0.8em; opacity: 0.85; }
.lh-direct-lookback { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.lh-direct-lookback .lh-input { width: 4em; }
.lh-direct-hint { font-size: 0.75em; opacity: 0.65; overflow-wrap: anywhere; }

/* CYOA: the narrator's choices as buttons under the reply (roadmap row 6). */
.lh-choices, .lh-choices-list { display: flex; flex-direction: column; gap: 6px; }
.lh-choices { margin-top: 8px; }
.lh-choice {
    text-align: left;
    font: inherit;
    font-size: 0.92em;
    line-height: 1.35;
    padding: 7px 10px;
    border-radius: var(--lumiverse-radius, 6px);
    border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(128, 128, 128, 0.4)));
    background: var(--lh-accent-bg, var(--lumiverse-bg-elevated, rgba(128, 128, 128, 0.12)));
    color: inherit;
    cursor: pointer;
}
.lh-choice:hover { border-color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
.lh-choice:disabled { opacity: 0.55; cursor: progress; }
/* A box switched off by another control -- the wizard's count under *or all of them* (73g) -- greys
   visibly; the host's own disabled look only took the stepper's arrows away (73g-bis). */
.adventuretime-panel input:disabled:not([type="checkbox"]):not([type="radio"]),
.adventuretime-panel select:disabled,
.adventuretime-panel textarea:disabled { opacity: 0.45; cursor: not-allowed; }
.lh-choice-mech { opacity: 0.7; font-size: 0.9em; }

/* The CYOA editor. */
.lh-cyoa { display: flex; flex-direction: column; gap: 6px; }
.lh-cyoa-summary { font-size: 0.8em; opacity: 0.85; line-height: 1.45; }
.lh-cyoa-head { font-size: 0.8em; font-weight: 600; opacity: 0.85; margin-top: 4px; }
.lh-cyoa-slots { display: flex; flex-direction: column; gap: 4px; }
.lh-cyoa-slot { display: flex; align-items: center; gap: 6px; }
.lh-cyoa-slot-number { font-size: 0.8em; opacity: 0.7; width: 1.6em; text-align: right; }
.lh-cyoa-slot .lh-select { flex: 0 1 13em; min-width: 0; }
.lh-cyoa-slot .lh-input { flex: 1 1 8em; min-width: 0; }
.lh-cyoa-slot .lh-input[hidden] { display: none; }
.lh-cyoa-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.lh-cyoa-row .lh-select, .lh-cyoa-row .lh-input { flex: 1 1 10em; min-width: 0; }
.lh-cyoa-switches { display: flex; flex-direction: column; gap: 3px; }
.lh-cyoa-switch { display: flex; align-items: center; gap: 6px; font-size: 0.85em; }
.lh-cyoa-prompt { width: 100%; box-sizing: border-box; font: inherit; font-size: 0.8em; resize: vertical; }
.lh-cyoa-prompt[hidden] { display: none; }
.lh-cyoa-hint { font-size: 0.75em; opacity: 0.65; overflow-wrap: anywhere; }
.lh-cyoa > .lh-button { align-self: flex-start; }
/* The portrait on an entity card, in the panel and under every message. */
.rt-entity-portrait {
    width: 34px;
    height: 34px;
    border-radius: var(--lumiverse-radius, 6px);
    object-fit: cover;
    flex: 0 0 auto;
    margin-right: 2px;
}

/* The Lorebook Agent: the only control here that writes to a campaign. */
.lh-agent-campaign { display: flex; flex-direction: column; gap: 3px; }
.lh-agent-campaign-label { font-size: 0.8em; opacity: 0.8; }
.lh-agent-campaign-hint { font-size: 0.75em; opacity: 0.65; overflow-wrap: anywhere; }
/* The campaign's lorebooks and their attachment (55). */
.lh-books > summary { cursor: pointer; font-size: 0.85em; opacity: 0.8; }
.lh-books > summary.lh-books-summary--warn { color: var(--lumiverse-danger, #d9534f); opacity: 1; }
.lh-books-body { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.lh-books-lead { font-size: 0.78em; opacity: 0.7; }
.lh-books-list { display: flex; flex-direction: column; gap: 4px; }
.lh-book-row { display: flex; align-items: center; gap: 6px; font-size: 0.82em; flex-wrap: wrap; }
.lh-book-dot { width: 8px; height: 8px; border-radius: 50%; background: #555; flex-shrink: 0; }
.lh-book-row--attached .lh-book-dot { background: #00ffaa; box-shadow: 0 0 4px #00ffaa; }
.lh-book-row--detached .lh-book-dot { background: var(--lumiverse-danger, #d9534f); box-shadow: 0 0 4px var(--lumiverse-danger, #d9534f); }
.lh-book-row--missing { opacity: 0.6; }
.lh-book-row--adoptable .lh-book-dot { background: #ffb347; box-shadow: 0 0 4px #ffb347; }
.lh-book-name { font-weight: 600; overflow-wrap: anywhere; }
.lh-book-words { opacity: 0.75; }
.lh-books-bar { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.lh-books-auto { display: flex; gap: 6px; align-items: center; font-size: 0.8em; }
.lh-books-note { font-size: 0.8em; opacity: 0.8; }
.lh-books-note--error { color: var(--lumiverse-danger, #d9534f); opacity: 1; }
.lh-agent > summary { cursor: pointer; font-size: 0.85em; opacity: 0.8; }
.lh-agent-body { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.lh-agent-body[hidden] { display: none; }
.lh-agent-body > .lh-button { align-self: flex-start; }
.lh-agent-note { font-size: 0.8em; opacity: 0.85; overflow-wrap: anywhere; }
.lh-agent-note--error { color: var(--lumiverse-danger, #ff6b6b); opacity: 1; }
.lh-agent-detail { display: flex; flex-direction: column; gap: 3px; }
.lh-agent-line { font-size: 0.8em; overflow-wrap: anywhere; }
.lh-agent-line--changed { color: var(--lumiverse-success, #6ec07a); }
.lh-agent-line--deleted, .lh-agent-line--refused { color: var(--lumiverse-danger, #ff6b6b); }
.lh-agent-line--created { opacity: 0.85; }
/* Books exist but reach nobody until they are attached. Not an error, but the
   most expensive thing on this panel to miss, so it is not a footnote. */
.lh-agent-line--attach {
    color: var(--lumiverse-warning, #e0b155);
    padding: 6px 8px;
    margin-top: 4px;
    border-radius: var(--lumiverse-radius, 6px);
    border: 1px solid var(--lumiverse-warning, #e0b155);
    opacity: 0.95;
}
.lh-agent-steps { margin-top: 4px; }
.lh-agent-steps > summary { cursor: pointer; font-size: 0.8em; opacity: 0.7; }
.lh-agent-step {
    font-size: 0.75em;
    font-family: var(--lh-font-mono, var(--lumiverse-font-mono, ui-monospace, monospace));
    opacity: 0.8;
    overflow-wrap: anywhere;
    padding-left: 8px;
}
.lh-agent-step--tool { opacity: 1; }
.lh-agent-step--error { color: var(--lumiverse-danger, #ff6b6b); opacity: 1; }

/* What lore Lumiverse loaded, and by which mechanism. A diagnostic, folded. */
.lh-portraits > summary { cursor: pointer; font-size: 0.85em; opacity: 0.8; }
.lh-portrait-list { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.lh-portrait-row { display: flex; align-items: center; gap: 8px; font-size: 0.85em; }
/* Name over note, in one flexible column, so a long note wraps under the name
   instead of squeezing the buttons into three-line blocks. */
.lh-portrait-labels { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.lh-portrait-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lh-portrait-note {
    font-size: 0.85em;
    opacity: 0.75;
    overflow-wrap: anywhere;
}
.lh-portrait-note:empty { display: none; }
.lh-portrait-row--problem .lh-portrait-note { color: var(--lumiverse-danger, #ff6b6b); opacity: 1; }
.lh-portrait-row--problem .lh-portrait-thumb--empty {
    border-color: var(--lumiverse-danger, #ff6b6b);
    color: var(--lumiverse-danger, #ff6b6b);
    opacity: 1;
}
.lh-portrait-thumb {
    width: 32px;
    height: 32px;
    border-radius: var(--lumiverse-radius, 6px);
    object-fit: cover;
    flex: 0 0 auto;
    background: var(--lh-accent-bg, var(--lumiverse-fill, rgba(127,127,127,0.12)));
}
.lh-portrait-thumb--empty {
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.4;
    border: 1px dashed var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.35)));
}
/* The last prompt a portrait's draw wrote (61). */
.lh-portrait-prompt-label { font-size: 0.8em; opacity: 0.75; margin-top: 8px; }
.lh-portrait-prompt { font-size: 0.78em; white-space: pre-wrap; max-height: 160px; overflow: auto; padding: 6px 8px; border: 1px dashed var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.35))); border-radius: var(--lumiverse-radius, 6px); overflow-wrap: anywhere; }
.lh-portrait-prompt[hidden], .lh-portrait-prompt-label[hidden] { display: none; }

/* The bar editor: a colour and a percentage switch for each bar on screen. */

/* The switch for the cards under the messages. Not a cartridge setting, so it
   sits with the tracker rather than in the settings list. */
.lh-tracker-pref { display: flex; align-items: center; gap: 6px; font-size: 0.85em; opacity: 0.8; cursor: pointer; }
.lh-tracker-pref:hover { opacity: 1; }
.lh-tracker-pref input { margin: 0; }

/* The one destructive action the tracker offers, kept out of the way. */
.lh-tracker-archive-actions { display: flex; justify-content: flex-end; }
.lh-tracker-archive-actions .lh-button { font-size: 0.85em; opacity: 0.75; }
.lh-tracker-archive-actions .lh-button:hover { opacity: 1; }
/* The clock nudge, laid out like the agent's own fields rather than like the
   checkbox above it: it is a labelled value with a hint, not a switch. It
   borrows the .lh-tracker-pref type size, so it also has to undo that rule's
   centring — right for a checkbox, wrong for a column. (No backticks in here:
   PANEL_CSS is a template literal and one ends it.) */

/* Stepping back through the tracker's past. Hidden until there is a past. */
.lh-tracker-history { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.lh-tracker-history[hidden] { display: none; }
.lh-tracker-history-label { font-size: 0.85em; opacity: 0.75; }
.lh-tracker-raw-note {
    font-size: 0.8em;
    color: var(--lumiverse-warning, #d0a24c);
    padding: 4px 0;
}
.lh-tracker-raw-note[hidden] { display: none; }
/* Looking at a past state is a mode, and a mode has to look like one — these
   cards are not what the narrator sees. */
.lh-tracker-history--past {
    padding: 4px 6px;
    border-radius: var(--lumiverse-radius, 6px);
    border: 1px solid var(--lumiverse-warning, #d0a24c);
}
.lh-tracker-history--past .lh-tracker-history-label {
    color: var(--lumiverse-warning, #d0a24c);
    opacity: 1;
}

/* A pass running right now, said while it runs rather than only afterwards.
   Bordered like the attach notice because it is the same kind of message: the
   panel telling you something about the world, not about what you pressed. */
.lh-agent-running {
    font-size: 0.8em;
    padding: 6px 8px;
    margin-bottom: 4px;
    /* Its own rule, because a foldable body sets display on its children and
       that beats the browser's [hidden]. This has caught two folds already. */
    display: block;
    border-radius: var(--lumiverse-radius, 6px);
    border: 1px solid var(--lumiverse-warning, #d0a24c);
    color: var(--lumiverse-warning, #d0a24c);
}
.lh-agent-running[hidden] { display: none; }

/* World Progression (roadmap row 8): a fold under the agent, in its clothes. */
.lh-world > summary { cursor: pointer; font-size: 0.85em; opacity: 0.8; }
.lh-world-body { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.lh-world-body[hidden] { display: none; }
.lh-world-lead, .lh-world-note { font-size: 0.8em; opacity: 0.85; overflow-wrap: anywhere; }
/* The starting area (69; after Multihog's onboarding since 83): its rules are START_AREA_CSS, start-area.ts. */
.lh-world-note:empty { display: none; }
.lh-world-note--error { color: var(--lumiverse-danger, #ff6b6b); opacity: 1; }
.lh-world-running {
    font-size: 0.8em;
    padding: 6px 8px;
    display: block;
    border-radius: var(--lumiverse-radius, 6px);
    border: 1px solid var(--lumiverse-warning, #d0a24c);
    color: var(--lumiverse-warning, #d0a24c);
}
.lh-world-running[hidden] { display: none; }
.lh-world-switch { display: inline-flex; align-items: center; gap: 6px; font-size: 0.85em; }
.lh-maps-evolution-sites { display: flex; flex-direction: column; gap: 2px; }
/* A named site's row (71d): the tick, its own hours box, and what it inherits. */
.lh-maps-evolution-site { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.lh-maps-evolution-site .lh-input--short { width: 56px; min-width: 56px; text-align: center; }
.lh-maps-evolution-inherit { font-size: 0.75em; opacity: 0.65; }
.lh-maps-evolution-inherit--over { opacity: 0.45; }
.lh-maps-evolution-auto { padding: 0 0.45em; line-height: 1.4; }
.lh-world-status { font-size: 0.8em; opacity: 0.85; line-height: 1.45; overflow-wrap: anywhere; }
.lh-world-buttons { display: flex; gap: 6px; flex-wrap: wrap; }
.lh-world-extra { width: 100%; box-sizing: border-box; font: inherit; font-size: 0.85em; resize: vertical; }
.lh-world-body > .lh-button { align-self: flex-start; }
/* The skeleton (33b), a card of the World progression category since 82; its body is the fold's. */
.lh-skeleton-body { padding: 8px 10px 10px; }
.lh-skeleton-count-badge { font-size: 0.8em; opacity: 0.7; margin-left: 6px; }
.lh-skeleton-counts { display: flex; gap: 10px; flex-wrap: wrap; }
.lh-skeleton-count { display: inline-flex; align-items: center; gap: 6px; font-size: 0.85em; }
.lh-skeleton-count input { width: 4em; }
.lh-skeleton-filter[hidden], .lh-world-switch[hidden] { display: none; }
.lh-skeleton-prompt { font-family: ui-monospace, monospace; font-size: 0.8em; }
.lh-skeleton-source-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.lh-skeleton-books { display: flex; flex-direction: column; gap: 3px; max-height: 160px; overflow-y: auto; padding: 4px 0; }
.lh-skeleton-book { font-size: 0.8em; }
.lh-world-purge { margin-top: 8px; }
.lh-maps > summary { cursor: pointer; font-size: 0.85em; opacity: 0.8; }
.lh-maps-architect:empty, .lh-maps-architect-note:empty { display: none; }
.lh-maps [hidden] { display: none; }
.lh-world-purge-note:empty { display: none; }

/* Which model runs a job. Same shape as the agent fold's labelled rows, but a
   class of its own: one of these lives in the Tracker section, and borrowing
   the agent hint class across sections has bitten this panel before.
   (No backticks in here -- PANEL_CSS is a template literal and one ends it.) */
.lh-conn { display: flex; flex-direction: column; gap: 2px; margin: 6px 0; }
.lh-conn-label { font-size: 0.85em; opacity: 0.8; }
.lh-conn-hint { font-size: 0.78em; opacity: 0.65; }
.lh-conn select { width: 100%; }
/* A one- or two-digit number does not need the full width of the panel. The
   selects above still stretch, because their options are whole sentences.
   Caught by looking at the cadence row rather than by any test - a 420px box
   holding the character "4". */
.lh-conn input[type="number"] { width: 6em; align-self: flex-start; }

/* Both running notices carry a Stop button, so they lay out as a row rather
   than as a paragraph. The words take the space and the button keeps its size. */
.lh-agent-running,
.lh-tracker-report-running {
    display: flex;
    align-items: center;
    gap: 8px;
}
.lh-agent-running > span,
.lh-tracker-report-running > span { flex: 1 1 auto; }

/* Stop is an interruption, not a destruction: quieter than the run button it
   replaces on screen, and never the widest thing in the row. */
.lh-button--stop {
    flex: 0 0 auto;
    padding: 2px 10px;
    font-size: 0.9em;
    opacity: 0.85;
}
.lh-button--stop:hover { opacity: 1; }

/* A button that undoes rather than does: present, but not competing with the
   action above it for a press. */
.adventuretime-panel .lh-button--quiet { font-size: 0.85em; opacity: 0.75; }
.adventuretime-panel .lh-button--quiet:hover { opacity: 1; }

/* An armed destructive button, one press from doing something irreversible. */
.adventuretime-panel .lh-button--danger {
    border-color: var(--lumiverse-danger, #d9534f);
    color: var(--lumiverse-danger, #d9534f);
}

/* What the last tracker pass did. */
.lh-tracker-report {
    font-size: 0.8em;
    padding: 6px 8px;
    border-radius: var(--lumiverse-radius, 6px);
    border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25)));
    background: var(--lh-card-bg, var(--lumiverse-fill, rgba(127,127,127,0.06)));
}
.lh-tracker-report--idle { opacity: 0.65; }
.lh-tracker-report--failed { border-color: rgba(217,83,79,0.5); }
/* A pass is in flight, so what is in the box is the previous one. */
.lh-tracker-report--stale > *:not(.lh-tracker-report-running) { opacity: 0.5; }
.lh-tracker-report-running { font-weight: 600; margin-bottom: 4px; color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
.lh-tracker-report-why { opacity: 0.75; margin-top: 3px; }
.lh-ct-row { border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25))); border-radius: 6px; padding: 6px 8px; margin-bottom: 6px; }
.lh-ct-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.lh-ct-tag { width: 9em !important; font-family: var(--lh-font-mono, var(--lumiverse-font-mono, ui-monospace, monospace)); text-transform: uppercase; }
.lh-ct-book { flex: 1; min-width: 0; font-size: 0.8em; opacity: 0.6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lh-ct-remove { flex-shrink: 0; }
.lh-ct-error { color: var(--lumiverse-danger, #ff6b6b); font-size: 0.85em; margin-bottom: 4px; }
.lh-ct-text { width: 100%; box-sizing: border-box; }
.lh-report-history { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 0.85em; }
.lh-report-history[hidden] { display: none; }
.lh-report-history-label { flex-shrink: 0; opacity: 0.8; }
.lh-report-history select { flex: 1 1 auto; min-width: 0; }
.lh-report-earlier { font-style: italic; opacity: 0.8; margin-bottom: 4px; }
.lh-tracker-report--earlier { border-style: dashed; }
.lh-tracker-sample { margin-top: 5px; }
.lh-tracker-sample > summary { cursor: pointer; opacity: 0.8; }
.lh-tracker-sample pre {
    white-space: pre-wrap;
    max-height: 12em;
    overflow: auto;
    margin: 4px 0 0;
    padding: 6px;
    border-radius: 4px;
    background: rgba(127,127,127,0.12);
    font-size: 0.95em;
}

/* Custom fields editor. */
.lh-row-editor { align-items: stretch; }
.lh-fields { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.lh-fields-summary { font-size: 0.8em; opacity: 0.8; display: flex; flex-direction: column; gap: 2px; }
.lh-fields-tools { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.lh-fields-tools-note { font-size: 0.8em; opacity: 0.8; }
.lh-fields-tools-note:empty { display: none; }
.lh-world-tools { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.lh-world-tool-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: 0.85em; }
.lh-world-tool-count { width: 5em; }
.lh-fields-list { display: flex; flex-direction: column; gap: 6px; }
.lh-field {
    border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25)));
    border-radius: var(--lumiverse-radius, 6px);
    padding: 6px 8px;
}
.lh-field--on { border-color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
.lh-field-head { cursor: pointer; display: flex; align-items: center; gap: 8px; }
.lh-field-name { flex: 1; }
.lh-field-tag { font-size: 0.8em; opacity: 0.65; }
.lh-field-body { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; }
.lh-field-input { display: flex; flex-direction: column; gap: 3px; font-size: 0.85em; }
.lh-field-error { color: var(--lumiverse-danger, #d9534f); }
.lh-field-delete { align-self: flex-start; }
/* Switched on and still not maintained. The green "on" border would otherwise
   be reassuring about a field that does nothing at all. */
.lh-field--silent { border-color: var(--lumiverse-danger, #d9534f); }
.lh-field-silent {
    flex: 0 0 auto;
    font-size: 0.72em;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 5px;
    border-radius: var(--lumiverse-radius, 6px);
    background: var(--lumiverse-danger, #d9534f);
    color: var(--lh-accent-contrast, var(--lumiverse-primary-contrast, #10131a));
}
.lh-field-warning { color: var(--lumiverse-danger, #d9534f); }
/* The shape, not a description of the shape. Monospaced so the block format
   reads as the literal text the tracker is being asked to produce. */
.lh-field-example {
    margin: 0;
    /* Hugs its text. Stretched by the column it reads as an empty panel with
       some writing in the corner - caught by looking, not by a test. */
    align-self: flex-start;
    width: max-content;
    max-width: 100%;
    padding: 6px 8px;
    font-size: 0.78em;
    line-height: 1.45;
    white-space: pre;
    overflow-x: auto;
    opacity: 0.75;
    border-radius: var(--lumiverse-radius, 6px);
    background: var(--lh-card-bg, var(--lumiverse-fill, rgba(127,127,127,0.1)));
}

/* The rulebook switches. One row per section the narrator is sent, stock and
   the user's own interleaved in the saved order. Laid out like the other
   editors; the stock rows carry a switch, the others say why they do not. */
.lh-rb-summary { font-size: 0.8em; opacity: 0.85; display: flex; flex-direction: column; gap: 6px; }
.lh-rb-lead { line-height: 1.45; }
.lh-rb-counts { opacity: 0.75; }
/* An engine limit, said once above the list rather than on every row it touches. */
.lh-rb-limit {
    line-height: 1.45;
    padding: 6px 8px;
    border-radius: var(--lumiverse-radius, 6px);
    border: 1px solid var(--lumiverse-warning, #d0a24c);
    color: var(--lumiverse-warning, #d0a24c);
}
.lh-rb-list { display: flex; flex-direction: column; gap: 4px; }
.lh-rb-row {
    border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25)));
    border-radius: var(--lumiverse-radius, 6px);
    padding: 4px 8px;
}
.lh-rb-row--sent { border-color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
.lh-rb-head { display: flex; align-items: center; gap: 8px; }
.lh-rb-head input[type="checkbox"] { flex: 0 0 auto; margin: 0; }
.lh-rb-nocheck { flex: 0 0 auto; width: 13px; height: 13px; }
.lh-rb-name { flex: 1; min-width: 0; }
.lh-rb-badge {
    flex: 0 0 auto;
    font-size: 0.72em;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    padding: 1px 6px;
    border-radius: var(--lumiverse-radius, 6px);
    border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.35)));
    opacity: 0.8;
}
.lh-rb-badge--engine { border-color: var(--lumiverse-warning, #d0a24c); color: var(--lumiverse-warning, #d0a24c); }
/* Two fixed columns so the tags and the costs each read as a list. */
.lh-rb-tag { flex: 0 1 auto; min-width: 0; max-width: 23em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 0.78em; opacity: 0.55; }
.lh-rb-size { flex: 0 0 auto; width: 8.5em; text-align: right; font-size: 0.8em; opacity: 0.6; white-space: nowrap; }
/* Where the user's own sections sit in the order: one quiet line per run of
   them, with their switches one section down. Forty-four rows here drowned
   the twenty-two this editor is for. */
.lh-rb-marker { font-size: 0.78em; opacity: 0.6; padding: 2px 8px 2px 29px; line-height: 1.4; }
/* Sub-switches indented under the section that carries them. */
.lh-rb-children { display: flex; gap: 14px; flex-wrap: wrap; padding: 2px 0 2px 21px; font-size: 0.82em; opacity: 0.85; }
.lh-rb-child { display: flex; align-items: center; gap: 5px; cursor: pointer; }
.lh-rb-child input { margin: 0; }

/* The world rules editor -- the user's own sysprompt sections. The prose is
   the point, so a row opens to show it rather than summarising it. */
.lh-wr-summary { font-size: 0.8em; opacity: 0.85; display: flex; flex-direction: column; gap: 6px; }
.lh-wr-lead { line-height: 1.45; }
.lh-wr-counts { opacity: 0.75; }
.lh-wr-list { display: flex; flex-direction: column; gap: 6px; }
.lh-wr-note {
    line-height: 1.45;
    color: var(--lumiverse-warning, #d0a24c);
}

.lh-wr-row {
    border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25)));
    border-radius: var(--lumiverse-radius, 6px);
    padding: 6px 8px;
}
/* Sent to the storyteller every turn. Matching the custom fields list. */
.lh-wr-row--on { border-color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
/* On, and empty, so it is sent as nothing. */
.lh-wr-row--empty { border-color: var(--lumiverse-danger, #d9534f); }

.lh-wr-head { display: flex; align-items: center; gap: 8px; }
.lh-wr-head input[type="checkbox"] { flex: 0 0 auto; margin: 0; }
/* The name folds the body. The checkbox beside it does not. */
.lh-wr-name { flex: 1; min-width: 0; cursor: pointer; }
.lh-wr-name:hover { text-decoration: underline; }
/* A fixed column so the sizes read as a list and the expensive ones stand out. */
.lh-wr-size {
    flex: 0 0 auto;
    width: 8em;
    text-align: right;
    font-size: 0.8em;
    opacity: 0.6;
}
/* A GM-only row has no tag, and with the Edit button beside it (Phase 32) the
   empty column cost the name its line — "Gender / Cast" over two rows. The
   column collapses on those rows; their badge is wide enough to read alone. */
.lh-gs-tag:empty { width: auto; }
.lh-wr-chip {
    flex: 0 0 auto;
    font-size: 0.72em;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    padding: 1px 6px;
    border-radius: var(--lumiverse-radius, 6px);
    background: var(--lumiverse-danger, #d9534f);
    color: var(--lh-accent-contrast, var(--lumiverse-primary-contrast, #10131a));
}
.lh-wr-description { margin-top: 4px; font-size: 0.8em; line-height: 1.4; opacity: 0.7; }

/* The section's own text, verbatim. Capped because one of these runs to
   fourteen thousand characters and the panel is a column, not a document. */
.lh-wr-body {
    margin: 6px 0 0;
    padding: 8px;
    max-height: 22em;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.78em;
    line-height: 1.5;
    border-radius: var(--lumiverse-radius, 6px);
    background: var(--lh-card-bg, var(--lumiverse-fill, rgba(127,127,127,0.1)));
}

.lh-wr-actions { display: flex; align-items: center; gap: 8px; margin-top: 6px; flex-wrap: wrap; }
.lh-wr-warning {
    flex: 1 1 14em;
    font-size: 0.78em;
    line-height: 1.4;
    color: var(--lumiverse-danger, #d9534f);
}

/* Tracker modules editor. The stock counterpart of the custom fields list, and
   laid out to match it: a switch, a name, and the block it maintains. */
.lh-tm-summary { font-size: 0.8em; opacity: 0.85; display: flex; flex-direction: column; gap: 6px; }
.lh-tm-lead { line-height: 1.45; }
.lh-tm-counts { opacity: 0.7; }
.lh-tm-list { display: flex; flex-direction: column; gap: 6px; }

/* One line per row that needs explaining -- an engine-disabled module, or one
   switched on with no instructions to send. Kept in the summary rather than on
   the row: there are at most two, and they are paragraphs, not labels. */
.lh-tm-note {
    line-height: 1.45;
    padding: 6px 8px;
    border-radius: var(--lumiverse-radius, 6px);
    border: 1px solid var(--lumiverse-warning, #d0a24c);
    color: var(--lumiverse-warning, #d0a24c);
}

.lh-tm-row {
    border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25)));
    border-radius: var(--lumiverse-radius, 6px);
    padding: 6px 8px;
}
/* Matching the custom fields list, where a maintained block is the green one. */
.lh-tm-row--on { border-color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
/* Switched on and silent. The one state here that is actually wrong. */
.lh-tm-row--no-prompt { border-color: var(--lumiverse-danger, #d9534f); }
.lh-tm-row--unsupported { opacity: 0.7; }

.lh-tm-head { display: flex; align-items: center; gap: 8px; }
.lh-tm-head input[type="checkbox"] { flex: 0 0 auto; margin: 0; }
/* Where the engine owns the switch, the names still line up down the column. */
.lh-tm-nocheck { flex: 0 0 auto; width: 13px; height: 13px; }
.lh-tm-name { flex: 1; min-width: 0; }
/* A fixed column, so the block tags read as a list rather than a ragged edge.
   The longest is [BENCHED PARTY]. */
.lh-tm-tag {
    flex: 0 0 auto;
    width: 10.5em;
    text-align: right;
    font-size: 0.8em;
    opacity: 0.6;
}

.lh-tm-badge {
    flex: 0 0 auto;
    font-size: 0.72em;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    padding: 1px 6px;
    border-radius: var(--lumiverse-radius, 6px);
    border: 1px solid transparent;
    color: var(--lh-accent-contrast, var(--lumiverse-primary-contrast, #10131a));
}
.lh-tm-badge--unsupported {
    background: none;
    border-color: var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.35)));
    color: inherit;
    opacity: 0.8;
}
.lh-tm-badge--no-prompt { background: var(--lumiverse-danger, #d9534f); }

/* The opening sentence of the module's own instructions, so a row is not just
   a bare word. Taken from the cartridge rather than written here. */
.lh-tm-summary-line { margin-top: 4px; font-size: 0.8em; line-height: 1.4; opacity: 0.7; }
.lh-tm-badge--edited { background: rgba(255, 200, 80, 0.25); border: 1px solid rgba(255, 200, 80, 0.6); }
.lh-tm-badge--world { background: rgba(120, 180, 255, 0.2); border: 1px solid rgba(120, 180, 255, 0.5); }
.lh-tm-edit { flex: 0 0 auto; font-size: 0.75em; padding: 1px 6px; }
.lh-tm-editor { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.lh-tm-hint { font-size: 0.75em; opacity: 0.65; line-height: 1.4; }
.lh-tm-text { width: 100%; box-sizing: border-box; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.78em; line-height: 1.45; }

/* The cards' order in the same list (82, the section order editor of 37 folded in): the arrows on
   every row, a custom field's row and a Display Group's dashed row (75), the foot with the reset. */
.lh-tm-order-lead { line-height: 1.45; opacity: 0.8; }
.lh-tm-row--off { opacity: 0.65; }
.lh-tm-row--custom { border-style: dotted; }
.lh-tm-group { border-style: dashed; }
.lh-tm-icon { flex: 0 0 auto; }
.lh-tm-move { flex: 0 0 auto; font-size: 0.7em; padding: 1px 6px; }
.lh-tm-noplace { flex: 0 0 auto; font-size: 0.72em; opacity: 0.6; font-style: italic; }
.lh-tm-badge--custom, .lh-tm-badge--group { background: none; border-color: var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.35))); color: inherit; opacity: 0.8; }
.lh-tm-foot { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 0.8em; }
.lh-tm-state { flex: 1; opacity: 0.7; }

/* Game systems editor. Reads down a column like the fields above it, but a row
   here is a *report* with an optional switch rather than a control with a body:
   only the two verdicts this build can act on get a checkbox at all. */
.lh-gs-summary { font-size: 0.8em; opacity: 0.85; display: flex; flex-direction: column; gap: 6px; }
.lh-gs-tools { margin-top: 6px; }
.lh-gs-lead { line-height: 1.45; }
.lh-gs-counts { opacity: 0.7; }
.lh-gs-list { display: flex; flex-direction: column; gap: 6px; }

/* One badge explained once, rather than the same sentence on twenty rows. Only
   the verdicts actually present are listed, so this is two lines on a healthy
   cartridge and never mentions a fault the user does not have. */
.lh-gs-legend {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 6px 8px;
    border-radius: var(--lumiverse-radius, 6px);
    background: var(--lh-accent-bg, var(--lumiverse-fill, rgba(127,127,127,0.08)));
}
.lh-gs-legend-line { display: flex; align-items: baseline; gap: 6px; }
/* The chips are four different widths, so without a column the four meanings
   start at four different places and stop reading as a list. */
.lh-gs-legend-line .lh-gs-badge { min-width: 8.6em; text-align: center; }
.lh-gs-legend-text { flex: 1; line-height: 1.4; opacity: 0.85; }

.lh-gs-warning {
    color: var(--lumiverse-danger, #d9534f);
    line-height: 1.4;
}

.lh-gs-row {
    border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25)));
    border-radius: var(--lumiverse-radius, 6px);
    padding: 6px 8px;
}
/* Only the tracked row is coloured. An "off" system is a normal state and a
   GM-only one is correct data this build cannot use - neither is a fault, and
   painting either of them red would cry wolf on a quarter of the list. */
.lh-gs-row--live { border-color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
.lh-gs-row--broken { border-color: var(--lumiverse-danger, #d9534f); }
.lh-gs-row--gm-only { opacity: 0.75; }

/* No controls on a row: this section reads the cartridge, it does not change
   it. The switch is the custom field's, one section down. */
.lh-gs-head { display: flex; align-items: center; gap: 8px; }
.lh-gs-name { flex: 1; min-width: 0; }
/* A fixed column, so every badge to its left ends at the same edge. The tags
   run from [LEDGER] to [STORM_PRESSURE]; sized to the long one and right-set,
   which also keeps the brackets in a line. */
.lh-gs-tag {
    flex: 0 0 auto;
    width: 10.5em;
    text-align: right;
    font-size: 0.8em;
    opacity: 0.6;
}

.lh-gs-badge {
    flex: 0 0 auto;
    font-size: 0.72em;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    padding: 1px 6px;
    border-radius: var(--lumiverse-radius, 6px);
    border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.35)));
    opacity: 0.85;
}
.lh-gs-badge--live {
    border-color: transparent;
    background: var(--lh-accent, var(--lumiverse-primary, #d4a940));
    color: var(--lh-accent-contrast, var(--lumiverse-primary-contrast, #10131a));
    opacity: 1;
}
.lh-gs-badge--broken {
    border-color: transparent;
    background: var(--lumiverse-danger, #d9534f);
    color: var(--lh-accent-contrast, var(--lumiverse-primary-contrast, #10131a));
    opacity: 1;
}

/* The two switches disagreeing. Said on the row, because it is about that row
   and lesson 7 is that a message about one thing goes on that thing. */
.lh-gs-drift {
    margin-top: 4px;
    font-size: 0.8em;
    line-height: 1.4;
    color: var(--lumiverse-warning, #d0a24c);
}
.lh-gs-description { margin-top: 4px; font-size: 0.8em; line-height: 1.4; opacity: 0.7; }
.lh-gs-edit { margin-left: auto; font-size: 0.8em; padding: 1px 8px; }

/* The game system wizard (roadmap row 7). */
.lh-wizard { margin-top: 8px; }
.lh-wizard-fold > summary { cursor: pointer; font-size: 0.85em; opacity: 0.85; }
.lh-wizard-body { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.lh-wizard-screen { display: flex; flex-direction: column; gap: 6px; }
.lh-wizard-screen[hidden] { display: none; }
.lh-wizard-lead, .lh-wizard-note { font-size: 0.8em; opacity: 0.85; line-height: 1.45; }
.lh-wizard-note:empty { display: none; }
.lh-wizard-busy { font-size: 0.8em; margin-top: 6px; color: var(--lumiverse-warning, #e3b341); animation: lh-tracker-pulse 1.4s ease-in-out infinite; }
.lh-wizard-busy:empty { display: none; }
.lh-wizard-problem { font-size: 0.8em; color: var(--lumiverse-danger, #ff6b6b); }
.lh-wizard-hint { font-size: 0.75em; opacity: 0.65; line-height: 1.4; }
.lh-wizard-desc, .lh-wizard-half, .lh-wizard-feedback, .lh-wizard-prompt { width: 100%; box-sizing: border-box; font: inherit; font-size: 0.85em; resize: vertical; }
.lh-wizard-half, .lh-wizard-prompt { font-size: 0.78em; }
.lh-wizard-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.lh-wizard-chip { font: inherit; font-size: 0.75em; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(128,128,128,0.4))); background: transparent; color: inherit; cursor: pointer; }
.lh-wizard-chip:hover { border-color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
.lh-wizard-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.lh-wizard-option { display: inline-flex; align-items: center; gap: 5px; font-size: 0.8em; }
.lh-wizard-option .lh-input { width: 4em; }
.lh-wizard-icon { width: 3em !important; text-align: center; }
.lh-wizard-row > .lh-input:not(.lh-wizard-icon) { flex: 1 1 8em; min-width: 0; }
.lh-wizard-half-head { display: flex; align-items: center; gap: 6px; font-size: 0.8em; font-weight: 600; opacity: 0.9; margin-top: 4px; }
.lh-wizard-tag { width: 9em !important; font-family: var(--lh-font-mono, var(--lumiverse-font-mono, ui-monospace, monospace)); font-weight: 400; }
.lh-wizard-drivers { display: flex; flex-direction: column; gap: 3px; margin-top: 4px; }
.lh-wizard-prompt-fold > summary { cursor: pointer; font-size: 0.8em; opacity: 0.75; }
.lh-wizard-screen > .lh-button, .lh-wizard-half + .lh-button { align-self: flex-start; }
.lh-wizard-examples { display: flex; flex-direction: column; gap: 4px; }
.lh-wizard-picker { border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(128,128,128,0.3))); border-radius: 6px; padding: 6px 8px; background: var(--lh-card-bg, var(--lumiverse-fill, rgba(127,127,127,0.06))); display: flex; flex-direction: column; gap: 4px; }
.lh-wizard-picker[hidden] { display: none; }
.lh-wizard-picker-list { max-height: 160px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.lh-wizard-picker-group { font-weight: 600; margin-top: 4px; opacity: 0.8; }
.lh-wizard-preview { border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(128,128,128,0.3))); border-radius: 6px; padding: 4px; background: var(--lh-card-bg, var(--lumiverse-fill, rgba(127,127,127,0.06))); min-height: 2.5em; overflow: hidden; }
.lh-wizard-preview[hidden], .lh-wizard-preview-head[hidden], .lh-wizard-hint[hidden] { display: none; }
.lh-wizard-preview .rt-section-header { cursor: default; }
/* The dialog's box carries the panel's root class too, since the host's modal is outside the panel (73g-bis). */
.adventuretime-panel.lh-prompt-dialog { display: flex; flex-direction: column; gap: 8px; padding: 4px 0; border: var(--lh-border, none); box-shadow: var(--lh-shadow, none); }
.lh-prompt-dialog-intro { font-size: 0.8em; opacity: 0.7; line-height: 1.4; }
.lh-prompt-dialog-text { width: 100%; box-sizing: border-box; font: inherit; font-size: 0.85em; resize: vertical; min-height: 9em; }
.lh-prompt-dialog-skip { display: inline-flex; align-items: center; gap: 6px; font-size: 0.78em; opacity: 0.85; cursor: pointer; }
.lh-prompt-dialog-note { font-size: 0.78em; opacity: 0.75; min-height: 1em; }
.lh-prompt-dialog-row { display: flex; gap: 8px; flex-wrap: wrap; }

.rt-empty { font-size: 0.85em; opacity: 0.7; padding: 8px; text-align: center; }
.rt-section {
    border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25)));
    border-radius: var(--lumiverse-radius, 6px);
    overflow: hidden;
}
.rt-section-header {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 10px; cursor: pointer; font-weight: 600; font-size: 0.9em;
    background: var(--lh-card-header, var(--lumiverse-fill, rgba(127,127,127,0.08)));
}
.rt-section-body { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; }
/*
 * The display:flex above beats the browser's own rule for [hidden], so a
 * collapsed body stayed on screen with nothing to show it had been folded.
 * Latent until now — nothing collapsed anything — but the quest archive
 * sections start collapsed, so it would have shipped as "the fold does nothing".
 * (No backticks in here: this whole block is a JS template literal.)
 */
.rt-section-body[hidden] { display: none; }

.rt-entity-sub-line { display: flex; align-items: center; gap: 6px; font-size: 0.85em; min-height: 1.6em; }
.rt-entity-sub-label { opacity: 0.75; white-space: nowrap; }
/* One flex item, so the row's gap does not open up inside a value. */
.rt-entity-sub-value { min-width: 0; overflow-wrap: anywhere; }
.rt-card-kv { display: flex; gap: 6px; font-size: 0.85em; }
.rt-card-key { opacity: 0.75; white-space: nowrap; }
.rt-card-item--plain { font-size: 0.85em; opacity: 0.9; }
.rt-paren-highlight { opacity: 0.7; }

/* Bars: a track that fills, whatever the marker. */
.rt-hp-bar-wrap, .rt-xp-bar-wrap, .rt-progress-bar-wrap, .rt-weight-bar-wrap, .rt-barrel-track {
    flex: 1; min-width: 60px; height: 12px; border-radius: 4px; overflow: hidden;
    background: rgba(127,127,127,0.2); position: relative;
}
.rt-hp-bar, .rt-xp-bar, .rt-progress-bar, .rt-weight-bar {
    height: 100%; border-radius: 4px; transition: width 0.3s;
}
.rt-hp-row, .rt-xp-row, .rt-progress-row, .rt-weight-row, .rt-barrel-row,
.rt-clock-row, .rt-stars-row, .rt-orbs-row, .rt-slots-row, .rt-phase-row,
.rt-gauge-row, .rt-charge-row { gap: 6px; }
.rt-hp-label, .rt-progress-label, .rt-weight-label, .rt-xp-readout,
.rt-clock-label, .rt-phase-label, .rt-gauge-label, .rt-charge-label,
.rt-barrel-value { font-size: 0.9em; opacity: 0.85; white-space: nowrap; }
.rt-xp-level { font-size: 0.85em; opacity: 0.75; }

/* The XP card's row (74f), the legacy's shape: the level and the count over the bar. */
.rt-xp-row { position: relative; padding: 4px 0; }
.rt-xp-label { font-size: 0.88em; color: inherit; opacity: 0.7; margin-bottom: 3px; display: flex; justify-content: space-between; }
.rt-xp-row > .rt-xp-bar-wrap { height: 8px; border: 1px solid rgba(255, 255, 255, 0.1); }
/* The XP bar at the bottom (74f, the legacy's rt-bottom-xp-bar): the row alone, the label over the bar. */
.lh-bottom-xp { flex: 0 0 auto; padding: 0 8px 5px; background: rgba(0, 0, 0, 0.28); border-top: 1px solid rgba(255, 255, 255, 0.06); overflow: hidden; }
.lh-bottom-xp[hidden] { display: none; }
.lh-widget-foot:empty { display: none; }
.lh-widget-foot { flex-shrink: 0; }
/* Outside the widget's foot, the bar sticks to the foot of the view as the play parts scroll. */
.lh-tracker > .lh-bottom-xp { position: sticky; bottom: 0; z-index: 2; }
.lh-bottom-xp .rt-bottom-xp-content .rt-xp-row { min-height: 16px; padding: 0; display: grid; align-items: center; }
.lh-bottom-xp .rt-bottom-xp-content .rt-xp-label, .lh-bottom-xp .rt-bottom-xp-content .rt-xp-bar-wrap { grid-area: 1 / 1; }
.lh-bottom-xp .rt-bottom-xp-content .rt-xp-label { z-index: 1; margin: 0; padding: 0 6px; opacity: 0.95; font-size: 0.76em; line-height: 14px; color: #fff; text-shadow: 0 1px 3px #000, 0 0 3px #000; pointer-events: none; }
.lh-bottom-xp .rt-bottom-xp-content .rt-xp-bar-wrap { height: 14px; border-radius: 2px; background: rgba(0, 0, 0, 0.58); border-color: rgba(255, 255, 255, 0.22); }
.lh-bottom-xp .rt-bottom-xp-content .rt-xp-bar { border-radius: 1px; box-shadow: inset 0 1px rgba(255, 255, 255, 0.24), 0 0 8px rgba(243, 156, 18, 0.38); }
/* The attached bar is display-only; it is not a recolour control (the legacy's rule for its bottom bar, 74i). */
.lh-bottom-xp .rt-xp-bar-wrap[data-recolor-id], .lh-bottom-xp .rt-xp-bar-wrap[data-recolor-id] .rt-xp-bar { cursor: default; pointer-events: none; transform: none; }
/* A marker-drawn row (XPBAR) in the bar: its label and readout beside the bar, small and lit. */
.lh-bottom-xp .rt-bottom-xp-content .rt-entity-sub-line.rt-xp-row { display: flex; gap: 6px; min-height: 16px; }
.lh-bottom-xp .rt-bottom-xp-content .rt-entity-sub-label, .lh-bottom-xp .rt-bottom-xp-content .rt-xp-readout { font-size: 0.76em; color: #fff; text-shadow: 0 1px 3px #000; }

/* BARREL is centre-zero: the fill grows out from the middle, either way. */
.rt-barrel-center-marker { position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: rgba(255,255,255,0.35); }
.rt-barrel-fill { position: absolute; top: 0; bottom: 0; }
.rt-barrel-fill.rt-barrel-positive { left: 50%; }
.rt-barrel-fill.rt-barrel-negative { right: 50%; }

.rt-units-container { flex-wrap: wrap; }

/* Spell slots and hit dice as pips (38): the legacy's rows and dots. */
.rt-spell-row { display: grid; grid-template-columns: 70px 1fr; align-items: start; gap: 6px; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 0.85em; }
.rt-spell-row:last-child { border-bottom: none; }
.rt-spell-level { font-size: 0.88em; opacity: 0.7; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; }
.rt-spell-inline-group { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 4px; min-width: 0; }
.rt-spell-list { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; }
.rt-spell-name { font-size: 0.92em; color: inherit; text-decoration: none; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 4px; padding: 1px 5px; }
.rt-spell-name:hover { border-color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); }
.rt-slot-pips { display: inline-flex; align-items: center; gap: 4px; margin-right: 6px; flex-shrink: 0; height: 1.4em; vertical-align: middle; }
.rt-slot-pip { width: 8px; height: 8px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.15); flex-shrink: 0; }
.rt-slot-available { background: #0088ff; border-color: #0088ff; box-shadow: 0 0 4px rgba(0, 136, 255, 0.4); }
/* A used pip stays visible on a dark skin (47e-ter): a faint fill and a firmer edge, not a hole. */
.rt-slot-used { background: rgba(127,127,127,0.28); border-color: rgba(127,127,127,0.7); }
.rt-hd-pips { display: inline-flex; align-items: center; gap: 3px; margin-left: 4px; vertical-align: middle; }
.rt-hd-pip { width: 7px; height: 7px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.15); flex-shrink: 0; }
.rt-hd-available { background: #ffd700; border-color: #ffd700; box-shadow: 0 0 4px rgba(255, 215, 0, 0.4); }
.rt-hd-label { opacity: 0.8; }
.rt-unit-pill, .rt-difficulty-badge, .rt-coin-badge, .rt-reward-chip, .rt-weather-badge, .rt-dice-roll {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 1px 8px; border-radius: 10px; font-size: 0.95em;
    border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.35)));
    background: var(--lh-accent-bg, var(--lumiverse-fill, rgba(127,127,127,0.12)));
}
.rt-dice-roll { font-family: ui-monospace, monospace; border-radius: 4px; }
.rt-unit-descr { font-size: 0.8em; opacity: 0.7; }
.rt-pill-buff { border-color: rgba(46,204,113,0.55); }
.rt-pill-debuff { border-color: rgba(231,76,60,0.55); }

.rt-orbs-container, .rt-slots-container, .rt-phase-container { display: flex; align-items: center; gap: 3px; }
.rt-orb { width: 10px; height: 10px; border-radius: 50%; border: 1px solid rgba(127,127,127,0.5); }
.rt-slot { width: 14px; height: 10px; border: 1px solid rgba(127,127,127,0.5); border-radius: 2px; overflow: hidden; position: relative; }
.rt-slot-fill { position: absolute; left: 0; top: 0; bottom: 0; display: block; }
.rt-phase-node { width: 9px; height: 9px; border-radius: 50%; border: 1px solid rgba(127,127,127,0.6); }
.rt-phase-line { width: 12px; height: 2px; background: rgba(127,127,127,0.4); }
.rt-clock-icon { width: 14px; height: 14px; border-radius: 50%; border: 1px solid rgba(127,127,127,0.5); }
.rt-gauge-wrap { width: 28px; height: 14px; border-radius: 14px 14px 0 0; overflow: hidden; position: relative; }
.rt-gauge-bg { position: absolute; inset: 0; opacity: 0.5; }
.rt-gauge-needle { position: absolute; left: 50%; bottom: 0; width: 1px; height: 12px; background: currentColor; transform-origin: bottom center; }
.rt-battery-wrap { position: relative; width: 26px; height: 12px; border: 1px solid; border-radius: 3px; overflow: hidden; }
.rt-battery-fill { position: absolute; left: 0; top: 0; bottom: 0; }
.rt-battery-nub { position: absolute; right: -3px; top: 3px; width: 2px; height: 6px; }

.rt-objective { display: flex; align-items: center; gap: 6px; font-size: 0.85em; }
.rt-obj-done .rt-obj-text { opacity: 0.6; text-decoration: line-through; }
.rt-obj-failed .rt-obj-icon { color: var(--lumiverse-danger, #d9534f); }

/* A row of markers shares one line; tab stops turn it into a grid. */
.rt-multi-marker-row { display: flex; align-items: center; gap: 10px; }
.rt-multi-marker-row--tab-stops { display: grid; grid-template-columns: repeat(1000, 1fr); }
.rt-mmc-cell { min-width: 0; }
.rt-mmc-cell--stretch { flex: 1; }
.rt-entity-row { font-size: 0.85em; }
.rt-entity-name { font-weight: 600; }

/* Quest cards. The log is a stack of cards inside the QUESTS section body. */
.rt-section-count { font-size: 0.8em; font-weight: 400; opacity: 0.6; margin-left: auto; }
/* The camp roster inside the PARTY card: members who are away, drawn the same
   way as the active ones under a quiet sub-heading. */
.rt-benched { margin-top: 8px; padding-top: 6px; border-top: 1px dashed var(--lh-accent-dim, var(--lumiverse-border, rgba(255,255,255,0.12))); }
.rt-benched-head { display: flex; align-items: center; gap: 6px; font-size: 0.85em; opacity: 0.8; margin-bottom: 4px; }
.rt-benched-title { font-weight: 600; letter-spacing: 0.02em; }
.rt-section-body--quests { gap: 8px; }
.rt-quest-none { font-size: 0.85em; opacity: 0.6; padding: 2px 0; }
.rt-quest-card {
    display: flex; flex-direction: column; gap: 5px;
    border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.25)));
    border-left: 3px solid var(--lh-accent, var(--lumiverse-primary, #d4a940));
    border-radius: var(--lumiverse-radius, 6px);
    padding: 7px 9px;
    background: var(--lh-card-bg, var(--lumiverse-fill, rgba(127,127,127,0.06)));
}
.rt-quest-card--inactive { opacity: 0.72; }
.rt-quest-card--failed { border-left-color: var(--lumiverse-danger, #d9534f); }
.rt-quest-card--completed { border-left-color: rgba(127,127,127,0.5); }
.rt-quest-header { display: flex; align-items: baseline; gap: 8px; }
.rt-quest-title { font-weight: 600; font-size: 0.92em; flex: 1; }
.rt-quest-badge {
    font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.04em;
    padding: 1px 7px; border-radius: 10px; white-space: nowrap;
    border: 1px solid rgba(127,127,127,0.4);
}
.rt-quest-badge--active { border-color: rgba(46,204,113,0.55); color: #2ecc71; }
.rt-quest-badge--completed { border-color: rgba(127,127,127,0.5); opacity: 0.8; }
.rt-quest-badge--failed { border-color: rgba(231,76,60,0.55); color: #e74c3c; }
.rt-quest-giver { font-size: 0.8em; opacity: 0.75; }
.rt-quest-objectives { display: flex; flex-direction: column; gap: 2px; }
.rt-quest-obj { display: flex; align-items: baseline; gap: 6px; font-size: 0.85em; }
.rt-quest-check { opacity: 0.8; width: 1em; flex: none; }
.rt-quest-obj--done .rt-quest-obj-text { opacity: 0.55; text-decoration: line-through; }
.rt-quest-obj--done .rt-quest-check { color: #2ecc71; }
.rt-quest-obj--failed .rt-quest-check { color: var(--lumiverse-danger, #d9534f); }
.rt-quest-obj--failed .rt-quest-obj-text { opacity: 0.6; }
.rt-quest-progress { font-variant-numeric: tabular-nums; opacity: 0.85; font-size: 0.9em; }
.rt-quest-optional { opacity: 0.55; font-size: 0.9em; }
.rt-quest-rewards { display: flex; flex-wrap: wrap; gap: 4px; }
.rt-quest-reward {
    font-size: 0.78em; padding: 1px 7px; border-radius: 10px;
    border: 1px solid rgba(241,196,15,0.4); background: rgba(241,196,15,0.08);
}
.rt-quest-time { display: flex; align-items: baseline; gap: 6px; font-size: 0.8em; flex-wrap: wrap; }
.rt-quest-ago { opacity: 0.65; font-size: 0.95em; }
.rt-quest-time--overdue .rt-quest-ago { color: var(--lumiverse-danger, #d9534f); opacity: 0.9; }
.rt-quest-mood-label { margin-left: auto; font-size: 0.95em; }

/*
 * The mood bar is a position, not a quantity: a third along is neutral, two
 * thirds is the deadline. The two ticks are what make that readable — without
 * them a half-full bar means nothing.
 */
.rt-quest-mood-bar-wrap {
    position: relative; height: 5px; border-radius: 3px; overflow: hidden;
    background: rgba(127,127,127,0.2);
}
.rt-quest-mood-bar { height: 100%; border-radius: 3px; transition: width 0.3s; }
.rt-quest-mood-tick { position: absolute; top: 0; bottom: 0; width: 1px; background: rgba(255,255,255,0.45); }
.rt-quest-mood-tick--neutral { left: 33.33%; }
.rt-quest-mood-tick--deadline { left: 66.67%; }

.rt-quest-archive {
    border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.2)));
    border-radius: var(--lumiverse-radius, 6px);
    overflow: hidden;
}
.rt-quest-archive > .rt-section-header { font-size: 0.82em; opacity: 0.8; }
.rt-quest-archive > .rt-section-body { gap: 6px; padding: 6px; }

/* Entity cards: COMBAT, PARTY, BENCHED PARTY, CHARACTER. */
.rt-section-body--entities { gap: 6px; }
.rt-entity-card {
    display: flex; flex-direction: column; gap: 4px;
    border: 1px solid var(--lh-accent-dim, var(--lumiverse-border, rgba(127,127,127,0.22)));
    border-radius: var(--lumiverse-radius, 6px);
    padding: 6px 8px;
    background: var(--lh-card-bg, var(--lumiverse-fill, rgba(127,127,127,0.06)));
}
/* Which side a combatant is on, said with an edge rather than a word. */
.rt-entity-card--enemies { border-left: 3px solid rgba(231,76,60,0.6); }
.rt-entity-card--allies { border-left: 3px solid rgba(52,152,219,0.6); }
/*
 * A defeated combatant stays on screen rather than vanishing — the party can
 * still see the body, and a name that disappears reads as a rendering fault.
 */
.rt-entity-card--defeated { opacity: 0.45; }
.rt-entity-card--defeated .rt-entity-name { text-decoration: line-through; }
.rt-entity-row { display: flex; align-items: center; gap: 8px; font-size: 0.85em; }
.rt-entity-name { font-weight: 600; flex: none; max-width: 45%; overflow-wrap: anywhere; }
/* No HP bar on the row (47e-ter, upstream): the name takes the full width instead of the bar's share. */
.rt-entity-row--bare .rt-entity-name { max-width: none; flex: 1 1 auto; }
/* PARTY compact mode (47e-ter, upstream 2026.8.80): portrait, name and HP only. */
.rt-party-compact-btn { margin-left: auto; font-size: 0.72em; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; padding: 1px 6px; border: 1px solid rgba(127,127,127,0.5); border-radius: 4px; background: none; color: inherit; cursor: pointer; opacity: 0.7; }
.rt-party-compact-btn:hover { opacity: 1; }
.rt-party-compact-btn.active { color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); border-color: var(--lh-accent, var(--lumiverse-primary, #d4a940)); opacity: 1; }
.rt-party-compact .rt-entity-body, .rt-party-compact .rt-benched .rt-entity-body { display: none !important; }
.rt-party-compact .rt-entity-card { padding-top: 2px; padding-bottom: 2px; }
/* Unknown hit points are a neutral full bar, not an empty one. */
.rt-hp-unknown { opacity: 0.55; }
.rt-entity-body { display: flex; flex-direction: column; gap: 3px; padding-left: 2px; }

.rt-combat-round {
    font-size: 0.8em; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
    opacity: 0.75; padding: 4px 0 1px;
}
.rt-combat-side {
    font-size: 0.72em; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
    padding: 3px 0 1px; opacity: 0.8;
}
.rt-combat-side--enemies { color: #e74c3c; }
.rt-combat-side--allies { color: #3498db; }
` + '\n' + MAP_PICTURE_CSS + '\n' + RECORDS_FOLD_CSS + '\n' + TERMINAL_FOLD_CSS + '\n' + AGENT_TOOLS_CSS + '\n' + SANDBOX_FOLD_CSS + '\n' + CREATOR_FOLD_CSS + '\n' + NARRATOR_CONFIG_CSS + '\n' + DEVELOPER_CARD_CSS + '\n' + SECOND_PASS_CSS + '\n' + CORE_CARD_CSS + '\n' + INSTANT_FOLD_CSS + '\n' + START_AREA_CSS + '\n' + PLAYER_CARD_FOLD_CSS + '\n' + WAYS_FOLD_CSS + '\n' + IMPORT_FOLD_CSS + '\n' + LIBRARY_FOLD_CSS + '\n' + NPC_CREATOR_FOLD_CSS + '\n' + EDITOR_TAB_CSS + '\n' + SCENE_FOLD_CSS + '\n' + CARD_SETTINGS_CSS + '\n' + PORTRAIT_DRAW_CSS + '\n' + PORTRAITS_SECTION_CSS + '\n' + PORTRAIT_STYLES_CSS + '\n' + PREF_DIALS_CSS + '\n' + CARDS_CSS + '\n' + CATEGORIES_CSS + '\n' + ENLARGE_CSS + '\n' + mapKindArtCss() + '\n' + THEME_CSS + THEME_WIZARD_CSS + FONT_SIZE_CSS + DAY_NIGHT_CSS + BACKDROP_CSS + MAP_THEME_CSS + '\n' + BAR_ANIMATION_CSS + '\n' + RECOLOR_CSS + '\n' + DISPLAY_GROUP_CSS + DISPLAY_GROUPS_CARD_CSS + '\n' + TAB_MODE_CSS + TAB_MODE_PANEL_CSS + SECTIONS_EDITOR_CSS + '\n' + RELATIONSHIP_FLOAT_CSS
