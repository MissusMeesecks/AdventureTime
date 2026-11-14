import { describe, expect, it } from 'vitest'

import { MAX_IMAGE_PROMPT_PREFIX, prefixImagePrompt, readImagePromptPrefix } from './image-prompt.js'

describe('the image prompt prefix (94a)', () => {
    it('reads the preference as a trimmed string, capped, and anything else as blank', () => {
        expect(readImagePromptPrefix('  <lora:anima-turbo:1>  ')).toBe('<lora:anima-turbo:1>')
        expect(readImagePromptPrefix('')).toBe('')
        expect(readImagePromptPrefix(undefined)).toBe('')
        expect(readImagePromptPrefix(12 as never)).toBe('')
        expect(readImagePromptPrefix('x'.repeat(MAX_IMAGE_PROMPT_PREFIX + 40))).toHaveLength(MAX_IMAGE_PROMPT_PREFIX)
    })

    it('puts the prefix in front of the prompt with one space, and leaves a prompt alone when the prefix is blank', () => {
        expect(prefixImagePrompt('<lora:anima-turbo:1>', '  A wary scout.  ')).toBe('<lora:anima-turbo:1> A wary scout.')
        expect(prefixImagePrompt('', '  A wary scout.  ')).toBe('A wary scout.')
        expect(prefixImagePrompt(undefined, 'A wary scout.')).toBe('A wary scout.')
        expect(prefixImagePrompt('masterpiece,', 'A wary scout.')).toBe('masterpiece, A wary scout.')
    })

    it('does not put it in twice when the prompt already opens with it, and a blank prompt is the prefix alone', () => {
        expect(prefixImagePrompt('<lora:x:1>', '<lora:x:1> A hand-written yard.')).toBe('<lora:x:1> A hand-written yard.')
        expect(prefixImagePrompt('<lora:x:1>', '   ')).toBe('<lora:x:1>')
    })
})
