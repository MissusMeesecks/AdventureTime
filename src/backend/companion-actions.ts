/**
 * The Adventure Companion's actions as results (Phase 100c, roadmap row
 * 100): what a tracker pass, an agent pass and a map update reported, put
 * in the shape Multihog's Companion tells its model — the action's name,
 * whether it worked, a status word and a sentence.
 *
 * The passes themselves are the operations the panel's own controls run
 * (`tracker.instruct`, `agent.instruct`, `map.update`); nothing here runs
 * one. Each summary is honest about a pass that changed nothing: the model
 * is told so, and so is the player in the receipt.
 */
import type { AgentRunResult, MapUpdaterResult, TrackerPassReportDTO } from '../protocol.js'
import { COMPANION_ACTION_LABELS, type CompanionActionResult } from '../tracker/companion.js'

const list = (names: readonly string[] | undefined): string => (names ?? []).join(', ')

/** What an instructed tracker pass did. `since` is when the action began: an older report is not this pass's. */
export function summarizeTrackerAction(report: TrackerPassReportDTO | undefined, since: string): CompanionActionResult {
    const action = COMPANION_ACTION_LABELS.state_tracker
    if (!report || report.at < since) return { action, success: false, status: 'failed', message: 'State Tracker did not report a result.' }
    if (report.status === 'updated') {
        const parts = [
            report.replaced?.length ? `updated ${list(report.replaced)}` : '',
            report.added?.length ? `added ${list(report.added)}` : '',
            report.removed?.length ? `removed ${list(report.removed)}` : '',
            report.benched?.length ? `benched ${list(report.benched)}` : '',
            report.unbenched?.length ? `unbenched ${list(report.unbenched)}` : '',
            report.archived?.length ? `archived the quests ${list(report.archived)}` : '',
            report.relations?.length ? `relationships: ${list(report.relations)}` : '',
        ].filter(Boolean)
        const unmatched = report.unmatched?.length ? ` Nobody on the roster is named ${list(report.unmatched)}.` : ''
        return { action, success: true, status: 'completed', message: `${parts.length ? `The character sheet changed: ${parts.join('; ')}.` : 'State Tracker command completed.'}${unmatched}` }
    }
    if (report.status === 'no-change') return { action, success: true, status: 'noop', message: `The State Tracker made no change.${report.reason ? ` ${report.reason}` : ''}` }
    const why = report.reason ? ` ${report.reason}` : ''
    if (report.status === 'skipped') return { action, success: false, status: 'unavailable', message: `The State Tracker did not run.${why}` }
    if (report.status === 'cancelled') return { action, success: false, status: 'stopped', message: `The State Tracker pass was stopped.${why}` }
    return { action, success: false, status: 'failed', message: `The State Tracker pass failed.${why}` }
}

/** What an instructed agent pass did. */
export function summarizeAgentAction(result: AgentRunResult): CompanionActionResult {
    const action = COMPANION_ACTION_LABELS.lorebook_agent
    if (result.unavailable) return { action, success: false, status: 'unavailable', message: result.unavailable }
    const summary = result.summary.trim()
    if (result.outcome === 'committed') {
        const refused = result.write?.refused.length ? ` Refused: ${result.write.refused.join('; ')}.` : ''
        return { action, success: true, status: 'completed', message: `${summary || 'Lorebook Agent command completed.'}${refused}` }
    }
    if (result.outcome === 'no-commit') return { action, success: true, status: 'noop', message: summary || 'The Lorebook Agent wrote nothing.' }
    if (result.outcome === 'cancelled') return { action, success: false, status: 'stopped', message: summary || 'The Lorebook Agent pass was stopped.' }
    const problems = result.problems.length ? ` ${result.problems.join('; ')}` : ''
    return { action, success: false, status: 'failed', message: `${summary || 'Lorebook Agent command did not complete.'}${problems}` }
}

/** What a map update on an instruction did. */
export function summarizeMapAction(result: MapUpdaterResult): CompanionActionResult {
    const action = COMPANION_ACTION_LABELS.map_updater
    const site = result.site ? ` (${result.site})` : ''
    if (result.status === 'applied') return { action, success: true, status: 'completed', message: `Map occupancy update applied${site}.${result.summary ? ` ${result.summary}` : ''}` }
    if (result.status === 'noop') return { action, success: true, status: 'noop', message: `Nothing durable changed on the map${site}.` }
    if (result.status === 'skipped') return { action, success: false, status: 'unavailable', message: result.reason || 'The Map Updater did not run.' }
    return { action, success: false, status: 'failed', message: result.reason || 'Could not apply a valid map occupancy update.' }
}
