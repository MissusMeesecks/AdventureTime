/**
 * The display-only regex script that hides the `<choices>` block, kept in
 * step with a preference.
 *
 * Phase 31a installed it in the host's regex library (*AdventureTime — hide the
 * choices block*, `target: "display"`, `placement: ["ai_output"]`): it
 * changes what the bubble shows and nothing that is stored or sent, so the
 * message keeps its block, the history trim still finds it and the buttons
 * still read it. Phase 33a took it back after a live slowdown on a long
 * chat (lesson 37) and moved the hiding to the frontend's sweep
 * (`frontend/choices-hide.ts`). The maintainer asked for it again
 * (2026-10-16): the slowdown had another cause since sorted, and the sweep
 * hides the lines only when it runs, so a bubble can show the raw block
 * until the next refresh. So since Phase 65 the script is **a preference**,
 * `choicesDisplayRegex`, on by default: on, the script is installed by name
 * if it is missing; off, it is deleted by name. The sweep stays either way
 * as the fallback — with the script on it finds nothing to hide.
 *
 * Reconciled once per user and wanted state, on the first request or reply
 * of a session and again when the preference moves; a refusal is logged
 * once and retried next time, and costs the duplicate lines (on) or the
 * slowdown (off) and nothing else. It needs the `regex_scripts` permission
 * (rule 3d); the panel's permission line names it when it is missing.
 */

export const CHOICES_DISPLAY_SCRIPT = Object.freeze({
    name: 'AdventureTime — hide the choices block',
    find_regex: '<choices\\b[^>]*>[\\s\\S]*?<\\/choices\\s*>',
    replace_string: '',
    flags: 'gi',
    placement: ['ai_output'] as Array<'ai_output'>,
    scope: 'global' as const,
    target: 'display' as const,
    folder: 'AdventureTime',
    description: 'CYOA mode draws the choices as buttons under the reply; this keeps the raw block out of the bubble. Display only: nothing stored or sent changes. Switched on and off by AdventureTime’s preference under General & visuals.',
})

export const CHOICES_DISPLAY_SCRIPT_NAME = CHOICES_DISPLAY_SCRIPT.name

export interface RegexScriptsApi {
    list(options?: { target?: 'display'; userId?: string; limit?: number }): Promise<{ data: Array<{ id: string; name: string; can_mutate?: boolean }> }>
    create(input: typeof CHOICES_DISPLAY_SCRIPT, userId?: string): Promise<{ id: string }>
    delete(scriptId: string, userId?: string): Promise<unknown>
}

export interface ChoicesDisplayDeps {
    regex: RegexScriptsApi
    log: { info(m: string): void; warn(m: string): void }
}

export type ChoicesDisplayOutcome = 'present' | 'created' | 'absent' | 'removed' | 'failed'

export interface ChoicesDisplay {
    /**
     * Make the host's library match the preference for this user: the
     * script there when `wanted`, gone when not. Memoised per user and
     * wanted state; safe to call on every request.
     */
    ensure(userId: string | undefined, wanted: boolean): Promise<ChoicesDisplayOutcome>
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

export function createChoicesDisplay(deps: ChoicesDisplayDeps): ChoicesDisplay {
    const done = new Map<string, { wanted: boolean; pending: Promise<ChoicesDisplayOutcome> }>()

    async function reconcile(userId: string | undefined, wanted: boolean): Promise<ChoicesDisplayOutcome> {
        const who = userId ? ` for ${userId}` : ''
        try {
            const { data } = await deps.regex.list({ target: 'display', limit: 200, ...(userId ? { userId } : {}) })
            const ours = data.filter((script) => script.name === CHOICES_DISPLAY_SCRIPT.name)
            if (wanted) {
                if (ours.length) return 'present'
                await deps.regex.create(CHOICES_DISPLAY_SCRIPT, userId)
                deps.log.info(`choices: installed the display-only regex script that hides the <choices> block${who}`)
                return 'created'
            }
            if (!ours.length) return 'absent'
            for (const script of ours) await deps.regex.delete(script.id, userId)
            deps.log.info(`choices: removed the display-only regex script${who}; the bubble hides the block itself`)
            return 'removed'
        } catch (error) {
            // Once per user. The permission line in the panel names the cause
            // when it is the grant; this names it in the log either way.
            deps.log.warn(wanted
                ? `choices: could not install the display-only regex script (the sweep hides the block on its own): ${describe(error)}`
                : `choices: could not remove the display-only regex script (it will keep running in the host until it is switched off or deleted in the regex library): ${describe(error)}`)
            return 'failed'
        }
    }

    return {
        ensure(userId, wanted) {
            const key = userId ?? '@self'
            const known = done.get(key)
            if (known && known.wanted === wanted) return known.pending
            const pending = reconcile(userId, wanted).then((outcome) => {
                // A failure is retried on the next call; a success is not.
                if (outcome === 'failed' && done.get(key)?.pending === pending) done.delete(key)
                return outcome
            })
            done.set(key, { wanted, pending })
            return pending
        },
    }
}
