/**
 * A memo, plus the settings that decide how it is arranged, into a view model.
 *
 * This is the whole read path in one call: `buildTrackerView(memo, settings)`
 * gives back the blocks to draw, in order, each with its label, its icon and
 * its lines already parsed. Nothing here touches the host, the DOM or storage,
 * so the arrangement rules can be tested as rules.
 *
 * Finished quests are the one thing not in the memo — the tracker pass strips
 * them out of it every turn — so they come in as a third argument from the
 * archive store, and get folded back in here rather than anywhere downstream.
 */

import { isErasedBlockContent, parseMemoBlocks, splitBlockLines } from './memo.js'
import { barPrefFor, type BarPrefs } from './bars.js'
import { parseBlockLine, type TrackerLine } from './lines.js'
import { ENTITY_TAGS } from './entities.js'
import { buildEntityBlockView, type EntityBlockView } from './entity-view.js'
import { buildQuestLogView, type QuestLogView } from './quest-view.js'
import { parseQuestsFromMemo, questIdentity, type Quest } from './quests.js'
import { currentTimeFromMemo } from './time.js'

/**
 * The stock blocks, in the order they are drawn when the user has not
 * reordered them. From `constants.js` at the pin.
 *
 * `BENCHED PARTY` is deliberately absent: it is a real block with its own
 * module toggle, but it is never its own card — it folds into PARTY as a camp
 * roster, because it is a sub-state of party membership rather than a system of
 * its own.
 */
export const BLOCK_ORDER = ['COMBAT', 'CHARACTER', 'PARTY', 'INVENTORY', 'ABILITIES', 'SPELLS', 'XP', 'TIME', 'QUESTS']

/** The block that folds into PARTY rather than getting a card of its own. */
export const FOLDED_INTO_PARTY = 'BENCHED PARTY'

/** Stock block icons, from `constants.js` at the pin. */
export const BLOCK_ICONS: Record<string, string> = {
    TIME: '🕒',
    XP: '🌟',
    CHARACTER: '🧙',
    PARTY: '👥',
    'BENCHED PARTY': '⛺',
    COMBAT: '⚔️',
    INVENTORY: '🎒',
    ABILITIES: '✨',
    SPELLS: '📖',
    QUESTS: '📋',
}

/** Icon for a block nothing has claimed — a tag the model invented, usually. */
export const DEFAULT_BLOCK_ICON = '📄'

/** A user-defined tracker block, as a cartridge carries it. */
export interface CustomField {
    tag: string
    label?: string
    icon?: string
    [key: string]: unknown
}

/** The tag whose card is drawn from parsed quest records rather than from its lines. */
export const QUEST_TAG = 'QUESTS'

/** The slice of settings the read path reads. */
export interface TrackerSettings {
    blockOrder?: string[]
    customFields?: CustomField[]
    /**
     * Entity name -> image reference, for the portrait on an entity card.
     *
     * Display data rather than a setting, and here for the same reason
     * `customFields` is: it changes what the renderer draws and it has to reach
     * every caller of `buildTrackerView` — the panel, and the cards under each
     * message, which get portraits for free by sharing this path.
     */
    portraits?: Record<string, string>
    /**
     * What the user decided about individual bars, keyed by `data-rt-bar-id`.
     *
     * Display state like `portraits`, and outside the cartridge for the same
     * reason: a colour someone picked for their own screen is a property of the
     * install, not of the game.
     */
    bars?: BarPrefs
    /** Animate changes on every custom `((BAR))` and `((BARREL))` (74h), Multihog's `animateAllCustomBarChanges`. */
    animateCustomBars?: boolean
    /**
     * The module toggles. Three of them change how quests draw:
     * `questsDeadlines`, `questsFrustration` and `questsShowArchive`.
     */
    syspromptModules?: Record<string, boolean>
}

export interface TrackerBlock {
    /** Upper-cased tag as it appeared in the memo. */
    tag: string
    /** What to show as the card's title — a custom field's label, or the tag. */
    label: string
    icon: string
    /** The block's content, unparsed. Kept so a raw view needs no second parse. */
    raw: string
    /** The model said this block is empty (`NONE`, `CLEARED`, `REMOVED`, `EXPIRED`). */
    erased: boolean
    lines: TrackerLine[]
    /**
     * Set on `[QUESTS]` only, and only when the block parsed into at least one
     * quest. The renderer draws this instead of `lines` when it is present —
     * and falls back to `lines` when it is not, so a block the quest grammar
     * could not read still shows its text rather than disappearing.
     */
    quests?: QuestLogView
    /**
     * Set on `[COMBAT]`, `[PARTY]`, `[BENCHED PARTY]` and `[CHARACTER]`, and
     * only when the block anchored at least one entity. Same contract as
     * `quests`: absent means draw `lines`, so a block whose second grammar
     * could not read it still shows its text.
     */
    entities?: EntityBlockView
}

export interface TrackerView {
    blocks: TrackerBlock[]
    /** `[BENCHED PARTY]`, held aside for the PARTY card rather than given its own. */
    benchedParty: TrackerBlock | null
    /** Tags the memo carried that `blockOrder` does not mention, in the order used. */
    unordered: string[]
    /** No memo, or a memo with no blocks in it at all. */
    empty: boolean
}

