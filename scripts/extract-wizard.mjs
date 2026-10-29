#!/usr/bin/env node
/**
 * Extract the Game System Wizard's pure functions from the pinned legacy build.
 *
 * Multihog's wizard (`game-systems.js`, 3,107 lines) drafts a game system --
 * a GM section and a tracker module -- with a model. Its *pure* parts are what
 * decide what the model is told and how its answer is read: the architect
 * system prompt (25,000 characters), the Sustenance worked example, the driver
 * guidance, the response parser, the tag helpers, the `{{user}}` shield, the
 * sample-block extractor, the preview memo builder (73e) and the example chips. This slices those functions
 * out of the pinned source, verbatim, into a factory, so the text is the
 * legacy's and not a transcription (CLAUDE.md 3a-bis). The parts with I/O --
 * the model calls, the popups, the save into settings -- are ported by hand
 * in `src/tracker/wizard.ts` and `src/backend/wizard.ts`.
 *
 *   git clone --filter=blob:none \
 *     https://github.com/MultihogAurelius/SillyTavern-MultihogDnDFramework /tmp/mh
 *   git -C /tmp/mh checkout d6aab004f97f1f9a286f235de62f22ba1abadbe8
 *   node scripts/extract-wizard.mjs /tmp/mh
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PINNED_COMMIT = 'd6aab004f97f1f9a286f235de62f22ba1abadbe8';
const OUT = 'src/tracker/wizard-legacy.js';

/**
 * The slices, in order. Each is [file, from-marker, to-marker]; the slice ends
 * before `to`, or at the file's end for `null`.
 * @type {Array<[string, string, string | null]>}
 */
export const SLICES = [
    ['llm-client.js', 'export const RT_USER_MACRO_SENTINEL', '// ── Connection Profile Helpers'],
    ['src/state/sysprompt-content.js', 'function escapeRegex(value)', null],
    // Whole since 73e: the preview memo builder draws the wizard's live card.
    ['src/features/game-system-wizard-preview.js', 'export function normalizeWizardTrackerTag', null],
    ['game-systems.js', 'function composeWizardArchitectPrompt', '/** Connection overlay for Game Systems wizard'],
    ['game-systems.js', 'function sanitizeWizardMacroContent', '/** Wizard LLM call'],
    ['game-systems.js', 'function sanitizeSnakeTag', '/** Matches sysprompt section tag names'],
    ['game-systems.js', 'function buildWizardSystemPrompt() {', '/** One combined AI call'],
    ['game-systems.js', 'function buildGmAccountingProhibitions', '/** Focused regeneration of just the GM half'],
    ['game-systems.js', 'const WIZARD_EXAMPLE_SYSTEMS = [', '\n];\n'],
];

/**
 * The wizard's context pieces (73g, departure 117): the option lister, the
 * preference normalisers and the module-examples builder of
 * `game-system-wizard-context.js`, which read `DEFAULT_STOCK_PROMPTS` and
 * `resolveTimePromptKey` from module scope — so they go in a factory of their
 * own that takes the two, and the frontend's face hands it nothing.
 * @type {Array<[string, string, string | null]>}
 */
export const CONTEXT_SLICES = [
    ['src/features/game-system-wizard-context.js', 'export const DEFAULT_GAME_SYSTEM_WIZARD_LOOKBACK', '/**\n * HTML for the optional module-prompt picker'],
    ['src/features/game-system-wizard-context.js', '/**\n * Builds the optional "existing systems" context block', '/**\n * Builds optional story context'],
];

/** @param {string} root */
export function sliceLegacy(root) {
    return sliceWith(root, SLICES);
}

/** @param {string} root */
export function sliceContextLegacy(root) {
    return sliceWith(root, CONTEXT_SLICES);
}

