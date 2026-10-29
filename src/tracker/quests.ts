/**
 * The quest grammar — a second layer on top of the memo's block grammar.
 *
 * `[QUESTS]` is not marker text. Its contents are a list of records, each
 * opening with a `QUEST:` line and carrying labelled fields under it:
 *
 *     QUEST: The Missing Sheep
 *       ID: quest_1746703200000
 *       STATUS: active
 *       GIVER: Farmer Hemwick @ Crestwood Mill
 *       ACCEPTED: 08:00 AM, Day 1
 *       DEADLINE: 06:00 PM, Day 4
 *       REWARD: 100 GP
 *       FRUSTRATION_COEFF: 1.2
 *       OBJ_ACTIVE: Collect 6 Phosphor-Cap mushrooms [4/6]
 *       OBJ_TOTAL: 6
 *       OBJ_COMPLETED: Ask about the wolf
 *
 * Until now the tracker merged that as opaque text, which works — the block
 * survives a turn and renders — but leaves three things the format exists for
 * undone: archived quests are never dropped, deadlines are never compared, and
 * the giver's mood is never computed. The extractor prompt already promises the
 * model all three ("the engine archives completed and failed quests
 * automatically", "do not output the MOOD field — the engine calculates and
 * injects it"), so the model has been holding up its half of a bargain nothing
 * was keeping.
 *
 * Everything here is a pure function over strings and plain objects, ported
 * from `memo-processor.js` at the pinned commit and checked against it by
 * `quests.pin.test.ts`. Where the legacy read `getSettings()` mid-function,
 * this takes an argument instead — the behaviour is identical, the reach is
 * not.
 */

import { parseInWorldTime } from './time.js'

/** One objective inside a quest. */
export interface QuestObjective {
    /** Positional, assigned on parse: `obj_0`, `obj_1`, … */
    id: string
    text: string
    /** False only when the line ended in `(optional)`. */
    required: boolean
    status: 'active' | 'completed' | 'failed'
    /** From an inline `[4/6]` counter, or a following `OBJ_TOTAL:` line. */
    total?: number
    progress?: number
}

/** One quest, as the memo carries it. */
export interface Quest {
    id: string
    title: string
    /** Free text. `active` unless the model said otherwise. */
    status: string
    giver_name: string
    giver_location: string
    accepted_time: string | null
    deadline_time: string | null
    /** Set only for self-imposed quests, never `false`. */
    emergent?: true
    type?: 'emergent'
    /** How impatient the giver is. Absent on emergent quests, by definition. */
    frustration_coefficient?: number
    objectives: QuestObjective[]
    rewards: string[]
}

/**
 * Givers that mean "nobody is waiting on this".
 *
 * A quest the player set themselves has no NPC to disappoint, so it carries no
 * frustration coefficient and grows no mood however long it sits.
 */
const EMERGENT_GIVER_RE = /^(self|player|\{\{user\}\}|emergent|none|n\/a|na|-|—)$/i

/** Deadline spellings that mean "there is no deadline". */
const NO_DEADLINE_SENTINELS = new Set([
    'none', 'n/a', 'na', 'no deadline', 'no time limit', '-', '—', 'null', 'unlimited', 'tbd', 'unknown',
])

/** Whether nobody is waiting on this quest. */
export function isEmergentQuest(quest: Partial<Quest> | null | undefined): boolean {
    if (!quest) return false
    if (quest.emergent === true) return true
    if (String(quest.type ?? '').trim().toLowerCase() === 'emergent') return true
    return EMERGENT_GIVER_RE.test(String(quest.giver_name ?? '').trim())
}

/**
 * The id a quest with no `ID:` line is given, so it can be told from a real one.
 *
 * `parseQuestsFromText` invents `quest_<clock>_<index>` for an untitled id,
 * which means the *same* quest parsed twice has two ids. Anything matching
 * quests across parses — the archive, and the view's dedupe against it — has to
 * fall back to the title instead.
 */
const GENERATED_QUEST_ID_RE = /^quest_\d+_\d+$/

/**
 * A key that identifies a quest across parses.
 *
 * Its `ID:` when the model wrote one, and its title otherwise. Prefixed so a
 * quest whose id is literally another quest's title cannot collide with it.
 */
export function questIdentity(quest: Partial<Quest> | null | undefined): string {
    const id = String(quest?.id ?? '').trim()
    if (id && !GENERATED_QUEST_ID_RE.test(id)) return `id:${id}`
    return `title:${String(quest?.title ?? '').trim().toLowerCase()}`
}

