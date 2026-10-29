/**
 * One run of the Lorebook Agent, end to end.
 *
 * The seam between the pure parts — the loop, the commit reader, the writer,
 * the ownership rules — and the host. It assembles what the model is told, runs
 * the loop, applies the plan the loop produced, and hands back something the
 * panel can draw.
 *
 * **Manual only, for now.** Nothing calls this after a reply. The first thing
 * that writes to a user's campaign should be a thing they press, watch, and can
 * undo — wiring it to run on its own before anyone has seen it work is how you
 * find out about a bug in fifty entries rather than one.
 */

import { buildCampaignIndex, categoriesInUse } from '../agent/inventory.js'
import { createLoreTools } from '../agent/lore.js'
import { DEFAULT_MAX_TURNS, runAgentLoop, type AgentMessage, type AgentPassResult } from '../agent/loop.js'
import { bookStanding, resolveCampaignPrefix, campaignBookName } from '../agent/campaign.js'
import { isWorldProgressionBookName } from '../tracker/world.js'
import { secondsSince, type StepFn } from './terminal.js'
import { applyRedo, captureForRedo, describeRedo, redoDidSomething, type RedoEntry } from '../agent/redo.js'
import { applyCommit, type WriteDeps, type LoreStore, type WriteReport } from '../agent/writer.js'
import { adjustPromptTimestamps, agentModuleLines, currentLocationSection, eligibleCoreFields, enabledCategoryTags, existingNpcNudge, expandTemplate, extractQuestsBlock, formatMechanicalSections, mappedSiteNote, mechanicalState, passRestriction, recordCategoryGuidance, stripStaticMapGuidance, withoutActivationSections, type AgentModuleSettings } from '../agent/modules.js'
import { npcSectionNames } from '../tracker/npc-creator.js'
import {
    applyUndo,
    captureSnapshot,
    describeUndo,
    planUndo,
    type LorePassSnapshot,
    type UndoPlan,
} from '../agent/undo.js'

/** What the panel is told about a pass. */
export interface AgentPassReport {
    at: string
    chatId: string
    /** The campaign whose books were in play. */
    prefix: string
    outcome: AgentPassResult['outcome']
    /** One line, in words. */
    summary: string
    steps: AgentPassResult['steps']
    turnsUsed: number
    /** Absent when the pass did not reach a commit. */
    write?: WriteReport
    /** Items the commit named that could not be used. */
    problems: string[]
}

export interface AgentPassDeps {
    store: LoreStore
    /** One model call, macro-resolved. */
    generate(messages: AgentMessage[], userId: string | undefined): Promise<string>
    /**
     * The chat's narrative, for the prompt.
     *
     * `lookback` is how many messages back to go; `0` means the whole chat. A
     * first pass over an established campaign wants the lot — the maintainer
     * found the agent had missed "some juicy details from the first couple of
     * days" because it only ever saw the last dozen messages.
     */
    narrative(chatId: string, userId: string | undefined, lookback: number): Promise<string>
    /** Messages of history the agent is shown. `0` for all of them. */
    lookback?: number
    /**
     * The newest message in the chat, recorded so a swipe can undo the pass.
     *
     * Optional: a build without it still writes and can still be undone by
     * hand, it simply cannot tie the pass to a reply.
     */
    latestMessageId?(chatId: string, userId: string | undefined): Promise<string | undefined>
    /** The chat's Player Card (35b), for the writer's sentinel; absent or `null` when the chat has none. */
    playerCard?: WriteDeps['playerCard'] | null
    /**
     * The relationship system (44): the section the model is told when it is
     * on, and where its `rel` items go after the write. Absent, `rel` is read
     * and reported as having nowhere to go, as every build before this one.
     */
    relationships?: {
        section(userId: string | undefined): Promise<string>
        apply(chatId: string, userId: string | undefined, items: ReadonlyArray<{ id: string; field: string; delta: number }>, messageId?: string): Promise<{ placed: Array<{ label: string; field: string; delta: number; newValue: number }>; unmatched: string[] }>
    }
    /**
     * The cartridge (45b): the module instructions the model is told, per
     * category, and the Combat Profile guidance template. Absent, the model
     * is told neither, as every build before this one.
     */
    settings?(userId: string | undefined): Promise<AgentModuleSettings>
    /**
     * The chat's memo (45b): its `[COMBAT]` and `[PARTY]` blocks are the
     * canonical source of an NPC's Combat Profile, put in front of the model
     * as the legacy does. Absent, no mechanical state is shown.
     */
    memo?(chatId: string, userId: string | undefined): Promise<string>
    /**
     * The chat's narrative *with each line numbered*, and which numbers those are.
     *
     * The numbers are what let the model say when a thing happened. Without
     * them a pass can only stamp the turn it ran on — the newest message — so a
     * betrayal at 43 found by a pass running at 45 was recorded as 45.
     *
     * Optional: a build without it still writes, with nothing citable and so
     * nothing stamped.
     */
    numberedNarrative?(
        chatId: string,
        userId: string | undefined,
        lookback: number,
    ): Promise<{ narrative: string; readRange: number[] }>
    /**
     * The automatic-pass watermark as it stands now, before this pass runs.
     *
     * Recorded in the snapshot so an undo can put it back. A pass advances the
     * watermark past the story it read; undoing the pass without undoing that
     * leaves the story covered by neither.
     */
    watermark?: number
    /** The campaign's ownership list, and a way to record additions. */
    ownership: {
        get(chatId: string, userId: string | undefined): Promise<string[]>
        set(chatId: string, books: string[], userId: string | undefined): Promise<void>
        /** Books the pass made: recorded as the campaign's and attached at once (66), whatever the names' standing. */
        made(chatId: string, names: string[], userId: string | undefined): Promise<void>
        /**
         * Books belonging to the user's *other* campaigns.
         *
         * Hidden from this pass's reads. See `hiddenBooks` in `agent/lore.ts`
         * for why another campaign's books are not the same as a world bible.
         */
        others(chatId: string, userId: string | undefined): Promise<string[]>
    }
    /** The user's campaign name and the chat it is anchored to. */
    campaign?: { override?: string; anchorChatId?: string }
    /**
     * Where a pass's before-state is kept, so it can be undone.
     *
     * Optional so the pure tests can leave it out, but on the real backend it
     * is always present: a pass that writes without recording how to unwrite
     * is the thing the maintainer asked us not to build.
     */
    history?: {
        record(chatId: string, snapshot: LorePassSnapshot, userId: string | undefined): Promise<void>
        latest(chatId: string, userId: string | undefined): Promise<LorePassSnapshot | null>
        drop(chatId: string, userId: string | undefined): Promise<void>
    }
    maxTurns?: number
    /**
     * Fires the moment a pass begins, before any host call.
     *
     * **Announced from inside the pass, not from its callers.** Phase 14 put
     * the Stop button inside the "a pass is running now" notice, and that
     * notice was raised by the automatic path only — so a pass the user
     * *pressed* never announced itself and its Stop button never appeared.
     * The tracker has never had that bug because `onPassStart` fires from
     * within the pass and every caller gets it for free. Same shape here now.
     */
    onPassStart?(event: { chatId: string; userId: string | undefined; at: string; trigger: AgentPassTrigger }): void
    /** Which of the three things started this pass. For the panel's wording. */
    trigger?: AgentPassTrigger
    /**
     * What the user typed into the send bar, for a `direct` pass (Phase 30).
     *
     * The legacy's `runRouterPass(narrative, manualPrompt, lookback, true)`:
     * the same agent, the same tools, with the instruction as its own section
     * after the narrative. Absent on the pressed and the automatic pass.
     */
    instruction?: string
    log?: { info(m: string): void; warn(m: string): void }
    /** The terminal (71b): the pass's steps, announced as they happen. */
    step?: StepFn
    /**
     * Where the party stands (72c): the last reply's Location footer as the
     * map state keeps it, and the mapped site it puts them inside, if any —
     * the legacy's `## CURRENT LOCATION` section and `## MAPPED SITE` note.
     */
    location?(chatId: string, userId: string | undefined): Promise<{ hierarchy?: string; mappedSite?: string }>
}

