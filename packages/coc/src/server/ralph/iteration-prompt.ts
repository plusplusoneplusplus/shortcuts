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

/**
 * Spec-aware execution contract appended to every iteration. Tells the agent
 * how to read a structured spec produced by the grill-me skill (goal.md plus
 * optional `ac-NN-*.spec.md` slices), how to honor decision-tagged items, and
 * what counts as "done" for a slice. This is repository-agnostic — it never
 * names a specific feature or path — so it is safe to embed unconditionally.
 */
export const RALPH_SPEC_CONTRACT_PROMPT = `<spec_contract>
Load and follow the \`ultra-ralph\` skill, \`iteration\` section. The skill file is at ~/.coc/skills/ultra-ralph/SKILL.md.
</spec_contract>`;

/** The built-in default instruction head (prefix + work_intent + spec_contract). */
export const RALPH_ITERATION_PROMPT_DEFAULT_HEAD =
    `${PROMPT_PREFIX}\n\n${RALPH_WORK_INTENT_PROMPT}\n\n${RALPH_SPEC_CONTRACT_PROMPT}`;

export interface BuildRalphIterationPromptInput {
    /** The user's original goal text from the grilling phase. */
    originalGoal?: string;
    /**
     * Override text from admin prompts; replaces the default instruction head
     * (prefix + work_intent + spec_contract) when provided. The `<goal>` block
     * is still appended after the override.
     */
    promptOverride?: string;
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
    const head = input.promptOverride ?? RALPH_ITERATION_PROMPT_DEFAULT_HEAD;
    if (!goal) {
        return head;
    }
    return `${head}\n\n<goal>\n${goal}\n</goal>`;
}
