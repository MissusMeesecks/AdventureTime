import { describe, expect, it, vi } from 'vitest'

import { MemoStore, type MemoStorage } from './memo-store.js'
import { DEFAULT_INJECTION_LABEL, createMemoInjection } from './injection.js'
import type { InterceptorContextDTO } from 'lumiverse-spindle-types'

function fakeStorage(): MemoStorage {
    const files = new Map<string, unknown>()
    return {
        async getJson<T>(path: string, options?: { fallback?: T }): Promise<T> {
            return (files.has(path) ? files.get(path) : options?.fallback) as T
        },
        async setJson(path: string, value: unknown): Promise<void> {
            files.set(path, value)
        },
    }
}

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

function context(chatId: string, userId?: string): InterceptorContextDTO {
    return { chatId, userId } as InterceptorContextDTO
}

describe('the memo injection', () => {
    it('injects the chat memo under a heading', async () => {
        const memos = new MemoStore(fakeStorage())
        await memos.save('c1', '[TIME]\n06:15 AM, Day 4\n[/TIME]')

        const injection = createMemoInjection({ memos, log })(context('c1'))
        expect(injection?.messages).toHaveLength(1)
        expect(injection?.messages[0].role).toBe('system')
        expect(injection?.messages[0].content).toContain('## CURRENT STATE')
        expect(injection?.messages[0].content).toContain('06:15 AM, Day 4')
    })

    it('is attributed, so it is inspectable in the Prompt Breakdown', async () => {
        const memos = new MemoStore(fakeStorage())
        await memos.save('c1', '[A]\nx\n[/A]')
        expect(createMemoInjection({ memos, log })(context('c1'))?.label).toBe(DEFAULT_INJECTION_LABEL)
    })

    it('takes the display markers out', async () => {
        // They instruct the card renderer and mean nothing to a storyteller.
        const memos = new MemoStore(fakeStorage())
        await memos.save('c1', '[A]\nAttunement: ((BARCYAN)) 640/1000\n[/A]')
        expect(createMemoInjection({ memos, log })(context('c1'))?.messages[0].content).not.toContain('((')
    })

    it('injects nothing when the chat has no memo yet', async () => {
        const memos = new MemoStore(fakeStorage())
        await memos.load('c1')
        expect(createMemoInjection({ memos, log })(context('c1'))).toBeNull()
    })

    it('injects nothing when the memo has no content left after stripping', async () => {
        const memos = new MemoStore(fakeStorage())
        await memos.save('c1', '((PILL))')
        expect(createMemoInjection({ memos, log })(context('c1'))).toBeNull()
    })

    it('injects nothing when there is no chat', () => {
        const memos = new MemoStore(fakeStorage())
        expect(createMemoInjection({ memos, log })(context(''))).toBeNull()
    })

    it('keeps two chats apart', async () => {
        const memos = new MemoStore(fakeStorage())
        await memos.save('c1', '[A]\nhers\n[/A]')
        await memos.save('c2', '[A]\nhis\n[/A]')

        const provider = createMemoInjection({ memos, log })
        expect(provider(context('c1'))?.messages[0].content).toContain('hers')
        expect(provider(context('c2'))?.messages[0].content).toContain('his')
    })
})

describe('staying out of the latency budget', () => {
    it('never awaits a read — an unloaded memo injects nothing', () => {
        // The interceptor is synchronous by contract. A provider that needed to
        // await would be silence the user watches before the first token.
        const memos = new MemoStore(fakeStorage())
        expect(createMemoInjection({ memos, log })(context('c1'))).toBeNull()
    })

    it('returns a value, never a promise', async () => {
        // The synchronous contract is a type, and a type can be cast away or
        // widened later. This asserts it at runtime instead: a provider that
        // became async would hand the interceptor a thenable, and the whole
        // point of the seam — that it costs no wall-clock time — would be gone
        // with nothing failing.
        const memos = new MemoStore(fakeStorage())
        await memos.save('c1', '[A]\nx\n[/A]')
        const provider = createMemoInjection({ memos, log })

        for (const chatId of ['c1', 'never-loaded', '']) {
            const result: unknown = provider(context(chatId))
            const isThenable = typeof (result as { then?: unknown } | null)?.then === 'function'
            expect(isThenable, `provider(${chatId || 'no chat'}) returned a thenable`).toBe(false)
        }
    })

    it('warms the memo on a miss, so the next turn has it', async () => {
        const storage = fakeStorage()
        await storage.setJson('chats/c1/memo.json', { version: 2, memo: '[A]\nx\n[/A]', updatedAt: 'now' })
        const memos = new MemoStore(storage)
        const provider = createMemoInjection({ memos, log })

        expect(provider(context('c1'))).toBeNull()
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(provider(context('c1'))?.messages[0].content).toContain('[A]')
    })

    it('does not reject into the generation when warming fails', async () => {
        const memos = new MemoStore(fakeStorage())
        vi.spyOn(memos, 'load').mockRejectedValueOnce(new Error('disk on fire'))

        expect(() => createMemoInjection({ memos, log })(context('c1'))).not.toThrow()
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
})
