/**
 * The Game System Wizard: a game system drafted by a model from a sentence.
 *
 * Multihog's README highlight *AI-powered game system creation* (roadmap row
 * 7). A game system is a bundle -- a GM section for the narrator and a
 * tracker module for the extractor -- and the wizard writes both halves from
 * a plain-language description ("hunger and thirst that drain over time"),
 * lets the user edit them, and saves them into the three cartridge keys the
 * editors already manage: `customSyspromptLibrary`, `customFields` and
 * `gameSystems`.
 *
 * What is the legacy's is the legacy's: `wizard-legacy.js` is *generated*
 * from the pinned source (`scripts/extract-wizard.mjs`, rule 3a-bis) and
 * holds the architect prompt, the worked example, the driver guidance, the
 * response parser, the tag helpers and the `{{user}}` shield, verbatim. This
 * file is the typed face over it, plus the parts the legacy did with I/O and
 * this build does purely: the revision and regeneration prompts, the user
 * prompt with its story and memo context, and the save bundle.
 *
 * Pure throughout. The model call is `backend/wizard.ts`; the screens are
 * `frontend/wizard-panel.ts`.
 */

import { getMarkerLibraryKeys, MARKER_TYPE_MAP } from './markers.js'
import { createWizardLegacy } from './wizard-legacy.js'

export type EffectOwner = 'tracker' | 'gm'

export interface WizardDrivers {
    time: boolean
    gmAnnotation: boolean
    statedFact: boolean
}

/** One drafted system, as the legacy's `parseWizardResponse` returns it. */
export interface WizardDraft {
    name: string
    icon: string
    needsTracker: boolean
    driverTime: boolean
    driverGmAnnotation: boolean
    driverStatedFact: boolean
    effectOwner: EffectOwner
    includeGm: boolean
    gmTag: string
    /** Wrapped in its `<tag>` already, as the library stores it. */
    gmContent: string
    trackerTag: string
    trackerLabel: string
    trackerIcon: string
    trackerContent: string
}

/** The rendering markers the wizard is told about: every base marker with its example. */
export function renderingHints(): string[] {
    return getMarkerLibraryKeys().map((key) => `((${key})) ${MARKER_TYPE_MAP[key]!.example}`)
}

const legacy = createWizardLegacy(renderingHints())

export const WIZARD_EXAMPLE_SYSTEMS: ReadonlyArray<{ label: string; text: string }> = legacy.WIZARD_EXAMPLE_SYSTEMS

/** The legacy's stock architect prompt, for the editor to show and the user to override. */
export function defaultWizardSystemPrompt(): string {
    return legacy.buildWizardSystemPrompt()
}

/** The architect prompt in force: the user's own text when they wrote one, else the stock. */
export function effectiveWizardSystemPrompt(override: string | null | undefined): string {
    const custom = (override ?? '').trim()
    return custom || legacy.buildWizardSystemPrompt()
}

/** The system prompt of the first draft: the architect prompt plus the worked example for the effect owner. */
export function buildDraftSystemPrompt(effectOwner: EffectOwner, override?: string | null): string {
    return legacy.composeWizardArchitectPrompt(effectiveWizardSystemPrompt(override), effectOwner)
}

const hints = (): string => renderingHints().join('\n  - ')

export function driversOf(draft: Pick<WizardDraft, 'driverTime' | 'driverGmAnnotation' | 'driverStatedFact'>): WizardDrivers {
    return legacy.normalizeDrivers(draft)
}

/**
 * The legacy's three regeneration prompts and its revision prompt, ported by
 * hand from `regenerateGmSection`, `regenerateTrackerModule`,
 * `regenerateBothHalves` and `iterateGameSystemDraft` -- the legacy assembles
 * them inside functions that also make the model call, so they cannot be
 * sliced. The guidance they embed is the generated legacy's.
 */
