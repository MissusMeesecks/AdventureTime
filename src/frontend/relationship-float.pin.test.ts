import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { REL_FLOAT_BASE_Z, REL_FLOAT_LIFETIME_MS, REL_FLOAT_LIFT_Z, REL_FLOAT_SLOT_X_PX, REL_FLOAT_SLOT_Y_PX, REL_FLOAT_STAGGER_MS, RELATIONSHIP_FLOAT_CSS } from './relationship-float.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && existsSync(`${checkout}/src/state/relationship-dom.js`)

describe.skipIf(!available)('the relationship float against the pinned legacy build (78c)', () => {
    it('keeps the legacy’s constants: the stagger, the two slot spacings, the lifetime and the layer’s lift', () => {
        const source = readFileSync(`${checkout}/src/state/relationship-dom.js`, 'utf8')
        expect(source).toContain(`const REL_FLOAT_STAGGER_MS = ${REL_FLOAT_STAGGER_MS};`)
        expect(source).toContain(`const REL_FLOAT_SLOT_Y_PX = ${REL_FLOAT_SLOT_Y_PX};`)
        expect(source).toContain(`const REL_FLOAT_SLOT_X_PX = ${REL_FLOAT_SLOT_X_PX};`)
        expect(source).toContain(`window.setTimeout(cleanup, ${REL_FLOAT_LIFETIME_MS} + Math.min(slot, 4) * REL_FLOAT_STAGGER_MS);`)
        expect(source).toContain(`(Number.isFinite(hostZ) ? hostZ : ${REL_FLOAT_BASE_Z}) + ${REL_FLOAT_LIFT_Z}`)
        // The slot arithmetic and the layer's portal, as the legacy's own test holds them.
        expect(source).toContain('const xOffset = (slot % 3) * REL_FLOAT_SLOT_X_PX + (slot >= 3 ? 8 : 0);')
        expect(source).toContain('const yOffset = slot * REL_FLOAT_SLOT_Y_PX + ((slot % 2) === 1 ? 10 : 0);')
        expect(source).toContain('document.body.appendChild(layer)')
    })

    it('is the legacy’s stylesheet block, rt- to lh-, rule for rule', () => {
        const css = readFileSync(`${checkout}/style.css`, 'utf8')
        const start = css.indexOf('.rt-rel-float-layer {')
        const badges = css.indexOf('Tier Badges', start)
        const end = css.lastIndexOf('/*', badges)
        expect(start).toBeGreaterThan(0)
        let theirs = css.slice(start, end)
            .replace(/rt-rel-float/g, 'lh-rel-float')
            .replace(/--rt-font-mono/g, '--lh-font-mono')
            // The legacy file carries a mis-encoded middle dot and two mis-encoded dashes in comments.
            .replace(/content: '[^']*';/, "content: '·';")
            .replace(/\/\* Friendship [^\n]*\*\//, '/* Friendship: green / red */')
            .replace(/\/\* Affection [^\n]*\*\//, '/* Affection: pink / purple */')
        const normalise = (s: string) => s.replace(/\s+/g, ' ').trim()
        expect(normalise(RELATIONSHIP_FLOAT_CSS)).toBe(normalise(theirs))
    })
})
