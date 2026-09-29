import type { RalphHumanInput, RalphInputRequest } from './types';

function formatAnswer(answer: string | string[]): string {
    if (Array.isArray(answer)) {
        return answer.length > 0 ? answer.join(', ') : '(none)';
    }
    const trimmed = answer.trim();
    return trimmed ? trimmed : '(empty)';
}

function formatAnswerLines(input: RalphHumanInput): string[] {
    const lines: string[] = [];
    input.answers.forEach((entry, index) => {
        lines.push(`${index + 1}. Q: ${entry.question}`);
        lines.push(`   A: ${formatAnswer(entry.answer)}`);
    });
    const note = input.note?.trim();
    if (note) {
        lines.push(`Note: ${note}`);
    }
    return lines;
}

/**
 * Format the `## Human input — <ts>` progress.md section appended when the
 * user answers a RALPH_NEEDS_INPUT batch. The header deliberately does not
 * match the iteration-section grammar, so journal signal recovery ignores it.
 */
export function formatHumanInputSection(input: RalphHumanInput, request?: RalphInputRequest): string {
    const lines = [`## Human input — ${input.answeredAt}`, `Asked by: iteration ${input.iteration}`];
    const context = request?.context.trim();
    if (context) {
        lines.push(`Context: ${context}`);
    }
    lines.push(...formatAnswerLines(input));
    return `${lines.join('\n')}\n`;
}

/**
 * Format the "Human answers" block injected into the iteration prompt that
 * resumes a session after the user answered a RALPH_NEEDS_INPUT batch.
 */
export function formatHumanAnswersBlock(input: RalphHumanInput): string {
    return [
        '<human_answers>',
        `Human answers to the questions raised in iteration ${input.iteration} (answered ${input.answeredAt}).`,
        'Treat these as binding decisions for this iteration; they are also recorded in the progress journal.',
        ...formatAnswerLines(input),
        '</human_answers>',
    ].join('\n');
}
