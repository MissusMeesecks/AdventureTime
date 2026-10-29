/**
 * The wizard's legacy half, held to the pinned source two ways: the generated
 * module is byte-identical to a fresh slice of the checkout, and its functions
 * answer as the legacy's do over a corpus. Skips without `MULTIHOG_CHECKOUT`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { sliceContextLegacy, sliceLegacy } from '../../scripts/extract-wizard.mjs'
import { createWizardContext } from './wizard-context.js'
import { createWizardLegacy } from './wizard-legacy.js'
import { buildWizardPreviewMemo, extractWizardTemplate, parseWizardResponse, renderingHints, restoreUserMacro, shieldUserMacro } from './wizard.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && existsSync(`${checkout}/game-systems.js`)

const REPLIES = [
    '<meta name="Heat" icon="🔥" needs_tracker="true" driver_time="true" driver_gm_annotation="false" driver_stated_fact="false" effect_owner="tracker"/>\n<gm_section tag="heat">\nYou track Poppy\'s heat.\n</gm_section>\n<tracker_module tag="HEAT" label="Heat" icon="🔥">\nYou maintain heat.\n[HEAT]\n- Heat: ((BAR)) 10/100\n[/HEAT]\n</tracker_module>',
    '<meta name="Pure Rule" icon="📜" needs_tracker="false"/>\n<gm_section tag="pure rule!">\n<pure_rule>\nNo state.\n</pure_rule>\n</gm_section>',
    '<gm_section>\nNo meta at all.\n</gm_section>\n<tracker_module tag="odd tag" label="Odd">\n```\n[ODD_TAG]\n- X: 1\n</tracker_module>',
    '<meta value_authority="tracker"/><tracker_module tag="LEGACY">old shape</tracker_module>',
    'nothing usable here',
]
const TEMPLATES: Array<[string, string]> = [
    ['You maintain.\n[HEAT]\n- Heat: ((BAR)) 10/100\n[/HEAT]\nmore', 'HEAT'],
    ['[HEAT]\n- open block only', 'heat'],
    ['just prose with no tags at all', 'X'],
    ['[OTHER]\nsomething\n[/OTHER]', 'HEAT'],
    ['```text\n[A_B]\n- a\n[/A_B]\n```', 'a b'],
    ['', 'X'],
]
const NAMES = [['Poppy'], ['Poppy', 'Wrenna'], []]

describe.skipIf(!available)('the wizard against the pinned legacy build', () => {
    it('is the generated module, byte for byte, from a fresh slice of the checkout', () => {
        const committed = readFileSync('src/tracker/wizard-legacy.js', 'utf8')
        const fresh = sliceLegacy(checkout!)
        // Verbatim, unindented: an indent on every line was an indent on every
        // line of the architect prompt (lesson 36).
        expect(committed).toContain(fresh)
        expect(committed).toContain(sliceContextLegacy(checkout!))
    })

    it('builds the module examples and lists the options as the checkout’s own context module does (73g)', async () => {
        const theirs = await import(/* @vite-ignore */ `${checkout}/src/features/game-system-wizard-context.js`) as { listGameSystemWizardModuleExampleOptions(s: unknown): unknown; buildGameSystemWizardModuleExamplesContext(s: unknown): string }
        const constants = await import(/* @vite-ignore */ `${checkout}/constants.js`) as { DEFAULT_STOCK_PROMPTS: Record<string, string>; resolveTimePromptKey(s: unknown): string }
        const ours = createWizardContext(constants.DEFAULT_STOCK_PROMPTS, constants.resolveTimePromptKey as never)
        const settings = {
            modules: { character: true, party: false, combat: true, inventory: true, abilities: true, spells: true, xp: true, time: true, quests: true },
            syspromptModules: { quests: true },
            stockPrompts: { xp: 'XP mine' },
            use24hTime: true,
            customFields: [{ tag: 'heat', label: 'Heat', enabled: true, prompt: 'Track it.', template: 'Heat: 0' }],
            customSyspromptLibrary: [{ id: '9', tag: 'rads', description: 'Game System: Rads', enabled: true, content: '<rads>\nx\n</rads>' }],
            gameSystemWizardInjectModulePrompts: true,
            gameSystemWizardModuleExampleKeys: ['stock:XP', 'stock:TIME', 'stock:PARTY', 'field:HEAT', 'sysprompt:9', 'stock:QUESTS'],
        }
        expect(ours.listModuleExampleOptions(settings)).toEqual(theirs.listGameSystemWizardModuleExampleOptions(settings))
        expect(ours.moduleExamplesContext(settings)).toBe(theirs.buildGameSystemWizardModuleExamplesContext(settings))
        expect(ours.moduleExamplesContext(settings)).toContain('[TIME] (Stock Module)')
    })

    it('answers as the legacy over the corpus, with the same rendering hints', () => {
        const hints = renderingHints()
        expect(hints.length).toBeGreaterThan(20)
        const fresh = createWizardLegacy(hints)
        for (const reply of REPLIES) {
            for (const names of NAMES) {
                let ours: unknown
                let theirs: unknown
                try { ours = parseWizardResponse(reply, names) } catch (e) { ours = `throws: ${(e as Error).message}` }
                try { theirs = fresh.parseWizardResponse(reply, names) } catch (e) { theirs = `throws: ${(e as Error).message}` }
                expect(ours, reply.slice(0, 40)).toEqual(theirs)
            }
        }
        for (const [content, tag] of TEMPLATES) {
            expect(extractWizardTemplate(content, tag), content.slice(0, 30)).toBe(fresh.extractGameSystemWizardTemplate(content, tag))
            expect(buildWizardPreviewMemo(content, tag), content.slice(0, 30)).toBe(fresh.buildGameSystemWizardPreviewMemo(content, tag))
        }
        for (const text of ["{{user}} and Poppy's cat", 'nothing', '__RT_USER_MACRO__ back']) {
            expect(shieldUserMacro(text)).toBe(fresh.shieldUserMacro(text))
            expect(restoreUserMacro(text, ['Poppy'])).toBe(fresh.restoreUserMacro(text, ['Poppy']))
        }
    })
})
