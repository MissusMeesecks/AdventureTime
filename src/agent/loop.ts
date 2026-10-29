/**
 * The agent's conversation with the model.
 *
 * Everything before this read one thing and stopped: 9a a tool call, 9f the
 * arguments of a commit. This is the part that *runs* — it hands the model the
 * campaign's lore and the turn's narrative, reads the tool call out of the
 * reply, answers it, and asks again, until the model commits or the budget runs
 * out.
 *
 * **It still writes nothing.** `commit` ends the loop with a checked *plan*,
 * which the caller may then apply or discard. That split is deliberate and not
 * temporary scaffolding: a loop that decides and a layer that writes are
 * different concerns, and keeping the deciding half testable without a lorebook
 * in the room is worth more than the convenience of joining them.
 *
 * Three properties are load-bearing, and each has tests on both sides:
 *
 * - **It always terminates.** A turn budget, a bounded number of free retries,
 *   and no path that can spend a turn without either consuming budget or
 *   ending.
 * - **A failure ends the pass, it does not corrupt it.** Anything unreadable,
 *   any tool that throws, any model error leaves the lore untouched and says
 *   what happened.
 * - **Every step is recorded.** A pass that did nothing and a pass that never
 *   ran look identical from the outside, and the panel has to tell them apart.
 */

import { isAbortError } from '../abort.js'
import { parseAgentAction, type AgentAction } from './actions.js'
import { normalizeCommit, type Commit, type CommitReading } from './commit.js'

/**
 * Model calls a pass may spend.
 *
 * The legacy's `routerMaxTurns` was 5, and the first live run here spent all
 * five on searches and never reached a decision. That is not the same number of
 * turns in the two builds: the legacy pasted the active set and an archive index
 * into its prompt, so the model started with a picture of the lore and needed
 * fewer lookups.
 *
 * **That difference is gone, and this number followed it back down.** 9j raised
 * it to ten because the model was handed a list of book *names* and had to
 * search to learn anything, so five turns went entirely on lookups and it never
 * committed. 9o then gave it the index of every entry its books already hold,
 * and the first pass after that committed using *two* of its ten turns. The
 * reason for ten expired at that moment and nobody lowered it — so a pass that
 * kept researching still cost ten sequential model calls, which is what "the
 * lorebook pass is very slow on a tiny campaign" turned out to be.
 *
 * Five is the legacy's number again, and it is now also the legacy's *shape*:
 * `routerMaxTurns` was configurable there and this is configurable here, per
 * install, so nobody has to accept someone else's guess. A budget is a ceiling
 * rather than a target, but a high ceiling invites a model to keep looking.
 */
export const DEFAULT_MAX_TURNS = 5

/** The legacy's `MAX_AGENT_RETRIES`: replies that could not be read at all. */
export const MAX_UNREADABLE_REPLIES = 2

/**
 * An absolute ceiling on model calls, whatever the accounting says.
 *
 * Defence in depth, and it was earned: the turn budget is not the only way out
 * of this loop, because an unreadable reply deliberately refunds its turn. Break
 * the bound on *those* and the loop spins forever against a budget it never
 * spends — which is what happened when that bound was removed on purpose. It did
 * not fail a test; it hung, and a hang is a worse outcome than a red suite.
 *
 * So termination does not rest on the retry accounting being right. Nothing can
 * refund a call against this.
 */
export const HARD_CALL_CEILING = 20

/** One thing that happened, in order, for the panel and the pass report. */
export type AgentStep =
    | { kind: 'thought'; text: string }
    | { kind: 'tool'; name: string; argument: string }
    | { kind: 'observation'; text: string }
    | { kind: 'unreadable'; reply: string }
    | { kind: 'error'; text: string }