export function buildRegenerateSystemPrompt(
    which: 'gm' | 'tracker' | 'both',
    draft: Pick<WizardDraft, 'gmTag' | 'trackerTag' | 'effectOwner' | 'driverTime' | 'driverGmAnnotation' | 'driverStatedFact'>,
    override?: string | null,
): string {
    const base = buildDraftSystemPrompt(draft.effectOwner, override)
    const drivers = driversOf(draft)
    const gmTag = legacy.sanitizeSnakeTag(draft.gmTag)
    const trackerTag = legacy.sanitizeUpperTag(draft.trackerTag)
    if (which === 'gm') {
        return `${base}\n\n---\n\nCURRENT TASK: Rewrite ONLY the GM-facing section for the mechanic described below. Return ONLY:\n<gm_section tag="${gmTag}">\n...instructions...\n</gm_section>\nNo explanation, no markdown fences, no other text. Reference {{user}} for the player. Be comprehensive but concise (10-30 lines).\n\nCRITICAL: Inner content must be SECOND PERSON (you/your) — direct instructions to the Narrator. Never write "The GM must" or any third-person reference to the narrator.\n\nCRITICAL: gm_section must NEVER track totals, restate current scores, or duplicate tracker accounting.\n\n${legacy.buildDriverGuidance(drivers, gmTag, trackerTag, draft.effectOwner)}`
    }
    if (which === 'tracker') {
        return `${base}\n\n---\n\nCURRENT TASK: Rewrite ONLY the tracker module instructions for the mechanic described below. Return ONLY:\n<tracker_module tag="${trackerTag}" label="Display Label" icon="emoji">\n...instructions, including a sample [${trackerTag}] ... [/${trackerTag}] format block using rendering markers like:\n  - ${hints()}\n</tracker_module>\nNo explanation, no markdown fences, no other text.\n\nCRITICAL: Inner content must be SECOND PERSON (you/your) — direct instructions to the State Tracker. Never write "The tracker maintains…", "The State Tracker must…", or any third-person reference to the tracker as an external entity.\n\nCRITICAL: This module EXCLUSIVELY owns running totals, bars, threshold tables, and tier labels — the gm_section must never duplicate this. When scanning for inline annotations, say "narrative output" / "the latest narrative output" — NEVER "GM's output" or "GM's narration".\n\n${legacy.buildDriverGuidance(drivers, '', trackerTag, draft.effectOwner)}`
    }
    return `${base}\n\n---\n\nCURRENT TASK: Rewrite BOTH halves of the mechanic described below so they are fully coherent with each other. Return ONLY:\n<gm_section tag="${gmTag}">\n...instructions...\n</gm_section>\n<tracker_module tag="${trackerTag}" label="Display Label" icon="emoji">\n...instructions, including a sample [${trackerTag}] ... [/${trackerTag}] format block using rendering markers like:\n  - ${hints()}\n</tracker_module>\nNo explanation, no markdown fences, no other text. Reference {{user}} for the player. Be comprehensive but concise (10-30 lines each).\n\nCRITICAL: gm_section inner content must be SECOND PERSON (you/your) — never "The GM must". CRITICAL: tracker_module inner content must ALSO be SECOND PERSON (you/your) addressing the State Tracker directly — never "The tracker maintains…". CRITICAL: gm_section must NEVER track totals, restate current scores, or duplicate tracker accounting — the tracker_module EXCLUSIVELY owns totals, bars, thresholds, and tier labels.\n\n${legacy.buildDriverGuidance(drivers, gmTag, trackerTag, draft.effectOwner)}\n\nSince both halves are generated together: magnitude/recovery guidance for restorative actions belongs ONLY in gm_section (rough common-sense guide). Tracker recovery must be "apply stated change, else common sense" — NEVER a duplicated Minor/Moderate/Major table. If effect_owner="gm", threshold numbers live in gm_section; the tracker still reports values/labels without restating mechanical effect prose.`
}

export function buildRevisionSystemPrompt(
    draft: Pick<WizardDraft, 'gmTag' | 'trackerTag' | 'effectOwner' | 'driverTime' | 'driverGmAnnotation' | 'driverStatedFact'>,
    includeTracker: boolean,
    override?: string | null,
): string {
    const base = buildDraftSystemPrompt(draft.effectOwner, override)
    const tag = legacy.sanitizeUpperTag(draft.trackerTag)
    const snakeTag = legacy.sanitizeSnakeTag(draft.gmTag)
    let outputFormat = `Return ONLY:\n<gm_section tag="${snakeTag}">\n...revised instructions...\n</gm_section>`
    if (includeTracker) {
        outputFormat += `\n<tracker_module tag="${tag}" label="Display Label" icon="emoji">\n...revised instructions, including a sample [${tag}] ... [/${tag}] format block using rendering markers like:\n  - ${hints()}\n</tracker_module>`
    }
    return `${base}\n\n---\n\nREVISION MODE: The user already has a draft game system and wants specific revisions — NOT a from-scratch rewrite. ${outputFormat}\nNo explanation, no markdown fences, no other text. Reference {{user}} for the player. Be comprehensive but concise (10-30 lines per half).\n\nCRITICAL: gm_section inner content must be SECOND PERSON (you/your) — never "The GM must". CRITICAL: tracker_module inner content must ALSO be SECOND PERSON (you/your) addressing the State Tracker directly — never "The tracker maintains…". CRITICAL: gm_section must NEVER track totals, restate current scores, or duplicate tracker accounting.\n\n${legacy.buildDriverGuidance(driversOf(draft), snakeTag, tag, draft.effectOwner)}\n\nITERATION RULES:\n- Preserve everything in the current draft that the user did NOT ask to change.\n- Apply the user's feedback precisely. Magnitude/recovery guides belong only in gm_section; tracker recovery stays "stated change, else common sense" — never duplicate a magnitude table into the tracker. If thresholds or annotation formats change, keep the effect-owner split coherent across halves.\n- Do not rename tags unless the user explicitly asks to.\n- Never output the literal placeholder text "YOUR_TAG" or a bare standalone "TAG" — use the actual tracker tag (${tag}).`
}

