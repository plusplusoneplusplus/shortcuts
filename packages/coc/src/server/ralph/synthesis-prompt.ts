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

export const RALPH_SYNTHESIS_PROMPT_BASE = `\
Load and follow the \`ultra-ralph\` skill, \`synthesis\` section. The skill file is at ~/.coc/skills/ultra-ralph/SKILL.md.

Machine contract (parser-required): Emit exactly one Markdown block starting with \`## Goal\`. Do not include anything outside that block.`;

const SEED_HEADER = '\n\nThe conversation already contains a goal spec. Treat the existing ## Goal below as authoritative — preserve all [decision] tags and constraints verbatim; you may only expand missing ACs or Definition of Done slots.\n\n';

const HINT_HEADER = '\n\nThe user added this guidance to focus the synthesis (treat it as authoritative when it conflicts with earlier discussion):\n';

/** Hard cap for the user-supplied hint (characters). Mirrors the route validator. */
export const RALPH_SYNTHESIS_HINT_MAX_LENGTH = 2000;

export interface BuildRalphSynthesisPromptInput {
    /** Optional one-line hint typed by the user into the message box. */
    extraGuidance?: string;
    /** Pre-existing `## Goal` block extracted from the last assistant turn. When present, the
     *  model is instructed to treat it as authoritative and preserve all `[decision]` tags
     *  and constraints verbatim. */
    seedGoal?: string;
}

export function buildRalphSynthesisPrompt(input: BuildRalphSynthesisPromptInput = {}): string {
    const base = RALPH_SYNTHESIS_PROMPT_BASE;
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
