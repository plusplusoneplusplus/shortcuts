import { FINAL_CHECK_RESULT_SCHEMA } from './final-check-prompt';

/**
 * Build the follow-up prompt for a final-check format repair turn.
 *
 * The checker already produced its analysis in the same conversation; only the
 * serialization was lost. The prompt therefore asks for nothing but the JSON
 * block, and explicitly forbids re-running validation so the repair costs one
 * turn instead of a second full evaluation.
 */
export function buildFinalCheckRepairPrompt(parseError?: string): string {
    return [
        'Your previous response did not contain a parseable RALPH_FINAL_CHECK_RESULT block.',
        ...(parseError ? [`Parse error: ${parseError}`] : []),
        '',
        'Do not re-run any validation, re-read any files, or call any tools. Using only the findings you already reported above, reply with nothing but the RALPH_FINAL_CHECK_RESULT block.',
        '',
        'Every issue you reported becomes one entry in gaps[]. If you reported issues, hasGaps is true and gapFixGoal must be a non-empty string. If you reported no issues, hasGaps is false and gaps must be an empty array.',
        '',
        FINAL_CHECK_RESULT_SCHEMA,
    ].join('\n');
}
