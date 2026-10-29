/**
 * The Map Themes (roadmap row 74, Phase 74g): the typed face over the
 * twentieth generated file, Multihog's `src/state/map-themes.js` sliced
 * whole. The grammar is the legacy's — the twenty-two colour fields in
 * their four groups, the Ember default, the five factory presets, the
 * normalisers, the preset resolver and the applier of the twenty-nine
 * `--rt-map-*` variables — and this file only types it and adds the one
 * AdventureTime rule: the canvas image may be an address in the host's image
 * store (74d, departure 125), which the legacy's normaliser would drop,
 * since it keeps only `data:image/` and `http(s)://` sources.
 */
import { createMapThemesLegacy } from './map-themes-legacy.js'
import { resolvePortraitSrc } from './portraits.js'

export type MapThemeColorKey =
    | 'background' | 'textbox' | 'frame'
    | 'node' | 'nodeDiscovered' | 'nodeFog' | 'text' | 'textMuted' | 'accent'
    | 'route' | 'routeLocked' | 'routeBlocked'
    | 'creature' | 'group' | 'trap' | 'hazard' | 'alarm' | 'barrier' | 'object' | 'loot' | 'effect' | 'other'

export type MapTheme = Record<MapThemeColorKey, string> & {
    /** The canvas image: `data:image/…`, `http(s)://…`, or (AdventureTime) an address in the host's store; `''` for none. */
    backgroundImage: string
    /** How opaque the canvas colour is over the image, 0–100 (the legacy's 55). */
    backgroundImageStrength: number
}

export interface MapThemeField {
    key: MapThemeColorKey
    label: string
    group: 'Map' | 'Areas' | 'Routes' | 'Assets'
}

export interface MapThemePreset {
    id: string
    name: string
    theme: MapTheme
}

interface Legacy {
    MAP_THEME_FIELDS: ReadonlyArray<MapThemeField>
    DEFAULT_MAP_THEME: Readonly<MapTheme>
    FACTORY_MAP_THEME_PRESETS: ReadonlyArray<Readonly<MapThemePreset>>
    normalizeMapTheme(value: unknown): MapTheme
    normalizeSavedMapThemePresets(value: unknown): Record<string, MapTheme>
    resolveMapThemePreset(id: unknown, savedPresets?: Record<string, unknown>): MapTheme | null
    applyMapThemeToRoot(theme: unknown, root?: { style: { setProperty(name: string, value: string): void } } | null): void
}

const legacy = createMapThemesLegacy() as unknown as Legacy

/** The twenty-two colour fields, in the legacy's order and groups. */
export const MAP_THEME_FIELDS: ReadonlyArray<MapThemeField> = legacy.MAP_THEME_FIELDS
/** Ember: the legacy's default, and the fallback every rule of the map's stylesheet carries. */
export const DEFAULT_MAP_THEME: Readonly<MapTheme> = legacy.DEFAULT_MAP_THEME
/** The five factory presets: Ember, Blueprint, Verdant, Parchment, Blue & White. */
export const FACTORY_MAP_THEME_PRESETS: ReadonlyArray<Readonly<MapThemePreset>> = legacy.FACTORY_MAP_THEME_PRESETS
/** The active preset id Multihog ships with. */
export const DEFAULT_MAP_THEME_PRESET_ID = 'factory:ember'

/** The legacy's normaliser: every colour a lowercase six-digit hex or the default's, the image kept only as `data:image/` or `http(s)://`, the strength 0–100. */
export const normalizeMapTheme = (value: unknown): MapTheme => legacy.normalizeMapTheme(value)
/** The legacy's: at most a hundred presets, names up to eighty characters, the prototype's names refused, each theme normalised. */
export const normalizeSavedMapThemePresets = (value: unknown): Record<string, MapTheme> => legacy.normalizeSavedMapThemePresets(value)
/** The legacy's: a factory id or `user:<name>` to its theme, normalised; null for anything else. */
export const resolveMapThemePreset = (id: unknown, savedPresets: Record<string, unknown> = {}): MapTheme | null => legacy.resolveMapThemePreset(id, savedPresets)
/** The legacy's applier: the twenty-nine `--rt-map-*` variables written on the root's style. */
export const applyMapThemeToRoot = (theme: unknown, root: { style: { setProperty(name: string, value: string): void } }): void => legacy.applyMapThemeToRoot(theme, root)

/**
 * The canvas image as AdventureTime keeps it: the legacy's two sources, or an
 * address in the host's image store (one `resolvePortraitSrc` accepts); any
 * other scheme, and anything another origin dressed as a path, is dropped.
 */
export function readMapThemeImage(value: unknown): string {
    const source = String(value ?? '').trim()
    if (!source) return ''
    if (source.startsWith('data:image/') || /^https?:\/\//i.test(source)) return source
    return resolvePortraitSrc(source) ? source : ''
}

/** The legacy's normaliser with AdventureTime's image rule. */
export function readMapTheme(value: unknown): MapTheme {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
    return { ...normalizeMapTheme(source), backgroundImage: readMapThemeImage(source.backgroundImage) }
}

/** The legacy's saved-presets normaliser with AdventureTime's image rule, name for name. */
export function readSavedMapThemePresets(value: unknown): Record<string, MapTheme> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const normalized: Record<string, MapTheme> = {}
    for (const [rawName, theme] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
        const name = String(rawName || '').trim().slice(0, 80)
        if (!name || name === '__proto__' || name === 'constructor' || name === 'prototype') continue
        normalized[name] = readMapTheme(theme)
    }
    return normalized
}

/** A preset id as stored: a string, else the empty id (Custom). */
export function readMapThemePresetId(value: unknown): string {
    return typeof value === 'string' ? value : ''
}

/** The name a preset id shows: a factory preset's, a saved one's, or null for Custom and the unknown. */
export function mapThemePresetName(id: string, saved: Record<string, unknown> = {}): string | null {
    const factory = FACTORY_MAP_THEME_PRESETS.find((preset) => preset.id === id)
    if (factory) return factory.name
    if (id.startsWith('user:') && Object.prototype.hasOwnProperty.call(saved, id.slice(5))) return id.slice(5)
    return null
}
