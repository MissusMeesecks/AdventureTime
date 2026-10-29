/**
 * The inventory's worth annotations (72b): Multihog's *Show Total Inventory
 * Value* and *Item Worth* (hover or inline badge), from `renderer.js` at the
 * pin — a closure over the whole renderer, so transcribed and tested here.
 *
 * An item line may end in `(~120 GP)` or `(Worth: 120 GP)`: the annotation
 * is taken off the text, kept as a tooltip, and in *display* mode drawn as a
 * coin badge beside the item. A line that *is* a sum of money (`45 GP`,
 * `💰 45 GP`, `$500`) is drawn as a badge in its currency's colour. Every
 * value read is added up in copper — gold and the modern currencies at a
 * hundred, silver at ten, copper at one — and the total goes into the card's
 * header in the currency most of the lines used.
 */

export interface InventoryItem {
    /** The item's text without its worth annotation or its bullet. */
    text: string
    /** `Worth: …`, with `Effect: …` before it when the item carries a mechanical parenthetical; `''` when none. */
    tooltip: string
    /** The worth, when the line had one. */
    worth: string
    /** The line is a sum of money itself. */
    isCurrency: boolean
    /** The colour of the worth's or the sum's currency, when one is known. */
    color: string
    /** The value in copper, 0 when none was read. */
    copper: number
    equipped: boolean
}

const CURRENCY_STYLES: Array<{ rx: RegExp; color: string }> = [
    { rx: /\b(gold|gp)\b/i, color: '#ffd700' },
    { rx: /\b(dollar|usd|euro|eur|pound|gbp)s?\b|[$£€]/i, color: '#85bb65' },
    { rx: /\b(silver|sp)\b/i, color: '#c0c0c0' },
    { rx: /\b(bronze|copper|cp)\b/i, color: '#cd7f32' },
]

/** A line that is the currency itself: a number and a unit, or a symbol and a number, with no worth annotation. */
const BARE_CURRENCY_RX = /^[^(]*?(?:([$£€])\s*\d[\d,]*|\d[\d,]*\s*(gp|sp|cp|gold|silver|bronze|copper|dollar|usd|euro|eur|pound|gbp|£|\$|€)(?:\s+[a-z]+){0,2})\s*$/i
const WORTH_RX = /\s*\(~([^)]+)\)\s*$|\s*\(Worth:\s*([^)]+)\)\s*$/i
const EQUIPPED_RX = /\s*\[E\]\s*/i
const BULLET_RX = /^\s*[-*+•–—](?:\s+|(?=[A-Za-z]))/

/** The legacy's `parseValueToCopper`: every amount in the text summed in copper; 0 when none. */
export function parseValueToCopper(text: string): number {
    const suffixRx = /([\d,]+(?:\.\d+)?)\s*(gp|sp|cp|gold|silver|bronze|copper|usd|eur|gbp|dollar|euros?|pounds?)\b/gi
    const prefixRx = /([$£€])\s*([\d,]+(?:\.\d+)?)/gi
    const clean = (n: string) => parseFloat(n.replace(/,/g, ''))
    let total = 0
    let found = false
    let match: RegExpExecArray | null
    while ((match = suffixRx.exec(text)) !== null) {
        found = true
        const num = clean(match[1]!)
        const unit = match[2]!.toLowerCase()
        if (/\b(gold|gp|usd|eur|gbp|dollar|euro|pound)\b/.test(unit)) total += num * 100
        else if (/\b(silver|sp)\b/.test(unit)) total += num * 10
        else if (/\b(bronze|copper|cp)\b/.test(unit)) total += num
    }
    while ((match = prefixRx.exec(text)) !== null) {
        found = true
        total += clean(match[2]!) * 100
    }
    return found ? total : 0
}

/** The legacy's `detectCurrency`: which family a value belongs to. */
export function detectCurrency(text: string): 'usd' | 'eur' | 'gbp' | 'gp' | null {
    if (/\$|\b(usd|dollars?)\b/i.test(text)) return 'usd'
    if (/€|\b(eur|euros?)\b/i.test(text)) return 'eur'
    if (/£|\b(gbp|pounds?)\b/i.test(text)) return 'gbp'
    if (/\b(gp|sp|cp|gold|silver|bronze|copper)\b/i.test(text)) return 'gp'
    return null
}

/** The legacy's `formatValueToCurrency`: copper back into the currency, `GP/SP/CP` broken out for coin. */
export function formatValueToCurrency(totalCp: number, currency: 'usd' | 'eur' | 'gbp' | 'gp'): string {
    if (totalCp <= 0) return ''
    const amount = totalCp / 100
    const formatted = amount.toLocaleString('en-US', { minimumFractionDigits: totalCp % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })
    if (currency === 'usd') return `$${formatted}`
    if (currency === 'eur') return `€${formatted}`
    if (currency === 'gbp') return `£${formatted}`
    const gp = Math.floor(totalCp / 100)
    const sp = Math.floor((totalCp % 100) / 10)
    const cp = Math.round(totalCp % 10)
    const parts: string[] = []
    if (gp) parts.push(`${gp.toLocaleString('en-US')} GP`)
    if (sp) parts.push(`${sp} SP`)
    if (cp) parts.push(`${cp} CP`)
    return parts.join(', ') || '0 GP'
}

function colorOf(text: string): string {
    return CURRENCY_STYLES.find((s) => s.rx.test(text))?.color ?? ''
}

/** One inventory line read as the legacy reads it. */
export function readInventoryItem(raw: string): InventoryItem {
    let text = raw.replace(BULLET_RX, '').trim()
    const equipped = EQUIPPED_RX.test(text)
    if (equipped) text = text.replace(EQUIPPED_RX, ' ').trim()
    const worthMatch = text.match(WORTH_RX)
    if (worthMatch) {
        const worth = (worthMatch[1] || worthMatch[2] || '').trim()
        let display = text.replace(WORTH_RX, '').trim()
        const effectRx = /\s*\(([^)~][^)]*)\)\s*$/
        const effect = display.match(effectRx)
        const parts: string[] = []
        if (effect && /\d/.test(effect[1]!)) {
            parts.push(`Effect: ${effect[1]!.trim()}`)
            display = display.replace(effectRx, '').trim()
        }
        parts.push(`Worth: ${worth}`)
        return { text: display, tooltip: parts.join('\n'), worth, isCurrency: false, color: colorOf(worth), copper: parseValueToCopper(worth), equipped }
    }
    if (BARE_CURRENCY_RX.test(text)) {
        return { text, tooltip: '', worth: '', isCurrency: true, color: colorOf(text), copper: parseValueToCopper(text), equipped }
    }
    return { text, tooltip: '', worth: '', isCurrency: false, color: '', copper: 0, equipped }
}

/** The card's total: every value summed, in the currency most lines used (`gp` when tied or none). */
export function inventoryTotal(items: readonly InventoryItem[]): { total: string; currency: 'usd' | 'eur' | 'gbp' | 'gp' } | null {
    const counts: Record<string, number> = { usd: 0, eur: 0, gbp: 0, gp: 0 }
    let copper = 0
    for (const item of items) {
        if (!item.copper) continue
        copper += item.copper
        const currency = detectCurrency(item.worth || item.text)
        if (currency) counts[currency] = (counts[currency] ?? 0) + 1
    }
    if (copper <= 0) return null
    let currency: 'usd' | 'eur' | 'gbp' | 'gp' = 'gp'
    let max = 0
    for (const [key, count] of Object.entries(counts)) {
        if (count > max) { max = count; currency = key as typeof currency }
    }
    return { total: formatValueToCurrency(copper, currency), currency }
}
