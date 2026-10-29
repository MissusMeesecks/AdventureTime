// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'

import type { MapViewResult } from '../protocol.js'
import { MAP_PICTURE_CSS, createMapPicture, describeMapView, type MapPicture, type MapPictureHost } from './map-picture.js'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" class="rt-dungeon-graph-svg" viewBox="0 0 364 95.9" width="364" height="95.9" role="img" aria-label="Abbey Undercroft">'
    + '<g class="rt-dungeon-graph-node rt-dungeon-graph-node-visited rt-dungeon-graph-node-current rt-dungeon-graph-node-revealed" data-area-id="landing" data-area-path="Abbey Undercroft :: Cellar Landing" role="button" tabindex="0"><rect x="14" y="14" width="140" height="39.9" rx="6"></rect><text x="84" y="24.5">Cellar Landing</text>'
    + '<g class="rt-dungeon-graph-icons"><g class="rt-dungeon-graph-icon rt-dungeon-graph-icon-object rt-dungeon-graph-icon-live rt-dungeon-graph-icon-known" data-icon="OBJECT_LIVE" data-asset-name="Sooty Lantern" data-asset-kind="OBJECT" data-asset-state="ACTIVE" data-asset-knowledge="KNOWN" data-asset-detail="Hangs by the door."><rect class="rt-dungeon-graph-icon-hit" x="0" y="0" width="12" height="12"></rect></g>'
    + '<g class="rt-dungeon-graph-icon-overflow" data-overflow-assets="[{&quot;name&quot;:&quot;Rat 5&quot;,&quot;kind&quot;:&quot;CREATURE&quot;},{&quot;name&quot;:&quot;Rat 6&quot;}]"><rect class="rt-dungeon-graph-icon-overflow-hit" x="0" y="0" width="12" height="12"></rect><text>+2</text></g></g></g>'
    + '<g class="rt-dungeon-graph-node rt-dungeon-graph-node-discovered rt-dungeon-graph-node-revealed" data-area-id="crypt" data-area-path="Abbey Undercroft :: Crypt Passage" role="button" tabindex="0"><rect x="210" y="14" width="140" height="39.9" rx="6"></rect><text x="280" y="24.5">Crypt Passage</text></g>'
    + '<g class="rt-dungeon-graph-node rt-dungeon-graph-node-fog" data-fog="1" aria-hidden="true"><circle cx="280" cy="72.9" r="9"></circle><text>?</text></g></svg>'
const ENTRIES = '<div class="rt-dungeon-map-area-list"><section class="rt-dungeon-map-area"><div class="rt-dungeon-map-area-head"><strong>Cellar Landing</strong></div></section><section class="rt-dungeon-map-area"><div class="rt-dungeon-map-area-head"><strong>Crypt Passage</strong></div></section></div>'
const VIEW: MapViewResult = { siteRoot: 'Abbey Undercroft', kind: 'DUNGEON', partyInside: true, rooms: 3, svg: SVG, entries: ENTRIES, history: '<div class="lh-map-history-empty">No Map Evolution pass has been recorded for this site.</div>', revealAll: false, currentLocation: 'Abbey Undercroft, Cellar Landing', sites: [{ siteRoot: 'Abbey Undercroft', kind: 'DUNGEON' }, { siteRoot: 'Morrowfen', kind: 'SETTLEMENT' }] }

afterEach(() => { document.body.replaceChildren() })

