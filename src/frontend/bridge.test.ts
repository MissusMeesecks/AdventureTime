import { describe, it, expect, vi } from 'vitest'

import { Bridge, DEFAULT_TIMEOUT_MS, OP_TIMEOUT_MS, RequestTimeoutError, type BridgeHost } from './bridge.js'
import { CHANNEL, type RequestMessage } from '../protocol.js'

/** A loopback host: whatever the panel sends can be replied to by hand. */
function makeHost() {
    const sent: RequestMessage[] = []
    let deliver: ((payload: unknown) => void) | undefined
    let unsubscribed = false

    const host: BridgeHost = {
        sendToBackend(payload) { sent.push(payload as RequestMessage) },
        onBackendMessage(handler) {
            deliver = handler
            return () => { unsubscribed = true }
        },
    }

    return {
        host,
        sent,
        reply(id: string, data: unknown) { deliver!({ channel: CHANNEL, kind: 'response', id, ok: true, data }) },
        fail(id: string, error: string) { deliver!({ channel: CHANNEL, kind: 'response', id, ok: false, error }) },
        emit(name: string, data: unknown) { deliver!({ channel: CHANNEL, kind: 'event', name, data }) },
        raw(payload: unknown) { deliver!(payload) },
        get unsubscribed() { return unsubscribed },
    }
}

describe('Bridge', () => {
    it('resolves a request with the backend reply', async () => {
        const host = makeHost()
        const bridge = new Bridge(host.host)

        const pending = bridge.request<{ ok: number }>('settings.get')
        host.reply(host.sent[0]!.id, { ok: 1 })

        expect(await pending).toEqual({ ok: 1 })
    })

    it('sends a well-formed request', () => {
        const host = makeHost()
        void new Bridge(host.host).request('settings.patch', { patch: { a: 1 } })

        expect(host.sent[0]).toMatchObject({
            channel: CHANNEL,
            kind: 'request',
            op: 'settings.patch',
            params: { patch: { a: 1 } },
        })
    })

    it('rejects with the backend error message', async () => {
        const host = makeHost()
        const bridge = new Bridge(host.host)

        const pending = bridge.request('cartridge.import')
        host.fail(host.sent[0]!.id, 'Could not parse that as JSON.')

        await expect(pending).rejects.toThrow(/Could not parse/)
    })

    it('keeps concurrent requests apart', async () => {
        const host = makeHost()
        const bridge = new Bridge(host.host)

        const first = bridge.request('settings.get')
        const second = bridge.request('cartridge.export')

        host.reply(host.sent[1]!.id, 'second')
        host.reply(host.sent[0]!.id, 'first')

        expect(await first).toBe('first')
        expect(await second).toBe('second')
    })

    it('times out rather than hanging forever', async () => {
        vi.useFakeTimers()
        try {
            const bridge = new Bridge(makeHost().host, { timeoutMs: 100 })
            const pending = bridge.request('settings.get')
            const assertion = expect(pending).rejects.toThrow(/timed out/)
            await vi.advanceTimersByTimeAsync(101)
            await assertion
        } finally {
            vi.useRealTimers()
        }
    })

    it('reports a timeout as a timeout, not as a backend error', async () => {
        // The panel says something quite different about a slow pass than about
        // a failed one, and it tells them apart by type rather than by message.
        vi.useFakeTimers()
        try {
            const bridge = new Bridge(makeHost().host, { timeoutMs: 100 })
            const pending = bridge.request('settings.get')
            const assertion = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError)
            await vi.advanceTimersByTimeAsync(101)
            await assertion
        } finally {
            vi.useRealTimers()
        }
    })

    it('gives a tracker pass longer than a storage read', () => {
        // tracker.run is a whole model round trip. Holding it to the deadline
        // that suits a storage read made the panel report a timeout while the
        // pass was still running — which looks exactly like a broken tracker.
        const bridge = new Bridge(makeHost().host)

        expect(bridge.timeoutFor('settings.get')).toBe(DEFAULT_TIMEOUT_MS)
        expect(bridge.timeoutFor('tracker.run')).toBe(OP_TIMEOUT_MS['tracker.run'])
        expect(bridge.timeoutFor('tracker.run')).toBeGreaterThan(bridge.timeoutFor('tracker.get'))
    })

    it('waits the per-op deadline, not the default one', async () => {
        vi.useFakeTimers()
        try {
            const bridge = new Bridge(makeHost().host, {
                timeoutMs: 100,
                opTimeoutMs: { 'tracker.run': 5_000 },
            })
            const pending = bridge.request('tracker.run')
            const settled = vi.fn()
            void pending.catch(settled)

            await vi.advanceTimersByTimeAsync(101)
            expect(settled).not.toHaveBeenCalled()

            const assertion = expect(pending).rejects.toThrow(/timed out/)
            await vi.advanceTimersByTimeAsync(5_000)
            await assertion
        } finally {
            vi.useRealTimers()
        }
    })

    it('ignores traffic that is not ours', () => {
        const host = makeHost()
        void new Bridge(host.host)
        expect(() => {
            host.raw({ channel: 'someone-else', kind: 'response', id: 'x', ok: true })
            host.raw(null)
            host.raw('nonsense')
        }).not.toThrow()
    })

    it('delivers backend events to subscribers', () => {
        const host = makeHost()
        const bridge = new Bridge(host.host)
        const seen: unknown[] = []

        bridge.on((event) => seen.push(event))
        host.emit('settings.changed', { a: 1 })

        expect(seen).toHaveLength(1)
    })

    it('stops delivering after unsubscribe', () => {
        const host = makeHost()
        const bridge = new Bridge(host.host)
        const seen: unknown[] = []

        bridge.on((event) => seen.push(event))()
        host.emit('settings.changed', {})

        expect(seen).toEqual([])
    })

    it('fails anything in flight when the panel closes', async () => {
        const host = makeHost()
        const bridge = new Bridge(host.host)

        const pending = bridge.request('settings.get')
        bridge.dispose()

        await expect(pending).rejects.toThrow(/panel was closed/)
        expect(host.unsubscribed).toBe(true)
    })
})
