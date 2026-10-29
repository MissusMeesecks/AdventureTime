import { describe, expect, it } from 'vitest'

import { detectCurrency, formatValueToCurrency, inventoryTotal, parseValueToCopper, readInventoryItem } from './inventory-worth.js'

describe('the inventory’s worth (72b)', () => {
    it('sums every amount in copper, in the legacy’s rates, and names the currency', () => {
        expect(parseValueToCopper('120 GP')).toBe(12000)
        expect(parseValueToCopper('2 gp, 5 sp, 3 cp')).toBe(253)
        expect(parseValueToCopper('$1,500.50')).toBe(150050)
        expect(parseValueToCopper('a sword')).toBe(0)
        expect(detectCurrency('45 gp')).toBe('gp')
        expect(detectCurrency('€12')).toBe('eur')
        expect(detectCurrency('12 pounds')).toBe('gbp')
        expect(detectCurrency('nothing')).toBeNull()
        expect(formatValueToCurrency(12253, 'gp')).toBe('122 GP, 5 SP, 3 CP')
        expect(formatValueToCurrency(150050, 'usd')).toBe('$1,500.50')
        expect(formatValueToCurrency(0, 'gp')).toBe('')
    })

    it('reads an item’s worth off its tail, keeps a mechanical parenthetical in the tooltip, and knows a line that is money', () => {
        const item = readInventoryItem('- Volcanic Mace (+1 / 2d6+3) (~120 GP) [E]')
        expect(item).toMatchObject({ text: 'Volcanic Mace', tooltip: 'Effect: +1 / 2d6+3\nWorth: 120 GP', worth: '120 GP', color: '#ffd700', copper: 12000, equipped: true, isCurrency: false })
        expect(readInventoryItem('Healing Potion (Worth: 50 sp)')).toMatchObject({ text: 'Healing Potion', tooltip: 'Worth: 50 sp', copper: 500, color: '#c0c0c0' })
        expect(readInventoryItem('Cloak of Elvenkind (Stealth advantage)')).toMatchObject({ text: 'Cloak of Elvenkind (Stealth advantage)', tooltip: '', copper: 0 })
        expect(readInventoryItem('💰 45 GP')).toMatchObject({ isCurrency: true, copper: 4500, color: '#ffd700' })
        expect(readInventoryItem('$500')).toMatchObject({ isCurrency: true, copper: 50000, color: '#85bb65' })
        expect(readInventoryItem('Rope, 50 ft')).toMatchObject({ isCurrency: false, copper: 0 })
    })

    it('totals the card in the currency most lines used', () => {
        const items = ['Mace (~120 GP)', '45 GP', 'Rope', '$10'].map(readInventoryItem)
        expect(inventoryTotal(items)).toEqual({ total: '175 GP', currency: 'gp' })
        expect(inventoryTotal([readInventoryItem('Rope')])).toBeNull()
        expect(inventoryTotal(['$10', '$20', '5 gp'].map(readInventoryItem))).toEqual({ total: '$35', currency: 'usd' })
    })
})
