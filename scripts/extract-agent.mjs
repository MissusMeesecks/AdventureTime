#!/usr/bin/env node
/**
 * Extract the Lorebook Agent's legacy pieces from the pinned build (Phase 45b,
 * extended by 72c).
 *
 * The agent's prompt is assembled here (`src/backend/agent-pass.ts`) around
 * the cartridge's two templates, and what it is told comes from the legacy
 * and must match it: the refresh of the shipped NPC-creation paragraph that
 * upstream 2026.9.25 applies to a stored module instruction
 * (`module-instructions.js`); the five runtime fragments and their resolvers
 * — the Combat Profile guidance (2026.8.76), the automatic and the direct
 * pass's `[CORE]` restriction, the existing-NPC nudge
 * (`lorebook-runtime-fragments.js`); the template expander
 * (`lorebook-prompt-templates.js`); the eligible-field rule, the timestamp
 * adjuster and the enabled-category list (`router-utils.js`); and from
 * `router.js` the two memo readers that put the `[COMBAT]` and `[PARTY]`
 * blocks in front of the agent, the strip of the static map guidance, the
 * mapped-site note, the current-location section and the existence rule.
 * Functions are sliced by their own brace-matched bodies, template consts to
 * their closing backtick, one-line string consts whole (CLAUDE.md 3a-bis).
 * `src/agent/modules.ts` is the typed face.
 *
 *   git clone --filter=blob:none \
 *     https://github.com/MultihogAurelius/SillyTavern-MultihogDnDFramework /tmp/mh
 *   git -C /tmp/mh checkout d6aab004f97f1f9a286f235de62f22ba1abadbe8
 *   node scripts/extract-agent.mjs /tmp/mh
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PINNED_COMMIT = 'd6aab004f97f1f9a286f235de62f22ba1abadbe8';
const OUT = 'src/tracker/router-legacy.js';

/** @type {Array<{ file: string, functions?: string[], consts?: string[], lines?: string[] }>} */
/** @type {Array<{ file: string; functions?: string[]; consts?: string[]; arrays?: string[]; lines?: string[]; templates?: Array<{ name: string; declared?: string; after?: string; params?: string[] }> }>} */
export const PIECES = [
    // The NPC `[CORE]` sections first: the three instruction builders read them (77).
    { file: 'src/state/schema-sections.js', arrays: ['DEFAULT_NPC_SECTIONS'] },
    // The refresh of the shipped paragraph (45b) and, since 77, the NPC, LOC and FAC
    // instruction builders Multihog rebuilds the stored instructions from.
    { file: 'src/state/module-instructions.js', consts: ['OLD_NPC_CREATION_GUIDANCE', 'NPC_CREATION_GUIDANCE'], functions: ['upgradeNpcCreationGuidance', 'buildNpcInstruction', 'buildLocInstruction', 'buildFacInstruction'], lines: ['LOREBOOK_FULL_AUDIT_INSTRUCTION'] },
    // The scope rule first: both guidance texts interpolate it. The three
    // other fragments and their resolvers (72c) follow, with the local
    // expander the resolvers call.
    {
        file: 'src/state/lorebook-runtime-fragments.js',
        consts: ['COMBAT_SCOPE_RULE', 'DEFAULT_ROUTER_COMBAT_PROFILE_GUIDANCE_BASIC', 'DEFAULT_ROUTER_COMBAT_PROFILE_GUIDANCE_AGENT', 'DEFAULT_ROUTER_AUTO_PASS_RESTRICTION', 'DEFAULT_ROUTER_MANUAL_PASS_RESTRICTION', 'DEFAULT_ROUTER_EXISTING_NPC_NUDGE'],
        functions: ['expandFragmentTemplate', 'resolveCombatProfileGuidance', 'resolveAutoPassRestriction', 'resolveExistingNpcNudge'],
    },
    { file: 'src/state/lorebook-prompt-templates.js', functions: ['expandLorebookPromptTemplate'] },
    { file: 'router.js', functions: ['extractActiveCombatBlock', 'stripStaticDungeonAgentGuidance', 'formatMappedSiteAgentNote', 'formatCurrentLocationSection'], lines: ['LOCATION_FOOTER_LAG_NOTE', 'LORE_EXISTENCE_RULE'] },
    // The cleanup pass and the full audit (71c): the archivist's prompt and
    // the two texts appended to it live inside `runRouterPass` as a `let`
    // and two anonymous template literals, so they are sliced by their
    // backticks and framed here; the token estimate and the redundancy
    // counter are plain functions.
    {
        file: 'router.js',
        functions: ['estimateTokens', 'getBigrams', 'jaccardSimilarity', 'countRedundantPairs'],
        templates: [
            { name: 'agentInstructionPrompt', declared: 'agentInstructionPrompt' },
            { name: 'overrideText', declared: 'overrideText', params: ['customInstructions'] },
            { name: 'cleanupTextActionsSuffix', after: ': agentInstructionPrompt + `' },
        ],
    },
    { file: 'src/state/router-utils.js', functions: ['extractPartyBlock', 'isAppearanceField', 'isEquipmentField', 'isCombatProfileField', 'getEligibleCoreFieldNames', 'adjustPromptTimestamps', 'normalizeRouterCategoryTag', 'getEnabledRouterCategoryTags'] },
];

