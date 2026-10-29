/**
 * What the dice tool was asked, and what it answered.
 *
 * A tool call is invisible from the panel: the host asks the backend, the
 * backend answers, and the reply reads the same whether the narrator rolled
 * or simulated. The first live report after Phase 28 was exactly that
 * question -- *"does this look like it called it properly?"* -- and nothing
 * on screen could answer it. This keeps the last call and a count, for the
 * status line, so the answer is on screen next time (lessons 3d and 3f: the
 * failure that is invisible unless the caller reports it).
 *
 * In memory only. A count that resets when the backend restarts is fine; it
 * is a diagnostic, not a record.
 */

import type { DiceCallDTO } from '../protocol.js'
import type { DiceInvocation } from './dice-tool.js'

export interface DiceLog {
    record(invocation: DiceInvocation, result: string): DiceCallDTO
    last(): DiceCallDTO | undefined
    /** Calls answered since the backend started. */
    count(): number
    /**
     * A reply is starting: what follows is this reply's. Called from the
     * interceptor, once per real generation — a swipe is a new reply.
     */
    beginTurn(): void
    /** The calls made for the reply in progress or just finished, in order. */
    turn(): DiceCallDTO[]
}

/** `Poppy (Stealth) 1d20+7 vs DC 14 → 24`, from the call and the sentence it got back. */
export function summariseDiceCall(invocation: DiceInvocation, result: string, at: Date): DiceCallDTO {
    const args = invocation.args ?? {}
    const total = result.match(/The result(?: \([^)]*\))? of a .* roll(?: against DC \d+)? is: (-?\d+)|rolls a .* The result is: (-?\d+)/)
    const dcRaw = Number(args.dc)
    return {
        at: at.toISOString(),
        toolName: invocation.toolName,
        who: args.who ? String(args.who) : '',
        for: args.for ? String(args.for) : '',
        formula: args.formula ? String(args.formula) : '',
        dc: Number.isFinite(dcRaw) && dcRaw > 0 ? dcRaw : null,
        total: total ? Number(total[1] ?? total[2]) : null,
        verdict: /SUCCESS/.test(result) ? 'success' : /FAILURE/.test(result) ? 'failure' : /→ HIT/.test(result) ? 'hit' : /→ MISS/.test(result) ? 'miss' : null,
    }
}

export function createDiceLog(now: () => Date = () => new Date()): DiceLog {
    let last: DiceCallDTO | undefined
    let count = 0
    let turn: DiceCallDTO[] = []
    return {
        record(invocation, result) {
            last = summariseDiceCall(invocation, result, now())
            count += 1
            turn.push(last)
            return last
        },
        last: () => last,
        count: () => count,
        beginTurn() {
            turn = []
        },
        turn: () => [...turn],
    }
}
