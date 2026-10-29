import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { NAMES, sliceLegacy } from '../../scripts/extract-agent.mjs'
import { MECHANICAL_TEXT, MODULE_LINE_FRAME } from '../agent/modules.js'
import { createRouterLegacy } from './router-legacy.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && existsSync(`${checkout}/src/state/module-instructions.js`)

describe.skipIf(!available)('the agent\'s legacy pieces against the pinned build (45b)', () => {
    it('is the generated module, byte for byte, from a fresh slice of the checkout', () => {
        expect(readFileSync('src/tracker/router-legacy.js', 'utf8')).toContain(sliceLegacy(checkout!))
        const ours = createRouterLegacy() as unknown as Record<string, unknown>
        for (const name of NAMES) expect(typeof ours[name], name).not.toBe('undefined')
    })

    it('runs the checkout\'s own instruction builders beside ours, the relationship pieces the checkout\'s own (77)', async () => {
        const theirs = await import(/* @vite-ignore */ `${checkout}/src/state/module-instructions.js`) as Record<string, (...args: unknown[]) => unknown>
        const math = await import(/* @vite-ignore */ `${checkout}/src/state/relationship-math.js`) as Record<string, (...args: unknown[]) => unknown>
        const prompts = await import(/* @vite-ignore */ `${checkout}/src/state/relationship-prompts.js`) as Record<string, (...args: unknown[]) => unknown>
        const sections = await import(/* @vite-ignore */ `${checkout}/src/state/schema-sections.js`) as Record<string, unknown>
        const ours = createRouterLegacy({ getNpcRelationshipMax: math.getNpcRelationshipMax as never, buildNpcRelationshipInstruction: prompts.buildNpcRelationshipInstruction as never }) as unknown as Record<string, (...args: unknown[]) => unknown>
        expect(ours.DEFAULT_NPC_SECTIONS).toEqual(sections.DEFAULT_NPC_SECTIONS)
        const custom = [{ id: 'a', name: 'Voice', description: 'How they speak.' }, { id: 'b', name: 'Creed', description: 'What they hold to.' }]
        for (const settings of [{}, { npcCoreSections: custom }, { useDdMmYyFormat: true }, { npcRelationshipBars: true }, { npcRelationshipBars: true, npcRelationshipMax: 60, npcCoreSections: custom, useDdMmYyFormat: true }]) {
            for (const [major, minor, ignore] of [[225, 135, false], [300, 90, false], [225, 135, true]] as const) {
                expect(ours.buildNpcInstruction!(major, minor, ignore, settings)).toBe(theirs.buildNpcInstruction!(major, minor, ignore, settings))
            }
            expect(ours.buildLocInstruction!(settings)).toBe(theirs.buildLocInstruction!(settings))
            expect(ours.buildFacInstruction!(settings)).toBe(theirs.buildFacInstruction!(settings))
        }
    })

    it('runs the checkout\'s own fragments and party reader beside ours', async () => {
        const fragments = await import(/* @vite-ignore */ `${checkout}/src/state/lorebook-runtime-fragments.js`) as Record<string, (...args: unknown[]) => unknown>
        const utils = await import(/* @vite-ignore */ `${checkout}/src/state/router-utils.js`) as Record<string, (...args: unknown[]) => unknown>
        const ours = createRouterLegacy() as unknown as Record<string, (...args: unknown[]) => unknown>
        for (const settings of [{}, { routerCombatProfileGuidanceAgentTemplate: 'mine' }, { routerCombatProfileGuidanceBasicTemplate: '' }]) {
            for (const has of [true, false]) for (const mode of ['agent', 'basic']) {
                expect(ours.resolveCombatProfileGuidance!(settings, has, mode)).toBe(fragments.resolveCombatProfileGuidance!(settings, has, mode))
            }
        }
        for (const memo of ['[PARTY]\n  Kes (Rogue 3): 10/12\n[/PARTY]\ntail', 'no block', '', null, '[party]x[/party]']) {
            expect(ours.extractPartyBlock!(memo)).toBe(utils.extractPartyBlock!(memo))
        }
    })

    it('runs the checkout\'s own fragments, eligible-field rule, timestamp adjuster and category list beside ours (72c)', async () => {
        const fragments = await import(/* @vite-ignore */ `${checkout}/src/state/lorebook-runtime-fragments.js`) as Record<string, (...args: unknown[]) => unknown>
        const utils = await import(/* @vite-ignore */ `${checkout}/src/state/router-utils.js`) as Record<string, (...args: unknown[]) => unknown>
        const ours = createRouterLegacy() as unknown as Record<string, (...args: unknown[]) => unknown>
        for (const settings of [{}, { routerAutoPassRestrictionTemplate: 'auto {{eligibleCoreFields}}', routerManualPassRestrictionTemplate: 'manual {{eligibleCoreFields}}', routerExistingNpcNudgeTemplate: 'nudge' }, { routerManualPassRestrictionTemplate: '' }]) {
            for (const manual of [true, false]) {
                expect(ours.resolveAutoPassRestriction!(settings, manual, 'Species, Flaws')).toBe(fragments.resolveAutoPassRestriction!(settings, manual, 'Species, Flaws'))
            }
            expect(ours.resolveExistingNpcNudge!(settings)).toBe(fragments.resolveExistingNpcNudge!(settings))
        }
        const sections = [{ name: 'Species' }, { name: 'Body' }, { name: 'Worn Equipment' }, { name: 'Personality' }, { name: 'Combat Profile' }, { name: '' }, null]
        for (const list of [sections, [], [{ name: 'Body' }], [{ name: 'Gear' }, { name: 'Appearance/Species' }], 'not a list']) {
            for (const manual of [true, false]) {
                expect(ours.getEligibleCoreFieldNames!(list, manual)).toEqual(utils.getEligibleCoreFieldNames!(list, manual))
            }
        }
        for (const field of ['Body', 'appearance', 'Worn Equipment', 'gear', 'Combat Profile', 'Species', '', null]) {
            for (const fn of ['isAppearanceField', 'isEquipmentField', 'isCombatProfileField']) expect(ours[fn]!(field), `${fn}(${field})`).toBe(utils[fn]!(field))
        }
        const corpus = [
            'EVENT entries use this format:\n  [Day N, HH:MM AM/PM] <one-sentence fact>\nExample: "[Day 1, 11:52] Character signed." [Day 3, 02:00 PM] The forge. 14:00 and 22:00, 10:42 AM, HH:MM AM/PM AM/PM, Day 0, Day X',
            "- Correct: '[Day 2, 10:42 AM] Corruption manifests.\\n[Day 2, 10:44 AM] Sentry targets Rozach.'",
            '', 'no times here',
        ]
        for (const text of corpus) {
            for (const useDdMmYyFormat of [true, false]) for (const use24hTime of [true, false]) {
                expect(ours.adjustPromptTimestamps!(text, { useDdMmYyFormat, use24hTime })).toBe(utils.adjustPromptTimestamps!(text, { useDdMmYyFormat, use24hTime }))
            }
        }
        for (const settings of [{}, { routerModules: { npc: { enabled: true, tag: 'npc' }, loc: { enabled: false, tag: 'LOC' }, world: { enabled: true, tag: 'WORLD' } }, routerCustomTags: [{ tag: ' lore ' }, { tag: 'LORE' }, {}] }]) {
            expect(ours.getEnabledRouterCategoryTags!(settings)).toEqual(utils.getEnabledRouterCategoryTags!(settings))
        }
    })

    it('transcribes the cleanup scan\'s context lines and its no-op lines from router.js (71c)', () => {
        const router = readFileSync(`${checkout}/router.js`, 'utf8')
        for (const fragment of [
            '`## ENTRIES FLAGGED FOR CONSOLIDATION\\n` +',
            '`- ${e.id} | "${e.label}" | ~${e.tokens} tokens | ${e.lines} lines` +',
            "(e.pairs > 0 ? ` | ⚠ ${e.pairs} redundant line pairs` : ` | ✓ low redundancy`)",
            '`\\n\\n## ENTRY CONTENTS\\n` +',
            '`### ${e.id} — "${e.label}"\\n${e.content}`',
            '`Cleanup: targeted entry "${targetEntryId}" not found.`',
            '`Cleanup: no entries exceed the token threshold (${CLEANUP_TOKEN_THRESHOLD}t). Nothing to do.`',
            '`Cleanup: no entries found in the campaign lorebook. Nothing to do.`',
            "const isWorldBook = nameLower.endsWith('_world') || nameLower === 'world';",
            'const tokens = estimateTokens(stripDungeonMapSection(entry.content));',
            'const overThreshold = !useThreshold || tokens >= CLEANUP_TOKEN_THRESHOLD;',
            'flagged.sort((a, b) => b.tokens - a.tokens);',
            'const tokenBuffer = 3000;',
            'const chunkTokenLimit = Math.max(1000, maxContextLimit - tokenBuffer);',
            'if (currentTokens + lineTokens > chunkTokenLimit && currentChunk.length > 0) {',
        ]) expect(router + readFileSync(`${checkout}/index.js`, 'utf8'), fragment).toContain(fragment)
    })

    it('transcribes the module line frame and the two mechanical headings from router.js', () => {
        const router = readFileSync(`${checkout}/router.js`, 'utf8')
        expect(router).toContain(MODULE_LINE_FRAME)
        for (const [key, heading] of Object.entries(MECHANICAL_TEXT)) expect(router, key).toContain(heading)
    })
})
