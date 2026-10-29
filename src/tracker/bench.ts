/**
 * Benching: `[BENCH]` and `[UNBENCH]`, and what they do to the roster.
 *
 * Multihog's party benching (README highlight; roadmap row 4): a companion
 * who is away -- scouting, captured, recovering, sent on a side task -- moves
 * out of `[PARTY]` into `[BENCHED PARTY]` while reunion remains plausible,
 * and back when the story brings them back on-screen. The tracker is told to
 * emit lean commands and never stat sheets; **code moves the full sheet**,
 * which is the promise the `benched party` module makes in its own prompt and
 * the one Phase 12 switched the module off for breaking (lesson: a switch
 * that reads on and does nothing). This is the code.
 *
 * A port of the benching half of the legacy `memo-processor.js`:
 *
 * - `extractBenchCommands` -- the commands in a pass's output, a leading list
 *   bullet tolerated because models add one.
 * - `applyBenchCommands` -- splice the member's full entry between the two
 *   blocks, stamping `Status: Benched (<time>, <reason>)` on the way out and
 *   `Status: Healthy` on the way back. Stats come from the pass's own output
 *   first and the prior memo second, because the tracker may already have
 *   dropped the member from `[PARTY]` on the same turn.
 * - `hydratePartyRelocationStats` -- after any merge, a member the tracker
 *   listed with a bare header (name and status, no `Combat:` line) gets their
 *   full sheet back from the prior memo. The tracker only ever sees the
 *   compact roster, so this is what keeps the sheets from evaporating.
 * - `compactBenchedPartyForContext` -- the roster as the models see it: name
 *   and status per benched member, never the sheet. For context only; never
 *   for the persisted memo.
 *
 * Every function is pure and `bench.pin.test.ts` holds each to the legacy
 * source. The member-entry grammar (`splitPartyMemberEntries`) is the
 * legacy's exactly, quirks included: a header is `Name (Class): X/Y HP` or a
 * compact `Name: Benched (...)`, never a sub-field like `Combat:`.
 */

import { ERASURE_SENTINEL_RE } from './memo.js'
import { extractCurrentTimeStr } from './time.js'

export interface BenchCommands {
    benches: Array<{ name: string; reason: string }>
    unbenches: string[]
}

export interface PartyMemberEntry {
    name: string
    lines: string[]
}

const LEADING_BULLET_RX = /^\s*[-*+•–—]\s*(?=\[)/
const BENCH_CMD_RX = /^\[BENCH\]\s*(.+?)(?:\s*[—–-]\s*(.+))?$/i
const UNBENCH_CMD_RX = /^\[UNBENCH\]\s*(.+)$/i

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripLeadingBullet(line: string): string {
    return line.replace(LEADING_BULLET_RX, '')
}

/** The `[BENCH]`/`[UNBENCH]` lines anywhere in a pass's output. */
export function extractBenchCommands(aiOutput: string | null | undefined): BenchCommands {
    const benches: BenchCommands['benches'] = []
    const unbenches: string[] = []
    for (const line of (aiOutput || '').split('\n')) {
        const trimmed = stripLeadingBullet(line.trim())
        const bench = trimmed.match(BENCH_CMD_RX)
        if (bench) {
            benches.push({ name: bench[1]!.trim(), reason: (bench[2] || '').trim() })
            continue
        }
        const unbench = trimmed.match(UNBENCH_CMD_RX)
        if (unbench) unbenches.push(unbench[1]!.trim())
    }
    return { benches, unbenches }
}

/** A `[BENCHED PARTY]` block that holds only commands, which the merge must not store as text. */
export function isBenchCommandOnlyContent(content: string | null | undefined): boolean {
    if (!content || ERASURE_SENTINEL_RE.test(content.trim())) return false
    const lines = content.trim().split('\n').map((l) => stripLeadingBullet(l.trim())).filter(Boolean)
    if (!lines.length) return false
    return lines.every((l) => /^\[(?:BENCH|UNBENCH)\]/i.test(l))
}

// ── the member-entry grammar ──────────────────────────────────────────────

const PARTY_MEMBER_MARKER_TOKEN = '(?:\\(\\([^)]*\\)\\)\\s*)*'
const PARTY_MEMBER_HEADER_RX = new RegExp(
    `^\\s*[-*+•–—]?(?:\\s+)?(.+?):\\s*${PARTY_MEMBER_MARKER_TOKEN}([+-]?[\\d,]+)(?:\\/([\\d,]+))?\\s*HP\\b`,
    'i',
)
const PARTY_MEMBER_COMPACT_HEADER_RX = /^\s*[-*+•–—]?(?:\s+)?(.+?):\s*(Benched\s*\([^)]*\)|Benched\b.*)$/i
const PARTY_SUBFIELD_LABELS = /^(Combat|Gear|Proficiencies|Attr|Saves|Skills|Traits|Abilities|Spells|HD|Status):/i
const BULLET_PREFIX_RX = /^\s*[-*+•–—](?:\s+|(?=[A-Za-z]))/

