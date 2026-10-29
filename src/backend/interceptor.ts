/**
 * The prompt interceptor seam.
 *
 * Spindle runs registered interceptors after prompt assembly and before the
 * provider call, which is where tracker state, lorebook fragments and module
 * instructions need to land. It is also, unavoidably, time the user spends
 * watching nothing happen: the budget is 10s by default and every millisecond
 * of it is visible silence before the first token. That is risk R4.
 *
 * The rule that follows, and the reason this module is shaped the way it is:
 *
 *   **The interceptor injects precomputed state. It never computes state.**
 *
 * Anything expensive — the router pass, the lorebook agent, map evolution —
 * runs as a background generation on GENERATION_ENDED and leaves its result
 * where the interceptor can pick it up synchronously. `generate.quiet/raw/
 * batch` do not re-enter the interceptor chain, so those background passes
 * cost nothing here.
 *
 * The handler below therefore takes a *synchronous* provider. If it can't be
 * answered without awaiting, it isn't ready, and the right move is to inject
 * nothing this turn rather than hold the generation open.
 */

import type {
    InterceptorContextDTO,
    InterceptorResultDTO,
    LlmMessageDTO,
} from 'lumiverse-spindle-types'

export interface LogApi {
    info(message: string): void
    warn(message: string): void
    error(message: string): void
}

/** What an injection provider hands back. */
export interface Injection {
    /**
     * Messages to add to the assembled prompt: after everything the host
     * assembled, or before a trailing assistant message (see `injectAt`).
     */
    messages: LlmMessageDTO[]
    /**
     * Label shown in Lumiverse's Prompt Breakdown, so an injected block is
     * inspectable and attributed instead of appearing as anonymous context.
     */
    label?: string
    /**
     * A label per message, where one provider contributes several.
     *
     * Two things inject now -- the tracker memo and the user's own sysprompt
     * sections -- and they are unlike enough that one shared name in the
     * Breakdown would make the larger of them unattributable. Falls back to
     * `label` per message.
     */
    labels?: readonly (string | undefined)[]
}

/**
 * Run several providers as one.
 *
 * Each keeps its own label, so the Prompt Breakdown names them separately. A
 * provider that throws is skipped rather than taking the others down with it:
 * losing the world rules because the memo could not be read would be a strange
 * way to fail.
 */
export function composeInjectionProviders(
    providers: readonly InjectionProvider[],
    log?: LogApi,
): InjectionProvider {
    return (context) => {
        const messages: LlmMessageDTO[] = []
        const labels: (string | undefined)[] = []

        for (const provider of providers) {
            let part: Injection | null = null
            try {
                part = provider(context)
            } catch (error) {
                log?.error(`injection provider failed: ${describe(error)}`)
                continue
            }
            if (!part) continue
            part.messages.forEach((message, index) => {
                messages.push(message)
                labels.push(part!.labels?.[index] ?? part!.label)
            })
        }

        return messages.length ? { messages, labels } : null
    }
}

/**
 * Produce this turn's injection. Synchronous by contract — see the module
 * note. Returning null (the common case) means "nothing to add".
 */
export type InjectionProvider = (context: InterceptorContextDTO) => Injection | null

/** The slice of the Spindle API this module needs. */
export interface InterceptorHost {
    registerInterceptor(
        handler: (messages: LlmMessageDTO[], context: InterceptorContextDTO)
            => Promise<LlmMessageDTO[] | InterceptorResultDTO>,
        priority?: number,
    ): () => void
}

