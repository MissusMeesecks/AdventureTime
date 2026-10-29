/**
 * The full audit (Phase 71c, roadmap row 71): Multihog's 📕.
 *
 * The whole chat, cut into chunks of about the context size, each run
 * through the ordinary agent pass with the audit instruction and the chunk
 * in place of the story — one after another, each chunk's pass seeing the
 * books the one before it wrote. The legacy's queue has no stop of its own
 * (a chat switch kills it); here **Stop the audit** stops the chunk in
 * flight as the agent's own Stop does — before its write, which is the only
 * place a pass can be stopped — and ends the audit, and a chunk the agent's
 * Stop ended ends the audit too (71c-bis: a stop that waited for a chunk of
 * thirty thousand tokens to finish was not a stop to the hand pressing it).
 */

import { AUDIT_TEXT, auditChunkLimit, chunkForAudit, type AuditLine } from '../agent/cleanup.js'
import type { AgentPassReport } from './agent-pass.js'
import type { StepFn } from './terminal.js'

export interface AuditProgress {
    chatId: string
    chunk: number
    total: number
    status: 'running' | 'skipped' | 'done'
}

export interface FullAuditDeps {
    /** The chat's lines as the audit reads them: Player or Narrator, and the cleaned text. */
    lines(chatId: string, userId: string | undefined): Promise<AuditLine[]>
    /** The chunk budget's source: the preference, in tokens. */
    tokens(userId: string | undefined): Promise<number>
    /** One chunk's pass: the ordinary agent pass with the audit instruction and the chunk as its story. */
    pass(chatId: string, userId: string | undefined, chunk: string, index: number, total: number): Promise<AgentPassReport>
    /** Whether an agent pass is running on the chat now; a chunk waits on it, the legacy's 30 s, then is skipped. */
    running(chatId: string): boolean
    /**
     * Stop the agent pass running on the chat, as the agent's own Stop does;
     * called only while the audit's own chunk is in flight. Required, not
     * optional: left unwired, the stop would wait for the chunk again and
     * nothing would say so (the mutation was green with it optional).
     */
    cancel(chatId: string): boolean
    step(chatId: string, userId: string | undefined): StepFn
    progress?(userId: string | undefined, progress: AuditProgress): void
    log: { info(m: string): void; warn(m: string): void }
    /** The wait between busy checks and its count; the legacy's 500 ms × 60. */
    waitMs?: number
    waits?: number
}

export interface FullAuditResult {
    at: string
    status: 'complete' | 'stopped' | 'nothing' | 'failed' | 'busy'
    chunks: number
    done: number
    skipped: number
    /** One line per chunk's pass. */
    summaries: string[]
    reason?: string
}

export interface FullAudit {
    run(chatId: string, userId: string | undefined): Promise<FullAuditResult>
    /** Stop the chunk in flight and end the audit. True when one was running. */
    stop(chatId: string): boolean
    running(chatId: string): boolean
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export function createFullAudit(deps: FullAuditDeps): FullAudit {
    const audits = new Map<string, { stop: boolean; inChunk: boolean }>()
    return {
        running: (chatId) => audits.has(chatId),
        stop(chatId) {
            const audit = audits.get(chatId)
            if (!audit) return false
            audit.stop = true
            // Only the audit's own chunk: a pass the audit is waiting on
            // (an auto-cleanup, a pressed pass) is somebody else's to stop.
            if (audit.inChunk) deps.cancel(chatId)
            return true
        },
        async run(chatId, userId) {
            const at = new Date().toISOString()
            if (audits.has(chatId)) return { at, status: 'busy', chunks: 0, done: 0, skipped: 0, summaries: [], reason: 'A full audit is already running on this chat.' }
            const audit = { stop: false, inChunk: false }
            audits.set(chatId, audit)
            const stopped = (after: number): FullAuditResult => {
                deps.log.info(`agent: full audit stopped after chunk ${after} of ${chunks.length}`)
                return { at, status: 'stopped', chunks: chunks.length, done, skipped, summaries, reason: AUDIT_TEXT.stopped(after, chunks.length) }
            }
            const step = deps.step(chatId, userId)
            const summaries: string[] = []
            let done = 0
            let skipped = 0
            let chunks: string[][] = []
            try {
                chunks = chunkForAudit(await deps.lines(chatId, userId), auditChunkLimit(await deps.tokens(userId)))
                if (!chunks.length) {
                    deps.log.info('agent: full audit: no chat history to audit')
                    return { at, status: 'nothing', chunks: 0, done: 0, skipped: 0, summaries: [], reason: AUDIT_TEXT.nothing }
                }
                deps.log.info(`agent: full audit of chat ${chatId} in ${chunks.length} chunk${chunks.length === 1 ? '' : 's'}`)
                for (const [i, chunk] of chunks.entries()) {
                    if (audit.stop) return stopped(i)
                    deps.progress?.(userId, { chatId, chunk: i + 1, total: chunks.length, status: 'running' })
                    step('thought', AUDIT_TEXT.chunk(i + 1, chunks.length))
                    let waited = 0
                    while (deps.running(chatId) && !audit.stop && waited < (deps.waits ?? 60)) {
                        await sleep(deps.waitMs ?? 500)
                        waited += 1
                    }
                    if (audit.stop) return stopped(i)
                    if (deps.running(chatId)) {
                        skipped += 1
                        step('error', AUDIT_TEXT.skipped(i + 1))
                        deps.log.warn(`agent: full audit skipped chunk ${i + 1}: a pass was still running`)
                        deps.progress?.(userId, { chatId, chunk: i + 1, total: chunks.length, status: 'skipped' })
                        continue
                    }
                    audit.inChunk = true
                    const report = await deps.pass(chatId, userId, chunk.join('\n\n'), i + 1, chunks.length).finally(() => { audit.inChunk = false })
                    // The chunk's pass stopped by hand — the audit's Stop or the
                    // agent's own: the audit ends with it rather than starting
                    // the next chunk under the hand that just stopped this one.
                    if (report.outcome === 'cancelled') {
                        step('error', AUDIT_TEXT.stopped(i, chunks.length))
                        return stopped(i)
                    }
                    summaries.push(`Chunk ${i + 1}: ${report.summary}`)
                    done += 1
                    deps.progress?.(userId, { chatId, chunk: i + 1, total: chunks.length, status: 'done' })
                    await sleep(Math.min(100, deps.waitMs ?? 100))
                }
                step('finish', AUDIT_TEXT.complete(chunks.length))
                return { at, status: 'complete', chunks: chunks.length, done, skipped, summaries }
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error)
                deps.log.warn(`agent: full audit failed: ${reason}`)
                step('error', `${AUDIT_TEXT.failed} ${reason}`)
                return { at, status: 'failed', chunks: chunks.length, done, skipped, summaries, reason }
            } finally {
                audits.delete(chatId)
            }
        },
    }
}
