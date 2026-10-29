/**
 * Game Cartridges — build, apply, export, import.
 *
 * A cartridge is a whole Multihog configuration in one shareable file:
 * sysprompt sections and their order, Game Systems, tracker modules, block
 * order, stock prompts, the State Tracker extractor prompt, the Lorebook
 * Agent's prompts and modules, portrait templates, map prompts, RNG and
 * time-format flags. Sub-modules authored inside one are data, not code, so
 * preserving this format is what carries years of authoring across the
 * migration intact.
 *
 * The format is `multihog-game-cartridge` version 1 and it does not move.
 * tests/ locks it, unmodified, against both the legacy SillyTavern build and
 * this one; see CLAUDE.md rules 1 and 2.
 *
 * Two behaviours here look like bugs and are not (CLAUDE.md rule 4):
 *
 *   1. `applyCartridgePayload` *deletes* the two `_activePreset_*` keys. They
 *      name a preset on the machine that exported the cartridge. On another
 *      machine that name may not exist, or may name a different preset, so
 *      round-tripping them faithfully would reintroduce a bug rather than
 *      preserve state.
 *   2. Missing keys backfill from factory defaults instead of erroring. That
 *      is what lets a cartridge exported by an older build load into a newer
 *      one, and a partial cartridge load at all.
 *
 * This file stays plain .js: the frozen suite imports `../src/cartridges.js`
 * by that exact path.
 */

import { getFactoryCartridgePayload } from './state/factory.js';

/** Envelope marker. A file without exactly this string is not a cartridge. */
export const CARTRIDGE_FORMAT = 'multihog-game-cartridge';

/** Envelope version. Still 1; there has never been a version 2. */
export const CARTRIDGE_VERSION = 1;

/**
 * Machine-local settings keys stripped on load. See note 1 above.
 * @type {readonly string[]}
 */
export const CARTRIDGE_SIDE_CHANNEL_KEYS = Object.freeze([
    '_activePreset_npcSectionPresets',
    '_activePreset_pcSectionPresets',
]);

/**
 * Deep clone through JSON — same reasoning as in state/factory.js: it is the
 * clone semantics a cartridge actually survives on the wire.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepCloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

/**
 * Snapshot the cartridge surface out of a live settings object.
 *
 * Iterates the factory payload, never the settings object: a settings key
 * that is not part of the cartridge surface is not exported, and a cartridge
 * key the user has never touched is exported at its factory value rather
 * than as a hole.
 *
 * @param {Record<string, unknown>} settings Live settings. Not mutated.
 * @returns {Record<string, unknown>} A payload owning all of its own data.
 */
export function buildCartridgePayload(settings) {
    const factory = getFactoryCartridgePayload();
    const source = settings ?? {};
    /** @type {Record<string, unknown>} */
    const payload = {};
    for (const key of Object.keys(factory)) {
        const value = source[key];
        payload[key] = value === undefined ? factory[key] : deepCloneJson(value);
    }
    return payload;
}

/**
 * Load a cartridge payload into a live settings object, in place.
 *
 * Only cartridge-surface keys are written, so unrelated settings (the saved
 * cartridge library itself, UI state, connection choices) survive a load
 * untouched. Unknown keys in the payload are ignored, which is what lets a
 * cartridge from a *newer* build load into an older one.
 *
 * @param {Record<string, unknown>} settings Mutated in place.
 * @param {Record<string, unknown> | null | undefined} payload
 *   May be partial, or absent entirely — a missing payload restores factory
 *   defaults rather than throwing.
 * @returns {void}
 */
export function applyCartridgePayload(settings, payload) {
    const factory = getFactoryCartridgePayload();
    for (const key of Object.keys(factory)) {
        const incoming = (payload && payload[key] !== undefined) ? payload[key] : factory[key];
        settings[key] = deepCloneJson(incoming);
    }
    for (const key of CARTRIDGE_SIDE_CHANNEL_KEYS) {
        delete settings[key];
    }
}

/**
 * Wrap a stored cartridge in the envelope that goes over the wire.
 *
 * Deliberately narrow: `id`, `createdAt` and `updatedAt` are local library
 * bookkeeping and are not somebody else's business once the file is shared.
 *
 * @param {{ name?: string, description?: string, icon?: string, payload?: Record<string, unknown> }} cartridge
 * @returns {{ format: string, version: number, name: unknown, description: unknown, icon: unknown, payload: unknown }}
 */
export function buildCartridgeExportObject(cartridge) {
    return {
        format: CARTRIDGE_FORMAT,
        version: CARTRIDGE_VERSION,
        name: cartridge.name,
        description: cartridge.description,
        icon: cartridge.icon,
        payload: cartridge.payload,
    };
}

/**
 * Parse a cartridge file and normalise its payload to the full key set.
 *
 * Rejects exactly two things — text that is not JSON, and JSON that does not
 * carry the format marker. Everything else is accepted and backfilled, on
 * purpose: a cartridge that predates a key is still a valid cartridge.
 *
 * @param {string} text Raw file contents.
 * @returns {Record<string, unknown> & { payload: Record<string, unknown> }}
 * @throws {Error} If the text is not JSON, or is not a cartridge.
 */
export function parseImportedCartridge(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error('Could not parse that as JSON.');
    }

    if (!parsed || parsed.format !== CARTRIDGE_FORMAT) {
        throw new Error(`Not a recognized Game Cartridge (expected format "${CARTRIDGE_FORMAT}").`);
    }

    const factory = getFactoryCartridgePayload();
    /** @type {Record<string, unknown>} */
    const payload = {};
    for (const key of Object.keys(factory)) {
        payload[key] = (parsed.payload && parsed.payload[key] !== undefined)
            ? parsed.payload[key]
            : factory[key];
    }

    return { ...parsed, payload };
}
