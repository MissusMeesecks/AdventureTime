import { describe, expect, it } from 'vitest'

import { CHANGE_LOG_TEXT, memoChangeLog, memoTokenEstimate, renderChangeLogHtml } from './change-log.js'

describe('the Change Log (78d)', () => {
    it('says there is no memo when both sides are empty, and that one was created when only the old is', () => {
        expect(memoChangeLog('', '')).toEqual({ kind: 'empty', text: CHANGE_LOG_TEXT.none })
        expect(memoChangeLog('', '[A]\nx\n[/A]')).toEqual({ kind: 'empty', text: CHANGE_LOG_TEXT.initial, added: true })
        expect(renderChangeLogHtml(memoChangeLog('', 'x'))).toBe('<span class="lh-delta-added">+ (initial memo created)</span>')
        expect(renderChangeLogHtml(memoChangeLog('', ''))).toBe('<span class="lh-delta-empty">No memo yet.</span>')
    })

    it('lists the removed lines first and the added after, trimmed, blanks and duplicates folded', () => {
        const log = memoChangeLog('[A]\nx\n\n  y  \n[/A]', '[A]\ny\nz\nz\n[/A]')
        expect(log).toEqual({ kind: 'lines', lines: [{ kind: 'removed', text: 'x' }, { kind: 'added', text: 'z' }] })
        expect(renderChangeLogHtml(log)).toBe('<div class="lh-delta-removed">- x</div><div class="lh-delta-added">+ z</div>')
    })

    it('reads a reordering, and a memo that went empty, the legacy\'s way', () => {
        expect(memoChangeLog('a\nb', 'b\na')).toEqual({ kind: 'empty', text: CHANGE_LOG_TEXT.unchanged })
        expect(memoChangeLog('a\nb', '')).toEqual({ kind: 'lines', lines: [{ kind: 'removed', text: 'a' }, { kind: 'removed', text: 'b' }] })
    })

    it('escapes the markup in a line', () => {
        expect(renderChangeLogHtml(memoChangeLog('a', '<b>&"q"')))
            .toBe('<div class="lh-delta-removed">- a</div><div class="lh-delta-added">+ &lt;b&gt;&amp;&quot;q&quot;</div>')
    })

    it('estimates the tokens as the legacy footer does', () => {
        expect(memoTokenEstimate('')).toBe(0)
        expect(memoTokenEstimate('x'.repeat(262))).toBe(100)
        expect(memoTokenEstimate('x'.repeat(2283))).toBe(871)
    })
})
