/**
 * What Lumiverse decided to load, arranged for reading.
 *
 * This exists to settle one question the maintainer cannot be expected to
 * answer from a description: does Lumiverse's own activation find the lore that
 * *matters* to a scene, or only the lore whose keywords happen to be spelled out
 * in it?
 *
 * The legacy Lorebook Agent curated an active set by hand — a pinned set, a
 * budget, rotation rules, about a third of `applyAction` — because SillyTavern
 * matched keywords and nothing else. Lumiverse does keyword *and* vector
 * activation host-side, and its entries say which of the two fired. So the
 * answer is observable rather than arguable, and a panel that shows it turns a
 * design argument into a glance.
 *
 * Nothing here writes, activates or deactivates anything. It reads what the
 * host already decided.
 */

/** One entry Lumiverse loaded, as the host reports it. */
export interface ActivatedEntry {
    id: string
    comment: string
    keys?: string[]
    /** Which mechanism fired. The whole point of this module. */
    source: 'keyword' | 'vector'
    /** Vector similarity, when the host gave one. */
    score?: number
    bookId?: string
    /** Always loaded rather than matched by anything. */
    constant?: boolean
    /** Eligible to be matched by meaning at all. */
    vectorized?: boolean
}

/** How much of the lore in play could ever match by meaning. */
export interface Eligibility {
    vectorized: number
    total: number
}

/** One row on screen. */
export interface ActivationRow {
    id: string
    /** The entry's title, or a stand-in when it has none. */
    label: string
    /**
     * How this entry got here.
     *
     * `always` is a `constant` entry, which the host reports as a keyword hit
     * because it has no other category for it. It matched nothing — it is
     * simply always in — and calling that a keyword hit inflates the number
     * that the whole question turns on.
     */
    source: 'keyword' | 'vector' | 'always'
    /** `0.82`, or `''` when the host gave no score. */
    score: string
    /** The keys that could have matched, joined for a tooltip. */
    keys: string
}

/** Everything the panel needs to draw the section. */
export interface ActivationView {
    rows: ActivationRow[]
    total: number
    keywordCount: number
    vectorCount: number
    alwaysCount: number
    /** The one-line summary above the rows. */
    summary: string
    /**
     * Why nothing matched by meaning, when nothing did and we can tell.
     *
     * The difference between a search that found nothing and a search that was
     * never switched on. Empty when there is nothing to explain.
     */
    diagnosis: string
}

/**
 * An entry with no title is still a row.
 *
 * A blank line would read as a bug in the panel rather than as an untitled
 * entry, and an untitled entry is a real thing a user can make.
 */
function labelFor(entry: ActivatedEntry): string {
    const comment = String(entry.comment ?? '').trim()
    if (comment) return comment

    const firstKey = (entry.keys ?? []).map((key) => String(key ?? '').trim()).find(Boolean)
    return firstKey ? `(untitled — ${firstKey})` : '(untitled entry)'
}

/**
 * A score, to two places, or `''`.
 *
 * Only vector activation has one. Showing `0.00` for a keyword hit would
 * suggest it scored badly rather than that scoring did not apply to it.
 */
function scoreFor(entry: ActivatedEntry): string {
    if (entry.source !== 'vector') return ''
    if (typeof entry.score !== 'number' || !Number.isFinite(entry.score)) return ''
    return entry.score.toFixed(2)
}

/**
 * Arrange the host's answer.
 *
 * **Vector hits come first**, and that ordering is the argument rather than a
 * preference: a vector hit is an entry Lumiverse found *without* its keywords
 * being in the text, which is precisely the work the legacy agent did by hand.
 * If that list is empty across a few turns, the curation earns its place; if it
 * is full of the right entries, it does not. Putting them at the top means the
 * answer is the first thing on screen.
 *
 * Within each group the strongest score leads, then the label, so the order is
 * stable between draws — a list that reshuffles on every refresh cannot be
 * compared with the one before it.
 */
