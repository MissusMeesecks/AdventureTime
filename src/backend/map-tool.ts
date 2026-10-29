/**
 * The map tool the narrator calls by name (roadmap row 9, Phase 34a).
 *
 * `CreateAreaMap` is registered the way the dice tools are (Phase 28c): the
 * schema is the legacy's, registration is extension-wide, and it is asserted
 * afresh before every generation and after every reply, because the host's
 * record and ours can differ invisibly. The switch is the rulebook's mapping
 * section, which is also what tells the narrator the tool exists.
 */

import { CREATE_AREA_MAP_TOOL_NAME, createAreaMapToolRegistration } from '../tracker/architect.js'
import type { DiceToolHost } from './dice-tool.js'
import type { LogApi } from './interceptor.js'

export interface MapToolSync {
    /** Register when the section is on, unregister when it is off; `reassert` re-registers regardless. */
    sync(enabled: boolean, opts?: { reassert?: boolean }): void
    registered(): boolean
    dispose(): void
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

export function createMapToolSync(host: DiceToolHost, log: LogApi): MapToolSync {
    let registered = false
    return {
        sync(enabled, opts = {}) {
            if (!enabled) {
                if (!registered) return
                try {
                    host.unregisterTool(CREATE_AREA_MAP_TOOL_NAME)
                } catch (error) {
                    log.warn(`map: ${CREATE_AREA_MAP_TOOL_NAME} could not be unregistered: ${describe(error)}`)
                }
                registered = false
                return
            }
            if (registered && !opts.reassert) return
            try {
                if (registered || opts.reassert) {
                    try {
                        host.unregisterTool(CREATE_AREA_MAP_TOOL_NAME)
                    } catch {
                        // Nothing to remove is fine; the register below is the point.
                    }
                }
                host.registerTool(createAreaMapToolRegistration())
                registered = true
                if (opts.reassert) log.info(`map: ${CREATE_AREA_MAP_TOOL_NAME} registered afresh`)
            } catch (error) {
                log.warn(`map: ${CREATE_AREA_MAP_TOOL_NAME} could not be registered: ${describe(error)}`)
            }
        },
        registered: () => registered,
        dispose() {
            if (!registered) return
            try {
                host.unregisterTool(CREATE_AREA_MAP_TOOL_NAME)
            } catch {
                // Shutting down; nothing to report to.
            }
            registered = false
        },
    }
}
