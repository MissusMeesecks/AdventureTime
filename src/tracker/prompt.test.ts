import { describe, expect, it } from 'vitest'

import { FACTORY_CARTRIDGE_DEFAULTS } from '../state/factory-defaults.js'

import {
    DEFAULT_OUTPUT_SUFFIX,
    buildModulesInstructionText,
    buildTrackerPrompt,
    effectiveTrackerSettings,
    memoForNarrativeContext,
    memoForTrackerContext,
    resolveTimePromptKey,
    type TrackerPromptSettings,
} from './prompt.js'

const SETTINGS: TrackerPromptSettings = {
    systemPromptTemplate: 'You are the State Extractor Model.',
    stockPrompts: {
        character: 'Track the character sheet.',
        combat: 'Track the fight.',
        time: 'Track the clock in 12h form.',
        time_24h: 'Track the clock in 24h form.',
        time_ddmmyy: 'Track the clock with dd/mm/yy dates.',
        time_ddmmyy_24h: 'Track the clock in 24h with dd/mm/yy dates.',
        quests: 'Track quests.\n  DEADLINE: when it is due\n  FRUSTRATION_COEFF: how impatient\nEnd of quests.',
    },
    modules: { character: true, combat: true, time: true, quests: true },
    syspromptModules: { quests: true, questsDeadlines: true, questsFrustration: true },
}

describe('resolveTimePromptKey', () => {
    it.each([
        [{}, 'time'],
        [{ use24hTime: true }, 'time_24h'],
        [{ useDdMmYyFormat: true }, 'time_ddmmyy'],
        [{ use24hTime: true, useDdMmYyFormat: true }, 'time_ddmmyy_24h'],
    ])('picks %j -> %s', (settings, expected) => {
        expect(resolveTimePromptKey(settings)).toBe(expected)
    })
})

describe('buildModulesInstructionText', () => {
    it('emits one line per enabled module', () => {
        const text = buildModulesInstructionText(SETTINGS)
        expect(text).toContain('### CORE MODULES')
        expect(text).toContain('- [CHARACTER]: Track the character sheet.')
    })

    it('leaves out a module that is switched off', () => {
        const text = buildModulesInstructionText({ ...SETTINGS, modules: { character: true } })
        expect(text).toContain('[CHARACTER]')
        expect(text).not.toContain('[COMBAT]')
    })

    it('never emits the alternate time spellings as modules of their own', () => {
        const text = buildModulesInstructionText({
            ...SETTINGS,
            modules: { ...SETTINGS.modules, time_24h: true, time_ddmmyy: true },
        })
        expect(text).not.toContain('[TIME_24H]')
        expect(text).not.toContain('[TIME_DDMMYY]')
    })

    it('swaps in the time prompt matching the chosen format', () => {
        expect(buildModulesInstructionText(SETTINGS)).toContain('12h form')
        expect(buildModulesInstructionText({ ...SETTINGS, use24hTime: true })).toContain('24h form')
        expect(buildModulesInstructionText({ ...SETTINGS, useDdMmYyFormat: true })).toContain('dd/mm/yy dates')
    })

    it('appends the combat state-transport rules a cartridge may predate', () => {
        // Not theme text: this is how combat state travels between turns, so it
        // is added without editing the user's saved prompt.
        const text = buildModulesInstructionText(SETTINGS)
        expect(text).toContain('DEFEATED COMBATANTS')
        expect(text).toContain('NON-PARTY ALLIES')
    })

    it('does not duplicate a rule a custom combat prompt already states', () => {
        const text = buildModulesInstructionText({
            ...SETTINGS,
            stockPrompts: { ...SETTINGS.stockPrompts, combat: 'Mine. DEFEATED COMBATANTS: keep them. NON-PARTY ALLIES too.' },
        })
        expect(text.match(/DEFEATED COMBATANTS/g)).toHaveLength(1)
    })

    it('drops the quest module entirely when the quest sysprompt is off', () => {
        const text = buildModulesInstructionText({ ...SETTINGS, syspromptModules: { quests: false } })
        expect(text).not.toContain('[QUESTS]')
    })

    it('trims quest fields whose features are switched off', () => {
        const text = buildModulesInstructionText({ ...SETTINGS, syspromptModules: { quests: true } })
        expect(text).toContain('[QUESTS]')
        expect(text).not.toContain('DEADLINE:')
        expect(text).not.toContain('FRUSTRATION_COEFF:')
    })

    it('keeps quest fields whose features are on', () => {
        const text = buildModulesInstructionText(SETTINGS)
        expect(text).toContain('DEADLINE:')
        expect(text).toContain('FRUSTRATION_COEFF:')
    })

    it('instructs enabled custom fields and skips disabled ones', () => {
        const text = buildModulesInstructionText({
            ...SETTINGS,
            customFields: [
                { tag: 'WAYSTONE', prompt: 'Track the waystone.', enabled: true },
                { tag: 'HEIRLOOMS', prompt: 'Track the keepsakes.', enabled: false },
            ],
        })
        expect(text).toContain('### CUSTOM MODULES')
        expect(text).toContain('- [WAYSTONE]: Track the waystone.')
        expect(text).not.toContain('[HEIRLOOMS]')
    })

    // Deliberate, and the right thing to send: an empty `- [EMPTY]:` line is
    // worse than no line. It is also invisible from here, which is why the
    // editor now marks such a field "no instruction" on its own row — see
    // `isMaintained` in `custom-fields.ts`. The two halves are one rule.
    it('skips a custom field with no prompt of its own', () => {
        const text = buildModulesInstructionText({
            ...SETTINGS,
            customFields: [{ tag: 'EMPTY', prompt: '', enabled: true }],
        })
        expect(text).not.toContain('[EMPTY]')
    })

    it('anchors the campaign start date only until a clock exists', () => {
        const settings = { ...SETTINGS, initialDate: '14 Marrowtide 1187' }
        expect(buildModulesInstructionText(settings, '')).toContain('14 Marrowtide 1187')
        // Once the pass has written a [TIME] block it owns the clock;
        // re-anchoring would drag it backwards.
        expect(buildModulesInstructionText(settings, '[TIME]\nDay 4\n[/TIME]')).not.toContain('14 Marrowtide')
    })

    it('produces just the header when nothing is enabled', () => {
        expect(buildModulesInstructionText({ ...SETTINGS, modules: {} })).toBe('### CORE MODULES')
    })
})