/** The current draft as the revision prompt quotes it back. */
export function currentDraftText(draft: Pick<WizardDraft, 'gmTag' | 'gmContent' | 'trackerTag' | 'trackerContent' | 'trackerLabel'>, includeTracker: boolean): string {
    const snakeTag = legacy.sanitizeSnakeTag(draft.gmTag)
    const tag = legacy.sanitizeUpperTag(draft.trackerTag)
    let text = `<gm_section tag="${snakeTag}">\n${draft.gmContent}\n</gm_section>`
    if (includeTracker && draft.trackerContent.trim()) {
        text += `\n<tracker_module tag="${tag}" label="${draft.trackerLabel || tag}">\n${draft.trackerContent}\n</tracker_module>`
    }
    return text
}

export interface WizardStoryMessage {
    role: 'user' | 'assistant' | 'system' | string
    name?: string
    content: string
}

/**
 * The story the wizard may read, the legacy's way: `USER (name):` and
 * `ASSISTANT (name):` blocks of the last `lookback` non-system messages. Zero
 * reads none.
 */
export function storyContext(messages: readonly WizardStoryMessage[], lookback: number, all = false): string {
    // Every message (73g, the legacy's lookbackAll) outranks the count; a count of 0 reads none.
    if (!all && !(lookback > 0)) return ''
    const eligible = messages.filter((m) => m.role !== 'system' && String(m.content ?? '').trim())
    return (all ? eligible : eligible.slice(-Math.floor(lookback)))
        .map((m) => {
            const role = m.role === 'user' ? 'USER' : 'ASSISTANT'
            const name = String(m.name ?? '').trim()
            return `${role}${name ? ` (${name})` : ''}:\n${String(m.content).trim()}`
        })
        .join('\n\n')
}

/** The user message: the optional context blocks in the legacy's order — module examples, story, lore, memo — then the task. */
export function buildWizardUserPrompt(input: { modules?: string; story?: string; lore?: string; memo?: string; task: string }): string {
    const parts: string[] = []
    if (input.modules?.trim()) parts.push(input.modules.trim())
    if (input.story?.trim()) {
        parts.push(`RECENT STORY CONTEXT (use only when relevant to the requested mechanic):\n<story_context>\n${input.story.trim()}\n</story_context>`)
    }
    if (input.lore?.trim()) parts.push(`ACTIVE LOREBOOK AGENT CONTEXT:\n<active_lore>\n${input.lore.trim()}\n</active_lore>`)
    if (input.memo?.trim()) parts.push(`CURRENT STATE TRACKER MEMO:\n<state_memo>\n${input.memo.trim()}\n</state_memo>`)
    parts.push(input.task)
    return parts.join('\n\n')
}

/** `{{user}}` in and out of a prompt, so macro resolution cannot bake a name in. */
export const shieldUserMacro: (text: string) => string = legacy.shieldUserMacro
export const restoreUserMacro: (text: string, names?: string[]) => string = legacy.restoreUserMacro

/** One model reply into a draft. Throws when neither half is there. */
export function parseWizardResponse(raw: string, names: string[] = []): WizardDraft {
    return legacy.parseWizardResponse(raw, names) as WizardDraft
}

/** A revision or regeneration reply: the halves it carries. */
export function parseWizardHalves(
    raw: string,
    names: string[] = [],
): { gmTag?: string; gmContent?: string; trackerTag?: string; trackerContent?: string; trackerLabel?: string; trackerIcon?: string } {
    type Block = { attrs: Record<string, string>; content: string } | null
    const gm = legacy.extractTagBlock(raw, 'gm_section') as Block
    const tracker = legacy.extractTagBlock(raw, 'tracker_module') as Block
    const out: ReturnType<typeof parseWizardHalves> = {}
    if (gm) {
        const gmTag = legacy.sanitizeSnakeTag(gm.attrs.tag || '')
        out.gmTag = gmTag
        out.gmContent = legacy.restoreUserMacro(legacy.normalizeGmContent(gmTag, gm.content), names)
    }
    if (tracker) {
        out.trackerTag = legacy.sanitizeUpperTag(tracker.attrs.tag || '')
        out.trackerContent = legacy.restoreUserMacro(tracker.content, names)
        out.trackerLabel = tracker.attrs.label || ''
        out.trackerIcon = tracker.attrs.icon || ''
    }
    return out
}

