import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { DEFAULT_TIMEOUT_MS, MODEL_CALLING_OPS, OP_TIMEOUT_MS } from './bridge.js'

/**
 * The ops whose backend handler reaches a model, read out of the backend's
 * own source rather than remembered.
 *
 * The hand-kept list guarded the deadlines twice and then missed the third
 * time (`wizard.revise`, Phase 32): nobody added the op, so the lock had
 * nothing to check. This walks `requests.ts`'s dispatch — `case 'x.y': return
 * handler(...)` — into each handler's body and asks whether it touches one of
 * the dependencies that call a model. Crude on purpose: a false positive
 * fails loudly and is a one-line fix; a list that has to be remembered fails
 * silently, in a live session.
 */
function opsThatCallAModel(): string[] {
    const source = readFileSync(new URL('../backend/requests.ts', import.meta.url), 'utf8')
    const modelDeps = /deps\.(trackerPass\.run|agentPass|agentInstruct|agentCleanup|agentAudit|wizard\.(draft|revise)|world\.(run|skeleton|writeSource|consolidateNow)|map\.updater\.run|map\.evolution\.run|map\.create|map!\.sandbox!\.(evolve|simulate|redo)|creator\.(generate|instant|ways|importCard|card\.write)|library\.(party|playAsPc|drawPhoto|photoPrompt)|portraitAuto\.(draw|prompt)|npcCreator\.(draft|add)|sceneArt\.(draw|prompt))\b/
    const handlers = new Map<string, string>()
    for (const match of source.matchAll(/^async function (\w+)\(([\s\S]*?)\n\}/gm)) handlers.set(match[1]!, match[2]!)
    const ops: string[] = []
    for (const match of source.matchAll(/case '([\w.]+)':\s*\n\s*return (\w+)\(/g)) {
        const body = handlers.get(match[2]!)
        if (body && modelDeps.test(body)) ops.push(match[1]!)
    }
    return ops
}

/**
 * A lock, in the shape this project uses for the cartridge surface and the
 * marker vocabulary: adding an op that calls a model fails this test until it
 * is given a deadline of its own.
 *
 * The bug it prevents has happened twice. Both times a pass was running
 * perfectly well and the panel said it had timed out, which reads as a failure
 * and sends the next session looking in the wrong place.
 */
describe('every op that calls a model has its own deadline', () => {
    it.each(MODEL_CALLING_OPS)('%s waits longer than the default', (op) => {
        expect(OP_TIMEOUT_MS[op]).toBeDefined()
        expect(OP_TIMEOUT_MS[op]!).toBeGreaterThan(DEFAULT_TIMEOUT_MS)
    })

    // A composite op makes several model calls in a row (lesson 45): its
    // deadline must cover them all, not one. The creator's three write the
    // sheet, then the card, then the persona.
    it.each(['creator.generate', 'creator.instant', 'creator.ways', 'creator.import'] as const)('%s waits for the sheet, the card and the persona', (op) => {
        expect(OP_TIMEOUT_MS[op]!).toBeGreaterThanOrEqual(OP_TIMEOUT_MS['tracker.run']! + OP_TIMEOUT_MS['creator.card.write']!)
    })

    it('is the list the backend source gives, not one that has to be remembered', () => {
        const derived = opsThatCallAModel()
        // Sanity: the walk found the handlers at all.
        expect(derived.length).toBeGreaterThanOrEqual(9)
        expect([...MODEL_CALLING_OPS].sort()).toEqual([...derived].sort())
    })

    /**
     * The walk above knows only the dependencies it names, and missed the
     * creator's (Phase 35, lesson 43): a new dependency that calls a model is
     * invisible to it until someone adds it, which is the remembering the
     * walk was meant to end. So every op the backend dispatches must be
     * placed, deliberately, either among the slow ones (a deadline in
     * `OP_TIMEOUT_MS`) or among these, which answer in lookup time. A new op
     * fails here until it is placed — the shape of the cartridge-surface and
     * marker-vocabulary locks.
     */
    const FAST_OPS = [
        'agent.cancel', 'agent.undo', 'agent.redo', 'agent.audit.stop', 'campaign.name', 'cartridge.export', 'cartridge.import', 'connections.list',
        'creator.card.get', 'creator.card.persona', 'creator.card.remove', 'creator.card.save', 'creator.cards',
        'library.list', 'library.sources', 'library.saveEntry', 'library.savePlayerCard', 'library.saveCard', 'library.update', 'library.remove', 'library.import', 'library.export', 'library.photo.set', 'library.photo.remove', 'portraits.auto.status', 'portraits.auto.check', 'portraits.presets.load', 'portraits.presets.save', 'portraits.presets.delete', 'npc.commit', 'scene.get', 'scene.setImage', 'scene.connections', 'lore.books', 'books.list', 'lore.attach', 'lore.adopt', 'relations.get', 'relations.set', 'relations.remove', 'relations.clearLog',
        'cyoa.choices', 'cyoa.choose', 'lore.activated', 'maintenance.cleanOrphans', 'maintenance.chatData', 'maintenance.removeAllChats', 'maintenance.factoryReset', 'maintenance.orphans', 'maintenance.purgePortraits', 'maintenance.resetPrompts', 'map.get', 'map.view', 'map.raw.get', 'map.raw.set', 'map.evolution.interval', 'map.evolution.reset', 'map.sandbox.get', 'map.sandbox.time', 'map.sandbox.asset.add', 'map.sandbox.asset.set', 'map.sandbox.undo', 'map.sandbox.clear', 'terminal.get', 'terminal.clear', 'records.list', 'records.update', 'records.remove', 'records.pin', 'records.removeMap', 'portraits.get', 'portraits.set', 'portraits.upload', 'backdrop.upload',
        'prefs.get', 'prefs.patch', 'reports.history', 'settings.factory', 'settings.get', 'settings.npcWords', 'settings.sections', 'settings.patch', 'settings.reset', 'settings.upgradeStock', 'status.get', 'narrator.create', 'world.overrideNext',
        'tracker.cancel', 'tracker.clearArchive', 'tracker.get', 'tracker.history', 'tracker.restore', 'tracker.setMemo',
        'world.books', 'world.get', 'world.purge', 'world.reset',
    ]

    it('places every op the backend dispatches, as fast or as slow, and never both', () => {
        const source = readFileSync(new URL('../backend/requests.ts', import.meta.url), 'utf8')
        const dispatched = [...new Set([...source.matchAll(/case '([\w.]+)':/g)].map((m) => m[1]!))].sort()
        expect(dispatched.length).toBeGreaterThanOrEqual(40)
        const slow = Object.keys(OP_TIMEOUT_MS)
        expect(FAST_OPS.filter((op) => slow.includes(op))).toEqual([])
        expect(dispatched).toEqual([...FAST_OPS, ...slow].sort())
    })

    it('gives a whole agent pass longer than a single tracker pass', () => {
        // A tracker pass is one model call. An agent pass is up to five, with
        // lorebook reads in between.
        expect(OP_TIMEOUT_MS['agent.run']!).toBeGreaterThan(OP_TIMEOUT_MS['tracker.run']!)
    })
})
