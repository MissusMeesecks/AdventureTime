/**
 * What the Lorebook Agent says it wants to do.
 *
 * The agent is a tool-calling loop: it is given the campaign's lore and the
 * turn's narrative, and it replies in prose that ends with a line like
 *
 *     Action: grep_lore("Iron Syndicate")
 *     Action: commit({"activate": ["NPCs::12"], "record": [ … ]})
 *
 * This module reads that line and nothing else. It makes no host calls, writes
 * no lore and decides nothing about what an action *means* — that is the next
 * layer's job. Keeping it separate is the same split every phase since 3 has
 * used, and here it matters more than usual: the thing on the other side of
 * this parser rewrites the user's campaign lore, so being sure we read the
 * model's intent exactly as the legacy build did is the whole ballgame.
 *
 * `actions.pin.test.ts` checks it against the legacy `parseTextAction` over a
 * corpus of the shapes models actually emit.
 */

/** A parsed tool call: the tool's name, and the arguments it was given. */
export interface AgentAction {
    /** Lower-cased, as the legacy does — `Commit(...)` and `commit(...)` are one tool. */
    name: string
    args: Record<string, unknown>
    /** Opaque identity for the pass log. Not meaningful to the tools themselves. */
    id: string
}

/**
 * Which key a bare string argument fills, per tool.
 *
 * `grep_lore("Iron Syndicate")` is far more common from a model than the
 * object form, and the legacy accepts both. A tool not in this map gets
 * `value`, which is the legacy's fallback and is deliberately kept even though
 * nothing reads it — a model inventing a tool should produce a *parse* the
 * caller can reject by name, not a parse failure that looks like malformed
 * output.
 */
const BARE_ARG_NAMES: Record<string, string> = {
    grep_lore: 'query',
    inspect_book: 'book_name',
    read_entry: 'uid',
}

/** The agent's tools by name; a bare `name(...)` reply is read only for these (45c-bis). */
const KNOWN_ACTIONS: ReadonlySet<string> = new Set(['grep_lore', 'inspect_book', 'read_entry', 'commit'])

/**
 * The host's rendering of a native tool call (45c-bis, lesson 51): with
 * function calling on for the connection, a model in tool mode answers
 * `read_entry` as a function call rather than an `Action:` line, and the
 * host writes it into the reply as
 * `<button-pressed :toolCall='{"id":…,"name":"read_entry","arguments":{…}}'>…</button-pressed>`.
 * The last one wins, as the last `Action` does.
 */
const TOOL_CALL_TAG = /<button-pressed\b[^>]*?:toolCall=(?:'([^']*)'|"([^"]*)")/gi

/** The host's wrapper around a reply's prose beside a tool call (66): `<text>…</text>`. */
const TEXT_SEGMENT_TAG = /<\/?text\b[^>]*>/gi

