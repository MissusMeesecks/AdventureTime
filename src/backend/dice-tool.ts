/**
 * The dice tool the narrator calls by name.
 *
 * Multihog registers `RollTheDice` (and, for percentage rulesets,
 * `RollTheDiceD100`) as a function tool, and the tool-call wording of
 * `<rng_system>` tells the narrator to call it with the DC declared up front.
 * Spindle has the same shape: `registerTool` with `inline_available` puts the
 * schema on the narrator's generation, and `TOOL_INVOCATION` hands the call
 * back here for a textual result. Roadmap row 3, core component 2's other
 * half.
 *
 * Two things the legacy does are kept exactly:
 *
 * - **Which tools exist follows the two tool flags**, `rngToolD20` and
 *   `rngToolD100`, which the RNG mode sets (`rng-flags.ts`). The schemas and
 *   descriptions are the legacy's word for word: they are prompt text the
 *   narrator reads, and a paraphrase is a different prompt.
 * - **In combat, in hybrid mode, the tools go away.** The queue is the only
 *   mechanic while `[COMBAT]` is live, so the schemas are unregistered at that
 *   boundary and restored after it (`syncDiceFunctionToolForRngContext`).
 *
 * Registration is extension-wide, not per user; the install is
 * operator-scoped, so the operator's settings decide. The invocation carries
 * no user either, so the one setting the roll reads -- d100 mode, for the
 * fallback die -- comes from the same place.
 */

import type { ToolRegistrationDTO } from 'lumiverse-spindle-types'

import { isCombatActive } from '../tracker/dice.js'
import { describeDiceRoll, type DiceToolArgs } from '../tracker/dice-formula.js'
import type { LogApi } from './interceptor.js'

export const DICE_TOOL_D20 = 'RollTheDice'
export const DICE_TOOL_D100 = 'RollTheDiceD100'

export interface DiceToolSettings {
    rngEnabled?: boolean
    diceFunctionTool?: boolean
    diceD100Mode?: boolean
    rngToolD20?: boolean
    rngToolD100?: boolean
    legacyDiceNaming?: boolean
}

const D20_FORMULA_DESCRIPTION = (base: string) =>
    `A SINGLE dice formula to roll per invocation, e.g. "${base}", "1d100", "2d6+3", "${base}+5". Supports one or more die groups joined by + or - (e.g. "${base}+1d4+2"), and keep/drop modifiers (e.g. "2d20kh1" for advantage, "2d20kl1" for disadvantage). Provide EXACTLY ONE formula string per call — do NOT comma-separate multiple formulas in one invocation. When several independent rolls are needed, issue multiple parallel RollTheDice invocations in the same turn (e.g. initiative for each combatant, existence check then detection, or random-event occurrence + type). Use formula "1d100" with compare "lte" for percentage / existence checks.`

const D100_FORMULA_DESCRIPTION =
    `A SINGLE dice formula to roll per invocation, e.g. "1d100", "2d6+3", "1d100+5". Supports one or more die groups joined by + or - (e.g. "1d100+1d4+2"), and keep/drop modifiers. Provide EXACTLY ONE formula string per call — do NOT comma-separate multiple formulas in one invocation. When several independent rolls are needed, issue multiple parallel RollTheDiceD100 invocations in the same turn.`