function isPartyMemberHeaderLine(line: string): boolean {
    const trimmed = line.trim().replace(BULLET_PREFIX_RX, '')
    if (PARTY_SUBFIELD_LABELS.test(trimmed)) return false
    return PARTY_MEMBER_HEADER_RX.test(trimmed) || PARTY_MEMBER_COMPACT_HEADER_RX.test(trimmed)
}

/** A `[PARTY]` or `[BENCHED PARTY]` block as member entries, each with its lines. */
export function splitPartyMemberEntries(blockContent: string | null | undefined): PartyMemberEntry[] {
    if (!blockContent || ERASURE_SENTINEL_RE.test(blockContent.trim())) return []
    const entries: PartyMemberEntry[] = []
    let currentName: string | null = null
    let currentLines: string[] = []

    const headerName = (line: string): string | null => {
        const trimmed = line.trim().replace(BULLET_PREFIX_RX, '')
        if (!isPartyMemberHeaderLine(line)) return null
        const hp = trimmed.match(PARTY_MEMBER_HEADER_RX)
        if (hp) return hp[1]!.trim()
        const compact = trimmed.match(PARTY_MEMBER_COMPACT_HEADER_RX)
        if (compact) return compact[1]!.trim()
        return null
    }

    for (const rawLine of blockContent.split('\n')) {
        if (!rawLine.trim()) continue
        const name = headerName(rawLine)
        if (name !== null) {
            if (currentName) entries.push({ name: currentName, lines: [...currentLines] })
            currentName = name
            currentLines = [rawLine.trim().replace(BULLET_PREFIX_RX, '')]
            continue
        }
        if (currentName) currentLines.push(rawLine.trim())
    }
    if (currentName) entries.push({ name: currentName, lines: [...currentLines] })
    return entries
}

function memberNameKey(name: string | null | undefined): string {
    return (name || '').trim().toLowerCase()
}

function resolveMemberEntry(entries: PartyMemberEntry[], queryName: string): PartyMemberEntry | null {
    const q = (queryName || '').trim().toLowerCase()
    if (!q) return null
    for (const entry of entries) if (memberNameKey(entry.name) === q) return entry
    for (const entry of entries) {
        const nk = memberNameKey(entry.name)
        if (nk.startsWith(q + ' ') || nk.startsWith(q + '(')) return entry
        if (entry.name.toLowerCase().startsWith(q)) return entry
    }
    return resolveByWord(entries, q)
}

/**
 * The words a member is known by: the header name before its class, split.
 *
 * `Advisor Oswin (Expert 1)` is `advisor`, `oswin`. The parenthesis is the
 * class, never a name, so it is not searched -- `[BENCH] Expert` moves nobody.
 */