describe('buildTrackerPrompt', () => {
    const input = {
        settings: SETTINGS,
        memo: '[TIME]\n<font color="red">06:15 AM</font>, Day 4\n[/TIME]',
        narrative: ['User: I open the door.', 'GM: It is locked.'],
    }

    it('puts the extractor prompt and the module instructions in the system message', () => {
        const { system } = buildTrackerPrompt(input)
        expect(system).toContain('You are the State Extractor Model.')
        expect(system).toContain('### CORE MODULES')
    })

    it('carries the prior memo, the narrative and the output instruction', () => {
        const { user } = buildTrackerPrompt(input)
        expect(user).toContain('## PRIOR MEMO')
        expect(user).toContain('## NARRATIVE HISTORY (Last 2 messages)')
        expect(user).toContain('It is locked.')
        expect(user.trimEnd().endsWith(DEFAULT_OUTPUT_SUFFIX)).toBe(true)
    })

    it('strips display HTML from the prior memo but keeps the markers', () => {
        const { user } = buildTrackerPrompt({ ...input, memo: '[XP]\n<font color="red">((BAR)) 1/2</font>\n[/XP]' })
        expect(user).not.toContain('<font')
        // The pass is expected to echo markers back; stripping them would lose
        // every authored module's formatting on the next turn.
        expect(user).toContain('((BAR))')
    })

    it('says the memo is empty rather than leaving a blank section', () => {
        expect(buildTrackerPrompt({ ...input, memo: '' }).user).toContain('## PRIOR MEMO\n(empty)')
    })

    // Multihog's 💬 for the tracker: the legacy `sendDirectPrompt`'s prompt.
    describe('an instructed pass', () => {
        it('adds the instruction as its own section after the story, closed by the same suffix as every pass (72c)', () => {
            const { user } = buildTrackerPrompt({ ...input, instruction: 'Bench Oswin.' })
            expect(user).toContain('## USER INSTRUCTION\nBench Oswin.')
            expect(user.indexOf('## USER INSTRUCTION')).toBeGreaterThan(user.indexOf('## NARRATIVE HISTORY'))
            // The pin's direct pass ends with the User Prompt Suffix, as the automatic one does.
            expect(user.trimEnd().endsWith(DEFAULT_OUTPUT_SUFFIX)).toBe(true)
            expect(user).not.toContain('OR NEW SECTIONS')
        })

        it('closes with the User Prompt Suffix preference when one is set, the stock line when it is blank (72c)', () => {
            expect(buildTrackerPrompt({ ...input, outputSuffix: '## OUTPUT THE WHOLE MEMO:' }).user.trimEnd().endsWith('## OUTPUT THE WHOLE MEMO:')).toBe(true)
            expect(buildTrackerPrompt({ ...input, instruction: 'Bench Oswin.', outputSuffix: '## MINE:' }).user.trimEnd().endsWith('## MINE:')).toBe(true)
            expect(buildTrackerPrompt({ ...input, outputSuffix: '  ' }).user.trimEnd().endsWith(DEFAULT_OUTPUT_SUFFIX)).toBe(true)
            // The world lore opens the user prompt (73h), before the prior memo, on the automatic and the instructed pass; blank, nothing is added.
            const lore = '## WORLD LORE (All Books)\nA keep on the moor.'
            expect(buildTrackerPrompt({ ...input, worldLore: lore }).user.startsWith(`${lore}\n\n## PRIOR MEMO`)).toBe(true)
            expect(buildTrackerPrompt({ ...input, worldLore: lore, instruction: 'Bench Oswin.' }).user.startsWith(`${lore}\n\n## PRIOR MEMO`)).toBe(true)
            expect(buildTrackerPrompt({ ...input, worldLore: '  ' }).user.startsWith('## PRIOR MEMO')).toBe(true)
            expect(buildTrackerPrompt({ ...input, worldLore: lore, priorStates: ['[TIME]\nold\n[/TIME]'] }).user.startsWith(`${lore}\n\n## TRACKER STATE -1`)).toBe(true)
        })

        it('names an empty memo as the initial setup', () => {
            // "Set up my character" is the documented first use of the bar.
            expect(buildTrackerPrompt({ ...input, memo: '', instruction: 'Set me up.' }).user)
                .toContain('## PRIOR MEMO\n(empty — this is the initial setup)')
        })

        it('leaves the narrative section out when told to read nothing', () => {
            const { user } = buildTrackerPrompt({ ...input, narrative: [], instruction: 'Set me up.' })
            expect(user).not.toContain('## NARRATIVE HISTORY')
            expect(user).toContain('## USER INSTRUCTION')
        })

        it('is the ordinary prompt when the instruction is blank', () => {
            expect(buildTrackerPrompt({ ...input, instruction: '   ' }).user).toBe(buildTrackerPrompt(input).user)
        })

        // The character creator (Phase 35): the legacy's `modules_only` mode.
        it('sends the module instructions alone as the system prompt in modules-only mode, and the same user prompt', () => {
            const only = buildTrackerPrompt({ ...input, instruction: 'Design a character.', modulesOnly: true })
            expect(only.system).toContain('### CORE MODULES')
            expect(only.system).not.toContain('You are the State Extractor Model.')
            expect(only.system.trim().startsWith('### CORE MODULES')).toBe(true)
            expect(only.user).toBe(buildTrackerPrompt({ ...input, instruction: 'Design a character.' }).user)
            expect(buildTrackerPrompt({ ...input, modulesOnly: false }).system).toContain('You are the State Extractor Model.')
        })
    })

    describe('filling {{modulesText}}', () => {
        /** The stock template's shape: the hole, and the two lines framing it. */
        const templated: TrackerPromptSettings = {
            ...SETTINGS,
            systemPromptTemplate:
                'You are the State Extractor Model.\n<modules>\nYou must track the following enabled modules:\n' +
                '{{modulesText}}\nNEVER ignore a module.\n</modules>\n<custom_formatting>\nMarkers.\n</custom_formatting>',
        }

        it('leaves no placeholder behind for the model to read as text', () => {
            expect(buildTrackerPrompt({ ...input, settings: templated }).system).not.toContain('{{modulesText}}')
        })

        it('puts the modules in the hole, not after the document', () => {
            const { system } = buildTrackerPrompt({ ...input, settings: templated })
            const modules = system.indexOf('### CORE MODULES')
            expect(modules).toBeGreaterThan(system.indexOf('You must track the following enabled modules:'))
            // The line the whole list depends on for its meaning.
            expect(modules).toBeLessThan(system.indexOf('NEVER ignore a module.'))
            expect(modules).toBeLessThan(system.indexOf('</custom_formatting>'))
        })

        it('appends when the template has lost its placeholder, rather than dropping every module', () => {
            // The legacy drops them silently here. See buildTrackerPrompt.
            const { system } = buildTrackerPrompt({ ...input, settings: SETTINGS })
            expect(system).toContain('You are the State Extractor Model.')
            expect(system).toContain('- [CHARACTER]: Track the character sheet.')
        })

        it('carries a module prompt containing $& through intact', () => {
            // `String.replace` with a string replacement reads $-patterns out of
            // it, and module text is built from prompts a user can write.
            const { system } = buildTrackerPrompt({
                ...input,
                settings: {
                    ...templated,
                    stockPrompts: { ...templated.stockPrompts, character: 'Write costs as $& or $` per item.' },
                },
            })
            expect(system).toContain('- [CHARACTER]: Write costs as $& or $` per item.')
        })
    })

    describe('modules this build cannot honour', () => {
        const withBench: TrackerPromptSettings = {
            ...SETTINGS,
            stockPrompts: {
                ...SETTINGS.stockPrompts,
                'benched party': 'Code moves their full [PARTY] stat sheet automatically.',
            },
            modules: { ...SETTINGS.modules, 'benched party': true },
        }

        // Phase 12 withheld this because the prompt promised an engine that
        // did not exist; Phase 29 built it, so the promise is kept and made.
        it('instructs the model on benching now the engine honours it', () => {
            const { system } = buildTrackerPrompt({ ...input, settings: withBench })
            expect(system).toContain('[BENCHED PARTY]:')
            expect(system).toContain('Code moves their full [PARTY] stat sheet')
        })

        it('leaves benching out when the cartridge switches the module off', () => {
            const off = { ...withBench, modules: { ...withBench.modules, 'benched party': false } }
            const { system } = buildTrackerPrompt({ ...input, settings: off })
            expect(system).not.toContain('[BENCHED PARTY]:')
        })

        it('leaves every other module exactly as it was', () => {
            const { system } = buildTrackerPrompt({ ...input, settings: withBench })
            expect(system).toContain('- [CHARACTER]: Track the character sheet.')
            expect(system).toContain('- [COMBAT]: Track the fight.')
            expect(system).toContain('- [QUESTS]: Track quests.')
        })

        it('does not touch the cartridge\'s own module table, which still round-trips', () => {
            // The flag has to survive export/import untouched — switching the
            // module back on should be one line here, not a cartridge migration.
            effectiveTrackerSettings(withBench)
            expect(withBench.modules?.['benched party']).toBe(true)
        })

        it('leaves settings alone when the module is already off', () => {
            const off: TrackerPromptSettings = { ...SETTINGS, modules: { character: true } }
            expect(effectiveTrackerSettings(off)).toBe(off)
        })
    })

    describe('dd/mm/yyyy dates', () => {
        const dated: TrackerPromptSettings = {
            ...SETTINGS,
            useDdMmYyFormat: true,
            stockPrompts: {
                ...SETTINGS.stockPrompts,
                time_ddmmyy: 'Last Rest: HH:MM AM/PM, Day N. Started Day 1, 11:52 and rested [Day X, HH:MM].',
            },
        }

        it('rewrites day counters outside the quest prompt, which the builder alone never reached', () => {
            const { system } = buildTrackerPrompt({ ...input, settings: dated })
            expect(system).toContain('DD/MM/YYYY')
            expect(system).toContain('01/01/2026, 11:52')
            expect(system).toContain('[DD/MM/YYYY, HH:MM]')
            expect(system).not.toMatch(/Day\s+N/)
            expect(system).not.toMatch(/Day\s+X/)
        })

        it('converts a dated example whole, not just its prefix', () => {
            const { system } = buildTrackerPrompt({
                ...input,
                settings: {
                    ...dated,
                    systemPromptTemplate: 'Extractor. Example: Day 3, 14:00 and later Day 6.',
                },
            })
            expect(system).toContain('03/01/2026, 14:00')
            expect(system).toContain('06/01/2026')
        })

        it('leaves day counters alone when the campaign runs on day numbers', () => {
            // In the template, not a stock prompt: the dd/mm/yy time prompt is
            // only *selected* when the flag is on, so it cannot show the
            // difference the flag makes.
            const onDayNumbers = { ...dated, systemPromptTemplate: 'Extractor. Rested Day N, started Day 1.' }
            expect(buildTrackerPrompt({ ...input, settings: { ...onDayNumbers, useDdMmYyFormat: false } }).system).toContain(
                'Rested Day N, started Day 1.',
            )
            expect(buildTrackerPrompt({ ...input, settings: onDayNumbers }).system).toContain(
                'Rested DD/MM/YYYY, started 01/01/2026.',
            )
        })
    })
})

