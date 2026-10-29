/**
 * Stepping back through the tracker's own past, and choosing one to restore.
 *
 * The maintainer's request, and their example is the whole specification: a
 * chat is 83 messages long, someone deletes 81, 82 and 83, and you want to step
 * back three views and press restore.
 *
 * Half of this already existed for a different reason. Phase 6 stores the memo
 * after every tracked turn — fifty deep, in `chats/<id>/memo-history.json` —
 * because the card under each message needed to know what was true *then*. What
 * was missing is the reading of it.
 *
 * **A note on the legacy, which worked differently.** Multihog had no cards
 * under messages: its tracker lived in the side panel and the history existed
 * only for this stepping. Here one store feeds both, so stepping and restoring
 * must not touch it — a restore writes the live memo and leaves the history
 * alone, and the cards go on saying what they said.
 *
 * Two rules from the legacy are kept:
 *
 *  - **A position, not a copy.** Viewing history is a cursor over the stored
 *    snapshots; nothing is written until a restore.
 *  - **Restore does not archive the memo it replaces.** The history already
 *    holds a snapshot for every tracked turn, including the current one, so
 *    writing another would push the oldest off the end for nothing.
 */

/** One stored state, as the panel receives it. */
export interface HistoryEntry {
    /** The message this is the state *after*. */
    messageId: string
    memo: string
    /** When the pass wrote it, ISO 8601. Possibly empty. */
    at: string
    /**
     * The host's own number for the message — the `#22` it prints on the bubble.
     *
     * The clock time alone cannot match a state to a message: a pass runs
     * *after* the reply it reads and then takes a model call, so its stamp is
     * routinely a minute past the message's. The number is exact — and it is
     * read from the host, never derived, because the first version counted
     * positions and named the message after the one it meant.
     *
     * Absent on snapshots recorded before this was stored. Zero is valid.
     */
    messageNumber?: number
}

/** Viewing the live memo rather than any snapshot. */
export const LIVE = -1

/** Where the stepper is, and what it should show. */
export interface HistoryPosition {
    /** Index into the snapshots, or `LIVE`. */
    index: number
    /**
     * How many turns back this is — one press of Older is `1`.
     *
     * Not the index: whether the newest snapshot was skipped depends on the
     * live memo, so counting the index would make the first press read as
     * `1 turn back` sometimes and `0 turns back` at others.
     */
    turnsBack: number
    /** Whether stepping further back is possible. */
    canGoBack: boolean
    /** Whether stepping forward is possible. */
    canGoForward: boolean
    /** The snapshot being viewed, or `null` when live. */
    entry: HistoryEntry | null
}

/**
 * The first snapshot that is genuinely in the past, given what is live now.
 *
 * `snapshots[0]` is normally the memo as it stood after the newest tracked
 * turn, which *is* the live memo — so stepping onto it looked like the button
 * had not worked. 10a skipped it by position, and that turned out to be an
 * assumption about the relationship between two separate stores rather than a
 * fact: when the newest turn had not been recorded, the skip ate a real state
 * and the walk jumped from 31 straight past 29 to 27.
 *
 * So it is decided by *comparison* instead. If the newest snapshot is the live
 * memo it is skipped; if it is not, it is a state worth showing and nothing is
 * skipped.
 *
 * Only ever the newest, never a run of them: a pass that changed nothing
 * records a memo identical to the one before it, and those are real turns.
 * Skipping every match would hide them.
 */
export function firstPastIndex(snapshots: readonly HistoryEntry[], liveMemo: string): number {
    if (!snapshots.length) return 0
    return snapshots[0]!.memo === liveMemo ? 1 : 0
}

/**
 * Move the cursor.
 *
 * `back` walks into the past and `forward` towards the present, returning to
 * `LIVE` rather than stopping short of it.
 *
 * Both directions clamp. A cursor that can run off either end of a list which
 * grows under it — every tracked turn pushes a new snapshot in — is a cursor
 * that will eventually point at nothing.
 */
