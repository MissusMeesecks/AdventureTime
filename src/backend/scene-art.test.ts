import { describe, expect, it } from 'vitest'

import type { SceneResult } from '../protocol.js'
import { createSceneArt, type SceneArtDeps, type SceneArtPrefs, settingWords } from './scene-art.js'

const SCENE: SceneResult = {
    at: '2026-10-11T12:00:00.000Z',
    location: { raw: 'Monastery Courtyard', path: 'Monastery :: Courtyard', leaf: 'Courtyard', breadcrumb: 'Monastery › Courtyard', storagePath: 'Monastery :: Courtyard', image: '', entryId: 'Vell_LOC::1', content: 'A yard.' },
    present: [
        { id: 'player-character', label: 'Thessaly Brook', portrait: '', isPlayerCharacter: true, content: 'Species: Human' },
        { id: 'Vell_NPC::1', label: 'Mother Sedge', portrait: '', isPlayerCharacter: false, content: '[CORE]\nKeeper.\n[/CORE]', ago: 0 },
    ],
    mapSite: '',
    books: ['Vell_NPC', 'Vell_LOC'],
}

function harness(over: Omit<Partial<SceneArtDeps>, "scene"> & { initial?: SceneArtPrefs; scene?: SceneResult; portraitMap?: Record<string, string>; messageCount?: number } = {}) {
    const { initial: initialPrefs = {}, scene: initialScene = SCENE, portraitMap, messageCount = 4, ...rest } = over
    let prefs: SceneArtPrefs = { ...initialPrefs }
    let portraits: Record<string, string> = { ...(portraitMap ?? { '📍 Monastery': 'https://host/monastery.png' }) }
    let scene: SceneResult = initialScene
    const calls: unknown[][] = []
    const log: string[] = []
    const events: unknown[][] = []
    const deps: SceneArtDeps = {
        scene: {
            get: async () => ({ ...scene, location: { ...scene.location, image: portraits[`📍 ${scene.location.storagePath}`] ?? '' } }),
            places: async () => [{ path: 'Monastery', content: 'An abbey on the hill.\n' }, { path: 'Monastery :: Courtyard', content: 'A yard.' }],
        },
        settings: { load: async () => ({ portraitLocationSystemPrompt: 'Draw "{{name}}" ({{path}}) in {{wordtarget}} words.', portraitPromptWordTarget: 120 }) },
        prefs: {
            load: async () => ({ ...prefs }),
            patch: async (patch) => { calls.push(['prefs.patch', patch]); prefs = { ...prefs, ...patch } },
        },
        messages: async () => Array.from({ length: messageCount }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: i % 2 ? `Reply ${i}.` : `Turn ${i}.` })),
        portraits: {
            load: async () => ({ portraits }),
            set: async (chatId, name, src) => { calls.push(['portraits.set', chatId, name, src]); portraits = { ...portraits, [name]: src } },
        },
        generate: async (system, user, chatId, userId) => { calls.push(['generate', system, user, chatId, userId]); return '  A sunlit cloister yard.  ' },
        imageGen: {
            generate: async (input) => { calls.push(['imageGen', input]); return { imageDataUrl: 'data:image/png;base64,AAAA', imageUrl: 'https://host/drawn.png', imageId: 'img-drawn', model: 'flux', provider: 'pollinations' } },
            listConnections: async () => [{ id: 'img-1', name: 'Fast', provider: 'pollinations', model: 'flux', is_default: true, default_parameters: { width: 1024, height: 768, steps: 30, loras: [{ name: 'a' }], sampler: 'euler', style: 'a very long style string that runs on and on past forty characters' }, metadata: { loraStacks: [], presets: {} } }],
        },
        images: {
            uploadFromDataUrl: async (dataUrl, options) => { calls.push(['upload', dataUrl, options]); return { url: 'https://host/stored.png', id: 'img-stored' } },
        },
        persona: async () => ({ description: 'A tired knight.' }),
        narrator: async () => ({ id: 'card-1', name: 'Grim', description: 'A grim narrator.' }),
        events: {
            started: (chatId, userId, path, at) => events.push(['started', chatId, path, at]),
            finished: (chatId, userId, report) => events.push(['finished', report]),
        },
        log: { info: (m) => log.push(m), warn: (m) => log.push(`warn: ${m}`) },
        now: () => new Date('2026-10-11T14:32:00.000Z'),
        ...rest,
    }
    return { art: createSceneArt(deps), calls, log, events, prefs: () => prefs, portraits: () => portraits, setScene: (s: SceneResult) => { scene = s } }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('drawing the scene picture (49)', () => {
    it('writes the prompt from the place, its parent with its art, the newest two replies, who is present, the persona and the card; draws; keeps the picture under the pin; and says so', async () => {
        const { art, calls, log, events, portraits } = harness({ initial: { scenePictureConnectionId: ' img-1 ' } })
        const result = await art.draw('chat-1', 'u1')
        expect(result).toMatchObject({ path: 'Monastery :: Courtyard', leaf: 'Courtyard', at: '2026-10-11T14:32:00.000Z', prompt: 'A sunlit cloister yard.', provider: 'pollinations', model: 'flux' })
        expect(result.scene.location.image).toBe('https://host/drawn.png')
        const generate = calls.find((c) => c[0] === 'generate')!
        expect(generate[1]).toBe('Draw "Courtyard" (Monastery :: Courtyard) in 120 words.')
        expect(generate[2]).toBe([
            'Location Path: Monastery :: Courtyard',
            'Location Lorebook Entry (PRIMARY — depict this specific place):\nA yard.',
            'Parent Location Chain (style/theme guides only — generate a DISTINCT image for "Monastery :: Courtyard", not a duplicate of a parent):\nImmediate parent: "Monastery"\nAn abbey on the hill.\n(Reference scene art exists for this parent — match its palette, architecture, era, materials, and atmosphere.)',
            'Recent Narrator Output (last 2 replies — use for mood, staging, and moment):\nNarrator:\nReply 1.\n\nNarrator:\nReply 3.',
            'Characters Present Now (include in the scene):\n### Player Character: Thessaly Brook\nSpecies: Human\n\n### Mother Sedge\n[CORE]\nKeeper.\n[/CORE]',
            'User Persona (for art style context):\nA tired knight.',
            'Narrator Card Description (for world context):\nA grim narrator.',
        ].join('\n\n---\n\n'))
        expect(generate.slice(3)).toEqual(['chat-1', 'u1'])
        expect(calls.find((c) => c[0] === 'imageGen')![1]).toEqual({ prompt: 'A sunlit cloister yard.', connection_id: 'img-1', owner_chat_id: 'chat-1', userId: 'u1' })
        expect(calls.find((c) => c[0] === 'portraits.set')).toEqual(['portraits.set', 'chat-1', '📍 Monastery :: Courtyard', 'https://host/drawn.png'])
        expect(portraits()['📍 Monastery :: Courtyard']).toBe('https://host/drawn.png')
        expect(calls.some((c) => c[0] === 'upload')).toBe(false)
        expect(log).toEqual([
            'scene: drawing the picture of "Monastery :: Courtyard" for chat chat-1 (pressed)',
            'scene: the picture of "Monastery :: Courtyard" drawn by pollinations (flux), pressed',
        ])
        expect(events).toEqual([
            ['started', 'chat-1', 'Monastery :: Courtyard', '2026-10-11T14:32:00.000Z'],
            ['finished', { chatId: 'chat-1', path: 'Monastery :: Courtyard', leaf: 'Courtyard', at: '2026-10-11T14:32:00.000Z', trigger: 'pressed', outcome: 'drawn', prompt: 'A sunlit cloister yard.', provider: 'pollinations', model: 'flux' }],
        ])
        expect(art.drawing('chat-1')).toBeNull()
    })

    it('leaves the NPCs out when the preference says, uses the host’s default connection when none is chosen, and stores a data-only result through the image store', async () => {
        const { art, calls } = harness({
            initial: { scenePicturePresentNpcs: false },
            imageGen: {
                generate: async (input) => { calls.push(['imageGen', input]); return { imageDataUrl: 'data:image/png;base64,BBBB', model: 'sdxl', provider: 'swarm' } },
                listConnections: async () => [],
            },
            persona: undefined,
            narrator: undefined,
        })
        const result = await art.draw('chat-1', 'u1')
        const user = calls.find((c) => c[0] === 'generate')![2] as string
        expect(user).toContain('### Player Character: Thessaly Brook')
        expect(user).not.toContain('Mother Sedge')
        expect(user).not.toContain('User Persona')
        expect(user).not.toContain('Narrator Card')
        expect(calls.find((c) => c[0] === 'imageGen')![1]).toEqual({ prompt: 'A sunlit cloister yard.', owner_chat_id: 'chat-1', userId: 'u1' })
        expect(calls.find((c) => c[0] === 'upload')).toEqual(['upload', 'data:image/png;base64,BBBB', { originalFilename: 'scene-Courtyard.png', owner_chat_id: 'chat-1', userId: 'u1' }])
        expect(result.scene.location.image).toBe('https://host/stored.png')
    })

    it('writes the prompt for editing (73f) with nothing drawn, and draws an edited one without writing a second', async () => {
        const h = harness()
        expect(await h.art.prompt('chat-1', 'u1')).toEqual({ path: 'Monastery :: Courtyard', leaf: 'Courtyard', prompt: 'A sunlit cloister yard.' })
        expect(h.calls.filter((c) => c[0] === 'generate')).toHaveLength(1)
        expect(h.calls.some((c) => c[0] === 'imageGen')).toBe(false)
        expect(h.events).toEqual([])
        expect(h.log.at(-1)).toBe('scene: writing the prompt for "Monastery :: Courtyard" for chat chat-1, to be edited before the draw')
        const result = await h.art.draw('chat-1', 'u1', '  A cellar at night.  ')
        expect(h.calls.filter((c) => c[0] === 'generate')).toHaveLength(1)
        expect((h.calls.find((c) => c[0] === 'imageGen')![1] as { prompt: string }).prompt).toBe('A cellar at night.')
        expect(result.prompt).toBe('A cellar at night.')
        expect(h.log).toContain('scene: drawing the picture of "Monastery :: Courtyard" for chat chat-1 (pressed, the prompt as edited)')
        // A blank edit is no edit: the prompt is written.
        await h.art.draw('chat-1', 'u1', '   ')
        expect(h.calls.filter((c) => c[0] === 'generate')).toHaveLength(2)
        const nowhere = harness()
        nowhere.setScene({ ...SCENE, location: { ...SCENE.location, raw: '', path: '', storagePath: '' } })
        await expect(nowhere.art.prompt('chat-1', 'u1')).rejects.toThrow(/No place is named yet/)
    })

    it('writes and draws the picture of a named place (80): the entry’s own text and stored picture, wherever the party stands, the party’s place with none named', async () => {
        const h = harness()
        // A place the books hold: its text in the prompt, its own pin for the picture, the party's place untouched.
        expect(await h.art.prompt('chat-1', 'u1', 'Monastery')).toEqual({ path: 'Monastery', leaf: 'Monastery', prompt: 'A sunlit cloister yard.' })
        const written = h.calls.find((c) => c[0] === 'generate')!
        expect(String(written[2])).toContain('An abbey on the hill.')
        expect(String(written[2])).not.toContain('A yard.')
        expect(h.log).toContain('scene: writing the prompt for "Monastery" for chat chat-1, to be edited before the draw')
        const drawn = await h.art.draw('chat-1', 'u1', 'The abbey at dusk.', ' Monastery ')
        expect(drawn.path).toBe('Monastery')
        expect(h.calls.find((c) => c[0] === 'portraits.set')).toEqual(['portraits.set', 'chat-1', '📍 Monastery', 'https://host/drawn.png'])
        expect(h.events[0]).toEqual(['started', 'chat-1', 'Monastery', '2026-10-11T14:32:00.000Z'])
        // A place no entry names draws too, under its own pin, with no text; the leaf is the last segment.
        const stray = await h.art.prompt('chat-1', 'u1', 'Salt Road :: Milestone')
        expect(stray).toMatchObject({ path: 'Salt Road :: Milestone', leaf: 'Milestone' })
        // Nowhere named, nothing to say: the party's place as before, and with none the refusal.
        expect((await h.art.prompt('chat-1', 'u1', '')).path).toBe('Monastery :: Courtyard')
        const nowhere = harness()
        nowhere.setScene({ ...SCENE, location: { ...SCENE.location, raw: '', path: '', storagePath: '' } })
        expect((await nowhere.art.prompt('chat-1', 'u1', 'Monastery')).path).toBe('Monastery')
        await expect(nowhere.art.prompt('chat-1', 'u1', undefined)).rejects.toThrow(/No place is named yet/)
    })

    it('refuses with no place, no grant, no prompt text in the cartridge, an empty prompt from the model, or a draw already in flight; a pressed failure switches nothing off', async () => {
        const nowhere = harness({ scene: { ...SCENE, location: { ...SCENE.location, raw: '', path: '', storagePath: '' } } })
        await expect(nowhere.art.draw('chat-1', 'u1')).rejects.toThrow(/No place is named yet/)
        const ungranted = harness({ imageGen: undefined })
        await expect(ungranted.art.draw('chat-1', 'u1')).rejects.toThrow(/has not granted the image_gen permission/)
        const bare = harness({ settings: { load: async () => ({}) } })
        await expect(bare.art.draw('chat-1', 'u1')).rejects.toThrow(/no location prompt/)
        expect(bare.events.at(-1)).toEqual(['finished', expect.objectContaining({ outcome: 'failed', trigger: 'pressed', reason: 'The cartridge has no location prompt (portraitLocationSystemPrompt).' })])
        expect(bare.events.at(-1)![1]).not.toHaveProperty('disabled')
        expect(bare.calls.some((c) => c[0] === 'prefs.patch')).toBe(false)
        expect(bare.log.at(-1)).toBe('warn: scene: the picture of "Monastery :: Courtyard" could not be drawn (pressed): The cartridge has no location prompt (portraitLocationSystemPrompt).')
        const mute = harness({ generate: async () => '   ' })
        await expect(mute.art.draw('chat-1', 'u1')).rejects.toThrow(/returned no image prompt/)
        let release: () => void = () => undefined
        const slow = harness({ imageGen: { generate: () => new Promise((resolve) => { release = () => resolve({ imageDataUrl: '', imageUrl: 'https://host/x.png', model: 'm', provider: 'p' }) }), listConnections: async () => [] } })
        const first = slow.art.draw('chat-1', 'u1')
        await settle()
        expect(slow.art.drawing('chat-1')).toEqual({ path: 'Monastery :: Courtyard', at: '2026-10-11T14:32:00.000Z' })
        await expect(slow.art.draw('chat-1', 'u1')).rejects.toThrow(/already being drawn for Monastery :: Courtyard/)
        release()
        await first
        expect(slow.art.drawing('chat-1')).toBeNull()
    })

    it('lists the host’s image connections with what is saved on each (55-bis), says so in the log, and says why when it cannot', async () => {
        const h = harness()
        expect(await h.art.connections('u1')).toEqual({ connections: [{ id: 'img-1', name: 'Fast', provider: 'pollinations', model: 'flux', isDefault: true, settings: ['width: 1024', 'height: 768', 'steps: 30', 'loras: 1 item', 'sampler: euler', 'style: a very long style string that runs on…'], metadata: ['loraStacks', 'presets'] }] })
        expect(h.log.at(-1)).toBe('scene: image connection "Fast" (pollinations, flux): saved settings width: 1024, height: 768, steps: 30, loras: 1 item, sampler: euler, style: a very long style string that runs on…; metadata keys loraStacks, presets')
        const bare = harness({ imageGen: { generate: async () => { throw new Error('x') }, listConnections: async () => [{ id: 'img-2', name: 'Local', provider: 'swarm', model: '', is_default: false }] } })
        expect(await bare.art.connections('u1')).toEqual({ connections: [{ id: 'img-2', name: 'Local', provider: 'swarm', model: '', isDefault: false, settings: [], metadata: [] }] })
        expect(bare.log.at(-1)).toBe('scene: image connection "Local" (swarm): saved settings none; metadata keys none')
        expect(settingWords(null)).toBe('none')
        expect(settingWords([])).toBe('an empty list')
        expect(settingWords([1, 2])).toBe('2 items')
        expect(settingWords({})).toBe('{}')
        expect(settingWords({ a: 1, b: 2 })).toBe('{a, b}')
        expect(settingWords(true)).toBe('true')
        expect(await harness({ imageGen: undefined }).art.connections('u1')).toEqual({ connections: [], unavailable: 'This build cannot draw pictures: the host has not granted the image_gen permission.' })
        expect(await harness({ imageGen: { generate: async () => { throw new Error('x') }, listConnections: async () => { throw new Error('PERMISSION_DENIED') } } }).art.connections('u1')).toEqual({ connections: [], unavailable: 'PERMISSION_DENIED' })
    })
})

