/**
 * The tracker pass — the thing that makes the tracker self-feeding.
 *
 * After a chat generation ends, this asks a model what changed, folds the
 * answer into the chat's memo, and saves it. The next generation's prompt then
 * carries that memo (see `injection.ts`), so the story and the state feed each
 * other without the user doing anything.
 *
 * It runs on `GENERATION_ENDED`, which matters for a reason the plan calls out
 * as R4: this is expensive work, and it must not happen inside the interceptor,
 * where every millisecond is visible silence before the first token. A
 * background pass costs the user nothing because they are reading the reply
 * that just arrived. `generate.quiet` does not re-enter the interceptor chain,
 * so the pass cannot recurse into itself either.
 *
 * Everything here takes its dependencies as arguments, so the whole pass can be
 * driven against fakes with no host present.
 */

import { isAbortError } from '../abort.js'
import { connectionField } from './agent-pass.js'
import { secondsSince, type StepFn } from './terminal.js'
import { stripChoiceBlocks } from '../tracker/cyoa.js'
import { extractMemo } from '../tracker/extract.js'
import { mergeMemoDetailed, type MergeResult } from '../tracker/merge.js'
import type { RelationshipCommand } from '../tracker/relationships.js'
import { memoForTrackerContext } from '../tracker/prompt.js'
import { buildTrackerPrompt, type TrackerPromptSettings } from '../tracker/prompt.js'
import { FULL_REVIEW_STATE_SYSTEM_PROMPT, FULL_REVIEW_USER_PROMPT_SUFFIX } from '../tracker/full-review-legacy.js'
import { applyQuestSync, type Quest, type QuestSyncResult } from '../tracker/quests.js'
import { currentTimeFromMemo } from '../tracker/time.js'
import type { MemoStore, TrackerPassReport } from './memo-store.js'
import type { MemoHistoryRecord, MemoSnapshot } from './memo-history.js'
import type { QuestArchiveRecord, RecordArchivedOptions } from './quest-archive.js'

export interface LogApi {
    info(message: string): void
    warn(message: string): void
    error(message: string): void
}

/** One message as the host hands it over. */
export interface ChatMessage {
    id?: string
    role: 'system' | 'user' | 'assistant'
    content: string
    /**
     * The host's own number for this message — the `#22` it prints on the
     * bubble. `ChatMessageDTO.index_in_chat`, passed straight through.
     *
     * Optional only because the tests build messages by hand. On a real host it
     * is always there, and it is the only number worth showing: deriving one
     * from the position in this array was off by one against what the user
     * sees, which is the whole point of showing a number at all.
     */
    index_in_chat?: number
}

/** The slice of the quest archive the pass writes to. */
export interface QuestArchiveWriter {
    load(chatId: string, userId?: string): Promise<QuestArchiveRecord>
    record(
        chatId: string,
        quests: Quest[],
        userId?: string,
        options?: RecordArchivedOptions,
    ): Promise<QuestArchiveRecord>
}

