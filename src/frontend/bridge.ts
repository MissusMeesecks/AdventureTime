/**
 * The panel's side of the request bridge.
 *
 * Spindle's frontend/backend channel is two one-way pipes, so this turns them
 * into awaitable calls: send a request with an id, park a promise under that
 * id, resolve it when the matching response arrives.
 *
 * Requests time out. A backend that never answers — because it crashed, was
 * disabled mid-call, or hit a bug — should surface as a failed action in the
 * panel, not as a control that silently never comes back.
 *
 * How long to wait is per-op, not one number. Most ops read or write local
 * storage and answer in milliseconds, so a short deadline is what makes a dead
 * backend obvious. `tracker.run` is a whole model round trip and routinely
 * takes longer than a generation does — holding it to the same deadline made
 * the panel report a timeout while the pass was still running perfectly well,
 * which is indistinguishable from the tracker being broken.
 */

import {
    CHANNEL,
    isEvent,
    isResponse,
    type EventMessage,
    type RequestMessage,
    type RequestOp,
} from '../protocol.js'

export interface BridgeHost {
    sendToBackend(payload: unknown): void
    onBackendMessage(handler: (payload: unknown) => void): () => void
}

/** How long to wait before giving up on a request that only touches storage. */
export const DEFAULT_TIMEOUT_MS = 15_000

/**
 * Ops that cannot answer inside the default deadline, and how long they get.
 *
 * `tracker.run` asks a model what changed. That is the same work as producing a
 * reply — seconds on a hosted model, minutes on a slow local one — so it gets a
 * deadline generous enough that hitting it means something is actually wrong.
 * Even then the panel treats a timeout here as "still running" rather than
 * "failed", because the pass reports itself through `tracker.changed` when it
 * finishes whatever this side decided to stop waiting.
 */
export const OP_TIMEOUT_MS: Partial<Record<RequestOp, number>> = {
    'tracker.run': 180_000,
    // The send bar's pass is the same pass with an instruction (Phase 30).
    'tracker.instruct': 180_000,
    // A pass is a *conversation*: up to five model calls, each the length of a
    // reply, plus lorebook reads between them. It gets more than the tracker
    // for that reason and not out of caution.
    'agent.run': 600_000,
    'agent.instruct': 600_000,
    // The cleanup pass is the same conversation with the archivist (71c).
    'agent.cleanup': 600_000,
    // The full audit is one agent pass per chunk of the whole chat, in a row
    // (71c): a long campaign is many of them. It reports its chunks as events
    // as it goes, so the deadline is only for the answer at the end.
    'agent.audit': 3_600_000,
    // A clone copies every entry of every book through the host, one write
    // each (71c): no model, but a campaign's worth of round trips.
    'campaign.clone': 120_000,
    // One model call each, the length of a long reply: the wizard writes two
    // halves of ten to thirty lines. Both were left on the default in Phase 32
    // and a revision timed out at fifteen seconds while the model was still
    // writing (32b, lesson 35).
    'wizard.draft': 180_000,
    'wizard.revise': 180_000,
    // One model call, a JSON object of fifteen values (74b, the AI Theme Wizard).
    'theme.generate': 180_000,
    // One model call rewriting a whole entry or the Player Card (78c, Edit with AI).
    'records.aiEdit': 180_000,
    // Two model calls at most -- a consolidation and the report -- each the
    // length of a long reply, over the campaign's whole location lore.
    'world.run': 600_000,
    // One model call, but the longest reply of any: a dozen premises with a
    // paragraph each, over every lorebook the user selected.
    'world.skeleton': 600_000,
    // One model call, one paragraph out, over thirty messages in.
    'world.skeletonSource': 180_000,
    // One model call over the oldest N reports (72b), the length of a digest.
    'world.consolidate': 600_000,
    // Up to three model calls, each one JSON transaction over a whole map (34b).
    'map.update': 300_000,
    // Every mapped site named, three calls each and one more to compress (34c).
    'map.evolve': 900_000,
    // A map from the panel (71a): Auto's brief call, then the architect's two calls with their corrections.
    'map.create': 900_000,
    // The terminal's architect bar (71b) is the same two calls, after a brief.
    'map.direct': 900_000,
    // The Testing Ground (71d): one pass on a site; up to twenty ticks of them; the last of either run again.
    'map.sandbox.evolve': 900_000,
    'map.sandbox.simulate': 3_600_000,
    'map.sandbox.redo': 3_600_000,
    // One model call writing a whole sheet, through the tracker's direct pass
    // (35). Left on the default once, like the wizard before it (35-bis).
    // The creator's ways are composite (lesson 45): the sheet's pass, then the
    // Player Card's call, then the persona — three waits, not one. Live, the
    // persona way ran past a single pass's deadline while finishing fine.
    'creator.generate': 600_000,
    // The same sheet, then one message sent (35a).
    'creator.instant': 600_000,
    // The Player Card: one model call (35b).
    'creator.card.write': 300_000,
    // The other ways to begin: the sheet's pass, then the card (35c).
    'creator.ways': 600_000,
    // Import Card (39): the sheet's pass, then the persona and the card's one call.
    'creator.import': 600_000,
    // The NPC library (41): each puts a card into play through one direct tracker pass.
    'library.party': 180_000,
    // One model call writing the image prompt, then the host's image
    // connection drawing it (49): a minute on a hosted generator, more on
    // a local one.
    'scene.draw': 300_000,
    // The prompt written for editing before a draw (73f): one model call each.
    'scene.prompt': 180_000,
    'library.photo.prompt': 180_000,
    'portraits.prompt': 180_000,
    'library.playAsPc': 180_000,
    // A card's photo drawn (60): one model call writing the prompt, then the image connection, as the scene's draw.
    'library.photo.draw': 300_000,
    /** A portrait drawn on a press (61): one model call and one image, behind whatever is queued. */
    'portraits.draw': 300_000,
    // The NPC creator (41a): one model call each — a draft to preview, or a card reviewed on its way in.
    'npc.draft': 180_000,
    'npc.add': 180_000,
}

