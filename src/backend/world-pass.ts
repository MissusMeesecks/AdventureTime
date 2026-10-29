/**
 * The World Progression pass: one in-world period, one report.
 *
 * The legacy's `runWorldProgressionPass` and `maybeRunWorldProgression`
 * (`router.js`, `narrative-hooks.js`), with the I/O behind dependencies and
 * every decision in `tracker/world.ts`. In order:
 *
 *   1. read the clock out of the memo and name the period;
 *   2. load the campaign's books -- the dossiers come from them;
 *   3. refuse to write a period that already has a report;
 *   4. consolidate the archive first when it is due, so the history a new
 *      report reads is the compressed one;
 *   5. pick the locations, build both prompts, ask the model;
 *   6. file the report in the `_World` book, disabled -- the host's keyword
 *      activation never sees it; the narrator gets it from this extension --
 *      with its routing metadata, then set the rolling window;
 *   7. advance the clock and the per-location watermarks.
 *
 * A pass that writes to the campaign reports itself every time, as the agent's
 * does, and runs on the agent's connection: it is the same kind of job.
 */

import { bookStanding, campaignBookName } from '../agent/campaign.js'
import {
    buildLocationDossiers,
    buildWorldSystemPrompt,
    buildWorldUserPrompt,
    consolidationPlan,
    decideWorldPass,
    findReportForPeriod,
    formatInWorldTime,
    isRawReport,
    historicalReportLines,
    normalizeWorldReportMetadata,
    reportKeys,
    rollingWindow,
    selectLocations,
    sortReports,
    stampLocationAdvancement,
    WORLD_REPORT_METADATA_KEY,
    WORLD_SOURCE_SYSTEM_PROMPT,
    buildSkeletonLorebookContext,
    buildWorldSourceUserPrompt,
    cleanWorldSource,
    buildSkeletonSystemPrompt,
    buildSkeletonUserPrompt,
    countSkeleton,
    existingSkeletonPremises,
    isSkeletonBookName,
    isWorldBookName,
    parseSkeletonOutput,
    skeletonEntry,
    skeletonLabel,
    type SkeletonCounts,
    type WorldBooks,
    type WorldClockSettings,
} from '../tracker/world.js'
import { extractCurrentTimeStr, currentTimeFromMemo, parseInWorldTime } from '../tracker/time.js'
import { stripStamp } from '../agent/provenance.js'
import type { WorldRecord, WorldReportRef, WorldRunReport, WorldSkeletonReport, WorldStore } from './world-store.js'

/** An entry as the pass reads it, in the fields it uses. */
export interface WorldEntry {
    id: string
    uid: string
    comment: string
    content: string
    key: string[]
    extensions?: Record<string, unknown>
    /** When the host made it, epoch milliseconds. The order reports were filed in (lesson 40). */
    createdAt?: number
    /** Out of the host's keyword scan; a map root is, on purpose. Absent where the reader does not carry it. */
    disabled?: boolean
    /** Always in the prompt, whatever the scan finds: Campaign Records' pin (71a). */
    constant?: boolean
}

/** The slice of `spindle.world_books` the pass needs, bound to a user (rule 3f). */
export interface WorldBookStore {
    listBooks(): Promise<Array<{ id: string; name: string }>>
    createBook(name: string): Promise<{ id: string; name: string }>
    listEntries(bookId: string): Promise<WorldEntry[]>
    createEntry(bookId: string, entry: { key: string[]; comment: string; content: string; disabled: boolean; extensions?: Record<string, unknown> }): Promise<WorldEntry>
    updateEntry(entryId: string, patch: { content?: string; extensions?: Record<string, unknown>; disabled?: boolean; constant?: boolean; comment?: string; key?: string[] }): Promise<unknown>
    deleteEntry(entryId: string): Promise<unknown>
}

/** What a pass is told about this chat and this user, settled by the caller. */
export interface WorldOptions {
    enabled: boolean
    /** The campaign's prefix, which names its books. */
    prefix: string
    intervalHours: number
    keepActive: number
    /** Recent replies the model is shown for scene context. `0` for none. */
    lookback: number
    /** Prior reports it is shown. `0` for all of them. */
    historyLookback: number
    locationsPerReport: number
    locationRandomize: boolean
    exclusionList: string
    consolidateEnabled: boolean
    consolidateInterval: number
    /** The cartridge's own report prompt, with `{periodLabel}` in it. */
    systemPrompt: string
    clock: WorldClockSettings
    /** The skeleton generator's settings (33b). */
    skeleton: WorldSkeletonOptions
}

