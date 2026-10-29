/**
 * The agents' terminal (Phase 71b, roadmap row 71): Multihog's
 * Terminal/Direct Prompt — every pass announcing its steps as it goes, one
 * feed per agent, so the panel can show a pass working rather than its
 * report after.
 *
 * The legacy broadcasts a DOM event per step (`rt_lore_agent_step`: a type,
 * the text, the source) and the panel keeps a buffer per tab, emptied when
 * a source says `start`. Here the passes run in the backend, so the steps
 * cross the bridge as `terminal.step` events and the buffer is kept here
 * too, per chat and per source, for a panel that opens after a pass began
 * or a page that reloads mid-pass (`terminal.get`).
 */

import type { TerminalSource, TerminalStep, TerminalStepType } from '../protocol.js'

export type { TerminalSource, TerminalStep, TerminalStepType }

export const TERMINAL_SOURCES: readonly TerminalSource[] = ['state_tracker', 'lorebook_agent', 'map_updater', 'map_evolution', 'map_architect']

/** The legacy's tab labels, in its order. */
export const TERMINAL_TABS: ReadonlyArray<{ id: TerminalSource; label: string }> = [
    { id: 'state_tracker', label: 'State Tracker' },
    { id: 'lorebook_agent', label: 'Lorebook Agent' },
    { id: 'map_updater', label: 'Map Updater' },
    { id: 'map_evolution', label: 'Map Evolution' },
    { id: 'map_architect', label: 'Map Architect' },
]

/** What a pass is given: the step's type and text, the chat and user known to the binder. */
export type StepFn = (type: TerminalStepType, content: string, meta?: { seconds?: number }) => void

export interface TerminalDeps {
    /** A step crosses to the frontend. */
    send(chatId: string, userId: string | undefined, step: TerminalStep): void
    /** Steps kept per source per chat; the legacy keeps a pass's steps until the next pass. */
    keep?: number
    /** Chats kept; the oldest forgotten beyond it. */
    chats?: number
    now?: () => Date
}

export interface Terminal {
    /** One step, announced and kept. A `start` empties the source's buffer first, as the legacy's does. */
    step(chatId: string, userId: string | undefined, source: TerminalSource, type: TerminalStepType, content: string, meta?: { seconds?: number }): void
    /** A step function bound to one pass, for its deps. */
    bind(source: TerminalSource, chatId: string, userId: string | undefined): StepFn
    /** Every kept step of the chat, per source. */
    steps(chatId: string): Record<TerminalSource, TerminalStep[]>
    /** The kept steps of one source, or of every source, forgotten. */
    clear(chatId: string, source?: TerminalSource): void
}

export const DEFAULT_TERMINAL_KEEP = 120
export const DEFAULT_TERMINAL_CHATS = 12

function emptyBuffers(): Record<TerminalSource, TerminalStep[]> {
    return { state_tracker: [], lorebook_agent: [], map_updater: [], map_evolution: [], map_architect: [] }
}

export function isTerminalSource(value: unknown): value is TerminalSource {
    return typeof value === 'string' && (TERMINAL_SOURCES as readonly string[]).includes(value)
}

export function createTerminal(deps: TerminalDeps): Terminal {
    const keep = Math.max(1, deps.keep ?? DEFAULT_TERMINAL_KEEP)
    const chats = Math.max(1, deps.chats ?? DEFAULT_TERMINAL_CHATS)
    const now = deps.now ?? (() => new Date())
    const buffers = new Map<string, Record<TerminalSource, TerminalStep[]>>()

    function bufferOf(chatId: string): Record<TerminalSource, TerminalStep[]> {
        let found = buffers.get(chatId)
        if (found) {
            // Touched last: moved to the end, so the oldest untouched chat is the one forgotten.
            buffers.delete(chatId)
            buffers.set(chatId, found)
            return found
        }
        found = emptyBuffers()
        buffers.set(chatId, found)
        while (buffers.size > chats) {
            const oldest = buffers.keys().next().value
            if (oldest === undefined) break
            buffers.delete(oldest)
        }
        return found
    }

    const terminal: Terminal = {
        step(chatId, userId, source, type, content, meta) {
            const buffer = bufferOf(chatId)
            if (type === 'start') buffer[source] = []
            const step: TerminalStep = {
                source,
                type,
                content: String(content ?? ''),
                at: now().toISOString(),
                ...(meta && typeof meta.seconds === 'number' && Number.isFinite(meta.seconds) ? { seconds: Math.max(0, Math.round(meta.seconds * 10) / 10) } : {}),
            }
            buffer[source].push(step)
            if (buffer[source].length > keep) buffer[source].splice(0, buffer[source].length - keep)
            try {
                deps.send(chatId, userId, step)
            } catch {
                // A frontend that is not there to hear it costs nothing; the buffer keeps the step.
            }
        },
        bind(source, chatId, userId) {
            return (type, content, meta) => terminal.step(chatId, userId, source, type, content, meta)
        },
        steps(chatId) {
            const found = buffers.get(chatId)
            const out = emptyBuffers()
            if (!found) return out
            for (const source of TERMINAL_SOURCES) out[source] = [...found[source]]
            return out
        },
        clear(chatId, source) {
            const found = buffers.get(chatId)
            if (!found) return
            if (source) found[source] = []
            else for (const s of TERMINAL_SOURCES) found[s] = []
        },
    }
    return terminal
}

/**
 * The legacy's `parseMapArchitectCreateDirective`: an explicit creation
 * target in a natural direct command — `Create a DUNGEON map for "The
 * Hollow"` — or `null` when the command names none.
 */
export function parseMapArchitectDirective(value: string): { kind: 'SETTLEMENT' | 'DUNGEON' | 'INTERIOR'; site: string } | null {
    const text = String(value || '').trim()
    const match = text.match(/\bcreate\s+(?:an?\s+)?(SETTLEMENT|DUNGEON|INTERIOR)\s+map\s+for\s+(?:"([^"]+)"|'([^']+)'|([^:\r\n]+?))\s*(?::|$)/i)
    if (!match) return null
    const site = String(match[2] || match[3] || match[4] || '').trim()
    if (!site) return null
    return { kind: match[1]!.toUpperCase() as 'SETTLEMENT' | 'DUNGEON' | 'INTERIOR', site }
}

/** The seconds between two instants, for a `finish` step. */
export function secondsSince(startedAt: number, now: number = Date.now()): number {
    return Math.max(0, (now - startedAt) / 1000)
}