/**
 * Ops that call a model, and therefore cannot answer inside the default.
 *
 * Kept as its own list so `slow-ops.test.ts` can assert every one of them has a
 * deadline. This exact bug has now happened three times — `tracker.run` in
 * Phase 1d, `agent.run` in 9h, and `wizard.revise` in 32 — and each time the
 * symptom was a working pass reporting a timeout, which reads as a failure.
 * The third time the lock below existed and did not bite, because the op was
 * never added to it: a list that has to be remembered is not a lock. So
 * `slow-ops.test.ts` now *derives* this list from the backend's own source —
 * every op whose handler reaches a model-calling dependency — and fails when
 * this one disagrees with it (lesson 35).
 */
export const MODEL_CALLING_OPS: readonly RequestOp[] = [
    'tracker.run',
    'tracker.instruct',
    'agent.run',
    'agent.instruct',
    'agent.cleanup',
    'agent.audit',
    'wizard.draft',
    'wizard.revise',
    'world.run',
    'world.skeleton',
    'world.skeletonSource',
    'world.consolidate',
    'map.update',
    'map.evolve',
    'map.create',
    'map.direct',
    'map.sandbox.evolve',
    'map.sandbox.simulate',
    'map.sandbox.redo',
    'creator.generate',
    'creator.instant',
    'creator.card.write',
    'creator.ways',
    'creator.import',
    'library.party',
    'library.playAsPc',
    'library.photo.draw',
    'portraits.draw',
    'npc.draft',
    'npc.add',
    'scene.draw',
    'scene.prompt',
    'library.photo.prompt',
    'portraits.prompt',
]

/**
 * A request that ran out of time, as opposed to one the backend refused.
 *
 * Distinguishable on purpose: the panel says something quite different about a
 * pass that is merely slow than about one that failed, and matching on the
 * message text to tell them apart is the kind of thing that breaks silently
 * when the wording changes.
 */
export class RequestTimeoutError extends Error {
    readonly op: RequestOp
    readonly timeoutMs: number

    constructor(op: RequestOp, timeoutMs: number) {
        super(`${op} timed out after ${Math.round(timeoutMs / 1000)}s`)
        this.name = 'RequestTimeoutError'
        this.op = op
        this.timeoutMs = timeoutMs
    }
}

interface Pending {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
}

export class Bridge {
    readonly #host: BridgeHost
    readonly #pending = new Map<string, Pending>()
    readonly #listeners = new Set<(event: EventMessage) => void>()
    readonly #timeoutMs: number
    readonly #opTimeoutMs: Partial<Record<RequestOp, number>>
    #unsubscribe: (() => void) | null = null
    #nextId = 0

    constructor(
        host: BridgeHost,
        options: { timeoutMs?: number; opTimeoutMs?: Partial<Record<RequestOp, number>> } = {},
    ) {
        this.#host = host
        this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
        this.#opTimeoutMs = options.opTimeoutMs ?? OP_TIMEOUT_MS
        this.#unsubscribe = host.onBackendMessage((payload) => this.#receive(payload))
    }

    /** How long this op gets. Per-op first, then the default. */
    timeoutFor(op: RequestOp): number {
        return this.#opTimeoutMs[op] ?? this.#timeoutMs
    }

    #receive(payload: unknown): void {
        if (isEvent(payload)) {
            for (const listener of this.#listeners) listener(payload)
            return
        }

        if (!isResponse(payload)) return

        const pending = this.#pending.get(payload.id)
        if (!pending) return
        this.#pending.delete(payload.id)
        clearTimeout(pending.timer)

        if (payload.ok) pending.resolve(payload.data)
        else pending.reject(new Error(payload.error ?? 'The backend reported an error.'))
    }

    /** Send a request and wait for its reply. */
    request<T>(op: RequestOp, params?: Record<string, unknown>): Promise<T> {
        const id = `r${++this.#nextId}`
        const message: RequestMessage = { channel: CHANNEL, kind: 'request', id, op, params }
        const timeoutMs = this.timeoutFor(op)

        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.#pending.delete(id)
                reject(new RequestTimeoutError(op, timeoutMs))
            }, timeoutMs)

            this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
            this.#host.sendToBackend(message)
        })
    }

    /** Subscribe to unsolicited backend events. */
    on(listener: (event: EventMessage) => void): () => void {
        this.#listeners.add(listener)
        return () => this.#listeners.delete(listener)
    }

    /** Drop every listener and fail anything still in flight. */
    dispose(): void {
        this.#unsubscribe?.()
        this.#unsubscribe = null
        for (const [, pending] of this.#pending) {
            clearTimeout(pending.timer)
            pending.reject(new Error('The panel was closed.'))
        }
        this.#pending.clear()
        this.#listeners.clear()
    }
}
