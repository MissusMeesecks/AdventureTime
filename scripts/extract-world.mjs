#!/usr/bin/env node
/**
 * Extract World Progression's pure functions and prompt texts from the pinned
 * legacy build.
 *
 * Multihog's World Progression (`world-progression-lib.js`, the pass in
 * `router.js`) is a macro simulator: every in-world day it picks a few
 * locations from the campaign's lore, hands their dossiers to a model, and
 * files the prose report it gets back. The *pure* parts -- the dossier
 * builder, the rotation, the report sectioner, the metadata reader, the two
 * label helpers it borrows from `dungeon-reality.js`, the in-world clock
 * formatter, and every piece of prompt text the pass sends -- are sliced out
 * of the pinned source here, verbatim, into one factory (CLAUDE.md 3a-bis).
 * The parts with I/O -- loading books, the model call, the write, the timer --
 * are ported by hand in `src/tracker/world.ts` and `src/backend/world-pass.ts`.
 *
 *   git clone --filter=blob:none \
 *     https://github.com/MultihogAurelius/SillyTavern-MultihogDnDFramework /tmp/mh
 *   git -C /tmp/mh checkout d6aab004f97f1f9a286f235de62f22ba1abadbe8
 *   node scripts/extract-world.mjs /tmp/mh
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PINNED_COMMIT = 'd6aab004f97f1f9a286f235de62f22ba1abadbe8';
const OUT = 'src/tracker/world-legacy.js';

/** A slice ends before `to`, at the file's end for `null`, or at the first "`;" after `from` for `'`;'`. */
const STATEMENT = '`;';

/**
 * [file, from-marker, to-marker, after-marker?, wrap?]. `after` moves the
 * search past a landmark first, so a marker that appears in two functions
 * picks the pass's copy. `wrap` is [head, tail] text put around the slice.
 * @type {Array<[string, string, string | null, string?, [string, string]?]>}
 */