export interface TrackerPassDeps {
    chat: { getMessages(chatId: string): Promise<ChatMessage[]> }
    /** The terminal (71b): a step function for the pass on this chat, announcing what it does as it goes. */
    steps?: (chatId: string, userId: string | undefined) => StepFn
    settings: { load(userId?: string): Promise<Record<string, unknown>> }
    memos: MemoStore
    /**
     * Where the memo as it stood after each turn is kept, for the cards that
     * hang under old messages.
     *
     * Optional, like the archive: without it the tracker behaves exactly as it
     * did before there was any history — the live memo is all there is.
     */
    history?: {
        record(chatId: string, snapshot: MemoSnapshot, userId?: string): Promise<MemoHistoryRecord>
        /** The earlier states, for the history context (72b); absent, the current memo alone is shown. */
        load?(chatId: string, userId?: string): Promise<MemoHistoryRecord>
    }
    /** How many memo states the tracker is shown, the current one included (72b); absent or 1, the current alone. */
    historyStates?: (userId: string | undefined) => Promise<number>
    /**
     * The line that closes every tracker prompt (72c): Multihog's User Prompt
     * Suffix, a preference; blank or absent, the pin's own line.
     */
    outputSuffix?: (userId: string | undefined) => Promise<string>
    /** Multihog's Full Review Mode (73c): on, the built-in Core Prompt and suffix replace the extractor's and the User Prompt Suffix. */
    fullReview?: (userId: string | undefined) => Promise<boolean>
    /**
     * The lorebooks as one section (73h, Multihog's *Inject Lorebooks*): the
     * text that opens the user prompt on every pass, or blank for none; read
     * per pass, as the legacy reads it. Absent, nothing is sent.
     */
    worldLore?: (chatId: string, userId: string | undefined) => Promise<string>
    /** Whether a swipe reads from the memo before the replaced reply's pass (72b, the legacy's *Auto Rollback Memo on Swipe*); absent, it does. */
    swipeRollback?: (userId: string | undefined) => Promise<boolean>
    /** The last reports, kept for the panel's history (47e). Optional, like the memo history. */
    reports?: {
        recordTracker(chatId: string, report: TrackerPassReport, userId?: string): Promise<unknown>
    }
    /**
     * Where finished quests go once the memo drops them.
     *
     * Optional: without it the pass behaves exactly as it did before there was
     * an archive — quests still leave the memo, they are simply not kept.
     */
    archive?: QuestArchiveWriter
    /** The macro-resolving wrapper, never `spindle.generate` directly (R1). */
    generate: { quiet(input: Record<string, unknown>): Promise<unknown> }
    /**
     * The signal this chat's pass is running under, looked up when it runs.
     *
     * A resolver rather than a value because the pass is built once at startup
     * and runs many times; a signal captured at construction would belong to no
     * particular pass.
     *
     * It covers the model call and nothing else. The merge and the memo write
     * happen after it and are not interruptible — there is nothing to gain by
     * stopping them, and a memo written halfway is the one outcome worse than
     * waiting.
     */
    signal?(chatId: string): AbortSignal | undefined
    /**
     * Which connection profile this pass's model call runs on.
     *
     * A resolver for the same reason as `signal`: the pass is built once at
     * startup and the user can change this between runs. `undefined` leaves the
     * host to pick, which is what every build before this one did.
     */
    connectionId?(userId: string | undefined): Promise<string | undefined>
    log: LogApi
    /**
     * Called when a pass actually begins — after it has waited its turn in the
     * per-chat queue, not when it was asked for.
     *
     * The pass after a reply was invisible until it landed: nothing on screen
     * moved, so "still thinking" and "ran and found nothing" looked identical
     * for however long the model took. Every start is followed by exactly one
     * `onPassComplete`, including when the pass throws, because a start with no
     * end leaves the panel claiming a pass is running for the rest of the
     * session.
     */
    onPassStart?: (event: {
        chatId: string
        userId?: string
        /** When it started, ISO 8601. */
        at: string
        trigger: TrackerPassTrigger
    }) => void
    /**
     * Called after every pass, whatever it did, so the panel can redraw and say
     * so. Fires on a no-change and on a failure too — a tracker that reports
     * only its successes leaves the user unable to tell it from a broken one.
     */
    onPassComplete?: (event: {
        chatId: string
        userId?: string
        memo: string
        report: TrackerPassReport
        delta?: MergeResult
        /**
         * The message this pass was for, when it was for one. Lets the frontend
         * update that message's card without re-reading the whole history.
         */
        messageId?: string
        /**
         * The chat's finished quests as they now stand, so the panel can draw
         * the archive without a second round trip. Absent when there is no
         * archive store, or when reading it failed — which is not a pass
         * failure and must not be reported as one.
         */
        archivedQuests?: Quest[]
    }) => void
    /**
     * How much of the story this pass reads, looked up when it runs.
     *
     * A resolver for the same reason as `signal` and `connectionId`: the pass
     * is built once at startup and the user can change this between runs.
     */
    lookback?(userId: string | undefined): Promise<{ mode?: TrackerLookbackMode; count?: number } | undefined>
    /**
     * The relationship system (Phase 44), when the build has one.
     *
     * In tracker mode the pass's prompt carries the `[RELATIONS]` instruction
     * and the reply's block is read out before the memo is parsed, then its
     * commands are applied against the campaign's NPC entries — the legacy's
     * `applyStateTrackerRelationshipCommands`. In regex mode and when the
     * system is off, all three return nothing and the pass runs as before.
     * Never in a modules-only pass: the character creator's prompt is its own.
     */
    relationships?: {
        instruction(userId: string | undefined): Promise<string>
        extract(text: string, userId: string | undefined): Promise<{ memo: string; commands: RelationshipCommand[] }>
        apply(chatId: string, userId: string | undefined, commands: readonly RelationshipCommand[], options: { source: 'tracker'; messageId?: string; retrack?: boolean }): Promise<{ placed: Array<{ label: string; field: string; delta: number; newValue: number }>; unmatched: string[]; reverted: number }>
    }
}

/**
 * What asked for this pass.
 *
 * `manual` is the panel's button, which the panel is already showing state for;
 * `reply` is the automatic pass after a turn, which is the one nobody could
 * see; `direct` is the send bar (Phase 30) -- a pass carrying the user's own
 * instruction, which the report names so a change nobody asked the story for
 * is not read as the tracker's idea. Kept apart so the panel can word them.
 */
export type TrackerPassTrigger = 'reply' | 'manual' | 'direct'

export type TrackerPassStatus =
    | 'updated'
    | 'no-change'
    | 'skipped'
    | 'failed'
    /**
     * The user pressed Stop.
     *
     * Kept apart from `failed` on purpose. A cancelled pass is something they
     * did deliberately, and painting it red would be the confusion Phase 1d
     * fixed for timeouts — a panel that cannot tell a fault from a choice.
     */
    | 'cancelled'

export interface TrackerPassOutcome {
    status: TrackerPassStatus
    /** Why, when the status is `skipped` or `failed`. */
    reason?: string
    memo?: string
    delta?: MergeResult
    report: TrackerPassReport
}

/** How much of an unparseable reply to keep, so the panel can show what came back. */
export const SAMPLE_LENGTH = 400

