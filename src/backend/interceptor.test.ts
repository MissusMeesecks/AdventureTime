import { describe, it, expect } from 'vitest'
import type { InterceptorContextDTO, InterceptorResultDTO, LlmMessageDTO } from 'lumiverse-spindle-types'

import { injectAt, registerStateInterceptor, type InterceptorHost, type LogApi } from './interceptor.js'

type Handler = (messages: LlmMessageDTO[], context: InterceptorContextDTO)
    => Promise<LlmMessageDTO[] | InterceptorResultDTO>

/** Captures the handler the extension registers, so tests can call it. */
function makeHost() {
    let handler: Handler | undefined
    let disposed = false
    const host: InterceptorHost = {
        registerInterceptor(h) {
            handler = h
            return () => { disposed = true }
        },
    }
    return {
        host,
        run: (messages: LlmMessageDTO[]) => handler!(messages, {} as InterceptorContextDTO),
        get disposed() { return disposed },
        get registered() { return handler !== undefined },
    }
}

function makeLog(): LogApi & { lines: string[] } {
    const lines: string[] = []
    return { lines, info: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push(m) }
}

const prompt: LlmMessageDTO[] = [
    { role: 'system', content: 'You are a game master.' },
    { role: 'user', content: 'I open the door.' },
]

describe('state interceptor', () => {
    it('returns the prompt untouched when there is nothing to inject', async () => {
        const host = makeHost()
        registerStateInterceptor({ host: host.host, log: makeLog(), getInjection: () => null })

        expect(await host.run(prompt)).toEqual(prompt)
    })

    it('treats an empty injection as nothing to inject', async () => {
        const host = makeHost()
        registerStateInterceptor({ host: host.host, log: makeLog(), getInjection: () => ({ messages: [] }) })

        expect(await host.run(prompt)).toEqual(prompt)
    })

    it('appends injected messages after the assembled prompt', async () => {
        const host = makeHost()
        registerStateInterceptor({
            host: host.host,
            log: makeLog(),
            getInjection: () => ({ messages: [{ role: 'system', content: 'HP 12/20' }], label: 'Tracker' }),
        })

        const result = await host.run(prompt) as InterceptorResultDTO
        expect(result.messages).toHaveLength(3)
        expect(result.messages[2]!.content).toBe('HP 12/20')
    })

    it('labels injected messages so they are attributable in Prompt Breakdown', async () => {
        const host = makeHost()
        registerStateInterceptor({
            host: host.host,
            log: makeLog(),
            getInjection: () => ({
                messages: [{ role: 'system', content: 'a' }, { role: 'system', content: 'b' }],
                label: 'Tracker',
            }),
        })

        const result = await host.run(prompt) as InterceptorResultDTO
        expect(result.breakdown).toEqual([
            { messageIndex: 2, name: 'Tracker' },
            { messageIndex: 3, name: 'Tracker' },
        ])
    })

    it('does not take the generation down when the provider throws', async () => {
        // A bug in state assembly must cost the injection, not the user's turn.
        const host = makeHost()
        const log = makeLog()
        registerStateInterceptor({
            host: host.host,
            log,
            getInjection: () => { throw new Error('state not ready') },
        })

        expect(await host.run(prompt)).toEqual(prompt)
        expect(log.lines[0]).toMatch(/state not ready/)
    })

    it('degrades to no injection when the permission is missing', async () => {
        const log = makeLog()
        const denied: InterceptorHost = {
            registerInterceptor() { throw new Error('permission denied: interceptor') },
        }

        const dispose = registerStateInterceptor({ host: denied, log, getInjection: () => null })

        expect(dispose).toBeNull()
        expect(log.lines[0]).toMatch(/interceptor not registered/)
    })

    it('hands back a working disposer', () => {
        const host = makeHost()
        const dispose = registerStateInterceptor({ host: host.host, log: makeLog(), getInjection: () => null })

        dispose!()
        expect(host.disposed).toBe(true)
    })
})

