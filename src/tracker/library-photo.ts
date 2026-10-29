/**
 * A library card's photo (Phase 60, roadmap row 60): the prompt that
 * describes an NPC for the image model, and the size the picture is asked
 * for.
 *
 * The prompt is the legacy's `generateNpcPortraitPrompt` (`portraits.js`),
 * transcribed piece by piece and pinned to the checkout by
 * `library-photo.pin.test.ts`, since the function is a closure over the
 * whole SillyTavern install: the NPC's name and its entry, joined as the
 * legacy joins them, under the cartridge's `portraitNpcSystemPrompt` with
 * its two placeholders filled. The legacy's story lookback (the persona,
 * the narrator's card, the recent scene) is behind a switch that is off by
 * default and is not a cartridge key, so a library card, which belongs to
 * no chat, is described from its entry alone, as the legacy's default does.
 *
 * The size is the maintainer's ask, not the legacy's: Multihog scales every
 * portrait to a 512 square (`scaleImageTo512Square`); a library photo here
 * is asked for in 2:3, portrait, at the pair of sides nearest the image
 * connection's own pixel count.
 */

/** The legacy's text, in the legacy's words (`portraits.js`, pinned). */
export const LIBRARY_PHOTO_TEXT = {
    name: (name: string) => `NPC Name: ${name}`,
    entry: (content: string) => `NPC Lorebook Entry:\n${content.trim()}`,
    separator: '\n\n---\n\n',
} as const

export interface LibraryPhotoPromptInput {
    name: string
    /** The card's identity text; empty, the name stands alone. */
    content: string
    /** The cartridge's `portraitNpcSystemPrompt`. */
    systemPrompt: string
    /** The cartridge's `portraitPromptWordTarget`. */
    wordTarget: number
}

/** The two prompts of the model call that writes the image prompt. */
export function buildLibraryPhotoPrompt(input: LibraryPhotoPromptInput): { system: string; user: string } {
    const parts = [LIBRARY_PHOTO_TEXT.name(input.name)]
    if (input.content.trim()) parts.push(LIBRARY_PHOTO_TEXT.entry(input.content))
    const system = input.systemPrompt
        .replace(/\{\{name\}\}/g, input.name)
        .replace(/\{\{wordtarget\}\}/g, String(input.wordTarget || 200))
    return { system, user: parts.join(LIBRARY_PHOTO_TEXT.separator) }
}

/**
 * The 2:3 sizes a photo may be asked in: every pair exact, both sides a
 * multiple of 64, which is what the diffusion models behind an image
 * connection want. Smallest first.
 */
export const PORTRAIT_SIZES: ReadonlyArray<readonly [number, number]> = [
    [512, 768],
    [640, 960],
    [768, 1152],
    [896, 1344],
    [1024, 1536],
]

/** One provider parameter as the host's schema describes it. */
export interface ProviderParameter {
    type: string
    options?: Array<{ id: string; label: string }>
}

export interface PortraitSizeChoice {
    /** What to merge into the draw's parameters; empty when no size could be asked for. */
    parameters: Record<string, unknown>
    /** The size in words for the note and the log (`896×1344`), `''` when none was asked. */
    size: string
    /** Why no size was asked, when none was. */
    reason?: string
}

const positive = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null)

/**
 * The size to ask a connection for, in 2:3.
 *
 * A provider that takes `width` and `height` (the schema says so; without a
 * schema, the connection's own saved sizes say so) is asked for the pair
 * nearest its own pixel count — a 1024-square connection draws 896×1344. A
 * provider that takes a `size` from a list is asked for the listed portrait
 * size nearest 2:3. Any other is asked for nothing, and the note says the
 * picture came at the connection's own size.
 */
export function portraitSize(schema: Record<string, ProviderParameter> | null, defaults: Record<string, unknown>): PortraitSizeChoice {
    const width = positive(defaults.width)
    const height = positive(defaults.height)
    const takesSides = schema ? 'width' in schema && 'height' in schema : width !== null && height !== null
    if (takesSides) {
        const target = (width ?? 1024) * (height ?? 1024)
        let best = PORTRAIT_SIZES[0]!
        for (const pair of PORTRAIT_SIZES) {
            if (Math.abs(pair[0] * pair[1] - target) < Math.abs(best[0] * best[1] - target)) best = pair
        }
        return { parameters: { width: best[0], height: best[1] }, size: `${best[0]}×${best[1]}` }
    }
    const listed = schema?.size?.options ?? []
    let chosen: { id: string; off: number } | null = null
    for (const option of listed) {
        const match = /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i.exec(option.id) ?? /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i.exec(option.label)
        if (!match) continue
        const w = Number(match[1])
        const h = Number(match[2])
        if (!(w > 0 && h > w)) continue
        const off = Math.abs(w / h - 2 / 3)
        if (!chosen || off < chosen.off) chosen = { id: option.id, off }
    }
    if (chosen) return { parameters: { size: chosen.id }, size: chosen.id }
    return { parameters: {}, size: '', reason: listed.length ? 'the provider lists no portrait size' : 'the provider takes no width and height' }
}
