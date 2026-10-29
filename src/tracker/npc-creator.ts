/**
 * The NPC creator's grammar and prompts (Phase 41a).
 *
 * The legacy's NPC/PC Manager has three tabs beside the library — **From
 * Card**, **Freeform**, **Archetype** — and two buttons on a card or a library
 * record: **Add as is** and **Fit into Story**. All of it lives in
 * `panel-builder.js` as closures over the panel (`parseNpcTag`,
 * `createNpcFromCharCard`, `minimalReviewNpcWithAI`, `adaptNpcWithAI`,
 * `gatherNpcCampaignContext`, `generateNpcFromFreeform`,
 * `generateNpcFromArchetype`, `showNpcPreviewAndAdd`), so none of it can be
 * sliced: the text is transcribed here in pieces and `npc-creator.pin.test.ts`
 * holds every piece to the source at the pin, as 35c and 39 hold theirs.
 *
 * Every model call answers with one tag, `[[NPC: Name | Description |
 * keywords]]`, and `parseNpcTag` reads it; `entryFrom` turns a card, a library
 * record or a tag into the entry the campaign's NPC book gets, with the
 * `[CORE]` wrap the legacy guarantees.
 */

import { memoForNarrativeContext } from './prompt.js'

// ── The tag ─────────────────────────────────────────────────────────────────

export interface NpcTag {
    name: string
    description: string
    keywords: string[]
}

/** The legacy's `parseNpcTag`: the first `[[NPC: Name | Description | Keywords]]` anywhere in the text. */
export function parseNpcTag(text: string | null | undefined): NpcTag | null {
    if (!text) return null
    const match = text.match(/\[\[NPC:\s*([^|]*?)\s*\|\s*([\s\S]*?)\s*\|\s*([^|]*?)\]\]/i)
    if (!match) return null
    return {
        name: match[1]!.trim(),
        description: match[2]!.trim(),
        keywords: match[3]!.split(',').map((k) => k.trim()).filter(Boolean),
    }
}

// ── The entry ───────────────────────────────────────────────────────────────

export interface NpcSourceCard {
    name: string
    description?: string
    personality?: string
    /** Keys that outrank the ones derived: a library record's. */
    keys?: string[]
}

export interface NpcEntry {
    name: string
    content: string
    keys: string[]
}

/** The legacy's stray-separator cleanup: a `|` the model used instead of a newline before a section label. */
const STRAY_SEPARATOR = /\s*\|\s*(?=(?:Appearance\/Species|Appearance):|Personality:|Brief Background:|Habits\/Behaviors:|Relationship with)/gi

/** The legacy's text-based relationship lines, dropped from a `[CORE]` wrap: the values are code-owned there. */
const RELATIONSHIP_LINE = /^(?:Friendship\/Rapport|Affection\/Interest):/i

/** Wrap content that has no `[CORE]` in one, dropping the legacy's relationship lines and the blank lines around them. */
export function ensureCore(content: string): string {
    if (/\[CORE\]/i.test(content)) return content
    const coreLines: string[] = []
    for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (RELATIONSHIP_LINE.test(trimmed)) continue
        if (trimmed || coreLines.length > 0) coreLines.push(line)
    }
    while (coreLines.length > 0 && !coreLines[coreLines.length - 1]!.trim()) coreLines.pop()
    return `[CORE]\n${coreLines.join('\n')}\n[/CORE]`
}

/**
 * The legacy's `createNpcFromCharCard`, up to the write: the entry's name,
 * content and keys from a card and, when the model has spoken, its tag.
 *
 * Without a tag the card's description is taken verbatim and wrapped in
 * `[CORE]`, with the personality after it only when the description does not
 * already carry its opening. With a tag the tag's name and keywords win and
 * the description is its content. Either way the content ends up inside one
 * `[CORE]` block, and a record's own keys outrank everything.
 */
export function entryFrom(card: NpcSourceCard, adapted: string | null = null): NpcEntry {
    let name = card.name || 'Unnamed NPC'
    let keys = [name]
    const firstName = name.split(/\s+/)[0]
    if (firstName && firstName !== name) keys.push(firstName)

    let content: string
    if (adapted) {
        const parsed = parseNpcTag(adapted)
        if (parsed) {
            name = parsed.name
            content = parsed.description.replace(STRAY_SEPARATOR, '\n')
            if (parsed.keywords.length > 0) keys = parsed.keywords
        } else {
            content = adapted
        }
    } else {
        const parts = ['[CORE]']
        const description = card.description ?? ''
        if (description) parts.push(description.substring(0, 3000))
        const personality = card.personality ?? ''
        if (personality && !description.includes(personality.substring(0, 40))) parts.push(personality.substring(0, 1000))
        parts.push('[/CORE]')
        content = parts.join('\n')
    }

    content = ensureCore(content)

    if (Array.isArray(card.keys) && card.keys.length) {
        const override = card.keys.map((k) => String(k ?? '').trim()).filter(Boolean)
        if (override.length) keys = override
    }
    return { name, content, keys }
}

