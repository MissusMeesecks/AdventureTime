#!/usr/bin/env node
/**
 * Extract Map Evolution's legacy half from the pinned build.
 *
 * Multihog's Map Evolution advances a site's map off-screen: on an in-world
 * interval per site (and once when the party leaves one), it shows a model
 * the map, the time elapsed since the site last evolved, the site's backlog
 * of prior passes, its open causal threads, the World Progression reports
 * not yet realized there and a frozen player bubble, and asks for one
 * transaction of EVOLVED operations. The *pure* parts are sliced here,
 * verbatim (CLAUDE.md 3a-bis): the three system prompts, the helper library
 * whole (`map-evolution-lib.js`: noop, report outcomes, digests, the player
 * bubble, intervals and due-ness, the backlog, the time window, the
 * schedule, site picking, threads, the narrator's activity briefing and
 * history compression), and the prompt builders, the contract and the
 * compression prompt out of `map-evolution.js`. The parts with I/O -- the
 * model calls, the books, the commit -- are ported by hand in
 * `src/backend/map-evolution.ts`.
 *
 *   node scripts/extract-evolution.mjs /tmp/mh
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PINNED_COMMIT = 'd6aab004f97f1f9a286f235de62f22ba1abadbe8';
const OUT = 'src/tracker/evolution-legacy.js';
const LIB = 'map-evolution-lib.js';

/**
 * [file, from, to, wrap]: the slice runs from `from` to just before `to`
 * (the file's end for `null`), and is wrapped in `wrap[0]` … `wrap[1]`.
 * @type {Array<[string, string, string | null, [string, string]?]>}
 */
const SLICES = [
    ['map-evolution-prompt.js', '/** Dedicated prompt used only for off-screen', null],
    ['map-evolution-direct-prompt.js', '/** Compact system prompt', null],
    ['map-evolution-compress-prompt.js', '/** Dedicated prompt used only to compress', null],
    // The library whole, from its first line of code: it imports the map
    // library, the time parser and (since 2026.8.68, the story lookback) two
    // chat-log helpers out of memo-processor.js, which the factory is closed
    // over.
    [LIB, 'export const DEFAULT_MAP_EVOLUTION_LOOKBACK = 20;', null],
    // The story lookback's window (45c): the Nth user message back, sliced
    // from memo-processor.js by itself. The formatter beside it reads
    // SillyTavern's message shape and stays a stub; ours formats the window.
    ['memo-processor.js', 'export function findNthUserMessageStartIdx(', '/**\n * Formats chat messages from startIdx'],
    // The Testing Ground's clock (71d): the memo's [TIME] line replaced, or
    // a block added when the memo has none, sliced from memo-processor.js.
    ['memo-processor.js', 'export function replaceMemoCurrentTime(', '/**\n * True when Last Rest has no real timestamp'],
    // The report pressures, the threads block and the digest parser.
    ['map-evolution.js', 'function formatWorldReportPressures(reports) {', 'async function maybeCompressSiteThreads('],
    // The compression request's user prompt, lifted out of the I/O function around it.
    ['map-evolution.js', 'const userPrompt = `SITE: ${siteRoot}', '    const req = {',
        ['function compressionUserPrompt(siteRoot, openText, closedText, tokens, threshold) {\n', '\n    return userPrompt;\n}']],
    // The backlog block.
    ['map-evolution.js', "function formatEvolutionBacklog(backlog, siteRoot = '') {", 'function stampReportOutcomes('],
    // The failure envelope, the kind policies, the headline, the direct
    // block, the on-site detail policy and the two prompts.
    ['map-evolution.js', 'function formatFailure(errors) {', 'function swipeSnapshotKey('],
    // The three contracts appended to the system prompt for a routine pass.
    ['map-evolution.js', 'AUTHORITATIVE TIME-SCALE CONTRACT', '`;\n    let prompt = initialUserPrompt({',
        ['const EVOLUTION_CONTRACT = `', '`;']],
];

/**
 * Every name the library exports, in source order, read from the source rather than remembered.
 * @param {string} source
 */
