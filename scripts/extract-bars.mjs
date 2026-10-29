#!/usr/bin/env node
/**
 * Extract the animated bars from the pinned legacy build (Phase 74h).
 *
 * Multihog's `src/ui/panel/bar-change-animation.js` is the value-change
 * feedback on a bar: the transition between two rendered values (same bar,
 * same scale, a changed value), the trickle's duration and frames, the capture
 * of every bar's visible state before a redraw and the playback after it — the
 * lit segment, the floating delta that counts down as the fill moves. Its
 * `src/ui/panel/xp-gain-animation.js` is the same for the experience row: the
 * `+N XP` floater that counts down under the bar as it fills. Both import
 * nothing, so each is sliced *whole* into its own factory (CLAUDE.md 3a-bis),
 * and the stylesheet rules they need are read as text from `style.css`.
 * `src/frontend/bar-animation.ts` is the typed face.
 *
 * Since 74i the file also carries the bars' colours: the per-bar resolver of
 * `src/state/settings.js` (`getBarBackground` — solid, gradient or dynamic
 * from the stored config, else the HP thresholds; `getBarShowAsPercentage`,
 * `getBarAnimateChanges`) and the recolour popup of `theme-manager.js`
 * (`handleRecolor`, which opens Bar Settings over a clicked bar — the three
 * modes, the pickers patching the bar live, Show as Percentage, Animate
 * Changes, OK, Cancel and Reset — and `resolvePickerColor`, which turns a
 * marker's colour into the hex a picker takes). Those files import the host,
 * so each function is sliced by its own braces into a factory that takes
 * what it reads from module scope: `getSettings`, and for the popup
 * `saveSettings` and `refreshRenderedView`. The recolour rules of `style.css`
 * are read as text beside the animations'.
 *
 *   git clone --filter=blob:none \
 *     https://github.com/MultihogAurelius/SillyTavern-MultihogDnDFramework /tmp/mh
 *   git -C /tmp/mh checkout d6aab004f97f1f9a286f235de62f22ba1abadbe8
 *   node scripts/extract-bars.mjs /tmp/mh
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PINNED_COMMIT = 'd6aab004f97f1f9a286f235de62f22ba1abadbe8';
const OUT = 'src/frontend/bars-legacy.js';
export const SOURCE_CSS = 'style.css';

/** The two modules, each with the first line of code after its file comment. */
export const MODULES = [
    { file: 'src/ui/panel/bar-change-animation.js', from: 'const BAR_CHANGE_HOLD_MS', factory: 'createBarChangeLegacy' },
    { file: 'src/ui/panel/xp-gain-animation.js', from: 'const XP_GAIN_HOLD_MS', factory: 'createXpGainLegacy' },
];

/** The functions sliced by their braces (74i), each factory taking what its functions read from module scope. */
export const FUNCTIONS = [
    { file: 'src/state/settings.js', functions: ['getBarBackground', 'getBarShowAsPercentage', 'getBarAnimateChanges'], factory: 'createBarColorsLegacy', params: ['getSettings'] },
    { file: 'theme-manager.js', functions: ['handleRecolor', 'resolvePickerColor'], factory: 'createRecolorLegacy', params: ['getSettings', 'saveSettings', 'refreshRenderedView'] },
];

/**
 * One function with its doc comment, cut at its own braces (the scene
 * extractor's rule): the body's brace is the first after the parameter
 * list's close, past any `= null` default.
 * @param {string} source
 * @param {string} name
 */