/** How a pass ended. */
export type AgentOutcome =
    /** The model committed. `commit` holds what it asked for. */
    | 'committed'
    /** It used its budget without committing. Not an error — often correct. */
    | 'no-commit'
    /** It stopped producing anything readable. */
    | 'unreadable'
    /** The model call itself failed. */
    | 'failed'
    /**
     * The user pressed Stop.
     *
     * Always *before* a commit is applied, because the only interruptible part
     * of a pass is the model call and the write comes after. So a cancelled
     * pass has touched no lorebook, which is the property that makes the button
     * safe to offer.
     */
    | 'cancelled'

export interface AgentPassResult {
    outcome: AgentOutcome
    /** Present only when `outcome` is `committed`. Checked, never raw. */
    commit: Commit | null
    /** Items the commit named that could not be used. */
    problems: string[]
    /** Activation the model asked for and this build does not do. */
    ignoredActivation: CommitReading['ignoredActivation']
    steps: AgentStep[]
    /** Model calls actually spent. */
    turnsUsed: number
    /** One line for the panel, in words. */
    summary: string
}

/** The three read-only tools, and whatever the host needs to serve them. */
export interface AgentTools {
    /** Search the campaign's lore. Returns what the model should see. */
    grepLore(query: string): Promise<string>
    /** List one book's entries. */
    inspectBook(bookName: string): Promise<string>
    /** Read one entry in full. */
    readEntry(id: string): Promise<string>
}

/** One turn of conversation, in the shape the generation wrapper takes. */
export interface AgentMessage {
    role: 'system' | 'user' | 'assistant'
    content: string
}

export interface AgentLoopDeps {
    /** One model call. Returns the reply text. */
    generate(messages: AgentMessage[]): Promise<string>
    tools: AgentTools
    /** Model calls this pass may spend. */
    maxTurns?: number
    /** The chat's Player Card's name (35b), so a commit may address it. */
    playerCard?: string
    log?: { info(message: string): void; warn(message: string): void }
    /** The terminal (71b): each turn's thought, tool call, observation and failure announced as it happens. */
    step?(type: 'thought' | 'tool' | 'result' | 'error', content: string): void
}

