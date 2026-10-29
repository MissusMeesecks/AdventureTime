// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { openDetailsModal } from './details-modal.js'

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function makeUi() {
    const shown: Array<{ title: string; width?: number; root: HTMLElement }> = []
    const ui = {
        showModal: (options: { title: string; width?: number }) => {
            const root = document.createElement('div')
            document.body.append(root)
            shown.push({ title: options.title, width: options.width, root })
            return { root, dismiss: () => { root.remove() } }
        },
    }
    return { ui, shown }
}

describe('the details modal (78a)', () => {
    it('moves the nodes into the host\'s modal under the panel\'s class, and puts them back in their places on close', async () => {
        const home = document.createElement('div')
        const a = document.createElement('p'); a.textContent = 'a'
        const b = document.createElement('p'); b.textContent = 'b'
        const c = document.createElement('p'); c.textContent = 'c'
        const tail = document.createElement('span'); tail.textContent = 'tail'
        home.append(a, b, c, tail)
        document.body.append(home)
        const { ui, shown } = makeUi()
        let closed = 0
        const modal = openDetailsModal(ui, { title: 'Map Details — Abbey', nodes: [a, c], onClose: () => { closed++ } })!
        expect(modal).not.toBeNull()
        expect(shown.map((s) => s.title)).toEqual(['Map Details — Abbey'])
        const box = shown[0]!.root.querySelector('.adventuretime-panel.lh-details-modal') as HTMLElement
        expect(Array.from(box.children).map((n) => n.textContent)).toEqual(['a', 'c'])
        expect(Array.from(home.children).map((n) => n.textContent)).toEqual(['b', 'tail'])
        expect(modal.open).toBe(true)
        modal.close()
        expect(modal.open).toBe(false)
        expect(closed).toBe(1)
        // Back in order: a before b, c before the tail.
        expect(Array.from(home.children).map((n) => n.textContent)).toEqual(['a', 'b', 'c', 'tail'])
        expect(shown[0]!.root.isConnected).toBe(false)
        modal.close()
        expect(closed).toBe(1)
    })

    it('puts adjacent nodes back in their order, the last first', () => {
        const home = document.createElement('div')
        const a = document.createElement('p'); a.textContent = 'a'
        const b = document.createElement('p'); b.textContent = 'b'
        const tail = document.createElement('span'); tail.textContent = 'tail'
        home.append(a, b, tail)
        document.body.append(home)
        const { ui } = makeUi()
        const modal = openDetailsModal(ui, { title: 'x', nodes: [a, b] })!
        expect(Array.from(home.children).map((n) => n.textContent)).toEqual(['tail'])
        modal.close()
        expect(Array.from(home.children).map((n) => n.textContent)).toEqual(['a', 'b', 'tail'])
    })

    it('hears the host\'s own × and puts the nodes back then too', async () => {
        const home = document.createElement('div')
        const a = document.createElement('p'); a.textContent = 'a'
        home.append(a)
        document.body.append(home)
        const { ui, shown } = makeUi()
        let closed = 0
        const modal = openDetailsModal(ui, { title: 'x', nodes: [a], onClose: () => { closed++ } })!
        expect(home.children.length).toBe(0)
        shown[0]!.root.remove()
        await settle()
        expect(closed).toBe(1)
        expect(modal.open).toBe(false)
        expect(home.firstElementChild).toBe(a)
    })

    it('answers null without a host modal, leaving the nodes where they are', () => {
        const home = document.createElement('div')
        const a = document.createElement('p')
        home.append(a)
        expect(openDetailsModal(undefined, { title: 'x', nodes: [a] })).toBeNull()
        expect(openDetailsModal({}, { title: 'x', nodes: [a] })).toBeNull()
        expect(home.firstElementChild).toBe(a)
    })
})