/**
 * Whether a status means the quest is over.
 *
 * These are the ones stripped out of the memo: a finished quest costs context
 * on every single turn thereafter and tells the model nothing it can act on.
 */
export function isArchivedQuestStatus(status: string | null | undefined): boolean {
    const s = String(status ?? '').toLowerCase().trim()
    return s === 'completed' || s === 'failed' || s === 'past deadline'
}

/**
 * Whether a quest has a deadline real enough to do arithmetic with.
 *
 * Three ways to fail: no deadline field, one of the "no deadline" spellings, or
 * a label that will not parse. A fourth, subtler one: a deadline at or before
 * the accepted time, which cannot be a real window and would otherwise make
 * every such quest permanently, maximally overdue.
 */
export function questHasEffectiveDeadline(quest: Partial<Quest> | null | undefined): boolean {
    const raw = quest?.deadline_time
    if (raw == null) return false
    const text = String(raw).trim()
    if (!text) return false
    if (NO_DEADLINE_SENTINELS.has(text.toLowerCase())) return false

    const deadline = parseInWorldTime(text)
    if (deadline == null) return false

    const accepted = parseInWorldTime(quest?.accepted_time)
    if (accepted != null && deadline <= accepted) return false

    return true
}

/**
 * How the giver feels, from -1 (delighted) through 0 (neutral) and upward.
 *
 * Below 1.0 of the window elapsed the curve runs from -1 to 0, shaped by the
 * coefficient so a patient giver stays pleased longer. Past the deadline it
 * climbs without bound, scaled by the same coefficient.
 *
 * `null` means the question does not apply — an emergent quest, a finished one,
 * or one without a usable deadline — and is not the same as 0, which is a real
 * mood.
 */
export function computeFrustration(quest: Quest, currentTime: string): number | null {
    if (isEmergentQuest(quest)) return null
    if (quest.status !== 'active' && quest.status !== 'past deadline') return null
    if (!questHasEffectiveDeadline(quest)) return null

    const accepted = parseInWorldTime(quest.accepted_time)
    const current = parseInWorldTime(currentTime)
    // Falsy rather than null-checked, matching the legacy: a quest accepted at
    // the very epoch reads as unknown. Rare enough to be harmless, and changing
    // it would move a number in existing saves.
    if (!accepted || !current) return null

    const elapsed = current - accepted
    if (elapsed <= 0) return -1 // Just accepted — the giver is optimistic.

    const coeff = Math.max(0.1, quest.frustration_coefficient ?? 1.0)
    const deadline = parseInWorldTime(quest.deadline_time)
    const window = (deadline ?? 0) - accepted
    if (window <= 0) return null

    const ratio = elapsed / window
    return ratio <= 1.0 ? Math.pow(ratio, 1 / coeff) - 1 : (ratio - 1) * coeff
}

export interface QuestMood {
    label: string
    color: string
    value: number | null
}

/**
 * The giver's mood as a word and a colour.
 *
 * Two vocabularies. With frustration display on, the labels are about the NPC
 * ("Mildly Frustrated"); with it off they are about the clock ("Near
 * Deadline"). The second is for players who want deadline pressure without
 * being told how someone feels about them.
 */
export function getQuestMood(quest: Quest, currentTime: string, showFrustration: boolean): QuestMood {
    const frust = computeFrustration(quest, currentTime)
    if (frust == null) return { label: '', color: '#aaaaaa', value: null }

    if (showFrustration) {
        if (frust <= -0.5) return { label: 'Very Pleased', color: '#00cc77', value: frust }
        if (frust <= -0.1) return { label: 'Pleased', color: '#44dd88', value: frust }
        if (frust <= 0.1) return { label: 'Neutral', color: '#aaaaaa', value: frust }
        if (frust <= 0.5) return { label: 'Mildly Frustrated', color: '#ffcc00', value: frust }
        if (frust <= 1.0) return { label: 'Frustrated', color: '#ff8800', value: frust }
        if (frust <= 1.5) return { label: 'Very Frustrated', color: '#ff4400', value: frust }
        return { label: 'Furious', color: '#ff1111', value: frust }
    }

    if (frust <= 0) return { label: 'Ahead of Schedule', color: '#00cc77', value: frust }
    if (frust <= 0.5) return { label: 'On Time', color: '#ffcc00', value: frust }
    if (frust <= 1.0) return { label: 'Near Deadline', color: '#ff8800', value: frust }
    return { label: 'Overdue', color: '#ff1111', value: frust }
}

export interface ParseQuestOptions {
    /** Clock for the fallback id of a quest with no `ID:` line. Injected so a test can pin it. */
    now?: () => number
}