/**
 * Quest housekeeping, on the memo the merge just produced.
 *
 * Two things the `[QUESTS]` format promises and nothing was delivering. The
 * extractor prompt tells the model *"the engine archives completed and failed
 * quests automatically — output only active quests"* and *"do not output the
 * MOOD field — the engine calculates and injects it automatically"*. Until now
 * no engine did either: a finished quest sat in the memo costing context on
 * every subsequent turn, and the giver's mood was never computed at all.
 *
 * Skipped outright when the user has switched quests off. Rewriting a block
 * belonging to a module they disabled is not housekeeping, it is meddling.
 */
export function syncQuests(memo: string, settings: Record<string, unknown>): QuestSyncResult {
    const modules = (settings.modules ?? {}) as Record<string, boolean>
    const sysprompt = (settings.syspromptModules ?? {}) as Record<string, boolean>
    if (modules.quests === false || sysprompt.quests === false) {
        return { memo, quests: [], archived: [] }
    }

    return applyQuestSync(memo, {
        // Off means no MOOD line at all, not a differently-worded one: the
        // clock-based labels are for the panel, not for the prompt.
        showFrustration: sysprompt.questsFrustration === true,
        currentTime: currentTimeFromMemo(memo),
    })
}

/** Generation types that should not move tracker state. */
const IGNORED_GENERATION_TYPES = new Set(['impersonate'])

/**
 * Generation types that *replace* the message the memo was last built from,
 * rather than adding a new one.
 */
const RETRACK_GENERATION_TYPES = new Set(['regenerate', 'swipe', 'continue'])

/** Pull the text out of whatever `generate.quiet` handed back. */
export function readGenerationText(result: unknown): string {
    if (typeof result === 'string') return result
    if (result && typeof result === 'object') {
        const content = (result as { content?: unknown }).content
        if (typeof content === 'string') return content
    }
    return ''
}

/**
 * How much of the story a tracker pass reads.
 *
 * `since-last-user` walks back to the most recent user message and takes it and
 * everything after — on a normal turn, the current exchange. It is the legacy's
 * default and the one its own UI marks "(recommended)", and it is the right
 * shape for the question the extractor is asked: *what changed this turn*.
 *
 * `fixed` takes the last N messages instead, for a chat where the turns do not
 * line up that way.
 */
export type TrackerLookbackMode = 'since-last-user' | 'fixed'

export const DEFAULT_LOOKBACK_MODE: TrackerLookbackMode = 'since-last-user'

/**
 * Messages read in `fixed` mode.
 *
 * Two, as the legacy's `lookbackMessages` defaults to — not the six this build
 * used to send unconditionally. Six is roughly three turns, and re-showing
 * turns that were already merged invites the model to re-report changes it has
 * already reported, on the most frequent model call in the extension.
 */
export const DEFAULT_LOOKBACK_COUNT = 2

/** Messages that are narrative: not the host's own, not empty. */
function usableMessages(messages: ChatMessage[]): ChatMessage[] {
    return messages.filter((message) => message.role !== 'system' && String(message.content ?? '').trim())
}

/**
 * Choose the slice of chat a pass reads.
 *
 * Ported from the legacy's selection at `index.js:2974-2992`. One deliberate
 * difference: it walks the *narrative* messages, where the legacy walks the raw
 * chat. Ours is the same list minus the host's own messages, and walking back
 * to "the last user message" past a system entry would be wrong anyway.
 */
export function selectNarrativeWindow(
    messages: ChatMessage[],
    options: { mode?: TrackerLookbackMode; count?: number; floor?: number } = {},
): ChatMessage[] {
    const usable = usableMessages(messages)
    if (usable.length === 0) return []

    // A throttled pass has turns to catch up on, and the configured window
    // knows nothing about them. The legacy has exactly this hole: its tick and
    // its window are independent, so raising `stateTrackerRunEvery` there drops
    // the skipped turns' story with no error and no symptom beyond a memo that
    // slowly stops matching the game. So the window is widened, never narrowed
    // — the setting is a minimum here, not a maximum.
    //
    // Zero at the default cadence, and zero on any chat where no pass has run,
    // so this line cannot change what an untouched install does.
    const floor = Math.max(0, Math.floor(options.floor ?? 0))
    const widen = (chosen: ChatMessage[]): ChatMessage[] =>
        floor > chosen.length ? usable.slice(-floor) : chosen

    if ((options.mode ?? DEFAULT_LOOKBACK_MODE) === 'fixed') {
        const count = Math.max(1, Math.floor(options.count ?? DEFAULT_LOOKBACK_COUNT))
        return widen(usable.slice(-count))
    }

    // Back to the most recent user message, then everything after it. That
    // captures a whole turn even when several replies follow one message.
    let start = usable.length - 1
    while (start > 0 && usable[start]!.role !== 'user') start--

    // A chat with no user message at all — a greeting nobody has answered yet.
    // The legacy falls back to the last two, and hardcodes two rather than
    // using the configured count. Kept as it is: this is the opening of a chat,
    // not a case anyone tunes.
    if (start === 0 && usable[0]!.role !== 'user') return widen(usable.slice(-2))

    return widen(usable.slice(start))
}

/** The per-user settings a tracker pass reads at run time. */
export interface TrackerPassPrefs {
    trackerLookbackMode?: TrackerLookbackMode
    trackerLookbackCount?: number
    trackerConnectionId?: string
}

