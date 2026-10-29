// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'

import { createLocationBackground, describeElement, findBackgroundLayer, type BackgroundView } from './location-background.js'

/** A page whose elements have sizes and background images of our choosing. */
function page(spec: Array<{ tag?: string; id?: string; className?: string; width: number; height: number; image?: string }>) {
    document.body.replaceChildren()
    const images = new Map<Element, string>()
    for (const item of spec) {
        const element = document.createElement(item.tag ?? 'div')
        if (item.id) element.id = item.id
        if (item.className) element.className = item.className
        element.getBoundingClientRect = () => ({ width: item.width, height: item.height, top: 0, left: 0, right: item.width, bottom: item.height, x: 0, y: 0, toJSON: () => ({}) })
        images.set(element, item.image ?? 'none')
        document.body.append(element)
    }
    const view: BackgroundView = { innerWidth: 1000, innerHeight: 800, getComputedStyle: (element) => ({ backgroundImage: images.get(element) ?? 'none' }) }
    return view
}

beforeEach(() => { document.body.replaceChildren(); document.body.style.cssText = '' })

describe('the host’s background layer (73f)', () => {
    it('names an element for the console', () => {
        const element = document.createElement('div')
        element.id = 'app'
        element.className = 'chat-background glass extra more five'
        expect(describeElement(element)).toBe('div#app.chat-background.glass.extra.more')
    })

    it('prefers a named layer with an image, then a named one, then the largest with an image; nothing small counts', () => {
        let view = page([
            { id: 'huge', width: 1000, height: 800, image: 'url(big.png)' },
            { className: 'chat-background', width: 800, height: 600, image: 'url(bg.png)' },
            { id: 'small-bg', width: 100, height: 100, image: 'url(tiny.png)' },
        ])
        expect(findBackgroundLayer(document, view)!.className).toBe('chat-background')
        view = page([
            { id: 'huge', width: 1000, height: 800, image: 'url(big.png)' },
            { id: 'wallpaper', width: 800, height: 600 },
        ])
        expect(findBackgroundLayer(document, view)!.id).toBe('wallpaper')
        view = page([
            { id: 'pane', width: 600, height: 600, image: 'url(a.png)' },
            { id: 'wider', width: 900, height: 700, image: 'url(b.png)' },
            { id: 'plain', width: 1000, height: 800 },
        ])
        expect(findBackgroundLayer(document, view)!.id).toBe('wider')
        view = page([{ id: 'plain', width: 1000, height: 800 }, { id: 'bg', width: 10, height: 10, image: 'url(x.png)' }])
        expect(findBackgroundLayer(document, view)).toBeNull()
    })

    it('lays the picture on the layer, says so once, ignores the same picture twice, and puts the inline value back on clear', () => {
        const view = page([{ id: 'bg1', width: 1000, height: 800, image: 'url(old.png)' }])
        const layer = document.getElementById('bg1')!
        layer.style.backgroundImage = 'url(inline.png)'
        const inline = layer.style.backgroundImage
        const lines: string[] = []
        const background = createLocationBackground(document, view, (line) => lines.push(line))
        background.apply('https://host/a.png')
        expect(layer.style.backgroundImage).toBe('url("https://host/a.png")')
        expect(document.body.style.backgroundImage).toBe('')
        background.apply('https://host/a.png')
        background.apply('https://host/b.png')
        expect(layer.style.backgroundImage).toBe('url("https://host/b.png")')
        expect(lines).toEqual(["[AdventureTime] location background: laid on the host's div#bg1"])
        // A quote in the address is escaped, not a way out of the url(): no throw, and the value is a url() or left as it was.
        expect(() => background.apply('https://host/a "quoted".png')).not.toThrow()
        background.apply(null)
        expect(layer.style.backgroundImage).toBe(inline)
        background.clear()
        expect(layer.style.backgroundImage).toBe(inline)
    })

    it('never writes over a value the host set meanwhile: a clear leaves it, and a sync lays the picture again over it (73f-ter)', () => {
        // The host's layer had no inline image when it was chosen; the host sets its own after.
        const view = page([{ id: 'background', width: 1000, height: 800, image: 'url(theme.png)' }])
        const layer = document.getElementById('background')!
        const lines: string[] = []
        const background = createLocationBackground(document, view, (line) => lines.push(line))
        background.apply('https://host/a.png')
        expect(layer.style.backgroundImage).toBe('url("https://host/a.png")')
        layer.style.backgroundImage = 'url("https://lumiverse/mine.png")'
        // The switch still on: the same picture is laid again, over the host's, and the host's value is now the one to put back.
        background.apply('https://host/a.png')
        expect(layer.style.backgroundImage).toBe('url("https://host/a.png")')
        expect(lines[1]).toBe("[AdventureTime] location background: the host changed the image of div#background meanwhile; that is what a clear puts back now")
        background.clear()
        expect(layer.style.backgroundImage).toBe('url("https://lumiverse/mine.png")')
        // The host writes while the switch is off as well: a clear then touches nothing, and says so.
        background.apply('https://host/b.png')
        layer.style.backgroundImage = 'url("https://lumiverse/other.png")'
        background.clear()
        expect(layer.style.backgroundImage).toBe('url("https://lumiverse/other.png")')
        expect(lines.at(-1)).toBe("[AdventureTime] location background: the host changed the image of div#background meanwhile; left as it is")
        // The old behaviour, the saved empty value written back over the host's, is what wiped a background to a colour.
        expect(layer.style.backgroundImage).not.toBe('')
        // On the body the same rule holds for the sizing.
        document.body.replaceChildren()
        const bodyView = page([{ id: 'pane', width: 300, height: 300 }])
        const onBody = createLocationBackground(document, bodyView, () => undefined)
        onBody.apply('https://host/c.png')
        document.body.style.backgroundImage = 'url("https://lumiverse/body.png")'
        onBody.clear()
        expect(document.body.style.backgroundImage).toBe('url("https://lumiverse/body.png")')
        expect(document.body.style.backgroundSize).toBe('cover')
    })

    it('with no layer on the page, uses the body, sized to cover, and says so', () => {
        const view = page([{ id: 'pane', width: 300, height: 300 }])
        const lines: string[] = []
        const background = createLocationBackground(document, view, (line) => lines.push(line))
        background.apply('https://host/c.png')
        expect(document.body.style.backgroundImage).toBe('url("https://host/c.png")')
        expect(document.body.style.backgroundSize).toBe('cover')
        expect(lines[0]).toContain('no background layer found on the page; laid on the body')
        background.clear()
        expect(document.body.style.backgroundImage).toBe('')
        expect(document.body.style.backgroundSize).toBe('')
    })
})