/**
 * Parse the contents of a `[QUESTS]` block into quest records.
 *
 * Forgiving by design, because a model wrote this. Every field is optional,
 * an unrecognised line is ignored, and a block with no title is dropped rather
 * than becoming a nameless quest.
 */
export function parseQuestsFromText(text: string | null | undefined, options: ParseQuestOptions = {}): Quest[] {
    if (!text || !String(text).trim()) return []
    const now = options.now ?? Date.now

    const quests: Quest[] = []

    for (const block of String(text).trim().split(/^QUEST:/m)) {
        if (!block.trim()) continue

        const title = block.split('\n')[0]!.trim()
        if (!title) continue

        /** First value for a label, anywhere in the block. */
        const getField = (key: string): string | null => {
            const match = block.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'mi'))
            return match ? match[1]!.trim() : null
        }

        const rawGiver = getField('GIVER') ?? ''
        const giverParts = rawGiver.split(' @ ')
        const giverName = giverParts[0]?.trim() || 'Unknown'
        const giverLocation = giverParts[1]?.trim() || 'Unknown'

        const rawCoeff = getField('FRUSTRATION_COEFF')
        const coeff = rawCoeff ? parseFloat(rawCoeff) : null

        const typeField = (getField('TYPE') ?? '').trim().toLowerCase()
        const emergentField = (getField('EMERGENT') ?? '').trim().toLowerCase()
        const emergent =
            typeField === 'emergent' ||
            /^(true|yes|1)$/i.test(emergentField) ||
            EMERGENT_GIVER_RE.test(giverName)

        // OBJ_TOTAL lines are read first and matched to objectives positionally.
        // They are a fallback for a count the model wrote as a separate line
        // rather than as an inline [4/6].
        const objTotals: number[] = []
        const objTotalRe = /^\s*OBJ_TOTAL:\s*(\d+)$/gim
        let totalMatch: RegExpExecArray | null
        while ((totalMatch = objTotalRe.exec(block)) !== null) {
            objTotals.push(parseInt(totalMatch[1]!, 10))
        }

        const objectives: QuestObjective[] = []
        const objRe = /^\s*(OBJ_ACTIVE|OBJ_DONE|OBJ_COMPLETED|OBJ_FAILED):\s*(.+)$/gim
        let objMatch: RegExpExecArray | null
        let objIdx = 0
        while ((objMatch = objRe.exec(block)) !== null) {
            const tag = objMatch[1]!.toUpperCase()
            const isDone = tag === 'OBJ_DONE' || tag === 'OBJ_COMPLETED'
            const isFailed = tag === 'OBJ_FAILED'
            const rawContent = objMatch[2]!.trim()

            // The model sometimes puts several objectives on one line. The tell
            // is a `(required)`/`(optional)` marker mid-string, since a lone
            // objective's marker can only be at the end.
            const parts = /\)\s*,/.test(rawContent) ? rawContent.split(/,\s*(?=\S)/) : [rawContent]

            for (const part of parts) {
                const trimmed = part.trim()
                if (!trimmed) continue

                const isOptional = /\(optional\)$/i.test(trimmed)
                let objText = trimmed.replace(/\s*\((required|optional)\)\s*$/i, '').trim()

                let progress: number | undefined
                let total: number | undefined = objTotals[objIdx] ?? undefined
                const progressMatch = objText.match(/\[(\d+)\/(\d+)\]\s*$/)
                if (progressMatch) {
                    progress = parseInt(progressMatch[1]!, 10)
                    total = parseInt(progressMatch[2]!, 10)
                    objText = objText.replace(/\s*\[\d+\/\d+\]\s*$/, '').trim()
                }
                if (!objText) continue

                const entry: QuestObjective = {
                    id: `obj_${objIdx++}`,
                    text: objText,
                    required: !isOptional,
                    status: isDone ? 'completed' : isFailed ? 'failed' : 'active',
                }
                if (total != null) entry.total = total
                if (progress != null) entry.progress = progress
                objectives.push(entry)
            }
        }

        const rewards: string[] = []
        const rewardRe = /^\s*REWARD:\s*(.+)$/gim
        let rewardMatch: RegExpExecArray | null
        while ((rewardMatch = rewardRe.exec(block)) !== null) {
            rewards.push(rewardMatch[1]!.trim())
        }

        quests.push({
            id: getField('ID') || `quest_${now()}_${quests.length}`,
            title,
            status: getField('STATUS') || 'active',
            giver_name: giverName,
            giver_location: giverLocation,
            accepted_time: getField('ACCEPTED'),
            deadline_time: getField('DEADLINE'),
            emergent: emergent || undefined,
            type: emergent ? 'emergent' : undefined,
            // An emergent quest never carries one: there is no NPC to be
            // impatient, so a coefficient could only produce a wrong mood.
            frustration_coefficient: !emergent && coeff !== null && !isNaN(coeff) ? coeff : undefined,
            objectives,
            rewards,
        })
    }

    return quests
}