/**
 * The resolvers a tracker pass needs, built from a preferences loader.
 *
 * A function returning the resolvers, rather than two arrow functions written
 * out in `backend.ts`, because that file is the host entry point and has no
 * tests — and "a setting that saves, clamps and displays correctly and then
 * never reaches the thing it configures" has now been shipped three times here
 * (`lookback`, `maxTurns`, the agent's connection). Every one was invisible to
 * the whole suite. Built here, the reading is covered and the entry point is
 * left with a spread.
 */
export function trackerPassResolvers(load: (userId: string | undefined) => Promise<TrackerPassPrefs>): {
    connectionId(userId: string | undefined): Promise<string | undefined>
    lookback(userId: string | undefined): Promise<{ mode?: TrackerLookbackMode; count?: number }>
} {
    return {
        connectionId: async (userId) => (await load(userId)).trackerConnectionId || undefined,
        lookback: async (userId) => {
            const prefs = await load(userId)
            return { mode: prefs.trackerLookbackMode, count: prefs.trackerLookbackCount }
        },
    }
}

/**
 * A message's text as the passes should read it: without its CYOA choices.
 *
 * A choice is what might happen next, not what did. The legacy strips the
 * blocks before its agent reads a narrator message; a tracker that read
 * "Throw a Smoke Bomb — [-1 Smoke Bomb]" as prose would spend the bomb, so
 * this build strips them for the tracker as well.
 */
export function narrativeText(message: ChatMessage): string {
    const content = String(message.content ?? '')
    return message.role === 'assistant' ? stripChoiceBlocks(content) : content.trim()
}

/** Render chosen messages the way the pass expects to read them. */
export function renderNarrative(messages: ChatMessage[]): string[] {
    return messages.map((message) => `${message.role === 'user' ? 'User' : 'GM'}: ${narrativeText(message)}`)
}

/**
 * The last `depth` messages, rendered.
 *
 * Still the Lorebook Agent's rule — it reads a window of recent chat rather
 * than one turn, because it is looking for lore across a stretch of story.
 */
export function formatNarrative(messages: ChatMessage[], depth: number): string[] {
    return renderNarrative(usableMessages(messages).slice(-depth))
}

/**
 * The same window, with each line carrying the host's number for its message.
 *
 * The agent needs these to say *when* a thing happened. Without them it can
 * only ever be told the turn the pass ran on, which is the newest message and
 * usually not the one the lore came from — a pass reading 40 to 45 stamped
 * everything `#45`, including a betrayal at 43.
 *
 * Numbers come from `index_in_chat`, never from position in this array: the
 * whole point is that they match what is printed on the bubble.
 */
export function numberedNarrative(
    messages: ChatMessage[],
    depth: number,
): { lines: string[]; readRange: number[] } {
    const window = usableMessages(messages).slice(-depth)
    const lines: string[] = []
    const readRange: number[] = []

    for (const message of window) {
        const who = message.role === 'user' ? 'User' : 'GM'
        const body = narrativeText(message)
        const number = Number(message.index_in_chat)

        if (Number.isFinite(number) && number >= 0) {
            readRange.push(number)
            lines.push(`[#${number}] ${who}: ${body}`)
        } else {
            // A message the host will not number still belongs in the story the
            // model reads; it simply cannot be cited.
            lines.push(`${who}: ${body}`)
        }
    }

    return { lines, readRange }
}

export interface TrackerPassRequest {
    chatId: string
    userId?: string
    /** The message this generation produced. Used to detect a re-track. */
    messageId?: string
    /** normal / continue / regenerate / swipe / impersonate. */
    generationType?: string
    /** Who asked. Defaults to `reply` — the automatic pass after a turn. */
    trigger?: TrackerPassTrigger
    /**
     * The fewest messages this pass must read, whatever the lookback says.
     *
     * Set by the cadence when passes are throttled, so a pass that covers three
     * replies reads all three rather than the newest exchange. Zero — and so
     * absent from every existing caller — at the default cadence of 1.
     */
    floor?: number
    /**
     * What the user typed into the send bar, for a `direct` pass.
     *
     * The legacy's `sendDirectPrompt`: the same extractor, the same merge, with
     * the instruction as its own section of the prompt. Blank is the same as
     * absent.
     */
    instruction?: string
    /**
     * How many recent messages an instructed pass reads, in place of the
     * lookback setting. `0` reads none: the instruction is the whole input.
     * The legacy's `directPromptContext`. Ignored without an instruction.
     */
    window?: number
    /**
     * `modules_only` sends the module instructions as the whole system prompt
     * (Phase 35, the character creator). Absent: the extractor's rules too.
     */
    systemPromptMode?: 'modules_only'
    /**
     * Who `{{user}}` is in the module formats for a modules-only pass: the
     * name the player typed, or `the player character` when none. The host
     * resolves the macro to the active persona otherwise, and a format that
     * reads `{{user}} (Class)` then names the persona over the player's own
     * choice (35-bis, lesson 44). Ignored outside modules-only mode.
     */
    playerName?: string
    /**
     * The connection this one pass runs on, in place of the resolver's: the
     * creator's own, when the user picked one. `''` or absent defers.
     */
    connectionId?: string
}

