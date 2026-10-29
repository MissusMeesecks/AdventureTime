/**
 * Parsed quests, arranged for drawing.
 *
 * Phase 2 recovered the structure of `[QUESTS]` — objectives, counters,
 * deadlines, the giver's mood — and then handed it to the generic block
 * renderer, which draws a memo line at a time and so lost every part of it that
 * was not already a line of text. This is the missing half: it turns a
 * `Quest[]` into exactly what a card needs, with the arithmetic done.
 *
 * Kept apart from `render.ts` for the same reason `view.ts` is: everything
 * decided here — which quests are archived, whether a mood applies, how far
 * along a deadline is, what a counter reads — is a rule, and rules are worth
 * testing without a string of HTML in the way.
 *
 * The rules themselves are the legacy `renderQuestLog`'s, from `renderer.js` at
 * the pinned commit. Two things it did are deliberately absent:
 *
 *   - **The dismiss button** on an archived quest, which removed it from
 *     `settings.quests`. This build has no quest archive to remove it from —
 *     `applyQuestSync` computes the archived list every turn and drops it — so
 *     a button here would be wired to nothing.
 *   - **Per-category render options** (font, bullets, colours), which are a
 *     settings surface no phase has ported yet.
 */

import {
    computeFrustration,
    getQuestMood,
    isArchivedQuestStatus,
    isEmergentQuest,
    questHasEffectiveDeadline,
    type Quest,
    type QuestObjective,
} from './quests.js'
import { formatTimeDiff, parseInWorldTime } from './time.js'

/** One objective, with its display state resolved. */
export interface QuestObjectiveView {
    text: string
    required: boolean
    done: boolean
    failed: boolean
    /** `✓`, `✗` or `○` — the same three the legacy card drew. */
    icon: string
    /** `4/6`, or a bare `3` when no total is known. Empty when there is nothing to count. */
    progress: string
}

/** The giver's mood, as the bar under a deadline draws it. */
export interface QuestMoodView {
    /** Empty when the mood is not being shown, which is not the same as neutral. */
    label: string
    color: string
    value: number
    /**
     * Where the fill stops, 0–100.
     *
     * The frustration scale runs -1 (just accepted) to 0 (halfway) to 1 (at the
     * deadline) and upward, so the bar is drawn over the clamped range -1..2:
     * neutral lands at a third, the deadline at two thirds, and anything more
     * than a full window overdue pins at the end rather than running off it.
     */
    fillPercent: number
    /** Hover text. Names the number, since the bar itself only shows a position. */
    title: string
}

export interface QuestDeadlineView {
    time: string
    /** `2 days left`, or `3 hours ago` once it has passed. Empty when the clock is unknown. */
    remaining: string
    /** True once the deadline is behind the current time. */
    overdue: boolean
}

export interface QuestAcceptedView {
    time: string
    /** `2 days ago`. Empty when the clock is unknown. */
    elapsed: string
}

export interface QuestCardView {
    id: string
    title: string
    /** The raw status, kept so a spelling this build does not know still travels. */
    status: string
    /** `Active`, `Completed`, `Failed`, `Past Deadline`. */
    statusLabel: string
    /** Which of the three badge styles to wear. */
    tone: 'active' | 'completed' | 'failed'
    giverName: string
    giverLocation: string
    emergent: boolean
    objectives: QuestObjectiveView[]
    rewards: string[]
    accepted: QuestAcceptedView | null
    /** Present only when the quest has a real deadline *and* deadlines are switched on. */
    deadline: QuestDeadlineView | null
    /** Present only when a mood applies: a real deadline, and someone waiting on it. */
    mood: QuestMoodView | null
}

export interface QuestLogView {
    active: QuestCardView[]
    completed: QuestCardView[]
    failed: QuestCardView[]
    /** What the card header counts. Archived quests are history, not a workload. */
    activeCount: number
}

/**
 * What the module toggles change about a card.
 *
 * The defaults here are "draw what we have" — everything but the frustration
 * vocabulary, which names an NPC's feelings and so has to be asked for. They are
 * not the toggles' defaults: `buildTrackerView` reads those from
 * `syspromptModules` and passes all three explicitly.
 */
export interface QuestViewSettings {
    /** Draw the deadline row at all. Off hides the mood bar with it — the bar lives inside it. */
    showDeadlines?: boolean
    /**
     * Name the giver's feelings rather than the clock's position.
     *
     * Off is not "no mood": the bar still moves, it is just labelled `Near
     * Deadline` instead of `Frustrated`. Some players want the pressure without
     * being told an NPC is annoyed with them.
     */
    showFrustration?: boolean
    /** Draw the completed and failed sections. On unless switched off, as in the legacy build. */
    showArchive?: boolean
}

/** How a status spells itself on the badge. */
function statusLabelFor(status: string): { label: string; tone: 'active' | 'completed' | 'failed' } {
    switch (String(status ?? '').toLowerCase().trim()) {
        case 'completed':
            return { label: 'Completed', tone: 'completed' }
        case 'failed':
            return { label: 'Failed', tone: 'failed' }
        case 'past deadline':
            return { label: 'Past Deadline', tone: 'failed' }
        default:
            return { label: 'Active', tone: 'active' }
    }
}