/** The legacy's duplicate test: an entry's title with a leading `[tag]` dropped, case-blind. */
export function entryLabel(comment: string | null | undefined): string {
    return (comment || '').replace(/^\[.*?\]\s*/i, '').toLowerCase().trim()
}

export function hasEntryNamed(entries: ReadonlyArray<{ comment: string }>, name: string): boolean {
    const wanted = name.toLowerCase().trim()
    return !!wanted && entries.some((entry) => entryLabel(entry.comment) === wanted)
}

// ── The sections and the archetypes ─────────────────────────────────────────

/** The names of the legacy's `DEFAULT_NPC_SECTIONS`, the fallback when the cartridge's `npcCoreSections` is empty. */
export const DEFAULT_NPC_SECTION_NAMES = ['Species', 'Body', 'Worn Equipment', 'Personality', 'Brief Background', 'Habits/Behaviors', 'Strengths', 'Flaws', 'Combat Profile'] as const

/** The section names the prompts list, from the cartridge's sections or the defaults. */
export function npcSectionNames(sections: unknown): string[] {
    if (Array.isArray(sections) && sections.length > 0) {
        const names = sections.map((section) => (section && typeof section === 'object' ? String((section as { name?: unknown }).name ?? '').trim() : '')).filter(Boolean)
        if (names.length) return names
    }
    return [...DEFAULT_NPC_SECTION_NAMES]
}

/** The archetype chips, as the legacy's dialog lists them; *Custom* is a typed role. */
export const NPC_ARCHETYPES: ReadonlyArray<{ id: string; icon: string }> = [
    { id: 'Enemy', icon: '⚔️' },
    { id: 'Arch Nemesis', icon: '💀' },
    { id: 'Lover', icon: '❤️' },
    { id: 'Family Relative', icon: '👨‍👩‍👧' },
    { id: 'Companion / Ally', icon: '🛡️' },
    { id: 'Merchant', icon: '🪙' },
    { id: 'Mysterious Stranger', icon: '🎭' },
    { id: 'Rival', icon: '🧙' },
    { id: 'Custom', icon: '✍️' },
]

// ── The prompts ─────────────────────────────────────────────────────────────

/**
 * The legacy's text, piece by piece. Each piece is a literal run of the
 * source between interpolations, and the pin test finds every one in
 * `panel-builder.js` or `defaults.js` at the pin.
 */
