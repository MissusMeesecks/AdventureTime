// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { CHOICES_BACKINGS, CHOICES_BACKING_CSS, applyChoicesBacking, choicesBackingClass, readChoicesBacking } from './choices-backing.js'

describe('the choice buttons’ backing (74c-ter, 74c-quater)', () => {
    it('reads the three and nothing else, puts the backing on the body as its class beside the theme’s, none for the tint', () => {
        expect(CHOICES_BACKINGS).toEqual(['tinted', 'solid', 'hover'])
        expect(readChoicesBacking('solid')).toBe('solid')
        expect(readChoicesBacking('hover')).toBe('hover')
        expect(readChoicesBacking('tinted')).toBe('tinted')
        expect(readChoicesBacking('glass')).toBe('tinted')
        expect(readChoicesBacking(undefined)).toBe('tinted')
        expect(choicesBackingClass('hover')).toBe('lh-choice-backing-hover')
        const body = document.createElement('div')
        body.classList.add('lh-theme-hacker', 'lh-daynight')
        expect(applyChoicesBacking(body, 'solid')).toBe('solid')
        expect(Array.from(body.classList)).toEqual(['lh-theme-hacker', 'lh-daynight', 'lh-choice-backing-solid'])
        expect(applyChoicesBacking(body, 'hover')).toBe('hover')
        expect(Array.from(body.classList)).toEqual(['lh-theme-hacker', 'lh-daynight', 'lh-choice-backing-hover'])
        expect(applyChoicesBacking(body, 'nonsense')).toBe('tinted')
        expect(Array.from(body.classList)).toEqual(['lh-theme-hacker', 'lh-daynight'])
    })

    it('writes the two rules under the backing’s class alone, on the buttons and their list and nothing else', () => {
        expect(CHOICES_BACKING_CSS).toContain('.lh-choice-backing-solid .lh-choice,\n.lh-choice-backing-hover .lh-choices-list:hover .lh-choice {\n    background: var(--lh-bg, var(--lumiverse-bg, rgba(20, 22, 30, 0.95)));\n}')
        expect(CHOICES_BACKING_CSS).toContain('.lh-choice-backing-hover .lh-choice { transition: background-color 0.2s ease; }')
        // No rule needs the cycle's or a theme's class, and none names anything but the buttons and their list.
        expect(CHOICES_BACKING_CSS).not.toContain('lh-daynight')
        expect(CHOICES_BACKING_CSS).not.toContain('lh-theme')
        const rules = CHOICES_BACKING_CSS.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((block) => block.split('{')[0]!.trim()).filter(Boolean)
        expect(rules).toHaveLength(2)
        for (const selectors of rules) {
            for (const part of selectors.split(',')) expect(part.trim(), part).toMatch(/^\.lh-choice-backing-(solid|hover) (\.lh-choices-list:hover )?\.lh-choice$/)
        }
    })
})
