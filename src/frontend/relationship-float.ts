/**
 * The relationship float feedback (78c, Multihog's `showRelationshipFloatFeedback`
 * of `src/state/relationship-dom.js` at the pin): an RPG-style graphic that rises
 * from the tracker's right edge and fades when Friendship or Affection moves —
 * the icon, the signed delta, the axis and the NPC's name. The layer is
 * portalled to the document body so the panel's overflow cannot clip it, and
 * aligned with the tracker on every spawn; concurrent awards are staggered in
 * time and spread across slots. Transcribed function for function, the
 * constants and the stylesheet held to the pin by `relationship-float.pin.test.ts`.
 *
 * The one AdventureTime change: the legacy reads the tracker's own `z-index` for the
 * layer, and AdventureTime's tracker sits inside a frame the host layers, so the
 * layer takes the highest `z-index` up the tracker's ancestor chain instead.
 */

/** Minimum gap between consecutive float spawns. */
export const REL_FLOAT_STAGGER_MS = 340
/** Vertical spacing between concurrent float slots. */
export const REL_FLOAT_SLOT_Y_PX = 30
/** Horizontal spacing between concurrent float slots (extends left from right edge). */
export const REL_FLOAT_SLOT_X_PX = 16
/** The legacy's z-index when the chain names none, and its lift above it. */
export const REL_FLOAT_BASE_Z = 2000
export const REL_FLOAT_LIFT_Z = 40
/** The fallback cleanup, for an animationend that never fires (reduced motion, display: none). */
export const REL_FLOAT_LIFETIME_MS = 4600

export const RELATIONSHIP_FLOAT_LAYER_ID = 'lh-rel-float-layer'

export interface RelationshipFloatAward {
    npc: string
    field: 'friendship' | 'affection'
    delta: number
}

export interface RelationshipFloatDeps {
    /** The tracker the layer aligns with; `null` floats nothing. */
    host(): HTMLElement | null
    document?: Document
    now?: () => number
}

export interface RelationshipFloat {
    show(award: RelationshipFloatAward): void
    /** Cancel the pending spawns and take the layer down. */
    destroy(): void
}

export function createRelationshipFloat(deps: RelationshipFloatDeps): RelationshipFloat {
    const doc = deps.document ?? (typeof document === 'undefined' ? null : document)
    const now = deps.now ?? (() => Date.now())
    /** Next earliest time a new float may appear. */
    let nextAt = 0
    /** Slot indices currently occupied by live floats. */
    const activeSlots = new Set<number>()
    const timers = new Set<ReturnType<typeof setTimeout>>()
    let destroyed = false

    function claimSlot(): number {
        let slot = 0
        while (activeSlots.has(slot)) slot += 1
        activeSlots.add(slot)
        return slot
    }

    function later(fn: () => void, delay: number): void {
        const timer = setTimeout(() => { timers.delete(timer); if (!destroyed) fn() }, delay)
        timers.add(timer)
    }

    function layerZIndex(host: HTMLElement): number {
        let best: number | null = null
        const view = host.ownerDocument.defaultView
        for (let node: HTMLElement | null = host; node; node = node.parentElement) {
            const z = Number.parseInt(view?.getComputedStyle(node).zIndex || '', 10)
            if (Number.isFinite(z) && (best === null || z > best)) best = z
        }
        return (best ?? REL_FLOAT_BASE_Z) + REL_FLOAT_LIFT_Z
    }

    /** Align the body-level layer with the tracker, recomputed for every spawn so a moved or resized box is followed. */
    function positionLayer(layer: HTMLElement, host: HTMLElement): void {
        const rect = host.getBoundingClientRect()
        layer.style.left = `${rect.left}px`
        layer.style.top = `${rect.top}px`
        layer.style.width = `${rect.width}px`
        layer.style.height = `${rect.height}px`
        layer.style.zIndex = String(layerZIndex(host))
    }

    function spawn({ npc, field, delta }: RelationshipFloatAward): void {
        const host = deps.host()
        if (!doc || !host) return
        const isFriendship = field === 'friendship'
        const polarity = delta > 0 ? 'positive' : 'negative'
        const sign = delta > 0 ? '+' : ''
        let layer = doc.getElementById(RELATIONSHIP_FLOAT_LAYER_ID)
        if (!layer) {
            layer = doc.createElement('div')
            layer.id = RELATIONSHIP_FLOAT_LAYER_ID
            layer.className = 'lh-rel-float-layer'
            layer.setAttribute('aria-live', 'polite')
            layer.setAttribute('aria-atomic', 'false')
            doc.body.appendChild(layer)
        }
        positionLayer(layer, host)

        const slot = claimSlot()
        // Positive X = further left from the right edge; Y = higher start within the panel
        const xOffset = (slot % 3) * REL_FLOAT_SLOT_X_PX + (slot >= 3 ? 8 : 0)
        const yOffset = slot * REL_FLOAT_SLOT_Y_PX + ((slot % 2) === 1 ? 10 : 0)

        const el = doc.createElement('div')
        el.className = `lh-rel-float lh-rel-float--${isFriendship ? 'friendship' : 'affection'} lh-rel-float--${polarity}`
        el.setAttribute('role', 'status')
        el.style.setProperty('--lh-rel-float-x', `${xOffset}px`)
        el.style.setProperty('--lh-rel-float-y', `${yOffset}px`)

        const icon = doc.createElement('span')
        icon.className = 'lh-rel-float-icon'
        icon.textContent = isFriendship ? '🤝' : '💗'
        const deltaEl = doc.createElement('span')
        deltaEl.className = 'lh-rel-float-delta'
        deltaEl.textContent = `${sign}${delta}`
        const label = doc.createElement('span')
        label.className = 'lh-rel-float-label'
        label.textContent = isFriendship ? 'Friendship' : 'Affection'
        const name = doc.createElement('span')
        name.className = 'lh-rel-float-npc'
        name.textContent = String(npc || '').trim()
        el.append(icon, deltaEl, label)
        if (name.textContent) el.appendChild(name)
        layer.appendChild(el)

        let cleaned = false
        const cleanup = (): void => {
            if (cleaned) return
            cleaned = true
            el.removeEventListener('animationend', cleanup)
            el.remove()
            activeSlots.delete(slot)
            if (layer && !layer.childElementCount) layer.remove()
        }
        el.addEventListener('animationend', cleanup)
        later(cleanup, REL_FLOAT_LIFETIME_MS + Math.min(slot, 4) * REL_FLOAT_STAGGER_MS)
    }

    return {
        show(award) {
            if (destroyed || !doc || !award.delta) return
            const at = now()
            const delay = Math.max(0, nextAt - at)
            nextAt = Math.max(at, nextAt) + REL_FLOAT_STAGGER_MS
            later(() => spawn(award), delay)
        },
        destroy() {
            destroyed = true
            for (const timer of timers) clearTimeout(timer)
            timers.clear()
            activeSlots.clear()
            doc?.getElementById(RELATIONSHIP_FLOAT_LAYER_ID)?.remove()
        },
    }
}