export const SLICES = [
    ['dungeon-reality.js', 'const LEADING_ARTICLE_RE = ', '\n', undefined],
    ['dungeon-reality.js', 'const MAP_SECTION_RE = ', '\n', undefined],
    ['dungeon-reality.js', 'export function stripDungeonMapSection', '/** Return the selected plain-text body', undefined],
    ['dungeon-reality.js', 'export function normalizeDungeonLabel', 'function editDistance', undefined],
    ['memo-processor.js', 'export function formatInWorldTime', '\n}\n', undefined, ['', '\n}']],
    ['world-progression-lib.js', 'export const WORLD_REPORT_METADATA_KEY', null, undefined],
    ['router.js', 'const isRawReport = (label) => {', '\n            };', 'export async function runWorldProgressionPass', ['', '\n};']],
    ['router.js', 'const consolidationSystemPrompt =', STATEMENT, 'export async function runWorldProgressionPass',
        ['function buildConsolidationSystemPrompt(consolidatedLabel) {\n', '\nreturn consolidationSystemPrompt;\n}']],
    ['router.js', 'const consolidationUserPrompt =', STATEMENT, 'export async function runWorldProgressionPass',
        ['function buildConsolidationUserPrompt(toConsolidate, consolidatedLabel, rawDump) {\n', '\nreturn consolidationUserPrompt;\n}']],
    ['router.js', 'systemPrompt += `\\n\\n## DATE FORMAT RULE', STATEMENT, 'export async function runWorldProgressionPass',
        ["const WORLD_DATE_FORMAT_RULE = (() => {\nlet systemPrompt = '';\n", '\nreturn systemPrompt;\n})();']],
    ['router.js', 'systemPrompt += `\\n\\n## LOCATION-CENTRIC RUNTIME CONTRACT', STATEMENT, 'export async function runWorldProgressionPass',
        ["const WORLD_RUNTIME_CONTRACT = (() => {\nlet systemPrompt = '';\n", '\nreturn systemPrompt;\n})();']],
    ['router.js', 'let userPrompt =', STATEMENT, 'export async function runWorldProgressionPass',
        ['function buildWorldUserPromptBody(designatedLocationLines, dossierDump, locationContext, historicalDump) {\n', '\nreturn userPrompt;\n}']],
    ['router.js', 'userPrompt += `\\n\\n## RECENT NARRATIVE', STATEMENT, 'export async function runWorldProgressionPass',
        ['function worldRecentNarrativeSection(recentNarrative) {\nlet userPrompt = \'\';\n', '\nreturn userPrompt;\n}']],
    ['router.js', 'userPrompt += `\\n\\nWrite the World Progression report', STATEMENT, 'export async function runWorldProgressionPass',
        ['function worldClosingLine(periodLabel) {\nlet userPrompt = \'\';\n', '\nreturn userPrompt;\n}']],
    ['router.js', "const entryKeys = ['world progression'", 'if (dayNum) entryKeys.push(`day ${dayNum}`);', 'export async function runWorldProgressionPass',
        ['function worldReportKeys(periodLabel) {\n', 'if (dayNum) entryKeys.push(`day ${dayNum}`);\nreturn entryKeys;\n}']],
    // The World Skeleton (33b): the architect prompt, the two contracts, the
    // parser, the user-prompt texts and the lorebook source context.
    ['src/state/defaults.js', '`You are a World Architect.', '`,', 'worldProgressionSkeletonSystemPrompt:',
        ['const DEFAULT_WORLD_SKELETON_SYSTEM_PROMPT = ', '`;']],
    ['router.js', 'systemPrompt += `\\n\\n## MACRO-ONLY SKELETON CONTRACT', STATEMENT, 'export async function runSkeletonGenerationPass',
        ["const WORLD_SKELETON_CONTRACT = (() => {\nlet systemPrompt = '';\n", '\nreturn systemPrompt;\n})();']],
    ['router.js', 'systemPrompt += `\\n\\n## LOREBOOK-ONLY MODE', STATEMENT, 'export async function runSkeletonGenerationPass',
        ["const WORLD_SKELETON_LOREBOOK_ONLY = (() => {\nlet systemPrompt = '';\n", '\nreturn systemPrompt;\n})();']],
    ['router.js', 'existingEntitiesStr = `Avoid duplicating these', STATEMENT, 'export async function runSkeletonGenerationPass',
        ["function skeletonExistingPremises(formattedEntries) {\nlet existingEntitiesStr = '';\n", '\nreturn existingEntitiesStr;\n}']],
    ['router.js', 'let userPrompt = `## SKELETON SOURCE', STATEMENT, 'export async function runSkeletonGenerationPass',
        ['function skeletonUserPromptHead(atmosphere) {\n', '\nreturn userPrompt;\n}']],
    ['router.js', 'userPrompt += `Generate ${append', STATEMENT, 'export async function runSkeletonGenerationPass',
        ["function skeletonClosingLine(append) {\nlet userPrompt = '';\n", '\nreturn userPrompt;\n}']],
    ['router.js', 'function parseSkeletonOutput(rawText) {', '/**\n * Generates the World Skeleton', undefined],
    ['src/features/world-progression/skeleton-lorebooks.js', 'export async function buildSkeletonLorebookSourceContext', null, undefined],
    // The Skeleton Source written from the chat (33c): the architect's
    // summarising prompt and the user prompt around the history.
    ['router.js', '`You are a World Architect. Analyze the provided chat history', '`;', 'export async function runAtmosphereGenerationPass',
        ['const WORLD_SOURCE_SYSTEM_PROMPT = ', '']],
    ['router.js', '`## RECENT CHAT HISTORY', '`;', 'export async function runAtmosphereGenerationPass',
        ['function worldSourceUserPrompt(formattedChatHistory) {\nreturn ', '\n}']],
];

