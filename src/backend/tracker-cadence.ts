/**
 * How often a tracker pass runs on its own.
 *
 * The legacy has this dial and we dropped it: `stateTrackerRunEvery`, live at
 * `narrative-hooks.js:2925` under the comment *"State Tracker pass — throttled
 * by stateTrackerRunEvery"*, defaulting to 1. Defaulting to 1 is why nothing
 * looked broken — every reply runs a pass here too — but there has been no way
 * to say otherwise, on the more expensive of the two passes and the one that
 * runs on every single reply.
 *
 * ## Three deliberate divergences from the pin
 *
 * The legacy's implementation is four lines and two of them are wrong for us.
 *
 * **1. A skipped turn must not lose its story.** The legacy's tick and its
 * reading window know nothing about each other: the window is rebuilt from
 * `chat.length` every pass (`index.js:2974-2992`), so with `runEvery: 3` and
 * the recommended "since last user message" mode it reads *the current
 * exchange* and the two skipped turns are simply gone. Nothing errors; the
 * memo just quietly stops matching the story. That is the failure shape this
 * project has been bitten by more than any other, so a throttled pass here
 * reads **at least** back to where the last one ran — the `floor` below. The
 * lookback setting becomes a minimum rather than a maximum, and at the default
 * cadence of 1 it is untouched.
 *
 * **2. A swipe must not spend the cadence.** The legacy increments
 * `_stateTrackerAutoTick` unconditionally, while the map updater eleven lines
 * below computes `countsTowardRunEvery = currentType !== 'swipe' && currentType
 * !== 'regenerate'` and the router does the same. The tracker being the one
 * that does not looks like an oversight rather than a decision. Here the count
 * is replies after a **watermark in the chat**, exactly as `auto-pass.ts` does
 * it: a swipe replaces a message rather than adding one, so it cannot move
 * either number, and the denylist's intent falls out without depending on a
 * generation type the legacy's own comment calls unreliable.
 *
 * **3. A re-track always runs, whatever the cadence says.** This one the legacy
 * cannot have: it has no equivalent of Phase 1b, where a swipe rebuilds the
 * memo from the state *before* the replaced reply. Holding that for two more
 * replies would leave the memo confidently describing a turn that did not
 * happen — Phase 9r's argument, on the store that feeds every prompt. So a
 * re-track bypasses the cadence, and because it reads back to the watermark it
 * covers the skipped turns on the way.
 *
 * ## Deleted messages
 *
 * A chat can get shorter, and a watermark past the end would hold every pass
 * until it grew back. Clamped on the way in and thrown away is worse — that was
 * `auto-pass.ts`'s first version, and recomputing against the current length
 * every time means nothing is ever new and passes stop for good. So the
 * decision carries the watermark to store and the caller writes it back.
 */

import type { TrackerLookbackMode } from './tracker-pass.js'

/** What the scheduler needs to know. */
export interface TrackerCadenceInput {
    /**
     * The role of every message in the chat, in order.
     *
     * The whole list rather than a count, because the cadence counts the
     * model's replies while the floor counts messages, and both are measured
     * from the same watermark.
     */
    roles: readonly string[]
    /** Position in the chat when a pass last ran, or 0 if none has. */
    watermark: number
    /** The model's replies between automatic passes. `1` is every reply. */
    runEvery: number
    /**
     * Whether this generation replaced a reply rather than adding one.
     *
     * A swipe, a regenerate or a continue. Always runs — see divergence 3.
     */
    retrack?: boolean
}

/** Whether to run, and how far back the pass must read. */
export interface TrackerCadenceDecision {
    run: boolean
    /**
     * The fewest messages this pass may read, or `0` to leave the window
     * entirely to the lookback setting.
     *
     * Non-zero only when a previous pass left turns uncovered. That is the
     * whole rule: **the floor covers what a previous pass would have covered,
     * so no previous pass means no floor.** A first pass on a long-running chat
     * therefore reads its configured window rather than two hundred messages
     * nobody asked for, and a chat where the tracker has never run behaves
     * exactly as it does today.
     */
    floor: number
    /**
     * The watermark to store now.
     *
     * The current length when a pass runs, and otherwise the value read back
     * corrected for a chat that has since got shorter. Persisting this is not
     * optional; see the note above.
     */
    watermark: number
    /** The model's replies since the watermark. */
    replies: number
    /** Why, in words, for the log. */
    reason: string
}

/**
 * Every reply, which is the legacy's default and what this build has always
 * done. An untouched install must be byte-identical after this lands.
 */
export const DEFAULT_TRACKER_RUN_EVERY = 1

/**
 * The most replies apart tracker passes may be set.
 *
 * Lower than the agent's 50 on purpose. A throttled pass reads back to the last
 * one, so the cadence bounds the size of the prompt as well as the staleness of
 * the memo — and twenty replies of drift in the thing holding your hit points
 * is already further than anyone should want.
 */
