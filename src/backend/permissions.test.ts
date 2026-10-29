import { describe, expect, it, vi } from 'vitest'

import {
    REQUIRED_PERMISSIONS,
    auditPermissions,
    checkPermissions,
    reportDeniedPermissions,
    type PermissionsApi,
} from './permissions.js'
import manifest from '../../spindle.json' with { type: 'json' }

const log = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })

function api(granted: string[]): PermissionsApi {
    return { has: (permission) => granted.includes(permission), onDenied: () => () => {} }
}

describe('the required permission list', () => {
    it('matches the manifest exactly', () => {
        // The manifest is what the host reads; this list is what the code
        // explains. They drifting apart is how a feature stops working with no
        // error anywhere, which is precisely what happened with chat_mutation.
        expect(REQUIRED_PERMISSIONS.map((p) => p.name).sort()).toEqual([...manifest.permissions].sort())
    })

    it('says what each permission is for', () => {
        for (const permission of REQUIRED_PERMISSIONS) {
            expect(permission.needs, `${permission.name} has no reason recorded`).toBeTruthy()
        }
    })

    it('includes the one that reads chat messages', () => {
        // spindle.chat.getMessages lives in a namespace gated by chat_mutation
        // even though we only read. Without it every tracker pass fails.
        expect(REQUIRED_PERMISSIONS.map((p) => p.name)).toContain('chat_mutation')
    })
})

describe('auditPermissions', () => {
    it('reports everything granted', () => {
        const logger = log()
        const result = auditPermissions(api(REQUIRED_PERMISSIONS.map((p) => p.name)), logger)

        expect(result.missing).toEqual([])
        expect(logger.warn).not.toHaveBeenCalled()
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('generation'))
    })

    it('names each missing permission and what it costs', () => {
        const logger = log()
        const result = auditPermissions(api(['generation']), logger)

        expect(result.missing.map((p) => p.name)).toContain('chat_mutation')
        const warnings = logger.warn.mock.calls.map((c) => String(c[0])).join('\n')
        expect(warnings).toContain('chat_mutation')
        expect(warnings).toContain('reading the recent narrative')
    })

    it('tells the user how to fix it', () => {
        const logger = log()
        auditPermissions(api([]), logger)
        expect(logger.warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/Update the extension/)
    })

    it('degrades to unknown rather than throwing when the host offers no permissions API', () => {
        const logger = log()
        expect(() => auditPermissions(undefined, logger)).not.toThrow()
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unavailable'))
    })

    it('treats a throwing check as not granted', () => {
        const logger = log()
        const result = auditPermissions({ has: () => { throw new Error('nope') } }, logger)
        expect(result.missing).toHaveLength(REQUIRED_PERMISSIONS.length)
    })
})

describe('checkPermissions', () => {
    it('reports what is granted without saying anything about it', () => {
        // The panel asks this per request; it must not fill the log each time.
        const result = checkPermissions(api(['generation', 'chat_mutation']))
        expect(result.granted).toEqual(['generation', 'chat_mutation'])
        expect(result.missing.map((p) => p.name)).toContain('world_books')
        expect(result.checked).toBe(true)
    })

    it('tells "cannot check" apart from "nothing granted"', () => {
        // Both are a pair of empty lists otherwise, and the panel has to word
        // them differently.
        const unknown = checkPermissions(undefined)
        expect(unknown.checked).toBe(false)
        expect(unknown.granted).toEqual([])
        expect(unknown.missing).toEqual([])

        const nothing = checkPermissions(api([]))
        expect(nothing.checked).toBe(true)
        expect(nothing.missing).toHaveLength(REQUIRED_PERMISSIONS.length)
    })
})

describe('reportDeniedPermissions', () => {
    it('logs a blocked call, naming the permission', () => {
        // The backstop for a permission we do not know we need — exactly the
        // situation chat_mutation was in.
        const logger = log()
        let handler: ((detail: { permission?: string; operation?: string }) => void) | null = null
        reportDeniedPermissions({ has: () => true, onDenied: (h) => { handler = h; return () => {} } }, logger)

        handler!({ permission: 'characters', operation: 'characters.list' })

        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('characters'))
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('characters.list'))
    })

    it('returns null when the host does not offer the hook', () => {
        expect(reportDeniedPermissions({ has: () => true }, log())).toBeNull()
        expect(reportDeniedPermissions(undefined, log())).toBeNull()
    })
})