export interface InterceptorOptions {
    host: InterceptorHost
    log: LogApi
    getInjection: InjectionProvider
    /** Lower runs earlier. Left at the host default unless a reason appears. */
    priority?: number
    /**
     * Substitute the host's macros in injected text, if it can.
     *
     * The providers stay synchronous -- see the module note -- and this is the
     * one asynchronous step allowed after them, because `{{user}}` reaching a
     * storyteller literally is a visible fault and resolving it is a local
     * string substitution rather than work. A failure costs the substitution,
     * never the generation.
     */
    resolveMacros?: (text: string, context: InterceptorContextDTO) => Promise<string>
    /**
     * Rewrite the assembled history before this turn's injections go on.
     *
     * The one thing the extension changes in what the host assembled: CYOA
     * mode trims the narrator's older choice blocks out of the history (the
     * legacy's `cyoa-prompt-history.js`), so stale menus stop steering the
     * model. Synchronous and pure, like the providers; a throw costs the
     * rewrite and never the reply.
     */
    rewriteHistory?: (messages: LlmMessageDTO[], context: InterceptorContextDTO) => LlmMessageDTO[]
}

/**
 * Register the state interceptor.
 *
 * Returns a disposer, or null if registration failed — which in practice
 * means the `interceptor` permission has not been granted. That is a
 * degraded-but-working state, not a crash: the panel and cartridges still
 * work, and only injection is missing.
 */
export function registerStateInterceptor(options: InterceptorOptions): (() => void) | null {
    const { host, log, getInjection, priority } = options

    const handler = async (
        messages: LlmMessageDTO[],
        context: InterceptorContextDTO,
    ): Promise<LlmMessageDTO[] | InterceptorResultDTO> => {
        let history = messages
        if (options.rewriteHistory) {
            try {
                history = options.rewriteHistory(messages, context)
            } catch (error) {
                log.error(`interceptor history rewrite failed: ${describe(error)}`)
                history = messages
            }
        }

        let injection: Injection | null = null
        try {
            injection = getInjection(context)
        } catch (error) {
            // A thrown provider must not take the user's generation with it.
            log.error(`interceptor injection failed: ${describe(error)}`)
            return history
        }

        if (!injection || injection.messages.length === 0) return history

        let injected = injection.messages
        if (options.resolveMacros) {
            const resolve = options.resolveMacros
            injected = await Promise.all(
                injection.messages.map(async (message) => {
                    if (typeof message.content !== 'string') return message
                    try {
                        return { ...message, content: await resolve(message.content, context) }
                    } catch (error) {
                        // The unresolved text is worth more than nothing.
                        log.warn(`macro resolution failed: ${describe(error)}`)
                        return message
                    }
                }),
            )
        }

        const at = injectAt(history)
        const combined = [...history.slice(0, at), ...injected, ...history.slice(at)]
        const breakdown = injected.map((_, offset) => ({
            messageIndex: at + offset,
            name: injection.labels?.[offset] ?? injection.label ?? 'AdventureTime',
        }))

        return { messages: combined, breakdown }
    }

    try {
        return host.registerInterceptor(handler, priority)
    } catch (error) {
        log.warn(`interceptor not registered (${describe(error)}); prompt injection is off`)
        return null
    }
}

/**
 * Where this turn's injection goes: the end of the assembled prompt, unless
 * the prompt ends with an assistant message, in which case just before it.
 *
 * A prompt ends with an assistant message when the model is meant to go on
 * from it (Phase 86): a preset's assistant prefill, which Lumiverse adds as
 * the last message, or the reply being continued, which Lumiverse moves to
 * the end as a prefill. Appended after it, our messages made it no longer
 * last -- the Anthropic adapter turned our trailing system messages into a
 * user turn, DeepSeek's prefix completion lost the prefill -- so the model
 * began a new beat instead of finishing the sentence, and Lumiverse still
 * pasted the prefill onto the front of the reply: Continue on a CYOA reply
 * appended whole new prose with a second footer and a second choices block
 * (the maintainer's try of 2026-10-28). Before it, the prefill stays last
 * and the state is still in the prompt.
 */
export function injectAt(history: readonly LlmMessageDTO[]): number {
    const last = history[history.length - 1]
    return last && last.role === 'assistant' ? history.length - 1 : history.length
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
