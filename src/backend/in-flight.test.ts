import { describe, expect, it } from 'vitest'

import { InFlightPasses } from './in-flight.js'
import { isAbortError } from '../abort.js'

describe('the passes running right now', () => {
    it('hands a pass a signal that is not yet aborted', () => {
        const passes = new InFlightPasses()
        const signal = passes.begin('tracker', 'chat-1')
        expect(signal.aborted).toBe(false)
        expect(passes.isRunning('tracker', 'chat-1')).toBe(true)
    })

    it('stops a running pass and says it stopped one', () => {
        const passes = new InFlightPasses()
        const signal = passes.begin('agent', 'chat-1')

        expect(passes.cancel('agent', 'chat-1')).toBe(true)
        expect(signal.aborted).toBe(true)
    })

    it('says plainly when there was nothing to stop', () => {
        // Not an error. The press usually arrives just after the last model
        // call returned, and claiming to have cancelled nothing would be worse
        // than saying so.
        expect(new InFlightPasses().cancel('agent', 'chat-1')).toBe(false)
    })

    it('keeps the two kinds apart', () => {
        const passes = new InFlightPasses()
        const tracker = passes.begin('tracker', 'chat-1')
        const agent = passes.begin('agent', 'chat-1')

        passes.cancel('tracker', 'chat-1')
        expect(tracker.aborted).toBe(true)
        expect(agent.aborted).toBe(false)
    })

    it('keeps the chats apart, because the maintainer runs several campaigns', () => {
        const passes = new InFlightPasses()
        const one = passes.begin('agent', 'chat-1')
        const two = passes.begin('agent', 'chat-2')

        passes.cancel('agent', 'chat-2')
        expect(two.aborted).toBe(true)
        expect(one.aborted).toBe(false)
    })

    it('aborts an older pass when a second one starts on the same chat', () => {
        // The legacy's behaviour: two passes racing to write the same memo is
        // worse than losing the older one.
        const passes = new InFlightPasses()
        const first = passes.begin('tracker', 'chat-1')
        const second = passes.begin('tracker', 'chat-1')

        expect(first.aborted).toBe(true)
        expect(second.aborted).toBe(false)
    })

    it('lets a long-lived pass look its own signal up', () => {
        // The tracker pass is built once at startup and runs many times, so it
        // cannot be handed a signal at construction.
        const passes = new InFlightPasses()
        const signal = passes.begin('tracker', 'chat-1')
        expect(passes.current('tracker', 'chat-1')).toBe(signal)
        expect(passes.current('agent', 'chat-1')).toBeUndefined()
    })

    it('forgets a pass that has finished', () => {
        const passes = new InFlightPasses()
        const signal = passes.begin('agent', 'chat-1')
        passes.end('agent', 'chat-1', signal)
        expect(passes.isRunning('agent', 'chat-1')).toBe(false)
    })

    it('does not let a finishing pass clear a newer one', () => {
        // The bug this shape exists to prevent: an old pass unwinding after a
        // new one has started would leave the running pass unstoppable, with a
        // Stop button on screen that does nothing. Two correct pieces of code,
        // wrong between them.
        const passes = new InFlightPasses()
        const first = passes.begin('agent', 'chat-1')
        const second = passes.begin('agent', 'chat-1')

        passes.end('agent', 'chat-1', first)

        expect(passes.isRunning('agent', 'chat-1')).toBe(true)
        expect(passes.current('agent', 'chat-1')).toBe(second)
        expect(passes.cancel('agent', 'chat-1')).toBe(true)
        expect(second.aborted).toBe(true)
    })
})

describe('telling a cancellation from a fault', () => {
    it('recognises the host\'s AbortError', () => {
        const error = new Error('The operation was aborted')
        error.name = 'AbortError'
        expect(isAbortError(error)).toBe(true)
    })

    it('recognises one the host has wrapped', () => {
        const inner = new Error('aborted')
        inner.name = 'AbortError'
        expect(isAbortError(Object.assign(new Error('generation failed'), { cause: inner }))).toBe(true)
    })

    it('does not mistake a real failure for a cancellation', () => {
        // A provider outage reported as a cancellation would put "you stopped
        // this" on screen for something the user did not do.
        expect(isAbortError(new Error('502 from the provider'))).toBe(false)
        expect(isAbortError('aborted')).toBe(false)
        expect(isAbortError(null)).toBe(false)
        expect(isAbortError(undefined)).toBe(false)
    })

    it('does not go by the message text, which is not a contract', () => {
        expect(isAbortError(new Error('AbortError: something else entirely'))).toBe(false)
    })
})
