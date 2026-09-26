/**
 * Factory that creates a `suggest_follow_ups` custom tool for the Copilot SDK.
 * The model calls this tool at the end of each turn with exactly 3 suggested follow-up
 * actions; the handler is a passthrough that returns the suggestions as-is.
 */

import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';

/** Tool description; also shown read-only in the admin prompt catalog. */
export const SUGGEST_FOLLOW_UPS_DESCRIPTION =
    'At the end of your response, call this to suggest exactly 3 follow-up actions. Write your full answer as normal visible text before calling this tool — never leave the answer only in your reasoning. Each suggestion is a short imperative action phrase, not a question. Never list follow-ups in your response text — always call this tool instead.';

export interface FollowUpSuggestion {
    suggestions: string[];
}

/**
 * Create a suggest_follow_ups custom tool definition for the Copilot SDK.
 * Pass the returned object in the `tools` array of SendMessageOptions / ISessionOptions.
 */
export function createSuggestFollowUpsTool() {
    return defineTool<FollowUpSuggestion>('suggest_follow_ups', {
        description: SUGGEST_FOLLOW_UPS_DESCRIPTION,
        parameters: {
            type: 'object',
            properties: {
                suggestions: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 3,
                    maxItems: 3,
                    description: '3 short follow-up action phrases the user might take next (imperative, not questions)',
                },
            },
            required: ['suggestions'],
        },
        handler: async (args: FollowUpSuggestion) => {
            return { suggestions: args.suggestions };
        },
    });
}
