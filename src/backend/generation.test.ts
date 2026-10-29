import { describe, it, expect, vi } from 'vitest'
import type { GenerationRequestDTO, LlmMessageDTO } from 'lumiverse-spindle-types'

import {
    createGeneration,
    findUnresolvedMacros,
    resolveMessages,
    warnOnUnresolvedMacros,
    type LogApi,
    type MacroApi,
} from './generation.js'

/** A macro resolver that knows two macros, like the host's would. */
const macros: MacroApi = {
    async resolve(template: string) {
        return { text: template.replace(/\{\{char\}\}/g, 'Vex').replace(/\{\{user\}\}/g, 'Wrenna') }
    },
}

function makeLog(): LogApi & { warnings: string[] } {
    const warnings: string[] = []
    return { warnings, info: () => {}, warn: (m) => warnings.push(m), error: () => {} }
}

describe('macro resolution', () => {
    it('resolves plain string content', async () => {
        const out = await resolveMessages([{ role: 'user', content: 'Hi {{char}}' }], macros)
        expect(out[0]!.content).toBe('Hi Vex')
    })

    it('resolves text parts and leaves other parts alone', async () => {
        const messages: LlmMessageDTO[] = [{
            role: 'user',
            content: [
                { type: 'text', text: 'Look at {{char}}' },
                { type: 'image', data: 'AAA', mime_type: 'image/png' },
            ],
        }]

        const [message] = await resolveMessages(messages, macros)
        const parts = message!.content as Extract<LlmMessageDTO['content'], unknown[]>

        expect(parts[0]).toEqual({ type: 'text', text: 'Look at Vex' })
        expect(parts[1]).toEqual({ type: 'image', data: 'AAA', mime_type: 'image/png' })
    })

    it('does not mutate the messages it was given', async () => {
        const messages: LlmMessageDTO[] = [{ role: 'system', content: '{{user}} is here' }]
        await resolveMessages(messages, macros)
        expect(messages[0]!.content).toBe('{{user}} is here')
    })

    it('passes chat and character context through to the resolver', async () => {
        const resolve = vi.fn(async (text: string) => ({ text }))
        await resolveMessages([{ role: 'user', content: 'x' }], { resolve }, {
            chatId: 'chat-1',
            characterId: 'char-1',
        })
        expect(resolve).toHaveBeenCalledWith('x', expect.objectContaining({
            chatId: 'chat-1',
            characterId: 'char-1',
        }))
    })
})

describe('unresolved macro detection', () => {
    it('finds macro-shaped fragments', () => {
        expect(findUnresolvedMacros('a {{char}} b {{ user }} c')).toEqual(['{{char}}', '{{ user }}'])
    })

    it('finds nothing in ordinary prose', () => {
        expect(findUnresolvedMacros('a plain sentence')).toEqual([])
    })

    it('warns rather than throwing, so a stray brace cannot block a generation', () => {
        const log = makeLog()
        const found = warnOnUnresolvedMacros([{ role: 'user', content: 'Hi {{nope}}' }], log)

        expect(found).toEqual(['{{nope}}'])
        expect(log.warnings[0]).toMatch(/unresolved macros/)
    })

    it('looks inside text parts too', () => {
        const log = makeLog()
        warnOnUnresolvedMacros([{ role: 'user', content: [{ type: 'text', text: '{{nope}}' }] }], log)
        expect(log.warnings).toHaveLength(1)
    })

    it('stays quiet when everything resolved', () => {
        const log = makeLog()
        warnOnUnresolvedMacros([{ role: 'user', content: 'all good' }], log)
        expect(log.warnings).toEqual([])
    })
})