function harness(answer: (siteRoot: string) => MapViewResult | Promise<MapViewResult> = () => VIEW, options: { raw?: boolean; rawFail?: string } = {}) {
    const loads: string[] = []
    const reveals: boolean[] = []
    const failures: unknown[] = []
    const rawOps: Array<[string, string, string?]> = []
    const host: MapPictureHost = {
        el: (tag, attrs) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n },
        load: async (siteRoot) => { loads.push(siteRoot); return answer(siteRoot) },
        setRevealAll: async (on) => { reveals.push(on) },
        ...(options.raw ? { raw: {
            get: async (siteRoot: string) => { rawOps.push(['get', siteRoot]); return { siteRoot, entryId: 'B::1', bookName: 'B', json: `{\n  "site": "${siteRoot}"\n}` } },
            set: async (siteRoot: string, json: string) => { rawOps.push(['set', siteRoot, json]); if (options.rawFail) throw new Error(options.rawFail); return { siteRoot, areas: 3, assets: 2 } },
        } } : {}),
        fail: (e) => failures.push(e),
    }
    const picture = createMapPicture(host)
    document.body.append(picture.root)
    return { picture, loads, reveals, failures, rawOps }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const line = (p: MapPicture) => p.root.querySelector('.lh-map-line')!.textContent ?? ''
const scroll = (p: MapPicture) => p.root.querySelector('.lh-map-scroll') as HTMLElement
const tip = (p: MapPicture) => p.root.querySelector('.lh-map-tip') as HTMLElement
const select = (p: MapPicture) => p.root.querySelector('.lh-map-site') as HTMLSelectElement
const reveal = (p: MapPicture) => p.root.querySelector('[data-lh-field="map-reveal-all"] input') as HTMLInputElement
const fire = (target: Element, type: string, init: Record<string, unknown> = {}) => {
    const event = new Event(type, { bubbles: true, cancelable: true }) as Event & Record<string, unknown>
    for (const [k, v] of Object.entries(init)) Object.defineProperty(event, k, { value: v })
    target.dispatchEvent(event)
}

describe('the line over the picture', () => {
    it('says what is drawn, for whom, and why nothing is', () => {
        expect(describeMapView(null, true)).toBe('Drawing the map…')
        expect(describeMapView(null, false)).toBe('')
        expect(describeMapView(VIEW, false)).toBe('Abbey Undercroft (DUNGEON): the party is in it. 3 rooms drawn, as the party knows it.')
        expect(describeMapView({ ...VIEW, partyInside: false, rooms: 1, revealAll: true, kind: '' }, false)).toBe('Abbey Undercroft: the party is elsewhere. 1 room drawn, everything revealed.')
        expect(describeMapView({ ...VIEW, rooms: 0, svg: '' }, false)).toBe('Abbey Undercroft (DUNGEON): the party is in it. Nothing the party knows of it can be drawn yet.')
        expect(describeMapView({ ...VIEW, siteRoot: '', kind: '' }, false)).toBe('The party is outside every mapped site. Pick one above to look at it.')
        expect(describeMapView({ ...VIEW, siteRoot: '', sites: [] }, false)).toBe('No site has a map yet; the picture appears once the architect has drawn one.')
        expect(describeMapView({ ...VIEW, problem: 'PERMISSION_DENIED' }, false)).toBe('The map could not be drawn: PERMISSION_DENIED')
    })
})

