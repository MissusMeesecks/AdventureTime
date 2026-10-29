import { describe, expect, it } from 'vitest'

import {
    buildCyoaModeBlock,
    buildCyoaPrompt,
    CHOICE_BLOCKS_KEPT,
    countChoiceBlocks,
    effectiveCyoaSlots,
    extractChoices,
    stripChoiceBlocks,
    stripSupersededChoices,
} from './cyoa.js'

const REPLY = [
    'The door creaks.',
    '<choices>',
    '<button>1. 🚪 Open it — [Strength (+2) DC 12]</button>',
    '<button>2. 👂 Listen first</button>',
    '<button>3. 🗣️ "Anyone there?"</button>',
    '</choices>',
].join('\n')

describe('the prompt', () => {
    it('asks for as many choices as there are slots, in the shipped shape by default', () => {
        const text = buildCyoaPrompt({})
        expect(text).toContain('exactly 5 choices')
        expect(text).toContain('<choices>')
        expect(text).toContain('<button>1. 🎯')
        expect(text.trim().endsWith('5. NARRATIVE-DECIDED (Choose whichever format fits the story best).')).toBe(true)
    })

    it('spells each slot kind out in order', () => {
        const text = buildCyoaPrompt({ slots: [{ type: 'normal' }, { type: 'trait', label: 'Lucky' }, { type: 'prefix', label: 'Attack' }, { type: 'custom', text: 'Study the map' }] })
        expect(text).toContain('exactly 4 choices')
        expect(text).toContain('1. MUST be NORMAL')
        expect(text).toContain('2. MUST use TRAIT/ABILITY [Lucky].')
        expect(text).toContain('3. MUST begin with the exact prefix [Attack].')
        expect(text).toContain('4. MUST be "Study the map".')
    })

    it('drops the emoji, the block and the buttons when asked', () => {
        const bare = buildCyoaPrompt({ useEmojis: false, useXmlTag: false, useButtonTags: false })
        expect(bare).not.toContain('<choices>')
        expect(bare).not.toContain('<button>')
        expect(bare).toContain('1. Fire with Dead-Eye Focus')
        expect(bare).not.toContain('Prefix each choice text with a fitting emoji')
    })

    it('wraps the block in its tag, or uses the user\'s own text', () => {
        expect(buildCyoaModeBlock({})).toMatch(/^<CYOA_mode>\n\[END OF OUTPUT REQUIREMENT\][\s\S]*<\/CYOA_mode>$/)
        expect(buildCyoaModeBlock({ useCustomPrompt: true, customPromptText: ' Mine. ' })).toBe('<CYOA_mode>\nMine.\n</CYOA_mode>')
        // Blank custom text falls back to the builder, as the legacy does.
        expect(buildCyoaModeBlock({ useCustomPrompt: true, customPromptText: '  ' })).toContain('[END OF OUTPUT REQUIREMENT]')
    })

    it('reads an empty slot list as the default and the retired roll type as narrative', () => {
        expect(effectiveCyoaSlots({ slots: [] })).toHaveLength(5)
        expect(effectiveCyoaSlots({ slots: [{ type: 'roll' }] })).toEqual([{ type: 'narrative' }])
    })
})

describe('the choices in a reply', () => {
    it('reads each button of the last block, tags out and entities decoded', () => {
        expect(extractChoices(REPLY)).toEqual([
            '1. 🚪 Open it — [Strength (+2) DC 12]',
            '2. 👂 Listen first',
            '3. 🗣️ "Anyone there?"',
        ])
        expect(extractChoices('<choices><button>1. <b>Bold</b> &amp; &quot;quoted&quot;</button></choices>')).toEqual(['1. Bold & "quoted"'])
        expect(extractChoices('<choices><button>old</button></choices> then <choices><button>new</button></choices>')).toEqual(['new'])
    })

    it('reads one choice per line when the narrator left the buttons out', () => {
        expect(extractChoices('<choices>\n1. Go\n\n2. Stay\n</choices>')).toEqual(['1. Go', '2. Stay'])
    })

    it('offers nothing without a block', () => {
        expect(extractChoices('Just prose with a <button>press</button>.')).toEqual([])
        expect(extractChoices('')).toEqual([])
        expect(extractChoices(null)).toEqual([])
        expect(extractChoices('<choices>\n\n</choices>')).toEqual([])
    })
})

describe('what the passes read', () => {
    it('strips the block, escaped or rendered, and lone buttons', () => {
        expect(stripChoiceBlocks(REPLY)).toBe('The door creaks.')
        expect(stripChoiceBlocks('a &lt;choices&gt;&lt;button&gt;x&lt;/button&gt;&lt;/choices&gt; b')).toBe('a  b')
        expect(stripChoiceBlocks('a <div class="rt-cyoa-choices"><button>x</button></div> b')).toBe('a  b')
        expect(stripChoiceBlocks('a <button>x</button> b')).toBe('a  b')
        expect(stripChoiceBlocks('untouched')).toBe('untouched')
        expect(stripChoiceBlocks(null)).toBe('')
    })
})

describe('the history the narrator sees', () => {
    const turn = (n: number) => ({ role: 'assistant', content: `T${n}\n<choices><button>c${n}</button></choices>` })

    it('keeps the newest four blocks and drops the older ones, copying rather than editing', () => {
        const history = [1, 2, 3, 4, 5, 6].map(turn)
        const out = stripSupersededChoices(history)
        expect(countChoiceBlocks(out[0]!.content)).toBe(0)
        expect(countChoiceBlocks(out[1]!.content)).toBe(0)
        expect(out.slice(2).every((m) => countChoiceBlocks(m.content) === 1)).toBe(true)
        expect(out[0]!.content).toBe('T1\n')
        expect(history[0]!.content).toContain('<choices>')
        expect(CHOICE_BLOCKS_KEPT).toBe(4)
    })

    it('leaves system and user messages alone, and short histories untouched', () => {
        const history = [
            { role: 'system', content: '<choices>example</choices>' },
            { role: 'user', content: '<choices>quoted</choices>' },
            ...[1, 2, 3].map(turn),
        ]
        expect(stripSupersededChoices(history)).toEqual(history)
    })

    it('handles multimodal content without touching the image parts', () => {
        const image = { type: 'image_url', image_url: { url: 'x' } }
        const history = [
            { role: 'assistant', content: [{ type: 'text', text: 'old <choices>a</choices>' }, image] },
            ...[2, 3, 4, 5].map(turn),
        ]
        const out = stripSupersededChoices(history)
        expect((out[0]!.content as Array<{ text?: string }>)[0]!.text).toBe('old ')
        expect((out[0]!.content as unknown[])[1]).toEqual(image)
        expect((history[0]!.content as Array<{ text?: string }>)[0]!.text).toContain('<choices>')
    })

    it('takes a different keep count', () => {
        const out = stripSupersededChoices([1, 2, 3].map(turn), 1)
        expect(out.map((m) => countChoiceBlocks(m.content))).toEqual([0, 0, 1])
    })
})
