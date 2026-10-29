/**
 * The Game System Wizard's model calls.
 *
 * Three asks, one shape: a first draft from a description, a revision of a
 * draft from the user's feedback, and a regeneration of one or both halves.
 * Each builds its system prompt from `tracker/wizard.ts`, its user prompt
 * from the optional story and memo context plus the task, shields `{{user}}`
 * from the generation layer's macro resolution (a name baked into a rule
 * breaks when the persona changes -- the legacy's sentinel, restored on the
 * way out, with the resolved name mapped back too), and reads the reply.
 *
 * Roadmap row 7. The panel decides what to do with a draft; nothing here
 * writes settings.
 */

import { memoForNarrativeContext } from '../tracker/prompt.js'
import {
    buildDraftSystemPrompt,
    buildRegenerateSystemPrompt,
    buildRevisionSystemPrompt,
    buildWizardUserPrompt,
    currentDraftText,
    parseWizardHalves,
    parseWizardResponse,
    restoreUserMacro,
    shieldUserMacro,
    storyContext,
    type EffectOwner,
    type WizardDraft,
} from '../tracker/wizard.js'
import { stripStamp } from '../agent/provenance.js'
import { createWizardContext, type WizardContextLegacy, type WizardContextSettings } from '../tracker/wizard-context.js'
import { connectionField } from './agent-pass.js'
import { readGenerationText, type ChatMessage } from './tracker-pass.js'

export interface WizardDeps {
    generate: { quiet(input: Record<string, unknown>): Promise<unknown> }
    chat: { getMessages(chatId: string): Promise<Array<ChatMessage & { name?: string }>> }
    memo: (chatId: string, userId: string | undefined) => Promise<string>
    /** What `{{user}}` resolves to for this chat, so the reply's copies of the name become the macro again. */
    userName?: (chatId: string, userId: string | undefined) => Promise<string>
    /** The cartridge (73g), for the module examples: the module switches, the stock texts, the fields and the library. */
    settings?: (userId: string | undefined) => Promise<Record<string, unknown>>
    /** The lore the host has active for the chat (73g), each entry titled; absent, the lore switch sends nothing. */
    activeLore?: (chatId: string, userId: string | undefined) => Promise<Array<{ title: string; content: string }>>
    /** The legacy's context pieces over the stock texts (73g); the test's default hands them none. */
    context?: WizardContextLegacy
    log: { info(m: string): void; warn(m: string): void }
}

export interface WizardContext {
    chatId: string
    userId: string | undefined
    /** Recent messages the wizard may read; `0` for none. */
    lookback: number
    /** Every message, the count ignored (73g, Multihog's *Read every message*). */
    lookbackAll?: boolean
    /** Whether the tracker's memo is shown to the wizard. */
    injectMemo: boolean
    /** The lore the host has active for the chat (73g, Multihog's *Inject lorebooks*). */
    injectLore?: boolean
    /** Existing module prompts as formatting examples (73g), those `moduleExampleKeys` names. */
    injectModulePrompts?: boolean
    moduleExampleKeys?: string[]
    /** The user's own architect prompt, or blank for the stock. */
    systemPrompt?: string
    connectionId?: string
}

export interface WizardDraftRequest extends WizardContext {
    description: string
    effectOwner: EffectOwner
}

export interface WizardReviseRequest extends WizardContext {
    description: string
    draft: WizardDraft
    /** `revise` applies the feedback; the others rewrite a half, or both, afresh. */
    mode: 'revise' | 'gm' | 'tracker' | 'both'
    feedback?: string
}

export type WizardHalves = ReturnType<typeof parseWizardHalves>

export interface Wizard {
    draft(request: WizardDraftRequest): Promise<WizardDraft>
    revise(request: WizardReviseRequest): Promise<WizardHalves>
}