export const NAMES = [
    'DEFAULT_NPC_SECTIONS', 'buildNpcInstruction', 'buildLocInstruction', 'buildFacInstruction',
    'OLD_NPC_CREATION_GUIDANCE', 'NPC_CREATION_GUIDANCE', 'upgradeNpcCreationGuidance',
    'DEFAULT_ROUTER_COMBAT_PROFILE_GUIDANCE_BASIC', 'DEFAULT_ROUTER_COMBAT_PROFILE_GUIDANCE_AGENT', 'resolveCombatProfileGuidance',
    'DEFAULT_ROUTER_AUTO_PASS_RESTRICTION', 'DEFAULT_ROUTER_MANUAL_PASS_RESTRICTION', 'DEFAULT_ROUTER_EXISTING_NPC_NUDGE',
    'resolveAutoPassRestriction', 'resolveExistingNpcNudge', 'expandLorebookPromptTemplate',
    'extractActiveCombatBlock', 'stripStaticDungeonAgentGuidance', 'formatMappedSiteAgentNote', 'formatCurrentLocationSection',
    'LOCATION_FOOTER_LAG_NOTE', 'LORE_EXISTENCE_RULE',
    'extractPartyBlock', 'isAppearanceField', 'isEquipmentField', 'isCombatProfileField', 'getEligibleCoreFieldNames',
    'adjustPromptTimestamps', 'getEnabledRouterCategoryTags',
    'LOREBOOK_FULL_AUDIT_INSTRUCTION', 'estimateTokens', 'countRedundantPairs', 'agentInstructionPrompt', 'overrideText', 'cleanupTextActionsSuffix',
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
 * One template-literal const, `[export ]const NAME = \`…\`;`, to its closing backtick.
 * @param {string} source
 * @param {string} name
 */
export function sliceConst(source, name) {
    const match = new RegExp(`^(?:export )?const ${name} = \``, 'm').exec(source);
    if (!match) throw new Error(`no template const ${name} in the source`);
    const close = source.indexOf('`;', match.index + match[0].length);
    if (close < 0) throw new Error(`const ${name} never closes`);
    return source.slice(match.index, close + 2);
}

/**
 * One array const, `[export ]const NAME = [` to its closing `];` at the margin (77: the NPC sections).
 * @param {string} source
 * @param {string} name
 */
export function sliceArray(source, name) {
    const match = new RegExp(`^(?:export )?const ${name} = \\[`, 'm').exec(source);
    if (!match) throw new Error(`no array const ${name} in the source`);
    const close = source.indexOf('\n];', match.index + match[0].length);
    if (close < 0) throw new Error(`const ${name} never closes`);
    return source.slice(match.index, close + 3);
}

/**
 * One single-quoted, one-line string const, `[export ]const NAME = '…';`, whole (72c).
 * @param {string} source
 * @param {string} name
 */
export function sliceLine(source, name) {
    const match = new RegExp(`^(?:export )?const ${name} = '(?:[^'\\\\\\n]|\\\\.)*';$`, 'm').exec(source);
    if (!match) throw new Error(`no one-line string const ${name} in the source`);
    return match[0];
}

/**
 * One template literal, backtick to backtick, by the `let`/`const` that
 * declares it anywhere in the file (71c: the cleanup prompt is a `let` inside
 * `runRouterPass`), or by the text that precedes it when it is anonymous.
 * @param {string} source
 * @param {{ name: string; declared?: string; after?: string; params?: string[] }} piece
 */
export function sliceTemplate(source, piece) {
    let start;
    if (piece.declared) {
        const match = new RegExp(`^[ \\t]*(?:let|const) ${piece.declared} = \``, 'm').exec(source);
        if (!match) throw new Error(`no template ${piece.declared} in the source`);
        start = match.index + match[0].length - 1;
    } else {
        const at = source.indexOf(piece.after ?? '');
        if (!piece.after || at < 0) throw new Error(`no text "${piece.after}" in the source`);
        start = at + piece.after.length - 1;
    }
    let i = start + 1;
    for (; i < source.length; i++) {
        if (source[i] === '\\') { i += 1; continue; }
        if (source[i] === '`') break;
    }
    if (i >= source.length) throw new Error(`template ${piece.name} never closes`);
    const literal = source.slice(start, i + 1);
    return piece.params
        ? `function ${piece.name}(${piece.params.join(', ')}) {\n    return ${literal};\n}`
        : `const ${piece.name} = ${literal};`;
}

/** @param {string} root */
export function sliceLegacy(root) {
    const out = [];
    for (const piece of PIECES) {
        const source = readFileSync(`${root}/${piece.file}`, 'utf8');
        for (const name of piece.arrays ?? []) out.push(`// ── ${piece.file}: ${name} ──\n${sliceArray(source, name).trim()}\n`.replace(/^export /gm, ''));
        for (const name of piece.lines ?? []) out.push(`// ── ${piece.file}: ${name} ──\n${sliceLine(source, name)}\n`.replace(/^export /gm, ''));
        for (const name of piece.consts ?? []) out.push(`// ── ${piece.file}: ${name} ──\n${sliceConst(source, name).trim()}\n`.replace(/^export /gm, ''));
        for (const name of piece.functions ?? []) out.push(`// ── ${piece.file}: ${name} ──\n${sliceFunction(source, name).trim()}\n`.replace(/^export /gm, ''));
        for (const template of piece.templates ?? []) out.push(`// ── ${piece.file}: ${template.name} ──\n${sliceTemplate(source, template)}\n`);
    }
    return out.join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('extract-agent.mjs')) {
    const dir = process.argv[2];
    if (!dir) {
        console.error('usage: node scripts/extract-agent.mjs <upstream-checkout>');
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
        console.error('  Refusing: the agent\'s pieces must match the build the gate is pinned to.');
        process.exit(2);
    }
    const body = sliceLegacy(abs);
    for (const name of NAMES) {
        if (!new RegExp(`^(?:function|const) ${name}\\b`, 'm').test(body)) throw new Error(`the slice defines no ${name}`);
    }
    const header = `/**
 * GENERATED by scripts/extract-agent.mjs from
 * MultihogAurelius/SillyTavern-MultihogDnDFramework @ ${PINNED_COMMIT}.
 * Do not edit. Regenerate with the script; it refuses any other commit.
 *
 * The Lorebook Agent's legacy pieces: the refresh of the shipped NPC-creation
 * paragraph (\`module-instructions.js\`); the five runtime fragments and their
 * resolvers (\`lorebook-runtime-fragments.js\`); the template expander
 * (\`lorebook-prompt-templates.js\`); the \`[COMBAT]\` and \`[PARTY]\` block
 * readers, the static map guidance's strip, the mapped-site note, the
 * current-location section and the existence rule (\`router.js\`,
 * \`router-utils.js\`); the eligible-field rule, the timestamp adjuster and
 * the enabled-category list (\`router-utils.js\`), each sliced by its own
 * body; the cleanup pass's archivist prompt with its two appended texts, the
 * token estimate and the redundancy counter, and the full audit's
 * instruction (\`router.js\`, \`module-instructions.js\`; 71c)
 * (CLAUDE.md 3a-bis; 45b, 72c, 71c). \`src/agent/modules.ts\` and
 * \`src/agent/cleanup.ts\` are the typed faces;
 * \`router.pin.test.ts\` holds this file to a fresh slice of the pinned
 * checkout.
 */
/* eslint-disable */
// @ts-nocheck

/**
 * @param {{ getNpcRelationshipMax?: (settings: object) => number, buildNpcRelationshipInstruction?: (max: number, settings: object) => string }} [deps]
 *   The two relationship pieces \`buildNpcInstruction\` reads from the legacy's
 *   module scope when a cartridge's relationship bars are on (77). AdventureTime's
 *   face builds with the bars off — the agent is sent the relationship section
 *   once, through the shared context (72c) — so the defaults are never read;
 *   the pin test passes the checkout's own.
 */
export function createRouterLegacy(deps = {}) {
    const getNpcRelationshipMax = deps.getNpcRelationshipMax ?? (() => 150);
    const buildNpcRelationshipInstruction = deps.buildNpcRelationshipInstruction ?? (() => '');
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
