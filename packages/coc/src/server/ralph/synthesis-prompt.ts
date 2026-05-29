/**
 * Builds the synthesis prompt sent to the model when an ask-mode chat is
 * promoted to a Ralph session via the follow-up Ralph pill.
 *
 * The promotion endpoint enqueues this prompt as a follow-up turn against
 * the existing process. Combined with `chat-base-executor`'s grilling-phase
 * system prompt (auto-injected when `payload.context.ralph.phase === 'grilling'`)
 * and the `grill-me` skill, it instructs the model to read the conversation
 * so far and emit a single `## Goal` Markdown block. The existing
 * `RalphStartPanel` then extracts that block to pre-fill the goal-spec
 * editor before the user clicks "Start Ralph".
 *
 * When the conversation already contains a `## Goal` block (e.g. produced by
 * the grill-me skill), the caller may pass it as `seedGoal`. The prompt then
 * instructs the model to treat that block as authoritative and preserve all
 * `[decision]` tags and constraints verbatim, only expanding missing slots.
 */

export const RALPH_SYNTHESIS_PROMPT_BASE = `You are now in the Ralph grilling phase for this conversation.

Your single job for this turn is to synthesize the discussion above into a precise goal spec for a Ralph iterative coding loop.

Read the entire prior conversation, then output exactly one Markdown spec block that starts with \`## Goal\`. The spec must capture every piece of information present in the conversation — do not omit anything. Specifically include:

- **Decisions made**: every explicit or implicit decision — tag each with \`[decision]\`.
- **Constraints named**: all technical, scope, and behavioural constraints.
- **Acceptance criteria (ACs)**: every AC the conversation implies, each with its own Definition of Done bullets.
- **Assumptions or open questions**: tag with \`[assumption]\` or \`[open]\`.

Do not include preamble, conclusions, or anything outside the goal block. Do not ask follow-up questions in this turn — if anything is genuinely ambiguous, make the best inference from the conversation and state your assumption inside the goal block. The user will edit the result before starting Ralph.`;

const SEED_HEADER = '\n\nThe conversation already contains a goal spec. Treat the existing ## Goal below as authoritative — preserve all [decision] tags and constraints verbatim; you may only expand missing ACs or Definition of Done slots.\n\n';

const HINT_HEADER = '\n\nThe user added this guidance to focus the synthesis (treat it as authoritative when it conflicts with earlier discussion):\n';

/** Hard cap for the user-supplied hint (characters). Mirrors the route validator. */
export const RALPH_SYNTHESIS_HINT_MAX_LENGTH = 2000;

export interface BuildRalphSynthesisPromptInput {
    /** Optional one-line hint typed by the user into the message box. */
    extraGuidance?: string;
    /** Override text from admin prompts; replaces RALPH_SYNTHESIS_PROMPT_BASE when provided. */
    promptOverride?: string;
    /** Pre-existing `## Goal` block extracted from the last assistant turn. When present, the
     *  model is instructed to treat it as authoritative and preserve all `[decision]` tags
     *  and constraints verbatim. */
    seedGoal?: string;
}

export function buildRalphSynthesisPrompt(input: BuildRalphSynthesisPromptInput = {}): string {
    const base = input.promptOverride ?? RALPH_SYNTHESIS_PROMPT_BASE;
    let result = base;

    const seed = (input.seedGoal ?? '').trim();
    if (seed) {
        result = `${result}${SEED_HEADER}${seed}`;
    }

    const hint = (input.extraGuidance ?? '').trim();
    if (!hint) return result;
    const truncated = hint.length > RALPH_SYNTHESIS_HINT_MAX_LENGTH
        ? hint.slice(0, RALPH_SYNTHESIS_HINT_MAX_LENGTH).trimEnd() + '…'
        : hint;
    return `${result}${HINT_HEADER}${truncated}`;
}
