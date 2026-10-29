import { describe, expect, it, vi } from 'vitest'

import { CHOICES_DISPLAY_SCRIPT, CHOICES_DISPLAY_SCRIPT_NAME, createChoicesDisplay } from './choices-display.js'

function harness(existing: Array<{ id: string; name: string }> = [], failure?: string) {
    const created: Array<{ input: unknown; userId: string | undefined }> = []
    const deleted: Array<{ id: string; userId: string | undefined }> = []
    const listed: unknown[] = []
    const log = { info: vi.fn(), warn: vi.fn() }
    const display = createChoicesDisplay({
        regex: {
            list: async (options) => { listed.push(options); if (failure) throw new Error(failure); return { data: existing } },
            create: async (input, userId) => { created.push({ input, userId }); return { id: 'r1' } },
            delete: async (id, userId) => { deleted.push({ id, userId }); return true },
        },
        log,
    })
    return { display, created, deleted, listed, log }
}

describe('the display regex, wanted (Phase 65)', () => {
    it('installs a display-only script that removes the block, for the user asked', async () => {
        const { display, created, deleted } = harness()
        expect(await display.ensure('u1', true)).toBe('created')
        expect(created).toEqual([{ input: CHOICES_DISPLAY_SCRIPT, userId: 'u1' }])
        expect(deleted).toEqual([])
        expect(CHOICES_DISPLAY_SCRIPT).toMatchObject({ name: CHOICES_DISPLAY_SCRIPT_NAME, target: 'display', placement: ['ai_output'], scope: 'global', replace_string: '' })
        // The pattern is the one the choice extractor reads, so what is hidden
        // is exactly what becomes buttons.
        const re = new RegExp(CHOICES_DISPLAY_SCRIPT.find_regex, CHOICES_DISPLAY_SCRIPT.flags)
        expect('Prose.\n<choices>\n<button>1. Go</button>\n</choices>\nMore.'.replace(re, '')).toBe('Prose.\n\nMore.')
        expect('a <CHOICES>x</CHOICES> b <choices >y</choices >'.replace(re, '')).toBe('a  b ')
    })

    it('finds an existing script by name and creates nothing', async () => {
        const { display, created, listed } = harness([{ id: 'r9', name: CHOICES_DISPLAY_SCRIPT_NAME }])
        expect(await display.ensure('u1', true)).toBe('present')
        expect(created).toEqual([])
        expect(listed[0]).toMatchObject({ target: 'display', userId: 'u1' })
    })

    it('says so when the host refuses, and tries again next time', async () => {
        const { display, log, listed } = harness([], 'PERMISSION_DENIED: regex_scripts')
        expect(await display.ensure('u1', true)).toBe('failed')
        expect(log.warn.mock.calls[0]![0]).toMatch(/could not install.*PERMISSION_DENIED/)
        expect(await display.ensure('u1', true)).toBe('failed')
        expect(listed).toHaveLength(2)
    })
})

describe('the display regex, not wanted', () => {
    it('deletes the script by name, for the user asked, and no other script', async () => {
        const { display, deleted, created, log } = harness([{ id: 'r1', name: 'Somebody else\'s' }, { id: 'r9', name: CHOICES_DISPLAY_SCRIPT_NAME }, { id: 'r10', name: CHOICES_DISPLAY_SCRIPT_NAME }])
        expect(await display.ensure('u1', false)).toBe('removed')
        expect(deleted).toEqual([{ id: 'r9', userId: 'u1' }, { id: 'r10', userId: 'u1' }])
        expect(created).toEqual([])
        expect(log.info.mock.calls[0]![0]).toMatch(/removed the display-only regex script/)
    })

    it('finds nothing to do once it is gone, and lists display scripts only', async () => {
        const { display, deleted, listed } = harness([{ id: 'r1', name: 'Somebody else\'s' }])
        expect(await display.ensure('u1', false)).toBe('absent')
        expect(deleted).toEqual([])
        expect(listed[0]).toMatchObject({ target: 'display', userId: 'u1' })
    })

    it('says so when the host refuses, and tries again next time', async () => {
        const { display, log } = harness([], 'PERMISSION_DENIED: regex_scripts')
        expect(await display.ensure('u1', false)).toBe('failed')
        expect(log.warn.mock.calls[0]![0]).toMatch(/could not remove.*PERMISSION_DENIED/)
    })
})

describe('the memo', () => {
    it('asks once per user and wanted state, again for another user, and again when the preference moves', async () => {
        const { display, listed, created, deleted } = harness()
        await Promise.all([display.ensure('u1', true), display.ensure('u1', true), display.ensure('u1', true)])
        await display.ensure('u1', true)
        expect(listed).toHaveLength(1)
        expect(created).toHaveLength(1)
        await display.ensure('u2', true)
        expect(listed).toHaveLength(2)
        await display.ensure(undefined, true)
        expect(listed).toHaveLength(3)
        expect(listed[2]).not.toHaveProperty('userId')
        // The preference moves: the same user is reconciled the other way.
        await display.ensure('u1', false)
        expect(listed).toHaveLength(4)
        expect(deleted).toEqual([])
        await display.ensure('u1', false)
        expect(listed).toHaveLength(4)
        await display.ensure('u1', true)
        expect(listed).toHaveLength(5)
        expect(created).toHaveLength(4)
    })
})
