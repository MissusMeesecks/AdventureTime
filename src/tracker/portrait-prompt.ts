/**
 * The portraits drawn as they appear (Phase 61, roadmap row 61): who the
 * memo names for a portrait, and the prompt that describes one of them to
 * the image model.
 *
 * The legacy's `portraits.js` draws a portrait for every party member, the
 * character and every enemy as they appear, and for every NPC the campaign's
 * book holds, through one queue. The roster readers here are its
 * `getPartyMembers`, `getCharacterBlockNames` and `getEnemyEntities`: a
 * name is a line that ends in hit points (`Name: 12/12 HP`), a bullet
 * before it dropped, and an enemy is a `[COMBAT]` line of that shape whose
 * name is neither the character's nor a party member's. The prompt is its
 * `generatePortraitPrompt` (the character's: the name, every memo block
 * that names them, the narrator's card, and with the story lookback on,
 * the persona, the matching lore, the game state and the recent story) and
 * its `generateNpcPortraitPrompt` (an NPC's: 60's `buildLibraryPhotoPrompt`
 * with the lookback's persona, the narrator's card and the recent scene),
 * transcribed piece by piece and pinned to the checkout by
 * `portrait-prompt.pin.test.ts`, since both are closures over the whole
 * SillyTavern install. The story context is the legacy's
 * `buildPortraitStoryContext`, which the pin test runs beside ours.
 *
 * Two of the legacy's lookback sections are not here: *Active Lorebook
 * Context* and *Current Lorebook Agent (All Active Entries)* read
 * SillyTavern's keyword activation and the agent's active-key list, neither
 * of which AdventureTime has (lorebook activation is the host's;
 * `docs/DECISION-ACTIVATION.md`). The matching-entries section, which reads
 * the books by keyword against the name, stands in for both.
 */

import { parseMemoBlocks } from './memo.js'
import { memoForNarrativeContext } from './prompt.js'
import { LIBRARY_PHOTO_TEXT, type LibraryPhotoPromptInput } from './library-photo.js'

/** The legacy's line readers (`portraits.js`, pinned). */
export const PORTRAIT_ROSTER_RE = {
    /** A list marker before a name, dropped before the line is read. */
    marker: /^\s*[-*+•–—](?:\s+|(?=[A-Za-z]))/,
    /** `Name: 12/12 HP` — the name is everything before the colon. */
    hp: /^(.+?):\s*([\d,]+)(?:\/([\d,]+))?\s*HP/i,
    /** A `[COMBAT]` round header, never a combatant. */
    round: /Combat Round\s*\d+/i,
} as const

/** Every `Name: X/Y HP` line of a block, as the legacy reads a roster. */
function hpNames(block: string): string[] {
    const names: string[] = []
    for (const line of block.split('\n')) {
        const clean = line.trim().replace(PORTRAIT_ROSTER_RE.marker, '')
        const match = clean.match(PORTRAIT_ROSTER_RE.hp)
        if (match) names.push(match[1]!.trim())
    }
    return names
}

/** The party's names: the legacy's `getPartyMembers`. */
export function partyMembers(memo: string): string[] {
    const block = parseMemoBlocks(memo || '').PARTY
    return block ? hpNames(block) : []
}

/**
 * The character's names: the legacy's `getCharacterBlockNames`. Every HP
 * line; failing one before any name, the first `Name: X` line's value, or
 * the first line's label, or the first line whole.
 */
export function characterBlockNames(memo: string): string[] {
    const block = parseMemoBlocks(memo || '').CHARACTER ?? ''
    const names: string[] = []
    for (const line of block.split('\n')) {
        const clean = line.trim().replace(PORTRAIT_ROSTER_RE.marker, '')
        if (!clean) continue
        const hp = clean.match(PORTRAIT_ROSTER_RE.hp)
        if (hp) {
            names.push(hp[1]!.trim())
            continue
        }
        if (names.length === 0) {
            const pair = clean.match(/^(.+?):\s*(.*)/)
            if (pair) {
                if (pair[1]!.trim().toLowerCase() === 'name') names.push(pair[2]!.trim())
                else names.push(pair[1]!.trim())
            } else {
                names.push(clean)
            }
        }
    }
    return names.filter(Boolean)
}

/** The character: the legacy's `getPrimaryCharacterBlockName`. */
export function primaryCharacterName(memo: string): string | null {
    return characterBlockNames(memo)[0] ?? null
}