/**
 * What started a pass.
 *
 * `automatic` is the one after a reply, which nobody pressed — the case Phase
 * 4a's live notice exists for. `manual` is the button.
 */
export type AgentPassTrigger = 'manual' | 'automatic' | 'direct' | 'cleanup' | 'audit'

/**
 * What the model is told.
 *
 * Since 72c the cartridge's two templates are the bones of it, as they are
 * the legacy's: `routerSystemPromptTemplate` first — the player-character
 * safeguard, the formatting rules, the quest rule, how entries are updated,
 * the timestamps — and `routerAgentSharedContextTemplate` after the tools,
 * its placeholders filled the way the legacy fills them (the eligible
 * fields, the pass restriction, the nudge, the campaign's books, the
 * module instructions, the Combat Profile guidance, the relationship
 * section), both with their examples rewritten to the cartridge's clock.
 *
 * What is taken out is the activation half — three tagged sections of the
 * first and the `## MEMORY LIMIT` section of the second, which instruct the
 * agent to curate an active set this build does not keep
 * (`docs/DECISION-ACTIVATION.md`) — and what is AdventureTime's own is the frame
 * around them: the campaign and its books, the index of what the books
 * hold, the turn budget, the `Action:` grammar and the commit shapes, which
 * three live passes taught. A template that is blank, or that has lost its
 * placeholders, costs the model those sentences and nothing else: the
 * module instructions, the guidance and the section are appended as 45b
 * appended them.
 */
