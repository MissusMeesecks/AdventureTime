// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { PANEL_CSS, mountPanel, type PanelHost } from './panel.js'
import { NARRATOR_BLANK } from './connections-category.js'
import { Bridge, type BridgeHost } from './bridge.js'
import { CHANNEL, type RequestMessage } from '../protocol.js'
import { createDefaultSettings } from '../backend/settings-store.js'

/** A bridge whose backend answers from a table of canned responses. */
function makeBridge(answers: Partial<Record<string, unknown>> = {}) {
    const requests: RequestMessage[] = []
    let deliver: ((payload: unknown) => void) | undefined

    const host: BridgeHost = {
        sendToBackend(payload) {
            const request = payload as RequestMessage
            requests.push(request)
            const answer = answers[request.op]
            queueMicrotask(() => {
                deliver?.({
                    channel: CHANNEL,
                    kind: 'response',
                    id: request.id,
                    ok: answer !== undefined,
                    data: answer,
                    error: answer === undefined ? `no canned answer for ${request.op}` : undefined,
                })
            })
        },
        onBackendMessage(handler) {
            deliver = handler
            return () => {}
        },
    }

    /** Push an unsolicited backend event, as the host would. */
    const emit = (name: string, data?: unknown) => deliver?.({ channel: CHANNEL, kind: 'event', name, data })

    return { bridge: new Bridge(host), requests, emit }
}

function makeHost(confirmed = true) {
    const showConfirm = vi.fn(async () => ({ confirmed }))
    const pickFile = vi.fn(async () => [{
        name: 'cartridge.json',
        bytes: new TextEncoder().encode('{"format":"multihog-game-cartridge"}'),
    }])

    const host: PanelHost = {
        dom: {
            createElement: ((tag: string, attrs?: Record<string, string>) => {
                const node = document.createElement(tag)
                for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, value)
                return node
            }) as PanelHost['dom']['createElement'],
        },
        ui: { showConfirm },
        uploads: { pickFile },
        getActiveChat: () => ({ chatId: 'chat-1', characterId: 'char-1' }),
    }
    return { host, showConfirm, pickFile }
}

