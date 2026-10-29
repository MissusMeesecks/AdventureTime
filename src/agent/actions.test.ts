import { describe, expect, it } from 'vitest'

import { parseAgentAction, parseJsonWithColorRepair, repairJsonColorAttributes } from './actions.js'

describe('reading the agent action out of a reply', () => {
    it('takes the tool name and its arguments', () => {
        expect(parseAgentAction('Action: commit({"activate": ["NPCs::1"]})', 'x')).toEqual({
            name: 'commit',
            args: { activate: ['NPCs::1'] },
            id: 'x',
        })
    })

    it('takes the last action, because a model talks itself out of calls', () => {
        // The decoy is written the way a model writes one: on its own line,
        // fully formed, and then reconsidered in the next paragraph. Running it
        // would search the archive for something the party has left behind.
        const reply = [
            'Action: grep_lore("Ironbelly")',
            '',
            'On reflection they left the workshop two scenes ago.',
            '',
            'Action: commit({"deactivate": ["LOC::4"]})',
        ].join('\n')
        expect(parseAgentAction(reply)?.args).toEqual({ deactivate: ['LOC::4'] })
    })

    it('does not treat a mid-sentence "Action:" as a marker', () => {
        // The marker has to open a line. Prose mentioning the word is prose.
        expect(parseAgentAction('I could take an Action: grep_lore("x") here, but no.')).toBeNull()
    })

    it.each([
        ['**Action:**', 'Prose.\n**Action:** commit({})'],
        ['*Action:*', 'Prose.\n*Action:* commit({})'],
        ['### Action', 'Prose.\n### Action commit({})'],
        ['- Action:', 'Prose.\n- Action: commit({})'],
        ['a bare Action on the first line', 'Action commit({})'],
    ])('reads a %s marker', (_name, reply) => {
        expect(parseAgentAction(reply)?.name).toBe('commit')
    })

    it('lower-cases the tool name, so Commit and commit are one tool', () => {
        expect(parseAgentAction('Action: COMMIT({})')?.name).toBe('commit')
    })

    it('names a bare argument after the tool that took it', () => {
        expect(parseAgentAction('Action: grep_lore("Iron Syndicate")')?.args).toEqual({ query: 'Iron Syndicate' })
        expect(parseAgentAction('Action: inspect_book("NPCs")')?.args).toEqual({ book_name: 'NPCs' })
        expect(parseAgentAction('Action: read_entry("NPCs::7")')?.args).toEqual({ uid: 'NPCs::7' })
    })

    it('still parses a tool it does not know, so the caller can reject it by name', () => {
        // A parse failure and an invented tool are different problems and want
        // different messages. Only one of them is the model writing nonsense.
        expect(parseAgentAction('Action: summon_dragon("Smaug")')).toMatchObject({
            name: 'summon_dragon',
            args: { value: 'Smaug' },
        })
    })

    it('counts parentheses rather than reaching for the last one', () => {
        // Lore prose is full of brackets. A greedy or lazy match truncates the
        // argument or swallows the rest of the reply.
        const reply = 'Action: commit({"reason": "They left the Ring (inside Kalvermoor (the city))."})'
        expect(parseAgentAction(reply)?.args).toEqual({
            reason: 'They left the Ring (inside Kalvermoor (the city)).',
        })
    })

    it('forgives the trailing commas models cannot stop writing', () => {
        expect(parseAgentAction('Action: commit({"activate": ["a","b",],})')?.args).toEqual({
            activate: ['a', 'b'],
        })
    })

    it('reads an argument whose lore text carries a font colour', () => {
        // Sub-modules colour their text; the agent copies it into a JSON string
        // and the quotes end the string early. Losing the entry over its markup
        // would be the wrong trade.
        const reply = 'Action: commit({"update": [{"id": "NPCs::1", "content": "<font color="#ff0000">Hurt</font>"}]})'
        expect(parseAgentAction(reply)?.args).toEqual({
            update: [{ id: 'NPCs::1', content: '<font color=#ff0000>Hurt</font>' }],
        })
    })

    it.each([
        ['a reply with no action at all', 'I read the lore and nothing needs changing.'],
        ['a marker with no call after it', 'Action: I will think about it further.'],
        ['an argument that is not JSON in any reading', 'Action: commit({"activate": [oops)'],
        ['something that is not a string', null as unknown as string],
    ])('returns null for %s', (_name, reply) => {
        // Fail soft, as everywhere else. A lorebook agent that cannot be
        // understood must leave the campaign exactly as it found it — this is
        // the one grammar here whose failure mode would be real data loss.
        expect(parseAgentAction(reply)).toBeNull()
    })
})

