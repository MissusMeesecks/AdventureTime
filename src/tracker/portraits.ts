/**
 * Which picture belongs to which entity.
 *
 * The lookup half of the legacy portrait system, ported from
 * `portrait-storage.js` at the pin. The legacy's other half — generating images
 * from prompts, auto-generating them per turn, migrating embedded data URLs into
 * files — is a much larger subsystem and is not here. What is here is the part
 * the cards need: given an entity as the *model wrote it*, find the portrait a
 * user set.
 *
 * That is not a dictionary lookup, and the reasons are recorded in the legacy's
 * own comments. A narrator writes `Alice (the innkeeper)` on one turn and
 * `ALICE` on the next; the same map is shared with the Lorebook Agent's cards,
 * which name entities their own way. So the key is the name with its
 * parenthetical stripped, and a miss falls back to a case- and accent-blind
 * comparison rather than giving up.
 *
 * `portraits.pin.test.ts` checks both functions against the legacy build over a
 * corpus of the shapes that actually appear.
 */

import { decodeHtml } from './html.js'

/**
 * The key a portrait is stored under.
 *
 * Entity labels reach here having been through the memo and, sometimes, HTML —
 * hence the decode. The parenthetical strip is what makes `Moth Wraith (a
 * construct of Wrenna's dream)` and `Moth Wraith` the same creature, which is the
 * difference between a portrait that appears in combat and one that never does.
 */
export function normalizeEntityName(name: string | null | undefined): string {
    if (!name) return ''
    return decodeHtml(String(name)).replace(/\s*\(.*?\)/g, '').trim()
}

/**
 * Find the portrait set for an entity, or `''`.
 *
 * Exact key first, then a case- and accent-insensitive sweep. The sweep is the
 * legacy behaviour and worth keeping: a narrator shouting `ALICE` in a combat
 * round should not lose the portrait set from `Alice`.
 */
export function lookupPortrait(
    portraits: Record<string, string> | null | undefined,
    name: string | null | undefined,
): string {
    const key = normalizeEntityName(name)
    if (!key || !portraits) return ''

    const exact = portraits[key]
    if (exact) return exact

    const loose = Object.entries(portraits).find(
        ([stored]) => normalizeEntityName(stored).localeCompare(key, undefined, { sensitivity: 'accent' }) === 0,
    )
    return loose?.[1] ?? ''
}

/**
 * A stored reference, as it should go into an `<img src>` — or `''` when it
 * must not go into one at all.
 *
 * The strings in this map came from a file on disk that a user can edit *and*
 * from whatever address the host handed back when it stored a picture, so the
 * renderer must not be the thing that decides. `javascript:` and every other
 * scheme are refused; what remains is a host path, an absolute http(s) URL and
 * an inline image.
 *
 * A host path with no leading slash is **rooted** rather than refused. That is
 * the one shape this check used to drop on the floor, and dropping it is
 * invisible: the panel draws the same empty square it draws for an entity
 * nobody has set a picture for. Left alone, a bare `api/v1/images/x` would
 * resolve against whatever route the app happens to be showing, which is a
 * different wrong answer; rooted, it means what the host meant.
 */
export function resolvePortraitSrc(src: string | null | undefined): string {
    const value = String(src ?? '').trim()
    if (!value) return ''

    if (/^https?:\/\//i.test(value)) return value
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) return value

    // Anything still carrying a scheme is refused outright: `javascript:` above
    // all, but there is no reason to trust any scheme not named above either.
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return ''

    // `//host/a.png` — and the backslash spelling some parsers accept — is
    // another origin wearing a relative URL's clothes.
    if (/^[/\\]{2}/.test(value)) return ''

    return value.startsWith('/') ? value : `/${value}`
}

/** Whether a stored reference is safe to put in an `<img src>`. */
export function isDrawablePortrait(src: string | null | undefined): boolean {
    return resolvePortraitSrc(src) !== ''
}

/**
 * Why an entity has no picture on screen, in words, or `''` when it has one.
 *
 * The view only needs the boolean; the *editor* needs this. A row drawn with an
 * empty square says "nobody set a picture here", and until now it said exactly
 * that whether nobody had set one or the address stored for it was one this
 * build refuses — two very different problems, one of them ours, wearing the
 * same face. That is how a portrait that never appeared went a whole phase
 * without a report.
 */
export function portraitProblem(stored: string | null | undefined): 'none' | 'unusable' | '' {
    const value = String(stored ?? '').trim()
    if (!value) return 'none'
    return resolvePortraitSrc(value) ? '' : 'unusable'
}

/** The portrait to draw for an entity: set, allowed, and ready for an `src`. */
export function portraitFor(
    portraits: Record<string, string> | null | undefined,
    name: string | null | undefined,
): string {
    return resolvePortraitSrc(lookupPortrait(portraits, name))
}