export interface WorldSkeletonOptions {
    factions: number
    locations: number
    conflicts: number
    /** The user's own architect prompt; `''` for the stock one. */
    systemPrompt: string
    /** Feed existing lorebooks in as canon. */
    useLorebooks: boolean
    /** Only what those books state; the counts are ignored. */
    lorebookOnly: boolean
    /** Which books, by name; none means this campaign's own, minus World Progression's. */
    lorebookFilter: string[]
    /** When adding, show the model the premises already filed. */
    useExisting: boolean
    /** Messages read when the source is written from the chat (33c). */
    sourceLookback: number
}

export interface WorldPassDeps {
    store: (userId: string | undefined) => WorldBookStore
    /** One model call. */
    generate(messages: Array<{ role: 'system' | 'user'; content: string }>, chatId: string, userId: string | undefined, signal?: AbortSignal): Promise<string>
    memo(chatId: string, userId: string | undefined): Promise<string>
    /** The narrator's last `lookback` replies, oldest first, one paragraph each. */
    narrative(chatId: string, userId: string | undefined, lookback: number): Promise<string[]>
    /** The last `lookback` messages of both sides, oldest first, `Who: text` each -- what the source is summarised from (33c). */
    history(chatId: string, userId: string | undefined, lookback: number): Promise<string[]>
    options(chatId: string, userId: string | undefined): Promise<WorldOptions>
    ownership: {
        get(chatId: string, userId: string | undefined): Promise<string[]>
        /** A book this made: recorded as the campaign's and attached at once (66), whatever the name's standing. */
        made(chatId: string, names: string[], userId: string | undefined): Promise<void>
    }
    state: WorldStore
    events?: {
        started(chatId: string, userId: string | undefined, at: string, trigger: WorldRunReport['trigger']): void
        finished(chatId: string, userId: string | undefined, report: WorldRunReport): void
    }
    log: { info(m: string): void; warn(m: string): void }
    random?: () => number
    now?: () => Date
}

export interface WorldRunRequest {
    chatId: string
    userId: string | undefined
    trigger: WorldRunReport['trigger']
    /** Appended to the system prompt for this run only. */
    extraInstructions?: string
    signal?: AbortSignal
}

export interface WorldSkeletonRequest {
    chatId: string
    userId: string | undefined
    /** The user's description of the world. Saved with the chat whatever happens next. */
    source: string
    /** `replace` empties the book first; `append` adds to what is there. */
    mode: 'replace' | 'append'
    signal?: AbortSignal
}

export interface WorldSourceRequest {
    chatId: string
    userId: string | undefined
    signal?: AbortSignal
}

export interface WorldSourceReport {
    status: 'written' | 'failed' | 'cancelled' | 'skipped'
    at: string
    source?: string
    reason?: string
}

export interface WorldPurgeRequest {
    chatId: string
    userId: string | undefined
    /** `false` keeps the skeleton and empties only the reports. */
    includeSkeleton: boolean
}

export interface WorldPurgeResult {
    worldBookName: string
    skeletonBookName: string
    worldCleared: number
    skeletonCleared: number
}

/** What the panel shows: the switch, the clock, the window, the last pass. */
export interface WorldStatus {
    enabled: boolean
    intervalHours: number
    locationsPerReport: number
    keepActive: number
    lookback: number
    prefix: string
    worldBookName: string
    lastFiredPeriodLabel: string
    /** When the next report is due, from the last one and the interval; `''` before the clock has started. */
    nextDueLabel: string
    /** The clock as the memo has it, or `''` when it has none. */
    currentTimeLabel: string
    activeReports: Array<{ label: string; reportId: string }>
    lastRun?: WorldRunReport
    skeletonBookName: string
    skeletonCounts: SkeletonCounts
    skeletonSource: string
    skeleton: Omit<WorldSkeletonOptions, 'lorebookFilter'> & { lorebookFilter: string }
    lastSkeleton?: WorldSkeletonReport
}

