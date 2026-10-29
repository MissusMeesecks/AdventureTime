/**
 * The dice queue.
 *
 * Multihog's RNG in queue mode: before each reply a block of pre-rolled dice
 * is put into the prompt and `<rng_system>` in the rulebook tells the
 * narrator to pop lines from it in order. The narrator never chooses a
 * number; it reads the next one. That is the anti-sycophancy mechanism the
 * README leads with — without it a model rolls whatever the story wants.
 * Roadmap row 2, core component 2 (half: the tool-call mode is row 3).
 *
 * A port of the RNG engine in the legacy `narrative-hooks.js`: same queue
 * length (12 lines of d20/d4/d6/d8/d10/d12, or 30 of d100), same line and
 * block format down to the trailing blank lines, same tags the rulebook
 * names. `dice.pin.test.ts` checks the format against the legacy source.
 *
 * Pure. Randomness and the clock are parameters so tests can pin them; the
 * defaults are the legacy's own (`crypto.getRandomValues`, `Date.now`).
 */

export const RNG_QUEUE_LEN = 12
export const RNG_QUEUE_LEN_D100 = 30
export const RNG_QUEUE_VERSION = 'v7.0'
export const RNG_QUEUE_TAG_D20 = `[RNG_QUEUE ${RNG_QUEUE_VERSION}]`
export const RNG_QUEUE_TAG_D100 = `[RNG_QUEUE_d100 ${RNG_QUEUE_VERSION}]`

/** One line of the queue: a d100, or a full set of the polyhedrals. */
export type QueueLine = { d100: number } | { d20: number; d4: number; d6: number; d8: number; d10: number; d12: number }

/** A fair die: rejection-sampled from 32 random bits, as the legacy does. */
export function rollDie(sides: number, random: () => number = randomUint32): number {
    const limit = Math.floor(4294967296 / sides) * sides
    let roll: number
    do roll = random()
    while (roll >= limit)
    return (roll % sides) + 1
}

function randomUint32(): number {
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    return buf[0]!
}

export interface QueueOptions {
    /** 32 random bits; the default is the platform's CSPRNG. */
    random?: () => number
    /** Override the length; the legacy default is 12, or 30 for d100. */
    length?: number
}

/** The legacy's `makeRngQueue`: a fresh queue of the given flavour. */
export function makeRngQueue(d100Mode: boolean, opts: QueueOptions = {}): QueueLine[] {
    const roll = (sides: number) => rollDie(sides, opts.random)
    const len = opts.length ?? (d100Mode ? RNG_QUEUE_LEN_D100 : RNG_QUEUE_LEN)
    const out: QueueLine[] = []
    for (let i = 0; i < len; i++) {
        out.push(
            d100Mode
                ? { d100: roll(100) }
                : { d20: roll(20), d4: roll(4), d6: roll(6), d8: roll(8), d10: roll(10), d12: roll(12) },
        )
    }
    return out
}

/** `3: d20=17 d4=2 d6=5 d8=8 d10=1 d12=11`, or `3: d100=42`. */
export function formatRngQueueLine(lineNum: number, dice: QueueLine): string {
    if ('d100' in dice) return `${lineNum}: d100=${dice.d100}`
    return `${lineNum}: d20=${dice.d20} d4=${dice.d4} d6=${dice.d6} d8=${dice.d8} d10=${dice.d10} d12=${dice.d12}`
}

/**
 * The block as the narrator sees it, trailing blank lines included.
 *
 * `turn_id` is the legacy's `Date.now()`: it exists so two consecutive
 * queues are never byte-identical and a model cannot mistake the new one for
 * the old. `scope=this_response` is the rulebook's own wording.
 */
export function buildRngBlock(queue: readonly QueueLine[], d100Mode: boolean, turnId: number): string {
    const lines = queue.map((dice, i) => formatRngQueueLine(i + 1, dice))
    if (d100Mode) {
        return `${RNG_QUEUE_TAG_D100}\nturn_id=${turnId}\nscope=this_response\n${lines.join('\n')}\n[/RNG_QUEUE_d100]\n\n`
    }
    return `${RNG_QUEUE_TAG_D20}\nturn_id=${turnId}\nscope=this_response\n${lines.join('\n')}\n[/RNG_QUEUE]\n\n`
}

/** The legacy's `isCombatActive`: a `[COMBAT]` block with something in it that is not `END_COMBAT`. */
export function isCombatActive(memo: string | null | undefined): boolean {
    if (!memo) return false
    const match = memo.match(/\[COMBAT\]([\s\S]*?)\[\/COMBAT\]/i)
    if (!match) return false
    const body = match[1]!.trim()
    return body.length > 0 && !/^END_COMBAT$/i.test(body)
}

export interface DiceSettings {
    rngEnabled?: boolean
    /** Hybrid mode: tool calls outside combat, the queue only inside it. */
    diceFunctionTool?: boolean
    rngQueueD20?: boolean
    rngQueueD100?: boolean
}

/**
 * Whether this turn gets a queue at all.
 *
 * Queue-only mode: every turn. Hybrid mode: only while `[COMBAT]` is live,
 * because outside combat the narrator is calling the dice tool instead.
 * The caller passes *effective* settings — with the tool-call limit in
 * force, hybrid is read as queue-only and this is every turn.
 */
export function shouldInjectQueue(settings: DiceSettings, memo: string | null | undefined): boolean {
    if (!settings.rngEnabled) return false
    return !settings.diceFunctionTool || isCombatActive(memo)
}

export interface DiceBlockOptions extends QueueOptions {
    now?: () => number
}

/**
 * The text to inject this turn: the d20 queue, the d100 queue, both, or
 * nothing. Which queues go is the two `rngQueue*` flags, exactly as in the
 * legacy interceptor — `diceD100Mode` changes the rulebook's wording, not
 * which queue is rolled. Empty when nothing should go.
 */
export function buildDiceInjection(
    settings: DiceSettings,
    memo: string | null | undefined,
    opts: DiceBlockOptions = {},
): string {
    if (!shouldInjectQueue(settings, memo)) return ''
    const turnId = (opts.now ?? Date.now)()
    let text = ''
    if (settings.rngQueueD20) text += buildRngBlock(makeRngQueue(false, opts), false, turnId)
    if (settings.rngQueueD100) text += buildRngBlock(makeRngQueue(true, opts), true, turnId)
    return text
}
