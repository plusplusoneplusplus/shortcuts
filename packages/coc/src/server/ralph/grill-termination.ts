import type { RalphGrillTerminationReason } from './grill-planning-types';
import { RALPH_GRILL_MAX_ROUNDS } from './grill-planning-types';

export function isRalphGrillUserStopSignal(prompt: string): boolean {
    const normalized = prompt
        .trim()
        .toLowerCase()
        .replace(/[.!?]+$/g, '')
        .replace(/\s+/g, ' ');
    if (!normalized || normalized.length > 120) return false;
    return [
        'enough',
        'that is enough',
        "that's enough",
        'no more',
        'no more questions',
        'stop grilling',
        'stop the grilling',
        'proceed',
        'proceed to synthesis',
        'synthesize',
        'synthesize the goal',
        'finish',
        'finish the spec',
        'done',
    ].includes(normalized);
}

export function formatRalphGrillTerminationReason(reason: RalphGrillTerminationReason | undefined): string {
    switch (reason) {
        case 'all-agents-empty':
            return 'all resumed grill agents returned no follow-up questions';
        case 'user-ended':
            return 'the user signaled that grilling is complete';
        case 'round-cap':
            return `the ${RALPH_GRILL_MAX_ROUNDS}-round grill cap has been reached`;
        default:
            return 'grilling is complete';
    }
}