export interface TrackerPass {
    run(request: TrackerPassRequest): Promise<TrackerPassOutcome>
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

/**
 * The host's own number for a message, or `null` when it does not have one.
 *
 * **Read, never derived.** The first version counted the position in the array
 * and added one, which named the message *after* the one it meant: the stepper
 * offered to restore to `#22`, a message the user had written, when the state
 * belonged to `#21`. The host publishes `index_in_chat` and that is the number
 * on the bubble, so there is nothing here to work out.
 *
 * `null` rather than a guess when the message cannot be found or carries no
 * number. A wrong number is worse than none: the point of showing it is that it
 * can be matched against the chat exactly.
 */
export function messageNumberOf(messages: readonly ChatMessage[], messageId: string): number | null {
    if (!messageId) return null

    const found = messages.find((message) => message.id === messageId)
    const number = Number(found?.index_in_chat)
    return Number.isFinite(number) && number >= 0 ? number : null
}

/**
 * How a pass ends: records the report, saves it, and tells the panel.
 *
 * Passed in rather than closed over so the guard around an unexpected throw can
 * reach the same exit the ordinary paths use.
 */
type FinishPass = (
    outcome: Omit<TrackerPassOutcome, 'report'>,
    extra?: Omit<TrackerPassReport, 'status' | 'at'>,
) => Promise<TrackerPassOutcome>

export function createTrackerPass(deps: TrackerPassDeps): TrackerPass {

    /**
     * One pass at a time per chat.
     *
     * Two passes for one chat would both read the same prior memo and the
     * second would overwrite the first — the stale-write race, again. Chained
     * per chat rather than globally so a slow pass in one campaign does not
     * hold up another.
     */
    const running = new Map<string, Promise<TrackerPassOutcome>>()

    /**
     * Announce the start, run the pass, and make sure the start is answered.
     *
     * The panel shows "a pass is running" from the start event until something
     * ends it, so the one thing this must not do is start a pass that never
     * reports. Every ordinary failure inside `attempt` reports itself; the catch
     * here is for the unexpected one — a grammar or a prompt build throwing —
     * and it still writes a report the panel can read.
     */
    async function runOnce(request: TrackerPassRequest): Promise<TrackerPassOutcome> {
        const { chatId, userId } = request

        /**
         * Every exit from a pass goes through here.
         *
         * The report is persisted even for a skip or a failure, because those
         * are precisely the outcomes a user needs to see: state that stops
         * moving looks identical whether the pass never ran, ran and was
         * refused, or ran and correctly found nothing.
         */
        const finish: FinishPass = async (
            outcome: Omit<TrackerPassOutcome, 'report'>,
            extra: Omit<TrackerPassReport, 'status' | 'at'> = {},
        ): Promise<TrackerPassOutcome> => {
            const report: TrackerPassReport = {
                status: outcome.status,
                at: new Date().toISOString(),
                ...(outcome.reason ? { reason: outcome.reason } : {}),
                ...extra,
                // Only the instructed pass is marked: the other two read the
                // same way they always have.
                ...(request.trigger === 'direct' ? { trigger: 'direct' as const } : {}),
            }

            let memo = outcome.memo ?? ''
            try {
                // `updated` has already written the memo and the report with it.
                if (outcome.status !== 'updated') {
                    memo = (await deps.memos.notePass(chatId, report, userId)).memo
                }
            } catch (error) {
                deps.log.warn(`could not record tracker pass outcome: ${describe(error)}`)
            }
            // The history is a convenience; the pass is not failed over it.
            try {
                await deps.reports?.recordTracker(chatId, report, userId)
            } catch (error) {
                deps.log.warn(`could not keep the tracker report in the history: ${describe(error)}`)
            }

            // Read rather than passed in, so a pass that archived nothing this
            // turn still hands the panel the archive it has: the panel redraws
            // from this event, and an absent list would blank the sections.
            let archivedQuests: Quest[] | undefined
            try {
                if (deps.archive) archivedQuests = (await deps.archive.load(chatId, userId)).quests.map((e) => e.quest)
            } catch (error) {
                deps.log.warn(`could not read the quest archive for chat ${chatId}: ${describe(error)}`)
            }

            deps.onPassComplete?.({
                chatId,
                userId,
                memo,
                report,
                delta: outcome.delta,
                ...(request.messageId ? { messageId: request.messageId } : {}),
                ...(archivedQuests ? { archivedQuests } : {}),
            })
            return { ...outcome, memo, report }
        }

        deps.onPassStart?.({
            chatId,
            userId,
            at: new Date().toISOString(),
            trigger: request.trigger ?? 'reply',
        })
        const step = deps.steps?.(chatId, userId)
        const startedAt = Date.now()
        step?.('start', request.instruction?.trim() ? 'Processing direct State Tracker instruction…' : 'Initializing State Tracker pass…')
        // Every exit above says what happened on the feed too, by the report's status (71b).
        const told: FinishPass = async (outcome, extra) => {
            const out = await finish(outcome, extra)
            if (step) {
                const seconds = secondsSince(startedAt)
                const delta = out.delta
                if (out.status === 'updated') {
                    const parts = [`${delta?.replaced.length ?? 0} replaced`, `${delta?.added.length ?? 0} added`, `${delta?.removed.length ?? 0} removed`]
                    if (delta?.benched.length) parts.push(`benched ${delta.benched.join(', ')}`)
                    if (delta?.unbenched.length) parts.push(`unbenched ${delta.unbenched.join(', ')}`)
                    step('result', `Memo updated: ${parts.join(', ')}.`)
                    step('finish', request.instruction?.trim() ? 'Direct State Tracker instruction complete.' : 'State Tracker pass complete.', { seconds })
                } else if (out.status === 'no-change') step('finish', 'No memo changes were needed.', { seconds })
                else if (out.status === 'skipped') step('finish', `Skipped: ${out.reason ?? 'nothing to do'}.`, { seconds })
                else if (out.status === 'cancelled') step('error', 'Stopped by user.', { seconds })
                else step('error', out.reason ?? 'The pass failed.', { seconds })
            }
            return out
        }

        try {
            return await attempt(request, told, step)
        } catch (error) {
            const reason = `the tracker pass threw: ${describe(error)}`
            deps.log.error(`tracker pass for chat ${chatId}: ${reason}`)
            await told({ status: 'failed', reason })
            throw error
        }
    }

    async function attempt(request: TrackerPassRequest, finish: FinishPass, step?: StepFn): Promise<TrackerPassOutcome> {
        const { chatId, userId, messageId, generationType, floor } = request

        if (generationType && IGNORED_GENERATION_TYPES.has(generationType)) {
            return finish({ status: 'skipped', reason: `generation type "${generationType}" does not move state` })
        }

        let settings: Record<string, unknown>
        let record: Awaited<ReturnType<MemoStore['load']>>
        let messages: ChatMessage[]
        try {
            ;[settings, record, messages] = await Promise.all([
                deps.settings.load(userId),
                deps.memos.load(chatId, userId),
                deps.chat.getMessages(chatId),
            ])
        } catch (error) {
            const reason = `could not read the chat or its settings: ${describe(error)}`
            deps.log.warn(`tracker pass for chat ${chatId}: ${reason}`)
            return finish({ status: 'failed', reason })
        }

        // An instructed pass reads the window it was given -- the legacy's
        // `directPromptContext`, its own setting -- and may read nothing at
        // all: the instruction is then the whole input, and an empty chat is
        // not a reason to skip it. That is how a character is set up before
        // the first turn.
        const instruction = request.instruction?.trim() || undefined
        const windowed = instruction && request.window !== undefined
            ? request.window > 0 ? usableMessages(messages).slice(-Math.floor(request.window)) : []
            : // Read here rather than at construction, and defended: a preferences
              // read that throws must cost the default window, not the pass.
              selectNarrativeWindow(messages, { ...((await deps.lookback?.(userId).catch(() => undefined)) ?? {}), floor })
        const narrative = renderNarrative(windowed)
        if (narrative.length === 0 && !instruction) {
            return finish({ status: 'skipped', reason: 'the chat has no narrative to read yet', memo: record.memo })
        }

        // A swipe or a regenerate replaces the message this memo was already
        // built from. Merging onto the current memo would count that turn
        // twice, so roll back one step and merge onto what came before it.
        const rollback = (await deps.swipeRollback?.(userId).catch(() => true)) ?? true
        const isRetrack = rollback &&
            !!messageId &&
            record.lastMessageId === messageId &&
            (!generationType || RETRACK_GENERATION_TYPES.has(generationType))
        const base = isRetrack && record.previous !== undefined ? record.previous : record.memo

        // Benching follows the two module flags, as the legacy's
        // `benchCommandsEnabled` reads them. The pass sees the benched roster
        // compact -- name and status -- and its commands move the full sheet.
        const modules = (settings.modules ?? {}) as Record<string, boolean>
        const bench = modules['benched party'] !== false && modules.party !== false

        // Read before the call rather than inside it, so a resolver that throws
        // cannot take down a pass that would otherwise have run on the default.
        const connectionId = request.connectionId || (await deps.connectionId?.(userId).catch(() => undefined))

        // The history context (72b): the N-1 states before this one, oldest first, each as the tracker would see it.
        const states = Math.max(1, Math.floor((await deps.historyStates?.(userId).catch(() => 1)) ?? 1))
        let priorStates: string[] = []
        if (states > 1 && deps.history?.load) {
            try {
                const kept = (await deps.history.load(chatId, userId)).snapshots
                    .filter((snapshot) => snapshot.memo !== base)
                    .slice(0, states - 1)
                priorStates = kept.reverse().map((snapshot) => memoForTrackerContext(snapshot.memo, { benchedParty: modules['benched party'] !== false }))
            } catch (error) {
                deps.log.warn(`tracker: the history context could not be read: ${describe(error)}`)
            }
        }
        // Full Review Mode (73c, departure 22): the legacy swaps the Core Prompt
        // and the suffix for its built-in Full Review pair on every pass — not
        // the modules-only pass, whose prompt is the creator's own.
        const fullReview = request.systemPromptMode !== 'modules_only' && (await deps.fullReview?.(userId).catch(() => false)) === true
        if (fullReview) deps.log.info(`tracker pass for chat ${chatId}: Full Review Mode — the built-in Core Prompt and suffix in place of the extractor's`)
        const outputSuffix = fullReview ? FULL_REVIEW_USER_PROMPT_SUFFIX : String((await deps.outputSuffix?.(userId).catch(() => '')) ?? '')
        // The world lore (73h): the legacy opens every pass's user prompt with it, the direct and the
        // modules-only one included; read defended, so a failed read costs the section, not the pass.
        let worldLore = ''
        try {
            worldLore = String((await deps.worldLore?.(chatId, userId)) ?? '')
        } catch (error) {
            deps.log.warn(`tracker: the world lore could not be read, the pass runs without it: ${describe(error)}`)
        }
        const prompt = buildTrackerPrompt({
            ...(worldLore.trim() ? { worldLore } : {}),
            settings: (fullReview ? { ...settings, systemPromptTemplate: FULL_REVIEW_STATE_SYSTEM_PROMPT } : settings) as TrackerPromptSettings,
            ...(outputSuffix.trim() ? { outputSuffix } : {}),
            memo: memoForTrackerContext(base, { benchedParty: modules['benched party'] !== false }),
            ...(priorStates.length ? { priorStates } : {}),
            narrative,
            ...(instruction ? { instruction } : {}),
            ...(request.systemPromptMode === 'modules_only' ? { modulesOnly: true } : {}),
        })

        // The relationship instruction after the modules, as the legacy appends
        // it (44); read defended, so a preferences read that throws costs the
        // block, not the pass. Not for a modules-only pass, whose prompt is the
        // creator's own.
        const relationshipInstruction = request.systemPromptMode === 'modules_only' || !deps.relationships
            ? ''
            : await deps.relationships.instruction(userId).catch((error: unknown) => {
                deps.log.warn(`tracker pass for chat ${chatId}: the relationship instruction could not be read: ${describe(error)}`)
                return ''
            })
        const system = (request.systemPromptMode === 'modules_only'
            ? prompt.system.replace(/\{\{\s*user\s*\}\}/gi, request.playerName?.trim() || 'the player character')
            : prompt.system) + (relationshipInstruction ? `\n\n${relationshipInstruction}` : '')

        step?.('thought', instruction ? 'Requesting memo update from State Tracker…' : `Analyzing recent narrative (${windowed.length} message${windowed.length === 1 ? '' : 's'})…`)
        let raw: unknown
        try {
            raw = await deps.generate.quiet({
                chatId,
                userId,
                ...connectionField(connectionId),
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: prompt.user },
                ],
                signal: deps.signal?.(chatId),
            })
        } catch (error) {
            if (isAbortError(error)) {
                // Nothing has been written at this point: the merge is below.
                // The memo is exactly as it was before the pass started.
                deps.log.info(`tracker pass for chat ${chatId}: stopped by the user`)
                return finish({
                    status: 'cancelled',
                    reason: 'stopped before the model answered — the memo is unchanged',
                    memo: record.memo,
                })
            }
            const reason = `the tracker model call failed: ${describe(error)}`
            deps.log.warn(`tracker pass for chat ${chatId}: ${reason}`)
            return finish({ status: 'failed', reason, memo: record.memo })
        }

