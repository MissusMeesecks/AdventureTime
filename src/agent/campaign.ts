/**
 * Which lorebooks a campaign owns, and which it must never touch.
 *
 * The Lorebook Agent writes to books. That is the whole point of it, and it is
 * also the thing most capable of destroying work that has nothing to do with
 * this extension: a user's hand-written world bible sits in the same list as
 * the books the agent made for itself, and an agent that cannot tell them apart
 * will eventually rewrite one.
 *
 * The legacy answer is a **name prefix**. A campaign called `Vellmoor` owns
 * `Vellmoor` and `Vellmoor_NPCs`, `Vellmoor_LOC` and so on — one
 * underscore segment, no deeper. Everything else in the user's world-book list
 * is somebody else's.
 *
 * That is necessary and not sufficient, and the gap is the reason this module
 * says more than the legacy did. A prefix rule cannot tell a book *we* made
 * called `Vellmoor_NPCs` from one that already existed under that name
 * before this campaign was ever named. So ownership is also **recorded**, per
 * chat, as books are created — and a book that matches the prefix but is not on
 * that list is `adoptable`, not `owned`. Adoption is a decision for the user,
 * made by naming the book; it is never something a pass does on its own.
 */

/** How a book stands in relation to one campaign. */
export type BookStanding =
    /** Made by this campaign, or adopted into it. Free to write. */
    | 'owned'
    /** Matches the campaign's prefix but predates it. Needs the user to say so. */
    | 'adoptable'
    /** Nothing to do with this campaign. Never written to, under any action. */
    | 'foreign'

/**
 * Turn something a user typed into a name a lorebook can carry.
 *
 * Runs of anything but letters and digits collapse to a single underscore, and
 * the ends are trimmed of them — so `Vellmoor: Book II` becomes
 * `Vellmoor_Book_II`. The underscore is load-bearing rather than cosmetic:
 * it is the separator `bookBelongsToCampaign` counts, so a prefix that ended in
 * one would own books it should not.
 */
