/**
 * The connection a blank row runs on (89): the chat's own, the narrator's as
 * seen on the interceptor's context, Lumiverse's default-ticked one, the
 * first listed — and nothing, said so, when Lumiverse lists none.
 */
import { describe, expect, it } from 'vitest'

import {
    RESOLVE_CACHE_MS,
    WHY_WORDS,
    connectionIdOf,
    createNarratorConnection,
    describePassConnection,
    type ConnectionSummary,
    type NarratorConnectionDeps,
} from './narrator-connection.js'

const MAIN: ConnectionSummary = { id: 'c-main', name: 'Main', provider: 'anthropic', model: 'claude', isDefault: true }
const FAST: ConnectionSummary = { id: 'c-fast', name: 'Fast', provider: 'openai', model: 'mini', isDefault: false }
const OLD: ConnectionSummary = { id: 'c-old', name: 'Old', provider: 'openai', model: '', isDefault: false }

function harness(over: Partial<NarratorConnectionDeps> & { list?: ConnectionSummary[] | Error; pinned?: Record<string, string>; stored?: string } = {}) {
    const log: string[] = []
    const saved: Array<[string | undefined, string]> = []
    let clock = 1_000
    const deps: NarratorConnectionDeps = {
        listConnections: async () => { if (over.list instanceof Error) throw over.list; return over.list ?? [FAST, MAIN] },
        chatConnection: async (chatId) => over.pinned?.[chatId] ?? null,
        seen: {
            load: async () => over.stored ?? '',
            save: async (userId, id) => { saved.push([userId, id]) },
        },
        log: { info: (m) => log.push(m), warn: (m) => log.push(`warn: ${m}`) },
        now: () => clock,
        ...over,
    }
    const resolver = createNarratorConnection(deps)
    return { resolver, log, saved, tick: (ms: number) => { clock += ms } }
}

describe('reading the reply’s connection off the context', () => {
    it('takes the host’s runtime connectionId first, the typed mainDispatch descriptor second, and nothing from neither', () => {
        expect(connectionIdOf({ connectionId: ' c-1 ', mainDispatch: { descriptor: { connectionId: 'c-2' } } })).toEqual({ id: 'c-1', source: 'connectionId' })
        expect(connectionIdOf({ mainDispatch: { descriptor: { connectionId: 'c-2' } } })).toEqual({ id: 'c-2', source: 'mainDispatch.descriptor.connectionId' })
        expect(connectionIdOf({ connectionId: '', mainDispatch: { descriptor: null } })).toBeNull()
        expect(connectionIdOf({ connectionId: 7, mainDispatch: null })).toBeNull()
        expect(connectionIdOf({})).toBeNull()
    })

    it('remembers the id per user, persists it when it changes, and says once where it came from', () => {
        const { resolver, log, saved } = harness()
        resolver.seen({ userId: 'u1', connectionId: 'c-fast' })
        resolver.seen({ userId: 'u1', connectionId: 'c-fast' })
        resolver.seen({ userId: 'u1', mainDispatch: { descriptor: { connectionId: 'c-main' } } })
        resolver.seen({ userId: 'u2', mainDispatch: { descriptor: { connectionId: 'c-main' } } })
        expect(saved).toEqual([['u1', 'c-fast'], ['u1', 'c-main'], ['u2', 'c-main']])
        expect(log).toEqual([
            'narrator connection: "c-fast" seen on the interceptor’s context as connectionId',
            'narrator connection: "c-main" seen on the interceptor’s context as mainDispatch.descriptor.connectionId',
            'narrator connection: "c-main" seen on the interceptor’s context as mainDispatch.descriptor.connectionId',
        ])
        resolver.seen({ userId: 'u1' })
        resolver.seen({ userId: 'u1' })
        expect(log.at(-1)).toContain('carries no connection id (neither connectionId nor mainDispatch.descriptor)')
        expect(log.filter((l) => l.includes('carries no connection id'))).toHaveLength(1)
        expect(saved).toHaveLength(3)
    })

    it('reports a failed save and keeps the id in memory', async () => {
        const { resolver, log } = harness({ seen: { load: async () => '', save: async () => { throw new Error('disk full') } } })
        resolver.seen({ userId: 'u1', connectionId: 'c-fast' })
        await new Promise((r) => setTimeout(r, 0))
        expect(log.at(-1)).toBe('warn: narrator connection: could not keep "c-fast": Error: disk full')
        expect((await resolver.resolve('chat-1', 'u1')).id).toBe('c-fast')
    })
})

