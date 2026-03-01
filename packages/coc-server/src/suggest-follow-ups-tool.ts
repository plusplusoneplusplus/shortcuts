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
            'After completing your response, call this tool to suggest 2-3 brief follow-up questions the user might want to ask next. Each suggestion should be a concise, actionable question directly related to the conversation context.',
        parameters: {
            type: 'object',
            properties: {
                suggestions: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 2,
                    maxItems: 3,
                    description: '2-3 short follow-up questions the user might ask next',
                },
            },
            required: ['suggestions'],
        },
        handler: async (args: FollowUpSuggestion) => {
            return { suggestions: args.suggestions };
        },
    });
}
