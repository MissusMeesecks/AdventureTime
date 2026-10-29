/**
 * Tab Mode (Phase 76): the typed face over the twenty-third generated file.
 *
 * Multihog's compact layout — the Character and Combat cards pinned at the
 * top, a party-vitals strip (a portrait and an HP ring per member), and
 * every other module behind one tab strip, one pane showing — for small
 * screens. The pieces the extractor could cut from `renderer.js` are here:
 * the pinned tags, the vitals reader and the vitals strip, each given what
 * it read from the legacy's module scope (the bar colours through AdventureTime's
 * resolver, the portraits through AdventureTime's lookup). The view itself is
 * `renderTabModeHtml` in `render.ts`, transcribed, since the legacy's is a
 * closure over its whole renderer. The stylesheet's rules are carried onto
 * AdventureTime's tokens (74a) so the themes reach them.
 */
import { barBackground, barPrefFor, barShowsPercentage, type BarPrefs } from './bars.js'
import { escapeHtml } from './html.js'
import { portraitFor } from './portraits.js'
import { createTabModeLegacy, LEGACY_TAB_MODE_CSS } from './tab-mode-legacy.js'

/** The legacy's default HP colour, as `entity-view.ts` keeps it. */
const DEFAULT_HP_COLOR = '#00ffaa'

/** One member of the vitals strip, as the legacy's reader returns it. */
export interface PartyVitals {
    name: string
    cur: number
    max: number
    pct: number
}

/** What the vitals strip reads beside the PARTY block: the per-bar choices (74i) and the chat's portraits. */
export interface VitalsOptions {
    bars?: BarPrefs
    portraits?: Record<string, string>
}

/** The legacy's placeholder is a Font Awesome glyph the host does not ship; a bust stands in, under the legacy's class. */
const PORTRAIT_PLACEHOLDER = '<span class="rt-entity-portrait-placeholder" aria-hidden="true">👤</span>'

function legacyFor(options: VitalsOptions) {
    return createTabModeLegacy({
        getBarShowAsPercentage: (barId: string) => barShowsPercentage(barPrefFor(options.bars, barId), barId),
        getBarBackground: (barId: string, defaultColor: string, pct: number) => barBackground(barPrefFor(options.bars, barId), barId, defaultColor, pct),
        renderPortraitHtml: (name: string) => {
            const src = portraitFor(options.portraits, name)
            return src ? `<img class="rt-entity-portrait" src="${escapeHtml(src)}" alt="${escapeHtml(name)}" />` : PORTRAIT_PLACEHOLDER
        },
        escapeHtml,
        DEFAULT_HP_COLOR,
    })
}

const reader = legacyFor({})

/** The tags Tab Mode pins above the strip: CHARACTER and COMBAT, the legacy's. */
export const TAB_MODE_PINNED_TAGS: readonly string[] = reader.TABMODE_PINNED_TAGS

/** The legacy's line scan of a PARTY block for `Name: cur/max HP` entries, a list dash dropped. */
export function extractPartyVitals(content: string | null | undefined): PartyVitals[] {
    return reader.extractPartyVitals(content ?? '')
}

/** The legacy's member button, as its strip writes it; the name is added after it (76-bis). */
const MEMBER_BUTTON = '<button class="rt-vitals-member" data-jump-tag="PARTY"'

/**
 * The legacy's vitals strip over a PARTY block's raw content: `''` with no
 * member to show. Each member's button also carries its name as
 * `data-jump-entity` (76-bis, the maintainer's ask), so the panel's jump can
 * land on that member's own entry in the Party tab; the legacy's jump only
 * switches tabs. The names come from the same reader in the same order as
 * the buttons, so the i-th button is the i-th member.
 */
export function renderPartyVitalsStrip(partyContent: string | null | undefined, options: VitalsOptions = {}): string {
    const html = legacyFor(options).renderPartyVitalsStrip({ PARTY: partyContent ?? '' })
    if (!html) return html
    const names = extractPartyVitals(partyContent).map((member) => member.name)
    const pieces = html.split(MEMBER_BUTTON)
    return pieces.map((piece, i) => (i === 0 ? piece : `${MEMBER_BUTTON} data-jump-entity="${escapeHtml(names[i - 1] ?? '')}"${piece}`)).join('')
}

/**
 * The legacy's `--rt-*` variables carried onto AdventureTime's tokens (74a), each
 * with the host's variable and the legacy's own fallback behind it, so a
 * root with no theme class keeps the look before the pass.
 */
const TOKEN_FALLBACKS: Record<string, string> = {
    '--rt-bg': 'var(--lh-bg, var(--lumiverse-surface, transparent))',
    '--rt-blur': 'var(--lh-blur, none)',
    '--rt-text': 'var(--lh-text, var(--lumiverse-text, inherit))',
    '--rt-text-muted': 'var(--lh-text-muted, var(--lumiverse-text-muted, inherit))',
    '--rt-accent': 'var(--lh-accent, var(--lumiverse-primary, #d4a940))',
}

/** The Tab Mode rules of `style.css` on AdventureTime's tokens, scoped under the panel's root. */
export function tabModeCss(legacy: string = LEGACY_TAB_MODE_CSS): string {
    return legacy.replace(/var\((--rt-(?:bg|blur|text-muted|text|accent))(?:,\s*[^)]*)?\)/g, (whole, name: string) => TOKEN_FALLBACKS[name] ?? whole)
}

export const TAB_MODE_CSS: string = tabModeCss()