/** The terminal's line of a text, as the legacy cuts it: the first so many characters. */
export function clipStep(text: string, max = 200): string {
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
    return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

/**
 * What the model is told when it is nearly out of turns.
 *
 * The first live pass used every turn researching and committed nothing — and
 * had no way to know it was on a clock. Telling it is the cheapest fix there
 * is: a model one turn from the end will commit what it has rather than open
 * another search it cannot act on.
 */
function budgetWarning(left: number): string {
    if (left <= 0) return ''
    if (left === 1) {
        return '\n\nThis is your LAST turn. Commit what you have now — even an empty commit — '
            + 'because there will be no further turn to act on anything you look up.'
    }
    return `\n\n${left} turns left. Start committing rather than opening new searches.`
}

/** How many turns remain before the warning starts. */
export const BUDGET_WARNING_AT = 2

/** What the model is told when its reply could not be read. */
const UNREADABLE_HINT =
    'That reply had no tool call in it. Reply with exactly one line of the form '
    + 'Action: tool_name({...}), using grep_lore, inspect_book, read_entry or commit.'

/** What it is told when it names a tool that does not exist. */
function unknownToolHint(name: string): string {
    return `There is no tool called "${name}". The tools are grep_lore, inspect_book, `
        + 'read_entry and commit.'
}

/**
 * The model's own reasoning, for the step log.
 *
 * `Thought:` when it labels one, otherwise the opening line. Both are the
 * legacy's, and the fallback earns its place: most models narrate without ever
 * writing the word.
 */
export function thoughtFrom(reply: string): string {
    // A model that wraps its reasoning in tags (`<serial-reasoning>`) would
    // otherwise put the tag's name in the log and nothing else (65-ter).
    const plain = reply.replace(/<[^>]+>/g, ' ')
    const labelled = plain.match(/Thought:\s*(.*)/i)?.[1]?.trim()
    const text = labelled || plain.trim().split('\n')[0]?.trim() || ''
    return text.slice(0, 200)
}

/**
 * The single string a tool call was given, whatever key it arrived under.
 *
 * A commit has no single string, so its line counts what it carried
 * (`record 2, rel 2`; 65-bis): the transcript read `commit()` while the
 * report refused two items, and nothing on screen said what shape they
 * had come in.
 */
function argumentOf(action: AgentAction): string {
    const args = action.args ?? {}
    if (action.name === 'commit') {
        return Object.entries(args)
            .filter(([key, value]) => key !== 'reason' && (Array.isArray(value) ? value.length > 0 : value && typeof value === 'object' && Object.keys(value).length > 0))
            .map(([key, value]) => `${key} ${Array.isArray(value) ? value.length : Object.keys(value as object).length}`)
            .join(', ')
    }
    for (const key of ['query', 'book_name', 'uid', 'value', 'id']) {
        const value = args[key]
        if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return ''
}

/**
 * Run one pass.
 *
 * `messages` is the conversation as the caller assembled it — the system
 * prompt, the lore, the narrative. This adds the model's replies and the tools'
 * answers to it and hands back what happened.
 */
export async function runAgentLoop(
    messages: AgentMessage[],
    deps: AgentLoopDeps,
): Promise<AgentPassResult> {
    const maxTurns = Math.max(1, deps.maxTurns ?? DEFAULT_MAX_TURNS)
    const conversation: AgentMessage[] = [...messages]
    const steps: AgentStep[] = []

    let turnsUsed = 0
    let unreadable = 0
    /** Model calls made, refundable by nothing. */
    let calls = 0

    const done = (
        outcome: AgentOutcome,
        summary: string,
        reading?: CommitReading,
    ): AgentPassResult => ({
        outcome,
        commit: reading?.commit ?? null,
        problems: reading?.problems ?? [],
        ignoredActivation: reading?.ignoredActivation ?? { activate: [], deactivate: [] },
        steps,
        turnsUsed,
        summary,
    })

    /** Say something back to the model, and record it. */
    const observe = (reply: string, observation: string): void => {
        conversation.push({ role: 'assistant', content: reply })
        conversation.push({ role: 'user', content: observation })
        steps.push({ kind: 'observation', text: observation })
    }

    while (turnsUsed < maxTurns) {
        if (calls >= HARD_CALL_CEILING) {
            // Only reachable if the accounting above has a bug. Saying so is
            // better than looping, and better than pretending it was a clean
            // no-commit.
            steps.push({ kind: 'error', text: `stopped at the ${HARD_CALL_CEILING}-call ceiling` })
            deps.log?.warn(`lorebook agent: hit the ${HARD_CALL_CEILING}-call ceiling`)
            return done('unreadable', `The agent stopped after ${calls} model calls without settling.`)
        }
        turnsUsed++
        calls++
        deps.step?.('thought', `Thinking (turn ${turnsUsed}/${maxTurns})…`)

        let reply: string
        try {
            // A copy, not the live array. The loop keeps appending to
            // `conversation`, so a `generate` that holds what it was given —
            // a queue, a logger, a test spy — would watch it change underneath.
            reply = await deps.generate([...conversation])
        } catch (error) {
            if (isAbortError(error)) {
                steps.push({ kind: 'error', text: 'stopped by the user' })
                deps.step?.('error', 'Stopped by user.')
                deps.log?.info('lorebook agent: stopped by the user')
                return done(
                    'cancelled',
                    `Stopped after ${turnsUsed} turn${turnsUsed === 1 ? '' : 's'}. Nothing was written.`,
                )
            }
            const text = error instanceof Error ? error.message : String(error)
            steps.push({ kind: 'error', text })
            deps.step?.('error', text)
            deps.log?.warn(`lorebook agent: model call failed: ${text}`)
            return done('failed', `The agent could not reach the model: ${text}`)
        }

        const action = parseAgentAction(reply)

        if (!action) {
            // A reply with no tool call in it. The legacy re-prompts without
            // charging the turn; bounded, or a model that never complies would
            // loop until the budget it is not spending runs out — which it
            // never would.
            steps.push({ kind: 'unreadable', reply: reply.slice(0, 400) })
            deps.step?.('thought', `No action in the reply, nudging the model (retry ${unreadable + 1}/${MAX_UNREADABLE_REPLIES})…`)
            unreadable++
            if (unreadable > MAX_UNREADABLE_REPLIES) {
                return done('unreadable', `The agent stopped making sense after ${turnsUsed} tries.`)
            }
            turnsUsed--
            observe(reply, UNREADABLE_HINT)
            continue
        }

        const thought = thoughtFrom(reply)
        if (thought) {
            steps.push({ kind: 'thought', text: thought })
            // The feed's tool line says the action; a reply with no reasoning before it has no thought to show.
            if (!/^Action:/i.test(thought)) deps.step?.('thought', clipStep(thought))
        }

        const argument = argumentOf(action)
        steps.push({ kind: 'tool', name: action.name, argument })
        deps.step?.('tool', `${action.name}(${clipStep(argument, 120)})`)

        if (action.name === 'commit') {
            const reading = normalizeCommit(action.args, deps.playerCard ? { playerCard: deps.playerCard } : {})
            return done('committed', summarizeCommit(reading), reading)
        }

        let observation: string
        try {
            if (action.name === 'grep_lore') observation = await deps.tools.grepLore(argument)
            else if (action.name === 'inspect_book') observation = await deps.tools.inspectBook(argument)
            else if (action.name === 'read_entry') observation = await deps.tools.readEntry(argument)
            else observation = unknownToolHint(action.name)
        } catch (error) {
            // A tool that fails is something the model can work around — a book
            // that does not exist, an entry already gone. Telling it beats
            // ending the pass.
            const text = error instanceof Error ? error.message : String(error)
            observation = `That tool failed: ${text}`
            steps.push({ kind: 'error', text })
            deps.step?.('error', text)
        }
        deps.step?.('result', clipStep(observation))

        // The warning rides along with the tool's answer rather than as its own
        // message, so the model reads both in one turn.
        const left = maxTurns - turnsUsed
        observe(reply, left <= BUDGET_WARNING_AT ? `${observation}${budgetWarning(left)}` : observation)
    }

    return done(
        'no-commit',
        `The agent used all ${maxTurns} of its turns without committing — it was still researching `
        + 'when it ran out.',
    )
}

/** One line describing what a commit asked for. */
export function summarizeCommit(reading: CommitReading): string {
    const { commit, problems, ignoredActivation } = reading
    const parts: string[] = []
    const add = (n: number, one: string, many = `${one}s`): void => {
        if (n) parts.push(`${n} ${n === 1 ? one : many}`)
    }

    add(commit.record.length, 'new entry', 'new entries')
    add(commit.update.length, 'update')
    add(commit.rewrite.length, 'rewrite')
    add(commit.rename.length, 'rename')
    add(commit.consolidate.length, 'merge')
    add(commit.deleteIds.length, 'deletion')
    add(commit.core.length, 'field edit')

    let summary = parts.length ? `The agent asked for ${parts.join(', ')}.` : 'The agent committed no changes.'
    if (problems.length) summary += ` ${problems.length} item${problems.length === 1 ? '' : 's'} could not be used.`

    const ignored = ignoredActivation.activate.length + ignoredActivation.deactivate.length
    if (ignored) {
        // Said out loud rather than swallowed: the stock prompt still asks the
        // model to curate an active set, and a commit that silently does less
        // than it was asked looks half-broken.
        summary += ` ${ignored} activation request${ignored === 1 ? '' : 's'} ignored — Lumiverse handles that.`
    }
    if (commit.rel.length) {
        // Named apart from the changes above, because the writer does not
        // apply these: the relationship store does, after the write (44), and
        // the pass says what became of them. A rel-only commit is still a
        // commit that wrote nothing to the books. See `Commit.rel`.
        const n = commit.rel.length
        summary += ` ${n} relationship change${n === 1 ? '' : 's'} asked for.`
    }
    return summary
}
