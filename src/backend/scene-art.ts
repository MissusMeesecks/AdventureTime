/**
 * The scene picture, drawn (Phase 49, roadmap row 49): the legacy's
 * Real-Time Visualization Mode through Lumiverse's own image generation.
 *
 * One model call on the agent's connection writes an image prompt from the
 * place (`scene-prompt.ts`, the legacy's `generateLocationImagePrompt`), the
 * host's image connection draws it (`spindle.imageGen.generate`, the
 * `image_gen` permission), and the picture is kept where a
 * picture set by hand goes — the chat's portraits under the place's pin —
 * so the fold, the lookup (42) and the parent chain's "reference art" all
 * read it the same way.
 *
 * **Draw the picture** in the fold draws now. **Draw a picture on its own**
 * is the legacy's Real-Time Mode, checked after every reply: on arriving at
 * a place with no picture; whenever the place changes, revisits too (the
 * legacy's default); or every N replies besides. The legacy fails closed —
 * one failed request switches the mode off, after a retry-loop bug cost its
 * users money (`realtime-visualization-guard.js`) — and so does this: a
 * failed draw on its own switches the preference off and says so, and the
 * fold's tick is the way back in.
 */

import { formatLocationBreadcrumb, locationImageKey, normalizeLocationPath, type SceneMessage } from '../tracker/scene.js'
import { ancestorLocationPaths, buildScenePrompt, SCENE_PROMPT_LIMITS, type ScenePromptAncestor } from '../tracker/scene-prompt.js'
import { recentNarrations } from '../tracker/scene.js'
import { lookupPortrait } from '../tracker/portraits.js'
import type { SceneConnectionsResult, SceneDrawResult, ScenePromptResult, ScenePictureReport, SceneResult } from '../protocol.js'
import type { Scene } from './scene.js'
import { DEFAULT_SCENE_PICTURE_EVERY_N, type ScenePictureTrigger } from './prefs-store.js'

export interface SceneArtPrefs {
    scenePictureAuto?: boolean
    scenePictureTrigger?: ScenePictureTrigger
    scenePictureEveryN?: number
    scenePicturePresentNpcs?: boolean
    scenePictureConnectionId?: string
}

export interface SceneArtDeps {
    scene: Pick<Scene, 'get' | 'places'>
    /** The cartridge, for the location prompt and its word target. */
    settings: { load(userId: string | undefined): Promise<Record<string, unknown>> }
    prefs: {
        load(userId: string | undefined): Promise<SceneArtPrefs>
        patch(patch: Partial<SceneArtPrefs>, userId: string | undefined): Promise<unknown>
    }
    messages: (chatId: string, userId: string | undefined) => Promise<SceneMessage[]>
    portraits: {
        load(chatId: string, userId: string | undefined): Promise<{ portraits: Record<string, string> }>
        set(chatId: string, name: string, src: string, userId: string | undefined): Promise<unknown>
    }
    /** The model call that writes the image prompt: the system and user prompts in, the text out. */
    generate: (system: string, user: string, chatId: string, userId: string | undefined) => Promise<string>
    /** The host's image generation; absent when the grant is missing. */
    imageGen?: {
        generate(input: { prompt: string; connection_id?: string; owner_chat_id?: string; owner_character_id?: string; userId: string | undefined }): Promise<{ imageDataUrl: string; imageUrl?: string; imageId?: string; model: string; provider: string }>
        listConnections(userId: string | undefined): Promise<Array<{ id: string; name: string; provider: string; model: string; is_default: boolean; default_parameters?: Record<string, unknown>; metadata?: Record<string, unknown> }>>
    }
    /** The host's image store: the upload for a result that came back as data only, owned by the chat as the draw is (55-bis). */
    images?: {
        uploadFromDataUrl(dataUrl: string, options: { originalFilename: string; owner_chat_id?: string; owner_character_id?: string; userId: string | undefined }): Promise<{ url?: string; id?: string } | null | undefined>
    }
    /** The active persona's text, for the art style; absent when the grant is missing. */
    persona?: (userId: string | undefined) => Promise<{ description: string } | null>
    /** The narrator's card, for the world the prompt describes; absent when either grant is missing. */
    narrator?: (chatId: string, userId: string | undefined) => Promise<{ id: string; name?: string; description: string } | null>
    events?: {
        started(chatId: string, userId: string | undefined, path: string, at: string): void
        finished(chatId: string, userId: string | undefined, report: ScenePictureReport): void
    }
    log: { info(m: string): void; warn(m: string): void }
    now?: () => Date
}