export function buildAgentPrompt(options: {
    prefix: string
    narrative: string
    bookNames: string[]
    /**
     * What the campaign's own books already hold, from `buildCampaignIndex`.
     *
     * Empty on a first pass, and the prompt says something different then.
     */
    index?: string
    /**
     * The categories the campaign already files under, from `categoriesInUse`.
     *
     * A category becomes a book name, so a model that says `NPC` where the
     * campaign says `Characters` gets a second book. Live, one commit made
     * `_NPC` beside `_Characters` and `_Event` beside `_Events`.
     */
    categories?: string[]
    /** Model calls this pass may spend. The model is told, so it can plan. */
    maxTurns: number
    /** The user's own instruction, when this is a pass from the send bar. */
    instruction?: string
    /** The chat's Player Card's name (35b): the model is told it may change the card's Body and Worn Equipment. */
    playerCard?: string
    /** The relationship section (44), when the system is on: starting values for an NPC just recorded, through `rel`. */
    relationshipSection?: string
    /** The cartridge's module instructions (45b), one line per enabled category, as `agentModuleLines` frames them. */
    moduleLines?: string[]
    /** The memo's `[COMBAT]` and `[PARTY]` sections (45b), preformatted, before the narrative; `''` with neither. */
    mechanical?: string
    /** The Combat Profile guidance (45b), when a mechanical block is present. */
    combatGuidance?: string
    /** The cartridge's two templates (72c), raw: the system template and the shared context. */
    templates?: { system?: string; shared?: string }
    /** The clock and the calendar the templates' examples are rewritten to. */
    timeFormat?: { use24hTime?: boolean; useDdMmYyFormat?: boolean }
    /** The `[CORE]` fields a `core` edit may touch this pass (72c), by the legacy's rule. */
    eligibleFields?: string[]
    /** The pass restriction fragment (72c), resolved for the trigger. */
    passRestriction?: string
    /** The existing-NPC nudge fragment (72c). */
    existingNpcNudge?: string
    /** The categories a `record` may name this pass (72c): the enabled modules' tags, the custom tags, and those already in use. */
    recordCategories?: string[]
    /** Where the party stands (72c): the footer's text and the mapped site they are inside, if any. */
    location?: { hierarchy?: string; mappedSite?: string }
    /** The memo's `[QUESTS]` block (72c), or `'None'`. */
    quests?: string
}): AgentMessage[] {
    const books = options.bookNames.length ? options.bookNames.join(', ') : '(none yet)'
    const index = options.index?.trim() ?? ''
    const timeFormat = options.timeFormat ?? {}
    const eligible = options.eligibleFields ?? []

    // The system template, less its activation sections, its examples on the
    // cartridge's clock, the campaign named where the legacy names it.
    const basePrompt = options.templates?.system?.trim()
        ? adjustPromptTimestamps(withoutActivationSections(options.templates.system), timeFormat).replace(/\{\{campaignRoot\}\}/g, options.prefix).trim()
        : ''

    // The shared context: the legacy's placeholders filled, then the static
    // map guidance stripped and the mapped-site note added as the legacy does
    // on every pass. What the template did not ask for is appended after.
    const rawShared = options.templates?.shared?.trim() ? withoutActivationSections(options.templates.shared) : ''
    const asks = (key: string) => rawShared.includes(`{{${key}}}`)
    const fieldInstructions = (options.moduleLines ?? []).join('\n')
    const guidance = options.combatGuidance?.trim() ?? ''
    const relSection = options.relationshipSection?.trim() ?? ''
    const shared = rawShared
        ? stripStaticMapGuidance(adjustPromptTimestamps(expandTemplate(rawShared, {
            maxActivations: '',
            pcAppearanceGuidance: '',
            eligibleCoreFields: eligible.join(', '),
            autoPassRestriction: options.passRestriction ?? '',
            existingNpcNudge: options.existingNpcNudge ?? '',
            campaignRoot: options.prefix,
            campaignNpcBook: campaignBookName(options.prefix, 'NPC'),
            campaignLocBook: campaignBookName(options.prefix, 'LOC'),
            fieldInstructions,
            combatProfileGuidance: guidance,
            relSection,
        }), timeFormat)) + mappedSiteNote(options.location?.mappedSite)
        : ''

    return [
        {
            role: 'system',
            content: [
                ...(basePrompt ? [basePrompt, ''] : []),
                'You are the Researcher, a Dungeon Master\'s assistant. You keep the campaign\'s',
                'lorebooks in step with the story. You do not write the story.',
                '',
                `This campaign is "${options.prefix}". Books you can read: ${books}`,
                '',
                // The index is the whole point of 9o. Without it the model is
                // handed three book names, and the first thing a search returns
                // becomes, as far as it can tell, the lore. Named the ARCHIVE
                // INDEX too (72c), since the legacy's sentences point at one.
                ...(index
                    ? [
                        'WHAT THE BOOKS ALREADY HOLD — the ARCHIVE INDEX (read_entry for a body):',
                        '',
                        index,
                        '',
                        'Those are the addresses. They are the only ones that exist — use them as',
                        'written and do not look them up again or shorten them to a slug. A name that',
                        'is not in the index does not exist: record it. A book that lists more than',
                        'it shows is the one case where grep_lore is the check.',
                        '',
                        ...(options.categories?.length
                        ? [
                            `File new entries under a category you already use: ${options.categories.join(', ')}.`,
                            'The category becomes the book name, so a new one makes a new book —',
                            `"NPC" would build "${options.prefix}_NPC" beside a "Characters" book you`,
                            'already have. Only invent a category for something genuinely new.',
                            '',
                        ]
                        : []),
                        'Read that list against the narrative before you do anything else. Your job',
                        'is the DIFFERENCE between the two: people, places, factions, items and',
                        'events the story has established that have no entry above, or whose entry',
                        'stops earlier than the story does. A pass that only revises entries a',
                        'search happened to return has not looked for what is missing.',
                        '',
                    ]
                    : [
                        'This campaign has no books of its own yet. That is normal on a first',
                        'pass: record what the story has established, and the books are created',
                        'for you.',
                        // Only when there is something up there to belong to
                        // anyone: "(none yet)" followed by "anything listed
                        // above" is a sentence about nothing.
                        ...(options.bookNames.length
                            ? [
                                'Every book listed above belongs to someone else — read them so you do',
                                'not contradict them, and do not write to them.',
                            ]
                            : []),
                        '',
                    ]),
                ...(options.moduleLines?.length && !asks('fieldInstructions')
                    ? [
                        // The cartridge's own words per category (45b), where
                        // the shared context has no place for them: the NPC
                        // one carries the [CORE] format and the rule that a
                        // first record is a complete profile.
                        'WHAT EACH CATEGORY RECORDS — the cartridge\'s module instructions: what belongs',
                        'in an entry of that category and how its text is shaped. Follow them.',
                        '',
                        ...options.moduleLines,
                        '',
                    ]
                    : []),
                `You have ${options.maxTurns} turns and a whole story to cover, and each tool`,
                'call costs one. Spending them all on lookups wastes the pass — but so does',
                'committing on turn two, because five updates are not a pass over a campaign.',
                'Look things up until you can name what is missing, then commit everything at',
                'once: one commit may carry many records and many updates together.',
                '',
                'Work by calling one tool at a time. End every reply with exactly one line:',
                '',
                '  Action: grep_lore("a search term")',
                '  Action: inspect_book("BookName")',
                '  Action: read_entry("BookName::the-entry-id-a-search-showed-you")',
                '  Action: commit({ ... })',
                '',
                'Entry addresses come back from the tools. Copy them exactly; do not invent one.',
                'A search shows the first few matches only, and says so — it is not an inventory.',
                '',
                'Read the index before you record, so you update an entry rather than',
                'duplicating it. But an absent entry is the common case on an established',
                'campaign: when the story establishes something the index above does not',
                'list, RECORD it. When you have nothing to change, commit an empty object.',
                '',
                'Every commit field is a LIST. Copy these shapes exactly — three live',
                'passes invented their own and lost the whole commit:',
                '',
                '  commit({',
                '    "record": [{"label": "Lissa", "category": "NPC", "keys": ["Lissa"],',
                '                "content": "A rope-keeper from the docks.", "msg": 43}],',
                '    "update": [{"id": "BookName::entry-id", "content": "text to add", "msg": 44}],',
                '    "rewrite": [{"id": "BookName::entry-id", "content": "replacement text"}],',
                '    "rename": [{"id": "BookName::entry-id", "label": "New title",',
                '                "keys": ["new", "keys"]}],',
                // The legacy's appearance and equipment items (72c): Body and
                // Worn Equipment under their own names, the id an entry, a
                // name, or {{user}} for the Player Card.
                '    "appearance": [{"id": "BookName::entry-id, an NPC\'s name, or {{user}}", "content": "new body text"}],',
                '    "equipment": [{"id": "BookName::entry-id, an NPC\'s name, or {{user}}", "content": "new worn gear"}],',
                `    "core": [{"id": "BookName::entry-id", "field": "${eligible.length ? eligible.join('|') : 'Species'}", "content": "fae"}],`,
                // The legacy's `commit rel items` line, only while the
                // relationship system is on (its section below says when to
                // use it). A live pass without this shape named the NPCs the
                // way its records did and lost both values (65-bis).
                ...(relSection
                    ? ['    "rel": [{"id": "BookName::entry-id, or the NPC\'s name when this commit records them",',
                       '            "field": "friendship", "delta": 30}],']
                    : []),
                '    "consolidate": [{"survivor": "BookName::keep-this-id",',
                '                     "targets": ["BookName::delete-this-id"],',
                '                     "content": "the merged text"}],',
                '    "delete_ids": ["BookName::entry-id"],',
                '    "reason": "why"',
                '  })',
                '',
                'Every id is the FULL address the tools showed you, book name and all —',
                'never the bare entry id on its own. `content` is the key for text.',
                ...(eligible.length
                    ? [`A "core" edit may touch these [CORE] fields this pass and no other: ${eligible.join(', ')}.`,
                       'Body and Worn Equipment go through "appearance" and "equipment".']
                    : []),
                '',
                // Without this the only number available is the newest message,
                // so a betrayal at 43 found by a pass running at 45 was filed
                // as 45. The model is the only thing that read the story and
                // knows which is which.
                '`msg` on a record or an update is WHICH MESSAGE the thing happened in —',
                'the number in [#43] at the start of a narrative line. Use the message where',
                'the event actually occurred, NOT the latest one you were shown: if a',
                'betrayal happened in [#43] and you are writing it down while reading up to',
                '[#45], the answer is 43. Only use numbers you were actually shown. Leave',
                '`msg` out if you genuinely cannot tell — an omitted number is fine, a',
                'wrong one is not.',
                '',
                'Do not create an entry for the player character.',
                ...(options.playerCard
                    ? [
                        `The player character is ${options.playerCard}, and their Player Card is kept for you.`,
                        'When their signature look or their worn gear permanently changes in the story,',
                        'change the card with a "core" edit whose id is "{{user}}" and whose field is',
                        '"Body" or "Worn Equipment" — nothing else on the card is yours to change.',
                    ]
                    : []),
                'Which entries are active is handled for you. Do not try to manage it.',
                ...(shared ? ['', shared] : []),
                ...(guidance && !asks('combatProfileGuidance')
                    ? [
                        '',
                        // The cartridge's Combat Profile guidance (45b), only
                        // when the memo has a [COMBAT] or [PARTY] block, where
                        // the shared context has no place for it.
                        guidance,
                    ]
                    : []),
                ...(relSection && !asks('relSection')
                    ? [
                        '',
                        // The legacy's agent section, expanded for the scale: the
                        // commit shape it names is `"rel": [{"id", "field", "delta"}]`.
                        relSection,
                    ]
                    : []),
                ...(options.recordCategories ? ['', recordCategoryGuidance(options.prefix, options.recordCategories)] : []),
            ].join('\n'),
        },
        {
            role: 'user',
            // The legacy's order (72c): where the party stands, the open
            // quests, then the mechanical blocks before the narrative (45b).
            content: (options.location ? `${currentLocationSection(options.location.hierarchy)}${mappedSiteNote(options.location.mappedSite)}\n\n` : '')
                + (options.quests !== undefined ? `## ACTIVE QUESTS\n${options.quests || 'None'}\n\n` : '')
                + `${options.mechanical ?? ''}## NARRATIVE\n\n${options.narrative}\n\n`
                + (options.instruction?.trim()
                    // The legacy's `## INSTRUCTION` section, and what it means
                    // here: the narrative is context for the instruction, not
                    // a second job. Without the second sentence a model given
                    // "add an entry for the innkeeper" also brought the whole
                    // story up to date, which is the pressed button's job.
                    ? `## INSTRUCTION\n\n${options.instruction.trim()}\n\n`
                        + 'Do what that instruction asks. The narrative above is context for it, not a'
                        + ' second task: record or revise only what the instruction needs. Where a line'
                        + ' of the narrative is the source, cite its [#number] as `msg`.'
                    : 'Bring the lorebooks up to date with the WHOLE of that narrative, not only its'
                        + ' most recent part. Record what is missing as well as revising what is there.'
                        + ' Each line begins with the message it came from, like [#43] — cite that'
                        + ' number as `msg` on whatever you record or update from it.'),
        },
    ]
}

