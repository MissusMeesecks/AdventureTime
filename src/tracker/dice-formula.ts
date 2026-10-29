/**
 * Rolling a formula the narrator asks for by name.
 *
 * The other half of Multihog's RNG (roadmap row 3): outside combat the
 * narrator does not read a queue, it *calls* `RollTheDice` with a formula and
 * a DC it has already declared, and gets back a sentence it can quote. The
 * README's phrase is "declare the DC before you see the roll"; this is the
 * roll.
 *
 * A port of the roller in the legacy `narrative-hooks.js` and the compare
 * helpers in `src/state/dice-compare.js`: the same formula grammar
 * (`2d6+3`, `d20+7`, `2d20kh1` for advantage, `4d6dl1`, several groups joined
 * by + or -), the same keep/drop rules, the same result sentence word for
 * word, the same fallback when the formula is nonsense -- a single die, never
 * a zero, because a zero would auto-fail any check. What is not ported is the
 * legacy's second parser (SillyTavern's `droll` library) and its popup and
 * toasts: the tool path never reached those. `dice-formula.pin.test.ts`
 * checks all of it against the legacy source with a shared random sequence.
 *
 * Pure. Randomness is a parameter.
 */

import { rollDie } from './dice.js'

export interface GroupRoll {
    /** The kept dice summed, plus the flat modifiers. */
    kept: number
    /** Every die rolled, kept or not, in order. */
    rolls: number[]
}

/** One die group: `2d6`, `d20+3`, `2d20kh1`, `4d6dl1-1`. Null if it is not one. */
export function rollSingleGroup(token: string, random?: () => number): GroupRoll | null {
    const match = token.match(/^([1-9]\d*)?d([1-9]\d*)(?:([kd][hl]?)([1-9]\d*))?((?:[+-]\d+)*)$/i)
    if (!match) return null

    const numDice = match[1] ? parseInt(match[1], 10) : 1
    const numSides = parseInt(match[2]!, 10)
    const opType = match[3] ? match[3].toLowerCase() : null
    const opCount = match[4] ? parseInt(match[4], 10) : 0
    const modifierStr = match[5] || ''

    if (numDice > 100) return null

    const rolls: number[] = []
    for (let i = 0; i < numDice; i++) rolls.push(rollDie(numSides, random))

    let keptRolls = [...rolls]
    if (opType && opCount > 0) {
        keptRolls.sort((a, b) => a - b)
        if (opType.startsWith('k')) {
            keptRolls = opType === 'kl' ? keptRolls.slice(0, opCount) : keptRolls.slice(-opCount)
        } else if (opType.startsWith('d')) {
            keptRolls = opType === 'dh' ? keptRolls.slice(0, Math.max(0, numDice - opCount)) : keptRolls.slice(opCount)
        }
    }

    let modifier = 0
    for (const m of modifierStr.match(/[+-]\d+/g) ?? []) modifier += parseInt(m, 10)

    return { kept: keptRolls.reduce((s, v) => s + v, 0) + modifier, rolls }
}

export interface FormulaRoll {
    total: string
    rolls: string[]
}

/** A compound formula: `1d20+1d4+10`, `2d6kh1-1`, `d20+7`. Null if invalid. */
export function parseAndRoll(formula: string, random?: () => number): FormulaRoll | null {
    const cleanFormula = formula.replace(/\s+/g, '')
    const tokens = cleanFormula.match(/([+-]?(?:[1-9]\d*)?d[1-9]\d*(?:[kd][hl]?[1-9]\d*)?(?:[+-]\d+)*|[+-]?\d+)/gi)

    if (!tokens || tokens.join('').replace(/\+/g, '').length !== cleanFormula.replace(/\+/g, '').length) {
        const single = rollSingleGroup(cleanFormula, random)
        return single ? { total: String(single.kept), rolls: single.rolls.map(String) } : null
    }

    if (!tokens.some((t) => /d/i.test(t))) return null

    let total = 0
    const allRolls: string[] = []
    for (const rawToken of tokens) {
        const sign = rawToken.startsWith('-') ? -1 : 1
        const token = rawToken.replace(/^[+-]/, '')
        if (/d/i.test(token)) {
            const result = rollSingleGroup(token, random)
            if (!result) return null
            total += sign * result.kept
            for (const r of result.rolls) allRolls.push(String(sign < 0 ? -r : r))
        } else {
            const n = parseInt(token, 10)
            if (isNaN(n)) return null
            total += sign * n
        }
    }
    return { total: String(total), rolls: allRolls }
}

/**
 * A model sometimes joins several formulas with a comma. The tool returns one
 * result, so the first segment that parses is the roll.
 */