export interface SceneArt {
    /** Draw the picture of where the party is, now, on a press. */
    /**
     * Draw now (49); with `prompt`, the text the user edited is drawn instead of a freshly written one (73f);
     * with `path`, the picture of that place rather than the party's (80, the Campaign Records' location images).
     */
    draw(chatId: string, userId: string | undefined, prompt?: string, path?: string): Promise<SceneDrawResult>
    /** Write the prompt and hand it back for editing (73f, Multihog's prompt dialog): one model call, nothing drawn. */
    prompt(chatId: string, userId: string | undefined, path?: string): Promise<ScenePromptResult>
    /** The Real-Time check after a reply: draws in the background when the mode says so. */
    afterReply(chatId: string, userId: string | undefined): Promise<void>
    /** The draw in flight for the chat, if any. */
    drawing(chatId: string): { path: string; at: string } | null
    /** The host's image connections, for the fold's select. */
    connections(userId: string | undefined): Promise<SceneConnectionsResult>
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

/** A saved setting's value in a few words, for the fold's line: a list by its length, an object by its keys. */
export function settingWords(value: unknown): string {
    if (value === null || value === undefined) return 'none'
    if (Array.isArray(value)) return value.length === 0 ? 'an empty list' : `${value.length} ${value.length === 1 ? 'item' : 'items'}`
    if (typeof value === 'object') {
        const keys = Object.keys(value as object)
        return keys.length ? `{${keys.join(', ')}}` : '{}'
    }
    const text = String(value)
    return text.length > 40 ? `${text.slice(0, 37)}…` : text
}

const NO_GRANT = 'This build cannot draw pictures: the host has not granted the image_gen permission.'

export function createSceneArt(deps: SceneArtDeps): SceneArt {
    const now = deps.now ?? (() => new Date())
    const inFlight = new Map<string, { path: string; at: string }>()
    /** The legacy's visit tracking, per chat and per session: the last place drawn for, and the chat's length then. */
    const lastPath = new Map<string, string>()
    const lastLength = new Map<string, number>()

    async function writePrompt(chatId: string, userId: string | undefined, scene: SceneResult, includeNpcs: boolean): Promise<{ prompt: string }> {
        const settings = await deps.settings.load(userId).catch(() => ({} as Record<string, unknown>))
        const systemPrompt = typeof settings.portraitLocationSystemPrompt === 'string' ? settings.portraitLocationSystemPrompt : ''
        if (!systemPrompt.trim()) throw new Error('The cartridge has no location prompt (portraitLocationSystemPrompt).')
        const wordTarget = Number(settings.portraitPromptWordTarget) || 200
        const path = scene.location.path || scene.location.storagePath
        const places = await deps.scene.places(chatId, userId).catch(() => [])
        const portraits = (await deps.portraits.load(chatId, userId).catch(() => ({ portraits: {} }))).portraits
        const ancestors: ScenePromptAncestor[] = ancestorLocationPaths(path).map((ancestor) => ({
            path: ancestor,
            content: places.find((p) => p.path === ancestor)?.content ?? '',
            hasArt: !!lookupPortrait(portraits, locationImageKey(ancestor)),
        }))
        const messages = await deps.messages(chatId, userId).catch(() => [] as SceneMessage[])
        // Newest first from the scan; the prompt wants them oldest first.
        const narrations = recentNarrations(messages, SCENE_PROMPT_LIMITS.narrationsRead).reverse()
        const present = scene.present.filter((who) => who.isPlayerCharacter || includeNpcs).map((who) => ({ label: who.label, content: who.content, isPlayerCharacter: who.isPlayerCharacter }))
        const persona = deps.persona ? (await deps.persona(userId).catch(() => null))?.description ?? '' : ''
        const narrator = await narratorOf(chatId, userId)
        const { system, user } = buildScenePrompt({ path, content: scene.location.content, ancestors, narrations, present, persona, narratorDescription: narrator?.description ?? '', systemPrompt, wordTarget })
        const prompt = (await deps.generate(system, user, chatId, userId)).trim()
        if (!prompt) throw new Error('The model returned no image prompt.')
        return { prompt }
    }

    /** The narrator's card, for the world the prompt describes; absent or unreadable, none. */
    async function narratorOf(chatId: string, userId: string | undefined): Promise<{ id: string; description?: string } | null> {
        return deps.narrator ? await deps.narrator(chatId, userId).catch(() => null) : null
    }

    async function drawFor(chatId: string, userId: string | undefined, scene: SceneResult, trigger: ScenePictureReport['trigger'], given?: string): Promise<SceneDrawResult> {
        const path = scene.location.storagePath
        if (!path) throw new Error('No place is named yet: the last reply had no Location footer, and the memo no Location line.')
        if (!deps.imageGen) throw new Error(NO_GRANT)
        if (inFlight.has(chatId)) throw new Error(`A picture is already being drawn for ${inFlight.get(chatId)!.path}.`)
        const at = now().toISOString()
        inFlight.set(chatId, { path, at })
        deps.events?.started(chatId, userId, path, at)
        const leaf = scene.location.leaf || path
        try {
            const prefs = await deps.prefs.load(userId)
            const edited = (given ?? '').trim()
            deps.log.info(`scene: drawing the picture of "${path}" for chat ${chatId} (${trigger}${edited ? ', the prompt as edited' : ''})`)
            // The edited prompt (73f) is drawn as given.
            const { prompt } = edited ? { prompt: edited } : await writePrompt(chatId, userId, scene, prefs.scenePicturePresentNpcs !== false)
            const connection = (prefs.scenePictureConnectionId ?? '').trim()
            // The picture is the chat's (87): the gallery switch that owned it by the narrator's card is gone, since
            // the host's Gallery tab never listed an extension's images (56-ter); an AdventureTime gallery is the
            // post-release list's.
            const owners = { owner_chat_id: chatId }
            const drawn = await deps.imageGen.generate({ prompt, ...(connection ? { connection_id: connection } : {}), ...owners, userId })
            let src = (drawn.imageUrl ?? '').trim()
            if (!src) {
                if (!deps.images) throw new Error('The image came back as data and this build cannot store images.')
                // The same owners as the draw (55-bis): a copy stored here with none would be the one the chat shows.
                const stored = await deps.images.uploadFromDataUrl(drawn.imageDataUrl, { originalFilename: `scene-${leaf.replace(/[^\w-]+/g, '_')}.png`, ...owners, userId })
                if (!stored?.url) throw new Error('The image was stored but the host returned no address for it.')
                src = stored.url
            }
            await deps.portraits.set(chatId, locationImageKey(path), src, userId)
            deps.log.info(`scene: the picture of "${path}" drawn by ${drawn.provider} (${drawn.model}), ${trigger}`)
            const result: SceneDrawResult = { scene: await deps.scene.get(chatId, userId), path, leaf, at, prompt, provider: drawn.provider, model: drawn.model }
            inFlight.delete(chatId)
            deps.events?.finished(chatId, userId, { chatId, path, leaf, at, trigger, outcome: 'drawn', prompt, provider: drawn.provider, model: drawn.model })
            return result
        } catch (error) {
            inFlight.delete(chatId)
            const reason = describe(error)
            deps.log.warn(`scene: the picture of "${path}" could not be drawn (${trigger}): ${reason}`)
            let disabled = false
            if (trigger !== 'pressed') {
                // Fail closed, as the legacy does: one failure switches the mode off.
                disabled = true
                await deps.prefs.patch({ scenePictureAuto: false }, userId).catch((patchError) => {
                    deps.log.warn(`scene: drawing on its own could not be switched off: ${describe(patchError)}`)
                })
                deps.log.warn('scene: drawing on its own is switched off after one failure; tick it again to retry')
            }
            deps.events?.finished(chatId, userId, { chatId, path, leaf, at, trigger, outcome: 'failed', reason, ...(disabled ? { disabled } : {}) })
            throw error
        }
    }

    /**
     * The scene as read, or with its location swapped for a named place (80):
     * a location image set or drawn from the Campaign Records is that entry's,
     * wherever the party stands. The place's own text and its stored picture
     * go in as the party's would; the rest of the scene (who is present, the
     * recent story) stays the chat's.
     */
    async function sceneAt(chatId: string, userId: string | undefined, path: string | undefined): Promise<SceneResult> {
        const scene = await deps.scene.get(chatId, userId)
        const named = normalizeLocationPath(path)
        if (!named) return scene
        const places = await deps.scene.places(chatId, userId).catch(() => [])
        const place = places.find((p) => normalizeLocationPath(p.path) === named) ?? null
        const portraits = (await deps.portraits.load(chatId, userId).catch(() => ({ portraits: {} }))).portraits
        return {
            ...scene,
            location: {
                raw: named,
                path: place ? place.path : '',
                leaf: named.split(' :: ').pop() ?? named,
                breadcrumb: place ? formatLocationBreadcrumb(place.path) : '',
                storagePath: named,
                image: lookupPortrait(portraits, locationImageKey(named)),
                entryId: '',
                content: place?.content ?? '',
            },
        }
    }

    return {
        async draw(chatId, userId, prompt, path) {
            const scene = await sceneAt(chatId, userId, path)
            return drawFor(chatId, userId, scene, 'pressed', prompt)
        },

        async prompt(chatId, userId, named) {
            const scene = await sceneAt(chatId, userId, named)
            const path = scene.location.storagePath
            if (!path) throw new Error('No place is named yet: the last reply had no Location footer, and the memo no Location line.')
            const prefs = await deps.prefs.load(userId)
            deps.log.info(`scene: writing the prompt for "${path}" for chat ${chatId}, to be edited before the draw`)
            const { prompt } = await writePrompt(chatId, userId, scene, prefs.scenePicturePresentNpcs !== false)
            return { path, leaf: scene.location.leaf || path, prompt }
        },

        async afterReply(chatId, userId) {
            const prefs = await deps.prefs.load(userId)
            if (!prefs.scenePictureAuto || !deps.imageGen) return
            const scene = await deps.scene.get(chatId, userId)
            const path = scene.location.storagePath
            if (!path) return
            const mode: ScenePictureTrigger = prefs.scenePictureTrigger ?? 'location_change'
            const everyN = Math.max(1, Math.floor(Number(prefs.scenePictureEveryN) || DEFAULT_SCENE_PICTURE_EVERY_N))
            const changed = lastPath.get(chatId) !== path
            const hasImage = !!scene.location.image
            const length = (await deps.messages(chatId, userId).catch(() => [] as SceneMessage[])).length
            const before = lastLength.get(chatId)
            const dueToLocation = !hasImage || (mode !== 'location_enter' && changed)
            const dueToOutputs = mode === 'every_n_outputs' && before !== undefined && length - before >= everyN
            if (!dueToLocation && !dueToOutputs) {
                // The legacy also remembers the place here. A mutation found that
                // dead: a changed place is due in every mode but location_enter,
                // which never reads it. The every-N count does start here.
                if (mode === 'every_n_outputs' && before === undefined) lastLength.set(chatId, length)
                return
            }
            if (inFlight.has(chatId)) {
                deps.log.info(`scene: a picture is already being drawn for chat ${chatId}; the reply's is skipped`)
                return
            }
            lastPath.set(chatId, path)
            lastLength.set(chatId, length)
            const trigger: ScenePictureReport['trigger'] = dueToOutputs && !dueToLocation ? 'outputs' : hasImage ? 'change' : 'arrival'
            // Behind the reply, as the legacy queues it: the hook must not wait on an image.
            void drawFor(chatId, userId, scene, trigger).catch(() => undefined)
        },

        drawing: (chatId) => inFlight.get(chatId) ?? null,

        async connections(userId) {
            if (!deps.imageGen) return { connections: [], unavailable: NO_GRANT }
            try {
                const list = await deps.imageGen.listConnections(userId)
                const connections = list.map((c) => {
                    const settings = Object.entries(c.default_parameters ?? {}).map(([key, value]) => `${key}: ${settingWords(value)}`)
                    const metadata = Object.keys(c.metadata ?? {}).sort()
                    // Said in the log as well (55-bis): what the host merges into every draw, and where its own panel may keep the rest.
                    deps.log.info(`scene: image connection "${c.name}" (${c.provider}${c.model ? `, ${c.model}` : ''}): saved settings ${settings.length ? settings.join(', ') : 'none'}; metadata keys ${metadata.length ? metadata.join(', ') : 'none'}`)
                    return { id: c.id, name: c.name, provider: c.provider, model: c.model, isDefault: !!c.is_default, settings, metadata }
                })
                return { connections }
            } catch (error) {
                return { connections: [], unavailable: describe(error) }
            }
        },
    }
}