/** Meaning first, then keyword, then the always-on entries that matched nothing. */
const SOURCE_ORDER: Record<ActivationRow['source'], number> = { vector: 0, keyword: 1, always: 2 }

export function buildActivationView(
    entries: readonly ActivatedEntry[] | null | undefined,
    eligibility?: Eligibility,
): ActivationView {
    const list = Array.isArray(entries) ? entries.filter((entry) => entry && typeof entry === 'object') : []

    const rows = list
        .map((entry): ActivationRow => ({
            id: String(entry.id ?? ''),
            label: labelFor(entry),
            source: entry.constant ? 'always' : entry.source === 'vector' ? 'vector' : 'keyword',
            score: scoreFor(entry),
            keys: (entry.keys ?? []).map((key: unknown) => String(key ?? '').trim()).filter(Boolean).join(', '),
        }))
        .sort((a, b) => {
            if (a.source !== b.source) return SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source]
            const byScore = Number(b.score || 0) - Number(a.score || 0)
            if (byScore !== 0) return byScore
            return a.label.localeCompare(b.label)
        })

    const vectorCount = rows.filter((row) => row.source === 'vector').length
    const alwaysCount = rows.filter((row) => row.source === 'always').length
    const keywordCount = rows.length - vectorCount - alwaysCount

    return {
        rows,
        total: rows.length,
        keywordCount,
        vectorCount,
        alwaysCount,
        summary: summarize(rows.length, keywordCount, vectorCount, alwaysCount),
        diagnosis: diagnose(vectorCount, eligibility),
    }
}

/**
 * What a zero here does and does not mean.
 *
 * This wording is a correction, and the mistake is worth keeping in front of
 * whoever reads it next. 9d shipped a line saying that with no entry marked
 * `vectorized`, "nothing could have been found that way" — a causal claim, made
 * confidently, and **false**. Lumiverse's own per-entry diagnostics show it
 * scoring vector distance and reranking entries regardless, and the reason an
 * entry reports as `keyword` is *deduplication*: "the same entry was already
 * activated by keyword logic, so vector retrieval did not add a second copy."
 *
 * So `keyword` means keyword got there first, not that meaning came up empty.
 * The vector count is still the number the activation decision turns on — it is
 * the *marginal* contribution, the entries meaning added that keyword had
 * missed, which is exactly the work the legacy agent did by hand. But it must
 * be said as that and not as a verdict on whether vector search functions.
 */
function diagnose(vectorCount: number, eligibility?: Eligibility): string {
    if (vectorCount > 0) return ''

    const base =
        'Nothing was added by meaning that keyword had not already found. That is not the same as '
        + 'meaning finding nothing: Lumiverse credits an entry to keyword when keyword matched it '
        + 'first, even where vector search ranked it highly. Its own entry diagnostics show the '
        + 'vector score per entry.'

    if (!eligibility || eligibility.total === 0) return base
    return `${base} (${eligibility.vectorized} of ${eligibility.total} entries here carry the vectorized flag.)`
}

/**
 * The line above the rows, in words rather than counts alone.
 *
 * It says what the numbers *mean* for the open question, because the counts on
 * their own are only meaningful to someone who already knows what is being
 * asked.
 */
function summarize(total: number, keyword: number, vector: number, always: number): string {
    if (total === 0) return 'Lumiverse loaded no lore entries for this chat.'

    const parts = [`${total} ${total === 1 ? 'entry' : 'entries'} loaded`]
    if (keyword) parts.push(`${keyword} by keyword`)
    if (vector) parts.push(`${vector} added by meaning`)
    if (always) parts.push(`${always} always on`)

    // "added by" rather than "found by", throughout: an entry credited to
    // keyword may well have been found by both, and the number that matters is
    // what meaning contributed that keyword had not.
    const tail = vector
        ? ' — the ones added by meaning are ones keyword matching had missed.'
        : ' — meaning added nothing keyword had not already found.'
    return parts.join(', ') + tail
}
