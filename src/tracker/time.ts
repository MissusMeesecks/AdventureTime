/**
 * In-world time, as the tracker writes it and the quest layer reads it.
 *
 * The `[TIME]` block carries a human-authored label — `06:15 AM, Day 4`,
 * `08:00 AM, 01/01/2026`, `Day 4`, `10:00 PM` — and nothing else in the memo is
 * comparable to it. Quest deadlines are written in the same vocabulary, so
 * "is this quest overdue" is a question about two of these strings.
 *
 * `parseInWorldTime` turns one into minutes since an epoch so they can be
 * subtracted. It is deliberately forgiving: the model writes these labels, and
 * a label it garbled should read as "no time here" rather than as a wrong
 * number that silently makes a quest overdue.
 *
 * Ported from `memo-processor.js` at the pinned commit and checked against it
 * by `quests.pin.test.ts`. The odd corners — the year-1 epoch, `Day` counting
 * from 1, a bare time meaning day 1 — are all load-bearing for existing saves.
 */

/**
 * The current-time line out of a `[TIME]` block's contents.
 *
 * The block holds two lines in practice: the current time and a `Last rest:`
 * line. The first line that is not the rest line is the time, with any
 * `Time:` / `Current time:` prefix stripped.
 */
export function extractCurrentTimeStr(timeBlockContent: string | null | undefined): string {
    if (!timeBlockContent) return ''
    const lines = String(timeBlockContent)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    const timeLine = lines.find((line) => !line.toLowerCase().startsWith('last rest:'))
    if (!timeLine) return ''
    return timeLine.replace(/^(?:current\s+)?time:\s*/i, '').trim()
}

/** The spellings the model uses for "there is no time here". */
export function isRestTimeUnset(str: string | null | undefined): boolean {
    const value = String(str ?? '').trim()
    if (!value) return true
    return /^(?:N\/A|NA|NONE|NEVER|NULL|—|-)$/i.test(value)
}

/** The current time out of a whole memo, or `''` when it has no `[TIME]` block. */
export function currentTimeFromMemo(memo: string | null | undefined): string {
    const match = String(memo ?? '').match(/\[TIME\]([\s\S]*?)\[\/TIME\]/i)
    return match?.[1]?.trim() ?? ''
}

/**
 * An in-world time label as minutes since the epoch, or `null` if it has none.
 *
 * Three shapes of date are accepted, in this order of precedence:
 *
 *   - `01/01/2026` — a calendar date, counted from year 1 January 1. The epoch
 *     is fixed and ancient on purpose: it is independent of any campaign
 *     setting, and every plausible year lands on a large positive number, so
 *     two dates always compare correctly.
 *   - `Day 4` / `D4` — a day counter, which is what most campaigns use. Day 1
 *     is the epoch, hence the `d - 1`.
 *   - neither — day 1, so a bare `10:00 PM` is still comparable within a day.
 *
 * A string with no date *and* no time at all returns `null` rather than 0.
 * That distinction matters: 0 is a real time (day 1, midnight) and `null` means
 * "unknown", which is what stops an unparseable deadline from reading as one
 * that has already passed.
 */
export function parseInWorldTime(str: string | null | undefined): number | null {
    if (!str) return null

    // A whole [TIME] block was passed rather than one line. Take the time out
    // of it, so callers can hand over either.
    let text = String(str)
    if (text.includes('\n')) text = extractCurrentTimeStr(text)
    if (isRestTimeUnset(text)) return null

    const ddmmyy = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d+)\b/)
    const day = text.match(/(?:Day|D)\s*(\d+)/i)
    const time = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i)

    let d = 1
    if (ddmmyy) {
        const dd = parseInt(ddmmyy[1]!, 10)
        const mm = parseInt(ddmmyy[2]!, 10)
        let yy = parseInt(ddmmyy[3]!, 10)
        if (yy < 100) yy += 2000

        // setFullYear rather than the Date constructor: years under 100 are
        // remapped to the 1900s by the constructor, which would fold every
        // ancient-calendar campaign onto the wrong century.
        const dateObj = new Date(0, 0, 1)
        dateObj.setFullYear(yy, mm - 1, dd)
        const epochObj = new Date(0, 0, 1)
        epochObj.setFullYear(1, 0, 1)
        const diffDays = Math.round((dateObj.getTime() - epochObj.getTime()) / (1000 * 60 * 60 * 24))
        d = diffDays + 1
    } else if (day) {
        d = parseInt(day[1]!, 10)
    }

    let h = 0
    let m = 0
    if (time) {
        h = parseInt(time[1]!, 10)
        m = parseInt(time[2]!, 10)
        if (time[3]) {
            const meridiem = time[3].toUpperCase()
            if (meridiem === 'AM' && h === 12) h = 0
            if (meridiem === 'PM' && h !== 12) h += 12
        }
    }

    if (!ddmmyy && !day && !time) return null
    return (d - 1) * 1440 + h * 60 + m
}

/**
 * A gap in minutes as a human phrase: `2 days 3 hours ago`, `45 minutes left`.
 *
 * `isFuture` picks the suffix rather than being inferred from the sign,
 * because the caller knows which question it is asking. A quest deadline
 * passes `diff > 0` so an overdue one reads `3 hours ago`; an accepted-at
 * timestamp passes `false` unconditionally, because it is always in the past.
 *
 * Zero — and any gap that rounds away to nothing — is `due now` or `just now`
 * rather than `0 minutes`, which reads as a broken clock.
 *
 * Ported from `memo-processor.js` at the pinned commit and checked against it
 * by `quests.pin.test.ts`.
 */
export function formatTimeDiff(diffMinutes: number, isFuture = false): string {
    if (diffMinutes === 0) return isFuture ? 'due now' : 'just now'

    const absDiff = Math.abs(diffMinutes)
    const days = Math.floor(absDiff / 1440)
    const hours = Math.floor((absDiff % 1440) / 60)
    const minutes = absDiff % 60

    const parts: string[] = []
    if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`)
    if (hours > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`)
    if (minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`)

    if (parts.length === 0) return isFuture ? 'due now' : 'just now'

    return isFuture ? `${parts.join(' ')} left` : `${parts.join(' ')} ago`
}