export const NPC_CREATOR_TEXT = {
    reviewRole: 'You are an NPC Minimal Review Agent. Your ONLY job is to fix logical impossibilities caused by world or era mismatches (e.g. a character has a smartphone in a medieval fantasy setting, or uses modern slang in a historical world).\n\nRULES:\n- Preserve the original character card writing as faithfully as possible.\n- Do NOT restructure, rewrite, or expand the content.\n- Do NOT change the character\'s personality, motivations, backstory, or relationships unless they are logically impossible in this setting.\n- ONLY change specific terminology, equipment names, or references that are a hard logical impossibility.\n- If the card fits fine or has only minor style mismatches, output it almost entirely unchanged.\n- Wrap the full content in a [CORE] and [/CORE] block.\n- Your output MUST be strictly formatted as:\n  [[NPC: Name | Description | keywords]]\n- Output ONLY this single [[NPC: ...]] tag. No preamble or explanation.\n',
    reviewSeparator: '- Do NOT use the "|\'" character inside the Description; use newlines to separate internal sections.',
    adaptRole: 'You are an NPC Adaptation Agent. Given a character card from a different source and the current RPG campaign context, adapt the character to fit naturally into the ongoing story.\n\n<npc_instructions>\n',
    adaptRules: '\n</npc_instructions>\n\nRules:\n- If the character is from a different era/genre (e.g., modern character in a medieval fantasy), translate their skills, equipment, backstory, and background to fit the current world setting.\n- Preserve the character\'s core personality, motivations, and distinguishing traits.',
    adaptMatchLength: '\n- MATCH LENGTH: Aim to make your output approximately the same length/word count as the original character card.',
    adaptFormat: '\n- Write a concise NPC lorebook entry following the exact <npc_instructions> provided above.\n- Your output MUST be strictly formatted as a lorebook entry tag. It MUST look EXACTLY like this:\n  [[NPC: Name | Description | keywords]]\n- Replace "Name" with the character\'s name.\n- Replace "Description" with the full formatted description section. Wrap all the immutable identity sections (',
    adaptSections: ') inside a single [CORE] and [/CORE] tag block within the Description. DO NOT include a Relationship field. DO NOT use the "|" character inside the Description; separate the internal sections using newlines.\n- CRITICAL: Do NOT blindly copy the formatting or sections of other characters found in ACTIVE MEMORY. You MUST strictly use ONLY the sections instructed below (',
    adaptEnd: ') and ignore any other sections.\n- Replace "keywords" with a comma-separated list of keywords including their name.\n- Output ONLY this single [[NPC: ...]] string. No preamble, no explanation, no other tags.',
    freeformRole: 'You are an NPC Creation Agent. The user has provided a brief concept or description for a new NPC they want to add to the current ongoing campaign.\n',
    forbiddenHead: '\nForbidden Names (Do NOT use these existing NPC/character names under any circumstances):\n',
    instructionsOpen: '\n<npc_instructions>\n',
    freeformRules: '\n</npc_instructions>\n\nRules:\n- Use the USER\'S NPC CONCEPT as your primary source. Expand it into a full, vivid character.\n- If no name is provided, create a fitting one for the world setting using the New NPC Naming Rule below.\n- You MUST NOT use any of the names listed in the Forbidden Names section. If the concept implies a name from this list, modify or create a new unique name using the New NPC Naming Rule below.\n- If the user already provided a name, keep it (do not rename) unless it is forbidden.\n- Adapt appearance, background and habits to fit naturally into the current campaign setting/tone inferred from context.\n- Your output MUST be strictly formatted as a lorebook entry tag:\n  [[NPC: Name | Description | keywords]]\n- Replace "Name" with the character\'s name.\n- Replace "Description" with the full formatted entry. Wrap all immutable identity sections (',
    creationSections: ') inside a single [CORE] and [/CORE] block. DO NOT use "|" inside Description. Use newlines.\n- CRITICAL: Do NOT blindly copy the formatting or sections of other characters found in ACTIVE MEMORY. You MUST strictly use ONLY the sections instructed below (',
    creationEnd: ') and ignore any other sections.\n- Replace "keywords" with a comma-separated list including their name.\n- Output ONLY this single [[NPC: ...]] tag. No preamble, no explanation.\n\n',
    archetypeRole: 'You are an NPC Creation Agent. Create a new NPC for the current ongoing campaign fitting the requested archetype.\n',
    archetypeRules: '\n</npc_instructions>\n\nRules:\n- The NPC MUST embody the requested archetype (e.g. a "Lover" should have romantic motivation toward the player; an "Arch Nemesis" should be a credible threat with personal stakes).\n- Invent a name suitable for the world if not provided, using the New NPC Naming Rule below.\n- You MUST NOT use any of the names listed in the Forbidden Names section. If you must invent a replacement name, use the New NPC Naming Rule below.\n- If a Desired Name is provided, keep it (do not rename) unless it is forbidden.\n- Ground the NPC\'s appearance, backstory, and habits in the current campaign setting inferred from context.\n- Your output MUST be strictly formatted as a lorebook entry tag:\n  [[NPC: Name | Description | keywords]]\n- Replace "Name" with the character\'s name.\n- Replace "Description" with the full formatted entry. Wrap all immutable identity sections (',
    card: 'CHARACTER CARD:\nName: ',
    state: 'CURRENT GAME STATE:\n',
    recentSetting: 'RECENT CHAT (for setting context):\n',
    recentTone: 'RECENT CHAT (for setting/tone context):\n',
    narrator: 'NARRATOR/WORLD CARD:\n',
    lore: 'ACTIVE LOREBOOK ENTRIES (world context):\n',
    concept: 'USER\'S NPC CONCEPT:\n',
    archetypeRequest: 'ARCHETYPE REQUEST:\nArchetype: ',
    desiredName: 'Desired Name: ',
    additionalConcept: 'Additional concept: ',
    /** The legacy's `NEW_NPC_NAMING_RULE` (`defaults.js`), shared with the World Skeleton; its `{{random:…}}` macros resolve on the way to the model. */
    namingRule: '[New NPC Naming Rule: When introducing a new, unestablished character, silently create their name using these dynamic constraints:\nStyle & Culture: Analyze the current scene, local region, and surrounding characters. Match the linguistic flavor, tone, and naming conventions natively found in the immediate environment.\nMandatory Starting Sounds: First Name Root: \'{{random:a,e,i,o,u,ba,be,bi,bo,bu,ca,ce,ci,co,cu,da,de,di,do,du,fa,fe,fi,fo,fu,ga,ge,gi,go,gu,ha,he,hi,ho,hu,ja,je,ji,jo,ju,ka,ke,ki,ko,ku,la,le,li,lo,lu,ma,me,mi,mo,mu,na,ne,ni,no,nu,pa,pe,pi,po,pu,qua,que,qui,quo,ra,re,ri,ro,ru,sa,se,si,so,su,ta,te,ti,to,tu,va,ve,vi,vo,vu,wa,we,wi,wo,wu,ya,ye,yi,yo,yu,za,ze,zi,zo,zu}}{{random:l,n,r,s,t,v,m,d}}\' | Last Name Root: \'{{random:a,e,i,o,u,ba,be,bi,bo,bu,ca,ce,ci,co,cu,da,de,di,do,du,fa,fe,fi,fo,fu,ga,ge,gi,go,gu,ha,he,hi,ho,hu,ja,je,ji,jo,ju,ka,ke,ki,ko,ku,la,le,li,lo,lu,ma,me,mi,mo,mu,na,ne,ni,no,nu,pa,pe,pi,po,pu,qua,que,qui,quo,ra,re,ri,ro,ru,sa,se,si,so,su,ta,te,ti,to,tu,va,ve,vi,vo,vu,wa,we,wi,wo,wu,ya,ye,yi,yo,yu,za,ze,zi,zo,zu}}{{random:l,n,r,s,t,v,m,d}}\'.\nProcedure: Treat the roots as the starting sound or prefix. Append natural syllables or traditional suffixes that fit the local culture and genre setting you identified. Ensure the final result is pronounceable and sounds like an authentic, ordinary name for this specific region. \nAnti-Echo Diversity: Do not rely on default high-frequency placeholder names. The first and last names must not rhyme or share similar suffixes. Output the final name naturally in the narrative without revealing the roots, style prompts, or generation process. Do not rename existing characters.]',
} as const