/** Run a pass for one chat. */
export async function runAgentPass(
    chatId: string,
    userId: string | undefined,
    deps: AgentPassDeps,
): Promise<AgentPassReport> {
    const at = new Date().toISOString()
    const startedAt = Date.now()
    // First, before any host call: a pass that spends ten seconds reading books
    // before it announces itself is a pass the user cannot stop for ten seconds.
    deps.onPassStart?.({ chatId, userId, at, trigger: deps.trigger ?? 'manual' })
    deps.step?.('start', deps.instruction?.trim() ? 'Initializing Lorebook Agent for your instruction…' : 'Initializing Lorebook Agent…')

    const prefix = resolveCampaignPrefix({
        chatId,
        override: deps.campaign?.override,
        anchorChatId: deps.campaign?.anchorChatId,
    })

    const ownedBooks = await deps.ownership.get(chatId, userId)
    // Other campaigns' books, and this campaign's own `_World` and `_Skeleton`
    // books: World Progression's reports are read by the narrator and its
    // seeds by nobody but that pass, never by the agent -- the legacy skips
    // both in every agent read, and neither WORLD nor SKELETON is one of its
    // record categories. Hidden here rather than refused at the write.
    const hiddenBooks = [...(await deps.ownership.others(chatId, userId)), ...(await deps.store.listBooks()).map((b) => b.name).filter(isWorldProgressionBookName)]
    // Numbered when the build can: the numbers are what the model cites to say
    // when something happened. Falls back to the plain narrative, which reads
    // the same and simply cannot be cited.
    const numbered = await deps.numberedNarrative?.(chatId, userId, deps.lookback ?? 0).catch(() => undefined)
    const narrative = numbered?.narrative ?? (await deps.narrative(chatId, userId, deps.lookback ?? 0))
    const readRange = numbered?.readRange ?? []
    const allBooks = (await deps.store.listBooks()).filter((book) => !isWorldProgressionBookName(book.name))
    const bookNames = allBooks.map((book) => book.name)
    const index = await readCampaignIndex(allBooks, prefix, ownedBooks, deps)
    const categories = categoriesInUse(
        bookNames.filter((name) => bookStanding(name, prefix, ownedBooks) === 'owned'),
        prefix,
    )
    // The cartridge's module instructions and the memo's mechanical blocks
    // (45b), both read defended: a read that throws costs the model those
    // words, never the pass.
    let cartridgeRead = false
    const cartridge = deps.settings
        ? await deps.settings(userId).then((read) => { cartridgeRead = true; return read }).catch((error: unknown) => {
            deps.log?.warn(`agent: the cartridge could not be read for the module instructions: ${String(error)}`)
            return {} as AgentModuleSettings
        })
        : {}
    const moduleLines = agentModuleLines(cartridge)
    const memo = deps.memo
        ? await deps.memo(chatId, userId).catch((error: unknown) => {
            deps.log?.warn(`agent: the memo could not be read for the mechanical state: ${String(error)}`)
            return ''
        })
        : ''
    const mechanical = mechanicalState(memo, cartridge)
    // The NPC section names bound a core edit's value (45b-bis), and name
    // the fields a core edit may touch (72c): the legacy's `isManual` is true
    // for every pass but the one after a reply.
    const coreHeaders = npcSectionNames((cartridge as { npcCoreSections?: unknown }).npcCoreSections)
    const isManual = (deps.trigger ?? 'manual') !== 'automatic'
    const eligibleFields = eligibleCoreFields(coreHeaders, isManual)
    // The categories a record may name (72c): the cartridge's enabled tags
    // and the custom tags, as the legacy lists them, with the ones this
    // campaign already files under — a book that exists is a route too.
    const recordCategories = [...enabledCategoryTags(cartridge)]
    for (const used of categories) if (!recordCategories.some((tag) => tag.toUpperCase() === used.toUpperCase())) recordCategories.push(used)
    // Where the party stands (72c); read defended, as the rest.
    const location = deps.location
        ? await deps.location(chatId, userId).catch((error: unknown) => {
            deps.log?.warn(`agent: the party's location could not be read: ${String(error)}`)
            return {}
        })
        : undefined
    // Read defended: a preferences read that throws costs the section, not the pass.
    const relationshipSection = deps.relationships
        ? await deps.relationships.section(userId).catch((error: unknown) => {
            deps.log?.warn(`agent: the relationship section could not be read: ${String(error)}`)
            return ''
        })
        : ''

    const result = await runAgentLoop(
        buildAgentPrompt({
            prefix,
            narrative,
            bookNames,
            index,
            categories,
            maxTurns: deps.maxTurns ?? DEFAULT_MAX_TURNS,
            ...(deps.instruction?.trim() ? { instruction: deps.instruction } : {}),
            ...(deps.playerCard?.name ? { playerCard: deps.playerCard.name } : {}),
            ...(relationshipSection ? { relationshipSection } : {}),
            ...(moduleLines.length ? { moduleLines } : {}),
            ...(mechanical.combat || mechanical.party ? { mechanical: formatMechanicalSections(mechanical), combatGuidance: mechanical.guidance } : {}),
            // The cartridge's templates and fragments (72c).
            templates: { system: cartridge.routerSystemPromptTemplate ?? '', shared: cartridge.routerAgentSharedContextTemplate ?? '' },
            timeFormat: { use24hTime: cartridge.use24hTime === true, useDdMmYyFormat: cartridge.useDdMmYyFormat === true },
            eligibleFields,
            passRestriction: passRestriction(cartridge, isManual, eligibleFields),
            existingNpcNudge: existingNpcNudge(cartridge),
            // Only from a cartridge that was read: an unread one would say
            // no category is enabled, which is not what it says.
            ...(cartridgeRead ? { recordCategories } : {}),
            ...(location ? { location } : {}),
            quests: extractQuestsBlock(memo),
        }),
        {
            generate: (messages) => deps.generate(messages, userId),
            tools: createLoreTools({ store: deps.store, prefix, ownedBooks, hiddenBooks }),
            maxTurns: deps.maxTurns,
            ...(deps.playerCard?.name ? { playerCard: deps.playerCard.name } : {}),
            log: deps.log,
            ...(deps.step ? { step: (type, content) => deps.step?.(type, content) } : {}),
        },
    )
    // The feed's last line (71b): a pass that committed says so after the write, below, with what was written.
    if (deps.step && result.outcome !== 'committed') {
        const seconds = secondsSince(startedAt)
        if (result.outcome === 'cancelled') deps.step('error', 'Stopped by user.', { seconds })
        else deps.step('error', result.summary, { seconds })
    }

    const report: AgentPassReport = {
        at,
        chatId,
        prefix,
        outcome: result.outcome,
        summary: result.summary,
        steps: result.steps,
        turnsUsed: result.turnsUsed,
        problems: result.problems,
    }

    if (result.outcome !== 'committed' || !result.commit) {
        if (result.outcome === 'committed') deps.step?.('error', result.summary, { seconds: secondsSince(startedAt) })
        return report
    }

    // Captured *after* the model has decided and *before* anything is written,
    // so a pass that never reaches a commit leaves no snapshot to undo.
    const snapshot = await captureSnapshot(deps.store, {
        chatId,
        prefix,
        ownedBooks,
        isOwn: (name) => bookStanding(name, prefix, ownedBooks) === 'owned',
    })
    // Never fatal. A pass that cannot name the reply it read is still a pass
    // that can be undone by hand; refusing to write over it would be worse.
    const messageId = await deps.latestMessageId?.(chatId, userId).catch(() => undefined)


    const write = await applyCommit(result.commit, {
        store: deps.store,
        prefix,
        ownedBooks,
        timePrefix: '',
        readRange,
        log: deps.log,
        ...(deps.playerCard ? { playerCard: deps.playerCard } : {}),
        coreHeaders,
        manual: isManual,
    })
    report.write = write

    // A book the pass created is the campaign's from now on. Recorded before
    // anything else can run, because an undo reads this list as the baseline
    // (9b) and a missing name there means a book we made looks pre-existing.
    if (write.createdBooks.length) {
        await deps.ownership.made(chatId, write.createdBooks, userId)
    }

    // Recorded even when nothing changed: an empty snapshot undoes cleanly, and
    // a pass that wrote something while the record failed would be a pass with
    // no way back. Never fatal — a failed snapshot must not turn a successful
    // pass into a reported failure, but it must be said out loud.
    if (deps.history) {
        try {
            await deps.history.record(
                chatId,
                {
                    ...snapshot,
                    messageId,
                    watermark: deps.watermark,
                    createdBooks: [...write.createdBooks],
                    createdEntries: [...write.createdEntries],
                },
                userId,
            )
        } catch (error) {
            report.problems = [...report.problems, `this pass could not be made undoable: ${String(error)}`]
        }
    }

    report.summary = describe(result.summary, write)

    // The `rel` items, after the write so an NPC recorded in the same commit
    // has its entry to be named by (44). Never fatal: the books are written,
    // and a value that could not be placed is said in the report.
    if (result.commit.rel.length) {
        if (!deps.relationships) {
            report.summary += ` ${result.commit.rel.length} relationship change${result.commit.rel.length === 1 ? '' : 's'} ignored — this build has no relationship store.`
        } else {
            try {
                const placed = await deps.relationships.apply(chatId, userId, result.commit.rel, messageId)
                if (placed.placed.length) report.summary += ` ${placed.placed.length} relationship value${placed.placed.length === 1 ? '' : 's'} set: ${placed.placed.map((p) => `${p.label} ${p.field} ${p.newValue >= 0 ? '+' : ''}${p.newValue}`).join(', ')}.`
                if (placed.unmatched.length) report.problems = [...report.problems, ...placed.unmatched.map((name) => `rel: no entry of this campaign is named "${name}", so its relationship value was not set`)]
                if (!placed.placed.length && !placed.unmatched.length) report.summary += ` ${result.commit.rel.length} relationship change${result.commit.rel.length === 1 ? '' : 's'} ignored — the relationship system is off.`
            } catch (error) {
                report.problems = [...report.problems, `the relationship values could not be set: ${String(error)}`]
            }
        }
    }
    deps.step?.('finish', `${report.summary} (${result.turnsUsed} turn${result.turnsUsed === 1 ? '' : 's'})`, { seconds: secondsSince(startedAt) })
    return report
}

