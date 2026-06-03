const SKILL_POINTER =
    'Load and follow the `ultra-ralph` skill, `execution` section. The skill file is at ~/.coc/skills/ultra-ralph/SKILL.md.';

export interface BuildRalphIterationPromptInput {
    /** The user's original goal text from the grilling phase. */
    originalGoal?: string;
    /** Absolute path to the per-session progress.md. */
    progressPath?: string;
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
        parts.push(`Progress journal: ${input.progressPath}\nIteration ${current} of ${max}.`);
    } else if (input.currentIteration !== undefined || input.maxIterations !== undefined) {
        parts.push(`Iteration ${current} of ${max}.`);
    }

    const goal = (input.originalGoal ?? '').trim();
    if (goal) {
        parts.push(`<goal>\n${goal}\n</goal>`);
    }

    return parts.join('\n\n');
}