describe('buff and debuff decay', () => {
    // The roadmap filed this as unported. It is a tracker instruction, not
    // code, in the legacy too: the extractor template tells the model to
    // diff the current [TIME] against the PRIOR MEMO's and revert what has
    // expired, and the prior memo it is handed carries [TIME]. Pinned here so
    // a template edit that drops it is caught.
    it('is instructed through the factory template and the prior memo it is handed', () => {
        const factory = FACTORY_CARTRIDGE_DEFAULTS as unknown as TrackerPromptSettings
        const { system, user } = buildTrackerPrompt({
            settings: factory,
            memo: '[TIME]\n06:15 AM, Day 4\n[/TIME]\n\n[CHARACTER]\nStatus: (+) Shield (+5 AC, 1h)\n[/CHARACTER]',
            narrative: ['Two hours pass.'],
        })
        expect(system).toContain('calculate the delta between the current [TIME] and the [TIME] in the PRIOR MEMO')
        expect(system).toContain('Auto-Reversion: During each State Sync, check if a duration has expired')
        expect(user).toContain('## PRIOR MEMO\n[TIME]\n06:15 AM, Day 4\n[/TIME]')
    })
})

describe('the memo as the tracker sees it', () => {
    const BENCHED = '[PARTY]\n- Robin (Rogue 2): 18/18 HP\nCombat: BAB: +1\nStatus: Healthy\n[/PARTY]\n\n[BENCHED PARTY]\n- Gareth (Fighter 3): 28/30 HP\nCombat: BAB: +3\nGear: Longsword\nStatus: Benched (06:15 AM, Day 4, resting)\n[/BENCHED PARTY]'

    it('compacts the benched roster to name and status, and keeps the party sheet', () => {
        const out = memoForTrackerContext(BENCHED)
        expect(out).toContain('[BENCHED PARTY]\n- Gareth (Fighter 3): Benched (06:15 AM, Day 4, resting)\n[/BENCHED PARTY]')
        expect(out).not.toContain('Longsword')
        expect(out).toContain('- Robin (Rogue 2): 18/18 HP\nCombat: BAB: +1')
    })

    it('leaves the benched block out with the module off', () => {
        expect(memoForTrackerContext(BENCHED, { benchedParty: false })).not.toContain('BENCHED PARTY')
    })

    it('does the same for the storyteller', () => {
        expect(memoForNarrativeContext(BENCHED)).toContain('- Gareth (Fighter 3): Benched (06:15 AM, Day 4, resting)')
        expect(memoForNarrativeContext(BENCHED)).not.toContain('Longsword')
    })
})

