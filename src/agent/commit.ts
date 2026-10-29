/**
 * What a `commit` asks for, read and checked before anything acts on it.
 *
 * 9a read the tool call out of the model's prose. This reads the *arguments* of
 * the one tool that changes anything, and it is the last layer between a model
 * having a bad turn and a rewritten campaign. Nothing here writes; it turns a
 * bag of untrusted JSON into either a commit worth applying or a list of
 * complaints worth showing.
 *
 * Two design rules, both from the legacy and both worth keeping:
 *
 * **Bad items are dropped, not fatal.** A commit naming six entries, one of
 * them malformed, applies the five. The legacy collects errors and carries on,
 * and it is right to: a whole turn's lore lost because the model fumbled one id
 * is a worse failure than a partial update.
 *
 * **Every target is an entry id.** `book::uid`, and anything without the
 * separator is refused before it can be split into something surprising.
 */

import { isCardTarget } from '../tracker/creator.js'

/** `book::uid`. The only shape a commit may point at. */
const ENTRY_ID = /^[^:]+::.+$/

/**
 * The most keywords one entry may carry.
 *
 * The legacy's cap, and its comment says why: keyword bloat. A model given no
 * limit will happily attach twenty triggers to one entry and turn it into
 * something that fires on every turn.
 */
export const MAX_KEYS = 6

/** A field the agent may replace inside an entry's `[CORE]` block. */
export interface CoreEdit {
    id: string
    field: string
    content: string
}

/** A normalised, checked commit. Every id here is well-formed. */
export interface Commit {
    /** Append to an entry's content. */
    update: Array<{ id: string; content: string; msg?: number | null }>
    /** Replace an entry's content entirely, `[CORE]` excepted. */
    rewrite: Array<{ id: string; content: string }>
    /** Retitle an entry, or re-key it, or both. */
    rename: Array<{ id: string; label?: string; keys?: string[] }>
    /** Merge several entries into one and delete the rest. */
    consolidate: Array<{ survivor: string; targets: string[]; content: string }>
    /** Create an entry. */
    record: Array<{ label: string; category: string; keys: string[]; content: string; msg?: number | null }>
    /** Remove entries outright. */
    deleteIds: string[]
    /**
     * Nudge a numeric relationship field.
     *
     * **Read here and applied by the pass, not the writer.** In the legacy this
     * never touched a lorebook at all: it moved `settings.npcRelationshipValues`,
     * a separate per-NPC store with its own cap, its own change log and its own
     * swipe-rollback record, feeding the relationship bars. That store is
     * `backend/relationship-store.ts` (44), and `runAgentPass` hands these to it
     * after the books are written, so an NPC recorded in the same commit can be
     * named.
     *
     * It is **not** counted as a change to the books — a rel-only commit still
     * writes nothing, and the summary names the items apart. It used to read
     * "1 relationship change" while the writer wrote nothing, which is the
     * silent half-success this layer exists to prevent.
     */
    rel: Array<{ id: string; field: string; delta: number }>
    /** Replace named fields inside `[CORE]`, including appearance and equipment. */
    core: CoreEdit[]
    /** The model's own account of why, for the pass log. */
    reason: string
}

/** What `normalizeCommit` hands back. */
export interface CommitReading {
    commit: Commit
    /** Items that were dropped, in words, for the panel and the pass report. */
    problems: string[]
    /**
     * Entries the model asked to switch on or off.
     *
     * Recorded and **not acted on**. Lumiverse owns activation here; see
     * `docs/DECISION-ACTIVATION.md`. Kept rather than discarded because the
     * stock prompt still asks for them, so a model still sends them, and
     * "ignored 4 activation requests" is a fact worth being able to show —
     * silently dropping them would look like the commit half-failed.
     */
    ignoredActivation: { activate: string[]; deactivate: string[] }
}

/** Everything empty. The answer to a commit that asked for nothing readable. */
export function emptyCommit(): Commit {
    return {
        update: [],
        rewrite: [],
        rename: [],
        consolidate: [],
        record: [],
        deleteIds: [],
        rel: [],
        core: [],
        reason: '',
    }
}

/**
 * The commit fields that carry a list, under the names the model writes.
 *
 * Exported so the prompt can be checked against it. Three live passes failed
 * because the prompt named fields without showing their shape, and each failure
 * was a *different* field — so the prompt test walks this list rather than
 * spot-checking one example. `commit.test.ts` asserts each name here is really
 * read, so the list cannot drift away from the reader below.
 */