/** The legacy's rules, `rt-` to `lh-`; the layer lives on the body, so nothing scopes them to the panel. */
export const RELATIONSHIP_FLOAT_CSS = `
.lh-rel-float-layer {
    position: fixed;
    pointer-events: none;
    overflow: visible;
}
.lh-rel-float {
    position: absolute;
    right: calc(10px + var(--lh-rel-float-x, 0px));
    top: calc(50% - var(--lh-rel-float-y, 0px));
    bottom: auto;
    display: inline-flex;
    align-items: baseline;
    justify-content: flex-end;
    gap: 5px;
    max-width: none;
    font-weight: 800;
    font-size: 15px;
    letter-spacing: 0.2px;
    white-space: nowrap;
    line-height: 1.15;
    text-shadow:
        0 0 10px currentColor,
        0 2px 6px rgba(0, 0, 0, 0.75);
    /* 20% larger relationship award feedback, shown for four seconds. */
    animation: lh-rel-float-up 4s ease-out forwards;
    will-change: transform, opacity;
}
.lh-rel-float-icon {
    font-size: 18px;
    line-height: 1;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.55));
}
.lh-rel-float-delta {
    font-family: var(--lh-font-mono, ui-monospace, monospace);
    font-size: 17px;
    font-variant-numeric: tabular-nums;
}
.lh-rel-float-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    opacity: 0.9;
}
.lh-rel-float-npc {
    font-size: 11px;
    font-weight: 600;
    opacity: 0.72;
    flex: 0 0 auto;
    overflow: visible;
    text-overflow: clip;
}
.lh-rel-float-npc::before {
    content: '·';
    margin-right: 5px;
    opacity: 0.5;
}

/* Friendship: green / red */
.lh-rel-float--friendship.lh-rel-float--positive { color: #4ade80; }
.lh-rel-float--friendship.lh-rel-float--negative { color: #f87171; }

/* Affection: pink / purple */
.lh-rel-float--affection.lh-rel-float--positive { color: #f472b6; }
.lh-rel-float--affection.lh-rel-float--negative { color: #c084fc; }

@keyframes lh-rel-float-up {
    0% {
        opacity: 0;
        transform: translateY(calc(-50% + 18px)) scale(1.056);
    }
    12% {
        opacity: 1;
        transform: translateY(-50%) scale(1.2);
    }
    70% {
        opacity: 1;
    }
    100% {
        opacity: 0;
        transform: translateY(calc(-50% - 110px)) scale(1.2);
    }
}

@media (prefers-reduced-motion: reduce) {
    .lh-rel-float {
        animation: lh-rel-float-fade 4s ease-out forwards;
    }
    @keyframes lh-rel-float-fade {
        0% { opacity: 0; transform: translateY(-50%); }
        15% { opacity: 1; transform: translateY(-50%); }
        100% { opacity: 0; transform: translateY(-50%); }
    }
}
`
