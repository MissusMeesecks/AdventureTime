import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { PORTRAIT_PROMPT_TEXT, PORTRAIT_ROSTER_RE, lookbackCount, storyContext } from './portrait-prompt.js'

/**
 * The per-entity portrait's prompt and roster are transcribed from
 * `portraits.js` (`generatePortraitPrompt`, `generateNpcPortraitPrompt`,
 * `getPartyMembers`, `getCharacterBlockNames`, `getEnemyEntities`), closures
 * over the whole install that cannot be sliced; this pins each piece of
 * text and each regex to the checkout, runs the checkout's own
 * `buildPortraitStoryContext` and `portraitStoryLookbackCount` beside ours
 * over a corpus, and pins the facts the phase leans on: the first check
 * seeds without drawing, a switch ticked draws everyone at once, NPCs are
 * drawn whenever they have no portrait, and the draws go through one queue.
 */
const checkout = process.env.MULTIHOG_CHECKOUT
const describeIf = checkout ? describe : describe.skip

describeIf('the per-entity portrait against the pinned legacy (61)', () => {
    const source = () => readFileSync(join(checkout!, 'portraits.js'), 'utf8')

    it('reads the roster with the legacy’s regexes', () => {
        const text = source()
        expect(text).toContain("const cleanLine = line.replace(/^\\s*[-*+•–—](?:\\s+|(?=[A-Za-z]))/, '');")
        expect(PORTRAIT_ROSTER_RE.marker.source).toBe('^\\s*[-*+•–—](?:\\s+|(?=[A-Za-z]))')
        expect(text).toContain('const hpMatch = cleanLine.match(/^(.+?):\\s*([\\d,]+)(?:\\/([\\d,]+))?\\s*HP/i);')
        expect(PORTRAIT_ROSTER_RE.hp.source).toBe('^(.+?):\\s*([\\d,]+)(?:\\/([\\d,]+))?\\s*HP')
        expect(PORTRAIT_ROSTER_RE.hp.flags).toBe('i')
        expect(text).toContain('if (/Combat Round\\s*\\d+/i.test(line)) continue;')
        expect(PORTRAIT_ROSTER_RE.round.source).toBe('Combat Round\\s*\\d+')
        // The character's fallbacks: a `Name:` line's value, else the label, else the line.
        expect(text).toContain("if (plainNameColonMatch[1].trim().toLowerCase() === 'name') {")
        // An enemy is a combatant who is neither the party's nor the character's, in upper case.
        expect(text).toContain('if (!excludeNames.has(name.toUpperCase())) {')
    })

    it('carries the character prompt’s labels word for word', () => {
        const text = source()
        expect(text).toContain('let contextParts = [`Character Name: ${entityName}`];')
        expect(PORTRAIT_PROMPT_TEXT.name('X')).toBe('Character Name: X')
        expect(text).toContain("const relevantTags = ['CHARACTER', 'PARTY', 'COMBAT'];")
        expect([...PORTRAIT_PROMPT_TEXT.tags]).toEqual(['CHARACTER', 'PARTY', 'COMBAT'])
        expect(text).toContain('if (block.toUpperCase().includes(entityName.toUpperCase())) {')
        expect(text).toContain('contextParts.push(`[${tag}] block (from State Memo):\\n${block.trim()}`);')
        expect(PORTRAIT_PROMPT_TEXT.block('PARTY', ' x ')).toBe('[PARTY] block (from State Memo):\nx')
        expect(text).toContain('contextParts.push(`Character Card Description:\\n${charData.description.substring(0, 2000)}`);')
        expect(PORTRAIT_PROMPT_TEXT.card('y'.repeat(2001))).toBe(`Character Card Description:\n${'y'.repeat(2000)}`)
        expect(text).toContain('contextParts.push(`User Persona:\\n${persona.trim()}`);')
        expect(PORTRAIT_PROMPT_TEXT.persona(' p ')).toBe('User Persona:\np')
        expect(text).toContain("`[Lorebook: ${e.comment || e.key?.[0] || 'Entry'}]\\n${(e.content || '').substring(0, 800)}`")
        expect(text).toContain("contextParts.push(`Matching Lorebook Entries:\\n${loreText}`);")
        expect(PORTRAIT_PROMPT_TEXT.lore([{ label: '', content: 'c' }])).toBe('Matching Lorebook Entries:\n[Lorebook: Entry]\nc')
        expect(text).toContain('contextParts.push(`Current Game State:\\n${memoForGmContext(s.currentMemo).substring(0, 2000)}`);')
        expect(PORTRAIT_PROMPT_TEXT.state('m'.repeat(2001))).toBe(`Current Game State:\n${'m'.repeat(2000)}`)
        expect(text).toContain("const userPrompt = contextParts.join('\\n\\n---\\n\\n');")
        expect(PORTRAIT_PROMPT_TEXT.separator).toBe('\n\n---\n\n')
        // The keyword rule for a matching entry: either contains the other, case-blind.
        expect(text).toContain('entityName.toLowerCase().includes(k.toLowerCase()) ||')
        expect(text).toContain('k.toLowerCase().includes(entityName.toLowerCase())')
        // The card goes in whatever the lookback switch says; the rest only behind it.
        expect(text.indexOf('Character Card Description')).toBeLessThan(text.indexOf('if (useStoryLookback) {'))
        expect(text.indexOf('if (useStoryLookback) {')).toBeLessThan(text.indexOf('User Persona:\\n'))
        // The character's story context takes the defaults; the NPC's names a cap and a label.
        expect(text).toContain('const storyContext = buildPortraitStoryContext(ctx, portraitStoryLookbackCount(s));')
        expect(text).toContain("maxChars: 4000,\n            label: 'Recent Scene Context',")
        expect(PORTRAIT_PROMPT_TEXT.characterStory).toEqual({ maxChars: 12000, label: 'Recent Chat Context' })
        expect(PORTRAIT_PROMPT_TEXT.npcStory).toEqual({ maxChars: 4000, label: 'Recent Scene Context' })
    })

    it('carries the NPC prompt’s lookback labels word for word', () => {
        const text = source()
        expect(text).toContain('contextParts.push(`User Persona (for art style context):\\n${persona.trim()}`);')
        expect(PORTRAIT_PROMPT_TEXT.npcPersona(' p ')).toBe('User Persona (for art style context):\np')
        expect(text).toContain('contextParts.push(`Narrator Card Description (for world context):\\n${charData.description.substring(0, 1500)}`);')
        expect(PORTRAIT_PROMPT_TEXT.npcCard('n'.repeat(1501))).toBe(`Narrator Card Description (for world context):\n${'n'.repeat(1500)}`)
    })

    it('fills the same two placeholders of the character system prompt', () => {
        const text = source()
        expect(text).toContain('const systemPrompt = (s.portraitCharacterSystemPrompt || \'\')')
        expect(text).toContain('.replace(/\\{\\{name\\}\\}/g, entityName)')
        expect(text).toContain('.replace(/\\{\\{wordtarget\\}\\}/g, String(s.portraitPromptWordTarget || 200))')
    })

    it('builds the story context as the checkout’s own module does, over a corpus', async () => {
        const theirs = (await import(/* @vite-ignore */ `${checkout}/src/state/portrait-story-lookback.js`)) as {
            buildPortraitStoryContext: (ctx: { chat: Array<{ name?: string; mes: string; is_user?: boolean; is_system?: boolean }> }, lookback: number, options?: { maxChars?: number; label?: string }) => string
            portraitStoryLookbackCount: (settings: { portraitStoryLookback?: unknown }) => number
        }
        const chats: Array<Array<{ name?: string; mes: string; is_user?: boolean; is_system?: boolean }>> = [
            [],
            [{ name: 'Wrenna', mes: 'Hello?', is_user: true }],
            [{ name: 'Wrenna', mes: 'I open the door.', is_user: true }, { name: 'Narrator', mes: '' }, { name: 'Narrator', mes: 'It creaks.' }, { name: 'Wrenna', mes: 'Hello?', is_user: true }],
            [{ mes: 'No name here.', is_user: true }, { mes: 'Nor here.' }],
            [{ name: 'Narrator', mes: 'x'.repeat(5000) }, { name: 'Wrenna', mes: 'y'.repeat(5000), is_user: true }, { name: 'Narrator', mes: 'z'.repeat(5000) }],
            [{ name: 'System', mes: 'hidden', is_system: true }, { name: 'Narrator', mes: 'shown' }],
        ]
        const options = [undefined, { maxChars: 4000, label: 'Recent Scene Context' }, { maxChars: 12 }]
        let compared = 0
        for (const chat of chats) {
            // The legacy drops system messages before counting; ours are handed the lines already chosen.
            const lines = chat.filter((m) => !m.is_system).map((m) => ({ name: m.name || (m.is_user ? 'User' : 'Character'), text: m.mes }))
            for (const lookback of [0, 1, 2, 3, 100]) {
                for (const option of options) {
                    expect(storyContext(lines, lookback, option)).toBe(theirs.buildPortraitStoryContext({ chat }, lookback, option))
                    compared++
                }
            }
        }
        expect(compared).toBe(90)
        for (const value of [undefined, null, 'x', 7.9, -2, 500, 0, '12', 100]) {
            expect(lookbackCount(value)).toBe(theirs.portraitStoryLookbackCount({ portraitStoryLookback: value }))
        }
    })

    it('pins the auto-generation’s rules the phase keeps: the first check seeds, a tick draws everyone, an NPC without a portrait is drawn, one queue', () => {
        const text = source()
        // The first check after a chat is shown records who is there and draws nobody (the F5 rule).
        expect(text).toContain('// On initial startup/F5, record all existing entities as already known without generating anything')
        expect(text).toContain('if (isFirstCheck) {')
        // After it, the party, the player and the enemies are drawn when new; an NPC whenever it has no portrait.
        expect(text).toContain('if (!knownEntities.has(key)) {')
        expect(text).toContain('if (!hasPortrait(name)) {')
        // A name with a portrait, or a draw in flight, is skipped.
        expect(text).toContain('if (alreadyHas) return;\n    if (alreadyGenerating) return;')
        // One draw at a time, whoever asked.
        expect(text).toContain('Queues background portrait generation for a name (sequential — one image at a time).')
        // A switch ticked on draws everyone it covers now, the known list notwithstanding.
        const index = readFileSync(join(checkout!, 'index.js'), 'utf8')
        expect(index).toContain('if (settings.portraitAutoGenerateParty) {\n                forceCheckAutoGenerations(refreshAll);')
        // The checks run after every panel refresh and after every agent pass.
        expect(index).toContain('scheduleDeferred(() => checkAndTriggerAutoGenerations(refreshAll));')
        expect(readFileSync(join(checkout!, 'src/ui/panel/panel-builder.js'), 'utf8')).toContain("if (step.type === 'finish' && source === 'lorebook_agent') {\n                checkAndTriggerAutoGenerations(refreshAll);")
        // The four switches, off by default and not cartridge keys; the lookback the same.
        const defaults = readFileSync(join(checkout!, 'src/state/defaults.js'), 'utf8')
        for (const key of ['portraitAutoGenerateParty', 'portraitAutoGeneratePlayer', 'portraitAutoGenerateEnemies', 'portraitAutoGenerateNpcs', 'portraitUseStoryLookback']) {
            expect(defaults).toContain(`${key}: false,`)
        }
        expect(defaults).toContain('portraitStoryLookback: 5,')
        // The NPC prompt is written on the legacy's portrait connection, a text connection of its own; the image on its generator source.
        expect(text).toContain('export function getPortraitConnectionSettings(baseSettings) {')
        expect(text).toContain("connectionSource: s.portraitConnectionSource ?? 'default',")
        // The legacy squares every drawn portrait; 60's 2:3 is kept here instead.
        expect(text).toContain('const scaled = await scaleImageTo512Square(dataUrl);')
    })
})
