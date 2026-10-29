import { describe, expect, it } from 'vitest'

import { parseBlockLine } from './lines.js'
import { buildEntityBlockView } from './entity-view.js'
import { buildQuestLogView } from './quest-view.js'
import { parseQuestsFromText } from './quests.js'
import { renderBlockCard, renderBottomXpBar, renderEntityBlock, renderEntityCard, renderLine, renderQuestCard, renderQuestLog, renderTabModeHtml, renderTrackerHtml } from './render.js'
import { buildTrackerView } from './view.js'

const ctx = { tag: 'WAYSTONE', lineIndex: 0 }
const draw = (line: string) => renderLine(parseBlockLine(line, ctx))

describe('lines without markers', () => {
    it('draws a kv pair with its colon restored', () => {
        expect(draw('Steward: Odile')).toBe(
            '<div class="rt-card-kv"><span class="rt-card-key">Steward:</span><span class="rt-card-val">Odile</span></div>',
        )
    })

    it('draws a plain line', () => {
        expect(draw('The vault door is ajar')).toContain('rt-card-item--plain')
    })
})

describe('the pips (38)', () => {
    const spells = (line: string) => renderLine(parseBlockLine(line, { tag: 'SPELLS', lineIndex: 0 }))
    const entity = (line: string) => renderLine(parseBlockLine(line, { tag: 'PARTY:Elara', lineIndex: 0, inEntity: true }))
    const count = (html: string, cls: string) => (html.match(new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"`, 'g')) ?? []).length

    it('draws a level as its row: the label, lit and used pips, the spells as wiki chips', () => {
        const html = spells("Level 1 (2/4): Hunter's Mark, Longstrider")
        expect(html).toContain('<div class="rt-spell-row"><span class="rt-spell-level">Level 1</span>')
        expect(count(html, 'rt-slot-pip')).toBe(4)
        expect(count(html, 'rt-slot-available')).toBe(2)
        expect(count(html, 'rt-slot-used')).toBe(2)
        expect(html).toContain('<a href="https://dnd5e.wikidot.com/spell:hunters-mark" target="_blank" rel="noopener" class="rt-spell-name" title="View spell on Wikidot">Hunter\'s Mark</a>')
        expect(html).toContain('spell:longstrider')
    })

    it('draws cantrips with no pips', () => {
        const html = spells('Cantrips: Mage Hand')
        expect(html).toContain('rt-spell-row')
        expect(html).not.toContain('rt-slot-pips')
        expect(html).toContain('spell:mage-hand')
    })

    it('lights every pip when more are available than there are slots, as the legacy does', () => {
        expect(count(spells('Level 1 (5/3): Shield'), 'rt-slot-available')).toBe(3)
    })

    it("draws an entity's groups as rows, one per group", () => {
        const html = entity('Spells: Cantrips: Mage Hand | Level 1 (1/2): Goodberry')
        expect(count(html, 'rt-spell-row')).toBe(2)
        expect(count(html, 'rt-slot-pip')).toBe(2)
        expect(count(html, 'rt-slot-available')).toBe(1)
    })

    it("draws an entity's flat spell list as pills under the label", () => {
        const html = entity('Spells: Ray of Sickness (2/2), Fire Bolt (at will)')
        expect(html).toContain('<div class="rt-entity-sub-line rt-units-container"><span class="rt-entity-sub-label">Spells:</span>')
        expect(count(html, 'rt-unit-pill')).toBe(2)
        expect(html).not.toContain('rt-spell-row')
    })

    it('draws hit dice as the die in brackets and gold pips', () => {
        const html = entity('HD: d10 (3/5)')
        expect(html).toContain('<span class="rt-entity-sub-label">HD:</span>')
        expect(html).toContain('<span class="rt-hd-label">[ d10 ]</span>')
        expect(count(html, 'rt-hd-pip')).toBe(5)
        expect(count(html, 'rt-hd-available')).toBe(3)
    })

    it('escapes a spell name and a die', () => {
        expect(spells('Level 1 (1/1): <b>Shield</b>')).not.toContain('<b>')
        expect(entity('HD: <i>d8</i> (1/1)')).not.toContain('<i>')
    })

    // End to end: the memo's [SPELLS] block and a party member's lines, through
    // the view and the cards, since the entity path sets the context and the
    // block path does not.
    it('draws the pips through the whole view, in the block and on the card', () => {
        const memo = [
            '[SPELLS]', 'Cantrips: Light', 'Level 1 (3/4): Shield, Sleep', '[/SPELLS]',
            '[PARTY]', 'Elara (Ranger): 26/45 HP', 'Spells: Level 1 (2/2): Goodberry', 'HD: d10 (5/5)', 'Skills: Athletics +3', '[/PARTY]',
        ].join('\n')
        const html = renderTrackerHtml(buildTrackerView(memo))
        expect(count(html, 'rt-spell-row')).toBe(3)
        expect(count(html, 'rt-slot-pip')).toBe(6)
        expect(count(html, 'rt-slot-available')).toBe(5)
        expect(count(html, 'rt-hd-pip')).toBe(5)
        expect(html).toContain('<span class="rt-entity-sub-label">Skills:</span>')
    })
})

describe('the stock labels under an entity (40)', () => {
    const entity = (line: string) => renderLine(parseBlockLine(line, { tag: 'PARTY:Elara', lineIndex: 0, inEntity: true }))
    const block = (line: string) => renderLine(parseBlockLine(line, { tag: 'PARTY', lineIndex: 0 }))
    const count = (html: string, cls: string) => (html.match(new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"`, 'g')) ?? []).length

    it('draws skills, traits and status as pills under the label', () => {
        const html = entity('Skills: Athletics +3, Perception +5')
        expect(html).toContain('<div class="rt-entity-sub-line rt-units-container"><span class="rt-entity-sub-label">Skills:</span>')
        expect(count(html, 'rt-unit-pill')).toBe(2)
        expect(count(entity('Traits: Natural Explorer (ignore difficult terrain), Keen Senses'), 'rt-unit-pill')).toBe(2)
        expect(entity('Status: (+) Blessed, (-) Poisoned')).toContain('rt-pill-buff')
    })

    it('lights the numbers in combat and saves lines', () => {
        const html = entity('Saves: Fort +3 | Ref +5 | Will +2')
        expect(html).toContain('<span class="rt-entity-sub-label">Saves:</span><span class="rt-entity-sub-value">Fort <span class="rt-paren-highlight">+3</span> | Ref <span class="rt-paren-highlight">+5</span> | Will <span class="rt-paren-highlight">+2</span></span>')
        expect(count(entity('Combat: BAB: +3 | Melee (1 attack): +4 | Base AC: 13'), 'rt-paren-highlight')).toBe(4)
    })

    it('highlights the parentheses in gear and attributes, and draws AC as written', () => {
        expect(entity('Gear: Shortbow (1d6+3 Piercing) | Leather Armor (+2 AC)')).toContain('<span class="rt-paren-highlight">(1d6+3 Piercing)</span>')
        expect(entity('AC: 15 (18 with shield)')).toContain('<span class="rt-entity-sub-value">15 (18 with shield)</span>')
    })

    it('escapes the values under every rule', () => {
        expect(entity('Skills: <b>Stealth</b> +7')).not.toContain('<b>')
        expect(entity('Saves: <i>Fort</i> +3')).not.toContain('<i>')
        expect(entity('AC: <u>15</u>')).not.toContain('<u>')
        expect(entity('Gear: <b>Bow</b> (1d6)')).not.toContain('<b>')
    })

    it('changes nothing at block level: the same line is a plain pair', () => {
        expect(block('Skills: Athletics +3')).toBe('<div class="rt-card-kv"><span class="rt-card-key">Skills:</span><span class="rt-card-val">Athletics +3</span></div>')
    })

    it('draws the rules through the whole view, on a party member and the character', () => {
        const memo = [
            '[PARTY]', 'Elara (Ranger): 26/45 HP', 'Skills: Athletics +3, Perception +5', 'Saves: Fort +3 | Ref +5', 'Gear: Shortbow (1d6+3)', 'Mood: wary (hungry)', '[/PARTY]',
            '[CHARACTER]', 'Robin (Rogue)', 'Traits: Lucky, Brave', 'AC: 15', '[/CHARACTER]',
        ].join('\n')
        const html = renderTrackerHtml(buildTrackerView(memo))
        expect(count(html, 'rt-unit-pill')).toBe(4)
        // Two save numbers, the gear's parentheses, and the unknown label's fallback highlight.
        expect(count(html, 'rt-paren-highlight')).toBe(4)
        expect(html).toContain('<span class="rt-entity-sub-label">Mood:</span><span class="rt-entity-sub-value">wary <span class="rt-paren-highlight">(hungry)</span></span>')
        expect(html).toContain('<span class="rt-entity-sub-label">AC:</span><span class="rt-entity-sub-value">15</span>')
    })
})

describe('bars', () => {
    it('draws an HP bar at the right width', () => {
        const html = draw('HP: ((BAR)) 12/20')
        expect(html).toContain('width:60.0%')
        expect(html).toContain('12/20')
    })

    it('uses the legacy class names, so the stylesheet port drops straight on', () => {
        const html = draw('Load: ((PROGRESS)) 3/5')
        expect(html).toContain('class="rt-progress-bar-wrap"')
        expect(html).toContain('class="rt-progress-bar"')
        expect(html).toContain('class="rt-progress-label"')
    })

    it('uses a marker colour as the fill', () => {
        expect(draw('Attunement: ((BARCYAN)) 640/1000')).toContain('background:CYAN')
    })

    it('keeps the numbers as the model wrote them', () => {
        expect(draw('Stamina: ((BAR)) 4,180/10,000')).toContain('4,180/10,000')
    })

    it('carries a bar identity for the per-bar state layer to attach to', () => {
        expect(draw('HP: ((BAR)) 12/20')).toContain('data-rt-bar-id="WAYSTONE::HP[L0]"')
    })

    it('writes the bar’s value beside its id as the legacy does (74h): the current, the maximum, the kind, and whether it animates', () => {
        const on = (line: string, bars = {}) => renderLine(parseBlockLine(line, { ...ctx, bars, animateCustomBars: true }))
        // The switch covers the two custom markers and nothing else.
        expect(on('Morale: ((BAR)) 20/100')).toContain('data-rt-bar-id="WAYSTONE::Morale[L0]" data-rt-bar-current="20" data-rt-bar-max="100" data-rt-bar-kind="linear" data-rt-bar-animate="true"')
        expect(on('Trust: ((BARREL)) -20/100')).toContain('data-rt-bar-id="WAYSTONE::Trust[L0]" data-rt-bar-current="-20" data-rt-bar-max="100" data-rt-bar-kind="barrel" data-rt-bar-animate="true"')
        expect(on('Trust: ((BARREL)) +250/100')).toContain('data-rt-bar-current="100" data-rt-bar-max="100" data-rt-bar-kind="barrel"')
        expect(on('Build: ((PROGRESS)) 2/10')).toContain('data-rt-bar-current="2" data-rt-bar-max="10" data-rt-bar-kind="linear" data-rt-bar-animate="false"')
        expect(on('Load: ((WEIGHT)) 30/50')).toContain('data-rt-bar-current="30" data-rt-bar-max="50" data-rt-bar-kind="linear" data-rt-bar-animate="false"')
        expect(on('Wand: ((CHARGE)) 3/7')).toContain('data-rt-bar-current="3" data-rt-bar-max="7" data-rt-bar-kind="linear" data-rt-bar-animate="false"')
        // Off, a custom bar does not animate; a bar's own tick does, whatever the switch.
        expect(draw('Morale: ((BAR)) 20/100')).toContain('data-rt-bar-animate="false"')
        expect(draw('Morale: ((BAR)) 20/100')).toContain('data-rt-bar-current="20"')
        expect(renderLine(parseBlockLine('Build: ((PROGRESS)) 2/10', { ...ctx, bars: { 'WAYSTONE::Build[L0]': { animateChanges: true } } }))).toContain('data-rt-bar-animate="true"')
        // A bar with no readable fraction, or none, carries no value; a marker with no bar carries nothing.
        expect(on('Morale: ((BAR)) high')).not.toContain('data-rt-bar-current')
        expect(on('Morale: ((BAR)) 5/0')).not.toContain('data-rt-bar-current')
        expect(on('Fate: ((CLOCK)) 2/6')).not.toContain('data-rt-bar-current')
        expect(on('Mood: ((PILLS)) calm, wary')).not.toContain('data-rt-bar-')
    })

    it('writes the recolour handle on every bar as the legacy does (74i): the id, the fill drawn now, the HP rule’s explicit flag, and the barrel’s two half-controls', () => {
        const withBars = (line: string, bars = {}) => renderLine(parseBlockLine(line, { ...ctx, bars }))
        expect(withBars('Morale: ((BAR)) 20/100')).toContain('data-rt-bar-animate="false" data-recolor-id="WAYSTONE::Morale[L0]" data-recolor-current="linear-gradient(90deg,#e74c3c,#c0392b)" data-recolor-explicit-color="false" title="Click to recolor"')
        expect(withBars('Morale: ((BARGREEN)) 20/100')).toContain('data-recolor-current="GREEN" data-recolor-explicit-color="true"')
        expect(withBars('Build: ((PROGRESS)) 2/10')).toMatch(/data-recolor-id="WAYSTONE::Build\[L0\]" data-recolor-current="[^"]+" title="Click to recolor"/)
        expect(withBars('Build: ((PROGRESS)) 2/10')).not.toContain('data-recolor-explicit-color')
        for (const line of ['Load: ((WEIGHT)) 30/50', 'Fate: ((CLOCK)) 2/6', 'Fame: ((STARS)) 3/5', 'Mana: ((ORBS)) 2/4', 'Ammo: ((SLOTS)) 1/3', 'Moon: ((PHASE)) 2/5', 'Heat: ((GAUGE)) 4/10', 'Wand: ((CHARGE)) 3/7', 'Growth: ((XPBAR)) 40/100']) {
            expect(withBars(line), line).toMatch(/ data-recolor-id="WAYSTONE::[^"]+" data-recolor-current="[^"]+" title="Click to recolor"/)
        }
        // The barrel: the track carries the value, the two half-controls the handles under their own ids.
        const barrel = withBars('Trust: ((BARREL)) -20/100')
        expect(barrel).toContain('<div class="rt-barrel-color-control rt-barrel-negative-control" data-recolor-id="WAYSTONE::Trust[L0]:negative" data-recolor-current="linear-gradient(270deg, #ef444488, #ef4444)" title="Click to recolor the negative side" data-recolor-percent="true" data-barrel-direction="negative"></div>')
        expect(barrel).toContain('<div class="rt-barrel-color-control rt-barrel-positive-control" data-recolor-id="WAYSTONE::Trust[L0]:positive" data-recolor-current="linear-gradient(90deg, #4ade8088, #4ade80)" title="Click to recolor the positive side" data-recolor-percent="true" data-barrel-direction="positive"></div>')
        expect(barrel).not.toMatch(/rt-barrel-track"[^>]*data-recolor-id/)
        expect(withBars('Mood: ((PILLS)) calm')).not.toContain('data-recolor')
    })

    it('draws the stored config through the legacy’s resolver (74i): solid, gradient, dynamic, the percentage readout, a barrel’s halves and the animate tick', () => {
        const withBars = (line: string, bars = {}) => renderLine(parseBlockLine(line, { ...ctx, bars }))
        const id = 'WAYSTONE::Morale[L0]'
        expect(withBars('Morale: ((BARGREEN)) 20/100', { [id]: { color: '#123456' } })).toContain('background:#123456;')
        expect(withBars('Morale: ((BAR)) 20/100', { [id]: { mode: 'gradient', color: '#111111', color2: '#222222' } })).toContain('data-recolor-current="linear-gradient(90deg, #111111, #222222)"')
        expect(withBars('Morale: ((BAR)) 20/100', { [id]: { mode: 'gradient', color: '#111111', color2: '#222222' } })).toContain('background:linear-gradient(90deg, #111111, #222222);')
        expect(withBars('Morale: ((BAR)) 20/100', { [id]: { mode: 'dynamic' } })).toContain('background:#ff5555;')
        expect(withBars('Morale: ((BAR)) 70/100', { [id]: { mode: 'dynamic' } })).toContain('background:#00ffaa;')
        expect(withBars('Morale: ((BAR)) 64/100', { [id]: { showAsPercentage: true } })).toContain('>64%</span>')
        expect(withBars('Fame: ((STARS)) 3/5', { 'WAYSTONE::Fame[L0]': { color: '#abcdef' } })).toContain('style="color:#abcdef;"')
        // The XP marker's readout as a percentage, with its flag for the floater.
        const xp = withBars('Growth: ((XPBAR)) 40/160', { 'WAYSTONE::Growth[L0]': { showAsPercentage: true } })
        expect(xp).toContain('data-xp-show-percentage="true"')
        expect(xp).toContain('<span class="rt-xp-current">25</span>/<span class="rt-xp-max">100</span>')
        expect(withBars('Growth: ((XPBAR)) 40/160')).toContain('data-xp-show-percentage="false"')
        // A barrel's halves: each its own config; the animate tick on either half animates the bar.
        const barrel = withBars('Trust: ((BARREL)) +20/100', { 'WAYSTONE::Trust[L0]:positive': { color: '#00ff00', animateChanges: true }, 'WAYSTONE::Trust[L0]:negative': { mode: 'gradient', color: '#ff0000', color2: '#880000' } })
        expect(barrel).toContain('data-rt-bar-animate="true"')
        expect(barrel).toContain('data-recolor-id="WAYSTONE::Trust[L0]:positive" data-recolor-current="#00ff00"')
        expect(barrel).toContain('data-recolor-id="WAYSTONE::Trust[L0]:negative" data-recolor-current="linear-gradient(90deg, #ff0000, #880000)"')
        expect(barrel).toContain('background:#00ff00;')
        expect(withBars('Trust: ((BARREL)) +20/100', { 'WAYSTONE::Trust[L0]': { animateChanges: true } })).toContain('data-rt-bar-animate="false"')
    })

    it('says on each handle whether its readout honours Show as Percentage, and honours it on every bar with a readout (74i-bis)', () => {
        const withBars = (line: string, bars = {}) => renderLine(parseBlockLine(line, { ...ctx, bars }))
        // The handles whose readout can show a percentage carry the flag …
        for (const line of ['Morale: ((BAR)) 20/100', 'Build: ((PROGRESS)) 2/10', 'Load: ((WEIGHT)) 30/50', 'Heat: ((GAUGE)) 4/10', 'Wand: ((CHARGE)) 3/7', 'Growth: ((XPBAR)) 40/100']) {
            expect(withBars(line), line).toMatch(/title="Click to recolor" data-recolor-percent="true"/)
        }
        // … and the ones with nothing a percentage could change do not, so the panel takes the tick off their box.
        for (const line of ['Fate: ((CLOCK)) 2/6', 'Fame: ((STARS)) 3/5', 'Mana: ((ORBS)) 2/4', 'Ammo: ((SLOTS)) 1/3', 'Moon: ((PHASE)) 2/5']) {
            expect(withBars(line), line).toContain('data-recolor-id=')
            expect(withBars(line), line).not.toContain('data-recolor-percent')
        }
        // The readouts the legacy leaves as a fraction follow the tick here.
        const pct = { showAsPercentage: true }
        expect(withBars('Load: ((WEIGHT)) 30/50', { 'WAYSTONE::Load[L0]': pct })).toContain('<span class="rt-weight-label">60%</span>')
        expect(withBars('Load: ((WEIGHT)) 30/50 lbs', { 'WAYSTONE::Load[L0]': pct })).toContain('<span class="rt-weight-label">60% lbs</span>')
        expect(withBars('Load: ((WEIGHT)) 30/50')).toContain('<span class="rt-weight-label">30/50</span>')
        expect(withBars('Heat: ((GAUGE)) 4/10', { 'WAYSTONE::Heat[L0]': pct })).toContain('<span class="rt-gauge-label">40%</span>')
        expect(withBars('Heat: ((GAUGE)) 4/10')).toContain('<span class="rt-gauge-label">4/10</span>')
        expect(withBars('Wand: ((CHARGE)) 3/7', { 'WAYSTONE::Wand[L0]': pct })).toContain('<span class="rt-charge-label">43%</span>')
        expect(withBars('Wand: ((CHARGE)) 3/7')).toContain('<span class="rt-charge-label">3/7</span>')
        // A barrel's readout is a signed percentage of its range when either half's config asks; the halves are where the popup writes.
        expect(withBars('Trust: ((BARREL)) -20/100', { 'WAYSTONE::Trust[L0]:negative': pct })).toContain('data-barrel-direction="negative" style="background:linear-gradient(270deg, #ef444488, #ef4444);-webkit-background-clip:text;background-clip:text;color:transparent;">-20%</span>')
        expect(withBars('Trust: ((BARREL)) +38/150', { 'WAYSTONE::Trust[L0]:positive': pct })).toContain('>+25%</span>')
        expect(withBars('Trust: ((BARREL)) 0/100', { 'WAYSTONE::Trust[L0]:negative': pct })).toContain('>0%</span>')
        expect(withBars('Trust: ((BARREL)) -20/100 (wary)', { 'WAYSTONE::Trust[L0]:positive': pct })).toContain('>-20% (wary)</span>')
        expect(withBars('Trust: ((BARREL)) -20/100')).toContain('>-20/100</span>')
        // A tick saved under the track's own id by the Bars list of 74h still counts.
        expect(withBars('Trust: ((BARREL)) -20/100', { 'WAYSTONE::Trust[L0]': pct })).toContain('>-20%</span>')
    })

    it('falls back to a plain line when the value has no fraction', () => {
        const html = draw('HP: ((BAR)) unknown')
        expect(html).toContain('unknown')
        expect(html).not.toContain('rt-hp-bar-wrap')
    })

    it('draws an XP bar with its level', () => {
        const html = draw('((XPBAR)) 450/1000 Level 3')
        expect(html).toContain('Lv 3')
        expect(html).toContain('width:45.0%')
    })
})

describe('barrel', () => {
    it('draws a negative value on the negative side', () => {
        const html = draw('Trust: ((BARREL)) -38/150')
        expect(html).toContain('rt-barrel-negative')
        expect(html).toContain('-38/150')
        // Half the track is each side, so 38 of 150 is a quarter of a half.
        expect(html).toContain('width:12.7%')
    })

    it('signs a positive value and uses the positive side', () => {
        const html = draw('Trust: ((BARREL)) 38/150')
        expect(html).toContain('rt-barrel-positive')
        expect(html).toContain('+38/150')
    })

    it('takes its two colours from the marker', () => {
        expect(draw('Trust: ((BARREL - green red)) 38/150')).toContain('background:green')
        expect(draw('Trust: ((BARREL - green red)) -38/150')).toContain('background:red')
    })

    it('reads a signed range', () => {
        expect(draw('Trust: ((BARREL)) 38/-150..+150')).toContain('+38/150')
    })

    it('clamps a value beyond the range', () => {
        expect(draw('Trust: ((BARREL)) 500/150')).toContain('+150/150')
    })
})

describe('counted markers', () => {
    it('draws one orb per unit, filled up to the current value', () => {
        const html = draw('Ki: ((ORBS)) 3/5')
        expect(html.match(/rt-orb /g)).toHaveLength(5)
        expect(html.match(/rt-orb filled/g)).toHaveLength(3)
    })

    it('draws a half-filled slot', () => {
        const html = draw('Bulk: ((SLOTS)) 2.5/4')
        expect(html).toContain('rt-slot partial')
        expect(html).toContain('width:50%')
    })

    it('marks the current phase and the ones behind it', () => {
        const html = draw('Ritual: ((PHASE)) 2/4')
        expect(html.match(/rt-phase-node past/g)).toHaveLength(1)
        expect(html.match(/rt-phase-node current/g)).toHaveLength(1)
        expect(html.match(/rt-phase-node future/g)).toHaveLength(2)
    })

    it('fills and empties stars, defaulting to five', () => {
        expect(draw('Favor: ((STARS)) 3/5')).toContain('★★★☆☆')
        expect(draw('Favor: ((STARS)) 2')).toContain('★★☆☆☆')
    })
})

describe('badges and pills', () => {
    it('splits pills on top-level commas and keeps the parenthetical as a description', () => {
        const html = draw('Status: ((PILLS)) Rage (2/2 per day), Prone')
        expect(html.match(/rt-unit-pill/g)).toHaveLength(2)
        expect(html).toContain('title="2/2 per day"')
    })

    it('marks a buff and a debuff', () => {
        const html = draw('Status: ((PILLS)) (+) Blessed, (-) Poisoned')
        expect(html).toContain('rt-pill-buff')
        expect(html).toContain('rt-pill-debuff')
    })

    it('gives a fixed-colour marker its colour', () => {
        expect(draw('((DANGER)) Hostile')).toContain('#e74c3c')
    })

    it('colours a difficulty it recognises, and greys one it does not', () => {
        expect(draw('((DIFFICULTY)) Hard')).toContain('#e67e22')
        expect(draw('((DIFFICULTY)) Perilous')).toContain('#aaa')
    })

    it('draws a coin with its icon', () => {
        expect(draw('((GOLD)) 150')).toContain('💰')
    })

    it('picks a weather icon from the text', () => {
        expect(draw('((WEATHER)) Heavy Rain')).toContain('🌧️')
        expect(draw('((WEATHER)) Balmy')).toContain('🌤️')
    })

    it('reads an objective as done, failed or pending', () => {
        expect(draw('((OBJ)) ✓ Found the key')).toContain('rt-obj-done')
        expect(draw('((OBJ)) ✗ Lost the key')).toContain('rt-obj-failed')
        expect(draw('((OBJ)) Find the key')).toContain('rt-obj-pending')
    })
})

describe('multi-marker rows', () => {
    it('puts each marker in its own cell', () => {
        const html = draw('Spells: ((PLS)) Fireball ((BAR)) Charges: 3/5')
        expect(html).toContain('rt-multi-marker-row')
        expect(html.match(/rt-mmc-cell/g)?.length).toBeGreaterThanOrEqual(2)
        expect(html).toContain('rt-mmc-cell--stretch')
    })

    it('turns tab stops into grid columns', () => {
        const html = draw('|0 ((TEXT)) a |60 ((TEXT)) b')
        expect(html).toContain('rt-multi-marker-row--tab-stops')
        expect(html).toContain('grid-column:1 / 601')
    })
})

describe('escaping', () => {
    it('escapes markup a model put in a value', () => {
        const html = draw('Steward: <script>alert(1)</script>')
        expect(html).not.toContain('<script>')
        expect(html).toContain('&lt;script&gt;')
    })

    it('escapes markup in a marked value too', () => {
        expect(draw('((PILL)) <img src=x onerror=y>')).not.toContain('<img')
    })

    it('escapes a block tag before putting it in an attribute', () => {
        const view = buildTrackerView('[A"><script>]\nx\n[/A"><script>]')
        expect(renderTrackerHtml(view)).not.toContain('<script>')
    })
})

describe('cards', () => {
    const view = buildTrackerView('[TIME]\n06:15 AM, Day 4\n[/TIME]\n[XP]\n((XPBAR)) 450/1000\n[/XP]')

    it('gives each block a header with its icon and label', () => {
        const html = renderBlockCard(view.blocks[0])
        expect(html).toContain('🌟')
        expect(html).toContain('XP')
        expect(html).toContain('data-tag="XP"')
    })

    it('folds a collapsed card away', () => {
        const html = renderBlockCard(view.blocks[0], { collapsed: new Set(['XP']) })
        expect(html).toContain('rt-section--collapsed')
        expect(html).toContain('aria-expanded="false"')
        expect(html).toContain('<div class="rt-section-body" hidden>')
    })

    it('draws every block in view order', () => {
        const html = renderTrackerHtml(view)
        expect(html.indexOf('data-tag="XP"')).toBeLessThan(html.indexOf('data-tag="TIME"'))
    })

    describe('Tab Mode (76)', () => {
        const memo = ['[CHARACTER]', 'Robin (Ranger): 30/40 HP', '[/CHARACTER]', '[TIME]', '06:15 AM, Day 4', 'Weather: Clear', '[/TIME]', '[XP]', '((XPBAR)) 450/1000', '[/XP]', '[PARTY]', 'Elara (Ranger): 26/45 HP', 'Skills: Athletics +3', 'Bram: 10/10 HP', '[/PARTY]', '[BENCHED PARTY]', 'Tam: 5/5 HP', 'Status: Resting at camp', '[/BENCHED PARTY]', '[COMBAT]', 'Round 1', 'Enemies:', 'Wolf: 8/8 HP', '[/COMBAT]', '[VEHICLE_FUEL]', 'Vehicle Fuel: ((BARRED)) 1000/1000', '[/VEHICLE_FUEL]', '[QUESTS]', '[Main] Find the well: Active', '[/QUESTS]'].join('\n')
        const settings = { blockOrder: ['CHARACTER', 'TIME', 'XP', 'PARTY', 'BENCHED PARTY', 'COMBAT', 'VEHICLE_FUEL', 'QUESTS'], customFields: [{ tag: 'VEHICLE_FUEL', label: 'Vehicle Fuel', icon: '⛽' }] }
        const tabs = (extra = {}) => renderTabModeHtml(buildTrackerView(memo, settings), { xpBarAtBottom: true, tabMode: { activeTab: '' }, ...extra })

        it('pins Character and Combat as cards, draws the vitals strip, one tab per other module with its count, and the first tab’s card in the pane', () => {
            const html = tabs()
            expect(html).toMatch(/^<div class="rt-tabmode-wrap" data-tab-order="TIME,PARTY,VEHICLE_FUEL,QUESTS">/)
            const pinned = html.slice(html.indexOf('rt-tabmode-pinned'), html.indexOf('rt-vitals-strip'))
            expect(pinned).toContain('data-tag="CHARACTER"')
            expect(pinned).toContain('data-tag="COMBAT"')
            expect(pinned).toContain('class="rt-section-header"')
            // The vitals: every member of PARTY with a ring and a jump.
            expect(html).toContain('title="Elara (Ranger): 26/45 HP"')
            expect(html).toContain('title="Bram: 10/10 HP"')
            expect(html.match(/data-jump-tag="PARTY"/g)).toHaveLength(2)
            // The strip: TIME (two lines), PARTY (two entries, one benched), the custom field by its icon, the quests by the active count.
            expect(html).toContain('<button type="button" class="rt-tab-btn active" data-tag="TIME" title="TIME" aria-pressed="true"><span class="rt-tab-icon">🕒</span><span class="rt-tab-badge">2</span></button>')
            expect(html).toContain('data-tag="PARTY" title="PARTY" aria-pressed="false"><span class="rt-tab-icon">👥</span><span class="rt-tab-badge">2</span><span class="rt-tab-badge rt-tab-badge-secondary" title="Benched">⛺1</span></button>')
            expect(html).toContain('data-tag="VEHICLE_FUEL" title="Vehicle Fuel" aria-pressed="false"><span class="rt-tab-icon">⛽</span><span class="rt-tab-badge">1</span></button>')
            expect(html).toContain('data-tag="QUESTS" title="QUESTS" aria-pressed="false"><span class="rt-tab-icon">📋</span><span class="rt-tab-badge">1</span></button>')
            // One pane, the first tab's card; the XP card is a tab too when the bar is not at the bottom.
            expect(html).toContain('<div class="rt-tabmode-content" data-active-tag="TIME"><div class="rt-section" data-tag="TIME">')
            expect(html).not.toContain('data-tag="PARTY">')
            expect(html).not.toContain('data-tag="XP"')
            expect(tabs({ xpBarAtBottom: false })).toContain('data-tag="XP" title="XP"')
            expect(tabs({ xpBarAtBottom: false })).toContain('data-tab-order="TIME,XP,PARTY,VEHICLE_FUEL,QUESTS"')
        })

        it('shows the tab asked for with its card — PARTY with its camp — and falls to the first for a tab it does not have', () => {
            const party = tabs({ tabMode: { activeTab: 'PARTY' } })
            expect(party).toContain('data-active-tag="PARTY"')
            expect(party).toContain('data-tag="PARTY" title="PARTY" aria-pressed="true"')
            expect(party).toContain('<div class="rt-section" data-tag="PARTY">')
            expect(party).toContain('rt-benched')
            expect(party).toContain('Resting at camp')
            expect(party).not.toContain('data-tag="TIME">')
            expect(tabs({ tabMode: { activeTab: 'NOWHERE' } })).toContain('data-active-tag="TIME"')
            // The chat's portraits reach the strip.
            expect(tabs({ tabMode: { activeTab: '', portraits: { Bram: 'https://pics/bram.png' } } })).toContain('src="https://pics/bram.png"')
        })

        it('makes a Display Group one tab holding the group’s card, keeps the pinned tags out of the groups, and says so with nothing behind the strip', () => {
            const group = { id: 'ops', name: 'Operations', icon: '🚙', enabled: true, members: ['VEHICLE_FUEL', 'TIME', 'CHARACTER'] }
            const html = tabs({ displayGroups: { groups: [group], enabled: true, showGaps: false }, tabMode: { activeTab: 'DISPLAY_GROUP_ops' } })
            expect(html).toContain('data-tab-order="DISPLAY_GROUP_ops,PARTY,QUESTS"')
            expect(html).toContain('data-tag="DISPLAY_GROUP_ops" title="Operations" aria-pressed="true"><span class="rt-tab-icon">🚙</span><span class="rt-tab-badge" title="2 grouped modules">2</span></button>')
            expect(html).toContain('<div class="rt-tabmode-content" data-active-tag="DISPLAY_GROUP_ops"><div class="rt-section rt-display-group-card"')
            expect(html).toContain('data-member-tag="VEHICLE_FUEL"')
            expect(html).toContain('data-member-tag="TIME"')
            expect(html).not.toContain('data-member-tag="CHARACTER"')
            // Only the pinned pair in the memo: nothing behind the strip, and the strip not drawn.
            const bare = renderTabModeHtml(buildTrackerView('[CHARACTER]\nRobin: 30/40 HP\n[/CHARACTER]', settings), { tabMode: { activeTab: '' } })
            expect(bare).toContain('data-tag="CHARACTER"')
            expect(bare).toContain('<div class="rt-empty">No additional modules to display.</div>')
            expect(bare).not.toContain('rt-tab-strip')
            // Everyone away: the camp takes a tab of its own, as it takes a card of its own stacked.
            const away = renderTabModeHtml(buildTrackerView('[BENCHED PARTY]\nTam: 5/5 HP\n[/BENCHED PARTY]\n[TIME]\n06:15 AM, Day 4\n[/TIME]', settings), { tabMode: { activeTab: 'BENCHED PARTY' } })
            expect(away).toContain('data-tab-order="TIME,BENCHED PARTY"')
            expect(away).toContain('data-active-tag="BENCHED PARTY"')
            expect(away).toContain('Tam')
            // No memo: the stacked view's empty state.
            expect(renderTabModeHtml(buildTrackerView('', settings), {})).toContain('rt-empty')
        })
    })

    describe('the Display Groups (75)', () => {
        const memo = ['[ALPHA_STANDING]', 'Alpha Standing: ((BARRED)) 50/100', 'Status: ((PILLS)) Respected', '[/ALPHA_STANDING]', '[TIME]', '06:15 AM, Day 4', '[/TIME]', '[VEHICLE_FUEL]', 'Vehicle Fuel: ((BARRED)) 1000/1000', '[/VEHICLE_FUEL]', '[PARTY]', 'Elara (Ranger): 26/45 HP', 'Skills: Athletics +3', '[/PARTY]'].join('\n')
        const settings = { blockOrder: ['ALPHA_STANDING', 'TIME', 'VEHICLE_FUEL', 'PARTY'], customFields: [{ tag: 'ALPHA_STANDING', label: 'Alpha Standing', icon: '🐺' }, { tag: 'VEHICLE_FUEL', label: 'Vehicle Fuel', icon: '⛽' }] }
        const group = { id: 'vehicle_systems', name: 'Vehicle Systems', icon: '🚙', enabled: true, members: ['VEHICLE_FUEL', 'ALPHA_STANDING'] }
        const grouped = (extra = {}, groups = [group]) => renderTrackerHtml(buildTrackerView(memo, settings), { displayGroups: { groups, enabled: true, showGaps: false }, ...extra })

        it('draws the present members under one host at the first member’s place, in the group’s order, their own headers gone', () => {
            const html = grouped()
            expect(html).toContain('rt-display-group-card')
            expect(html).toContain('data-tag="DISPLAY_GROUP_vehicle_systems"')
            expect(html).toContain('data-display-group-id="vehicle_systems"')
            expect(html).toContain('<span class="rt-section-icon">🚙</span>')
            expect(html).toContain('<span class="rt-section-title">Vehicle Systems</span>')
            expect(html).toContain('<span class="rt-section-count">2 modules</span>')
            expect(html).toContain('data-member-tag="VEHICLE_FUEL"')
            expect(html).toContain('data-member-tag="ALPHA_STANDING"')
            expect(html.indexOf('data-member-tag="VEHICLE_FUEL"')).toBeLessThan(html.indexOf('data-member-tag="ALPHA_STANDING"'))
            expect(html).toContain('Alpha Standing:')
            expect(html).toContain('Vehicle Fuel:')
            expect(html.match(/class="rt-section-header"/g)).toHaveLength(3)
            expect(html).not.toContain('data-tag="ALPHA_STANDING"')
            expect(html).not.toContain('data-tag="VEHICLE_FUEL"')
            // At the first member's place: before TIME, as ALPHA_STANDING was.
            expect(html.indexOf('rt-display-group-card')).toBeLessThan(html.indexOf('data-tag="TIME"'))
            expect(html.indexOf('data-tag="TIME"')).toBeLessThan(html.indexOf('data-tag="PARTY"'))
            expect(html).toContain('rt-display-group-body rt-display-group-body--seamless')
        })

        it('keeps the gaps when asked, folds under the virtual key, and draws the flat cards with the switch off or no group', () => {
            expect(grouped({ displayGroups: { groups: [group], enabled: true, showGaps: true } })).not.toContain('--seamless')
            const folded = grouped({ collapsed: new Set(['DISPLAY_GROUP_vehicle_systems']) })
            expect(folded).toContain('rt-display-group-card rt-section--collapsed')
            expect(folded).toMatch(/rt-display-group-body[^"]*" hidden>/)
            const off = renderTrackerHtml(buildTrackerView(memo, settings), { displayGroups: { groups: [group], enabled: false, showGaps: false } })
            expect(off).not.toContain('rt-display-group')
            expect(off).toContain('data-tag="ALPHA_STANDING"')
            expect(off.match(/class="rt-section-header"/g)).toHaveLength(4)
            expect(renderTrackerHtml(buildTrackerView(memo, settings), { displayGroups: { groups: [], enabled: true, showGaps: false } })).not.toContain('rt-display-group')
            expect(renderTrackerHtml(buildTrackerView(memo, settings))).not.toContain('rt-display-group')
        })

        it('brings a PARTY member’s Compact button and mode up to the host, and skips a group with no member present', () => {
            const party = { id: 'crew', name: 'Crew', icon: '👥', enabled: true, members: ['PARTY', 'NOWHERE'] }
            const html = grouped({ partyCompact: true, partyCompactButton: true }, [party])
            expect(html).toContain('data-tag="DISPLAY_GROUP_crew"')
            expect(html).toContain('<span class="rt-section-count">1 module</span><button type="button" class="rt-party-compact-btn active"')
            expect(html).toContain('<div class="rt-display-group-member rt-party-compact" data-member-tag="PARTY">')
            const absent = grouped({}, [{ id: 'ghost', name: 'Ghost', icon: '👻', enabled: true, members: ['NOWHERE'] }])
            expect(absent).not.toContain('rt-display-group')
            expect(absent.match(/class="rt-section-header"/g)).toHaveLength(4)
        })
    })

    it('draws the TIME card as Multihog does (74c): the hour’s emoji and colour on a clock line, Last Rest with how long ago, a marker as a marker', () => {
        const time = buildTrackerView('[TIME]\nDay 4, 06:15 AM\nLast rest: Day 3, 10:00 PM\nWeather: Rain\n((BAR)) 3/8 Fatigue\n[/TIME]').blocks.find((b) => b.tag === 'TIME')!
        const html = renderBlockCard(time)
        // The clock line, dawn: the legacy's emoji and peach, with the line whole (no colon promoted to a label).
        expect(html).toContain('<div class="rt-card-item rt-card-item--plain rt-card-line"><span class="rt-tod-emoji" style="margin-right:4px;">🌅</span><span style="color: #ffccaa;">Day 4, 06:15 AM</span></div>')
        // The rest, with the elapsed against the clock.
        expect(html).toContain('<div class="rt-card-item rt-card-item--plain rt-card-line"><b>Last Rest:</b>&nbsp;Day 3, 10:00 PM&nbsp;<span style="opacity: 0.7; font-size: 1em;">(8 hours 15 minutes ago)</span></div>')
        // A line with no clock keeps the plain drawing, uncoloured; a marker line is its marker.
        expect(html).toContain('<div class="rt-card-item rt-card-item--plain rt-card-line">Weather: Rain</div>')
        expect(html).toContain('rt-hp-bar')
        expect(html).not.toContain('rt-card-kv')
        // A rest that is unset, or later than the clock, gets no elapsed; a rest with no clock to count from neither.
        expect(renderBlockCard(buildTrackerView('[TIME]\n06:15 AM\nLast rest: N/A\n[/TIME]').blocks[0]!)).toContain('<b>Last Rest:</b>&nbsp;N/A</div>')
        expect(renderBlockCard(buildTrackerView('[TIME]\nDay 2, 06:15 AM\nLast rest: Day 3, 10:00 PM\n[/TIME]').blocks[0]!)).toContain('<b>Last Rest:</b>&nbsp;Day 3, 10:00 PM</div>')
        expect(renderBlockCard(buildTrackerView('[TIME]\nMorning\nLast rest: Day 3, 10:00 PM\n[/TIME]').blocks[0]!)).toContain('<b>Last Rest:</b>&nbsp;Day 3, 10:00 PM</div>')
        // Night, with a `Time:` prefix as some models write it.
        expect(renderBlockCard(buildTrackerView('[TIME]\nTime: 11:30 PM, Day 2\n[/TIME]').blocks[0]!)).toContain('🌃</span><span style="color: #7777ee;">Time: 11:30 PM, Day 2</span>')
    })

    it('draws the XP card as Multihog does (74f): the stock Total line and the older Level | XP line as the experience row, a marker as a marker, the rest as it was', () => {
        const memo = '[XP]\nTotal: 1,200 / 2,700 XP (Level 3)\nNext: a new feat\n[/XP]'
        const html = renderBlockCard(buildTrackerView(memo).blocks[0]!)
        expect(html).toContain('<div class="rt-xp-row" data-xp-current="1200" data-xp-max="2700" data-xp-level="3" data-xp-show-percentage="false">')
        expect(html).toContain('<div class="rt-xp-label"><span>Level 3</span><span>XP: <span class="rt-xp-current">1,200</span> / <span class="rt-xp-max">2,700</span></span></div>')
        expect(html).toContain('<div class="rt-xp-bar" style="width:44.4%;')
        // The line that is not an XP line keeps its pair.
        expect(html).toContain('<span class="rt-card-key">Next:</span>')
        // The older format, with and without its level; a marker line is its marker.
        const older = renderBlockCard(buildTrackerView('[XP]\nLevel: 2 | XP: 450/1000\n[/XP]').blocks[0]!)
        expect(older).toContain('data-xp-current="450" data-xp-max="1000" data-xp-level="2"')
        expect(older).toContain('<span>Level 2</span>')
        // The row's recolour handle under the legacy's own id (74i), the stored config drawn through the resolver, the readout as a percentage when asked.
        expect(html).toContain('<div class="rt-xp-bar-wrap" data-recolor-id="XP::XP" data-recolor-current="linear-gradient(90deg, #00c88c, #00d4ff)" title="Click to recolor XP" data-recolor-percent="true">')
        const styled = renderBlockCard(buildTrackerView(memo).blocks[0]!, { bars: { 'XP::XP': { color: '#123456', showAsPercentage: true } } })
        expect(styled).toContain('data-recolor-current="#123456"')
        expect(styled).toContain('background:#123456;')
        expect(styled).toContain('data-xp-show-percentage="true"')
        expect(styled).toContain('<span class="rt-xp-current">44</span> / <span class="rt-xp-max">100</span>')
        expect(renderBottomXpBar(buildTrackerView(memo), { 'XP::XP': { mode: 'dynamic' } })).toContain('data-recolor-current="#ffaa00"')
        const bare = renderBlockCard(buildTrackerView('[XP]\nXP: 450/1000\n[/XP]').blocks[0]!)
        expect(bare).toContain('data-xp-level=""')
        expect(bare).not.toContain('<span>Level')
        expect(renderBlockCard(buildTrackerView('[XP]\n((XPBAR)) 450/1000 Level 3\n[/XP]').blocks[0]!)).toContain('rt-entity-sub-line rt-xp-row')
    })

    it('draws the XP bar at the bottom from the XP block alone, and leaves the XP card out of the cards while it stands (74f)', () => {
        const view = buildTrackerView('[XP]\nTotal: 1,200 / 2,700 XP (Level 3)\nNext: a new feat\n[/XP]\n\n[TIME]\n08:00 AM, Day 2\n[/TIME]')
        const bar = renderBottomXpBar(view)
        expect(bar.startsWith('<div class="rt-bottom-xp-content"><div class="rt-xp-row" data-xp-current="1200"')).toBe(true)
        expect(bar).toContain('XP: <span class="rt-xp-current">1,200</span>')
        expect(bar).not.toContain('Next:')
        // A marker row is the bar too; a block with no row, or a memo with no XP block, gives nothing.
        expect(renderBottomXpBar(buildTrackerView('[XP]\n((XPBAR)) 450/1000 Level 3\n[/XP]'))).toContain('rt-entity-sub-line rt-xp-row')
        expect(renderBottomXpBar(buildTrackerView('[XP]\nNext: a new feat\n[/XP]'))).toBe('')
        expect(renderBottomXpBar(buildTrackerView('[TIME]\n08:00 AM, Day 2\n[/TIME]'))).toBe('')
        // The cards: with the option, no XP card; without it, the card as before.
        expect(renderTrackerHtml(view, { xpBarAtBottom: true })).not.toContain('data-tag="XP"')
        expect(renderTrackerHtml(view, { xpBarAtBottom: true })).toContain('data-tag="TIME"')
        expect(renderTrackerHtml(view)).toContain('data-tag="XP"')
    })

    it('shows an empty state rather than nothing at all', () => {
        expect(renderTrackerHtml(buildTrackerView(''))).toContain('rt-empty')
    })
})

describe('quest cards', () => {
    const SHEEP = [
        'QUEST: The Missing Sheep',
        '  ID: quest_1',
        '  STATUS: active',
        '  GIVER: Farmer Hemwick @ Crestwood Mill',
        '  ACCEPTED: 08:00 AM, Day 1',
        '  DEADLINE: 08:00 AM, Day 2',
        '  OBJ_ACTIVE: Collect mushrooms [4/6]',
        '  OBJ_COMPLETED: Ask about the wolf',
        '  OBJ_ACTIVE: Bring a lantern (optional)',
        '  REWARD: 100 GP',
    ]
    const ALL_ON = { showDeadlines: true, showFrustration: true, showArchive: true }
    const log = (lines: string[], now = '08:00 PM, Day 1', settings = ALL_ON) =>
        buildQuestLogView(parseQuestsFromText(lines.join('\n')), now, settings)
    const card = (lines: string[], now?: string, settings?: typeof ALL_ON) => renderQuestCard(log(lines, now, settings).active[0]!)

    it('draws the title, the giver and the status badge', () => {
        const html = card(SHEEP)
        expect(html).toContain('The Missing Sheep')
        expect(html).toContain('Farmer Hemwick')
        expect(html).toContain('Crestwood Mill')
        expect(html).toContain('rt-quest-badge--active')
        expect(html).toContain('data-quest-id="quest_1"')
    })

    it('draws each objective with its tick, its counter and its optional mark', () => {
        const html = card(SHEEP)
        expect(html).toContain('Collect mushrooms')
        expect(html).toContain('<span class="rt-quest-progress">4/6</span>')
        expect(html).toContain('rt-quest-obj--done')
        expect(html).toContain('(optional)')
    })

    it('draws the rewards as chips', () => {
        expect(card(SHEEP)).toContain('<span class="rt-quest-reward">🎁 100 GP</span>')
    })

    it('draws both time rows with the gap worked out', () => {
        const html = card(SHEEP, '02:00 AM, Day 2')
        expect(html).toContain('18 hours ago')
        expect(html).toContain('6 hours left')
    })

    it('marks an overdue deadline so it reads as one', () => {
        expect(card(SHEEP, '11:00 AM, Day 2')).toContain('rt-quest-time--overdue')
    })

    it('draws the mood bar at the position the view model worked out', () => {
        // A third along is the neutral tick, which is the deadline moment.
        expect(card(SHEEP, '08:00 AM, Day 2')).toContain('width:33%')
    })

    it('keeps the mood bar inside the deadline row, so hiding one hides both', () => {
        const html = card(SHEEP, '08:00 AM, Day 2', { ...ALL_ON, showDeadlines: false })
        expect(html).not.toContain('rt-quest-mood-bar')
        expect(html).not.toContain('Deadline:')
    })

    it('draws no mood bar for a quest nobody is waiting on', () => {
        const html = card(['QUEST: Learn to swim', '  GIVER: Self', '  DEADLINE: 08:00 AM, Day 2'])
        expect(html).not.toContain('rt-quest-mood-bar')
        // No giver location either: "Self @ Unknown" is noise.
        expect(html).not.toContain('Unknown')
    })

    it('escapes what the model wrote', () => {
        const html = card(['QUEST: <script>alert(1)</script>', '  GIVER: <b>x</b> @ y'])
        expect(html).not.toContain('<script>')
        expect(html).toContain('&lt;script&gt;')
    })

    it('says so when there is nothing to do', () => {
        expect(renderQuestLog({ active: [], completed: [], failed: [], activeCount: 0 })).toContain('No active quests.')
    })

    describe('in a block card', () => {
        const MEMO = ['[TIME]', '08:00 AM, Day 2', '[/TIME]', '[QUESTS]', ...SHEEP, '[/QUESTS]'].join('\n')
        const questBlock = (memo = MEMO) =>
            buildTrackerView(memo, { syspromptModules: { questsDeadlines: true, questsShowArchive: true } }).blocks.find(
                (b) => b.tag === 'QUESTS',
            )!

        it('draws the quest log instead of the memo lines', () => {
            const html = renderBlockCard(questBlock())
            expect(html).toContain('rt-quest-card')
            // The raw `ID: quest_1` line would be there if the generic path ran.
            expect(html).not.toContain('rt-card-key')
        })

        it('counts the active quests in the header', () => {
            expect(renderBlockCard(questBlock())).toContain('<span class="rt-section-count">1 active</span>')
        })

        it('falls back to the memo lines when the quest grammar could not read the block', () => {
            const html = renderBlockCard(questBlock('[QUESTS]\nGo and find the sheep, somehow\n[/QUESTS]'))
            expect(html).toContain('Go and find the sheep, somehow')
            expect(html).not.toContain('rt-quest-card')
        })

        it('gives no other block a count', () => {
            const xp = buildTrackerView('[XP]\n((XPBAR)) 450/1000\n[/XP]').blocks[0]!
            expect(renderBlockCard(xp)).not.toContain('rt-section-count')
        })
    })

    describe('the archive', () => {
        const MIXED = [
            ...SHEEP,
            'QUEST: The Rat Cellar',
            '  ID: quest_2',
            '  STATUS: completed',
            'QUEST: The Burned Bridge',
            '  ID: quest_3',
            '  STATUS: failed',
        ]

        it('puts finished quests in their own folded sections', () => {
            const html = renderQuestLog(log(MIXED))
            expect(html).toContain('data-tag="QUESTS_COMPLETED"')
            expect(html).toContain('data-tag="QUESTS_FAILED"')
            expect(html).toContain('1 entry')
        })

        it('folds them away by default — the log is about what is still open', () => {
            expect(renderQuestLog(log(MIXED))).toContain('aria-expanded="false"')
        })

        it('opens one that has been asked for', () => {
            const html = renderQuestLog(log(MIXED), { collapsed: new Set(['QUESTS_FAILED']) })
            expect(html).toContain('<span class="rt-section-title">Completed</span>')
            expect(html.match(/aria-expanded="true"/g)).toHaveLength(1)
        })

        it('draws no section at all when there is nothing archived', () => {
            const html = renderQuestLog(log(SHEEP))
            expect(html).not.toContain('QUESTS_COMPLETED')
            expect(html).not.toContain('QUESTS_FAILED')
        })
    })
})

describe('entity cards', () => {
    const draw = (content: string, tag = 'COMBAT') => renderEntityBlock(buildEntityBlockView(content, tag)!)

    it('draws the name and the hit-point bar as the card header', () => {
        const html = draw('Brenna: 12/20 HP')
        expect(html).toContain('rt-entity-card')
        expect(html).toContain('Brenna')
        expect(html).toContain('width:60.0%')
        expect(html).toContain('<span class="rt-hp-label">12/20</span>')
        expect(html).toContain('data-rt-bar-id="COMBAT:Brenna:HP"')
    })

    it('writes the entity’s hit points beside its bar id (74h), animated by its own tick alone as the legacy’s native bars are, and nothing for an unknown range', () => {
        const line = 'Brenna: 12/20 HP | Status: Wounded'
        const plain = draw(line)
        expect(plain).toContain('data-rt-bar-id="COMBAT:Brenna:HP" data-rt-bar-current="12" data-rt-bar-max="20" data-rt-bar-kind="linear" data-rt-bar-animate="false"')
        const switched = renderEntityBlock(buildEntityBlockView(line, 'COMBAT', { animateCustomBars: true })!)
        expect(switched).toContain('data-rt-bar-animate="false"')
        const ticked = renderEntityBlock(buildEntityBlockView(line, 'COMBAT', { bars: { 'COMBAT:Brenna:HP': { animateChanges: true } } })!)
        expect(ticked).toContain('data-rt-bar-id="COMBAT:Brenna:HP" data-rt-bar-current="12" data-rt-bar-max="20" data-rt-bar-kind="linear" data-rt-bar-animate="true"')
        expect(draw('Wraith: ??/?? HP')).not.toContain('data-rt-bar-current')
        expect(draw('Wraith: 12 HP')).not.toContain('data-rt-bar-current')
        // The recolour handle on the entity's bar (74i): its fill now, whether the line coloured it, the legacy's title; a stored config draws through the resolver.
        expect(plain).toContain('data-rt-bar-animate="false" data-recolor-id="COMBAT:Brenna:HP" data-recolor-current="#ffaa00" data-recolor-explicit-color="false" title="Click to recolor HP" data-recolor-percent="true"')
        expect(draw('Brenna ((BARGREEN)) 12/20 HP')).toContain('data-recolor-current="GREEN" data-recolor-explicit-color="true"')
        const gradient = renderEntityBlock(buildEntityBlockView(line, 'COMBAT', { bars: { 'COMBAT:Brenna:HP': { mode: 'gradient', color: '#111111', color2: '#222222' } } })!)
        expect(gradient).toContain('background:linear-gradient(90deg, #111111, #222222);')
        expect(gradient).toContain('data-recolor-current="linear-gradient(90deg, #111111, #222222)"')
        // A custom bar on an entity's own line follows the switch, as a block's does.
        expect(renderEntityBlock(buildEntityBlockView('Brenna: 12/20 HP\nMorale: ((BAR)) 4/10', 'COMBAT', { animateCustomBars: true })!)).toContain('data-rt-bar-id="COMBAT:Brenna::Morale[L0]" data-rt-bar-current="4" data-rt-bar-max="10" data-rt-bar-kind="linear" data-rt-bar-animate="true"')
    })

    it('draws no bar for an entity that has no hit points', () => {
        const html = draw('Brenna Stonefoot: Dwarf Cleric', 'CHARACTER')
        expect(html).toContain('Brenna Stonefoot')
        expect(html).not.toContain('rt-hp-bar-wrap')
    })

    it('draws the labelled fields, with statuses as pills', () => {
        const html = draw('Brenna: 12/20 HP | AC: 15 | Status: Prone, Bleeding')
        expect(html).toContain('AC:')
        expect(html).toContain('15')
        expect(html).toContain('rt-unit-pill')
        expect(html).toContain('Prone')
        expect(html).toContain('Bleeding')
    })

    it('draws the hanging lines with their own markers intact', () => {
        const html = draw(['Goblin: 7/12 HP', 'Morale: ((BAR)) 3/10'].join('\n'))
        expect(html).toContain('rt-hp-bar')
        expect(html).toContain('Morale')
    })

    it('marks a defeated combatant instead of dropping them', () => {
        // The party can still see the body; a name that vanishes reads as a
        // rendering fault.
        const html = draw('Bandit: 0/30 HP | Status: Defeated')
        expect(html).toContain('rt-entity-card--defeated')
        expect(html).toContain('Bandit')
    })

    it('marks an unknown bar so it does not read as a full one', () => {
        expect(draw('Shadow: ?/? HP')).toContain('rt-hp-unknown')
    })

    it('draws the round and side headers', () => {
        const html = draw(['Combat Round 2', 'ENEMIES:', 'Goblin: 7/12 HP'].join('\n'))
        expect(html).toContain('<div class="rt-combat-round">Combat Round 2</div>')
        expect(html).toContain('rt-combat-side--enemies')
        expect(html).toContain('rt-entity-card--enemies')
    })

    it('gives a headerless combatant no side colouring', () => {
        const html = draw('Brenna: 12/20 HP')
        expect(html).not.toContain('rt-entity-card--enemies')
        expect(html).not.toContain('rt-entity-card--allies')
    })

    it('escapes what the model wrote', () => {
        const html = draw('<script>alert(1)</script>: 1/1 HP | Status: <b>x</b>')
        expect(html).not.toContain('<script>')
        expect(html).toContain('&lt;script&gt;')
    })

    describe('in a block card', () => {
        const block = (memo: string, tag = 'COMBAT') =>
            buildTrackerView(memo).blocks.find((b) => b.tag === tag)!

        it('draws entity cards instead of the memo lines', () => {
            const html = renderBlockCard(block('[COMBAT]\nGoblin: 7/12 HP\nNotes: on the roof\n[/COMBAT]'))
            expect(html).toContain('rt-entity-card')
            // The note hangs off the goblin as a sub-line, not as the
            // block-level kv row the generic path would have given it.
            expect(html).toContain('rt-entity-sub-label')
            expect(html).not.toContain('rt-card-key')
        })

        it('counts the entities in the header', () => {
            const html = renderBlockCard(block('[PARTY]\nBrenna: 12/20 HP\nAnsel: 9/18 HP\n[/PARTY]', 'PARTY'))
            expect(html).toContain('<span class="rt-section-count">2 entries</span>')
        })

        it('falls back to plain lines when nothing anchored', () => {
            const html = renderBlockCard(block('[COMBAT]\nThe room is quiet.\n[/COMBAT]'))
            expect(html).toContain('The room is quiet.')
            expect(html).not.toContain('rt-entity-card')
        })

        it('leaves a block without the entity grammar alone', () => {
            const xp = buildTrackerView('[XP]\n((XPBAR)) 450/1000\n[/XP]').blocks[0]!
            expect(xp.entities).toBeUndefined()
            expect(renderBlockCard(xp)).not.toContain('rt-entity-card')
        })
    })
})

describe('drawing a portrait', () => {
    const card = (portrait: string) =>
        renderEntityCard({
            name: 'Moth Wraith',
            portrait,
            hp: null,
            fields: [],
            lines: [],
            side: 'enemies',
            defeated: false,
        })

    it('draws the picture when the card has one', () => {
        const html = card('/rat.png')
        expect(html).toContain('<img class="rt-entity-portrait" src="/rat.png"')
        expect(html).toContain('loading="lazy"')
    })

    it('leaves an empty alt, because the name is beside it in text', () => {
        expect(card('/rat.png')).toContain('alt=""')
    })

    it('marks the picture as one a click opens large, titled with the name (Phase 64)', () => {
        const html = card('/rat.png')
        expect(html).toContain('data-lh-large="Moth Wraith"')
        expect(html).toContain('role="button" tabindex="0" title="Open the picture large"')
    })

    it('draws no image at all when there is none', () => {
        expect(card('')).not.toContain('rt-entity-portrait')
    })

    it('escapes the reference on the way in', () => {
        expect(card('/rat.png" onerror="alert(1)')).not.toContain('onerror="alert(1)"')
    })
})

describe('reading a bar as a percentage', () => {
    const line = (bars = {}) =>
        renderLine(parseBlockLine('Attunement: ((BAR)) 640/1000', { tag: 'WAYSTONE', lineIndex: 0, bars }))

    it('draws the numbers the model wrote by default', () => {
        expect(line()).toContain('640/1000')
    })

    it('draws a percentage when the user asked for one', () => {
        // Not a second calculation: the renderer already has the percentage,
        // because it draws the bar's width with it.
        const html = line({ 'WAYSTONE::Attunement[L0]': { showAsPercentage: true } })
        expect(html).toContain('64%')
        expect(html).not.toContain('640/1000')
    })

    it('keeps the trailing note beside the percentage', () => {
        const html = renderLine(
            parseBlockLine('Attunement: ((BAR)) 640/1000 (Harmonious)', {
                tag: 'WAYSTONE',
                lineIndex: 0,
                bars: { 'WAYSTONE::Attunement[L0]': { showAsPercentage: true } },
            }),
        )
        expect(html).toContain('64%')
        expect(html).toContain('Harmonious')
    })

    it('fills with the colour the user picked', () => {
        expect(line({ 'WAYSTONE::Attunement[L0]': { color: '#ff8800' } })).toContain('background:#ff8800')
    })
})

describe('the benched roster', () => {
    const MEMO = [
        '[PARTY]', '- Benedek (Noble 2): 16/16 HP', 'Combat: BAB: +1', 'Status: Healthy', '[/PARTY]', '',
        '[BENCHED PARTY]', '- Oswin (Guard 1): 9/11 HP', 'Combat: BAB: +1', 'Status: Benched (07:00 AM, Day 4, stayed with the horse)', '[/BENCHED PARTY]',
    ].join('\n')

    // From Phase 6 to Phase 28 the benched block was held aside for the PARTY
    // card and then never drawn; looking at it with a benched member caught it.
    it('draws the benched members inside the PARTY card, as a camp', () => {
        const html = renderTrackerHtml(buildTrackerView(MEMO))
        expect(html).toContain('Oswin')
        expect(html).toContain('stayed with the horse')
        expect(html).toContain('rt-benched')
        expect(html).toContain('1 away')
        // Inside the PARTY card, not a card of its own.
        expect(html.indexOf('rt-benched')).toBeGreaterThan(html.indexOf('data-tag="PARTY"'))
        expect(html.match(/data-tag="BENCHED PARTY"/g)).toHaveLength(1)
        expect(html.match(/rt-section-header/g)).toHaveLength(1)
    })

    it('draws the benched roster as its own card when nobody is left in the party', () => {
        const html = renderTrackerHtml(buildTrackerView(MEMO.slice(MEMO.indexOf('[BENCHED PARTY]'))))
        expect(html).toContain('Oswin')
        expect(html.match(/rt-section-header/g)).toHaveLength(1)
        expect(html).not.toContain('rt-benched')
    })

    it('draws nothing extra when nobody is benched', () => {
        const html = renderTrackerHtml(buildTrackerView(MEMO.slice(0, MEMO.indexOf('[BENCHED PARTY]'))))
        expect(html).not.toContain('rt-benched')
        expect(html).not.toContain('BENCHED')
    })
})

describe('the PARTY compact mode and the bare row (47e-ter)', () => {
    const memo = [
        '[PARTY]', 'Elara (Ranger): 26/45 HP', 'Skills: Athletics +3', '[/PARTY]',
        '[COMBAT]', 'Round 1', 'Enemies:', 'Wolf: 5/9 HP', 'Skills: Bite +4', '[/COMBAT]',
    ].join('\n')
    // The section's class, not the button's: `rt-party-compact"` ends the attribute, `rt-party-compact-btn` does not.
    const count = (html: string, cls: string) => (html.match(new RegExp(`${cls}"`, 'g')) ?? []).length

    it('marks the PARTY card compact and nothing else, and draws its button pressed', () => {
        const html = renderTrackerHtml(buildTrackerView(memo), { partyCompact: true, partyCompactButton: true })
        expect(count(html, 'rt-party-compact')).toBe(1)
        expect(html).toMatch(/rt-section rt-party-compact" data-tag="PARTY"/)
        expect(html).not.toMatch(/rt-party-compact" data-tag="COMBAT"/)
        expect((html.match(/rt-party-compact-btn/g) ?? []).length).toBe(1)
        expect(html).toContain('rt-party-compact-btn active')
        expect(html).toContain('aria-pressed="true"')
    })

    it('draws the button unpressed when the mode is off, and no button for the cards under messages', () => {
        const off = renderTrackerHtml(buildTrackerView(memo), { partyCompactButton: true })
        expect(count(off, 'rt-party-compact')).toBe(0)
        expect(off).toContain('rt-party-compact-btn"')
        expect(off).toContain('aria-pressed="false"')
        const cards = renderTrackerHtml(buildTrackerView(memo), { partyCompact: true })
        expect(count(cards, 'rt-party-compact')).toBe(1)
        expect(cards).not.toContain('rt-party-compact-btn')
    })

    it('marks a row with no HP bar as bare, so the name may take the width', () => {
        const bare = renderEntityCard({ name: 'Elara', fields: [], lines: [] } as never)
        expect(bare).toContain('rt-entity-row rt-entity-row--bare')
        const html = renderTrackerHtml(buildTrackerView(memo))
        expect(html).not.toContain('rt-entity-row--bare')
    })
})

describe('the inventory’s worth on the card (72b)', () => {
    const block = () => ({ tag: 'INVENTORY', label: 'Inventory', icon: '🎒', lines: [
        { kind: 'text' as const, text: '- Volcanic Mace (+1 / 2d6+3) (~120 GP) [E]' },
        { kind: 'text' as const, text: '- 45 GP' },
        { kind: 'text' as const, text: '- Rope, 50 ft' },
        { kind: 'kv' as const, label: 'Carried', value: 'light' },
    ] })
    it('draws the lines as they are without the option, the worth as a tooltip in hover mode, a badge in display mode, and the total in the header when asked', () => {
        const plain = renderBlockCard(block() as never)
        expect(plain).toContain('- Volcanic Mace (+1 / 2d6+3) (~120 GP) [E]')
        expect(plain).not.toContain('rt-inventory-item')
        const hover = renderBlockCard(block() as never, { inventory: { showTotal: false, worthMode: 'hover' } })
        expect(hover).toContain('<div class="rt-card-item rt-inventory-item rt-inventory-item--equipped" title="Effect: +1 / 2d6+3\nWorth: 120 GP">Volcanic Mace</div>')
        expect(hover).not.toContain('rt-coin-badge">120 GP')
        expect(hover).toContain('<span class="rt-coin-badge" style="color:#ffd700">45 GP</span>')
        expect(hover).toContain('>Rope, 50 ft</div>')
        expect(hover).toContain('rt-card-key')
        expect(hover).not.toContain('rt-total-value-badge')
        const display = renderBlockCard(block() as never, { inventory: { showTotal: true, worthMode: 'display' } })
        expect(display).toContain('Volcanic Mace <span class="rt-coin-badge" style="color:#ffd700">120 GP</span></div>')
        expect(display).toContain('<span class="rt-section-count rt-total-value-badge" title="Total value of the inventory">165 GP</span>')
        // Another block is never read for worth.
        const other = renderBlockCard({ ...block(), tag: 'ABILITIES', label: 'Abilities' } as never, { inventory: { showTotal: true, worthMode: 'display' } })
        expect(other).not.toContain('rt-inventory-item')
    })
})