/**
 * One objective's display state.
 *
 * `questIsCompleted` ticks every objective that did not explicitly fail. A model
 * that reports a quest done without going back to tick each step is the common
 * case, and a completed quest showing three open objectives reads as a bug.
 */
function buildObjectiveView(objective: QuestObjective, questIsCompleted: boolean): QuestObjectiveView {
    const failed = objective.status === 'failed'
    const done = objective.status === 'completed' || (questIsCompleted && !failed)

    // A counter on a finished objective is noise: it either reads 6/6, which the
    // tick already said, or it reads 4/6 on something marked done, which
    // contradicts it.
    const showProgress = typeof objective.progress === 'number' && !done && !failed
    const progress = showProgress
        ? typeof objective.total === 'number'
            ? `${objective.progress}/${objective.total}`
            : String(objective.progress)
        : ''

    return {
        text: objective.text,
        required: objective.required,
        done,
        failed,
        icon: done ? '✓' : failed ? '✗' : '○',
        progress,
    }
}

/** Both sides of a time comparison, or `null` if either end is unreadable. */
function minutesBetween(from: string | null | undefined, to: string | null | undefined): number | null {
    const start = parseInWorldTime(from)
    const end = parseInWorldTime(to)
    // The `> 0` guards are the legacy's, and they are load-bearing rather than
    // paranoid: 0 is a real time (day 1, midnight) but is also what an
    // half-parsed label lands on, and a diff measured from it would be days out.
    if (start == null || end == null || start <= 0 || end <= 0) return null
    return end - start
}

/** One quest, with every display decision already made. */
export function buildQuestCardView(quest: Quest, currentTime: string, settings: QuestViewSettings = {}): QuestCardView {
    const showDeadlines = settings.showDeadlines !== false
    const showFrustration = settings.showFrustration === true

    const { label: statusLabel, tone } = statusLabelFor(quest.status)
    const questIsCompleted = tone === 'completed'

    const emergent = isEmergentQuest(quest)
    const hasDeadline = questHasEffectiveDeadline(quest)

    let mood: QuestMoodView | null = null
    if (hasDeadline && !emergent) {
        const { label, color } = getQuestMood(quest, currentTime, showFrustration)
        // A finished quest has no live mood — `computeFrustration` returns null
        // for it — but the bar is still drawn, frozen where the scale starts.
        const value = computeFrustration(quest, currentTime) ?? 0
        const clamped = Math.max(-1, Math.min(2, value))
        // No label means no live mood — a finished quest, most often. The
        // legacy wrote `Time Progress: ` with nothing after it; an empty
        // tooltip is the same information without the dangling colon.
        const title = !label
            ? ''
            : showFrustration
              ? `NPC Mood: ${label} (${value >= 0 ? '+' : ''}${value.toFixed(2)})`
              : `Time Progress: ${label}`

        mood = {
            label,
            color,
            value,
            fillPercent: Math.round((clamped + 1) * (100 / 3)),
            title,
        }
    }

    const acceptedDiff = minutesBetween(quest.accepted_time, currentTime)
    const accepted = quest.accepted_time
        ? { time: quest.accepted_time, elapsed: acceptedDiff == null ? '' : formatTimeDiff(acceptedDiff, false) }
        : null

    const deadlineDiff = minutesBetween(currentTime, quest.deadline_time)
    const deadline =
        hasDeadline && showDeadlines && quest.deadline_time
            ? {
                  time: quest.deadline_time,
                  remaining: deadlineDiff == null ? '' : formatTimeDiff(deadlineDiff, deadlineDiff > 0),
                  overdue: deadlineDiff != null && deadlineDiff < 0,
              }
            : null

    return {
        id: quest.id,
        title: quest.title,
        status: quest.status,
        statusLabel,
        tone,
        giverName: quest.giver_name,
        giverLocation: quest.giver_location,
        emergent,
        objectives: (quest.objectives ?? []).map((objective) => buildObjectiveView(objective, questIsCompleted)),
        rewards: quest.rewards ?? [],
        accepted,
        deadline,
        mood,
    }
}

/**
 * The whole quest log, grouped.
 *
 * Archived quests are separated rather than sorted in with the rest, because
 * the question a player asks the log is "what am I doing", and a finished quest
 * answers a different one. With the archive switched off they are dropped here
 * rather than hidden by the renderer — a card nobody will see should not be
 * built.
 */
export function buildQuestLogView(
    quests: Quest[] | null | undefined,
    currentTime: string,
    settings: QuestViewSettings = {},
): QuestLogView {
    const all = Array.isArray(quests) ? quests : []
    const showArchive = settings.showArchive !== false

    const cards = all.map((quest) => ({ quest, card: buildQuestCardView(quest, currentTime, settings) }))
    const active = cards.filter(({ quest }) => !isArchivedQuestStatus(quest.status)).map(({ card }) => card)

    if (!showArchive) return { active, completed: [], failed: [], activeCount: active.length }

    const completed = cards.filter(({ card }) => card.tone === 'completed').map(({ card }) => card)
    const failed = cards
        .filter(({ quest, card }) => card.tone === 'failed' && isArchivedQuestStatus(quest.status))
        .map(({ card }) => card)

    return { active, completed, failed, activeCount: active.length }
}