describe('repairing a font colour inside JSON', () => {
    it('drops the quotes around a colour so the string survives', () => {
        expect(repairJsonColorAttributes('<font color="#abc">')).toBe('<font color=#abc>')
        expect(repairJsonColorAttributes("<font color='crimson'>")).toBe('<font color=crimson>')
    })

    it('leaves anything that is not a colour attribute alone', () => {
        expect(repairJsonColorAttributes('<font size="3">')).toBe('<font size="3">')
        expect(repairJsonColorAttributes('a plain string')).toBe('a plain string')
    })

    it('only repairs when the ordinary parse has already failed', () => {
        // A colour quoted with apostrophes is legal inside a JSON string, so a
        // reply carrying one parses first time and keeps its markup verbatim.
        const clean = String.raw`{"c": "<font color='#abc'>x</font>"}`
        expect(parseJsonWithColorRepair(clean)).toEqual({
            ok: true,
            value: { c: "<font color='#abc'>x</font>" },
        })
    })

    it('reports a failure rather than throwing', () => {
        expect(parseJsonWithColorRepair('{oops')).toMatchObject({ ok: false, value: {} })
    })

    it('passes a non-string straight through', () => {
        expect(parseJsonWithColorRepair({ already: 'parsed' })).toEqual({
            ok: true,
            value: { already: 'parsed' },
        })
    })
})

describe("the host's rendering of a native tool call (45c-bis)", () => {
    const STUB = `<button-pressed :toolCall='{"id":"call_1","name":"read_entry","arguments":{"address":"catchuppass_NPC::037bbe7c-9f49"}}'> read_entry("catchuppass_NPC::037bbe7c-9f49") </button-pressed>`

    it('reads the call out of the stub, filing a single invented key under the one the tool reads', () => {
        expect(parseAgentAction(STUB, 'x')).toEqual({ name: 'read_entry', args: { uid: 'catchuppass_NPC::037bbe7c-9f49' }, id: 'x' })
        expect(parseAgentAction(`I will look.\n<button-pressed :toolCall="{&quot;name&quot;:&quot;grep_lore&quot;,&quot;arguments&quot;:{&quot;query&quot;:&quot;Merle&quot;}}">grep_lore</button-pressed>`, 'y'))
            .toEqual({ name: 'grep_lore', args: { query: 'Merle' }, id: 'y' })
        // Arguments as a JSON string, as some hosts send them; a commit keeps its object whole.
        expect(parseAgentAction(`<button-pressed :toolCall='{"name":"commit","arguments":"{\\"delete_ids\\":[\\"E::9\\"]}"}'></button-pressed>`, 'z'))
            .toEqual({ name: 'commit', args: { delete_ids: ['E::9'] }, id: 'z' })
        // The last stub wins, as the last Action does; a stub beats an Action line it was rendered beside.
        const two = `<button-pressed :toolCall='{"name":"inspect_book","arguments":{"book_name":"A"}}'></button-pressed>\n<button-pressed :toolCall='{"name":"read_entry","arguments":{"uid":"A::1"}}'></button-pressed>`
        expect(parseAgentAction(two, 'w')?.name).toBe('read_entry')
    })

    it('reads a reply that is nothing but one of the four calls, and no other bare parenthesis', () => {
        expect(parseAgentAction('read_entry("Vell_NPC::4")', 'x')).toEqual({ name: 'read_entry', args: { uid: 'Vell_NPC::4' }, id: 'x' })
        expect(parseAgentAction('<p>commit({"delete_ids": ["E::9"]})</p>', 'x')).toEqual({ name: 'commit', args: { delete_ids: ['E::9'] }, id: 'x' })
        expect(parseAgentAction('Lissa (a rope-keeper) is new here.', 'x')).toBeNull()
        expect(parseAgentAction('think("hard")', 'x')).toBeNull()
        expect(parseAgentAction('<button-pressed :toolCall=\'{"id":"c"}\'></button-pressed>', 'x')).toBeNull()
    })
})

describe("the host's wrapper around a reply's prose (66)", () => {
    // The reply as the maintainer's transcript showed it, three times over, each read as no tool call.
    const WRAPPED = '<text>Action: read_entry("TheW_261016_2034_NPC::ec537b0e-1caf-4d1a-ba4f-24a30d9505f5")\n</text>'

    it('reads the Action line through the <text> wrapper', () => {
        expect(parseAgentAction(WRAPPED, 'x')).toEqual({ name: 'read_entry', args: { uid: 'TheW_261016_2034_NPC::ec537b0e-1caf-4d1a-ba4f-24a30d9505f5' }, id: 'x' })
    })

    it('reads a commit wrapped the same way, and the last Action still wins', () => {
        expect(parseAgentAction('<text>I could Action: grep_lore("x") first.</text><text>Action: commit({"record": []})</text>', 'y'))
            .toEqual({ name: 'commit', args: { record: [] }, id: 'y' })
    })

    it('leaves a wrapped reply with no call in it unreadable, and a stub beside the wrapper still wins', () => {
        expect(parseAgentAction('<text>Nothing to do here.</text>', 'z')).toBeNull()
        expect(parseAgentAction(`<text>Action: grep_lore("a")</text>\n<button-pressed :toolCall='{"name":"read_entry","arguments":{"uid":"A::1"}}'></button-pressed>`, 'w'))
            .toEqual({ name: 'read_entry', args: { uid: 'A::1' }, id: 'w' })
    })
})