export function stepHistory(
    snapshots: readonly HistoryEntry[],
    index: number,
    direction: 'back' | 'forward',
    liveMemo: string,
): number {
    const first = firstPastIndex(snapshots, liveMemo)
    if (snapshots.length <= first) return LIVE

    const step = direction === 'back' ? 1 : -1
    // LIVE sits one before the first past state, so back from it lands there
    // and forward from there returns to it.
    const next = (index === LIVE ? first - 1 : index) + step

    if (next < first) return LIVE
    return Math.min(next, snapshots.length - 1)
}

/** Read the cursor: what is on screen, and which way it can move. */
export function readPosition(
    snapshots: readonly HistoryEntry[],
    index: number,
    liveMemo: string,
): HistoryPosition {
    const first = firstPastIndex(snapshots, liveMemo)
    const hasPast = snapshots.length > first
    const at = index === LIVE
        ? LIVE
        : Math.min(Math.max(first, Math.floor(index)), snapshots.length - 1)
    const live = at === LIVE || !hasPast

    return {
        index: live ? LIVE : at,
        // How many presses of Older it took to get here, which is what the
        // label means by a turn. Counted from the first past state rather than
        // from zero, so it reads the same whether or not the newest snapshot
        // was skipped.
        turnsBack: live ? 0 : at - first + 1,
        canGoBack: live ? hasPast : at < snapshots.length - 1,
        canGoForward: !live,
        entry: live ? null : snapshots[at] ?? null,
    }
}

/**
 * How far back a snapshot is, in words.
 *
 * Counted in *turns* rather than by date, because "three back" is how the
 * request was phrased and how someone counts deleted messages. The clock time
 * rides along when there is one, for the same reason the pass report carries
 * one: it says *which* state this is, with the chat open beside the panel.
 */
export function describePosition(position: HistoryPosition, clock?: (iso: string) => string): string {
    if (!position.entry) return 'Live'

    const back = position.turnsBack
    const turns = `${back} turn${back === 1 ? '' : 's'} back`
    // The message number leads, because it is the part that matches exactly. A
    // pass runs after the reply it reads and takes a while, so its clock time
    // is routinely a minute past the message's and cannot be lined up by eye.
    // Compared against undefined, not truthiness: `#0` is a real message.
    const number = position.entry.messageNumber === undefined
        ? ''
        : `#${position.entry.messageNumber}`
    const stamp = position.entry.at && clock ? clock(position.entry.at) : ''

    return [number, turns, stamp].filter(Boolean).join(' · ')
}

/**
 * Find a snapshot by the message it belongs to.
 *
 * A restore names a *message*, never an index. The history is capped and every
 * tracked turn pushes a new entry in, so an index the panel read a minute ago
 * can point somewhere else by the time the button is pressed — and the thing it
 * would then overwrite the live memo with is nobody's choice.
 */
export function findByMessage(
    snapshots: readonly HistoryEntry[],
    messageId: string,
): HistoryEntry | null {
    if (!messageId) return null
    return snapshots.find((entry) => entry.messageId === messageId) ?? null
}

/**
 * The index of the newest state at or before a moment (47e-bis): the
 * memo as it stood after the pass that finished then. A pass that changed
 * something wrote a snapshot stamped with its own report's time, so the
 * match is exact; a pass that changed nothing wrote none, and the state
 * then was the one the pass before it left. `null` when every kept state
 * is newer than the moment: the one wanted has aged off the window.
 */
export function indexAt(snapshots: readonly HistoryEntry[], iso: string): number | null {
    const wanted = Date.parse(iso)
    if (!Number.isFinite(wanted)) return null
    for (let i = 0; i < snapshots.length; i += 1) {
        const at = Date.parse(snapshots[i]!.at)
        if (Number.isFinite(at) && at <= wanted) return i
    }
    return null
}