// Phase 31: CYOA mode trims the narrator's older choice blocks out of the
// history the host assembled, before this turn's injections go on.
describe('a prompt that ends with an assistant message (86)', () => {
    // A preset's assistant prefill, or the reply being continued, which the
    // host moves to the end as a prefill: the model goes on from the last
    // message, so ours go before it, and the breakdown names where they went.
    const provider = () => ({
        messages: [
            { role: 'system', content: 'RULEBOOK' } as LlmMessageDTO,
            { role: 'system', content: 'MEMO' } as LlmMessageDTO,
        ],
        labels: ['AdventureTime — the rulebook', 'AdventureTime — the memo'],
    })

    it('puts the injection before a preset’s assistant prefill, which stays last', async () => {
        const host = makeHost()
        registerStateInterceptor({ host: host.host, log: makeLog(), getInjection: provider })
        const prefilled: LlmMessageDTO[] = [...prompt, { role: 'assistant', content: 'The door' }]
        const out = (await host.run(prefilled)) as InterceptorResultDTO
        expect(out.messages.map((m) => m.content)).toEqual(['You are a game master.', 'I open the door.', 'RULEBOOK', 'MEMO', 'The door'])
        expect(out.messages[out.messages.length - 1]!.role).toBe('assistant')
        expect(out.breakdown).toEqual([
            { messageIndex: 2, name: 'AdventureTime — the rulebook' },
            { messageIndex: 3, name: 'AdventureTime — the memo' },
        ])
    })

    it('puts the injection before the reply being continued, the host’s prefill at the end of a Continue', async () => {
        const host = makeHost()
        registerStateInterceptor({ host: host.host, log: makeLog(), getInjection: provider })
        const continued: LlmMessageDTO[] = [
            { role: 'system', content: 'You are a game master.' },
            { role: 'user', content: 'I open the door.' },
            { role: 'assistant', content: 'The door swings open onto a corridor that' },
        ]
        const out = (await host.run(continued)) as InterceptorResultDTO
        expect(out.messages.map((m) => m.role)).toEqual(['system', 'user', 'system', 'system', 'assistant'])
        expect(out.messages[4]!.content).toBe('The door swings open onto a corridor that')
        expect(out.breakdown!.map((b) => b.messageIndex)).toEqual([2, 3])
    })

    it('still appends after a prompt that ends with the user’s turn, the breakdown counting from the end', async () => {
        const host = makeHost()
        registerStateInterceptor({ host: host.host, log: makeLog(), getInjection: provider })
        const out = (await host.run(prompt)) as InterceptorResultDTO
        expect(out.messages.map((m) => m.content)).toEqual(['You are a game master.', 'I open the door.', 'RULEBOOK', 'MEMO'])
        expect(out.breakdown!.map((b) => b.messageIndex)).toEqual([2, 3])
    })

    it('decides by the last message alone: an assistant turn earlier in the history moves nothing', () => {
        expect(injectAt([{ role: 'assistant', content: 'a' }, { role: 'user', content: 'b' }])).toBe(2)
        expect(injectAt([{ role: 'user', content: 'b' }, { role: 'assistant', content: 'a' }])).toBe(1)
        expect(injectAt([])).toBe(0)
    })
})

