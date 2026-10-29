// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { LEGACY_DAY_NIGHT, LEGACY_MOON_PHASES } from './themes-legacy.js'
import { DAY_NIGHT_CLASS, DAY_NIGHT_CSS, DAY_PHASES, MOON_PHASES, applyDayNightCycle, applyDayNightPhase, currentClockFromMemo, getTimeOfDayInfo, phaseClass, phaseFromMemo, phaseLabel, renderDayNightBadge } from './day-night.js'

describe('the day/night cycle (74c)', () => {
    it('reads the hour off any clock string as Multihog does: the seven phases at the legacy’s boundaries, AM/PM, and no clock as -1', () => {
        expect(DAY_PHASES).toEqual(['lateNight', 'dawn', 'morning', 'midday', 'afternoon', 'sunset', 'night'])
        const at = (clock: string) => getTimeOfDayInfo(clock)
        expect(at('Day 4, 04:59 AM')).toEqual({ hour: 4, emoji: '🌙', color: '#9999ff', phase: 'lateNight' })
        expect(at('05:00 AM').phase).toBe('dawn')
        expect(at('06:59 AM').phase).toBe('dawn')
        expect(at('07:00 AM')).toEqual({ hour: 7, emoji: '☀️', color: '#ffffbb', phase: 'morning' })
        expect(at('11:59 AM').phase).toBe('morning')
        expect(at('12:00 PM')).toEqual({ hour: 12, emoji: '🌞', color: '#ffffff', phase: 'midday' })
        expect(at('13:59').phase).toBe('midday')
        expect(at('2:00 PM').phase).toBe('afternoon')
        expect(at('17:59').phase).toBe('afternoon')
        expect(at('6:00 PM')).toEqual({ hour: 18, emoji: '🌇', color: '#ffaa55', phase: 'sunset' })
        expect(at('19:59').phase).toBe('sunset')
        expect(at('8:00 PM')).toEqual({ hour: 20, emoji: '🌃', color: '#7777ee', phase: 'night' })
        expect(at('11:59 PM').phase).toBe('night')
        // Midnight: 12 AM is hour 0; 12 PM stays 12.
        expect(at('12:00 AM').hour).toBe(0)
        expect(at('12:30 pm').hour).toBe(12)
        // No clock, a bad hour, or nothing at all.
        expect(at('Day 4')).toEqual({ hour: -1, emoji: '', color: 'inherit', phase: '' })
        expect(at('25:00').hour).toBe(-1)
        expect(at('').hour).toBe(-1)
        expect(getTimeOfDayInfo(null).hour).toBe(-1)
        expect(MOON_PHASES).toEqual(['lateNight', 'night'])
        expect(LEGACY_MOON_PHASES).toEqual(MOON_PHASES)
    })

    it('reads the phase off a memo’s [TIME] block — the first line that is not the rest — and nothing off a memo without one', () => {
        const memo = '[CHARACTER]\nName: Juniper\n[/CHARACTER]\n[TIME]\nLast rest: Day 3, 10:00 PM\nDay 4, 06:15 AM\n[/TIME]'
        expect(currentClockFromMemo(memo)).toBe('Day 4, 06:15 AM')
        expect(phaseFromMemo(memo)).toBe('dawn')
        expect(phaseFromMemo('[TIME]\nTime: 11:30 PM\n[/TIME]')).toBe('night')
        expect(phaseFromMemo('[TIME]\nDay 4, morning\n[/TIME]')).toBe('')
        expect(phaseFromMemo('[XP]\n1/2\n[/XP]')).toBe('')
        expect(phaseFromMemo('')).toBe('')
        expect(phaseFromMemo(null)).toBe('')
    })

    it('puts the phase on the body as its class, one at a time, and the switch as its own', () => {
        const body = document.createElement('div')
        body.classList.add('lh-theme-hacker')
        expect(applyDayNightPhase(body, '[TIME]\n09:40 AM\n[/TIME]')).toBe('morning')
        expect(Array.from(body.classList)).toEqual(['lh-theme-hacker', 'lh-phase-morning'])
        expect(applyDayNightPhase(body, '[TIME]\n09:40 PM\n[/TIME]')).toBe('night')
        expect(Array.from(body.classList)).toEqual(['lh-theme-hacker', 'lh-phase-night'])
        expect(applyDayNightPhase(body, '')).toBe('')
        expect(Array.from(body.classList)).toEqual(['lh-theme-hacker'])
        applyDayNightCycle(body, true)
        expect(body.classList.contains(DAY_NIGHT_CLASS)).toBe(true)
        applyDayNightCycle(body, false)
        expect(body.classList.contains('lh-daynight')).toBe(false)
        expect(phaseClass('lateNight')).toBe('lh-phase-lateNight')
    })

    it('draws the badge as Multihog draws it: the disc, the stars behind the moon only, the phase in words on hover, nothing for no clock', () => {
        expect(renderDayNightBadge('Day 2, 11:30 PM')).toBe('<span class="lh-sky-badge lh-sky-night" title="In-world time of day: night"><span class="lh-sky-stars"></span><span class="lh-sky-disc"></span></span>')
        expect(renderDayNightBadge('03:00 AM')).toContain('lh-sky-lateNight" title="In-world time of day: late night"><span class="lh-sky-stars">')
        expect(renderDayNightBadge('09:40 AM')).toBe('<span class="lh-sky-badge lh-sky-morning" title="In-world time of day: morning"><span class="lh-sky-disc"></span></span>')
        expect(renderDayNightBadge('Day 2')).toBe('')
        expect(renderDayNightBadge(undefined)).toBe('')
        expect(phaseLabel('lateNight')).toBe('late night')
    })

    it('registers the nine colours under their twins with the legacy’s initial values, and crossfades them over the legacy’s two seconds', () => {
        for (const [name, initial] of Object.entries(LEGACY_DAY_NIGHT.properties)) {
            expect(DAY_NIGHT_CSS).toContain(`@property ${name.replace('--rt-', '--lh-dn-')} {\n    syntax: '<color>';\n    inherits: true;\n    initial-value: ${initial};\n}`)
        }
        // Never the token itself: a registered --lh-bg would never fall back to the host's colour.
        expect(DAY_NIGHT_CSS).not.toMatch(/@property --lh-(bg|text|accent)[\w-]* \{/)
        expect(DAY_NIGHT_CSS).not.toContain('--rt-')
        const transition = DAY_NIGHT_CSS.match(/\.lh-daynight \{\n    transition:\n([\s\S]*?);\n\}/)![1]!
        expect(transition.split(',\n').map((s) => s.trim())).toEqual(['--lh-dn-bg 2s ease', '--lh-dn-text 2s ease', '--lh-dn-text-muted 2s ease', '--lh-dn-accent 2s ease', '--lh-dn-accent-dim 2s ease', '--lh-dn-accent-bg 2s ease', '--lh-dn-header-bg 2s ease', '--lh-dn-card-bg 2s ease', '--lh-dn-card-header 2s ease'])
        expect(LEGACY_DAY_NIGHT.transitions).toContain('--rt-bg 2s ease')
    })

    it('points each token at its twin under the switch and a phase, and sets the seven palettes with the legacy’s values', () => {
        const mapping = DAY_NIGHT_CSS.match(/\.lh-daynight\.lh-phase-lateNight,\n[\s\S]*?\.lh-daynight\.lh-phase-night \{([^}]*)\}/)![1]!
        expect(mapping).toContain('--lh-bg: var(--lh-dn-bg);')
        expect(mapping).toContain('--lh-card-header: var(--lh-dn-card-header);')
        expect(mapping).not.toContain('--lh-shadow')
        for (const [phase, vars] of Object.entries(LEGACY_DAY_NIGHT.phases)) {
            // After a `}`: the mapping rule's last selector is the night's on its own line.
            const block = DAY_NIGHT_CSS.match(new RegExp(`\\}\\n\\.lh-daynight\\.lh-phase-${phase} \\{([^}]*)\\}`))
            expect(block, phase).not.toBeNull()
            for (const [name, value] of Object.entries(vars)) {
                const twin = name in LEGACY_DAY_NIGHT.properties ? name.replace('--rt-', '--lh-dn-') : name.replace('--rt-', '--lh-')
                expect(block![1], `${phase} ${name}`).toContain(`${twin}: ${value};`)
            }
            expect(block![1]).toContain('--lh-accent-contrast: #0a0a0a;')
        }
        expect(DAY_NIGHT_CSS).toContain('--lh-dn-accent: #8899ff;')
        expect(DAY_NIGHT_CSS).toContain('--lh-shadow: 0 8px 32px rgba(0, 0, 20, 0.7), inset 0 0 30px rgba(40, 50, 120, 0.08);')
        // The phase alone paints nothing: every palette rule needs the switch's class.
        expect(DAY_NIGHT_CSS).not.toMatch(/^\.lh-phase-/m)
        // The scrims are sliced for the backdrops (74d), seven of them.
        expect(Object.keys(LEGACY_DAY_NIGHT.overlays)).toEqual(DAY_PHASES)
    })

    it('carries the badge, the slot and the starfield rules under AdventureTime’s names, the slot hidden until the switch and the stars shown by the night phases', () => {
        expect(DAY_NIGHT_CSS).toContain('.lh-sky-slot { display: none; }')
        expect(DAY_NIGHT_CSS).toContain('.lh-daynight .lh-sky-slot {\n    flex: 0 0 auto;\n    display: flex;')
        expect(DAY_NIGHT_CSS).toContain('.lh-sky-slot:empty {\n    display: none;\n}')
        expect(DAY_NIGHT_CSS).toContain('.lh-sky-dawn .lh-sky-disc {\n    background: radial-gradient(circle at 35% 35%, #fff2cc, #ffaa55);')
        expect(DAY_NIGHT_CSS).toContain('.lh-sky-night .lh-sky-disc,\n.lh-sky-lateNight .lh-sky-disc {')
        expect(DAY_NIGHT_CSS).toContain('@keyframes lh-sky-twinkle {')
        expect(DAY_NIGHT_CSS).toContain('animation: lh-sky-twinkle 3s ease-in-out infinite;')
        expect(DAY_NIGHT_CSS).toContain('.lh-daynight .lh-sky-badge {\n    width: 28px;')
        expect(DAY_NIGHT_CSS).toContain('.lh-daynight.lh-phase-night .lh-head-starfield,\n.lh-daynight.lh-phase-lateNight .lh-head-starfield {\n    display: block;\n}')
        expect(DAY_NIGHT_CSS).toContain('.lh-head-starfield::before {\n    animation: lh-head-star-twinkle 4.2s ease-in-out infinite;')
        expect(DAY_NIGHT_CSS).toContain('.lh-tracker-head { position: relative; overflow: visible; }')
        // Nothing of the legacy's names or ids is left, and no comment's mojibake came along.
        expect(DAY_NIGHT_CSS).not.toMatch(/rt-sky|rt-daynight|rt-header-starfield|rpg-tracker|#rt-/)
        expect(DAY_NIGHT_CSS).not.toContain('/*  ')
        expect(DAY_NIGHT_CSS).not.toMatch(/[À-ÿ]/)
    })
})
