/**
 * Undoing what the agent did, when a swipe undoes the turn that caused it.
 *
 * The tracker already works this way: a swipe rolls the memo back to what it
 * was before the reply being replaced. The agent needs the same, and needs it
 * more — a memo is one file the user can edit by hand, and a lorebook pass can
 * have created books, rewritten entries and deleted others across several of
 * them.
 *
 * Two rules run through everything here, both taken from the legacy and both
 * learned the hard way judging by its comments:
 *
 * **Undo is per chat, and chats interleave.** Two campaigns open in two tabs
 * write into one history. Rolling back the newest entry *for this chat* must
 * leave the other chat's entries exactly where they are.
 *
 * **A book is only deleted on undo if this pass created it.** Not "if it
 * matches the campaign prefix" — that would delete a book the user made and
 * named to match. The pre-pass baseline is what decides, and a book that was
 * merely undiscovered when the snapshot was taken counts as pre-existing.
 * Deleting a lorebook is the one action here nothing can walk back.
 */

import { bookBelongsToCampaign } from './campaign.js'

/** What a pass records about the lore before it touches anything. */
export interface LoreSnapshot {
    /** The chat this pass belonged to. The primary key for scoping an undo. */
    chatId?: string | null
    /** The campaign prefix, used to scope older snapshots that carry no chatId. */
    campaignPrefix?: string
    /** Books whose contents were captured whole. */
    bookSnapshots?: Record<string, unknown>
    /** Books named in the snapshot even if their contents were not captured. */
    campaignBookNames?: string[]
    /**
     * The campaign's ownership list as it stood *before* the pass.
     *
     * Part of the baseline on purpose: a book we own but did not happen to read
     * this pass must never look newly created, or an undo would delete it.
     */
    campaignBooks?: string[]
    /** Books this pass created, when the pass was able to say so exactly. */
    createdBookNames?: string[]
    /** The pass log as it stood before, for working out what a pass added. */
    passLog?: Array<{ record?: string[] }>
}

/** One undoable step, and the chat it belongs to. */
export interface LoreHistoryEntry extends LoreSnapshot {
    [key: string]: unknown
}

/** Which chat an undo is being asked about. */
export interface HistoryScope {
    chatId?: string | null
    campaignPrefix?: string
}

/**
 * Every book name a snapshot speaks for.
 *
 * The union of three lists rather than any one of them: books captured whole,
 * books named, and books owned. A name missing here is a name that looks new,
 * and a name that looks new gets deleted on undo.
 */
export function getSnapshotBookNames(snapshot: LoreSnapshot = {}): string[] {
    const names = new Set<string>(Array.isArray(snapshot.campaignBookNames) ? snapshot.campaignBookNames : [])
    for (const name of Object.keys(snapshot.bookSnapshots ?? {})) names.add(name)
    for (const name of Array.isArray(snapshot.campaignBooks) ? snapshot.campaignBooks : []) {
        if (name) names.add(name)
    }
    return [...names].filter(Boolean)
}

/**
 * Whether a history entry belongs to the chat being rolled back.
 *
 * `chatId` decides whenever both sides have one. The campaign-prefix fallback
 * is for entries written before chat ids were recorded; it is weaker on purpose
 * and only consulted when the entry genuinely has no chat id, never as a
 * second chance for an entry whose chat id simply did not match.
 */
export function isHistoryEntryForChat(entry: LoreHistoryEntry | null | undefined, scope: HistoryScope = {}): boolean {
    if (!entry || typeof entry !== 'object') return false

    const entryChat = entry.chatId == null ? '' : String(entry.chatId)
    const scopeChat = scope.chatId == null ? '' : String(scope.chatId)
    if (entryChat.length > 0 && scopeChat.length > 0) return entryChat === scopeChat

    if (!entryChat && entry.campaignPrefix && scope.campaignPrefix) {
        return String(entry.campaignPrefix).toLowerCase() === String(scope.campaignPrefix).toLowerCase()
    }
    return false
}

/** The newest entry that this chat may undo, or `-1`. Newest first. */
export function findHistoryIndexForChat(history: readonly LoreHistoryEntry[] = [], scope: HistoryScope = {}): number {
    if (!Array.isArray(history)) return -1
    return history.findIndex((entry) => isHistoryEntryForChat(entry, scope))
}

/**
 * Drop the entry being undone and everything newer *for the same chat*.
 *
 * Entries belonging to other chats are kept wherever they sit in the list, even
 * when they are newer. Undoing one campaign's last pass must not silently
 * discard another campaign's.
 */
export function trimHistoryForRollback(
    history: readonly LoreHistoryEntry[] = [],
    index = -1,
): LoreHistoryEntry[] {
    if (!Array.isArray(history)) return []
    if (index < 0 || index >= history.length) return [...history]

    const target = history[index]
    const scope: HistoryScope = {
        chatId: target?.chatId ?? null,
        campaignPrefix: (target?.campaignPrefix as string) || '',
    }
    return history.filter(
        (entry, entryIndex) => entryIndex > index || !isHistoryEntryForChat(entry, scope),
    )
}

/** Book names referenced by a run of pass-log entries. */
function bookNamesFromLog(entries: ReadonlyArray<{ record?: string[] } | null | undefined> = []): Set<string> {
    const names = new Set<string>()
    for (const entry of entries) {
        for (const id of entry?.record ?? []) {
            const name = String(id ?? '').split('::')[0]
            if (name) names.add(name)
        }
    }
    return names
}

/** What `getCreatedBookNames` needs to decide what a pass made. */
export interface CreatedBooksInput {
    snapshot?: LoreSnapshot
    /** Book names that exist right now. */
    currentNames?: readonly string[]
    /** The pass log as it stands now, newest first. */
    currentPassLog?: ReadonlyArray<{ record?: string[] }>
    /** Where in the history the undo is happening, for snapshots with no log. */
    historyIndex?: number
    /** The campaign prefix. A book outside it is never deleted, whatever else. */
    prefix?: string
}

/**
 * Books this pass created, and which an undo may therefore delete.
 *
 * Three conditions, all required: the book exists now, it did *not* exist in
 * the pre-pass baseline, and its name falls inside the campaign. A snapshot
 * that recorded exactly what it created is believed; an older one falls back to
 * the books its log entries mention, which is deliberately conservative — it
 * can only under-report, and under-reporting leaves a book behind where
 * over-reporting would destroy one.
 */
export function getCreatedBookNames({
    snapshot = {},
    currentNames = [],
    currentPassLog = [],
    historyIndex = 0,
    prefix = '',
}: CreatedBooksInput = {}): string[] {
    const current = new Set(currentNames)
    const before = new Set(getSnapshotBookNames(snapshot))

    const survives = (name: string): boolean =>
        current.has(name) && !before.has(name) && bookBelongsToCampaign(name, prefix)

    if (Array.isArray(snapshot.createdBookNames)) {
        return snapshot.createdBookNames.filter(survives)
    }

    let added: ReadonlyArray<{ record?: string[] }>
    if (Array.isArray(snapshot.passLog)) {
        added = currentPassLog.slice(0, Math.max(0, currentPassLog.length - snapshot.passLog.length))
    } else {
        // Older still: no log was captured, so assume the pass being undone is
        // the one at this index and take everything up to it.
        added = currentPassLog.slice(0, Math.max(1, historyIndex + 1))
    }

    return [...bookNamesFromLog(added)].filter(survives)
}
