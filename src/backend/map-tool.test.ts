import { describe, expect, it } from 'vitest'

import { createMapToolSync } from './map-tool.js'

function host() {
    const calls: string[] = []
    return {
        calls,
        registerTool: (tool: { name: string }) => { calls.push(`register ${tool.name}`) },
        unregisterTool: (name: string) => { calls.push(`unregister ${name}`) },
    }
}
const log = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined }

describe('the map tool', () => {
    it('registers while the section is on, only on change unless told to assert afresh, and goes when it is off', () => {
        const h = host()
        const sync = createMapToolSync(h, log as never)
        sync.sync(false)
        expect(h.calls).toEqual([])
        sync.sync(true)
        sync.sync(true)
        expect(h.calls).toEqual(['register CreateAreaMap'])
        expect(sync.registered()).toBe(true)
        sync.sync(true, { reassert: true })
        expect(h.calls).toEqual(['register CreateAreaMap', 'unregister CreateAreaMap', 'register CreateAreaMap'])
        sync.sync(false)
        expect(h.calls.at(-1)).toBe('unregister CreateAreaMap')
        expect(sync.registered()).toBe(false)
        sync.sync(true)
        sync.dispose()
        expect(h.calls.at(-1)).toBe('unregister CreateAreaMap')
        expect(sync.registered()).toBe(false)
    })

    it('survives a host that refuses, and says nothing is registered', () => {
        const h = host()
        h.registerTool = () => { throw new Error('PERMISSION_DENIED: tools') }
        const sync = createMapToolSync(h, log as never)
        sync.sync(true)
        expect(sync.registered()).toBe(false)
    })
})