function decodeAttribute(value: string): string {
    return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

/** A host-rendered tool call out of the reply, or `null`. */
function parseRenderedToolCall(text: string, id: string): AgentAction | null {
    let last: string | null = null
    for (const match of text.matchAll(TOOL_CALL_TAG)) last = match[1] ?? match[2] ?? null
    if (last === null) return null
    const parsed = parseJsonWithColorRepair(decodeAttribute(last))
    if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') return null
    const call = parsed.value as { name?: unknown; arguments?: unknown }
    if (typeof call.name !== 'string' || !call.name.trim()) return null
    const name = call.name.trim().toLowerCase()
    let args: Record<string, unknown> = {}
    if (typeof call.arguments === 'string') {
        // Some hosts send the arguments as a JSON string; a bare string is the one argument.
        const inner = parseJsonWithColorRepair(call.arguments)
        args = inner.ok && inner.value && typeof inner.value === 'object' ? (inner.value as Record<string, unknown>) : { [BARE_ARG_NAMES[name] ?? 'value']: call.arguments }
    } else if (call.arguments && typeof call.arguments === 'object') {
        args = call.arguments as Record<string, unknown>
    }
    // A single-argument tool called with a key the model invented
    // (`address`, `entry`) still names one thing: file it under the key the
    // tool reads.
    const bare = BARE_ARG_NAMES[name]
    if (bare && !(bare in args)) {
        const values = Object.values(args).filter((v) => typeof v === 'string' && v.trim())
        if (values.length === 1) args = { [bare]: values[0] }
    }
    return { name, args, id }
}

/**
 * Unbreak a `<font color="#aabbcc">` inside a JSON string.
 *
 * Sub-module authors colour their lore text, the agent copies that text into a
 * JSON argument, and the quotes around the colour terminate the JSON string
 * early. The legacy repairs it by dropping the quotes rather than escaping
 * them, which is lossy in principle and exactly right in practice: the
 * attribute parses unquoted in every browser, and a lore entry that fails to
 * save is worse than one whose markup is spelled differently.
 */
export function repairJsonColorAttributes(raw: string): string {
    if (!raw || typeof raw !== 'string') return raw
    return raw.replace(/<font\s+color\s*=\s*["'](#[0-9a-fA-F]{3,8}|[a-zA-Z]+)["']/gi, '<font color=$1')
}

/** `JSON.parse`, with the colour repair as a second attempt. */
export function parseJsonWithColorRepair(
    raw: unknown,
): { ok: boolean; value: unknown; error?: string } {
    if (typeof raw !== 'string') return { ok: true, value: raw ?? {} }
    try {
        return { ok: true, value: JSON.parse(raw) }
    } catch (first) {
        try {
            return { ok: true, value: JSON.parse(repairJsonColorAttributes(raw)) }
        } catch {
            return { ok: false, value: {}, error: String(first instanceof Error ? first.message : first) }
        }
    }
}

/**
 * Split the reply on its `Action` markers, tolerating how models decorate them.
 *
 * `**Action:**`, `### Action`, `- Action:` and a bare `Action` all count. The
 * legacy prepends a newline before splitting so an action on the very first
 * line still has one in front of it, and that is load-bearing rather than
 * defensive: a short reply that is *only* the action is a normal thing for a
 * model to produce.
 */
const ACTION_SPLIT = /\n(?:\*\*|\*|__|_|###|##|#|-|\s)*Action\b(?:\*\*|\*|__|_|:|\s)*\s*/i

/**
 * Read the tool call out of an agent reply, or `null`.
 *
 * The **last** `Action` wins. A model that thinks out loud will happily write
 * "I could Action: grep_lore(…) but instead I will…" before its real call, and
 * taking the first one would run the tool it decided against.
 *
 * Fails soft, like every other grammar here: anything unreadable returns
 * `null`, and the caller treats that as a pass that did nothing rather than as
 * an error. A lorebook agent that cannot be understood must leave the lore
 * exactly as it found it.
 */
export function parseAgentAction(text: string, id = `text_${Date.now()}`): AgentAction | null {
    // No `typeof` guard, and deliberately none: the legacy has none either, and
    // one here would be unreachable. Anything that is not a string interpolates
    // into something with no `Action` marker in it and falls out at the split
    // below, so a guard would look load-bearing while testing nothing.
    const rendered = typeof text === 'string' ? parseRenderedToolCall(text, id) : null
    if (rendered) return rendered
    // The host's rendering of a text segment (66): with function calling on,
    // a reply the model wrote as prose comes back as
    // `<text>Action: read_entry("Book::4")</text>`, the tag on the Action's
    // own line where the split looks for a line start, and three such replies
    // ended a pass as unreadable (2026-10-17). The wrapper is the host's, never
    // the model's, so it reads as a line break.
    const unwrapped = typeof text === 'string' ? text.replace(TEXT_SEGMENT_TAG, '\n') : text
    const parts = `\n${unwrapped}`.split(ACTION_SPLIT)
    // No `Action` marker: a reply that is nothing but one of the agent's own
    // calls, `read_entry("Book::4")`, is still a call (45c-bis). Prose that
    // happens to open with a word and a parenthesis is not, since only the
    // four tool names are read this way.
    const bareCall = parts.length < 2 && typeof unwrapped === 'string' ? unwrapped.replace(/<[^>]+>/g, ' ').trim() : ''
    const bareName = bareCall.match(/^(\w+)\s*\(/)?.[1]?.toLowerCase()
    if (parts.length < 2 && !(bareName && KNOWN_ACTIONS.has(bareName))) return null
    const lastPart = parts.length < 2 ? bareCall : parts[parts.length - 1]!.trim()

    const nameMatch = lastPart.match(/^(\w+)\s*\(/)
    if (!nameMatch) return null
    const name = nameMatch[1]!.toLowerCase()

    // Balanced parens rather than a greedy or lazy match: an argument object
    // routinely contains parentheses inside its prose, and both shortcuts get
    // that wrong in opposite directions.
    const parenStart = lastPart.indexOf('(')
    if (parenStart === -1) return null
    let depth = 0
    let end = -1
    for (let i = parenStart; i < lastPart.length; i++) {
        if (lastPart[i] === '(') depth++
        else if (lastPart[i] === ')') {
            depth--
            if (depth === 0) {
                end = i
                break
            }
        }
    }
    // An unclosed call takes the rest of the reply. A model that ran out of
    // output mid-argument still produced something worth trying to read.
    const rawArgs = end !== -1 ? lastPart.slice(parenStart + 1, end) : lastPart.slice(parenStart + 1)

    let cleaned = rawArgs.trim()
    if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
        cleaned = cleaned.replace(/^['"]|['"]$/g, '')
        return { name, args: { [BARE_ARG_NAMES[name] ?? 'value']: cleaned }, id }
    }

    // Trailing commas before a closing brace or bracket, which models emit
    // constantly and `JSON.parse` refuses.
    cleaned = cleaned.replace(/,\s*\}/g, '}').replace(/,\s*\]/g, ']')
    const parsed = parseJsonWithColorRepair(cleaned)
    if (!parsed.ok) return null

    return { name, args: parsed.value as Record<string, unknown>, id }
}
