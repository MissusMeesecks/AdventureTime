/**
 * Which turn produced a lore entry.
 *
 * The maintainer's request: *"make sure each lorebook update includes which
 * turn spawned it — this can help continuity"*. Open a book in Lumiverse's
 * editor and, before this, nothing said which turn made an entry or that
 * AdventureTime made it at all.
 *
 * **It goes in the entry's title, and that took a correction.**
 * `docs/INVESTIGATION-LOREBOOK-MEMORY.md` proposed the `comment` field on the
 * assumption it was free text nobody used. It is not: `comment` *is* the entry
 * title — `writer.ts` writes the model's label straight into it. Writing
 * provenance there naively would have replaced every entry's name with a
 * timestamp.
 *
 * The other candidates lose on purpose:
 *
 * - `content` is sent to the narrator, so provenance there costs tokens on
 *   every activation and puts bookkeeping inside the lore itself.
 * - `automation_id` is undocumented, belongs to something else, and — fatally —
 *   is not visible in the editor, which is the one place the stamp needs to be.
 *
 * So it is a suffix on the title, which is what a user scanning a book actually
 * reads. Three rules keep that safe:
 *
 * 1. **The number comes from the host.** `index_in_chat` is the `#31` printed on
 *    the message bubble. Phase 10b was exactly this mistake made the other way —
 *    a number *derived* by counting position, off by one, caught only because
 *    the maintainer knew their own chat.
 * 2. **A pass that cannot place itself writes no stamp**, rather than a guessed
 *    one. Phase 10a's rule, same reason.
 * 3. **Stamps never stack.** A rename carries the original forward rather than
 *    appending a second, so an entry the agent revises ten times has one stamp,
 *    naming the turn that created it.
 *
 * **The title stamp is gone since 73a** (departure 11, the maintainer's
 * decision of 2026-10-21): a title is a name, and every reader that turned
 * one back into a name tripped on the stamp in turn — the world's dossiers
 * (33c), the relationship resolver (65-ter), + MAP (71d-ter, lesson 64), the
 * portraits' roster. The prose stamp stays, where Multihog writes its own
 * `[Day 4]`. `stampLabel` and `carryStamp` now give a plain name and strip
 * any stamp the label or the entry carried, so an old entry loses its stamp
 * the first time the agent renames it; the readers keep `stripStamp` for
 * the titles written before.
 */

/** A message as the host reports it, for the one field we need. */
export interface NumberedMessage {
    index_in_chat?: unknown
}

/**
 * The number of the newest message, as the host prints it on the bubble.
 *
 * `null` when the chat is empty or the host does not report one — which is a
 * real case and not an error. An entry written by a pass that cannot place
 * itself simply carries no stamp.
 */
export function newestMessageNumber(messages: readonly NumberedMessage[]): number | null {
    const value = Number(messages.at(-1)?.index_in_chat)
    return Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * The stamp, and how to find one already there.
 *
 * Bracketed and anchored at the end so it can be removed exactly. `msg #` is
 * spelled out rather than left as a bare number because someone opening their
 * lorebook months later should not have to guess what `[31]` counts.
 */
const STAMP = /\s*\[msg #\d+\]\s*$/

/** An entry's own name, with any stamp taken off. */
export function stripStamp(comment: string): string {
    return (comment || '').replace(STAMP, '').trim()
}

/**
 * The same stamp, at the head of a line of prose rather than the end of a title.
 *
 * A title can only hold one number, so it records the turn that *created* the
 * entry. An entry revised across ten turns needs ten marks, and they have to
 * sit where the new prose does — which is what the maintainer asked for:
 * *"each lorebook update includes which turn spawned it."*
 *
 * This is the legacy's shape too. `applyCommit` already prefixes appended
 * content with `timePrefix`, the legacy's in-world time marker (`[Day 4] …`);
 * that is *story* time and this is *chat* position, so they are separate marks
 * and both are prefixes.
 */
const CONTENT_STAMP = /^\s*\[msg #\d+\]\s*/

/** Prose without a leading stamp, so one pass cannot stamp another's text twice. */
export function stripContentStamp(content: string): string {
    return (content || '').replace(CONTENT_STAMP, '')
}

/**
 * Mark a paragraph the agent is adding with the turn it came from.
 *
 * Unlike a title stamp this lands in `content`, which *is* sent to the
 * narrator — so it costs a few tokens on every activation. The legacy pays the
 * same price for its in-world time marker, and the alternative is an entry that
 * grows for twenty turns with no record of which turn added what.
 *
 * A model-supplied leading stamp is stripped first: it reads entries back on
 * later passes and will eventually echo one.
 */
export function stampContent(content: string, messageNumber: number | null): string {
    const prose = stripContentStamp(content)
    // Whitespace counts as nothing: a paragraph that is only a turn number is
    // not lore, and would read as one in the narrator's context.
    if (messageNumber === null || !prose.trim()) return prose
    return `[msg #${messageNumber}] ${prose}`
}

/**
 * The turn a piece of lore actually belongs to.
 *
 * **The number a pass can see is not the number the lore wants.** A pass that
 * reads messages 40 to 45 knows only that it ran at 45; if the Syndicate's
 * betrayal happened at 43, stamping it `#45` is wrong — and it was wrong for
 * everything the agent wrote until this existed.
 *
 * The only thing that knows is the *model*: it read the narrative and decided
 * what happened where. So it is asked, and its answer is checked rather than
 * trusted — the same shape as every other number here, one layer further out.
 * This project's oldest mistake is deriving a number instead of asking for it
 * (lessons 15, 16, and Phase 10b); the twist is that the thing to ask was not
 * the host.
 *
 * @param cited      what the model said, if anything
 * @param readRange  the messages this pass actually read, from the host
 */
export function resolveTurn(
    cited: number | null,
    readRange: readonly number[],
): number | null {
    if (readRange.length === 0) return null

    // A number the pass never read is not a citation, it is a guess with a
    // number on it — a model asked for a message id will occasionally invent
    // one, and an invented number is worse than none because it looks checked.
    if (cited !== null && readRange.includes(cited)) return cited

    // Nothing usable cited. If the pass read exactly one message then every
    // piece of lore it found came from that message — a deduction, not a
    // guess, so it is safe to fill in.
    if (readRange.length === 1) return readRange[0]!

    // Otherwise no stamp. Phase 10a's rule: a pass that cannot place something
    // says nothing rather than naming the wrong turn.
    return null
}

/** Whatever stamp a title already carries, or `''`. */
export function stampOn(comment: string): string {
    return (comment || '').match(STAMP)?.[0]?.trim() ?? ''
}

/**
 * Title an entry the agent is creating: the plain name (73a).
 *
 * Any stamp on the incoming label is stripped: the label comes from a model,
 * and a model shown stamped titles in the index will sooner or later write one
 * back. The turn is on the prose (`stampContent`); the title carries none.
 * The message number is still taken so every caller names the turn it has,
 * which is what the prose stamp needs.
 */
export function stampLabel(label: string, _messageNumber: number | null): string {
    return stripStamp(label)
}

/**
 * Re-title an entry (73a): the plain new name. A stamp the entry carried from
 * before 73a comes off with the rename; the turn that created it is on its
 * first paragraph, where it has been since Phase 18.
 */
export function carryStamp(newLabel: string, _existingComment: string): string {
    return stripStamp(newLabel)
}
