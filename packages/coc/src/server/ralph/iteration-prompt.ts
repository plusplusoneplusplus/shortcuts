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
If the goal references a spec directory (a goal.md and optional ac-NN-*.spec.md slice files), read goal.md first, then pick the next undone slice whose Depends On entries are all done and read its slice file in full before editing code.

Honor the decision-tagging convention used by the grill-me skill:
- [decision] items are immutable. Do not change them. If a [decision] item appears wrong, stop the iteration and surface the conflict instead of working around it.
- [assumption] items may be revised. If you revise one, record the change and rationale in progress.md for this iteration.
- [open] items are unresolved. Either ask the user, or pick a value and justify the choice in progress.md.

A slice is done only when its Definition of Done is satisfied. Record evidence (test command output, demo transcript, code-search results) in progress.md before marking the iteration complete. Do not declare the overall Ralph session complete until every functional AC's Definition of Done is satisfied.
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
