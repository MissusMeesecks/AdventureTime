/**
 * The Adventure Companion against the pin (100a): the persona lines kept
 * word for word, the documentation frame and the history's length are
 * Multihog's own, read off the checkout's files.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
    COMPANION_DOC_CLOSE, COMPANION_DOC_OPEN, COMPANION_FRAMES, COMPANION_HISTORY_LIMIT, COMPANION_INCOMPLETE_MESSAGE, COMPANION_LEGACY_ACTIONS,
    COMPANION_LEGACY_ACTION_RULES, COMPANION_LEGACY_BLOCKS, COMPANION_LEGACY_LINES, COMPANION_LIMIT_MESSAGE, COMPANION_MAP_FAILED, COMPANION_MAP_HEAD,
    COMPANION_MAP_OUTSIDE, COMPANION_MAX_ACTIONS, COMPANION_MAX_TURNS, COMPANION_PERSONA, buildCompanionActContext, buildCompanionLore, buildCompanionMemo,
    buildCompanionNarrative, buildCompanionObservation, formatCompanionActionReceipt, formatPlayerTurnCommentary, parseCompanionActions,
} from './companion.js'

/** A top-level function of the legacy file, cut by its braces. */
function sliceFunction(source: string, name: string): string {
    const start = source.indexOf(`function ${name}(`)
    if (start < 0) throw new Error(`the legacy file has no function ${name}`)
    let depth = 0
    for (let i = source.indexOf('{', source.indexOf(')', start)); i < source.length; i++) {
        if (source[i] === '{') depth++
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1)
    }
    throw new Error(`the legacy function ${name} never closes`)
}

const CHECKOUT = process.env.MULTIHOG_CHECKOUT
const available = !!CHECKOUT && existsSync(join(CHECKOUT, 'adventure-companion.js'))

