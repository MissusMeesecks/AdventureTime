/**
 * The passes running right now, so one can be stopped.
 *
 * Both long jobs here — the tracker pass and the Lorebook Agent — are sequences
 * of model calls, and until now nothing could stop one. A pass started by
 * mistake, or one grinding through five turns on a campaign the user has since
 * changed their mind about, had to be waited out. `spindle.generate` takes a
 * standard `AbortSignal` and tears down the upstream request when it fires, so
 * the missing piece was only somewhere to keep the controller.
 *
 * **What a signal covers is deliberately narrow: the model calls, and nothing
 * else.** Cancelling a tracker pass stops it before it merges, which is safe
 * because the memo is only written at the end. Cancelling an agent pass stops
 * it before `applyCommit`, so no lorebook is touched. Once a commit starts
 * writing it runs to completion — a half-applied commit is a worse thing to own
 * than a slow one, and the user asked to stop the waiting, not to stop the
 * writing.
 */

/** The two things that can be running. */
export type PassKind = 'tracker' | 'agent'

/** One running pass, and what stops it. */
interface Running {
    controller: AbortController
    startedAt: string
}

function key(kind: PassKind, chatId: string): string {
    return `${kind}:${chatId}`
}

/**
 * Who is running what.
 *
 * Keyed by kind *and* chat: a tracker pass on one chat and an agent pass on
 * another are unrelated, and stopping one must never stop the other. The
 * maintainer runs several campaigns.
 */
export class InFlightPasses {
    private readonly running = new Map<string, Running>()

    /**
     * Register a pass about to start, and hand back the signal it runs under.
     *
     * A second pass of the same kind on the same chat **replaces** the first and
     * aborts it. That is the legacy's behaviour (`runtimeState.stateController`
     * is aborted before a new tracker pass) and the right one: two passes
     * racing to write the same memo is worse than losing the older one.
     */
    begin(kind: PassKind, chatId: string): AbortSignal {
        const id = key(kind, chatId)
        this.running.get(id)?.controller.abort()

        const controller = new AbortController()
        this.running.set(id, { controller, startedAt: new Date().toISOString() })
        return controller.signal
    }

    /**
     * Forget a pass that has finished.
     *
     * The signal is required, and checked. A pass that finishes *after* a newer
     * one has already started must not clear the newer one's entry — it would
     * leave the running pass unstoppable, with the panel showing a Stop button
     * that does nothing. Two correct pieces of code, wrong between them, is a
     * mistake this project has already shipped once (lesson 12).
     */
    end(kind: PassKind, chatId: string, signal: AbortSignal): void {
        const id = key(kind, chatId)
        if (this.running.get(id)?.controller.signal === signal) this.running.delete(id)
    }

    /**
     * Stop a running pass.
     *
     * Returns whether there was anything to stop, so the caller can say "no
     * pass is running" rather than claiming to have cancelled nothing. The
     * entry is left in place: the pass itself clears it as it unwinds, which
     * keeps `end`'s ownership check meaningful.
     */
    cancel(kind: PassKind, chatId: string): boolean {
        const found = this.running.get(key(kind, chatId))
        if (!found) return false
        found.controller.abort()
        return true
    }

    /**
     * The signal a running pass is under, if any.
     *
     * The tracker pass is built once at startup and runs many times, so it
     * cannot be handed a signal at construction. It asks for the current one
     * instead, after `begin` has stored it.
     */
    current(kind: PassKind, chatId: string): AbortSignal | undefined {
        return this.running.get(key(kind, chatId))?.controller.signal
    }

    /** Whether a pass of this kind is running for this chat. */
    isRunning(kind: PassKind, chatId: string): boolean {
        return this.running.has(key(kind, chatId))
    }
}
