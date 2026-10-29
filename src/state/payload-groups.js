/**
 * CARTRIDGE_PAYLOAD_GROUPS — the cartridge surface. 8 groups, 49 keys.
 *
 * This is the contract. Every Game Cartridge ever exported carries exactly
 * these keys, and `buildCartridgePayload` / `applyCartridgePayload` both
 * iterate them. A key that is not here does not exist as far as cartridges
 * are concerned — it will not be exported, and it will not be restored.
 *
 * Transcribed byte-for-byte from the legacy build's
 * `src/state/factory-and-diff.js` at the pinned commit (docs/UPSTREAM.md).
 * The groups also drive the selective-load dialog, so the order below is
 * display order, and the labels and descriptions are user-visible text.
 *
 * Changing anything here is a breaking change to every cartridge every user
 * has ever exported. The contract-lock test in tests/ fails the moment this
 * drifts, and that failure is the feature — see CLAUDE.md rule 3.
 */

/**
 * @typedef {object} CartridgePayloadGroup
 * @property {string} id           Stable group id.
 * @property {string} label        User-visible group name.
 * @property {string} description  User-visible one-line summary.
 * @property {string[]} keys       Payload keys belonging to this group.
 */

/** @type {CartridgePayloadGroup[]} */
export const CARTRIDGE_PAYLOAD_GROUPS = [
    {
        id: 'stateTracker',
        label: 'State Tracker',
        description: 'Extractor prompt, module toggles, block order, stock prompts, RNG & time-format flags',
        keys: [
            'systemPromptTemplate', 'modules', 'blockOrder', 'stockPrompts',
            'syspromptModules', 'narrativePacing', 'syspromptSectionOrder', 'customSyspromptLibrary',
            'rngEnabled', 'diceFunctionTool', 'diceD100Mode',
            'rngToolD20', 'rngToolD100', 'rngQueueD20', 'rngQueueD100',
            'use24hTime', 'useDdMmYyFormat',
        ],
    },
    {
        id: 'cyoa',
        label: 'CYOA Mode',
        description: 'Choice-slot setup, custom prompt, button appearance, and saved CYOA presets',
        keys: ['cyoaConfig'],
    },
    {
        id: 'gameSystems',
        label: 'Game Systems & Customization & Custom Fields',
        description: 'Custom game systems and custom tracker fields',
        keys: ['gameSystems', 'customFields'],
    },
    {
        id: 'characterSheets',
        label: 'Character Sheets',
        description: 'NPC/PC core sections, section presets, relationship bar toggle',
        keys: ['npcCoreSections', 'pcCoreSections', 'npcSectionPresets', 'pcSectionPresets', 'npcRelationshipBars'],
    },
    {
        id: 'portraits',
        label: 'Portrait Generator',
        description: 'NPC and character portrait prompt templates, word target, saved presets',
        keys: [
            'portraitNpcSystemPrompt', 'portraitCharacterSystemPrompt', 'portraitLocationSystemPrompt',
            'portraitPromptWordTarget', 'activePortraitPromptPresetId', 'savedPortraitPromptPresets',
        ],
    },
    {
        id: 'lorebookAgent',
        label: 'Lorebook Agent',
        description: 'Researcher agent system prompt, modular format prompt, module definitions, custom tags',
        keys: [
            'routerSystemPromptTemplate', 'routerModularPromptTemplate',
            'routerBasicSystemPromptTemplate', 'routerAgentSharedContextTemplate',
            'routerCombatProfileGuidanceBasicTemplate', 'routerCombatProfileGuidanceAgentTemplate',
            'routerAutoPassRestrictionTemplate', 'routerManualPassRestrictionTemplate',
            'routerExistingNpcNudgeTemplate', 'routerRelSectionBasicTemplate', 'routerRelSectionAgentTemplate',
            'routerModules', 'routerCustomTags',
        ],
    },
    {
        id: 'mapArchitect',
        label: 'Map Architect',
        description: 'Dedicated hidden-site generation, occupancy, and off-screen evolution prompts',
        keys: ['mapArchitectSystemPrompt', 'mapUpdaterSystemPrompt', 'mapEvolutionSystemPrompt', 'mapEvolutionCompressSystemPrompt'],
    },
    {
        id: 'worldProgression',
        label: 'World Progression',
        description: 'Report Generation Prompt used by the World Progression Engine',
        keys: ['worldProgressionSystemPrompt'],
    },
];

/** Every payload key, in group order. */
export const CARTRIDGE_PAYLOAD_KEYS = CARTRIDGE_PAYLOAD_GROUPS.flatMap((g) => g.keys);