describe('drawing on its own after a reply (49): the legacy’s Real-Time Mode', () => {
    it('does nothing when off, with no grant, or with no place', async () => {
        const off = harness()
        await off.art.afterReply('chat-1', 'u1')
        const ungranted = harness({ initial: { scenePictureAuto: true }, imageGen: undefined })
        await ungranted.art.afterReply('chat-1', 'u1')
        const nowhere = harness({ initial: { scenePictureAuto: true }, scene: { ...SCENE, location: { ...SCENE.location, raw: '', path: '', storagePath: '' } } })
        await nowhere.art.afterReply('chat-1', 'u1')
        await settle()
        for (const h of [off, ungranted, nowhere]) expect(h.calls.some((c) => c[0] === 'imageGen')).toBe(false)
    })

    it('on location change (the default): draws a place with no picture on arrival, again when the place changes even with one, and not on a reply in the same place', async () => {
        const h = harness({ initial: { scenePictureAuto: true } })
        await h.art.afterReply('chat-1', 'u1')
        await settle()
        expect(h.calls.filter((c) => c[0] === 'imageGen')).toHaveLength(1)
        expect(h.events.at(-1)).toEqual(['finished', expect.objectContaining({ outcome: 'drawn', trigger: 'arrival' })])
        // The same place again, now with a picture: nothing.
        await h.art.afterReply('chat-1', 'u1')
        await settle()
        expect(h.calls.filter((c) => c[0] === 'imageGen')).toHaveLength(1)
        // A move to a place that already has a picture: drawn again, as a change.
        h.setScene({ ...SCENE, location: { ...SCENE.location, raw: 'Monastery', path: 'Monastery', leaf: 'Monastery', breadcrumb: 'Monastery', storagePath: 'Monastery' } })
        await h.art.afterReply('chat-1', 'u1')
        await settle()
        expect(h.calls.filter((c) => c[0] === 'imageGen')).toHaveLength(2)
        expect(h.events.at(-1)).toEqual(['finished', expect.objectContaining({ outcome: 'drawn', trigger: 'change', path: 'Monastery' })])
    })

    it('on location enter: only a place with no picture, so a revisit of a drawn place is left alone', async () => {
        const h = harness({ initial: { scenePictureAuto: true, scenePictureTrigger: 'location_enter' }, portraitMap: { '📍 Monastery :: Courtyard': 'https://host/yard.png' } })
        await h.art.afterReply('chat-1', 'u1')
        await settle()
        expect(h.calls.some((c) => c[0] === 'imageGen')).toBe(false)
        h.setScene({ ...SCENE, location: { ...SCENE.location, raw: 'Morrowfen', path: 'Morrowfen', leaf: 'Morrowfen', breadcrumb: 'Morrowfen', storagePath: 'Morrowfen' } })
        await h.art.afterReply('chat-1', 'u1')
        await settle()
        expect(h.calls.filter((c) => c[0] === 'imageGen')).toHaveLength(1)
        expect(h.events.at(-1)).toEqual(['finished', expect.objectContaining({ trigger: 'arrival', path: 'Morrowfen' })])
    })

    it('every N outputs: the first check draws as a change (the legacy starts with no place remembered), then again once N replies have passed in the same place', async () => {
        let count = 4
        const h = harness({ initial: { scenePictureAuto: true, scenePictureTrigger: 'every_n_outputs', scenePictureEveryN: 2 }, portraitMap: { '📍 Monastery :: Courtyard': 'https://host/yard.png' }, messages: async () => Array.from({ length: count }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` })) })
        await h.art.afterReply('chat-1', 'u1')       // the first check: the place is new to the session, so it is a change
        await settle()
        expect(h.calls.filter((c) => c[0] === 'imageGen')).toHaveLength(1)
        expect(h.events.at(-1)).toEqual(['finished', expect.objectContaining({ trigger: 'change' })])
        count = 5
        await h.art.afterReply('chat-1', 'u1')       // one more message: not yet
        await settle()
        expect(h.calls.filter((c) => c[0] === 'imageGen')).toHaveLength(1)
        count = 6
        await h.art.afterReply('chat-1', 'u1')       // two more: due
        await settle()
        expect(h.calls.filter((c) => c[0] === 'imageGen')).toHaveLength(2)
        expect(h.events.at(-1)).toEqual(['finished', expect.objectContaining({ trigger: 'outputs' })])
        count = 7
        await h.art.afterReply('chat-1', 'u1')       // one since the draw: not yet
        await settle()
        expect(h.calls.filter((c) => c[0] === 'imageGen')).toHaveLength(2)
        // A whole number of at least one: a nonsense N reads as one, so the next reply is due.
        const loose = harness({ initial: { scenePictureAuto: true, scenePictureTrigger: 'every_n_outputs', scenePictureEveryN: Number.NaN }, portraitMap: { '📍 Monastery :: Courtyard': 'https://host/yard.png' }, messages: async () => Array.from({ length: count }, (_, i) => ({ role: 'user', content: `m${i}` })) })
        await loose.art.afterReply('chat-1', 'u1')
        await settle()
        count = 8
        await loose.art.afterReply('chat-1', 'u1')
        await settle()
        expect(loose.calls.filter((c) => c[0] === 'imageGen')).toHaveLength(2)
    })

    it('fails closed: one failed draw on its own switches the mode off, says so in the log and the event, and the next reply draws nothing', async () => {
        const h = harness({ initial: { scenePictureAuto: true }, imageGen: { generate: async () => { throw new Error('402 Payment Required') }, listConnections: async () => [] } })
        await h.art.afterReply('chat-1', 'u1')
        await settle()
        expect(h.prefs().scenePictureAuto).toBe(false)
        expect(h.calls).toContainEqual(['prefs.patch', { scenePictureAuto: false }])
        expect(h.events.at(-1)).toEqual(['finished', expect.objectContaining({ outcome: 'failed', trigger: 'arrival', reason: '402 Payment Required', disabled: true })])
        expect(h.log).toContain('warn: scene: drawing on its own is switched off after one failure; tick it again to retry')
        await h.art.afterReply('chat-1', 'u1')
        await settle()
        expect(h.events.filter((e) => e[0] === 'started')).toHaveLength(1)
    })

    it('skips the reply’s draw while one is in flight, and says so', async () => {
        let release: () => void = () => undefined
        const h = harness({ initial: { scenePictureAuto: true }, imageGen: { generate: () => new Promise((resolve) => { release = () => resolve({ imageDataUrl: '', imageUrl: 'https://host/x.png', model: 'm', provider: 'p' }) }), listConnections: async () => [] } })
        await h.art.afterReply('chat-1', 'u1')
        await settle()
        h.setScene({ ...SCENE, location: { ...SCENE.location, raw: 'Morrowfen', path: 'Morrowfen', leaf: 'Morrowfen', breadcrumb: 'Morrowfen', storagePath: 'Morrowfen' } })
        await h.art.afterReply('chat-1', 'u1')
        expect(h.log).toContain('scene: a picture is already being drawn for chat chat-1; the reply\'s is skipped')
        release()
        await settle()
        expect(h.events.filter((e) => e[0] === 'started')).toHaveLength(1)
    })
})
