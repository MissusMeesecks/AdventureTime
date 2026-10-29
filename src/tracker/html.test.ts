import { describe, expect, it } from 'vitest'

import { decodeHtml, escapeHtml, escapeHtmlWithColor, highlightNumbers, highlightParens, splitSmart } from './html.js'

describe('escapeHtml', () => {
    it('escapes the four characters that can break out of markup', () => {
        expect(escapeHtml('<b a="1">&</b>')).toBe('&lt;b a=&quot;1&quot;&gt;&amp;&lt;/b&gt;')
    })

    it('round-trips through decodeHtml', () => {
        const original = '<font color="red">Bob & "Alice"</font>'
        expect(decodeHtml(escapeHtml(original))).toBe(original)
    })
})

describe('escapeHtmlWithColor', () => {
    it('keeps an author-written font colour as a span', () => {
        expect(escapeHtmlWithColor('<font color="#ff0000">Hostile</font>')).toBe(
            '<span style="color:#ff0000">Hostile</span>',
        )
    })

    it('colours everything after a rarity tag and hides the tag itself', () => {
        expect(escapeHtmlWithColor('[Epic] Sword')).toBe('<span style="color:#a335ee">Sword</span>')
    })

    it('nests a font tag inside a rarity tag', () => {
        expect(escapeHtmlWithColor('[Rare] a <font color="lime">b</font>')).toBe(
            '<span style="color:#0070dd">a <span style="color:lime">b</span></span>',
        )
    })

    it('escapes every other tag, including one hidden inside a font tag', () => {
        expect(escapeHtmlWithColor('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
        expect(escapeHtmlWithColor('<font color="red"><img src=x onerror=y></font>')).toBe(
            '<span style="color:red">&lt;img src=x onerror=y&gt;</span>',
        )
    })

    it('rejects a colour that is not a hex value or a bare name', () => {
        // The pattern simply does not match, so the whole thing is escaped.
        const out = escapeHtmlWithColor('<font color="red;background:url(evil)">x</font>')
        expect(out).not.toContain('<span')
        expect(out).toContain('&lt;font')
    })

    it('cannot be tricked by literal placeholder characters in the memo', () => {
        // The legacy build substituted spans[0] here, printing "undefined" or
        // repeating an unrelated span. We strip the reserved characters first.
        expect(escapeHtmlWithColor('\x010\x02')).toBe('0')
        expect(escapeHtmlWithColor('<font color="lime">a</font>\x010\x02')).toBe(
            '<span style="color:lime">a</span>0',
        )
    })

    it('returns empty for empty input', () => {
        expect(escapeHtmlWithColor('')).toBe('')
    })
})

describe('highlighting', () => {
    it('wraps parentheticals', () => {
        expect(highlightParens('Steady (for now)')).toBe('Steady <span class="rt-paren-highlight">(for now)</span>')
    })

    it('wraps numbers but leaves markup alone', () => {
        expect(highlightNumbers('<span class="a1">+5</span>')).toBe(
            '<span class="a1"><span class="rt-paren-highlight">+5</span></span>',
        )
    })
})

describe('splitSmart', () => {
    it('splits on top-level commas', () => {
        expect(splitSmart('Rage, Reckless Attack')).toEqual(['Rage', 'Reckless Attack'])
    })

    it('keeps a comma inside parentheses', () => {
        expect(splitSmart('Rage (2/2, per day), Danger Sense')).toEqual(['Rage (2/2, per day)', 'Danger Sense'])
    })

    it('keeps a thousands separator', () => {
        expect(splitSmart('1,250 gp')).toEqual(['1,250 gp'])
    })
})