/** Let the bridge's queued microtask replies land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function button(root: HTMLElement, text: string): HTMLButtonElement {
    return Array.from(root.querySelectorAll("button")).find((b) => b.textContent === text) as HTMLButtonElement
}

beforeEach(() => {
    document.body.replaceChildren()
    // happy-dom has no object-URL plumbing; the download path only needs it
    // to not throw.
    URL.createObjectURL = vi.fn(() => 'blob:test')
    URL.revokeObjectURL = vi.fn()
})

describe('the diagnostics line', () => {
    const line = (root: HTMLElement) => root.querySelector('.lh-diagnostics') as HTMLElement

    const STATUS = (over: Record<string, unknown> = {}) => ({
        version: '0.2.0',
        host: '0.8.7',
        granted: ['generation', 'interceptor', 'chat_mutation', 'world_books'],
        missing: [],
        checked: true,
        ...over,
    })

    it('names the running build, so an install that did not update is visible', async () => {
        // Lumiverse builds an extension at install time, so merging a fix does
        // not update an install. Without a version on screen, "the fix did not
        // work" and "the fix is not installed" look identical.
        const { bridge } = makeBridge({ 'settings.get': { settings: createDefaultSettings() }, 'status.get': STATUS() })
        const root = document.createElement('div')
        document.body.append(root)
        mountPanel(root, bridge, makeHost().host)
        await settle()

        expect(line(root).textContent).toContain('AdventureTime 0.2.0')
        expect(line(root).textContent).toContain('Lumiverse 0.8.7')
        expect(line(root).textContent).toContain('all 4 permissions granted')
        expect(line(root).classList.contains('lh-diagnostics--warn')).toBe(false)
    })

    it('names a missing permission and what it costs', async () => {
        // An undeclared permission failed every tracker pass once, and the only
        // symptom was tracker state that would not move.
        const { bridge } = makeBridge({
            'settings.get': { settings: createDefaultSettings() },
            'status.get': STATUS({
                granted: ['generation', 'interceptor', 'world_books'],
                missing: [{ name: 'chat_mutation', needs: 'reading the recent narrative' }],
            }),
        })
        const root = document.createElement('div')
        document.body.append(root)
        mountPanel(root, bridge, makeHost().host)
        await settle()

        expect(line(root).classList.contains('lh-diagnostics--warn')).toBe(true)
        expect(line(root).textContent).toContain('chat_mutation')
        expect(line(root).textContent).toContain('reading the recent narrative')
        expect(line(root).textContent).toMatch(/Press Update/)
    })

    it('says it could not tell, rather than that nothing is granted', async () => {
        // Two empty lists mean either "nothing granted" or "no way to ask", and
        // those need different words.
        const { bridge } = makeBridge({
            'settings.get': { settings: createDefaultSettings() },
            'status.get': STATUS({ granted: [], missing: [], checked: false }),
        })
        const root = document.createElement('div')
        document.body.append(root)
        mountPanel(root, bridge, makeHost().host)
        await settle()

        expect(line(root).textContent).toMatch(/could not be checked/)
        expect(line(root).classList.contains('lh-diagnostics--warn')).toBe(false)
    })

    it('asks even when the settings load fails', async () => {
        // A diagnostic that only appears when everything else worked is no use
        // on the day something did not.
        const { bridge, requests } = makeBridge({ 'status.get': STATUS() })
        const root = document.createElement('div')
        document.body.append(root)
        mountPanel(root, bridge, makeHost().host)
        await settle()

        expect(requests.map((r) => r.op)).toContain('status.get')
        expect(line(root).textContent).toContain('AdventureTime 0.2.0')
    })

    it('says the build may be stale when the backend does not know the op', async () => {
        // A frontend newer than its backend is itself a half-updated install.
        const { bridge } = makeBridge({ 'settings.get': { settings: createDefaultSettings() } })
        const root = document.createElement('div')
        document.body.append(root)
        mountPanel(root, bridge, makeHost().host)
        await settle()

        expect(line(root).textContent).toMatch(/may be out of date/)
    })
})

describe('the dice line', () => {
    const dice = (root: HTMLElement) => root.querySelector('.lh-dice-line') as HTMLElement
    const STATUS = (dice: Record<string, unknown> | undefined) => ({
        version: '0.32.0', host: '0.8.7', granted: ['tools'], missing: [], checked: true,
        ...(dice ? { dice } : {}),
    })
    const CALL = {
        at: '2026-09-13T13:02:00.000Z', toolName: 'RollTheDice', who: 'Poppy', for: 'Stealth',
        formula: '1d20+7', dc: 14, total: 24, verdict: 'success',
    }
    const mountWith = async (status: unknown) => {
        const made = makeBridge({ 'settings.get': { settings: createDefaultSettings() }, 'status.get': status })
        const root = document.createElement('div')
        document.body.append(root)
        mountPanel(root, made.bridge, makeHost().host)
        await settle()
        return { root, ...made }
    }

    it('says the tool is registered and not yet called', async () => {
        const { root } = await mountWith(STATUS({ registered: ['RollTheDice'], absent: null, calls: 0 }))
        expect(dice(root).textContent).toBe('Dice tool: RollTheDice registered · not called yet')
    })

    // The whole reason for the line: a reply reads the same rolled or
    // simulated, so the call has to be visible somewhere.
    // This reply's calls, in order, are what the narration is checked
    // against; the running total alone answered a question nobody asked.
    it('lists this reply\'s calls, each with its result, then the total', async () => {
        const second = { ...CALL, for: 'Perception', formula: '1d20+5', total: 9, verdict: 'failure' }
        const { root } = await mountWith(STATUS({ registered: ['RollTheDice'], absent: null, calls: 10, last: second, turn: [CALL, second] }))
        expect(dice(root).textContent).toBe(
            'Dice tool: RollTheDice registered · this reply: Stealth 1d20+7 vs DC 14 → 24 success; Perception 1d20+5 vs DC 14 → 9 failure · 10 in total',
        )
    })

    it('says when this reply made no call although earlier ones did', async () => {
        const { root } = await mountWith(STATUS({ registered: ['RollTheDice'], absent: null, calls: 3, last: CALL, turn: [] }))
        expect(dice(root).textContent).toMatch(/^Dice tool: RollTheDice registered · this reply: no calls · 3 in total, last \d\d:\d\d$/)
    })

    it('says why there is no tool, quietly for a mode that asks for none', async () => {
        const { root } = await mountWith(STATUS({ registered: [], absent: 'mode', calls: 0 }))
        expect(dice(root).textContent).toContain('RNG mode is not "Pre-seeded + tool calls"')
        expect(dice(root).classList.contains('lh-dice-line--warn')).toBe(false)
    })

    it('says the queue has taken over during combat', async () => {
        const { root } = await mountWith(STATUS({ registered: [], absent: 'combat', calls: 1, last: CALL, turn: [] }))
        expect(dice(root).textContent).toContain('away during combat')
        expect(dice(root).textContent).toContain('this reply: no calls · 1 in total')
    })

    it('warns when the host refused the tool', async () => {
        const { root } = await mountWith(STATUS({ registered: [], absent: 'refused', calls: 0 }))
        expect(dice(root).classList.contains('lh-dice-line--warn')).toBe(true)
        expect(dice(root).textContent).toContain('tools permission')
    })

    it('draws nothing for a backend that does not report dice', async () => {
        const { root } = await mountWith(STATUS(undefined))
        expect(dice(root).textContent).toBe('')
    })

    it('re-reads the status when a roll is answered', async () => {
        const { root, requests, emit } = await mountWith(STATUS({ registered: ['RollTheDice'], absent: null, calls: 0 }))
        const before = requests.filter((r) => r.op === 'status.get').length
        emit('dice.rolled', CALL)
        await settle()
        expect(requests.filter((r) => r.op === 'status.get').length).toBe(before + 1)
        expect(root.querySelector('.lh-dice-line')).not.toBeNull()
    })
})

describe('panel', () => {
    it('asks for settings and renders the sections', async () => {
        const root = document.createElement('div')
        const { bridge, requests } = makeBridge({ 'settings.get': { settings: createDefaultSettings() } })
        mountPanel(root, bridge, makeHost().host)
        await settle()

        expect(requests[0]!.op).toBe('settings.get')
        expect(root.querySelectorAll('.lh-section').length).toBeGreaterThan(0)
        expect(root.querySelector('.lh-status')!.textContent).toBe('Ready.')
    })

    // Caught by two green mutations. The test below exercises the custom fields
    // editor, which has its own commit call — and left the **binder** path
    // untested, which is how every ordinary control saves. Both mutations that
    // survived lived there.
    it('reports a binder control that could not save, naming the control', async () => {
        const root = document.createElement('div')
        const { bridge } = makeBridge({ 'settings.get': { settings: createDefaultSettings() } })
        mountPanel(root, bridge, makeHost().host)
        await settle()

        // Any checkbox will do: `settings.patch` has no canned answer, so the
        // commit behind it is refused.
        const box = root.querySelector('.lh-check input[type=checkbox]') as HTMLInputElement
        expect(box).toBeDefined()
        box.checked = !box.checked
        box.dispatchEvent(new Event('change'))
        await settle()

        const problem = root.querySelector('.lh-problem') as HTMLElement
        expect(problem.hidden).toBe(false)
        expect(problem.textContent).toMatch(/^Could not save .+ — /)
        // Named by its label, not by its settings key.
        expect(problem.textContent).not.toMatch(/Could not save [a-z][a-zA-Z]*Enabled/)
        // And not on the ambient line, which the next "Saved." would replace.
        expect(root.querySelector('.lh-status')!.textContent).toBe('Ready.')
    })

    // The customFields case, generalised. A save that is refused must say what
    // did not save — the host's words name a settings key, not the thing the
    // user was typing into — and it must not sit on the ambient line where the
    // next "Saved." from any other control replaces it.
    it('names what failed to save, and keeps the failure on its own line', async () => {
        const root = document.createElement('div')
        const { bridge } = makeBridge({ 'settings.get': { settings: createDefaultSettings() } })
        mountPanel(root, bridge, makeHost().host)
        await settle()

        // `settings.patch` has no canned answer, so any commit is refused.
        const add = Array.from(root.querySelectorAll('button'))
            .find((b) => b.textContent === 'Add a field') as HTMLButtonElement
        expect(add).toBeDefined()

        add.click()
        await settle()

        const problem = root.querySelector('.lh-problem') as HTMLElement
        expect(problem.hidden).toBe(false)
        expect(problem.textContent).toContain('Could not save Custom fields')
        // And the host's own words are kept after it, not replaced by ours.
        expect(problem.textContent).toContain('settings.patch')
        // The ambient line is untouched by a failure.
        expect(root.querySelector('.lh-status')!.textContent).toBe('Ready.')
    })

    // The live report: two lists, and ticking in one did not move the other or
    // raise the drift warning until the page was reloaded. Both halves of that
    // are panel-level, which is why neither editor's own tests saw it.
    function withPairedData() {
        const settings = createDefaultSettings()
        settings.gameSystems = [
            { id: 's1', name: 'The Trail', customFieldTag: 'TRAIL', enabled: false },
            { id: 's2', name: 'Mask Roll', customFieldTag: '', enabled: true },
        ]
        settings.customFields = [
            { tag: 'TRAIL', label: 'Trail', icon: '', prompt: 'Track it.', enabled: false },
        ]
        return settings
    }

    const fieldToggle = (root: HTMLElement) =>
        root.querySelector('.lh-field-head input[type=checkbox]') as HTMLInputElement

    it('keeps the game systems a cartridge loaded, so a field switch after the load follows them (43)', async () => {
        const root = document.createElement('div')
        const loaded = withPairedData()
        const { bridge, requests } = makeBridge({
            'settings.get': { settings: createDefaultSettings() },
            'cartridge.import': { settings: loaded, name: 'Vellmoor' },
            'settings.patch': { settings: loaded },
        })
        mountPanel(root, bridge, makeHost(true).host)
        await settle()
        expect(fieldToggle(root)).toBeNull()

        button(root, 'Import cartridge…').click()
        await settle()
        // The fields editor follows the cartridge, and so does the panel's own copy of the settings.
        const box = fieldToggle(root)
        box.checked = true
        box.dispatchEvent(new Event('change'))
        await settle()

        const patch = requests.filter((r) => r.op === 'settings.patch').at(-1)
        const sent = (patch!.params as { patch: Record<string, unknown> }).patch
        expect(Object.keys(sent).sort()).toEqual(['customFields', 'gameSystems'])
        expect((sent.gameSystems as Array<{ id: string; enabled: boolean }>).find((system) => system.id === 's1')!.enabled).toBe(true)
    })

    it('carries a custom field switch across to the game system it is half of', async () => {
        const root = document.createElement('div')
        const settings = withPairedData()
        const { bridge, requests } = makeBridge({
            'settings.get': { settings },
            'settings.patch': { settings },
        })
        mountPanel(root, bridge, makeHost().host)
        await settle()

        const box = fieldToggle(root)
        box.checked = true
        box.dispatchEvent(new Event('change'))
        await settle()

        const patch = requests.filter((r) => r.op === 'settings.patch').at(-1)
        const sent = (patch!.params as { patch: Record<string, unknown> }).patch
        expect(Object.keys(sent).sort()).toEqual(['customFields', 'gameSystems'])
        const systems = sent.gameSystems as Array<{ id: string; enabled: boolean }>
        expect(systems.find((system) => system.id === 's1')!.enabled).toBe(true)
        // A GM-only system has no module to follow and must not be invented at.
        expect(systems.find((system) => system.id === 's2')!.enabled).toBe(true)
    })

    it('sends only the fields when no system moved with them', async () => {
        const root = document.createElement('div')
        const settings = createDefaultSettings()
        settings.gameSystems = []
        settings.customFields = [
            { tag: 'TRAIL', label: 'Trail', icon: '', prompt: 'Track it.', enabled: false },
        ]
        const { bridge, requests } = makeBridge({
            'settings.get': { settings },
            'settings.patch': { settings },
        })
        mountPanel(root, bridge, makeHost().host)
        await settle()

        const box = fieldToggle(root)
        box.checked = true
        box.dispatchEvent(new Event('change'))
        await settle()

        const patch = requests.filter((r) => r.op === 'settings.patch').at(-1)
        const sent = (patch!.params as { patch: Record<string, unknown> }).patch
        expect(Object.keys(sent)).toEqual(['customFields'])
    })

    // The other half of the live report. The badge above said the opposite of
    // the checkbox below until the page was reloaded.
    it('redraws the game systems reading after a commit', async () => {
        const root = document.createElement('div')
        const before = withPairedData()
        const after = withPairedData()
        after.gameSystems = [
            { id: 's1', name: 'The Trail', customFieldTag: 'TRAIL', enabled: true },
            { id: 's2', name: 'Mask Roll', customFieldTag: '', enabled: true },
        ]
        after.customFields = [
            { tag: 'TRAIL', label: 'Trail', icon: '', prompt: 'Track it.', enabled: true },
        ]
        const { bridge } = makeBridge({
            'settings.get': { settings: before },
            'settings.patch': { settings: after },
        })
        mountPanel(root, bridge, makeHost().host)
        await settle()

        expect(root.querySelector('.lh-gs-badge')!.textContent).toBe('off')

        const box = fieldToggle(root)
        box.checked = true
        box.dispatchEvent(new Event('change'))
        await settle()

        expect(root.querySelector('.lh-gs-badge')!.textContent).toBe('tracked')
    })

    // The wizard's save (Phase 32): one patch of the three keys, and the game
    // systems reading above it redrawn from the reply — a saved system that did
    // not appear in the list would look like a save that failed.
    it('saves a wizard draft as one patch of the three keys and redraws the list', async () => {
        const root = document.createElement('div')
        const before = withPairedData()
        const draft = {
            name: 'Radiation', icon: '☢️', needsTracker: true, driverTime: true, driverGmAnnotation: false,
            driverStatedFact: false, effectOwner: 'tracker', includeGm: true, gmTag: 'radiation',
            gmContent: '<radiation>\nRads.\n</radiation>', trackerTag: 'RADS', trackerLabel: 'Radiation',
            trackerIcon: '☢️', trackerContent: '[RADS]\nRADS: 0\n[/RADS]',
        }
        const after = withPairedData()
        after.gameSystems = [...(before.gameSystems as object[]), { id: 'new', name: 'Radiation', customFieldTag: 'RADS', enabled: true }]
        after.customFields = [...(before.customFields as object[]), { tag: 'RADS', label: 'Radiation', icon: '', prompt: 'x', enabled: true }]
        const { bridge, requests } = makeBridge({
            'settings.get': { settings: before },
            'settings.patch': { settings: after },
            'wizard.draft': { draft },
            'tracker.instruct': { memo: '[RADS]\nRADS: 0\n[/RADS]', updatedAt: new Date().toISOString(), lastPass: null },
        })
        mountPanel(root, bridge, makeHost().host)
        await settle()
        expect(root.querySelectorAll('.lh-gs-row')).toHaveLength(2)

        const description = root.querySelector('[data-lh-field="wizard-description"]') as HTMLTextAreaElement
        description.value = 'Irradiated zones.'
        description.dispatchEvent(new Event('input'))
        button(root, 'Draft it').click()
        await settle()
        button(root, 'Save and switch on').click()
        await settle()

        const patch = requests.filter((r) => r.op === 'settings.patch').at(-1)
        const sent = (patch!.params as { patch: Record<string, unknown> }).patch
        expect(Object.keys(sent).sort()).toEqual(['customFields', 'customSyspromptLibrary', 'gameSystems'])
        expect((sent.gameSystems as Array<{ name: string }>).map((s) => s.name)).toEqual(['The Trail', 'Mask Roll', 'Radiation'])
        expect((sent.customFields as Array<{ tag: string }>).map((f) => f.tag)).toEqual(['TRAIL', 'RADS'])
        expect(root.querySelectorAll('.lh-gs-row')).toHaveLength(3)
        // And, once the save landed, the tracker was asked for the block (32a).
        const seed = requests.find((r) => r.op === 'tracker.instruct')
        expect(seed).toBeDefined()
        expect(requests.indexOf(seed!)).toBeGreaterThan(requests.indexOf(patch!))
        expect((seed!.params as { instruction: string }).instruction).toContain('Create the [RADS] block now')
    })

    it('asks for no tracker pass when the system is saved switched off', async () => {
        const root = document.createElement('div')
        const draft = {
            name: 'Radiation', icon: '☢️', needsTracker: true, driverTime: true, driverGmAnnotation: false,
            driverStatedFact: false, effectOwner: 'tracker', includeGm: true, gmTag: 'radiation',
            gmContent: '<radiation>\nRads.\n</radiation>', trackerTag: 'RADS', trackerLabel: 'Radiation',
            trackerIcon: '☢️', trackerContent: '[RADS]\nRADS: 0\n[/RADS]',
        }
        const { bridge, requests } = makeBridge({
            'settings.get': { settings: withPairedData() },
            'settings.patch': { settings: withPairedData() },
            'wizard.draft': { draft },
        })
        mountPanel(root, bridge, makeHost().host)
        await settle()
        const description = root.querySelector('[data-lh-field="wizard-description"]') as HTMLTextAreaElement
        description.value = 'Irradiated zones.'
        description.dispatchEvent(new Event('input'))
        button(root, 'Draft it').click()
        await settle()
        button(root, 'Save switched off').click()
        await settle()
        expect(requests.some((r) => r.op === 'settings.patch')).toBe(true)
        expect(requests.some((r) => r.op === 'tracker.instruct')).toBe(false)
    })

    it('says the system is saved when the pass to add its block fails', async () => {
        const root = document.createElement('div')
        const draft = {
            name: 'Radiation', icon: '☢️', needsTracker: true, driverTime: true, driverGmAnnotation: false,
            driverStatedFact: false, effectOwner: 'tracker', includeGm: true, gmTag: 'radiation',
            gmContent: '<radiation>\nRads.\n</radiation>', trackerTag: 'RADS', trackerLabel: 'Radiation',
            trackerIcon: '☢️', trackerContent: '[RADS]\nRADS: 0\n[/RADS]',
        }
        const { bridge } = makeBridge({
            'settings.get': { settings: withPairedData() },
            'settings.patch': { settings: withPairedData() },
            'wizard.draft': { draft },
            // no 'tracker.instruct' answer: the pass fails
        })
        mountPanel(root, bridge, makeHost().host)
        await settle()
        const description = root.querySelector('[data-lh-field="wizard-description"]') as HTMLTextAreaElement
        description.value = 'Irradiated zones.'
        description.dispatchEvent(new Event('input'))
        button(root, 'Draft it').click()
        await settle()
        button(root, 'Save and switch on').click()
        await settle()
        await settle()
        const problem = root.querySelector('.lh-problem')!
        expect(problem.textContent).toContain('The system is saved, but the tracker pass to add its block failed')
        expect(problem.textContent).not.toContain('Could not save')
    })

    // The Edit button on a row opens that system in the wizard below — reading
    // the settings as the *last commit* left them, not as the panel was mounted:
    // the library entry here arrives only in the patch reply.
    it('opens a listed system in the wizard from its Edit button, from the latest settings', async () => {
        const root = document.createElement('div')
        const after = withPairedData()
        after.customSyspromptLibrary = [{ id: 'lib1', tag: 'gender_cast', content: '<gender_cast>\nCast.\n</gender_cast>', enabled: true }]
        const systems = after.gameSystems as Array<Record<string, unknown>>
        systems[1] = { ...systems[1]!, syspromptLibraryId: 'lib1' }
        const { bridge } = makeBridge({ 'settings.get': { settings: withPairedData() }, 'settings.patch': { settings: after } })
        mountPanel(root, bridge, makeHost().host)
        await settle()
        const box = fieldToggle(root)
        box.checked = true
        box.dispatchEvent(new Event('change'))
        await settle()

        Array.from(root.querySelectorAll<HTMLButtonElement>('.lh-gs-edit'))[1]!.click()
        expect((root.querySelector('[data-lh-field="wizard-name"]') as HTMLInputElement).value).toBe('Mask Roll')
        expect((root.querySelector('[data-lh-field="wizard-gm-content"]') as HTMLTextAreaElement).value).toContain('Cast.')
        expect((root.querySelector('[data-lh-field="wizard-include-tracker"]') as HTMLInputElement).checked).toBe(false)
    })

    // Re-seeding the section the *user is typing in* would move their cursor,
    // which is why only the read-only one is refreshed from the response. The
    // response here carries a second field the editor never saw; if the panel
    // re-seeded from it, a row would appear under the user's hands.
    it('does not redraw the custom fields editor from the response', async () => {
        const root = document.createElement('div')
        const after = withPairedData()
        after.customFields = [
            { tag: 'TRAIL', label: 'Trail', icon: '', prompt: 'Track it.', enabled: true },
            { tag: 'EMBERS', label: 'Embers', icon: '', prompt: 'Track it.', enabled: true },
        ]
        const { bridge } = makeBridge({
            'settings.get': { settings: withPairedData() },
            'settings.patch': { settings: after },
        })
        mountPanel(root, bridge, makeHost().host)
        await settle()

        const box = fieldToggle(root)
        box.checked = true
        box.dispatchEvent(new Event('change'))
        await settle()

        expect(root.querySelectorAll('.lh-field')).toHaveLength(1)
    })

    it('names the custom fields editor when its save is refused', async () => {
        const root = document.createElement('div')
        const { bridge } = makeBridge({ 'settings.get': { settings: withPairedData() } })
        mountPanel(root, bridge, makeHost().host)
        await settle()

        const box = fieldToggle(root)
        box.checked = true
        box.dispatchEvent(new Event('change'))
        await settle()

        const problem = root.querySelector('.lh-problem') as HTMLElement
        expect(problem.hidden).toBe(false)
        expect(problem.textContent).toContain('Could not save')
    })

    // Lesson 20 again: the editor's tests use a fake onChange, and the panel is
    // where the patch actually has to arrive -- and where the settings that
    // come back have to reach the row that shows the second key.
    function withModules() {
        const settings = createDefaultSettings()
        settings.modules = { character: true, quests: true }
        settings.stockPrompts = { character: 'Main stats. More.', quests: 'Quests. More.' }
        settings.syspromptModules = { quests: false }
        return settings
    }

    // The tracker's module rows; the agent's wear the same classes and sit before the settings since 78a.
    const moduleToggle = (root: HTMLElement, index: number) =>
        Array.from(root.querySelectorAll<HTMLInputElement>('.lh-tm-head input[type=checkbox]:not([data-lh-field^="agent-module-enabled-"])'))[index]!

    it('sends a module switch as a patch of the whole table', async () => {
        const root = document.createElement('div')
        const settings = withModules()
        const { bridge, requests } = makeBridge({
            'settings.get': { settings },
            'settings.patch': { settings },
        })
        mountPanel(root, bridge, makeHost().host)
        await settle()

        const box = moduleToggle(root, 0)
        box.checked = false
        box.dispatchEvent(new Event('change'))
        await settle()

        const patch = requests.filter((r) => r.op === 'settings.patch').at(-1)
        const sent = (patch!.params as { patch: Record<string, unknown> }).patch
        expect(Object.keys(sent)).toEqual(['modules'])
        expect((sent.modules as Record<string, boolean>).character).toBe(false)
    })

    // The quests row is the only one with two gates, and switching it on has to
    // clear both or it reads on and changes nothing.
    it('sends both keys when the quests row is switched on', async () => {
        const root = document.createElement('div')
        const settings = withModules()
        const { bridge, requests } = makeBridge({
            'settings.get': { settings },
            'settings.patch': { settings },
        })
        mountPanel(root, bridge, makeHost().host)
        await settle()

        // Index 1 is quests, drawn unchecked because the second key gates it.
        const box = moduleToggle(root, 1)
        expect(box.checked).toBe(false)
        box.checked = true
        box.dispatchEvent(new Event('change'))
        await settle()

        const patch = requests.filter((r) => r.op === 'settings.patch').at(-1)
        const sent = (patch!.params as { patch: Record<string, unknown> }).patch
        expect(Object.keys(sent).sort()).toEqual(['modules', 'syspromptModules'])
        expect((sent.syspromptModules as Record<string, boolean>).quests).toBe(true)
    })

    // The response has to *disagree* with what the editor drew for itself, or
    // this proves nothing: the editor renders optimistically from its own copy,
    // so a matching response leaves the same checkbox either way. A mutation
    // deleting the panel's re-seed stayed green until this backend refused the
    // change instead of accepting it.
    it('redraws the modules list from what came back, not from what it sent', async () => {
        const root = document.createElement('div')
        const refused = withModules()
        const { bridge } = makeBridge({
            'settings.get': { settings: withModules() },
            // The backend keeps the second gate shut, so the row must go back
            // to unchecked rather than staying where the click put it.
            'settings.patch': { settings: refused },
        })
        mountPanel(root, bridge, makeHost().host)
        await settle()

        const box = moduleToggle(root, 1)
        expect(box.checked).toBe(false)
        box.checked = true
        box.dispatchEvent(new Event('change'))
        await settle()

        expect(moduleToggle(root, 1).checked).toBe(false)
    })

    // The order editor's tests use a fake onChange too (37); the patch has to
    // arrive here whole, and the list has to redraw from what comes back --
    // which is also where a field made in the editor below takes its place.
    it('sends a move as a patch of the whole order, and redraws the list from what came back', async () => {
        const root = document.createElement('div')
        const settings = createDefaultSettings()
        const returned = { ...createDefaultSettings(), customFields: [{ tag: 'RADS', label: 'Radiation', icon: '☢️', enabled: true }] }
        const { bridge, requests } = makeBridge({
            'settings.get': { settings },
            'settings.patch': { settings: returned },
        })
        mountPanel(root, bridge, makeHost().host)
        await settle()

        // The order's rows are the modules editor's since 82: the nine stock blocks with a card of their own.
        expect(root.querySelectorAll('.lh-tm-row[data-lh-order]')).toHaveLength(9)
        root.querySelector<HTMLButtonElement>('button[aria-label="Move [CHARACTER] up"]')!.click()
        await settle()

        const patch = requests.filter((r) => r.op === 'settings.patch').at(-1)
        const sent = (patch!.params as { patch: Record<string, unknown> }).patch
        expect(Object.keys(sent)).toEqual(['blockOrder'])
        expect((sent.blockOrder as string[]).slice(0, 2)).toEqual(['CHARACTER', 'COMBAT'])
        // What came back had the stock order and a new field: the list follows it.
        const tags = Array.from(root.querySelectorAll('.lh-tm-row[data-lh-order]')).map((node) => node.getAttribute('data-lh-order'))
        expect(tags).toHaveLength(10)
        expect(tags.slice(0, 2)).toEqual(['COMBAT', 'CHARACTER'])
        expect(tags[9]).toBe('RADS')
        // The custom field's row carries the arrows alone; its switch is under Custom fields.
        expect(root.querySelector('.lh-tm-row[data-lh-order="RADS"]')!.classList.contains('lh-tm-row--custom')).toBe(true)
        expect(root.querySelector('.lh-tm-row[data-lh-order="RADS"] input[type=checkbox]')).toBeNull()
        // No Section order row of its own any more: the key is listed for the store and drawn here.
        expect(Array.from(root.querySelectorAll('.lh-row')).some((r) => r.textContent?.includes('Section order'))).toBe(false)
    })

    it('names the order editor when its save is refused', async () => {
        const root = document.createElement('div')
        const settings = createDefaultSettings()
        const { bridge } = makeBridge({ 'settings.get': { settings } })
        mountPanel(root, bridge, makeHost().host)
        await settle()

        root.querySelector<HTMLButtonElement>('button[aria-label="Move [CHARACTER] up"]')!.click()
        await settle()

        const problem = root.querySelector('.lh-problem') as HTMLElement
        expect(problem.hidden).toBe(false)
        expect(problem.textContent).toContain('Could not save Section order')
    })

    it('names the modules editor when its save is refused', async () => {
        const root = document.createElement('div')
        const { bridge } = makeBridge({ 'settings.get': { settings: withModules() } })
        mountPanel(root, bridge, makeHost().host)
        await settle()

        const box = moduleToggle(root, 0)
        box.checked = false
        box.dispatchEvent(new Event('change'))
        await settle()

        const problem = root.querySelector('.lh-problem') as HTMLElement
        expect(problem.hidden).toBe(false)
        expect(problem.textContent).toContain('Could not save Tracker modules')
    })

    // Lesson 20 for the rulebook: the editor's tests use a fake onChange, and
    // the panel is where the flag table has to arrive as a patch -- and where
    // the row has to follow what the backend actually stored.
    const rulebookToggle = (root: HTMLElement, tag: string) =>
        Array.from(root.querySelectorAll('.lh-rb-row'))
            .find((r) => r.querySelector('.lh-rb-tag')!.textContent === `<${tag}>`)!
            .querySelector('.lh-rb-head input[type=checkbox]') as HTMLInputElement

    it('sends a rulebook switch as a patch of the whole flag table', async () => {
        const root = document.createElement('div')
        const settings = createDefaultSettings()
        const { bridge, requests } = makeBridge({
            'settings.get': { settings },
            'settings.patch': { settings },
        })
        mountPanel(root, bridge, makeHost().host)
        await settle()

        const box = rulebookToggle(root, 'loot')
        expect(box.checked).toBe(true)
        box.checked = false
        box.dispatchEvent(new Event('change'))
        await settle()

        const patch = requests.filter((r) => r.op === 'settings.patch').at(-1)
        const sent = (patch!.params as { patch: Record<string, unknown> }).patch
        expect(Object.keys(sent)).toEqual(['syspromptModules'])
        expect((sent.syspromptModules as Record<string, boolean>).loot).toBe(false)
        expect((sent.syspromptModules as Record<string, boolean>).resting).toBe(true)
    })

    // The backend refuses the change here, so the row has to go back to
    // checked -- which only a re-seed from the response can do (lesson 31).
    it('redraws the rulebook from what came back, not from what it sent', async () => {
        const root = document.createElement('div')
        const settings = createDefaultSettings()
        const { bridge } = makeBridge({
            'settings.get': { settings },
            'settings.patch': { settings },
        })
        mountPanel(root, bridge, makeHost().host)
        await settle()

        const box = rulebookToggle(root, 'loot')
        box.checked = false
        box.dispatchEvent(new Event('change'))
        await settle()

        expect(rulebookToggle(root, 'loot').checked).toBe(true)
    })

    it('names the rulebook when its save is refused', async () => {
        const root = document.createElement('div')
        const { bridge } = makeBridge({ 'settings.get': { settings: createDefaultSettings() } })
        mountPanel(root, bridge, makeHost().host)
        await settle()

        const box = rulebookToggle(root, 'loot')
        box.checked = false
        box.dispatchEvent(new Event('change'))
        await settle()

        const problem = root.querySelector('.lh-problem') as HTMLElement
        expect(problem.hidden).toBe(false)
        expect(problem.textContent).toContain('Could not save The rulebook')
    })

    it('reports a backend that will not answer', async () => {
        const root = document.createElement('div')
        const { bridge } = makeBridge({})
        mountPanel(root, bridge, makeHost().host)
        await settle()

        // Failures moved off the ambient status line onto their own, which
        // nothing but the user clears.
        const problem = root.querySelector('.lh-problem') as HTMLElement
        expect(problem.hidden).toBe(false)
        expect(problem.textContent).toMatch(/no canned answer/)
    })

    it('exports a cartridge and hands the user the file', async () => {
        const root = document.createElement('div')
        const { bridge, requests } = makeBridge({
            'settings.get': { settings: createDefaultSettings() },
            'cartridge.export': { file: '{}', filename: 'my-setup.json' },
        })
        mountPanel(root, bridge, makeHost().host)
        await settle()

        button(root, 'Export cartridge').click()
        await settle()

        expect(requests.some((r) => r.op === 'cartridge.export')).toBe(true)
        expect(URL.createObjectURL).toHaveBeenCalled()
        expect(root.querySelector('.lh-status')!.textContent).toMatch(/my-setup\.json/)
    })

    it('clicks a download anchor carrying the filename', async () => {
        const clicked: HTMLAnchorElement[] = []
        const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click')
            .mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this) })

        try {
            const root = document.createElement('div')
            const { bridge } = makeBridge({
                'settings.get': { settings: createDefaultSettings() },
                'cartridge.export': { file: '{"a":1}', filename: 'my-setup.json' },
            })
            mountPanel(root, bridge, makeHost().host)
            await settle()

            button(root, 'Export cartridge').click()
            await settle()

            expect(clicked).toHaveLength(1)
            expect(clicked[0]!.download).toBe('my-setup.json')
            expect(clicked[0]!.href).toMatch(/^blob:/)
        } finally {
            spy.mockRestore()
        }
    })

    it('does not revoke the object URL out from under the download', async () => {
        // The regression this guards: revoking in the same tick as click()
        // cancels the download before the browser has read the blob, and
        // fails silently — the status line still says "exported" and no file
        // ever appears. Worse with "ask where to save each file" turned on,
        // where the URL must outlive a dialog.
        const root = document.createElement('div')
        const { bridge } = makeBridge({
            'settings.get': { settings: createDefaultSettings() },
            'cartridge.export': { file: '{}', filename: 'my-setup.json' },
        })
        mountPanel(root, bridge, makeHost().host)
        await settle()

        button(root, 'Export cartridge').click()
        await settle()

        expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    })

    it('does not leave the download anchor in the page', async () => {
        const root = document.createElement('div')
        const { bridge } = makeBridge({
            'settings.get': { settings: createDefaultSettings() },
            'cartridge.export': { file: '{}', filename: 'my-setup.json' },
        })
        mountPanel(root, bridge, makeHost().host)
        await settle()

        button(root, 'Export cartridge').click()
        // Two ticks: one for the export round trip to land, one for the
        // anchor's own deferred removal.
        await settle()
        await settle()

        expect(document.querySelectorAll('a[download]')).toHaveLength(0)
    })

    it('confirms before loading a cartridge, because a load is not undoable', async () => {
        const root = document.createElement('div')
        const { bridge, requests } = makeBridge({
            'settings.get': { settings: createDefaultSettings() },
            'cartridge.import': { settings: { ...createDefaultSettings(), cyoaConfig: { ...(createDefaultSettings().cyoaConfig as object), useCustomPrompt: true, customPromptText: 'Three choices, one of them rash.' } }, name: 'Vellmoor' },
        })
        const { host, showConfirm } = makeHost(true)
        mountPanel(root, bridge, host)
        await settle()
        const customBox = () => root.querySelector('[data-lh-field="cyoa-useCustomPrompt"]') as HTMLInputElement
        expect(customBox().checked).toBe(false)

        button(root, 'Import cartridge…').click()
        await settle()

        expect(showConfirm).toHaveBeenCalled()
        expect(requests.some((r) => r.op === 'cartridge.import')).toBe(true)
        expect(root.querySelector('.lh-status')!.textContent).toMatch(/Vellmoor/)
        // Every editor follows the cartridge, not only the five the first draft re-seeded (43).
        expect(customBox().checked).toBe(true)
        expect((root.querySelector('[data-lh-field="cyoa-customPromptText"]') as HTMLTextAreaElement).value).toBe('Three choices, one of them rash.')
    })

    it('does not import when the user cancels the confirmation', async () => {
        const root = document.createElement('div')
        const { bridge, requests } = makeBridge({ 'settings.get': { settings: createDefaultSettings() } })
        mountPanel(root, bridge, makeHost(false).host)
        await settle()

        button(root, 'Import cartridge…').click()
        await settle()

        expect(requests.some((r) => r.op === 'cartridge.import')).toBe(false)
    })

    it('empties itself on teardown', async () => {
        const root = document.createElement('div')
        const { bridge } = makeBridge({ 'settings.get': { settings: createDefaultSettings() } })
        const panel = mountPanel(root, bridge, makeHost().host)
        await settle()

        panel.destroy()
        expect(root.children).toHaveLength(0)
    })
})

describe('the cartridge buttons (47a)', () => {
    it('head the settings under a Cartridges title, not the panel', async () => {
        const { bridge } = makeBridge({ 'settings.get': { settings: createDefaultSettings() } })
        const root = document.createElement('div')
        mountPanel(root, bridge, makeHost().host)
        await settle()

        const box = root.querySelector('.lh-body .lh-cartridges') as HTMLElement
        expect(box).not.toBeNull()
        // A folding card of its own since 82, in the look of the cards around it.
        const card = box.closest('details') as HTMLDetailsElement
        expect(card.getAttribute('data-lh-card')).toBe('cartridges')
        expect(card.querySelector('.lh-card-title')!.textContent).toBe('Cartridges')
        expect(card.querySelector('.lh-chevron')).not.toBeNull()
        expect(card.open).toBe(false)
        expect(box.contains(button(root, 'Import cartridge…'))).toBe(true)
        expect(box.contains(button(root, 'Export cartridge'))).toBe(true)
        // Nothing above the version line but the status.
        expect(root.firstElementChild!.classList.contains('lh-actions')).toBe(false)
        // The settings still mount beside them, not over them; the Layout card
        // (47b, a card since 82) sits above them — both inside General & visuals since 63.
        expect(card.previousElementSibling!.getAttribute('data-lh-card')).toBe('layout')
        expect(box.closest('.lh-category')!.getAttribute('data-lh-category')).toBe('general')
        expect(box.closest('.lh-body')).not.toBeNull()
    })
})

describe('the two tabs and the layout select (47b)', () => {
    // Lesson 60, held by text since happy-dom reads the attribute and not the sheet: the bar's and the
    // Change Log's `display: flex` would beat `hidden` without these rules (78d).
    it('hides the instruction bar and the Change Log by rule, since their flex display would beat the attribute', () => {
        expect(PANEL_CSS).toContain('.adventuretime-panel .lh-direct[hidden] { display: none; }')
        expect(PANEL_CSS).toContain('.adventuretime-panel .lh-change-log[hidden] { display: none; }')
    })

    it('puts the play parts in the first root, and the status, the dice line, the version line and the settings in the second', async () => {
        const { bridge } = makeBridge({ 'settings.get': { settings: createDefaultSettings() } })
        const root = document.createElement('div')
        const rest = document.createElement('div')
        const panel = mountPanel(root, bridge, makeHost().host, { rest })
        await settle()

        // The dice line under the status line of the settings tab since 78d.
        expect(root.querySelector('.lh-dice-line')).toBeNull()
        expect(root.querySelector('.lh-tracker-head')).not.toBeNull()
        expect(root.querySelector('.lh-diagnostics')).toBeNull()
        expect(root.querySelector('.lh-body')).toBeNull()
        expect(Array.from(rest.children).slice(0, 3).map((n) => n.className.split(' ')[0])).toEqual(['lh-status', 'lh-dice-line', 'lh-diagnostics'])
        expect(rest.querySelector('.lh-diagnostics')).not.toBeNull()
        expect(rest.querySelector('.lh-problem')).not.toBeNull()
        // The styles are scoped to this class; without it the second tab is
        // bare text (47b-bis).
        expect(rest.classList.contains('adventuretime-panel')).toBe(true)
        expect(root.classList.contains('adventuretime-panel')).toBe(true)
        expect(rest.querySelector('.lh-body .lh-cartridges')).not.toBeNull()
        // The Lorebook Agent pane is a play part since 78a; the campaign's name and books are its Campaign drawer's (78b).
        expect(root.querySelector('.lh-agent')).not.toBeNull()
        expect(rest.querySelector('.lh-agent')).toBeNull()
        expect(root.querySelector('.lh-agent [data-lh-field="agent-campaign"] [data-lh-field="campaign"]')).not.toBeNull()
        // The World skeleton is the World progression category's (78b), its first card since 82, among the dials' cards.
        expect(rest.querySelector('[data-lh-category="world"] .lh-skeleton')).not.toBeNull()
        const worldCards = Array.from(rest.querySelectorAll('[data-lh-category="world"] .lh-dials .lh-dial-card')).map((c) => c.getAttribute('data-lh-card'))
        expect(worldCards).toEqual(['skeleton', 'rotation', 'timing', 'injection', 'history'])
        // The Agent modules and Custom tags editors are the Modular Repertoire drawer's, out of the settings (78a).
        await settle()
        const rows = Array.from(root.querySelectorAll('.lh-agent [data-lh-field="agent-repertoire"] .lh-repertoire .lh-row-editor'))
        expect(rows.map((r) => r.querySelector('.lh-label-text')!.textContent)).toEqual(['Agent modules', 'Custom tags'])
        expect(rest.querySelector('.lh-row-editor [data-lh-field^="agent-module-enabled-"]')).toBeNull()
        expect(root.querySelector('.lh-repertoire [data-lh-field^="agent-module-enabled-"]')).not.toBeNull()

        panel.destroy()
        expect(root.children.length).toBe(0)
        expect(rest.children.length).toBe(0)
    })

    it('offers no layout select since 82: the Layout box is a folding card that opens on what the widgets do', async () => {
        const { bridge, requests } = makeBridge({ 'settings.get': { settings: createDefaultSettings() }, 'prefs.get': { prefs: { messageCards: true, bars: {}, layout: 'tabs' } } })
        const root = document.createElement('div')
        mountPanel(root, bridge, makeHost().host)
        await settle()

        expect(root.querySelector('.lh-layout select[data-lh-field="layout"]')).toBeNull()
        expect(root.querySelector('.lh-layout')!.textContent).toContain('The tracker is one floating box')
        // The search heads the settings (63), the layout card the first category, after the version twin and Core & Branching (81).
        expect(root.querySelector('.lh-body .lh-settings')!.firstElementChild!.classList.contains('lh-search')).toBe(true)
        const card = root.querySelector('[data-lh-category="general"] .lh-category-body')!.children[2] as HTMLDetailsElement
        expect(card.getAttribute('data-lh-card')).toBe('layout')
        // Multihog's name since 84: UI Appearance, with its palette.
        expect(card.querySelector('.lh-card-title')!.textContent).toBe('UI Appearance')
        expect(card.querySelector('.lh-card-icon')!.textContent).toBe('🎨')
        expect(card.contains(root.querySelector('.lh-layout'))).toBe(true)
        expect(card.open).toBe(false)
        // Nothing writes the layout preference any more.
        expect(requests.filter((r) => r.op === 'prefs.patch')).toHaveLength(0)
    })
})

describe('the widgets\' slots and buttons (47c)', () => {
    it('hands the scene root to the tracker and draws the show buttons when there are widgets', async () => {
        const { bridge } = makeBridge({ 'settings.get': { settings: createDefaultSettings() } })
        const root = document.createElement('div')
        const rest = document.createElement('div')
        const scene = document.createElement('div')
        const shown: string[] = []
        const trackerHead = document.createElement('div')
        const trackerFoot = document.createElement('div')
        const toggled: string[] = []
        let resets = 0
        const panel = mountPanel(root, bridge, makeHost().host, { rest, scene, trackerHead, trackerFoot, widgets: { show: (which) => { shown.push(which) }, toggle: (which) => { toggled.push(which) }, reset: () => { resets += 1 } } })
        await settle()

        expect(scene.classList.contains('adventuretime-panel')).toBe(true)
        expect(scene.querySelector('.lh-widget-tabs')).not.toBeNull()
        // The tracker's head goes in the strip when one is given (57), and leaves with the panel.
        expect(trackerHead.querySelector('.lh-tracker-head')).not.toBeNull()
        expect(root.querySelector('.lh-tracker-head')).toBeNull()
        // And the XP bar at the bottom goes in the foot (74f).
        expect(trackerFoot.querySelector('.lh-bottom-xp')).not.toBeNull()
        expect(root.querySelector('.lh-bottom-xp')).toBeNull()
        expect(scene.querySelector('.lh-maps')).not.toBeNull()
        expect(root.querySelector('.lh-maps')).toBeNull()

        const buttons = rest.querySelector('.lh-widget-buttons') as HTMLElement
        expect(buttons.hidden).toBe(false)
        // The buttons toggle (67), and a third puts both boxes back.
        button(rest, 'Toggle the tracker widget').click()
        button(rest, 'Toggle the map, scene and relationships widget').click()
        expect(toggled).toEqual(['tracker', 'scene'])
        expect(shown).toEqual([])
        button(rest, 'Reset the widgets’ positions').click()
        expect(resets).toBe(1)

        panel.destroy()
        expect(scene.children.length).toBe(0)
        expect(trackerHead.children.length).toBe(0)
        expect(trackerFoot.children.length).toBe(0)
    })

    it('draws the cards tick off while the preference is absent: off as it ships since 82', async () => {
        const { bridge } = makeBridge({ 'settings.get': { settings: createDefaultSettings() }, 'prefs.get': { prefs: { bars: {} } } })
        const root = document.createElement('div')
        mountPanel(root, bridge, makeHost().host)
        await settle()

        expect((root.querySelector('input[data-lh-field="message-cards"]') as HTMLInputElement).checked).toBe(false)
    })

    it('hides the widget buttons when there are no widgets', async () => {
        const { bridge } = makeBridge({ 'settings.get': { settings: createDefaultSettings() } })
        const root = document.createElement('div')
        mountPanel(root, bridge, makeHost().host)
        await settle()

        expect((root.querySelector('.lh-widget-buttons') as HTMLElement).hidden).toBe(true)
    })

    it('shows the cards switch under General & visuals as the preference stands, saves it, follows the event, and puts the box back when the write fails (67)', async () => {
        const { bridge, requests, emit } = makeBridge({ 'settings.get': { settings: createDefaultSettings() }, 'prefs.get': { prefs: { messageCards: false, bars: {}, layout: 'tabs' } }, 'prefs.patch': { prefs: {} } })
        const root = document.createElement('div')
        mountPanel(root, bridge, makeHost().host)
        await settle()

        const box = root.querySelector('.lh-layout input[data-lh-field="message-cards"]') as HTMLInputElement
        expect(box).not.toBeNull()
        expect(box.checked).toBe(false)
        box.checked = true
        box.dispatchEvent(new Event('change'))
        await settle()
        expect(requests.find((r) => r.op === 'prefs.patch')?.params).toEqual({ patch: { messageCards: true } })
        expect(root.querySelector('.lh-status')?.textContent).toBe('Cards will show under each message.')

        emit('prefs.changed', { prefs: { messageCards: false } })
        expect(box.checked).toBe(false)

        vi.spyOn(bridge, 'request').mockRejectedValueOnce(new Error('no connection'))
        box.checked = true
        box.dispatchEvent(new Event('change'))
        await settle()
        expect(box.checked).toBe(false)
        expect(root.querySelector('.lh-problem-text')?.textContent).toBe('no connection')
    })

    it('keeps the widgets’ toggle and reset buttons in the Layout card with no layout select (82)', async () => {
        const { bridge, requests } = makeBridge({ 'settings.get': { settings: createDefaultSettings() }, 'prefs.get': { prefs: { messageCards: true, bars: {}, layout: 'classic' } } })
        const root = document.createElement('div')
        mountPanel(root, bridge, makeHost().host)
        await settle()

        expect(root.querySelector('.lh-layout select[data-lh-field="layout"]')).toBeNull()
        expect(root.querySelector('[data-lh-card="layout"] .lh-widget-buttons')).not.toBeNull()
        // A stored classic or tabs preference is not offered back, and nothing writes the key.
        expect(requests.filter((r) => r.op === 'prefs.patch')).toHaveLength(0)
    })
})


describe('the agent\'s editors (47e)', () => {
    function withAgent() {
        const settings = createDefaultSettings()
        settings.routerModules = { npc: { enabled: true, tag: 'NPC', format: 'Name | Description | Keywords', instruction: 'Named people.' }, loc: { enabled: false, tag: 'LOC', format: 'Name | Description | Keywords', instruction: 'Places.' } }
        settings.routerCustomTags = [{ tag: 'SHIP', instruction: 'Vessels.', format: 'Name | Description | Keywords' }]
        return settings
    }

    it('sends a module switch and an instruction as patches of the whole map, and shows the factory\'s badge', async () => {
        const root = document.createElement('div')
        const settings = withAgent()
        const { bridge, requests } = makeBridge({
            'settings.get': { settings },
            'settings.patch': { settings },
            'settings.factory': { stockPrompts: {}, routerModules: { npc: { instruction: 'Named people, the stock way.' }, loc: { instruction: 'Places.' } } },
        })
        mountPanel(root, bridge, makeHost().host)
        await settle()
        await settle()

        // The factory's text differs for NPC and not for LOC.
        const rows = Array.from(root.querySelectorAll('.lh-tm-row')).filter((r) => r.querySelector('[data-lh-field^="agent-module-enabled-"]'))
        expect(rows.length).toBe(2)
        expect(rows[0]!.querySelector('.lh-tm-badge--edited')).not.toBeNull()
        expect(rows[1]!.querySelector('.lh-tm-badge--edited')).toBeNull()

        const box = root.querySelector('[data-lh-field="agent-module-enabled-loc"]') as HTMLInputElement
        box.checked = true
        box.dispatchEvent(new Event('change'))
        await settle()
        const patch = requests.filter((r) => r.op === 'settings.patch').at(-1)
        const sent = (patch!.params as { patch: Record<string, unknown> }).patch
        expect(Object.keys(sent)).toEqual(['routerModules'])
        expect((sent.routerModules as Record<string, { enabled: boolean }>).loc!.enabled).toBe(true)
        expect((sent.routerModules as Record<string, { instruction: string }>).npc!.instruction).toBe('Named people.')
    })

    it('sends a custom tag change as a patch of the whole list, and re-seeds from what comes back', async () => {
        const root = document.createElement('div')
        const settings = withAgent()
        const after = withAgent()
        after.routerCustomTags = [{ tag: 'SHIP', instruction: 'Vessels.', format: 'Name | Description | Keywords' }, { tag: 'RUMOUR', instruction: '', format: 'Name | Description | Keywords' }]
        const { bridge, requests } = makeBridge({
            'settings.get': { settings },
            'settings.patch': { settings: after },
            'settings.factory': { stockPrompts: {}, routerModules: {} },
        })
        mountPanel(root, bridge, makeHost().host)
        await settle()

        // A stock tag is refused from the first draw, against the modules the settings carry.
        const first = root.querySelector('[data-lh-field="custom-tag-name-0"]') as HTMLInputElement
        first.value = 'npc'
        first.dispatchEvent(new Event('change'))
        expect(root.querySelector('.lh-ct-error')!.textContent).toContain('shipped')
        expect(requests.some((r) => r.op === 'settings.patch')).toBe(false)

        ;(root.querySelector('[data-lh-field="custom-tag-add"]') as HTMLButtonElement).click()
        await settle()
        const patch = requests.filter((r) => r.op === 'settings.patch').at(-1)
        const sent = (patch!.params as { patch: { routerCustomTags: Array<{ tag: string }> } }).patch
        expect(Object.keys(sent)).toEqual(['routerCustomTags'])
        expect(sent.routerCustomTags.map((t) => t.tag)).toEqual(['SHIP', ''])

        // A stock tag is refused against the modules the settings carry.
        const name = root.querySelector('[data-lh-field="custom-tag-name-1"]') as HTMLInputElement
        name.value = 'loc'
        name.dispatchEvent(new Event('change'))
        expect(root.querySelector('.lh-ct-error')!.textContent).toContain('shipped')
    })
})

describe('the settings in Multihog’s categories (63)', () => {
    const PREFS = { messageCards: true, bars: {}, layout: 'tabs', trackerConnectionId: 'conn-1', agentConnectionId: '', scenePictureConnectionId: 'img-1', portraitConnectionId: '' }
    const answers = () => ({
        'settings.get': { settings: createDefaultSettings() },
        'prefs.get': { prefs: PREFS },
        'prefs.patch': { prefs: PREFS },
        'status.get': { version: '1.0.0-beta.5', host: '1.2.0', checked: true, granted: ['a'], missing: [], dice: { registered: false, mode: 'off' } },
        'connections.list': { connections: [{ id: 'conn-1', name: 'Main', model: 'deepseek', isDefault: true }] },
        'scene.connections': { connections: [{ id: 'img-1', name: 'Swarm', provider: 'swarmui', model: 'anima', isDefault: true }] },
    })
    const category = (root: HTMLElement, id: string) => root.querySelector(`[data-lh-category="${id}"]`) as HTMLDetailsElement
    const titles = (node: Element) => Array.from(node.querySelectorAll('.lh-section-title')).map((t) => t.textContent)

    it('draws the seven folds in order, each holding its sections, the layout, the cartridges and the version line’s twin under General', async () => {
        const root = document.createElement('div')
        const { bridge } = makeBridge(answers())
        mountPanel(root, bridge, makeHost().host)
        await settle()
        await settle()
        expect(Array.from(root.querySelectorAll('.lh-category')).map((c) => c.getAttribute('data-lh-category'))).toEqual(['general', 'connections', 'systems', 'tracker', 'agent', 'maps', 'world'])
        expect(titles(category(root, 'general'))).toEqual(['CYOA Mode', 'Portraits and location images'])
        expect(titles(category(root, 'tracker'))).toEqual(['State Tracker'])
        expect(titles(category(root, 'agent'))).toEqual(['Character Sheets', 'Lorebook Agent'])
        // Multihog's Game Systems tab (70): the narrator's block first, the systems, then the control room's rulebook.
        expect(titles(category(root, 'systems'))).toEqual(['Narrator configuration', 'Game Systems & Custom Fields', 'The narrator’s rulebook'])
        expect(titles(category(root, 'maps'))).toEqual(['Map Architect'])
        expect(titles(category(root, 'world'))).toEqual(['World Progression'])
        const general = category(root, 'general').querySelector('.lh-category-body')!
        expect(general.children[0]!.classList.contains('lh-version-twin')).toBe(true)
        expect(general.children[0]!.textContent).toContain('AdventureTime 1.0.0-beta.5')
        // Core & Branching (81), Multihog's first drawer, is the first card; the Layout and Cartridges cards (82) follow.
        expect(general.children[1]!.getAttribute('data-lh-card')).toBe('core-branching')
        expect(general.children[2]!.getAttribute('data-lh-card')).toBe('layout')
        expect(general.children[3]!.getAttribute('data-lh-card')).toBe('cartridges')
        // Nothing of the settings sits outside a category.
        expect(root.querySelectorAll('.lh-settings > .lh-section')).toHaveLength(0)
    })

    it('mounts the NPC and PC sections editors on the Character Sheets card, a save going through settings.sections and fetching the factory again (77)', async () => {
        const root = document.createElement('div')
        const canned = answers() as Record<string, unknown>
        canned['settings.sections'] = { settings: { ...createDefaultSettings(), npcCoreSections: [{ id: 'sec_species', name: 'Lineage', description: '', icon: '', color: '#0ea5e9' }] }, rebuilt: ['npc', 'loc', 'fac'], kept: [] }
        canned['settings.factory'] = { stockPrompts: {}, routerModules: {} }
        const { bridge, requests } = makeBridge(canned)
        mountPanel(root, bridge, makeHost().host)
        await settle()
        await settle()
        const sheets = category(root, 'agent')
        expect(sheets.querySelector('[data-lh-field="sections-editor-npc"]')).not.toBeNull()
        expect(sheets.querySelector('[data-lh-field="sections-editor-pc"]')).not.toBeNull()
        expect(Array.from(sheets.querySelectorAll('.lh-managed')).map((n) => n.textContent).filter((t) => t?.includes('not built yet'))).toEqual([])
        // The preset rows are hidden: the editors carry the presets.
        expect(sheets.querySelector('[data-lh-field="npcSectionPresets"]')).toBeNull()
        const npc = sheets.querySelector('[data-lh-field="sections-editor-npc"]') as HTMLElement
        const name = npc.querySelector('.lh-sec-name') as HTMLInputElement
        name.value = 'Lineage'
        name.dispatchEvent(new Event('input', { bubbles: true }))
        requests.length = 0
        ;(npc.querySelector('button[aria-label="Save the sections"]') as HTMLButtonElement).click()
        await settle()
        await settle()
        expect(requests.map((r) => r.op)).toEqual(['settings.sections', 'settings.factory'])
        expect(requests[0]!.params).toMatchObject({ kind: 'npc' })
        expect(((requests[0]!.params as { sections: Array<{ name: string }> }).sections)[0]!.name).toBe('Lineage')
        expect(npc.querySelector('[data-lh-field="sections-note"]')!.textContent).toContain('npc, loc, fac instructions rebuilt')
    })

    it('reads the connections into their category on load and when a preference changes elsewhere; the lists are asked when it is opened', async () => {
        const root = document.createElement('div')
        const { bridge, requests, emit } = makeBridge(answers())
        mountPanel(root, bridge, makeHost().host)
        await settle()
        await settle()
        const tracker = root.querySelector('[data-lh-field="connection-tracker"] select') as HTMLSelectElement
        expect(tracker.value).toBe('conn-1')
        // The tracker's own folds ask for the text connections on mount; the category asks only when opened.
        const before = requests.filter((r) => r.op === 'connections.list').length
        expect(requests.some((r) => r.op === 'scene.connections')).toBe(false)
        const fold = category(root, 'connections')
        fold.open = true
        fold.dispatchEvent(new Event('toggle'))
        await settle()
        await settle()
        await settle()
        expect(requests.filter((r) => r.op === 'connections.list')).toHaveLength(before + 1)
        expect(requests.filter((r) => r.op === 'scene.connections')).toHaveLength(1)
        expect(Array.from(tracker.options).map((o) => o.textContent)).toEqual([NARRATOR_BLANK, 'Main — deepseek'])
        expect((root.querySelector('[data-lh-field="connection-scene-image"] select') as HTMLSelectElement).value).toBe('img-1')
        emit('prefs.changed', { prefs: { ...PREFS, trackerConnectionId: '', agentConnectionId: 'conn-1' } })
        expect(tracker.value).toBe('')
        expect((root.querySelector('[data-lh-field="connection-agent"] select') as HTMLSelectElement).value).toBe('conn-1')
    })

    it('puts the art styles and the mirrored drawing settings in the portraits section (63b): a style loads through the backend and re-seeds, a mirrored tick saves and asks the check, a swapped prompt re-seeds too', async () => {
        const root = document.createElement('div')
        const loaded = { ...createDefaultSettings(), portraitNpcSystemPrompt: 'Anime!', activePortraitPromptPresetId: 'anime' }
        const { bridge, requests, emit } = makeBridge({
            ...answers(),
            'prefs.get': { prefs: { ...PREFS, portraitAutoParty: true, scenePictureAuto: true, scenePictureTrigger: 'every_n_outputs', scenePictureEveryN: 4 } },
            'portraits.presets.load': { settings: loaded },
            'portraits.auto.check': { drawing: [], queued: [], last: {} },
        })
        mountPanel(root, bridge, makeHost().host)
        await settle()
        await settle()
        const section = Array.from(category(root, 'general').querySelectorAll('.lh-section')).find((s) => s.querySelector('.lh-section-title')!.textContent === 'Portraits and location images') as HTMLElement
        const rowOf = (label: string) => Array.from(section.querySelectorAll('.lh-row')).find((r) => r.querySelector('.lh-label-text')?.textContent === label) as HTMLElement
        expect(rowOf('Active art style').hidden).toBe(true)
        expect(section.querySelectorAll('[data-lh-field="portrait-styles-factory"] .lh-style')).toHaveLength(7)
        // The head (83, Multihog's order): the portraits switch, the prompt editor, the lookback, Auto-generate for,
        // the location block with Show location images, the Real-Time box, the connections' note — the two mirrors'
        // rows laid flat, no fold left, without the connections; the purge at the foot; the prompts under their own card.
        const foot = section.querySelector('[data-lh-field="portraits-head"]') as HTMLElement
        expect(foot.parentElement).toBe(section)
        expect(foot.previousElementSibling!.classList.contains('lh-section-help')).toBe(true)
        expect(section.querySelector('.lh-portraits-drawing')).toBeNull()
        expect(section.querySelector('[data-lh-field="mirror-portrait-settings"]')).toBeNull()
        expect(section.querySelector('[data-lh-field="mirror-scene-picture-settings"]')).toBeNull()
        const fields = Array.from(foot.querySelectorAll('[data-lh-field]')).map((n) => n.getAttribute('data-lh-field'))
        expect(fields).toEqual(['portraits-enabled', 'mirror-portrait-skip-prompt', 'mirror-portrait-lookback', 'mirror-portrait-lookback-count', 'mirror-portrait-auto-player', 'mirror-portrait-auto-party', 'mirror-portrait-auto-enemies', 'mirror-portrait-auto-npcs', 'portraits-location-images', 'mirror-scene-picture-background', 'mirror-scene-picture-npcs', 'portraits-realtime', 'mirror-scene-picture-auto', 'mirror-scene-picture-trigger', 'mirror-scene-picture-every', 'portraits-connections'])
        expect(foot.querySelector('.lh-portraits-realtime-title')!.textContent).toBe('Real-Time Visualization Mode')
        expect((foot.querySelector('[data-lh-field="portraits-enabled"]') as HTMLInputElement).checked).toBe(true)
        expect(section.lastElementChild!.getAttribute('data-lh-field')).toBe('portraits-foot')
        expect(section.querySelector('[data-lh-field="portraits-purge"]')!.textContent).toBe('🗑 Emergency: purge all portraits')
        const promptsFold = section.querySelector('[data-lh-fold="Portrait prompt templates"]') as HTMLDetailsElement
        expect(promptsFold.open).toBe(false)
        expect(promptsFold.querySelector('.lh-card-title')!.textContent).toBe('Portrait prompt templates')
        expect(Array.from(promptsFold.querySelectorAll('.lh-row .lh-label-text')).map((n) => n.textContent)).toEqual(['NPC portrait prompt', 'Character portrait prompt', 'Location portrait prompt', 'Portrait prompt word target'])
        // The styles row stands before the prompts' card, the card last among the rows.
        expect(promptsFold.previousElementSibling).toBe(rowOf('Portrait and location image styles'))
        expect(promptsFold.nextElementSibling!.getAttribute('data-lh-field')).toBe('portraits-foot')
        expect(foot.querySelector('[data-lh-field="mirror-portrait-connection"]')).toBeNull()
        expect((foot.querySelector('[data-lh-field="mirror-portrait-auto-party"]') as HTMLInputElement).checked).toBe(true)
        expect((foot.querySelector('[data-lh-field="mirror-scene-picture-auto"]') as HTMLInputElement).checked).toBe(true)
        expect((foot.querySelector('[data-lh-field="mirror-scene-picture-every"]') as HTMLInputElement).value).toBe('4')
        expect((foot.querySelector('[data-lh-field="mirror-scene-picture-every"]')!.closest('label') as HTMLElement).hidden).toBe(false)
        // A style loads through the backend, and the answer re-seeds the prompt box and marks the row.
        const npcPrompt = rowOf('NPC portrait prompt').querySelector('textarea') as HTMLTextAreaElement
        expect(npcPrompt.value).toContain('high-quality fantasy portrait')
        ;(section.querySelector('button[aria-label="Load Anime"]') as HTMLButtonElement).click()
        await settle()
        await settle()
        expect(requests.filter((r) => r.op === 'portraits.presets.load').map((r) => r.params)).toEqual([{ id: 'anime' }])
        expect(npcPrompt.value).toBe('Anime!')
        expect(Array.from(section.querySelectorAll('.lh-style--active .lh-style-name')).map((n) => n.textContent)).toEqual(['Anime'])
        // A mirrored tick saves the preference and asks the check for the open chat.
        const enemies = foot.querySelector('[data-lh-field="mirror-portrait-auto-enemies"]') as HTMLInputElement
        enemies.checked = true
        enemies.dispatchEvent(new Event('change'))
        await settle()
        await settle()
        expect(requests.filter((r) => r.op === 'prefs.patch').map((r) => r.params)).toContainEqual({ patch: { portraitAutoEnemies: true } })
        expect(requests.filter((r) => r.op === 'portraits.auto.check').map((r) => r.params)).toEqual([{ chatId: 'chat-1' }])
        // Show location images saves with its rule (80): off takes the auto draw with it. The portraits switch is its own.
        const locations = foot.querySelector('[data-lh-field="portraits-location-images"]') as HTMLInputElement
        locations.checked = false
        locations.dispatchEvent(new Event('change'))
        await settle()
        expect(requests.filter((r) => r.op === 'prefs.patch').map((r) => r.params)).toContainEqual({ patch: { locationImages: false, scenePictureAuto: false } })
        const portraitsTick = foot.querySelector('[data-lh-field="portraits-enabled"]') as HTMLInputElement
        portraitsTick.checked = false
        portraitsTick.dispatchEvent(new Event('change'))
        await settle()
        expect(requests.filter((r) => r.op === 'prefs.patch').map((r) => r.params)).toContainEqual({ patch: { portraitsEnabled: false } })
        // The event every save sends moves the mirrors, and carries the settings when a toggle swapped the prompt.
        emit('prefs.changed', { prefs: { ...PREFS, portraitAutoParty: false, scenePicturePresentNpcs: false, portraitsEnabled: false, locationImages: true }, settings: { ...loaded, portraitLocationSystemPrompt: 'Swapped.' } })
        expect((foot.querySelector('[data-lh-field="mirror-portrait-auto-party"]') as HTMLInputElement).checked).toBe(false)
        expect((foot.querySelector('[data-lh-field="mirror-scene-picture-npcs"]') as HTMLInputElement).checked).toBe(false)
        expect(portraitsTick.checked).toBe(false)
        expect(locations.checked).toBe(true)
        expect((rowOf('Location portrait prompt').querySelector('textarea') as HTMLTextAreaElement).value).toBe('Swapped.')
    })

    it('puts a box of mirrored dials in each category that has them (63c): after the sections, bound to the folds’ keys, following the event', async () => {
        const root = document.createElement('div')
        const { bridge, requests, emit } = makeBridge({
            ...answers(),
            'prefs.get': { prefs: { ...PREFS, trackerRunEvery: 3, agentMaxTurns: 7, mapEvolutionScope: 'count', worldProgressionExclusionList: 'Morrowfen', wizardLookback: 25, creatorLevel: 4 } },
        })
        mountPanel(root, bridge, makeHost().host)
        await settle()
        await settle()
        // The categories' boxes; the Lorebook Agent tab's Quick Settings draw two more outside them (78a).
        const boxes = Array.from(root.querySelectorAll<HTMLElement>('.lh-category .lh-dials'))
        expect(boxes.map((b) => [b.getAttribute('data-lh-dials'), b.closest('.lh-category')!.getAttribute('data-lh-category')])).toEqual([['general', 'general'], ['creator', 'connections'], ['wizard', 'systems'], ['tracker', 'tracker'], ['agent', 'agent'], ['maps', 'maps'], ['world', 'world']])
        // After the sections: the tracker's box follows them, with the rendering tags library (72b) and the Display Groups (75) after it.
        const trackerBody = category(root, 'tracker').querySelector('.lh-category-body')!
        expect(trackerBody.lastElementChild!.getAttribute('data-lh-card')).toBe('display-groups')
        expect(trackerBody.lastElementChild!.previousElementSibling!.getAttribute('data-lh-card')).toBe('tags-library')
        expect(trackerBody.lastElementChild!.previousElementSibling!.previousElementSibling!.classList.contains('lh-dials')).toBe(true)
        expect(trackerBody.firstElementChild!.classList.contains('lh-section')).toBe(true)
        const dial = (key: string) => root.querySelector(`[data-lh-field="dial-${key}"] input, [data-lh-field="dial-${key}"] select`) as HTMLInputElement
        expect(dial('trackerRunEvery').value).toBe('3')
        expect(dial('agentMaxTurns').value).toBe('7')
        expect(dial('worldProgressionExclusionList').value).toBe('Morrowfen')
        expect(dial('wizardLookback').value).toBe('25')
        expect(dial('creatorLevel').value).toBe('4')
        expect((root.querySelector('[data-lh-field="dial-mapEvolutionCount"]') as HTMLElement).hidden).toBe(false)
        // A change saves the one key.
        dial('agentRunEvery').value = '4'
        dial('agentRunEvery').dispatchEvent(new Event('change'))
        await settle()
        expect(requests.filter((r) => r.op === 'prefs.patch').map((r) => r.params)).toContainEqual({ patch: { agentRunEvery: 4 } })
        // The event moves the boxes, and the wizard's own rows under the game systems.
        emit('prefs.changed', { prefs: { ...PREFS, trackerRunEvery: 9, mapEvolutionScope: 'all', wizardLookback: 40 } })
        expect(dial('trackerRunEvery').value).toBe('9')
        expect((root.querySelector('[data-lh-field="dial-mapEvolutionCount"]') as HTMLElement).hidden).toBe(true)
        expect(dial('wizardLookback').value).toBe('40')
        expect((root.querySelector('[data-lh-field="wizard-lookback"]') as HTMLInputElement).value).toBe('40')
    })

    it('draws the narrator’s configuration as a card under Game systems (70), without a reset, writing the cartridge and following a settings change made elsewhere', async () => {
        const root = document.createElement('div')
        const after = { ...createDefaultSettings(), narrativePacing: 'shorter_outputs' }
        const { bridge, requests, emit } = makeBridge({ ...answers(), 'settings.patch': { settings: after } })
        mountPanel(root, bridge, makeHost().host)
        await settle()
        await settle()
        const card = Array.from(category(root, 'systems').querySelectorAll<HTMLDetailsElement>('.lh-section')).find((s) => s.querySelector('.lh-section-title')!.textContent === 'Narrator configuration')!
        expect(card.querySelector('.lh-reset')).toBeNull()
        expect(card.querySelector('.lh-section-editor.lh-nc')).not.toBeNull()
        expect(card.querySelectorAll('.lh-row')).toHaveLength(0)
        // The State Tracker card keeps its reset, and says it covers the narrator's keys; it has no dice rows of its own now.
        const tracker = category(root, 'tracker').querySelector('.lh-section')!
        expect(tracker.querySelector('.lh-reset')).not.toBeNull()
        expect(tracker.querySelector('.lh-section-help')!.textContent).toContain('narrator’s configuration')
        expect(Array.from(tracker.querySelectorAll('.lh-label-text')).map((n) => n.textContent)).not.toContain('RNG mode')
        // The rulebook is the third card of the category, split off the same group.
        const rulebook = Array.from(category(root, 'systems').querySelectorAll<HTMLDetailsElement>('.lh-section')).find((s) => s.querySelector('.lh-section-title')!.textContent === 'The narrator’s rulebook')!
        expect(rulebook.querySelector('.lh-reset')).toBeNull()
        expect(rulebook.querySelector('.lh-rb-list')).not.toBeNull()
        // A pick commits through settings.patch, and the answer re-seeds the block.
        const input = (field: string) => card.querySelector(`[data-lh-field="${field}"] input`) as HTMLInputElement
        input('nc-pacing-shorter_outputs').checked = true
        input('nc-pacing-shorter_outputs').dispatchEvent(new Event('change'))
        await settle()
        expect(requests.filter((r) => r.op === 'settings.patch').at(-1)?.params).toEqual({ patch: { narrativePacing: 'shorter_outputs' } })
        // The opener, a preference, follows the event every save sends.
        emit('prefs.changed', { prefs: { mapArchitectOpener: 'text' } })
        expect(input('nc-opener-text').checked).toBe(true)
        // A settings change announced by the backend — made in the tracker's starting area — re-seeds every editor here.
        emit('settings.changed', { settings: { ...createDefaultSettings(), narrativePacing: 'downtime', syspromptModules: { loot: false } } })
        expect(input('nc-pacing-downtime').checked).toBe(true)
        expect(input('nc-loot').checked).toBe(false)
        const lootRow = Array.from(rulebook.querySelectorAll<HTMLElement>('.lh-rb-row')).find((r) => r.querySelector('.lh-rb-name')!.textContent === 'Loot')!
        expect((lootRow.querySelector('input') as HTMLInputElement).checked).toBe(false)
    })

    it('ends General & visuals with Debug & factory reset under a Developer & reset caption (72a), the switches following the preferences and a reset re-seeding every editor', async () => {
        const root = document.createElement('div')
        const after = { ...createDefaultSettings(), narrativePacing: 'downtime' }
        const { bridge, requests, emit } = makeBridge({ ...answers(), 'prefs.get': { prefs: { ...PREFS, debugLogging: true } }, 'maintenance.resetPrompts': { settings: after } })
        mountPanel(root, bridge, makeHost().host)
        await settle()
        await settle()
        const general = category(root, 'general').querySelector('.lh-category-body')!
        expect(general.lastElementChild!.getAttribute('data-lh-field')).toBe('developer-card')
        expect(general.lastElementChild!.previousElementSibling!.textContent).toBe('Developer & reset')
        // The dials sit right before the caption since 81 (the narrator card's rows moved into Core & Branching).
        expect(general.lastElementChild!.previousElementSibling!.previousElementSibling!.classList.contains('lh-dials')).toBe(true)
        const debug = root.querySelector('[data-lh-field="debug-logging"] input') as HTMLInputElement
        expect(debug.checked).toBe(true)
        emit('prefs.changed', { prefs: { debugLogging: false } })
        expect(debug.checked).toBe(false)
        // A reset asks, runs, and every editor follows the settings that come back.
        ;(root.querySelector('[data-lh-field="reset-prompts"] button') as HTMLButtonElement).click()
        await settle()
        await settle()
        expect(requests.some((r) => r.op === 'maintenance.resetPrompts')).toBe(true)
        const systems = category(root, 'systems')
        expect((systems.querySelector('[data-lh-field="nc-pacing-downtime"] input') as HTMLInputElement).checked).toBe(true)
    })

    it('carries the second pass’s three cards (72b): the narrator card’s rows in Core & Branching (81), the NPC word targets under the agent, the rendering tags under the tracker', async () => {
        const root = document.createElement('div')
        const { bridge, requests, emit } = makeBridge({ ...answers(), 'prefs.get': { prefs: { ...PREFS, narratorCardName: 'Aurelius', npcMajorWords: 300, npcMinorWords: 100 } }, 'narrator.create': { id: 'c9', name: 'Aurelius', created: true }, 'settings.npcWords': { settings: createDefaultSettings(), prefs: PREFS, applied: true } })
        mountPanel(root, bridge, makeHost().host)
        await settle()
        await settle()
        const general = category(root, 'general').querySelector('.lh-category-body')!
        // Core & Branching (81) is the first card after the version line's twin, and holds the narrator rows under Help.
        const core = general.querySelector('[data-lh-card="core-branching"]') as HTMLElement
        expect(core.previousElementSibling!.classList.contains('lh-version-twin')).toBe(true)
        expect(core.querySelector('[data-lh-field="narrator-rows"]')).not.toBeNull()
        expect(core.querySelector('[data-lh-field="remove-all-chats"]')).not.toBeNull()
        expect(core.querySelector('[data-lh-field="clean-orphans"]')).not.toBeNull()
        expect(root.querySelector('[data-lh-field="developer-card"] [data-lh-field="clean-orphans"]')).toBeNull()
        expect(general.lastElementChild!.getAttribute('data-lh-field')).toBe('developer-card')
        const name = root.querySelector('[data-lh-field="narrator-name"]') as HTMLInputElement
        expect(name.value).toBe('Aurelius')
        ;(root.querySelector('[data-lh-field="narrator-create"]') as HTMLButtonElement).click()
        await settle()
        await settle()
        expect(requests.find((r) => r.op === 'narrator.create')?.params).toEqual({ name: 'Aurelius' })
        expect(root.querySelector('[data-lh-field="narrator-note"]')!.textContent).toContain('Aurelius')
        // The NPC word targets under the agent, following the preferences and writing both.
        const agent = category(root, 'agent').querySelector('.lh-category-body')!
        expect(agent.lastElementChild!.getAttribute('data-lh-card')).toBe('npc-words')
        const major = root.querySelector('[data-lh-field="npc-major-words"]') as HTMLInputElement
        expect(major.value).toBe('300')
        emit('prefs.changed', { prefs: { npcMajorWords: 250 } })
        expect(major.value).toBe('250')
        major.value = '275'
        major.dispatchEvent(new Event('change'))
        await settle()
        await settle()
        expect(requests.find((r) => r.op === 'settings.npcWords')?.params).toEqual({ major: 275, minor: 100 })
        expect(root.querySelector('[data-lh-field="npc-words-note"]')!.textContent).toContain('275 words')
        // The rendering tags library under the tracker, read-only.
        const tracker = category(root, 'tracker').querySelector('.lh-category-body')!
        expect(tracker.lastElementChild!.previousElementSibling!.getAttribute('data-lh-card')).toBe('tags-library')
        expect(tracker.lastElementChild!.previousElementSibling!.textContent).toContain('CHARGE')
        // The Display Groups manager after it (75), reading the preferences and the cartridge's custom fields.
        expect(tracker.lastElementChild!.getAttribute('data-lh-card')).toBe('display-groups')
        expect(tracker.lastElementChild!.textContent).toContain('No Display Groups configured.')
    })

    it('offers Multihog’s Panel layout toggle under the layout select (76): Stacked by default, Tab Mode kept as a preference and followed from the event', async () => {
        const { bridge, requests, emit } = makeBridge({ 'settings.get': { settings: createDefaultSettings() }, 'prefs.get': { prefs: { messageCards: true, bars: {}, panelLayoutMode: 'tabs' } }, 'prefs.patch': { prefs: { panelLayoutMode: 'stack' } } })
        const root = document.createElement('div')
        mountPanel(root, bridge, makeHost().host)
        await settle()
        const seg = root.querySelector('.lh-layout [data-lh-field="panelLayoutMode"]')!
        const buttons = Array.from(seg.querySelectorAll('button'))
        expect(buttons.map((b) => b.textContent)).toEqual(['📚 Stacked', '🗂️ Tab Mode (Compact)'])
        expect(buttons.map((b) => b.classList.contains('active'))).toEqual([false, true])
        buttons[0]!.click()
        expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
        await settle()
        expect(requests.find((r) => r.op === 'prefs.patch')?.params).toEqual({ patch: { panelLayoutMode: 'stack' } })
        emit('prefs.changed', { prefs: { panelLayoutMode: 'tabs' } })
        expect(buttons.map((b) => b.classList.contains('active'))).toEqual([false, true])
        emit('prefs.changed', { prefs: { panelLayoutMode: 'sideways' } })
        expect(buttons.map((b) => b.classList.contains('active'))).toEqual([true, false])
    })

    it('feeds the Display Groups (75) to the manager and the section order from the first preference read and from prefs.changed', async () => {
        const root = document.createElement('div')
        const group = { id: 'crew', name: 'Crew', icon: '👥', enabled: true, members: ['PARTY', 'INVENTORY'] }
        const settings = { ...createDefaultSettings(), customFields: [{ tag: 'VEHICLE_FUEL', label: 'Vehicle Fuel', icon: '⛽', prompt: 'Track it.', enabled: true }] }
        const { bridge, emit } = makeBridge({ ...answers(), 'settings.get': { settings }, 'prefs.get': { prefs: { ...PREFS, displayGroupsEnabled: true, displayGroups: [group] } } })
        mountPanel(root, bridge, makeHost().host)
        await settle()
        await settle()
        const card = root.querySelector('[data-lh-card="display-groups"]')!
        // The cartridge's custom field is on the checklist from the first read (75-bis), before any commit seeds the editors.
        ;(card.querySelector('[data-lh-action="display-group-add"]') as HTMLButtonElement).click()
        expect(card.querySelector('.lh-dg-member[value="VEHICLE_FUEL"]')).not.toBeNull()
        ;(card.querySelector('[data-lh-action="display-group-cancel"]') as HTMLButtonElement).click()
        expect((card.querySelector('[data-lh-field="displayGroupsEnabled"]') as HTMLInputElement).checked).toBe(true)
        expect(card.querySelector('[data-lh-group="crew"] .lh-dg-name')!.textContent).toBe('Crew')
        const groupRow = () => root.querySelector('.lh-tm-group')
        expect(groupRow()!.getAttribute('data-lh-group')).toBe('crew')
        expect(groupRow()!.classList.contains('lh-tm-row--off')).toBe(false)
        emit('prefs.changed', { prefs: { displayGroupsEnabled: false } })
        expect(groupRow()!.classList.contains('lh-tm-row--off')).toBe(true)
        expect((card.querySelector('[data-lh-field="displayGroupsEnabled"]') as HTMLInputElement).checked).toBe(false)
        emit('prefs.changed', { prefs: { displayGroups: [] } })
        expect(groupRow()).toBeNull()
        expect(card.textContent).toContain('No Display Groups configured.')
    })

    it('exports and imports a game system as a file (72b): the system with its field and section, re-minted on the way in', async () => {
        const root = document.createElement('div')
        const settings = { ...createDefaultSettings(), gameSystems: [{ id: 's1', name: 'The Trail', customFieldTag: 'TRAIL', enabled: false }, { id: 's2', name: 'Mask Roll', customFieldTag: '', enabled: true }], customFields: [{ tag: 'TRAIL', label: 'Trail', icon: '', prompt: 'Track it.', enabled: false }] } as Record<string, unknown>
        settings.customSyspromptLibrary = [{ id: 'sec-1', title: 'The Trail rules', content: 'Walk.', enabled: true }]
        ;(settings.gameSystems as Array<Record<string, unknown>>)[0]!.syspromptLibraryId = 'sec-1'
        const { bridge, requests } = makeBridge({ ...answers(), 'settings.get': { settings }, 'settings.patch': { settings } })
        const { host, pickFile } = makeHost()
        mountPanel(root, bridge, host)
        await settle()
        const clicked: HTMLAnchorElement[] = []
        const original = HTMLAnchorElement.prototype.click
        HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { clicked.push(this) }
        try {
            ;(root.querySelector('.lh-gs-export') as HTMLButtonElement).click()
        } finally {
            HTMLAnchorElement.prototype.click = original
        }
        expect(clicked).toHaveLength(1)
        expect(clicked[0]!.download).toBe('adventuretime-system-the-trail.json')
        expect(root.querySelector('.lh-status')!.textContent).toContain('Exported the system “The Trail”')
        // An import reads the picked file, mints new ids and a free tag, and commits all three lists.
        const file = { adventuretimeGameSystem: { system: { id: 's1', name: 'The Trail', customFieldTag: 'TRAIL', enabled: true, syspromptLibraryId: 'sec-1' }, field: { tag: 'TRAIL', label: 'Trail', icon: '', prompt: 'Track it.', enabled: true }, section: { id: 'sec-1', title: 'The Trail rules', content: 'Walk.', enabled: true } } }
        pickFile.mockResolvedValueOnce([{ name: 'road.json', bytes: new TextEncoder().encode(JSON.stringify(file)) }])
        ;(root.querySelector('[data-lh-field="gs-import"]') as HTMLButtonElement).click()
        await settle()
        await settle()
        const patch = requests.filter((r) => r.op === 'settings.patch').at(-1)
        const sent = (patch!.params as { patch: Record<string, unknown> }).patch
        expect(Object.keys(sent).sort()).toEqual(['customFields', 'customSyspromptLibrary', 'gameSystems'])
        const systems = sent.gameSystems as Array<Record<string, unknown>>
        expect(systems).toHaveLength(3)
        const imported = systems[2]!
        expect(imported.name).toBe('The Trail')
        expect(imported.id).not.toBe('s1')
        expect(imported.customFieldTag).toBe('TRAIL_2')
        expect((sent.customFields as Array<Record<string, unknown>>).map((f) => f.tag)).toEqual(['TRAIL', 'TRAIL_2'])
        expect(root.querySelector('.lh-status')!.textContent).toContain('Imported the system “The Trail” with its field [TRAIL_2]')
    })

    it('exports, imports and clears the custom fields as files (72b), the clear asking first', async () => {
        const root = document.createElement('div')
        const settings = { ...createDefaultSettings(), gameSystems: [{ id: 's1', name: 'The Trail', customFieldTag: 'TRAIL', enabled: false }, { id: 's2', name: 'Mask Roll', customFieldTag: '', enabled: true }], customFields: [{ tag: 'TRAIL', label: 'Trail', icon: '', prompt: 'Track it.', enabled: false }] } as Record<string, unknown>
        const { bridge, requests } = makeBridge({ ...answers(), 'settings.get': { settings }, 'settings.patch': { settings } })
        const { host, pickFile, showConfirm } = makeHost(true)
        mountPanel(root, bridge, host)
        await settle()
        const clicked: HTMLAnchorElement[] = []
        const original = HTMLAnchorElement.prototype.click
        HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { clicked.push(this) }
        try {
            ;(root.querySelector('[data-lh-field="fields-export"]') as HTMLButtonElement).click()
        } finally {
            HTMLAnchorElement.prototype.click = original
        }
        expect(clicked).toHaveLength(1)
        expect(clicked[0]!.download).toContain('.json')
        pickFile.mockResolvedValueOnce([{ name: 'fields.json', bytes: new TextEncoder().encode(JSON.stringify({ customFields: [{ tag: 'HUNGER', label: 'Hunger', icon: '', prompt: 'Count meals.', enabled: true }] })) }])
        ;(root.querySelector('[data-lh-field="fields-import"]') as HTMLButtonElement).click()
        await settle()
        await settle()
        let patch = requests.filter((r) => r.op === 'settings.patch').at(-1)
        let sent = (patch!.params as { patch: Record<string, unknown> }).patch
        expect((sent.customFields as Array<Record<string, unknown>>).map((f) => f.tag)).toEqual(['TRAIL', 'HUNGER'])
        ;(root.querySelector('[data-lh-field="fields-clear"]') as HTMLButtonElement).click()
        await settle()
        await settle()
        expect(showConfirm).toHaveBeenCalled()
        patch = requests.filter((r) => r.op === 'settings.patch').at(-1)
        sent = (patch!.params as { patch: Record<string, unknown> }).patch
        expect(sent.customFields).toEqual([])
    })

    it('searches the settings: what matches opens, the rest hides, and an empty box shows all again', async () => {
        const root = document.createElement('div')
        const { bridge } = makeBridge(answers())
        mountPanel(root, bridge, makeHost().host)
        await settle()
        const input = root.querySelector('[data-lh-field="settings-search"]') as HTMLInputElement
        input.value = 'd100'
        input.dispatchEvent(new Event('input'))
        // The dice are the narrator's block under Game systems since 70, and its rows are search items.
        expect(category(root, 'systems').hidden).toBe(false)
        expect(category(root, 'systems').open).toBe(true)
        expect(category(root, 'tracker').hidden).toBe(true)
        expect(category(root, 'world').hidden).toBe(true)
        expect(category(root, 'general').hidden).toBe(true)
        const rows = Array.from(category(root, 'systems').querySelectorAll<HTMLElement>('.lh-section .lh-search-item'))
        expect(rows.filter((r) => !r.hidden).map((r) => r.getAttribute('data-lh-field'))).toEqual(['nc-diceD100Mode', 'nc-rngToolD100', 'nc-rngQueueD100'])
        // Inside the advanced fold, which the search opens for them.
        expect((category(root, 'systems').querySelector('[data-lh-field="nc-rng-advanced"]') as HTMLDetailsElement).open).toBe(true)
        input.value = 'cartridge'
        input.dispatchEvent(new Event('input'))
        expect(category(root, 'general').hidden).toBe(false)
        expect((root.querySelector('[data-lh-card="cartridges"]') as HTMLElement).hidden).toBe(false)
        expect((root.querySelector('[data-lh-card="layout"]') as HTMLElement).hidden).toBe(true)
        input.value = ''
        input.dispatchEvent(new Event('input'))
        expect(Array.from(root.querySelectorAll<HTMLElement>('.lh-category')).every((c) => !c.hidden)).toBe(true)
        expect((root.querySelector('[data-lh-card="layout"]') as HTMLElement).hidden).toBe(false)
    })
})

describe('the narrator fold keeps its arrow (72b-bis; a drawer’s chevron since 83)', () => {
    it('draws its own chevron where a flex summary would lose the disclosure marker: the drawer’s rule hides the marker and turns the chevron as the drawer opens', () => {
        // 72b-bis kept the browser's marker by keeping the summary off flex; 83 makes the fold Multihog's drawer,
        // whose summary is flex on purpose and carries a chevron of its own, so the marker is hidden by rule.
        expect(PANEL_CSS).not.toMatch(/\.lh-narrator > summary \{/)
        const rule = PANEL_CSS.match(/\.lh-start-drawer > summary \{([^}]*)\}/)
        expect(rule).not.toBeNull()
        expect(rule![1]).toContain('list-style: none')
        expect(rule![1]).toContain('display: flex')
        expect(PANEL_CSS).toMatch(/\.lh-start-drawer\[open\] > summary \.lh-start-drawer-chevron \{[^}]*rotate/)
        expect(PANEL_CSS).toMatch(/\.lh-narrator-sub \{[^}]*font-size/)
    })
})

describe('the accent follows the theme (68)', () => {
    it('asks the host for its primary accent and its contrast, never a variable the host does not have', () => {
        expect(PANEL_CSS).not.toContain('--lumiverse-accent')
        expect(PANEL_CSS).not.toContain('--lumiverse-on-accent')
        expect(PANEL_CSS).not.toContain('--lumiverse-surface-2')
        // Since 74a the host's variable sits inside AdventureTime's token, so the fallback closes twice, never three times.
        expect(PANEL_CSS).toContain('var(--lh-accent, var(--lumiverse-primary, #d4a940))')
        expect(PANEL_CSS).toContain('var(--lh-accent-contrast, var(--lumiverse-primary-contrast, #10131a))')
        // One fallback hue: Multihog's gold, where three colours stood before.
        expect(PANEL_CSS).not.toContain('var(--lumiverse-primary, #6ea8fe)')
        expect(PANEL_CSS).not.toContain('var(--lumiverse-primary, rgba(')
        // The move left a stray bracket on the seven rgba fallbacks once; a `var()` closes exactly once.
        expect(PANEL_CSS).not.toMatch(/#d4a940\)\)\)/)
        expect(PANEL_CSS).not.toMatch(/#10131a\)\)\)/)
    })
})

describe('the theme layer (74a)', () => {
    it('nests every colour, font and fill the host supplies behind a AdventureTime token, so a root with no theme is the look before', () => {
        // Every use of the host's themed variables sits inside a token's fallback; the radius and the semantic colours stay the host's.
        const bare = PANEL_CSS.replace(/var\(--lh-[a-z-]+, (1px solid )?var\(--lumiverse-/g, '')
        expect(bare).not.toMatch(/var\(--lumiverse-(primary|primary-contrast|border|fill|text|font-mono|bg-elevated|surface)[,)]/)
        expect(PANEL_CSS).toContain('var(--lumiverse-radius, 6px)')
        expect(PANEL_CSS).toContain('var(--lumiverse-danger, #d9534f)')
        // No token nests another: a theme sets each once.
        expect(PANEL_CSS).not.toMatch(/var\(--lh-[a-z-]+, (1px solid )?var\(--lh-/)
        // The root takes the theme's background, blur, text and font, each unset by default.
        const root = PANEL_CSS.match(/\n\.adventuretime-panel \{([^}]*)\}/)![1]!
        expect(root).toContain('background: var(--lh-bg, transparent)')
        expect(root).toContain('backdrop-filter: var(--lh-blur, none)')
        expect(root).toContain('color: var(--lh-text, inherit)')
        expect(root).toContain('font-family: var(--lh-font, inherit)')
        // The cards under the messages carry no root class (lesson 38), so their inner box takes the same.
        const card = PANEL_CSS.match(/\.lh-msg-card-inner \{([^}]*)\}/)![1]!
        expect(card).toContain('color: var(--lh-text, inherit)')
        expect(card).toContain('border: var(--lh-card-border, 1px solid var(--lumiverse-border, rgba(127,127,127,0.25)))')
        expect(card).toContain('background: var(--lh-card-bg, var(--lumiverse-fill, rgba(127,127,127,0.06)))')
        // The roles: the head and the strip take the header's fill, a card's summary the card header's, a button the accent's.
        expect(PANEL_CSS).toMatch(/\.lh-widget-head \{[^}]*background: var\(--lh-header-bg, transparent\)/)
        expect(PANEL_CSS).toMatch(/\.lh-widget-strip \{[^}]*background: var\(--lh-header-bg, transparent\)/)
        expect(PANEL_CSS).toMatch(/\.lh-card > summary \{[^}]*background: var\(--lh-card-header, rgba\(127,127,127,0.08\)\)/)
        expect(PANEL_CSS).toMatch(/\.lh-reset \{[^}]*background: var\(--lh-accent-bg, var\(--lumiverse-fill, rgba\(127,127,127,0.12\)\)\)/)
        expect(PANEL_CSS).toMatch(/\.adventuretime-panel\.lh-prompt-dialog \{[^}]*border: var\(--lh-border, none\); box-shadow: var\(--lh-shadow, none\)/)
        // The five themes' blocks are in the one stylesheet the host is handed.
        expect(PANEL_CSS).toContain('.lh-theme-hacker {')
        expect(PANEL_CSS).toContain('--lh-accent: #f07aaa;')
    })

    it('offers Multihog’s seven themes as a select under the layout, reads the preference onto the body and saves a change', async () => {
        const { bridge, requests, emit } = makeBridge({ 'settings.get': { settings: createDefaultSettings() }, 'prefs.get': { prefs: { messageCards: true, bars: {}, layout: 'tabs', trackerTheme: 'fantasy' } }, 'prefs.patch': { prefs: { trackerTheme: 'hacker' } } })
        const root = document.createElement('div')
        document.body.className = ''
        mountPanel(root, bridge, makeHost().host)
        await settle()

        const select = root.querySelector('.lh-layout select[data-lh-field="trackerTheme"]') as HTMLSelectElement
        expect(select.value).toBe('fantasy')
        expect(Array.from(select.options).map((o) => o.value)).toEqual(['native', 'hacker', 'fantasy', 'hologram', 'pacific', 'cherry', 'custom'])
        expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Match Lumiverse', 'Hacker', 'Fantasy', 'Hologram', 'Pacific Cove', 'Cherry Blossom', '✨ Custom (AI Wizard)'])
        // Custom is the wizard's (74b), and offered.
        expect(select.options[6]!.disabled).toBe(false)
        // The select sits right under the layout's row and hint, before the cards tick.
        const box = root.querySelector('.lh-layout')!
        expect(box.children[1]!.classList.contains('lh-panel-layout-row')).toBe(true)
        expect(box.children[2]).toBe(select.closest('.lh-theme-row'))
        expect(box.children[3]!.classList.contains('lh-section-help')).toBe(true)
        // The theme is a class on the body, where every root sees it.
        expect(document.body.classList.contains('lh-theme-fantasy')).toBe(true)

        select.value = 'hacker'
        select.dispatchEvent(new Event('change'))
        await settle()
        const patch = requests.find((r) => r.op === 'prefs.patch')
        expect(patch?.params).toEqual({ patch: { trackerTheme: 'hacker' } })
        expect(Array.from(document.body.classList).filter((c) => c.startsWith('lh-theme-'))).toEqual(['lh-theme-hacker'])

        // The event every save sends moves it too, as the mirrored dials move; an unknown name is the host's colours.
        emit('prefs.changed', { prefs: { trackerTheme: 'cherry' } })
        expect(select.value).toBe('cherry')
        expect(Array.from(document.body.classList).filter((c) => c.startsWith('lh-theme-'))).toEqual(['lh-theme-cherry'])
        emit('prefs.changed', { prefs: { trackerTheme: 'rt-theme-cherry' } })
        expect(select.value).toBe('native')
        expect(Array.from(document.body.classList).filter((c) => c.startsWith('lh-theme-'))).toEqual(['lh-theme-native'])
    })

    it('runs the AI Theme Wizard under the select: New, Iterate, Undo, the library, the tokens on the body (74b)', async () => {
        const night = { '--rt-custom-accent': '#112233', '--rt-custom-bg': 'rgba(0,0,0,0.9)' }
        const neon = { '--rt-custom-accent': '#ff00aa', '--rt-custom-bg': 'rgba(10,0,20,0.95)' }
        const answers = {
            'settings.get': { settings: createDefaultSettings() },
            'prefs.get': { prefs: { messageCards: true, bars: {}, layout: 'tabs', trackerTheme: 'custom', customTheme: night, savedThemes: { Night: night } } },
            'prefs.patch': { prefs: {} },
            'theme.generate': { theme: neon, iterated: false, missing: ['--rt-custom-shadow'] },
        }
        const { bridge, requests, emit } = makeBridge(answers)
        const root = document.createElement('div')
        document.body.className = ''
        document.body.removeAttribute('style')
        const { host, showConfirm } = makeHost()
        mountPanel(root, bridge, host)
        await settle()

        const box = root.querySelector('[data-lh-field="themeWizard"]') as HTMLElement
        // Custom chosen: the box shows under the select, the stored theme is on the body as tokens, the library lists Night.
        expect(box.hidden).toBe(false)
        expect(root.querySelector('.lh-layout')!.children[4]).toBe(box)
        expect(document.body.classList.contains('lh-theme-custom')).toBe(true)
        expect(document.body.style.getPropertyValue('--lh-custom-accent')).toBe('#112233')
        expect(document.body.style.getPropertyValue('--lh-custom-accent-contrast')).toBe('#f4f4f4')
        expect(Array.from(root.querySelectorAll('[data-lh-theme-load]')).map((b) => b.textContent)).toEqual(['Night'])
        const status = root.querySelector('.lh-theme-wizard-status') as HTMLElement
        const prompt = root.querySelector('[data-lh-field="themeWizardPrompt"]') as HTMLTextAreaElement
        const click = (field: string) => (root.querySelector(`[data-lh-field="${field}"]`) as HTMLButtonElement).click()

        // New with nothing typed asks for a description in the legacy's words, and sends nothing.
        click('themeWizardNew')
        expect(status.textContent).toBe('⚠ Please describe a theme first.')
        expect(status.classList.contains('lh-theme-wizard-status--error')).toBe(true)
        expect(requests.find((r) => r.op === 'theme.generate')).toBeUndefined()
        // New with a description: one call, the theme on the body, the select on Custom, the old theme on the undo stack.
        prompt.value = ' neon noir '
        click('themeWizardNew')
        expect(status.textContent).toBe('⚡ Generating theme.')
        await settle()
        expect(requests.find((r) => r.op === 'theme.generate')?.params).toEqual({ description: 'neon noir', iterate: false })
        expect(document.body.style.getPropertyValue('--lh-custom-accent')).toBe('#ff00aa')
        // A dark magenta accent takes light text on it.
        expect(document.body.style.getPropertyValue('--lh-custom-accent-contrast')).toBe('#f4f4f4')
        expect(status.textContent).toBe('✅ Theme generated! The model left out 1 of the fifteen values; those fall to the host’s.')
        // Iterate sends the flag; the legacy's refining words while it runs.
        click('themeWizardIterate')
        expect(status.textContent).toBe('⚡ Refining theme.')
        await settle()
        expect(requests.filter((r) => r.op === 'theme.generate').at(-1)?.params).toEqual({ description: 'neon noir', iterate: true })
        // Undo twice puts Night back (two steps were pushed), the third says there is nothing left.
        click('themeWizardUndo')
        await settle()
        expect(status.textContent).toBe('Undone last change. (1 steps remaining)')
        click('themeWizardUndo')
        await settle()
        expect(status.textContent).toBe('Undone last change. (0 steps remaining)')
        expect(document.body.style.getPropertyValue('--lh-custom-accent')).toBe('#112233')
        expect(requests.filter((r) => r.op === 'prefs.patch').at(-1)?.params).toEqual({ patch: { customTheme: night, trackerTheme: 'custom' } })
        click('themeWizardUndo')
        expect(status.textContent).toBe('No steps to undo.')

        // Save to Library under a name; a kept name asks first.
        ;(root.querySelector('[data-lh-field="themeWizardName"]') as HTMLInputElement).value = 'Dusk'
        click('themeWizardSave')
        await settle()
        expect(requests.filter((r) => r.op === 'prefs.patch').at(-1)?.params).toEqual({ patch: { savedThemes: { Night: night, Dusk: night } } })
        expect(status.textContent).toBe('Saved "Dusk" to library.')
        expect(Array.from(root.querySelectorAll('[data-lh-theme-load]')).map((b) => b.textContent)).toEqual(['Night', 'Dusk'])
        ;(root.querySelector('[data-lh-field="themeWizardName"]') as HTMLInputElement).value = 'Night'
        click('themeWizardSave')
        await settle()
        expect(showConfirm).toHaveBeenCalledTimes(1)
        // A click on a saved name loads it; the bin asks, then takes it off.
        ;(root.querySelector('[data-lh-theme-load="Dusk"]') as HTMLButtonElement).click()
        await settle()
        expect(status.textContent).toBe('⚡ Loaded library theme: Dusk')
        ;(root.querySelector('[data-lh-theme-delete="Night"]') as HTMLButtonElement).click()
        await settle()
        expect(showConfirm).toHaveBeenCalledTimes(2)
        expect(requests.filter((r) => r.op === 'prefs.patch').at(-1)?.params).toEqual({ patch: { savedThemes: { Dusk: night } } })
        expect(Array.from(root.querySelectorAll('[data-lh-theme-load]')).map((b) => b.textContent)).toEqual(['Dusk'])

        // Another theme chosen: the box hides and the inline tokens come off, so the named theme's class paints.
        const select = root.querySelector('select[data-lh-field="trackerTheme"]') as HTMLSelectElement
        select.value = 'hacker'
        select.dispatchEvent(new Event('change'))
        await settle()
        expect(box.hidden).toBe(true)
        expect(document.body.style.getPropertyValue('--lh-custom-accent')).toBe('')
        // The event every save sends brings Custom back with a new theme in it.
        emit('prefs.changed', { prefs: { trackerTheme: 'custom', customTheme: neon } })
        expect(box.hidden).toBe(false)
        expect(document.body.style.getPropertyValue('--lh-custom-accent')).toBe('#ff00aa')
        // A reply the backend refused is the box's own red line.
        const failing = makeBridge({ ...answers, 'theme.generate': undefined })
        const root2 = document.createElement('div')
        mountPanel(root2, failing.bridge, makeHost().host)
        await settle()
        ;(root2.querySelector('[data-lh-field="themeWizardPrompt"]') as HTMLTextAreaElement).value = 'x'
        ;(root2.querySelector('[data-lh-field="themeWizardNew"]') as HTMLButtonElement).click()
        await settle()
        expect((root2.querySelector('.lh-theme-wizard-status') as HTMLElement).textContent).toMatch(/^❌ /)
    })

    it('offers the day/night cycle as a tick under the wizard’s box, reads it onto the body as a class and saves a change (74c)', async () => {
        const { bridge, requests, emit } = makeBridge({ 'settings.get': { settings: createDefaultSettings() }, 'prefs.get': { prefs: { messageCards: true, bars: {}, layout: 'tabs', dayNightCycle: true } }, 'prefs.patch': { prefs: { dayNightCycle: false } } })
        const root = document.createElement('div')
        document.body.className = ''
        mountPanel(root, bridge, makeHost().host)
        await settle()

        const tick = root.querySelector('.lh-layout input[data-lh-field="dayNightCycle"]') as HTMLInputElement
        expect(tick.checked).toBe(true)
        const box = root.querySelector('.lh-layout')!
        expect(box.children[5]).toBe(tick.closest('.lh-daynight-row'))
        expect(box.children[6]!.textContent).toContain('Seven phases: late night, dawn, morning, midday, afternoon, sunset and night')
        // The switch is a class on the body, where the tracker panel's phase class meets it.
        expect(document.body.classList.contains('lh-daynight')).toBe(true)
        // The stylesheet the host is handed carries the cycle's rules.
        expect(PANEL_CSS).toContain('@property --lh-dn-bg {')
        expect(PANEL_CSS).toContain('.lh-daynight.lh-phase-sunset {')

        tick.checked = false
        tick.dispatchEvent(new Event('change'))
        await settle()
        expect(requests.find((r) => r.op === 'prefs.patch')?.params).toEqual({ patch: { dayNightCycle: false } })
        expect(document.body.classList.contains('lh-daynight')).toBe(false)

        emit('prefs.changed', { prefs: { dayNightCycle: true } })
        expect(tick.checked).toBe(true)
        expect(document.body.classList.contains('lh-daynight')).toBe(true)
        emit('prefs.changed', { prefs: { dayNightCycle: 'yes' } })
        expect(tick.checked).toBe(false)
        expect(document.body.classList.contains('lh-daynight')).toBe(false)
    })

    it('puts the Map Themes card second under Persistent maps, paints the theme on the body from the preferences and follows prefs.changed (74g)', async () => {
        const { bridge, requests, emit } = makeBridge({ 'settings.get': { settings: createDefaultSettings() }, 'prefs.get': { prefs: { messageCards: true, bars: {}, layout: 'tabs', mapTheme: { accent: '#123456', backgroundImage: 'https://host/t.png' }, savedMapThemePresets: { Night: { background: '#010203' } }, activeMapThemePresetId: 'user:Night' } }, 'prefs.patch': { prefs: { mapTheme: { accent: '#abcdef' }, activeMapThemePresetId: '' } } })
        const root = document.createElement('div')
        document.body.removeAttribute('style')
        mountPanel(root, bridge, makeHost().host)
        await settle()

        const maps = root.querySelector('[data-lh-category="maps"]')!
        const cards = Array.from(maps.children).filter((node) => node.classList.contains('lh-card'))
        expect(cards[0]!.classList.contains('lh-quickstart')).toBe(true)
        expect(cards[1]!.classList.contains('lh-map-themes')).toBe(true)
        expect(cards[2]!.classList.contains('lh-maps-guide')).toBe(true)
        const card = cards[1]!
        expect((card.querySelector('[data-lh-field="mapThemePreset"]') as HTMLSelectElement).value).toBe('user:Night')
        expect((card.querySelector('[data-lh-map-color="accent"]') as HTMLInputElement).value).toBe('#123456')
        expect(document.body.style.getPropertyValue('--rt-map-accent')).toBe('#123456')
        expect(document.body.style.getPropertyValue('--rt-map-background-image')).toBe('url("https://host/t.png")')
        expect(PANEL_CSS).toContain('.lh-map-theme-colors {')
        expect(PANEL_CSS).toContain('var(--rt-map-accent, #ffaa00)')

        // A colour settled saves through the panel's bridge, and the answer is drawn.
        const picker = card.querySelector('[data-lh-map-color="route"]') as HTMLInputElement
        picker.value = '#112233'
        picker.dispatchEvent(new Event('change'))
        await settle()
        expect(requests.find((r) => r.op === 'prefs.patch')?.params).toMatchObject({ patch: { mapTheme: { route: '#112233' }, activeMapThemePresetId: '' } })
        expect(document.body.style.getPropertyValue('--rt-map-accent')).toBe('#abcdef')
        // The event every save sends is followed.
        emit('prefs.changed', { prefs: { mapTheme: { accent: '#00ff00' }, activeMapThemePresetId: 'factory:ember' } })
        expect(document.body.style.getPropertyValue('--rt-map-accent')).toBe('#00ff00')
        expect((card.querySelector('[data-lh-field="mapThemePreset"]') as HTMLSelectElement).value).toBe('factory:ember')
    })

    it('offers the XP bar at the bottom as a tick under the day/night one, read from the preference and saved on a change (74f)', async () => {
        const { bridge, requests, emit } = makeBridge({ 'settings.get': { settings: createDefaultSettings() }, 'prefs.get': { prefs: { messageCards: true, bars: {}, layout: 'tabs', xpBarAtBottom: true } }, 'prefs.patch': { prefs: { xpBarAtBottom: false } } })
        const root = document.createElement('div')
        mountPanel(root, bridge, makeHost().host)
        await settle()

        const tick = root.querySelector('.lh-layout input[data-lh-field="xpBarAtBottom"]') as HTMLInputElement
        expect(tick.checked).toBe(true)
        const box = root.querySelector('.lh-layout')!
        expect(box.children[7]).toBe(tick.closest('.lh-xpbar-row'))
        expect(box.children[8]!.textContent).toContain('like an MMO experience bar')
        expect(PANEL_CSS).toContain('.lh-bottom-xp {')

        tick.checked = false
        tick.dispatchEvent(new Event('change'))
        await settle()
        expect(requests.find((r) => r.op === 'prefs.patch')?.params).toEqual({ patch: { xpBarAtBottom: false } })
        expect(tick.checked).toBe(false)

        emit('prefs.changed', { prefs: { xpBarAtBottom: true } })
        expect(tick.checked).toBe(true)
        emit('prefs.changed', { prefs: { xpBarAtBottom: 'yes' } })
        expect(tick.checked).toBe(false)
    })

    it('offers the animated bars’ switch as a tick under the XP bar’s, read from the preference and saved on a change, and carries the legacy’s rules (74h)', async () => {
        const { bridge, requests, emit } = makeBridge({ 'settings.get': { settings: createDefaultSettings() }, 'prefs.get': { prefs: { messageCards: true, bars: {}, layout: 'tabs', animateAllCustomBarChanges: true } }, 'prefs.patch': { prefs: { animateAllCustomBarChanges: false } } })
        const root = document.createElement('div')
        mountPanel(root, bridge, makeHost().host)
        await settle()

        const tick = root.querySelector('.lh-layout input[data-lh-field="animateAllCustomBarChanges"]') as HTMLInputElement
        expect(tick.checked).toBe(true)
        const box = root.querySelector('.lh-layout')!
        expect(box.children[9]).toBe(tick.closest('.lh-animate-bars-row'))
        expect(box.children[9]!.textContent).toContain('Animate changes on every custom bar')
        expect(box.children[10]!.textContent).toContain('A green gain or a red loss')
        expect(PANEL_CSS).toContain('.rt-bar-delta-gain {')
        expect(PANEL_CSS).toContain('.rt-xp-gain-floater {')
        expect(PANEL_CSS).toContain('.rt-barrel-color-control {')
        expect(PANEL_CSS).toContain('.lh-bottom-xp .rt-xp-bar-wrap[data-recolor-id]')

        tick.checked = false
        tick.dispatchEvent(new Event('change'))
        await settle()
        expect(requests.find((r) => r.op === 'prefs.patch')?.params).toEqual({ patch: { animateAllCustomBarChanges: false } })
        expect(tick.checked).toBe(false)

        emit('prefs.changed', { prefs: { animateAllCustomBarChanges: true } })
        expect(tick.checked).toBe(true)
        emit('prefs.changed', { prefs: { animateAllCustomBarChanges: 'yes' } })
        expect(tick.checked).toBe(false)
    })

    it('offers a backdrop per box under the font sizes — upload, clear, an address, the strength — and paints each box’s root from the preference (74d)', async () => {
        const stored = { day: '/images/day.jpg', night: '', strength: 40 }
        const { bridge, requests, emit } = makeBridge({
            'settings.get': { settings: createDefaultSettings() },
            'prefs.get': { prefs: { messageCards: true, bars: {}, layout: 'tabs', trackerBackdrop: stored } },
            'prefs.patch': { prefs: { trackerBackdrop: { day: '', night: '', strength: 40 } } },
            'backdrop.upload': { prefs: { trackerBackdrop: { day: '/images/day.jpg', night: '/images/stored/night.png', strength: 40 } } },
        })
        const root = document.createElement('div')
        const rest = document.createElement('div')
        document.body.className = ''
        const { host, pickFile } = makeHost()
        mountPanel(root, bridge, host, { rest })
        await settle()

        // The roots are marked as the font sizes' are, and the tracker's wears its backdrop; the second box has none.
        expect(root.getAttribute('data-lh-backdrop')).toBe('tracker')
        expect(rest.getAttribute('data-lh-backdrop')).toBe('settings')
        expect(root.classList.contains('lh-backdrop')).toBe(true)
        expect(root.style.getPropertyValue('--lh-backdrop')).toBe('url("/images/day.jpg")')
        expect(root.style.getPropertyValue('--lh-backdrop-night')).toBe('url("/images/day.jpg")')
        expect(root.style.getPropertyValue('--lh-backdrop-strength')).toBe('0.4')
        expect(rest.classList.contains('lh-backdrop')).toBe(false)
        // The rows, in the settings tab: two boxes under the font sizes, before the cards tick.
        const box = rest.querySelector('.lh-layout')!
        expect(box.children[13]!.classList.contains('lh-backdrops')).toBe(true)
        const tracker = rest.querySelector('[data-lh-backdrop-box="tracker"]') as HTMLElement
        expect(tracker.querySelector('.lh-backdrop-title')!.textContent).toBe('Backdrop behind the tracker’s box')
        expect((tracker.querySelector('.lh-backdrop-preview') as HTMLElement).style.backgroundImage).toBe('url("/images/day.jpg")')
        const strength = tracker.querySelector('[data-lh-backdrop-strength="tracker"]') as HTMLInputElement
        expect(strength.value).toBe('40')
        expect(tracker.querySelector('.lh-backdrop-strength-value')!.textContent).toBe('40%')
        expect((tracker.querySelector('[data-lh-backdrop-url="tracker:day"]') as HTMLInputElement).value).toBe('')
        expect((tracker.querySelector('[data-lh-backdrop-url="tracker:night"]') as HTMLInputElement).value).toBe('')
        expect(PANEL_CSS).toContain('.lh-backdrop::before {')

        // Upload the night image: the host's picker, the bytes as a data URL, the op, the answer painted.
        pickFile.mockResolvedValueOnce([{ name: 'night.png', bytes: new Uint8Array([137, 80, 78, 71]) }])
        ;(tracker.querySelector('[data-lh-backdrop-upload="tracker:night"]') as HTMLButtonElement).click()
        await settle()
        await settle()
        const upload = requests.find((r) => r.op === 'backdrop.upload')
        expect(upload?.params).toEqual({ box: 'tracker', slot: 'night', dataUrl: 'data:image/png;base64,iVBORw==', filename: 'night.png' })
        expect(pickFile).toHaveBeenLastCalledWith({ accept: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], maxSizeBytes: 8 * 1024 * 1024 })
        expect(root.style.getPropertyValue('--lh-backdrop-night')).toBe('url("/images/stored/night.png")')
        expect(tracker.querySelector('.lh-backdrop-note')!.textContent).toBe('The tracker’s box’s night backdrop is set.')

        // The strength moves the box as it is dragged and saves when let go.
        strength.value = '70'
        strength.dispatchEvent(new Event('input'))
        expect(root.style.getPropertyValue('--lh-backdrop-strength')).toBe('0.7')
        expect(tracker.querySelector('.lh-backdrop-strength-value')!.textContent).toBe('70%')
        strength.dispatchEvent(new Event('change'))
        expect(requests.filter((r) => r.op === 'prefs.patch').at(-1)?.params).toEqual({ patch: { trackerBackdrop: { day: '/images/day.jpg', night: '/images/stored/night.png', strength: 70 } } })

        // An address that is not https is refused in the legacy's words, without a save; an https one is saved.
        const url = tracker.querySelector('[data-lh-backdrop-url="tracker:day"]') as HTMLInputElement
        const before = requests.length
        url.value = 'ftp://host/a.jpg'
        url.dispatchEvent(new Event('change'))
        expect(requests.length).toBe(before)
        expect(tracker.querySelector('.lh-backdrop-note')!.textContent).toBe('Use an https image URL or upload a file.')
        expect(tracker.querySelector('.lh-backdrop-note')!.classList.contains('lh-backdrop-note--error')).toBe(true)
        url.value = 'https://host/a.jpg'
        url.dispatchEvent(new Event('change'))
        expect(requests.at(-1)?.params).toEqual({ patch: { trackerBackdrop: { day: 'https://host/a.jpg', night: '/images/stored/night.png', strength: 70 } } })
        await settle()
        expect(tracker.querySelector('.lh-backdrop-note')!.textContent).toBe('The tracker’s box’s backdrop is set.')
        // The night row takes an address too (74d-bis), under the same rule, and shows a stored one.
        const nightUrl = tracker.querySelector('[data-lh-backdrop-url="tracker:night"]') as HTMLInputElement
        const beforeNight = requests.length
        nightUrl.value = 'file:///n.jpg'
        nightUrl.dispatchEvent(new Event('change'))
        expect(requests.length).toBe(beforeNight)
        expect(tracker.querySelector('.lh-backdrop-note')!.textContent).toBe('Use an https image URL or upload a file.')
        nightUrl.value = 'https://host/n.jpg'
        nightUrl.dispatchEvent(new Event('change'))
        // (The panel's copy follows the save's answer, which the canned one gave as the cleared day.)
        expect(requests.at(-1)?.params).toEqual({ patch: { trackerBackdrop: { day: '', night: 'https://host/n.jpg', strength: 40 } } })
        emit('prefs.changed', { prefs: { trackerBackdrop: { day: 'https://host/a.jpg', night: 'https://host/n.jpg', strength: 70 } } })
        expect(nightUrl.value).toBe('https://host/n.jpg')
        await settle()
        expect(tracker.querySelector('.lh-backdrop-note')!.textContent).toBe('The tracker’s box’s night backdrop is set.')

        // Clear the day image: the answer takes the class off the root.
        ;(tracker.querySelector('[data-lh-backdrop-clear="tracker:day"]') as HTMLButtonElement).click()
        await settle()
        expect(root.classList.contains('lh-backdrop')).toBe(false)
        expect(root.style.getPropertyValue('--lh-backdrop')).toBe('')

        // The event every save sends paints the second box too.
        emit('prefs.changed', { prefs: { settingsBackdrop: { day: '', night: '/images/n.jpg', strength: 10 } } })
        expect(rest.classList.contains('lh-backdrop')).toBe(true)
        expect(rest.style.getPropertyValue('--lh-backdrop')).toBe('url("/images/n.jpg")')
        expect(rest.style.getPropertyValue('--lh-backdrop-strength')).toBe('0.1')
        const second = rest.querySelector('[data-lh-backdrop-box="settings"]') as HTMLElement
        expect((second.querySelector('.lh-backdrop-preview--night') as HTMLElement).style.backgroundImage).toBe('url("/images/n.jpg")')
    })

    it('offers the two font sizes as sliders under the theme, marks the roots as their boxes, and writes a size on the body (74e)', async () => {
        const { bridge, requests, emit } = makeBridge({ 'settings.get': { settings: createDefaultSettings() }, 'prefs.get': { prefs: { messageCards: true, bars: {}, layout: 'widgets', trackerFontSize: 16, settingsFontSize: 0 } }, 'prefs.patch': { prefs: { trackerFontSize: 20 } } })
        const root = document.createElement('div')
        const rest = document.createElement('div')
        const widget = document.createElement('div')
        widget.className = 'lh-widget'
        const scene = document.createElement('div')
        widget.append(scene)
        document.body.removeAttribute('style')
        mountPanel(root, bridge, makeHost().host, { rest, scene })
        await settle()

        // The roots: this one the tracker's, the second tab and the second widget (its box, not its body) the settings'.
        expect(root.classList.contains('lh-size-tracker')).toBe(true)
        expect(rest.classList.contains('lh-size-settings')).toBe(true)
        expect(widget.classList.contains('lh-size-settings')).toBe(true)
        expect(scene.classList.contains('lh-size-settings')).toBe(false)
        // The two rows sit under the theme's hint, before the cards tick.
        // With a second tab the settings are drawn in it (47b), the layout box among them.
        const box = rest.querySelector('.lh-layout')!
        // After the day/night row and its hint (74c).
        expect(box.children[11]!.classList.contains('lh-font-sizes')).toBe(true)
        const tracker = rest.querySelector('input[data-lh-field="trackerFontSize"]') as HTMLInputElement
        const settings = rest.querySelector('input[data-lh-field="settingsFontSize"]') as HTMLInputElement
        expect([tracker.type, tracker.min, tracker.max]).toEqual(['range', '8', '32'])
        expect(tracker.value).toBe('16')
        expect(tracker.closest('.lh-font-size-row')!.querySelector('.lh-font-size-value')!.textContent).toBe('16px')
        expect(settings.closest('.lh-font-size-row')!.querySelector('.lh-font-size-value')!.textContent).toBe('the host’s')
        expect((rest.querySelector('[data-lh-field="settingsFontSize-reset"]') as HTMLButtonElement).disabled).toBe(true)
        expect((rest.querySelector('[data-lh-field="trackerFontSize-reset"]') as HTMLButtonElement).disabled).toBe(false)
        // The size is a token on the body; the host's size is no token.
        expect(document.body.style.getPropertyValue('--lh-size-tracker')).toBe('16px')
        expect(document.body.style.getPropertyValue('--lh-size-settings')).toBe('')

        // Dragging shows it at once; letting go saves it.
        tracker.value = '20'
        tracker.dispatchEvent(new Event('input'))
        expect(document.body.style.getPropertyValue('--lh-size-tracker')).toBe('20px')
        expect(requests.find((r) => r.op === 'prefs.patch')).toBeUndefined()
        tracker.dispatchEvent(new Event('change'))
        await settle()
        expect(requests.find((r) => r.op === 'prefs.patch')?.params).toEqual({ patch: { trackerFontSize: 20 } })
        expect(tracker.closest('.lh-font-size-row')!.querySelector('.lh-font-size-value')!.textContent).toBe('20px')

        // × asks for the host's size back; the event every save sends moves the other row.
        ;(rest.querySelector('[data-lh-field="trackerFontSize-reset"]') as HTMLButtonElement).click()
        await settle()
        expect(requests.filter((r) => r.op === 'prefs.patch').at(-1)?.params).toEqual({ patch: { trackerFontSize: 0 } })
        emit('prefs.changed', { prefs: { settingsFontSize: 11 } })
        expect(settings.value).toBe('11')
        expect(document.body.style.getPropertyValue('--lh-size-settings')).toBe('11px')
        emit('prefs.changed', { prefs: { settingsFontSize: 0 } })
        expect(document.body.style.getPropertyValue('--lh-size-settings')).toBe('')
        expect(settings.closest('.lh-font-size-row')!.querySelector('.lh-font-size-value')!.textContent).toBe('the host’s')
    })

    it('greys a disabled box visibly, and the prompt dialog’s box is styled as the panel is (73g-bis)', () => {
        // The wizard's count under *or all of them* is disabled; the host's own look only took the arrows away.
        const greyed = PANEL_CSS.match(/\.adventuretime-panel input:disabled[^{]*\{([^}]*)\}/)
        expect(greyed).not.toBeNull()
        expect(greyed![1]).toMatch(/opacity:\s*0\.\d+/)
        // The dialog sits in the host's modal, outside the panel: its rule is on the root class and the box together.
        expect(PANEL_CSS).toMatch(/\.adventuretime-panel\.lh-prompt-dialog \{/)
    })
})

describe('a picture large (Phase 64)', () => {
    it('ships the zoom cursor and the large picture\'s size in the panel\'s one stylesheet, which reaches the cards under the messages too', () => {
        expect(PANEL_CSS).toContain('img[data-lh-large] { cursor: zoom-in; }')
        expect(PANEL_CSS).toContain('.lh-large {')
    })
})