/** @param {string} root */
export function sliceLegacy(root) {
    const out = [];
    for (const [file, from, to, after, wrap] of SLICES) {
        const source = readFileSync(`${root}/${file}`, 'utf8');
        let base = 0;
        if (after) {
            base = source.indexOf(after);
            if (base < 0) throw new Error(`${file} no longer contains the landmark: ${after}`);
        }
        const start = source.indexOf(from, base);
        if (start < 0) throw new Error(`${file} no longer contains: ${from}`);
        let end;
        if (to === null) end = source.length;
        else if (to === STATEMENT) {
            end = source.indexOf(STATEMENT, start + from.length);
            if (end >= 0) end += STATEMENT.length;
        } else end = source.indexOf(to, start + from.length);
        if (end < 0) throw new Error(`${file} no longer contains the end marker after: ${from}`);
        let text = source.slice(start, end).trim();
        if (wrap) text = `${wrap[0]}${text}${wrap[1]}`;
        out.push(`// ── ${file}: ${from.slice(0, 48).replace(/\n/g, ' ')} ──\n${text}`);
    }
    // The router slices sit eight to sixteen spaces in and are left there: a
    // dedent that touched a template literal's lines would change the prompt.
    return `${out.join('\n\n')}\n`.replace(/^export /gm, '');
}

if (process.argv[1] && process.argv[1].endsWith('extract-world.mjs')) {
    const dir = process.argv[2];
    if (!dir) {
        console.error('usage: node scripts/extract-world.mjs <upstream-checkout>');
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
        console.error('  Refusing: World Progression must match the build the gate is pinned to.');
        process.exit(2);
    }
    const body = sliceLegacy(abs);
    const header = `/**
 * GENERATED by scripts/extract-world.mjs from
 * MultihogAurelius/SillyTavern-MultihogDnDFramework @ ${PINNED_COMMIT}.
 * Do not edit. Regenerate with the script; it refuses any other commit.
 *
 * World Progression's pure functions and prompt texts, sliced verbatim from
 * the legacy source and closed over the two things they read from module
 * scope: the in-world time parser and the settings (CLAUDE.md 3a-bis).
 * \`src/tracker/world.ts\` is the typed face; \`world.pin.test.ts\` holds this
 * file to a fresh slice of the pinned checkout.
 */
/* eslint-disable */
// @ts-nocheck

/**
 * @param {{ parseInWorldTime: (s: string) => number | null, getSettings: () => { use24hTime?: boolean, useDdMmYyFormat?: boolean } }} deps
 */
export function createWorldLegacy({ parseInWorldTime, getSettings }) {
`;
    const footer = `
    return {
        LEADING_ARTICLE_RE, MAP_SECTION_RE, stripDungeonMapSection, normalizeDungeonLabel,
        formatInWorldTime,
        WORLD_REPORT_METADATA_KEY, worldProgressionLocationRoot, buildWorldProgressionLocationDossiers,
        selectWorldProgressionLocations, extractWorldReportForLocation, selectPendingWorldReportsForLocation,
        normalizeWorldReportMetadata, stampLocationAdvancement,
        isRawReport, buildConsolidationSystemPrompt, buildConsolidationUserPrompt,
        WORLD_DATE_FORMAT_RULE, WORLD_RUNTIME_CONTRACT,
        buildWorldUserPromptBody, worldRecentNarrativeSection, worldClosingLine, worldReportKeys,
        DEFAULT_WORLD_SKELETON_SYSTEM_PROMPT, WORLD_SKELETON_CONTRACT, WORLD_SKELETON_LOREBOOK_ONLY,
        skeletonExistingPremises, skeletonUserPromptHead, skeletonClosingLine, parseSkeletonOutput,
        buildSkeletonLorebookSourceContext,
        WORLD_SOURCE_SYSTEM_PROMPT, worldSourceUserPrompt,
    };
}
`;
    // Not indented inside the factory: an indent on every line is an indent on
    // every line of every template literal, and the prompts are template
    // literals. Phase 32 shipped the architect prompt with four spaces on 74
    // of its 129 lines that way (lesson 36).
    writeFileSync(OUT, `${header}${body}${footer}`);
    console.log(`wrote ${OUT} (${body.length} characters of legacy source)`);
}