describe('what a blank row runs on', () => {
    it('is the chat’s pinned connection first, when the host still lists it', async () => {
        const { resolver } = harness({ pinned: { 'chat-1': 'c-fast', 'chat-2': 'c-gone' } })
        resolver.seen({ userId: 'u1', connectionId: 'c-main' })
        expect(await resolver.resolve('chat-1', 'u1')).toEqual({ id: 'c-fast', name: 'Fast', provider: 'openai', model: 'mini', why: 'chat', listed: 2 })
        // A pinned id the host no longer lists is skipped, not sent.
        expect(await resolver.resolve('chat-2', 'u1')).toMatchObject({ id: 'c-main', why: 'seen' })
    })

    it('is the narrator’s as seen, from memory or from the persisted copy after a restart, unless the host no longer lists it', async () => {
        const seen = harness()
        seen.resolver.seen({ userId: 'u1', connectionId: 'c-fast' })
        expect(await seen.resolver.resolve('chat-1', 'u1')).toMatchObject({ id: 'c-fast', name: 'Fast', why: 'seen' })
        const restarted = harness({ stored: 'c-fast' })
        expect(await restarted.resolver.resolve(undefined, 'u1')).toMatchObject({ id: 'c-fast', why: 'seen' })
        const deleted = harness({ stored: 'c-gone' })
        expect(await deleted.resolver.resolve('chat-1', 'u1')).toMatchObject({ id: 'c-main', why: 'default' })
        // The persisted copy is read once; a fresher sighting wins over it.
        const fresher = harness({ stored: 'c-main' })
        fresher.resolver.seen({ userId: 'u1', connectionId: 'c-fast' })
        expect(await fresher.resolver.resolve('chat-1', 'u1')).toMatchObject({ id: 'c-fast', why: 'seen' })
    })

    it('falls to Lumiverse’s default-ticked connection, then the first listed, then nothing, each said why', async () => {
        const { resolver } = harness()
        expect(await resolver.resolve('chat-1', 'u1')).toEqual({ id: 'c-main', name: 'Main', provider: 'anthropic', model: 'claude', why: 'default', listed: 2 })
        const unticked = harness({ list: [FAST, OLD] })
        expect(await unticked.resolver.resolve('chat-1', 'u1')).toEqual({ id: 'c-fast', name: 'Fast', provider: 'openai', model: 'mini', why: 'first', listed: 2 })
        const empty = harness({ list: [] })
        expect(await empty.resolver.resolve('chat-1', 'u1')).toEqual({ id: undefined, name: '', provider: '', model: '', why: 'none', listed: 0 })
    })

    it('trusts a pinned or seen id when the list cannot be read, and reports the failed list', async () => {
        const { resolver, log } = harness({ list: new Error('no list'), pinned: { 'chat-1': 'c-x' } })
        expect(await resolver.resolve('chat-1', 'u1')).toEqual({ id: 'c-x', name: '', provider: '', model: '', why: 'chat', listed: -1 })
        expect(log[0]).toBe('warn: narrator connection: Lumiverse would not list the connections: Error: no list')
        expect(await resolver.resolve('chat-2', 'u1')).toMatchObject({ id: undefined, why: 'none', listed: -1 })
    })

    it('reuses a resolution for a few seconds per user and chat, and forgets it on a new sighting', async () => {
        let lists = 0
        const { resolver, tick } = harness({ listConnections: async () => { lists++; return [FAST, MAIN] } })
        await resolver.resolve('chat-1', 'u1')
        await resolver.resolve('chat-1', 'u1')
        await resolver.resolve('chat-2', 'u1')
        expect(lists).toBe(2)
        tick(RESOLVE_CACHE_MS)
        await resolver.resolve('chat-1', 'u1')
        expect(lists).toBe(3)
        resolver.seen({ userId: 'u1', connectionId: 'c-fast' })
        expect(await resolver.resolve('chat-1', 'u1')).toMatchObject({ id: 'c-fast', why: 'seen' })
        expect(lists).toBe(4)
        resolver.forget()
        await resolver.resolve('chat-1', 'u1')
        expect(lists).toBe(5)
    })

    it('describes the connection and the reason for the log, and the refusal to come when there is none', () => {
        expect(describePassConnection({ id: 'c-main', name: 'Main', provider: 'anthropic', model: 'claude', why: 'seen', listed: 2 }))
            .toBe(`"Main" (anthropic · claude) — ${WHY_WORDS.seen}`)
        expect(describePassConnection({ id: 'c-x', name: '', provider: '', model: '', why: 'chat', listed: -1 })).toBe(`c-x — ${WHY_WORDS.chat}`)
        expect(describePassConnection({ id: undefined, name: '', provider: '', model: '', why: 'none', listed: 0 }))
            .toBe('no connection — no connection at all: Lumiverse lists none; the call goes without one and Lumiverse will refuse it')
    })
})