/**
 * The campaign's own books, listed by title, for the prompt.
 *
 * Only books this campaign owns. An `adoptable` book — one that merely matches
 * the naming pattern and was never recorded as created — is not ours to write
 * to (9b), and listing it under "what the books already hold" would promise an
 * update the writer then refuses.
 *
 * A book that will not read is skipped rather than fatal. An index is context;
 * losing one book's titles costs the model some awareness, and failing the pass
 * over it costs the user everything.
 */
async function readCampaignIndex(
    books: readonly { id: string; name: string }[],
    prefix: string,
    ownedBooks: readonly string[],
    deps: AgentPassDeps,
): Promise<string> {
    const own = books.filter((book) => bookStanding(book.name, prefix, ownedBooks) === 'owned')

    // In parallel: independent host round trips, and the model waits for all of
    // them before its first turn. Sequentially this was the whole index latency
    // added to the front of every pass. `Promise.all` preserves book order, and
    // the catch is per book so one unreadable book costs its own entry rather
    // than the entire index.
    const read = await Promise.all(
        own.map(async (book) => {
            try {
                return { name: book.name, entries: await deps.store.listEntries(book.id) }
            } catch (error) {
                deps.log?.warn(`agent: could not index "${book.name}": ${String(error)}`)
                return null
            }
        }),
    )
    return buildCampaignIndex(read.filter((book) => book !== null))
}

