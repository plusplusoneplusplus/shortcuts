/**
 * Builds the per-iteration USER prompt for Ralph chat tasks.
 *
 * The Copilot host CLI's skill retriever (`EmbeddingRetrievalProcessor`
 * in `@github/copilot/app.js`) embeds the most recent user message and
 * surfaces matching skills via cosine similarity. If the user prompt is
 * a constant placeholder like "Begin Ralph execution loop." it carries
 * no semantic signal about what the iteration is actually doing, so
 * skills such as `impl`, `code-review`, etc. never get advertised to the
 * model. Embedding the original goal text into the user prompt fixes
 * that without changing skills or system prompts.
 *
 * The retriever also skips messages that begin with `<available_skills>`,
 * `<additional_tool_instructions>`, or `<skill-context` — so the prompt
 * must not start with any of those tags.
 */

/** Hard cap for the goal section in the user prompt (characters). */
export const RALPH_GOAL_PROMPT_MAX_LENGTH = 4000;

const TRUNCATION_MARKER = '\n…[truncated]';

const PROMPT_PREFIX =
    'Continue the Ralph execution loop toward the goal below. Read the progress journal first, then pick and implement the next subtask, run tests/build, and commit.';

export interface BuildRalphIterationPromptInput {
    /** The user's original goal text from the grilling phase. */
    originalGoal?: string;
    /** Optional override for the maximum goal length, primarily for tests. */
    maxGoalLength?: number;
}

/**
 * Build the user prompt sent for each Ralph iteration. The goal is wrapped
 * in a `<goal>` block so the embedding retriever can match it against skill
 * descriptions while still keeping it visually separable from instructions.
 */
export function buildRalphIterationPrompt(
    input: BuildRalphIterationPromptInput,
): string {
    const goal = (input.originalGoal ?? '').trim();
    if (!goal) {
        return PROMPT_PREFIX;
    }
    const limit = Math.max(1, input.maxGoalLength ?? RALPH_GOAL_PROMPT_MAX_LENGTH);
    const truncated =
        goal.length > limit
            ? goal.slice(0, limit).trimEnd() + TRUNCATION_MARKER
            : goal;
    return `${PROMPT_PREFIX}\n\n<goal>\n${truncated}\n</goal>`;
}
