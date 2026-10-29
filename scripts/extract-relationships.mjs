#!/usr/bin/env node
/**
 * Extract the relationship system's helpers from the pinned legacy build (Phase 44).
 *
 * Multihog's friendship/affection component: the math (`relationship-math.js`
 * — clamping, the bar width, the thirteen tiers of each axis and the badge
 * colours), the State Tracker's `[RELATIONS]` command block
 * (`relationship-commands.js`, whole), the instruction that asks the tracker
 * for it (`relationship-prompts.js`), and the agent's and the basic router's
 * starting-value sections with their placeholder expander
 * (`lorebook-runtime-fragments.js`). Functions are sliced by their own
 * brace-matched bodies, template consts to their closing backtick, so the
 * file holds exactly the code the pin holds (CLAUDE.md 3a-bis).
 * `src/tracker/relationships.ts` is the typed face.
 *
 * The math falls back to `getNpcRelationshipMax()` from the settings when a
 * call omits the scale; the face never omits it, and the header defines the
 * fallback as the factory's 150 so the sliced bodies stay whole.
 *
 *   git clone --filter=blob:none \
 *     https://github.com/MultihogAurelius/SillyTavern-MultihogDnDFramework /tmp/mh
 *   git -C /tmp/mh checkout d6aab004f97f1f9a286f235de62f22ba1abadbe8
 *   node scripts/extract-relationships.mjs /tmp/mh
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PINNED_COMMIT = 'd6aab004f97f1f9a286f235de62f22ba1abadbe8';
const OUT = 'src/tracker/relationships-legacy.js';

/** @type {Array<{ file: string, from?: string, functions?: string[], consts?: string[] }>} */
export const PIECES = [
    { file: 'src/state/relationship-math.js', functions: ['normalizeNpcRelationshipMax', 'clampRelationshipValue', 'relationshipBarPct', 'relPctOfMax', 'getFriendshipTier', 'getAffectionTier', 'lerpTier', 'getRelTierIntensity', 'getRelTierBadgeStyle'] },
    { file: 'src/state/relationship-commands.js', from: '/**\n * @typedef' },
    { file: 'src/state/relationship-prompts.js', functions: ['buildStateTrackerRelationshipCommandInstruction'] },
    { file: 'src/state/lorebook-runtime-fragments.js', functions: ['expandFragmentTemplate', 'expandRelationshipPctPlaceholders'], consts: ['DEFAULT_ROUTER_REL_SECTION_BASIC', 'DEFAULT_ROUTER_REL_SECTION_AGENT'] },
];

export const NAMES = [
    'normalizeNpcRelationshipMax', 'clampRelationshipValue', 'relationshipBarPct', 'relPctOfMax',
    'getFriendshipTier', 'getAffectionTier', 'getRelTierIntensity', 'getRelTierBadgeStyle',
    'extractStateTrackerRelationshipCommands', 'parseRelationshipCommandLine',
    'buildStateTrackerRelationshipCommandInstruction',
    'expandFragmentTemplate', 'expandRelationshipPctPlaceholders',
    'DEFAULT_ROUTER_REL_SECTION_BASIC', 'DEFAULT_ROUTER_REL_SECTION_AGENT',
];

/**
 * One function's source with the doc comment above it, by its brace-matched body (as `extract-scene.mjs`).
 * @param {string} source
 * @param {string} name
 */
export function sliceFunction(source, name) {
    const match = new RegExp(`^(?:export )?function ${name}\\(`, 'm').exec(source);
    if (!match) throw new Error(`no function ${name} in the source`);
    let start = match.index;
    const comment = /\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*$/.exec(source.slice(0, start));
    if (comment) start = comment.index;
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

/**
 * One template-literal const, `export const NAME = \`…\`;`, to its closing backtick.
 * @param {string} source
 * @param {string} name
 */
export function sliceConst(source, name) {
    const match = new RegExp(`^export const ${name} = \``, 'm').exec(source);
    if (!match) throw new Error(`no template const ${name} in the source`);
    const close = source.indexOf('`;', match.index + match[0].length);
    if (close < 0) throw new Error(`const ${name} never closes`);
    return source.slice(match.index, close + 2);
}

/** @param {string} root */
export function sliceLegacy(root) {
    const out = [];
    for (const piece of PIECES) {
        const source = readFileSync(`${root}/${piece.file}`, 'utf8');
        if (piece.from) {
            const start = source.indexOf(piece.from);
            if (start < 0) throw new Error(`${piece.file} no longer contains: ${piece.from}`);
            const body = source.slice(start);
            if (/^import /m.test(body)) throw new Error(`${piece.file} imports something after its header`);
            out.push(`// ── ${piece.file} ──\n${body.trim()}\n`.replace(/^export /gm, ''));
            continue;
        }
        for (const name of piece.consts ?? []) out.push(`// ── ${piece.file}: ${name} ──\n${sliceConst(source, name).trim()}\n`.replace(/^export /gm, ''));
        for (const name of piece.functions ?? []) out.push(`// ── ${piece.file}: ${name} ──\n${sliceFunction(source, name).trim()}\n`.replace(/^export /gm, ''));
    }
    return out.join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('extract-relationships.mjs')) {
    const dir = process.argv[2];
    if (!dir) {
        console.error('usage: node scripts/extract-relationships.mjs <upstream-checkout>');
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
        console.error('  Refusing: the relationships must match the build the gate is pinned to.');
        process.exit(2);
    }
    const body = sliceLegacy(abs);
    for (const name of NAMES) {
        if (!new RegExp(`^(?:function|const) ${name}\\b`, 'm').test(body)) throw new Error(`the slice defines no ${name}`);
    }
    const header = `/**
 * GENERATED by scripts/extract-relationships.mjs from
 * MultihogAurelius/SillyTavern-MultihogDnDFramework @ ${PINNED_COMMIT}.
 * Do not edit. Regenerate with the script; it refuses any other commit.
 *
 * The relationship system's helpers: the math (\`relationship-math.js\`), the
 * tracker's command block (\`relationship-commands.js\`), its instruction
 * (\`relationship-prompts.js\`) and the starting-value sections with their
 * expander (\`lorebook-runtime-fragments.js\`), each sliced by its own body
 * (CLAUDE.md 3a-bis). \`src/tracker/relationships.ts\` is the typed face;
 * \`relationships.pin.test.ts\` holds this file to a fresh slice of the pinned
 * checkout and runs the checkout's own command parser beside ours.
 */
/* eslint-disable */
// @ts-nocheck

export function createRelationshipsLegacy() {
    // The legacy reads the scale from its settings when a call omits it; the
    // face always passes one, and this is the factory's value for the rest.
    function getNpcRelationshipMax() { return 150; }
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
