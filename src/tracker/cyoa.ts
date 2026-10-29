/**
 * CYOA mode: the narrator ends every reply with choices, and the choices are
 * buttons.
 *
 * Multihog's README highlight (roadmap row 6). The legacy does four things,
 * and every one is here:
 *
 * - `buildCyoaPrompt` -- the `<CYOA_mode>` instruction, built from the slot
 *   list in `cyoaConfig`: how many choices, of which kinds, with or without
 *   emoji, the `<choices>` block and the `<button>` wrapper. A port of the
 *   legacy `constants.js` builder, word for word, pinned by `cyoa.pin.test.ts`.
 *   `buildCyoaModeBlock` wraps it in its tag, or uses the user's own text.
 * - `stripSupersededChoices` -- the older choice blocks come out of the chat
 *   history before it goes to the model, keeping the newest four as format
 *   examples. The legacy's `cyoa-prompt-history.js`, pinned.
 * - `stripChoiceBlocks` -- the blocks come out of what the tracker and the
 *   lorebook agent read: a choice is a hypothetical, not an event. The
 *   legacy's `present-now.js`, pinned.
 * - `extractChoices` -- the choices in a reply, for the buttons. The legacy
 *   binds `<button>` elements the chat renderer happened to produce; this
 *   reads the text, which is what the buttons are made from here.
 *
 * Pure throughout. The injection is `backend/cyoa-injection.ts`; the buttons
 * are `frontend/message-choices.ts`.
 */

export type CyoaSlotType = 'narrative' | 'normal' | 'trait' | 'prefix' | 'custom'

export interface CyoaSlot {
    type: CyoaSlotType | string
    /** For `trait` and `prefix`. */
    label?: string
    /** For `custom`. The legacy also accepted `left`/`right` halves. */
    text?: string
    left?: string
    right?: string
}

export interface CyoaConfig {
    useCustomPrompt?: boolean
    customPromptText?: string
    slots?: CyoaSlot[]
    presets?: Record<string, CyoaSlot[]>
    useEmojis?: boolean
    useXmlTag?: boolean
    useButtonTags?: boolean
    stripOldChoicesFromPrompt?: boolean
}

export const CYOA_SLOT_TYPES: readonly CyoaSlotType[] = ['narrative', 'normal', 'trait', 'prefix', 'custom']

/** Five narrative-decided choices: the legacy's shipped layout. */
export const DEFAULT_CYOA_SLOTS: readonly CyoaSlot[] = Object.freeze([
    { type: 'narrative' },
    { type: 'narrative' },
    { type: 'narrative' },
    { type: 'narrative' },
    { type: 'narrative' },
])

/** How many superseded blocks stay in the prompt as format examples. */
export const CHOICE_BLOCKS_KEPT = 4

/**
 * The slots in force: the configured list, or the default when it is empty,
 * with the retired `roll` type read as `narrative` as the legacy reads it.
 */
export function effectiveCyoaSlots(config: CyoaConfig = {}): CyoaSlot[] {
    const slots = Array.isArray(config.slots) && config.slots.length > 0 ? config.slots : DEFAULT_CYOA_SLOTS
    return slots.map((slot) => (slot?.type === 'roll' ? { ...slot, type: 'narrative' } : slot))
}