describe('rewriting the history', () => {
    const provider = () => ({ messages: [{ role: 'system' as const, content: 'INJECTED' }] })
    const history: LlmMessageDTO[] = [
        { role: 'system', content: 'You are a game master.' },
        { role: 'assistant', content: 'Old <choices><button>a</button></choices>' },
        { role: 'user', content: 'I open the door.' },
    ]

    it('sends the rewritten history with the injections after it, and prices the breakdown from it', async () => {
        const { host, run } = makeHost()
        registerStateInterceptor({
            host,
            log: makeLog(),
            getInjection: provider,
            rewriteHistory: (messages) => messages.filter((m) => m.role !== 'assistant'),
        })
        const out = (await run(history)) as InterceptorResultDTO
        expect(out.messages.map((m) => m.content)).toEqual(['You are a game master.', 'I open the door.', 'INJECTED'])
        expect(out.breakdown).toEqual([{ messageIndex: 2, name: 'AdventureTime' }])
    })

    it('hands the rewrite the generation\'s own context, before the providers run', async () => {
        const { host, run } = makeHost()
        const order: string[] = []
        let seen: unknown
        registerStateInterceptor({
            host,
            log: makeLog(),
            getInjection: (ctx) => { order.push('inject'); void ctx; return provider() },
            rewriteHistory: (m, ctx) => { order.push('rewrite'); seen = ctx; return m },
        })
        await run(history)
        expect(order).toEqual(['rewrite', 'inject'])
        expect(seen).toEqual({})
    })

    it('keeps the history as assembled when the rewrite throws, and still injects', async () => {
        const { host, run } = makeHost()
        const log = makeLog()
        registerStateInterceptor({ host, log, getInjection: provider, rewriteHistory: () => { throw new Error('boom') } })
        const out = (await run(history)) as InterceptorResultDTO
        expect(out.messages.map((m) => m.content)).toEqual([...history.map((m) => m.content), 'INJECTED'])
        expect(log.lines.join('\n')).toContain('history rewrite failed: boom')
    })

    it('returns the rewritten history even when there is nothing to inject', async () => {
        const { host, run } = makeHost()
        registerStateInterceptor({ host, log: makeLog(), getInjection: () => null, rewriteHistory: (m) => m.slice(1) })
        const out = (await run(history)) as LlmMessageDTO[]
        expect(out.map((m) => m.content)).toEqual(['Old <choices><button>a</button></choices>', 'I open the door.'])
    })
})

describe('resolving macros in what we inject', () => {
    const one = (content: string) => ({ messages: [{ role: 'system' as const, content }] })
    const runWith = async (
        getInjection: Parameters<typeof registerStateInterceptor>[0]['getInjection'],
        resolveMacros?: Parameters<typeof registerStateInterceptor>[0]['resolveMacros'],
        context: Partial<InterceptorContextDTO> = {},
    ) => {
        let handler: Handler | undefined
        registerStateInterceptor({
            host: { registerInterceptor(h) { handler = h; return () => {} } },
            log: makeLog(),
            getInjection,
            resolveMacros,
        })
        const out = await handler!([], context as InterceptorContextDTO)
        return out as InterceptorResultDTO
    }

    // The authored sections are full of `{{user}}`. Reaching a storyteller
    // literally is a visible fault, so this is the one awaited step after the
    // synchronous providers.
    it('substitutes the host macros before the prompt goes out', async () => {
        const out = await runWith(
            () => one('about {{user}}'),
            async (text) => text.replace('{{user}}', 'Wrenna'),
        )

        expect(out.messages!.at(-1)!.content).toBe('about Wrenna')
    })

    it('passes the generation its own user and chat', async () => {
        const seen: Array<{ text: string; userId: string }> = []
        await runWith(
            () => one('x'),
            async (text, context) => { seen.push({ text, userId: context.userId }); return text },
            { userId: 'u9', chatId: 'c9' },
        )

        expect(seen).toEqual([{ text: 'x', userId: 'u9' }])
    })

    // The unresolved text is worth more than nothing at all.
    it('keeps the raw text when resolution fails', async () => {
        const out = await runWith(
            () => one('about {{user}}'),
            async () => { throw new Error('macro service down') },
        )

        expect(out.messages!.at(-1)!.content).toBe('about {{user}}')
    })

    it('injects unresolved when no resolver is supplied', async () => {
        const out = await runWith(() => one('{{user}}'))

        expect(out.messages!.at(-1)!.content).toBe('{{user}}')
    })

    // Two injections, two names, or the larger one is unattributable.
    it('names each injected message separately in the breakdown', async () => {
        const out = await runWith(() => ({
            messages: [
                { role: 'system', content: 'rules' },
                { role: 'system', content: 'memo' },
            ],
            labels: ['world rules', 'tracker state'],
        }))

        expect(out.breakdown!.map((b) => b.name)).toEqual(['world rules', 'tracker state'])
    })
})
