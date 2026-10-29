#!/usr/bin/env node
/**
 * Regenerates src/frontend/themes-legacy.js from a checkout of the pinned
 * legacy build.
 *
 * Multihog's visual themes (Phase 74a, departure 81) are seven blocks of
 * `style.css` — `.rpg-tracker-panel.rt-theme-<name> { … }`, fifteen
 * `--rt-*` variables each (Fantasy has fourteen: no card header) — plus
 * the scrollbar and accent rules two of them carry (Pacific Cove, Cherry
 * Blossom), the select's seven entries in `settings.html`, and (74b) the AI
 * Theme Wizard's system prompt, its two user-message frames and the fifteen
 * keys it expects back, from `openThemeWizard` in `theme-manager.js`, and
 * (74c) the day/night cycle: `getTimeOfDayInfo` and the moon phases from
 * `renderer.js`, the seven phase palettes with their `@property`
 * registrations and the crossfade's list, the backdrop scrims (for 74d) and
 * the sky badge's, the head slot's and the header starfield's rules from
 * `style.css`; and (74d) the backdrops' three functions from
 * `src/ui/panel/panel-appearance.js` — which image shows and how strong
 * the tint is, the CSS url() of a stored image, and the scaling of an
 * uploaded one. This reads the declarations out of the stylesheet as text,
 * verbatim, so the Hacker green and the Cherry pink are Multihog's own
 * numbers; `themes.ts` is the face that writes them as `--lh-*` tokens,
 * `day-night.ts` the cycle's, and `themes.pin.test.ts` holds the generated
 * file to a fresh slice.
 *
 * Usage: node scripts/extract-themes.mjs <path-to-upstream-checkout>
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/** The commit docs/UPSTREAM.md pins. Extracting from anything else is refused. */
const PINNED = 'd6aab004f97f1f9a286f235de62f22ba1abadbe8';

export const SOURCE_CSS = 'style.css';
export const SOURCE_HTML = 'settings.html';
export const SOURCE_WIZARD = 'theme-manager.js';
export const SOURCE_RENDERER = 'renderer.js';
export const SOURCE_APPEARANCE = 'src/ui/panel/panel-appearance.js';
/** The two comments that bound the themes' own scrollbar and accent rules. */
const EXTRAS_FROM = '/* Pacific Cove Scrollbar */';
const EXTRAS_TO = '/* Slim Scrollbars */';

/**
 * The theme blocks, in source order: `{ name: { '--rt-bg': 'rgba(…)', … } }`.
 * @param {string} css
 */
export function sliceThemeVars(css) {
    /** @type {Record<string, Record<string, string>>} */
    const themes = {};
    for (const block of css.matchAll(/^\.rpg-tracker-panel\.rt-theme-([a-z]+) \{\n([\s\S]*?)\n\}/gm)) {
        const name = block[1];
        /** @type {Record<string, string>} */
        const vars = {};
        for (const decl of block[2].matchAll(/^\s*(--rt-[\w-]+):\s*(.+?);\s*$/gm)) vars[decl[1]] = decl[2];
        if (Object.keys(vars).length === 0) throw new Error(`${SOURCE_CSS}: the ${name} theme block holds no --rt- variable`);
        themes[name] = vars;
    }
    if (Object.keys(themes).length === 0) throw new Error(`${SOURCE_CSS} no longer holds any .rpg-tracker-panel.rt-theme-* block`);
    return themes;
}

/**
 * The rules a theme carries beyond its variables (scrollbars, pills), by
 * theme name, as CSS text with the legacy's own selectors.
 * @param {string} css
 */
export function sliceThemeExtras(css) {
    const start = css.indexOf(EXTRAS_FROM);
    const end = css.indexOf(EXTRAS_TO);
    if (start < 0 || end < 0 || end < start) throw new Error(`${SOURCE_CSS} no longer holds the themes' extras between "${EXTRAS_FROM}" and "${EXTRAS_TO}"`);
    /** @type {Record<string, string>} */
    const extras = {};
    for (const rule of css.slice(start, end).matchAll(/^\.rt-theme-([a-z]+)[^{]*\{[^}]*\}/gm)) {
        extras[rule[1]] = `${extras[rule[1]] ?? ''}${rule[0]}\n`;
    }
    if (Object.keys(extras).length === 0) throw new Error(`${SOURCE_CSS}: no .rt-theme-* rule between the extras' comments`);
    return extras;
}

/**
 * The select's entries in order: `[{ value: 'native', label: 'Match ST UI' }, …]`.
 * @param {string} html
 */
