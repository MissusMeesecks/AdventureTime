/**
 * The agent's action parser, differentially tested against the legacy build.
 *
 * This parser sits in front of code that rewrites the user's campaign lore, so
 * "we believe this matches" is not good enough. It lifts `parseTextAction` and
 * its two JSON helpers straight out of the pinned commit and runs both
 * implementations over the same corpus of replies.
 *
 * The corpus is deliberately built from the shapes models actually produce —
 * markdown-decorated markers, thinking-out-loud before the real call, prose
 * containing parentheses, trailing commas, coloured lore text — rather than
 * from what the prompt asks for. The prompt is not what arrives.
 *
 * Opt-in, like the other `.pin` tests. To run it:
 *
 *   git clone --filter=blob:none \
 *     https://github.com/MultihogAurelius/SillyTavern-MultihogDnDFramework /tmp/mh
 *   git -C /tmp/mh checkout d6aab004f97f1f9a286f235de62f22ba1abadbe8
 *   MULTIHOG_CHECKOUT=/tmp/mh npx vitest run src/agent/actions.pin.test.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { parseAgentAction } from './actions.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && existsSync(`${checkout}/router.js`) && existsSync(`${checkout}/memo-processor.js`)

type Legacy = (text: string) => { name: string; args: unknown; id: string } | null

describe.skipIf(!available)('the agent action parser against the pinned legacy build', () => {
    const legacy: Legacy = (() => {
        if (!available) return (() => null) as Legacy

        const slice = (file: string, from: string, to: string): string => {
            const source = readFileSync(`${checkout}/${file}`, 'utf8')
            const start = source.indexOf(from)
            const end = source.indexOf(to, start)
            if (start === -1 || end === -1) throw new Error(`${file} no longer contains: ${from}`)
            return source.slice(start, end)
        }

        // `parseTextAction` and the two JSON helpers it leans on, lifted whole.
        const body = [
            slice('memo-processor.js', 'export function repairJsonColorAttributes', '/**\n * JSON.parse that first repairs'),
            slice('memo-processor.js', 'export function parseJsonWithColorRepair', '/**\n * Strips bare timestamp-only lines'),
            slice('router.js', 'function parseTextAction', '/**\n * Broadcasts an agent step'),
        ]
            .join('\n')
            .replace(/^\s*export /gm, '')

        return new Function(`${body}\nreturn parseTextAction`)() as Legacy
    })()

    /**
     * The two are compared on name and args only. The legacy stamps `id` with
     * `Date.now()`, so comparing it would test the clock.
     */
    const agree = (text: string): void => {
        const ours = parseAgentAction(text, 'fixed')
        const theirs = legacy(text)

        if (theirs === null) {
            expect(ours, `expected null for:\n${text}`).toBeNull()
            return
        }
        expect(ours, `expected a parse for:\n${text}`).not.toBeNull()
        expect({ name: ours!.name, args: ours!.args }).toEqual({ name: theirs.name, args: theirs.args })
    }

    const CORPUS: Array<[string, string]> = [
        ['a bare commit', 'Action: commit({"activate": ["NPCs::12"]})'],
        ['a bold marker', 'Reasoning here.\n\n**Action:** commit({"deactivate": ["NPCs::3"]})'],
        ['an italic marker', 'Thinking.\n*Action:* grep_lore("Iron Syndicate")'],
        ['a heading marker', 'Prose.\n### Action commit({"activate": []})'],
        ['a list-item marker', 'Prose.\n- Action: read_entry("NPCs::7")'],
        ['an underscored marker', 'Prose.\n__Action__ inspect_book("Campaign - NPCs")'],
        ['no marker at all', 'I looked at the lore and decided to do nothing.'],
        ['a marker with no call', 'Action: I will think about it further.'],

        // Bare-string arguments, one per tool that takes one, plus the fallback.
        ['grep_lore bare, double quotes', 'Action: grep_lore("Iron Syndicate")'],
        ['grep_lore bare, single quotes', "Action: grep_lore('Iron Syndicate')"],
        ['grep_lore bare, unquoted', 'Action: grep_lore(Iron Syndicate)'],
        ['inspect_book bare', 'Action: inspect_book("Campaign - Locations")'],
        ['read_entry bare', 'Action: read_entry("Locations::4")'],
        ['an unknown tool with a bare argument', 'Action: summon_dragon("Smaug")'],
        ['an empty bare argument', 'Action: grep_lore()'],

        // The last Action wins — a model talking itself out of a call. The
        // decoy has to start its own line: the split needs a newline in front
        // of the marker, so a mid-sentence "Action:" is not a marker at all and
        // a decoy written that way would test nothing.
        [
            'a decoy call the model then thinks better of',
            'Action: grep_lore("wrong")\n\nOn reflection the party has moved on.\n\nAction: commit({"activate": ["LOC::9"]})',
        ],
        [
            'three calls, only the last of which counts',
            'Action: grep_lore("a")\nAction: inspect_book("b")\nAction: commit({"activate": ["LOC::1"]})',
        ],
        [
            'a mid-sentence Action, which is not a marker at all',
            'I could Action: grep_lore("wrong") but the party has moved on.\n\nAction: commit({"activate": ["LOC::9"]})',
        ],

        // Balanced parens: prose inside an argument.
        [
            'parentheses inside the argument prose',
            'Action: commit({"record": [{"label": "Lissa", "category": "NPC", "content": "A rope-keeper (and former sailor) from the docks."}]})',
        ],
        [
            'nested parentheses inside the argument',
            'Action: commit({"reason": "Party left the Ring (which is inside Kalvermoor (the city)) so its entries go."})',
        ],

        // Shapes JSON.parse refuses but models emit anyway.
        ['a trailing comma before a brace', 'Action: commit({"activate": ["NPCs::1"],})'],
        ['a trailing comma before a bracket', 'Action: commit({"activate": ["NPCs::1",]})'],
        ['both trailing commas', 'Action: commit({"activate": ["a","b",],})'],
        [
            'a font colour whose quotes break the JSON string',
            'Action: commit({"record": [{"label": "Lissa", "content": "<font color="#ff0000">Wounded</font>"}]})',
        ],
        [
            'an apostrophe-quoted colour beside a quote-breaking one',
            'Action: commit({"record": [{"label": "Lissa", "content": "<font color="#ff0000">Hurt</font>' +
                ` <font color='#00ff00'>Healing</font>"}]})`,
        ],
        [
            'a font colour given by name',
            'Action: commit({"record": [{"label": "Lissa", "content": "<font color="crimson">Wounded</font>"}]})',
        ],
        [
            'a short-form hex font colour',
            'Action: commit({"update": [{"id": "NPCs::1", "content": "<font color="#f00">Bleeding</font>"}]})',
        ],
        ['genuinely broken JSON', 'Action: commit({"activate": [oops)'],

        // Structural edge cases.
        ['an array argument', 'Action: commit(["NPCs::1"])'],
        ['an unclosed call', 'Action: commit({"activate": ["NPCs::1"]}'],
        ['whitespace between name and paren', 'Action: commit   ({"activate": []})'],
        ['a capitalised tool name', 'Action: Commit({"activate": []})'],
        ['an all-caps tool name', 'Action: COMMIT({"activate": []})'],
        ['a lower-case marker', 'Prose.\naction: commit({"activate": []})'],
        ['the action on the very first line with no preceding prose', 'Action: commit({})'],
        ['an empty object argument', 'Action: commit({})'],
        ['trailing prose after the call', 'Action: commit({"activate": []})\n\nThat should do it.'],

        // The full commit vocabulary, which is what actually gets applied.
        [
            'a commit carrying every action field',
            'Action: commit(' +
                JSON.stringify({
                    activate: ['NPCs::1', 'LOC::2'],
                    deactivate: ['NPCs::3'],
                    record: [{ label: 'Lissa', category: 'NPC', keys: ['Lissa'], content: '[CORE]\nSpecies: human\n[/CORE]' }],
                    update: [{ id: 'NPCs::1', content: 'Now wary of the party.' }],
                    rewrite: [{ id: 'NPCs::1', content: 'Full replacement.' }],
                    rename: [{ id: 'NPCs::1', label: 'Lissa Farrow' }],
                    core: [{ id: 'NPCs::1', field: 'Species', content: 'half-elf' }],
                    rel: [{ id: 'NPCs::1', target: 'Thalric', value: 12 }],
                    appearance: [{ id: 'NPCs::1', content: 'Scarred left hand.' }],
                    equipment: [{ id: 'NPCs::1', content: 'Coil of tarred rope.' }],
                    consolidate: [{ targets: ['EVENT::4', 'EVENT::5'], survivor: 'EVENT::4' }],
                    delete_ids: ['EVENT::9'],
                    reason: 'The party left the Ring and reached the Handler\'s Rest.',
                }) +
                ')',
        ],
    ]

    it.each(CORPUS)('agrees on %s', (_name, text) => {
        agree(text)
    })

    it('agrees across the whole corpus at once', () => {
        // A model's reply is one string; concatenating the corpus makes one
        // very long one with many markers in it, which is the case the
        // last-Action rule exists for.
        agree(CORPUS.map(([, text]) => text).join('\n\n'))
    })
})

