import { describe, expect, it } from 'vitest'

import { frameworkOff, readDisabledChats, withChatEnabled } from './chat-switch.js'

describe('the per-chat switch (94c)', () => {
    it('reads the map as the chat ids switched off and nothing else', () => {
        expect(readDisabledChats({ a: true, b: false, c: 'yes', ' ': true })).toEqual({ a: true })
        expect(readDisabledChats(undefined)).toEqual({})
        expect(readDisabledChats(['a'])).toEqual({})
        expect(readDisabledChats('a')).toEqual({})
    })

    it('switches one chat on or off without touching the others', () => {
        expect(withChatEnabled({ a: true }, 'b', false)).toEqual({ a: true, b: true })
        expect(withChatEnabled({ a: true, b: true }, 'a', true)).toEqual({ b: true })
        expect(withChatEnabled(undefined, 'a', true)).toEqual({})
    })

    it('reads the master power first, then the chat’s own tick, and on otherwise', () => {
        expect(frameworkOff({ frameworkEnabled: false, disabledChats: {} }, 'a')).toBe('master')
        expect(frameworkOff({ frameworkEnabled: false, disabledChats: { a: true } }, 'a')).toBe('master')
        expect(frameworkOff({ frameworkEnabled: true, disabledChats: { a: true } }, 'a')).toBe('chat')
        expect(frameworkOff({ frameworkEnabled: true, disabledChats: { a: true } }, 'b')).toBeNull()
        expect(frameworkOff({ frameworkEnabled: true, disabledChats: { a: true } }, null)).toBeNull()
        expect(frameworkOff(undefined, 'a')).toBeNull()
        // A file that carries anything but true for a chat reads as on.
        expect(frameworkOff({ disabledChats: { a: 'off' } }, 'a')).toBeNull()
    })
})