export function sanitizeCampaignPrefix(raw: string | null | undefined): string {
    if (!raw) return ''
    return String(raw).replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

/** What decides a chat's campaign prefix. */
export interface CampaignPrefixInput {
    /** The chat being asked about. */
    chatId: string | null | undefined
    /** A name the user typed, or empty to derive one from the chat. */
    override?: string | null
    /**
     * The chat that override belongs to.
     *
     * An override is anchored to one chat on purpose. Branching a campaign
     * makes a second chat, and without the anchor both would resolve to the
     * same prefix and share one stack of books — so a deactivation in one
     * would land in the other. Anchoring is what keeps two branches of the same
     * story from writing over each other.
     */
    anchorChatId?: string | null
}

/**
 * The prefix a chat's campaign books are named after.
 *
 * With no override, it is derived from the chat's own id, which is stable and
 * unique and means a user who never names anything still gets books that only
 * their campaign owns.
 */
export function resolveCampaignPrefix({ chatId, override, anchorChatId }: CampaignPrefixInput): string {
    const id = String(chatId ?? '')
    const typed = String(override ?? '').trim()
    if (!typed) return sanitizeCampaignPrefix(id)

    // An unanchored override is not applied to a chat it may not belong to.
    // The legacy resolved this against whichever chat was on screen, which is
    // ambient state a pure function should not have; refusing instead is the
    // safe half of that behaviour and the one that cannot cross campaigns.
    const anchor = String(anchorChatId ?? '').trim()
    if (!anchor) return sanitizeCampaignPrefix(id)

    return id && id === anchor ? sanitizeCampaignPrefix(typed) : sanitizeCampaignPrefix(id)
}

/**
 * Whether a book's *name* places it inside a campaign.
 *
 * Exactly the prefix, or the prefix plus one underscore-separated segment.
 * `Vellmoor_NPCs` belongs; `Vellmoor_NPCs_Old` does not, and neither does
 * `VellmoorOther` — the separator has to be there. Case-insensitive, because
 * book names are typed by people.
 *
 * This is a question about the name only. It says nothing about whether the
 * book was ours to begin with, which is what `bookStanding` is for.
 */
export function bookBelongsToCampaign(bookName: string | null | undefined, prefix: string | null | undefined): boolean {
    if (!prefix || !bookName) return false
    const book = String(bookName).toLowerCase()
    const root = String(prefix).toLowerCase()
    if (book === root) return true
    if (!book.startsWith(`${root}_`)) return false
    const rest = book.slice(root.length + 1)
    return rest.length > 0 && !rest.includes('_')
}

/**
 * Where a book stands: ours, ours-if-you-say-so, or off limits.
 *
 * `owned` is the only standing a pass may write to. The distinction between
 * `adoptable` and `foreign` exists for the user interface, not for the agent —
 * both are refused identically until the user names the book.
 */
export function bookStanding(
    bookName: string | null | undefined,
    prefix: string | null | undefined,
    ownedBooks: readonly string[] = [],
): BookStanding {
    const name = String(bookName ?? '').trim()
    if (!name) return 'foreign'

    // The recorded list wins over the name in both directions: a book we made
    // is ours even if the campaign was later renamed, and a book we did not
    // make is not ours merely for being named as though it were.
    if (ownedBooks.some((owned) => String(owned).toLowerCase() === name.toLowerCase())) return 'owned'

    return bookBelongsToCampaign(name, prefix) ? 'adoptable' : 'foreign'
}

/** Whether a pass may write to this book without asking anyone. */
export function isWritableBook(
    bookName: string | null | undefined,
    prefix: string | null | undefined,
    ownedBooks: readonly string[] = [],
): boolean {
    return bookStanding(bookName, prefix, ownedBooks) === 'owned'
}

/**
 * Add a book to a campaign's ownership list.
 *
 * Returns a new list rather than mutating one, and is idempotent. The caller
 * records a book here at the moment it *creates* it — which is what makes the
 * `owned`/`adoptable` split mean anything, and what stops an undo from
 * deleting a book that merely happened to match the prefix.
 */
export function rememberCampaignBook(ownedBooks: readonly string[], bookName: string): string[] {
    const name = String(bookName ?? '').trim()
    if (!name) return [...ownedBooks]
    if (ownedBooks.some((owned) => String(owned).toLowerCase() === name.toLowerCase())) return [...ownedBooks]
    return [...ownedBooks, name]
}

/**
 * A category, reduced to a single name segment.
 *
 * Not `sanitizeCampaignPrefix`: that maps punctuation to underscores, and an
 * underscore *inside* the leaf would put the book two segments below the
 * campaign — where `bookBelongsToCampaign` no longer recognises it. A custom
 * tag like `NPC: Minor` would have produced `Vellmoor_NPC_Minor`, which the
 * campaign creates and then disowns.
 *
 * So separators are removed here rather than substituted. The stock categories
 * (`NPC`, `LOC`, `FAC`, `EVENT`, `STATS`) are unaffected; a custom one keeps
 * its letters and loses its punctuation.
 */
export function sanitizeCategory(raw: string | null | undefined): string {
    if (!raw) return ''
    return String(raw).replace(/[^a-zA-Z0-9]+/g, '')
}

/**
 * The name a campaign's book for one category takes.
 *
 * `NPC` under `Vellmoor` is `Vellmoor_NPC`. Both halves are sanitized, by
 * different rules and for the same reason: whatever comes out must be a name
 * this campaign will still recognise as its own.
 */
/**
 * The stock WORLD module's tag, World Progression's book here (55-quater).
 * In this file, which imports nothing, so the editor can ask without
 * pulling the agent's legacy slice into the frontend bundle (lesson 54).
 */
export function isWorldModuleTag(tag: string | null | undefined): boolean {
    return String(tag ?? '').trim().toUpperCase() === 'WORLD'
}

export function campaignBookName(prefix: string, category: string | null | undefined): string {
    const root = sanitizeCampaignPrefix(prefix)
    const leaf = sanitizeCategory(category)
    if (!root) return ''
    return leaf ? `${root}_${leaf}` : root
}

/** How many letters of the card's name a self-made campaign name keeps (Phase 51). */
export const CAMPAIGN_NAME_LETTERS = 4

/**
 * A campaign's own name, when nobody typed one (Phase 51, roadmap row 51):
 * the first few letters of the card's name and the time the chat was first
 * shown, `Vell_261011_1432` — readable, sortable, and shared by every book
 * the chat makes from then on, so the map's book made later sits beside the
 * first. Letters and digits only, so the sanitizer has nothing to change.
 * A card with no letters is `Chat`.
 */
export function mintCampaignName(cardName: string | null | undefined, at: Date): string {
    const letters = String(cardName ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(0, CAMPAIGN_NAME_LETTERS) || 'Chat'
    const two = (n: number) => String(n).padStart(2, '0')
    const stamp = `${two(at.getFullYear() % 100)}${two(at.getMonth() + 1)}${two(at.getDate())}_${two(at.getHours())}${two(at.getMinutes())}`
    return `${letters}_${stamp}`
}

/**
 * The minted name, kept clear of every name another chat already carries:
 * two chats on one card in one minute would otherwise share a stack of
 * books. A clash takes a letter: `Vell_261011_1432b`, `…c`, and so on.
 */
export function uniqueCampaignName(wanted: string, taken: readonly string[]): string {
    const used = new Set(taken.map((name) => String(name).toLowerCase()))
    if (!used.has(wanted.toLowerCase())) return wanted
    for (let i = 0; i < 26; i++) {
        const candidate = `${wanted}${String.fromCharCode(98 + i)}`
        if (!used.has(candidate.toLowerCase())) return candidate
    }
    return `${wanted}_${Date.now().toString(36)}`
}
