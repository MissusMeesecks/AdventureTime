/**
 * When an agent pass should run on its own.
 *
 * The cadence is the legacy's — **every N replies, configurable** — and the pin
 * has the mechanism as well as the number.
 *
 * ## Replies, not messages
 *
 * 9s counted `messages.length`, which the maintainer's own question caught:
 * *"turns or replies? or are they the same thing?"* They are not. A chat holds
 * the user's messages as well as the model's, so a length of four is **two
 * exchanges**, and a cadence of 4 fired twice as often as it said. The legacy
 * ticks once per *generation*, so 4 there means four of the model's replies.
 * That is what is counted here.
 *
 * ## Counted against a watermark, not with a tick
 *
 * The legacy advances its tick on each generation except a swipe or a
 * regenerate, with a comment worth reading: those *reuse an existing message
 * slot*, so counting them would walk the cycle forward while the story stands
 * still. It uses a denylist rather than an allowlist because "a fresh send may
 * report its type as 'normal', '', or undefined depending on the entry path,
 * but swipes/regens are always explicit".
 *
 * Here the watermark is a position in the chat, and the count is how many of
 * the model's replies sit after it. A swipe replaces a message rather than
 * adding one, so neither number moves — the denylist's intent, without
 * depending on a generation type the legacy itself calls unreliable. It also
 * survives a restart, which an in-memory tick does not.
 *
 * One stored number answers both questions: how many replies are new (the
 * cadence) and how much of the chat is new (what the pass should read).
 *
 * ## Deleted messages
 *
 * A chat can get shorter. A watermark left past the end would hold every pass
 * until the chat grew back — but clamping it on the way *in* and throwing the
 * result away is worse, and was the first version of this: recomputed against
 * the current length every time, nothing is ever new and passes stop for good.
 * So the decision carries the watermark to store, and the caller writes it back.
 */

/** What the scheduler needs to know. */
export interface AutoPassInput {
    /**
     * The role of every message in the chat, in order.
     *
     * The whole list rather than a count, because the cadence counts the
     * model's replies and the lookback counts messages, and both have to be
     * measured from the same point.
     */
    roles: readonly string[]
    /** Position in the chat when a pass last ran, or 0 if none has. */
    watermark: number
    /** The model's replies between automatic passes. `0` turns them off. */
    runEvery: number
}

/** Whether to run, and what the pass should read. */
export interface AutoPassDecision {
    run: boolean
    /**
     * Messages the pass should read, or `0` for the whole chat.
     *
     * An automatic pass reads *since the last one* — the legacy's
     * `routerLookbackSinceLastRun`, which defaults on there too. Re-reading a
     * hundred-message campaign every four replies would spend the budget on
     * story the agent has already filed, and it starts each pass looking at an
     * index of what its books hold, so what it is missing is the new part.
     *
     * Counted in messages, not replies: this is a slice of the chat.
     *
     * The first pass on an established chat has no watermark, so this is the
     * whole chat, which is what a first pass wants.
     */
    lookback: number
    /**
     * The watermark to store now.
     *
     * The current length when a pass runs, and otherwise the value read back
     * corrected for a chat that has since got shorter. Persisting this is not
     * optional: see the note above about a clamp that is recomputed and
     * discarded.
     */
    watermark: number
    /** The model's replies since the watermark. */
    replies: number
    /** Why, in words, for the log. */
    reason: string
}

/** The default cadence: a pass every four replies. */
export const DEFAULT_RUN_EVERY = 3

/** The most replies apart automatic passes may be set. */
export const MAX_RUN_EVERY = 50

/** A message the model produced, as `spindle.chat.getMessages` labels it. */
const isReply = (role: string): boolean => role === 'assistant'

export function decideAutoPass(input: AutoPassInput): AutoPassDecision {
    const roles = input.roles ?? []
    const watermark = Math.min(Math.max(0, Math.floor(input.watermark) || 0), roles.length)
    const replies = roles.slice(watermark).filter(isReply).length

    const runEvery = Math.floor(input.runEvery)
    if (!Number.isFinite(runEvery) || runEvery <= 0) {
        return { run: false, lookback: 0, watermark, replies, reason: 'automatic passes are switched off' }
    }

    if (replies < runEvery) {
        const waiting = runEvery - replies
        return {
            run: false,
            lookback: 0,
            watermark,
            replies,
            reason: `${waiting} more repl${waiting === 1 ? 'y' : 'ies'} before the next pass`,
        }
    }

    return {
        run: true,
        // Only what is new. The whole chat when nothing has run before, since
        // the watermark is then 0 and there is no "new" to speak of.
        lookback: watermark === 0 ? 0 : roles.length - watermark,
        watermark: roles.length,
        replies,
        reason: `${replies} replies since the last pass`,
    }
}

/**
 * Where to put the watermark after a swipe rolled a pass back.
 *
 * The rolled-back pass is gone, so the lore it wrote has to be produced again —
 * and waiting a full cycle would leave the campaign missing a turn's worth of
 * lore for four more replies. The legacy primes its tick to `runEvery - 1` so
 * the next real generation fires; this is the same, expressed as a watermark.
 *
 * It walks back past `runEvery - 1` of the model's replies rather than that
 * many messages, because that is what the cadence counts. A chat with no
 * replies to walk back past gives 0, which fires on the next one.
 */
export function watermarkAfterRollback(roles: readonly string[], runEvery: number): number {
    const wanted = Math.max(0, (Math.max(1, Math.floor(runEvery) || 1)) - 1)
    if (wanted === 0) return roles.length

    let seen = 0
    for (let at = roles.length - 1; at >= 0; at--) {
        if (isReply(roles[at] ?? '')) seen++
        if (seen === wanted) return at
    }
    return 0
}

export type AutoPassLookbackMode = 'since_last_run' | 'since_last_user' | 'fixed'

/**
 * What the automatic pass reads (72b): the legacy's three-way window.
 *
 * *Since the last run* is the watermark's span, as the decision computed it.
 * *Since the last user message* is the current exchange: the last user
 * message and everything after it — the legacy's `findNthUserMessageStartIdx`
 * with one turn. *Fixed* is the agent's own count, 0 for the whole chat. A
 * chat with no user message is read whole in the second mode, as in the
 * legacy where the index falls to 0. The cadence — *when* a pass runs — is
 * the watermark's either way, as it is in the legacy.
 */
export function autoPassLookback(roles: readonly string[], mode: AutoPassLookbackMode, sinceLastRun: number, fixed: number): number {
    if (mode === 'fixed') return Math.max(0, Math.floor(fixed) || 0)
    if (mode === 'since_last_user') {
        const last = roles.lastIndexOf('user')
        return last < 0 ? 0 : roles.length - last
    }
    return sinceLastRun
}