export function sliceThemeOptions(html) {
    const select = html.match(/<select id="rpg_tracker_theme_select"[^>]*>([\s\S]*?)<\/select>/);
    if (!select) throw new Error(`${SOURCE_HTML} no longer holds the theme select`);
    const options = [...select[1].matchAll(/<option value="rt-theme-([a-z]+)">([^<]*)<\/option>/g)].map((m) => ({ value: m[1], label: m[2] }));
    if (options.length === 0) throw new Error(`${SOURCE_HTML}: the theme select has no rt-theme-* option`);
    return options;
}

/**
 * The AI Theme Wizard's texts (74b): the system prompt (a template literal
 * with no placeholder), the two user-message frames with their `${…}`
 * placeholders kept verbatim, and the expected keys, all read off
 * `openThemeWizard` as text.
 * @param {string} js
 */
export function sliceThemeWizard(js) {
    // Up to the next top-level export: the prompt's own JSON example ends a line with `}`.
    const fn = js.match(/export async function openThemeWizard\([\s\S]*?(?=\nexport function )/);
    if (!fn) throw new Error(`${SOURCE_WIZARD} no longer holds openThemeWizard`);
    const body = fn[0];
    const system = body.match(/const systemPrompt = `([\s\S]*?)`;/);
    if (!system || system[1].includes('${')) throw new Error(`${SOURCE_WIZARD}: the wizard's system prompt is missing or now interpolates`);
    const iteration = body.match(/\? `([^`]*)`\n\s*: `([^`]*)`;/);
    if (!iteration) throw new Error(`${SOURCE_WIZARD}: the wizard's two user-message frames were not found`);
    const expected = body.match(/const expected = \[([\s\S]*?)\];/);
    if (!expected) throw new Error(`${SOURCE_WIZARD}: the wizard's expected keys were not found`);
    const expectedKeys = [...expected[1].matchAll(/'(--rt-custom-[\w-]+)'/g)].map((m) => m[1]);
    if (expectedKeys.length === 0) throw new Error(`${SOURCE_WIZARD}: the wizard's expected keys list is empty`);
    const missingLimit = body.match(/if \(missing\.length > (\d+)\)/);
    if (!missingLimit) throw new Error(`${SOURCE_WIZARD}: the wizard's missing-keys tolerance was not found`);
    // The two frames are one-line literals whose newlines are `\n` escapes in the source; the prompt's are real.
    const unescape = (/** @type {string} */ text) => text.replace(/\\n/g, '\n');
    return { systemPrompt: system[1], iterationFrame: unescape(iteration[1]), newFrame: unescape(iteration[2]), expectedKeys, missingTolerated: Number(missingLimit[1]) };
}

/**
 * The day/night cycle's reader (74c): `getTimeOfDayInfo` whole — it reads
 * only its argument — and the phases that show the moon, both from the
 * renderer, as text.
 * @param {string} js
 */
export function sliceTimeOfDay(js) {
    const fn = js.match(/^export function getTimeOfDayInfo\(str\) \{\n[\s\S]*?\n\}/m);
    if (!fn) throw new Error(`${SOURCE_RENDERER} no longer holds getTimeOfDayInfo`);
    if (/\b(getSettings|document|window|localStorage)\b/.test(fn[0])) throw new Error(`${SOURCE_RENDERER}: getTimeOfDayInfo reads something beyond its argument now`);
    const moon = js.match(/const DAYNIGHT_MOON_PHASES = new Set\(\[([^\]]*)\]\);/);
    if (!moon) throw new Error(`${SOURCE_RENDERER} no longer holds DAYNIGHT_MOON_PHASES`);
    const moonPhases = [...moon[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
    if (moonPhases.length === 0) throw new Error(`${SOURCE_RENDERER}: DAYNIGHT_MOON_PHASES is empty`);
    return { getTimeOfDayInfo: fn[0], moonPhases };
}

/**
 * The backdrops' functions (74d), as text: `getPanelBgConfig` (which image
 * shows for the day and the night, the tint's strength, whether there is
 * one), `cssUrlFromImageSrc` and `scalePanelBackgroundImage`, each reading
 * only its arguments (the last the browser's Image and canvas).
 * @param {string} js
 */
export function sliceAppearance(js) {
    /** @param {string} name */
    const fn = (name) => {
        const m = js.match(new RegExp(`^(?:export )?function ${name}\\([^)]*\\) \\{\\n[\\s\\S]*?\\n\\}`, 'm'));
        if (!m) throw new Error(`${SOURCE_APPEARANCE} no longer holds ${name}`);
        if (/\b(getSettings|getRuntimeActions|toastr|document\.getElementById)\b/.test(m[0])) throw new Error(`${SOURCE_APPEARANCE}: ${name} reads something beyond its arguments now`);
        return m[0].replace(/^function /, 'export function ');
    };
    return { getPanelBgConfig: fn('getPanelBgConfig'), cssUrlFromImageSrc: fn('cssUrlFromImageSrc'), scalePanelBackgroundImage: fn('scalePanelBackgroundImage') };
}

/**
 * A stretch of the stylesheet between two markers, its comments taken out (they are mojibake at the pin).
 * @param {string} css
 * @param {string} from
 * @param {string} to
 */
function cssBetween(css, from, to) {
    // Both markers at a line's start: a scoped rule holds the same selector mid-line.
    const start = css.indexOf(`\n${from}`);
    const end = css.indexOf(`\n${to}`, start);
    if (start < 0 || end < 0) throw new Error(`${SOURCE_CSS} no longer holds the rules between "${from}" and "${to}"`);
    return css.slice(start + 1, end).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The day/night cycle's stylesheet pieces (74c): the seven phase palettes
 * (`.rpg-tracker-panel.rt-daynight-active.rt-phase-<phase>`), the backdrop
 * scrim each phase sets over a background image (74d), the `@property`
 * registrations the crossfade needs with their initial values, the
 * crossfade's own transition list, and three stretches of rules as text —
 * the sky badge's, the head slot's and the header starfield's.
 * @param {string} css
 */
export function sliceDayNight(css) {
    /** @type {Record<string, Record<string, string>>} */
    const phases = {};
    for (const block of css.matchAll(/^\.rpg-tracker-panel\.rt-daynight-active\.rt-phase-(\w+) \{\n([\s\S]*?)\n\}/gm)) {
        /** @type {Record<string, string>} */
        const vars = {};
        for (const decl of block[2].matchAll(/^\s*(--rt-[\w-]+):\s*(.+?);\s*$/gm)) vars[decl[1]] = decl[2];
        if (Object.keys(vars).length === 0) throw new Error(`${SOURCE_CSS}: the ${block[1]} phase block holds no --rt- variable`);
        phases[block[1]] = vars;
    }
    if (Object.keys(phases).length === 0) throw new Error(`${SOURCE_CSS} no longer holds any .rt-daynight-active.rt-phase-* block`);
    /** @type {Record<string, string>} */
    const overlays = {};
    for (const rule of css.matchAll(/^\.rpg-tracker-panel\.rt-has-bg-image\.rt-daynight-active\.rt-phase-(\w+) \{\n\s*--rt-bg-overlay-color: (.+?);\n\}/gm)) overlays[rule[1]] = rule[2];
    if (Object.keys(overlays).length !== Object.keys(phases).length) throw new Error(`${SOURCE_CSS}: ${Object.keys(overlays).length} backdrop scrims for ${Object.keys(phases).length} phases`);
    /** @type {Record<string, string>} */
    const properties = {};
    for (const reg of css.matchAll(/^@property (--rt-[\w-]+) \{\n\s*syntax: '<color>';\n\s*inherits: true;\n\s*initial-value: (.+?);\n\}/gm)) properties[reg[1]] = reg[2];
    if (Object.keys(properties).length === 0) throw new Error(`${SOURCE_CSS} no longer registers the --rt-* colours with @property`);
    const transition = css.match(/^\.rpg-tracker-panel\.rt-daynight-active \{\n\s*transition:\n([\s\S]*?);\n\}/m);
    if (!transition) throw new Error(`${SOURCE_CSS} no longer declares the day/night crossfade on .rt-daynight-active`);
    const transitions = transition[1].split('\n').map((line) => line.trim().replace(/,$/, '')).filter(Boolean);
    const rules = {
        badge: cssBetween(css, '.rt-daynight-badge {', '@property --rt-bg {'),
        head: cssBetween(css, '#rt-daynight-badge-slot:empty {', '.rpg-tracker-header {'),
        starfield: cssBetween(css, '.rt-header-starfield {', '.rpg-tracker-header-left {'),
    };
    return { phases, overlays, properties, transitions, rules };
}

/** @param {string} root */
export function sliceThemes(root) {
    const css = readFileSync(path.join(root, SOURCE_CSS), 'utf8');
    const html = readFileSync(path.join(root, SOURCE_HTML), 'utf8');
    const js = readFileSync(path.join(root, SOURCE_WIZARD), 'utf8');
    const renderer = readFileSync(path.join(root, SOURCE_RENDERER), 'utf8');
    const appearance = readFileSync(path.join(root, SOURCE_APPEARANCE), 'utf8');
    return { vars: sliceThemeVars(css), extras: sliceThemeExtras(css), options: sliceThemeOptions(html), wizard: sliceThemeWizard(js), dayNight: sliceDayNight(css), timeOfDay: sliceTimeOfDay(renderer), appearance: sliceAppearance(appearance) };
}

/**
 * The generated module's text.
 * @param {ReturnType<typeof sliceThemes>} slice
 * @param {string} head
 */
export function renderLegacy(slice, head) {
    const lines = [
        '/**',
        ' * GENERATED by scripts/extract-themes.mjs from',
        ` * MultihogAurelius/SillyTavern-MultihogDnDFramework @ ${head}.`,
        ' * Do not edit. Regenerate with the script; it refuses any other commit.',
        ' *',
        " * Multihog's visual themes (departure 81, Phase 74a): the seven",
        ` * \`.rpg-tracker-panel.rt-theme-*\` blocks of \`${SOURCE_CSS}\`, their --rt-*`,
        ' * variables verbatim; the scrollbar and accent rules two themes carry;',
        ` * the select's entries from \`${SOURCE_HTML}\`, and the AI Theme Wizard's`,
        ` * prompt, user-message frames and expected keys from \`${SOURCE_WIZARD}\``,
        ' * (74b); the day/night cycle (74c): the time-of-day reader and the moon',
        ` * phases from \`${SOURCE_RENDERER}\`, the seven phase palettes, the backdrop`,
        ' * scrims, the @property registrations, the crossfade list and the badge,',
        ` * slot and starfield rules from \`${SOURCE_CSS}\`; the backdrops (74d): which`,
        ' * image shows and the tint, the CSS url() and the upload scaling from',
        ` * \`${SOURCE_APPEARANCE}\`.`,
        ' * `src/frontend/themes.ts` is the face; `src/tracker/theme-wizard.ts`',
        " * the wizard's; `src/frontend/day-night.ts` the cycle's; `src/frontend/backdrop.ts`",
        " * the backdrops';",
        ' * `themes.pin.test.ts` holds this file to a fresh slice.',
        ' */',
        '/* eslint-disable */',
        `export const LEGACY_THEME_VARS = ${JSON.stringify(slice.vars, null, 4)};`,
        `export const LEGACY_THEME_EXTRAS = ${JSON.stringify(slice.extras, null, 4)};`,
        `export const LEGACY_THEME_OPTIONS = ${JSON.stringify(slice.options, null, 4)};`,
        `export const LEGACY_THEME_WIZARD = ${JSON.stringify(slice.wizard, null, 4)};`,
        `export const LEGACY_DAY_NIGHT = ${JSON.stringify(slice.dayNight, null, 4)};`,
        `export const LEGACY_MOON_PHASES = ${JSON.stringify(slice.timeOfDay.moonPhases)};`,
        '',
        "/** Multihog's time-of-day reader, verbatim: the hour, the card's emoji and colour, the phase. @param {string} str */",
        slice.timeOfDay.getTimeOfDayInfo,
        '',
        "/** Multihog's backdrop rule, verbatim: the day's and the night's image (each falling to the other), the tint's strength 0–1, whether there is an image. @param {Record<string, unknown>} settings @param {{ dayKey: string, nightKey: string, strengthKey: string }} keys */",
        slice.appearance.getPanelBgConfig,
        '',
        "/** Multihog's CSS url() of a stored image, verbatim. @param {string} src */",
        slice.appearance.cssUrlFromImageSrc,
        '',
        "/** Multihog's scaling of an uploaded backdrop, verbatim: the longer side to 1280 px, as a JPEG. @param {string} dataUrl @param {number} [maxDim] @returns {Promise<string>} */",
        slice.appearance.scalePanelBackgroundImage,
    ];
    return `${lines.join('\n')}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const upstreamDir = process.argv[2];
    if (!upstreamDir) {
        console.error('usage: node scripts/extract-themes.mjs <path-to-upstream-checkout>');
        process.exit(2);
    }
    const abs = path.resolve(upstreamDir);
    const head = execFileSync('git', ['-C', abs, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (head !== PINNED) {
        console.error(`! checkout is at ${head}, not the pinned ${PINNED}.`);
        process.exit(2);
    }
    const slice = sliceThemes(abs);
    const out = path.resolve('src/frontend/themes-legacy.js');
    writeFileSync(out, renderLegacy(slice, head));
    console.log(`wrote ${out} (${Object.keys(slice.vars).length} themes, ${Object.keys(slice.extras).length} with extras, ${slice.options.length} options, the wizard's ${slice.wizard.expectedKeys.length} keys, ${Object.keys(slice.dayNight.phases).length} day/night phases, the backdrops' ${Object.keys(slice.appearance).length} functions)`);
}
