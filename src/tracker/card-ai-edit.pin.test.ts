import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { buildCardAiEditPrompt, CARD_AI_EDIT_TEXT } from './card-ai-edit.js'

const checkout = process.env.MULTIHOG_CHECKOUT
const available = !!checkout && existsSync(`${checkout}/src/ui/panel/panel-builder.js`)

describe.skipIf(!available)('Edit with AI against the pinned legacy build (78c)', () => {
    const source = () => readFileSync(`${checkout}/src/ui/panel/panel-builder.js`, 'utf8')

    it('transcribes the two system prompts and the three toasts from panel-builder.js', () => {
        const text = source()
        expect(text).toContain(`\`${CARD_AI_EDIT_TEXT.npcSystem}\``)
        expect(text).toContain(`\`${CARD_AI_EDIT_TEXT.pcSystem}\``)
        expect(text).toContain(`'${CARD_AI_EDIT_TEXT.emptyInstructions}'`)
        expect(text).toContain(`'${CARD_AI_EDIT_TEXT.emptyResult}'`)
    })

    it('assembles the user message as the legacy’s template does, placeholders and all', () => {
        const text = source()
        const asSource = (s: string) => s.replace(/\n/g, '\\n')
        const npc = buildCardAiEditPrompt('npc', "${item.content || ''}", '${instructions}').user
        expect(text).toContain(`\`${asSource(npc)}\``)
        const pc = buildCardAiEditPrompt('pc', "${pc.bio || ''}", '${instructions}').user
        expect(text).toContain(`\`${asSource(pc)}\``)
    })
})
