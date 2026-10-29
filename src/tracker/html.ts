/**
 * Escaping and the small text decorations the tracker's markup is built from.
 *
 * Everything here takes a string and returns a string. That is the property
 * that made the legacy renderer worth keeping: it never touched the DOM, so it
 * drops straight into Spindle's `ctx.messages.renderWidget()`, which wants an
 * HTML string.
 *
 * A memo is written by a language model, so every value that reaches markup
 * passes through `escapeHtml` — except the two markups authors are allowed to
 * write, which `escapeHtmlWithColor` handles deliberately and narrowly.
 */

/** Item-quality colours, WoW convention, for `[Epic]`-style rarity tags. */
const RARITY_COLORS: Record<string, string> = {
    poor: '#9d9d9d',
    common: '#ffffff',
    uncommon: '#1eff00',
    rare: '#0070dd',
    epic: '#a335ee',
    legendary: '#ff8000',
    artifact: '#e6cc80',
    heirloom: '#00ccff',
}

export function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Undo `escapeHtml`, for reading text back out of markup or a dataset. */
export function decodeHtml(str: string): string {
    if (!str) return ''
    return String(str)
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
}

/**
 * Escape a value, keeping the two colour markups authors are allowed to write:
 * `<font color=…>…</font>` and a leading `[Epic]`-style rarity tag.
 *
 * The mechanism matters. Both markups are turned into placeholders *first*,
 * using two control characters; then everything left is escaped wholesale;
 * then the placeholders are swapped for spans built here. So the only HTML
 * that survives is HTML this function wrote, and the colour inside it came
 * through a pattern that admits a hex value or bare letters and nothing else.
 * A model that emits `<script>` gets text.
 *
 * One departure from the legacy build: the placeholder characters are stripped
 * from the input first. The legacy version assumed they could never occur in a
 * memo, and a memo that contained them anyway had `spans[n]` substituted into
 * it — printing `undefined`, or repeating an unrelated span. No real memo
 * carries a 0x01, so stripping them changes nothing a user would notice and
 * closes the hole.
 */
export function escapeHtmlWithColor(str: string): string {
    if (!str) return ''

    const OPEN = '\x01'
    const CLOSE = '\x02'
    const spans: string[] = []

    // Reserve the placeholder characters for our own use — see above.
    str = str.replace(/[\x01\x02]/g, '')

    // A rarity tag hides itself and colours everything after it.
    const rarityRx = /\[(poor|common|uncommon|rare|epic|legendary|artifact|heirloom)\]\s*([\s\S]*)/gi
    const processed = str.replace(rarityRx, (_match, rarity: string, rest: string) => {
        const color = RARITY_COLORS[rarity.toLowerCase()]
        spans.push(`<span style="color:${color}">${escapeHtmlWithColor(rest)}</span>`)
        return OPEN + (spans.length - 1) + CLOSE
    })

    const colorRx = /<font\s+color\s*=\s*["']?(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)["']?>([\s\S]*?)<\/font>/gi
    const tokenized = processed.replace(colorRx, (_match, color: string, inner: string) => {
        spans.push(`<span style="color:${color}">${escapeHtmlWithColor(inner)}</span>`)
        return OPEN + (spans.length - 1) + CLOSE
    })

    return escapeHtml(tokenized).replace(/\x01(\d+)\x02/g, (_m, i: string) => spans[parseInt(i, 10)])
}

/** Wrap parenthetical asides so they can be dimmed. Input must already be escaped. */
export function highlightParens(text: string): string {
    return text.replace(/\(([^)]+)\)/g, '<span class="rt-paren-highlight">($1)</span>')
}

/** Wrap numbers so they stand out. Skips anything inside a tag, so markup survives. */
export function highlightNumbers(text: string): string {
    return text.replace(/(<[^>]+>)|([+-]\d+|\b\d+\b)/g, (match, tag: string, num: string) =>
        tag ? tag : `<span class="rt-paren-highlight">${num}</span>`,
    )
}

/**
 * A translucent background and border derived from one colour, so a badge tints
 * itself rather than needing a palette entry per marker.
 */
export function makeColorTintStyle(color: string, backgroundPct = 12, borderPct = 40): string {
    return `background:color-mix(in srgb, ${color} ${backgroundPct}%, transparent);border-color:color-mix(in srgb, ${color} ${borderPct}%, transparent);color:${color};`
}

/** Mirror a bar's fill onto its value text, gradients included. */
export function makeBarrelValueStyle(background: string): string {
    if (/^linear-gradient\(/i.test(background)) {
        return `background:${background};-webkit-background-clip:text;background-clip:text;color:transparent;`
    }
    return `color:${background};`
}

/**
 * Split on commas that separate items, not on commas inside them.
 *
 * Ignores a comma inside parentheses, so `Rage (2/2 per day), Reckless Attack`
 * is two pills; and one between two digits, so `1,250 gp` stays one number.
 */
export function splitSmart(text: string): string[] {
    const result: string[] = []
    let current = ''
    let depth = 0

    for (let i = 0; i < text.length; i++) {
        const char = text[i]
        if (char === '(') depth++
        else if (char === ')') depth--

        const isThousandsSeparator =
            char === ',' && i > 0 && i < text.length - 1 && /\d/.test(text[i - 1]) && /\d/.test(text[i + 1])

        if (char === ',' && depth === 0 && !isThousandsSeparator) {
            result.push(current.trim())
            current = ''
        } else {
            current += char
        }
    }

    if (current.trim()) result.push(current.trim())
    return result
}