describe('generation wrappers', () => {
    // 45c-bis: a quiet or batch request names no tools unless its caller did; raw is left alone.
    it('sends quiet and batch requests with an empty tool list unless the caller named tools', async () => {
        const calls: GenerationRequestDTO[] = []
        const record = async (input: GenerationRequestDTO) => { calls.push(input); return 'ok' }
        const generation = createGeneration({
            generate: { raw: record, quiet: record, batch: record },
            macros: { resolve: async (text: string) => ({ text }) } as never,
            log: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
        })
        await generation.quiet({ messages: [] })
        await generation.batch({ messages: [] })
        await generation.quiet({ messages: [], tools: [{ name: 'x', description: 'd', parameters: {} }] })
        await generation.raw({ messages: [] })
        expect(calls[0]!.tools).toEqual([])
        expect(calls[1]!.tools).toEqual([])
        expect(calls[2]!.tools).toEqual([{ name: 'x', description: 'd', parameters: {} }])
        expect('tools' in calls[3]!).toBe(false)
    })

    function harness() {
        const calls: GenerationRequestDTO[] = []
        const record = async (input: GenerationRequestDTO) => { calls.push(input); return { content: 'ok' } }
        const log = makeLog()
        const generation = createGeneration({
            generate: { raw: record, quiet: record, batch: record },
            macros,
            log,
        })
        return { calls, log, generation }
    }

    it('resolves macros before dispatching — the whole point of the wrapper', async () => {
        const { calls, generation } = harness()
        await generation.quiet({ messages: [{ role: 'system', content: 'You are {{char}}.' }] })

        expect(calls[0]!.messages![0]!.content).toBe('You are Vex.')
        expect(calls[0]!.type).toBe('quiet')
    })

    it('tags each call with its own generation type', async () => {
        const { calls, generation } = harness()
        await generation.raw({ messages: [] })
        await generation.quiet({ messages: [] })
        await generation.batch({ messages: [] })

        expect(calls.map((c) => c.type)).toEqual(['raw', 'quiet', 'batch'])
    })

    it('keeps macro context out of the request it sends', async () => {
        const { calls, generation } = harness()
        await generation.raw({ messages: [], chatId: 'chat-1', characterId: 'char-1' })

        expect(calls[0]).not.toHaveProperty('chatId')
        expect(calls[0]).not.toHaveProperty('characterId')
    })

    it('forwards the options the host does accept', async () => {
        const { calls, generation } = harness()
        await generation.raw({ messages: [], connection_id: 'cheap-model', parameters: { temperature: 0 } })

        expect(calls[0]!.connection_id).toBe('cheap-model')
        expect(calls[0]!.parameters).toEqual({ temperature: 0 })
    })

    it('warns when a macro survives resolution', async () => {
        const { log, generation } = harness()
        await generation.raw({ messages: [{ role: 'user', content: 'Hello {{unknownMacro}}' }] })
        expect(log.warnings[0]).toMatch(/\{\{unknownMacro\}\}/)
    })

    it('handles a request with no messages at all', async () => {
        const { calls, generation } = harness()
        await generation.raw({ parameters: { max_tokens: 10 } })
        expect(calls[0]!.messages).toBeUndefined()
    })
})

describe('the connection a blank request runs on, and the output length (89)', () => {
    function harness(over: { why?: 'chat' | 'seen' | 'default' | 'first' | 'none'; id?: string | undefined; maxTokens?: number } = {}) {
        const calls: GenerationRequestDTO[] = []
        const asked: Array<[string | undefined, string | undefined]> = []
        const record = async (input: GenerationRequestDTO) => { calls.push(input); return { content: 'ok' } }
        const info: string[] = []
        const log = { ...makeLog(), info: (m: string) => { info.push(m) } }
        const generation = createGeneration({
            generate: { raw: record, quiet: record, batch: record },
            macros,
            log,
            connection: async (chatId, userId) => {
                asked.push([chatId, userId])
                const id = 'id' in over ? over.id : 'c-main'
                return { id, name: id ? 'Main' : '', provider: id ? 'anthropic' : '', model: id ? 'claude' : '', why: over.why ?? 'seen', listed: 2 }
            },
            maxTokens: async () => over.maxTokens ?? 0,
        })
        return { calls, asked, log: { info }, generation }
    }

    it('resolves a blank connection through the resolver for the request’s chat and user, sends the id, and says what it runs on once per short while', async () => {
        const { calls, asked, log, generation } = harness()
        await generation.quiet({ messages: [], chatId: 'chat-1', userId: 'u1' })
        await generation.quiet({ messages: [], chatId: 'chat-1', userId: 'u1' })
        await generation.raw({ messages: [], chatId: 'chat-2', userId: 'u1' })
        expect(asked).toEqual([['chat-1', 'u1'], ['chat-1', 'u1'], ['chat-2', 'u1']])
        expect(calls.map((c) => c.connection_id)).toEqual(['c-main', 'c-main', 'c-main'])
        expect(log.info).toEqual([
            'connection: quiet generation for chat chat-1 runs on "Main" (anthropic · claude) — the narrator’s connection, seen writing the last reply',
            'connection: raw generation for chat chat-2 runs on "Main" (anthropic · claude) — the narrator’s connection, seen writing the last reply',
        ])
    })

    it('leaves a named connection alone and says it was chosen; sends nothing and says so when the resolver finds none', async () => {
        const { calls, asked, log, generation } = harness()
        await generation.quiet({ messages: [], connection_id: 'c-fast', chatId: 'chat-1', userId: 'u1' })
        expect(asked).toEqual([])
        expect(calls[0]!.connection_id).toBe('c-fast')
        expect(log.info).toEqual(['connection: quiet generation for chat chat-1 runs on c-fast — chosen on its row under Connections & models'])
        const none = harness({ id: undefined, why: 'none' })
        await none.generation.quiet({ messages: [], userId: 'u1' })
        expect('connection_id' in none.calls[0]!).toBe(false)
        expect(none.log.info[0]).toBe('connection: quiet generation runs on no connection — no connection at all: Lumiverse lists none; the call goes without one and Lumiverse will refuse it')
    })

    it('goes on without the resolver when it throws, as before 89', async () => {
        const calls: GenerationRequestDTO[] = []
        const record = async (input: GenerationRequestDTO) => { calls.push(input); return 'ok' }
        const generation = createGeneration({ generate: { raw: record, quiet: record, batch: record }, macros, log: makeLog(), connection: async () => { throw new Error('no') } })
        await generation.quiet({ messages: [] })
        expect('connection_id' in calls[0]!).toBe(false)
    })

    it('sends the output length as max_tokens when it is set and the caller named none, and never over a caller’s own', async () => {
        const set = harness({ maxTokens: 3000 })
        await set.generation.quiet({ messages: [], userId: 'u1' })
        await set.generation.batch({ messages: [], userId: 'u1', parameters: { temperature: 0.2 } })
        await set.generation.quiet({ messages: [], userId: 'u1', parameters: { max_tokens: 500 } })
        expect(set.calls.map((c) => c.parameters)).toEqual([{ max_tokens: 3000 }, { temperature: 0.2, max_tokens: 3000 }, { max_tokens: 500 }])
        const blank = harness({ maxTokens: 0 })
        await blank.generation.quiet({ messages: [], userId: 'u1' })
        expect('parameters' in blank.calls[0]!).toBe(false)
    })
})