/** @param {string} root @param {Array<[string, string, string | null]>} slices */
function sliceWith(root, slices) {
    const out = [];
    for (const [file, from, to] of slices) {
        const source = readFileSync(`${root}/${file}`, 'utf8');
        const start = source.indexOf(from);
        if (start < 0) throw new Error(`${file} no longer contains: ${from}`);
        // `null` reads to the end of the file.
        let end = to === null ? source.length : source.indexOf(to, start + from.length);
        if (end < 0) throw new Error(`${file} no longer contains the end marker after: ${from}`);
        if (to === '\n];\n') end += to.length;
        out.push(`// ── ${file}: ${from.slice(0, 48).replace(/\n/g, ' ')} ──\n${source.slice(start, end).trim()}`);
    }
    // A factory closes over the two things the slices read from module scope:
    // the rendering hints (`RENDERING_TAGS_LIBRARY`) and the debug flag.
    return `${out.join('\n\n')}\n`.replace(/^export /gm, '');
}

if (process.argv[1] && process.argv[1].endsWith('extract-wizard.mjs')) {
    const dir = process.argv[2];
    if (!dir) {
        console.error('usage: node scripts/extract-wizard.mjs <upstream-checkout>');
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
        console.error('  Refusing: the wizard must match the build the gate is pinned to.');
        process.exit(2);
    }
    const body = sliceLegacy(abs);
    const contextBody = sliceContextLegacy(abs);
    const header = `/**
 * GENERATED by scripts/extract-wizard.mjs from
 * MultihogAurelius/SillyTavern-MultihogDnDFramework @ ${PINNED_COMMIT}.
 * Do not edit. Regenerate with the script; it refuses any other commit.
 *
 * The Game System Wizard's pure functions, sliced verbatim from the legacy
 * source and closed over the rendering hints they read (CLAUDE.md 3a-bis).
 * \`src/tracker/wizard.ts\` is the typed face; \`wizard.pin.test.ts\` holds this
 * file to a fresh slice of the pinned checkout.
 */
/* eslint-disable */
// @ts-nocheck

/** @param {string[]} RENDERING_TAGS_LIBRARY */
export function createWizardLegacy(RENDERING_TAGS_LIBRARY) {
`;
    const footer = `
    return {
        RT_USER_MACRO_SENTINEL, shieldUserMacro, restoreUserMacro,
        unwrapManagedSectionContent, normalizeGmContent,
        normalizeWizardTrackerTag, extractGameSystemWizardTemplate, buildGameSystemWizardPreviewMemo,
        composeWizardArchitectPrompt,
        sanitizeSnakeTag, sanitizeUpperTag, uniqueTag, parseTagAttributes, extractSelfClosingTag, extractTagBlock,
        buildWizardSystemPrompt, buildWizardOutputExample, normalizeDrivers, parseWizardResponse,
        buildGmAccountingProhibitions, describeDrivers, describeEffectOwner, buildDriverGuidance,
        WIZARD_EXAMPLE_SYSTEMS,
    };
}

/**
 * The wizard's context pieces (73g). \`DEFAULT_STOCK_PROMPTS\` is the fallback
 * for a cartridge missing a stock text (ours never is), and
 * \`resolveTimePromptKey\` picks the time module's text; the frontend's face
 * passes an empty map and a stub, since it lists the options and builds no text.
 * @param {Record<string, string>} DEFAULT_STOCK_PROMPTS
 * @param {(settings: any) => string} resolveTimePromptKey
 */
export function createWizardContextLegacy(DEFAULT_STOCK_PROMPTS, resolveTimePromptKey) {
`;
    const contextFooter = `
    return {
        DEFAULT_GAME_SYSTEM_WIZARD_LOOKBACK, MAX_GAME_SYSTEM_WIZARD_LOOKBACK, GAME_SYSTEM_WIZARD_STOCK_MODULE_TAGS,
        listGameSystemWizardModuleExampleOptions, normalizeGameSystemWizardModuleExampleKeys, normalizeGameSystemWizardContextPrefs,
        buildGameSystemWizardModuleExamplesContext,
    };
}
`;
    // Not indented inside the factory: an indent on every line is an indent on
    // every line of every template literal, and the prompts are template
    // literals. Phase 32 shipped the architect prompt with four spaces on 74
    // of its 129 lines that way (lesson 36).
    writeFileSync(OUT, `${header}${body}${footer}${contextBody}${contextFooter}`);
    console.log(`wrote ${OUT} (${body.length + contextBody.length} characters of legacy source)`);
}