/**
 * Arrange the tags to draw.
 *
 * Anything the order names and the memo carries comes first, in that order;
 * anything else the memo carries follows, alphabetically, so a block the model
 * invented still appears somewhere predictable rather than vanishing.
 */
export function orderBlockTags(present: string[], blockOrder: string[]): { ordered: string[]; unordered: string[] } {
    const order = blockOrder.filter((tag) => tag !== FOLDED_INTO_PARTY)
    const known = new Set(order)
    const unordered = present.filter((tag) => !known.has(tag) && tag !== FOLDED_INTO_PARTY).sort()
    return { ordered: [...order.filter((tag) => present.includes(tag)), ...unordered], unordered }
}

function buildBlock(tag: string, raw: string, customFields: CustomField[], bars?: BarPrefs, animateCustomBars?: boolean): TrackerBlock {
    const custom = customFields.find((field) => String(field.tag).toUpperCase() === tag)
    const { lines } = splitBlockLines(raw)

    return {
        tag,
        label: custom?.label || tag,
        icon: custom?.icon || BLOCK_ICONS[tag] || DEFAULT_BLOCK_ICON,
        raw,
        erased: isErasedBlockContent(raw),
        lines: lines.map((line, index) => parseBlockLine(line, { tag, lineIndex: index, bars, animateCustomBars })),
    }
}

/**
 * Build the view for one memo.
 *
 * Note what this deliberately does *not* do, all of it matching the legacy
 * build: it does not hide a block because its module is switched off, and it
 * does not hide an erased one. Module toggles govern what the model is asked to
 * emit, not what is drawn — so a block still in the memo after its module was
 * disabled stays visible, which is the honest reading of the state that exists.
 */
export function buildTrackerView(
    memo: string,
    settings: TrackerSettings = {},
    archivedQuests: Quest[] = [],
): TrackerView {
    const blocks = parseMemoBlocks(memo || '')
    const archive = Array.isArray(archivedQuests) ? archivedQuests.filter((quest) => quest?.title) : []
    const present = Object.keys(blocks)

    // A campaign whose every quest is finished has no `[QUESTS]` block left at
    // all — the pass removes the block once it would be empty. Without this the
    // archive would become invisible at exactly the moment it holds everything,
    // so the tag gets a card built from an empty block and the archive alone.
    if (archive.length && !present.includes(QUEST_TAG)) present.push(QUEST_TAG)
    const customFields = Array.isArray(settings.customFields) ? settings.customFields : []
    const blockOrder = Array.isArray(settings.blockOrder) && settings.blockOrder.length ? settings.blockOrder : BLOCK_ORDER

    const { ordered, unordered } = orderBlockTags(present, blockOrder)

    const modules = settings.syspromptModules ?? {}
    // The legacy truthiness, kept exactly rather than tidied: deadlines and
    // frustration are off unless switched on, the archive is on unless switched
    // off. The asymmetry looks like an oversight and may well be one, but the
    // factory sets all three true and every real settings object backfills from
    // it, so the only thing "fixing" it would change is what a *missing*
    // syspromptModules does — and that is exactly where a silent divergence
    // from the legacy build would be hardest to notice.
    const questSettings = {
        showDeadlines: modules.questsDeadlines === true,
        showFrustration: modules.questsFrustration === true,
        showArchive: modules.questsShowArchive !== false,
    }

    /**
     * Give a block its second grammar, if it has one.
     *
     * Both are all-or-nothing and both fail soft: a `[QUESTS]` block that parses
     * to no quests, or an entity block that anchors nobody, keeps its plain
     * lines and draws exactly as it did before either grammar existed.
     */
    const attachSecondGrammar = (block: TrackerBlock): TrackerBlock => {
        if (block.tag === QUEST_TAG) {
            const quests = parseQuestsFromMemo(memo)

            // Fail soft, as everywhere else: a block whose text the quest
            // grammar could not read keeps its plain lines. The archive is not
            // reason enough to override that — the memo's own words matter more
            // than a tidy card, and drawing the archive over unreadable text
            // would look like the text had been lost.
            const unreadable = !quests.length && !isErasedBlockContent(block.raw)
            if (unreadable) return block
            if (!quests.length && !archive.length) return block

            // The memo wins over the archive: a quest that is active again —
            // reopened by the model, or restored by a swipe — must not also
            // appear as finished.
            const live = new Set(quests.map(questIdentity))
            const finished = archive.filter((quest) => !live.has(questIdentity(quest)))

            return {
                ...block,
                quests: buildQuestLogView([...quests, ...finished], currentTimeFromMemo(memo), questSettings),
            }
        }

        if (ENTITY_TAGS.has(block.tag)) {
            const entities = buildEntityBlockView(block.raw, block.tag, {
                portraits: settings.portraits,
                bars: settings.bars,
                animateCustomBars: settings.animateCustomBars,
            })
            if (!entities) return block
            return { ...block, entities }
        }

        return block
    }

    return {
        blocks: ordered.map((tag) =>
            attachSecondGrammar(buildBlock(tag, blocks[tag] ?? '', customFields, settings.bars, settings.animateCustomBars)),
        ),
        benchedParty:
            blocks[FOLDED_INTO_PARTY] === undefined
                ? null
                : attachSecondGrammar(
                      buildBlock(FOLDED_INTO_PARTY, blocks[FOLDED_INTO_PARTY], customFields, settings.bars, settings.animateCustomBars),
                  ),
        unordered,
        empty: present.length === 0,
    }
}
