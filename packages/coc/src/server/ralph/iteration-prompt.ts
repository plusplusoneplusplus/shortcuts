/**
 * Builds the per-iteration USER prompt for Ralph chat tasks.
 *
 * The Copilot host CLI's skill retriever (`EmbeddingRetrievalProcessor`
 * in `@github/copilot/app.js`) embeds the most recent user message and
 * surfaces matching skills via cosine similarity. If the user prompt is
 * a constant placeholder like "Begin Ralph execution loop." it carries
 * no semantic signal about what the iteration is actually doing, so
 * relevant project skills may never get advertised to the model. A short
 * work-intent block plus the original goal text gives retrieval stable,
 * repository-agnostic implementation vocabulary without naming any skill.
 *
 * The retriever also skips messages that begin with `<available_skills>`,
 * `<additional_tool_instructions>`, or `<skill-context` — so the prompt
 * must not start with any of those tags.
 */

const PROMPT_PREFIX =
    'Continue the Ralph execution loop toward the goal below. Read the progress journal first, then pick and implement the next subtask, run tests/build, and commit.';

export const RALPH_WORK_INTENT_PROMPT = `<work_intent>
This is an autonomous implementation iteration. The agent should inspect the repository, modify source files as needed, add or update tests, run the project's validation commands such as build, test, type-check, or lint, and commit the completed change. Match this request with any project skill that handles coding, implementation, bug fixes, refactors, test updates, or source-file changes.
</work_intent>`;

export interface BuildRalphIterationPromptInput {
    /** The user's original goal text from the grilling phase. */
    originalGoal?: string;
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
        return `${PROMPT_PREFIX}\n\n${RALPH_WORK_INTENT_PROMPT}`;
    }
    return `${PROMPT_PREFIX}\n\n${RALPH_WORK_INTENT_PROMPT}\n\n<goal>\n${goal}\n</goal>`;
}
