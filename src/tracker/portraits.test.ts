import { describe, expect, it } from 'vitest'

import {
    isDrawablePortrait,
    lookupPortrait,
    normalizeEntityName,
    portraitFor,
    portraitProblem,
    resolvePortraitSrc,
} from './portraits.js'

describe('normalizing an entity name', () => {
    it('strips the parenthetical the narrator added', () => {
        // The difference between a portrait that appears in combat and one that
        // never does: the model rarely writes the bare name twice running.
        expect(normalizeEntityName('Moth Wraith (a construct of the dream)')).toBe('Moth Wraith')
    })

    it('decodes what came through HTML', () => {
        expect(normalizeEntityName('Wrenna&#39;s Hound')).toBe("Wrenna's Hound")
        expect(normalizeEntityName('Bob &amp; Sons')).toBe('Bob & Sons')
    })

    it('trims', () => {
        expect(normalizeEntityName('  Alice  ')).toBe('Alice')
    })

    it.each([null, undefined, '', '   '])('answers %j with an empty key', (name) => {
        expect(normalizeEntityName(name)).toBe('')
    })
})

describe('finding the portrait for an entity', () => {
    const MAP = { Alice: '/alice.png', 'Guard #2': 'https://example.test/guard.png' }

    it('finds an exact match', () => {
        expect(lookupPortrait(MAP, 'Alice')).toBe('/alice.png')
    })

    it('finds one the narrator shouted', () => {
        expect(lookupPortrait(MAP, 'ALICE')).toBe('/alice.png')
    })

    it('finds one behind a parenthetical', () => {
        expect(lookupPortrait(MAP, 'Alice (the innkeeper)')).toBe('/alice.png')
    })

    it('prefers the exact key when two differ only in case', () => {
        expect(lookupPortrait({ alice: '/lower.png', Alice: '/upper.png' }, 'Alice')).toBe('/upper.png')
    })

    it.each([
        ['an unknown entity', 'Nobody'],
        ['an empty name', ''],
    ])('finds nothing for %s', (_name, entity) => {
        expect(lookupPortrait(MAP, entity)).toBe('')
    })

    it('finds nothing in no map', () => {
        expect(lookupPortrait(undefined, 'Alice')).toBe('')
    })
})

describe('deciding a reference is safe to draw', () => {
    it.each([
        ['a host image path', '/images/alice.png'],
        ['an https URL', 'https://example.test/a.png'],
        ['an http URL', 'http://example.test/a.png'],
        ['an inline image', 'data:image/png;base64,AAAA'],
    ])('allows %s', (_name, src) => {
        expect(isDrawablePortrait(src)).toBe(true)
    })

    it.each([
        ['a script URL', 'javascript:alert(1)'],
        ['a protocol-relative URL', '//evil.test/a.png'],
        ['the backslash spelling of one', String.raw`\\evil.test\a.png`],
        ['a non-image data URL', 'data:text/html;base64,AAAA'],
        ['a scheme we have no reason to trust', 'blob:https://evil.test/abc'],
        ['nothing', ''],
        ['a null', null],
    ])('refuses %s', (_name, src) => {
        // This map is a file a user can edit, so the renderer must not be the
        // thing that decides what goes in an `src`.
        expect(isDrawablePortrait(src)).toBe(false)
    })

    it('roots a host path that arrived without its leading slash', () => {
        // Deliberately widened. It used to be refused as "a bare word", and the
        // refusal was silent: an entity whose stored address took this shape
        // drew the same empty square as an entity nobody had set a picture for.
        // Left as written it would resolve against whatever route the app is
        // showing, so it is rooted rather than passed through.
        expect(resolvePortraitSrc('api/v1/images/abc123?size=sm')).toBe('/api/v1/images/abc123?size=sm')
        expect(resolvePortraitSrc('/api/v1/images/abc123')).toBe('/api/v1/images/abc123')
    })

    it('refuses to draw a stored reference it would not allow', () => {
        expect(portraitFor({ Alice: 'javascript:alert(1)' }, 'Alice')).toBe('')
        expect(portraitFor({ Alice: ' /alice.png ' }, 'Alice')).toBe('/alice.png')
    })
})

describe('saying why an entity has no picture', () => {
    it('separates nobody set one from we refused the one that was set', () => {
        // The whole point: an empty square said both of these, and one of them
        // is our bug.
        expect(portraitProblem('')).toBe('none')
        expect(portraitProblem(null)).toBe('none')
        expect(portraitProblem('javascript:alert(1)')).toBe('unusable')
        expect(portraitProblem('//evil.test/a.png')).toBe('unusable')
    })

    it('reports no problem at all with a reference it will draw', () => {
        expect(portraitProblem('/api/v1/images/abc')).toBe('')
        expect(portraitProblem('api/v1/images/abc')).toBe('')
        expect(portraitProblem('https://example.test/a.png')).toBe('')
    })
})
