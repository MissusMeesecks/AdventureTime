/**
 * The wizard's context switches (Phase 73g, departure 117): Multihog's
 * *Read every message*, *Inject lorebooks* and *Cite module prompts as
 * formatting examples* with its picker, from `game-system-wizard-context.js`
 * at the pin.
 *
 * The pure pieces -- the option lister, the preference normalisers and the
 * module-examples builder with its header text -- are the legacy's own,
 * sliced into `wizard-legacy.js` as a second factory that takes the two
 * things they read from module scope: the stock prompt texts (the fallback
 * for a cartridge missing one, which ours never is) and the time module's
 * key resolver. The backend hands it both; the panel, which only lists the
 * options, hands it nothing. The story and lore blocks are assembled in
 * `backend/wizard.ts`, the story by `storyContext` (the legacy's format,
 * with *every message* since 73g) and the lore from what the host has
 * active, since SillyTavern's `loadWorldInfo` is not Lumiverse's.
 */

import { createWizardContextLegacy } from './wizard-legacy.js'

/** One row of the picker: a stock module, a custom field or a GM section, in the legacy's groups. */
export interface WizardModuleExampleOption {
    key: string
    label: string
    group: string
}

/** The settings the legacy reads: the cartridge's lists and switches, and the wizard's preferences under the legacy's names. */
export interface WizardContextSettings {
    modules?: Record<string, boolean>
    syspromptModules?: Record<string, boolean>
    customFields?: Array<Record<string, unknown>>
    customSyspromptLibrary?: Array<Record<string, unknown>>
    stockPrompts?: Record<string, string>
    use24hTime?: boolean
    useDdMmYyFormat?: boolean
    gameSystemWizardLookback?: number
    gameSystemWizardLookbackAll?: boolean
    gameSystemWizardInjectLore?: boolean
    gameSystemWizardInjectMemo?: boolean
    gameSystemWizardInjectModulePrompts?: boolean
    gameSystemWizardModuleExampleKeys?: string[]
}

export interface WizardContextLegacy {
    listModuleExampleOptions(settings: WizardContextSettings): WizardModuleExampleOption[]
    /** The keys kept: those among the options, deduplicated, in the order given. */
    normalizeModuleExampleKeys(settings: WizardContextSettings, availableKeys?: string[] | null): string[]
    /** The `=== EXISTING MODULE PROMPTS ===` block, or `''` with the switch off or nothing picked. */
    moduleExamplesContext(settings: WizardContextSettings): string
}

/** The legacy's pieces over the texts given. */
export function createWizardContext(stockPrompts: Record<string, string>, resolveTimePromptKey: (settings: WizardContextSettings) => string): WizardContextLegacy {
    const legacy = createWizardContextLegacy(stockPrompts, resolveTimePromptKey)
    return {
        listModuleExampleOptions: (settings) => legacy.listGameSystemWizardModuleExampleOptions(settings) as WizardModuleExampleOption[],
        normalizeModuleExampleKeys: (settings, availableKeys = null) => legacy.normalizeGameSystemWizardModuleExampleKeys(settings, availableKeys) as string[],
        moduleExamplesContext: (settings) => legacy.buildGameSystemWizardModuleExamplesContext(settings) as string,
    }
}

/** The picker's options for the panel: the lister reads no text, so the factory gets none. */
export function listWizardModuleExampleOptions(settings: WizardContextSettings): WizardModuleExampleOption[] {
    return createWizardContext({}, () => 'time').listModuleExampleOptions(settings)
}