/**
 * The `connection_id` field for a generation call, or nothing at all.
 *
 * Omitted rather than sent empty when the user has not chosen: an empty string
 * is an id nothing will match, and the host must be left to pick exactly as it
 * did before this setting existed. Shared by the tracker and the agent so the
 * rule lives in one tested place rather than twice at two call sites.
 */
export function connectionField(id: string | undefined): { connection_id?: string } {
    return id ? { connection_id: id } : {}
}

/**
 * The dials a pass takes from a user's preferences.
 *
 * Pulled out of `backend.ts` deliberately: that file is the host entry point
 * and has no tests, and "a setting that saves, displays and clamps correctly
 * and then never reaches the thing it configures" is a bug this project has
 * shipped before. A mutation deleting the turn budget from the wiring left the
 * entire suite green, which is the same hole Phase 10b found — nothing checked
 * that the value was actually *carried*.
 *
 * Pure, so it can be tested; the rest of `agentDeps` is host wiring that cannot.
 */
export function agentPassOptions(
    prefs: {
        agentLookback?: number
        agentMaxTurns?: number
        agentConnectionId?: string
        agentWatermarks?: Record<string, number>
    },
    chatId: string,
): { lookback: number; maxTurns: number; watermark: number; connectionId: string | undefined } {
    return {
        // 0 means the whole chat, which is what a first pass over an
        // established campaign wants.
        lookback: prefs.agentLookback ?? 0,
        maxTurns: prefs.agentMaxTurns ?? DEFAULT_MAX_TURNS,
        // Where the watermark stands *before* this pass moves it, so an undo
        // can put it back and the next pass re-reads what this one covered.
        watermark: prefs.agentWatermarks?.[chatId] ?? 0,
        // The model this pass's turns run on. Mapped here rather than read at
        // the call site because `backend.ts` has no tests, and a setting that
        // never arrives is invisible from everywhere else (lesson 19).
        connectionId: prefs.agentConnectionId || undefined,
    }
}