export const sanitizeSnakeTag: (s: string) => string = legacy.sanitizeSnakeTag
export const sanitizeUpperTag: (s: string) => string = legacy.sanitizeUpperTag
export const normalizeGmContent: (tag: string, content: string) => string = legacy.normalizeGmContent
export const unwrapManagedSectionContent: (tag: string, content: string) => string = legacy.unwrapManagedSectionContent
/** The sample `[TAG]…[/TAG]` block out of a tracker module, for the field's template. */
export const extractWizardTemplate: (trackerContent: string, trackerTag: string) => string = legacy.extractGameSystemWizardTemplate
/** The sample block as a one-block memo, `[TAG]\n…\n[/TAG]`, for the wizard's live card (73e); empty when the module holds no block. */
export const buildWizardPreviewMemo: (trackerContent: string, trackerTag: string) => string = legacy.buildGameSystemWizardPreviewMemo

/**
 * What the tracker is told right after a system is saved switched on.
 *
 * The automatic pass after a reply is asked for *changed* sections only, in
 * Multihog and here, so a module switched on mid-campaign never appears on
 * its own -- the maintainer had to ask for it by hand in Multihog every time,
 * and did again here (Phase 32a). This is that ask, made for them: an
 * instructed pass, whose closing line allows new sections.
 */
export function seedInstruction(draft: Pick<WizardDraft, 'name' | 'trackerTag'>): string {
    const tag = legacy.sanitizeUpperTag(draft.trackerTag)
    return `The game system "${draft.name.trim() || tag}" was just switched on. Its tracker module [${tag}] is not in the state yet. Create the [${tag}] block now, in exactly the format its module instructions give, with starting values judged from the story so far. Leave every other block alone.`
}

// ── saving ──────────────────────────────────────────────────────────────

export interface WizardSaveTarget {
    customSyspromptLibrary: Array<Record<string, unknown>>
    customFields: Array<Record<string, unknown>>
    gameSystems: Array<Record<string, unknown>>
    /** The module switches (73g), read for the picker's options and never written. */
    modules?: Record<string, boolean>
    syspromptModules?: Record<string, boolean>
}

export interface WizardSaveOptions {
    /** The system being edited, or none for a new one. */
    existingId?: string | null
    /** Switch both halves on (`apply`) or save them off. */
    enabled: boolean
    /** The sentence the system was drafted from, kept on the record. */
    description?: string
    /** For the record's `id` and `createdAt`; tests pin it. */
    now?: () => number
}

const STOCK_BLOCK_TAGS = ['COMBAT', 'CHARACTER', 'PARTY', 'INVENTORY', 'ABILITIES', 'SPELLS', 'XP', 'TIME']

/**
 * The three keys after a save, from the three keys before it.
 *
 * The legacy's `saveGameSystemFromPreview`, made pure: it returns the new
 * lists rather than writing settings. A GM half becomes a library entry
 * (`origin: 'wizard'`, wrapped in its tag, unique tag), a tracker half a
 * custom field (`origin: 'wizard'`, its sample block as the template, a tag
 * unique among fields and the stock blocks), and the system record joins
 * the two. An edit updates the linked entries in place; unticking a half on
 * an edit removes its entry. The narrator's section order needs nothing:
 * the rulebook slots a new library entry in before `<constraints>` on its
 * own, and the renderer draws an unordered block after the ordered ones.
 */