export interface WorldProgression {
    /** After a tracker pass: start the clock, wait, or run. `null` when nothing ran. */
    maybeRun(chatId: string, userId: string | undefined): Promise<WorldRunReport | null>
    /** Now, whatever the clock says. */
    run(request: WorldRunRequest): Promise<WorldRunReport>
    status(chatId: string, userId: string | undefined): Promise<WorldStatus>
    /** Forget when the last report was, so the next starts from the current time. */
    resetTimeline(chatId: string, userId: string | undefined): Promise<WorldRecord>
    /** Write the campaign's `_Skeleton` book from the user's source text (33b). */
    skeleton(request: WorldSkeletonRequest): Promise<WorldSkeletonReport>
    /** Empty the reports, and the seeds unless kept, and forget the clock. Irreversible. */
    purge(request: WorldPurgeRequest): Promise<WorldPurgeResult>
    /** Write the skeleton's source from the recent chat and keep it (33c). */
    writeSource(request: WorldSourceRequest): Promise<WorldSourceReport>
    /** The lorebooks the skeleton may read as canon: every book but World Progression's own, this campaign's marked (33c). */
    books(chatId: string, userId: string | undefined): Promise<Array<{ name: string; own: boolean }>>
    /** Consolidate the oldest `count` raw reports into one digest now (72b, the legacy's *Consolidate Now*). */
    consolidateNow(chatId: string, userId: string | undefined, count: number): Promise<{ label: string; consolidated: number }>
    /** Set when the next report is due (72b, the legacy's *Override next*): the clock the last is taken to have fired at follows from it. */
    overrideNext(chatId: string, userId: string | undefined, next: string): Promise<WorldRecord>
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

export function createWorldProgression(deps: WorldPassDeps): WorldProgression {
    const now = deps.now ?? (() => new Date())
    const running = new Set<string>()

    async function campaignBooks(store: WorldBookStore, prefix: string, owned: readonly string[]): Promise<{ books: WorldBooks; worldBook: { id: string; name: string } | null; worldEntries: WorldEntry[] }> {
        const worldBookName = campaignBookName(prefix, 'World')
        const all = await store.listBooks()
        const books: WorldBooks = {}
        let worldBook: { id: string; name: string } | null = null
        let worldEntries: WorldEntry[] = []
        for (const book of all) {
            if (bookStanding(book.name, prefix, owned) !== 'owned') continue
            let entries: WorldEntry[]
            try {
                entries = await store.listEntries(book.id)
            } catch (error) {
                deps.log.warn(`world: could not read "${book.name}": ${describe(error)}`)
                continue
            }
            if (book.name.toLowerCase() === worldBookName.toLowerCase()) {
                worldBook = book
                worldEntries = sortReports(entries)
            }
            // A seed is named without its category, so the dossier is called
            // Harrowgate and real lore for Harrowgate supersedes it (33b); and
            // the agent's `[msg #N]` stamp comes off every name, so a report
            // is headed "Harrowgate", not "Harrowgate [msg #303]" (33c).
            const seeds = isSkeletonBookName(book.name)
            books[book.name] = {
                entries: Object.fromEntries(entries.map((e) => [e.uid, { comment: stripStamp(seeds ? skeletonLabel(e.comment) : e.comment), key: e.key, content: e.content, extensions: e.extensions }])),
            }
        }
        return { books, worldBook, worldEntries }
    }

    function windowOf(worldBookName: string, entries: WorldEntry[], keepActive: number): WorldReportRef[] {
        return rollingWindow(sortReports(entries), keepActive).active.map((e) => ({
            id: e.id,
            reportId: `${worldBookName}::${e.uid}`,
            label: e.comment || 'World Report',
            content: e.content,
        }))
    }

    async function finish(chatId: string, userId: string | undefined, report: WorldRunReport, patch: Partial<WorldRecord> = {}): Promise<WorldRunReport> {
        await deps.state.save(chatId, { ...patch, lastRun: report }, userId)
        deps.events?.finished(chatId, userId, report)
        return report
    }

    async function run(request: WorldRunRequest): Promise<WorldRunReport> {
        const { chatId, userId, trigger } = request
        const at = () => now().toISOString()
        if (running.has(chatId)) {
            return { status: 'skipped', at: at(), trigger, reason: 'A world pass is already running for this chat.' }
        }
        running.add(chatId)
        deps.events?.started(chatId, userId, at(), trigger)
        try {
            const options = await deps.options(chatId, userId)
            const store = deps.store(userId)
            const state = await deps.state.load(chatId, userId)
            const worldBookName = campaignBookName(options.prefix, 'World')
            if (!worldBookName) {
                return finish(chatId, userId, { status: 'failed', at: at(), trigger, reason: 'This campaign has no name, so there is no book to file a report in.' })
            }

            // 1. The clock.
            const memo = await deps.memo(chatId, userId)
            const timeStr = extractCurrentTimeStr(currentTimeFromMemo(memo))
            const currentMinutes = parseInWorldTime(timeStr)
            if (currentMinutes === null || currentMinutes < 0) {
                return finish(chatId, userId, { status: 'failed', at: at(), trigger, reason: 'The tracker has no readable [TIME] block yet. Run the tracker once first.' })
            }
            // The report is dated at the clock (45c-ter, the maintainer's decision
            // of 2026-10-07), not at the period after the last as the legacy
            // dates it: a manual press with the clock at 08:11 PM filed 09:06 PM,
            // and a nine-hour skip filed one lagging hour per turn, so the
            // narrator was shown "Day 1, 09:30 PM" on Day 2. The schedule is
            // unchanged — the next report is due one interval after this one.
            const periodLabel = formatInWorldTime(currentMinutes, options.clock)
            deps.log.info(`world: checking for "${periodLabel}" (${trigger})`)

            // 2. The books.
            const owned = await deps.ownership.get(chatId, userId)
            let { books, worldBook, worldEntries } = await campaignBooks(store, options.prefix, owned)

            // 3. Never the same period twice.
            const existing = findReportForPeriod(worldEntries, periodLabel)
            if (existing) {
                const metadata = normalizeWorldReportMetadata(existing, worldBookName, existing.uid)
                deps.log.info(`world: "${periodLabel}" already exists — advancing the clock`)
                return finish(
                    chatId,
                    userId,
                    { status: 'duplicate', at: at(), trigger, periodLabel, selectedLocations: metadata.selectedLocations, reason: `A report for ${periodLabel} is already filed.` },
                    {
                        lastFiredPeriodLabel: periodLabel,
                        locationLastAdvanced: stampLocationAdvancement(state.locationLastAdvanced, metadata.selectedLocations, periodLabel),
                    },
                )
            }

            // 4. Consolidation first, so the history below is the compressed one.
            let consolidated: string | undefined
            if (options.consolidateEnabled && worldBook) {
                const plan = consolidationPlan(worldEntries, options.consolidateInterval)
                if (plan) {
                    deps.log.info(`world: consolidating ${plan.toConsolidate.length} reports into "${plan.label}"`)
                    let text = ''
                    try {
                        text = await deps.generate([{ role: 'system', content: plan.system }, { role: 'user', content: plan.user }], chatId, userId, request.signal)
                    } catch (error) {
                        deps.log.warn(`world: consolidation failed, continuing without it: ${describe(error)}`)
                    }
                    if (text.trim()) {
                        await store.createEntry(worldBook.id, { key: [], comment: plan.label, content: text.trim(), disabled: true })
                        for (const entry of plan.toConsolidate) await store.deleteEntry(entry.id)
                        consolidated = plan.label
                        worldEntries = sortReports(await store.listEntries(worldBook.id))
                        books[worldBook.name] = { entries: Object.fromEntries(worldEntries.map((e) => [e.uid, { comment: e.comment, key: e.key, content: e.content, extensions: e.extensions }])) }
                    }
                }
            }

            // 5. The prompts and the call.
            const history = historicalReportLines(worldEntries, options.historyLookback)
            const recentNarrative = options.lookback > 0 ? (await deps.narrative(chatId, userId, options.lookback)).join('\n\n') : ''
            const { dossiers, globalContext } = buildLocationDossiers(books, { prefix: options.prefix, exclusionList: options.exclusionList })
            const selected = selectLocations(dossiers, {
                count: options.locationsPerReport,
                lastAdvanced: state.locationLastAdvanced,
                randomize: options.locationRandomize,
                ...(deps.random ? { random: deps.random } : {}),
            })
            const selectedLocations = selected.map((d) => d.name)
            const system = buildWorldSystemPrompt({
                template: options.systemPrompt,
                periodLabel,
                useDdMmYyFormat: options.clock.useDdMmYyFormat,
                extraInstructions: request.extraInstructions,
            })
            const user = buildWorldUserPrompt({ selected, globalContext, history, recentNarrative, periodLabel })
            deps.log.info(`world: generating "${periodLabel}" (${selectedLocations.length} locations, ${history.length} prior reports)`)
            let content: string
            try {
                content = (await deps.generate([{ role: 'system', content: system }, { role: 'user', content: user }], chatId, userId, request.signal)).trim()
            } catch (error) {
                if (request.signal?.aborted) return finish(chatId, userId, { status: 'cancelled', at: at(), trigger, periodLabel, reason: 'Stopped.' })
                return finish(chatId, userId, { status: 'failed', at: at(), trigger, periodLabel, reason: `The model call failed: ${describe(error)}` })
            }
            if (!content) {
                return finish(chatId, userId, { status: 'failed', at: at(), trigger, periodLabel, reason: 'The model returned nothing.' })
            }

            // 6. File it, disabled, with its routing metadata; then the window.
            if (!worldBook) {
                worldBook = await store.createBook(worldBookName)
                await deps.ownership.made(chatId, [worldBook.name], userId)
            }
            const made = await store.createEntry(worldBook.id, { key: reportKeys(periodLabel), comment: periodLabel, content, disabled: true })
            const reportId = `${worldBook.name}::${made.uid}`
            await store.updateEntry(made.id, {
                extensions: { ...(made.extensions ?? {}), [WORLD_REPORT_METADATA_KEY]: { reportId, periodLabel, selectedLocations } },
            })
            const activeReports = windowOf(worldBook.name, await store.listEntries(worldBook.id), options.keepActive)

            // 7. The clock and the watermarks.
            deps.log.info(`world: "${periodLabel}" report saved (${content.length} characters)`)
            return finish(
                chatId,
                userId,
                { status: 'written', at: at(), trigger, periodLabel, selectedLocations, ...(consolidated ? { consolidated } : {}) },
                {
                    lastFiredPeriodLabel: periodLabel,
                    locationLastAdvanced: stampLocationAdvancement(state.locationLastAdvanced, selectedLocations, periodLabel),
                    activeReports,
                },
            )
        } catch (error) {
            return finish(chatId, userId, { status: 'failed', at: at(), trigger, reason: describe(error) })
        } finally {
            running.delete(chatId)
        }
    }

    return {
        run,

        async maybeRun(chatId, userId) {
            const options = await deps.options(chatId, userId)
            if (!options.enabled) return null
            const state = await deps.state.load(chatId, userId)
            const decision = decideWorldPass({
                memo: await deps.memo(chatId, userId),
                lastFiredPeriodLabel: state.lastFiredPeriodLabel,
                intervalHours: options.intervalHours,
                settings: options.clock,
            })
            if (decision.kind === 'start') {
                deps.log.info(`world: clock started at ${decision.label}; first report due one interval on`)
                await deps.state.save(chatId, { lastFiredPeriodLabel: decision.label }, userId)
                return null
            }
            if (decision.kind !== 'due') return null
            if (running.has(chatId)) return null
            return run({ chatId, userId, trigger: 'automatic' })
        },

        async status(chatId, userId) {
            const options = await deps.options(chatId, userId)
            const state = await deps.state.load(chatId, userId)
            const skeletonBookName = campaignBookName(options.prefix, 'Skeleton')
            let skeletonCounts: SkeletonCounts = { factions: 0, locations: 0, conflicts: 0 }
            try {
                const found = await findBook(deps.store(userId), skeletonBookName)
                if (found) skeletonCounts = countSkeleton(await deps.store(userId).listEntries(found.id))
            } catch (error) {
                // The status draws without the count; the next generation will say what it finds.
                deps.log.warn(`world: could not count the skeleton: ${describe(error)}`)
            }
            let currentTimeLabel = ''
            let nextDueLabel = ''
            try {
                const minutes = parseInWorldTime(extractCurrentTimeStr(currentTimeFromMemo(await deps.memo(chatId, userId))))
                if (minutes !== null && minutes >= 0) currentTimeLabel = formatInWorldTime(minutes, options.clock)
                const last = state.lastFiredPeriodLabel ? parseInWorldTime(state.lastFiredPeriodLabel) : null
                const from = last ?? minutes
                if (from !== null && from >= 0) nextDueLabel = formatInWorldTime(from + Math.max(1, options.intervalHours) * 60, options.clock)
            } catch {
                // The status draws without a clock.
            }
            return {
                enabled: options.enabled,
                intervalHours: options.intervalHours,
                locationsPerReport: options.locationsPerReport,
                keepActive: options.keepActive,
                lookback: options.lookback,
                prefix: options.prefix,
                worldBookName: campaignBookName(options.prefix, 'World'),
                lastFiredPeriodLabel: state.lastFiredPeriodLabel,
                nextDueLabel,
                currentTimeLabel,
                activeReports: state.activeReports.map((r) => ({ label: r.label, reportId: r.reportId })),
                ...(state.lastRun ? { lastRun: state.lastRun } : {}),
                skeletonBookName,
                skeletonCounts,
                skeletonSource: state.skeletonSource,
                skeleton: { ...options.skeleton, lorebookFilter: options.skeleton.lorebookFilter.join(', ') },
                ...(state.lastSkeleton ? { lastSkeleton: state.lastSkeleton } : {}),
            }
        },

        resetTimeline(chatId, userId) {
            deps.log.info('world: timeline reset; the next report starts from the current time')
            return deps.state.save(chatId, { lastFiredPeriodLabel: '' }, userId)
        },

        async consolidateNow(chatId, userId, count) {
            const step = Math.max(2, Math.floor(Number(count) || 0))
            const options = await deps.options(chatId, userId)
            const store = deps.store(userId)
            const owned = await deps.ownership.get(chatId, userId)
            const { worldBook, worldEntries } = await campaignBooks(store, options.prefix, owned)
            if (!worldBook) throw new Error('This campaign has no World book yet; nothing to consolidate.')
            const plan = consolidationPlan(worldEntries, step)
            if (!plan) {
                const raw = worldEntries.filter((e) => isRawReport(String(e.comment ?? '').trim())).length
                throw new Error(`Only ${raw} raw ${raw === 1 ? 'report is' : 'reports are'} filed; ${step} are needed to consolidate.`)
            }
            deps.log.info(`world: consolidating ${plan.toConsolidate.length} reports into "${plan.label}" on request`)
            const text = (await deps.generate([{ role: 'system', content: plan.system }, { role: 'user', content: plan.user }], chatId, userId)).trim()
            if (!text) throw new Error('The model returned no digest; nothing was consolidated.')
            await store.createEntry(worldBook.id, { key: [], comment: plan.label, content: text, disabled: true })
            for (const entry of plan.toConsolidate) await store.deleteEntry(entry.id)
            return { label: plan.label, consolidated: plan.toConsolidate.length }
        },

        async overrideNext(chatId, userId, next) {
            const options = await deps.options(chatId, userId)
            const minutes = parseInWorldTime(String(next ?? '').trim())
            if (minutes === null || minutes <= 0) throw new Error(`“${next}” is not an in-world time. Accepted: “Day 6, 08:00 AM”, “Day 6, 08:00”, “Day 6”.`)
            const interval = Math.max(1, options.intervalHours) * 60
            const lastFiredPeriodLabel = formatInWorldTime(Math.max(0, minutes - interval), options.clock)
            deps.log.info(`world: the next report is set for ${formatInWorldTime(minutes, options.clock)}; the last is taken as ${lastFiredPeriodLabel}`)
            return deps.state.save(chatId, { lastFiredPeriodLabel }, userId)
        },

        skeleton,
        purge,
        writeSource,

        async books(chatId, userId) {
            const options = await deps.options(chatId, userId)
            const owned = await deps.ownership.get(chatId, userId)
            return (await deps.store(userId).listBooks())
                .filter((b) => !isWorldBookName(b.name) && !isSkeletonBookName(b.name))
                .map((b) => ({ name: b.name, own: bookStanding(b.name, options.prefix, owned) === 'owned' }))
                .sort((a, b) => Number(b.own) - Number(a.own) || a.name.localeCompare(b.name))
        },
    }

    /** The source from the chat (33c): one model call over the recent messages, the paragraph kept as the chat's source. */
    async function writeSource(request: WorldSourceRequest): Promise<WorldSourceReport> {
        const { chatId, userId } = request
        const at = () => now().toISOString()
        if (running.has(chatId)) return { status: 'skipped', at: at(), reason: 'A world pass is already running for this chat.' }
        running.add(chatId)
        try {
            const options = await deps.options(chatId, userId)
            const lines = await deps.history(chatId, userId, options.skeleton.sourceLookback)
            if (!lines.length) return { status: 'failed', at: at(), reason: 'There are no readable messages in this chat to write from.' }
            deps.log.info(`world: writing the skeleton source from ${lines.length} messages`)
            let raw: string
            try {
                raw = await deps.generate([{ role: 'system', content: WORLD_SOURCE_SYSTEM_PROMPT }, { role: 'user', content: buildWorldSourceUserPrompt(lines) }], chatId, userId, request.signal)
            } catch (error) {
                if (request.signal?.aborted) return { status: 'cancelled', at: at(), reason: 'Stopped.' }
                return { status: 'failed', at: at(), reason: `The model call failed: ${describe(error)}` }
            }
            const source = cleanWorldSource(raw)
            if (!source) return { status: 'failed', at: at(), reason: 'The model returned nothing.' }
            await deps.state.save(chatId, { skeletonSource: source }, userId)
            return { status: 'written', at: at(), source }
        } catch (error) {
            return { status: 'failed', at: at(), reason: describe(error) }
        } finally {
            running.delete(chatId)
        }
    }

    // ── the skeleton (33b) ──────────────────────────────────────────────

    async function findBook(store: WorldBookStore, name: string): Promise<{ id: string; name: string } | null> {
        if (!name) return null
        const lower = name.toLowerCase()
        return (await store.listBooks()).find((b) => b.name.toLowerCase() === lower) ?? null
    }

    /**
     * The books fed in as canon: the ones the filter names, or, with no
     * filter, this campaign's own -- never another campaign's (9m), and never
     * World Progression's own reports or seeds, which are not source material.
     */
    async function sourceBooks(store: WorldBookStore, options: WorldOptions, owned: readonly string[]): Promise<WorldBooks> {
        const all = await store.listBooks()
        const wanted = options.skeleton.lorebookFilter.map((n) => n.trim().toLowerCase()).filter(Boolean)
        const chosen = wanted.length
            ? all.filter((b) => wanted.includes(b.name.toLowerCase()))
            : all.filter((b) => bookStanding(b.name, options.prefix, owned) === 'owned' && !isWorldBookName(b.name) && !isSkeletonBookName(b.name))
        const books: WorldBooks = {}
        for (const book of chosen) {
            try {
                const entries = await store.listEntries(book.id)
                books[book.name] = { entries: Object.fromEntries(entries.map((e) => [e.uid, { comment: e.comment, key: e.key, content: e.content, extensions: e.extensions }])) }
            } catch (error) {
                deps.log.warn(`world: could not read "${book.name}" for the skeleton: ${describe(error)}`)
            }
        }
        return books
    }

    async function finishSkeleton(chatId: string, userId: string | undefined, report: WorldSkeletonReport): Promise<WorldSkeletonReport> {
        await deps.state.save(chatId, { lastSkeleton: report }, userId)
        return report
    }

    async function skeleton(request: WorldSkeletonRequest): Promise<WorldSkeletonReport> {
        const { chatId, userId, mode } = request
        const at = () => now().toISOString()
        const source = String(request.source ?? '').trim()
        if (running.has(chatId)) {
            return { status: 'skipped', at: at(), mode, reason: 'A world pass is already running for this chat.' }
        }
        running.add(chatId)
        try {
            // The source is the user's writing: kept whatever the model does next.
            await deps.state.save(chatId, { skeletonSource: source }, userId)
            const options = await deps.options(chatId, userId)
            const store = deps.store(userId)
            const skeletonBookName = campaignBookName(options.prefix, 'Skeleton')
            if (!skeletonBookName) {
                return finishSkeleton(chatId, userId, { status: 'failed', at: at(), mode, reason: 'This campaign has no name, so there is no book to file a skeleton in.' })
            }
            const owned = await deps.ownership.get(chatId, userId)
            let book = await findBook(store, skeletonBookName)
            const existing = book ? await store.listEntries(book.id) : []

            // 1. The prompts.
            let lorebookContext = ''
            if (options.skeleton.useLorebooks) {
                lorebookContext = await buildSkeletonLorebookContext(await sourceBooks(store, options, owned), { lorebookOnly: options.skeleton.lorebookOnly })
                if (options.skeleton.lorebookOnly && !lorebookContext) {
                    return finishSkeleton(chatId, userId, { status: 'failed', at: at(), mode, reason: 'Lorebook-only mode is on, but the source lorebooks have no usable entries.' })
                }
            }
            const premises = mode === 'append' && options.skeleton.useExisting ? existingSkeletonPremises(existing) : ''
            if (!source && !lorebookContext && !premises) {
                return finishSkeleton(chatId, userId, { status: 'failed', at: at(), mode, reason: 'Nothing to work from: write a source, or feed lorebooks in.' })
            }
            const system = buildSkeletonSystemPrompt({
                template: options.skeleton.systemPrompt,
                factions: options.skeleton.factions,
                locations: options.skeleton.locations,
                conflicts: options.skeleton.conflicts,
                lorebookOnly: options.skeleton.useLorebooks && options.skeleton.lorebookOnly,
            })
            const user = buildSkeletonUserPrompt({ source, lorebookContext, existingPremises: premises, append: mode === 'append' })
            deps.log.info(`world: generating the skeleton (${mode}; ${existing.length} filed, ${Object.keys(lorebookContext ? options.skeleton.lorebookFilter : []).length || (lorebookContext ? 'own' : 'no')} source books)`)

            // 2. The call and the parse.
            let raw: string
            try {
                raw = await deps.generate([{ role: 'system', content: system }, { role: 'user', content: user }], chatId, userId, request.signal)
            } catch (error) {
                if (request.signal?.aborted) return finishSkeleton(chatId, userId, { status: 'cancelled', at: at(), mode, reason: 'Stopped.' })
                return finishSkeleton(chatId, userId, { status: 'failed', at: at(), mode, reason: `The model call failed: ${describe(error)}` })
            }
            if (!raw.trim()) return finishSkeleton(chatId, userId, { status: 'failed', at: at(), mode, reason: 'The model returned nothing.' })
            const records = parseSkeletonOutput(raw)
            if (!records.length) {
                return finishSkeleton(chatId, userId, { status: 'failed', at: at(), mode, reason: `The reply had no premises in it (it began: "${raw.trim().slice(0, 80)}").` })
            }

            // 3. The book: emptied first when replacing, created when absent, owned either way.
            // A book remade under a name the campaign already owns — made, renamed, removed, made
            // again — is a new book the chat is not attached to (66); the hook attaches it either way.
            if (!book) {
                book = await store.createBook(skeletonBookName)
                await deps.ownership.made(chatId, [book.name], userId)
            } else if (mode === 'replace') {
                for (const entry of existing) await store.deleteEntry(entry.id)
            }
            const written = []
            for (const record of records) written.push(await store.createEntry(book.id, skeletonEntry(record)))
            const counts = countSkeleton(written)
            deps.log.info(`world: skeleton ${mode === 'append' ? 'extended' : 'written'}: ${counts.factions} factions, ${counts.locations} locations, ${counts.conflicts} conflicts in "${book.name}"`)
            return finishSkeleton(chatId, userId, { status: 'written', at: at(), mode, count: written.length, ...counts })
        } catch (error) {
            return finishSkeleton(chatId, userId, { status: 'failed', at: at(), mode, reason: describe(error) })
        } finally {
            running.delete(chatId)
        }
    }

    /** Every entry out of a book, the book left standing; `0` for a book that is not there. */
    async function emptyBook(store: WorldBookStore, name: string): Promise<number> {
        const book = await findBook(store, name)
        if (!book) return 0
        const entries = await store.listEntries(book.id)
        for (const entry of entries) await store.deleteEntry(entry.id)
        return entries.length
    }

    async function purge(request: WorldPurgeRequest): Promise<WorldPurgeResult> {
        const { chatId, userId } = request
        if (running.has(chatId)) throw new Error('A world pass is running for this chat; wait for it to finish.')
        const options = await deps.options(chatId, userId)
        const store = deps.store(userId)
        const worldBookName = campaignBookName(options.prefix, 'World')
        const skeletonBookName = campaignBookName(options.prefix, 'Skeleton')
        const worldCleared = await emptyBook(store, worldBookName)
        const skeletonCleared = request.includeSkeleton ? await emptyBook(store, skeletonBookName) : 0
        // The clock, the watermarks, the window and the last passes go; the
        // user's source text stays -- it is their writing, not history.
        await deps.state.save(chatId, { lastFiredPeriodLabel: '', locationLastAdvanced: {}, activeReports: [], lastRun: undefined, ...(request.includeSkeleton ? { lastSkeleton: undefined } : {}) }, userId)
        deps.log.info(`world: history purged (${worldCleared} reports${request.includeSkeleton ? `, ${skeletonCleared} seeds` : ''})`)
        return { worldBookName, skeletonBookName, worldCleared, skeletonCleared }
    }
}
