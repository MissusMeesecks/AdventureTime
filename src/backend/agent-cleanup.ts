/**
 * The cleanup pass (Phase 71c, roadmap row 71): Multihog's 🧹.
 *
 * The same shape as the agent's pass — the same deps, the same loop, the
 * same writer, the same snapshot for the undo, the same terminal feed —
 * with the archivist's prompt in place of the agent's and the flagged
 * entries in place of the story. The records' 🧹 Clean (71a) runs it on one
 * entry; the menu runs it on every entry over the threshold; the
 * auto-cleanup runs it every N passes when something is over.
 */

import { createLoreTools } from '../agent/lore.js'
import { DEFAULT_MAX_TURNS, runAgentLoop, type AgentMessage } from '../agent/loop.js'
import { bookStanding, resolveCampaignPrefix } from '../agent/campaign.js'
import { captureSnapshot } from '../agent/undo.js'
import { applyCommit } from '../agent/writer.js'
import { isWorldProgressionBookName } from '../tracker/world.js'
import { npcSectionNames } from '../tracker/npc-creator.js'
import {
    CLEANUP_STEPS, cleanupContext, cleanupReason, cleanupSystemPrompt, countBloated, flagEntries, nothingToClean,
    type CleanupBook, type CleanupSelection,
} from '../agent/cleanup.js'
import { secondsSince, type StepFn } from './terminal.js'
import type { AgentPassDeps, AgentPassReport } from './agent-pass.js'

export interface CleanupOptions extends CleanupSelection {
    /** The user's custom requirements, appended to the archivist's prompt. */
    instructions?: string
}

/** The campaign's own books with their entries, for the scan. World Progression's are never read. */
async function campaignBooks(deps: AgentPassDeps, prefix: string, ownedBooks: readonly string[]): Promise<Array<CleanupBook & { id: string }>> {
    const books = (await deps.store.listBooks()).filter((book) => !isWorldProgressionBookName(book.name) && bookStanding(book.name, prefix, ownedBooks) === 'owned')
    const out: Array<CleanupBook & { id: string }> = []
    for (const book of books) {
        try {
            out.push({ id: book.id, name: book.name, entries: await deps.store.listEntries(book.id) })
        } catch (error) {
            deps.log?.warn(`agent: cleanup could not read "${book.name}": ${String(error)}`)
        }
    }
    return out
}

export async function runCleanupPass(
    chatId: string,
    userId: string | undefined,
    deps: AgentPassDeps,
    options: CleanupOptions,
): Promise<AgentPassReport> {
    const at = new Date().toISOString()
    const startedAt = Date.now()
    deps.onPassStart?.({ chatId, userId, at, trigger: 'cleanup' })
    deps.step?.('start', options.target ? 'Initializing Lorebook Agent for a targeted cleanup…' : 'Initializing Lorebook Agent for a cleanup…')

    const prefix = resolveCampaignPrefix({ chatId, override: deps.campaign?.override, anchorChatId: deps.campaign?.anchorChatId })
    const ownedBooks = await deps.ownership.get(chatId, userId)
    const hiddenBooks = [...(await deps.ownership.others(chatId, userId)), ...(await deps.store.listBooks()).map((b) => b.name).filter(isWorldProgressionBookName)]

    deps.step?.('thought', options.target ? CLEANUP_STEPS.targeted(options.target) : CLEANUP_STEPS.scanning)
    const flagged = flagEntries(await campaignBooks(deps, prefix, ownedBooks), options)
    const report: AgentPassReport = { at, chatId, prefix, outcome: 'no-commit', summary: '', steps: [], turnsUsed: 0, problems: [] }
    if (!flagged.length) {
        report.summary = nothingToClean(options)
        deps.step?.('finish', report.summary, { seconds: secondsSince(startedAt) })
        return report
    }
    deps.step?.('thought', options.target ? CLEANUP_STEPS.compressing(flagged[0]!.label) : CLEANUP_STEPS.found(flagged.length))

    const messages: AgentMessage[] = [
        { role: 'system', content: cleanupSystemPrompt(options.instructions ?? '') },
        { role: 'user', content: cleanupContext(flagged) },
    ]
    const result = await runAgentLoop(messages, {
        generate: (turn) => deps.generate(turn, userId),
        tools: createLoreTools({ store: deps.store, prefix, ownedBooks, hiddenBooks }),
        maxTurns: deps.maxTurns ?? DEFAULT_MAX_TURNS,
        log: deps.log,
        ...(deps.step ? { step: (type, content) => deps.step?.(type, content) } : {}),
    })
    report.outcome = result.outcome
    report.summary = result.summary
    report.steps = result.steps
    report.turnsUsed = result.turnsUsed
    report.problems = result.problems
    if (result.outcome !== 'committed' || !result.commit) {
        deps.step?.('error', result.outcome === 'cancelled' ? 'Stopped by user.' : result.summary, { seconds: secondsSince(startedAt) })
        return report
    }

    const snapshot = await captureSnapshot(deps.store, { chatId, prefix, ownedBooks, isOwn: (name) => bookStanding(name, prefix, ownedBooks) === 'owned' })
    const messageId = await deps.latestMessageId?.(chatId, userId).catch(() => undefined)
    const cartridge = deps.settings ? await deps.settings(userId).catch(() => ({})) : {}
    const write = await applyCommit(result.commit, {
        store: deps.store,
        prefix,
        ownedBooks,
        timePrefix: '',
        log: deps.log,
        coreHeaders: npcSectionNames((cartridge as { npcCoreSections?: unknown }).npcCoreSections),
        manual: true,
    })
    report.write = write
    if (write.createdBooks.length) await deps.ownership.made(chatId, write.createdBooks, userId)
    if (deps.history) {
        try {
            await deps.history.record(chatId, { ...snapshot, messageId, watermark: deps.watermark, createdBooks: [...write.createdBooks], createdEntries: [...write.createdEntries] }, userId)
        } catch (error) {
            report.problems = [...report.problems, `this pass could not be made undoable: ${String(error)}`]
        }
    }
    const rewritten = result.commit.rewrite.length
    const consolidated = result.commit.consolidate.length
    const details = [rewritten ? `${rewritten} rewritten` : '', consolidated ? `${consolidated} consolidated` : ''].filter(Boolean).join(', ')
    report.summary = `${cleanupReason(options.target)} ${details ? `${details}.` : 'Nothing was rewritten.'}${write.refused.length ? ` ${write.refused.length} refused.` : ''}`
    deps.step?.('finish', CLEANUP_STEPS.done(((Date.now() - startedAt) / 1000).toFixed(1)), { seconds: secondsSince(startedAt) })
    return report
}