export function buildSaveBundle(draft: WizardDraft, before: WizardSaveTarget, options: WizardSaveOptions): WizardSaveTarget {
    const now = options.now ?? Date.now
    const library = before.customSyspromptLibrary.map((e) => ({ ...e }))
    const fields = before.customFields.map((f) => ({ ...f }))
    const systems = before.gameSystems.map((s) => ({ ...s }))
    const enabled = options.enabled
    const existing = options.existingId ? systems.find((s) => s.id === options.existingId) : undefined
    const stamp = now()

    let syspromptLibraryId = (existing?.syspromptLibraryId as string | undefined) ?? null
    if (draft.includeGm) {
        const item = syspromptLibraryId ? library.find((p) => p.id === syspromptLibraryId) : undefined
        if (item) {
            item.tag = draft.gmTag
            item.content = legacy.normalizeGmContent(draft.gmTag, draft.gmContent)
            item.description = `Game System: ${draft.name}`
            item.enabled = enabled
        } else {
            const isTaken = (tag: string): boolean => library.some((p) => p.tag === tag)
            const finalTag = legacy.uniqueTag(draft.gmTag, isTaken)
            const id = String(stamp)
            library.push({
                id,
                tag: finalTag,
                content: legacy.normalizeGmContent(finalTag, draft.gmContent),
                enabled,
                icon: 'fa-hat-wizard',
                description: `Game System: ${draft.name}`,
                origin: 'wizard',
                scope: 'chat',
            })
            syspromptLibraryId = id
        }
    } else if (syspromptLibraryId) {
        const gone = syspromptLibraryId
        library.splice(0, library.length, ...library.filter((p) => p.id !== gone))
        syspromptLibraryId = null
    }

    let customFieldTag = (existing?.customFieldTag as string | undefined) ?? null
    if (draft.needsTracker) {
        const field = customFieldTag ? fields.find((f) => String(f.tag).toUpperCase() === customFieldTag) : undefined
        if (field) {
            field.label = draft.trackerLabel
            field.icon = draft.trackerIcon
            field.prompt = draft.trackerContent
            field.template = legacy.extractGameSystemWizardTemplate(draft.trackerContent, draft.trackerTag)
            field.enabled = enabled
            field.origin = 'wizard'
        } else {
            const isTaken = (tag: string): boolean =>
                fields.some((f) => String(f.tag).toUpperCase() === tag) || STOCK_BLOCK_TAGS.includes(tag)
            const finalTag = legacy.uniqueTag(draft.trackerTag, isTaken)
            fields.push({
                tag: finalTag,
                label: draft.trackerLabel,
                icon: draft.trackerIcon,
                prompt: draft.trackerContent,
                template: legacy.extractGameSystemWizardTemplate(draft.trackerContent, draft.trackerTag),
                enabled,
                origin: 'wizard',
                scope: 'chat',
            })
            customFieldTag = finalTag
        }
    } else if (customFieldTag) {
        const gone = customFieldTag
        fields.splice(0, fields.length, ...fields.filter((f) => String(f.tag).toUpperCase() !== gone))
        customFieldTag = null
    }

    const record = {
        name: draft.name,
        icon: draft.icon,
        enabled,
        needsTracker: draft.needsTracker,
        driverTime: draft.driverTime,
        driverGmAnnotation: draft.driverGmAnnotation,
        driverStatedFact: draft.driverStatedFact,
        effectOwner: draft.effectOwner,
        syspromptLibraryId,
        customFieldTag,
    }
    if (existing) {
        Object.assign(existing, record, { description: options.description || existing.description || '' })
    } else {
        systems.push({ id: String(stamp), scope: 'chat', ...record, description: options.description || '', createdAt: stamp })
    }
    return { customSyspromptLibrary: library, customFields: fields, gameSystems: systems }
}

/** An existing system as a draft, for the editor: its halves read back from the two lists. */
export function draftFromSystem(system: Record<string, unknown>, target: WizardSaveTarget): WizardDraft {
    const lib = system.syspromptLibraryId
        ? target.customSyspromptLibrary.find((p) => p.id === system.syspromptLibraryId)
        : undefined
    const tag = String(system.customFieldTag ?? '').toUpperCase()
    const field = tag ? target.customFields.find((f) => String(f.tag).toUpperCase() === tag) : undefined
    const drivers = legacy.normalizeDrivers(system)
    const name = String(system.name ?? '')
    return {
        name,
        icon: String(system.icon ?? ''),
        needsTracker: system.needsTracker !== false && (!!field || system.needsTracker === true),
        driverTime: drivers.time,
        driverGmAnnotation: drivers.gmAnnotation,
        driverStatedFact: drivers.statedFact,
        effectOwner: system.effectOwner === 'gm' ? 'gm' : 'tracker',
        includeGm: !!lib,
        gmTag: String(lib?.tag ?? legacy.sanitizeSnakeTag(name)),
        gmContent: String(lib?.content ?? ''),
        trackerTag: String(field?.tag ?? legacy.sanitizeUpperTag(name)).toUpperCase(),
        trackerLabel: String(field?.label ?? name),
        trackerIcon: String(field?.icon ?? system.icon ?? ''),
        trackerContent: String(field?.prompt ?? ''),
    }
}
