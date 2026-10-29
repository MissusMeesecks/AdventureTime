// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'

import type { SceneDrawResult, SceneResult } from '../protocol.js'
import { createSceneFold, describeAgo, describeDraw, describeSceneLocation, SCENE_FOLD_CSS, SCENE_PICTURE_TRIGGERS, type SceneFold, type SceneFoldHost } from './scene-fold.js'

afterEach(() => { document.body.replaceChildren() })

const SCENE: SceneResult = {
    at: '2026-10-05T10:00:00Z',
    location: { raw: 'Monastery Courtyard', path: 'Monastery :: Courtyard', leaf: 'Courtyard', breadcrumb: 'Monastery › Courtyard', storagePath: 'Monastery :: Courtyard', image: 'https://host/yard.png', entryId: 'Vell_LOC::1', content: 'A yard.' },
    present: [
        { id: 'player-character', label: 'Thessaly Brook', portrait: 'https://host/t.png', isPlayerCharacter: true, content: 'Species: Human' },
        { id: 'Vell_NPC::1', label: 'Mother Sedge', portrait: '', isPlayerCharacter: false, content: '[CORE]\nKeeper.\n[/CORE]' },
    ],
    mapSite: 'Monastery',
    books: ['Vell_NPC', 'Vell_LOC'],
}

function harness(over: Partial<SceneFoldHost> & { scene?: SceneResult } = {}) {
    const calls: unknown[][] = []
    const { scene = SCENE, ...rest } = over
    const host: SceneFoldHost = {
        el: (tag, attrs) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n },
        get: async () => { calls.push(['get']); return scene },
        setImage: async (path, src, filename) => { calls.push(['setImage', path, src, filename]); return { ...scene, location: { ...scene.location, image: src } } },
        pickImage: async () => { calls.push(['pick']); return { dataUrl: 'data:image/png;base64,AAAA', filename: 'yard.png' } },
        askUrl: async (current) => { calls.push(['askUrl', current]); return 'https://host/new.png' },
        savePrefs: async (patch) => { calls.push(['savePrefs', patch]) },
        draw: async () => { calls.push(['draw']); return { scene: { ...scene, location: { ...scene.location, image: 'https://host/drawn.png' } }, path: scene.location.storagePath, leaf: scene.location.leaf, at: 't', prompt: 'A yard at dawn.', provider: 'pollinations', model: 'flux' } satisfies SceneDrawResult },
        connections: async () => { calls.push(['connections']); return { connections: [{ id: 'img-1', name: 'Fast', provider: 'pollinations', model: 'flux', isDefault: true, settings: ['width: 1024', 'steps: 30'], metadata: ['loraStacks'] }, { id: 'img-2', name: 'Local', provider: 'swarm', model: '', isDefault: false, settings: [], metadata: [] }] } },
        fail: (e) => calls.push(['fail', e]),
        when: (iso) => `at ${iso}`,
        ...rest,
    }
    const fold = createSceneFold(host)
    document.body.append(fold.root)
    return { fold, calls, host }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const open = async (fold: SceneFold) => { fold.root.open = true; fold.root.dispatchEvent(new Event('toggle')); await settle() }
