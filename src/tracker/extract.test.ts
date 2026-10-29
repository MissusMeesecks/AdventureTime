import { describe, expect, it } from 'vitest'

import { extractMemo } from './extract.js'

describe('extractMemo', () => {
    it('takes the contents of a memo wrapper', () => {
        expect(extractMemo('<memo>[TIME]\nDay 4\n[/TIME]</memo>')).toEqual({
            text: '[TIME]\nDay 4\n[/TIME]',
            source: 'wrapped',
        })
    })

    it('ignores a preamble outside the wrapper', () => {
        expect(extractMemo('Sure, here you go:\n<memo>[XP]\n1/2\n[/XP]</memo>\nHope that helps!').text).toBe(
            '[XP]\n1/2\n[/XP]',
        )
    })

    it('takes the last wrapper when a model shows its working', () => {
        expect(extractMemo('<memo>draft</memo>\nOn reflection:\n<memo>final</memo>').text).toBe('final')
    })

    it('reads across newlines and is not confused by casing', () => {
        expect(extractMemo('<MEMO>\n[A]\nx\n[/A]\n</Memo>').text).toBe('[A]\nx\n[/A]')
    })

    it('uses the blocks anyway when the wrapper was never closed', () => {
        // A response that ran out of tokens still carries real state.
        expect(extractMemo('<memo>[TIME]\nDay 4\n[/TIME]')).toEqual({
            text: '[TIME]\nDay 4\n[/TIME]',
            source: 'unwrapped',
        })
    })

    it('uses the blocks when the model skipped the wrapper entirely', () => {
        expect(extractMemo('[TIME]\nDay 4\n[/TIME]')).toEqual({
            text: '[TIME]\nDay 4\n[/TIME]',
            source: 'unwrapped',
        })
    })

    it('reports an empty response as empty', () => {
        expect(extractMemo('').source).toBe('empty')
        expect(extractMemo('   \n ').source).toBe('empty')
        expect(extractMemo('<memo></memo>').text).toBe('')
    })

    it('survives a null-ish response without throwing', () => {
        expect(extractMemo(undefined as unknown as string).source).toBe('empty')
    })

    it('hands prose straight through, for the merge to reject', () => {
        // Not this module's job to judge — mergeMemo treats it as no-change.
        expect(extractMemo('I cannot help with that.').text).toBe('I cannot help with that.')
    })
})