export function sanitizeFormula(value: string, random?: () => number): string {
    if (!value.includes(',')) return value
    const parts = value.split(',').map((p) => p.trim()).filter(Boolean)
    // The legacy tests each segment by rolling it, which draws from the random
    // source; the same draws happen here so the two stay in step.
    for (const part of parts) if (parseAndRoll(part, random)) return part
    return parts[0] || value
}

/** A pure d100 roll, flat modifiers allowed: `1d100`, `d100+5`. */
export function isPercentFormula(formula: string | null | undefined): boolean {
    const f = String(formula || '').trim().toLowerCase().replace(/\s+/g, '')
    if (!f) return false
    return /^(?:\d*)d100(?:[+-]\d+)*$/.test(f)
}

/** Explicit `gte` or `lte` wins; else a percentage formula rolls under, anything else rolls over. */
export function resolveDiceCompare(compare: unknown, formula: string): 'gte' | 'lte' {
    const c = String(compare || '').trim().toLowerCase()
    if (c === 'lte' || c === 'gte') return c
    return isPercentFormula(formula) ? 'lte' : 'gte'
}

export interface DiceRollResult extends FormulaRoll {
    /** Absent only for an empty request, which rolls nothing (the legacy's `nullValue`). */
    formula?: string
    /** Set when the formula could not be parsed and a single die was rolled instead. */
    invalidFormula?: string
}

export interface RollFormulaOptions {
    /** The cartridge's d100 mode: what the fallback die is. */
    d100Mode?: boolean
    random?: () => number
}

/**
 * The legacy's `doDiceRoll`, minus its UI: the formula, sanitised and rolled,
 * or one fair die when it is nonsense -- never zero, because a zero would
 * auto-fail any check. An empty request rolls nothing, as the legacy's does;
 * the tool never sends one, since it substitutes its default formula first.
 */
export function rollFormula(requested: string, opts: RollFormulaOptions = {}): DiceRollResult {
    const defaultFormula = opts.d100Mode ? '1d100' : '1d20'
    const trimmed = requested.trim()
    if (!trimmed) return { total: '', rolls: [] }
    const value = sanitizeFormula(trimmed, opts.random)
    const parsed = parseAndRoll(value, opts.random)
    if (parsed) return { ...parsed, formula: value }
    const fallbackRoll = rollDie(opts.d100Mode ? 100 : 20, opts.random)
    return { total: String(fallbackRoll), rolls: [String(fallbackRoll)], formula: defaultFormula, invalidFormula: value }
}

export interface DiceToolArgs {
    who?: unknown
    for?: unknown
    formula?: unknown
    dc?: unknown
    compare?: unknown
}

export interface DescribeRollOptions extends RollFormulaOptions {
    /** `1d20` for the unified tool, `1d100` for the d100 one. */
    defaultFormula?: string
    /** The d100 tool: always roll-under. */
    forceLte?: boolean
    /** The legacy's older, DC-less tool wording. */
    isLegacy?: boolean
}

/**
 * The legacy's `executeDiceToolAction`: the sentence the narrator gets back.
 *
 *   Mara (perception) rolls a 1d20+3 against DC 15. The result is: 9.
 *   Individual rolls: 6 (Result: FAILURE)
 */
export function describeDiceRoll(args: DiceToolArgs, opts: DescribeRollOptions = {}): string {
    const isLegacy = !!opts.isLegacy
    const requested = String(args?.formula || opts.defaultFormula || (isLegacy ? '1d6' : '1d20'))
    const roll = rollFormula(requested, opts)
    const total = parseInt(roll.total) || 0
    const formula = roll.formula || requested
    const invalidNote = roll.invalidFormula
        ? ` (requested formula "${roll.invalidFormula}" was invalid, defaulted to ${formula})`
        : ''
    const who = args?.who ? String(args.who) : ''

    if (isLegacy) {
        return (who
            ? `${who} rolls a ${formula}. The result is: ${total}. Individual rolls: ${roll.rolls.join(', ')}`
            : `The result of a ${formula} roll is: ${total}. Individual rolls: ${roll.rolls.join(', ')}`) + invalidNote
    }

    const dc = Number(args?.dc) || 0
    const compare = opts.forceLte ? 'lte' : resolveDiceCompare(args?.compare, formula)
    const forStr = args?.for ? ` (${String(args.for)})` : ''
    let result = (who
        ? `${who}${forStr} rolls a ${formula} against DC ${dc}. The result is: ${total}. Individual rolls: ${roll.rolls.join(', ')}`
        : `The result${forStr} of a ${formula} roll against DC ${dc} is: ${total}. Individual rolls: ${roll.rolls.join(', ')}`) + invalidNote

    if (dc > 0) {
        if (compare === 'lte') {
            result += ` (Result: ${total} ≤ ${dc}% → ${total <= dc ? 'HIT' : 'MISS'})`
        } else {
            result += ` (Result: ${total >= dc ? 'SUCCESS' : 'FAILURE'})`
        }
    }
    return result
}
