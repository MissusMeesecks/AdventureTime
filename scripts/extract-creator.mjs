#!/usr/bin/env node
/**
 * Extract the character creator's legacy half from the pinned build.
 *
 * Multihog's Character Creator asks the State Model for a complete player
 * character: one prompt built from the player's preferences (name, gender,
 * age, species, genre, level, gear tier, class, traits, hints), the modules
 * that are on, the time format and the starting date, with the legacy's
 * rules for levels, XP, gear and combat scaling. The *pure* parts are sliced
 * here, verbatim (CLAUDE.md 3a-bis): the class lists and the prompt builder
 * out of `character-creator.js` (with the name read out of a memo), the
 * onboarding helpers out of `constants.js` (the XP table and hint, the time
 * hint, the active blocks, the gear tiers and their guidance, the combat and
 * skill scaling guide), the Instant Action helpers, the genre name pools,
 * the sheet check, the presets, and the Player Card's section template. The
 * parts with I/O -- the model call, the panel -- are ported by hand.
 *
 *   node scripts/extract-creator.mjs /tmp/mh
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PINNED_COMMIT = 'd6aab004f97f1f9a286f235de62f22ba1abadbe8';
const OUT = 'src/tracker/creator-legacy.js';

/**
 * [file, from, to]: the slice runs from `from` to just before `to` (the
 * file's end for `null`).
 * @type {Array<[string, string, string | null]>}
 */
const SLICES = [
    // The XP table and its text, the level values and preference, the XP and
    // time hints, the active blocks, the custom-module instructions, the gear
    // tiers and their guidance, the starting gear hint, the combat guide.
    ['constants.js', 'export const XP_LEVEL_THRESHOLDS = ', 'export const BLOCK_ORDER = '],
    ['constants.js', 'export const BLOCK_ORDER = ', 'export const PAGE_SIZE'],
    // The class lists per genre, the archetypes, and the prompt builder.
    ['character-creator.js', 'const _CR_CLASS_LISTS = {', '/**\n * Generate a character sheet for Quick Start'],
    // The name read out of a memo's [CHARACTER] block.
    ['character-creator.js', 'export function extractCharNameFromMemo(memo) {', '// ── PC Import Panel'],
    // Imports nothing: sliced whole.
    ['src/state/instant-action-instructions.js', 'export const MAX_INSTANT_ACTION_INSTRUCTION_LENGTH', null],
    ['src/state/character-names.js', '/** Genre-specific name pools', null],
    // The sheet check lived in its own file at the old pin (8.64) and is an
    // inline condition in character-creator.js at this one (the 8.66 freeze
    // rolled the tree back to 8.60): `creator.ts` carries it, held to the
    // checkout's text by the pin test.
    ['src/features/character-creator/presets.js', '/** @param {unknown} name */', null],
    // The NPC `[CORE]` sections (77: the sections editor's stock and its reset) and the Player Card's section template.
    ['src/state/schema-sections.js', 'export const DEFAULT_NPC_SECTIONS = [', 'export const DEFAULT_PC_SECTIONS'],
    ['src/state/schema-sections.js', 'export const DEFAULT_PC_SECTIONS = [', 'export const MODULE_NAME'],
    // The Player Card's writer (35b): the persona prompt, the memo cleaned,
    // the recent story, the call. Its I/O is injected, not sliced.
    ['character-creator.js', 'export async function generatePersonaBio(', 'async function uploadDefaultPersonaAvatar('],
    // The Player Card written from a character card (39): the card's text
    // with {{char}} resolved, the two modes' prompts, the call. The file's
    // last function, so the slice runs to its end.
    ['character-creator.js', 'async function generatePcImportBio(', null],
    // The agent's Player Card target, the field tests, the field patterns and
    // the section patcher, out of router-utils.js (which imports nothing).
    ['src/state/router-utils.js', '/** Extract canonical [CHARACTER] block', '/**\n * Fields eligible for commit.core'],
    ['src/state/router-utils.js', '/**\n * Resolve field-name aliases used when surgically', '/**\n * Escape a literal for safe use'],
    // The name-only persona identity. Imports nothing: sliced whole.
    ['src/state/player-identity.js', '/** Name-only identity', null],
];

/** @param {string} root */
export function sliceLegacy(root) {
    const out = [];
    for (const [file, from, to] of SLICES) {
        const source = readFileSync(`${root}/${file}`, 'utf8');
        const start = source.indexOf(from);
        if (start < 0) throw new Error(`${file} no longer contains: ${from}`);
        const end = to === null ? source.length : source.indexOf(to, start + from.length);
        if (end < 0) throw new Error(`${file} no longer contains the end marker after: ${from}`);
        out.push(`// ── ${file}: ${from.slice(0, 48).replace(/\n/g, ' ')} ──\n${source.slice(start, end).trim()}`);
    }
    // Not dedented: a template literal is code (lesson 36).
    return `${out.join('\n\n')}\n`.replace(/^export /gm, '');
}

