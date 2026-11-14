/**
 * The image prompt prefix (Phase 94a, roadmap row 94): the first ask from
 * the public beta, 2026-11-07. A Stable Diffusion family model often needs
 * a tag on every prompt — a LoRA such as `<lora:name:1>`, a trigger word, a
 * quality tag — and AdventureTime's image prompts are written by a text model
 * from the three portrait templates, which cannot be relied on to copy a
 * tag exactly. So the prefix is put in front by code, at the moment of the
 * draw, on every picture AdventureTime draws: the portraits in play, the
 * library's photos, the location pictures, pressed or on their own. The
 * prompt editor (73f) shows the prompt without it and says so; the picture
 * is drawn with it.
 *
 * One preference, `imagePromptPrefix`, blank as it ships: blank, nothing
 * changes anywhere. A prompt that already opens with the prefix (an edited
 * prompt the user put it into by hand) is not given it twice.
 */

/** As long as a prefix may be: a LoRA stack is a few tags, not a paragraph. */
export const MAX_IMAGE_PROMPT_PREFIX = 500

/** The preference read defensively: a trimmed string, capped, or blank. */
export function readImagePromptPrefix(value: unknown): string {
    if (typeof value !== 'string') return ''
    return value.trim().slice(0, MAX_IMAGE_PROMPT_PREFIX)
}

/**
 * The prompt as it is drawn: the prefix, a space, the prompt — or the prompt
 * alone when the prefix is blank or the prompt already opens with it.
 */
export function prefixImagePrompt(prefix: unknown, prompt: string): string {
    const head = readImagePromptPrefix(prefix)
    const body = (prompt ?? '').trim()
    if (!head) return body
    if (!body) return head
    if (body.startsWith(head)) return body
    return `${head} ${body}`
}
