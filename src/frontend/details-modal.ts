/**
 * A box of the panel's own nodes shown in the host's modal (78a, Multihog's
 * Map Details popup): the nodes are moved into the modal while it is open
 * and put back where they were when it closes — by the panel's own Close,
 * or by the host's ×, which the panel cannot hear and so watches for, as
 * the prompt dialog does (73f).
 *
 * Moving the nodes rather than drawing them again keeps one editor: the raw
 * JSON box, the entries and the history are the same elements the Visuals/Map
 * tab holds, with their state and their listeners.
 */

export interface DetailsModalUi {
    showModal?(options: { title: string; width?: number; maxHeight?: number }): { root: HTMLElement; dismiss(): void }
}

export interface DetailsModal {
    /** Still on screen. */
    readonly open: boolean
    /** Close it and put the nodes back. */
    close(): void
}

export interface DetailsModalOptions {
    title: string
    /** Put into the modal in this order, and back in their own places after. */
    nodes: HTMLElement[]
    width?: number
    maxHeight?: number
    /** After the nodes are back, however the modal closed. */
    onClose?: () => void
}

/** `null` when the host has no modal: the caller leaves the nodes where they are. */
export function openDetailsModal(ui: DetailsModalUi | undefined, options: DetailsModalOptions): DetailsModal | null {
    const showModal = ui?.showModal
    if (!showModal) return null
    const modal = showModal.call(ui, { title: options.title, width: options.width ?? 760, maxHeight: options.maxHeight ?? 820 })
    const doc = modal.root.ownerDocument
    // The panel's root class as well (lesson 56): the modal is the host's, outside the panel, and the
    // stylesheet is scoped to the class.
    const box = doc.createElement('div')
    box.className = 'adventuretime-panel lh-details-modal'
    const places = options.nodes.map((node) => ({ node, parent: node.parentNode, next: node.nextSibling }))
    for (const node of options.nodes) box.append(node)
    modal.root.append(box)

    let closed = false
    let watcher: MutationObserver | null = null
    const restore = (): void => {
        if (closed) return
        closed = true
        watcher?.disconnect()
        // Last first: a node's next sibling may be the node after it, which is back in place by then.
        for (const { node, parent, next } of [...places].reverse()) {
            if (!parent) continue
            parent.insertBefore(node, next && next.parentNode === parent ? next : null)
        }
        options.onClose?.()
    }
    if (typeof MutationObserver !== 'undefined' && doc.body) {
        watcher = new MutationObserver(() => { if (!modal.root.isConnected) restore() })
        watcher.observe(doc.body, { childList: true, subtree: true })
    }
    return {
        get open() { return !closed },
        close() {
            if (closed) return
            try { modal.dismiss() } catch { /* already gone */ }
            restore()
        },
    }
}