export function sliceFunction(source, name) {
    const match = new RegExp(`^(?:export )?function ${name}\\(`, 'm').exec(source);
    if (!match) throw new Error(`no function ${name} in the source`);
    let start = match.index;
    const before = source.slice(0, start);
    const comment = /\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*$/.exec(before);
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
 * A piece's functions, each cut by its braces, in the order named. Not dedented (lesson 36).
 * @param {string} root
 * @param {{ file: string, functions: string[] }} piece
 */
export function sliceFunctions(root, piece) {
    const source = readFileSync(`${root}/${piece.file}`, 'utf8');
    return piece.functions.map((name) => `// ── ${piece.file}: ${name} ──\n${sliceFunction(source, name).trim()}\n`.replace(/^export /gm, '')).join('\n');
}

/**
 * Every name a module exports, in source order, read from the source rather than remembered.
 * @param {string} source
 */
export function exportedNames(source) {
    return [...source.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map((m) => m[1]);
}

/**
 * One module sliced whole, as the map themes are.
 * @param {string} root
 * @param {{ file: string, from: string }} module
 */
export function sliceModule(root, module) {
    const source = readFileSync(`${root}/${module.file}`, 'utf8');
    const start = source.indexOf(module.from);
    if (start < 0) throw new Error(`${module.file} no longer contains: ${module.from}`);
    if (source.slice(0, start).includes('import ')) throw new Error(`${module.file} now imports something; it can no longer be sliced whole`);
    // Not dedented (lesson 36).
    return `// ── ${module.file} ──\n${source.slice(start).trim()}\n`.replace(/^export /gm, '');
}

/**
 * A stretch of the stylesheet between two markers at a line's start, its comments out.
 * @param {string} css
 * @param {string} from
 * @param {string} to
 */
function cssBetween(css, from, to) {
    const start = css.indexOf(`\n${from}`);
    const end = css.indexOf(`\n${to}`, start);
    if (start < 0 || end < 0) throw new Error(`${SOURCE_CSS} no longer holds the rules between "${from}" and "${to}"`);
    return css.slice(start + 1, end).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The stylesheet's rules for the two animations, in the legacy's order: the
 * bar's lit segment and floater (its positioning rule, the host, the two
 * colours, the pop and release keyframes), then the XP row's gain state, its
 * floater and the floater's two states, the same under the bottom bar with
 * its own fade, and the dump keyframes with the reduced-motion block.
 * @param {string} css
 */
export function sliceBarAnimationCss(css) {
    return [
        cssBetween(css, '.rt-hp-bar-wrap[data-rt-bar-id],', '.rt-rel-float-layer {'),
        cssBetween(css, '.rt-xp-row.rt-xp-gain-active {', '.rt-xp-label {'),
        cssBetween(css, '.rt-xp-gain-floater {', '/* Persistent MMO-style XP bar'),
        cssBetween(css, '.rt-bottom-xp-content .rt-xp-row.rt-xp-gain-active {', '.rt-bottom-xp-content .rt-xp-label,'),
        cssBetween(css, '.rt-bottom-xp-content .rt-xp-gain-floater {', '/* The attached bar is display-only'),
        cssBetween(css, '@keyframes rt-xp-gain-dump {', '/* Character KV pairs */'),
    ].join('\n\n');
}

/**
 * The stylesheet's recolour rules (74i): the pointer and the hover on a
 * recolourable bar, and the barrel's two half-controls.
 * @param {string} css
 */
export function sliceRecolorCss(css) {
    return [
        cssBetween(css, '.rt-hp-bar-wrap[data-recolor-id], ', '.rt-quest-card {'),
        cssBetween(css, '.rt-barrel-color-control {', '.rt-barrel-fill {'),
    ].join('\n\n');
}

/** @param {string} root */
export function sliceLegacy(root) {
    const css = readFileSync(`${root}/${SOURCE_CSS}`, 'utf8');
    return {
        modules: MODULES.map((module) => ({ ...module, body: sliceModule(root, module), names: exportedNames(readFileSync(`${root}/${module.file}`, 'utf8')) })),
        functions: FUNCTIONS.map((piece) => ({ ...piece, body: sliceFunctions(root, piece) })),
        css: sliceBarAnimationCss(css),
        recolorCss: sliceRecolorCss(css),
    };
}

/** @param {ReturnType<typeof sliceLegacy>} slice */
export function renderLegacy(slice) {
    const factories = slice.modules.map((module) => `export function ${module.factory}() {\n${module.body}\n    return {\n        ${module.names.join(',\n        ')},\n    };\n}\n`).join('\n')
        + '\n' + slice.functions.map((piece) => `export function ${piece.factory}({ ${piece.params.join(', ')} }) {\n${piece.body}\n    return {\n        ${piece.functions.join(',\n        ')},\n    };\n}\n`).join('\n');
    return `/**
 * GENERATED by scripts/extract-bars.mjs from
 * MultihogAurelius/SillyTavern-MultihogDnDFramework @ ${PINNED_COMMIT}.
 * Do not edit. Regenerate with the script; it refuses any other commit.
 *
 * The animated bars (Phase 74h): \`src/ui/panel/bar-change-animation.js\`
 * whole — the transition between two rendered values of one bar, the
 * trickle's duration and frames, the capture of every bar's visible state
 * before a redraw and the playback after it — and
 * \`src/ui/panel/xp-gain-animation.js\` whole — the same for the experience
 * row's \`+N XP\` floater — each in its own factory, since each imports
 * nothing (CLAUDE.md 3a-bis); and their stylesheet rules read as text from
 * \`style.css\`. Since 74i also the bars' colours: \`getBarBackground\`,
 * \`getBarShowAsPercentage\` and \`getBarAnimateChanges\` of
 * \`src/state/settings.js\` and \`handleRecolor\` and \`resolvePickerColor\`
 * of \`theme-manager.js\`, each cut by its braces into a factory taking what
 * it reads from module scope, with the recolour rules of \`style.css\`.
 * \`src/frontend/bar-animation.ts\` is the typed face;
 * \`bars.pin.test.ts\` holds this file to a fresh slice of the pinned
 * checkout and its behaviour to the checkout's own modules.
 */
/* eslint-disable */
// @ts-nocheck

${factories}
/** The two animations' rules of \`style.css\`, in the legacy's order. */
export const LEGACY_BAR_ANIMATION_CSS = ${JSON.stringify(slice.css)};

/** The recolour rules of \`style.css\` (74i): the pointer and hover on a recolourable bar, the barrel's half-controls. */
export const LEGACY_RECOLOR_CSS = ${JSON.stringify(slice.recolorCss)};
`;
}

if (process.argv[1] && process.argv[1].endsWith('extract-bars.mjs')) {
    const dir = process.argv[2];
    if (!dir) {
        console.error('usage: node scripts/extract-bars.mjs <upstream-checkout>');
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
        console.error('  Refusing: the animated bars must match the build the gate is pinned to.');
        process.exit(2);
    }
    const slice = sliceLegacy(abs);
    writeFileSync(OUT, renderLegacy(slice));
    console.log(`wrote ${OUT} (${slice.modules.map((m) => `${m.body.length} characters, ${m.names.length} exports`).join('; ')}; ${slice.functions.map((f) => `${f.functions.length} functions of ${f.file}`).join('; ')}; ${slice.css.length} + ${slice.recolorCss.length} characters of CSS)`);
}