const button = (fold: SceneFold, label: string) => fold.root.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement
const textButton = (fold: SceneFold, text: string) => Array.from(fold.root.querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement
const status = (fold: SceneFold) => fold.root.querySelector('.lh-scene-status')!.textContent ?? ''
const note = (fold: SceneFold) => fold.root.querySelector('.lh-scene-note')!.textContent ?? ''
const tiles = (fold: SceneFold) => Array.from(fold.root.querySelectorAll('.lh-scene-tile .lh-scene-name')).map((n) => n.textContent)
const detail = (fold: SceneFold) => fold.root.querySelector('[data-lh-field="scene-detail"]') as HTMLElement

describe('the status line', () => {
    it('says where the party is, resolved or not, and names the mapped site', () => {
        expect(describeSceneLocation(SCENE)).toBe('The party is at Courtyard — Monastery › Courtyard. They are inside Monastery; its map is in the Maps fold.')
        expect(describeSceneLocation({ ...SCENE, mapSite: '', location: { ...SCENE.location, path: 'Morrowfen', leaf: 'Morrowfen', breadcrumb: 'Morrowfen' } })).toBe('The party is at Morrowfen.')
        expect(describeSceneLocation({ ...SCENE, mapSite: '', location: { ...SCENE.location, path: '', leaf: 'The Salt Road', raw: 'The Salt Road' } })).toBe('The party is at The Salt Road, which no place entry matches yet.')
        expect(describeSceneLocation({ ...SCENE, location: { ...SCENE.location, raw: '' } })).toBe('No place is named yet: the last reply had no Location footer, and the memo no Location line.')
    })

    it('hides what is hidden despite the flex rules', () => {
        for (const cls of ['lh-scene-hero', 'lh-scene-detail', 'lh-scene-grid']) expect(SCENE_FOLD_CSS, cls).toMatch(new RegExp(`\\.${cls}\\[hidden\\][^{]*\\{[^}]*display: none`))
        // The hero has no box colour of its own since 84 and its picture fills the width; the placeholder alone keeps a faint box.
        expect(SCENE_FOLD_CSS).toMatch(/\.lh-scene-hero \{[^}]*background: transparent/)
        expect(SCENE_FOLD_CSS).toMatch(/\.lh-scene-hero-inner \{[^}]*width: 100%/)
        expect(SCENE_FOLD_CSS).toMatch(/\.lh-scene-hero-placeholder \{[^}]*background: rgba/)
    })
})

describe('the scene', () => {
    it('reads nothing until opened with a chat, then draws the place, its picture and the tiles, the player first', async () => {
        const { fold, calls } = harness()
        expect(calls).toEqual([])
        expect(status(fold)).toBe('Open a chat first.')
        await open(fold)
        expect(calls).toEqual([])
        fold.setChat('chat-1')
        await settle()
        expect(calls).toEqual([['get']])
        expect(status(fold)).toBe('The party is at Courtyard — Monastery › Courtyard. They are inside Monastery; its map is in the Maps fold.')
        expect(fold.root.querySelector('.lh-scene-hero-title')!.textContent).toBe('Courtyard')
        expect(fold.root.querySelector('.lh-scene-hero-crumb')!.textContent).toBe('Monastery › Courtyard')
        expect((fold.root.querySelector('img.lh-scene-picture') as HTMLImageElement).getAttribute('src')).toBe('https://host/yard.png')
        expect(tiles(fold)).toEqual(['Thessaly Brook', 'Mother Sedge'])
        expect(fold.root.querySelector('.lh-scene-tile--pc .lh-scene-name')!.textContent).toBe('Thessaly Brook')
        expect(fold.root.querySelectorAll('img.lh-scene-thumb')).toHaveLength(1)
        expect(button(fold, 'Forget the place’s picture').hidden).toBe(false)
    })

    it('offers Full portrait in the opened entry when the person has a picture and the host a modal (Phase 65)', async () => {
        const shown: string[][] = []
        const { fold } = harness({ enlarge: (src, title) => { shown.push([src, title]) } })
        fold.setChat('chat-1')
        await open(fold)
        button(fold, 'You, Thessaly Brook').click()
        const full = button(fold, 'Open the full portrait of Thessaly Brook')
        expect(full).not.toBeNull()
        expect(full.textContent).toBe('🖼️ Full portrait')
        full.click()
        expect(shown).toEqual([['https://host/t.png', 'Thessaly Brook']])
        // With the portrait's actions given (80), the Full portrait carries them.
        const withActions: unknown[] = []
        const offered = harness({ enlarge: (src, title, actions) => { withActions.push([src, title, actions]) }, portraitActions: (name) => ({ kind: 'portrait', draw: async () => undefined, note: name }) })
        offered.fold.setChat('chat-1')
        await open(offered.fold)
        button(offered.fold, 'You, Thessaly Brook').click()
        button(offered.fold, 'Open the full portrait of Thessaly Brook').click()
        expect(withActions).toEqual([['https://host/t.png', 'Thessaly Brook', { kind: 'portrait', draw: expect.any(Function), note: 'Thessaly Brook' }]])
        // The entry is still open: the button is the picture's, not the tile's.
        expect(detail(fold).hidden).toBe(false)
        // No picture, no button.
        button(fold, 'Mother Sedge').click()
        expect(fold.root.querySelector('[data-lh-field="scene-full-portrait"]')).toBeNull()
        // No modal, no button.
        const plain = harness()
        plain.fold.setChat('chat-1')
        await open(plain.fold)
        button(plain.fold, 'You, Thessaly Brook').click()
        expect(plain.fold.root.querySelector('[data-lh-field="scene-full-portrait"]')).toBeNull()
    })

    it('opens a tile\'s entry below the grid, and closes it again', async () => {
        const { fold } = harness()
        fold.setChat('chat-1')
        await open(fold)
        expect(detail(fold).hidden).toBe(true)
        button(fold, 'Mother Sedge').click()
        expect(detail(fold).hidden).toBe(false)
        expect(detail(fold).textContent).toContain('Mother Sedge')
        expect(detail(fold).textContent).toContain('Keeper.')
        expect(button(fold, 'Mother Sedge').getAttribute('aria-pressed')).toBe('true')
        button(fold, 'You, Thessaly Brook').click()
        expect(detail(fold).textContent).toContain('Thessaly Brook — the player character')
        button(fold, 'You, Thessaly Brook').click()
        expect(detail(fold).hidden).toBe(true)
    })

    it('draws an unresolved place in italics without a picture, and says when nobody is present', async () => {
        const { fold } = harness({ scene: { ...SCENE, mapSite: '', present: [], location: { ...SCENE.location, raw: 'The Salt Road', path: '', leaf: 'The Salt Road', breadcrumb: '', storagePath: 'The Salt Road', image: '' } } })
        fold.setChat('chat-1')
        await open(fold)
        expect(fold.root.querySelector('.lh-scene-hero-title')!.textContent).toBe('The Salt Road')
        expect(fold.root.querySelector('.lh-scene-hero-crumb')!.classList.contains('lh-scene-hero-crumb--unresolved')).toBe(true)
        expect(fold.root.querySelector('.lh-scene-hero-placeholder')).not.toBeNull()
        expect(fold.root.querySelector('.lh-scene-empty')!.textContent).toBe('No player character linked and no NPCs named in the latest narrator output.')
        expect(button(fold, 'Forget the place’s picture').hidden).toBe(true)
        expect(button(fold, 'Set a picture for the place').disabled).toBe(false)
    })

    it('says when nothing was picked, and when the picker refused (66)', async () => {
        const none = harness({ pickImage: async () => null })
        none.fold.setChat('chat-1')
        await open(none.fold)
        button(none.fold, 'Set a picture for the place').click()
        await settle()
        await settle()
        expect(none.calls.find(([op]) => op === 'setImage')).toBeUndefined()
        expect(note(none.fold)).toBe('No picture was picked.')
        expect(none.fold.root.querySelector('.lh-scene-note')!.classList.contains('lh-world-note--error')).toBe(false)
        const refused = harness({ pickImage: async () => { throw new Error('This build cannot open a file picker.') } })
        refused.fold.setChat('chat-1')
        await open(refused.fold)
        button(refused.fold, 'Set a picture for the place').click()
        await settle()
        await settle()
        expect(note(refused.fold)).toBe('The picture could not be picked: This build cannot open a file picker.')
        expect(refused.fold.root.querySelector('.lh-scene-note')!.classList.contains('lh-world-note--error')).toBe(true)
    })

    it('sets a picked picture, one from an address, and forgets it, each through the place\'s path', async () => {
        const { fold, calls } = harness()
        fold.setChat('chat-1')
        await open(fold)
        button(fold, 'Set a picture for the place').click()
        await settle()
        await settle()
        expect(calls.filter(([op]) => op === 'setImage')).toEqual([['setImage', 'Monastery :: Courtyard', 'data:image/png;base64,AAAA', 'yard.png']])
        expect(note(fold)).toBe('The picture of Courtyard is set.')
        button(fold, 'Set a picture for the place from an address').click()
        await settle()
        await settle()
        expect(calls.filter(([op]) => op === 'askUrl')).toEqual([['askUrl', 'data:image/png;base64,AAAA']])
        expect(calls.filter(([op]) => op === 'setImage')[1]).toEqual(['setImage', 'Monastery :: Courtyard', 'https://host/new.png', undefined])
        button(fold, 'Forget the place’s picture').click()
        await settle()
        expect(calls.filter(([op]) => op === 'setImage')[2]).toEqual(['setImage', 'Monastery :: Courtyard', '', undefined])
        expect(note(fold)).toBe('The picture of Courtyard is forgotten.')
        expect(button(fold, 'Forget the place’s picture').hidden).toBe(true)
    })

    it('keeps the picture buttons off without a place, hides the address way without a prompt, and reports a refused set', async () => {
        const { fold } = harness({ askUrl: undefined, scene: { ...SCENE, location: { ...SCENE.location, raw: '', path: '', leaf: '', breadcrumb: '', storagePath: '', image: '' } } })
        fold.setChat('chat-1')
        await open(fold)
        expect(button(fold, 'Set a picture for the place').disabled).toBe(true)
        // Icons alone since 78b, the name as the hover and nothing else.
        expect(button(fold, 'Set a picture for the place').textContent).toBe('🖼')
        expect(button(fold, 'Set a picture for the place').title).toBe('Set a picture')
        expect(button(fold, 'Set a picture for the place from an address').hidden).toBe(true)
        const refused = harness({ setImage: async () => { throw new Error('the host refused') } })
        refused.fold.setChat('chat-1')
        await open(refused.fold)
        button(refused.fold, 'Set a picture for the place').click()
        await settle()
        await settle()
        expect(note(refused.fold)).toBe('Setting the picture failed: the host refused.')
        expect(refused.fold.root.querySelector('.lh-scene-note')!.classList.contains('lh-world-note--error')).toBe(true)
    })

    it('re-reads on request and on refresh only while open, forgets the scene on a chat change, and names a failed read', async () => {
        const { fold, calls } = harness()
        fold.setChat('chat-1')
        await fold.refresh()
        expect(calls).toEqual([])
        await open(fold)
        expect(calls).toEqual([['get']])
        await fold.refresh()
        expect(calls).toEqual([['get'], ['get']])
        button(fold, 'Re-read the scene').click()
        await settle()
        expect(calls).toHaveLength(3)
        fold.setChat('chat-2')
        await settle()
        expect(calls).toHaveLength(4)
        const failing = harness({ get: async () => { throw new Error('the host is down') } })
        failing.fold.setChat('chat-1')
        await open(failing.fold)
        expect(note(failing.fold)).toBe('The scene could not be read: the host is down.')
        expect(status(failing.fold)).toBe('Open the fold to read the scene.')
        const problem = harness({ scene: { ...SCENE, problem: 'the LOC book is locked' } })
        problem.fold.setChat('chat-1')
        await open(problem.fold)
        expect(note(problem.fold)).toBe('A book could not be read: the LOC book is locked.')
    })
})

describe('the window (52)', () => {
    const input = (fold: SceneFold) => fold.root.querySelector('[data-lh-field="scene-window-input"]') as HTMLInputElement
    const agos = (fold: SceneFold) => Array.from(fold.root.querySelectorAll('.lh-scene-tile')).map((t) => t.querySelector('.lh-scene-ago')?.textContent ?? '')

    it('words how recently a tile was named, and says nothing for a window of one or the player', () => {
        expect(describeAgo(0, 3)).toBe('the latest reply')
        expect(describeAgo(1, 3)).toBe('1 reply ago')
        expect(describeAgo(2, 3)).toBe('2 replies ago')
        expect(describeAgo(0, 1)).toBe('')
        expect(describeAgo(undefined, 3)).toBe('')
        expect(describeAgo(1, undefined)).toBe('')
    })

    it('draws the line under each tile from the window, and the empty line names the window', async () => {
        const windowed: SceneResult = { ...SCENE, window: 3, present: [...SCENE.present.map((p, i) => (i ? { ...p, ago: 2 } : p)), { id: 'Vell_NPC::2', label: 'Loose Bill', portrait: '', isPlayerCharacter: false, content: 'x', ago: 0 }] }
        const { fold } = harness({ scene: windowed })
        fold.setChat('chat-1')
        await open(fold)
        expect(tiles(fold)).toEqual(['Thessaly Brook', 'Mother Sedge', 'Loose Bill'])
        expect(agos(fold)).toEqual(['', '2 replies ago', 'the latest reply'])
        expect(button(fold, 'Mother Sedge').title).toBe('Mother Sedge — named in 2 replies ago')
        const one = harness({ scene: { ...SCENE, window: 1, present: [{ ...SCENE.present[1]!, ago: 0 }] } })
        one.fold.setChat('chat-1')
        await open(one.fold)
        expect(agos(one.fold)).toEqual([''])
        const nobody = harness({ scene: { ...SCENE, window: 4, present: [] } })
        nobody.fold.setChat('chat-1')
        await open(nobody.fold)
        expect(nobody.fold.root.querySelector('.lh-scene-empty')!.textContent).toBe('No player character linked and no NPCs named in the last 4 replies.')
    })

    it('saves the window from its box, clamped, and reads the scene again; takes it from the preferences', async () => {
        const { fold, calls } = harness()
        fold.setChat('chat-1')
        await open(fold)
        expect(input(fold).value).toBe('3')
        input(fold).value = '45'
        input(fold).dispatchEvent(new Event('change'))
        await settle()
        expect(input(fold).value).toBe('20')
        expect(calls.filter(([op]) => op === 'savePrefs')).toEqual([['savePrefs', { sceneLookback: 20 }]])
        expect(calls.filter(([op]) => op === 'get')).toHaveLength(2)
        input(fold).value = 'x'
        input(fold).dispatchEvent(new Event('change'))
        await settle()
        expect(calls.at(-2)).toEqual(['savePrefs', { sceneLookback: 1 }])
        fold.applyPrefs({ sceneLookback: 5 })
        expect(input(fold).value).toBe('5')
        fold.applyPrefs({})
        expect(input(fold).value).toBe('5')
        fold.applyPrefs({ sceneLookback: 0 })
        expect(input(fold).value).toBe('1')
    })
})

describe('the picture drawn by the host (49)', () => {
    const field = (fold: SceneFold, name: string) => fold.root.querySelector(`[data-lh-field="${name}"]`) as HTMLInputElement & HTMLSelectElement
    const live = (fold: SceneFold) => fold.root.querySelector('.lh-world-running') as HTMLElement
    const prompt = (fold: SceneFold) => fold.root.querySelector('[data-lh-field="scene-prompt"]') as HTMLElement
    const settings = (fold: SceneFold) => fold.root.querySelector('[data-lh-field="scene-picture-settings"]') as HTMLDetailsElement

    it('words the outcome, pressed or on its own, and the legacy’s three triggers', () => {
        expect(describeDraw({ chatId: 'c', path: 'M :: C', leaf: 'Courtyard', at: 't', trigger: 'pressed', outcome: 'drawn', provider: 'pollinations', model: 'flux' })).toEqual({ text: 'The picture of Courtyard is drawn by pollinations (flux). The prompt is below.', error: false })
        expect(describeDraw({ chatId: 'c', path: 'M :: C', leaf: 'Courtyard', at: 't', trigger: 'arrival', outcome: 'drawn', provider: 'swarm' })).toEqual({ text: 'The picture of Courtyard is drawn on its own by swarm. The prompt is below.', error: false })
        expect(describeDraw({ chatId: 'c', path: 'M :: C', leaf: 'Courtyard', at: 't', trigger: 'pressed', outcome: 'failed', reason: 'PERMISSION_DENIED' })).toMatchObject({ error: true })
        expect(describeDraw({ chatId: 'c', path: 'M :: C', leaf: 'Courtyard', at: 't', trigger: 'change', outcome: 'failed', reason: '402 Payment Required', disabled: true }).text).toBe('The picture of Courtyard could not be drawn on its own: 402 Payment Required. Drawing on its own is switched off after this failure, as the legacy does; tick it again to retry.')
        expect(SCENE_PICTURE_TRIGGERS.map((t) => t.value)).toEqual(['location_enter', 'location_change', 'every_n_outputs'])
    })

    it('the live line sits under the tools and above the drawing fold (73f-bis), not at the foot', () => {
        const { fold } = harness()
        const line = live(fold)
        expect(line.previousElementSibling!.classList.contains('lh-scene-tools')).toBe(true)
        // The site map's slot follows it (78a); the drawing fold sits at the foot, handed to the Locations gear by the panel (78b).
        expect((line.nextElementSibling as HTMLElement).dataset.lhField).toBe('scene-site-map')
        expect(fold.pictureSettings.dataset.lhField).toBe('scene-picture-settings')
        expect(line.closest('.lh-scene')!.querySelector('[data-lh-field="scene-more"]')).toBeNull()
        expect(fold.root.querySelector('.lh-scene-body, .lh-scene > div')!.lastElementChild).toBe(fold.pictureSettings)
    })

    it('a press whose prompt editor was cancelled (73f) draws nothing and says so', async () => {
        const { fold, calls } = harness({ draw: async () => { calls.push(['draw']); return null } })
        fold.setChat('chat-1')
        await open(fold)
        button(fold, 'Draw the picture of the place').click()
        await settle()
        expect(calls).toContainEqual(['draw'])
        expect(note(fold)).toBe('Nothing was drawn.')
        expect(fold.busy()).toBe(false)
        expect(prompt(fold).hidden).toBe(true)
    })

    it('lays the place’s picture behind the chat while the switch is on (73f), and takes it off when it is off or the chat goes', async () => {
        const laid: Array<string | null> = []
        const { fold } = harness({ scene: { ...SCENE, location: { ...SCENE.location, image: 'https://host/yard.png' } }, setBackground: (src) => { laid.push(src) } })
        fold.setChat('chat-1')
        await open(fold)
        expect(laid.at(-1)).toBeNull()
        fold.applyPrefs({ portraitLocationBackground: true })
        expect(laid.at(-1)).toBe('https://host/yard.png')
        fold.applyPrefs({ portraitLocationBackground: false })
        expect(laid.at(-1)).toBeNull()
        fold.applyPrefs({ portraitLocationBackground: true })
        expect(laid.at(-1)).toBe('https://host/yard.png')
        fold.setChat(null)
        expect(laid.at(-1)).toBeNull()
        // A place with no picture lays nothing.
        const bare = harness({ scene: { ...SCENE, location: { ...SCENE.location, image: '' } }, setBackground: (src) => { laid.push(src) } })
        bare.fold.applyPrefs({ portraitLocationBackground: true })
        bare.fold.setChat('chat-1')
        await open(bare.fold)
        expect(laid.at(-1)).toBeNull()
    })

    it('draws on a press: the live line while it runs, the picture, the note and the prompt after; nothing without a place', async () => {
        const { fold, calls } = harness()
        fold.setChat('chat-1')
        await open(fold)
        const draw = button(fold, 'Draw the picture of the place')
        expect(draw.disabled).toBe(false)
        draw.click()
        expect(live(fold).hidden).toBe(false)
        expect(live(fold).textContent).toBe('Drawing the picture of Courtyard… one model call writes the prompt, then the image connection draws it.')
        expect(fold.busy()).toBe(true)
        expect(button(fold, 'Set a picture for the place').disabled).toBe(true)
        await settle()
        expect(calls).toContainEqual(['draw'])
        expect(live(fold).hidden).toBe(true)
        expect(note(fold)).toBe('The picture of Courtyard is drawn by pollinations (flux). The prompt is below.')
        expect(prompt(fold).hidden).toBe(false)
        expect(prompt(fold).textContent).toBe('A yard at dawn.')
        expect((fold.root.querySelector('.lh-scene-picture') as HTMLImageElement).getAttribute('src')).toBe('https://host/drawn.png')
        // No place: the button is off and says why.
        const nowhere = harness({ scene: { ...SCENE, location: { ...SCENE.location, raw: '', path: '', storagePath: '' } } })
        nowhere.fold.setChat('chat-1')
        await open(nowhere.fold)
        expect(button(nowhere.fold, 'Draw the picture of the place').disabled).toBe(true)
        expect(button(nowhere.fold, 'Draw the picture of the place').title).toBe('Draw the picture')
        // A host without the draw hides the button.
        const bare = harness({ draw: undefined })
        expect(button(bare.fold, 'Draw the picture of the place').hidden).toBe(true)
    })

    it('says why a press failed, and switches nothing off', async () => {
        const { fold } = harness({ draw: async () => { throw new Error('PERMISSION_DENIED: image_gen') } })
        fold.setChat('chat-1')
        await open(fold)
        field(fold, 'scene-picture-auto').checked = true
        button(fold, 'Draw the picture of the place').click()
        await settle()
        expect(note(fold)).toBe('The picture of Courtyard could not be drawn: PERMISSION_DENIED: image_gen.')
        expect(fold.root.querySelector('.lh-scene-note')!.classList.contains('lh-world-note--error')).toBe(true)
        expect(field(fold, 'scene-picture-auto').checked).toBe(true)
        expect(prompt(fold).hidden).toBe(true)
    })

    it('saves the five preferences as they are changed, shows N only for the every-N trigger, and lists the connections when the settings open', async () => {
        const { fold, calls } = harness()
        fold.setChat('chat-1')
        await open(fold)
        const everyRow = field(fold, 'scene-picture-every').closest('label') as HTMLElement
        expect(everyRow.hidden).toBe(true)
        field(fold, 'scene-picture-auto').checked = true
        field(fold, 'scene-picture-auto').dispatchEvent(new Event('change'))
        field(fold, 'scene-picture-trigger').value = 'every_n_outputs'
        field(fold, 'scene-picture-trigger').dispatchEvent(new Event('change'))
        expect(everyRow.hidden).toBe(false)
        field(fold, 'scene-picture-every').value = '99'
        field(fold, 'scene-picture-every').dispatchEvent(new Event('change'))
        expect(field(fold, 'scene-picture-every').value).toBe('50')
        field(fold, 'scene-picture-npcs').checked = false
        field(fold, 'scene-picture-npcs').dispatchEvent(new Event('change'))
        expect(calls.filter((c) => c[0] === 'connections')).toHaveLength(0)
        settings(fold).open = true
        settings(fold).dispatchEvent(new Event('toggle'))
        await settle()
        expect(calls.filter((c) => c[0] === 'connections')).toHaveLength(1)
        const select = field(fold, 'scene-picture-connection')
        expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['The host’s default image connection', 'Fast — pollinations · flux (default)', 'Local — swarm'])
        // The hint says what the host saves with the chosen connection (55-bis): the default's while none is chosen.
        expect(fold.root.querySelector('.lh-conn-hint')!.textContent).toBe('Saved with it and applied to every draw: width: 1024, steps: 30. Its record also carries: loraStacks.')
        select.value = 'img-2'
        select.dispatchEvent(new Event('change'))
        expect(fold.root.querySelector('.lh-conn-hint')!.textContent).toBe('Nothing is saved with it beyond the model.')
        expect(calls.filter((c) => c[0] === 'savePrefs').map((c) => c[1])).toEqual([
            { scenePictureAuto: true },
            { scenePictureTrigger: 'every_n_outputs' },
            { scenePictureEveryN: 50 },
            { scenePicturePresentNpcs: false },
            { scenePictureConnectionId: 'img-2' },
        ])
        // Opened again: listed once.
        settings(fold).dispatchEvent(new Event('toggle'))
        await settle()
        expect(calls.filter((c) => c[0] === 'connections')).toHaveLength(1)
    })

    it('takes the preferences as loaded, keeps a chosen connection the list lacks, and says when the list could not be read', async () => {
        const { fold } = harness({ connections: async () => ({ connections: [], unavailable: 'PERMISSION_DENIED' }) })
        fold.applyPrefs({ scenePictureAuto: true, scenePictureTrigger: 'location_enter', scenePictureEveryN: 3, scenePicturePresentNpcs: false, scenePictureConnectionId: 'img-9' })
        expect(field(fold, 'scene-picture-auto').checked).toBe(true)
        expect(field(fold, 'scene-picture-trigger').value).toBe('location_enter')
        expect(field(fold, 'scene-picture-every').value).toBe('3')
        expect(field(fold, 'scene-picture-npcs').checked).toBe(false)
        expect(field(fold, 'scene-picture-connection').value).toBe('img-9')
        settings(fold).open = true
        settings(fold).dispatchEvent(new Event('toggle'))
        await settle()
        expect(field(fold, 'scene-picture-connection').value).toBe('img-9')
        expect(Array.from(field(fold, 'scene-picture-connection').options).map((o) => o.textContent)).toEqual(['The host’s default (the list could not be read)', 'img-9 (not in the list)'])
        expect(fold.root.querySelector('.lh-conn-hint')!.textContent).toBe('PERMISSION_DENIED')
        // A trigger the fold does not know is left as it was.
        fold.applyPrefs({ scenePictureTrigger: 'sometimes' as never })
        expect(field(fold, 'scene-picture-trigger').value).toBe('location_enter')
    })

    it('follows a draw on its own through the events: the live line, then the note, the prompt, the re-read, and the tick cleared when the mode failed closed', async () => {
        const { fold, calls } = harness()
        fold.setChat('chat-1')
        await open(fold)
        const before = calls.filter((c) => c[0] === 'get').length
        fold.drawingStarted({ chatId: 'chat-2', path: 'Elsewhere', at: 't' })
        expect(live(fold).hidden).toBe(true)
        fold.drawingStarted({ chatId: 'chat-1', path: 'Monastery :: Courtyard', at: 't' })
        expect(live(fold).hidden).toBe(false)
        expect(button(fold, 'Draw the picture of the place').disabled).toBe(true)
        fold.drawingFinished({ chatId: 'chat-1', path: 'Monastery :: Courtyard', leaf: 'Courtyard', at: 't', trigger: 'arrival', outcome: 'drawn', prompt: 'Dawn over the yard.', provider: 'swarm', model: 'sdxl' })
        await settle()
        expect(live(fold).hidden).toBe(true)
        expect(note(fold)).toBe('The picture of Courtyard is drawn on its own by swarm (sdxl). The prompt is below.')
        expect(prompt(fold).textContent).toBe('Dawn over the yard.')
        expect(calls.filter((c) => c[0] === 'get').length).toBe(before + 1)
        field(fold, 'scene-picture-auto').checked = true
        fold.drawingFinished({ chatId: 'chat-1', path: 'Monastery :: Courtyard', leaf: 'Courtyard', at: 't', trigger: 'change', outcome: 'failed', reason: 'boom', disabled: true })
        expect(field(fold, 'scene-picture-auto').checked).toBe(false)
        expect(note(fold)).toContain('switched off after this failure')
        // A scene read mid-draw carries the draw: the fold shows it.
        const mid = harness({ scene: { ...SCENE, drawing: { path: 'Monastery :: Courtyard', at: 't' } } })
        mid.fold.setChat('chat-1')
        await open(mid.fold)
        expect(live(mid.fold).hidden).toBe(false)
        expect(mid.fold.busy()).toBe(true)
    })

    it('clears the live line when the draw a scene read carried finishes (55-bis), and when a later read carries none', async () => {
        // The live case: the fold read the scene while a draw on its own ran,
        // the finish came, and the line stood under a green light.
        let scene: SceneResult = { ...SCENE, drawing: { path: 'Monastery :: Courtyard', at: 't' } }
        const { fold } = harness({ get: async () => scene })
        fold.setChat('chat-1')
        await open(fold)
        expect(live(fold).hidden).toBe(false)
        scene = SCENE
        fold.drawingFinished({ chatId: 'chat-1', path: 'Monastery :: Courtyard', leaf: 'Courtyard', at: 't', trigger: 'change', outcome: 'drawn', prompt: 'p', provider: 'swarm', model: 'sdxl' })
        expect(live(fold).hidden).toBe(true)
        expect(fold.busy()).toBe(false)
        await settle()
        expect(live(fold).hidden).toBe(true)
        // A finish that never arrived: the next read says no draw is in flight, and the line goes.
        scene = { ...SCENE, drawing: { path: 'Monastery :: Courtyard', at: 't' } }
        await fold.refresh()
        expect(live(fold).hidden).toBe(false)
        scene = SCENE
        await fold.refresh()
        expect(live(fold).hidden).toBe(true)
        // A press in flight is not undone by a read that predates it.
        let release: () => void = () => undefined
        const pressed = harness({ draw: () => new Promise((resolve) => { release = () => resolve({ scene: SCENE, path: 'Monastery :: Courtyard', leaf: 'Courtyard', at: 't', prompt: 'p', provider: 'x', model: 'y' }) }) })
        pressed.fold.setChat('chat-1')
        await open(pressed.fold)
        button(pressed.fold, 'Draw the picture of the place').click()
        await pressed.fold.refresh()
        expect(live(pressed.fold).hidden).toBe(false)
        release()
        await settle()
        expect(live(pressed.fold).hidden).toBe(true)
    })
})