function memberNameWords(name: string): string[] {
    return memberNameKey(name).replace(/\s*\(.*$/, '').split(/\s+/).filter(Boolean)
}

/**
 * A member every word of the query names, when exactly one does.
 *
 * Not the legacy's, which matches a command against the *start* of a header
 * only: `[BENCH] Oswin` found nobody on a roster that listed him as `Advisor
 * Oswin`, silently, in the first live bench (Phase 29b). The narrator calls
 * a companion by the name the story uses; the tracker files them under the
 * header it was given; this is the gap between the two. Tried only after the
 * legacy's rules have found nothing, so every input the legacy resolves still
 * resolves to the same member, and it refuses an ambiguous word -- `Guard`
 * against `Tom Guard` and `Ann Guard` moves neither -- because moving the
 * wrong companion is worse than moving none and saying so.
 */
function resolveByWord(entries: PartyMemberEntry[], query: string): PartyMemberEntry | null {
    const wanted = query.replace(/\s*\(.*$/, '').split(/\s+/).filter(Boolean)
    if (!wanted.length) return null
    const hits = entries.filter((entry) => {
        const words = memberNameWords(entry.name)
        return wanted.every((w) => words.includes(w))
    })
    return hits.length === 1 ? hits[0]! : null
}

function rebuildPartyBlockContent(entries: PartyMemberEntry[]): string {
    return entries
        .map((entry) => {
            const lines = [...entry.lines]
            if (lines.length && !/^-/.test(lines[0]!)) lines[0] = `- ${lines[0]}`
            return lines.join('\n')
        })
        .join('\n')
}

function removeMemberFromBlock(
    blockContent: string,
    queryName: string,
): { blockContent: string; removed: PartyMemberEntry | null; empty: boolean } {
    const entries = splitPartyMemberEntries(blockContent)
    const removed = resolveMemberEntry(entries, queryName)
    if (!removed) return { blockContent, removed: null, empty: false }
    const remaining = entries.filter((e) => e !== removed)
    return { blockContent: rebuildPartyBlockContent(remaining), removed, empty: !remaining.length }
}

function setEntryStatus(entry: PartyMemberEntry, statusText: string): PartyMemberEntry {
    const lines = [...entry.lines]
    const idx = lines.findIndex((l) => /^status:/i.test(l))
    const newLine = `Status: ${statusText}`
    if (idx >= 0) lines[idx] = newLine
    else lines.push(newLine)
    return { name: entry.name, lines }
}

function clearBenchedStatus(entry: PartyMemberEntry): PartyMemberEntry {
    const lines = [...entry.lines]
    const idx = lines.findIndex((l) => /^status:/i.test(l))
    if (idx >= 0 && /benched\s*\(/i.test(lines[idx]!)) lines[idx] = 'Status: Healthy'
    return { name: entry.name, lines }
}

// ── block plumbing, the legacy's own ──────────────────────────────────────

function parseMemoBlockContent(memo: string, tag: string): string | null {
    const re = new RegExp(`\\[${escapeRegex(tag)}\\]([\\s\\S]*?)\\[\\/${escapeRegex(tag)}\\]`, 'i')
    const m = (memo || '').match(re)
    return m ? m[1]!.trim() : null
}

function blockContentFromMemo(memo: string, tag: string): string {
    return parseMemoBlockContent(memo, tag) ?? ''
}

function stripMemoBlock(memo: string, tag: string): string {
    const re = new RegExp(`\\s*\\[${escapeRegex(tag)}\\][\\s\\S]*?\\[\\/${escapeRegex(tag)}\\]`, 'i')
    return (memo || '').replace(re, '').replace(/\n{3,}/g, '\n\n').trim()
}

function replaceMemoBlock(memo: string, tag: string, innerContent: string): string {
    const re = new RegExp(`\\s*\\[${escapeRegex(tag)}\\][\\s\\S]*?\\[\\/${escapeRegex(tag)}\\]`, 'i')
    const block = `[${tag}]\n${innerContent}\n[/${tag}]`
    if (re.test(memo)) return memo.replace(re, () => '\n\n' + block).replace(/\n{3,}/g, '\n\n').trim()
    return (memo ? memo.trimEnd() + '\n\n' : '') + block
}

function getBenchTimestamp(memo: string): string {
    return extractCurrentTimeStr(parseMemoBlockContent(memo, 'TIME')) || ''
}

function findMemberEntry(blockContent: string, queryName: string): PartyMemberEntry | null {
    if (!blockContent) return null
    return resolveMemberEntry(splitPartyMemberEntries(blockContent), queryName)
}

function benchedMemberKeys(memo: string): Set<string> {
    const content = blockContentFromMemo(memo, 'BENCHED PARTY')
    if (!content || ERASURE_SENTINEL_RE.test(content.trim())) return new Set()
    return new Set(splitPartyMemberEntries(content).map((e) => memberNameKey(e.name)))
}

/** The names on the benched roster, for telling one memo's roster from another's. */
export function benchedNames(memo: string): string[] {
    const content = blockContentFromMemo(memo || '', 'BENCHED PARTY')
    if (!content || ERASURE_SENTINEL_RE.test(content.trim())) return []
    return splitPartyMemberEntries(content).map((e) => e.name)
}

/** No member in both blocks: benched wins. */
export function dedupePartyAgainstBenched(memo: string): string {
    const benchedKeys = benchedMemberKeys(memo)
    if (!benchedKeys.size) return memo
    const partyContent = blockContentFromMemo(memo, 'PARTY')
    if (!partyContent) return memo
    const rawEntries = splitPartyMemberEntries(partyContent)
    // Content with no recognisable member header is an unknown format: leave it.
    if (!rawEntries.length) return memo
    const entries = rawEntries.filter((e) => !benchedKeys.has(memberNameKey(e.name)))
    if (!entries.length) return stripMemoBlock(memo, 'PARTY')
    return replaceMemoBlock(memo, 'PARTY', rebuildPartyBlockContent(entries))
}

/**
 * The commands that name nobody: no member on either roster of `memo` answers
 * to the name, by any of the rules above.
 *
 * `applyBenchCommands` skips such a command without a word, as the legacy
 * does, and the first live bench was exactly that: the report read *updated
 * PARTY* and Oswin stayed where he was. Read against the merged memo, after
 * the commands have been applied, so a member who *did* move is found on the
 * roster they moved to and is not reported.
 */
export function unmatchedBenchCommands(memo: string, commands: BenchCommands): string[] {
    const party = blockContentFromMemo(memo || '', 'PARTY')
    const benched = blockContentFromMemo(memo || '', 'BENCHED PARTY')
    const names = [...(commands?.benches ?? []).map((b) => b.name), ...(commands?.unbenches ?? [])]
    const unmatched: string[] = []
    for (const name of names) {
        if (!name.trim()) continue
        if (findMemberEntry(party, name) || findMemberEntry(benched, name)) continue
        if (!unmatched.some((n) => memberNameKey(n) === memberNameKey(name))) unmatched.push(name)
    }
    return unmatched
}

/** Apply the commands by splicing full entries between `[PARTY]` and `[BENCHED PARTY]`. */
export function applyBenchCommands(priorMemo: string, memo: string, commands: BenchCommands): string {
    if (!commands?.benches?.length && !commands?.unbenches?.length) return memo || ''

    let result = memo || ''
    const timeStr = getBenchTimestamp(result) || getBenchTimestamp(priorMemo)

    for (const { name, reason } of commands.benches) {
        const resultParty = blockContentFromMemo(result, 'PARTY')
        const priorParty = blockContentFromMemo(priorMemo, 'PARTY')
        let removed: PartyMemberEntry | null = null

        if (findMemberEntry(resultParty, name)) {
            const { blockContent: newParty, removed: r, empty } = removeMemberFromBlock(resultParty, name)
            removed = r
            if (empty) result = stripMemoBlock(result, 'PARTY')
            else if (r) result = replaceMemoBlock(result, 'PARTY', newParty)
        } else if (priorParty) {
            // The tracker may already have dropped them from a same-turn [PARTY] output.
            ;({ removed } = removeMemberFromBlock(priorParty, name))
        }

        if (!removed) continue

        const statusText = reason
            ? `Benched (${timeStr || 'unknown time'}, ${reason})`
            : `Benched (${timeStr || 'unknown time'})`
        const benchedEntry = setEntryStatus(removed, statusText)

        const benchedContent = blockContentFromMemo(result, 'BENCHED PARTY') || blockContentFromMemo(priorMemo, 'BENCHED PARTY')
        const benchedEntries = splitPartyMemberEntries(benchedContent).filter(
            (e) => memberNameKey(e.name) !== memberNameKey(benchedEntry.name),
        )
        benchedEntries.push(benchedEntry)
        result = replaceMemoBlock(result, 'BENCHED PARTY', rebuildPartyBlockContent(benchedEntries))
    }

    for (const name of commands.unbenches) {
        const resultBenched = blockContentFromMemo(result, 'BENCHED PARTY')
        const priorBenched = blockContentFromMemo(priorMemo, 'BENCHED PARTY')
        let removed: PartyMemberEntry | null = null
        let newBenched = resultBenched

        if (findMemberEntry(resultBenched, name)) {
            const attempt = removeMemberFromBlock(resultBenched, name)
            removed = attempt.removed
            newBenched = attempt.blockContent
        } else if (priorBenched) {
            ;({ removed, blockContent: newBenched } = removeMemberFromBlock(priorBenched, name))
        }

        if (!removed) continue

        if (!newBenched || !splitPartyMemberEntries(newBenched).length) result = stripMemoBlock(result, 'BENCHED PARTY')
        else result = replaceMemoBlock(result, 'BENCHED PARTY', newBenched)

        const partyEntry = clearBenchedStatus(removed)
        const resultParty = blockContentFromMemo(result, 'PARTY')

        // Already back in [PARTY] by the tracker's own hand: leave the roster; hydrate fixes the stats.
        if (findMemberEntry(resultParty, name)) continue

        // Never from the prior [PARTY]: a same-turn [BENCH] may have removed
        // members, and the prior roster would resurrect them as duplicates.
        const partyEntries = splitPartyMemberEntries(resultParty).filter(
            (e) => memberNameKey(e.name) !== memberNameKey(partyEntry.name),
        )
        partyEntries.push(partyEntry)
        result = replaceMemoBlock(result, 'PARTY', rebuildPartyBlockContent(partyEntries))
    }

    return dedupePartyAgainstBenched(result)
}

function entryText(entry: PartyMemberEntry): string {
    return entry.lines.join('\n')
}

function isFullPartyStatEntry(text: string): boolean {
    return /Combat:/i.test(text)
}

function buildMemberLookup(blockContent: string | null): Map<string, PartyMemberEntry> {
    const map = new Map<string, PartyMemberEntry>()
    for (const entry of splitPartyMemberEntries(blockContent)) map.set(memberNameKey(entry.name), entry)
    return map
}

/**
 * The compact roster the models see: name and status per benched member.
 * For context only -- never the persisted memo. With the module off the
 * block is left out entirely.
 */
export function compactBenchedPartyForContext(memo: string, moduleEnabled = true): string {
    if (!moduleEnabled) return stripMemoBlock(memo, 'BENCHED PARTY')

    const content = parseMemoBlockContent(memo, 'BENCHED PARTY')
    if (!content || ERASURE_SENTINEL_RE.test(content)) return memo || ''

    const compactLines: string[] = []
    for (const entry of splitPartyMemberEntries(content)) {
        let status = ''
        for (const line of entry.lines) {
            if (/^status:/i.test(line)) {
                status = line.replace(/^status:\s*/i, '').trim()
                break
            }
        }
        if (!status) {
            const inline = entry.lines[0]?.match(/:\s*(Benched\s*\([^)]*\)|Benched\b.*)$/i)
            status = inline ? inline[1]!.trim() : 'Benched'
        }
        compactLines.push(`- ${entry.name}: ${status}`)
    }

    if (!compactLines.length) return memo || ''
    return replaceMemoBlock(memo, 'BENCHED PARTY', compactLines.join('\n'))
}

/**
 * After a merge, give a member listed by a bare header their full sheet back
 * from the prior memo. Both blocks; a block whose content parses to no member
 * at all is left exactly as the model wrote it rather than emptied.
 */
export function hydratePartyRelocationStats(priorMemo: string, mergedMemo: string): string {
    if (!priorMemo || !mergedMemo) return mergedMemo || ''

    const priorParty = buildMemberLookup(parseMemoBlockContent(priorMemo, 'PARTY'))
    const priorBenched = buildMemberLookup(parseMemoBlockContent(priorMemo, 'BENCHED PARTY'))

    let result = mergedMemo
    for (const tag of ['PARTY', 'BENCHED PARTY']) {
        const content = parseMemoBlockContent(result, tag)
        if (!content) continue
        if (ERASURE_SENTINEL_RE.test(content.trim())) continue

        const rawEntries = splitPartyMemberEntries(content)
        if (!rawEntries.length) continue

        const hydrated = rawEntries.map((entry) => {
            const text = entryText(entry)
            if (isFullPartyStatEntry(text)) return entry

            const key = memberNameKey(entry.name)
            const full = priorBenched.get(key) || priorParty.get(key)
            if (!full || !isFullPartyStatEntry(entryText(full))) return entry

            const fullLines = [...full.lines]
            if (tag === 'BENCHED PARTY') {
                const statusIdx = fullLines.findIndex((l) => /^status:/i.test(l))
                const newStatus = entry.lines.find((l) => /^status:/i.test(l)) || entry.lines.find((l) => /Benched\s*\(/i.test(l))
                if (newStatus) {
                    const statusVal = newStatus.replace(/^status:\s*/i, '').trim()
                    if (statusIdx >= 0) fullLines[statusIdx] = `Status: ${statusVal}`
                    else fullLines.push(`Status: ${statusVal}`)
                }
            } else {
                const statusIdx = fullLines.findIndex((l) => /^status:/i.test(l))
                if (statusIdx >= 0 && /Benched\s*\(/i.test(fullLines[statusIdx]!)) fullLines[statusIdx] = 'Status: Healthy'
            }
            return { name: entry.name, lines: fullLines }
        })

        const rebuilt = hydrated
            .map((e) => {
                const lines = [...e.lines]
                if (lines.length && !/^-/.test(lines[0]!)) lines[0] = `- ${lines[0]}`
                return lines.join('\n')
            })
            .join('\n')

        result = replaceMemoBlock(result, tag, rebuilt)
    }
    return result
}
