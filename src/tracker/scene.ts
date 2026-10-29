/**
 * The scene view's grammar (Phase 42): where the party is, and who is there.
 *
 * The legacy's Visuals mode (`immersion.js`, `buildImmersionSceneState`)
 * reads the location from the last `(Location: …)` footer in the chat, else
 * from the memo; resolves it against the place book's entry titles with the
 * location resolver (deepest suffix match wins, then a leaf-only fallback);
 * and lists who is *present now* by scanning the latest narrator reply —
 * choices stripped — for the names of the campaign's NPC entries, the
 * Player Character first. The legacy code for the pure parts is
 * `scene-legacy.js`, sliced from four files; this is its typed face and the
 * few rules `immersion.js` keeps for itself.
 */

import { createSceneLegacy } from './scene-legacy.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const plain = createSceneLegacy() as unknown as Record<string, any>

/** `Monastery::Courtyard` → `Monastery :: Courtyard`. */
export function normalizeLocationPath(path: string | null | undefined): string {
    return plain.normalizeLocationPath(path ?? '') as string
}

export function tokenizeLocationText(raw: string | null | undefined): string[] {
    return plain.tokenizeLocationText(raw ?? '') as string[]
}

/** The legacy's resolver: free text to a canonical path, or `null`. */
export function resolveLocationPath(rawText: string, allPaths: readonly string[], opts: { activeLocPaths?: readonly string[] } = {}): string | null {
    return plain.resolveCurrentLocationPath(rawText, [...allPaths], { activeLocPaths: [...(opts.activeLocPaths ?? [])] }) as string | null
}

/** `Monastery :: Courtyard` → `Monastery › Courtyard`. */
export function formatLocationBreadcrumb(path: string | null | undefined): string {
    return plain.formatLocationBreadcrumb(path ?? '') as string
}

/** The legacy's choice strip for Present Now: `<choices>` blocks, the CYOA div, and every `<button>`, escaped or not. */
export function stripSceneChoices(text: string | null | undefined): string {
    return plain.stripCyoaChoiceBlocks(text ?? '') as string
}

/** `Vell_NPC`, `Vell_NPCs`, `NPC`, `NPCs`: the books the name scan reads. */
export function isNpcBookName(name: string | null | undefined): boolean {
    return plain.isNpcBookName(name ?? '') as boolean
}

/** The legacy's name test: the whole label at word boundaries, or any token of two letters unless the full name is required. */
export function narrativeMentionsNpc(text: string, label: string, opts: { requireFullName?: boolean } = {}): boolean {
    return plain.narrativeMentionsNpcName(text, label, opts) as boolean
}

// ── The rules immersion.js keeps for itself ────────────────────────────────

export interface SceneMessage {
    role: string
    content: string
}

/**
 * The legacy's `getCurrentLocationText`: the last `(Location: …)` footer
 * anywhere in the chat, newest first and whoever wrote it; else the memo's
 * `Location:` line; else `''`.
 */
export function currentLocationText(messages: readonly SceneMessage[], memo: string | null | undefined): string {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = String(messages[i]?.content ?? '').match(/\(Location:\s*([^)]+)\)/i)
        if (m) return m[1]!.trim()
    }
    const m = String(memo ?? '').match(/Location:\s*([^)\n]+)/i)
    return m ? m[1]!.trim() : ''
}

/** The latest narrator reply's text, as the scan reads it: the newest assistant message, choices stripped, or `''`. */
export function latestNarration(messages: readonly SceneMessage[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i]!
        if (message.role !== 'assistant') continue
        const text = stripSceneChoices(message.content)
        // The legacy skips a summary message outright.
        if (text.startsWith('[Summary') || text.startsWith('(Summary') || text.includes('Summary of past events:')) return ''
        return text
    }
    return ''
}

/**
 * The newest `count` narrator replies, newest first, as the scan reads them
 * (Phase 52): choices stripped, a summary message skipped rather than counted
 * (a summary is not a scene). `count` below one reads one.
 */