/**
 * The enemies: the legacy's `getEnemyEntities` — every HP line of
 * `[COMBAT]` but the round headers, whose name is not the party's nor the
 * character's, compared in upper case.
 */
export function enemyEntities(memo: string): string[] {
    const blocks = parseMemoBlocks(memo || '')
    const exclude = new Set<string>()
    for (const name of partyMembers(memo)) exclude.add(name.toUpperCase())
    for (const name of hpNames(blocks.CHARACTER ?? '')) exclude.add(name.toUpperCase())
    const enemies: string[] = []
    for (const line of (blocks.COMBAT ?? '').split('\n').map((l) => l.trim()).filter(Boolean)) {
        if (PORTRAIT_ROSTER_RE.round.test(line)) continue
        const clean = line.replace(PORTRAIT_ROSTER_RE.marker, '')
        const match = clean.match(PORTRAIT_ROSTER_RE.hp)
        if (!match) continue
        const name = match[1]!.trim()
        if (!exclude.has(name.toUpperCase())) enemies.push(name)
    }
    return enemies
}

export interface PortraitRoster {
    character: string | null
    party: string[]
    enemies: string[]
}

/** Who the memo names, by the legacy's three readers. */
export function portraitRoster(memo: string): PortraitRoster {
    return { character: primaryCharacterName(memo), party: partyMembers(memo), enemies: enemyEntities(memo) }
}

/** The legacy's text, in the legacy's words (`portraits.js`, `portrait-story-lookback.js`; pinned). */
export const PORTRAIT_PROMPT_TEXT = {
    name: (name: string) => `Character Name: ${name}`,
    block: (tag: string, block: string) => `[${tag}] block (from State Memo):\n${block.trim()}`,
    card: (description: string) => `Character Card Description:\n${description.substring(0, 2000)}`,
    persona: (persona: string) => `User Persona:\n${persona.trim()}`,
    lore: (entries: Array<{ label: string; content: string }>) =>
        `Matching Lorebook Entries:\n${entries.map((e) => `[Lorebook: ${e.label || 'Entry'}]\n${(e.content || '').substring(0, 800)}`).join('\n\n')}`,
    state: (memo: string) => `Current Game State:\n${memo.substring(0, 2000)}`,
    /** The NPC path's lookback labels (`generateNpcPortraitPrompt`). */
    npcPersona: (persona: string) => `User Persona (for art style context):\n${persona.trim()}`,
    npcCard: (description: string) => `Narrator Card Description (for world context):\n${description.substring(0, 1500)}`,
    separator: '\n\n---\n\n',
    /** The three memo blocks the character's prompt looks for them in. */
    tags: ['CHARACTER', 'PARTY', 'COMBAT'] as const,
    /** The story context's bounds: the character's and the NPC's. */
    characterStory: { maxChars: 12000, label: 'Recent Chat Context' },
    npcStory: { maxChars: 4000, label: 'Recent Scene Context' },
} as const

/** One message of the recent story, as the legacy labels a line: the speaker's name, or `User` / `Character`. */
export interface StoryLine {
    name: string
    text: string
}

/**
 * The recent story for the prompt: the legacy's `buildPortraitStoryContext`
 * — the last `lookback` non-empty lines as `Name: text`, cut at `maxChars`,
 * under the label; `''` for no lines or a lookback of 0.
 */
export function storyContext(lines: StoryLine[], lookback: number, options: { maxChars?: number; label?: string } = {}): string {
    const { maxChars = 12000, label = 'Recent Chat Context' } = options
    if (!Array.isArray(lines) || lookback <= 0) return ''
    const filtered = lines.filter((m) => m.text && String(m.text).trim())
    const last = filtered.slice(-lookback)
    if (!last.length) return ''
    const text = last.map((m) => `${m.name}: ${m.text}`).join('\n\n')
    return `${label} (Last ${last.length} Message${last.length === 1 ? '' : 's'}):\n${text.substring(0, maxChars)}`
}

/** The lookback count as the legacy reads it: 5 when unreadable, 0 to 100, whole. */
export function lookbackCount(value: unknown): number {
    const raw = Number(value)
    if (!Number.isFinite(raw)) return 5
    return Math.max(0, Math.min(100, Math.trunc(raw)))
}

