import { describe, expect, it } from 'vitest'

import { buildLibraryPhotoPrompt, LIBRARY_PHOTO_TEXT, PORTRAIT_SIZES, portraitSize } from './library-photo.js'

describe('the photo prompt (60)', () => {
    it('is the name and the entry under the NPC prompt, its placeholders filled, joined as the legacy joins them', () => {
        const { system, user } = buildLibraryPhotoPrompt({ name: 'Kestrel', content: '  [CORE]\nSpecies: Human\n[/CORE]  ', systemPrompt: 'Describe {{name}} in {{wordtarget}} words; {{name}} again.', wordTarget: 120 })
        expect(system).toBe('Describe Kestrel in 120 words; Kestrel again.')
        expect(user).toBe('NPC Name: Kestrel\n\n---\n\nNPC Lorebook Entry:\n[CORE]\nSpecies: Human\n[/CORE]')
    })

    it('stands the name alone when the card has no text, and takes 200 words when the target is missing', () => {
        const { system, user } = buildLibraryPhotoPrompt({ name: 'Orrin', content: '   ', systemPrompt: '{{wordtarget}}', wordTarget: 0 })
        expect(user).toBe(LIBRARY_PHOTO_TEXT.name('Orrin'))
        expect(system).toBe('200')
    })
})

describe('the 2:3 size (60)', () => {
    it('lists exact 2:3 pairs, every side a multiple of 64, smallest first', () => {
        for (const [w, h] of PORTRAIT_SIZES) {
            expect(w * 3).toBe(h * 2)
            expect(w % 64).toBe(0)
            expect(h % 64).toBe(0)
        }
        expect(PORTRAIT_SIZES.map(([w]) => w)).toEqual([...PORTRAIT_SIZES.map(([w]) => w)].sort((a, b) => a - b))
    })

    it('asks a width-and-height provider for the pair nearest the connection\'s own pixel count', () => {
        const schema = { width: { type: 'integer' }, height: { type: 'integer' }, steps: { type: 'integer' } }
        expect(portraitSize(schema, { width: 1024, height: 1024, steps: 30 })).toEqual({ parameters: { width: 896, height: 1344 }, size: '896×1344' })
        expect(portraitSize(schema, { width: 512, height: 512 })).toEqual({ parameters: { width: 512, height: 768 }, size: '512×768' })
        expect(portraitSize(schema, { width: 2048, height: 2048 })).toEqual({ parameters: { width: 1024, height: 1536 }, size: '1024×1536' })
        // No saved size: a 1024 square is assumed.
        expect(portraitSize(schema, {})).toEqual({ parameters: { width: 896, height: 1344 }, size: '896×1344' })
    })

    it('reads the sides off the connection when no schema is known, and asks nothing when neither says', () => {
        expect(portraitSize(null, { width: 768, height: 768 })).toEqual({ parameters: { width: 640, height: 960 }, size: '640×960' })
        expect(portraitSize(null, { width: '1024', height: 1024 })).toEqual({ parameters: {}, size: '', reason: 'the provider takes no width and height' })
        expect(portraitSize({ prompt: { type: 'string' } }, { width: 1024, height: 1024 })).toEqual({ parameters: {}, size: '', reason: 'the provider takes no width and height' })
    })

    it('picks the listed portrait size nearest 2:3 from a size list, and says when the list has none', () => {
        const schema = { size: { type: 'select', options: [{ id: '1024x1024', label: 'Square' }, { id: '1536x1024', label: 'Landscape' }, { id: '1024x1536', label: 'Portrait' }, { id: '1024x1792', label: 'Tall' }] } }
        expect(portraitSize(schema, {})).toEqual({ parameters: { size: '1024x1536' }, size: '1024x1536' })
        expect(portraitSize({ size: { type: 'select', options: [{ id: 'auto', label: '1792 × 1024' }, { id: 'wide', label: 'Wide' }] } }, {})).toEqual({ parameters: {}, size: '', reason: 'the provider lists no portrait size' })
    })
})
