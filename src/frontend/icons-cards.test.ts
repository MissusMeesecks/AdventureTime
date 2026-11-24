// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import { SETTINGS_CATEGORIES } from '../settings/schema.js'
import { CARD_ICONS, setCardIcon } from './icons.js'
import { MAIN_TAB, SETTINGS_TAB } from './layout.js'
import { TAB_GUIDE_MARKDOWN, TAB_GUIDE_TITLE } from './tab-guide.js'

describe('the settings cards’ line icons (96, stage 2g)', () => {
    it('draws the icon a title names, and keeps the emoji for a title the table does not know', () => {
        const known = document.createElement('span')
        setCardIcon(known, 'Cartridges', '💾')
        expect(known.querySelector('svg')!.getAttribute('stroke')).toBe('currentColor')
        expect(known.classList.contains('lh-icon')).toBe(true)
        expect(known.textContent).toBe('')
        const unknown = document.createElement('span')
        setCardIcon(unknown, 'A card nobody listed', '🧪')
        expect(unknown.textContent).toBe('🧪')
        expect(unknown.querySelector('svg')).toBeNull()
    })

    it('gives the State Tracker card an icon of its own, apart from its category’s', () => {
        const category = document.createElement('span')
        const card = document.createElement('span')
        setCardIcon(category, 'State Tracker', '🧠')
        setCardIcon(card, 'State Tracker', '🧠', true)
        expect(card.innerHTML).not.toBe(category.innerHTML)
        expect(CARD_ICONS['State Tracker (card)']).toBeDefined()
    })

    it('has an icon for every category', () => {
        for (const category of SETTINGS_CATEGORIES) expect(CARD_ICONS[category.title], category.title).toBeDefined()
    })
})

describe('the drawer tab’s guide (96, stage 2g; D3)', () => {
    it('is handed to Lumiverse with the tab, names every category and where to start, and repeats no category guide', () => {
        expect(MAIN_TAB.guide).toEqual({ markdown: TAB_GUIDE_MARKDOWN, title: TAB_GUIDE_TITLE })
        expect(SETTINGS_TAB.guide).toEqual(MAIN_TAB.guide)
        for (const category of SETTINGS_CATEGORIES) expect(TAB_GUIDE_MARKDOWN, category.title).toContain(`**${category.title}**`)
        expect(TAB_GUIDE_MARKDOWN).toContain('## Where to start')
        expect(TAB_GUIDE_MARKDOWN).toContain('Instant Action')
        // An overview, not a manual: the steps stay in each category's Quick Start Guide.
        expect(TAB_GUIDE_MARKDOWN.length).toBeLessThan(2400)
        expect(TAB_GUIDE_MARKDOWN).not.toMatch(/Multihog|the host\b|beta\.\d/)
    })
})
