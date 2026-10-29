// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { ENLARGE_CSS, LARGE_ATTR, createEnlarge, zoomTarget, zoomable } from './enlarge.js'

function modalHost() {
    const shown: Array<{ title: string; root: HTMLElement }> = []
    const ui = {
        showModal(options: { title: string; width?: number; maxHeight?: number }) {
            const root = document.createElement('div')
            shown.push({ title: options.title, root })
            return { root, dismiss: () => undefined }
        },
    }
    return { ui, shown }
}

describe('the opener (Phase 64)', () => {
    it('is nothing without the host\'s modal, so a site leaves its picture plain', () => {
        expect(createEnlarge(undefined)).toBeUndefined()
        expect(createEnlarge({})).toBeUndefined()
    })

    it('puts the picture in the host\'s modal, titled, at the scene\'s size', () => {
        const { ui, shown } = modalHost()
        const enlarge = createEnlarge(ui)!
        enlarge('https://host/k.png', 'Kestrel')
        expect(shown).toHaveLength(1)
        expect(shown[0]!.title).toBe('Kestrel')
        const img = shown[0]!.root.querySelector('img.lh-large') as HTMLImageElement
        expect(img.getAttribute('src')).toBe('https://host/k.png')
        expect(img.getAttribute('alt')).toBe('Kestrel')
    })
})

describe('a picture marked zoomable', () => {
    it('opens on a click, Enter or Space, and stops the click reaching the thing around it', () => {
        const opened: string[][] = []
        const around = document.createElement('button')
        let aroundClicks = 0
        around.addEventListener('click', () => { aroundClicks += 1 })
        const img = document.createElement('img')
        around.append(img)
        zoomable(img, '/k.png', 'Kestrel', (src, title) => { opened.push([src, title]) })
        expect(img.getAttribute(LARGE_ATTR)).toBe('Kestrel')
        expect(img.getAttribute('role')).toBe('button')
        expect(img.getAttribute('tabindex')).toBe('0')
        expect(img.title).toBe('Open the picture large')
        img.click()
        img.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        img.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
        img.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))
        expect(opened).toEqual([['/k.png', 'Kestrel'], ['/k.png', 'Kestrel'], ['/k.png', 'Kestrel']])
        expect(aroundClicks).toBe(0)
    })

    it('is left exactly as drawn without an opener', () => {
        const img = document.createElement('img')
        zoomable(img, '/k.png', 'Kestrel', undefined)
        expect(img.hasAttribute(LARGE_ATTR)).toBe(false)
        expect(img.hasAttribute('role')).toBe(false)
        expect(img.title).toBe('')
    })
})

describe('the delegated target', () => {
    it('reads a marked picture, through a child of it, and nothing else', () => {
        const box = document.createElement('div')
        box.innerHTML = '<img data-lh-large="Moth Wraith" src="/rat.png"><img src="/plain.png"><span>text</span><img data-lh-large="No source">'
        const [marked, plain, bare] = Array.from(box.querySelectorAll('img'))
        expect(zoomTarget(marked!)).toEqual({ src: '/rat.png', title: 'Moth Wraith' })
        expect(zoomTarget(plain!)).toBeNull()
        expect(zoomTarget(bare!)).toBeNull()
        expect(zoomTarget(box.querySelector('span'))).toBeNull()
        expect(zoomTarget(null)).toBeNull()
    })

    it('falls back to a plain title for an empty one', () => {
        const img = document.createElement('img')
        img.setAttribute(LARGE_ATTR, '')
        img.setAttribute('src', '/x.png')
        expect(zoomTarget(img)).toEqual({ src: '/x.png', title: 'The picture' })
    })
})

describe('the style', () => {
    it('gives every marked picture the zoom cursor and sizes the large one to the modal', () => {
        expect(ENLARGE_CSS).toContain('img[data-lh-large] { cursor: zoom-in; }')
        expect(ENLARGE_CSS).toContain('.lh-large {')
    })
})