describe('the picture', () => {
    it('draws nothing until asked, then the picture, the line, the picker and the folds from the answer', async () => {
        const { picture, loads } = harness()
        expect(line(picture)).toBe('')
        expect(scroll(picture).hidden).toBe(true)
        expect(reveal(picture).disabled).toBe(true)
        const pending = picture.refresh()
        expect(line(picture)).toBe('Drawing the map…')
        await pending
        expect(loads).toEqual([''])
        expect(line(picture)).toBe('Abbey Undercroft (DUNGEON): the party is in it. 3 rooms drawn, as the party knows it.')
        expect(scroll(picture).hidden).toBe(false)
        expect(scroll(picture).querySelector('svg.rt-dungeon-graph-svg')).not.toBeNull()
        expect(scroll(picture).querySelectorAll('.rt-dungeon-graph-node')).toHaveLength(3)
        expect(Array.from(select(picture).options).map((o) => [o.value, o.textContent])).toEqual([['', 'Where the party is'], ['Abbey Undercroft', 'Abbey Undercroft (DUNGEON)'], ['Morrowfen', 'Morrowfen (SETTLEMENT)']])
        expect(select(picture).value).toBe('')
        expect(reveal(picture).checked).toBe(false)
        expect(reveal(picture).disabled).toBe(false)
        const entries = picture.root.querySelector('.lh-map-entries') as HTMLElement
        expect(entries.hidden).toBe(false)
        expect(entries.querySelectorAll('.rt-dungeon-map-area')).toHaveLength(2)
        expect(picture.root.querySelector('.lh-map-history-body')!.textContent).toContain('No Map Evolution pass')
    })

    it('asks for the site picked, keeps the choice across reloads, and forgets it when cleared', async () => {
        const { picture, loads } = harness((siteRoot) => (siteRoot === 'Morrowfen' ? { ...VIEW, siteRoot: 'Morrowfen', kind: 'SETTLEMENT', partyInside: false, rooms: 1 } : VIEW))
        await picture.refresh()
        select(picture).value = 'Morrowfen'
        fire(select(picture), 'change')
        await settle()
        expect(loads).toEqual(['', 'Morrowfen'])
        expect(picture.chosenSite()).toBe('Morrowfen')
        expect(line(picture)).toBe('Morrowfen (SETTLEMENT): the party is elsewhere. 1 room drawn, as the party knows it.')
        expect(select(picture).value).toBe('Morrowfen')
        await picture.refresh()
        expect(loads).toEqual(['', 'Morrowfen', 'Morrowfen'])
        picture.clear()
        expect(picture.chosenSite()).toBe('')
        expect(line(picture)).toBe('')
        expect(scroll(picture).hidden).toBe(true)
        expect(select(picture).hidden || (select(picture).parentElement as HTMLElement).hidden).toBe(true)
    })

    it('saves Reveal all through the host and reflects what the answer says', async () => {
        let revealed = false
        const { picture, reveals } = harness(() => ({ ...VIEW, revealAll: revealed }))
        await picture.refresh()
        reveal(picture).checked = true
        fire(reveal(picture), 'change')
        await settle()
        expect(reveals).toEqual([true])
        expect(reveal(picture).disabled).toBe(true)
        revealed = true
        await picture.refresh()
        expect(reveal(picture).checked).toBe(true)
        expect(reveal(picture).disabled).toBe(false)
        expect(line(picture)).toContain('everything revealed')
    })

    it('shows a glyph\'s card on hover, the stacked cards behind a badge, pins one on a click and lets it go on a click elsewhere', async () => {
        const { picture } = harness()
        await picture.refresh()
        const glyph = scroll(picture).querySelector('.rt-dungeon-graph-icon-hit')!
        fire(glyph, 'pointerover')
        expect(tip(picture).hidden).toBe(false)
        expect(tip(picture).textContent).toContain('Sooty Lantern')
        expect(tip(picture).textContent).toContain('Hangs by the door.')
        expect(tip(picture).querySelector('.rt-dungeon-map-tag')!.textContent).toBe('OBJECT')
        fire(glyph, 'pointerout', { relatedTarget: scroll(picture) })
        expect(tip(picture).hidden).toBe(true)
        const badge = scroll(picture).querySelector('.rt-dungeon-graph-icon-overflow-hit')!
        fire(badge, 'pointerover')
        expect(tip(picture).querySelectorAll('.rt-dungeon-graph-overflow-tip-item')).toHaveLength(2)
        expect(tip(picture).textContent).toContain('Rat 5')
        fire(badge, 'pointerout', { relatedTarget: scroll(picture) })
        expect(tip(picture).hidden).toBe(true)
        // Pinned by a click: leaving does not hide it; a click outside does.
        fire(glyph, 'click')
        expect(tip(picture).hidden).toBe(false)
        fire(glyph, 'pointerout', { relatedTarget: scroll(picture) })
        expect(tip(picture).hidden).toBe(false)
        fire(document.body, 'pointerdown')
        expect(tip(picture).hidden).toBe(true)
        // A second click on a pinned glyph lets it go.
        fire(glyph, 'click')
        fire(glyph, 'click')
        expect(tip(picture).hidden).toBe(true)
        // A redraw clears it.
        fire(glyph, 'click')
        await picture.refresh()
        expect(tip(picture).hidden).toBe(true)
    })

    it('opens the entry of a room on a click or Enter, and marks it below', async () => {
        const { picture } = harness()
        await picture.refresh()
        const crypt = scroll(picture).querySelector('[data-area-id="crypt"] rect')!
        fire(crypt, 'click')
        const entries = picture.root.querySelector('.lh-map-entries') as HTMLDetailsElement
        expect(entries.open).toBe(true)
        const picked = Array.from(picture.root.querySelectorAll('.rt-dungeon-map-area')).map((s) => s.classList.contains('lh-map-area-picked'))
        expect(picked).toEqual([false, true])
        fire(scroll(picture).querySelector('[data-area-id="landing"]')!, 'keydown', { key: 'Enter' })
        expect(Array.from(picture.root.querySelectorAll('.rt-dungeon-map-area')).map((s) => s.classList.contains('lh-map-area-picked'))).toEqual([true, false])
        // Fog has no entry; a click on a glyph is a card, not an entry.
        fire(scroll(picture).querySelector('[data-fog="1"] circle')!, 'click')
        expect(Array.from(picture.root.querySelectorAll('.rt-dungeon-map-area')).map((s) => s.classList.contains('lh-map-area-picked'))).toEqual([true, false])
    })

    it('pans on a drag and swallows the click that ends it', async () => {
        const { picture } = harness()
        await picture.refresh()
        const box = scroll(picture)
        fire(box, 'pointerdown', { button: 0, clientX: 100, clientY: 50, pointerId: 1 })
        fire(box, 'pointermove', { clientX: 60, clientY: 40, pointerId: 1 })
        expect(box.classList.contains('lh-map-scroll--panning')).toBe(true)
        expect(box.scrollLeft).toBe(40)
        expect(box.scrollTop).toBe(10)
        fire(box, 'pointerup', { pointerId: 1 })
        expect(box.classList.contains('lh-map-scroll--panning')).toBe(false)
        fire(box.querySelector('[data-area-id="crypt"] rect')!, 'click')
        expect((picture.root.querySelector('.lh-map-entries') as HTMLDetailsElement).open).toBe(false)
        // A press that barely moves is a click.
        fire(box, 'pointerdown', { button: 0, clientX: 100, clientY: 50, pointerId: 2 })
        fire(box, 'pointermove', { clientX: 102, clientY: 51, pointerId: 2 })
        fire(box, 'pointerup', { pointerId: 2 })
        fire(box.querySelector('[data-area-id="crypt"] rect')!, 'click')
        expect((picture.root.querySelector('.lh-map-entries') as HTMLDetailsElement).open).toBe(true)
    })

    it('takes the pointer only once a press has become a drag, so a plain click still reaches the room (34d-bis)', async () => {
        const { picture } = harness()
        await picture.refresh()
        const box = scroll(picture)
        const captured: number[] = []
        ;(box as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = (id) => { captured.push(id) }
        // A press and a release: no capture, and the click that follows finds the room.
        fire(box.querySelector('[data-area-id="crypt"] rect')!, 'pointerdown', { button: 0, clientX: 100, clientY: 50, pointerId: 7 })
        fire(box, 'pointerup', { pointerId: 7 })
        expect(captured).toEqual([])
        fire(box.querySelector('[data-area-id="crypt"] rect')!, 'click')
        expect((picture.root.querySelector('.lh-map-entries') as HTMLDetailsElement).open).toBe(true)
        // A press that moves past the threshold captures, with the pointer that pressed.
        fire(box, 'pointerdown', { button: 0, clientX: 100, clientY: 50, pointerId: 8 })
        fire(box, 'pointermove', { clientX: 102, clientY: 50, pointerId: 8 })
        expect(captured).toEqual([])
        fire(box, 'pointermove', { clientX: 120, clientY: 50, pointerId: 8 })
        expect(captured).toEqual([8])
        fire(box, 'pointermove', { clientX: 140, clientY: 50, pointerId: 8 })
        expect(captured).toEqual([8])
        fire(box, 'pointerup', { pointerId: 8 })
    })

    it('says when the answer is a problem or the request failed, and keeps the picker', async () => {
        const { picture } = harness(() => ({ ...VIEW, siteRoot: '', svg: '', entries: '', history: '', rooms: 0, problem: 'PERMISSION_DENIED: world_books' }))
        await picture.refresh()
        expect(line(picture)).toBe('The map could not be drawn: PERMISSION_DENIED: world_books')
        expect(picture.root.querySelector('.lh-map-line')!.classList.contains('lh-world-note--error')).toBe(true)
        expect(scroll(picture).hidden).toBe(true)
        expect((picture.root.querySelector('.lh-map-entries') as HTMLElement).hidden).toBe(true)
        const failing = harness(() => { throw new Error('no answer') })
        await failing.picture.refresh()
        expect(line(failing.picture)).toBe('The map could not be drawn: no answer')
        expect(failing.failures).toEqual([])
        // An answer that arrives after a clear is dropped.
        let release: (v: MapViewResult) => void = () => undefined
        let fail = false
        const slow = harness(() => { if (fail) throw new Error('later'); return new Promise<MapViewResult>((resolve) => { release = resolve }) })
        const pending = slow.picture.refresh()
        slow.picture.clear()
        release(VIEW)
        await pending
        expect(line(slow.picture)).toBe('')
        // The dropped answer left nothing behind: a failure after it has no sites to keep for the picker.
        fail = true
        await slow.picture.refresh()
        expect(line(slow.picture)).toBe('The map could not be drawn: later')
        expect((select(slow.picture).parentElement as HTMLElement).hidden).toBe(true)
    })
})

describe('the raw JSON editor (71a)', () => {
    const rawView = (p: MapPicture) => p.root.querySelector('[data-lh-field="map-raw"]') as HTMLDetailsElement
    const gate = (p: MapPicture) => p.root.querySelector('.lh-map-raw-gate') as HTMLElement
    const text = (p: MapPicture) => p.root.querySelector('.lh-map-raw-text') as HTMLTextAreaElement
    const note = (p: MapPicture) => p.root.querySelector('.lh-map-raw-note')!.textContent ?? ''
    const open = async (p: MapPicture) => { rawView(p).open = true; rawView(p).dispatchEvent(new Event('toggle')); await settle() }

    it('is absent on a build without it, gated behind Reveal all with it, and reads the document when opened', async () => {
        const without = harness()
        await without.picture.refresh()
        expect(rawView(without.picture).hidden).toBe(true)
        expect(gate(without.picture).hidden).toBe(true)
        const gated = harness(() => VIEW, { raw: true })
        await gated.picture.refresh()
        expect(rawView(gated.picture).hidden).toBe(true)
        expect(gate(gated.picture).hidden).toBe(false)
        expect(gate(gated.picture).textContent).toBe('Turn on Reveal all to edit the raw JSON.')
        const revealed = harness(() => ({ ...VIEW, revealAll: true }), { raw: true })
        await revealed.picture.refresh()
        expect(rawView(revealed.picture).hidden).toBe(false)
        expect(gate(revealed.picture).hidden).toBe(true)
        expect(revealed.rawOps).toEqual([])
        await open(revealed.picture)
        expect(revealed.rawOps).toEqual([['get', 'Abbey Undercroft']])
        expect(text(revealed.picture).value).toBe('{\n  "site": "Abbey Undercroft"\n}')
        // Outside every map, nothing to edit.
        const outside = harness(() => ({ ...VIEW, siteRoot: '', revealAll: true }), { raw: true })
        await outside.picture.refresh()
        expect(rawView(outside.picture).hidden).toBe(true)
        expect(gate(outside.picture).hidden).toBe(true)
    })

    it('saves the text back, says what was saved, redraws the picture and reads the document again; a refusal is the note', async () => {
        const { picture, rawOps, loads } = harness(() => ({ ...VIEW, revealAll: true }), { raw: true })
        await picture.refresh()
        await open(picture)
        text(picture).value = '{"site": "Abbey Undercroft", "areas": []}'
        ;(picture.root.querySelector('[data-lh-field="map-raw-save"]') as HTMLButtonElement).click()
        await settle()
        await settle()
        expect(rawOps).toEqual([['get', 'Abbey Undercroft'], ['set', 'Abbey Undercroft', '{"site": "Abbey Undercroft", "areas": []}'], ['get', 'Abbey Undercroft']])
        expect(loads).toHaveLength(2)
        expect(note(picture)).toBe('Saved: 3 areas, 2 things in them.')
        const refused = harness(() => ({ ...VIEW, revealAll: true }), { raw: true, rawFail: 'The JSON could not be read: Unexpected token' })
        await refused.picture.refresh()
        await open(refused.picture)
        ;(refused.picture.root.querySelector('[data-lh-field="map-raw-save"]') as HTMLButtonElement).click()
        await settle()
        expect(note(refused.picture)).toBe('The JSON could not be read: Unexpected token')
        expect(refused.picture.root.querySelector('.lh-map-raw-note')!.classList.contains('lh-map-raw-note--error')).toBe(true)
        expect(refused.loads).toHaveLength(1)
    })

    it('forgets the text when the site drawn changes', async () => {
        const { picture } = harness((siteRoot) => ({ ...VIEW, revealAll: true, siteRoot: siteRoot || 'Abbey Undercroft' }), { raw: true })
        await picture.refresh()
        await open(picture)
        expect(text(picture).value).toContain('Abbey Undercroft')
        select(picture).value = 'Morrowfen'
        fire(select(picture), 'change')
        await settle()
        expect(text(picture).value).toBe('')
        expect(note(picture)).toBe('')
    })
})

describe('the picture’s colours (74g)', () => {
    it('writes every Ember colour as the fallback of the legacy’s variable, never bare, so a Map Theme recolours the whole picture', () => {
        // Every amber, and every Ember colour the legacy's rules name, sits behind a var(--rt-map-*, …).
        expect(MAP_PICTURE_CSS).toMatch(/var\(--rt-map-accent, #ffaa00\)/)
        expect(MAP_PICTURE_CSS).not.toMatch(/(?<!var\(--rt-map-[a-z-]+, )(#ffaa00|rgba\(255, 170, 0|#0c0c0c|#161616|#101010|#0a0a0a|#f0f0f0|#c8c8c8|#ff5a2a|#ffc53d|#e8d5b0|#d4a574|#ffcc4a|#ff9a5c|#c8925a)/)
        expect(MAP_PICTURE_CSS).toContain('var(--rt-map-background-image, none)')
        expect(MAP_PICTURE_CSS).toContain('var(--rt-map-group, #ffffff)')
        expect(MAP_PICTURE_CSS).not.toContain('--lh-map-accent')
    })
})

describe('the details box (78a)', () => {
    it('holds the entries, the history, the raw editor and its gate as one box after the graph, for Map Details to move', () => {
        const { picture } = harness(() => VIEW, { raw: true })
        expect(picture.details.classList.contains('lh-map-details')).toBe(true)
        expect(picture.details.parentElement).toBe(picture.root)
        expect(picture.details.previousElementSibling!.classList.contains('lh-map-tip')).toBe(true)
        expect(Array.from(picture.details.children).map((n) => n.className.split(' ')[0])).toEqual(['lh-map-entries', 'lh-map-history', 'lh-map-raw', 'lh-map-raw-gate'])
    })
})
