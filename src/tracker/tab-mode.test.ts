/**
 * Tab Mode's face (76): the vitals reader and strip through AdventureTime's
 * readers, and the stylesheet carried onto the tokens.
 */
import { describe, expect, it } from 'vitest'

import { extractPartyVitals, renderPartyVitalsStrip, TAB_MODE_CSS, TAB_MODE_PINNED_TAGS, tabModeCss } from './tab-mode.js'

describe('the vitals', () => {
    it('reads name and HP off a PARTY block, a list dash dropped, the percentage clamped', () => {
        expect(TAB_MODE_PINNED_TAGS).toEqual(['CHARACTER', 'COMBAT'])
        expect(extractPartyVitals('- Alice: 12/20 HP | AC 14\nBob: 5 HP\nCara: 50/20 HP\nNotes: fine')).toEqual([
            { name: 'Alice', cur: 12, max: 20, pct: 60 },
            { name: 'Bob', cur: 5, max: 5, pct: 100 },
            { name: 'Cara', cur: 50, max: 20, pct: 100 },
        ])
        expect(extractPartyVitals(null)).toEqual([])
    })

    it('draws a member as a jump button with the ring coloured by the bar preference and the portrait resolved', () => {
        const strip = renderPartyVitalsStrip('Alice Smith: 12/20 HP\nBob: 3/30 HP', {
            portraits: { 'alice smith': 'https://pics/alice.png' },
            bars: { 'PARTY:Bob:HP': { mode: 'solid', color: '#123456', showAsPercentage: true } },
        })
        expect(strip).toContain('class="rt-vitals-strip"')
        expect(strip).toContain('data-jump-tag="PARTY"')
        expect(strip).toContain('title="Alice Smith: 12/20 HP"')
        expect(strip).toContain('<img class="rt-entity-portrait" src="https://pics/alice.png"')
        expect(strip).toContain('--rt-vitals-pct: 60%')
        expect(strip).toContain('title="Bob: 10/100 HP"')
        expect(strip).toContain('--rt-vitals-ring: #123456')
        expect(strip).toContain('rt-entity-portrait-placeholder')
        expect(strip).toContain('<span class="rt-vitals-name">Alice</span>')
        // Each button carries its member's name for the panel's jump (76-bis), in the reader's order.
        expect([...strip.matchAll(/data-jump-entity="([^"]*)"/g)].map((m) => m[1])).toEqual(['Alice Smith', 'Bob'])
        expect(renderPartyVitalsStrip('Ann "Red" O&#39;Neil: 1/2 HP')).toContain('data-jump-entity="Ann &quot;Red&quot; O&amp;#39;Neil"')
        expect(renderPartyVitalsStrip('Notes only')).toBe('')
        expect(renderPartyVitalsStrip('')).toBe('')
    })
})

describe('the stylesheet', () => {
    it('carries the legacy’s variables onto the tokens and leaves the rest as written', () => {
        expect(tabModeCss('a { color: var(--rt-text-muted); b: var(--rt-accent, #00ffaa); c: var(--rt-bg); d: var(--rt-vitals-ring, #00ffaa); }'))
            .toBe('a { color: var(--lh-text-muted, var(--lumiverse-text-muted, inherit)); b: var(--lh-accent, var(--lumiverse-primary, #d4a940)); c: var(--lh-bg, var(--lumiverse-surface, transparent)); d: var(--rt-vitals-ring, #00ffaa); }')
        for (const name of ['--rt-bg', '--rt-blur', '--rt-text', '--rt-text-muted', '--rt-accent']) expect(TAB_MODE_CSS).not.toMatch(new RegExp(`var\\(${name}[,)]`))
        expect(TAB_MODE_CSS).toContain('.rt-tab-strip {')
        expect(TAB_MODE_CSS).toContain('.rt-tabmode-content {')
    })
})