export function recentNarrations(messages: readonly SceneMessage[], count: number): string[] {
    const wanted = Math.max(1, Math.floor(Number(count) || 1))
    const out: string[] = []
    for (let i = messages.length - 1; i >= 0 && out.length < wanted; i--) {
        const message = messages[i]!
        if (message.role !== 'assistant') continue
        const text = stripSceneChoices(message.content)
        if (text.startsWith('[Summary') || text.startsWith('(Summary') || text.includes('Summary of past events:')) continue
        out.push(text)
    }
    return out
}

export interface SceneLocation {
    /** What the footer or the memo said, `''` when neither says. */
    raw: string
    /** The place book's path it resolves to, `''` when none matches. */
    path: string
    /** The path's last segment, or the raw text. */
    leaf: string
    /** `Monastery › Courtyard`, `''` when unresolved. */
    breadcrumb: string
    /** Where an image for the place is kept: the path, or the raw text normalized. */
    storagePath: string
}

/** The legacy's location half of `buildImmersionSceneState`. */
export function resolveSceneLocation(raw: string, paths: readonly string[], active: readonly string[] = []): SceneLocation {
    const path = raw ? resolveLocationPath(raw, paths, { activeLocPaths: active }) ?? '' : ''
    return {
        raw,
        path,
        leaf: path ? path.split(' :: ').pop() ?? path : raw,
        breadcrumb: path ? formatLocationBreadcrumb(path) : '',
        storagePath: path || (raw ? normalizeLocationPath(raw) : ''),
    }
}

/** The legacy's label for the Present Now test: a leading `[tag]` dropped. */
export function sceneLabel(comment: string | null | undefined): string {
    return String(comment ?? '').replace(/^\[.*?\]\s*/i, '').trim()
}

/** What the legacy calls the same character: the label without parentheticals, case-blind. */
export function sceneCharacterKey(label: string | null | undefined): string {
    return String(label ?? '').replace(/\s*\(.*?\)/g, '').trim().toLowerCase()
}

export interface SceneEntry {
    id: string
    comment: string
    content: string
}

export interface PresentNpc {
    id: string
    label: string
    content: string
}

/**
 * The legacy's `scanRecentOutputForPresentNpcs`: every NPC entry whose label the
 * narration names, once per character; an entry recorded on the agent's last
 * pass needs its whole name, since a first name alone was how a freshly recorded
 * stranger walked into every scene.
 */
export function presentNpcs(narration: string, entries: readonly SceneEntry[], recentlyRecorded: ReadonlySet<string> = new Set()): PresentNpc[] {
    const text = narration.trim()
    if (!text) return []
    const seen = new Set<string>()
    const matched: PresentNpc[] = []
    for (const entry of entries) {
        const label = sceneLabel(entry.comment)
        if (!label) continue
        if (!narrativeMentionsNpc(text, label, { requireFullName: recentlyRecorded.has(entry.id) })) continue
        const key = sceneCharacterKey(label)
        if (seen.has(key)) continue
        seen.add(key)
        matched.push({ id: entry.id, label, content: entry.content.trim() })
    }
    return matched
}

/**
 * The scan over a window of replies (Phase 52): every NPC any of them names,
 * once per character, ordered by how recently — `ago` is the index of the
 * newest reply that names them, 0 for the latest — and by the entries' order
 * within a reply. A character named in two replies is placed by the newer.
 */
export function presentNpcsOver(narrations: readonly string[], entries: readonly SceneEntry[], recentlyRecorded: ReadonlySet<string> = new Set()): Array<PresentNpc & { ago: number }> {
    const seen = new Set<string>()
    const matched: Array<PresentNpc & { ago: number }> = []
    narrations.forEach((narration, ago) => {
        for (const npc of presentNpcs(narration, entries, recentlyRecorded)) {
            const key = sceneCharacterKey(npc.label)
            if (seen.has(key)) continue
            seen.add(key)
            matched.push({ ...npc, ago })
        }
    })
    return matched
}

/** The key a place's picture is kept under in the chat's portraits. */
export function locationImageKey(storagePath: string): string {
    return `📍 ${normalizeLocationPath(storagePath)}`
}
