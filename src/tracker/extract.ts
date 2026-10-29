/**
 * Getting the memo out of a tracker pass's raw output.
 *
 * The pass asks for its answer wrapped in `<memo>…</memo>`. Models comply
 * unevenly: some add a preamble, some emit the tags twice, some open the tag
 * and never close it, some skip the wrapper entirely and just start emitting
 * `[TAG]` blocks. All four have to end up as usable text, because the
 * alternative — treating a malformed wrapper as "no output" — silently drops a
 * turn's state changes.
 *
 * Ported from the extraction call site in the legacy `index.js` at the pin,
 * including its two rules: the **last** wrapper wins when there are several,
 * and an unpaired tag is simply stripped rather than being treated as failure.
 */

export interface ExtractedMemo {
    /** The memo text, ready to hand to `mergeMemo`. */
    text: string
    /** How it was found — useful in the log when a pass behaves oddly. */
    source: 'wrapped' | 'unwrapped' | 'empty'
}

/**
 * Pull the memo out of a raw tracker response.
 *
 * The last `<memo>` block wins: a model that shows its working and then gives a
 * final answer puts the answer last, and a model that repeats itself has
 * usually corrected itself. Same rule the block grammar follows.
 */
export function extractMemo(output: string): ExtractedMemo {
    const raw = output ?? ''
    if (!raw.trim()) return { text: '', source: 'empty' }

    const wrapped = [...raw.matchAll(/<memo>([\s\S]*?)<\/memo>/gi)]
    if (wrapped.length > 0) {
        return { text: wrapped[wrapped.length - 1][1].trim(), source: 'wrapped' }
    }

    // No matched pair. Strip any half of one and use what is left — a response
    // that opened `<memo>` and ran out of tokens still carries real blocks.
    const stripped = raw.replace(/<\/?memo>/gi, '').trim()
    return { text: stripped, source: stripped ? 'unwrapped' : 'empty' }
}
