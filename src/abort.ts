/**
 * Telling a cancellation apart from a fault.
 *
 * `spindle.generate` takes a standard `AbortSignal` and rejects with an
 * `AbortError` when it fires. That arrives at a call site as an ordinary
 * thrown value, and it has to be distinguished from a real failure: a
 * cancelled pass is something the user did on purpose, and reporting it as
 * `failed` puts a red line in the panel for a button they pressed themselves —
 * the confusion Phase 1d fixed for timeouts, in a new place.
 *
 * Lives at the root of `src/` rather than in `backend/` because both the
 * backend and the pure agent loop need it, and the agent layer must not import
 * from the host layer.
 */

/** Whether a thrown value is the abort we asked for. */
export function isAbortError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false
    if ((error as { name?: unknown }).name === 'AbortError') return true
    // Some hosts wrap it. Checked by shape rather than by message text, which
    // is not a contract and changes between providers.
    const cause = (error as { cause?: unknown }).cause
    return !!cause && typeof cause === 'object' && (cause as { name?: unknown }).name === 'AbortError'
}