/** Force the emergent fields consistent, whichever of the three ways said so. */
function normalizeQuest(quest: Quest): Quest {
    if (!quest || typeof quest !== 'object') return quest
    if (!isEmergentQuest(quest)) return quest
    return { ...quest, emergent: true, type: 'emergent', frustration_coefficient: undefined }
}

/**
 * Parse the `[QUESTS]` block out of a whole memo.
 *
 * Two formats are accepted. Plain text is what the extractor is told to write
 * and what every memo carries in practice; JSON is accepted because an older
 * build wrote it and those saves must still load. Anything else parses to no
 * quests rather than throwing — a mangled block must not take a turn down.
 */
export function parseQuestsFromMemo(memo: string | null | undefined, options: ParseQuestOptions = {}): Quest[] {
    const match = String(memo ?? '').match(/\[QUESTS\]([\s\S]*?)\[\/QUESTS\]/i)
    if (!match) return []

    const content = match[1]!.trim()

    if (content.startsWith('QUEST:')) {
        return parseQuestsFromText(content, options).map(normalizeQuest)
    }

    try {
        const parsed: unknown = JSON.parse(content)
        const quests = Array.isArray(parsed) ? parsed : ((parsed as { quests?: unknown })?.quests ?? [])
        return (Array.isArray(quests) ? quests : []).map((q) => normalizeQuest(q as Quest))
    } catch {
        return []
    }
}

export interface SerializeQuestOptions {
    /**
     * Whether to inject a `MOOD:` line. Off means no mood at all, not a
     * different vocabulary — the clock-based labels are for the UI.
     */
    showFrustration?: boolean
    /** The current in-world time, for the mood arithmetic. */
    currentTime?: string
}

/**
 * Render quests back to the plain-text format.
 *
 * `MOOD:` is written here and nowhere else. The extractor is told not to
 * produce it precisely so that it is computed rather than guessed — the model
 * has no way to do the arithmetic and every incentive to be generous about it.
 */
export function serializeQuestsToText(quests: Quest[] | null | undefined, options: SerializeQuestOptions = {}): string {
    if (!quests || !quests.length) return ''
    const showFrustration = options.showFrustration ?? false
    const currentTime = options.currentTime ?? ''

    return quests
        .map((q) => {
            const lines = [`QUEST: ${q.title}`]
            lines.push(`  ID: ${q.id}`)
            lines.push(`  STATUS: ${q.status || 'active'}`)
            const emergent = isEmergentQuest(q)
            if (emergent) lines.push('  TYPE: emergent')
            lines.push(`  GIVER: ${q.giver_name} @ ${q.giver_location}`)
            if (q.accepted_time) lines.push(`  ACCEPTED: ${q.accepted_time}`)
            if (q.deadline_time) lines.push(`  DEADLINE: ${q.deadline_time}`)
            if (!emergent && q.frustration_coefficient != null) {
                lines.push(`  FRUSTRATION_COEFF: ${q.frustration_coefficient}`)
            }

            if (!emergent && (q.status === 'active' || q.status === 'past deadline')) {
                if (showFrustration && questHasEffectiveDeadline(q)) {
                    const { label } = getQuestMood(q, currentTime, showFrustration)
                    if (label) lines.push(`  MOOD: ${label}`)
                }
            }

            for (const obj of q.objectives ?? []) {
                const tag =
                    obj.status === 'completed' ? 'OBJ_COMPLETED' : obj.status === 'failed' ? 'OBJ_FAILED' : 'OBJ_ACTIVE'
                const suffix = obj.required ? '(required)' : '(optional)'
                const progress =
                    typeof obj.progress === 'number' && typeof obj.total === 'number'
                        ? ` [${obj.progress}/${obj.total}]`
                        : ''
                lines.push(`  ${tag}: ${obj.text}${progress} ${suffix}`)
                if (obj.total != null) lines.push(`  OBJ_TOTAL: ${obj.total}`)
            }

            for (const reward of q.rewards ?? []) lines.push(`  REWARD: ${reward}`)

            return lines.join('\n')
        })
        .join('\n\n')
}

/**
 * Write a quest list into a memo's `[QUESTS]` block.
 *
 * Archived quests are dropped on the way in, and an empty result removes the
 * block rather than leaving an empty one — an empty `[QUESTS]` in the prompt
 * reads to the model as "the quest log exists and is empty", which is a
 * different and wrong claim from "there is no quest log".
 */
