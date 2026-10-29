#!/usr/bin/env node
/**
 * Extract the scene view's helpers from the pinned legacy build (Phase 42).
 *
 * Multihog's Visuals mode (`immersion.js`) shows where the party is and who
 * is present. Its pure parts live in four places: `normalizeLocationPath`
 * (`portraits.js`), the location resolver whole (`location-resolver.js`,
 * which imports only that one function), the Present Now helpers whole
 * (`src/state/present-now.js`, which imports nothing), and two functions
 * of `router.js` — `isNpcBookName` and `narrativeMentionsNpcName`, the name
 * scan. Each is sliced by its own brace-matched body, so the file holds
 * exactly the code the pin holds (CLAUDE.md 3a-bis). `src/tracker/scene.ts`
 * is the typed face.
 *
 *   git clone --filter=blob:none \
 *     https://github.com/MultihogAurelius/SillyTavern-MultihogDnDFramework /tmp/mh
 *   git -C /tmp/mh checkout d6aab004f97f1f9a286f235de62f22ba1abadbe8
 *   node scripts/extract-scene.mjs /tmp/mh
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PINNED_COMMIT = 'd6aab004f97f1f9a286f235de62f22ba1abadbe8';
const OUT = 'src/tracker/scene-legacy.js';

/**
 * What is sliced: a whole file from its first line of code, or one function by name.
 * @type {Array<{ file: string, from?: string, functions?: string[] }>}
 */
export const PIECES = [
    { file: 'portraits.js', functions: ['normalizeLocationPath'] },
    { file: 'location-resolver.js', from: '/**\n * Tokenize freeform location text' },
    { file: 'src/state/present-now.js', from: '/**\n * Latest narrator/assistant chat message' },
    { file: 'router.js', functions: ['isNpcBookName', 'narrativeMentionsNpcName'] },
];

/** The names the slice defines, in order: every top-level function and const. */
export const NAMES = [
    'normalizeLocationPath',
    'tokenizeLocationText', 'resolveCurrentLocationPath', 'formatLocationBreadcrumb',
    'findMostRecentNarratorMessage', 'stripCyoaChoiceBlocks',
    'isNpcBookName', 'narrativeMentionsNpcName',
];

/**
 * One function's source, `function name(` through its matching close brace, with the
 * doc comment above it. Braces inside its strings and regexes are balanced in the
 * functions sliced here; the pin test's fresh slice catches any that stop being.
 * @param {string} source
 * @param {string} name
 */
export function sliceFunction(source, name) {
    const match = new RegExp(`^(?:export )?function ${name}\\(`, 'm').exec(source);
    if (!match) throw new Error(`no function ${name} in the source`);
    let start = match.index;
    // Take the doc comment immediately above, when there is one.
    const before = source.slice(0, start);
    const comment = /\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*$/.exec(before);
    if (comment) start = comment.index;
    // The body's brace is the first after the parameter list's close, past any `= {}` default.
    const open = source.indexOf('{', source.indexOf(')', match.index));
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        const ch = source[i];
        if (ch === '{') depth += 1;
        else if (ch === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    throw new Error(`function ${name} never closes`);
}

/** @param {string} root */
export function sliceLegacy(root) {
    const out = [];
    for (const piece of PIECES) {
        const source = readFileSync(`${root}/${piece.file}`, 'utf8');
        if (piece.functions) {
            for (const name of piece.functions) out.push(`// ── ${piece.file}: ${name} ──\n${sliceFunction(source, name).trim()}\n`.replace(/^export /gm, ''));
            continue;
        }
        const from = piece.from ?? '';
        const start = from ? source.indexOf(from) : -1;
        if (start < 0) throw new Error(`${piece.file} no longer contains: ${from}`);
        const body = source.slice(start);
        if (/^import /m.test(body)) throw new Error(`${piece.file} imports something after its header; it can no longer be sliced whole`);
        // Not dedented (lesson 36).
        out.push(`// ── ${piece.file} ──\n${body.trim()}\n`.replace(/^export /gm, ''));
    }
    return out.join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('extract-scene.mjs')) {
    const dir = process.argv[2];
    if (!dir) {
        console.error('usage: node scripts/extract-scene.mjs <upstream-checkout>');
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
        console.error('  Refusing: the scene must match the build the gate is pinned to.');
        process.exit(2);
    }
    const body = sliceLegacy(abs);
    for (const name of NAMES) {
        if (!new RegExp(`^function ${name}\\(`, 'm').test(body)) throw new Error(`the slice defines no ${name}`);
    }
    const header = `/**
 * GENERATED by scripts/extract-scene.mjs from
 * MultihogAurelius/SillyTavern-MultihogDnDFramework @ ${PINNED_COMMIT}.
 * Do not edit. Regenerate with the script; it refuses any other commit.
 *
 * The scene view's helpers: \`normalizeLocationPath\` (\`portraits.js\`), the
 * location resolver (\`location-resolver.js\`), the Present Now helpers
 * (\`src/state/present-now.js\`) and the name scan (\`router.js\`), each sliced
 * by its own body (CLAUDE.md 3a-bis). \`src/tracker/scene.ts\` is the typed
 * face; \`scene.pin.test.ts\` holds this file to a fresh slice of the pinned
 * checkout.
 */
/* eslint-disable */
// @ts-nocheck

export function createSceneLegacy() {
`;
    const footer = `
    return {
        ${NAMES.join(',\n        ')},
    };
}
`;
    writeFileSync(OUT, `${header}${body}${footer}`);
    console.log(`wrote ${OUT} (${body.length} characters of legacy source, ${NAMES.length} names)`);
}