describe('the picture large (55)', () => {
    it('opens the picture large on a click or Enter when the host has a modal, and leaves it plain otherwise', async () => {
        const shown: unknown[][] = []
        const actions: unknown[] = []
        const { fold, calls } = harness({ enlarge: (src, title, offered) => { shown.push([src, title]); actions.push(offered) } })
        fold.setChat('chat-1')
        await open(fold)
        const img = fold.root.querySelector('.lh-scene-picture') as HTMLImageElement
        expect(img.getAttribute('data-lh-large')).toBe('Courtyard')
        expect(img.getAttribute('role')).toBe('button')
        img.click()
        img.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
        img.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }))
        expect(shown).toEqual([['https://host/yard.png', 'Courtyard'], ['https://host/yard.png', 'Courtyard']])
        // The picture's buttons under the large view (80): the tools row's four, run through the same ops.
        expect(actions[0]).toEqual({ kind: 'picture', set: expect.any(Function), url: expect.any(Function), draw: expect.any(Function), remove: expect.any(Function), fail: expect.any(Function) })
        const offered = actions[0] as Record<'set' | 'url' | 'draw' | 'remove', () => Promise<void>>
        await offered.remove()
        await settle()
        expect(calls.find((c) => c[0] === 'setImage')).toEqual(['setImage', 'Monastery :: Courtyard', '', undefined])
        await offered.url()
        await settle()
        expect(calls.filter((c) => c[0] === 'setImage').at(-1)).toEqual(['setImage', 'Monastery :: Courtyard', 'https://host/new.png', undefined])
        await offered.draw()
        expect(calls.find((c) => c[0] === 'draw')).toEqual(['draw'])
        // A place with no picture yet: the placeholder opens the empty box with the ways to get one, no Remove.
        const bare = harness({ scene: { ...SCENE, location: { ...SCENE.location, image: '' } }, enlarge: (src, title, offered) => { shown.push([src, title]); actions.push(offered) }, draw: undefined })
        bare.fold.setChat('chat-1')
        await open(bare.fold)
        const placeholder = bare.fold.root.querySelector('.lh-scene-hero-placeholder') as HTMLElement
        expect(placeholder.getAttribute('data-lh-large')).toBe('Courtyard')
        placeholder.click()
        expect(shown.at(-1)).toEqual(['', 'Courtyard'])
        expect(actions.at(-1)).toEqual({ kind: 'picture', set: expect.any(Function), url: expect.any(Function), draw: null, note: 'This build cannot draw pictures.', fail: expect.any(Function) })
        const plain = harness({ enlarge: undefined })
        plain.fold.setChat('chat-1')
        await open(plain.fold)
        expect((plain.fold.root.querySelector('.lh-scene-picture') as HTMLImageElement).hasAttribute('data-lh-large')).toBe(false)
    })
})
