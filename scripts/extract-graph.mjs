#!/usr/bin/env node
/**
 * Extract the map on screen from the pinned legacy build.
 *
 * Multihog's `dungeon-map-graph.js` turns a map document into the picture
 * the player sees: the knowledge-filtered node graph (visited and discovered
 * rooms, unrevealed ones as unlabeled fog stubs beside a known one), its
 * layered layout from the entrance, the inline SVG, and the readable
 * inspector of areas, routes and assets. `dungeon-map-icons.js` draws the
 * occupancy glyphs on each room: a kind's art, a mood's overlay, the
 * overflow badge and the hover cards. The *pure* parts are sliced here,
 * verbatim (CLAUDE.md 3a-bis): all of the graph module after its imports,
 * and the icon module minus the two things that are not pure -- the art
 * table, which resolves file URLs against `import.meta.url`, and the
 * stylesheet injector, which touches `document`. The thirteen kind glyphs
 * the art table names are written beside it, read from the checkout's own
 * SVG files, so the picture carries the legacy's art without its file
 * layout. The frontend turns them into one stylesheet of masks, as the
 * legacy's injector did.
 *
 *   node scripts/extract-graph.mjs /tmp/mh
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PINNED_COMMIT = 'd6aab004f97f1f9a286f235de62f22ba1abadbe8';
const OUT = 'src/tracker/graph-legacy.js';
const ART_OUT = 'src/tracker/graph-art.js';

/**
 * [file, from, to]: the slice runs from `from` to just before `to` (the
 * file's end for `null`).
 * @type {Array<[string, string, string | null]>}
 */
const SLICES = [
    // The kind order, the state sets; the art table is left out (it reads
    // file URLs off import.meta.url, which a bundle has no answer for).
    ['dungeon-map-icons.js', 'const KIND_ORDER = ', 'const KIND_ART = {'],
    // The overlays, the sizes and the fonts; the style injector is left out.
    ['dungeon-map-icons.js', 'const SLASH_OVERLAY = ', 'const KIND_ART_STYLE_ID = '],
    // The icon metrics, moods, collection, the glyph and card renderers.
    ['dungeon-map-icons.js', 'const ICON_STACK = {', null],
    // The graph module whole, after its imports.
    ['dungeon-map-graph.js', 'function escapeXml(value) {', null],
];

/**
 * The art table, read from the source rather than remembered: kind -> file.
 * @param {string} source
 * @returns {Array<[string, string]>}
 */
export function artTable(source) {
    const start = source.indexOf('const KIND_ART = {');
    const end = source.indexOf('};', start);
    if (start < 0 || end < 0) throw new Error('dungeon-map-icons.js no longer has the KIND_ART table');
    return [...source.slice(start, end).matchAll(/^\s*([A-Z]+): new URL\('\.\/(src\/ui\/SVG\/[\w.-]+\.svg)', import\.meta\.url\)\.href,$/gm)].map((m) => [m[1], m[2]]);
}

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

/**
 * The kind glyphs, each file's text as it is at the pin.
 * @param {string} root
 */
export function sliceArt(root) {
    const table = artTable(readFileSync(`${root}/dungeon-map-icons.js`, 'utf8'));
    if (table.length < 13) throw new Error(`the art table names ${table.length} kinds; expected at least 13`);
    const lines = table.map(([kind, file]) => `    ${kind}: ${JSON.stringify(readFileSync(`${root}/${file}`, 'utf8').trim())},`);
    return `export const MAP_KIND_ART = {\n${lines.join('\n')}\n};\n`;
}

if (process.argv[1] && process.argv[1].endsWith('extract-graph.mjs')) {
    const dir = process.argv[2];
    if (!dir) {
        console.error('usage: node scripts/extract-graph.mjs <upstream-checkout>');
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
        console.error('  Refusing: the map on screen must match the build the gate is pinned to.');
        process.exit(2);
    }
    const body = sliceLegacy(abs);
    const header = `/**
 * GENERATED by scripts/extract-graph.mjs from
 * MultihogAurelius/SillyTavern-MultihogDnDFramework @ ${PINNED_COMMIT}.
 * Do not edit. Regenerate with the script; it refuses any other commit.
 *
 * The map on screen: the knowledge-filtered node graph, its layout, its SVG,
 * the occupancy glyphs and their hover cards, and the readable inspector,
 * sliced verbatim from the legacy source and closed over the three things
 * they read from the map library (CLAUDE.md 3a-bis). \`src/tracker/graph.ts\`
 * is the typed face; \`graph.pin.test.ts\` holds this file to a fresh slice
 * of the pinned checkout.
 */
/* eslint-disable */
// @ts-nocheck

/**
 * @param {{ normalizeDungeonMapDocument: Function, resolveAssetEffectiveArea: Function, resolveCurrentMapPlacement: Function }} deps
 */
export function createGraphLegacy({ normalizeDungeonMapDocument, resolveAssetEffectiveArea, resolveCurrentMapPlacement }) {
`;
    const footer = `
    return {
        MAP_ICON_SIZE, MAP_ICON_GAP, MAP_ICON_MAX, MAP_NODE_FONT,
        mapNodeIconMetrics, mapAssetIconMood, mapAssetIconToken, collectAreaAssetIcons,
        renderDungeonGraphAssetTipHtml, renderDungeonGraphOverflowTipHtml, renderAreaAssetIconsSvg,
        resolveDungeonGraphCurrentArea, buildDungeonMapGraph, layoutDungeonMapGraph,
        renderDungeonMapGraphSvg, renderDungeonMapEmbedHtml, renderDungeonMapReadableHtml,
    };
}
`;
    writeFileSync(OUT, `${header}${body}${footer}`);
    console.log(`wrote ${OUT} (${body.length} characters of legacy source)`);
    const art = sliceArt(abs);
    writeFileSync(ART_OUT, `/**
 * GENERATED by scripts/extract-graph.mjs from
 * MultihogAurelius/SillyTavern-MultihogDnDFramework @ ${PINNED_COMMIT}.
 * Do not edit. Regenerate with the script; it refuses any other commit.
 *
 * The thirteen kind glyphs the map's occupancy icons are drawn with, each
 * the checkout's own SVG file as text, keyed as the legacy's art table keys
 * them. The frontend makes one stylesheet of masks from them.
 */
/* eslint-disable */
${art}`);
    console.log(`wrote ${ART_OUT} (${art.length} characters)`);
}