export function writeQuestsToMemo(
    quests: Quest[] | null | undefined,
    memo: string,
    options: SerializeQuestOptions = {},
): string {
    const target = String(memo ?? '')
    const pattern = /\s*\[QUESTS\][\s\S]*?\[\/QUESTS\]/i
    const blockExists = pattern.test(target)

    const active = (quests ?? []).filter((q) => !isArchivedQuestStatus(q.status))
    if (!active.length) return blockExists ? target.replace(pattern, '').trim() : target

    const block = `\n\n[QUESTS]\n${serializeQuestsToText(active, options)}\n[/QUESTS]`
    return blockExists ? target.replace(pattern, block) : (target + block).trim()
}

/** Split `[QUESTS]` contents on `QUEST:` boundaries, or `null` if it is not that format. */
function splitQuestTextBlocks(content: string): string[] | null {
    if (!content || !/^QUEST:/m.test(content)) return null
    return content.split(/^(?=QUEST:\s)/m).filter((block) => block.trim())
}

function questTextBlockIsArchived(block: string): boolean {
    const match = block.match(/^\s*STATUS:\s*(.+)$/im)
    if (!match) return false
    return isArchivedQuestStatus(match[1]!.trim())
}

/**
 * Drop finished quests from the memo's `[QUESTS]` block, leaving the rest byte
 * for byte as they were.
 *
 * Text-first and deliberately not a parse-and-rewrite: this runs on every turn,
 * and a quest the parser did not fully understand must not be silently
 * reformatted by having survived. Only whole `QUEST:` blocks whose `STATUS:`
 * says they are over are removed.
 */
export function stripArchivedQuestsFromMemo(memo: string): string {
    if (!memo) return memo
    const questBlockRe = /\[QUESTS\]([\s\S]*?)\[\/QUESTS\]/i
    const match = memo.match(questBlockRe)
    if (!match) return memo

    const content = match[1]!.trim()
    const blocks = splitQuestTextBlocks(content)

    if (blocks) {
        const active = blocks.filter((block) => !questTextBlockIsArchived(block))
        if (active.length === blocks.length) return memo
        const newContent = active.map((block) => block.trim()).join('\n\n').trim()
        if (!newContent) return memo.replace(questBlockRe, '').replace(/\n{3,}/g, '\n\n').trim()
        return memo.replace(questBlockRe, `[QUESTS]\n${newContent}\n[/QUESTS]`)
    }

    // The older JSON format.
    try {
        const parsed: unknown = JSON.parse(content)
        const raw = Array.isArray(parsed) ? parsed : ((parsed as { quests?: unknown })?.quests ?? [])
        const quests = Array.isArray(raw) ? (raw as Quest[]) : []
        const active = quests.filter((q) => !isArchivedQuestStatus(q.status))
        if (active.length === quests.length) return memo
        if (!active.length) return memo.replace(questBlockRe, '').replace(/\n{3,}/g, '\n\n').trim()
        return memo.replace(questBlockRe, `[QUESTS]\n${JSON.stringify(active, null, 2)}\n[/QUESTS]`)
    } catch {
        return memo
    }
}

export interface QuestSyncResult {
    /** The memo with archived quests gone and moods refreshed. */
    memo: string
    /** Every quest the block held, archived ones included — the archive. */
    quests: Quest[]
    /** The ones just dropped from the memo, for the pass report to name. */
    archived: Quest[]
}

/**
 * One turn's worth of quest housekeeping.
 *
 * Runs after the merge, on the memo about to be saved: read the quest list,
 * drop the finished ones, and rewrite the block so the moods reflect the clock
 * as it now stands. Returns the full list too, because the quests being removed
 * from the memo are exactly the ones a completed-quest archive wants to keep.
 *
 * Only rewrites when the block is in the plain-text format. A JSON block gets
 * its archived entries stripped and is otherwise left alone: reformatting a
 * shape this build does not author is a change nobody asked for.
 */
export function applyQuestSync(memo: string, options: SerializeQuestOptions & ParseQuestOptions = {}): QuestSyncResult {
    const quests = parseQuestsFromMemo(memo, options)
    let next = stripArchivedQuestsFromMemo(memo)

    const match = next.match(/\[QUESTS\]([\s\S]*?)\[\/QUESTS\]/i)
    if (match?.[1]?.trim().startsWith('QUEST:')) {
        next = writeQuestsToMemo(quests, next, options)
    }

    return { memo: next, quests, archived: quests.filter((q) => isArchivedQuestStatus(q.status)) }
}
