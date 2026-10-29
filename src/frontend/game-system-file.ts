/**
 * A game system as a file (72b, departure 41): Multihog's export and import
 * of one system. A system is three records joined by id — the system itself,
 * its custom field (the tracker half, by `customFieldTag`) and its GM section
 * (the narrator half, by `syspromptLibraryId`) — so the file carries all
 * three, and an import mints new ids and a free tag so a system imported
 * twice, or over one of the same name, never collides.
 */

import type { GameSystem } from '../settings/game-systems.js'

export interface GameSystemFile {
    adventuretimeGameSystem: {
        system: GameSystem
        field: Record<string, unknown> | null
        section: Record<string, unknown> | null
    }
}

type Bag = Record<string, unknown>

function list(settings: Bag, key: string): Bag[] {
    return Array.isArray(settings[key]) ? (settings[key] as Bag[]) : []
}

/** The file for one system, or `null` when the settings hold no system of that id. */
export function buildGameSystemFile(settings: Bag, id: string): GameSystemFile | null {
    const system = list(settings, 'gameSystems').find((s) => s.id === id) as GameSystem | undefined
    if (!system) return null
    const field = system.customFieldTag ? list(settings, 'customFields').find((f) => f.tag === system.customFieldTag) ?? null : null
    const section = system.syspromptLibraryId ? list(settings, 'customSyspromptLibrary').find((s) => s.id === system.syspromptLibraryId) ?? null : null
    return { adventuretimeGameSystem: { system: { ...system }, field: field ? { ...field } : null, section: section ? { ...section } : null } }
}

/** A file read back; throws with a reason when it is not one. */
export function readGameSystemFile(text: string): GameSystemFile['adventuretimeGameSystem'] {
    let raw: unknown
    try {
        raw = JSON.parse(text)
    } catch {
        throw new Error('The file is not JSON.')
    }
    // The key written before the rename (0.156.0, `lumihogGameSystem`) is still read.
    const body = raw && typeof raw === 'object' ? (raw as Partial<GameSystemFile>).adventuretimeGameSystem ?? (raw as { lumihogGameSystem?: GameSystemFile['adventuretimeGameSystem'] }).lumihogGameSystem : undefined
    if (!body || typeof body !== 'object' || !body.system || typeof body.system !== 'object' || !String(body.system.name ?? '').trim()) {
        throw new Error('The file holds no game system.')
    }
    return { system: body.system, field: body.field && typeof body.field === 'object' ? body.field : null, section: body.section && typeof body.section === 'object' ? body.section : null }
}

/** A tag no custom field uses: the wanted one, else it with _2, _3… */
export function freeTag(wanted: string, taken: readonly string[]): string {
    const base = (wanted.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_') || 'SYSTEM').slice(0, 40)
    if (!taken.includes(base)) return base
    for (let n = 2; ; n++) {
        const candidate = `${base}_${n}`
        if (!taken.includes(candidate)) return candidate
    }
}

/** The settings patch that adds the file's system under new ids and a free tag: the three lists, each appended to. */
export function importGameSystem(settings: Bag, file: GameSystemFile['adventuretimeGameSystem'], mint: () => string = () => `gs_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`): { patch: Bag; name: string; tag: string | null } {
    const systems = list(settings, 'gameSystems')
    const fields = list(settings, 'customFields')
    const sections = list(settings, 'customSyspromptLibrary')
    const id = mint()
    const system: GameSystem = { ...file.system, id }
    const patch: Bag = {}
    let tag: string | null = null
    if (file.field) {
        tag = freeTag(String(file.field.tag ?? file.system.customFieldTag ?? file.system.name ?? ''), fields.map((f) => String(f.tag ?? '')))
        system.customFieldTag = tag
        patch.customFields = [...fields, { ...file.field, tag }]
    } else {
        delete system.customFieldTag
    }
    if (file.section) {
        const sectionId = `${id}_gm`
        system.syspromptLibraryId = sectionId
        patch.customSyspromptLibrary = [...sections, { ...file.section, id: sectionId }]
    } else {
        delete system.syspromptLibraryId
    }
    patch.gameSystems = [...systems, system]
    return { patch, name: String(system.name ?? ''), tag }
}