export const COMMIT_FIELDS = [ /* `rel` is deliberately absent; see `Commit.rel`. */
    'record',
    'update',
    'rewrite',
    'rename',
    'core',
    'consolidate',
    'delete_ids',
] as const

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/**
 * The items of a commit field, however the model chose to shape it.
 *
 * Three live runs produced three different shapes for `update`, none of them
 * the one the grammar wanted:
 *
 *     update: { "Book::uid": { content: "…" } }
 *     update: { "Book::uid": "…" }
 *     update: [ { id: "…", text: "…" } ]
 *
 * The first two are objects keyed by entry id, and `Array.isArray` said no to
 * both — so the whole update vanished and the pass reported "committed no
 * changes". A model given a list of field names and no shapes will invent one,
 * and the honest response is to read the shapes it reaches for rather than to
 * keep being surprised by them.
 *
 * The object form carries its id in the key, so it is folded in here; a string
 * value becomes `{ content }`, which is the only thing it can sensibly mean.
 */
function asItems(value: unknown): Record<string, unknown>[] {
    if (Array.isArray(value)) {
        return value.filter((item): item is Record<string, unknown> => !!asRecord(item))
    }
    const record = asRecord(value)
    if (!record) return []

    return Object.entries(record).map(([id, item]) => {
        if (typeof item === 'string') return { id, content: item }
        return { ...(asRecord(item) ?? {}), id: asRecord(item)?.id ?? id }
    })
}

/** An empty list or an empty object: the model saying it has nothing of this kind, which is not an unreadable field. */
function sentEmpty(value: unknown): boolean {
    if (Array.isArray(value)) return value.length === 0
    const record = asRecord(value)
    return !!record && Object.keys(record).length === 0
}

/** The keys a `rel` item has named its NPC under when it had no id to cite, in the order they are tried. */
export const REL_NAME_KEYS = ['name', 'npc', 'label', 'target', 'entry', 'who', 'character', 'title'] as const

/** The NPC a `rel` item names under one of `REL_NAME_KEYS`; `''` when none. */
function relName(item: Record<string, unknown>): string {
    for (const key of REL_NAME_KEYS) {
        const value = asText(item[key]).trim()
        if (value) return value
    }
    return ''
}

/**
 * The text of an edit, under whichever key the model used.
 *
 * `text` is what it reached for when not told otherwise, and it means exactly
 * what `content` means.
 */
function contentOf(item: Record<string, unknown>): unknown {
    return item.content !== undefined ? item.content : item.text
}
const asRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

/** A well-formed entry id, or `''`. */
function entryId(value: unknown): string {
    const id = asText(value).trim()
    return ENTRY_ID.test(id) ? id : ''
}

/**
 * Tidy a keyword list.
 *
 * Trimmed, blanks dropped, duplicates removed, capped. Ported from the legacy's
 * `cleanKeys`, cap and all.
 */
export function cleanKeys(keys: unknown): string[] {
    if (!Array.isArray(keys)) return []
    const unique = [...new Set(keys.map((key) => asText(key).trim()).filter(Boolean))]
    return unique.slice(0, MAX_KEYS)
}

/**
 * Strip the `CATEGORY: ` prefix a model puts on a label it was told not to.
 *
 * The prompt says the category goes in its own field and the label is the name
 * alone; models write `NPC: Lissa` anyway. The legacy strips it, so an entry is
 * not titled with its own filing code.
 */
export function cleanLabel(label: unknown): string {
    return asText(label).replace(/^[A-Z_]{2,10}:\s+/i, '').trim()
}

/**
 * Drop the `[ID:…]` markers the agent's own reading format adds.
 *
 * Entries are shown to the model with their ids inline; it copies them back
 * into content it writes. Left in, they accumulate in the entry forever.
 */
export function stripIdMarkers(content: unknown): string {
    return asText(content).replace(/\[ID:[^\]]+\]\n?/gi, '').trim()
}

/**
 * Keep the `[CORE]` and `[MAP]` blocks of an entry through a rewrite.
 *
 * The single most protective thing in this layer. `[CORE]` is an entity's
 * identity — species, origin, the things that do not change — and `[MAP]` is
 * generated canon. A model rewriting an entry to add one sentence will happily
 * drop both, and the legacy refuses to let it: the original blocks are put back
 * where the new ones would have gone, or appended if the rewrite left them out
 * entirely.
 *
 * Ported whole, and checked against the pin, because a bug here is silent and
 * destroys the part of an entry a user most notices missing.
 */