        const replyText = readGenerationText(raw)
        const sample = replyText.slice(0, SAMPLE_LENGTH)

        // The `[RELATIONS]` block comes out before the memo is parsed, as the
        // legacy orders it, and its commands land whatever the memo did: the
        // legacy applies them after each chunk's commit, changed or not. On a
        // retrack the replaced reply's awards are put back first, even when
        // the new reply awards nothing.
        let relationshipText = replyText
        let relationshipCommands: RelationshipCommand[] = []
        if (deps.relationships && request.systemPromptMode !== 'modules_only') {
            try {
                ;({ memo: relationshipText, commands: relationshipCommands } = await deps.relationships.extract(replyText, userId))
            } catch (error) {
                deps.log.warn(`tracker pass for chat ${chatId}: the relationship block could not be read: ${describe(error)}`)
            }
        }
        let relations: { relations?: string[]; relationsUnmatched?: string[] } = {}
        if (deps.relationships && request.systemPromptMode !== 'modules_only' && (relationshipCommands.length || isRetrack)) {
            try {
                const placed = await deps.relationships.apply(chatId, userId, relationshipCommands, { source: 'tracker', ...(messageId ? { messageId } : {}), retrack: isRetrack })
                relations = {
                    ...(placed.placed.length ? { relations: placed.placed.map((p) => `${p.label} ${p.field} ${p.delta >= 0 ? '+' : ''}${p.delta} (now ${p.newValue >= 0 ? '+' : ''}${p.newValue})`) } : {}),
                    ...(placed.unmatched.length ? { relationsUnmatched: placed.unmatched } : {}),
                }
            } catch (error) {
                deps.log.warn(`tracker pass for chat ${chatId}: the relationship commands could not be applied: ${describe(error)}`)
            }
        }

