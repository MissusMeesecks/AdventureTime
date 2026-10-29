/**
 * The panel's map making (71a) held to the pinned source: the reference
 * context against the checkout's own `buildMapArchitectReferenceContext`
 * over the same books and cards, the brief handshake's prompt against the
 * template sliced out of `map-architect.js`, and the two form defaults
 * against the functions sliced out of `panel-builder.js` — since those three
 * are closures over SillyTavern and cannot be imported whole.
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { briefDescriptionFromPrompt, premiseFromLocationContent } from '../tracker/map-premise.js'
import { buildBriefPrompt, buildReferenceContext, type ReferenceBook, type ReferenceCard } from './map-create.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && existsSync(`${checkout}/map-architect-context.js`) && existsSync(`${checkout}/src/ui/panel/panel-builder.js`)

/** A function's body sliced out of a source file by its signature, brace-matched. */
function sliceFunction(source: string, signature: string): string {
    const start = source.indexOf(signature)
    if (start < 0) throw new Error(`${signature} is not in the source`)
    let depth = 0
    for (let i = source.indexOf('{', start); i < source.length; i++) {
        if (source[i] === '{') depth++
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1)
    }
    throw new Error(`${signature} never closes`)
}

describe.skipIf(!available)('the panel’s map making against the pinned legacy build', () => {
    const BOOKS: ReferenceBook[] = [
        { name: 'Zeta', entries: [{ uid: '1', comment: 'The Kings', key: ['kings'], content: 'Three kings ruled.' }, { uid: '2', comment: '', key: ['rumour', 'x'], content: 'A rumour.' }, { uid: '3', comment: '', key: [], content: ' Untitled. ' }, { uid: '4', comment: 'Blank', key: [], content: '   ' }] },
        { name: 'Alpha', entries: [{ uid: '1', comment: 'Tide', key: [], content: 'The tide turns.' }] },
        { name: 'Empty', entries: [] },
    ]
    const CARDS: ReferenceCard[] = [
        { name: 'Mara', description: 'A guide.', personality: ' ', scenario: 'Lost.', mesExample: 'Hi.', firstMessage: 'Hello.', creatorNotes: 'Notes.' },
        { name: '', description: 'Nameless.' },
        { name: 'Nobody' },
    ]

    it('builds the reference context as the checkout does, over the same books and cards', async () => {
        const theirs = (await import(`${checkout}/map-architect-context.js`)) as { buildMapArchitectReferenceContext(ctx: unknown, sources: unknown): Promise<string> }
        const ctx = {
            loadWorldInfo: async (name: string) => {
                const book = BOOKS.find((b) => b.name === name)
                if (!book) return null
                return { entries: Object.fromEntries(book.entries.map((e) => [e.uid, { comment: e.comment, key: e.key, content: e.content }])) }
            },
        }
        const cards = CARDS.map((c) => ({ name: c.name, description: c.description, personality: c.personality, scenario: c.scenario, mes_example: c.mesExample, first_mes: c.firstMessage, creator_notes: c.creatorNotes }))
        for (const [names, picked] of [[['Zeta', 'Alpha', 'Empty', 'Missing'], cards], [['Alpha'], []], [[], cards], [[], []]] as Array<[string[], typeof cards]>) {
            const expected = await theirs.buildMapArchitectReferenceContext(ctx, { lorebookNames: names, characterCards: picked })
            const ours = buildReferenceContext(BOOKS.filter((b) => names.includes(b.name)), CARDS.filter((c) => picked.some((p) => p.name === c.name)))
            expect(ours).toBe(expected)
        }
    })

    it('writes the brief handshake prompt as the checkout’s template does', () => {
        const source = readFileSync(`${checkout}/map-architect.js`, 'utf8')
        const start = source.indexOf('const userPrompt = `FILL CREATE_AREA_MAP FIELDS')
        expect(start).toBeGreaterThan(0)
        const end = source.indexOf('`;', start)
        const template = source.slice(start + 'const userPrompt = '.length, end + 1)
        const render = new Function('siteRoot', 'brief', 'lore', 'windowSize', 'context', 'referenceContext', `return ${template}`) as (...a: unknown[]) => string
        const cases = [
            { site: 'Varnholde Crypts', lore: 'A crypt.', brief: 'Flooded.', windowSize: 12, context: 'PLAYER: Go.\n\nNARRATOR: Gone.', referenceContext: 'USER-SELECTED REFERENCE CONTEXT\nx' },
            { site: 'Glassmere', lore: '', brief: '', windowSize: 0, context: '', referenceContext: '' },
        ]
        for (const c of cases) {
            const lore = c.lore.trim() || '(No location lore entry.)'
            const brief = c.brief.trim() || '(none)'
            expect(buildBriefPrompt(c)).toBe(render(c.site, brief, lore, c.windowSize, c.context, c.referenceContext))
        }
    })

    it('reads the premise and the brief description off an entry as the checkout’s panel does', async () => {
        const source = readFileSync(`${checkout}/src/ui/panel/panel-builder.js`, 'utf8')
        const reality = (await import(`${checkout}/dungeon-reality.js`)) as { stripDungeonMapSection(content: string): string }
        const premise = new Function('stripDungeonMapSection', `${sliceFunction(source, 'function premiseFromLocationContent(content)')}\nreturn premiseFromLocationContent`)(reality.stripDungeonMapSection) as (c: string) => string
        const brief = new Function(`${sliceFunction(source, 'function briefDescriptionFromPrompt(prompt, site = \'\')')}\nreturn briefDescriptionFromPrompt`)() as (p: string, s?: string) => string
        const contents = [
            '[CORE]\nA crypt beneath the abbey.\n[/CORE]\n\n[MAP]\n{"site":"x"}\n[/MAP]',
            '[CORE]\n\n\n\nA town.\n\n\n[/CORE]\n\n\n[#3] Visited.',
            '',
            'x'.repeat(1500),
            '[core]lower[/core]',
        ]
        for (const content of contents) expect(premiseFromLocationContent(content)).toBe(premise(content))
        const prompts: Array<[string, string]> = [['A flooded crypt. Three chambers!', 'X'], ['No terminal punctuation', 'X'], ['', 'Glassmere'], ['', ''], ['  Spaced   out?  Then more.', '']]
        for (const [prompt, site] of prompts) expect(briefDescriptionFromPrompt(prompt, site)).toBe(brief(prompt, site))
    })
})
