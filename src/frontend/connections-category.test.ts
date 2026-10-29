// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import { CONNECTION_ROWS, MAX_TOKENS_FIELD, NARRATOR_BLANK, createConnectionsCategory, type ConnectionsCategoryHost } from './connections-category.js'

function harness(over: Partial<ConnectionsCategoryHost> = {}) {
    const calls: unknown[][] = []
    const host: ConnectionsCategoryHost = {
        el: (tag, attrs) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v); return n },
        savePrefs: async (patch) => { calls.push(['savePrefs', patch]) },
        textConnections: async () => { calls.push(['text']); return { connections: [{ id: 'conn-1', name: 'Main', model: 'deepseek', isDefault: true }, { id: 'conn-2', name: 'Fast', model: '', isDefault: false }] } },
        imageConnections: async () => { calls.push(['image']); return { connections: [{ id: 'img-1', name: 'Swarm', provider: 'swarmui', model: 'anima', isDefault: true }] } },
        fail: (error) => { calls.push(['fail', error instanceof Error ? error.message : String(error)]) },
        ...over,
    }
    const category = createConnectionsCategory(host)
    document.body.replaceChildren(category.root)
    const select = (field: string) => category.root.querySelector(`[data-lh-field="${field}"] select`) as HTMLSelectElement
    const options = (field: string) => Array.from(select(field).options).map((o) => o.textContent)
    const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0)) }
    return { category, calls, select, options, settle }
}

describe('the connections in one place (63)', () => {
    it('draws a row per connection in the passes’ order, each blank named for its fallback', () => {
        const { options } = harness()
        expect(CONNECTION_ROWS.map((r) => r.label)).toEqual(['State tracker', 'Lorebook agent', 'Character creator', 'Map Architect', 'Map Updater', 'Map Evolution', 'Portrait prompts', 'Scene picture', 'Portraits'])
        expect(options('connection-tracker')).toEqual([NARRATOR_BLANK])
        expect(options('connection-evolution')).toEqual(['The agent’s connection'])
        expect(options('connection-portrait-image')).toEqual(['The scene picture’s connection'])
    })

    it('reads the two lists once when loaded, text rows from the one and image rows from the other, keeping a chosen id not listed', async () => {
        const { category, calls, options, select, settle } = harness()
        category.applyPrefs({ trackerConnectionId: 'conn-2', scenePictureConnectionId: 'img-9', portraitConnectionId: '' })
        expect(options('connection-tracker')).toEqual([NARRATOR_BLANK, 'The connection you chose is no longer listed'])
        category.load()
        category.load()
        await settle()
        expect(calls).toEqual([['text'], ['image']])
        expect(options('connection-tracker')).toEqual([NARRATOR_BLANK, 'Main — deepseek', 'Fast'])
        expect(select('connection-tracker').value).toBe('conn-2')
        expect(options('connection-scene-image')).toEqual(['The host’s default image connection', 'Swarm — swarmui · anima (default)', 'The connection you chose is no longer listed'])
        expect(select('connection-scene-image').value).toBe('img-9')
        expect(options('connection-portrait-image')).toEqual(['The scene picture’s connection', 'Swarm — swarmui · anima (default)'])
    })

    it('saves a choice under its own preference, and Apply to all sets the seven text connections and no image', async () => {
        const { category, calls, select, settle } = harness()
        category.load()
        await settle()
        calls.length = 0
        select('connection-agent').value = 'conn-1'
        select('connection-agent').dispatchEvent(new Event('change'))
        await settle()
        expect(calls).toEqual([['savePrefs', { agentConnectionId: 'conn-1' }]])
        const all = category.root.querySelector('[data-lh-field="connection-all"] select') as HTMLSelectElement
        expect(Array.from(all.options).map((o) => o.textContent)).toEqual(['Each pass’s own fallback', 'Main — deepseek', 'Fast'])
        all.value = 'conn-2'
        ;(category.root.querySelector('[data-lh-field="connection-all"] button') as HTMLButtonElement).click()
        await settle()
        // Seven text connections since 72b: the Architect's and the Updater's joined the five.
        expect(calls[1]).toEqual(['savePrefs', { trackerConnectionId: 'conn-2', agentConnectionId: 'conn-2', creatorConnectionId: 'conn-2', mapArchitectConnectionId: 'conn-2', mapUpdaterConnectionId: 'conn-2', mapEvolutionConnectionId: 'conn-2', portraitPromptConnectionId: 'conn-2' }])
    })

    // 89: the output length for AdventureTime's own calls, the one number a pass gets.
    it('draws the output length after the rows, blank as it ships, saving a whole number and blank as zero, and following the preference', async () => {
        const { category, calls } = harness()
        const input = category.root.querySelector(`[data-lh-field="${MAX_TOKENS_FIELD}"] input`) as HTMLInputElement
        expect(input.value).toBe('')
        expect(input.placeholder).toContain('each provider’s own default')
        expect(category.root.querySelector(`[data-lh-field="${MAX_TOKENS_FIELD}"] .lh-conn-hint`)!.textContent).toContain('Anthropic’s through Lumiverse is 4,096')
        expect(Array.from(category.root.querySelectorAll('.lh-conn')).at(-1)!.getAttribute('data-lh-field')).toBe(MAX_TOKENS_FIELD)
        input.value = '4096.9'
        input.dispatchEvent(new Event('change'))
        expect(calls.at(-1)).toEqual(['savePrefs', { passMaxTokens: 4096 }])
        expect(input.value).toBe('4096')
        input.value = ''
        input.dispatchEvent(new Event('change'))
        expect(calls.at(-1)).toEqual(['savePrefs', { passMaxTokens: 0 }])
        input.value = '-3'
        input.dispatchEvent(new Event('change'))
        expect(calls.at(-1)).toEqual(['savePrefs', { passMaxTokens: 0 }])
        category.applyPrefs({ passMaxTokens: 8000 })
        expect(input.value).toBe('8000')
        category.applyPrefs({ passMaxTokens: 0 })
        expect(input.value).toBe('')
        // The blank label of the two story rows names the narrator's connection and its chain (89).
        expect(NARRATOR_BLANK).toBe('The narrator’s connection (the chat’s own, else the one seen writing the story, else Lumiverse’s default)')
    })

    it('says in the hints why a list could not be read, and a failed save is reported', async () => {
        const { category, calls, select, settle } = harness({
            textConnections: async () => { throw new Error('no connections permission') },
            imageConnections: async () => ({ connections: [], unavailable: 'PERMISSION_DENIED: image_gen' }),
            savePrefs: async () => { throw new Error('no store') },
        })
        category.load()
        await settle()
        expect(select('connection-tracker').parentElement!.querySelector('.lh-conn-hint')!.textContent).toBe('no connections permission')
        expect(select('connection-scene-image').parentElement!.querySelector('.lh-conn-hint')!.textContent).toBe('PERMISSION_DENIED: image_gen')
        expect((category.root.querySelector('[data-lh-field="connection-all"] button') as HTMLButtonElement).disabled).toBe(true)
        select('connection-portrait-prompt').value = ''
        select('connection-portrait-prompt').dispatchEvent(new Event('change'))
        await settle()
        expect(calls.at(-1)).toEqual(['fail', 'no store'])
    })
})