/** The tools these settings ask for, schemas as the legacy wrote them. */
export function diceToolRegistrations(settings: DiceToolSettings): ToolRegistrationDTO[] {
    const out: ToolRegistrationDTO[] = []
    const isLegacy = !!settings.legacyDiceNaming

    if (settings.rngToolD20) {
        const formulaDescription = D20_FORMULA_DESCRIPTION('1d20')
        out.push({
            name: DICE_TOOL_D20,
            display_name: isLegacy ? 'Dice Roll' : 'Dice Roll (with DC)',
            description:
                'Rolls dice using the provided formula and returns the numeric result. Use for skill/attack checks (1d20+mod vs DC, compare gte) and percentage / existence checks (1d100 vs %, compare lte). Each invocation takes one formula. For multiple independent rolls, issue parallel invocations in the same turn — never comma-join formulas into one call.',
            parameters: isLegacy
                ? {
                      type: 'object',
                      properties: {
                          who: { type: 'string', description: 'The name of the persona rolling the dice' },
                          formula: { type: 'string', description: formulaDescription.replace('1d20', '1d6') },
                      },
                      required: ['who', 'formula'],
                  }
                : {
                      type: 'object',
                      properties: {
                          who: { type: 'string', description: 'The name of the persona rolling the dice' },
                          for: { type: 'string', description: 'What is being rolled for, 1-3 words' },
                          formula: { type: 'string', description: formulaDescription },
                          dc: { type: 'number', description: 'For skill/attack checks (compare=gte): Difficulty Class — roll ≥ dc = SUCCESS. For percentage / existence checks (compare=lte or formula 1d100): the trigger % chance — roll ≤ dc = HIT. Always pass the probability directly (e.g. 35 for Dangerous-tier existence). Anchors difficulty BEFORE the roll is made.' },
                          compare: { type: 'string', description: 'Optional. "gte" (default for non-d100 formulas): roll ≥ dc = SUCCESS. "lte" (default for 1d100 / percentage formulas): roll ≤ dc% = HIT. Use lte for existence checks and other percentage odds.' },
                      },
                      required: ['who', 'for', 'formula', 'dc'],
                  },
            inline_available: true,
        })
    }

    if (settings.rngToolD100) {
        out.push({
            name: DICE_TOOL_D100,
            display_name: 'Dice Roll d100 (with DC)',
            description:
                'Rolls a d100 (1-100) using the provided formula and returns the numeric result. Use for percentage-based rulesets (global d100 Mode) and percentage probability checks. Each invocation takes one formula (e.g. "1d100"). For multiple independent rolls, issue parallel invocations in the same turn. The dc parameter is the direct success/trigger percentage (roll ≤ dc = success). In a normal d20 game, prefer RollTheDice with formula "1d100" and compare "lte" instead.',
            parameters: {
                type: 'object',
                properties: {
                    who: { type: 'string', description: 'The name of the persona rolling the dice' },
                    for: { type: 'string', description: 'What is being rolled for, 1-3 words' },
                    formula: { type: 'string', description: D100_FORMULA_DESCRIPTION },
                    dc: { type: 'number', description: 'The success/trigger percentage chance for this roll (roll-under system). Set this to the actual % probability of success or occurrence (e.g. 83 for an 83% chance to hit/succeed, or 25 for a 25% hazard failure chance). A roll ≤ dc = HIT/SUCCESS/TRIGGER, a roll > dc = MISS/FAILURE/NO-TRIGGER. Do NOT invert the percentage — always pass the probability directly.' },
                },
                required: ['who', 'for', 'formula', 'dc'],
            },
            inline_available: true,
        })
    }

    return out
}

/**
 * Which tools should be registered right now.
 *
 * The flags decide, except in combat in hybrid mode, when none are: the queue
 * is the only mechanic there. A memo not yet loaded reads as not in combat.
 */
export function wantedDiceTools(settings: DiceToolSettings, memo: string | null | undefined): ToolRegistrationDTO[] {
    const hybridManaged = !!settings.rngEnabled && !!settings.diceFunctionTool
    if (hybridManaged && isCombatActive(memo)) return []
    return diceToolRegistrations(settings)
}

export interface DiceToolHost {
    registerTool(tool: ToolRegistrationDTO): void
    unregisterTool(name: string): void
}

export interface DiceToolSyncOptions {
    /**
     * Register every wanted tool again even if nothing changed.
     *
     * AdventureTime's record of what is registered is its own; the host's can
     * differ, and the difference is invisible. A live turn showed the model
     * with no sign of the tool schema while this record said registered,
     * after seven swipes. Before a generation and after each reply the
     * registration is asserted afresh — unregister, register — so the host
     * holds it whatever happened in between. Change-only elsewhere, so panel
     * refreshes do not churn.
     */
    reassert?: boolean
}

export interface DiceToolSync {
    /** Bring the host's registrations in line with these settings and this memo. */
    sync(settings: DiceToolSettings | null | undefined, memo: string | null | undefined, opts?: DiceToolSyncOptions): void
    /** The names registered right now, for the panel and for tests. */
    registered(): string[]
    dispose(): void
}

/**
 * Keeps the host's registrations in step, registering and unregistering only
 * on change. A host that throws (the `tools` permission missing, most likely)
 * costs the tool, never the caller: the audit at startup names the permission.
 */