export const MAX_TRACKER_RUN_EVERY = 20

/** A message the model produced, as `spindle.chat.getMessages` labels it. */
const isReply = (role: string): boolean => role === 'assistant'

/** Read a stored cadence, however mangled, as a usable one. */
export function readTrackerRunEvery(value: unknown): number {
    const asked = Math.floor(Number(value))
    if (!Number.isFinite(asked) || asked < 1) return DEFAULT_TRACKER_RUN_EVERY
    return Math.min(asked, MAX_TRACKER_RUN_EVERY)
}

export function decideTrackerPass(input: TrackerCadenceInput): TrackerCadenceDecision {
    const roles = input.roles ?? []
    const watermark = Math.min(Math.max(0, Math.floor(input.watermark) || 0), roles.length)
    const replies = roles.slice(watermark).filter(isReply).length

    // What a previous pass left uncovered. Zero when none ever ran.
    const floor = watermark === 0 ? 0 : Math.max(0, roles.length - watermark)

    const runEvery = readTrackerRunEvery(input.runEvery)

    // The default, and the only path an untouched install ever takes. Stated
    // before the re-track check so that at cadence 1 nothing about this module
    // can change what happens — including the floor, which stays 0.
    if (runEvery <= 1) {
        return {
            run: true,
            floor: 0,
            watermark: roles.length,
            replies,
            reason: 'a pass runs on every reply',
        }
    }

    if (input.retrack) {
        return {
            run: true,
            floor,
            watermark: roles.length,
            replies,
            reason: 'this reply replaced the one the memo was built on',
        }
    }

    if (replies < runEvery) {
        const waiting = runEvery - replies
        return {
            run: false,
            floor: 0,
            watermark,
            replies,
            reason: `${waiting} more repl${waiting === 1 ? 'y' : 'ies'} before the next pass`,
        }
    }

    return {
        run: true,
        floor,
        watermark: roles.length,
        replies,
        reason: `${replies} replies since the last pass`,
    }
}

/** What one reply's worth of scheduling needs from the outside world. */
export interface TrackerCadenceDeps {
    /** The roles of the chat's messages, in order. */
    roles(chatId: string, userId: string | undefined): Promise<readonly string[]>
    /** The cadence this install is set to. */
    runEvery(userId: string | undefined): Promise<number>
    /** Where the last pass got to on this chat. */
    readWatermark(chatId: string, userId: string | undefined): Promise<number>
    /** Record where this one got to. Called even when holding — see above. */
    writeWatermark(chatId: string, userId: string | undefined, watermark: number): Promise<void>
    /** Run the pass. */
    run(input: {
        chatId: string
        userId: string | undefined
        messageId?: string
        generationType?: string
        floor: number
    }): Promise<void>
    log?(message: string): void
}

/** Generation types that replace the reply a memo was built on. */
export const TRACKER_RETRACK_TYPES = new Set(['regenerate', 'swipe', 'continue'])

/**
 * Decide and act, in one testable place.
 *
 * In this module rather than in `backend.ts` because of lesson 19, which has
 * now fired three times: a setting that saves, clamps and displays correctly
 * and then never reaches the thing it configures is invisible to the entire
 * suite, because the host entry point cannot have tests. A cadence wired there
 * would fail exactly that way — passes would keep running every reply and
 * nothing would notice.
 *
 * Never throws on the scheduling half: a chat whose roles cannot be read falls
 * through to running the pass, because the tracker running too often is a cost
 * and the tracker not running is the bug this project has spent the most
 * sessions on.
 */
export async function maybeRunTrackerPass(
    deps: TrackerCadenceDeps,
    input: { chatId: string; userId: string | undefined; messageId?: string; generationType?: string },
): Promise<TrackerCadenceDecision | null> {
    const retrack = TRACKER_RETRACK_TYPES.has(input.generationType ?? 'normal')

    let decision: TrackerCadenceDecision
    try {
        const [roles, runEvery, watermark] = await Promise.all([
            deps.roles(input.chatId, input.userId),
            deps.runEvery(input.userId),
            deps.readWatermark(input.chatId, input.userId),
        ])
        decision = decideTrackerPass({ roles, watermark, runEvery, retrack })
    } catch {
        // Fail toward running. See the note above.
        await deps.run({ ...input, floor: 0 })
        return null
    }

    // Written back even when holding, so a chat that lost messages corrects
    // itself rather than holding passes for good.
    await deps
        .writeWatermark(input.chatId, input.userId, decision.watermark)
        .catch(() => undefined)

    if (!decision.run) {
        deps.log?.(`tracker: skipped — ${decision.reason}`)
        return decision
    }

    await deps.run({ ...input, floor: decision.floor })
    return decision
}