/** The legacy joins the context parts with a rule. */
export const CONTEXT_JOIN = '\n\n---\n\n'

export interface RecentLine {
    user: boolean
    name: string
    text: string
}

/** What every prompt is built from: the campaign as the legacy gathers it. */
export interface NpcPromptContext {
    /** The cartridge's `routerSystemPromptTemplate`, the agent's preamble, which the legacy puts first. */
    template: string
    /** The NPC module's instruction (`routerModules.npc.instruction`). */
    npcInstruction: string
    /** The cartridge's `npcCoreSections`, or anything; the names are read from it. */
    sections?: unknown
    memo: string
    recent: RecentLine[]
    /** The narrator's card text, `''` without one. */
    narrator: string
    /** The campaign's entries, title and content, for the world context. */
    lore: Array<{ comment: string; content: string }>
    /** The names already in the NPC book, which a creation must not reuse. */
    forbidden: string[]
    /** The legacy's `ignoreNpcImportLimits`: the adaptation matches the card's length. */
    matchLength?: boolean
}

export interface NpcPrompt {
    system: string
    user: string
}

function recentText(recent: RecentLine[]): string {
    return recent.filter((line) => line.text.trim()).map((line) => `${line.name || (line.user ? 'User' : 'Character')}: ${line.text}`).join('\n\n')
}

function loreText(lore: NpcPromptContext['lore'], cap: number): string {
    return lore.slice(0, cap).map((entry) => `[${entry.comment || 'Entry'}]: ${entry.content || ''}`).join('\n')
}

function forbiddenBlock(names: string[]): string {
    return names.length ? `${NPC_CREATOR_TEXT.forbiddenHead}${names.map((n) => `- ${n}`).join('\n')}\n` : ''
}

function preamble(template: string): string {
    return `${template || ''}\n\n---\n\n`
}

/** The legacy's `gatherNpcCampaignContext`: the state, the last eight messages, the narrator's card and twelve entries. */
export function campaignContext(ctx: NpcPromptContext): string[] {
    const parts: string[] = []
    if (ctx.memo) parts.push(`${NPC_CREATOR_TEXT.state}${memoForNarrativeContext(ctx.memo)}`)
    const recent = recentText(ctx.recent.slice(-8))
    if (recent) parts.push(`${NPC_CREATOR_TEXT.recentTone}${recent.substring(0, 4000)}`)
    if (ctx.narrator) parts.push(`${NPC_CREATOR_TEXT.narrator}${ctx.narrator}`)
    const lore = loreText(ctx.lore, 12)
    if (lore) parts.push(`${NPC_CREATOR_TEXT.lore}${lore}`)
    return parts
}