if (process.argv[1] && process.argv[1].endsWith('extract-creator.mjs')) {
    const dir = process.argv[2];
    if (!dir) {
        console.error('usage: node scripts/extract-creator.mjs <upstream-checkout>');
        process.exit(2);
    }
    const abs = resolve(dir);
    let head;
    try {
        head = execFileSync('git', ['-C', abs, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch (error) {
        console.error(`! ${abs} is not a git checkout: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(2);
    }
    if (head !== PINNED_COMMIT) {
        console.error(`! checkout is at ${head}, not the pinned ${PINNED_COMMIT}.`);
        console.error('  Refusing: the character creator must match the build the gate is pinned to.');
        process.exit(2);
    }
    const body = sliceLegacy(abs);
    const header = `/**
 * GENERATED by scripts/extract-creator.mjs from
 * MultihogAurelius/SillyTavern-MultihogDnDFramework @ ${PINNED_COMMIT}.
 * Do not edit. Regenerate with the script; it refuses any other commit.
 *
 * The character creator's prompt builder, class lists, onboarding hints,
 * Instant Action helpers, name pools, sheet check, presets, the Player
 * Card's section template and its writer, the agent's Player Card target
 * and section patcher, and the name-only persona identity, sliced verbatim
 * from the legacy source and closed over what they read from their host
 * (CLAUDE.md 3a-bis): the settings, the active character card and chat,
 * the model call, its connection, and the toast.
 * \`src/tracker/creator.ts\` is the typed face; \`creator.pin.test.ts\` holds
 * this file to a fresh slice of the pinned checkout.
 */
/* eslint-disable */
// @ts-nocheck

/**
 * @param {{
 *   getSettings: () => object,
 *   SillyTavern: { getContext: () => { characterId?: unknown, characters?: unknown, chat?: unknown[], chatId?: unknown } },
 *   sendStateRequest: (connection: unknown, system: string, user: string) => Promise<string>,
 *   getCharacterCreationConnectionSettings: (settings: object) => unknown,
 *   toastr: { warning: (message: string, title?: string) => void },
 * }} deps
 */
export function createCreatorLegacy({ getSettings, SillyTavern, sendStateRequest, getCharacterCreationConnectionSettings, toastr }) {
`;
    const footer = `
    return {
        XP_LEVEL_THRESHOLDS, XP_LEVEL_THRESHOLDS_TEXT, getOnboardingLevelXpValues, resolveOnboardingLevelPreference,
        buildOnboardingXpHint, buildOnboardingTimeHint, buildOnboardingActiveBlocks, buildOnboardingCustomModuleInstructions,
        STARTING_GEAR_TIER_OPTIONS, buildStartingGearHint, buildCombatAndSkillScalingHint, BLOCK_ORDER,
        _CR_CLASS_LISTS, _CR_CLASS_CONSTANTS, getArchetypesForGenre, buildCharacterGenerationPrompt, extractCharNameFromMemo,
        MAX_INSTANT_ACTION_INSTRUCTION_LENGTH, DEFAULT_INSTANT_ACTION_PLAYER_CARD_WORDS, normalizeInstantActionInstructions,
        resolveInstantActionPlayerCardWords, extractInstantActionLevel, rollInstantActionLevel, resolveInstantActionStartingLevel, getInstantActionLevelRange,
        buildInstantActionPromptSection, buildInstantActionOpeningMessage,
        CHARACTER_NAME_POOLS, CHARACTER_CREATOR_NAME_ADDITIONS, pickGenreCharacterName,
        normalizeCharacterCreatorPresetName, findCharacterCreatorPresetByName, upsertCharacterCreatorPreset,
        DEFAULT_NPC_SECTIONS, DEFAULT_PC_SECTIONS,
        generatePersonaBio, generatePcImportBio,
        extractCharacterBlock, isPcCoreTarget, isAppearanceField, isEquipmentField, isSpeciesField, isCombatProfileField,
        resolveCoreFieldPatterns, patchLabeledSection,
        buildNameOnlyPersonaIdentity, resolveActivatedPersonaDescription, normalizeActivePersonaIdentity,
    };
}
`;
    writeFileSync(OUT, `${header}${body}${footer}`);
    console.log(`wrote ${OUT} (${body.length} characters of legacy source)`);
}
