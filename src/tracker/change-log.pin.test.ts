/**
 * The Change Log (78d) held to the pin: Multihog's `computeDelta` of
 * `memo-processor.js`, evaluated from its text with the legacy's own
 * `escapeHtml` (the module is a closure over the whole install), runs beside
 * ours over a corpus; the footer's token divisor and the four empty-state
 * texts are read off the legacy's panel files.
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { CHANGE_LOG_TEXT, MEMO_TOKEN_DIVISOR, memoChangeLog, memoTokenEstimate, renderChangeLogHtml } from './change-log.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const SOURCE = 'memo-processor.js'
const MARKUP = 'src/ui/panel/panel-markup.js'
const BUILDER = 'src/ui/panel/panel-builder.js'
const available = !!checkout && [SOURCE, MARKUP, BUILDER].every((file) => existsSync(`${checkout}/${file}`))

/** Cut `export function <name>(` to its closing brace, by brace count. */
function sliceFunction(source: string, name: string): string {
    const start = source.indexOf(`export function ${name}(`)
    if (start < 0) throw new Error(`${name} is not in the source`)
    let depth = 0
    let i = source.indexOf('{', start)
    for (; i < source.length; i++) {
        if (source[i] === '{') depth++
        else if (source[i] === '}' && --depth === 0) break
    }
    return source.slice(start + 'export '.length, i + 1)
}

const CORPUS: Array<[string, string]> = [
    ['', ''],
    ['', '[TIME]\nCurrent Time: 08:41 AM, Day 1\n[/TIME]'],
    ['[TIME]\nCurrent Time: 08:41 AM, Day 1\n[/TIME]', '[TIME]\nCurrent Time: 08:47 AM, Day 1\n[/TIME]'],
    ['[TIME]\nCurrent Time: 08:41 AM, Day 1\n[/TIME]', '[TIME]\nCurrent Time: 08:41 AM, Day 1\n[/TIME]'],
    // A reordering is nothing; a trimmed duplicate folds; blank lines are skipped.
    ['[A]\nx\ny\n[/A]\n\n[B]\nz\n[/B]', '[B]\n  z  \n[/B]\n[A]\ny\nx\nx\n[/A]'],
    // Removed first, then added, each in first-appearance order; the markup escaped.
    ['[INV]\n- Sword <iron> & "shield"\n- Rope\n[/INV]', '[INV]\n- Rope\n- Lantern\n- Sword <steel>\n[/INV]'],
    ['[P]\nAlice: 10/10 HP\n[/P]', ''],
    ['one\r\ntwo', 'two\r\nthree'],
]

describe.skipIf(!available)('the Change Log against the pinned legacy build', () => {
    // Read inside the tests: a skipped suite still runs its describe body.
    const source = () => readFileSync(`${checkout}/${SOURCE}`, 'utf8')
    const legacy = () => new Function(
        `${sliceFunction(source(), 'escapeHtml')}\n${sliceFunction(source(), 'computeDelta')}\nreturn computeDelta`,
    )() as (oldMemo: string, newMemo: string) => string

    it('diffs as the checkout\'s own computeDelta does, over the corpus', () => {
        const legacyDelta = legacy()
        for (const [before, after] of CORPUS) {
            const expected = legacyDelta(before, after).replace(/class="delta-/g, 'class="lh-delta-')
            expect(renderChangeLogHtml(memoChangeLog(before, after)), JSON.stringify([before, after])).toBe(expected)
        }
    })

    it('carries the legacy\'s texts and the footer\'s divisor', () => {
        const markup = readFileSync(`${checkout}/${MARKUP}`, 'utf8')
        const builder = readFileSync(`${checkout}/${BUILDER}`, 'utf8')
        const text = source()
        expect(text).toContain(`'<span class="delta-empty">${CHANGE_LOG_TEXT.none}</span>'`)
        expect(text).toContain(`'<span class="delta-added">${CHANGE_LOG_TEXT.initial}</span>'`)
        expect(text).toContain(`'<span class="delta-empty">${CHANGE_LOG_TEXT.unchanged}</span>'`)
        expect(markup).toContain(`'<span class="delta-empty">${CHANGE_LOG_TEXT.noneYet}</span>'`)
        expect(builder).toContain(`'<span class="delta-empty">${CHANGE_LOG_TEXT.cleared}</span>'`)
        expect(markup).toContain(`~\${Math.round(settings.currentMemo.length / ${MEMO_TOKEN_DIVISOR})} tokens`)
        expect(builder).toContain(`~\${Math.round(newText.length / ${MEMO_TOKEN_DIVISOR})} tokens`)
        expect(memoTokenEstimate('x'.repeat(2283))).toBe(Math.round(2283 / 2.62))
        // The legacy clears the memo with a confirm, and the delta with it.
        expect(builder).toContain('Are you sure you want to clear the memory history and wipe the tracker?')
        expect(markup).toContain('title="Toggle change log"')
        expect(markup).toContain('title="Toggle direct prompt">💬</button>')
        expect(markup).toContain('title="Clear memo and history">CLEAR</button>')
    })
})
