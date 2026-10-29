// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { createPortraitActions, createPromptEditor, PORTRAIT_FILE_TYPES, MAX_PORTRAIT_BYTES, toDataUrl } from './portrait-actions.js'

function fakeRequest(prefs: Record<string, unknown> = {}) {
    const calls: Array<[string, unknown]> = []
    const request = async <T,>(op: string, params?: Record<string, unknown>): Promise<T> => {
        calls.push([op, params])
        if (op === 'prefs.get') return { prefs } as T
        if (op === 'portraits.prompt') return { name: params?.name, prompt: 'A lean ranger.' } as T
        if (op === 'portraits.draw') return { name: params?.name, provider: 'x', model: 'y' } as T
        return { portraits: {} } as T
    }
    return { calls, request }
}

describe('the prompt editor shared with the cards under the messages (80)', () => {
    it('draws at once without a modal or with Skip the prompt editor ticked, and never writes the prompt then', async () => {
        const none = fakeRequest()
        let written = 0
        expect(await createPromptEditor({ request: none.request })(async () => { written += 1; return { title: 't', prompt: 'p' } })).toEqual({})
        expect(written).toBe(0)
        const skip = fakeRequest({ portraitSkipPromptDialog: true })
        const ui = { showModal: () => ({ root: document.createElement('div'), dismiss: () => undefined }) }
        expect(await createPromptEditor({ request: skip.request, ui })(async () => { written += 1; return { title: 't', prompt: 'p' } })).toEqual({})
        expect(written).toBe(0)
        expect(skip.calls).toEqual([['prefs.get', {}]])
    })
})

describe('the portrait’s buttons for a site with only a bridge (80)', () => {
    it('offers nothing without a chat, the file through the picker and the upload, Remove only when a portrait is stored, and the draw through the ops', async () => {
        const { calls, request } = fakeRequest({ portraitSkipPromptDialog: true })
        let chat: string | null = null
        const portraits: Record<string, string> = { 'Moth Wraith': '/rat.png' }
        const picks: unknown[] = []
        const actions = createPortraitActions({
            request,
            chatId: () => chat,
            portraits: () => portraits,
            uploads: { pickFile: async (options) => { picks.push(options); return [{ name: 'rat.png', bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }] } },
        })
        expect(actions('Moth Wraith')).toBeUndefined()
        chat = 'chat-1'
        const stored = actions('Moth Wraith')!
        expect(stored.kind).toBe('portrait')
        expect(stored.note).toBeUndefined()
        expect(typeof stored.remove).toBe('function')
        expect(actions('Kestrel')!.remove).toBeUndefined()
        await stored.set!()
        expect(picks).toEqual([{ accept: PORTRAIT_FILE_TYPES, maxSizeBytes: MAX_PORTRAIT_BYTES }])
        expect(calls.at(-1)).toEqual(['portraits.upload', { chatId: 'chat-1', name: 'Moth Wraith', dataUrl: toDataUrl(new Uint8Array([1, 2, 3]), 'image/png'), filename: 'rat.png' }])
        await stored.remove!()
        expect(calls.at(-1)).toEqual(['portraits.set', { chatId: 'chat-1', name: 'Moth Wraith', src: '' }])
        await stored.draw!()
        // No modal to edit in: the backend writes the prompt itself, so none is asked for here.
        expect(calls.map(([op]) => op)).not.toContain('portraits.prompt')
        expect(calls.at(-1)).toEqual(['portraits.draw', { chatId: 'chat-1', name: 'Moth Wraith' }])
        // With a modal and Skip the prompt editor ticked: the preference is read, and the draw goes the same way.
        const ticked = fakeRequest({ portraitSkipPromptDialog: true })
        const skipping = createPortraitActions({ request: ticked.request, chatId: () => 'chat-1', portraits: () => ({}), ui: { showModal: () => ({ root: document.createElement('div'), dismiss: () => undefined }) } })
        await skipping('Kestrel')!.draw!()
        expect(ticked.calls.map(([op]) => op)).toEqual(['prefs.get', 'portraits.draw'])
    })

    it('greys the file button with the note when the host has no picker, and hands failures to the reporter given', async () => {
        const { request } = fakeRequest()
        const failures: unknown[] = []
        const actions = createPortraitActions({ request, chatId: () => 'chat-1', portraits: () => ({}), fail: (e) => { failures.push(e) } })
        const offered = actions('Kestrel')!
        expect(offered.set).toBeNull()
        expect(offered.note).toBe('This build has no file picker; a portrait can be drawn, or set from the Portraits in play.')
        expect(offered.fail).toBeDefined()
        offered.fail!(new Error('x'))
        expect(failures).toHaveLength(1)
    })

    it('turns bytes into a data URL in chunks, with the type given or png', () => {
        expect(toDataUrl(new Uint8Array([72, 105]), 'image/jpeg')).toBe('data:image/jpeg;base64,SGk=')
        expect(toDataUrl(new Uint8Array([72, 105]))).toBe('data:image/png;base64,SGk=')
        expect(toDataUrl(new Uint8Array(0x8000 + 3).fill(65)).length).toBeGreaterThan(0x8000)
    })
})
