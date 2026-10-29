import { describe, expect, it } from 'vitest'

import { buildEntityBlockView, hpColor, type EntityCardView } from './entity-view.js'
import { parseEntityBlock, type EntityHp } from './entities.js'

/** The hp record off a single anchor line, for the colour rules. */
function hp(line: string): EntityHp {
    const tokens = parseEntityBlock(line, 'COMBAT')!
    const entity = tokens.find((t): t is Extract<typeof t, { kind: 'entity' }> => t.kind === 'entity')!.entity
    return entity.hp!
}

function cards(content: string, tag = 'COMBAT'): EntityCardView[] {
    return (buildEntityBlockView(content, tag)?.tokens ?? [])
        .filter((token): token is Extract<typeof token, { kind: 'entity' }> => token.kind === 'entity')
        .map((token) => token.entity)
}

describe('hpColor', () => {
    it('runs healthy, hurt, then in trouble', () => {
        expect(hpColor(hp('X: 20/20 HP'))).toBe('#00ffaa')
        expect(hpColor(hp('X: 10/20 HP'))).toBe('#ffaa00')
        expect(hpColor(hp('X: 2/20 HP'))).toBe('#ff5555')
    })

    it('is neutral when the numbers are unknown', () => {
        // Grey, not red: unreadable is not the same as nearly dead.
        expect(hpColor(hp('X: ?/? HP'))).toBe('#6b7280')
    })

    it('stays the default with a value but no maximum, since there is no ratio', () => {
        expect(hpColor(hp('X: 40 HP'))).toBe('#00ffaa')
    })

    it('lets an explicit marker colour win over the damage colouring', () => {
        // A sub-module author writing ((BARPURPLE)) means it, even at 2/20.
        const explicit = hp('X ((BARPURPLE)) 2/20')
        expect(hpColor(explicit)).toBe(explicit.color)
        expect(hpColor(explicit)).not.toBe('#ff5555')
    })
})

describe('buildEntityBlockView', () => {
    it('labels the bar as written, and drops the slash when there is no maximum', () => {
        expect(cards('Brenna: 12/20 HP')[0]!.hp!.label).toBe('12/20')
        expect(cards('Swarm: 40 HP')[0]!.hp!.label).toBe('40')
        expect(cards('Shadow: ?/? HP')[0]!.hp!.label).toBe('?/?')
    })

    it('runs the hanging lines through the ordinary line parser', () => {
        // The whole point of the layering: the entity grammar says who a line
        // belongs to, the marker grammar says what it looks like.
        const [entity] = cards(['Goblin: 7/12 HP', 'Morale: ((BAR)) 3/10'].join('\n'))
        expect(entity!.lines[0]).toMatchObject({ kind: 'markers' })
    })

    it('scopes a hanging bar to its entity, so two of them do not collide', () => {
        const [a, b] = cards(['A: 1/1 HP', 'Charges: ((BAR)) 1/3', 'B: 1/1 HP', 'Charges: ((BAR)) 2/3'].join('\n'))
        const idOf = (entity: EntityCardView) => {
            const line = entity.lines[0]!
            return line.kind === 'markers' ? line.segments[0]!.barId : null
        }
        expect(idOf(a!)).not.toBe(idOf(b!))
    })

    it('counts the entities for the card header', () => {
        expect(buildEntityBlockView('A: 1/1 HP\nB: 1/1 HP', 'COMBAT')!.count).toBe(2)
    })

    it('gives a side header a word to show', () => {
        const tokens = buildEntityBlockView('ENEMIES:\nGoblin: 7/12 HP', 'COMBAT')!.tokens
        expect(tokens[0]).toEqual({ kind: 'side', side: 'enemies', label: 'Enemies' })
    })

    it('parses a loose line rather than leaving it as a string', () => {
        const tokens = buildEntityBlockView('The mill is burning.\nGoblin: 7/12 HP', 'COMBAT')!.tokens
        expect(tokens[0]).toMatchObject({ kind: 'line', line: { kind: 'text' } })
    })

    it('is null when nothing anchored, so the caller falls back to lines', () => {
        expect(buildEntityBlockView('The room is quiet.', 'COMBAT')).toBeNull()
    })
})

describe('portraits on the cards', () => {
    const COMBAT = ['COMBAT ROUND 1', 'ENEMIES:', 'Moth Wraith (a construct) ((BAR)) 10/10', '  Status: Healthy'].join('\n')

    const firstEntity = (portraits?: Record<string, string>) => {
        const view = buildEntityBlockView(COMBAT, 'COMBAT', { portraits })!
        const token = view.tokens.find((t) => t.kind === 'entity')
        return token && token.kind === 'entity' ? token.entity : null
    }

    it('hangs the picture set for an entity off its card', () => {
        expect(firstEntity({ 'Moth Wraith': '/rat.png' })!.portrait).toBe('/rat.png')
    })

    it('matches the name the narrator wrote, parenthetical and all', () => {
        // The block says "Moth Wraith (a construct)"; the portrait was set for
        // "Moth Wraith". Anything stricter would never find it.
        expect(firstEntity({ 'Moth Wraith': '/rat.png' })!.portrait).toBe('/rat.png')
    })

    it('leaves the card without one when none is set', () => {
        expect(firstEntity()!.portrait).toBe('')
        expect(firstEntity({ Someone: '/else.png' })!.portrait).toBe('')
    })

    it('refuses a reference it would not put in an src', () => {
        expect(firstEntity({ 'Moth Wraith': 'javascript:alert(1)' })!.portrait).toBe('')
    })
})

describe('bar preferences on an entity', () => {
    const COMBAT = ['ENEMIES:', 'Moth Wraith ((BAR)) 7/10'].join('\n')

    const hp = (bars = {}) => {
        const view = buildEntityBlockView(COMBAT, 'COMBAT', { bars })!
        const token = view.tokens.find((t) => t.kind === 'entity')
        return token && token.kind === 'entity' ? token.entity.hp! : null
    }

    it('reads hit points as their own numbers by default', () => {
        expect(hp()!.label).toBe('7/10')
    })

    it('reads them as a percentage when asked', () => {
        expect(hp({ 'COMBAT:Moth Wraith:HP': { showAsPercentage: true } })!.label).toBe('70%')
    })

    it('takes the chosen colour over the health gradient', () => {
        // The gradient is something the renderer invented; someone who
        // recoloured the bar has said what they want to see.
        expect(hp()!.color).not.toBe('#ff8800')
        expect(hp({ 'COMBAT:Moth Wraith:HP': { color: '#ff8800' } })!.color).toBe('#ff8800')
    })

    it('keeps its own text when nothing says what full means', () => {
        const view = buildEntityBlockView('ENEMIES:\nMoth Wraith ((BAR)) 7', 'COMBAT', {
            bars: { 'COMBAT:Moth Wraith:HP': { showAsPercentage: true } },
        })!
        const token = view.tokens.find((t) => t.kind === 'entity')
        const entity = token && token.kind === 'entity' ? token.entity : null
        expect(entity?.hp?.label).toBe('7')
    })
})
