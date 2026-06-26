const SKILL_POINTER =
    'Load and follow the `ultra-ralph` skill, `execution` section. The skill file is at ~/.coc/skills/ultra-ralph/SKILL.md.';
const CONTEXT_PATH_INSTRUCTION = 'read this first; rewrite it at the end with the current best map';

export interface BuildRalphIterationPromptInput {
    /** The user's original goal text from the grilling phase. */
    originalGoal?: string;
    /** Absolute path to the per-session progress.md. */
    progressPath?: string;
    /** Absolute path to the per-session context.md. */
    contextPath?: string;
    /** Current iteration number (1-based). Defaults to 1 when omitted. */
    currentIteration?: number;
    /** Maximum iterations allowed in this loop. Defaults to 20 when omitted. */
    maxIterations?: number;
}

/**
 * Build the user prompt for each Ralph iteration.
 *
 * Structure: skill pointer, dynamic context when available, then the goal block.
 */
export function buildRalphIterationPrompt(input: BuildRalphIterationPromptInput = {}): string {
    const parts: string[] = [SKILL_POINTER];

    const current = input.currentIteration ?? 1;
    const max = input.maxIterations ?? 20;

    if (input.progressPath) {
        const sessionStateLines = [`Progress journal: ${input.progressPath}`];
        if (input.contextPath) {
            sessionStateLines.push(`Context map: ${input.contextPath} (${CONTEXT_PATH_INSTRUCTION}).`);
        }
        sessionStateLines.push(`Iteration ${current} of ${max}.`);
        parts.push(sessionStateLines.join('\n'));
    } else if (input.contextPath) {
        parts.push([
            `Context map: ${input.contextPath} (${CONTEXT_PATH_INSTRUCTION}).`,
            `Iteration ${current} of ${max}.`,
        ].join('\n'));
    } else if (input.currentIteration !== undefined || input.maxIterations !== undefined) {
        parts.push(`Iteration ${current} of ${max}.`);
    }

    const goal = (input.originalGoal ?? '').trim();
    if (goal) {
        parts.push(`<goal>\n${goal}\n</goal>`);
    }

    return parts.join('\n\n');
}
