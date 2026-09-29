import { formatHumanAnswersBlock } from './human-input';
import type { RalphHumanInput } from './types';

const SKILL_POINTER =
    'Load and follow the `ultra-ralph` skill, `execution` section. The skill file is at ~/.coc/skills/ultra-ralph/SKILL.md.';
const CONTEXT_PATH_INSTRUCTION = 'read this first; rewrite it at the end with the current best map';
const NEEDS_INPUT_INSTRUCTION = `Human input is a last resort. Emit RALPH_NEEDS_INPUT only for a critical blocker that is:
- a conflict with a [decision] item;
- a destructive or irreversible action;
- missing credentials or external access; or
- a product choice that cannot be inferred and would be costly to redo.

For every other uncertainty, choose a reasonable value, tag it [assumption], and record it in progress.md. Keep interruptions to a minimum.

When input is essential, append the normal iteration journal section with RALPH_NEEDS_INPUT as <SIGNAL>, then end the response with exactly one RALPH_NEEDS_INPUT question batch. The signal must be followed by one JSON block with this shape (at most 5 questions):
\`\`\`json
{
  "context": "What you found and why work cannot continue safely",
  "questions": [
    {
      "question": "The concrete question",
      "type": "select",
      "options": [{ "value": "value", "label": "Label", "description": "Optional description" }],
      "defaultValue": "optional value or array of values",
      "recommendation": "required recommended answer or array of answers"
    }
  ]
}
\`\`\`
Question type must be one of select, multi-select, yes-no, confirm, or text. Include options for select and multi-select; omit options when they do not apply. defaultValue is optional.
Do not emit RALPH_NEEDS_INPUT without a valid block or emit more than one question batch.`;

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
    /** The user's answers to the previous RALPH_NEEDS_INPUT batch, if resuming from one. */
    humanInput?: RalphHumanInput;
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

    if (input.humanInput) {
        parts.push(formatHumanAnswersBlock(input.humanInput));
    }

    parts.push(NEEDS_INPUT_INSTRUCTION);

    const goal = (input.originalGoal ?? '').trim();
    if (goal) {
        parts.push(`<goal>\n${goal}\n</goal>`);
    }

    return parts.join('\n\n');
}