export function protectCoreBlock(originalContent: unknown, newContent: unknown): string {
    const original = asText(originalContent)
    if (!original) return asText(newContent)

    let out = asText(newContent)

    const coreRegex = /\[CORE\]([\s\S]*?)\[\/CORE\]/i
    const originalCore = original.match(coreRegex)
    if (originalCore) {
        const block = originalCore[0]
        out = coreRegex.test(out) ? out.replace(coreRegex, block) : `${block}${out ? `\n${out}` : ''}`
    }

    const mapRegex = /\[MAP\]([\s\S]*?)\[\/MAP\]/i
    const originalMap = original.match(mapRegex)
    if (originalMap) {
        const block = originalMap[0]
        out = mapRegex.test(out)
            ? out.replace(mapRegex, block)
            : `${out.trimEnd()}${out.trim() ? '\n\n' : ''}${block}`
    }

    return out
}

/** Read a commit's arguments, keeping what is well-formed and saying what was not. */
/**
 * Which message the model says this piece of lore came from.
 *
 * Read permissively and checked later against what the pass actually saw:
 * `normalizeCommit` has no idea which messages were in the window, so it takes
 * the claim and `resolveTurn` decides whether to believe it. `msg` is the
 * field name the prompt asks for; `message` is accepted because a model given
 * one name will sometimes reach for the other (9n).
 */