describe.skipIf(!available)('the Companion against the pinned legacy build', () => {
    const legacy = available ? readFileSync(join(CHECKOUT!, 'adventure-companion.js'), 'utf8') : ''
    const retention = available ? readFileSync(join(CHECKOUT!, 'src/state/history-retention.js'), 'utf8') : ''

    it('keeps each legacy line of the persona word for word', () => {
        expect(COMPANION_LEGACY_LINES.length).toBe(6)
        for (const line of COMPANION_LEGACY_LINES) expect(legacy.includes(line), line).toBe(true)
    })

    it('frames the guide as the legacy frames its documentation', () => {
        expect(legacy).toContain(`\\n\\n${COMPANION_DOC_OPEN}\\n\${doc}\\n${COMPANION_DOC_CLOSE}`)
    })

    it('frames each block of the campaign as the legacy does, in its order (100b)', () => {
        const keys: Record<string, string> = { doc: 'doc', narrative: 'narrative', memo: 'memo', lore: 'lore', map: 'map', playerAction: 'playerAction' }
        let last = -1
        for (const frame of COMPANION_FRAMES) {
            const line = `prompt += \`\\n\\n${frame.open}\\n\${${keys[frame.key]}}\\n${frame.close}\`;`
            const at = legacy.indexOf(line)
            expect(at, line).toBeGreaterThan(last)
            last = at
        }
    })

    it('heads each block as the legacy does (100b)', () => {
        const narrative = buildCompanionNarrative([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }], { all: false, count: 2 })
        expect(narrative.startsWith('## NARRATIVE HISTORY (Last 2 of 2 requested messages)\nPlayer: a\n\nNarrator: b')).toBe(true)
        expect(legacy).toContain('return `## NARRATIVE HISTORY (${scope})\\n${lines.join(\'\\n\\n\')}`;')
        expect(legacy).toContain('? `All ${lines.length} messages`')
        expect(legacy).toContain(': `Last ${lines.length} of ${recent.length} requested messages`;')
        expect(legacy).toContain("const name = m.is_user ? 'Player' : (m.name || 'Narrator');")
        expect(buildCompanionMemo('x').split('\n')[0]).toBe('## STATE MEMO (State Tracker)')
        expect(legacy).toContain('return `## STATE MEMO (State Tracker)\\n${cleaned}`;')
        expect(buildCompanionLore([{ title: 't', content: 'c' }])).toBe('## ACTIVE LORE (Lorebook Agent)\n### t\nc')
        expect(legacy).toContain('return `## ACTIVE LORE (Lorebook Agent)\\n${blocks.join(\'\\n\\n\')}`;')
        expect(legacy).toContain('blocks.push(`### ${title}\\n${visible}`);')
        expect(legacy).toContain(`return '${COMPANION_MAP_OUTSIDE.replace('\n', '\\n')}';`)
        expect(legacy).toContain(`return '${COMPANION_MAP_FAILED.replace('\n', '\\n')}';`)
        expect(legacy).toContain(`return \`${COMPANION_MAP_HEAD}\n\n\${body}\`;`)
    })

    it('keeps the legacy’s four actions, its action rules and its five blocks word for word, in its order (100c)', () => {
        expect([COMPANION_LEGACY_ACTIONS.length, COMPANION_LEGACY_ACTION_RULES.length, COMPANION_LEGACY_BLOCKS.length]).toEqual([4, 13, 5])
        let last = -1
        for (const line of [...COMPANION_LEGACY_ACTIONS, ...COMPANION_LEGACY_ACTION_RULES, ...COMPANION_LEGACY_BLOCKS]) {
            // The legacy writes the persona as one template literal, where an apostrophe is not escaped.
            const at = legacy.indexOf(`\n${line}\n`)
            expect(at, line).toBeGreaterThan(last)
            last = at
            expect(COMPANION_PERSONA).toContain(line)
        }
        // Every rule the legacy lists under "Action rules:" is here: none was dropped.
        const rules = legacy.slice(legacy.indexOf('\nAction rules:\n') + 15, legacy.indexOf('\n\nWhen native tools are unavailable'))
        expect(rules.split('\n')).toEqual([...COMPANION_LEGACY_ACTION_RULES])
        expect(legacy).toContain('Actions — these four ONLY (hard limit):')
        expect(COMPANION_PERSONA).toContain('Actions — these four ONLY (hard limit):')
    })

    it('keeps the legacy’s limits and its words for a message past them (100c)', () => {
        expect(legacy).toContain(`const MAX_COMPANION_ACTIONS = ${COMPANION_MAX_ACTIONS};`)
        expect(legacy).toContain(`const MAX_COMPANION_AGENT_TURNS = ${COMPANION_MAX_TURNS};`)
        expect(legacy).toContain(`return '${COMPANION_LIMIT_MESSAGE}';`)
        expect(legacy).toContain(`return '${COMPANION_INCOMPLETE_MESSAGE}';`)
    })

    it('reads action blocks as the legacy’s own parser does, over a corpus (100c)', () => {
        const parse = new Function(`${sliceFunction(legacy, 'normalizeCompanionAction')}\n${sliceFunction(legacy, 'parseCompanionFallbackActions')}\nreturn parseCompanionFallbackActions`)() as (text: unknown) => { actions: Array<Record<string, unknown>>; visibleText: string }
        const names: Record<string, string> = { state_tracker: 'command_state_tracker', lorebook_agent: 'command_lorebook_agent', map_updater: 'command_map_updater' }
        const block = (type: string, body: string, quote = '"') => `<companion_action type=${quote}${type}${quote}>${body}</companion_action>`
        const corpus = [
            '', 'No blocks.', block('state_tracker', 'Add a brass lantern.'), `Before ${block('lorebook_agent', '\n Record Old Pell. \n', "'")} after`,
            block('MAP_UPDATER', 'Clear the yard.') + block('state_tracker', '   ') + block('settings', 'Turn off dice.'),
            block('act_for_user', '{"choice_index":2,"commentary":"Bold."}'), block('act_for_user', '{"action_text":" I wait. "}'),
            block('act_for_user', '{"choice_index":1,"action_text":"I wait.","commentary":""}'), block('act_for_user', 'I open the gate.'),
            block('act_for_user', '{"choice_index":0}'), block('act_for_user', '{"choice_index":"3"}'), block('act_for_user', '{"choice_index":1.5,"action_text":"x"}'),
            block('act_for_user', '[1,2]'), block('act_for_user', '"just a string"'), block('act_for_user', 'null'), block('act_for_user', '{"commentary":"only"}'),
            `<companion_action  type="state_tracker" >Spaced.</companion_action>`, `<COMPANION_ACTION type="state_tracker">Upper.</COMPANION_ACTION>`,
            `<companion_action type=state_tracker>Unquoted.</companion_action>`, `${block('state_tracker', 'One.')}\n\n${block('state_tracker', 'Two.')} tail `,
            `<companion_action type="state_tracker">Never closed.`,
        ]
        for (const text of corpus) {
            const theirs = parse(text)
            const ours = parseCompanionActions(text)
            expect(ours.visibleText, text).toBe(theirs.visibleText)
            expect(ours.actions.map((action) => action.kind === 'act_for_user'
                ? { name: 'act_for_user', ...(action.choiceIndex !== undefined ? { choice_index: action.choiceIndex } : {}), action_text: action.actionText, ...(action.commentary ? { commentary: action.commentary } : {}) }
                : { name: names[action.kind], instruction: action.instruction }), text).toEqual(theirs.actions)
        }
    })

    it('reacts to a player turn in the legacy’s words, over a corpus (100c)', () => {
        const theirs = new Function(`${sliceFunction(legacy, 'formatCompanionActionReceipt')}\n${sliceFunction(legacy, 'formatPlayerTurnCommentary')}\nreturn formatPlayerTurnCommentary`)() as (action: unknown, modelText?: string, completed?: unknown[]) => string
        const actions = [
            { actionText: 'I wait.', commentary: 'Patience. Bold choice.' }, { actionText: 'I wait.' }, { actionText: 'I kick the door in.' }, { actionText: 'I listen at the door.' },
            { choiceIndex: 2 }, { choiceIndex: 2, actionText: 'I charge.' }, { actionText: 'I wait.', commentary: '✓ Player Turn: sent' }, { actionText: 'I wait.', commentary: 'Action submitted.' }, {},
        ]
        for (const action of actions) {
            for (const modelText of ['', 'Here goes nothing.', 'Submitted CYOA choice: 2', 'player turn: done']) {
                const legacyAction = { ...(action.choiceIndex !== undefined ? { choice_index: action.choiceIndex } : {}), action_text: action.actionText, commentary: action.commentary }
                expect(formatPlayerTurnCommentary(action, modelText), JSON.stringify([action, modelText])).toBe(theirs(legacyAction, modelText, []))
            }
        }
    })

    it('writes the receipt and the observation as the legacy does (100c)', () => {
        const theirs = new Function(`${sliceFunction(legacy, 'formatCompanionActionReceipt')}\nreturn formatCompanionActionReceipt`)() as (results: unknown[]) => string
        const results = [{ action: 'State Tracker', success: true, status: 'completed', message: 'Added INVENTORY.' }, { action: 'Map Updater', success: false, status: 'unavailable', message: 'No active map.' }]
        expect(formatCompanionActionReceipt(results)).toBe(theirs(results))
        const observation = buildCompanionObservation(results)
        const [head, tail] = observation.split(JSON.stringify(results, null, 2))
        expect(legacy).toContain(`content: \`${head!.replace('\n', '\\n')}\${JSON.stringify(batchResults, null, 2)}${tail!.replace('\n', '\\n')}\`,`)
    })

    it('says how a turn may be taken in the legacy’s three texts (100c)', () => {
        const source = sliceFunction(legacy, 'buildActForUserContext')
        expect(source).toContain(`return \`${buildCompanionActContext({ cyoa: false, choices: [] })}\`;`)
        expect(source).toContain(`return \`${buildCompanionActContext({ cyoa: true, choices: [] })}\`;`)
        const offered = buildCompanionActContext({ cyoa: true, choices: ['Open the gate', 'Wait for dusk'] })
        const head = offered.slice(0, offered.indexOf('1. Open the gate'))
        expect(source).toContain(`return \`${head}\${choices.map((choice) => \`\${choice.index}. \${choice.text}\`).join('\\n')}\`;`)
        expect(offered.slice(head.length)).toBe('1. Open the gate\n2. Wait for dusk')
    })

    it('keeps as many messages as the legacy does', () => {
        expect(retention).toContain(`export const HISTORY_ENTRY_LIMIT = ${COMPANION_HISTORY_LIMIT};`)
    })
})