describe('the picture’s buttons under the large view (80)', () => {
    it('draws one button per action in Multihog’s order, greys a null one with the note, closes first and then runs the one pressed', async () => {
        const { ui, shown } = modalHost()
        let dismissed = 0
        ui.showModal = (options) => { const root = document.createElement('div'); shown.push({ title: options.title, root }); return { root, dismiss: () => { dismissed += 1 } } }
        const ran: string[] = []
        const failures: unknown[] = []
        const enlarge = createEnlarge(ui)!
        enlarge('/k.png', 'Kestrel', {
            kind: 'portrait',
            set: async () => { ran.push('set') },
            draw: null,
            remove: async () => { ran.push('remove'); throw new Error('refused') },
            note: 'This build cannot draw pictures.',
            fail: (error) => { failures.push(error) },
        })
        const root = shown[0]!.root
        const buttons = Array.from(root.querySelectorAll('.lh-large-actions button')) as HTMLButtonElement[]
        expect(buttons.map((b) => b.getAttribute('data-lh-field'))).toEqual(['large-set', 'large-draw', 'large-remove'])
        expect(buttons.map((b) => b.textContent)).toEqual(['🖼 From a file', '🎨 Draw', '🗑 Remove'])
        expect(buttons[0]!.title).toBe('Replace the portrait from an image file; it is stored with the host.')
        expect(buttons[1]!.disabled).toBe(true)
        expect(buttons[1]!.title).toBe('This build cannot draw pictures.')
        expect(root.querySelector('.lh-large-note')!.textContent).toBe('This build cannot draw pictures.')
        // No url action: no button for it.
        expect(root.querySelector('[data-lh-field="large-url"]')).toBeNull()
        buttons[0]!.click()
        expect(dismissed).toBe(1)
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(ran).toEqual(['set'])
        // A failed action reaches the site's reporter, never the console.
        buttons[2]!.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(ran).toEqual(['set', 'remove'])
        expect(failures.map((e) => (e as Error).message)).toEqual(['refused'])
    })

    it('shows the empty box with the kind’s word when there is no picture, with the ways to get one; without actions the modal is the picture alone', () => {
        const { ui, shown } = modalHost()
        const enlarge = createEnlarge(ui)!
        enlarge('', 'Abbey Undercroft', { kind: 'picture', set: async () => undefined, url: async () => undefined, draw: async () => undefined })
        const root = shown[0]!.root
        expect(root.querySelector('img')).toBeNull()
        expect(root.querySelector('.lh-large-empty')!.textContent).toBe('No picture yet.')
        expect(Array.from(root.querySelectorAll('.lh-large-actions button')).map((b) => b.getAttribute('data-lh-field'))).toEqual(['large-set', 'large-url', 'large-draw'])
        expect((root.querySelector('[data-lh-field="large-set"]') as HTMLButtonElement).title).toBe('Set the picture from an image file; it is stored with the host.')
        enlarge('/k.png', 'Kestrel')
        expect(shown[1]!.root.querySelector('.lh-large-actions')).toBeNull()
        expect(shown[1]!.root.querySelector('.lh-large-note')).toBeNull()
    })

    it('reads the actions at the click on a zoomable picture, opens an empty box only with actions to offer, and says so on hover', () => {
        const opened: Array<[string, string, unknown]> = []
        const enlarge = (src: string, title: string, actions?: unknown) => { opened.push([src, title, actions]) }
        let offered: { kind: 'portrait'; remove?: () => Promise<void> } | undefined = { kind: 'portrait' }
        const img = document.createElement('img')
        zoomable(img, '/k.png', 'Kestrel', enlarge, () => offered)
        img.click()
        offered = { kind: 'portrait', remove: async () => undefined }
        img.click()
        expect(opened.map(([, , a]) => a)).toEqual([{ kind: 'portrait' }, offered])
        // An empty box: nothing without actions, the modal with them, and the hover says what the click is for.
        const empty = document.createElement('div')
        zoomable(empty, '', 'Orrin', enlarge, undefined)
        expect(empty.hasAttribute(LARGE_ATTR)).toBe(false)
        const box = document.createElement('div')
        zoomable(box, '', 'Orrin', enlarge, () => ({ kind: 'photo', set: async () => undefined }))
        expect(box.getAttribute(LARGE_ATTR)).toBe('Orrin')
        expect(box.title).toBe('Set, draw or paste a picture')
        box.click()
        expect(opened.at(-1)).toEqual(['', 'Orrin', { kind: 'photo', set: expect.any(Function) }])
        // The getter answering nothing opens nothing for an empty box.
        const idle = document.createElement('div')
        zoomable(idle, '', 'Orrin', enlarge, () => undefined)
        idle.click()
        expect(opened).toHaveLength(3)
        expect(ENLARGE_CSS).toContain('.lh-large-actions {')
        expect(ENLARGE_CSS).toContain('.lh-large-empty {')
    })
})