describe.skipIf(!available)('where the parser departs from the legacy', () => {
    // Set up as above; the legacy's parser is lifted the same way.
    const slice = (file: string, from: string, to: string): string => {
        const source = readFileSync(`${checkout}/${file}`, 'utf8')
        const start = source.indexOf(from)
        const end = source.indexOf(to, start)
        if (start === -1 || end === -1) throw new Error(`${file} no longer contains: ${from}`)
        return source.slice(start, end)
    }
    const legacy = (): Legacy => {
        const body = [
            slice('memo-processor.js', 'export function repairJsonColorAttributes', '/**\n * JSON.parse that first repairs'),
            slice('memo-processor.js', 'export function parseJsonWithColorRepair', '/**\n * Strips bare timestamp-only lines'),
            slice('router.js', 'function parseTextAction', '/**\n * Broadcasts an agent step'),
        ].join('\n').replace(/^\s*export /gm, '')
        return new Function(`${body}\nreturn parseTextAction`)() as Legacy
    }

    it("reads an Action through the host's <text> wrapper, which the legacy never sees (66)", () => {
        // Lumiverse renders a reply's prose beside a tool call as `<text>…</text>`; SillyTavern does not, so the
        // legacy has no such case and reads the line as no call. A deliberate departure, recorded here.
        const wrapped = '<text>Action: read_entry("Book::4")</text>'
        expect(legacy()(wrapped)).toBeNull()
        expect(parseAgentAction(wrapped, 'x')).toEqual({ name: 'read_entry', args: { uid: 'Book::4' }, id: 'x' })
    })
})