/** Fold what was actually written into the line the panel shows. */
function describe(summary: string, write: WriteReport): string {
    const parts: string[] = []
    if (write.changed.length) parts.push(`${write.changed.length} entr${write.changed.length === 1 ? 'y' : 'ies'} written`)
    if (write.deleted.length) parts.push(`${write.deleted.length} deleted`)
    if (write.createdBooks.length) parts.push(`${write.createdBooks.length} book${write.createdBooks.length === 1 ? '' : 's'} created`)

    let out = parts.length ? `${summary} ${parts.join(', ')}.` : `${summary} Nothing was written.`
    if (write.refused.length) {
        // Refusals are the interesting half: they are where the ownership rules
        // stopped something, and a silent refusal looks like a bug in the agent.
        out += ` ${write.refused.length} refused.`
    }
    return out
}


/** What the panel is told about an undo. */
export interface AgentUndoReport {
    at: string
    chatId: string
    /** One line, in words. */
    summary: string
    /** Whether there was anything to undo at all. */
    undone: boolean
    /**
     * The automatic-pass watermark to restore, if the snapshot recorded one.
     *
     * Undoing a pass undoes the watermark it advanced, so the next pass reads
     * the whole span the rolled-back one had covered rather than starting
     * partway through it.
     */
    watermark?: number
    problems: string[]
    /**
     * What a redo needs (71c): the snapshot restored and the books as the
     * undo found them. Absent when there was nothing to undo.
     */
    redo?: RedoEntry
}

