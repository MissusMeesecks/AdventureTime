import { describe, expect, it } from 'vitest'

import { ancestorLocationPaths, buildScenePrompt, formatNarrations, type ScenePromptInput } from './scene-prompt.js'

const BASE: ScenePromptInput = {
    path: 'Monastery :: Cloister :: Courtyard',
    content: 'A yard of worn flagstones.',
    ancestors: [
        { path: 'Monastery :: Cloister', content: 'Covered walks.', hasArt: true },
        { path: 'Monastery', content: '', hasArt: false },
    ],
    narrations: ['Dawn. (Location: Courtyard)', 'Sedge waits by the well.'],
    present: [
        { label: 'Thessaly Brook', content: 'Species: Human', isPlayerCharacter: true },
        { label: 'Mother Sedge', content: '', isPlayerCharacter: false },
    ],
    persona: 'A tired knight.',
    narratorDescription: 'A grim fantasy narrator.',
    systemPrompt: 'Draw "{{name}}" at {{path}} in {{wordtarget}} words.',
    wordTarget: 150,
}

describe('the scene picture’s prompt (49)', () => {
    it('lists the ancestors nearest first, as the legacy does', () => {
        expect(ancestorLocationPaths('Monastery :: Cloister :: Courtyard')).toEqual(['Monastery :: Cloister', 'Monastery'])
        expect(ancestorLocationPaths('Morrowfen')).toEqual([])
        expect(ancestorLocationPaths('')).toEqual([])
    })

    it('formats the narrations under Narrator and drops blank ones', () => {
        expect(formatNarrations(['A.', '  ', 'B.'])).toBe('Narrator:\nA.\n\nNarrator:\nB.')
        expect(formatNarrations([])).toBe('')
    })

    it('builds the legacy’s context, in its order and words, and fills the system prompt’s placeholders', () => {
        const { system, user } = buildScenePrompt(BASE)
        expect(system).toBe('Draw "Courtyard" at Monastery :: Cloister :: Courtyard in 150 words.')
        expect(user.split('\n\n---\n\n')).toEqual([
            'Location Path: Monastery :: Cloister :: Courtyard',
            'Location Lorebook Entry (PRIMARY — depict this specific place):\nA yard of worn flagstones.',
            'Parent Location Chain (style/theme guides only — generate a DISTINCT image for "Monastery :: Cloister :: Courtyard", not a duplicate of a parent):\n'
                + 'Immediate parent: "Monastery :: Cloister"\nCovered walks.\n(Reference scene art exists for this parent — match its palette, architecture, era, materials, and atmosphere.)',
            'Recent Narrator Output (last 2 replies — use for mood, staging, and moment):\nNarrator:\nDawn. (Location: Courtyard)\n\nNarrator:\nSedge waits by the well.',
            'Characters Present Now (include in the scene):\n### Player Character: Thessaly Brook\nSpecies: Human\n\n### Mother Sedge\n(No lore content — infer appearance from name and scene context.)',
            'User Persona (for art style context):\nA tired knight.',
            'Narrator Card Description (for world context):\nA grim fantasy narrator.',
        ])
    })

    it('leaves out what is empty, keeps the last two replies, cuts to the legacy’s limits, and labels a far ancestor', () => {
        const { system, user } = buildScenePrompt({
            ...BASE,
            content: '  ',
            ancestors: [{ path: 'Monastery :: Cloister', content: '', hasArt: false }, { path: 'Monastery', content: 'x'.repeat(1000), hasArt: false }],
            narrations: ['one', 'two', 'three'],
            present: [{ label: 'Thessaly Brook', content: '', isPlayerCharacter: true }],
            persona: '',
            narratorDescription: 'y'.repeat(2000),
            systemPrompt: 'Draw {{name}} in {{wordtarget}} words.',
            wordTarget: 0,
        })
        expect(system).toBe('Draw Courtyard in 200 words.')
        const parts = user.split('\n\n---\n\n')
        expect(parts[0]).toBe('Location Path: Monastery :: Cloister :: Courtyard')
        expect(parts[1]).toBe(`Parent Location Chain (style/theme guides only — generate a DISTINCT image for "Monastery :: Cloister :: Courtyard", not a duplicate of a parent):\nAncestor: "Monastery"\n${'x'.repeat(900)}`)
        expect(parts[2]).toBe('Recent Narrator Output (last 2 replies — use for mood, staging, and moment):\nNarrator:\ntwo\n\nNarrator:\nthree')
        expect(parts[3]).toBe('Characters Present Now (include in the scene):\n### Player Character: Thessaly Brook\n(No PC bio — infer appearance from recent narrator output and scene context.)')
        expect(parts[4]).toBe(`Narrator Card Description (for world context):\n${'y'.repeat(1500)}`)
        expect(parts).toHaveLength(5)
        // Nothing at all but the path.
        expect(buildScenePrompt({ ...BASE, content: '', ancestors: [], narrations: [], present: [], persona: '', narratorDescription: '' }).user).toBe('Location Path: Monastery :: Cloister :: Courtyard')
    })
})
