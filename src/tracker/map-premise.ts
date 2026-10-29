/**
 * The two defaults the map form opens with (71a), light enough for the
 * frontend: the premise the Auto brief and the Manual prompt start from,
 * read off a Location entry's prose, and the one-sentence brief description
 * read off a prompt. The legacy's `premiseFromLocationContent` and
 * `briefDescriptionFromPrompt` (`panel-builder.js` at the pin), transcribed
 * and pinned to their source. No import of the map library here: the panel
 * must not pull it into its bundle for two string helpers (lesson 54).
 */

/** The legacy's `MAP_SECTION_RE`, so a map section is cut the same way the library cuts it. */
const MAP_SECTION_RE = /\[MAP\]([\s\S]*?)\[\/MAP\]/i

/** The entry's prose without its map, the `[CORE]` tags gone, at most 1,200 characters. */
export function premiseFromLocationContent(content: string | null | undefined): string {
    return String(content ?? '')
        .replace(MAP_SECTION_RE, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .replace(/\[\/?CORE\]/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, 1200)
}

/** The prompt's first sentence; `<site> is a mapped location.` when the prompt is empty. */
export function briefDescriptionFromPrompt(prompt: string | null | undefined, site = ''): string {
    const text = String(prompt ?? '').replace(/\s+/g, ' ').trim()
    if (!text) return site ? `${site} is a mapped location.` : ''
    return text.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || text
}