export function createWizard(deps: WizardDeps): Wizard {
    const pieces = deps.context ?? createWizardContext({}, () => 'time')

    async function context(request: WizardContext, task: string): Promise<{ user: string; names: string[] }> {
        // The module examples (73g): the legacy's builder over the cartridge, the preferences under its names.
        let modules = ''
        const keys = Array.isArray(request.moduleExampleKeys) ? request.moduleExampleKeys : []
        if (request.injectModulePrompts && keys.length && deps.settings) {
            try {
                const cartridge = (await deps.settings(request.userId)) as WizardContextSettings
                modules = pieces.moduleExamplesContext({ ...cartridge, gameSystemWizardInjectModulePrompts: true, gameSystemWizardModuleExampleKeys: keys })
            } catch (error) {
                deps.log.warn(`wizard: could not read the module prompts, drafting without them: ${describe(error)}`)
            }
        }
        let story = ''
        if (request.lookbackAll || request.lookback > 0) {
            try {
                story = storyContext(await deps.chat.getMessages(request.chatId), request.lookback, request.lookbackAll === true)
            } catch (error) {
                deps.log.warn(`wizard: could not read the story, drafting without it: ${describe(error)}`)
            }
        }
        // The lore (73g): what the host has active for the chat, each entry under its title as the legacy lists them.
        let lore = ''
        if (request.injectLore && deps.activeLore) {
            try {
                lore = (await deps.activeLore(request.chatId, request.userId))
                    .filter((entry) => String(entry.content ?? '').trim())
                    .map((entry) => `### ${stripStamp(String(entry.title ?? '').replace(/^\[.*?\]\s*/i, '')).trim() || 'Entry'}\n${String(entry.content).trim()}`)
                    .join('\n\n')
            } catch (error) {
                deps.log.warn(`wizard: could not read the active lore, drafting without it: ${describe(error)}`)
            }
        }
        let memo = ''
        if (request.injectMemo) {
            try {
                memo = memoForNarrativeContext(await deps.memo(request.chatId, request.userId))
            } catch (error) {
                deps.log.warn(`wizard: could not read the memo, drafting without it: ${describe(error)}`)
            }
        }
        const names: string[] = []
        try {
            const name = (await deps.userName?.(request.chatId, request.userId))?.trim()
            if (name && name !== '{{user}}') names.push(name)
        } catch {
            // Without the name the sentinel still works; only a name the model
            // echoed from the story would stay a name.
        }
        return { user: buildWizardUserPrompt({ modules, story, lore, memo, task }), names }
    }

    async function ask(request: WizardContext, system: string, user: string): Promise<string> {
        const raw = await deps.generate.quiet({
            chatId: request.chatId,
            userId: request.userId,
            ...connectionField(request.connectionId),
            messages: [
                { role: 'system', content: shieldUserMacro(system) },
                { role: 'user', content: shieldUserMacro(user) },
            ],
        })
        const text = readGenerationText(raw)
        if (!text.trim()) throw new Error('The model returned nothing.')
        return text
    }

    return {
        async draft(request) {
            const system = buildDraftSystemPrompt(request.effectOwner, request.systemPrompt)
            const { user, names } = await context(request, `Describe the mechanic:\n${request.description}`)
            const reply = await ask(request, system, user)
            deps.log.info(`wizard: drafted a system from "${request.description.slice(0, 60)}" (${reply.length} characters back)`)
            // The legacy parser restores the sentinel and the names itself. The effect owner is the
            // user's choice, told to the model in the prompt: a reply that omits the attribute must
            // not reset it to the parser's default (72b-ter; the legacy's draft takes the parser's).
            return { ...parseWizardResponse(reply, names), effectOwner: request.effectOwner }
        },

        async revise(request) {
            const includeTracker = request.draft.needsTracker
            let system: string
            let task: string
            if (request.mode === 'revise') {
                system = buildRevisionSystemPrompt(request.draft, includeTracker, request.systemPrompt)
                task = `Original mechanic description:\n${request.description || '(not provided)'}\n\nCURRENT DRAFT (revise this — do not discard and restart unless the feedback requires it):\n${currentDraftText(request.draft, includeTracker)}\n\nUser's iteration feedback (apply these changes):\n${request.feedback ?? ''}`
            } else {
                system = buildRegenerateSystemPrompt(request.mode, request.draft, request.systemPrompt)
                task = `Mechanic description:\n${request.description}`
            }
            const { user, names } = await context(request, task)
            const reply = await ask(request, system, user)
            const halves = parseWizardHalves(restoreUserMacro(reply, names), names)
            const wantGm = request.mode !== 'tracker'
            const wantTracker = request.mode === 'tracker' || request.mode === 'both' || (request.mode === 'revise' && includeTracker)
            if (wantGm && !halves.gmContent) throw new Error('The model did not return a gm_section block.')
            if (wantTracker && !halves.trackerContent) throw new Error('The model did not return a tracker_module block.')
            return halves
        },
    }
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
