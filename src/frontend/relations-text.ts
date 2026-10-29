/**
 * The relationship system's words on screen (44, 78b): the two modes' labels
 * and the signed number, shared by the Campaign Records cards and the NPC
 * card settings now that the Relationships fold is gone.
 */

export const RELATIONSHIP_MODE_LABELS: Record<'state_tracker' | 'regex', string> = {
    state_tracker: 'The tracker’s [RELATIONS] block',
    regex: 'The narrator’s inline awards',
}

export function signed(n: number): string {
    return `${n >= 0 ? '+' : ''}${n}`
}
