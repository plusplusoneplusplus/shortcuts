import type { RalphGrillSetup } from './grill-planning-types';

/** Browser-safe fresh-composer contract. The owning server validates admission. */
export function buildRalphGrillingSubmission(input: {
    prompt: string;
    sessionId: string;
    skills?: string[];
    grill?: RalphGrillSetup;
}) {
    return {
        mode: 'ask' as const,
        prompt: input.prompt + '\n\nWhen you\'ve finished grilling me and have a clear understanding of the goal, write the final goal specification to a `.goal.md` file (e.g. `feature-name.goal.md`).',
        context: {
            skills: [...new Set([...(input.skills ?? []), 'grill-me'])],
            ralph: {
                phase: 'grilling' as const,
                sessionId: input.sessionId,
                ...(input.grill ? { grill: input.grill } : {}),
            },
        },
    };
}
