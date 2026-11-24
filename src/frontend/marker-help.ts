/**
 * The Display marker library's words (Phase 96, the settings pane cleanup):
 * the card's own help and one short description per library marker, shown
 * behind the `[?]` after the marker's name.
 *
 * The example lines themselves are not here and are not reworded: they live
 * in `MARKER_TYPE_MAP` (`src/tracker/markers.ts`), verbatim from the pin, and
 * also draw each preview. A marker added to that table has no description
 * until one is written here, which `second-pass-cards.test.ts` holds.
 */

/** The `[?]` on the card's header: two paragraphs. */
export const MARKER_LIBRARY_HELP = [
    'Every display marker a module’s text can use, each with an example drawn as the cards draw it. Put a marker at the start of a memo line, such as ((PILLS)) or ((BAR)). You can add a named colour, as in ((BARRED)), or an exact colour, as in ((BAR - #ff8800)).',
    'The tracker copies the markers back when it rewrites the memo, so a module keeps the markers in its text. The narrator never sees them.',
].join('\n\n')

/** What each library marker draws, keyed by its canonical name. */
export const MARKER_DESCRIPTIONS: Readonly<Record<string, string>> = {
    PILLS: 'A row of pills, separated by commas. Text in brackets shows on hover.',
    PILL: 'A single coloured pill.',
    BAR: 'A coloured resource bar from a current/max value.',
    BARREL: 'A signed bar with zero at the centre. On a card, click either half to recolour it.',
    NPC: 'A freeform NPC card. It uses the matching Lorebook Agent portrait when there is one.',
    XPBAR: 'An XP bar with the level.',
    TEXT: 'Plain text.',
    BADGE: 'A reputation badge.',
    HIGHLIGHT: 'Bright highlighted text.',
    OBJ: 'A quest objective bullet. ✓ marks it done.',
    REWARD: 'A loot reward badge.',
    DIFFICULTY: 'A difficulty badge with stars.',
    PROGRESS: 'Progress as a fraction.',
    WARNING: 'An amber badge.',
    DANGER: 'A red badge.',
    SUCCESS: 'A green badge.',
    INFO: 'A blue badge.',
    GOLD: 'Gold coins.',
    SILVER: 'Silver coins.',
    BRONZE: 'Bronze coins.',
    DOLLAR: 'Paper cash.',
    HEART: 'Lives or hearts.',
    SKULL: 'Kills or deaths.',
    SOUL: 'Souls.',
    ROLL: 'A dice roll badge.',
    CLOCK: 'A segmented clock, such as 4 of 8.',
    STARS: 'A star rating, such as 3 of 5.',
    WEIGHT: 'A weight or capacity bar.',
    WEATHER: 'A weather badge with an icon.',
    ORBS: 'A row of orbs for points, such as 3 of 5.',
    SLOTS: 'A row of slots, filled and empty.',
    PHASE: 'The steps of a phase, such as 2 of 4.',
    GAUGE: 'A gauge from a current/max value.',
    CHARGE: 'Charges left, such as 2 of 5.',
}
