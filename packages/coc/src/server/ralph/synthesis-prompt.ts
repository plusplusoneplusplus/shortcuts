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
 */

export const RALPH_SYNTHESIS_PROMPT_BASE = `You are now in the Ralph grilling phase for this conversation.

Your single job for this turn is to synthesize the discussion above into a precise goal spec for a Ralph iterative coding loop.

Read the entire prior conversation, then output exactly one Markdown block:

## Goal
<one or two short paragraphs that capture the concrete coding outcome the user wants — what to build, where, and the key constraints>

Do not include preamble, conclusions, or anything outside the block. Do not ask follow-up questions in this turn — if anything is genuinely ambiguous, make the best inference from the conversation and state your assumption inside the goal block. The user will edit the result before starting Ralph.`;

const HINT_HEADER = '\n\nThe user added this guidance to focus the synthesis (treat it as authoritative when it conflicts with earlier discussion):\n';

/** Hard cap for the user-supplied hint (characters). Mirrors the route validator. */
export const RALPH_SYNTHESIS_HINT_MAX_LENGTH = 2000;

export interface BuildRalphSynthesisPromptInput {
    /** Optional one-line hint typed by the user into the message box. */
    extraGuidance?: string;
    /** Override text from admin prompts; replaces RALPH_SYNTHESIS_PROMPT_BASE when provided. */
    promptOverride?: string;
}

export function buildRalphSynthesisPrompt(input: BuildRalphSynthesisPromptInput = {}): string {
    const base = input.promptOverride ?? RALPH_SYNTHESIS_PROMPT_BASE;
    const hint = (input.extraGuidance ?? '').trim();
    if (!hint) return base;
    const truncated = hint.length > RALPH_SYNTHESIS_HINT_MAX_LENGTH
        ? hint.slice(0, RALPH_SYNTHESIS_HINT_MAX_LENGTH).trimEnd() + '…'
        : hint;
    return `${base}${HINT_HEADER}${truncated}`;
}