/** The inner text of `<CYOA_mode>`, from the slot list. The legacy's, verbatim. */
export function buildCyoaPrompt(config: CyoaConfig = {}): string {
    const slots = effectiveCyoaSlots(config)
    const useEmojis = config.useEmojis !== false
    const useXmlTag = config.useXmlTag !== false
    const useButtonTags = config.useButtonTags !== false
    const totalCount = slots.length

    const wrapChoice = (inner: string): string => {
        let text = String(inner)
        if (!useEmojis) {
            // Strip emoji after the "N. " prefix when emojis are disabled.
            text = text.replace(/^(\d+\.\s*)(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|[️‍])+\s*/u, '$1')
        }
        return useButtonTags ? `<button>${text}</button>` : text
    }

    const wrapBlock = (lines: string[]): string => {
        const body = lines.map(wrapChoice).join('\n')
        return useXmlTag ? `<choices>\n${body}\n</choices>` : body
    }

    const reqLines = [
        `- You MUST ALWAYS end your response with exactly ${totalCount} choices for the user. NEVER forget the choices. This is a strict requirement.`,
    ]
    if (useXmlTag) reqLines.push('- Enclose all choices inside a single <choices> XML block.')
    if (useButtonTags) reqLines.push('- Wrap every single choice in a <button> tag.')
    if (useEmojis) reqLines.push('- Prefix each choice text with a fitting emoji.')
    reqLines.push('- Not all choices should always have a roll, though all choices *can* have a roll; high-stakes situations/problem-solving should utilize them more. Downtime needs less rolls.')
    reqLines.push('- Not every looking around needs to be an investigation check, but investigating something specific should be.')
    reqLines.push('- When a site map is attached: do not invent obstacles in choices (locked doors, traps, barricades, sealed passages, etc.) unless they already exist on that map. Offering such a check makes the obstacle real if chosen — keep choices map-real.')
    reqLines.push('- A resource must be >0 (not depleted) in TRACKER STATE 0 (Current) to be eligible for a choice.')
    reqLines.push('- Vary approaches across turns — avoid repeating the same stats, traits, abilities, or narrative actions as the previous turn.')
    reqLines.push('- Wrap mechanical details (rolls, modifiers, DC/AC targets, resource costs, uses remaining) in square brackets, typically after an em dash, e.g. — [Persuasion (untrained, CHA +0) DC 13]. Prefix/trait tags at the start of a choice also use brackets but are separate from roll brackets.')

    const intro = `[END OF OUTPUT REQUIREMENT]\n${reqLines.join('\n')}`

    const typeLine = `Choice types available:
- NORMAL: Plain action/speech (e.g. "Open the door")
- NARRATIVE-DECIDED: Pick whichever format fits best based on context
- TRAIT/ABILITY: Prefix with [Trait Name] (e.g. "[Illithid] Read his mind")
- PREFIX: Prefix with a specific bracketed label (e.g. "[Attack] Swing the sword")`

    // Style examples stay rich on purpose; counts may differ from STRICT GENERATION ORDER.
    const examples = `EXAMPLES:
(Style/variety references — counts may differ. STRICT GENERATION ORDER below is authoritative for how many choices you output.)

Example 1 (high-stakes scenario):
${wrapBlock([
        '1. 🎯 Fire with Dead-Eye Focus — [2/3 per short rest] [Attack (+12) vs AC 15]',
        '2. 💣 Throw a Smoke Bomb — [-1 Smoke Bomb]',
        '3. 🥷 Slip along the hull\'s shadows — [Stealth (+6: Void-Runner) DC 14]',
        '4. 🗣️ Shout a warning to the rest of your crew',
        '5. 🛰️ Try to talk the hostile crew into standing down — [Persuasion (untrained, CHA +0) DC 13]',
        '6. ✈️ Attempt an emergency piloting maneuver — [Piloting (+8) DC 16]',
        '7. 🚪 Back away and hope the standoff cools down',
    ])}

Example 2 (low-stakes/downtime scenario):
${wrapBlock([
        '1. 🍺 Buy a round for the table and swap stories — [-20 GP]',
        '2. 🗣️ "What happened to your face? That\'s the longest scar I\'ve seen."',
        '3. 🎵 Hum along to the tune the bard is playing',
        '4. 📜 Show him the bounty notice from your pack — [Intimidation (+2) DC 10] (evidence lowers the DC)',
        '5. ♣️ Join the card game at the corner table — [Bluff (+3) DC 18] (experienced players)',
        '6. 🚪 Excuse yourself and head back to your ship',
        '7. 🕖 Spend the evening drinking because why the hell not? — [5-hour timeskip]',
    ])}`

    const slotLines = slots.map((slot, i) => {
        const num = i + 1
        switch (slot.type) {
            case 'normal':
                return `${num}. MUST be NORMAL (plain action/speech, no bracketed tags).`
            case 'trait': {
                const name = slot.label?.trim()
                return name
                    ? `${num}. MUST use TRAIT/ABILITY [${name}].`
                    : `${num}. MUST use a relevant TRAIT/ABILITY tag (pick a fresh trait/ability — do not repeat the previous turn's).`
            }
            case 'prefix': {
                const label = slot.label?.trim()
                return label
                    ? `${num}. MUST begin with the exact prefix [${label}].`
                    : `${num}. MUST begin with a thematic [PREFIX] of your choice.`
            }
            case 'custom': {
                const text = slot.text?.trim() || [slot.left, slot.right].filter(Boolean).join(' ').trim()
                if (text) return `${num}. MUST be ${JSON.stringify(text)}.`
                return `${num}. USER-DEFINED (no custom text entered; choose an appropriate format).`
            }
            case 'narrative':
            default:
                return `${num}. NARRATIVE-DECIDED (Choose whichever format fits the story best).`
        }
    }).join('\n')

    return `${intro}\n\n${typeLine}\n\n${examples}\n\nSTRICT GENERATION ORDER:\nYou must generate exactly ${totalCount} choices following these exact rules:\n${slotLines}`
}

/** The whole `<CYOA_mode>` block: the user's own text when they asked for it, else the builder's. */
export function buildCyoaModeBlock(config: CyoaConfig = {}): string {
    const promptText = config.useCustomPrompt && config.customPromptText?.trim()
        ? config.customPromptText.trim()
        : buildCyoaPrompt(config)
    return `<CYOA_mode>\n${promptText}\n</CYOA_mode>`
}

// ── the choice block in a reply ──────────────────────────────────────────