// ── The auto-cleanup ─────────────────────────────────────────────────────

export interface AutoCleanupDeps {
    settings(userId: string | undefined): Promise<{ agentCleanupEvery: number; agentCleanupThreshold: number }>
    /** The campaign's books with their entries, for the count. */
    books(chatId: string, userId: string | undefined): Promise<CleanupBook[]>
    step(chatId: string, userId: string | undefined): StepFn
    /** The cleanup pass, run now. */
    run(chatId: string, userId: string | undefined): Promise<unknown>
    log: { info(m: string): void; warn(m: string): void }
    /** The legacy's 200 ms before the queued pass; 0 in a test. */
    delayMs?: number
}

export interface AutoCleanup {
    /** After a pass that wrote: count, hint, and every Nth time run. Never throws. */
    after(chatId: string, userId: string | undefined): Promise<void>
}

/**
 * The legacy's check after every normal pass: a count of entries over the
 * threshold, a hint in the feed when there are any, and every N passes a
 * cleanup pass queued behind the one that just finished. The counter is
 * memory per user, as the legacy's is module-level; a restart starts it over.
 */
export function createAutoCleanup(deps: AutoCleanupDeps): AutoCleanup {
    const counts = new Map<string, number>()
    return {
        async after(chatId, userId) {
            try {
                const settings = await deps.settings(userId)
                const bloated = countBloated(await deps.books(chatId, userId), settings.agentCleanupThreshold)
                const key = userId ?? '@self'
                const count = (counts.get(key) ?? 0) + 1
                counts.set(key, count)
                const every = Math.floor(settings.agentCleanupEvery) || 0
                const step = deps.step(chatId, userId)
                if (every > 0 && count % every === 0 && bloated > 0) {
                    step('thought', CLEANUP_STEPS.autoScheduled(bloated))
                    deps.log.info(`agent: auto-cleanup after pass ${count}: ${bloated} over ${settings.agentCleanupThreshold} tokens`)
                    setTimeout(() => {
                        deps.run(chatId, userId).catch((error: unknown) => deps.log.warn(`agent: the auto-cleanup pass threw: ${String(error)}`))
                    }, deps.delayMs ?? 200)
                } else if (bloated > 0) {
                    step('thought', CLEANUP_STEPS.hint(bloated, settings.agentCleanupThreshold))
                }
            } catch (error) {
                deps.log.warn(`agent: the cleanup check after the pass threw: ${String(error)}`)
            }
        },
    }
}