function citedTurn(item: Record<string, unknown>): number | null {
    for (const key of ['msg', 'message']) {
        const raw = item[key]
        // Strings because a model will write "43" or even "#43" as often as 43.
        const value = typeof raw === 'string' ? Number(raw.replace(/^#/, '').trim()) : Number(raw)
        if (Number.isFinite(value) && value >= 0) return Math.floor(value)
    }
    return null
}

export interface CommitOptions {
    /**
     * The chat's Player Card's name (35b). With one, a Body or Worn Equipment
     * edit may be addressed to `{{user}}`, `player`, `pc`, `user` or the
     * name, and the writer sends it to the card; without one those are not
     * entry ids, as before.
     */
    playerCard?: string
}

export function normalizeCommit(args: unknown, options: CommitOptions = {}): CommitReading {
    const commit = emptyCommit()
    const problems: string[] = []
    const source = asRecord(args) ?? {}
    const cardName = options.playerCard?.trim() ?? ''

    /** Pull `{ id, … }` items, complaining about the ones that cannot be used. */
    const withId = <T>(
        field: string,
        build: (item: Record<string, unknown>, id: string) => T | null,
        /** Whether the Player Card's addresses are ids here: the three core-edit fields only. */
        cardToo = false,
    ): T[] => {
        const out: T[] = []
        const items = asItems(source[field])

        // A field the model sent that turned into nothing is the silent failure
        // this layer exists to prevent. Three live passes reported "committed no
        // changes" while the model had asked for an update every time. An
        // empty list is not that: told that every field is a list, a live
        // pass sent `"update": []` for each field it had nothing for, and was
        // refused four times over for saying so (65-quater).
        if (source[field] !== undefined && items.length === 0 && !sentEmpty(source[field])) {
            problems.push(`${field}: could not be read — expected a list of items, or entries keyed by id`)
        }

        for (const raw of items) {
            const item = asRecord(raw)
            if (!item) {
                problems.push(`${field}: not an object`)
                continue
            }
            const id = entryId(item.id) || (cardToo && cardName && isCardTarget(item.id, cardName) ? asText(item.id).trim() : '')
            if (!id) {
                problems.push(`${field}: "${asText(item.id) || '(no id)'}" is not an entry id`)
                continue
            }
            const built = build(item, id)
            if (built) out.push(built)
        }
        return out
    }

    commit.update = withId('update', (item, id) => {
        const content = stripIdMarkers(contentOf(item))
        if (!content) {
            problems.push(`update: "${id}" had nothing to add`)
            return null
        }
        // Present only when the model actually cited one, so the field means
        // "it said this" rather than "we asked and got nothing".
        const msg = citedTurn(item)
        return msg === null ? { id, content } : { id, content, msg }
    })

    // A rewrite with no content would blank the entry. The legacy lets an empty
    // string through and `protectCoreBlock` saves the [CORE] block; refusing it
    // outright is narrower and loses nothing a model meant to do.
    commit.rewrite = withId('rewrite', (item, id) => {
        const content = asText(contentOf(item)).trim()
        if (!content) {
            problems.push(`rewrite: "${id}" had no content, which would have emptied the entry`)
            return null
        }
        return { id, content }
    })

    commit.rename = withId('rename', (item, id) => {
        const renamed: { id: string; label?: string; keys?: string[] } = { id }
        if (item.label !== undefined) renamed.label = cleanLabel(item.label)
        if (item.keys !== undefined) renamed.keys = cleanKeys(item.keys)
        if (renamed.label === undefined && renamed.keys === undefined) {
            problems.push(`rename: "${id}" asked for no change`)
            return null
        }
        if (renamed.label !== undefined && !renamed.label) {
            problems.push(`rename: "${id}" asked for an empty title`)
            return null
        }
        return renamed
    })

    // Not through `withId`: a `rel` item may name the NPC rather than address
    // it — the legacy's "Book::UID or NPC Name" — since the entry it is for
    // may have been recorded in this same commit and have no address yet. The
    // pass resolves the name against the campaign's entries (44).
    //
    // And the name may arrive under another key (65-bis): an NPC recorded in
    // the same commit has no id the model could cite, so a live pass named
    // them the way its record did — and lost both starting values to
    // *"(no id)" names nobody*. The prompt now shows the shape; this takes
    // the obvious spellings anyway, since a dropped value is silent to the
    // player.
    const relItems = asItems(source.rel)
    if (source.rel !== undefined && relItems.length === 0 && !sentEmpty(source.rel)) {
        problems.push('rel: could not be read — expected a list of items, or entries keyed by id')
    }
    commit.rel = relItems.flatMap((raw) => {
        const item = asRecord(raw)
        if (!item) {
            problems.push('rel: not an object')
            return []
        }
        const id = entryId(item.id) || asText(item.id).trim() || relName(item)
        if (!id) {
            problems.push('rel: "(no id)" names nobody')
            return []
        }
        const field = asText(item.field).trim()
        const delta = Number(item.delta)
        if (!field || !Number.isFinite(delta)) {
            problems.push(`rel: "${id}" needs a field and a numeric delta`)
            return []
        }
        return [{ id, field, delta }]
    })

    // Appearance and equipment are core edits under a friendlier name, exactly
    // as the legacy maps them. Keeping them as separate fields in the grammar
    // and one list here is the whole reason this normalising step exists.
    const coreFrom = (field: string, fixedName?: string): CoreEdit[] =>
        withId(field, (item, id) => {
            const name = fixedName ?? asText(item.field).trim()
            const content = asText(contentOf(item))
            if (!name) {
                problems.push(`${field}: "${id}" did not say which field`)
                return null
            }
            return { id, field: name, content }
        }, true)

    commit.core = [
        ...coreFrom('appearance', 'Body'),
        ...coreFrom('equipment', 'Worn Equipment'),
        ...coreFrom('core'),
    ]

    for (const raw of asItems(source.consolidate)) {
        const item = asRecord(raw)
        if (!item) {
            problems.push('consolidate: not an object')
            continue
        }
        const survivor = entryId(item.survivor)
        if (!survivor) {
            problems.push(`consolidate: "${asText(item.survivor) || '(none)'}" is not an entry id`)
            continue
        }
        // The survivor must not be in its own target list, or the merge deletes
        // the entry it just wrote.
        const targets = asArray(item.targets)
            .map(entryId)
            .filter((id) => id && id !== survivor)
        if (!targets.length) {
            problems.push(`consolidate: "${survivor}" had nothing to merge into it`)
            continue
        }
        commit.consolidate.push({ survivor, targets, content: asText(item.content) })
    }

    for (const raw of asItems(source.record)) {
        const item = asRecord(raw)
        if (!item) {
            problems.push('record: not an object')
            continue
        }
        const label = cleanLabel(item.label)
        const category = asText(item.category).trim()
        if (!label) {
            problems.push('record: an entry with no name')
            continue
        }
        // The category decides which book the entry lands in. Without one there
        // is nowhere to put it, and guessing would file a user's lore wrong.
        if (!category) {
            problems.push(`record: "${label}" gave no category, so there is no book to file it in`)
            continue
        }
        const msg = citedTurn(item)
        commit.record.push({
            label,
            category,
            keys: cleanKeys(item.keys),
            content: asText(contentOf(item)),
            ...(msg === null ? {} : { msg }),
        })
    }

    for (const raw of asArray(source.delete_ids)) {
        const id = entryId(raw)
        if (!id) {
            problems.push(`delete_ids: "${asText(raw) || '(empty)'}" is not an entry id`)
            continue
        }
        commit.deleteIds.push(id)
    }

    commit.reason = asText(source.reason).trim()

    return {
        commit,
        problems,
        ignoredActivation: {
            activate: asArray(source.activate).map(entryId).filter(Boolean),
            deactivate: asArray(source.deactivate).map(entryId).filter(Boolean),
        },
    }
}

/** Whether a commit would change anything at all. */
export function isEmptyCommit(commit: Commit): boolean {
    return (
        commit.update.length === 0 &&
        commit.rewrite.length === 0 &&
        commit.rename.length === 0 &&
        commit.consolidate.length === 0 &&
        commit.record.length === 0 &&
        commit.deleteIds.length === 0 &&
        commit.core.length === 0
    )
}