/** The legacy's `minimalReviewNpcWithAI`: the card's writing kept, only impossibilities fixed. */
export function reviewPrompt(card: NpcSourceCard, ctx: NpcPromptContext): NpcPrompt {
    const T = NPC_CREATOR_TEXT
    const parts: string[] = []
    parts.push(`${T.card}${card.name || 'Unnamed'}\nDescription: ${(card.description || '').substring(0, 3000)}\nPersonality: ${(card.personality || '').substring(0, 1000)}`)
    if (ctx.memo) parts.push(`${T.state}${memoForNarrativeContext(ctx.memo).substring(0, 2000)}`)
    const recent = recentText(ctx.recent.slice(-8))
    if (recent) parts.push(`${T.recentSetting}${recent.substring(0, 4000)}`)
    if (ctx.narrator) parts.push(`${T.narrator}${ctx.narrator.substring(0, 1500)}`)
    return {
        system: `${preamble(ctx.template)}${T.reviewRole}${T.reviewSeparator}`,
        user: parts.join(CONTEXT_JOIN),
    }
}

/** The legacy's `adaptNpcWithAI`: the card rewritten to fit the campaign. */
export function adaptPrompt(card: NpcSourceCard, ctx: NpcPromptContext): NpcPrompt {
    const T = NPC_CREATOR_TEXT
    const parts: string[] = []
    parts.push(`${T.card}${card.name || 'Unnamed'}\nDescription: ${card.description || ''}\nPersonality: ${card.personality || ''}`)
    if (ctx.memo) parts.push(`${T.state}${memoForNarrativeContext(ctx.memo)}`)
    const recent = recentText(ctx.recent.slice(-10))
    if (recent) parts.push(`${T.recentSetting}${recent.substring(0, 6000)}`)
    if (ctx.narrator) parts.push(`${T.narrator}${ctx.narrator}`)
    const lore = loreText(ctx.lore, 15)
    if (lore) parts.push(`${T.lore}${lore}`)
    const names = npcSectionNames(ctx.sections).join(', ')
    return {
        system: `${preamble(ctx.template)}${T.adaptRole}${ctx.npcInstruction}${T.adaptRules}${ctx.matchLength ? T.adaptMatchLength : ''}${T.adaptFormat}${names}${T.adaptSections}${names}${T.adaptEnd}`,
        user: parts.join(CONTEXT_JOIN),
    }
}

/** The legacy's `generateNpcFromFreeform`: a concept expanded into an NPC. */
export function freeformPrompt(request: { name: string; description: string }, ctx: NpcPromptContext): NpcPrompt {
    const T = NPC_CREATOR_TEXT
    const label = request.name ? `Name: ${request.name}\n` : ''
    const parts = [`${T.concept}${label}Description: ${request.description}`, ...campaignContext(ctx)]
    const names = npcSectionNames(ctx.sections).join(', ')
    return {
        system: `${preamble(ctx.template)}${T.freeformRole}${forbiddenBlock(ctx.forbidden)}${T.instructionsOpen}${ctx.npcInstruction}${T.freeformRules}${names}${T.creationSections}${names}${T.creationEnd}${T.namingRule}`,
        user: parts.join(CONTEXT_JOIN),
    }
}

/** The legacy's `generateNpcFromArchetype`: a story role made into an NPC. */
export function archetypePrompt(request: { archetype: string; name: string; concept: string }, ctx: NpcPromptContext): NpcPrompt {
    const T = NPC_CREATOR_TEXT
    const nameLine = request.name ? `${T.desiredName}${request.name}\n` : ''
    const conceptLine = request.concept ? `${T.additionalConcept}${request.concept}\n` : ''
    const parts = [`${T.archetypeRequest}${request.archetype}\n${nameLine}${conceptLine}`, ...campaignContext(ctx)]
    const names = npcSectionNames(ctx.sections).join(', ')
    return {
        system: `${preamble(ctx.template)}${T.archetypeRole}${forbiddenBlock(ctx.forbidden)}${T.instructionsOpen}${ctx.npcInstruction}${T.archetypeRules}${names}${T.creationSections}${names}${T.creationEnd}${T.namingRule}`,
        user: parts.join(CONTEXT_JOIN),
    }
}

/** The *Add as is* modes: the legacy's `npcAddAsIsMode`, `ai_review` by default. */
export type AddAsIsMode = 'literal' | 'ai_review'

export function normalizeAddAsIsMode(value: unknown): AddAsIsMode {
    return value === 'literal' ? 'literal' : 'ai_review'
}
