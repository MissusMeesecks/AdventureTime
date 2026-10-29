/**
 * The character creator's legacy half, held to the pinned source two ways:
 * the generated module must equal a fresh slice of the checkout byte for
 * byte, and the typed face must agree with the checkout's own modules --
 * the ones that import nothing -- over levels, genres, tiers, settings,
 * names, memos and presets. The prompt builder itself imports the host and
 * cannot be run from the checkout; the byte diff holds it, and
 * `creator.test.ts` records what it produces.
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { sliceLegacy } from '../../scripts/extract-creator.mjs'
import { createCreatorLegacy } from './creator-legacy.js'
import { activeBlocks, archetypesForGenre, cardName, WAYS_TEXT, IMPORT_TEXT, checkSheet, DEFAULT_NPC_SECTIONS, DEFAULT_PC_SECTIONS, findPreset, GEAR_TIERS, isCardTarget, normalizeLevel, rollCreatorName, upsertPreset, XP_LEVEL_THRESHOLDS, NO_SHEET_MESSAGE } from './creator.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && existsSync(`${checkout}/character-creator.js`)

type Fn = (...args: never[]) => unknown

describe.skipIf(!available)('the character creator against the pinned legacy build', () => {
    it('is the generated module, byte for byte, from a fresh slice of the checkout', () => {
        expect(readFileSync('src/tracker/creator-legacy.js', 'utf8')).toContain(sliceLegacy(checkout!))
    })

    it('transcribes the other ways\' prompt text from the panel\'s handler, piece for piece (35c)', () => {
        // The handler is a closure over the panel and cannot be sliced; its template text is held here instead.
        const events = readFileSync(`${checkout}/src/ui/panel/card-events.js`, 'utf8')
        const index = readFileSync(`${checkout}/index.js`, 'utf8')
        const source = `${events}\n${index}`
        // The pieces sit inside template literals, where a backslash-n is two characters and a quote may be escaped.
        const asSource = (text: string) => text.replace(/\n/g, '\\n')
        for (const [key, piece] of Object.entries(WAYS_TEXT)) {
            const found = source.includes(asSource(piece)) || source.includes(asSource(piece).replace(/'/g, "\\'"))
            expect(found, `WAYS_TEXT.${key} is not in the legacy source: ${JSON.stringify(piece)}`).toBe(true)
        }
    })

    it('transcribes the import prompts\' text from the import handler, piece for piece (39)', () => {
        // `importPcFromCard` reads the panel and cannot be sliced; its two prompts are multi-line template literals.
        const source = readFileSync(`${checkout}/character-creator.js`, 'utf8')
        const asSource = (text: string) => text.replace(/\n/g, '\\n')
        for (const [key, piece] of Object.entries(IMPORT_TEXT)) {
            const found = source.includes(piece) || source.includes(asSource(piece)) || source.includes(asSource(piece).replace(/'/g, "\\'"))
            expect(found, `IMPORT_TEXT.${key} is not in the legacy source: ${JSON.stringify(piece)}`).toBe(true)
        }
    })

    it('agrees with the checkout\'s own modules over the hints, the blocks, the names, the check and the presets', async () => {
        const constants = (await import(`${checkout}/constants.js`)) as Record<string, Fn>
        const instant = (await import(`${checkout}/src/state/instant-action-instructions.js`)) as Record<string, Fn>
        const names = (await import(`${checkout}/src/state/character-names.js`)) as Record<string, Fn>
        const presets = (await import(`${checkout}/src/features/character-creator/presets.js`)) as Record<string, Fn>
        const sections = (await import(`${checkout}/src/state/schema-sections.js`)) as Record<string, unknown>
        const utils = (await import(`${checkout}/src/state/router-utils.js`)) as Record<string, Fn>
        const identity = (await import(`${checkout}/src/state/player-identity.js`)) as Record<string, Fn>
        const ours = createCreatorLegacy({ getSettings: () => ({}), SillyTavern: { getContext: () => ({}) }, sendStateRequest: async () => '', getCharacterCreationConnectionSettings: () => null, toastr: { warning: () => undefined } }) as unknown as Record<string, Fn>

        expect(XP_LEVEL_THRESHOLDS).toEqual(constants.XP_LEVEL_THRESHOLDS)
        expect(GEAR_TIERS).toEqual(constants.STARTING_GEAR_TIER_OPTIONS)
        expect(DEFAULT_PC_SECTIONS).toEqual(sections.DEFAULT_PC_SECTIONS)
        expect(DEFAULT_NPC_SECTIONS).toEqual(sections.DEFAULT_NPC_SECTIONS)
        for (const level of [0, 1, 2, 3, 5, 7, 10, 11, 16, 20, 25, 'x', 'none', null]) {
            expect(normalizeLevel(level)).toEqual((constants.resolveOnboardingLevelPreference(level as never) as { stored: unknown }).stored)
            expect(ours.getOnboardingLevelXpValues(level as never)).toEqual(constants.getOnboardingLevelXpValues(level as never))
            for (const override of [false, true]) expect(ours.buildOnboardingXpHint(level as never, { allowInitialSetupOverride: override } as never)).toBe(constants.buildOnboardingXpHint(level as never, { allowInitialSetupOverride: override } as never))
            for (const genre of ['fantasy', 'realistic', 'scifi', 'horror', '', undefined]) {
                for (const tier of ['auto', 'mundane', 'low', 'standard', 'well_equipped', 'heroic', 'none', 'golden']) {
                    for (const inventory of [true, false]) {
                        expect(ours.buildStartingGearHint(level as never, genre as never, inventory as never, tier as never)).toBe(constants.buildStartingGearHint(level as never, genre as never, inventory as never, tier as never))
                    }
                }
            }
        }
        for (const [date, time] of [['Day 1', '08:00 AM'], ['14/02/2026', '21:30'], ['Day 3', undefined]]) {
            expect(ours.buildOnboardingTimeHint(date as never, time as never)).toBe(constants.buildOnboardingTimeHint(date as never, time as never))
        }
        expect(ours.buildCombatAndSkillScalingHint()).toBe(constants.buildCombatAndSkillScalingHint())
        const settingsCorpus = [
            { modules: { character: true, inventory: true, party: true, quests: true, combat: true, xp: true, time: false }, customFields: [{ tag: 'hunger', enabled: true }, { tag: 'PARTY', enabled: true }, { tag: 'off', enabled: false }, { tag: 'XP', enabled: true }] },
            { modules: {}, customFields: [] },
            {},
        ]
        for (const settings of settingsCorpus) expect(activeBlocks(settings as never)).toEqual(constants.buildOnboardingActiveBlocks(settings as never))
        for (const genre of ['fantasy', 'realistic', 'scifi', 'horror', 'nonsense']) {
            for (const r of [0, 0.25, 0.5, 0.999]) expect(rollCreatorName(genre as never, () => r)).toBe(names.pickGenreCharacterName(genre as never, (() => r) as never))
            expect(archetypesForGenre(genre).length).toBe(20)
        }
        for (const value of ['', '  A ranger, level 7  ', 'Lv. 12 pilot', '3rd-level cleric', 'level 99 god', 'x'.repeat(1200)]) {
            expect(ours.normalizeInstantActionInstructions(value as never)).toBe(instant.normalizeInstantActionInstructions(value as never))
            expect(ours.extractInstantActionLevel(value as never)).toBe(instant.extractInstantActionLevel(value as never))
            expect(ours.buildInstantActionPromptSection(value as never)).toBe(instant.buildInstantActionPromptSection(value as never))
            expect(ours.buildInstantActionOpeningMessage(value as never)).toBe(instant.buildInstantActionOpeningMessage(value as never))
        }
        for (const [selection, custom] of [['150', ''], ['other', '800'], ['other', '10'], ['other', '9000'], ['x', '']]) {
            expect(ours.resolveInstantActionPlayerCardWords(selection as never, custom as never)).toBe(instant.resolveInstantActionPlayerCardWords(selection as never, custom as never))
        }
        for (const r of [0, 0.5, 0.999]) expect(ours.rollInstantActionLevel((() => r) as never)).toBe(instant.rollInstantActionLevel((() => r) as never))
        // The Player Card's helpers (35b): the agent's target, the field tests, the patcher, the identity.
        for (const id of ['{{user}}', ' Player ', 'pc', 'USER', 'Robin Vale', 'robin vale', 'Oswin', '', null, 7]) {
            for (const name of ['Robin Vale', '', undefined]) expect(isCardTarget(id, name as never)).toBe(!!utils.isPcCoreTarget(id as never, name as never))
        }
        for (const field of ['Body', 'appearance', 'Appearance/Species', 'Worn Equipment', 'gear', 'Equipment', 'Species', 'Personality', 'Combat Profile', '', 'x']) {
            expect(ours.isAppearanceField(field as never)).toBe(utils.isAppearanceField(field as never))
            expect(ours.isEquipmentField(field as never)).toBe(utils.isEquipmentField(field as never))
            expect(ours.isSpeciesField(field as never)).toBe(utils.isSpeciesField(field as never))
            expect(ours.isCombatProfileField(field as never)).toBe(utils.isCombatProfileField(field as never))
            for (const isPc of [true, false]) expect(ours.resolveCoreFieldPatterns(field as never, { isPc } as never)).toEqual(utils.resolveCoreFieldPatterns(field as never, { isPc } as never))
        }
        const bios = [
            'Species: Halfling\nBody: Short, scarred.\nWorn Equipment: A duster.\nPersonality: Wry.\nBackground: Ran with cutpurses.',
            'Appearance/Species: An old-style entry.\nEquipment: Boots.',
            'Personality: Only this.',
            '',
        ]
        for (const bio of bios) {
            for (const field of ['Body', 'Worn Equipment', 'gear', 'appearance', 'Personality', '']) {
                for (const content of ['Tall now.', '']) {
                    expect(ours.patchLabeledSection(bio as never, field as never, content as never, { isPc: true } as never)).toEqual(utils.patchLabeledSection(bio as never, field as never, content as never, { isPc: true } as never))
                }
            }
        }
        for (const name of ['Robin "Vale"', " O'Neil \\ ", '', null, undefined, 7]) {
            expect(cardName(name)).toBe((identity.buildNameOnlyPersonaIdentity(name as never) as { name: string }).name)
            expect(ours.buildNameOnlyPersonaIdentity(name as never)).toEqual(identity.buildNameOnlyPersonaIdentity(name as never))
        }
        for (const [memo] of [['[CHARACTER]\nRobin\n[/CHARACTER]'], [''], [null]]) expect(ours.extractCharacterBlock(memo as never)).toBe(utils.extractCharacterBlock(memo as never))
        // The sheet check is an inline condition in the checkout's character-creator.js
        // at this pin (the 8.66 freeze rolled the tree back to 8.60): the text is
        // held here, and the condition run beside ours over the same cases.
        const creatorSource = readFileSync(`${checkout}/character-creator.js`, 'utf8')
        expect(creatorSource).toContain(NO_SHEET_MESSAGE)
        const condition = '!memoAfter || memoAfter === memoBefore || !/\\[CHARACTER\\]/i.test(memoAfter)'
        expect(creatorSource).toContain(condition)
        const theirsCheck = new Function('memoBefore', 'memoAfter', `return !(${condition})`) as (b: string, a: string) => boolean
        const sheet = '[CHARACTER]\nRobin Vale (Rogue 3)\n[/CHARACTER]'
        for (const [before, after] of [['', sheet], [sheet, sheet], ['', '[TIME]\nx\n[/TIME]'], ['', '']]) {
            expect(checkSheet(before as string, after as string, { changed: true }).ok).toBe(theirsCheck(before as string, after as string))
        }
        expect((checkSheet('', '', { changed: false }) as { reason: string }).reason).toBe(NO_SHEET_MESSAGE)
        let ids = 0
        const createId = (): string => `p${++ids}`
        const list = presets.upsertCharacterCreatorPreset([] as never, 'Rogue' as never, { a: 1 } as never, createId as never) as { presets: unknown[] }
        ids = 0
        expect(upsertPreset([], 'Rogue', { a: 1 } as never, createId)).toEqual(list)
        expect(findPreset(list.presets as never, ' ROGUE ')).toEqual(presets.findCharacterCreatorPresetByName(list.presets as never, ' ROGUE ' as never))
    })
})