const CHOICES_BLOCK_SOURCE = '<choices\\b[^>]*>[\\s\\S]*?<\\/choices\\s*>'
const choicesRegex = (): RegExp => new RegExp(CHOICES_BLOCK_SOURCE, 'gi')
const ESCAPED_CHOICES_BLOCK_RE = /&lt;\s*choices\b[^&]*&gt;[\s\S]*?&lt;\s*\/\s*choices\s*&gt;/gi
const CYOA_CHOICES_DIV_RE = /<div\b[^>]*\brt-cyoa-choices\b[^>]*>[\s\S]*?<\/div\s*>/gi
const BUTTON_BLOCK_RE = /<button\b[^>]*>[\s\S]*?<\/button\s*>/gi
const ESCAPED_BUTTON_BLOCK_RE = /&lt;\s*button\b[^&]*&gt;[\s\S]*?&lt;\s*\/\s*button\s*&gt;/gi

/**
 * A reply without its choices, for the passes that read the story.
 *
 * A choice is what *might* happen next, and a tracker that read "Throw a
 * Smoke Bomb — [-1 Smoke Bomb]" as prose would spend the bomb. The legacy
 * strips the blocks before its agent reads a narrator message for the same
 * reason; this build strips them for the tracker too.
 */
export function stripChoiceBlocks(text: string | null | undefined): string {
    let raw = String(text || '')
    if (!raw) return ''
    raw = raw.replace(choicesRegex(), '')
    raw = raw.replace(ESCAPED_CHOICES_BLOCK_RE, '')
    raw = raw.replace(CYOA_CHOICES_DIV_RE, '')
    raw = raw.replace(BUTTON_BLOCK_RE, '')
    raw = raw.replace(ESCAPED_BUTTON_BLOCK_RE, '')
    return raw.replace(/\n{3,}/g, '\n\n').trim()
}

/** How many `<choices>` blocks a text holds. */
export function countChoiceBlocks(text: unknown): number {
    if (typeof text !== 'string' || !text) return 0
    return Array.from(text.matchAll(choicesRegex())).length
}

/** A message as the interceptor sees it: text, or parts some of which are text. */
export interface ChoiceHistoryMessage {
    role: string
    content: unknown
}

/**
 * The chat history with every choice block but the newest four removed.
 *
 * Only assistant messages are touched, so an example in a system prompt and
 * a user quoting a choice are left alone. The kept four are the newest
 * completed narrator turns, and they are what keeps the format fresh in the
 * model's context; everything older is stale steering. Returns a copy; the
 * input is never written to. The legacy's `stripSupersededChoicesFromChatPrompt`.
 */
export function stripSupersededChoices<T extends ChoiceHistoryMessage>(messages: readonly T[], keep = CHOICE_BLOCKS_KEPT): T[] {
    const holders: Array<{ get: () => string; set: (value: string) => void }> = []
    const cloned = messages.map((message) => {
        if (!message || typeof message !== 'object') return message
        const copy: T & { content: unknown } = { ...message }
        if (message.role !== 'assistant') return copy
        if (typeof message.content === 'string') {
            holders.push({ get: () => copy.content as string, set: (value) => { copy.content = value } })
        } else if (Array.isArray(message.content)) {
            const parts: unknown[] = message.content.map((part: unknown) => (part && typeof part === 'object' ? { ...(part as object) } : part))
            copy.content = parts
            parts.forEach((part, index) => {
                if (!part || typeof part !== 'object' || typeof (part as { text?: unknown }).text !== 'string') return
                holders.push({
                    get: () => (parts[index] as { text: string }).text,
                    set: (value) => { (parts[index] as { text: string }).text = value },
                })
            })
        }
        return copy
    })

    const total = holders.reduce((sum, holder) => sum + countChoiceBlocks(holder.get()), 0)
    if (total <= keep) return cloned
    const firstKept = total - keep + 1
    let seen = 0
    for (const holder of holders) {
        holder.set(holder.get().replace(choicesRegex(), (block) => {
            seen += 1
            return seen >= firstKept ? block : ''
        }))
    }
    return cloned
}

/**
 * The choices a reply offers, in order, as the buttons will read.
 *
 * From the last `<choices>` block: one per `<button>`, or one per non-empty
 * line when the narrator left the buttons out. Tags inside a choice are
 * dropped and entities decoded, so a choice reads as the model wrote it.
 * Nothing without a block: a reply that forgot its choices has no buttons,
 * and a reply with a lone `<button>` in its prose is not a menu.
 */
export function extractChoices(text: string | null | undefined): string[] {
    const raw = String(text || '')
    const blocks = Array.from(raw.matchAll(choicesRegex()))
    const last = blocks.at(-1)?.[0]
    if (!last) return []
    const inner = last.replace(/^<choices\b[^>]*>/i, '').replace(/<\/choices\s*>$/i, '')
    const buttons = Array.from(inner.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button\s*>/gi)).map((m) => m[1] ?? '')
    const items = buttons.length ? buttons : inner.split('\n')
    return items.map(cleanChoice).filter(Boolean)
}

function cleanChoice(text: string): string {
    return text
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim()
}
