/**
 * The host's one definition of a phone (91, the mobile pass). Lumiverse
 * 1.2.5 reads *mobile* in one place, `frontend/src/lib/mobile.ts`: a
 * coarse pointer, or a viewport 600 px wide or less; every component takes
 * it through one hook, and its stylesheets write the same test as a media
 * query. There is no class on the body an extension could read, so
 * AdventureTime carries the same two lines — a runtime test where a decision
 * is made (the widgets at mount), and the query's text for the
 * stylesheets' one phone block each — rather than a definition of its own.
 */

/** The host's breakpoint: `--lumiverse-btn-*` shrink and the drawer goes full-width at this width or less. */
export const MOBILE_MAX_WIDTH = 600

/** The media query every phone rule sits under: the host's test, as its stylesheets write it. */
export const MOBILE_MEDIA = `(max-width: ${MOBILE_MAX_WIDTH}px), (pointer: coarse)`

/** What the test reads: the window, or enough of one for a test. */
export interface MobileView {
    innerWidth: number
    matchMedia?: (query: string) => { matches: boolean }
}

/** Lumiverse's `isMobileViewportOrDevice()`: a coarse pointer, or a narrow viewport. */
export function isMobileViewportOrDevice(view: MobileView): boolean {
    let coarse = false
    try {
        coarse = view.matchMedia?.('(pointer: coarse)').matches === true
    } catch {
        coarse = false
    }
    return coarse || view.innerWidth <= MOBILE_MAX_WIDTH
}