export function exportedNames(source) {
    return [...source.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map((m) => m[1]);
}

/** @param {string} root */
export function sliceLegacy(root) {
    const out = [];
    for (const [file, from, to, wrap] of SLICES) {
        const source = readFileSync(`${root}/${file}`, 'utf8');
        const start = source.indexOf(from);
        if (start < 0) throw new Error(`${file} no longer contains: ${from}`);
        const end = to === null ? source.length : source.indexOf(to, start + from.length);
        if (end < 0) throw new Error(`${file} no longer contains the end marker after: ${from}`);
        let text = source.slice(start, end).trim();
        if (wrap) text = `${wrap[0]}${text}${wrap[1]}`;
        out.push(`// ── ${file}: ${from.slice(0, 48).replace(/\n/g, ' ')} ──\n${text}`);
    }
    // Not dedented: a template literal is code (lesson 36).
    return `${out.join('\n\n')}\n`.replace(/^export /gm, '');
}

if (process.argv[1] && process.argv[1].endsWith('extract-evolution.mjs')) {
    const dir = process.argv[2];
    if (!dir) {
        console.error('usage: node scripts/extract-evolution.mjs <upstream-checkout>');
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
        console.error('  Refusing: Map Evolution must match the build the gate is pinned to.');
        process.exit(2);
    }
    const body = sliceLegacy(abs);
    const libNames = exportedNames(readFileSync(`${abs}/${LIB}`, 'utf8'));
    const header = `/**
 * GENERATED by scripts/extract-evolution.mjs from
 * MultihogAurelius/SillyTavern-MultihogDnDFramework @ ${PINNED_COMMIT}.
 * Do not edit. Regenerate with the script; it refuses any other commit.
 *
 * Map Evolution's prompts, helper library, prompt builders and contracts,
 * sliced verbatim from the legacy source and closed over the nine things
 * they read from the map library, the time parser, the JSON recovery and
 * the chat-log formatter
 * (CLAUDE.md 3a-bis). \`src/tracker/evolution.ts\` is the typed face;
 * \`evolution.pin.test.ts\` holds this file to a fresh slice of the pinned
 * checkout.
 */
/* eslint-disable */
// @ts-nocheck

/**
 * @param {{ normalizeDungeonLabel: Function, resolveCurrentMapPlacement: Function, normalizeMapSiteKind: Function, formatDungeonMapForEvolution: Function, parseInWorldTime: Function, parseMapArchitectResponse: Function, dungeonSiteRootsMatch: Function, pickActiveSiteForLocation: Function, formatAgentChatLogFromIndex: Function }} deps
 */
export function createEvolutionLegacy({ normalizeDungeonLabel, resolveCurrentMapPlacement, normalizeMapSiteKind, formatDungeonMapForEvolution, parseInWorldTime, parseMapArchitectResponse, dungeonSiteRootsMatch, pickActiveSiteForLocation, formatAgentChatLogFromIndex }) {
`;
    const footer = `
    return {
        DEFAULT_MAP_EVOLUTION_SYSTEM_PROMPT, DEFAULT_MAP_EVOLUTION_DIRECT_SYSTEM_PROMPT, selectMapEvolutionSystemPrompt,
        DEFAULT_MAP_EVOLUTION_COMPRESS_SYSTEM_PROMPT,
        ${libNames.join(',\n        ')},
        findNthUserMessageStartIdx, replaceMemoCurrentTime,
        formatWorldReportPressures, formatEvolutionThreads, parseCompressionDigests, compressionUserPrompt,
        formatEvolutionBacklog, formatFailure, kindPolicy, triggerHeadline, formatDirectInstructionBlock,
        evolutionDetailPolicy, initialUserPrompt, correctionPrompt, EVOLUTION_CONTRACT,
    };
}
`;
    writeFileSync(OUT, `${header}${body}${footer}`);
    console.log(`wrote ${OUT} (${body.length} characters of legacy source, ${libNames.length} library exports)`);
}