        const { text, source } = extractMemo(relationshipText)
        if (source === 'empty') {
            deps.log.warn(`tracker pass for chat ${chatId}: the model returned nothing`)
            return finish(
                { status: 'no-change', reason: 'the tracker model returned an empty reply', memo: record.memo },
                { sample },
            )
        }

        const delta = mergeMemoDetailed(base, text, { bench })
        if (delta.noChange && !isRetrack) {
            // Normal and frequent — most turns change nothing worth tracking.
            // The sample rides along, because this is also what a refusal and a
            // wrong output format look like from here. A bench command for a
            // name nobody has lands here too, and is the one no-change that
            // must say why: silently it reads as a bench that worked.
            return finish(
                {
                    status: 'no-change',
                    reason: delta.unmatched.length
                        ? `the tracker asked to bench or unbench ${delta.unmatched.join(', ')}, but nobody on the roster has that name`
                        : 'the reply carried no [TAG] blocks, so the memo was left alone',
                    memo: record.memo,
                    delta,
                },
                { sample, ...(delta.unmatched.length ? { unmatched: delta.unmatched } : {}), ...relations },
            )
        }

        // After the merge and before the save: the quest block the model just
        // wrote is the one to tidy, and the memo saved here is the one the next
        // prompt will carry.
        const quests = syncQuests(delta.memo, settings)