export function createDiceToolSync(host: DiceToolHost, log: LogApi): DiceToolSync {
    const current = new Map<string, string>() // name -> JSON of what was registered

    return {
        sync(settings, memo, opts = {}) {
            const wanted = settings ? wantedDiceTools(settings, memo) : []
            const wantedNames = new Set(wanted.map((t) => t.name))
            for (const name of [...current.keys()]) {
                if (wantedNames.has(name)) continue
                try {
                    host.unregisterTool(name)
                } catch (error) {
                    log.warn(`dice tool ${name} could not be unregistered: ${describe(error)}`)
                }
                current.delete(name)
            }
            for (const tool of wanted) {
                const shape = JSON.stringify(tool)
                if (current.get(tool.name) === shape && !opts.reassert) continue
                try {
                    if (current.has(tool.name) || opts.reassert) {
                        try {
                            host.unregisterTool(tool.name)
                        } catch {
                            // Nothing to remove is fine; the register below is the point.
                        }
                    }
                    host.registerTool(tool)
                    current.set(tool.name, shape)
                    if (opts.reassert) log.info(`dice: ${tool.name} registered afresh`)
                } catch (error) {
                    log.warn(`dice tool ${tool.name} could not be registered: ${describe(error)}`)
                }
            }
        },
        registered() {
            return [...current.keys()]
        },
        dispose() {
            for (const name of current.keys()) {
                try {
                    host.unregisterTool(name)
                } catch {
                    // Shutting down; nothing to report to.
                }
            }
            current.clear()
        },
    }
}

/**
 * Why no tool is registered, when none is. Null while one is.
 *
 * The order matters: a mode that asks for no tool is the common, quiet case;
 * a hybrid mode with both switches off is a cartridge edited by hand; combat
 * is the legacy's own hand-off to the queue; and only when the settings ask
 * for a tool and nothing stopped it is the host the answer.
 */
export function explainDiceTools(
    settings: DiceToolSettings | null | undefined,
    memo: string | null | undefined,
    registered: readonly string[],
): 'mode' | 'flags' | 'combat' | 'refused' | null {
    if (registered.length) return null
    if (!settings?.rngEnabled || !settings.diceFunctionTool) return 'mode'
    if (!settings.rngToolD20 && !settings.rngToolD100) return 'flags'
    if (isCombatActive(memo)) return 'combat'
    return 'refused'
}

export interface DiceToolCoordinatorDeps {
    settings: (userId: string | undefined) => DiceToolSettings | null | undefined
    memo: (chatId: string, userId: string | undefined) => string | null | undefined
    tools: Pick<DiceToolSync, 'sync'>
}

export interface DiceToolCoordinator {
    /**
     * Bring the host in step for this user and chat. Either may be omitted:
     * the last one seen is used, because registration is extension-wide and
     * the operator's current chat is the one that matters.
     */
    sync(userId?: string, chatId?: string, opts?: DiceToolSyncOptions): void
    /** The user and chat the coordinator is currently speaking for. */
    current(): { userId: string | undefined; chatId: string | undefined }
}

/**
 * Remembers whose settings and which chat's memo decide the tool.
 *
 * This exists because of a live bug: the panel re-synced after every request
 * it made, that path named no chat, "no chat" read as "no memo", "no memo"
 * read as "not in combat", and the tool came back in the middle of a fight —
 * so the narrator had the queue *and* the tool in one prompt and quoted one
 * roll from each. A sync that names no chat now uses the last chat seen.
 */
export function createDiceToolCoordinator(deps: DiceToolCoordinatorDeps): DiceToolCoordinator {
    let userId: string | undefined
    let chatId: string | undefined
    return {
        sync(forUser, forChat, opts) {
            if (forUser !== undefined) userId = forUser
            if (forChat !== undefined) chatId = forChat
            const settings = deps.settings(userId)
            const memo = chatId ? deps.memo(chatId, userId) : null
            deps.tools.sync(settings, memo, opts ?? {})
        },
        current: () => ({ userId, chatId }),
    }
}

export interface DiceInvocation {
    toolName: string
    args: Record<string, unknown>
}

export interface DiceInvocationOptions {
    /** The cartridge's d100 mode, for the fallback die. */
    d100Mode?: boolean
    legacyDiceNaming?: boolean
    random?: () => number
}

/**
 * Answer a `TOOL_INVOCATION`. Undefined for a tool that is not ours, so the
 * host's coercion to an empty string never answers for someone else.
 */
export function handleDiceToolInvocation(invocation: DiceInvocation, opts: DiceInvocationOptions = {}): string | undefined {
    const args = (invocation.args ?? {}) as DiceToolArgs
    if (invocation.toolName === DICE_TOOL_D20) {
        return describeDiceRoll(args, {
            defaultFormula: opts.legacyDiceNaming ? '1d6' : '1d20',
            isLegacy: !!opts.legacyDiceNaming,
            d100Mode: opts.d100Mode,
            random: opts.random,
        })
    }
    if (invocation.toolName === DICE_TOOL_D100) {
        return describeDiceRoll(args, { defaultFormula: '1d100', forceLte: true, d100Mode: opts.d100Mode, random: opts.random })
    }
    return undefined
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
