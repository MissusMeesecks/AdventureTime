/**
 * One transaction onto a site's root entry (roadmap row 9, 34b and 34c).
 *
 * The Map Updater and Map Evolution judge their replies differently and
 * commit them the same way: against the entry *as it stands now*, not the
 * copy the prompt was built from; the operation id remembered on the entry
 * so a retry applies once; a chronicle filed in the area's own child entry
 * (`Site :: Area`), made when absent; the root kept out of the keyword
 * scan. What the commit touched is returned so the caller can record an
 * undo for a swipe.
 */

import { extractMapSection, parseMapDocument, replaceMapSection, serializeMapDocument } from '../tracker/map.js'
import {
    appendChronicle,
    applyTransaction,
    chronicleChild,
    findChronicleChild,
    MAP_OPERATION_IDS_KEY,
    MAX_APPLIED_OPERATIONS,
    priorApplication,
    readAppliedOperations,
    stampChronicle,
    transactionSignature,
} from '../tracker/updater.js'
import type { ArchitectIssue } from '../tracker/architect.js'
import type { WorldBookStore, WorldEntry } from './world-pass.js'

/** A mapped site's root entry by address. */
export interface CommitTarget {
    siteRoot: string
    bookName: string
    uid: string
}

/** An entry as it stood before the commit, to put back. */
export interface RestoredEntry {
    id: string
    content: string
    extensions?: Record<string, unknown>
}

export type CommitResult =
    | { ok: true; entryId: string; bookId: string; bookName: string; alreadyApplied: boolean; createdAssets: Array<{ id: string; name: string }>; restore: RestoredEntry[]; created: string[] }
    | { ok: false; retryable: boolean; issues: ArchitectIssue[] }

export async function commitMapTransaction(
    store: WorldBookStore,
    books: ReadonlyArray<{ id: string; name: string }>,
    target: CommitTarget,
    transaction: Record<string, unknown>,
    currentTime: string,
    frozenAreaIds: readonly string[] = [],
): Promise<CommitResult> {
    const book = books.find((b) => b.name === target.bookName)
    if (!book) return { ok: false, retryable: false, issues: [{ code: 'MAP_CONTEXT_CHANGED', path: 'map', hint: `${target.bookName} could not be reloaded. Do not retry this map mutation.` }] }
    const entries: WorldEntry[] = await store.listEntries(book.id)
    const root = entries.find((e) => e.uid === target.uid)
    if (!root) return { ok: false, retryable: false, issues: [{ code: 'MAP_ENTRY_MISSING', path: 'map', hint: 'The mapped root was removed during this pass. Do not retry this map mutation.' }] }

    const operationId = String(transaction.operation_id ?? '').trim()
    const signature = transactionSignature(transaction)
    const applied = readAppliedOperations(root.extensions)
    const prior = priorApplication(applied, operationId, signature)
    if (prior === 'applied') return { ok: true, entryId: `${book.name}::${root.uid}`, bookId: book.id, bookName: book.name, alreadyApplied: true, createdAssets: [], restore: [], created: [] }
    if (prior === 'conflict') return { ok: false, retryable: true, issues: [{ code: 'OPERATION_ID_CONFLICT', path: 'map.operation_id', hint: 'This ID already belongs to a different successful transaction. Retry this new change with a new operation_id.' }] }

    const fresh = parseMapDocument(extractMapSection(root.content), target.siteRoot).document
    const result = applyTransaction(fresh, transaction, currentTime, frozenAreaIds)
    if (!result.ok) return { ok: false, retryable: true, issues: result.issues }

    const restore: RestoredEntry[] = [{ id: root.id, content: root.content, extensions: root.extensions }]
    const created: string[] = []
    for (const chronicle of result.applied.chronicles) {
        const text = stampChronicle(chronicle.text, currentTime)
        if (!text) continue
        const child = findChronicleChild(entries, target.siteRoot, chronicle.areaName)
        if (child) {
            restore.push({ id: child.id, content: child.content, extensions: child.extensions })
            await store.updateEntry(child.id, { content: appendChronicle(child.content, text) })
        } else {
            const made = await store.createEntry(book.id, { ...chronicleChild(target.siteRoot, chronicle.areaName, text), disabled: false })
            created.push(made.id)
        }
    }
    await store.updateEntry(root.id, {
        content: replaceMapSection(root.content, serializeMapDocument(result.applied.document)),
        extensions: { ...(root.extensions ?? {}), [MAP_OPERATION_IDS_KEY]: [...applied, { id: result.applied.operationId, signature }].slice(-MAX_APPLIED_OPERATIONS) },
        disabled: true,
    })
    return { ok: true, entryId: `${book.name}::${root.uid}`, bookId: book.id, bookName: book.name, alreadyApplied: false, createdAssets: result.applied.createdAssets, restore, created }
}
