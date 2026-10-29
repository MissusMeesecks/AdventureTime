/**
 * Hand the browser a text file to save.
 *
 * A plain anchor, not the host's element factory: it is a throwaway that
 * never belongs to the panel. The anchor is retired on the next tick and the
 * URL held for a minute before release, since a download that silently does
 * nothing is worse than a leak of one small blob (the settings panel learned
 * this with the cartridge export).
 */
export function downloadText(filename: string, text: string, type = 'application/json'): void {
    const url = URL.createObjectURL(new Blob([text], { type }))
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.rel = 'noopener'
    document.body.append(link)
    link.click()
    setTimeout(() => link.remove(), 0)
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