/**
 * Put the lorebooks back as the last pass found them.
 *
 * One pass at a time, newest first, and the snapshot is dropped only once the
 * undo has been carried out — so an undo that fails half-way can be retried
 * rather than leaving the campaign between two states with no way back.
 */
export async function undoAgentPass(
    chatId: string,
    userId: string | undefined,
    deps: AgentPassDeps,
): Promise<AgentUndoReport> {
    const at = new Date().toISOString()
    const base: AgentUndoReport = { at, chatId, summary: '', undone: false, problems: [] }

    if (!deps.history) {
        return { ...base, summary: 'This build does not keep a history, so there is nothing to undo.' }
    }

    const snapshot = await deps.history.latest(chatId, userId)
    if (!snapshot) {
        return { ...base, summary: 'No agent pass has been recorded for this chat, so there is nothing to undo.' }
    }

    // The books as they stand, captured before anything is restored, so the
    // undo can be redone (71c). Never fatal: a capture that fails costs the
    // redo, not the undo, and says so.
    const problems: string[] = []
    const ownedNow = await deps.ownership.get(chatId, userId)
    const post = await captureForRedo(deps.store, chatId, snapshot.prefix, ownedNow).catch((error: unknown) => {
        problems.push(`this undo cannot be redone: the books could not be captured first (${String(error)})`)
        return null
    })

    const live = []
    for (const book of await deps.store.listBooks()) {
        live.push({ id: book.id, name: book.name, entries: await deps.store.listEntries(book.id) })
    }

    const done = await applyUndo(planUndo(snapshot, live), deps.store)
    await deps.ownership.set(chatId, done.ownedBooks, userId)
    await deps.history.drop(chatId, userId)

    return {
        at,
        chatId,
        summary: describeUndo(done),
        undone: didSomething(done),
        watermark: snapshot.watermark,
        problems: [...problems, ...done.problems],
        ...(post ? { redo: { pre: snapshot, post } } : {}),
    }
}

/**
 * Write an undone pass's result back (71c), and re-file its snapshot so it
 * can be undone again.
 */
export async function redoAgentPass(
    chatId: string,
    userId: string | undefined,
    deps: AgentPassDeps,
    entry: RedoEntry,
): Promise<AgentRedoReport> {
    const at = new Date().toISOString()
    const done = await applyRedo(entry, deps.store)
    await deps.ownership.set(chatId, [...entry.post.ownedBooks], userId)
    if (deps.history) {
        try {
            await deps.history.record(chatId, entry.pre, userId)
        } catch (error) {
            done.problems.push(`the redone pass could not be made undoable again: ${String(error)}`)
        }
    }
    return { at, chatId, summary: describeRedo(done), redone: redoDidSomething(done), watermark: entry.watermark, problems: done.problems }
}

export interface AgentRedoReport {
    at: string
    chatId: string
    summary: string
    redone: boolean
    /** The watermark as it stood before the undo, to put back. */
    watermark?: number
    problems: string[]
}

const didSomething = (plan: UndoPlan): boolean =>
    plan.restore.length + plan.recreate.length + plan.remove.length + plan.deleteBooks.length > 0


/**
 * Undo the last pass if it was built on a reply that has just been replaced.
 *
 * A swipe or a regenerate throws away the message the pass read, so the lore it
 * wrote describes a turn that did not happen. This is the tracker's rule
 * (`RETRACK_GENERATION_TYPES`) applied to the lorebooks, and it is why 9q's
 * snapshot carries a message id.
 *
 * Deliberately narrow. It fires only when the *newest* snapshot names exactly
 * the message being replaced: an older pass, a pass for another chat, or a pass
 * that could not name its reply is left alone. A swipe must never quietly
 * revert lore that some other turn produced.
 */
export async function undoAgentPassForMessage(
    chatId: string,
    messageId: string | undefined,
    userId: string | undefined,
    deps: AgentPassDeps,
): Promise<AgentUndoReport | null> {
    if (!messageId || !deps.history) return null

    const snapshot = await deps.history.latest(chatId, userId)
    if (!snapshot || snapshot.chatId !== chatId || snapshot.messageId !== messageId) return null

    return undoAgentPass(chatId, userId, deps)
}
