/** The legacy's `{{user}}` placeholder, re-exported with a type for the tests that look for it. */
import { createWizardLegacy } from './wizard-legacy.js'

export const RT_USER_MACRO_SENTINEL: string = createWizardLegacy([]).RT_USER_MACRO_SENTINEL
