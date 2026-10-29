/**
 * The portrait's own buttons on the large view (80), for a site that has a
 * bridge and no panel around it: the cards under the messages. The panel's
 * sites keep their own ops with their notes and hand the modal those; this
 * module is the same three ops — the file through the host's picker and
 * `portraits.upload`, the prompt editor (73f) then `portraits.draw`, and
 * `portraits.set` with nothing — without a note to write to.
 */
import type { PortraitDrawResult, PortraitPromptResult, PortraitsResult, PrefsResult } from '../protocol.js'
import { lookupPortrait } from '../tracker/portraits.js'
import type { PictureActions } from './enlarge.js'
import { askForPrompt, type PromptDialogUi } from './prompt-dialog.js'

/** The portraits' size cap on the host's picker, as the panel asks it (43). */
export const MAX_PORTRAIT_BYTES = 8 * 1024 * 1024

/** The image types the host's picker is asked for, one by one (66): asked as `image/*`, the picker stopped. */
export const PORTRAIT_FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

export function toDataUrl(bytes: Uint8Array, mimeType = 'image/png'): string {
    let binary = ''
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!)
    return `data:${mimeType || 'image/png'};base64,${btoa(binary)}`
}

export interface PromptEditorDeps {
    request<T>(op: 'prefs.get' | 'prefs.patch', params?: Record<string, unknown>): Promise<T>
    ui?: PromptDialogUi
}

/**
 * The prompt editor before a pressed draw (73f): `{}` draws at once on a
 * host without a modal or with *Skip the prompt editor* ticked, `null` is
 * Cancel, and otherwise the prompt as edited.
 */
export function createPromptEditor(deps: PromptEditorDeps): (write: () => Promise<{ title: string; prompt: string }>) => Promise<{ prompt?: string } | null> {
    return async (write) => {
        if (!deps.ui?.showModal) return {}
        const skip = await deps.request<PrefsResult>('prefs.get', {}).then((r) => r.prefs?.portraitSkipPromptDialog === true).catch(() => false)
        if (skip) return {}
        const written = await write()
        const answer = await askForPrompt(deps.ui, { title: written.title, prompt: written.prompt })
        if (!answer) return null
        if (answer.skip) await deps.request<PrefsResult>('prefs.patch', { patch: { portraitSkipPromptDialog: true } }).catch(() => undefined)
        return { prompt: answer.prompt }
    }
}

export interface PortraitActionsDeps {
    request<T>(op: 'portraits.upload' | 'portraits.set' | 'portraits.prompt' | 'portraits.draw' | 'prefs.get' | 'prefs.patch', params?: Record<string, unknown>): Promise<T>
    /** The chat the portraits belong to; none, and nothing is offered. */
    chatId(): string | null
    /** The chat's portraits as last read, for whether one is stored. */
    portraits(): Record<string, string> | undefined
    uploads?: { pickFile(options?: { accept?: string[]; multiple?: boolean; maxSizeBytes?: number }): Promise<Array<{ name: string; bytes: Uint8Array; mimeType?: string }>> }
    ui?: PromptDialogUi
    fail?: (error: unknown) => void
}

/** The actions for one entity's portrait by name; `undefined` with no chat. */
export function createPortraitActions(deps: PortraitActionsDeps): (name: string) => PictureActions | undefined {
    const editedPrompt = createPromptEditor(deps)
    return (name) => {
        const chatId = deps.chatId()
        if (!chatId) return undefined
        const stored = lookupPortrait(deps.portraits() ?? {}, name)
        const set = deps.uploads
            ? async (): Promise<void> => {
                const [picked] = await deps.uploads!.pickFile({ accept: PORTRAIT_FILE_TYPES, maxSizeBytes: MAX_PORTRAIT_BYTES })
                if (!picked) return
                await deps.request<PortraitsResult>('portraits.upload', { chatId, name, dataUrl: toDataUrl(picked.bytes, picked.mimeType), filename: picked.name })
            }
            : null
        const draw = async (): Promise<void> => {
            const edited = await editedPrompt(async () => { const r = await deps.request<PortraitPromptResult>('portraits.prompt', { chatId, name }); return { title: `The portrait of ${r.name}`, prompt: r.prompt } })
            if (!edited) return
            await deps.request<PortraitDrawResult>('portraits.draw', { chatId, name, ...edited })
        }
        return {
            kind: 'portrait',
            set,
            draw,
            ...(stored ? { remove: async () => { await deps.request<PortraitsResult>('portraits.set', { chatId, name, src: '' }) } } : {}),
            ...(deps.uploads ? {} : { note: 'This build has no file picker; a portrait can be drawn, or set from the Portraits in play.' }),
            ...(deps.fail ? { fail: deps.fail } : {}),
        }
    }
}