/** What the story lookback adds to the character's prompt, when it is on. */
export interface CharacterLookback {
    /** The active persona's text; empty for none. */
    persona: string
    /** The campaign's entries whose keywords meet the name (the legacy's rule: either contains the other, case-blind). */
    lore: Array<{ label: string; content: string }>
    /** The recent story, oldest first. */
    story: StoryLine[]
    /** How many of its lines go in. */
    count: number
    /** Whether the benched-party module is on, for the game state's compaction. */
    benchedParty?: boolean
}

export interface CharacterPortraitInput {
    name: string
    /** The memo as stored. */
    memo: string
    /** The narrator's card description; empty for none. */
    narratorDescription: string
    /** The cartridge's `portraitCharacterSystemPrompt`. */
    systemPrompt: string
    /** The cartridge's `portraitPromptWordTarget`. */
    wordTarget: number
    lookback?: CharacterLookback
}

/** Whether a block names the entity, as the legacy asks: the block in upper case contains the name in upper case. */
export function blockNames(block: string, name: string): boolean {
    return block.toUpperCase().includes(name.toUpperCase())
}

/** The two prompts of the call that writes a character's, a party member's or an enemy's image prompt. */
export function buildCharacterPortraitPrompt(input: CharacterPortraitInput): { system: string; user: string } {
    const parts = [PORTRAIT_PROMPT_TEXT.name(input.name)]
    const blocks = parseMemoBlocks(input.memo || '')
    for (const tag of PORTRAIT_PROMPT_TEXT.tags) {
        const block = blocks[tag]
        if (!block) continue
        if (blockNames(block, input.name)) parts.push(PORTRAIT_PROMPT_TEXT.block(tag, block))
    }
    if (input.narratorDescription) parts.push(PORTRAIT_PROMPT_TEXT.card(input.narratorDescription))
    const lookback = input.lookback
    if (lookback) {
        if (lookback.persona.trim()) parts.push(PORTRAIT_PROMPT_TEXT.persona(lookback.persona))
        if (lookback.lore.length > 0) parts.push(PORTRAIT_PROMPT_TEXT.lore(lookback.lore))
        if (input.memo) parts.push(PORTRAIT_PROMPT_TEXT.state(memoForNarrativeContext(input.memo, { benchedParty: lookback.benchedParty })))
        const story = storyContext(lookback.story, lookback.count, PORTRAIT_PROMPT_TEXT.characterStory)
        if (story) parts.push(story)
    }
    const system = input.systemPrompt
        .replace(/\{\{name\}\}/g, input.name)
        .replace(/\{\{wordtarget\}\}/g, String(input.wordTarget || 200))
    return { system, user: parts.join(PORTRAIT_PROMPT_TEXT.separator) }
}

/** What the story lookback adds to an NPC's prompt, when it is on. */
export interface NpcLookback {
    persona: string
    narratorDescription: string
    story: StoryLine[]
    count: number
}

/**
 * The two prompts of the call that writes an NPC's image prompt: 60's
 * library photo prompt, and with the lookback on, the legacy's three
 * additions after the entry.
 */
export function buildNpcPortraitPrompt(input: LibraryPhotoPromptInput & { lookback?: NpcLookback }): { system: string; user: string } {
    const parts = [LIBRARY_PHOTO_TEXT.name(input.name)]
    if (input.content.trim()) parts.push(LIBRARY_PHOTO_TEXT.entry(input.content))
    const lookback = input.lookback
    if (lookback) {
        if (lookback.persona.trim()) parts.push(PORTRAIT_PROMPT_TEXT.npcPersona(lookback.persona))
        if (lookback.narratorDescription) parts.push(PORTRAIT_PROMPT_TEXT.npcCard(lookback.narratorDescription))
        const story = storyContext(lookback.story, lookback.count, PORTRAIT_PROMPT_TEXT.npcStory)
        if (story) parts.push(story)
    }
    const system = input.systemPrompt
        .replace(/\{\{name\}\}/g, input.name)
        .replace(/\{\{wordtarget\}\}/g, String(input.wordTarget || 200))
    return { system, user: parts.join(PORTRAIT_PROMPT_TEXT.separator) }
}

/**
 * The legacy's keyword rule for a matching entry: a key that the name
 * contains, or that contains the name, case-blind.
 */
export function keyMeetsName(key: string, name: string): boolean {
    const k = key.toLowerCase()
    const n = name.toLowerCase()
    return !!k && (n.includes(k) || k.includes(n))
}
