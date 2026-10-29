/**
 * A book made once by name (66).
 *
 * Every maker of a campaign book — the agent's writer, the Map Architect, the
 * NPC creator, World Progression — lists the books, finds none under the
 * name, and creates one. The list is read at the start of a run, and a run
 * is long: the architect's two model calls take minutes, the agent's pass
 * its tool turns. In that gap another maker made the book — the agent
 * recorded a place while the architect was drawing — and the second create
 * made a second `<Campaign>_LOC`, which two makers then wrote into, and the
 * maintainer merged by hand (2026-10-17).
 *
 * So a create here is "make it unless it exists": one in-flight make per
 * name and user, and a fresh list before the host is asked, so a stale list
 * at the caller cannot make a twin and two callers in the same second share
 * one make. The name is matched case-blind, as every finder here matches it.
 */

export interface BookMakerDeps {
    list(userId: string | undefined): Promise<Array<{ id: string; name: string }>>
    create(name: string, userId: string | undefined): Promise<{ id: string; name: string }>
    log: { info(message: string): void }
}

export type BookMaker = (name: string, userId: string | undefined) => Promise<{ id: string; name: string }>

export function createBookMaker(deps: BookMakerDeps): BookMaker {
    const inFlight = new Map<string, Promise<{ id: string; name: string }>>()
    return (name, userId) => {
        const wanted = name.trim().toLowerCase()
        const key = `${userId ?? ''}\u0000${wanted}`
        const pending = inFlight.get(key)
        if (pending) return pending
        const make = (async () => {
            const found = (await deps.list(userId)).find((book) => book.name.trim().toLowerCase() === wanted)
            if (found) {
                deps.log.info(`books: "${found.name}" was made meanwhile; not made again`)
                return { id: found.id, name: found.name }
            }
            const made = await deps.create(name, userId)
            return { id: made.id, name: made.name }
        })().finally(() => { inFlight.delete(key) })
        inFlight.set(key, make)
        return make
    }
}
