#!/usr/bin/env node
/**
 * Extract Tab Mode's legacy pieces from the pinned build (Phase 76).
 *
 * Multihog's Tab Mode (`panelLayoutMode: 'tabs'`) pins the Character and
 * Combat cards above a compact tab strip holding every other module, with
 * a party-vitals strip between — a portrait and an HP ring per member.
 * `renderTabModeView` itself is a closure over the legacy's whole renderer
 * (its card drawer, its quest log, its collapse store, its settings), so
 * it is transcribed into `src/tracker/render.ts` as `renderTabModeHtml`;
 * what *can* be cut is cut here, by its own braces as the bars extractor
 * cuts (CLAUDE.md 3a-bis): the pinned tags, the vitals reader
 * (`extractPartyVitals`) and the vitals strip (`renderPartyVitalsStrip`),
 * each into one factory taking what it reads from module scope; and the
 * stylesheet's Tab Mode rules read as text. `src/tracker/tab-mode.ts` is
 * the typed face.
 *
 *   git clone --filter=blob:none \
 *     https://github.com/MultihogAurelius/SillyTavern-MultihogDnDFramework /tmp/mh
 *   git -C /tmp/mh checkout d6aab004f97f1f9a286f235de62f22ba1abadbe8
 *   node scripts/extract-tab-mode.mjs /tmp/mh
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PINNED_COMMIT = 'd6aab004f97f1f9a286f235de62f22ba1abadbe8';
const OUT = 'src/tracker/tab-mode-legacy.js';
export const SOURCE_JS = 'renderer.js';
export const SOURCE_CSS = 'style.css';
/** The two functions cut by their braces, in source order. */
export const FUNCTIONS = ['extractPartyVitals', 'renderPartyVitalsStrip'];
/** The one constant, read as its own line. */
export const CONSTANT = 'TABMODE_PINNED_TAGS';
/** What the two functions read from the renderer's module scope, handed to the factory. */
export const PARAMS = ['getBarShowAsPercentage', 'getBarBackground', 'renderPortraitHtml', 'escapeHtml', 'DEFAULT_HP_COLOR'];
export const FACTORY = 'createTabModeLegacy';

/**
 * One function with its doc comment, cut at its own braces (the bars
 * extractor's rule): the body's brace is the first after the parameter
 * list's close.
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
 * A top-level `const NAME = …;` line, as written.
 * @param {string} source
 * @param {string} name
 */
export function sliceConstant(source, name) {
    const match = new RegExp(`^const ${name} = .*;$`, 'm').exec(source);
    if (!match) throw new Error(`no constant ${name} in the source`);
    return match[0];
}

/**
 * A stretch of the stylesheet between two markers at a line's start, its comments out.
 * @param {string} css
 * @param {string} from
 * @param {string} to
 */
export function cssBetween(css, from, to) {
    const start = css.indexOf(`\n${from}`);
    const end = css.indexOf(`\n${to}`, start);
    if (start < 0 || end < 0) throw new Error(`${SOURCE_CSS} no longer holds the rules between "${from}" and "${to}"`);
    return css.slice(start + 1, end).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The stylesheet's Tab Mode rules, in the legacy's order: the wrap, the
 * pinned block, the vitals strip and its members, the tab strip, its
 * buttons and badges (up to the benched camp's rules, which are the
 * stacked card's); then the content pane and the touch block (up to the
 * empty state's rule).
 * @param {string} css
 */
export function sliceTabModeCss(css) {
    return [
        cssBetween(css, '.rt-tabmode-wrap {', '.rt-benched-panel {'),
        cssBetween(css, '.rt-tabmode-content {', '.rt-empty {'),
    ].join('\n\n');
}

/** @param {string} root */
export function sliceLegacy(root) {
    const source = readFileSync(`${root}/${SOURCE_JS}`, 'utf8');
    const css = readFileSync(`${root}/${SOURCE_CSS}`, 'utf8');
    // Not dedented (lesson 36).
    const body = [
        `// ── ${SOURCE_JS}: ${CONSTANT} ──\n${sliceConstant(source, CONSTANT)}\n`,
        ...FUNCTIONS.map((name) => `// ── ${SOURCE_JS}: ${name} ──\n${sliceFunction(source, name).trim()}\n`.replace(/^export /gm, '')),
    ].join('\n');
    return { body, css: sliceTabModeCss(css) };
}

/** @param {ReturnType<typeof sliceLegacy>} slice */
export function renderLegacy(slice) {
    return `/**
 * GENERATED by scripts/extract-tab-mode.mjs from
 * MultihogAurelius/SillyTavern-MultihogDnDFramework @ ${PINNED_COMMIT}.
 * Do not edit. Regenerate with the script; it refuses any other commit.
 *
 * Tab Mode's legacy pieces (Phase 76): the pinned tags, the party-vitals
 * reader and the vitals strip of \`renderer.js\`, each cut by its braces
 * into one factory taking what they read from the renderer's module scope
 * (CLAUDE.md 3a-bis), and the Tab Mode rules of \`style.css\` read as
 * text. \`renderTabModeView\` itself is a closure over the whole renderer
 * and is transcribed in \`src/tracker/render.ts\`. \`src/tracker/tab-mode.ts\`
 * is the typed face; \`tab-mode.pin.test.ts\` holds this file to a fresh
 * slice of the pinned checkout and the reader to the checkout's own.
 */
/* eslint-disable */
// @ts-nocheck

export function ${FACTORY}({ ${PARAMS.join(', ')} }) {
${slice.body}
    return {
        ${[CONSTANT, ...FUNCTIONS].join(',\n        ')},
    };
}

/** The Tab Mode rules of \`style.css\`, in the legacy's order. */
export const LEGACY_TAB_MODE_CSS = ${JSON.stringify(slice.css)};
`;
}

if (process.argv[1] && process.argv[1].endsWith('extract-tab-mode.mjs')) {
    const dir = process.argv[2];
    if (!dir) {
        console.error('usage: node scripts/extract-tab-mode.mjs <upstream-checkout>');
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
        console.error('  Refusing: Tab Mode must match the build the gate is pinned to.');
        process.exit(2);
    }
    const slice = sliceLegacy(abs);
    writeFileSync(OUT, renderLegacy(slice));
    console.log(`wrote ${OUT}: ${CONSTANT}, ${FUNCTIONS.join(', ')}; ${slice.css.length} chars of CSS`);
}