describe('the debug log (72a)', () => {
    function make(on: boolean) {
        const lines: string[] = []
        const generation = createGeneration({
            generate: { raw: async () => 'the reply', quiet: async () => ({ text: 'quiet reply' }), batch: async () => 'b' },
            macros: { resolve: async (text: string) => ({ text }) } as never,
            log: { info: (m: string) => lines.push(m), warn: () => undefined, error: () => undefined },
            debug: async () => on,
        })
        return { lines, generation }
    }

    it('logs every message and the reply in full while the preference is on', async () => {
        const { lines, generation } = make(true)
        await generation.quiet({ messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content: [{ type: 'text', text: 'hello' }] }], connection_id: 'c1' })
        // The connection line (89) comes first; the debug lines follow.
        expect(lines[0]).toBe('connection: quiet generation runs on c1 — chosen on its row under Connections & models')
        expect(lines[1]).toBe('debug: quiet generation on connection c1, 2 messages')
        expect(lines[2]).toBe('debug: message 1 [system]\nbe brief')
        expect(lines[3]).toBe('debug: message 2 [user]\nhello')
        expect(lines[4]).toBe('debug: quiet reply\n{"text":"quiet reply"}')
    })

    it('logs only the messages new since the last turn of the same conversation, and a fresh pass whole (72c-bis)', async () => {
        const { lines, generation } = make(true)
        const system = { role: 'system' as const, content: 'the whole prompt' }
        const user = { role: 'user' as const, content: 'the story' }
        await generation.quiet({ messages: [system, user], chatId: 'c1', userId: 'u1' })
        await generation.quiet({ messages: [system, user, { role: 'assistant', content: 'Action: grep_lore("x")' }, { role: 'user', content: 'Observation: none' }], chatId: 'c1', userId: 'u1' })
        expect(lines.filter((l) => l.startsWith('debug: ') && !l.startsWith('debug: quiet reply'))).toEqual([
            'debug: quiet generation, 2 messages',
            'debug: message 1 [system]\nthe whole prompt',
            'debug: message 2 [user]\nthe story',
            'debug: quiet generation, 4 messages (the first 2 as logged above)',
            'debug: message 3 [assistant]\nAction: grep_lore("x")',
            'debug: message 4 [user]\nObservation: none',
        ])
        // A new pass starts the conversation over: logged whole, even with the same opening.
        lines.length = 0
        await generation.quiet({ messages: [system, user], chatId: 'c1', userId: 'u1' })
        expect(lines[0]).toBe('debug: quiet generation, 2 messages')
        expect(lines).toHaveLength(4)
        // Another chat, user or kind of call is its own conversation; a changed earlier message is a fresh one.
        lines.length = 0
        await generation.quiet({ messages: [system, user, { role: 'assistant', content: 'a' }], chatId: 'c2', userId: 'u1' })
        expect(lines[0]).toBe('debug: quiet generation, 3 messages')
        lines.length = 0
        await generation.quiet({ messages: [{ role: 'system', content: 'another prompt' }, user, { role: 'assistant', content: 'a' }, { role: 'user', content: 'b' }], chatId: 'c2', userId: 'u1' })
        expect(lines[0]).toBe('debug: quiet generation, 4 messages')
    })

    it('logs nothing while it is off, and nothing without the dependency', async () => {
        const { lines, generation } = make(false)
        await generation.raw({ messages: [{ role: 'user', content: 'x' }] })
        expect(lines).toEqual([])
        const plain: string[] = []
        const bare = createGeneration({
            generate: { raw: async () => 'r', quiet: async () => 'q', batch: async () => 'b' },
            macros: { resolve: async (text: string) => ({ text }) } as never,
            log: { info: (m: string) => plain.push(m), warn: () => undefined, error: () => undefined },
        })
        await bare.quiet({ messages: [] })
        expect(plain).toEqual([])
    })
})
