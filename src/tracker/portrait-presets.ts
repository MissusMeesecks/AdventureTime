/**
 * The art styles (Phase 63b, roadmap row 63): the typed face over the
 * seventeenth generated file, Multihog's Portrait Prompt Library
 * (`src/state/portrait-prompts.js`, sliced whole by
 * `scripts/extract-portrait-presets.mjs`).
 *
 * A style is three system prompts and a word target: the NPC's, the
 * character's and the location's, each with the style's art line folded
 * in, the location's in two variants — with the NPCs present in the
 * picture, or without. Loading a style writes the three into the
 * cartridge's prompt keys; a saved setup is the user's own three, kept
 * under a name in `savedPortraitPromptPresets`; `activePortraitPromptPresetId`
 * names which was loaded last and is cleared by an edit (the legacy's
 * rules, `index.js`). The location prompt follows the present-NPCs
 * toggle while it is still a shipped text, and never once edited.
 */

import { createPortraitPresetsLegacy } from './portrait-presets-legacy.js'

export interface PortraitPreset {
    id: string
    name: string
    description: string
    wordTarget?: number
    portraitArtStyle: string
    sceneArtStyle: string
}

/** The three prompts a style resolves to, with its word target. */
export interface PortraitPresetBundle {
    id: string
    name: string
    wordTarget: number
    npcSystemPrompt: string
    characterSystemPrompt: string
    locationSystemPrompt: string
}

/** A saved setup, as the legacy keeps it under its name. */
export interface SavedPortraitPreset {
    npcSystemPrompt?: string
    characterSystemPrompt?: string
    locationSystemPrompt?: string
    includePresentNpcs?: boolean
    wordTarget?: number
}

interface Legacy {
    DEFAULT_PORTRAIT_PROMPT_PRESET_ID: string
    FACTORY_PORTRAIT_PROMPT_PRESETS: PortraitPreset[]
    getFactoryPortraitPromptPreset(id?: string): PortraitPreset
    buildLocationPortraitSystemPrompt(sceneArtStyle: string, includePresentNpcs?: boolean): string
    resolveFactoryPortraitPromptBundle(presetOrId?: string | PortraitPreset, includePresentNpcs?: boolean): PortraitPresetBundle
    getDefaultPortraitLocationSystemPrompt(includePresentNpcs?: boolean, presetId?: string): string
    findShippedPortraitLocationPresetId(text: string): string | null
    isShippedPortraitLocationSystemPrompt(text: string): boolean
    getFactoryPortraitPromptPresetNameSet(): Set<string>
}

const legacy = createPortraitPresetsLegacy() as Legacy

/** `fantasy`: the Multihog factory default, and the Reset target. */
export const DEFAULT_PORTRAIT_PRESET_ID: string = legacy.DEFAULT_PORTRAIT_PROMPT_PRESET_ID

/** The seven factory art styles, in the legacy's order. */
export const FACTORY_PORTRAIT_PRESETS: readonly PortraitPreset[] = legacy.FACTORY_PORTRAIT_PROMPT_PRESETS

/** The style by id; an unknown id is the default, as the legacy reads it. */
export function factoryPortraitPreset(id?: string): PortraitPreset {
    return legacy.getFactoryPortraitPromptPreset(id)
}

/** True when the id names one of the seven. */
export function isFactoryPortraitPresetId(id: unknown): boolean {
    return typeof id === 'string' && FACTORY_PORTRAIT_PRESETS.some((p) => p.id === id)
}

/** The three prompts of a style, the location's in the variant the toggle asks for. */
export function resolvePortraitPresetBundle(id: string, includePresentNpcs: boolean): PortraitPresetBundle {
    return legacy.resolveFactoryPortraitPromptBundle(id, includePresentNpcs)
}

/** The location prompt a style ships, in the variant the toggle asks for. */
export function factoryLocationPrompt(includePresentNpcs: boolean, presetId: string = DEFAULT_PORTRAIT_PRESET_ID): string {
    return legacy.getDefaultPortraitLocationSystemPrompt(includePresentNpcs, presetId)
}

/** The style a location prompt still is, verbatim (either variant, or the two older fantasy texts); `null` once edited. */
export function findShippedLocationPresetId(text: string): string | null {
    return legacy.findShippedPortraitLocationPresetId(text)
}

/** True while a location prompt is still a shipped text, so the toggle may swap it. */
export function isShippedLocationPrompt(text: string): boolean {
    return legacy.isShippedPortraitLocationSystemPrompt(text)
}

/** True when a name is one of the seven styles' (case-blind): a saved setup may not take it. */
export function isFactoryPortraitPresetName(name: string): boolean {
    return legacy.getFactoryPortraitPromptPresetNameSet().has(name.trim().toLowerCase())
}

/**
 * The legacy's `syncPortraitLocationPromptForNpcToggle`: when the present-NPCs
 * toggle changes, the location prompt is swapped to the matching variant of
 * the style it still is — a shipped text, an older fantasy text, or an empty
 * box — and a prompt that has been edited is left alone. Returns the text
 * to store, or `null` when nothing should change.
 */
export function locationPromptForToggle(current: string, includePresentNpcs: boolean, activeId?: string): string | null {
    const text = typeof current === 'string' ? current : ''
    const styleId = findShippedLocationPresetId(text)
        || (isFactoryPortraitPresetId(activeId) ? activeId : null)
        || DEFAULT_PORTRAIT_PRESET_ID
    if (text.trim() && !isShippedLocationPrompt(text)) return null
    const next = factoryLocationPrompt(includePresentNpcs, styleId)
    return next === text ? null : next
}

/** The `user:Name` id a saved setup is active under. */
export function savedPresetId(name: string): string {
    return `user:${name}`
}