describe('memoForNarrativeContext', () => {
    it('removes display markers, which mean nothing to a storyteller', () => {
        expect(memoForNarrativeContext('[A]\nAttunement: ((BARCYAN)) 640/1000\n[/A]')).toBe(
            '[A]\nAttunement: 640/1000\n[/A]',
        )
    })

    it('removes every marker spelling, without needing to know them', () => {
        // Everything between double parens goes, so a new marker syntax never
        // needs handling here.
        expect(memoForNarrativeContext('x ((ANYTHING - at all)) y')).toBe('x y')
    })

    it('drops the quest block, which is injected separately', () => {
        const memo = '[TIME]\nDay 4\n[/TIME]\n[QUESTS]\nQUEST: find the key\n[/QUESTS]'
        const out = memoForNarrativeContext(memo)
        expect(out).toContain('[TIME]')
        expect(out).not.toContain('QUEST: find the key')
    })

    it('leaves ordinary prose parentheses alone', () => {
        expect(memoForNarrativeContext('Weather: Overcast (light rain)')).toBe(
            'Weather: Overcast (light rain)',
        )
    })

    it('copes with an empty memo', () => {
        expect(memoForNarrativeContext('')).toBe('')
    })
})

describe('the history context (72b)', () => {
    it('shows earlier states before the current one in the legacy’s automatic shape, and the prior memo alone without them', () => {
        const base = { settings: {}, memo: '[XP]\nLevel 2\n[/XP]', narrative: ['Narrator: Hi.'] }
        const { user } = buildTrackerPrompt({ ...base, priorStates: ['[XP]\nLevel 1\n[/XP]', '<b>[XP]\nLevel 1, 90%\n[/XP]</b>'] })
        expect(user).toContain('## TRACKER STATE -2\n[XP]\nLevel 1\n[/XP]\n\n## TRACKER STATE -1\n[XP]\nLevel 1, 90%\n[/XP]\n\n## TRACKER STATE 0 (Current)\n[XP]\nLevel 2\n[/XP]')
        expect(user).not.toContain('## PRIOR MEMO')
        expect(user.indexOf('## TRACKER STATE -2')).toBeLessThan(user.indexOf('## NARRATIVE HISTORY'))
        expect(buildTrackerPrompt({ ...base, priorStates: [] }).user).toContain('## PRIOR MEMO\n[XP]\nLevel 2\n[/XP]')
        expect(buildTrackerPrompt({ ...base, priorStates: ['', '  '] }).user).toContain('## PRIOR MEMO')
    })
})
