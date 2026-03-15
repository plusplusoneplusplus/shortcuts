/**
 * Suggest Follow-Ups Tool
 *
 * Factory that creates a `suggest_follow_ups` custom tool for the Copilot SDK.
 * The model calls this tool at the end of each turn with 2–3 suggested follow-up
 * questions; the handler is a passthrough that returns the suggestions as-is.
 */

import { defineTool } from '@plusplusoneplusplus/pipeline-core';

export interface FollowUpSuggestion {
    suggestions: string[];
}

/**
 * Create a suggest_follow_ups custom tool definition for the Copilot SDK.
 * Pass the returned object in the `tools` array of SendMessageOptions / ISessionOptions.
 */
export function createSuggestFollowUpsTool() {
    return defineTool<FollowUpSuggestion>('suggest_follow_ups', {
        description:
            'After completing your response, call this tool to suggest 2-3 brief follow-up actions the user might want to take next. Each suggestion should be a short, direct action phrase (imperative, not a question) that continues the conversation — e.g., "Show an example", "Explain the config options", "Generate the fix". IMPORTANT: Never list follow-up suggestions in your response text. Always call this tool instead.',
        parameters: {
            type: 'object',
            properties: {
                suggestions: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 2,
                    maxItems: 3,
                    description: '2-3 short follow-up action phrases the user might take next (imperative, not questions)',
                },
            },
            required: ['suggestions'],
        },
        handler: async (args: FollowUpSuggestion) => {
            return { suggestions: args.suggestions };
        },
    });
}