        const report: TrackerPassReport = {
            status: 'updated',
            at: new Date().toISOString(),
            replaced: delta.replaced,
            added: delta.added,
            removed: delta.removed,
            ...(delta.benched.length ? { benched: delta.benched } : {}),
            ...(delta.unbenched.length ? { unbenched: delta.unbenched } : {}),
            ...(delta.unmatched.length ? { unmatched: delta.unmatched } : {}),
            ...(request.trigger === 'direct' ? { trigger: 'direct' as const } : {}),
            ...(quests.archived.length ? { archived: quests.archived.map((q) => q.title) } : {}),
            ...relations,
        }

        try {
            await deps.memos.save(chatId, quests.memo, userId, {
                previous: base,
                lastMessageId: messageId,
                lastPass: report,
            })
        } catch (error) {
            const reason = `could not save the memo: ${describe(error)}`
            deps.log.error(`tracker pass for chat ${chatId}: ${reason}`)
            return finish({ status: 'failed', reason, memo: record.memo })
        }

        /**
         * Keep what the memo just dropped.
         *
         * After the memo save, not before: the archive is the record of quests
         * that left the memo, and a failed save means they did not leave it.
         * Called even when nothing was archived, because a re-track has to
         * *un*-archive what the pass it replaces concluded — the same roll-back
         * `previous` performs on the memo, keyed on the message id.
         *
         * A failure here is logged and swallowed. Losing the archive of a turn
         * is worth far less than discarding the memo the pass just wrote.
         */
        if (deps.archive) {
            try {
                await deps.archive.record(chatId, quests.archived, userId, {
                    ...(messageId ? { messageId } : {}),
                })
            } catch (error) {
                deps.log.warn(`could not archive finished quests for chat ${chatId}: ${describe(error)}`)
            }
        }

        /**
         * Keep this turn's state, for the card under this message.
         *
         * The memo *after* the pass, keyed on the message the pass read — that
         * is what "the state at this point in the story" means. A re-track
         * overwrites the entry, so a swipe the user rejected leaves nothing
         * behind. Only for a pass that names a message: a manual run belongs to
         * no message and would have no card to sit under.
         *
         * Swallowed on failure, like the archive. A card is worth less than the
         * memo the pass just wrote.
         */
        if (deps.history && messageId) {
            const messageNumber = messageNumberOf(messages, messageId)
            try {
                await deps.history.record(
                    chatId,
                    {
                        messageId,
                        memo: quests.memo,
                        at: report.at,
                        // Which message this state belongs to, as the host
                        // numbers it. The stepper needs it because the clock
                        // times cannot be matched by eye: this pass runs after
                        // the reply and then takes a model call to answer.
                        ...(messageNumber === null ? {} : { messageNumber }),
                    },
                    userId,
                )
            } catch (error) {
                deps.log.warn(`could not record the memo history for chat ${chatId}: ${describe(error)}`)
            }
        }

        deps.log.info(
            `tracker pass for chat ${chatId}: ` +
                `${delta.replaced.length} replaced, ${delta.added.length} added, ${delta.removed.length} removed` +
                (delta.benched.length ? `, benched ${delta.benched.join(', ')}` : '') +
                (delta.unbenched.length ? `, unbenched ${delta.unbenched.join(', ')}` : '') +
                (delta.unmatched.length ? `, no member called ${delta.unmatched.join(', ')}` : '') +
                (quests.archived.length ? `, ${quests.archived.length} quest(s) archived` : ''),
        )

        return finish({ status: 'updated', memo: quests.memo, delta }, report)
    }

    return {
        run(request: TrackerPassRequest): Promise<TrackerPassOutcome> {
            const key = `${request.userId ?? '@self'}::${request.chatId}`
            const chained = (running.get(key) ?? Promise.resolve())
                .catch(() => undefined)
                .then(() => runOnce(request))

            running.set(key, chained)
            // Drop the entry once it settles, so the map does not grow with
            // every chat the user has ever opened.
            void chained.catch(() => undefined).finally(() => {
                if (running.get(key) === chained) running.delete(key)
            })

            return chained
        },
    }
}
