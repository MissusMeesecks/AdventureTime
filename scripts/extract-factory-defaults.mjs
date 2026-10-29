/**
 * extract-factory-defaults.mjs
 * ─────────────────────────────────────────────────────────────────────────
 * Regenerates src/state/factory-defaults.js from a checkout of the pinned
 * legacy source.
 *
 * The factory payload is the authority for the whole cartridge surface (see
 * CLAUDE.md rule 3), so its values must come from the legacy build rather
 * than from anybody's memory. This script derives them by *running* the
 * legacy code, not by transcribing it: upstream's own
 * `getFactoryCartridgePayload()` is imported and called, and its output is
 * written out verbatim.
 *
 * That makes the result re-derivable. If you ever want to know whether
 * src/state/factory-defaults.js still matches the pin, re-run this and see
 * whether git reports a diff.
 *
 * Usage:
 *   git clone --filter=blob:none \
 *     https://github.com/MultihogAurelius/SillyTavern-MultihogDnDFramework /tmp/mh
 *   git -C /tmp/mh checkout d6aab004f97f1f9a286f235de62f22ba1abadbe8
 *   node scripts/extract-factory-defaults.mjs /tmp/mh
 *
 * The upstream checkout is reference material only. Nothing in AdventureTime's
 * build or test path reads it — this script is run by hand, and its output
 * is committed.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

import { CARTRIDGE_PAYLOAD_GROUPS } from '../src/state/payload-groups.js';

/** The commit docs/UPSTREAM.md pins. Extracting from anything else is a warning. */
const PINNED_COMMIT = 'd6aab004f97f1f9a286f235de62f22ba1abadbe8';

const upstreamDir = process.argv[2];
if (!upstreamDir) {
    console.error('usage: node scripts/extract-factory-defaults.mjs <path-to-upstream-checkout>');
    process.exit(2);
}

const abs = path.resolve(upstreamDir);

let head = '(unknown)';
try {
    head = execFileSync('git', ['-C', abs, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
    console.error(`! ${abs} is not a git checkout; cannot record provenance.`);
    process.exit(2);
}

if (head !== PINNED_COMMIT) {
    console.error(`! checkout is at ${head}, not the pinned ${PINNED_COMMIT}.`);
    console.error('  Check out the pin, or update docs/UPSTREAM.md deliberately first.');
    process.exit(2);
}

const upstreamFactoryPath = path.join(abs, 'src/state/factory-and-diff.js');
const upstream = await import(pathToFileURL(upstreamFactoryPath).href);

// The schema itself must agree before the values are worth anything. If
// upstream has regrouped or renamed a key, stop rather than silently
// producing defaults for a different contract.
const ourKeys = CARTRIDGE_PAYLOAD_GROUPS.flatMap((g) => g.keys).sort();
const theirKeys = upstream.CARTRIDGE_PAYLOAD_GROUPS.flatMap(
    (/** @type {{ keys: string[] }} */ g) => g.keys,
).sort();
if (JSON.stringify(ourKeys) !== JSON.stringify(theirKeys)) {
    console.error('! upstream CARTRIDGE_PAYLOAD_GROUPS no longer matches src/state/payload-groups.js.');
    console.error('  ours   :', ourKeys.length, 'keys');
    console.error('  theirs :', theirKeys.length, 'keys');
    console.error('  This is a contract change. Do not paper over it here.');
    process.exit(1);
}

const payload = upstream.getFactoryCartridgePayload();

// Running the same call twice must give the same answer; a default that
// embeds "now" would make this file drift every time it is regenerated.
if (JSON.stringify(payload) !== JSON.stringify(upstream.getFactoryCartridgePayload())) {
    console.error('! upstream factory payload is not deterministic across calls.');
    process.exit(1);
}

const missing = ourKeys.filter((k) => payload[k] === undefined);
if (missing.length) {
    console.error('! upstream factory produced no value for:', missing.join(', '));
    process.exit(1);
}

const banner = `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * The factory cartridge payload as the legacy SillyTavern build produces it:
 * all ${ourKeys.length} keys of CARTRIDGE_PAYLOAD_GROUPS, with the stock prompt text,
 * module tables and flag defaults that shipped with it.
 *
 * Provenance
 *   repo   MultihogAurelius/SillyTavern-MultihogDnDFramework (frozen fork)
 *   commit ${head}
 *   path   src/state/factory-and-diff.js -> getFactoryCartridgePayload()
 *
 * Extracted by running that function, not by transcribing it. Regenerate
 * with scripts/extract-factory-defaults.mjs; see docs/UPSTREAM.md for the
 * pin and why it matters.
 *
 * These values are the *factory* defaults, which is not the same thing as
 * anybody's live configuration. They are what a missing cartridge key
 * backfills from, and what a fresh install starts at.
 *
 * @type {Record<string, unknown>}
 */

export const FACTORY_CARTRIDGE_DEFAULTS = `;

const out = banner + JSON.stringify(payload, null, 4) + ';\n';
const target = new URL('../src/state/factory-defaults.js', import.meta.url);
writeFileSync(target, out, 'utf8');

console.log(`wrote src/state/factory-defaults.js`);
console.log(`  keys   ${ourKeys.length}`);
console.log(`  size   ${(out.length / 1024).toFixed(1)} KB`);
console.log(`  commit ${head}`);
